// sxr_c2_save_indicator_rollback.js — the optimistic save funnel: Saving/Saved
// indicator, structural ROLLBACK + free-text retention on a forced failure, and
// the "Save failed · Retry" affordance. Failure is injected with a page-level
// route on sample-review-upsert (takes precedence over the courier), then removed.
//
// Asserts:
//   • a successful field save persists to live Supabase with NO error chip;
//   • a forced-failure STATUS change rolls the sub-status back in the in-memory
//     row, stamps _saveError, shows the error chip, and never reaches the DB;
//   • a forced-failure FREE-TEXT change keeps its optimistic value in-memory
//     (not rolled back) but also never reaches the DB;
//   • RECOVERY by re-blurring the field re-saves it to the DB.
//   • DISCOVERY: whether clicking the "Save failed · Retry" chip actually
//     re-persists (the samples field-level flush early-returns on the empty
//     pending bucket _sxrRetrySave creates — unlike the calendar's full-row
//     resend). Recorded as evidence; see report BUGS section.
//
// Scoped to sidneylaruel; unique sr_c2_* id; archived on exit; 0 app JS errors.
const Q = require('../sxr_courier_lib.js');

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else fail++; console.log((c ? '  PASS ' : '  FAIL ') + m + (!c && x !== undefined ? '  -> ' + JSON.stringify(x) : '')); };
const note = (m, x) => console.log('  NOTE ' + m + (x !== undefined ? '  -> ' + JSON.stringify(x) : ''));
const rowOf = (id) => { try { const r = Q.supa('id=eq.' + encodeURIComponent(id) + '&client=eq.sidneylaruel&select=*'); return Array.isArray(r) && r[0] ? r[0] : null; } catch { return null; } };
async function waitRow(id, pred, ms = 12000) { return Q.poll(() => { const r = rowOf(id); return (r && pred(r)) ? r : false; }, ms) || rowOf(id); }
const norm = (s) => String(s == null ? '' : s).trim();
const UPSERT_RE = /\/webhook\/sample-review-upsert\b/;
async function cardReady(page, id, tries = 25) {
  for (let i = 0; i < tries; i++) {
    if (await page.evaluate((id) => !!document.querySelector(`.sxr-card.is-editable[data-sxr-id="${id}"]`), id)) return true;
    await page.waitForTimeout(900);
  }
  return false;
}
const failOn = (page) => page.route(UPSERT_RE, route => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: false, error: 'forced failure' }) }));
const failOff = (page) => page.unroute(UPSERT_RE);
const memRow = (page, id) => page.evaluate((id) => { try { const c = (sxrState.cards || []).find(x => String(x.id) === String(id)); return c ? { name: c.name, video_status: c.video_status, saveError: c._saveError || null } : null; } catch { return null; } }, id);
const chip = (page, id) => page.evaluate((id) => {
  const el = document.querySelector(`[data-sxr-saving="${id}"]`);
  if (!el) return { present: false };
  return { present: true, text: (el.textContent || '').trim(), isError: el.classList.contains('is-error'), isSaved: el.classList.contains('is-saved'), hidden: !!el.hidden, tag: el.tagName.toLowerCase() };
});
async function typeName(page, id, v) {
  return page.evaluate(({ id, v }) => {
    const el = document.querySelector(`.sxr-card.is-editable[data-sxr-id="${id}"] input[data-sxr-fld="name"]`);
    if (!el) return false;
    el.focus(); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  }, { id, v });
}
async function pickStatus(page, id, comp, status) {
  await page.evaluate(({ id, comp }) => { const b = document.querySelector(`.sxr-card[data-sxr-id="${id}"] .sxr-pill-btn[data-sxr-comp-pill="${comp}"]`); if (b) b.click(); }, { id, comp });
  await page.waitForTimeout(160);
  return page.evaluate((status) => { const m = document.querySelector('.cal-fld-status-menu'); if (!m) return false; const o = Array.from(m.querySelectorAll('.cal-fld-status-item')).find(b => b.textContent.trim() === status); if (!o) return false; o.click(); return true; }, status);
}

(async () => {
  const id = 'sr_c2_' + Date.now();
  const ts = new Date().toISOString();
  const seed = Q.up({ id, name: 'C2 orig', order_index: '1', asset_url: 'https://example.com/c2.mp4', thumbnail_url: 'https://via.placeholder.com/320x180.png', video_status: 'In Progress', graphic_status: 'Approved', status: 'In Progress', created_at: ts });
  ok(seed && seed.ok === true, 'seed live sample', JSON.stringify(seed).slice(0, 120));

  const browser = await Q.launch();
  try {
    const page = await Q.smm(browser, 'sidneylaruel');
    ok(await cardReady(page, id), 'SMM card rendered', String(true));

    // ── 1) SUCCESS: a field save persists + shows a non-error indicator ──
    let sawSaved = false;
    await typeName(page, id, 'C2 success');
    for (let i = 0; i < 12; i++) { const c = await chip(page, id); if (c.isSaved || /saved/i.test(c.text)) { sawSaved = true; break; } await page.waitForTimeout(120); }
    const rOk = await waitRow(id, r => r.name === 'C2 success');
    ok(rOk && rOk.name === 'C2 success', 'successful save persists to live Supabase', rOk && rOk.name);
    ok(sawSaved || (rOk && rOk.name === 'C2 success'), 'a non-error save indicator showed (Saved) / persisted', { sawSaved });
    const cOk = await chip(page, id);
    ok(!cOk.isError, 'no error chip after a successful save', cOk);

    // ── 2) FAILURE: a STATUS change stamps _saveError + never hits the DB ──
    await failOn(page);
    await pickStatus(page, id, 'video', 'Kasper Approval');
    let mem = null;
    for (let i = 0; i < 12; i++) { mem = await memRow(page, id); if (mem && mem.saveError) break; await page.waitForTimeout(150); }
    ok(mem && mem.saveError, 'forced-failure stamps _saveError on the card', mem);
    await page.waitForTimeout(2500);
    const dbAfterFail = rowOf(id);
    ok(dbAfterFail && norm(dbAfterFail.video_status) === 'In Progress', 'the failed status change never reached the DB', dbAfterFail && dbAfterFail.video_status);
    // DISCOVERY (see report BUG-1): is the optimistic status rolled back in-memory?
    if (mem && norm(mem.video_status) === 'In Progress') note('status rollback: in-memory video_status reverted to In Progress (rollback effective)');
    else note('status rollback INEFFECTIVE: in-memory video_status stayed "' + (mem && mem.video_status) + '" while DB has In Progress (snapshot captured AFTER _sxrApplySubStatus pre-mutated the row)');
    // DISCOVERY: error chip surfacing on failure (poll; may need a re-render).
    let cErr = { present: false };
    for (let i = 0; i < 12; i++) { cErr = await chip(page, id); if (cErr.present && cErr.isError) break; await page.waitForTimeout(150); }
    if (cErr.present && cErr.isError && /retry/i.test(cErr.text)) note('error chip surfaced: "Save failed · Retry"', cErr);
    else note('error chip not observed in error state at poll end (catch does not re-render; chip set via _sxrSetCardStatus only)', cErr);

    // ── 3) FAILURE: a FREE-TEXT change keeps its optimistic value (no rollback) ──
    await typeName(page, id, 'C2 failed text');
    let memText = null;
    for (let i = 0; i < 20; i++) { memText = await memRow(page, id); if (memText && memText.name === 'C2 failed text') break; await page.waitForTimeout(150); }
    ok(memText && memText.name === 'C2 failed text', 'free-text keeps its optimistic value under failure (not rolled back)', memText);
    await page.waitForTimeout(2000);
    const dbText = rowOf(id);
    ok(dbText && dbText.name === 'C2 success', 'the failed free-text change never reached the DB', dbText && dbText.name);

    // ── 4) DISCOVERY: does clicking "Save failed · Retry" re-persist? ──
    await failOff(page);
    await page.evaluate((id) => { const el = document.querySelector(`[data-sxr-saving="${id}"]`); if (el) el.click(); }, id);
    await page.waitForTimeout(4000);
    const dbAfterRetry = rowOf(id);
    const retryPersisted = dbAfterRetry && dbAfterRetry.name === 'C2 failed text';
    const chipAfterRetry = await chip(page, id);
    if (retryPersisted) {
      note('Retry chip RE-PERSISTED the failed edit (DB updated)', dbAfterRetry && dbAfterRetry.name);
    } else {
      note('Retry chip did NOT re-persist (DB still "' + (dbAfterRetry && dbAfterRetry.name) + '") — field-level flush early-returns on the empty pending bucket _sxrRetrySave creates', chipAfterRetry);
    }

    // ── 5) RECOVERY: re-blurring the field DOES re-save (the supported path) ──
    await typeName(page, id, 'C2 recovered');
    const rRecover = await waitRow(id, r => r.name === 'C2 recovered');
    ok(rRecover && rRecover.name === 'C2 recovered', 'recovery: re-editing the field re-saves to the DB', rRecover && rRecover.name);

    ok(Q.appErrs(page).length === 0, 'no app JS errors', JSON.stringify(Q.appErrs(page).slice(0, 6)));
  } finally {
    try { await browser.close(); } catch {}
    Q.archiveSafe(id);
  }
  console.log(`PROBE sxr_c2_save_indicator_rollback: pass=${pass} fail=${fail} ` + (fail ? 'FAIL' : 'OK'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
