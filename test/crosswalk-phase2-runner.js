#!/usr/bin/env node
'use strict';
/*
 * The Phase 2 crosswalk repair runner: plans the RPC calls from a live export
 * with the RPC's own questions, carries each card's legacy thread along, and
 * applies behind the confirm token and a plan digest. Database and RPC are
 * injected here; the RPC itself is rehearsed against PostgreSQL 16 by
 * test/crosswalk-bind-and-import.js.
 */
const fs = require('fs');
const path = require('path');
const runner = require('../scripts/crosswalk-phase2-runner');

let failures = 0;
function ok(cond, msg) {
  console.log((cond ? '  ok  ' : 'FAIL  ') + msg);
  if (!cond) failures++;
}
const ROOT = path.resolve(__dirname, '..');

/* ---- fixture: every live shape ------------------------------------------ */

function deliverable(extra) {
  return Object.assign({
    id: 'd', client_slug: 'acme', team: 'video', kind: 'video', origin: 'manual', card_id: null,
    status: 'todo', linear_identifier: null, linear_issue_url: null, linear_issue_uuid: null,
  }, extra);
}
const LIVE = {
  exported_at: '2026-09-05T18:00:00Z',
  clients: [{ slug: 'acme', active: true }, { slug: 'beta', active: true }, { slug: 'gone', active: false }, { slug: runner.TEST_CLIENT, active: true }],
  cards: [
    // clean: nothing to do
    { id: 'c_clean', client: 'acme', video_deliverable_id: 'd_clean', linear_issue_id: 'VID-1' },
    // plain mismatch (origin+card_id), identity agrees, no thread
    { id: 'c_plain', client: 'acme', video_deliverable_id: 'd_plain', linear_issue_id: 'https://linear.app/x/issue/VID-2/t' },
    // the Reel: video slot, row stamped thumbnail, real thumbnail in the other slot
    { id: 'c_reel', client: 'acme', video_deliverable_id: 'd_reel', graphic_deliverable_id: 'd_reel_thumb', linear_issue_id: 'VID-3', graphic_linear_issue_id: 'GRA-3' },
    // the Carousel: graphic slot, kind other
    { id: 'c_car', client: 'acme', graphic_deliverable_id: 'd_car', graphic_linear_issue_id: 'GRA-4' },
    // the shell: an occupant the card does not point at
    { id: 'c_shell', client: 'acme', video_deliverable_id: 'd_keep', linear_issue_id: 'VID-5' },
    // two projections of one issue
    { id: 'c_dupe', client: 'acme', video_deliverable_id: 'd_dupe_a', linear_issue_id: 'VID-6' },
    // refusals
    { id: 'c_unproven', client: 'acme', video_deliverable_id: 'd_unproven' },
    { id: 'c_disagree', client: 'acme', video_deliverable_id: 'd_disagree', linear_issue_id: 'VID-8' },
    { id: 'c_other_client', client: 'acme', video_deliverable_id: 'd_beta', linear_issue_id: 'VID-9' },
    { id: 'c_elsewhere', client: 'acme', video_deliverable_id: 'd_elsewhere', linear_issue_id: 'VID-10' },
    { id: 'c_missing', client: 'acme', video_deliverable_id: 'd_nope', linear_issue_id: 'VID-11' },
    // a mismatch WITH a legacy thread on the slot
    { id: 'c_thread', client: 'acme', video_deliverable_id: 'd_thread', linear_issue_id: 'VID-12',
      comments: [
        { id: 'root', author: 'SMM', role: 'smm', body: 'Root note', created_at: '2026-07-23T10:00:00Z', updated_at: '2026-07-23T10:00:00Z' },
        { id: 'reply', parent_id: 'root', author: 'Client', role: 'client', body: 'Reply note', created_at: '2026-07-23T10:01:00Z', updated_at: '2026-07-23T10:01:00Z' },
      ] },
    // a mismatch whose thread the planner cannot plan (same id, two bodies)
    { id: 'c_badthread', client: 'acme', video_deliverable_id: 'd_badthread', linear_issue_id: 'VID-13',
      comments: [
        { id: 'dup', author: 'SMM', role: 'smm', body: 'one', created_at: '2026-07-23T10:00:00Z' },
        { id: 'dup', author: 'SMM', role: 'smm', body: 'two', created_at: '2026-07-23T10:00:00Z' },
      ] },
    // inactive client and the test client: never examined by default
    { id: 'c_gone', client: 'gone', video_deliverable_id: 'd_gone', linear_issue_id: 'VID-14' },
    { id: 'c_test', client: runner.TEST_CLIENT, video_deliverable_id: 'd_test', linear_issue_id: 'VID-15' },
  ],
  deliverables: [
    deliverable({ id: 'd_clean', origin: 'calendar', card_id: 'c_clean', linear_identifier: 'VID-1' }),
    deliverable({ id: 'd_plain', linear_identifier: 'VID-2' }),
    deliverable({ id: 'd_reel', kind: 'thumbnail', linear_identifier: 'VID-3' }),
    deliverable({ id: 'd_reel_thumb', team: 'graphics', kind: 'thumbnail', origin: 'calendar', card_id: 'c_reel', linear_identifier: 'GRA-3' }),
    deliverable({ id: 'd_car', team: 'graphics', kind: 'other', linear_identifier: 'GRA-4' }),
    deliverable({ id: 'd_keep', linear_identifier: 'VID-5' }),
    deliverable({ id: 'd_shell', origin: 'calendar', card_id: 'c_shell', status: 'kasper_approval', linear_identifier: 'VID-500', linear_issue_uuid: 'u500' }),
    deliverable({ id: 'd_dupe_a', linear_identifier: 'VID-6' }),
    deliverable({ id: 'd_dupe_b', origin: 'calendar', card_id: 'c_dupe', linear_identifier: 'VID-6' }),
    deliverable({ id: 'd_unproven' }),
    deliverable({ id: 'd_disagree', linear_identifier: 'VID-80' }),
    deliverable({ id: 'd_beta', client_slug: 'beta', linear_identifier: 'VID-9' }),
    deliverable({ id: 'd_elsewhere', origin: 'calendar', card_id: 'c_somewhere_else', linear_identifier: 'VID-10' }),
    deliverable({ id: 'd_thread', linear_identifier: 'VID-12' }),
    deliverable({ id: 'd_badthread', linear_identifier: 'VID-13' }),
    deliverable({ id: 'd_gone', linear_identifier: 'VID-14' }),
    deliverable({ id: 'd_test', client_slug: runner.TEST_CLIENT, linear_identifier: 'VID-15' }),
  ],
};
const byCard = (plan, cardId) => plan.calls.find(c => c.card_id === cardId);
const skippedFor = (plan, cardId) => plan.skipped.find(s => s.card_id === cardId);

/* ---- 1. the plan asks the RPC's questions ------------------------------- */

const plan = runner.planRepair(LIVE, { runId: 'unit' });
ok(plan.contract === runner.PLAN_CONTRACT && plan.run_id === 'unit', 'a plan carries its contract and run id');
ok(!plan.calls.some(c => c.card_id === 'c_clean') && plan.counts.clean_slots === 2,
  'a slot whose four crosswalk fields already agree is counted clean and never called (c_clean, and the Reel card\'s real thumbnail)');
const plain = byCard(plan, 'c_plain');
ok(plain && plain.mismatch_fields.join('+') === 'card_id+origin' && !plain.evict && plain.comments.length === 0
  && plain.kind_before === 'video' && plain.kind_after === 'video' && plain.linear_identifier === 'VID-2',
  'a plain mismatch with identity agreeing (URL on the card, bare on the row) is one call, no eviction, no thread');
const reel = byCard(plan, 'c_reel');
ok(reel && reel.kind_before === 'thumbnail' && reel.kind_after === 'video' && !reel.evict,
  "the Reel (video slot, row stamped thumbnail) is a call that relabels to 'video' — and its card's real thumbnail is NOT an occupant");
const car = byCard(plan, 'c_car');
ok(car && car.component === 'graphic' && car.kind_before === 'other' && car.kind_after === 'thumbnail' && car.team_after === 'graphics',
  "the Carousel (graphic slot, kind other) is a call that relabels to 'thumbnail'");
const shell = byCard(plan, 'c_shell');
ok(shell && shell.evict && shell.occupants.length === 1 && shell.occupants[0].id === 'd_shell'
  && shell.occupants[0].status === 'kasper_approval' && shell.occupants[0].linear_identifier === 'VID-500',
  'a slot held by a shell the card does not point at is a call WITH eviction, and the occupant is named with its status and issue');
ok(skippedFor(plan, 'c_dupe') && skippedFor(plan, 'c_dupe').reason === 'occupant_same_issue',
  'a second projection of the SAME issue is a refusal, never an eviction');
ok(skippedFor(plan, 'c_unproven').reason === 'linear_identity_unproven'
  && skippedFor(plan, 'c_disagree').reason === 'linear_identity_disagrees'
  && skippedFor(plan, 'c_other_client').reason === 'client_mismatch'
  && skippedFor(plan, 'c_elsewhere').reason === 'already_bound_elsewhere'
  && skippedFor(plan, 'c_missing').reason === 'deliverable_missing',
  'the five refusals are forecast by name, in the RPC\'s own vocabulary');
ok(!plan.calls.some(c => c.client === 'gone') && !plan.skipped.some(s => s.client === 'gone'),
  'an inactive client is never examined');
ok(!plan.calls.some(c => c.client === runner.TEST_CLIENT) && plan.counts.active_clients === 2,
  'the drill client is excluded by default');
const withTest = runner.planRepair(LIVE, { runId: 'unit', includeTestClient: true });
ok(withTest.calls.some(c => c.client === runner.TEST_CLIENT) && withTest.counts.active_clients === 3,
  'and included only when asked for by flag');

/* ---- 2. the thread rides along, or the slot waits ------------------------- */

const thread = byCard(plan, 'c_thread');
ok(thread && thread.comments.length === 2
  && thread.comments.every(c => c.native_comment_id && c.source_fingerprint && c.body && c.role)
  && thread.comments.map(c => c.native_comment_id).sort().join(',') === 'reply,root',
  'a slot with a legacy thread carries every comment as the RPC\'s p_comments shape (native_comment_id + source_fingerprint + the import payload)');
ok(plan.counts.calls_with_thread === 1 && plan.counts.comments_to_import === 2,
  'and the counts say so');
const bad = skippedFor(plan, 'c_badthread');
ok(bad && bad.reason === 'thread_not_plannable' && bad.classifications.includes('duplicate_identity'),
  'a slot whose thread the import planner cannot plan cleanly is NOT bound — it waits, with the planner\'s classification');
const RUNNER_SRC = fs.readFileSync(path.join(ROOT, 'scripts', 'crosswalk-phase2-runner.js'), 'utf8');
ok(/reason: 'thread_partially_planned'/.test(RUNNER_SRC) && /if \(deferred\) \{/.test(RUNNER_SRC) && plan.counts.comments_deferred === 0,
  'a slot whose thread the import policy would only partly import is held back (thread_partially_planned) — a bound card never shows fewer comments than before; none in this fixture');
ok(plan.counts.calls === 5 && plan.counts.mismatching_slots === 12
  && plan.counts.skipped_by_reason.thread_not_plannable === 1
  && plan.counts.relabels['thumbnail->video'] === 1 && plan.counts.relabels['other->thumbnail'] === 1,
  'the plan\'s counts add up: 5 calls, 12 mismatching slots, one relabel of each kind');

/* ---- 3. the digest pins what will be called ------------------------------- */

ok(runner.planRepair(LIVE, { runId: 'again' }).digest === plan.digest,
  'the digest is stable across runs of the same data (the run id is not part of it)');
const moved = JSON.parse(JSON.stringify(LIVE));
moved.cards.find(c => c.id === 'c_plain').linear_issue_id = 'VID-999';
ok(runner.planRepair(moved, { runId: 'unit' }).digest !== plan.digest,
  'and changes when the live data moves under it — the apply-time drift guard');

/* ---- 4. apply: the calls, the receipts, the refusals ---------------------- */

(async () => {
  const bodies = [];
  const rpc = async (name, body) => {
    bodies.push({ name, body });
    const b = body.p_binding;
    if (b.card_id === 'c_reel') {
      const error = new Error('rpc_x_400');
      error.rpc = { status: 400, code: 'P0001', message: 'crosswalk_bind_slot_occupied' };
      throw error;
    }
    return {
      bound: true, kind_before: b.component === 'graphic' ? 'other' : 'video', kind: b.component === 'graphic' ? 'thumbnail' : 'video',
      evicted: b.evict_occupant ? [{ deliverable_id: 'd_shell', mode: 'canceled', status_before: 'kasper_approval' }] : [],
      processed: body.p_comments.length, imported: body.p_comments.length, already_linked: 0,
    };
  };
  const applied = await runner.applyPlan(plan, rpc, { cap: 10 });
  ok(bodies.length === 5 && bodies.every(x => x.name === runner.RPC_NAME),
    'apply makes exactly one RPC call per planned slot, to production_comment_card_bind_and_import');
  const shellBody = bodies.find(x => x.body.p_binding.card_id === 'c_shell').body;
  const plainBody = bodies.find(x => x.body.p_binding.card_id === 'c_plain').body;
  ok(shellBody.p_binding.evict_occupant === runner.EVICT_MODE && !('evict_occupant' in plainBody.p_binding),
    "evict_occupant='card_wins' is sent ONLY on the call whose slot is held by an occupant");
  const threadBody = bodies.find(x => x.body.p_binding.card_id === 'c_thread').body;
  ok(threadBody.p_comments.length === 2 && threadBody.p_event.import_run_id === 'unit' && threadBody.p_event.action === 'crosswalk_phase2_bind_and_import',
    'the thread travels in p_comments and the event names the run');
  ok(applied.applied_count === 4 && applied.refusal_count === 1 && applied.refusals_by_code.slot_occupied === 1
    && applied.evicted_count === 1 && applied.evicted_by_mode.canceled === 1 && applied.imported_count === 2,
    'receipts and refusals are counted separately, by the RPC\'s own code with the crosswalk_bind_ prefix dropped');
  let capped = '';
  try { await runner.applyPlan(plan, rpc, { cap: 3 }); } catch (e) { capped = e.message; }
  ok(capped === 'cap_exceeded', 'a plan larger than the cap is refused before any call');

  /* ---- 5. run(): confirm token, digest, verification --------------------- */
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'xw2-'));
  const out = path.join(tmp, 'plan.json');
  const planned = await runner.run(['--mode', 'plan', '--run-id', 'r1', '--output', out], {}, { live: async () => LIVE });
  ok(planned.status === 'PLANNED' && fs.existsSync(out) && JSON.parse(fs.readFileSync(out, 'utf8')).plan.digest === plan.digest,
    'plan mode writes the result document and never needs a key');
  let refused = '';
  try { await runner.run(['--mode', 'apply', '--run-id', 'r1', '--expect-plan-digest', plan.digest], {}, { live: async () => LIVE, rpc }); }
  catch (e) { refused = e.message; }
  ok(refused === 'owner_confirmation_required', 'apply without the confirm token is refused before any export is used');
  try { await runner.run(['--mode', 'apply', '--run-id', 'r1', '--expect-plan-digest', 'deadbeef'], { [runner.CONFIRM_ENV]: runner.CONFIRM_TOKEN }, { live: async () => LIVE, rpc }); }
  catch (e) { refused = e.message; }
  ok(refused === 'expected_plan_digest_mismatch', 'apply with a stale digest is refused before any call');
  let exports = 0;
  const liveTwice = async () => { exports++; return exports === 1 ? LIVE : moved; };
  const result = await runner.run(['--mode', 'apply', '--run-id', 'r1', '--expect-plan-digest', plan.digest, '--cap', '10'],
    { [runner.CONFIRM_ENV]: runner.CONFIRM_TOKEN }, { live: liveTwice, rpc });
  ok(exports === 2 && result.status === 'PARTIAL' && result.verification && typeof result.verification.mismatching_slots_remaining === 'number',
    'a confirmed, digest-pinned apply calls, then RE-EXPORTS and re-plans to report what is left (PARTIAL when the RPC refused any call)');

  /* ---- 6. the public log sees counts, never identifiers ------------------ */
  const md = runner.renderSummaryMarkdown(result);
  ok(/calls planned: 5/.test(md) && /refused by the RPC: 1 — slot_occupied 1/.test(md) && /relabels on bind: other->thumbnail 1, thumbnail->video 1/.test(md),
    'the summary renders the counts and reason enums');
  ok(!/c_plain|d_shell|VID-500|acme/.test(md), 'and no card id, deliverable id, Linear identifier or client slug');

  /* ---- 7. the lane ----------------------------------------------------------- */
  const LANE = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'crosswalk-phase2-repair.yml'), 'utf8');
  ok(/environment: production/.test(LANE) && /SUPABASE_SERVICE_ROLE_KEY: \$\{\{ secrets\.SUPABASE_SERVICE_ROLE_KEY \}\}/.test(LANE),
    'the lane takes the service key from the production Environment only');
  ok(/git merge-base --is-ancestor "\$RUN_COMMIT" origin\/main/.test(LANE) && /\^\[0-9a-f\]\{40\}\$/.test(LANE),
    'and runs only an exact 40-character commit that is on main');
  ok(/CROSSWALK_CONFIRM_PHASE2_REPAIR: \$\{\{ inputs\.confirm \}\}/.test(LANE) && /--expect-plan-digest "\$EXPECTED_PLAN_DIGEST"/.test(LANE),
    'apply is gated by the confirm token and the reviewed plan digest');
  ok(!/upload-artifact/.test(LANE) && /--output plan-result\.json > \/dev\/null/.test(LANE) && /--output apply-result\.json > \/dev\/null/.test(LANE)
    && /renderSummaryMarkdown/.test(LANE),
    'the result documents stay on the runner; only the summary renderer reaches the run log');
  ok(/workflow_dispatch:/.test(LANE) && !/schedule:/.test(LANE) && !/pull_request/.test(LANE),
    'manual-only: no schedule, no pull_request trigger');

  if (failures) { console.log(`\n${failures} check(s) failed.`); process.exit(1); }
  console.log('\ncrosswalk phase 2 runner checks passed');
})().catch(error => { console.error('FAIL  threw: ' + (error && error.stack || error)); process.exit(1); });
