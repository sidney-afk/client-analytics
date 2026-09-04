'use strict';
const { assessRead, report } = require('./client-continuity-monitor');

// Called only by a future owner-configured private launcher. No live defaults.
// `readCensus` independently checks completeness/count for the exact visible
// snapshot/filter; it must not derive its answer from the same browser cache.
async function captureView(browser, config, readCensus) {
  if (!config || config.enabled !== true || config.activation !== 'OWNER_APPROVED_VIEW_CHECKS' ||
      !['calendar', 'samples'].includes(config.lane) || typeof readCensus !== 'function') throw new Error('view_activation_required');
  let link, verifier;
  try { link = new URL(config.shareLink); verifier = new URL(config.verifierUrl); }
  catch { throw new Error('private_view_config_required'); }
  if (link.protocol !== 'https:' || verifier.protocol !== 'https:' || !link.searchParams.get('t') ||
      !link.searchParams.get('c')) throw new Error('private_view_config_required');
  let context;
  let authStatus = 0, blocked = 0;
  try {
    context = await browser.newContext({ serviceWorkers: 'block' });
    // An anonymous read journey cannot resume a write queue. Only the exact
    // configured token verifier may POST, and redirects never broaden it.
    await context.route('**/*', async route => {
      const r = route.request();
      if (!['GET', 'HEAD'].includes(r.method()) && !(r.method() === 'POST' && r.url() === verifier.href && !r.redirectedFrom())) {
        blocked++; return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('response', response => {
      const url = new URL(response.url());
      const relevant = response.url() === verifier.href || /\/(calendar_posts|sample_reviews|calendar-get|sample-review-get)$/.test(url.pathname);
      if (relevant && [401, 403].includes(response.status())) authStatus = response.status();
    });
    await page.goto(link.href, { waitUntil: 'domcontentloaded', timeout: 20000 });
    // The hook is intentionally NOT fabricated in this PR: absent instrumentation
    // must fail rather than guessing success from a spinner disappearing.
    try {
      await page.waitForFunction(lane => {
        const fn = window.__syncviewReadHealth;
        return typeof fn === 'function' && fn(lane)?.settled === true;
      }, config.lane, { timeout: 10000 });
    } catch { return authStatus ? report(config.lane, 'valid_link_auth') : report(config.lane, 'integration_missing'); }
    if (authStatus) return report(config.lane, 'valid_link_auth');
    if (blocked) return report(config.lane, 'integration_missing');
    const state = await page.evaluate(lane => window.__syncviewReadHealth(lane), config.lane);
    if (!state || typeof state.snapshot !== 'string' || !/^[a-f0-9-]{16,64}$/.test(state.snapshot)) return report(config.lane, 'integration_missing');
    const { bounded } = require('./client-continuity-monitor');
    const census = await bounded(signal => readCensus({ lane: config.lane, snapshot: state.snapshot, signal }));
    return assessRead(config.lane, { ...state, authoritativeCount: census.count,
      authorityMatched: census.complete === true && census.snapshot === state.snapshot,
      validLink: true, authStatus });
  } catch { return authStatus ? report(config.lane, 'valid_link_auth') : report(config.lane, 'read_failed'); }
  finally {
    if (context) {
      try { await context.close(); } catch { throw new Error('view_cleanup_failed'); }
    }
  }
}
module.exports = { captureView };
