'use strict';
/*
 * "ASK FOR A CHANGE" IS ALWAYS THERE, AND A COMMENT SAYS IT IS ONLY A MESSAGE (owner's ask 2026-11-01, session
 * Linkpolish, OPEN_REPAIRS 623). A real client kept pressing "Send comment" when she meant a change, because "Ask for a
 * change" stayed greyed out until she picked what it was about. Real browser, fully offline, the review page's own
 * fixture (fictional client, cards and token), review_client_polish on as it is live for every client.
 *   hint     with words typed and no part picked, a calm line by the buttons says a comment is only a message, and
 *            "Ask for a change" is clickable;
 *   pick     pressing it with no part picked opens "What should change?" inside the panel (no dialog), one button per
 *            part that can still change, focus on the first; the "About" chips step aside; picking one sends a change
 *            request on that part with the typed words;
 *   escape   Escape (or the cross) closes the choice, keeps the words and puts focus back on "Ask for a change";
 *   one      with only one part left to change, pressing it sends at once (no choice shown);
 *   comment  "Send comment" still sends a plain comment that asks for nothing;
 *   keys     the keyboard alone: Tab reaches the buttons, Enter opens the choice, Tab and Enter pick a part;
 *   touch    on a phone Enter in the box is still a new line;
 *   layout   at 1440, 390 and 320, light and dark: the choice sits inside the message box, no sideways scroll, and on a
 *            touch screen its buttons are 44 px high.
 * Every part fails on main. Run one part: --only=pick
 */
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const F = require('./fixtures/review-stage-fixture.js');

const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7);
const run = k => !ONLY || ONLY.split(',').includes(k);
const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }
const sleep = F.sleep;
const HELP = 'https://help.fixture.test/review';
const R = (page, fn, arg) => page.evaluate(([src, a]) => { const r = document.getElementById('svReviewStage').shadowRoot; return (0, eval)('(' + src + ')')(r, a); }, [fn.toString(), arg]);
const notes = (u, col) => { try { return JSON.parse(String(u[col] || '[]')); } catch (e) { return []; } };
async function waitUpsert(t, n0, fn) {
  for (let i = 0; i < 80 && !t.state.upserts.slice(n0).some(fn); i++) await sleep(100);
  return t.state.upserts.slice(n0).find(fn) || null;
}
function state(mut) {
  const cards = F.cards('client');
  if (mut) mut(cards);
  return { cards, upserts: [], gateway: [], flagReads: 0, orient: 'p', writeDelay: 0, writeFail: 0, native: {}, receipts: {}, writeAttempts: 0 };
}
async function openIt(browser, origin, o) {
  const touch = o.width < 800;
  const t = await F.openClient(browser, origin, Object.assign({ flags: 'on', polish: true, width: 1440, height: 900, tab: 'review', help: HELP }, o,
    { context: Object.assign({ colorScheme: o.dark ? 'dark' : 'light' }, touch ? { hasTouch: true, isMobile: true } : {}) }));
  await F.waitNew(t); await sleep(1200);
  return t;
}
const ta = t => F.inS(t.page, '#chat #ta');
async function typeIn(t, words) { const b = ta(t); await b.scrollIntoViewIfNeeded(); await b.fill(words); await sleep(200); }
const box = t => R(t.page, (r) => {
  const c = r.getElementById('chat'), vis = e => !!e && e.getClientRects().length > 0;
  const pick = c.querySelector('#clPick'), send = c.querySelector('#sendBtn'), hint = c.querySelector('#clHint');
  return {
    hint: vis(hint) ? hint.textContent : '', sendOn: !!send && !send.disabled, chips: vis(c.querySelector('.cl-parts')),
    pick: vis(pick), pickParts: pick ? Array.from(pick.querySelectorAll('[data-ask]')).map(b => b.dataset.ask) : [],
    focus: (r.activeElement && (r.activeElement.dataset.ask || r.activeElement.id)) || '', words: (c.querySelector('#ta') || {}).value || '',
    dialog: !!r.querySelector('[role="dialog"]:not([hidden]) #clPick') || !!document.querySelector('.modal.open, [role="dialog"][open]'),
  };
});

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    if (run('hint') || run('pick') || run('escape') || run('comment')) {
      const t = await openIt(browser, origin, {});
      const empty = await box(t);
      if (run('hint')) expect(!empty.hint, 'hint: the empty box shows no line (its height stays as before, so the loading screen still fits)');
      await typeIn(t, 'Can the intro be shorter?');
      let B = await box(t);
      if (run('hint')) {
        expect(/just a message/i.test(B.hint) && /Ask for a change/.test(B.hint), 'hint: a calm line says a comment is only a message (' + B.hint + ')');
        expect(B.sendOn, 'hint: "Ask for a change" is clickable with no part picked');
      }
      if (run('pick') || run('escape')) {
        if (B.sendOn) await F.inS(t.page, '#chat #sendBtn').click();
        await sleep(300);
        B = await box(t);
        expect(B.pick && B.pickParts.join() === 'video,graphic,caption', 'pick: "What should change?" opens in the panel with Video, Thumbnail and Caption (' + B.pickParts.join() + ')');
        expect(!B.dialog && !B.chips, 'pick: no dialog, and the "About" chips step aside while it is open');
        expect(B.focus === 'video', 'pick: focus moves to the first choice (' + B.focus + ')');
        expect(B.words === 'Can the intro be shorter?', 'pick: the words stay in the box');
      }
      if (run('escape') && B.pick) {
        await t.page.keyboard.press('Escape'); await sleep(250);
        B = await box(t);
        expect(!B.pick && B.chips && B.focus === 'sendBtn' && B.words === 'Can the intro be shorter?', 'escape: closes the choice, keeps the words, focus back on "Ask for a change" (' + B.focus + ')');
        await F.inS(t.page, '#chat #sendBtn').click(); await sleep(250);
        await F.inS(t.page, '#chat #clPickX').click(); await sleep(250);
        B = await box(t);
        expect(!B.pick && B.words === 'Can the intro be shorter?', 'escape: the cross closes it too');
        await F.inS(t.page, '#chat #sendBtn').click(); await sleep(250);
      }
      if (run('pick') && (await box(t)).pick) {
        const n0 = t.state.upserts.length;
        await F.inS(t.page, '#chat [data-ask="caption"]').click();
        const u = await waitUpsert(t, n0, x => x.caption_status === 'Tweaks Needed');
        expect(!!u && notes(u, 'caption_tweaks').some(n => n.is_tweak && /intro be shorter/.test(n.body)), 'pick: choosing Caption sends a change request on the caption with the words');
        expect(!t.state.upserts.slice(n0).some(x => (x.video_status && x.video_status !== 'Client Approval') || (x.graphic_status && x.graphic_status !== 'Client Approval')), 'pick: and nothing else is asked');
        await sleep(600);
        B = await box(t);
        expect(!B.pick && !B.words, 'pick: the box is empty and the choice closed after sending');
      }
      if (run('comment')) {
        await typeIn(t, 'Lovely music.');
        const n0 = t.state.upserts.length;
        await F.inS(t.page, '#chat #cmtBtn').click();
        const u = await waitUpsert(t, n0, x => ['video_tweaks', 'graphic_tweaks', 'caption_tweaks'].some(col => notes(x, col).some(n => /Lovely music/.test(n.body))));
        expect(!!u && ['video_tweaks', 'graphic_tweaks', 'caption_tweaks'].every(col => notes(u, col).filter(n => /Lovely music/.test(n.body)).every(n => !n.is_tweak)), 'comment: "Send comment" sends a plain comment');
        expect(!t.state.upserts.slice(n0).some(x => ['video_status', 'graphic_status', 'caption_status'].some(k => x[k] === 'Tweaks Needed')), 'comment: and asks for no change');
      }
      expect(!t.errors.length, 'no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }

    if (run('one')) {
      // Only the caption still waits: the video and the thumbnail are approved.
      const st = state(cards => { cards[0].video_status = 'Approved'; cards[0].graphic_status = 'Approved'; });
      const t = await openIt(browser, origin, { state: st });
      await typeIn(t, 'Shorter please.');
      const n0 = t.state.upserts.length;
      const on = (await box(t)).sendOn;
      if (on) await F.inS(t.page, '#chat #sendBtn').click();
      await sleep(250);
      const B = await box(t);
      const u = await waitUpsert(t, n0, x => x.caption_status === 'Tweaks Needed');
      expect(on && !B.pick && !!u && notes(u, 'caption_tweaks').some(n => n.is_tweak && /Shorter please/.test(n.body)), 'one: with only the caption left, "Ask for a change" sends it at once, no choice shown');
      await t.ctx.close();
    }

    if (run('keys')) {
      const t = await openIt(browser, origin, {});
      await typeIn(t, 'Brighter thumbnail.');
      await ta(t).focus();
      const order = [];
      for (let i = 0; i < 3; i++) { await t.page.keyboard.press('Tab'); order.push(await R(t.page, (r) => (r.activeElement && r.activeElement.id) || '')); }
      expect(order.includes('cmtBtn') && order.includes('sendBtn'), 'keys: Tab from the box reaches "Send comment" and "Ask for a change" (' + order.join(' > ') + ')');
      await R(t.page, (r) => r.getElementById('sendBtn').focus());
      await t.page.keyboard.press('Enter'); await sleep(300);
      let B = await box(t);
      expect(B.pick && B.focus === 'video', 'keys: Enter on "Ask for a change" opens the choice with focus on Video');
      await t.page.keyboard.press('Tab'); await sleep(100);
      B = await box(t);
      expect(B.focus === 'graphic', 'keys: Tab moves to Thumbnail (' + B.focus + ')');
      const n0 = t.state.upserts.length;
      await t.page.keyboard.press('Enter');
      const u = await waitUpsert(t, n0, x => x.graphic_status === 'Tweaks Needed');
      expect(!!u && notes(u, 'graphic_tweaks').some(n => n.is_tweak && /Brighter thumbnail/.test(n.body)), 'keys: Enter on Thumbnail sends the change on the thumbnail');
      await t.ctx.close();
    }

    if (run('touch') || run('layout')) {
      for (const [w, h] of [[1440, 900], [390, 844], [320, 700]]) for (const dark of [false, true]) {
        const tag = w + (dark ? ' dark' : ' light');
        const t = await openIt(browser, origin, { width: w, height: h, dark });
        if (run('touch') && w < 800) {
          const b = ta(t); await b.scrollIntoViewIfNeeded(); await b.tap(); await t.page.keyboard.type('First'); await t.page.keyboard.press('Enter'); await t.page.keyboard.type('second'); await sleep(200);
          expect((await box(t)).words === 'First\nsecond', 'touch ' + tag + ': Enter is still a new line on a phone');
        }
        await typeIn(t, 'Can the intro be shorter?');
        const on = (await box(t)).sendOn;
        if (on) { const s = F.inS(t.page, '#chat #sendBtn'); await s.scrollIntoViewIfNeeded(); await s.click(); }
        await sleep(350);
        const L = await R(t.page, (r) => {
          const c = r.getElementById('chat'), pick = c.querySelector('#clPick'), cbox = c.querySelector('.cbox');
          if (!pick || !pick.getClientRects().length) return null;
          const p = pick.getBoundingClientRect(), b = cbox.getBoundingClientRect();
          const btns = Array.from(pick.querySelectorAll('button')).map(x => x.getBoundingClientRect());
          return { inside: p.left >= b.left - 0.5 && p.right <= b.right + 0.5 && p.top >= b.top - 0.5 && p.bottom <= b.bottom + 0.5,
            within: btns.every(x => x.left >= p.left - 0.5 && x.right <= p.right + 0.5), minH: Math.round(Math.min(...btns.map(x => x.height))),
            sideways: document.scrollingElement.scrollWidth > window.innerWidth + 1 };
        });
        expect(!!L && L.inside && L.within && !L.sideways, 'layout ' + tag + ': the choice sits inside the message box, every button inside it, no sideways scroll (' + JSON.stringify(L) + ')');
        if (w < 800) expect(!!L && L.minH >= 44, 'layout ' + tag + ': on a touch screen the choices are at least 44 px high (' + (L && L.minH) + ')');
        expect(!t.errors.length, 'layout ' + tag + ': no page errors (' + t.errors.join(' | ') + ')');
        await t.ctx.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\nreview-stage-client-ask-change-browser: ' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nreview-stage-client-ask-change-browser: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
