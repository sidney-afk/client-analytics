'use strict';
/*
 * Native-intake reliability: Submit root intake, append and component fill,
 * driven through the REAL persistence contracts, the REAL production-write
 * handler and the REAL browser job machinery, with faults injected at each
 * boundary (provider unreachable, response lost after commit, duplicate and
 * simultaneous submissions, storage loss, card write failure, repeated
 * recovery failure, actor and client switches).
 *
 * The lanes live in scripts/native-intake-reliability/ and are imported here,
 * not copied. Two kinds of check come back:
 *
 *   CURRENT   what the code does today. A red one is a regression, or a
 *             harness that has drifted from the product, and fails this suite.
 *   READINESS what the Linear-exit gates G2/G3 (PR #1268 at c1aa4d9) require.
 *             These are EXPECTED RED until the change mapped to each one in
 *             docs/audits/2026-09-05-native-intake-reliability-handoff.md ships.
 *             They fail this suite only under NATIVE_INTAKE_READINESS_STRICT=1,
 *             which is how a release candidate is held to the gate.
 *
 * The committed results document is checked against the live run: every
 * check id it lists must exist, and its recorded verdict must match. A change
 * that flips a verdict has to regenerate the document (run.js --write-results)
 * so the handoff never quotes evidence the code no longer produces.
 *
 * The database lanes need PostgreSQL 16 (initdb/psql, or PGHOST). They skip
 * where it is absent and are REQUIRED under F63_REQUIRE_POSTGRES=1, which the
 * unit CI job sets, so a missing lane in CI is a failure rather than a skip.
 */
const fs = require('fs');
const { run, printSummary, RESULTS } = require('../scripts/native-intake-reliability/run.js');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

(async () => {
  const report = await run({ writeResults: false });
  printSummary(report);
  console.log('');

  const current = report.checks.filter(c => c.kind === 'current');
  const readiness = report.checks.filter(c => c.kind === 'readiness');
  ok(current.length >= 40, 'the proof exercises the intake paths broadly (' + current.length + ' current-behavior checks)');
  for (const c of current.filter(c => !c.pass)) ok(false, 'current: ' + c.id + ' : ' + JSON.stringify(c.evidence));
  ok(current.every(c => c.pass), 'every current-behavior check passes (' + current.filter(c => c.pass).length + '/' + current.length + ')');

  const strict = process.env.NATIVE_INTAKE_READINESS_STRICT === '1';
  const redReadiness = readiness.filter(c => !c.pass);
  if (strict) {
    for (const c of redReadiness) ok(false, 'readiness (strict): ' + c.id + ' : ' + c.label);
    ok(redReadiness.length === 0, 'strict readiness: every G2/G3 requirement is green');
  } else {
    ok(readiness.length >= 8, 'readiness gates are asserted, not assumed (' + readiness.length + ' checks, ' + redReadiness.length + ' red, held red on purpose)');
    for (const c of redReadiness) console.log('  red  readiness ' + c.id + ' : ' + c.label);
  }

  // The committed evidence must be what the code produces now.
  if (fs.existsSync(RESULTS) && report.lanes.sql === 'executed') {
    const committed = JSON.parse(fs.readFileSync(RESULTS, 'utf8'));
    const live = new Map(report.checks.map(c => [c.id, c.pass]));
    const missing = committed.checks.filter(c => !live.has(c.id)).map(c => c.id);
    const flipped = committed.checks.filter(c => live.has(c.id) && live.get(c.id) !== c.pass).map(c => c.id);
    const extra = report.checks.filter(c => !committed.checks.some(k => k.id === c.id)).map(c => c.id);
    ok(missing.length === 0, 'every committed check id still runs' + (missing.length ? ' (missing: ' + missing.join(', ') + ')' : ''));
    ok(flipped.length === 0, 'no committed verdict has flipped' + (flipped.length ? ' (regenerate with run.js --write-results: ' + flipped.join(', ') + ')' : ''));
    ok(extra.length === 0, 'no check runs that the committed document does not record' + (extra.length ? ' (' + extra.join(', ') + ')' : ''));
  } else if (fs.existsSync(RESULTS)) {
    console.log('  :  committed results not cross-checked: database lanes skipped here');
  }

  console.log(failures ? '\n' + failures + ' native-intake reliability check(s) failed' : '\nnative-intake reliability suite passed');
  process.exit(failures ? 1 : 0);
})().catch(error => {
  console.error('FAIL  native-intake reliability harness: ' + (error && error.stack || error));
  process.exit(1);
});
