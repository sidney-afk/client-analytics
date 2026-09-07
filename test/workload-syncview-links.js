'use strict';
/*
 * Two owner reports from 2026-08-21, one file because both are "the label
 * pointed somewhere untrue".
 *
 * 1. WORKLOAD LINKS OUT TO SYNCVIEW, NOT LINEAR. Post-flip the designers'
 *    work lives in the Production tab, but every link-out in the workload
 *    popover still opened linear.app. The popover now points its primary
 *    links at ?prod=1&d=<identifier> -- the deep link Production already
 *    resolves by displayId -- while Linear stays one small click away on
 *    every row, because video is still Linear-authoritative and hiding the
 *    source of truth would be worse than the extra icon.
 *
 * 2. A CORRECTLY-FILED IMPORT MUST NOT SAY "UNMATCHED". After the labelled
 *    onboarding import, every imported row lands status=needs_review BY
 *    DESIGN -- and the credentials header lumped that state into
 *    "Unmatched / needs review: <client>", telling the owner his correctly
 *    matched clients had a filing failure. Verified in live data first:
 *    all 47 imported rows carry REAL slugs, zero unmatched.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}
function extractFn(name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error('missing function: ' + name);
  let depth = 0, seen = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') { depth++; seen = true; }
    else if (ch === '}') { depth--; if (seen && depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error('unbalanced: ' + name);
}

// ---- 1. the credentials header states the true condition --------------------
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(
  extractFn('_ccIsTrulyUnmatched') + '\n' + extractFn('_ccIsUnmatched')
  + '\nthis.truly = _ccIsTrulyUnmatched; this.either = _ccIsUnmatched;',
  sandbox,
);
const { truly, either } = sandbox;
ok(typeof truly === 'function', 'the split predicates extract and execute (harness is not vacuous)');
ok(truly({ client_slug: 'unmatched:someone', status: 'active' }) === true,
  'a row parked under an unmatched slug is truly unmatched');
ok(truly({ client_slug: 'lukecutting', status: 'needs_review' }) === false,
  'a correctly-filed needs_review row is NOT called unmatched -- the exact mislabel the owner hit');
ok(either({ client_slug: 'lukecutting', status: 'needs_review' }) === true,
  'the combined predicate still surfaces it for sorting and the reassign affordance');

const header = source.slice(source.indexOf('const unmatched = rows.some(_ccIsTrulyUnmatched);'),
  source.indexOf('const titleHtml =') + 700);
ok(/const unmatched = rows\.some\(_ccIsTrulyUnmatched\);/.test(header),
  'the header banner keys on TRULY unmatched, not on needs_review');
ok(/needsReview = !unmatched && rows\.some\(r => r\.status === 'needs_review'\)/.test(header),
  'needs-review is computed as its own state');
ok(/\$\{unmatched \? 'Unmatched: ' : ''\}/.test(header) && !/Unmatched \/ needs review/.test(header),
  "the title prefixes 'Unmatched' only for a genuine filing failure");
ok(/no matching client — reassign/.test(header),
  'a genuine unmatched group says what to DO about it');
ok(/imported — glance &amp; confirm/.test(header),
  'a reviewed-pending group is described as imported, not broken');

// ---- 2. the workload popover is SyncView-first ------------------------------
const pop = source.slice(source.indexOf('const parentRow   = parentId'),
  source.indexOf('No upcoming sub-issues.'));
ok(/const parentIdent = clientName/.test(pop),
  'the header derives a Linear IDENTIFIER for the SyncView deep link');
ok(/parentSyncUrl = parentIdent\s*\?\s*\(location\.pathname \+ '\?prod=1&d=' \+ encodeURIComponent\(parentIdent\)\)/.test(pop),
  'the header link is the ?prod=1&d= deep link Production already resolves by identifier');
ok(/Open SyncView →/.test(pop), 'the primary header action now reads Open SyncView');
ok(/workload-popover-parent-linear[^>]*href="\$\{wlEscape\(parentUrl\)\}/.test(pop)
  && /Linear ↗/.test(pop),
'Linear stays reachable from the header as a secondary link -- video is still Linear-authoritative');
ok(/const rowSyncUrl = s\.identifier\s*\?\s*\(location\.pathname \+ '\?prod=1&d=' \+ encodeURIComponent\(s\.identifier\)\)\s*:\s*\(s\.url \|\| ''\);/.test(pop),
  'each sub-issue row links to its own SyncView detail, falling back to Linear only when no identifier exists');
ok(/workload-popover-item-main" href="\$\{wlEscape\(rowSyncUrl\)\}/.test(pop),
  'the row MAIN click goes to SyncView');
ok(!/workload-popover-item-main" href="\$\{wlEscape\(s\.url\)\}/.test(pop),
  'the old direct-to-Linear main link is gone');
ok(/workload-popover-item-linear" href="\$\{wlEscape\(s\.url\)\}/.test(pop),
  'a per-row Linear icon keeps the source of truth one click away');

// ---- 3. a PARENT button never resolves to a CHILD ---------------------------
/*
 * Owner report 2026-09-07 (OPEN_REPAIRS 160). Pressing "Open SyncView ->" on
 * the In progress chip for one client opened the SUB-issue VID-13679, not its
 * parent VID-13678, and nothing on the page said a substitution had happened.
 *
 * The cause was the fallback `|| subs[0]?.identifier` -- the first CHILD --
 * taken whenever `parentById` lacked the parent. The board has several ways
 * to lack it (the Linear-derived read pages `active = true` only; the n8n
 * `linear-issues` fallback answers a different row set), so this is reachable
 * in normal operation, and the previous version of this suite PINNED the bad
 * fallback as if it were the contract.
 *
 * Executed, not pattern-matched: the real resolution block is sliced out of
 * index.html and run against three states. A regex here could pass against a
 * neighbouring expression; running it cannot.
 */
const resolveBlock = source.slice(
  source.indexOf('const parentRow   = parentId ? wlState.parentById.get(parentId) : null;'),
  source.indexOf('const parentTitle = parentRow'));
ok(resolveBlock.length > 0 && /parentSyncUrl/.test(resolveBlock),
  'the parent-resolution block extracts (harness is not vacuous)');

const resolveParent = new Function('wlState', 'parentId', 'clientName', 'subs', 'location',
  resolveBlock + '\nreturn { parentUrl, parentIdent, parentSyncUrl };');

const PARENT_ID = 'c96ac1d0-38ce-4446-80c5-d279771c6bb6';
const CHILD = { identifier: 'VID-13679', url: 'https://linear.app/x/issue/VID-13679',
                parentIdentifier: 'VID-13678' };
const loc = { pathname: '/' };
const withParent = { parentById: new Map([[PARENT_ID,
  { identifier: 'VID-13678', url: 'https://linear.app/x/issue/VID-13678', title: 'E-School Launch reel' }]]) };
const noParent = { parentById: new Map() };

const hit = resolveParent(withParent, PARENT_ID, 'Dr. Sonia Chopra', [CHILD], loc);
ok(hit.parentIdent === 'VID-13678', 'parent present in the snapshot: the deep link names the PARENT');
ok(hit.parentSyncUrl === '/?prod=1&d=VID-13678', 'parent present: ?prod=1&d= carries the parent identifier');
ok(hit.parentUrl === 'https://linear.app/x/issue/VID-13678', 'parent present: Linear ↗ points at the parent');

const miss = resolveParent(noParent, PARENT_ID, 'Dr. Sonia Chopra', [CHILD], loc);
ok(miss.parentIdent === 'VID-13678',
  "parent MISSING from the snapshot: the sub's own parentIdentifier answers -- the owner's exact case");
ok(miss.parentIdent !== CHILD.identifier,
  'parent missing: the deep link is NEVER the child identifier (the reported defect)');
ok(miss.parentSyncUrl === '/?prod=1&d=VID-13678',
  'parent missing: the deep link still opens VID-13678, not VID-13679');
ok(miss.parentUrl === '',
  'parent missing: Linear ↗ is dropped rather than pointed at the child -- no parent URL is recoverable');

const orphan = resolveParent(noParent, PARENT_ID, 'Dr. Sonia Chopra',
  [{ identifier: 'VID-13679', url: 'https://linear.app/x/issue/VID-13679' }], loc);
ok(orphan.parentIdent === '' && orphan.parentSyncUrl === '',
  'neither source names a parent: the button is OMITTED, not aimed at a child');
ok(orphan.parentUrl === '', 'neither source names a parent: no Linear parent link either');

// Inversion: the removed fallback must not creep back under another spelling.
ok(!/subs\[0\]\?\.identifier/.test(resolveBlock) && !/subs\[0\]\?\.url/.test(resolveBlock),
  'the first-child fallback is gone from the parent resolution, in source');

// A per-editor total badge (no client) still renders no parent controls at all.
const noClient = resolveParent(withParent, PARENT_ID, '', [CHILD], loc);
ok(noClient.parentIdent === '' && noClient.parentUrl === '',
  'the editor-total badge spans clients, so it claims no parent');

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nWorkload SyncView-link and credentials-label checks passed.');
