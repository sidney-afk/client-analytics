'use strict';

/*
 * THE CALM WORKLOAD CALENDAR, DRIVEN IN A REAL BROWSER (all backend answered by mocks, fictional data).
 *
 * Switch workload_calm_staff names the harness' signed-in member. The suite proves the owner's list point by point
 * and, above all, that presentation changed while every write stayed exactly what it was: each action below saves
 * ONCE, through the old route (production-write `due`, workload-plan `set`).
 *
 *   node docs/syncview-design/tests/workload-calm-browser.js
 */

const F = require('./workload-calm-fixture.js');
const { WED, THU, FRI } = F;

let checks = 0;
function expect(ok, message) {
  if (!ok) throw new Error('WORKLOAD_CALM ' + message);
  checks++;
}
const settle = page => page.waitForTimeout(350);

async function pickDate(page, iso) {
  await page.waitForSelector('#svDatePickerPopup', { timeout: 5000 });
  await page.locator(`#svDatePickerPopup [data-dp-day="${iso}"]`).first().click();
  await settle(page);
}

(async () => {
  // ── Desktop ────────────────────────────────────────────────────────────────
  let h = await F.launchCalmBoard({ calm: true });
  try {
    const p = h.page;
    await p.waitForTimeout(900);
    console.log('--- the page');
    expect(await p.evaluate(() => document.querySelector('.workload-view').classList.contains('wl-calm')), 'the switch names this member, so the page is calm');
    const text = await p.evaluate(() => document.querySelector('.workload-view').innerText);
    expect(!/not shown here/i.test(text), 'the "sub-issues are not shown here" line is gone');
    expect(await p.evaluate(() => !document.querySelector('.workload-legend') || getComputedStyle(document.querySelector('.workload-legend')).display === 'none'), 'the legend is gone');
    expect(await p.evaluate(() => getComputedStyle(document.querySelector('.workload-calendar-heading h2')).display === 'none' || !document.querySelector('.workload-calendar-heading').offsetParent), 'the "Work-day calendar" heading is gone');

    console.log('--- top bar: the rarely used controls sit behind one View button');
    const visibleTop = await p.evaluate(() => [...document.querySelectorAll('.workload-toolbar button, .workload-toolbar input')].filter(el => el.offsetParent !== null).map(el => (el.getAttribute('data-wl-calm-view-btn') !== null ? 'view' : (el.getAttribute('data-wl-nav') || el.id || el.className)).toString()));
    expect(visibleTop.length <= 4 && visibleTop.includes('view'), 'the visible top bar holds only the arrows, Today and View (saw ' + visibleTop.join(',') + ')');
    for (const sel of ['#wlTeamPills', '.wl-dropdown[data-wl-filter="editor"]', '.wl-client-search', '.workload-deadline-mode', '#wlViewPills', '[data-wl-nav="refresh"]']) {
      expect(await p.evaluate(s => { const el = document.querySelector(s); return !!el && !!el.closest('#wlCalmViewMenu'); }, sel), sel + ' lives in the View menu');
    }
    expect(await p.locator('#wlCalmViewMenu').isHidden(), 'the View menu starts closed');
    await p.locator('[data-wl-calm-view-btn]').click();
    expect(await p.locator('#wlCalmViewMenu').isVisible(), 'View opens the menu');
    await p.locator('#wlCalmViewMenu').click({ position: { x: 4, y: 4 } });
    expect(await p.locator('#wlCalmViewMenu').isVisible(), 'a click inside the menu does not close it');
    await p.locator('#wlCalmViewMenu [data-wl-team="video"]').click();
    await settle(p);
    expect(await p.evaluate(() => wlState.team) === 'video', 'the menu controls still work (Team: Video)');
    expect(await p.evaluate(() => document.querySelector('[data-wl-calm-view-btn]').classList.contains('has-filter')), 'a filter that is on puts a dot on View');
    await p.locator('#wlCalmViewMenu [data-wl-team="all"]').click();
    await p.keyboard.press('Escape');
    expect(await p.locator('#wlCalmViewMenu').isHidden(), 'Escape closes the menu');
    expect(await p.evaluate(() => document.activeElement && document.activeElement.hasAttribute('data-wl-calm-view-btn')), 'focus returns to View');
    await p.locator('[data-wl-calm-view-btn]').click();
    await p.mouse.click(5, 5);
    expect(await p.locator('#wlCalmViewMenu').isHidden(), 'a click outside closes the menu');
    await p.locator('[data-wl-calm-view-btn]').click();
    await p.evaluate(() => wlRefetchSilent());
    await p.waitForTimeout(600);
    expect(await p.locator('#wlCalmViewMenu').isVisible(), 'a background refresh does not close the menu');
    await p.keyboard.press('Escape');

    console.log('--- Needs assignment');
    const un = '#wlUnassigned';
    expect(await p.locator(un + ' .wl-loose-clients').isHidden(), 'Needs assignment starts closed');
    expect((await p.locator(un + ' [data-wl-calm-count]').innerText()) === '3', 'its closed row carries the count');
    await p.locator(un + ' [data-wl-calm-toggle]').click();
    expect(await p.locator(un + ' .wl-loose-clients').isVisible(), 'one click opens it');
    expect(await p.locator(un + ' .wl-calm-loose-item').count() === 3, 'inside it, the three videos as plain lines');
    expect(await p.locator(un + ' .workload-chip, ' + un + ' .wl-loose-parent').count() === 0, 'no frames or per-batch boxes inside');
    await p.locator(un + ' [data-wl-calm-toggle]').click();
    expect(await p.locator(un + ' .wl-loose-clients').isHidden(), 'and it closes again');

    console.log('--- day cards: editor badge, a dot on every client row, pills on the header row');
    const cards = await p.evaluate(() => [...document.querySelectorAll('.workload-grid.week .workload-day-card')].map(c => {
      const head = c.querySelector('.workload-day-card-head');
      const badge = head.querySelector('.workload-day-card-badge');
      const pseudo = getComputedStyle(head, '::before').content;
      const rows = [...c.querySelectorAll('.workload-day-card-chip')].map(r => {
        const d = r.querySelector('.wl-deadline-summary .wl-deadline-dot');
        const box = d && d.getBoundingClientRect();
        return !!d && box.width > 0 && getComputedStyle(d).backgroundColor !== 'rgba(0, 0, 0, 0)';
      });
      const pills = [...c.querySelectorAll('.wl-day-status-pill')];
      const total = head.querySelector('.workload-day-card-total').getBoundingClientRect();
      const name = head.querySelector('.workload-day-card-name').getBoundingClientRect();
      return {
        badge: badge ? badge.textContent : null,
        name: head.querySelector('.workload-day-card-name').textContent,
        noDot: pseudo === 'none' || pseudo === 'normal' || pseudo === '""',
        rows,
        pills: pills.length,
        pillsInHead: pills.every(x => head.contains(x)),
        pillsBetween: pills.every(x => { const r = x.getBoundingClientRect(); return Math.abs(r.top - name.top) < 14 && r.left >= name.left && r.right <= total.right; }),
        separateStatusRow: !!c.querySelector(':scope > .workload-day-card-status'),
      };
    }));
    expect(cards.length >= 5, 'the week shows day cards (saw ' + cards.length + ')');
    expect(cards.every(c => c.badge === c.name.charAt(0).toUpperCase()), 'every editor name starts with a rounded-square initial badge');
    expect(cards.every(c => c.noDot), 'no dot before any editor name');
    expect(cards.every(c => c.rows.length > 0 && c.rows.every(Boolean)), 'every client row has a visible status dot');
    expect(cards.some(c => c.pills > 0), 'today carries count pills');
    expect(cards.every(c => c.pillsInHead && c.pillsBetween && !c.separateStatusRow), 'the count pills share the editor header row, between the name and the load');

    console.log('--- one click from the pill to everything');
    const grp = `summary[data-wl-date="${WED}"][data-wl-client="Client A"]`;
    await p.locator(grp).first().click();
    await settle(p);
    const row = `.workload-day[data-wl-day="${WED}"] .wl-calm-row[data-wl-issue-id="a1"]`;
    expect(await p.locator(row).isVisible(), 'one click on the pill lists its videos');
    expect(await p.locator(row + ' .wl-deadline-tag').isVisible(), 'with the due line');
    expect(await p.locator(row + ' [data-sv-date-trigger]').isEnabled(), 'the due date can be changed right there');
    expect(await p.locator(row + ' [data-wl-plan-clear]').isVisible(), 'a hand-pinned day offers "Use automatic plan" right there');
    expect(await p.locator('#wlPopover.open').count() === 0, 'and no popover opened');
    expect(await p.locator(row + ' a.wl-calm-row-title').getAttribute('target') === '_blank', 'the title opens the video in SyncView');

    console.log('--- change a due date inline: exactly one write, group stays open');
    h.state.dueWrites.length = 0;
    await p.locator(row + ' [data-sv-date-trigger]').click();
    await pickDate(p, FRI);
    expect(h.state.dueWrites.length === 1, 'the due date saved exactly once (saw ' + h.state.dueWrites.length + ')');
    const w = h.state.dueWrites[0];
    expect(w.operation === 'due' && w.id === 'a1' && w.due_date === FRI, 'through the old route, for the right card and day');
    expect(await p.locator(row).isVisible(), 'the group is still open after the save redrew the page');
    expect((await p.locator(row + ' .wl-deadline-tag').innerText()).includes('18'), 'and the row shows the new due date');

    console.log('--- automatic plan inline: exactly one write');
    h.state.planWrites.length = 0;
    await p.locator(row + ' [data-wl-plan-clear]').click();
    await p.waitForTimeout(500);
    expect(h.state.planWrites.length === 1, 'Use automatic plan saved exactly once (saw ' + h.state.planWrites.length + ')');
    expect(h.state.planWrites[0].issue_id === 'a1' && h.state.planWrites[0].plan_date == null, 'as the old route: clear the saved day');

    console.log('--- drag still moves one card with one write');
    h.state.planWrites.length = 0;
    await F.dragIssueToDay(p, 'a2', THU);
    await p.waitForTimeout(500);
    expect(h.state.planWrites.length === 1 && h.state.planWrites[0].plan_date === THU, 'one write for a drag');

    console.log('--- Tweaks needed: one click, flat');
    await p.locator('.workload-overview-status.is-tweaks [data-wl-source="tweaks"][data-wl-client="Client A"]').first().click();
    await p.waitForTimeout(900);
    const pop = p.locator('#wlPopover');
    expect(await pop.isVisible() && await pop.evaluate(el => el.classList.contains('wl-calm-pop')), 'one click opens the flat popover');
    expect(!(await pop.innerText()).includes('Frame.io'), 'the Frame.io reminder is gone (owner, 2026-10-19)');
    expect(await pop.locator('.wl-calm-row').count() === 2, 'both tweak videos listed');
    expect(await pop.locator('.wl-tweak-comment').count() >= 3, 'with their latest comments');
    expect(await pop.locator('.workload-popover-plan, .workload-popover-item, .wl-tweak-frame-note').count() === 0, 'none of the old boxes');
    const bordered = await pop.evaluate(el => [...el.querySelectorAll('.wl-calm-row, .wl-tweak-comments, .wl-tweak-comment, .wl-calm-pop-head')].filter(n => parseFloat(getComputedStyle(n).borderTopWidth) > 0 || parseFloat(getComputedStyle(n).borderBottomWidth) > 0).length);
    expect(bordered === 0, 'no section inside it has a border');
    expect(h.state.commentReads.length === 2, 'each deliverable\'s notes were read once (saw ' + h.state.commentReads.length + ')');
    expect(await pop.locator('[data-sv-date-trigger]').count() === 0, 'tweak rows offer no date edit, as before');
    await p.keyboard.press('Escape');
    await settle(p);

    console.log('--- popover rows save once too (editor total badge)');
    h.state.dueWrites.length = 0;
    await p.locator(`.workload-day[data-wl-day="${WED}"] .workload-day-card-total`).first().click();
    await settle(p);
    expect(await p.evaluate(() => { const m = {}; document.querySelectorAll('[id]').forEach(e => { m[e.id] = (m[e.id] || 0) + 1; }); return Object.values(m).every(n => n === 1); }), 'an open client group and the popover on the same videos share no element id');
    await p.locator('#wlPopover .wl-calm-row [data-sv-date-trigger]').first().click();
    await pickDate(p, '2026-09-22');
    expect(h.state.dueWrites.length === 1, 'a due date edited in the popover saved exactly once (saw ' + h.state.dueWrites.length + ')');
    expect(h.state.pageErrors.length === 0, 'no page errors: ' + h.state.pageErrors[0]);
  } finally { await h.close(); }

  // ── A visit after one that saw the member named: a loader holds the page while the switch read is on its way ──
  for (const answer of ['listed', 'unreadable']) {
    h = await F.launchCalmBoard({ calm: true });
    try {
      const p = h.page;
      await p.waitForTimeout(600);
      console.log('--- the held page, switch read ' + (answer === 'listed' ? 'answers' : 'fails'));
      await h.context.route('**/rest/v1/syncview_runtime_flags**review_stage_client_pages**', async route => {
        await new Promise(r => setTimeout(r, 2200));
        if (answer === 'unreadable') return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([F.CALM_FLAG]) });
      });
      await p.goto('http://127.0.0.1:' + h.server.address().port + '/#workload', { waitUntil: 'domcontentloaded' });
      await p.waitForSelector('.workload-view', { timeout: 20000 });
      await p.waitForTimeout(900);
      const during = await p.evaluate(() => ({
        hold: document.querySelector('.workload-view').classList.contains('wl-calm-hold'),
        bar: getComputedStyle(document.querySelector('.workload-toolbar')).visibility,
        cards: document.querySelectorAll('.workload-day-card-chip').length,
      }));
      expect(during.hold && during.bar === 'hidden' && during.cards === 0, 'while the read is on its way: a loader, no old toolbar, no old calendar (saw ' + JSON.stringify(during) + ')');
      await p.waitForFunction(() => document.querySelectorAll('.workload-day-card-chip').length > 0, null, { timeout: 15000 });
      await p.waitForTimeout(600);
      const calm = await p.evaluate(() => document.querySelector('.workload-view').classList.contains('wl-calm'));
      const held = await p.evaluate(() => document.querySelector('.workload-view').classList.contains('wl-calm-hold'));
      expect(calm === (answer === 'listed') && !held, 'afterwards: ' + (answer === 'listed' ? 'the calm calendar' : 'the old calendar') + ', loader gone');
      expect(h.state.pageErrors.length === 0, 'no page errors: ' + h.state.pageErrors[0]);
    } finally { await h.close(); }
  }

  // ── Phone ──────────────────────────────────────────────────────────────────
  h = await F.launchCalmBoard({ calm: true, viewport: { width: 390, height: 844 } });
  try {
    const p = h.page;
    await p.waitForTimeout(900);
    console.log('--- phone');
    expect(await p.evaluate(() => document.querySelector('.workload-view').classList.contains('wl-calm')), 'the phone page is calm too');
    await p.locator('[data-thumb-wl-person]').first().click();
    await settle(p);
    await p.locator('.thumb-wl-item').first().click();
    await settle(p);
    expect(await p.locator('#wlPopover.open.wl-calm-pop').count() === 1, 'a phone item opens the flat sheet');
    h.state.dueWrites.length = 0;
    const trigger = p.locator('#wlPopover .wl-calm-row [data-sv-date-trigger]').first();
    if (await trigger.count() && await trigger.isEnabled()) {
      await trigger.click();
      await p.waitForSelector('#svDatePickerPopup');
      await p.locator('#svDatePickerPopup [data-dp-day="2026-09-17"]').first().click();
      await settle(p);
      expect(h.state.dueWrites.length === 1, 'a phone due date saved exactly once (saw ' + h.state.dueWrites.length + ')');
    }
    expect(h.state.pageErrors.length === 0, 'no phone page errors: ' + h.state.pageErrors[0]);
  } finally { await h.close(); }

  console.log('workload-calm-browser: all ' + checks + ' checks passed');
})().catch(e => { console.error(e.message || e); process.exit(1); });
