'use strict';
/*
 * F50: the native (snake_case) status vocabulary must map onto the calendar's
 * eight, or onto nothing at all — never onto a word the calendar does not know.
 *
 * WHY THIS EXISTS. After the graphics flip the status reaching the card comes
 * from `deliverables.status`, which is snake_case. The reconciler's existing
 * mapper, `_calMapLinearStatusStrict`, was written against Linear's DISPLAY
 * names, and its In-Progress arm tests the string "in progress" WITH A SPACE.
 * Fed `in_progress` it returns null, the caller does `unmapped++; continue`
 * (scripts/linear-sync-reconcile.js), and the card keeps its previous status
 * forever with no error anywhere — F50's own failure mode, on the state a
 * designer enters every time they start work or answer a tweak request.
 * Measured 2026-08-10 by running both functions over both vocabularies.
 *
 * OWNER RULING 2026-08-10, which this file is the executable record of:
 *   todo / backlog  -> "In Progress"  (what the calendar shows today; 37 of
 *                      the 304 card-linked graphics rows sit in `todo`, and
 *                      mapping them to null would blank 37 cards on flip day)
 *   triage / canceled / duplicate -> null (card keeps its previous status)
 * The rule being applied is "add no new words to the calendar": todo/backlog
 * need no new word, the other three would.
 *
 * THE LINE THAT MUST NOT MOVE: never return a string outside CAL_STATUSES.
 * `_writeUiDisplayStatus` emits Backlog/Todo/Canceled/Duplicate, and a card
 * carrying one of those gets an unstyled pill, is skipped by
 * computeOverallStatus (CAL_PRIORITY[unknown] is undefined), can never satisfy
 * _calIsClientReady, and drops out of Kasper's queue — silently.
 */
const path = require('node:path');
const fs = require('node:fs');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// Extract exactly the way scripts/linear-sync-reconcile.js does, so this test
// exercises the same text the reconciler will actually run.
const grabFunc = (name) => {
  const m = SRC.match(new RegExp('^\\s*function ' + name + '\\s*\\([\\s\\S]*?\\n    \\}', 'm'));
  return m ? m[0] : null;
};
const grabConst = (name) => {
  const m = SRC.match(new RegExp('^\\s*const ' + name + '\\s*=.*;\\s*$', 'm'));
  return m ? m[0] : null;
};
const nativeSrc = grabFunc('_calMapNativeStatusStrict');
ok(Boolean(nativeSrc), '_calMapNativeStatusStrict exists and is extractable the way the reconciler extracts');

const mod = new Function(
  [grabConst('CAL_STATUSES'), nativeSrc, grabFunc('_calMapLinearStatusStrict')].join('\n')
  + ';return { CAL_STATUSES, _calMapNativeStatusStrict, _calMapLinearStatusStrict };')();
const map = mod._calMapNativeStatusStrict;
const CAL_STATUSES = mod.CAL_STATUSES;

// --- 1. The regression that motivated this ---------------------------------
ok(mod._calMapLinearStatusStrict('in_progress') === null,
  'the Linear-vocabulary mapper really does return null for in_progress — the defect is real, not hypothetical');
ok(map('in_progress') === 'In Progress',
  'the native mapper handles in_progress, the most common working state');

// --- 2. The owner ruling, exhaustively over all 13 native statuses ---------
const EXPECTED = {
  triage: null,
  backlog: 'In Progress',
  todo: 'In Progress',
  in_progress: 'In Progress',
  smm_approval: 'For SMM Approval',
  kasper_approval: 'Kasper Approval',
  client_approval: 'Client Approval',
  tweak: 'Tweaks Needed',
  approved: 'Approved',
  scheduled: 'Scheduled',
  posted: 'Posted',
  canceled: null,
  duplicate: null,
};
for (const [status, expected] of Object.entries(EXPECTED)) {
  ok(map(status, 'calendar') === expected,
    `calendar: ${status} -> ${JSON.stringify(expected)}`);
}

// --- 3. Never a word the calendar does not know ----------------------------
const legal = new Set(CAL_STATUSES);
const everything = [...Object.keys(EXPECTED), '', null, undefined, 'nonsense',
  'IN_PROGRESS', ' Approved ', 'Backlog', 'in progress'];
for (const value of everything) {
  for (const origin of ['calendar', 'samples']) {
    const out = map(value, origin);
    ok(out === null || legal.has(out),
      `${JSON.stringify(value)} (${origin}) yields null or a legal CAL_STATUSES member, never a new word`);
  }
}
for (const banned of ['Backlog', 'Todo', 'Canceled', 'Duplicate']) {
  ok(!Object.keys(EXPECTED).some(s => map(s) === banned),
    `no native status ever produces "${banned}" — the ghost-pill string _writeUiDisplayStatus emits`);
}

// --- 4. The samples clamp --------------------------------------------------
/* SXR_STATUSES is CAL_STATUSES minus Scheduled/Posted, so a samples row at
 * those states must record nothing rather than be coerced upward — the same
 * choice linear-inbound already makes for its clamped states. */
ok(map('scheduled', 'samples') === null && map('posted', 'samples') === null,
  'samples clamps scheduled/posted to null instead of coercing them to Approved');
ok(map('scheduled', 'calendar') === 'Scheduled' && map('posted', 'calendar') === 'Posted',
  'calendar keeps scheduled/posted');
ok(map('approved', 'samples') === 'Approved',
  'the clamp is narrow — samples still takes every shared status');

// --- 5. Case and whitespace ------------------------------------------------
ok(map(' IN_PROGRESS ') === 'In Progress',
  'input is trimmed and lower-cased, so a stray case or space cannot silently freeze a card');

// --- 6. The gateway replay adopter obeys the same vocabulary ---------------
/* _writeUiAdoptReplayStatus was the one LIVE deliverable→card status
 * projector before the flip, and it used _writeUiDisplayStatus — the table
 * that emits the four ghost strings. Round 1's reviewers flagged it as the
 * projector "the design ignored". It now routes through the strict native
 * mapper, so the replay path and the flip machinery can never disagree about
 * what a native status looks like on a card. */
const grab2 = (name) => {
  const m = SRC.match(new RegExp('^\\s*function ' + name + '\\s*\\([\\s\\S]*?\\n    \\}', 'm'));
  return m ? m[0] : null;
};
const adoptMod = new Function(
  [grab2('_writeUiNativeStatus'), nativeSrc, grab2('_writeUiAdoptReplayStatus')].join('\n')
  + ';return { _writeUiAdoptReplayStatus };')();
const adopt = adoptMod._writeUiAdoptReplayStatus;
const ack = (status) => ({ row: { status } });

const cancelCase = { graphic_status: 'Client Approval' };
ok(adopt(cancelCase, 'graphic', ack('canceled'), true, 'calendar') === ''
  && cancelCase.graphic_status === 'Client Approval',
'replay of a canceled deliverable leaves the card exactly as it was (previously wrote the ghost string "Canceled")');
const backlogCase = { graphic_status: '' };
ok(adopt(backlogCase, 'graphic', ack('backlog'), true, 'calendar') === 'In Progress'
  && backlogCase.graphic_status === 'In Progress',
'replay of a backlog deliverable shows In Progress (previously wrote the ghost string "Backlog")');
const settled = { graphic_status: 'In Progress' };
ok(adopt(settled, 'graphic', ack('todo'), true, 'calendar') === '',
  'a card already showing the mapped value is not re-saved, even though the native statuses differ');
const sxrSched = { graphic_status: 'Approved' };
ok(adopt(sxrSched, 'graphic', ack('scheduled'), true, 'samples') === ''
  && sxrSched.graphic_status === 'Approved',
'the samples funnel clamps scheduled — the row keeps its status rather than gaining a word SXR does not know');
ok(!/_writeUiDisplayStatus\(nativeStatus\)/.test(grab2('_writeUiAdoptReplayStatus')),
  'the adopter no longer consults the display table that emits ghost strings');

if (failures) {
  console.error(`\n${failures} F50 native status map check(s) failed`);
  process.exit(1);
}
console.log('\nF50 native status map checks passed');
