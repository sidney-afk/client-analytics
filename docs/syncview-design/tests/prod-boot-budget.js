'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const {
  root,
  serveStatic,
  isWriteLikeRequest,
  installProductionInit,
  openProduction,
  formatFailures,
} = require('./prod-test-utils');

const READY_BUDGET_MS = Number(process.env.PROD_BOOT_READY_BUDGET_MS || 6000);
const DCL_BUDGET_MS = Number(process.env.PROD_BOOT_DCL_BUDGET_MS || 3500);

(async () => {
  const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const sourceFailures = [];
  if (!source.includes("q.get('prod') === '1') target = 'production'")) {
    sourceFailures.push('?prod=1 is not routed to the Production boot target');
  }
  if (!source.includes('html[data-boot-nav="production"] .boot-skeleton-production')) {
    sourceFailures.push('Production boot skeleton selector is missing');
  }
  if (!source.includes('boot-skeleton-variant boot-skeleton-production')) {
    sourceFailures.push('Production boot skeleton markup is missing');
  }
  if (sourceFailures.length) throw new Error(formatFailures('prod-boot-budget source failures', sourceFailures));

  const server = await serveStatic();
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errors = [];
  const requests = [];
  const failedRequests = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('request', req => requests.push(req));
  page.on('requestfailed', req => failedRequests.push(req.url()));
  await installProductionInit(page);

  try {
    const started = Date.now();
    await openProduction(page, port, '/?prod=1', { allowSkeleton: true });
    const readyMs = Date.now() - started;
    const nav = await page.evaluate(() => {
      const n = performance.getEntriesByType('navigation')[0];
      return n ? {
        domContentLoaded: Math.round(n.domContentLoadedEventEnd),
        load: Math.round(n.loadEventEnd),
        transferSize: Math.round((performance.getEntriesByType('resource') || []).reduce((sum, r) => sum + (r.transferSize || 0), 0)),
      } : null;
    });
    const state = await page.evaluate(() => {
      const visibleBox = node => {
        const r = node.getBoundingClientRect();
        const cs = getComputedStyle(node);
        return r.width > 1 && r.height > 1 && cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
      };
      return {
        bootMarks: window.__prodBootMarks || [],
        prodRoot: !!document.querySelector('#prodRoot .prod-view, #prodRoot.prod-view'),
        prodVisible: !![...document.querySelectorAll('.boot-skeleton-production, #prodRoot .prod-view, #prodRoot.prod-view')].find(visibleBox),
        analyticsVisible: !![...document.querySelectorAll('.analytics-overview-skeleton, .boot-skeleton-analytics')].find(visibleBox),
        productionSkeletonInRoot: !!document.querySelector('#prodRoot .boot-skeleton-production'),
        analyticsSkeletonInRoot: !!document.querySelector('#prodRoot .analytics-overview-skeleton, #prodRoot .boot-skeleton-analytics'),
        htmlBoot: document.documentElement.getAttribute('data-boot-nav') || '',
      };
    });

    const failures = [];
    if (readyMs > READY_BUDGET_MS) failures.push(`Production ready time ${readyMs}ms exceeded ${READY_BUDGET_MS}ms`);
    if (nav && nav.domContentLoaded > DCL_BUDGET_MS) failures.push(`DOMContentLoaded ${nav.domContentLoaded}ms exceeded ${DCL_BUDGET_MS}ms`);
    if (!state.prodRoot) failures.push('Production root did not mount');
    if (state.analyticsVisible) failures.push('Analytics skeleton was visible while opening ?prod=1');
    if (state.analyticsSkeletonInRoot) failures.push('Analytics skeleton markup leaked into the mounted Production root');
    if (!state.prodVisible) failures.push('Production skeleton/root never became visible');
    const writes = requests.filter(isWriteLikeRequest);
    if (writes.length) failures.push('Write-like requests during boot: ' + writes.slice(0, 5).map(r => `${r.method()} ${r.url()}`).join(' | '));
    if (failedRequests.length) failures.push('Failed requests during boot: ' + failedRequests.slice(0, 5).join(' | '));
    if (errors.length) failures.push('Console/page errors during boot: ' + errors.slice(0, 5).join(' | '));
    if (failures.length) throw new Error(formatFailures('prod-boot-budget failures', failures));
    console.log(`prod-boot-budget: ready=${readyMs}ms dcl=${nav ? nav.domContentLoaded : 'n/a'}ms, Production boot source, visible root, and no Analytics skeleton leak passed`);
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
})().catch(err => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
