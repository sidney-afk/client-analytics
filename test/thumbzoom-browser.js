'use strict';
/*
 * THUMBNAIL ZOOM on the three review boards (src/index/192-thumb-zoom.js.part), in a real browser, fully offline.
 * Session Thumbzoom, 2026-11-06 (Sidney: clicking a thumbnail on Kasper's Review Session, the client's review board and
 * the SMM's Review tab opens it full screen). The review page of the shared fixture (test/fixtures/review-stage-fixture.js).
 *
 * For each board (client link, SMM Review tab, Kasper Review Session), on Chromium and, where it is installed, WebKit
 * (Kasper's Mac Safari), and the client board again on an emulated phone:
 *   - the thumbnail picture is the zoom target (cursor zoom-in, a button for the keyboard);
 *   - a click opens a dark viewer with the picture at screen size; nothing was approved or asked by the click;
 *   - Esc, a click on the backdrop and the X each close it, and focus goes back to the picture;
 *   - Enter on the focused picture opens it too;
 *   - the viewer sits above the page, the X is 44px and inside the screen (phone included);
 *   - the stage's own buttons (Approve) still answer; a carousel's first image opens with "Open in Drive".
 * THUMBZOOM_SHOTS=<dir> also writes screenshots (fictional data only). Dates are the fixture's own, none hard-coded here.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit, devices } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { CLIENT, SLUG, TOKEN, STAFF, open, openClient, inS, waitNew, answerConfirm, sleep } = require('./fixtures/review-stage-fixture.js');

let passed = 0;
const failures = [];
function ok(c, m) { if (!c) { failures.push(m); console.error('FAIL  ' + m); } else { passed++; console.log('  ok  ' + m); } }
const SHOTS = process.env.THUMBZOOM_SHOTS || '';
const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png') }); } };
const DRIVE_FOLDER = 'https://drive.google.com/drive/folders/SYNTHETICCAROUSELFOLDER01';
const FILE_ID = 'SYNTHFILEAAAAAAAAAAAA1';
const PNG1 = fs.readFileSync(path.join(__dirname, 'fixtures', 'frameio-viewer-poster-vertical.png'));

const zoomState = page => page.evaluate(() => {
  const o = document.getElementById('svThumbZoom');
  if (!o) return { open: false };
  const cs = getComputedStyle(o), img = o.querySelector('.sv-tz-img'), x = o.querySelector('.sv-tz-x').getBoundingClientRect(), r = img.getBoundingClientRect();
  const link = o.querySelector('.sv-tz-open');
  return { open: o.classList.contains('open') && cs.display !== 'none', src: img.getAttribute('src') || '', bg: cs.backgroundColor, z: cs.zIndex,
    imgW: Math.round(r.width), imgH: Math.round(r.height), vw: innerWidth, vh: innerHeight, xW: Math.round(x.width), xH: Math.round(x.height),
    xIn: x.top >= 0 && x.right <= innerWidth && x.left >= 0 && x.bottom <= innerHeight, linkShown: !link.hidden, linkHref: link.getAttribute('href') || '',
    top: document.elementFromPoint(innerWidth / 2, 4) && !!document.elementFromPoint(innerWidth / 2, 4).closest('#svThumbZoom') };
});
async function goStaff(t, origin, mode) {
  if (mode === 'smm') {
    await t.page.goto(origin + '/index.html?v=calendar', { waitUntil: 'domcontentloaded' });
    await t.page.waitForFunction(() => typeof _calSavePins === 'function' && typeof navTo === 'function', null, { timeout: 30000 });
    await t.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} _calSavePins([name]); calState.client = name; navTo('calendar'); }, CLIENT);
    await t.page.waitForFunction(() => typeof calState === 'object' && !calState.loading && (calState.posts || []).length > 0, null, { timeout: 30000 });
    await t.page.evaluate(() => onCalViewChange('smmreview'));
  } else {
    await t.page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
    await t.page.waitForFunction(() => typeof navTo === 'function', null, { timeout: 30000 });
    await t.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} try { wlMergeClientsFromSheet([name]); } catch (e) {} navTo('kasper'); }, CLIENT);
  }
}
const reachThumb = async (t) => {
  await inS(t.page, '.stp[data-step="graphic"]').click();
  await t.page.waitForFunction(() => { const i = document.getElementById('svReviewStage').shadowRoot.getElementById('bigthumbImg'); return i && !i.hidden && i.complete && i.naturalWidth > 0; });
  await sleep(450);
};
const approveStatus = t => t.state.cards.map(c => c.graphic_status + '|' + c.video_status).join(',');

async function board(browser, origin, label, mode, extra) {
  console.log('\n== ' + label + ' ==');
  let t;
  if (mode === 'client') t = await openClient(browser, origin, Object.assign({ flags: 'on', linkedParts: true }, extra));
  else {
    t = await open(browser, origin, Object.assign({ stage: mode, flags: 'on', staff: STAFF, linkedParts: true }, extra));
    await goStaff(t, origin, mode);
  }
  await waitNew(t);
  await reachThumb(t);
  const before = approveStatus(t);
  const img = inS(t.page, '#bigthumbImg');
  const look = await img.evaluate(i => ({ cur: getComputedStyle(i).cursor, role: i.getAttribute('role'), tab: i.getAttribute('tabindex'), aria: i.getAttribute('aria-label') }));
  ok(look.cur === 'zoom-in', label + ': the thumbnail picture has the zoom-in cursor (' + look.cur + ')');
  ok(look.role === 'button' && look.tab === '0' && /full screen/i.test(look.aria || ''), label + ': the picture is a keyboard button named "View thumbnail full screen"');
  ok(!(await zoomState(t.page)).open, label + ': the viewer is closed to begin with');

  await img.click();
  await t.page.waitForFunction(() => { const i = document.querySelector('#svThumbZoom .sv-tz-img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 15000 });
  let z = await zoomState(t.page);
  ok(z.open && /poster-[lp]\.png/.test(z.src), label + ': a click opens the viewer with the picture (' + z.src.slice(-14) + ')');
  ok(/rgba\(0, 0, 0, 0\.(8[5-9]|9)/.test(z.bg), label + ': dark backdrop (' + z.bg + ')');
  ok(z.top && Number(z.z) > 9000, label + ': the viewer sits above the page (z ' + z.z + ')');
  ok(z.imgW <= z.vw && z.imgH <= z.vh && (z.imgW === z.vw || z.imgH === z.vh || z.imgW > 100), label + ': the picture fits the screen (' + z.imgW + 'x' + z.imgH + ' in ' + z.vw + 'x' + z.vh + ')');
  ok(z.xW >= 44 && z.xH >= 44 && z.xIn, label + ': the X is ' + z.xW + 'px and inside the screen');
  ok(!z.linkShown, label + ': an ordinary thumbnail has no "Open in Drive"');
  ok(approveStatus(t) === before && t.state.upserts.length === 0, label + ': the click saved nothing');
  await shot(t.page, label.replace(/\W+/g, '-').toLowerCase() + '-open');

  // Tab never leaves the viewer (it holds only the X here).
  for (let i = 0; i < 3; i++) await t.page.keyboard.press(i === 2 ? 'Shift+Tab' : 'Tab');
  ok(await t.page.evaluate(() => !!document.activeElement && !!document.activeElement.closest('#svThumbZoom')), label + ': Tab and Shift+Tab keep focus inside the viewer');
  await t.page.keyboard.press('Escape');
  ok(!(await zoomState(t.page)).open, label + ': Esc closes it');
  ok(await t.page.evaluate(() => { const h = document.getElementById('svReviewStage').shadowRoot; return h.activeElement && h.activeElement.id === 'bigthumbImg'; }), label + ': focus goes back to the picture');

  await img.click();
  await t.page.mouse.click(8, Math.round((await zoomState(t.page)).vh / 2));
  ok(!(await zoomState(t.page)).open, label + ': a click outside the picture closes it');

  await img.click();
  await t.page.locator('#svThumbZoom .sv-tz-x').click();
  ok(!(await zoomState(t.page)).open, label + ': the X closes it');

  await img.focus();
  await t.page.keyboard.press('Enter');
  ok((await zoomState(t.page)).open, label + ': Enter on the focused picture opens it');
  await t.page.keyboard.press('Escape');
  ok(!(await zoomState(t.page)).open, label + ': ... and Esc closes it');

  // The stage's own buttons still answer with the viewer closed.
  const n0 = t.state.upserts.length + t.state.gateway.length;
  await inS(t.page, '[data-ok="graphic"]').click();
  for (let i = 0; i < 60 && t.state.upserts.length + t.state.gateway.length === n0; i++) { await answerConfirm(t.page); await sleep(100); }
  ok(t.state.upserts.length + t.state.gateway.length > n0, label + ': Approve on the thumbnail still saves after the viewer was used');
  ok(t.errors.length === 0, label + ': no page errors' + (t.errors.length ? ' (' + t.errors.slice(0, 2).join(' | ') + ')' : ''));
  await t.ctx.close();
}

async function carousel(browser, origin, label) {
  console.log('\n== ' + label + ' ==');
  const t = await open(browser, origin, { stage: 'client', flags: 'on', linkedParts: true, flagValues: { carousel_preview_v1: { clients: [SLUG] } } });
  t.state.cards[0].thumbnail_url = DRIVE_FOLDER;
  await t.page.route('**/functions/v1/thumbnail-folder-resolve*', r => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, contentType: 'application/json', body: JSON.stringify({ ok: true, state: 'ok', first_file_id: FILE_ID, count: 5, has_video: false }) }));
  await t.page.route('https://drive.google.com/thumbnail**', r => r.fulfill({ status: 200, contentType: 'image/png', body: PNG1, headers: { 'access-control-allow-origin': '*' } }));
  await t.page.goto(origin + '/index.html?' + new URLSearchParams({ c: CLIENT, v: 'calendar', t: TOKEN }), { waitUntil: 'domcontentloaded' });
  await waitNew(t);
  await inS(t.page, '.stp[data-step="graphic"]').click();
  await t.page.waitForFunction(() => { const i = document.getElementById('svReviewStage').shadowRoot.getElementById('bigthumbImg'); return i && !i.hidden && /drive\.google\.com\/thumbnail/.test(i.getAttribute('src') || ''); }, null, { timeout: 15000 });
  await inS(t.page, '#bigthumbImg').click();
  const z = await zoomState(t.page);
  ok(z.open && /drive\.google\.com\/thumbnail\?/.test(z.src) && /sz=w2400/.test(z.src), label + ': the first image opens at screen size (' + z.src.replace(/id=[^&]+/, 'id=..') + ')');
  ok(z.linkShown && z.linkHref === DRIVE_FOLDER, label + ': "Open in Drive" points at the folder');
  await shot(t.page, 'carousel-open');
  await t.page.keyboard.press('Escape');
  ok(!(await zoomState(t.page)).open, label + ': Esc closes it');
  ok(t.errors.length === 0, label + ': no page errors');
  await t.ctx.close();
}

async function cardList(browser, origin) {
  console.log('\n== SMM Review tab, older card list ==');
  const t = await open(browser, origin, { stage: 'smm', flags: 'off', staff: STAFF });
  await goStaff(t, origin, 'smm');
  await t.page.waitForFunction(() => document.querySelector('.cal-review-card .kcard-thumb[data-tz] img'), null, { timeout: 20000 }).catch(() => {});
  const th = t.page.locator('.cal-review-card .kcard-thumb[data-tz] img').first();
  if (!(await th.count())) { ok(true, 'older list: not drawn under this fixture (skipped)'); await t.ctx.close(); return; }
  await th.click();
  const z = await zoomState(t.page);
  ok(z.open, 'older list: a click on the strip picture opens the viewer');
  ok(await t.page.locator('.cal-review-card.expanded').count() === 0, 'older list: it did not also expand the card');
  await t.page.keyboard.press('Escape');
  ok(!(await zoomState(t.page)).open, 'older list: Esc closes it');
  await t.ctx.close();
}

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const engines = [['Chromium', chromium, {}]];
  let wk = null;
  try { wk = await webkit.launch(); await wk.close(); engines.push(['WebKit', webkit, {}]); } catch (e) { console.log('  (WebKit is not installed here; CI runs it)'); }
  for (const [name, type] of engines) {
    const browser = await type.launch();
    try {
      await board(browser, origin, name + ' client link', 'client');
      await board(browser, origin, name + ' SMM Review tab', 'smm');
      await board(browser, origin, name + " Kasper's Review Session", 'kasper');
      if (name === 'Chromium') { await carousel(browser, origin, 'Chromium carousel'); await cardList(browser, origin); }
      else await carousel(browser, origin, name + ' carousel');
      await board(browser, origin, name + ' phone client link', 'client', { width: 390, height: 780, context: { ...devices['iPhone 13'] } });
    } finally { await browser.close(); }
  }
  server.close();
  console.log('\n' + passed + ' passed, ' + failures.length + ' failed');
  if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
