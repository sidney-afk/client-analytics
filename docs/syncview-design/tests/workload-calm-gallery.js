'use strict';

/*
 * BEFORE / AFTER SCREENSHOTS OF THE WORKLOAD CALENDAR (fictional data only).
 *
 *   node docs/syncview-design/tests/workload-calm-gallery.js --out <dir> [--calm 0|1] [--only desktop|phone]
 *
 * --calm 0 shoots today's Workload (the "before"), --calm 1 turns the staff switch on for the
 * harness' signed-in member (the "after"). Light and dark, 1440 wide and 390 wide. Every state is
 * reached with real clicks on the real page; a state the old view does not have is skipped, not faked.
 */

const fs = require('fs');
const path = require('path');
const F = require('./workload-calm-fixture.js');

const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : fallback; };
const OUT = path.resolve(arg('out', 'workload-calm-shots'));
const CALM = arg('calm', '0') === '1';
const ONLY = arg('only', '');

const { WED } = F;
fs.mkdirSync(OUT, { recursive: true });

async function clip(page, name, rects, pad = 12) {
  const boxes = [];
  for (const r of rects) {
    const box = typeof r === 'string' ? await page.locator(r).first().boundingBox().catch(() => null) : r;
    if (box) boxes.push(box);
  }
  if (!boxes.length) { console.log('  skip (nothing to shoot): ' + name); return; }
  const x1 = Math.min(...boxes.map(b => b.x)), y1 = Math.min(...boxes.map(b => b.y));
  const x2 = Math.max(...boxes.map(b => b.x + b.width)), y2 = Math.max(...boxes.map(b => b.y + b.height));
  const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  await page.screenshot({
    path: path.join(OUT, name + '.png'), fullPage: true,
    clip: { x: Math.max(0, x1 + scroll.x - pad), y: Math.max(0, y1 + scroll.y - pad), width: x2 - x1 + pad * 2, height: y2 - y1 + pad * 2 },
  });
  console.log('  shot ' + name);
}
async function full(page, name) {
  await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true });
  console.log('  shot ' + name);
}
const settle = page => page.waitForTimeout(450);
const click = async (page, selector) => { await page.locator(selector).first().click({ timeout: 5000 }); await settle(page); };
const jsClick = async (page, selector) => { await page.evaluate(sel => { const el = document.querySelector(sel); if (el) el.click(); }, selector); await settle(page); };

async function desktop(theme) {
  const tag = 'desktop-' + theme;
  console.log('--- ' + tag + (CALM ? ' (calm)' : ' (today)'));
  const open = () => F.launchCalmBoard({ calm: CALM, theme, viewport: { width: 1440, height: 1000 } });
  let h = await open();
  try {
    const page = h.page;
    await page.waitForTimeout(800);
    await full(page, `${tag}-01-week`);
    await clip(page, `${tag}-03-day-several-editors`, [`.workload-day[data-wl-day="${WED}"]`], 6);

    // A pill opened.
    await click(page, `summary[data-wl-date="${WED}"][data-wl-client="Client A"]`);
    await clip(page, `${tag}-04-pill-opened`, [`.workload-day[data-wl-day="${WED}"]`], 6);
    if (!CALM) {
      await click(page, `.workload-day[data-wl-day="${WED}"] .workload-plan-item`);
      await clip(page, `${tag}-04b-pill-then-video-popover`, ['#wlPopover', `.workload-day[data-wl-day="${WED}"]`], 6);
      // Editing a due date (today: inside the popover).
      await click(page, '#wlPopover [data-sv-date-trigger]');
      await clip(page, `${tag}-05-editing-due-date`, ['#wlPopover', '#svDatePickerPopup'], 8);
    } else {
      await click(page, `.workload-day[data-wl-day="${WED}"] [data-wl-due-issue] [data-sv-date-trigger]`);
      await clip(page, `${tag}-05-editing-due-date`, [`.workload-day[data-wl-day="${WED}"]`, '#svDatePickerPopup'], 8);
    }
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 5);
    await settle(page);

    // Needs assignment.
    await clip(page, `${tag}-06-needs-assignment-closed`, ['#wlUnassigned'], 10);
    if (CALM) {
      await click(page, '#wlUnassigned [data-wl-calm-toggle]');
      await clip(page, `${tag}-07-needs-assignment-open`, ['#wlUnassigned'], 10);
    }

    // Tweaks needed (the orange client chip).
    await click(page, '.workload-overview-status.is-tweaks [data-wl-source="tweaks"][data-wl-client="Client A"], .workload-overview-status.is-tweaks .wl-overview-chip');
    await page.waitForTimeout(700);
    await clip(page, `${tag}-08-tweaks-needed-opened`, ['#wlPopover', '.workload-overview-matrix'], 8);
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 5);
    await settle(page);

    // The View menu (a control the old view spreads over the top bar).
    if (CALM) {
      await click(page, '[data-wl-calm-view-btn]');
      await clip(page, `${tag}-09-view-menu`, ['.workload-toolbar', '#wlCalmViewMenu'], 10);
      await page.keyboard.press('Escape');
    } else {
      await clip(page, `${tag}-09-top-bar-and-filters`, ['.workload-toolbar'], 10);
    }

    // Month.
    await jsClick(page, '[data-wl-view="month"]');
    await full(page, `${tag}-02-month`);
  } catch (e) { console.log('  FAILED ' + tag + ': ' + e.message.split('\n')[0]); }
  finally { await h.close(); }
}

async function phone(theme) {
  const tag = 'phone-' + theme;
  console.log('--- ' + tag + (CALM ? ' (calm)' : ' (today)'));
  let h = await F.launchCalmBoard({ calm: CALM, theme, viewport: { width: 390, height: 844 } });
  try {
    const page = h.page;
    await page.waitForTimeout(900);
    await full(page, `${tag}-01-agenda`);
    // A day with several editors: the agenda lists people for the picked day.
    await click(page, `[data-thumb-wl-date="${WED}"]`);
    await full(page, `${tag}-03-day-several-editors`);
    // A person's queue, then one item: the popover.
    await click(page, '[data-thumb-wl-person]');
    await full(page, `${tag}-04-pill-opened-queue`);
    await click(page, '.thumb-wl-item, .workload-plan-item');
    await page.screenshot({ path: path.join(OUT, `${tag}-04b-item-opened.png`) });
    await page.evaluate(() => window.scrollTo(0, 0));
    console.log('  shot ' + `${tag}-04b-item-opened`);
    await click(page, '#wlPopover [data-sv-date-trigger]');
    await page.screenshot({ path: path.join(OUT, `${tag}-05-editing-due-date.png`) });
    console.log('  shot ' + `${tag}-05-editing-due-date`);
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await settle(page);
  } catch (e) { console.log('  FAILED ' + tag + ': ' + e.message.split('\n')[0]); }
  finally { await h.close(); }
}

(async () => {
  for (const theme of ['light', 'dark']) {
    if (ONLY !== 'phone') await desktop(theme);
    if (ONLY !== 'desktop') await phone(theme);
  }
})().catch(e => { console.error(e); process.exit(1); });
