// sxr_m3b_golden.js — M3b: the REVIEW STATE MACHINE golden flows, driven in a
// REAL browser against the LIVE backend (via the courier harness). Scoped to
// sidneylaruel; unique sr_m3b_* ids; archives what it creates; asserts 0 app JS
// errors. Drives the REAL handlers (page.evaluate) — NOT direct status writes —
// and asserts the Supabase row + computed overall status after EACH step.
//
// Flows:
//   (a) clean approve:        submit -> Kasper -> kasper approve -> client approve -> Approved
//   (b) Kasper tweak loop:    send to Kasper -> kasper request-change (Tweaks Needed)
//                             -> SMM resolve (Notes mark-done -> Kasper) -> kasper approve -> client approve
//   (c) client tweak loop:    kasper approve -> client request-change (Tweaks Needed)
//                             -> SMM resolve -> client -> client approve
//   (d) approve-after-tweaks: kasper approve-after-tweaks -> SMM resolve -> client (skip re-Kasper) -> client approve
//   (e) undo-approve:         kasper approve (Client Approval) -> undo (-> Kasper Approval)
//   (f) concurrent double-approve: two _sxrKasperApproveComp in the same tick -> ONE stamp / one effect
//
// Since the Kasper PAGE isn't built (M5), the Kasper handlers are driven
// directly via page.evaluate(() => _sxrKasperApproveComp(...)).
const Q = require('../sxr_courier_lib.js');

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else fail++; console.log((c ? '  PASS ' : '  FAIL ') + m + (!c && x !== undefined ? '  -> ' + x : '')); };
const rowOf = (id) => { const r = Q.supa('id=eq.' + encodeURIComponent(id) + '&client=eq.sidneylaruel&select=*'); return Array.isArray(r) && r[0] ? r[0] : null; };
const parse = (raw) => { try { const a = JSON.parse(String(raw || '')); return Array.isArray(a) ? a : []; } catch { return []; } };

// Wait until the Supabase row's predicate holds (the row is the source of truth
// every surface renders from). Returns the row, or the last seen row.
async function waitRow(id, pred, ms = 22000) {
  return Q.poll(() => { const r = rowOf(id); return (r && pred(r)) ? r : false; }, ms) || rowOf(id);
}
async function cardReady(page, id) {
  for (let i = 0; i < 28; i++) {
    const r = await page.evaluate((id) => !!document.querySelector(`.sxr-card.is-editable[data-sxr-id="${id}"]`), id);
    if (r) return true;
    await page.waitForTimeout(900);
  }
  return false;
}
// Pull the live row into the page's sxrState so the handlers act on a real row,
// then run the handler. (M5 will render the Kasper section that does this; here
// we wire the row in directly so we drive the EXACT shipping handlers.)
async function withRow(page, id, fn) {
  return page.evaluate(({ id, fnStr }) => {
    const norm = (typeof _sxrNormalize === 'function') ? _sxrNormalize : (x) => x;
    return fetch(`https://uzltbbrjidmjwwfakwve.supabase.co/rest/v1/sample_reviews?id=eq.${encodeURIComponent(id)}&client=eq.sidneylaruel&select=*`, {
      headers: { apikey: 'sb_publishable_P4-NdUWJqjtACWZOB6LPEA_8GANHAUA', Authorization: 'Bearer sb_publishable_P4-NdUWJqjtACWZOB6LPEA_8GANHAUA' }
    }).then(r => r.json()).then(rows => {
      const row = norm(Array.isArray(rows) && rows[0] ? rows[0] : { id });
      // Replace the matching card in sxrState so _sxrFind returns the fresh row.
      const i = (sxrState.cards || []).findIndex(c => String(c.id) === String(id));
      if (i >= 0) sxrState.cards[i] = row; else (sxrState.cards = sxrState.cards || []).push(row);
      // eslint-disable-next-line no-new-func
      return (new Function('id', 'return (' + fnStr + ')(id);'))(id);
    });
  }, { id, fnStr: fn.toString() });
}

const ovl = (r) => computeOverall(r);
// Mirror computeSampleOverallStatus (worst-of video+graphic) for the read-back
// assertions (the value the FE shows on overall status).
const PRI = { 'Tweaks Needed': 0, 'In Progress': 1, 'For SMM Approval': 2, 'Kasper Approval': 3, 'Client Approval': 4, 'Approved': 5 };
function computeOverall(r) {
  const subs = ['video', 'graphic'].map(c => String(r[c + '_status'] || 'In Progress'));
  return subs.reduce((acc, s) => (PRI[s] != null && PRI[acc] != null && PRI[s] < PRI[acc]) ? s : acc, 'Approved');
}

(async () => {
  const base = 'sr_m3b_' + Date.now();
  const ids = {
    a: base + '_a',   // clean approve
    b: base + '_b',   // kasper tweak loop
    c: base + '_c',   // client tweak loop
    d: base + '_d',   // approve-after-tweaks
    e: base + '_e',   // undo-approve
    f: base + '_f',   // concurrent double-approve
  };
  const ts = new Date().toISOString();
  // Seed each at Kasper Approval on both components (with a graphic Linear link
  // so the graphic is reviewable), ready for the Kasper handlers.
  const seedOne = (id, name) => Q.up({
    id, name, asset_url: 'https://example.com/v.mp4',
    thumbnail_url: 'https://via.placeholder.com/320x180.png?text=' + encodeURIComponent(name),
    video_status: 'Kasper Approval', graphic_status: 'Kasper Approval',
    linear_issue_id: 'https://linear.app/syn/issue/VID-' + id.slice(-4),
    graphic_linear_issue_id: 'https://linear.app/syn/issue/GRA-' + id.slice(-4),
    creative_direction: 'dir', hide_creative_direction: 'FALSE', order_index: '1', created_at: ts,
  });
  let seededAll = true;
  for (const [k, id] of Object.entries(ids)) { const r = seedOne(id, 'M3b ' + k); seededAll = seededAll && r && r.ok === true; }
  ok(seededAll, 'seed 6 live samples at Kasper Approval (both comps)', seededAll ? '' : 'a seed failed');

  const browser = await Q.launch();
  let token = '';
  try {
    const page = await Q.smm(browser, 'sidneylaruel');
    ok(await cardReady(page, ids.a), 'cards render on the SMM surface', '');

    // ── (a) CLEAN APPROVE ─────────────────────────────────────────────
    console.log('\n[a] clean approve: submit -> Kasper -> kasper approve -> client approve -> Approved');
    // Kasper approves both components -> Client Approval; kasper_approved_at stamped.
    await withRow(page, ids.a, (id) => { _sxrKasperApproveComp(id, 'video'); _sxrKasperApproveComp(id, 'graphic'); });
    let ra = await waitRow(ids.a, r => r.video_status === 'Client Approval' && r.graphic_status === 'Client Approval');
    ok(ra && ra.video_status === 'Client Approval' && ra.graphic_status === 'Client Approval', 'kasper approve -> both at Client Approval', ra && JSON.stringify({ v: ra.video_status, g: ra.graphic_status }));
    ok(ra && ovl(ra) === 'Client Approval', 'overall = Client Approval after kasper approve', ra && ovl(ra));
    ok(ra && !!String(ra.kasper_approved_at || '').trim(), 'kasper_approved_at stamped', ra && ra.kasper_approved_at);
    // Client approves both -> Approved.
    await withRow(page, ids.a, (id) => { _sxrClientApproveComp(id, 'video'); _sxrClientApproveComp(id, 'graphic'); });
    ra = await waitRow(ids.a, r => r.video_status === 'Approved' && r.graphic_status === 'Approved');
    ok(ra && ovl(ra) === 'Approved', '[a] client approve both -> overall Approved (terminal)', ra && ovl(ra));
    ok(ra && !!String(ra.client_video_approved_at || '').trim() && !!String(ra.client_graphic_approved_at || '').trim(),
      '[a] client_<comp>_approved_at stamped on both', ra && JSON.stringify({ v: ra.client_video_approved_at, g: ra.client_graphic_approved_at }));

    // ── (b) KASPER TWEAK LOOP ─────────────────────────────────────────
    console.log('\n[b] kasper request-change -> Tweaks Needed -> SMM resolve->Kasper -> kasper approve');
    await withRow(page, ids.b, (id) => _sxrKasperRequestTweakComp(id, 'video', 'tighten the hook'));
    let rb = await waitRow(ids.b, r => r.video_status === 'Tweaks Needed');
    ok(rb && rb.video_status === 'Tweaks Needed', 'kasper request-change -> video Tweaks Needed', rb && rb.video_status);
    ok(rb && ovl(rb) === 'Tweaks Needed', 'overall = Tweaks Needed (one TN forces it)', rb && ovl(rb));
    const tweakB = parse(rb.video_tweaks).find(c => c.role === 'kasper' && c.is_tweak === true && !c.done);
    ok(!!tweakB, 'open Kasper change-request present (is_tweak true, not done)', JSON.stringify(tweakB || null));
    // Card stays reviewable while the unresolved tweak exists.
    const reviewableB = await withRow(page, ids.b, (id) => _sxrKasperVisible(_sxrFind(id)));
    ok(reviewableB === true, 'card STAYS reviewable while an unresolved tweak exists', String(reviewableB));
    // SMM resolves the last tweak -> Kasper (deferred resolve + route via the chooser path).
    await withRow(page, ids.b, (id) => {
      const root = _sxrOpenTweaksForComp(_sxrFind(id), 'video')[0];
      _sxrResolveTweaksDone(_sxrFind(id), 'video', [root.id]);
      _sxrApplyAutoStatus(id, 'smm_resolved_last', 'video', 'kasper');
      _sxrFlushCardSave(id);
    });
    rb = await waitRow(ids.b, r => r.video_status === 'Kasper Approval' && parse(r.video_tweaks).every(c => !c.is_tweak || c.done || c.deleted));
    ok(rb && rb.video_status === 'Kasper Approval', 'SMM resolve->Kasper -> video back at Kasper Approval', rb && rb.video_status);
    ok(rb && parse(rb.video_tweaks).every(c => !c.is_tweak || c.done || c.deleted), 'the change-request is marked done (resolved)', JSON.stringify(parse(rb.video_tweaks).map(c => ({ t: c.is_tweak, d: c.done }))));
    // Kasper approves -> Client Approval.
    await withRow(page, ids.b, (id) => _sxrKasperApproveComp(id, 'video'));
    rb = await waitRow(ids.b, r => r.video_status === 'Client Approval');
    ok(rb && rb.video_status === 'Client Approval', '[b] kasper approve after resolve -> Client Approval', rb && rb.video_status);

    // ── (c) CLIENT TWEAK LOOP ─────────────────────────────────────────
    console.log('\n[c] kasper approve -> client request-change -> SMM resolve->client -> client approve');
    await withRow(page, ids.c, (id) => _sxrKasperApproveComp(id, 'video'));
    let rc = await waitRow(ids.c, r => r.video_status === 'Client Approval');
    ok(rc && rc.video_status === 'Client Approval', 'kasper approve -> Client Approval', rc && rc.video_status);
    // Client requests a change on the client surface (real client handler).
    token = await page.evaluate((name) => { try { return String((window.clientMap && window.clientMap[name] && window.clientMap[name].client_review_token) || ''); } catch (e) { return ''; } }, 'Sidney Laruel');
    const cpage = await Q.client(browser, 'Sidney Laruel', token || undefined);
    await cpage.waitForTimeout(1500);
    const clientFound = await (async () => { for (let i = 0; i < 25; i++) { const f = await cpage.evaluate((id) => !!document.querySelector(`.sxr-card[data-sxr-id="${id}"]`), ids.c); if (f) return true; await cpage.waitForTimeout(900); } return false; })();
    if (clientFound) {
      // Best case: drive the REAL client handler on the REAL client surface.
      await withRow(cpage, ids.c, (id) => _sxrClientRequestTweakComp(id, 'video', 'please brighten the thumbnail'));
      rc = await waitRow(ids.c, r => r.video_status === 'Tweaks Needed');
      ok(rc && rc.video_status === 'Tweaks Needed', 'client request-change (client surface) -> video Tweaks Needed', rc && rc.video_status);
      const ctw = parse(rc.video_tweaks).find(c => c.role === 'client' && c.is_tweak === true);
      ok(!!ctw && ctw.audience === 'client', 'client change-request is client-audience + is_tweak', JSON.stringify(ctw || null));
      try { await cpage.close(); } catch {}
    } else {
      // Token-gated harness (same gate the m3a probe hits): the live client
      // surface can't render without a readable client_review_token here. Drive
      // the SAME real handler (_sxrClientRequestTweakComp, role 'client') from
      // the SMM page so the change-request + flip still exercise the shipping
      // code path; the surface guard itself is unit-asserted separately.
      try { await cpage.close(); } catch {}
      await withRow(page, ids.c, (id) => _sxrClientRequestTweakComp(id, 'video', 'please brighten the thumbnail'));
      rc = await waitRow(ids.c, r => r.video_status === 'Tweaks Needed');
      ok(rc && rc.video_status === 'Tweaks Needed', 'client request-change (handler, token-gated surface) -> video Tweaks Needed', rc && rc.video_status);
      const ctw = parse(rc.video_tweaks).find(c => c.role === 'client' && c.is_tweak === true);
      ok(!!ctw && ctw.audience === 'client', 'client change-request is client-audience + is_tweak', JSON.stringify(ctw || null));
    }
    // SMM resolves -> client.
    await withRow(page, ids.c, (id) => {
      const root = _sxrOpenTweaksForComp(_sxrFind(id), 'video')[0];
      if (root) { _sxrResolveTweaksDone(_sxrFind(id), 'video', [root.id]); _sxrApplyAutoStatus(id, 'smm_resolved_last', 'video', 'client'); _sxrFlushCardSave(id); }
    });
    rc = await waitRow(ids.c, r => r.video_status === 'Client Approval');
    ok(rc && rc.video_status === 'Client Approval', 'SMM resolve->client -> video Client Approval', rc && rc.video_status);
    // Client approves -> Approved.
    await withRow(page, ids.c, (id) => _sxrClientApproveComp(id, 'video'));
    // graphic is still Kasper Approval here; approve it too so overall can settle.
    await withRow(page, ids.c, (id) => { _sxrKasperApproveComp(id, 'graphic'); });
    await withRow(page, ids.c, (id) => { _sxrClientApproveComp(id, 'graphic'); });
    rc = await waitRow(ids.c, r => r.video_status === 'Approved');
    ok(rc && rc.video_status === 'Approved', '[c] client approve -> video Approved', rc && rc.video_status);

    // ── (d) APPROVE-AFTER-TWEAKS ──────────────────────────────────────
    console.log('\n[d] kasper approve-after-tweaks -> SMM resolve->client (skip re-Kasper) -> client approve');
    await withRow(page, ids.d, (id) => _sxrKasperApproveAfterTweaksComp(id, 'video', 'minor: trim the intro'));
    let rd = await waitRow(ids.d, r => r.video_status === 'Tweaks Needed' && String(r.kasper_approved_after_tweaks || '').split(',').includes('video'));
    ok(rd && rd.video_status === 'Tweaks Needed', 'approve-after-tweaks -> video Tweaks Needed', rd && rd.video_status);
    ok(rd && String(rd.kasper_approved_after_tweaks || '').split(',').includes('video'), 'kasper_approved_after_tweaks records video (pre-cleared)', rd && rd.kasper_approved_after_tweaks);
    // The chooser RECOMMENDS client (skip re-Kasper) for a pre-cleared component.
    const recD = await withRow(page, ids.d, (id) => _sxrResolveDestRecommend(_sxrFind(id), 'video'));
    ok(recD === 'client', 'resolve chooser recommends CLIENT (skip re-Kasper) for a pre-cleared comp', recD);
    await withRow(page, ids.d, (id) => {
      const root = _sxrOpenTweaksForComp(_sxrFind(id), 'video')[0];
      _sxrResolveTweaksDone(_sxrFind(id), 'video', [root.id]);
      _sxrApplyAutoStatus(id, 'smm_resolved_last', 'video', 'client');
      _sxrFlushCardSave(id);
    });
    rd = await waitRow(ids.d, r => r.video_status === 'Client Approval');
    ok(rd && rd.video_status === 'Client Approval', 'SMM resolve->client -> Client Approval (no Kasper re-review)', rd && rd.video_status);
    await withRow(page, ids.d, (id) => _sxrClientApproveComp(id, 'video'));
    rd = await waitRow(ids.d, r => r.video_status === 'Approved');
    ok(rd && rd.video_status === 'Approved', '[d] client approve -> video Approved', rd && rd.video_status);

    // ── (e) UNDO-APPROVE ──────────────────────────────────────────────
    console.log('\n[e] kasper approve (Client Approval) -> undo -> Kasper Approval');
    // Wire the row once (seeded at Kasper Approval), approve capturing the
    // snapshot into a page global, wait for Client Approval to land, then undo.
    await withRow(page, ids.e, (id) => { window.__sxrUndoSnap = _sxrKasperApproveComp(id, 'video'); });
    let re = await waitRow(ids.e, r => r.video_status === 'Client Approval');
    ok(re && re.video_status === 'Client Approval', 'kasper approve -> Client Approval (snapshot captured)', re && re.video_status);
    const snapOk = await page.evaluate(() => !!(window.__sxrUndoSnap && window.__sxrUndoSnap.video_status === 'Kasper Approval'));
    ok(snapOk, '[e] snapshot captured the pre-approve state (video Kasper Approval)', String(snapOk));
    // The approve and the undo SHARE an in-flight guard key (correct: don't undo
    // mid-approve). That guard clears only after _sxrFlushCardSave's promise
    // resolves — a beat AFTER the Supabase write the poll above already saw. Wait
    // for it to clear (plus a settle buffer) so the undo isn't serialized out.
    await page.waitForFunction(({ id }) => {
        try { return !_sxrReviewInFlight[_sxrReviewKey(id, 'video')]; } catch (e) { return true; }
    }, { id: ids.e }, { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(1200);
    // Undo with that snapshot — restores video to Kasper Approval. (The same
    // in-memory row is still in sxrState, so _sxrFind sees the live state.)
    await page.evaluate(({ id }) => { _sxrKasperUndoApprove(id, 'video', window.__sxrUndoSnap); }, { id: ids.e });
    re = await waitRow(ids.e, r => r.video_status === 'Kasper Approval');
    ok(re && re.video_status === 'Kasper Approval', '[e] undo-approve -> video back at Kasper Approval', re && re.video_status);
    ok(re && !String(re.client_video_approved_at || '').trim(), '[e] undo leaves no client video stamp (none was set)', re && re.client_video_approved_at);

    // ── (f) CONCURRENT DOUBLE-APPROVE ─────────────────────────────────
    console.log('\n[f] two _sxrKasperApproveComp in the same tick -> ONE effect / one stamp');
    const fRes = await page.evaluate(({ id }) => {
      return fetch(`https://uzltbbrjidmjwwfakwve.supabase.co/rest/v1/sample_reviews?id=eq.${encodeURIComponent(id)}&client=eq.sidneylaruel&select=*`, {
        headers: { apikey: 'sb_publishable_P4-NdUWJqjtACWZOB6LPEA_8GANHAUA', Authorization: 'Bearer sb_publishable_P4-NdUWJqjtACWZOB6LPEA_8GANHAUA' }
      }).then(r => r.json()).then(rows => {
        const row = _sxrNormalize(Array.isArray(rows) && rows[0] ? rows[0] : { id });
        const i = (sxrState.cards || []).findIndex(c => String(c.id) === String(id));
        if (i >= 0) sxrState.cards[i] = row; else sxrState.cards.push(row);
        // Fire two approves on the same component in the SAME synchronous tick.
        const s1 = _sxrKasperApproveComp(id, 'video');
        const s2 = _sxrKasperApproveComp(id, 'video');   // must be a no-op (in-flight guard)
        const live = _sxrFind(id);
        return { s1: !!s1, s2: s2 === null, stamp: live.kasper_approved_at, status: live.video_status };
      });
    }, { id: ids.f });
    ok(fRes.s1 === true && fRes.s2 === true, '[f] second concurrent approve is a no-op (in-flight guard) -> one effect', JSON.stringify(fRes));
    let rf = await waitRow(ids.f, r => r.video_status === 'Client Approval');
    ok(rf && rf.video_status === 'Client Approval', '[f] video at Client Approval after the (single) approve', rf && rf.video_status);
    ok(rf && !!String(rf.kasper_approved_at || '').trim(), '[f] exactly one kasper_approved_at stamp present', rf && rf.kasper_approved_at);

    ok(Q.appErrs(page).length === 0, 'no app JS errors (SMM surface)', JSON.stringify(Q.appErrs(page).slice(0, 6)));

    // Read-back summary.
    console.log('\n  read-backs (live Supabase):');
    for (const [k, id] of Object.entries(ids)) {
      const r = rowOf(id);
      console.log(`   [${k}] ${id}: video=${r && r.video_status} graphic=${r && r.graphic_status} overall=${r && ovl(r)} kAt=${r && (r.kasper_approved_at ? 'set' : '-')} cV=${r && (r.client_video_approved_at ? 'set' : '-')}`);
    }
    await page.close();
  } finally {
    for (const id of Object.values(ids)) { try { Q.up({ id, status: 'Archived' }); } catch {} }
    await browser.close();
  }
  console.log(`\nPROBE sxr_m3b_golden: pass=${pass} fail=${fail} ` + (fail ? 'FAIL' : 'OK'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
