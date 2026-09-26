// kasper_client_search_recent.js — ON DEMAND. Kasper's Clients tab search
// lists the most recently opened clients first, then everyone never opened in
// alphabetical order. Read-only: it only OPENS the test client (no edits), at
// 1440 with a mouse and at 390 by touch.
'use strict';
const L = require('../sxr_courier_lib.js');
const { TEST_CLIENT } = require('../test-client-entry.js');

const TS = Date.now();
const SUPA = 'https://uzltbbrjidmjwwfakwve.supabase.co';
const ORIGIN = process.env.SYNCVIEW_ORIGIN || 'http://127.0.0.1:8000';
const REAL = {};
async function realIdentity() {
  const key = String(process.env.SYNCVIEW_ROLE_KEY || process.env.SYNCVIEW_STAFF_KEY || '').trim();
  const actor = String(process.env.SYNCVIEW_ACTOR || '').trim();
  if (!key || !actor) throw new Error('SYNCVIEW_ROLE_KEY and SYNCVIEW_ACTOR are required');
  const pub = L.KEY;
  const rows = await (await fetch(`${SUPA}/rest/v1/team_members?name=eq.${encodeURIComponent(actor)}&select=id`, { headers: { apikey: pub, authorization: 'Bearer ' + pub } })).json();
  const verified = await (await fetch(`${SUPA}/functions/v1/key-verify`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-syncview-key': key }, body: JSON.stringify({ surface: 'staff-boot', member: { id: rows[0] && rows[0].id } }) })).json();
  if (!verified || verified.ok !== true) throw new Error('key-verify refused the runner key');
  REAL.verified = verified;
  REAL.identity = JSON.stringify({ key, role: verified.role, member: verified.member, verified_at: new Date().toISOString() });
}
const results = [];
const ok = (c, m, x) => { results.push(!!c); console.log((c ? '✓  ' : '✗  ') + m + (x ? '  [' + String(x).slice(0, 160) + ']' : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(fn, ms) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(250); } return false; }

async function runAt(browser, width) {
  const phone = width < 768;
  const ctx = await browser.newContext({ viewport: { width, height: phone ? 844 : 900 }, isMobile: phone, hasTouch: phone, ignoreHTTPSErrors: true });
  await ctx.addInitScript(id => { try { localStorage.setItem('syncview_staff_identity_v1', id); sessionStorage.setItem('syncview_kasper_unlocked', 'ok'); sessionStorage.setItem('syncview_staff_identity_prompted_v1', '1'); localStorage.removeItem('syncview_kasper_clients_recent_v1'); } catch (e) {} }, REAL.identity);
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e && e.message)));
  await p.goto(ORIGIN + '/index.html?Kasper=1#kasper/clients', { waitUntil: 'domcontentloaded', timeout: 90000 });
  ok(await p.waitForSelector('.ca-list .ca-row', { timeout: 90000 }).then(() => true, () => false), `${width}: the Clients list loads`);
  const tap = async q => { const b = await p.evaluate(s => { const e = document.querySelector(s); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, q); if (!b) throw new Error('missing ' + q); await sleep(150); if (phone) await p.touchscreen.tap(b.x, b.y); else await p.mouse.click(b.x, b.y); };
  const search = async v => { await p.fill('#caSearch', v); await sleep(300); };
  const names = () => p.evaluate(() => [...document.querySelectorAll('.ca-list .ca-row')].map(b => b.getAttribute('onclick').match(/_caSelect\('([^']+)'/)[1]));
  const disp = () => p.evaluate(() => Object.fromEntries([...document.querySelectorAll('.ca-list .ca-row')].map(b => [b.getAttribute('onclick').match(/_caSelect\('([^']+)'/)[1], b.querySelector('.ca-row-name').textContent])));
  const alphaOk = async list => { const d = await disp(); const n = list.map(s => d[s]); return JSON.stringify(n) === JSON.stringify(n.slice().sort((x, y) => x.localeCompare(y, undefined, { sensitivity: 'base' }))); };
  await search('a');
  const before = await names();
  ok(before.includes(TEST) && before.length > 2, `${width}: a search matches the test client and others`, before.length);
  ok(await alphaOk(before), `${width}: with nothing opened yet, matches are alphabetical`);
  await search('');
  await search(TEST.slice(0, 6));
  await tap(`.ca-row[onclick*="'${TEST}'"]`);
  ok(await waitFor(() => p.evaluate(t => !!document.querySelector(`.ca-row.is-active[onclick*="'${t}'"]`), TEST), 8000), `${width}: tapping the test client opens it`);
  await search(''); await search('a');
  const after = await names();
  ok(after[0] === TEST, `${width}: after opening it, the test client is first in the search`);
  ok(await alphaOk(after.slice(1)), `${width}: clients never opened follow in alphabetical order`);
  await search('');
  const plain = await names();
  ok(plain.length >= after.length, `${width}: clearing the search shows the full list again`);
  if (phone) { const sw = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth); ok(sw <= 0, `${width}: nothing scrolls sideways`, sw); }
  ok(errs.length === 0, `${width}: no app errors`, errs[0]);
  await ctx.close();
}

const TEST = TEST_CLIENT.slug;
(async () => {
  const px = process.env.HTTPS_PROXY || process.env.https_proxy;
  const browser = await L.PW.chromium.launch({ headless: true, args: ['--ignore-certificate-errors'].concat(px ? ['--proxy-server=' + px, '--proxy-bypass-list=127.0.0.1;localhost'] : []) });
  try {
    await realIdentity();
    for (const w of (process.env.KCS_WIDTHS || '1440,390').split(',').map(Number)) await runAt(browser, w);
  } catch (e) {
    ok(false, 'raised: ' + String(e && e.message || e).split('\n')[0].slice(0, 160));
  } finally {
    await browser.close();
    console.log(`\npass=${results.filter(Boolean).length} fail=${results.filter(x => !x).length} (test client only, read-only)`);
    process.exit(results.every(Boolean) ? 0 : 1);
  }
})();
