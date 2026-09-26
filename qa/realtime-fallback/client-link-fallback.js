'use strict';
// Live check of the client link's live-update safety net (150): when the
// realtime connection is not up, an open client link still picks up a staff
// change without a refresh, and calV2Status() says honestly it is not
// connected. Test client only (the courier lib pins it); one p_rtf_* seed,
// archived after. Exits non-zero on any failed check.
// Optional: FORCE_RT_BLOCK=1 blocks the realtime socket so the fallback path
// is exercised even on a machine where WebSockets work.
const { H, server } = require('./common.js');
const TS = Date.now();
const results = [];
const check = (ok, name, d) => { results.push(!!ok); console.log((ok ? '✓ ' : '✗ ') + name + (d != null ? '  [' + String(d).slice(0, 160) + ']' : '')); };
const S = { id: 'p_rtf_' + TS, name: 'RTF ' + TS };
(async () => {
  const srv = server(); await H.sleep(1500);
  const b = await H.launch();
  try {
    H.upCal({ id: S.id, name: S.name, platforms: 'youtube', scheduled_date: new Date(Date.now() + 86400e3).toISOString().slice(0, 10),
      video_status: 'Approved', graphic_status: 'Approved', caption_status: 'In Progress', status: 'In Progress',
      caption: 'Fallback test caption', thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', asset_url: 'https://example.com/r.mp4' });
    await H.pollRow(() => H.rowCal(S.id, 'id'), r => !!r.id, 35000);
    const C = await H.clientCal(b);
    if (process.env.FORCE_RT_BLOCK === '1') await C.route(/realtime\/v1/, r => r.abort());
    await C.waitForFunction(() => !!(window.calV2Status && window.calV2Status().subscribed), null, { timeout: 30000 });
    await H.sleep(20000);
    const st = await C.evaluate(() => window.calV2Status());
    console.log('status', JSON.stringify(st));
    const live = st.connected === true;
    check(typeof st.connected === 'boolean' && typeof st.rtState === 'string', 'calV2Status reports the real connection state', st.rtState);
    // Staff moves the card to Client Approval: it should appear on the open client link.
    const t0 = Date.now();
    H.upCal({ id: S.id, name: S.name, caption_status: 'Client Approval', status: 'Client Approval' });
    let seen = null;
    while (Date.now() - t0 < 75000) {
      if (await C.evaluate(n => [...document.querySelectorAll('.cal-review-card')].some(c => (c.querySelector('.kcard-title') || {}).textContent === n), S.name)) { seen = Date.now() - t0; break; }
      await H.sleep(500);
    }
    check(seen != null, (live ? 'live update' : 'fallback pull') + ' shows the staff change on the open client link without a refresh', seen + ' ms');
    if (!live) check(st.fallbackPolling === true, 'fallback polling is on while not connected');
  } catch (e) { check(false, 'harness ran', e && e.message); }
  finally {
    check(H.archiveCalSafe(S.id), 'seed archived');
    await b.close(); srv.kill();
    const bad = results.filter(x => !x).length;
    console.log(bad ? bad + ' of ' + results.length + ' checks FAILED' : 'all ' + results.length + ' checks passed');
    process.exit(bad ? 1 : 0);
  }
})();
