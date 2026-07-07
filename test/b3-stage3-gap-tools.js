'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  normalizeUrl,
  extractIdentifier,
  planLinkageBackfill,
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
ok(linkageSummary.planned_writes === 3, 'linkage planner resolves unique calendar/sample slots');
ok(linkageSummary.by_source_component['calendar:video'] === 2, 'calendar video slots are planned');
ok(linkageSummary.by_source_component['samples:graphic'] === 1, 'sample graphic slot is planned');
ok(linkageSummary.skipped_by_reason.duplicate_live_link === 2, 'duplicate live links are refused instead of linked');
ok(linkageSummary.skipped_by_reason.archive_only === 1, 'archive-only linked cards are explained residue');
ok(linkagePlan.planned.every(p => p.deliverable_column.endsWith('_deliverable_id')), 'planner only writes deliverable linkage columns');

const fixtureRun = spawnSync(process.execPath, [
  path.join(__dirname, '..', 'scripts', 'b3-linkage-backfill.js'),
  '--fixtures=' + path.join(__dirname, 'fixtures', 'b3-linkage-backfill.json'),
], { encoding: 'utf8' });
ok(fixtureRun.status === 0, 'linkage helper runs in dry-run fixture mode');
ok(/"mode": "dry-run"/.test(fixtureRun.stdout) && /"planned_writes": 3/.test(fixtureRun.stdout),
  'linkage helper prints dry-run aggregate summary');

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
