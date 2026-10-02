// clients_onboarding_live.js — ON DEMAND, against the LIVE backend, TEST CLIENT ONLY.
// The onboarding sections on a Clients profile (fragment 324-client-onboarding-panel): open the
// test client, check the checklist (27 steps), the Resources and the HubSpot block, then change
// ONLY the test client's two OPTIONAL steps and put them back:
//   - mark the last optional step done with evidence, reload the page, see it still done, reopen it;
//   - skip the other optional step in one click, reopen it.
// Every other client is untouched; every other step is untouched. The checklist's history table is
// append-only by design, so these changes leave a few history rows for the test client.
//
// COL_READONLY=1 runs only the reading part.
// Needs SYNCVIEW_ROLE_KEY (an ADMIN role key) and SYNCVIEW_ACTOR; serves the working-tree build locally.
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const L = require('../sxr_courier_lib.js');
const { TEST_CLIENT } = require('../test-client-entry.js');

const SUPA = 'https://uzltbbrjidmjwwfakwve.supabase.co';
const ROOT = path.resolve(__dirname, '..', '..');
const TEST = TEST_CLIENT.slug;
const REAL = {};
const results = [];
const ok = (c, m, x) => { results.push(!!c); console.log((c ? '✓  ' : '✗  ') + m + (x ? '  [' + String(x).slice(0, 220) + ']' : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(250); } return false; }

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let file = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    file = path.normalize(file).replace(/^([.][\\/])+/, '');
    const full = path.join(ROOT, file);
    if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(full).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(full).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function realIdentity() {
  const key = String(process.env.SYNCVIEW_ROLE_KEY || process.env.SYNCVIEW_STAFF_KEY || '').trim();
  const actor = String(process.env.SYNCVIEW_ACTOR || '').trim();
  if (!key || !actor) throw new Error('SYNCVIEW_ROLE_KEY and SYNCVIEW_ACTOR are required');
  const pub = L.KEY;
  const rows = await (await fetch(`${SUPA}/rest/v1/team_members?name=eq.${encodeURIComponent(actor)}&select=id`, { headers: { apikey: pub, authorization: 'Bearer ' + pub } })).json();
  const verified = await (await fetch(`${SUPA}/functions/v1/key-verify`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-syncview-key': key }, body: JSON.stringify({ surface: 'staff-boot', member: { id: rows[0] && rows[0].id } }) })).json();
  if (!verified || verified.ok !== true) throw new Error('key-verify refused the runner key');
  if (verified.role !== 'admin') throw new Error('the runner key is not an admin key (role: ' + verified.role + ')');
  REAL.identity = JSON.stringify({ key, role: verified.role, member: verified.member, verified_at: new Date().toISOString() });
}

// Safety net: whatever happened above, leave the test client's two optional steps at to-do, using the same
// admin calls the page makes. Only the test client, only optional steps, only back to to-do.
async function restoreOptionalSteps() {
  const ident = JSON.parse(REAL.identity);
  const call = async body => (await fetch(`${SUPA}/functions/v1/client-onboarding`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-syncview-key': ident.key }, body: JSON.stringify(Object.assign({ member_id: ident.member.id, slug: TEST }, body)) })).json();
  const got = await call({ action: 'get' });
  let restored = 0;
  for (const st of (got.steps || []).filter(x => !x.required && x.status !== 'todo')) {
    const r = await call({ action: 'set_step', step_key: st.step_key, status: 'todo', expected_updated_at: st.updated_at });
    if (r && r.ok) restored++;
  }
  const after = await call({ action: 'get' });
  const left = (after.steps || []).filter(x => !x.required && x.status !== 'todo').length;
  console.log(`   restore: put ${restored} optional step(s) back to to-do; ${left} still changed`);
  return left === 0;
}

async function openTestClient(browser, origin, width, requests) {
  const phone = width < 768;
  const ctx = await browser.newContext({ viewport: { width, height: phone ? 844 : 900 }, isMobile: phone, hasTouch: phone, ignoreHTTPSErrors: true });
  await ctx.addInitScript(id => { try { localStorage.setItem('syncview_staff_identity_v1', id); sessionStorage.setItem('syncview_kasper_unlocked', 'ok'); sessionStorage.setItem('syncview_staff_identity_prompted_v1', '1'); } catch (e) {} }, REAL.identity);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e && e.message)));
  p.on('request', r => {
    if (r.method() === 'GET' || r.method() === 'OPTIONS') return;
    const u = new URL(r.url());
    if (!/supabase\.co$/.test(u.hostname)) return;
    let action = '';
    try { action = (JSON.parse(r.postData() || '{}').action) || ''; } catch (e) {}
    const pth = u.pathname.replace('/functions/v1/', '');
    if (pth === 'key-verify' || pth === 'analytics-read') return; // the page's own sign-in check and client list read
    requests.push({ path: pth, action, body: r.postData() || '' });
  });
  p.on('dialog', d => d.accept());
  await p.goto(origin + '/index.html?Kasper=1#kasper/clients', { waitUntil: 'domcontentloaded', timeout: 90000 });
  ok(await p.waitForSelector('.ca-list .ca-row', { timeout: 90000 }).then(() => true, () => false), `${width}: the Clients list loads`);
  await p.fill('#caSearch', TEST);
  await sleep(300);
  await p.click(`.ca-row[onclick*="'${TEST}'"]`);
  const drew = await p.waitForSelector('.cb-step', { timeout: 60000 }).then(() => true, () => false);
  ok(drew, `${width}: the test client's checklist draws from the live function`);
  return { ctx, p, errs, drew };
}

(async () => {
  const px = process.env.HTTPS_PROXY || process.env.https_proxy;
  const browser = await L.PW.chromium.launch({ headless: true, args: ['--ignore-certificate-errors'].concat(px ? ['--proxy-server=' + px, '--proxy-bypass-list=127.0.0.1;localhost'] : []) });
  const server = await serve();
  const origin = 'http://127.0.0.1:' + server.address().port;
  try {
    await realIdentity();
    if (process.env.COL_RESTORE_ONLY === '1') return;
    const requests = [];
    const t = await openTestClient(browser, origin, 1440, requests);
    const p = t.p;
    if (t.drew) {
      await sleep(1500);
      const info = await p.evaluate(() => {
        const items = [...document.querySelectorAll('.cb-step')];
        const badges = items.map(e => e.querySelector('.cb-badge').innerText);
        const res = [...document.querySelectorAll('.cb-res-row')].map(r => r.querySelector('.cb-pill').innerText);
        return {
          steps: items.length, req: badges.filter(b => b === 'Required').length, opt: badges.filter(b => b === 'Optional').length,
          nums: items.map(e => e.querySelector('.cb-num').innerText).join(','),
          found: res.filter(x => x === 'Found').length, missing: res.filter(x => x === 'Missing').length, unknown: res.filter(x => x === 'Unknown').length, notNeeded: res.filter(x => x === 'Not needed').length,
          summary: (document.querySelector('.cb-summary') || {}).innerText || '',
          hubspot: ((document.querySelector('#cbHubspot') || {}).innerText || '').replace(/\s+/g, ' '),
          error: !!document.querySelector('#cbChecklist .cb-msg.is-error'),
          optionalKeys: items.filter(e => e.classList.contains('is-optional')).map(e => e.getAttribute('data-step')),
          optionalStates: items.filter(e => e.classList.contains('is-optional')).map(e => e.className),
        };
      });
      ok(info.steps === 27, 'the live catalog has 27 steps', info.steps);
      ok(info.req === 25 && info.opt === 2, '25 required and 2 optional', `${info.req} / ${info.opt}`);
      ok(info.nums === Array.from({ length: 27 }, (_, i) => String(i + 1)).join(','), 'the steps are in order 1 to 27');
      ok(!info.error, 'no error message on the checklist');
      ok(info.found + info.missing + info.unknown + info.notNeeded >= 25, 'the Resources list draws', `found ${info.found}, missing ${info.missing}, unknown ${info.unknown}, not needed ${info.notNeeded}`);
      ok(/HubSpot/.test(info.hubspot) && /Contract/.test(info.hubspot) && /First payment/.test(info.hubspot), 'the HubSpot block draws with deal, contract and payment', info.hubspot);
      console.log('   summary: ' + info.summary.replace(/\s+/g, ' '));
      ok(requests.length === 0 || requests.every(r => r.path === 'client-onboarding' || r.path === 'client-hubspot-sync'), 'opening the client sent only the two onboarding calls', requests.map(r => r.path + ':' + r.action).join(', '));
      const reads = requests.filter(r => r.path === 'client-onboarding' && r.action === 'get').length;
      const refreshes = requests.filter(r => r.path === 'client-hubspot-sync' && r.action === 'refresh').length;
      ok(reads >= 1 && refreshes === 1, 'one checklist read and one HubSpot refresh on open', `reads ${reads}, refreshes ${refreshes}`);
      ok(info.optionalKeys.length === 2, 'two optional steps found to exercise', info.optionalKeys.join(', '));

      if (process.env.COL_READONLY === '1') {
        console.log('   (COL_READONLY=1: nothing was changed)');
      } else if (info.optionalKeys.length === 2 && info.optionalStates.every(c => /is-todo/.test(c))) {
        const [skipKey, doneKey] = info.optionalKeys; // position 25, then 27
        // optional step: mark done with evidence, reload, still done, reopen
        await p.click(`[data-step="${doneKey}"] button:has-text("Mark done")`);
        await p.fill(`#cbEv_${doneKey}`, 'qa-live-pass-evidence');
        await p.click(`[data-step="${doneKey}"] .cb-form button:has-text("Mark done")`);
        ok(await p.waitForSelector(`[data-step="${doneKey}"].is-done`, { timeout: 30000 }).then(() => true, () => false), 'Mark done saved on the live function', doneKey);
        await sleep(1500);
        ok(/qa-live-pass-evidence/.test(await p.$eval(`[data-step="${doneKey}"]`, e => e.innerText).catch(() => '')), 'the evidence shows on the done step');
        await p.goto(origin + '/index.html?Kasper=1#kasper/clients', { waitUntil: 'domcontentloaded', timeout: 90000 });
        await p.waitForSelector('.ca-list .ca-row', { timeout: 90000 });
        await p.fill('#caSearch', TEST); await sleep(300);
        await p.click(`.ca-row[onclick*="'${TEST}'"]`);
        await p.waitForSelector(`[data-step="${doneKey}"]`, { timeout: 60000 });
        ok(await p.$eval(`[data-step="${doneKey}"]`, e => e.classList.contains('is-done')).catch(() => false), 'after a reload the step is still done (it is saved, not just drawn)');
        await p.click(`[data-step="${doneKey}"] button:has-text("Reopen")`);
        ok(await p.waitForSelector(`[data-step="${doneKey}"].is-todo`, { timeout: 30000 }).then(() => true, () => false), 'Reopen put the step back to to-do');
        // other optional step: one-click skip, reopen
        await p.click(`[data-step="${skipKey}"] button:has-text("Skip this optional step")`);
        ok(await p.waitForSelector(`[data-step="${skipKey}"].is-skipped`, { timeout: 30000 }).then(() => true, () => false), 'one-click skip of an optional step saved', skipKey);
        await sleep(1500);
        ok(/Skipped \(optional step\)/.test(await p.$eval(`[data-step="${skipKey}"]`, e => e.innerText).catch(() => '')), 'the skipped step shows its automatic note');
        await p.click(`[data-step="${skipKey}"] button:has-text("Reopen")`);
        ok(await p.waitForSelector(`[data-step="${skipKey}"].is-todo`, { timeout: 30000 }).then(() => true, () => false), 'Reopen put the skipped step back to to-do');
        const writes = requests.filter(r => !(r.path === 'client-onboarding' && ['get', 'set_step'].includes(r.action)) && !(r.path === 'client-hubspot-sync' && r.action === 'refresh'));
        ok(writes.length === 0, 'nothing but the onboarding calls was sent', writes.map(r => r.path + ':' + r.action).join(', '));
        const sets = requests.filter(r => r.action === 'set_step');
        ok(sets.length === 4 && sets.every(r => JSON.parse(r.body).slug === TEST), 'four step changes (done, reopen, skip, reopen), every one for the test client only', sets.length);
      } else {
        ok(false, 'the optional steps were not both at to-do at the start; nothing was changed');
      }
    }
    ok(t.errs.length === 0, 'no app errors on desktop', t.errs[0]);
    await t.ctx.close();

    // phone, read only
    const phoneReq = [];
    const ph = await openTestClient(browser, origin, 390, phoneReq);
    if (ph.drew) {
      await sleep(1500);
      const m = await ph.p.evaluate(() => {
        const W = document.documentElement.clientWidth;
        const vis = [...document.querySelectorAll('#caOnboarding button, #caOnboarding a')].filter(e => e.getClientRects().length);
        return { W, sw: document.documentElement.scrollWidth, small: vis.filter(e => e.getBoundingClientRect().height < 44).length, n: vis.length };
      });
      ok(m.sw <= m.W, 'phone: nothing scrolls sideways', `${m.sw} / ${m.W}`);
      ok(m.small === 0 && m.n > 0, 'phone: every onboarding control is at least 44px tall', `${m.small} small of ${m.n}`);
      ok(phoneReq.every(r => r.path === 'client-onboarding' ? r.action === 'get' : r.path === 'client-hubspot-sync' && r.action === 'refresh'), 'phone: opening sent reads and one refresh only');
    }
    ok(ph.errs.length === 0, 'no app errors on the phone', ph.errs[0]);
    await ph.ctx.close();
  } catch (e) {
    ok(false, 'raised: ' + String(e && e.message || e).split('\n')[0].slice(0, 200));
  } finally {
    try { ok(await restoreOptionalSteps(), 'the test client\'s optional steps are back at to-do'); } catch (e) { ok(false, 'restore failed: ' + String(e && e.message || e).slice(0, 160)); }
    await browser.close();
    server.close();
    console.log(`\npass=${results.filter(Boolean).length} fail=${results.filter(x => !x).length} (test client only)`);
    process.exit(results.every(Boolean) ? 0 : 1);
  }
})();
