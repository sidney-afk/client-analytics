'use strict';
/*
 * The thumbnail's folder opens from the card's Files menu, not from its own icon on the Thumbnail row (owner,
 * 2026-11-01: "can we move the 'open this folder' link, the button for the thumbnail to open the folder of the
 * thumbnail, into the files button, next to the thumbnail file").
 *
 * Before: the staff card's Thumbnail row read [Thumbnail] [folder icon] [pencil]; the folder icon opened the
 * thumbnail's Drive folder. The card's Files button (the folder button on the thumbnail) listed Filming plan, Raw
 * footage folder, Frame folder and Thumbnail file.
 * After: the Thumbnail row reads [Thumbnail] [pencil]; the Files menu lists "Thumbnail folder" right after
 * "Thumbnail file", the same link, in a new tab, reachable from the keyboard; "not linked yet" when the folder is not
 * known. Desktop Sheet and the staff phone card (the Month and Week dialog never had the icon).
 *
 * Fully offline, fictional client and cards. THUMB_FOLDER_SHOT_DIR saves screenshots.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { seedStaffGate } = require('../qa/staff-gate-seed.js');

const SLUG = 'fixtureclient';
const NAME = 'Test Client';
const FOLDER = 'https://drive.google.com/drive/folders/fixture_thumb_folder';
const SHOTS = process.env.THUMB_FOLDER_SHOT_DIR || '';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
const failures = [];
let checks = 0;
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else { checks++; } }

const THUMB_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><rect width="1080" height="1920" fill="#c7b8ea"/></svg>';
const card = (i, folder) => ({
  id: 'c' + i, client: SLUG, name: 'Test card ' + i, status: 'In Progress', order_index: i, updated_at: '2026-10-08T12:00:00.000Z',
  scheduled_date: '', video_status: 'In Progress', graphic_status: 'In Progress', caption_status: 'In Progress', caption: 'Short test caption.', cta: '',
  thumbnail_url: 'https://example.invalid/thumb-' + i + '.png', asset_url: 'https://example.invalid/video-' + i + '.mp4',
  thumbnail_folder_url: folder ? FOLDER : '', thumbnail_folder_id: folder ? 'fixture_thumb_folder' : '', thumbnail_file_id: 'fixture_file_' + i,
  thumbnail_folder_resolved_at: '2026-10-08T12:00:00.000Z', comments: [], graphic_comments: [], caption_comments: [],
});
const CARDS = [card(1, true), card(2, false), card(3, true)];

async function routeBackend(page, origin) {
  await page.route('**/*', async route => {
    const r = route.request(); const u = new URL(r.url());
    if (r.url().startsWith(origin)) return route.continue();
    const json = body => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const p = u.pathname; const sp = u.searchParams;
    if (u.hostname === 'example.invalid' && /thumb/.test(p)) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: THUMB_SVG });
    if (p === '/functions/v1/key-verify') return json({ ok: true, role: 'admin', member: { id: 'm1', name: 'Browser Staff', role: 'admin', team: null } });
    if (p === '/functions/v1/thumbnail-folder-resolve') return json({ ok: true, skipped: 'fixture' });
    if (r.method() === 'POST') return json({ ok: true });
    if (p === '/rest/v1/clients') return json([{ slug: SLUG, display_name: NAME, active: true, kind: 'video' }]);
    if (p === '/rest/v1/team_members') return json([{ id: 'm1', name: 'Browser Staff', role: 'admin', team: null, active: true }]);
    if (p === '/rest/v1/syncview_runtime_flags') {
      const raw = sp.get('key') || '';
      const keys = /^in\.\(/.test(raw) ? raw.replace(/^in\.\(/, '').replace(/\)$/, '').split(',') : [raw.replace(/^eq\./, '')];
      return json(keys.map(k => ({ key: k, value: k === 'prod_authority' ? { video: 'syncview', graphics: 'syncview' } : { enabled: false } })));
    }
    if (p === '/rest/v1/calendar_posts') {
      const one = String(sp.get('id') || '').replace(/^eq\./, '');
      return json(CARDS.filter(c => !one || c.id === one));
    }
    if (/\/rest\/v1\//.test(p)) return json([]);
    if (/\/functions\/v1\/|\/webhook\//.test(p) || /n8n\.cloud$/.test(u.hostname)) return json({});
    if (/docs\.google\.com/.test(u.host)) return route.fulfill({ status: 200, headers: CORS, contentType: 'text/csv', body: '' });
    return route.abort();
  });
}

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
}

async function openSheet(browser, origin, viewport, mobile) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport, isMobile: !!mobile, hasTouch: !!mobile, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
  await seedStaffGate(page);
  await routeBackend(page, origin);
  await page.goto(`${origin}/index.html?v=calendar`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof _calSavePins === 'function' && typeof navTo === 'function', null, { timeout: 30000 });
  await page.evaluate(n => { _syncviewStaffIdentityVerified = true; _calSavePins([n]); calState.client = n; navTo('calendar'); }, NAME);
  await page.waitForFunction(() => document.querySelector('#calView'), null, { timeout: 15000 });
  await page.evaluate(() => { if (calState.view !== 'organizer') { calState.view = 'organizer'; _calRenderShell(); _calRenderBody(); } });
  if (mobile) {
    // The staff phone shows the cards as tiles; its List view draws the full editable card.
    await page.waitForSelector('#calView .thumb-grid-card, #calStrip .cal-card', { timeout: 20000 }).catch(() => {});
    await require('../docs/syncview-design/tests/staff-phone-browser').openEditableSheet(page);
  }
  await page.waitForSelector('#calView .cal-card[data-pid="c1"]', { timeout: 20000 });
  await page.waitForTimeout(600);
  return { ctx, page, errors };
}

// The Thumbnail row's buttons, the Files button and, once opened, the Files menu's rows.
async function rowButtons(page, pid) {
  return page.evaluate(pid => {
    const row = document.querySelector(`#calView .cal-card[data-pid="${pid}"] .cal-link-field.cal-link-thumb`);
    if (!row) return null;
    const vis = e => e.getClientRects().length && e.getBoundingClientRect().width > 0;
    return [...row.querySelectorAll('button, a')].filter(vis).map(b => b.className.split(' ')[0]);
  }, pid);
}
async function openFiles(page, pid, viaKeyboard) {
  const btn = page.locator(`#calView .cal-card[data-pid="${pid}"] .cal-files-btn`).first();
  if (viaKeyboard) { await btn.focus(); await page.keyboard.press('Enter'); }
  else await btn.click();
  await page.waitForSelector('#calFilesMenu', { timeout: 5000 });
  return page.evaluate(() => {
    const menu = document.getElementById('calFilesMenu');
    return {
      rows: [...menu.querySelectorAll('.cal-files-item')].map(e => ({ kind: e.dataset.filesKind, text: e.textContent.replace(/\s+/g, ' ').trim(), tag: e.tagName, href: e.getAttribute('href'), target: e.getAttribute('target'), rel: e.getAttribute('rel') })),
      focused: document.activeElement && document.activeElement.closest('#calFilesMenu') ? document.activeElement.dataset.filesKind : null,
    };
  });
}

async function cases(browser, origin, label, viewport, mobile) {
  const { ctx, page, errors } = await openSheet(browser, origin, viewport, mobile);
  const L = label;
  // The Thumbnail row: link and pencil, no folder icon (even when the folder is known).
  const row1 = await rowButtons(page, 'c1');
  expect(Array.isArray(row1) && row1.includes('cal-link-pill-open') && row1.includes('cal-link-edit'), `${L}: the Thumbnail row keeps its link and pencil (${JSON.stringify(row1)})`);
  expect(Array.isArray(row1) && !(await page.evaluate(() => !!document.querySelector('#calView .cal-card[data-pid="c1"] .cal-link-field.cal-link-thumb button.cal-link-folder:not(.thumb-compare-trigger)'))), `${L}: the Thumbnail row has no folder icon`);
  await shot(page, `${label}-card`);
  // The Files menu: Thumbnail folder right after Thumbnail file, the same link, in a new tab.
  const m = await openFiles(page, 'c1', false);
  const kinds = m.rows.map(r => r.kind);
  const fi = kinds.indexOf('thumb'), fo = kinds.indexOf('thumbfolder');
  expect(fi >= 0 && fo === fi + 1, `${L}: "Thumbnail folder" sits right after "Thumbnail file" (${kinds.join(', ')})`);
  const folderRow = m.rows[fo] || {};
  expect(folderRow.tag === 'A' && folderRow.href === FOLDER && folderRow.target === '_blank' && /noopener/.test(folderRow.rel || '') && /Thumbnail folder/.test(folderRow.text), `${L}: it opens the thumbnail's folder in a new tab (${JSON.stringify(folderRow)})`);
  await shot(page, `${label}-files-menu`);
  // Keyboard: the menu opens from Enter, and the folder row takes focus like any other link.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  const k = await openFiles(page, 'c1', true);
  expect(!!k.focused, `${L}: Enter opens the Files menu with focus inside it (${k.focused})`);
  const reach = await page.evaluate(() => { const a = document.querySelector('#calFilesMenu a[data-files-kind="thumbfolder"]'); if (!a) return false; a.focus(); return document.activeElement === a; });
  expect(reach, `${L}: the Thumbnail folder row can take keyboard focus`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  // A card whose folder is not known: the row reads "not linked yet", like the other rows.
  const n = await openFiles(page, 'c2', false);
  const missing = n.rows.find(r => r.kind === 'thumbfolder');
  expect(missing && missing.tag === 'SPAN' && /not linked yet/.test(missing.text), `${L}: an unknown folder reads "not linked yet" (${JSON.stringify(missing)})`);
  await page.keyboard.press('Escape');
  expect(errors.length === 0, `${L}: no page errors (${errors.join(' | ')})`);
  await ctx.close();
}

(async () => {
  const server = await serveStatic();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  try {
    await cases(browser, origin, 'desktop-1440', { width: 1440, height: 900 }, false);
    await cases(browser, origin, 'phone-390', { width: 390, height: 844 }, true);
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error(`\n${failures.length} check(s) failed, ${checks} passed.`); process.exit(1); }
  console.log(`\ncalendar thumbnail folder in the Files menu: ${checks} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
