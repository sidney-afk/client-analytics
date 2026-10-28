'use strict';
/*
 * TRIAL REELS: THE RULES THE PROBE FOUND OPEN (session Probe, 2026-10-27), on supabase/functions/trial-reels/logic.mjs.
 * Each check states what the plan (docs/features/TRIAL_REELS_PLAN.md) asks for; a failing check is a finding sent to
 * session Trials, listed in docs/features/trial-reels/OVERNIGHT_PROBE_2026-10-27.md. Fictional data only.
 */
const path = require('path');

const failures = [];
let passed = 0;
function ok(c, m) { if (!c) { failures.push(m); console.error('FAIL  ' + m); } else { passed++; console.log('  ok  ' + m); } }
const NOW = '2026-10-27T10:00:00.000Z';
const LINK = l => 'https://f.io/fixture-probe-' + l.toLowerCase();

(async () => {
  const L = await import(path.join(__dirname, '..', 'supabase', 'functions', 'trial-reels', 'logic.mjs'));
  const mk = over => ['A', 'B', 'C'].map(l => Object.assign({ id: 'v' + l, letter: l, status: 'waiting', frame_url: LINK(l), revision: 0,
    smm_ok_at: null, kasper_ok_at: null, client_ok_at: null }, (over || {})[l] || {}));
  const both = { smm_ok_at: NOW, kasper_ok_at: NOW };

  // Bug 1: a version with a change asked goes the normal route again (Q3); the client cannot approve it as it stands.
  let r = L.answerPatches(mk({ A: both, B: both, C: Object.assign({ status: 'change asked', change_by: 'client', change_note: 'n' }, both) }),
    { stage: 'client', kind: 'approve', letter: 'C' }, NOW);
  ok(!!r.error, 'bug 1: the client cannot approve a version that has a change asked (' + JSON.stringify(r) + ')');

  // Bug 2: stage order: the client answers only versions Kasper has OK'd; Kasper only versions the SMM has OK'd.
  r = L.answerPatches(mk(), { stage: 'client', kind: 'approve_all' }, NOW);
  ok(!r.error && r.patches.length === 0, 'bug 2: client Approve all skips versions Kasper has not OK\'d (' + (r.patches || []).map(p => p.letter).join(',') + ')');
  r = L.answerPatches(mk(), { stage: 'client', kind: 'approve', letter: 'B' }, NOW);
  ok(!!r.error, 'bug 2: client approve of a version Kasper has not OK\'d is refused (' + JSON.stringify(r) + ')');
  r = L.answerPatches(mk(), { stage: 'kasper', kind: 'approve', letter: 'B' }, NOW);
  ok(!!r.error, 'bug 2: Kasper\'s approve of a version the SMM has not OK\'d is refused (' + JSON.stringify(r) + ')');
  r = L.answerPatches(mk({ A: both, B: both, C: both }), { stage: 'client', kind: 'approve_all' }, NOW);
  ok(!r.error && r.patches.length === 3, 'bug 2 (no regression): versions both have OK\'d are all approved by the client');

  // Bug 3: no OK on a version with no link (nobody watched it).
  r = L.answerPatches(mk({ B: { frame_url: null } }), { stage: 'smm', kind: 'approve_all' }, NOW);
  ok(!r.error && r.patches.map(p => p.letter).join(',') === 'A,C', 'bug 3: Approve all skips a version with no link (' + (r.patches || []).map(p => p.letter).join(',') + ')');
  r = L.answerPatches(mk({ B: { frame_url: null } }), { stage: 'smm', kind: 'approve', letter: 'B' }, NOW);
  ok(!!r.error, 'bug 3: approving a version with no link is refused (' + JSON.stringify(r) + ')');

  // Bug 4: a new link on a version someone already OK'd starts it again (plan section 2, revision).
  r = L.linkPatch(mk({ B: { status: 'approved', smm_ok_at: NOW, kasper_ok_at: NOW, client_ok_at: NOW } }), 'B', 'https://f.io/fixture-probe-new', LINK('A'));
  ok(!r.error && r.patch && r.patch.status === 'waiting' && r.patch.client_ok_at === null && r.patch.revision === 1, 'bug 4: a new link on an approved version restarts it (' + JSON.stringify(r) + ')');
  r = L.linkPatch(mk({ B: { smm_ok_at: NOW } }), 'B', 'https://f.io/fixture-probe-new', LINK('A'));
  ok(!r.error && r.patch && r.patch.smm_ok_at === null, 'bug 4: a new link on a version the SMM OK\'d clears that OK (' + JSON.stringify(r) + ')');
  r = L.linkPatch(mk({ B: { frame_url: null } }), 'B', LINK('B'), LINK('A'));
  ok(!r.error && r.patch && !('status' in r.patch), 'bug 4 (no regression): a first paste on a waiting version changes only its link');

  console.log(`trial-reels-probe-logic: ${passed} checks passed` + (failures.length ? `, ${failures.length} FAILED` : ''));
  process.exit(failures.length ? 1 : 0);
})();
