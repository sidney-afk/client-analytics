'use strict';
/*
 * OPEN_REPAIRS 95 / 224 (see docs/ops/WORKLOAD_NATIVE_SOURCE.md): the Workload
 * board's native read (`wlFetchNativeSnapshot`, workload-plan's
 * `native_snapshot` action) excludes a row only when its BATCH is archived
 * (`workload_issues_native_v1.active`). It never reads the deliverable's own
 * Linear archive/delete state, so a deliverable whose own issue was archived
 * in Linear -- while its batch stays active -- reached the board as live
 * work, while Production (`_prodDeliverableLive`,
 * src/index/210-production-state-writes.js.part) already refused the same
 * row. This pins the fix: Workload now reuses `_prodDeliverableLive` itself
 * (both live in the one top-level <script> assembled from src/index/, so the
 * function is hoisted and callable across the 070/210 file split -- no
 * duplicate rule, no extract needed) against a second, independent browser
 * read of the same public `production_deliverables_browser_v1` view.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('node:assert/strict');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  // `async function NAME(` matches the same 'function NAME(' search above at
  // a later offset; the prefix is restored so an extracted async function
  // keeps its keyword (it is otherwise valid syntax on its own, just no
  // longer async -- and its `await` calls would then throw at parse time).
  const isAsync = INDEX.slice(Math.max(0, at - 6), at) === 'async ';
  let depth = 0, quote = '', escaped = false, comment = '';
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const c = INDEX[j], next = INDEX[j + 1];
    if (comment) {
      if (comment === 'line' && c === '\n') comment = '';
      else if (comment === 'block' && c === '*' && next === '/') { comment = ''; j++; }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '/' && next === '/') { comment = 'line'; j++; continue; }
    if (c === '/' && next === '*') { comment = 'block'; j++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return (isAsync ? 'async ' : '') + INDEX.slice(at, j + 1); }
  }
  throw new Error('unclosed ' + name);
}

function grabConst(name) {
  const at = INDEX.indexOf('const ' + name + ' ');
  if (at < 0) throw new Error('const not found: ' + name);
  let depth = 0;
  for (let i = at; i < INDEX.length; i++) {
    const c = INDEX[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ';' && depth === 0) return INDEX.slice(at, i + 1);
  }
  throw new Error('unterminated const: ' + name);
}

// --- structural checks: the fix is a reused function, not a second copy ----

const snapshotBlock = grabFunc('wlFetchNativeSnapshot');
ok(/const archivedNativeIds = await _wlArchivedNativeIds\(value\.rows\);/.test(snapshotBlock),
  'the native snapshot reader computes archived native ids before building issues');
ok(/for \(const row of rows\) \{/.test(snapshotBlock) && !/for \(const row of value\.rows\) \{/.test(snapshotBlock),
  'the row loop walks the FILTERED array, not the raw server payload');

const archivedIdsBlock = grabFunc('_wlArchivedNativeIds');
ok(/_prodDeliverableLive\(row\)/.test(archivedIdsBlock),
  'archive membership is decided by calling _prodDeliverableLive itself, not a rewritten copy of its rule');
ok(!/raw_issue_archived_at/.test(archivedIdsBlock),
  'the marker names themselves are not re-tested here -- that knowledge stays inside _prodDeliverableLive alone');

const applyDataBlock = grabFunc('wlApplyData');
ok(/const excluded = \{ noAssigneeNoDate: \[\], offTeamAssignee: \[\] \};/.test(applyDataBlock),
  'the "not shown here" footer bucket still only knows about two reasons -- archived rows are not a third one folded in');

// --- behavioural checks: _prodDeliverableLive reused against a live shape --

const prodCtx = {};
vm.createContext(prodCtx);
vm.runInContext([
  grabFunc('_prodHasOwn'),
  grabFunc('_prodNormKey'),
  grabFunc('_prodLinearRaw'),
  grabFunc('_prodRawHasAny'),
  grabFunc('_prodRawMarkerTruthy'),
  grabFunc('_prodDeliverableLive'),
  'this._prodDeliverableLive = _prodDeliverableLive;',
].join('\n'), prodCtx);
const live = prodCtx._prodDeliverableLive;

const baseRow = () => ({
  id: 'del_test', status: 'in_progress',
  raw_issue_archived_at: null, raw_issue_canceled_at: null,
  raw_webhook_delete: null, raw_deleted: null, raw_delete: null,
  raw_removed: null, raw_archived: null,
});

ok(live(baseRow()) === true,
  '(b) a live, non-archived row is not excluded by the reused Production rule');
ok(live({ ...baseRow(), raw_issue_archived_at: '2026-08-17T05:00:55.662Z' }) === false,
  '(a) a row whose Linear issue carries an archivedAt timestamp is excluded');
ok(live({ ...baseRow(), raw_webhook_delete: true }) === false,
  'a webhook-delete marker excludes it exactly as Production treats it');
ok(live({ ...baseRow(), status: 'canceled' }) === true,
  'canceled is a visible status on both surfaces -- only archive/delete markers hide a row (per _prodDeliverableLive\'s own comment)');

// (c) a native row created after the 2026-09-20 cutoff carries no Linear
// archive state at all: production_deliverables_browser_v1 answers every
// raw_* column as null for it, the same shape as an ordinary live row above.
const postCutoffRow = { id: 'del_post_cutoff', status: 'todo',
  raw_issue_archived_at: null, raw_issue_canceled_at: null,
  raw_webhook_delete: null, raw_deleted: null, raw_delete: null,
  raw_removed: null, raw_archived: null };
ok(live(postCutoffRow) === true,
  '(c) a post-cutoff native row with no archive state at all is not excluded');

// --- behavioural checks: _wlArchivedNativeIds end to end, fetch mocked -----

function runArchivedNativeIds(rows, markerRowsByChunk) {
  const ctx = {
    console, CAL_SUPABASE_URL: 'https://example.supabase.co', CAL_SUPABASE_ANON_KEY: 'anon-key',
    AbortController, setTimeout, clearTimeout,
  };
  vm.createContext(ctx);
  const calls = [];
  ctx.fetch = async (url) => {
    calls.push(url);
    const match = /id=in\.\(([^)]*)\)/.exec(decodeURIComponent(url));
    const idsInUrl = match ? match[1].split(',').map(s => s.replace(/^"|"$/g, '')) : [];
    const answer = (markerRowsByChunk || []).filter(r => idsInUrl.includes(r.id));
    return { ok: true, json: async () => answer };
  };
  vm.runInContext([
    grabFunc('_prodHasOwn'),
    grabFunc('_prodNormKey'),
    grabFunc('_prodLinearRaw'),
    grabFunc('_prodRawHasAny'),
    grabFunc('_prodRawMarkerTruthy'),
    grabFunc('_prodDeliverableLive'),
    grabFunc('_prodHeaders'),
    grabConst('WL_ARCHIVE_MARKER_SELECT'),
    grabConst('WL_PLAN_READ_TIMEOUT_MS'),
    grabFunc('_wlFetchArchiveMarkerRows'),
    grabFunc('_wlArchivedNativeIds'),
    'this.run = (rows) => _wlArchivedNativeIds(rows);',
  ].join('\n'), ctx);
  return { result: ctx.run(rows), calls };
}

async function runAsyncChecks() {
  {
    const rows = [
      { id: 'del_archived', source: 'native', is_sub_issue: true },
      { id: 'del_live', source: 'native', is_sub_issue: true },
      { id: 'bat_parent', source: 'native', is_sub_issue: false },     // parents are never checked
      { id: 'legacy-uuid', source: 'legacy', is_sub_issue: true },     // legacy rows are out of scope
    ];
    const markerRows = [
      { ...baseRow(), id: 'del_archived', raw_issue_archived_at: '2026-08-17T05:00:55.662Z' },
      { ...baseRow(), id: 'del_live' },
    ];
    const archived = await runArchivedNativeIds(rows, markerRows).result;
    ok(archived.has('del_archived') === true, '(a) the archived native sub-issue id is reported as excluded');
    ok(archived.has('del_live') === false, '(b) the live native sub-issue id is not reported as excluded');
    ok(archived.has('bat_parent') === false && archived.has('legacy-uuid') === false,
      'a batch parent and a legacy (non-native) row are never sent to the archive-marker read at all');
  }

  {
    // (c) again, at the fetch layer: a post-cutoff row with a native id but no
    // recorded archive state anywhere must survive the round trip untouched.
    const rows = [{ id: 'del_post_cutoff', source: 'native', is_sub_issue: true }];
    const markerRows = [postCutoffRow];
    const archived = await runArchivedNativeIds(rows, markerRows).result;
    ok(archived.size === 0, '(c) a post-cutoff native row with no archive state is not excluded via the live fetch path');
  }

  {
    // A failed archive-marker read must never blank or shrink the board: the
    // permissive default this file's own comment cites (AGENTS.md).
    const ctx = {
      console, CAL_SUPABASE_URL: 'https://example.supabase.co', CAL_SUPABASE_ANON_KEY: 'anon-key',
      AbortController, setTimeout, clearTimeout,
    };
    vm.createContext(ctx);
    ctx.fetch = async () => { throw new Error('network down'); };
    vm.runInContext([
      grabFunc('_prodHasOwn'), grabFunc('_prodNormKey'), grabFunc('_prodLinearRaw'),
      grabFunc('_prodRawHasAny'), grabFunc('_prodRawMarkerTruthy'), grabFunc('_prodDeliverableLive'),
      grabFunc('_prodHeaders'), grabConst('WL_ARCHIVE_MARKER_SELECT'), grabConst('WL_PLAN_READ_TIMEOUT_MS'),
      grabFunc('_wlFetchArchiveMarkerRows'), grabFunc('_wlArchivedNativeIds'),
      'this.run = (rows) => _wlArchivedNativeIds(rows);',
    ].join('\n'), ctx);
    const archived = await ctx.run([{ id: 'del_x', source: 'native', is_sub_issue: true }]);
    ok(archived.size === 0, 'a failed archive-marker read leaves every row unfiltered rather than hiding the whole board');
  }

  {
    // A hung request (overloaded/half-open connection, never rejects and
    // never resolves on its own) must still be bounded: the archive-marker
    // fetch gets the same AbortController timeout as the primary
    // workload-plan fetch, so Promise.all settles and the fail-open catch in
    // _wlArchivedNativeIds actually runs, instead of leaving a cold Workload
    // load pending on the archive check forever. `ctx.setTimeout` here fires
    // immediately (0ms) rather than waiting out the real WL_PLAN_READ_TIMEOUT_MS,
    // so the test proves the wiring without taking the real timeout to run.
    let aborted = false;
    const ctx = {
      console, CAL_SUPABASE_URL: 'https://example.supabase.co', CAL_SUPABASE_ANON_KEY: 'anon-key',
      AbortController,
      setTimeout: (fn) => setTimeout(fn, 0),
      clearTimeout,
    };
    vm.createContext(ctx);
    ctx.fetch = (url, opts) => new Promise((resolve, reject) => {
      const signal = opts && opts.signal;
      if (signal) signal.addEventListener('abort', () => { aborted = true; reject(new Error('AbortError')); });
      // Never resolves and never rejects on its own -- simulates a hung connection.
    });
    vm.runInContext([
      grabFunc('_prodHasOwn'), grabFunc('_prodNormKey'), grabFunc('_prodLinearRaw'),
      grabFunc('_prodRawHasAny'), grabFunc('_prodRawMarkerTruthy'), grabFunc('_prodDeliverableLive'),
      grabFunc('_prodHeaders'), grabConst('WL_ARCHIVE_MARKER_SELECT'), grabConst('WL_PLAN_READ_TIMEOUT_MS'),
      grabFunc('_wlFetchArchiveMarkerRows'), grabFunc('_wlArchivedNativeIds'),
      'this.run = (rows) => _wlArchivedNativeIds(rows);',
    ].join('\n'), ctx);
    const archived = await ctx.run([{ id: 'del_hang', source: 'native', is_sub_issue: true }]);
    ok(aborted === true, 'a hung archive-marker request is aborted by the bounded timeout instead of hanging forever');
    ok(archived.size === 0, 'the aborted request still resolves the board via the fail-open path, not a stuck Promise.all');
  }

  console.log(failures === 0
    ? '\nWorkload archived-in-Linear hiding checks passed'
    : '\n' + failures + ' workload archived-hiding check(s) failed');
  process.exit(failures === 0 ? 0 : 1);
}

runAsyncChecks().catch(e => {
  console.error('FAIL  unexpected error running async checks', e);
  process.exit(1);
});
