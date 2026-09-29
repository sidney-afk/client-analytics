'use strict';
// OPEN_REPAIRS 215: a mouse press that starts inside a dialog and is released
// on the dark backdrop outside it must NOT close the dialog (it used to, and
// took any typed text with it). A dialog closes on an outside click only when
// both the press and the release land on the backdrop.
//
// Opens the real page offline (every backend call answered locally), opens each
// dialog through the app's own opener, then with the REAL mouse:
//   1. presses inside the dialog, drags to the backdrop, releases -> still open;
//   2. clicks the backdrop (press and release both outside)       -> closes.
// The shared guard is `data-backdrop-dismiss` + `_backdropPressBegan`
// (src/index/040-shared-briefs.js.part). A dialog that carries neither fails the
// "marked" check below, so a NEW dialog that forgets the guard cannot hide.
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { seedStaffIdentity } = require('../qa/staff-gate-seed.js');

const ADMIN = { id: 'qa_admin', name: 'QA Admin', role: 'admin', team: null };
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

// Each case: how to open it (runs in the page), the backdrop element it opens.
// Fixture post: enough for the calendar and samples dialogs to render.
const POST = "{ id: 'p1', title: 'Fixture post', client: 'Fixture client', scheduled_date: '2030-01-05', thumbnail_url: 'https://drive.google.com/file/d/abc123def456/view', comments: [] }";
const CLIENT = "'Fixture client'";
const mountViews = "for (const id of ['calView', 'sxrView']) { if (!document.getElementById(id)) { const d = document.createElement('div'); d.id = id; document.body.appendChild(d); } }";
const CASES = [
  { name: 'Confirm', overlay: '#confirmOverlay.active', open: () => showConfirm('Sure?', 'Body', () => {}) },
  { name: 'Resolve and route chooser', overlay: '#resolveDestOverlay.active', open: () => _calShowResolveDest({ comp: 'video', openTweaks: [], recommend: 'client', onChoose: () => {} }) },
  { name: 'Transcript preview', overlay: '#transcriptOverlay.active', open: () => { _hookCardData.t = { hookData: { handle: 'x' }, transcript: 'hello' }; openTranscriptModal('t'); } },
  { name: 'Create Post', overlay: '#calNativePostOverlay', open: () => { calState.client = 'Fixture client'; _calOpenNativePost('Fixture client', calClientSlug('Fixture client'), 'calendar'); } },
  { name: 'Detail info', overlay: '.detail-info-overlay', open: () => { clientMap['Fixture client'] = { content_description: 'ABOUT: fixture text' }; showClientInfoModal('Fixture client'); } },
  { name: 'Supporting reels info', overlay: '.mr-info-overlay', open: () => { _mrInfoStore.t = [{ handle: 'a', url: 'https://example.invalid/r' }]; showMRInfo('t'); } },
  { name: 'Calendar preview', overlay: '#calPreviewOverlay', open: new Function(`${mountViews}; calState.client = ${CLIENT}; calState.posts = [${POST}]; _calRenderShell(); openCalPreview('p1');`) },
  { name: 'Calendar import', overlay: '#calImportOverlay.open', open: new Function(`${mountViews}; calState.client = ${CLIENT}; _calRenderShell(); openCalImport();`) },
  { name: 'Calendar comments', overlay: '#calCommentsOverlay', open: new Function(`${mountViews}; calState.client = ${CLIENT}; calState.posts = [${POST}]; _calRenderShell(); openCalComments('p1');`) },
  { name: 'Calendar caption prompt', overlay: '#calPromptOverlay', open: new Function(`${mountViews}; calState.client = ${CLIENT}; _calRenderShell(); _calOpenCaptionPromptModal();`) },
  { name: 'Samples comments', overlay: '#sxrCommentsOverlay', open: new Function(`${mountViews}; sxrState.client = ${CLIENT}; sxrState.posts = [${POST}]; _sxrRenderShell(); openSxrComments('p1');`) },
  { name: 'Thumbnail comparison', overlay: '#thumbCompareOverlay.open', open: new Function(`${mountViews}; calState.client = ${CLIENT}; calState.posts = [${POST}]; _thumbCompareOpen(null, 'calendar', 'p1');`) },
  { name: 'Production command palette', overlay: '.prod-cmd-bd', open: () => _prodOpenPalette() },
  // Create-issue is closed for everyone by owner ruling (_prodOpenCreate refuses),
  // so its form is rendered directly: the backdrop code is still shipped.
  { name: 'Production create issue', overlay: '.prod-create-bd[data-prod-create-backdrop]', open: () => { _prodState.createDraft = _prodCreateDefaults(); _prodEnsureOverlays(); _prodRenderCreateModal(); } },
  { name: 'Production archive repair', overlay: '.prod-create-bd[data-prod-archive-backdrop]', open: () => _prodOpenArchiveRepair() },
  { name: 'Credentials: edit', overlay: '.cc-sensitive-overlay', open: () => _ccOpenEdit('', 'kasper', 'fixture') },
  { name: 'Credentials: history', overlay: '.cc-sensitive-overlay', open: () => _ccOpenHistory('c1', 'fixture') },
  { name: 'Credentials: onboarding import', overlay: '.cc-sensitive-overlay', open: () => _ccOpenOnboardingImport() },
  { name: 'Credentials: bulk import', overlay: '.cc-sensitive-overlay', open: () => _ccOpenBulkImport() },
  { name: 'Credentials: client dialog', overlay: '#ccOverlay', open: () => _ccOpenModalNow('Fixture client') },
];

// Inventory, read from the source and independent of the cases above, so a
// dialog added later cannot slip past this test:
//   1. every backdrop marked `data-backdrop-dismiss` in src/index must have a
//      case here (the sign-in backdrop is one site exercised in two modes);
//   2. no event-target comparison may go without reading the press mark,
//      unless it is listed below as not being a backdrop click.
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '..', 'src', 'index');
const codeLines = fs.readdirSync(SRC).filter(f => f.endsWith('.part')).flatMap(f =>
  fs.readFileSync(path.join(SRC, f), 'utf8').split('\n').map((text, i) => ({ where: f + ':' + (i + 1), text }))
).filter(x => !/^\s*(\/\/|\/\*|\*)/.test(x.text));
const markedSites = codeLines.filter(x => x.text.includes('data-backdrop-dismiss') && !x.where.startsWith('040-shared-briefs'));
assert.equal(markedSites.length, CASES.length + 1,
  `src/index has ${markedSites.length} backdrops marked data-backdrop-dismiss but this test covers ${CASES.length + 1}; add the new dialog to CASES:\n  ` + markedSites.map(x => x.where).join('\n  '));
// Any comparison of an event target with something else, whatever the variable
// is called (any event variable name, either order, `currentTarget` too).
// Each must read the press mark or be listed here with the reason it is not a
// backdrop click, so a new one forces a decision instead of passing unseen.
const NOT_A_BACKDROP_CLICK = [
  ['345-core-tooltip-date-picker', 'target === activeTarget', 'tooltip hover bookkeeping'],
  ['100-onboarding-staff-controls', "e.target!==body || e.propertyName", 'waits for a CSS transition to end'],
  ['096-quick-jump', "e.target !== input", 'Escape key from a non-input element'],
  ['096-quick-jump', 'if (e.target === box) svQuickJumpClose()', 'closes on the PRESS itself (mousedown), so a press that starts inside can never dismiss it'],
];
const targetCompare = /(\.(target|currentTarget)\s*[!=]==?)|([!=]==?\s*[\w$.]*\.(target|currentTarget)\b)|((?<!\$)\{\s*target\s*\})/;   // any event variable name, either order
const unguarded = codeLines.filter(x => targetCompare.test(x.text) && !x.text.includes('_backdropPressBegan')
  && !NOT_A_BACKDROP_CLICK.some(([f, frag]) => x.where.startsWith(f) && x.text.includes(frag)));
assert.deepEqual(unguarded.map(x => x.where + '  ' + x.text.trim().slice(0, 90)), [],
  'a target comparison ignores where the press began: guard it with data-backdrop-dismiss, or list it in NOT_A_BACKDROP_CLICK with the reason');

// The staff sign-in dialog only exists for someone who is not signed in, so it
// is checked on its own page with no saved login: the app opens it at start.
const SIGN_IN = { name: 'Staff sign-in', overlay: '#staffIdentityOverlay',
  open: () => { window.__realIdentity = _syncviewStaffIdentityForHeaders; window._syncviewStaffIdentityForHeaders = () => null; _syncviewOpenStaffIdentity({}); },
  after: () => { window._syncviewStaffIdentityForHeaders = window.__realIdentity; } };
// The start-up version of the same dialog is the login gate itself: it has no
// dismiss at all, so neither gesture may ever close it.
const SIGN_IN_GATE = { name: 'Staff sign-in (start-up gate)', overlay: '#staffIdentityOverlay', neverCloses: true, open: () => { _syncviewOpenStaffIdentity({ entry: true }); } };

(async () => {
  const server = await serveStatic();
  const browser = await chromium.launch();
  const covered = [];
  const failures = [];
  const writes = [];
  const errors = [];
  const base = () => `http://127.0.0.1:${server.address().port}/`;
  const newContext = async signedIn => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => {
      const req = route.request(); const url = req.url();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (/key-verify/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ ok: true, role: 'admin', member: ADMIN }) });
      if (req.method() !== 'GET' && !/-(read|list|status|verify)(\?|$)/.test(url) && !(/\/client-credentials$/.test(url) && /"action":"(list|history)"/.test(req.postData() || ''))) writes.push(req.method() + ' ' + url + ' ' + (req.postData() || '').slice(0, 120));
      if (/\/rest\/v1\/team_members/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify([{ ...ADMIN, active: true }]) });
      return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: /\/rest\/v1\//.test(url) ? '[]' : '{}' });
    });
    if (signedIn) await seedStaffIdentity(context, ADMIN);
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base(), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.showConfirm === 'function' && typeof window._calOpenNativePost === 'function', null, { timeout: 30000 });
    return page;
  };
  const shown = (page, sel) => page.evaluate(s => {
    const el = document.querySelector(s);
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    return getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' && r.width > 0 && r.height > 0;
  }, sel);
  const until = (page, sel, wantShown, ms) => page.waitForFunction(([s, want]) => {
    const el = document.querySelector(s);
    const on = !!el && el.isConnected && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
    return on === want;
  }, [sel, wantShown], { timeout: ms });

  async function drive(page, c) {
    const label = c.name;
    await page.evaluate(c.open);
    await until(page, c.overlay, true, 10000).catch(() => { throw new Error(label + ': the dialog did not open (' + c.overlay + ')'); });
    assert.equal(await page.evaluate(s => document.querySelector(s).hasAttribute('data-backdrop-dismiss'), c.overlay), true,
      label + ': the backdrop is not marked data-backdrop-dismiss, so it has no press guard');

    // A point on the backdrop itself and a point inside the dialog, proven by
    // what the browser says is under each, so the drag really is inside->outside.
    const pts = await page.evaluate(s => {
      const ov = document.querySelector(s);
      const out = { back: null, inner: null };
      for (const [x, y] of [[3, 3], [innerWidth - 3, 3], [3, innerHeight - 3], [innerWidth - 3, innerHeight - 3]]) {
        if (document.elementFromPoint(x, y) === ov) { out.back = [x, y]; break; }
      }
      // Press on the bare dialog surface where possible: dragging off a link or
      // an image starts the browser's own drag-and-drop, which swallows the click
      // and would make a broken dialog look fine.
      const clickable = el => { for (let n = el; n && n !== ov; n = n.parentElement) if (getComputedStyle(n).cursor === 'pointer') return true; return false; };
      const plain = /^(A|IMG|VIDEO|IFRAME|BUTTON|INPUT|TEXTAREA|SELECT|LABEL)$/;
      for (const ch of ov.children) {
        const r = ch.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) continue;
        const spots = [];
        for (const d of [12, 20, 32]) spots.push([r.left + d, r.top + d], [r.right - d, r.top + d], [r.left + d, r.bottom - d], [r.right - d, r.bottom - d]);
        spots.push([r.left + r.width / 2, r.top + r.height / 2]);
        for (const [x, y] of spots) {
          const u = document.elementFromPoint(x, y);
          if (u && u !== ov && ov.contains(u) && !u.closest('a,img,video,iframe,button,input,textarea,select,label,[draggable="true"]') && !plain.test(u.tagName) && !clickable(u)) { out.inner = [x, y]; break; }
        }
        if (out.inner) break;
      }
      if (!out.inner) {
        // No bare surface: press in a text field (the case that loses typing).
        for (const f of ov.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file]),textarea')) {
          const r = f.getBoundingClientRect();
          if (r.width < 8 || r.height < 8) continue;
          const x = r.left + r.width / 2, y = r.top + r.height / 2;
          if (document.elementFromPoint(x, y) === f) { out.inner = [x, y]; break; }
        }
      }
      if (!out.inner) {
        for (const ch of ov.children) {
          const r = ch.getBoundingClientRect();
          const x = r.left + r.width / 2, y = r.top + r.height / 2;
          const u = document.elementFromPoint(x, y);
          if (u && u !== ov && ov.contains(u)) { out.inner = [x, y]; break; }
        }
      }
      return out;
    }, c.overlay);
    assert.ok(pts.back, label + ': no visible backdrop point was found');
    assert.ok(pts.inner, label + ': no point inside the dialog was found');

    // 1. press inside, release on the backdrop: must stay open.
    await page.mouse.move(pts.inner[0], pts.inner[1]);
    await page.mouse.down();
    await page.mouse.move(pts.back[0], pts.back[1], { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(80);
    assert.equal(await shown(page, c.overlay), true, label + ': a press inside that was released outside closed the dialog');

    // 2. plain click on the backdrop: press and release outside still closes.
    await page.mouse.click(pts.back[0], pts.back[1]);
    if (c.neverCloses) {
      await page.waitForTimeout(150);
      assert.equal(await shown(page, c.overlay), true, label + ': an outside click closed the login gate');
      covered.push(label);
      return;
    }
    await until(page, c.overlay, false, 5000).catch(() => { throw new Error(label + ': a plain outside click no longer closes the dialog'); });
    covered.push(label);
  }

  try {
    const page = await newContext(true);
    await page.evaluate(() => { const g = document.getElementById('staffGateOverlay'); if (g) g.remove(); });
    for (const c of CASES) {
      if (process.env.ONLY && !c.name.includes(process.env.ONLY)) continue;
      try { await drive(page, c); } catch (e) { failures.push(e.message); }
      // Leave nothing behind for the next dialog to sit under.
      await page.evaluate(() => document.querySelectorAll('[data-backdrop-dismiss]').forEach(el => { if (!/^(confirm|resolveDest|transcript)/.test(el.id || '')) el.remove(); }));
    }
    if (!process.env.ONLY || SIGN_IN.name.includes(process.env.ONLY)) {
      try { await drive(page, SIGN_IN); } catch (e) { failures.push(e.message); }
      await page.evaluate(SIGN_IN.after);
      const signedOut = await newContext(false);
      try { await drive(signedOut, SIGN_IN_GATE); } catch (e) { failures.push(e.message); }
    }
    assert.deepEqual(failures, [], 'dialogs that failed:\n  ' + failures.join('\n  '));
    assert.deepEqual(writes, [], 'opening and dismissing dialogs must not write anything');
    assert.deepEqual(errors, [], 'no page errors: ' + errors.join(' | '));
    console.log(`dialog-backdrop-press-browser: ${covered.length} dialogs covered\n  ` + covered.join('\n  '));
    console.log('dialog-backdrop-press-browser ok');
  } finally {
    await browser.close();
    server.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
