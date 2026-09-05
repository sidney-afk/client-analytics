'use strict';

/*
 * The alarm half of the assurance ledger.
 *
 * `test/assurance-ledger-freshness.js` judges every claim as of the date its
 * author stamped on it. That is the right rule for a test -- it catches an
 * overstatement the moment somebody writes one, and a file nobody touches can
 * never spontaneously turn the suite red. It is the wrong rule for an alarm,
 * because the failure an alarm exists to catch is exactly the one that arrives
 * with nobody touching the file: a row that was honestly FRESH when it was
 * written and has since rotted.
 *
 * So `stalenessReport` runs the SAME predicate against TODAY, and this suite
 * pins the two properties that make it worth having:
 *
 *   1. It is GREEN on the day it ships. 15 of 19 rows are past their window
 *      right now and every one of them already SAYS so. A gate that ships
 *      permanently red is what docs/ops/PRE_FLIP_HEALTH_CHECK.md opens by
 *      blaming for teaching a team to discount its own gates.
 *   2. It fails CLOSED. A missing stamp, a table that stopped parsing, a row
 *      with no readable date -- each is an incident, not a pass. An alarm whose
 *      most likely bug is silence is not an alarm.
 *
 * Everything here executes the real function out of the shipped script; the
 * CLI cases spawn the real file, so the exit code the workflow depends on is
 * the thing under test rather than a description of it.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const {
  STAMP_MAX_AGE_DAYS,
  gateLines,
  parseDay,
  stalenessReport,
} = require('../scripts/assurance-ledger-freshness.js');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'assurance-ledger-freshness.js');
const LEDGER = path.join(__dirname, '..', 'docs', 'testing', 'ASSURANCE_LEDGER.md');
const REAL = fs.readFileSync(LEDGER, 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('PASS:', message);
  else { failures++; console.error('FAIL assurance-ledger-staleness:', message); }
}

// A ledger in the real file's shape, small enough to reason about by hand.
function ledger({ stamp = '2026-08-22', rows = [], header = true } = {}) {
  const head = header ? '# Assurance ledger\n\n> Last refreshed: 2026-07-20\n\n' : '# Assurance ledger\n\n';
  const byTier = new Map();
  for (const row of rows) {
    if (!byTier.has(row.tier)) byTier.set(row.tier, []);
    byTier.get(row.tier).push(row);
  }
  let out = head;
  for (const [tier, tierRows] of [...byTier.entries()].sort((a, b) => a[0] - b[0])) {
    out += '## Tier ' + tier + ' — fixture\n\n';
    out += '| Surface | Last proven | How | Where | Gaps | State (' + stamp + ') | Score |\n';
    out += '| --- | --- | --- | --- | --- | --- | --- |\n';
    for (const row of tierRows) {
      out += '| ' + row.surface + ' | ' + row.proven + ' | run | here | none | ' + row.state + ' | 5 |\n';
    }
    out += '\n';
  }
  return out;
}

// --- 1. green on the ledger as it actually stands ----------------------------
const today = parseDay('2026-08-23');
const live = stalenessReport(REAL, today);
ok(live.ok === true,
  'the real ledger is green today — 15 of 19 rows are past their window and all 15 already say so'
    + (live.ok ? '' : ' — ' + live.reason + ': ' + gateLines(live).join(' / ')));
ok(live.total_rows >= 15, 'and it parsed the real tier tables rather than finding nothing (' + live.total_rows + ' rows)');
ok(live.stated_as_of === '2026-08-22', 'anchored to the State column stamp, not the header refresh stamp');

// --- 2. the failure it exists to catch: a claim that has stopped being true ---
// A Tier 0 row (7d) written FRESH when it was 2 days old, read 20 days later.
const rotted = ledger({ rows: [{ tier: 0, surface: 'client review links', proven: '2026-08-20', state: 'FRESH' }] });
ok(stalenessReport(rotted, parseDay('2026-08-22')).ok === true,
  'a row written FRESH two days after its proof is fine on the day it is written');
const lapsed = stalenessReport(rotted, parseDay('2026-09-11'));
ok(lapsed.ok === false && lapsed.reason === 'rows_lapsed',
  'and lapses once the window closes without a new proof — with nobody touching the file');
ok(lapsed.lapsed.length === 1 && lapsed.lapsed[0].claimed === 'FRESH' && lapsed.lapsed[0].computed === 'EXPIRED',
  'the report names the claim that stopped being true, not just a count');
ok(lapsed.counts[0] === 1, 'and counts the lapse against its tier');

// --- 3. the pessimism that must NOT page --------------------------------------
// This is the whole reason the gate ships green: a row that already admits it
// is expired is not news, however old it gets.
const admitted = ledger({ rows: [{ tier: 0, surface: 'client review links', proven: '2026-06-01', state: 'EXPIRED' }] });
ok(stalenessReport(admitted, parseDay('2026-08-23')).ok === true,
  'a row 83 days past a 7-day window does not page while it says EXPIRED — it is recorded, not news');
const yearOn = stalenessReport(admitted, parseDay('2027-08-23'));
ok(!yearOn.reason.includes('rows_lapsed'),
  'and it never lapses however old it gets; what is written down does not become news by ageing');
ok(yearOn.reason === 'stamp_unrefreshed',
  'a year on, the only thing left to say is that nobody has restated it — which is the other clause, not this one');

// --- 4. the anti-silence backstop ---------------------------------------------
// Restating everything to EXPIRED is legal and is what happened on 2026-08-22.
// It leaves nothing left to lapse, so without this clause the alarm would be
// permanently, honestly silent over a ledger that proves nothing.
const allAdmitted = ledger({
  stamp: '2026-08-22',
  rows: [
    { tier: 0, surface: 'a', proven: '2026-06-01', state: 'EXPIRED' },
    { tier: 3, surface: 'b', proven: '2026-06-01', state: 'EXPIRED' },
  ],
});
ok(stalenessReport(allAdmitted, parseDay('2026-10-20')).ok === true,
  'a fully-pessimistic ledger is quiet while somebody is still restating it');
const abandoned = stalenessReport(allAdmitted, parseDay('2026-10-23'));
ok(abandoned.ok === false && abandoned.reason === 'stamp_unrefreshed',
  'and pages once nothing has been restated or re-proven for ' + STAMP_MAX_AGE_DAYS + ' days');
ok(abandoned.stamp_age_days === 62, 'the report carries how long the silence has run');

// --- 5. fails CLOSED on every way the file can stop being readable ------------
const noStamp = stalenessReport('# Assurance ledger\n\nno tables here\n', today);
ok(noStamp.ok === false && noStamp.reason === 'no_state_stamp',
  'a ledger with no State stamp is an incident, not a pass');
const noRows = '# L\n\n> Last refreshed: 2026-08-01\n\n## Tier 0 — x\n\n| Surface | Last proven | State (2026-08-22) |\n| --- | --- | --- |\n| a | 2026-08-20 | FRESH |\n';
const noRowsReport = stalenessReport(noRows, today);
ok(noRowsReport.ok === false && noRowsReport.reason === 'no_rows_parsed',
  'a table that narrowed until no row parses is an incident, not a pass');
const undated = ledger({ rows: [{ tier: 0, surface: 'a', proven: 'never', state: 'FRESH' }] });
const undatedReport = stalenessReport(undated, today);
ok(undatedReport.ok === false && undatedReport.reason === 'unjudgeable_rows',
  'a row with no readable proof date is an incident, not a pass');

// --- 6. the exit code the workflow actually depends on -------------------------
function runGate(markdown, asOf) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-gate-'));
  const file = path.join(directory, 'LEDGER.md');
  try {
    fs.writeFileSync(file, markdown);
    return spawnSync(process.execPath, [SCRIPT, '--gate', '--ledger=' + file, '--as-of=' + asOf], { encoding: 'utf8' });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
const greenRun = runGate(REAL, '2026-08-23');
ok(greenRun.status === 0, 'the CLI gate exits 0 on the real ledger today');
const redRun = runGate(rotted, '2026-09-11');
ok(redRun.status === 1, 'and exits 1 on a lapsed claim — the workflow reads this, not the text');
ok(/FRESH -> EXPIRED/.test(redRun.stdout), 'and says which claim stopped being true');
ok(/Re-prove the surface, or restate the row/.test(redRun.stdout),
  'and names both ways out, because a gate with no cheap honest exit gets ignored');

// The default report must stay exit-0 forever: printing the arithmetic can never
// become something a person avoids doing.
const report = spawnSync(process.execPath, [SCRIPT, '--as-of=2026-08-23'], { encoding: 'utf8' });
ok(report.status === 0, 'the plain report still never fails, 15 expired rows and all');

process.exit(failures ? 1 : 0);
