'use strict';
/*
 * Workload plan-day live hint (Supabase Realtime BROADCAST, no DB change).
 * Drives the SHIPPED wlCreatePlanLive factory from index.html with a mocked
 * channel: send only after a confirmed save, receipt triggers the existing
 * refresh, own echo ignored, debounce/coalesce, honest status, catch-up on
 * re-subscribe, and the hint carries nothing identifying.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const SRC80 = fs.readFileSync(path.join(ROOT, 'src/index/080-workload-render.js.part'), 'utf8');
let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed++; console.log('  ok  ' + m); };

function grab(name) {
  const at = INDEX.search(new RegExp('function\\s+' + name + '\\s*\\('));
  assert.ok(at >= 0, 'function not found: ' + name);
  let depth = 0;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    if (INDEX[j] === '{') depth++;
    else if (INDEX[j] === '}' && --depth === 0) return INDEX.slice(at, j + 1);
  }
  throw new Error('unbalanced ' + name);
}

// Wiring: the announce sits after the success validation, not in a failure path.
const persist = grab('_wlPersistPlanDate');
const throwAt = persist.indexOf('throw new Error((json && json.error)');
const annAt = persist.indexOf('wlAnnouncePlanSaved()');
ok(throwAt > 0 && annAt > throwAt, 'announce runs only after the saved row is validated');
ok(persist.split('wlAnnouncePlanSaved()').length === 2, 'announce appears exactly once in the save path');
ok(/import[\s\S]*wlAnnouncePlanSaved[\s\S]*from '\.\/070-workload-source\.js'/.test(SRC80), '080 imports the announce from 070');
ok(/planLive:\s*_wlPlanLive/.test(INDEX), 'wlV2Status exposes planLive status');
ok(!/table:\s*['"]workload_plan['"]/.test(INDEX), 'no postgres_changes subscription on workload_plan');

// Behaviour against a fake clock and channel.
let timers = [], now = 0;
const fakeSetTimeout = (fn, ms) => { const t = { fn, at: now + ms }; timers.push(t); return t; };
const fakeClearTimeout = t => { timers = timers.filter(x => x !== t); };
function advance(ms) {
  now += ms;
  for (;;) {
    const due = timers.filter(t => t.at <= now).sort((a, b) => a.at - b.at)[0];
    if (!due) break;
    timers = timers.filter(t => t !== due);
    due.fn();
  }
}
const ctx = { setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout, Math, Date, JSON, String, Object, console, Promise };
vm.createContext(ctx);
vm.runInContext(grab('wlCreatePlanLive') + ';this.wlCreatePlanLive=wlCreatePlanLive;', ctx);

function makeClient() {
  const c = { channels: [], removed: 0 };
  c.channel = (name, cfg) => {
    const ch = { name, cfg, sends: [], handlers: {}, statusCb: null };
    ch.on = (type, filter, cb) => { ch.handlers[type + ':' + filter.event] = cb; return ch; };
    ch.subscribe = cb => { ch.statusCb = cb; return ch; };
    ch.send = msg => { ch.sends.push(msg); return Promise.resolve('ok'); };
    c.channels.push(ch);
    return ch;
  };
  c.removeChannel = () => { c.removed++; };
  return c;
}
function makeStorage() {
  const log = [];
  return { log, setItem: (k, v) => log.push(['set', k, v]), removeItem: k => log.push(['rm', k]) };
}

(async () => {
  const client = makeClient(), storage = makeStorage();
  let refreshes = 0;
  const live = ctx.wlCreatePlanLive({
    getClient: async () => client, isActive: () => true,
    onRemote: () => { refreshes++; }, storage, debounceMs: 600, sendCoalesceMs: 250
  });
  ok(live.status().channelStatus === 'idle' && live.status().subscribed === false, 'status starts idle, not subscribed');
  await live.ensure();
  const ch = client.channels[0];
  ok(ch && ch.name === 'workload-plan' && ch.cfg.config.broadcast.self === false, 'subscribes to the workload-plan broadcast channel');
  ok(live.status().channelStatus === 'CONNECTING' && !live.status().subscribed, 'reports CONNECTING until the server confirms');
  await live.ensure();
  ok(client.channels.length === 1, 'ensure is idempotent');

  live.announce(); advance(250);
  ok(ch.sends.length === 0 && live.status().sendFailed === 1, 'no broadcast before SUBSCRIBED (counted honestly)');
  ok(storage.log.filter(e => e[0] === 'set').length === 1, 'same-browser storage hint written');

  ch.statusCb('SUBSCRIBED');
  ok(live.status().subscribed === true, 'status SUBSCRIBED after confirmation');
  ok(refreshes === 0 && live.status().catchUps === 0, 'first subscribe does not trigger a catch-up');

  live.announce(); live.announce(); live.announce(); advance(250);
  ok(ch.sends.length === 1, 'several saves coalesce into one broadcast');
  const hint = ch.sends[0].payload;
  ok(ch.sends[0].type === 'broadcast' && ch.sends[0].event === 'plan', 'broadcast event is plan');
  ok(Object.keys(hint).sort().join(',') === 'at,from,kind' && hint.kind === 'plan', 'hint carries only kind/at/opaque sender');

  ch.handlers['broadcast:plan']({ payload: hint }); advance(1000);
  ok(refreshes === 0 && live.status().echoesIgnored === 1, 'own echo does not refresh');

  const remote = { kind: 'plan', at: 'x', from: 'other-page' };
  ch.handlers['broadcast:plan']({ payload: remote }); advance(300);
  ch.handlers['broadcast:plan']({ payload: remote }); advance(300);
  ok(refreshes === 0, 'debounce holds while receipts keep arriving');
  advance(600);
  ok(refreshes === 1 && live.status().received === 2, 'two receipts -> one refresh via the existing path');
  ch.handlers['broadcast:plan']({ payload: { kind: 'other', from: 'x' } }); advance(1000);
  ok(refreshes === 1, 'unrelated payloads ignored');

  const KEY = 'syncview.workload.plan-live.v1';
  live.onStorage({ key: KEY, newValue: JSON.stringify(remote) }); advance(600);
  ok(refreshes === 2, 'storage hint from a sibling tab triggers the refresh');
  live.onStorage({ key: KEY, newValue: JSON.stringify(hint) }); advance(600);
  ok(refreshes === 2, 'own storage echo ignored');
  live.onStorage({ key: 'other', newValue: JSON.stringify(remote) }); advance(600);
  ok(refreshes === 2, 'other storage keys ignored');

  ch.statusCb('CHANNEL_ERROR', new Error('boom'));
  ok(!live.status().subscribed && /CHANNEL_ERROR/.test(live.status().lastError), 'error status reported, not subscribed');
  live.announce(); advance(250);
  ok(ch.sends.length === 1, 'no broadcast while the channel is down');
  ch.statusCb('SUBSCRIBED'); advance(600);
  ok(refreshes === 3 && live.status().catchUps === 1 && live.status().lastError === '', 'catch-up refresh on re-subscribe');

  ch.send = () => Promise.resolve('error');
  live.announce(); advance(250);
  await Promise.resolve(); await Promise.resolve();
  ok(live.status().sendFailed === 3, 'non-ok send result counted as failed');

  live.teardown();
  ok(client.removed === 1 && live.status().channelStatus === 'idle', 'teardown removes the channel');

  const c2 = makeClient();
  const l2 = ctx.wlCreatePlanLive({ getClient: async () => c2, isActive: () => false, onRemote() {} });
  await l2.ensure();
  ok(c2.channels.length === 0, 'no subscription when Workload is not open');

  console.log(`\nworkload-plan-live: ${passed} passed`);
})().catch(e => { console.error(e); process.exit(1); });
