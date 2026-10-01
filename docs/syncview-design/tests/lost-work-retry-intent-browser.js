'use strict';
/* lost-work-retry-intent-browser.js -- OPEN_REPAIRS 314, item 1.
 *
 * A Calendar status that fails to save (offline, or the check before the write
 * cannot finish) is rolled back on the card and the card shows "Save failed ·
 * Retry". Retry used to re-send the card as it NOW looked (the old status) and
 * clear the error, so the status the person chose was silently never saved.
 *
 * Fully mocked (lost-work-lib.js); nothing reaches a live backend. Proves:
 *   A  fail offline, restore the network, Retry: the server gets the CHOSEN status
 *   B  the choice can no longer be recovered: Retry sends NOTHING and says what was meant
 *   C  the kept choice is too old to trust: same refusal
 *   D  a newer pick for the same status replaces the failed one: the old one is never resent
 *   E  a failed video change survives an unrelated successful save and is still retryable
 */
const { createEnv, sleep } = require('./lost-work-lib');
const CARD = '.cal-card[data-pid="p_t1"]';
const failures = [];
const check = (c, m) => { console.log((c ? '  ok  ' : 'FAIL  ') + m); if (!c) failures.push(m); };

async function dismissNotice(page) {   // the "Write paused safely" notice is modal
  await page.evaluate(() => { const o = document.getElementById('confirmOverlay'); if (o && o.classList.contains('active')) { const y = document.getElementById('confirmYes'); if (y) y.click(); } });
  await sleep(250);
}
async function pickVideo(page, slug) {
  await dismissNotice(page);
  await page.click(CARD + ' .cal-fld-substatus-trigger >> nth=0');
  await page.click('.cal-fld-status-item.cal-fld-status-' + slug);
}
async function pickGraphic(page, slug) {
  await dismissNotice(page);
  await page.click(CARD + ' .cal-fld-substatus-trigger >> nth=1');
  await page.click('.cal-fld-status-item.cal-fld-status-' + slug);
}
const view = (page) => page.evaluate(() => {
  const c = document.querySelector('.cal-card[data-pid="p_t1"]'); const t = c.querySelector('[data-saving]');
  const p = calState.posts.find(x => x.id === 'p_t1');
  return { pills: [...c.querySelectorAll('.cal-fld-substatus-trigger')].map(b => b.textContent.trim().replace(/\s+/g, ' ')), chip: t ? t.textContent.trim() : '', err: p._saveError || '' };
});
const notices = (page) => page.evaluate(() => (window.__seen || []).filter(x => x.kind === 'notify').map(x => x.a + ' | ' + x.b));
const sent = (S, from) => S.log.slice(from).filter(l => /^gw:status|^cal-upsert/.test(l.key));

(async () => {
  // ---- A ----
  {
    const S = await createEnv(); const page = await S.newPage(); await S.openCalendar(page);
    S.offline = true;
    await pickVideo(page, 'tweaks-needed'); await sleep(2500);
    let v = await view(page);
    check(v.pills[0] === 'Video In Progress' && /Save failed/.test(v.chip), 'A: offline pick rolls the pill back and shows "Save failed · Retry" (' + v.pills[0] + ' / ' + v.chip + ')');
    check(await page.evaluate(() => !!calState.posts.find(x => x.id === 'p_t1')._calFailedIntent), 'A: the chosen change is kept on the card');
    S.offline = false; await sleep(400);
    const mark = S.log.length;
    await page.evaluate(() => _calRetrySave('p_t1')); await sleep(4000);
    const out = sent(S, mark);
    check(S.card('p_t1').video_status === 'Tweaks Needed' && S.deliv[0].status === 'tweak', 'A: after Retry the server holds the CHOSEN status (' + S.card('p_t1').video_status + ' / ' + S.deliv[0].status + ')');
    check(!out.some(l => /"video_status":"In Progress"/.test(l.summary)), 'A: no request carried the old status');
    v = await view(page);
    check(v.pills[0] === 'Video Tweaks Needed' && !/Save failed/.test(v.chip), 'A: the card shows the chosen status and the error is cleared');
    check(await page.evaluate(() => !calState.posts.find(x => x.id === 'p_t1')._calFailedIntent), 'A: the kept change is cleared after it saved');
    check(page.errors.length === 0, 'A: no page errors ' + JSON.stringify(page.errors));
    await S.close();
  }
  // ---- B and C ----
  for (const mode of ['lost', 'expired']) {
    const S = await createEnv(); const page = await S.newPage(); await S.openCalendar(page);
    S.offline = true; await pickVideo(page, 'tweaks-needed'); await sleep(2500); S.offline = false; await sleep(300);
    await page.evaluate((m) => {
      const p = calState.posts.find(x => x.id === 'p_t1');
      if (m === 'lost') delete p._calFailedIntent; else p._calFailedIntent.at = Date.now() - 7 * 3600 * 1000;
    }, mode);
    const mark = S.log.length;
    await page.evaluate(() => _calRetrySave('p_t1')); await sleep(2500);
    const n = (await notices(page)).filter(x => /^Nothing was sent/.test(x));
    check(sent(S, mark).length === 0, mode + ': Retry sent NOTHING to the server');
    check(n.length === 1 && /Video Tweaks Needed/.test(n[0]) && /Video In Progress/.test(n[0]), mode + ': the person is told what was meant and what the card shows (' + (n[0] || 'no notice') + ')');
    check(S.card('p_t1').video_status === 'In Progress', mode + ': the server value is unchanged');
    const v = await view(page);
    check(!/Save failed/.test(v.chip), mode + ': the stale error chip is gone, not left to resend');
    await S.close();
  }
  // ---- D ----
  {
    const S = await createEnv(); const page = await S.newPage(); await S.openCalendar(page);
    S.offline = true; await pickVideo(page, 'tweaks-needed'); await sleep(2500); S.offline = false; await sleep(300);
    const mark = S.log.length;
    await pickVideo(page, 'for-smm-approval'); await sleep(3500);
    check(S.card('p_t1').video_status === 'For SMM Approval', 'D: the newer pick saved (' + S.card('p_t1').video_status + ')');
    check(!sent(S, mark).some(l => /Tweaks Needed|"status":"tweak"/.test(l.summary)), 'D: the older failed pick was never sent');
    const v = await view(page);
    check(!/Save failed|Not saved/.test(v.chip), 'D: no stale chip remains (' + v.chip + ')');
    await S.close();
  }
  // ---- E ----
  {
    const S = await createEnv(); const page = await S.newPage(); await S.openCalendar(page);
    S.offline = true; await pickVideo(page, 'tweaks-needed'); await sleep(2500); S.offline = false; await sleep(300);
    await pickGraphic(page, 'for-smm-approval'); await sleep(3500);
    let v = await view(page);
    check(S.card('p_t1').graphic_status === 'For SMM Approval' && S.card('p_t1').video_status === 'In Progress', 'E: the unrelated graphic change saved and did not drag the failed video change along');
    check(/Save failed/.test(v.chip) && /Video Tweaks Needed/.test(v.err), 'E: the failed video change is still offered for Retry (' + v.chip + ' / ' + v.err + ')');
    await page.evaluate(() => _calRetrySave('p_t1')); await sleep(4000);
    check(S.card('p_t1').video_status === 'Tweaks Needed', 'E: Retry then sends the video change');
    await S.close();
  }
  if (failures.length) { console.error('\nlost-work-retry-intent: ' + failures.length + ' FAILED\n- ' + failures.join('\n- ')); process.exit(1); }
  console.log('\nlost-work-retry-intent: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
