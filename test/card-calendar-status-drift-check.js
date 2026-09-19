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
const { classify, classifySlot, loadMapper, SLOTS, BUCKETS } = require(SRC);

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

/* ---- the reported rows carry what a person needs and nothing else ---- */
const rows = report.drift;
ok(rows.length === t.drift && t.drift === 4,
  'the drift list and the drift count agree, and the fixture produces the four expected rows');

const FORBIDDEN = ['client', 'client_slug', 'name', 'caption', 'actor', 'title'];
ok(rows.every(r => FORBIDDEN.every(k => !Object.prototype.hasOwnProperty.call(r, k))),
  'no reported row carries a client, a card name or an actor — this report is pasteable');

ok(rows.every(r => r.post_id && r.deliverable_id && r.component && r.expected),
  'every reported row names the post id, the deliverable id, the component and the expected value');

const first = rows.find(r => r.post_id === 'post-0001');
ok(first && first.expected === 'For SMM Approval' && first.calendar_status === 'In Progress'
  && first.deliverable_status === 'smm_approval',
  'a reported row shows both sides and the value the trigger would have written');

/* ---- a clean world reports clean ---- */
const cleanReport = classify(
  [{ id: 'post-clean', client: 'sidneylaruel', status: 'active', video_status: 'For SMM Approval',
     graphic_status: '', video_deliverable_id: 'dlv-clean', graphic_deliverable_id: '' }],
  { 'dlv-clean': { id: 'dlv-clean', status: 'smm_approval', origin: 'calendar', card_id: 'post-clean', client_slug: 'sidneylaruel' } },
  mapNative);
ok(cleanReport.totals.drift === 0 && cleanReport.totals.agree === 1 && cleanReport.drift.length === 0,
  'a world where the bridge is holding reports zero drift (the gate can actually go green)');

if (failures) {
  console.error('\n' + failures + ' card/calendar drift check assertion(s) failed');
  process.exit(1);
}
console.log('\ncard vs calendar status drift checks passed');
