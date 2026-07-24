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
const apply = require('../scripts/f42-card-comment-apply');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function snapshotFor(calendar, sxr) {
  return {
    contract: SNAPSHOT_CONTRACT,
    surfaces: { calendar, sxr },
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
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  if (failures) {
    console.error(`\n${failures} F42 apply check(s) failed`);
    process.exit(1);
  }
  console.log('\nF42 card-comment apply checks passed');
})().catch(error => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
