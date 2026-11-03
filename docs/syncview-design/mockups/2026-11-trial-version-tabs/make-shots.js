'use strict';
/* Renders mockup.html (plan row 688, design step only) into PNGs next to it:
 *   side-by-side-390.png        the three options side by side at phone width
 *   option-{A,B,C}-{1440,390}.png  each option on its own, at desktop and phone width
 * Run:  node docs/syncview-design/mockups/2026-11-trial-version-tabs/make-shots.js
 */
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

(async () => {
  const file = 'file://' + path.join(__dirname, 'mockup.html');
  const browser = await chromium.launch();
  const shot = async (query, width, name) => {
    const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 2 });
    await page.goto(file + query);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(__dirname, name), fullPage: true });
    await page.close();
    console.log('wrote ' + name);
  };
  await shot('?w=390', 1300, 'side-by-side-390.png');
  for (const o of ['A', 'B', 'C']) {
    await shot('?w=1440&opt=' + o, 1440 + 34, 'option-' + o + '-1440.png');
    await shot('?w=390&opt=' + o, 390 + 34, 'option-' + o + '-390.png');
  }
  await browser.close();
})();
