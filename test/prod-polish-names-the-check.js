'use strict';
/*
 * A RED GATE THAT CANNOT NAME WHAT FAILED IS AN UNOWNED GATE.
 *
 * Run #607 on main, verbatim:
 *
 *   Production heavy gate failed at: Production wired behavior [unclassified].
 *
 * `unclassified` is the gate's way of saying no signature matched. behav-wired
 * runs 168 assertions and exits through its OWN summary rather than through a
 * framework error, so no FAILURE_SIGNATURES pattern and no ERROR_NAMES type
 * ever applied — every genuine assertion failure in the suite reported as
 * `unclassified`. The repo's own comments record the cost of this shape: the
 * gate sat red from 2026-07-23 to at least 2026-08-10 because "which suite"
 * without "why" is not something a reader can act on.
 *
 * The fix is the one this repo has already used twice (the Slice 5 drill codes
 * and the PWG_PHASE_* markers): the suite prints its failed check NAMES on
 * their own line, and the gate validates each against an allowlist read from
 * the suite's own source. The names are string literals in that file. The
 * VALUES — which for noConsoleErrors is a live console message — stay on the
 * runner, in the line above it, untouched.
 *
 * What is pinned here is that discipline, not the convenience: a name the
 * allowlist does not know is DROPPED, so no run's output can reach a public
 * summary by pretending to be a check name.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const GATE = path.join(ROOT, 'docs', 'syncview-design', 'tests', 'prod-polish-gate.js');
const SUITE = path.join(ROOT, 'docs', 'syncview-design', 'tests', 'behav-wired.js');
const gateSrc = fs.readFileSync(GATE, 'utf8');
const suiteSrc = fs.readFileSync(SUITE, 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* The gate spawns every suite at import time, so it cannot be required. Slice
   the classifier out and execute it, with an end anchor that must exist. */
const start = gateSrc.indexOf('function behavWiredFailedChecks(');
const end = gateSrc.indexOf('/* Classify WITHOUT quoting.', start);
const fnSrc = start >= 0 && end > start ? gateSrc.slice(start, end) : '';
ok(!!fnSrc, 'the gate classifier is findable (harness is not vacuous)');

const allowlist = new Set();
{
  const re = /\bok\(\s*'([A-Za-z0-9_]+)'/g;
  let match;
  while ((match = re.exec(suiteSrc))) allowlist.add(match[1]);
}
const total = Number((suiteSrc.match(/const TOTAL = (\d+);/) || [])[1]);
ok(allowlist.size > 100, 'the allowlist reads real check names out of the suite (' + allowlist.size + ')');
ok(allowlist.size === total,
  'and covers EVERY check the suite counts (' + allowlist.size + ' names vs TOTAL = ' + total
    + ') — a check the allowlist cannot name is a check that reports as unclassified');

const classify = new Function('BEHAV_WIRED_CHECKS', 'BEHAV_WIRED_NAME_CAP',
  fnSrc + '\nreturn behavWiredFailedChecks;')(allowlist, 5);

const names = [...allowlist];
ok(classify('BEHAV_WIRED_FAILED_CHECKS ' + names[0]) === 'behav_wired:' + names[0],
  'one failed check is named outright');
ok(classify('noise before\nBEHAV_WIRED_FAILED_CHECKS ' + names[0] + ' ' + names[1] + '\nnoise after')
  === 'behav_wired:' + names[0] + '+' + names[1],
  'two are joined, and surrounding suite output is ignored');

const many = names.slice(0, 9);
const capped = classify('BEHAV_WIRED_FAILED_CHECKS ' + many.join(' '));
ok(capped === 'behav_wired:' + many.slice(0, 5).join('+') + '+4more',
  'a wide breakage names the first few and COUNTS the rest — a forty-name line is the same blackout in another shape');

// ---- the discipline: nothing from a run reaches the summary --------------
ok(classify('BEHAV_WIRED_FAILED_CHECKS ClientName Acme_Corp') === '',
  'names the allowlist does not know are dropped entirely, so suite output cannot ride into the summary as a check name');
ok(classify('BEHAV_WIRED_FAILED_CHECKS notARealCheck ' + names[0]) === 'behav_wired:' + names[0],
  'and an unknown name beside a real one is dropped while the real one still reports');
ok(classify('behav-wired crash: TimeoutError') === '',
  'a crash prints no marker and falls through to the existing table, where a timeout is still reported as a timeout');
ok(classify('') === '' && classify(null) === '' && classify('BEHAV_WIRED_FAILED_CHECKS   ') === '',
  'empty, null, and an empty marker all decline to classify rather than emitting a bare prefix');

// ---- and the suite actually prints it ------------------------------------
ok(/console\.error\('BEHAV_WIRED_FAILED_CHECKS ' \+ failed\.map\(\(\[k\]\) => k\)\.join\(' '\)\);/.test(suiteSrc),
  'the suite emits KEYS only — the values, which can quote live console text, stay on the line above it');
ok(suiteSrc.indexOf("behav-wired failures: ") < suiteSrc.indexOf('BEHAV_WIRED_FAILED_CHECKS'),
  'and the full key=value line still prints first, so the private runner log loses nothing');
ok(/behavWiredFailedChecks\(combined\) \|\| classifyFailure\(combined\)/.test(gateSrc),
  'the gate prefers a named check over a generic code, and still falls back to the table');

if (failures) {
  console.error(`\n${failures} gate-naming check(s) failed`);
  process.exit(1);
}
console.log('\nthe heavy lane can name what failed');
