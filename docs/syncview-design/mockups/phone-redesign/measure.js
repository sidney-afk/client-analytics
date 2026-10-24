'use strict';
/* Measures today's phone screens on the real offline page (session Palm, 2026-10-23), at 390 x 844, light, for the
   "what is wrong today" lists. Prints JSON. Same harness and fictional data as make-screenshots.js. */
const { staffEnv, clientPage, sleep } = require('./harness');

const MEASURE = (sel) => {
  const root = sel ? document.querySelector(sel) : document;
  const vis = e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const all = [...(root.shadowRoot || root).querySelectorAll('*')].filter(vis);
  const taps = all.filter(e => e.matches('button,a,[role=button],input,textarea,summary'));
  const small = taps.filter(e => { const r = e.getBoundingClientRect(); return r.height < 44 || r.width < 44; });
  const boxed = all.filter(e => { const cs = getComputedStyle(e); return parseFloat(cs.borderTopWidth) > 0 && parseFloat(cs.borderLeftWidth) > 0 && cs.borderTopStyle !== 'none'; });
  const round = all.filter(e => { const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); const rad = parseFloat(cs.borderTopLeftRadius); return rad >= 12 || (rad >= r.height / 2 - 1 && r.height > 14 && rad > 6); });
  const words = (root.shadowRoot ? root.shadowRoot.querySelector('.app') : (root.body || root)).innerText.split(/\s+/).filter(Boolean).length;
  const caps = all.filter(e => getComputedStyle(e).textTransform === 'uppercase' && e.childElementCount === 0 && e.textContent.trim()).length;
  return { tapTargets: taps.length, under44: small.length, boxed: boxed.length, roundOrPill: round.length, wordsOnScreen: words, capsLabels: caps };
};
(async () => {
  const out = {};
  const S = await staffEnv({ context: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } });
  try {
    const page = await S.newPage();
    await S.openCalendar(page); await sleep(2500);
    await page.evaluate(() => onCalViewChange('organizer')); await sleep(1200);
    out.sheet = await page.evaluate(MEASURE, null);
    out.sheet.firstPostTop = await page.evaluate(() => Math.round(document.querySelector('.thumb-tile').getBoundingClientRect().top));
    out.sheet.postsFullyVisible = await page.evaluate(() => [...document.querySelectorAll('.thumb-tile')].filter(t => { const r = t.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight - 100; }).length);
    out.sheet.notesSignalOnTiles = await page.evaluate(() => document.querySelectorAll('.thumb-tile .cal-comments-btn, .thumb-tile [data-comments-btn]').length);
    await page.click('[data-thumb-display=list]'); await sleep(900);
    out.sheetList = { cardHeight: await page.evaluate(() => Math.round(document.querySelector('#calStrip .cal-card').getBoundingClientRect().height)) };
    await page.click('[data-thumb-display=grid]'); await sleep(600);
    await page.click('[data-thumb-card=p_morning]'); await sleep(1200);
    out.detail = await page.evaluate(MEASURE, null);
    out.detail.notesButtonTop = await page.evaluate(() => { const b = [...document.querySelectorAll('button,[data-comments-btn]')].find(x => /Notes/.test(x.textContent)); return b ? Math.round(b.getBoundingClientRect().top + document.querySelector('.cal-body').scrollTop) : null; });
    await page.evaluate(() => history.back()); await sleep(900);
    await page.evaluate(() => openCalComments('p_morning')); await sleep(1300);
    out.notes = await page.evaluate(MEASURE, '#calCommentsOverlay');
    out.notes.actionBoxes = await page.evaluate(() => [...document.querySelectorAll('#calCommentsOverlay *')].filter(e => /Reply/.test(e.textContent) && /Delete/.test(e.textContent) && e.children.length <= 4 && parseFloat(getComputedStyle(e).borderTopWidth) > 0).length);
    out.notes.deleteButtons = await page.evaluate(() => [...document.querySelectorAll('#calCommentsOverlay button')].filter(b => /Delete/.test(b.textContent)).length);
    out.notes.composerHeight = await page.evaluate(() => { const ta = document.querySelector('#calCommentsOverlay textarea'); let e = ta; while (e && e.parentElement && e.parentElement.getBoundingClientRect().height < innerHeight * 0.5) e = e.parentElement; return e ? Math.round(e.getBoundingClientRect().height) : null; });
    await page.keyboard.press('Escape'); await sleep(500);
    await page.evaluate(() => _msgOpenPage()); await sleep(1500);
    out.inbox = await page.evaluate(MEASURE, '#msgPage');
    await page.click('#msgPage [data-msg-conv="p_morning"]'); await sleep(1300);
    out.chat = await page.evaluate(MEASURE, '#msgPage');
    out.chat.messagesVisible = await page.evaluate(() => [...document.querySelectorAll('#msgPage [data-msg-id], #msgPage .msg-bubble, #msgPage .msg-row')].filter(e => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }).length);
    out.chat.firstMessageTop = await page.evaluate(() => { const s = [...document.querySelectorAll('#msgPage *')].find(e => e.scrollHeight > e.clientHeight + 20 && /auto|scroll/.test(getComputedStyle(e).overflowY)); return s ? Math.round(s.getBoundingClientRect().top) : null; });
    await page.close();
    const { ctx, page: cp } = await clientPage(S.browser, S.origin, { width: 390, height: 844, theme: 'light' });
    await sleep(5000);
    out.review = await cp.evaluate(MEASURE, '#svReviewStage');
    out.review.approveTop = await cp.evaluate(() => Math.round(document.getElementById('svReviewStage').shadowRoot.querySelector('.b-ok').getBoundingClientRect().top));
    out.review.contentTop = await cp.evaluate(() => Math.round(document.getElementById('svReviewStage').shadowRoot.getElementById('view').getBoundingClientRect().top));
    out.review.nestedContainers = await cp.evaluate(() => { const r = document.getElementById('svReviewStage').shadowRoot; let n = 0; let e = r.getElementById('tcard'); while (e && e.id !== 'rsApp') { const cs = getComputedStyle(e); if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.boxShadow !== 'none' || parseFloat(cs.borderTopWidth) > 0) n++; e = e.parentElement; } return n; });
    await ctx.close();
  } finally { await S.close(); }
  console.log(JSON.stringify(out, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
