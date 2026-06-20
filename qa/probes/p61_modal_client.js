// p61 — Comments/Notes MODAL — CLIENT side (the "sheet tab → clicks on comments" entry point,
// distinct from the Review tab). The client composer offers Comment vs Request-a-change.
//   • plain COMMENT on caption → NO status change (role client / audience client / not a tweak)
//   • REQUEST-A-CHANGE on caption → caption flips to Tweaks Needed (is_tweak true, has round)
//   • threaded REPLY → no status change; SMM sees everything the client posts.
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const PID = 'p_m61_' + TS;
const CMT = 'CLIENT-COMMENT-' + TS, REQ = 'CLIENT-CHANGEREQ-' + TS, REP = 'CLIENT-REPLY-' + TS;

const modalPost = (page, pid, o) => page.evaluate((a) => {
  if (_calOpenCommentsPid !== a.pid) openCalComments(a.pid);
  if (a.replyTo) { _calBeginReply(a.replyTo); }
  else { _calReplyTarget = null; if (a.comp) _calSetComposeComp(a.comp); if (a.isTweak != null) _calSetComposeIsTweak(!!a.isTweak); }
  const ta = document.getElementById('calCommentComposer'); if (!ta) return 'NO_COMPOSER';
  ta.value = a.body;
  try { _calSubmitComposer(); return 'ok'; } catch (e) { return 'ERR ' + e.message; }
}, { pid, ...o });
const rootIdByBody = async (pid, comp, needle) => { const r = await Q.rawRow(pid, comp + '_tweaks'); let a = []; try { a = JSON.parse(r[comp + '_tweaks'] || '[]'); } catch (e) {} const m = a.find(c => (c.body || '').includes(needle) && !c.parent_id); return m ? m.id : null; };

(async () => {
  const S = Q.makeOk('P61 comments modal — CLIENT');
  const browser = await Q.launch();
  const cli = await Q.clientPage(browser);
  const smm = await Q.smmPage(browser);
  try {
    await Q.up({ id: PID, name: 'M61 ' + TS, platforms: 'instagram', scheduled_date: '2026-06-29',
      video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Client Approval', status: 'Client Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4', caption_tweaks: '[]' });
    await Q.pollRaw(PID, r => r.caption_status === 'Client Approval', 'caption_status');
    await Q.waitForPost(cli, PID, "p=>p.caption_status==='Client Approval'");
    const role = await cli.evaluate(() => _calCommentRole());
    S.ok(role === 'client', 'client surface comment role is client (got ' + role + ')');

    // 1) plain comment → no status change
    S.ok(await modalPost(cli, PID, { comp: 'caption', isTweak: false, body: CMT }) === 'ok', 'client plain comment posted');
    let r = await Q.pollRaw(PID, x => (x.caption_tweaks || '').includes(CMT), 'caption_tweaks,caption_status', 12000);
    S.ok(r.caption_status === 'Client Approval', 'plain comment did NOT change status (still Client Approval)');
    let cap = JSON.parse(r.caption_tweaks || '[]');
    let mc = cap.find(c => (c.body || '').includes(CMT));
    S.ok(mc && mc.role === 'client' && mc.audience === 'client' && mc.is_tweak === false, 'comment: role client / audience client / not a tweak');

    // 2) request-a-change → caption flips to Tweaks Needed
    S.ok(await modalPost(cli, PID, { comp: 'caption', isTweak: true, body: REQ }) === 'ok', 'client request-a-change posted');
    r = await Q.pollRaw(PID, x => x.caption_status === 'Tweaks Needed' && (x.caption_tweaks || '').includes(REQ), 'caption_status,caption_tweaks', 15000);
    S.ok(r.caption_status === 'Tweaks Needed', 'request-a-change FLIPS caption → Tweaks Needed');
    cap = JSON.parse(r.caption_tweaks || '[]');
    const mq = cap.find(c => (c.body || '').includes(REQ));
    S.ok(mq && mq.is_tweak === true && mq.role === 'client' && typeof mq.round === 'number', 'change-request: is_tweak true + role client + has round');

    // 3) reply to the change-request → no further status change
    const reqRootId = await rootIdByBody(PID, 'caption', REQ);
    S.ok(await modalPost(cli, PID, { replyTo: reqRootId, body: REP }) === 'ok', 'client reply posted');
    r = await Q.pollRaw(PID, x => (x.caption_tweaks || '').includes(REP), 'caption_tweaks,caption_status', 12000);
    cap = JSON.parse(r.caption_tweaks || '[]');
    const mr = cap.find(c => (c.body || '').includes(REP));
    S.ok(mr && mr.parent_id === reqRootId && mr.is_tweak !== true, 'reply threaded under the change-request, not itself a tweak');
    S.ok(r.caption_status === 'Tweaks Needed', 'reply left status unchanged (still Tweaks Needed)');

    // 4) SMM sees all three client posts
    await Q.waitForPost(smm, PID);
    const smmView = await smm.evaluate(async (a) => { for (let i = 0; i < 12; i++) { try { await loadCalendarPosts(); } catch (e) {} await new Promise(x => setTimeout(x, 700)); } const p = (calState.posts || []).find(x => x.id === a.pid); if (!p) return null; const bodies = (_calCommentsForView(p, 'caption') || []).map(c => c.body || ''); return { c: bodies.some(b => b.includes(a.CMT)), q: bodies.some(b => b.includes(a.REQ)), r: bodies.some(b => b.includes(a.REP)) }; }, { pid: PID, CMT, REQ, REP });
    S.ok(smmView && smmView.c && smmView.q && smmView.r, 'SMM sees the client comment + change-request + reply');

    S.ok(cli._errs.length === 0 && smm._errs.length === 0, 'no JS errors (' + JSON.stringify([...cli._errs, ...smm._errs].slice(0, 3)) + ')');
  } finally {
    try { const r = await Q.rawRow(PID, 'caption_tweaks'); let a = []; try { a = JSON.parse(r.caption_tweaks || '[]'); } catch (e) {} const tomb = a.map(c => Object.assign({}, c, { deleted: true, updated_at: new Date().toISOString() })); await Q.up({ id: PID, caption_tweaks: JSON.stringify(tomb), status: 'Archived' }); } catch (e) {}
    await browser.close();
  }
  process.exit(S.done());
})();
