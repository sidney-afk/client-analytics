// p43b — follow-up to p43: the concurrent field-patch leaves the DERIVED overall `status`
// column stale (all 3 subs Approved, stored status "For SMM Approval"). Verify:
//   (1) a FRESH load's computed overall self-heals to Approved (display is correct),
//   (2) the stored column is still stale until a write touches it,
//   (3) ANY subsequent sub-status save heals the persisted column too.
const Q = require('./lib.js');
const PID = 'p_sh_' + Math.floor(Date.now() / 1000);

(async () => {
  const S = Q.makeOk('P43b stale-overall self-heal');
  const browser = await Q.launch();
  const smm = await Q.smmPage(browser);
  try {
    // seed the exact stale shape p43 produced: subs all Approved, stored overall stale.
    await Q.up({ id: PID, name: 'SH ' + PID.slice(-6), platforms: 'youtube', scheduled_date: '2026-06-29',
      video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Approved', status: 'For SMM Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4' });
    await Q.pollRaw(PID, r => r.video_status === 'Approved' && r.status === 'For SMM Approval', 'video_status,status');

    await Q.waitForPost(smm, PID);
    // (1) computed overall on a fresh page is Approved (display self-heals)
    const computed = await smm.evaluate((pid) => { const p = (calState.posts || []).find(x => x.id === pid); return p ? computeOverallStatus(p) : 'NO_POST'; }, PID);
    S.ok(computed === 'Approved', 'fresh-load COMPUTED overall = Approved (display self-heals; got ' + computed + ')');

    // (2) the persisted column is still the stale value (not yet healed in DB)
    const before = await Q.rawRow(PID, 'status');
    S.ok(before.status === 'For SMM Approval', 'stored column still stale until a write touches it (got ' + before.status + ')');

    // (3) any sub-status save recomputes + persists the overall → heals the column
    await smm.evaluate((pid) => { try { delete _calPendingEdits[pid]; } catch (e) {} }, PID);
    // re-pick caption to Approved is a no-op (guarded), so nudge via graphic Scheduled→back
    await smm.evaluate((pid) => { try { _calStatusPick(pid, 'Scheduled', 'graphic'); } catch (e) {} }, PID);
    let r = await Q.pollRaw(PID, x => x.graphic_status === 'Scheduled', 'graphic_status,status', 12000);
    // overall of Approved,Scheduled,Approved → Approved (lowest priority among the 3)
    S.ok(r.status === 'Approved', 'after a sub-status save, persisted overall healed to Approved (got ' + r.status + ')');

    S.ok(smm._errs.length === 0, 'no JS errors (' + JSON.stringify(smm._errs.slice(0, 3)) + ')');
  } finally { try { await Q.archive(PID); } catch (e) {} await browser.close(); }
  process.exit(S.done());
})();
