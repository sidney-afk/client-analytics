'use strict';
/*
 * Archived cards and samples: see them and restore one
 * (docs/plans/2026-09-29-calendar-unarchive.md, owner decisions D1 to D6).
 *
 * Executes the REAL helpers from index.html in a sandbox and proves:
 *   - who may use it: admin and SMM with a verified staff identity; never a
 *     creative seat, never a client link, never an unverified identity (D6);
 *   - the list pages by a cursor: no repeats, no skips, ties on updated_at
 *     included, the window widens 30 -> 60 -> 90 days only when used up, and
 *     stops at 90 (D3);
 *   - the work item rules: exact prior status, "already in Backlog" -> To do,
 *     no record -> To do, finished stays, moved-since left alone (D2 + A1);
 *   - a live card sharing a work item blocks the restore (D5);
 *   - the position rule and the status it returns to;
 *   - source shape: no direct table write, the menu is gated, the client
 *     approve / request-changes paths and the frozen writers are not touched.
 * Fixture names only; this repo is public.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const fragment = fs.readFileSync(path.join(ROOT, 'src/index/186-archived-restore.js.part'), 'utf8');
let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}
function extractFn(name) {
  let start = source.indexOf('async function ' + name + '(');
  if (start < 0) start = source.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('missing function: ' + name);
  let depth = 0, seen = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') { depth++; seen = true; }
    else if (ch === '}') { depth--; if (seen && depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error('unterminated function: ' + name);
}
function extractConst(name) {
  const m = new RegExp('const ' + name + '\\s*=').exec(source);
  if (!m) throw new Error('missing const: ' + name);
  const start = m.index;
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') depth--;
    else if (ch === ';' && depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unterminated const: ' + name);
}

// ── the region of index.html that is this feature, plus the real status rules ──
const regionStart = source.indexOf('const ARX_WINDOW_DAYS');
const regionEnd = (() => {
  const s = source.indexOf('async function _arxRestore(');
  return s + extractFn('_arxRestore').length;
})();
ok(regionStart > 0 && regionEnd > regionStart, 'the feature is in the built page');
const region = source.slice(regionStart, regionEnd);

const identity = { current: { role: 'smm', valid: true }, clientLink: false };
const sandbox = {
  console, Date, Math, JSON, Promise, Number, String, Array, Object, Set, encodeURIComponent, Error,
  _isClientLink: false,
  CAL_SUPABASE_URL: 'https://example.invalid', CAL_SUPABASE_ANON_KEY: 'anon',
  _syncviewStaffIdentityValid: () => identity.current.valid,
  _syncviewStaffIdentityForHeaders: () => (identity.current.valid ? { role: identity.current.role } : null)
};
vm.createContext(sandbox);
const statusRules = [
  extractConst('CAL_STATUSES'), extractConst('CAL_PRIORITY'), extractConst('CAL_COMPONENTS'), extractFn('_calNormStatus'), extractFn('computeOverallStatus'),
  extractConst('SXR_STATUSES'), extractConst('SXR_COMPONENTS'), extractConst('SXR_PRIORITY'), extractFn('_sxrNormStatus'), extractFn('computeSampleOverallStatus'),
  extractFn('_syncviewStaffRoleValue'), extractFn('_syncviewStaffCan')
].join('\n');
vm.runInContext(statusRules + '\n' + region + '\nthis.__t = { _arxCan, _arxNextPage, _arxWorkItemPlan, _arxDuplicateOwner, _arxOrderSlot, _arxRestoreStatus, _arxListQuery, _arxIsFinished, _arxLabel, ARX_WINDOW_DAYS, ARX_PAGE };', sandbox);
const T = sandbox.__t;

// ── 1. who may use it ──
console.log('who may restore');
function can(role, valid, clientLink) {
  identity.current = { role, valid };
  vm.runInContext('_isClientLink = ' + (clientLink ? 'true' : 'false') + ';', sandbox);
  return T._arxCan();
}
ok(can('admin', true, false) === true, 'admin can');
ok(can('smm', true, false) === true, 'smm can');
ok(can('creative', true, false) === false, 'a creative seat cannot');
ok(can('admin', true, true) === false, 'a client link cannot, even with an admin identity in storage');
ok(can('smm', false, false) === false, 'an unverified staff identity cannot');
ok(can('', true, false) === false, 'a role-less identity cannot');
vm.runInContext('_isClientLink = false;', sandbox);
identity.current = { role: 'smm', valid: true };

// ── 2. the status a restored card returns to ──
console.log('status it returns to');
ok(T._arxRestoreStatus('cal', { video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Approved' }) === 'Approved', 'calendar: all approved -> Approved');
ok(T._arxRestoreStatus('cal', { video_status: 'Approved', graphic_status: 'In Progress', caption_status: 'Approved' }) === 'In Progress', 'calendar: the least advanced component wins');
ok(T._arxRestoreStatus('cal', { video_status: 'Client Approval', graphic_status: 'Tweaks Needed', caption_status: 'Approved' }) === 'Tweaks Needed', 'calendar: tweaks outrank the rest');
ok(T._arxRestoreStatus('cal', {}) === 'In Progress', 'calendar: no component statuses -> In Progress');
ok(T._arxRestoreStatus('sxr', { video_status: 'Approved', graphic_status: 'Client Approval' }) === 'Client Approval', 'samples: worst of video and thumbnail');
ok(T._arxRestoreStatus('cal', { video_status: 'Approved', status: 'Archived' }) !== 'Archived' && T._arxRestoreStatus('sxr', { status: 'Archived' }) !== 'Archived', 'never returns Archived');

// ── 3. paging ──
console.log('paging by cursor');
const NOW = Date.parse('2026-09-29T12:00:00Z');
const dayIso = (d, plusMs) => new Date(NOW - d * 86400000 + (plusMs || 0)).toISOString();
const realNow = Date.now;
function makeTable() {
  const rows = [];
  for (let i = 0; i < 60; i++) rows.push({ id: 'r' + String(i).padStart(3, '0'), updated_at: dayIso(1, -i * 1000) });   // 60 inside 30 days
  rows.push({ id: 'a1', updated_at: dayIso(1, -70000) }, { id: 'a2', updated_at: dayIso(1, -70000) }, { id: 'a3', updated_at: dayIso(1, -70000) }); // ties
  rows.push({ id: 'm45', updated_at: dayIso(45) }, { id: 'm80', updated_at: dayIso(80) }, { id: 'm100', updated_at: dayIso(100) });
  return rows;
}
async function walk() {
  const table = makeTable();
  const fetchPage = async (floorIdx, cursor) => {
    const floor = NOW - T.ARX_WINDOW_DAYS[floorIdx] * 86400000;
    return table.filter(r => Date.parse(r.updated_at) >= floor
      && (!cursor || Date.parse(r.updated_at) < Date.parse(cursor.updated_at) || (r.updated_at === cursor.updated_at && r.id < cursor.id)))
      .sort((a, b) => (Date.parse(b.updated_at) - Date.parse(a.updated_at)) || (a.id < b.id ? 1 : -1)).slice(0, T.ARX_PAGE + 1);
  };
  const seen = [];
  let st = { floorIdx: 0, cursor: null }; let more = { hasMore: false, canWiden: false };
  const sizes = [];
  for (let i = 0; i < 20; i++) {
    const start = i === 0 ? Object.assign({ skipEmpty: false }, st) : (more.canWiden ? { floorIdx: Math.min(st.floorIdx + 1, T.ARX_WINDOW_DAYS.length - 1), cursor: st.cursor, skipEmpty: true } : Object.assign({ skipEmpty: true }, st));
    const page = await T._arxNextPage(start, fetchPage);
    page.rows.forEach(r => seen.push(r.id));
    sizes.push(page.rows.length);
    st = { floorIdx: page.floorIdx, cursor: page.cursor }; more = page;
    if (!page.hasMore && !page.canWiden) break;
  }
  return { seen, sizes, table };
}
walk().then(({ seen, sizes }) => {
  ok(new Set(seen).size === seen.length, 'no row is shown twice (' + seen.length + ' rows)');
  ok(['a1', 'a2', 'a3'].every(id => seen.includes(id)), 'rows sharing one updated_at across a page edge are all shown');
  ok(seen.includes('m45') && seen.includes('m80'), 'the window widens to reach 45 and 80 day old rows');
  ok(!seen.includes('m100'), 'paging stops at 90 days');
  ok(seen.filter(id => id.startsWith('r')).length === 60, 'all 60 rows of the first 30 days come first, in pages of 25');
  ok(sizes[0] === 25 && sizes[1] === 25, 'page size is 25 (' + sizes.join(',') + ')');
  const q = T._arxListQuery('cal', 'a b', '2026-08-30T00:00:00.000Z', { updated_at: '2026-09-28T11:59:00+00:00', id: 'r9' });
  ok(q.startsWith('calendar_posts?') && q.includes('status=eq.Archived') && q.includes('client=eq.a%20b') && q.includes('limit=26') && q.includes('order=updated_at.desc,id.desc'), 'calendar query is one client, archived only, newest first, one spare row');
  ok(q.includes('or=(updated_at.lt.2026-09-28T11%3A59%3A00%2B00%3A00,and(updated_at.eq.2026-09-28T11%3A59%3A00%2B00%3A00,id.lt.r9))'), 'the cursor clause is strictly older, id breaks ties');
  ok(T._arxListQuery('sxr', 's', '2026-08-30T00:00:00.000Z', null).startsWith('sample_reviews?') && !T._arxListQuery('sxr', 's', 'x', null).includes('or='), 'samples read sample_reviews; the first page has no cursor');
  emptyFirst().then(rest);
});
async function emptyFirst() {
  const table = [{ id: 'x45', updated_at: dayIso(45) }, { id: 'x70', updated_at: dayIso(70) }];
  const fetchPage = async (floorIdx, cursor) => table.filter(r => Date.parse(r.updated_at) >= NOW - T.ARX_WINDOW_DAYS[floorIdx] * 86400000
    && (!cursor || Date.parse(r.updated_at) < Date.parse(cursor.updated_at))).sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)).slice(0, T.ARX_PAGE + 1);
  const first = await T._arxNextPage({ floorIdx: 0, cursor: null, skipEmpty: false }, fetchPage);
  ok(first.rows.length === 0 && first.floorIdx === 0 && first.canWiden === true, 'nothing in the first 30 days: the empty state stays on 30 days and offers Show older');
  const second = await T._arxNextPage({ floorIdx: 1, cursor: first.cursor, skipEmpty: true }, fetchPage);
  ok(second.rows.map(r => r.id).join() === 'x45' && second.floorIdx === 1, 'Show older then finds the 45 day old item');
  const third = await T._arxNextPage({ floorIdx: 2, cursor: second.cursor, skipEmpty: true }, fetchPage);
  ok(third.rows.map(r => r.id).join() === 'x70' && third.canWiden === false && third.hasMore === false, 'and the 70 day old one, then nothing is left');
}

function rest() {
  // ── 4. work items ──
  console.log('work items (plan 3.4, rules 1 to 6)');
  const archivedAt = Date.parse('2026-09-28T10:00:00Z');
  const ev = (over) => Object.assign({ ts: '2026-09-28T10:00:05Z', action: 'status_change', from_status: 'smm_approval', to_status: 'backlog', payload: { surface: 'calendar' } }, over);
  const P = (item, surface) => T._arxWorkItemPlan(item, archivedAt, surface || 'calendar');
  let p = P({ current: { status: 'backlog' }, events: [ev()] });
  ok(p.action === 'to' && p.target === 'smm_approval' && p.text === 'back to SMM approval', 'exact prior status: SMM approval');
  for (const [from, label] of [['todo', 'To do'], ['in_progress', 'In progress'], ['client_approval', 'Client approval'], ['tweak', 'Tweaks']]) {
    p = P({ current: { status: 'backlog' }, events: [ev({ from_status: from })] });
    ok(p.action === 'to' && p.target === from && p.text === 'back to ' + label, 'exact prior status: ' + label);
  }
  p = P({ current: { status: 'backlog' }, events: [ev({ from_status: 'canceled' })] });
  ok(p.action === 'to' && p.target === 'canceled', 'a parked finished item goes back to that finished status');
  p = P({ current: { status: 'backlog' }, events: [ev({ from_status: 'backlog' })] });
  ok(p.action === 'to' && p.target === 'todo' && p.text === 'to To do', 'already in Backlog before the archive -> To do');
  p = P({ current: { status: 'backlog' }, events: [] });
  ok(p.action === 'to' && p.target === 'todo' && p.reason === 'no_record', 'Backlog with no record of where it came from -> To do (owner, A1)');
  for (const st of ['approved', 'scheduled', 'posted', 'canceled', 'duplicate']) {
    p = P({ current: { status: st }, events: [ev()] });
    ok(p.action === 'stay' && p.text === 'stays ' + T._arxLabel(st), 'finished (' + st + ') stays');
  }
  p = P({ current: { status: 'in_progress' }, events: [ev()] });
  ok(p.action === 'left' && p.text === 'left alone, it moved since', 'moved to another open status since -> left alone');
  p = P({ current: { status: 'backlog' }, events: [ev({ ts: '2026-09-28T12:00:00Z', payload: { surface: 'production' }, from_status: 'todo' }), ev()] });
  ok(p.action === 'left' && p.text === 'left alone, it moved since', 'a person moved it into Backlog later -> left alone');
  p = P({ current: { status: 'backlog' }, events: [ev({ ts: '2026-09-20T10:00:00Z' })] });
  ok(p.action === 'left', 'a Backlog move from before the archive is not the archive\'s park -> left alone');
  p = P({ current: { status: 'backlog' }, events: [ev({ payload: { surface: 'sxr' } })] });
  ok(p.action === 'left', 'another surface\'s Backlog move is not this card\'s park');
  p = P({ current: { status: 'backlog' }, events: [ev({ payload: { surface: 'sxr' } })] }, 'sxr');
  ok(p.action === 'to' && p.target === 'smm_approval', 'samples use the sxr surface');
  p = P({ current: null, events: [] });
  ok(p.action === 'left', 'an unreadable item is left alone');
  ok(T._arxIsFinished('POSTED') && !T._arxIsFinished('backlog') && !T._arxIsFinished(''), 'finished set');

  // ── 5. duplicates and position ──
  console.log('duplicate owner and position');
  const mine = { id: 'c1', name: 'Mine', video_deliverable_id: 'v1', graphic_deliverable_id: 'g1', linear_issue_id: 'L1', order_index: 4 };
  ok(T._arxDuplicateOwner(mine, [{ id: 'c2', name: 'Other', video_deliverable_id: 'v1' }]).name === 'Other', 'same video work item -> blocked, owner named');
  ok(T._arxDuplicateOwner(mine, [{ id: 'c2', name: 'Other', graphic_deliverable_id: 'g1' }]).id === 'c2', 'same graphic work item -> blocked');
  ok(T._arxDuplicateOwner(mine, [{ id: 'c2', name: 'Other', linear_issue_id: 'L1' }]).id === 'c2', 'same Linear link -> blocked');
  ok(T._arxDuplicateOwner(mine, [{ id: 'c2', video_deliverable_id: 'v9' }, { id: 'c1', video_deliverable_id: 'v1' }]) === null, 'unrelated cards and itself do not block');
  ok(T._arxDuplicateOwner(mine, [{ id: 'c3', video_deliverable_id: 'v1', status: 'Archived' }]) === null, 'an archived card does not block');
  ok(T._arxDuplicateOwner({ id: 'x' }, [{ id: 'c2', video_deliverable_id: '' }]) === null, 'no work items, nothing to block');
  let slot = T._arxOrderSlot(mine, [{ id: 'a', order_index: 1 }, { id: 'b', order_index: 2 }]);
  ok(slot.tie === false && slot.order_index === 4, 'the old slot is kept when nobody holds it');
  slot = T._arxOrderSlot(mine, [{ id: 'a', order_index: 4 }, { id: 'b', order_index: 9 }]);
  ok(slot.tie === true && slot.order_index === 10, 'a tie goes to the end of the list');
  slot = T._arxOrderSlot({ id: 'z' }, [{ id: 'a', order_index: 3 }]);
  ok(slot.tie === true && slot.order_index === 4, 'a card with no position goes to the end');

  sourceShape();
}

function sourceShape() {
  console.log('source shape');
  const code = fragment.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(!/method:\s*'(PATCH|PUT|DELETE)'/.test(code), 'no PATCH, PUT or DELETE anywhere in the feature');
  const posts = code.match(/method:\s*'POST'/g) || [];
  ok(posts.length === 2, 'exactly two POST calls: the guarded production-write status move and the position write (found ' + posts.length + ')');
  ok(/WRITE_UI_PRODUCTION_WRITE_URL/.test(code) && /_calUpsertFetch\(/.test(code) && /_sxrUpsertFetch\(/.test(code), 'writes go to production-write, calendar-upsert and sample-review-upsert routes');
  ok(/expected_status: 'backlog', expected_updated_at:/.test(code), 'every item move carries the expected values');
  const restRuns = (code.match(/'\/rest\/v1\/'/g) || []);
  ok(restRuns.length === 1 && /cache: 'no-store'/.test(code) && !/from\(|\.rpc\(|\.insert\(|\.update\(/.test(code), 'one read helper, no client library, no table write');
  ok(!/_calReviewApprove|_calReviewApplyApprove|_calReviewRequestTweak|_crq[A-Z]|_calClientApprove|_sxrReviewApprove|_sxrReviewRequestTweak|_sxrKasper\w*(Approve|Tweak)|\bapprove\w*\(/i.test(code), 'the client approve and request-changes paths are not referenced');
  ok(/function _arxCan\(\)[\s\S]*_isClientLink[\s\S]*_syncviewStaffIdentityValid[\s\S]*restore-archived/.test(code), 'the gate checks client link, verified identity and the capability');
  ok(/function _arxOpen\([^)]*\)\s*\{[\s\S]{0,200}_arxCan\(\)/.test(code) && /async function _arxRestore\([^)]*\)\s*\{[\s\S]{0,200}_arxCan\(\)/.test(code), 'the opener and the restore both re-check the gate');
  ok(!/supabase\/functions|calendar-upsert\/|sample-review-upsert\//.test(code), 'the feature does not name any function source');
  // menu wiring
  const cal = fs.readFileSync(path.join(ROOT, 'src/index/160-calendar-organize-ui.js.part'), 'utf8');
  const sxr = fs.readFileSync(path.join(ROOT, 'src/index/270-samples-model.js.part'), 'utf8');
  const staff = fs.readFileSync(path.join(ROOT, 'src/index/100-onboarding-staff-controls.js.part'), 'utf8');
  ok(/data-staff-capability="restore-archived"\$\{_syncviewStaffCan\('restore-archived'\) \? '' : ' hidden'\}[\s\S]{0,600}_arxOpen\('cal'\)[\s\S]{0,700}Archived cards/.test(cal), 'Calendar More menu: gated item Archived cards');
  ok(/data-staff-capability="restore-archived"\$\{_syncviewStaffCan\('restore-archived'\) \? '' : ' hidden'\}[\s\S]{0,600}_arxOpen\('sxr'\)[\s\S]{0,700}Archived samples/.test(sxr), 'Samples menu: gated item Archived samples');
  ok(/capability === 'restore-archived'\) return role === 'admin' \|\| role === 'smm';/.test(staff), 'capability maps to admin and smm only');
  const areas = fs.readFileSync(path.join(ROOT, 'src/index/areas.txt'), 'utf8');
  ok(/186-archived-restore\.js\.part\s+core\s*$/m.test(areas), 'the fragment is in core, not in the client approve path list');
  // frozen writers and the approve path are byte-identical to the base branch
  let changed = null;
  try {
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    changed = execFileSync('git', ['diff', '--name-only', base, '--', 'supabase/functions', 'migrations'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (e) { changed = null; }
  if (changed === null) console.log('  skip  git base not available; function and migration diff not checked here');
  else ok(changed === '', 'no Edge Function and no migration changed since this branch left main (frozen writers untouched, no deploy)');

  if (failures) { console.error('\ncalendar-unarchive: ' + failures + ' FAILED'); process.exit(1); }
  console.log('\ncalendar-unarchive: all checks passed');
}
