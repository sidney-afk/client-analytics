'use strict';
/*
 * SIX CLIENT LINK CHANGES THE OWNER SAID YES TO ON 2026-10-31 (session Linkpolish, OPEN_REPAIRS 617; found by session
 * Nightclient on 30 Oct as Q6 to Q11). Real browser, fully offline, the review page's own fixture (fictional client,
 * cards and token), with review_client_polish on as it is live for every client. Each part fails on main:
 *   enter    (Q6)  on a touch screen the message box's Enter key makes a new line and does not send, and no "Enter
 *                  sends" hint is drawn; with a mouse (1440) Enter still sends, and the hint is still there;
 *   colour   (Q7)  "Ready for your review" on the client's Sheet (a part's pill and the YouTube title's) is violet, not
 *                  red, with text contrast of at least 4.5:1, light and dark; a staff page keeps red;
 *   empty    (Q8)  with nothing waiting and nothing reviewed the heading is "Nothing else waiting" alone, without
 *                  "You can still change your mind" (the loading screen for that page is checked in
 *                  client-link-dark-first-paint-browser.js);
 *   notyet   (Q9)  on a phone Month and Week fold the undated posts behind one "Not scheduled yet (N)" row that opens
 *                  them (and closes them); at 1440 the list shows under its heading as before;
 *   words    (Q10) a refused save never says "account manager", only "your team";
 *   poster   (Q11) the help video's poster has nothing cut off at its edges and nothing where the player's play button
 *                  sits (the old one cut a chip off at its top edge).
 * Run one part: node test/review-stage-client-linkpolish-browser.js --only=enter
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const F = require('./fixtures/review-stage-fixture.js');

const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7);
const run = k => !ONLY || ONLY.split(',').includes(k);
const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }
const sleep = F.sleep;
const HELP = 'https://help.fixture.test/review';
const ROOT = path.join(__dirname, '..');

function baseState(mut) {
  const cards = F.cards('client');
  if (mut) mut(cards);
  return { cards, upserts: [], gateway: [], flagReads: 0, orient: 'p', writeDelay: 0, writeFail: 0, native: {}, receipts: {}, writeAttempts: 0 };
}
const phoneCtx = dark => ({ hasTouch: true, isMobile: true, colorScheme: dark ? 'dark' : 'light' });
const deskCtx = dark => ({ colorScheme: dark ? 'dark' : 'light' });
const sr = (page, fn, arg) => page.evaluate(([f, a]) => (new Function('r', 'a', 'return (' + f + ')(r, a)'))(document.getElementById('svReviewStage').shadowRoot, a), [fn.toString(), arg]);

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    /* Q6: Enter on a touch screen. */
    if (run('enter')) {
      for (const [w, h, touch] of [[390, 844, true], [1440, 900, false]]) {
        const label = 'enter ' + w + (touch ? ' touch' : ' mouse');
        const t = await F.openClient(browser, origin, { flags: 'on', polish: true, width: w, height: h, tab: 'review', help: HELP, context: touch ? phoneCtx(false) : deskCtx(false) });
        await F.waitNew(t); await sleep(1200);
        // A change on the part on stage: its box carries the "Enter sends" hint on a desktop.
        await F.inS(t.page, '[data-chg="video"]').first().click(); await sleep(500);
        const ta = F.inS(t.page, '#ta');
        await ta.click(); await t.page.keyboard.type('First line');
        await t.page.keyboard.press('Enter');
        await t.page.keyboard.type('Second line');
        await sleep(300);
        const S = await sr(t.page, r => ({ v: (r.getElementById('ta') || {}).value || '', hint: Array.from(r.querySelectorAll('.cmp-foot .esc')).map(e => e.textContent).join('|'), send: !!r.getElementById('sendBtn') }));
        if (touch) {
          expect(S.v === 'First line\nSecond line', label + ': Enter made a new line and sent nothing (' + JSON.stringify(S.v) + ')');
          expect(!/Enter sends/.test(S.hint), label + ': no "Enter sends" hint (' + JSON.stringify(S.hint) + ')');
          expect(S.send, label + ': the Send button is there to send it');
        } else {
          expect(S.v === 'Second line', label + ': Enter still sends (the box kept only what was typed after it: ' + JSON.stringify(S.v) + ')');
          expect(/Enter sends/.test(S.hint), label + ': the "Enter sends" hint is still there (' + JSON.stringify(S.hint) + ')');
        }
        await t.ctx.close();
      }
      // The comment box beside the post (no part picked) on a touch screen.
      {
        const t = await F.openClient(browser, origin, { flags: 'on', polish: true, width: 390, height: 844, tab: 'review', help: HELP, context: phoneCtx(false) });
        await F.waitNew(t); await sleep(1200);
        const ta = F.inS(t.page, '#ta');
        await ta.scrollIntoViewIfNeeded(); await ta.click(); await t.page.keyboard.type('Hello');
        await t.page.keyboard.press('Enter'); await t.page.keyboard.type('team'); await sleep(300);
        const v = await sr(t.page, r => (r.getElementById('ta') || {}).value || '');
        expect(v === 'Hello\nteam', 'enter 390 touch, comment box: Enter made a new line (' + JSON.stringify(v) + ')');
        await t.ctx.close();
      }
    }

    /* Q7: "Ready for your review" is violet on the client's Sheet, light and dark; red stays for staff. */
    if (run('colour')) {
      for (const dark of [false, true]) {
        const st = baseState(cards => {
          cards[0].platforms = 'youtube'; cards[0].title_status = 'Client Approval'; cards[0].title_tweaks = '[]';
          cards.push({ id: 'p_cal_settings', client: F.SLUG, caption: JSON.stringify({ collab_mode: true }) });
        });
        const t = await F.openClient(browser, origin, { state: st, flags: 'on', polish: true, width: 1440, height: 900, tab: 'review', help: HELP, dark, context: deskCtx(dark) });
        await F.waitNew(t); await sleep(1000);
        await t.page.evaluate(() => onCalViewChange('organizer'));
        await t.page.waitForSelector('.cal-review-sub-pill.cal-fld-status-client-approval', { timeout: 15000 }).catch(() => {});
        const C = await t.page.evaluate(() => {
          const lum = c => { const m = String(c).match(/[\d.]+/g).map(Number); const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
          const ratio = (a, b) => { const x = lum(a), y = lum(b); return Math.round((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) * 100) / 100; };
          const pills = Array.from(document.querySelectorAll('.cal-review-sub-pill.cal-fld-status-client-approval')).filter(e => e.getClientRects().length);
          const out = pills.map(e => { const s = getComputedStyle(e); return { comp: e.dataset.compPill || '', text: e.textContent, bg: s.backgroundColor, fg: s.color, cr: ratio(s.backgroundColor, s.color) }; });
          const de = document.documentElement;
          const staff = (() => { de.classList.remove('boot-client'); const v = getComputedStyle(de).getPropertyValue('--cal-status-client-approval-bg').trim(); de.classList.add('boot-client'); return v; })();
          return { out, staff, theme: de.getAttribute('data-theme') || 'light' };
        });
        const label = 'colour ' + (dark ? 'dark' : 'light');
        const title = C.out.find(p => /title/i.test(p.text));
        expect(C.out.length >= 2 && !!title, label + ': the Sheet shows "Ready for your review" pills, the YouTube title\'s among them (' + C.out.map(p => p.text).join(', ') + ')');
        const reddish = c => { const [r, g, b] = String(c).match(/\d+/g).map(Number); return r > 200 && g < 140 && b < 140; };
        expect(C.out.length && C.out.every(p => p.bg === 'rgb(167, 139, 250)' && !reddish(p.bg)), label + ': every one is violet, not red (' + C.out.map(p => p.bg).join(', ') + ')');
        expect(C.out.length && C.out.every(p => p.cr >= 4.5), label + ': text contrast at least 4.5:1 (' + C.out.map(p => p.cr).join(', ') + ')');
        expect(/^#ff6b6b$/i.test(C.staff), label + ': without the client link\'s lock the colour is the staff\'s red, untouched (' + C.staff + ')');
        await t.ctx.close();
      }
    }

    /* Q8: nothing waiting and nothing reviewed. */
    if (run('empty')) {
      for (const [w, h] of [[1440, 900], [390, 844]]) {
        const st = baseState(cards => { for (const c of cards) c.status = c.video_status = c.graphic_status = c.caption_status = 'Approved'; });
        const t = await F.openClient(browser, origin, { state: st, flags: 'on', polish: true, width: w, height: h, tab: 'review', help: HELP });
        await t.page.waitForFunction(() => { const x = document.getElementById('svReviewStage'); return !!(x && x.shadowRoot && x.shadowRoot.querySelector('.rc-card')); }, null, { timeout: 30000 });
        await sleep(800);
        const head = await sr(t.page, r => r.getElementById('skHead').textContent.replace(/\s+/g, ' ').trim());
        expect(/Nothing else waiting/.test(head) && !/change your mind/i.test(head), 'empty ' + w + ': the heading is "Nothing else waiting" alone (' + head + ')');
        await t.ctx.close();
      }
    }

    /* Q9: the undated posts fold behind one row on a phone. */
    if (run('notyet')) {
      const undated = n => baseState(cards => { for (let i = 0; i < n; i++) cards.push({ id: 'ru' + i, client: F.SLUG, name: 'Undated idea ' + (i + 1), status: 'Approved', order_index: 60 + i, updated_at: '2026-10-10T12:00:00.000Z', scheduled_date: '', video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Approved', asset_url: F.FRAME, thumbnail_url: '', caption: 'No date yet.', video_tweaks: '[]', graphic_tweaks: '[]', caption_tweaks: '[]', comments: [], graphic_comments: [], caption_comments: [] }); });
      for (const [w, h] of [[390, 844], [320, 700], [1440, 900]]) {
        for (const dark of [false, true]) {
          const t = await F.openClient(browser, origin, { state: undated(14), flags: 'on', polish: true, width: w, height: h, tab: 'review', help: HELP, dark, context: w < 800 ? phoneCtx(dark) : deskCtx(dark) });
          await F.waitNew(t); await sleep(1000);
          for (const v of ['month', 'week']) {
            const label = 'notyet ' + v + ' ' + w + (dark ? ' dark' : ' light');
            await t.page.evaluate(x => onCalViewChange(x), v);
            await t.page.waitForSelector('.cal-notyet', { timeout: 15000 }).catch(() => {});
            await sleep(400);
            const M = () => t.page.evaluate(() => {
              const vis = e => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
              const sec = document.querySelector('.cal-notyet'), tog = document.querySelector('.cal-notyet-tog'), h = document.querySelector('.cal-notyet-h');
              const pills = sec ? Array.from(sec.querySelectorAll('.cal-month-pill')).filter(vis).length : -1;
              const grid = document.querySelector('.cal-month-grid, .cal-week-viewport');
              return { row: vis(tog) ? tog.textContent.replace(/\s+/g, ' ').trim() : '', exp: tog ? tog.getAttribute('aria-expanded') : null, head: vis(h), pills,
                rowH: vis(tog) ? Math.round(tog.getBoundingClientRect().height) : 0, secBottom: sec ? Math.round(sec.getBoundingClientRect().bottom) : 0, gridTop: grid ? Math.round(grid.getBoundingClientRect().top) : 0,
                sideways: document.scrollingElement.scrollWidth > window.innerWidth + 1 };
            });
            const A = await M();
            if (w < 800) {
              expect(/^Not scheduled yet 14$/.test(A.row) && !A.head && A.pills === 0 && A.exp === 'false', label + ': one closed "Not scheduled yet (14)" row, no tiles above the calendar (' + JSON.stringify(A) + ')');
              expect(A.rowH >= 44 && A.gridTop - A.secBottom < 40, label + ': the row is a 44 px target and the calendar follows it straight away (' + A.rowH + ' px, gap ' + (A.gridTop - A.secBottom) + ')');
              if (!A.row) continue;   // main: no row to press (the failures above say so)
              await t.page.locator('.cal-notyet-tog').click(); await sleep(350);
              const B = await M();
              expect(B.pills === 14 && B.exp === 'true' && !B.sideways, label + ': the row opens all 14, with no sideways scroll (' + JSON.stringify(B) + ')');
              await t.page.locator('.cal-notyet-tog').click(); await sleep(350);
              const C = await M();
              expect(C.pills === 0 && C.exp === 'false', label + ': and closes them again (' + C.pills + ')');
            } else {
              expect(!A.row && A.head && A.pills === 14, label + ': at 1440 the list shows under its heading, as before (' + JSON.stringify(A) + ')');
            }
          }
          await t.ctx.close();
        }
      }
    }

    /* Q10: "your team", never "account manager". */
    if (run('words')) {
      const t = await F.openClient(browser, origin, { flags: 'on', polish: true, width: 1440, height: 900, tab: 'review', help: HELP });
      await F.waitNew(t); await sleep(600);
      const W = await t.page.evaluate(async () => {
        const said = [_calCrqClientWords('native_link_required (code: native_link_required)').text];
        const srcs = Array.from(document.scripts).map(s => s.src).filter(Boolean).filter(u => /\/js\/sv-/.test(u));
        let am = 0;
        for (const u of srcs) { const txt = await (await fetch(u)).text(); am += (txt.match(/account manager/gi) || []).length; }
        am += (document.documentElement.innerHTML.match(/account manager/gi) || []).length;
        return { said, am, n: srcs.length };
      });
      expect(/your team/.test(W.said[0]) && !/account manager/i.test(W.said[0]), 'words: a refused approval says "your team" (' + W.said[0] + ')');
      expect(W.am === 0, 'words: no "account manager" anywhere in the page\'s code (' + W.am + ' found in the page and ' + W.n + ' bundles)');
      await t.ctx.close();
    }

    /* Q11: the help video's poster. */
    if (run('poster')) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await page.route(/wistia|fonts\.g/, r => r.abort());
      await page.goto(origin + '/start/index.html#review', { waitUntil: 'load' });
      const src = await page.evaluate(() => (document.querySelector('#panel-review video') || {}).getAttribute('poster'));
      expect(!!src && fs.existsSync(path.join(ROOT, src)), 'poster: the review video names a poster that exists (' + src + ')');
      const P = await page.evaluate(async u => {
        const blob = new Blob([await (await fetch(u)).arrayBuffer()], { type: 'image/webp' });
        const bmp = await createImageBitmap(blob);
        const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
        const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0);
        const W = c.width, H = c.height, d = g.getImageData(0, 0, W, H).data;
        const L = (x, y) => { const i = (y * W + x) * 4; return 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; };
        // The largest step between two neighbouring pixels in a box: a soft gradient stays small, any edge of a chip,
        // a word or a button is a big one.
        const step = (x0, y0, x1, y1) => { let m = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { if (x + 1 < x1) m = Math.max(m, Math.abs(L(x + 1, y) - L(x, y))); if (y + 1 < y1) m = Math.max(m, Math.abs(L(x, y + 1) - L(x, y))); } return Math.round(m); };
        const e = 12;
        return { W, H, top: step(0, 0, W, e), bottom: step(0, H - e, W, H), left: step(0, 0, e, H), right: step(W - e, 0, W, H),
          // Where the page's play button sits: the middle 30% of the height and 20% of the width (its phone size).
          play: step(Math.round(W * 0.4), Math.round(H * 0.35), Math.round(W * 0.6), Math.round(H * 0.65)) };
      }, origin + src);
      expect(P.top < 12 && P.bottom < 12 && P.left < 12 && P.right < 12, 'poster: nothing cut off at any edge (largest step top ' + P.top + ', bottom ' + P.bottom + ', left ' + P.left + ', right ' + P.right + ')');
      expect(P.play < 12, 'poster: nothing where the player\'s play button sits (largest step ' + P.play + ')');
      expect(P.W >= 1280 && Math.abs(P.W / P.H - 16 / 9) < 0.01, 'poster: 16:9, at least 1280 wide (' + P.W + 'x' + P.H + ')');
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\nreview-stage-client-linkpolish-browser: ' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nreview-stage-client-linkpolish-browser: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
