'use strict';
/*
 * ONE QUESTION PER ACTION ON THE MANAGER'S REVIEW TAB (owner report 2026-10-18, session Settle).
 *
 * The manager (the social media manager) picks "Approve to Kasper" or "Approve to client" on a part that still has open
 * change requests ("tweaks"). The page used to ask the same thing again: a pop-up "Tweaks resolved, where to next?"
 * with a checklist and three buttons (Kasper approval / Client approval / Approve). Now the pick IS the answer: every
 * open change request on that part is marked done in the same save (the same record the pop-up wrote with every box
 * ticked), a toast says "N change requests marked done" with Undo, and Undo reopens exactly those.
 *
 * In a real browser, fully offline (the review-stage fixture, fictional data), this proves:
 *   1. two open requests, "Approve to Kasper": no pop-up at any moment; ONE save holds both requests done and the
 *      Kasper status; a plain note is untouched; the toast says "2 change requests marked done" and is on top of the
 *      page; Undo reopens exactly those two (a third request that was already done stays done);
 *   2. one open request, "Approve to client" from the menu: no pop-up, "1 change request marked done", status
 *      Client Approval, and the menu offers nothing but "Approve to client" (no plain "Approve");
 *   3. a thumbnail and a caption with open requests behave the same way;
 *   4. a part with NO open requests: no toast, the same save as before;
 *   5. a refused save: the toast never claims "done", and Try again saves the status and the finished requests together;
 *   6. the Notes "mark done" on the LAST open request still asks where to send it, once, with Kasper approval, Client
 *      approval and "Mark done", and no plain Approve and no checklist;
 *   7. the Notes panel opens at the newest message of a long conversation (also after the thread read lands late),
 *      stays there when a message arrives at the bottom, and does not move a reader who scrolled up.
 * Fails on main (the pop-up opens; the panel opens part way up).
 */
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { CLIENT, STAFF, open, inS, waitNew, sleep } = require('./fixtures/review-stage-fixture.js');

const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }

const tw = (id, role, body, extra) => Object.assign({
  id, parent_id: null, author: role === 'kasper' ? 'Kasper' : 'Fixture Client', role, is_tweak: true, audience: 'client', body,
  created_at: '2026-10-12T16:12:00.000Z', updated_at: '2026-10-12T16:12:00.000Z', done: false, done_at: '', done_by: ''
}, extra || {});
const popup = page => page.evaluate(() => { const o = document.getElementById('resolveDestOverlay'); return !!(o && o.classList.contains('active')); });
const toast = page => page.evaluate(() => {
  const e = document.querySelector('.sv-toast.show');
  if (!e) return null;
  const r = e.getBoundingClientRect(), top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { text: e.querySelector('.sv-toast-msg').textContent, undo: !!e.querySelector('.sv-toast-action'), onTop: !!top && e.contains(top) };
});
const lastUpsert = (t, pred) => t.state.upserts.slice().reverse().find(pred);
const parse = s => { try { return JSON.parse(s || '[]'); } catch (e) { return []; } };

// Opens the manager's Review tab; `edit` shapes the first card. Only the parts in `only` still wait on the manager.
async function openSmm(browser, origin, only, edit, opt) {
  const t = await open(browser, origin, Object.assign({ stage: 'smm', flags: 'on', staff: STAFF }, opt || {}));
  for (const k of ['video', 'graphic', 'caption']) if (!only.includes(k)) t.state.cards[0][k + '_status'] = 'Approved';
  if (edit) edit(t.state.cards[0]);
  await t.page.goto(origin + '/index.html?v=calendar', { waitUntil: 'domcontentloaded' });
  await t.page.waitForFunction(() => typeof _calSavePins === 'function' && typeof navTo === 'function', null, { timeout: 30000 });
  await t.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} _calSavePins([name]); calState.client = name; navTo('calendar'); }, CLIENT);
  await t.page.waitForFunction(() => typeof calState === 'object' && !calState.loading && (calState.posts || []).length > 0, null, { timeout: 30000 });
  await t.page.evaluate(() => onCalViewChange('smmreview'));
  await waitNew(t);
  await sleep(800);
  return t;
}
// Watches for the pop-up for the whole of an action (it used to open within a frame of the click).
async function watchPopup(page) {
  await page.evaluate(() => {
    window.__popupSeen = false;
    const o = document.getElementById('resolveDestOverlay');
    if (o) new MutationObserver(() => { if (o.classList.contains('active')) window.__popupSeen = true; }).observe(o, { attributes: true, attributeFilter: ['class'] });
  });
}
const popupSeen = page => page.evaluate(() => !!window.__popupSeen);
async function until(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Date.now() - t0; await sleep(100); } return -1; }

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    // 1. two open requests, Approve to Kasper
    console.log('--- two open change requests, Approve to Kasper ---');
    let t = await openSmm(browser, origin, ['video'], c => {
      c.video_tweaks = JSON.stringify([
        tw('a0', 'client', 'An earlier request, already handled.', { done: true, done_at: '2026-10-11T10:00:00.000Z', done_by: 'Fixture Owner' }),
        tw('a1', 'client', 'Cut the pause after the hook.'),
        tw('a2', 'kasper', 'Shorten the intro.'),
        tw('a3', 'smm', 'A plain note, not a request.', { is_tweak: false }),
      ]);
    });
    await watchPopup(t.page);
    await inS(t.page, '[data-ok="video"]').click();
    let took = await until(async () => (await toast(t.page)) !== null, 6000);
    expect(took >= 0, '1: a toast appears once the save is answered (' + took + ' ms)');
    expect(!(await popupSeen(t.page)) && !(await popup(t.page)), '1: the "where to next" pop-up never opens');
    const up = lastUpsert(t, u => u.id === 'rs1' && u.video_status);
    const list = up ? parse(up.video_tweaks) : [];
    const byId = id => list.find(c => c.id === id) || {};
    expect(up && up.video_status === 'Kasper Approval', '1: the save sends the part to Kasper');
    expect(byId('a1').done === true && byId('a2').done === true && !!byId('a1').done_at && !!byId('a1').done_by, '1: both open requests are marked done in that same save, with who and when');
    expect(byId('a3').done === false && byId('a3').is_tweak === false, '1: the plain note is untouched');
    expect(byId('a0').done_by === 'Fixture Owner', '1: the request that was already done keeps its own record');
    expect(t.state.upserts.filter(u => u.id === 'rs1').length === 1, '1: exactly one save (' + t.state.upserts.filter(u => u.id === 'rs1').length + ')');
    const tt = await toast(t.page);
    expect(tt && tt.text === '2 change requests marked done' && tt.undo, '1: the toast reads "2 change requests marked done" with Undo (' + JSON.stringify(tt) + ')');
    expect(tt && tt.onTop, '1: the toast sits on top of the review page, readable');
    await t.page.locator('.sv-toast .sv-toast-action').click();
    took = await until(async () => { const u = lastUpsert(t, x => x.id === 'rs1' && x.video_tweaks && parse(x.video_tweaks).some(c => c.id === 'a1' && c.done === false)); return !!u; }, 6000);
    expect(took >= 0, '1: Undo saves the two requests open again (' + took + ' ms)');
    const undone = parse((lastUpsert(t, x => x.id === 'rs1' && x.video_tweaks) || {}).video_tweaks);
    const u1 = id => undone.find(c => c.id === id) || {};
    expect(u1('a1').done === false && u1('a2').done === false && u1('a1').done_at === '' && u1('a1').done_by === '', '1: Undo reopens exactly the two it closed, with the done record cleared');
    expect(u1('a0').done === true && u1('a0').done_by === 'Fixture Owner', '1: the request that was done before stays done');
    expect(t.errors.length === 0, '1: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();

    // 2. one open request, Approve to client from the menu
    console.log('--- one open change request, Approve to client from the menu ---');
    t = await openSmm(browser, origin, ['video', 'caption'], c => { c.video_tweaks = JSON.stringify([tw('b1', 'client', 'Make the end card longer.')]); });
    await watchPopup(t.page);
    await inS(t.page, '[data-menu="video"]').click();
    const items = await inS(t.page, '.apmenu [role="menuitem"]').allTextContents();
    expect(items.length === 1 && /Approve to client/.test(items[0]), '2: the menu offers only "Approve to client", no plain "Approve" (' + JSON.stringify(items) + ')');
    await inS(t.page, '.apmenu [data-alt="client"]').click();
    took = await until(async () => (await toast(t.page)) !== null, 6000);
    const up2 = lastUpsert(t, u => u.id === 'rs1' && u.video_status);
    expect(took >= 0 && !(await popupSeen(t.page)), '2: no pop-up; a toast appears');
    expect(up2 && up2.video_status === 'Client Approval' && parse(up2.video_tweaks).every(c => c.done === true), '2: the part goes to the client and its request is marked done in the same save');
    expect(((await toast(t.page)) || {}).text === '1 change request marked done', '2: the toast says "1 change request marked done" (' + JSON.stringify(await toast(t.page)) + ')');
    expect(t.errors.length === 0, '2: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();

    // 3. a thumbnail and a caption
    console.log('--- thumbnail and caption with open change requests ---');
    t = await openSmm(browser, origin, ['graphic', 'caption'], c => {
      c.graphic_deliverable_id = 'del_rs1_thumb';   // a linked thumbnail, so its status can change
      c.graphic_tweaks = JSON.stringify([tw('g1', 'client', 'Bigger title text.')]);
      c.caption_tweaks = JSON.stringify([tw('c1', 'client', 'Shorter first line.'), tw('c2', 'kasper', 'Drop the second hashtag.')]);
    });
    await watchPopup(t.page);
    await inS(t.page, '.stp[data-step="graphic"]').click();
    await sleep(500);
    await inS(t.page, '[data-ok="graphic"]').click();
    took = await until(async () => !!lastUpsert(t, u => u.id === 'rs1' && u.graphic_status === 'Kasper Approval'), 6000);
    const ug = lastUpsert(t, u => u.id === 'rs1' && u.graphic_status === 'Kasper Approval');
    expect(took >= 0 && parse(ug.graphic_tweaks).every(c => c.done === true), '3: thumbnail: sent to Kasper with its request marked done');
    await sleep(1400);
    await inS(t.page, '.stp[data-step="caption"]').click();
    await sleep(500);
    await inS(t.page, '[data-menu="caption"]').click();
    await inS(t.page, '.apmenu [data-alt="client"]').click();
    took = await until(async () => !!lastUpsert(t, u => u.id === 'rs1' && u.caption_status === 'Client Approval'), 6000);
    const uc = lastUpsert(t, u => u.id === 'rs1' && u.caption_status === 'Client Approval');
    expect(took >= 0 && parse(uc.caption_tweaks).length === 2 && parse(uc.caption_tweaks).every(c => c.done === true), '3: caption: sent to the client with both requests marked done');
    expect(!(await popupSeen(t.page)), '3: no pop-up on either part');
    await t.ctx.close();

    // 4. no open requests
    console.log('--- no open change requests ---');
    t = await openSmm(browser, origin, ['video', 'caption'], c => { c.video_tweaks = JSON.stringify([tw('d1', 'client', 'Handled long ago.', { done: true, done_at: '2026-10-11T10:00:00.000Z', done_by: 'Fixture Owner' })]); });
    await inS(t.page, '[data-ok="video"]').click();
    took = await until(async () => !!lastUpsert(t, u => u.id === 'rs1' && u.video_status === 'Kasper Approval'), 6000);
    await sleep(800);
    expect(took >= 0 && (await toast(t.page)) === null, '4: sent to Kasper with no toast (nothing was marked done)');
    await t.ctx.close();

    // 5. a refused save
    console.log('--- a refused save ---');
    t = await openSmm(browser, origin, ['video', 'caption'], c => { c.video_tweaks = JSON.stringify([tw('e1', 'client', 'Cut the pause.')]); });
    t.state.writeFail = 1;
    await inS(t.page, '[data-ok="video"]').click();
    took = await until(async () => (await inS(t.page, '[data-retry="video"]').count()) > 0, 6000);
    await sleep(600);
    expect(took >= 0, '5: the stage shows the reason and Try again');
    expect((await toast(t.page)) === null, '5: no "marked done" toast for a send that was refused');
    // The refused save keeps the requests staged with the send: Try again saves both together (nothing is lost).
    const n5 = t.state.upserts.length;
    await inS(t.page, '[data-retry="video"]').click();
    took = await until(async () => !!lastUpsert(t, u => u.id === 'rs1' && u.video_status === 'Kasper Approval'), 6000);
    const up5 = lastUpsert(t, u => u.id === 'rs1' && u.video_status === 'Kasper Approval');
    expect(took >= 0 && t.state.upserts.length > n5 && parse(up5.video_tweaks).every(c => c.done === true), '5: Try again saves the Kasper status and the finished request together');
    await t.ctx.close();

    // 6. Notes "mark done" on the last open request still asks once
    console.log('--- Notes, mark the last request done ---');
    t = await openSmm(browser, origin, ['video'], c => { c.video_tweaks = JSON.stringify([tw('f1', 'client', 'The only request left.')]); });
    await t.page.evaluate(() => openCalComments('rs1'));
    await t.page.waitForSelector('#calCommentsFeed .cal-cm-action', { timeout: 8000 });
    await t.page.locator('#calCommentsFeed .cal-cm-action', { hasText: 'Mark done' }).first().evaluate(el => el.click());
    took = await until(() => popup(t.page), 3000);
    expect(took >= 0, '6: marking the last request done asks where to send the part, once');
    const shape = await t.page.evaluate(() => ({
      title: document.querySelector('#resolveDestOverlay .confirm-box-title').textContent,
      buttons: Array.from(document.querySelectorAll('#resolveDestOverlay button')).filter(b => b.offsetParent).map(b => b.textContent.trim()),
      checks: document.querySelectorAll('#resolveDestOverlay input[type="checkbox"]').length,
    }));
    expect(shape.buttons.includes('Kasper approval') && shape.buttons.includes('Client approval') && shape.buttons.some(b => /^Mark done/.test(b)), '6: it offers Kasper approval, Client approval and Mark done (' + JSON.stringify(shape.buttons) + ')');
    expect(!shape.buttons.includes('Approve'), '6: there is no plain "Approve"');
    expect(shape.checks === 0, '6: there is no checklist');
    await t.page.locator('#resolveDestKasper').click();
    took = await until(async () => !!lastUpsert(t, u => u.id === 'rs1' && u.video_status === 'Kasper Approval' && parse(u.video_tweaks).every(c => c.done === true)), 6000);
    expect(took >= 0, '6: Kasper approval marks it done and sends the part to Kasper');
    await t.ctx.close();

    // 7. the Notes panel scroll
    console.log('--- the Notes panel opens at the newest message ---');
    const many = [];
    for (let i = 0; i < 40; i++) many.push(tw('m' + i, 'smm', 'Fictional note number ' + i + ' about the cut and the pacing of the intro.', { is_tweak: false, created_at: '2026-10-1' + (i % 9) + 'T10:' + String(10 + (i % 40)).padStart(2, '0') + ':00.000Z' }));
    t = await openSmm(browser, origin, ['video'], c => { c.video_tweaks = JSON.stringify(many); });
    const feedAt = () => t.page.evaluate(() => { const f = document.getElementById('calCommentsFeed'); return f ? { gap: Math.round(f.scrollHeight - f.scrollTop - f.clientHeight), over: f.scrollHeight > f.clientHeight + 200, top: Math.round(f.scrollTop) } : null; });
    await t.page.evaluate(() => openCalComments('rs1'));
    await sleep(2500);   // the thread read has landed and redrawn the panel by now
    let f = await feedAt();
    expect(f && f.over && f.gap < 40, '7: a long conversation opens at the newest message (' + JSON.stringify(f) + ')');
    await t.page.evaluate(() => { const p = calState.posts.find(x => x.id === 'rs1'); const l = p.comments.slice(); l.push({ id: 'new1', parent_id: null, author: 'Fixture Reviewer', role: 'smm', is_tweak: false, audience: 'client', body: 'A message that just arrived.', created_at: '2026-10-19T09:00:00.000Z', updated_at: '2026-10-19T09:00:00.000Z', done: false, done_at: '', done_by: '' }); p.comments = l; p.video_comments = l; _calRenderCommentsModal({ keepFocus: true }); });
    await sleep(400);
    const f0 = f;
    f = await feedAt();
    expect(f && f.gap < 40 && f.top > f0.top, '7: a new message at the bottom keeps the panel at the bottom, now lower (' + JSON.stringify(f0) + ' then ' + JSON.stringify(f) + ')');
    await t.page.evaluate(() => { document.getElementById('calCommentsFeed').scrollTop = 300; });
    await sleep(200);
    await t.page.evaluate(() => { const p = calState.posts.find(x => x.id === 'rs1'); const l = p.comments.slice(); l.push({ id: 'new2', parent_id: null, author: 'Fixture Reviewer', role: 'smm', is_tweak: false, audience: 'client', body: 'Another message while reading above.', created_at: '2026-10-19T09:05:00.000Z', updated_at: '2026-10-19T09:05:00.000Z', done: false, done_at: '', done_by: '' }); p.comments = l; p.video_comments = l; _calRenderCommentsModal({ keepFocus: true }); });
    await sleep(400);
    f = await feedAt();
    expect(f && Math.abs(f.top - 300) < 4, '7: a reader who scrolled up is not moved when a message arrives (' + JSON.stringify(f) + ')');
    await t.page.evaluate(() => closeCalComments());
    await sleep(300);
    await t.page.evaluate(() => openCalComments('rs1'));
    await sleep(1500);
    f = await feedAt();
    expect(f && f.gap < 40, '7: opening it again starts at the newest message, not where it was left (' + JSON.stringify(f) + ')');
    expect(t.errors.length === 0, '7: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\n' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\none question per action: all passed');
})().catch(e => { console.error(e); process.exit(1); });
