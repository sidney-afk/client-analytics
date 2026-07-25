'use strict';

/*
 * F42 Brick 1 — link-defect repair planner/apply runner.
 *
 * Pins the three things that make this safe to run against production:
 *   1. classification parity with scripts/f42-card-comment-import.js (a repair
 *      is only ever chosen from the planner's own crosswalk_fields reason);
 *   2. authority discipline — Class A and B repair, Class C escalates, anything
 *      ambiguous or colliding is skipped, never guessed;
 *   3. release mechanics — digest drift, mandatory expected-writes, owner
 *      token, rollback artifact written BEFORE the first write, and a public
 *      summary that carries counts only.
 */

const assert = require('assert');
const path = require('path');

const repair = require('../scripts/f42-linkage-defect-repair.js');
const planner = require('../scripts/f42-card-comment-import.js');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else {
    failures++;
    console.error('FAIL  ' + message);
  }
}

function card(extra) {
  return Object.assign({
    id: 'cal-1',
    client: 'acme-co',
    linear_issue_id: 'https://linear.app/synchro-social/issue/VID-1/video',
    comment_counts: { video: 3, graphic: 0, caption: 0, title: 0 },
  }, extra || {});
}

function deliverable(extra) {
  return Object.assign({
    id: 'dlv-1',
    client_slug: 'acme-co',
    team: 'video',
    kind: 'video',
    origin: 'manual',
    card_id: null,
  }, extra || {});
}

function snapshot(cards, deliverables) {
  return {
    cards: { calendar: cards.calendar || [], sxr: cards.sxr || [] },
    deliverables: deliverables || [],
  };
}

(async () => {
  console.log('F42 Brick 1 — link-defect repair\n');

  // ------------------------------------------------------------ planner parity
  const plannerSource = require('fs').readFileSync(
    path.resolve(__dirname, '../scripts/f42-card-comment-import.js'), 'utf8',
  );
  ok(/DEFECT_CLASSIFICATIONS = Object\.freeze\(\['deliverable_crosswalk_mismatch'\]\)/.test(plannerSource),
    'the planner still names the defect class this runner repairs');
  ok(planner.DELIVERABLE_FIELDS.join(',') === 'id,client_slug,team,origin,card_id',
    'the crosswalk field set is unchanged, so the repair targets the right columns');

  // The runner's mismatch detection must agree with the planner's, field for field.
  const c = card({ video_deliverable_id: 'dlv-1' });
  ok(JSON.stringify(repair.mismatchFields(deliverable(), 'calendar', c, 'video'))
    === JSON.stringify(['card_id', 'origin']),
  'an origin=manual/card_id=NULL deliverable is detected as exactly card_id+origin (Class A)');
  ok(JSON.stringify(repair.mismatchFields(
    deliverable({ origin: 'calendar', card_id: 'cal-1', team: 'video', kind: 'thumbnail' }),
    'calendar', c, 'graphic')) === JSON.stringify(['team']),
  'a kind=thumbnail/team=video deliverable in the graphic slot is exactly team (Class B)');
  ok(JSON.stringify(repair.mismatchFields(
    deliverable({ origin: 'calendar', card_id: 'cal-9' }), 'calendar', c, 'video'))
    === JSON.stringify(['card_id']),
  'a deliverable bound to another card is exactly card_id (Class C)');
  ok(repair.mismatchFields(
    deliverable({ origin: 'calendar', card_id: 'cal-1' }), 'calendar', c, 'video').length === 0,
  'a fully matching deliverable reports no mismatch');

  // ------------------------------------------------------------ Class A repair
  const planA = repair.planLinkageRepair(snapshot(
    { calendar: [card({ video_deliverable_id: 'dlv-1' })] },
    [deliverable()],
  ), { runId: 'test-a' });
  ok(planA.writes.length === 1
    && planA.writes[0].repair_class === 'class_a_unstamped_deliverable'
    && planA.writes[0].after.origin === 'calendar'
    && planA.writes[0].after.card_id === 'cal-1'
    && planA.writes[0].before.origin === 'manual'
    && planA.writes[0].before.card_id === '',
  'Class A stamps origin+card_id onto the unclaimed deliverable and records the before-state');
  ok(planA.scope.comment_rows_unblocked === 3,
    'the plan reports how many comment rows the repair unblocks');

  // sxr repairs stamp origin='samples', matching SURFACE_ORIGIN
  const planSxr = repair.planLinkageRepair(snapshot(
    { sxr: [card({ id: 'sxr-1', video_deliverable_id: 'dlv-1' })] },
    [deliverable()],
  ), { runId: 'test-sxr' });
  ok(planSxr.writes.length === 1 && planSxr.writes[0].after.origin === 'samples',
    'an sxr-surface repair stamps origin=samples, not calendar');

  // ------------------------------------------------------------ Class B repair
  const planB = repair.planLinkageRepair(snapshot(
    {
      calendar: [card({
        graphic_deliverable_id: 'dlv-g',
        comment_counts: { video: 0, graphic: 2, caption: 0, title: 0 },
      })],
    },
    [deliverable({ id: 'dlv-g', kind: 'thumbnail', team: 'video', origin: 'calendar', card_id: 'cal-1' })],
  ), { runId: 'test-b' });
  ok(planB.writes.length === 1
    && planB.writes[0].repair_class === 'class_b_team_disagrees_with_kind'
    && JSON.stringify(planB.writes[0].after) === JSON.stringify({ team: 'graphics' })
    && JSON.stringify(planB.writes[0].before) === JSON.stringify({ team: 'video' }),
  'Class B corrects only the team field, in the direction kind implies');

  // ------------------------------------------------------------ Class C escalates
  const planC = repair.planLinkageRepair(snapshot(
    { calendar: [card({ video_deliverable_id: 'dlv-1' })] },
    [deliverable({ origin: 'calendar', card_id: 'cal-9' })],
  ), { runId: 'test-c' });
  ok(planC.writes.length === 0 && planC.owner_rulings.length === 1
    && planC.owner_rulings[0].repair_class === 'class_c_bound_to_another_card'
    && planC.owner_rulings[0].deliverable_currently_bound_to_card_id === 'cal-9'
    && planC.owner_rulings[0].options.length === 2,
  'Class C is NEVER repaired: it is escalated with the specifics and both options');

  // ------------------------------------------------------------ authority guards
  const planCollision = repair.planLinkageRepair(snapshot(
    { calendar: [card({ video_deliverable_id: 'dlv-1' })] },
    [
      deliverable(),
      // already occupies (acme-co, calendar, cal-1, video)
      deliverable({ id: 'dlv-occupant', origin: 'calendar', card_id: 'cal-1' }),
    ],
  ), { runId: 'test-collision' });
  ok(planCollision.writes.length === 0
    && planCollision.skipped.some(row => (row.objections || []).includes('card_slot_unique_would_collide')),
  'a Class A repair that would violate deliverables_card_slot_unique is skipped, not attempted');

  // A cross-client mismatch reports card_id+client_slug+origin, which is not a
  // recognised repair class at all, so it never reaches the Class A authority
  // check — it is refused one step earlier, as an unclassified shape.
  const planWrongClient = repair.planLinkageRepair(snapshot(
    { calendar: [card({ video_deliverable_id: 'dlv-1' })] },
    [deliverable({ client_slug: 'other-co' })],
  ), { runId: 'test-client' });
  ok(planWrongClient.writes.length === 0
    && planWrongClient.skipped.some(row => row.skip_reason === 'unclassified_mismatch_shape'
      && row.reason === 'crosswalk_fields:card_id,client_slug,origin'),
  'a cross-client mismatch is never auto-repaired (no cross-client link can be written)');

  const planClaimed = repair.planLinkageRepair(snapshot(
    { calendar: [card({ video_deliverable_id: 'dlv-1' })] },
    [deliverable({ origin: 'samples', card_id: 'other-card' })],
  ), { runId: 'test-claimed' });
  ok(planClaimed.writes.length === 0
    && planClaimed.skipped.some(row => (row.objections || []).includes('deliverable_already_claims_a_card')),
  'a deliverable already claiming another card is skipped rather than re-pointed');

  // ------------------------------------------------------------ comment-free cards
  const planNoComments = repair.planLinkageRepair(snapshot(
    {
      calendar: [card({
        video_deliverable_id: 'dlv-1',
        comment_counts: { video: 0, graphic: 0, caption: 0, title: 0 },
      })],
    },
    [deliverable()],
  ), { runId: 'test-empty' });
  ok(planNoComments.writes.length === 0,
    'a defect on a comment-free card is not worth a production write and is not planned');

  // ------------------------------------------------------------ fixture exclusion
  ok(repair.linearWorkspace('https://linear.app/x/VID-CLEAN') === 'x'
    && repair.linearWorkspace('https://linear.app/synchro-social/issue/VID-1/v') === 'synchro-social'
    && repair.linearWorkspace('weird text blob') === '',
  'the Linear workspace parser reads the workspace segment and tolerates junk');
  ok(repair.EXCLUDED_LINEAR_WORKSPACES.join(',') === 'x,sidtest,syn,acme',
    'the provisionally-excluded QA fixture workspaces are exactly the owner ruling');

  for (const workspace of repair.EXCLUDED_LINEAR_WORKSPACES) {
    const planFixture = repair.planLinkageRepair(snapshot(
      {
        calendar: [card({
          video_deliverable_id: 'dlv-1',
          linear_issue_id: `https://linear.app/${workspace}/issue/VID-1/v`,
        })],
      },
      [deliverable()],
    ), { runId: 'test-fixture' });
    ok(planFixture.writes.length === 0
      && planFixture.skipped.some(row => row.skip_reason === 'excluded_fixture_workspace'),
    `a card in the ${workspace} fixture workspace is excluded from repair scope`);
  }

  // ------------------------------------------------------------ digest
  ok(repair.repairApplyDigest(planA) === planA.apply_digest
    && /^[0-9a-f]{64}$/.test(planA.apply_digest),
  'the plan carries a stable sha256 apply digest');
  const planA2 = repair.planLinkageRepair(snapshot(
    { calendar: [card({ video_deliverable_id: 'dlv-1' })] }, [deliverable()],
  ), { runId: 'test-a' });
  ok(planA2.apply_digest === planA.apply_digest, 'the digest is deterministic for identical input');
  // The digest pins the whole observed target row, not just the two fields the
  // repair writes — so a drift the repair does not even touch still refuses.
  const planRepointed = repair.planLinkageRepair(snapshot(
    { calendar: [card({ video_deliverable_id: 'dlv-1' })] },
    [deliverable({ kind: 'other' })],
  ), { runId: 'test-a' });
  ok(planRepointed.writes.length === 1 && planRepointed.apply_digest !== planA.apply_digest,
    'a target deliverable mutated between plan and apply moves the digest, even in a field the repair does not write');

  // ------------------------------------------------------------ contradictory repair
  const planContradiction = repair.planLinkageRepair(snapshot(
    {
      calendar: [
        card({ id: 'cal-1', video_deliverable_id: 'shared' , comment_counts: { video: 1, graphic: 0, caption: 0, title: 0 } }),
        card({ id: 'cal-2', video_deliverable_id: 'shared', comment_counts: { video: 1, graphic: 0, caption: 0, title: 0 } }),
      ],
    },
    [deliverable({ id: 'shared' })],
  ), { runId: 'test-contradiction' });
  ok(planContradiction.writes.length === 0
    && planContradiction.conflicts.some(row => row.classification === 'contradictory_repair_for_one_deliverable')
    && planContradiction.complete === false
    && repair.applyEligibility(planContradiction).eligible === false,
  'two cards demanding different after-states for one deliverable is a blocking conflict');

  // one deliverable, several components of the SAME card -> one write, no conflict
  const planFanout = repair.planLinkageRepair(snapshot(
    {
      calendar: [card({
        video_deliverable_id: 'dlv-1',
        comment_counts: { video: 2, graphic: 0, caption: 5, title: 1 },
      })],
    },
    [deliverable()],
  ), { runId: 'test-fanout' });
  ok(planFanout.writes.length === 1
    && planFanout.writes[0].components.sort().join(',') === 'caption,title,video'
    && planFanout.conflicts.length === 0
    && planFanout.scope.comment_rows_unblocked === 8,
  'video/caption/title share one deliverable id and collapse to a single write');

  // ------------------------------------------------------------ public safety
  const summary = repair.renderSummaryMarkdown({ status: 'READY', plan: planC, reasons: [] });
  ok(!summary.includes('cal-1') && !summary.includes('cal-9')
    && !summary.includes('acme-co') && !summary.includes('dlv-1'),
  'the public summary contains no card id, client slug or deliverable id');
  ok(summary.includes('class_c_bound_to_another_card') && summary.includes('crosswalk_fields:card_id'),
    'the public summary still carries the classification and reason enums');
  ok(summary.includes('excluded fixture workspaces')
    && summary.includes('provisional_pending_owner_signoff_at_window'),
  'the summary states the fixture-exclusion policy and that the ruling is provisional');

  const tallied = repair.tallyPublic(planA.repairs);
  ok(tallied.every(row => Object.keys(row).sort().join(',') === 'classification,count,reason,surface'),
    'the tally projection emits only classification/surface/reason/count');

  // ------------------------------------------------------------ release mechanics
  const writes = [];
  const files = new Map();
  const deps = {
    readFileSync: () => JSON.stringify(snapshot(
      { calendar: [card({ video_deliverable_id: 'dlv-1' })] }, [deliverable()],
    )),
    writeFileSync: (p, body) => files.set(String(p), body),
    patchOne: async write => { writes.push(write.deliverable_id); },
  };

  const dryRun = await repair.run(['--input', 'snap.json'], {}, deps);
  ok(dryRun.status === 'READY' && writes.length === 0,
    'a plan run is source-only: READY without touching the database');

  let threw = '';
  try {
    await repair.run(['--input', 'snap.json', '--apply'], {}, deps);
  } catch (error) { threw = error.message; }
  ok(threw === 'expected_writes_required_for_apply',
    'apply refuses without a mandatory --expected-writes count');

  const drift = await repair.run(
    ['--input', 'snap.json', '--expected-writes', '99'], {}, deps,
  );
  ok(drift.status === 'BLOCKED' && drift.reasons.includes('expected_writes_mismatch') && writes.length === 0,
    'a write-count that drifts from the reviewed number blocks before any write');

  const digestDrift = await repair.run(
    ['--input', 'snap.json', '--expected-digest', 'deadbeef'], {}, deps,
  );
  ok(digestDrift.status === 'BLOCKED' && digestDrift.reasons.includes('apply_digest_drift'),
    'a digest that no longer matches the reviewed plan blocks the apply');

  threw = '';
  try {
    await repair.run(
      ['--input', 'snap.json', '--apply', '--expected-writes', '1', '--rollback-artifact', 'r.json'],
      {}, deps,
    );
  } catch (error) { threw = error.message; }
  ok(threw === 'owner_confirmation_required' && writes.length === 0,
    'apply refuses without the exact owner confirm token');

  threw = '';
  try {
    await repair.run(
      ['--input', 'snap.json', '--apply', '--expected-writes', '1'],
      { [repair.CONFIRM_ENV]: repair.CONFIRM_TOKEN }, deps,
    );
  } catch (error) { threw = error.message; }
  ok(threw === 'rollback_artifact_required_for_apply' && writes.length === 0,
    'apply refuses without a rollback artifact path');

  const applied = await repair.run(
    ['--input', 'snap.json', '--apply', '--expected-writes', '1', '--rollback-artifact', 'r.json'],
    { [repair.CONFIRM_ENV]: repair.CONFIRM_TOKEN },
    { ...deps, readback: async () => ({ remaining_defects: 0 }) },
  );
  ok(applied.status === 'APPLIED' && applied.applied === 1 && writes.length === 1,
    'a confirmed, digest-pinned, count-matched apply writes exactly the planned rows');

  const artifact = JSON.parse(files.get(path.resolve('r.json')));
  ok(artifact.applied.length === 1
    && JSON.stringify(artifact.applied[0].restore) === JSON.stringify({ origin: 'manual', card_id: '' }),
  'the rollback artifact records the exact prior value for every applied write');

  // rollback artifact must exist BEFORE the first write
  const order = [];
  const orderedDeps = {
    ...deps,
    writeFileSync: (p, body) => { order.push('artifact'); files.set(String(p), body); },
    patchOne: async () => { order.push('write'); },
    readback: async () => ({ remaining_defects: 0 }),
  };
  await repair.run(
    ['--input', 'snap.json', '--apply', '--expected-writes', '1', '--rollback-artifact', 'r2.json'],
    { [repair.CONFIRM_ENV]: repair.CONFIRM_TOKEN }, orderedDeps,
  );
  ok(order[0] === 'artifact' && order.indexOf('write') > 0,
    'the rollback artifact is written BEFORE the first write, so a mid-run failure is still reversible');

  // a mid-run failure still leaves an artifact covering exactly what landed
  const failingPlan = repair.planLinkageRepair(snapshot(
    {
      calendar: [
        card({ id: 'cal-1', video_deliverable_id: 'dlv-1', comment_counts: { video: 1, graphic: 0, caption: 0, title: 0 } }),
        card({ id: 'cal-2', video_deliverable_id: 'dlv-2', comment_counts: { video: 1, graphic: 0, caption: 0, title: 0 } }),
      ],
    },
    [deliverable(), deliverable({ id: 'dlv-2' })],
  ), { runId: 'test-fail' });
  let calls = 0;
  const partial = await repair.applyRepairs(failingPlan, {
    rollbackArtifact: 'partial.json',
    writeFileSync: (p, body) => files.set(String(p), body),
    patchOne: async () => { calls++; if (calls === 2) throw new Error('boom'); },
  });
  ok(partial.applied === 1 && partial.failure === 'boom'
    && JSON.parse(files.get(path.resolve('partial.json'))).applied.length === 1,
  'a mid-run failure leaves an artifact that reverses exactly the writes that landed');
  ok(repair.verifyApply(failingPlan, partial, {}).some(gap => gap.startsWith('patch_failed')),
    'a partial apply verifies as GAPS, never APPLIED');

  ok(repair.verifyApply(planA, { applied: 1, planned: 1, failure: null }, { remaining_defects: 4 })
    .includes('defects_remain_after_repair'),
  'an independent readback that still sees defects is a GAPS result');

  if (failures) {
    console.error(`\n${failures} linkage defect repair check(s) failed`);
    process.exit(1);
  }
  console.log('\nLinkage defect repair checks passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
