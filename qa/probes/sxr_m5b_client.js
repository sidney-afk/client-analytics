// sxr_m5b_client.js — M5b real-browser probe: the CLIENT REVIEW SURFACE.
//
// Drives the LIVE backend through the Node-courier harness, scoped to the test
// client `sidneylaruel`, with unique sr_m5b_* ids that are archived on exit.
//
// CLIENT RESOLUTION (the M3a/M3b blocker, now resolved): the share path resolves
// the client via clientNames.includes(name) OR wlIsAllowedClient(name). "Sidney
// Laruel" IS in WL_CLIENT_NAMES, so wlIsAllowedClient('Sidney Laruel') === true
// and wlCanonicalClient → 'Sidney Laruel'; the Clients Info sheet has no
// client_review_token column, so expectedToken === '' → the token gate is
// UNGUARDED and proceeds. So the REAL client surface (?c=Sidney%20Laruel&
// v=sample-reviews) renders end-to-end here. This probe drives it; only if the
// live surface genuinely fails to render do we fall back to the M3a/M3b
// handler-drive (the render-gating predicate is unit-asserted separately in
// test/samples-client-surface.js).
//
// Asserts (task VERIFY #3):
//   • seed a sample with video @ Client Approval (graphic @ Kasper Approval) ->
//     open the client surface -> the Approve + Request-change controls render
//     for VIDEO, and NOT for the graphic component (Kasper Approval, read-only);
//   • internal SMM notes are not visible; field inputs are absent/disabled;
//   • click Approve -> poll Supabase: video -> Approved + client_video_approved_at
//     stamped;
//   • on a second sample, Request change -> Tweaks Needed + a client-audience
//     is_tweak comment;
//   • 0 app JS errors.
const Q = require('../sxr_courier_lib.js');

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else fail++; console.log((c ? '  PASS ' : '  FAIL ') + m + (!c && x !== undefined ? '  -> ' + x : '')); };
// Resilient to a transient curl/TLS glitch (exit 35 etc.): a single failed read
// inside a poll loop must not crash the probe — return null and let poll retry.
const rowOf = (id) => { try { const r = Q.supa('id=eq.' + encodeURIComponent(id) + '&client=eq.sidneylaruel&select=*'); return Array.isArray(r) && r[0] ? r[0] : null; } catch { return null; } };
const parse = (raw) => { try { const a = JSON.parse(String(raw || '')); return Array.isArray(a) ? a : []; } catch { return []; } };
async function waitRow(id, pred, ms = 22000) {
  return Q.poll(() => { const r = rowOf(id); return (r && pred(r)) ? r : false; }, ms) || rowOf(id);
}
// Pull the live row into the page's sxrState so a handler-drive fallback acts on
// a real row (same shape the M3b probe uses).
async function withRow(page, id, fn) {
  return page.evaluate(({ id, fnStr }) => {
    const norm = (typeof _sxrNormalize === 'function') ? _sxrNormalize : (x) => x;
    return fetch(`https://uzltbbrjidmjwwfakwve.supabase.co/rest/v1/sample_reviews?id=eq.${encodeURIComponent(id)}&client=eq.sidneylaruel&select=*`, {
      headers: { apikey: 'sb_publishable_P4-NdUWJqjtACWZOB6LPEA_8GANHAUA', Authorization: 'Bearer sb_publishable_P4-NdUWJqjtACWZOB6LPEA_8GANHAUA' }
    }).then(r => r.json()).then(rows => {
      const row = norm(Array.isArray(rows) && rows[0] ? rows[0] : { id });
      const i = (sxrState.cards || []).findIndex(c => String(c.id) === String(id));
      if (i >= 0) sxrState.cards[i] = row; else (sxrState.cards = sxrState.cards || []).push(row);
      // eslint-disable-next-line no-new-func
      return (new Function('id', 'return (' + fnStr + ')(id);'))(id);
    });
  }, { id, fnStr: fn.toString() });
}
async function clientCardReady(page, id, tries = 25) {
  for (let i = 0; i < tries; i++) {
    const f = await page.evaluate((id) => !!document.querySelector(`.sxr-card[data-sxr-id="${id}"]`), id);
    if (f) return true;
    await page.waitForTimeout(900);
  }
  return false;
}

(async () => {
  const base = 'sr_m5b_' + Date.now();
  const ids = {
    approve: base + '_approve',   // video @ Client Approval -> client APPROVE
    tweak:   base + '_tweak',     // video @ Client Approval -> client REQUEST CHANGE
  };
  const ts = new Date().toISOString();
  // Seed each: VIDEO at Client Approval (client-actionable), GRAPHIC at Kasper
  // Approval (NOT client-actionable — proves the gate hides controls there).
  // A graphic Linear link + thumbnail keep it realistic. An INTERNAL SMM note on
  // video proves the client never sees internal chatter.
  const internalNote = JSON.stringify([{
    id: 'sc_internal_' + base, parent_id: null, author: 'Synchro Social', role: 'smm',
    body: 'INTERNAL: hold the lower-third until legal signs off', audience: 'internal',
    created_at: ts, updated_at: ts, is_tweak: false,
  }]);
  const seedOne = (id, name) => Q.up({
    id, name, order_index: '1',
    asset_url: 'https://example.com/m5b-video.mp4',
    thumbnail_url: 'https://via.placeholder.com/320x180.png?text=' + encodeURIComponent(name),
    graphic_linear_issue_id: 'https://linear.app/syn/issue/GRA-' + id.slice(-4),
    video_status: 'Client Approval', graphic_status: 'Kasper Approval',
    status: 'Kasper Approval', video_tweaks: internalNote,
    creative_direction: 'bright + punchy', hide_creative_direction: 'FALSE', created_at: ts,
  });
  let seededAll = true;
  for (const [k, id] of Object.entries(ids)) { const r = seedOne(id, 'M5b ' + k); seededAll = seededAll && r && r.ok === true; }
  ok(seededAll, 'seed 2 live samples (video @ Client Approval, graphic @ Kasper Approval, + internal SMM note)', seededAll ? '' : 'a seed failed');

  const browser = await Q.launch();
  let renderedLive = false;
  try {
    // Open the REAL client surface (token unguarded — see header). No token param
    // needed; the share path resolves the client via wlIsAllowedClient.
    const page = await Q.client(browser, 'Sidney Laruel');
    renderedLive = await clientCardReady(page, ids.approve);
    ok(renderedLive, 'CLIENT SURFACE rendered the cards live (?c=Sidney Laruel&v=sample-reviews)', renderedLive ? '' : 'fell back to handler-drive');

    if (renderedLive) {
      // ── confirm we are on the read-only client surface ───────────────────
      // _isClientLink is a closure const (not on window); the observable proof
      // is the read-only card shape: the client card has NO `is-editable` class
      // and NO drag grip (the SMM-only affordances).
      const roShape = await page.evaluate((id) => {
        const card = document.querySelector(`.sxr-card[data-sxr-id="${id}"]`);
        return card ? { editable: card.classList.contains('is-editable'), grip: !!card.querySelector('.sxr-card-grip'), draggable: card.getAttribute('draggable') } : null;
      }, ids.approve);
      ok(roShape && roShape.editable === false && roShape.grip === false && roShape.draggable !== 'true',
        'surface is the read-only CLIENT card (no is-editable / no drag grip)', JSON.stringify(roShape));

      // ── controls render for VIDEO (Client Approval) ──────────────────────
      const vp = await page.evaluate((id) => {
        const card = document.querySelector(`.sxr-card[data-sxr-id="${id}"]`);
        if (!card) return null;
        const panel = card.querySelector('.cal-review-panel[data-sxr-cl-comp="video"]');
        const gline = card.querySelector('[data-sxr-cl-comp="graphic"]');
        return {
          hasVideoPanel: !!panel,
          videoApprove: !!(panel && panel.querySelector('.cal-review-approve-btn')),
          videoTweak: !!(panel && panel.querySelector('.cal-review-tweak-btn')),
          graphicState: gline ? gline.getAttribute('data-state') : null,
          graphicHasApprove: !!(gline && gline.querySelector && gline.querySelector('.cal-review-approve-btn')),
          // Field-editor leakage check on the WHOLE card (must be none).
          fieldInputs: card.querySelectorAll('input[data-sxr-fld], textarea[data-sxr-fld], .sxr-name-input, .sxr-url-row, .sxr-card-grip, .sxr-pill-btn').length,
          anyInput: card.querySelectorAll('input').length,
          // Internal SMM note text must not appear anywhere in the card.
          leaksInternal: /INTERNAL: hold the lower-third/.test(card.textContent || ''),
        };
      }, ids.approve);
      ok(vp && vp.hasVideoPanel, 'video (Client Approval) renders the review panel', JSON.stringify(vp));
      ok(vp && vp.videoApprove, 'video panel renders the Approve control', JSON.stringify(vp));
      ok(vp && vp.videoTweak, 'video panel renders the Request-change control', JSON.stringify(vp));
      ok(vp && vp.graphicState === 'readonly' && !vp.graphicHasApprove, 'graphic (Kasper Approval) is READ-ONLY — no client controls', JSON.stringify(vp));
      ok(vp && vp.fieldInputs === 0, 'NO field editors on the client card (name/url/cd/grip/status-pill all absent)', JSON.stringify(vp));
      ok(vp && vp.anyInput === 0, 'NO <input> field on the client card (read-only for fields)', JSON.stringify(vp));
      ok(vp && vp.leaksInternal === false, 'internal SMM note is NOT visible to the client', JSON.stringify(vp));

      // ── click Approve on VIDEO (real rendered control) ───────────────────
      await page.evaluate((id) => {
        const card = document.querySelector(`.sxr-card[data-sxr-id="${id}"]`);
        const btn = card && card.querySelector('.cal-review-panel[data-sxr-cl-comp="video"] .cal-review-approve-btn');
        if (btn) btn.click();
      }, ids.approve);
      let ra = await waitRow(ids.approve, r => r.video_status === 'Approved' && String(r.client_video_approved_at || '').trim());
      ok(ra && ra.video_status === 'Approved', 'click Approve -> video_status = Approved (live Supabase)', ra && ra.video_status);
      ok(ra && !!String(ra.client_video_approved_at || '').trim(), 'client_video_approved_at stamped', ra && ra.client_video_approved_at);

      // ── Request change on the OTHER sample (real rendered composer+button) ─
      const reqReady = await clientCardReady(page, ids.tweak);
      ok(reqReady, 'second sample card present on the client surface', String(reqReady));
      await page.evaluate((id) => {
        const card = document.querySelector(`.sxr-card[data-sxr-id="${id}"]`);
        const ta = card && card.querySelector('.cal-review-panel[data-sxr-cl-comp="video"] textarea[data-sxr-cl-draft]');
        if (ta) {
          ta.value = 'Please make the thumbnail brighter and bump the title size.';
          ta.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, ids.tweak);
      await page.waitForTimeout(200);
      await page.evaluate((id) => {
        const card = document.querySelector(`.sxr-card[data-sxr-id="${id}"]`);
        const btn = card && card.querySelector('.cal-review-panel[data-sxr-cl-comp="video"] .cal-review-tweak-btn');
        if (btn) btn.click();
      }, ids.tweak);
      let rt = await waitRow(ids.tweak, r => r.video_status === 'Tweaks Needed');
      ok(rt && rt.video_status === 'Tweaks Needed', 'Request change -> video_status = Tweaks Needed (live Supabase)', rt && rt.video_status);
      const ctw = parse(rt.video_tweaks).find(c => c.role === 'client' && c.is_tweak === true);
      ok(!!ctw && ctw.audience === 'client', 'a client-audience is_tweak comment was written', JSON.stringify(ctw || null));

      ok(Q.appErrs(page).length === 0, 'no app JS errors (client surface)', JSON.stringify(Q.appErrs(page).slice(0, 6)));
    } else {
      // ── FALLBACK: drive the REAL client handlers + assert the row ─────────
      // (Only if the live client surface couldn't render in this harness. The
      //  render-gating predicate is unit-asserted in test/samples-client-surface.js.)
      console.log('  [fallback] client surface did not render; driving the real _sxrClient* handlers');
      const smm = await Q.smm(browser, 'sidneylaruel');
      await withRow(smm, ids.approve, (id) => _sxrClientApproveComp(id, 'video'));
      let ra = await waitRow(ids.approve, r => r.video_status === 'Approved' && String(r.client_video_approved_at || '').trim());
      ok(ra && ra.video_status === 'Approved', '[fallback] _sxrClientApproveComp -> video Approved', ra && ra.video_status);
      ok(ra && !!String(ra.client_video_approved_at || '').trim(), '[fallback] client_video_approved_at stamped', ra && ra.client_video_approved_at);
      // The handler must NOT act on a non-Client-Approval component (graphic @ Kasper Approval).
      const blocked = await withRow(smm, ids.approve, (id) => _sxrClientApproveComp(id, 'graphic'));
      ok(blocked === false, '[fallback] approve BLOCKED on graphic (Kasper Approval) — surface guard', String(blocked));
      await withRow(smm, ids.tweak, (id) => _sxrClientRequestTweakComp(id, 'video', 'brighter thumbnail please'));
      let rt = await waitRow(ids.tweak, r => r.video_status === 'Tweaks Needed');
      ok(rt && rt.video_status === 'Tweaks Needed', '[fallback] _sxrClientRequestTweakComp -> Tweaks Needed', rt && rt.video_status);
      const ctw = parse(rt.video_tweaks).find(c => c.role === 'client' && c.is_tweak === true);
      ok(!!ctw && ctw.audience === 'client', '[fallback] client-audience is_tweak comment written', JSON.stringify(ctw || null));
      ok(Q.appErrs(smm).length === 0, '[fallback] no app JS errors', JSON.stringify(Q.appErrs(smm).slice(0, 6)));
    }

    // Read-back summary.
    console.log('\n  read-backs (live Supabase):');
    for (const [k, id] of Object.entries(ids)) {
      const r = rowOf(id);
      console.log(`   [${k}] ${id}: video=${r && r.video_status} graphic=${r && r.graphic_status} cV=${r && (r.client_video_approved_at ? 'set' : '-')} tweaks=${r ? parse(r.video_tweaks).filter(c => c.is_tweak).length : '?'}`);
    }
  } finally {
    for (const id of Object.values(ids)) { try { Q.up({ id, status: 'Archived' }); } catch {} }
    await browser.close();
  }
  console.log(`\nPROBE sxr_m5b_client: pass=${pass} fail=${fail} ` + (fail ? 'FAIL' : 'OK') + (renderedLive ? '  [LIVE client surface]' : '  [handler-drive fallback]'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
