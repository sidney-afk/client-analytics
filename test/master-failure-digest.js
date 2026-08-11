'use strict';
/*
 * A failing lane must report WHICH path failed and WHY.
 *
 * WHAT THIS FIXES. `qa/master.js` reported a failing scenario lane with
 * `tail(out, 25)` — the last 25 lines of the runner's output. But
 * `qa/probes/run_scenarios.js` prints one line per path AS IT RUNS and puts a
 * failing path's assertion detail immediately beneath that path's own line. So
 * the diagnosis lands wherever the failing path fell in the run order, while a
 * positional tail only ever keeps the END of the run.
 *
 * MEASURED, not hypothesised. The samples-e2e nightly was red 27 consecutive
 * nights. Run 31468417739 reported "tree paths 23/24 fully green · assertions
 * 200/210" and then listed 19 [PASS] lines — the five video client-approval
 * paths, one of which held the only failure, were the FIRST five lines the
 * runner printed and so the first five the tail discarded. Four weeks of a
 * report that named every path except the broken one. Arithmetic confirms the
 * five ran: printed paths carry 150 assertions, the summary counts 210, and the
 * graphic client subtree (the video subtree's twin) is exactly 60.
 *
 * THE LINE THAT MUST NOT MOVE: select failure output by MEANING, never by
 * position. A report that cannot name its own failure is worse than no report —
 * it looks like diligence while withholding the one fact needed to act, which
 * is the alarm-fatigue failure the 2026-08-04 monitoring work exists to prevent.
 */
const path = require('node:path');
const fs = require('node:fs');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'qa', 'master.js'), 'utf8');

// --- 1. Both scenario lanes use the digest, not a positional tail ----------
const laneBodies = [...source.matchAll(/function lane(Scenarios|Tree)\(cfg\)[\s\S]*?\n\}/g)].map(m => m[0]);
ok(laneBodies.length === 2, 'both scenario-shaped lanes are extractable');
for (const body of laneBodies) {
  const name = (body.match(/function (lane\w+)/) || [])[1];
  ok(/failureDigest\(r\.out\)/.test(body), `${name} reports through failureDigest`);
  ok(!/tail\(r\.out, 25\)/.test(body), `${name} no longer reports a positional tail`);
}

// --- 2. The digest actually recovers a first-line failure -----------------
/* Reconstructed in the shape run_scenarios.js emits (probes/run_scenarios.js:31-35):
 * the failing path first, its ✗ detail directly beneath, then many passes. */
const digestSource = source.slice(source.indexOf('function failureDigest'));
const digestBody = digestSource.slice(0, digestSource.indexOf('\n}\n') + 3);
// eslint-disable-next-line no-new-func
const failureDigest = new Function(
  'function tail(s, n = 18) { return (s || "").split("\\n").slice(-n).join("\\n"); }\n'
  + digestBody + '\nreturn failureDigest;')();

const runnerOutput = [
  '[FAIL] video__smm_approve__kasper_approve__client_request__resolve_kasper 2/12  (51s)',
  '        ✗ expect video_status = Kasper Approval  [got Client Approval]',
  '        ✗ expectComment video done  [no done marker]',
  ...Array.from({ length: 23 }, (_, index) => `[PASS] path_${index} 6/6  (40s)`),
  '',
  '================ SUMMARY ================',
  'scenarios: 23/24 fully green',
  'assertions: 200/210 passed',
].join('\n');

const digest = failureDigest(runnerOutput);
ok(digest.includes('client_request__resolve_kasper'),
  'the failing path is named even though it printed FIRST and 23 passes followed');
ok(digest.includes('got Client Approval'),
  'the failing assertion detail survives — the actual diagnosis, not just the name');
ok(digest.includes('assertions: 200/210 passed'),
  'the summary block is still included');
ok(!/path_\d+/.test(digest),
  'passing paths are excluded, so the digest cannot push the failure out of view');

// Prove the OLD behaviour really did lose it — otherwise this test proves nothing.
const positional = runnerOutput.split('\n').slice(-25).join('\n');
ok(!positional.includes('client_request__resolve_kasper'),
  'the positional tail genuinely DID lose that failure — the defect is real, not theoretical');

// --- 3. Degradation cases --------------------------------------------------
ok(failureDigest('') === '', 'empty output yields empty, not a crash');
const crash = 'RUNNER ERROR: something exploded\n  at foo (bar.js:1:1)';
ok(failureDigest(crash).includes('RUNNER ERROR'),
  'output with no [FAIL] lines (a crash) still reports, via the tail fallback');
const manyFailures = Array.from({ length: 200 }, (_, index) =>
  `[FAIL] p${index} 0/1  (1s)\n        ✗ boom ${index}`).join('\n');
ok(failureDigest(manyFailures).split('\n').length <= 60,
  'a mass failure is capped rather than dumping an unbounded wall of text');

if (failures) {
  console.error(`\n${failures} master failure-digest check(s) failed`);
  process.exit(1);
}
console.log('\nmaster failure-digest checks passed');
