'use strict';
/*
 * The analytics snapshot cache must survive outgrowing the localStorage quota.
 *
 * A big roster's MR briefs alone run ~0.75MB of CSV, and the snapshot is one
 * all-or-nothing key. When it crossed the quota, every write threw, the whole
 * cache was dropped, every boot re-fetched from cold, and the quota warning
 * spammed each load -- seen live on two machines. A full localStorage also
 * endangers every other writer on the origin, including the saved Create Post
 * payload, which is the only copy of what a user typed.
 *
 * Defenses pinned here: UTF-8 byte-pair packing (localStorage stores UTF-16,
 * so ASCII-heavy JSON wastes half of every character -- packing is a sync,
 * lossless, exactly-2x cut), a retry without the optional summaries section
 * before giving up, a once-per-session warning with a doomed-write breaker,
 * and hydration compatibility with unprefixed legacy snapshots.
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

// --- assemble the module under test with mockable storage ------------------
function makeStore(capacity) {
  const map = new Map();
  return {
    map,
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem(k, v) {
      const others = [...map.entries()].filter(([key]) => key !== k)
        .reduce((n, [, val]) => n + val.length, 0);
      if (others + String(v).length > capacity) {
        const err = new Error('exceeded the quota');
        err.name = 'QuotaExceededError';
        throw err;
      }
      map.set(k, String(v));
    },
    removeItem: k => { map.delete(k); },
  };
}

function build({ capacity }) {
  const localStorage = makeStore(capacity);
  const sessionStorage = makeStore(1e6);
  const warnings = [];
  const scope = {
    localStorage, sessionStorage,
    console: { warn: (...a) => warnings.push(a.join(' ')), log: () => {} },
    unescape: global.unescape, escape: global.escape,
    encodeURIComponent, decodeURIComponent,
    Date, JSON, Number, String, Object, Math,
    _clientsInfoPublicRows: rows => rows,
  };
  const names = Object.keys(scope);
  const body = [
    "const ANALYTICS_CACHE_KEY = 'syncview_analyticsCache_v1';",
    "const ANALYTICS_CACHE_FAIL_KEY = 'syncview_analyticsCacheQuotaFail_v1';",
    extract('_lsPackUtf8'),
    extract('_lsUnpackUtf8'),
    extract('_analyticsCacheRead'),
    extract('_analyticsCacheWrite'),
    'return { _lsPackUtf8, _lsUnpackUtf8, _analyticsCacheRead, _analyticsCacheWrite };',
  ].join('\n');
  const mod = new Function(...names, body)(...names.map(n => scope[n]));
  return { ...mod, localStorage, sessionStorage, warnings };
}

// --- packing is lossless and actually halves the footprint ------------------
const m = build({ capacity: 1e9 });
for (const text of [
  'plain ascii csv,with,commas\nand,rows',
  'accents: Dí a Sofía qué pasó — ¿todo bien?',
  'emoji and CJK: 🎬📈 中文 ру́сский',
  '', 'x',
]) {
  ok(m._lsUnpackUtf8(m._lsPackUtf8(text)) === text,
  'pack/unpack round-trips: ' + JSON.stringify(text.slice(0, 24)));
}
const ascii = 'a'.repeat(10000);
ok(m._lsPackUtf8(ascii).length <= ascii.length / 2 + 2,
'packing halves an ASCII payload');

// --- write/read through the real functions ---------------------------------
const w = build({ capacity: 1e9 });
w._analyticsCacheWrite({ metrics: 'm1', clients: [{ a: 1 }] });
w._analyticsCacheWrite({ topvids: 'tv', briefs: 'b', mrbriefs: 'mr', summaries: 's' });
const stored = w.localStorage.getItem('syncview_analyticsCache_v1');
ok(!!stored && stored.slice(0, 3) === 'P1:', 'snapshots are stored packed with the P1 prefix');
const back = w._analyticsCacheRead();
ok(back && back.metrics === 'm1' && back.mrbriefs === 'mr' && back.summaries === 's' && back.at > 0,
'a packed snapshot reads back complete, merged across both writers');

// --- legacy unprefixed snapshots still hydrate ------------------------------
const l = build({ capacity: 1e9 });
l.localStorage.map.set('syncview_analyticsCache_v1',
  JSON.stringify({ metrics: 'legacy', clients: [], at: Date.now() }));
ok((l._analyticsCacheRead() || {}).metrics === 'legacy',
'an unprefixed legacy snapshot is still readable');

// --- quota degradation: summaries are sacrificed first ----------------------
const big = 'x'.repeat(120000);
// Packing halves the JSON: the full snapshot (~240K raw) packs to ~120K, the
// degraded one (~120K raw) to ~60K. 90K capacity therefore refuses the full
// write and admits the degraded one -- exactly the path under test.
const d = build({ capacity: 90000 });
d._analyticsCacheWrite({ metrics: 'm', clients: [] });
d._analyticsCacheWrite({ topvids: 'tv', briefs: 'b', mrbriefs: big, summaries: big });
const degraded = d._analyticsCacheRead();
ok(!!degraded && degraded.mrbriefs === big && !('summaries' in degraded),
'over quota, the optional summaries are dropped and the paintable snapshot is kept');
ok(d.warnings.length === 0, 'a successful degraded write does not warn');

// --- total failure: drop, warn once, stop re-trying doomed sizes ------------
const f = build({ capacity: 50000 });
f._analyticsCacheWrite({ metrics: 'm', clients: [] });
f._analyticsCacheWrite({ topvids: big, briefs: big, mrbriefs: big, summaries: 's' });
ok(f.localStorage.getItem('syncview_analyticsCache_v1') === null,
'a snapshot that cannot fit even degraded is dropped, never half-written');
ok(f.warnings.length === 1, 'the failure warns');
f._analyticsCacheWrite({ topvids: big, briefs: big, mrbriefs: big, summaries: 's' });
f._analyticsCacheWrite({ topvids: big, briefs: big, mrbriefs: big, summaries: 's' });
ok(f.warnings.length === 1, 'repeat failures in the same session stay quiet');
// A payload at least as large as the known-doomed size is not even attempted.
const attemptsBefore = f.localStorage.map.size;
f._analyticsCacheWrite({ topvids: big, briefs: big, mrbriefs: big + big, summaries: 's' });
ok(f.localStorage.map.size === attemptsBefore && f.warnings.length === 1,
'known-doomed sizes skip the write attempt entirely');
// A payload well under the doomed size gets its attempt -- and when it also
// fails, the session stays quiet. This is the case the once-guard alone
// covers: the size breaker never fires for it. Sizing: the doomed write
// packed to ~180K, so the breaker skips anything over ~162K; 150K raw packs
// to ~75K -- under the breaker, over the 50K capacity, so it attempts, fails,
// and must stay silent.
f._analyticsCacheWrite({ topvids: 'x'.repeat(150000), briefs: '', mrbriefs: 'x', summaries: '' });
ok(f.localStorage.getItem('syncview_analyticsCache_v1') === null,
'the smaller payload really did attempt and fail, not skip');
ok(f.warnings.length === 1,
'a smaller payload that still fails does not warn again');
// A much smaller later payload is allowed to try again and succeeds.
const g = build({ capacity: 50000 });
g._analyticsCacheWrite({ topvids: big, briefs: big, mrbriefs: big, summaries: 's' });
g._analyticsCacheWrite({ metrics: 'small', clients: [] });
ok((g._analyticsCacheRead() || {}).metrics === 'small',
'a smaller payload after a failure still writes, and clears the breaker');

if (failures) process.exit(1);
console.log('\nAnalytics cache quota checks passed');
