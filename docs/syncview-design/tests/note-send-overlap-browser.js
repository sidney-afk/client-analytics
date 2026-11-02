'use strict';
/* note-send-overlap-browser.js -- two notes sent close together on one card both stay in the thread and in the card's
 * calendar copy, whichever the server answers first (session Trialchange, 2026-11-02).
 *
 * Found by running note-send-outbox-browser.js four at a time: its part D failed about 1 run in 8 because the open
 * Notes thread no longer showed notes the server held (B2 and D), and the card's own list had lost them too. The cause
 * was a lost update in 190 `_calAppendComment`: it copied the card's comment list before awaiting the gateway, then
 * wrote that copy plus its own note back. A note confirmed by another send in the meantime was dropped from the
 * thread and from the card's calendar copy (`video_tweaks`), while the server kept it. Fully mocked
 * (lost-work-lib.js): nothing reaches a live backend.
 *
 *   slow-first  the first note's gateway answer is held 2.5 s and the second's is not, so the second is confirmed
 *               first: both notes show in the thread once each, both are in the card's list, and the card's last
 *               calendar copy carries both.
 *   three       three notes, answered in the reverse order of sending: all three stay.
 * Desktop and 390 px.
 */
const { createEnv, sleep } = require('./lost-work-lib');

const failures = [];
let checks = 0;
const check = (c, m) => { checks++; console.log((c ? '  ok  ' : 'FAIL  ') + m); if (!c) failures.push(m); };
const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(60); } return false; };
const VIEWS = [
  { name: 'desktop', context: { viewport: { width: 1280, height: 900 } } },
  { name: 'phone', context: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
];

async function lane(view) {
  const S = await createEnv({ context: view.context });
  const tag = s => view.name + ' ' + s;
  try {
    // Each comment send waits as long as the test says: the gateway answers in the order the test picks.
    const delays = [];
    await S.ctx.route('**/functions/v1/production-write', async route => {
      let body = {}; try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
      if (route.request().method() !== 'POST' || body.operation !== 'comment') return route.fallback();
      const wait = delays.length ? delays.shift() : 0;
      if (wait) await sleep(wait);
      return route.fallback();
    });
    const page = await S.newPage();
    await S.openCalendar(page);
    await page.evaluate(() => openCalComments('p_t1'));
    await page.waitForSelector('#calCommentsModal #calCommentComposer');
    await page.evaluate(() => _calSetComposeComp('video'));
    const send = async text => { await page.fill('#calCommentComposer', text); await page.click('#calCommentsModal .cal-cm-send'); };
    const thread = () => page.evaluate(() => [...document.querySelectorAll('#calCommentsModal .cal-cm-row')]
      .map(r => ((r.textContent || '').match(/Overlap note \w+/) || [''])[0]).filter(Boolean));
    const card = () => page.evaluate(() => { const p = calState.posts.find(x => x.id === 'p_t1'); return (p.comments || []).map(c => c.body).filter(b => /Overlap note/.test(b)); });
    const settled = () => page.evaluate(() => !_calPendingEdits.p_t1 && !_calSaveInFlight.p_t1 && !document.querySelector('#calCommentsModal .is-outbox-sending'));
    const lastCopy = () => {
      const w = S.upserts.filter(u => u.post && typeof u.post.video_tweaks === 'string').pop();
      try { return w ? JSON.parse(w.post.video_tweaks).map(c => c.body).filter(b => /Overlap note/.test(b)) : []; } catch (e) { return ['unreadable']; }
    };
    const same = (a, b) => a.slice().sort().join('|') === b.slice().sort().join('|');

    // slow-first: note 1's answer is held 2.5 s, note 2's is not.
    delays.push(2500, 0);
    await send('Overlap note one');
    await send('Overlap note two');
    await until(() => S.comments.filter(c => /Overlap note (one|two)/.test(c.body)).length === 2, 10000);
    await until(settled, 10000);
    await sleep(300);
    const want2 = ['Overlap note one', 'Overlap note two'];
    let t = await thread(), c = await card(), w = lastCopy();
    check(same(t, want2), tag(`slow-first: the thread shows both notes, once each (${JSON.stringify(t)})`));
    check(same(c, want2), tag(`slow-first: the card's list holds both (${JSON.stringify(c)})`));
    check(same(w, want2), tag(`slow-first: the card's last calendar copy carries both (${JSON.stringify(w)})`));

    // three: answered in the reverse order of sending.
    delays.push(3000, 1500, 0);
    await send('Overlap note three');
    await send('Overlap note four');
    await send('Overlap note five');
    await until(() => S.comments.filter(c => /Overlap note (three|four|five)/.test(c.body)).length === 3, 12000);
    await until(settled, 12000);
    await sleep(300);
    const want5 = want2.concat(['Overlap note three', 'Overlap note four', 'Overlap note five']);
    t = await thread(); c = await card(); w = lastCopy();
    check(same(t, want5), tag(`three: all five notes show, once each (${JSON.stringify(t)})`));
    check(same(c, want5), tag(`three: the card's list holds all five (${JSON.stringify(c)})`));
    check(same(w, want5), tag(`three: the card's last calendar copy carries all five (${JSON.stringify(w)})`));
  } finally {
    await S.close();
  }
}

(async () => {
  try {
    for (const view of VIEWS) await lane(view);
  } catch (e) {
    failures.push('crashed: ' + (e && e.stack || e));
    console.error(e);
  }
  if (failures.length) { console.error(`note-send-overlap-browser: ${failures.length} of ${checks} failed`); process.exit(1); }
  console.log(`note-send-overlap-browser: all ${checks} checks passed`);
})();
