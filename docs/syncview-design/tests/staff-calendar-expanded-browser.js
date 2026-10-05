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
const phoneThumbnailComparison = require('./phone-thumbnail-comparison');
const widths = [360, 390, 430];
const measurements = [];
let checks = 0;
const ok = (value, message) => { assert(value, message); checks++; };
async function measure(page, label) {
  const result = await page.evaluate(() => {
    const visible = node => node.checkVisibility({ checkVisibilityCSS: true });
    const surfaces = '#svJump:not([hidden]), #calView, .cal-prompt-overlay.open, .cal-import-overlay.open, .cal-preview-overlay.open, .cal-comments-overlay.open, .cal-lightbox.open, .thumb-compare-overlay.open, .dp-popup, .cal-fld-status-menu';
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
  const overlay = await page.locator('#svJump:not([hidden]), dialog[open], .cal-lightbox.open, .thumb-compare-overlay.open, .cal-comments-overlay.open, .cal-prompt-overlay.open, .cal-import-overlay.open, .cal-preview-overlay.open, .cal-fld-status-menu, .dp-popup, #confirmOverlay.active, #notifyOverlay.active').count();
  await page.screenshot({ path: path.join(shots, label + '.png'), fullPage: !overlay, animations: 'disabled' });
}
async function review(browser, origin, width, theme) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const writes = [];
  const row = { ...BASE_ROW, id: 'p_staff_phone_fixture_1', name: 'Make room for a better day.', scheduled_date: new Date().toISOString().slice(0,10), thumbnail_url: 'https://images.example.invalid/phone-fixture.png', video_deliverable_id: '00000000-0000-4000-8000-000000000001', graphic_deliverable_id: '00000000-0000-4000-8000-000000000002', video_status: 'For SMM Approval', graphic_status: 'For SMM Approval', caption_status: 'For SMM Approval', status: 'For SMM Approval' };
  await installFixture(ctx, origin, row, writes, 'calendar');
  await ctx.route('https://images.example.invalid/**', route => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><rect width="1080" height="1350" fill="#e6ddf5"/><circle cx="720" cy="400" r="220" fill="#c8b6e9"/><path d="M0 1000Q450 600 1080 1100V1350H0Z" fill="#9580b8"/></svg>' }));
  await seedStaffGate(ctx);
  await ctx.addInitScript(value => localStorage.setItem('syncview_theme', value), theme);
  if (process.env.POCKET_FONT_DIR) {
    const css = [400, 500, 600, 700, 800].map(weight => "@font-face{font-family:'Plus Jakarta Sans';font-weight:" + weight + ";src:url(data:font/ttf;base64," + fs.readFileSync(path.join(process.env.POCKET_FONT_DIR, 'plus-jakarta-' + weight + '.ttf')).toString('base64') + ") format('truetype');font-display:block}").join('\n');
    await ctx.route('https://fonts.googleapis.com/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: css }));
  }
  if (before) {
    const base = path.resolve(beforeRoot);
    await ctx.route(origin + '/**', route => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/__fixture')) return route.fallback();
      const file = path.resolve(base, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      if (!file.startsWith(base + path.sep)) return route.abort();
      return route.fulfill({ status: 200, contentType: file.endsWith('.html') ? 'text/html' : 'text/javascript', body: fs.readFileSync(file) });
    });
  }
  try {
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/index.html#calendar', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof navTo === 'function');
    await page.evaluate(() => navTo('calendar'));
    await page.locator('#calView').waitFor();
    // Calendar uses local dates; UTC midnight must not put the fixture into
    // the next week while the visible browser is still on Sunday.
    row.scheduled_date = await page.evaluate(() => _calIsoOf(new Date()));
    await page.evaluate(row => {
      _calInvalidateActiveLoad();
      calState.loading = false;
      calState.error = '';
      calState.client = 'Phone Fixture Client';
      calState.posts = [row];
      calState.view = 'smmreview';
      calState.monthFilter = 'all';
      calState.statusFilter = 'all';
      _calSavePins(['Phone Fixture Client']);
      _calRenderShell();
      _calRenderBody();
    }, row);
    const card = page.locator('[data-cal-review-pid="' + row.id + '"]');
    await card.waitFor();
    const suffix = theme + '-' + width;
    await shot(page, 'review-queue-' + suffix);
    await card.locator('.kcard-expand-btn').click();
    await shot(page, 'review-' + suffix);
    if (before) {
      for (const view of ['organizer', 'month', 'week']) {
        await page.evaluate(view => onCalViewChange(view), view);
        await shot(page, (view === 'organizer' ? 'sheet' : view) + '-' + suffix);
      }
      return;
    }
    await page.locator('[data-pocket-staff-phone=calendar]').waitFor();
    ok(await page.locator('.header').isHidden(), 'separate desktop header remains');
    ok(await page.evaluate(value => value === 'dark' ? document.documentElement.dataset.theme === 'dark' : document.documentElement.dataset.theme !== 'dark', theme), 'staff theme changed');
    await measure(page, 'review-' + suffix);
    ok(await card.locator('.cal-review-panel').count() === 3, 'component sections disappeared');
    const lefts = await card.locator('.cal-review-panel').evaluateAll(nodes => nodes.map(node => Math.round(node.getBoundingClientRect().left)));
    ok(new Set(lefts).size === 1, 'staff sections remain in desktop columns');
    const note = card.locator('[data-comp=caption] textarea');
    await note.fill('Please shorten the opening line.');
    ok(await card.locator('[data-comp=caption] .cal-review-approve-main').isDisabled(), 'draft allowed approval');
    await page.locator('[data-staff-menu=tabs]').click();
    await measure(page, 'tabs-' + suffix);
    await shot(page, 'tabs-' + suffix);
    await page.keyboard.press('Escape');
    ok(await note.inputValue() === 'Please shorten the opening line.', 'Tabs lost the draft');
    await page.locator('[data-staff-menu=more]').click();
    await measure(page, 'more-' + suffix);
    await shot(page, 'more-' + suffix);
    await page.keyboard.press('Escape');
    await page.locator('[data-staff-menu=more]').click();
    await page.locator('dialog[open] .cal-kebab-item', { hasText: /^Platform$/ }).click();
    ok(await page.locator('dialog[open]').count() === 0, 'More trapped the Platform dialog');
    await page.locator('.cal-import-overlay.open').waitFor();
    await measure(page, 'platform-' + suffix);
    await shot(page, 'platform-' + suffix);
    await page.evaluate(() => closeCalImport());
    await page.locator('[data-staff-menu=more]').click();
    await page.locator('dialog[open] .cal-kebab-import-toggle').click();
    await page.locator('dialog[open] .cal-kebab-subitem').click();
    ok(await page.locator('dialog[open]').count() === 0, 'More trapped the Import dialog');
    await page.locator('.cal-import-overlay.open').waitFor();
    await measure(page, 'import-' + suffix);
    await shot(page, 'import-' + suffix);
    await page.evaluate(() => {
      _calSetImportHeaders(['Post name', 'Caption']);
      _calSetImportRows([{ 'Post name': 'Phone fixture import', Caption: 'A fictional caption.' }]);
      _calRenderImportMap();
    });
    await measure(page, 'import-map-' + suffix);
    const importChecks = await page.locator('.cal-import-skip-chk').evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { w: r.width, h: r.height }; }));
    ok(importChecks.every(r => r.w >= 44 && r.h >= 44), 'import column toggles need 44px targets');
    await shot(page, 'import-map-' + suffix);
    await page.locator('#calImportGo').click();
    await measure(page, 'import-select-' + suffix);
    await shot(page, 'import-select-' + suffix);
    await page.locator('.cal-import-pick-toggle').click();
    ok(await page.locator('#calImportGo').isDisabled(), 'Import must stay disabled with no selected rows');
    await measure(page, 'import-select-empty-' + suffix);
    await shot(page, 'import-select-empty-' + suffix);
    await page.evaluate(() => closeCalImport());
    await page.locator('[data-staff-menu=more]').click();
    await page.evaluate(() => _syncviewOpenStaffAccount());
    await page.locator('#staffAccountPopover').waitFor();
    await measure(page, 'account-' + suffix);
    await shot(page, 'account-' + suffix);
    await page.evaluate(() => _syncviewCloseStaffAccount());
    await page.keyboard.press('Escape');
      await page.locator('[data-staff-menu=more]').click();
      await page.locator('dialog[open] .sv-jump-touch').click();
      await page.locator('#svJump:not([hidden])').waitFor();
      ok(await page.locator('dialog[open]').count() === 0, 'More trapped native Quick jump');
      await page.locator('#svJumpInput').fill('phone fixture');
      ok(await page.locator('#svJumpInput').evaluate(node => node === document.activeElement), 'Quick jump input lost focus');
      await measure(page, 'quick-jump-' + suffix); await shot(page, 'quick-jump-' + suffix);
      await page.keyboard.press('Escape');
    await page.evaluate(() => _calOpenCaptionPromptModal());
    await page.locator('#calPromptOverlay.open').waitFor();
    await measure(page, 'caption-prompt-' + suffix);
    await shot(page, 'caption-prompt-' + suffix);
    await page.evaluate(() => _calCloseCaptionPromptModal());
    await page.evaluate(() => _calOpenNativePost());
    await page.locator('#calNativePostCreate').waitFor();
    await measure(page, 'create-post-' + suffix);
    await shot(page, 'create-post-' + suffix);
    await page.evaluate(() => _calSetNativePostMode('thumbnail'));
    await measure(page, 'create-thumbnail-' + suffix);
    await shot(page, 'create-thumbnail-' + suffix);
    await page.evaluate(() => _calCloseNativePost());
    await page.evaluate(() => {
      _arxOpen('cal');
      arxState.seq++;
      arxState.loading = false;
      arxState.rows = [];
      _arxRenderModal();
    });
    for (const state of ['empty', 'loading', 'error', 'rows']) {
      await page.evaluate(({ state, row }) => {
        arxState.loading = state === 'loading';
        arxState.error = state === 'error' ? 'read' : '';
        arxState.rows = state === 'rows' ? [{ ...row, status: 'Archived' }] : [];
        arxState.canWiden = true;
        _arxRenderModal();
      }, { state, row });
      await measure(page, 'archived-' + state + '-' + suffix);
      await shot(page, 'archived-' + state + '-' + suffix);
    }
    await page.evaluate(() => _arxClose());
    await page.evaluate(id => openCalComments(id), row.id);
    await page.locator('#calCommentsOverlay.open').waitFor();
    await measure(page, 'notes-' + suffix);
    await shot(page, 'notes-' + suffix);
    await page.evaluate(() => closeCalComments());
    await card.locator('.cal-review-preview-thumb-btn').click();
    await page.locator('.cal-lightbox.open').waitFor();
    await measure(page, 'lightbox-' + suffix);
    await shot(page, 'lightbox-' + suffix);
    await page.locator('.cal-lightbox-close').click();
    await phoneThumbnailComparison(page, ctx, { surface: 'calendar', id: row.id, measure, shot, suffix: suffix, prefix: '' });
    await page.evaluate(id => { _calReviewState.errors[id + '|caption'] = 'Synthetic save refusal'; _calReviewRepaintCard(id); }, row.id);
    ok((await card.innerText()).includes('Synthetic save refusal'), 'save refusal disappeared');
    await measure(page, 'save-error-' + suffix);
    await shot(page, 'save-error-' + suffix);
    await page.evaluate(id => { delete _calReviewState.errors[id + '|caption']; _calReviewState.saving[id + '|caption'] = true; calState.posts.find(p => p.id === id).caption_status = 'Approved'; _calReviewRepaintCard(id); }, row.id);
    ok(await card.locator('[data-comp=caption] .pocket-staff-cal-saving').isVisible(), 'in-flight decision looked finished');
    ok((await card.locator('[data-comp-pill=caption]').innerText()).includes('Saving'), 'in-flight status pill looked finished');
    await measure(page, 'sending-' + suffix);
    await shot(page, 'sending-' + suffix);
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.locator('[data-pocket-staff-phone]').waitFor({ state: 'detached' });
    ok(await page.locator('.pocket-staff-cal-heading, .pocket-staff-cal-menu').count() === 0, 'staff phone nodes leaked to desktop');
    ok(await page.locator('#svClientBadgeWrap').evaluate(node => !!node.closest('.header')), 'desktop client selector was not restored');
    ok(await page.locator('#staffIdentityWrap').evaluate(node => !!node.closest('.header')), 'desktop account was not restored');
    ok(await page.locator('#calKebabMenu').evaluate(node => node.hidden), 'desktop setup menu remained open');
    await page.setViewportSize({ width, height: 844 });
    await page.locator('[data-pocket-staff-phone=calendar]').waitFor();
    await page.evaluate(row => { delete _calReviewState.saving[row.id + '|caption']; calState.posts = [{ ...row }]; _calRenderBody(); }, row);
    for (const view of ['smmreview', 'organizer', 'month', 'week']) {
      await page.locator('[data-cal-view="' + view + '"]').click();
      const name = view === 'smmreview' ? 'review' : view === 'organizer' ? 'sheet' : view;
      await measure(page, name + '-loaded-' + suffix);
      if (view !== 'smmreview') await shot(page, name + '-' + suffix);
      if (view === 'organizer') {
        ok(await page.locator('#calStrip').evaluate(node => getComputedStyle(node).flexDirection === 'column'), 'Sheet squeezed desktop strip onto phone');
        await page.locator('[data-staff-menu=more]').click();
        ok(await page.locator('dialog[open] #calOrganizeBtn').isVisible(), 'Organize is missing from More');
        await page.locator('dialog[open] #calOrganizeBtn').click();
        await measure(page, 'organize-' + suffix);
        await shot(page, 'organize-' + suffix);
        await page.locator('dialog[open] #calOrganizeBtn').click();
        await measure(page, 'sheet-more-' + suffix);
        await shot(page, 'sheet-more-' + suffix);
        await page.keyboard.press('Escape');
        await page.locator('.cal-fld-substatus-trigger').first().click();
        await page.locator('.cal-fld-status-menu').waitFor();
        await measure(page, 'status-menu-' + suffix);
        await shot(page, 'status-menu-' + suffix);
        await page.keyboard.press('Escape');
        ok(await page.locator('.cal-fld-status-menu').count() === 0, 'Escape did not close the phone status picker');
        await page.locator('.cal-fld-setall').click();
        await page.locator('.cal-fld-status-menu.open').waitFor();
        await measure(page, 'all-statuses-' + suffix);
        await shot(page, 'all-statuses-' + suffix);
        await page.keyboard.press('Escape');
        await page.locator('.cal-date-chip').first().click();
        await page.locator('.dp-popup').waitFor();
        await measure(page, 'date-picker-' + suffix);
        await shot(page, 'date-picker-' + suffix);
        await page.keyboard.press('Escape');
        await page.evaluate(id => archiveCalPost(id), row.id);
        await page.locator('#confirmOverlay.active').waitFor();
        await shot(page, 'archive-confirm-' + suffix);
        ok(await page.locator('#confirmOverlay.active button').evaluateAll(nodes => nodes.every(node => { const r = node.getBoundingClientRect(); return r.width >= 44 && r.height >= 44; })), 'Archive confirmation targets under 44px');
        await page.locator('#confirmOverlay.active button', { hasText: /^Cancel$/ }).click();
      }
      if (view === 'month' || view === 'week') {
        // Runs of empty days fold into one labelled line; the folded days stay in the page for drag and drop.
        if (view === 'week') ok(await page.locator('.cal-week-col:visible').count() + await page.locator('.cal-week-col.pocket-run-rest').count() === 7, 'Week lost a current day or exposed buffer days');
        const dayRows = await page.evaluate(v => [...document.querySelectorAll(v === 'month' ? '.cal-month-cell[data-iso]' : '.cal-week-col[data-iso]')]
          .filter(e => !e.classList.contains('out') && e.checkVisibility({ checkVisibilityCSS: true }))
          .map(e => ({ label: (e.querySelector('.pocket-run-label') || {}).textContent || '', run: e.classList.contains('pocket-run-head'), rest: e.classList.contains('pocket-run-rest') })), view);
        ok(!dayRows.some(r => r.rest), view + ': a folded day must not show');
        ok(dayRows.every(r => !r.run || /^[A-Z][a-z]{2} \d{1,2}( to [A-Z][a-z]{2} \d{1,2})? · Nothing scheduled$/.test(r.label)), view + ': run line must name its days');
        ok(await page.locator('.pocket-run-rest').count() === await page.evaluate(() => document.querySelectorAll('.pocket-run-rest[data-iso]').length), view + ': folded days keep their date for drag and drop');
        const dragDays = await page.evaluate(v => {
          const wrap = document.querySelector(v === 'month' ? '.cal-month-wrap' : '.cal-week-wrap');
          const source = wrap.querySelector('[data-cal-move]');
          const folded = [...wrap.querySelectorAll('.pocket-run-rest')];
          source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: new DataTransfer() }));
          const revealed = folded.every(node => node.checkVisibility({ checkVisibilityCSS: true }));
          source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: new DataTransfer() }));
          return { revealed, restored: folded.every(node => !node.checkVisibility({ checkVisibilityCSS: true })) };
        }, view);
        ok(dragDays.revealed, view + ': native drag must reveal every folded date target');
        ok(dragDays.restored, view + ': native drag end must restore empty-day grouping');
        await page.locator(view === 'month' ? '.cal-month-cell:not(.out) .cal-month-pill' : '.cal-week-col:visible .cal-week-card').first().click();
        await measure(page, name + '-preview-' + suffix);
        await shot(page, name + '-preview-' + suffix);
        await page.evaluate(() => closeCalPreview());
      }
      await page.evaluate(() => { calState.loading = true; _calRenderBody(); });
      ok(await page.locator('.cal-skeleton-loader').isVisible(), name + ': skeleton was removed');
      await measure(page, name + '-loading-' + suffix);
      await shot(page, name + '-loading-' + suffix);
      await page.evaluate(() => { calState.loading = false; calState.error = 'Synthetic read refusal'; _calRenderBody(); });
      ok(await page.locator('.cal-error .cal-link').isVisible(), name + ': retry was removed');
      await measure(page, name + '-read-error-' + suffix);
      await shot(page, name + '-read-error-' + suffix);
      await page.evaluate(() => { calState.error = ''; calState.posts = []; _calRenderBody(); });
      await measure(page, name + '-empty-' + suffix);
      await shot(page, name + '-empty-' + suffix);
      await page.evaluate(row => { calState.posts = [{ ...row }]; _calRenderBody(); }, row);
    }
    ok(errors.length === 0, 'native page errors: ' + errors.join(' | '));
  } finally { await ctx.close(); }
}
(async () => {
  const server = await serve(root);
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: !headed, ...(headed ? { channel: 'chrome' } : {}) });
  try {
    const results = await Promise.allSettled(widths.flatMap(width => ['light', 'dark'].map(theme => review(browser, origin, width, theme))));
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Staff Calendar phone checks failed');
  } finally { await browser.close(); server.close(); }
  if (shots) fs.writeFileSync(path.join(shots, 'measurements.json'), JSON.stringify(measurements, null, 2) + '\n');
  console.log(before ? 'staff-calendar-expanded: BEFORE pictures captured; no acceptance claimed.' : 'staff-calendar-expanded: OK (' + checks + ' checks; Review/Sheet/Month/Week, light/dark, menus/dialogs, loading/empty/error/saving, desktop restore; 360/390/430).');
})().catch(error => { console.error(error); process.exitCode = 1; });
