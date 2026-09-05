'use strict';
// Execute the actual reader/waiter, with deferred IO and inert rendering.
// Browser timing/visible controls are separately exercised by qa/kasper-roster.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { extractFunction } = require('./helpers/extract-function');
const source = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const asyncFunction = name => 'async ' + extractFunction(source, name);
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const turn = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const roster = deferred(), reads = [], retry = deferred();
  const body = { innerHTML: '' }, pill = { hidden: true };
  const c = vm.createContext({ Date, Map, Set, Promise, Error,
    _kasperRosterReady: roster.promise, _kasperLoadGen: 0, _kasperLoadingGen: 0, _kasperLastLocalWriteAt: 0,
    _kasperState: { items: [], history: [], replies: [], tab: 'review', loading: false },
    document: { getElementById: id => id === 'kasperReviewBody' ? body : id === 'kasperReviewRefreshPill' ? pill : null },
    _svLoadingSkeletonHtml: () => 'LOADING', _calEsc: String,
    _kasperLoadSMMMap: async () => new Map(),
    _kasperFetchAllRelevantPosts: () => { const d = deferred(); reads.push(d); return d.promise; },
    fetchEssentials: () => { c.retries++; return retry.promise; }, retries: 0,
    _kasperIsClosed: () => false, wlNormalizeClient: s => s,
    _kasperLoadHistoryLog: () => [], _kasperMergeHistory: h => h,
    _kasperPersistCache: () => {}, _kasperPaintReview: () => { body.innerHTML = 'PAINT'; },
    _kasperUpdateReplyCount: () => {}, _kasperRefreshTabCounts: () => {},
  });
  vm.runInContext([
    asyncFunction('_kasperWaitForRoster'), asyncFunction('_kasperLoadReview'),
    extractFunction(source, '_kasperInvalidateInFlightLoad'),
  ].join('\n'), c);
  return { c, roster, reads, retry, body, pill };
}
const fetched = id => ({ queue: [{ client: 'fictional', post: { id, name: id } }], replies: [], history: [] });
async function main() {
  // Boot wires the authorized essentials promise BEFORE any fast-route branch.
  const boot = source.slice(source.indexOf('const dataLoad = fetchAll(_isClientLink?clientEntryRun:null);'));
  assert(boot.includes('_kasperRosterReady = dataLoad.essentials;') &&
    boot.indexOf('_kasperRosterReady = dataLoad.essentials;') < boot.indexOf('if (skipAwait)'), 'readiness is wired before fast routing');
  {
    const f = fixture(), load = f.c._kasperLoadReview(true); await turn();
    assert.equal(f.reads.length, 0, 'no premature roster snapshot/read');
    f.roster.resolve(); await turn(); assert.equal(f.reads.length, 1);
    f.reads[0].resolve(fetched('ready')); await load;
    assert.equal(f.c._kasperState.items[0].post.id, 'ready');
  }
  {
    const f = fixture(), load = f.c._kasperLoadReview(true);
    f.c._kasperInvalidateInFlightLoad(); f.roster.resolve(); await load;
    assert.equal(f.reads.length, 0, 'mutation during readiness invalidates before transport');
    assert.equal(f.c._kasperState.loading, false, 'invalidated owner still releases loading');
  }
  {
    const f = fixture(), load = f.c._kasperLoadReview(true);
    f.roster.reject(new Error('fixture unavailable')); await load;
    assert(f.body.innerHTML.includes("Couldn't load the queue"));
    assert.equal(f.c._kasperRosterReady, null, 'failed readiness is retryable');
    const a = f.c._kasperLoadReview(true), b = f.c._kasperLoadReview(true);
    assert.equal(f.c.retries, 1, 'concurrent review entries share roster retry');
    f.retry.resolve(); await turn(); assert.equal(f.reads.length, 1, 'superseded waiter makes no read');
    f.reads[0].resolve(fetched('retry')); await Promise.all([a, b]);
    assert.equal(f.c._kasperState.items[0].post.id, 'retry');
  }
  for (const oldFails of [false, true]) {
    const f = fixture(); f.roster.resolve();
    const old = f.c._kasperLoadReview(true); await turn();
    const current = f.c._kasperLoadReview(true); await turn();
    if (oldFails) {
      f.reads[1].resolve(fetched('new')); await current;
      const html = f.body.innerHTML;
      f.reads[0].reject(new Error('older read failed')); await old;
      assert.equal(f.body.innerHTML, html, 'late failure cannot replace newer content');
      assert.equal(f.c._kasperState.error, null);
    } else {
      f.reads[0].resolve(fetched('old')); await old;
      assert.equal(f.c._kasperState.loading, true, 'older finally cannot release newer loading');
      assert.equal(f.c._kasperState.items.length, 0, 'old response discarded');
      f.reads[1].resolve(fetched('new')); await current;
    }
    assert.equal(f.c._kasperState.items[0].post.id, 'new');
    assert.equal(f.c._kasperState.loading, false);
  }
  {
    const f = fixture(); f.roster.resolve();
    const load = f.c._kasperLoadReview(true); await turn();
    f.c._kasperInvalidateInFlightLoad(); f.reads[0].resolve(fetched('obsolete')); await load;
    assert.equal(f.c._kasperState.items.length, 0, 'mutation during Calendar read invalidates response');
    assert.equal(f.c._kasperState.loading, false);
  }
  for (const [metricsOk, rosterOk] of [[false, true], [true, false], [false, false]]) {
    let applied = 0;
    const c = vm.createContext({ Promise, Error, METRICS_URL: 'fixture-metrics', CLIENTS_URL: 'fixture-roster',
      fetch: async url => ({ ok: url === 'fixture-metrics' ? metricsOk : rosterOk, text: async () => 'fictional response' }),
      _applyEssentialTexts: () => { applied++; }, _analyticsCacheWrite: () => {},
      _syncviewClientEntryRunCurrent: () => true,
    });
    vm.runInContext(asyncFunction('fetchEssentials'), c);
    const load = c.fetchEssentials({ signal: {} });
    if (rosterOk) {
      await load;
      assert.equal(applied, 1, 'Metrics HTTP failure must not reject the healthy client roster');
    } else {
      await assert.rejects(load, /Client list could not load/);
      assert.equal(applied, 0, 'roster HTTP failure must not certify readiness, regardless of Metrics status');
    }
  }
  console.log('Kasper roster readiness: boot order, retry, overlap, mutation and HTTP failure checks passed');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
