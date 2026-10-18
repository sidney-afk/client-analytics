'use strict';
/*
 * THE NEW REVIEW PAGE (layout C), behind its two switches, in a real browser, fully offline. Session Marquee.
 *
 * Drives the real page against a mocked backend (fictional clients, cards, people and tokens; the clip and posters
 * are the frame viewer's generated fixtures) and proves:
 *   - switch off, missing or unreadable: the client link and the SMM's Review tab show the old page, and Kasper's
 *     Review Session is the old one for anyone the switch does not name;
 *   - switch on: the new page draws, with no part list on the left, the date at the stage's top left, the step bar
 *     carrying each part's state, the strip scrolling sideways with the mouse wheel;
 *   - every button saves through the old page's own path: approve, a change request (nothing is sent before Send),
 *     a note, the client's caption edit (a change request, never an approval), Finish opening the next post, the
 *     SMM's Approve to Kasper and to client, Kasper's Approve and Tweaks are on Frame;
 *   - the "?" help button is hidden with no address set and opens /start#review in a new tab with one.
 * REVIEW_STAGE_SHOTS=<dir> also writes the screenshots used in the PR (before and after, light and dark).
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');

const { CLIENT, SLUG, TOKEN, STAFF, OTHER, open, openClient, host, inS, waitNew, answerConfirm, sleep } = require('./fixtures/review-stage-fixture.js');
const SHOTS = process.env.REVIEW_STAGE_SHOTS || '';
const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }
async function shot(t, name) { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); await sleep(900); await t.page.screenshot({ path: path.join(SHOTS, name + '.png') }); }

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    const only = process.env.RS_ONLY || '';
    if (!only || only === 'client') {
    // ---------- the old page stays, switch off / unreadable ----------
    for (const flags of ['off', 'unreadable']) {
      console.log('--- client link, switch ' + flags + ' ---');
      const t = await openClient(browser, origin, { flags });
      await t.page.locator('.kcard[data-cal-review-pid="rs1"]').waitFor({ timeout: 30000 });
      await sleep(1200);
      expect(!(await host(t.page).count()) || await host(t.page).evaluate(e => e.hidden), flags + ': the new page is not drawn');
      expect(await t.page.locator('#calView').isVisible(), flags + ': the old review list shows');
      if (flags === 'off') { await shot(t, 'before-client-1440-light'); }
      expect(t.errors.length === 0, flags + ': no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }

    // ---------- the client page, switch on ----------
    console.log('--- client link, switch on ---');
    let t = await openClient(browser, origin, { flags: 'on' });
    await waitNew(t);
    await sleep(800);
    const look = await t.page.evaluate(() => {
      const r = document.getElementById('svReviewStage').shadowRoot;
      const vis = el => !!el && el.offsetParent !== null && !el.hidden;
      return {
        oldVisible: vis(document.getElementById('calView')),
        tabsVisible: !!document.querySelector('.client-view .view-tab-toggle') && vis(document.querySelector('.client-view .view-tab-toggle')),
        name: (r.getElementById('rsName') || {}).textContent,
        partsList: !!r.querySelector('.sd-parts') && vis(r.querySelector('.sd-parts')),
        date: (r.getElementById('sdate') || {}).textContent,
        steps: Array.from(r.querySelectorAll('.stp')).map(b => b.textContent.trim()),
        cursor: getComputedStyle(r.querySelector('.stp:not(.on)')).cursor,
        help: vis(r.getElementById('rsHelp')),
        player: !!r.querySelector('#fvHost .fv-player'),
        chips: r.querySelectorAll('.chipp').length,
      };
    });
    expect(!look.oldVisible && !look.tabsVisible, 'on: the old list and the Analytics tabs step aside');
    expect(look.name === CLIENT, 'on: the client name heads the page (' + look.name + ')');
    expect(!look.partsList, 'on: no part list on the left');
    expect(look.date === 'Fri 23 Oct', 'on: the date sits at the stage top left, written "Fri 23 Oct" (' + look.date + ')');
    expect(look.steps.join('|') === '1Video|2Thumbnail|3Caption', 'on: the step bar has the three parts (' + look.steps.join('|') + ')');
    expect(look.cursor === 'pointer', 'on: a step shows the hand cursor');
    expect(!look.help, 'on: the "?" is hidden with no help video address');
    expect(look.player, 'on: the video plays in the Notes view player (#2120)');
    expect(look.chips === 7, 'on: the strip lists the seven waiting posts (' + look.chips + ')');
    await shot(t, 'after-client-1440-light');

    // the strip: the ordinary wheel moves it sideways
    await t.page.setViewportSize({ width: 1100, height: 860 });
    await sleep(400);
    const box = await inS(t.page, '#skList').boundingBox();
    const before = await inS(t.page, '#skList').evaluate(e => ({ x: e.scrollLeft, max: e.scrollWidth - e.clientWidth }));
    await t.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await t.page.mouse.wheel(0, 240);
    await sleep(300);
    const after = await inS(t.page, '#skList').evaluate(e => e.scrollLeft);
    expect(before.max > 0 && after > before.x, 'strip: the mouse wheel scrolls it sideways (' + before.x + ' -> ' + after + ', room ' + before.max + ')');
    await t.page.setViewportSize({ width: 1440, height: 900 });

    // approve the video: one save, video Approved
    let n0 = t.state.upserts.length;
    await inS(t.page, '[data-ok="video"]').click();
    await t.page.waitForFunction(n => window.__rsUpserts === undefined || true, n0);
    for (let i = 0; i < 60 && !t.state.upserts.slice(n0).some(u => u.video_status === 'Approved'); i++) await sleep(100);
    expect(t.state.upserts.slice(n0).some(u => u.id === 'rs1' && u.video_status === 'Approved'), 'client: Approve saves the video as Approved through the calendar save');
    await sleep(900);
    const stepAfter = await inS(t.page, '.stp.on').getAttribute('data-step');
    expect(stepAfter === 'graphic', 'client: approving moves the stage to the next part by itself (' + stepAfter + ')');
    expect(await inS(t.page, '.stp[data-step="video"]').evaluate(e => e.classList.contains('ok')), 'client: the step bar shows the video approved');

    // ask for a change: nothing is saved before Send
    n0 = t.state.upserts.length;
    await inS(t.page, '[data-chg="graphic"]').click();
    await sleep(300);
    await inS(t.page, '#cmpCancel').click();
    await sleep(800);
    expect(t.state.upserts.length === n0, 'client: Ask for a change then Cancel saves nothing');
    await inS(t.page, '[data-chg="graphic"]').click();
    await inS(t.page, '#ta').fill('Move the title to the top, please.');
    await shot(t, 'after-client-change-1440-light');
    await inS(t.page, '#sendBtn').click();
    for (let i = 0; i < 80 && !t.state.upserts.slice(n0).some(u => u.graphic_status === 'Tweaks Needed'); i++) await sleep(100);
    const chg = t.state.upserts.slice(n0).find(u => u.graphic_status === 'Tweaks Needed');
    expect(!!chg && /Move the title to the top/.test(String(chg.graphic_tweaks || '')), 'client: Send saves the change request with its words on the thumbnail');

    // the caption edit changes the caption itself and tells the team in a note; it never approves or asks for a change
    await sleep(900);
    await inS(t.page, '.stp[data-step="caption"]').click();
    await sleep(500);
    await inS(t.page, '#editBtn').click();
    await inS(t.page, '#capTa').fill('A new caption written by the client.');
    n0 = t.state.upserts.length;
    await inS(t.page, '#capSave').click();
    for (let i = 0; i < 80 && !t.state.upserts.slice(n0).some(u => /Changed the caption to/.test(String(u.caption_tweaks || ''))); i++) await sleep(100);
    const ups = t.state.upserts.slice(n0);
    expect(ups.some(u => u.id === 'rs1' && u.caption === 'A new caption written by the client.'), 'client: a caption edit saves the new caption on the card');
    expect(ups.some(u => /Changed the caption to/.test(String(u.caption_tweaks || ''))), 'client: and tells the team in a note on the caption');
    expect(!ups.some(u => u.caption_status === 'Approved' || u.caption_status === 'Tweaks Needed'), 'client: the caption edit neither approves nor asks for a change');
    await sleep(600);
    await inS(t.page, '[data-ok="caption"]').click();
    for (let i = 0; i < 60 && !t.state.upserts.slice(n0).some(u => u.caption_status === 'Approved'); i++) await sleep(100);

    // Finish opens the next post
    await sleep(900);
    expect(await inS(t.page, '#finishBtn').isEnabled(), 'client: Finish reviewing turns on once every part has an answer');
    await inS(t.page, '#finishBtn').click();
    await sleep(600);
    expect(await inS(t.page, '.sd-t h2').textContent() === 'Three habits for a calmer week', 'client: Finish opens the next waiting post');
    expect(t.errors.length === 0, 'client: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();

    // the help button, dark, 1280 wide
    console.log('--- client link, help video, dark, 1280 ---');
    t = await openClient(browser, origin, { flags: 'on', dark: true, width: 1280, height: 800, help: 'https://media.fixture.test/help.mp4' });
    await waitNew(t);
    expect(await inS(t.page, '#rsHelp').isVisible(), 'help: the "?" shows when the address is set');
    expect(await host(t.page).getAttribute('data-theme') === 'dark', 'dark: the client page follows the sun/moon button');
    await shot(t, 'after-client-1280-dark');
    const hl = inS(t.page, '#rsHelp');
    expect(await hl.getAttribute('href') === '/start#review', 'help: the "?" points at the start page\'s Review side');
    expect(await hl.getAttribute('target') === '_blank' && /noopener/.test(await hl.getAttribute('rel') || ''), 'help: it opens a new tab with rel=noopener');
    const popup = t.page.waitForEvent('popup', { timeout: 5000 }).catch(() => null);
    await hl.click();
    const pop = await popup;
    expect(!!pop, 'help: clicking the "?" opens a new tab');
    if (pop) { expect(/\/start#review$/.test(pop.url()), 'help: the new tab is /start#review (' + pop.url() + ')'); await pop.close().catch(() => {}); }
    expect(await inS(t.page, '.help-ovl').count() === 0, 'help: no in-page video overlay any more');
    await inS(t.page, '#rsTheme').click();
    await sleep(300);
    expect(await host(t.page).getAttribute('data-theme') === 'light', 'theme: the sun/moon switches back to light');
    expect(t.errors.length === 0, 'help/dark: no page errors (' + t.errors.join(' | ') + ')');
    await t.ctx.close();

    if (SHOTS) {
      t = await openClient(browser, origin, { flags: 'on', dark: true });
      await waitNew(t); await shot(t, 'after-client-1440-dark'); await t.ctx.close();
      t = await openClient(browser, origin, { flags: 'off', dark: true });
      await t.page.locator('.kcard[data-cal-review-pid="rs1"]').waitFor({ timeout: 30000 }); await shot(t, 'before-client-1440-dark-is-light'); await t.ctx.close();
    }

    }
    // ---------- the SMM's Review tab ----------
    if (!only || only === 'smm') for (const flags of ['off', 'on']) {
      console.log('--- SMM Review tab, switch ' + flags + ' ---');
      const t2 = await open(browser, origin, { stage: 'smm', flags, staff: STAFF });
      await t2.page.goto(origin + '/index.html?v=calendar', { waitUntil: 'domcontentloaded' });
      await t2.page.waitForFunction(() => typeof _calSavePins === 'function' && typeof navTo === 'function', null, { timeout: 30000 });
      await t2.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} _calSavePins([name]); calState.client = name; navTo('calendar'); }, CLIENT);
      await t2.page.waitForFunction(() => typeof calState === 'object' && !calState.loading && (calState.posts || []).length > 0, null, { timeout: 30000 });
      await t2.page.evaluate(() => onCalViewChange('smmreview'));
      if (flags === 'off') {
        await t2.page.locator('.kcard[data-cal-review-pid="rs1"]').waitFor({ timeout: 30000 });
        await sleep(1200);
        expect(!(await host(t2.page).count()) || await host(t2.page).evaluate(e => e.hidden), 'SMM off: the old Review tab shows');
        await shot(t2, 'before-smm-1440-light');
      } else {
        await waitNew(t2);
        await sleep(800);
        expect(await t2.page.locator('#calView > .cal-toolbar #calNotifyClientBtn').isVisible() && !(await inS(t2.page, '.hdr').count()), 'SMM: Notify client sits in the Calendar\'s own bar, and the new page draws no second header');
        expect(/Approve to Kasper/.test(await inS(t2.page, '[data-ok="video"]').textContent()), 'SMM: the green button reads Approve to Kasper');
        await shot(t2, 'after-smm-1440-light');
        let n0 = t2.state.upserts.length;
        await inS(t2.page, '[data-ok="video"]').click();
        for (let i = 0; i < 80 && !t2.state.upserts.slice(n0).some(u => u.video_status === 'Kasper Approval'); i++) await sleep(100);
        expect(t2.state.upserts.slice(n0).some(u => u.id === 'rs1' && u.video_status === 'Kasper Approval'), 'SMM: Approve to Kasper saves the video at Kasper Approval');
        await sleep(900);
        await inS(t2.page, '.stp[data-step="caption"]').click();
        await sleep(500);
        await inS(t2.page, '.sarr[data-menu="caption"]').click();
        await shot(t2, 'after-smm-menu-1440-light');
        n0 = t2.state.upserts.length;
        await inS(t2.page, '[data-alt="client"]').click();
        for (let i = 0; i < 80 && !t2.state.upserts.slice(n0).some(u => u.caption_status === 'Client Approval'); i++) { await answerConfirm(t2.page); await sleep(100); }
        expect(t2.state.upserts.slice(n0).some(u => u.id === 'rs1' && u.caption_status === 'Client Approval'), 'SMM: Approve to client saves the caption at Client Approval');
      }
      expect(t2.errors.length === 0, 'SMM ' + flags + ': no page errors (' + t2.errors.join(' | ') + ')');
      await t2.ctx.close();
    }

    // ---------- Kasper's Review Session ----------
    if (!only || only === 'kasper') for (const who of [OTHER, STAFF]) {
      const named = who === STAFF;
      console.log('--- Kasper tab, ' + (named ? 'the staff member the switch names' : 'someone else') + ' ---');
      const t3 = await open(browser, origin, { stage: 'kasper', flags: 'on', staff: who });
      await t3.page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
      await t3.page.waitForFunction(() => typeof navTo === 'function', null, { timeout: 30000 });
      await t3.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} try { wlMergeClientsFromSheet([name]); } catch (e) {} navTo('kasper'); }, CLIENT);
      if (process.env.RS_DEBUG && named) {
        await sleep(8000);
        console.log(await t3.page.evaluate(() => ({ id: (typeof _syncviewStaffIdentityForHeaders === 'function') ? JSON.stringify(_syncviewStaffIdentityForHeaders()) : 'nofn', body: !!document.getElementById('kasperReviewBody'), html: document.documentElement.className, items: (typeof _kasperState === 'object') ? (_kasperState.items || []).length : -1, tab: typeof _kasperState === 'object' ? _kasperState.tab : '', txt: (document.getElementById('kasperReviewBody') || {}).innerText })));
      }
      if (!named) {
        await t3.page.locator('#kasperReviewBody').waitFor({ timeout: 30000 });
        await sleep(2500);
        expect(!(await host(t3.page).count()) || await host(t3.page).evaluate(e => e.hidden), 'Kasper, not named: the old Review Session shows');
        await shot(t3, 'before-kasper-1440-light');
      } else {
        await waitNew(t3);
        await sleep(800);
        if (process.env.RS_DEBUG) console.log(await t3.page.evaluate(() => { const out = []; let e = document.getElementById('svReviewStage'); while (e && e !== document.body) { const cs = getComputedStyle(e); out.push((e.id ? '#' + e.id : '') + '.' + String(e.className).split(' ').join('.') + ' w=' + e.offsetWidth + ' max=' + cs.maxWidth + ' pad=' + cs.paddingLeft + ' top=' + Math.round(e.getBoundingClientRect().top)); e = e.parentElement; } return out.join('\n'); }));
        // The strip heads with his list button, the count of what is left to review as its badge (session Curtain Seven).
        const sk = await inS(t3.page, '#qBtn').getAttribute('aria-label');
        expect(/\d+ to review/.test(sk || ''), 'Kasper: his strip heads with what is left to review (' + sk + ')');
        expect(await inS(t3.page, '[data-frame="video"]').isVisible(), 'Kasper: Tweaks are on Frame sits on the video');
        await shot(t3, 'after-kasper-1440-light');
        let n0 = t3.state.upserts.length;
        const g0 = t3.state.gateway.length;
        await inS(t3.page, '[data-frame="video"]').click();
        for (let i = 0; i < 80 && !t3.state.upserts.slice(n0).some(u => u.video_status === 'Tweaks Needed'); i++) { await answerConfirm(t3.page); await sleep(100); }
        const fr = t3.state.upserts.slice(n0).find(u => u.video_status === 'Tweaks Needed');
        const sentFrame = (!!fr && /Tweaks are on Frame/.test(String(fr.video_tweaks || ''))) || t3.state.gateway.some(b => /Tweaks are on Frame/.test(b));
        expect(sentFrame, 'Kasper: Tweaks are on Frame sends the change with that message through his change request');
        await sleep(900);
        n0 = t3.state.upserts.length;
        // Sending the video back answers it; approve the still-waiting caption next (Pocket, 2026-10-18).
        await inS(t3.page, '.stp[data-step="caption"]').click();
        await sleep(400);
        const step = await inS(t3.page, '.stp.on').getAttribute('data-step');
        await inS(t3.page, '[data-ok="' + step + '"]').click();
        for (let i = 0; i < 80 && !t3.state.upserts.slice(n0).some(u => u[step + '_status'] === 'Client Approval'); i++) { await answerConfirm(t3.page); await sleep(100); }
        expect(t3.state.upserts.slice(n0).some(u => u[step + '_status'] === 'Client Approval'), 'Kasper: Approve saves the ' + step + ' on to the client');
      }
      expect(t3.errors.length === 0, 'Kasper ' + (named ? 'named' : 'other') + ': no page errors (' + t3.errors.join(' | ') + ')');
      await t3.ctx.close();
    }

    // screenshots only: SMM and Kasper in dark, before and after
    if (SHOTS && (!only || only === 'shots')) {
      for (const flags of ['off', 'on']) {
        const t2 = await open(browser, origin, { stage: 'smm', flags, staff: STAFF, dark: true });
        await t2.page.goto(origin + '/index.html?v=calendar', { waitUntil: 'domcontentloaded' });
        await t2.page.waitForFunction(() => typeof _calSavePins === 'function' && typeof navTo === 'function', null, { timeout: 30000 });
        await t2.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} _calSavePins([name]); calState.client = name; navTo('calendar'); }, CLIENT);
        await t2.page.waitForFunction(() => typeof calState === 'object' && !calState.loading && (calState.posts || []).length > 0, null, { timeout: 30000 });
        await t2.page.evaluate(() => onCalViewChange('smmreview'));
        if (flags === 'on') await waitNew(t2); else await t2.page.locator('.kcard[data-cal-review-pid="rs1"]').waitFor({ timeout: 30000 });
        await shot(t2, (flags === 'on' ? 'after' : 'before') + '-smm-1440-dark');
        await t2.ctx.close();
        const t3 = await open(browser, origin, { stage: 'kasper', flags: 'on', staff: flags === 'on' ? STAFF : OTHER, dark: true });
        await t3.page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
        await t3.page.waitForFunction(() => typeof navTo === 'function', null, { timeout: 30000 });
        await t3.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} try { wlMergeClientsFromSheet([name]); } catch (e) {} navTo('kasper'); }, CLIENT);
        if (flags === 'on') await waitNew(t3); else { await t3.page.locator('#kasperReviewBody').waitFor({ timeout: 30000 }); await sleep(2500); }
        await shot(t3, (flags === 'on' ? 'after' : 'before') + '-kasper-1440-dark');
        await t3.ctx.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\nreview-stage-browser: ' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nreview-stage-browser: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
