'use strict';
/*
 * THE CLIENT REVIEW PAGE'S POLISH, behind review_client_polish (session Porch, 2026-10-24). Real browser, fully
 * offline, the shared mocked backend of the review-stage tests (fictional client, cards, people and conversation).
 *
 * 1. Approve: no wait or progress cursor anywhere; the button morphs into a small spinner at once, then a check the
 *    moment the save lands, then the row settles as Approved and the stage moves on. Measured click to check, with the
 *    switch off (click to the "Saved" mark) and on, under the same simulated server times. A refused save puts the
 *    buttons back with a plain message and no check.
 * 2. A change request: sent and confirmed, and the box stays open and empty on the same part; several sent in a row,
 *    even while the first is still saving, all arrive, in order, and no words are lost.
 * 3. No "Sending..." (or "Saving...") text on the page while anything sends: a spinner.
 * 4. Deleting a note: no "Delete note" text; a cross on hover (and on focus); it asks "Delete this note?" with Delete
 *    and Cancel; Cancel keeps the note, Delete deletes it.
 * 5. Switch off: the page exactly as before (the label, "Delete note", the box closing after a change).
 * SHOTS=<dir> writes the PR screenshots (light and dark, 1440 and 390 wide); SHOTS_ONLY=1 takes only those, with the
 * switch off for the "before" set when POLISH=0.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { CLIENT, TOKEN, open, inS, waitNew, sleep } = require('./fixtures/review-stage-fixture.js');

const SHOTS = process.env.SHOTS || '';
const ONLY = process.env.SHOTS_ONLY === '1';
const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }

async function openClient(browser, origin, o) {
  const t = await open(browser, origin, Object.assign({ stage: 'client', flags: 'on', polish: true }, o));
  await t.page.goto(origin + '/index.html?' + new URLSearchParams({ c: CLIENT, v: 'calendar', tab: 'review', t: TOKEN }), { waitUntil: 'domcontentloaded' });
  await waitNew(t); await sleep(1200);
  return t;
}
const R = (page, fn, arg) => page.evaluate(([src, a]) => { const r = document.getElementById('svReviewStage').shadowRoot; return (0, eval)('(' + src + ')')(r, a); }, [fn.toString(), arg]);
const notes = (row, col) => { try { return JSON.parse(String(row[col] || '[]')); } catch (e) { return []; } };
// Everything the page shows or does while it sends: any "Sending" or "Saving" text, any wait or progress cursor.
async function watch(t) {
  await t.page.evaluate(() => {
    const r = document.getElementById('svReviewStage').shadowRoot;
    window.__seen = { text: [], cursor: [] };
    const look = () => {
      const txt = (r.getElementById('rsApp') || r).innerText || '';
      const m = txt.match(/Sending|Saving…|Saving\.\.\./);
      if (m && !window.__seen.text.includes(m[0])) window.__seen.text.push(m[0]);
      const els = [document.documentElement, document.body].concat(Array.from(r.querySelectorAll('*')));
      for (const el of els) { const c = getComputedStyle(el).cursor; if ((c === 'wait' || c === 'progress') && window.__seen.cursor.length < 5) window.__seen.cursor.push((el.className && el.className.baseVal === undefined ? el.className : el.tagName) + ':' + c); }
    };
    window.__look = setInterval(look, 25);
    new MutationObserver(look).observe(r, { subtree: true, childList: true, characterData: true, attributes: true });
  });
}
const seen = (t) => t.page.evaluate(() => window.__seen);

/* Click (press 100 ms, as a hand does) to the first frame that shows the answer landed: the check with the switch on,
   the stepper's "Saved" mark with it off. Server times: permission read 150 ms, status write 250 ms, card write 250 ms. */
async function timeApprove(browser, origin, polish) {
  const t = await openClient(browser, origin, { polish });
  Object.assign(t.state, { authorityDelay: 150, gatewayDelay: 250, writeDelay: 250 });
  await t.page.evaluate((on) => {
    const r = document.getElementById('svReviewStage').shadowRoot;
    window.__m = {};
    new MutationObserver(() => {
      const now = performance.now() - window.__t0;
      if (!window.__t0) return;
      if (!window.__m.busy && r.querySelector('#drow [aria-busy="true"]')) window.__m.busy = Math.round(now);
      if (!window.__m.done && r.querySelector(on ? '#drow .cp-ok' : '.stp .svd')) window.__m.done = Math.round(now);
    }).observe(r, { subtree: true, childList: true, attributes: true });
    r.querySelector('#drow [data-ok]').addEventListener('pointerdown', () => { window.__t0 = performance.now(); }, { capture: true });
  }, !!polish);
  const b = await inS(t.page, '#drow [data-ok]').first().boundingBox();
  await t.page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await t.page.mouse.down(); await sleep(100); await t.page.mouse.up();
  for (let i = 0; i < 60 && !(await t.page.evaluate(() => window.__m.done)); i++) await sleep(50);
  const m = await t.page.evaluate(() => window.__m);
  await t.ctx.close();
  return m;
}

async function shots(browser, origin) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const polish = process.env.POLISH !== '0';
  const tag = polish ? 'after' : 'before';
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    for (const dark of [false, true]) {
      const name = (n) => path.join(SHOTS, tag + '-' + n + '-' + w + '-' + (dark ? 'dark' : 'light') + '.png');
      const t = await openClient(browser, origin, { width: w, height: h, dark, polish, thread: true });
      const full = w < 800;
      // the approve moment: a slow save, caught under the spinner
      t.state.writeDelay = 4000;
      await inS(t.page, '#drow [data-ok]').first().click();
      await sleep(350);
      await t.page.screenshot({ path: name('1-approve-saving'), fullPage: full });
      if (polish) {
        t.state.writeDelay = 0;
        for (let i = 0; i < 100 && !(await inS(t.page, '#drow .cp-ok').count()); i++) await sleep(40);
        await sleep(200);
        await t.page.screenshot({ path: name('2-approve-check'), fullPage: full });
      }
      await sleep(4500);
      // a change request sent: the box on the thumbnail
      await inS(t.page, '#ta').fill('Could the title be a touch bigger?');
      await inS(t.page, '[data-pc="graphic"]').click(); await sleep(150);
      t.state.writeDelay = 3000;
      await inS(t.page, '#sendBtn').click();
      await sleep(300);
      await t.page.screenshot({ path: name('3-change-sending'), fullPage: full });
      t.state.writeDelay = 0;
      await sleep(3600);
      await t.page.screenshot({ path: name('4-change-sent'), fullPage: full });
      // the client's own note: hover, then the question
      const own = inS(t.page, '.bub.you, .cpm.me').last();
      await own.scrollIntoViewIfNeeded();
      await own.hover(); await sleep(250);
      await t.page.screenshot({ path: name('5-note-hover'), fullPage: full });
      if (polish && await inS(t.page, '[data-cp-note] [data-cp-del]').count()) {
        await own.hover(); await inS(t.page, '[data-cp-note] [data-cp-del]').last().click({ force: true }); await sleep(250);
        await t.page.screenshot({ path: name('6-note-delete-ask'), fullPage: full });
      }
      await t.ctx.close();
    }
  }
}

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    if (SHOTS) await shots(browser, origin);
    if (ONLY) return;

    console.log('--- 1. Approve: speed, before and after ---');
    {
      const off = await timeApprove(browser, origin, false);
      const on = await timeApprove(browser, origin, true);
      console.log('     switch off: pressed to busy ' + off.busy + ' ms, to the "Saved" mark ' + off.done + ' ms');
      console.log('     switch on:  pressed to spinner ' + on.busy + ' ms, to the check ' + on.done + ' ms');
      expect(on.busy != null && on.busy < 250, 'the spinner shows within the press (' + on.busy + ' ms after the press began)');
      expect(on.done != null && off.done != null && on.done < off.done, 'the check shows sooner than the old "Saved" mark (' + on.done + ' ms against ' + off.done + ' ms)');
    }

    console.log('--- 1. Approve: the spinner, the check, the settled row, no wait cursor ---');
    {
      const t = await openClient(browser, origin, {});
      await watch(t);
      t.state.writeDelay = 900;
      await inS(t.page, '#drow [data-ok]').first().click();
      await sleep(120);
      const busy = await R(t.page, (r) => { const b = r.querySelector('#drow .b-ok'); return b && { cls: b.className, text: b.innerText.trim(), spin: !!b.querySelector('.cp-spin'), w: Math.round(b.getBoundingClientRect().width), label: b.getAttribute('aria-label') }; });
      expect(busy && /cp-morph/.test(busy.cls) && busy.spin && busy.text === '', 'Approve turns into a small spinner with no words (' + JSON.stringify(busy) + ')');
      let ck = null;
      for (let i = 0; i < 80 && !ck; i++) { await sleep(25); ck = await R(t.page, (r) => { const b = r.querySelector('#drow .cp-ok'); return b ? b.getAttribute('aria-label') : null; }); }
      expect(ck === 'Video approved', 'then a check the moment the save lands (' + ck + ')');
      await sleep(1100);
      const settled = await R(t.page, (r) => ({ step: (r.querySelector('.stp.on') || {}).dataset && r.querySelector('.stp.on').dataset.step, ok: !!r.querySelector('.stp[data-step="video"].ok') }));
      expect(settled.ok && settled.step !== 'video', 'then the row settles: the video reads approved and the stage moves on (' + JSON.stringify(settled) + ')');
      const s = await seen(t);
      expect(!s.cursor.length, 'no wait or progress cursor at any moment (' + s.cursor.join(', ') + ')');
      expect(!s.text.length, 'no "Sending" or "Saving" text at any moment (' + s.text.join(', ') + ')');
      expect(!t.errors.length, 'no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }

    console.log('--- 1. Approve: a refused save ---');
    {
      const t = await openClient(browser, origin, {});
      t.state.refusal = { code: 'fixture_refused', status: 409 };
      await inS(t.page, '#drow [data-ok]').first().click();
      await sleep(1500);
      const st = await R(t.page, (r) => ({ ok: !!r.querySelector('#drow [data-ok]:not([disabled])'), check: !!r.querySelector('#drow .cp-ok, .stp[data-step="video"].ok'), err: (r.querySelector('#drow .err') || {}).innerText || '', step: r.querySelector('.stp.on').dataset.step }));
      expect(st.ok && !st.check && st.step === 'video', 'the buttons come back, with no check, on the same part (' + JSON.stringify(st) + ')');
      expect(/^Not saved\./.test(st.err) && !/[{}_]|fixture_refused|HTTP|\d{3}|\bcode\b|owner/.test(st.err), 'with a plain message (' + st.err.replace(/\s+/g, ' ') + ')');
      await t.ctx.close();
    }

    console.log('--- 2 and 3. Change requests in a row, the box stays open, no "Sending" text ---');
    {
      const t = await openClient(browser, origin, {});
      await watch(t);
      const words = ['Could the title be a touch bigger?', 'And a little more contrast on the face.', 'Last one: move the text up a bit.'];
      t.state.writeDelay = 700;
      await inS(t.page, '#ta').fill(words[0]);
      await inS(t.page, '[data-pc="graphic"]').click(); await sleep(150);
      await inS(t.page, '#sendBtn').click();
      await sleep(120);
      let box = await R(t.page, (r) => ({ ta: !!r.getElementById('ta'), val: (r.getElementById('ta') || {}).value, pressed: (r.querySelector('[data-pc="graphic"]') || { getAttribute: () => '' }).getAttribute('aria-pressed'), spin: !!r.querySelector('#chat .cp-st .cp-spin') }));
      expect(box.ta && box.val === '' && box.pressed === 'true', 'after sending, the box stays open and empty, still on the thumbnail (' + JSON.stringify(box) + ')');
      expect(box.spin, 'with a small spinner while it sends');
      // the next two while the first is still saving, typed key by key across the moment it lands
      await inS(t.page, '#ta').pressSequentially(words[1], { delay: 30 });
      const typed = await R(t.page, (r) => (r.getElementById('ta') || {}).value);
      expect(typed === words[1], 'typing while the first lands loses no key (' + typed + ')');
      await inS(t.page, '#sendBtn').click();
      await sleep(80);
      await inS(t.page, '#ta').fill(words[2]);
      await t.page.keyboard.press('Enter');
      await sleep(80);
      const shown = await R(t.page, (r, w) => w.map(x => (r.getElementById('chat').innerText || '').includes(x)), words);
      expect(shown.every(Boolean), 'every change shows in the conversation from its send (' + shown.join(',') + ')');
      for (let i = 0; i < 100; i++) { const row = t.state.cards.find(c => c.id === 'rs1'); if (words.every(w => notes(row, 'graphic_tweaks').some(n => n.body === w))) break; await sleep(100); }
      const row = t.state.cards.find(c => c.id === 'rs1');
      const saved = notes(row, 'graphic_tweaks').filter(n => words.includes(n.body));
      expect(saved.length === 3 && saved.every(n => n.is_tweak) && saved.map(n => n.body).join('|') === words.join('|'), 'all three saved as change requests on the thumbnail, in order (' + saved.length + ')');
      expect(row.graphic_status === 'Tweaks Needed', 'and the thumbnail reads Tweaks Needed');
      await sleep(400);
      box = await R(t.page, (r) => ({ ta: !!r.getElementById('ta'), val: (r.getElementById('ta') || {}).value, sent: (r.querySelector('#chat .cp-done') || {}).innerText || '' }));
      expect(box.ta && box.val === '' && /3 changes sent/.test(box.sent), 'the box is still open and empty, and says so (' + box.sent + ')');
      const s = await seen(t);
      expect(!s.text.length, 'no "Sending" or "Saving" text at any moment (' + s.text.join(', ') + ')');
      expect(!s.cursor.length, 'no wait or progress cursor (' + s.cursor.join(', ') + ')');
      // Finish reviewing still ends the post
      const fin = await R(t.page, (r) => !!r.getElementById('finishBtn'));
      expect(fin, 'Finish reviewing is there to leave');
      await t.ctx.close();
    }

    console.log('--- 2. A refused change: no word is lost ---');
    {
      const t = await openClient(browser, origin, {});
      t.state.writeDelay = 500; t.state.refusal = { code: 'fixture_refused', status: 409 };
      await inS(t.page, '#ta').fill('First change.');
      await inS(t.page, '[data-pc="video"]').click(); await sleep(150);
      await inS(t.page, '#sendBtn').click();
      await sleep(60);
      // typed while the first is on its way: pressed in the box, never filled over it
      await inS(t.page, '#ta').pressSequentially('Second change.', { delay: 5 });
      await t.page.keyboard.press('Enter');
      await sleep(3000);
      const st = await R(t.page, (r) => ({ val: (r.getElementById('ta') || {}).value || '', unsent: Array.from(r.querySelectorAll('.err details .tc-text')).map(x => x.textContent).join('|'), err: Array.from(r.querySelectorAll('.err')).map(x => x.innerText.replace(/\s+/g, ' ')).join(' | '), dialog: !!document.querySelector('#confirmOverlay.active') }));
      expect(/Second change\./.test(st.val) && /First change\./.test(st.unsent), 'neither is lost: the refused one keeps its words and Try again ("' + st.unsent + '"), the next is back in the box ("' + st.val + '")');
      expect(/Not saved\./.test(st.err) && /Try again/.test(st.err) && !st.dialog, 'the part says so in plain words, with no dialog on top (' + st.err + ')');
      // Sending again from the box first tries the refused one again, then the next follows
      t.state.refusal = null;
      await inS(t.page, '#sendBtn').click();
      const has = () => { const row = t.state.cards.find(c => c.id === 'rs1'); const b = notes(row, 'video_tweaks').filter(n => n.is_tweak).map(n => n.body); const i1 = b.indexOf('First change.'), i2 = b.findIndex(x => /Second change\./.test(x)); return i1 >= 0 && i2 > i1; };
      for (let i = 0; i < 100 && !has(); i++) await sleep(100);
      expect(has(), 'and both arrive, in order, once the server takes them');
      await t.ctx.close();
    }

    console.log('--- 2. A dropped connection: both changes still arrive ---');
    {
      const t = await openClient(browser, origin, {});
      t.state.writeDelay = 500; t.state.writeFail = 1;
      await inS(t.page, '#ta').fill('First change.');
      await inS(t.page, '[data-pc="video"]').click(); await sleep(150);
      await inS(t.page, '#sendBtn').click();
      await sleep(60);
      await inS(t.page, '#ta').fill('Second change.');
      await inS(t.page, '#sendBtn').click();
      const has = () => { const row = t.state.cards.find(c => c.id === 'rs1'); return ['First change.', 'Second change.'].every(w => notes(row, 'video_tweaks').some(n => n.body === w && n.is_tweak)); };
      for (let i = 0; i < 150 && !has(); i++) await sleep(100);
      expect(has(), 'the first is re-sent on its own and the second follows it');
      await t.ctx.close();
    }

    console.log('--- 2. A change still waiting its turn survives a reload ---');
    {
      const t = await openClient(browser, origin, {});
      t.state.writeHang = true;   // the first change never gets an answer
      await inS(t.page, '#ta').fill('First, still on its way.');
      await inS(t.page, '[data-pc="graphic"]').click(); await sleep(150);
      await inS(t.page, '#sendBtn').click(); await sleep(150);
      await inS(t.page, '#ta').fill('Second, waiting its turn.');
      await inS(t.page, '#sendBtn').click(); await sleep(300);
      t.state.writeHang = false;
      await t.page.reload({ waitUntil: 'domcontentloaded' });
      await waitNew(t); await sleep(1500);
      const st = await R(t.page, (r) => ({ val: (r.getElementById('ta') || {}).value || '', part: (r.querySelector('[data-pc][aria-pressed="true"]') || { dataset: {} }).dataset.pc || '' }));
      expect(/Second, waiting its turn\./.test(st.val) && st.part === 'graphic', 'after a reload the waiting change is back in its box, on its part, unsent (' + JSON.stringify(st) + ')');
      await t.ctx.close();
    }

    console.log('--- 2. Refused while the client is on another post: the words stay with their own post ---');
    {
      const t = await openClient(browser, origin, {});
      t.state.writeDelay = 900; t.state.refusal = { code: 'fixture_refused', status: 409 };
      await inS(t.page, '#ta').fill('Change one on the first post.');
      await inS(t.page, '[data-pc="graphic"]').click(); await sleep(150);
      await inS(t.page, '#sendBtn').click(); await sleep(60);
      await inS(t.page, '#ta').fill('Change two on the first post.');
      await inS(t.page, '#sendBtn').click(); await sleep(60);
      // over to the third post and type there before the refusal comes back
      await t.page.evaluate(() => { const r = document.getElementById('svReviewStage').shadowRoot; const c = r.querySelector('[data-id="rs3"]'); if (c) c.click(); });
      await sleep(400);
      await inS(t.page, '#ta').fill('A comment on the third post.');
      await sleep(2500);
      const third = await R(t.page, (r) => (r.getElementById('ta') || {}).value || '');
      expect(third === 'A comment on the third post.', 'the third post\'s box keeps only its own words (' + third.replace(/\n/g, ' / ') + ')');
      await t.page.evaluate(() => { const r = document.getElementById('svReviewStage').shadowRoot; const c = r.querySelector('[data-id="rs1"]'); if (c) c.click(); });
      await sleep(600);
      const first = await R(t.page, (r) => (r.getElementById('ta') || {}).value || '');
      expect(/Change two on the first post\./.test(first), 'and the first post\'s box has its waiting change back (' + first.replace(/\n/g, ' / ') + ')');
      await t.ctx.close();
    }

    console.log('--- 2. On the stage: Ask for a change keeps its box open ---');
    {
      const t = await openClient(browser, origin, {});
      await inS(t.page, '#drow [data-chg]').first().click(); await sleep(200);
      await inS(t.page, '#ta').fill('Start on the second shot, please.');
      await inS(t.page, '#sendBtn').click();
      await sleep(1500);
      const st = await R(t.page, (r) => ({ inStage: !!r.querySelector('#drow #ta'), val: (r.querySelector('#drow #ta') || {}).value, sent: (r.querySelector('#drow .cp-done') || {}).innerText || '', ph: (r.querySelector('#drow #ta') || {}).placeholder }));
      expect(st.inStage && st.val === '' && /Sent/.test(st.sent), 'the stage box stays open and empty, and says Sent (' + JSON.stringify(st) + ')');
      const row = t.state.cards.find(c => c.id === 'rs1');
      expect(notes(row, 'video_tweaks').some(n => n.is_tweak && /second shot/.test(n.body)), 'the change was saved');
      await t.ctx.close();
    }

    console.log('--- 4. Deleting one\'s own note ---');
    {
      const t = await openClient(browser, origin, { thread: true });
      const txt = await R(t.page, (r) => r.getElementById('chat').innerText);
      expect(!/Delete note/.test(txt), 'no "Delete note" text under the notes');
      const own = inS(t.page, '[data-cp-note]:has([data-cp-del])').last();
      const id = await own.getAttribute('data-cp-note');
      const before = await R(t.page, (r, i) => getComputedStyle(r.querySelector('[data-cp-note="' + i + '"] .cp-x')).opacity, id);
      await own.hover(); await sleep(250);
      const hover = await R(t.page, (r, i) => { const x = r.querySelector('[data-cp-note="' + i + '"] .cp-x'), b = x.closest('.bb, .cpm-b').getBoundingClientRect(), c = x.getBoundingClientRect(); return { op: getComputedStyle(x).opacity, topRight: c.right >= b.right - 4 && c.top <= b.top + 4, label: x.getAttribute('aria-label') }; }, id);
      expect(before === '0' && hover.op === '1' && hover.topRight, 'a small cross shows at the note\'s top right on hover only (' + before + ' to ' + JSON.stringify(hover) + ')');
      await inS(t.page, '[data-cp-note="' + id + '"] .cp-x').click(); await sleep(200);
      const ask = await R(t.page, (r) => { const a = r.querySelector('.cp-ask'); return a ? a.innerText.replace(/\s+/g, ' ').trim() : ''; });
      expect(ask === 'Delete this note? Delete Cancel', 'it asks "Delete this note?" with Delete and Cancel (' + ask + ')');
      await inS(t.page, '.cp-no').click(); await sleep(200);
      expect(await inS(t.page, '[data-cp-note="' + id + '"]').count() === 1 && !(await inS(t.page, '.cp-ask').count()), 'Cancel keeps the note');
      // keyboard: the cross shows on focus too
      const focused = await R(t.page, (r, i) => { const x = r.querySelector('[data-cp-note="' + i + '"] .cp-x'); x.focus(); return getComputedStyle(x).opacity; }, id);
      await sleep(200);
      const fop = await R(t.page, (r, i) => getComputedStyle(r.querySelector('[data-cp-note="' + i + '"] .cp-x')).opacity, id);
      expect(fop === '1', 'and on keyboard focus (' + focused + ' then ' + fop + ')');
      const n0 = t.state.upserts.length;
      await inS(t.page, '[data-cp-note="' + id + '"] .cp-x').click(); await sleep(150);
      await inS(t.page, '.cp-yes').click();
      for (let i = 0; i < 60 && !t.state.upserts.slice(n0).length; i++) await sleep(100);
      const dialog = await t.page.evaluate(() => { const o = document.getElementById('confirmOverlay'); return !!(o && o.classList.contains('active')); });
      expect(!dialog, 'Delete deletes at once, with no second dialog');
      const del = t.state.upserts.slice(n0).some(u => ['video_tweaks', 'graphic_tweaks', 'caption_tweaks'].some(col => notes(u, col).some(n => n.id === id && n.deleted)));
      expect(del, 'the note is saved as deleted');
      await sleep(500);
      expect(await inS(t.page, '[data-cp-note="' + id + '"]').count() === 0, 'and leaves the conversation');
      expect(!t.errors.length, 'no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }

    console.log('--- 5. Switch off: the page as it was ---');
    {
      const t = await openClient(browser, origin, { polish: false, thread: true });
      const st = await R(t.page, (r) => ({ cp: !!r.querySelector('.rs.cp'), del: /Delete note/.test(r.getElementById('chat').innerText), x: !!r.querySelector('.cp-x') }));
      expect(!st.cp && st.del && !st.x, 'no polish, "Delete note" is there, no cross (' + JSON.stringify(st) + ')');
      t.state.writeDelay = 800;
      await inS(t.page, '#drow [data-ok]').first().click();
      await sleep(150);
      const busy = await R(t.page, (r) => { const b = r.querySelector('#drow .b-ok'); return { text: b.innerText.trim(), cursor: getComputedStyle(b).cursor, morph: /cp-morph/.test(b.className) }; });
      expect(busy.text === 'Approved' && !busy.morph && busy.cursor === 'progress', 'Approve reads "Approved" with its spinner, as before (' + JSON.stringify(busy) + ')');
      await sleep(1500);
      t.state.writeDelay = 0;
      await inS(t.page, '#ta').fill('Old-page change.');
      await inS(t.page, '[data-pc="graphic"]').click(); await sleep(150);
      await inS(t.page, '#sendBtn').click(); await sleep(1200);
      const after = await R(t.page, (r) => ({ pressed: (r.querySelector('[data-pc="graphic"]') || { getAttribute: () => 'gone' }).getAttribute('aria-pressed'), sent: !!r.querySelector('.cp-done') }));
      expect(after.pressed !== 'true' && !after.sent, 'a sent change clears the part, as before (' + JSON.stringify(after) + ')');
      await t.ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\nreview-client-polish-browser: ' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nreview-client-polish-browser: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
