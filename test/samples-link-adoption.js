'use strict';
/*
 * Samples: late Linear-link adoption + the Production buttons.
 *
 * Live report 2026-08-19 (first real native sample, TEST client): the card
 * carried both deliverable ids, the VIDEO Linear url, and an EMPTY graphics
 * url — because a native card is materialized before the Linear mirror
 * finishes draining, and the video child had drained in time while the
 * graphics child (GRA-7131) had not. The deliverable row had the url within
 * a minute; nothing ever wrote it back onto the sample. The plan named
 * _sxrAdoptDeliverableLinks as the adopter, but it had never been built --
 * the calendar had _calAdoptDeliverableLinks, samples had nothing.
 *
 * Same report: no "open in SyncView Production" buttons on the sample card.
 * The calendar renders them from the deliverable ids (_calProdSlotHtml); the
 * samples pile only rendered the Linear slots.
 *
 * This suite EXECUTES the adopter against stubs, so it fails on behaviour.
 */

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let failures = 0;
function ok(value, label) {
  if (value) console.log('  ok  ' + label);
  else { failures++; console.error('FAIL  ' + label); }
}

function extract(name) {
  const marker = 'function ' + name + '(';
  let start = source.indexOf(marker);
  if (start < 0) throw new Error('missing ' + name);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false, line = false, block = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    if (line) { if (ch === '\n') line = false; continue; }
    if (block) { if (ch === '*' && source[i + 1] === '/') { block = false; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') { line = true; i++; continue; }
    if (ch === '/' && source[i + 1] === '*') { block = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unclosed ' + name);
}

// ---------- the adopter, executed ------------------------------------------
function build(opts) {
  const calls = { upserts: [], renders: 0, cacheWrites: 0 };
  const state = { posts: opts.posts };
  const scope = {
    _sxrLoadSeq: opts.loadSeq,
    sxrState: state,
    _sxrIsBlankId: id => /^blank/.test(String(id || '')),
    _writeUiNativeId: (post, component) =>
      String((component === 'graphic' ? post.graphic_deliverable_id : post.video_deliverable_id) || '').trim(),
    _calFetchDeliverableLinkRows: async ids => {
      const map = new Map();
      for (const id of ids) if (opts.rows[id]) map.set(id, opts.rows[id]);
      return map;
    },
    _sxrUpsertFetch: (slug, body, src) => {
      calls.upserts.push({ slug, body, src });
      const ok = opts.upsertFails ? false : true;
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok }) });
    },
    _sxrCacheWrite: () => { calls.cacheWrites++; },
    _sxrRenderBody: () => { calls.renders++; },
  };
  const names = Object.keys(scope);
  const fn = new Function(...names, extract('_sxrAdoptDeliverableLinks')
    + ' return _sxrAdoptDeliverableLinks;')(...names.map(n => scope[n]));
  return { fn, calls, state };
}

const LIVE_SHAPE = () => [{
  id: 'p_native_x_1', name: 'Video 1',
  linear_issue_id: 'https://linear.app/x/issue/VID-13418',
  graphic_linear_issue_id: '',
  video_deliverable_id: 'del_vid', graphic_deliverable_id: 'del_gra',
}];

(async () => {
  // --- the reported live case: video linked, graphics missing --------------
  const a = build({
    posts: LIVE_SHAPE(), loadSeq: 7,
    rows: { del_gra: { id: 'del_gra', card_id: 'p_native_x_1', linear_issue_url: 'https://linear.app/x/issue/GRA-7131' } },
  });
  const adopted = await a.fn(7, 'sidneylaruel');
  ok(adopted === 1, 'the missing graphics url is adopted (the exact live case)');
  ok(a.calls.upserts.length === 1
    && a.calls.upserts[0].body.sample.id === 'p_native_x_1'
    && a.calls.upserts[0].body.sample.graphic_linear_issue_id === 'https://linear.app/x/issue/GRA-7131',
  'the adoption is persisted through the samples upsert with only the missing field');
  ok(a.state.posts[0].graphic_linear_issue_id === 'https://linear.app/x/issue/GRA-7131',
  'the in-memory sample now carries the url');
  ok(a.calls.renders === 1 && a.calls.cacheWrites === 1,
  'the view re-renders and the cache is refreshed exactly once');
  ok(!a.calls.upserts.some(u => 'linear_issue_id' in u.body.sample),
  'the already-linked video field is never re-written');

  // --- guards ----------------------------------------------------------------
  const stale = build({ posts: LIVE_SHAPE(), loadSeq: 8, rows: { del_gra: { id: 'del_gra', card_id: 'p_native_x_1', linear_issue_url: 'https://x' } } });
  ok(await stale.fn(7, 's') === 0 && stale.calls.upserts.length === 0,
  'a superseded load adopts nothing -- no write from a stale pass');

  const bound = build({
    posts: LIVE_SHAPE(), loadSeq: 7,
    rows: { del_gra: { id: 'del_gra', card_id: 'ANOTHER_CARD', linear_issue_url: 'https://x' } },
  });
  ok(await bound.fn(7, 's') === 0,
  'a deliverable bound to a DIFFERENT card is never adopted onto this one');

  const undrained = build({ posts: LIVE_SHAPE(), loadSeq: 7, rows: { del_gra: { id: 'del_gra', card_id: 'p_native_x_1', linear_issue_url: '' } } });
  ok(await undrained.fn(7, 's') === 0,
  'a deliverable whose mirror has not drained yet is simply left for the next load');

  const failing = build({
    posts: LIVE_SHAPE(), loadSeq: 7, upsertFails: true,
    rows: { del_gra: { id: 'del_gra', card_id: 'p_native_x_1', linear_issue_url: 'https://x' } },
  });
  await failing.fn(7, 's');
  ok(failing.state.posts[0].graphic_linear_issue_id === '',
  'a failed persist does NOT update local state -- no lie that outlives a refresh');

  const complete = build({ posts: [{ id: 'p1', linear_issue_id: 'https://a', graphic_linear_issue_id: 'https://b', video_deliverable_id: 'dv', graphic_deliverable_id: 'dg' }], loadSeq: 7, rows: {} });
  ok(await complete.fn(7, 's') === 0,
  'a fully-linked card causes no fetch and no write at all');

  // --- the loader actually runs it ------------------------------------------
  ok(/_sxrAdoptDeliverableLinks\(seq, slug\)\.catch\(\(\) => \{\}\);/.test(source),
  'loadSxrCards fires the adopter as a non-blocking tail task');

  // ---------- the Production buttons ----------------------------------------
  const prodSlot = new Function('_isClientLink', '_sxrEscAttr', 'location',
    extract('_sxrProdSlotHtml') + ' return _sxrProdSlotHtml;');
  const esc = s => String(s).replace(/"/g, '&quot;');
  const slot = prodSlot(false, esc, { pathname: '/index.html' });
  const withIds = { video_deliverable_id: 'del_vid', graphic_deliverable_id: 'del_gra' };
  ok(/prod=1&d=del_vid/.test(slot(withIds, 'video')) && /prod=1&d=del_gra/.test(slot(withIds, 'graphic')),
  'both components render an open-in-Production link built from the deliverable id');
  ok(slot({}, 'video') === '' && slot({ video_deliverable_id: '' }, 'video') === '',
  'a sample without a native deliverable id renders no Production button');
  const clientSlot = prodSlot(true, esc, { pathname: '/index.html' });
  ok(clientSlot(withIds, 'video') === '',
  'client links never see the internal Production navigation');
  const pile = extract('_sxrLinearPileHtml');
  ok(/_sxrProdSlotHtml\(p, 'video'\)/.test(pile) && /_sxrProdSlotHtml\(p, 'graphic'\)/.test(pile),
  'the sample card pile includes both Production slots beside the Linear ones');

  if (failures) process.exit(1);
  console.log('\nSamples link adoption checks passed');
})().catch(error => { console.error('threw: ' + error.message); process.exit(1); });
