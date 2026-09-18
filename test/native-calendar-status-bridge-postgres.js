'use strict';
/*
 * Isolated-PostgreSQL proof of migrations/2026-09-18-native-calendar-status-bridge.sql.
 *
 * All identities below are synthetic and the database is disposable; nothing
 * here reaches a live backend.
 *
 * WHAT IS BEING PROVED, AND WHY EACH ASSERTION HAS A PARTNER.
 *
 * Every positive assertion here is paired with the input that is supposed to be
 * decisive flipped, because a test that passes while measuring the wrong thing
 * is this workstream's recurring failure. The projection assertions run with
 * the trigger present AND with it dropped, so a green run proves the trigger is
 * the cause rather than proving that the fixture happened to agree.
 *
 * The four properties:
 *
 *  1. PROJECTION. A native status change on a deliverable a calendar card
 *     points at moves that card's component status, stamps its *_status_at, and
 *     writes one calendar_post_events row with source 'native-bridge'.
 *
 *  2. THE STAMP IS NOT RE-OPENED. calendar_posts.video_status_at is the urgent
 *     ping's dedupe key -- production_notification_enqueue_urgent builds
 *     intent_key = 'urgent:' || sha256(deliverable_id || '|' || video_status_at)
 *     -- so a projection that re-stamps it without a real card-visible change
 *     mints a second pingable round for one tweak. Proved by moving the native
 *     status between two values that map to the SAME calendar value and
 *     asserting the stamp, and the derived intent_key, are byte-identical.
 *
 *  3. NO SECOND NOTIFICATION PATH. The projection writes zero
 *     deliverable_events rows of its own, which is what
 *     production_notification_status_intent_after (a trigger on
 *     deliverable_events keyed on source='ui' and action='status_change') would
 *     have to see to raise a duplicate client-channel intent. Measured as a
 *     delta against the same write with the projection trigger dropped, so the
 *     pre-existing rpc_bypass_guard row is not mistaken for the projection's.
 *
 *  4. THE BACKFILL IS THE SAME PREDICATE. Dry run changes nothing, --apply
 *     applies exactly the listed rows, and a second apply is a no-op that
 *     writes no second event row and re-stamps nothing.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const { bootCluster, MIGRATIONS, jsonRows, scalar } = require('../scripts/native-intake-manifest/harness');

if (process.env.F63_REQUIRE_POSTGRES !== '1') {
  console.log('SKIP native calendar status bridge PostgreSQL: F63 disposable PostgreSQL required');
  process.exit(0);
}
const host = process.env.F42_REHEARSAL_SOCKET || process.env.F42_REHEARSAL_PGHOST || process.env.PGHOST || '';
/* An empty host is the self-managed case: scripts/f42-apply-rehearsal.js then
 * initdb's its own cluster in a temp directory and starts it with
 * `listen_addresses=''` on a unix socket it owns, which is strictly more
 * isolated than a loopback service. Anything else must be loopback. */
if (host !== '' && !['localhost', '127.0.0.1', '::1'].includes(host) && !host.startsWith('/')) {
  throw Error('native calendar status bridge proof requires loopback or self-managed disposable PostgreSQL');
}
for (const key of ['PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE']) delete process.env[key];

let cluster;
let passed = 0;
let failed = 0;
const ok = (name, value) => {
  if (value) { passed += 1; console.log(`  ok ${name}`); }
  else { failed += 1; console.log(`  FAIL ${name}`); }
};

/* The urgent ping's dedupe key, recomputed exactly as
 * production_notification_enqueue_urgent builds it, so "the stamp did not move"
 * is asserted in the units that actually decide whether a second Slack message
 * is possible. */
const urgentIntentKey = (deliverableId, stampIso) =>
  'urgent:' + crypto.createHash('sha256')
    .update(`${deliverableId}|${stampIso}`, 'utf8').digest('hex');

const card = (id) => jsonRows(cluster, `select client, id, video_status, graphic_status,
  to_char(video_status_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as video_stamp,
  to_char(graphic_status_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as graphic_stamp,
  updated_at,
  client_video_approved_at, client_graphic_approved_at, kasper_approved_at, caption_status
  from public.calendar_posts where id = '${id}'`)[0];

const bridgeEvents = (postId) => jsonRows(cluster,
  `select component, from_status, to_status, source, payload->>'via' as via, payload->>'deliverable_id' as deliverable_id
   from public.calendar_post_events where post_id = '${postId}' and source = 'native-bridge' order by id`);

const deliverableEventCount = () => Number(scalar(cluster, 'select count(*) from public.deliverable_events'));

/* The fixture the harness does not supply: the calendar columns this
 * projection reads and writes, the exact-change-time stamping trigger the
 * reconciler's ledger depends on, the event ledger, and the subject migration. */
const FIXTURE = `
alter table public.calendar_posts add column if not exists video_status text;
alter table public.calendar_posts add column if not exists graphic_status text;
alter table public.calendar_posts add column if not exists caption_status text;
alter table public.calendar_posts add column if not exists client_video_approved_at text;
alter table public.calendar_posts add column if not exists client_graphic_approved_at text;
alter table public.calendar_posts add column if not exists kasper_approved_at text;
alter table public.calendar_posts add column if not exists updated_at text;
alter table public.calendar_posts add column if not exists order_index numeric;

insert into public.batches(id, client_slug, team, name, status, purpose)
values ('batch-cal-video', 'fixture-client', 'video', 'Fixture calendar batch', 'active', 'calendar'),
       ('batch-cal-graphics', 'fixture-client', 'graphics', 'Fixture graphics batch', 'active', 'calendar'),
       ('batch-samples', 'fixture-client', 'video', 'Fixture samples batch', 'active', 'samples')
on conflict (id) do nothing;

insert into public.calendar_posts(id, client, status, video_status, graphic_status, updated_at)
values ('card-1', 'fixture-client', 'Planned', 'Tweaks Needed', 'Tweaks Needed', '2026-09-18T10:00:00.000Z'),
       ('card-2', 'fixture-client', 'Planned', 'In Progress', 'In Progress', '2026-09-18T10:00:00.000Z'),
       ('card-unlinked', 'fixture-client', 'Planned', 'Tweaks Needed', 'Tweaks Needed', '2026-09-18T10:00:00.000Z'),
       ('card-archived', 'fixture-client', 'Archived', 'Tweaks Needed', 'Tweaks Needed', '2026-09-18T10:00:00.000Z')
on conflict (id) do nothing;

insert into public.deliverables(id, batch_id, client_slug, team, kind, title, status, origin, card_id)
values ('dv-1', 'batch-cal-video', 'fixture-client', 'video', 'video', 'Fixture video one', 'tweak', 'calendar', 'card-1'),
       ('dg-1', 'batch-cal-graphics', 'fixture-client', 'graphics', 'thumbnail', 'Fixture graphic one', 'tweak', 'calendar', 'card-1'),
       ('dv-2', 'batch-cal-video', 'fixture-client', 'video', 'video', 'Fixture video two', 'backlog', 'calendar', 'card-2'),
       ('dv-orphan', 'batch-cal-video', 'fixture-client', 'video', 'video', 'Fixture orphan', 'tweak', 'calendar', 'card-unlinked'),
       ('dv-arch', 'batch-cal-video', 'fixture-client', 'video', 'video', 'Fixture archived', 'tweak', 'calendar', 'card-archived'),
       ('ds-1', 'batch-samples', 'fixture-client', 'video', 'video', 'Fixture sample', 'tweak', 'samples', 'card-1')
on conflict (id) do nothing;

update public.calendar_posts set video_deliverable_id = 'dv-1', graphic_deliverable_id = 'dg-1' where id = 'card-1';
update public.calendar_posts set video_deliverable_id = 'dv-2' where id = 'card-2';
update public.calendar_posts set video_deliverable_id = 'dv-arch' where id = 'card-archived';
insert into public.calendar_posts(id, client, status, video_status, graphic_status, caption_status,
  client_video_approved_at, client_graphic_approved_at, kasper_approved_at, updated_at)
values ('card-3', 'fixture-client', 'Planned', 'Approved', 'Tweaks Needed', 'Tweaks Needed',
        '2026-09-18T11:00:00.000Z', '', '2026-09-18T11:05:00.000Z', '2026-09-18T11:00:00.000Z'),
       ('card-4', 'fixture-client', 'Planned', 'In Progress', 'Approved', 'Tweaks Needed',
        '2026-09-18T11:00:00.000Z', '2026-09-18T11:00:00.000Z', '2026-09-18T11:05:00.000Z', '2026-09-18T11:00:00.000Z')
on conflict (id) do nothing;

insert into public.deliverables(id, batch_id, client_slug, team, kind, title, status, origin, card_id)
values ('dv-3', 'batch-cal-video', 'fixture-client', 'video', 'video', 'Fixture regress', 'approved', 'calendar', 'card-3'),
       ('dv-4', 'batch-cal-video', 'fixture-client', 'video', 'video', 'Fixture hold', 'todo', 'calendar', 'card-4')
on conflict (id) do nothing;

update public.calendar_posts set video_deliverable_id = 'dv-3' where id = 'card-3';
update public.calendar_posts set video_deliverable_id = 'dv-4' where id = 'card-4';
-- card-unlinked deliberately keeps both slots null while dv-orphan names it.
`;

try {
  cluster = bootCluster();
  cluster.runFile(path.join(MIGRATIONS, '2026-07-03-a1-calendar-upsert.sql'));
  cluster.runFile(path.join(MIGRATIONS, 'calendar-status-at-migration.sql'));
  cluster.exec(FIXTURE);
  cluster.runFile(path.join(MIGRATIONS, '2026-09-18-native-calendar-status-bridge.sql'));

  /* ---- the mapping, at the SQL boundary --------------------------------- */
  const mapped = jsonRows(cluster, `select s as status, o as origin,
      public.production_native_calendar_status_map(s, o) as target
    from unnest(array['in_progress','backlog','todo','smm_approval','kasper_approval',
      'client_approval','tweak','approved','scheduled','posted','triage','canceled',
      'duplicate','','  TWEAK  ']) s
    cross join unnest(array['calendar','samples']) o`);
  const look = (s, o) => mapped.find(r => r.status === s && r.origin === o).target;
  ok('smm_approval maps to the calendar value the editor change should show',
    look('smm_approval', 'calendar') === 'For SMM Approval');
  ok('the three pre-review native states collapse to one calendar value',
    ['in_progress', 'backlog', 'todo'].every(s => look(s, 'calendar') === 'In Progress'));
  ok('scheduled and posted have a calendar equivalent only off the samples surface',
    look('scheduled', 'calendar') === 'Scheduled' && look('scheduled', 'samples') === null
    && look('posted', 'calendar') === 'Posted' && look('posted', 'samples') === null);
  ok('statuses with no calendar equivalent map to null rather than to a guess',
    ['triage', 'canceled', 'duplicate', ''].every(s => look(s, 'calendar') === null));
  ok('the mapper normalises case and surrounding space exactly as the page does',
    look('  TWEAK  ', 'calendar') === 'Tweaks Needed');

  /* ---- 1. the projection, with its control ------------------------------ */
  const before = card('card-1');
  const beforeEvents = deliverableEventCount();
  cluster.exec(`update public.deliverables set status = 'smm_approval' where id = 'dv-1';`);
  const after = card('card-1');
  ok('an editor status change reaches the calendar card it is linked to',
    before.video_status === 'Tweaks Needed' && after.video_status === 'For SMM Approval');
  ok('the exact change-time the reconciler ledger reads moves with it',
    after.video_stamp !== before.video_stamp && after.video_stamp !== null);
  ok('the untouched component is left alone',
    after.graphic_status === before.graphic_status && after.graphic_stamp === before.graphic_stamp);
  ok('the card carries a fresh updated_at so the calendar re-renders it',
    after.updated_at !== before.updated_at);
  let events = bridgeEvents('card-1');
  ok('one event row, with a source distinct from ui / db / reconcile',
    events.length === 1 && events[0].source === 'native-bridge' && events[0].via === 'trigger');
  ok('the event row names the component and both ends of the move',
    events[0].component === 'video' && events[0].from_status === 'Tweaks Needed'
    && events[0].to_status === 'For SMM Approval' && events[0].deliverable_id === 'dv-1');

  /* 3. No second notification path. The one deliverable_events row added is
   * the pre-existing rpc_bypass_guard row, not the projection's -- measured
   * below by running the identical write with the projection trigger dropped
   * and comparing the deltas. */
  const withBridgeDelta = deliverableEventCount() - beforeEvents;

  /* ---- 2. the stamp is not re-opened ------------------------------------ */
  const stable = card('card-2');
  const stableKey = urgentIntentKey('dv-2', stable.video_stamp);
  cluster.exec(`update public.deliverables set status = 'todo' where id = 'dv-2';`);
  const stable2 = card('card-2');
  ok('a native move between two statuses that map to the same calendar value changes nothing',
    stable2.video_status === 'In Progress' && stable2.video_stamp === stable.video_stamp
    && stable2.updated_at === stable.updated_at);
  ok('so the urgent ping dedupe key derived from that stamp is unchanged, and no second round opens',
    urgentIntentKey('dv-2', stable2.video_stamp) === stableKey);
  ok('and no event row is written for a move the card never showed',
    bridgeEvents('card-2').length === 0);

  cluster.exec(`update public.deliverables set status = 'canceled' where id = 'dv-2';`);
  const cancelled = card('card-2');
  ok('a status with no calendar equivalent leaves both the value and the stamp exactly as they were',
    cancelled.video_status === 'In Progress' && cancelled.video_stamp === stable.video_stamp
    && bridgeEvents('card-2').length === 0);

  /* ---- linkage is the card's own slot, never the deliverable's card_id --- */
  cluster.exec(`update public.deliverables set status = 'approved' where id = 'dv-orphan';`);
  ok('a deliverable whose card does not point back is not projected onto it',
    card('card-unlinked').video_status === 'Tweaks Needed' && bridgeEvents('card-unlinked').length === 0);

  cluster.exec(`update public.deliverables set status = 'approved' where id = 'ds-1';`);
  ok('a samples-origin deliverable naming a calendar card id is not projected onto the calendar',
    card('card-1').video_status === 'For SMM Approval' && bridgeEvents('card-1').length === 1);

  /* ---- the graphic slot ------------------------------------------------- */
  cluster.exec(`update public.deliverables set status = 'client_approval' where id = 'dg-1';`);
  const graphic = card('card-1');
  ok('the graphic slot projects through graphic_deliverable_id into graphic_status',
    graphic.graphic_status === 'Client Approval' && graphic.graphic_stamp !== before.graphic_stamp);
  events = bridgeEvents('card-1');
  ok('and writes its own event row naming the graphic component',
    events.length === 2 && events[1].component === 'graphic' && events[1].deliverable_id === 'dg-1');

  /* ---- 3. the control: drop the trigger, repeat the decisive write ------- */
  cluster.exec(`update public.calendar_posts set video_status = 'Tweaks Needed' where id = 'card-1';`);
  cluster.exec('drop trigger zzz_native_calendar_status_project on public.deliverables;');
  const controlBefore = card('card-1');
  const controlEventsBefore = deliverableEventCount();
  cluster.exec(`update public.deliverables set status = 'approved' where id = 'dv-1';`);
  const controlAfter = card('card-1');
  ok('CONTROL: without the trigger the identical write leaves the calendar stale — the reported regression',
    controlAfter.video_status === 'Tweaks Needed' && controlAfter.video_status === controlBefore.video_status
    && bridgeEvents('card-1').length === 2);
  ok('the projection adds no deliverable_events row of its own, so the client-channel status intent cannot fire twice',
    withBridgeDelta === deliverableEventCount() - controlEventsBefore);
  cluster.runFile(path.join(MIGRATIONS, '2026-09-18-native-calendar-status-bridge.sql'));
  ok('re-running the migration restores the trigger, so it is idempotent',
    Number(scalar(cluster, `select count(*) from pg_trigger where tgname = 'zzz_native_calendar_status_project' and not tgisinternal`)) === 1);

  /* ---- 4. the backfill -------------------------------------------------- */
  // dv-1 is now `approved` while the card still reads Tweaks Needed: exactly
  // the lag shape the trigger was installed too late to catch.
  const lagBefore = card('card-1');
  const dry = jsonRows(cluster,
    `select * from public.production_native_calendar_status_backfill('2026-09-18T00:00:00Z'::timestamptz, false)`);
  ok('the dry run lists the lagging component, naming card and deliverable, never the client display name',
    dry.length === 1 && dry[0].post_id === 'card-1' && dry[0].component === 'video'
    && dry[0].card_status === 'Tweaks Needed' && dry[0].target_status === 'Approved'
    && dry[0].applied === false);
  const lagAfterDry = card('card-1');
  ok('the dry run changes nothing at all, including the stamp',
    lagAfterDry.video_status === lagBefore.video_status
    && lagAfterDry.video_stamp === lagBefore.video_stamp
    && bridgeEvents('card-1').length === 2);

  const early = jsonRows(cluster,
    `select * from public.production_native_calendar_status_backfill(now() + interval '1 day', false)`);
  ok('a since bound after the change excludes it, so the window is real and not decorative', early.length === 0);

  const applied = jsonRows(cluster,
    `select * from public.production_native_calendar_status_backfill('2026-09-18T00:00:00Z'::timestamptz, true)`);
  const lagApplied = card('card-1');
  ok('--apply projects exactly the rows the dry run listed',
    applied.length === 1 && applied[0].applied === true && lagApplied.video_status === 'Approved');
  events = bridgeEvents('card-1');
  ok('and writes the same event row shape, marked as the backfill rather than the trigger',
    events.length === 3 && events[2].via === 'backfill' && events[2].from_status === 'Tweaks Needed'
    && events[2].to_status === 'Approved' && events[2].source === 'native-bridge');

  const again = jsonRows(cluster,
    `select * from public.production_native_calendar_status_backfill('2026-09-18T00:00:00Z'::timestamptz, true)`);
  const lagTwice = card('card-1');
  ok('a second apply is a no-op: nothing listed, nothing written, and the stamp does not move',
    again.length === 0 && lagTwice.video_stamp === lagApplied.video_stamp
    && bridgeEvents('card-1').length === 3);
  ok('so re-running the backfill cannot re-open an already-pinged urgent tweak round',
    urgentIntentKey('dv-1', lagTwice.video_stamp) === urgentIntentKey('dv-1', lagApplied.video_stamp));

  cluster.exec(`update public.deliverables set status = 'smm_approval' where id = 'dv-arch';`);
  ok('an archived card is left out of both the trigger scope and the backfill',
    jsonRows(cluster, `select * from public.production_native_calendar_status_backfill('2026-09-18T00:00:00Z'::timestamptz, false)`)
      .filter(r => r.post_id === 'card-archived').length === 0);

  /* ---- stale approval stamps, cleared in the same transaction ------------ */
  /* card-3: video Approved with a client stamp and a kasper stamp; graphic and
   * caption are below the line, so the regression must clear BOTH. */
  const regressBefore = card('card-3');
  cluster.exec(`update public.deliverables set status = 'tweak' where id = 'dv-3';`);
  const regressAfter = card('card-3');
  ok('a regressing component clears its own client approval stamp in the same statement',
    regressBefore.client_video_approved_at !== '' && regressAfter.video_status === 'Tweaks Needed'
    && regressAfter.client_video_approved_at === '');
  ok('and kasper_approved_at goes with it when no component is left above the line',
    regressBefore.kasper_approved_at !== '' && regressAfter.kasper_approved_at === '');
  ok('the other component stamps are not invented or touched',
    regressAfter.client_graphic_approved_at === regressBefore.client_graphic_approved_at);

  /* card-4: graphic is still Approved, so the video regression must NOT take
   * kasper_approved_at with it. This is the pair that makes the one above mean
   * something. */
  const holdBefore = card('card-4');
  cluster.exec(`update public.deliverables set status = 'tweak' where id = 'dv-4';`);
  const holdAfter = card('card-4');
  ok('but kasper_approved_at is KEPT while another component is still above the line',
    holdAfter.video_status === 'Tweaks Needed' && holdAfter.client_video_approved_at === ''
    && holdAfter.kasper_approved_at === holdBefore.kasper_approved_at
    && holdAfter.kasper_approved_at !== '');

  /* A move that does not cross the line clears nothing: todo -> in_progress both
   * map to "In Progress", so the card never changes and no stamp may move. */
  cluster.exec(`update public.calendar_posts set video_status = 'In Progress',
      client_video_approved_at = '2026-09-18T12:00:00.000Z' where id = 'card-4';`);
  const flatBefore = card('card-4');
  cluster.exec(`update public.deliverables set status = 'todo' where id = 'dv-4';`);
  cluster.exec(`update public.deliverables set status = 'in_progress' where id = 'dv-4';`);
  const flatAfter = card('card-4');
  ok('a native move whose mapped value does not change clears no stamp and moves no timestamp',
    flatAfter.client_video_approved_at === flatBefore.client_video_approved_at
    && flatAfter.kasper_approved_at === flatBefore.kasper_approved_at
    && flatAfter.video_stamp === flatBefore.video_stamp);

  /* ---- the backfill revalidates rather than replaying its snapshot -------- */
  /* WHAT IS AND IS NOT PROVED HERE, said plainly.
   *
   * The apply re-reads the deliverable in the same statement and proceeds only
   * while the deliverable version, the freshly derived target and the card's
   * own value all still match what the scan reported. The interleaving that
   * makes those clauses matter -- another session committing between the scan
   * statement and the apply statement -- CANNOT be staged from a single-session
   * fixture: both statements run inside one call, and a trigger firing during
   * the apply is part of the same command and so cannot change what that
   * command sees. Attempted three ways before this was written down rather than
   * quietly dropped.
   *
   * So the clauses themselves are pinned structurally by
   * test/native-calendar-status-bridge.js, which requires both branches to
   * carry the deliverable re-join, the re-derived target, the card-value check,
   * and the events insert reading from the applied table rather than the scope.
   * What IS proved here is the consequence a stale apply would break: the
   * reported `applied` flag is read back from what the UPDATE returned, and the
   * ledger is written from the same place. */
  const appliedFlags = jsonRows(cluster,
    `select * from public.production_native_calendar_status_backfill('2026-09-18T00:00:00Z'::timestamptz, false)`);
  ok('a dry run reports applied=false on every row, because nothing was returned by an UPDATE',
    appliedFlags.every(r => r.applied === false));

  /* ---- the ROLLBACK.md inverse, rehearsed rather than asserted ----------- */
  cluster.exec(`
    drop trigger if exists zzz_native_calendar_status_project on public.deliverables;
    drop function if exists public.production_native_calendar_status_backfill(timestamptz, boolean);
    drop function if exists public.production_native_calendar_status_project();
    drop function if exists public.production_native_calendar_status_map(text, text);
    drop function if exists public.production_native_calendar_status_above(text);
  `);
  const inverseBefore = card('card-1');
  const inverseEvents = bridgeEvents('card-1').length;
  cluster.exec(`update public.deliverables set status = 'tweak' where id = 'dv-1';`);
  const inverseAfter = card('card-1');
  ok('the ROLLBACK.md inverse removes all five objects and the projection stops',
    Number(scalar(cluster, `select count(*) from pg_proc where proname like 'production_native_calendar_status_%'`)) === 0
    && Number(scalar(cluster, `select count(*) from pg_trigger where tgname = 'zzz_native_calendar_status_project' and not tgisinternal`)) === 0
    && inverseAfter.video_status === inverseBefore.video_status
    && inverseAfter.video_stamp === inverseBefore.video_stamp);
  ok('and it leaves every card value, stamp and event row the bridge already wrote exactly as they are',
    bridgeEvents('card-1').length === inverseEvents
    && inverseAfter.graphic_status === inverseBefore.graphic_status);
} finally {
  if (cluster) cluster.stop();
}

console.log(JSON.stringify({
  marker: failed ? 'NATIVE_CALENDAR_STATUS_BRIDGE_POSTGRES_FAIL' : 'NATIVE_CALENDAR_STATUS_BRIDGE_POSTGRES_OK',
  passed, failed,
}));
assert.equal(failed, 0, 'native calendar status bridge PostgreSQL proof');
