'use strict';
/*
 * The drift report is only worth wiring to a red build if it cannot cry wolf.
 *
 * `scripts/card-calendar-status-drift-check.js` compares every linked calendar
 * slot against its deliverable and calls the disagreements drift. The hard part
 * is not the comparison — it is the seven cases where the two surfaces disagree
 * and that is CORRECT, because the native bridge trigger was never going to
 * write that slot. A report that counted those would go red on main on day one
 * for reasons nobody could act on, and the lane would be turned off.
 *
 * So this suite EXECUTES the real classifier against a fixture, one card per
 * branch of the trigger's own order of refusal, and pins each verdict.
 *
 * It also runs the REAL mapper, extracted out of index.html the way the script
 * extracts it. That is deliberate: the extraction is the part most likely to
 * break silently (a rename in the page, a reformat), and a test that stubbed
 * the mapper would pass happily while the script threw in CI.
 *
 * Offline. Reads two files and makes no network call of any kind.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = process.env.CARD_DRIFT_SRC || path.join(ROOT, 'scripts', 'card-calendar-status-drift-check.js');
const { classify, classifySlot, resettle, cleanSummary, loadMapper, SLOTS, BUCKETS } = require(SRC);

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'card-calendar-status-drift.json'), 'utf8'));

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* ---- the harness is not vacuous ---- */
ok(typeof classify === 'function' && typeof classifySlot === 'function',
  'the real classifier loads and runs');

/* ---- the mapper really comes out of index.html ---- */
let mapNative = null;
try { mapNative = loadMapper(path.join(ROOT, 'index.html')); } catch (e) { mapNative = null; }
ok(typeof mapNative === 'function',
  '_calMapNativeStatusStrict extracts out of index.html (the script does not keep a copy)');

if (typeof mapNative === 'function') {
  ok(mapNative('smm_approval', 'calendar') === 'For SMM Approval'
    && mapNative('backlog', 'calendar') === 'In Progress'
    && mapNative('tweak', 'calendar') === 'Tweaks Needed'
    && mapNative('triage', 'calendar') === null,
    'the extracted function is the real mapping, not an empty shell that returns null');

  /* The samples branch exists in the mapper and is UNREACHABLE from this
     report, because the trigger refuses a non-calendar origin before it maps
     anything. Pinned so that nobody later "fixes" the out_of_scope bucket by
     routing samples rows into the mapping and calling the nulls drift. */
  ok(mapNative('posted', 'samples') === null && mapNative('posted', 'calendar') === 'Posted',
    'the mapper still distinguishes samples origin, even though the trigger refuses it earlier');
}

/* ---- the slot names are the ones the trigger and the page actually read ---- */
const VIDEO = SLOTS.find(s => s.component === 'video');
const GRAPHIC = SLOTS.find(s => s.component === 'graphic');
ok(VIDEO && VIDEO.deliverableColumn === 'video_deliverable_id' && VIDEO.statusColumn === 'video_status',
  'the video slot names the columns the trigger joins and writes');
ok(GRAPHIC && GRAPHIC.deliverableColumn === 'graphic_deliverable_id' && GRAPHIC.statusColumn === 'graphic_status',
  'the graphic slot names the columns the trigger joins and writes');

/* ---- run the whole classification over the fixture ---- */
const byId = {};
for (const d of fixture.deliverables) byId[d.id] = d;
const report = classify(fixture.cards, byId, mapNative);

const t = report.totals;
ok(BUCKETS.every(b => Object.prototype.hasOwnProperty.call(t, b)),
  'every declared bucket is reported, so a zero is a measurement and not an absence');

/* Per-card verdicts. Each of these is a case where the two surfaces disagree
   and the answer is NOT drift — which is the whole reason this suite exists. */
function verdictFor(postId, component) {
  const card = fixture.cards.find(c => c.id === postId);
  const slot = SLOTS.find(s => s.component === component);
  const v = classifySlot(card, slot, byId[card[slot.deliverableColumn]], mapNative);
  return v ? v.bucket : null;
}

ok(verdictFor('post-0001', 'video') === 'drift',
  'a card behind its deliverable is drift');
ok(verdictFor('post-0002', 'graphic') === 'agree',
  'a card already holding the mapped value is not drift');
ok(verdictFor('post-0004', 'video') === 'unmapped',
  'triage has no calendar equivalent, so the card keeping its old value is correct');
ok(verdictFor('post-0005', 'video') === 'archived',
  'an archived card is out of scope, exactly as it is for the trigger and the backfill');
ok(verdictFor('post-0006', 'video') === 'out_of_scope',
  'a samples-origin deliverable is refused before the mapping, not called drift');
ok(verdictFor('post-0007', 'video') === 'link_asymmetric',
  'a deliverable pointing back at another card makes the bridge inert, not late');
ok(verdictFor('post-0008', 'video') === 'link_asymmetric',
  'the client_slug half of the trigger join counts too');
ok(verdictFor('post-0009', 'graphic') === 'shadowed',
  'one deliverable in both slots resolves to video; the graphic slot is never projected');
ok(verdictFor('post-0009', 'video') === 'drift',
  '...and the video slot of that same card is still judged normally');
ok(verdictFor('post-0010', 'video') === 'unresolved',
  'a deliverable id that did not read back is unresolved, never assumed clean');
ok(verdictFor('post-0012', 'video') === null && verdictFor('post-0012', 'graphic') === null,
  'a card with no linked slot is not scanned at all');

/* The exact-comparison rule. The trigger guards on `is distinct from` against
   the raw column, so a case variant is a value the trigger WOULD rewrite. A
   case-folded comparison here would report this card clean and the lane would
   quietly stop catching a whole class of drift. */
ok(verdictFor('post-0003', 'video') === 'drift',
  'the comparison is exact: "in progress" is drift against "In Progress", as it is for the trigger');

ok(verdictFor('post-0011', 'video') === 'drift',
  'an empty calendar value is drift when the trigger would have written one');

/* Whitespace. `"Approved "` is not equal to `"Approved"` for the trigger's
   `is distinct from`, so the trigger WOULD rewrite that row. Trimming before
   the comparison would report it agreeing and hide the whole class behind this
   report's own claim to compare exactly. Raised by Codex on #1425. */
ok(verdictFor('post-0013', 'video') === 'drift',
  'a stray trailing space is drift, because it is not equality for the trigger either');

const ws = report.drift.find(r => r.post_id === 'post-0013');
ok(ws && ws.calendar_status === 'Approved ',
  '...and the reported row keeps the raw value, so the stray space is visible rather than trimmed away');

/* ---- the reported rows carry what a person needs and nothing else ---- */
const rows = report.drift;
ok(rows.length === t.drift && t.drift === 6,
  'the drift list and the drift count agree, and the fixture produces the six expected rows');

/* Scope is counted per SLOT, not per distinct deliverable. The shadowed card
   puts one deliverable in two slots and classify buckets both, so counting the
   fetch set would under-state what was measured. Raised by Codex on #1425. */
{
  const linkedSlots = fixture.cards.reduce((n, c) =>
    n + SLOTS.filter(s => String(c[s.deliverableColumn] || '').trim()).length, 0);
  const distinct = new Set(fixture.cards.flatMap(c =>
    SLOTS.map(s => String(c[s.deliverableColumn] || '').trim()).filter(Boolean))).size;
  ok(linkedSlots > distinct,
    'the fixture actually distinguishes the two counts (a shadowed deliverable occupies two slots)');
  const bucketed = BUCKETS.reduce((n, b) => n + t[b], 0);
  ok(bucketed === linkedSlots,
    'every linked slot lands in exactly one bucket, so the published scope is the slot count and nothing is lost');
}

const FORBIDDEN = ['client', 'client_slug', 'name', 'caption', 'actor', 'title'];
ok(rows.every(r => FORBIDDEN.every(k => !Object.prototype.hasOwnProperty.call(r, k))),
  'no reported row carries a client, a card name or an actor — this report is pasteable');

ok(rows.every(r => r.post_id && r.deliverable_id && r.component && r.expected),
  'every reported row names the post id, the deliverable id, the component and the expected value');

const first = rows.find(r => r.post_id === 'post-0001');
ok(first && first.expected === 'For SMM Approval' && first.calendar_status === 'In Progress'
  && first.deliverable_status === 'smm_approval',
  'a reported row shows both sides and the value the trigger would have written');

/* ---- the pre-bridge cutoff ----

   The first live run of this lane went red with 27 slots, 25 of which last
   changed between April and 2026-08-24 — before the trigger existed. The
   trigger fires on a CHANGE and does not reconcile history, so those are the
   backlog it was built to stop growing, not a failure of it. Gating on them
   would have held the lane permanently red for a question it cannot answer,
   which is the crying-wolf failure every other bucket here exists to prevent.

   The boundary is one constant, and these two cards sit one second either side
   of it, so the assertion tests the boundary rather than the neighbourhood. */
ok(verdictFor('post-0014', 'video') === 'pre_bridge',
  'a disagreement whose deliverable last moved before go-live is pre-bridge, not drift');
ok(verdictFor('post-0015', 'video') === 'drift',
  '...and one second after go-live it is drift, so the cutoff is the boundary and not a vague era');
ok(verdictFor('post-0016', 'video') === 'pre_bridge',
  'a null status_at cannot be shown to be at/after go-live, so it does not gate');

{
  const pre = report.pre_bridge.find(r => r.post_id === 'post-0014');
  ok(pre && pre.deliverable_status_at === '2026-08-24T11:00:00Z',
    'a pre-bridge row is LISTED with the date, which is the whole argument for it being pre-bridge');
  ok(report.totals.pre_bridge === 2 && report.pre_bridge.length === 2,
    'the pre-bridge count and list agree (post-0014 and the null-status_at row; post-0015 is drift)');
  ok(!report.drift.some(r => r.post_id === 'post-0014' || r.post_id === 'post-0016'),
    'nothing pre-bridge leaks into the gating list');
  ok(report.pre_bridge.every(r => !Object.prototype.hasOwnProperty.call(r, 'client')),
    'pre-bridge rows carry no client either');
}

/* ---- the scan's own race, which is the reason resettle() exists ----

   The two sides are read by two separate paged scans. The trigger writes
   `deliverables` and `calendar_posts` in ONE transaction, so an edit landing
   between the scans leaves the process holding the OLD card and the NEW
   deliverable — which looks exactly like drift and is not. On a live estate
   that would fail the gate and page the watchdog on an ordinary editor edit,
   which is the crying-wolf failure this whole report is shaped to avoid.
   Raised by Codex on #1425. */
{
  const candidate = {
    post_id: 'post-race', deliverable_id: 'dlv-race', component: 'video',
    calendar_status: 'In Progress', deliverable_status: 'smm_approval', expected: 'For SMM Approval',
  };
  const AFTER_GO_LIVE = '2026-09-19T00:52:00Z';
  const freshDlv = { 'dlv-race': { id: 'dlv-race', status: 'smm_approval', origin: 'calendar', card_id: 'post-race', client_slug: 'sidneylaruel', status_at: AFTER_GO_LIVE } };

  // The trigger had already written the card; the first scan simply read it too early.
  const caughtUp = { 'post-race': { id: 'post-race', client: 'sidneylaruel', status: 'active',
    video_status: 'For SMM Approval', graphic_status: '', video_deliverable_id: 'dlv-race', graphic_deliverable_id: '' } };
  const a = resettle([candidate], caughtUp, freshDlv, mapNative);
  ok(a.survivors.length === 0 && a.settled === 1,
    'an edit in flight during the scan settles on re-read and is never reported as drift');

  // Nothing is writing this card: the disagreement is real and must survive.
  const stillBehind = { 'post-race': { id: 'post-race', client: 'sidneylaruel', status: 'active',
    video_status: 'In Progress', graphic_status: '', video_deliverable_id: 'dlv-race', graphic_deliverable_id: '' } };
  const b = resettle([candidate], stillBehind, freshDlv, mapNative);
  ok(b.survivors.length === 1 && b.settled === 0 && b.survivors[0].expected === 'For SMM Approval',
    'real drift survives the re-read, so settling the race does not blind the gate');

  // The re-read is authoritative about BOTH sides, not just the card.
  const c = resettle([candidate], stillBehind,
    { 'dlv-race': { id: 'dlv-race', status: 'triage', origin: 'calendar', card_id: 'post-race', client_slug: 'sidneylaruel', status_at: AFTER_GO_LIVE } },
    mapNative);
  ok(c.survivors.length === 0 && c.settled === 1,
    'a deliverable that moved to an unmapped status on re-read settles too');

  const d = resettle([candidate], {}, freshDlv, mapNative);
  ok(d.survivors.length === 0 && d.settled === 1,
    'a card that no longer reads back is settled, never reported on stale data');

  const e = resettle([candidate], caughtUp, freshDlv, mapNative);
  ok(e.survivors.every(r => !Object.prototype.hasOwnProperty.call(r, 'client')),
    'resettled rows carry no client either');
}

/* ---- a passing run must not contradict its own listing ----

   With post-go-live drift at zero but a pre-bridge backlog present, the old
   wording printed "No linked slot disagrees with its deliverable" directly
   above a list of slots that disagree. A reader who spots a report
   contradicting itself stops trusting the report, not just that line. Raised by
   Codex on #1426. */
{
  const withBacklog = cleanSummary({ drift: 0, pre_bridge: 3 }).join(' ');
  ok(!/No linked slot disagrees/.test(withBacklog),
    'a passing run with a pre-bridge backlog does not claim universal agreement');
  ok(/POST-GO-LIVE/.test(withBacklog) && /3 pre-bridge slot/.test(withBacklog),
    '...it says there is no post-go-live drift, and names the backlog it is still listing');

  const trulyClean = cleanSummary({ drift: 0, pre_bridge: 0 }).join(' ');
  ok(/No linked slot disagrees/.test(trulyClean),
    'a genuinely clean world still gets the plain clean message');
}

/* ---- a clean world reports clean ---- */
const cleanReport = classify(
  [{ id: 'post-clean', client: 'sidneylaruel', status: 'active', video_status: 'For SMM Approval',
     graphic_status: '', video_deliverable_id: 'dlv-clean', graphic_deliverable_id: '' }],
  { 'dlv-clean': { id: 'dlv-clean', status: 'smm_approval', origin: 'calendar', card_id: 'post-clean', client_slug: 'sidneylaruel', status_at: '2026-09-19T00:52:00Z' } },
  mapNative);
ok(cleanReport.totals.drift === 0 && cleanReport.totals.agree === 1 && cleanReport.drift.length === 0,
  'a world where the bridge is holding reports zero drift (the gate can actually go green)');

if (failures) {
  console.error('\n' + failures + ' card/calendar drift check assertion(s) failed');
  process.exit(1);
}
console.log('\ncard vs calendar status drift checks passed');
