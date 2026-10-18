'use strict';
/* cal-offline-resend-browser.js -- session Gauntlet, 2026-10-18.
 *
 * A Calendar card edit made while the network is down fails with
 * "Save failed · Retry". When the browser came back online nothing resent it:
 * the card stayed red and the text stayed unsaved until the person found and
 * clicked Retry (measured live on the test client, twice). Now coming back
 * online presses Retry for every card whose save failed for lack of a network,
 * and for nothing else: a save the server refused still waits for the person.
 *
 * Fully mocked (lost-work-lib.js); nothing reaches a live backend. Runs once
 * per card writer: calendar-upsert and calendar-card-write.
 */
const { createEnv, sleep } = require('./lost-work-lib');
const failures = [];
const check = (c, m) => { console.log((c ? '  ok  ' : 'FAIL  ') + m); if (!c) failures.push(m); };

async function typeCaption(page, pid, text) {
  return page.evaluate(([id, v]) => {
    const ta = document.querySelector(`textarea.cal-fld-cap[data-pid="${id}"]`);
    if (!ta) return 'no-caption';
    ta.focus();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, v);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.blur();
    return 'ok';
  }, [pid, text]);
}
const markOf = (page, pid) => page.evaluate((id) => {
  const tag = document.querySelector(`[data-saving="${id}"]`);
  return tag && tag.classList.contains('is-error') ? 'error' : 'ok';
}, pid);
async function waitFor(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(200); }
  return false;
}

async function run(cardWrite) {
  const lane = cardWrite ? 'calendar-card-write' : 'calendar-upsert';
  const S = await createEnv({ cardWrite });
  try {
    const A = await S.newPage(); await S.openCalendar(A);
    // 1. Offline: the save fails and says so.
    S.offline = true;
    await A.evaluate(() => window.dispatchEvent(new Event('offline')));
    check(await typeCaption(A, 'p_t1', 'Typed while offline') === 'ok', lane + ': caption typed while offline');
    check(await waitFor(async () => await markOf(A, 'p_t1') === 'error', 8000), lane + ': the card says the save failed');
    check(S.card('p_t1').caption === 'A fictional caption.', lane + ': nothing reached the server while offline');
    // 2. Back online: it is resent with no click.
    S.offline = false;
    const before = S.upserts.length;
    await A.evaluate(() => window.dispatchEvent(new Event('online')));
    const landed = await waitFor(async () => S.card('p_t1').caption === 'Typed while offline', 8000);
    check(landed, lane + ': back online, the caption reaches the server with no click (' + (S.upserts.length - before) + ' write(s))');
    check(await waitFor(async () => await markOf(A, 'p_t1') === 'ok', 5000), lane + ': the red mark clears');

    // 2b. A teammate changes OTHER fields while this tab is offline. The resend carries only
    //     what this person changed (the caption), never this tab's older copy of the rest.
    S.offline = true;
    await A.evaluate(() => window.dispatchEvent(new Event('offline')));
    check(await typeCaption(A, 'p_t1', 'Second offline text') === 'ok', lane + ': a second caption typed while offline');
    check(await waitFor(async () => await markOf(A, 'p_t1') === 'error', 8000), lane + ': that save fails and says so');
    S.setCardField('p_t1', { name: 'Renamed by a teammate', scheduled_date: '2026-10-12', asset_url: 'https://example.invalid/teammate.mp4' }, 'teammate');
    S.offline = false;
    const before2 = S.upserts.length;
    await A.evaluate(() => window.dispatchEvent(new Event('online')));
    check(await waitFor(async () => S.card('p_t1').caption === 'Second offline text', 8000), lane + ': back online, the second caption lands');
    const resent = S.upserts.slice(before2).map(u => Object.keys(u.post).filter(k => k !== 'id').sort().join(','));
    check(resent.length > 0 && resent.every(k => !/(^|,)(name|scheduled_date|asset_url)(,|$)/.test(k)), lane + ': the resend carries only the caption (' + JSON.stringify(resent) + ')');
    const c2 = S.card('p_t1');
    check(c2.name === 'Renamed by a teammate' && c2.scheduled_date === '2026-10-12' && c2.asset_url === 'https://example.invalid/teammate.mp4', lane + ': the teammate\'s name, date and video link survive (' + [c2.name, c2.scheduled_date, c2.asset_url].join(' | ') + ')');
    await waitFor(async () => await markOf(A, 'p_t1') === 'ok', 5000);

    // 3. A save the SERVER refused is not resent by coming online.
    S.behave['cal-upsert'] = { mode: 'http', status: 400, body: { ok: false, error: 'Refused by the server for this test' }, commit: false, times: 1 };
    check(await typeCaption(A, 'p_t1', 'Refused text') === 'ok', lane + ': a second caption, refused by the server');
    const refusedSent = await waitFor(async () => S.upserts.some(u => u.post.caption === 'Refused text'), 8000);
    await sleep(600);
    check(refusedSent && await markOf(A, 'p_t1') === 'error', lane + ': the card says that save failed');
    const mark = S.upserts.length;
    await A.evaluate(() => window.dispatchEvent(new Event('online')));
    await sleep(2500);
    check(S.upserts.length === mark, lane + ': coming online does not resend a refused save (' + (S.upserts.length - mark) + ' write(s))');
    check(A.errors.length === 0, lane + ': no page errors ' + JSON.stringify(A.errors));
  } finally { await S.close(); }
}

(async () => {
  await run(false);
  await run(true);
  if (failures.length) { console.error('\ncal-offline-resend: ' + failures.length + ' FAILED\n- ' + failures.join('\n- ')); process.exit(1); }
  console.log('\ncal-offline-resend: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
