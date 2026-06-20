// p60 — Comments/Notes MODAL (openCalComments) — SMM side. The "clicks on Notes" entry point
// distinct from the Review tab. SMM posts:
//   • an INTERNAL note (Kasper/team) on caption → client does NOT see it
//   • a CLIENT-audience note on caption → client SEES it
//   • a threaded REPLY → inherits the thread's audience (client sees it)
//   • a VIDEO note → routes to Linear (intercepted; real Linear untouched)
// Verifies role=smm, audience tagging, threading (parent_id), and cross-surface visibility.
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const PID = 'p_m60_' + TS;
const INT = 'SMM-INTERNAL-' + TS, CLI = 'SMM-CLIENT-' + TS, REP = 'SMM-REPLY-' + TS, VID = 'SMM-VIDEO-' + TS;

const modalPost = (page, pid, o) => page.evaluate((a) => {
  if (_calOpenCommentsPid !== a.pid) openCalComments(a.pid);
  if (a.replyTo) { _calBeginReply(a.replyTo); }
  else { _calReplyTarget = null;
    if (a.comp) _calSetComposeComp(a.comp);
    if (a.audience) _calSetComposeAudience(a.audience);
    if (a.isTweak != null) _calSetComposeIsTweak(!!a.isTweak); }
  const ta = document.getElementById('calCommentComposer');
  if (!ta) return 'NO_COMPOSER';
  ta.value = a.body;
  try { _calSubmitComposer(); return 'ok'; } catch (e) { return 'ERR ' + e.message; }
}, { pid, ...o });

const rootIdByBody = async (pid, comp, needle) => { const r = await Q.rawRow(pid, comp + '_tweaks'); let a = []; try { a = JSON.parse(r[comp + '_tweaks'] || '[]'); } catch (e) {} const m = a.find(c => (c.body || '').includes(needle) && !c.parent_id); return m ? m.id : null; };

(async () => {
  const S = Q.makeOk('P60 comments modal — SMM');
  const browser = await Q.launch();
  // SMM context with Linear interception
  const sctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, ignoreHTTPSErrors: true });
  await sctx.addInitScript(() => { try { localStorage.setItem('syncview_auth_v1', 'ok'); } catch (e) {} });
  const linear = [];
  for (const wh of ['linear-add-comment', 'linear-set-status']) await sctx.route('**/webhook/' + wh, async (r) => { let b = {}; try { b = JSON.parse(r.request().postData() || '{}'); } catch (e) {} linear.push({ wh, b }); await r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });
  const smm = await sctx.newPage(); smm._errs = [];
  smm.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) smm._errs.push(m.text()); });
  smm.on('pageerror', e => smm._errs.push(String(e && e.message)));
  await smm.goto('http://localhost:8000/index.html?v2debug=1#calendar/sidneylaruel', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await smm.waitForFunction(() => window.calV2Status && window.calV2Status().subscribed, { timeout: 20000 }).catch(() => {});
  await smm.waitForTimeout(2500);
  const cli = await Q.clientPage(browser);
  try {
    await Q.up({ id: PID, name: 'M60 ' + TS, platforms: 'instagram', scheduled_date: '2026-06-29',
      video_status: 'For SMM Approval', graphic_status: 'Approved', caption_status: 'Client Approval', status: 'For SMM Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4',
      linear_issue_id: 'https://linear.app/syn/issue/TEST-60/video', video_tweaks: '[]', caption_tweaks: '[]' });
    await Q.pollRaw(PID, r => r.caption_status === 'Client Approval', 'caption_status');
    await Q.waitForPost(smm, PID);

    // 1) internal caption note
    S.ok(await modalPost(smm, PID, { comp: 'caption', audience: 'internal', body: INT }) === 'ok', 'SMM internal caption note posted');
    let r = await Q.pollRaw(PID, x => (x.caption_tweaks || '').includes(INT), 'caption_tweaks', 12000);
    let cap = []; try { cap = JSON.parse(r.caption_tweaks || '[]'); } catch (e) {}
    let mi = cap.find(c => (c.body || '').includes(INT));
    S.ok(mi && mi.role === 'smm' && mi.audience === 'internal' && mi.is_tweak === false, 'internal note: role smm / audience internal / not a tweak');

    // 2) client-audience caption note
    S.ok(await modalPost(smm, PID, { comp: 'caption', audience: 'client', body: CLI }) === 'ok', 'SMM client-audience caption note posted');
    r = await Q.pollRaw(PID, x => (x.caption_tweaks || '').includes(CLI), 'caption_tweaks', 12000);
    cap = JSON.parse(r.caption_tweaks || '[]');
    const mc = cap.find(c => (c.body || '').includes(CLI));
    S.ok(mc && mc.role === 'smm' && mc.audience === 'client', 'client note: role smm / audience client');

    // 3) threaded reply to the client note → inherits client audience
    const clientRootId = await rootIdByBody(PID, 'caption', CLI);
    S.ok(await modalPost(smm, PID, { replyTo: clientRootId, body: REP }) === 'ok', 'SMM reply posted');
    r = await Q.pollRaw(PID, x => (x.caption_tweaks || '').includes(REP), 'caption_tweaks', 12000);
    cap = JSON.parse(r.caption_tweaks || '[]');
    const mr = cap.find(c => (c.body || '').includes(REP));
    S.ok(mr && mr.parent_id === clientRootId, 'reply is threaded under the client root (parent_id matches)');

    // 4) video note routes to Linear (intercepted)
    S.ok(await modalPost(smm, PID, { comp: 'video', audience: 'internal', body: VID }) === 'ok', 'SMM video note posted');
    await Q.pollRaw(PID, x => (x.video_tweaks || '').includes(VID), 'video_tweaks', 12000);
    await smm.waitForTimeout(1500);
    S.ok(linear.some(c => c.wh === 'linear-add-comment' && JSON.stringify(c.b).includes(VID)), 'video note ROUTED to Linear (linear-add-comment)');
    S.ok(!linear.some(c => JSON.stringify(c.b).includes(INT) || JSON.stringify(c.b).includes(CLI)), 'caption notes did NOT route to Linear (no Linear for caption)');

    // 5) cross-surface: client sees the client note + reply, NOT the internal note
    await Q.waitForPost(cli, PID, "p=>p.id==='" + PID + "'");
    const cliView = await cli.evaluate(async (a) => { for (let i = 0; i < 10; i++) { try { await loadCalendarPosts(); } catch (e) {} await new Promise(x => setTimeout(x, 700)); } const p = (calState.posts || []).find(x => x.id === a.pid); if (!p) return null; const bodies = (_calCommentsForView(p, 'caption') || []).map(c => c.body || ''); return { sawClient: bodies.some(b => b.includes(a.CLI)), sawReply: bodies.some(b => b.includes(a.REP)), sawInternal: bodies.some(b => b.includes(a.INT)) }; }, { pid: PID, CLI, REP, INT });
    S.ok(cliView && cliView.sawClient && cliView.sawReply, 'client sees the client-audience note + its reply');
    S.ok(cliView && !cliView.sawInternal, 'client does NOT see the internal note');

    S.ok(smm._errs.length === 0 && cli._errs.length === 0, 'no JS errors (' + JSON.stringify([...smm._errs, ...cli._errs].slice(0, 3)) + ')');
  } finally {
    try { for (const comp of ['caption', 'video']) { const r = await Q.rawRow(PID, comp + '_tweaks'); let a = []; try { a = JSON.parse(r[comp + '_tweaks'] || '[]'); } catch (e) {} const tomb = a.map(c => Object.assign({}, c, { deleted: true, updated_at: new Date().toISOString() })); await Q.up({ id: PID, [comp + '_tweaks']: JSON.stringify(tomb) }); } await Q.up({ id: PID, status: 'Archived' }); } catch (e) {}
    await browser.close();
  }
  process.exit(S.done());
})();
