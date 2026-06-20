// p45 — Approve-After-Tweaks (AAT) full lifecycle (Kasper → SMM badge → pre-cleared route → client).
//   1. Kasper "Approve after tweaks" on video → video=Tweaks Needed, kasper_approved_after_tweaks
//      records 'video', an internal kasper tweak is posted.
//   2. SMM sees the AAT badge (_calShowApprovedAfterTweaks true) while the editor fixes it.
//   3. SMM resolves the tweak straight to CLIENT (the pre-clearance lets her skip Kasper re-review).
//      Flag persists (history); badge still shows at Client Approval.
//   4. Client approves → video=Approved; flag persists in DB but the badge now hides.
const Q = require('./lib.js');
const PID = 'p_aat_' + Math.floor(Date.now() / 1000);
const TWEAK = 'AAT-FIX-' + PID.slice(-6);

const showAAT = (page, pid, comp) => page.evaluate((a) => { const p = (calState.posts || []).find(x => x.id === a.pid); return p ? !!_calShowApprovedAfterTweaks(p, a.comp) : '__nopost__'; }, { pid, comp });
const aatFlag = async (pid) => (await Q.rawRow(pid, 'kasper_approved_after_tweaks')).kasper_approved_after_tweaks || '';

(async () => {
  const S = Q.makeOk('P45 approve-after-tweaks lifecycle');
  const browser = await Q.launch();
  const kas = await Q.kasperPage(browser);
  const smm = await Q.smmPage(browser);
  const cli = await Q.clientPage(browser);
  try {
    await Q.up({ id: PID, name: 'AAT ' + PID.slice(-6), platforms: 'youtube', scheduled_date: '2026-06-29',
      video_status: 'Kasper Approval', graphic_status: 'Approved', caption_status: 'Approved', status: 'Kasper Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4',
      video_tweaks: '[]', kasper_approved_after_tweaks: '' });
    await Q.pollRaw(PID, r => r.video_status === 'Kasper Approval', 'video_status');

    // 1) Kasper AAT on video
    S.ok(await Q.kasperLoadHas(kas, PID), 'card in Kasper queue (video at KA)');
    const aatRes = await kas.evaluate(async (a) => { const it = (_kasperState.items || []).find(x => x.post.id === a.pid); if (!it) return 'NO_ITEM'; it._drafts = it._drafts || {}; it._drafts.video = a.body; try { await _kasperApproveAfterTweaksComp(a.pid, 'video'); return 'ok'; } catch (e) { return 'ERR ' + e.message; } }, { pid: PID, body: TWEAK });
    S.ok(aatRes === 'ok', 'Kasper AAT call ok (' + aatRes + ')');
    let r = await Q.pollRaw(PID, x => x.video_status === 'Tweaks Needed' && (x.kasper_approved_after_tweaks || '').includes('video'), 'video_status,kasper_approved_after_tweaks,video_tweaks', 15000);
    S.ok(r.video_status === 'Tweaks Needed', 'AAT flips video → Tweaks Needed');
    S.ok((r.kasper_approved_after_tweaks || '').split(',').includes('video'), 'kasper_approved_after_tweaks records "video" (got "' + r.kasper_approved_after_tweaks + '")');
    let tw = []; try { tw = JSON.parse(r.video_tweaks || '[]'); } catch (e) {}
    const t = tw.find(c => (c.body || '').includes(TWEAK));
    S.ok(t && t.is_tweak === true && t.role === 'kasper' && t.audience === 'internal', 'AAT posts an internal kasper tweak');

    // 2) SMM sees the AAT badge while the editor works
    await Q.waitForPost(smm, PID, "p=>p.video_status==='Tweaks Needed'");
    S.ok((await showAAT(smm, PID, 'video')) === true, 'SMM sees the "approved after tweaks" badge (video at TN)');

    // 3) SMM resolves the tweak straight to CLIENT (pre-clearance → skip Kasper re-review)
    await Q.smmResolveTweak(PID, 'video', 'Client Approval');
    r = await Q.pollRaw(PID, x => x.video_status === 'Client Approval', 'video_status,kasper_approved_after_tweaks', 15000);
    S.ok(r.video_status === 'Client Approval', 'SMM routes pre-cleared video straight to Client Approval (skips Kasper)');
    S.ok((r.kasper_approved_after_tweaks || '').split(',').includes('video'), 'AAT flag persists as history at Client Approval');
    // card should NOT have bounced back into Kasper's review queue (it's pre-cleared)
    const backInKasper = await kas.evaluate(async (pid) => { try { await _kasperLoadReview(true); } catch (e) {} await new Promise(x => setTimeout(x, 1500)); return (_kasperState.items || []).some(x => x.post.id === pid && _calNormStatus(x.post.video_status || '') === 'Kasper Approval'); }, PID);
    S.ok(!backInKasper, 'card did NOT bounce back to Kasper for re-review (AAT honoured)');
    // badge still shows at Client Approval (work not finished yet)
    await Q.waitForPost(smm, PID, "p=>p.video_status==='Client Approval'");
    S.ok((await showAAT(smm, PID, 'video')) === true, 'AAT badge still shows at Client Approval (work in flight)');

    // 4) client approves video → Approved; flag persists in DB but badge hides
    await Q.waitForPost(cli, PID, "p=>p.video_status==='Client Approval'");
    await cli.evaluate(async (pid) => { const k = pid + '|video'; for (let i = 0; i < 20; i++) { if (!_calReviewState.saving[k]) break; await new Promise(x => setTimeout(x, 200)); } }, PID);
    const apRes = await Q.clientApprove(cli, PID, 'video');
    S.ok(apRes === 'ok', 'client approve video ok (' + apRes + ')');
    r = await Q.pollRaw(PID, x => x.video_status === 'Approved', 'video_status,kasper_approved_after_tweaks', 15000);
    S.ok(r.video_status === 'Approved', 'client approval → video Approved');
    S.ok((r.kasper_approved_after_tweaks || '').split(',').includes('video'), 'AAT flag still PERSISTED in DB as history after Approved');
    await Q.waitForPost(smm, PID, "p=>p.video_status==='Approved'");
    S.ok((await showAAT(smm, PID, 'video')) === false, 'AAT badge now HIDDEN at Approved (clearance did its job)');

    S.ok(kas._errs.length === 0 && smm._errs.length === 0 && cli._errs.length === 0, 'no JS errors (' + JSON.stringify([...kas._errs, ...smm._errs, ...cli._errs].slice(0, 3)) + ')');
  } finally { try { await Q.archive(PID); } catch (e) {} await browser.close(); }
  process.exit(S.done());
})();
