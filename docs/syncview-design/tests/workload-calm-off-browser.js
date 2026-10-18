'use strict';

/*
 * THE OLD WORKLOAD CALENDAR STAYS BYTE-FOR-BYTE THE SAME FOR EVERYONE THE SWITCH DOES NOT NAME.
 *
 * The Calm view (session Calm, 2026-10-18) is behind the runtime switch row `workload_calm_staff`
 * { "staff": [...] }. This suite boots the real page on the shared fictional board under every way the
 * switch can fail to name the signed-in member (row missing, wrong shape, someone else listed, read refused)
 * and compares the Workload DOM against `golden/workload-calm-off.json`, which was captured from the page
 * as it was BEFORE the Calm view existed. A difference fails the run; so does any trace of the Calm view.
 *
 *   node docs/syncview-design/tests/workload-calm-off-browser.js            compare
 *   node docs/syncview-design/tests/workload-calm-off-browser.js --write    (re)capture the golden (never from a Calm build)
 */

const fs = require('fs');
const path = require('path');
const F = require('./workload-calm-fixture.js');

const GOLDEN = path.join(__dirname, 'golden', 'workload-calm-off.json');
const WRITE = process.argv.includes('--write');
const { WED } = F;

let checks = 0;
function expect(ok, message) {
  if (!ok) throw new Error('WORKLOAD_CALM_OFF ' + message);
  checks++;
}

const SCENARIOS = [
  { name: 'row missing', options: {} },
  { name: 'row with a wrong shape (list)', options: { flagRows: [{ key: 'workload_calm_staff', value: ['qa_staff'] }] } },
  { name: 'row with a wrong shape (staff is a string)', options: { flagRows: [{ key: 'workload_calm_staff', value: { staff: 'qa_staff' } }] } },
  { name: 'row naming someone else', options: { flagRows: [{ key: 'workload_calm_staff', value: { staff: ['someone-else'] } }] } },
  { name: 'empty list', options: { flagRows: [{ key: 'workload_calm_staff', value: { staff: [] } }] } },
  { name: 'switch read refused (500)', options: { flagResponse: { status: 500, body: { error: 'x' } } } },
  { name: 'switch read answers a non-list', options: { flagResponse: { status: 200, body: { nope: true } } } },
];

// Whether a long note was marked expandable depends on when the browser measured it (a loaded machine measures
// later), which is not the page's markup: both sides are compared without that mark.
const unclamp = html => html.replace(/ is-clamped/g, '').replace(/( onkeydown="wlOnTweakCommentKey\(event,this\)") role="button" tabindex="0"( aria-expanded="(?:true|false)")?/g, '$1');

/* Everything an old-view user can see or open on this board, as markup. */
async function capture(h) {
  const page = h.page;
  const out = {};
  const view = async () => page.evaluate(() => document.querySelector('.workload-view').outerHTML);
  const pop = async () => page.evaluate(() => { const p = document.getElementById('wlPopover'); return p.className + '|' + p.innerHTML; });
  await page.waitForTimeout(900);
  out.week = await view();
  await page.locator(`summary[data-wl-date="${WED}"][data-wl-client="Client A"]`).first().click();
  await page.waitForTimeout(200);
  out.pillOpen = await view();
  await page.locator(`.workload-day[data-wl-day="${WED}"] .workload-plan-item`).first().click();
  await page.waitForTimeout(300);
  out.videoPopover = await pop();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await page.locator('.workload-overview-status.is-tweaks [data-wl-source="tweaks"][data-wl-client="Client A"]').first().click();
  await page.waitForTimeout(900);
  out.tweaksPopover = await pop();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await page.evaluate(() => document.querySelector('[data-wl-view="month"]').click());
  await page.waitForTimeout(300);
  out.month = await view();
  return out;
}

(async () => {
  const results = [];
  for (const scenario of SCENARIOS) {
    const h = await F.launchCalmBoard(scenario.options);
    try {
      results.push({ scenario, got: await capture(h), calmNodes: await h.page.evaluate(() => document.querySelectorAll('.wl-calm, [data-wl-calm-view-btn], [data-wl-calm-toggle], #wlCalmViewMenu').length), errors: h.state.pageErrors });
    } finally { await h.close(); }
  }
  if (WRITE) {
    fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
    fs.writeFileSync(GOLDEN, JSON.stringify(results[0].got, null, 1) + '\n');
    console.log('golden written from "' + results[0].scenario.name + '"');
    return;
  }
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  for (const { scenario, got, calmNodes, errors } of results) {
    console.log('--- ' + scenario.name);
    expect(errors.length === 0, scenario.name + ': page errors ' + errors[0]);
    expect(calmNodes === 0, scenario.name + ': the Calm view left a trace on an unlisted page');
    for (const key of Object.keys(golden)) {
      const same = unclamp(got[key]) === unclamp(golden[key]);
      got[key] = unclamp(got[key]); golden[key] = unclamp(golden[key]);
      if (!same) {
        let i = 0; while (i < got[key].length && got[key][i] === golden[key][i]) i++;
        throw new Error('WORKLOAD_CALM_OFF ' + scenario.name + ': "' + key + '" differs from the old page at byte ' + i
          + '\n  golden: ...' + golden[key].slice(Math.max(0, i - 80), i + 120) + '\n  got:    ...' + got[key].slice(Math.max(0, i - 80), i + 120));
      }
      checks++;
    }
  }
  console.log('workload-calm-off-browser: all ' + checks + ' checks passed');
})().catch(e => { console.error(e.message || e); process.exit(1); });
