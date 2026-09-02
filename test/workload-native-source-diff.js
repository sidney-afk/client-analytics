'use strict';
/*
 * `?wlnative=1` MEASURES THE TWO WORKLOAD SOURCES AGAINST EACH OTHER. IT DOES
 * NOT SWITCH BETWEEN THEM, AND THAT IS THE POINT.
 *
 * Step 2 of docs/ops/WORKLOAD_NATIVE_SOURCE.md, whose own words for this step
 * are "both sources readable side by side, so the diff is measured on real data
 * instead of argued about" -- step 3 is reconciling that diff to zero. So the
 * deliverable here is a measurement, not a cutover.
 *
 * AND A CUTOVER COULD NOT BE DONE SAFELY YET, which is the load-bearing half.
 * `public.workload_plan` is `issue_id text primary key` holding the LINEAR
 * uuid, and `workload-plan`'s requireWritableIssue() validates every write
 * against `workload_issues`. A deliverable that has never been mirrored has no
 * Linear uuid at all -- so swapping the read source would put rows on the board
 * whose plan day silently fails to save. A drag that looks like it worked is
 * strictly worse than a row that is not there yet, and the repair is scope
 * §6.1's owner decision plus a key migration, not a flag.
 *
 * This suite therefore pins two different kinds of thing: that the comparison
 * is CORRECT (executed over fixtures, not read), and that the harness CANNOT
 * affect what the board renders.
 *
 * Fixtures are synthetic. This is a public repo and no client identity belongs
 * in it -- see OPEN_REPAIRS on the #1217 finding.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* A regex- and template-aware extractor. This is a copy of the shared one
   landing in test/helpers/extract-function.js (OPEN_REPAIRS items 96/101);
   this branch is cut from main, where that file does not exist yet, so it is
   inlined rather than required. REPLACE THIS WITH THE REQUIRE once the helper
   is on main -- a second copy of a scanner is exactly the shape item 96 is
   about, and it is here for a reason with an expiry, not by preference. */
const REGEX_AFTER = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '~', '^', '<', '>']);
const REGEX_KEYWORD = /\b(return|typeof|case|in|of|new|delete|void|instanceof|do|else|yield|await)\s*$/;
function extractFunction(src, name) {
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  const open = src.indexOf('{', at);
  const stack = [{ kind: 'code', depth: 0 }];
  let escaped = false, quote = '', comment = '', regex = false, charClass = false, prev = '';
  for (let i = open; i < src.length; i++) {
    const c = src[i], n = src[i + 1], top = stack[stack.length - 1];
    if (comment) {
      if (comment === 'line' && c === '\n') comment = '';
      else if (comment === 'block' && c === '*' && n === '/') { comment = ''; i++; }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (regex) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (charClass) { if (c === ']') charClass = false; }
      else if (c === '[') charClass = true;
      else if (c === '/' || c === '\n') regex = false;
      continue;
    }
    if (top.kind === 'template') {
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if (c === '`') { stack.pop(); continue; }
      if (c === '$' && n === '{') { stack.push({ kind: 'code', depth: 1 }); i++; continue; }
      continue;
    }
    if (c === '/' && n === '/') { comment = 'line'; i++; continue; }
    if (c === '/' && n === '*') { comment = 'block'; i++; continue; }
    if (c === '/' && (!prev || REGEX_AFTER.has(prev) || REGEX_KEYWORD.test(src.slice(Math.max(0, i - 16), i)))) {
      regex = true; charClass = false; continue;
    }
    if (c === '`') { stack.push({ kind: 'template' }); continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '{') top.depth++;
    else if (c === '}') {
      top.depth--;
      if (top.depth === 0) {
        if (stack.length === 1) return src.slice(at, i + 1);
        stack.pop();
        continue;
      }
    }
    if (!/\s/.test(c)) prev = c;
  }
  throw new Error('unclosed function: ' + name);
}
function grabConst(name) {
  const at = INDEX.indexOf('const ' + name + ' = ');
  if (at < 0) throw new Error('const not found: ' + name);
  const end = INDEX.indexOf(';', INDEX.indexOf(name === 'WL_NATIVE_DIFF_SAMPLE' ? '=' : ')', at));
  return INDEX.slice(at, end + 1);
}

/* ---- Load the real code and run it ------------------------------------- */

const consts = ['WL_NATIVE_DIFF_EXCLUDED', 'WL_NATIVE_DIFF_FIELDS', 'WL_NATIVE_DIFF_SAMPLE'].map(grabConst).join('\n');
const fns = ['_wlNativeCell', '_wlNativeDiffReport', '_wlNativeDiffEnabled'].map(n => extractFunction(INDEX, n)).join('\n');
let mod;
try {
  mod = new Function(consts + '\n' + fns
    + '\n; return { _wlNativeCell, _wlNativeDiffReport, _wlNativeDiffEnabled, WL_NATIVE_DIFF_SAMPLE, WL_NATIVE_DIFF_FIELDS, WL_NATIVE_DIFF_EXCLUDED };')();
  ok(true, 'the diff harness is pure enough to lift out of index.html and EXECUTE — no DOM, no fetch, no state');
} catch (e) {
  ok(false, 'could not execute the diff harness: ' + e.message);
  console.log('\n' + (failures) + ' workload native diff check(s) failed');
  process.exit(1);
}
const { _wlNativeCell, _wlNativeDiffReport, _wlNativeDiffEnabled, WL_NATIVE_DIFF_SAMPLE } = mod;

/* ---- 1. Cell normalisation, which decides what counts as a difference --- */

ok(_wlNativeCell({ status: 'For Client Approval' }, 'status') === 'for client approval'
  && _wlNativeCell({ status: 'Tweak Needed ' }, 'status') === 'tweak needed',
  'status compares trimmed and lower-cased — the live table holds three spellings of two states, and the board reads it through wlNormStatus anyway');
ok(_wlNativeCell({ due_date: '2026-09-10T00:00:00Z' }, 'due_date') === '2026-09-10',
  'a due date compares as its first ten characters, because Linear can answer a full timestamp for the same day');
ok(_wlNativeCell({ title: '  A title  ' }, 'title') === 'A title'
  && _wlNativeCell({}, 'title') === '' && _wlNativeCell({ title: null }, 'title') === '',
  'everything else compares trimmed, and null and absent are the same empty string rather than "null"');

/* ---- 2. The comparison itself, over fixtures --------------------------- */

const linearRows = [
  { id: 'lin-a', identifier: 'AAA-1', is_sub_issue: true, title: 'Shared row', status: 'For Client approval', status_type: 'started', team_key: 'VID', team_name: 'Video', assignee_name: 'Ana', assignee_email: 'ana@example.com', client_name: 'Client One', due_date: '2026-09-10', url: 'https://linear.app/a', assignee_id: 'lin-user-1', parent_identifier: 'AAA-9' },
  { id: 'lin-b', identifier: 'AAA-2', is_sub_issue: true, title: 'Old title', status: 'Todo', status_type: 'unstarted', team_key: 'VID', team_name: 'Video', assignee_name: 'Ana', assignee_email: 'ana@example.com', client_name: 'Client One', due_date: '2026-09-11' },
  { id: 'lin-c', identifier: 'AAA-3', is_sub_issue: true, title: 'Only in Linear', status: 'Todo', status_type: 'unstarted', team_key: 'GRA', team_name: 'Graphics', client_name: 'Client Two' },
  { id: 'lin-p', identifier: 'AAA-9', is_sub_issue: false, title: 'A parent', status: 'Todo', status_type: 'unstarted' },
];
const nativeRows = [
  // same row, different SPELLING of the same status
  { id: 'del_a', linear_id: 'lin-a', identifier: 'AAA-1', is_sub_issue: true, title: 'Shared row', status: 'For Client Approval', status_type: 'started', team_key: 'VID', team_name: 'Video', assignee_name: 'Ana', assignee_email: 'ana@example.com', client_name: 'Client One', due_date: '2026-09-10', url: null, assignee_id: 'uuid-1', parent_identifier: 'A batch name' },
  // same row, a REAL difference
  { id: 'del_b', linear_id: 'lin-b', identifier: 'AAA-2', is_sub_issue: true, title: 'New title', status: 'Todo', status_type: 'unstarted', team_key: 'VID', team_name: 'Video', assignee_name: 'Ana', assignee_email: 'ana@example.com', client_name: 'Client One', due_date: '2026-09-11' },
  // live natively, invisible on the board: the item 95 shape
  { id: 'del_d', linear_id: 'lin-d', identifier: 'AAA-4', is_sub_issue: true, title: 'Archived in Linear, live here', status: 'Todo', status_type: 'unstarted', team_key: 'VID', team_name: 'Video', client_name: 'Client One' },
  // never mirrored at all
  { id: 'del_e', linear_id: null, identifier: 'del_e', is_sub_issue: true, title: 'Born native', status: 'Todo', status_type: 'unstarted', team_key: 'GRA', team_name: 'Graphics', client_name: 'Client Two' },
  { id: 'bat_1', linear_id: null, identifier: 'A batch name', is_sub_issue: false, title: 'A batch name' },
];
const report = _wlNativeDiffReport(linearRows, nativeRows);

ok(report.linear.subIssues === 3 && report.linear.parents === 1
  && report.native.subIssues === 4 && report.native.parents === 1,
  'sub-issues and parents are counted separately on both sides');
ok(report.nativeOnly.count === 1 && report.nativeOnly.sample[0] === 'AAA-4',
  'A ROW LIVE NATIVELY AND ABSENT FROM THE BOARD IS THE HEADLINE — this is item 95\'s 40 rows, and finding them is the step 3 acceptance test rather than an incident');
ok(report.linearOnly.count === 1 && report.linearOnly.sample[0] === 'AAA-3',
  'and a row the board has that the native source does not is reported too — the diff is not one-directional');
ok(report.neverMirrored.count === 1 && report.neverMirrored.sample[0] === 'del_e',
  'a deliverable with no Linear uuid is reported as NEVER MIRRORED rather than as a difference — there is nothing to compare it to, and calling that drift would be a lie');
ok(report.statusSpellingOnly === 1,
  'two spellings of one status count as a SPELLING difference, separately');
ok(!report.differing.sample.some(d => d.identifier === 'AAA-1'),
  'and are NOT reported as drift — that difference is the thing the native source exists to end, not evidence against it');
const titleDrift = report.differing.sample.filter(d => d.field === 'title');
ok(report.differing.count === 1 && titleDrift.length === 1
  && titleDrift[0].linear === 'Old title' && titleDrift[0].native === 'New title',
  'a real field difference is reported with the field name and both values, so it can be acted on without a second query');

/* The exclusions are the ones the two sources are SUPPOSED to disagree about.
   Reporting them would bury the real signal under 1,995 rows of noise. */
ok(!report.differing.sample.some(d => ['url', 'assignee_id', 'parent_identifier', 'id', 'parent_id'].includes(d.field)),
  'url, assignee_id and parent_identifier differ BY DESIGN and are not reported — different namespaces and an open owner decision are not drift');
ok(Array.isArray(report.excludedFields) && report.excludedFields.includes('assignee_id')
  && report.excludedFields.includes('url') && report.excludedFields.includes('sort_order'),
  'AND THE REPORT SAYS WHAT IT DID NOT COMPARE, so a zero diff reads as "these agree about what was checked" rather than "these are identical"');
ok(Array.isArray(report.comparedFields) && report.comparedFields.length >= 8,
  'and what it did compare');

/* ---- 3. No silent caps ------------------------------------------------- */

const many = [];
for (let i = 0; i < WL_NATIVE_DIFF_SAMPLE + 7; i++) {
  many.push({ id: 'del_' + i, linear_id: 'lin-x' + i, identifier: 'XXX-' + i, is_sub_issue: true, title: 'row ' + i, status: 'Todo', status_type: 'unstarted' });
}
const capped = _wlNativeDiffReport([], many);
ok(capped.nativeOnly.count === WL_NATIVE_DIFF_SAMPLE + 7
  && capped.nativeOnly.sample.length === WL_NATIVE_DIFF_SAMPLE
  && capped.nativeOnly.truncated === 7,
  'a long list carries its FULL count and how many it did not print — a capped list that looks complete is how a diff gets called clean');

/* ---- 4. The flag ------------------------------------------------------- */

const withSearch = search => {
  const saved = globalThis.location;
  try {
    Object.defineProperty(globalThis, 'location', { value: { search }, configurable: true, writable: true });
    return _wlNativeDiffEnabled();
  } finally {
    if (saved === undefined) delete globalThis.location;
    else Object.defineProperty(globalThis, 'location', { value: saved, configurable: true, writable: true });
  }
};
ok(withSearch('?wlnative=1') === true && withSearch('?wlnative=true') === true,
  'the flag is on for ?wlnative=1 and ?wlnative=true');
ok(withSearch('') === false && withSearch('?wlnative=0') === false && withSearch('?wlnative=yes') === false
  && withSearch('?wl2=1') === false,
  'and OFF by default, off when disabled, and off for anything it does not recognise — a diagnostic must never be the accidental state');

/* ---- 5. It cannot change what the board shows -------------------------- */

const harness = INDEX.slice(INDEX.indexOf('const WL_NATIVE_VIEW'), INDEX.indexOf('// Realtime: one global channel'));
ok(harness.length > 2000, 'the whole harness is readable as one block');
ok(!/wlState\s*\.\s*[a-zA-Z]+\s*=/.test(harness),
  'IT NEVER ASSIGNS TO wlState — the board\'s data cannot be moved by a diagnostic');
ok(!/renderWorkload|renderCal|\.innerHTML\s*=/.test(harness),
  'and it renders nothing');
ok(!/localStorage/.test(harness),
  'the flag is deliberately NOT sticky, unlike ?wl2 — a kill switch has to survive a reload, but a diagnostic that stayed on would keep spending two reads per board load long after whoever typed it had forgotten');
ok(/catch\s*\(e\)[\s\S]{0,400}console\.warn\('\[workload native\] diff unavailable/.test(harness),
  'every failure is caught and logged rather than thrown into the caller');
ok(/apply migrations\/2026-09-02-workload-native-view\.sql first/.test(harness)
  && /404\|PGRST205\|Not Found/.test(harness),
  'A MISSING VIEW READS AS "not applied yet" AND NAMES THE MIGRATION — until the owner applies it that is the expected answer, and it must not look like a broken board');
ok(/try \{ if \(_wlNativeDiffEnabled\(\)\) window\.wlNativeDiff\(\); \}\s*\n\s*catch \(e\) \{ console\.warn\('\[workload native\] diff failed to start'/.test(INDEX),
  'THE FLAG CHECK IS INSIDE THE TRY, not just the call — workload-linear-browser.js runs initWorkloadView in a vm sandbox holding only what the mount needs, and an unguarded reference threw before the board painted at all');
const wiring = INDEX.indexOf('try { if (_wlNativeDiffEnabled()) window.wlNativeDiff(); }');
const warm = INDEX.indexOf('const hasWarmSnapshot = wlState.fetchedAt != null');
ok(wiring > -1 && warm > wiring,
  'and it fires BEFORE the warm-snapshot early return, so a route switch back to Workload still measures instead of silently doing nothing');
ok(/window\.wlNativeDiff = async function/.test(INDEX),
  'it is also exposed on window, so it can be run by hand without reloading with a query string');

/* ---- 6. Step 2 does not become step 4 by accident ---------------------- */

ok(!new RegExp('_wlV2FetchIssues[\\s\\S]{0,600}' + 'workload_issues_native_v1').test(INDEX),
  'THE BOARD\'S OWN FETCH STILL READS workload_issues — this step measures, it does not switch, because workload_plan is keyed on the Linear uuid and a never-mirrored row would take a plan day that silently fails to save');
ok(/select=\*&active=eq\.true&order=id\.asc&limit=1000&offset=/.test(harness),
  'the native read pages exactly like the v2 read, so neither source is truncated at 1000 rows while the other is not');

console.log(failures === 0
  ? '\nworkload native source diff checks passed'
  : '\n' + failures + ' workload native diff check(s) failed');
process.exit(failures === 0 ? 0 : 1);
