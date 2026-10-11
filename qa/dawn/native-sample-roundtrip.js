// native-sample-roundtrip.js — the client Samples approve, done the only honest
// way: on a test-client sample that has REAL SyncView work items behind it.
//
// Why not a throwaway seed: a client decision on a sample part changes that
// part's work item, and a part with none is refused (`native_link_required`,
// measured on the dawn check 2026-10-09). Calendar flows dodge this by using the
// caption, which has no work item; samples have no caption. So:
//
//   1. staff signs in through the real sign-in card (role key + roster name) and
//      sends the sample's thumbnail to the client from the real Samples sheet;
//   2. the client approves it on the Samples link, with the real button;
//   3. staff puts the thumbnail back where it was, from the same sheet.
//
// Every write goes through the app, so the work item and the sample move
// together (never raw SQL on a linked card: OPEN_REPAIRS 373). Only the TEST
// client's one native sample is touched. Returns fixed words and numbers only.
'use strict';
const H = require('../probes/ot4_lib.js');

const TEST_SLUG = 'sidneylaruel';
const POLL = 35000;

// The test client's sample whose thumbnail has a real work item (newest first).
function findNativeSample() {
  const rows = H.supa(`client=eq.${TEST_SLUG}&status=neq.Archived&graphic_deliverable_id=not.is.null&select=id,name,graphic_status&order=updated_at.desc&limit=1`) || [];
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function staffSignIn(browser, origin, roleKey, actor) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  p._errs = []; p.on('pageerror', () => p._errs.push(1));
  await p.goto(origin + '/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForSelector('#staffIdentityMemberBtn', { timeout: 30000 });
  await p.click('#staffIdentityMemberBtn');
  const picked = await p.evaluate((who) => {
    const o = [...document.querySelectorAll('.cc-select-option')].find(b => b.textContent.trim() === who);
    if (!o) return false; o.click(); return true;
  }, actor);
  await p.fill('#staffIdentityKey', roleKey);
  await p.click('#staffIdentitySubmit');
  const ok = picked && await p.waitForFunction(() => { const g = document.getElementById('staffGateOverlay'); return !g || g.hidden || getComputedStyle(g).display === 'none'; }, null, { timeout: 30000 }).then(() => true).catch(() => false);
  return { ok, picked, page: p, ctx };
}

async function setPartFromSheet(page, origin, id, comp, status) {
  if (!/#sample-reviews\//.test(page.url())) {
    await page.goto(origin + '/?sxr=1#sample-reviews/' + TEST_SLUG, { waitUntil: 'domcontentloaded', timeout: 45000 });
  }
  await page.waitForFunction(() => typeof loadSxrCards === 'function', null, { timeout: 30000 }).catch(() => {});
  await page.evaluate(() => { const b = document.querySelector('#sxrView .cal-view-btn[data-cal-view="organizer"]'); if (b) b.click(); if (typeof loadSxrCards === 'function') loadSxrCards({ skipCache: true }); });
  await page.waitForFunction((cid) => !!document.querySelector(`[data-substatus-pid="${cid}"] .cal-fld-substatus-trigger`), id, { timeout: 30000 }).catch(() => {});
  await H.sleep(1500);
  return page.evaluate((args) => {
    const [cid, comp, status] = args;
    const wrap = document.querySelector(`[data-substatus-pid="${cid}"][data-substatus-comp="${comp}"]`);
    const trig = wrap && wrap.querySelector('.cal-fld-substatus-trigger'); if (!trig) return 'no-trigger';
    if (wrap.getAttribute('data-val') === status) return 'ok';
    trig.click();
    const items = [...document.querySelectorAll('.cal-fld-status-menu .cal-fld-status-item')];
    const item = items.find(i => ((i.getAttribute('onclick') || '').includes("'" + status + "'")));
    if (!item) return 'no-item'; item.click(); return 'ok';
  }, [id, comp, status]);
}

// openClient(page): navigates a fresh page to the test client's Samples link.
// Returns { ok, step, landedMs, cards, ms, restored, staffErrors, clientErrors }.
async function nativeSampleRoundTrip({ browser, origin, openClient, roleKey, actor, guard, shot }) {
  const out = { ok: false, step: 'target', thumb: { imgs: 0, drawn: 0 }, landedMs: null, cards: 0, ms: null, restored: false, staffErrors: 0, clientErrors: 0 };
  const S = findNativeSample();
  if (!S) return out;
  const before = S.graphic_status;
  const staff = await staffSignIn(browser, origin, roleKey, actor);
  if (guard) await guard(staff.page);
  try {
    if (!staff.ok) { out.step = 'sign-in'; return out; }
    out.step = 'send';
    const r1 = await setPartFromSheet(staff.page, origin, S.id, 'graphic', 'Client Approval');
    const sent = r1 === 'ok' && await H.pollRow(() => H.rowSxr(S.id, 'graphic_status'), r => r.graphic_status === 'Client Approval', POLL);
    if (!sent || sent.graphic_status !== 'Client Approval') return out;
    out.step = 'landing';
    const cctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const c = await cctx.newPage();
    const cerrs = []; c.on('pageerror', () => cerrs.push(1));
    if (guard) await guard(c);
    try {
      const t0 = Date.now();
      await openClient(c);
      out.landedMs = await c.waitForFunction((n) => [...document.querySelectorAll('.cal-review-card')].some(x => (x.querySelector('.kcard-title') || {}).textContent === n), S.name, { timeout: 30000 }).then(() => Date.now() - t0).catch(() => null);
      out.cards = await c.evaluate(() => document.querySelectorAll('.cal-review-card').length);
      // Is the sample's thumbnail actually drawn for the client (decoded, width > 0)?
      for (let i = 0; i < 25 && out.landedMs != null; i++) {
        out.thumb = await c.evaluate((n) => {
          const card = [...document.querySelectorAll('.cal-review-card')].find(x => (x.querySelector('.kcard-title') || {}).textContent === n);
          const imgs = card ? [...card.querySelectorAll('img')] : [];
          return { imgs: imgs.length, drawn: imgs.filter(i => i.complete && i.naturalWidth > 0).length };
        }, S.name);
        if (out.thumb.drawn > 0) break;
        await H.sleep(800);
      }
      if (out.landedMs == null) { if (shot) out.shot = await shot(c, 'samples-approve'); return out; }
      out.step = 'click';
      let clicked = 'disabled';
      for (let i = 0; i < 12 && clicked === 'disabled'; i++) { clicked = await H.clientAct(c, S.name, 'graphic', 'approve'); if (clicked === 'disabled') await H.sleep(1000); }
      if (clicked !== 'ok') { if (shot) out.shot = await shot(c, 'samples-approve'); return out; }
      const t1 = Date.now();
      out.step = 'save';
      const row = await H.pollRow(() => H.rowSxr(S.id, 'graphic_status'), r => r.graphic_status === 'Approved', POLL);
      if (!row || row.graphic_status !== 'Approved') { if (shot) out.shot = await shot(c, 'samples-approve'); return out; }
      out.step = 'hold';
      await H.sleep(4000);
      const held = H.rowSxr(S.id, 'graphic_status');
      if (!held || held.graphic_status !== 'Approved') { if (shot) out.shot = await shot(c, 'samples-approve'); return out; }
      out.ms = Date.now() - t1;
      out.ok = true;
    } finally {
      out.clientErrors = cerrs.length;
      await cctx.close();
    }
  } finally {
    // Put it back from the same sheet, whatever happened above.
    try {
      const now = H.rowSxr(S.id, 'graphic_status');
      if (staff.ok && now && now.graphic_status !== before) {
        await staff.page.reload({ waitUntil: 'domcontentloaded' });
        const r = await setPartFromSheet(staff.page, origin, S.id, 'graphic', before);
        out.restored = r === 'ok' && !!(await H.pollRow(() => H.rowSxr(S.id, 'graphic_status'), x => x.graphic_status === before, POLL) || {}).graphic_status
          && H.rowSxr(S.id, 'graphic_status').graphic_status === before;
      } else out.restored = !!now && now.graphic_status === before;
    } catch { out.restored = false; }
    out.staffErrors = (staff.page && staff.page._errs || []).length;
    await staff.ctx.close();
  }
  return out;
}

module.exports = { nativeSampleRoundTrip, findNativeSample, staffSignIn };
