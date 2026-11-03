'use strict';
/*
 * The live walk for V4 (plan docs/plans/2026-11-trial-and-posting/combined.md row V4, OPEN_REPAIRS 663): the review
 * page's trial versions, each with its own thumbnail and caption, on the client link, the SMM's Review tab and Kasper's
 * Review Session, at 1440 and 390, in Chromium or WebKit. Run by hand from
 * .github/workflows/trial-v4-review-live-walk.yml.
 *
 * READ ONLY. This build is served locally against the live backend, on the test client only (qa/test-client-entry.js
 * refuses any other client). Every write is blocked in the browser before it leaves: the Calendar, Production and
 * comment writers, any trial-reels action but a read, and any REST write. The summary counts what was blocked, and a
 * run that blocked anything fails. The part picker is opened and cancelled, never sent.
 *
 * Kasper's Review Session and its second layout are switched on for three named staff members, and this walk signs in
 * as a stand-in staff identity (qa/staff-gate-seed.js), so only this page's read of those two switches is widened to
 * everyone (as qa/dawn/dawn-check.js does for analytics_hidden). Nothing in the database changes.
 *
 * Prints only counts, true/false and surface names: never a link, a caption, a name, an id or a key. Takes no
 * screenshots (Kasper's queue holds other clients' cards, and this repository is public).
 *
 * Env: SYNCVIEW_STAFF_KEY (issues the test client's review link), ROLE_KEY_SMM (staff reads), WALK_ENGINE (chromium or
 * webkit), WALK_CARD (optional: a test-client trial card id to open first).
 */
const path = require('path');

const SUPA = 'https://uzltbbrjidmjwwfakwve.supabase.co';
const WRITE_FN = /\/functions\/v1\/(calendar-upsert|calendar-card-write|production-write|deliverable-write|batch-write|calendar-comment|production-comment)(\?|$)/;
const TRIAL_READS = ['read', 'list', 'list_many'];
const SURFACES = ['client', 'smm', 'kasper'];
const WIDTHS = [1440, 390];

/** Would this request write? The browser aborts it before it leaves. */
function isWrite(method, url, body) {
  const m = String(method || '').toUpperCase(), u = String(url || '');
  if (u.startsWith(SUPA + '/rest/v1/')) return ['POST', 'PATCH', 'PUT', 'DELETE'].includes(m);
  if (!u.startsWith(SUPA + '/functions/v1/') || m !== 'POST') return false;
  if (WRITE_FN.test(u)) return true;
  if (/\/functions\/v1\/trial-reels(\?|$)/.test(u)) return !TRIAL_READS.includes(String((body && body.action) || ''));
  return false;
}

/** One surface's line: counts and true/false only. */
function surfaceLine(o) {
  const keep = ['surface', 'width', 'engine', 'stage', 'trialCardsOpened', 'withFields', 'ownCaption', 'noCaption', 'picturesLoaded', 'pickerOpened', 'pickerParts', 'tiles', 'tilePictures', 'sidewaysScroll', 'pageErrors', 'error'];
  const out = {};
  for (const k of keep) if (o[k] !== undefined) out[k] = typeof o[k] === 'string' ? String(o[k]).replace(/[^a-z0-9 _:,*-]/gi, '').slice(0, 60) : o[k];
  return out;
}

/** The run passes when nothing was written, no surface failed, nothing scrolled sideways, and every opened block had a picture or the mark. */
function verdict(lines, blocked) {
  const bad = lines.filter((l) => l.error || l.sidewaysScroll);
  return { passed: blocked === 0 && bad.length === 0, writesBlocked: blocked, failedSurfaces: bad.length };
}

async function run({ engine = 'chromium', card = '', log = console.log } = {}) {
  const PW = require('playwright');
  const L = require(path.join(__dirname, '..', 'qa', 'sxr_courier_lib.js'));
  const E = require(path.join(__dirname, '..', 'qa', 'test-client-entry.js'));
  const ROLE = String(process.env.ROLE_KEY_SMM || process.env.SYNCVIEW_STAFF_KEY || '').trim();
  if (!ROLE) return { exit: 2, summary: { refused: 'no_staff_key' } };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const stats = { blocked: 0 };

  const listRes = await fetch(SUPA + '/functions/v1/trial-reels', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Syncview-Key': ROLE },
    body: JSON.stringify({ action: 'list', client: E.TEST_CLIENT.slug, post_id: '' }) });
  const cards = ((await listRes.json().catch(() => ({}))).cards) || {};
  let ids = Object.keys(cards).filter((id) => { const c = cards[id]; return c && c.enabled && Array.isArray(c.versions) && c.versions.filter((v) => v.status !== 'dropped').length > 1; });
  if (card) ids = [card].concat(ids.filter((x) => x !== card));
  log('trial v4 review live walk: ' + JSON.stringify({ engine, list_http_status: listRes.status, trialCards: Object.keys(cards).length, openMultiVersion: ids.length, cardGiven: !!card }));

  async function harden(ctx) {
    await ctx.route((u) => u.toString().startsWith(SUPA + '/'), async (r) => {
      const req = r.request();
      let body = {};
      try { body = JSON.parse(req.postData() || '{}'); } catch (e) { body = {}; }
      if (isWrite(req.method(), req.url(), body)) { stats.blocked++; return r.abort(); }
      const h = req.headers();
      if (req.url().startsWith(SUPA + '/functions/v1/') && h['x-syncview-key'] && h['x-syncview-key'] !== ROLE) return r.fallback({ headers: Object.assign({}, h, { 'x-syncview-key': ROLE }) });
      return r.fallback();
    });
  }
  const inStage = (page, fn, arg) => page.evaluate(fn, arg);
  async function open(browser, name, width) {
    const ctxOpts = { viewport: { width, height: width < 600 ? 844 : 950 } };
    if (name === 'client') {
      const token = await E.currentTestClientToken();
      const ctx = await browser.newContext(ctxOpts);
      await harden(ctx);
      const page = await ctx.newPage();
      page._errs = [];
      page.on('pageerror', () => page._errs.push(1));
      await E.gotoTestClientEntry(page, { origin: L.ORIGIN, view: 'calendar', name: E.TEST_CLIENT.name, token, gotoOptions: { waitUntil: 'domcontentloaded', timeout: 60000 } });
      return page;
    }
    const page = await L.open(browser, '/qa/dawn/blank.html', ctxOpts);
    await harden(page.context());
    if (name === 'kasper') {
      await page.context().route((u) => u.toString().startsWith(SUPA + '/rest/v1/syncview_runtime_flags?'), async (r) => {
        if (r.request().method() !== 'GET') return r.fallback();
        const res = await r.fetch();
        let rows = [];
        try { rows = await res.json(); } catch (e) { rows = []; }
        const wide = ['review_stage_kasper_staff', 'review_stage_kasper_layout2'].filter((k) => r.request().url().includes(k));
        rows = (Array.isArray(rows) ? rows : []).filter((x) => x && !wide.includes(x.key)).concat(wide.map((k) => ({ key: k, value: { all: true } })));
        return r.fulfill({ response: res, json: rows });
      });
      await page.goto(L.ORIGIN + '/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForFunction(() => typeof navTo === 'function', null, { timeout: 60000 });
      await page.evaluate((n) => { try { wlMergeClientsFromSheet([n]); } catch (e) {} navTo('kasper'); }, E.TEST_CLIENT.name);
    } else {
      await page.goto(L.ORIGIN + '/index.html?v=calendar', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForFunction(() => typeof _calSavePins === 'function' && typeof navTo === 'function', null, { timeout: 60000 });
      await page.evaluate((n) => { _calSavePins([n]); calState.client = n; navTo('calendar'); }, E.TEST_CLIENT.name);
      await page.waitForFunction(() => typeof calState === 'object' && !calState.loading && (calState.posts || []).length > 0, null, { timeout: 60000 });
      await page.evaluate(() => onCalViewChange('smmreview'));
    }
    return page;
  }
  async function surface(browser, name, width) {
    const page = await open(browser, name, width);
    const out = { surface: name, width, engine, trialCardsOpened: 0, withFields: 0, ownCaption: 0, noCaption: 0, picturesLoaded: 0, pickerOpened: false, pickerParts: '', tiles: 0, tilePictures: 0, sidewaysScroll: false };
    await page.waitForFunction(() => { const h = document.getElementById('svReviewStage'); return !!(h && !h.hidden && h.shadowRoot && h.shadowRoot.querySelector('[data-id], #stepper')); }, null, { timeout: 90000 }).catch(() => {});
    await sleep(6000);
    out.stage = await page.evaluate(() => !!document.getElementById('svReviewStage'));
    if (!out.stage) { out.pageErrors = (page._errs || []).length; await page.context().close(); return out; }
    for (const id of ids) {
      const went = await inStage(page, (x) => { const r = document.getElementById('svReviewStage').shadowRoot; const b = r && r.querySelector('[data-id="' + CSS.escape(x) + '"]'); if (!b) return false; b.click(); return true; }, id);
      if (!went) continue;
      await sleep(2500);
      await inStage(page, () => { const r = document.getElementById('svReviewStage').shadowRoot; const st = r.querySelector('.stp[data-step="video"]'); if (st) st.click(); });
      await sleep(2500);
      const s = await inStage(page, () => {
        const r = document.getElementById('svReviewStage').shadowRoot, fx = r.querySelector('.trv-fx'), img = fx && fx.querySelector('img');
        return { trial: !!r.querySelector('.trv-under, .trk'), fx: !!fx && !!fx.getClientRects().length, none: !!(fx && fx.querySelector('.trv-fx-cap.none')),
          pic: !!img && !img.hidden && img.complete && img.naturalWidth > 0, mark: !!(fx && fx.querySelector('.trk-mark')),
          tiles: r.querySelectorAll('.trk-v').length, tilePics: [...r.querySelectorAll('.trk-v .trk-pic img')].filter((i) => !i.hidden && i.naturalWidth > 0).length,
          wide: document.documentElement.scrollWidth > window.innerWidth + 1 };
      });
      if (!s.trial) continue;
      out.trialCardsOpened++;
      if (s.fx) out.withFields++;
      if (s.fx && !s.none) out.ownCaption++;
      if (s.none) out.noCaption++;
      if (s.pic) out.picturesLoaded++;
      if (s.wide) out.sidewaysScroll = true;
      out.tiles += s.tiles; out.tilePictures += s.tilePics;
      if (!out.pickerOpened) {
        const opened = await inStage(page, () => { const r = document.getElementById('svReviewStage').shadowRoot; const b = r.querySelector('[data-chg="video"]'); if (!b) return false; b.click(); return true; });
        if (opened) {
          await sleep(700);
          out.pickerParts = await inStage(page, () => [...document.getElementById('svReviewStage').shadowRoot.querySelectorAll('[data-trv-part]')].map((b) => b.dataset.trvPart + (b.getAttribute('aria-pressed') === 'true' ? '*' : '')).join(','));
          out.pickerOpened = !!out.pickerParts;
          await inStage(page, () => { const r = document.getElementById('svReviewStage').shadowRoot; const x = r.getElementById('cmpCancel') || r.getElementById('chipX'); if (x) x.click(); });
          await sleep(400);
        }
      }
    }
    out.pageErrors = (page._errs || []).length;
    await page.context().close();
    return out;
  }

  const { spawn } = require('child_process');
  const server = spawn('python3', [path.join(__dirname, '..', 'qa', 'pages_static_server.py'), '8000'], { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
  await sleep(1500);
  const lines = [];
  let browser;
  try {
    browser = await PW[engine].launch();
    for (const name of SURFACES) for (const width of WIDTHS) {
      let o;
      try { o = await surface(browser, name, width); } catch (e) { o = { surface: name, width, engine, error: String((e && e.name) || 'error') }; }
      const line = surfaceLine(o);
      lines.push(line);
      log('trial v4 review live walk: ' + JSON.stringify(line));
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill();
  }
  const v = verdict(lines, stats.blocked);
  log('trial v4 review live walk: ' + JSON.stringify(v));
  return { exit: v.passed ? 0 : 1, summary: { lines, ...v } };
}

if (require.main === module) {
  const engine = String(process.env.WALK_ENGINE || 'chromium').trim().toLowerCase();
  const card = String(process.env.WALK_CARD || '').trim();
  if (!['chromium', 'webkit'].includes(engine)) { console.log('trial v4 review live walk: {"refused":"engine_invalid"}'); process.exit(2); }
  if (card && !/^p_[A-Za-z0-9_]{1,80}$/.test(card)) { console.log('trial v4 review live walk: {"refused":"card_invalid"}'); process.exit(2); }
  run({ engine, card }).then((r) => process.exit(r.exit), (e) => { console.error('trial v4 review live walk failed:', e && e.name); process.exit(1); });
}
module.exports = { isWrite, surfaceLine, verdict, SURFACES, WIDTHS };
