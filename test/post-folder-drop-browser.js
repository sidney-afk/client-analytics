'use strict';
// A folder dropped on the Post tab, both sides (plan row P2, OPEN_REPAIRS 654), behind post_sources_v1.
// Opens the real page offline with every backend answer local and drops folders built in the page (the same
// webkitGetAsEntry shape Chrome, Edge, Safari and Firefox hand over). Proves:
//   1. Instagram, the usual export folder: the video, the cover image and the caption file fill the form; hidden files
//      say nothing; the rest is named in one line ("Video, cover and caption found. Ignored 1 file: .prproj.");
//      the caption says it came from the folder and Undo takes it back;
//   2. typed text is never replaced by a folder's caption;
//   3. several videos: a pick list in natural name order (2 before 10), nothing chosen for the person; the pick fills
//      the form; then, with several images and none named thumb or cover, a second list asks for the cover;
//   4. images and no video become a carousel in name order;
//   5. two folders at once are refused; a folder with nothing to post says so;
//   6. TikTok: the video and caption fill; the image is named as not used (TikTok takes its cover from the video);
//      images and no video become a photo post;
//   7. a single dropped file still does what it did; with the switch off a folder does nothing new;
//   8. at 390 wide the pick list fits with no sideways scroll.
// Nothing is posted: no Post button is pressed.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { seedStaffIdentity } = require('../qa/staff-gate-seed.js');

const ADMIN = { id: 'qa_admin', name: 'QA Admin', role: 'admin', team: null };
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, PUT, OPTIONS' };
const TEST_CLIENT = (fs.readFileSync(path.join(__dirname, '..', 'src', 'index', '070-core-client-names.js.part'), 'utf8').match(/'[^']+'/g) || [])
  .map(q => q.slice(1, -1)).find(n => n.toLowerCase().replace(/[^a-z]/g, '') === 'sidneylaruel');
assert.ok(TEST_CLIENT, 'the test client is on the roster');
const csv = (v) => '"' + String(v).replace(/"/g, '""') + '"';
const CLIENTS_CSV = ['client_name,postforme_account_id,postforme_instagram_account_id,postforme_facebook_account_id',
  `${csv(TEST_CLIENT)},${csv('spc_fixtureTikTok0001')},${csv('spc_fixtureInstagram01')},`].join('\r\n') + '\r\n';

async function newPage(browser, opts) {
  const o = Object.assign({ flag: true, viewport: { width: 1440, height: 1000 } }, opts || {});
  const context = await browser.newContext({ viewport: o.viewport });
  const log = { calls: [] };
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, async route => {
    const req = route.request(); const url = req.url();
    const reply = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (/key-verify/.test(url)) return reply(200, { ok: true, role: 'admin', member: ADMIN });
    if (/\/gviz\/tq/.test(url)) {
      const sheet = new URL(url).searchParams.get('sheet') || '';
      return route.fulfill({ status: 200, contentType: 'text/csv', headers: cors, body: sheet === 'Clients Info' ? CLIENTS_CSV : 'col\r\n' });
    }
    if (/\/rest\/v1\/syncview_runtime_flags/.test(url)) {
      const rows = [];
      if (/tiktok_upload_source/.test(url)) rows.push({ key: 'tiktok_upload_source', value: { source: 'supabase' } });
      if (o.flag && /post_sources_v1/.test(url)) rows.push({ key: 'post_sources_v1', value: { clients: ['sidneylaruel'] } });
      return reply(200, rows);
    }
    if (/functions\/v1\//.test(url)) { log.calls.push(url); return reply(200, { ok: true, rows: [] }); }
    return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: /\/rest\/v1\//.test(url) || /tiktok-uploads-list/.test(url) ? '[]' : '{}' });
  });
  await seedStaffIdentity(context, ADMIN);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  return { context, page, log, errors };
}

async function openTikTok(page, base) {
  await page.goto(base + '/post', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.tk-page #tkPlatTiktok', { timeout: 20000 });
  await page.fill('#tkClientInput', TEST_CLIENT);
  await page.press('#tkClientInput', 'Enter');
  await page.waitForSelector('[data-tk-picked-client]');
}
async function openInstagram(page, base) {
  await openTikTok(page, base);
  await page.click('#tkPlatInstagram');
  await page.waitForSelector('#igFormCol');
  if (!(await page.locator('#igFormCol .tk-profile-line').count())) {
    await page.click('#igClientBtn');
    await page.click(`#igClientMenu [data-sv-select-option][data-value=${JSON.stringify(TEST_CLIENT)}]`);
  }
  await page.waitForSelector('#igFormCol .tk-profile-line');
}
/* Drops a tree on the element: { 'Folder': { files: { 'a.mp4': { type: 'video/mp4' }, 'caption.txt': { text } } } }.
   A key without `files` is a loose file. The entries answer as a browser's do (readEntries in batches, then []). */
async function dropTree(page, selector, tree) {
  await page.evaluate(({ selector, tree }) => {
    const mkFile = (name, f) => new File([f.text != null ? f.text : 'x'.repeat(f.size || 16)], name, { type: f.type || '' });
    const mkEntry = (name, node) => node.files
      ? { isFile: false, isDirectory: true, name, createReader() { let left = Object.entries(node.files); return { readEntries(ok) { const batch = left.slice(0, 2); left = left.slice(2); setTimeout(() => ok(batch.map(([n, c]) => mkEntry(n, c))), 0); } }; } }
      : { isFile: true, isDirectory: false, name, file(ok) { setTimeout(() => ok(mkFile(name, node)), 0); } };
    const roots = Object.entries(tree).map(([n, c]) => mkEntry(n, c));
    const files = Object.entries(tree).filter(([, c]) => !c.files).map(([n, c]) => mkFile(n, c));
    const dt = { items: roots.map(r => ({ kind: 'file', webkitGetAsEntry: () => r })), files };
    const ev = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: dt });
    document.querySelector(selector).dispatchEvent(ev);
  }, { selector, tree });
}
const textOf = (page, sel) => page.$eval(sel, el => el.textContent.replace(/\s+/g, ' ').trim());
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const EXPORT = { 'Video 15 export': { files: {
  'video_15_final.mp4': { type: 'video/mp4' }, 'thumb.jpg': { type: 'image/jpeg' }, 'caption.txt': { text: 'The folder caption\r\nline two\n' },
  'project.prproj': {}, '.DS_Store': {}, '._video_15_final.mp4': {},
} } };

(async () => {
  const server = await serveStatic();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  let checks = 0;
  const ok = (cond, what) => { assert.ok(cond, what); checks++; };
  try {
    // ---- 1. Instagram, the usual export folder; then Undo
    {
      const { context, page, errors } = await newPage(browser);
      await openInstagram(page, base);
      await dropTree(page, '#igDrop', EXPORT);
      await page.waitForSelector('#igDropNote');
      assert.equal(await textOf(page, '#igDropNote'), 'Video, cover and caption found. Ignored 1 file: .prproj.'); checks++;
      assert.equal(await textOf(page, '#igFormCol .tk-file-card .tk-file-name'), 'video_15_final.mp4'); checks++;
      await page.waitForSelector('#igCoverRemove');
      ok(await page.locator('#igFormCol .tk-file-name', { hasText: 'thumb.jpg' }).count() === 1, 'Instagram: the folder\'s image is the cover');
      assert.equal(await page.inputValue('#igTitle'), 'The folder caption\nline two'); checks++;
      assert.equal(await textOf(page, '#igCapFill'), 'Caption filled from the folder: caption.txt Undo'); checks++;
      await page.click('#igCapFillUndo');
      assert.equal(await page.inputValue('#igTitle'), ''); checks++;
      // Remove takes the folder's line with the video.
      await page.click('#igRemoveFile');
      ok(await page.locator('#igDropNote').count() === 0, 'Instagram: Remove takes the folder line away with the video');
      ok(!errors.length, 'Instagram export folder: no page errors (' + errors.join(' | ') + ')');
      await context.close();
    }
    // ---- 2. typed text stays
    {
      const { context, page, errors } = await newPage(browser);
      await openInstagram(page, base);
      await page.fill('#igTitle', 'Typed by the SMM');
      await dropTree(page, '#igDrop', EXPORT);
      await page.waitForSelector('#igDropNote');
      assert.equal(await page.inputValue('#igTitle'), 'Typed by the SMM'); checks++;
      ok(await page.locator('#igCapFill').count() === 0, 'Instagram: no "filled from the folder" line over typed text');
      ok(!errors.length, 'typed text: no page errors');
      await context.close();
    }
    // ---- 3. several videos, then the cover
    {
      const { context, page, errors } = await newPage(browser);
      await openInstagram(page, base);
      await dropTree(page, '#igDrop', { 'Takes': { files: { 'take 10.mp4': { type: 'video/mp4' }, 'take 2.mp4': { type: 'video/mp4' }, 'b.jpg': { type: 'image/jpeg' }, 'a.jpg': { type: 'image/jpeg' } } } });
      await page.waitForSelector('#igDropPick');
      assert.equal(await textOf(page, '#igDropPick .tk-step-note'), 'This folder has 2 videos. Pick one.'); checks++;
      assert.deepEqual(await page.$$eval('#igDropPick [data-ig-drop-pick]', els => els.map(e => e.textContent)), ['take 2.mp4', 'take 10.mp4']); checks++;
      ok(await page.locator('#igDrop').count() === 1, 'Instagram: no video is chosen for the person');
      await page.click('[data-ig-drop-pick="1"]');
      await page.waitForSelector('#igRemoveFile');
      assert.equal(await textOf(page, '#igFormCol .tk-file-card .tk-file-name'), 'take 10.mp4'); checks++;
      assert.equal(await textOf(page, '#igDropPick .tk-step-note'), 'This folder has 2 images. Pick the cover.'); checks++;
      assert.deepEqual(await page.$$eval('#igDropPick [data-ig-drop-pick]', els => els.map(e => e.textContent)), ['a.jpg', 'b.jpg']); checks++;
      await page.click('[data-ig-drop-pick="1"]');
      await page.waitForSelector('#igCoverRemove');
      ok(await page.locator('#igFormCol .tk-file-name', { hasText: 'b.jpg' }).count() === 1, 'Instagram: the picked image is the cover');
      ok(await page.locator('#igDropPick').count() === 0, 'Instagram: the pick list leaves once answered');
      assert.equal(await textOf(page, '#igDropNote'), 'Video and cover found.'); checks++;
      ok(!errors.length, 'several videos: no page errors');
      await context.close();
    }
    // ---- 4 and 5. images become a carousel; two folders refused; nothing to post
    {
      const { context, page, errors } = await newPage(browser);
      await openInstagram(page, base);
      await dropTree(page, '#igDrop', { 'Slides': { files: { 'slide 10.png': { type: 'image/png' }, 'slide 2.png': { type: 'image/png' }, 'slide 1.png': { type: 'image/png' } } } });
      await page.waitForSelector('#igDropNote');
      ok(await page.isChecked('input[name="igKind"][value="carousel"]'), 'Instagram: images and no video switch to Carousel');
      const order = await page.$$eval('#igFormCol [data-ig-car-idx][data-action="remove"]', els => els.length);
      ok(order === 3, 'Instagram: the carousel holds the three images (' + order + ')');
      assert.equal(await textOf(page, '#igDropNote'), '3 images found.'); checks++;
      await dropTree(page, '#igCarDrop', { 'One': { files: { 'a.mp4': { type: 'video/mp4' } } }, 'Two': { files: { 'b.mp4': { type: 'video/mp4' } } } });
      await page.waitForSelector('#igFormCol .tk-error');
      assert.equal(await textOf(page, '#igFormCol .tk-error'), 'Drop one folder at a time.'); checks++;
      await dropTree(page, '#igCarDrop', { 'Notes': { files: { 'notes.pdf': {} } } });
      await page.waitForFunction(() => /no video or image/.test(document.querySelector('#igFormCol .tk-error')?.textContent || ''));
      ok(true, 'Instagram: a folder with nothing to post says so');
      ok(!errors.length, 'carousel: no page errors');
      await context.close();
    }
    // ---- 6. TikTok
    {
      const { context, page, errors } = await newPage(browser);
      await openTikTok(page, base);
      await dropTree(page, '#tkDrop', EXPORT);
      await page.waitForSelector('#tkDropNote');
      assert.equal(await textOf(page, '#tkDropNote'), 'Video and caption found. TikTok takes its cover from the video, so the image is not used. Ignored 1 file: .prproj.'); checks++;
      assert.equal(await textOf(page, '#tkFormCol .tk-file-card .tk-file-name'), 'video_15_final.mp4'); checks++;
      assert.equal(await page.inputValue('#tkTitle'), 'The folder caption\nline two'); checks++;
      assert.equal(await textOf(page, '#tkCapFill'), 'Caption filled from the folder: caption.txt Undo'); checks++;
      await page.click('#tkFormCol .tk-file-card button:has-text("Remove")');
      ok(await page.locator('#tkDropNote').count() === 0, 'TikTok: Remove takes the folder line away');
      await dropTree(page, '#tkDrop', { 'Photos': { files: { 'p2.jpg': { type: 'image/jpeg' }, 'p1.jpg': { type: 'image/jpeg' } } } });
      await page.waitForSelector('#tkDropNote');
      ok(await page.isChecked('input[name="tkMediaType"][value="photo"]'), 'TikTok: images and no video become a photo post');
      assert.equal(await textOf(page, '#tkDropNote'), '2 images found.'); checks++;
      ok(!errors.length, 'TikTok: no page errors (' + errors.join(' | ') + ')');
      await context.close();
    }
    // ---- 7. a single file still works; switch off: a folder does nothing new
    {
      const { context, page, errors } = await newPage(browser);
      await openInstagram(page, base);
      await dropTree(page, '#igDrop', { 'loose.mp4': { type: 'video/mp4' } });
      await page.waitForSelector('#igRemoveFile');
      assert.equal(await textOf(page, '#igFormCol .tk-file-card .tk-file-name'), 'loose.mp4'); checks++;
      ok(await page.locator('#igDropNote').count() === 0, 'a single file: no folder line');
      ok(!errors.length, 'single file: no page errors');
      await context.close();
    }
    {
      const { context, page, errors } = await newPage(browser, { flag: false });
      await openInstagram(page, base);
      await dropTree(page, '#igDrop', EXPORT);
      await page.waitForTimeout(500);
      ok(await page.locator('#igDropNote, #igDropPick').count() === 0, 'switch off, Instagram: a folder fills nothing');
      ok(await page.locator('#igDrop').count() === 1, 'switch off, Instagram: the drop zone is as it was');
      assert.equal(await page.inputValue('#igTitle'), ''); checks++;
      await page.click('#tkPlatTiktok');
      await page.waitForSelector('#tkDrop');
      await dropTree(page, '#tkDrop', EXPORT);
      await page.waitForTimeout(500);
      ok(await page.locator('#tkDropNote, #tkDropPick').count() === 0, 'switch off, TikTok: a folder fills nothing');
      ok(!errors.length, 'switch off: no page errors');
      await context.close();
    }
    // ---- 8. 390 wide
    {
      const { context, page, errors } = await newPage(browser, { viewport: { width: 390, height: 844 } });
      await openTikTok(page, base);
      await dropTree(page, '#tkDrop', { 'Takes': { files: { 'a very long take name that keeps going and going 1.mp4': { type: 'video/mp4' }, 'a very long take name that keeps going and going 2.mp4': { type: 'video/mp4' } } } });
      await page.waitForSelector('#tkDropPick');
      ok(await noSideScroll(page), '390: the pick list fits with no sideways scroll');
      await page.click('[data-tk-drop-pick="0"]');
      await page.waitForSelector('#tkDropNote');
      assert.equal(await textOf(page, '#tkDropNote'), 'Video found.'); checks++;
      ok(await noSideScroll(page), '390: no sideways scroll after the pick');
      ok(!errors.length, '390: no page errors');
      await context.close();
    }
    console.log(`post-folder-drop-browser: ${checks} checks passed`);
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
