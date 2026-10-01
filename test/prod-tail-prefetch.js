'use strict';
/*
 * SyncLinear's finished-items read starts beside the live read.
 *
 * Measured 2026-10-01 on the live backend from a cloud rig: a cold open of the
 * Linear tab landed its full list (the ~117 rows whose ancestors are finished,
 * plus the sub-issue counts) 7.2 s in, because the five-page finished-items
 * read only began after the live read had finished and the board had painted.
 * It now starts with the live read whenever a full tail is due, and a catch-up
 * point (`_prodState.catchUpSince`) that the NEXT regular refresh starts from
 * closes the only gap overlap could open: a card that moves between the two
 * halves while they are in flight. It adds no request at load time.
 *
 * This suite runs the SHIPPED helpers against fakes and reads the shipped
 * source for the wiring.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed++; console.log('  ok  ' + m); };

function grab(name, kind) {
  const re = new RegExp((kind || '') + '\\s*function\\s+' + name + '\\s*\\(');
  const at = INDEX.search(re);
  assert.ok(at >= 0, 'function not found: ' + name);
  let depth = 0;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    if (INDEX[j] === '{') depth++;
    else if (INDEX[j] === '}' && --depth === 0) return INDEX.slice(at, j + 1);
  }
  throw new Error('unbalanced ' + name);
}

// 1. Wiring.
const loadData = grab('_prodLoadData', 'async');
const tail = grab('_prodLoadTerminalTail', 'async');
ok(/if \(_prodTerminalTailFullDue\(silent\)\) _prodStartTailPrefetch\(\);/.test(loadData),
  'a load starts the prefetch exactly when a full tail is due, the same predicate the tail uses');
ok(loadData.indexOf('_prodStartTailPrefetch()') < loadData.indexOf('_prodClientRows()'),
  'and starts it before the other reads, so it overlaps the whole live walk');
ok(!/_prodStartTailPrefetch/.test(tail), 'the tail itself never starts one');
ok(/const prefetched = _prodTakeTailPrefetch\(filter\);\s*const tail = await \(prefetched \? prefetched\.promise : _prodLoadDeliverableProjection\(filter\)\);/.test(tail),
  'the tail takes the held read for its own filter, else reads for itself');
ok(tail.indexOf('if (generation !== _prodState.projectionGeneration) return false;') > tail.indexOf('prefetched.promise')
  && tail.indexOf('_prodState.catchUpSince = prefetched.since') > tail.indexOf('_prodApplyDeepLinkFallback(true);'),
  'the generation check still guards the merge, and the catch-up point is set only after a tail that landed');
ok(/if \(prefetched && \(!_prodState\.catchUpSince \|\| Date\.parse\(prefetched\.since\) < Date\.parse\(_prodState\.catchUpSince\)\)\)/.test(tail),
  'and an earlier catch-up point is never replaced by a later one');
ok(!/_prodReconcileSince|_prodDeltaRefresh\(\{/.test(tail), 'the tail sends no extra request for it');
ok(/_prodState\.catchUpSince = '';/.test(grab('_prodDeltaRefresh', 'async')), 'a refresh that read clears it');
ok(/_prodTailPrefetch = null;\s*\/\/ a failed load/.test(loadData), 'a failed load drops what it held');
const delta = grab('_prodDeltaRefresh', 'async');
ok(/let watermark = _prodDeliverableWatermark\(_prodState\.deliverables\);\s*const catchUp = String\(_prodState\.catchUpSince \|\| ''\);\s*if \(catchUp && !opts\.full && watermark && Date\.parse\(catchUp\) < Date\.parse\(watermark\)\) watermark = catchUp;/.test(delta),
  'the next refresh starts from the catch-up point when it is earlier than the newest row held, and from the newest row otherwise');

// 2. The shipped helpers.
const helpers = [grab('_prodStartTailPrefetch'), grab('_prodTakeTailPrefetch')].join('\n');
function make(now) {
  const calls = { loaded: [], delta: [], timers: [] };
  const ctx = {
    PROD_TERMINAL_FILTER: 'status=in.(a,b)', PROD_TAIL_SKEW_MS: 30000,
    Date: class extends Date { static now() { return ctx.__now; } },
    Promise,
    _prodLoadDeliverableProjection: filter => { calls.loaded.push(filter); return Promise.resolve(['row']); },
    setTimeout: (fn, ms) => { calls.timers.push([fn, ms]); },
    __now: now, __answer: true
  };
  vm.createContext(ctx);
  vm.runInContext('let _prodTailPrefetch = null;\n' + helpers
    + '\nthis.start = _prodStartTailPrefetch; this.take = _prodTakeTailPrefetch;', ctx);
  return { ctx, calls };
}
let { ctx, calls } = make(1_000_000_000_000);
ctx.start();
ok(calls.loaded.length === 1 && calls.loaded[0] === 'status=in.(a,b)', 'start asks for the finished-items projection, nothing else');
let held = ctx.take('status=in.(a,b)');
ok(held && held.promise && held.filter === 'status=in.(a,b)', 'the tail takes it for the exact filter');
ok(new Date(held.since).getTime() === 1_000_000_000_000 - 30000, 'with a catch-up point 30 s before the load began (clock skew room)');
ok(ctx.take('status=in.(a,b)') === null, 'and only once');
ctx.start();
ok(ctx.take('status=in.(a,b)&updated_at=gte.x') === null, 'an incremental pass (a different filter) never uses it');
ok(ctx.take('status=in.(a,b)') === null, 'and a refused take still discards it, so it cannot go stale into a later call');
ctx.start(); ctx.__now += 120001;
ok(ctx.take('status=in.(a,b)') === null, 'a read held longer than two minutes is not used');

console.log('\nprod-tail-prefetch: ' + passed + ' checks passed ✅');
