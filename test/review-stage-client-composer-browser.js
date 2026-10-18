'use strict';
/*
 * THE CLIENT REVIEW PAGE, OWNER FEEDBACK OF 2026-10-17 23:40 UTC (session Curtain Eight). Real browser, fully offline,
 * the shared mocked backend of review-stage-browser.js (fictional client, cards, people and conversation).
 *
 * 1. A client's caption edit changes the caption itself: the card save carries the new caption, the caption is
 *    neither approved nor sent back as a change request, and a plain note on the caption tells the team. The
 *    conversation shows it as the new caption with the old one folded and struck through, on the client page and on
 *    the SMM's (who can still edit the caption back). There is no "Please use this caption" change request.
 * 2. The client's message box: no "Is this a change?" prompt while typing; the parts (Video, Thumbnail, Caption) are
 *    clickable chips at the box's top left; "Ask for a change" needs a part and sends a change request on it;
 *    "Send comment" sends a plain comment that asks for nothing (on the chosen part, or the part on stage).
 * 3. The caption edit box and the message box use the conversation's thin scrollbar, not the browser's.
 * SHOTS=<dir> writes the PR screenshots (light and dark, 1440 and 390 wide); with SHOTS_ONLY=1 it only takes them
 * (the same steps run on main for the "before" set).
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { CLIENT, TOKEN, STAFF, open, inS, waitNew, sleep } = require('./fixtures/review-stage-fixture.js');

const SHOTS = process.env.SHOTS || '';
const ONLY = process.env.SHOTS_ONLY === '1';
const OLD_CAPTION = 'Most people decide in the first second. Here is how to earn the second one: start with the change, not the context.';
const NEW_CAPTION = 'The first second decides it.\n\nStart with the change, not the context.';

const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }

async function openClientReview(browser, origin, o) {
  const t = await open(browser, origin, Object.assign({ stage: 'client', flags: 'on' }, o));
  await t.page.goto(origin + '/index.html?' + new URLSearchParams({ c: CLIENT, v: 'calendar', tab: 'review', t: TOKEN }), { waitUntil: 'domcontentloaded' });
  await waitNew(t); await sleep(1200);
  return t;
}
async function waitUpsert(t, n0, fn) {
  for (let i = 0; i < 80 && !t.state.upserts.slice(n0).some(fn); i++) await sleep(100);
  return t.state.upserts.slice(n0).find(fn) || null;
}
const notes = (u, col) => { try { return JSON.parse(String(u[col] || '[]')); } catch (e) { return []; } };
const R = (page, fn, arg) => page.evaluate(([src, a]) => { const r = document.getElementById('svReviewStage').shadowRoot; return (0, eval)('(' + src + ')')(r, a); }, [fn.toString(), arg]);

async function editCaption(t, text) {
  await inS(t.page, '.stp[data-step="caption"]').click();
  await sleep(500);
  await inS(t.page, '#editBtn').click();
  await inS(t.page, '#capTa').fill(text);
  await inS(t.page, '#capSave').click();
}

async function shots(browser, origin) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const tag = ONLY ? 'before' : 'after';
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    for (const dark of [false, true]) {
      const name = (n) => path.join(SHOTS, tag + '-' + n + '-' + w + '-' + (dark ? 'dark' : 'light') + '.png');
      const t = await openClientReview(browser, origin, { width: w, height: h, dark });
      await inS(t.page, '#ta').fill('Could the music be a little quieter under the voice?');
      if (!ONLY) { await inS(t.page, '[data-pc="video"]').click(); await sleep(200); }
      await sleep(300);
      await t.page.screenshot({ path: name('message-box'), fullPage: w < 800 });
      await inS(t.page, '#ta').fill('');
      await editCaption(t, NEW_CAPTION);
      await sleep(1500);
      const sum = inS(t.page, '.was summary');
      if (await sum.count()) await sum.first().click();
      await sleep(300);
      await t.page.screenshot({ path: name('caption-edit'), fullPage: w < 800 });
      await t.ctx.close();
    }
  }
}

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  // Playwright hides scrollbars by default; the scrollbar checks need them drawn.
  const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
  try {
    if (SHOTS) await shots(browser, origin);
    if (ONLY) return;

    console.log('--- client: the message box ---');
    {
      const t = await openClientReview(browser, origin, {});
      const box = await R(t.page, (r) => {
        const cb = r.querySelector('#chat .cbox'), ta = r.getElementById('ta');
        const chips = Array.from(r.querySelectorAll('#chat .pchip'));
        const b = cb.getBoundingClientRect(), a = ta.getBoundingClientRect();
        return {
          parts: chips.map(c => c.dataset.pc + ':' + c.tagName + ':' + getComputedStyle(c).cursor),
          aboveText: chips.every(c => c.getBoundingClientRect().bottom <= a.top + 1),
          left: chips.length ? Math.round(chips[0].parentElement.firstElementChild.getBoundingClientRect().left - b.left) : -1,
          inBox: chips.every(c => { const x = c.getBoundingClientRect(); return x.left >= b.left && x.right <= b.right && x.top >= b.top; }),
          cmt: !!r.getElementById('cmtBtn'), chgBtn: !!r.getElementById('sendBtn'),
        };
      });
      expect(box.parts.join(',') === 'video:BUTTON:pointer,graphic:BUTTON:pointer,caption:BUTTON:pointer', 'the parts are clickable chips: ' + box.parts.join(', '));
      expect(box.aboveText && box.inBox && box.left >= 0 && box.left < 24, 'the chips sit at the top left of the message box, above the text (' + box.left + 'px from its left edge)');
      expect(box.cmt && box.chgBtn, 'the box has a comment button and a change-request button');
      await inS(t.page, '#ta').fill('Hello team, this one looks great.');
      await sleep(300);
      const typing = await R(t.page, (r) => ({
        prompt: /Is this a change\?/.test(r.getElementById('chat').innerText), sugg: !!r.querySelector('#chat .sugg'),
        cmt: !r.getElementById('cmtBtn').disabled, chg: !r.getElementById('sendBtn').disabled,
        // One row (comment, then change) or, where a wider fallback font wraps them, stacked at the right (comment above).
        order: (() => { const a = r.getElementById('cmtBtn').getBoundingClientRect(), b = r.getElementById('sendBtn').getBoundingClientRect(), cb = r.querySelector('#chat .cbox').getBoundingClientRect();
          const row = a.right <= b.left + 1 && Math.abs(a.top - b.top) < 4, stack = a.bottom <= b.top + 1 && cb.right - a.right < 16;
          return { ok: (row || stack) && cb.right - b.right < 16 && cb.bottom - b.bottom < 16, at: [a.left, a.top, a.right, b.left, b.top, b.right, cb.right, cb.bottom].map(Math.round).join(',') }; })(),
      }));
      expect(!typing.prompt && !typing.sugg, 'typing shows no "Is this a change?" prompt');
      expect(typing.cmt && !typing.chg, 'with no part picked, "Send comment" is on and "Ask for a change" is off');
      expect(typing.order.ok, 'the two buttons sit at the bottom right of the box, comment first (' + typing.order.at + ')');
      await inS(t.page, '[data-pc="graphic"]').click();
      await sleep(200);
      let st = await R(t.page, (r) => ({ pressed: r.querySelector('[data-pc="graphic"]').getAttribute('aria-pressed'), chg: r.getElementById('compose').classList.contains('chg'), on: !r.getElementById('sendBtn').disabled, why: (r.querySelector('.cl-parts .why') || {}).textContent || '', kept: r.getElementById('ta').value }));
      expect(st.pressed === 'true' && st.chg && st.on && /team will edit/.test(st.why), 'picking Thumbnail selects it, shows the change look and turns "Ask for a change" on (' + st.why + ')');
      expect(st.kept === 'Hello team, this one looks great.', 'picking a part keeps the typed words');
      await inS(t.page, '[data-pc="graphic"]').click();
      await sleep(200);
      st = await R(t.page, (r) => ({ pressed: r.querySelector('[data-pc="graphic"]').getAttribute('aria-pressed'), on: !r.getElementById('sendBtn').disabled }));
      expect(st.pressed === 'false' && !st.on, 'picking it again clears it');

      // a comment on a chosen part: a plain note, no status change
      await inS(t.page, '[data-pc="video"]').click();
      let n0 = t.state.upserts.length;
      await inS(t.page, '#cmtBtn').click();
      const c1 = await waitUpsert(t, n0, u => notes(u, 'video_tweaks').some(n => /Hello team/.test(n.body)));
      const c1n = c1 && notes(c1, 'video_tweaks').find(n => /Hello team/.test(n.body));
      expect(!!c1n && !c1n.is_tweak, 'Send comment saves a plain comment on the chosen part (the video)');
      expect(!t.state.upserts.slice(n0).some(u => u.video_status && u.video_status !== 'Client Approval'), 'and asks for nothing: the video\'s status is unchanged');
      await sleep(800);

      // a change request needs a part, and goes on it
      await inS(t.page, '#ta').fill('Please make the title bigger.');
      await inS(t.page, '[data-pc="graphic"]').click();
      n0 = t.state.upserts.length;
      await inS(t.page, '#sendBtn').click();
      const c2 = await waitUpsert(t, n0, u => u.graphic_status === 'Tweaks Needed');
      expect(!!c2 && notes(c2, 'graphic_tweaks').some(n => n.is_tweak && /title bigger/.test(n.body)), 'Ask for a change sends a change request on the thumbnail with the words');
      await sleep(800);

      // Enter with no part picked: a comment
      await inS(t.page, '#ta').fill('Thanks for the quick turnaround.');
      n0 = t.state.upserts.length;
      await inS(t.page, '#ta').press('Enter');
      const c3 = await waitUpsert(t, n0, u => ['video_tweaks', 'graphic_tweaks', 'caption_tweaks'].some(col => notes(u, col).some(n => /quick turnaround/.test(n.body))));
      expect(!!c3 && ['video_tweaks', 'graphic_tweaks', 'caption_tweaks'].every(col => notes(c3, col).filter(n => /quick turnaround/.test(n.body)).every(n => !n.is_tweak)), 'Enter with no part picked sends a plain comment');
      expect(!t.errors.length, 'no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }

    console.log('--- client: a caption edit changes the caption ---');
    {
      const t = await openClientReview(browser, origin, {});
      await inS(t.page, '.stp[data-step="caption"]').click();
      await sleep(500);
      await inS(t.page, '#editBtn').click();
      await inS(t.page, '#capTa').fill(Array.from({ length: 40 }, (_, i) => 'Line ' + (i + 1)).join('\n'));
      await sleep(200);
      const capBar = await R(t.page, (r) => { const e = r.getElementById('capTa'); const cs = getComputedStyle(e); return e.offsetWidth - e.clientWidth - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth); });
      expect(capBar > 0 && capBar <= 8, 'the caption edit box has the thin scrollbar (' + capBar + 'px wide; the browser\'s is about 15)');
      await inS(t.page, '#capCancel').click();
      await sleep(300);
      const n0 = t.state.upserts.length;
      await editCaption(t, NEW_CAPTION);
      const saved = await waitUpsert(t, n0, u => u.caption === NEW_CAPTION);
      const told = await waitUpsert(t, n0, u => notes(u, 'caption_tweaks').some(n => /^Changed the caption to:/.test(n.body)));
      const note = told && notes(told, 'caption_tweaks').find(n => /^Changed the caption to:/.test(n.body));
      expect(!!saved, 'the card save carries the client\'s new caption');
      expect(!!note && !note.is_tweak && note.role === 'client' && note.body.includes(NEW_CAPTION) && note.body.includes(OLD_CAPTION), 'a plain client note on the caption says it changed, with the new and the old text');
      expect(!t.state.upserts.slice(n0).some(u => u.caption_status === 'Approved' || u.caption_status === 'Tweaks Needed'), 'the caption is neither approved nor sent back as a change request');
      expect(!t.state.upserts.slice(n0).some(u => notes(u, 'caption_tweaks').some(n => /Please use this caption/.test(n.body))), 'no "Please use this caption" change request');
      await sleep(1200);
      const look = await R(t.page, (r) => {
        const b = Array.from(r.querySelectorAll('#tscroll .bub')).find(x => x.querySelector('.diff'));
        if (!b) return null;
        const d = b.querySelector('details.was');
        const before = d && (d.open || d.querySelector('.old').checkVisibility());
        if (d) d.open = true;
        const old = d && d.querySelector('.old');
        return { you: b.classList.contains('you'), head: b.querySelector('.bt').textContent, now: b.querySelector('.diff .new').textContent,
          summary: d ? d.querySelector('summary').textContent : '', foldedAtFirst: !before, old: old ? old.textContent : '', struck: old ? getComputedStyle(old).textDecorationLine : '',
          chg: b.classList.contains('is-chg'), stage: (r.querySelector('.tc-text') || {}).textContent || '' };
      });
      expect(!!look && look.you && look.head === 'You changed the caption' && look.now === NEW_CAPTION, 'the conversation shows "You changed the caption" with the new caption');
      expect(!!look && look.foldedAtFirst && look.summary === 'Show the old caption' && look.old === OLD_CAPTION && /line-through/.test(look.struck), 'the old caption is folded behind "Show the old caption" and struck through');
      expect(!!look && !look.chg, 'the note is not shown as a change request');
      expect(!!look && look.stage === NEW_CAPTION, 'the stage shows the new caption');
      expect(await inS(t.page, '[data-ok="caption"]').count() === 1, 'the caption still waits for the client\'s own Approve');
      // the message box's thin scrollbar
      await inS(t.page, '#ta').fill(Array.from({ length: 30 }, (_, i) => 'Note line ' + (i + 1)).join('\n'));
      await sleep(200);
      const taBar = await R(t.page, (r) => { const e = r.getElementById('ta'); return e.scrollHeight > e.clientHeight ? e.offsetWidth - e.clientWidth : -1; });
      expect(taBar > 0 && taBar <= 8, 'the message box has the thin scrollbar (' + taBar + 'px wide)');
      expect(!t.errors.length, 'no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }

    console.log('--- client: a caption that does not save posts no note ---');
    {
      const t = await openClientReview(browser, origin, {});
      const tried = [];
      // Every card save that carries the new caption fails; anything else answers as usual.
      await t.ctx.route(/\/functions\/v1\/(calendar-upsert|calendar-card-write)$/, async route => {
        const r = route.request();
        let b = {}; try { b = JSON.parse(r.postData() || '{}'); } catch (e) {}
        if (r.method() === 'POST' && b.post && b.post.caption === NEW_CAPTION) { tried.push(1); return route.fulfill({ status: 500, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: false, error: 'fixture failure' }) }); }
        return route.fallback();
      });
      const n0 = t.state.upserts.length;
      await editCaption(t, NEW_CAPTION);
      for (let i = 0; i < 60 && !tried.length; i++) await sleep(100);
      await sleep(3000);
      const noted = t.state.upserts.slice(n0).some(u => notes(u, 'caption_tweaks').some(n => /^Changed the caption to:/.test(n.body)));
      const bubble = await R(t.page, (r) => !!r.querySelector('#tscroll .bub .diff'));
      expect(tried.length > 0, 'the caption save was tried (' + tried.length + ')');
      expect(!noted && !bubble, 'when it fails, no "changed the caption" note is saved or shown');
      await t.ctx.close();
    }

    console.log('--- SMM: sees the client\'s caption edit and can change it back ---');
    {
      const t = await open(browser, origin, { stage: 'smm', staff: STAFF, flags: 'on' });
      const at = '2026-10-17T22:00:00.000Z';
      t.state.cards[0].caption = NEW_CAPTION;
      t.state.cards[0].caption_tweaks = JSON.stringify([{ id: 'e1', parent_id: null, author: CLIENT, role: 'client', is_tweak: false, audience: 'client',
        body: 'Changed the caption to:\n\n' + NEW_CAPTION + '\n\nIt was:\n\n' + OLD_CAPTION, created_at: at, updated_at: at, done: false, done_at: '', done_by: '' }]);
      await t.page.goto(origin + '/index.html?v=calendar', { waitUntil: 'domcontentloaded' });
      await t.page.waitForFunction(() => typeof _calSavePins === 'function' && typeof navTo === 'function', null, { timeout: 30000 });
      await t.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} _calSavePins([name]); calState.client = name; navTo('calendar'); }, CLIENT);
      await t.page.waitForFunction(() => typeof calState === 'object' && !calState.loading && (calState.posts || []).length > 0, null, { timeout: 30000 });
      await t.page.evaluate(() => onCalViewChange('smmreview'));
      await waitNew(t); await sleep(1200);
      await inS(t.page, '.stp[data-step="caption"]').click();
      await sleep(600);
      const s = await R(t.page, (r) => {
        const b = Array.from(r.querySelectorAll('#tscroll .bub')).find(x => x.querySelector('.diff'));
        return { found: !!b, team: !!b && b.classList.contains('team'), head: b ? b.querySelector('.bt').textContent : '', who: b ? b.querySelector('.bh b').textContent : '',
          old: b && b.querySelector('details.was .old') ? b.querySelector('details.was .old').textContent : '', edit: !!r.getElementById('editBtn') };
      });
      expect(s.found && s.team && s.head === 'Changed the caption' && /client/.test(s.who), 'the SMM sees the client\'s note as a caption change (' + s.who + ')');
      expect(s.old === OLD_CAPTION, 'with the old caption to hand');
      expect(s.edit, 'and can still edit the caption (back)');
      expect(!t.errors.length, 'no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\n' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nreview-stage-client-composer-browser: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
