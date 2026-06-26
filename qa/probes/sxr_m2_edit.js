// sxr_m2_edit.js — M2: the Samples (Review) card is EDITABLE, persists via the
// optimistic field-patch save, and reorders — driven in a REAL browser against
// the LIVE backend (via the courier harness). Scoped to sidneylaruel; unique
// sr_m2_* ids; archives what it creates; asserts 0 app JS errors.
//
// Asserts:
//   • seed a sample -> open the smm surface -> type a new name + blur ->
//     POLL Supabase until the row's name updates
//   • edit creative_direction -> persists
//   • set thumbnail_url -> persists AND thumb_rev changed
//   • toggle hide_creative_direction -> persists 'TRUE'/'FALSE'
//   • set linear_issue_id to a url -> persists (plain URL, no Linear sync)
//   • drag-reorder two cards -> order_index persists and updated_at is UNCHANGED
//   • client-link surface shows the card read-only (an edit does not persist)
const Q = require('../sxr_courier_lib.js');

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else fail++; console.log((c ? '  PASS ' : '  FAIL ') + m + (!c && x !== undefined ? '  -> ' + x : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rowOf = (id) => { const r = Q.supa('id=eq.' + encodeURIComponent(id) + '&client=eq.sidneylaruel&select=*'); return Array.isArray(r) && r[0] ? r[0] : null; };

(async () => {
  const base = 'sr_m2_' + Date.now();
  const idA = base + '_a';
  const idB = base + '_b';
  const ts = new Date().toISOString();

  // Seed two live samples (the same write the FE makes), via the upsert webhook.
  const seedA = Q.up({ id: idA, name: 'M2 seed A', asset_url: 'https://example.com/a.mp4',
    thumbnail_url: 'https://via.placeholder.com/320x180.png?text=A', video_status: 'Kasper Approval',
    graphic_status: 'In Progress', creative_direction: 'orig direction', hide_creative_direction: 'FALSE',
    order_index: '1', created_at: ts });
  const seedB = Q.up({ id: idB, name: 'M2 seed B', asset_url: 'https://example.com/b.mp4',
    thumbnail_url: 'https://via.placeholder.com/320x180.png?text=B', video_status: 'In Progress',
    graphic_status: 'In Progress', order_index: '2', created_at: ts });
  ok(seedA && seedA.ok === true, 'seed sample A', JSON.stringify(seedA).slice(0, 140));
  ok(seedB && seedB.ok === true, 'seed sample B', JSON.stringify(seedB).slice(0, 140));

  const browser = await Q.launch();
  try {
    const page = await Q.smm(browser, 'sidneylaruel');

    // Wait for both seeded cards to render as EDITABLE cards.
    let rendered = false;
    for (let i = 0; i < 25; i++) {
      rendered = await page.evaluate((ids) => {
        const a = document.querySelector(`.sxr-card.is-editable[data-sxr-id="${ids[0]}"]`);
        const b = document.querySelector(`.sxr-card.is-editable[data-sxr-id="${ids[1]}"]`);
        return !!(a && b);
      }, [idA, idB]);
      if (rendered) break;
      await page.waitForTimeout(900);
    }
    ok(rendered, 'both seeded cards render as EDITABLE cards', String(rendered));

    // Confirm the editable surface really is present (name input + the field
    // editors), not the read-only meta.
    const surface = await page.evaluate((id) => {
      const card = document.querySelector(`.sxr-card.is-editable[data-sxr-id="${id}"]`);
      if (!card) return null;
      return {
        name: !!card.querySelector('input[data-sxr-fld="name"]'),
        asset: !!card.querySelector('input[data-sxr-fld="asset_url"]'),
        thumb: !!card.querySelector('input[data-sxr-fld="thumbnail_url"]'),
        cd: !!card.querySelector('textarea[data-sxr-fld="creative_direction"]'),
        eye: !!card.querySelector('.sxr-dir-toggle'),
        // Linear slots are now the calendar-style pile on the thumbnail (not body URL inputs).
        vidLinear: !!card.querySelector('.cal-linear-pile .cal-linear-btn-video'),
        graLinear: !!card.querySelector('.cal-linear-pile .cal-linear-btn-graphic'),
        pills: card.querySelectorAll('.cal-card-substatus-row [data-sxr-comp-pill]').length,
      };
    }, idA);
    ok(surface && surface.name && surface.asset && surface.thumb && surface.cd && surface.eye && surface.vidLinear && surface.graLinear,
      'editable surface has name + 2 media link-pills + creative dir + eye + the Linear thumbnail pile', JSON.stringify(surface));
    ok(surface && surface.pills === 2, 'both per-component status triggers render in the bottom sub-status row', JSON.stringify(surface));

    // ── 1) name field: type + blur → persists ──
    const newName = 'M2 renamed ' + Date.now();
    await page.evaluate(({ id, v }) => {
      const el = document.querySelector(`.sxr-card.is-editable[data-sxr-id="${id}"] input[data-sxr-fld="name"]`);
      el.focus(); el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    }, { id: idA, v: newName });
    let r = await Q.poll(() => { const x = rowOf(idA); return x && x.name === newName ? x : false; }, 18000);
    ok(r && r.name === newName, 'name persists to Supabase', r ? JSON.stringify(r.name) : 'no row');

    // ── 2) creative_direction: type + blur → persists ──
    const newCd = 'M2 creative dir ' + Date.now();
    await page.evaluate(({ id, v }) => {
      const el = document.querySelector(`.sxr-card.is-editable[data-sxr-id="${id}"] textarea[data-sxr-fld="creative_direction"]`);
      el.focus(); el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    }, { id: idA, v: newCd });
    r = await Q.poll(() => { const x = rowOf(idA); return x && x.creative_direction === newCd ? x : false; }, 18000);
    ok(r && r.creative_direction === newCd, 'creative_direction persists', r ? JSON.stringify(r.creative_direction) : 'no row');

    // ── 3) thumbnail_url: set + blur → persists AND thumb_rev changes ──
    const before = rowOf(idA);
    const prevThumbRev = before ? String(before.thumb_rev || '') : '';
    const newThumb = 'https://drive.google.com/file/d/M2THUMB' + Date.now() + '/view';
    await page.evaluate(({ id, v }) => {
      const el = document.querySelector(`.sxr-card.is-editable[data-sxr-id="${id}"] input[data-sxr-fld="thumbnail_url"]`);
      el.focus(); el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    }, { id: idA, v: newThumb });
    r = await Q.poll(() => { const x = rowOf(idA); return x && x.thumbnail_url === newThumb ? x : false; }, 18000);
    ok(r && r.thumbnail_url === newThumb, 'thumbnail_url persists', r ? JSON.stringify(r.thumbnail_url) : 'no row');
    ok(r && String(r.thumb_rev || '') !== '' && String(r.thumb_rev || '') !== prevThumbRev,
      'thumb_rev changed on a media-link write', JSON.stringify({ prev: prevThumbRev, now: r ? r.thumb_rev : null }));

    // ── 4) hide_creative_direction eye toggle → persists 'TRUE' ──
    await page.evaluate((id) => {
      document.querySelector(`.sxr-card.is-editable[data-sxr-id="${id}"] .sxr-dir-toggle`).click();
    }, idA);
    r = await Q.poll(() => { const x = rowOf(idA); return x && String(x.hide_creative_direction).toUpperCase() === 'TRUE' ? x : false; }, 18000);
    ok(r && String(r.hide_creative_direction).toUpperCase() === 'TRUE', "hide_creative_direction persists 'TRUE'", r ? JSON.stringify(r.hide_creative_direction) : 'no row');
    // …and toggling back → 'FALSE'
    await page.evaluate((id) => {
      document.querySelector(`.sxr-card.is-editable[data-sxr-id="${id}"] .sxr-dir-toggle`).click();
    }, idA);
    r = await Q.poll(() => { const x = rowOf(idA); return x && String(x.hide_creative_direction).toUpperCase() === 'FALSE' ? x : false; }, 18000);
    ok(r && String(r.hide_creative_direction).toUpperCase() === 'FALSE', "hide_creative_direction toggles back to 'FALSE'", r ? JSON.stringify(r.hide_creative_direction) : 'no row');

    // ── 5) Link a Linear VIDEO sub-issue via the thumbnail pile → title-row input
    //       → real blur (commit guards). Persists to linear_issue_id. ──
    Q.setSubissuesResp({ ok: true, parent: { status: 'In Progress', identifier: 'VID-1' }, subIssues: [] });
    const linUrl = 'https://linear.app/synchro/issue/VID-' + (Date.now() % 100000) + '/m2-link';
    await page.evaluate((id) => {
      const b = document.querySelector(`.sxr-card.is-editable[data-sxr-id="${id}"] .cal-linear-pile .cal-linear-btn-video`);
      if (b) b.click();
    }, idA);
    await page.waitForTimeout(220);
    await page.evaluate(({ id, v }) => {
      const el = document.querySelector(`.sxr-card.is-editable[data-sxr-id="${id}"] .cal-title-row .cal-linear-input`);
      if (el) { el.focus(); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.blur(); }
    }, { id: idA, v: linUrl });
    r = await Q.poll(() => { const x = rowOf(idA); return x && x.linear_issue_id === linUrl ? x : false; }, 18000);
    ok(r && r.linear_issue_id === linUrl, 'linking a Linear video sub-issue (thumbnail pile) persists', r ? JSON.stringify(r.linear_issue_id) : 'no row');

    // ── 6) drag-reorder A and B → order_index persists, updated_at UNCHANGED ──
    const aBeforeReorder = rowOf(idA);
    const bBeforeReorder = rowOf(idB);
    const aUpdatedBefore = aBeforeReorder ? aBeforeReorder.updated_at : null;
    const bUpdatedBefore = bBeforeReorder ? bBeforeReorder.updated_at : null;
    const aOrderBefore = aBeforeReorder ? String(aBeforeReorder.order_index) : null;
    const bOrderBefore = bBeforeReorder ? String(bBeforeReorder.order_index) : null;
    // Drive the drag through the wired DnD handlers (HTML5 DnD is awkward to
    // synthesise headless, so dispatch the exact event sequence the wiring
    // listens for: dragstart on A, dragover on B (past midpoint → moves A after
    // B), dragend on A → _sxrCommitDragOrder reads the DOM order + persists).
    const dragged = await page.evaluate((ids) => {
      const strip = document.querySelector('#sxrBody .sxr-grid');
      const a = document.querySelector(`.sxr-card.is-editable[data-sxr-id="${ids[0]}"]`);
      const b = document.querySelector(`.sxr-card.is-editable[data-sxr-id="${ids[1]}"]`);
      if (!strip || !a || !b) return { ok: false, reason: 'missing nodes' };
      const dt = new DataTransfer();
      a.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      const rb = b.getBoundingClientRect();
      a.classList.add('sxr-dragging'); // mirror what dragstart sets, in case the synthetic event didn't
      b.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt, clientX: rb.left + rb.width / 2, clientY: rb.bottom - 2 }));
      a.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
      const order = Array.from(strip.querySelectorAll('.sxr-card.is-editable')).map(c => c.getAttribute('data-sxr-id'));
      return { ok: true, domOrder: order };
    }, [idA, idB]);
    console.log('  drag domOrder:', JSON.stringify(dragged));
    // Poll until A's order_index differs from its pre-drag value (it moved after B).
    r = await Q.poll(() => {
      const a = rowOf(idA), b = rowOf(idB);
      if (!a || !b) return false;
      return (String(a.order_index) !== aOrderBefore || String(b.order_index) !== bOrderBefore) ? { a, b } : false;
    }, 20000);
    const aAfter = rowOf(idA), bAfter = rowOf(idB);
    ok(aAfter && bAfter && (String(aAfter.order_index) !== aOrderBefore || String(bAfter.order_index) !== bOrderBefore),
      'reorder persists a new order_index', JSON.stringify({ aBefore: aOrderBefore, aAfter: aAfter && aAfter.order_index, bBefore: bOrderBefore, bAfter: bAfter && bAfter.order_index }));
    // Card B is the clean proof: it was reordered but NOT field-edited, so the
    // reorder must leave its updated_at untouched. (Card A's updated_at legitimately
    // advances from the trailing debounced save of A's own field edits just before.)
    ok(bAfter && bAfter.updated_at === bUpdatedBefore,
      'reorder does NOT bump updated_at (card B — reordered, not edited)',
      JSON.stringify({ bBefore: bUpdatedBefore, bAfter: bAfter && bAfter.updated_at, aTrailingSave: aAfter && aAfter.updated_at }));

    ok(Q.appErrs(page).length === 0, 'no app JS errors (SMM surface)', JSON.stringify(Q.appErrs(page).slice(0, 5)));

    // Read the live client_review_token (if any) so the client surface link is valid.
    const token = await page.evaluate((name) => {
      try { return String((window.clientMap && window.clientMap[name] && window.clientMap[name].client_review_token) || ''); } catch (e) { return ''; }
    }, 'Sidney Laruel');
    await page.close();

    // ── 7) client-link surface: card is READ-ONLY; an edit attempt doesn't persist ──
    const cpage = await Q.client(browser, 'Sidney Laruel', token || undefined);
    // The harness can't read the module-scoped client_review_token, so this opens
    // the client link WITHOUT a token. Correct behaviour is then EITHER: the token
    // gate blocks it ("This link isn't valid", if a token is set) OR it renders the
    // card read-only (if no token is set). It must NEVER be editable. (The full
    // with-token read-only render is exercised in the M3 client-review probe.)
    let cState = { found: false, blocked: false, editable: false, hasNameInput: false };
    for (let i = 0; i < 25; i++) {
      cState = await cpage.evaluate((id) => {
        const blocked = document.body.textContent.includes("This link isn't valid");
        const card = document.querySelector(`.sxr-card[data-sxr-id="${id}"]`);
        return { found: !!card, blocked, editable: card ? card.classList.contains('is-editable') : false, hasNameInput: card ? !!card.querySelector('input[data-sxr-fld="name"]') : false };
      }, idA);
      if (cState.found || cState.blocked) break;
      await cpage.waitForTimeout(900);
    }
    ok(cState.blocked || cState.found, 'client link resolves (token-gate-blocked, or renders)', JSON.stringify(cState));
    ok(cState.editable === false && cState.hasNameInput === false, 'client-link card is NOT editable (read-only or blocked)', JSON.stringify(cState));

    // Attempt an edit at the HANDLER level on the client surface — must NOT persist.
    const clientAttemptName = 'CLIENT SHOULD NOT PERSIST ' + Date.now();
    const rowBeforeClient = rowOf(idA);
    const nameBeforeClient = rowBeforeClient ? rowBeforeClient.name : null;
    await cpage.evaluate(({ id, v }) => {
      // Call the field handlers directly with a synthetic element, simulating a
      // bypass attempt. The handler must no-op on a client link.
      try {
        const fake = { dataset: { sxrPid: id, sxrFld: 'name' }, value: v, closest: () => null };
        if (typeof _sxrOnFieldInput === 'function') _sxrOnFieldInput(fake);
        if (typeof _sxrOnFieldBlur === 'function') _sxrOnFieldBlur(fake);
        if (typeof _sxrFlushCardSave === 'function') _sxrFlushCardSave(id);
      } catch (e) {}
    }, { id: idA, v: clientAttemptName });
    await sleep(4000);
    const rowAfterClient = rowOf(idA);
    ok(rowAfterClient && rowAfterClient.name === nameBeforeClient && rowAfterClient.name !== clientAttemptName,
      'client-link edit attempt does NOT persist (handler-level guard)', JSON.stringify({ before: nameBeforeClient, after: rowAfterClient && rowAfterClient.name }));
    ok(Q.appErrs(cpage).length === 0, 'no app JS errors (client surface)', JSON.stringify(Q.appErrs(cpage).slice(0, 5)));
    await cpage.close();

    // Final read-back summary.
    const finalA = rowOf(idA);
    console.log('  final row A:', JSON.stringify(finalA && {
      name: finalA.name, creative_direction: finalA.creative_direction, thumbnail_url: finalA.thumbnail_url,
      thumb_rev: finalA.thumb_rev, hide_creative_direction: finalA.hide_creative_direction,
      linear_issue_id: finalA.linear_issue_id, order_index: finalA.order_index, updated_at: finalA.updated_at,
    }));
  } finally {
    Q.up({ id: idA, status: 'Archived' });
    Q.up({ id: idB, status: 'Archived' });
    await browser.close();
  }
  console.log(`PROBE sxr_m2_edit: pass=${pass} fail=${fail} ` + (fail ? 'FAIL' : 'OK'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
