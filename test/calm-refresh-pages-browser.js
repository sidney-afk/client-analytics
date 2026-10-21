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
      // A control removed ahead of the focused one: the focused node must stay
      // the same person's (matched by id, not by position).
      let keyed = null;
      const body0 = document.getElementById('wlBody');
      for (const el of body0.querySelectorAll('[data-wl-assignee-id]')) {
        const card = el.closest('.workload-day-card');
        if (!card || el !== card.querySelector('[data-wl-assignee-id]')) continue;
        const sibs = [...card.parentElement.children].filter(c => c.classList.contains('workload-day-card'));
        if (sibs.length >= 2 && sibs[1] === card) { keyed = { el, first: sibs[0] }; break; }
      }
      let order = null;
      if (keyed) {
        const focusTarget = keyed.el.matches('button,a,[tabindex]') ? keyed.el : (keyed.el.querySelector('button,a,[tabindex]') || keyed.el);
        if (!focusTarget.hasAttribute('tabindex') && !focusTarget.matches('button,a')) focusTarget.setAttribute('tabindex', '0');
        focusTarget.focus();
        const focusedBefore = document.activeElement === focusTarget;
        const id = keyed.el.getAttribute('data-wl-assignee-id');
        const t = document.createElement('template');
        t.innerHTML = body0.innerHTML;
        const path = []; for (let n = keyed.first; n && n !== body0; n = n.parentElement) path.unshift([...n.parentElement.children].indexOf(n));
        let g = t.content; for (const i of path) g = g.children[i];
        g.remove();
        svCalmHtml(body0, t.innerHTML);
        order = { focusedBefore, tag: focusTarget.tagName, sameNode: document.activeElement === focusTarget, sameIssue: document.activeElement.getAttribute('data-wl-assignee-id') === id };
      }
      renderWorkloadAll();
      // Two retained cards swap places: focus stays on the focused control.
      let swap = null;
      {
        const cards = [...body0.querySelectorAll('.workload-day-card')];
        const day = cards.length >= 2 && cards[0].parentElement === cards[1].parentElement ? cards[0].parentElement : null;
        const btn = day && cards[0].querySelector('button');
        if (btn) {
          btn.focus();
          const t2 = document.createElement('template');
          t2.innerHTML = body0.innerHTML;
          const path2 = []; for (let n = cards[0]; n && n !== body0; n = n.parentElement) path2.unshift([...n.parentElement.children].indexOf(n));
          let g2 = t2.content; for (const i of path2) g2 = g2.children[i];
          g2.parentElement.insertBefore(g2.nextElementSibling, g2);
          svCalmHtml(body0, t2.innerHTML);
          swap = { moved: [...day.children].indexOf(cards[0]) > [...day.children].indexOf(cards[1]), focus: document.activeElement === btn };
        }
      }
      // An opened section stays open, and a retained date input follows a changed value.
      let keep = null;
      {
        const det = body0.querySelector('details');
        if (det) {
          det.open = true;
          const html = body0.innerHTML.replace(/(<details[^>]*?) open(=""|)(?=[ >])/g, '$1');
          svCalmHtml(body0, html);
          keep = { open: det.open };
        }
        const inp = body0.querySelector('input[type=date]');
        if (inp) {
          inp.value = '2030-01-01';
          const html2 = body0.innerHTML.replace(/(<input[^>]*type="date"[^>]*?) value="[^"]*"/, '$1 value="2031-02-03"');
          svCalmHtml(body0, html2);
          keep = Object.assign(keep || {}, { date: inp.value });
        }
      }
      document.getElementById('wlBody').innerHTML = '';
      renderWorkloadAll();
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
      return { total, kept, order, swap, keep, same: patched === fresh };
    });
    const label = calm ? 'calm' : 'classic';
    ok(r.total > 100, label + ' Workload has a real board (' + r.total + ' nodes)');
    ok(r.kept === r.total, label + ' Workload: an unchanged refresh keeps every node (' + r.kept + ' of ' + r.total + ')');
    ok(r.order && r.order.sameNode && r.order.sameIssue, label + ' Workload: a control removed ahead of the focused one leaves focus on the same person (' + JSON.stringify(r.order) + ')');
    ok(r.swap && r.swap.moved && r.swap.focus, label + ' Workload: two cards that swap places keep focus on the control (' + JSON.stringify(r.swap) + ')');
    ok(!r.keep || ((r.keep.open === undefined || r.keep.open === true) && (r.keep.date === undefined || r.keep.date === '2031-02-03')), label + ' Workload: an opened section stays open and a changed date reaches the input (' + JSON.stringify(r.keep) + ')');
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
