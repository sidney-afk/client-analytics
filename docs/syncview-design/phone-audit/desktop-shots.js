'use strict';
/* Desktop pictures for the phone polish's "desktop does not change" proof (session Grip, 2026-10-25).
 *   npm run build:index && node docs/syncview-design/phone-audit/desktop-shots.js --out=<dir> --tag=<before|after>
 * The switch phone_polish_staff lists the signed-in staff member (harness.js), at 1280 x 900, light and dark. */
const fs = require('fs');
const path = require('path');
const { staffEnv, sleep } = require('./harness');
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const OUT = arg('out', path.join(__dirname, 'shots')), TAG = arg('tag', 'after');
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const S = await staffEnv({ context: { viewport: { width: 1280, height: 900 } } });
  try {
    for (const theme of ['light', 'dark']) {
      const page = await S.newPage();
      await page.addInitScript(t => { try { localStorage.setItem('syncview_theme', t); } catch (e) {} }, theme);
      await S.openCalendar(page); await sleep(2600);
      await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
      await page.screenshot({ path: path.join(OUT, `desktop-${theme}-calendar-${TAG}.jpg`), type: 'jpeg', quality: 70 });
      await page.evaluate(() => openCalComments('p_morning')); await sleep(2500);
      // The list scrolls to the newest note when it lands; pin it to the top so before and after compare.
      await page.evaluate(() => document.querySelectorAll('#calCommentsOverlay *').forEach(e => { if (e.scrollHeight > e.clientHeight + 20) e.scrollTop = 0; })); await sleep(300);
      await page.screenshot({ path: path.join(OUT, `desktop-${theme}-notes-${TAG}.jpg`), type: 'jpeg', quality: 70 });
      await page.close();
    }
  } finally { await S.close(); }
})().catch(e => { console.error(e); process.exit(1); });
