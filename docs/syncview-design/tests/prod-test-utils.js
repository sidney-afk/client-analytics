'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const root = path.resolve(__dirname, '..', '..', '..');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
};

function serveStatic() {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    let p = decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname);
    p = path.normalize(p).replace(/^([.][\\/])+/, '');
    const full = path.join(root, p);
    if (!full.startsWith(root) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mime[path.extname(full).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(full).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function isWriteLikeRequest(req) {
  const method = typeof req.method === 'function' ? req.method() : req.method;
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return false;
  const url = typeof req.url === 'function' ? req.url() : req.url;
  return /supabase|n8n|webhook|syncview|rest\/v1|functions\/v1/i.test(url || '');
}

async function installProductionInit(page) {
  await page.addInitScript(() => {
    localStorage.setItem('syncview_auth_v1', 'ok');
    window.__prodBootMarks = [];
    const record = () => {
      try {
        window.__prodBootMarks.push({
          t: Math.round(performance.now()),
          boot: document.documentElement.getAttribute('data-boot-nav') || '',
          theme: document.documentElement.getAttribute('data-theme') || '',
        });
      } catch (_) {}
    };
    record();
    try {
      new MutationObserver(record).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-boot-nav', 'data-theme'],
      });
    } catch (_) {}
    try {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async text => { window.__prodCopied = text; } },
      });
    } catch (_) {}
  });
}

async function openProduction(page, port, pathSuffix = '/?prod=1', opts = {}) {
  const url = `http://127.0.0.1:${port}${pathSuffix}`;
  const contentSelector = opts.allowSkeleton
    ? '.prod-row, .prod-empty-state, .prod-empty, .prod-board, .prod-detail, .prod-loading, .prod-loading-skeleton'
    : '.prod-row, .prod-empty-state, .prod-empty, .prod-board, .prod-detail, .prod-loading';
  const waitForContent = timeout => page.waitForSelector(contentSelector, { timeout });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.prod-view, .prod-error', { timeout: 45000 });
  if (await page.locator('.prod-error').count()) {
    const msg = (await page.locator('.prod-error').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    throw new Error('Production preview rendered an error card: ' + msg);
  }
  try {
    await waitForContent(45000);
  } catch (firstErr) {
    const state = await page.evaluate(() => ({
      href: location.href,
      boot: document.documentElement.getAttribute('data-boot-nav') || '',
      hasRoot: !!document.getElementById('prodRoot'),
      view: window._prodState && window._prodState.view,
      rows: document.querySelectorAll('.prod-row').length,
      empty: document.querySelectorAll('.prod-empty-state, .prod-empty').length,
      errors: document.querySelectorAll('.prod-error').length,
    })).catch(() => null);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.prod-view, .prod-error', { timeout: 45000 });
    if (await page.locator('.prod-error').count()) {
      const msg = (await page.locator('.prod-error').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
      throw new Error('Production preview rendered an error card after retry: ' + msg);
    }
    try {
      await waitForContent(60000);
    } catch (secondErr) {
      throw new Error('Production preview shell loaded without content after retry. Before retry: '
        + JSON.stringify(state) + '. Last error: ' + secondErr.message);
    }
  }
}

function formatFailures(title, failures) {
  return `${title}:\n` + failures.map(f => `  - ${f}`).join('\n');
}

function installReadConsoleAudit(page, opts = {}) {
  const pageErrors = [];
  const consoleErrors = [];
  const readOutcomes = new Map();
  const mainFrameNavigations = [];
  const requestStartedAt = new WeakMap();
  const outstandingReads = new Set();
  const recoveryWindowMs = Math.max(1000, Number(opts.recoveryWindowMs || 15000));
  const navigationAbortWindowMs = Math.max(100, Number(opts.navigationAbortWindowMs || 1000));
  const revalidationTimeoutMs = Math.max(1000, Number(opts.revalidationTimeoutMs || 20000));
  const drainCeilingMs = Math.max(2000, Number(opts.drainCeilingMs || 30000));
  // Counts reads that reached an outcome, so the drain can tell a chain that is
  // still advancing from one that has stopped.
  let completedReads = 0;

  const recordReadOutcome = (request, outcome) => {
    if (!request || !['GET', 'HEAD'].includes(request.method())) return;
    const key = `${request.method()} ${request.url()}`;
    const outcomes = readOutcomes.get(key) || [];
    const at = Date.now();
    outcomes.push({ outcome, at, startedAt: requestStartedAt.get(request) || at });
    readOutcomes.set(key, outcomes);
  };
  const isNetworkFailure = value => typeof value === 'string' && value.startsWith('network-error');
  const failed = value => isNetworkFailure(value) || value >= 400;
  const eligibleForRecovery = value => isNetworkFailure(value) || value === 429 || value >= 500;
  const succeeded = value => (typeof value === 'number' && value >= 200 && value < 300) || value === 304;
  const isNavigationAbort = value => value === 'network-error:net::ERR_ABORTED';
  const describeRead = ([key, outcomes]) => {
    const rawUrl = key.replace(/^[A-Z]+ /, '');
    let host = 'unparseable';
    let path = '';
    let queryKeys = [];
    try {
      const url = new URL(rawUrl);
      host = url.hostname;
      path = /supabase\.co$/i.test(url.hostname) ? url.pathname : '';
      queryKeys = [...url.searchParams.keys()];
    } catch (_) {}
    return {
      host,
      path,
      queryKeys,
      outcomes: outcomes.map(item => item.outcome),
    };
  };

  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const location = message.location && message.location();
    consoleErrors.push({
      message: message.text(),
      url: location && location.url ? location.url : '',
      at: Date.now(),
    });
  });
  page.on('response', response => recordReadOutcome(response.request(), response.status()));
  page.on('request', request => {
    requestStartedAt.set(request, Date.now());
    if (['GET', 'HEAD'].includes(request.method())) outstandingReads.add(request);
    try {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
        mainFrameNavigations.push({ startedAt: Date.now(), committedAt: null });
      }
    } catch (_) {}
  });
  page.on('framenavigated', frame => {
    if (frame !== page.mainFrame()) return;
    const pending = [...mainFrameNavigations].reverse().find(item => item.committedAt === null);
    if (pending) pending.committedAt = Date.now();
  });
  page.on('requestfailed', request => {
    const errorText = request.failure() && request.failure().errorText;
    const networkCode = String(errorText || '').match(/net::[A-Z_]+/);
    recordReadOutcome(request, networkCode ? `network-error:${networkCode[0]}` : 'network-error');
    if (outstandingReads.delete(request)) completedReads++;
  });
  page.on('requestfinished', request => {
    if (outstandingReads.delete(request)) completedReads++;
  });

  const settle = async (waitMs = 2500) => {
    const waitBudgetMs = Math.max(100, Number(waitMs || 2500));
    /*
     * A CHAIN THAT IS STILL FINISHING PAGES IS NOT A HUNG READ.
     *
     * The budget used to be a flat deadline, which asks the wrong question: it
     * measures how long the suite has been waiting, not whether anything is
     * still happening. Production reads its deliverables in keyset pages, one
     * request opening as the previous one closes, and the whole chain runs
     * about five seconds against live data -- so a 2.5s deadline expires in the
     * middle of a perfectly healthy chain and calls the request in flight
     * "pending", which reads exactly like a request that hung.
     *
     * So the deadline extends on PROGRESS: every completed read buys another
     * budget, and the drain still ends the moment the reads go quiet. A read
     * that has produced nothing for a whole budget is still reported, which is
     * the property this audit exists for; the ceiling bounds the pathological
     * case where something polls forever.
     */
    const drainOutstandingReads = async () => {
      const ceiling = Date.now() + drainCeilingMs;
      let deadline = Date.now() + waitBudgetMs;
      let quietSince = null;
      let progressMark = completedReads;
      while (Date.now() < deadline && Date.now() < ceiling) {
        if (outstandingReads.size === 0) {
          quietSince = quietSince === null ? Date.now() : quietSince;
          if (Date.now() - quietSince >= 100) break;
        } else {
          quietSince = null;
          if (completedReads !== progressMark) {
            progressMark = completedReads;
            deadline = Date.now() + waitBudgetMs;
          }
        }
        await page.waitForTimeout(50);
      }
    };

    /*
     * A CACHED PAINT IS A PROMISE OF A SECOND READ, AND THE AUDIT HAS TO KEEP IT.
     *
     * Production paints from the last snapshot and revalidates in the
     * background, so rows are on screen while the live read is still running.
     * Every assertion a suite makes after that point passes in under a second,
     * the suite calls settle(), and the 2.5s drain expires with the
     * revalidation mid-flight -- reported as "pending read requests", which
     * reads exactly like a hung request and is the opposite of what happened.
     *
     * Measured 2026-08-26 against live data: cold paint 9.1s, warm paint 0.8s,
     * and eleven reads still outstanding at the warm paint, not quiet for
     * another ~5s. That is what turned `Production structure subset` red on
     * every run once the snapshot first fit in the quota, with no product
     * defect behind it.
     *
     * So wait for the revalidation the cached paint promised, THEN drain. The
     * wait is a no-op on a cold paint (cachePartial is only ever true after a
     * hydrate) and on any page without a Production tab, and it ends early on a
     * load that errored, because that page will never clear the flag.
     */
    if (typeof page.waitForFunction === 'function') {
      try {
        await page.waitForFunction(() => {
          /* `_prodState` is a top-level `const`, which lives in the global
             LEXICAL environment and is therefore never a property of `window`
             -- reading it as `window._prodState` yields undefined on every
             page and turns this wait into a no-op that looks like it works. */
          if (typeof _prodState === 'undefined' || !_prodState) return true;
          if (_prodState.error) return true;
          return !_prodState.cachePartial && !_prodState.loading;
        }, null, { timeout: revalidationTimeoutMs, polling: 100 });
      } catch (_) {}
    }

    await drainOutstandingReads();
    const hasFailedRead = outcomes => outcomes.some(item => failed(item.outcome));
    if ([...readOutcomes.values()].some(hasFailedRead)) {
      await page.waitForTimeout(waitBudgetMs);
      await drainOutstandingReads();
    }
    /* One more budget for a read that STARTED during the drain rather than
       before it -- the deferred brief load fires 6.5s after data lands, so a
       suite can settle right as it opens. Draining again costs nothing when
       there is nothing outstanding. */
    if (outstandingReads.size) await drainOutstandingReads();

    const readEntries = [...readOutcomes.entries()];
    const recoveredReads = [];
    let navigationAborts = 0;
    const persistentReadFailures = [];
    for (const [key, outcomes] of readEntries) {
      const url = key.replace(/^[A-Z]+ /, '');
      const unrecovered = outcomes.filter((item, index) => {
        if (!failed(item.outcome)) return false;
        const navigationAbort = isNavigationAbort(item.outcome) && mainFrameNavigations.some(navigation =>
          navigation.committedAt !== null
          && item.startedAt <= navigation.startedAt
          && navigation.startedAt <= item.at
          && item.at - navigation.startedAt <= navigationAbortWindowMs
          && item.at <= navigation.committedAt + 250);
        if (navigationAbort) {
          navigationAborts++;
          return false;
        }
        const recovery = eligibleForRecovery(item.outcome) && outcomes.slice(index + 1).find(next => succeeded(next.outcome)
          && next.at >= item.at
          && next.at - item.at <= recoveryWindowMs);
        if (recovery) {
          recoveredReads.push({ url, failedAt: item.at, recoveredAt: recovery.at, used: false });
          return false;
        }
        return true;
      });
      if (unrecovered.length) persistentReadFailures.push([key, outcomes]);
    }

    const resourceErrors = consoleErrors.filter(item => /^Failed to load resource:/i.test(item.message));
    const otherConsoleErrors = consoleErrors.filter(item => !/^Failed to load resource:/i.test(item.message));
    const unexplainedResourceErrors = resourceErrors.filter(error => {
      const recovery = recoveredReads.find(item => !item.used
        && error.url
        && item.url === error.url
        && error.at >= item.failedAt - 1000
        && error.at <= item.recoveredAt + 1000);
      if (!recovery) return true;
      recovery.used = true;
      return false;
    });
    const errors = [...pageErrors, ...otherConsoleErrors, ...unexplainedResourceErrors];
    const pendingReadFailures = [...outstandingReads]
      .filter(request => ['GET', 'HEAD'].includes(request.method()))
      .map(request => [`${request.method()} ${request.url()}`, [{ outcome: 'pending' }]]);
    const ok = !errors.length && !persistentReadFailures.length && !pendingReadFailures.length;
    return {
      ok,
      recoveredReadAttempts: recoveredReads.length,
      navigationAborts,
      error: ok
        ? ''
        : errors.slice(0, 5).map(item => typeof item === 'string' ? item : item.message).join(' | ')
          + (persistentReadFailures.length
            ? (errors.length ? ' | ' : '') + 'persistent read failures: '
              + JSON.stringify(persistentReadFailures.slice(0, 8).map(describeRead))
            : '')
          + (pendingReadFailures.length
            ? (errors.length || persistentReadFailures.length ? ' | ' : '') + 'pending read requests: '
              + JSON.stringify(pendingReadFailures.slice(0, 8).map(describeRead))
            : ''),
    };
  };

  return { settle };
}

module.exports = {
  root,
  serveStatic,
  isWriteLikeRequest,
  installReadConsoleAudit,
  installProductionInit,
  openProduction,
  formatFailures,
};
