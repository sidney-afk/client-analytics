'use strict';
/*
 * Samples (Review) — REVIEW STATE MACHINE (M3b) unit suite.
 *
 * Run:  node test/samples-review-machine.js   (exit 0 = all good)
 *
 * It brace-extracts the REAL shipping functions from ../index.html (by NAME,
 * brace-balanced — robust to line shifts) so we test the ACTUAL code, not a
 * paraphrase: computeSampleOverallStatus, _sxrApplyAutoStatus,
 * _sxrClearStaleApprovals (+ the helpers they call). It asserts the four
 * SAMPLES_V2_PLAN.md §8.2 / §10 invariants:
 *   (1) overall = WORST-OF over EXACTLY video+graphic (no caption/title path);
 *   (2) NO caption/title is reachable in the status math;
 *   (3) stale-clear fires when a sub drops below Client Approval;
 *   (4) terminal = Approved (no Scheduled/Posted short-circuit).
 * It also exercises _sxrApplyAutoStatus's client_added / smm_resolved_last flips
 * against the real code, and proves the shipped SXR_COMPONENTS is the frozen
 * 2-component set.
 */
const fs = require('fs');
const path = require('path');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const c = INDEX[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unbalanced braces: ' + name);
}
function grabConst(name) {
  const re = new RegExp('^\\s*const ' + name + '\\s*=.*;\\s*$', 'm');
  const m = INDEX.match(re);
  if (!m) throw new Error('const not found: ' + name);
  return m[0];
}

// ---- Real code extracted verbatim from index.html (by name) ----
// CAL_* (status vocab) are SHARED/reused by the samples math (pure string logic).
const REAL = [
  grabConst('CAL_STATUSES'), grabConst('CAL_PRIORITY'),
  grabConst('SXR_COMPONENTS'),
  grabFunc('_calNormStatus'),
  grabFunc('computeSampleOverallStatus'),
  grabFunc('_sxrClearStaleApprovals'),
  grabFunc('_sxrRecordKasperSeen'),
  grabFunc('_sxrApplySubStatus'),
  grabFunc('_sxrApplyAutoStatus'),
  grabFunc('_sxrParseComments'),
  grabFunc('_sxrCommentsFor'),
].join('\n\n');

// Stubs for globals the extracted code touches but we model here. sxrState +
// _sxrPendingEdits give _sxrFind / _sxrApplySubStatus a real row to mutate.
const STUBS = `
const sxrState = { cards: [] };
const _sxrPendingEdits = Object.create(null);
function _sxrFind(pid){ return (sxrState.cards||[]).find(c => String(c.id) === String(pid)); }
`;

const mod = new Function(STUBS + '\n' + REAL + `
;return { CAL_STATUSES, CAL_PRIORITY, SXR_COMPONENTS, _calNormStatus,
  computeSampleOverallStatus, _sxrClearStaleApprovals, _sxrApplyAutoStatus,
  sxrState, _sxrPendingEdits, _sxrFind };`)();

const {
  CAL_PRIORITY, SXR_COMPONENTS, _calNormStatus, computeSampleOverallStatus,
  _sxrClearStaleApprovals, _sxrApplyAutoStatus, sxrState, _sxrPendingEdits, _sxrFind,
} = mod;

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg + (extra !== undefined ? '  -> ' + extra : '')); }
}
function eq(got, want, msg) { ok(got === want, msg, 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); }

console.log('\n— SXR_COMPONENTS is the frozen 2-component set —');
eq(JSON.stringify(SXR_COMPONENTS), JSON.stringify(['video', 'graphic']), 'SXR_COMPONENTS === [video, graphic]');
ok(!SXR_COMPONENTS.includes('caption') && !SXR_COMPONENTS.includes('title'), 'no caption / title component');

console.log('\n— (1) overall = WORST-OF over EXACTLY video+graphic —');
eq(computeSampleOverallStatus({ video_status: 'Approved', graphic_status: 'Approved' }), 'Approved', 'both Approved → Approved');
eq(computeSampleOverallStatus({ video_status: 'Approved', graphic_status: 'In Progress' }), 'In Progress', 'one In Progress drags overall down');
eq(computeSampleOverallStatus({ video_status: 'Client Approval', graphic_status: 'Kasper Approval' }), 'Kasper Approval', 'worst-of picks Kasper Approval');
eq(computeSampleOverallStatus({ video_status: 'Approved', graphic_status: 'Tweaks Needed' }), 'Tweaks Needed', 'one Tweaks Needed forces Tweaks Needed (lowest priority)');
eq(computeSampleOverallStatus({}), 'In Progress', 'empty subs default to In Progress');
// Worst-of is exactly CAL_PRIORITY-min: Tweaks Needed(0) < In Progress(1) < ... < Approved(5).
ok(CAL_PRIORITY['Tweaks Needed'] < CAL_PRIORITY['In Progress'], 'Tweaks Needed is the lowest priority');

console.log('\n— (2) NO caption/title path is reachable in the status math —');
// A caption/title sub-status present on the row must NOT influence overall.
eq(computeSampleOverallStatus({ video_status: 'Approved', graphic_status: 'Approved', caption_status: 'In Progress', title_status: 'Tweaks Needed' }),
  'Approved', 'caption_status / title_status are IGNORED by computeSampleOverallStatus');
ok(!/caption|title/.test(grabFunc('computeSampleOverallStatus')), 'computeSampleOverallStatus source contains no caption/title');
ok(!/caption|title/.test(grabFunc('_sxrClearStaleApprovals')), '_sxrClearStaleApprovals source contains no caption/title');
ok(!/caption|title/.test(grabFunc('_sxrApplyAutoStatus')), '_sxrApplyAutoStatus source contains no caption/title');

console.log('\n— (3) stale-clear fires when a sub drops below Client Approval —');
// video was client-approved, now dropped to Tweaks Needed → its stamp clears.
(() => {
  const sample = { id: 's1', video_status: 'Tweaks Needed', graphic_status: 'Approved',
    client_video_approved_at: '2026-06-01T00:00:00.000Z', client_graphic_approved_at: '2026-06-02T00:00:00.000Z',
    kasper_approved_at: '2026-06-01T00:00:00.000Z' };
  const pending = {};
  _sxrClearStaleApprovals(sample, pending);
  eq(sample.client_video_approved_at, '', 'dropped video clears client_video_approved_at');
  eq(pending.client_video_approved_at, '', 'cleared video stamp queued for the next flush');
  eq(sample.client_graphic_approved_at, '2026-06-02T00:00:00.000Z', 'graphic still ≥ Client Approval → its stamp survives');
  eq(sample.kasper_approved_at, '2026-06-01T00:00:00.000Z', 'graphic at Approved keeps kasper_approved_at (something still ≥ Client Approval)');
})();
// nothing at/above Client Approval → kasper_approved_at clears too.
(() => {
  const sample = { id: 's2', video_status: 'Kasper Approval', graphic_status: 'Tweaks Needed',
    client_video_approved_at: '2026-06-01T00:00:00.000Z', kasper_approved_at: '2026-06-01T00:00:00.000Z' };
  const pending = {};
  _sxrClearStaleApprovals(sample, pending);
  eq(sample.kasper_approved_at, '', 'no sub ≥ Client Approval → kasper_approved_at clears');
  eq(pending.kasper_approved_at, '', 'cleared kasper stamp queued');
})();
// a sub still ≥ Client Approval keeps its stamp.
(() => {
  const sample = { id: 's3', video_status: 'Client Approval', graphic_status: 'In Progress',
    client_video_approved_at: '2026-06-01T00:00:00.000Z' };
  _sxrClearStaleApprovals(sample, {});
  eq(sample.client_video_approved_at, '2026-06-01T00:00:00.000Z', 'a sub AT Client Approval keeps its client stamp');
})();

console.log('\n— (4) terminal = Approved (no Scheduled/Posted short-circuit) —');
ok(computeSampleOverallStatus({ video_status: 'Approved', graphic_status: 'Approved' }) === 'Approved',
  'the highest reachable overall is Approved');
// The stale-clear "above" set is {Client Approval, Approved} only.
(() => {
  const sample = { id: 's4', video_status: 'Approved', graphic_status: 'Approved',
    client_video_approved_at: 'x', client_graphic_approved_at: 'y', kasper_approved_at: 'z' };
  _sxrClearStaleApprovals(sample, {});
  ok(sample.client_video_approved_at === 'x' && sample.kasper_approved_at === 'z',
    'Approved is treated as "above" → stamps survive at terminal');
})();
ok(!/Scheduled|Posted/.test(grabFunc('_sxrClearStaleApprovals')), '_sxrClearStaleApprovals has no Scheduled/Posted in its "above" set');
ok(!/Scheduled|Posted/.test(grabFunc('_sxrApplyAutoStatus')), '_sxrApplyAutoStatus has no Scheduled/Posted short-circuit');

console.log('\n— _sxrApplyAutoStatus: real flips against the extracted code —');
(() => {
  sxrState.cards = [{ id: 'a1', video_status: 'Client Approval', graphic_status: 'Client Approval',
    client_video_approved_at: '2026-06-01T00:00:00.000Z', status: 'Client Approval' }];
  Object.keys(_sxrPendingEdits).forEach(k => delete _sxrPendingEdits[k]);
  const changed = _sxrApplyAutoStatus('a1', 'client_added', 'video');
  const row = _sxrFind('a1');
  ok(changed === true, 'client_added flips a non-TN component to Tweaks Needed (returns true)');
  eq(row.video_status, 'Tweaks Needed', 'video → Tweaks Needed');
  eq(row.status, 'Tweaks Needed', 'overall recomputed to Tweaks Needed (worst-of)');
  eq(row.client_video_approved_at, '', 'stale client stamp cleared by the same transition');
  eq(_sxrPendingEdits['a1'] && _sxrPendingEdits['a1'].video_status, 'Tweaks Needed', 'patch queued (field-level) for video_status');
})();
(() => {
  sxrState.cards = [{ id: 'a2', video_status: 'Tweaks Needed', graphic_status: 'Approved', status: 'Tweaks Needed' }];
  Object.keys(_sxrPendingEdits).forEach(k => delete _sxrPendingEdits[k]);
  const changed = _sxrApplyAutoStatus('a2', 'smm_resolved_last', 'video', 'kasper');
  const row = _sxrFind('a2');
  ok(changed === true, 'smm_resolved_last → kasper routes the component to Kasper Approval');
  eq(row.video_status, 'Kasper Approval', 'video → Kasper Approval');
  ok(String(row.kasper_seen || '').split(',').includes('video'), 'routing to Kasper records kasper_seen=video (cross-device)');
})();
(() => {
  sxrState.cards = [{ id: 'a3', video_status: 'Tweaks Needed', graphic_status: 'Approved', status: 'Tweaks Needed' }];
  Object.keys(_sxrPendingEdits).forEach(k => delete _sxrPendingEdits[k]);
  _sxrApplyAutoStatus('a3', 'smm_resolved_last', 'video', 'approved');
  eq(_sxrFind('a3').video_status, 'Approved', 'smm_resolved_last → approved routes straight to Approved (skips re-reviews)');
})();
(() => {
  sxrState.cards = [{ id: 'a4', video_status: 'Tweaks Needed', graphic_status: 'Tweaks Needed', status: 'Tweaks Needed' }];
  Object.keys(_sxrPendingEdits).forEach(k => delete _sxrPendingEdits[k]);
  const changed = _sxrApplyAutoStatus('a4', 'client_added', 'video');
  ok(changed === false, 'a component already at Tweaks Needed is a no-op for client_added (idempotent)');
})();

console.log('\n— SHIPPED CODE: the M3b handlers exist and carry the guards —');
function has(re, label) { ok(re.test(INDEX), label); }
has(/function _sxrKasperApproveComp\(/, '_sxrKasperApproveComp defined');
has(/function _sxrKasperRequestTweakComp\(/, '_sxrKasperRequestTweakComp defined');
has(/function _sxrKasperApproveAfterTweaksComp\(/, '_sxrKasperApproveAfterTweaksComp defined');
has(/function _sxrKasperUndoApprove\(/, '_sxrKasperUndoApprove defined');
has(/function _sxrKasperFinish\(/, '_sxrKasperFinish defined');
has(/function _sxrKasperClose\(/, '_sxrKasperClose defined');
has(/function _sxrClientApproveComp\(/, '_sxrClientApproveComp defined');
has(/function _sxrClientRequestTweakComp\(/, '_sxrClientRequestTweakComp defined');
has(/function _sxrShowResolveDest\(/, '_sxrShowResolveDest (resolve chooser) defined');
has(/function _sxrResolveLastTweak\(/, '_sxrResolveLastTweak defined');
// in-flight idempotency guard
has(/const _sxrReviewInFlight = Object\.create\(null\)/, 'review handlers share an in-flight idempotency guard');
// client surface guard (732b2b4): a client may act only at Client Approval / Tweaks Needed
ok(/_sxrClientApproveComp[\s\S]{0,400}cur !== 'client approval' && cur !== 'tweaks needed'/.test(INDEX),
  '_sxrClientApproveComp carries the handler-level surface guard');
// comments_base_at:'' on the M2 save path is unchanged
has(/comments_base_at: ''/, 'M2 save path still sends comments_base_at: ""');
// finish judged by created_at, not updated_at (028cbd7/b5e73f5)
const finishedSrc = grabFunc('_sxrKasperIsFinished');
ok(/_sxrLatestMsgCreatedAt\(sample\)/.test(finishedSrc),
  '_sxrKasperIsFinished judges a fresh ask by latest message CREATED-AT');
const latestSrc = grabFunc('_sxrLatestMsgCreatedAt');
ok(/m\.created_at/.test(latestSrc) && !/m\.updated_at/.test(latestSrc),
  '_sxrLatestMsgCreatedAt ranks by created_at ONLY (a resolve/edit bump is not a new ask)');

console.log('\n============================================================');
console.log(`SUMMARY: ${pass} passed, ${fail} failed`);
console.log(fail ? 'OVERALL: FAIL ❌' : 'OVERALL: PASS ✅');
process.exit(fail ? 1 : 0);
