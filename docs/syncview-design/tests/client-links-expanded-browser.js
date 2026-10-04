'use strict';
// Generated product, fictional client and intercepted backend. Optional
// --capture-before records the unchanged source without claiming acceptance.
// --headed uses visible Chrome; the local transport adapter can preserve focus.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { serve, installFixture, BASE_ROW } = require('./client-phone-review-browser');
const widths = [360, 390, 430];
const before = process.argv.includes('--capture-before');
const headed = process.argv.includes('--headed');
const beforeRoot = process.argv.find(a => a.startsWith('--before-root='))?.slice(14);
const shots = process.env.POCKET_PHONE_SHOTS;
const measurements = [];
let checks = 0;
const ok = (value, message) => { assert(value, message); checks++; };
async function measure(page, label) {
  const m = await page.evaluate(() => {
    const visible = node => node.checkVisibility({ checkVisibilityCSS: true });
    const root = document.querySelector('[data-pocket-client-phone], [data-client-entry-state]');
    return {
      width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      controls: [...root.querySelectorAll('button, a[href], input:not([type=hidden]), textarea'), ...document.querySelectorAll('#confirmOverlay.active button, .detail-info-overlay.open button')].filter(visible).map(node => {
        const r = node.getBoundingClientRect();
        return { what: node.getAttribute('aria-label') || node.className, w: r.width, h: r.height };
      }),
      fields: [...root.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea')].filter(visible).map(node => parseFloat(getComputedStyle(node).fontSize)),
    };
  });
  ok(m.scrollWidth <= m.width + 1, label + ': sideways page scroll');
  for (const c of m.controls) ok(c.w >= 43.5 && c.h >= 43.5, label + ': target under 44px: ' + JSON.stringify(c));
  for (const font of m.fields) ok(font >= 16, label + ': editable field under 16px');
  measurements.push({ label, width: m.width, scrollWidth: m.scrollWidth, controls: m.controls.length, fields: m.fields.length });
}
async function shot(page, label) {
  if (!shots) return;
  fs.mkdirSync(shots, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))));
  const overlay = await page.locator('dialog[open], .cal-comments-overlay.open, .cal-lightbox.open, #confirmOverlay.active, .detail-info-overlay.open').count();
  await page.screenshot({ path: path.join(shots, label + '.png'), fullPage: !overlay, animations: 'disabled' });
}
async function entryErrors(page, width, prefix) {
  await page.evaluate(() => _syncviewInvalidClientLinkScreen());
  await page.locator('[data-client-entry-state=invalid]').waitFor();
  if (!before) {
    await measure(page, prefix + '-invalid-link-' + width);
    ok(await page.locator('[data-pocket-client-phone]').count() === 0, 'invalid link kept verified-client navigation');
  }
  await shot(page, prefix + '-invalid-link-' + width);
  await page.evaluate(() => _syncviewInvalidClientLinkScreen({ retryable: true }));
  await page.locator('[data-client-entry-state=retry]').waitFor();
  if (!before) await measure(page, prefix + '-verify-error-' + width);
  await shot(page, prefix + '-verify-error-' + width);
  await page.locator('[data-client-entry-state=retry] button').click();
  await page.waitForFunction(() => !!_syncviewClientEntryCapability?.verified);
  await (prefix === 'samples' ? page.locator('#sxrView') : page.getByText('No analytics yet', { exact: true })).waitFor();
  if (!before) {
    await page.locator('[data-pocket-client-phone]').waitFor();
    await measure(page, prefix + '-retry-restored-' + width);
  }
}
async function fixture(browser, origin, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const writes = [];
  const row = { ...BASE_ROW, id: 's_phone_fixture_1', name: 'Make room for a better day.', thumbnail_url: 'https://drive.google.com/file/d/pocket_fixture_thumb/view' };
  await installFixture(ctx, origin, row, writes, 'samples');
  await ctx.addInitScript(() => localStorage.setItem('syncview_theme', 'dark'));
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
  await ctx.route('**/functions/v1/thumbnail-revision-read', route => route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{"ok":true,"items":[]}' }));
  await ctx.route('https://lh3.googleusercontent.com/d/pocket_fixture_thumb*', route => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200"><rect width="900" height="1200" fill="#dedccf"/><circle cx="480" cy="500" r="260" fill="#aaa88d"/><text x="80" y="1030" font-size="54" fill="#32352c" font-family="sans-serif">A better day.</text></svg>' }));
  // Use the production chart implementation, never a chart-shaped test stub.
  await ctx.route('https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js', async route => {
    if (process.env.POCKET_CHART_JS) return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(process.env.POCKET_CHART_JS) });
    await route.fulfill({ response: await route.fetch() });
  });
  if (process.env.POCKET_FONT_DIR) {
    const css = [400, 500, 600, 700, 800].map(weight => `@font-face{font-family:'Plus Jakarta Sans';font-weight:${weight};src:url(data:font/ttf;base64,${fs.readFileSync(path.join(process.env.POCKET_FONT_DIR, 'plus-jakarta-' + weight + '.ttf')).toString('base64')}) format('truetype');font-display:block}`).join('\n');
    await ctx.route('https://fonts.googleapis.com/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: css }));
  }
  if (before) {
    const root = path.resolve(beforeRoot);
    await ctx.route(origin + '/**', route => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/__fixture')) return route.fallback();
      const file = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      if (!file.startsWith(root + path.sep)) return route.abort();
      return route.fulfill({ status: 200, contentType: file.endsWith('.html') ? 'text/html' : 'text/javascript', body: fs.readFileSync(file) });
    });
  }
  return { ctx, row, writes, cors };
}
async function samples(browser, origin, width) {
  const { ctx, row, writes } = await fixture(browser, origin, width);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/index.html?c=Phone%20Fixture%20Client&t=synthetic-phone-token&v=sample-reviews&sxr=1', { waitUntil: 'domcontentloaded' });
  const card = page.locator('[data-cal-review-pid="' + row.id + '"]');
  await card.waitFor();
  await shot(page, 'samples-list-' + width);
  await card.locator('.kcard-expand-btn').click();
  await shot(page, 'samples-review-' + width);
  if (!before) {
    await measure(page, 'samples-review-' + width);
    ok(await card.locator('.cal-review-panel:visible').count() === 2, 'Video and Thumbnail must both remain visible');
    ok(await page.locator('html[data-theme=dark]').count() === 0, 'client link became dark');
    const note = card.locator('[data-comp=graphic] textarea');
    await note.fill('Please simplify the thumbnail text.');
    ok(await card.locator('[data-comp=graphic] .cal-review-approve-btn').isDisabled(), 'draft must disable approval');
    ok(!await card.locator('[data-comp=graphic] .cal-review-tweak-btn').isDisabled(), 'draft must enable Request change');
    await page.locator('[data-pocket-open=tabs]').click();
    await measure(page, 'samples-tabs-' + width);
    await shot(page, 'samples-tabs-' + width);
    await page.keyboard.press('Escape');
    ok(await page.locator('[data-pocket-open=tabs]').evaluate(node => document.activeElement === node), 'Tabs did not restore focus');
    ok(await note.inputValue() === 'Please simplify the thumbnail text.', 'Tabs lost the note');
    await note.fill('');
    await card.locator('.cal-review-preview-thumb-btn').click();
    await page.locator('#sxrLightbox.open').waitFor();
    await measure(page, 'samples-lightbox-' + width);
    await shot(page, 'samples-lightbox-' + width);
    await page.locator('.cal-lightbox-close').click();
    await page.evaluate(id => { _sxrReviewState.errors[id + '|graphic'] = 'Synthetic save refusal'; _sxrReviewRepaintCard(id); }, row.id);
    ok((await card.innerText()).includes('Synthetic save refusal'), 'save failure disappeared');
    await measure(page, 'samples-save-error-' + width);
    await shot(page, 'samples-save-error-' + width);
    await page.evaluate(id => { delete _sxrReviewState.errors[id + '|graphic']; _sxrReviewState.saving[id + '|graphic'] = true; _sxrReviewRepaintCard(id); }, row.id);
    ok(await card.locator('[data-comp=graphic] .cal-review-approve-btn').isDisabled(), 'pending save permits another approval');
    ok(await card.locator('[data-comp=graphic] .pocket-client-phone-saving').isVisible(), 'pending decision has no visible saving label');
    await measure(page, 'samples-sending-' + width);
    await shot(page, 'samples-sending-' + width);
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.locator('[data-pocket-client-phone]').waitFor({ state: 'detached' });
    ok(await page.locator('.pocket-client-phone-saving').count() === 0, 'phone saving label leaked to desktop');
    await page.setViewportSize({ width, height: 844 });
    await page.locator('[data-pocket-client-phone=samples]').waitFor();
    ok(await card.locator('[data-comp=graphic] .pocket-client-phone-saving').isVisible(), 'pending save lost its label on return to phone');
    await page.evaluate(id => { sxrState.posts.find(row => row.id === id).graphic_status = 'Approved'; _sxrReviewRepaintCard(id); }, row.id);
    ok(await card.locator('[data-comp=graphic] .pocket-client-phone-saving').isVisible(), 'uncommitted approval looked finished');
    ok(!await card.locator('[data-comp=graphic] .cal-review-mini-sub').isVisible(), 'pending approval said Locked in');
    ok((await card.locator('[data-comp-pill=graphic]').innerText()).includes('Saving'), 'pending approval pill looked finished');
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.locator('[data-pocket-client-phone]').waitFor({ state: 'detached' });
    ok((await card.locator('[data-comp-pill=graphic]').innerText()).toLowerCase().includes('approved'), 'desktop retained the phone saving pill');
    await page.setViewportSize({ width, height: 844 });
    await page.locator('[data-pocket-client-phone=samples]').waitFor();
    ok(await card.locator('[data-comp=graphic] .pocket-client-phone-saving').isVisible(), 'pending approval lost its phone label');
    await measure(page, 'samples-approve-sending-' + width);
    await shot(page, 'samples-approve-sending-' + width);
    await page.evaluate(id => { sxrState.posts.find(row => row.id === id).graphic_status = 'Client Approval'; }, row.id);
    await page.evaluate(id => { _sxrReviewState.saving[id + '|graphic'] = false; _sxrReviewRepaintCard(id); }, row.id);
    ok(writes.length === 0, 'navigation or disclosure sent a write');
  }
  await page.locator('[data-cal-view=organizer]').click();
  await shot(page, 'samples-sheet-' + width);
  if (!before) {
    await measure(page, 'samples-sheet-' + width);
    ok(await page.locator('.cal-card input:not([readonly]):not([type=hidden]), .cal-card textarea:not([readonly])').count() === 0, 'client sample fields became editable');
    await page.locator('.cal-comments-btn').first().click();
    await page.locator('#sxrCommentsModal').waitFor({ state: 'visible' });
    await measure(page, 'samples-notes-' + width);
    await shot(page, 'samples-notes-' + width);
    await page.locator('.cal-comments-close').click();
    await page.locator('[data-pocket-open=more]').click();
    ok(await page.locator('[data-pocket-menu=more] #sxrZoomCtl').count() === 1, 'card size is outside More');
    ok((await page.locator('[data-pocket-menu=more]').innerText()).includes('All available actions'), 'More opened an empty sheet for unavailable card sizing');
    await measure(page, 'samples-more-' + width);
    await shot(page, 'samples-more-' + width);
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.locator('[data-pocket-client-phone]').waitFor({ state: 'detached' });
    ok(await page.locator('.pocket-client-phone-heading, .pocket-client-phone-menu, .pocket-client-phone-action, .pocket-client-phone-saving').count() === 0, 'phone nodes leaked to desktop');
    ok(await page.locator('.cal-toolbar-mid > #sxrZoomCtl').count() === 1, 'native card size was not restored');
    await page.setViewportSize({ width, height: 844 });
    await page.locator('[data-pocket-client-phone=samples]').waitFor();
    await page.locator('[data-cal-view=review]').click();
    if (await card.locator('.kcard-expand-btn').getAttribute('aria-expanded') !== 'true') await card.locator('.kcard-expand-btn').click();
    await card.locator('[data-comp=video] .cal-review-approve-btn').click();
    if (await page.locator('#confirmOverlay.active').count()) {
      await measure(page, 'samples-confirm-' + width);
      await shot(page, 'samples-confirm-' + width);
      await page.locator('#confirmYes').click();
    }
    await page.waitForFunction(() => !_sxrReviewState.saving['s_phone_fixture_1|video']);
    ok(writes.some(write => /Approved/.test(write.body)), 'Approve did not reach the native writer');
    await card.locator('[data-comp=graphic] textarea').fill('Please simplify the thumbnail text.');
    await card.locator('[data-comp=graphic] .cal-review-tweak-btn').click();
    await page.waitForFunction(() => !_sxrReviewState.saving['s_phone_fixture_1|graphic']);
    ok(writes.some(write => /Please simplify the thumbnail text/.test(write.body)), 'Request change did not send the exact note');
  }
  await page.evaluate(() => { sxrState.posts = []; sxrState.view = 'review'; _sxrRenderShell(); _sxrRenderBody(); });
  await shot(page, 'samples-queue-' + width);
  if (!before) {
    await measure(page, 'samples-queue-' + width);
    ok((await page.locator('#sxrBody').innerText()).includes('Nothing to review'), 'empty queue lost its native meaning');
    await page.evaluate(() => { sxrState.loading = true; _sxrRenderBody(); });
    ok(await page.locator('.cal-skeleton-loader').count() > 0, 'Samples skeleton removed');
    await measure(page, 'samples-loading-' + width);
    await shot(page, 'samples-loading-' + width);
    await page.evaluate(() => { sxrState.loading = false; sxrState.error = new Error('Synthetic read failure'); _sxrRenderBody(); });
    ok(await page.locator('.cal-error').count() === 1, 'read failure became an empty queue');
    await measure(page, 'samples-read-error-' + width);
    await shot(page, 'samples-read-error-' + width);
    ok(errors.length === 0, 'Samples page errors: ' + errors.join(' | '));
  }
  await entryErrors(page, width, 'samples');
  if (!before) ok(errors.length === 0, 'Samples retry page errors: ' + errors.join(' | '));
  await ctx.close();
}
async function analytics(browser, origin, width, emptyCase = false) {
  const { ctx, cors, writes } = await fixture(browser, origin, width);
  const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  await ctx.route('**/rest/v1/syncview_runtime_flags?**', route => route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify([{ key: 'analytics_mirror_read_enabled', value: { enabled: true } }]) }));
  await ctx.route('**/functions/v1/analytics-read', route => route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({
    ok: true, slug: 'phonefixtureclient', principal: 'client',
    receipts: Object.fromEntries(['metrics', 'top_videos', 'market_research_briefs', 'content_summaries', 'client_profiles'].map(key => [key, { complete: true, created_at: new Date().toISOString() }])),
    data: { metrics: emptyCase ? [] : [{ date: day, client_name: 'Phone Fixture Client', ig_followers: '2450', ig_avg_views: '16300', ig_avg_likes: '620', tiktok_followers: '8100', tiktok_avg_plays: '9600', yt_subscribers: '12800', yt_total_views: '390000' }], top_videos: [], market_research_briefs: [], content_summaries: [], client_profile: { slug: 'phonefixtureclient', display_name: 'Phone Fixture Client', content_description: 'A fictional account for phone layout checks.' } },
  }) }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const url = origin + '/index.html?c=Phone%20Fixture%20Client&t=synthetic-phone-token';
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  if (!emptyCase) {
  await page.locator('.platform-section').first().waitFor();
  await page.waitForFunction(() => _analyticsExtrasApplied);
  await shot(page, 'analytics-' + width);
  if (!before) {
    await page.locator('[data-pocket-client-phone=analytics]').waitFor();
    await measure(page, 'analytics-' + width);
    ok(await page.locator('html[data-theme=dark]').count() === 0, 'client Analytics became dark');
    ok(await page.evaluate(() => document.querySelector('.m-value').textContent.trim() === fmt('2450')), 'phone layout changed native analytics formatting');
    await page.locator('[data-pocket-open=tabs]').click();
    await measure(page, 'analytics-tabs-' + width);
    await shot(page, 'analytics-tabs-' + width);
    await page.keyboard.press('Escape');
    await page.locator('[data-pocket-open=more]').click();
    await measure(page, 'analytics-more-' + width);
    await shot(page, 'analytics-more-' + width);
    await page.locator('.pocket-client-phone-menu .detail-info-btn').click();
    await page.locator('.detail-info-overlay.open').waitFor();
    ok(await page.locator('dialog[open]').count() === 0, 'About opened behind the More dialog');
    await measure(page, 'analytics-about-' + width);
    await shot(page, 'analytics-about-' + width);
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.locator('[data-pocket-client-phone]').waitFor({ state: 'detached' });
    ok(await page.locator('.client-view > .view-tab-toggle').count() === 1, 'desktop Analytics tabs were not restored');
    await page.setViewportSize({ width, height: 844 });
    await page.locator('[data-pocket-client-phone=analytics]').waitFor();
    ok(writes.length === 0, 'Analytics navigation wrote data');
    ok(errors.length === 0, 'Analytics page errors: ' + errors.join(' | '));
  }
    await ctx.close();
    // A populated session deliberately keeps its saved copy during refresh.
    // Prove first-use empty separately, without changing that product rule.
    return analytics(browser, origin, width, true);
  }
  await page.getByText('No analytics yet', { exact: true }).waitFor().catch(async error => {
    console.error('Synthetic empty-state diagnostic:', await page.locator('#content').innerText());
    throw error;
  });
  await shot(page, 'analytics-empty-' + width);
  if (!before) {
    await page.locator('[data-pocket-client-phone=analytics]').waitFor();
    await measure(page, 'analytics-empty-' + width);
    await page.evaluate(() => _syncviewClientEntryLoader({ client: _syncviewClientEntryCapability.client, view: 'analytics' }, { extras: true }));
    await page.locator('[data-pocket-client-phone=analytics]').waitFor();
    await measure(page, 'analytics-loading-' + width);
    await shot(page, 'analytics-loading-' + width);
    await page.evaluate(() => _syncviewClientExtrasErrorScreen({ client: _syncviewClientEntryCapability.client, view: 'analytics' }));
    await page.locator('[data-pocket-client-phone=analytics]').waitFor();
    await measure(page, 'analytics-read-error-' + width);
    await shot(page, 'analytics-read-error-' + width);
    ok(errors.length === 0, 'Analytics page errors: ' + errors.join(' | '));
  }
  await entryErrors(page, width, 'analytics');
  if (!before) ok(errors.length === 0, 'Analytics retry page errors: ' + errors.join(' | '));
  await ctx.close();
}
(async () => {
  const server = await serve();
  const browser = await chromium.launch({ headless: !headed, ...(headed ? { channel: 'chrome' } : {}) });
  const origin = 'http://127.0.0.1:' + server.address().port;
  // Widths have independent contexts and fictional backend state. Wait for
  // every context to finish before closing the shared visible browser.
  try {
    const results = await Promise.allSettled(widths.map(async width => {
      await samples(browser, origin, width);
      await analytics(browser, origin, width);
    }));
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Phone checks failed');
  }
  finally { await browser.close(); server.close(); }
  if (shots) fs.writeFileSync(path.join(shots, 'measurements.json'), JSON.stringify(measurements, null, 2) + '\n');
  console.log(before ? 'client-links-expanded: BEFORE screenshots recorded; no Expanded acceptance claimed.' : `client-links-expanded: OK (${checks} assertions; Samples Review/queue/Sheet, Analytics, menus, Notes, lightbox, draft, sending, failure, loading, empty, desktop restore; 360/390/430).`);
})().catch(error => { console.error(error); process.exitCode = 1; });
