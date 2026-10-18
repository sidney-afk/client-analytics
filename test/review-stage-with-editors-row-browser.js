'use strict';
/*
 * OWNER REQUEST OF 2026-10-18 (session Tidy). Real browser, fully offline, the shared mocked backend of
 * review-stage-browser.js (fictional client, cards and people).
 *
 * Kasper's Review Session, the rows of "With the editors" (the list panel and the strip chips):
 *   1. the first line is "Client · Title" on one line, never wrapped (an ellipsis when too long); the client is in
 *      the normal text colour;
 *   2. the second line is only the day the tweak went to the editors: Today, Yesterday, the weekday within the last
 *      week, otherwise "29 Sept" (no year), and the year only when it is not this year;
 *   3. the second line is the muted grey of secondary text, not orange;
 *   4. Ping editor is still on the row;
 *   5. the other sections (Waiting for your review) are NOT changed: title first line, client on the small line.
 * Desktop 1440 and phone 390, light and dark.
 * WITH_EDITORS_SHOTS=<dir> also writes screenshots (used for the PR, fictional data only).
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { CLIENT, STAFF, open, waitNew, inS, sleep } = require('./fixtures/review-stage-fixture.js');

const SHOTS = process.env.WITH_EDITORS_SHOTS || '';
const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }
async function shot(t, name) { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); await sleep(400); await t.page.screenshot({ path: path.join(SHOTS, name + '.png') }); }

// Age in days -> the wording the owner asked for, worked out here on its own (not by the page's code).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(12, 0, 0, 0); return d; }
function wording(n) {
  const d = daysAgo(n);
  if (n === 0) return 'Today';
  if (n === 1) return 'Yesterday';
  if (n < 7) return WEEKDAYS[d.getDay()];
  return d.getDate() + ' ' + MONTHS[d.getMonth()] + (d.getFullYear() === new Date().getFullYear() ? '' : ' ' + d.getFullYear());
}
// post id -> how many days ago the tweak went to the editors
const AGES = { rs4: 0, rs5: 1, rs6: 3, rs7: 20, rs2: 400 };

async function openKasper(browser, origin, o) {
  const t = await open(browser, origin, Object.assign({ stage: 'kasper', flags: 'on', staff: STAFF, expectNew: true }, o));
  await t.page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
  await t.page.waitForFunction(() => typeof navTo === 'function', null, { timeout: 30000 });
  await t.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} try { wlMergeClientsFromSheet([name]); } catch (e) {} navTo('kasper'); }, CLIENT);
  await waitNew(t);
  await sleep(1500);
  return t;
}
// What the rows say and look like (the new page's shadow root).
function rows(page, where) {
  return page.evaluate((where) => {
    const r = document.getElementById('svReviewStage').shadowRoot;
    const probe = (v) => { const e = document.createElement('i'); e.style.color = 'var(' + v + ')'; r.appendChild(e); const c = getComputedStyle(e).color; e.remove(); return c; };
    const sel = where === 'panel' ? '#qPanel .qp-row' : '#skList .chipp.k';
    const out = {};
    r.querySelectorAll(sel).forEach(b => {
      const cn = b.querySelector('.cn'), ck = b.querySelector('.cn .ck'), cm = b.querySelector('.cm');
      const lh = parseFloat(getComputedStyle(cn).lineHeight) || 16;
      out[b.dataset.qid || b.dataset.id] = {
        first: cn ? cn.textContent : '',
        second: cm ? cm.textContent.replace(/\s+/g, ' ').trim() : '',
        oneLine: cn ? cn.getBoundingClientRect().height <= lh * 1.6 : false,
        nowrap: cn ? getComputedStyle(cn).whiteSpace === 'nowrap' : false,
        clientColor: ck ? getComputedStyle(ck).color : '',
        secondColor: cm ? getComputedStyle(cm).color : '',
        ping: !!b.parentElement.querySelector('[data-qping]'),
        sec: b.closest('.qp-sec') ? b.closest('.qp-sec').querySelector('.qp-h').textContent : '',
      };
    });
    return { rows: out, orange: probe('--chg-fg'), primary: probe('--text-primary'), secondary: probe('--text-secondary') };
  }, where);
}

async function variant(browser, origin, width, height, dark) {
  const label = width + (dark ? '-dark' : '-light');
  console.log('--- Kasper, ' + width + 'x' + height + (dark ? ' dark' : ' light') + ' ---');
  const t = await openKasper(browser, origin, { width, height, dark });
  try {
    await t.page.evaluate((ages) => {
      Object.keys(ages).forEach(id => {
        const it = _kasperState.items.find(x => x.post.id === id);
        if (!it) return;
        const d = new Date(); d.setDate(d.getDate() - ages[id]); d.setHours(12, 0, 0, 0);
        it.post.video_status = 'Tweaks Needed'; it.post.graphic_status = 'Client Approval'; it.post.caption_status = 'Client Approval';
        it.post.kasper_finished_at = d.toISOString();
        it.post.linear_issue_id = ''; it.post.video_deliverable_id = 'del_' + id;
      });
      _kasperPaintReview();
    }, AGES);
    await sleep(700);
    const ids = Object.keys(AGES);

    // The list panel.
    await inS(t.page, '#qBtn').click();
    await sleep(500);
    let R = await rows(t.page, 'panel');
    ids.forEach(id => {
      const r = R.rows[id];
      if (!r) { expect(false, label + ' list: ' + id + ' is in "With the editors"'); return; }
      expect(/^Fixture Studio · /.test(r.first) && r.first.length > 'Fixture Studio · '.length, label + ' list ' + id + ': first line is "Client · Title" (' + r.first + ')');
      expect(r.oneLine && r.nowrap, label + ' list ' + id + ': the first line is one line, never wrapped');
      expect(r.second === wording(AGES[id]), label + ' list ' + id + ': second line is only the date, "' + wording(AGES[id]) + '" (' + r.second + ')');
      expect(r.secondColor !== R.orange && r.secondColor === R.secondary, label + ' list ' + id + ': the second line is the muted grey, not orange (' + r.secondColor + ' vs orange ' + R.orange + ')');
      expect(r.clientColor === R.primary, label + ' list ' + id + ': the client is in the normal text colour (' + r.clientColor + ')');
      expect(/With the editors/.test(r.sec), label + ' list ' + id + ': sits in "With the editors"');
      expect(r.ping, label + ' list ' + id + ': Ping editor is still on the row');
    });
    // Another section uses the same first line.
    const w = Object.keys(R.rows).filter(id => /Waiting for your review/.test(R.rows[id].sec));
    expect(w.length > 0 && w.every(id => !/Fixture Studio/.test(R.rows[id].first) && R.rows[id].second.indexOf('Fixture Studio') === 0), label + ' list: "Waiting for your review" rows are unchanged (title first, client on the small line; ' + w.length + ' rows)');
    await shot(t, label + '-list');
    await t.page.keyboard.press('Escape');
    await sleep(300);

    // The strip chips.
    await inS(t.page, '#edTog').click().catch(() => null);
    await sleep(500);
    R = await rows(t.page, 'strip');
    ids.forEach(id => {
      const r = R.rows[id];
      if (!r) { expect(false, label + ' strip: ' + id + ' chip is shown'); return; }
      expect(/^Fixture Studio · /.test(r.first) && r.oneLine, label + ' strip ' + id + ': first line is "Client · Title" on one line (' + r.first + ')');
      expect(r.second === wording(AGES[id]), label + ' strip ' + id + ': second line is only the date (' + r.second + ')');
      expect(r.secondColor !== R.orange, label + ' strip ' + id + ': the second line is not orange');
    });
    const sw = Object.keys(R.rows).filter(id => ids.indexOf(id) < 0);
    expect(sw.length > 0 && sw.every(id => !/Fixture Studio/.test(R.rows[id].first) && R.rows[id].second.indexOf('Fixture Studio') === 0), label + ' strip: the other chips (waiting for review) are unchanged, title first and the client on the small line (' + sw.length + ' chips)');
    await shot(t, label + '-strip');
    expect(t.errors.length === 0, label + ': no page errors (' + t.errors.join(' | ') + ')');
  } catch (e) { expect(false, label + ': stopped (' + String(e && e.message || e).split('\n')[0] + ')'); }
  await t.ctx.close();
}

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    await variant(browser, origin, 1440, 900, false);
    await variant(browser, origin, 1440, 900, true);
    await variant(browser, origin, 390, 844, false);
    await variant(browser, origin, 390, 844, true);
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\nreview-stage-with-editors-row-browser: ' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nreview-stage-with-editors-row-browser: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
