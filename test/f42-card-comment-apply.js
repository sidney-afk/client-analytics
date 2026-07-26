'use strict';

// Unit coverage for the F42 card-comment APPLY runner. The database is faked
// here (injected importOne/readback); the disposable-PostgreSQL apply rehearsal
// (scripts/f42-apply-rehearsal.js) exercises the same runner against the real
// migrations and RPC.

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  SNAPSHOT_CONTRACT,
  sourceCoverage,
} = require('../scripts/f42-card-comment-import');
const planner = require('../scripts/f42-card-comment-import');
const apply = require('../scripts/f42-card-comment-apply');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}


// The v2 snapshot carries the deliverable crosswalk the import RPC re-checks.
// Derive a MATCHING one from the fixture cards so existing cases stay valid;
// mismatch cases build their own deliberately-wrong crosswalk.
function deliverablesFor(calendar, sxr) {
  const rows = [];
  const seen = new Set();
  const add = (cards, origin) => {
    for (const card of cards || []) {
      const slug = String((card && (card.client_slug || card.client)) || '');
      for (const [field, team] of [['video_deliverable_id', 'video'], ['graphic_deliverable_id', 'graphics']]) {
        const id = String((card && card[field]) || '');
        if (!id || seen.has(id)) continue;
        seen.add(id);
        rows.push({ id, client_slug: slug, team, origin, card_id: String((card && card.id) || '') });
      }
    }
  };
  add(calendar, 'calendar');
  add(sxr, 'samples');
  return rows;
}

function snapshotFor(calendar, sxr, deliverables) {
  return {
    contract: SNAPSHOT_CONTRACT,
    surfaces: { calendar, sxr },
    deliverables: deliverables || deliverablesFor(calendar, sxr),
    manifest: {
      surfaces: {
        calendar: sourceCoverage(calendar, 'calendar'),
        sxr: sourceCoverage(sxr, 'sxr'),
      },
    },
  };
}

const calendarCards = [{
  id: 'card-apply-a',
  client_slug: 'test-client',
  video_deliverable_id: 'deliverable-video-a',
  graphic_deliverable_id: 'deliverable-graphic-a',
  comments: [
    { id: 'root', author: 'SMM', role: 'smm', body: 'Root note',
      created_at: '2026-07-23T10:00:00Z', updated_at: '2026-07-23T10:00:00Z' },
    { id: 'reply', parent_id: 'root', author: 'Client', role: 'client', body: 'Reply note',
      created_at: '2026-07-23T10:01:00Z', updated_at: '2026-07-23T10:01:00Z' },
  ],
  graphic_comments: [
    { id: 'graphic-root', author: 'Designer', role: 'designer', body: 'Graphic note',
      created_at: '2026-07-23T11:00:00Z' },
  ],
}];

(async () => {
  const goodSnapshot = snapshotFor(calendarCards, []);
  const plan = apply.derivePlan(goodSnapshot, { importRunId: 'apply-fixture-run' });
  ok(plan.complete === true && plan.conflicts.length === 0 && plan.imports.length === 3,
    'the fixture snapshot derives a complete three-comment plan');

  const verdict = apply.applyEligibility(plan);
  ok(verdict.eligible === true && verdict.reasons.length === 0,
    'a complete, conflict-free, certified plan is apply-eligible');

  // Ineligible plans are blocked, not partially applied.
  const conflictPlan = apply.derivePlan(snapshotFor([{
    id: 'card-bad', client_slug: 'test-client', video_deliverable_id: 'd',
    comments: '{"not":"an array"}',
  }], []), { importRunId: 'blocked-run' });
  const blocked = apply.applyEligibility(conflictPlan);
  ok(blocked.eligible === false && blocked.reasons.includes('plan_has_conflicts'),
    'a plan with conflicts is blocked with an explicit reason');
  const legacyArrayPlan = apply.derivePlan(calendarCards, { importRunId: 'legacy-run' });
  ok(apply.applyEligibility(legacyArrayPlan).reasons.includes('snapshot_contract_required'),
    'an uncertified (bare-array) plan can never be applied');

  // applyImports preserves planner order (parents before children) and verifies
  // each RPC result carries the exact canonical id.
  const applied = [];
  const importOne = (link, comment) => {
    applied.push(comment.id);
    return { id: comment.id };
  };
  const result = await apply.applyImports(plan, importOne);
  const rootId = plan.imports.find(i => i.identity.endsWith('|root')).comment.id;
  const replyId = plan.imports.find(i => i.identity.endsWith('|reply')).comment.id;
  ok(result.applied_count === 3
    && result.unique_comment_count === 3
    && applied.indexOf(rootId) < applied.indexOf(replyId),
  'applyImports applies every canonical comment in parents-before-children order');

  let mismatchThrew = '';
  try {
    await apply.applyImports(plan, () => ({ id: 'pc_card_wrong' }));
  } catch (error) { mismatchThrew = error && error.message; }
  ok(mismatchThrew === 'apply_result_identity_mismatch',
    'a RPC result whose canonical id drifts from the plan fails loud');

  // Finding P1 #3 — per-row audience verification (not just counts): a persisted
  // row whose audience drifts from the plan fails loud before APPLIED.
  let audienceMismatchThrew = '';
  try {
    await apply.applyImports(plan, (link, comment) => ({
      id: comment.id,
      audience: comment.audience === 'internal' ? 'client' : 'internal',
    }));
  } catch (error) { audienceMismatchThrew = error && error.message; }
  ok(audienceMismatchThrew === 'apply_result_audience_mismatch',
    'a persisted row whose audience drifts from the plan fails loud (per-row audience verification)');
  const auditedResult = await apply.applyImports(plan,
    (link, comment) => ({ id: comment.id, audience: comment.audience }));
  ok(auditedResult.applied_count === 3
    && auditedResult.receipts.every(receipt => typeof receipt.audience === 'string'),
    'per-row audience that matches the plan applies and is carried on the receipt');

  // verifyCounts requires the applied receipts and the independent DB readback
  // to both equal the planned canonical count.
  const okVerify = apply.verifyCounts(plan, result, { card_link_count: 3, comment_count: 3 });
  ok(okVerify.ok === true && okVerify.mismatches.length === 0,
    'verifyCounts passes when planned, applied, and DB readback all agree');
  const gapVerify = apply.verifyCounts(plan, result, { card_link_count: 2, comment_count: 3 });
  ok(gapVerify.ok === false && gapVerify.mismatches.includes('card_link_count'),
    'a readback short of the planned count is a verification gap');

  // Full orchestration returns APPLIED only when verification passes.
  const okRun = await apply.applyPlan(plan, {
    importOne: (link, comment) => ({ id: comment.id }),
    readback: () => ({ card_link_count: 3, comment_count: 3 }),
  });
  ok(okRun.status === 'APPLIED'
    && okRun.applied_count === 3
    && okRun.receipts.length === 3
    && /^[a-f0-9]{64}$/.test(okRun.apply_digest),
  'applyPlan reports APPLIED with receipts and a stable apply digest when counts verify');
  const gapRun = await apply.applyPlan(plan, {
    importOne: (link, comment) => ({ id: comment.id }),
    readback: () => ({ card_link_count: 1, comment_count: 1 }),
  });
  ok(gapRun.status === 'GAPS',
    'applyPlan reports GAPS when the DB readback disagrees with the planned count');

  // The apply digest is deterministic over the same reviewed snapshot and
  // distinguishes a different applied set.
  const digestA = apply.planApplyDigest(plan);
  const digestB = apply.planApplyDigest(apply.derivePlan(goodSnapshot, { importRunId: 'apply-fixture-run' }));
  const digestOther = apply.planApplyDigest(apply.derivePlan(snapshotFor(calendarCards, [{
    id: 'sxr-card', client_slug: 'test-client', video_deliverable_id: 'deliverable-video-s',
    comments: [{ id: 'sxr-root', author: 'SMM', role: 'smm', body: 'SXR note', created_at: '2026-07-23T10:00:00Z' }],
  }]), { importRunId: 'apply-fixture-run' }));
  ok(digestA === digestB && digestA !== digestOther,
    'the apply digest is deterministic per reviewed snapshot and changes with the applied set');

  // ---- Public-safe blocked-plan breakdown -----------------------------------
  // A blocked plan must explain ITSELF in the public run summary without any
  // identifier escaping. Build a snapshot whose rows carry distinctive, easily
  // greppable identifiers and several distinct blocking classifications.
  const SECRETS = ['acme-holdings', 'card-secret-9911', 'cmt-secret-4242', 'deliverable-secret-77'];
  const blockedSnapshot = snapshotFor([{
    id: 'card-secret-9911',
    client_slug: 'acme-holdings',
    video_deliverable_id: 'deliverable-secret-77',
    comments: [
      { id: 'cmt-secret-4242', author: 'SMM', role: 'smm', body: 'Bad stamp',
        created_at: '2026-07-23T10:00:00Z', edited_at: '2026-02-30T10:00:00Z' },
      { id: 'cmt-secret-root', author: 'SMM', role: 'smm', audience: 'client', body: 'Client root',
        created_at: '2026-07-23T10:00:00Z' },
      { id: 'cmt-secret-reply', parent_id: 'cmt-secret-root', author: 'SMM', role: 'smm',
        audience: 'internal', body: 'Internal reply', created_at: '2026-07-23T10:01:00Z' },
      { id: 'cmt-secret-round', author: 'SMM', role: 'smm', body: 'Bad round',
        created_at: '2026-07-23T10:02:00Z', round: 0 },
    ],
  }], []);
  const blockedPlan = apply.derivePlan(blockedSnapshot, { importRunId: 'blocked-breakdown-run' });
  const breakdown = apply.conflictBreakdown(blockedPlan);
  ok(blockedPlan.complete === false
    && breakdown.total_conflicts === blockedPlan.conflicts.length
    && breakdown.total_conflicts >= 3
    && breakdown.by_classification.length >= 3,
  'the breakdown tallies every blocking conflict on a blocked plan');
  const classifications = breakdown.by_classification.map(row => row.classification);
  ok(classifications.includes('malformed_lifecycle_timestamp')
    && classifications.includes('audience_quarantine')
    && classifications.includes('invalid_round')
    && breakdown.by_classification.every(row =>
      Object.keys(row).sort().join(',') === 'classification,count,reason,surface')
    && breakdown.by_classification.every(row => ['calendar', 'sxr', 'unspecified'].includes(row.surface)),
  'each breakdown row carries only the classification/surface/reason enums and a count');

  // The load-bearing guarantee: NOTHING identifying survives into the render.
  const blockedRendered = apply.renderPlanSummaryMarkdown({
    status: 'BLOCKED', eligible: false, reasons: ['plan_has_conflicts'],
    apply_digest: 'a'.repeat(64), conflict_breakdown: breakdown, coverage: blockedPlan.coverage,
  });
  ok(SECRETS.every(secret => !blockedRendered.includes(secret))
    && !/Bad stamp|Client root|Internal reply|Bad round/.test(blockedRendered),
  'the rendered blocked summary leaks no card id, comment id, client slug, or body');
  ok(/## F42 import — PLAN/.test(blockedRendered)
    && /- status: BLOCKED/.test(blockedRendered)
    && /- blocking gates: plan_has_conflicts/.test(blockedRendered)
    && /### Blocking reasons \(classification enums and counts only\)/.test(blockedRendered)
    && /\| `malformed_lifecycle_timestamp` \| calendar \| `unparseable_timestamp` \| 1 \|/.test(blockedRendered)
    && /\| `audience_quarantine` \| calendar \| `internal_reply_under_client_visible_root` \| 1 \|/.test(blockedRendered),
  'the rendered blocked summary names each blocking classification, its surface, and its count');
  ok(/- planned imports: \d+ \(calendar \d+, sxr \d+\)/.test(blockedRendered)
    && /- source comment rows: \d+/.test(blockedRendered)
    && /- deferred rows \(out of scope, not imported\): \d+/.test(blockedRendered)
    && /- link-defect rows \(bad link, not imported\): \d+/.test(blockedRendered)
    && /- excluded rows: \d+ \(deferred, link-defect and blocked rows plus collapsed exact-duplicate aliases\)/.test(blockedRendered)
    && /- import scope: linked-cohort/.test(blockedRendered),
  'the rendered blocked summary reports planned-vs-deferred-vs-defect-vs-excluded totals and the scope');

  // A coverage_mismatch has no `reason`; its coverage field names are enums.
  const coverageBlocked = apply.conflictBreakdown(apply.derivePlan(
    snapshotFor(calendarCards, []), { importRunId: 'x' },
  ));
  const mismatchSnapshot = JSON.parse(JSON.stringify(snapshotFor(calendarCards, [])));
  mismatchSnapshot.manifest.surfaces.calendar.cards += 1;
  const mismatchRows = apply.conflictBreakdown(
    apply.derivePlan(mismatchSnapshot, { importRunId: 'x' }),
  ).by_classification.filter(row => row.classification === 'coverage_mismatch');
  ok(coverageBlocked.total_conflicts === 0
    && mismatchRows.length === 1
    && mismatchRows[0].reason === 'fields:cards'
    && mismatchRows[0].surface === 'calendar',
  'a coverage_mismatch reports its coverage field names (enums), never expected/actual hashes');

  // ---- Linked-cohort scope: unlinked cards DEFER, never block ---------------
  // At the 2026-07-24 plan run 6,032 of 6,681 rows were missing_deliverable_id.
  // Those rows have no native deliverable binding for the canonical crosswalk to
  // address, so no owner action during the window makes them importable —
  // blocking on them kept the 649 plannable rows permanently unimportable.
  const mixedCohort = snapshotFor(calendarCards, [{
    // Unlinked: no video_deliverable_id / graphic_deliverable_id.
    id: 'sxr-unlinked', client_slug: 'test-client',
    comments: [
      { id: 'u-root', author: 'SMM', role: 'smm', body: 'Unlinked root', created_at: '2026-07-23T10:00:00Z' },
      { id: 'u-reply', parent_id: 'u-root', author: 'Client', role: 'client', body: 'Unlinked reply', created_at: '2026-07-23T10:01:00Z' },
    ],
  }]);
  const mixedPlan = apply.derivePlan(mixedCohort, { importRunId: 'mixed-cohort-run' });
  ok(mixedPlan.complete === true
    && mixedPlan.conflicts.length === 0
    && mixedPlan.imports.length === 3
    && mixedPlan.deferrals.length === 2
    && mixedPlan.deferrals.every(row => row.classification === 'missing_deliverable_id'
      && row.reason === 'card_has_no_native_deliverable_binding'),
  'an unlinked card DEFERS: the linked cohort still certifies complete-for-scope');
  ok(mixedPlan.scope
    && mixedPlan.scope.policy === 'linked-cohort'
    && mixedPlan.scope.planned_imports === 3
    && mixedPlan.scope.deferred_rows === 2,
  'the plan declares its import scope, planned count and deferred count in the artifact');
  const mixedVerdict = apply.applyEligibility(mixedPlan);
  ok(mixedVerdict.eligible === true && mixedVerdict.reasons.length === 0,
    'a plan carrying deferred rows is apply-eligible');
  ok(!mixedPlan.imports.some(item => item.link.card_id === 'sxr-unlinked'),
    'no deferred row is ever planned for import');

  // Every OTHER conflict class still blocks, including alongside deferrals.
  const deferPlusBlockPlan = apply.derivePlan(snapshotFor([{
    id: 'card-bad-round', client_slug: 'test-client', video_deliverable_id: 'd-round',
    comments: [{ id: 'r', author: 'SMM', role: 'smm', body: 'Bad round', created_at: '2026-07-23T10:00:00Z', round: 0 }],
  }], [{
    id: 'sxr-unlinked-2', client_slug: 'test-client',
    comments: [{ id: 'u2', author: 'SMM', role: 'smm', body: 'Unlinked', created_at: '2026-07-23T10:00:00Z' }],
  }]), { importRunId: 'defer-plus-block' });
  ok(deferPlusBlockPlan.complete === false
    && deferPlusBlockPlan.deferrals.length === 1
    && deferPlusBlockPlan.conflicts.some(row => row.classification === 'invalid_round')
    && !deferPlusBlockPlan.conflicts.some(row => row.classification === 'missing_deliverable_id')
    && apply.applyEligibility(deferPlusBlockPlan).reasons.includes('plan_has_conflicts'),
  'deferral never masks a real blocking conflict on another card');

  // The apply gate refuses a plan that does not declare the expected scope, so a
  // differently-scoped or pre-policy plan can never be applied by this runner.
  ok(apply.applyEligibility({ ...mixedPlan, scope: { policy: 'whole-source' } })
    .reasons.includes('plan_scope_unrecognized')
    && apply.applyEligibility({ ...mixedPlan, scope: null })
      .reasons.includes('plan_scope_unrecognized')
    && apply.applyEligibility({ ...mixedPlan, deferrals: undefined })
      .reasons.includes('plan_deferrals_unreported'),
  'the apply gate refuses a plan whose scope is unrecognized or whose deferrals are unreported');

  // The drift guard must not be hostage to the deferred cohort: editing an
  // unlinked card cannot change what is applied, so the digest must hold.
  const mixedEditedDeferred = snapshotFor(calendarCards, [{
    id: 'sxr-unlinked', client_slug: 'test-client',
    comments: [
      { id: 'u-root', author: 'SMM', role: 'smm', body: 'Unlinked root EDITED', created_at: '2026-07-23T10:00:00Z' },
      { id: 'u-reply', parent_id: 'u-root', author: 'Client', role: 'client', body: 'Unlinked reply', created_at: '2026-07-23T10:01:00Z' },
      { id: 'u-extra', author: 'SMM', role: 'smm', body: 'Another unlinked row', created_at: '2026-07-23T10:02:00Z' },
    ],
  }]);
  const editedDeferredPlan = apply.derivePlan(mixedEditedDeferred, { importRunId: 'mixed-cohort-run' });
  ok(apply.planApplyDigest(editedDeferredPlan) === apply.planApplyDigest(mixedPlan)
    && editedDeferredPlan.deferrals.length === 3,
  'editing or adding a DEFERRED row does not move the apply digest (the guard tracks the applied cohort)');
  const mixedEditedLinked = snapshotFor(calendarCards.map(card => ({
    ...card,
    comments: card.comments.map(c => c.id === 'root' ? { ...c, body: 'Root note CHANGED' } : c),
  })), mixedCohort.surfaces.sxr);
  ok(apply.planApplyDigest(apply.derivePlan(mixedEditedLinked, { importRunId: 'mixed-cohort-run' }))
    !== apply.planApplyDigest(mixedPlan),
  'editing a LINKED row still moves the apply digest and refuses the apply');
  // Manifest certification stays pinned in the digest.
  const uncertifiedMixed = JSON.parse(JSON.stringify(mixedCohort));
  uncertifiedMixed.manifest.surfaces.sxr.cards += 1;
  ok(apply.applyCoverageScope(mixedPlan).sxr.matches_manifest === true
    && apply.planApplyDigest(apply.derivePlan(uncertifiedMixed, { importRunId: 'mixed-cohort-run' }))
      !== apply.planApplyDigest(mixedPlan),
  'the per-surface manifest certification remains part of the apply digest');

  // The deferred cohort is rendered publicly, with the same enum-only allowlist.
  const mixedRendered = apply.renderPlanSummaryMarkdown({
    status: 'READY', eligible: true, reasons: [], apply_digest: 'c'.repeat(64),
    conflict_breakdown: apply.conflictBreakdown(mixedPlan),
  });
  ok(/### Deferred — out of scope, NOT imported and not blocking/.test(mixedRendered)
    && /\| `missing_deliverable_id` \| sxr \| `card_has_no_native_deliverable_binding` \| 2 \|/.test(mixedRendered)
    && !/### Blocking reasons/.test(mixedRendered)
    && !mixedRendered.includes('sxr-unlinked')
    && !/Unlinked root|Unlinked reply/.test(mixedRendered),
  'the deferred cohort renders as counts by classification/surface/reason and leaks no identifier');

  // ---- RPC-parity: what the RPC enforces, the planner must pre-validate -----
  // Each case below was empirically REJECTED by the real
  // production_comment_card_import while the planner certified it (see the
  // rehearsal, which re-proves the rejection against the live migration).
  const gapPlan = (cards, deliverables) => apply.derivePlan(
    snapshotFor(cards, [], deliverables), { importRunId: 'gap-run' });
  const gapCard = (over, cardOver) => [Object.assign({
    id: 'gap-card', client_slug: 'test-client', video_deliverable_id: 'gap-dlv',
    comments: [Object.assign(
      { id: 'g1', author: 'SMM', role: 'smm', body: 'Note', created_at: '2026-07-23T10:00:00Z' },
      over,
    )],
  }, cardOver || {})];
  const classesOf = plan => new Set([
    ...plan.conflicts.map(c => c.classification),
    ...plan.deferrals.map(d => `defer:${d.classification}`),
  ]);

  // Gap A — PostgreSQL text cannot hold a NUL byte; PostgREST rejects the call.
  const NUL = String.fromCharCode(0);
  const nulBody = gapPlan(gapCard({ body: `has${NUL}nul` }));
  const nulAuthor = gapPlan(gapCard({ author: `a${NUL}b` }));
  const nulAttachment = gapPlan(gapCard({
    attachments: [{ url: 'https://example.invalid/a.png', name: `n${NUL}m` }],
  }));
  ok(classesOf(nulBody).has('unsupported_text_control_character')
    && classesOf(nulAuthor).has('unsupported_text_control_character')
    && classesOf(nulAttachment).has('unsupported_text_control_character')
    && nulBody.imports.length === 0 && nulAuthor.imports.length === 0
    && nulAttachment.imports.length === 0
    && nulBody.conflicts.find(c => c.classification === 'unsupported_text_control_character')
      .reason === 'control_character_in_text',
  'a NUL byte anywhere in the built payload blocks at plan time (body, author, attachment)');
  // The screen covers the whole C0 range and DEL, not just NUL: any control
  // character in a comment body is content nobody can see and no reader renders
  // faithfully. Tab, LF and CR stay legal — ordinary in a multi-line body.
  for (const [label, code] of [['SOH', 1], ['ESC', 0x1b], ['DEL', 0x7f]]) {
    const plan = gapPlan(gapCard({ body: `x${String.fromCharCode(code)}y` }));
    ok(classesOf(plan).has('unsupported_text_control_character') && plan.imports.length === 0,
      `a ${label} control character in a body also blocks at plan time`);
  }
  for (const [label, code] of [['tab', 9], ['newline', 10], ['carriage return', 13]]) {
    const plan = gapPlan(gapCard({ body: `x${String.fromCharCode(code)}y` }));
    ok(!classesOf(plan).has('unsupported_text_control_character'),
      `a ${label} is legal in a body and does not block`);
  }
  ok(planner.firstNulPath({ a: { b: [`x${NUL}`] } }) === 'a.b.0'
    && planner.firstNulPath({ a: 'clean' }) === '',
  'the NUL scan reports the offending JSON path and passes clean payloads');

  // Gap B — round is int4; a larger positive integer passes every JS check.
  const bigRound = gapPlan(gapCard({ round: planner.PG_INT4_MAX + 1 }));
  const maxRound = gapPlan(gapCard({ round: planner.PG_INT4_MAX }));
  ok(classesOf(bigRound).has('invalid_round')
    && bigRound.conflicts.find(c => c.classification === 'invalid_round')
      .reason === 'round_exceeds_int4_range'
    && bigRound.imports.length === 0
    && maxRound.complete === true && maxRound.imports[0].comment.round === planner.PG_INT4_MAX,
  'a round above int4 range blocks while the exact int4 maximum still plans');

  // Gap C — the crosswalk the RPC re-checks. This is what killed the live apply.
  const goodCrosswalk = [{
    id: 'gap-dlv', client_slug: 'test-client', team: 'video',
    origin: 'calendar', card_id: 'gap-card',
  }];
  ok(gapPlan(gapCard({}), goodCrosswalk).complete === true,
    'a matching crosswalk certifies');
  const absent = gapPlan(gapCard({}), []);
  ok(classesOf(absent).has('defer:deliverable_not_found')
    && absent.complete === true && absent.imports.length === 0,
  'a deliverable absent from the crosswalk DEFERS (no target exists) and never plans');
  // A deliverable that EXISTS but points elsewhere is a link DEFECT: never
  // imported, but non-blocking, because it needs a linkage-repair session rather
  // than an import fix. The RPC's own crosswalk refusal stays the apply-time
  // backstop, so a mis-classification here still cannot write to a wrong target.
  for (const [label, row] of [
    ['card_id', { ...goodCrosswalk[0], card_id: 'another-card' }],
    ['client_slug', { ...goodCrosswalk[0], client_slug: 'another-client' }],
    ['team', { ...goodCrosswalk[0], team: 'graphics' }],
    ['origin', { ...goodCrosswalk[0], origin: 'samples' }],
  ]) {
    const plan = gapPlan(gapCard({}), [row]);
    const defect = plan.defects.find(d => d.classification === 'deliverable_crosswalk_mismatch');
    ok(plan.complete === true && plan.conflicts.length === 0
      && plan.imports.length === 0
      && defect && defect.fields.includes(label)
      && !plan.deferrals.some(d => d.classification === 'deliverable_crosswalk_mismatch'),
    `a deliverable whose ${label} disagrees is a non-blocking DEFECT that never imports`);
  }
  const defectPlan = gapPlan(gapCard({}), [{ ...goodCrosswalk[0], card_id: 'another-card' }]);
  ok(!JSON.stringify(defectPlan.defects.map(d =>
    ({ classification: d.classification, fields: d.fields, reason: d.reason })))
    .includes('another-card'),
  'a crosswalk defect reports field names only — never the differing card id or slug');
  ok(defectPlan.defects[0].card_id === 'gap-card'
    && defectPlan.defects[0].native_comment_id === 'g1'
    && defectPlan.defects[0].component === 'video'
    && defectPlan.defects[0].surface === 'calendar',
  'the runner-local plan still records the per-row identity for the linkage-repair session');
  ok(apply.applyEligibility(defectPlan).eligible === false
    && apply.applyEligibility(defectPlan).reasons.includes('plan_has_no_imports')
    && !apply.applyEligibility(defectPlan).reasons.includes('plan_has_conflicts'),
  'a defect-only plan is ineligible solely because nothing remains to import, not because it blocks');
  ok(apply.applyEligibility({ ...defectPlan, defects: undefined })
    .reasons.includes('plan_defects_unreported'),
  'a plan that fails to report its defects bucket can never be applied');

  // Defect-and-proceed: a mis-linked card alongside a clean one still certifies,
  // still applies the clean rows, and leaves the digest untouched.
  // Hold the crosswalk CONSTANT across both plans so the comparison isolates the
  // defective rows themselves: the crosswalk fingerprint is legitimately part of
  // the digest (a re-pointed deliverable must move it), so the two snapshots
  // differ only by whether the defective card's comments are present.
  const sharedCrosswalk = [
    ...deliverablesFor(calendarCards, []),
    { id: 'defect-dlv', client_slug: 'test-client', team: 'video', origin: 'calendar', card_id: 'somewhere-else' },
  ];
  const defectCards = gapCard({}, { id: 'defect-card', video_deliverable_id: 'defect-dlv' });
  const withDefectCards = [...calendarCards, ...defectCards];
  const planFor = cards => apply.derivePlan({
    contract: SNAPSHOT_CONTRACT,
    surfaces: { calendar: cards, sxr: [] },
    deliverables: sharedCrosswalk,
    manifest: { surfaces: {
      calendar: sourceCoverage(cards, 'calendar'), sxr: sourceCoverage([], 'sxr') } },
  }, { importRunId: 'apply-fixture-run' });
  const cleanPlusDefect = planFor(withDefectCards);
  const cleanOnly = planFor(calendarCards);
  ok(cleanPlusDefect.complete === true
    && cleanPlusDefect.conflicts.length === 0
    && cleanPlusDefect.defects.length === 1
    && cleanPlusDefect.imports.length === 3
    && apply.applyEligibility(cleanPlusDefect).eligible === true
    && !cleanPlusDefect.imports.some(item => item.link.card_id === 'defect-card'),
  'a link defect does not block the clean cohort and is excluded from the apply set');
  ok(apply.planApplyDigest(cleanPlusDefect) === apply.planApplyDigest(cleanOnly)
    && cleanOnly.defects.length === 0,
  'defective rows contribute nothing to the apply digest (identical to the same plan without them)');
  const defectBreakdown = apply.conflictBreakdown(cleanPlusDefect);
  ok(defectBreakdown.total_defects === 1
    && defectBreakdown.total_conflicts === 0
    && defectBreakdown.defect_by_classification.some(row =>
      row.classification === 'deliverable_crosswalk_mismatch'
      && row.surface === 'calendar'
      && row.count === 1)
    && cleanPlusDefect.scope.defect_rows === 1,
  'defects are tallied in their own breakdown bucket and counted in the declared scope');
  const defectRendered = apply.renderPlanSummaryMarkdown({
    status: 'READY', eligible: true, reasons: [], apply_digest: 'e'.repeat(64),
    conflict_breakdown: defectBreakdown,
  });
  ok(/### Link defects needing repair — NOT imported and not blocking/.test(defectRendered)
    && /\| `deliverable_crosswalk_mismatch` \| calendar \| `crosswalk_fields:card_id` \| 1 \|/.test(defectRendered)
    && /linkage-repair session/.test(defectRendered)
    && !/### Blocking reasons/.test(defectRendered)
    && !defectRendered.includes('defect-card')
    && !defectRendered.includes('somewhere-else'),
  'the public summary gives link defects their own titled section and leaks no identifier');

  // The v2 contract REQUIRES the crosswalk: a v1-shaped snapshot cannot certify.
  const noCrosswalk = apply.derivePlan({
    contract: SNAPSHOT_CONTRACT,
    surfaces: { calendar: calendarCards, sxr: [] },
    manifest: { surfaces: {
      calendar: sourceCoverage(calendarCards, 'calendar'), sxr: sourceCoverage([], 'sxr') } },
  }, { importRunId: 'no-crosswalk' });
  ok(noCrosswalk.complete === false
    && noCrosswalk.conflicts.some(c => c.classification === 'snapshot_contract_required'
      && c.reason === 'deliverable_crosswalk_required'),
  'a snapshot without the deliverable crosswalk can never certify under the v2 contract');
  ok(SNAPSHOT_CONTRACT === 'syncview-f42-card-comment-snapshot-v2',
    'the snapshot contract is v2 now that the crosswalk is mandatory');

  // A deliverable re-pointed between plan and apply moves the digest.
  const repointed = gapPlan(gapCard({}), [{ ...goodCrosswalk[0], card_id: 'moved-card' }]);
  ok(gapPlan(gapCard({}), goodCrosswalk).deliverables_fingerprint
    !== repointed.deliverables_fingerprint
    && /^[a-f0-9]{64}$/.test(gapPlan(gapCard({}), goodCrosswalk).deliverables_fingerprint),
  'the crosswalk fingerprint moves when a deliverable is re-pointed, so the drift guard refuses');

  // ---- Part 1: PostgREST failure detail is an allowlist ---------------------
  let rpcThrew = null;
  try {
    await apply.supabaseDeps({ url: 'https://x.invalid', serviceKey: 'k' }, async () => ({
      ok: false,
      status: 400,
      json: async () => ({
        code: '22P02',
        message: 'invalid input syntax for type integer',
        // Both of these echo row values and must never reach a public log.
        details: 'Failing row contains (pc_card_abc, native:pc_card_abc, PRIVATE BODY TEXT, acme-holdings).',
        hint: 'try value "PRIVATE HINT VALUE"',
      }),
    })).importOne({}, {}, {});
  } catch (error) { rpcThrew = error; }
  const serialized = JSON.stringify({ code: rpcThrew && rpcThrew.message, rpc: rpcThrew && rpcThrew.rpc });
  ok(rpcThrew && rpcThrew.message === 'rpc_production_comment_card_import_400'
    && rpcThrew.rpc.code === '22P02'
    && rpcThrew.rpc.message === 'invalid input syntax for type integer'
    && rpcThrew.rpc.status === 400
    && rpcThrew.rpc.function === 'production_comment_card_import',
  'an RPC failure carries the SQLSTATE code and message alongside the status');
  ok(!serialized.includes('PRIVATE BODY TEXT')
    && !serialized.includes('acme-holdings')
    && !serialized.includes('PRIVATE HINT VALUE')
    && !('details' in rpcThrew.rpc) && !('hint' in rpcThrew.rpc)
    && !('payload' in rpcThrew),
  'details and hint (which echo row values) never reach the failure document');
  let longThrew = null;
  try {
    await apply.supabaseDeps({ url: 'https://x.invalid', serviceKey: 'k' }, async () => ({
      ok: false, status: 400,
      json: async () => ({ code: 'C'.repeat(500), message: 'M'.repeat(500) }),
    })).readback();
  } catch (error) { longThrew = error; }
  ok(longThrew.rpc.code.length === 200 && longThrew.rpc.message.length === 200,
    'RPC code and message are truncated to 200 characters');

  // A READY plan renders the next-dispatch instruction and no blocking table.
  const readyRendered = apply.renderPlanSummaryMarkdown({
    status: 'READY', eligible: true, reasons: [], apply_digest: 'b'.repeat(64),
    conflict_breakdown: apply.conflictBreakdown(plan),
  });
  ok(/- status: READY/.test(readyRendered)
    && !/### Blocking reasons/.test(readyRendered)
    && /Re-run this workflow with mode=apply/.test(readyRendered),
  'a READY plan renders the next-dispatch instruction and no blocking table');

  // An apply document renders verification counts/mismatch enums, no receipts.
  const gapsRendered = apply.renderPlanSummaryMarkdown(gapRun);
  ok(/## F42 import — APPLY/.test(gapsRendered)
    && /- status: GAPS/.test(gapsRendered)
    && /- verification mismatches: card_link_count, comment_count/.test(gapsRendered)
    && /- readback links \/ comments: 1 \/ 1/.test(gapsRendered)
    && !gapRun.receipts.some(receipt => gapsRendered.includes(receipt.production_comment_id)),
  'a GAPS apply renders its verification counts and mismatch enums, never its receipts');

  // CLI: source-only preview is READY and touches no database; --apply needs the
  // owner confirmation token and applies via injected deps.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f42-apply-'));
  try {
    const snapshotPath = path.join(tmp, 'snapshot.json');
    fs.writeFileSync(snapshotPath, JSON.stringify(goodSnapshot));
    const preview = await apply.run(['--input', snapshotPath, '--import-run-id', 'apply-fixture-run'], {});
    ok(preview.status === 'READY' && preview.source_only === true && preview.planned_imports === 3,
      'the CLI source-only preview reports READY without any database work');

    let confirmThrew = '';
    try {
      await apply.run(['--input', snapshotPath, '--import-run-id', 'apply-fixture-run', '--apply'], {});
    } catch (error) { confirmThrew = error && error.message; }
    ok(confirmThrew === 'owner_confirmation_required',
      '--apply refuses without the owner confirmation token');

    const applyCalls = [];
    const gatedApply = await apply.run(
      ['--input', snapshotPath, '--import-run-id', 'apply-fixture-run', '--apply'],
      { [apply.CONFIRM_ENV]: apply.CONFIRM_TOKEN },
      {
        importOne: (link, comment) => { applyCalls.push(comment.id); return { id: comment.id }; },
        readback: () => ({ card_link_count: 3, comment_count: 3 }),
      },
    );
    ok(gatedApply.status === 'APPLIED' && applyCalls.length === 3,
      'a confirmed --apply run applies every planned comment through the injected RPC layer');

    // Reviewed-plan pinning: a mismatched reviewed plan is refused before apply.
    const reviewedPath = path.join(tmp, 'reviewed.json');
    fs.writeFileSync(reviewedPath, JSON.stringify(apply.derivePlan(goodSnapshot, { importRunId: 'apply-fixture-run' })));
    const pinned = await apply.run(['--input', snapshotPath, '--import-run-id', 'apply-fixture-run', '--plan', reviewedPath], {});
    ok(pinned.status === 'READY',
      'a snapshot whose re-derived digest matches the reviewed plan stays READY');
    fs.writeFileSync(reviewedPath, JSON.stringify({ contract: SNAPSHOT_CONTRACT, imports: [], coverage: {} }));
    let pinThrew = '';
    try {
      await apply.run(['--input', snapshotPath, '--import-run-id', 'apply-fixture-run', '--plan', reviewedPath], {});
    } catch (error) { pinThrew = error && error.message; }
    ok(pinThrew === 'reviewed_plan_digest_mismatch',
      'a reviewed plan whose digest differs from the re-derived plan is refused');

    // --expect-apply-digest drift guard (split plan/apply dispatches).
    const expectedDigest = apply.planApplyDigest(apply.derivePlan(goodSnapshot, { importRunId: 'apply-fixture-run' }));
    const matchedDigest = await apply.run(
      ['--input', snapshotPath, '--import-run-id', 'apply-fixture-run', '--expect-apply-digest', expectedDigest], {});
    ok(matchedDigest.status === 'READY',
      'a matching --expect-apply-digest passes the drift guard');
    let digestThrew = '';
    try {
      await apply.run(['--input', snapshotPath, '--import-run-id', 'apply-fixture-run',
        '--expect-apply-digest', '0'.repeat(64), '--apply'],
      { [apply.CONFIRM_ENV]: apply.CONFIRM_TOKEN },
      { importOne: () => ({ id: 'x' }), readback: () => ({ card_link_count: 0, comment_count: 0 }) });
    } catch (error) { digestThrew = error && error.message; }
    ok(digestThrew === 'expected_apply_digest_mismatch',
      'an apply whose re-derived digest drifts from the reviewed plan is refused before any write');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // The guarded workflow_dispatch import lane locks the same gates the runner
  // enforces: an exact 40-char SHA that must be an ancestor of main, plan mode
  // never applies, apply mode requires the confirm token + the apply-digest
  // drift guard, and the private snapshot is never uploaded as an artifact.
  const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'f42-card-comment-import.yml'), 'utf8');
  ok(/\^\[0-9a-f\]\{40\}\$/.test(wf)
    && /git merge-base --is-ancestor "\$RUN_COMMIT" origin\/main/.test(wf),
  'the import workflow pins an exact 40-character commit that must be an ancestor of main');
  const planStepAt = wf.indexOf("Plan (review only");
  const applyStepAt = wf.indexOf("Apply (live import");
  ok(planStepAt > 0 && applyStepAt > 0
    && !wf.slice(planStepAt, applyStepAt).includes('--apply')
    && /if: inputs\.mode == 'plan'/.test(wf)
    && /if: inputs\.mode == 'apply'/.test(wf),
  'plan mode never applies; the two modes are separate dispatches');
  ok(/F42_CONFIRM_CARD_COMMENT_IMPORT: \$\{\{ inputs\.confirm \}\}/.test(wf)
    && /--expect-apply-digest "\$EXPECTED_APPLY_DIGEST" --apply/.test(wf)
    && /expected_apply_digest from the reviewed plan run/.test(wf),
  'apply requires the confirm token and pins the reviewed apply digest as a drift guard');
  ok(!/upload-artifact/.test(wf) && /the snapshot file stays on the runner/.test(wf),
  'the private snapshot/plan are never uploaded as artifacts');

  // Finding P1 #2 — the import job runs in the production Environment so a
  // branch copy of the workflow cannot reach SUPABASE_SERVICE_ROLE_KEY.
  ok(/^  f42-import:\n(?:    [^\n]*\n)*    environment: production\n/m.test(wf),
  'the F42 import job runs in the production Environment');

  // Finding P1 #6 — the full result JSON (apply receipts carry canonical/native
  // comment ids + deliverable ids) is redirected to a runner-local file, never
  // teed to the public log; only aggregate counts + the digest are echoed.
  ok(/--import-run-id "\$IMPORT_RUN_ID" \\\n\s*> plan-summary\.json/.test(wf)
    && /--expect-apply-digest "\$EXPECTED_APPLY_DIGEST" --apply \\\n\s*> apply-summary\.json/.test(wf)
    && !/\| tee /.test(wf),
  'the plan/apply result JSON is redirected to a runner-local file, never teed to the public log');
  // Inspect only what is echoed to the log (the inline node payloads), not the
  // explanatory comments that legitimately name the fields being withheld.
  const echoedToLog = (wf.match(/node -e "[^"]*"/g) || []).join('\n');
  ok(echoedToLog.length > 0
    && !/receipts|native_comment_id|deliverable_id|production_comment_id|card_id|client_slug|\.identity|\.body/.test(echoedToLog),
  'the public log echoes only aggregate counts + digest — never receipts or comment/deliverable identities');

  // A blocked plan (and a GAPS apply) exits nonzero. The step must tolerate
  // that exit code, render the public-safe breakdown, and only THEN fail —
  // otherwise `-e` kills the step with no visible reason at all.
  ok(/plan_exit=0\n\s*node scripts\/f42-card-comment-apply\.js/.test(wf)
    && /> plan-summary\.json \|\| plan_exit=\$\?/.test(wf)
    && /> apply-summary\.json \|\| apply_exit=\$\?/.test(wf)
    && wf.indexOf('renderPlanSummaryMarkdown(require(\'./plan-summary.json\'))') < wf.indexOf('exit "$plan_exit"')
    && /if \[ "\$plan_exit" -ne 0 \]/.test(wf)
    && /if \[ "\$apply_exit" -ne 0 \]/.test(wf),
  'a blocked plan / GAPS apply renders its public-safe breakdown before the step fails');
  ok(/if \[ ! -s plan-summary\.json \]/.test(wf) && /if \[ ! -s apply-summary\.json \]/.test(wf),
  'a run that produced no result document fails loudly instead of rendering an empty summary');
  ok((echoedToLog.match(/renderPlanSummaryMarkdown/g) || []).length === 2,
  'both dispatches render their result through the single tested allowlist projection');

  if (failures) {
    console.error(`\n${failures} F42 apply check(s) failed`);
    process.exit(1);
  }
  console.log('\nF42 card-comment apply checks passed');
})().catch(error => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
