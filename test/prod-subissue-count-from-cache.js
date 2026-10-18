'use strict';

/*
 * THE SUB-ISSUE COUNT CHIP NEVER STATES THE SAVED COPY'S SILENCE AS A COUNT.
 *
 * Found by session Patrol on 2026-10-17: open a sub-issue in SyncLinear, press
 * "Back to card", then the browser's Back button. For one to three seconds the
 * header read "Sub-issue of ... 0/13" where the truth was 19 of 32 done. That
 * first paint comes from the saved copy, which carries no finished work by
 * construction (_prodState.cachePartial), so its "0 done" is not an answer.
 *
 * Executes the real functions out of the source fragment (not a text scan):
 *   1. saved copy, no finished child in it: the chip says it is still counting
 *   2. saved copy, but a live read already brought finished children: counts
 *   3. live data: counts, including a real "0 done"
 *   4. the list row and the header draw the chip through the same helper
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'index', '260-production-refresh-boot.js.part'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function extractFunction(name, optional) {
  const marker = 'function ' + name + '(';
  const start = source.indexOf(marker);
  if (start < 0) { if (optional) return ''; throw new Error('missing ' + name); }
  let depth = 0, quote = '', escaped = false, comment = '';
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    const char = source[i], next = source[i + 1];
    if (comment === 'line') { if (char === '\n') comment = ''; continue; }
    if (comment === 'block') { if (char === '*' && next === '/') { comment = ''; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '/' && next === '/') { comment = 'line'; i++; continue; }
    if (char === '/' && next === '*') { comment = 'block'; i++; continue; }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unclosed ' + name);
}

const script = extractFunction('_prodRowSetComplete') + '\n' + extractFunction('_prodSubCountPending', true) + '\n' + extractFunction('_prodSubChipHTML', true) + '\n' + extractFunction('_prodSubIssueContextHTML')
  + '\nglobalThis.__header = _prodSubIssueContextHTML;';

function header(state, progress) {
  const sandbox = {
    String, Array, Object, RegExp,
    _prodState: state,
    _prodSubProgress: () => progress,
    _calEsc: v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
    _calEscAttr: v => String(v).replace(/"/g, '&quot;'),
    _jsAttrArg: v => JSON.stringify(String(v)),
    _prodStatusIcon: () => '', _prodStatusSVG: () => '',
    _prodDisplayClient: () => 'Test client', _prodIssueDisplayLabel: () => 'POST-1',
    _prodParentNameHTML: () => 'Fixture post', _prodAttributionResolved: () => false,
    _prodIssueProjectChipHTML: () => '', _prodProjectGlyph: () => '', _prodAttributionChipOnlyHTML: () => '',
  };
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox);
  return sandbox.__header({ id: 'del_fixture_child', parent: 'del_fixture_parent', project: 'fixture-client' }, { id: 'del_fixture_parent', status: 'In Progress' });
}
const vis = html => String(html).replace(/<[^>]*>/g, ' ');

// 1. The saved copy alone: thirteen open children, the finished ones absent.
{
  const html = header({ cachePartial: true }, { done: 0, total: 13 });
  ok(/Sub-issue of/.test(html), 'saved copy: the header still draws');
  ok(!/\b0\s*\/\s*13\b/.test(vis(html)), 'saved copy: no "0/13" is stated as the count');
  ok(/data-prod-subchip-pending/.test(html) && /Counting sub-issues/.test(html), 'saved copy: the chip says it is still counting');
}
// 2. Still flagged partial, but a live read already brought finished children.
{
  const html = header({ cachePartial: true }, { done: 19, total: 32 });
  ok(/\b19\/32\b/.test(vis(html)) && !/data-prod-subchip-pending/.test(html), 'finished children present: the real count shows');
}
// 3. Live first read landed but the finished work (terminal tail) has not:
//    no saved copy at all, so cachePartial is already false.
{
  const pending = header({ cachePartial: false, terminalTailLoadedAt: 0, terminalTailPending: true }, { done: 0, total: 13 });
  ok(!/\b0\s*\/\s*13\b/.test(vis(pending)) && /data-prod-subchip-pending/.test(pending), 'live first read, tail still loading: still counting, no "0/13"');
  const failed = header({ cachePartial: false, terminalTailLoadedAt: 0, terminalTailFailed: true }, { done: 0, total: 13 });
  ok(/\b0\/13\b/.test(vis(failed)), 'tail failed: shows what is held instead of counting forever');
}
// 4. Complete row set: every count shows, a real zero included.
{
  const DONE = { cachePartial: false, terminalTailLoadedAt: 1 };
  ok(/\b19\/32\b/.test(vis(header(DONE, { done: 19, total: 32 }))), 'live data: 19/32');
  const zero = header(DONE, { done: 0, total: 4 });
  ok(/\b0\/4\b/.test(vis(zero)) && !/data-prod-subchip-pending/.test(zero), 'live data: a real "0 done" still shows as 0/4');
  ok(!/prod-subchip/.test(header({ cachePartial: true }, null)), 'no sub-issues: no chip at all');
}
// 5. One helper draws the chip in the list row and in the header.
{
  const row = extractFunction('_prodRow');
  const ctx = extractFunction('_prodSubIssueContextHTML');
  ok(/_prodSubChipHTML\(sub\)/.test(row) && !/sub-issues done/.test(row), 'the list row uses the shared chip');
  ok(/_prodSubChipHTML\(progress\)/.test(ctx) && !/sub-issues done/.test(ctx), 'the header uses the shared chip');
}

if (failures) { console.error(failures + ' assertion(s) failed'); process.exit(1); }
console.log('prod-subissue-count-from-cache: all assertions passed');
