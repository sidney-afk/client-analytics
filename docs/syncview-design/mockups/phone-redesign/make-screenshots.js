'use strict';
/* Phone redesign mockups: screenshots of the REAL page (session Palm, 2026-10-23).
 *   npm run build:index && node docs/syncview-design/mockups/phone-redesign/make-screenshots.js [--only=390-light]
 * Serves the built page offline (harness.js: every backend answer local, fictional data from fixture.js, nothing is
 * written anywhere) and takes each screen twice: "before" is today's page as it is; "after" is the same page with
 * preview.js injected, the local-only script that draws the proposed design from the page's own data. The app never
 * loads preview.js. Output: shots/<width>-<theme>-<screen>-<before|after>.jpg (2x pixel density). */
const fs = require('fs');
const path = require('path');
const { staffEnv, clientPage, sleep } = require('./harness');

const OUT = path.join(__dirname, 'shots');
const PREVIEW = fs.readFileSync(path.join(__dirname, 'preview.js'), 'utf8');
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7);
const WIDTHS = [[360, 780], [390, 844], [430, 932]];

async function shot(page, name) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(OUT, name + '.jpg'), type: 'jpeg', quality: 80, animations: 'disabled' });
  return name;
}
const inject = page => page.evaluate(src => { if (!window.svPhonePreview) (0, eval)(src); }, PREVIEW);
const closePv = page => page.evaluate(() => window.svPhonePreview && svPhonePreview.close());
const toBottom = page => page.evaluate(() => document.querySelectorAll('*').forEach(e => { if (e.scrollHeight > e.clientHeight + 20 && /auto|scroll/.test(getComputedStyle(e).overflowY)) e.scrollTop = e.scrollHeight; }));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const done = [];
  for (const [W, H] of WIDTHS) {
    const S = await staffEnv({ context: { viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } });
    try {
      for (const theme of ['light', 'dark']) {
        const v = W + '-' + theme;
        if (ONLY && !v.includes(ONLY)) continue;
        const page = await S.newPage();
        await page.addInitScript(t => { try { localStorage.setItem('syncview_theme', t); localStorage.setItem('sv-thumb-calendar-display', 'grid'); } catch (e) {} }, theme);
        await S.openCalendar(page);
        await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
        await sleep(2600);   // the Messages inbox's first read lands
        await inject(page);
        // (a) Sheet
        await page.evaluate(() => onCalViewChange('organizer')); await sleep(1200);
        done.push(await shot(page, v + '-sheet-before'));
        await page.evaluate(() => svPhonePreview.sheet('list')); await sleep(400);
        done.push(await shot(page, v + '-sheet-after'));
        await page.evaluate(() => svPhonePreview.sheet('grid')); await sleep(400);
        done.push(await shot(page, v + '-sheetgrid-after'));
        await closePv(page);
        // (a2) one post opened from the Sheet
        await page.click('[data-thumb-card=p_morning]'); await sleep(1200);
        done.push(await shot(page, v + '-detail-before'));
        await page.evaluate(() => svPhonePreview.detail('p_morning')); await sleep(400);
        done.push(await shot(page, v + '-detail-after'));
        await closePv(page);
        await page.evaluate(() => history.back()); await sleep(900);
        // (b) Notes, opened where it opens (at the newest note)
        await page.evaluate(() => openCalComments('p_morning')); await sleep(1300);
        done.push(await shot(page, v + '-notes-before'));
        await page.keyboard.press('Escape'); await sleep(500);
        await page.evaluate(() => svPhonePreview.notes('p_morning')); await sleep(400);
        done.push(await shot(page, v + '-notes-after'));
        await closePv(page);
        // (c) Messages: the list, then the long conversation (it opens at the newest message)
        await page.evaluate(() => _msgOpenPage()); await sleep(1500);
        done.push(await shot(page, v + '-inbox-before'));
        await page.evaluate(() => svPhonePreview.inbox('new')); await sleep(400);
        done.push(await shot(page, v + '-inbox-after'));
        await closePv(page);
        await page.click('#msgPage [data-msg-conv="p_morning"]'); await sleep(1300);
        done.push(await shot(page, v + '-chat-before'));
        await page.evaluate(() => svPhonePreview.chat('p_morning')); await sleep(400);
        done.push(await shot(page, v + '-chat-after'));
        if (page.errors.length) console.log('page errors', v, page.errors);
        await page.close();
        // (d) the client's review page
        const { ctx, page: cp } = await clientPage(S.browser, S.origin, { width: W, height: H, theme });
        await cp.waitForFunction(() => { const h = document.getElementById('svReviewStage'); return h && h.shadowRoot && h.shadowRoot.getElementById('drow'); }, null, { timeout: 30000 });
        await sleep(2500);
        done.push(await shot(cp, v + '-review-before'));
        await inject(cp);
        await cp.evaluate(() => svPhonePreview.review()); await sleep(500);
        done.push(await shot(cp, v + '-review-after'));
        if (cp.errors.length) console.log('client errors', v, cp.errors);
        await ctx.close();
      }
    } finally { await S.close(); }
  }
  console.log(done.length + ' screenshots in ' + OUT);
})().catch(e => { console.error(e); process.exit(1); });
