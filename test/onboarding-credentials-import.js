'use strict';
/*
 * Onboarding answers become credential rows, correctly typed by their LABEL.
 *
 * OWNER REQUEST 2026-08-20: migrate the credentials clients already gave us at
 * onboarding into the credentials store, then do it automatically for new
 * clients. His own worry was the right one -- "people usually store them in
 * weird ways" -- so this suite is built from the REAL answers on file.
 *
 * WHAT THE DATA SHOWED. 19 submissions, 90 answers, and exactly SIX distinct
 * labels. The label is a fixed form field and is reliable; the value is free
 * text and is reliable for nothing. Measured with the real parser:
 *
 *   platform guessed from the VALUE  -> wrong constantly ("account", once the
 *                                       nonsense platform "i_am_not_sure")
 *   platform read from the LABEL     -> correct 90/90
 *
 * And two of the six labels are not logins at all. "Instagram Back Up Code" is
 * a code with no username (0 of 13 parsed as handle+password) and "YouTube
 * Access" is usually a sentence about sending an invite (1 of 15). Those were
 * never parse failures -- they were the wrong question, and asking the right
 * one per kind is the substance of this change.
 *
 * NOTHING HERE IS EVER AUTO-APPROVED. Every row lands `needs_review` and keeps
 * the client's original words in `notes`, because a wrong guess about a
 * credential is worse than no guess.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'supabase', 'functions', 'client-credentials', 'index.ts');
const source = fs.readFileSync(SRC, 'utf8');
let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* Lift the REAL functions out of the deployed source and RUN them. Type
   annotations are stripped only from signatures; every body is verbatim, so a
   logic change in the Edge Function shows up here rather than in production. */
function grab(name, text) {
  const i = text.indexOf('function ' + name);
  if (i < 0) throw new Error('missing function: ' + name);
  let depth = 0, seen = false;
  for (let j = i; j < text.length; j++) {
    if (text[j] === '{') { depth++; seen = true; }
    else if (text[j] === '}') { depth--; if (seen && depth === 0) return text.slice(i, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}
function grabConst(decl, endsWith, text) {
  const i = text.indexOf(decl);
  if (i < 0) throw new Error('missing const: ' + decl);
  const end = text.indexOf(endsWith, i);
  return text.slice(i, end + endsWith.length);
}
/* Strip TypeScript from SIGNATURES ONLY -- every function body stays verbatim,
   so a logic change in the Edge Function surfaces here rather than in
   production. Done generically rather than by naming each parameter: guessing
   them is how this harness first broke (clean takes `v`, not `value`). */
function stripSignature(fnText) {
  /* The body's opening brace is the one MATCHING the final closing brace --
     found by walking backwards. Scanning forwards picks the brace inside a
     return-type annotation like `): { platform: string }` instead, which is
     how this broke the first time. */
  let depth = 0, brace = -1;
  for (let i = fnText.length - 1; i >= 0; i--) {
    if (fnText[i] === '}') depth++;
    else if (fnText[i] === '{') { depth--; if (depth === 0) { brace = i; break; } }
  }
  if (brace < 0) throw new Error('no body brace found');
  let sig = fnText.slice(0, brace);
  const body = fnText.slice(brace);
  const open = sig.indexOf('(');
  const close = sig.lastIndexOf(')');
  const name = sig.slice(0, open + 1);
  const params = sig.slice(open + 1, close)
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const eq = part.indexOf('=');
      const dflt = eq >= 0 ? part.slice(eq) : '';
      const head = eq >= 0 ? part.slice(0, eq) : part;
      return head.split(':')[0].trim() + dflt;
    })
    .join(', ');
  /* Bodies stay verbatim EXCEPT for two mechanical TypeScript-isms that are
     not JavaScript: a typed local (`const out: LabeledAnswer[] = []`) and a
     cast (`entry as JsonMap`). Neither carries behaviour, and both are removed
     by shape rather than by name so a new local does not break this harness. */
  const plainBody = body
    .replace(/\b(const|let)\s+([A-Za-z_$][\w$]*)\s*:\s*[^=;]+=/g, '$1 $2 =')
    .replace(/\s+as\s+[A-Z][A-Za-z0-9_]*(\[\])?/g, '');
  return name + params + ') ' + plainBody;
}
/* Remove RETURN-TYPE annotations before extracting. `grab` counts braces
   forwards, so a signature like `): { platform: string; kind: string } {`
   makes it stop at the end of the TYPE instead of the end of the function --
   it returns the signature and nothing else. Strip the object form first, then
   the plain form. Parameter annotations are handled later by stripSignature. */
const flat = source
  .replace(/\)\s*:\s*\{[^{}]*\}\s*\{/g, ') {')
  .replace(/\)\s*:\s*[A-Za-z_][A-Za-z0-9_<>\[\]| .]*\s*\{/g, ') {');
const pieces = [
  grabConst('const PLATFORMS = [', '];', flat),
  grabConst('const ONBOARDING_NON_ANSWER =', ';', flat),
  grabConst('const ONBOARDING_DEFERRAL =', ';', flat),
  grabConst('const ONBOARDING_ANSWER_LABELS: Record<string, string> = {', '};', flat)
    .replace('const ONBOARDING_ANSWER_LABELS: Record<string, string> =', 'const ONBOARDING_ANSWER_LABELS ='),
  ...['clean', 'normalizePlatform', 'normalizeClient', 'parseAccountLine',
      'onboardingIsNonAnswer', 'onboardingLabelFacts', 'parseLabeledOnboardingEntries',
      'labeledEntriesFromAnswers', 'onboardingRowFromLabeled'].map(n => stripSignature(grab(n, flat))),
];
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(pieces.join('\n')
  + '\nthis.row = onboardingRowFromLabeled; this.facts = onboardingLabelFacts;'
  + ' this.entries = parseLabeledOnboardingEntries; this.nonAnswer = onboardingIsNonAnswer;'
  + ' this.fromAnswers = labeledEntriesFromAnswers;',
  sandbox);
const { row, facts, entries, nonAnswer, fromAnswers } = sandbox;
ok(typeof row === 'function' && typeof facts === 'function',
  'the real labelled-import functions extract and execute (harness is not vacuous)');

const TARGET = { slug: 'a-client', name: 'A Client', matched: true };
const make = (label, value) => row({ label, value }, TARGET, 1);

// 1. THE SIX REAL LABELS -> the right platform, every time.
const LABELS = [
  ['Instagram Username & Password', 'instagram', 'login'],
  ['TikTok Username & Password', 'tiktok', 'login'],
  ['Linkedin Email & Password', 'linkedin', 'login'],
  ['Facebook Email & Password', 'facebook', 'login'],
  ['YouTube Access', 'youtube', 'access_note'],
  ['Instagram Back Up Code', 'instagram', 'backup_code'],
];
for (const [label, platform, kind] of LABELS) {
  const f = facts(label);
  ok(f.platform === platform && f.kind === kind,
    `"${label}" reads as ${platform}/${kind}`);
}

// 2. A LOGIN parses handle and password out of the shapes clients really use.
const clean1 = make('Instagram Username & Password', '@someone / hunter2!');
ok(clean1.handle === '@someone' && clean1.password === 'hunter2!' && clean1.platform === 'instagram',
  'a clean "handle / password" login parses both halves');
ok(!clean1.flags.includes('needs_review'), 'a fully parsed login is not flagged for review');
const slash = make('Linkedin Email & Password', 'someone@example.com / p@ss word');
ok(slash.handle === 'someone@example.com' && slash.password === 'p@ss word',
  'an email login parses, and a password containing a space survives');

// 3. THE PLATFORM COMES FROM THE LABEL, never from prose in the value.
//    This is the exact defect measured on live data: the value mentioning a
//    DIFFERENT platform used to win and mislabel the row.
const crossed = make('Instagram Username & Password', 'I login through Facebook (see info below)');
ok(crossed.platform === 'instagram',
  'a value that mentions Facebook does NOT relabel an Instagram answer');
ok(crossed.flags.includes('needs_review') && crossed.notes === 'I login through Facebook (see info below)',
  '...it is flagged for review with the client\'s original words kept verbatim');

// 4. A BACKUP CODE is a code. Asking for a username was the category error.
const code = make('Instagram Back Up Code', 'ABCD-1234-EFGH');
ok(code.password === 'ABCD-1234-EFGH' && code.handle === '',
  'a backup code is stored as the secret, with no invented username');
ok(code.flags.includes('backup_code') && !code.flags.includes('needs_review'),
  'it is labelled a backup code, not reported as a failed login parse');
ok(code.label === 'Instagram Back Up Code',
  'the label is preserved, so it is distinguishable from the Instagram login row');

// 5. AN ACCESS NOTE carries no secret and must not pretend to.
const note = make('YouTube Access', 'I will add you as a manager on the channel');
ok(note.handle === '' && note.password === '' && note.flags.includes('access_note'),
  'an access note extracts no credential and says so');
ok(note.notes === 'I will add you as a manager on the channel',
  'the note text is kept for the reviewer');

// 6. A NON-ANSWER is distinguished from an unparseable one -- the remedy
//    differs: unparseable needs a human to read it, missing needs the CLIENT
//    asked again.
for (const blank of ['None', 'n/a', 'N/A', '-', 'TBD', '', '   ', 'Working on getting this for you!', 'I am not sure']) {
  ok(nonAnswer(blank), `"${blank}" is recognised as no answer at all`);
}
ok(!nonAnswer('@real / secret1'), 'a real credential is not mistaken for a non-answer');
const missing = make('TikTok Username & Password', 'Working on getting this for you!');
ok(missing.flags.includes('no_answer') && !missing.flags.includes('needs_review'),
  'a client who never answered is flagged no_answer, not queued as a parse to review');
ok(missing.password === '' && missing.handle === '',
  '...and no part of that sentence is stored as a credential');

// 7. NEVER AUTO-APPROVED, and the raw answer is never lost.
for (const [label] of LABELS) {
  const r = make(label, '@x / y');
  ok(r.status === 'needs_review', `${label} lands needs_review, never approved`);
}
ok(make('Instagram Username & Password', '  @x / y  ').notes === '@x / y',
  'notes carry the client answer verbatim for the reviewer');

// 8. AN UNMATCHED CLIENT is quarantined rather than filed under a guess.
const orphan = row({ label: 'TikTok Username & Password', value: '@x / y' },
  { slug: 'nope', name: 'Nope', matched: false }, 3);
ok(orphan.client_slug.startsWith('unmatched:') && orphan.flags.includes('unknown_client'),
  'an unrecognised client is quarantined under an unmatched slug, not filed by guess');

// 9. THE ENTRY READER tolerates the shapes the form and its exports produce.
ok(entries([{ label: 'A', value: 'b' }]).length === 1, 'reads {label, value}');
ok(entries([{ question: 'A', answer: 'b' }])[0].label === 'A', 'reads {question, answer}');
ok(entries([{ label: '', value: '' }]).length === 0, 'drops a wholly empty entry');
ok(entries(null).length === 0 && entries('a string').length === 0 && entries([1, 2]).length === 0,
  'a missing or malformed payload yields nothing rather than throwing');

// 10. THE GATEWAY STILL WRITES BY DEFAULT.
//     Review finding on PR #1111. An earlier cut of this change made preview
//     the default, which reads as the safer choice and is not: two DEPLOYED
//     n8n workflows (syncview-onboarding-submit, syncview-ai-onboarding-submit)
//     call this action with no dry_run and with onError:continueRegularOutput.
//     Preview-by-default turns those into silent SUCCESSFUL no-ops -- ok:true,
//     imported:0, workflow continues, vault never seeded. A silent no-op in
//     automation is worse than any error, so the contract is preserved and the
//     browser states its intent explicitly in both directions instead.
const importAction = grab('actionOnboardingImport', source);
ok(/const dryRun = body\.dry_run === true;/.test(importAction),
  'onboarding_import writes unless a caller explicitly asks for a preview');
ok(!/body\.dry_run !== false/.test(importAction),
  'the default is not flipped back to preview -- that silently breaks the n8n callers');
ok(/if \(dryRun\) return json\(\{ ok: true, dry_run: true, imported: 0, preview: annotated \}\);/.test(importAction),
  'an explicit preview returns the rows and writes nothing');

// 12. A HAND-ENTERED CREDENTIAL IS NEVER OVERWRITTEN.
//     Owner ruling 2026-08-20: "I don't want you to overwrite credentials that
//     were manually placed in case it's more up-to-date." saveOne UPDATES in
//     place on a client+platform+label match, so without this an import would
//     replace a password someone typed -- and the onboarding answer is by
//     definition the OLDER value. The audit log would have recorded it, but
//     only after the good value was gone.
/* Matched on client+platform, NOT client+platform+LABEL. Every hand-entered
   row in the live store carries an EMPTY label while an imported one is
   labelled from the onboarding question, so an exact-label lookup found
   nothing: the protection never fired AND the write path inserted a SECOND
   row. The owner caught this looking at the real screen -- a client with a
   manual Instagram credential was ticked "secret captured" with no warning. */
ok(/\.eq\("client_slug", r\.client_slug\)[\s\S]{0,80}\.eq\("platform", r\.platform\)/.test(importAction),
  'the existing-row lookup keys on client+platform, so an empty-label manual row is still found');
ok(!/label: r\.label \|\| ""/.test(importAction),
  'it no longer requires the labels to match, which is what made the protection silent');
ok(/clean\(row\.source\) !== "onboarding"/.test(importAction),
  'a row that did not come from onboarding is treated as hand-entered');
/* A BACKUP CODE is a different secret from the login for the same platform, so
   a client may legitimately hold both; blocking it on the presence of a login
   would lose real data. */
ok(/const isLoginRow = !r\.flags\.includes\("backup_code"\) && !r\.flags\.includes\("access_note"\)/.test(importAction),
  'only a LOGIN row is protected by an existing login -- a backup code is a separate secret and still imports');
ok(/back\\s\*-\?\\s\*up\|backup\|recovery/.test(importAction),
  'and an existing backup-code row does not count as the login it sits beside');
ok(/annotated\.filter\(\(row\) => !row\.flags\.includes\("existing_manual"\)\)/.test(importAction),
  'those rows are excluded from the write loop entirely');
ok(/skipped_existing_manual: skipped\.length/.test(importAction),
  'and the count of protected rows is reported, so a skip is never silent');
ok(importAction.indexOf('existingManual') < importAction.indexOf('if (dryRun)'),
  'the protection is annotated on the PREVIEW too -- the reviewer sees it before deciding');
/* Narrow on purpose: a row this import created before MAY still be refreshed,
   so a client who re-submits a corrected password updates their own row. Only
   manual entries are protected. */
ok(/!== "onboarding"/.test(importAction) && !/=== "manual"/.test(importAction),
  'the rule protects anything not onboarding-sourced, rather than only the literal manual source');
ok(importAction.indexOf('const dryRun') < importAction.indexOf('saveOne'),
  'the dry-run gate is evaluated BEFORE any save');

// 11. THE CURRENT FUNNELS. Review finding on PR #1111: a standard or AI
//     submission has NO credentials array -- its account access sits in flat
//     per-platform keys on `answers`. Reading only the legacy array meant the
//     importer could never serve a NEW client, which is most of the point.
const CURRENT_FUNNEL_ANSWERS = {
  instagram: '@brand / pw1',
  instagram_backup: 'AAAA-BBBB',
  tiktok: '@brand.tt / pw2',
  facebook: 'brand@example.com / pw3',
  linkedin: 'brand@example.com / pw4',
  youtube: 'I will add you as a manager',
  first_name: 'ignored', phone: 'ignored', notes: 'ignored',
};
const fromCurrent = fromAnswers(CURRENT_FUNNEL_ANSWERS);
ok(fromCurrent.length === 6, 'all six platform answers are read from a current-funnel submission');
ok(fromCurrent.every(e => /Username & Password|Back Up Code|Email & Password|Access/.test(e.label)),
  '...and each is given the SAME label vocabulary the legacy form used, so one parser serves both');
ok(!fromCurrent.some(e => /ignored/.test(e.value)),
  'non-credential answers on the same object are not swept in');
const currentRows = fromCurrent.map((e, i) => row(e, TARGET, i + 1));
ok(currentRows.filter(r => r.platform === 'instagram').length === 2,
  'the Instagram login and its backup code both land, both as instagram');
ok(currentRows.find(r => r.label === 'Instagram Back Up Code').flags.includes('backup_code'),
  '...and the backup code is still typed as a code, not a login');
ok(currentRows.find(r => r.label === 'Linkedin Email & Password').handle === 'brand@example.com',
  'an email login from the current funnel keeps its whole address');
ok(fromAnswers({}).length === 0 && fromAnswers(null).length === 0,
  'a submission with no answers yields nothing rather than throwing');
ok(fromAnswers({ instagram: '   ' }).length === 0, 'a blank answer is not turned into a row');
/* Everything above exercises the normaliser DIRECTLY, and would keep passing
   if parseOnboardingRows never called it -- which is exactly the bug the
   review found. Pin the wiring, and pin the ORDER: an explicit credentials
   array must still win, so a legacy row is never re-derived from stray answers. */
const entryPoint = grab('parseOnboardingRows', flat);
ok(/\|\| labeledEntriesFromAnswers\(answers\)/.test(entryPoint),
  'parseOnboardingRows actually falls back to the current-funnel answers');
ok(entryPoint.indexOf('parseLabeledOnboardingEntries') < entryPoint.indexOf('labeledEntriesFromAnswers'),
  'an explicit credentials array still takes precedence over the answers fallback');
ok(entryPoint.indexOf('labeledEntriesFromAnswers') < entryPoint.indexOf('extractTextCandidates'),
  'and both labelled paths are preferred over the old guess-from-prose text scan');

if (failures) {
  console.error(`\n${failures} onboarding credential-import check(s) failed.`);
  process.exit(1);
}
console.log('\nOnboarding credential-import checks passed.');
