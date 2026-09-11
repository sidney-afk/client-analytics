'use strict';
/*
 * TikTok Upload — Photo carousel BROWSER journey (Codex round-2 Finding A,
 * PR #1355). test/tiktok-carousel-transport.js proves the transport's
 * *source* is shaped correctly (target snapshotting, n8n Code node logic)
 * with static regex/extraction checks — it never runs a browser and never
 * executes _tkSubmitPhotoCarousel. That leaves a real risk unguarded: a
 * runtime break in the three-stage save (mint -> PUT -> final POST) — wrong
 * fetch order, a dropped signal, a response shape the UI doesn't expect —
 * could pass every static check while being broken end to end.
 *
 * This suite drives the actual page in a real headless browser, with the
 * network fully mocked (page.route()), the same pattern prod-write-gateway-
 * browser.js uses for the Calendar/Production surfaces. It proves, against
 * the running _tkSubmitPhotoCarousel/_tkFinishPhotoSubmit code:
 *   1. Happy path — three images mint and PUT in strict order, each with the
 *      correct per-image Content-Type (including the empty-File.type
 *      extension-fallback case), and the final tiktok-upload-direct POST
 *      carries all three media_urls (in order) in the `mediaUrls` field —
 *      never the legacy singular `mediaUrl`, and the legacy in-band
 *      tiktok-upload webhook is never touched.
 *   2. Cancel mid-upload (after image 1 lands, mid-flight on image 2) aborts
 *      cleanly: no further image is minted, and the final POST never fires.
 *   3. A storage PUT failure on one image surfaces a specific error and
 *      likewise never reaches the final POST — no partial/corrupt submit.
 *   4. A 200 response carrying ok:false (n8n's Wrap Response node sets this
 *      when Post For Me rejects the post, without a non-2xx status — Respond
 *      JSON never sets one) surfaces the real error and preserves the draft,
 *      instead of clearing it and reporting "Upload queued".
 *   5. Reordering or removing a photo re-renders the whole form, which used
 *      to drop keyboard focus to <body>; focus now follows the moved image
 *      or lands on a neighbor, so a keyboard user isn't forced to re-tab
 *      through the form after every step. Includes the two boundary cases
 *      (moved to the first or last slot, where that direction's own button
 *      is disabled) that the first version of this fix missed.
 *
 * Run standalone:  node docs/syncview-design/tests/tiktok-carousel-browser-journey.js
 * Wired into CI via .github/workflows/tiktok-carousel-browser-journey.yml
 * (path-filtered, not an npm script — package.json is fingerprinted by
 * test/leave-evidence-fingerprint-coupling.js for an unrelated feature).
 * Fully offline/hermetic — every external host is stubbed, including a
 * catch-all for anything this file doesn't explicitly expect, so a stray
 * fetch fails loudly here rather than reaching the real internet.
 *
 * Deliberately NOT wired into package.json's "scripts" despite the sibling
 * probes in this directory each having one: test/leave-evidence-fingerprint-
 * coupling.js hashes the whole of package.json (not just PTO-related lines,
 * unlike its index.html handling) into the published PTO lifecycle evidence
 * packet's fingerprint, so any edit to package.json — however unrelated —
 * goes stale for that packet and forces an expensive human re-review of 101
 * screenshots. Confirmed by adding a "test:tiktok-carousel-journey" entry
 * here and watching that exact suite fail, then reverting it and watching
 * it pass again.
 */
const fs = require('fs');
const { seedStaffGate } = require('../../../qa/staff-gate-seed.js');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..', '..', '..');
const INDEX = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

// Pull the exact client roster the page itself renders in #tkClient, so the
// mocked Clients Info sheet grants postforme_account_id to a name that is
// guaranteed to appear in the dropdown -- no guessing at casing/spelling.
const namesBlock = /const WL_CLIENT_NAMES\s*=\s*\[([\s\S]*?)\];/.exec(INDEX);
if (!namesBlock) throw new Error('WL_CLIENT_NAMES not found in index.html -- roster extraction is stale');
const CLIENT_NAMES = [...namesBlock[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map(m => m[1]);
if (!CLIENT_NAMES.length) throw new Error('WL_CLIENT_NAMES parsed empty -- extraction regex is stale');

const TEST_ACCOUNT_ID = 'spc_test_carousel_journey';

function csvField(v) { return '"' + String(v).replace(/"/g, '""') + '"'; }
function clientsInfoCSV() {
  const lines = ['client_name,postforme_account_id'];
  for (const name of CLIENT_NAMES) lines.push(`${csvField(name)},${csvField(TEST_ACCOUNT_ID)}`);
  return lines.join('\r\n') + '\r\n';
}
const EMPTY_SHEET_CSV = 'col\r\n'; // header-only -> parseCSV() returns [] (rows.length < 2)

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let file = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    file = path.normalize(file).replace(/^([.][\\/])+/, '');
    const full = path.join(root, file);
    if (!full.startsWith(root) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(full).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
// photo-two.png ships an empty mimeType on purpose -- some browsers/OSes
// leave File.type blank, and _tkImageMimeFor's extension fallback is what's
// supposed to catch that (see index.html's own comment on that function).
const TEST_IMAGES = [
  { name: 'photo-one.jpg', mimeType: 'image/jpeg', buffer: PNG_1PX },
  { name: 'photo-two.png', mimeType: '', buffer: PNG_1PX },
  { name: 'photo-three.webp', mimeType: 'image/webp', buffer: PNG_1PX },
];

function multipartField(body, name) {
  const re = new RegExp('name="' + name + '"\\r\\n\\r\\n([\\s\\S]*?)\\r\\n--');
  const m = re.exec(body || '');
  return m ? m[1] : null;
}

let failures = 0;
function check(label, got, want) {
  const gotStr = JSON.stringify(got), wantStr = JSON.stringify(want);
  const passed = gotStr === wantStr;
  if (!passed) failures++;
  console.log(`${passed ? '✓' : '✗ FAIL'}  ${label}` + (passed ? '' : `  (got ${gotStr}, want ${wantStr})`));
}
function ok(label, cond) {
  if (!cond) failures++;
  console.log(`${cond ? '✓' : '✗ FAIL'}  ${label}`);
}

/*
 * Registers every network mock this app's boot sequence and the carousel
 * transport touch, against one page, and returns the call logs the
 * scenarios assert on. `mintDelayMs` slows down every mint response (used
 * to land a cancel click mid-loop deterministically); `putFailAtIndex`
 * makes one image's storage PUT fail (1-based); `directResponse` overrides
 * the final tiktok-upload-direct response body (a logical-failure test needs
 * HTTP 200 with `ok:false` in the body, not a transport-level failure).
 */
async function mockNetwork(page, { mintDelayMs = 0, putFailAtIndex = null, directResponse = null } = {}) {
  const calls = { mint: [], put: [], direct: [], legacy: [], list: 0 };

  // Lowest priority: nothing this app talks to should reach the real
  // internet. Registered first -- Playwright matches the most-recently
  // -added route first, so every specific mock below wins over this one.
  await page.route('https://**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

  await page.route('**/gviz/tq**', route => {
    const url = new URL(route.request().url());
    const sheet = url.searchParams.get('sheet') || '';
    route.fulfill({ status: 200, contentType: 'text/csv', body: sheet === 'Clients Info' ? clientsInfoCSV() : EMPTY_SHEET_CSV });
  });

  await page.route('**/webhook/tiktok-uploads-list**', route => {
    calls.list++;
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows: [] }) });
  });
  await page.route('**/webhook/tiktok-upload-status**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }));
  await page.route('**/webhook/tiktok-upload-cancel**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }));
  // The legacy in-band ≤100MB video webhook. No scenario here should ever
  // reach it -- photo carousels always take the direct-to-storage lane.
  await page.route('**/webhook/tiktok-upload', route => {
    calls.legacy.push(route.request().url());
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.route('**/webhook/tiktok-upload-url**', async route => {
    const n = calls.mint.length + 1;
    calls.mint.push(n);
    if (mintDelayMs) await new Promise(r => setTimeout(r, mintDelayMs));
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, upload_url: `https://storage.postforme.test/upload-${n}`, media_url: `https://media.postforme.test/img-${n}.jpg` }),
    });
  });

  await page.route('**/storage.postforme.test/**', async route => {
    const n = Number(/upload-(\d+)/.exec(route.request().url())?.[1] || 0);
    const headers = await route.request().allHeaders();
    const bodyLen = (route.request().postDataBuffer() || Buffer.alloc(0)).length;
    calls.put.push({ n, contentType: headers['content-type'] || '', bodyLen });
    if (putFailAtIndex && n === putFailAtIndex) {
      await route.fulfill({ status: 500, contentType: 'text/plain', body: 'mock storage failure' });
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
  });

  await page.route('**/webhook/tiktok-upload-direct', async route => {
    const headers = await route.request().allHeaders();
    calls.direct.push({ body: route.request().postData() || '', contentType: headers['content-type'] || '' });
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(directResponse || { ok: true, id: 'row-journey-1', status: 'scheduled' }),
    });
  });

  return calls;
}

async function bootToTiktokUpload(browser, port, mockOpts) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.stack || e.message));
  await seedStaffGate(page);
  const calls = await mockNetwork(page, mockOpts);
  await page.goto(`http://127.0.0.1:${port}/#tiktok-upload`, { waitUntil: 'domcontentloaded' });
  // state: 'attached', not the default 'visible' -- <option> elements in a
  // closed native <select> never report as visible to Playwright.
  await page.waitForSelector('#tkClient option', { state: 'attached' });
  // Skip the "Select a client…" placeholder option (empty value) that leads the list.
  const clientName = await page.$$eval('#tkClient option', opts => opts.map(o => o.value).find(v => v));
  await page.selectOption('#tkClient', clientName);
  await page.locator('input[name=tkMediaType][value=photo]').check({ force: true });
  await page.waitForSelector('#tkPhotoFile');
  return { page, calls, pageErrors, clientName };
}

async function attachThreeImagesAndCaption(page, caption) {
  await page.setInputFiles('#tkPhotoFile', TEST_IMAGES);
  await page.waitForFunction(() => document.querySelectorAll('.tk-photo-item').length === 3);
  await page.fill('#tkTitle', caption);
  await page.waitForFunction(() => !document.getElementById('tkSubmit').disabled);
}

(async () => {
  const server = await serve();
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  try {
    /* ---------------------------------------------------------------- *
     * 1. Happy path: a 3-image carousel mints, PUTs and posts in order *
     * ---------------------------------------------------------------- */
    {
      const { page, calls, pageErrors, clientName } = await bootToTiktokUpload(browser, port, {});
      ok('client dropdown offers a real WL_CLIENT_NAMES entry', CLIENT_NAMES.includes(clientName));
      await attachThreeImagesAndCaption(page, 'Hermetic journey test caption');

      const [directResp] = await Promise.all([
        page.waitForResponse(r => r.url().endsWith('/webhook/tiktok-upload-direct')),
        page.click('#tkSubmit'),
      ]);
      ok('the final POST resolved 200', directResp.status() === 200);
      await page.waitForFunction(() => document.getElementById('tkTitle').value === '');

      check('all 3 images were minted, strictly in order', calls.mint, [1, 2, 3]);
      check('all 3 images were PUT to storage, strictly in order', calls.put.map(p => p.n), [1, 2, 3]);
      ok('each PUT carried the real image body, not an empty request', calls.put.every(p => p.bodyLen === PNG_1PX.length));
      check('PUT #1 (.jpg, explicit type) kept image/jpeg', calls.put[0].contentType, 'image/jpeg');
      check('PUT #2 (empty File.type, .png name) resolved via the extension fallback', calls.put[1].contentType, 'image/png');
      check('PUT #3 (.webp, explicit type) kept image/webp', calls.put[2].contentType, 'image/webp');
      ok('exactly one tiktok-upload-direct call was made', calls.direct.length === 1);
      ok('the final POST used multipart/form-data', /multipart\/form-data/.test(calls.direct[0].contentType));
      const mediaUrls = JSON.parse(multipartField(calls.direct[0].body, 'mediaUrls') || 'null');
      check('the final POST carried all 3 media_urls, in mint order', mediaUrls, [
        'https://media.postforme.test/img-1.jpg', 'https://media.postforme.test/img-2.jpg', 'https://media.postforme.test/img-3.jpg',
      ]);
      check('the final POST used mediaUrls (plural), never the legacy singular mediaUrl field',
        multipartField(calls.direct[0].body, 'mediaUrl'), null);
      check('the final POST carried the resolved Post For Me account id',
        multipartField(calls.direct[0].body, 'socialAccountId'), TEST_ACCOUNT_ID);
      ok('the legacy in-band tiktok-upload webhook was never touched by a carousel submit', calls.legacy.length === 0);
      ok('no page errors during the happy path', pageErrors.length === 0);
      await page.close();
    }

    /* ---------------------------------------------------------------- *
     * 2. Cancel mid-upload leaves no partial submission                *
     * ---------------------------------------------------------------- */
    {
      const { page, calls, pageErrors } = await bootToTiktokUpload(browser, port, { mintDelayMs: 250 });
      await attachThreeImagesAndCaption(page, 'Cancel journey test caption');

      await Promise.all([
        page.waitForResponse(r => /storage\.postforme\.test\/upload-1$/.test(r.url())),
        page.click('#tkSubmit'),
      ]);
      // Image 1 has landed; image 2's mint is in flight behind its 250ms
      // delay. Cancelling now proves the abort works mid-loop, not just
      // before the first image or only after the whole loop finishes.
      await Promise.all([
        page.waitForSelector('.tk-error'),
        page.click('.tk-submit-bar button.tk-mini-btn'),
      ]);
      const errorText = await page.$eval('.tk-error', el => el.textContent);
      check('the form reports the cancellation', errorText, 'Upload cancelled.');
      ok('image 3 was never minted', !calls.mint.includes(3));
      ok('the aborted loop never reached the final POST', calls.direct.length === 0);
      ok('Submit is enabled again after cancelling so the user can retry', await page.$eval('#tkSubmit', el => !el.disabled));
      ok('no page errors during cancellation', pageErrors.length === 0);
      await page.close();
    }

    /* ---------------------------------------------------------------- *
     * 3. A storage PUT failure surfaces an error, not a partial submit *
     * ---------------------------------------------------------------- */
    {
      const { page, calls, pageErrors } = await bootToTiktokUpload(browser, port, { putFailAtIndex: 2 });
      await attachThreeImagesAndCaption(page, 'PUT failure journey test caption');

      await Promise.all([
        page.waitForSelector('.tk-error'),
        page.click('#tkSubmit'),
      ]);
      const errorText = await page.$eval('.tk-error', el => el.textContent);
      check('the error names the failed image and the HTTP status', errorText, 'Image 2 upload to storage failed (HTTP 500).');
      check('image 3 was never minted once image 2 failed', calls.mint, [1, 2]);
      ok('the failed loop never reached the final POST', calls.direct.length === 0);
      ok('Submit is enabled again so the user can retry', await page.$eval('#tkSubmit', el => !el.disabled));
      ok('no page errors during the storage failure', pageErrors.length === 0);
      await page.close();
    }

    /* ---------------------------------------------------------------- *
     * 4. A 200 response carrying ok:false is a failure, not a success  *
     * ---------------------------------------------------------------- */
    {
      const { page, calls, pageErrors } = await bootToTiktokUpload(browser, port, {
        directResponse: { ok: false, status: 'failed', error: 'TikTok rejected this post' },
      });
      await attachThreeImagesAndCaption(page, 'Logical failure journey test caption');

      await Promise.all([
        page.waitForSelector('.tk-error'),
        page.click('#tkSubmit'),
      ]);
      const errorText = await page.$eval('.tk-error', el => el.textContent);
      check('the form surfaces the backend-reported error, not "Upload queued"', errorText, 'Upload failed: TikTok rejected this post');
      ok('exactly one tiktok-upload-direct call was made (no retry loop)', calls.direct.length === 1);
      ok('the draft is preserved -- images are not cleared on a logical failure', await page.$$eval('.tk-photo-item', els => els.length === 3));
      ok('the caption is preserved -- not cleared on a logical failure', await page.$eval('#tkTitle', el => el.value.length > 0));
      ok('Submit is enabled again so the user can retry', await page.$eval('#tkSubmit', el => !el.disabled));
      ok('no page errors on a logical failure', pageErrors.length === 0);
      await page.close();
    }

    /* ---------------------------------------------------------------- *
     * 5. Reorder/remove keep keyboard focus usable, not dropped to body *
     * ---------------------------------------------------------------- */
    {
      const { page, pageErrors } = await bootToTiktokUpload(browser, port, {});
      await page.setInputFiles('#tkPhotoFile', TEST_IMAGES);
      await page.waitForFunction(() => document.querySelectorAll('.tk-photo-item').length === 3);
      const focused = () => page.evaluate(() => {
        const el = document.activeElement;
        return el ? { idx: el.getAttribute('data-photo-idx'), action: el.getAttribute('data-action'), id: el.id || null } : null;
      });

      // Move image 0 later (-> index 1). Re-rendering the whole form must not
      // drop focus to <body>; it should land on the SAME image's "move later"
      // button at its new slot, so repeated presses keep moving it.
      await page.click('.tk-photo-btn[data-photo-idx="0"][data-action="move-later"]');
      check('after moving an image later, focus follows it to its new index', await focused(), { idx: '1', action: 'move-later', id: null });

      // Round 4 boundary case: moving the image now at index 1 EARLIER lands
      // it at index 0, where "move earlier" is disabled -- there's nowhere
      // further to go. Focus must fall back to "move later" at index 0
      // instead of dropping to <body>.
      await page.click('.tk-photo-btn[data-photo-idx="1"][data-action="move-earlier"]');
      check('moving an image to the FIRST slot falls back to "move later" (its own direction is disabled)',
        await focused(), { idx: '0', action: 'move-later', id: null });

      // Round 4 boundary case: with 3 images, index 1 is penultimate --
      // moving it LATER lands it at the last index, where "move later" is
      // disabled. Focus must fall back to "move earlier" at that index.
      await page.click('.tk-photo-btn[data-photo-idx="1"][data-action="move-later"]');
      check('moving an image to the LAST slot falls back to "move earlier" (its own direction is disabled)',
        await focused(), { idx: '2', action: 'move-earlier', id: null });

      // Remove the image now at index 0. Focus should land on a neighboring
      // image's remove button (the one that slid into slot 0), not <body>.
      await page.click('.tk-photo-btn[data-photo-idx="0"][data-action="remove"]');
      check('after removing an image, focus lands on the neighboring remove button', await focused(), { idx: '0', action: 'remove', id: null });
      ok('exactly 2 images remain after one removal', await page.$$eval('.tk-photo-item', els => els.length === 2));

      // Remove down to the last image, then remove it too -- once the grid is
      // empty there is no neighboring button to land on.
      await page.click('.tk-photo-btn[data-photo-idx="1"][data-action="remove"]');
      await page.click('.tk-photo-btn[data-photo-idx="0"][data-action="remove"]');
      ok('the grid is empty after removing every image', await page.$$eval('.tk-photo-item', els => els.length === 0));
      check('with no photos left, focus falls back to the file input rather than <body>', await focused(), { idx: null, action: null, id: 'tkPhotoFile' });
      ok('no page errors during reorder/remove focus handling', pageErrors.length === 0);
      await page.close();
    }
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }

  if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
  console.log('\nAll tiktok-carousel-browser-journey checks passed.');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
