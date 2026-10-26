'use strict';
/* Trial reels on the REAL card: screenshots (session Trials, 2026-10-26).
 *   npm run build:index && node docs/features/trial-reels/real/make-screenshots.js
 * Serves the built page through the offline harness (docs/syncview-design/tests/lost-work-lib.js: every backend answer
 * mocked, nothing leaves the machine except the page's own web font), opens today's Calendar card with the harness's
 * fictional card, and loads preview.js: the local-only switch that adds the trial-reels switch and the versions list.
 * "today-*" shots are the same card without preview.js. Light theme, 1440 and 390. Output: this folder's *.png.
 * NODE_PATH must reach playwright (as for the other browser tests). */
const fs = require('fs');
const path = require('path');
const { createEnv, sleep } = require('../../../syncview-design/tests/lost-work-lib');

const OUT = __dirname;
const PREVIEW = fs.readFileSync(path.join(__dirname, 'preview.js'), 'utf8');
// The card's normal status in each state (the card keeps its normal status; only the versions carry labels).
const STATUS = { today: 'Client Approval', review: 'Client Approval', trial: 'Approved', winner: 'Scheduled' };

(async () => {
  const S = await createEnv();
  await S.ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.continue());   // the page's own font, so it looks as it does live
  const card = S.card('p_t1');
  card.name = 'Why the first second matters';
  card.caption = 'Most people decide in the first second. Here is how to earn the second one.';
  card.graphic_status = 'N/A';
  const done = [];
  try {
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      for (const state of ['today', 'review', 'trial', 'winner']) {
        for (const k of ['video_status', 'caption_status']) card[k] = STATUS[state];
        card.status = STATUS[state];
        const page = await S.newPage();
        await page.setViewportSize({ width: w, height: h });
        await page.addInitScript(() => { try { localStorage.setItem('syncview_theme', 'light'); } catch (e) {} });
        await S.openCalendar(page);
        await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
        if (w < 600) { await page.getByText(card.name).first().click(); await sleep(1200); }
        if (state !== 'today') {
          await page.addScriptTag({ content: PREVIEW });
          await page.evaluate(([s, collapsed]) => svTrialPreview.apply(s, { collapsed }), [state, false]);
        }
        await page.mouse.move(2, h - 2);
        await sleep(700);
        const name = 'card-' + state + '-' + w + '.png';
        if (w >= 600) {
          const el = page.locator('#calView .cal-card').first();
          const box = await el.boundingBox();
          await page.screenshot({ path: path.join(OUT, name), clip: { x: 0, y: 60, width: 760, height: Math.min(1400, box.y + box.height + 24 - 60) }, fullPage: true });
        } else {
          await page.screenshot({ path: path.join(OUT, name) });
          if (state !== 'today') {   // the phone card scrolls inside its sheet: a second shot at the versions
            await page.evaluate(() => { const hd = document.querySelector('.tr-row'); if (hd) hd.scrollIntoView({ block: 'start' }); });
            await sleep(400);
            const n2 = 'card-' + state + '-' + w + '-versions.png';
            await page.screenshot({ path: path.join(OUT, n2) }); done.push(n2);
          }
        }
        done.push(name);
        if (page.errors.length) console.log('page errors', name, page.errors);
        await page.close();
      }
    }
    console.log(done.length + ' screenshots in ' + path.relative(process.cwd(), OUT));
  } finally {
    await S.close();
  }
})();
