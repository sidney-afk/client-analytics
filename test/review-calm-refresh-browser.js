'use strict';
/*
 * A BACKGROUND REFRESH NEVER DISTURBS THE PAGE (owner request 2026-10-20).
 * Real browser, fully offline, the shared mocked backend of review-stage-browser.js (fictional client, cards, people).
 *
 * Kasper's review list (second layout), the client link's review page, at desktop and phone width:
 *   - a refresh that finds nothing new writes nothing into the page (no new nodes), so no button flickers;
 *   - the list the person scrolled keeps its place, and so does the conversation;
 *   - a refresh that finds a change somewhere else leaves the card on stage, the buttons and the conversation alone;
 *   - the bell on a card with the editors sits beside the title, never over it.
 */
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { STAFF, CLIENT, open, openClient, waitNew, sleep } = require('./fixtures/review-stage-fixture.js');

const failures = [];
let checks = 0;
function expect(value, message) { checks++; if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }

// Counts what a refresh writes inside the review page: nodes added or removed under the stage's regions that hold buttons,
// the card's text and the conversation.
const WATCH = `(() => {
  const r = document.getElementById('svReviewStage').shadowRoot;
  window.__w = { adds: {} };
  const mo = new MutationObserver(ms => ms.forEach(m => {
    if (!m.addedNodes.length && !m.removedNodes.length) return;
    const where = m.target.closest ? m.target.closest('#chat, #l2note, #l2a, .pn-d, #drow, #stepper, #side, #sdate, #skList, #qlList') : null;
    if (!where) return;
    const k = where.id || where.className;
    window.__w.adds[k] = (window.__w.adds[k] || 0) + m.addedNodes.length + m.removedNodes.length;
  }));
  mo.observe(r, { subtree: true, childList: true });
  window.__wm = mo;
})()`;

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    // ---------- Kasper's tab ----------
    console.log('--- Kasper, second layout, 1440 ---');
    {
      const t = await open(browser, origin, { stage: 'kasper', flags: 'on', staff: STAFF, expectNew: true, linkedParts: true, mergeComments: true, extraCards: 14, fast: true, layout2: true, thread: true });
      await t.page.goto(origin + '/index.html#kasper', { waitUntil: 'domcontentloaded' });
      await t.page.waitForFunction(() => typeof navTo === 'function', null, { timeout: 30000 });
      await t.page.evaluate(n => { try { _syncviewStaffIdentityVerified = true; wlMergeClientsFromSheet([n]); } catch (e) {} navTo('kasper'); }, CLIENT);
      await t.page.waitForFunction(() => { const h = document.getElementById('svReviewStage'); const r = h && h.shadowRoot; return !!(r && !h.hidden && r.querySelectorAll('.pn, #stepper > *').length && r.getElementById('qlList')); }, null, { timeout: 30000 });
      await sleep(2500);
      const before = await t.page.evaluate(async () => {
        const r = document.getElementById('svReviewStage').shadowRoot, list = r.getElementById('qlList');
        list.scrollTop = 400; await new Promise(x => setTimeout(x, 200));
        return { top: list.scrollTop, rows: r.querySelectorAll('#qlList [data-id]').length };
      });
      expect(before.top > 100 && before.rows > 10, 'the list scrolls (' + before.top + ' px, ' + before.rows + ' cards)');
      // One refresh first: names that arrive late (the staff list) settle the conversation once, as they do live.
      await t.page.evaluate(async () => { await _kasperLoadReview(true); await new Promise(x => setTimeout(x, 900)); });
      await t.page.evaluate(WATCH);
      await t.page.evaluate(async () => { await _kasperLoadReview(true); await new Promise(x => setTimeout(x, 900)); });
      const after = await t.page.evaluate(() => ({ top: document.getElementById('svReviewStage').shadowRoot.getElementById('qlList').scrollTop, w: window.__w.adds }));
      expect(after.top === before.top, 'a refresh keeps the scrolled list where it was (' + before.top + ' -> ' + after.top + ')');
      expect(Object.keys(after.w).length === 0, 'a refresh with nothing new writes no nodes into the page (' + JSON.stringify(after.w) + ')');
      // A card another person finished leaves the list: nothing is added, but the list must still stay where it was.
      const gone = t.state.cards.find(c => c.id === 'rx3');
      Object.assign(gone, { video_status: 'Client Approval', graphic_status: 'Client Approval', caption_status: 'Client Approval', status: 'Client Approval', updated_at: new Date().toISOString() });
      await t.page.evaluate(async () => { await _kasperLoadReview(true); await new Promise(x => setTimeout(x, 900)); });
      const gone2 = await t.page.evaluate(() => { const r = document.getElementById('svReviewStage').shadowRoot; return { top: r.getElementById('qlList').scrollTop, rows: r.querySelectorAll('#qlList [data-id]').length }; });
      expect(gone2.rows === before.rows - 1 && gone2.top === before.top, 'a card removed by a refresh: the list keeps its place (' + before.rows + ' -> ' + gone2.rows + ' cards, ' + before.top + ' -> ' + gone2.top + ' px)');
      // The bell sits beside the title: the title's right edge ends before the bell's left edge.
      expect(t.errors.length === 0, 'no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }

    // ---------- the client link ----------
    for (const width of [1440, 390]) {
      console.log('--- client review, ' + width + ' ---');
      const t = await openClient(browser, origin, { flags: 'on', extraCards: 14, thread: true, width, height: 900 });
      await waitNew(t);
      await sleep(2500);
      const before = await t.page.evaluate(async () => {
        const r = document.getElementById('svReviewStage').shadowRoot, sl = r.getElementById('skList'), ts = r.getElementById('tscroll');
        sl.scrollLeft = 300; if (ts) ts.scrollTop = 0; await new Promise(x => setTimeout(x, 200));
        return { l: sl.scrollLeft, chat: ts ? ts.scrollTop : 0 };
      });
      expect(before.l > 100, width + ': the strip scrolls (' + before.l + ' px)');
      await t.page.evaluate(WATCH);
      await t.page.evaluate(async () => { await loadCalendarPosts({ background: true, forceMeta: true, quiet: true }); await new Promise(x => setTimeout(x, 1000)); });
      let after = await t.page.evaluate(() => { const r = document.getElementById('svReviewStage').shadowRoot, ts = r.getElementById('tscroll'); return { l: r.getElementById('skList').scrollLeft, chat: ts ? ts.scrollTop : 0, w: window.__w.adds }; });
      expect(after.l === before.l && after.chat === before.chat, width + ': nothing new: the strip and the conversation keep their place');
      expect(Object.keys(after.w).length === 0, width + ': nothing new: no nodes written into the page (' + JSON.stringify(after.w) + ')');
      // Someone changes another post: the strip may change, but the card on stage, its buttons and the conversation stay.
      t.state.cards[t.state.cards.length - 1].name = 'Renamed by someone';
      t.state.cards[t.state.cards.length - 1].updated_at = new Date().toISOString();
      await t.page.evaluate(() => { window.__w.adds = {}; });
      await t.page.evaluate(async () => { await loadCalendarPosts({ background: true, forceMeta: true, quiet: true }); await new Promise(x => setTimeout(x, 1000)); });
      after = await t.page.evaluate(() => { const r = document.getElementById('svReviewStage').shadowRoot, ts = r.getElementById('tscroll'); return { l: r.getElementById('skList').scrollLeft, chat: ts ? ts.scrollTop : 0, w: window.__w.adds }; });
      expect(after.l === before.l && after.chat === before.chat, width + ': a change elsewhere: the strip and the conversation keep their place');
      const touched = Object.keys(after.w).filter(k => k !== 'skList');
      expect(touched.length === 0, width + ': a change elsewhere: the card on stage, its buttons and the conversation are not redrawn (' + JSON.stringify(after.w) + ')');
      expect((after.w.skList || 0) > 0 && after.w.skList <= 4, width + ': a change elsewhere: only the changed card in the strip is replaced (' + (after.w.skList || 0) + ' nodes)');
      expect(t.errors.length === 0, width + ': no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }

    // ---------- the bell beside the title ----------
    console.log('--- the editor bell on a card with the editors ---');
    {
      const t = await open(browser, origin, { stage: 'kasper', flags: 'on', staff: STAFF, expectNew: true, linkedParts: true, mergeComments: true, extraCards: 30, fast: true, layout2: true, width: 1440, height: 700 });
      await t.page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
      await t.page.waitForFunction(() => typeof navTo === 'function', null, { timeout: 30000 });
      await t.page.evaluate(n => { try { _syncviewStaffIdentityVerified = true; wlMergeClientsFromSheet([n]); } catch (e) {} navTo('kasper'); }, CLIENT);
      await t.page.waitForFunction(() => { const h = document.getElementById('svReviewStage'); const r = h && h.shadowRoot; return !!(r && !h.hidden && r.getElementById('qlList')); }, null, { timeout: 30000 });
      await sleep(1500);
      await t.page.evaluate(() => {
        ['rs4', 'rs5'].forEach((id, i) => {
          const it = _kasperState.items.find(x => x.post.id === id);
          if (!it) return;
          const d = new Date(); d.setDate(d.getDate() - i); d.setHours(12, 0, 0, 0);
          it.post.video_status = 'Tweaks Needed'; it.post.graphic_status = 'Client Approval'; it.post.caption_status = 'Client Approval';
          it.post.kasper_finished_at = d.toISOString();
          it.post.linear_issue_id = ''; it.post.video_deliverable_id = 'del_' + id;
        });
        _kasperPaintReview();
      });
      await sleep(900);
      await t.page.evaluate(() => { const r = document.getElementById('svReviewStage').shadowRoot; r.getElementById('edTog').click(); });
      await sleep(500);
      const g = await t.page.evaluate(() => {
        const r = document.getElementById('svReviewStage').shadowRoot;
        return Array.from(r.querySelectorAll('.edw')).map(w => ({ pad: parseFloat(getComputedStyle(w.querySelector('.chipp')).paddingRight), cxRight: w.querySelector('.cx').getBoundingClientRect().right, bellLeft: w.querySelector('.edping').getBoundingClientRect().left }));
      });
      expect(g.length === 2, 'two cards with the editors, each with a bell (' + g.length + ')');
      g.forEach((x, i) => expect(x.cxRight <= x.bellLeft, 'row ' + (i + 1) + ': the title block ends before the bell (' + Math.round(x.cxRight) + ' <= ' + Math.round(x.bellLeft) + ', padding ' + x.pad + ')'));
      expect(t.errors.length === 0, 'no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log('\nreview-calm-refresh: ' + checks + ' checks, ' + failures.length + ' failed');
  process.exit(failures.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
