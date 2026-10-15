'use strict';
/* popup-behaviour-browser.js -- every pop-up, menu, expanded panel and modal on
 * the staff screens behaves the same way, in a real browser, fully offline.
 *
 * The rule (owner request, 2026-10-14), checked for each surface below:
 *   1. Escape closes it. With two open, Escape closes only the top one.
 *   2. A click outside closes it. A click inside never does.
 *   3. When it closes, keyboard focus is back on the button that opened it.
 *   4. Closing never loses typed text (the surface keeps its own save or draft).
 *   5. A background refresh never closes it or takes its focus.
 *
 * Each surface is opened by a real click, then driven with the keyboard and the
 * mouse. Everything runs on the test client with every backend answer local.
 * It runs at desktop width and at 390px (phone).
 *
 * Run:  node docs/syncview-design/tests/popup-behaviour-browser.js
 * Add a surface: push one entry onto SURFACES (name, area, open, isOpen,
 * opener, inside) and it gets all of the checks.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const { seedStaffIdentity, STAFF_GATE_MEMBER } = require('../../../qa/staff-gate-seed.js');
const { TEST_CLIENT } = require('../../../qa/test-client-entry.js');

const root = path.resolve(__dirname, '..', '..', '..');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let file = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    file = path.normalize(file).replace(/^([.][\\/])+/, '');
    const full = path.join(root, file);
    if (!full.startsWith(root) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(full).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(full).pipe(res);
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

const SLUG = TEST_CLIENT.slug;
const CLIENT = TEST_CLIENT.name;
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
const LONG_CAPTION = Array.from({ length: 30 }, (_, i) => 'Made-up caption line number ' + (i + 1) + ' for a made-up video.').join('\n');
const card = (id, name, date) => ({
  id, client: SLUG, name, status: 'In Progress', order_index: Number(id.slice(-1)), updated_at: '2026-10-10T12:00:00.000Z',
  scheduled_date: date, video_status: 'In Progress', graphic_status: 'In Progress', caption_status: 'In Progress',
  video_deliverable_id: '', graphic_deliverable_id: '', caption: LONG_CAPTION, asset_url: 'https://example.invalid/video',
  thumbnail_url: 'https://example.invalid/thumb.png', comments: [], graphic_comments: [], caption_comments: [],
});
const CARDS = [card('pb1', 'First made-up post', '2026-10-15'), card('pb2', 'Second made-up post', '2026-10-17')];
const SAMPLES = [
  { id: 'sx1', client: SLUG, name: 'First made-up sample', status: 'In Progress', order_index: 1, updated_at: '2026-10-10T12:00:00.000Z',
    asset_url: 'https://example.invalid/video', thumbnail_url: 'https://example.invalid/thumb.png', video_status: 'In Progress', graphic_status: 'In Progress',
    video_deliverable_id: 'del_pb_sx_v', graphic_deliverable_id: 'del_pb_sx_g', comments: [], graphic_comments: [] },
];
const INBOX = [{ post_id: 'pb1', surface: 'calendar', client_slug: SLUG, client_name: CLIENT, title: 'First made-up post', unread: true, last_at: '2026-10-10T12:00:00.000Z', last_text: 'A made-up note', last_author: 'Made Up', thread: [] }];

let checks = 0; const failures = []; const table = [];
function expect(v, m) { checks++; if (!v) { failures.push(m); console.error('FAIL  ' + m); } else console.log('  ok  ' + m); }

async function newPage(browser, origin, viewport, member) {
  const who = member || STAFF_GATE_MEMBER;
  const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', hasTouch: viewport.width < 500 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e).slice(0, 200)));
  await seedStaffIdentity(page, who);
  await page.route('**/*', async route => {
    const r = route.request(); const u = new URL(r.url());
    if (r.url().startsWith(origin)) return route.continue();
    const json = (b, st) => route.fulfill({ status: st || 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(b) });
    if (/\/thumb\.png$/.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'image/png', body: fs.readFileSync(path.join(root, 'syncview-favicon.png')) });
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const p = u.pathname;
    if (p === '/functions/v1/key-verify') return json({ ok: true, role: who.role, member: who });
    if (p === '/functions/v1/messages' || /inbox/.test(p)) return json({ ok: true, conversations: INBOX, items: INBOX });
    if (p === '/rest/v1/production_deliverables_browser_v1') {
      const raw = u.searchParams.get('id') || '';
      const ids = raw.replace(/^in\.\(/, '').replace(/\)$/, '').split(',').filter(Boolean);
      return json(ids.map((id, i) => ({ id, identifier: 'VID-' + (900 + i), title: 'Made-up work item', status: 'In Progress', status_at: '2026-10-10T12:00:00.000Z', assignee_id: '', due_date: '2026-10-20', updated_at: '2026-10-10T12:00:00.000Z' })));
    }
    if (r.method() === 'POST') return json({ ok: true });
    if (p === '/rest/v1/clients') return json([{ slug: SLUG, display_name: CLIENT, active: true, kind: 'video' }]);
    if (p === '/rest/v1/team_members') return json([Object.assign({ active: true }, who)]);
    if (p === '/rest/v1/syncview_runtime_flags') {
      const raw = u.searchParams.get('key') || '';
      const keys = /^in\.\(/.test(raw) ? raw.replace(/^in\.\(/, '').replace(/\)$/, '').split(',') : [raw.replace(/^eq\./, '')];
      return json(keys.map(k => ({ key: k, value: k === 'prod_authority' ? { video: 'syncview', graphics: 'syncview' } : (/_clients$/.test(k) ? { clients: [SLUG] } : { enabled: false }) })));
    }
    if (p === '/rest/v1/calendar_posts') return json(CARDS.map(c => Object.assign({}, c)));
    if (p === '/rest/v1/sample_reviews') return json(SAMPLES.map(c => Object.assign({}, c)));
    if (/\/rest\/v1\//.test(p)) return json([]);
    if (/\/functions\/v1\/|\/webhook\//.test(p)) return json({});
    if (/docs\.google\.com/.test(u.host)) return route.fulfill({ status: 200, headers: CORS, contentType: 'text/csv', body: '' });
    return route.abort();
  });
  return { ctx, page, errors };
}

async function gotoCalendar(page, origin) {
  await page.goto(`${origin}/index.html?v=calendar`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof _calSavePins === 'function' && typeof svLayerOpen === 'function', null, { timeout: 30000 });
  await page.evaluate(c => { _syncviewStaffIdentityVerified = true; _calSavePins([c]); navTo('calendar'); }, CLIENT);
  await page.waitForSelector('.cal-card[data-pid="pb1"]', { timeout: 30000 });
  await page.waitForTimeout(600);
}
async function gotoSamples(page, origin) {
  await page.goto(`${origin}/index.html?sxr=1#sample-reviews/${SLUG}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.cal-card[data-pid="sx1"]', { timeout: 30000 });
  await page.waitForTimeout(600);
}

/* The checks every surface gets. `s` has:
 *   name, area        for the report table
 *   open(page)        opens it with a real click (or key)
 *   isOpen(page)      true while it is open
 *   opener            CSS selector of the button it opens from (focus goes back here)
 *   inside            CSS selector of a spot inside it that is safe to click
 *   type              optional { selector, text, kept(page) } : typed text must survive closing
 *   refresh           optional async (page) that runs a background refresh
 */
async function activeMatches(page, selector) {
  return page.evaluate(sel => { const a = document.activeElement; return !!a && a !== document.body && !!a.matches && (a.matches(sel) || !!a.closest(sel)); }, selector);
}
async function blankPoint(page, insideSel) {
  /* A spot on the page that is not part of the pop-up and not a control, so
     clicking it can only mean "somewhere else". Scans a grid. */
  return page.evaluate(sel => {
    const box = sel ? document.querySelector(sel) : null;
    const W = innerWidth, H = innerHeight;
    // A native dialog sheet: its dim backdrop is the strip above it.
    if (document.querySelector('dialog[open]')) return { x: Math.floor(W / 2), y: 8 };
    const pts = [];
    for (const fy of [0.55, 0.9, 0.7, 0.3, 0.97, 0.15, 0.45]) for (const fx of [0.9, 0.5, 0.02, 0.75, 0.25]) pts.push([Math.floor(W * fx), Math.floor(H * fy)]);
    const live = '.sv-select-menu, .cal-fld-status-menu, .dropdown-menu, dialog[open], .dp-popup, [role=dialog], [role=menu], [role=listbox], [role=option], [aria-live]';
    for (const [x, y] of pts) {
      const t = document.elementFromPoint(x, y);
      if (!t) continue;
      if (t.closest('button, a, input, textarea, select, label, summary, [onclick], [role=button], [tabindex]')) continue;
      if (box && box.contains(t)) continue;
      if (t.closest(live)) continue;
      return { x, y };
    }
    return { x: Math.floor(W * 0.9), y: Math.floor(H * 0.55) };
  }, insideSel || null);
}
async function runSurface(page, s, label) {
  if (s.only && s.only !== label) return;
  const row = { area: s.area, name: s.name, view: label, escape: '', outside: '', inside: '', focus: '', text: '', refresh: '' };
  const tag = `[${label}] ${s.name}: `;
  try {
    await s.open(page);
    await page.waitForTimeout(250);
    expect(await s.isOpen(page), tag + 'opens');
    // 1. Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    const closedByEsc = !(await s.isOpen(page));
    expect(closedByEsc, tag + 'Escape closes it');
    row.escape = closedByEsc ? 'yes' : 'NO';
    const focusEsc = await activeMatches(page, s.opener);
    expect(focusEsc, tag + 'focus is back on the opening button after Escape');
    row.focus = focusEsc ? 'yes' : 'NO';
    // 2. Click inside never closes
    await s.open(page);
    await page.waitForTimeout(250);
    if (s.inside) {
      const box = await page.locator(s.inside).first().boundingBox();
      if (box) {
        /* A menu made only of rows: its padding strip on the right edge is the
           one place a click is "inside" without choosing a row. */
        if (s.insideEdge) await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
        else await page.mouse.click(box.x + Math.min(8, box.width / 2), box.y + Math.min(8, box.height / 2));
      }
      await page.waitForTimeout(250);
      const stillOpen = await s.isOpen(page);
      if (!stillOpen) {
        const where = box ? await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? (e.tagName + '.' + String(e.className).slice(0, 40) + '#' + e.id) : 'nothing'; }, [box.x + 8, box.y + 8]) : 'no box';
        console.log('  ..  ' + tag + 'click landed on ' + where + '; layers now: ' + JSON.stringify(await page.evaluate(() => svLayerKeys())));
      }
      expect(stillOpen, tag + 'a click inside does not close it');
      row.inside = stillOpen ? 'stays' : 'CLOSES';
    }
    // 3. Click outside closes
    if (!(await s.isOpen(page))) { await s.open(page); await page.waitForTimeout(250); }
    await page.waitForTimeout(300);
    const pt = await blankPoint(page, s.inside);
    const covered = s.inside ? await page.evaluate(([x, y, sel]) => { const t = document.elementFromPoint(x, y); const box = document.querySelector(sel); return !!(t && box && box.contains(t)); }, [pt.x, pt.y, s.inside]) : false;
    if (covered) { row.outside = 'fills screen'; console.log('  --  ' + tag + 'fills the screen, no outside area to click'); }
    else { await page.mouse.click(pt.x, pt.y); }
    await page.waitForTimeout(350);
    const closedByOutside = covered ? true : !(await s.isOpen(page));
    if (!closedByOutside) console.log('  ..  ' + tag + 'outside click at ' + pt.x + ',' + pt.y + ' landed on ' + await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? (e.tagName + '.' + String(e.className).slice(0, 40) + '#' + e.id) : 'nothing'; }, [pt.x, pt.y]) + '; layers: ' + JSON.stringify(await page.evaluate(() => svLayerKeys())));
    expect(closedByOutside, tag + 'a click outside closes it');
    if (!covered) row.outside = closedByOutside ? 'yes' : 'NO';
    else await page.keyboard.press('Escape');
    const focusOut = await page.evaluate(() => { const a = document.activeElement; return !a || a === document.body; }) || await activeMatches(page, s.opener);
    expect(focusOut, tag + 'focus is not lost into a stray place after an outside click');
    // 4. Typed text survives closing
    if (s.type) {
      await s.open(page);
      await page.waitForTimeout(250);
      await page.locator(s.type.selector).first().click();
      await page.keyboard.type(s.type.text);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      const kept = await s.type.kept(page);
      expect(kept, tag + 'typed text is kept after Escape');
      row.text = kept ? 'kept' : 'LOST';
    }
    // 5. A background refresh neither closes it nor takes its focus
    if (s.refresh) {
      await s.open(page);
      await page.waitForTimeout(250);
      await s.refresh(page);
      await page.waitForTimeout(900);
      const still = await s.isOpen(page);
      expect(still, tag + 'a background refresh does not close it');
      row.refresh = still ? 'stays' : 'CLOSES';
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
    }
  } catch (e) {
    expect(false, tag + 'raised: ' + String(e && e.message || e).slice(0, 200));
  }
  // leave a clean page for the next surface
  try {
    await page.evaluate(() => {
      // an edited prompt box would ask "discard?" on close: put its text back first
      document.querySelectorAll('#calPromptOverlay textarea').forEach(t => { t.value = t.defaultValue; });
      let n = 0;
      while (window.svLayerKeys().length && n++ < 12) svLayerCloseTop('api');
      if (document.querySelector('#confirmOverlay.active')) dismissConfirm();
    });
  } catch (e) {}
  table.push(row);
}

const sel = pid => (window.CSS && CSS.escape ? CSS.escape(pid) : pid);
const calRefresh = async page => { await page.evaluate(() => loadCalendarPosts({ background: true, forceMeta: true, quiet: true })); };
const sxrRefresh = async page => { await page.evaluate(() => { if (typeof loadSxrPosts === 'function') return loadSxrPosts({ background: true, quiet: true }); }); };


/* Opens a pop-up from code, after putting focus on a stand-in button, for the
 * dialogs whose real trigger sits in a menu that closes first (the three-dots
 * menu rows). Focus return is then checked against the stand-in. */
const STUB = '#popupTestOpener';
const fromStub = expr => async p => {
  await p.evaluate(src => {
    let b = document.getElementById('popupTestOpener');
    if (!b) { b = document.createElement('button'); b.id = 'popupTestOpener'; b.textContent = 'x'; b.style.cssText = 'position:fixed;left:4px;bottom:4px;z-index:1;width:20px;height:20px'; document.body.appendChild(b); }
    b.focus();
    return (0, eval)(src);
  }, expr);
};
const overlayOpen = id => p => p.evaluate(i => { const o = document.getElementById(i); return !!o && (o.classList.contains('open') || o.classList.contains('active')); }, id);

const CAL_MODALS = [
  { area: 'Calendar', name: 'Import dialog', opener: STUB, open: fromStub('openCalImport()'), isOpen: overlayOpen('calImportOverlay'), inside: '#calImportOverlay > *' },
  { area: 'Calendar', name: 'Caption prompt dialog', opener: STUB, open: fromStub('_calOpenCaptionPromptModal()'), isOpen: overlayOpen('calPromptOverlay'), inside: '#calPromptModal',
    type: { selector: '#calPromptTA', text: ' MADEUP', kept: p => p.evaluate(() => { const o = document.getElementById('calPromptOverlay'); const ta = document.getElementById('calPromptTA'); return !!o && o.classList.contains('open') && !!ta && /MADEUP/.test(ta.value); }) } },
  { area: 'Calendar', name: 'Month / week preview', opener: STUB, open: fromStub("openCalPreview('pb1')"), isOpen: overlayOpen('calPreviewOverlay'), inside: '#calPreview' },
  { area: 'Calendar', name: 'Thumbnail lightbox', opener: STUB, open: fromStub("_calOpenThumbLightbox('pb1')"), isOpen: overlayOpen('calLightbox'), inside: '#calLightbox img' },
  { area: 'Calendar', name: 'Create Post dialog', opener: STUB, open: fromStub(`_calOpenNativePost(${JSON.stringify(CLIENT)}, ${JSON.stringify(SLUG)}, 'calendar')`),
    isOpen: p => p.evaluate(() => !!document.querySelector('#calNativePostOverlay.open')), inside: '#calNativePostOverlay .cal-import-modal' },
  { area: 'Calendar', name: 'Archived cards list', opener: STUB, open: fromStub("_arxOpen('cal')"), isOpen: p => p.evaluate(() => !!document.getElementById('arxOverlay')), inside: '#arxOverlay .arx-modal' },
  { area: 'Calendar', name: 'Resolve-and-route chooser', opener: STUB,
    open: fromStub("_calShowResolveDest({ comp: 'video', openTweaks: [], recommend: 'client', onChoose() {} })"), isOpen: overlayOpen('resolveDestOverlay'), inside: '#resolveDestOverlay .confirm-box' },
];
const SXR_MODALS = [
  { area: 'Samples', name: 'Thumbnail lightbox', opener: STUB, open: fromStub("_sxrOpenThumbLightbox('sx1')"), isOpen: overlayOpen('sxrLightbox'), inside: '#sxrLightbox img' },
  { area: 'Samples', name: 'Resolve-and-route chooser', opener: STUB,
    open: fromStub("_sxrShowResolveDest({ comp: 'video', openTweaks: [], recommend: 'client', onChoose() {} })"), isOpen: overlayOpen('resolveDestOverlay'), inside: '#resolveDestOverlay .confirm-box' },
  { area: 'Samples', name: 'Archived samples list', opener: STUB, open: fromStub("_arxOpen('sxr')"), isOpen: p => p.evaluate(() => !!document.getElementById('arxOverlay')), inside: '#arxOverlay .arx-modal' },
];

const CAL_SURFACES = [
  { area: 'Calendar', name: 'Expanded caption (Show more)', opener: '.cal-card[data-pid="pb1"] .cal-cap-toggle',
    open: async p => { await p.click('.cal-card[data-pid="pb1"] .cal-cap-wrap[data-capwrap="main"] .cal-cap-toggle'); },
    isOpen: p => p.evaluate(() => !!document.querySelector('.cal-card[data-pid="pb1"] .cal-cap-wrap.expanded')),
    inside: '.cal-card[data-pid="pb1"] .cal-cap-wrap textarea',
    type: { selector: '.cal-card[data-pid="pb1"] .cal-cap-wrap textarea', text: ' MADEUP', kept: p => p.evaluate(() => { const post = calState.posts.find(x => x.id === 'pb1'); return /MADEUP/.test((post && post.caption) || '') || /MADEUP/.test(JSON.stringify(_calPendingEdits || {})); }) },
    refresh: calRefresh },
  { area: 'Calendar', name: 'Notes panel', opener: '.cal-card[data-pid="pb1"] [data-comments-btn="pb1"]',
    open: async p => { await p.click('.cal-card[data-pid="pb1"] [data-comments-btn="pb1"]'); },
    isOpen: p => p.evaluate(() => !!document.querySelector('#calCommentsOverlay.open')),
    inside: '#calCommentsModal',
    type: { selector: '#calCommentComposer', text: 'made up note', kept: p => p.evaluate(() => { try { return /made up note/.test(sessionStorage.getItem('sv_calNoteDraft_pb1') || JSON.stringify(Object.assign({}, sessionStorage)) ) || /made up note/.test(_calRootDraft || ''); } catch (e) { return /made up note/.test(_calRootDraft || ''); } }) },
    refresh: calRefresh },
  { area: 'Calendar', name: 'Set all to… menu', opener: '.cal-card[data-pid="pb1"] .cal-fld-setall',
    open: async p => { await p.click('.cal-card[data-pid="pb1"] .cal-fld-setall'); },
    isOpen: p => p.evaluate(() => !!document.querySelector('.cal-fld-status-menu.open')),
    inside: '.cal-fld-status-menu .cal-fld-setall-menu-head', refresh: calRefresh },
  { area: 'Calendar', name: 'Status pill menu', opener: '.cal-card[data-pid="pb1"] .cal-comp-caption .cal-fld-substatus-trigger',
    open: async p => { await p.click('.cal-card[data-pid="pb1"] .cal-comp-caption .cal-fld-substatus-trigger'); },
    isOpen: p => p.evaluate(() => !!document.querySelector('.cal-fld-status-menu.open')),
    inside: '.cal-fld-status-menu', insideEdge: true, refresh: calRefresh },
  { only: 'desktop', area: 'Calendar', name: 'Organize menu', opener: '#calOrganizeBtn',
    open: async p => { await p.click('#calOrganizeBtn'); },
    isOpen: p => p.evaluate(() => !!document.querySelector('#calOrganizeMenu.open')), inside: '#calOrganizeMenu', refresh: calRefresh },
  { only: 'desktop', area: 'Calendar', name: 'Card status filter menu', opener: '#calCardStatusBtn',
    open: async p => { await p.click('#calCardStatusBtn'); },
    isOpen: p => p.evaluate(() => !!document.querySelector('#calCardStatusMenu.open')), inside: '#calCardStatusMenu', refresh: calRefresh },
  { only: 'desktop', area: 'Calendar', name: 'More (three dots) menu', opener: '.cal-kebab-wrap > button',
    open: async p => { await p.click('.cal-kebab-wrap > button'); },
    isOpen: p => p.evaluate(() => { const m = document.getElementById('calKebabMenu'); return !!m && !m.hidden; }), inside: '#calImportToggle', refresh: calRefresh },
  { area: 'Calendar', name: 'Card colour picker', opener: '.cal-card[data-pid="pb1"] .cal-card-color-tag',
    open: async p => { await p.click('.cal-card[data-pid="pb1"] .cal-card-color-tag'); },
    isOpen: p => p.evaluate(() => !!document.querySelector('.cal-card[data-pid="pb1"] .cal-card-color-picker')), inside: '.cal-card[data-pid="pb1"] .cal-card-color-picker', insideEdge: true, refresh: calRefresh },
  { area: 'Calendar', name: 'Files menu', opener: '.cal-card[data-pid="pb1"] .cal-files-btn',
    open: async p => { await p.click('.cal-card[data-pid="pb1"] .cal-files-btn'); },
    isOpen: p => p.evaluate(() => !!document.getElementById('calFilesMenu')), inside: '#calFilesMenu .cal-org-sec', refresh: calRefresh },
  { area: 'Calendar', name: 'Add-a-caption platform menu', opener: '.cal-card[data-pid="pb1"] .cal-altcap-add',
    open: async p => { await p.click('.cal-card[data-pid="pb1"] .cal-altcap-add'); },
    isOpen: p => p.evaluate(() => !!document.querySelector('.cal-fld-status-menu.open')), inside: '.cal-fld-status-menu', insideEdge: true, refresh: calRefresh },
  { area: 'Calendar', name: 'Date picker', opener: '.cal-card[data-pid="pb1"] .cal-date-chip',
    open: async p => { await p.click('.cal-card[data-pid="pb1"] .cal-date-chip'); },
    isOpen: p => p.evaluate(() => !!document.getElementById('svDatePickerPopup')), inside: '#svDatePickerPopup', refresh: calRefresh },
  { area: 'Calendar', name: 'Confirm dialog', opener: '#popupTestOpener',
    open: async p => { await p.evaluate(() => { let b = document.getElementById('popupTestOpener'); if (!b) { b = document.createElement('button'); b.id = 'popupTestOpener'; b.textContent = 'x'; b.style.cssText = 'position:fixed;left:4px;bottom:4px;z-index:1'; document.body.appendChild(b); } b.focus(); showConfirm('Made-up question?', 'Made-up text.', () => {}, 'Yes'); }); },
    isOpen: p => p.evaluate(() => !!document.querySelector('#confirmOverlay.active')), inside: '#confirmOverlay .confirm-box' },
];

const SXR_SURFACES = [
  { area: 'Samples', name: 'Status pill menu', opener: '.cal-card[data-pid="sx1"] .cal-comp-graphic .cal-fld-substatus-trigger',
    open: async p => { await p.click('.cal-card[data-pid="sx1"] .cal-comp-graphic .cal-fld-substatus-trigger'); },
    isOpen: p => p.evaluate(() => !!document.querySelector('.cal-fld-status-menu.open')), inside: '.cal-fld-status-menu', insideEdge: true, refresh: sxrRefresh },
  { area: 'Samples', name: 'Set all to… menu', opener: '.cal-card[data-pid="sx1"] .cal-fld-setall',
    open: async p => { await p.click('.cal-card[data-pid="sx1"] .cal-fld-setall'); },
    isOpen: p => p.evaluate(() => !!document.querySelector('.cal-fld-status-menu.open')), inside: '.cal-fld-status-menu .cal-fld-setall-menu-head', refresh: sxrRefresh },
  { area: 'Samples', name: 'Notes panel', opener: '.cal-card[data-pid="sx1"] [data-comments-btn="sx1"]',
    open: async p => { await p.click('.cal-card[data-pid="sx1"] [data-comments-btn="sx1"]'); },
    isOpen: p => p.evaluate(() => !!document.querySelector('#sxrCommentsOverlay.open')), inside: '#sxrCommentsModal',
    type: { selector: '#sxrCommentComposer', text: 'made up note', kept: p => p.evaluate(() => /made up note/.test(_sxrRootDraft || '') || /made up note/.test(sessionStorage.getItem('sv_sxrNoteDraft_sx1') || '')) },
    refresh: sxrRefresh },
  { only: 'desktop', area: 'Samples', name: 'More (three dots) menu', opener: '.cal-kebab-wrap > button',
    open: async p => { await p.click('.cal-kebab-wrap > button'); },
    isOpen: p => p.evaluate(() => { const m = document.getElementById('sxrKebabMenu'); return !!m && !m.hidden; }), inside: '#sxrKebabMenu', insideEdge: true },
];

const PHONE_SURFACES = ['tabs', 'more'].map(which => ({
  only: 'phone', area: 'Phone bar', name: (which === 'tabs' ? 'Tabs' : 'More') + ' sheet', opener: `[data-staff-menu="${which}"]`,
  open: async p => { await p.click(`[data-staff-menu="${which}"]`); },
  isOpen: p => p.evaluate(() => !!document.querySelector('dialog[open]')), inside: 'dialog[open] > *',
}));
const SHELL_SURFACES = [
  { only: 'desktop', area: 'Main bar', name: 'Client dropdown', opener: '#svClientBadge',
    open: async p => { await p.click('#svClientBadge'); },
    isOpen: p => p.evaluate(() => { const m = document.getElementById('svClientPop'); return !!m && !m.hidden; }), inside: '#svClientPop' },
  { only: 'desktop', area: 'Main bar', name: 'Staff account menu', opener: '#headerMenuButton',
    open: async p => { await p.click('#headerMenuButton'); },
    isOpen: p => p.evaluate(() => { const m = document.getElementById('staffAccountPopover'); return !!m && !m.hidden; }), inside: '#staffAccountSummary' },
  { area: 'Main bar', name: 'Quick jump', opener: '#popupTestOpener',
    open: async p => { await p.evaluate(() => { let b = document.getElementById('popupTestOpener'); if (!b) { b = document.createElement('button'); b.id = 'popupTestOpener'; b.textContent = 'x'; b.style.cssText = 'position:fixed;left:4px;bottom:4px;z-index:1'; document.body.appendChild(b); } b.focus(); svQuickJumpOpen(); }); },
    isOpen: p => p.evaluate(() => { const m = document.getElementById('svJump'); return !!m && !m.hidden; }), inside: '#svJump .sv-jump-box' },
];

// Messages is a page under the header since #2083, not a pop-up, so it has
// no layer to test here. Its own suite (messages-inbox-browser.js) covers it.
const MSG_SURFACES = [{only:'phone',area:'Messages',name:'Conversation actions sheet',opener:STUB,open:fromStub("_msgPhoneMore(document.getElementById('popupTestOpener'))"),isOpen:p=>p.locator('.thumb-msg-more[open]').count().then(Boolean),inside:'.thumb-msg-more header',refresh:p=>p.evaluate(()=>_msgLoad(true))}];

async function stackChecks(page, label) {
  // Two open at once: Escape closes only the top one.
  const tag = `[${label}] stack: `;
  await page.click('[data-comments-btn="pb1"]');
  await page.waitForSelector('#calCommentsOverlay.open');
  await page.waitForTimeout(300);
  await page.locator('#calCommentComposer').click();
  await page.keyboard.type('made up stack note');
  await page.waitForTimeout(200);
  const more = page.locator('#calCommentsModal .cal-cm-send-more');
  if (await more.count()) {
    await more.click();
    await page.waitForTimeout(250);
    const menuOpen = await page.evaluate(() => { const m = document.querySelector('#calCommentsModal .cal-cm-send-menu'); return !!m && !m.hidden; });
    expect(menuOpen, tag + 'the Send menu opens on top of the Notes panel');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    const state1 = await page.evaluate(() => ({ menu: !!(document.querySelector('#calCommentsModal .cal-cm-send-menu') && !document.querySelector('#calCommentsModal .cal-cm-send-menu').hidden), notes: !!document.querySelector('#calCommentsOverlay.open') }));
    expect(!state1.menu && state1.notes, tag + 'first Escape closes only the Send menu, Notes panel stays');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    const notesOpen = await page.evaluate(() => !!document.querySelector('#calCommentsOverlay.open'));
    expect(!notesOpen, tag + 'second Escape closes the Notes panel');
  } else {
    await page.keyboard.press('Escape');
  }
  // A confirm over a menu: Escape dismisses the confirm only.
  await page.click('.cal-card[data-pid="pb1"] .cal-fld-setall');
  await page.waitForSelector('.cal-fld-status-menu.open');
  await page.evaluate(() => showConfirm('Made-up question?', 'Made-up text.', () => {}, 'Yes'));
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  const st2 = await page.evaluate(() => ({ confirm: !!document.querySelector('#confirmOverlay.active'), menu: !!document.querySelector('.cal-fld-status-menu.open') }));
  expect(!st2.confirm && st2.menu, tag + 'Escape closes the confirm box only, the menu under it stays');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  expect(!(await page.evaluate(() => !!document.querySelector('.cal-fld-status-menu.open'))), tag + 'next Escape closes the menu');
  // A box that asks "discard your edits?" before it closes: the first Escape asks,
  // the next Escape answers (keeps the box and the text), the one after asks again.
  await page.evaluate(() => _calOpenCaptionPromptModal());
  await page.waitForSelector('#calPromptOverlay.open');
  await page.locator('#calPromptTA').click();
  await page.keyboard.type(' MADEUP');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  const q1 = await page.evaluate(() => ({ ask: !!document.querySelector('#confirmOverlay.active'), box: !!document.querySelector('#calPromptOverlay.open') }));
  expect(q1.ask && q1.box, tag + 'Escape on an edited box asks before discarding');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  const q2 = await page.evaluate(() => ({ ask: !!document.querySelector('#confirmOverlay.active'), box: !!document.querySelector('#calPromptOverlay.open'), text: /MADEUP/.test((document.getElementById('calPromptTA') || {}).value || '') }));
  expect(!q2.ask && q2.box && q2.text, tag + 'Escape on the question closes only the question, the box keeps its text');
  await page.evaluate(() => { document.getElementById('calPromptTA').value = document.getElementById('calPromptTA').defaultValue; });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  expect(!(await page.evaluate(() => !!document.querySelector('#calPromptOverlay.open'))), tag + 'with nothing edited the box closes at once');
  // Escape with nothing open must not do anything to the layer list.
  await page.keyboard.press('Escape');
  expect((await page.evaluate(() => svLayerKeys().length)) === 0, tag + 'nothing left on the stack');
}

async function pass(browser, origin, label, viewport) {
  console.log(`--- ${label} (${viewport.width}px) ---`);
  const t = await newPage(browser, origin, viewport);
  try {
    await gotoCalendar(t.page, origin);
    for (const s of CAL_SURFACES.concat(CAL_MODALS)) await runSurface(t.page, s, label);
    if (viewport.width > 500) await stackChecks(t.page, label);
    for (const s of PHONE_SURFACES.concat(SHELL_SURFACES)) await runSurface(t.page, s, label);
    await gotoSamples(t.page, origin);
    for (const s of SXR_SURFACES.concat(SXR_MODALS)) await runSurface(t.page, s, label);
    if (viewport.width > 500) {
      const smm = await newPage(browser, origin, viewport, { id: 'qa_smm', name: 'QA Manager', role: 'smm', team: null });
      await gotoCalendar(smm.page, origin);
      for (const s of MSG_SURFACES) await runSurface(smm.page, s, label);
      expect(smm.errors.length === 0, `[${label}] no page errors (messages)` + (smm.errors[0] ? ' : ' + smm.errors[0] : ''));
      await smm.ctx.close();
    }
    expect(t.errors.length === 0, `[${label}] no page errors` + (t.errors[0] ? ' : ' + t.errors[0] : ''));
  } catch (e) {
    expect(false, `[${label}] raised: ` + String(e && e.message || e).slice(0, 240));
  }
  await t.ctx.close();
}

function summary(name) {
  if (process.env.POPUP_TABLE) fs.writeFileSync(process.env.POPUP_TABLE, JSON.stringify(table, null, 1));
  console.log(failures.length
    ? `\n${name}: ${failures.length} of ${checks} check(s) failed`
    : `\n${name}: all ${checks} checks passed`);
  return failures.length ? 1 : 0;
}
module.exports = { serve, newPage, gotoCalendar, gotoSamples, runSurface, expect, summary, fromStub, overlayOpen, STUB, SLUG, CLIENT, CORS, root };
if (require.main === module) (async () => {
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    await pass(browser, origin, 'desktop', { width: 1280, height: 1500 });
    await pass(browser, origin, 'phone', { width: 390, height: 844 });
  } finally {
    await browser.close();
    server.close();
  }
  process.exit(summary('popup-behaviour-browser'));
})();
