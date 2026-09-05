'use strict';
// OFFLINE_TEST only. Extract named production helpers; never evaluate page boot,
// import the live visibility scanner, or provide a real network implementation.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { extractFunction } = require('../../test/helpers/extract-function');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const outbound = fs.readFileSync(path.join(root, 'supabase/functions/linear-outbound/mapping.mjs'), 'utf8');
const statusBlock = outbound.match(/const STATUS_NAMES = Object\.freeze\(\{([\s\S]*?)\}\);/);
if (!statusBlock) throw new Error('SOURCE_STATUS_MAP_CHANGED');
const workStatus = Object.fromEntries([...statusBlock[1].matchAll(/([a-z_]+):\s*"([^"]+)"/g)].map(m => [m[1], m[2]]));
if (Object.keys(workStatus).length !== 13) throw new Error('SOURCE_STATUS_MAP_CHANGED');
function extract(name) {
  const body = extractFunction(source, name);
  const at = source.indexOf('function ' + name + '(');
  return source.slice(at - 6, at) === 'async ' ? 'async ' + body : body;
}
function context(names, values = {}) {
  const ctx = vm.createContext({
    URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
    console: { log() {}, warn() {}, info() {}, error() {}, table() {} },
    fetch: async () => { throw new Error('OFFLINE_NETWORK_FORBIDDEN'); },
    ...values,
  });
  for (const name of names) vm.runInContext(extract(name), ctx);
  return ctx;
}
const statusContext = context(['_calMapNativeStatusStrict']);
function cardStatus(status, surface) {
  return statusContext._calMapNativeStatusStrict(status, surface);
}
function boardContext() {
  const parked = source.match(/const WL_PARKED_STATUSES = new Set\(\[[\s\S]*?\]\);/);
  if (!parked) throw new Error('SOURCE_CONTRACT_CHANGED');
  const ctx = context([
    '_wlV2MapRow', 'wlNormStatus', 'wlIsActiveStatus', 'wlIsInProgress',
    'wlIsTweaksNeeded', 'wlNormalizeEditor', 'wlIsAllowedEditor', 'wlTeamBucket',
    'wlNormalizeClient', 'wlCanonicalClient', 'wlIsAllowedClient', 'wlDisplayName',
    'wlISO', 'wlParseISO', 'wlSubWorkingDays', 'wlAddWorkingDays',
    'wlPlanDate', 'wlAutoPlanDate', 'wlAutoPlacementDate', 'wlDisplayDate',
    'wlWorkloadMeta', 'wlWorkloadWeight', 'wlWorkloadUnits', 'wlEditorCapacity',
    'wlCapacityKey', 'wlComputeAutoPlacements', 'wlBucketByDisplayDate', 'wlApplyData',
  ], {
    wlWorkloadTodayISO: () => '2026-09-07',
    WL_PLACEMENT_WALK_LIMIT: Number(source.match(/const WL_PLACEMENT_WALK_LIMIT\s*=\s*(\d+)/)[1]),
    // Synthetic roster only. The production predicates are unchanged.
    WL_ALLOWED_EDITORS: new Set(['syntheticvideo']),
    WL_ALLOWED_GRAPHICS: new Set(['syntheticgraphics']),
    WL_INACTIVE_EDITORS: new Set(['syntheticinactive']),
    WL_CLIENT_CANONICAL: new Map([['syntheticclient', 'Synthetic Client']]),
    wlState: { planByIssueId: new Map(), autoPlacementByIssueId: new Map(),
      workloadByIssueId: new Map(), planHasSnapshot: true, planLoading: false },
  });
  vm.runInContext(parked[0], ctx);
  return ctx;
}
module.exports = { root, source, extract, context, boardContext, cardStatus, workStatus };
