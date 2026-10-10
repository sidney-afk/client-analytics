'use strict';
/* analytics-mirror-read-browser.js -- Analytics Phase 2 on a client link,
 * fully offline (docs/plans/2026-09-24-sheets-to-supabase.md).
 *
 * Drives the real index.html as a synthetic client link and proves:
 *   1. flag off: the Sheets are read exactly as before, analytics-read is
 *      never called;
 *   2. flag on for this client only ({"enabled": false, "clients": [slug]}):
 *      one analytics-read call feeds the page and no Sheet tab is downloaded;
 *   3. flag on but analytics-read fails: the Sheets are read instead;
 *   4. flag on but the database has no copy (no rows, no receipt): the Sheets
 *      are read instead;
 *   5. flag on, no rows but a complete receipt: a real "no rows", no Sheets.
 * And for STAFF (the overview and every per-client page):
 *   6. flag on for one client only: staff keep reading the Sheets;
 *   7. {"staff": true}: one "overview" and one "extras" answer, no Sheet tab;
 *   8. staff read fails: the Sheets are read instead;
 *   9. staff copy incomplete (no whole-dataset receipt): the Sheets are read;
 *  10. staff copy stale (last whole-dataset receipt older than 3 days): Sheets.
 * And the ROSTER SWITCH ("roster": "database", Sheets move slice 1): the
 * Clients Info tab is never downloaded, by a client link or by staff, whether
 * the numbers come from the database, from the Metrics tab or not at all; the
 * client list comes from the database (a client link the numbers read is not
 * on for asks for its own row only); the review queue's manager map comes
 * from smm-weekly-reports, never from the Social Media Managers tab.
 * And with the roster switch on (OPEN_REPAIRS 398): one failed analytics-read
 * on a client link is a retryable analytics state, never "We could not verify
 * this link", keeps the client's saved calendar and samples copies, and Try
 * again sends exactly one new request (default landing, and Calendar then the
 * Analytics tab); the SMM weekly report form opened with no saved staff
 * identity reads the client list again once the SMM signs in and repaints the
 * open picker. Roster off: unchanged in each case.
 * No request leaves the machine.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { seedStaffGate } = require('../../../qa/staff-gate-seed.js');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const root = path.resolve(__dirname, '..', '..', '..');
function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const file = path.normalize(decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)).replace(/^([.][\\/])+/, '');
    const full = path.join(root, file);
    if (!full.startsWith(root) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': full.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' });
    fs.createReadStream(full).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const CLIENT = 'Mirror Fixture Client';
const SLUG = 'mirrorfixtureclient';
const TOKEN = 'synthetic-mirror-token';
const DAY = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const SHEET_FOLLOWERS = '555001';
const DB_FOLLOWERS = '777001';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
const METRICS_CSV = `"date","client_name","ig_followers","ig_avg_views"\n"${DAY}","${CLIENT}","${SHEET_FOLLOWERS}","100"\n`;
const CLIENTS_CSV = `"client_name","instagram_handle","content_description"\n"${CLIENT}","fixture","Sheet description"\n`;
const TOPVIDS_CSV = `"scraped_date","client_name","platform","period","rank","caption","video_url","views"\n"${DAY}","${CLIENT}","instagram","week","1","Sheet video","https://example.invalid/s","10"\n`;

function dbAnswer(kind) {
  const full = {
    metrics: [{ date: DAY, client_name: CLIENT, ig_followers: DB_FOLLOWERS, ig_avg_views: '200', analytics_receipt: null }],
    top_videos: [{ scraped_date: DAY, client_name: CLIENT, platform: 'instagram', period: 'week', rank: '1', caption: 'Database video', video_url: 'https://example.invalid/d', views: '20' }],
    market_research_briefs: [], content_summaries: [],
    client_profile: { slug: SLUG, display_name: CLIENT, instagram_handle: 'fixture', tiktok_handle: null, youtube_channel_id: null, content_description: 'Database description' },
  };
  const receipt = { complete: true, created_at: '2026-09-25T00:00:00Z' };
  if (kind === 'nocopy') return { ok: true, slug: SLUG, principal: 'client', receipts: {}, data: Object.assign({}, full, { metrics: [], top_videos: [] }) };
  if (kind === 'empty') return { ok: true, slug: SLUG, principal: 'client',
    receipts: { metrics: receipt, top_videos: receipt, market_research_briefs: receipt, content_summaries: receipt, client_profiles: receipt },
    data: Object.assign({}, full, { metrics: [], top_videos: [] }) };
  return { ok: true, slug: SLUG, principal: 'client',
    receipts: { metrics: receipt, top_videos: receipt, market_research_briefs: receipt, content_summaries: receipt, client_profiles: receipt }, data: full };
}

async function scenario(browser, origin, name, flag, efMode) {
  const seen = { sheets: [], ef: 0, efToken: '', efSlug: '', efDatasets: null };
  const ctx = await browser.newContext();
  await ctx.route('**/*', async route => {
    const r = route.request(); const u = new URL(r.url());
    if (r.url().startsWith(origin)) return route.continue();
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const json = (body, status = 200) => route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.pathname === '/functions/v1/client-token-verify') {
      let b = {}; try { b = JSON.parse(r.postData() || '{}'); } catch (e) {}
      if (b.slug !== SLUG || b.token !== TOKEN) return json({ ok: true, valid: false });
      return json({ ok: true, valid: true, allowed: true, slug: SLUG, display_name: CLIENT, view: b.view, strict: true, active: true, protocol: 'syncview-client-entry-v1' });
    }
    if (u.pathname === '/functions/v1/analytics-read') {
      seen.ef++;
      seen.efToken = r.headers()['x-syncview-client-token'] || '';
      let asked = null;
      try { const b = JSON.parse(r.postData() || '{}'); seen.efSlug = b.slug; asked = Array.isArray(b.datasets) ? b.datasets : null; } catch (e) {}
      seen.efDatasets = asked;
      if (efMode === 'fail') return json({ ok: false, error: 'read_failed' }, 500);
      const answer = dbAnswer(efMode);
      // Like analytics-read: only the datasets asked for come back (receipts still do).
      if (asked) answer.data = Object.fromEntries(asked.map(k => [k, answer.data[k]]));
      return json(answer);
    }
    if (u.pathname === '/rest/v1/syncview_runtime_flags') {
      const rows = [];
      if (flag && /analytics_mirror_read_enabled/.test(decodeURIComponent(u.search))) rows.push({ key: 'analytics_mirror_read_enabled', value: flag });
      return json(rows);
    }
    if (u.pathname === '/rest/v1/clients') return json([{ slug: SLUG, kind: 'client', active: true }]);
    if (/\/rest\/v1\//.test(u.pathname)) return json([]);
    if (/\/functions\/v1\/|\/webhook\//.test(u.pathname)) return json({});
    if (/docs\.google\.com/.test(u.host)) {
      const tab = u.searchParams.get('sheet');
      seen.sheets.push(tab);
      const body = tab === 'Metrics' ? METRICS_CSV : tab === 'Clients Info' ? CLIENTS_CSV : tab === 'TopVideos' ? TOPVIDS_CSV : '';
      return route.fulfill({ status: 200, headers: CORS, contentType: 'text/csv', body });
    }
    return route.abort();
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 160)));
  await page.goto(`${origin}/index.html?${new URLSearchParams({ c: CLIENT, t: TOKEN })}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof allData !== 'undefined' && allData.length > 0 && typeof _analyticsExtrasApplied !== 'undefined' && _analyticsExtrasApplied, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(300);
  const got = await page.evaluate(() => ({
    followers: (allData.find(r => r.date) || {}).ig_followers || '',
    rows: allData.length,
    video: (topVideos[0] || {}).caption || '',
    videos: topVideos.length,
    desc: (Object.values(clientMap)[0] || {}).content_description || '',
  }));
  await ctx.close();
  return { name, seen, got, errors };
}

const STAFF_METRIC_COLUMNS = ['date', 'client_name', 'ig_followers', 'ig_avg_views'];
function staffAnswer(scope, mode) {
  const receipt = { complete: true, full_snapshot: true, created_at: new Date().toISOString() };
  const stale = { complete: true, full_snapshot: true, created_at: '2026-01-01T00:00:00Z' };
  if (scope === 'overview') {
    return { ok: true, principal: 'staff', scope, latest_metrics_date: DAY,
      receipts: mode === 'incomplete' ? { metrics: null, client_profiles: receipt }
        : mode === 'stale' ? { metrics: stale, client_profiles: receipt } : { metrics: receipt, client_profiles: receipt },
      data: { metrics: { columns: STAFF_METRIC_COLUMNS, rows: [[DAY, CLIENT, DB_FOLLOWERS, '200']] },
        client_profiles: [{ slug: SLUG, display_name: CLIENT, instagram_handle: 'fixture', content_description: 'Database description', extra: {} }] } };
  }
  return { ok: true, principal: 'staff', scope,
    receipts: { top_videos: receipt, market_research_briefs: receipt, content_summaries: receipt },
    data: { top_videos: { columns: ['scraped_date', 'client_name', 'platform', 'period', 'rank', 'caption', 'video_url', 'views'],
      rows: [[DAY, CLIENT, 'instagram', 'week', '1', 'Database video', 'https://example.invalid/d', '20']] },
      market_research_briefs: [], content_summaries: [] } };
}

async function staffScenario(browser, origin, name, flag, efMode, opts = {}) {
  const seen = { sheets: [], allSheets: [], scopes: [], keyed: 0, options: 0 };
  const ctx = await browser.newContext();
  await ctx.route('**/*', async route => {
    const r = route.request(); const u = new URL(r.url());
    if (r.url().startsWith(origin)) return route.continue();
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const json = (body, status = 200) => route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.pathname === '/functions/v1/analytics-read') {
      let b = {}; try { b = JSON.parse(r.postData() || '{}'); } catch (e) {}
      seen.scopes.push(b.scope || 'client');
      if (r.headers()['x-syncview-key']) seen.keyed++;
      if (efMode === 'fail') return json({ ok: false, error: 'read_failed' }, 500);
      return json(staffAnswer(b.scope, efMode));
    }
    if (u.pathname === '/functions/v1/smm-weekly-reports' && u.searchParams.get('action') === 'options') {
      seen.options++;
      return json({ ok: true, managers: [{ slug: 'fixture-manager', name: 'Fixture Manager', active: true, source_clients: [CLIENT] }], also_sees: [] });
    }
    if (u.pathname === '/rest/v1/syncview_runtime_flags') {
      const rows = [];
      if (flag && /analytics_mirror_read_enabled/.test(decodeURIComponent(u.search))) rows.push({ key: 'analytics_mirror_read_enabled', value: flag });
      return json(rows);
    }
    if (/\/rest\/v1\//.test(u.pathname)) return json([]);
    if (/\/functions\/v1\/|\/webhook\//.test(u.pathname)) return json({});
    if (/docs\.google\.com/.test(u.host)) {
      const tab = u.searchParams.get('sheet');
      seen.sheets.push(tab);
      seen.allSheets.push(tab);
      const body = tab === 'Metrics' ? METRICS_CSV : tab === 'Clients Info' ? CLIENTS_CSV : tab === 'TopVideos' ? TOPVIDS_CSV : '';
      return route.fulfill({ status: 200, headers: CORS, contentType: 'text/csv', body });
    }
    return route.abort();
  });
  await seedStaffGate(ctx, { keepAnalyticsRead: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 160)));
  await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof allData !== 'undefined' && allData.some(r => r.date), null, { timeout: 20000 }).catch(() => {});
  // The per-client pages' extras load behind the overview.
  await page.evaluate(() => { try { return typeof fetchExtras === 'function' ? fetchExtras(null) : null; } catch (e) { return null; } }).catch(() => {});
  await page.waitForFunction(() => typeof _analyticsExtrasApplied !== 'undefined' && _analyticsExtrasApplied, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(300);
  const got = await page.evaluate(() => ({
    followers: (allData.find(r => r.date) || {}).ig_followers || '',
    video: (topVideos[0] || {}).caption || '',
    desc: (Object.values(clientMap)[0] || {}).content_description || '',
    clients: Object.keys(clientMap).length,
  }));
  if (opts.managers) {
    // The review queue's manager map, loaded the way the queue loads it.
    got.managers = await page.evaluate(async () => {
      if (typeof _kasperLoadSMMMap !== 'function') return { missing: true };
      const map = await _kasperLoadSMMMap();
      const first = [...map.values()][0] || {};
      return { size: map.size, name: first.name || '', keys: Object.keys(first).join(',') };
    });
  }
  await ctx.close();
  // The five analytics tabs only; other Sheet readers (the review queue's
  // manager tab) are not part of this switch.
  const ANALYTICS_TABS = ['Metrics', 'Clients Info', 'TopVideos', 'Market Research Briefs', 'ContentSummaries'];
  seen.sheets = seen.sheets.filter(t => ANALYTICS_TABS.includes(t));
  return { name, seen, got, errors };
}

/* ONE FAILED READ ON A CLIENT LINK (OPEN_REPAIRS 398). analytics-read answers
 * 500 the first time and the good answer after that. With the roster switch
 * on, that one failure used to say "We could not verify this link" and wipe
 * the client's saved calendar and samples copies (default landing), or keep
 * the failure for the whole visit so Try again never asked again (Calendar,
 * then the Analytics tab). The link was verified; only the read failed. */
const CAL_CACHE_KEY = 'syncview_calCache_v2:' + SLUG;
const SXR_CACHE_KEY = 'syncview_sxr_cache_v2_' + SLUG;
async function clientRetryScenario(browser, origin, name, flag, view) {
  const seen = { sheets: [], ef: 0 };
  const ctx = await browser.newContext();
  await ctx.route('**/*', async route => {
    const r = route.request(); const u = new URL(r.url());
    if (r.url().startsWith(origin)) return route.continue();
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const json = (body, status = 200) => route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.pathname === '/functions/v1/client-token-verify') {
      let b = {}; try { b = JSON.parse(r.postData() || '{}'); } catch (e) {}
      if (b.slug !== SLUG || b.token !== TOKEN) return json({ ok: true, valid: false });
      return json({ ok: true, valid: true, allowed: true, slug: SLUG, display_name: CLIENT, view: b.view, strict: true, active: true, protocol: 'syncview-client-entry-v1' });
    }
    if (u.pathname === '/functions/v1/analytics-read') {
      seen.ef++;
      if (seen.ef === 1) return json({ ok: false, error: 'read_failed' }, 500);
      return json(dbAnswer('full'));
    }
    if (u.pathname === '/rest/v1/syncview_runtime_flags') {
      const rows = [];
      if (flag && /analytics_mirror_read_enabled/.test(decodeURIComponent(u.search))) rows.push({ key: 'analytics_mirror_read_enabled', value: flag });
      return json(rows);
    }
    if (u.pathname === '/rest/v1/clients') return json([{ slug: SLUG, kind: 'client', active: true }]);
    if (/\/rest\/v1\//.test(u.pathname)) return json([]);
    if (/\/functions\/v1\/|\/webhook\//.test(u.pathname)) return json({});
    if (/docs\.google\.com/.test(u.host)) {
      const tab = u.searchParams.get('sheet');
      seen.sheets.push(tab);
      const body = tab === 'Metrics' ? METRICS_CSV : tab === 'Clients Info' ? CLIENTS_CSV : tab === 'TopVideos' ? TOPVIDS_CSV : '';
      return route.fulfill({ status: 200, headers: CORS, contentType: 'text/csv', body });
    }
    return route.abort();
  });
  // This client's saved calendar and samples copies, seeded once.
  await ctx.addInitScript(([calKey, sxrKey]) => {
    try {
      if (sessionStorage.getItem('__mirrorSeeded')) return;
      sessionStorage.setItem('__mirrorSeeded', '1');
      localStorage.setItem(calKey, JSON.stringify({ seeded: 'calendar' }));
      localStorage.setItem(sxrKey, JSON.stringify({ seeded: 'samples' }));
    } catch (e) {}
  }, [CAL_CACHE_KEY, SXR_CACHE_KEY]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 160)));
  const q = { c: CLIENT, t: TOKEN }; if (view) q.v = view;
  await page.goto(`${origin}/index.html?${new URLSearchParams(q)}`, { waitUntil: 'domcontentloaded' });
  const settled = () => page.waitForFunction(() => !!document.querySelector('#content [data-client-entry-state], #content [data-client-extras-state="error"], #content .detail-hero'), null, { timeout: 20000 }).catch(() => {});
  const state = () => page.evaluate(([calKey, sxrKey]) => {
    const c = document.getElementById('content');
    const entry = c && c.querySelector('[data-client-entry-state]');
    const extras = c && c.querySelector('[data-client-extras-state="error"]');
    return {
      entry: entry ? entry.getAttribute('data-client-entry-state') : '',
      extrasError: !!extras,
      text: c ? c.innerText.replace(/\s+/g, ' ').slice(0, 200) : '',
      hero: !!(c && c.querySelector('.detail-hero')),
      followers: (typeof allData !== 'undefined' && (allData.find(r => r.date) || {}).ig_followers) || '',
      calCache: localStorage.getItem(calKey) !== null,
      sxrCache: localStorage.getItem(sxrKey) !== null,
    };
  }, [CAL_CACHE_KEY, SXR_CACHE_KEY]);
  if (view === 'calendar') {
    await page.waitForSelector('button.view-tab-btn:has-text("Analytics")', { timeout: 20000 });
    await page.waitForTimeout(800);   // let the background read fail first
    await page.click('button.view-tab-btn:has-text("Analytics")');
  }
  await settled();
  await page.waitForTimeout(300);
  const out = { name, first: await state(), efFirst: seen.ef, retry: null };
  const tryAgain = await page.$('#content [data-client-extras-state="error"] button');
  if (tryAgain) {
    const before = seen.ef;
    await tryAgain.click();
    await page.waitForFunction(() => !!document.querySelector('#content .detail-hero'), null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(500);
    out.retry = Object.assign({ newReads: seen.ef - before }, await state());
  }
  out.sheets = seen.sheets; out.errors = errors;
  await ctx.close();
  return out;
}

/* THE WEEKLY REPORT FORM AFTER A LATE SIGN-IN (OPEN_REPAIRS 398). The page
 * opens with no saved staff identity (it skips the sign-in gate), so its first
 * read of the client list has no key. With the roster switch on it then had
 * nothing to show but the built-in names, even after the SMM signed in. The
 * keyed analytics-read answer is held until the picker is open, to prove the
 * open list is repainted when the full client list lands. */
const SMM_DB_ONLY = 'Zeta Mirror Fixture';
const SMM_MEMBER = { id: 'mirror_smm_1', name: 'Mirror Fixture Smm', role: 'smm', team: null, active: true };
async function smmScenario(browser, origin, name, flag) {
  const seen = { sheets: [], reads: [], signedIn: false };
  let releaseRead;
  const held = new Promise(resolve => { releaseRead = resolve; });
  const ctx = await browser.newContext();
  await ctx.route('**/*', async route => {
    const r = route.request(); const u = new URL(r.url());
    if (r.url().startsWith(origin)) return route.continue();
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const json = (body, status = 200) => route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.pathname === '/functions/v1/key-verify') return json({ ok: true, role: 'smm', member: SMM_MEMBER });
    if (u.pathname === '/rest/v1/team_members') return json([SMM_MEMBER]);
    if (u.pathname === '/functions/v1/analytics-read') {
      let b = {}; try { b = JSON.parse(r.postData() || '{}'); } catch (e) {}
      const keyed = !!r.headers()['x-syncview-key'];
      seen.reads.push({ scope: b.scope || 'client', keyed, afterSignIn: seen.signedIn });
      if (!keyed) return json({ ok: false, error: 'unauthorized' }, 401);
      if (b.scope !== 'overview') return json({ ok: false, error: 'read_failed' }, 500);
      await held;
      const now = new Date().toISOString();
      return json({ ok: true, principal: 'staff', scope: 'overview', latest_metrics_date: DAY,
        receipts: { metrics: { complete: true, full_snapshot: true, created_at: now }, client_profiles: { complete: true, full_snapshot: true, created_at: now } },
        data: { metrics: { columns: STAFF_METRIC_COLUMNS, rows: [[DAY, SMM_DB_ONLY, DB_FOLLOWERS, '200']] },
          client_profiles: [{ slug: 'zetamirrorfixture', display_name: SMM_DB_ONLY, extra: {} }] } });
    }
    if (u.pathname === '/functions/v1/smm-weekly-reports') {
      return json({ ok: true, managers: [{ slug: 'mirror-fixture-smm', name: SMM_MEMBER.name, active: true, source_clients: [SMM_DB_ONLY] }], also_sees: [], current_week_start: '2026-10-05' });
    }
    if (u.pathname === '/rest/v1/syncview_runtime_flags') {
      const rows = [];
      if (flag && /analytics_mirror_read_enabled/.test(decodeURIComponent(u.search))) rows.push({ key: 'analytics_mirror_read_enabled', value: flag });
      return json(rows);
    }
    if (/\/rest\/v1\//.test(u.pathname)) return json([]);
    if (/\/functions\/v1\/|\/webhook\//.test(u.pathname)) return json({});
    if (/docs\.google\.com/.test(u.host)) {
      const tab = u.searchParams.get('sheet');
      seen.sheets.push(tab);
      const body = tab === 'Metrics' ? `"date","client_name","ig_followers"\n"${DAY}","${SMM_DB_ONLY}","100"\n`
        : tab === 'Clients Info' ? `"client_name","instagram_handle"\n"${SMM_DB_ONLY}","fixture"\n` : '';
      return route.fulfill({ status: 200, headers: CORS, contentType: 'text/csv', body });
    }
    return route.abort();
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 160)));
  const out = { name };
  try {
    await page.goto(`${origin}/index.html#smm-weekly-report`, { waitUntil: 'domcontentloaded' });
    // The real sign-in card, opened by the form's own options read.
    await page.waitForSelector('#staffIdentityForm', { timeout: 20000 });
    await page.waitForTimeout(800);   // the keyless boot read has finished by now
    await page.evaluate(({ id }) => {
      const m = document.getElementById('staffIdentityMember'); m.value = id; m.dispatchEvent(new Event('change', { bubbles: true }));
    }, { id: SMM_MEMBER.id });
    await page.fill('#staffIdentityKey', 'synthetic-mirror-smm-key');
    seen.signedIn = true;
    await page.click('#staffIdentitySubmit');
    await page.waitForSelector('#srpClientSearch', { timeout: 20000 });
    // Open the picker on the part of the name, before the client list lands.
    await page.fill('#srpClientSearch', 'Zeta Mirror');
    await page.waitForTimeout(300);
    out.beforeRelease = await page.evaluate(() => [...document.querySelectorAll('#srpClientResults .srp-search-option')].map(e => e.textContent.trim()));
    releaseRead();
    await page.waitForFunction(name => [...document.querySelectorAll('#srpClientResults .srp-search-option')].some(e => e.textContent.trim() === name),
      SMM_DB_ONLY, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(300);
    out.got = await page.evaluate(name => ({
      results: [...document.querySelectorAll('#srpClientResults .srp-search-option')].map(e => e.textContent.trim()),
      resultsOpen: (document.getElementById('srpClientResults') || {}).style?.display === 'block',
      inRoster: getClientRoster().includes(name),
    }), SMM_DB_ONLY);
  } finally {
    releaseRead();
    out.seen = seen; out.errors = errors;
    await ctx.close();
  }
  return out;
}

(async () => {
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const failures = [];
  const expect = (cond, msg) => { if (!cond) failures.push(msg); };
  try {
    const off = await scenario(browser, origin, 'flag off', { enabled: false }, 'full');
    expect(off.seen.ef === 0, 'flag off: analytics-read must not be called');
    expect(off.seen.sheets.includes('Metrics') && off.seen.sheets.includes('TopVideos'), 'flag off: the Sheets must be read');
    expect(off.got.followers === SHEET_FOLLOWERS, 'flag off: page shows the Sheet numbers');

    const other = await scenario(browser, origin, 'flag on for another client', { enabled: false, clients: ['someoneelse'] }, 'full');
    expect(other.seen.ef === 0 && other.got.followers === SHEET_FOLLOWERS, 'a client not on the list keeps the Sheets');

    const on = await scenario(browser, origin, 'flag on for this client', { enabled: false, clients: [SLUG] }, 'full');
    expect(on.seen.ef === 1, 'flag on: exactly one analytics-read call (got ' + on.seen.ef + ')');
    expect(on.seen.efToken === TOKEN && on.seen.efSlug === SLUG, 'flag on: the call carries this link\'s token and slug');
    expect(on.seen.sheets.length === 0, 'flag on: no Sheet tab is downloaded (got ' + on.seen.sheets.join(',') + ')');
    expect(on.got.followers === DB_FOLLOWERS, 'flag on: page shows the database numbers');
    expect(on.got.video === 'Database video', 'flag on: top videos come from the database');
    expect(on.got.desc === 'Database description', 'flag on: the About text comes from the database');

    const fail = await scenario(browser, origin, 'database read fails', { enabled: true }, 'fail');
    expect(fail.seen.ef === 1 && fail.seen.sheets.includes('Metrics') && fail.seen.sheets.includes('TopVideos'), 'read failure: falls back to the Sheets');
    expect(fail.got.followers === SHEET_FOLLOWERS, 'read failure: page shows the Sheet numbers');

    const nocopy = await scenario(browser, origin, 'no copy yet', { enabled: true }, 'nocopy');
    expect(nocopy.seen.sheets.includes('Metrics') && nocopy.seen.sheets.includes('TopVideos'), 'no copy: falls back to the Sheets');
    expect(nocopy.got.followers === SHEET_FOLLOWERS, 'no copy: page shows the Sheet numbers');

    const empty = await scenario(browser, origin, 'no rows, complete receipt', { enabled: true }, 'empty');
    expect(empty.seen.sheets.length === 0, 'no rows with a complete receipt is a real answer, not a fallback');
    expect(empty.got.videos === 0, 'no rows: no videos shown');

    const sOff = await staffScenario(browser, origin, 'staff, one client enrolled', { enabled: false, clients: [SLUG] }, 'full');
    expect(sOff.seen.scopes.length === 0, 'staff with a one-client flag must not call analytics-read (got ' + sOff.seen.scopes.join(',') + ')');
    expect(sOff.seen.sheets.includes('Metrics') && sOff.got.followers === SHEET_FOLLOWERS, 'staff with a one-client flag keep the Sheets');

    const sOn = await staffScenario(browser, origin, 'staff flag on', { enabled: false, staff: true }, 'full');
    expect(sOn.seen.scopes.includes('overview') && sOn.seen.scopes.includes('extras'), 'staff flag on: overview and extras are read from the database (got ' + sOn.seen.scopes.join(',') + ')');
    expect(sOn.seen.keyed === sOn.seen.scopes.length, 'staff flag on: every staff read carries the staff key');
    expect(sOn.seen.sheets.length === 0, 'staff flag on: no analytics Sheet tab is downloaded (got ' + sOn.seen.sheets.join(',') + ')');
    expect(sOn.got.followers === DB_FOLLOWERS && sOn.got.video === 'Database video' && sOn.got.desc === 'Database description',
      'staff flag on: numbers, videos and roster come from the database');

    const sFail = await staffScenario(browser, origin, 'staff read fails', { enabled: true }, 'fail');
    expect(sFail.seen.sheets.includes('Metrics') && sFail.seen.sheets.includes('TopVideos') && sFail.got.followers === SHEET_FOLLOWERS,
      'staff read failure: falls back to the Sheets');

    const sPart = await staffScenario(browser, origin, 'staff copy incomplete', { enabled: true }, 'incomplete');
    expect(sPart.seen.sheets.includes('Metrics') && sPart.got.followers === SHEET_FOLLOWERS, 'staff copy with no whole-dataset receipt: the numbers come from the Sheets');

    const sStale = await staffScenario(browser, origin, 'staff copy stale', { enabled: true }, 'stale');
    expect(sStale.seen.sheets.includes('Metrics') && sStale.got.followers === SHEET_FOLLOWERS, 'staff copy whose last whole-dataset receipt is old: the numbers come from the Sheets');

    // ---- the roster switch ----
    const ROSTER = { enabled: true, roster: 'database' };
    const rNo = await scenario(browser, origin, 'roster on, no numbers copy', ROSTER, 'nocopy');
    expect(rNo.seen.sheets.includes('Metrics') && !rNo.seen.sheets.includes('Clients Info'),
      'roster on, client link without a numbers copy: Metrics from the Sheet, Clients Info never (got ' + rNo.seen.sheets.join(',') + ')');
    expect(rNo.got.followers === SHEET_FOLLOWERS && rNo.got.desc === 'Database description', 'roster on: the client\'s own row comes from the database');
    const rFail = await scenario(browser, origin, 'roster on, read fails', ROSTER, 'fail');
    expect(!rFail.seen.sheets.includes('Clients Info'), 'roster on, client link read failure: Clients Info is still not downloaded');
    const rOnly = await scenario(browser, origin, 'roster on, numbers read off', { enabled: false, roster: 'database' }, 'full');
    expect(rOnly.seen.ef === 1 && JSON.stringify(rOnly.seen.efDatasets) === '["client_profile"]',
      'roster on, numbers read not on for this link: one analytics-read call asking for its own row only (got ' + rOnly.seen.ef + ' ' + JSON.stringify(rOnly.seen.efDatasets) + ')');
    expect(rOnly.seen.sheets.includes('Metrics') && !rOnly.seen.sheets.includes('Clients Info'),
      'roster on, numbers read off: Metrics from the Sheet as before, Clients Info never (got ' + rOnly.seen.sheets.join(',') + ')');
    expect(rOnly.got.followers === SHEET_FOLLOWERS && rOnly.got.desc === 'Database description',
      'roster on, numbers read off: the numbers stay the Sheet ones, the client row is the database one');
    const rOff = await scenario(browser, origin, 'roster key absent', { enabled: true }, 'nocopy');
    expect(rOff.seen.sheets.includes('Clients Info'), 'without the roster key the client link fallback is unchanged');

    const rsOn = await staffScenario(browser, origin, 'staff roster on', ROSTER, 'full', { managers: true });
    expect(rsOn.seen.allSheets.length === 0, 'staff roster on: no Sheet tab at all (got ' + rsOn.seen.allSheets.join(',') + ')');
    expect(rsOn.got.managers && !rsOn.got.managers.missing && rsOn.got.managers.size === 1 && rsOn.got.managers.name === 'Fixture Manager'
      && rsOn.got.managers.keys === 'name', 'staff roster on: the manager map comes from smm-weekly-reports and holds the name only (got ' + JSON.stringify(rsOn.got.managers) + ')');
    const rsStale = await staffScenario(browser, origin, 'staff roster on, stale numbers', ROSTER, 'stale');
    expect(rsStale.seen.sheets.includes('Metrics') && !rsStale.seen.sheets.includes('Clients Info'),
      'staff roster on, stale numbers: Metrics from the Sheet, Clients Info never (got ' + rsStale.seen.sheets.join(',') + ')');
    expect(rsStale.got.followers === SHEET_FOLLOWERS && rsStale.got.desc === 'Database description', 'staff roster on, stale numbers: the client list is the database one');
    const rsFail = await staffScenario(browser, origin, 'staff roster on, read fails', ROSTER, 'fail');
    expect(!rsFail.seen.sheets.includes('Clients Info'), 'staff roster on, read failure with no saved copy: Clients Info is not downloaded');
    const rsSheet = await staffScenario(browser, origin, 'staff roster off, managers', { enabled: true }, 'full', { managers: true });
    expect(rsSheet.seen.allSheets.includes('Social Media Managers') && rsSheet.got.managers && rsSheet.got.managers.size === 0,
      'without the roster key the manager map still reads the Sheet tab (Today asks the door on its own, so its calls are not counted here)');

    // ---- one failed read on a client link, and the weekly report form after a late sign-in (OPEN_REPAIRS 398) ----
    const VERIFY_TITLE = 'We could not verify this link';
    const rLand = await clientRetryScenario(browser, origin, 'roster on, read fails once', ROSTER, null);
    expect(rLand.first.entry === '' && !rLand.first.text.includes(VERIFY_TITLE),
      'roster on, one failed read on the default landing: not shown as a failed link (got entry=' + rLand.first.entry + ' "' + rLand.first.text.slice(0, 80) + '")');
    expect(rLand.first.extrasError && rLand.first.text.includes('We could not load your analytics'),
      'roster on, one failed read on the default landing: the retryable analytics state is shown (got "' + rLand.first.text.slice(0, 80) + '")');
    expect(rLand.first.calCache && rLand.first.sxrCache, 'roster on, one failed read: the client\'s saved calendar and samples copies are kept');
    expect(rLand.retry && rLand.retry.newReads === 1, 'roster on, default landing: Try again sends exactly one new analytics-read request (got ' + (rLand.retry ? rLand.retry.newReads : 'no Try again button') + ')');
    expect(rLand.retry && rLand.retry.hero && !rLand.retry.extrasError && rLand.retry.followers === DB_FOLLOWERS,
      'roster on, default landing: Try again recovers the analytics with the database numbers (got ' + JSON.stringify(rLand.retry) + ')');
    expect(rLand.retry && rLand.retry.calCache && rLand.retry.sxrCache, 'roster on, default landing: the saved copies are still there after the retry');
    expect(!rLand.sheets.includes('Clients Info'), 'roster on, one failed read: Clients Info is still never downloaded');

    const rCal = await clientRetryScenario(browser, origin, 'roster on, calendar, Analytics', ROSTER, 'calendar');
    expect(rCal.first.extrasError, 'roster on, calendar link then Analytics after one failed read: the retryable analytics state (got ' + JSON.stringify(rCal.first) + ')');
    expect(rCal.retry && rCal.retry.newReads === 1, 'roster on, calendar link then Analytics: Try again sends exactly one new analytics-read request (got ' + (rCal.retry ? rCal.retry.newReads : 'no Try again button') + ')');
    expect(rCal.retry && rCal.retry.hero && !rCal.retry.extrasError && rCal.retry.followers === DB_FOLLOWERS,
      'roster on, calendar link then Analytics: Try again recovers (got ' + JSON.stringify(rCal.retry) + ')');
    expect(!rCal.sheets.includes('Clients Info'), 'roster on, calendar link: Clients Info is still never downloaded');

    const oLand = await clientRetryScenario(browser, origin, 'roster off, read fails once', { enabled: true }, null);
    expect(oLand.first.hero && !oLand.first.extrasError && oLand.first.entry === '' && oLand.efFirst === 1 && oLand.first.followers === SHEET_FOLLOWERS,
      'roster off, one failed read: the page loads from the Sheets as before (got ' + JSON.stringify(oLand.first) + ' reads=' + oLand.efFirst + ')');
    expect(oLand.first.calCache && oLand.first.sxrCache, 'roster off: the saved copies are kept (control for the seeding)');
    const oCal = await clientRetryScenario(browser, origin, 'roster off, calendar, Analytics', { enabled: true }, 'calendar');
    expect(oCal.first.hero && !oCal.first.extrasError && oCal.efFirst === 1, 'roster off, calendar link then Analytics: loads from the Sheets as before (got ' + JSON.stringify(oCal.first) + ')');

    const smOn = await smmScenario(browser, origin, 'weekly form, roster on', ROSTER);
    const smKeyedAfter = (smOn.seen.reads || []).filter(x => x.scope === 'overview' && x.keyed && x.afterSignIn).length;
    expect(smKeyedAfter === 1, 'weekly form, roster on: one keyed client-list read after sign-in (got ' + JSON.stringify(smOn.seen.reads) + ')');
    expect(smOn.got && smOn.got.inRoster && smOn.got.resultsOpen && smOn.got.results.includes(SMM_DB_ONLY),
      'weekly form, roster on: the open client picker is repainted with the database-only client (before ' + JSON.stringify(smOn.beforeRelease) + ', after ' + JSON.stringify(smOn.got) + ')');
    expect(!smOn.seen.sheets.includes('Clients Info'), 'weekly form, roster on: Clients Info is never downloaded');
    const smOff = await smmScenario(browser, origin, 'weekly form, roster off', { enabled: true });
    expect((smOff.seen.reads || []).length === 0 && smOff.got && smOff.got.results.includes(SMM_DB_ONLY) && smOff.seen.sheets.includes('Clients Info'),
      'weekly form, roster off: unchanged, the list comes from the Clients Info tab and no extra read is sent (got ' + JSON.stringify({ reads: smOff.seen.reads, got: smOff.got, sheets: smOff.seen.sheets }) + ')');

    for (const s of [rLand, rCal, oLand, oCal]) {
      console.log(`  ${s.name.padEnd(28)} first=${s.first.entry ? 'entry:' + s.first.entry : s.first.extrasError ? 'analytics-error' : s.first.hero ? 'analytics' : '-'} reads=${s.efFirst}`
        + (s.retry ? ` retry: +${s.retry.newReads} read ${s.retry.hero ? 'analytics' : s.retry.extrasError ? 'analytics-error' : '-'} followers=${s.retry.followers || '-'}` : '')
        + ` saved copies=${s.first.calCache && s.first.sxrCache ? 'kept' : 'WIPED'}`);
      if (s.errors.length) failures.push(`${s.name}: page error ${s.errors[0]}`);
    }
    for (const s of [smOn, smOff]) {
      console.log(`  ${s.name.padEnd(28)} reads=${JSON.stringify(s.seen.reads)} before=${JSON.stringify(s.beforeRelease)} after=${JSON.stringify(s.got && s.got.results)}`);
      if (s.errors.length) failures.push(`${s.name}: page error ${s.errors[0]}`);
    }

    for (const s of [rNo, rFail, rOnly, rOff]) {
      console.log(`  ${s.name.padEnd(28)} analytics-read=${s.seen.ef} sheets=[${s.seen.sheets.join(', ')}] followers=${s.got.followers || '-'}`);
      if (s.errors.length) failures.push(`${s.name}: page error ${s.errors[0]}`);
    }
    for (const s of [rsOn, rsStale, rsFail, rsSheet]) {
      console.log(`  ${s.name.padEnd(28)} analytics-read=[${s.seen.scopes.join(', ')}] sheets=[${s.seen.allSheets.join(', ')}] followers=${s.got.followers || '-'} managers=${s.got.managers ? JSON.stringify(s.got.managers) : '-'}`);
    }

    for (const s of [off, other, on, fail, nocopy, empty]) {
      console.log(`  ${s.name.padEnd(28)} analytics-read=${s.seen.ef} sheets=[${s.seen.sheets.join(', ')}] followers=${s.got.followers || '-'}`);
      if (s.errors.length) failures.push(`${s.name}: page error ${s.errors[0]}`);
    }
    for (const s of [sOff, sOn, sFail, sPart, sStale]) {
      console.log(`  ${s.name.padEnd(28)} analytics-read=[${s.seen.scopes.join(', ')}] sheets=[${s.seen.sheets.join(', ')}] followers=${s.got.followers || '-'}`);
      if (s.errors.length) failures.push(`${s.name}: page error ${s.errors[0]}`);
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { failures.forEach(f => console.error('FAIL ' + f)); process.exit(1); }
  console.log('ANALYTICS_MIRROR_READ_OK');
})().catch(e => { console.error(e); process.exit(1); });
