'use strict';
/* carousel-preview-browser.js -- the carousel preview (session Carouselbuild, OPEN_REPAIRS 710), real generated app,
 * synthetic client, every backend answer local. Covers, on the CLIENT link (desktop and phone) and the STAFF calendar:
 *   - flag off: a folder card stays "Open folder", a no-video thumbnail opens nothing (today's behaviour, byte for byte);
 *   - flag on: the first image by name replaces the folder card in Month and Week, with a count chip;
 *   - a no-video (carousel) thumbnail on the client link opens the card view, whose stage shows the first image,
 *     "Carousel . N images" and "Open in Drive", with "About this post" (thumbnail + caption, Show more) in Notes;
 *   - a reel (Frame link) still opens its own stage, and the not-shared folder keeps the folder card (staff see the note);
 *   - the server was asked with action folder_preview and the client's slug, and no token travels in the page.
 * Env: CAROUSEL_SHOTS_DIR saves screenshots; CAROUSEL_SHARED_URL / CAROUSEL_PRIVATE_URL / CAROUSEL_IMG_DIR (files 01..03.png
 * named in CAROUSEL_FILE_IDS) feed a real folder through the same code path for the owner's sample. Defaults are synthetic.
 * Dates follow today: no month is hard-coded. */
const fs = require('fs');
const http = require('http');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');
const { seedStaffGate, seedStaffIdentity } = require('../qa/staff-gate-seed.js');

const root = path.resolve(__dirname, '..');
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
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
const CLIENT = 'Carousel Fixture Client';
const SLUG = 'carouselfixtureclient';
const TOKEN = 'synthetic-carousel-token';
const SHARED_URL = process.env.CAROUSEL_SHARED_URL || 'https://drive.google.com/drive/folders/SYNTHETICSHAREDFOLDER0001';
const PRIVATE_URL = process.env.CAROUSEL_PRIVATE_URL || 'https://drive.google.com/drive/folders/SYNTHETICPRIVATEFOLDER001';
const folderIdOf = u => (u.match(/folders\/([A-Za-z0-9_-]+)/) || [])[1];
const FILE_IDS = (process.env.CAROUSEL_FILE_IDS || 'SYNTHFILEAAAAAAAAAAAA1,SYNTHFILEBBBBBBBBBBBB2,SYNTHFILECCCCCCCCCCCC3').split(',');
const IMG_DIR = process.env.CAROUSEL_IMG_DIR || '';
const SHOTS = process.env.CAROUSEL_SHOTS_DIR || '';
const CAPTION = 'Five tips for a calmer morning. Slow down, drink water, and write one thing you are grateful for. Save this for tomorrow and send it to a friend who needs it. #mornings #calm';
const FRAME = 'https://f.io/synthFrame1';
const svgFor = (n) => `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d97706"/><stop offset="1" stop-color="#7c2d12"/></linearGradient></defs><rect width="800" height="1000" fill="url(#g)"/><text x="400" y="520" font-size="120" text-anchor="middle" fill="#fff" font-family="sans-serif">Slide ${n}</text></svg>`;

const pad = n => String(n).padStart(2, '0');
const today = new Date();
const monthDay = d => `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(d)}`;
// Three posts on three days of THIS month (days 10 to 12): never a hard-coded month.
function rows(slug) {
  const base = { client: slug, status: 'In Progress', order_index: 1, updated_at: new Date().toISOString(), video_status: 'Client Approval', graphic_status: 'Client Approval', caption_status: 'Client Approval', caption: CAPTION, comments: [], graphic_comments: [], caption_comments: [], asset_url: '' };
  return [
    Object.assign({}, base, { id: 'p_car_shared', name: 'Carousel shared', scheduled_date: monthDay(10), thumbnail_url: SHARED_URL }),
    Object.assign({}, base, { id: 'p_car_private', name: 'Carousel private', scheduled_date: monthDay(11), thumbnail_url: PRIVATE_URL }),
    { id: 'p_cal_settings', client: slug, caption: JSON.stringify({ collab_mode: true }) },
    Object.assign({}, base, { id: 'p_car_reel', name: 'Reel with video', scheduled_date: monthDay(12), asset_url: FRAME, thumbnail_url: '' }),
  ];
}

// flagOn: true = { clients: [SLUG] }; false = no row; an object = that flag value (e.g. { clients: [], viewers: [...] }).
async function install(ctx, origin, flagOn, calls) {
  const flagValue = flagOn === true ? { clients: [SLUG] } : (flagOn || null);
  await ctx.route('**/*', async route => {
    const r = route.request(); const u = new URL(r.url());
    if (r.url().startsWith(origin)) return route.continue();
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const json = body => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.hostname === 'drive.google.com' && u.pathname === '/thumbnail') {
      const id = u.searchParams.get('id'); calls.images.push(id);
      const i = FILE_IDS.indexOf(id);
      if (IMG_DIR && i >= 0 && fs.existsSync(path.join(IMG_DIR, `0${i + 1}.png`))) return route.fulfill({ status: 200, contentType: 'image/png', body: fs.readFileSync(path.join(IMG_DIR, `0${i + 1}.png`)) });
      return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svgFor(i + 1) });
    }
    if (u.pathname === '/functions/v1/client-token-verify') {
      let body = {}; try { body = JSON.parse(r.postData() || '{}'); } catch (e) {}
      return json({ ok: true, valid: true, allowed: true, slug: SLUG, display_name: CLIENT, view: body.view, strict: true, active: true, protocol: 'syncview-client-entry-v1' });
    }
    if (u.pathname === '/functions/v1/thumbnail-folder-resolve') {
      let body = {}; try { body = JSON.parse(r.postData() || '{}'); } catch (e) {}
      calls.preview.push({ body, headers: r.headers() });
      if (!flagValue) return json({ ok: true, enabled: false });
      // The server's rule, mirrored: a listed client, or a listed viewer's real staff key (test key = the seed's).
      const h = r.headers();
      const viaClient = (flagValue.clients || []).includes(SLUG);
      const viaViewer = !!h['x-syncview-key'] && (flagValue.viewers || []).map(v => String(v).toLowerCase()).includes(String(h['x-syncview-actor'] || '').toLowerCase());
      if (!viaClient && !viaViewer) return json({ ok: true, enabled: false });
      if (folderIdOf(String(body.folder_url || '')) === folderIdOf(SHARED_URL)) return json({ ok: true, enabled: true, state: 'ok', count: FILE_IDS.length, has_video: false, first_file_id: FILE_IDS[0] });
      return json({ ok: true, enabled: true, state: 'not_shared', count: 0, has_video: false, first_file_id: '' });
    }
    if (r.method() !== 'GET' && r.method() !== 'HEAD') { calls.writes.push(u.pathname); return json({ ok: true }); }
    if (u.pathname === '/rest/v1/calendar_posts') return json(rows(SLUG));
    if (u.pathname === '/rest/v1/clients') return json([{ slug: SLUG, name: CLIENT, display_name: CLIENT, kind: 'client', active: true }]);
    if (u.pathname === '/rest/v1/syncview_runtime_flags') {
      const q = decodeURIComponent(u.search);
      const out = [];
      if (/prod_authority/.test(q)) out.push({ key: 'prod_authority', value: { video: 'linear', graphics: 'linear' } });
      if (/carousel_preview_v1/.test(q) && flagValue) out.push({ key: 'carousel_preview_v1', value: flagValue });
      if (/frame_viewer_clients/.test(q)) out.push({ key: 'frame_viewer_clients', value: { clients: [SLUG] } });
      return json(out);
    }
    if (/\/rest\/v1\//.test(u.pathname)) return json([]);
    if (/\/functions\/v1\/|\/webhook\//.test(u.pathname)) return json({});
    if (/docs\.google\.com/.test(u.host)) return route.fulfill({ status: 200, headers: CORS, contentType: 'text/csv', body: '' });
    return route.abort();
  });
}

let checks = 0;
const ok = (v, m) => { assert(v, m); checks++; };
const shot = async (page, name) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(250); await page.screenshot({ path: path.join(SHOTS, name + '.png'), animations: 'disabled' }); };

async function openClientMonth(browser, origin, { flagOn, width, height }) {
  const calls = { preview: [], images: [], writes: [] };
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: width < 600, hasTouch: width < 600, colorScheme: 'light', reducedMotion: 'reduce' });
  await install(ctx, origin, flagOn, calls);
  await ctx.addInitScript(() => localStorage.setItem('syncview_theme', 'light'));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
  await page.goto(`${origin}/index.html?${new URLSearchParams({ c: CLIENT, t: TOKEN, v: 'calendar' })}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-cal-view=month]', { timeout: 20000 });
  await page.locator('[data-cal-view=month]').click();
  await page.waitForSelector('.cal-month-pill', { timeout: 20000 }).catch(async e => { console.log('ERR', errors); if (SHOTS) await page.screenshot({ path: path.join(SHOTS || '.', 'debug.png') }); throw e; });
  return { ctx, page, calls, errors };
}

(async () => {
  const server = await serve();
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try { browser = await chromium.launch(); }
  catch (e) { if (!fs.existsSync('/opt/pw-browsers/chromium')) throw e; browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] }); }
  try {
    // ---- 1. Flag OFF: today's page, nothing asked of the server ----
    {
      const { ctx, page, calls, errors } = await openClientMonth(browser, origin, { flagOn: false, width: 1280, height: 860 });
      await page.waitForTimeout(800);
      ok(calls.preview.length === 0, 'flag off: no folder_preview request');
      ok(await page.locator('.cal-month-pill-thumb .sv-car-mini').count() === 0, 'flag off: no count chip');
      const pill = page.locator('.cal-month-pill', { hasText: 'Carousel shared' });
      ok(await pill.locator('.cal-month-pill-thumb.is-frame').count() === 1, 'flag off: the folder stays the folder glyph');
      await pill.locator('.cal-month-pill-thumb').click();
      await page.waitForTimeout(500);
      ok(await page.locator('#calCommentsModal .cal-comments-head').count() === 0 || !(await page.locator('#calCommentsOverlay.open, #calCommentsOverlay.show').count()), 'flag off: a carousel thumbnail still opens no card view');
      ok(await page.locator('.sv-car-about').count() === 0, 'flag off: no About this post');
      ok(errors.length === 0, 'flag off: page errors ' + errors.join(' | '));
      await ctx.close();
    }
    // ---- 2. Flag ON, desktop client link ----
    for (const [label, width, height] of [['desktop', 1280, 860], ['phone', 390, 844]]) {
      const { ctx, page, calls, errors } = await openClientMonth(browser, origin, { flagOn: true, width, height });
      await page.waitForSelector('.cal-month-pill .sv-car-mini', { timeout: 15000 });
      ok(calls.preview.length >= 1 && calls.preview.every(c => c.body.action === 'folder_preview' && c.body.client === SLUG), label + ': the server was asked with the folder_preview action and the client slug');
      ok(!calls.preview.some(c => JSON.stringify(c.body).includes(TOKEN)), label + ': no token in the preview request body');
      // The shared folder: first image + count chip. The private one keeps the folder glyph. A client sees no note.
      const shared = page.locator('.cal-month-pill', { hasText: 'Carousel shared' });
      ok(await shared.locator('.cal-month-pill-thumb img').count() === 1, label + ': shared folder shows its first image in Month');
      ok((await shared.locator('.sv-car-mini').textContent()).trim() === String(FILE_IDS.length), label + ': count chip says how many images');
      ok(calls.images.includes(FILE_IDS[0]) && !calls.images.includes(FILE_IDS[1]), label + ': only the FIRST image by name is drawn');
      const priv = page.locator('.cal-month-pill', { hasText: 'Carousel private' });
      ok(await priv.locator('.cal-month-pill-thumb.is-frame').count() === 1, label + ': a folder that is not shared keeps the folder icon');
      ok(await priv.locator('.has-share-note').count() === 0, label + ': a client is not shown the share note');
      await shot(page, `client-${label}-month`);
      // Week view
      await page.locator('[data-cal-view=week]').click();
      if (!await page.locator('.cal-week-card').count()) { for (let i = 0; i < 6 && !await page.locator('.cal-week-card').count(); i++) await page.locator('.cal-nav-btn').last().click(); }
      // Opening the carousel from its thumbnail (Month): the card view with the stage.
      await page.locator('[data-cal-view=month]').click();
      await page.waitForSelector('.cal-month-pill', { timeout: 10000 });
      await page.locator('.cal-month-pill', { hasText: 'Carousel shared' }).locator('.cal-month-pill-thumb').click();
      await page.waitForSelector('#calNotesStage .sv-car-frame img', { timeout: 10000 });
      ok(await page.locator('#calNotesShell[data-video]').count() === 1, label + ': the card view takes the stage shape');
      const badge = (await page.locator('#calNotesStage .sv-car-pill').first().textContent()).trim();
      ok(/Carousel\s+·\s+3 images/.test(badge), label + ': badge reads "Carousel · 3 images" (got ' + badge + ')');
      ok((await page.locator('#calNotesStage a.is-open').getAttribute('href')) === SHARED_URL, label + ': "Open in Drive" opens the folder');
      ok(await page.locator('#calCommentsModal .sv-car-about').count() === 1, label + ': About this post is in the Notes column');
      ok((await page.locator('.sv-car-about-cap').textContent()).includes('calmer morning'), label + ': About this post shows the caption');
      ok(await page.locator('.sv-car-about textarea, .sv-car-about input').count() === 0, label + ': About this post is read only');
      ok(await page.locator('.sv-car-more').count() === 1, label + ': a long caption offers Show more');
      const clamped = await page.locator('.sv-car-about-cap').evaluate(e => e.scrollHeight > e.clientHeight + 1);
      ok(clamped, label + ': the caption is cut at three lines');
      await shot(page, `client-${label}-carousel-card`);
      await page.locator('.sv-car-more').click();
      ok(await page.locator('.sv-car-about-cap.is-open').count() === 1 && (await page.locator('.sv-car-more').textContent()).trim() === 'Show less', label + ': Show more opens the whole caption');
      await shot(page, `client-${label}-about-this-post`);
      ok(await page.locator('.cal-comments-composer, #calCommentComposer').count() >= 1, label + ': the notes composer is still there');
      // order on phone: stage, About, feed
      const order = await page.evaluate(() => { const y = s => (document.querySelector(s) || { getBoundingClientRect: () => ({ top: -1 }) }).getBoundingClientRect().top; return [y('#calNotesStage'), y('.sv-car-about'), y('#calCommentsFeed')]; });
      ok(order[0] < order[1] && order[1] < order[2], label + ': stage, then About this post, then the notes');
      await page.locator('.cal-comments-close').click();
      await page.waitForTimeout(300);
      // A reel still opens its own player stage, never the carousel one.
      await page.locator('.cal-month-pill', { hasText: 'Reel with video' }).locator('.cal-month-pill-thumb').click();
      await page.waitForSelector('#calNotesStage .fv-player', { timeout: 10000 });
      ok(await page.locator('#calNotesStage .sv-car-frame').count() === 0, label + ': a reel keeps the video stage');
      ok(await page.locator('.sv-car-about').count() === 1, label + ': a reel also gets About this post');
      await shot(page, `client-${label}-reel-card`);
      await page.locator('.cal-comments-close').click();
      await page.waitForTimeout(300);
      // The private carousel opens the card view too, with the folder card and no note for a client.
      await page.locator('.cal-month-pill', { hasText: 'Carousel private' }).locator('.cal-month-pill-thumb').click();
      await page.waitForSelector('#calNotesStage .sv-car-folder', { timeout: 10000 });
      ok(await page.locator('#calNotesStage .sv-car-share-note').count() === 0, label + ': the client is not told to share the folder');
      ok(await page.locator('#calNotesStage a.sv-car-folder').getAttribute('href') === PRIVATE_URL, label + ': the folder card opens the folder');
      await shot(page, `client-${label}-private-card`);
      await page.locator('.cal-comments-close').click();
      ok(errors.length === 0, label + ': page errors ' + errors.join(' | '));
      await ctx.close();
    }

    // ---- 3. Staff Calendar: Month, Week and the card (Sheet) thumbnail ----
    {
      const calls = { preview: [], images: [], writes: [] };
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'light', reducedMotion: 'reduce' });
      await install(ctx, origin, true, calls);
      await seedStaffGate(ctx);
      await ctx.addInitScript(() => localStorage.setItem('syncview_theme', 'light'));
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
      await page.goto(origin + '/index.html#calendar', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof navTo === 'function');
      await page.evaluate(() => navTo('calendar'));
      await page.locator('#calView').waitFor();
      const setView = view => page.evaluate(({ posts, view, client }) => {
        _calInvalidateActiveLoad(); calState.loading = false; calState.error = ''; calState.client = client; calState.posts = posts;
        calState.view = view; calState.monthFilter = 'all'; calState.statusFilter = 'all'; _calSavePins([client]); _calRenderShell(); _calRenderBody();
      }, { posts: rows(SLUG).filter(r => r.name), view, client: CLIENT });
      await setView('month');
      await page.waitForSelector('.cal-month-pill .sv-car-mini', { timeout: 15000 });
      ok(calls.preview.every(c => c.body.action === 'folder_preview'), 'staff: preview asked with the action');
      const priv = page.locator('.cal-month-pill', { hasText: 'Carousel private' });
      await priv.locator('.has-share-note').waitFor({ timeout: 10000 });
      ok((await priv.locator('.has-share-note').getAttribute('title')).includes('Anyone with the link'), 'staff: the not-shared folder icon carries the share note');
      await shot(page, 'staff-month');
      await setView('week');
      await page.waitForSelector('.cal-week-card', { timeout: 10000 });
      for (let i = 0; i < 6 && !await page.locator('.cal-week-card-thumb .sv-car-mini').count(); i++) { await page.locator('.cal-nav-btn').last().click().catch(() => {}); await page.waitForTimeout(200); }
      ok(await page.locator('.cal-week-card-thumb .sv-car-mini').count() >= 1, 'staff: Week shows the count chip');
      await shot(page, 'staff-week');
      await setView('organizer');
      await page.waitForSelector('.cal-card-thumb .sv-car-bdg', { timeout: 10000 });
      ok(/Carousel\s+·\s+3 images/.test(await page.locator('.cal-card-thumb .sv-car-pill').first().textContent()), 'staff: the card thumbnail carries the Carousel badge');
      await page.locator('.cal-card-thumb .sv-car-share-note').first().waitFor({ timeout: 10000 });
      ok((await page.locator('.cal-card-thumb .sv-car-share-note').first().textContent()).includes('Anyone with the link'), 'staff: the not-shared folder card says it needs sharing');
      await shot(page, 'staff-card-dialog');
      ok(errors.length === 0, 'staff: page errors ' + errors.join(' | '));
      await ctx.close();
    }

    // ---- 4. Staff VIEWERS: a listed staff member sees any client; a client's own browser never does ----
    {
      const viewerFlag = { clients: [], viewers: ['qa staff'] };
      // 4a. staff app, listed viewer, a client the switch does not list
      {
        const calls = { preview: [], images: [], writes: [] };
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
        await install(ctx, origin, viewerFlag, calls);
        await seedStaffGate(ctx);
        const page = await ctx.newPage();
        const errors = []; page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
        await page.goto(origin + '/index.html#calendar', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof navTo === 'function');
        await page.evaluate(() => navTo('calendar'));
        await page.locator('#calView').waitFor();
        await page.evaluate(({ posts, client }) => {
          _calInvalidateActiveLoad(); calState.loading = false; calState.error = ''; calState.client = client; calState.posts = posts;
          calState.view = 'month'; calState.monthFilter = 'all'; calState.statusFilter = 'all'; _calSavePins([client]); _calRenderShell(); _calRenderBody();
        }, { posts: rows(SLUG).filter(r => r.name), client: CLIENT });
        await page.waitForSelector('.cal-month-pill .sv-car-mini', { timeout: 15000 });
        ok(calls.preview.length >= 1 && calls.preview.every(c => c.headers['x-syncview-key'] && c.headers['x-syncview-actor'] === 'QA Staff'), 'viewer (staff app): the read carries the staff key and name');
        ok(errors.length === 0, 'viewer (staff app): page errors ' + errors.join(' | '));
        await ctx.close();
      }
      // 4b. staff app, signed in but NOT listed: today's page, no request
      {
        const calls = { preview: [], images: [], writes: [] };
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' });
        await install(ctx, origin, { clients: [], viewers: ['someone else'] }, calls);
        await seedStaffGate(ctx);
        const page = await ctx.newPage();
        await page.goto(origin + '/index.html#calendar', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof navTo === 'function');
        await page.evaluate(() => navTo('calendar'));
        await page.locator('#calView').waitFor();
        await page.evaluate(({ posts, client }) => {
          _calInvalidateActiveLoad(); calState.loading = false; calState.error = ''; calState.client = client; calState.posts = posts;
          calState.view = 'month'; calState.monthFilter = 'all'; calState.statusFilter = 'all'; _calSavePins([client]); _calRenderShell(); _calRenderBody();
        }, { posts: rows(SLUG).filter(r => r.name), client: CLIENT });
        await page.waitForSelector('.cal-month-pill', { timeout: 15000 });
        await page.waitForTimeout(1200);
        ok(calls.preview.length === 0 && await page.locator('.sv-car-mini').count() === 0, 'viewer: a signed-in staff member who is not listed sees today\'s page');
        await ctx.close();
      }
      // 4c. client link in a browser that holds a listed staff session, key-verify agrees: new behaviour, staff headers ride
      // 4d. the same, key-verify refuses: today's page. 4e. no saved staff session: today's page and no key-verify call at all.
      for (const mode of ['agrees', 'refuses', 'none']) {
        const calls = { preview: [], images: [], writes: [] };
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' });
        await install(ctx, origin, viewerFlag, calls);
        let verifyCalls = 0;
        if (mode !== 'none') await seedStaffIdentity(ctx);
        await ctx.route('**/functions/v1/key-verify', route => {
          verifyCalls++;
          if (mode === 'refuses') return route.fulfill({ status: 401, headers: CORS, contentType: 'application/json', body: JSON.stringify({ ok: false }) });
          return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ ok: true, role: 'admin', member: { id: 'qa_staff', name: 'QA Staff', role: 'admin', team: null } }) });
        });
        const page = await ctx.newPage();
        const errors = []; page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
        await page.goto(`${origin}/index.html?${new URLSearchParams({ c: CLIENT, t: TOKEN, v: 'calendar' })}`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[data-cal-view=month]', { timeout: 20000 });
        await page.locator('[data-cal-view=month]').click();
        await page.waitForSelector('.cal-month-pill', { timeout: 20000 });
        if (mode === 'agrees') {
          await page.waitForSelector('.cal-month-pill .sv-car-mini', { timeout: 15000 });
          ok(verifyCalls >= 1, 'viewer (client link): the saved staff session was verified by key-verify');
          ok(calls.preview.length >= 1 && calls.preview.every(c => c.headers['x-syncview-key'] && c.headers['x-syncview-actor'] === 'QA Staff'), 'viewer (client link): the read carries the verified staff key and name');
          await page.locator('.cal-month-pill', { hasText: 'Carousel shared' }).locator('.cal-month-pill-thumb').click();
          await page.waitForSelector('#calNotesStage .sv-car-frame img', { timeout: 10000 });
          ok(await page.locator('.sv-car-about').count() === 1, 'viewer (client link): the card view opens with About this post');
        } else {
          await page.waitForTimeout(1500);
          ok(calls.preview.length === 0 && await page.locator('.sv-car-mini').count() === 0, 'viewer (client link, ' + mode + '): today\'s page, no folder read');
          if (mode === 'none') ok(verifyCalls === 0, 'viewer (client link): a browser with no staff session makes no key-verify request');
        }
        ok(errors.length === 0, 'viewer (client link, ' + mode + '): page errors ' + errors.join(' | '));
        await ctx.close();
      }
    }
    console.log(`carousel-preview-browser: ${checks} checks passed`);
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exit(1); });
