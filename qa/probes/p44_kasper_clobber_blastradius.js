// p44 — blast-radius of Kasper's whole-row write (the p42 clobber). Kasper request-change
// on VIDEO (status flip) fires CONCURRENTLY with a CLIENT COMMENT on CAPTION.
// Kasper's whole-row write recomputes the comment cells from its LOCAL view (which does NOT
// include the client's just-typed caption comment) BUT passes comments_base_at so the upsert
// 3-way-merges the comment cells. Expectation:
//   • video_status → Tweaks Needed (Kasper's status change lands)
//   • the client's caption COMMENT survives (comment cells are merged, not clobbered)
//   • caption_status stays Client Approval (neither actor changed it)
// i.e. the ONLY data-loss vector from Kasper's whole-row write is concurrent STATUS cells —
// comments are safe. That scopes the deferred n8n fix to status-cell recency merge only.
const Q = require('./lib.js');
const PID = 'p_kc_' + Math.floor(Date.now() / 1000);
const CMT = 'CLIENT-CMT-' + PID.slice(-6);

(async () => {
  const S = Q.makeOk('P44 kasper clobber blast-radius (comment is safe)');
  const browser = await Q.launch();
  const kas = await Q.kasperPage(browser);
  const cli = await Q.clientPage(browser);
  try {
    await Q.up({ id: PID, name: 'KC ' + PID.slice(-6), platforms: 'youtube', scheduled_date: '2026-06-29',
      video_status: 'Kasper Approval', graphic_status: 'Approved', caption_status: 'Client Approval', status: 'Kasper Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4', caption_tweaks: '[]' });
    await Q.pollRaw(PID, r => r.video_status === 'Kasper Approval' && r.caption_status === 'Client Approval', 'video_status,caption_status');

    S.ok(await Q.kasperLoadHas(kas, PID), 'card in Kasper queue (video at KA)');
    S.ok(await Q.clientHasCaption(cli, PID, 'Client Approval'), 'client has card (caption at CA)');
    await cli.evaluate(async (pid) => { const k = pid + '|caption'; for (let i = 0; i < 20; i++) { if (!_calReviewState.saving[k]) break; await new Promise(x => setTimeout(x, 200)); } }, PID);

    // FIRE BOTH AT ONCE: Kasper request-change on video + client comment on caption
    await Promise.all([
      kas.evaluate(async (pid) => { const it = (_kasperState.items || []).find(x => x.post.id === pid); if (it) { it._drafts = it._drafts || {}; it._drafts.video = 'Kasper: re-cut the intro'; try { await _kasperRequestTweakComp(pid, 'video', false); } catch (e) {} } }, PID),
      cli.evaluate((a) => { const p = (calState.posts || []).find(x => x.id === a.pid); if (p) { _calReviewState.drafts[a.pid + '|caption'] = a.body; try { _calReviewComment(a.pid, 'caption'); } catch (e) {} } }, { pid: PID, body: CMT }),
    ]);

    // wait for the video status flip AND the client comment to both be persisted
    const r = await Q.pollRaw(PID, x => x.video_status === 'Tweaks Needed' && (x.caption_tweaks || '').includes(CMT), 'video_status,caption_status,caption_tweaks', 22000);
    let cmts = []; try { cmts = JSON.parse(r.caption_tweaks || '[]'); } catch (e) {}
    const survived = cmts.find(c => (c.body || '').includes(CMT) && !c.deleted);
    console.log('final:', JSON.stringify({ video: r.video_status, caption: r.caption_status, clientCmtSurvived: !!survived }));

    S.ok(r.video_status === 'Tweaks Needed', 'video landed at Tweaks Needed (Kasper status change lands)');
    S.ok(!!survived, 'client CAPTION COMMENT survived Kasper whole-row write (comment cells 3-way merged)');
    S.ok(survived && survived.role === 'client' && survived.audience === 'client' && survived.is_tweak === false, 'surviving comment is client/client/not-a-tweak');
    S.ok(r.caption_status === 'Client Approval', 'caption_status untouched (still Client Approval)');

    S.ok(kas._errs.length === 0 && cli._errs.length === 0, 'no JS errors (' + JSON.stringify([...kas._errs, ...cli._errs].slice(0, 3)) + ')');
  } finally { try { await Q.archive(PID); } catch (e) {} await browser.close(); }
  process.exit(S.done());
})();
