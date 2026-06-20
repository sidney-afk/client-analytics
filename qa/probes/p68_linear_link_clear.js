// p68 — Linear link CLEAR sentinel, end-to-end. The upsert's link-preservation guard carries a
// stored link forward over a bare '' (so a stale echo can't wipe a link). To intentionally CLEAR
// a link, the frontend sends CAL_CLEAR_LINK_SENTINEL ('__CLEAR_LINK__') instead of ''. Verify:
//   • setting a link persists it
//   • clearing it leaves the DB link EMPTY (not the old URL, not the literal sentinel string)
const Q = require('./lib.js');
const PID = 'p_lc_' + Math.floor(Date.now() / 1000);
const URL = 'https://linear.app/syn/issue/TEST-68/clip-' + PID.slice(-5);

(async () => {
  const S = Q.makeOk('P68 linear link clear sentinel');
  const browser = await Q.launch();
  // intercept Linear webhooks defensively (link writes shouldn't push, but be safe)
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(() => { try { localStorage.setItem('syncview_auth_v1', 'ok'); } catch (e) {} });
  const linear = [];
  for (const wh of ['linear-set-status', 'linear-add-comment']) await ctx.route('**/webhook/' + wh, async (r) => { linear.push(wh); await r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });
  const smm = await ctx.newPage(); smm._errs = [];
  smm.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) smm._errs.push(m.text()); });
  smm.on('pageerror', e => smm._errs.push(String(e && e.message)));
  await smm.goto('http://localhost:8000/index.html?v2debug=1#calendar/sidneylaruel', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await smm.waitForFunction(() => window.calV2Status && window.calV2Status().subscribed, { timeout: 20000 }).catch(() => {});
  await smm.waitForTimeout(2500);

  try {
    await Q.up({ id: PID, name: 'LC ' + PID.slice(-6), platforms: 'instagram', scheduled_date: '2026-06-29',
      video_status: 'In Progress', graphic_status: 'In Progress', caption_status: 'In Progress', status: 'In Progress',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4', linear_issue_id: '' });
    await Q.pollRaw(PID, r => r.id === PID, 'id');
    await Q.waitForPost(smm, PID);

    // 1) set the Linear link
    await smm.evaluate((a) => { try { delete _calPendingEdits[a.pid]; const p = (calState.posts || []).find(x => x.id === a.pid); if (p) { p.linear_issue_id = a.URL; _calPendingEdits[a.pid] = { linear_issue_id: a.URL }; _calFlushCardSave(a.pid); } } catch (e) {} }, { pid: PID, URL });
    let r = await Q.pollRaw(PID, x => String(x.linear_issue_id || '') === URL, 'linear_issue_id', 15000);
    S.ok(String(r.linear_issue_id || '') === URL, 'Linear link set + persisted');

    // 2) clear the Linear link (frontend converts '' → sentinel; backend must clear)
    await smm.evaluate((a) => { try { delete _calPendingEdits[a.pid]; const p = (calState.posts || []).find(x => x.id === a.pid); if (p) { p.linear_issue_id = ''; _calPendingEdits[a.pid] = { linear_issue_id: '' }; _calFlushCardSave(a.pid); } } catch (e) {} }, { pid: PID });
    r = await Q.pollRaw(PID, x => String(x.linear_issue_id || '').trim() === '' || String(x.linear_issue_id || '').includes('__CLEAR_LINK__'), 'linear_issue_id', 15000);
    console.log('after clear, linear_issue_id =', JSON.stringify(r.linear_issue_id));
    S.ok(String(r.linear_issue_id || '').trim() === '', 'clearing the link leaves DB EMPTY (not the old URL)');
    S.ok(!String(r.linear_issue_id || '').includes('__CLEAR_LINK__'), 'the literal sentinel was NOT stored in the DB (backend processed it)');

    S.ok(linear.length === 0, 'no Linear push from a pure link edit (got ' + JSON.stringify(linear) + ')');
    S.ok(smm._errs.length === 0, 'no JS errors (' + JSON.stringify(smm._errs.slice(0, 3)) + ')');
  } finally { try { await Q.archive(PID); } catch (e) {} await browser.close(); }
  process.exit(S.done());
})();
