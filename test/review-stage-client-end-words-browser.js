'use strict';
/*
 * THE CLIENT LINK'S END STATE AND A HELD ANSWER, IN PLAIN WORDS (session Nightclient, 2026-10-30, OPEN_REPAIRS 613).
 * Real browser, fully offline, the same mocked backend as review-stage-browser.js (fictional client, cards and token).
 * Found walking the client's journey to its end at 1440 and 390 wide:
 *   - after the last post was reviewed, a divider line stood alone at the start of the strip, before the reviewed
 *     post, separating it from nothing; it now stands only between waiting posts and reviewed ones;
 *   - an approval held while the client's own connection was down read "Still waiting for the server", while the
 *     toast at the bottom said "waiting for your connection to come back"; the line under the buttons now names the
 *     client's connection too when the browser is offline (online and slow, it still names the server);
 *   - the client's own caption edit, quoted in the conversation, lost its line breaks ("...caption With a second line")
 *     while the stage showed two lines; the quote and the old caption under it now keep them.
 * Run with review_client_polish on, as it is live for every client.
 */
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const F = require('./fixtures/review-stage-fixture.js');

const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }
const sleep = F.sleep;
function stateWith(waitingCaption) {
  const cards = F.cards('client');
  for (const c of cards) c.status = c.video_status = c.graphic_status = c.caption_status = 'Approved';
  if (waitingCaption) { cards[0].caption_status = 'Client Approval'; cards[0].status = 'Client Approval'; }
  return { cards, upserts: [], gateway: [], flagReads: 0, orient: 'p', writeDelay: 0, writeFail: 0, native: {}, receipts: {}, writeAttempts: 0 };
}
const strip = page => page.evaluate(() => {
  const r = document.getElementById('svReviewStage').shadowRoot;
  const sl = r.getElementById('skList');
  const kids = Array.from(sl.children).filter(e => e.getClientRects().length);
  return { head: r.getElementById('skHead').textContent, first: kids.length ? kids[0].className : '', seps: sl.querySelectorAll('.sk-sep').length, done: sl.querySelectorAll('.chipp.done').length };
});

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      const opt = { flags: 'on', polish: true, width: w, height: h, tab: 'review', help: 'https://help.fixture.test/review' };
      // The last waiting part answered, then Finish reviewing.
      {
        const t = await F.openClient(browser, origin, Object.assign({ state: stateWith(true) }, opt));
        await F.waitNew(t); await sleep(1200);
        await F.inS(t.page, '[data-ok="caption"]').first().click();
        await sleep(1500);
        await F.inS(t.page, '#finishBtn').click();
        await sleep(1500);
        const S = await strip(t.page);
        expect(S.done === 1 && /change your mind/i.test(S.head), w + ' all done: the reviewed post is in the strip and the heading says the client can still change their mind (' + S.head + ')');
        expect(S.seps === 0 && !/sk-sep/.test(S.first), w + ' all done: no divider line with nothing before it (' + S.seps + ' dividers, first: ' + S.first + ')');
        await t.ctx.close();
      }
      // The client's own caption edit, quoted in the conversation with its line breaks.
      {
        const st = stateWith(true);
        const at = '2026-10-17T22:00:00.000Z';
        st.cards[0].caption = 'First line of the new caption\nSecond line';
        st.cards[0].caption_tweaks = JSON.stringify([{ id: 'e1', parent_id: null, author: F.CLIENT, role: 'client', is_tweak: false, audience: 'client',
          body: 'Changed the caption to:\n\nFirst line of the new caption\nSecond line\n\nIt was:\n\nOld first line\nOld second line', created_at: at, updated_at: at, done: false, done_at: '', done_by: '' }]);
        const t = await F.openClient(browser, origin, Object.assign({ state: st }, opt));
        await F.waitNew(t); await sleep(1200);
        await F.inS(t.page, '.stp[data-step="caption"]').first().click(); await sleep(600);
        await t.page.evaluate(() => { const d = document.getElementById('svReviewStage').shadowRoot.querySelector('details.was'); if (d) d.open = true; });
        await sleep(300);
        const q = await t.page.evaluate(() => {
          const r = document.getElementById('svReviewStage').shadowRoot;
          const lines = el => { if (!el) return 0; const lh = parseFloat(getComputedStyle(el).lineHeight) || 18; const rng = document.createRange(); rng.selectNodeContents(el); return new Set(Array.from(rng.getClientRects()).map(x => Math.round(x.top))).size; };
          const nw = r.querySelector('.diff .new'), old = r.querySelector('.diff .old');
          return { found: !!nw, ws: nw ? getComputedStyle(nw).whiteSpace : '', newLines: lines(nw), oldWs: old ? getComputedStyle(old).whiteSpace : '', oldLines: lines(old) };
        });
        expect(q.found && /pre/.test(q.ws) && q.newLines >= 2, w + ' caption edit: the quoted new caption keeps its line break (' + JSON.stringify(q) + ')');
        expect(/pre/.test(q.oldWs) && q.oldLines >= 2, w + ' caption edit: the old caption under it keeps its line break (' + JSON.stringify(q) + ')');
        await t.ctx.close();
      }
      // An approval held while the browser is offline.
      {
        const t = await F.openClient(browser, origin, Object.assign({ nativeReceipts: true }, opt));
        await F.waitNew(t); await sleep(1200);
        let off = true;
        await t.page.route('**/*', r => (off && r.request().method() !== 'GET') ? r.abort('internetdisconnected') : r.fallback());
        await t.ctx.setOffline(true);
        await F.inS(t.page, '.stp[data-step="caption"]').first().click(); await sleep(400);
        await F.inS(t.page, '[data-ok="caption"]').first().click();
        await t.page.waitForFunction(() => !!document.getElementById('svReviewStage').shadowRoot.querySelector('[data-slow]'), null, { timeout: 30000 }).catch(() => {});
        const line = await t.page.evaluate(() => (document.getElementById('svReviewStage').shadowRoot.querySelector('[data-slow]') || {}).textContent || '');
        expect(/your connection/i.test(line) && !/server/i.test(line) && /Nothing is lost/.test(line), w + ' offline: the held approval names the client\'s connection, not the server (' + line + ')');
        off = false; await t.ctx.setOffline(false);
        const landed = () => (t.state.cards.find(c => c.id === 'rs1') || {}).caption_status === 'Approved';
        for (let i = 0; i < 200 && !landed(); i++) await sleep(100);
        expect(landed(), w + ' offline: the approval still lands once the connection is back');
        await t.ctx.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\nreview-stage-client-end-words-browser: ' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nreview-stage-client-end-words-browser: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
