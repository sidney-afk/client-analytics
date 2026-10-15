'use strict';

const fs = require('fs');
const { recoveryFor } = require('./prod-schema-compat-audit');
const { seedStaffGate } = require('../../../qa/staff-gate-seed.js');
const http = require('http');
const path = require('path');

const root = path.resolve(__dirname, '..', '..', '..');
const productionApiOrigin = "https://uzltbbrjidmjwwfakwve.supabase.co";
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

// The app address in its old routing form. Clean paths (/synclinear/<id>)
// are shown in the bar; this reads the same ?prod=1&d=<id>#production form
// the app routes on (src/index/003-sv-route.html.part), so URL assertions
// keep checking what the app actually loaded.
async function legacyPageUrl(page) {
  const rel = await page.evaluate(() => (window.svRoute
    ? window.svRoute.search() + window.svRoute.hash()
    : location.search + location.hash));
  return new URL('/' + rel, 'http://127.0.0.1');
}

// GitHub Pages answers: /x -> x.html (clean-path stubs); any other missing
// extensionless path -> 404.html with a 404 status. Returns [file, status] or null.
function pagesFallback(rootDir, full, requestPath) {
  if (fs.existsSync(full + '.html')) return [full + '.html', 200];
  if (!path.extname(requestPath) && fs.existsSync(path.join(rootDir, '404.html'))) return [path.join(rootDir, '404.html'), 404];
  return null;
}

function serveStatic() {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    let p = decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname);
    p = path.normalize(p).replace(/^([.][\\/])+/, '');
    let full = path.join(root, p);
    let status = 200;
    // Answer like GitHub Pages: /x serves x.html when it exists (the clean-path
    // stubs), and any other missing path serves 404.html with a 404 status
    // (which hands clean deep links such as /calendar/<client>/<card> to the app).
    if (!full.startsWith(root) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      if (full.startsWith(root) && fs.existsSync(full + '.html')) full = full + '.html';
      else if (fs.existsSync(path.join(root, '404.html')) && !path.extname(p)) { full = path.join(root, '404.html'); status = 404; }
      else {
        res.writeHead(404);
        res.end('not found');
        return;
      }
    }
    res.writeHead(status, { 'Content-Type': mime[path.extname(full).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(full).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// The strict form of the guard: ANY method other than GET, HEAD or OPTIONS counts,
// whatever the host, so a mutation sent to a new or renamed backend cannot slip
// past a suite that only recognises today's hostnames. The one exemption is the
// staff entry gate's key-verify POST (authentication, writes nothing), matched by
// path. Suites that walk a detail add their own exact-shape read allowlist on top.
function isNonReadRequest(req) {
  const method = typeof req.method === 'function' ? req.method() : req.method;
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return false;
  const url = typeof req.url === 'function' ? req.url() : req.url;
  return !/\/functions\/v1\/key-verify(?:[/?#]|$)/i.test(url || '');
}

function isWriteLikeRequest(req) {
  const method = typeof req.method === 'function' ? req.method() : req.method;
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return false;
  const url = typeof req.url === 'function' ? req.url() : req.url;
  // The staff entry gate verifies a role key on every boot with a POST that
  // writes nothing — it reads the roster row for that key and answers. It is
  // authentication, not a mutation, and counting it here would make "this
  // surface mutated nothing" fail on the act of signing in. Narrow on purpose:
  // every other POST to functions/v1 still counts.
  if (/\/functions\/v1\/key-verify(?:[/?#]|$)/i.test(url || '')) return false;
  return /supabase|n8n|webhook|syncview|rest\/v1|functions\/v1/i.test(url || '');
}

async function installProductionInit(page) {
  // These suites all describe the ?prod=1 preview as an UNVERIFIED visitor sees
  // it, which is what the retired shared password gave them. The gate needs a
  // verified key to boot the app at all, so boot with one and drop it the
  // instant the gate lifts. See dropVerificationAfterBoot in
  // qa/staff-gate-seed.js for why a verified stub admin is the wrong posture
  // here (401s and console noise on every staff-gated call).
  await seedStaffGate(page, { dropVerificationAfterBoot: true });
  await page.addInitScript(() => {
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

/* HOLD THE PAGE'S BACKGROUND REFRESH STILL, once its first load is finished.
 *
 * The Production tab re-reads on its own: a 30-second tick, an authority
 * re-read, and a realtime channel, and any of them repaints the list when live
 * data has moved. A suite that is measuring the DOM (accessibility, layout)
 * then finds the node it just picked replaced under it, on a clock it does not
 * control and with data nobody controls. Those suites are not about refresh --
 * the refresh has its own tests (test/production-live-refresh.js and the
 * realtime controller suite) -- so stop the ticks (a truthy handle keeps the app
 * from starting new ones) and the channel. The first load and everything it
 * starts must already be finished: call this after quiesce(). */
async function holdBackgroundRefresh(page) {
  await page.evaluate(() => {
    try { clearInterval(_prodOperationalTimer); } catch (_) {}
    try { clearInterval(_prodAuthorityTimer); } catch (_) {}
    try { _prodRt.stop(); } catch (_) {}
  });
}

function formatFailures(title, failures) {
  return `${title}:\n` + failures.map(f => `  - ${f}`).join('\n');
}

function installReadConsoleAudit(page, opts = {}) {
  const pageErrors = [];
  const responseBodies = new Set();
  const schemaOutcomes = [];
  const consoleErrors = [];
  const readOutcomes = new Map();
  const mainFrameNavigations = [];
  const requestStartedAt = new WeakMap();
  const requestHeadersOf = new Map();
  const outstandingReads = new Set();
  const recoveryWindowMs = Math.max(1000, Number(opts.recoveryWindowMs || 15000));
  const navigationAbortWindowMs = Math.max(100, Number(opts.navigationAbortWindowMs || 1000));
  const revalidationTimeoutMs = Math.max(1000, Number(opts.revalidationTimeoutMs || 20000));
  const drainCeilingMs = Math.max(2000, Number(opts.drainCeilingMs || 30000));
  const idleHoldMs = Math.max(100, Number(opts.idleHoldMs || 700));
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
      // How long each attempt ran before it ended (ms). Shape only, no content:
      // tells a request the page gave up on from one that failed at once.
      durationsMs: outcomes.map(item => (Number.isFinite(item.at) && Number.isFinite(item.startedAt)) ? item.at - item.startedAt : null),
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
  page.on('response', response => {
    const request = response.request();
    recordReadOutcome(request, response.status());
    if (request.method() !== 'GET') return;
    let parsedUrl; try { parsedUrl = new URL(request.url()); } catch (_) { return; }
    if (parsedUrl.origin !== productionApiOrigin || !['/rest/v1/clients', '/rest/v1/production_deliverables_browser_v1'].includes(parsedUrl.pathname)) return;
    const key = request.method() + ' ' + request.url();
    const item = readOutcomes.get(key).at(-1);
    Object.assign(item, { method: 'GET', url: request.url(), status: response.status(), finished: false });
    schemaOutcomes.push(item);
    const task = Promise.resolve().then(() => typeof response.json === 'function' ? response.json() : undefined).then(body => { item.body = body; item.finished = true; }).catch(() => {});
    responseBodies.add(task); task.finally(() => responseBodies.delete(task));
  });
  page.on('request', request => {
    requestStartedAt.set(request, Date.now());
    if (request.method() === 'GET') {
      try { requestHeadersOf.set(request.url(), request.headers()); } catch (_) {}
    }
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

  // Set when the wait for the app's own "finished loading" signals ran out.
  // Sticky: a page that did not finish loading inside the timeout is reported
  // by settle() even if it finished later, because the suite has already been
  // asserting against it. Ended early (not recorded) by an error state.
  const loadTimeouts = [];
  const quiesce = async (waitMs = 2500) => {
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
      /* The page is idle only if it STAYS idle. The app's loads chain: when the
         finished-cards read ends it can queue a second one (a re-run requested
         while the first was running), and for one tick between them every flag is
         down. A single look at that tick calls the page quiet and the second read
         is then caught mid-flight as "pending". So after the flags first read
         idle, look again after a short pause and keep waiting if a new run began. */
      const appIdle = () => {
          /* `_prodState` is a top-level `const`, which lives in the global
             LEXICAL environment and is therefore never a property of `window`
             -- reading it as `window._prodState` yields undefined on every
             page and turns this wait into a no-op that looks like it works. */
          if (typeof _prodState === 'undefined' || !_prodState) return true;
          if (_prodState.error) return true;
          /* THE APP'S OWN "I AM STILL READING" FLAGS, ALL OF THEM.
             `cachePartial` and `loading` cover the first projection only. After
             first paint the app keeps reading on its own: the finished half of
             the list (`terminalTailPending`, about four thousand rows in
             sequential pages), and the 30-second delta tick or a realtime
             nudge (`refreshInFlight`, `refreshing`). Leaving those out made the
             drain below the only thing standing between a slow live page and a
             "pending read requests" failure, and a drain is a guess about
             time: it gives up when no request finishes for a budget. A read
             the app itself says is still running is not hung, so wait for the
             app to say it is done. A read that really hangs keeps its flag up
             until this wait times out, and the drain then reports it exactly
             as before. */
          /* And the finished half has to have LANDED, not merely not be
             running: between the live swap and the tail's first request the app
             waits up to 400 ms on its saved copy, and in that gap every flag
             above is down while about two thirds of the rows have not arrived.
             (The app asks the same question: _prodRowSetComplete.) A tail that
             failed ends the wait too; the fixture pages in unit tests that carry
             no such field are not asked. */
          const tailLanded = !('terminalTailLoadedAt' in _prodState)
            || !!_prodState.terminalTailLoadedAt || !!_prodState.terminalTailFailed;
          return !_prodState.cachePartial && !_prodState.loading
            && !_prodState.terminalTailPending
            && !_prodState.refreshInFlight
            && !_prodState.refreshing
            && tailLanded;
      };
      const idleDeadline = Date.now() + revalidationTimeoutMs;
      try {
        for (;;) {
          const left = idleDeadline - Date.now();
          if (left <= 0) throw new Error('page did not go idle');
          await page.waitForFunction(appIdle, null, { timeout: left, polling: 100 });
          await page.waitForTimeout(idleHoldMs);
          if (await page.evaluate(appIdle)) break;
        }
      } catch (_) {
        // Timed out (or the page went away). Keep what the app said, booleans
        // only, so settle() can fail on it instead of auditing a quiet,
        // incomplete page.
        const flags = await page.evaluate(() => {
          if (typeof _prodState === 'undefined' || !_prodState) return null;
          const f = {};
          ['loading', 'cachePartial', 'terminalTailPending', 'terminalTailFailed', 'refreshInFlight', 'refreshing'].forEach(k => { f[k] = !!_prodState[k]; });
          f.tailLanded = !!_prodState.terminalTailLoadedAt;
          return f;
        }).catch(() => null);
        if (flags) loadTimeouts.push(flags);
      }
    }

    await drainOutstandingReads();
    return drainOutstandingReads;
  };

  const settle = async (waitMs = 2500) => {
    const waitBudgetMs = Math.max(100, Number(waitMs || 2500));
    const drainOutstandingReads = await quiesce(waitMs);
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

    let bodyTimer;
    try {
      await Promise.race([
        Promise.all([...responseBodies]),
        new Promise(resolve => { bodyTimer = setTimeout(resolve, 5000); }),
      ]);
    } finally { clearTimeout(bodyTimer); }
    if (responseBodies.size) pageErrors.push('schema compatibility response body remained pending');
    const readEntries = [...readOutcomes.entries()];
    /*
     * A READ THE APP GAVE UP ON ITSELF, CONFIRMED AGAINST THE SAME ADDRESS.
     *
     * Exactly one read is time-limited by the page: the write routing flags
     * (WRITE_UI_REROUTE_FLAG_TIMEOUT_MS, two seconds). On giving up the page
     * cancels the request and carries on in its safe default state, and it
     * re-reads only when the reader returns to the tab or a minute passes,
     * neither of which happens inside one of these suites. The two seconds also
     * start BEFORE the page waits for the batched flag read the <head> script
     * opened, so a slow moment there leaves the page's own read well under a
     * second to finish -- the cancel can arrive hundreds of milliseconds after
     * the request opened, and its duration says nothing about the backend.
     *
     * The audit used to call that a failed read, with no later success to pair
     * it with. The only reading that tells a slow moment from a broken backend
     * is a fresh read of the same address, so take one. It excuses the
     * cancelled read only if ALL hold:
     *   - it is that one time-limited read (no other cancel is vouched for: a
     *     cancel of any other read is the page misbehaving),
     *   - the address is the app's own backend,
     *   - a fresh GET with the very same headers answers 2xx, and answers fast
     *     (a backend that is still slow, or still failing, stays a failure).
     * The probe is made outside the page, so it is not itself a page read.
     */
    const isPageTimedRead = url => {
      try {
        const parsed = new URL(url);
        return parsed.origin === productionApiOrigin
          && parsed.pathname === '/rest/v1/syncview_runtime_flags'
          // The exact request the page time-limits: two keys, limit 2. The <head>
          // boot read also names this key among seven and is not time-limited.
          && parsed.searchParams.get('key') === 'in.(write_ui_reroute_clients,client_comment_gateway_enabled)'
          && parsed.searchParams.get('limit') === '2';
      } catch (_) { return false; }
    };
    const probeLimitMs = 2000;
    const probeRecovered = new Set();
    if (opts.schemaOnly !== true && page.request && typeof page.request.get === 'function') {
      let probes = 0;
      for (const [key, outcomes] of readEntries) {
        const url = key.replace(/^[A-Z]+ /, '');
        if (key.startsWith('HEAD ') || !isPageTimedRead(url)) continue;
        for (const item of outcomes) {
          if (!isNavigationAbort(item.outcome) || probes >= 8) continue;
          probes++;
          const headers = requestHeadersOf.get(url);
          if (!headers) continue;
          const sent = {};
          ['apikey', 'authorization', 'accept'].forEach(name => { if (headers[name]) sent[name] = headers[name]; });
          const began = Date.now();
          try {
            const answer = await page.request.get(url, { headers: sent, timeout: 10000 });
            if (answer.status() >= 200 && answer.status() < 300 && Date.now() - began <= probeLimitMs) probeRecovered.add(item);
            await answer.dispose().catch(() => {});
          } catch (_) {}
        }
      }
    }
    const recoveredReads = [];
    let navigationAborts = 0;
    const persistentReadFailures = [];
    for (const [key, outcomes] of readEntries) {
      const url = key.replace(/^[A-Z]+ /, '');
      const unrecovered = outcomes.filter((item, index) => {
        if (!failed(item.outcome)) return false;
        const navigationAbort = opts.schemaOnly !== true && isNavigationAbort(item.outcome) && mainFrameNavigations.some(navigation =>
          navigation.committedAt !== null
          /* Started before the navigation COMMITTED, not before it was
             requested: the old document keeps running (and reading) until the
             commit, so a read it opened in that gap is torn down by the same
             navigation. A read opened after the commit still belongs to the new
             document and an abort of it stays a failure. */
          && item.startedAt <= navigation.committedAt
          && navigation.startedAt <= item.at
          && item.at - navigation.startedAt <= navigationAbortWindowMs
          && item.at <= navigation.committedAt + 250);
        if (navigationAbort) {
          navigationAborts++;
          return false;
        }
        const recovery = opts.schemaOnly !== true && eligibleForRecovery(item.outcome) && outcomes.slice(index + 1).find(next => succeeded(next.outcome)
          && next.at >= item.at
          && next.at - item.at <= recoveryWindowMs);
        const schemaRecovery = recoveryFor(item, schemaOutcomes, { origin: productionApiOrigin, windowMs: recoveryWindowMs });
        // Origin is additionally bound to the application's configured Supabase endpoint.
        const approvedSchemaRecovery = schemaRecovery && new URL(url).origin === productionApiOrigin;
        if (recovery || approvedSchemaRecovery || probeRecovered.has(item)) {
          recoveredReads.push({ url, failedAt: item.at, recoveredAt: recovery ? recovery.at : item.at, used: false });
          return false;
        }
        return true;
      });
      if (unrecovered.length && opts.consoleOnly !== true) persistentReadFailures.push([key, outcomes]);
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
    const loadErrors = loadTimeouts.slice(0, 1).map(flags =>
      'page did not finish loading within ' + revalidationTimeoutMs + 'ms; app flags: ' + JSON.stringify(flags));
    const errors = [...pageErrors, ...otherConsoleErrors, ...unexplainedResourceErrors, ...loadErrors];
    // The app's own "still reading" flags at the moment of the audit (booleans
    // only), so a pending read can be told apart: one the app says it is still
    // running, or one it has already stopped waiting for.
    let appFlags = null;
    if (outstandingReads.size && typeof page.evaluate === 'function') {
      appFlags = await page.evaluate(() => {
        if (typeof _prodState === 'undefined' || !_prodState) return null;
        const f = {};
        ['loaded', 'loading', 'cachePartial', 'terminalTailPending', 'terminalTailFailed', 'refreshInFlight', 'refreshing'].forEach(k => { f[k] = !!_prodState[k]; });
        f.tailLanded = !!_prodState.terminalTailLoadedAt;
        f.nav = typeof currentNav === 'string' ? currentNav : '';
        return f;
      }).catch(() => null);
    }
    const pendingReadFailures = [...outstandingReads]
      .filter(request => opts.consoleOnly !== true && ['GET', 'HEAD'].includes(request.method()))
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
              + (appFlags ? ' app flags: ' + JSON.stringify(appFlags) : '')
            : ''),
    };
  };

  return { settle, quiesce: async waitMs => { await quiesce(waitMs); } };
}

module.exports = { legacyPageUrl, pagesFallback,
  root,
  serveStatic,
  isWriteLikeRequest,
  isNonReadRequest,
  installReadConsoleAudit,
  installProductionInit,
  openProduction,
  holdBackgroundRefresh,
  formatFailures,
};
