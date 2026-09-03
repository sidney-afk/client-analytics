'use strict';
/*
 * test/calendar-native-status-projection.js
 *
 * The Content Calendar used to learn a deliverable's status by sending it out to
 * Linear and reading it back ~9 minutes later. This suite covers the change that
 * lets it read `deliverables` directly.
 *
 * Two things are worth testing and they are tested differently:
 *
 *   1. THE DECISION is a pure function, so it is run for real -- every branch,
 *      plus a MUTANT run per safety rule that removes the rule and asserts the
 *      harm returns. A guard whose deletion changes no test is not a guard.
 *   2. THE WIRING cannot be run here (the script is a top-level IIFE that would
 *      execute on require, and the loop needs Supabase and Linear). It is held
 *      by source assertions, which are weaker on purpose and say so: they pin
 *      the three couplings whose silent loss would make the change wrong rather
 *      than merely broken.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { extractFunction } = require('./helpers/extract-function.js');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'scripts', 'linear-sync-reconcile.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ok  ' + msg); } else { fail++; console.log('  FAIL ' + msg); } };

function loadDecision(source) {
  const ctx = { module: { exports: {} } };
  vm.createContext(ctx);
  vm.runInContext(extractFunction(source, 'nativeProjectionDecision')
    + '\nmodule.exports = nativeProjectionDecision;', ctx);
  return ctx.module.exports;
}

const decide = loadDecision(SRC);

console.log('\nThe decision — every branch, run for real');
ok(decide('For SMM Approval', 'For SMM Approval', null, null).kind === 'in-sync',
  'card already agrees with the deliverable → nothing to do');
{
  const d = decide('In Progress', 'For SMM Approval', null, null);
  ok(d.kind === 'project' && d.target === 'For SMM Approval',
    'card behind the deliverable → project the deliverable value onto the card');
}
ok(decide('N/A', 'For SMM Approval', null, null).kind === 'na-parked',
  'N/A parks the pair — an SMM parking a component outranks both sides');
ok(decide('n/a', 'Approved', null, null).kind === 'na-parked',
  'and N/A is matched case-insensitively, as the legacy path does');
{
  const d = decide('Tweaks Needed', 'Approved',
    '2026-09-03T12:00:00.000Z', '2026-09-03T11:00:00.000Z');
  ok(d.kind === 'card-ahead',
    'card edited AFTER the deliverable → held, never overwritten');
}
{
  const d = decide('Tweaks Needed', 'Approved',
    '2026-09-03T11:00:00.000Z', '2026-09-03T12:00:00.000Z');
  ok(d.kind === 'project' && d.target === 'Approved',
    'deliverable moved after the card → project it');
}
{
  const d = decide('In Progress', 'Approved', null, '2026-09-03T12:00:00.000Z');
  ok(d.kind === 'project',
    'a card with NO status stamp cannot be proven ahead, so it projects');
}
{
  const d = decide('In Progress', 'Approved', '2026-09-03T12:00:00.000Z', null);
  ok(d.kind === 'project',
    'and neither can one whose deliverable has no stamp — the alternative freezes them forever');
}
{
  const d = decide('Approved', 'Approved',
    '2026-09-03T12:00:00.000Z', '2026-09-03T11:00:00.000Z');
  ok(d.kind === 'in-sync',
    'equality is checked BEFORE the card-ahead hold, so an agreeing pair is never "held"');
}

console.log('\nMutant runs — each safety rule removed, the harm must come back');
{
  // Mutant 1: drop the card-ahead hold.
  const noHold = SRC.replace(
    "  if (cardAtExact && canonicalAt && cardAtExact > canonicalAt) return { kind: 'card-ahead' };",
    '  /* mutant: card-ahead hold removed */');
  ok(noHold !== SRC, 'mutant 1 patched the card-ahead hold');
  const d = loadDecision(noHold)('Tweaks Needed', 'Approved',
    '2026-09-03T12:00:00.000Z', '2026-09-03T11:00:00.000Z');
  ok(d.kind === 'project' && d.target === 'Approved',
    'without the hold a fresh card edit is overwritten by a stale deliverable — the regression');
}
{
  // Mutant 2: drop N/A parking.
  const noPark = SRC.replace(
    "  if (String(cardCal).trim().toUpperCase() === 'N/A') return { kind: 'na-parked' };",
    '  /* mutant: N/A parking removed */');
  ok(noPark !== SRC, 'mutant 2 patched N/A parking');
  ok(loadDecision(noPark)('N/A', 'Approved', null, null).kind === 'project',
    'without it a deliberately parked component is dragged back off N/A');
}

console.log('\nWiring — source assertions, deliberately weaker, pinning three couplings');
ok(/const NATIVE_PROJECTION = !\/\^\(0\|false\|no\|off\)/.test(SRC),
  'the kill switch exists, so a bad run can be reverted without a deploy');
ok(/select=id,status,status_at,origin,team/.test(SRC),
  'the canonical read fetches status_at — without it the card-ahead hold can never fire');
{
  // The whole point of the change: a native projection must NOT require a live
  // outbound mirror. If this coupling comes back, switching Linear off silently
  // freezes the calendar again and every other test here still passes.
  const applyBlock = SRC.slice(SRC.indexOf('const stillValid'), SRC.indexOf('const stillValid') + 500);
  ok(/c\.native\s*\n?\s*\?\s*liveTeamAuthority === 'syncview'/.test(applyBlock),
    'a native correction re-proves SyncView authority ONLY — not outbound liveness');
  ok(/loadOutboundMode\(\)/.test(applyBlock),
    'while the legacy pull-only path still does require the mirror to be live');
}
ok(/nativePush = corrections\.filter\(c => c\.native\)/.test(SRC)
  && /card-ahead \$\{cardAhead\.length\}/.test(SRC),
  'native writes and held cards are both counted in the run summary, not silent');
ok(/const target = c\.target != null \? c\.target : c\.linCal;/.test(SRC),
  'the apply path writes the correction target, so a native value reaches the card');

console.log(`\ncalendar-native-status-projection: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
