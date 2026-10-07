'use strict';
/* today-no-flicker.js -- proves Today never flashes on its way from the grey
 * shape to the saved copy to the fresh list, and that rows which did not
 * change are never redrawn (owner, 2026-10-07).
 *
 *   node qa/today/today-no-flicker.js [--profile=desktop,phone] [--frames=<dir>]
 *
 * Serves this checkout and answers EVERY backend call locally with fixture
 * data (fixture names only; this repo is public). Nothing reaches the live
 * backend. Per profile:
 *
 *   1. First visit: no saved copy. Today loads, and leaves its saved page.
 *   2. Reload with the saved page. The staff check answers after 600 ms and
 *      Today's reads after 1500 ms; the fresh answer differs from the saved
 *      one by one renamed row, one row gone and one row new.
 *   3. A live change renames one more row.
 *
 * Checked on every animation frame of step 2: the screen always shows the
 * grey shape, the saved copy or the fresh list, never a blank and never the
 * saved copy before the staff check has passed. Checked across steps 2 and 3:
 * every row that did not change is the SAME element from the saved paint to
 * the end, and no mutation ever lands inside it; only the changed rows are
 * written. With --frames, real screen frames are saved at each change of
 * state, for a person to look at.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const arg = (k, d) => { const m = process.argv.find(a => a.startsWith('--' + k + '=')); return m ? m.slice(k.length + 3) : d; };
const PROFILES = arg('profile', 'desktop,phone').split(',');
const FRAMES = arg('frames', '');

const MEMBER = { id: 'm_fixture_admin', name: 'Fixture Admin', role: 'admin', team: null };
const NOW = new Date().toISOString();
const iso = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const CLIENTS = [
  { slug: 'fixture-alpha', display_name: 'Alpha Fixture', active: true, kind: 'client' },
  { slug: 'fixture-beta', display_name: 'Beta Fixture', active: true, kind: 'client' },
];
const del = (id, title, slug) => ({ id, client_slug: slug, team: 'video', kind: 'video', title, status: 'smm_approval', status_at: NOW, assignee_id: null, due_date: iso(3), origin: 'calendar', card_id: null, linear_issue_uuid: null });
const V1 = [del('d1', 'Fixture reel one', 'fixture-alpha'), del('d2', 'Fixture reel two', 'fixture-beta'), del('d3', 'Fixture reel three', 'fixture-alpha'), del('d4', 'Fixture reel four', 'fixture-beta'), del('d5', 'Fixture reel five', 'fixture-alpha')];
// Fresh: d2 renamed, d4 gone, d6 new; d1, d3, d5 unchanged.
const V2 = [V1[0], { ...V1[1], title: 'Fixture reel two, recut' }, V1[2], V1[4], del('d6', 'Fixture reel six', 'fixture-beta')];
// Live change: d3 renamed.
const V3 = [V2[0], V2[1], { ...V2[2], title: 'Fixture reel three, new hook' }, V2[3], V2[4]];
const UNCHANGED_2 = ['d:d1', 'd:d3', 'd:d5'];
const UNCHANGED_3 = ['d:d1', 'd:d5'];

let failures = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL  ') + m); if (!c) failures++; };

function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const f = path.join(ROOT, path.normalize(p));
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(''); }
      const type = f.endsWith('.js') ? 'text/javascript' : f.endsWith('.png') ? 'image/png' : f.endsWith('.css') ? 'text/css' : 'text/html';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(fs.readFileSync(f));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// What is on screen, sampled every animation frame (page side).
function recorder() {
  window.__frames = [];
  window.__muts = [];
  window.__tags = {};
  const vis = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const state = () => {
    // The browser has not yet read the page's own markup (the styles come
    // first): this is the page loading, the same on every tab, not Today.
    if (!document.getElementById('content')) return 'page-loading';
    const gate = document.getElementById('staffGateOverlay');
    if (gate && getComputedStyle(gate).display !== 'none') return 'gate';
    const root = document.getElementById('tdyRoot');
    const early = document.querySelector('[data-tdy-early]');
    const box = (root && vis(root)) ? root : (early && vis(early) ? early : null);
    if (box) {
      if (box.querySelector('.tdy-skel')) return 'grey';
      if (box.querySelector('.tdy-big, .tdy-win')) {
        const u = box.querySelector('.tdy-upd');
        return (u && vis(u)) ? 'saved' : 'fresh';
      }
      return 'blank';
    }
    const boot = document.querySelector('.boot-skeleton-today');
    if (boot && vis(boot)) return 'grey';
    return 'blank';
  };
  const tick = () => {
    const s = state();
    const last = window.__frames[window.__frames.length - 1];
    if (!last || last.s !== s) window.__frames.push({ s, t: Date.now(), verified: !!window.__verifiedAt });
    // Tag the saved rows the first time they are on screen.
    if (s === 'saved' && !window.__tagged) {
      window.__tagged = true;
      document.querySelectorAll('.tdy-rw[data-k]').forEach(r => { window.__tags[r.getAttribute('data-k')] = r; r.__fixtureTag = 1; });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  new MutationObserver(list => {
    for (const m of list) {
      const t = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      const row = t && t.closest ? t.closest('.tdy-rw[data-k]') : null;
      if (row && row.__fixtureTag) window.__muts.push(row.getAttribute('data-k'));
    }
  }).observe(document, { childList: true, subtree: true, attributes: true, characterData: true });
}

async function stub(context, origin, data, delays) {
  await context.route('**/*', route => (route.request().url().startsWith(origin) ? route.continue() : route.abort()));
  const json = (route, body, wait) => setTimeout(() => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) }).catch(() => {}), wait || 0);
  await context.route('**/functions/v1/key-verify', route => json(route, { ok: true, role: MEMBER.role, member: MEMBER }, delays.verify));
  await context.route('**/rest/v1/team_members**', route => json(route, route.request().url().includes('select=email') ? [{ email: '' }] : [MEMBER], delays.data));
  await context.route('**/rest/v1/clients**', route => json(route, CLIENTS, delays.data));
  await context.route('**/rest/v1/calendar_posts**', route => json(route, [], delays.data));
  await context.route('**/rest/v1/production_deliverables_browser_v1**', route => {
    const u = decodeURIComponent(route.request().url());
    if (u.includes('raw_issue_parent_id')) return json(route, [], delays.data);
    return json(route, u.includes('smm_approval') && u.includes('todo') ? data.rows : [], delays.data);
  });
  await context.route('**/functions/v1/smm-weekly-reports**', route => json(route, { ok: true, managers: [], also_sees: [] }, delays.data));
}

async function runProfile(browser, origin, profile) {
  const phone = profile === 'phone';
  const context = await browser.newContext(phone
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { viewport: { width: 1440, height: 900 } });
  await context.addInitScript(id => {
    if (!sessionStorage.getItem('fx_seeded')) {
      sessionStorage.setItem('fx_seeded', '1');
      localStorage.setItem('syncview_staff_identity_v1', JSON.stringify(id));
      sessionStorage.setItem('syncview_staff_identity_prompted_v1', '1');
    }
  }, { key: 'fixture-role-key', role: MEMBER.role, member: MEMBER, verified_at: NOW });
  await context.addInitScript(recorder);
  // Mark the moment the staff check answers, page side.
  await context.addInitScript(() => {
    const f = window.fetch;
    window.fetch = function (u) {
      const p = f.apply(this, arguments);
      if (String(u).includes('/functions/v1/key-verify')) p.then(() => { if (!window.__verifiedAt) window.__verifiedAt = Date.now(); }, () => {});
      return p;
    };
  });
  const data = { rows: V1 };
  const delays = { verify: 0, data: 0 };
  await stub(context, origin, data, delays);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  if (phone) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  // 1. First visit.
  await page.goto(origin + '/index.html#today', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__frames.some(f => f.s === 'fresh'), null, { timeout: 30000 });
  await page.waitForTimeout(500);
  ok(await page.evaluate(() => !!localStorage.getItem('syncview_today_paint_v1')), profile + ': a first visit leaves the saved page for the next reload');

  // 2. Reload: slow check, slower reads, a changed answer.
  data.rows = V2; delays.verify = 600; delays.data = 1500;
  const shots = [];
  let shooting = !!FRAMES;
  if (shooting) {
    cdp.on('Page.screencastFrame', async f => {
      shots.push({ t: f.metadata.timestamp * 1000, data: f.data });
      cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    });
  }
  const t0 = Date.now();
  if (shooting) await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, everyNthFrame: 1 });
  await page.goto(origin + '/index.html#today', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__frames.some(f => f.s === 'fresh'), null, { timeout: 30000 });
  await page.waitForTimeout(600);
  const r2 = await page.evaluate(keys => ({
    frames: window.__frames,
    verifiedAt: window.__verifiedAt || 0,
    muts: window.__muts.slice(),
    same: keys.map(k => { const now = document.querySelector('.tdy-rw[data-k="' + k + '"]'); return !!now && now === window.__tags[k]; }),
    titles: [...document.querySelectorAll('.tdy-rw .tdy-tt')].map(e => e.textContent)
  }), UNCHANGED_2);
  const seq = r2.frames.map(f => f.s);
  console.log('  ' + profile + ' reload, state per frame change: ' + r2.frames.map(f => f.s + '@' + (f.t - t0) + 'ms').join(' > '));
  ok(!seq.includes('blank'), profile + ': once the page markup is read, no frame is blank (grey shape, saved copy or fresh list on every frame)');
  const loading = r2.frames.filter(f => f.s === 'page-loading');
  if (loading.length) console.log('  ' + profile + ': before the page markup is read, the browser shows the page background for ' + (r2.frames.find(f => f.s !== 'page-loading').t - loading[0].t) + ' ms (not Today; the same on main)');
  const firstSaved = r2.frames.find(f => f.s === 'saved');
  ok(!!firstSaved && r2.verifiedAt && firstSaved.t >= r2.verifiedAt, profile + ': the saved copy appears only after the staff check has passed');
  const shown = seq.filter(x => x !== 'page-loading');
  ok(JSON.stringify(shown.filter((x, i) => x !== shown[i - 1])) === JSON.stringify(['grey', 'saved', 'fresh']), profile + ': the screen goes grey shape, saved copy, fresh list, and never back');
  ok(r2.same.every(Boolean), profile + ': the three unchanged rows are the same elements from the saved copy to the fresh list');
  ok(!r2.muts.some(k => UNCHANGED_2.includes(k)), profile + ': nothing inside an unchanged row was rewritten');
  ok(r2.titles.includes('Fixture reel two, recut') && r2.titles.includes('Fixture reel six') && !r2.titles.includes('Fixture reel four'), profile + ': the renamed row, the new row and the removed row are all right');

  // 3. A live change renames one more row.
  data.rows = V3; delays.verify = 0; delays.data = 300;
  await page.evaluate(() => { window.__muts = []; });
  await page.evaluate(() => window.mountTodayView(true));
  await page.waitForFunction(() => [...document.querySelectorAll('.tdy-rw .tdy-tt')].some(e => e.textContent === 'Fixture reel three, new hook'), null, { timeout: 15000 });
  await page.waitForTimeout(300);
  const r3 = await page.evaluate(keys => ({
    muts: window.__muts.slice(),
    same: keys.map(k => { const now = document.querySelector('.tdy-rw[data-k="' + k + '"]'); return !!now && now === window.__tags[k]; }),
    frames: window.__frames.slice(-3).map(f => f.s)
  }), UNCHANGED_3);
  ok(r3.same.every(Boolean) && !r3.muts.some(k => UNCHANGED_3.includes(k)), profile + ': a live change rewrites only the changed row; the others are untouched');
  ok(r3.muts.includes('d:d3'), profile + ': and the changed row is updated in place');
  if (shooting) {
    await cdp.send('Page.stopScreencast').catch(() => {});
    // One frame per change of state, plus the frames just before and after
    // each change, so a person can see there is nothing in between.
    const marks = [];
    r2.frames.forEach((f, i) => { if (i > 0) marks.push(f.t); });
    const pick = new Set();
    const at = t => shots.reduce((best, s, i) => (Math.abs(s.t - t) < Math.abs(shots[best].t - t) ? i : best), 0);
    if (shots.length) {
      pick.add(at(t0 + 150));
      for (const m of marks) { const i = at(m); [i - 1, i, i + 1].forEach(j => { if (j >= 0 && j < shots.length) pick.add(j); }); }
      pick.add(shots.length - 1);
    }
    fs.mkdirSync(FRAMES, { recursive: true });
    const stateAt = t => { let s = 'grey'; for (const f of r2.frames) if (f.t <= t) s = f.s; return s; };
    const list = [...pick].sort((a, b) => a - b).map((i, n) => {
      const s = shots[i];
      const name = profile + '-' + String(n).padStart(2, '0') + '-' + Math.max(0, Math.round(s.t - t0)) + 'ms-' + stateAt(s.t) + '.jpg';
      fs.writeFileSync(path.join(FRAMES, name), Buffer.from(s.data, 'base64'));
      return name;
    });
    console.log('  ' + profile + ': ' + shots.length + ' screen frames recorded, ' + list.length + ' saved to ' + FRAMES);
  }
  await context.close();
}

(async () => {
  const server = await serve();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    for (const p of PROFILES) await runProfile(browser, origin, p);
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures ? `\ntoday-no-flicker: ${failures} check(s) failed` : '\ntoday-no-flicker: all checks passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
