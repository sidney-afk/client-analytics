'use strict';
/*
 * THE REVIEW BOARDS' LAYOUT GUARD (Layoutpass, OPEN_REPAIRS 714). Real built app, fully offline (the shared review
 * fixture: fictional client, cards, people and token). On 6 Nov 2026 Sidney saw "RedApprove" on Kasper's Review Session:
 * at 1920 with 125% Windows scaling (1536 CSS px) the video's Redo slid under its Approve, because the decision row's
 * side column could shrink below its two buttons. The player's bar had the same fault (Mute under Forward 5 seconds).
 * This guard checks the class, not the one case: at every width a laptop or desktop offers (1280 to 2560) and at
 * browser zoom or Windows scaling of 110, 125 and 150 percent (the window's CSS width divided by the zoom, drawn at that
 * pixel ratio), in light and dark, it walks the whole page with test/fixtures/layout-guard.js and fails on
 *   - two pressable controls whose boxes cross (a split button's caret on its own Approve is the one allowed),
 *   - a control cut off by a box that hides its overflow, or past the window's edge,
 *   - a control or a one-line text cut short with no tooltip carrying its full words,
 *   - a page that scrolls sideways.
 * Surfaces: Kasper's Review Session in his second layout (a vertical and a wide video, the Approve menu open, the
 * conversation with notes, a trial card with its version tiles), his one-at-a-time page below 1360, Messages and the
 * More menu; the client link's Review, Sheet, Month and Week, the card view with Notes and About this post (a reel and
 * a carousel), and a phone. LAYOUT_GUARD_ENGINES=chromium,webkit picks the engines (both by default); CI requires WebKit
 * with LAYOUT_GUARD_REQUIRE_WEBKIT=1 (Kasper reviews on a Mac in Safari). LAYOUT_GUARD_FULL=1 runs every width at every
 * zoom in both themes (the pass the guard was built from); the default is a smaller grid that still crosses every
 * step of the decision row and the player's bar. LAYOUT_GUARD_SHOTS=<dir> saves a screenshot per surface and width.
 * Dates follow the fixture's own (no month is hard-coded here; Month opens on today's month).
 */
const fs = require('node:fs');
const path = require('node:path');
const PW = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { CLIENT, SLUG, TOKEN, STAFF, open, waitNew, sleep } = require('./fixtures/review-stage-fixture.js');
const { layoutScan } = require('./fixtures/layout-guard.js');

const FULL = process.env.LAYOUT_GUARD_FULL === '1';
const SHOTS = process.env.LAYOUT_GUARD_SHOTS || '';
const WIDTHS = FULL ? [1280, 1366, 1440, 1536, 1600, 1920, 2560] : [1280, 1366, 1440, 1536, 1600, 1920, 2560];
const ZOOMS = FULL ? [1, 1.1, 1.25, 1.5] : [1, 1.25, 1.5];
const THEMES = FULL ? [false, true] : [false];
const POPUPS = ['.apmenu', '.kasper-more-menu', '.sv-tip', '#globalTooltip', '.cal-comments-overlay'];
const failures = [];
let engine = '';
let checks = 0;
function expect(v, m) { checks++; m = '[' + engine + '] ' + m; if (!v) { failures.push(m); console.error('FAIL  ' + m); } }
const sizeOf = (W, z) => ({ width: Math.round(W / z), height: Math.round(W * 0.625 / z) });
const scan = (page, o) => page.evaluate(layoutScan, Object.assign({ popups: POPUPS }, o || {}));
async function shot(page, name) { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, engine + '-' + name + '.png') }); }
function judge(where, r) {
  expect(!r.overlap.length, where + ': no two controls overlap (' + r.overlap.slice(0, 3).join(' | ') + ')');
  expect(!r.clipped.length, where + ': no control is cut off by its box (' + r.clipped.slice(0, 3).join(' | ') + ')');
  expect(!r.outside.length, where + ': no control past the window\'s edge (' + r.outside.slice(0, 3).join(' | ') + ')');
  expect(!r.truncated.length, where + ': nothing cut short without a tooltip (' + r.truncated.slice(0, 3).join(' | ') + ')');
  expect(!r.hscroll, where + ': the page does not scroll sideways (' + r.hscroll + ' px)');
  expect(r.count > 3, where + ': the page drew its controls (' + r.count + ')');
}
const shadow = (page, fn, arg) => page.evaluate(([src, a]) => (0, eval)('(' + src + ')')(document.getElementById('svReviewStage').shadowRoot, a), [fn.toString(), arg]);

async function kasper(type, origin, z, opt) {
  const browser = await type.launch();
  const t = await open(browser, origin, Object.assign({ stage: 'kasper', flags: 'on', staff: STAFF, layout2: true, linkedParts: true, mergeComments: true, nativeReceipts: true, thread: true, width: 1440, height: 900, context: { deviceScaleFactor: z } }, opt));
  t.browser = browser;
  if (opt.trial) await trialRoute(t);
  await t.page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
  await t.page.waitForFunction(() => typeof navTo === 'function', null, { timeout: 30000 });
  await t.page.evaluate(n => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} try { wlMergeClientsFromSheet([n]); } catch (e) {} navTo('kasper'); }, CLIENT);
  await t.page.waitForFunction(() => { const r = document.getElementById('svReviewStage')?.shadowRoot; return !!(r && r.querySelector('.dec button')); }, null, { timeout: 30000 });
  await sleep(1500);
  return t;
}
// A trial card (three versions) for Kasper's board, answered locally like the trial-reels function's list.
async function trialRoute(t) {
  const v = l => ({ id: 'v' + l, letter: l, status: 'waiting', frame_url: 'https://f.io/fixture-trial-' + l.toLowerCase(), revision: 0, updated_at: '2026-11-03T09:00:00.000Z', smm_ok_at: '2026-11-03T08:00:00.000Z', kasper_ok_at: null, client_ok_at: null, client_pass_at: null, change_by: null, change_note: null, change_at: null, change_part: null, thumbnail_url: null, caption: null });
  const L = await import(path.join(__dirname, '..', 'supabase', 'functions', 'trial-reels', 'logic.mjs'));
  const versions = ['A', 'B', 'C'].map(v);
  await t.ctx.route('**/functions/v1/trial-reels', async route => {
    const r = route.request();
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: '' });
    const shape = Object.assign({ enabled: true }, L.readShape(versions, { client: false, mainLink: versions[0].frame_url, cardStatus: 'Kasper Approval', card: { thumbnail_url: null, caption: null } }));
    return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: JSON.stringify({ ok: true, cards: { rs1: shape } }) });
  });
}

async function runKasper(type, origin) {
  for (const z of ZOOMS) for (const dark of THEMES) for (const orient of z === 1 || FULL ? ['p', 'l'] : ['p']) {
    const t = await kasper(type, origin, z, { dark, orient });
    try {
      for (const W of WIDTHS) {
        const s = sizeOf(W, z);
        await t.page.setViewportSize(s); await sleep(450);
        const where = 'Kasper ' + (orient === 'l' ? 'wide video' : 'vertical video') + (dark ? ' dark' : '') + ' ' + W + ' at ' + Math.round(z * 100) + '% (' + s.width + ' CSS px)';
        judge(where, await scan(t.page));
        if (z === 1) await shot(t.page, 'kasper-' + orient + (dark ? '-dark' : '') + '-' + W);
        // The Approve menu open on the video (its items cover the page under them, never each other).
        const opened = await shadow(t.page, r => { const b = r.querySelector('.pn-d[data-pd="video"] [data-menu], .dec [data-menu]'); if (b && b.offsetParent) { b.click(); return true; } return false; });
        if (opened) {
          await sleep(250);
          judge(where + ', Approve menu open', await scan(t.page));
          await shadow(t.page, r => { const s = r.querySelector('.split.open .sarr'); if (s) s.click(); });
          await sleep(150);
        }
      }
      if (z === 1 && !dark && orient === 'p') {
        // Messages, and the More menu open, at a laptop's widths.
        for (const W of [1366, 1536, 1920]) {
          await t.page.setViewportSize(sizeOf(W, 1));
          await t.page.evaluate(() => _kasperGotoTab('replies')); await sleep(900);
          judge('Kasper Messages ' + W, await scan(t.page));
          await shot(t.page, 'kasper-messages-' + W);
          await t.page.locator('[data-kasper-more-trigger]').click(); await sleep(300);
          judge('Kasper More menu open ' + W, await scan(t.page));
          await t.page.keyboard.press('Escape'); await sleep(200);
          await t.page.evaluate(() => _kasperGotoTab('review')); await sleep(900);
        }
      }
      expect(!t.errors.length, 'Kasper at ' + z + ': no page errors (' + t.errors.join(' | ') + ')');
    } finally { await t.browser.close(); }
  }
  // A trial card: the version tiles on the video's part.
  const t = await kasper(type, origin, 1, { flagValues: { trial_reels_pages: { clients: [SLUG] }, trial_versions_v2: { clients: [SLUG] } }, trial: true });
  try {
    await t.page.waitForFunction(() => !!document.getElementById('svReviewStage').shadowRoot.querySelector('.trs [data-trk-go], .trk'), null, { timeout: 15000 }).catch(() => null);
    const tiles = await shadow(t.page, r => r.querySelectorAll('.trs [data-trk-go], .trk').length);
    expect(tiles > 0, 'Kasper trial card: the version tiles show (' + tiles + ')');
    for (const W of WIDTHS) {
      await t.page.setViewportSize(sizeOf(W, 1)); await sleep(450);
      judge('Kasper trial card ' + W, await scan(t.page));
      await shot(t.page, 'kasper-trial-' + W);
    }
    expect(!t.errors.length, 'Kasper trial card: no page errors (' + t.errors.join(' | ') + ')');
  } finally { await t.browser.close(); }
}

// The client link with the finished posts (and a carousel) dated in TODAY's month, so Month and Week show them whatever
// the date (the shared fixture's finished posts carry fixed dates).
const pad = n => String(n).padStart(2, '0');
const thisMonth = d => { const n = new Date(); return n.getFullYear() + '-' + pad(n.getMonth() + 1) + '-' + pad(d); };
async function openClient(browser, origin, opt) {
  const t = await open(browser, origin, Object.assign({ stage: 'client' }, opt));
  const done = t.state.cards.filter(c => c.status === 'Approved');
  done.forEach((c, i) => { c.scheduled_date = thisMonth(9 + i * 3); });
  t.state.cards.push({ id: 'rcar', client: SLUG, name: 'A carousel of four', status: 'Approved', order_index: 9, updated_at: '2026-10-10T12:00:00.000Z', scheduled_date: thisMonth(11), video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Approved', asset_url: '', thumbnail_url: FOLDER, caption: 'Four slides, one calm week. Save this for Sunday and send it to a friend who plans on Mondays. A long caption, so About this post offers Show more and the card has to hold all of it.', video_tweaks: '[]', graphic_tweaks: '[]', caption_tweaks: '[]', comments: [], graphic_comments: [], caption_comments: [] });
  t.reel = done[0].name;
  await carouselRoutes(t);
  await t.page.goto(origin + '/index.html?' + new URLSearchParams({ c: CLIENT, v: 'calendar', tab: 'review', t: TOKEN }), { waitUntil: 'domcontentloaded' });
  return t;
}
async function clientTab(t, v) {
  await t.page.evaluate(x => onCalViewChange(x), v);
  await t.page.waitForFunction(x => typeof calState === 'object' && calState.view === x, v, { timeout: 15000 });
  await sleep(800);
}
// A carousel card on the client link: a Drive folder as its thumbnail and no video, answered like thumbnail-folder-resolve.
const FOLDER = 'https://drive.google.com/drive/folders/FixtureCarouselFolder01';
async function carouselRoutes(t) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><rect width="800" height="1000" fill="#7c2d12"/></svg>';
  await t.ctx.route('https://drive.google.com/thumbnail**', r => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg }));
  await t.ctx.route('**/functions/v1/thumbnail-folder-resolve', r => r.request().method() === 'OPTIONS'
    ? r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: '' })
    : r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: JSON.stringify({ ok: true, enabled: true, state: 'ok', count: 4, has_video: false, first_file_id: 'FixtureCarouselFile1' }) }));
}
async function openCard(t, name) {
  await clientTab(t, 'month');
  const pill = t.page.locator('.cal-month-pill', { hasText: name }).first();
  if (!await pill.count()) { if (process.env.LAYOUT_GUARD_DEBUG) console.log('pills: ' + await t.page.evaluate(() => [...document.querySelectorAll('.cal-month-pill')].map(e => e.textContent.trim()).join(' | '))); return false; }
  await pill.locator('.cal-month-pill-thumb').click();
  await t.page.waitForSelector('#calCommentsModal.active, #calNotesShell', { timeout: 10000 }).catch(() => null);
  await sleep(900);
  return true;
}
async function closeCard(t) { const c = t.page.locator('.cal-comments-close'); if (await c.count() && await c.first().isVisible()) { await c.first().click(); await sleep(300); } }

async function runClient(type, origin) {
  for (const z of ZOOMS) for (const dark of THEMES) {
    const browser = await type.launch();
    const t = await openClient(browser, origin, { flags: 'on', tab: 'review', finished: true, thread: true, dark, width: 1440, height: 900, context: { deviceScaleFactor: z } });
    try {
      await waitNew(t); await sleep(1200);
      for (const v of ['review', 'organizer', 'month', 'week']) {
        await clientTab(t, v);
        for (const W of WIDTHS) {
          const s = sizeOf(W, z);
          await t.page.setViewportSize(s); await sleep(450);
          const where = 'client ' + (v === 'organizer' ? 'Sheet' : v[0].toUpperCase() + v.slice(1)) + (dark ? ' dark' : '') + ' ' + W + ' at ' + Math.round(z * 100) + '% (' + s.width + ' CSS px)';
          judge(where, await scan(t.page));
          if (z === 1) await shot(t.page, 'client-' + v + (dark ? '-dark' : '') + '-' + W);
        }
      }
      expect(!t.errors.length, 'client at ' + z + ': no page errors (' + t.errors.join(' | ') + ')');
    } finally { await browser.close(); }
  }
  // The card view (a reel and a carousel) with Notes and About this post, at laptop widths and on a phone.
  for (const [W, phone] of [[1280, false], [1536, false], [1920, false], [390, true]]) {
    const browser = await type.launch();
    const t = await openClient(browser, origin, Object.assign({ flags: 'on', tab: 'review', finished: true, thread: true, width: W, height: phone ? 844 : Math.round(W * 0.625) }, phone ? { context: { isMobile: type.name() !== 'firefox', hasTouch: true, deviceScaleFactor: 3 } } : {}));
    try {
      await waitNew(t); await sleep(1200);
      if (phone) {
        judge('client Review on a phone', await scan(t.page));
        await shot(t.page, 'client-phone-review');
      }
      for (const name of [t.reel, 'A carousel of four']) {
        const opened = await openCard(t, name);
        expect(opened, 'client card view ' + W + ': "' + name + '" opens from Month');
        if (!opened) continue;
        const about = await t.page.locator('.sv-car-about').count();
        expect(about === 1, 'client card view ' + W + ', ' + name + ': About this post shows (' + about + ')');
        judge('client card view ' + (phone ? 'phone' : W) + ', ' + name, await scan(t.page));
        await shot(t.page, 'client-card-' + (phone ? 'phone' : W) + '-' + (name.startsWith('A carousel') ? 'carousel' : 'reel'));
        const more = t.page.locator('.sv-car-more');
        if (await more.count() && await more.first().isVisible()) { await more.first().click(); await sleep(300); judge('client card view ' + (phone ? 'phone' : W) + ', ' + name + ', Show more', await scan(t.page)); }
        await closeCard(t);
      }
      expect(!t.errors.length, 'client card view ' + W + ': no page errors (' + t.errors.join(' | ') + ')');
    } finally { await browser.close(); }
  }
}

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  try {
    const only = String(process.env.LAYOUT_GUARD_ENGINES || 'chromium,webkit').split(',').filter(Boolean);
    for (const name of only) {
      engine = name;
      const type = PW[name];
      let probe = null;
      try { probe = await type.launch(); } catch (e) { probe = null; }
      if (!probe) {
        if (name === 'webkit' && process.env.LAYOUT_GUARD_REQUIRE_WEBKIT === '1') expect(false, 'WebKit is required in this run but could not start');
        else console.log('(' + name + ' is not installed here: skipped)');
        continue;
      }
      await probe.close();
      console.log('===== ' + name + ' =====');
      const before = failures.length;
      await runKasper(type, origin);
      await runClient(type, origin);
      console.log(name + ': ' + (failures.length - before) + ' failure(s)');
    }
  } finally { server.close(); }
  console.log(checks + ' checks');
  if (failures.length) { console.error('\n' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nall passed');
})().catch(e => { console.error(e); process.exit(1); });
