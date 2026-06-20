// p69 — date reschedule: moving a card to a new month updates the DB, moves its month-filter
// membership (out of the old month, into the new one — the #538 undated-guard family), and
// propagates the new date to the client.
const Q = require('./lib.js');
const PID = 'p_dr_' + Math.floor(Date.now() / 1000);
const inMonth = (page, pid, ym) => page.evaluate((a) => { const p = (calState.posts || []).find(x => x.id === a.pid); return p ? _calPostInMonthFilter(p, a.ym) : '__nopost__'; }, { pid, ym });

(async () => {
  const S = Q.makeOk('P69 date reschedule');
  const browser = await Q.launch();
  const smm = await Q.smmPage(browser);
  const cli = await Q.clientPage(browser);
  try {
    await Q.up({ id: PID, name: 'DR ' + PID.slice(-6), platforms: 'instagram', scheduled_date: '2026-06-29',
      video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Client Approval', status: 'Client Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4' });
    await Q.pollRaw(PID, r => r.scheduled_date && String(r.scheduled_date).slice(0, 10) === '2026-06-29', 'scheduled_date');
    await Q.waitForPost(smm, PID);

    // initial month membership: June yes, July no
    S.ok((await inMonth(smm, PID, '2026-06')) === true, 'initially in June filter');
    S.ok((await inMonth(smm, PID, '2026-07')) === false, 'initially NOT in July filter');

    // reschedule to July 15 (field-save path)
    await smm.evaluate((a) => { try { delete _calPendingEdits[a.pid]; const p = (calState.posts || []).find(x => x.id === a.pid); if (p) { p.scheduled_date = a.d; _calPendingEdits[a.pid] = { scheduled_date: a.d }; _calFlushCardSave(a.pid); } } catch (e) {} }, { pid: PID, d: '2026-07-15' });
    const r = await Q.pollRaw(PID, x => String(x.scheduled_date || '').slice(0, 10) === '2026-07-15', 'scheduled_date', 15000);
    S.ok(String(r.scheduled_date || '').slice(0, 10) === '2026-07-15', 'DB scheduled_date updated to 2026-07-15');

    // month membership moved: July yes, June no
    S.ok((await inMonth(smm, PID, '2026-07')) === true, 'card now IN July filter');
    S.ok((await inMonth(smm, PID, '2026-06')) === false, 'card NO LONGER in June filter (moved months)');

    // client sees the new date
    const cliDate = await cli.evaluate(async (a) => { for (let i = 0; i < 16; i++) { try { await loadCalendarPosts(); } catch (e) {} await new Promise(x => setTimeout(x, 700)); const p = (calState.posts || []).find(x => x.id === a.pid); if (p && String(p.scheduled_date || '').slice(0, 10) === '2026-07-15') return true; } const p = (calState.posts || []).find(x => x.id === a.pid); return p ? String(p.scheduled_date || '').slice(0, 10) : '__nopost__'; }, { pid: PID });
    S.ok(cliDate === true, 'client sees the rescheduled date (2026-07-15)');

    S.ok(smm._errs.length === 0 && cli._errs.length === 0, 'no JS errors (' + JSON.stringify([...smm._errs, ...cli._errs].slice(0, 3)) + ')');
  } finally { try { await Q.archive(PID); } catch (e) {} await browser.close(); }
  process.exit(S.done());
})();
