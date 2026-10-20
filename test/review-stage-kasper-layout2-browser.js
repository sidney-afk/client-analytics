'use strict';
/*
 * KASPER'S REVIEW SESSION, SECOND LAYOUT (owner request relayed 2026-10-20, session Easel).
 * Real browser, fully offline, the shared mocked backend of review-stage-browser.js (fictional client, cards, people).
 *
 * Behind the runtime flag review_stage_kasper_layout2 { "staff": [...] } (read like review_stage_kasper_staff, default off):
 *   - flag off, naming someone else, the wrong shape, or a window under 1360 wide: today's page (the strip across the
 *     top with the list button, one part at a time under a step bar, Finish reviewing on a row of its own);
 *   - flag on: one always-visible list on the left (thumbnail, title, client, the status bubbles, the count at the
 *     top, its own scroll, the current card marked, Up / Down / Home / End move through it);
 *   - every part of the card on stage together, each with its own Approve and Ask for a change; a vertical video puts
 *     them side by side, a wide one puts the video across the top and the others below it, decided from the video's
 *     real shape (then the thumbnail's);
 *   - Finish reviewing and Close card at the top right of the card, no row of their own, with the card's title and its
 *     date line at the top left of that row (round 2, 2026-10-20), and a tooltip on Close card;
 *   - one compact row of buttons per part: Tweaks are on Frame left, Approve centred, Ask for a change right;
 *   - Undo on an approved part's row (the toast's own Undo), the editors' bell, no scroll jump on With the editors;
 *   - the saves are the old page's: approve, ask for a change, change my mind, finish, close.
 * EASEL_SHOTS=<dir> also writes screenshots (fixture data only).
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { CLIENT, STAFF, OTHER, open, inS, waitNew, answerConfirm, sleep } = require('./fixtures/review-stage-fixture.js');

const SHOTS = process.env.EASEL_SHOTS || '';
const failures = [];
let checks = 0;
function expect(value, message) { checks++; if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }
async function shot(t, name) { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); await sleep(500); await t.page.screenshot({ path: path.join(SHOTS, name + '.png') }); }

async function openKasper(browser, origin, o, wait) {
  const t = await open(browser, origin, Object.assign({ stage: 'kasper', flags: 'on', staff: STAFF, expectNew: true, linkedParts: true, mergeComments: true, nativeReceipts: true }, o));
  await t.page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
  await t.page.waitForFunction(() => typeof navTo === 'function', null, { timeout: 30000 });
  await t.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} try { wlMergeClientsFromSheet([name]); } catch (e) {} navTo('kasper'); }, CLIENT);
  if (wait === 'old') await waitNew(t);
  else await t.page.waitForFunction(() => { const h = document.getElementById('svReviewStage'); const r = h && h.shadowRoot; return !!(r && r.querySelectorAll('#l2g .pn').length); }, null, { timeout: 30000 });
  await sleep(1800);
  return t;
}
// What the page looks like, from inside its shadow root.
function look(page) {
  return page.evaluate(() => {
    const r = document.getElementById('svReviewStage').shadowRoot;
    const vis = el => !!el && !el.closest('[hidden]') && el.getClientRects().length > 0 && el.getBoundingClientRect().width > 0 && getComputedStyle(el).visibility !== 'hidden';
    const box = el => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom }; };
    const q = s => r.querySelector(s);
    const panes = {};
    r.querySelectorAll('#l2g .pn').forEach(p => {
      const k = p.dataset.part, m = p.querySelector('.pn-m'), d = p.querySelector('.pn-d');
      const media = m.querySelector('.rs-fv:not([hidden]) .fv-player, .player.rs-novid, .bigthumb, .tcard');
      panes[k] = { m: box(m), d: box(d), media: box(media), mediaVisible: vis(media), approve: !!d.querySelector('[data-ok="' + k + '"]'), okBox: box(d.querySelector('[data-ok="' + k + '"]')), askBox: box(d.querySelector('[data-chg="' + k + '"]')), frameBox: box(d.querySelector('[data-frame="' + k + '"]')), askName: ((d.querySelector('[data-chg="' + k + '"]') || {}).textContent || '').trim(), approveVisible: vis(d.querySelector('[data-ok="' + k + '"]')), ask: !!d.querySelector('[data-chg="' + k + '"]'), askVisible: vis(d.querySelector('[data-chg="' + k + '"]')), text: d.textContent.replace(/\s+/g, ' ').trim() };
    });
    const rows = Array.from(r.querySelectorAll('#qlList [data-id]')).map(b => ({
      id: b.dataset.id, cur: b.getAttribute('aria-current') === 'true', title: (b.querySelector('.cn') || {}).textContent || '',
      client: (b.querySelector('.cm > span:not(.ub)') || {}).textContent || '', img: !!b.querySelector('img[src]'), dots: b.querySelectorAll('.cd i').length,
      dotsOk: b.querySelectorAll('.cd i.ok').length, dotsChg: b.querySelectorAll('.cd i.chg').length, box: box(b), tab: b.getAttribute('tabindex'),
    }));
    const list = q('#qlList');
    const g = q('#l2g');
    const act = q('#l2a');
    return {
      l2: !!q('.rs.l2'), strip: !!q('#strip'), qBtn: !!q('#qBtn'), qPanel: !!q('#qPanel'), stepper: !!q('#stepper'), drow: !!q('#drow'), drow2: !!q('.drow2'),
      ql: vis(q('#ql')), qlBox: box(q('#ql')), count: (q('#qlHead') || {}).textContent || '', rows, list: list ? { sh: list.scrollHeight, ch: list.clientHeight, top: list.scrollTop, oy: getComputedStyle(list).overflowY } : null,
      heading: (q('#side h2') || {}).textContent || '', panes, orient: g ? (g.classList.contains('l2-land') ? 'land' : g.classList.contains('l2-port') ? 'port' : '') : '',
      finish: box(q('#finishBtn')), close: box(q('#closeBtn')), finishText: (q('#finishBtn') || {}).textContent || '', finishDisabled: q('#finishBtn') ? q('#finishBtn').disabled : null,
      act: box(act), card: box(q('.card')), sdate: box(q('#sdate')), h2: box(q('#side h2')), l2h: box(q('.l2h')), closeTip: (q('#closeTip') || {}).textContent || '', closeDesc: (q('#closeBtn') || { getAttribute() { return ''; } }).getAttribute('aria-describedby'), stage: box(q('#stage')), chat: box(q('#chat')),
      focus: r.activeElement && r.activeElement.dataset ? r.activeElement.dataset.id || '' : '',
      css: Array.from(r.querySelectorAll('style')).map(s => s.textContent).join('').includes('.ql-h{'),
      pageScroll: { w: document.scrollingElement.scrollWidth, cw: document.scrollingElement.clientWidth },
      oneVisiblePart: !!q('#view') && !q('#stepper'),
    };
  });
}
async function titles(page) { return (await look(page)).heading; }

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    // ---------- the flag off, or not for this person, or the window too narrow: today's page ----------
    const olds = [
      ['flag off', { layout2: false }, 1440],
      ['flag names someone else', { layout2: { staff: [OTHER.id] } }, 1440],
      ['flag in the wrong shape', { layout2: { staff: 'qa_marquee' } }, 1440],
      ['flag on, window 1100 wide', { layout2: true }, 1100],
      ['flag on, phone 390 wide', { layout2: true }, 390],
    ];
    for (const [label, o, w] of olds) {
      console.log('--- ' + label + ' ---');
      const t = await openKasper(browser, origin, Object.assign({ width: w, height: w < 600 ? 844 : 900 }, o), 'old');
      const L = await look(t.page);
      expect(!L.l2 && !L.ql && !L.css, label + ': none of the second layout is on the page (no list, no extra styles)');
      expect(L.strip && L.qBtn && L.stepper && L.drow, label + ': the strip with its list button, the step bar and the decision row are there');
      expect(L.oneVisiblePart === false, label + ': one part at a time under the step bar');
      expect(L.drow2, label + ': Finish reviewing has its row, as today');
      expect(t.errors.length === 0, label + ': no page errors (' + t.errors.join(' | ') + ')');
      if (label === 'flag off') await shot(t, 'old-layout-1440');
      await t.ctx.close();
    }

    // ---------- the flag on, a vertical video, 1440 x 900 ----------
    console.log('--- flag on, vertical, 1440 x 900 ---');
    let t = await openKasper(browser, origin, { layout2: true, width: 1440, height: 900 });
    let L = await look(t.page);
    expect(L.l2 && L.ql, 'the second layout is on: the list shows');
    expect(!L.strip && !L.qBtn && !L.qPanel, 'no strip across the top and no "Waiting for your review" dropdown');
    expect(!L.stepper && !L.drow2, 'no step bar and no separate Finish row');
    // the list
    expect(/^7/.test(L.count.trim()) && /to review/.test(L.count), 'the count of cards left to review heads the list (' + L.count.trim() + ')');
    expect(L.rows.length === 7, 'every waiting card is a row (' + L.rows.length + ')');
    expect(L.rows.every(r => r.img && r.title && r.client === CLIENT && r.dots >= 2 && r.dots <= 3) && L.rows[0].dots === 3, 'each row has its thumbnail, title, client and the status bubbles (one per part)');
    expect(L.rows.filter(r => r.cur).length === 1 && L.rows.find(r => r.cur).title === L.heading.replace(CLIENT + ' · ', ''), 'exactly the card on stage is marked current (' + L.heading + ')');
    expect(L.rows.every(r => r.box.x >= L.qlBox.x && r.box.r <= L.qlBox.r + 1), 'the rows sit inside the list, which is at the left of the stage');
    expect(L.qlBox.r < L.card.x && L.chat.x > L.card.r - 1, 'the list is left of the card, the conversation right of it');
    expect(L.pageScroll.w <= L.pageScroll.cw, 'no sideways scroll');
    // all parts together
    const keys = Object.keys(L.panes);
    expect(keys.join(',') === 'video,graphic,caption', 'every part of the card is on stage (' + keys.join(',') + ')');
    expect(keys.every(k => L.panes[k].mediaVisible && L.panes[k].approveVisible && L.panes[k].askVisible), 'each part is visible with its own Approve and Ask for a change');
    expect(L.panes.video.askVisible && !!(await inS(t.page, '[data-frame="video"]').count()), 'Tweaks are on Frame sits with the video');
    expect(L.orient === 'port' && L.panes.video.m.x < L.panes.graphic.m.x && L.panes.graphic.m.x < L.panes.caption.m.x, 'a vertical video: the parts side by side (' + L.orient + ')');
    expect(Math.abs(L.panes.video.m.y - L.panes.graphic.m.y) < 2 && Math.abs(L.panes.graphic.d.y - L.panes.caption.d.y) < 2 && Math.abs(L.panes.video.d.y - L.panes.caption.d.y) < 2, 'the buttons of the three parts line up on one row');
    expect(L.panes.video.media.h > 430, 'the video is bigger than the old 385 px (' + Math.round(L.panes.video.media.h) + ' px tall)');
    // Finish and Close
    expect(!!L.finish && !!L.close && L.close.x > L.finish.x, 'Finish reviewing and Close card are both there, Close to the right of Finish');
    expect(Math.abs((L.finish.y + L.finish.h / 2) - (L.close.y + L.close.h / 2)) < 2 && L.finish.y < L.panes.video.m.y, 'they share one row, at the top of the card, above the parts');
    expect(L.card.r - L.close.r < 40 && L.close.r <= L.card.r, 'aligned to the right edge of the card (' + Math.round(L.card.r - L.close.r) + ' px from it)');
    expect(/0 of 3/.test(L.finishText.replace(/\s+/g, ' ')) && L.finishDisabled === true, 'Finish reviewing reads 0 of 3 and waits');
    // round 2: the card's title in the panel's header, one compact row of buttons per part, the tooltip
    expect(L.h2 && L.sdate && L.l2h && L.h2.y >= L.l2h.y - 1 && L.sdate.y >= L.h2.b - 2 && L.sdate.y - L.h2.b < 12, 'the title is at the top left of the panel header with the date and round line just below it');
    expect(L.h2.x < L.finish.x && L.h2.y < L.panes.video.m.y && L.h2.b <= L.panes.video.m.y && !(await inS(t.page, '.stage > .side').count()), 'the title is in the panel\'s own top row, not on a row above the panel');
    expect(/Back after tweaks|First review/.test(await inS(t.page, '#sdate').textContent()) && L.sdate.h < 24, 'the date and round text is one small line');
    for (const k of keys) {
      const P = L.panes[k];
      expect(P.okBox && P.askBox && P.askName === 'Ask for a change' && P.askBox.x > P.okBox.r - 1, k + ': Approve is left of Ask for a change, which keeps its name');
      expect(Math.abs((P.okBox.y + P.okBox.h / 2) - (P.askBox.y + P.askBox.h / 2)) < 4 && P.d.h < 60, k + ': both are on ONE compact row (' + Math.round(P.d.h) + ' px tall)');
      const mid = (P.okBox.x + P.okBox.r) / 2, pm = (P.d.x + P.d.r) / 2;
      expect(Math.abs(mid - pm) < 8, k + ': Approve is centred under its preview (' + Math.round(mid - pm) + ' px off)');
    }
    expect(L.panes.video.frameBox && L.panes.video.frameBox.r <= L.panes.video.okBox.x + 1 && Math.abs((L.panes.video.frameBox.y + L.panes.video.frameBox.h / 2) - (L.panes.video.okBox.y + L.panes.video.okBox.h / 2)) < 4, 'the video\'s row reads Tweaks are on Frame, Approve, Ask for a change, left to right');
    expect(!L.panes.graphic.frameBox && !L.panes.caption.frameBox, 'a part with no Frame link keeps Approve centred anyway');
    expect(L.closeDesc === 'closeTip' && /without approving or changing anything/.test(L.closeTip), 'Close card has a description: ' + L.closeTip);
    expect(await inS(t.page, '#closeTip').evaluate(e => getComputedStyle(e).visibility === 'hidden'), 'the tooltip is hidden until hover or focus');
    await inS(t.page, '#closeBtn').hover();
    await sleep(700);
    expect(await inS(t.page, '#closeTip').evaluate(e => getComputedStyle(e).visibility === 'visible' && getComputedStyle(e).opacity === '1'), 'hovering Close card shows the tooltip');
    await t.page.mouse.move(5, 5);
    await inS(t.page, '#closeBtn').focus();
    await t.page.keyboard.press('Shift+Tab'); await t.page.keyboard.press('Tab');
    await sleep(700);
    expect(await inS(t.page, '#closeTip').evaluate(e => getComputedStyle(e).visibility === 'visible'), 'keyboard focus on Close card shows it too');
    await inS(t.page, '#closeBtn').evaluate(e => e.blur());
    // the caption box's scrollbar (global, every review page): the thin rounded themed one, not the system's with arrows
    const sb = await inS(t.page, '.tc-main').first().evaluate(e => ({ sw: getComputedStyle(e).scrollbarWidth, w: getComputedStyle(e, '::-webkit-scrollbar').width, btn: getComputedStyle(e, '::-webkit-scrollbar-button').display, rad: getComputedStyle(e, '::-webkit-scrollbar-thumb').borderRadius }));
    expect(sb.sw === 'auto' && sb.w === '8px' && sb.btn === 'none' && parseFloat(sb.rad) > 20, 'the caption box scrollbar is the thin rounded one with no arrow buttons, and the standard scrollbar-width that would bring the system bar back is not set (' + JSON.stringify(sb) + ')');
    // the list: thumbnails are big, the selected card is a tint and a line, not an edge bracket
    const th = await inS(t.page, '#qlList .chipp .si').first().boundingBox();
    expect(th && th.height >= 70, 'the list thumbnails are bigger than the old 44 px (' + Math.round(th.height) + ' px)');
    const cs = await inS(t.page, '#qlList .chipp.cur').evaluate(e => { const c = getComputedStyle(e); return { bg: c.backgroundColor, sh: c.boxShadow }; });
    expect(cs.bg !== 'rgba(0, 0, 0, 0)' && /0px 0px 0px 1px inset/.test(cs.sh) && !/3px 0px 0px/.test(cs.sh), 'the selected card is a tinted rounded row with a fine line, no left bracket (' + cs.sh + ')');
    await shot(t, 'portrait-1440');

    // ---------- the list: click, keyboard, scroll ----------
    const second = L.rows[1];
    await inS(t.page, '#qlList [data-id="' + second.id + '"]').click();
    await sleep(700);
    L = await look(t.page);
    expect(L.heading.endsWith(second.title) && L.rows.find(r => r.cur).id === second.id, 'a click on a row opens that card and marks it (' + L.heading + ')');
    expect(L.rows.find(r => r.cur).tab === '0' && L.rows.filter(r => r.tab === '0').length === 1, 'only the current row is a tab stop');
    expect(L.panes.video.media.h > 560 && L.panes.video.media.h >= L.panes.video.m.h - 8, 'a two-part card: the video fills its box, bigger than the 527 px it was (' + Math.round(L.panes.video.media.h) + ' px of ' + Math.round(L.panes.video.m.h) + ')');
    await inS(t.page, '#qlList [data-id="' + second.id + '"]').focus();
    await t.page.keyboard.press('ArrowDown');
    await sleep(700);
    L = await look(t.page);
    expect(L.rows.find(r => r.cur).id === L.rows[2].id && L.heading.endsWith(L.rows[2].title), 'Down opens the next card (' + L.heading + ')');
    expect(L.focus === L.rows[2].id, 'and the keyboard stays on that row');
    await t.page.keyboard.press('ArrowUp');
    await t.page.keyboard.press('ArrowUp');
    await sleep(900);
    L = await look(t.page);
    expect(L.rows.find(r => r.cur).id === L.rows[0].id, 'Up twice goes back to the first card');
    await t.page.keyboard.press('ArrowUp');
    await sleep(400);
    L = await look(t.page);
    expect(L.rows.find(r => r.cur).id === L.rows[0].id, 'Up on the first card stays on it');
    await t.page.keyboard.press('End');
    await sleep(700);
    L = await look(t.page);
    expect(L.rows.find(r => r.cur).id === L.rows[L.rows.length - 1].id, 'End opens the last card');
    await t.page.keyboard.press('Home');
    await sleep(700);
    L = await look(t.page);
    expect(L.rows.find(r => r.cur).id === L.rows[0].id, 'Home opens the first card');
    expect(L.rows.every(r => !r.cur || r.id === L.rows[0].id) && L.finishText.indexOf('0 of 3') > 0, 'the first card is on stage again, nothing answered');
    await shot(t, 'list-1440');
    expect(t.errors.length === 0, 'vertical, 1440: no page errors (' + t.errors.join(' | ') + ')');

    // ---------- every save is the old page's ----------
    console.log('--- saves ---');
    let n0 = t.state.upserts.length;
    await inS(t.page, '[data-ok="video"]').click();
    for (let i = 0; i < 80 && !t.state.upserts.slice(n0).some(u => u.video_status === 'Client Approval'); i++) { await answerConfirm(t.page); await sleep(100); }
    expect(t.state.upserts.slice(n0).some(u => u.id === 'rs1' && u.video_status === 'Client Approval'), 'Approve the video saves the video on to the client');
    await sleep(900);
    L = await look(t.page);
    expect(/Approved/.test(L.panes.video.text) && /1 of 3/.test(L.finishText.replace(/\s+/g, ' ')), 'the approved video stays on stage, reads Approved, and Finish counts it (' + L.finishText.replace(/\s+/g, ' ').trim() + ')');
    expect(L.panes.graphic.approve && L.panes.caption.approve && L.heading.indexOf('first second') > 0, 'the other parts still wait and the stage did not move to another part');
    // ask for a change on the thumbnail only: the box opens inside that part
    n0 = t.state.upserts.length;
    await inS(t.page, '[data-chg="graphic"]').click();
    await sleep(400);
    L = await look(t.page);
    const ta = await inS(t.page, '#ta').boundingBox();
    expect(ta && ta.x >= L.panes.graphic.d.x - 4 && ta.x + ta.width <= L.panes.graphic.d.r + 4, 'Ask for a change opens its box inside the thumbnail\'s part');
    await inS(t.page, '#cmpCancel').click();
    await sleep(500);
    expect(t.state.upserts.length === n0, 'Cancel saves nothing');
    await inS(t.page, '[data-chg="graphic"]').click();
    await inS(t.page, '#ta').fill('Make the title bigger, please.');
    await inS(t.page, '#sendBtn').click();
    for (let i = 0; i < 80 && !t.state.upserts.slice(n0).some(u => u.graphic_status === 'Tweaks Needed'); i++) { await answerConfirm(t.page); await sleep(100); }
    const chg = t.state.upserts.slice(n0).find(u => u.graphic_status === 'Tweaks Needed');
    expect(!!chg && /Make the title bigger/.test(String(chg.graphic_tweaks || '')), 'Send saves the change request, with its words, on the thumbnail');
    await sleep(900);
    L = await look(t.page);
    expect(/Change asked/.test(L.panes.graphic.text), 'the thumbnail reads Change asked');
    expect(!L.panes.video.approve && L.panes.video.mediaVisible && L.panes.graphic.approve === false && L.panes.caption.approve, 'the approved video keeps its picture; the thumbnail asked a change, the caption still waits');
    // the caption
    n0 = t.state.upserts.length;
    await inS(t.page, '[data-ok="caption"]').click();
    for (let i = 0; i < 80 && !t.state.upserts.slice(n0).some(u => u.caption_status === 'Client Approval'); i++) { await answerConfirm(t.page); await sleep(100); }
    expect(t.state.upserts.slice(n0).some(u => u.caption_status === 'Client Approval'), 'Approve the caption saves it');
    await sleep(1200);
    L = await look(t.page);
    expect(L.finishDisabled === false && /Finish reviewing/.test(L.finishText), 'every part answered: Finish reviewing lights up on the same row');
    const before = L.heading;
    await inS(t.page, '#finishBtn').click();
    await sleep(1200);
    L = await look(t.page);
    expect(L.heading !== before && L.rows.length === 6, 'Finish reviewing moves on to the next card and the list loses one (' + L.rows.length + ' left)');
    expect(/^6/.test(L.count.trim()), 'the count at the top follows (' + L.count.trim() + ')');
    // Close card
    await inS(t.page, '#closeBtn').click();
    await sleep(1200);
    L = await look(t.page);
    expect(L.rows.length === 5, 'Close card closes the card on stage (' + L.rows.length + ' left)');
    expect(t.errors.length === 0, 'saves: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();

    // ---------- Undo after Approve (owner request 2026-10-20) ----------
    console.log('--- Undo ---');
    t = await openKasper(browser, origin, { layout2: true, width: 1440, height: 900 });
    expect(!(await inS(t.page, '[data-undo]').count()), 'no Undo before anything is approved');
    let u0 = t.state.upserts.length;
    await inS(t.page, '[data-ok="video"]').click();
    for (let i = 0; i < 80 && !t.state.upserts.slice(u0).some(u => u.video_status === 'Client Approval'); i++) { await answerConfirm(t.page); await sleep(100); }
    await inS(t.page, '[data-undo="video"]').waitFor({ timeout: 8000 });
    L = await look(t.page);
    expect(/Approved/.test(L.panes.video.text) && /Undo/.test(L.panes.video.text), 'the approved video reads Approved with an Undo beside it (' + L.panes.video.text + ')');
    expect(await inS(t.page, '[data-undo="video"]').getAttribute('aria-label') === 'Undo approving the video', 'the Undo button is named');
    expect(await t.page.locator('.sv-toast .sv-toast-action').count() === 1, 'the old page\'s toast Undo is up as well: one action, one time window');
    u0 = t.state.upserts.length;
    await inS(t.page, '[data-undo="video"]').click();
    for (let i = 0; i < 80 && !t.state.upserts.slice(u0).some(u => u.id === 'rs1' && u.video_status === 'Kasper Approval'); i++) { await answerConfirm(t.page); await sleep(100); }
    expect(t.state.upserts.slice(u0).some(u => u.id === 'rs1' && u.video_status === 'Kasper Approval'), 'Undo writes the video back to Kasper Approval');
    await sleep(1200);
    L = await look(t.page);
    expect(L.panes.video && L.panes.video.approve && !/Approved/.test(L.panes.video.text) && /^0|0 of 3/.test(L.finishText.replace(/\s+/g, ' ').trim().replace('Finish reviewing ', '')), 'the video is back to waiting for its answer: Approve is there again, Finish counts 0 of 3 (' + L.finishText.replace(/\s+/g, ' ').trim() + ')');
    expect(!(await inS(t.page, '[data-undo]').count()), 'the Undo button is gone after it is used');
    // and with nobody pressing it, it goes when the toast does
    await inS(t.page, '[data-ok="caption"]').click();
    for (let i = 0; i < 80 && !(await inS(t.page, '[data-undo="caption"]').count()); i++) { await answerConfirm(t.page); await sleep(100); }
    expect(await inS(t.page, '[data-undo="caption"]').count() === 1, 'approving the caption shows its own Undo');
    await sleep(7500);
    expect(!(await inS(t.page, '[data-undo]').count()) && await t.page.locator('.sv-toast').count() === 0, 'once the toast is gone the Undo is gone with it');
    expect(t.errors.length === 0, 'undo: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();

    // ---------- With the editors: no scroll jump, the bell ----------
    console.log('--- With the editors ---');
    t = await openKasper(browser, origin, { layout2: true, width: 1440, height: 700, extraCards: 30 });
    await t.page.evaluate(() => {
      ['rs4', 'rs5'].forEach((id, i) => {
        const it = _kasperState.items.find(x => x.post.id === id);
        if (!it) return;
        const d = new Date(); d.setDate(d.getDate() - i); d.setHours(12, 0, 0, 0);
        it.post.video_status = 'Tweaks Needed'; it.post.graphic_status = 'Client Approval'; it.post.caption_status = 'Client Approval';
        it.post.kasper_finished_at = d.toISOString();
        it.post.linear_issue_id = ''; it.post.video_deliverable_id = 'del_' + id;
      });
      window.__pings = [];
      window._kasperSendUrgentSlack = function (e, id) { window.__pings.push(id); };
      _kasperPaintReview();
    });
    await sleep(900);
    expect(!(await inS(t.page, '[data-ping]').count()), 'collapsed: no bell is on screen');
    await inS(t.page, '#qlList').evaluate(e => { e.scrollTop = 9999; });
    await sleep(300);
    const pos = () => t.page.evaluate(() => { const r = document.getElementById('svReviewStage').shadowRoot, l = r.querySelector('#qlList'), g = r.querySelector('#edTog'); return { top: l.scrollTop, tog: g ? Math.round(g.getBoundingClientRect().top) : null, open: g && g.getAttribute('aria-expanded') }; });
    const p0 = await pos();
    expect(p0.top > 100 && p0.tog !== null, 'the list is scrolled down to With the editors (' + p0.top + ')');
    await inS(t.page, '#edTog').click();
    await sleep(500);
    const p1 = await pos();
    expect(p1.open === 'true' && Math.abs(p1.top - p0.top) <= 1 && Math.abs(p1.tog - p0.tog) <= 1, 'expanding With the editors does not move the list (' + p0.top + ' to ' + p1.top + ', toggle ' + p0.tog + ' to ' + p1.tog + ')');
    const bells = await inS(t.page, '[data-ping]').count();
    expect(bells === 2, 'each card with the editors that can be pinged has a bell (' + bells + ')');
    const bb = await inS(t.page, '[data-ping]').first().boundingBox();
    const rowb = await inS(t.page, '.edw .chipp').first().boundingBox();
    expect(bb && bb.width < 40 && bb.x > rowb.x + rowb.width / 2 && /^Ping the editor about/.test(await inS(t.page, '[data-ping]').first().getAttribute('aria-label')), 'the bell is small, at the right of its row, and named');
    const col = await inS(t.page, '[data-ping]').first().evaluate(e => getComputedStyle(e).color);
    const orange = await t.page.evaluate(() => { const r = document.getElementById('svReviewStage').shadowRoot; const i = document.createElement('i'); i.style.color = 'var(--chg-fg)'; r.appendChild(i); const c = getComputedStyle(i).color; i.remove(); return c; });
    expect(col === orange, 'the bell is the page\'s orange (' + col + ')');
    const cur0 = (await look(t.page)).heading;
    await inS(t.page, '[data-ping]').first().click();
    await sleep(500);
    expect(await t.page.evaluate(() => window.__pings.length) === 1, 'pressing it sends the existing urgent ping for that card');
    expect((await look(t.page)).heading === cur0, 'and does not open the card');
    expect(await inS(t.page, '[data-ping].sent').count() === 1 && await inS(t.page, '[data-ping].sent').isDisabled(), 'the bell then reads as sent');
    await inS(t.page, '#edTog').click();
    await sleep(500);
    const p2 = await pos();
    expect(p2.open === 'false' && Math.abs(p2.tog - p0.tog) <= 1, 'collapsing it keeps the toggle where it was too (' + p0.tog + ' to ' + p2.tog + ')');
    expect(t.errors.length === 0, 'editors: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();

    // ---------- a scrolling list ----------
    console.log('--- a short window: the list scrolls by itself ---');
    t = await openKasper(browser, origin, { layout2: true, width: 1440, height: 700, extraCards: 30 });
    L = await look(t.page);
    expect(L.list.oy === 'auto' && L.list.sh > L.list.ch, 'the list has its own scroll when the cards do not fit (' + L.list.sh + ' in ' + L.list.ch + ')');
    const stageBefore = L.card.y;
    await inS(t.page, '#qlList').evaluate(e => { e.scrollTop = 9999; });
    await sleep(200);
    L = await look(t.page);
    expect(L.list.top > 0 && L.card.y === stageBefore && L.pageScroll.w <= L.pageScroll.cw, 'scrolling it moves only the list');
    await inS(t.page, '#qlList [data-id]').last().focus();
    await t.page.keyboard.press('ArrowUp');
    await sleep(700);
    L = await look(t.page);
    const cur = L.rows.find(r => r.cur);
    expect(!!cur && cur.box.y >= L.qlBox.y && cur.box.b <= L.qlBox.b, 'keyboard moves keep the current row in view');
    await t.ctx.close();

    // ---------- a wide video: the video across the top ----------
    console.log('--- flag on, wide video ---');
    t = await openKasper(browser, origin, { layout2: true, width: 1440, height: 900, orient: 'l', thumbs: 'l' });
    L = await look(t.page);
    expect(L.orient === 'land', 'a wide video: the stacked layout');
    expect(L.panes.video.m.w > L.panes.graphic.m.w * 1.8 && L.panes.video.m.b <= L.panes.graphic.m.y + 1, 'the video is across the top, the thumbnail below it');
    expect(L.panes.graphic.m.x < L.panes.caption.m.x && Math.abs(L.panes.graphic.m.y - L.panes.caption.m.y) < 2, 'the thumbnail and the caption sit side by side under the video');
    expect(Object.keys(L.panes).every(k => L.panes[k].approveVisible && L.panes[k].askVisible && L.panes[k].mediaVisible), 'every part still shows with its own buttons');
    expect(L.panes.video.media.w > 480 && L.panes.video.media.h > 335, 'the video is big and bigger than the old 309 px (' + Math.round(L.panes.video.media.w) + ' x ' + Math.round(L.panes.video.media.h) + ')');
    expect(!!L.finish && L.finish.y < L.panes.video.m.y && L.card.r - L.close.r < 40, 'Finish reviewing and Close card are still at the top right');
    await shot(t, 'landscape-1440');
    expect(t.errors.length === 0, 'wide, 1440: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();

    // the video's own shape wins over the thumbnail's; with no player the thumbnail decides
    console.log('--- which shape decides ---');
    t = await openKasper(browser, origin, { layout2: true, width: 1440, height: 900, orient: 'l', thumbs: 'p' });
    await sleep(800);
    L = await look(t.page);
    expect(L.orient === 'land', 'a wide video with a vertical thumbnail: the video decides, wide');
    await t.ctx.close();
    t = await openKasper(browser, origin, { layout2: true, width: 1440, height: 900, orient: 'p', thumbs: 'l' });
    await sleep(800);
    L = await look(t.page);
    expect(L.orient === 'port', 'a vertical video with a wide thumbnail: the video decides, vertical');
    await t.ctx.close();
    t = await openKasper(browser, origin, { layout2: true, width: 1440, height: 900, frame: 'off', thumbs: 'l' });
    await sleep(800);
    L = await look(t.page);
    expect(L.orient === 'land', 'no player: the wide thumbnail decides, wide');
    await t.ctx.close();
    t = await openKasper(browser, origin, { layout2: true, width: 1440, height: 900, frame: 'off', thumbs: 'p' });
    await sleep(800);
    L = await look(t.page);
    expect(L.orient === 'port', 'no player: the vertical thumbnail decides, vertical');
    await t.ctx.close();
    t = await openKasper(browser, origin, { layout2: true, width: 1440, height: 900, youtube: true, thumbs: 'l', orient: 'l' });
    await sleep(800);
    L = await look(t.page);
    expect(L.orient === 'land' && Object.keys(L.panes).length === 4, 'a YouTube card: four parts, the video across the top (' + Object.keys(L.panes).join(',') + ')');
    expect(Object.keys(L.panes).every(k => L.panes[k].mediaVisible), 'every one of its parts shows');
    await t.ctx.close();

    // ---------- 1280, 1920, dark ----------
    for (const [w, h, dark] of [[1366, 768, false], [1920, 1080, false], [1440, 900, true]]) {
      console.log('--- ' + w + ' x ' + h + (dark ? ' dark' : '') + ' ---');
      t = await openKasper(browser, origin, { layout2: true, width: w, height: h, dark });
      L = await look(t.page);
      expect(L.l2 && L.ql && Object.keys(L.panes).every(k => L.panes[k].mediaVisible && L.panes[k].approveVisible), w + (dark ? ' dark' : '') + ': the second layout shows every part');
      expect(Object.keys(L.panes).every(k => L.panes[k].d.r <= L.card.r + 1 && L.panes[k].m.r <= L.card.r + 1) && L.pageScroll.w <= L.pageScroll.cw, w + (dark ? ' dark' : '') + ': nothing runs out of the card, no sideways scroll');
      await shot(t, 'portrait-' + w + (dark ? '-dark' : ''));
      if (w === 1920) {
        await t.ctx.close();
        t = await openKasper(browser, origin, { layout2: true, width: w, height: h, orient: 'l', thumbs: 'l' });
        await shot(t, 'landscape-' + w);
      }
      await t.ctx.close();
    }

    // ---------- the window crosses the limit ----------
    console.log('--- the window is resized across the limit ---');
    t = await openKasper(browser, origin, { layout2: true, width: 1440, height: 900 });
    L = await look(t.page);
    const open1 = L.rows[2];
    await inS(t.page, '#qlList [data-id="' + open1.id + '"]').click();
    await sleep(700);
    await t.page.setViewportSize({ width: 1000, height: 900 });
    await sleep(1500);
    L = await look(t.page);
    expect(!L.l2 && L.strip && L.stepper && L.heading.endsWith(open1.title), 'narrower than 1360: today\'s page, on the same card (' + L.heading + ')');
    await t.page.setViewportSize({ width: 1440, height: 900 });
    await sleep(1500);
    L = await look(t.page);
    expect(L.l2 && L.ql && L.heading.endsWith(open1.title) && L.rows.length === 7, 'wide again: the second layout, same card');
    expect(t.errors.length === 0, 'resize: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();

    // ---------- a part that stops being returned is shown as what the card says it is ----------
    console.log('--- remembered parts that leave the list ---');
    for (const kind of ['removed', 'tweaks']) {
      t = await openKasper(browser, origin, { layout2: true, width: 1440, height: 900 });
      await inS(t.page, '[data-ok="video"]').click();
      for (let i = 0; i < 80 && !t.state.cards.find(c => c.id === 'rs1').video_status.startsWith('Client'); i++) { await answerConfirm(t.page); await sleep(100); }
      await sleep(900);
      L = await look(t.page);
      expect(/Approved/.test(L.panes.video.text) && /1 of 3/.test(L.finishText.replace(/\s+/g, ' ')), kind + ': the approved video is remembered on stage');
      const row = t.state.cards.find(c => c.id === 'rs1');
      if (kind === 'removed') Object.assign(row, { graphic_status: 'Kasper Approval', thumbnail_url: '', graphic_deliverable_id: '', graphic_url: '', updated_at: new Date().toISOString() });
      else Object.assign(row, { graphic_status: 'Tweaks Needed', updated_at: new Date().toISOString() });
      await t.page.evaluate(async () => { await _kasperLoadReview(true); });
      await sleep(1800);
      L = await look(t.page);
      const g = L.panes.graphic;
      const fin = L.finishText.replace(/\s+/g, ' ');
      if (kind === 'removed') {
        expect(!g || !/Approved/.test(g.text), 'removed: the thumbnail is not marked Approved');
        expect(/1 of 2/.test(fin), 'removed: Finish does not count the thumbnail as answered (' + fin.trim() + ')');
      } else {
        expect(!!g && /Change asked/.test(g.text) && !/Approved/.test(g.text), 'tweaks: the thumbnail shows its true state, not Approved (' + (g && g.text) + ')');
      }
      expect(t.errors.length === 0, kind + ': no page errors');
      await t.ctx.close();
    }
  } catch (e) {
    expect(false, 'stopped: ' + String(e && e.stack || e).split('\n').slice(0, 4).join(' | '));
  }
  await browser.close();
  server.close();
  console.log('\nreview-stage-kasper-layout2: ' + checks + ' checks' + (failures.length ? ', ' + failures.length + ' FAILED' : ', all passed'));
  if (failures.length) { failures.forEach(f => console.error(' - ' + f)); process.exit(1); }
})();
