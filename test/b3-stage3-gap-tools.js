'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  normalizeUrl,
  extractIdentifier,
  planLinkageBackfill,
  planArchivePromotions,
  strictActiveCalendarSweep,
  strictSweepsForPlan,
  summarizePlan,
} = require('../scripts/b3-linkage-backfill');
const {
  normName,
  planAssigneeRepairs,
  summarizeRepairPlan,
} = require('../scripts/b3-assignee-repair');

function ok(cond, msg) {
  if (!cond) {
    console.error('FAIL b3-stage3-gap-tools:', msg);
    process.exit(1);
  }
}

ok(normalizeUrl('https://linear.app/synchro/issue/VID-1/name?x=1#frag') === 'https://linear.app/synchro/issue/VID-1/name',
  'URL normalization strips query/hash without changing the issue path');
ok(extractIdentifier('https://linear.app/synchro/issue/gra-42/title') === 'GRA-42',
  'identifier extraction is case-normalized');
ok(normName('Rocio  Alvarez') === 'rocio alvarez', 'assignee name matching normalizes spacing/case');

const linkageFixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'b3-linkage-backfill.json'), 'utf8'));
const linkagePlan = planLinkageBackfill(linkageFixture);
const linkageSummary = summarizePlan(linkagePlan);
ok(linkageSummary.planned_writes === 2, 'linkage planner resolves only exact calendar URLs plus the sample slot');
ok(linkageSummary.by_source_component['calendar:video'] === 1, 'calendar planner rejects identifier-only fallback');
ok(linkageSummary.by_source_component['samples:graphic'] === 1, 'sample graphic slot is planned');
ok(linkageSummary.skipped_by_reason.duplicate_live_link === 2, 'duplicate live links are refused instead of linked');
ok(linkageSummary.skipped_by_reason.archive_only === 2, 'archive-only paired links are explained residue');
ok(linkageSummary.skipped_by_reason.unresolved_deliverable === 1,
  'calendar identifier-only link is unresolved instead of alias/identifier matched');
ok(linkagePlan.planned.every(p => p.deliverable_column.endsWith('_deliverable_id')), 'planner only writes deliverable linkage columns');

const promotionPlan = planArchivePromotions(linkageFixture);
ok(promotionPlan.batches.length === 1, 'archive promotion plans one deterministic missing batch');
ok(promotionPlan.deliverables.length === 2, 'archive promotion plans both paired mirror deliverables');
ok(promotionPlan.linkages.length === 2, 'archive promotion plans both paired card linkages');
ok(promotionPlan.batches[0].linear_parent_ids.video.uuid === 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  && promotionPlan.batches[0].linear_parent_ids.graphics.uuid === 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'paired archive promotions retain both team parent IDs on the shared B1 batch');
ok(promotionPlan.batches[0].team === null,
  'paired VID+GRA promotion keeps the shared B1 batch mixed instead of falsely team-locking it');
ok(promotionPlan.deliverables[0].id === 'b1_d_55555555555555555555555555555555',
  'archive promotion reuses the deterministic B1 deliverable id');
ok(promotionPlan.deliverables[0].origin === 'calendar' && promotionPlan.deliverables[0].card_id === 'card_archive',
  'promoted mirror preserves the exact active calendar slot');
ok(promotionPlan.skipped.some(row => row.reason === 'duplicate_live_link'),
  'archive promotion refuses duplicate live slots');

const existingBatchFixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures', 'b3-linkage-backfill-existing-batch.json'), 'utf8'));
const existingBatchPromotion = planArchivePromotions(existingBatchFixture);
ok(existingBatchPromotion.batches.length === 1,
  'opposite-team promotion schedules one update for the existing deterministic B1 batch');
ok(existingBatchPromotion.deliverables.length === 1 && existingBatchPromotion.linkages.length === 1,
  'existing-batch promotion still plans the missing graphics child and card linkage');
ok(existingBatchPromotion.batches[0].linear_parent_ids.video.uuid === 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  && existingBatchPromotion.batches[0].linear_parent_ids.graphics.uuid === 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'existing video-only batch keeps its VID parent while adding the promoted GRA parent');
ok(existingBatchPromotion.batches[0].team === null,
  'existing video-only batch is neutralized to mixed team when the graphics parent is added');
ok(existingBatchPromotion.batches[0].created_by === 'linear-backfill',
  'existing compatible batch provenance is preserved during the routing merge');

const alreadyMergedFixture = JSON.parse(JSON.stringify(existingBatchFixture));
alreadyMergedFixture.batches[0] = JSON.parse(JSON.stringify(existingBatchPromotion.batches[0]));
ok(planArchivePromotions(alreadyMergedFixture).batches.length === 0,
  'already-merged existing batch does not enqueue a redundant batch write');

const conflictingBatchFixture = JSON.parse(JSON.stringify(existingBatchFixture));
conflictingBatchFixture.batches[0].name = 'Different deterministic batch identity';
const conflictingBatchPromotion = planArchivePromotions(conflictingBatchFixture);
ok(conflictingBatchPromotion.batches.length === 0
  && conflictingBatchPromotion.deliverables.length === 0
  && conflictingBatchPromotion.skipped.some(row => row.reason === 'batch_identity_conflict'),
  'existing deterministic batch identity conflicts fail closed before child promotion');

const canceledFixture = JSON.parse(JSON.stringify(linkageFixture));
canceledFixture.calendarPosts.find(row => row.id === 'card_archive').status = 'Canceled';
ok(planArchivePromotions(canceledFixture).deliverables.length === 0,
  'archive promotion excludes canceled cards');

const strictFailureFixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures', 'b3-linkage-strict-failures.json'), 'utf8'));
const strictFailures = strictActiveCalendarSweep(strictFailureFixture);
ok(strictFailures.checked === 3 && strictFailures.failures.length === 3,
  'strict active-card sweep records every unresolved or ambiguous fixture slot');
ok(strictFailures.failures.some(row => row.card_id === 'strict_dangling_id' && row.reason === 'dangling_deliverable_id'),
  'nonempty dangling deliverable ID fails without exact-URL fallback');
ok(strictFailures.failures.some(row => row.card_id === 'strict_same_identifier_wrong_url' && row.reason === 'unresolved_exact_url'),
  'same Linear identifier with a different canonical URL does not resolve');
ok(strictFailures.failures.some(row => row.card_id === 'strict_ambiguous_exact_url'
  && row.reason === 'ambiguous_exact_url' && row.candidate_count === 2),
  'multiple in-scope canonical URL matches are recorded as ambiguous');

const strictCleanFixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures', 'b3-linkage-strict-clean.json'), 'utf8'));
const strictClean = strictActiveCalendarSweep(strictCleanFixture);
ok(strictClean.checked === 2 && strictClean.resolved_by_id === 1
  && strictClean.resolved_by_exact_url === 1 && strictClean.failures.length === 0,
  'strict clean fixture reaches zero by ID-first plus one normalized exact-URL resolution');
const wrongIdFixture = JSON.parse(JSON.stringify(strictCleanFixture));
wrongIdFixture.calendarPosts[0].video_deliverable_id = 'clean-graphic-url';
const wrongIdSweep = strictActiveCalendarSweep(wrongIdFixture);
ok(wrongIdSweep.failures.length === 1 && wrongIdSweep.failures[0].reason === 'wrong_deliverable_id',
  'wrong nonempty ID fails in scope and never falls back to the card exact URL');
ok(strictSweepsForPlan(strictCleanFixture, planLinkageBackfill(strictCleanFixture), null).projected.failures.length === 0,
  'strict projected sweep also reaches the clean zero gate');

const linkageScript = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'b3-linkage-backfill.js'), 'utf8');
ok(/sweeps\.projected\.failures\.length/.test(linkageScript)
  && /Strict active-card precondition failed/.test(linkageScript),
  'apply precondition requires a full projected strict active-card zero');
ok(/const strictSweep = strictActiveCalendarSweep\(live\)/.test(linkageScript)
  && /strictSweep\.failures\.length/.test(linkageScript),
  'post-apply verification requires a fresh full strict active-card zero');
ok(/strict_sweeps: strictSweeps/.test(linkageScript),
  'private details output records every strict current/projected failure row');

const fixtureRun = spawnSync(process.execPath, [
  path.join(__dirname, '..', 'scripts', 'b3-linkage-backfill.js'),
  '--fixtures=' + path.join(__dirname, 'fixtures', 'b3-linkage-backfill.json'),
], { encoding: 'utf8' });
ok(fixtureRun.status === 0, 'linkage helper runs in dry-run fixture mode');
ok(/"mode": "dry-run"/.test(fixtureRun.stdout) && /"planned_writes": 2/.test(fixtureRun.stdout),
  'linkage helper prints dry-run aggregate summary');

const promotionFixtureRun = spawnSync(process.execPath, [
  path.join(__dirname, '..', 'scripts', 'b3-linkage-backfill.js'),
  '--promote-archive',
  '--fixtures=' + path.join(__dirname, 'fixtures', 'b3-linkage-backfill.json'),
], { encoding: 'utf8' });
ok(promotionFixtureRun.status === 0, 'archive promotion helper runs in default dry-run fixture mode');
ok(/"archive_promotion": true/.test(promotionFixtureRun.stdout) && /"deliverable_writes": 2/.test(promotionFixtureRun.stdout),
  'archive promotion helper reports only its guarded planned writes');

const memberId = '00000000-0000-0000-0000-0000000000aa';
const repairData = {
  deliverables: [
    {
      id: 'del_known',
      identifier: 'VID-1',
      team: 'video',
      kind: 'video',
      title: 'Known',
      status: 'in_progress',
      due_date: '',
      priority: null,
      assignee_id: '',
      origin: 'calendar',
      linear_issue_uuid: 'lin_known',
      linear_raw: '{}',
    },
    {
      id: 'del_ghost',
      identifier: 'GRA-1',
      team: 'graphics',
      kind: 'thumbnail',
      title: 'Ghost',
      status: 'in_progress',
      due_date: '',
      priority: null,
      assignee_id: '',
      origin: 'calendar',
      linear_issue_uuid: 'lin_ghost',
      linear_raw: '{}',
    },
  ],
  members: [
    { id: memberId, name: 'Known Editor', email: '', linear_user_id: '', team: 'video', role: 'editor', active: true },
  ],
  events: [],
  calendarPosts: [],
  sampleReviews: [],
  prodAuthority: { video: 'linear', graphics: 'linear' },
  linearIssues: new Map([
    ['lin_known', {
      id: 'lin_known',
      title: 'Known',
      dueDate: '',
      priority: null,
      state: { id: 'state_known', name: 'In Progress' },
      assignee: { id: 'lin_user_known', name: 'Known Editor', email: 'known@example.invalid' },
      team: { key: 'VID' },
      comments: { nodes: [] },
    }],
    ['lin_ghost', {
      id: 'lin_ghost',
      title: 'Ghost',
      dueDate: '',
      priority: null,
      state: { id: 'state_known', name: 'In Progress' },
      assignee: { id: 'lin_user_ghost', name: 'Departed Person', email: 'ghost@example.invalid' },
      team: { key: 'GRA' },
      comments: { nodes: [] },
    }],
  ]),
  webhooks: [],
};
const repairPlan = planAssigneeRepairs(repairData);
const repairSummary = summarizeRepairPlan(repairPlan);
ok(repairSummary.repair_rows === 2, 'repair planner sees both unknown-assignee rows');
ok(repairSummary.distinct_users === 2, 'repair planner counts distinct unknown Linear users');
ok(repairSummary.planned_updates === 1, 'repair planner maps one real member');
ok(repairSummary.planned_inserts === 1, 'repair planner creates inactive attribution rows when no member matches');
ok(repairSummary.skipped === 0, 'repair planner has no unresolved users in the fixture');
ok(repairPlan.planned[0].patch.linear_user_id === 'lin_user_known', 'repair patch null-fills linear_user_id');
ok(repairPlan.planned[0].patch.email === 'known@example.invalid', 'repair patch fills email only when blank');
ok(repairPlan.inserts[0].active === false && repairPlan.inserts[0].role === 'editor', 'inserted attribution rows are inactive editors');

const repairScript = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'b3-assignee-repair.js'), 'utf8');
ok(/team_members\?id=eq/.test(repairScript) && /method: 'PATCH'/.test(repairScript),
  'assignee repair writes only targeted team_members PATCHes');
ok(!/from\("deliverables"\)\.update|PATCH[\s\S]{0,80}deliverables/.test(repairScript),
  'assignee repair must not update deliverables directly');

console.log('b3-stage3-gap-tools checks passed');
