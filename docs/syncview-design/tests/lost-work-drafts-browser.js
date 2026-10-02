'use strict';
/* lost-work-drafts-browser.js -- OPEN_REPAIRS 314, item 3.
 *
 * Captions, notes, comments, descriptions and Create Post names must keep what
 * the person typed if the tab closes or a save fails, and must NOT bring back
 * text that was already saved or sent.
 *
 * Fully mocked, stateful (lost-work-lib.js); nothing reaches a live backend.
 *   C   Calendar caption: closed before the save left; failed save then reload;
 *       saved then reload (nothing stale); changed elsewhere meanwhile (notice, no overwrite)
 *   N   Calendar note: new tab restores it; sent and acknowledged is not restored;
 *       a note that was on its way when the page went away is not offered twice if it is in the thread
 *   P   Production comment and reply: restored after a reload; failed save kept; saved not restored
 *   D   Production description: restored into the editor; saved / cancelled not restored
 *   X   Create Post names restored; created names not restored
 *   S   storage that throws: every surface still works
 */
const { createEnv, sleep } = require('./lost-work-lib');
const CARD = '.cal-card[data-pid="p_t1"]';
const CAP = CARD + ' textarea.cal-fld-cap';
const failures = [];
const check = (c, m) => { console.log((c ? '  ok  ' : 'FAIL  ') + m); if (!c) failures.push(m); };
const draftKeys = (page) => page.evaluate(() => { try { return Object.keys(localStorage).filter(k => /^sv_draft_v1:/.test(k)); } catch (e) { return ['(storage unreadable)']; } });
const noteText = (page, scope) => page.evaluate((sel) => { const n = document.querySelector((sel || '') + ' [data-sv-draft-note]'); return n ? n.textContent.trim().replace(/\s+/g, ' ') : null; }, scope || '');
const capBox = (page) => page.evaluate(() => document.querySelector('.cal-card[data-pid="p_t1"] textarea.cal-fld-cap').value);
const banner = (page) => page.evaluate(() => { const b = document.querySelector('.cal-card[data-pid="p_t1"] [data-cal-conflict]'); return b ? b.textContent.trim().replace(/\s+/g, ' ') : null; });
const leave = async (page) => { await page.goto('about:blank'); await sleep(200); };
async function section(name, fn) {   // one block that throws must not hide the others
  try { await fn(); } catch (e) { check(false, name + ' stopped early: ' + String(e.message || e).split('\n')[0].slice(0, 160)); }
}
const dismiss = (page) => page.evaluate(() => { const o = document.getElementById('confirmOverlay'); if (o && o.classList.contains('active')) document.getElementById('confirmYes').click(); });
async function openNotes(S, page) {
  await S.openCalendar(page);
  await page.click(CARD + ' .cal-comments-btn'); await page.waitForSelector('#calCommentComposer', { timeout: 8000 }); await sleep(600);
}
async function openProd(S, page) {
  await S.openProduction(page); await page.evaluate(() => _prodOpenDeliverable('del_vid_1')); await sleep(1800);
}

(async () => {
  // ================= C: Calendar caption =================
  await section('block 1', async () => {
    const S = await createEnv(); const A = await S.newPage(); await S.openCalendar(A);
    await A.fill(CAP, 'Caption typed just before closing');
    await leave(A);     // closed before the autosave or the blur could send anything
    check(S.card('p_t1').caption === 'A fictional caption.', 'C1: nothing had reached the server');
    const B = await S.newPage(); await S.openCalendar(B);
    check((await capBox(B)) === 'Caption typed just before closing', 'C1: reopened in a new tab, the typed caption is back in the box');
    const n = await noteText(B, CARD);
    check(!!n && /Restored your unsaved text/.test(n), 'C1: a small "Restored your unsaved text" line shows with Discard (' + n + ')');
    await B.click(CARD + ' [data-sv-draft-discard]'); await sleep(400);
    check((await capBox(B)) === 'A fictional caption.' && (await draftKeys(B)).length === 0 && (await noteText(B, CARD)) === null, 'C1: Discard brings back the saved caption and forgets the draft');
    check(S.card('p_t1').caption === 'A fictional caption.', 'C1: Discard sent nothing');
    check(B.errors.length === 0, 'C1: no page errors ' + JSON.stringify(B.errors));
    await S.close();
  });
  await section('block 2', async () => {
    const S = await createEnv(); const A = await S.newPage(); await S.openCalendar(A);
    S.offline = true;
    await A.fill(CAP, 'Caption that could not be saved'); await A.evaluate(() => document.querySelector('.cal-card[data-pid="p_t1"] textarea.cal-fld-cap').blur());
    await sleep(2500);
    check((await draftKeys(A)).length === 1, 'C2: the failed save keeps the draft');
    S.offline = false; await dismiss(A);
    await leave(A);
    const B = await S.newPage(); await S.openCalendar(B);
    check((await capBox(B)) === 'Caption that could not be saved', 'C2: after a failed save and a reload the typed caption is back');
    await B.evaluate(() => { const t = document.querySelector('.cal-card[data-pid="p_t1"] textarea.cal-fld-cap'); t.focus(); t.blur(); }); await sleep(3000);
    check(S.card('p_t1').caption === 'Caption that could not be saved', 'C2: leaving the box saves the restored caption');
    check((await draftKeys(B)).length === 0, 'C2: the confirmed save clears the draft');
    await leave(B);
    const C = await S.newPage(); await S.openCalendar(C);
    check((await capBox(C)) === 'Caption that could not be saved' && (await noteText(C, CARD)) === null, 'C2: reload after the save restores nothing');
    await S.close();
  });
  await section('block 3', async () => {
    const S = await createEnv(); const A = await S.newPage(); await S.openCalendar(A);
    await A.fill(CAP, 'Saved normally'); await A.evaluate(() => document.querySelector('.cal-card[data-pid="p_t1"] textarea.cal-fld-cap').blur()); await sleep(3000);
    check(S.card('p_t1').caption === 'Saved normally' && (await draftKeys(A)).length === 0, 'C3: a normal save clears the draft');
    await leave(A);
    const B = await S.newPage(); await S.openCalendar(B);
    check((await capBox(B)) === 'Saved normally' && (await noteText(B, CARD)) === null, 'C3: reload after a normal save shows the saved caption, no restored line');
    await S.close();
  });
  await section('block 4', async () => {
    const S = await createEnv(); const A = await S.newPage(); await S.openCalendar(A);
    await A.fill(CAP, 'Mine, typed before closing');
    await leave(A);
    S.setCardField('p_t1', { caption: 'Teammate rewrote it' }, 'teammate');
    const B = await S.newPage(); await S.openCalendar(B);
    const text = await banner(B);
    check(!!text && /Teammate rewrote it/.test(text) && /Mine, typed before closing/.test(text), 'C4: the caption changed elsewhere meanwhile: the two-choice notice shows both (' + text + ')');
    check(S.card('p_t1').caption === 'Teammate rewrote it' && (await capBox(B)) === 'Teammate rewrote it', 'C4: nothing was sent and the box shows the teammate\'s caption');
    await B.click(CARD + ' [data-conflict-theirs]'); await sleep(400);
    await leave(B);
    const C = await S.newPage(); await S.openCalendar(C);
    const aside = await banner(C);
    check(!!aside && /set aside/i.test(aside) && /Mine, typed before closing/.test(aside), 'C4: Use theirs keeps mine recoverable across a reload (' + aside + ')');
    await C.click(CARD + ' [data-conflict-restore]'); await sleep(3000);
    check(S.card('p_t1').caption === 'Mine, typed before closing', 'C4: Put mine back saves it');
    await S.close();
  });
  // ================= N: Calendar note =================
  await section('block 5', async () => {
    const S = await createEnv(); const A = await S.newPage(); await openNotes(S, A);
    await A.fill('#calCommentComposer', 'A note I did not send');
    await leave(A);
    const B = await S.newPage(); await openNotes(S, B);
    const val = await B.evaluate(() => document.getElementById('calCommentComposer').value);
    const n = await noteText(B, '#calCommentsOverlay');
    check(val === 'A note I did not send' && !!n, 'N1: a NEW tab restores the unsent note with the Restored line (' + val + ' / ' + n + ')');
    await B.click('.cal-cm-send'); await sleep(3500);
    check(S.comments.some(c => c.body === 'A note I did not send'), 'N1: sending works');
    check((await draftKeys(B)).length === 0, 'N1: the acknowledged note leaves no draft');
    await leave(B);
    const C = await S.newPage(); await openNotes(S, C);
    check((await C.evaluate(() => document.getElementById('calCommentComposer').value)) === '' && (await noteText(C, '#calCommentsOverlay')) === null, 'N1: reload after the send restores nothing');
    await S.close();
  });
  await section('block 6', async () => {
    const S = await createEnv(); const A = await S.newPage(); await openNotes(S, A);
    await A.fill('#calCommentComposer', 'On its way when the tab closed');
    S.behave['gw:comment'] = { delay: 15000 };
    await A.click('.cal-cm-send');
    for (let i = 0; i < 40 && !S.log.some(l => l.key === 'gw:comment'); i++) await sleep(100);
    await leave(A); delete S.behave['gw:comment'];
    check(S.comments.filter(c => c.body === 'On its way when the tab closed').length === 1, 'N2: the server did receive the note once');
    // the thread is loaded on the next open and holds the note: it must not come back as a draft
    const B = await S.newPage(); await S.openCalendar(B);
    await B.evaluate(() => { const p = calState.posts.find(x => x.id === 'p_t1'); p.comments = (p.comments || []).concat([{ id: 'sent-1', author: 'Browser Staff', role: 'smm', body: 'On its way when the tab closed', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), audience: 'internal' }]); });
    await B.click(CARD + ' .cal-comments-btn'); await B.waitForSelector('#calCommentComposer', { timeout: 8000 }); await sleep(600);
    const v = await B.evaluate(() => document.getElementById('calCommentComposer').value);
    check(v === '' && (await draftKeys(B)).length === 0, 'N2: the note is already in the thread, so it is NOT offered again (' + JSON.stringify(v) + ')');
    await S.close();
  });
  await section('block 7', async () => {
    const S = await createEnv(); const A = await S.newPage(); await openNotes(S, A);
    await A.fill('#calCommentComposer', 'Unknown whether it arrived');
    S.behave['gw:comment'] = { delay: 15000, commit: false };
    await A.click('.cal-cm-send');
    for (let i = 0; i < 40 && !S.log.some(l => l.key === 'gw:comment'); i++) await sleep(100);
    await leave(A); delete S.behave['gw:comment'];
    const B = await S.newPage(); await openNotes(S, B);
    const val = await B.evaluate(() => document.getElementById('calCommentComposer').value);
    const n = await noteText(B, '#calCommentsOverlay');
    check(val === 'Unknown whether it arrived' && /check the thread/.test(n || ''), 'N3: when the thread does not show it, the text comes back with a "check the thread" hint (' + n + ')');
    await S.close();
  });
  // ================= P: Production comment and reply =================
  await section('block 8', async () => {
    const S = await createEnv(); const A = await S.newPage(); await openProd(S, A);
    await A.fill('.prod-composer-input', 'A comment I did not post');
    await leave(A);
    const B = await S.newPage(); await openProd(S, B);
    const v = await B.evaluate(() => (document.querySelector('.prod-composer-input') || {}).value);
    check(v === 'A comment I did not post' && !!(await noteText(B, '')), 'P1: Production comment restored after a reload with the Restored line');
    S.behave['gw:comment'] = { mode: 'http', status: 500, body: { ok: false, error: 'write_failed' }, commit: false, times: 1 };
    await B.click('.prod-composer-submit'); await sleep(2500);
    check(S.comments.length === 0 && (await draftKeys(B)).length === 1, 'P1: a failed post keeps the draft');
    await leave(B);
    const C = await S.newPage(); await openProd(S, C);
    check((await C.evaluate(() => (document.querySelector('.prod-composer-input') || {}).value)) === 'A comment I did not post', 'P1: failed post then reload: the text is back');
    await C.click('.prod-composer-submit'); await sleep(3000);
    check(S.comments.some(c => c.body === 'A comment I did not post') && (await draftKeys(C)).length === 0, 'P1: posting works and clears the draft');
    await leave(C);
    const D = await S.newPage(); await openProd(S, D);
    check(((await D.evaluate(() => (document.querySelector('.prod-composer-input') || {}).value)) || '') === '' && (await noteText(D, '')) === null, 'P1: reload after the post restores nothing');
    // reply composer
    const rid = S.comments[0].id;
    await D.evaluate((id) => _prodCommentBegin('del_vid_1', 'add', id), rid); await sleep(500);
    await D.fill('.prod-composer-input', 'A reply I did not post');
    await leave(D);
    const E = await S.newPage(); await openProd(S, E);
    const rv = await E.evaluate(() => ({ v: (document.querySelector('.prod-composer-input') || {}).value, ctx: (document.querySelector('.prod-composer-form') || {}).textContent }));
    check(rv.v === 'A reply I did not post' && /Replying to thread/.test(rv.ctx || ''), 'P2: a reply draft comes back still marked as a reply');
    await S.close();
  });
  // ================= D: Production description =================
  await section('block 9', async () => {
    const S = await createEnv(); const A = await S.newPage(); await openProd(S, A);
    await A.click('.prod-description-action'); await sleep(400); await A.click('.prod-description-action[onclick*="source"]');
    await A.waitForSelector('.prod-description-textarea', { timeout: 5000 });
    await A.fill('.prod-description-textarea', 'Description text typed before closing');
    await leave(A);
    check(S.deliv[0].brief === 'Original description', 'D1: nothing had reached the server');
    const B = await S.newPage(); await openProd(S, B); await sleep(1200);
    const box = await B.evaluate(() => { const t = document.querySelector('.prod-description-textarea'); const r = document.querySelector('.prod-description-rich'); return t ? t.value : (r ? r.textContent : null); });
    check(box === 'Description text typed before closing' && !!(await noteText(B, '')), 'D1: the editor reopens on the typed description with the Restored line (' + box + ')');
    S.behave['gw:description'] = { mode: 'http', status: 500, body: { ok: false, error: 'write_failed' }, commit: false, times: 1 };
    await B.click('.prod-description-save'); await sleep(2500);
    check(S.deliv[0].brief === 'Original description' && (await draftKeys(B)).length === 1, 'D1: a failed save keeps the draft');
    await leave(B);
    const C = await S.newPage(); await openProd(S, C); await sleep(1200);
    check((await C.evaluate(() => { const t = document.querySelector('.prod-description-textarea'); const r = document.querySelector('.prod-description-rich'); return t ? t.value : (r ? r.textContent : null); })) === 'Description text typed before closing', 'D1: failed save then reload: the text is back');
    await C.click('.prod-description-save'); await sleep(3000);
    check(S.deliv[0].brief === 'Description text typed before closing' && (await draftKeys(C)).length === 0, 'D1: saving works and clears the draft');
    await leave(C);
    const D = await S.newPage(); await openProd(S, D); await sleep(1200);
    check((await D.evaluate(() => !document.querySelector('.prod-description-textarea') && !document.querySelector('.prod-description-rich'))) && (await noteText(D, '')) === null, 'D1: reload after the save opens no editor and restores nothing');
    // cancel forgets
    await D.click('.prod-description-action'); await sleep(400); await D.click('.prod-description-action[onclick*="source"]'); await D.waitForSelector('.prod-description-textarea');
    await D.fill('.prod-description-textarea', 'Typed then cancelled');
    await D.click('[data-prod-description-control="cancel"]'); await sleep(500);
    check((await draftKeys(D)).length === 0, 'D2: Cancel is a deliberate discard and forgets the draft');
    await S.close();
  });
  // ================= X: Create Post names =================
  await section('block 10', async () => {
    const S = await createEnv(); const A = await S.newPage(); await S.openCalendar(A);
    await A.evaluate(() => _calOpenNativePost()); await A.waitForSelector('#calNativePostCreate', { timeout: 10000 }); await sleep(1500);
    await A.fill('#calNativePostOverlay input.cal-native-name-input', 'My typed post name');
    await leave(A);
    const B = await S.newPage(); await S.openCalendar(B);
    await B.evaluate(() => _calOpenNativePost()); await B.waitForSelector('#calNativePostCreate', { timeout: 10000 }); await sleep(1500);
    const nm = await B.evaluate(() => (document.querySelector('#calNativePostOverlay input.cal-native-name-input') || {}).value);
    check(nm === 'My typed post name' && !!(await noteText(B, '#calNativePostOverlay')), 'X1: the Create Post dialog reopens with the typed name and the Restored line (' + nm + ')');
    await B.click('#calNativePostCreate'); await sleep(4000);
    check(!!S.lastIntake && (await draftKeys(B)).length === 0, 'X1: creating works and clears the draft');
    await B.evaluate(() => _calOpenNativePost()); await B.waitForSelector('#calNativePostCreate', { timeout: 10000 }); await sleep(1500);
    check(((await B.evaluate(() => (document.querySelector('#calNativePostOverlay input.cal-native-name-input') || {}).value)) || '') === '' && (await noteText(B, '#calNativePostOverlay')) === null, 'X1: the next dialog starts empty');
    await S.close();
  });
  // ================= S: storage that throws =================
  await section('block 11', async () => {
    const S = await createEnv();
    // Every read, write and removal of a draft throws, as it does when storage is blocked or full.
    await S.ctx.addInitScript(() => {
      const guard = (name) => { const orig = Storage.prototype[name]; Storage.prototype[name] = function (k) { if (typeof k === 'string' && k.indexOf('sv_draft_v1:') === 0) throw new Error('storage blocked'); return orig.apply(this, arguments); }; };
      ['getItem', 'setItem', 'removeItem'].forEach(guard);
    });
    const A = await S.newPage();
    await S.openCalendar(A).catch(() => {});
    const open = await A.evaluate(() => typeof calState !== 'undefined' && calState.posts.length > 0).catch(() => false);
    check(open, 'S1: the Calendar still opens when storage throws');
    if (open) {
      await A.fill(CAP, 'Typed while storage is blocked'); await A.evaluate(() => document.querySelector('.cal-card[data-pid="p_t1"] textarea.cal-fld-cap').blur()); await sleep(3000);
      check(S.card('p_t1').caption === 'Typed while storage is blocked', 'S1: a caption still saves');
      await A.click(CARD + ' .cal-comments-btn'); await A.waitForSelector('#calCommentComposer', { timeout: 8000 });
      await A.fill('#calCommentComposer', 'Note with storage blocked'); await A.click('.cal-cm-send'); await sleep(3000);
      check(S.comments.some(c => c.body === 'Note with storage blocked'), 'S1: a note still sends');
    }
    const P = await S.newPage();
    await S.openProduction(P).catch(() => {});
    await P.evaluate(() => _prodOpenDeliverable('del_vid_1')).catch(() => {}); await sleep(1800);
    await P.fill('.prod-composer-input', 'Comment with storage blocked').catch(() => {});
    await P.click('.prod-composer-submit').catch(() => {}); await sleep(2500);
    check(S.comments.some(c => c.body === 'Comment with storage blocked'), 'S1: a Production comment still posts');
    check(A.errors.filter(e => !/storage blocked/.test(e)).length === 0 && P.errors.filter(e => !/storage blocked/.test(e)).length === 0, 'S1: no page errors beyond the blocked storage itself ' + JSON.stringify(A.errors.concat(P.errors)));
    await S.close();
  });
  if (failures.length) { console.error('\nlost-work-drafts: ' + failures.length + ' FAILED\n- ' + failures.join('\n- ')); process.exit(1); }
  console.log('\nlost-work-drafts: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
