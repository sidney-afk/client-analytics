'use strict';
// Finite real Chromium fragment; synthetic image responses only, no app boot.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { extractFunction } = require('./helpers/extract-function');
const { chromium } = require('playwright');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const names = [...new Set([...html.matchAll(/function (_prodDescRich\w+)\(/g)].map(x => x[1]))];
const source = [...names, '_prodBriefMediaPreviews'].map(n => extractFunction(html, n)).join('\n');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
(async () => {
  const browser = await chromium.launch({ headless: true }); let blocked = 0, images = 0;
  try {
    const context = await browser.newContext();
    await context.route('**/*', async route => {
      if (route.request().url() === 'https://fixture.invalid/image.png') { images++; return route.fulfill({ status: 200, contentType: 'image/png', body: png }); }
      blocked++; return route.abort();
    });
    const page = await context.newPage(); await page.setContent('<div id="editor" contenteditable="true"></div>');
    await page.evaluate(source => {
      window.PROD_DESC_RICH_BLOCK_TYPES = ['p','h','ul','hr'];
      (0, eval)(source);
      window.original = 'Before ![private](https://uploads.linear.app/synthetic/image.png) after';
      window.state = { value: original, draft: original, sourceUpdatedAt: 'r2', briefMediaValue: original, briefMediaRevision: 'r2',
        briefMedia: { complete: true, expires_at: new Date(Date.now()+60000).toISOString(), images: [
          { original_url: 'https://uploads.linear.app/synthetic/image.png', content_sha256: 'a'.repeat(64), url: 'https://fixture.invalid/image.png' }] } };
      const root = document.getElementById('editor');
      root.innerHTML = _prodDescRichBuild(original, _prodBriefMediaPreviews(state));
    }, source);
    await page.waitForFunction(() => document.querySelector('img')?.naturalWidth === 1);
    assert.equal(await page.evaluate(() => _prodDescRichSerialize(document.getElementById('editor'))), await page.evaluate(() => original));
    assert.equal(await page.evaluate(() => _prodDescRichRoundTrips(original)), true);
    const edited = await page.evaluate(() => {
      const root = document.getElementById('editor'); root.firstChild.firstChild.nodeValue = 'Edited before ';
      _prodDescRichNormalize(root);
      return _prodDescRichSerialize(root);
    });
    assert.equal(edited, 'Edited before ![private](https://uploads.linear.app/synthetic/image.png) after');
    assert(!edited.includes('fixture.invalid'));
    const download = await page.evaluate(() => {
      state.briefMedia.images[0].display = 'download';
      state.briefMedia.images[0].url = 'https://fixture.invalid/file?download=original.svg';
      const root = document.getElementById('editor'); root.innerHTML = _prodDescRichBuild(original, _prodBriefMediaPreviews(state));
      _prodDescRichNormalize(root);
      return { original: _prodDescRichSerialize(root), images: root.querySelectorAll('img').length, href: root.querySelector('a').href, text: root.textContent };
    });
    assert.equal(download.original, await page.evaluate(() => original)); assert.equal(download.images, 0);
    assert(download.href.includes('download=original.svg')); assert(download.text.includes('Download original file'));
    const deferred = await page.evaluate(() => {
      state.briefMedia.images[0].display = 'deferred'; state.briefMedia.images[0].url = null;
      const root = document.getElementById('editor'); root.innerHTML = _prodDescRichBuild(original, _prodBriefMediaPreviews(state));
      _prodDescRichNormalize(root);
      return { original: _prodDescRichSerialize(root), images: root.querySelectorAll('img,a[href]').length, text: root.textContent };
    });
    assert.equal(deferred.original, await page.evaluate(() => original)); assert.equal(deferred.images, 0);
    assert(deferred.text.includes('This older file has not been restored here yet.'));
    const expired = await page.evaluate(() => {
      state.briefMedia.expires_at = '2000-01-01T00:00:00Z';
      const root = document.getElementById('editor'); root.innerHTML = _prodDescRichBuild(original, _prodBriefMediaPreviews(state));
      _prodDescRichNormalize(root);
      return { text: root.textContent, original: _prodDescRichSerialize(root), images: root.querySelectorAll('img').length };
    });
    assert.equal(expired.original, await page.evaluate(() => original)); assert.equal(expired.images, 0); assert(expired.text.includes('original preserved'));
    assert.equal(blocked, 0); assert(images > 0);
    console.log('PASS Chromium: copied image decodes inline; rich edit/normalize/roundtrip preserve canonical URL; expired preview stays reversible; provider attempts 0');
    await context.close();
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
