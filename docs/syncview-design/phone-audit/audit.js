'use strict';
/* Phone audit of the real page (session Grip, 2026-10-25). Offline harness (harness.js), fictional data (fixture.js).
 *   npm run build:index && node docs/syncview-design/phone-audit/audit.js [--out=<dir>] [--w=360,390,430] [--theme=light,dark]
 * PHONE_POLISH=0 runs with phone_polish_staff off (today's page). Prints JSON findings per screen. */
const fs = require('fs');
const path = require('path');
const { staffEnv, clientPage, sleep } = require('./harness');
const { CHECK } = require('./audit-checks');
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const OUT = arg('out', path.join(__dirname, 'out'));
const WIDTHS = arg('w', '360,390,430').split(',').map(Number);
const THEMES = arg('theme', 'light,dark').split(',');
const H = { 360: 780, 390: 844, 430: 932 };

async function keyboard(page, sel, W) {
  // A phone keyboard takes about 40% of the height: shrink the viewport with the box focused, then ask whether the
  // box is still on screen.
  const h = H[W];
  const ok = await page.evaluate(s => { const e = document.querySelector(s); if (!e) return null; e.focus(); return true; }, sel);
  if (!ok) return null;
  await page.setViewportSize({ width: W, height: Math.round(h * 0.58) }); await sleep(500);
  const r = await page.evaluate(s => { const e = document.querySelector(s); const b = e.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), vh: innerHeight }; }, sel);
  await page.setViewportSize({ width: W, height: h }); await sleep(300);
  return Object.assign(r, { covered: r.bottom > r.vh || r.top < 0 });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const report = {};
  const shot = async (page, name) => { await page.evaluate(() => document.fonts.ready); await page.screenshot({ path: path.join(OUT, name + '.jpg'), type: 'jpeg', quality: 70 }); };
  for (const W of WIDTHS) {
    const S = await staffEnv({ context: { viewport: { width: W, height: H[W] }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } });
    try {
      for (const theme of THEMES) {
        const v = W + '-' + theme;
        const rec = report[v] = {};
        const page = await S.newPage();
        await page.addInitScript(t => { try { localStorage.setItem('syncview_theme', t); } catch (e) {} }, theme);
        const t0 = Date.now();
        await S.openCalendar(page);
        await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
        await sleep(2600);
        await page.evaluate(() => onCalViewChange('organizer')); await sleep(1200);
        rec.sheet = await page.evaluate(CHECK, null);
        rec.sheet.firstPostTop = await page.evaluate(() => { const t = document.querySelector('.thumb-tile, #calStrip .cal-card'); return t ? Math.round(t.getBoundingClientRect().top) : null; });
        await shot(page, v + '-sheet');
        await page.click('[data-thumb-card=p_morning]'); await sleep(1300);
        rec.detail = await page.evaluate(CHECK, null);
        rec.detail.notesTop = await page.evaluate(() => { const b = [...document.querySelectorAll('button,[data-comments-btn]')].filter(x => x.checkVisibility()).find(x => /Notes/.test(x.textContent)); const sc = document.querySelector('.cal-body'); return b ? Math.round(b.getBoundingClientRect().top + (sc ? sc.scrollTop : 0)) : null; });
        await shot(page, v + '-detail');
        await page.evaluate(() => { const sc = document.querySelector('.cal-body') || document.scrollingElement; sc.scrollTop = 99999; window.scrollTo(0, 99999); }); await sleep(400);
        await shot(page, v + '-detail-bottom');
        await page.evaluate(() => history.back()); await sleep(900);
        await page.evaluate(() => openCalComments('p_morning')); await sleep(1500);
        rec.notes = await page.evaluate(CHECK, '#calCommentsOverlay');
        rec.notes.deleteButtons = await page.evaluate(() => [...document.querySelectorAll('#calCommentsOverlay button')].filter(b => b.checkVisibility() && /Delete|×/.test(b.textContent + (b.getAttribute('aria-label') || ''))).length);
        await shot(page, v + '-notes');
        rec.notes.keyboard = await keyboard(page, '#calCommentsOverlay textarea', W);
        await shot(page, v + '-notes-after-kb');
        await page.keyboard.press('Escape'); await sleep(500);
        await page.evaluate(() => _msgOpenPage()); await sleep(1500);
        rec.inbox = await page.evaluate(CHECK, '#msgPage');
        await shot(page, v + '-inbox');
        await page.click('#msgPage [data-msg-conv="p_morning"]'); await sleep(1400);
        rec.chat = await page.evaluate(CHECK, '#msgPage');
        await shot(page, v + '-chat');
        rec.chat.keyboard = await keyboard(page, '#msgPage textarea', W);
        rec.errors = page.errors || [];
        rec.bootMs = Date.now() - t0;
        await page.close();
        const { ctx, page: cp } = await clientPage(S.browser, S.origin, { width: W, height: H[W], theme });
        await cp.waitForFunction(() => { const h = document.getElementById('svReviewStage'); return h && h.shadowRoot && h.shadowRoot.getElementById('drow'); }, null, { timeout: 30000 });
        await sleep(2500);
        rec.review = await cp.evaluate(CHECK, '#svReviewStage');
        rec.review.approveTop = await cp.evaluate(() => { const b = document.getElementById('svReviewStage').shadowRoot.querySelector('.b-ok'); return b ? Math.round(b.getBoundingClientRect().top) : null; });
        await shot(cp, v + '-review');
        // A post whose video waits for the client: the step with a player.
        await cp.evaluate(() => { const r = document.getElementById('svReviewStage').shadowRoot; const q = [...r.querySelectorAll('.cn')].find(e => /Meet the team/.test(e.textContent)); if (q) (q.closest('button,[role=button],.qi,li,div') || q).click(); }); await sleep(1500);
        rec.reviewVideo = { approveTop: await cp.evaluate(() => { const b = document.getElementById('svReviewStage').shadowRoot.querySelector('.b-ok'); return b ? Math.round(b.getBoundingClientRect().top) : null; }) };
        await shot(cp, v + '-review-video');
        rec.clientErrors = cp.errors;
        await ctx.close();
      }
    } finally { await S.close(); }
  }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
