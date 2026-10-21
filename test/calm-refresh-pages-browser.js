'use strict';
// A background refresh must not rebuild Workload or Production when nothing
// changed, and a refresh that does change something must leave the page
// exactly as a fresh drawing would. Fully offline: every backend call is
// answered by a local fixture (fictional client, issues and staff members).
require('./helpers/single-file-index.js');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const F = require('../docs/syncview-design/tests/workload-calm-fixture.js');
const U = require('../docs/syncview-design/tests/prod-test-utils');

let checks = 0;
function ok(cond, msg) { assert.ok(cond, 'CALM_PAGES ' + msg); checks++; }

async function workload(calm) {
  const h = await F.launchCalmBoard({ calm });
  try {
    const p = h.page;
    await p.waitForTimeout(900);
    const r = await p.evaluate(async () => {
      const sel = '.workload-view *';
      document.querySelectorAll(sel).forEach(e => { e.__m = 1; });
      const total = document.querySelectorAll(sel).length;
      renderWorkloadAll();
      await new Promise(res => setTimeout(res, 300));
      const kept = [...document.querySelectorAll(sel)].filter(e => e.__m).length;
      // A real change: the board must equal a fresh drawing of the same state.
      wlState.team = 'video';
      renderWorkloadAll();
      const body = document.getElementById('wlBody');
      const strip = el => el.innerHTML.replace(/\s+/g, ' ');
      const patched = strip(body) + '|' + strip(document.getElementById('wlOverviewRows'));
      body.innerHTML = '';
      document.getElementById('wlOverviewRows').innerHTML = '';
      renderWorkloadAll();
      const fresh = strip(body) + '|' + strip(document.getElementById('wlOverviewRows'));
      return { total, kept, same: patched === fresh };
    });
    const label = calm ? 'calm' : 'classic';
    ok(r.total > 100, label + ' Workload has a real board (' + r.total + ' nodes)');
    ok(r.kept === r.total, label + ' Workload: an unchanged refresh keeps every node (' + r.kept + ' of ' + r.total + ')');
    ok(r.same, label + ' Workload: a refresh that changes something equals a fresh drawing');
  } finally { await h.close(); }
}

async function production() {
  const server = await U.serveStatic();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
    await U.installProductionInit(page);
    await U.openProduction(page, server.address().port, '/?prod=1', { allowSkeleton: true });
    await page.waitForTimeout(2500);
    const r = await page.evaluate(async () => {
      _prodRender();
      await new Promise(res => setTimeout(res, 300));
      const sel = '#prodRoot *';
      document.querySelectorAll(sel).forEach(e => { e.__m = 1; });
      const total = document.querySelectorAll(sel).length;
      const list = document.querySelector('.prod-listwrap');
      if (list) list.scrollTop = 200;
      const btn = document.querySelector('#prodRoot button.prod-search-btn') || document.querySelector('#prodRoot button');
      btn.focus();
      _prodRender();
      await new Promise(res => setTimeout(res, 300));
      return {
        total,
        kept: [...document.querySelectorAll(sel)].filter(e => e.__m).length,
        scroll: document.querySelector('.prod-listwrap') ? document.querySelector('.prod-listwrap').scrollTop : -1,
        focusKept: document.activeElement === btn,
      };
    });
    ok(r.total > 100, 'Production has a real list (' + r.total + ' nodes)');
    ok(r.kept === r.total, 'Production: an unchanged refresh keeps every node (' + r.kept + ' of ' + r.total + ')');
    ok(r.scroll === 200, 'Production: the list stays where it was scrolled (' + r.scroll + ')');
    ok(r.focusKept, 'Production: the focused button stays focused');
  } finally { await browser.close(); server.close(); }
}

(async () => {
  await workload(true);
  await workload(false);
  await production();
  console.log('calm-refresh-pages-browser: all ' + checks + ' checks passed');
  process.exit(0);
})().catch(e => { console.error(e.message || e); process.exit(1); });
