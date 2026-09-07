// Calendar feedback recovery: ACTUAL production-write handler + FROZEN
// calendar-upsert handler in-process over a disposable PostgreSQL 16 loaded
// from the repository migrations. Every row counted below was written by the
// real RPCs; nothing is stubbed except the network (refused) and the Supabase
// client transport (psql). Baseline = the exact branch base, run side by side.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pg = require('./pg.js');
const { PgSupabase } = require('./seam.js');
const edge = await import('./edge.mjs');

const BASE = process.env.CALENDAR_RECOVERY_BASELINE || '7e5a743cce8a1552bc822e0e560896451f983cdf';
const BODY = 'Fictional feedback original';
const SOURCE_AT = '2026-09-05T12:00:00.000Z';
const report = { status: 'INCOMPLETE', groups: [], checks: 0 };
const check = (condition, message) => { assert.ok(condition, message); report.checks++; };
const eq = (a, b, message) => { assert.equal(a, b, message); report.checks++; };

const cluster = pg.Cluster.start();
const db = pg.createDatabase(cluster, 'cfr_handler');
const schema = pg.loadSchema(db);
const seam = new PgSupabase(db);
edge.useSeam(() => seam);
const candidate = await edge.loadProductionWrite();
const baseline = await edge.loadProductionWrite(BASE);
const upsert = await edge.loadCalendarUpsert();
report.versions = { candidate: candidate.source_sha256, baseline: { revision: BASE, source_sha256: baseline.source_sha256 }, calendar_upsert_frozen: upsert.source_sha256, schema };

const clientHeaders = token => ({ 'x-syncview-client-token': token, 'x-syncview-source': 'calendar' });
const staffHeaders = { 'x-syncview-key': 'synthetic-admin', 'x-syncview-actor': 'Fixture admin', 'x-syncview-source': 'calendar' };
const upsertHeaders = token => ({ 'x-syncview-client-token': token, 'x-syncview-role': 'client', 'x-syncview-source': 'calendar' });
const sanitize = value => String(value).replace(/[^a-zA-Z0-9:_-]+/g, '_');
function context(f, component, kind, n = 1) {
  const deliverable = component === 'graphic' ? f.graphic : f.video;
  const nativeId = `c_fictional_${component}_${kind}_${n}`;
  const add = { operation: 'comment', surface: 'calendar', entity: 'deliverable', request_id: `calendar:comment:${nativeId}`, source_edited_at: SOURCE_AT, id: deliverable,
    comment: { body: BODY, native_comment_id: nativeId, parent_id: '', audience: 'client', component, is_tweak: kind === 'tweak', round: kind === 'tweak' ? 1 : null, card_id: f.card } };
  const statusRequestId = 'calendar:feedback-status:' + createHash('sha256').update(`calendar-feedback-status-v1\n${deliverable}\n${nativeId}`).digest('hex');
  const status = kind === 'tweak' ? { operation: 'status', surface: 'calendar', entity: 'deliverable', request_id: statusRequestId, source_edited_at: SOURCE_AT, id: deliverable, status: 'tweak' } : null;
  const fields = kind === 'tweak' ? { [`${component}_status`]: 'Tweaks Needed', status: 'Tweaks Needed' } : {};
  const previous = kind === 'tweak' ? { [`${component}_status`]: 'Client Approval', status: 'Client Approval' } : {};
  const recover = extra => ({ ...add, recover_source: { card_id: f.card, component, kind, expected_updated_at: f.clock, fields, previous,
    status: status ? { payload: JSON.stringify(status), result: 'accepted' } : null, ...extra } });
  return { deliverable, nativeId, add, status, fields, recover };
}
async function accept(handler, f, ctx) {
  const added = await edge.invoke(handler, ctx.add, clientHeaders(f.client.token));
  eq(added.status, 200, 'native add accepted ' + JSON.stringify(added.body).slice(0, 200));
  eq(added.body.native_committed, true);
  if (ctx.status) {
    const moved = await edge.invoke(handler, ctx.status, clientHeaders(f.client.token));
    eq(moved.status, 200, 'own status accepted ' + JSON.stringify(moved.body).slice(0, 200));
    eq(moved.body.native_committed, true);
  }
  await edge.drainBackground();
  return added.body.comment;
}
function cell(snapshot, component) { const text = snapshot.card[`${component}_tweaks`]; return text ? JSON.parse(text) : []; }
function assertUntouched(before, after, except = []) {
  for (const key of ['comments', 'receipts', 'outbox', 'outbox_status', 'outbox_comment', 'deliverable_events', 'status_events', 'calendar_events', 'materializations']) {
    if (!except.includes(key)) eq(after[key], before[key], key + ' unchanged');
  }
  if (!except.includes('card')) assert.deepEqual(after.card, before.card, 'card unchanged'), report.checks++;
}
async function group(name, fn) {
  try { await fn(); report.groups.push({ name, status: 'PASS' }); console.log('PASS ' + name); }
  catch (error) { report.groups.push({ name, status: 'FAIL', error: error.message }); console.log('FAIL ' + name + ': ' + error.message); throw error; }
}

try {
  for (const component of ['video', 'graphic']) for (const kind of ['note', 'tweak']) {
    await group(`${component} ${kind}: accepted native, refused source, retry materializes exactly once`, async () => {
      const f = pg.seedFixture(db); const ctx = context(f, component, kind);
      await accept(candidate.handler, f, ctx);
      const before = pg.snapshot(db);
      eq(before.comments, 1); eq(before.receipts, 1); eq(before.outbox_comment, 1); eq(before.outbox_status, kind === 'tweak' ? 1 : 0); eq(before.status_events, kind === 'tweak' ? 1 : 0);
      eq(cell(before, component).length, 0, 'source refused: no copy');
      // Baseline handler: the same offered request reaches nothing that can materialize.
      const legacy = await edge.invoke(baseline.handler, ctx.recover(), clientHeaders(f.client.token));
      const afterLegacy = pg.snapshot(db);
      check(!afterLegacy.materializations && cell(afterLegacy, component).length === 0, 'baseline never materializes a source copy');
      assertUntouched(before, afterLegacy);
      check(legacy.body.recover_source !== true && legacy.body.outcome !== 'materialized', 'baseline knows no recovery outcome');
      // Candidate: exactly once.
      const first = await edge.invoke(candidate.handler, ctx.recover(), clientHeaders(f.client.token));
      eq(first.status, 200, JSON.stringify(first.body).slice(0, 300)); eq(first.body.outcome, 'materialized'); eq(first.body.recover_source, true);
      eq(first.body.comment.native_comment_id, ctx.nativeId);
      const after = pg.snapshot(db);
      const entries = cell(after, component);
      eq(entries.length, 1); eq(entries[0].id, ctx.nativeId); eq(entries[0].body, BODY); eq(entries[0].role, 'client'); eq(entries[0].audience, 'client');
      eq(entries[0].is_tweak, kind === 'tweak'); eq(entries[0].created_at, SOURCE_AT); eq(entries[0].parent_id, null); eq(entries[0].done, false);
      if (kind === 'tweak') eq(entries[0].round, 1); else check(!('round' in entries[0]), 'note carries no round');
      eq(after.card.tweaks, component === 'video' ? after.card.video_tweaks : '', 'video alias mirrored, graphic leaves it alone');
      eq(after.card[`${component === 'video' ? 'graphic' : 'video'}_tweaks`], '', 'other component cell untouched');
      eq(after.card[`${component}_status`], kind === 'tweak' ? 'Tweaks Needed' : 'Client Approval');
      eq(after.card.status, kind === 'tweak' ? 'Tweaks Needed' : 'Client Approval');
      eq(after.card[`${component === 'video' ? 'graphic' : 'video'}_status`], 'Client Approval', 'other component status untouched');
      check(after.card.updated_at !== before.card.updated_at, 'source revision advanced');
      eq(after.materializations, 1); eq(after.calendar_events, kind === 'tweak' ? 3 : 1);
      assertUntouched(before, after, ['calendar_events', 'materializations', 'card']);
      // Replay: nothing moves.
      const again = await edge.invoke(candidate.handler, ctx.recover(), clientHeaders(f.client.token));
      eq(again.status, 200); eq(again.body.outcome, 'already_materialized');
      assertUntouched(after, pg.snapshot(db));
      eq(edge.externalRequests(), 0);
    });
  }

  await group('outbox-less acceptance: receipt + canonical identity prove the add without provider mirroring', async () => {
    const f = pg.seedFixture(db); const ctx = context(f, 'video', 'tweak');
    await accept(candidate.handler, f, ctx);
    db.run(`delete from public.mirror_outbox where operation = 'comment'`);
    const before = pg.snapshot(db); eq(before.outbox_comment, 0); eq(before.receipts, 1);
    const read = await edge.invoke(candidate.handler, { ...ctx.add, reconcile_only: true }, clientHeaders(f.client.token));
    eq(read.status, 409, 'existing repaired readback still refuses the outbox-less add');
    const done = await edge.invoke(candidate.handler, ctx.recover(), clientHeaders(f.client.token));
    eq(done.status, 200, JSON.stringify(done.body).slice(0, 300)); eq(done.body.outcome, 'materialized');
    const after = pg.snapshot(db); eq(cell(after, 'video').length, 1); eq(after.comments, 1); eq(after.outbox_comment, 0);
  });

  await group('response loss: source already committed by the frozen writer is confirmed without a second copy', async () => {
    const f = pg.seedFixture(db); const ctx = context(f, 'graphic', 'tweak');
    await accept(candidate.handler, f, ctx);
    const wire = JSON.stringify([{ id: ctx.nativeId, parent_id: null, author: f.client.display_name, role: 'client', is_tweak: true, audience: 'client', round: 1, body: BODY, created_at: SOURCE_AT, updated_at: SOURCE_AT, done: false, done_at: '', done_by: '' }]);
    const saved = await edge.invoke(upsert.handler, { client: f.client.slug, post: { id: f.card, graphic_tweaks: wire, graphic_status: 'Tweaks Needed', status: 'Tweaks Needed' }, comments_base_at: '' }, upsertHeaders(f.client.token));
    eq(saved.status, 200); await edge.drainBackground();
    const before = pg.snapshot(db); eq(cell(before, 'graphic').length, 1);
    const done = await edge.invoke(candidate.handler, ctx.recover(), clientHeaders(f.client.token));
    eq(done.status, 200, JSON.stringify(done.body).slice(0, 300)); eq(done.body.outcome, 'already_present');
    const after = pg.snapshot(db); eq(after.materializations, 1); eq(cell(after, 'graphic').length, 1);
    assertUntouched(before, after, ['materializations']);
    const again = await edge.invoke(candidate.handler, ctx.recover(), clientHeaders(f.client.token));
    eq(again.body.outcome, 'already_materialized'); assertUntouched(after, pg.snapshot(db));
  });

  await group('comment copy alone never clears the tweak debt: owned fields still missing hold visibly', async () => {
    const f = pg.seedFixture(db); const ctx = context(f, 'video', 'tweak');
    await accept(candidate.handler, f, ctx);
    const wire = JSON.stringify([{ id: ctx.nativeId, parent_id: null, author: f.client.display_name, role: 'client', is_tweak: true, audience: 'client', round: 1, body: BODY, created_at: SOURCE_AT, updated_at: SOURCE_AT, done: false, done_at: '', done_by: '' }]);
    db.run(`update public.calendar_posts set video_tweaks = ${pg.lit(wire)}, tweaks = ${pg.lit(wire)}, updated_at = '2026-09-05T12:00:01.000Z' where id = ${pg.lit(f.card)}`);
    const before = pg.snapshot(db);
    const held = await edge.invoke(candidate.handler, ctx.recover(), clientHeaders(f.client.token));
    eq(held.status, 409); eq(held.body.outcome, 'held'); eq(held.body.reason, 'source_fields_diverged'); eq(held.body.error, 'recovery_held');
    assertUntouched(before, pg.snapshot(db));
  });

  for (const action of ['edit', 'delete', 'resolve']) await group(`native ${action} after acceptance holds recovery (no stale source insert)`, async () => {
    const f = pg.seedFixture(db); const ctx = context(f, 'video', 'tweak');
    const comment = await accept(candidate.handler, f, ctx);
    const lifecycle = { ...ctx.add, request_id: `calendar:comment:${ctx.nativeId}:${action}`, source_edited_at: '2026-09-05T12:05:00.000Z',
      comment: { ...ctx.add.comment, action, id: comment.id, expected_version: comment.version, expected_updated_at: comment.updated_at, ...(action === 'edit' ? { body: 'Fictional newer native revision' } : {}) } };
    const changed = await edge.invoke(candidate.handler, lifecycle, action === 'resolve' ? staffHeaders : clientHeaders(f.client.token));
    eq(changed.status, 200, action + ' ' + JSON.stringify(changed.body).slice(0, 300));
    await edge.drainBackground();
    const before = pg.snapshot(db);
    const held = await edge.invoke(candidate.handler, ctx.recover(), clientHeaders(f.client.token));
    eq(held.status, 409); eq(held.body.reason, 'native_lifecycle_changed');
    assertUntouched(before, pg.snapshot(db)); eq(cell(pg.snapshot(db), 'video').length, 0);
  });

  await group('later staff status move on the deliverable does not block recovery of the accepted tweak', async () => {
    const f = pg.seedFixture(db); const ctx = context(f, 'video', 'tweak');
    await accept(candidate.handler, f, ctx);
    const moved = await edge.invoke(candidate.handler, { operation: 'status', surface: 'production', entity: 'deliverable', request_id: 'production:status:staff:move:1', source_edited_at: '2026-09-05T12:10:00.000Z', id: ctx.deliverable, status: 'in_progress', expected_status: 'tweak', expected_updated_at: db.scalar(`select updated_at from public.deliverables where id = ${pg.lit(ctx.deliverable)}`) }, staffHeaders);
    eq(moved.status, 200, JSON.stringify(moved.body).slice(0, 200)); await edge.drainBackground();
    const done = await edge.invoke(candidate.handler, ctx.recover(), clientHeaders(f.client.token));
    eq(done.status, 200, JSON.stringify(done.body).slice(0, 300)); eq(done.body.outcome, 'materialized');
    eq(pg.snapshot(db).card.video_status, 'Tweaks Needed', 'the owned source fields are the original ones, never a replay of the current native state');
  });

  await group('unrelated source edit since capture holds under the original-source-row CAS', async () => {
    const f = pg.seedFixture(db); const ctx = context(f, 'video', 'note');
    await accept(candidate.handler, f, ctx);
    const edited = await edge.invoke(upsert.handler, { client: f.client.slug, post: { id: f.card, caption: 'Fictional unrelated caption edit' }, comments_base_at: '' }, upsertHeaders(f.client.token));
    eq(edited.status, 200); await edge.drainBackground();
    const before = pg.snapshot(db); check(before.card.updated_at !== f.clock, 'row moved');
    const held = await edge.invoke(candidate.handler, ctx.recover(), clientHeaders(f.client.token));
    eq(held.status, 409); eq(held.body.reason, 'source_row_changed');
    assertUntouched(before, pg.snapshot(db));
    const retried = await edge.invoke(candidate.handler, ctx.recover({ expected_updated_at: before.card.updated_at }), clientHeaders(f.client.token));
    eq(retried.status, 200); eq(retried.body.outcome, 'materialized');
    const after = pg.snapshot(db); eq(after.card.caption, 'Fictional unrelated caption edit', 'unrelated edit preserved'); eq(cell(after, 'video').length, 1);
  });

  await group('concurrent review change: another note in the same cell is preserved beside the recovered copy', async () => {
    const f = pg.seedFixture(db); const ctx = context(f, 'graphic', 'note');
    await accept(candidate.handler, f, ctx);
    const other = JSON.stringify([{ id: 'fictional-concurrent-note', parent_id: null, author: 'Fixture smm', role: 'smm', is_tweak: false, audience: 'internal', body: 'Fictional concurrent note', created_at: '2026-09-05T12:01:00.000Z', updated_at: '2026-09-05T12:01:00.000Z', done: false, done_at: '', done_by: '' },
      { id: 'fictional-tomb', parent_id: null, author: 'Fixture smm', role: 'smm', is_tweak: false, audience: 'internal', body: 'Fictional deleted note', created_at: '2026-09-05T12:02:00.000Z', updated_at: '2026-09-05T12:02:00.000Z', deleted: true, done: false, done_at: '', done_by: '' }]);
    db.run(`update public.calendar_posts set graphic_tweaks = ${pg.lit(other)}, updated_at = '2026-09-05T12:02:00.000Z' where id = ${pg.lit(f.card)}`);
    const done = await edge.invoke(candidate.handler, ctx.recover({ expected_updated_at: '2026-09-05T12:02:00.000Z' }), clientHeaders(f.client.token));
    eq(done.status, 200); eq(done.body.outcome, 'materialized');
    const entries = cell(pg.snapshot(db), 'graphic');
    eq(entries.length, 3); assert.deepEqual(entries.slice(0, 2), JSON.parse(other)); report.checks++; eq(entries[2].id, ctx.nativeId);
  });

  await group('wrong clients: another client token, and a card bound to another deliverable, are refused before any write', async () => {
    const f = pg.seedFixture(db); const ctx = context(f, 'video', 'tweak');
    await accept(candidate.handler, f, ctx);
    const before = pg.snapshot(db);
    const other = await edge.invoke(candidate.handler, ctx.recover(), clientHeaders(f.other.token));
    eq(other.status, 403); check(!other.body.recover_source, 'no recovery surface for the other client'); assertUntouched(before, pg.snapshot(db));
    const unbound = await edge.invoke(candidate.handler, ctx.recover({ card_id: 'fictional-other-card' }), clientHeaders(f.client.token));
    eq(unbound.status, 400); assertUntouched(before, pg.snapshot(db));
    db.run(`update public.deliverables set card_id = 'fictional-other-card' where id = ${pg.lit(ctx.deliverable)}`);
    const rebound = await edge.invoke(candidate.handler, ctx.recover(), clientHeaders(f.client.token));
    eq(rebound.status, 403); eq(rebound.body.error, 'comment_forbidden');
    db.run(`update public.deliverables set card_id = ${pg.lit(f.card)} where id = ${pg.lit(ctx.deliverable)}`);
    db.run(`update public.calendar_posts set video_deliverable_id = ${pg.lit(f.graphic)} where id = ${pg.lit(f.card)}`);
    const reciprocal = await edge.invoke(candidate.handler, ctx.recover(), clientHeaders(f.client.token));
    eq(reciprocal.status, 403); eq(reciprocal.body.error, 'calendar_feedback_recovery_forbidden');
    eq(pg.snapshot(db).materializations, 0); eq(cell(pg.snapshot(db), 'video').length, 0);
  });

  await group('companion status: unreserved, unproven and foreign reservations never complete a tweak', async () => {
    const f = pg.seedFixture(db); const ctx = context(f, 'video', 'tweak');
    const added = await edge.invoke(candidate.handler, ctx.add, clientHeaders(f.client.token)); eq(added.status, 200);
    await edge.drainBackground();
    const before = pg.snapshot(db); eq(before.outbox_status, 0);
    const unreserved = await edge.invoke(candidate.handler, ctx.recover({ status: null }), clientHeaders(f.client.token));
    eq(unreserved.status, 409); eq(unreserved.body.error, 'companion_status_unreserved');
    const lost = await edge.invoke(candidate.handler, ctx.recover({ status: { payload: JSON.stringify(ctx.status), result: 'lost' } }), clientHeaders(f.client.token));
    eq(lost.status, 409); eq(lost.body.reason, 'companion_status_unproven');
    const foreign = await edge.invoke(candidate.handler, ctx.recover({ status: { payload: JSON.stringify({ ...ctx.status, id: f.graphic }), result: 'accepted' } }), clientHeaders(f.client.token));
    eq(foreign.status, 400);
    assertUntouched(before, pg.snapshot(db));
    // The reserved status lands late (lost response, actually applied): recovery completes.
    const moved = await edge.invoke(candidate.handler, ctx.status, clientHeaders(f.client.token)); eq(moved.status, 200); await edge.drainBackground();
    const done = await edge.invoke(candidate.handler, ctx.recover({ status: { payload: JSON.stringify(ctx.status), result: 'lost' } }), clientHeaders(f.client.token));
    eq(done.status, 200); eq(done.body.outcome, 'materialized');
  });

  await group('malformed, tombstoned and alias-divergent source cells hold; existing entries and tombstones survive', async () => {
    const f = pg.seedFixture(db); const ctx = context(f, 'video', 'note');
    await accept(candidate.handler, f, ctx);
    const cases = [
      ['not JSON', '', 'source_cell_malformed'], ['{}', '', 'source_cell_malformed'],
      [JSON.stringify([{ id: '', body: 'x' }]), '', 'source_cell_malformed'],
      [JSON.stringify([{ id: ctx.nativeId, body: BODY, role: 'client', audience: 'client', is_tweak: false, deleted: true }]), '', 'source_entry_tombstoned'],
      [JSON.stringify([{ id: ctx.nativeId, body: 'Fictional other saved revision', role: 'client', audience: 'client', is_tweak: false }]), '', 'source_entry_conflict'],
      ['', JSON.stringify([{ id: 'fictional-alias-only', body: 'Fictional legacy note' }]), 'source_alias_divergent'],
      ['', 'not JSON', 'source_alias_divergent'], ['', '{}', 'source_alias_divergent'],
    ];
    for (const [videoCell, alias, reason] of cases) {
      db.run(`update public.calendar_posts set video_tweaks = ${pg.lit(videoCell)}, tweaks = ${pg.lit(alias)}, updated_at = ${pg.lit(f.clock)} where id = ${pg.lit(f.card)}`);
      const before = pg.snapshot(db);
      const held = await edge.invoke(candidate.handler, ctx.recover(), clientHeaders(f.client.token));
      eq(held.status, 409, reason + ' ' + JSON.stringify(held.body).slice(0, 200)); eq(held.body.reason, reason);
      assertUntouched(before, pg.snapshot(db));
    }
    for (const [videoCell, alias] of [[null, null], ['', ''], ['[]', '[]']]) {
      db.run(`update public.calendar_posts set video_tweaks = ${pg.lit(videoCell)}, tweaks = ${pg.lit(alias)}, updated_at = ${pg.lit(f.clock)} where id = ${pg.lit(f.card)}`);
      db.run(`delete from public.calendar_feedback_materializations`);
      const done = await edge.invoke(candidate.handler, ctx.recover(), clientHeaders(f.client.token));
      eq(done.status, 200, JSON.stringify(done.body).slice(0, 200)); eq(done.body.outcome, 'materialized');
      const after = pg.snapshot(db); eq(cell(after, 'video').length, 1); eq(after.card.tweaks, after.card.video_tweaks);
    }
  });

  await group('malformed recovery requests are refused at the gateway before the RPC', async () => {
    const f = pg.seedFixture(db); const ctx = context(f, 'video', 'tweak');
    await accept(candidate.handler, f, ctx);
    const before = pg.snapshot(db); const calls = seam.calls.length;
    for (const extra of [{ fields: { caption: 'x' } }, { fields: { video_status: 'Approved' } }, { kind: 'note' }, { component: 'graphic' }, { expected_updated_at: '' }, { previous: 'nope' }]) {
      const refused = await edge.invoke(candidate.handler, ctx.recover(extra), clientHeaders(f.client.token));
      // A component that does not match the target team is the existing
      // front-door 403; every other malformed shape is a 400. Both precede the RPC.
      eq(refused.status, extra.component ? 403 : 400, JSON.stringify(extra) + ' ' + JSON.stringify(refused.body).slice(0, 200));
    }
    const staff = await edge.invoke(candidate.handler, ctx.recover(), staffHeaders);
    eq(staff.status, 403);
    check(!seam.calls.slice(calls).some(c => c.kind === 'rpc' && c.name === 'calendar_feedback_recovery_apply_v1'), 'no RPC reached');
    assertUntouched(before, pg.snapshot(db));
    const note = context(f, 'graphic', 'note', 2); await accept(candidate.handler, f, note);
    const withFields = await edge.invoke(candidate.handler, note.recover({ fields: { graphic_status: 'Tweaks Needed' } }), clientHeaders(f.client.token));
    eq(withFields.status, 400);
  });

  await group('transaction failure leaves no partial source change; the next retry completes exactly once', async () => {
    const f = pg.seedFixture(db); const ctx = context(f, 'graphic', 'tweak');
    await accept(candidate.handler, f, ctx);
    db.run(`create or replace function public.cfr_fail() returns trigger language plpgsql as $$ begin raise exception 'synthetic_evidence_failure'; end $$;
      create trigger cfr_fail before insert on public.calendar_feedback_materializations for each row execute function public.cfr_fail()`);
    const before = pg.snapshot(db);
    const failed = await edge.invoke(candidate.handler, ctx.recover(), clientHeaders(f.client.token));
    check(failed.status >= 500, 'failure surfaced: ' + failed.status); check(failed.body.outcome !== 'materialized');
    assertUntouched(before, pg.snapshot(db));
    db.run(`drop trigger cfr_fail on public.calendar_feedback_materializations; drop function public.cfr_fail()`);
    const done = await edge.invoke(candidate.handler, ctx.recover(), clientHeaders(f.client.token));
    eq(done.status, 200); eq(done.body.outcome, 'materialized');
    const after = pg.snapshot(db); eq(after.materializations, 1); eq(cell(after, 'graphic').length, 1); eq(after.calendar_events, before.calendar_events + 3);
    eq(after.comments, 1); eq(after.receipts, 1);
  });

  // The psql seam executes each RPC synchronously. Promise.all offers multiple
  // retries, but does not prove overlapping SQL transactions or lock waits.
  await group('multiple offered retries produce one materialization (SQL seam serializes transport)', async () => {
    const f = pg.seedFixture(db); const ctx = context(f, 'video', 'tweak');
    await accept(candidate.handler, f, ctx);
    const results = await Promise.all([1, 2, 3].map(() => edge.invoke(candidate.handler, ctx.recover(), clientHeaders(f.client.token))));
    const outcomes = results.map(r => r.body.outcome).sort();
    assert.deepEqual(outcomes, ['already_materialized', 'already_materialized', 'materialized']); report.checks++;
    const after = pg.snapshot(db); eq(after.materializations, 1); eq(cell(after, 'video').length, 1); eq(after.calendar_events, 3);
  });

  await group('accepted status must belong to this exact comment, at both gateway and SQL boundaries', async () => {
    const f = pg.seedFixture(db), first = context(f, 'video', 'tweak', 31), second = context(f, 'video', 'tweak', 32);
    await accept(candidate.handler, f, first);
    eq((await edge.invoke(candidate.handler, second.add, clientHeaders(f.client.token))).status, 200);
    await edge.drainBackground();
    const before = pg.snapshot(db);
    for (const reservation of [first.status, { ...first.status, request_id: 'calendar:status:old-unbound-reservation' }]) {
      const held = await edge.invoke(candidate.handler, second.recover({ status: { payload: JSON.stringify(reservation), result: 'accepted' } }), clientHeaders(f.client.token));
      eq(held.status, 409); eq(held.body.error, 'companion_status_unbound'); assertUntouched(before, pg.snapshot(db));
    }
    // A forged browser assertion with the correct bound id is insufficient:
    // its own status must actually have committed to the database.
    const unproven = await edge.invoke(candidate.handler, second.recover(), clientHeaders(f.client.token));
    eq(unproven.status, 409); eq(unproven.body.reason, 'companion_status_unproven');
    const request = structuredClone(seam.calls.findLast(c => c.name === 'calendar_feedback_recovery_apply_v1').args.p_request);
    const receipt = db.one(`select dedup_key, payload from public.mirror_outbox where operation = 'status'`);
    request.status.dedup_key = receipt.dedup_key;
    request.status.intent_fingerprint = receipt.payload._intent_fingerprint;
    const direct = await seam.rpc('calendar_feedback_recovery_apply_v1', { p_request: request });
    eq(direct.error, null); eq(direct.data.outcome, 'held'); eq(direct.data.reason, 'companion_status_unbound');
    assertUntouched(before, pg.snapshot(db));
    eq((await edge.invoke(candidate.handler, second.status, clientHeaders(f.client.token))).status, 200);
    await edge.drainBackground();
    const done = await edge.invoke(candidate.handler, second.recover(), clientHeaders(f.client.token));
    eq(done.status, 200); eq(done.body.outcome, 'materialized'); eq(cell(pg.snapshot(db), 'video')[0].id, second.nativeId);
    const replay = await edge.invoke(candidate.handler, second.recover(), clientHeaders(f.client.token));
    eq(replay.body.outcome, 'already_materialized'); eq(pg.snapshot(db).materializations, 1);
  });

  await group('owned fields cannot change other status lanes, grant approvals or erase current approvals', async () => {
    const stamp = '2026-09-05T11:00:00.000Z';
    const f = pg.seedFixture(db, { row: { client_video_approved_at: stamp, client_graphic_approved_at: stamp, kasper_approved_at: stamp } });
    const ctx = context(f, 'video', 'tweak'); await accept(candidate.handler, f, ctx);
    const before = pg.snapshot(db);
    const prior = fields => Object.fromEntries(Object.keys(fields).map(k => [k, String(before.card[k] || '')]));
    for (const fields of [
      { ...ctx.fields, graphic_status: 'Approved' },
      { ...ctx.fields, graphic_status: 'Tweaks Needed' },
      { ...ctx.fields, status: 'Approved' },
      { ...ctx.fields, client_graphic_approved_at: '2099-01-01T00:00:00.000Z' },
    ]) {
      const refused = await edge.invoke(candidate.handler, ctx.recover({ fields, previous: prior(fields) }), clientHeaders(f.client.token));
      eq(refused.status, 400); assertUntouched(before, pg.snapshot(db));
    }
    for (const key of ['client_graphic_approved_at', 'kasper_approved_at']) {
      const fields = { ...ctx.fields, [key]: '' };
      const held = await edge.invoke(candidate.handler, ctx.recover({ fields, previous: prior(fields) }), clientHeaders(f.client.token));
      eq(held.status, 409); eq(held.body.reason, 'approval_clear_unproven'); assertUntouched(before, pg.snapshot(db));
    }
    const request = structuredClone(seam.calls.findLast(c => c.name === 'calendar_feedback_recovery_apply_v1').args.p_request);
    request.source.fields = { ...ctx.fields, graphic_status: 'Approved' };
    request.source.previous = prior(request.source.fields);
    const direct = await seam.rpc('calendar_feedback_recovery_apply_v1', { p_request: request });
    check(direct.error && direct.error.message.includes('calendar_feedback_recovery_invalid_source'), 'SQL rejects bypassing gateway field validation');
    assertUntouched(before, pg.snapshot(db));
    const fields = { ...ctx.fields, client_video_approved_at: '' };
    const done = await edge.invoke(candidate.handler, ctx.recover({ fields, previous: prior(fields) }), clientHeaders(f.client.token));
    eq(done.status, 200); eq(pg.snapshot(db).card.client_video_approved_at, '');
    eq(pg.snapshot(db).card.client_graphic_approved_at, stamp); eq(pg.snapshot(db).card.kasper_approved_at, stamp);
  });

  await group('missing or non-string source identity/body cannot certify an already-present comment', async () => {
    const f = pg.seedFixture(db), ctx = context(f, 'video', 'note'); await accept(candidate.handler, f, ctx);
    const entry = { id: ctx.nativeId, parent_id: null, role: 'client', audience: 'client', is_tweak: false };
    for (const value of [entry, { ...entry, body: null }, { ...entry, body: 7 }, { ...entry, body: [] },
      { body: BODY }, { id: null, body: BODY }, { id: 'fictional-unrelated', parent_id: null }]) {
      const wire = JSON.stringify([value]);
      db.run(`update public.calendar_posts set video_tweaks = ${pg.lit(wire)}, tweaks = ${pg.lit(wire)} where id = ${pg.lit(f.card)}`);
      const before = pg.snapshot(db);
      const held = await edge.invoke(candidate.handler, ctx.recover(), clientHeaders(f.client.token));
      eq(held.status, 409); eq(held.body.reason, 'source_cell_malformed'); assertUntouched(before, pg.snapshot(db));
    }
    const wire = JSON.stringify([{ ...entry, body: BODY }]);
    db.run(`update public.calendar_posts set video_tweaks = ${pg.lit(wire)}, tweaks = ${pg.lit(wire)} where id = ${pg.lit(f.card)}`);
    const before = pg.snapshot(db);
    const done = await edge.invoke(candidate.handler, ctx.recover(), clientHeaders(f.client.token));
    eq(done.status, 200); eq(done.body.outcome, 'already_present'); assertUntouched(before, pg.snapshot(db), ['materializations']);
  });

  eq(edge.externalRequests(), 0, 'no external request');
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.error = error.stack;
  process.exitCode = 1;
} finally {
  cluster.stop(); edge.cleanup();
  if (process.env.CALENDAR_RECOVERY_REPORT) fs.writeFileSync(process.env.CALENDAR_RECOVERY_REPORT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, checks: report.checks, groups: report.groups.length, failed: report.groups.filter(g => g.status !== 'PASS').map(g => g.name), error: report.error && report.error.split('\n').slice(0, 3).join(' | ') }));
}
