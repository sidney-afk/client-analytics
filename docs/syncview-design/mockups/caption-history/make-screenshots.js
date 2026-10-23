'use strict';
/* Screenshots of the caption history mockups (session Versions, 2026-10-23). Static pages, fictional data, no network.
 * Run:  node docs/syncview-design/mockups/caption-history/make-screenshots.js
 * Writes screenshots/<name>.png next to this file. */
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const dir = __dirname;
const out = path.join(dir, 'screenshots');
fs.mkdirSync(out, { recursive: true });
const DESK = { width: 1280, height: 800 }, PHONE = { width: 390, height: 844 };
const shots = [];
for (const theme of ['light', 'dark']) {
  shots.push(['entry-desktop-' + theme, 'entry-point.html', { theme }, { width: 900, height: 560 }]);
  shots.push(['entry-phone-' + theme, 'entry-point.html', { theme }, PHONE]);
  shots.push(['a-desktop-' + theme, 'option-a-side-by-side.html', { theme, old: 1, new: 2 }, DESK]);
  shots.push(['a-phone-' + theme, 'option-a-side-by-side.html', { theme, old: 1, new: 2 }, PHONE]);
  shots.push(['b-desktop-' + theme, 'option-b-inline-list.html', { theme, v: 2 }, DESK]);
  shots.push(['b-phone-' + theme, 'option-b-inline-list.html', { theme, v: 2 }, PHONE]);
  shots.push(['c-desktop-' + theme, 'option-c-steps.html', { theme, v: 2 }, DESK]);
  shots.push(['c-phone-' + theme, 'option-c-steps.html', { theme, v: 2 }, PHONE]);
}
shots.push(['a-picker-open-light', 'option-a-side-by-side.html', { theme: 'light', state: 'open', old: 3 }, DESK]);
shots.push(['b-compare-now-light', 'option-b-inline-list.html', { theme: 'light', v: 1, cmp: 'now' }, DESK]);
shots.push(['c-client-edit-dark', 'option-c-steps.html', { theme: 'dark', v: 4 }, DESK]);
shots.push(['c-small-edit-light', 'option-c-steps.html', { theme: 'light', v: 3 }, DESK]);
shots.push(['c-small-edit-phone-dark', 'option-c-steps.html', { theme: 'dark', v: 3 }, PHONE]);
shots.push(['c-redo-before-open-light', 'option-c-steps.html', { theme: 'light', v: 2, earlier: 'open' }, DESK]);
shots.push(['empty-light', 'option-c-steps.html', { theme: 'light', state: 'empty' }, DESK]);
shots.push(['empty-phone-dark', 'option-c-steps.html', { theme: 'dark', state: 'empty' }, PHONE]);
shots.push(['restored-toast-light', 'entry-point.html', { theme: 'light', state: 'restored' }, { width: 900, height: 560 }]);

(async () => {
  const browser = await chromium.launch();
  for (const [name, file, params, vp] of shots) {
    const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 2 });
    const url = 'file://' + path.join(dir, file) + '?' + new URLSearchParams(params).toString();
    await page.goto(url);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(out, name + '.png') });
    await page.close();
    console.log('wrote', name);
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
