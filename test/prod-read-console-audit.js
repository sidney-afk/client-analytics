'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { installReadConsoleAudit } = require('../docs/syncview-design/tests/prod-test-utils');

const readUrl = 'https://example.supabase.co/rest/v1/items?select=id&token=private-value';
const otherUrl = 'https://example.supabase.co/rest/v1/other?select=id';

function request(url = readUrl, { failure = '', navigation = false, frame = null } = {}) {
  return {
    method: () => 'GET',
    url: () => url,
    failure: () => failure ? { errorText: failure } : null,
    isNavigationRequest: () => navigation,
    frame: () => frame,
  };
}

function resourceError(url = readUrl) {
  return {
    type: () => 'error',
    text: () => 'Failed to load resource: the server responded with a status of 500 ()',
    location: () => ({ url }),
  };
}

function respond(page, req, status, withConsole = false) {
  page.emit('response', { request: () => req, status: () => status });
  if (withConsole) page.emit('console', resourceError(req.url()));
  page.emit('requestfinished', req);
}

async function auditCase(build) {
  const page = new EventEmitter();
  const frame = {};
  const timers = [];
  let now = 1000;
  const realNow = Date.now;
  Date.now = () => now;
  page.mainFrame = () => frame;
  page.at = value => { now = value; };
  page.elapsed = () => now - 1000;
  page.schedule = (at, fn) => timers.push({ at, fn });
  /* The audit waits in the PAGE for the background revalidation a cached paint
     promises, so the fake page has to be able to run that predicate. It reads
     window._prodState, which the case sets through page.prodState. */
  page.prodState = null;
  page.waitForFunction = async (fn, arg, options = {}) => {
    const deadline = now + Number(options.timeout || 30000);
    try {
      for (;;) {
        /* `_prodState` is a global LEXICAL binding in the app (a top-level
           `const`), not a property of window, so the predicate reads it bare and
           this fake has to provide it the same way -- absent entirely when the
           page has no Production tab, which is what `typeof` guards against. */
        if (page.prodState === null) delete global._prodState;
        else global._prodState = page.prodState;
        if (fn()) return;
        if (now >= deadline) throw new Error('waitForFunction: timeout');
        await page.waitForTimeout(Number(options.polling) || 100);
      }
    } finally { delete global._prodState; }
  };
  page.waitForTimeout = async ms => {
    const target = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const timer = timers[0];
      if (!timer || timer.at > target) break;
      timers.shift();
      now = timer.at;
      timer.fn();
    }
    now = target;
  };

  try {
    const audit = installReadConsoleAudit(page);
    build(page, frame);
    const result = await audit.settle(2500);
    // Simulated wall clock, so a case can assert what the audit waited for.
    if (result && typeof result === 'object') result.elapsedMs = page.elapsed();
    return result;
  } finally {
    Date.now = realNow;
  }
}

async function main() {
  const exactRecovery = await auditCase(page => {
    const failed = request();
    const recovered = request();
    page.emit('request', failed);
    respond(page, failed, 500, true);
    page.emit('request', recovered);
    respond(page, recovered, 200);
  });
  assert.equal(exactRecovery.ok, true);
  assert.equal(exactRecovery.recoveredReadAttempts, 1);

  const duplicateResourceError = await auditCase(page => {
    const failed = request();
    const recovered = request();
    page.emit('request', failed);
    page.emit('response', { request: () => failed, status: () => 500 });
    page.emit('console', resourceError());
    page.emit('console', resourceError());
    page.emit('requestfinished', failed);
    page.emit('request', recovered);
    respond(page, recovered, 200);
  });
  assert.equal(duplicateResourceError.ok, false);

  const unrelatedConsole = await auditCase(page => {
    const failed = request();
    const recovered = request();
    page.emit('request', failed);
    page.emit('response', { request: () => failed, status: () => 500 });
    page.emit('console', resourceError(otherUrl));
    page.emit('requestfinished', failed);
    page.emit('request', recovered);
    respond(page, recovered, 200);
  });
  assert.equal(unrelatedConsole.ok, false);

  const nonRetryable = await auditCase(page => {
    const failed = request();
    const later = request();
    page.emit('request', failed);
    respond(page, failed, 404, true);
    page.emit('request', later);
    respond(page, later, 200);
  });
  assert.equal(nonRetryable.ok, false);
  assert.match(nonRetryable.error, /404/);

  const redirectOnly = await auditCase(page => {
    const failed = request();
    const redirected = request();
    page.emit('request', failed);
    respond(page, failed, 500, true);
    page.emit('request', redirected);
    respond(page, redirected, 302);
  });
  assert.equal(redirectOnly.ok, false);

  const unprovenAbort = await auditCase(page => {
    const aborted = request(readUrl, { failure: 'net::ERR_ABORTED' });
    page.emit('request', aborted);
    page.emit('requestfailed', aborted);
  });
  assert.equal(unprovenAbort.ok, false);

  const navigationAbort = await auditCase((page, frame) => {
    const oldRead = request(readUrl, { failure: 'net::ERR_ABORTED' });
    page.emit('request', oldRead);
    page.at(1001);
    const navigation = request('http://localhost/', { navigation: true, frame });
    page.emit('request', navigation);
    page.at(1002);
    page.emit('requestfailed', oldRead);
    page.at(1003);
    page.emit('framenavigated', frame);
    respond(page, navigation, 200);
    page.at(1004);
    const newRead = request();
    page.emit('request', newRead);
    respond(page, newRead, 200);
  });
  assert.equal(navigationAbort.ok, true);
  assert.equal(navigationAbort.navigationAborts, 1);
  assert.equal(navigationAbort.recoveredReadAttempts, 0);

  const productAbort = await auditCase((page, frame) => {
    const navigation = request('http://localhost/', { navigation: true, frame });
    page.emit('request', navigation);
    respond(page, navigation, 200);
    page.at(1001);
    page.emit('framenavigated', frame);
    page.at(1002);
    const aborted = request(readUrl, { failure: 'net::ERR_ABORTED' });
    page.emit('request', aborted);
    page.at(1003);
    page.emit('requestfailed', aborted);
  });
  assert.equal(productAbort.ok, false);

  const pending = await auditCase(page => {
    page.emit('request', request());
  });
  assert.equal(pending.ok, false);
  assert.match(pending.error, /pending read requests/);
  assert.ok(!pending.error.includes('private-value'), 'diagnostics must omit query values');

  const lateFailure = await auditCase(page => {
    const late = request();
    page.emit('request', late);
    page.schedule(1700, () => respond(page, late, 500, true));
  });
  assert.equal(lateFailure.ok, false);

  const lateRecovery = await auditCase(page => {
    const failed = request();
    const recovered = request();
    page.emit('request', failed);
    page.schedule(1200, () => respond(page, failed, 500, true));
    page.schedule(1500, () => page.emit('request', recovered));
    page.schedule(1600, () => respond(page, recovered, 200));
  });
  assert.equal(lateRecovery.ok, true);
  assert.equal(lateRecovery.recoveredReadAttempts, 1);

  /* --- the cached paint's revalidation ------------------------------------
   * Production paints from its snapshot and revalidates in the background, so
   * the reads a suite would otherwise call "pending" are the ones the design
   * deliberately leaves running. Before this, `Production structure subset`
   * went red on every run from the moment the snapshot first fit in the quota:
   * the warm paint landed in 0.8s where the cold one took 9.1s, the suite
   * finished its assertions immediately, and settle() expired with the live
   * read still in flight. */
  const revalidationAwaited = await auditCase(page => {
    page.prodState = { cachePartial: true, loading: false, error: '' };
    /* Nothing is in flight YET -- the cached paint is on screen and the live
       read has not opened its first request. A drain that only looks at what is
       already outstanding sees quiet, returns in 100ms, and audits none of the
       revalidation at all: the failing read below would go unseen and the suite
       would go green having checked nothing. */
    page.schedule(1500, () => {
      const live = request();
      page.emit('request', live);
      page.schedule(2000, () => {
        page.prodState.cachePartial = false;
        respond(page, live, 500, true);
      });
    });
  });
  assert.equal(revalidationAwaited.ok, false,
    'the revalidation a cached paint promises is audited, not skipped past');
  assert.ok(revalidationAwaited.elapsedMs >= 1000,
    'which means settle waited for it to start rather than returning on quiet');

  /* But the wait is bounded by the flag it is waiting on, not by the clock: a
     load that errored never clears cachePartial, and a suite must not pay the
     full timeout to learn that. */
  const erroredLoadStopsWaiting = await auditCase(page => {
    page.prodState = { cachePartial: true, loading: false, error: 'read failed' };
    page.emit('request', request());
  });
  assert.equal(erroredLoadStopsWaiting.ok, false);
  assert.match(erroredLoadStopsWaiting.error, /pending read requests/);
  assert.ok(erroredLoadStopsWaiting.elapsedMs < 20000,
    'an errored load ends the wait on the flag, well inside the 20s ceiling');

  /* And a page with no Production tab at all never waits — every other suite
     that uses this audit has to keep the timings it already has. */
  const noProductionState = await auditCase(page => {
    page.prodState = null;
    const read = request();
    page.emit('request', read);
    respond(page, read, 200);
  });
  assert.equal(noProductionState.ok, true);

  /* A keyset-paged chain finishes one page and opens the next, and against
     live data the whole chain runs about five seconds. Under a flat budget the
     drain expired mid-chain and called the page in flight "pending", which is
     the same word this audit uses for a request that hung. */
  const progressingChain = await auditCase(page => {
    const first = request();
    page.emit('request', first);
    page.schedule(2000, () => {
      respond(page, first, 200);
      const second = request(otherUrl);
      page.emit('request', second);
      page.schedule(4200, () => {
        respond(page, second, 200);
        const third = request(readUrl + '&page=3');
        page.emit('request', third);
        page.schedule(6300, () => respond(page, third, 200));
      });
    });
  });
  assert.equal(progressingChain.ok, true,
    'a chain still finishing pages is drained to the end rather than called pending');
  assert.ok(progressingChain.elapsedMs >= 5300,
    'and the drain really did outlast the flat budget it used to end on');

  /* The property that must survive that: a read producing NOTHING for a whole
     budget is still reported. Progress extends the drain; waiting does not. */
  const stalledRead = await auditCase(page => {
    const stuck = request();
    page.emit('request', stuck);
    page.schedule(1200, () => {
      const other = request(otherUrl);
      page.emit('request', other);
      respond(page, other, 200);
    });
  });
  assert.equal(stalledRead.ok, false);
  assert.match(stalledRead.error, /pending read requests/);
  assert.ok(stalledRead.elapsedMs < 20000,
    'a stalled read is reported in bounded time, not held to the ceiling');

  /* A read that STARTS during the drain gets the same chance as one that was
     already running: the deferred brief load fires 6.5s after data lands, so a
     suite can settle at exactly the wrong moment. */
  const readStartedDuringDrain = await auditCase(page => {
    const first = request();
    page.emit('request', first);
    // Finishes late enough that the drain is still polling when the next read
    // opens, which is the only way to model a read that STARTS mid-drain.
    page.schedule(3300, () => respond(page, first, 200));
    const late = request(otherUrl);
    page.schedule(3400, () => page.emit('request', late));
    page.schedule(3900, () => respond(page, late, 200));
  });
  assert.equal(readStartedDuringDrain.ok, true,
    'a read opened near the end of the drain is drained rather than called pending');

  for (const [file, settleNeedle, writeNeedle] of [
    ['behav-wired.js', 'const readConsole = await readConsoleAudit.settle()', "await ok('noWriteRequests'"],
    ['prod-a11y-focus.js', 'const readConsole = await readConsoleAudit.settle()', 'const writes = requests.filter'],
    ['prod-layout-polish.js', 'const readConsole = await readConsoleAudit.settle()', 'const writes = requests.filter'],
    ['prod-structure-subset.js', 'const readConsole = await readConsoleAudit.settle()', 'await assertNoWriteRequests(requests)'],
  ]) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'docs', 'syncview-design', 'tests', file), 'utf8');
    assert.ok(source.indexOf(settleNeedle) !== -1, `${file} must settle the read audit`);
    assert.ok(source.indexOf(settleNeedle) < source.indexOf(writeNeedle),
      `${file} must evaluate zero-write requests after the bounded settle`);
  }

  console.log('Production read/console audit fail-closed matrix passed');
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
