#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { plan, run, rollbackVerdict, findOrphans } = require('../scripts/review-note-backfill.js');

const note = (id, body, at, extra) => Object.assign({ id, body, role: 'client', author: 'A', audience: 'client', parent_id: null, created_at: at, is_tweak: false }, extra);
const cards = [
  { id: 'p_1', client: 'slugx', client_slug: 'slugx', video_deliverable_id: 'del_1', graphic_deliverable_id: '',
    video_tweaks: JSON.stringify([
      note('c_orphan', 'only in the card', '2026-10-19T19:08:37Z'),
      note('c_old', 'same words', '2026-10-19T19:08:00Z'),
      note('c_in', 'already there', '2026-10-19T10:00:00Z'),
      note('c_amb', 'twice', '2026-10-19T12:00:00Z'),
      note('c_reply', 'a reply', '2026-10-19T13:00:00Z', { parent_id: 'c_in' }),
      note('c_before', 'too old', '2026-09-01T00:00:00Z'),
      { id: 'c_staff', role: 'admin', body: 'staff', created_at: '2026-10-19T14:00:00Z' }
    ]) },
  { id: 'p_2', client: 'slugx', client_slug: 'slugx', video_deliverable_id: '', video_tweaks: JSON.stringify([note('c_nolink', 'x', '2026-10-19T19:00:00Z')]) }
];
const deliverables = [{ id: 'del_1', client_slug: 'slugx', team: 'video', origin: 'calendar', card_id: 'p_1' }];
const mk = (id, body, at, extra) => Object.assign({ id, native_comment_id: id, deliverable_id: 'del_1', parent_id: null, body, role: 'client', audience: 'client', component: 'video', source_created_at: at }, extra);
const canonical = new Map([['del_1', [
  mk('pc_twin', 'same words', '2026-10-19T19:12:07Z'),
  mk('pc_c_in', 'already there', '2026-10-19T10:00:00Z', { native_comment_id: 'c_in' }),
  mk('pc_a1', 'twice', '2026-10-19T12:01:00Z'), mk('pc_a2', 'twice', '2026-10-19T12:02:00Z')
]]]);

const r = plan({ cards, deliverables, canonicalByDeliverable: canonical, since: '2026-10-01', importRunId: 't' });
assert.deepStrictEqual(r.counts, { notes_seen: 4, already_in_production: 1, has_twin: 1, ambiguous_twin: 1, orphan: 1 }, JSON.stringify(r.counts));
assert.strictEqual(r.planned.imports.length, 1);
const imp = r.planned.imports[0];
assert.strictEqual(imp.link.card_id, 'p_1');
assert.strictEqual(imp.link.native_comment_id, 'c_orphan');
assert.strictEqual(imp.comment.role, 'client');
assert.strictEqual(imp.comment.audience, 'client');
assert.strictEqual(imp.comment.component, 'video');
assert.strictEqual(imp.comment.author_name, 'A');
assert.strictEqual(imp.comment.source_created_at, '2026-10-19T19:08:37Z');
assert.strictEqual(r.planned.conflicts.length, 0);

// graphics-only card (no video column) is scanned
const gfx = { id: 'p_3', client: 'slugx', client_slug: 'slugx', video_deliverable_id: '', graphic_deliverable_id: 'del_3', video_tweaks: null, graphic_tweaks: JSON.stringify([note('c_g', 'thumb note', '2026-10-19T19:00:00Z')]) };
const g = findOrphans({ cards: [gfx], canonicalByDeliverable: new Map(), since: '2026-10-01' });
assert.strictEqual(g.counts.orphan, 1, 'graphics-only row is read');
// malformed column is reported, never treated as empty
const bad = findOrphans({ cards: [{ id: 'p_bad', video_deliverable_id: 'del_1', video_tweaks: '[not json', graphic_tweaks: '{"a":1}', graphic_deliverable_id: 'del_1' }], canonicalByDeliverable: new Map(), since: '2026-10-01' });
assert.deepStrictEqual(bad.malformed.map(m => m.part).sort(), ['graphic', 'video']);
// exclude
assert.strictEqual(findOrphans({ cards: [gfx], canonicalByDeliverable: new Map(), exclude: ['p_3'] }).counts.orphan, 0);
// rollback verdict
const v = rollbackVerdict([{ id: 'a', version: 1 }, { id: 'b', version: 2 }, { id: 'c', version: 1, resolved_at: 'x' }, { id: 'd', version: 1 }], ['d']);
assert.strictEqual(v.deletable, 1);
assert.deepStrictEqual(v.refused.map(x => x.id), ['b', 'c', 'd']);

(async () => {
  const lines = []; let writes = 0;
  const deps = { cards, deliverables, canonical: [...canonical.values()][0], out: s => lines.push(s), importOne: async () => { writes++; } };
  const env = { SUPABASE_URL: 'https://x.invalid', SUPABASE_SERVICE_ROLE_KEY: 'k' };
  await run([], env, deps);
  assert.strictEqual(writes, 0, 'dry run writes nothing');
  assert.ok(lines.includes('card p_1: 1') && lines.some(l => l === 'mode: dry run (nothing written)'));
  assert.ok(!lines.join('\n').includes('only in the card'), 'no note text printed');
  await assert.rejects(run(['--apply'], env, deps), /F42_CONFIRM_CARD_COMMENT_IMPORT/);
  await run(['--apply'], Object.assign({ F42_CONFIRM_CARD_COMMENT_IMPORT: 'IMPORT_CARD_COMMENTS' }, env), deps);
  assert.strictEqual(writes, 1, 'apply writes the one orphan');
  // malformed blocks apply
  await assert.rejects(run(['--apply'], Object.assign({ F42_CONFIRM_CARD_COMMENT_IMPORT: 'IMPORT_CARD_COMMENTS' }, env),
    Object.assign({}, deps, { cards: cards.concat([{ id: 'p_bad', video_tweaks: '[oops' }]), importOne: async () => { writes += 100; } })), /malformed/);
  assert.ok(writes < 100, 'nothing written when a column is malformed');
  await run(['--exclude-card', 'p_bad'], env, Object.assign({}, deps, { cards: cards.concat([{ id: 'p_bad', video_tweaks: '[oops' }]) }));
  // rollback: dry run, refusal, apply
  const rb = []; const gone = [];
  const rdeps = { out: s => rb.push(s), runRows: [{ id: 'x1', version: 1 }, { id: 'x2', version: 1 }], replyParents: [], deleteOne: async id => { gone.push(id); } };
  await run(['--rollback', 'review-note-backfill-2026-10-01'], env, rdeps);
  assert.strictEqual(gone.length, 0, 'rollback dry run deletes nothing');
  await assert.rejects(run(['--rollback', 'review-note-backfill-2026-10-01', '--apply'], env, rdeps), /F42_CONFIRM/);
  await assert.rejects(run(['--rollback', 'other-run'], env, rdeps), /run id/);
  await assert.rejects(run(['--rollback', 'review-note-backfill-2026-10-01', '--apply'], Object.assign({ F42_CONFIRM_CARD_COMMENT_IMPORT: 'IMPORT_CARD_COMMENTS' }, env), Object.assign({}, rdeps, { replyParents: ['x2'] })), /refused/);
  assert.strictEqual(gone.length, 0, 'one refusal deletes nothing');
  await run(['--rollback', 'review-note-backfill-2026-10-01', '--apply'], Object.assign({ F42_CONFIRM_CARD_COMMENT_IMPORT: 'IMPORT_CARD_COMMENTS' }, env), rdeps);
  assert.deepStrictEqual(gone, ['x1', 'x2']);
  console.log('review-note-backfill checks passed');
})().catch(e => { console.error(e); process.exit(1); });
