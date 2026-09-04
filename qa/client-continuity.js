'use strict';
// Uses the existing fictional, intercepted full-document boot harness. No live
// mode: unrecognised requests abort in that harness; no screenshots/raw logs.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const H = require('./boot/client-entry-sequence');
const { assessRead } = require('../scripts/client-continuity-monitor');

async function main() {
  const server = await H.startStreamServer();
  const browser = await chromium.launch({ headless: true });
  let passed = 0;
  try {
    await H.runClientTabScenario(browser, server, 'calendar'); passed++;
    await H.runLegacySamplesScenario(browser, server); passed++;
    // Real Samples renderer, retained content and cold failure. The network is
    // wholly intercepted; the detector receives observations, not copied UI code.
    for (const cached of [true, false]) {
      const run = await H.openCase(browser, server);
      try {
        const query = new URLSearchParams({ c: 'Boot Fixture Client', v: 'samples', t: 'synthetic-current-token' });
        await H.streamedNavigation(run.page, server,
          () => run.page.goto(`${server.origin}/index.html?${query}`, { waitUntil: 'load', timeout: 15000 }), 'static:client-verify');
        await H.waitForReviewSettled(run.page);
        await run.context.route('**/rest/v1/sample_reviews?**', route => route.fulfill({ status: 500, body: '{}' }));
        await run.context.route('**/webhook/sample-review-get?**', route => route.fulfill({ status: 200, body: 'malformed' }));
        const observed = await run.page.evaluate(async cached => {
          if (!cached) sxrState.posts = [];
          await loadSxrCards({ skipCache: true, background: cached });
          const el = document.getElementById('sxrStaleNotice');
          const visible = node => !!node && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
          const retainedVisible = [...document.querySelectorAll('#sxrView .kcard-title')].some(node => visible(node) && node.textContent.includes('Synthetic review card A'));
          return { version: 1, correlated: true, settled: !sxrState.loading, outcome: 'failure',
            display: sxrState.posts.length ? 'content' : sxrState.error ? 'error' : 'empty',
            renderedCount: sxrState.posts.length, warningVisible: visible(el), retainedVisible,
            retryVisible: !!document.querySelector('#sxrView button'), verifiedAt: 0 };
        }, cached);
        assert.equal(assessRead('samples', observed).code, 'read_failed');
        assert.equal(observed.display, cached ? 'content' : 'error');
        if (cached) assert.equal(observed.retainedVisible, true);
        if (cached) assert.equal(assessRead('samples', { ...observed, warningVisible: false }).code, 'stale_unwarned');
        assert.equal(run.network.unmocked.length, 0);
        passed++;
      } finally { await run.context.close(); }
    }
    for (const lane of ['calendar', 'samples']) {
      for (const status of [401, 403]) {
        const run = await H.openCase(browser, server, { network: { verifierPlan: [{ status }] } });
        try {
          const view = lane === 'calendar' ? 'calendar' : 'samples';
          const query = new URLSearchParams({ c: 'Boot Fixture Client', v: view, t: 'synthetic-current-token' });
          await H.streamedNavigation(run.page, server,
            () => run.page.goto(`${server.origin}/index.html?${query}`, { waitUntil: 'load', timeout: 15000 }), 'static:client-verify');
          const deadline = Date.now() + 10000;
          while (!run.network.verifierResponses.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
          assert.equal(run.network.verifierResponses[0].status, status);
          assert.equal(assessRead(lane, { validLink: true, authStatus: status }).code, 'valid_link_auth');
          assert.equal(run.network.calendarReads.length + run.network.sampleReads.length, 0);
          assert.equal(run.network.unmocked.length, 0);
          passed++;
        } finally { await run.context.close(); }
      }
    }
    console.log(JSON.stringify({ suite: 'client_continuity_browser', passed, live: false }));
  } finally { await browser.close(); await server.close(); }
}
if (require.main === module) main().catch(() => { console.error('client_continuity_browser_failed'); process.exitCode = 1; });
module.exports = { main };
