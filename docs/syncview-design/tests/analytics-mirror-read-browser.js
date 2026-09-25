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
 * No request leaves the machine.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
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
  const seen = { sheets: [], ef: 0, efToken: '', efSlug: '' };
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
      try { seen.efSlug = JSON.parse(r.postData() || '{}').slug; } catch (e) {}
      if (efMode === 'fail') return json({ ok: false, error: 'read_failed' }, 500);
      return json(dbAnswer(efMode));
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

    for (const s of [off, other, on, fail, nocopy, empty]) {
      console.log(`  ${s.name.padEnd(28)} analytics-read=${s.seen.ef} sheets=[${s.seen.sheets.join(', ')}] followers=${s.got.followers || '-'}`);
      if (s.errors.length) failures.push(`${s.name}: page error ${s.errors[0]}`);
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { failures.forEach(f => console.error('FAIL ' + f)); process.exit(1); }
  console.log('ANALYTICS_MIRROR_READ_OK');
})().catch(e => { console.error(e); process.exit(1); });
