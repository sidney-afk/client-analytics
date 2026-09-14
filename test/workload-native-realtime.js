'use strict';
/*
 * Lane A / work item A5. The Workload board updates itself when a status
 * changes in SyncLinear.
 *
 * WL_V2_REALTIME was false for one stated reason: the board read
 * `workload_issues`, which the n8n reconcile re-wrote IN FULL each run to
 * advance `synced_at` for its mark-sweep, so a subscription on that table
 * would emit roughly one event per row per run. The native source writes only
 * what changed, which is the exact condition the old comment named. So the
 * flag goes true and the channel moves to the tables the board now actually
 * reads.
 *
 * Two things are asserted rather than assumed:
 *   1. the channel's table set is EXACTLY {deliverables, batches} -- a
 *      subscription left on `workload_issues` would keep the board tied to a
 *      table that stops being rebuilt at the cutoff, and would look like it
 *      worked right up until it silently stopped;
 *   2. one change produces ONE debounced refetch, and that refetch does not
 *      read `workload_issues`.
 *
 * Source-pattern plus an executed debounce. Not deployment or live proof.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { extractFunction } = require('./helpers/extract-function');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks++; };

// ---- 1. the flag ------------------------------------------------------------
ok(/const WL_V2_REALTIME\s*=\s*true;/.test(html),
  'WL_V2_REALTIME is true');
ok(!/const WL_V2_REALTIME\s*=\s*false;/.test(html),
  'no second WL_V2_REALTIME declaration re-gates it');

// ---- 2. the channel is bound to the native tables, and only those -----------
const subscribe = extractFunction(html, '_wlV2EnsureSubscribed');
const tables = [...subscribe.matchAll(/table:\s*'([^']+)'/g)].map(m => m[1]).sort();
assert.deepEqual(tables, ['batches', 'deliverables'],
  'realtime postgres_changes table set is exactly {batches, deliverables}');
checks++;
ok(!/table:\s*'workload_issues'/.test(subscribe),
  'the channel no longer subscribes to workload_issues');
ok(/schema:\s*'public'/.test(subscribe) && !/schema:\s*'(?!public)/.test(subscribe),
  'both bindings are on the public schema');
ok(/if \(!WL_V2_REALTIME\) return;/.test(subscribe),
  'the flag stays a one-line rollback lever in front of the subscribe');

// ---- 3. the poll behind it is a safety net, not the update path -------------
const poll = /const WL_V2_WATERMARK_POLL_MS\s*=\s*([^;]+);/.exec(html);
ok(poll, 'WL_V2_WATERMARK_POLL_MS is declared');
// eslint-disable-next-line no-new-func
const pollMs = Function('return (' + poll[1] + ');')();
ok(pollMs >= 5 * 60 * 1000,
  `the background poll is a >=5min safety net, not a per-minute full-snapshot read (got ${pollMs}ms)`);
// _wlV2CheckWatermark now calls wlRefetchSilent() unconditionally, and each of
// those reads the whole population through workload-plan against an 8s timeout.
const watermark = extractFunction(html, '_wlV2CheckWatermark');
ok(/wlRefetchSilent\(\)/.test(watermark) && !/synced_at/.test(watermark),
  'the watermark check is a full silent refetch, not a workload_issues cursor read');

// ---- 4. one change -> one debounced refetch, and no provider table read -----
(async () => {
  const context = {
    console, Date, Map, Set, Promise, Error, setTimeout, clearTimeout,
    WL_V2_RT_DEBOUNCE_MS: 5,
    document: { querySelector: () => ({}) },
    refetches: 0,
    reads: [],
    fetch: async (url) => { context.reads.push(String(url)); return { ok: true, json: async () => ({}) }; },
    _wlV2RtTimer: null,
    _wlV2WatermarkBusy: false,
    wlState: { loading: false, refreshing: false },
    _wlPlanWriteInFlight: new Map(),
    _wlDueWriteInFlight: new Map(),
    wlRefetchSilent: async () => { context.refetches++; return true; }
  };
  vm.createContext(context);
  vm.runInContext(extractFunction(html, '_wlV2OnRealtimeChange'), context);
  vm.runInContext('async ' + extractFunction(html, '_wlV2CheckWatermark'), context);

  // Three events inside the debounce window are one refetch, not three.
  context._wlV2OnRealtimeChange();
  context._wlV2OnRealtimeChange();
  context._wlV2OnRealtimeChange();
  await new Promise(resolve => setTimeout(resolve, 60));
  ok(context.refetches === 1,
    'a burst of change events coalesces into exactly one silent refetch');
  ok(context.reads.length === 0,
    'the realtime path reads no table directly, and workload_issues not at all');

  console.log(`PASS workload native realtime: ${checks} focused checks; source + executed debounce, not live proof.`);
})().catch(e => { console.error(e); process.exitCode = 1; });
