// p67 — thumbnail/asset LINK edit → thumb_rev cache-bust propagation. A link write bumps the
// persisted thumb_rev token so every viewer (client/Kasper) reloads the fresh image; a non-link
// edit (caption) must NOT bump it (so captions/status saves don't needlessly reload pictures).
const Q = require('./lib.js');
const PID = 'p_tr67_' + Math.floor(Date.now() / 1000);
const A = 'https://via.placeholder.com/320x180.png?a=' + PID, B = 'https://via.placeholder.com/320x180.png?b=' + PID;

(async () => {
  const S = Q.makeOk('P67 thumb_rev cache-bust');
  const browser = await Q.launch();
  const smm = await Q.smmPage(browser);
  const cli = await Q.clientPage(browser);
  try {
    await Q.up({ id: PID, name: 'TR67 ' + PID.slice(-6), platforms: 'instagram', scheduled_date: '2026-06-29',
      video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Client Approval', status: 'Client Approval',
      thumbnail_url: A, asset_url: 'https://example.com/g.mp4', thumb_rev: 'seed0', caption: 'orig caption' });
    await Q.pollRaw(PID, r => r.thumbnail_url === A, 'thumbnail_url');
    await Q.waitForPost(smm, PID);

    // 1) edit the thumbnail link → thumb_rev bumps + persists
    await smm.evaluate((a) => { try { delete _calPendingEdits[a.pid]; const p = (calState.posts || []).find(x => x.id === a.pid); if (p) { p.thumbnail_url = a.B; _calPendingEdits[a.pid] = { thumbnail_url: a.B }; _calFlushCardSave(a.pid); } } catch (e) {} }, { pid: PID, B });
    let r = await Q.pollRaw(PID, x => x.thumbnail_url === B, 'thumbnail_url,thumb_rev', 15000);
    S.ok(r.thumbnail_url === B, 'thumbnail link updated in DB');
    S.ok(String(r.thumb_rev || '') !== 'seed0' && String(r.thumb_rev || '').trim() !== '', 'link edit BUMPED thumb_rev (cache-bust token changed: ' + r.thumb_rev + ')');
    const revAfterLink = r.thumb_rev;

    // 2) client sees the new link + the new thumb_rev (cache-bust propagated)
    const cliView = await cli.evaluate(async (a) => { for (let i = 0; i < 16; i++) { try { await loadCalendarPosts(); } catch (e) {} await new Promise(x => setTimeout(x, 700)); const p = (calState.posts || []).find(x => x.id === a.pid); if (p && p.thumbnail_url === a.B) return { url: p.thumbnail_url, rev: p.thumb_rev }; } const p = (calState.posts || []).find(x => x.id === a.pid); return p ? { url: p.thumbnail_url, rev: p.thumb_rev } : null; }, { pid: PID, B });
    S.ok(cliView && cliView.url === B, 'client sees the updated thumbnail link');
    S.ok(cliView && String(cliView.rev || '') === String(revAfterLink), 'client received the bumped thumb_rev (cache-bust propagated)');

    // 3) a NON-link edit (caption) must NOT bump thumb_rev
    await smm.evaluate((a) => { try { delete _calPendingEdits[a.pid]; const p = (calState.posts || []).find(x => x.id === a.pid); if (p) { p.caption = 'edited caption ' + Date.now(); _calPendingEdits[a.pid] = { caption: p.caption }; _calFlushCardSave(a.pid); } } catch (e) {} }, { pid: PID });
    r = await Q.pollRaw(PID, x => (x.caption || '').includes('edited caption'), 'caption,thumb_rev', 15000);
    S.ok((r.caption || '').includes('edited caption'), 'caption edit saved');
    S.ok(String(r.thumb_rev || '') === String(revAfterLink), 'caption edit did NOT bump thumb_rev (no needless image reload)');

    S.ok(smm._errs.length === 0 && cli._errs.length === 0, 'no JS errors (' + JSON.stringify([...smm._errs, ...cli._errs].slice(0, 3)) + ')');
  } finally { try { await Q.archive(PID); } catch (e) {} await browser.close(); }
  process.exit(S.done());
})();
