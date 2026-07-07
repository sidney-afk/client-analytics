'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  classifyDeliverable,
  linkageGaps,
  summarize,
  summarizeWebhooks,
} = require('../scripts/linear-deliverables-reconcile-lib');

function ok(cond, msg) {
  if (!cond) {
    console.error('FAIL linear-deliverables-reconcile:', msg);
    process.exit(1);
  }
}

const member = { id: '00000000-0000-0000-0000-000000000001', name: 'Fixture Editor', linear_user_id: 'lin_user_known' };
const memberById = new Map([[member.id, member]]);
const memberByLinearId = new Map([[member.linear_user_id, member]]);
const baseIssue = {
  id: 'lin_issue_1',
  identifier: 'VID-TST',
  title: 'Fixture title',
  dueDate: '2026-07-09',
  priority: 2,
  state: { id: 'state_progress', name: 'In Progress', type: 'started' },
  assignee: { id: 'lin_user_known', name: 'Fixture Editor' },
  parent: { id: 'lin_parent' },
  comments: { nodes: [{ id: 'lin_comment_1' }] },
};
const baseDeliverable = {
  id: 'del_fixture',
  identifier: 'VID-TST',
  team: 'video',
  kind: 'video',
  title: 'Fixture title',
  status: 'in_progress',
  due_date: '2026-07-09',
  priority: 2,
  assignee_id: member.id,
  origin: 'calendar',
  linear_issue_uuid: 'lin_issue_1',
  linear_raw: JSON.stringify({ issue: { parent: { id: 'lin_parent' } } }),
};

function classify(deliverablePatch, issuePatch, extra = {}) {
  return classifyDeliverable({
    deliverable: Object.assign({}, baseDeliverable, deliverablePatch || {}),
    linearIssue: Object.assign({}, baseIssue, issuePatch || {}),
    events: extra.events || [{ action: 'mirror_in_comment_add', payload: { linear_comment_id: 'lin_comment_1' } }],
    memberById,
    memberByLinearId,
    stateUuidMap: { state_progress: 'in_progress', state_scheduled: 'scheduled' },
    authority: extra.authority || 'linear',
  });
}

let r = classify();
ok(r.diffs.length === 0, 'matching row has no real diffs');
ok(r.tolerated.length === 0, 'matching row has no tolerated diffs');
ok(r.repairs.length === 0, 'matching row has no repairs');

r = classify({ origin: 'samples', status: 'approved' }, { state: { id: 'state_scheduled', name: 'Scheduled' } });
ok(r.diffs.length === 0, 'sample scheduled state is not a real diff');
ok(r.tolerated.some(t => t.reason === 'clamped_sample_state'), 'sample scheduled state is tolerated as clamped');

r = classify({ due_date: '2026-07-07' });
ok(r.diffs.length === 0, 'two-day due-date churn is not a real diff');
ok(r.tolerated.some(t => t.reason === 'due_date_roller_or_plus_2d_churn'), 'two-day due-date churn is tolerated');

r = classify({ status: 'approved', linear_raw: JSON.stringify({ refused_stale_regress: true, issue: { parent: { id: 'lin_parent' } } }) });
ok(r.diffs.length === 0, 'refused stale Linear regress is not a real diff');
ok(r.tolerated.some(t => t.reason === 'refused_stale_regress'), 'refused stale Linear regress is counted as tolerated');

r = classify({}, { state: { id: 'state_unknown', name: 'Mystery' } }, { events: [] });
ok(r.diffs.some(d => d.reason === 'unmapped_state'), 'unmapped state without raw refusal is a real diff');

r = classify({ linear_raw: JSON.stringify({ unmapped_state: { id: 'state_unknown' }, issue: { parent: { id: 'lin_parent' } } }) }, { state: { id: 'state_unknown', name: 'Mystery' } }, { events: [] });
ok(r.diffs.length === 0, 'previously refused unmapped state is tolerated');
ok(r.tolerated.some(t => t.reason === 'unmapped_state_refused'), 'unmapped-state refusal is tracked as tolerated');

r = classify({}, { assignee: { id: 'lin_user_ghost', name: 'Ghost User' } });
ok(r.diffs.length === 0, 'unknown assignee does not count as real diff');
ok(r.repairs.some(p => p.reason === 'unknown_assignee'), 'unknown assignee lands on repair list');

r = classify({ title: 'Old title' });
ok(r.diffs.some(d => d.field === 'title'), 'title mismatch is a real diff');

r = classify({}, { parent: { id: 'different_parent' } });
ok(r.diffs.some(d => d.field === 'parent'), 'parent mismatch is a real diff');

r = classify({}, { archivedAt: '2026-07-07T00:00:00Z' });
ok(r.diffs.some(d => d.field === 'archived_deleted'), 'Linear archive marker is surfaced as a real diff');

r = classify({}, { comments: { nodes: [] } });
ok(r.diffs.some(d => d.reason === 'engine_comment_missing_in_linear'), 'missing engine-tracked comment id is a real diff');

const gaps = linkageGaps({
  calendarPosts: [{ id: 'card_fixture', client: 'fixture-client', status: 'active', linear_issue_id: 'https://linear.example/VID-TST', video_deliverable_id: '' }],
  sampleReviews: [{ id: 'sample_fixture', client: 'fixture-client', status: 'active', graphic_linear_issue_id: 'https://linear.example/GRA-TST', graphic_deliverable_id: '' }],
});
ok(gaps.length === 2, 'linkage lane counts linked cards missing deliverable ids');
ok(gaps.some(g => g.source === 'calendar' && g.component === 'video'), 'calendar video linkage gap classified');
ok(gaps.some(g => g.source === 'samples' && g.component === 'graphic'), 'samples graphic linkage gap classified');

const s = summarize([classify({ title: 'Old title' }), classify({ due_date: '2026-07-07' }), classify({}, { assignee: { id: 'lin_user_ghost' } })], gaps);
ok(s.diff_count === 1, 'summary separates real diff count');
ok(s.tolerated_count === 1, 'summary separates tolerated count');
ok(s.repair_list_size === 1, 'summary separates repair-list size');
ok(s.linkage_count === 2, 'summary includes linkage count');

const wh = summarizeWebhooks([
  { enabled: true, resourceTypes: ['Issue', 'Comment'], team: { key: 'VID' } },
  { enabled: false, resourceTypes: ['Issue'], team: { key: 'GRA' } },
]);
ok(wh.checked === 2, 'webhook probe checks VID/GRA webhooks');
ok(wh.disabled === 1, 'webhook probe counts disabled webhooks');
ok(wh.missing_comment_resource === 1, 'webhook probe counts missing Comments resource');

const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'linear-deliverables-reconcile.js'), 'utf8');
ok(/rpc\/\$\{name\}/.test(script) && /deliverable_write/.test(script), 'healing path must call the deliverable_write RPC');
ok(!/from\("deliverables"\)\.update|from\('deliverables'\)\.update|PATCH[\s\S]{0,80}deliverables/.test(script), 'reconciler must not directly update deliverables');
ok(/source: 'reconcile'/.test(script), 'summary/healing events must use source=reconcile');
ok(/webhooks\(first: 100\)/.test(script) && /missing_comment_resource/.test(script),
  'reconciler must include Linear webhook enabled/resource probe');

const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'linear-deliverables-reconcile.yml'), 'utf8');
ok(/default: false/.test(workflow) && /APPLY:/.test(workflow), 'workflow apply default must be false');
ok(/Missing SUPABASE_SERVICE_ROLE_KEY or LINEAR_API_KEY/.test(workflow), 'workflow must fail loudly on missing secrets');

const fixtureRun = spawnSync(process.execPath, [
  path.join(__dirname, '..', 'scripts', 'linear-deliverables-reconcile.js'),
  '--fixtures=' + path.join(__dirname, 'fixtures', 'linear-deliverables-reconcile.json'),
], { encoding: 'utf8' });
ok(fixtureRun.status === 0, 'reconciler script must run in CI-safe dry-run fixture mode');
ok(/Mode: dry-run/.test(fixtureRun.stdout) && /Deliverables checked \| 1/.test(fixtureRun.stdout),
  'fixture dry-run must produce a summary without live secrets');
ok(/Linear webhooks disabled \| 0/.test(fixtureRun.stdout), 'fixture dry-run must include webhook probe metrics');

console.log('linear-deliverables-reconcile checks passed');
