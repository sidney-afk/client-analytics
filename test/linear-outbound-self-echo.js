'use strict';

// The mirror must not veto its own writes. A SyncView action that carries a
// comment AND a status enqueues two outbox rows; delivering the comment bumps
// issue.updatedAt, and the status row then read that bump as "a human edited
// Linear more recently" and dropped itself. Kasper's 2026-08-18 tweak on
// GRA-6808 was stranded in Linear for 20 hours this way, and the 2026-08-19
// audit found 81 of 81 stale status drops carried a veto clock byte-identical
// to the acknowledged updated_at receipt of an earlier own written outbox row.
//
// The fix: the drainer hands decideConflict the acknowledged issue clocks of
// its own prior written rows for the same issue (context.own_write_clocks).
// An issue clock at or before our own latest acknowledged write is discounted;
// a clock past it — and every per-field webhook clock — still vetoes exactly
// as before. This suite executes the REAL decideConflict on the recorded
// GRA-6808 timeline and mutation-proves each edge of the guard.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const ef = read('supabase/functions/linear-outbound/index.ts');
let failures = 0;

function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

(async () => {
  const mapping = await import(pathToFileURL(path.join(
    ROOT,
    'supabase',
    'functions',
    'linear-outbound',
    'mapping.mjs',
  )).href);

  // The exact GRA-6808 timeline, from mirror_outbox rows 2514/2515 and the
  // recorded conflict receipt: Kasper's status intent at 21:20:04.301, our own
  // comment acknowledged with issue clock 21:20:06.443, the status row then
  // evaluated against that very clock.
  const kasperTweak = {
    operation: 'status',
    actor: 'Kasper Hytonen',
    dedup_key: 'fixture:status:gra-6808',
    source_edited_at: '2026-08-18T21:20:04.301Z',
    payload: { linear_issue_id: 'issue_gra_6808', status: 'tweak' },
  };
  const issueAfterOwnComment = {
    id: 'issue_gra_6808',
    updatedAt: '2026-08-18T21:20:06.443Z',
    title: 'Video 15',
    dueDate: null,
    priority: 0,
    archivedAt: null,
    state: { id: 'state_kasper_approval', name: 'For Kasper approval' },
    assignee: null,
    parent: null,
    comments: { nodes: [] },
  };
  const ownCommentReceipt = ['2026-08-18T21:20:06.443Z'];

  // 1. The historical drop, pinned: with no receipts supplied the guard is the
  // old, stricter one and the write is dropped. This is also the fail-safe
  // path — a receipts read failure hands decideConflict an empty list.
  const withoutReceipts = mapping.decideConflict(kasperTweak, issueAfterOwnComment, {
    state_id: 'state_tweak',
  });
  ok(withoutReceipts.decision === 'stale'
    && withoutReceipts.reason === 'linear_newer_than_syncview_intent',
  'without own-write receipts the newer issue clock still vetoes (fail-safe unchanged)');

  // 2. The fix: the identical evaluation WITH the comment's acknowledged clock
  // applies the status. Exact equality is the proven signature — no epsilon.
  const withReceipts = mapping.decideConflict(kasperTweak, issueAfterOwnComment, {
    state_id: 'state_tweak',
    own_write_clocks: ownCommentReceipt,
  });
  ok(withReceipts.decision === 'apply',
    "an issue clock exactly explained by our own acknowledged write no longer vetoes Kasper's status");

  // 3. A human edit AFTER our last write still wins: issue clock past the
  // newest receipt vetoes even with receipts present.
  const humanAfterUs = mapping.decideConflict(kasperTweak, {
    ...issueAfterOwnComment,
    updatedAt: '2026-08-18T21:20:30.000Z',
  }, {
    state_id: 'state_tweak',
    own_write_clocks: ownCommentReceipt,
  });
  ok(humanAfterUs.decision === 'stale'
    && humanAfterUs.own_mirror_write_updated_at === '2026-08-18T21:20:06.443Z',
  'an issue clock past our last acknowledged write still vetoes, and the receipt lands in the conflict record');

  // 4. Per-field webhook clocks are untouched by the discount: a field clock
  // newer than the intent vetoes regardless of own-write receipts.
  const fieldClockWins = mapping.decideConflict(kasperTweak, issueAfterOwnComment, {
    state_id: 'state_tweak',
    own_write_clocks: ['2026-08-18T21:25:00.000Z'],
    field_updated_at: '2026-08-18T21:20:05.000Z',
  });
  ok(fieldClockWins.decision === 'stale'
    && fieldClockWins.linear_field_updated_at === '2026-08-18T21:20:05.000Z',
  'a per-field webhook clock newer than the intent vetoes even when the issue clock is our own echo');

  // 5. The discount takes the NEWEST receipt: older receipts alone cannot
  // excuse a later issue clock, and garbage receipts are ignored.
  const staleReceiptOnly = mapping.decideConflict(kasperTweak, issueAfterOwnComment, {
    state_id: 'state_tweak',
    own_write_clocks: ['2026-08-18T21:19:00.000Z', 'not-a-clock', ''],
  });
  ok(staleReceiptOnly.decision === 'stale',
    'receipts older than the issue clock do not excuse it, and malformed receipts are ignored');

  // 6. An intent newer than every Linear clock applies with or without
  // receipts — the discount can only ever widen toward SyncView's intent.
  const freshIntent = mapping.decideConflict({
    ...kasperTweak,
    source_edited_at: '2026-08-18T21:21:00.000Z',
  }, issueAfterOwnComment, { state_id: 'state_tweak' });
  ok(freshIntent.decision === 'apply',
    'a SyncView intent newer than every Linear clock still applies unchanged');

  // Drainer wiring: the receipts are read for exactly the clock-guarded
  // operations, exclude the row being evaluated, only trust acknowledged
  // (written) rows for the same issue, and fail safe to no receipts.
  ok(/CLOCK_GUARDED_OPERATIONS = new Set\(\[\s*"status",\s*"due",\s*"assignee",\s*"title",\s*"description",\s*"priority",\s*"parent",\s*"labels",\s*"archive",\s*"restore",\s*\]\)/.test(ef),
    'own-write receipts are scoped to the clock-guarded operation set (no comment/attachment/create reads)');
  ok(/if \(issue && CLOCK_GUARDED_OPERATIONS\.has\(lower\(row\.operation\)\)\) \{\s*context\.own_write_clocks = await ownMirrorWriteClocks\(/.test(ef)
    && ef.indexOf('context.own_write_clocks = await ownMirrorWriteClocks(')
      < ef.indexOf('const conflict = decideConflict(row, issue, context);'),
  'the drainer resolves own-write receipts immediately before the conflict decision');
  const helper = ef.match(/async function ownMirrorWriteClocks\([^]*?\n\}/);
  ok(!!helper
    && /\.eq\("status", "written"\)/.test(helper[0])
    && /\.eq\("linear_result->>issue_id", issueId\)/.test(helper[0])
    && /\.neq\("id", excludeRowId\)/.test(helper[0])
    && /if \(error \|\| !Array\.isArray\(data\)\) return \[\];/.test(helper[0]),
  'receipts come only from acknowledged writes to the same issue, never the row itself, and a read failure yields none');

  if (failures) {
    console.error(`\n${failures} mirror self-echo check(s) failed.`);
    process.exit(1);
  }
  console.log('\nMirror self-echo checks passed.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
