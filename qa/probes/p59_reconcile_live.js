// p59 — live v2 cross-actor reconcile (_calRecentSaveReconcile, the Kasper→SMM clobber fix).
// After the SMM makes a fresh local write, a reload must:
//   • KEEP the SMM's own just-written sub-status (the server echo must not regress it), AND
//   • ADOPT a concurrent change another actor made to a DIFFERENT sub-status.
// This is the read-side merge that protects in-flight/fresh edits while staying in sync.
const Q = require('./lib.js');
const PID = 'p_rec_' + Math.floor(Date.now() / 1000);

(async () => {
  const S = Q.makeOk('P59 live reconcile (keep own write + adopt other field)');
  const browser = await Q.launch();
  const smm = await Q.smmPage(browser);
  try {
    await Q.up({ id: PID, name: 'REC ' + PID.slice(-6), platforms: 'instagram', scheduled_date: '2026-06-29',
      video_status: 'For SMM Approval', graphic_status: 'Approved', caption_status: 'Client Approval', status: 'For SMM Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4' });
    await Q.pollRaw(PID, r => r.video_status === 'For SMM Approval' && r.caption_status === 'Client Approval', 'video_status,caption_status');
    await Q.waitForPost(smm, PID);

    // SMM makes a fresh local write: video For SMM Approval → Kasper Approval (flushed)
    await smm.evaluate((pid) => { try { delete _calPendingEdits[pid]; _calStatusPick(pid, 'Kasper Approval', 'video'); } catch (e) {} }, PID);
    await Q.pollRaw(PID, x => x.video_status === 'Kasper Approval', 'video_status');
    // let the save settle + the self-write record (_calRecentSaveFields) land
    await smm.evaluate(async (pid) => { for (let i = 0; i < 20; i++) { if (!(_calSaveInFlight && _calSaveInFlight[pid])) break; await new Promise(x => setTimeout(x, 200)); } }, PID);
    await smm.waitForTimeout(800);

    // a DIFFERENT actor changes a DIFFERENT field (caption) to a genuinely new value, newer ts
    await Q.up({ id: PID, caption_status: 'Approved' });
    await Q.pollRaw(PID, x => x.caption_status === 'Approved', 'caption_status');

    // SMM reloads → reconcile must keep its own video write AND adopt the caption change
    const merged = await smm.evaluate(async (pid) => {
      for (let i = 0; i < 20; i++) { try { await loadCalendarPosts(); } catch (e) {} await new Promise(x => setTimeout(x, 700));
        const p = (calState.posts || []).find(x => x.id === pid);
        if (p && p.caption_status === 'Approved') return { video: p.video_status, caption: p.caption_status };
      }
      const p = (calState.posts || []).find(x => x.id === pid); return p ? { video: p.video_status, caption: p.caption_status } : null;
    }, PID);
    console.log('merged local:', JSON.stringify(merged));
    S.ok(merged && merged.video === 'Kasper Approval', 'SMM kept its OWN fresh video write (echo did not regress it)');
    S.ok(merged && merged.caption === 'Approved', 'SMM ADOPTED the concurrent caption change (stayed in sync)');

    // and the DB itself reflects both (no lost write)
    const r = await Q.rawRow(PID, 'video_status,caption_status');
    S.ok(r.video_status === 'Kasper Approval' && r.caption_status === 'Approved', 'DB holds both: video Kasper Approval + caption Approved');

    S.ok(smm._errs.length === 0, 'no JS errors (' + JSON.stringify(smm._errs.slice(0, 3)) + ')');
  } finally { try { await Q.archive(PID); } catch (e) {} await browser.close(); }
  process.exit(S.done());
})();
