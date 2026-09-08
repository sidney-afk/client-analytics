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
ok(/parentSyncUrl = openIdent\s*\?\s*\(location\.pathname \+ '\?prod=1&d=' \+ encodeURIComponent\(openIdent\)\)/.test(pop),
  'the header link is the ?prod=1&d= deep link Production already resolves by identifier');
ok(/Open SyncView →/.test(pop), 'the primary header action now reads Open SyncView');
ok(/workload-popover-parent-linear[^>]*href="\$\{wlEscape\(openLinearUrl\)\}/.test(pop)
  && /Linear ↗/.test(pop),
'Linear stays reachable from the header as a secondary link, aimed at whatever the primary button opens');
/*
 * 2b. THE ROW LINK IS BUILT FROM THE NATIVE ID FIRST. Codex P1 on #1344.
 *
 * The pin that used to live here asserted the `s.identifier ? … : (s.url || '')`
 * expression verbatim, which was true and is now WRONG: a deliverable created
 * after the outbound flip has neither `linear_identifier` nor
 * `linear_issue_url`, so that expression renders href="" and clicking the row
 * reloads the Workload page instead of opening the deliverable. The loose
 * strips already route by `nativeId`; the popover now does too.
 *
 * OPEN_REPAIRS 177 is the reason this is a REPLACEMENT and not an addition: a
 * lane shipped a test asserting the old behaviour was correct, and a green
 * suite is exactly how that survives review. Executed, not pattern-matched —
 * every behavioural check below was seen to go red against the pre-fix source.
 */
const rowLinkStmt = pop.slice(pop.indexOf('const rowSyncUrl'),
  pop.indexOf(';', pop.indexOf('const rowSyncUrl')) + 1);
ok(/wlSyncLinearUrl/.test(rowLinkStmt), 'the row-link statement extracts (harness is not vacuous)');
const rowLink = new Function('s', 'wlSyncLinearUrl', 'location',
  rowLinkStmt + '\nreturn rowSyncUrl;');
const syncUrl = ident => { const t = String(ident || '').trim();
  return t ? ('/?prod=1&d=' + encodeURIComponent(t)) : ''; };

/* Synthetic ids. `?prod=1&d=` resolves a native id because _prodIssue() matches
   on `id` OR `displayId` — the same route the loose strips use. */
const NATIVE_ROW_ID = 'del_0000000000000000000000000001';
ok(rowLink({ nativeId: NATIVE_ROW_ID, identifier: '', url: '' }, syncUrl, { pathname: '/' })
     === '/?prod=1&d=' + encodeURIComponent(NATIVE_ROW_ID),
  'a post-flip row with no identifier and no Linear url still links to its SyncLinear detail');
ok(rowLink({ nativeId: NATIVE_ROW_ID, identifier: '', url: '' }, syncUrl, { pathname: '/' }) !== '',
  'it does NOT render an empty href that reopens the Workload page -- the exact reported defect');
ok(rowLink({ nativeId: NATIVE_ROW_ID, identifier: 'VID-9001', url: 'https://linear.app/x/issue/VID-9001' }, syncUrl, { pathname: '/' })
     === '/?prod=1&d=' + encodeURIComponent(NATIVE_ROW_ID),
  'a native row that still carries an identifier routes by the NATIVE id, matching the loose strips');
ok(rowLink({ identifier: 'VID-9001', url: 'https://linear.app/x/issue/VID-9001' }, syncUrl, { pathname: '/' })
     === '/?prod=1&d=VID-9001',
  'a legacy row keeps its identifier deep link -- the path in use today is unchanged');
ok(rowLink({ identifier: '', url: 'https://linear.app/x/issue/VID-9001' }, syncUrl, { pathname: '/' })
     === 'https://linear.app/x/issue/VID-9001',
  'with neither a native id nor an identifier, Linear is still the fallback');
ok(rowLink({ identifier: '', url: '' }, syncUrl, { pathname: '/' }) === '',
  'and a row with nothing to point at yields an empty string rather than a bogus route');

ok(/workload-popover-item-main" href="\$\{wlEscape\(rowSyncUrl\)\}/.test(pop),
  'the row MAIN click goes to SyncView');
ok(!/workload-popover-item-main" href="\$\{wlEscape\(s\.url\)\}/.test(pop),
  'the old direct-to-Linear main link is gone');
ok(/workload-popover-item-linear" href="\$\{wlEscape\(s\.url\)\}/.test(pop),
  'a per-row Linear icon keeps the source of truth one click away');

// ---- 3. the pill's primary action opens the VIDEO, and a parent button
//         never silently resolves to a child ------------------------------
/*
 * Owner report 2026-09-07 (OPEN_REPAIRS 160), two findings in one control.
 *
 * A. WHAT IT SHOULD OPEN. Pressing "Open SyncView ->" on the In progress chip
 *    for one client opened the PARENT, and the owner had to drill into the
 *    sub-issue himself to read the status the chip had just asserted. His
 *    rule: "when you open a pill, you're opening a video, so you're supposed
 *    to go to that sub-issue, which has the status In progress." The parent
 *    is structurally unable to answer that: for a native card it is a
 *    SYNTHETIC batch node whose status is hardcoded `todo` and never updated,
 *    so the destination was guaranteed to contradict the chip.
 *
 * B. WHAT IT MAY NEVER OPEN. The parent branch used to end
 *    `|| subs[0]?.identifier` -- the first CHILD -- taken whenever
 *    `parentById` lacked the parent. A control labelled as the parent must
 *    not silently substitute one. The board has several ways to lack it (the
 *    Linear-derived read pages `active = true` only; the n8n `linear-issues`
 *    fallback answers a different row set), so it is reachable in normal
 *    operation, and the previous version of this suite PINNED that fallback
 *    as if it were the contract.
 *
 * Executed, not pattern-matched: the real resolution block is sliced out of
 * index.html and run. A regex here could pass against a neighbouring
 * expression; running it cannot.
 */
const resolveBlock = source.slice(
  source.indexOf('const parentRow   = parentId ? wlState.parentById.get(parentId) : null;'),
  source.indexOf('const parentTitle = parentRow'));
ok(resolveBlock.length > 0 && /parentSyncUrl/.test(resolveBlock),
  'the link-out resolution block extracts (harness is not vacuous)');

const resolveLinks = new Function('wlState', 'parentId', 'clientName', 'subs', 'location',
  /* `typeof` guards, so a build that never declares these reports a FAILING
     check instead of throwing a ReferenceError and taking the whole suite
     down before the behavioural assertions run. Verified by stashing the
     fix: every check below must go red, not vanish. */
  resolveBlock + '\nconst g = n => n;'
  + '\nreturn { parentUrl, parentIdent, parentSyncUrl,'
  + '   openLabel:     typeof openLabel     === "undefined" ? undefined : g(openLabel),'
  + '   openLinearUrl: typeof openLinearUrl === "undefined" ? undefined : g(openLinearUrl),'
  + '   openIsParent:  typeof openIsParent  === "undefined" ? undefined : g(openIsParent) };');

/* Synthetic throughout. The fixture exercises the resolution rule, not any
   real row, so no live client, colleague or issue identifier appears here
   (Codex P1 on #1338, and the public-repo rule in CLAUDE.md). */
const PARENT_ID = '00000000-0000-4000-8000-00000000beef';
const CHILD = { identifier: 'VID-9001', url: 'https://linear.app/x/issue/VID-9001',
                parentIdentifier: 'VID-9000' };
const SIBLING = { identifier: 'VID-9002', url: 'https://linear.app/x/issue/VID-9002',
                  parentIdentifier: 'VID-9000' };
const loc = { pathname: '/' };
const PARENT_ROW = { identifier: 'VID-9000', url: 'https://linear.app/x/issue/VID-9000',
                     title: 'A Parent Issue' };
const withParent = { parentById: new Map([[PARENT_ID, PARENT_ROW]]) };
const noParent = { parentById: new Map() };

// A. one sub-issue in the group: the pill IS that video.
const one = resolveLinks(withParent, PARENT_ID, 'A Client', [CHILD], loc);
ok(one.parentSyncUrl === '/?prod=1&d=VID-9001',
  "a single-video pill opens the SUB-ISSUE, the row carrying the status the chip asserted");
ok(one.parentSyncUrl !== '/?prod=1&d=VID-9000',
  'a single-video pill does NOT open the parent -- the exact reported defect');
ok(one.openLabel === 'Open SyncView →' && one.openIsParent === false,
  'and the button still reads Open SyncView, because a video is what it opens');
ok(one.openLinearUrl === 'https://linear.app/x/issue/VID-9001',
  'the Linear escape hatch follows the primary target instead of pointing elsewhere');

// A. several sub-issues: no single row is "the video", so guessing is refused.
const many = resolveLinks(withParent, PARENT_ID, 'A Client', [CHILD, SIBLING], loc);
ok(many.parentSyncUrl === '/?prod=1&d=VID-9000' && many.openIsParent === true,
  'a multi-video pill keeps the parent as the group destination rather than picking one child');
ok(many.openLabel === 'Open parent →',
  'and it SAYS parent, so it is not mistaken for the video');
ok(many.openLinearUrl === 'https://linear.app/x/issue/VID-9000',
  'the multi-video Linear link matches the parent it sits beside');

// B. the parent branch never substitutes a child.
const missMany = resolveLinks(noParent, PARENT_ID, 'A Client', [CHILD, SIBLING], loc);
ok(missMany.parentIdent === 'VID-9000',
  "parent missing from the snapshot: the sub's own parentIdentifier answers");
ok(missMany.parentSyncUrl === '/?prod=1&d=VID-9000',
  'parent missing: the group link still opens the parent, not an arbitrary child');
ok(missMany.openLinearUrl === '',
  'parent missing: Linear ↗ is dropped rather than aimed at a child -- no parent URL is recoverable');

const orphan = resolveLinks(noParent, PARENT_ID, 'A Client',
  [{ identifier: 'VID-9001', url: 'https://linear.app/x/issue/VID-9001' },
   { identifier: 'VID-9002', url: 'https://linear.app/x/issue/VID-9002' }], loc);
ok(orphan.parentIdent === '' && orphan.parentSyncUrl === '',
  'nothing names a parent and no single video is meant: the button is OMITTED, not aimed at a child');

// Inversion: the removed first-child fallback must not creep back.
ok(!/subs\[0\]\?\.identifier/.test(resolveBlock) && !/subs\[0\]\?\.url/.test(resolveBlock),
  'the first-child fallback is gone from the parent resolution, in source');

// A per-editor total badge spans clients, so it claims no parent and no video.
const noClient = resolveLinks(withParent, PARENT_ID, '', [CHILD], loc);
ok(noClient.parentIdent === '' && noClient.parentUrl === '',
  'the editor-total badge spans clients, so it claims no parent');

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nWorkload SyncView-link and credentials-label checks passed.');
