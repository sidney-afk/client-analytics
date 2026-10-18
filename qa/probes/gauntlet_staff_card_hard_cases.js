// gauntlet_staff_card_hard_cases.js — the staff side of a Calendar card under
// the hard cases a person actually hits (session Gauntlet, 2026-10-17), on the
// test client only, against the live backend through the courier:
//
//   A. text edges: a very long caption, emoji and accented text in the name and
//      caption, an emptied caption; each one timed from blur to the save landing
//   B. fast repeated edits: three caption saves inside a second; the last wins
//   C. two tabs on one card: different fields both survive; same field, the
//      later save wins and the other tab shows it after a reload
//   D. refresh in the middle of a save: what the page said vs what the row holds
//   E. slow network (every calendar write held 4 s): the save still lands and the
//      page shows it was saving, not saved, while it waits
//   F. offline then back online: a caption typed offline reaches the row once the
//      network returns, without a second edit
//   G. the client link shows the final caption, name and date
//
// Every card is a throwaway unlinked seed (no work items), archived and
// verified at the end. Function calls carry the robot ROLE key when the runner
// has one (SYNCVIEW_ROLE_KEY), as the dawn check does. Output is check names and
// numbers only.
'use strict';
const H = require('./ot4_lib.js');
const { launch, smmCal, clientCal, archiveCalSafe, appErrs, SUPA } = H;

const C = H.counter(); const t = C.t;
const TS = Date.now();
const POLL = 40000;
const ROLE_KEY = String(process.env.SYNCVIEW_ROLE_KEY || '').trim();
const UPSERT_RE = /\/functions\/v1\/calendar-(card-write|upsert)/; // the Sheet saves through calendar-card-write
const timings = [];
const ids = [];

function seed(tag, extra) {
  const id = 'p_gnt_' + tag + '_' + TS;
  ids.push(id);
  H.upCal(Object.assign({ id, name: 'Gauntlet ' + tag + ' ' + TS, caption: 'seed', video_status: 'In Progress',
    graphic_status: 'In Progress', caption_status: 'In Progress', status: 'In Progress' }, extra || {}));
  return id;
}
const row = (id, cols) => H.rowCal(id, cols);
// ot4_lib's pollRow hands back the last row on a timeout; this one returns null.
async function until(id, cols, pred, ms, step) {
  const r = await H.pollRow(() => row(id, cols), pred, ms || POLL, step || 400);
  return r && pred(r) ? r : null;
}

async function withRoleKey(page) {
  if (!ROLE_KEY) return;
  await page.context().route(u => u.toString().startsWith(SUPA + '/functions/v1/'), (r) => {
    const h = r.request().headers();
    if (h['x-syncview-key'] && h['x-syncview-key'] !== ROLE_KEY) return r.fallback({ headers: Object.assign({}, h, { 'x-syncview-key': ROLE_KEY }) });
    return r.fallback();
  });
}
async function openSheet(browser, tag) {
  const p = await smmCal(browser);
  await withRoleKey(p);
  if (process.env.GNT_LOG) {
    p.on('request', r => { if (UPSERT_RE.test(r.url())) console.log('   ', tag || 'page', 'save sent', Object.keys((JSON.parse(r.postData() || '{}').post) || {}).join(',')); });
    p.on('response', r => { if (UPSERT_RE.test(r.url())) console.log('   ', tag || 'page', 'save answered', r.status()); });
  }
  return p;
}
async function waitCard(p, id, ms) {
  return p.waitForFunction((pid) => !!document.querySelector(`#calStrip textarea.cal-fld-cap[data-pid="${pid}"]`), id, { timeout: ms || 30000 }).then(() => true).catch(() => false);
}
// Reload and read the caption box once the card is back. A first paint can come
// from the page's saved copy; give the fresh load up to 8 s to correct it, and
// say which it was, so a slow boot is never mistaken for a wrong value.
async function reloadAndRead(p, id, want) {
  await p.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  if (!await waitCard(p, id, 45000)) return 'card not shown after reload';
  const read = () => p.evaluate((pid) => (document.querySelector(`#calStrip textarea.cal-fld-cap[data-pid="${pid}"]`) || {}).value, id);
  const first = await read();
  if (first === want) return 'ok';
  for (let i = 0; i < 16; i++) { await H.sleep(500); if (await read() === want) return 'ok after ' + ((i + 1) * 500) + ' ms (old value painted first)'; }
  return 'wrong value';
}
// Type into a field the way a person does: focus, set, input, blur.
function setField(p, id, sel, value) {
  return p.evaluate(([pid, s, v]) => {
    const el = document.querySelector(`#calStrip ${s}[data-pid="${pid}"]`) || document.querySelector(`#calStrip .cal-card[data-pid="${pid}"] ${s}`);
    if (!el) return 'no-field';
    if (el.readOnly || el.disabled) return 'readonly';
    el.focus();
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.blur();
    return 'ok';
  }, [id, sel, value]);
}
const setCaption = (p, id, v) => setField(p, id, 'textarea.cal-fld-cap', v);
const setName = (p, id, v) => setField(p, id, '.cal-fld-name', v);
// The card's save mark: 'saved' | 'error' | 'saving' | ''.
function saveMark(p, id) {
  return p.evaluate((pid) => {
    const tag = document.querySelector(`[data-saving="${pid}"]`);
    const ind = document.querySelector(`[data-sv-save-ind="${pid}"]`);
    if (tag && tag.classList.contains('is-error')) return 'error';
    if (ind && ind.classList.contains('is-saved')) return 'saved';
    if (tag && /sav/i.test(tag.textContent || '')) return 'saving:' + (tag.textContent || '').trim().slice(0, 30);
    return '';
  }, id).catch(() => 'gone');
}
// Time from now until the row matches.
async function timed(label, id, cols, pred) {
  const t0 = Date.now();
  const r = await until(id, cols, pred);
  const ms = r ? Date.now() - t0 : null;
  timings.push({ label, ms });
  return r;
}

(async () => {
  const browser = await launch();
  try {
    // ---- A. text edges -------------------------------------------------
    const A = seed('text');
    let p = await openSheet(browser);
    t(await waitCard(p, A), 'A: the seeded card is on the Sheet');
    const LONG = ('Long caption line ' + TS + ' ').repeat(240).trim(); // about 6,000 characters
    t(await setCaption(p, A, LONG) === 'ok', 'A: typed a 6,000-character caption');
    let r = await timed('caption 6000 chars', A, 'caption', x => x.caption === LONG);
    t(!!r, 'A: DB holds the whole long caption', r ? String(r.caption.length) : 'not landed');
    const EMOJI = 'Café 🎬✨ naïve 日本語 👍🏽 "quotes" & <b>tags</b> ' + TS;
    t(await setCaption(p, A, EMOJI) === 'ok', 'A: typed emoji, accents and markup');
    r = await timed('caption emoji', A, 'caption', x => x.caption === EMOJI);
    t(!!r, 'A: DB holds the emoji caption byte for byte');
    const NAME = 'Gauntlet 🎯 Été ' + TS;
    t(await setName(p, A, NAME) === 'ok', 'A: renamed with emoji');
    r = await timed('rename emoji', A, 'name', x => x.name === NAME);
    t(!!r, 'A: DB holds the emoji name');
    t(await setCaption(p, A, '') === 'ok', 'A: emptied the caption');
    r = await timed('caption emptied', A, 'caption', x => !x.caption);
    t(!!r, 'A: DB caption is empty after clearing', r ? JSON.stringify(r.caption) : 'still set');
    await H.sleep(1500);
    const markA = await saveMark(p, A);
    t(markA !== 'error' && !/^saving/.test(markA), 'A: the save mark is not stuck or red', markA);
    t(await setCaption(p, A, EMOJI) === 'ok', 'A: put the emoji caption back');
    await timed('caption restore', A, 'caption', x => x.caption === EMOJI);
    t(appErrs(p).length === 0, 'A: 0 app JS errors', appErrs(p)[0] || '');
    await p.context().close();

    // ---- B. fast repeated edits ------------------------------------------
    const B = seed('fast');
    p = await openSheet(browser);
    await waitCard(p, B);
    for (let i = 1; i <= 3; i++) { await setCaption(p, B, 'fast v' + i + ' ' + TS); await H.sleep(150); }
    r = await timed('3 fast saves, last lands', B, 'caption', x => x.caption === 'fast v3 ' + TS);
    t(!!r, 'B: three saves in under a second, the last one is in the row');
    await H.sleep(4000);
    r = row(B, 'caption');
    t(r && r.caption === 'fast v3 ' + TS, 'B: and it stays the last one (no late echo overwrites it)', r && r.caption);
    const bView = await reloadAndRead(p, B, 'fast v3 ' + TS);
    t(/^ok/.test(bView), 'B: after reload the Sheet shows the last value', bView);
    await p.context().close();

    // ---- C. two tabs on one card ----------------------------------------
    const Cc = seed('twotabs');
    const tab1 = await openSheet(browser, 'tab1');
    const tab2 = await openSheet(browser, 'tab2');
    await waitCard(tab1, Cc); await waitCard(tab2, Cc);
    t(await setCaption(tab1, Cc, 'tab one caption ' + TS) === 'ok', 'C: tab one edits the caption');
    await timed('two tabs: caption', Cc, 'caption', x => x.caption === 'tab one caption ' + TS);
    t(await setName(tab2, Cc, 'Gauntlet tab two name ' + TS) === 'ok', 'C: tab two (not reloaded) edits the name');
    r = await timed('two tabs: name', Cc, 'name,caption', x => x.name === 'Gauntlet tab two name ' + TS);
    await H.sleep(3000);
    r = row(Cc, 'name,caption');
    t(r && r.name === 'Gauntlet tab two name ' + TS && r.caption === 'tab one caption ' + TS,
      'C: both edits survive (tab two did not put back the old caption)', r && JSON.stringify({ n: r.name === 'Gauntlet tab two name ' + TS, c: r.caption === 'tab one caption ' + TS }));
    t(await setCaption(tab2, Cc, 'tab two caption ' + TS) === 'ok', 'C: tab two then edits the same caption');
    // Tab two last loaded the caption before tab one changed it. The page must
    // either save (when it already saw tab one's text) or say "Someone else
    // changed this" with Keep mine / Use theirs. It must never claim Saved and
    // drop the text.
    const conflictOrSaved = async () => {
      const rr = row(Cc, 'caption');
      if (rr && rr.caption === 'tab two caption ' + TS) return 'saved';
      const shown = await tab2.evaluate((pid) => !!document.querySelector(`[data-cal-conflict="${pid}"] [data-conflict-mine]`), Cc);
      return shown ? 'notice' : '';
    };
    let outcome = '';
    for (let i = 0; i < 40 && !outcome; i++) { outcome = await conflictOrSaved(); if (!outcome) await H.sleep(500); }
    t(!!outcome, 'C: tab two either saved or showed the "someone else changed this" notice', outcome || 'neither: silent');
    if (outcome === 'notice') {
      const k0 = Date.now();
      await tab2.click(`[data-cal-conflict="${Cc}"] [data-conflict-mine]`);
      const kept = await until(Cc, 'caption', x => x.caption === 'tab two caption ' + TS);
      timings.push({ label: 'two tabs: Keep mine', ms: kept ? Date.now() - k0 : null });
      t(!!kept, 'C: Keep mine saves tab two\'s caption');
    }
    await H.sleep(2000);
    r = row(Cc, 'caption,name');
    t(r && r.caption === 'tab two caption ' + TS && r.name === 'Gauntlet tab two name ' + TS, 'C: the row ends with tab two\'s caption and keeps the name', r && (r.caption === 'tab one caption ' + TS ? 'tab one caption' : 'ok'));
    const cView = await reloadAndRead(tab1, Cc, 'tab two caption ' + TS);
    t(/^ok/.test(cView), 'C: tab one shows tab two\'s caption after a reload', cView);
    t(appErrs(tab1).length + appErrs(tab2).length === 0, 'C: 0 app JS errors in either tab');
    await tab1.context().close(); await tab2.context().close();

    // ---- D. refresh in the middle of a save -------------------------------
    const D = seed('refresh');
    p = await openSheet(browser);
    await waitCard(p, D);
    // Hold the write 2.5 s so the reload certainly lands while it is in flight.
    await p.context().route(UPSERT_RE, async (rt) => { await H.sleep(2500); return rt.fallback(); });
    t(await setCaption(p, D, 'refresh mid save ' + TS) === 'ok', 'D: typed a caption, save in flight');
    await H.sleep(300);
    await p.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await p.context().unroute(UPSERT_RE);
    const dShown = await waitCard(p, D, 45000);
    t(dShown, 'D: the card is back after the refresh');
    await H.sleep(3000);
    const dRow = row(D, 'caption');
    const dView = await p.evaluate((pid) => ({
      text: (document.querySelector(`#calStrip textarea.cal-fld-cap[data-pid="${pid}"]`) || {}).value,
      note: !!document.querySelector(`#calStrip .cal-card[data-pid="${pid}"] [data-sv-draft-note]`)
    }), D);
    const landedD = !!(dRow && dRow.caption === 'refresh mid save ' + TS);
    // Either the save landed, or the typed text is back in the box with the
    // "Restored your unsaved text" line (drafts are never sent on their own).
    t(landedD || (dView.text === 'refresh mid save ' + TS && dView.note), 'D: after the refresh the caption is saved, or shown as restored and unsaved',
      'row=' + (landedD ? 'saved' : 'not saved') + ' box=' + (dView.text === 'refresh mid save ' + TS ? 'typed' : 'other') + ' note=' + dView.note);
    if (!landedD && dView.note) {
      // The person saves it again the ordinary way: click in, click out.
      const d0 = Date.now();
      await setCaption(p, D, 'refresh mid save ' + TS);
      const again = await until(D, 'caption', x => x.caption === 'refresh mid save ' + TS);
      timings.push({ label: 'restored caption, saved again', ms: again ? Date.now() - d0 : null });
      t(!!again, 'D: clicking in and out of the restored caption saves it');
    }
    await p.context().close();

    // ---- E. slow network -------------------------------------------------
    const E = seed('slow');
    p = await openSheet(browser);
    await waitCard(p, E);
    await p.context().route(UPSERT_RE, async (rt) => { await H.sleep(4000); return rt.fallback(); });
    const e0 = Date.now();
    t(await setCaption(p, E, 'slow network ' + TS) === 'ok', 'E: typed a caption on a 4 s network');
    await H.sleep(1200);
    const eMid = await saveMark(p, E);
    t(eMid !== 'saved', 'E: while the write is held the page does not claim Saved', eMid || '(no mark)');
    r = await until(E, 'caption', x => x.caption === 'slow network ' + TS);
    timings.push({ label: 'slow network (4 s held)', ms: r ? Date.now() - e0 : null });
    t(!!r, 'E: the save lands once the network answers');
    await H.sleep(2500);
    const eEnd = await saveMark(p, E);
    t(eEnd !== 'error' && !/^saving/.test(eEnd), 'E: the mark settles afterwards', eEnd || '(no mark)');
    await p.context().unroute(UPSERT_RE);
    await p.context().close();

    // ---- F. offline, then back online -------------------------------------
    const F = seed('offline');
    p = await openSheet(browser);
    await waitCard(p, F);
    let offline = true;
    let refused = 0;
    await p.context().route(UPSERT_RE, (rt) => { if (offline) { refused++; return rt.abort('internetdisconnected'); } return rt.fallback(); });
    await p.evaluate(() => { try { Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }); } catch (e) {} window.dispatchEvent(new Event('offline')); });
    t(await setCaption(p, F, 'typed offline ' + TS) === 'ok', 'F: typed a caption while offline');
    await H.sleep(5000);
    const fMark = await saveMark(p, F);
    t(refused > 0, 'F: the save was attempted while offline', 'attempts=' + refused);
    t(fMark !== 'saved', 'F: the page does not claim Saved while offline', fMark || '(no mark)');
    offline = false;
    const f0 = Date.now();
    await p.evaluate(() => { try { Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true }); } catch (e) {} window.dispatchEvent(new Event('online')); });
    r = await until(F, 'caption', x => x.caption === 'typed offline ' + TS, 60000, 600);
    timings.push({ label: 'offline caption, after back online', ms: r ? Date.now() - f0 : null });
    t(!!r, 'F: the offline caption reaches the row once back online, with no second edit');
    await H.sleep(2500);
    const fEnd = await saveMark(p, F);
    t(fEnd !== 'error' && !/^saving/.test(fEnd), 'F: the mark settles once back online', fEnd || '(no mark)');
    await p.context().close();

    // ---- G. the client link shows the final state ------------------------
    const cp = await clientCal(browser);
    await cp.waitForFunction(() => typeof calState === 'object' && Array.isArray(calState.posts) && calState.posts.length > 0, null, { timeout: 30000 }).catch(() => {});
    const seen = await cp.evaluate((pids) => pids.map(pid => { const x = (calState.posts || []).find(q => q && q.id === pid); return x ? { name: x.name, caption: x.caption } : null; }), [A, Cc]);
    t(seen[0] && seen[0].name === NAME && seen[0].caption === EMOJI, 'G: the client link has the emoji name and caption', seen[0] ? 'name=' + (seen[0].name === NAME) + ' cap=' + (seen[0].caption === EMOJI) : 'card not on the link');
    t(seen[1] && seen[1].caption === 'tab two caption ' + TS, 'G: the client link has the two-tab final caption', seen[1] ? 'cap=' + (seen[1].caption === 'tab two caption ' + TS) : 'card not on the link');
    t(appErrs(cp).length === 0, 'G: 0 app JS errors on the client link', appErrs(cp)[0] || '');
    await cp.context().close();
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
