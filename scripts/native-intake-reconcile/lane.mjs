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
import vm from 'node:vm';
import { hooks, resetHooks, runSql } from '../native-intake-manifest/supabase-shim.mjs';
import { loadGateway, ROOT } from './load-gateway.mjs';
import { loadWriters } from './load-writers.mjs';

const require = createRequire(import.meta.url);
const { runReconcile } = require('./reconcile-lib.js');
const gw = await loadGateway();
const { net, post, requestId, rootBody } = gw;
/* The REPOSITORY sources of the two card writers, through the same seam. Their
   write semantics are what the browser materialization exercises below; the
   serving v48/v49 bodies are a different, un-gated deployment this lane cannot
   see and does not claim. */
const writers = await loadWriters();

/* THE ACTUAL BROWSER MATERIALIZATION FUNCTION, extracted from index.html and
   run against the real writers. Only its environment is substituted: no staff
   identity (client-link mode, which returns before the staff binding), an
   in-memory cache, a checkpoint recorder, and fetch wrappers that call the
   loaded writer handlers directly. The payload it sends is the payload an old
   tab or a saved job sends today. */
const { extractFunction } = await import(pathToFileURL(path.join(ROOT, 'test', 'helpers', 'extract-function.js')).href)
  .then(m => m.default || m);
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const bctx = {
  console, _isIntake: true, __sent: [], __checkpoints: [], __calCache: null, __sxrCache: null,
  _linearIntakeCheckpointOrSuspend: job => { bctx.__checkpoints.push(JSON.parse(JSON.stringify(job))); },
  _calCacheRead: () => bctx.__calCache, _sxrCacheRead: () => bctx.__sxrCache,
  _calCacheWrite: () => {}, _sxrCacheWrite: () => {},
  _calUpsertFetch: async (slug, payload, source) => { bctx.__sent.push({ writer: 'calendar-upsert', payload, source }); return writers.post('calendar-upsert', payload, source); },
  _sxrUpsertFetch: async (slug, payload, source) => { bctx.__sent.push({ writer: 'sample-review-upsert', payload, source }); return writers.post('sample-review-upsert', payload, source); },
};
vm.createContext(bctx);
vm.runInContext([
  'async ' + extractFunction(html, '_writeNativeSubmissionCardsToCalendar'),
  extractFunction(html, '_linearIntakeValidateResult'),
  extractFunction(html, '_linearIntakeRequireActor'),
].join('\n'), bctx);
async function browserResume(job) {
  bctx.__sent.length = 0; bctx.__checkpoints.length = 0;
  try { await bctx._writeNativeSubmissionCardsToCalendar(job); return { ok: true, sent: bctx.__sent.slice(), job }; }
  catch (error) { return { ok: false, error: String(error && error.message || error), sent: bctx.__sent.slice(), job }; }
}
function savedJob(body, response) {
  return { payload: body, result: response.json, completed_card_ids: [], context: {}, stage: 'materializing_cards' };
}

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
  // The card writers normalize the client slug (lower-case alphanumerics). Live
  // slugs already have that shape; the harness slug carries a hyphen, so every
  // scenario in which the browser finishes a card uses a second synthetic
  // client whose slug the writers leave unchanged.
  const BC = 'fixturecard';
  await sql(`insert into public.clients(slug, display_name, active, kind, linear_project_ids)
    values (${q(BC)}, 'Fixture Card', true, 'client', '{"video":"proj_fixture_shared","graphics":"proj_fixture_shared"}'::jsonb) on conflict (slug) do nothing`);
  // The writers insert their card events through EdgeRuntime.waitUntil after
  // the row commit; the lane waits for those before reading the event tables.
  const settle = () => Promise.all(gw.background.splice(0));
  async function provenance(surface, client, cardId) {
    return rows(`select kind, snapshot, source from public.production_card_provenance where surface=${q(surface)} and client=${q(client)} and card_id=${q(cardId)} order by id`);
  }
  const preserved = (before, after, allowed) => !!before && !!after
    && Object.keys(after).filter(k => JSON.stringify(after[k]) !== JSON.stringify(before[k])).every(k => allowed.includes(k));


  // S1. Interrupted before ANY child, both teams. Flags disabled before
  // recovery: the manifest's accepted epoch, not the current flag, governs.
  const s1 = await interrupted('both', 1, { client_slug: BC });
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
  // Stage 2 NEVER creates the card. The missing card is held as VISIBLE debt:
  // a durable reason, a backlog entry and a summary count, and not one write.
  const s1cardId = s1.m.expected_items[0].row.card_id;
  const s1held = await inventory();
  const s1c = await cards(s1.body.request_id);
  const s1backlog = (await fn('production_intake_reconcile_backlog', { p_limit: 50, p_after: null })).items.find(i => i.request_id === s1.body.request_id);
  ok('S1-stage2-holds-missing-card-as-visible-debt-and-creates-nothing', s1c.outcome === 'unresolved' && s1c.created.length === 0 && s1c.bound.length === 0
    && s1c.unresolved.length === 1 && s1c.unresolved[0].reason === 'card_creation_held' && s1c.unresolved[0].owner === 'operator'
    && !(await card(BC, s1cardId)) && await unchanged(s1held) && (await state(s1.body.request_id)).owed.cards === 1
    && !!s1backlog && s1backlog.cards_incomplete.includes(s1cardId) && (await fn('production_intake_reconcile_summary', {})).owed.cards >= 1, s1c);
  // The card's creation stays with its original owner: the browser job, fed
  // the gateway's replay response, creates it through the real writer, and the
  // trigger records the created fact with the slots it was created with.
  const s1resume = await browserResume(savedJob(s1.body, s1retry));
  await settle();
  const s1card = await card(BC, s1cardId);
  const video = s1dels.find(d => d.team === 'video');
  const graphic = s1dels.find(d => d.team === 'graphics');
  const s1prov = await provenance('calendar', BC, s1cardId);
  ok('S1-browser-job-creates-the-card-through-the-real-writer-after-recovery', s1resume.ok && s1resume.sent.length === 1 && !!s1card
    && s1card.video_deliverable_id === video.id && s1card.graphic_deliverable_id === graphic.id && s1card.status === 'In Progress'
    && s1prov.length === 1 && s1prov[0].kind === 'created' && s1prov[0].source === null
    && s1prov[0].snapshot.video_deliverable_id === video.id && s1prov[0].snapshot.graphic_deliverable_id === graphic.id,
    { resume: s1resume.error, sent: s1resume.sent.length, prov: s1prov.map(p => p.kind) });
  const s1ev = await rows(`select action from public.calendar_post_events where client=${q(BC)} and post_id=${q(s1cardId)}`);
  ok('S1-writer-create-event-recorded-for-the-browser-created-card', s1ev.length >= 1 && s1ev.some(e => e.action === 'create'), s1ev);
  ok('S1-request-complete-by-facts-once-the-card-exists', (await state(s1.body.request_id)).complete === true && (await cards(s1.body.request_id)).outcome === 'complete');
  // Response loss of the reconcile call itself: the facts already committed,
  // so a rerun is a no-op that changes nothing.
  const s1again = await inventory();
  const s1rerun = await children(s1.body.request_id);
  const s1rerunCards = await cards(s1.body.request_id);
  ok('S1-rerun-after-lost-response-is-noop', s1rerun.outcome === 'complete' && s1rerun.recovered.length === 0 && s1rerunCards.outcome === 'complete'
    && await unchanged(s1again), [s1rerun, s1rerunCards]);
  const s1cardReasons = await reasons(s1.body.request_id, 'cards');
  ok('S1-reason-ledger-records-applied-decisions-only', (await reasons(s1.body.request_id, 'children')).length === 1
    && s1cardReasons.length === 1 && s1cardReasons[0].payload.outcome === 'unresolved' && s1cardReasons[0].payload.unresolved[0].reason === 'card_creation_held'
    && (await reasons(s1.body.request_id, 'children'))[0].payload.outcome === 'recovered', s1cardReasons.map(r => r.payload.outcome));

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
  for (let i = 0; i < 3; i++) s5.push(await interrupted('video', 1, { client_slug: BC }));
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
  await children(s5ids[1]);
  const s5held = await cards(s5ids[1]);
  const s5mid = await pageAll();
  reset();
  const s5retry = await post(s5[1].body);
  const s5resume = await browserResume(savedJob(s5[1].body, s5retry));
  await settle();
  const s5second = await pageAll();
  ok('S5-held-card-keeps-the-request-in-the-backlog-until-the-browser-creates-it', s5held.outcome === 'unresolved'
    && s5held.unresolved[0].reason === 'card_creation_held' && s5mid.seen.includes(s5ids[1])
    && s5retry.status === 201 && s5resume.ok && !s5second.seen.includes(s5ids[1]) && s5second.seen.includes(s5ids[0]) && s5second.seen.includes(s5ids[2]),
    { held: s5held.outcome, mid: s5mid.seen.length, after: s5second.seen.length, resume: s5resume.error });
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
  // S6b. The same empty slot, but the card was CREATED with it bound and a
  // person cleared it afterwards: held, never re-bound. The created fact and
  // the slots_changed fact are what the reconciler reads.
  const s6b = await interrupted('both', 2);
  await children(s6b.body.request_id);
  const s6bdels = await dels(s6b.m.batch_id);
  const s6bcard = s6b.m.expected_items[0].row.card_id;
  await sql(`insert into public.calendar_posts(client,id,updated_at,order_index,name,status,video_deliverable_id,graphic_deliverable_id)
    values('fixture-client',${q(s6bcard)},'2026-09-05T10:00:00.000Z','7','Cleared by a person','In Progress',${q(s6bdels.find(d => d.team === 'video').id)},${q(s6bdels.find(d => d.team === 'graphics').id)})`);
  await sql(`update public.calendar_posts set graphic_deliverable_id=null where client='fixture-client' and id=${q(s6bcard)}`);
  const s6brow = await card('fixture-client', s6bcard);
  const s6bc = await cards(s6b.body.request_id);
  ok('S6b-slot-cleared-after-creation-is-held-not-rebound', s6bc.outcome === 'unresolved' && s6bc.unresolved[0].reason === 'card_slot_cleared'
    && s6bc.unresolved[0].owner === 'operator' && s6bc.bound.length === 0
    && JSON.stringify(await card('fixture-client', s6bcard)) === JSON.stringify(s6brow)
    && (await provenance('calendar', 'fixture-client', s6bcard)).map(p => p.kind).join(',') === 'created,slots_changed', s6bc);
  // S6c. A slot the reconciler itself bound and a person cleared afterwards
  // stays cleared: the slots_changed fact outranks empty-at-creation.
  await sql(`update public.calendar_posts set graphic_deliverable_id=null where client='fixture-client' and id=${q(s6cardId)}`);
  const s6crow = await card('fixture-client', s6cardId);
  const s6cc = await cards(s6.body.request_id);
  ok('S6c-reconciler-bound-slot-cleared-by-a-person-is-not-rebound', s6cc.outcome === 'unresolved' && s6cc.unresolved[0].reason === 'card_slot_cleared'
    && JSON.stringify(await card('fixture-client', s6cardId)) === JSON.stringify(s6crow)
    && JSON.stringify((await provenance('calendar', 'fixture-client', s6cardId)).filter(p => p.kind === 'slots_changed').map(p => p.source))
       === JSON.stringify(['native-intake-reconcile:lane', null]), s6cc);

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
  await sql(`update public.calendar_posts set name='Renamed by human', status='Client Approval', caption='edited' where client=${q(BC)} and id=${q(s1card.id)}`);
  const s8before = await card(BC, s1card.id);
  const s8c = await cards(s1.body.request_id);
  ok('S8-rerun-never-touches-human-fields', s8c.outcome === 'complete' && JSON.stringify(await card(BC, s1card.id)) === JSON.stringify(s8before));

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
  await sql(`delete from public.calendar_posts where client=${q(BC)} and id=${q(s1card.id)}`);
  const s10c = await cards(s1.body.request_id);
  ok('S10-deleted-card-not-recreated', s10c.outcome === 'unresolved' && s10c.unresolved[0].reason === 'card_deleted_after_creation'
    && !(await card(BC, s1card.id)) && (await provenance('calendar', BC, s1card.id)).map(p => p.kind).join(',') === 'created,deleted', s10c);

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
  const s15body = rootBody('both', requestId(), { client_slug: BC });
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
  const s15resume = await browserResume(savedJob(s15body, s15retry));
  await settle();
  const s15card = await card(BC, s15m.expected_items[0].row.card_id);
  ok('S15-gateway-retry-completes-provider-children-card-held-then-browser-creates-it', s15retry.status === 201
    && s15c.outcome === 'unresolved' && s15c.unresolved[0].reason === 'card_creation_held' && s15c.created.length === 0
    && s15resume.ok && !!s15card && !!s15card.video_deliverable_id && !!s15card.graphic_deliverable_id
    && (await state(s15body.request_id)).complete === true, [s15retry.status, s15c.outcome, s15resume.error]);
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
  const s17 = await interrupted('both', 1, { surface: 'sxr', client_slug: BC });
  ok('S17-samples-intake-accepted-and-interrupted', s17.response.status >= 500 && !!s17.m
    && (await rows(`select purpose from public.batches where id=${q(s17.m.batch_id)}`))[0]?.purpose === 'samples', s17.response);
  const s17r = await children(s17.body.request_id);
  const s17c = await cards(s17.body.request_id);
  reset();
  const s17retry = await post(s17.body);
  const s17resume = await browserResume(savedJob(s17.body, s17retry));
  await settle();
  const s17card = await card(BC, s17.m.expected_items[0].row.card_id, 'sample_reviews');
  const s17dels = await dels(s17.m.batch_id);
  ok('S17-samples-children-recovered-card-held-then-browser-creates-the-sample-card', s17r.outcome === 'recovered' && s17r.recovered.length === 2
    && s17c.outcome === 'unresolved' && s17c.unresolved[0].reason === 'card_creation_held' && s17retry.status === 201 && s17resume.ok
    && s17resume.sent[0].writer === 'sample-review-upsert'
    && !!s17card && s17card.video_deliverable_id === s17dels.find(d => d.team === 'video').id
    && s17card.graphic_deliverable_id === s17dels.find(d => d.team === 'graphics').id && s17card.status === 'In Progress'
    && s17dels.every(d => d.origin === 'samples')
    && (await count(`select 1 from public.sample_review_events where sample_id=${q(s17card?.id)} and action='create'`)) >= 1
    && (await count(`select 1 from public.calendar_posts where id=${q(s17card?.id)}`)) === 0
    && (await state(s17.body.request_id)).complete === true && (await cards(s17.body.request_id)).outcome === 'complete',
    [s17r.outcome, s17c.outcome, s17retry.status, s17resume.error]);

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
    && applied.counts.children.recovered === 1 && applied.counts.children.recovered_children === 2 && applied.counts.cards.unresolved === 1
    && applied.counts.cards.created_cards === 0 && applied.processed[0].cards.unresolved[0].reason === 'card_creation_held'
    && (await state(s20a.body.request_id)).owed.children_native === 0 && (await state(s20a.body.request_id)).owed.cards === 1
    && (await state(s20b.body.request_id)).complete === false, applied.counts);
  const lost = { calls: 0 };
  const lossyRpc = async (name, args) => { const out = await psqlRpc(name, args); if (name === 'production_intake_reconcile_children' && ++lost.calls === 1) throw new Error('synthetic lost reconcile response'); return out; };
  let lostError = null;
  try { await runReconcile({ rpc: lossyRpc, actor: 'runner-lossy', apply: true, limit: 1, requestIds: [s20b.body.request_id] }); } catch (e) { lostError = e; }
  const s20rerun = await runReconcile({ rpc: psqlRpc, actor: 'runner-rerun', apply: true, limit: 1, requestIds: [s20b.body.request_id] });
  ok('S20-runner-response-loss-then-rerun-converges', !!lostError && s20rerun.processed[0].children.outcome === 'complete'
    && s20rerun.processed[0].cards.outcome === 'unresolved' && s20rerun.processed[0].cards.unresolved[0].reason === 'card_creation_held'
    && (await state(s20b.body.request_id)).owed.cards === 1 && (await dels(s20b.m.batch_id)).length === 1, s20rerun.counts);
  const summary = await fn('production_intake_reconcile_summary', {});
  const independentOwed = Number(await sql(`select count(*) from public.production_intake_manifests m cross join lateral jsonb_array_elements(m.expected_items) i
    left join public.deliverables d on d.id = i->'row'->>'id' where d.id is null`));
  const independentCards = Number(await sql(`select count(*) from (
    select m.request_id, i->'row'->>'card_id' as cid, bool_and(coalesce(
      case when coalesce(b.purpose, 'calendar') = 'samples'
        then (select case when i->'row'->>'team' = 'graphics' then s.graphic_deliverable_id else s.video_deliverable_id end
              from public.sample_reviews s where s.client = m.client_slug and s.id = i->'row'->>'card_id')
        else (select case when i->'row'->>'team' = 'graphics' then c.graphic_deliverable_id else c.video_deliverable_id end
              from public.calendar_posts c where c.client = m.client_slug and c.id = i->'row'->>'card_id') end = i->'row'->>'id', false)) as done
    from public.production_intake_manifests m join public.batches b on b.id = m.batch_id
    cross join lateral jsonb_array_elements(m.expected_items) i group by 1, 2) t where not done`));
  ok('S20-summary-counts-match-independent-sql', summary.owed.children_native + summary.owed.children_provider === independentOwed
    && summary.owed.cards === independentCards && independentCards >= 2
    && summary.requests_owed + summary.requests_complete === summary.manifests && summary.owed.missing_terminal_receipts === 1
    && Object.keys(summary.latest_outcomes).length > 0, summary);

  // ------------------------------------------------------------------
  // Correction round (review of head 48f7501). The BEFORE UPDATE guard that
  // recognised a late browser replay from row content is gone, and so is the
  // creation classifier. Everything below drives the ACTUAL writers and the
  // ACTUAL extracted browser function; nothing is mocked between them and the
  // tables.
  // ------------------------------------------------------------------
  await flags('epoch-video-b1', 'epoch-graphics-b1');
  async function acceptedButUnmaterialized(mode = 'both', overrides = {}) {
    reset();
    const body = rootBody(mode, requestId(overrides.surface === 'sxr' ? 'sxr' : 'submission'), { client_slug: BC, ...overrides });
    const response = await post(body);
    if (response.status !== 201) throw new Error('fixture intake did not commit: ' + response.status);
    return { body, response, m: await manifest(body.request_id), job: savedJob(body, response) };
  }
  // A person's edit, exactly as the Calendar and Samples tabs send it: the
  // changed keys only, through the real writer.
  const edit = (table, id, fields) => table === 'sample_reviews'
    ? writers.post('sample-review-upsert', { client: BC, sample: { id, ...fields }, comments_base_at: '' }, 'ui')
    : writers.post('calendar-upsert', { client: BC, post: { id, ...fields }, comments_base_at: '' }, 'ui');

  // R0. Structure, not intent: no trigger on either card table alters a write,
  // and the row-content classifier no longer exists anywhere in the schema.
  ok('R0-no-write-altering-trigger-or-classifier-installed',
    (await count(`select 1 from pg_trigger where tgname like 'zy_production_card%'`)) === 0
    && (await count(`select 1 from pg_proc where proname in ('production_card_materialization_guard', 'production_card_is_materialization')`)) === 0
    && (await count(`select 1 from information_schema.columns where table_name='production_card_provenance' and column_name='materialization'`)) === 0
    && (await rows(`select tgname, tgtype from pg_trigger where tgrelid in ('public.calendar_posts'::regclass, 'public.sample_reviews'::regclass) and not tgisinternal and tgname like '%provenance%'`))
      .every(t => (Number(t.tgtype) & 2) === 0 /* AFTER, never BEFORE */));

  // R1. Calendar: create through the browser job, rename through the actual
  // writer, rename BACK to the original title through the actual writer. The
  // 48f7501 guard kept the intermediate title here; the writer must keep the
  // person's last word.
  const r1 = await acceptedButUnmaterialized();
  const r1card = r1.m.expected_items[0].row.card_id;
  const r1create = await browserResume(r1.job); await settle();
  const r1row = await card(BC, r1card);
  const r1rename = await edit('calendar_posts', r1card, { name: 'Intermediate title' });
  const r1mid = await card(BC, r1card);
  const r1back = await edit('calendar_posts', r1card, { name: r1row.name });
  const r1after = await card(BC, r1card);
  ok('R1-calendar-rename-back-to-the-original-title-is-kept', r1create.ok && !!r1row && r1rename.status === 200 && r1mid.name === 'Intermediate title'
    && r1back.status === 200 && r1after.name === r1row.name && r1after.video_deliverable_id === r1row.video_deliverable_id
    && r1after.graphic_deliverable_id === r1row.graphic_deliverable_id
    && (await provenance('calendar', BC, r1card)).map(p => p.kind).join(',') === 'created',
    { create: r1create.error, statuses: [r1rename.status, r1back.status], names: [r1row && r1row.name, r1mid && r1mid.name, r1after && r1after.name] });

  // R2. Samples: the same sequence through sample-review-upsert.
  const r2 = await acceptedButUnmaterialized('both', { surface: 'sxr' });
  const r2card = r2.m.expected_items[0].row.card_id;
  const r2create = await browserResume(r2.job); await settle();
  const r2row = await card(BC, r2card, 'sample_reviews');
  const r2rename = await edit('sample_reviews', r2card, { name: 'Intermediate sample title' });
  const r2mid = await card(BC, r2card, 'sample_reviews');
  const r2back = await edit('sample_reviews', r2card, { name: r2row.name });
  const r2after = await card(BC, r2card, 'sample_reviews');
  ok('R2-samples-rename-back-to-the-original-title-is-kept', r2create.ok && !!r2row && r2rename.status === 200 && r2mid.name === 'Intermediate sample title'
    && r2back.status === 200 && r2after.name === r2row.name && r2after.video_deliverable_id === r2row.video_deliverable_id
    && (await provenance('samples', BC, r2card)).map(p => p.kind).join(',') === 'created',
    { create: r2create.error, statuses: [r2rename.status, r2back.status], names: [r2row && r2row.name, r2mid && r2mid.name, r2after && r2after.name] });

  // R3. A GENUINE late retry of the original browser job over its own card,
  // after a person edited it through the writer. Observed, not introduced: the
  // frozen writer acknowledges the replay and the person's fields are
  // overwritten, because the writer conveys no operation identity that any
  // layer could act on. The reconciler created nothing, bound nothing and
  // recorded nothing for this request; it did not widen the exposure.
  const r3 = await acceptedButUnmaterialized();
  const r3card = r3.m.expected_items[0].row.card_id;
  const r3first = await browserResume(r3.job); await settle();
  const r3edit = await edit('calendar_posts', r3card, { name: 'Human title', scheduled_date: '2026-10-02', status: 'Kasper Approval' });
  const r3human = await card(BC, r3card);
  const r3before = await cards(r3.body.request_id);
  r3.job.completed_card_ids = [];
  const r3late = await browserResume(r3.job); await settle();
  const r3after = await card(BC, r3card);
  const r3c = await cards(r3.body.request_id);
  const r3prov = await provenance('calendar', BC, r3card);
  ok('R3-genuine-late-browser-retry-overwrites-through-the-frozen-writer-and-the-reconciler-wrote-nothing',
    r3first.ok && r3edit.status === 200 && r3human.name === 'Human title' && r3human.status === 'Kasper Approval'
    && r3late.ok && r3late.sent.length === 1 && (r3late.sent[0].payload.comments_base_at || '') === ''
    && r3after.name !== 'Human title' && r3after.status === 'In Progress' && r3after.scheduled_date === ''
    && r3before.outcome === 'complete' && r3before.bound.length === 0 && r3c.outcome === 'complete'
    && r3prov.length === 1 && r3prov[0].kind === 'created' && r3prov[0].source === null
    && (await reasons(r3.body.request_id, 'cards')).length === 0,
    { human: [r3human.name, r3human.status], after: [r3after.name, r3after.status], rc: [r3before.outcome, r3c.outcome], prov: r3prov.map(p => p.kind) });

  // R4. A copied or non-intake card in the browser's exact shape: it records a
  // created fact and nothing else, no classification is made, its rename-back
  // through the writer works, and it never enters the reconciler's backlog.
  const r4id = 'p_copied_lookalike_synthetic';
  const r4dels = await dels(r3.m.batch_id);
  const r4create = await writers.post('calendar-upsert', { client: BC, post: {
    id: r4id, order_index: '99', name: 'Video 1', scheduled_date: '', status: 'In Progress', video_status: 'In Progress',
    graphic_status: 'In Progress', caption_status: 'In Progress', asset_url: '', thumbnail_url: '', caption: '', cta: '',
    tweaks: '', video_tweaks: '', graphic_tweaks: '', caption_tweaks: '',
    linear_issue_id: '', video_deliverable_id: r4dels.find(d => d.team === 'video').id, graphic_linear_issue_id: '', graphic_deliverable_id: '' } }, 'ui');
  await settle();
  const r4row = await card(BC, r4id);
  const r4rename = await edit('calendar_posts', r4id, { name: 'Copied and renamed' });
  const r4back = await edit('calendar_posts', r4id, { name: 'Video 1' });
  const r4after = await card(BC, r4id);
  const r4prov = await provenance('calendar', BC, r4id);
  const r4backlog = (await fn('production_intake_reconcile_backlog', { p_limit: 500, p_after: null })).items;
  ok('R4-copied-non-intake-lookalike-records-a-fact-only-and-renames-back-freely', r4create.status === 200 && !!r4row
    && r4rename.status === 200 && r4back.status === 200 && r4after.name === 'Video 1'
    && r4prov.length === 1 && r4prov[0].kind === 'created' && r4prov[0].source === null && !('materialization' in r4prov[0])
    && r4backlog.every(i => !(i.cards_incomplete || []).includes(r4id)),
    { create: r4create.status, statuses: [r4rename.status, r4back.status], name: r4after && r4after.name, prov: r4prov.map(p => p.kind) });

  // R5. Concurrent identity change during the bind. The plan is computed
  // before the locks; the reconciler locks the card, then blocks on the child
  // a second session holds. When that session re-cards the child (R5a) or
  // deletes it (R5b) and commits, the revalidation under the lock sees the
  // change and the whole bind rolls back: no slot written, bounded reason.
  const hold = (id, mutation) => runSql(`begin; select 1 from public.deliverables where id=${q(id)} for update; select pg_sleep(1.5); ${mutation}; commit;`);
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function bindable() {
    const x = await interrupted('both', 2);
    await children(x.body.request_id);
    const d = await dels(x.m.batch_id);
    const cid = x.m.expected_items[0].row.card_id;
    await sql(`insert into public.calendar_posts(client,id,updated_at,order_index,name,status,video_deliverable_id)
      values('fixture-client',${q(cid)},'2026-09-05T10:00:00.000Z','5','Awaiting its thumbnail','In Progress',${q(d.find(v => v.team === 'video').id)})`);
    return { x, d, cid, graphic: d.find(v => v.team === 'graphics'), row: await card('fixture-client', cid) };
  }
  const r5a = await bindable();
  const r5aHold = hold(r5a.graphic.id, `update public.deliverables set card_id='p_recarded_synthetic' where id=${q(r5a.graphic.id)}`);
  await pause(300);
  const r5ac = await cards(r5a.x.body.request_id);
  const r5aHeld = await r5aHold;
  ok('R5a-child-recarded-under-the-lock-rolls-the-bind-back', r5aHeld.status === 0 && r5ac.outcome === 'unresolved' && r5ac.bound.length === 0
    && r5ac.unresolved[0].reason === 'reconcile_child_identity_changed'
    && JSON.stringify(await card('fixture-client', r5a.cid)) === JSON.stringify(r5a.row)
    && (await provenance('calendar', 'fixture-client', r5a.cid)).map(p => p.kind).join(',') === 'created'
    && (await reasons(r5a.x.body.request_id, 'cards')).some(p => p.payload.outcome === 'unresolved' && p.payload.unresolved.some(u => u.reason === 'reconcile_child_identity_changed')),
    { hold: r5aHeld.stderr, rc: r5ac });
  const r5b = await bindable();
  const r5bHold = hold(r5b.graphic.id, `delete from public.deliverables where id=${q(r5b.graphic.id)}`);
  await pause(300);
  const r5bc = await cards(r5b.x.body.request_id);
  const r5bHeld = await r5bHold;
  ok('R5b-child-deleted-under-the-lock-rolls-the-bind-back', r5bHeld.status === 0 && r5bc.outcome === 'unresolved' && r5bc.bound.length === 0
    && r5bc.unresolved[0].reason === 'reconcile_child_identity_changed'
    && JSON.stringify(await card('fixture-client', r5b.cid)) === JSON.stringify(r5b.row)
    && (await dels(r5b.x.m.batch_id)).length === 1, { hold: r5bHeld.stderr, rc: r5bc });
  // Afterwards the deleted child is an OPERATOR decision, not a silent
  // recovery: its terminal receipt survives without its row, stage 1 reports
  // the conflict, and stage 2 stays on children_incomplete. The lock order and
  // the cardinality check are what kept stage 2 from binding a phantom.
  const r5bRecover = await children(r5b.x.body.request_id);
  const r5bAgain = await cards(r5b.x.body.request_id);
  ok('R5b-deleted-child-is-an-operator-decision-afterwards-not-a-silent-recovery', r5bRecover.outcome === 'conflict'
    && r5bRecover.conflicts.some(c => c.reason === 'child_receipt_without_row' && c.owner === 'operator') && r5bRecover.recovered.length === 0
    && r5bAgain.outcome === 'unresolved' && r5bAgain.unresolved[0].reason === 'children_incomplete' && r5bAgain.bound.length === 0
    && JSON.stringify(await card('fixture-client', r5b.cid)) === JSON.stringify(r5b.row), [r5bRecover, r5bAgain]);

  // R6. A failure inside the bind (any failure: here a synthetic raising
  // trigger on the card table) rolls the card back, records no slot fact and
  // leaves a bounded reason, never the message.
  const r6 = await bindable();
  await sql(`create function public.nir_synthetic_failure() returns trigger language plpgsql as $$ begin raise exception 'synthetic_failure detail (id)=(secret)'; end $$;
    create trigger zz_nir_synthetic_failure before update on public.calendar_posts for each row execute function public.nir_synthetic_failure();`);
  const r6c = await cards(r6.x.body.request_id);
  await sql('drop trigger zz_nir_synthetic_failure on public.calendar_posts; drop function public.nir_synthetic_failure();');
  ok('R6-failure-inside-the-bind-rolls-back-with-a-bounded-reason', r6c.outcome === 'unresolved' && r6c.bound.length === 0
    && r6c.unresolved[0].reason === 'sql_error:P0001' && !JSON.stringify(r6c).includes('secret')
    && JSON.stringify(await card('fixture-client', r6.cid)) === JSON.stringify(r6.row)
    && (await provenance('calendar', 'fixture-client', r6.cid)).map(p => p.kind).join(',') === 'created'
    && (await reasons(r6.x.body.request_id, 'cards')).some(p => JSON.stringify(p).includes('sql_error:P0001') && !JSON.stringify(p).includes('secret')), r6c);
  const r6again = await cards(r6.x.body.request_id);
  ok('R6-after-the-fault-clears-the-same-bind-completes', r6again.outcome === 'materialized' && r6again.bound.length === 1
    && (await card('fixture-client', r6.cid)).graphic_deliverable_id === r6.graphic.id
    && (await provenance('calendar', 'fixture-client', r6.cid)).map(p => p.kind).join(',') === 'created,slots_changed', r6again);

  // ------------------------------------------------------------------
  // Absent best-effort events are not proof of never created, and even proof
  // of never created does not create.
  // ------------------------------------------------------------------
  // P1. Without ANY provenance recording (triggers disabled): a card commits,
  // its create event is lost, a person deletes it. The first head resurrected
  // it. Now nothing is created under any reading of the facts.
  const p1 = await acceptedButUnmaterialized();
  const p1card = p1.m.expected_items[0].row.card_id;
  const p1dels = await dels(p1.m.batch_id);
  await sql('alter table public.calendar_posts disable trigger zz_production_card_provenance');
  await sql(`insert into public.calendar_posts(client,id,updated_at,order_index,name,scheduled_date,status,video_status,graphic_status,caption_status,video_deliverable_id,graphic_deliverable_id)
    values(${q(BC)},${q(p1card)},'2026-09-05T10:00:00.000Z','3','Video 1','','In Progress','In Progress','In Progress','In Progress',${q(p1dels.find(d => d.team === 'video').id)},${q(p1dels.find(d => d.team === 'graphics').id)})`);
  await sql(`delete from public.calendar_posts where client=${q(BC)} and id=${q(p1card)}`);
  await sql('alter table public.calendar_posts enable trigger zz_production_card_provenance');
  const p1events = await count(`select 1 from public.calendar_post_events where post_id=${q(p1card)}`);
  const p1c = await cards(p1.body.request_id);
  ok('P1-without-any-provenance-a-deleted-event-less-card-is-still-not-recreated', p1events === 0 && p1c.outcome === 'unresolved'
    && p1c.unresolved[0].reason === 'card_creation_held' && p1c.created.length === 0 && !(await card(BC, p1card)), p1c);

  // P2. With provenance recorded inside the writer transaction the same
  // sequence is named for what it is: created, then deleted, no event ever.
  const p2 = await acceptedButUnmaterialized();
  const p2card = p2.m.expected_items[0].row.card_id;
  const p2dels = await dels(p2.m.batch_id);
  await sql(`insert into public.calendar_posts(client,id,updated_at,order_index,name,scheduled_date,status,video_status,graphic_status,caption_status,video_deliverable_id,graphic_deliverable_id)
    values(${q(BC)},${q(p2card)},'2026-09-05T10:00:00.000Z','3','Video 1','','In Progress','In Progress','In Progress','In Progress',${q(p2dels.find(d => d.team === 'video').id)},${q(p2dels.find(d => d.team === 'graphics').id)})`);
  await sql(`delete from public.calendar_posts where client=${q(BC)} and id=${q(p2card)}`);
  const p2c = await cards(p2.body.request_id);
  const p2prov = await provenance('calendar', BC, p2card);
  ok('P2-committed-then-deleted-event-less-card-is-held-as-deleted-not-recreated',
    (await count(`select 1 from public.calendar_post_events where post_id=${q(p2card)}`)) === 0
    && p2prov.map(p => p.kind).join(',') === 'created,deleted' && p2c.outcome === 'unresolved'
    && p2c.unresolved[0].reason === 'card_deleted_after_creation' && !(await card(BC, p2card)), p2c);

  // P3. A card that provably never existed is STILL not created: the debt is
  // visible in the reason, the backlog and the summary until its owner (the
  // browser job, or a person) creates it.
  const p3 = await acceptedButUnmaterialized();
  const p3card = p3.m.expected_items[0].row.card_id;
  const p3c = await cards(p3.body.request_id);
  const p3item = (await fn('production_intake_reconcile_backlog', { p_limit: 500, p_after: null })).items.find(i => i.request_id === p3.body.request_id);
  ok('P3-proved-never-created-card-is-held-with-visible-debt-not-created', p3c.outcome === 'unresolved' && p3c.unresolved[0].reason === 'card_creation_held'
    && p3c.created.length === 0 && !(await card(BC, p3card)) && (await provenance('calendar', BC, p3card)).length === 0
    && !!p3item && p3item.cards_incomplete.includes(p3card) && (await fn('production_intake_reconcile_summary', {})).owed.cards >= 1, p3c);

  // P4. A request accepted before provenance recording existed cannot prove
  // anything about its card; it is held under its own reason, never recreated.
  const p4 = await acceptedButUnmaterialized();
  await sql(`update public.production_intake_manifests set recorded_at = (select min(at) from public.production_card_provenance where kind='installed') - interval '1 day' where request_id=${q(p4.body.request_id)}`);
  const p4c = await cards(p4.body.request_id);
  ok('P4-pre-install-request-is-held-card-provenance-unavailable', p4c.outcome === 'unresolved' && p4c.unresolved[0].reason === 'card_provenance_unavailable'
    && !(await card(BC, p4.m.expected_items[0].row.card_id)), p4c);

  // P5. Every reason the ledger holds is an allowlisted code or a SQLSTATE
  // class; no message text, no row values.
  const ledgerReasons = await rows(`select r->>'reason' as reason from public.deliverable_events e
    cross join lateral jsonb_array_elements(coalesce(e.payload->'unresolved','[]'::jsonb) || coalesce(e.payload->'conflicts','[]'::jsonb)) r
    where e.action='native_intake_reconcile'`);
  ok('P5-ledger-reasons-are-codes-not-messages', ledgerReasons.length > 0
    && ledgerReasons.every(r => /^[a-z0-9_]+$/.test(r.reason) || /^sql_error:[0-9A-Z]{5}$/.test(r.reason)), ledgerReasons.filter(r => !/^[a-z0-9_]+$/.test(r.reason)).slice(0, 3));
  const p5forced = await runSql(`select public.production_intake_reconcile_reason('duplicate key value violates unique constraint "x" DETAIL: Key (id)=(secret)', '23505')`);
  ok('P5-postgres-messages-collapse-to-their-sqlstate', p5forced.status === 0 && p5forced.stdout.trim() === 'sql_error:23505');

  // R7. Forward slots alone cannot complete a card. A deliverable moved or
  // unlinked after a successful bind stays visible without undoing that edit.
  // Exercise both actual table owners, their Stage 2 return, paginated backlog,
  // summary delta, and full card/child/receipt values after the refusal.
  for (const surface of ['submission', 'sxr']) {
    const ix = await interrupted('both', 2, { surface });
    await children(ix.body.request_id);
    const ids = await dels(ix.m.batch_id), cid = ix.m.expected_items[0].row.card_id;
    const table = surface === 'sxr' ? 'sample_reviews' : 'calendar_posts';
    const graphic = ids.find(d => d.team === 'graphics');
    await sql(`insert into public.${table}(client,id,updated_at,order_index,name,status,video_deliverable_id)
      values('fixture-client',${q(cid)},'2026-09-05T10:00:00Z','1','Synthetic reciprocal binding','In Progress',${q(ids.find(d => d.team === 'video').id)})`);
    const bound = await cards(ix.body.request_id);
    ok('R7-' + table + '-reciprocal-bind-complete', bound.outcome === 'materialized' && (await state(ix.body.request_id)).complete === true);
    const owedBefore = (await fn('production_intake_reconcile_summary', {})).owed.cards;
    for (const variant of [
      { name: 'moved', cardId: 'p_synthetic_other', kind: graphic.kind, reason: 'deliverable_rebound' },
      { name: 'cleared', cardId: null, kind: graphic.kind, reason: 'deliverable_card_cleared' },
      { name: 'wrong-identity', cardId: cid, kind: 'other', reason: 'children_incomplete' },
    ]) {
      await sql(`update public.deliverables set card_id=${variant.cardId === null ? 'null' : q(variant.cardId)},kind=${q(variant.kind)} where id=${q(graphic.id)}`);
      const before = JSON.stringify([await card('fixture-client', cid, table), await dels(ix.m.batch_id), await receipts(ix.m.batch_id)]);
      const observed = await state(ix.body.request_id);
      const again = await cards(ix.body.request_id);
      const backlog = await pageAll();
      const summary = await fn('production_intake_reconcile_summary', {});
      const after = JSON.stringify([await card('fixture-client', cid, table), await dels(ix.m.batch_id), await receipts(ix.m.batch_id)]);
      ok('R7-' + table + '-' + variant.name + '-remains-visible-without-repair',
        observed.complete === false && observed.cards[0].complete === false && observed.owed.cards === 1
        && again.outcome === 'unresolved' && again.unresolved.some(r => r.reason === variant.reason)
        && backlog.seen.includes(ix.body.request_id) && summary.owed.cards === owedBefore + 1 && before === after,
        { complete: observed.complete, owed: observed.owed, outcome: again.outcome, reasons: again.unresolved, unchanged: before === after });
    }
    await sql(`update public.deliverables set card_id=${q(cid)},kind=${q(graphic.kind)} where id=${q(graphic.id)}`);
    ok('R7-' + table + '-exact-identity-restored-completes', (await state(ix.body.request_id)).complete === true
      && (await cards(ix.body.request_id)).outcome === 'complete'
      && !(await pageAll()).seen.includes(ix.body.request_id)
      && (await fn('production_intake_reconcile_summary', {})).owed.cards === owedBefore);
  }

  ok('S99-zero-provider-or-drainer-requests-during-any-reconciliation', noProvider(), net.requests.slice(0, 3));

  console.log(JSON.stringify({ suite: 'native-intake-reconcile', passed: checks.filter(c => c.pass).length, failed: checks.filter(c => !c.pass).length,
    readiness: { missing_child_materialization: 'PASS_IN_FIXTURE', missing_card_materialization: 'HELD_NOT_AUTOMATED',
      empty_since_creation_slot_bind: 'PASS_IN_FIXTURE', late_browser_replay_overwrite: 'PRE_EXISTING_UNRESOLVED',
      provider_era_child_recovery: 'NOT_IMPLEMENTED', installed_full_serving: 'UNPROVEN', chosen_editor_provider_independence: 'OUT_OF_SCOPE' } }));
  if (checks.some(c => !c.pass)) process.exitCode = 1;
} finally {
  fs.rmSync(gw.scratch, { recursive: true, force: true });
  for (const scratch of writers.scratches) fs.rmSync(scratch, { recursive: true, force: true });
}
