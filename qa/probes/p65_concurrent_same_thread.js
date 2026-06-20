// p65 — concurrent comments on the SAME component. SMM and client each add a caption comment at
// the same instant; both writes patch caption_tweaks. The upsert's comments_base_at 3-way merge
// must UNION them so NEITHER comment is lost (the core guarantee the notes system relies on).
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const PID = 'p_cm65_' + TS;
const SMMC = 'SMM-CONCURRENT-' + TS, CLIC = 'CLIENT-CONCURRENT-' + TS;

(async () => {
  const S = Q.makeOk('P65 concurrent same-thread comment merge');
  const browser = await Q.launch();
  const smm = await Q.smmPage(browser);
  const cli = await Q.clientPage(browser);
  try {
    await Q.up({ id: PID, name: 'CM65 ' + TS, platforms: 'instagram', scheduled_date: '2026-06-29',
      video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Client Approval', status: 'Client Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4', caption_tweaks: '[]' });
    await Q.pollRaw(PID, r => r.caption_status === 'Client Approval', 'caption_status');
    await Q.waitForPost(smm, PID);
    await Q.waitForPost(cli, PID, "p=>p.caption_status==='Client Approval'");
    // both fully loaded + idle (same merge base) before firing
    await cli.evaluate(async (pid) => { const k = pid + '|caption'; for (let i = 0; i < 20; i++) { if (!_calReviewState.saving[k]) break; await new Promise(x => setTimeout(x, 200)); } }, PID);

    // FIRE BOTH AT ONCE on the SAME caption thread
    await Promise.all([
      smm.evaluate((a) => { const p = (calState.posts || []).find(x => x.id === a.pid); if (p) { _calReviewState.drafts[a.pid + '|caption'] = a.body; try { _calReviewComment(a.pid, 'caption'); } catch (e) {} } }, { pid: PID, body: SMMC }),
      cli.evaluate((a) => { const p = (calState.posts || []).find(x => x.id === a.pid); if (p) { _calReviewState.drafts[a.pid + '|caption'] = a.body; try { _calReviewComment(a.pid, 'caption'); } catch (e) {} } }, { pid: PID, body: CLIC }),
    ]);

    // both must land in caption_tweaks (3-way merge unions them — neither clobbered)
    const r = await Q.pollRaw(PID, x => (x.caption_tweaks || '').includes(SMMC) && (x.caption_tweaks || '').includes(CLIC), 'caption_tweaks', 22000);
    let arr = []; try { arr = JSON.parse(r.caption_tweaks || '[]'); } catch (e) {}
    const sm = arr.find(c => (c.body || '').includes(SMMC) && !c.deleted);
    const cm = arr.find(c => (c.body || '').includes(CLIC) && !c.deleted);
    console.log('survivors:', JSON.stringify({ smm: !!sm, client: !!cm, total: arr.filter(c => !c.deleted).length }));
    S.ok(!!sm, 'SMM comment survived the concurrent write');
    S.ok(!!cm, 'client comment survived the concurrent write');
    S.ok(sm && sm.role === 'smm' && cm && cm.role === 'client', 'both kept their authorship (smm + client)');
    S.ok(sm && sm.id !== (cm && cm.id), 'the two comments have distinct ids (no id collision)');

    // both surfaces converge to see both (the team sees both; client sees its own + the SMM internal? — SMM comment is internal)
    const smmView = await smm.evaluate(async (a) => { for (let i = 0; i < 12; i++) { try { await loadCalendarPosts(); } catch (e) {} await new Promise(x => setTimeout(x, 600)); const p = (calState.posts || []).find(x => x.id === a.pid); if (p) { const b = (_calCommentsForView(p, 'caption') || []).map(c => c.body); if (b.some(x => x.includes(a.SMMC)) && b.some(x => x.includes(a.CLIC))) return true; } } return false; }, { pid: PID, SMMC, CLIC });
    S.ok(smmView, 'SMM converges to see BOTH comments');

    S.ok(smm._errs.length === 0 && cli._errs.length === 0, 'no JS errors (' + JSON.stringify([...smm._errs, ...cli._errs].slice(0, 3)) + ')');
  } finally {
    try { const r = await Q.rawRow(PID, 'caption_tweaks'); let a = []; try { a = JSON.parse(r.caption_tweaks || '[]'); } catch (e) {} const tomb = a.map(c => Object.assign({}, c, { deleted: true, updated_at: new Date().toISOString() })); await Q.up({ id: PID, caption_tweaks: JSON.stringify(tomb), status: 'Archived' }); } catch (e) {}
    await browser.close();
  }
  process.exit(S.done());
})();
