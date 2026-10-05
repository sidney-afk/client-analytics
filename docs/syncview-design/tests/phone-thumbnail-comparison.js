'use strict';
// Exercise the native reader and dialog with fictional image/history responses.
// This helper intercepts reads only; it never calls a card writer.
const assert = require('node:assert/strict');
module.exports = async function phoneThumbnailComparison(page, context, options) {
  const { surface, id, measure, shot, suffix, prefix = '' } = options;
  const original = await page.evaluate(({ surface, id }) => {
    const post = (surface === 'samples' ? sxrState : calState).posts.find(p => p.id === id);
    const original = { thumbnail_url: post.thumbnail_url, graphic_status: post.graphic_status };
    post.thumbnail_url = 'https://drive.google.com/file/d/fixture_thumbnail_asset/view';
    post.graphic_status = 'Client Approval';
    return original;
  }, { surface, id });
  let state = 'loading', release;
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
  const reader = async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const request = route.request().postDataJSON();
    if (request.mode === 'availability') return route.fulfill({ status: 200, headers: cors, json: { ok: true, available_source_ids: [id] } });
    if (state === 'loading') await new Promise(resolve => { release = resolve; });
    if (state === 'error' || state === 'denied') return route.fulfill({ status: state === 'denied' ? 403 : 503, headers: cors, json: { ok: false } });
    const ready = state === 'ready';
    return route.fulfill({ status: 200, headers: cors, json: {
      ok: true, available: ready, status: ready ? 'ready' : state === 'pending' ? 'pending' : 'none',
      ...(ready ? { revision: { baseline: { url: 'https://images.example.invalid/comparison-previous.svg' }, latest: { url: 'https://images.example.invalid/comparison-current.svg' } } } : {})
    } });
  };
  const readerUrl = '**/functions/v1/thumbnail-revision-read';
  await context.route(readerUrl, reader);
  await context.route('https://images.example.invalid/comparison-*.svg', route => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200"><rect width="900" height="1200" fill="#dedccf"/><circle cx="450" cy="450" r="240" fill="#aaa88d"/><text x="80" y="1030" font-size="58" fill="#32352c" font-family="sans-serif">' + (route.request().url().includes('previous') ? 'A little change.' : 'A better day.') + '</text></svg>' }));
  const capture = async name => { const label = prefix + 'comparison-' + name + '-' + suffix; await measure(page, label); await shot(page, label); };
  try {
    await page.evaluate(({surface,id}) => _thumbCompareOpen(null, surface, id), {surface,id});
    await page.locator('.thumb-compare-overlay.open').waitFor({ timeout: 8000 });
    await page.waitForFunction(() => document.querySelector('#thumbCompareDialog')?.getAttribute('aria-busy') === 'true');
    await capture('loading');
    for (let attempt = 0; !release && attempt < 80; attempt++) await page.waitForTimeout(25);
    assert(release, 'native comparison reader did not start');
    state = 'pending'; release();
    await page.locator('#thumbCompareContent strong', { hasText: 'still being prepared' }).waitFor({ timeout: 8000 });
    await capture('pending');
    state = 'loading'; release = null;
    await page.locator('.thumb-compare-retry').click();
    await page.waitForFunction(() => document.querySelector('#thumbCompareDialog')?.getAttribute('aria-busy') === 'true');
    assert(await page.locator('.thumb-compare-close').evaluate(node => node === document.activeElement), 'held retry must retain keyboard focus inside the phone dialog');
    await capture('retry-loading');
    for (let attempt = 0; !release && attempt < 80; attempt++) await page.waitForTimeout(25);
    assert(release, 'retry reader did not start');
    state = 'pending'; release();
    await page.locator('#thumbCompareContent strong', { hasText: 'still being prepared' }).waitFor({ timeout: 8000 });
    for (const next of ['none', 'error', 'denied', 'ready']) {
      state = next;
      await page.locator('.thumb-compare-retry').click();
      await page.waitForFunction(() => document.querySelector('#thumbCompareDialog')?.getAttribute('aria-busy') === 'false');
      if (next === 'ready') {
        assert.equal(await page.locator('.thumb-compare-pane').count(), 2, 'both history images must remain available');
        const lefts = await page.locator('.thumb-compare-pane').evaluateAll(nodes => nodes.map(n => Math.round(n.getBoundingClientRect().left)));
        assert.equal(lefts[0], lefts[1], 'comparison panes must stack on phones');
        await page.locator('.thumb-compare-pane img').evaluateAll(images => Promise.all(images.map(img => img.decode())));
      }
      assert(await page.locator('.thumb-compare-close').evaluate(node => node === document.activeElement), 'retry must retain keyboard focus inside the phone dialog');
      await capture(next === 'none' ? 'empty' : next);
    }
    await page.locator('.thumb-compare-pane img').first().evaluate(img => img.dispatchEvent(new Event('error')));
    assert(await page.locator('.thumb-compare-image-error').isVisible(), 'image failure needs an explanation');
    await capture('image-error');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.thumb-compare-overlay.open').count(), 0, 'Escape must close comparison');
    state = 'ready';
    await page.evaluate(({surface,id}) => _thumbCompareOpen(null, surface, id), {surface,id});
    await page.locator('.thumb-compare-close').click();
    assert.equal(await page.locator('.thumb-compare-overlay.open').count(), 0, 'Close must close comparison');
  } finally {
    release?.();
    await page.evaluate(({surface,id,original}) => {
      _thumbCompareClose();
      Object.assign((surface === 'samples' ? sxrState : calState).posts.find(p => p.id === id), original);
    }, { surface, id, original });
    await context.unroute(readerUrl, reader);
  }
};
