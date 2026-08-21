'use strict';
/*
 * The "Import from onboarding" screen: preview, choose, then write.
 *
 * OWNER REQUEST 2026-08-20: migrate the credentials clients already gave us at
 * onboarding, then keep doing it for new clients. The gateway could already do
 * this -- an `onboarding_import` action existed, fully written, with NO caller
 * anywhere in the app. Clients had been typing their logins into the onboarding
 * form while the store held 12 rows across 5 clients and 32 active clients had
 * nothing at all.
 *
 * REVIEW IS THE POINT. The values are free text a client typed: a third cannot
 * be parsed into a handle and a password, and some are not credentials at all
 * ("Working on getting this for you!"). So the screen previews through the SAME
 * gateway action that will write -- never a second browser-side parser that
 * could drift -- lets every row be deselected, and writes nothing until Import.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}
function extractFn(name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error('missing function: ' + name);
  let depth = 0, seen = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') { depth++; seen = true; }
    else if (ch === '}') { depth--; if (seen && depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error('unbalanced: ' + name);
}
function extractConst(decl, endsWith) {
  const start = source.indexOf(decl);
  if (start < 0) throw new Error('missing const: ' + decl);
  const end = source.indexOf(endsWith, start);
  return source.slice(start, end + endsWith.length);
}

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext([
  extractConst('const CC_ONBOARDING_FLAG_TEXT = {', '};'),
  extractFn('_ccOnboardingRowUsable'),
  'this.usable = _ccOnboardingRowUsable; this.FLAGS = CC_ONBOARDING_FLAG_TEXT;',
].join('\n'), sandbox);
const { usable, FLAGS } = sandbox;
ok(typeof usable === 'function', 'the real default-selection predicate extracts and executes');

// 1. WHAT IS PRE-TICKED. A reviewer should be approving good rows, not hunting
//    for the bad ones -- but nothing that cannot be used may be pre-ticked.
ok(usable({ platform: 'instagram', handle: '@x', password: 'y', flags: [] }),
  'a complete credential is selected by default');
ok(usable({ platform: 'instagram', password: 'ABCD-1234', flags: ['backup_code'] }),
  'a captured backup code is selected by default -- it is a real secret');
/* These two carry a handle AND a password on purpose. Without them the
   assertions passed for the wrong reason -- an empty row is unusable anyway,
   so deleting the flag check entirely still went green. The flag must be what
   excludes them: "YouTube Access: @thechannel" really can yield a handle, and
   filing a note as a login is exactly the mistake being prevented. */
ok(!usable({ platform: 'youtube', handle: '@thechannel', password: 'looks-like-one', flags: ['access_note'] }),
  'an access note is NOT pre-selected even when text was extracted from it');
ok(!usable({ platform: 'tiktok', handle: '@x', password: 'y', flags: ['no_answer'] }),
  'a row flagged as unanswered is NOT pre-selected even if something was extracted');
ok(!usable({ platform: 'instagram', handle: '', password: '', flags: ['needs_review'] }),
  'a row with nothing extracted is NOT pre-selected');
ok(usable({ platform: 'instagram', handle: '@x', password: '', flags: ['needs_review'] }),
  'a row with a handle but no password IS pre-selected -- partial is still worth filing for review');

// 2. AN UNRECOGNISED CLIENT IS NEVER PRE-TICKED, even with a perfect secret:
//    it would file a real credential under a guessed client.
ok(!usable({ platform: 'instagram', handle: '@x', password: 'y', flags: ['unknown_client'] }),
  'an unrecognised client is never pre-selected, however complete the row');

/* A credential someone typed by hand is protected server-side and will not be
   overwritten (owner ruling 2026-08-20 -- the manual value may be NEWER than
   the onboarding answer). It must not be pre-ticked either: a ticked row that
   silently does nothing reads as a bug. Fixture carries a complete secret on
   purpose, so only the flag can be what excludes it. */
ok(!usable({ platform: 'instagram', handle: '@x', password: 'y', flags: ['existing_manual'] }),
  'a credential already saved by hand is never pre-selected for overwrite');
ok(typeof FLAGS.existing_manual === 'string' && /hand/.test(FLAGS.existing_manual),
  'and the row says plainly that it is already saved by hand');

// 3. EVERY FLAG READS AS PLAIN LANGUAGE. A reviewer deciding in bulk cannot be
//    asked to interpret raw enum names.
for (const flag of ['no_answer', 'access_note', 'backup_code', 'needs_review', 'unknown_client']) {
  const text = FLAGS[flag];
  ok(typeof text === 'string' && text.length > 3 && text !== flag && !/_/.test(text),
    `the "${flag}" flag is shown as plain language ("${text}")`);
}

// 4. THE SCREEN'S CONTRACT, pinned at source. These are the properties that
//    make it safe to hand a bulk credential import to a human.
const fn = extractFn('_ccOpenOnboardingImport');
ok(/dry_run: true/.test(fn), 'the preview pass is an explicit dry run');
ok(/dry_run: false/.test(fn), 'the write pass is explicit, not a default');
ok(fn.indexOf('dry_run: true') < fn.indexOf('dry_run: false'),
  'preview happens BEFORE any write');
ok(/_ccApi\('onboarding_import'/.test(fn) && (fn.match(/_ccApi\('onboarding_import'/g) || []).length === 2,
  'both passes go through the SAME gateway action -- the preview cannot drift from the write');
ok(!/r\.password\)\s*\+|_ccEsc\(r\.password/.test(fn),
  'no password value is ever rendered into the review list');
ok(/secret captured/.test(fn) && /no secret/.test(fn),
  'the presence of a secret is shown instead of the secret itself');
ok(/\.filter\(\(r, ri\) => chosen\.has\(key\(gi, ri\)\)\)/.test(fn),
  'only the SELECTED rows are sent -- the payload is narrowed, not filtered server-side');
ok(/label: r\.label \|\| '', value: r\.raw \|\| r\.notes \|\| ''/.test(fn),
  'the write re-sends the PREVIEW\'s own labelled rows, so what was reviewed is what lands');

/* ---- review findings on PR #1111, all three P1 ------------------------- */

// onboarding-full returns three funnel shapes that do not agree. A legacy row
// has a `credentials` array; standard and AI rows have flat per-platform keys
// on `answers` and NO credentials array. Filtering on `credentials` alone
// dropped every current-funnel submission, so the screen could never have
// imported a NEW client -- most of the point of building it.
ok(/Array\.isArray\(sub && sub\.credentials\) \? sub\.credentials : null/.test(fn)
  && /Object\.keys\(sub\.answers\)\.length/.test(fn),
'both funnel shapes reach the preview -- the legacy array AND the current answers keys');
ok(/answers: sub\.answers/.test(fn),
  'the answers object is forwarded so the gateway can normalise the current funnel');

// None of the three shapes sends client_name or client_slug; they send slug,
// first_name and last_name. Reading the wrong fields left every row unnamed,
// flagged the whole import unknown_client, and filed anything selected under
// "(unnamed)".
ok(/\[sub && sub\.first_name, sub && sub\.last_name\]\.filter\(Boolean\)\.join\(' '\)/.test(fn),
  'the client name is composed from the fields onboarding-full actually returns');
ok(/client_slug: sub\.slug/.test(fn), 'the real slug is carried into the preview');
ok(/client_slug: g\.slug \|\| ''/.test(fn), 'and into the write, so nothing lands under a guessed client');

// onboarding-full is Admin-only and returns 403 for an SMM key, but the
// Client Credentials tab is deliberately open to Admin AND SMM -- so an SMM
// saw a button that could only ever end at "Admin access required".
ok(/_syncviewStaffRoleValue\(_syncviewStaffIdentityForHeaders\(\)\) === 'admin'/.test(source),
  'the import button is rendered only for Admin, matching the endpoint it depends on');
ok(/importBtn\.disabled = !n/.test(fn),
  'Import is disabled while nothing is selected');
ok(/needs review/i.test(fn), 'the screen tells the reviewer that everything lands needs-review');

// 5. IT IS REACHABLE. The gateway action already existed with no caller; a
//    second orphaned feature would be the same bug twice.
ok(/onclick="_ccOpenOnboardingImport\(\)"/.test(source),
  'a button in the credentials toolbar actually opens it');

/* ---- owner requests 2026-08-21, from using the real screen ------------- */

// "What do I do with the ones that say could not read password, like maybe
//  show them to me why that's saying this."
ok(/const showRaw = !r\.password && \(r\.raw \|\| r\.notes\)/.test(fn),
  "a row we could not read shows the client's own answer, so the reviewer can judge it");
ok(/client wrote:/.test(fn),
  '...labelled as the client\'s words, not presented as our parse');
ok(fn.indexOf('const showRaw = !r.password') > 0 && /!r\.password/.test(fn),
  'the raw answer is shown ONLY where no secret was read -- never for a row whose password we captured');

// "I don't want to manually select every single one of them."
ok(/window\._ccObAll = \(on\) =>/.test(fn) && /window\._ccObGroup = \(gi\) =>/.test(fn),
  'there are bulk select controls, per client and for everything');
ok(/Select all/.test(fn) && /Select none/.test(fn),
  'both directions are offered, not just select-all');
ok(/const selectable = \(gi, ri\) => !\(groups\[gi\]\.rows\[ri\]\.flags \|\| \[\]\)\.includes\('existing_manual'\)/.test(fn),
  'a helper decides what bulk select may touch');
/* Pin the USE, not just the definition. Asserting the helper exists passed
   even with every call to it deleted -- which is the whole bug it guards
   against, and the second time in this file that a definition-only pin let a
   mutation through. Both bulk paths must consult it. */
ok((fn.match(/if \(!selectable\(gi, ri\)\) return;/g) || []).length === 2,
  'BOTH bulk paths -- per client and select-all -- actually consult it');
ok(/_ccObGroup[\s\S]{0,400}?!selectable\(gi, ri\)/.test(fn),
  'the per-client toggle skips a locked row');
ok(/_ccObAll[\s\S]{0,400}?!selectable\(gi, ri\)/.test(fn),
  'and so does select-all');
ok(/\$\{locked \? ' disabled' : ''\}/.test(fn),
  'and such a row is disabled outright -- a tick the server would refuse is a lie');

if (failures) {
  console.error(`\n${failures} onboarding-import UI check(s) failed.`);
  process.exit(1);
}
console.log('\nOnboarding credential-import UI checks passed.');
