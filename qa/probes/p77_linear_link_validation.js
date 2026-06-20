// p77 — Linear sub-issue link validation (_calLinearCommit guards). Pasting a
// non-Linear string (a note/blob) must be REJECTED with a disclaimer and never
// stored; a real VID- link saves to the video slot; a GRA- link pasted into the
// VIDEO slot must prompt (overridable), not silently save; a real GRA- link saves
// to the graphic slot. Guards against the "weird text sitting in the link slot" bug.
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const PID = 'p_linkval_' + TS;
const BLOB = 'just a note, not a url at all ' + TS;
const VID = 'https://linear.app/synchro-social/issue/VID-7' + (TS % 9000 + 1000) + '/v';
const GRA = 'https://linear.app/synchro-social/issue/GRA-7' + (TS % 9000 + 1000) + '/g';

// commit a value through the REAL handler, controlling the confirm/notify outcome
const commit = (page, pid, comp, value, confirmMode /* 'accept'|'cancel'|undefined */) => page.evaluate((a) => {
  window.__notified = false; window.__confirmed = false;
  window.showNotify = () => { window.__notified = true; };
  window.showConfirm = (t, m, onYes) => { window.__confirmed = true; if (a.confirmMode === 'accept' && typeof onYes === 'function') onYes(); };
  _calLinearCommit({ value: a.value, dataset: {} }, a.pid, a.comp);
  return { notified: window.__notified, confirmed: window.__confirmed };
}, { pid, comp, value, confirmMode });

const vid = async () => { const r = await Q.rawRow(PID, 'linear_issue_id'); return String(r.linear_issue_id || ''); };
const gra = async () => { const r = await Q.rawRow(PID, 'graphic_linear_issue_id'); return String(r.graphic_linear_issue_id || ''); };

(async () => {
  const S = Q.makeOk('P77 linear link validation');
  const browser = await Q.launch();
  const smm = await Q.smmPage(browser);
  try {
    await Q.up({ id: PID, name: 'LINKVAL ' + TS, platforms: 'instagram', scheduled_date: '2026-06-29',
      video_status: 'In Progress', status: 'In Progress', linear_issue_id: '', graphic_linear_issue_id: '',
      thumbnail_url: 'https://via.placeholder.com/320x180.png' });
    await Q.pollRaw(PID, r => r.name === 'LINKVAL ' + TS, 'name');
    await Q.waitForPost(smm, PID);

    // 1) a non-Linear blob into the video slot → rejected + disclaimer, nothing saved
    const r1 = await commit(smm, PID, 'video', BLOB);
    await smm.waitForTimeout(2000);
    S.ok(r1.notified === true, 'blob paste → disclaimer shown ("that isn\'t a Linear link")');
    S.ok((await vid()) === '', 'blob paste → nothing written to the video link slot');

    // 2) a real VID- link into the video slot → saved
    await commit(smm, PID, 'video', VID);
    await Q.pollRaw(PID, r => (r.linear_issue_id || '') === VID, 'linear_issue_id', 8000);
    S.ok((await vid()) === VID, 'valid VID- link saves to the video slot');

    // 3) a GRA- link into the VIDEO slot, user CANCELS the prompt → not saved (video keeps the VID- link)
    const r3 = await commit(smm, PID, 'video', GRA, 'cancel');
    await smm.waitForTimeout(2000);
    S.ok(r3.confirmed === true, 'GRA- link in the video slot → wrong-slot prompt fired');
    S.ok((await vid()) === VID, 'wrong-slot prompt CANCELLED → video link unchanged (no silent overwrite)');

    // 4) same GRA- link into the video slot, user OVERRIDES → saved
    await commit(smm, PID, 'video', GRA, 'accept');
    await Q.pollRaw(PID, r => (r.linear_issue_id || '') === GRA, 'linear_issue_id', 8000);
    S.ok((await vid()) === GRA, 'wrong-slot prompt ACCEPTED → override saves it');

    // 5) a real GRA- link into the GRAPHIC slot → saved with no prompt
    const r5 = await commit(smm, PID, 'graphic', GRA);
    await Q.pollRaw(PID, r => (r.graphic_linear_issue_id || '') === GRA, 'graphic_linear_issue_id', 8000);
    S.ok((await gra()) === GRA, 'valid GRA- link saves to the graphic slot');
    S.ok(r5.notified === false && r5.confirmed === false, 'correct GRA→graphic paste raised no disclaimer/prompt');

    S.ok(smm._errs.length === 0, 'no JS errors (' + JSON.stringify(smm._errs.slice(0, 3)) + ')');
  } finally {
    try { await Q.up({ id: PID, status: 'Archived' }); } catch (e) {}
    await browser.close();
  }
  process.exit(S.done());
})();
