// sxr_d1_client_gating.js — the CLIENT SHARE surface render-gating, across the
// full status spectrum, on one live client page (?c=Sidney Laruel&v=sample-reviews):
//   • Client Approval comp → ACTIVE review panel (Approve + Request-change);
//   • For SMM Approval / Kasper Approval comp → read-only "in progress" mini line,
//     NO action buttons;
//   • Approved comp → terminal panel, NO action buttons;
//   • all-In-Progress sample → NOT client-ready → NO review body at all;
//   • across every client card: NO field editors leak (no <input>/<textarea>,
//     status pills are read-only spans not buttons, no drag grips);
//   • internal SMM notes never render on the client surface.
//
// Scoped to sidneylaruel; unique sr_d1_* ids; archived on exit; 0 app JS errors.
const Q = require('../sxr_courier_lib.js');

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else fail++; console.log((c ? '  PASS ' : '  FAIL ') + m + (!c && x !== undefined ? '  -> ' + JSON.stringify(x) : '')); };

(async () => {
  const stamp = Date.now();
  const ids = {
    active: 'sr_d1_active_' + stamp,    // video Client Approval → active panel
    inprog: 'sr_d1_inprog_' + stamp,    // video For SMM Approval, graphic In Progress → ready, read-only
    done: 'sr_d1_done_' + stamp,        // both Approved → terminal
    hidden: 'sr_d1_hidden_' + stamp,    // both In Progress → not client-ready, no review body
  };
  const ts = new Date().toISOString();
  const INTERNAL_NOTE = 'INTERNAL ONLY secret SMM note ' + stamp;
  const internalTweak = JSON.stringify([{ id: 'c_' + stamp, parent_id: null, author: 'SMM', role: 'smm', is_tweak: false, audience: 'internal', body: INTERNAL_NOTE, created_at: ts, updated_at: ts, done: false }]);

  const seeds = [
    Q.up({ id: ids.active, name: 'D1 active', order_index: '1', asset_url: 'https://example.com/v.mp4', thumbnail_url: 'https://via.placeholder.com/320x180.png', video_status: 'Client Approval', graphic_status: 'Kasper Approval', status: 'Kasper Approval', video_tweaks: internalTweak, created_at: ts }),
    Q.up({ id: ids.inprog, name: 'D1 inprog', order_index: '2', asset_url: 'https://example.com/v.mp4', thumbnail_url: 'https://via.placeholder.com/320x180.png', video_status: 'For SMM Approval', graphic_status: 'In Progress', status: 'In Progress', created_at: ts }),
    Q.up({ id: ids.done, name: 'D1 done', order_index: '3', asset_url: 'https://example.com/v.mp4', thumbnail_url: 'https://via.placeholder.com/320x180.png', video_status: 'Approved', graphic_status: 'Approved', status: 'Approved', created_at: ts }),
    Q.up({ id: ids.hidden, name: 'D1 hidden', order_index: '4', asset_url: 'https://example.com/v.mp4', thumbnail_url: 'https://via.placeholder.com/320x180.png', video_status: 'In Progress', graphic_status: 'In Progress', status: 'In Progress', created_at: ts }),
  ];
  ok(seeds.every(s => s && s.ok === true), 'seed 4 live samples spanning the status spectrum', seeds.map(s => s && s.ok));

  const browser = await Q.launch();
  try {
    const page = await Q.client(browser, 'Sidney Laruel');

    // Wait for the client surface to render our cards. (_isClientLink is module-
    // scoped, not on window; the client surface is proven by cards rendering
    // READ-ONLY — none carry the SMM's .is-editable class.)
    // The client surface is the calendar review LIST: collapsible
    // .cal-review-card[data-sxr-review-pid] kcards (NOT the SMM .sxr-card strip).
    let state = {};
    for (let i = 0; i < 30; i++) {
      state = await page.evaluate((ids) => {
        const card = (id) => document.querySelector(`.cal-review-card[data-sxr-review-pid="${id}"]`);
        return {
          active: !!card(ids.active), inprog: !!card(ids.inprog), done: !!card(ids.done), hidden: !!card(ids.hidden),
          anyEditable: !!document.querySelector('.sxr-card.is-editable'),
        };
      }, ids);
      if (state.active) break;
      await page.waitForTimeout(900);
    }
    ok(state.active && state.inprog && state.done, 'in-review + finished samples all render on the client surface', state);
    ok(state.hidden === false, 'an all-In-Progress sample is NOT client-ready (no review card at all)', state);
    ok(state.anyEditable === false, 'client cards are READ-ONLY (none carry the SMM .is-editable class)', state);

    // Cards start collapsed (like the calendar) — expand the three rendered ones
    // so their per-component review panels are in the DOM to inspect.
    await page.evaluate((ids) => {
      ['active', 'inprog', 'done'].forEach(k => { const s = document.querySelector(`.cal-review-card[data-sxr-review-pid="${ids[k]}"] .kcard-strip`); if (s) s.click(); });
    }, ids);
    await page.waitForTimeout(450);

    // ── per-card render state ──
    const view = await page.evaluate((ids) => {
      const panelInfo = (id) => {
        const card = document.querySelector(`.cal-review-card[data-sxr-review-pid="${id}"]`);
        if (!card) return null;
        const body = card.querySelector('.cal-review-body');
        const vp = card.querySelector('.cal-review-panel[data-sxr-cl-comp="video"]');
        const gp = card.querySelector('.cal-review-panel[data-sxr-cl-comp="graphic"]');
        const approveBtns = card.querySelectorAll('.cal-review-approve-btn').length;
        const tweakBtns = card.querySelectorAll('.cal-review-tweak-btn').length;
        return {
          hasBody: !!body,
          vState: vp ? vp.getAttribute('data-state') : null,
          vMini: vp ? vp.classList.contains('cal-review-panel-mini') : null,
          approveBtns, tweakBtns,
          // FIELD-editor leak checks (whole card). The active review panel
          // legitimately has a change-request composer <textarea> (no data-sxr-fld);
          // a leak is specifically a bound FIELD editor (data-sxr-fld).
          fieldEditors: card.querySelectorAll('input[data-sxr-fld], textarea[data-sxr-fld]').length,
          pillButtons: card.querySelectorAll('.sxr-pill-btn').length,
          grips: card.querySelectorAll('.sxr-grip, [draggable="true"]').length,
        };
      };
      return { active: panelInfo(ids.active), inprog: panelInfo(ids.inprog), done: panelInfo(ids.done), hidden: panelInfo(ids.hidden) };
    }, ids);

    // active (video Client Approval): active panel with Approve + Request controls.
    ok(view.active && view.active.hasBody && view.active.approveBtns >= 1 && view.active.tweakBtns >= 1,
      'Client-Approval comp → ACTIVE review panel (Approve + Request controls)', view.active);

    // inprog (video For SMM Approval): ready (one comp left In Progress) → review body present,
    // but the video panel is the read-only mini line, NO action buttons.
    ok(view.inprog && view.inprog.hasBody === true, 'For-SMM-Approval sample IS client-ready (review body present)', view.inprog);
    ok(view.inprog && view.inprog.vMini === true && view.inprog.vState === 'readonly', 'For-SMM-Approval comp → read-only "in progress" mini line', view.inprog);
    ok(view.inprog && view.inprog.approveBtns === 0 && view.inprog.tweakBtns === 0, 'For-SMM-Approval / In-Progress sample exposes NO client action buttons', view.inprog);

    // done (both Approved): terminal panels, NO action buttons.
    ok(view.done && view.done.hasBody === true && view.done.approveBtns === 0 && view.done.tweakBtns === 0,
      'Approved sample → terminal panels, NO action buttons', view.done);

    // hidden (both In Progress): NOT client-ready → NO review body at all.
    ok(view.hidden ? view.hidden.hasBody === false : true, 'all-In-Progress sample → NO review body (not client-ready)', view.hidden);

    // No field editors leak on ANY client card.
    const leak = ['active', 'inprog', 'done', 'hidden'].map(k => view[k]).filter(Boolean);
    ok(leak.every(v => v.fieldEditors === 0), 'NO bound FIELD editors (data-sxr-fld input/textarea) on any client card', leak.map(v => v.fieldEditors));
    ok(leak.every(v => v.pillButtons === 0), 'status pills are read-only (no actionable pill buttons)', leak.map(v => v.pillButtons));
    ok(leak.every(v => v.grips === 0), 'NO drag grips on the client surface', leak.map(v => v.grips));

    // Internal SMM note never visible on the client surface.
    const noteLeak = await page.evaluate((needle) => document.body.textContent.includes(needle), INTERNAL_NOTE);
    ok(noteLeak === false, 'internal SMM note is NOT visible on the client surface', noteLeak);

    ok(Q.appErrs(page).length === 0, 'no app JS errors (client surface)', JSON.stringify(Q.appErrs(page).slice(0, 6)));
  } finally {
    for (const id of Object.values(ids)) { try { Q.up({ id, status: 'Archived' }); } catch {} }
    await browser.close();
  }
  console.log(`PROBE sxr_d1_client_gating: pass=${pass} fail=${fail} ` + (fail ? 'FAIL' : 'OK'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
