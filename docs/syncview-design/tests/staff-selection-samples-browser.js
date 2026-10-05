'use strict';
// Native generated product and fictional data. No external write can escape
// the fixture transport. Public pictures substitute a generic reviewer label.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { serve, installFixture, BASE_ROW } = require('./client-phone-review-browser');
const { seedStaffGate } = require('../../../qa/staff-gate-seed');
const root = path.resolve(__dirname, '../../..');
const beforeRoot = process.argv.find(arg => arg.startsWith('--before-root='))?.slice(14);
const before = process.argv.includes('--capture-before');
const headed = process.argv.includes('--headed');
const shots = process.env.POCKET_PHONE_SHOTS;
const widths = [360, 390, 430];
const measurements = [];
let checks = 0;
const ok = (value, message) => { assert(value, message); checks++; };
async function measure(page, label) {
  const result = await page.evaluate(() => {
    const visible = node => node.checkVisibility({ checkVisibilityCSS: true });
    const surfaces = '#svJump:not([hidden]), #calView, #sxrView, .cal-prompt-overlay.open, .cal-import-overlay.open, .cal-preview-overlay.open, .cal-comments-overlay.open, .cal-lightbox.open, .dp-popup, .cal-fld-status-menu';
    const nodes = [...document.querySelectorAll(surfaces)].flatMap(root => [...root.querySelectorAll('button, a[href], [role=button], select, input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea')]);
    return {
      width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      controls: [...nodes].filter(visible).map(node => {
        const r = node.getBoundingClientRect();
        return { what: node.className || node.tagName, w: r.width, h: r.height };
      }),
      fields: [...document.querySelectorAll(surfaces)].flatMap(root => [...root.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea, select, [contenteditable=true]')]).filter(visible).map(node => parseFloat(getComputedStyle(node).fontSize)),
    };
  });
  ok(result.scrollWidth <= result.width + 1, label + ': page scrolls sideways');
  for (const control of result.controls) ok(control.w >= 43.5 && control.h >= 43.5, label + ': target under 44px ' + JSON.stringify(control));
  for (const font of result.fields) ok(font >= 16, label + ': field below 16px');
  measurements.push({ label, width: result.width, scrollWidth: result.scrollWidth, controls: result.controls.length, fields: result.fields.length });
}
async function shot(page, label) {
  if (!shots) return;
  fs.mkdirSync(shots, { recursive: true });
  // Only displayed fixture names change. Native handlers and destinations stay.
  await page.evaluate(() => {
    document.querySelectorAll('.cal-ap-route').forEach(node => { if (node.textContent.trim() !== 'Client') node.textContent = 'Reviewer'; });
    const last = document.querySelector('#headerNav > a:last-child');
    const label = window.__phoneFixtureReviewerLabel || last?.textContent.trim();
    if (label) window.__phoneFixtureReviewerLabel = label;
    if (label) {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!node.parentElement.closest('script,style') && node.textContent.includes(label)) node.textContent = node.textContent.replaceAll(label, 'Reviewer');
      }
      document.querySelectorAll('[placeholder],[title],[aria-label]').forEach(node => {
        for (const name of ['placeholder','title','aria-label']) {
          const value = node.getAttribute(name);
          if (value?.includes(label)) node.setAttribute(name, value.replaceAll(label, 'Reviewer'));
        }
      });
    }
  });
  await page.evaluate(() => document.fonts.ready);
  const overlay = await page.locator('#svJump:not([hidden]), dialog[open], .cal-select-bar, .cal-lightbox.open, .cal-comments-overlay.open, .cal-prompt-overlay.open, .cal-import-overlay.open, .cal-preview-overlay.open, .cal-fld-status-menu, .dp-popup, #confirmOverlay.active, #notifyOverlay.active').count();
  await page.screenshot({ path: path.join(shots, label + '.png'), fullPage: !overlay, animations: 'disabled' });
}
async function runPhone(browser, origin, width, theme) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const row = { ...BASE_ROW, id: 'sr_staff_phone_fixture_1', name: 'Make room for a better day.', thumbnail_url: 'https://images.example.invalid/phone-fixture.png', video_deliverable_id: '00000000-0000-4000-8000-000000000001', graphic_deliverable_id: '00000000-0000-4000-8000-000000000002', status: 'For SMM Approval', video_status: 'For SMM Approval', graphic_status: 'For SMM Approval' };
  await installFixture(ctx, origin, row, [], 'samples');
  await seedStaffGate(ctx);
  await ctx.addInitScript(value => localStorage.setItem('syncview_theme', value), theme);
  await ctx.route('https://images.example.invalid/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><rect width="1080" height="1350" fill="#e6ddf5"/><circle cx="720" cy="400" r="220" fill="#c8b6e9"/><path d="M0 1000Q450 600 1080 1100V1350H0Z" fill="#9580b8"/></svg>' }));
  if (process.env.POCKET_FONT_DIR) {
    const css = [400,500,600,700,800].map(weight => "@font-face{font-family:'Plus Jakarta Sans';font-weight:" + weight + ";src:url(data:font/ttf;base64," + fs.readFileSync(path.join(process.env.POCKET_FONT_DIR, 'plus-jakarta-' + weight + '.ttf')).toString('base64') + ") format('truetype');font-display:block}").join('\n');
    await ctx.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: css }));
  }
  if (before) {
    const base = path.resolve(beforeRoot);
    await ctx.route(origin + '/**', route => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/__fixture')) return route.fallback();
      const file = path.resolve(base, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      if (!file.startsWith(base + path.sep)) return route.abort();
      return route.fulfill({ contentType: file.endsWith('.html') ? 'text/html' : 'text/javascript', body: fs.readFileSync(file) });
    });
  }
  try {
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/index.html?sxr=1#sample-reviews', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof navTo === 'function');
    await page.evaluate(() => navTo('sample-reviews'));
    await page.locator('#sxrView').waitFor();
    await page.evaluate(row => {
      _sxrAbortActiveLoad();
      Object.assign(sxrState, { loading: false, error: '', client: 'Phone Fixture Client', posts: [row], view: 'smmreview' });
      _calSavePins(['Phone Fixture Client']);
      _sxrRenderShell(); _sxrRenderBody();
    }, row);
    const suffix = theme + '-' + width;
    const card = page.locator('[data-cal-review-pid="' + row.id + '"]');
    await card.waitFor();
    await shot(page, 'samples-queue-' + suffix);
    await card.locator('.kcard-expand-btn').click();
    if (!before) await measure(page, 'samples-review-' + suffix);
    await shot(page, 'samples-review-' + suffix);
    if (!before) {
      await page.locator('[data-staff-menu=tabs]').click();
      await measure(page, 'samples-tabs-' + suffix); await shot(page, 'samples-tabs-' + suffix);
      await page.keyboard.press('Escape');
      await page.locator('[data-staff-menu=more]').click();
      await measure(page, 'samples-more-' + suffix); await shot(page, 'samples-more-' + suffix);
      await page.keyboard.press('Escape');
      await page.locator('[data-staff-menu=more]').click();
      await page.locator('dialog[open] .sv-jump-touch').click();
      await page.locator('#svJump:not([hidden])').waitFor();
      ok(await page.locator('dialog[open]').count() === 0, 'More trapped native Quick jump');
      await page.locator('#svJumpInput').fill('phone fixture');
      ok(await page.locator('#svJumpInput').evaluate(node => node === document.activeElement), 'Quick jump input lost focus');
      await measure(page, 'samples-quick-jump-' + suffix); await shot(page, 'samples-quick-jump-' + suffix);
      await page.keyboard.press('Escape');
      await page.evaluate(() => { _arxOpen('sxr'); arxState.seq++; arxState.loading = false; arxState.rows = []; _arxRenderModal(); });
      for (const state of ['empty','loading','error','rows']) {
        await page.evaluate(({ state, row }) => { arxState.loading = state === 'loading'; arxState.error = state === 'error' ? 'read' : ''; arxState.rows = state === 'rows' ? [{ ...row, status: 'Archived' }] : []; arxState.canWiden = true; _arxRenderModal(); }, { state, row });
        await measure(page, 'samples-archived-' + state + '-' + suffix); await shot(page, 'samples-archived-' + state + '-' + suffix);
      }
      await page.evaluate(() => _arxClose());
      await page.evaluate(id => openSxrComments(id), row.id);
      await page.locator('#sxrCommentsOverlay.open').waitFor();
      await measure(page, 'samples-notes-' + suffix); await shot(page, 'samples-notes-' + suffix);
      await page.evaluate(() => closeSxrComments());
      await card.locator('.cal-review-preview-thumb-btn').click();
      await page.locator('#sxrLightbox.open').waitFor();
      await measure(page, 'samples-lightbox-' + suffix); await shot(page, 'samples-lightbox-' + suffix);
      await page.locator('#sxrLightbox .cal-lightbox-close').click();
      await page.evaluate(id => { _sxrReviewState.errors[id + '|graphic'] = 'Synthetic save refusal'; _sxrReviewRepaintCard(id); }, row.id);
      await measure(page, 'samples-save-error-' + suffix); await shot(page, 'samples-save-error-' + suffix);
      await page.evaluate(id => { delete _sxrReviewState.errors[id + '|graphic']; _sxrReviewState.saving[id + '|graphic'] = true; sxrState.posts[0].graphic_status = 'Approved'; _sxrReviewRepaintCard(id); }, row.id);
      ok(await card.locator('[data-comp=graphic] .pocket-staff-samples-saving').isVisible(), 'Pending sample approval looked finished');
      ok((await card.locator('[data-comp-pill=graphic]').innerText()).includes('Saving'), 'Pending sample pill looked finished');
      await measure(page, 'samples-sending-' + suffix); await shot(page, 'samples-sending-' + suffix);
      await page.evaluate(row => { delete _sxrReviewState.saving[row.id + '|graphic']; sxrState.posts = [{ ...row }]; _sxrRenderBody(); }, row);
    }
    await page.locator('[data-cal-view=organizer]').click();
    if (!before) await measure(page, 'samples-sheet-' + suffix);
    await shot(page, 'samples-sheet-' + suffix);
    if (!before) {
      await page.locator('[data-staff-menu=more]').click();
      ok(await page.locator('dialog[open] #sxrZoomCtl').isVisible(), 'Sample card size missing from More');
      await measure(page, 'samples-sheet-more-' + suffix); await shot(page, 'samples-sheet-more-' + suffix);
      await page.keyboard.press('Escape');
      await page.locator('.cal-fld-substatus-trigger').first().click();
      await page.locator('.cal-fld-status-menu').waitFor();
      await measure(page, 'samples-status-menu-' + suffix); await shot(page, 'samples-status-menu-' + suffix);
      await page.keyboard.press('Escape');
      ok(await page.locator('.cal-fld-status-menu').count() === 0, 'Sample status menu ignored Escape');
      await page.locator('#sxrView .cal-fld-setall').click();
      await page.locator('.cal-fld-status-menu').waitFor();
      await measure(page, 'samples-setall-' + suffix); await shot(page, 'samples-setall-' + suffix);
      await page.keyboard.press('Escape');
      await page.locator('#sxrView .cal-select-btn').click();
      await measure(page, 'samples-select-' + suffix); await shot(page, 'samples-select-' + suffix);
      await page.locator('#sxrStrip .cal-card-select-overlay').click({ position: { x: 30, y: 30 } });
      ok((await page.locator('#sxrSelectCount').innerText()).includes('1'), 'Sample tap did not select its card');
      await measure(page, 'samples-selected-' + suffix); await shot(page, 'samples-selected-' + suffix);
      await page.locator('#sxrSelectArchive').click();
      await page.locator('#confirmOverlay.active').waitFor();
      await shot(page, 'samples-archive-confirm-' + suffix);
      await page.locator('#confirmOverlay.active button', { hasText: /^Cancel$/ }).click();
      await page.evaluate(() => _sxrToggleSelectMode());
      await page.evaluate(() => _calOpenNativePost('Phone Fixture Client', null, 'sxr'));
      await page.locator('#calNativePostCreate').waitFor();
      ok(!await page.locator('.pocket-staff-samples-tools, .pocket-staff-cal-tools').first().isVisible().catch(() => false), 'Tools label must not show');
      if (width >= 390) ok(await page.locator('#calNativeBatchName').evaluate(e => e.scrollWidth <= e.clientWidth + 1), 'Batch name must not truncate at 390 and wider');
      ok(await page.locator('.cal-native-mode-toggle span').evaluateAll(n => new Set(n.map(e => Math.round(e.getBoundingClientRect().top))).size === 1), 'Post type picker must be one row');
      await measure(page, 'samples-create-' + suffix); await shot(page, 'samples-create-' + suffix);
      await page.evaluate(() => _calCloseNativePost());
      for (const view of ['smmreview','organizer']) {
        await page.locator('[data-cal-view="' + view + '"]').click();
        for (const state of ['loading','error','empty']) {
          await page.evaluate(({ state, row }) => { sxrState.loading = state === 'loading'; sxrState.error = state === 'error' ? 'Synthetic read refusal' : ''; sxrState.posts = state === 'empty' ? [] : [{ ...row }]; _sxrRenderBody(); }, { state, row });
          const label = 'samples-' + (view === 'organizer' ? 'sheet' : 'review') + '-' + state + '-' + suffix;
          await measure(page, label); await shot(page, label);
        }
        await page.evaluate(row => { sxrState.loading = false; sxrState.error = ''; sxrState.posts = [{ ...row }]; _sxrRenderBody(); }, row);
      }
      await page.setViewportSize({ width: 1024, height: 900 });
      await page.locator('[data-pocket-staff-samples]').waitFor({ state: 'detached' });
      ok(await page.locator('.pocket-staff-samples-heading, .pocket-staff-samples-menu').count() === 0, 'Sample phone chrome leaked to desktop');
      ok(await page.locator('#svClientBadgeWrap').evaluate(node => !!node.closest('.header')), 'Sample desktop client selector was not restored');
      await page.setViewportSize({ width, height: 844 });
    }
    await page.evaluate(row => { navTo('calendar'); _calInvalidateActiveLoad(); Object.assign(calState, { client: 'Phone Fixture Client', view: 'organizer', loading: false, error: '', posts: [{ ...row, id: 'p_staff_selection_fixture_1', caption: 'A fictional caption.', caption_status: 'In Progress' }] }); _calRenderShell(); _calRenderBody(); _calToggleSelectMode(); }, row);
    if (!before) await measure(page, 'calendar-selection-' + suffix);
    await shot(page, 'calendar-selection-' + suffix);
    if (!before) {
      await page.locator('#calStrip .cal-card-select-overlay').click({ position: { x: 30, y: 30 } });
      ok((await page.locator('#calSelectCount').innerText()).includes('1'), 'Calendar tap did not select its card');
      await measure(page, 'calendar-selected-' + suffix); await shot(page, 'calendar-selected-' + suffix);
      await page.locator('#calSelectArchive').click();
      await page.locator('#confirmOverlay.active').waitFor();
      await shot(page, 'calendar-archive-confirm-' + suffix);
      await page.locator('#confirmOverlay.active button', { hasText: /^Cancel$/ }).click();
      await page.evaluate(() => _calToggleSelectMode('caption'));
      await measure(page, 'calendar-caption-selection-' + suffix); await shot(page, 'calendar-caption-selection-' + suffix);
      await page.locator('#calStrip .cal-card-select-overlay').click({ position: { x: 30, y: 30 } });
      await measure(page, 'calendar-caption-selected-' + suffix); await shot(page, 'calendar-caption-selected-' + suffix);
      ok(errors.length === 0, 'Native page errors: ' + errors.join(' | '));
    }
  } finally { await ctx.close(); }
}
(async () => {
  const server = await serve();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: !headed, ...(headed ? { channel: 'chrome' } : {}) });
  try {
    const results = await Promise.allSettled(widths.flatMap(width => ['light','dark'].map(theme => runPhone(browser, origin, width, theme))));
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Staff Selection/Samples phone checks failed');
  } finally { await browser.close(); server.close(); }
  if (shots) fs.writeFileSync(path.join(shots, 'measurements.json'), JSON.stringify(measurements, null, 2) + '\n');
  console.log(before ? 'staff-selection-samples: BEFORE pictures captured; no acceptance claimed.' : 'staff-selection-samples: OK (' + checks + ' checks; Selection, Samples Review/Sheet, light/dark, dialogs, loading/empty/error/saving and desktop restore; 360/390/430).');
})().catch(error => { console.error(error); process.exitCode = 1; });
