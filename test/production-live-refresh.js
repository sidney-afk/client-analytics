'use strict';
/*
 * Slice 5 — blocker #9 (F95) plus the read-path fix it depends on.
 *
 * F95 required a bounded foreground refresh with last-success age, visible
 * degraded state, backoff, and a manual Retry that preserves drafts and
 * position. Adding a refresh loop on top of the shipped read path would have
 * made the existing anon statement-timeout failure worse, so the read path is
 * part of the same contract:
 *
 *   - the deliverable projection paginates by primary-key keyset, never OFFSET,
 *     and never issues a parallel page burst;
 *   - the loop asks for a delta by updated_at watermark, not a re-pull;
 *   - the migration that halves the per-row projection cost is source-only and
 *     preserves the exact browser column contract.
 *
 * Offline: index.html and the migration file are read as text; the refresh
 * helpers are executed in a sandbox. No network, no credentials, no database.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const MIGRATION = path.join(ROOT, 'migrations/2026-07-25-slice5-production-read-path.sql');
const CURRENT_VIEW = path.join(ROOT, 'migrations/2026-07-23-f34-f53-production-attachments.sql');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function extract(name) {
  const match = new RegExp(`function\\s+${name}\\s*\\(`).exec(source);
  if (!match) throw new Error(`missing ${name}`);
  const start = match.index;
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unclosed ${name}`);
}

// ---- read path: keyset pagination, no burst -------------------------------
const restRows = extract('_prodRestRows');
ok(/const width = page === 0 \? 1 : Math\.min\(4, cap - page\)/.test(restRows),
  'the generic offset pager keeps its existing 4-wide behaviour for small tables');
ok(/if \(keysetColumn\) \{/.test(restRows)
  && restRows.indexOf('if (keysetColumn) {') < restRows.indexOf('const width = page === 0'),
'the keyset branch returns before the parallel-burst pager can run');
ok(/const batch = await _prodRestPage\(url, table, page\)/.test(restRows)
  && !/Promise\.all/.test(restRows.slice(restRows.indexOf('if (keysetColumn) {'), restRows.indexOf('const pageUrl = page =>'))),
'the keyset walk is strictly sequential and issues no concurrent page request');
ok(/keyset read stalled/.test(restRows) && /read exceeded pagination cap/.test(restRows),
  'a non-advancing cursor and an exhausted page cap both throw instead of silently truncating');
ok(/\.filter\(p => p && !\/\^order=\/\.test\(p\)\)/.test(restRows),
  'a caller-supplied order is stripped in keyset mode so the cursor column owns the ordering');

const projectionLoader = extract('_prodLoadDeliverableProjection');
ok(/\{ keysetColumn: 'id' \}/.test(projectionLoader)
  && !/order=team\.asc/.test(projectionLoader),
'the deliverable projection walks the primary key instead of the old three-column sort');
ok((projectionLoader.match(/\{ keysetColumn: 'id' \}/g) || []).length === 2,
  'the release-transition legacy fallback uses the same keyset walk');

// ---- F95: the delta loop ---------------------------------------------------
const deltaRefresh = extract('_prodDeltaRefresh');
ok(/updated_at=gte\.' \+ encodeURIComponent\(watermark\)/.test(deltaRefresh),
  'the tick asks only for rows at or after the watermark it already holds');
ok(/if \(_prodState\.writes && _prodState\.writes\.size\) return null/.test(deltaRefresh),
  'a refresh never runs under an in-flight write');
// _prodOpenRowId() since 2026-08-31 — a deep link leaves the Linear
// identifier in openId while the panel renders from the canonical row id.
ok(/_prodComments\.refresh\(_prodOpenRowId\(\)\)/.test(deltaRefresh),
  'the open comment thread refreshes on the same tick as the row projection');
ok(/_prodInvalidateScopedReadsFor\(changedIds\)/.test(deltaRefresh)
  && !/_prodInvalidateScopedReads\(\)/.test(deltaRefresh),
'only the rows that actually changed have their scoped reads invalidated');
ok(/PROD_FULL_RECONCILE_MS/.test(deltaRefresh),
  'a slower full reconcile still runs so hard deletions converge');
ok(/status === 401 \|\| status === 403/.test(deltaRefresh),
  'a refused refresh reports an authorization failure rather than a generic retry');
ok(/if \(!opts\.force && _prodRefreshBusy\(\)\) return null/.test(deltaRefresh)
  && /let repaint = false/.test(deltaRefresh)
  && /if \(repaint && document\.getElementById\('prodRoot'\)\) _prodRender\(\);/.test(deltaRefresh),
'a background tick is skipped while a menu is open and repaints only when something changed');
const busy = extract('_prodRefreshBusy');
ok(/layer && layer\.childElementCount/.test(busy) && /_prodState\.writes\.size/.test(busy),
  'an open picker layer or an in-flight write defers the tick to the next interval');

const invalidateFor = extract('_prodInvalidateScopedReadsFor');
ok(/if \(asset && !asset\.editing && !asset\.saving\)/.test(invalidateFor)
  && /if \(description && !description\.editing && !description\.saving\)/.test(invalidateFor)
  && /description\.status = description\.hasValue \? 'stale' : 'idle'/.test(invalidateFor)
  && /description\.remoteChanged = true/.test(invalidateFor),
'an open editor keeps its draft and is marked stale instead of being discarded');

const startLoop = extract('_prodStartOperationalRefresh');
ok(/document\.hidden \|\| currentNav !== 'production' \|\| !document\.getElementById\('prodRoot'\)/.test(startLoop),
  'the loop is skipped while the tab is hidden or Production is not mounted');
const delay = extract('_prodOperationalRefreshDelay');
ok(/Math\.min\(PROD_REFRESH_MAX_BACKOFF_MS, PROD_DELTA_REFRESH_MS \* Math\.pow\(2, failures\)\)/.test(delay),
  'consecutive failures back off exponentially to a bounded ceiling');

// ---- F95: visible age, degraded state, and manual retry --------------------
const freshness = extract('_prodFreshnessHTML');
ok(/data-prod-freshness="' \+ \(degraded \? 'degraded' : 'fresh'\)/.test(freshness)
  && /aria-live="polite"/.test(freshness)
  && /aria-label="Refresh Production data"/.test(freshness)
  && /<button class="prod-icon-btn" type="button" data-prod-refresh="1"/.test(freshness),
'the freshness surface exposes a machine-readable state, a live-region age, and a labelled button');
ok(/_prodManualRefresh\(\)/.test(freshness),
  'the manual control is a real button with an accessible name, reachable by keyboard and touch');
ok(/\.prod-freshness-age \{ display: none; \}/.test(source),
  'at touch widths the age text collapses while the Refresh button stays reachable');
ok((source.match(/_prodFreshnessHTML\(\)/g) || []).length >= 4,
  'the freshness control is present on the list, project, and detail top bars');

const ageContext = vm.createContext({ _prodState: { lastSyncAt: 0, lastSyncError: '' }, Date });
vm.runInContext([
  'globalThis.PROD_STALE_AFTER_MS = 120000;',
  extract('_prodRefreshAgeMs'),
  extract('_prodRefreshDegraded'),
  extract('_prodRefreshAgeLabel'),
  extract('_prodRowUpdatedMs'),
  extract('_prodDeliverableWatermark'),
].join('\n'), ageContext);
ok(ageContext._prodRefreshAgeMs() === -1 && ageContext._prodRefreshAgeLabel() === 'not yet synced',
  'a page that has never synced says so instead of claiming freshness');
ageContext._prodState.lastSyncAt = Date.now() - 5000;
ok(!ageContext._prodRefreshDegraded() && /updated \d+s ago/.test(ageContext._prodRefreshAgeLabel()),
  'a recent success is reported in seconds and is not degraded');
ageContext._prodState.lastSyncAt = Date.now() - 5 * 60 * 1000;
ok(ageContext._prodRefreshDegraded() && /updated 5m ago/.test(ageContext._prodRefreshAgeLabel()),
  'crossing the staleness threshold flips the surface to degraded');
ageContext._prodState.lastSyncAt = Date.now();
ageContext._prodState.lastSyncError = 'Live updates are failing. Retry to catch up.';
ok(ageContext._prodRefreshDegraded(),
  'a failed refresh is degraded even when the last success is recent');

ok(ageContext._prodDeliverableWatermark([
  { updated_at: '2026-07-25T10:00:00+00:00' },
  { updated_at: '2026-07-25T12:00:00.5+00:00' },
  { updated_at: '2026-07-25T11:59:59+00:00' },
  { updated_at: null },
  {},
]) === '2026-07-25T12:00:00.5+00:00',
'the watermark is the newest parsed updated_at and ignores missing values');
ok(ageContext._prodDeliverableWatermark([]) === '' && ageContext._prodDeliverableWatermark(null) === '',
  'an empty projection yields no watermark, which forces a full read');

const merge = extract('_prodMergeDeliverableRows');
ok(/if \(previous && String\(previous\.updated_at \|\| ''\) === String\(row\.updated_at \|\| ''\)\)/.test(merge),
  'the inclusive watermark boundary re-reads the newest row without reporting it as changed');

// ---- migration: source-only, byte-identical browser contract ---------------
ok(fs.existsSync(MIGRATION), 'the read-path migration exists as a source-only file');
const migration = fs.readFileSync(MIGRATION, 'utf8');
const currentViewFile = fs.readFileSync(CURRENT_VIEW, 'utf8');

function browserColumns(text) {
  const start = text.indexOf('production_deliverables_browser_v1');
  const from = text.indexOf('from public.deliverables d', start);
  return [...text.slice(start, from).matchAll(/\bas ([a-z_0-9]+),?\n/g)].map(match => match[1]);
}
const before = browserColumns(currentViewFile);
const after = browserColumns(migration);
ok(before.length > 0 && JSON.stringify(before) === JSON.stringify(after),
  'the replacement view derives the same aliased columns, in the same order, as the shipped definition');

ok(/create or replace view public\.production_deliverables_browser_v1/.test(migration)
  && /with \(security_barrier = true\)/.test(migration),
'the view is replaced in place, preserving its grants and security_barrier property');
ok(/jsonb_to_record\(\s*case when jsonb_typeof\(d\.linear_raw\) = 'object' then d\.linear_raw else '\{\}'::jsonb end\s*\)/.test(migration),
  'the single detoast is guarded so a scalar or array linear_raw cannot error the whole read');
ok(/public\.production_workload_label_projection\(d\.linear_raw\)/.test(migration),
  'the Workload label lateral is left byte-identical so its completeness contract is untouched');
ok(/create index if not exists deliverables_updated_at_idx/.test(migration),
  'the delta predicate gets its own additive index');
// Statements only: the file's prose deliberately names what it does not touch.
const migrationStatements = migration.split('\n')
  .filter(line => !/^\s*--/.test(line)).join('\n');
ok(!/\b(drop table|drop column|alter column|truncate|delete from|update public\.)/i.test(migrationStatements),
  'the migration drops, rewrites, and backfills nothing');
ok(!/calendar_upsert|sample_review_upsert|calendar-upsert|sample-review-upsert/.test(migrationStatements),
  'no executable statement touches either frozen writer');
ok(!/\bgrant\b|\brevoke\b|syncview_runtime_flags/i.test(migrationStatements),
  'the migration changes no grant and no runtime flag');
ok(/SOURCE-ONLY/.test(migration) && /Owner-only rollback/.test(migration),
  'the migration declares its source-only status and carries a rollback recipe');
ok(/composite index on deliverables\(team, status, due_date\)[\s\S]{0,200}does not help/.test(migration),
  'the rejected index candidate is recorded with its measurement, not silently dropped');

if (failures) {
  console.error(`\nproduction-live-refresh: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nproduction-live-refresh: F95 refresh + read-path contracts passed');
