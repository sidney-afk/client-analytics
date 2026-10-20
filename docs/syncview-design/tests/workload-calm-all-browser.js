'use strict';

/*
 * THE CALM WORKLOAD CALENDAR FOR EVERYONE: workload_calm_staff { "all": true } (session Calm Six, 2026-10-20).
 *
 * Part 1 runs the switch's own parsing and decision code (cut out of src/index/188-review-stage-switch.js.part) against
 * stubs: all:true reaches any signed-in staff member and never the client link, only the exact boolean true counts,
 * the old { "staff": [...] } shape behaves exactly as before, and the anti-flash hint carries an "all" marker.
 * Part 2 boots the real page (mocked backend, fictional data): all:true with nobody listed turns the calm calendar on,
 * the old shape still names the member, a wrong shape leaves the old calendar, and a browser that last saw an all:true
 * answer holds the loader while the switch read is on its way.
 *
 *   node docs/syncview-design/tests/workload-calm-all-browser.js
 */

const fs = require('fs');
const path = require('path');
const F = require('./workload-calm-fixture.js');

let checks = 0;
function expect(ok, message) {
  if (!ok) throw new Error('WORKLOAD_CALM_ALL ' + message);
  checks++;
}

/* ── Part 1: the decision code ─────────────────────────────────────────────── */
function between(src, from, to) {
  const a = src.indexOf(from), b = src.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('WORKLOAD_CALM_ALL cannot find ' + from + ' .. ' + to);
  return src.slice(a, b);
}
function unitPart() {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'index', '188-review-stage-switch.js.part'), 'utf8');
  const code = between(src, 'function _rsParse(rows)', 'async function _rsFetch()')
    + between(src, 'function _rsListed(set)', 'function svRsHelpUrl()');
  const make = (ctx) => new Function('ctx', `
    const _calRuntimeFlagRawMembers = () => []; const _calRuntimeFlagSlug = x => x;
    const _syncviewStaffIdentityForHeaders = () => ctx.who;
    const localStorage = ctx.storage;
    const _rsPrime = () => {};
    let _rsFlags = ctx.flags, _rsFlagPromise = {}, _rsFlagFailed = false;
    const _isClientLink = ctx.client;
    ${code}
    return { parse: _rsParse, on: svWorkloadCalmOn, pending: svWorkloadCalmPending, save: _wlCalmHintSave, setFlags: f => { _rsFlags = f; } };
  `)(ctx);
  const mem = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
  const row = value => [{ key: 'workload_calm_staff', value }];
  const run = (value, o) => {
    const ctx = { who: o.who === undefined ? { member: { id: 'x1', name: 'Some Person' } } : o.who, client: !!o.client, storage: o.storage || mem(), flags: null };
    const api = make(ctx);
    const parsed = api.parse(row(value));
    api.setFlags(parsed);
    return { api, parsed, ctx, on: api.on() };
  };
  expect(run({ all: true }, {}).on === true, 'all:true turns it on for any signed-in staff member');
  expect(run({ all: true, staff: [] }, {}).on === true, 'all:true with an empty list is on');
  expect(run({ all: true, staff: ['someone-else'] }, {}).on === true, 'all:true together with a list is on for an unlisted member');
  expect(run({ all: true }, { client: true }).on === false, 'all:true never reaches the client link');
  expect(run({ all: true }, { who: null }).on === false, 'all:true is off until the server has said who is signed in');
  expect(run({ all: true }, { who: { member: null } }).on === false, 'all:true is off for someone who is not staff');
  for (const bad of ['true', 1, 'yes', null, [true], false, {}]) {
    expect(run({ all: bad }, {}).on === false, 'all:' + JSON.stringify(bad) + ' is not the exact boolean true: off');
  }
  expect(run([true], {}).on === false && run('all', {}).on === false && run(true, {}).on === false, 'a wrong shape (list, string, boolean) is off');
  expect(run({ staff: ['x1'] }, {}).on === true, 'the old shape still turns it on for a listed id');
  expect(run({ staff: ['some person'] }, {}).on === true, 'the old shape still turns it on for a listed name');
  expect(run({ staff: ['someone-else'] }, {}).on === false, 'the old shape still leaves an unlisted member on the old calendar');
  expect(run({ staff: ['x1'] }, { client: true }).on === false, 'the old shape still never reaches the client link');
  expect(run({ staff: ['*'] }, {}).on === false, 'a "*" entry in staff is not a wildcard');
  // The hint.
  const storage = (() => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; })();
  let r = run({ all: true }, { storage });
  r.api.save(r.parsed);
  const stored = JSON.parse(storage.getItem('sv-wl-calm-staff'));
  expect(Array.isArray(stored) && stored.includes('*'), 'an all:true answer is kept as a hint with an all marker');
  const pending = (client, who) => {
    const ctx = { who, client, storage, flags: { loaded: false, calm: new Set(), calmAll: false } };
    return make(ctx).pending();
  };
  expect(pending(false, { member: { id: 'newcomer', name: 'New Person' } }) === true, 'the hint holds the loader for any signed-in staff member');
  expect(pending(true, { member: { id: 'newcomer', name: 'New Person' } }) === false, 'the hint never holds the loader on the client link');
  expect(pending(false, null) === false, 'the hint does not hold the loader before the server has said who is signed in');
  r = run({ staff: ['x1'] }, { storage });
  r.api.save(r.parsed);
  expect(!JSON.parse(storage.getItem('sv-wl-calm-staff')).includes('*'), 'the old shape stores no all marker');
  expect(pending(false, { member: { id: 'newcomer', name: 'New Person' } }) === false, 'the old-shape hint still holds the loader only for the listed member');
  expect(pending(false, { member: { id: 'x1', name: 'Some Person' } }) === true, 'the old-shape hint still holds the loader for the listed member');
  r = run({ all: false }, { storage });
  r.api.save(r.parsed);
  expect(storage.getItem('sv-wl-calm-staff') === null, 'an answer naming nobody clears the hint');
}

/* ── Part 2: the real page ─────────────────────────────────────────────────── */
const isCalm = page => page.evaluate(() => !!document.querySelector('.workload-view.wl-calm'));

(async () => {
  unitPart();
  console.log('unit part: ' + checks + ' checks passed');

  const scenarios = [
    { name: 'all:true, nobody listed', value: { all: true }, calm: true },
    { name: 'all:true with another person listed', value: { all: true, staff: ['someone-else'] }, calm: true },
    { name: 'old shape naming the member', value: { staff: ['qa_staff'] }, calm: true },
    { name: 'old shape naming someone else', value: { staff: ['someone-else'] }, calm: false },
    { name: 'all as a string', value: { all: 'true' }, calm: false },
    { name: 'all:false', value: { all: false }, calm: false },
  ];
  for (const s of scenarios) {
    console.log('--- ' + s.name);
    const h = await F.launchCalmBoard({ flagRows: [{ key: 'workload_calm_staff', value: s.value }] });
    try {
      await h.page.waitForTimeout(900);
      expect(await isCalm(h.page) === s.calm, s.name + ': calm calendar ' + (s.calm ? 'on' : 'off'));
      expect(h.state.pageErrors.length === 0, s.name + ': page errors ' + h.state.pageErrors[0]);
    } finally { await h.close(); }
  }

  console.log('--- the hint holds the loader for an all:true browser');
  const h = await F.launchCalmBoard({ flagRows: [{ key: 'workload_calm_staff', value: { all: true } }] });
  try {
    const p = h.page;
    await p.waitForTimeout(900);
    expect(await isCalm(p), 'first visit: calm on');
    const hint = await p.evaluate(() => JSON.parse(localStorage.getItem('sv-wl-calm-staff') || 'null'));
    expect(Array.isArray(hint) && hint.includes('*'), 'the visit left an all marker in the hint');
    // The next visit: the switch read is slow, the loader must stand in for the calendar until it answers.
    let release;
    const gate = new Promise(res => { release = res; });
    await h.context.route('**/rest/v1/syncview_runtime_flags**', async route => {
      const auth = { key: 'prod_authority', value: { video: 'syncview', graphics: 'syncview' } };
      if (!/review_stage_client_pages/.test(route.request().url())) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([auth]) });
      await gate;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([auth, { key: 'workload_calm_staff', value: { all: true } }]) });
    });
    const reload = p.goto('http://127.0.0.1:' + h.server.address().port + '/#workload', { waitUntil: 'domcontentloaded' });
    let held = false, painted = false;
    for (let i = 0; i < 40 && !held; i++) {
      await p.waitForTimeout(100);
      const s = await p.evaluate(() => ({ has: !!document.querySelector('.workload-view'), hold: !!document.querySelector('.workload-view.wl-calm-hold'), day: !!document.querySelector('.workload-day') }));
      if (s.day) painted = true;
      held = s.hold;
    }
    expect(held, 'while the read is on its way the loader is held');
    expect(!painted && await p.evaluate(() => !document.querySelector('.workload-day')), 'the old calendar was not painted meanwhile');
    release();
    await reload;
    await p.waitForTimeout(1200);
    expect(await isCalm(p), 'once answered: calm on, with no swap back');
    expect(await p.evaluate(() => !document.querySelector('.workload-view.wl-calm-hold')), 'the loader is gone');
  } finally { await h.close(); }

  console.log('workload-calm-all-browser: all ' + checks + ' checks passed');
})().catch(e => { console.error(e.message || e); process.exit(1); });
