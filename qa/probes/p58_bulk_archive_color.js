// p58 — lower-priority peripheral UI, live:
//   A) BULK ARCHIVE (SMM real handler + confirm): select 2 cards → both archived in DB + removed
//      from the calendar; client is SMM-only-guarded.
//   B) COLOR TAG: SMM sets a card colour → persists; client sees it (read-only) and cannot change it.
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const A = 'p_ba_a_' + TS, B = 'p_ba_b_' + TS, C = 'p_col_' + TS;

const seed = (id, name) => Q.up({ id, name, platforms: 'instagram', scheduled_date: '2026-06-29',
  video_status: 'In Progress', graphic_status: 'In Progress', caption_status: 'In Progress', status: 'In Progress',
  thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4' });

(async () => {
  const S = Q.makeOk('P58 bulk-archive + color tag (peripheral UI)');
  const browser = await Q.launch();
  const smm = await Q.smmPage(browser);
  const cli = await Q.clientPage(browser);
  try {
    await seed(A, 'BA-A ' + TS); await seed(B, 'BA-B ' + TS); await seed(C, 'COL ' + TS);
    for (const id of [A, B, C]) await Q.pollRaw(id, r => r.id === id, 'id');
    for (const id of [A, B, C]) await Q.waitForPost(smm, id);

    // ---- A) bulk archive ----
    await smm.evaluate((a) => { calState.selected = new Set([a.A, a.B]); calState.selectMode = true; try { _calArchiveSelected(); } catch (e) {} }, { A, B });
    await smm.waitForTimeout(400);
    await smm.evaluate(() => { const b = document.getElementById('confirmYes'); if (b) b.click(); });
    const ra = await Q.pollRaw(A, x => String(x.status || '').toLowerCase() === 'archived', 'status', 15000);
    const rb = await Q.pollRaw(B, x => String(x.status || '').toLowerCase() === 'archived', 'status', 15000);
    S.ok(String(ra.status || '').toLowerCase() === 'archived' && String(rb.status || '').toLowerCase() === 'archived', 'both selected cards archived in DB');
    const goneFromCal = await smm.evaluate((a) => !(calState.posts || []).some(p => p.id === a.A || p.id === a.B), { A, B });
    S.ok(goneFromCal, 'both cards removed from the SMM calendar');

    // ---- B) color tag ----
    await smm.evaluate((pid) => { try { _calSetCardColor(null, pid, 'emerald'); } catch (e) {} }, C);
    let rc = await Q.pollRaw(C, x => String(x.color || '') === 'emerald', 'color', 15000);
    S.ok(rc.color === 'emerald', 'SMM color tag persists to DB (emerald)');
    // client sees the colour (read), and cannot change it (SMM-only guard)
    const cliColor = await cli.evaluate(async (pid) => {
      for (let i = 0; i < 22; i++) { try { await loadCalendarPosts(); } catch (e) {} await new Promise(x => setTimeout(x, 800)); const p = (calState.posts || []).find(x => x.id === pid); if (p && String(p.color || '') === 'emerald') break; }
      const before = (calState.posts || []).find(x => x.id === pid);
      const seen = before ? before.color : null;
      try { _calSetCardColor(null, pid, 'red'); } catch (e) {}   // should no-op on client link
      const after = (calState.posts || []).find(x => x.id === pid);
      return { isClientLink: _isClientLink, seen, afterColor: after ? after.color : null, pending: !!(_calPendingEdits[pid]) };
    }, C);
    S.ok(cliColor.seen === 'emerald', 'client sees the color tag (read view)');
    S.ok(cliColor.isClientLink && cliColor.afterColor === 'emerald' && !cliColor.pending, 'client _calSetCardColor is a NO-OP (color unchanged, no pending edit)');
    rc = await Q.rawRow(C, 'color'); S.ok(rc.color === 'emerald', 'DB color unchanged after client attempt');

    S.ok(smm._errs.length === 0 && cli._errs.length === 0, 'no JS errors (' + JSON.stringify([...smm._errs, ...cli._errs].slice(0, 3)) + ')');
  } finally { for (const id of [A, B, C]) { try { await Q.archive(id); } catch (e) {} } await browser.close(); }
  process.exit(S.done());
})();
