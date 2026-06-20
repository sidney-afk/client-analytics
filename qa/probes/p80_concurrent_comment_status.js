// p80 — concurrent comment + status change on the SAME card. The status write is a
// field-level patch; the comment write is a comment-array merge. They use different
// merge paths, so firing them together must NOT clobber each other: the new
// caption_status must land AND the new comment must survive.
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const PID = 'p_conccs_' + TS;
const NOTE = 'CLIENT-NOTE-DURING-STATUS-' + TS;
const now = () => new Date().toISOString();

(async () => {
  const S = Q.makeOk('P80 concurrent comment + status');
  const browser = await Q.launch();
  const smm = await Q.smmPage(browser);
  const cli = await Q.clientPage(browser);
  try {
    await Q.up({ id: PID, name: 'CONCCS ' + TS, platforms: 'instagram', scheduled_date: '2026-06-29',
      video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Client Approval', status: 'Client Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4', caption_tweaks: '[]' });
    await Q.pollRaw(PID, r => r.caption_status === 'Client Approval', 'caption_status');
    await Q.waitForPost(smm, PID); await Q.waitForPost(cli, PID);

    // fire both at once: SMM flips caption_status, client posts a comment
    await Promise.all([
      smm.evaluate((a) => { try { _calStatusPick(a.pid, 'Tweaks Needed', 'caption'); } catch (e) {} }, { pid: PID }),
      cli.evaluate(async (a) => { _calComposeComp = 'caption'; _calComposeIsTweak = false; _calAppendComment(a.pid, null, a.body); try { await _calFlushCardSave(a.pid); } catch (e) {} }, { pid: PID, body: NOTE }),
    ]);

    // both must converge: status changed AND the comment present
    const r = await Q.pollRaw(PID, x => x.caption_status === 'Tweaks Needed' && (x.caption_tweaks || '').includes(NOTE), 'caption_status,caption_tweaks', 20000);
    S.ok(r.caption_status === 'Tweaks Needed', 'SMM status change landed (caption Tweaks Needed)');
    let arr = []; try { arr = JSON.parse(r.caption_tweaks || '[]'); } catch (e) {}
    S.ok(arr.some(c => (c.body || '') === NOTE && !c.deleted), 'client comment survived the concurrent status write');

    S.ok(smm._errs.length === 0 && cli._errs.length === 0, 'no JS errors (' + JSON.stringify([...smm._errs, ...cli._errs].slice(0, 3)) + ')');
  } finally {
    try { const row = await Q.rawRow(PID, 'caption_tweaks'); let a = []; try { a = JSON.parse(row.caption_tweaks || '[]'); } catch (e) {} const tomb = a.map(c => Object.assign({}, c, { deleted: true, updated_at: now() })); await Q.up({ id: PID, caption_tweaks: JSON.stringify(tomb), status: 'Archived' }); } catch (e) {}
    await browser.close();
  }
  process.exit(S.done());
})();
