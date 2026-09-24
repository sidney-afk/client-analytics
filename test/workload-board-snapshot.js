'use strict';
// workload-plan v2 sends only what the board draws: open sub-issues and the
// parents they point at, without the four fields the page never reads.
const assert = require('assert');
(async () => {
  const { boardSnapshot } = await import('../supabase/functions/workload-plan/native-snapshot.mjs');
  const sub = (id, statusType, parent) => ({ id, source: 'native', is_sub_issue: true, status_type: statusType,
    parent_id: parent, native_metadata: { id }, native_assignee_id: 'x', native_sync_state: 'x',
    native_sort_key: 'x', native_kind: 'x' });
  const par = id => ({ id, source: 'native', is_sub_issue: false, status_type: null, parent_id: null });
  const rows = [sub('a', 'started', 'P1'), sub('b', 'backlog', 'P1'), sub('c', 'completed', 'P2'),
    sub('d', 'Canceled', 'P2'), sub('e', 'duplicate', 'P3'), sub('f', 'triage', 'P3'), sub('g', null, null),
    par('P1'), par('P2'), par('P3')];
  const input = { ok: true, complete: true, contract: 'workload-native-snapshot-v2', version: 'v', count: rows.length,
    rows, plans: [{ issue_id: 'c', plan_date: '2026-09-01', client: 'x' }], parents: { P1: 'B-1', P2: 'B-2' } };
  const out = boardSnapshot(input);
  assert.deepStrictEqual(out.rows.map(r => r.id), ['a', 'b', 'g', 'P1']);
  assert.strictEqual(out.count, out.rows.length);
  assert.deepStrictEqual(out.parents, { P1: 'B-1' });
  assert.strictEqual(out.plans.length, 1, 'saved days are never dropped');
  for (const r of out.rows) for (const f of ['native_assignee_id', 'native_sync_state', 'native_sort_key', 'native_kind'])
    assert.ok(!(f in r), f + ' removed');
  assert.deepStrictEqual(out.rows[0].native_metadata, { id: 'a' }, 'metadata kept');
  assert.strictEqual(input.rows.length, 10, 'input not mutated');
  assert.ok('native_kind' in input.rows[0]);
  console.log('workload-board-snapshot: ok');
})().catch(e => { console.error(e); process.exit(1); });
