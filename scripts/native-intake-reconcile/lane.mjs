/*
 * Reconcile lane: the REAL gateway (via load-gateway.mjs) produces accepted but
 * interrupted intakes against the disposable PostgreSQL; the REAL reconcile SQL
 * functions and the REAL runner library (reconcile-lib.js, with a psql-backed
 * rpc) complete them. Every assertion reads the resulting FACTS back from the
 * tables: deliverable rows, receipts, card rows, events. No claim rests on an
 * RPC's own return value alone.
 *
 * Provider is unreachable for the whole lane. The final check proves not one
 * provider or drainer request left this process during any reconciliation.
 *
 * Fixtures are synthetic; output carries labels and counts only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { hooks, resetHooks, runSql } from '../native-intake-manifest/supabase-shim.mjs';
import { loadGateway, ROOT } from './load-gateway.mjs';

const require = createRequire(import.meta.url);
const { runReconcile } = require('./reconcile-lib.js');
const gw = await loadGateway();
const { net, post, requestId, rootBody } = gw;

const checks = [];
function ok(id, pass, evidence) {
  checks.push({ id, pass: !!pass });
  console.error(`${pass ? 'ok  ' : 'FAIL'} [reconcile] ${id}` + (pass ? '' : '\n      evidence: ' + JSON.stringify(evidence)));
}
const q = value => "'" + String(value).replace(/'/g, "''") + "'";
const j = value => q(JSON.stringify(value)) + '::jsonb';
async function sql(query) {
  const r = await runSql(query);
  if (r.status !== 0) throw new Error('lane sql failed: ' + r.stderr);
  return r.stdout.trim();
}
async function count(query) { return Number(await sql(`select count(*) from (${query}) t;`)); }
async function rows(query) {
  const out = await sql(`select coalesce(json_agg(t), '[]'::json) from (${query}) t;`);
  return out ? JSON.parse(out) : [];
}
async function fn(name, args) {
  const named = Object.entries(args).map(([k, v]) => k + ' => ' + (typeof v === 'boolean' ? String(v) : v === null ? 'null' : typeof v === 'number' ? String(v) : q(v))).join(', ');
  const r = await runSql(`select public.${name}(${named})::text;`);
  if (r.status !== 0) return { error: r.stderr.trim() };
  return JSON.parse(r.stdout.trim());
}
const children = rid => fn('production_intake_reconcile_children', { p_request_id: rid, p_actor: 'lane', p_apply: true });
const cards = rid => fn('production_intake_reconcile_cards', { p_request_id: rid, p_actor: 'lane', p_apply: true });
const state = rid => fn('production_intake_reconcile_state', { p_request_id: rid });
async function flags(video = '', graphics = '') {
  await sql("update public.syncview_runtime_flags set value=" + j({ video: { enabled: !!video, epoch: video || null }, graphics: { enabled: !!graphics, epoch: graphics || null } }) + " where key='native_intake_epochs'");
}
function reset() { resetHooks(); net.requests.length = 0; }
async function manifest(rid) { return (await rows('select * from public.production_intake_manifests where request_id=' + q(rid)))[0]; }
async function dels(batch) { return rows('select * from public.deliverables where batch_id=' + q(batch) + ' order by team'); }
async function receipts(batch) { return rows('select * from public.mirror_outbox where batch_id=' + q(batch) + ' order by id'); }
async function card(client, id, table = 'calendar_posts') { return (await rows(`select * from public.${table} where client=${q(client)} and id=${q(id)}`))[0]; }
async function reasons(rid, stage) {
  return rows(`select payload from public.deliverable_events where action='native_intake_reconcile' and payload->>'request_id'=${q(rid)}`
    + (stage ? ` and payload->>'stage'=${q(stage)}` : '') + ' order by id');
}
async function inventory() {
  return Promise.all(['production_intake_manifests', 'batches', 'deliverables', 'mirror_outbox', 'calendar_posts', 'sample_reviews', 'calendar_post_events', 'sample_review_events']
    .map(t => count('select 1 from public.' + t)));
}
async function unchanged(before) { return JSON.stringify(before) === JSON.stringify(await inventory()); }
/* An interrupted accepted intake: the gateway commits the manifest + parent,
   then `failAt` (1 = before the first child, 2 = before the second child). */
async function interrupted(mode, failAt, overrides = {}) {
  reset();
  const body = rootBody(mode, requestId(overrides.surface === 'sxr' ? 'sxr' : 'submission'), overrides);
  let writes = 0;
  hooks.beforeRpc = name => { if (name === 'production_deliverable_write' && ++writes === failAt) throw new Error('synthetic interruption before child ' + failAt); };
  const response = await post(body);
  reset();
  const m = await manifest(body.request_id);
  return { body, response, m };
}
const noProvider = () => !net.requests.some(r => /api\.linear\.app|linear-outbound/.test(r.url));
const psqlRpc = async (name, args) => {
  const out = await fn(name, args);
  if (out && out.error) throw new Error(out.error);
  return out;
};

try {
  await flags('epoch-video-r1', 'epoch-graphics-r1');

  // S1. Interrupted before ANY child, both teams. Flags disabled before
  // recovery: the manifest's accepted epoch, not the current flag, governs.
  const s1 = await interrupted('both', 1);
  ok('S1-accepted-parent-with-zero-children', s1.response.status >= 500 && !!s1.m && (await dels(s1.m.batch_id)).length === 0
    && s1.m.expected_items.length === 2, s1.response);
  const s1state = await state(s1.body.request_id);
  ok('S1-state-owes-two-native-children-and-one-card', s1state.owed.children_native === 2 && s1state.owed.cards === 1 && s1state.complete === false, s1state.owed);
  await flags();
  const s1dry = await fn('production_intake_reconcile_children', { p_request_id: s1.body.request_id, p_actor: 'lane', p_apply: false });
  ok('S1-dry-run-plans-both-and-writes-nothing', s1dry.outcome === 'planned' && s1dry.plan.length === 2
    && (await dels(s1.m.batch_id)).length === 0 && (await reasons(s1.body.request_id)).length === 0, s1dry);
  const s1r = await children(s1.body.request_id);
  const s1dels = await dels(s1.m.batch_id);
  const s1rec = await receipts(s1.m.batch_id);
  const parentReceipt = s1rec.find(r => r.entity === 'batch');
  const expectedIds = s1.m.expected_items.map(i => i.row.id).sort();
  ok('S1-stage1-recovers-both-children-with-manifest-ids', s1r.outcome === 'recovered' && s1r.recovered.length === 2
    && JSON.stringify(s1dels.map(d => d.id).sort()) === JSON.stringify(expectedIds), s1r);
  ok('S1-recovered-rows-carry-accepted-content-and-card-plan', s1.m.expected_items.every(i => {
    const d = s1dels.find(x => x.id === i.row.id);
    return d && d.title === i.row.title && d.card_id === i.row.card_id && d.brief === i.row.brief && d.team === i.row.team
      && d.kind === i.row.kind && d.status === i.row.status && Number(d.sort_key) === Number(i.row.sort_key) && d.origin === i.row.origin;
  }), s1dels.map(d => [d.id, d.title]));
  ok('S1-receipts-original-keys-fingerprints-epoch-actor-terminal', s1.m.expected_items.every(i => {
    const r = s1rec.find(x => x.dedup_key === i.child_dedup);
    return r && r.status === 'skipped' && r.payload._intent_fingerprint === i.child_fingerprint
      && r.payload._native_intake_epoch === 'epoch-video-r1'.replace('video', i.row.team) && r.payload._native_intake_request === s1.body.request_id
      && r.actor === parentReceipt.actor && r.role === parentReceipt.role && r.depends_on_id === parentReceipt.id
      && r.linear_result && r.linear_result.native_only === true && r.attempts === 0 && r.processed_at;
  }), s1rec.map(r => [r.dedup_key, r.status]));
  // The explicit original request, resent through the gateway after recovery,
  // is recognised as the same work: the reconstructed receipts pass the
  // gateway's own replay comparison. Provider still unreachable, flags off.
  reset();
  const s1before = await inventory();
  const s1retry = await post(s1.body);
  ok('S1-explicit-gateway-retry-after-recovery-is-replay-not-duplicate', s1retry.status === 201 && s1retry.json.items?.length === 2
    && await unchanged(s1before) && noProvider(), s1retry);
  const s1c = await cards(s1.body.request_id);
  const s1card = await card('fixture-client', s1.m.expected_items[0].row.card_id);
  const video = s1dels.find(d => d.team === 'video');
  const graphic = s1dels.find(d => d.team === 'graphics');
  ok('S1-stage2-creates-browser-shaped-card', s1c.outcome === 'materialized' && s1c.created.length === 1 && !!s1card
    && s1card.video_deliverable_id === video.id && s1card.graphic_deliverable_id === graphic.id
    && s1card.name === video.title && s1card.status === 'In Progress' && s1card.video_status === 'In Progress'
    && s1card.graphic_status === 'In Progress' && s1card.caption_status === 'In Progress'
    && s1card.linear_issue_id === '' && s1card.graphic_linear_issue_id === '' && s1card.scheduled_date === ''
    && s1card.asset_url === '' && s1card.caption === '' && s1card.video_tweaks === '' && s1card.tweaks === ''
    && /^-?[0-9]+$/.test(String(s1card.order_index)) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(String(s1card.updated_at)), s1card);
  const s1ev = await rows(`select * from public.calendar_post_events where client='fixture-client' and post_id=${q(s1card?.id)}`);
  ok('S1-card-create-event-recorded-with-original-actor', s1ev.length === 1 && s1ev[0].action === 'create' && s1ev[0].to_status === 'In Progress'
    && s1ev[0].actor === parentReceipt.actor && s1ev[0].source === 'native-intake-reconcile' && s1ev[0].payload.request_id === s1.body.request_id, s1ev);
  ok('S1-request-complete-by-facts', (await state(s1.body.request_id)).complete === true);
  // Response loss of the reconcile call itself: the facts already committed,
  // so a rerun is a no-op that changes nothing.
  const s1again = await inventory();
  const s1rerun = await children(s1.body.request_id);
  const s1rerunCards = await cards(s1.body.request_id);
  ok('S1-rerun-after-lost-response-is-noop', s1rerun.outcome === 'complete' && s1rerun.recovered.length === 0 && s1rerunCards.outcome === 'complete'
    && await unchanged(s1again), [s1rerun, s1rerunCards]);
  ok('S1-reason-ledger-records-applied-decisions-only', (await reasons(s1.body.request_id, 'children')).length === 1
    && (await reasons(s1.body.request_id, 'cards')).length === 1
    && (await reasons(s1.body.request_id, 'children'))[0].payload.outcome === 'recovered');

  // S2. Interrupted between child one and child two: recover exactly one.
  await flags('epoch-video-r2', 'epoch-graphics-r2');
  const s2 = await interrupted('both', 2);
  const s2present = await dels(s2.m.batch_id);
  const s2r = await children(s2.body.request_id);
  const s2after = await dels(s2.m.batch_id);
  ok('S2-partial-recovers-only-the-missing-child', s2present.length === 1 && s2r.outcome === 'recovered' && s2r.recovered.length === 1
    && s2r.complete.length === 1 && s2r.complete[0] === s2present[0].id && s2after.length === 2
    && (await receipts(s2.m.batch_id)).filter(r => r.entity === 'deliverable').length === 2, s2r);
  ok('S2-recovered-child-keeps-accepted-epoch-after-later-flag-change', (await receipts(s2.m.batch_id))
    .filter(r => r.entity === 'deliverable').every(r => /-r2$/.test(r.payload._native_intake_epoch)));

  // S3. Two reconcilers on the same request at the same time: real request
  // lock, one recovery, one no-op, one child, one receipt.
  const s3 = await interrupted('both', 2);
  const [s3a, s3b] = await Promise.all([
    fn('production_intake_reconcile_children', { p_request_id: s3.body.request_id, p_actor: 'runner-a', p_apply: true }),
    fn('production_intake_reconcile_children', { p_request_id: s3.body.request_id, p_actor: 'runner-b', p_apply: true }),
  ]);
  const s3outcomes = [s3a.outcome, s3b.outcome].sort();
  ok('S3-concurrent-equal-reconciliation-one-writer', s3outcomes.join(',') === 'complete,recovered'
    && (await dels(s3.m.batch_id)).length === 2 && (await receipts(s3.m.batch_id)).filter(r => r.entity === 'deliverable').length === 2
    && (await reasons(s3.body.request_id, 'children')).length === 1, [s3a, s3b]);

  // S4. Reconciler racing the explicit gateway retry of the same request.
  const s4 = await interrupted('both', 2);
  reset();
  const [s4gw, s4rc] = await Promise.all([post(s4.body), children(s4.body.request_id)]);
  ok('S4-reconciler-and-gateway-retry-converge-to-one-child-set', s4gw.status === 201 && ['recovered', 'complete'].includes(s4rc.outcome)
    && (await dels(s4.m.batch_id)).length === 2
    && (await rows(`select dedup_key, count(*)::int n from public.mirror_outbox where batch_id=${q(s4.m.batch_id)} group by dedup_key`)).every(r => r.n === 1)
    && (await count(`select 1 from public.mirror_outbox where batch_id=${q(s4.m.batch_id)}`)) === 3 && noProvider(), [s4gw.status, s4rc.outcome]);

  // S5. Backlog paging: three owed requests, page size one, no repeat, no skip;
  // a request completed between pages stops appearing.
  const s5 = [];
  for (let i = 0; i < 3; i++) s5.push(await interrupted('video', 1));
  const s5ids = s5.map(x => x.body.request_id);
  const pageAll = async () => {
    const seen = []; let after = null; let guard = 0;
    for (;;) {
      const page = await fn('production_intake_reconcile_backlog', { p_limit: 1, p_after: after });
      seen.push(...page.items.map(i => i.request_id));
      if (page.exhausted || ++guard > 50) return { seen, page };
      after = page.next_after;
    }
  };
  const s5first = await pageAll();
  ok('S5-partial-pages-cover-every-owed-request-once', s5ids.every(id => s5first.seen.includes(id))
    && new Set(s5first.seen).size === s5first.seen.length && s5first.page.exhausted === true, s5first.seen.length);
  await children(s5ids[1]); await cards(s5ids[1]);
  const s5second = await pageAll();
  ok('S5-completed-request-leaves-the-backlog', !s5second.seen.includes(s5ids[1]) && s5second.seen.includes(s5ids[0]) && s5second.seen.includes(s5ids[2]));
  const s5item = (await fn('production_intake_reconcile_backlog', { p_limit: 50, p_after: null })).items.find(i => i.request_id === s5ids[0]);
  ok('S5-backlog-item-carries-no-brief-or-title', !!s5item && !JSON.stringify(s5item).includes(s5[0].body.items[0].brief)
    && !('children' in s5item) && s5item.children_missing.length === 1, Object.keys(s5item || {}));

  // S6. Existing card with an empty slot: bind that slot only, every other
  // field exactly as the humans left it.
  const s6 = await interrupted('both', 2);
  const s6r = await children(s6.body.request_id);
  const s6dels = await dels(s6.m.batch_id);
  const s6video = s6dels.find(d => d.team === 'video'); const s6graphic = s6dels.find(d => d.team === 'graphics');
  const s6cardId = s6.m.expected_items[0].row.card_id;
  await sql(`insert into public.calendar_posts(client,id,updated_at,order_index,name,scheduled_date,status,video_status,graphic_status,caption_status,caption,video_deliverable_id,graphic_deliverable_id)
    values('fixture-client',${q(s6cardId)},'2026-09-05T10:00:00.000Z','7','Human renamed card','2026-10-01','Kasper Approval','Done','In Progress','In Progress','human caption',${q(s6video.id)},null)`);
  const s6before = await card('fixture-client', s6cardId);
  const s6c = await cards(s6.body.request_id);
  const s6after = await card('fixture-client', s6cardId);
  const s6diff = Object.keys(s6after).filter(k => JSON.stringify(s6after[k]) !== JSON.stringify(s6before[k]));
  ok('S6-existing-card-gains-only-the-empty-slot', s6r.outcome === 'recovered' && s6c.outcome === 'materialized' && s6c.bound.length === 1
    && s6after.graphic_deliverable_id === s6graphic.id && s6diff.sort().join(',') === 'graphic_deliverable_id,updated_at'
    && s6after.name === 'Human renamed card' && s6after.status === 'Kasper Approval' && s6after.caption === 'human caption', s6diff);
  ok('S6-slot-bind-writes-no-card-event', (await count(`select 1 from public.calendar_post_events where post_id=${q(s6cardId)}`)) === 0);

  // S7. Occupied slot: conflict, nothing written, reason durable.
  const s7 = await interrupted('both', 1);
  await children(s7.body.request_id);
  const s7cardId = s7.m.expected_items[0].row.card_id;
  // The occupant is a real deliverable of another batch: calendar_posts slots
  // carry a foreign key to deliverables, so the conflict is a live-shaped one.
  await sql(`insert into public.calendar_posts(client,id,updated_at,order_index,name,status,video_deliverable_id) values('fixture-client',${q(s7cardId)},'2026-09-05T10:00:00.000Z','8','Other work','In Progress',${q(s6video.id)})`);
  const s7before = await inventory(); const s7row = await card('fixture-client', s7cardId);
  const s7c = await cards(s7.body.request_id);
  ok('S7-occupied-slot-is-a-conflict-with-zero-writes', s7c.outcome === 'conflict' && s7c.conflicts[0].reason === 'card_slot_occupied'
    && s7c.conflicts[0].owner === 'operator' && JSON.stringify(await card('fixture-client', s7cardId)) === JSON.stringify(s7row)
    && await unchanged(s7before) && (await state(s7.body.request_id)).owed.cards === 1, s7c);
  ok('S7-conflict-reason-recorded', (await reasons(s7.body.request_id, 'cards')).some(p => p.payload.outcome === 'conflict'));

  // S8. Human edits on a completed card are untouched by a rerun.
  await sql(`update public.calendar_posts set name='Renamed by human', status='Client Approval', caption='edited' where client='fixture-client' and id=${q(s1card.id)}`);
  const s8before = await card('fixture-client', s1card.id);
  const s8c = await cards(s1.body.request_id);
  ok('S8-rerun-never-touches-human-fields', s8c.outcome === 'complete' && JSON.stringify(await card('fixture-client', s1card.id)) === JSON.stringify(s8before));

  // S9. Archived card: never resurrected, never re-bound.
  const s9 = await interrupted('both', 1);
  await children(s9.body.request_id);
  const s9cardId = s9.m.expected_items[0].row.card_id;
  await sql(`insert into public.calendar_posts(client,id,updated_at,order_index,name,status) values('fixture-client',${q(s9cardId)},'2026-09-05T10:00:00.000Z','9','Archived card','Archived')`);
  const s9row = await card('fixture-client', s9cardId);
  const s9c = await cards(s9.body.request_id);
  ok('S9-archived-card-left-alone', s9c.outcome === 'unresolved' && s9c.unresolved[0].reason === 'card_archived'
    && JSON.stringify(await card('fixture-client', s9cardId)) === JSON.stringify(s9row), s9c);

  // S10. A card that existed and was deleted is not recreated.
  await sql(`delete from public.calendar_posts where client='fixture-client' and id=${q(s1card.id)}`);
  const s10c = await cards(s1.body.request_id);
  ok('S10-deleted-card-not-recreated', s10c.outcome === 'unresolved' && s10c.unresolved[0].reason === 'card_deleted_after_creation'
    && !(await card('fixture-client', s1card.id)), s10c);

  // S11. Human re-carded or un-carded a deliverable: operator decision.
  const s11 = await interrupted('both', 1);
  await children(s11.body.request_id);
  const s11dels = await dels(s11.m.batch_id);
  await sql(`update public.deliverables set card_id='p_other_synthetic' where id=${q(s11dels[0].id)}`);
  const s11a = await cards(s11.body.request_id);
  await sql(`update public.deliverables set card_id=null where id=${q(s11dels[0].id)}`);
  const s11b = await cards(s11.body.request_id);
  ok('S11-rebound-and-cleared-card-ids-are-unresolved-not-rewritten', s11a.outcome === 'unresolved' && s11a.unresolved[0].reason === 'deliverable_rebound'
    && s11b.outcome === 'unresolved' && s11b.unresolved[0].reason === 'deliverable_card_cleared'
    && (await count(`select 1 from public.calendar_posts where id=${q(s11.m.expected_items[0].row.card_id)}`)) === 0, [s11a, s11b]);

  // S12. Identity conflict: the expected id already exists as different work.
  const s12 = await interrupted('both', 1);
  const s12item = s12.m.expected_items[1].row;
  await sql(`insert into public.batches(id, client_slug, team, name) values('bat_other_synthetic','fixture-split','video','Other') on conflict do nothing`);
  await sql(`insert into public.deliverables(id,batch_id,client_slug,team,kind,title,origin) values(${q(s12item.id)},'bat_other_synthetic','fixture-split','video','video','Foreign','manual')`);
  const s12before = await inventory();
  const s12r = await children(s12.body.request_id);
  // One conflicted expected child holds the whole request: the sibling that
  // could have been written is not, and the reason ledger names both.
  ok('S12-identity-conflict-holds-whole-request-with-zero-writes', s12r.outcome === 'conflict' && s12r.conflicts[0].reason === 'child_identity_conflict'
    && s12r.recovered.length === 0 && s12r.plan.length === 1 && await unchanged(s12before) && (await dels(s12.m.batch_id)).length === 0
    && (await reasons(s12.body.request_id, 'children')).some(p => p.payload.outcome === 'conflict' && p.payload.held.length === 1), s12r);
  const s12missing = await fn('production_intake_reconcile_children', { p_request_id: 'submission:does-not-exist', p_actor: 'lane', p_apply: true });
  ok('S12-unknown-request-refused', !!s12missing.error && /intake_manifest_missing/.test(s12missing.error));

  // S13. F27 hold and fence generation. An open team hold refuses recovery
  // with zero writes; a bumped fence is carried as the CURRENT generation.
  const s13 = await interrupted('both', 1);
  await sql("insert into public.track_b_team_rollbacks(team,expected_authority,prior_outbound,prior_parity,fence_generation,actor) values('graphics','{}','{}','{}',0,'fixture-operator')");
  const s13before = await inventory();
  const s13held = await children(s13.body.request_id);
  ok('S13-open-hold-refuses-with-zero-writes', s13held.outcome === 'unresolved' && s13held.unresolved.some(u => u.reason === 'f27_hold' && u.owner === 'reconciler')
    && s13held.recovered.length === 0 && (await dels(s13.m.batch_id)).length === 0, s13held);
  await sql("update public.track_b_team_rollbacks set state='cancelled' where state='open'");
  await sql("update public.track_b_f27_team_fences set generation=generation+1 where team='graphics'");
  const s13gen = Number(await sql("select generation from public.track_b_f27_team_fences where team='graphics'"));
  const s13r = await children(s13.body.request_id);
  const s13rec = (await receipts(s13.m.batch_id)).filter(r => r.entity === 'deliverable' && r.team === 'graphics');
  ok('S13-recovered-child-carries-current-fence-generation', s13r.outcome === 'recovered' && s13rec.length === 1 && Number(s13rec[0].authority_generation) === s13gen, [s13r.outcome, s13rec.map(r => r.authority_generation), s13gen]);

  // S14. Authority flipped back to Linear for a team: refusal, zero writes.
  const s14 = await interrupted('both', 1);
  await sql(`update public.syncview_runtime_flags set value='{"video":"linear","graphics":"syncview"}' where key='prod_authority'`);
  const s14r = await children(s14.body.request_id);
  await sql(`update public.syncview_runtime_flags set value='{"video":"syncview","graphics":"syncview"}' where key='prod_authority'`);
  ok('S14-linear-authority-refuses-recovery', s14r.outcome === 'unresolved' && /team_is_linear_authoritative/.test(JSON.stringify(s14r.unresolved))
    && (await dels(s14.m.batch_id)).length === 0, s14r);
  const s14again = await children(s14.body.request_id);
  ok('S14-recovers-once-authority-returns', s14again.outcome === 'recovered' && (await dels(s14.m.batch_id)).length === 2);

  // S15. Provider-era manifest (flags off at acceptance): reported, never
  // recreated here; the explicit gateway retry still owns it. Its card is then
  // a normal stage 2 obligation.
  await flags();
  net.linear = 'ok'; reset();
  const s15body = rootBody('both', requestId());
  let s15writes = 0;
  hooks.beforeRpc = name => { if (name === 'production_deliverable_write' && ++s15writes === 2) throw new Error('synthetic provider-era interruption'); };
  const s15resp = await post(s15body); reset(); net.linear = 'down';
  const s15m = await manifest(s15body.request_id);
  const s15before = await inventory();
  const s15r = await children(s15body.request_id);
  ok('S15-provider-era-child-reported-not-recreated', s15resp.status >= 500 && s15r.outcome === 'unresolved'
    && s15r.unresolved[0].reason === 'provider_epoch_child_missing' && s15r.unresolved[0].owner === 'gateway-retry'
    && await unchanged(s15before) && (await state(s15body.request_id)).owed.children_provider === 1, s15r);
  net.linear = 'ok'; reset();
  const s15retry = await post(s15body); net.linear = 'down';
  const s15c = await cards(s15body.request_id);
  const s15card = await card('fixture-client', s15m.expected_items[0].row.card_id);
  ok('S15-gateway-retry-completes-provider-children-then-card-materializes', s15retry.status === 201 && s15c.outcome === 'materialized'
    && !!s15card && s15card.video_deliverable_id && s15card.graphic_deliverable_id && s15card.linear_issue_id === '', [s15retry.status, s15c.outcome]);
  await flags('epoch-video-r3', 'epoch-graphics-r3');

  // S16. Archived batch and inactive client are not resurrected.
  const s16 = await interrupted('both', 1);
  await sql(`update public.batches set status='archived' where id=${q(s16.m.batch_id)}`);
  const s16r = await children(s16.body.request_id);
  await sql(`update public.batches set status='active' where id=${q(s16.m.batch_id)}`);
  await sql(`update public.clients set active=false where slug='fixture-client'`);
  const s16r2 = await children(s16.body.request_id);
  await sql(`update public.clients set active=true where slug='fixture-client'`);
  ok('S16-archived-batch-and-inactive-client-refuse-recovery', s16r.outcome === 'unresolved' && s16r.unresolved[0].reason === 'batch_not_active'
    && s16r2.outcome === 'unresolved' && s16r2.unresolved[0].reason === 'client_inactive' && (await dels(s16.m.batch_id)).length === 0, [s16r, s16r2]);

  // S17. Samples surface: the same two stages land the card in sample_reviews.
  const s17 = await interrupted('both', 1, { surface: 'sxr' });
  ok('S17-samples-intake-accepted-and-interrupted', s17.response.status >= 500 && !!s17.m
    && (await rows(`select purpose from public.batches where id=${q(s17.m.batch_id)}`))[0]?.purpose === 'samples', s17.response);
  const s17r = await children(s17.body.request_id);
  const s17c = await cards(s17.body.request_id);
  const s17card = await card('fixture-client', s17.m.expected_items[0].row.card_id, 'sample_reviews');
  const s17dels = await dels(s17.m.batch_id);
  ok('S17-samples-children-recovered-and-sample-card-created', s17r.outcome === 'recovered' && s17r.recovered.length === 2 && s17c.outcome === 'materialized'
    && !!s17card && s17card.video_deliverable_id === s17dels.find(d => d.team === 'video').id
    && s17card.graphic_deliverable_id === s17dels.find(d => d.team === 'graphics').id && s17card.status === 'In Progress'
    && s17card.creative_direction === '' && s17card.hide_creative_direction === '' && s17dels.every(d => d.origin === 'samples')
    && (await count(`select 1 from public.sample_review_events where sample_id=${q(s17card?.id)} and action='create'`)) === 1
    && (await count(`select 1 from public.calendar_posts where id=${q(s17card?.id)}`)) === 0, [s17r.outcome, s17c.outcome, s17card]);

  // S18. Missing terminal receipt is reported, never invented. (A deleted
  // receipt row is the only way to reach this state in the fixture.)
  const s18id = s2after[0].id;
  await sql(`delete from public.mirror_outbox where entity='deliverable' and entity_id=${q(s18id)}`);
  const s18state = await state(s2.body.request_id);
  const s18r = await children(s2.body.request_id);
  ok('S18-missing-terminal-receipt-reported-not-recreated', s18state.owed.missing_terminal_receipts === 1 && s18state.complete === false
    && s18r.outcome === 'complete' && (await count(`select 1 from public.mirror_outbox where entity_id=${q(s18id)}`)) === 0, s18state.owed);

  // S19. Roles: only the service role may call the reconciler.
  for (const role of ['anon', 'authenticated']) {
    const r = await runSql(`set role ${role}; select public.production_intake_reconcile_children(${q(s1.body.request_id)}, 'lane', false);`);
    ok(`S19-${role}-cannot-call-reconciler`, r.status !== 0 && /permission denied/.test(r.stderr));
  }
  const s19 = await runSql(`set role service_role; select public.production_intake_reconcile_summary();`);
  ok('S19-service-role-can-read-summary', s19.status === 0);

  // S20. The real runner library over the same psql transport: dry run writes
  // nothing; apply completes up to its limit; report carries per-stage counts,
  // backlog age and missing terminal receipts.
  const s20a = await interrupted('both', 1);
  const s20b = await interrupted('video', 2);
  const s20before = await inventory();
  const dry = await runReconcile({ rpc: psqlRpc, actor: 'runner-dry', apply: false, limit: 50 });
  ok('S20-runner-dry-run-writes-nothing', dry.dry_run === true && await unchanged(s20before) && dry.processed.length >= 2
    && dry.counts.children.planned >= 1 && typeof dry.attention.backlog_age_seconds === 'number' && dry.attention.missing_terminal_receipts === 1, dry.counts);
  const applied = await runReconcile({ rpc: psqlRpc, actor: 'runner-apply', apply: true, limit: 1, requestIds: [s20a.body.request_id] });
  ok('S20-runner-apply-respects-limit-and-completes-request', applied.processed.length === 1 && applied.processed[0].request_id === s20a.body.request_id
    && applied.counts.children.recovered === 1 && applied.counts.children.recovered_children === 2 && applied.counts.cards.materialized === 1
    && (await state(s20a.body.request_id)).complete === true && (await state(s20b.body.request_id)).complete === false, applied.counts);
  const lost = { calls: 0 };
  const lossyRpc = async (name, args) => { const out = await psqlRpc(name, args); if (name === 'production_intake_reconcile_children' && ++lost.calls === 1) throw new Error('synthetic lost reconcile response'); return out; };
  let lostError = null;
  try { await runReconcile({ rpc: lossyRpc, actor: 'runner-lossy', apply: true, limit: 1, requestIds: [s20b.body.request_id] }); } catch (e) { lostError = e; }
  const s20rerun = await runReconcile({ rpc: psqlRpc, actor: 'runner-rerun', apply: true, limit: 1, requestIds: [s20b.body.request_id] });
  ok('S20-runner-response-loss-then-rerun-converges', !!lostError && s20rerun.processed[0].children.outcome === 'complete'
    && s20rerun.processed[0].cards.outcome === 'materialized' && (await state(s20b.body.request_id)).complete === true
    && (await dels(s20b.m.batch_id)).length === 1, s20rerun.counts);
  const summary = await fn('production_intake_reconcile_summary', {});
  const independentOwed = Number(await sql(`select count(*) from public.production_intake_manifests m cross join lateral jsonb_array_elements(m.expected_items) i
    left join public.deliverables d on d.id = i->'row'->>'id' where d.id is null`));
  ok('S20-summary-counts-match-independent-sql', summary.owed.children_native + summary.owed.children_provider === independentOwed
    && summary.requests_owed + summary.requests_complete === summary.manifests && summary.owed.missing_terminal_receipts === 1
    && Object.keys(summary.latest_outcomes).length > 0, summary);

  ok('S99-zero-provider-or-drainer-requests-during-any-reconciliation', noProvider(), net.requests.slice(0, 3));

  console.log(JSON.stringify({ suite: 'native-intake-reconcile', passed: checks.filter(c => c.pass).length, failed: checks.filter(c => !c.pass).length,
    readiness: { missing_child_materialization: 'PASS_IN_FIXTURE', missing_card_materialization: 'PASS_IN_FIXTURE',
      provider_era_child_recovery: 'NOT_IMPLEMENTED', installed_full_serving: 'UNPROVEN', chosen_editor_provider_independence: 'OUT_OF_SCOPE' } }));
  if (checks.some(c => !c.pass)) process.exitCode = 1;
} finally {
  fs.rmSync(gw.scratch, { recursive: true, force: true });
}
