'use strict';
/*
 * caption-history-logic.js -- the pure parts of the caption history (session Versions, 2026-10-23):
 *   supabase/functions/calendar-card-write/logic.mjs  captionOriginHeader  (how a save changed the caption)
 *   supabase/functions/caption-generate/history.mjs   labelling, burst grouping, the index, id parsing
 * Synthetic data only.
 */
const assert = require('assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const imp = rel => import(pathToFileURL(path.join(ROOT, rel)).href);
const decode = h => JSON.parse(Buffer.from(h, 'base64').toString('utf8'));

(async () => {
  const logic = await imp('supabase/functions/calendar-card-write/logic.mjs');
  const h = await imp('supabase/functions/caption-generate/history.mjs');
  const actor = { actor: 'QA Staff', role: 'smm', source: 'ui' };

  // ---- captionOriginHeader ----
  assert.equal(logic.CAPTION_ORIGIN_HEADER, 'x-syncview-caption-origin');
  assert.equal(logic.captionOriginHeader({ post: { id: 'p1', status: 'x' } }, actor), '', 'no caption in the save: no header');
  assert.equal(logic.captionOriginHeader({}, actor), '');
  assert.deepEqual(decode(logic.captionOriginHeader({ post: { id: 'p1', caption: 'a' } }, actor)), { k: 'typed', a: 'QA Staff', r: 'smm' });
  assert.deepEqual(decode(logic.captionOriginHeader({ post: { caption_alt: '' } }, {})), { k: 'typed' }, 'an emptied second caption counts');
  assert.deepEqual(decode(logic.captionOriginHeader({ post: { caption: 'a' }, caption_origin: { kind: 'redo', note: '  shorter, café première ligne  ' } }, actor)),
    { k: 'redo', n: 'shorter, café première ligne', a: 'QA Staff', r: 'smm' }, 'a note in any language survives');
  assert.equal(decode(logic.captionOriginHeader({ post: { caption: 'a' }, caption_origin: { kind: 'redo', note: 'x'.repeat(900) } }, actor)).n.length, 500);
  assert.deepEqual(decode(logic.captionOriginHeader({ post: { caption: 'a' }, caption_origin: { kind: 'restored', from: 42, note: 'no' } }, {})), { k: 'restored', f: '42' });
  assert.deepEqual(decode(logic.captionOriginHeader({ post: { caption: 'a' }, caption_origin: { kind: 'restored', from: '4; drop' } }, {})), { k: 'restored' }, 'a bad id is dropped');
  assert.deepEqual(decode(logic.captionOriginHeader({ post: { caption: 'a' }, caption_origin: { kind: 'generated' } }, {})), { k: 'typed' }, 'the page cannot claim other kinds');
  assert.deepEqual(decode(logic.captionOriginHeader({ post: { caption: 'a' }, caption_origin: ['redo'] }, {})), { k: 'typed' });
  assert(/^[A-Za-z0-9+/=]+$/.test(logic.captionOriginHeader({ post: { caption: 'a' }, caption_origin: { kind: 'redo', note: '✨ emoji\nnew line' } }, actor)), 'header-safe');
  assert.equal(logic.captionOriginHeader({ post: { caption: 'a' } }, { actor: 'x'.repeat(300), role: 'r'.repeat(80) }).length > 0, true);

  // ---- labelRows / groupVersions ----
  const t = m => new Date(Date.UTC(2026, 9, 20, 10, 0, 0) + m * 60000).toISOString();
  const rows = [
    { id: 1, kind: 'generated', text: 'G', created_at: t(0) },
    { id: 2, kind: 'redo', text: 'R', note: 'shorter', created_at: t(4) },
    { id: 3, kind: 'typed', text: 'R1', actor: 'Alex', created_at: t(60) },
    { id: 4, kind: 'typed', text: 'R12', actor: 'Alex', created_at: t(60.1) },
    { id: 5, kind: 'typed', text: 'R123', actor: 'Alex', created_at: t(62) },
    { id: 6, kind: 'typed', text: 'R1234', actor: 'Sam', created_at: t(63) },
    { id: 7, kind: 'saved', text: 'C', created_at: t(200) },
    { id: 8, kind: 'restored', text: 'R', restored_from: 2, actor: 'Alex', note: 'x', created_at: t(300) },
  ];
  const lab = h.labelRows(rows.slice().reverse(), [t(201)]);
  assert.deepEqual(lab.map(r => r.id), [1, 2, 3, 4, 5, 6, 7, 8], 'oldest first whatever order they came in');
  assert.equal(lab[6].kind, 'client', 'a saved write near the client\'s own caption note is a client edit');
  assert.equal(lab[6].actor, 'Client');
  assert.equal(lab[1].note, 'shorter');
  assert.equal(lab[7].note, null, 'only a redo shows a note');
  assert.equal(lab[7].from, 2);
  assert.equal(h.labelRows([{ id: 1, kind: 'saved', text: 'x', created_at: t(0) }], [t(10)])[0].kind, 'saved', 'a note ten minutes away is another moment');
  const g = h.groupVersions(lab);
  assert.deepEqual(g.map(v => [v.kind, v.text, v.actor || '']), [
    ['generated', 'G', ''], ['redo', 'R', ''], ['typed', 'R123', 'Alex'], ['typed', 'R1234', 'Sam'], ['client', 'C', 'Client'], ['restored', 'R', 'Alex'],
  ], 'one version per burst; another person starts a new one');
  assert.equal(g[2].id, 5, 'a burst is the row whose text it shows');
  assert.equal(g[2].at, t(62));
  // A burst split by five minutes or more is two versions.
  const split = h.groupVersions(h.labelRows([
    { id: 1, kind: 'typed', text: 'a', actor: 'A', created_at: t(0) },
    { id: 2, kind: 'typed', text: 'ab', actor: 'A', created_at: t(5) },
  ], []));
  assert.equal(split.length, 2);
  // Generates and redos never merge, even seconds apart.
  assert.equal(h.groupVersions(h.labelRows([
    { id: 1, kind: 'redo', text: 'a', created_at: t(0) }, { id: 2, kind: 'redo', text: 'b', created_at: t(0.1) },
  ], [])).length, 2);
  // Typed back to what it was: no change, left out. A restore to the same text is still shown.
  assert.deepEqual(h.groupVersions(h.labelRows([
    { id: 1, kind: 'generated', text: 'same', created_at: t(0) },
    { id: 2, kind: 'typed', text: 'same', actor: 'A', created_at: t(30) },
    { id: 3, kind: 'restored', text: 'same', actor: 'A', created_at: t(40) },
  ], [])).map(v => v.kind), ['generated', 'restored']);

  // The hand-run backfill inserts older versions after live ones: the order is by time, not by id (review of #2304).
  const late = h.labelRows([
    { id: 50, kind: 'typed', text: 'live now', actor: 'A', created_at: t(100) },
    { id: 90, kind: 'backfill', text: 'from the journal', created_at: t(0) },
  ], []);
  assert.deepEqual(late.map(r => r.text), ['from the journal', 'live now'], 'a backfilled older version comes first');
  assert.equal(h.groupVersions(late).pop().text, 'live now', 'and the caption now stays the newest');

  // ---- historyAnswer / historyIndex ----
  const ans = h.historyAnswer(rows, []);
  assert.equal(ans.ok, true);
  assert.equal(ans.available, true);
  assert.equal(ans.truncated, false);
  assert.equal(ans.versions[0].kind, 'generated');
  const idx = h.historyIndex([
    { post_id: 'p_a', kind: 'generated', created_at: t(0) },
    { post_id: 'p_a', kind: 'typed', actor: 'A', created_at: t(30) },
    { post_id: 'p_b', kind: 'typed', actor: 'A', created_at: t(0) },
    { post_id: 'p_b', kind: 'typed', actor: 'A', created_at: t(1) },
    { post_id: 'p_c', kind: 'generated', created_at: t(0) },
  ]);
  assert.deepEqual(idx.changed, ['p_a'], 'typing a first caption over a minute is one version, not a change');

  // ---- parseIds / tableMissing ----
  assert.deepEqual(h.parseIds('p_1, p_2,,p_1,bad id,x;y,' + 'z'.repeat(201)), ['p_1', 'p_2']);
  assert.equal(h.parseIds(Array.from({ length: 300 }, (_, i) => 'p' + i).join(',')).length, h.MAX_INDEX_IDS);
  assert.equal(h.tableMissing({ code: '42P01' }), true);
  assert.equal(h.tableMissing({ code: 'PGRST205', message: 'Could not find the table public.caption_versions' }), true);
  assert.equal(h.tableMissing({ code: '57014' }), false);
  assert.equal(h.tableMissing(null), false);

  console.log('PASS caption-history-logic');
})().catch(e => { console.error('FAIL caption-history-logic:', e && e.stack || e); process.exit(1); });
