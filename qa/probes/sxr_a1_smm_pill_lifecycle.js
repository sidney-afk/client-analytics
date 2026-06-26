// sxr_a1_smm_pill_lifecycle.js — drive the REAL SMM per-component status-pill
// menu (click pill → menu → pick status) through EVERY forward transition of the
// VIDEO component, reading back the live sample_reviews row + audit events at
// each step. Asserts overall = worst-of(video, graphic) and that the overall
// NEVER leaves the 6-status samples vocabulary (never Scheduled/Posted).
//
// Graphic is pinned Approved so overall tracks the (worse) video at each step;
// then a final graphic→In Progress proves worst-of switches dynamically.
//
// Scoped to sidneylaruel; unique sr_a1_* id; archived on exit; 0 app JS errors.
const Q = require('../sxr_courier_lib.js');

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else fail++; console.log((c ? '  PASS ' : '  FAIL ') + m + (!c && x !== undefined ? '  -> ' + JSON.stringify(x) : '')); };
const rowOf = (id) => { try { const r = Q.supa('id=eq.' + encodeURIComponent(id) + '&client=eq.sidneylaruel&select=*'); return Array.isArray(r) && r[0] ? r[0] : null; } catch { return null; } };
async function waitRow(id, pred, ms = 22000) { return Q.poll(() => { const r = rowOf(id); return (r && pred(r)) ? r : false; }, ms) || rowOf(id); }
// Poll the audit table for a status_change row on the given component carrying to_status.
function statusEvents(id, comp) {
  try { return Q.supaEvents('client=eq.sidneylaruel&sample_id=eq.' + encodeURIComponent(id) + '&action=eq.status_change&component=eq.' + comp + '&select=from_status,to_status,created_at&order=created_at.desc&limit=20'); }
  catch { return []; }
}
async function waitEvent(id, comp, toStatus, ms = 20000) {
  return Q.poll(() => { const ev = statusEvents(id, comp); return (Array.isArray(ev) && ev.some(e => e.to_status === toStatus)) ? ev : false; }, ms) || statusEvents(id, comp);
}

async function cardReady(page, id, tries = 25) {
  for (let i = 0; i < tries; i++) {
    if (await page.evaluate((id) => !!document.querySelector(`.sxr-card.is-editable[data-sxr-id="${id}"]`), id)) return true;
    await page.waitForTimeout(900);
  }
  return false;
}
// Drive the REAL pill → menu → option click. Returns the option set seen.
async function pickStatus(page, id, comp, status) {
  await page.evaluate(({ id, comp }) => {
    const btn = document.querySelector(`.sxr-card[data-sxr-id="${id}"] .sxr-pill-btn[data-sxr-comp-pill="${comp}"]`);
    if (btn) btn.click();
  }, { id, comp });
  await page.waitForTimeout(180);
  return await page.evaluate((status) => {
    const menu = document.querySelector('.cal-fld-status-menu');
    if (!menu) return { ok: false, reason: 'no menu opened' };
    const opts = Array.from(menu.querySelectorAll('.cal-fld-status-item'));
    const opt = opts.find(b => b.textContent.trim() === status);
    if (!opt) return { ok: false, reason: 'no option', opts: opts.map(b => b.textContent.trim()) };
    opt.click();
    return { ok: true };
  }, status);
}

(async () => {
  const id = 'sr_a1_' + Date.now();
  const ts = new Date().toISOString();
  // video In Progress, graphic pinned Approved → overall tracks video (worst-of).
  const seed = Q.up({
    id, name: 'A1 pill lifecycle', order_index: '1',
    asset_url: 'https://example.com/a1.mp4', thumbnail_url: 'https://via.placeholder.com/320x180.png',
    video_status: 'In Progress', graphic_status: 'Approved', status: 'In Progress', created_at: ts,
  });
  ok(seed && seed.ok === true, 'seed live sample (video In Progress, graphic Approved)', JSON.stringify(seed).slice(0, 140));

  const browser = await Q.launch();
  try {
    const page = await Q.smm(browser, 'sidneylaruel');
    ok(await cardReady(page, id), 'SMM surface rendered the editable card', String(true));

    // The forward video walk via the real pill menu. Each step: pick → DB read-back
    // → overall == video status (worst-of) → audit status_change row written.
    const walk = ['For SMM Approval', 'Kasper Approval', 'Client Approval', 'Approved'];
    for (const status of walk) {
      const picked = await pickStatus(page, id, 'video', status);
      ok(picked.ok, `pill menu: picked video → "${status}"`, picked);
      const r = await waitRow(id, x => _norm(x.video_status) === status);
      ok(r && _norm(r.video_status) === status, `video_status persisted "${status}" (live DB)`, r && r.video_status);
      ok(r && _norm(r.status) === status, `overall = worst-of = "${status}" (graphic Approved)`, r && r.status);
      // Overall never leaves the samples vocabulary.
      ok(r && ['In Progress', 'For SMM Approval', 'Kasper Approval', 'Client Approval', 'Tweaks Needed', 'Approved'].includes(_norm(r.status)),
        'overall stays within the 6-status samples set (never Scheduled/Posted)', r && r.status);
      const ev = await waitEvent(id, 'video', status);
      ok(Array.isArray(ev) && ev.some(e => e.to_status === status), `audit status_change row written (video → ${status})`, Array.isArray(ev) ? ev.slice(0, 3) : ev);
      // kasper_seen bookkeeping: routing to Kasper Approval records the component.
      if (status === 'Kasper Approval') {
        ok(r && String(r.kasper_seen || '').split(',').map(s => s.trim()).includes('video'),
          'routing to Kasper Approval records kasper_seen=video', r && r.kasper_seen);
      }
    }

    // worst-of switches dynamically: video Approved + graphic→In Progress ⇒ overall In Progress.
    const pg = await pickStatus(page, id, 'graphic', 'In Progress');
    ok(pg.ok, 'pill menu: picked graphic → "In Progress"', pg);
    const r2 = await waitRow(id, x => _norm(x.graphic_status) === 'In Progress' && _norm(x.status) === 'In Progress');
    ok(r2 && _norm(r2.status) === 'In Progress', 'overall flips to In Progress (worst-of now tracks graphic)', r2 && { v: r2.video_status, g: r2.graphic_status, o: r2.status });
    ok(r2 && _norm(r2.video_status) === 'Approved', 'video stays Approved while overall drops (per-component independence)', r2 && r2.video_status);

    ok(Q.appErrs(page).length === 0, 'no app JS errors', JSON.stringify(Q.appErrs(page).slice(0, 6)));
    const fin = rowOf(id);
    console.log('  final:', JSON.stringify(fin && { video: fin.video_status, graphic: fin.graphic_status, overall: fin.status, kasper_seen: fin.kasper_seen }));
  } finally {
    Q.up({ id, status: 'Archived' });
    await browser.close();
  }
  console.log(`PROBE sxr_a1_smm_pill_lifecycle: pass=${pass} fail=${fail} ` + (fail ? 'FAIL' : 'OK'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });

// status normalize (matches _calNormStatus's trim; statuses are already canonical case here)
function _norm(s) { return String(s == null ? '' : s).trim(); }
