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
const vm = require('vm');

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
  const calls = { upserts: [], renders: 0, cacheWrites: 0, scheduled: 0, renderOptions: [] };
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
    _sxrRenderBody: (options) => { calls.renders++; calls.renderOptions.push(options || null); },
    /* The deferred-render guard, as the real one behaves: busy is whatever the
       case under test says, and scheduling is only ARMED -- the interval's first
       tick clears itself unless _sxrPendingBackgroundRender is already true, so
       arming without setting the flag repaints nothing at all. */
    _sxrIsBusy: () => Boolean(opts.busy),
    _sxrPendingBackgroundRender: false,
    _sxrSchedulePendingRender: () => { calls.scheduled++; },
  };
  /* A vm context rather than new Function(...names): the adopter ASSIGNS
     _sxrPendingBackgroundRender, and an assignment to a function parameter is
     invisible from out here. As a context property it reads back, so the test
     can tell "armed the interval" (which alone does nothing) from "armed it and
     set the flag" (which actually repaints once the user stops typing). */
  vm.createContext(scope);
  vm.runInContext(extract('_sxrAdoptDeliverableLinks')
    + '\nthis.fn = _sxrAdoptDeliverableLinks;', scope);
  return { fn: scope.fn, calls, state, scope };
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

  // --- the repaint must not eat a caret (P2, PR 1105 review) -----------------
  /* Adoption is a fetch plus an upsert AFTER the load returned, so its repaint
     can land seconds later -- while the SMM is typing in a card field. While the
     adopter only ever ran from the catch block this was unreachable; putting it
     on the success path makes it a real hazard on every healthy load, so the
     repaint goes through the same deferred-render guard loadSxrCards already
     uses for background reloads. */
  const ADOPTABLE = {
    posts: LIVE_SHAPE(), loadSeq: 7,
    rows: { del_gra: { id: 'del_gra', card_id: 'p_native_x_1', linear_issue_url: 'https://linear.app/x/issue/GRA-7131' } },
  };
  const idle = build({ ...ADOPTABLE, posts: LIVE_SHAPE(), busy: false });
  await idle.fn(7, 's');
  ok(idle.calls.renders === 1 && idle.calls.scheduled === 0,
  'an idle Samples tab repaints immediately -- the adopted link is visible at once');
  ok(idle.calls.renderOptions[0] && idle.calls.renderOptions[0].preserveScroll === true,
  'that repaint preserves scroll -- the adopter lands late, after the user may have scrolled');
  ok(idle.scope._sxrPendingBackgroundRender === false,
  'an immediate repaint leaves no deferred render armed behind it');

  const busy = build({ ...ADOPTABLE, posts: LIVE_SHAPE(), busy: true });
  await busy.fn(7, 's');
  ok(busy.calls.renders === 0,
  'a mid-edit Samples tab is NOT rebuilt -- the focused input keeps its caret');
  ok(busy.calls.scheduled === 1,
  'the repaint is handed to the deferred-render scheduler instead');
  /* Arming alone is not enough: the interval's first tick clears itself unless
     _sxrPendingBackgroundRender is true, so a schedule without the flag drops
     the repaint entirely and the card shows "no sub-issue" until some later
     render happens to run. */
  ok(busy.scope._sxrPendingBackgroundRender === true,
  'and the pending-render FLAG is set, or the scheduled tick would cancel itself and repaint nothing');
  ok(busy.calls.upserts.length === 1 && busy.state.posts[0].graphic_linear_issue_id !== '',
  'deferring the repaint never defers the adoption itself -- the link is still persisted');

  // --- the loader actually runs it, ON THE SUCCESS PATH ---------------------
  /* This used to assert only that the call STRING existed somewhere in the
     file. It shipped in #1098 inside loadSxrCards' CATCH block, so it ran only
     when the load THREW — i.e. never, on a healthy tab — and the assertion
     passed the whole time. Two real samples created 2026-08-20 kept the orange
     "Link the Linear sub-issue" banner with their GRA issues already minted,
     and reloading could not clear it because the reload SUCCEEDED. Pin the
     placement, not the presence: the calendar twin runs on every successful
     load and this must too. */
  const loader = extract('loadSxrCards');
  const adoptAt = loader.indexOf('_sxrAdoptDeliverableLinks(seq, slug)');
  /* The loader's MAIN catch, not one of the inline `} catch (e) {}` swallows
     it also contains — match a catch whose block is not immediately closed. */
  const mainCatch = /\} catch \(e\) \{(?!\})/.exec(loader);
  ok(adoptAt >= 0 && mainCatch, 'the adopter call and the loader\'s main catch are both locatable');
  ok(adoptAt < mainCatch.index,
    'loadSxrCards fires the adopter on the SUCCESS path, before the catch — not only when the load throws');
  ok(!loader.slice(mainCatch.index).includes('_sxrAdoptDeliverableLinks(seq, slug)'),
    'the catch block does not re-run adoption on a failed load, where card state is stale or empty');

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
