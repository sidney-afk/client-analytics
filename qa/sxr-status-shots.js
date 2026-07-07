'use strict';
/*
 * Before/after screenshots of the SMM Samples "Sheet" view showing the derived
 * status pill flipping LIVE (no reload) when Kasper requests a change — the P1
 * fix — in BOTH light and dark themes, on the Sidney TEST client with dummy data.
 *
 *   before-<theme>.png : SMM has just routed the video to Kasper (pill "Kasper
 *                        Approval"), local-status-fresh.
 *   after-<theme>.png  : Kasper's request-change realtime event has landed; the
 *                        pill has flipped to "Tweaks Needed" live (fix) and the
 *                        note dot lit — no manual refresh.
 *
 * Run:  node qa/sxr-status-shots.js   → writes to qa/shots/sxr-status-*.png
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
let PW; try { PW = require('playwright'); } catch { PW = require('/opt/node22/lib/node_modules/playwright'); }
const { chromium } = PW;

const root = path.resolve(__dirname, '..');
const SHOTS = path.join(root, 'qa', 'shots');
const SLUG = 'sidneylaruel';
const PID = 'sr_shot_1';
let store, clk = 0;
function seed() {
  store = [{
    id: PID, client: SLUG, name: 'TEST Reel A (dummy)', order_index: 0,
    status: 'Kasper Approval', video_status: 'Kasper Approval', graphic_status: 'Approved',
    asset_url: 'https://example.com/v1.mp4', thumbnail_url: '', creative_direction: 'Punchy hook, dummy brief.',
    linear_issue_id: 'https://linear.app/x/issue/VID-1', graphic_linear_issue_id: '',
    video_tweaks: '', graphic_tweaks: '', video_comments: [], graphic_comments: [],
    updated_at: '2026-07-07T10:00:00.000Z',
  }];
}
function rowsFor(slug) { return store.filter(r => r.client === slug && String(r.status).toLowerCase() !== 'archived'); }
function applyUpsert(body) {
  const s = body.sample || {}; let row = store.find(r => r.id === s.id);
  const now = new Date(Date.parse('2026-07-07T10:00:00.000Z') + (++clk) * 1000).toISOString();
  if (!row) { row = Object.assign({ client: body.client || SLUG }, s, { updated_at: now }); store.push(row); }
  else { for (const k of Object.keys(s)) if (s[k] !== undefined) row[k] = s[k]; row.updated_at = now; }
  return { ok: true, sample: row };
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  if (u.pathname === '/' || u.pathname === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); fs.createReadStream(path.join(root, 'index.html')).pipe(res); return; }
  const f = path.join(root, u.pathname.slice(1));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  const ext = path.extname(f); const mime = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' }[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime }); fs.createReadStream(f).pipe(res);
});

async function shoot(browser, port, theme) {
  seed();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addInitScript((t) => {
    try { localStorage.setItem('syncview_auth_v1', 'ok'); } catch (e) {}
    try { if (t === 'dark') localStorage.setItem('syncview_theme', 'dark'); else localStorage.removeItem('syncview_theme'); } catch (e) {}
  }, theme);
  await ctx.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.includes('127.0.0.1') || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
    const H = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
    if (/sample-review-get/.test(url)) { const slug = new URL(url).searchParams.get('client') || ''; return route.fulfill({ contentType: 'application/json', headers: H, body: JSON.stringify({ items: rowsFor(slug) }) }); }
    if (/sample-review-upsert/.test(url)) { let b = {}; try { b = JSON.parse(route.request().postData() || '{}'); } catch (e) {} return route.fulfill({ contentType: 'application/json', headers: H, body: JSON.stringify(applyUpsert(b)) }); }
    if (/rest\/v1\/sample_reviews/.test(url)) return route.fulfill({ contentType: 'application/json', headers: Object.assign({ 'content-range': '0-1/1' }, H), body: JSON.stringify(store) });
    if (/linear-/.test(url)) return route.fulfill({ contentType: 'application/json', headers: H, body: JSON.stringify({ ok: true }) });
    if (/docs\.google\.com/.test(url)) return route.fulfill({ contentType: 'text/csv', headers: H, body: 'client_name\nSidney Laruel\n' });
    if (/syncview_runtime_flags/.test(url)) return route.fulfill({ contentType: 'application/json', headers: H, body: JSON.stringify([{ key: 'sample_review_ef_clients', value: { clients: [SLUG] } }]) });
    return route.abort();
  });
  const p = await ctx.newPage();
  await p.goto(`http://127.0.0.1:${port}/index.html?sxr=1&v2debug=1#sample-reviews/${SLUG}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForSelector('.cal-fld-substatus-wrap', { timeout: 20000 });
  await p.waitForTimeout(600);
  // Mark the card local-status-fresh, as if the SMM just routed it to Kasper —
  // this is the exact state in which the P1 bug used to strand the pill.
  await p.evaluate(id => {
    const post = sxrState.posts.find(x => x.id === id);
    if (typeof _sxrMarkLocalStatus === 'function') _sxrMarkLocalStatus(id, 'video');
    if (typeof _sxrRecentSaveFields !== 'undefined') _sxrRecentSaveFields.set(id, { wrote: { video_status: 'Kasper Approval', graphic_status: 'Approved' }, base: { video_status: 'For SMM Approval', graphic_status: 'Approved' } });
    if (typeof _sxrLocalRecentSaves !== 'undefined') _sxrLocalRecentSaves.set(id, Date.now());
  }, PID);

  const card = p.locator(`.cal-card[data-pid="${PID}"]`).first();
  const target = (await card.count()) ? card : p.locator('#sxrBody');
  await target.screenshot({ path: path.join(SHOTS, `sxr-status-before-${theme}.png`) });

  // Kasper requests a change on the store (Tweaks Needed + a dummy tweak note),
  // then deliver the realtime ping the way Supabase would.
  const now = new Date(Date.parse('2026-07-07T10:00:00.000Z') + (++clk) * 1000).toISOString();
  const row = store.find(r => r.id === PID);
  row.video_status = 'Tweaks Needed'; row.status = 'Tweaks Needed'; row.updated_at = now;
  row.video_comments = [{ id: 'k1', parent_id: null, author: 'Kasper', role: 'kasper', is_tweak: true, audience: 'internal', round: 1, body: 'Tighten the intro (dummy).', created_at: now, updated_at: now, done: false }];
  row.video_tweaks = JSON.stringify(row.video_comments);
  await p.waitForTimeout(4300);                       // let the SMM self-echo window pass
  await p.evaluate(s => { if (typeof _sxrV2OnRealtimeChange === 'function') _sxrV2OnRealtimeChange(s); }, SLUG);
  await p.waitForFunction(id => { const w = document.querySelector(`.cal-fld-substatus-wrap[data-substatus-pid="${id}"][data-substatus-comp="video"]`); return w && w.getAttribute('data-val') === 'Tweaks Needed'; }, PID, { timeout: 9000 });
  await p.waitForTimeout(400);
  const card2 = p.locator(`.cal-card[data-pid="${PID}"]`).first();
  const target2 = (await card2.count()) ? card2 : p.locator('#sxrBody');
  await target2.screenshot({ path: path.join(SHOTS, `sxr-status-after-${theme}.png`) });
  await ctx.close();
  console.log(`  ${theme}: before + after written`);
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  for (const theme of ['light', 'dark']) await shoot(browser, port, theme);
  await browser.close(); server.close();
  console.log('Screenshots written to qa/shots/sxr-status-{before,after}-{light,dark}.png');
})().catch(e => { console.error(e.stack || e); server.close(); process.exit(1); });
