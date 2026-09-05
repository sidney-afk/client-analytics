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

// Fixed clock so snapshot freshness is deterministic.
const NOW_MS = Date.parse('2026-07-26T12:00:00Z');
const NOW_ISO = new Date(NOW_MS).toISOString();

function card(extra) {
  return Object.assign({
    id: 'cal-1',
    client: 'acme-co',
    linear_issue_id: 'https://linear.app/synchro-social/issue/VID-1/video',
    graphic_linear_issue_id: 'https://linear.app/synchro-social/issue/GRA-1/thumb',
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
    // R15: Class A now requires proven Linear identity equality with the card.
    linear_identifier: 'VID-1',
    linear_issue_url: 'https://linear.app/synchro-social/issue/VID-1/video',
  }, extra || {});
}

function snapshot(cards, deliverables) {
  const doc = {
    contract: repair.SNAPSHOT_CONTRACT,
    cards: { calendar: cards.calendar || [], sxr: cards.sxr || [] },
    deliverables: deliverables || [],
  };
  doc.manifest = repair.buildSnapshotManifest(doc, NOW_ISO);
  return doc;
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
    // R10: a NULL card_id is recorded as NULL, not collapsed to ''. Restoring
    // '' where NULL stood would leave the row in a state it was never in — and
    // one that still satisfies card_id IS NOT NULL in the partial unique index.
    && planA.writes[0].before.card_id === null,
  'Class A stamps origin+card_id onto the unclaimed deliverable and records the before-state');
  ok(repair.planLinkageRepair(snapshot(
    { calendar: [card({ video_deliverable_id: 'dlv-1' })] },
    [deliverable({ card_id: '' })],
  ), { runId: 'r' }).writes[0].before.card_id === '',
  'R10: an empty-string card_id is recorded as empty string, distinct from NULL');
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

  // ------------------------------------------------------------ R15 Class A extra proof
  const planWrongKind = repair.planLinkageRepair(snapshot(
    { calendar: [card({ video_deliverable_id: 'dlv-1' })] },
    [deliverable({ kind: 'other' })],
  ), { runId: 'test-kind' });
  ok(planWrongKind.writes.length === 1
    && !planWrongKind.skipped.some(row => (row.objections || []).includes('kind_does_not_match_the_card_slot')),
  "R15 (revised 2026-09-05, owner ruling): a title-guessed kind no longer refuses a Class A repair when the card and the deliverable name the same Linear issue — identity is the proof, kind is a label; the SQL repair applies the same rule");

  const planNoLinear = repair.planLinkageRepair(snapshot(
    { calendar: [card({ video_deliverable_id: 'dlv-1', linear_issue_id: '' })] },
    [deliverable()],
  ), { runId: 'test-nolinear' });
  ok(planNoLinear.writes.length === 0
    && planNoLinear.skipped.some(row => (row.objections || []).includes('linear_identity_unproven')),
  'R15: Class A refuses when either side names no Linear issue — unproven is not permission');

  const planLinearDisagrees = repair.planLinkageRepair(snapshot(
    { calendar: [card({ video_deliverable_id: 'dlv-1' })] },
    [deliverable({ linear_identifier: 'VID-999', linear_issue_url: '' })],
  ), { runId: 'test-linear' });
  ok(planLinearDisagrees.writes.length === 0
    && planLinearDisagrees.skipped.some(row => (row.objections || []).includes('linear_identity_disagrees')),
  'R15: Class A refuses when the card and deliverable name DIFFERENT Linear issues');

  ok(repair.linearIdentifier('https://linear.app/synchro-social/issue/VID-7/x') === 'VID-7'
    && repair.linearIdentifier('vid-7') === 'VID-7'
    && repair.linearIdentifier('weird text blob') === '',
  'R15: Linear identity parses from URL or bare identifier and returns empty for junk');

  // ------------------------------------------------------------ R14 all-consumer safety
  // A team repair for the commented graphic slot would invalidate a QUIET,
  // currently-valid video slot on another card pointing at the same deliverable.
  const sharedTeamPlan = repair.planLinkageRepair(snapshot(
    {
      calendar: [
        card({
          id: 'cal-a',
          // Both slots name the same deliverable. The graphic slot carries the
          // comments and the team defect; the video slot is comment-free — so
          // it never appears in the defect scan — but is crosswalk-CLEAN today.
          graphic_deliverable_id: 'dlv-shared',
          video_deliverable_id: 'dlv-shared',
          comment_counts: { video: 0, graphic: 2, caption: 0, title: 0 },
        }),
      ],
    },
    [deliverable({
      id: 'dlv-shared', kind: 'thumbnail', team: 'video',
      origin: 'calendar', card_id: 'cal-a',
    })],
  ), { runId: 'test-consumers' });
  ok(sharedTeamPlan.writes.length === 0
    && sharedTeamPlan.skipped.some(row => (row.objections || [])
      .some(objection => objection.startsWith('would_invalidate_consumer'))),
  'R14: a team repair that would invalidate a quiet, comment-free but currently-VALID consumer refuses');

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
    // origin '' is still an acceptable Class A target, so the repair still
    // plans — but the observed target state differs, so the digest must move.
    [deliverable({ origin: '' })],
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

  // ------------------------------------------------------------ R13 input manifest
  const goodSnapshot = snapshot(
    { calendar: [card({ video_deliverable_id: 'dlv-1' })] }, [deliverable()],
  );
  ok(repair.verifySnapshotManifest(goodSnapshot, NOW_MS).length === 0,
    'a well-formed, fresh snapshot passes manifest verification');
  ok(repair.verifySnapshotManifest(
    Object.assign({}, goodSnapshot, { manifest: undefined }), NOW_MS,
  ).includes('snapshot_manifest_required'),
  'a snapshot with no manifest is refused');
  const truncated = JSON.parse(JSON.stringify(goodSnapshot));
  truncated.cards.calendar = [];
  ok(repair.verifySnapshotManifest(truncated, NOW_MS).includes('snapshot_count_mismatch:calendar'),
    'R13: a TRUNCATED export is caught by the row-count check');
  const edited = JSON.parse(JSON.stringify(goodSnapshot));
  edited.deliverables[0].origin = 'calendar';
  ok(repair.verifySnapshotManifest(edited, NOW_MS).includes('snapshot_content_hash_mismatch'),
    'R13: a hand-EDITED export is caught by the content hash');
  ok(repair.verifySnapshotManifest(goodSnapshot, NOW_MS + repair.MAX_SNAPSHOT_AGE_MS + 1000)
    .includes('snapshot_too_old'),
  'R13: a STALE export past the freshness bound is refused');
  ok(repair.verifySnapshotManifest(goodSnapshot, NOW_MS - 3600000)
    .includes('snapshot_generated_in_the_future'),
  'R13: a snapshot stamped in the future is refused');

  // ------------------------------------------------------------ release mechanics
  const writes = [];
  const files = new Map();
  // A CAS-shaped patch layer: returns the single row it claims to have written.
  const patchOk = async write => {
    writes.push(write.deliverable_id);
    return [Object.assign({ id: write.deliverable_id }, write.after)];
  };
  const deps = {
    now: () => NOW_MS,
    existsSync: p => files.has(String(p)),
    readFileSync: () => JSON.stringify(goodSnapshot),
    writeFileSync: (p, body) => files.set(String(p), body),
    patchOne: patchOk,
    readback: async () => ({ remaining_defects: 0, expected_remaining_defects: 0 }),
  };
  const digest = repair.planLinkageRepair(goodSnapshot, { runId: undefined }).apply_digest;

  const dryRun = await repair.run(['--input', 'snap.json'], {}, deps);
  ok(dryRun.status === 'READY' && writes.length === 0,
    'a plan run is source-only: READY without touching the database');

  const staleRun = await repair.run(['--input', 'snap.json'], {}, {
    ...deps, now: () => NOW_MS + repair.MAX_SNAPSHOT_AGE_MS + 1000,
  });
  ok(staleRun.status === 'BLOCKED' && staleRun.reasons.includes('snapshot_too_old'),
    'R13: the runner verifies the manifest BEFORE planning and blocks a stale export');

  let threw = '';
  try {
    await repair.run(['--input', 'snap.json', '--apply'], {}, deps);
  } catch (error) { threw = error.message; }
  ok(threw === 'expected_digest_required_for_apply',
    'R7: apply refuses without a mandatory --expected-digest');

  threw = '';
  try {
    await repair.run(['--input', 'snap.json', '--apply', '--expected-digest', digest], {}, deps);
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

  const applyArgs = [
    '--input', 'snap.json', '--apply',
    '--expected-digest', digest, '--expected-writes', '1',
  ];

  threw = '';
  try {
    await repair.run(applyArgs.concat(['--rollback-artifact', 'r.json']), {}, deps);
  } catch (error) { threw = error.message; }
  ok(threw === 'owner_confirmation_required' && writes.length === 0,
    'apply refuses without the exact owner confirm token');

  const OWNER = { [repair.CONFIRM_ENV]: repair.CONFIRM_TOKEN };

  threw = '';
  try {
    await repair.run(applyArgs, OWNER, deps);
  } catch (error) { threw = error.message; }
  ok(threw === 'rollback_artifact_required_for_apply' && writes.length === 0,
    'apply refuses without a rollback artifact path');

  threw = '';
  try {
    await repair.run(applyArgs.concat(['--rollback-artifact', 'r.json']), OWNER,
      Object.assign({}, deps, { readback: undefined }));
  } catch (error) { threw = error.message; }
  ok(threw === 'readback_layer_required_for_apply' && writes.length === 0,
    'R9: apply refuses without a readback layer — an unverifiable apply never runs');

  const applied = await repair.run(
    applyArgs.concat(['--rollback-artifact', 'r.json']), OWNER, deps,
  );
  ok(applied.status === 'APPLIED' && applied.applied === 1 && writes.length === 1,
    'a confirmed, digest-pinned, count-matched apply writes exactly the planned rows');

  const artifact = JSON.parse(files.get(path.resolve('r.json')));
  ok(artifact.attempted.length === 1
    && JSON.stringify(artifact.attempted[0].restore) === JSON.stringify({ origin: 'manual', card_id: null }),
  'R10: the rollback artifact restores NULL as NULL, not as empty string');
  ok(Array.isArray(artifact.planned) && artifact.planned.length === 1
    && JSON.stringify(artifact.planned[0].before) === JSON.stringify({ origin: 'manual', card_id: null }),
  'R12: the artifact carries planned[] with before-state, which is what crash recovery restores from');

  // R11: never clobber an existing artifact
  threw = '';
  try {
    await repair.run(applyArgs.concat(['--rollback-artifact', 'r.json']), OWNER, deps);
  } catch (error) { threw = error.message; }
  ok(threw === 'rollback_artifact_already_exists',
    'R11: the journal refuses to overwrite an existing artifact path');

  // R12: note BEFORE the patch
  const order = [];
  await repair.run(
    applyArgs.concat(['--rollback-artifact', 'r2.json']), OWNER,
    Object.assign({}, deps, {
      writeFileSync: (p, body) => { order.push('artifact'); files.set(String(p), body); },
      patchOne: async write => { order.push('write'); return [Object.assign({ id: write.deliverable_id }, write.after)]; },
    }),
  );
  ok(order[0] === 'artifact' && order[1] === 'artifact' && order[2] === 'write',
    'R12: the row is journalled BEFORE its PATCH is issued, so a crash cannot lose it');

  // ------------------------------------------------------------ R8/R9 CAS
  const planCas = repair.planLinkageRepair(goodSnapshot, { runId: 'cas' });
  const write0 = planCas.writes[0];
  ok(repair.verifyPatchResult(write0, []) === 'cas_no_row_matched_observed_state',
    'R8: a PATCH that matched no row is a per-row refusal, never treated as applied');
  ok(repair.verifyPatchResult(write0, null) === 'patch_returned_no_representation',
    'R8: a PATCH with no representation body is refused');
  ok(repair.verifyPatchResult(write0, [{}, {}]) === 'cas_matched_multiple_rows',
    'R9: a PATCH that touched more than one row is refused');
  ok(repair.verifyPatchResult(write0, [{ origin: 'calendar', card_id: 'cal-1' }]) === '',
    'R9: exactly one row carrying the exact after-state is the only accepted outcome');
  ok(repair.verifyPatchResult(write0, [{ origin: 'manual', card_id: 'cal-1' }])
    === 'after_state_mismatch:origin',
  'R9: a returned row whose after-state differs is refused');

  const casUrl = repair.casPatchUrl('https://db.test', write0);
  ok(casUrl.includes('id=eq.dlv-1') && casUrl.includes('client_slug=eq.acme-co')
    && casUrl.includes('team=eq.video') && casUrl.includes('kind=eq.video')
    && casUrl.includes('origin=eq.manual') && casUrl.includes('card_id=is.null'),
  'R8: the PATCH filters on ALL five target fields, with a planned NULL card_id as is.null');

  const refused = await repair.applyRepairs(planCas, {
    rollbackArtifact: '',
    writeFileSync: () => {},
    patchOne: async () => [],
  });
  ok(refused.applied === 0 && refused.refusals.length === 1
    && repair.verifyApply(planCas, refused, { remaining_defects: 0, expected_remaining_defects: 0 })
      .some(gap => gap.startsWith('cas_refused')),
  'R8: a drifted row is refused per-row and surfaces as GAPS, never a silent success');

  // ------------------------------------------------------------ R9 readback semantics
  ok(repair.verifyApply(planA, { applied: 1, planned: 1, failure: null, refusals: [] }, null)
    .includes('readback_missing'),
  'R9: an ABSENT readback is a GAP — "could not check" never renders as "checked and fine"');
  ok(repair.verifyApply(planA, { applied: 1, planned: 1, failure: null, refusals: [] },
    { remaining_defects: 2, expected_remaining_defects: 2 }).length === 0,
  'R16: success is remaining defects EQUAL to the unruled Class C residue, not zero');
  ok(repair.verifyApply(planA, { applied: 1, planned: 1, failure: null, refusals: [] },
    { remaining_defects: 0, expected_remaining_defects: 2 })
    .includes('defects_remain_after_repair'),
  'R16: fewer remaining defects than the expected residue is also a GAP');
  ok(repair.verifyApply(planA, { applied: 1, planned: 1, failure: null, refusals: [] },
    { remaining_defects: 4, expected_remaining_defects: 0 })
    .includes('defects_remain_after_repair'),
  'an independent readback that still sees defects is a GAPS result');

  // a mid-run failure still leaves an artifact covering exactly what landed
  const failingPlan = repair.planLinkageRepair(snapshot(
    {
      calendar: [
        card({ id: 'cal-1', video_deliverable_id: 'dlv-1', comment_counts: { video: 1, graphic: 0, caption: 0, title: 0 } }),
        card({
          id: 'cal-2', video_deliverable_id: 'dlv-2',
          linear_issue_id: 'https://linear.app/synchro-social/issue/VID-2/video',
          comment_counts: { video: 1, graphic: 0, caption: 0, title: 0 },
        }),
      ],
    },
    [deliverable(), deliverable({
      id: 'dlv-2', linear_identifier: 'VID-2',
      linear_issue_url: 'https://linear.app/synchro-social/issue/VID-2/video',
    })],
  ), { runId: 'test-fail' });
  ok(failingPlan.writes.length === 2, 'the two-write fixture plans both rows');
  let calls = 0;
  const partial = await repair.applyRepairs(failingPlan, {
    rollbackArtifact: 'partial.json',
    existsSync: () => false,
    writeFileSync: (p, body) => files.set(String(p), body),
    patchOne: async write => {
      calls++;
      if (calls === 2) throw new Error('boom');
      return [Object.assign({ id: write.deliverable_id }, write.after)];
    },
  });
  const partialArtifact = JSON.parse(files.get(path.resolve('partial.json')));
  ok(partial.applied === 1 && partial.failure === 'boom'
    && partialArtifact.attempted.length === 2
    && partialArtifact.planned.length === 2,
  'a mid-run failure leaves an artifact covering every attempted and every planned row');
  ok(repair.verifyApply(failingPlan, partial, { remaining_defects: 0, expected_remaining_defects: 0 })
    .some(gap => gap.startsWith('patch_failed')),
  'a partial apply verifies as GAPS, never APPLIED');

  if (failures) {
    console.error(`\n${failures} linkage defect repair check(s) failed`);
    process.exit(1);
  }
  console.log('\nLinkage defect repair checks passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
