// sxr_m4_linear.js — M4 real-browser probe: the LINEAR STATUS SYNC (front-end).
//
// Drives the REAL app in a REAL headless Chromium against the LIVE sample_reviews
// backend (via the Node courier), with the four Linear webhooks MOCKED by the
// harness — a status push or comment NEVER reaches real Linear (that would
// mutate an editor's issue). The harness records every linear-* call so we can
// assert exactly what the FE tried to push, and serves a configurable
// linear-subissues response for the point-adoption test.
//
// Asserts (SAMPLES_V2_PLAN.md §6.2):
//   • a sub-status change PUSHES to that component's linked Linear issue
//     (video_status → video issue), with the right {issue,status};
//   • a Kasper change-request POSTS a linear-add-comment to the issue;
//   • point-adoption: setting a fresh link adopts that issue's current status
//     AND suppresses the echo (no linear-set-status for the adopted value);
//   • stale-regress: a stale Linear round-trip (server regresses a fresh
//     approval, no new tweak) is KEPT local on a background reload AND
//     re-asserted to Linear;
//   • 0 app JS errors.
const Q = require('../sxr_courier_lib.js');

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else fail++; console.log((c ? '  PASS ' : '  FAIL ') + m + (!c && x !== undefined ? '  -> ' + JSON.stringify(x) : '')); };
const rowOf = (id) => { try { const r = Q.supa('id=eq.' + encodeURIComponent(id) + '&client=eq.sidneylaruel&select=*'); return Array.isArray(r) && r[0] ? r[0] : null; } catch { return null; } };
async function waitRow(id, pred, ms = 22000) { return Q.poll(() => { const r = rowOf(id); return (r && pred(r)) ? r : false; }, ms) || rowOf(id); }
async function cardReady(page, id, tries = 25) {
  for (let i = 0; i < tries; i++) {
    if (await page.evaluate((id) => !!document.querySelector(`.sxr-card[data-sxr-id="${id}"]`), id)) return true;
    await page.waitForTimeout(900);
  }
  return false;
}
const setStatusCalls = (issue) => Q.linearCalls().filter(c => c.path === 'linear-set-status' && (!issue || (c.payload && c.payload.issue === issue)));
const commentCalls = (issue) => Q.linearCalls().filter(c => c.path === 'linear-add-comment' && (!issue || (c.payload && c.payload.issue === issue)));
const subissuesCalls = () => Q.linearCalls().filter(c => c.path === 'linear-subissues');

(async () => {
  const base = 'sr_m4_' + Date.now();
  const ids = { a: base + '_a', adopt: base + '_adopt' };
  const VID = 'https://linear.app/syn/issue/VID-' + base.slice(-5);
  const GRA = 'https://linear.app/syn/issue/GRA-' + base.slice(-5);
  const ts = new Date().toISOString();

  // Sample A: both comps linked + at Kasper Approval (Kasper can approve video / request a graphic tweak).
  const rA = Q.up({
    id: ids.a, name: 'M4 push', order_index: '1',
    asset_url: 'https://example.com/m4.mp4', thumbnail_url: 'https://via.placeholder.com/320x180.png?text=m4',
    linear_issue_id: VID, graphic_linear_issue_id: GRA,
    video_status: 'Kasper Approval', graphic_status: 'Kasper Approval', status: 'Kasper Approval', created_at: ts,
  });
  // Sample adopt: NO links, In Progress (the point-adoption target).
  const rAd = Q.up({
    id: ids.adopt, name: 'M4 adopt', order_index: '2',
    asset_url: 'https://example.com/m4b.mp4', video_status: 'In Progress', graphic_status: 'In Progress', status: 'In Progress', created_at: ts,
  });
  ok(rA && rA.ok === true && rAd && rAd.ok === true, 'seed 2 live samples (A linked @ Kasper Approval; adopt unlinked @ In Progress)', { a: rA && rA.ok, adopt: rAd && rAd.ok });

  const browser = await Q.launch();
  try {
    const page = await Q.smm(browser, 'sidneylaruel');
    const ready = await cardReady(page, ids.a);
    ok(ready, 'SMM surface rendered the seeded cards', String(ready));

    // ── 1) status change PUSHES to the linked video issue ───────────────
    Q.resetLinearCalls();
    await page.evaluate((id) => { _sxrKasperApproveComp(id, 'video'); }, ids.a);
    const r1 = await waitRow(ids.a, r => r.video_status === 'Client Approval');
    ok(r1 && r1.video_status === 'Client Approval', 'Kasper approve video → Client Approval (live Supabase)', r1 && r1.video_status);
    const push1 = await Q.poll(() => { const c = setStatusCalls(VID); return c.length ? c : false; }, 8000) || [];
    ok(push1.length >= 1, 'a linear-set-status push fired for the VIDEO issue', push1.map(c => c.payload));
    ok(push1.some(c => c.payload && c.payload.status === 'Client Approval'), 'the push carried status = Client Approval', push1.map(c => c.payload && c.payload.status));
    ok(setStatusCalls(GRA).length === 0, 'no push to the GRAPHIC issue (its status did not change)', setStatusCalls(GRA).map(c => c.payload));

    // ── 2) stale-regress: a stale Linear round-trip is KEPT + re-asserted ─
    // Simulate the inbound sync writing the video sub-status BACK to In Progress
    // (a drifted issue), newer than our fresh approval, with no new tweak.
    Q.up({ id: ids.a, video_status: 'In Progress' });
    await waitRow(ids.a, r => r.video_status === 'In Progress');
    Q.resetLinearCalls();
    await page.evaluate(() => loadSxrCards('sidneylaruel', { background: true }));
    await page.waitForTimeout(1800);
    const kept = await page.evaluate((id) => { const c = (sxrState.cards || []).find(x => String(x.id) === String(id)); return c ? c.video_status : null; }, ids.a);
    ok(kept === 'Client Approval', 'stale Linear regress KEPT local (card stays Client Approval after bg reload)', kept);
    const reassert = await Q.poll(() => { const c = setStatusCalls(VID).filter(x => x.payload && x.payload.status === 'Client Approval'); return c.length ? c : false; }, 6000) || [];
    ok(reassert.length >= 1, 're-asserted Client Approval to Linear (heal forward)', reassert.map(c => c.payload && c.payload.status));

    // ── 3) a Kasper change-request POSTS a Linear comment ───────────────
    Q.resetLinearCalls();
    await page.evaluate((id) => { _sxrKasperRequestTweakComp(id, 'graphic', 'please brighten the thumbnail'); }, ids.a);
    const r3 = await waitRow(ids.a, r => r.graphic_status === 'Tweaks Needed');
    ok(r3 && r3.graphic_status === 'Tweaks Needed', 'Kasper request-change graphic → Tweaks Needed (live)', r3 && r3.graphic_status);
    const cmt = await Q.poll(() => { const c = commentCalls(GRA); return c.length ? c : false; }, 8000) || [];
    ok(cmt.length >= 1 && /brighten/.test((cmt[0].payload && cmt[0].payload.body) || ''), 'a linear-add-comment posted to the GRAPHIC issue', cmt.map(c => c.payload));

    // ── 4) point-adoption + echo suppression on a fresh link ────────────
    const ready2 = await cardReady(page, ids.adopt);
    ok(ready2, 'unlinked sample card present', String(ready2));
    // The linked issue currently sits at Client Approval in Linear (mocked).
    Q.setSubissuesResp({ ok: true, parent: { status: 'Client Approval', identifier: 'VID-ADO' }, subIssues: [] });
    Q.resetLinearCalls();
    await page.evaluate(({ id, url }) => {
      _sxrPendingEdits[id] = Object.assign(_sxrPendingEdits[id] || {}, { linear_issue_id: url });
      _sxrFlushCardSave(id);
    }, { id: ids.adopt, url: 'https://linear.app/syn/issue/VID-ADO-' + base.slice(-4) });
    const r4 = await waitRow(ids.adopt, r => r.video_status === 'Client Approval', 22000);
    ok(r4 && r4.video_status === 'Client Approval', 'point-adoption: fresh link adopted the issue status (Client Approval) (live)', r4 && r4.video_status);
    ok(subissuesCalls().length >= 1, 'point-adoption fetched the issue status (linear-subissues)', subissuesCalls().length);
    ok(setStatusCalls().length === 0, 'NO linear-set-status for the adopted status (echo SUPPRESSED)', setStatusCalls().map(c => c.payload));

    ok(Q.appErrs(page).length === 0, 'no app JS errors', JSON.stringify(Q.appErrs(page).slice(0, 6)));

    console.log('\n  read-backs (live Supabase):');
    for (const [k, id] of Object.entries(ids)) { const r = rowOf(id); console.log(`   [${k}] ${id}: video=${r && r.video_status} graphic=${r && r.graphic_status}`); }
  } finally {
    for (const id of Object.values(ids)) { try { Q.up({ id, status: 'Archived' }); } catch {} }
    await browser.close();
  }
  console.log(`\nPROBE sxr_m4_linear: pass=${pass} fail=${fail} ` + (fail ? 'FAIL' : 'OK') + '  [Linear MOCKED — live sample_reviews]');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
