'use strict';
/* today-first-paint-measure.js -- what the Today tab requests, in what order,
 * how long each takes, and when real data is on screen.
 *
 *   node qa/today/today-first-paint-measure.js [--target=live|local] [--root=<dir>]
 *        [--profile=desktop|phone] [--scenario=cold|stale] [--runs=5] [--json=path]
 *
 * target=live   https://syncview.synchrosocial.com (what people use today)
 * target=local  serves <root> (default: this checkout) over http on 127.0.0.1,
 *               gzip, against the live backend. Use --root to point at another
 *               checkout (for example a worktree of origin/main for "before").
 *
 * Signs in as the staff member the environment provides (SYNCVIEW_STAFF_KEY and
 * SYNCVIEW_ACTOR), read only: Today never writes. Nothing secret is printed and
 * request query values are stripped, so the report carries table names only.
 *
 * scenario=cold         no saved copy (a first visit)
 * scenario=stale        a saved copy written late yesterday, the morning case
 * scenario=warm         a saved copy from earlier today (a reload), with the saved
 *                       page too on builds that keep one
 * scenario=switch-cold  land on Calendar with no saved copy, then click Today
 * scenario=switch-warm  land on Calendar with today's saved copy, then click Today
 * scenario=switch-back  open Today, go to Calendar, come back to Today
 *
 * For the switch scenarios the marks are counted from the click, not from
 * navigation start; the pointer rests on the Today tab for 150 ms first, the
 * way a hand reaches for it.
 *
 * Marks (ms from navigation start, same clock as the request times):
 *   skeleton   grey loading shape painted
 *   saved      saved items painted before any fresh read landed
 *   fresh      fresh answer painted (the moment the saved copy is written back)
 *   savedIsOld the saved copy on screen was from an earlier calendar day
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const http = require('http');
const { chromium } = require('playwright');

const arg = (k, d) => { const m = process.argv.find(a => a.startsWith('--' + k + '='));
  return m ? m.slice(k.length + 3) : d; };
const TARGET = arg('target', 'local');
const ROOT = path.resolve(arg('root', path.join(__dirname, '..', '..')));
const PROFILES = arg('profile', 'desktop,phone').split(',');
const SCENARIOS = arg('scenario', 'cold,stale').split(',');
const RUNS = Math.max(1, parseInt(arg('runs', '5'), 10));
const JSON_OUT = arg('json', '');
const LIVE = 'https://syncview.synchrosocial.com';
const SUPA = 'https://uzltbbrjidmjwwfakwve.supabase.co';
const PUB = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_P4-NdUWJqjtACWZOB6LPEA_8GANHAUA';
const CACHE_KEY = 'syncview_today_cache_v1';

const PROFILE_DEF = {
  desktop: { name: 'desktop', ctx: { viewport: { width: 1440, height: 900 } }, net: null, cpu: 1 },
  phone: { name: 'phone, typical 4G', ctx: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    net: { latency: 60, down: 9e6 / 8, up: 9e6 / 8 }, cpu: 4 }
};
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

function serve(root) {
  const gz = new Map();
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    if (p === '/') p = '/index.html';
    const full = path.join(root, path.normalize(p));
    if (!full.startsWith(root) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    if (!gz.has(full)) gz.set(full, zlib.gzipSync(fs.readFileSync(full), { level: 6 }));
    res.writeHead(200, { 'content-type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream', 'content-encoding': 'gzip', 'cache-control': 'no-store' });
    res.end(gz.get(full));
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

async function staffIdentity() {
  const r = await fetch(SUPA + '/functions/v1/key-verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: PUB, 'X-Syncview-Key': process.env.SYNCVIEW_STAFF_KEY || '', 'X-Syncview-Actor': process.env.SYNCVIEW_ACTOR || '' },
    body: JSON.stringify({ surface: 'staff-boot' })
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || !j.member) throw new Error('staff sign-in failed (' + r.status + ')');
  return { key: process.env.SYNCVIEW_STAFF_KEY, role: j.role || j.member.role, member: j.member, verified_at: new Date().toISOString() };
}

// Page-side recorder, runs before any app script.
function recorder(cacheKey) {
  window.__tm = { skeleton: null, saved: null, fresh: null, savedIsOld: null, t0: 0 };
  const now = () => performance.now() - (window.__tm.t0 || 0);
  try {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      const m = window.__tm;
      if (k === cacheKey && m.fresh == null && (!m.t0 || m.armed)) m.fresh = now();
      return orig.call(this, k, v);
    };
  } catch (e) {}
  const scan = () => {
    const m = window.__tm;
    if (m.t0 && !m.armed) return;
    // The app's root, or the boot shell's saved paint (data-tdy-early).
    const root = document.getElementById('tdyRoot') || document.querySelector('[data-tdy-early]');
    if (!root) return;
    if (m.skeleton == null && root.querySelector('.tdy-skel')) m.skeleton = now();
    // A real day on screen: the count line, the all-clear card, a deck or a
    // walk-through card. Not the grey shape, not the error or sign-in card.
    const has = root.isConnected && !root.querySelector('.tdy-skel')
      && !!root.querySelector('.tdy-big, .tdy-win:not([role="alert"]) .tdy-ok, .tdy-deck, .tdy-focus');
    // Pages that mark a saved copy "Updating" (.tdy-upd): a list without the
    // mark, in the app's own root, is the fresh answer (it may be painted from
    // a read that finished before the click, so no save follows it).
    if (window.__tdyMarks == null && document.readyState !== 'loading') window.__tdyMarks = [...document.querySelectorAll('style')].some(x => x.textContent.indexOf('.tdy-upd') >= 0);
    if (has && root.id === 'tdyRoot' && m.fresh == null && !root.querySelector('.tdy-upd') && window.__tdyMarks) m.fresh = now();
    if (has && !root.querySelector('.tdy-skel')) {
      if (m.fresh == null && m.saved == null) {
        m.saved = now();
        try {
          const c = JSON.parse(localStorage.getItem(cacheKey) || 'null');
          const d = new Date(Number(c && c.at));
          const t = new Date();
          m.savedIsOld = !!c && (d.getFullYear() !== t.getFullYear() || d.getMonth() !== t.getMonth() || d.getDate() !== t.getDate());
        } catch (e) {}
      }
    }
  };
  new MutationObserver(scan).observe(document, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', scan);
}

const label = u => {
  const x = new URL(u);
  if (x.pathname.startsWith('/rest/v1/')) {
    const q = x.searchParams;
    const st = q.get('status');
    const what = st ? ' status:' + st.replace(/^in\.\(|\)$/g, '').split(',').length + ' values' : '';
    return 'rest ' + x.pathname.slice(9) + what + (q.get('raw_issue_parent_id') ? ' parent-check' : '') + (q.get('scheduled_date') ? ' next-14-days' : '');
  }
  return x.pathname.startsWith('/functions/v1/') ? 'fn ' + x.pathname.slice(14) + (x.searchParams.get('action') ? ' ' + x.searchParams.get('action') : '') : null;
};


/* The sandbox browser does not trust the egress proxy's certificate, so it
 * cannot open https itself. Every request goes through Node instead (which does
 * trust it, and reaches the real site and the real backend), so the time
 * measured for each request includes the real server time. On the phone
 * profile the delay a 4G link adds (round trip, plus bytes over a shared
 * 9 Mbit/s link) is added on top. Desktop adds nothing. */
async function courier(ctx, net) {
  let linkFree = 0;
  await ctx.route('**/*', async route => {
    const req = route.request();
    try {
      const headers = { ...req.headers() };
      delete headers['accept-encoding']; delete headers.host; delete headers['content-length'];
      const r = await fetch(req.url(), { method: req.method(), headers, body: ['GET', 'HEAD'].includes(req.method()) ? undefined : req.postDataBuffer() || undefined, redirect: 'manual' });
      const body = Buffer.from(await r.arrayBuffer());
      if (net) {
        const wire = Math.max(200, Math.round(body.length * 0.3));   // text compresses about 3x
        const start = Math.max(Date.now() + net.latency, linkFree);
        linkFree = start + wire / net.down * 1000;
        const wait = linkFree - Date.now();
        if (wait > 0) await new Promise(x => setTimeout(x, wait));
      }
      const out = {};
      r.headers.forEach((v, k) => { if (!/^(content-encoding|content-length|transfer-encoding|connection)$/i.test(k)) out[k] = v; });
      out['access-control-allow-origin'] = '*';
      await route.fulfill({ status: r.status, headers: out, body });
    } catch (e) { await route.abort('failed').catch(() => {}); }
  });
}

async function run(browser, base, profile, scenario, identity, seededCache) {
  const def = PROFILE_DEF[profile];
  const ctx = await browser.newContext(def.ctx);
  const seedFor = { stale: seededCache && seededCache.stale, warm: seededCache && seededCache.warm, 'switch-warm': seededCache && seededCache.warm };
  const cache = seedFor[scenario] || null;
  const isSwitch = /^switch-/.test(scenario);
  await ctx.addInitScript(([id, ck, seed]) => {
    try {
      localStorage.setItem('syncview_staff_identity_v1', JSON.stringify(id));
      sessionStorage.setItem('syncview_staff_identity_prompted_v1', '1');
      if (seed && seed.cache) localStorage.setItem(ck, JSON.stringify(seed.cache));
      if (seed && seed.paint) localStorage.setItem('syncview_today_paint_v1', JSON.stringify(seed.paint));
    } catch (e) {}
  }, [identity, CACHE_KEY, cache]);
  await ctx.addInitScript(recorder, CACHE_KEY);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  if (def.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: def.cpu });
  await courier(ctx, def.net);
  const click = async (id) => {
    await page.hover('#' + id, { timeout: 1000 }).catch(() => page.evaluate(id => document.getElementById(id).dispatchEvent(new PointerEvent('pointerover', { bubbles: true })), id));
    await page.waitForTimeout(150);
    await page.evaluate(id => {
      if (id === 'navToday') { window.__tm = { skeleton: null, saved: null, fresh: null, savedIsOld: null, t0: performance.now(), armed: true }; }
      document.getElementById(id).click();
    }, id);
  };
  if (!isSwitch) {
    await page.goto(base + '/#today', { waitUntil: 'domcontentloaded', timeout: 60000 });
  } else {
    await page.goto(base + (scenario === 'switch-back' ? '/#today' : '/#calendar'), { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (scenario === 'switch-back') {
      await page.waitForFunction(() => window.__tm && window.__tm.fresh != null, null, { timeout: 60000 }).catch(() => {});
      await page.waitForSelector('#navCalendar', { state: 'attached', timeout: 30000 });
      await page.evaluate(() => { window.__tm.t0 = 1; window.__tm.armed = false; document.getElementById('navCalendar').click(); });
    }
    await page.waitForSelector('#navToday', { state: 'attached', timeout: 60000 });
    await page.waitForTimeout(5000);   // the other tab settles, as a person reads it
    await click('navToday');
  }
  await page.waitForFunction(() => window.__tm && window.__tm.fresh != null, null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(400);
  const out = await page.evaluate(() => {
    const reqs = performance.getEntriesByType('resource')
      .filter(e => /supabase\.co/.test(e.name))
      .map(e => ({ url: e.name, start: e.startTime, end: e.responseEnd }));
    const nav = performance.getEntriesByType('navigation')[0];
    window.__tm.html = nav ? nav.responseEnd : null;   // the page's own bytes have arrived
    return { marks: window.__tm, reqs, dcl: performance.timing.domContentLoadedEventEnd - performance.timing.navigationStart, cache: localStorage.getItem('syncview_today_cache_v1'), paint: localStorage.getItem('syncview_today_paint_v1') };
  });
  const rows = out.reqs.map(r => ({ what: label(r.url), start: Math.round(r.start), ms: Math.round(r.end - r.start), end: Math.round(r.end) }))
    .filter(r => r.what && !/key-verify|flags/.test(r.what) && !/syncview_runtime_flags/.test(r.what));
  await ctx.close();
  return { marks: out.marks, rows, cache: out.cache, paint: out.paint };
}

const med = a => { const s = a.filter(x => x != null).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

(async () => {
  const identity = await staffIdentity();
  let server = null, base = LIVE;
  if (TARGET === 'local') { server = await serve(ROOT); base = 'http://127.0.0.1:' + server.address().port; }
  const browser = await chromium.launch();
  // One cold desktop read gives a real saved copy to age for the stale runs.
  const seedRun = await run(browser, base, 'desktop', 'cold', identity, null);
  let seed = null;
  try {
    const c = JSON.parse(seedRun.cache);
    const y = new Date(); y.setHours(0, 0, 0, 0);
    const yd = new Date(y.getTime() - 60 * 60 * 1000);
    const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    // The saved page (boot-shell paint) exists only on builds that write it.
    const pt = seedRun.paint ? JSON.parse(seedRun.paint) : null;
    seed = {
      stale: { cache: { ...c, at: yd.getTime(), day: iso(yd) }, paint: pt && { ...pt, at: yd.getTime(), day: iso(yd) } },   // 23:00 yesterday
      warm: { cache: { ...c, at: Date.now() - 10 * 60 * 1000 }, paint: pt && { ...pt, at: Date.now() - 10 * 60 * 1000 } }   // ten minutes ago, today
    };
  } catch (e) { console.error('could not capture a saved copy'); }
  const results = [];
  for (const profile of PROFILES) for (const scenario of SCENARIOS) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) runs.push(await run(browser, base, profile, scenario, identity, seed));
    results.push({ target: TARGET === 'local' ? 'local:' + path.basename(ROOT) : 'live', profile: PROFILE_DEF[profile].name, scenario, runs });
  }
  await browser.close();
  if (server) server.close();
  for (const r of results) {
    const m = k => med(r.runs.map(x => x.marks[k]));
    console.log(`\n== ${r.target} | ${r.profile} | ${r.scenario} | median of ${RUNS} ==`);
    const vis = r.runs.map(x => [x.marks.saved, x.marks.fresh].filter(v => v != null).sort((a, b) => a - b)[0]);
    console.log(`skeleton ${Math.round(m('skeleton') ?? -1)} ms | list visible ${med(vis) == null ? 'never' : Math.round(med(vis)) + ' ms'} | saved items painted ${m('saved') == null ? 'never' : Math.round(m('saved')) + ' ms'} | fresh on screen ${Math.round(m('fresh') ?? -1)} ms | saved copy was from an earlier day in ${r.runs.filter(x => x.marks.savedIsOld).length}/${RUNS} runs`);
    if (!/^switch-/.test(r.scenario)) console.log(`  page bytes arrived ${Math.round(m('html') ?? -1)} ms; list visible ${med(vis.map((v, i) => v == null ? null : v - r.runs[i].marks.html)) == null ? 'never' : Math.round(med(vis.map((v, i) => v == null ? null : v - r.runs[i].marks.html))) + ' ms'} after that`);
    console.log('  per run (visible / fresh ms): ' + r.runs.map((x, i) => Math.round(vis[i] ?? -1) + '/' + Math.round(x.marks.fresh ?? -1)).join('  '));
    const first = r.runs[Math.floor(RUNS / 2)];
    console.log('request order (one run): start ms, duration ms');
    first.rows.sort((a, b) => a.start - b.start).forEach(q => console.log(`  ${String(q.start).padStart(5)} +${String(q.ms).padStart(5)}  ${q.what}`));
    console.log(`  requests: ${first.rows.length}`);
  }
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(results.map(r => ({ ...r, runs: r.runs.map(x => ({ marks: x.marks, rows: x.rows })) })), null, 1));
})().catch(e => { console.error(e.message); process.exit(1); });
