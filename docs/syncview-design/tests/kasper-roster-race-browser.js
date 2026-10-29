'use strict';
/* kasper-roster-race-browser.js -- Kasper's review queue and a slow client list,
 * in a real browser, fully offline.
 *
 * Found live 2026-10-29: the queue was read while the client list was still the
 * seed, so it came back short (4 cards, then 12 on the next load) under a red
 * notice that named client slugs. With every backend answer local and the
 * Clients Info read held back, this proves:
 *   - while the list is loading, the page shows the card skeleton, never a
 *     short queue and never the "not shown" notice;
 *   - once the list is in, every card at Kasper Approval is drawn at once;
 *   - a client that really is not on the list is reported as a count in plain
 *     words, and the notice carries no client name or slug;
 *   - nothing writes.
 * All data is fictional; the clients are invented names.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const { seedStaffIdentity, refuseStubKeyProductionWrite } = require('../../../qa/staff-gate-seed');

const root = path.resolve(__dirname, '..', '..', '..');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let file = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    file = path.normalize(file).replace(/^([.][\\/])+/, '');
    const full = path.join(root, file);
    if (!full.startsWith(root) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(full).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(full).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
const ROSTER_DELAY_MS = 4000;
// Two invented clients that only the Clients Info sheet knows (not the seed list),
// and the main test client, which the seed list already has.
const SHEET_ONLY = ['Example Studio', 'Sample Workshop'];
const UNLISTED = 'Nowhere Example';
const row = (id, client) => ({
  id, client, name: 'Fixture card ' + id, status: 'Kasper Approval', post_type: 'Reel', type: 'Reel',
  video_status: 'Kasper Approval', graphic_status: 'Kasper Approval', caption_status: 'Kasper Approval',
  caption: 'A short fictional caption.', asset_url: 'https://media.example.invalid/' + id,
  thumbnail_url: 'https://images.example.invalid/' + id + '.png', scheduled_date: '2026-11-12',
  platforms: ['instagram'], tweaks: [], updated_at: '2026-10-28T10:00:00Z', order_index: 1,
});
const slug = s => s.toLowerCase().replace(/[^a-z0-9&]+/g, '');

async function open(browser, origin, { withUnlisted }) {
  const rows = [
    row('p_race_1', 'sidneylaruel'),
    row('p_race_2', slug(SHEET_ONLY[0])), row('p_race_3', slug(SHEET_ONLY[0])),
    row('p_race_4', slug(SHEET_ONLY[1])),
  ];
  if (withUnlisted) rows.push(row('p_race_5', slug(UNLISTED)));
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const writes = [];
  let rosterServedAt = 0;
  await ctx.route(u => !u.toString().startsWith(origin), async route => {
    const r = route.request(); const u = new URL(r.url());
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const json = b => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.hostname === 'docs.google.com') {
      const sheet = u.searchParams.get('sheet') || '';
      if (sheet === 'Clients Info') {
        await new Promise(res => setTimeout(res, ROSTER_DELAY_MS));
        rosterServedAt = Date.now();
        const csv = '"client_name"\n' + ['sidneylaruel', ...SHEET_ONLY].map(n => '"' + n + '"').join('\n');
        return route.fulfill({ status: 200, headers: CORS, contentType: 'text/csv', body: csv }).catch(() => {});
      }
      return route.fulfill({ status: 200, headers: CORS, contentType: 'text/csv', body: '"client_name"\n' });
    }
    if (u.pathname === '/functions/v1/key-verify') return json({ ok: true, role: 'admin', member: { id: 'qa_admin', name: 'QA admin', role: 'admin', team: null } });
    if (r.method() !== 'GET' && !/functions\/v1\/(key-verify|write-diagnostics|analytics-read)/.test(u.pathname)) writes.push(r.method() + ' ' + u.pathname);
    if (u.pathname === '/rest/v1/calendar_posts') {
      const eq = (u.searchParams.get('client') || '').replace(/^eq\./, '');
      const after = u.searchParams.getAll('or').some(v => /id\.gt\./.test(v));
      return json(after ? [] : rows.filter(x => !eq || x.client === eq));
    }
    if (/rest\/v1/.test(u.pathname)) return json([]);
    if (/functions|webhook/.test(u.pathname)) return json({});
    return route.abort();
  });
  await seedStaffIdentity(ctx, { id: 'qa_admin', name: 'QA admin', role: 'admin', team: null }, 'qa-admin-key');
  await refuseStubKeyProductionWrite(ctx);
  await ctx.addInitScript(() => {
    try { sessionStorage.setItem('syncview_kasper_unlocked', 'ok'); } catch (e) {}
    // Every frame the review body is drawn in, as the person would have seen it.
    window.__raceSeen = [];
    const look = () => {
      const body = document.getElementById('kasperReviewBody');
      if (!body) return;
      window.__raceSeen.push({
        at: Date.now(),
        cards: body.querySelectorAll('.kcard[data-kasper-pid]').length,
        skeleton: !!body.querySelector('.kasper-skeleton-list'),
        notice: (document.querySelector('[data-kasper-unlisted]') || {}).innerText || '',
      });
    };
    new MutationObserver(look).observe(document, { childList: true, subtree: true });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 160)));
  const startedAt = Date.now();
  await page.goto(origin + '/#kasper', { waitUntil: 'domcontentloaded' });
  return { ctx, page, writes, errors, startedAt, rosterAt: () => rosterServedAt };
}

(async () => {
  const server = await serve();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  try {
    // 1. The race: list held back 4 s. The queue must wait, then draw all four.
    {
      const s = await open(browser, origin, { withUnlisted: false });
      await s.page.waitForFunction(() => document.getElementById('kasperReviewBody'), null, { timeout: 20000 })
        .catch(() => failures.push('race: the review body never rendered'));
      await s.page.waitForTimeout(1500);
      const mid = await s.page.evaluate(() => {
        const body = document.getElementById('kasperReviewBody');
        return { cards: body.querySelectorAll('.kcard[data-kasper-pid]').length, skeleton: !!body.querySelector('.kasper-skeleton-list') };
      });
      if (!s.rosterAt() && mid.cards) failures.push(`race: ${mid.cards} card(s) drawn before the client list arrived`);
      if (!s.rosterAt() && !mid.skeleton) failures.push('race: no card skeleton while the client list was loading');
      await s.page.waitForFunction(() => document.querySelectorAll('#kasperReviewBody .kcard[data-kasper-pid]').length >= 4, null, { timeout: 25000 })
        .catch(() => failures.push('race: the four cards never appeared'));
      await s.page.waitForTimeout(800);
      const seen = await s.page.evaluate(() => window.__raceSeen);
      const shortDraw = seen.find(f => f.cards > 0 && f.cards < 4);
      if (shortDraw) failures.push(`race: a short queue of ${shortDraw.cards} card(s) was drawn`);
      if (seen.some(f => f.notice)) failures.push('race: the "not shown" notice appeared although every client was on the list once it loaded');
      const final = seen[seen.length - 1] || {};
      if (final.cards !== 4) failures.push(`race: ended with ${final.cards} cards, wanted 4`);
      if (s.writes.length) failures.push('race: writes were sent: ' + s.writes.join(', '));
      if (s.errors.length) failures.push('race: page errors: ' + s.errors.join(' | '));
      if (process.env.RACE_SHOTS) await s.page.screenshot({ path: path.join(process.env.RACE_SHOTS, 'kasper-roster-race.png') });
      await s.ctx.close();
    }
    // 2. A client that really is not on the list: a count in plain words, no slug.
    {
      const s = await open(browser, origin, { withUnlisted: true });
      await s.page.waitForSelector('[data-kasper-unlisted]', { timeout: 25000 })
        .catch(() => failures.push('unlisted: no notice for a client missing from the list'));
      const notice = await s.page.$eval('[data-kasper-unlisted]', e => e.innerText).catch(() => '');
      const cards = await s.page.$$eval('#kasperReviewBody .kcard[data-kasper-pid]', l => l.length).catch(() => 0);
      if (cards !== 4) failures.push(`unlisted: ${cards} cards drawn, wanted the 4 listed ones`);
      if (!/1 client/.test(notice)) failures.push(`unlisted: the notice does not give a count: "${notice}"`);
      if (/still loading/i.test(notice)) failures.push('unlisted: the notice says the list is loading after it loaded');
      const lower = notice.toLowerCase();
      for (const bad of [slug(UNLISTED), UNLISTED.toLowerCase(), 'sidneylaruel', ...SHEET_ONLY.map(slug)])
        if (lower.includes(bad)) failures.push('unlisted: the notice names a client');
      if (s.writes.length) failures.push('unlisted: writes were sent: ' + s.writes.join(', '));
      if (s.errors.length) failures.push('unlisted: page errors: ' + s.errors.join(' | '));
      await s.ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('kasper-roster-race-browser FAILED:\n  ' + failures.join('\n  ')); process.exit(1); }
  console.log('kasper-roster-race-browser: the queue waits for the client list, draws whole, and the notice names no client');
})().catch(e => { console.error(e); process.exit(1); });
