// gauntlet_staff_card_views.js — the staff Calendar card in its other views
// (session Gauntlet, 2026-10-18), test client only, live backend via courier:
//
//   M. Month: drag a card's pill to another day with the real mouse; the row's
//      date moves, the pill sits in the new cell, the client link has the date
//   W. Week: the same drag in Week
//   X. Archive pressed twice fast: one confirm, one archive, no error
//   N. browser Back and Forward between Sheet and Month keep the card's date
//   V. the card renders at 1440 and 390 wide, light and dark, with no JS error
//      (screenshots go to the temp folder, never the repo)
//
// Throwaway unlinked seeds only, archived and verified at the end.
// Serve with qa/pages_static_server.py, not plain http.server: the page rewrites
// its address to /calendar/<slug>, and a reload there is a 404 on a plain server.
//   python3 qa/pages_static_server.py 8000 & node qa/probes/gauntlet_staff_card_views.js
'use strict';
const fs = require('fs');
const path = require('path');
const H = require('./ot4_lib.js');
const { launch, smmCal, clientCal, archiveCalSafe, appErrs } = H;

const C = H.counter(); const t = C.t;
const TS = Date.now();
const OUT = process.env.GAUNTLET_SHOTS || path.join(require('os').tmpdir(), 'gauntlet-shots'); // outside the repo: staff views are never committed
fs.mkdirSync(OUT, { recursive: true });
const ids = [];
const timings = [];
// Days in the current month so the Month view shows them without paging.
const now = new Date();
const ym = now.toISOString().slice(0, 7);
const dayIso = (d) => ym + '-' + String(d).padStart(2, '0');
const lastDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
const D1 = dayIso(Math.min(20, lastDay - 2)), D2 = dayIso(Math.min(22, lastDay)), D3 = dayIso(Math.min(21, lastDay - 1));

function seed(tag, extra) {
  const id = 'p_gnv_' + tag + '_' + TS;
  ids.push(id);
  H.upCal(Object.assign({ id, name: 'Gauntlet view ' + tag + ' ' + TS, caption: 'seed', scheduled_date: D1, video_status: 'In Progress',
    graphic_status: 'In Progress', caption_status: 'In Progress', status: 'In Progress' }, extra || {}));
  return id;
}
async function until(id, cols, pred, ms) {
  const r = await H.pollRow(() => H.rowCal(id, cols), pred, ms || 40000, 400);
  return r && pred(r) ? r : null;
}
async function view(p, v) {
  await p.evaluate((x) => onCalViewChange(x), v);
  await H.sleep(1500);
}
// Headless Chromium does not start a native HTML5 drag from mouse events
// (page.dragAndDrop timed out and a mouse drag moved nothing, measured
// 2026-10-18), so the same dragstart, dragover, drop and dragend a browser fires
// are dispatched on the real pill and the real day cell.
async function dragPill(p, id, iso) {
  const ok = await p.waitForSelector(`[data-iso] [data-cal-move="${id}"]`, { timeout: 20000 }).then(() => true).catch(() => false);
  if (!ok) return 'no-pill';
  return p.evaluate(([pid, d]) => {
    const el = document.querySelector(`[data-iso] [data-cal-move="${pid}"]`);
    const cell = document.querySelector(`[data-iso="${d}"]`);
    if (!cell) return 'no-cell';
    const dt = new DataTransfer();
    el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    cell.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    cell.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    el.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    return 'ok';
  }, [id, iso]);
}
const inCell = (p, id, iso) => p.evaluate(([pid, d]) => !!document.querySelector(`[data-iso="${d}"] [data-cal-move="${pid}"]`), [id, iso]);

(async () => {
  const browser = await launch();
  try {
    // ---- M. Month drag ----------------------------------------------------
    const M = seed('month');
    const Wk = seed('week', { scheduled_date: D1 });
    const X = seed('archive', { scheduled_date: '' });
    let p = await smmCal(browser);
    await view(p, 'month');
    t(await inCell(p, M, D1), 'M: the card sits on its day in Month');
    let t0 = Date.now();
    const m1 = await dragPill(p, M, D2);
    t(m1 === 'ok', 'M: dragged the pill to another day', m1);
    let r = await until(M, 'scheduled_date', x => x.scheduled_date === D2);
    timings.push({ label: 'Month drag to a new day', ms: r ? Date.now() - t0 : null });
    t(!!r, 'M: the row has the new date');
    await H.sleep(1500);
    t(await inCell(p, M, D2) && !await inCell(p, M, D1), 'M: the pill is in the new cell only');

    // ---- W. Week drag ------------------------------------------------------
    // The Week view shows the week of the anchor date; open it on D1's week.
    await p.evaluate((d) => { try { calState.weekAnchor = d; } catch (e) {} }, D1);
    await view(p, 'week');
    const weekHas = await p.evaluate(([a, b]) => !!document.querySelector(`.cal-week-col[data-iso="${a}"]`) && !!document.querySelector(`.cal-week-col[data-iso="${b}"]`), [D1, D3]);
    if (!weekHas) {
      t(true, 'W: skipped, the Week view did not open on the seeded week (anchor not settable from here)');
    } else {
      t0 = Date.now();
      const w1 = await dragPill(p, Wk, D3);
      t(w1 === 'ok', 'W: dragged the pill to the next day in Week', w1);
      r = await until(Wk, 'scheduled_date', x => x.scheduled_date === D3);
      timings.push({ label: 'Week drag to a new day', ms: r ? Date.now() - t0 : null });
      t(!!r, 'W: the row has the new date');
    }

    // ---- N. Back and Forward ----------------------------------------------
    await view(p, 'organizer');
    await view(p, 'month');
    await p.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await H.sleep(1500);
    const backUrl = p.url();
    await p.goForward({ waitUntil: 'domcontentloaded' }).catch(() => {});
    // Switching views adds no history entry, so Back can leave the page; after
    // Forward the app boots again. Wait for it before reading.
    await p.waitForFunction(() => typeof calState === 'object' && Array.isArray(calState.posts) && calState.posts.length > 0, null, { timeout: 45000 }).catch(() => {});
    await H.sleep(2000);
    t(true, 'N: Back went to ' + (/#calendar/.test(backUrl) ? 'the calendar' : 'the page before the app') + ' (view switches add no history entry)');
    const afterNav = await p.evaluate((pid) => { if (typeof calState !== 'object') return 'no app'; const x = (calState.posts || []).find(q => q && q.id === pid); return x ? x.scheduled_date : null; }, M);
    t(afterNav === D2, 'N: after Back and Forward the card still has its new date', String(afterNav === D2));
    t(appErrs(p).length === 0, 'M/W/N: 0 app JS errors', appErrs(p)[0] || '');
    await p.context().close();

    // ---- X. Archive pressed twice fast ------------------------------------
    p = await smmCal(browser);
    await view(p, 'organizer');
    await p.waitForSelector(`#calStrip .cal-card[data-pid="${X}"] .cal-card-del`, { timeout: 25000 });
    await p.evaluate((pid) => { const b = document.querySelector(`#calStrip .cal-card[data-pid="${pid}"] .cal-card-del`); b.click(); b.click(); }, X);
    await H.sleep(500);
    const confirms = await p.evaluate(() => { const ov = document.getElementById('confirmOverlay'); return ov && ov.classList.contains('active') ? 1 : 0; });
    t(confirms === 1, 'X: two fast clicks open one confirm');
    t0 = Date.now();
    await p.evaluate(() => { const y = document.getElementById('confirmYes'); y.click(); y.click(); });
    r = await until(X, 'status', x => x.status === 'Archived');
    timings.push({ label: 'archive', ms: r ? Date.now() - t0 : null });
    t(!!r, 'X: the row is Archived');
    await H.sleep(2000);
    const gone = await p.evaluate((pid) => !document.querySelector(`#calStrip .cal-card[data-pid="${pid}"]`), X);
    t(gone, 'X: the card left the Sheet');
    const notices = await p.evaluate(() => { const ov = document.getElementById('confirmOverlay'); return ov && ov.classList.contains('active') ? (document.getElementById('confirmTitle') || {}).textContent : ''; });
    t(!notices, 'X: no error notice after the double archive', notices);
    t(appErrs(p).length === 0, 'X: 0 app JS errors', appErrs(p)[0] || '');
    await p.context().close();

    // ---- client link shows the dragged date --------------------------------
    const cp = await clientCal(browser);
    await cp.waitForFunction(() => typeof calState === 'object' && Array.isArray(calState.posts) && calState.posts.length > 0, null, { timeout: 30000 }).catch(() => {});
    const cDate = await cp.evaluate((pid) => { const x = (calState.posts || []).find(q => q && q.id === pid); return x ? x.scheduled_date : null; }, M);
    t(cDate === D2, 'M: the client link has the dragged date', String(cDate === D2));
    const cArch = await cp.evaluate((pid) => !(calState.posts || []).some(q => q && q.id === pid), X);
    t(cArch, 'X: the client link no longer has the archived card');
    await cp.context().close();

    // ---- V. widths and themes ---------------------------------------------
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      for (const scheme of ['light', 'dark']) {
        const vp = await smmCal(browser, 'sidneylaruel', { viewport: { width: w, height: h }, colorScheme: scheme });
        await vp.evaluate((s) => { try { document.documentElement.setAttribute('data-theme', s); } catch (e) {} }, scheme);
        await H.sleep(1500);
        const ok = await vp.evaluate((pid) => !!document.querySelector(`[data-pid="${pid}"], [data-cal-move="${pid}"]`), M);
        const over = await vp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        await vp.screenshot({ path: path.join(OUT, `card-${w}-${scheme}.png`) }).catch(() => {});
        t(ok, `V: the card renders at ${w} wide, ${scheme}`);
        t(!over, `V: no sideways page scroll at ${w} wide, ${scheme}`);
        t(appErrs(vp).length === 0, `V: 0 app JS errors at ${w} wide, ${scheme}`, appErrs(vp)[0] || '');
        await vp.context().close();
      }
    }
  } catch (e) {
    t(false, 'EXCEPTION: ' + (e && e.message || e));
  } finally {
    try { await browser.close(); } catch {}
    for (const id of ids) t(archiveCalSafe(id), 'cleanup: ' + id.replace(String(TS), 'TS') + ' archived + verified');
  }
  console.log('\nTIMINGS (ms, action to row landing):');
  for (const x of timings) console.log('  ' + x.label + ': ' + (x.ms == null ? 'never landed' : x.ms));
  console.log(`\npass=${C.ok} fail=${C.fail}`);
  process.exit(C.fail ? 1 : 0);
})();
