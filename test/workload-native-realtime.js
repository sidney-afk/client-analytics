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
    WL_V2_RT_COLLECT_MS: 5,
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
  vm.runInContext(extractFunction(html, '_wlV2IsCommentStampOnly'), context);
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

  // ---- 5. COLLECT, THEN FETCH ONCE (2026-10-06 findings, item 4) -----------
  // A virtual clock: events spread over the whole 3 s window are ONE fetch, a
  // trailing debounce that a steady stream could postpone for ever is gone,
  // and a busy board keeps the change instead of dropping it.
  const collectMs = Number((/const WL_V2_RT_COLLECT_MS\s*=\s*(\d+);/.exec(html) || [])[1]);
  ok(collectMs >= 500 && collectMs <= 1500, `events are collected for about 1 s before one fetch (got ${collectMs}ms)`);
  const clock = { t: 0, timers: [], id: 0 };
  const vctx = {
    console, Date: { now: () => clock.t }, JSON, Object, Set, String,
    setTimeout(fn, ms) { const id = ++clock.id; clock.timers.push({ id, at: clock.t + ms, fn }); return id; },
    clearTimeout(id) { clock.timers = clock.timers.filter(x => x.id !== id); },
    WL_V2_RT_COLLECT_MS: collectMs,
    document: { querySelector: () => ({}) },
    checks: 0,
    _wlV2RtTimer: null,
    _wlV2WatermarkBusy: false,
    wlState: { loading: false, refreshing: false },
    _wlPlanWriteInFlight: new Map(),
    _wlDueWriteInFlight: new Map(),
    _wlV2CheckWatermark() { vctx.checks++; }
  };
  vm.createContext(vctx);
  vm.runInContext(extractFunction(html, '_wlV2IsCommentStampOnly'), vctx);
  vm.runInContext(extractFunction(html, '_wlV2OnRealtimeChange'), vctx);
  const advance = (ms) => {
    const until = clock.t + ms;
    for (;;) {
      clock.timers.sort((a, b) => a.at - b.at);
      const next = clock.timers[0];
      if (!next || next.at > until) break;
      clock.timers.shift(); clock.t = next.at; next.fn();
    }
    clock.t = until;
  };
  const statusChange = (id, from, to) => ({ eventType: 'UPDATE', old: { id, status: from, updated_at: 'a' }, new: { id, status: to, updated_at: 'b' } });
  for (let i = 0; i < 20; i++) { vctx._wlV2OnRealtimeChange(statusChange('d' + i, 'In Progress', 'For Review')); advance(280); }
  advance(collectMs);
  ok(vctx.checks >= 1 && vctx.checks <= Math.ceil((20 * 280) / collectMs) + 1 && vctx.checks < 20,
    `twenty changes 280 ms apart (5.6 s) cost ${vctx.checks} snapshot reads, not 20 — and a steady stream cannot postpone the read for ever`);
  vctx.checks = 0;
  vctx._wlV2OnRealtimeChange(statusChange('x', 'a', 'b'));
  advance(collectMs - 1);
  ok(vctx.checks === 0, 'nothing is fetched before the window closes');
  advance(1);
  ok(vctx.checks === 1, 'the window closes with exactly one fetch');
  vctx.checks = 0;
  vctx._wlV2WatermarkBusy = true;
  vctx._wlV2OnRealtimeChange(statusChange('y', 'a', 'b'));
  advance(collectMs);
  ok(vctx.checks === 0, 'a read already running does not swallow the change...');
  vctx._wlV2WatermarkBusy = false;
  advance(collectMs);
  ok(vctx.checks === 1, '...the window re-opens and the change is fetched once it is free');
  vctx.checks = 0;
  const stampOnly = { eventType: 'UPDATE',
    old: { id: 'z', status: 'In Progress', updated_at: 'u1', comments_changed_at: null },
    new: { id: 'z', status: 'In Progress', updated_at: 'u1', comments_changed_at: '2026-10-06T10:00:00Z' } };
  vctx._wlV2OnRealtimeChange(stampOnly);
  advance(collectMs * 2);
  ok(vctx.checks === 0, 'an UPDATE that only moved the comment stamp does not refetch the board');
  const stampAndStatus = { eventType: 'UPDATE',
    old: { id: 'z', status: 'In Progress', updated_at: 'u1', comments_changed_at: null },
    new: { id: 'z', status: 'Done', updated_at: 'u2', comments_changed_at: '2026-10-06T10:00:00Z' } };
  vctx._wlV2OnRealtimeChange(stampAndStatus);
  advance(collectMs);
  ok(vctx.checks === 1, 'a stamp that rides with a real change still refetches');
  vctx.checks = 0;
  vctx._wlV2OnRealtimeChange({ eventType: 'UPDATE', old: { id: 'z' }, new: { id: 'z', status: 'Done', comments_changed_at: 'x' } });
  advance(collectMs);
  ok(vctx.checks === 1, 'without a full old image it refetches (the safe direction)');

  // ---- 6. RE-SUBSCRIBE AFTER A DROP (item 5) --------------------------------
  ok(/if \(status !== 'CLOSED'\) _wlV2ScheduleResubscribe\(false\);/.test(subscribe),
    'CHANNEL_ERROR / TIMED_OUT schedule a new channel');
  ok(/if \(_wlV2Channel !== channel\) return;/.test(subscribe),
    'a replaced or torn-down channel\'s late status is ignored');
  ok(/'workload_native' \+ \(_wlV2RetrySerial \? '~' \+ _wlV2RetrySerial : ''\)/.test(subscribe),
    'the replacement gets a fresh topic');
  const resub = extractFunction(html, '_wlV2ScheduleResubscribe');
  ok(/Math\.min\(WL_V2_RT_RETRY_MAX_MS, WL_V2_RT_RETRY_BASE_MS \* Math\.pow\(2, _wlV2RetryAttempt\+\+\)\)/.test(resub)
    && /_wlV2EnsureSubscribed\(\);/.test(resub) && !/_wlV2SubscribedOnce = false/.test(resub),
    'backoff doubles to a cap, and the replacement keeps subscribedOnce so its SUBSCRIBED is a catch-up');
  const teardown = extractFunction(html, '_wlV2Teardown');
  ok(/_wlV2RetryTimer\) \{ clearTimeout\(_wlV2RetryTimer\)/.test(teardown), 'teardown cancels a pending re-subscribe');
  ok(/addEventListener\('online', \(\) => \{\s*if \(_wlV2Channel && document\.querySelector\('\.workload-view'\)\) \{ _wlV2RetryAttempt = 0; _wlV2ScheduleResubscribe\(true\); \}/.test(html),
    'coming back online re-subscribes at once');

  console.log(`PASS workload native realtime: ${checks} focused checks; source + executed collect window, not live proof.`);
})().catch(e => { console.error(e); process.exitCode = 1; });
