// p55 — Kasper plain COMMENT (not a tweak): an internal team note that does NOT change status
// and KEEPS the card in his queue (still awaiting his decision). SMM sees it; client does NOT.
const Q = require('./lib.js');
const PID = 'p_kcm_' + Math.floor(Date.now() / 1000);
const NOTE = 'KASPER-NOTE-' + PID.slice(-6);

(async () => {
  const S = Q.makeOk('P55 kasper plain comment');
  const browser = await Q.launch();
  const kas = await Q.kasperPage(browser);
  const smm = await Q.smmPage(browser);
  const cli = await Q.clientPage(browser);
  try {
    await Q.up({ id: PID, name: 'KCM ' + PID.slice(-6), platforms: 'instagram', scheduled_date: '2026-06-29',
      video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Kasper Approval', status: 'Kasper Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4', caption_tweaks: '[]' });
    await Q.pollRaw(PID, r => r.caption_status === 'Kasper Approval', 'caption_status');
    S.ok(await Q.kasperLoadHas(kas, PID), 'card in Kasper queue');

    // Kasper leaves a plain comment on caption
    const res = await kas.evaluate(async (a) => { const it = (_kasperState.items || []).find(x => x.post.id === a.pid); if (!it) return 'NO_ITEM'; it._drafts = it._drafts || {}; it._drafts.caption = a.body; try { await _kasperAddCommentComp(a.pid, 'caption'); return 'ok'; } catch (e) { return 'ERR ' + e.message; } }, { pid: PID, body: NOTE });
    S.ok(res === 'ok', 'Kasper add-comment call ok (' + res + ')');
    const r = await Q.pollRaw(PID, x => (x.caption_tweaks || '').includes(NOTE), 'caption_status,caption_tweaks', 15000);

    // NO status change; card stays
    S.ok(r.caption_status === 'Kasper Approval', 'plain comment does NOT change status (still Kasper Approval)');
    let arr = []; try { arr = JSON.parse(r.caption_tweaks || '[]'); } catch (e) {}
    const c = arr.find(x => (x.body || '').includes(NOTE));
    S.ok(c && c.role === 'kasper' && c.audience === 'internal' && c.is_tweak === false, 'comment is role kasper + audience internal + NOT a tweak');
    const stays = await kas.evaluate((pid) => (_kasperState.items || []).some(x => x.post.id === pid), PID);
    S.ok(stays, 'card STAYS in Kasper queue after a plain comment');

    // SMM sees it; client does NOT (internal)
    const smmSees = await smm.evaluate(async (a) => { for (let i = 0; i < 22; i++) { try { await loadCalendarPosts(); } catch (e) {} await new Promise(x => setTimeout(x, 800)); const p = (calState.posts || []).find(x => x.id === a.pid); if (p) { const bodies = (_calCommentsForView(p, 'caption') || []).map(c => c.body); if (bodies.some(b => (b || '').includes(a.note))) return true; } } return false; }, { pid: PID, note: NOTE });
    S.ok(smmSees, 'SMM sees the Kasper internal comment');
    await Q.waitForPost(cli, PID, "p=>p.id==='" + PID + "'");
    const cliSees = await cli.evaluate((a) => { const p = (calState.posts || []).find(x => x.id === a.pid); if (!p) return false; return (_calCommentsForView(p, 'caption') || []).map(c => c.body).some(b => (b || '').includes(a.note)); }, { pid: PID, note: NOTE });
    S.ok(!cliSees, 'client does NOT see the Kasper internal comment');

    S.ok(kas._errs.length === 0 && smm._errs.length === 0 && cli._errs.length === 0, 'no JS errors (' + JSON.stringify([...kas._errs, ...smm._errs, ...cli._errs].slice(0, 3)) + ')');
  } finally {
    try { const row = await Q.rawRow(PID, 'caption_tweaks'); let a = []; try { a = JSON.parse(row.caption_tweaks || '[]'); } catch (e) {} const tomb = a.map(c => Object.assign({}, c, { deleted: true, updated_at: new Date().toISOString() })); await Q.up({ id: PID, caption_tweaks: JSON.stringify(tomb), status: 'Archived' }); } catch (e) {}
    await browser.close();
  }
  process.exit(S.done());
})();
