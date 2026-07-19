'use strict';

// F141 regression guard (behavioral). The samples reorder must FAIL CLOSED when
// the Edge Function reports fewer updated rows than requested — a stale /
// mid-create / archived / raced id matches no row, so a "success" that persisted
// nothing must revert the strip and tell the user instead of silently leaving an
// order the sheet never accepted (cross-tier invariant 2: no silent data loss).
//
// This extracts the REAL _sxrPersistReorder from index.html and runs it against a
// stubbed EF response, so the guard tracks the shipped code, not a paraphrase.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extract(name) {
  const marker = 'function ' + name + '(';
  let start = source.indexOf(marker);
  assert(start >= 0, 'missing ' + name);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false, lineComment = false, blockComment = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i], next = source[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (quote) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === quote) quote = ''; continue; }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unclosed ' + name);
}

// Build a fresh sandbox per case so module-level flags don't leak between runs.
function makeContext(updatedReturned) {
  const notifies = [];
  const fetchCalls = [];
  const posts = [
    { id: 'a', order_index: 1 },   // dragged to front optimistically
    { id: 'b', order_index: 2 },
  ];
  const context = {
    _sxrReorderInFlight: false,
    _sxrReorderPending: null,
    _sxrLastLocalWriteAt: 0,
    _sxrReorderOptimistic: new Map([['a', { order_index: 1 }], ['b', { order_index: 2 }]]),
    sxrState: { client: { slug: 'sidneylaruel' }, posts },
    sxrClientSlug: (c) => (c && c.slug) || String(c || ''),
    _sxrSampleUseEf: () => true,
    _sxrCacheWrite: () => {},
    _sxrRenderBody: () => {},
    showNotify: (title, body) => notifies.push([title, body]),
    _sxrReorderFetch: async (slug, payload, srcTag) => {
      fetchCalls.push({ slug, payload, srcTag });
      const body = { ok: true, updated: updatedReturned };
      return { ok: true, status: 200, clone: () => ({ json: async () => body }) };
    },
    Date, Number, Map, Promise, Error, console,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(extract('_sxrPersistReorder'), context);
  return { context, notifies, fetchCalls, posts };
}

let failures = 0;
function ok(cond, msg) { if (!cond) { console.error('FAIL sxr-reorder-failclosed:', msg); failures++; } }

(async () => {
  const items = [{ id: 'a', order_index: 1 }, { id: 'b', order_index: 2 }];
  const prevOrder = new Map([['a', 5], ['b', 6]]);   // the order before the drag

  // Case 1 — EF matched FEWER rows than requested (the F141 silent-loss vector).
  // Must revert to prevOrder and surface a notification.
  {
    const { context, notifies, posts } = makeContext(0);
    await context._sxrPersistReorder(items, new Map(prevOrder), 'sidneylaruel');
    const byId = Object.fromEntries(posts.map(p => [p.id, p.order_index]));
    ok(byId.a === 5 && byId.b === 6, 'partial reorder (updated=0) must REVERT to the pre-drag order, got ' + JSON.stringify(byId));
    ok(notifies.length === 1 && /Couldn't save the new order/.test(notifies[0][0]),
      'partial reorder must surface a save-failure notification (no silent loss)');
  }

  // Case 2 — EF matched every requested row: the reorder stands, no notification.
  {
    const { context, notifies, posts } = makeContext(items.length);
    await context._sxrPersistReorder(items, new Map(prevOrder), 'sidneylaruel');
    const byId = Object.fromEntries(posts.map(p => [p.id, p.order_index]));
    ok(byId.a === 1 && byId.b === 2, 'complete reorder (updated=items.length) must PERSIST, got ' + JSON.stringify(byId));
    ok(notifies.length === 0, 'complete reorder must not surface a failure notification');
  }

  if (failures) process.exit(1);
  console.log('SXR reorder fail-closed (F141) checks passed');
})();
