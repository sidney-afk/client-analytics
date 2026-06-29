// ot19_archived_hidden.js — VERIFIES BUG-3 FIX: archived rows never render.
// The GET webhook returns status='Archived' rows; the FE must hide them by status
// (not only via the session-local archive ledger), so a FRESH browser doesn't
// flood the Sheet with archived samples. Seed one active + one archived row, open
// a fresh SMM Sheet, and assert only the active one renders.
const L = require('../sxr_courier_lib.js');
const { launch, smm, up, supa, poll, appErrs, archiveSafe } = L;

const ACT = 'sr_ot19act_' + Date.now(), ARC = 'sr_ot19arc_' + Date.now();
const NACT = 'OT active ' + Date.now(), NARC = 'OT archived ' + Date.now();
const fails = [];
function ok(c, m, extra) { console.log((c ? 'PASS ' : 'FAIL ') + m + (extra ? '  ' + extra : '')); if (!c) fails.push(m); }

(async () => {
  up({ id: ACT, name: NACT, order_index: 1, asset_url: '', thumbnail_url: '', video_status: 'In Progress', graphic_status: 'In Progress', status: 'In Progress' });
  up({ id: ARC, name: NARC, order_index: 2, asset_url: '', thumbnail_url: '', video_status: 'In Progress', graphic_status: 'In Progress', status: 'Archived' });
  await poll(() => { const r = supa('id=in.(' + ACT + ',' + ARC + ')&select=id,status'); return (Array.isArray(r) && r.length >= 2) ? r : null; }, 12000, 800);
  // confirm the GET webhook actually returns the archived row (so the FE is what must filter)
  const getHasArchived = await (async () => {
    try { const cp = require('child_process'); const out = cp.execSync(`curl -s 'https://synchrosocial.app.n8n.cloud/webhook/sample-review-get?client=sidneylaruel'`, { encoding: 'utf8', timeout: 60000 }); const j = JSON.parse(out); return (j.items || []).some(p => p.id === ARC); } catch { return null; }
  })();
  ok(getHasArchived === true, 'precondition: GET webhook returns the archived row (FE must filter it)', 'getHasArchived=' + getHasArchived);

  const browser = await launch();
  try {
    const page = await smm(browser);   // fresh context → empty archive ledger
    await page.waitForFunction((id) => !!document.querySelector(`#sxrStrip .cal-card[data-pid="${id}"]`), ACT, { timeout: 12000 }).catch(() => {});
    const dom = await page.evaluate((ids) => ({
      active: !!document.querySelector(`#sxrStrip .cal-card[data-pid="${ids[0]}"]`),
      archived: !!document.querySelector(`#sxrStrip .cal-card[data-pid="${ids[1]}"]`)
    }), [ACT, ARC]);
    ok(dom.active, 'active sample renders in the Sheet');
    ok(!dom.archived, 'BUG-3 FIXED: archived sample does NOT render (hidden by status, fresh ledger)');

    ok((await appErrs(page)).length === 0, 'zero app JS errors', (await appErrs(page)).slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    ok(archiveSafe(ACT), 'cleanup: active seed archived');
    // ARC is already Archived; nothing to clean
    const stray = supa('id=eq.' + ACT + '&status=neq.Archived&select=id');
    ok(Array.isArray(stray) && stray.length === 0, 'safety sweep: no stray active row');
  }

  console.log('\nRESULT ot19_archived_hidden: ' + (fails.length ? 'FAIL (' + fails.length + ') — ' + fails.join('; ') : 'PASS'));
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('PROBE ERROR', e && e.stack || e); process.exit(2); });
