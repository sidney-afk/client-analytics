'use strict';
/*
 * Workload's fresh-board read starts in PARALLEL with key-verify.
 *
 * Measured on the live site 2026-09-25: a warm Workload reload painted its
 * saved copy at ~0.8 s but only became live and editable at 2.2-2.9 s, because
 * the `native_snapshot_v2` read (0.9-1.3 s) started only after key-verify
 * (0.45-0.85 s) had answered. The <head> boot script now starts that read at
 * the same moment as key-verify, and the app takes it only after the check has
 * passed, for the same person.
 *
 * This suite pins the safety rules, running the SHIPPED helper against a fake
 * window: the early answer is used only for the exact key, member, actor name
 * and role the page is verified as, only once, only within a minute, only when
 * it is a successful response; everything else falls back to the normal read.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed++; console.log('  ok  ' + m); };

function grab(name) {
  const at = INDEX.search(new RegExp('async\\s+function\\s+' + name + '\\s*\\('));
  assert.ok(at >= 0, 'function not found: ' + name);
  let depth = 0;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    if (INDEX[j] === '{') depth++;
    else if (INDEX[j] === '}' && --depth === 0) return INDEX.slice(at, j + 1);
  }
  throw new Error('unbalanced ' + name);
}

// 1. The boot script starts the read only on #workload, beside key-verify.
const head = INDEX.slice(0, INDEX.indexOf('__svTakeBootFlag'));
ok(/window\.__svEarlyWlSnapshot\s*=/.test(head), 'the <head> boot script records an early Workload snapshot');
ok(/svHash0 === 'workload'/.test(head), 'only when the page opens on #workload');
ok(head.indexOf('__svEarlyWlSnapshot') > head.indexOf('__svEarlyKeyVerify'), 'started in the same block, right after key-verify');
ok(/workload-plan\?forceFunctionRegion=us-east-1/.test(head) && /forceFunctionRegion=us-east-1/.test(INDEX.match(/const WORKLOAD_PLAN_URL = [^;]+;/)[0]),
  'the early read uses the same URL as WORKLOAD_PLAN_URL');
ok(/action: 'native_snapshot_v2', if_version: ''/.test(head), 'and the same first-read body (no held version on a fresh page)');

// 2. It is consumed only after the staff check, and only with no memo.
const fetchFn = grab('wlFetchNativeSnapshot');
ok(fetchFn.indexOf('_syncviewRequireStaffIdentity') < fetchFn.indexOf('_wlTakeEarlySnapshot'),
  'wlFetchNativeSnapshot takes the early read only after _syncviewRequireStaffIdentity');
ok(/!memo\) response = await _wlTakeEarlySnapshot\(\)/.test(fetchFn), 'and only when it holds no version of its own');

// 3. The shipped helper, against a fake window.
const helperSrc = grab('_wlTakeEarlySnapshot');
async function take(early, identity, now) {
  const ctx = { window: { __svEarlyWlSnapshot: early }, Date: { now: () => now || 1000 },
    _syncviewStaffIdentityForHeaders: () => identity };
  vm.createContext(ctx);
  vm.runInContext(helperSrc + '\nthis.take = _wlTakeEarlySnapshot;', ctx);
  const result = await ctx.take();
  return { result, left: ctx.window.__svEarlyWlSnapshot };
}
const good = { ok: true, status: 200 };
const id = { key: 'k1', role: 'admin', member: { id: 'm1', name: 'Staff One' } };
const early = (extra) => Object.assign({ key: 'k1', memberId: 'm1', actor: 'Staff One', role: 'admin', at: 900,
  response: Promise.resolve(good) }, extra || {});

(async () => {
  let r = await take(early(), id);
  ok(r.result === good, 'same key, member, actor and role within a minute: the early answer is used');
  ok(r.left === null, 'and taken once: the slot is cleared');
  ok((await take(early({ key: 'k2' }), id)).result === null, 'a different key: discarded');
  ok((await take(early({ memberId: 'm2' }), id)).result === null, 'a different member: discarded');
  ok((await take(early({ actor: 'Someone Else' }), id)).result === null, 'a different actor name: discarded');
  ok((await take(early({ role: 'smm' }), id)).result === null, 'a different role: discarded');
  ok((await take(early(), id, 900 + 60000)).result === null, 'older than a minute: discarded');
  ok((await take(early(), null)).result === null, 'no verified identity: discarded');
  ok((await take(early({ response: Promise.resolve({ ok: false, status: 401 }) }), id)).result === null,
    'a refused answer is not reused; the normal read runs');
  ok((await take(early({ response: Promise.reject(new Error('net')) }), id)).result === null,
    'a failed request is not reused; the normal read runs');
  ok((await take(null, id)).result === null, 'no early read at all: the normal read runs');
  console.log(`\nworkload-early-snapshot: ${passed} checks passed ✅`);
})().catch(e => { console.error(e); process.exit(1); });
