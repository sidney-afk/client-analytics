'use strict';
/*
 * Create Post links the card on the SERVER, in the same request that creates
 * the work items (OPEN_REPAIRS 254).
 *
 * Before this, only the browser wrote video_deliverable_id /
 * graphic_deliverable_id, after the gateway answered; a page closed inside
 * that window left the card unlinked. This drives
 * supabase/functions/production-write/card-link.mjs against an in-memory
 * table and proves: a missing card is created already linked, an existing card
 * has only its EMPTY slots filled, a slot naming another deliverable is never
 * overwritten, running it twice changes nothing, and index.ts calls it on all
 * three create paths.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

function fakeDb(seed) {
  const tables = { calendar_posts: [], sample_reviews: [] };
  for (const [t, rows] of Object.entries(seed || {})) tables[t] = rows.map(r => ({ ...r }));
  const writes = [];
  function query(table) {
    const filters = [];
    let op = 'select', patch = null, returning = false;
    const match = row => filters.every(f => f(row));
    const q = {
      select() { returning = true; return q; },
      eq(col, v) { filters.push(r => String(r[col] == null ? '' : r[col]) === String(v)); return q; },
      or(expr) {
        const col = expr.split('.')[0];
        filters.push(r => r[col] == null || r[col] === '');
        return q;
      },
      update(p) { op = 'update'; patch = p; return q; },
      insert(row) {
        const dup = tables[table].some(r => r.client === row.client && r.id === row.id);
        if (dup) return Promise.resolve({ error: { code: '23505' } });
        tables[table].push({ ...row }); writes.push(['insert', table, row.id]);
        return Promise.resolve({ error: null });
      },
      maybeSingle() { return Promise.resolve({ data: tables[table].find(match) || null, error: null }); },
      then(resolve, reject) {
        let data;
        if (op === 'update') {
          const hit = tables[table].filter(match);
          hit.forEach(r => Object.assign(r, patch));
          if (hit.length) writes.push(['update', table, Object.keys(patch).join(',')]);
          data = returning ? hit.map(r => ({ id: r.id })) : null;
        } else data = tables[table].filter(match);
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return q;
  }
  return { client: { from: query }, tables, writes };
}

const item = (team, id, cardId, extra) => ({ id, team, card_id: cardId, client_slug: 'sidneylaruel',
  origin: 'calendar', title: 'Video 3', video_number: 3, linear_issue_url: null, ...(extra || {}) });

(async () => {
  const { linkCardsToCreatedDeliverables } = await import(
    path.join(__dirname, '..', 'supabase/functions/production-write/card-link.mjs'));

  // 1. The card does not exist yet: created already carrying both ids.
  let db = fakeDb({ calendar_posts: [{ client: 'sidneylaruel', id: 'old', order_index: '40' }] });
  let r = await linkCardsToCreatedDeliverables(db.client, [item('video', 'del_v', 'c1'), item('graphics', 'del_g', 'c1')]);
  let card = db.tables.calendar_posts.find(x => x.id === 'c1');
  assert.ok(card, 'missing card is created');
  assert.strictEqual(card.video_deliverable_id, 'del_v');
  assert.strictEqual(card.graphic_deliverable_id, 'del_g');
  assert.strictEqual(card.order_index, '43', 'placed after the last card, like the browser does');
  assert.strictEqual(card.name, 'Video 3');
  assert.deepStrictEqual([r.cards, r.failed, r.occupied], [1, 0, 0]);

  // 2. Twice is the same as once.
  const before = JSON.stringify(db.tables);
  const writes = db.writes.length;
  r = await linkCardsToCreatedDeliverables(db.client, [item('video', 'del_v', 'c1'), item('graphics', 'del_g', 'c1')]);
  assert.strictEqual(JSON.stringify(db.tables), before, 'a second run changes nothing');
  assert.strictEqual(db.writes.length, writes, 'a second run writes nothing');
  assert.strictEqual(r.already_linked, 2);

  // 3. A video-only create leaves the graphic id null, never "" (foreign key).
  db = fakeDb();
  await linkCardsToCreatedDeliverables(db.client, [item('video', 'del_v2', 'c2')]);
  assert.strictEqual(db.tables.calendar_posts[0].graphic_deliverable_id, null);

  // 4. An existing card: only the empty slot is filled, nothing else touched.
  db = fakeDb({ calendar_posts: [{ client: 'sidneylaruel', id: 'c3', name: 'Kept', caption: 'Kept caption',
    video_deliverable_id: 'del_v3', graphic_deliverable_id: '' }] });
  r = await linkCardsToCreatedDeliverables(db.client, [item('graphics', 'del_g3', 'c3')]);
  card = db.tables.calendar_posts[0];
  assert.strictEqual(card.graphic_deliverable_id, 'del_g3');
  assert.strictEqual(card.video_deliverable_id, 'del_v3');
  assert.strictEqual(card.name, 'Kept');
  assert.strictEqual(card.caption, 'Kept caption');
  assert.strictEqual(r.linked, 1);

  // 5. A slot already naming a DIFFERENT deliverable is never overwritten.
  db = fakeDb({ calendar_posts: [{ client: 'sidneylaruel', id: 'c4', video_deliverable_id: 'someone_else' }] });
  r = await linkCardsToCreatedDeliverables(db.client, [item('video', 'del_v4', 'c4')]);
  assert.strictEqual(db.tables.calendar_posts[0].video_deliverable_id, 'someone_else');
  assert.strictEqual(r.occupied, 1);

  // 6. Samples land in sample_reviews; another client's card is not touched.
  db = fakeDb({ sample_reviews: [{ client: 'other', id: 's1', video_deliverable_id: '' }] });
  await linkCardsToCreatedDeliverables(db.client, [item('video', 'del_s', 's1', { origin: 'samples' })]);
  assert.strictEqual(db.tables.sample_reviews.find(x => x.client === 'other').video_deliverable_id, '');
  const mine = db.tables.sample_reviews.find(x => x.client === 'sidneylaruel');
  assert.ok(mine && mine.video_deliverable_id === 'del_s' && mine.creative_direction === '');

  // 7. index.ts calls it on the append, new-batch and component-fill paths.
  const src = fs.readFileSync(path.join(__dirname, '..', 'supabase/functions/production-write/index.ts'), 'utf8');
  assert.ok(src.includes('import { linkCardsToCreatedDeliverables } from "./card-link.mjs";'));
  assert.strictEqual((src.match(/await linkCardsToCreatedDeliverables\(/g) || []).length, 3);
  assert.strictEqual((src.match(/card_link: cardLink,/g) || []).length, 3);

  console.log('production-write card link: 7 checks passed');
})().catch(e => { console.error(e); process.exit(1); });
