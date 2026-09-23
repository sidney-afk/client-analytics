// dawn-check.js — the weekday MORNING CHECK (skill: /dawn-check).
//
// Walks the seven flows that matter most, in a real Chromium against the LIVE
// backend, on the TEST client `sidneylaruel` only, and writes a short
// plain-English report with a screenshot per failure and timings against
// docs/audits/2026-09-23-speed-map.md.
//
//   1 client approve          (clean client context, lands on the Review tab)
//   2 client request changes  (clean client context)
//   3 staff card save         ("Saved, syncing" → saved, or straight to saved)
//   4 card rename             (linked sub-issue title follows, then restored)
//   5 Workload open time      6 SyncLinear first rows   7 Analytics first numbers
//
// Reuse, not rebuild: contexts, Linear mocking, the client-entry token and the
// archive-and-verify cleanup all come from qa/sxr_courier_lib.js via
// qa/probes/ot4_lib.js; the client clicks are the real buttons (H.clientAct).
//
// Safety (docs/testing/HEADLESS-TESTING-GUIDE.md §5):
//   - Every write targets sidneylaruel. A page-level guard ABORTS any POST whose
//     body names another client and fails the run.
//   - Seeds are archived and verified; the renamed card and its sub-issue are
//     renamed back and verified. Nothing is left changed.
//   - Linear is mocked by the courier context in every flow. The rename uses a
//     card whose sub-issue has NO Linear mirror.
//   - Client flows act on the CAPTION: it has no native work item, so a seeded
//     card can take the write (a video approval needs a native deliverable,
//     which a disposable seed cannot have: native_link_required).
//
// Needs SYNCVIEW_STAFF_KEY in the environment (staff writes + the client link).
// Exit code: 0 all passed (slow timings are warnings), 1 any flow failed.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { D, buildReport } = require('./dawn-report.js');
const H = require('../probes/ot4_lib.js');
const { launch, open, smmCal, clientCal, upCal, archiveCalSafe, appErrs, SUPA, KEY, ORIGIN } = H;

const TEST_SLUG = 'sidneylaruel';
const OUT = path.join(__dirname, 'out');
const TS = Date.now();
const POLL = 35000;
const SLOW_FACTOR = 1.5;   // slower than 1.5x the speed-map cold median = "slow" warning
const TAB_CAP = 30000;     // not rendered in 30 s = failed
// Cold medians from docs/audits/2026-09-23-speed-map.md §2 (each check opens a
// fresh browser context, so cold is the honest comparison; warm is shown too).
const BASELINE = {
  workload:   { cold: 7510, warm: 6008 },
  synclinear: { cold: 4370, warm: 2822 },
  analytics:  { cold: 5928, warm: 5116 },
  calendar:   { cold: 2485, warm: 801 },
};

fs.mkdirSync(OUT, { recursive: true });
const results = [];
const violations = [];
function record(key, r) { results.push(Object.assign({ key }, r)); }

// ---- the other-client write guard -----------------------------------------
async function guard(page) {
  await page.route('**/*', (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      const body = req.postData() || '';
      const m = body.match(/"(?:client|client_slug|slug)"\s*:\s*"([^"]*)"/g) || [];
      const bad = m.map(s => s.split(':').pop().replace(/[\s"]/g, '').toLowerCase())
        .filter(v => v && v !== TEST_SLUG && v !== 'sidney laruel' && v !== 'sidneylaruel');
      if (bad.length) { violations.push(req.url().split('?')[0]); return route.abort(); }
    }
    return route.fallback();
  });
}
// Screenshots. Only the CLIENT-LINK flows may be published (that surface shows the
// test client alone); every staff view can show other clients, so its shots stay
// on the runner and are never uploaded. out/public/ is the only uploaded folder.
async function shot(page, key, publishable = false) {
  const dir = publishable ? path.join(OUT, 'public') : OUT;
  fs.mkdirSync(dir, { recursive: true });
  try { await page.screenshot({ path: path.join(dir, key + '.png'), fullPage: false }); return publishable ? 'attached' : 'runner'; } catch { return null; }
}
const rowCal = (id, cols) => H.rowCal(id, cols);
async function deliverableTitle(id) {
  const r = await fetch(`${SUPA}/rest/v1/deliverables?id=eq.${encodeURIComponent(id)}&select=title`, { headers: { apikey: KEY, authorization: 'Bearer ' + KEY } });
  const j = await r.json(); return (j[0] || {}).title || null;
}
async function actRetry(p, name, comp, kind, text) {
  for (let i = 0; i < 12; i++) { const r = await H.clientAct(p, name, comp, kind, text); if (r !== 'disabled') return r; await H.sleep(1000); }
  return 'disabled';
}
function seedReviewCard(id, name, captionStatus = 'Client Approval') {
  upCal({ id, name, platforms: 'youtube', scheduled_date: new Date(Date.now() + 86400e3).toISOString().slice(0, 10),
    video_status: 'Approved', graphic_status: 'Approved', caption_status: captionStatus, status: captionStatus === 'Client Approval' ? 'Client Approval' : 'In Progress',
    caption: 'Dawn check caption under review',
    thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', asset_url: 'https://example.com/dawn.mp4' });
}

// ---- flows 1 + 2: the client link -----------------------------------------
async function clientFlows(browser, seeds) {
  const A = seeds.approve, R = seeds.request;
  const t0 = Date.now();
  const p = await clientCal(browser);
  await guard(p);
  const landed = await p.waitForFunction(() => !!document.querySelector('.cal-review-card'), null, { timeout: TAB_CAP }).then(() => Date.now() - t0).catch(() => null);
  const onReview = await p.evaluate(() => {
    const active = document.querySelector('.cal-view-btn.active, .cal-tab.active, [aria-selected="true"]');
    return { cards: document.querySelectorAll('.cal-review-card').length, active: active ? active.textContent.trim().slice(0, 30) : '' };
  });
  // 1 approve
  try {
    await H.expandReview(p, A.name);
    const clicked = await actRetry(p, A.name, 'caption', 'approve');
    const t1 = Date.now();
    const row = clicked === 'ok' ? await H.pollRow(() => rowCal(A.id, 'caption_status,client_caption_approved_at'), r => r.caption_status === 'Approved' && !!r.client_caption_approved_at, POLL) : null;
    // Read again after a pause: an approval that lands and is then reverted is a failure.
    await H.sleep(4000);
    const held = row ? rowCal(A.id, 'caption_status') : null;
    const ok = clicked === 'ok' && !!row && !!held && held.caption_status === 'Approved';
    record('client-approve', { ok, ms: ok ? Date.now() - t1 : null,
      detail: ok ? D.approveOk(landed || 0, onReview.cards) : D.failedAt(landed == null ? 'landing' : clicked !== 'ok' ? 'click' : !row ? 'save' : 'hold'),
      shot: ok ? null : await shot(p, 'client-approve', true) });
  } catch (e) { record('client-approve', { ok: false, detail: D.failedAt('error'), shot: await shot(p, 'client-approve', true) }); }
  // 2 request changes
  try {
    const txt = 'Dawn check: please adjust ' + TS;
    await H.expandReview(p, R.name);
    const clicked = await actRetry(p, R.name, 'caption', 'request', txt);
    const t1 = Date.now();
    const row = clicked === 'ok' ? await H.pollRow(() => rowCal(R.id, 'caption_status,caption_tweaks'), r => r.caption_status === 'Tweaks Needed', POLL) : null;
    const ok = clicked === 'ok' && !!row && JSON.stringify(row.caption_tweaks || '').includes(txt);
    record('client-request', { ok, ms: ok ? Date.now() - t1 : null,
      detail: ok ? D.requestOk() : D.failedAt(clicked !== 'ok' ? 'click' : 'save'),
      shot: ok ? null : await shot(p, 'client-request', true) });
  } catch (e) { record('client-request', { ok: false, detail: D.failedAt('error'), shot: await shot(p, 'client-request', true) }); }
  const errs = appErrs(p);
  if (errs.length) record('client-errors', { ok: false, detail: D.appErrors(errs.length), shot: await shot(p, 'client-errors', true) });
  await p.context().close();
  return landed;
}

// ---- flows 3 + 4: staff calendar ------------------------------------------
async function staffFlows(browser, seeds, renameTarget) {
  const t0 = Date.now();
  const p = await smmCal(browser, TEST_SLUG);
  await guard(p);
  const calMs = await p.waitForFunction(() => !!document.querySelector('#calView .cal-card, #calStrip .cal-card'), null, { timeout: TAB_CAP }).then(() => Date.now() - t0).catch(() => null);
  // 3 save
  const S = seeds.save;
  try {
    await p.waitForFunction((pid) => !!document.querySelector(`#calStrip textarea.cal-fld-cap[data-pid="${pid}"]`), S.id, { timeout: 25000 });
    await p.evaluate((pid) => {
      window.__dawnSave = { syncingAt: null, savedAt: null, errorAt: null, t0: 0 };
      const d = window.__dawnSave;
      const look = () => {
        const tag = document.querySelector(`[data-saving="${pid}"]`);
        const ind = document.querySelector(`[data-sv-save-ind="${pid}"]`);
        const now = performance.now();
        if (tag && /Saved, syncing/.test(tag.textContent) && !d.syncingAt) d.syncingAt = now;
        if (((ind && ind.classList.contains('is-saved')) || (d.syncingAt && tag && !/syncing/.test(tag.textContent))) && !d.savedAt) d.savedAt = now;
        if (tag && tag.classList.contains('is-error') && !d.errorAt) d.errorAt = now;
      };
      new MutationObserver(look).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    }, S.id);
    const cap = 'Dawn check caption ' + TS;
    await p.evaluate(([pid, txt]) => {
      const ta = document.querySelector(`#calStrip textarea.cal-fld-cap[data-pid="${pid}"]`);
      window.__dawnSave.t0 = performance.now();
      ta.focus(); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, txt);
      ta.dispatchEvent(new Event('input', { bubbles: true })); ta.blur();
    }, [S.id, cap]);
    const row = await H.pollRow(() => rowCal(S.id, 'caption'), r => r.caption === cap, POLL);
    await p.waitForFunction(() => window.__dawnSave.savedAt || window.__dawnSave.errorAt, null, { timeout: 20000 }).catch(() => {});
    const d = await p.evaluate(() => window.__dawnSave);
    const rel = (x) => x ? Math.round(x - d.t0) : null;
    const ok = !!row && !!d.savedAt && !d.errorAt;
    record('staff-save', { ok, ms: rel(d.savedAt),
      detail: ok ? D.saveOk(rel(d.syncingAt), rel(d.savedAt))
                 : D.failedAt(!row ? 'save' : d.errorAt ? 'save-error' : d.syncingAt ? 'syncing-stuck' : 'saved-mark'),
      shot: ok ? null : await shot(p, 'staff-save') });
  } catch (e) { record('staff-save', { ok: false, detail: D.failedAt('error'), shot: await shot(p, 'staff-save') }); }
  // 4 rename (and restore)
  if (!renameTarget) record('rename', { ok: false, detail: D.noTarget() });
  else {
    const { id, name, deliverableId } = renameTarget;
    const renamed = (name + ' · dawn').slice(0, 150);
    const setName = (to) => p.evaluate(([pid, v]) => {
      const inp = document.querySelector(`#calStrip .cal-card[data-pid="${pid}"] .cal-fld-name`);
      if (!inp) return 'no-name-field';
      inp.focus(); inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.blur(); return 'ok';
    }, [id, to]);
    try {
      await p.waitForFunction((pid) => !!document.querySelector(`#calStrip .cal-card[data-pid="${pid}"] .cal-fld-name`), id, { timeout: 25000 });
      const t1 = Date.now();
      const c1 = await setName(renamed);
      const card = await H.pollRow(() => rowCal(id, 'name'), r => r.name === renamed, POLL);
      const sub = await pollAsync(async () => (await deliverableTitle(deliverableId)) || '', t => t.includes(renamed), 60000);
      const ok = c1 === 'ok' && !!card && !!sub;
      record('rename', { ok, ms: ok ? Date.now() - t1 : null,
        detail: ok ? D.renameOk() : D.failedAt(c1 !== 'ok' ? 'field' : !card ? 'card' : 'sub-issue'),
        shot: ok ? null : await shot(p, 'rename') });
    } catch (e) { record('rename', { ok: false, detail: D.failedAt('error'), shot: await shot(p, 'rename') }); }
  }
  const errs = appErrs(p);
  if (errs.length) record('staff-errors', { ok: false, detail: D.appErrors(errs.length), shot: await shot(p, 'staff-errors') });
  await p.context().close();
  return calMs;
}
async function pollAsync(fn, pred, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const v = await fn(); if (pred(v)) return v; } catch {} await H.sleep(1200); }
  return null;
}
// Put the rename back: through the same staff UI first, REST-verified; both sides.
async function restoreRename(browser, t) {
  const cardOk = async () => ((rowCal(t.id, 'name') || {}).name === t.name);
  const subOk = async () => { const x = (await deliverableTitle(t.deliverableId)) || ''; return x === t.originalTitle || (x.includes(t.name) && !x.includes(' · dawn')); };
  if (await cardOk() && await subOk()) return { ok: true };
  const p = await smmCal(browser, TEST_SLUG);
  await guard(p);
  await p.waitForFunction((pid) => !!document.querySelector(`#calStrip .cal-card[data-pid="${pid}"] .cal-fld-name`), t.id, { timeout: 25000 }).catch(() => {});
  await p.evaluate(([pid, v]) => {
    const inp = document.querySelector(`#calStrip .cal-card[data-pid="${pid}"] .cal-fld-name`);
    if (inp) { inp.focus(); inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.blur(); }
  }, [t.id, t.name]);
  const c = await pollAsync(cardOk, Boolean, POLL);
  const s = await pollAsync(subOk, Boolean, 120000);
  await p.context().close();
  return { ok: !!c && !!s, card: !!c, sub: !!s };
}

// ---- flows 5-7: tab timings ------------------------------------------------
// READ-ONLY tabs use the courier staff context (Linear mocked, key-verify
// stubbed). One addition: the app signs its function calls with the harness's
// STUB staff key, and the courier only adds the real key when none is present,
// so a read-gated function (Workload's workload-plan) answers 401 and the app
// falls back to the sign-in screen. Here the stub is swapped for the real key on
// Supabase function calls only -- the same credential the courier already
// attaches to staff writes. The context is set up on an empty page so the timed
// navigation starts clean.
// SYNCVIEW_ROLE_KEY (optional): a staff ROLE key. The repo's SYNCVIEW_STAFF_KEY
// is accepted by the calendar writers but not by role-gated reads such as
// workload-plan (401), so Workload can only be timed when a role key is set.
const ROLE_KEY = String(process.env.SYNCVIEW_ROLE_KEY || process.env.SYNCVIEW_STAFF_KEY || '').trim();
const HAS_ROLE_KEY = !!String(process.env.SYNCVIEW_ROLE_KEY || '').trim();
async function readOnlyPage(browser, route) {
  const page = await open(browser, '/qa/dawn/blank.html');
  await page.context().route(u => u.toString().startsWith(SUPA + '/functions/v1/'), (r) => {
    const h = r.request().headers();
    if (h['x-syncview-key'] && h['x-syncview-key'] !== ROLE_KEY) return r.fallback({ headers: Object.assign({}, h, { 'x-syncview-key': ROLE_KEY }) });
    return r.fallback();
  });
  await guard(page);
  page._failed = [];
  // Kept as {status, fn}: only the HTTP status (or 'network') reaches the report.
  page.on('requestfailed', () => page._failed.push({ status: 'network', fn: false }));
  page.on('response', r => { if (r.status() >= 400) page._failed.push({ status: r.status(), fn: r.url().startsWith(SUPA + '/functions/v1/') }); });
  page._t0 = Date.now();   // the clock starts at the timed navigation
  await page.goto(ORIGIN + route, { waitUntil: 'domcontentloaded', timeout: 45000 });
  return page;
}
async function timeTab(browser, key, route, readyFn) {
  const p = await readOnlyPage(browser, route);
  const ms = await p.waitForFunction(readyFn, null, { timeout: TAB_CAP, polling: 50 }).then(() => Date.now() - p._t0).catch(() => null);
  const b = BASELINE[key];
  // A 401 from a role-gated read with no role key configured is a credential
  // gap in this harness, not an app failure: report it as blocked, loudly.
  if (ms === null && !HAS_ROLE_KEY && p._failed.some(f => f.status === 401 && f.fn)) {
    record(key, { ok: true, blocked: true, ms: null, detail: D.tabBlocked() });
    await p.context().close();
    return;
  }
  const ok = ms !== null;
  const slow = ok && ms > b.cold * SLOW_FACTOR;
  record(key, { ok, slow, ms,
    detail: !ok ? D.tabNever(TAB_CAP / 1000, [...new Set(p._failed.map(f => f.status))].slice(0, 4)) : slow ? D.tabSlow(ms, b.cold) : D.tabOk(ms, b.cold),
    shot: (!ok || slow) ? await shot(p, key) : null });
  await p.context().close();
}

// ---- main ------------------------------------------------------------------
function findRenameTarget() {
  const rows = H.supaCal(`client=eq.${TEST_SLUG}&status=neq.Archived&video_deliverable_id=not.is.null&select=id,name,video_deliverable_id&order=id`) || [];
  return (async () => {
    for (const r of rows) {
      const q = await fetch(`${SUPA}/rest/v1/deliverables?id=eq.${r.video_deliverable_id}&select=title,card_id,linear_issue_uuid`, { headers: { apikey: KEY, authorization: 'Bearer ' + KEY } });
      const d = (await q.json())[0];
      if (d && d.card_id === r.id && !d.linear_issue_uuid && d.title && d.title.includes(r.name) && !/ · dawn$/.test(r.name))
        return { id: r.id, name: r.name, deliverableId: r.video_deliverable_id, originalTitle: d.title };
    }
    return null;
  })();
}

function report(started, calMs) {
  const { md, safe } = buildReport({ started, results, violations: violations.length, calMs, baseline: BASELINE });
  if (!safe) console.error('dawn-check: report withheld, it failed the public allowlist');
  fs.writeFileSync(path.join(OUT, 'DAWN_REPORT.md'), md);
  return { md, safe };
}

(async () => {
  if (!String(process.env.SYNCVIEW_STAFF_KEY || '').trim()) {
    console.error('dawn-check: SYNCVIEW_STAFF_KEY is not set (staff writes and the client link need it).');
    process.exit(2);
  }
  const started = Date.now();
  const server = process.env.DAWN_NO_SERVER === '1' ? null
    : spawn(process.platform === 'win32' ? 'python' : 'python3', ['-m', 'http.server', '8000'], { cwd: path.join(__dirname, '..', '..'), stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const seeds = {
    approve: { id: `p_dawn_a_${TS}`, name: `Dawn approve ${TS}` },
    request: { id: `p_dawn_r_${TS}`, name: `Dawn request ${TS}` },
    save:    { id: `p_dawn_s_${TS}`, name: `Dawn save ${TS}` },
  };
  const renameTarget = await findRenameTarget().catch(() => null);
  const browser = await launch();
  let calMs = null;
  try {
    seedReviewCard(seeds.approve.id, seeds.approve.name);
    seedReviewCard(seeds.request.id, seeds.request.name);
    seedReviewCard(seeds.save.id, seeds.save.name, 'In Progress');
    for (const s of Object.values(seeds)) await H.pollRow(() => rowCal(s.id, 'id'), r => !!r.id, POLL);
    await clientFlows(browser, seeds);
    calMs = await staffFlows(browser, seeds, renameTarget);
    await timeTab(browser, 'workload', '/index.html#workload', () => !!document.querySelector('.workload-plan-item-content'));
    await timeTab(browser, 'synclinear', '/index.html?prod=1', () => !!document.querySelector('#prodRoot .prod-row'));
    await timeTab(browser, 'analytics', '/index.html#home',
      () => [...document.querySelectorAll('.cell-inner')].some(c => !c.querySelector('.sv-skeleton') && /\d/.test(c.textContent)));
  } catch (e) {
    // The message can quote card text; the public log gets the error class only.
    console.error('dawn-check: harness stopped early (' + ((e && e.name) || 'Error') + ')');
    record('harness', { ok: false, detail: D.harness() });
  } finally {
    const bad = [];
    for (const s of Object.values(seeds)) if (!archiveCalSafe(s.id)) bad.push(s.id);
    let rr = { ok: true };
    if (renameTarget) { try { rr = await restoreRename(browser, renameTarget); } catch (e) { rr = { ok: false }; } }
    try { await browser.close(); } catch {}
    if (server) server.kill();
    record('cleanup', { ok: !bad.length && rr.ok && !violations.length,
      detail: D.cleanup(Object.keys(seeds).length - bad.length, Object.keys(seeds).length, !!renameTarget, rr.card !== false, rr.sub !== false, violations.length) });
  }
  const { md, safe } = report(started, calMs);
  console.log(md);
  process.exit(!safe || results.some(r => !r.ok) ? 1 : 0);
})();
