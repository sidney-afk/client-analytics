#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { plan, run } = require('../scripts/review-note-backfill.js');

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
  console.log('review-note-backfill checks passed');
})().catch(e => { console.error(e); process.exit(1); });
