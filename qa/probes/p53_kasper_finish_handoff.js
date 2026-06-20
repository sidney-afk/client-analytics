// p53 — Kasper "Finish reviewing" hand-off lifecycle (cross-device, persisted).
//   1. Kasper decides every component (approve caption → Client Approval; request change on video
//      → Tweaks Needed + tweak), so Finish is allowed.
//   2. Finish stamps kasper_finished_at (persisted) → card hands off to SMM, sits in "Tweaks
//      pending" (FINISHED), and does NOT drag back across a reload.
//   3. SMM re-routes the video back to Kasper Approval → it's a FRESH ASK: the card un-finishes
//      and re-surfaces as needing his decision again.
const Q = require('./lib.js');
const PID = 'p_fin_' + Math.floor(Date.now() / 1000);

const kFinished = (kas, pid) => kas.evaluate((pid) => { const it = (_kasperState.items || []).find(x => x.post.id === pid); if (!it) return '__noitem__'; return { finished: !!_kasperIsFinished(it.post), undecided: _kasperUndecidedComps(it.post) }; }, pid);
const kReload = (kas) => kas.evaluate(async () => { try { await _kasperLoadReview(true); } catch (e) {} await new Promise(x => setTimeout(x, 1500)); });

(async () => {
  const S = Q.makeOk('P53 kasper finish-reviewing hand-off');
  const browser = await Q.launch();
  const kas = await Q.kasperPage(browser);
  try {
    await Q.up({ id: PID, name: 'FIN ' + PID.slice(-6), platforms: 'instagram', scheduled_date: '2026-06-29',
      video_status: 'Kasper Approval', graphic_status: 'Approved', caption_status: 'Kasper Approval', status: 'Kasper Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4',
      video_tweaks: '[]', caption_tweaks: '[]' });
    await Q.pollRaw(PID, r => r.video_status === 'Kasper Approval' && r.caption_status === 'Kasper Approval', 'video_status,caption_status');

    S.ok(await Q.kasperLoadHas(kas, PID), 'card in Kasper queue (video+caption at KA)');
    // both KA components are undecided → Finish blocked
    let st = await kFinished(kas, PID);
    S.ok(st.undecided && st.undecided.length === 2, 'both KA components undecided before decisions (got ' + JSON.stringify(st.undecided) + ')');

    // decide: approve caption → client, request change on video
    await kas.evaluate(async (pid) => { try { await _kasperApproveComp(pid, 'caption', 'client'); } catch (e) {} }, PID);
    await Q.pollRaw(PID, x => x.caption_status === 'Client Approval', 'caption_status');
    await kas.evaluate(async (pid) => { const it = (_kasperState.items || []).find(x => x.post.id === pid); if (it) { it._drafts = it._drafts || {}; it._drafts.video = 'Kasper: re-cut the open'; try { await _kasperRequestTweakComp(pid, 'video', false); } catch (e) {} } }, PID);
    await Q.pollRaw(PID, x => x.video_status === 'Tweaks Needed', 'video_status');
    st = await kFinished(kas, PID);
    S.ok(st.undecided && st.undecided.length === 0, 'no undecided components after decisions → Finish allowed');

    // 2) finish → hand-off
    const finRes = await kas.evaluate(async (pid) => { try { await _kasperDismiss(pid); return 'ok'; } catch (e) { return 'ERR ' + e.message; } }, PID);
    S.ok(finRes === 'ok', 'finish-reviewing call ok (' + finRes + ')');
    let r = await Q.pollRaw(PID, x => String(x.kasper_finished_at || '').trim() !== '', 'kasper_finished_at,video_status', 15000);
    S.ok(String(r.kasper_finished_at || '').trim() !== '', 'kasper_finished_at stamped + persisted in DB');
    S.ok(r.video_status === 'Tweaks Needed', 'finish wrote NO sub-status (video still Tweaks Needed)');

    // card is FINISHED and stays finished across a reload (no drag-back)
    await kReload(kas);
    st = await kFinished(kas, PID);
    S.ok(st !== '__noitem__' && st.finished === true, 'card is FINISHED (Tweaks pending) after reload — does not drag back');

    // 3) SMM re-routes the video back to Kasper Approval → fresh ask, un-finishes
    await Q.smmResolveTweak(PID, 'video', 'Kasper Approval');
    await Q.pollRaw(PID, x => x.video_status === 'Kasper Approval', 'video_status');
    await kReload(kas);
    st = await kFinished(kas, PID);
    S.ok(st !== '__noitem__' && st.finished === false, 'card UN-finishes when SMM re-routes a component back to Kasper Approval');
    S.ok(st.undecided && st.undecided.includes('video'), 'video re-surfaces as an undecided fresh ask (got ' + JSON.stringify(st.undecided) + ')');

    S.ok(kas._errs.length === 0, 'no JS errors (' + JSON.stringify(kas._errs.slice(0, 3)) + ')');
  } finally { try { await Q.archive(PID); } catch (e) {} await browser.close(); }
  process.exit(S.done());
})();
