// sxr_b1_linear_routing_clearlink.js — Samples Linear sync, the routing + clear
// edges NOT covered by m4 (which proved the VIDEO push + stale-regress):
//   • a GRAPHIC sub-status change pushes to the GRAPHIC issue only (video issue
//     untouched, overall never pushed);
//   • changing a NON-status field (name) fires NO Linear status push;
//   • clearing a Linear link field persists as the __CLEAR_LINK__ sentinel — the
//     backend row's link actually goes EMPTY (a bare '' would be carried forward),
//     and the clear fires NO Linear push.
// Linear is MOCKED + captured by the harness; nothing reaches real Linear.
//
// Scoped to sidneylaruel; unique sr_b1_* id; archived on exit; 0 app JS errors.
const Q = require('../sxr_courier_lib.js');

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else fail++; console.log((c ? '  PASS ' : '  FAIL ') + m + (!c && x !== undefined ? '  -> ' + JSON.stringify(x) : '')); };
const rowOf = (id) => { try { const r = Q.supa('id=eq.' + encodeURIComponent(id) + '&client=eq.sidneylaruel&select=*'); return Array.isArray(r) && r[0] ? r[0] : null; } catch { return null; } };
async function waitRow(id, pred, ms = 22000) { return Q.poll(() => { const r = rowOf(id); return (r && pred(r)) ? r : false; }, ms) || rowOf(id); }
const norm = (s) => String(s == null ? '' : s).trim();
const setStatusCalls = (issue) => Q.linearCalls().filter(c => c.path === 'linear-set-status' && (!issue || (c.payload && c.payload.issue === issue)));
async function cardReady(page, id, tries = 25) {
  for (let i = 0; i < tries; i++) {
    if (await page.evaluate((id) => !!document.querySelector(`.sxr-card[data-sxr-id="${id}"]`), id)) return true;
    await page.waitForTimeout(900);
  }
  return false;
}

(async () => {
  const base = 'sr_b1_' + Date.now();
  const id = base;
  const VID = 'https://linear.app/syn/issue/VID-' + base.slice(-5);
  const GRA = 'https://linear.app/syn/issue/GRA-' + base.slice(-5);
  const ts = new Date().toISOString();
  const seed = Q.up({
    id, name: 'B1 linear routing', order_index: '1',
    asset_url: 'https://example.com/b1.mp4', thumbnail_url: 'https://via.placeholder.com/320x180.png',
    linear_issue_id: VID, graphic_linear_issue_id: GRA,
    video_status: 'Kasper Approval', graphic_status: 'Kasper Approval', status: 'Kasper Approval', created_at: ts,
  });
  ok(seed && seed.ok === true, 'seed live sample (both comps linked @ Kasper Approval)', JSON.stringify(seed).slice(0, 140));

  const browser = await Q.launch();
  try {
    const page = await Q.smm(browser, 'sidneylaruel');
    ok(await cardReady(page, id), 'SMM card rendered', String(true));

    // ── 1) GRAPHIC status change → push to the GRAPHIC issue only ──
    Q.resetLinearCalls();
    await page.evaluate((id) => { _sxrKasperApproveComp(id, 'graphic'); }, id);
    const r1 = await waitRow(id, r => norm(r.graphic_status) === 'Client Approval');
    ok(r1 && norm(r1.graphic_status) === 'Client Approval', 'Kasper approve graphic → Client Approval (live)', r1 && r1.graphic_status);
    const gPush = await Q.poll(() => { const c = setStatusCalls(GRA); return c.length ? c : false; }, 8000) || [];
    ok(gPush.length >= 1, 'a linear-set-status push fired for the GRAPHIC issue (capture works)', gPush.map(c => c.payload));
    ok(gPush.some(c => c.payload && c.payload.status === 'Client Approval'), 'the graphic push carried status = Client Approval', gPush.map(c => c.payload && c.payload.status));
    ok(setStatusCalls(VID).length === 0, 'NO push to the VIDEO issue (its status did not change)', setStatusCalls(VID).map(c => c.payload));
    // overall is never an issue target — only video/graphic issue urls ever appear.
    const overallLeak = Q.linearCalls().some(c => c.path === 'linear-set-status' && c.payload && c.payload.issue !== VID && c.payload.issue !== GRA);
    ok(overallLeak === false, 'overall status is NEVER pushed (only component issue urls appear)', Q.linearCalls().map(c => c.payload && c.payload.issue));

    // ── 2) a NON-status field change (name) fires NO Linear push ──
    Q.resetLinearCalls();
    const newName = 'B1 renamed ' + Date.now();
    await page.evaluate(({ id, v }) => {
      const el = document.querySelector(`.sxr-card.is-editable[data-sxr-id="${id}"] input[data-sxr-fld="name"]`);
      el.focus(); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('blur', { bubbles: true }));
    }, { id, v: newName });
    await waitRow(id, r => r.name === newName);
    await page.waitForTimeout(2500);
    ok(setStatusCalls().length === 0, 'changing a non-status field fires NO Linear status push', setStatusCalls().map(c => c.payload));

    // ── 3) clear the GRAPHIC link → __CLEAR_LINK__ sentinel → DB link goes EMPTY ──
    Q.resetLinearCalls();
    const beforeClear = rowOf(id);
    ok(beforeClear && norm(beforeClear.graphic_linear_issue_id) === GRA, 'graphic link is set before the clear', beforeClear && beforeClear.graphic_linear_issue_id);
    // Tier-3 slot UI: click the edit pencil on the linked GRAPHIC slot to reveal
    // its input, then clear it + blur → _sxrLinearCommit('') → __CLEAR_LINK__.
    await page.evaluate((id) => {
      const card = document.querySelector(`.sxr-card.is-editable[data-sxr-id="${id}"]`);
      const pencil = card && card.querySelector('.sxr-linear-row[data-sxr-linear-row$="|graphic"] .sxr-linear-edit');
      if (pencil) pencil.click();
    }, id);
    await page.waitForTimeout(250);
    await page.evaluate((id) => {
      const card = document.querySelector(`.sxr-card.is-editable[data-sxr-id="${id}"]`);
      const el = card && card.querySelector('.sxr-linear-row[data-sxr-linear-row$="|graphic"] .sxr-linear-input');
      if (el) { el.focus(); el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('blur', { bubbles: true })); }
    }, id);
    const rClear = await waitRow(id, r => norm(r.graphic_linear_issue_id) === '', 20000);
    ok(rClear && norm(rClear.graphic_linear_issue_id) === '', 'clearing the link persists EMPTY via __CLEAR_LINK__ (not carried forward)', rClear && rClear.graphic_linear_issue_id);
    await page.waitForTimeout(1500);
    ok(setStatusCalls().length === 0, 'clearing a link fires NO Linear status push', setStatusCalls().map(c => c.payload));

    ok(Q.appErrs(page).length === 0, 'no app JS errors', JSON.stringify(Q.appErrs(page).slice(0, 6)));
  } finally {
    try { await browser.close(); } catch {}
    Q.archiveSafe(id);
  }
  console.log(`PROBE sxr_b1_linear_routing_clearlink: pass=${pass} fail=${fail} ` + (fail ? 'FAIL' : 'OK') + '  [Linear MOCKED]');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
