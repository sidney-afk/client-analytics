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
ok(/dry_run: true/.test(fn), 'the preview pass is a dry run');
ok(/dry_run: false/.test(fn), 'the write pass is explicit, not a default');
ok(fn.indexOf('dry_run: true') < fn.indexOf('dry_run: false'),
  'preview happens BEFORE any write');
ok(/_ccApi\('onboarding_import'/.test(fn) && (fn.match(/_ccApi\('onboarding_import'/g) || []).length === 2,
  'both passes go through the SAME gateway action -- the preview cannot drift from the write');
ok(!/r\.password\)\s*\+|_ccEsc\(r\.password/.test(fn),
  'no password value is ever rendered into the review list');
ok(/secret captured/.test(fn) && /no secret/.test(fn),
  'the presence of a secret is shown instead of the secret itself');
ok(/chosen\.has\(key\(gi, ri\)\) \? g\.entries\[r\.line - 1\] : null/.test(fn),
  'only the SELECTED answers are sent -- the payload is narrowed, not filtered server-side');
ok(/importBtn\.disabled = !n/.test(fn),
  'Import is disabled while nothing is selected');
ok(/needs review/i.test(fn), 'the screen tells the reviewer that everything lands needs-review');

// 5. IT IS REACHABLE. The gateway action already existed with no caller; a
//    second orphaned feature would be the same bug twice.
ok(/onclick="_ccOpenOnboardingImport\(\)"/.test(source),
  'a button in the credentials toolbar actually opens it');

if (failures) {
  console.error(`\n${failures} onboarding-import UI check(s) failed.`);
  process.exit(1);
}
console.log('\nOnboarding credential-import UI checks passed.');
