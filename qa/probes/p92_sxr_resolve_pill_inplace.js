// p92 — SAMPLES sheet: resolving the last change-request routes the component
// and the card's sub-status pill updates IN PLACE (no reload).
//
// Regression probe for the stale-pill bug: _sxrUpdateCardStatusDisplay shipped
// as a "safe no-op until Surface 3/7" stub, so the SMM's "mark done → send to
// Kasper" flow moved the backend but the sheet card behind the Notes modal
// kept saying "Tweaks Needed" until a full refresh.
//
// Flow (real handlers, live backend, sidneylaruel only, archives its card):
//   seed video='Tweaks Needed' + one open client change-request
//   → openSxrComments → _sxrToggleCommentDone (chooser) → route "Kasper approval"
//   → assert WITHOUT reload: pill data-val/label/colour = Kasper Approval,
//     no lingering URGENT badge; then assert the backend row moved too.
const lib = require('../sxr_courier_lib.js');
const TS = Math.floor(Date.now() / 1000);
const PID = 'sr_p92_' + TS;
const TW = 'tw_p92_' + TS;
const now = () => new Date().toISOString();

(async () => {
  let pass = 0, fail = 0;
  const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓', msg); } else { fail++; console.log('  ✗', msg); } };
  const browser = await lib.launch();
  try {
    lib.up({
      id: PID, name: 'P92 pill in-place ' + TS,
      video_status: 'Tweaks Needed', graphic_status: 'Approved', status: 'Tweaks Needed',
      linear_issue_id: '', graphic_linear_issue_id: '',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/v.mp4',
      video_tweaks: JSON.stringify([{ id: TW, parent_id: null, author: 'Client', role: 'client', is_tweak: true, round: 1, audience: 'client', body: 'p92 client change-request', created_at: now(), updated_at: now(), done: false, done_at: '', done_by: '' }]),
    });
    await lib.poll(() => { const r = lib.supa(`id=eq.${PID}&select=video_status`); return r && r[0] && r[0].video_status === 'Tweaks Needed'; });

    const smm = await lib.smm(browser);
    await smm.waitForFunction((pid) => !!document.querySelector(`.cal-card[data-pid="${pid}"]`), PID, { timeout: 30000 });

    const before = await smm.evaluate((pid) => {
      const w = document.querySelector(`.cal-fld-substatus-wrap[data-substatus-pid="${pid}"][data-substatus-comp="video"]`);
      return w ? w.getAttribute('data-val') : null;
    }, PID);
    ok(before === 'Tweaks Needed', `sheet pill starts at Tweaks Needed (got ${before})`);

    const chooser = await smm.evaluate((a) => {
      try { openSxrComments(a.pid); _sxrToggleCommentDone(a.tw); } catch (e) { return 'ERR ' + e.message; }
      const ov = document.getElementById('resolveDestOverlay');
      return { active: !!(ov && ov.classList.contains('active')) };
    }, { pid: PID, tw: TW });
    ok(chooser && chooser.active === true, 'mark-done on the last open change-request opens the route chooser');

    await smm.evaluate(() => { const b = document.getElementById('resolveDestKasper'); if (b) b.click(); });
    await smm.waitForTimeout(400);

    const after = await smm.evaluate((pid) => {
      const w = document.querySelector(`.cal-fld-substatus-wrap[data-substatus-pid="${pid}"][data-substatus-comp="video"]`);
      const t = w && w.querySelector('.cal-fld-substatus-trigger');
      return w ? {
        val: w.getAttribute('data-val'),
        label: (w.querySelector('.cal-fld-substatus-label') || {}).textContent,
        cls: t ? t.className : '',
        urgent: !!w.querySelector('.cal-urgent-btn'),
      } : null;
    }, PID);
    ok(after && after.val === 'Kasper Approval', `pill data-val flips in place, NO reload (got ${after && after.val})`);
    ok(after && after.label === 'Kasper Approval', `pill label flips in place (got ${after && after.label})`);
    ok(after && /cal-fld-status-kasper-approval/.test(after.cls), 'pill colour class flips in place');
    ok(after && !after.urgent, 'URGENT badge does not linger after leaving Tweaks Needed');

    const r = await lib.poll(() => { const x = lib.supa(`id=eq.${PID}&select=video_status`); return x && x[0] && x[0].video_status === 'Kasper Approval' ? x[0] : null; });
    ok(!!r, 'backend row reaches Kasper Approval');
    let done = false; try { done = JSON.parse((lib.supa(`id=eq.${PID}&select=video_tweaks`)[0] || {}).video_tweaks || '[]').some(c => c.id === TW && c.done); } catch (e) {}
    ok(done, 'change-request marked done in the backend');
    ok(lib.appErrs(smm).length === 0, 'no app JS errors ' + JSON.stringify(lib.appErrs(smm)));
  } finally {
    try { await browser.close(); } catch (e) {}
    lib.archiveSafe(PID);
  }
  console.log(`\nP92 sxr resolve pill in-place: pass=${pass} fail=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('P92 FAILED', e); try { lib.archiveSafe(PID); } catch {} process.exit(1); });
