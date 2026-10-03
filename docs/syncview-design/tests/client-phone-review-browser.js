'use strict';
/* client-phone-review-browser.js -- the client's Calendar review link, on a
 * phone, end to end, fully offline.
 *
 * Covers both client review links: the Calendar and Sample reviews.
 *
 * Why: approving and requesting a change from the client share link is what
 * clients do most, and most of them do it on a phone. This drives the real
 * index.html in a real browser at phone sizes (iPhone SE, iPhone 13/14,
 * iPhone 15 Pro Max, a small Android, iPhone SE landscape) against a
 * synthetic client whose every backend answer is local, and proves:
 *   - no sideways scrolling, at any size;
 *   - the opened card stacks Video, Thumbnail and Caption in ONE column;
 *   - every control in the review card is at least 44px tall and wide;
 *   - the note box uses 16px text (so iOS does not zoom on focus);
 *   - media never overflows the screen;
 *   - tapping Approve sends an approve write for that piece, and typing a
 *     note then tapping Request change sends a change request with that note.
 * No request leaves the machine; writes are answered locally and recorded.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

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

const CLIENT = 'Phone Fixture Client';
const SLUG = 'phonefixtureclient';
const TOKEN = 'synthetic-phone-token';
const SURFACES = {
  calendar: { panels: 3, tweakComp: 'caption', card: 'p_phone_fixture_1', query: { v: 'calendar' }, table: 'calendar_posts' },
  samples: { panels: 2, tweakComp: 'graphic', card: 'sr_phone_fixture_1', query: { v: 'sample-reviews', sxr: '1' }, table: 'sample_reviews' },
};
const CAPTION = 'A synthetic caption long enough to wrap across several lines on a narrow phone screen, so the caption panel is exercised the way a real one is. #fixture #phone';
const BASE_ROW = {
  id: '', client: SLUG, name: 'Phone fixture post', status: 'In Progress',
  scheduled_date: null, order_index: 1, updated_at: '2026-09-20T12:00:00.000Z',
  asset_url: 'https://example.invalid/video.mp4', thumbnail_url: 'http://127.0.0.1/__fixture_thumb.svg',
  video_status: 'Client Approval', graphic_status: 'Client Approval', caption_status: 'Client Approval',
  caption: CAPTION, comments: [], graphic_comments: [], caption_comments: [],
};
const THUMB = '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><rect width="1080" height="1920" fill="#c7b8ea"/></svg>';
const VIEWPORTS = [
  ['iPhone SE', 375, 667], ['iPhone 13/14', 390, 844], ['iPhone 15 Pro Max', 430, 932],
  ['small Android', 360, 800], ['iPhone SE landscape', 667, 375],
];
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
const SHEET_CARD = 'p_phone_fixture_2';
const CAP_MS = 20000;

async function run(browser, origin, [vpLabel, width, height], surfaceName) {
  const { card: CARD, query, table, panels, tweakComp } = SURFACES[surfaceName];
  const ROW = Object.assign({}, BASE_ROW, { id: CARD });
  const label = `${surfaceName} / ${vpLabel}`;
  const ROOT = surfaceName === 'calendar' ? '.cal-tab-view' : '#sxrView';
  const failures = [];
  const writes = [];
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.route('**/*', async route => {
    const r = route.request(); const u = new URL(r.url());
    if (u.pathname === '/__fixture_thumb.svg') return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: THUMB });
    if (r.url().startsWith(origin)) return route.continue();
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const json = body => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.pathname === '/functions/v1/client-token-verify') {
      let body = {}; try { body = JSON.parse(r.postData() || '{}'); } catch (e) {}
      if (body.slug !== SLUG || body.token !== TOKEN) return json({ ok: true, valid: false, allowed: false, error: 'invalid_client_link' });
      return json({ ok: true, valid: true, allowed: true, slug: SLUG, display_name: CLIENT, view: body.view, strict: true, active: true, protocol: 'syncview-client-entry-v1' });
    }
    if (r.method() !== 'GET' && r.method() !== 'HEAD') {
      writes.push({ method: r.method(), path: u.pathname, body: r.postData() || '' });
      if (/\/rest\/v1\//.test(u.pathname)) return json([Object.assign({}, ROW)]);
      return json({ ok: true });
    }
    // A second, finished post: a client link's Sheet hides work still in progress,
    // so this is the card the Sheet checks below look at. It never enters Review.
    if (u.pathname === '/rest/v1/' + table) return json([ROW, Object.assign({}, BASE_ROW, { id: SHEET_CARD + (surfaceName === 'calendar' ? '' : '_sr'), name: 'Phone fixture finished post', order_index: 2, video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Approved', status: 'Approved' })]);
    if (u.pathname === '/rest/v1/calendar_posts' || u.pathname === '/rest/v1/sample_reviews') return json([]);
    if (u.pathname === '/rest/v1/clients') return json([{ slug: SLUG, kind: 'client', active: true }]);
    // Team authority must be readable or every status write pauses safely.
    if (u.pathname === '/rest/v1/syncview_runtime_flags' && /prod_authority/.test(u.search)) return json([{ value: { video: 'linear', graphics: 'linear' } }]);
    if (/\/rest\/v1\//.test(u.pathname)) return json([]);
    if (/\/functions\/v1\/|\/webhook\//.test(u.pathname)) return json({});
    if (/docs\.google\.com/.test(u.host)) return route.fulfill({ status: 200, headers: CORS, contentType: 'text/csv', body: '' });
    return route.abort();
  });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e.message || e).slice(0, 160)));
  const q = new URLSearchParams(Object.assign({ c: CLIENT, t: TOKEN }, query));
  await page.goto(`${origin}/index.html?${q}`, { waitUntil: 'domcontentloaded' });
  const card = `.kcard[data-cal-review-pid="${CARD}"]`;
  const drew = await page.waitForSelector(card, { timeout: CAP_MS }).then(() => true, () => false);
  if (!drew) { await ctx.close(); return [`${label}: review card never drew`]; }
  await page.waitForTimeout(600);
  // Polish pass (OPEN_REPAIRS 334; Samples link since 336): the collapsed card states its
  // one action in words, the waiting pieces are not repeated as loud pills, and
  // the toolbar carries no empty band under the view switcher.
  {
    const h = await page.evaluate(([sel, ROOT]) => {
      const c = document.querySelector(sel);
      const shown = e => !!(e && e.getClientRects().length);
      const right = document.querySelector(ROOT + ' .cal-toolbar-right');
      const tb = document.querySelector(ROOT + ' .cal-toolbar').getBoundingClientRect();
      const toggle = document.querySelector(ROOT + ' .cal-view-toggle').getBoundingClientRect();
      return {
        review: getComputedStyle(c.querySelector('.kcard-expand-btn'), '::before').content,
        sheet: getComputedStyle(c.querySelector('.kcard-open-sheet'), '::after').content,
        loudPills: [...c.querySelectorAll('.cal-review-sub-pill.cal-fld-status-client-approval')].filter(shown).length,
        rightBox: right ? getComputedStyle(right).display : '',
        bandUnderToggle: Math.round(tb.bottom - toggle.bottom),
      };
    }, [card, ROOT]);
    if (!/Review/.test(h.review)) failures.push(`${label}: the collapsed card's open button does not say Review (${h.review})`);
    if (!/Open in Sheet/.test(h.sheet)) failures.push(`${label}: the Sheet button has no visible label (${h.sheet})`);
    if (h.loudPills) failures.push(`${label}: ${h.loudPills} "ready for your review" pill(s) still shown beside the sentence that already says it`);
    if (h.rightBox !== 'contents' || h.bandUnderToggle > 24) failures.push(`${label}: blank band under the view switcher (${h.bandUnderToggle}px, toolbar-right is ${h.rightBox})`);
  }
  await page.tap(`${card} .kcard-expand-btn`);
  await page.waitForSelector(`${card} .cal-review-body`, { timeout: 5000 }).catch(() => failures.push(`${label}: card did not open`));
  await page.waitForTimeout(400);

  const m = await page.evaluate(sel => {
    const W = document.documentElement.clientWidth;
    const c = document.querySelector(sel);
    const panels = [...c.querySelectorAll('.cal-review-panel')].map(p => p.getBoundingClientRect());
    const controls = [...c.querySelectorAll('button, a, textarea')].filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden')
      .map(e => { const r = e.getBoundingClientRect(); return { what: (e.getAttribute('aria-label') || e.innerText || e.className).trim().slice(0, 30), w: r.width, h: r.height }; });
    const media = [...c.querySelectorAll('img, video, iframe, .cal-review-video-tile')].filter(e => e.getClientRects().length)
      .map(e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right }; });
    const textareas = [...c.querySelectorAll('textarea')].map(t => parseFloat(getComputedStyle(t).fontSize));
    return { W, scrollW: document.documentElement.scrollWidth, panels: panels.map(r => [Math.round(r.left), Math.round(r.width)]), controls, media, textareas };
  }, card);
  if (m.scrollW > m.W) failures.push(`${label}: page scrolls sideways (${m.scrollW}px content in a ${m.W}px screen)`);
  if (m.panels.length !== panels) failures.push(`${label}: expected ${panels} review panels, found ${m.panels.length}`);
  if (new Set(m.panels.map(p => p[0])).size !== 1) failures.push(`${label}: panels are not stacked in one column (${JSON.stringify(m.panels)})`);
  for (const c of m.controls) if (c.w < 44 || c.h < 44) failures.push(`${label}: "${c.what}" is ${Math.round(c.w)}x${Math.round(c.h)}px, under 44px`);
  for (const t of m.textareas) if (t < 16) failures.push(`${label}: note box text is ${t}px, under 16px (iOS will zoom)`);
  for (const x of m.media) if (x.left < -0.5 || x.right > m.W + 0.5) failures.push(`${label}: media overflows the screen (${Math.round(x.left)}..${Math.round(x.right)})`);

  // Approve the video with a tap.
  const approve = `${card} .cal-review-panel[data-comp="video"] .cal-review-approve-btn`;
  await page.locator(approve).scrollIntoViewIfNeeded();
  const before = writes.length;
  await page.tap(approve);
  await page.waitForTimeout(400);
  // Approving asks for confirmation first; that dialog must be thumb-sized too.
  const confirm = await page.evaluate(() => {
    const o = document.querySelector('#confirmOverlay.active');
    if (!o) return null;
    const W = document.documentElement.clientWidth;
    const box = (o.firstElementChild || o).getBoundingClientRect();
    return { text: o.innerText.replace(/\s+/g, ' ').trim().slice(0, 200), fits: box.left >= -0.5 && box.right <= W + 0.5,
      buttons: [...o.querySelectorAll('button')].filter(b => b.getClientRects().length).map(b => { const r = b.getBoundingClientRect(); return { what: b.innerText.trim(), w: r.width, h: r.height }; }) };
  });
  if (confirm) {
    if (process.env.CLIENT_PHONE_DEBUG) console.log(label, 'confirm:', JSON.stringify(confirm));
    if (!confirm.fits) failures.push(`${label}: approve confirmation is wider than the screen`);
    for (const b of confirm.buttons) if (b.w < 44 || b.h < 44) failures.push(`${label}: confirmation "${b.what}" is ${Math.round(b.w)}x${Math.round(b.h)}px, under 44px`);
    await page.tap('#confirmYes');
  }
  await page.waitForTimeout(1500);
  const approveWrites = writes.slice(before);
  if (!approveWrites.length) failures.push(`${label}: tapping Approve video sent no write`);
  else if (!approveWrites.some(w => w.body.includes('"video_status":"Approved"') && w.body.includes(CARD))) failures.push(`${label}: Approve sent writes that do not approve: ${approveWrites.map(w => w.method + ' ' + w.path).join(', ')}`);

  // Request a change (caption on the Calendar, thumbnail on Samples): type a note, tap Request change.
  const panel = `${card} .cal-review-panel[data-comp="${tweakComp}"]`;
  const note = 'Phone fixture: please shorten the first line.';
  await page.locator(`${panel} .cal-review-textarea`).scrollIntoViewIfNeeded();
  await page.tap(`${panel} .cal-review-textarea`);
  await page.keyboard.type(note);
  const tweak = `${panel} .cal-review-tweak-btn`;
  if (await page.locator(tweak).isDisabled()) failures.push(`${label}: Request change stayed disabled after typing a note`);
  const before2 = writes.length;
  await page.tap(tweak);
  await page.waitForTimeout(1500);
  const tweakWrites = writes.slice(before2);
  if (!tweakWrites.some(w => w.body.includes('shorten the first line'))) failures.push(`${label}: Request change did not send the note (${tweakWrites.map(w => w.method + ' ' + w.path).join(', ') || 'no writes'})`);
  const after = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  if (after) failures.push(`${label}: page scrolls sideways after the change request`);
  // Screen 2 (OPEN_REPAIRS 335; Samples link since 336): the Sheet is a feed of full-width
  // cards that never widens the page, its fields are thumb-sized, and Notes opens
  // as a full-screen sheet with thumb-sized controls. Month and Week must not
  // widen the page either.
  {
    const wide = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    // The fixture's stand-in backend never confirms the change request above, so a
    // "not saved" notice can arrive late; dismiss it rather than let it cover the page.
    const dismissNotice = async () => { if (await page.locator('#confirmOverlay.active').count()) { await page.tap('#confirmOverlay.active #confirmYes').catch(() => {}); await page.waitForTimeout(250); } };
    await page.waitForTimeout(1200);
    await dismissNotice();
    await page.locator(ROOT + ' .cal-view-btn', { hasText: 'Sheet' }).tap();
    await page.waitForSelector(ROOT + ' .cal-organizer-strip .cal-card', { timeout: 8000 }).catch(() => failures.push(`${label}: Sheet drew no card`));
    await page.waitForTimeout(500);
    const sh = await page.evaluate(ROOT => {
      const W = document.documentElement.clientWidth;
      const strip = document.querySelector(ROOT + ' .cal-organizer-strip');
      const c = strip && strip.querySelector('.cal-card');
      if (!c) return null;
      const r = c.getBoundingClientRect();
      const small = [...c.querySelectorAll('.cal-date-chip, .cal-link-pill-open, .cal-fld-cta, .cal-comments-btn')].filter(e => e.getClientRects().length)
        .map(e => ({ what: String(e.className).split(' ')[0], h: e.getBoundingClientRect().height })).filter(x => x.h < 44);
      const fonts = [...c.querySelectorAll('textarea, input[type="text"]')].filter(e => e.getClientRects().length && !e.readOnly).map(e => parseFloat(getComputedStyle(e).fontSize)).filter(f => f < 16);
      return { W, left: r.left, right: r.right, dir: getComputedStyle(strip).flexDirection, toggleRight: document.querySelector(ROOT + ' .cal-view-toggle').getBoundingClientRect().right, small, fonts };
    }, ROOT);
    if (!sh) failures.push(`${label}: Sheet card not found`);
    else {
      if (sh.dir !== 'column') failures.push(`${label}: Sheet cards are not stacked (${sh.dir})`);
      if (sh.left < -0.5 || sh.right > sh.W + 0.5) failures.push(`${label}: Sheet card runs off the screen (${Math.round(sh.left)}..${Math.round(sh.right)} of ${sh.W})`);
      if (sh.toggleRight > sh.W + 0.5) failures.push(`${label}: the view switcher is cut off on the Sheet (${Math.round(sh.toggleRight)} of ${sh.W})`);
      for (const x of sh.small) failures.push(`${label}: Sheet "${x.what}" is ${Math.round(x.h)}px tall, under 44px`);
      if (sh.fonts.length) failures.push(`${label}: a Sheet text field uses ${sh.fonts[0]}px text, under 16px (iOS will zoom)`);
    }
    if (await wide() > 0) failures.push(`${label}: the Sheet scrolls sideways`);
    await page.tap(ROOT + ' .cal-organizer-strip .cal-card .cal-comments-btn');
    await page.waitForSelector('.cal-comments-overlay.open', { timeout: 5000 }).catch(() => failures.push(`${label}: Notes did not open`));
    await page.waitForTimeout(300);
    const notes = await page.evaluate(() => {
      const o = document.querySelector('.cal-comments-overlay.open'); if (!o) return null;
      const m = o.querySelector('.cal-comments-modal').getBoundingClientRect();
      return { W: document.documentElement.clientWidth, left: m.left, width: m.width,
        small: [...o.querySelectorAll('button')].filter(b => b.getClientRects().length).map(b => { const r = b.getBoundingClientRect(); return { what: (b.getAttribute('aria-label') || b.innerText || b.className).trim().slice(0, 24), w: r.width, h: r.height }; }).filter(b => b.w < 44 || b.h < 44),
        font: (t => t ? parseFloat(getComputedStyle(t).fontSize) : 16)(o.querySelector('.cal-cm-composer textarea')) };
    });
    if (notes) {
      if (Math.abs(notes.left) > 0.5 || Math.abs(notes.width - notes.W) > 0.5) failures.push(`${label}: Notes is not full width (${Math.round(notes.left)}, ${Math.round(notes.width)} of ${notes.W})`);
      for (const b of notes.small) failures.push(`${label}: Notes "${b.what}" is ${Math.round(b.w)}x${Math.round(b.h)}px, under 44px`);
      if (notes.font < 16) failures.push(`${label}: Notes message box text is ${notes.font}px, under 16px (iOS will zoom)`);
      await dismissNotice();
      await page.tap('.cal-comments-overlay.open .cal-comments-close');
      await page.waitForTimeout(300);
    }
    for (const v of surfaceName === 'calendar' ? ['month', 'week'] : []) {
      await page.tap(`.cal-tab-view [data-cal-view="${v}"]`);
      await page.waitForTimeout(700);
      if (await wide() > 0) failures.push(`${label}: ${v} view scrolls sideways`);
      const cut = await page.evaluate(() => { const l = document.querySelector('.cal-tab-view .cal-month-label'); return l ? l.scrollWidth - l.clientWidth : 0; });
      if (cut > 1) failures.push(`${label}: the ${v} title is cut off by ${cut}px`);
    }
  }
  if (pageErrors.length) failures.push(`${label}: page errors: ${pageErrors.slice(0, 2).join(' | ')}`);
  if (process.env.CLIENT_PHONE_SHOTS) {
    fs.mkdirSync(process.env.CLIENT_PHONE_SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(process.env.CLIENT_PHONE_SHOTS, `${surfaceName}-${width}x${height}.png`), fullPage: true });
  }
  if (process.env.CLIENT_PHONE_DEBUG) console.log(label, JSON.stringify({ approveWrites, tweakWrites }).slice(0, 2000));
  await ctx.close();
  return failures;
}

(async () => {
  const server = await serve();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  try {
    for (const surface of Object.keys(SURFACES)) for (const vp of VIEWPORTS) {
      const f = await run(browser, origin, vp, surface);
      console.log(`${f.length ? 'FAIL' : 'ok  '} ${surface} ${vp[0]} ${vp[1]}x${vp[2]}`);
      failures.push(...f);
    }
  } finally { await browser.close(); server.close(); }
  if (failures.length) { console.error('\n' + failures.join('\n')); process.exit(1); }
  console.log(`\nclient-phone-review: OK (${Object.keys(SURFACES).join(' + ')}, ${VIEWPORTS.length} phone sizes each, approve + request change)`);
})().catch(e => { console.error(e); process.exit(2); });
