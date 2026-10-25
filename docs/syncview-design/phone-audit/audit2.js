'use strict';
/* Phone audit, round 2 (session Grip, 2026-10-25): the screens round 1 did not cover, with phone_polish_staff on.
 *   npm run build:index && node docs/syncview-design/phone-audit/audit2.js [--out=<dir>] [--w=360,390,430] [--theme=light,dark]
 * Same offline harness and fictional data as audit.js. Prints JSON per screen and writes one picture per screen. */
const fs = require('fs');
const path = require('path');
const { staffEnv, sleep } = require('./harness');
const { CHECK } = require('./audit-checks');
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const OUT = arg('out', path.join(__dirname, 'out2'));
const WIDTHS = arg('w', '360,390,430').split(',').map(Number);
const THEMES = arg('theme', 'light,dark').split(',');
const H = { 360: 780, 390: 844, 430: 932 };
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const report = {};
  const shot = async (page, name) => { await page.evaluate(() => document.fonts.ready); await page.screenshot({ path: path.join(OUT, name + '.jpg'), type: 'jpeg', quality: 70 }); };
  for (const W of WIDTHS) {
    const S = await staffEnv({ context: { viewport: { width: W, height: H[W] }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } });
    try {
      for (const theme of THEMES) {
        const v = W + '-' + theme, rec = report[v] = {};
        const page = await S.newPage();
        await page.addInitScript(t => { try { localStorage.setItem('syncview_theme', t); } catch (e) {} }, theme);
        await S.openCalendar(page); await sleep(2600);
        await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
        for (const [name, go] of [
          ['month', () => onCalViewChange('month')],
          ['week', () => onCalViewChange('week')],
          ['review', () => onCalViewChange('smmreview')],
          ['today', () => navTo('today')],
          ['workload', () => navTo('workload')],
        ]) {
          try { await page.evaluate(go); } catch (e) { rec[name] = { error: String(e.message).slice(0, 120) }; continue; }
          await sleep(2200);
          rec[name] = await page.evaluate(CHECK, null);
          await shot(page, v + '-' + name);
          if (name === 'week' || name === 'review') { await page.evaluate(() => navTo('calendar')); await sleep(1200); }
        }
        await page.evaluate(() => navTo('calendar')); await sleep(1500);
        await page.evaluate(() => _msgOpenPage()); await sleep(1500);
        await page.click('#msgPage [data-msg-conv="p_morning"]'); await sleep(1400);
        rec.chat = await page.evaluate(CHECK, '#msgPage');
        rec.chat.metaLines = await page.evaluate(() => [...document.querySelectorAll('#msgPage .msg-b-meta')].filter(e => e.checkVisibility()).map(e => Math.round(e.getBoundingClientRect().height)));
        await shot(page, v + '-chat');
        await page.evaluate(() => { _msgClosePage && _msgClosePage(); }).catch(() => {});
        await page.evaluate(() => navTo('calendar')); await sleep(1200);
        await page.evaluate(() => openCalComments('p_morning')); await sleep(1500);
        rec.notes = await page.evaluate(CHECK, '#calCommentsOverlay');
        rec.notes.actionRows = await page.evaluate(() => [...document.querySelectorAll('#calCommentsOverlay .cal-cm-actions')].filter(e => e.checkVisibility()).map(e => Math.round(e.getBoundingClientRect().height + parseFloat(getComputedStyle(e).marginTop))));
        rec.notes.composer = await page.evaluate(() => { const ta = document.querySelector('#calCommentsOverlay textarea'); let e = ta; while (e && e.parentElement && e.parentElement.getBoundingClientRect().height < innerHeight * 0.5) e = e.parentElement; return e ? Math.round(e.getBoundingClientRect().height) : null; });
        await page.evaluate(() => { const f = [...document.querySelectorAll('#calCommentsOverlay *')].find(e => e.scrollHeight > e.clientHeight + 20); if (f) f.scrollTop = 0; }); await sleep(300);
        await shot(page, v + '-notes-top');
        rec.errors = page.errors || [];
        await page.close();
      }
    } finally { await S.close(); }
  }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
