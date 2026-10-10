'use strict';
/*
 * REGRESSION GUARD: when the TikTok upload switch cannot be read and this
 * browser never saw an answer, uploads take the live path (the functions), not
 * the n8n webhooks that were switched off on 2026-10-08 (OPEN_REPAIRS 397,
 * Digger bug archaeology 2026-10-10). A browser that saw a value keeps it, so
 * a rollback to n8n still holds through a failed read.
 *
 * Run:  node --require ./test/helpers/single-file-index.js test/tiktok-source-unknown-default.js
 * The real _tkSource is pulled out of the built page.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extract(name) {
  let start = source.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('missing ' + name);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  let depth = 0, i = source.indexOf('{', source.indexOf(')', start)), quote = '';
  for (; i < source.length; i++) {
    const ch = source[i];
    if (quote) { if (ch === '\\') { i++; continue; } if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '/' && source[i + 1] === '/') { i = source.indexOf('\n', i); continue; }
    if (ch === '/' && source[i + 1] === '*') { i = source.indexOf('*/', i + 2) + 1; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unclosed ' + name);
}
function constLine(name) {
  const m = source.match(new RegExp('^\\s*(?:const|let) ' + name + '\\s*=.*;\\s*$', 'm'));
  if (!m) throw new Error('missing ' + name);
  return m[0];
}

async function sourceWith({ saved, read }) {
  const store = new Map(saved ? [['syncview_tiktok_upload_source_last', saved]] : []);
  const s = {
    Date, Array, JSON, AbortSignal, encodeURIComponent,
    CAL_SUPABASE_URL: 'https://x.invalid', CAL_SUPABASE_ANON_KEY: 'k', TIKTOK_UPLOAD_SOURCE_FLAG_KEY: 'tiktok_upload_source',
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    fetch: async () => {
      if (read === 'throw') throw new Error('offline');
      if (read === 'http500') return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, json: async () => (read === null ? [] : [{ value: read }]) };
    },
  };
  vm.createContext(s);
  vm.runInContext([constLine('TK_SOURCE_TTL_MS'), constLine('TK_SOURCE_LAST_KEY'), 'let _tkSourceCache = null;', extract('_tkSource')].join('\n'), s);
  return { value: await s._tkSource(true), saved: store.get('syncview_tiktok_upload_source_last') };
}

(async () => {
  for (const read of ['throw', 'http500']) {
    const r = await sourceWith({ saved: null, read });
    assert.strictEqual(r.value, 'supabase', `nothing saved and the read ${read === 'throw' ? 'failed' : 'answered 500'}: the live path, not the switched-off n8n (got ${r.value})`);
  }
  assert.strictEqual((await sourceWith({ saved: null, read: null })).value, 'n8n', 'a readable table with no row still means the switch was never set (n8n), as before');
  assert.strictEqual((await sourceWith({ saved: 'n8n', read: 'throw' })).value, 'n8n', 'a browser that saw a rollback to n8n keeps it through a failed read');
  assert.strictEqual((await sourceWith({ saved: 'n8n+table', read: 'throw' })).value, 'n8n+table', 'and the read-table rollback too');
  assert.strictEqual((await sourceWith({ saved: null, read: { source: 'n8n' } })).value, 'n8n', 'a readable switch is followed as it says');
  const live = await sourceWith({ saved: null, read: { source: 'supabase' } });
  assert.strictEqual(live.value, 'supabase', 'a readable live switch is followed');
  assert.strictEqual(live.saved, 'supabase', 'and remembered for the next failed read');
  console.log('tiktok-source-unknown-default: an unreadable switch sends uploads to the live path ✅');
})().catch(e => { console.error(e); process.exit(1); });
