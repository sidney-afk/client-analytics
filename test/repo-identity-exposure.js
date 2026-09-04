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
const WORKFLOW = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'calendar-unit-tests.yml'), 'utf8');
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
/* STRING CONTENTS ARE STRIPPED for this enumeration, and only for it. The
   redaction message itself contains the word "term" — and whitelisting that
   LINE would set the precedent that a line mentioning the variable can be
   excused, which is how a real leak gets waved through. Removing string
   bodies leaves only the places the VARIABLE is used. */
const CODE_NO_STRINGS = CODE
  .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
  .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
  .replace(/`(?:[^`\\]|\\.)*`/g, '``');
const termUses = CODE_NO_STRINGS.split('\n')
  .map((line, i) => ({ line: line.trim(), n: i + 1 }))
  .filter(x => /\bterm\b/.test(x.line));
ok(termUses.length > 0 && termUses.length <= 14,
  `the matched string is used in exactly ${termUses.length} places, few enough to enumerate`);
const allowed = [
  /terms\.push\(\{ kind: '', term: slug \}\);/,
  /terms\.push\(\{ kind: '', term: name \}\);/,
  /function filesContaining\(term\) \{/,
  /function pathsContaining\(term\) \{/,
  /function addedLinesContaining\(term, base\) \{/,
  /function addedPathsContaining\(term, base\) \{/,
  /const out = git\(\[.*term\], \{ termInArgs: true \}\);/,
  /const needle = term\.toLowerCase\(\);/,
  /line\.includes\(term\)\) count\+\+;/,
  /for \(const \{ kind, term \} of terms\)/,
  /\? addedLinesContaining\(term, DIFF_BASE\)\.map\(h => h\.file\)\.concat\(addedPathsContaining\(term, DIFF_BASE\)\)/,
  /: filesContaining\(term\)\.concat\(pathsContaining\(term\)\);/,
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

/* ---- 1b. The error path, which is where it nearly leaked ---------------- */

/* `execFileSync` puts the WHOLE ARGV in its error message, and the argv holds
   the roster term. So a git failure that is not the no-match status would have
   printed a client's slug into a CI log — the tool's one guarantee, broken on
   exactly the path most likely to be pasted somewhere. Raised by review on
   #1224 and the sharpest of the four. */
ok(/function git\(args, \{ termInArgs = false \} = \{\}\)/.test(CODE),
  'every git call goes through one wrapper, so there is one error path to get right rather than three');
ok(/throw new Error\(`git \$\{args\[0\]\} failed \(status \$\{code\}\)`/.test(CODE),
  'and it THROWS A REPLACEMENT — the original message, which carries the argv, never escapes');
ok(!/throw err;/.test(CODE),
  'the original error is never re-thrown, so nothing downstream can print it');
ok(/message withheld because the argument list carries a roster term/.test(CODE),
  'and the replacement says WHY it is terse, so the next reader does not "improve" it back');

/* ---- 1c. Contents are not the only place a name lives ------------------ */

ok(/function pathsContaining\(term\)/.test(CODE) && /git\(\['ls-files'\]\)/.test(CODE),
  'FILE PATHS ARE SCANNED TOO — a file called `2026-09-02-<client>-audit.md` with a generically worded body is exactly as public as one that says the name in a sentence, and git grep does not look at path text');
ok(/filesContaining\(term\)\.concat\(pathsContaining\(term\)\)/.test(CODE),
  'and both are counted in tree mode');

/* ---- 1d. Diff mode: the gate that runs before the change is public ----- */

/* Review on #1224 was right twice over. `npm test` never invokes this script,
   so a change adding a client identifier passed CI and became public before the
   exit status was ever observed. And a baseline of TOTALS cannot see a SWAP:
   replacing one already-counted name with a new person's leaves every number
   exactly where it was. Scanning what a change ADDS needs no committed
   baseline, catches the swap exactly, and stays privacy-preserving. */
ok(/const DIFF_BASE = diffArg \? diffArg\.split\('='\)\[1\] : null;/.test(CODE),
  '`--diff=<ref>` selects the mode that scans only what a change ADDS');
ok(/function addedLinesContaining\(term, base\)/.test(CODE)
  && /function addedPathsContaining\(term, base\)/.test(CODE),
  'and it scans added LINES and added PATHS, because either one publishes a name');
ok(/const failed = DIFF_BASE\s*\n\s*\? files\.length > 0/.test(CODE),
  'IN DIFF MODE THE BASELINE IS ZERO — anything a change adds is new exposure by definition, so there is nothing to tolerate and no number to keep in step');
ok(/--diff="origin\/\$\{\{ github\.base_ref \}\}"/.test(WORKFLOW),
  'and CI runs it on every pull request, which is the only place it can stop a name BEFORE it is public');
ok(/if: github\.event_name == 'pull_request'/.test(WORKFLOW),
  'as its own job — the unit job is documented as reaching no live backend, and this needs the roster to know what an identity is');
ok(/code -eq 1/.test(WORKFLOW) && /code -ne 0/.test(WORKFLOW) && /::warning::/.test(WORKFLOW),
  'A ROSTER READ THAT FAILS IS NOT A RED BUILD: exit 1 is a finding and blocks, anything else warns and passes — an outage must not look like a leak, and a fork with no network must not look clean either');
ok(/deliberately does not print what it matched/.test(WORKFLOW),
  'and the CI error tells the reader to run it locally rather than asking the log to name the client');

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
ok(/const NON_PERSON_KINDS = new Set\(\['test', 'internal'\]\);/.test(CODE),
  'rows in `clients` that are not people are skipped: a fixture and a sentinel are named in the code by design, and gating on them would ring forever for nobody');
/* The one that was found the hard way. The attribution carve-out in
   linear-inbound writes a sentinel slug into client_slug, and that sentinel is a
   `clients` row — so on 2026-09-04 this guard failed a DOCS change for quoting a
   string that had been sitting in index.html and linear-inbound/index.ts on main
   all along. A guard that fails on documentation of ordinary code is one people
   learn to route around, which is the single thing it cannot afford. */
ok(/'internal'/.test(CODE),
  "and 'internal' specifically, because the invalid-attribution sentinel lives in that table and is written by the shipped source");
/* An unknown kind must STOP the run. Including it re-creates the false positive
   for whatever the next sentinel is called; skipping it drops a real client out
   of the roster with nobody the wiser, which is the direction that leaks. */
ok(/unknownKinds/.test(CODE) && /throw new Error\('clients\.kind carries value\(s\)/.test(CODE),
  'and a kind the guard does not classify fails the run rather than being guessed at in either direction');
ok(/const PERSON_KIND = 'client';/.test(CODE),
  'with the person kind named once, so the classification is readable rather than implied by what is absent');
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
