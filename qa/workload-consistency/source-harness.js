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
function workloadEligibility(native, roster) {
  // A supplied roster is evidence, not an inferred copy of current membership.
  // Membership roles/team flags do not themselves drive wlIsAllowedEditor.
  const unknown = { state: 'unknown' };
  if (!roster || roster.complete !== true || !['clientNames', 'videoEditors', 'graphicsEditors', 'inactiveEditors']
    .every(key => Array.isArray(roster[key]) && roster[key].every(value => typeof value === 'string' && value.trim()))) return unknown;
  if (typeof native.workloadClientName !== 'string' || !native.workloadClientName.trim()) return unknown;
  const ctx = boardContext();
  ctx.WL_CLIENT_CANONICAL = new Map(roster.clientNames.map(name => [ctx.wlNormalizeClient(name), name]));
  ctx.WL_ALLOWED_EDITORS = new Set(roster.videoEditors.map(ctx.wlNormalizeEditor));
  ctx.WL_ALLOWED_GRAPHICS = new Set(roster.graphicsEditors.map(ctx.wlNormalizeEditor));
  ctx.WL_INACTIVE_EDITORS = new Set(roster.inactiveEditors.map(ctx.wlNormalizeEditor));
  if (!ctx.wlIsAllowedClient(native.workloadClientName)) return { state: 'excluded' };
  if (!Object.prototype.hasOwnProperty.call(native, 'ownerId')
    || !(native.ownerId === null || typeof native.ownerId === 'string')) return unknown;
  const assigned = Boolean(String(native.ownerId || '').trim());
  if (assigned && (!['video', 'graphics'].includes(native.team)
    || typeof native.workloadAssigneeName !== 'string' || !native.workloadAssigneeName.trim())) return unknown;
  const validDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.slice(0, 10))
    && Number.isFinite(Date.parse(value.slice(0, 10)))
    && new Date(value.slice(0, 10)).toISOString().slice(0, 10) === value.slice(0, 10);
  const absent = value => value === null || value === '';
  // For an assigned item the undated strip remains visible; for In Progress
  // the unassigned strip remains visible. Only unassigned non-In-Progress work
  // needs proof that a work day exists, or that BOTH date sources are absent.
  if (!assigned && native.status !== 'in_progress'
    && !validDay(native.dueDate) && !validDay(native.workloadPlanDate)
    && !(absent(native.dueDate) && absent(native.workloadPlanDate))) return unknown;
  const sub = { id: String(native.id), isSubIssue: true, status: workStatus[native.status],
    statusType: native.status === 'todo' ? 'unstarted' : 'started',
    clientName: native.workloadClientName, assigneeId: native.ownerId,
    assigneeName: native.workloadAssigneeName, teamKey: native.team === 'graphics' ? 'GRA' : 'VID',
    teamName: native.team === 'graphics' ? 'Graphics' : 'Video',
    dueDate: validDay(native.dueDate) ? native.dueDate.slice(0, 10) : null };
  if (validDay(native.workloadPlanDate)) ctx.wlState.planByIssueId.set(sub.id, native.workloadPlanDate.slice(0, 10));
  ctx.wlApplyData([sub], 0);
  if (ctx.wlState.excluded.noAssigneeNoDate.length || ctx.wlState.excluded.offTeamAssignee.length) return { state: 'excluded' };
  return ['planned', 'nowWorking', 'tweaksNeeded', 'overdue', 'undated', 'unassigned']
    .some(key => ctx.wlState[key].length) ? { state: 'eligible' } : unknown;
}
module.exports = { root, source, extract, context, boardContext, cardStatus, workStatus, workloadEligibility };
