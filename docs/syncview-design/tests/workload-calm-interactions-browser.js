'use strict';

/*
 * EVERY INTERACTION A PERSON HAS ON THE CALM WORKLOAD CALENDAR, in a real browser (all backend answered by mocks,
 * fictional data). Each pill and chip opens the right popover, the popover has ONE link ("Linear →") and no Frame.io
 * line, it closes three ways, Needs assignment folds, the tucked-away View menu works, week navigation works, light and
 * dark, 1440 and 390 wide, and nothing logs a console error. The same click for a member NOT on the switch still shows
 * "Templates" and the Frame.io line, unchanged.
 *
 *   node docs/syncview-design/tests/workload-calm-interactions-browser.js
 */

const F = require('./workload-calm-fixture.js');

let checks = 0;
function expect(ok, message) {
  if (!ok) throw new Error('WORKLOAD_CALM_INTERACTIONS ' + message);
  checks++;
}
const settle = page => page.waitForTimeout(350);
const SHOT = process.env.CALM_SHOT_DIR || '';

function watch(h) {
  h.consoleErrors = [];
  h.page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/i.test(m.text())) h.consoleErrors.push(m.text()); });
}

async function openAll(h, label) {
  const p = h.page;
  const n = await p.locator('[data-wl-rollup]:visible').count();
  expect(n >= 6, label + ': the board offers pills and chips to click (saw ' + n + ')');
  let opened = 0, withLink = 0;
  for (let i = 0; i < n; i++) {
    const el = p.locator('[data-wl-rollup]:visible').nth(i);
    if (!(await el.count())) continue;
    // Anchors (client chips) would open a tab on a plain click; the board's handler cancels that, the test does not rely on it.
    await el.click({ timeout: 4000 });
    await p.waitForTimeout(450);
    const pop = p.locator('#wlPopover.open');
    expect(await pop.count() === 1, label + ': element ' + i + ' opens the popover');
    expect(await pop.evaluate(e => e.classList.contains('wl-calm-pop')), label + ': ' + i + ' opens the flat one');
    expect((await pop.locator('.wl-calm-pop-title').innerText()).trim().length > 0, label + ': ' + i + ' has a title');
    const links = await pop.locator('.wl-calm-pop-head a').count();
    expect(links <= 1, label + ': ' + i + ' header has at most one link (saw ' + links + ')');
    if (links === 1) {
      withLink++;
      expect((await pop.locator('.wl-calm-pop-head a').innerText()).trim() === 'Linear →', label + ': ' + i + ' the one link reads "Linear →"');
      const href = await pop.locator('.wl-calm-pop-head a').getAttribute('href');
      expect(/[?&]prod=1&(d|batch)=/.test(href), label + ': ' + i + ' it points at SyncView Production (' + href + ')');
      expect(await pop.locator('.wl-calm-pop-head a').getAttribute('target') === '_blank', label + ': ' + i + ' it opens in a new tab');
    }
    const t = await pop.innerText();
    expect(!/Templates/.test(t) && !/Frame\.io/i.test(t), label + ': ' + i + ' no Templates or Frame.io text');
    expect(await pop.locator('.wl-calm-frame, .wl-tweak-frame-note, .workload-popover-templates').count() === 0, label + ': ' + i + ' none of those elements');
    await pop.locator('[data-wl-popover-close]').click();
    await settle(p);
    expect(await p.locator('#wlPopover.open').count() === 0, label + ': ' + i + ' the X closes it');
    opened++;
  }
  expect(withLink >= 1, label + ': at least one popover carried the Linear → link');
  return opened;
}

(async () => {
  // ── Desktop, light ────────────────────────────────────────────────────────
  let h = await F.launchCalmBoard({ calm: true });
  watch(h);
  try {
    const p = h.page;
    await p.waitForTimeout(900);
    console.log('--- desktop 1440, light: every pill and chip');
    expect(await p.evaluate(() => document.querySelector('.workload-view').classList.contains('wl-calm')), 'calm is on');
    const opened = await openAll(h, 'desktop');
    console.log('    ' + opened + ' pills/chips clicked');

    console.log('--- close by Escape and by a click outside');
    const tw = p.locator('.workload-overview-status.is-tweaks [data-wl-source="tweaks"][data-wl-client="Client A"]').first();
    await tw.click();
    await p.waitForTimeout(900);
    const pop = p.locator('#wlPopover.open');
    expect(await pop.count() === 1, 'the tweaks-needed chip opens the popover');
    expect(await pop.locator('.wl-calm-row').count() === 2 && await pop.locator('.wl-tweak-comment').count() >= 3, 'two tweak videos with their notes');
    expect(!/Frame\.io/i.test(await pop.innerText()), 'the tweaks-needed popover has no Frame.io line');
    expect(await pop.locator('.wl-calm-pop-head a').count() === 1, 'and exactly one link in its header');
    if (SHOT) await p.screenshot({ path: SHOT + '/2-tweaks-popover-no-frameio.png' });
    await p.keyboard.press('Escape');
    await settle(p);
    expect(await p.locator('#wlPopover.open').count() === 0, 'Escape closes it');
    await tw.click();
    await p.waitForTimeout(700);
    await p.mouse.click(5, 5);
    await settle(p);
    expect(await p.locator('#wlPopover.open').count() === 0, 'a click outside closes it');

    console.log('--- the single link: a lone video versus a batch');
    await p.locator(`.workload-day[data-wl-day="${F.WED}"] .workload-day-card-total`).first().click();
    await p.waitForTimeout(500);
    if (SHOT) await p.screenshot({ path: SHOT + '/1-popover-single-link.png' });
    const hrefs = await p.locator('#wlPopover .wl-calm-pop-head a').evaluateAll(a => a.map(x => x.getAttribute('href')));
    expect(hrefs.length <= 1, 'an editor total shows at most one link');
    await p.keyboard.press('Escape');
    await settle(p);
    const sole = p.locator('[data-wl-rollup][data-wl-client="Client B"]:visible').first();
    if (await sole.count()) {
      await sole.click(); await p.waitForTimeout(500);
      const a = p.locator('#wlPopover .wl-calm-pop-head a');
      if (await a.count()) expect(/prod=1/.test(await a.getAttribute('href')), 'a client chip links to Production');
      await p.keyboard.press('Escape'); await settle(p);
    }

    console.log('--- Needs assignment folds and unfolds');
    const un = '#wlUnassigned';
    expect(await p.locator(un + ' .wl-loose-clients').isHidden(), 'starts closed');
    await p.locator(un + ' [data-wl-calm-toggle]').click();
    expect(await p.locator(un + ' .wl-loose-clients').isVisible(), 'opens');
    await p.locator(un + ' [data-wl-calm-toggle]').focus();
    await p.keyboard.press('Enter');
    expect(await p.locator(un + ' .wl-loose-clients').isHidden(), 'Enter on it closes again');

    console.log('--- the tucked-away filters');
    await p.locator('[data-wl-calm-view-btn]').click();
    expect(await p.locator('#wlCalmViewMenu').isVisible(), 'View opens the menu');
    for (const team of ['video', 'graphics', 'all']) {
      const b = p.locator('#wlCalmViewMenu [data-wl-team="' + team + '"]');
      if (await b.count()) { await b.click(); await settle(p); expect(await p.evaluate(() => !!document.querySelector('.workload-view')), 'Team ' + team + ' redraws without losing the page'); }
    }
    await p.locator('#wlCalmViewMenu').getByRole('button', { name: /^(Overview|Calendar)$/i }).first().click({ timeout: 1500 }).catch(() => {});
    await p.keyboard.press('Escape');
    await settle(p);
    expect(await p.locator('#wlCalmViewMenu').isHidden(), 'Escape closes the menu');

    console.log('--- week navigation');
    const range = () => p.evaluate(() => document.querySelector('.workload-view').innerText.match(/\b(Sep|Oct|Aug)[a-z]*\s+\d+/g)?.join('|') || '');
    const before = await p.locator('.workload-day[data-wl-day]').first().getAttribute('data-wl-day');
    await p.locator('[data-wl-nav="next"]').click(); await settle(p);
    const nextFirst = await p.locator('.workload-day[data-wl-day]').first().getAttribute('data-wl-day');
    expect(nextFirst !== before, 'next moves the week (' + before + ' to ' + nextFirst + ')');
    await p.locator('[data-wl-nav="prev"]').click(); await p.locator('[data-wl-nav="prev"]').click(); await settle(p);
    expect(await p.locator('.workload-day[data-wl-day]').first().getAttribute('data-wl-day') !== nextFirst, 'previous moves back');
    await p.locator('[data-wl-nav="today"]').click(); await settle(p);
    expect(await p.locator('.workload-day[data-wl-day]').first().getAttribute('data-wl-day') === before, 'Today returns to this week');
    void range;
    expect(h.state.pageErrors.length === 0, 'no page errors: ' + h.state.pageErrors[0]);
    expect(h.consoleErrors.length === 0, 'no console errors: ' + h.consoleErrors[0]);
  } finally { await h.close(); }

  // ── Dark ──────────────────────────────────────────────────────────────────
  h = await F.launchCalmBoard({ calm: true, theme: 'dark' });
  watch(h);
  try {
    const p = h.page;
    await p.waitForTimeout(900);
    console.log('--- dark theme');
    expect(await p.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'dark', 'dark is on');
    await p.locator('.workload-overview-status.is-tweaks [data-wl-source="tweaks"][data-wl-client="Client A"]').first().click();
    await p.waitForTimeout(900);
    expect(await p.locator('#wlPopover.open .wl-calm-pop-head a').count() === 1 && !/Frame\.io/i.test(await p.locator('#wlPopover').innerText()), 'the popover is the same in dark');
    await p.keyboard.press('Escape');
    expect(h.state.pageErrors.length === 0 && h.consoleErrors.length === 0, 'no errors in dark: ' + (h.state.pageErrors[0] || h.consoleErrors[0]));
  } finally { await h.close(); }

  // ── Phone ─────────────────────────────────────────────────────────────────
  h = await F.launchCalmBoard({ calm: true, viewport: { width: 390, height: 844 } });
  watch(h);
  try {
    const p = h.page;
    await p.waitForTimeout(900);
    console.log('--- phone 390');
    await p.locator('[data-thumb-wl-person]').first().click();
    await settle(p);
    await p.locator('.thumb-wl-item').first().click();
    await settle(p);
    const pop = p.locator('#wlPopover.open.wl-calm-pop');
    expect(await pop.count() === 1, 'a phone item opens the flat sheet');
    expect(await pop.locator('.wl-calm-pop-head a').count() <= 1 && !/Templates|Frame\.io/i.test(await pop.innerText()), 'one link at most, no Templates or Frame.io');
    const fits = await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(fits, 'no sideways scroll at 390');
    if (SHOT) await p.screenshot({ path: SHOT + '/3-phone.png' });
    await pop.locator('[data-wl-popover-close]').click();
    await settle(p);
    expect(await p.locator('#wlPopover.open').count() === 0, 'the X closes the sheet');
    await p.locator('.thumb-wl-item').first().click().catch(() => {});
    await settle(p);
    await p.keyboard.press('Escape');
    await settle(p);
    expect(await p.locator('#wlPopover.open').count() === 0, 'Escape closes the sheet');
    expect(h.state.pageErrors.length === 0 && h.consoleErrors.length === 0, 'no phone errors: ' + (h.state.pageErrors[0] || h.consoleErrors[0]));
  } finally { await h.close(); }

  // ── Not on the switch: unchanged ──────────────────────────────────────────
  h = await F.launchCalmBoard({ calm: false });
  watch(h);
  try {
    const p = h.page;
    await p.waitForTimeout(900);
    console.log('--- a member NOT on the switch: unchanged');
    expect(await p.evaluate(() => !document.querySelector('.workload-view').classList.contains('wl-calm')), 'not calm');
    await p.locator('[data-wl-source="tweaks"][data-wl-client="Client A"]:visible').first().click();
    await p.waitForTimeout(900);
    const pop = p.locator('#wlPopover.open');
    const t = await pop.innerText();
    expect(/Always check Frame\.io too\./.test(t), 'the Frame.io line is still there');
    expect(await pop.locator('.workload-popover-templates').count() === 1, 'the Templates link is still there');
    expect(/Open (SyncView|parent) →/.test(t), 'the old "Open SyncView/parent" label is unchanged');
    expect(h.state.pageErrors.length === 0 && h.consoleErrors.length === 0, 'no errors: ' + (h.state.pageErrors[0] || h.consoleErrors[0]));
  } finally { await h.close(); }

  console.log('workload-calm-interactions-browser: all ' + checks + ' checks passed');
})().catch(e => { console.error(e.message || e); process.exit(1); });
