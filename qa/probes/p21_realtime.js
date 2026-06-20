// p21 — §6/§14 realtime cross-surface: a change made elsewhere (the probe's upsert = "another
// device") must propagate LIVE to an open SMM page and an open client page via the realtime
// channel — WITHOUT the page calling loadCalendarPosts itself. Asserts calState reflects the
// change within the realtime window, and a brand-new card appears live.
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const PID = 'p_rt_' + TS;       // existing card whose status we flip
const NEWPID = 'p_rtnew_' + TS; // brand-new card created after the page is open

// read calState WITHOUT triggering a manual load
const liveStatus = (page, pid) => page.evaluate((pid) => {
  const p = (calState.posts || []).find(x => x.id === pid);
  return p ? p.caption_status : null;
}, pid);
const liveHas = (page, pid) => page.evaluate((pid) => (calState.posts || []).some(x => x.id === pid), pid);
const pollLive = async (page, fn, pred, ms = 20000) => { const t = Date.now(); let v;
  while (Date.now() - t < ms) { v = await fn(); if (pred(v)) return v; await new Promise(x => setTimeout(x, 700)); } return v; };

(async () => {
  const S = Q.makeOk('P21 realtime');
  const browser = await Q.launch();
  try {
    await Q.up({ id: PID, name: 'RT ' + TS, platforms: 'youtube', scheduled_date: '2026-06-29',
      video_status: 'Approved', graphic_status: 'Approved', caption_status: 'In Progress', status: 'In Progress',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4' });
    await Q.pollRaw(PID, r => r.caption_status === 'In Progress', 'caption_status');

    // ---- SMM realtime ----
    const smm = await Q.smmPage(browser);
    const subbed = await smm.evaluate(() => !!(window.calV2Status && window.calV2Status().subscribed));
    S.ok(subbed, 'SMM realtime channel subscribed');
    await pollLive(smm, () => liveHas(smm, PID), v => v === true);
    S.ok(await liveHas(smm, PID), 'SMM has the seed card loaded');

    // change status from "another device" (probe upsert), do NOT call loadCalendarPosts
    await Q.up({ id: PID, caption_status: 'Client Approval' });
    const smmLive = await pollLive(smm, () => liveStatus(smm, PID), v => v === 'Client Approval');
    S.ok(smmLive === 'Client Approval', 'SMM sees the status change LIVE via realtime (got ' + smmLive + ')');

    // brand-new card created elsewhere should appear live
    await Q.up({ id: NEWPID, name: 'RTNEW ' + TS, platforms: 'instagram', scheduled_date: '2026-06-29', status: 'In Progress' });
    const smmNew = await pollLive(smm, () => liveHas(smm, NEWPID), v => v === true);
    S.ok(smmNew === true, 'SMM sees a brand-new card appear LIVE via realtime');

    S.ok(smm._errs.length === 0, 'SMM: 0 JS errors (' + JSON.stringify(smm._errs.slice(0,3)) + ')');

    // ---- Client realtime ----
    const cli = await Q.clientPage(browser);
    await pollLive(cli, () => liveHas(cli, PID), v => v === true);
    S.ok(await liveHas(cli, PID), 'client has the seed card loaded');
    await Q.up({ id: PID, caption_status: 'Tweaks Needed' });
    const cliLive = await pollLive(cli, () => liveStatus(cli, PID), v => v === 'Tweaks Needed');
    // client realtime may or may not be subscribed; report either way but treat propagation as the assert
    S.ok(cliLive === 'Tweaks Needed', 'client sees the status change LIVE via realtime (got ' + cliLive + ')');
    S.ok(cli._errs.length === 0, 'client: 0 JS errors (' + JSON.stringify(cli._errs.slice(0,3)) + ')');
  } finally {
    await Q.up({ id: PID, status: 'Archived' });
    await Q.up({ id: NEWPID, status: 'Archived' });
    await browser.close();
  }
  process.exit(S.done());
})();
