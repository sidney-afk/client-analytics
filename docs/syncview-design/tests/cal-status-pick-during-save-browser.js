'use strict';
/* cal-status-pick-during-save-browser.js -- OPEN_REPAIRS 424.
 *
 * Two status picks on one Calendar card inside the gateway wait. Pick one
 * ("Set all" to Scheduled) starts save A, which first pushes the graphic status
 * to production-write. While that push waits, pick two ("Set all" to Posted)
 * changes the card on screen and queues save B. Save A used to build its card
 * write from the card on screen, so the write meant to say Scheduled said
 * Posted; its echo then made save B look unchanged, and Posted never reached
 * production-write: card Posted, work item Scheduled, the drift robot red.
 *
 * Fully mocked (lost-work-lib.js); nothing reaches a live backend. Runs once
 * per card writer: calendar-upsert (every client) and calendar-card-write
 * (staff saves on a client on calendar_card_write_clients).
 */
const { createEnv, sleep } = require('./lost-work-lib');
const failures = [];
const check = (c, m) => { console.log((c ? '  ok  ' : 'FAIL  ') + m); if (!c) failures.push(m); };

async function run(cardWrite) {
  const lane = cardWrite ? 'calendar-card-write' : 'calendar-upsert';
  const S = await createEnv({ cardWrite });
  try {
    const A = await S.newPage(); await S.openCalendar(A);
    await A.evaluate(() => {
      // The confirm for a terminal "Set all" is skipped, as for a person who ticked "don't ask again".
      ['Scheduled', 'Posted'].forEach(s => localStorage.setItem(_calSetAllSkipKey(s), '1'));
    });
    S.behave['gw:status'] = { delay: 2500, times: 1 };   // the first push waits, like a cold production-write
    const mark = S.log.length;
    await A.evaluate(() => _calSetAllStatus('p_t1', 'Scheduled'));
    await sleep(400);
    await A.evaluate(() => _calSetAllStatus('p_t1', 'Posted'));
    for (let i = 0; i < 60; i++) {
      await sleep(250);
      const idle = await A.evaluate(() => !_calSaveInFlight['p_t1'] && !_calPendingEdits['p_t1']);
      if (idle && i > 16) break;
    }
    const gw = S.log.slice(mark).filter(l => l.key === 'gw:status').map(l => JSON.parse(l.summary));
    const gra = S.deliv.find(d => d.id === 'del_gra_1');
    const vid = S.deliv.find(d => d.id === 'del_vid_1');
    const card = S.card('p_t1');
    const writes = S.upserts.filter(u => u.post.id === 'p_t1');
    check(writes.length >= 2 && writes.every(u => u.url === '/functions/v1/' + lane), lane + ': both saves wrote the card through ' + lane + ' (' + writes.map(u => u.url.split('/').pop()).join(', ') + ')');
    const first = writes[0] ? writes[0].post : {};
    check(first.graphic_status === 'Scheduled' && first.video_status === 'Scheduled' && first.status === 'Scheduled',
      lane + ': the first card write says what the first pick said (video/graphic/overall: ' + [first.video_status, first.graphic_status, first.status].join('/') + ')');
    check(gw.some(g => g.id === 'del_gra_1' && g.status === 'posted'), lane + ': the second pick reached production-write for the graphic (' + JSON.stringify(gw.map(g => g.id + ':' + g.status)) + ')');
    check(gra.status === 'posted' && vid.status === 'posted', lane + ': both work items end Posted (video ' + vid.status + ', graphic ' + gra.status + ')');
    check(card.graphic_status === 'Posted' && card.video_status === 'Posted' && card.status === 'Posted', lane + ': the card ends Posted and agrees with its work items (' + [card.video_status, card.graphic_status, card.status].join('/') + ')');
    const shown = await A.evaluate(() => { const p = calState.posts.find(x => x.id === 'p_t1'); return [p.video_status, p.graphic_status, p.status].join('/'); });
    check(shown === 'Posted/Posted/Posted', lane + ': the page shows Posted (' + shown + ')');
    check(A.errors.length === 0, lane + ': no page errors ' + JSON.stringify(A.errors));
  } finally { await S.close(); }
}

(async () => {
  await run(false);
  await run(true);
  if (failures.length) { console.error('\ncal-status-pick-during-save: ' + failures.length + ' FAILED\n- ' + failures.join('\n- ')); process.exit(1); }
  console.log('\ncal-status-pick-during-save: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
