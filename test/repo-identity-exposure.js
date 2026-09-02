'use strict';
/*
 * A LEAK DETECTOR MUST NOT BE A SECOND COPY OF THE LEAK.
 *
 * This repository is PUBLIC, and measured 2026-09-02 against the live roster,
 * 45 of the 50 identifying terms on it — 39 of 47 client slugs and 6 staff full
 * names — appear somewhere in the tree, across 108 files. Nobody decided that;
 * it accumulated one audit, one migration and one ledger entry at a time, each
 * with a good local reason to name the client it was about.
 *
 * `scripts/repo-identity-exposure-check.js` gates GROWTH, which is the only
 * part that can be handled without an owner decision — the same strings are in
 * git history, so a repair is a history rewrite plus a judgement call about
 * which audits are worth keeping.
 *
 * THE PROPERTY THIS SUITE EXISTS FOR is the one that would be easy to lose in
 * a later "make the output more useful" edit: the script reports counts and
 * file paths and NEVER what it matched. A check whose own output names the
 * clients — in a CI log, pasted into an issue, on a shared screen — has made
 * one more public copy of exactly the thing it was written to bound.
 *
 * Offline. No network, no roster read; this pins the rules, and the script
 * measures the estate.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'scripts', 'repo-identity-exposure-check.js'), 'utf8');
/* Comments carry the reasoning and would otherwise satisfy or trip every
   regex below. Rules are asserted against CODE. */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* ---- 1. It never prints what it found --------------------------------- */

/* The matched string lives in one variable. Every place it is used is listed
   here; anything else is a leak. Asserted by enumeration rather than by
   searching the output sites, because a leak can be introduced by a template
   literal, a JSON field, or a thrown error message equally well. */
const termUses = CODE.split('\n')
  .map((line, i) => ({ line: line.trim(), n: i + 1 }))
  .filter(x => /\bterm\b/.test(x.line));
ok(termUses.length > 0 && termUses.length <= 6,
  `the matched string is used in exactly ${termUses.length} places, few enough to enumerate`);
const allowed = [
  /terms\.push\(\{ kind: 'client_slug', term: slug \}\);/,
  /terms\.push\(\{ kind: 'staff_name', term: name \}\);/,
  /function filesContaining\(term\) \{/,
  /execFileSync\('git', \[.*'--', term\]/,
  /for \(const \{ kind, term \} of terms\)/,
  /const files = filesContaining\(term\);/,
];
const unexpected = termUses.filter(u => !allowed.some(re => re.test(u.line)));
ok(unexpected.length === 0,
  unexpected.length === 0
    ? 'and every one of them is collection or the grep itself — the term never reaches an output site'
    : 'THESE USES OF THE MATCHED TERM ARE NOT ACCOUNTED FOR: ' + unexpected.map(u => `line ${u.n}: ${u.line}`).join(' | '));

ok(!/console\.(log|error|warn)\([^)]*\bterm\b/.test(CODE),
  'no console call takes the term');
const jsonStart = CODE.indexOf('JSON.stringify({');
const jsonEnd = CODE.indexOf('}, null, 2)', jsonStart);
const payload = jsonStart > -1 && jsonEnd > jsonStart ? CODE.slice(jsonStart, jsonEnd) : '';
ok(payload.length > 50, 'the --json payload is readable as one object');
ok(/roster_terms_checked: terms\.length/.test(payload) && !/\bterm\b/.test(payload)
  && !/\bterms\b(?!\.length)/.test(payload),
  'and it carries the COUNT of roster terms and the file list — `terms` appears only as `terms.length`, and the matched string not at all');

ok(/'grep', '-lI', '-F', '--'/.test(CODE),
  'the grep is `-l` — it answers with FILE NAMES and never a matching line, which is the property this needs rather than a convenience');
ok(!/'-n'/.test(CODE) && !/--line-number/.test(CODE),
  'and never asks for line numbers or content');

/* ---- 2. What it counts, and why there are two baselines ---------------- */

ok(/BASELINE_FILES/.test(CODE) && /BASELINE_TERMS/.test(CODE),
  'TWO baselines, a file count and a term count');
ok(/files\.length > BASELINE_FILES \|\| matchedTerms > BASELINE_TERMS/.test(CODE),
  'and either one failing fails the run — counting only terms lets a new file name six clients as long as six others stopped being mentioned, and counting only files lets one file name the whole roster');
ok(/process\.exit\(failed \? 1 : 0\)/.test(CODE),
  'it exits non-zero above the baseline, so it can gate rather than only inform');

/* ---- 3. The exclusions, each a false-positive it would otherwise report - */

ok(/const MIN_SLUG = 5;/.test(CODE) && /slug\.length < MIN_SLUG/.test(CODE),
  'a slug shorter than five characters is skipped — it matches ordinary English and is not identifying on its own');
ok(/c\.kind === 'test'/.test(CODE),
  'the TEST client is skipped: it is a fixture, it is named in the code by design, and gating on it would ring forever for nobody');
ok(/name\.split\(\/\\s\+\/\)\.length < 2/.test(CODE),
  'a single given name is skipped — it matches too much prose to be evidence');

/* ---- 4. Read-only, in both directions ---------------------------------- */

ok(!/writeFileSync|appendFileSync|mkdirSync|rmSync|unlinkSync/.test(CODE),
  'it writes no file');
ok(!/method:\s*'(POST|PUT|PATCH|DELETE)'/i.test(CODE) && !/\bfetch\([^)]*,\s*\{[^}]*method/.test(CODE),
  'and makes no write request — the one network call is the roster read');
ok(/execFileSync\('git', \[/.test(CODE) && !/execSync\(/.test(CODE),
  'the grep is execFileSync with an argument ARRAY, not a shell string — a roster value must never be able to become part of a command line');

/* ---- 5. A no-match is a result, not an error --------------------------- */

ok(/err && err\.status === 1/.test(CODE) && /return \[\];/.test(CODE),
  'GIT GREP EXITS 1 WHEN NOTHING MATCHES, and that is handled as an empty result — treating it as a failure would make a clean term look like a broken check');

/* ---- 6. It says what it cannot do ------------------------------------- */

ok(/gates GROWTH only/i.test(SRC) || /This gates GROWTH only/.test(SRC),
  'the output states plainly that this bounds growth and removes nothing');
ok(/GIT_HISTORY_PII_PURGE_2026-07-14\.md/.test(SRC),
  'and points at the prior history purge, so the reader knows the repair shape exists and whose call it is');

console.log(failures === 0
  ? '\nrepo identity exposure checks passed'
  : '\n' + failures + ' repo identity exposure check(s) failed');
process.exit(failures === 0 ? 0 : 1);
