'use strict';
/*
 * Boot entry tax: early key-verify + one batched runtime-flag read.
 *
 * Run:  node test/boot-entry-tax.js   (exit 0 = all good)
 *
 * The <head> boot script starts the boot key-verify POST and ONE batched
 * syncview_runtime_flags read while the document parses (speed map
 * 2026-09-23, "Cross-cutting"). This pins:
 *  - the head copies of the Supabase URL, publishable key and flag keys match
 *    the app's constants, so the batch can never read a different table/key;
 *  - the early verify answer is handed over once, only to the boot surface,
 *    only for the exact key + member it was sent for, and only while fresh;
 *  - each batched flag row is taken once, a failed batch falls back to the
 *    consumer's own read, and every consumer still has its own read;
 *  - init() still awaits the staff verification before any staff data loads.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const headEnd = INDEX.indexOf('</head>');
const HEAD = INDEX.slice(0, headEnd);
const APP = INDEX.slice(headEnd);
let failures = 0;
function check(name, ok) { console.log((ok ? 'ok    ' : 'FAIL  ') + name); if (!ok) failures++; }
function grab(src, re) { const m = src.match(re); return m ? m[1] : null; }

check('head base URL matches CAL_SUPABASE_URL',
  grab(HEAD, /var svBase = '([^']+)'/) === grab(APP, /const CAL_SUPABASE_URL\s*=\s*'([^']+)'/));
check('head key matches CAL_SUPABASE_ANON_KEY',
  grab(HEAD, /var svKey = '([^']+)'/) === grab(APP, /const CAL_SUPABASE_ANON_KEY\s*=\s*'([^']+)'/));

const headKeys = JSON.parse((grab(HEAD, /var svFlagKeys = (\[[^\]]+\])/) || '[]').replace(/'/g, '"'));
const appKeys = {
  CALENDAR_UPSERT_FLAG_KEY: grab(APP, /const CALENDAR_UPSERT_FLAG_KEY = '([^']+)'/),
  KASPER_URGENT_FLAG_KEY: grab(APP, /const KASPER_URGENT_FLAG_KEY = '([^']+)'/),
  WRITE_UI_REROUTE_FLAG_KEY: grab(APP, /const WRITE_UI_REROUTE_FLAG_KEY = '([^']+)'/),
  CLIENT_COMMENT_GATEWAY_FLAG_KEY: grab(APP, /const CLIENT_COMMENT_GATEWAY_FLAG_KEY = '([^']+)'/),
  SETTINGS_EF_FLAG_KEY: grab(APP, /const SETTINGS_EF_FLAG_KEY = '([^']+)'/),
  SXR_SAMPLE_REVIEW_FLAG_KEY: grab(APP, /const SXR_SAMPLE_REVIEW_FLAG_KEY = '([^']+)'/),
  ANALYTICS_MIRROR_FLAG_KEY: grab(APP, /const ANALYTICS_MIRROR_FLAG_KEY = '([^']+)'/),
};
check('head batch covers exactly the seven boot flag keys',
  headKeys.length === 7 && Object.values(appKeys).every(k => k && headKeys.includes(k)));
check('prod_authority stays a live read (not batched)', !headKeys.includes('prod_authority'));
// The leave (Time Off) flag is deliberately NOT batched: its source is pinned
// by the leave evidence fingerprint (test/leave-evidence-fingerprint-coupling.js).
check('the leave flag keeps its own read', headKeys.every(k => !/^pto/.test(k)));
for (const [name, value] of Object.entries(appKeys)) {
  if (name === 'CLIENT_COMMENT_GATEWAY_FLAG_KEY') continue; // read alongside the reroute key
  check('consumer of ' + name + ' takes the boot row then falls back to its own read',
    APP.includes('await _svBootFlagRows(' + name + ')') && APP.includes('encodeURIComponent(' + name));
}
check('write-ui routing uses the batch only when BOTH keys came from it',
  /if \(bootReroute && bootGateway\) return bootReroute\.concat\(bootGateway\);/.test(APP));
check('init() still awaits staff verification before loading',
  /const verifiedIdentity = await _syncviewStaffIdentityBoot\(\);\s*if \(!verifiedIdentity && _syncviewStaffGateRequired\(\)\)/.test(APP));
check('early verify only starts for a saved identity, after the gate check',
  HEAD.indexOf("if (!authed) { de.classList.add('boot-gate'); return; }") < HEAD.indexOf('__svEarlyKeyVerify'));

// Behaviour of the early-verify hand-over.
const takeSrc = grab(APP, /(function _syncviewTakeEarlyKeyVerify\([\s\S]*?\n    \})/);
check('early-verify taker found', !!takeSrc);
if (takeSrc) {
  const ctx = { window: {}, Date };
  vm.createContext(ctx);
  vm.runInContext(takeSrc, ctx);
  const cand = { key: 'k1', member: { id: 'm1' } };
  const seed = (over) => { ctx.window.__svEarlyKeyVerify = Object.assign({ key: 'k1', memberId: 'm1', at: Date.now(), response: 'R' }, over || {}); };
  seed(); check('matching boot candidate gets the early answer', ctx._syncviewTakeEarlyKeyVerify(cand, 'staff-boot') === 'R');
  check('answer is handed over only once', ctx._syncviewTakeEarlyKeyVerify(cand, 'staff-boot') === null);
  seed(); check('sign-in surface never reuses it', ctx._syncviewTakeEarlyKeyVerify(cand, 'staff-login') === null);
  check('a refused hand-over still discards it', ctx.window.__svEarlyKeyVerify === null);
  seed({ key: 'other' }); check('different key is refused', ctx._syncviewTakeEarlyKeyVerify(cand, 'staff-boot') === null);
  seed({ memberId: 'm2' }); check('different member is refused', ctx._syncviewTakeEarlyKeyVerify(cand, 'staff-boot') === null);
  seed({ at: Date.now() - 61000 }); check('stale answer is refused', ctx._syncviewTakeEarlyKeyVerify(cand, 'staff-boot') === null);
}

// Behaviour of the head batch: run the head IIFE against a fake browser.
async function headBatch(fetchImpl) {
  // Every <head> script in order: the clean-address router first, then boot.
  const scripts = [...HEAD.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const store = { syncview_staff_identity_v1: JSON.stringify({ key: 'k1', role: 'admin', member: { id: 'm1' } }) };
  const calls = [];
  const win = { addEventListener() {} };
  const ctx = {
    window: win, performance: { now: () => 1000 },
    location: { search: '', hash: '#templates', pathname: '/', origin: 'https://example.invalid' },
    URL, URLSearchParams, JSON, Promise, Date, encodeURIComponent, decodeURIComponent, String, Array,
    history: { state: null, pushState() {}, replaceState() {} },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null },
    document: { documentElement: { classList: { add() {} }, setAttribute() {}, removeAttribute() {} }, querySelector: () => null },
    fetch: (url, opts) => { calls.push({ url, opts }); return fetchImpl(url, opts); },
  };
  win.fetch = ctx.fetch;
  vm.createContext(ctx);
  for (const script of scripts) { vm.runInContext(script, ctx); if (win.svRoute) ctx.svRoute = win.svRoute; }
  return { win, calls };
}
(async () => {
  const ok = { ok: true, json: async () => [{ key: 'settings_ef_clients', value: { clients: ['x'] } }] };
  const { win, calls } = await headBatch(async () => ok);
  const flagCalls = calls.filter(c => /syncview_runtime_flags/.test(c.url));
  check('head fires exactly one flag read', flagCalls.length === 1 && /key=in\./.test(flagCalls[0].url));
  const verifyCalls = calls.filter(c => /key-verify/.test(c.url));
  check('head fires exactly one boot key-verify for the stored identity',
    verifyCalls.length === 1 && verifyCalls[0].opts.headers['X-Syncview-Key'] === 'k1'
    && JSON.parse(verifyCalls[0].opts.body).surface === 'staff-boot');
  const first = await win.__svTakeBootFlag('settings_ef_clients');
  check('batched row is returned', first && first.row && first.row.value.clients[0] === 'x');
  check('batched row is taken once', (await win.__svTakeBootFlag('settings_ef_clients')) === null);
  const absent = await win.__svTakeBootFlag('sample_review_ef_clients');
  check('absent flag returns row null (same as an empty eq. read)', absent && absent.row === null);
  check('unknown key is not served from the batch', (await win.__svTakeBootFlag('prod_authority')) === null);
  const failed = await headBatch(async () => ({ ok: false, status: 503, json: async () => [] }));
  check('a failed batch makes consumers read for themselves', (await failed.win.__svTakeBootFlag('settings_ef_clients')) === null);
  console.log(failures ? `\nboot-entry-tax: ${failures} check(s) failed ❌` : '\nboot-entry-tax: all checks passed ✅');
  process.exit(failures ? 1 : 0);
})();
