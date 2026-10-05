'use strict';
/* Real generated app, synthetic client, intercepted backend only.
 * --headed uses visible Chrome. --capture-before records the unchanged page
 * from --before-root without pretending it passed the new Expanded contract.
 * POCKET_PHONE_SHOTS is a local output folder. Optional POCKET_FONT_DIR can
 * supply the offline gallery fonts for representative, repeatable images.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');
const { serve, installFixture, BASE_ROW } = require('./client-phone-review-browser');
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
const widths = [360, 390, 430];
const arg = key => process.argv.find(x => x.startsWith('--' + key + '='))?.split('=').slice(1).join('=');
const before = process.argv.includes('--capture-before');
const headed = process.argv.includes('--headed');
const shots = process.env.POCKET_PHONE_SHOTS;
const out = [];
let checks = 0;
function ok(value, message) { assert(value, message); checks++; }

async function measure(page, label) {
  const m = await page.evaluate(() => {
    const visible = e => e.checkVisibility({ checkVisibilityCSS: true });
    const controls = [...document.querySelectorAll('button, summary, a[href], input:not([type=hidden]), textarea, select')]
      .filter(e => visible(e) && !e.closest('.header')).map(e => {
        const r = e.getBoundingClientRect();
        return { tag: e.tagName, what: e.getAttribute('aria-label') || e.className, w: r.width, h: r.height };
      });
    const fields = [...document.querySelectorAll('input:not([readonly]):not([type=hidden]), textarea:not([readonly]), select')]
      .filter(visible).map(e => parseFloat(getComputedStyle(e).fontSize));
    return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, controls, fields };
  });
  ok(m.scrollWidth <= m.width + 1, label + ': page overflows');
  for (const c of m.controls) ok(c.w >= 43.5 && c.h >= 43.5, label + ': target below 44px: ' + JSON.stringify(c));
  for (const size of m.fields) ok(size >= 16, label + ': editable text below 16px');
  out.push({ label, width: m.width, scrollWidth: m.scrollWidth, controls: m.controls.length, fields: m.fields.length });
}
async function shot(page, label) {
  if (!shots) return;
  fs.mkdirSync(shots, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  const overlay = await page.locator('dialog[open], .cal-comments-overlay.open, .cal-preview-overlay.open, .cal-lightbox.open, .dp-popup').count();
  await page.screenshot({ path: path.join(shots, label + '.png'), fullPage: !overlay });
}
async function run(browser, origin, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const now = new Date();
  const fixtureDate = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
  const row = { ...BASE_ROW, id: 'p_phone_fixture_1', name: 'A little change. A better day.', scheduled_date: fixtureDate, cta: 'Save this for later.', thumbnail_url: 'https://drive.google.com/file/d/fixture_thumbnail_asset/view', video_deliverable_id: '00000000-0000-4000-a000-000000000001', graphic_deliverable_id: '00000000-0000-4000-a000-000000000002' };
  const finished = { ...row, id: 'p_phone_fixture_2', name: 'Make room for what matters.', thumbnail_url: origin + '/__fixture_unavailable.png', order_index: 2, status: 'Approved', video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Approved' };
  const settings = { id: 'p_cal_settings', client: row.client, caption: JSON.stringify({ collab_mode: true }) };
  const writes = [];
  await installFixture(ctx, origin, row, writes, 'calendar');
  await ctx.addInitScript(() => localStorage.setItem('syncview_theme', 'dark'));
  await ctx.route('**/__fixture_unavailable.png', route => route.abort());
  // This existing POST is a read, not a card mutation. Keep it separate from
  // the writer receipt while loading a synthetic Drive thumbnail.
  await ctx.route('**/functions/v1/thumbnail-revision-read', route => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: '{"ok":true,"items":[]}' }));
  await ctx.route('https://lh3.googleusercontent.com/d/fixture_thumbnail_asset*', route => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200"><rect width="900" height="1200" fill="#dedccf"/><circle cx="480" cy="500" r="260" fill="#aaa88d"/><text x="80" y="1030" font-size="60" fill="#32352c" font-family="sans-serif">A little change.</text></svg>' }));
  await ctx.route('**/rest/v1/calendar_posts?**', route => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify([row, finished, settings]) }));
  if (process.env.POCKET_FONT_DIR) {
    const css = [400, 500, 600, 700, 800].map(weight => {
      const bytes = fs.readFileSync(path.join(process.env.POCKET_FONT_DIR, 'plus-jakarta-' + weight + '.ttf'));
      return `@font-face{font-family:'Plus Jakarta Sans';font-style:normal;font-weight:${weight};src:url(data:font/ttf;base64,${bytes.toString('base64')}) format('truetype');font-display:block}`;
    }).join('\n');
    await ctx.route('https://fonts.googleapis.com/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: css }));
  }
  if (before) {
    const root = path.resolve(arg('before-root'));
    await ctx.route(origin + '/**', route => {
      const u = new URL(route.request().url());
      if (u.pathname.includes('__fixture')) return route.fallback();
      const file = path.join(root, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname));
      if (!file.startsWith(root + path.sep)) return route.abort();
      return route.fulfill({ status: 200, contentType: file.endsWith('.html') ? 'text/html' : 'text/javascript', body: fs.readFileSync(file) });
    });
  }
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/index.html?c=Phone%20Fixture%20Client&t=synthetic-phone-token&v=calendar', { waitUntil: 'domcontentloaded' });
  await page.locator('.cal-review-card').first().waitFor();
  await page.locator('.kcard-expand-btn').first().click();
  await shot(page, 'review-' + width);
  if (!before) {
    await measure(page, 'review-' + width);
    ok(await page.locator('.pocket-client-calendar h1').innerText() === 'Calendar', 'Calendar title missing');
    ok(await page.locator('html[data-theme=dark]').count() === 0, 'client links must remain light even with a saved dark preference');
    ok(!await page.locator('.header').isVisible(), 'separate phone header remains');
    ok(await page.locator('.pocket-cal-section').count() === 3, 'three component decisions must remain');
    ok(await page.locator('.cal-review-panel:visible').count() === 3, 'all component sections must be visible');
    const caption = page.locator('.pocket-cal-section:has([data-comp=caption])');
    const note = caption.locator('textarea');
    await note.fill('Please shorten the opening line.');
    ok(await caption.locator('.cal-review-approve-btn').isDisabled(), 'draft must disable approval');
    ok(!await caption.locator('.cal-review-tweak-btn').isDisabled(), 'draft must enable Request change');
    ok(await caption.isVisible(), 'caption must stay visible beside the other decisions');
    ok((await caption.locator('.pocket-cal-section-status').innerText()).includes('Note not sent'), 'draft must stay visibly unsent');
    await measure(page, 'thumbnail-' + width);
    await shot(page, 'thumbnail-' + width);
    await page.locator('.cal-review-preview-thumb-btn').click();
    await page.locator('#calLightbox.open').waitFor();
    await measure(page, 'lightbox-' + width);
    await shot(page, 'lightbox-' + width);
    await page.locator('.cal-lightbox-close').click();
    ok(await note.inputValue() === 'Please shorten the opening line.', 'moving between sections lost a draft');
    await note.fill('');
    ok(!await caption.locator('.cal-review-approve-btn').isDisabled(), 'clearing draft must restore approval');
    await measure(page, 'caption-' + width);
    await shot(page, 'caption-' + width);
    await page.evaluate(() => { _calReviewState.errors['p_phone_fixture_1|caption'] = 'Synthetic save refusal'; _calReviewRepaintCard('p_phone_fixture_1'); });
    ok((await caption.locator('.pocket-cal-section-status').innerText()).includes('Save failed'), 'failed save must remain explicit');
    await measure(page, 'save-error-' + width);
    await shot(page, 'save-error-' + width);
    await caption.locator('textarea').fill('A note retained after a failed save.');
    ok((await caption.locator('.pocket-cal-section-status').innerText()).includes('Save failed'), 'editing must not hide a failed save');
    await caption.locator('textarea').fill('');
    await page.evaluate(() => { delete _calReviewState.errors['p_phone_fixture_1|caption']; _calReviewState.saving['p_phone_fixture_1|caption'] = true; _calReviewRepaintCard('p_phone_fixture_1'); });
    ok((await caption.locator('.pocket-cal-section-status').innerText()).includes('Sending'), 'pending save must remain explicit');
    await measure(page, 'sending-' + width);
    await shot(page, 'sending-' + width);
    await page.evaluate(() => { _calReviewState.saving['p_phone_fixture_1|caption'] = false; _calReviewRepaintCard('p_phone_fixture_1'); });
    await page.locator('[aria-controls=pocketCalTabs]').click();
    await measure(page, 'tabs-' + width);
    await shot(page, 'tabs-' + width);
    await page.keyboard.press('Escape');
    ok(await page.locator('[aria-controls=pocketCalTabs]').evaluate(e => document.activeElement === e), 'Tabs must restore focus');
    await page.locator('[aria-controls=pocketCalTabs]').click();
    await page.locator('#pocketCalTabs .view-tab-btn').filter({ hasText: /^Analytics$/ }).click();
    // This fixture has no analytics rows. Its native no-data route has no
    // switcher; browser Back returns through the existing guarded renderer.
    ok(!new URL(page.url()).searchParams.has('v'), 'Analytics action must keep the native route');
    await page.goBack();
    await page.locator('.pocket-client-calendar').waitFor();
    ok(await page.locator('#pocketCalTabs .view-tab-btn').count() >= 2, 'native client navigation must survive a round trip');
  }
  for (const view of ['organizer', 'month', 'week']) {
    await page.locator('[data-cal-view=' + view + ']').click();
    await shot(page, view + '-' + width);
    if (!before) await measure(page, view + '-' + width);
    if (!before && view !== 'organizer') {
      // Runs of empty days fold into one labelled line; the folded days stay in the page for drag and drop.
      const dayRows = await page.evaluate(v => [...document.querySelectorAll(v === 'month' ? '.cal-month-cell[data-iso]' : '.cal-week-col[data-iso]')]
        .filter(e => !e.classList.contains('out') && e.checkVisibility({ checkVisibilityCSS: true }))
        .map(e => ({ label: (e.querySelector('.pocket-run-label') || {}).textContent || '', posts: e.querySelectorAll('.cal-month-pill, .cal-week-card').length, run: e.classList.contains('pocket-run-head'), rest: e.classList.contains('pocket-run-rest') })), view);
      ok(!dayRows.some(r => r.rest), view + ': a folded day must not show');
      ok(dayRows.every(r => !r.run || /^[A-Z][a-z]{2} \d{1,2}( to [A-Z][a-z]{2} \d{1,2})? · Nothing scheduled$/.test(r.label)), view + ': run line must name its days');
      ok(await page.locator('.pocket-run-rest').count() === await page.evaluate(() => document.querySelectorAll('.pocket-run-rest[data-iso]').length), view + ': folded days keep their date for drag and drop');
      const cards = page.locator(view === 'month' ? '.cal-month-pill:visible' : '.cal-week-card:visible');
      if (view === 'week' && !await cards.count()) await page.locator('.cal-nav-btn').last().click();
      await cards.first().click();
      await measure(page, view + '-post-' + width);
      await shot(page, view + '-post-' + width);
      await page.locator('.cal-preview-foot button').first().click();
    }
    if (!before && view === 'organizer') {
      await page.locator('.cal-date-chip').first().click();
      await page.locator('.dp-popup').waitFor({ state: 'visible' });
      await measure(page, 'date-picker-' + width);
      await shot(page, 'date-picker-' + width);
      await page.keyboard.press('Escape');
      await page.locator('.cal-comments-btn').first().click();
      await page.locator('#calCommentsModal').waitFor({ state: 'visible' });
      await measure(page, 'notes-' + width);
      await shot(page, 'notes-' + width);
      await page.locator('.cal-comments-close').click();
      const name = page.locator('.cal-fld-name').first();
      ok(await name.getAttribute('readonly') !== null, 'existing client names must stay locked');
      const cta = page.locator('.cal-card').first().locator('.pocket-cal-section:has(.cal-fld-cta)');
      ok(await cta.isVisible() && await page.locator('.cal-card').first().locator('.cal-capblock').isVisible(), 'Sheet Caption and Call to action must both be visible');
      await measure(page, 'sheet-cta-' + width);
      await page.locator('[aria-controls=pocketCalMore]').click();
      ok(await page.locator('#pocketCalMore #calOrganizeBtn').count() === 1, 'Organize must be inside More');
      ok(await page.locator('#pocketCalMore #calZoomIn').count() === 1, 'card size must be inside More');
      await measure(page, 'more-' + width);
      ok(await page.locator('#pocketCalMore').evaluate(e => e.offsetHeight < 300), 'closed Organize must not leave a blank row in More');
      await shot(page, 'more-' + width);
      await page.locator('#calOrganizeBtn').click();
      await page.locator('#calOrganizeMenu').waitFor({ state: 'visible' });
      await measure(page, 'organize-' + width);
      await shot(page, 'organize-' + width);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await page.locator('.cal-card-add').click();
      ok(await page.locator('.cal-fld-name:not([readonly])').count() === 1, 'native suggestion must keep an editable name');
      await measure(page, 'suggest-post-' + width);
      await shot(page, 'suggest-post-' + width);
    }
  }
  if (!before) {
    // Presentation crossing must return the existing desktop shell and tabs.
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.locator('.pocket-client-calendar').waitFor({ state: 'detached' });
    ok(await page.locator('.pocket-client-calendar').count() === 0, 'phone header leaked to desktop');
    ok(await page.locator('.cal-tab-view > .view-tab-toggle').count() === 1, 'native tabs not restored');
    await page.locator('[data-cal-view="week"]').click();
    const desktopWeek = await page.locator('.cal-week-grid').getAttribute('style');
    await page.setViewportSize({ width: 1, height: 1 });
    await page.waitForTimeout(200);
    const tinyViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, visibleWidth: visualViewport.width, visibleHeight: visualViewport.height }));
    ok(await page.locator('.pocket-client-calendar').count() === 0, 'measurement viewport rebuilt the phone shell: ' + JSON.stringify(tinyViewport));
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.waitForTimeout(200);
    ok(await page.locator('.cal-week-grid').getAttribute('style') === desktopWeek, 'measurement viewport shifted desktop Week');
    await page.setViewportSize({ width, height: 844 });
    await page.locator('.pocket-client-calendar').waitFor();
    ok(await page.locator('.pocket-client-calendar').count() === 1, 'phone header not restored');
    // Held loading and failure paints remain recognisable, then recovery.
    await page.evaluate(() => { calState.loading = true; _calRenderBody(); });
    ok(await page.locator('.cal-skeleton-loader').count() > 0, 'loading skeleton removed');
    await shot(page, 'loading-' + width);
    await page.evaluate(() => { calState.loading = false; calState.error = 'Synthetic read failure'; _calRenderBody(); });
    ok(await page.locator('.cal-error').count() === 1, 'failure became an empty state');
    await measure(page, 'error-' + width);
    await shot(page, 'error-' + width);
    await page.evaluate(() => { calState.error = null; calState.posts = []; _calRenderBody(); });
    await measure(page, 'empty-' + width);
    await shot(page, 'empty-' + width);
    ok(writes.length === 0, 'section navigation sent a write');
    ok(errors.length === 0, 'browser errors: ' + errors.join(' | '));
  }
  await ctx.close();
}
(async () => {
  const server = await serve();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: !headed, ...(headed ? { channel: 'chrome' } : {}) });
  try { for (const width of widths) await run(browser, origin, width); }
  finally { await browser.close(); server.close(); }
  if (shots) fs.writeFileSync(path.join(shots, 'measurements.json'), JSON.stringify({ checks, before, cases: out }, null, 2));
  console.log(before ? 'client-calendar-expanded: BEFORE screenshots recorded at 360, 390, 430; no Expanded pass claimed.' : `client-calendar-expanded: OK (${checks} assertions; Review, Sheet, Month, Week, menus, drafts, loading, failure, empty, breakpoint; 360/390/430).`);
})().catch(e => { console.error(e); process.exitCode = 1; });
