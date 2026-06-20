// p48 — terminal lifecycle via REAL SMM handlers, verified cross-surface:
//   Approved → (SMM whole-card pick) Scheduled → (SMM whole-card pick) Posted → (SMM) Archive.
//   • each transition lands in the DB on ALL components + overall
//   • client calendar reflects Scheduled/Posted; archive REMOVES the card from the client view
//   • a Posted card is gone from Kasper's review queue; archive keeps it gone
const Q = require('./lib.js');
const PID = 'p_spa_' + Math.floor(Date.now() / 1000);

const clientSees = (cli, pid, pred) => cli.evaluate(async (a) => {
  for (let i = 0; i < 20; i++) { try { await loadCalendarPosts(); } catch (e) {} await new Promise(x => setTimeout(x, 800));
    const p = (calState.posts || []).find(x => x.id === a.pid);
    const f = a.predSrc ? eval('(' + a.predSrc + ')') : (x => !!x);
    if (a.want === 'gone') { if (!p) return true; } else if (p && f(p)) return true; }
  const p = (calState.posts || []).find(x => x.id === a.pid);
  return a.want === 'gone' ? !p : (p ? eval('(' + a.predSrc + ')')(p) : false);
}, { pid, predSrc: pred ? pred.toString() : null, want: pred ? 'pred' : 'gone' });

(async () => {
  const S = Q.makeOk('P48 schedule→post→archive lifecycle');
  const browser = await Q.launch();
  const smm = await Q.smmPage(browser);
  const cli = await Q.clientPage(browser);
  const kas = await Q.kasperPage(browser);
  try {
    // instagram card (no title component) — all three components Approved.
    await Q.up({ id: PID, name: 'SPA ' + PID.slice(-6), platforms: 'instagram', scheduled_date: '2026-06-29',
      video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Approved', status: 'Approved',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4' });
    await Q.pollRaw(PID, r => r.status === 'Approved', 'status');
    await Q.waitForPost(smm, PID);

    // 1) SMM whole-card pick → Scheduled
    await smm.evaluate((pid) => { try { delete _calPendingEdits[pid]; _calStatusPick(pid, 'Scheduled', ''); } catch (e) {} }, PID);
    let r = await Q.pollRaw(PID, x => x.status === 'Scheduled', 'status,video_status,graphic_status,caption_status', 15000);
    S.ok(r.status === 'Scheduled' && r.video_status === 'Scheduled' && r.graphic_status === 'Scheduled' && r.caption_status === 'Scheduled', 'whole-card Scheduled lands on overall + all 3 subs');
    S.ok(await clientSees(cli, PID, "p=>p.status==='Scheduled'"), 'client calendar reflects Scheduled');

    // 2) SMM whole-card pick → Posted
    await smm.evaluate((pid) => { try { delete _calPendingEdits[pid]; _calStatusPick(pid, 'Posted', ''); } catch (e) {} }, PID);
    r = await Q.pollRaw(PID, x => x.status === 'Posted', 'status,video_status,graphic_status,caption_status', 15000);
    S.ok(r.status === 'Posted' && r.video_status === 'Posted' && r.caption_status === 'Posted', 'whole-card Posted lands on overall + subs');
    S.ok(await clientSees(cli, PID, "p=>p.status==='Posted'"), 'client calendar reflects Posted');
    // a Posted card is not awaiting anyone in Kasper's review queue
    const inKasper = await kas.evaluate(async (pid) => { for (let i = 0; i < 8; i++) { try { await _kasperLoadReview(true); } catch (e) {} await new Promise(x => setTimeout(x, 900)); } return (_kasperState.items || []).some(x => x.post.id === pid); }, PID);
    S.ok(!inKasper, 'Posted card is NOT in Kasper review queue');

    // 3) SMM real archive (archiveCalPost + confirm dialog)
    await Q.waitForPost(smm, PID, "p=>p.status==='Posted'");
    await smm.evaluate((pid) => { try { archiveCalPost(pid); } catch (e) {} }, PID);
    await smm.waitForTimeout(400);
    await smm.evaluate(() => { const b = document.getElementById('confirmYes'); if (b) b.click(); });
    r = await Q.pollRaw(PID, x => String(x.status || '').toLowerCase() === 'archived', 'status', 15000);
    S.ok(String(r.status || '').toLowerCase() === 'archived', 'SMM archive → DB status Archived');
    S.ok(await clientSees(cli, PID, null), 'archived card REMOVED from client calendar');
    const stillKasper = await kas.evaluate(async (pid) => { for (let i = 0; i < 6; i++) { try { await _kasperLoadReview(true); } catch (e) {} await new Promise(x => setTimeout(x, 900)); } return (_kasperState.items || []).some(x => x.post.id === pid); }, PID);
    S.ok(!stillKasper, 'archived card stays out of Kasper queue');

    S.ok(smm._errs.length === 0 && cli._errs.length === 0 && kas._errs.length === 0, 'no JS errors (' + JSON.stringify([...smm._errs, ...cli._errs, ...kas._errs].slice(0, 3)) + ')');
  } finally { try { await Q.archive(PID); } catch (e) {} await browser.close(); }
  process.exit(S.done());
})();
