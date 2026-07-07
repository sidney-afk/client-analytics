'use strict';

const fs = require('fs');
const path = require('path');
const {
  mergeCommentCatchupRaw,
  planCommentCatchup,
  summarizePlan,
} = require('../scripts/b3-comment-catchup');

function ok(cond, msg) {
  if (!cond) {
    console.error('FAIL b3-comment-catchup:', msg);
    process.exit(1);
  }
}

const comments = {
  nodes: [{ id: 'c1', body: 'Fixture comment', createdAt: '2026-07-07T00:00:00Z', user: { id: 'u1', name: 'Fixture Editor', email: 'fixture@example.invalid' } }],
  pageInfo: { hasNextPage: false, endCursor: null },
};

const raw = mergeCommentCatchupRaw({ issue: { id: 'lin_issue_1', title: 'Keep me' } }, comments);
ok(raw.issue.title === 'Keep me', 'comment catch-up preserves existing raw issue fields');
ok(raw.issue.comments.nodes[0].id === 'c1', 'comment catch-up writes Linear comments into raw issue');
ok(raw.comment_catchup.source === 'b3_stage4', 'comment catch-up stamps raw provenance');

const plan = planCommentCatchup([
  { id: 'del_1', linear_issue_uuid: 'lin_issue_1', linear_raw: { issue: { id: 'lin_issue_1' } } },
  { id: 'del_2', linear_issue_uuid: 'lin_issue_2', linear_raw: { issue: { comments } } },
  { id: 'del_3', linear_issue_uuid: 'lin_issue_3', status: 'archived', linear_raw: {} },
], new Map([
  ['lin_issue_1', comments],
  ['lin_issue_2', comments],
  ['lin_issue_3', comments],
]));
const summary = summarizePlan(plan, 3);
ok(summary.planned_writes === 1, 'only rows whose raw comments changed are planned');
ok(summary.skipped_by_reason.comments_unchanged === 1, 'unchanged comment raw is skipped');
ok(summary.skipped_by_reason.archived_or_deleted === 1, 'archived deliverables are skipped');
ok(plan.planned[0].row.linear_raw.issue.comments.nodes[0].body === 'Fixture comment', 'planned row contains merged comment raw');

const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'b3-comment-catchup.js'), 'utf8');
ok(/rpc\/\$\{name\}/.test(script) && /deliverable_write/.test(script), 'comment catch-up must write through deliverable_write');
ok(!/from\("deliverables"\)[\s\S]{0,120}\.(insert|update|upsert|delete)\(/.test(script)
  && !/PATCH[\s\S]{0,80}deliverables/.test(script), 'comment catch-up must not directly mutate deliverables');
ok(!/linear-inbound|syncview_runtime_flags/.test(script), 'comment catch-up must not touch flags or inbound config');

console.log('b3-comment-catchup checks passed');
