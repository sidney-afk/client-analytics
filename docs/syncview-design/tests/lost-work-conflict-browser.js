'use strict';
/* lost-work-conflict-browser.js -- OPEN_REPAIRS 314, item 2.
 *
 * Two people (or two tabs) on one Calendar card. A stale tab that changed a
 * status or typed a caption used to overwrite the other person's value with no
 * word to anyone. Now, right before a field is saved, the page reads that one
 * field fresh. If ANOTHER writer changed it since this page last saw it, the
 * save of that field is held and the card shows both values with two buttons:
 * "Keep mine" saves anyway, "Use theirs" takes theirs and sets mine aside.
 * Nothing is sent for that field until the person picks.
 *
 * Fully mocked, stateful (lost-work-lib.js); nothing reaches a live backend.
 *   T1  stale tab changes a status someone else changed      -> notice, nothing overwritten, both buttons work
 *   T2  stale tab edits a caption someone else edited        -> same
 *   T3  the person's OWN sequences                            -> NO notice
 *         status then caption, caption then status, two quick status changes,
 *         continued typing across autosaves, a blur with no change, the status
 *         bridge bumping updated_at after the person's own write
 *   T4  other writer changed a DIFFERENT field, or the same value -> NO notice
 *   T5  offline and slow reads                                 -> save behaves as before
 */
const { createEnv, sleep } = require('./lost-work-lib');
const CARD = '.cal-card[data-pid="p_t1"]';
const failures = [];
const check = (c, m) => { console.log((c ? '  ok  ' : 'FAIL  ') + m); if (!c) failures.push(m); };

const pick = async (page, nth, slug) => {
  await page.click(CARD + ' .cal-fld-substatus-trigger >> nth=' + nth);
  await page.click('.cal-fld-status-item.cal-fld-status-' + slug);
};
const typeCaption = async (page, text) => { await page.fill(CARD + ' textarea.cal-fld-cap', text); };
const blurCaption = async (page) => { await page.evaluate(() => document.querySelector('.cal-card[data-pid="p_t1"] textarea.cal-fld-cap').blur()); };
const banner = (page) => page.evaluate(() => { const b = document.querySelector('.cal-card[data-pid="p_t1"] [data-cal-conflict]'); return b ? b.textContent.trim().replace(/\s+/g, ' ') : null; });
const pills = (page) => page.evaluate(() => [...document.querySelectorAll('.cal-card[data-pid="p_t1"] .cal-fld-substatus-trigger')].map(b => b.textContent.trim().replace(/\s+/g, ' ')));
const capBox = (page) => page.evaluate(() => document.querySelector('.cal-card[data-pid="p_t1"] textarea.cal-fld-cap').value);
const upserts = (S, from) => S.log.slice(from).filter(l => l.key === 'cal-upsert');
const dismiss = (page) => page.evaluate(() => { const o = document.getElementById('confirmOverlay'); if (o && o.classList.contains('active')) document.getElementById('confirmYes').click(); });

async function twoTabs() {
  const S = await createEnv();
  const A = await S.newPage(); await S.openCalendar(A);
  const B = await S.newPage(); await S.openCalendar(B);     // B gets no realtime echo: a stale tab
  return { S, A, B };
}

(async () => {
  // ---------------- T1 status ----------------
  for (const choice of ['mine', 'theirs']) {
    const { S, A, B } = await twoTabs();
    await pick(A, 0, 'for-smm-approval'); await sleep(3500);
    check(S.card('p_t1').video_status === 'For SMM Approval', 'T1/' + choice + ': tab A saved For SMM Approval');
    const mark = S.log.length;
    await pick(B, 0, 'tweaks-needed'); await sleep(3500);
    const text = await banner(B);
    check(!!text && /Video/.test(text) && /For SMM Approval/.test(text) && /Tweaks Needed/.test(text), 'T1/' + choice + ': stale tab B gets a notice naming the field and both values (' + text + ')');
    check(S.card('p_t1').video_status === 'For SMM Approval' && !S.log.slice(mark).some(l => l.key === 'gw:status'), 'T1/' + choice + ': nothing was sent and the server still holds tab A\'s status');
    check((await pills(B))[0] === 'Video For SMM Approval', 'T1/' + choice + ': tab B shows the server\'s status while it waits (' + (await pills(B))[0] + ')');
    await B.click(CARD + ' [data-cal-conflict] [data-conflict-' + choice + ']'); await sleep(3500);
    if (choice === 'mine') {
      check(S.card('p_t1').video_status === 'Tweaks Needed', 'T1/mine: Keep mine saves tab B\'s status');
      check((await pills(B))[0] === 'Video Tweaks Needed', 'T1/mine: tab B shows it');
    } else {
      check(S.card('p_t1').video_status === 'For SMM Approval' && (await pills(B))[0] === 'Video For SMM Approval', 'T1/theirs: Use theirs leaves everything as tab A set it');
    }
    if (choice === 'mine') check((await banner(B)) === null, 'T1/mine: the notice is gone after the choice');
    else {
      const aside = await banner(B);
      check(!!aside && /set aside/i.test(aside) && /Tweaks Needed/.test(aside), 'T1/theirs: the open question is closed and the set-aside choice stays recoverable (' + aside + ')');
      await B.click(CARD + ' [data-cal-conflict] [data-conflict-restore]'); await sleep(3500);
      check(S.card('p_t1').video_status === 'Tweaks Needed' && (await banner(B)) === null, 'T1/theirs: Put mine back saves it and clears the line');
    }
    check(B.errors.length === 0 && A.errors.length === 0, 'T1/' + choice + ': no page errors ' + JSON.stringify(B.errors.concat(A.errors)));
    await S.close();
  }
  // ---------------- T2 caption ----------------
  for (const choice of ['mine', 'theirs']) {
    const { S, A, B } = await twoTabs();
    await typeCaption(A, 'Caption from tab A'); await blurCaption(A); await sleep(3000);
    check(S.card('p_t1').caption === 'Caption from tab A', 'T2/' + choice + ': tab A saved its caption');
    const mark = S.log.length;
    await typeCaption(B, 'Caption from tab B'); await blurCaption(B); await sleep(3500);
    const text = await banner(B);
    check(!!text && /Caption/.test(text) && /Caption from tab A/.test(text) && /Caption from tab B/.test(text), 'T2/' + choice + ': stale tab B gets a notice naming the field and both texts (' + text + ')');
    check(S.card('p_t1').caption === 'Caption from tab A' && upserts(S, mark).length === 0, 'T2/' + choice + ': nothing was sent; the server keeps tab A\'s caption');
    check((await capBox(B)) === 'Caption from tab B', 'T2/' + choice + ': the typed text is still in the box while it waits');
    await B.click(CARD + ' [data-cal-conflict] [data-conflict-' + choice + ']'); await sleep(3000);
    if (choice === 'mine') check(S.card('p_t1').caption === 'Caption from tab B', 'T2/mine: Keep mine saves tab B\'s caption');
    else {
      check(S.card('p_t1').caption === 'Caption from tab A' && (await capBox(B)) === 'Caption from tab A', 'T2/theirs: Use theirs shows tab A\'s caption and leaves the server alone');
      const set = await banner(B);
      check(!!set && /Caption from tab B/.test(set) && /set aside/i.test(set), 'T2/theirs: the typed text stays recoverable (' + set + ')');
      await B.click(CARD + ' [data-cal-conflict] [data-conflict-restore]'); await sleep(500);
      check((await capBox(B)) === 'Caption from tab B', 'T2/theirs: Put mine back restores the typed text');
    }
    check(B.errors.length === 0, 'T2/' + choice + ': no page errors');
    await S.close();
  }
  // ---------------- T3 own sequences: no notice ----------------
  {
    const S = await createEnv(); const A = await S.newPage(); await S.openCalendar(A);
    // status, then caption (the bridge bumped updated_at after the status write)
    await pick(A, 0, 'for-smm-approval'); await sleep(3500);
    await typeCaption(A, 'Own caption one'); await blurCaption(A); await sleep(3000);
    check((await banner(A)) === null && S.card('p_t1').caption === 'Own caption one' && S.card('p_t1').video_status === 'For SMM Approval', 'T3: status then caption: both saved, no notice');
    // caption, then status
    await pick(A, 0, 'tweaks-needed'); await sleep(3500);
    check((await banner(A)) === null && S.card('p_t1').video_status === 'Tweaks Needed', 'T3: caption then status: saved, no notice');
    // two quick status changes (second pick while the first is still saving)
    S.behave['gw:status'] = { delay: 1500, times: 1 };
    await pick(A, 0, 'for-smm-approval'); await sleep(200); await pick(A, 0, 'kasper-approval'); await sleep(7000);
    check((await banner(A)) === null && S.card('p_t1').video_status === 'Kasper Approval', 'T3: two quick status changes: last one wins, no notice (' + S.card('p_t1').video_status + ')');
    // continued typing across autosaves (debounced saves while typing)
    await A.click(CARD + ' textarea.cal-fld-cap');
    await A.keyboard.type(' plus more words', { delay: 15 }); await sleep(1500);
    await A.keyboard.type(' and even more', { delay: 15 }); await sleep(2500);
    await blurCaption(A); await sleep(2500);
    check((await banner(A)) === null && /and even more$/.test(S.card('p_t1').caption || ''), 'T3: typing across several autosaves: all saved, no notice (' + S.card('p_t1').caption + ')');
    // a blur with no change
    const mark = S.log.length;
    await A.click(CARD + ' textarea.cal-fld-cap'); await blurCaption(A); await sleep(2000);
    check((await banner(A)) === null, 'T3: focusing and leaving the caption without a change: no notice');
    check(A.errors.length === 0, 'T3: no page errors ' + JSON.stringify(A.errors));
    await S.close();
  }
  // a teammate changed the caption; this tab only focuses and leaves the box (no edit): nothing is overwritten, no notice
  {
    const { S, A, B } = await twoTabs();
    S.setCardField('p_t1', { caption: 'Teammate wrote this' }, 'teammate');
    await B.click(CARD + ' textarea.cal-fld-cap'); await blurCaption(B); await sleep(2500);
    check((await banner(B)) === null && S.card('p_t1').caption === 'Teammate wrote this', 'T3b: a blur with no edit does not overwrite a teammate\'s caption and shows no notice');
    await S.close();
  }
  // ---------------- T4 different field / same value ----------------
  {
    const { S, A, B } = await twoTabs();
    await typeCaption(A, 'Only the caption changed'); await blurCaption(A); await sleep(3000);
    await pick(B, 0, 'tweaks-needed'); await sleep(3500);
    check((await banner(B)) === null && S.card('p_t1').video_status === 'Tweaks Needed' && S.card('p_t1').caption === 'Only the caption changed', 'T4: another writer changed a different field: no notice, both changes kept');
    await S.close();
  }
  {
    const { S, A, B } = await twoTabs();
    await pick(A, 0, 'tweaks-needed'); await sleep(3500);
    await pick(B, 0, 'tweaks-needed'); await sleep(3000);
    check((await banner(B)) === null && S.card('p_t1').video_status === 'Tweaks Needed', 'T4: the other writer chose the same value: no notice');
    await S.close();
  }
  // ---------------- T5 offline and slow ----------------
  {
    const S = await createEnv(); const A = await S.newPage(); await S.openCalendar(A);
    S.offline = true; await pick(A, 0, 'tweaks-needed'); await sleep(2500);
    check((await banner(A)) === null && (await pills(A))[0] === 'Video In Progress', 'T5: offline: no notice, the failed save behaves as before');
    S.offline = false; await dismiss(A); await sleep(300);
    await A.evaluate(() => _calRetrySave('p_t1')); await sleep(4000);
    check((await banner(A)) === null && S.card('p_t1').video_status === 'Tweaks Needed', 'T5: Retry after offline: saved, no notice');
    await S.close();
  }
  {
    const S = await createEnv(); const A = await S.newPage(); await S.openCalendar(A);
    S.behave['read:calendar_posts'] = { delay: 6000, times: 1 };
    const t0 = Date.now();
    await pick(A, 0, 'tweaks-needed');
    for (let i = 0; i < 40 && S.card('p_t1').video_status !== 'Tweaks Needed'; i++) await sleep(250);
    const took = Date.now() - t0;
    check(S.card('p_t1').video_status === 'Tweaks Needed' && took < 6000, 'T5: a slow fresh read is cut off and the save goes ahead (' + took + ' ms)');
    check((await banner(A)) === null, 'T5: slow read: no notice');
    await S.close();
  }
  if (failures.length) { console.error('\nlost-work-conflict: ' + failures.length + ' FAILED\n- ' + failures.join('\n- ')); process.exit(1); }
  console.log('\nlost-work-conflict: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
