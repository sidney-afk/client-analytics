'use strict';
/*
 * Production sub-issues group by team, then read naturally inside each group.
 *
 * Owner ruling 2026-08-19: video work first, then graphics work, never
 * interleaved -- Reel 1..N and Video 1..N together, then Thumbnail 1..N.
 * Arriving order is whatever the rows were fetched in, which mixed both teams
 * and made a twelve-video batch unreadable.
 *
 * The fixture below is the ACTUAL arriving order from the owner's screenshot
 * of a live Jessica Winterstern batch, so this pins the real reported defect
 * rather than a tidy invention.
 *
 * Two traps this guards:
 *   1. A plain string sort puts "Reel 10" and "Reel 11" ahead of "Reel 2",
 *      which is exactly the unreadability the ruling is about. The comparison
 *      must be numeric-aware.
 *   2. The sub-issue SECTION and the prev/next SIBLING NAVIGATION both read
 *      _prodChildrenOf. If ordering moved to the render site the arrows would
 *      walk a different order than the list displays.
 */

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let failures = 0;
function ok(value, label) {
  if (value) console.log('  ok  ' + label);
  else { failures++; console.error('FAIL  ' + label); }
}

function extract(name) {
  const marker = 'function ' + name + '(';
  let start = source.indexOf(marker);
  if (start < 0) throw new Error('missing ' + name);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false, line = false, block = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    if (line) { if (ch === '\n') line = false; continue; }
    if (block) { if (ch === '*' && source[i + 1] === '/') { block = false; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') { line = true; i++; continue; }
    if (ch === '/' && source[i + 1] === '*') { block = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unclosed ' + name);
}

function constant(name) {
  const re = new RegExp('const ' + name + '\\s*=\\s*([^;]+);');
  const m = re.exec(source);
  if (!m) throw new Error('missing const ' + name);
  return m[0];
}

// The arriving order, verbatim from the owner's screenshot.
const ARRIVING = [
  ['Reel 4', 'video'], ['Thumbnail 6', 'graphics'], ['Video 9', 'video'],
  ['Thumbnail 4', 'graphics'], ['Video 12', 'video'], ['Reel 2', 'video'],
  ['Reel 5', 'video'], ['Reel 6', 'video'], ['Thumbnail 2', 'graphics'],
  ['Thumbnail 5', 'graphics'], ['Video 8', 'video'], ['Video 11', 'video'],
  ['Video 10', 'video'], ['Thumbnail 3', 'graphics'], ['Reel 3', 'video'],
  ['Video 7', 'video'],
];

function build(rows) {
  const body = constant('PROD_TEAM_ORDER') + '\n'
    + extract('_prodWriteTeam') + '\n'
    + extract('_prodChildTeamRank') + '\n'
    + extract('_prodChildrenOf') + '\n'
    + 'return _prodChildrenOf;';
  const childrenOf = new Function('_prodIssues', body)(() => rows);
  return childrenOf('p1');
}

const rows = ARRIVING.map(([title, team], i) => ({ id: 'k' + i, parent: 'p1', title, team }));
const sorted = build(rows).map(r => r.title);

// --- grouped, not interleaved ---------------------------------------------
const teams = build(rows).map(r => r.team);
const firstGraphic = teams.indexOf('graphics');
ok(firstGraphic > 0 && teams.slice(firstGraphic).every(t => t === 'graphics'),
'every graphics row sits after every video row -- the two teams are not interleaved');
ok(teams.slice(0, firstGraphic).every(t => t === 'video'),
'the leading block is entirely video work');

// --- natural ordering inside each group -----------------------------------
ok(JSON.stringify(sorted) === JSON.stringify([
  'Reel 2', 'Reel 3', 'Reel 4', 'Reel 5', 'Reel 6',
  'Video 7', 'Video 8', 'Video 9', 'Video 10', 'Video 11', 'Video 12',
  'Thumbnail 2', 'Thumbnail 3', 'Thumbnail 4', 'Thumbnail 5', 'Thumbnail 6',
]), 'the owner\'s live batch sorts exactly as ruled');

// The specific trap: a string sort would put 10/11/12 before 2.
ok(sorted.indexOf('Video 9') < sorted.indexOf('Video 10'),
'Video 9 precedes Video 10 -- the compare is numeric, not lexicographic');
ok(sorted.indexOf('Reel 2') < sorted.indexOf('Reel 6'),
'Reel 2 precedes Reel 6');

// --- untyped rows sort last, never into the video block --------------------
const withUntyped = build(rows.concat([{ id: 'kx', parent: 'p1', title: 'Aaa loose end', team: '' }]));
ok(withUntyped[withUntyped.length - 1].title === 'Aaa loose end',
'an untyped row sorts last despite an alphabetically-first title');

// --- it does not mutate the caller's array --------------------------------
const original = rows.map(r => r.title);
build(rows);
ok(JSON.stringify(rows.map(r => r.title)) === JSON.stringify(original),
'sorting does not reorder the underlying issue store');

// --- only children of the requested parent --------------------------------
const mixedParents = build(rows.concat([{ id: 'other', parent: 'p2', title: 'Reel 1', team: 'video' }]));
ok(!mixedParents.some(r => r.title === 'Reel 1'),
'rows belonging to a different parent are still excluded');

// --- the ordering lives where BOTH readers see it -------------------------
// Sibling navigation walks _prodChildrenOf by index; if a future change sorted
// at the render site instead, the arrows would disagree with the list.
ok(/const siblings = _prodChildrenOf\(parent\.id\);/.test(source),
'sibling navigation still reads its order from _prodChildrenOf');
ok(/kids\.map\(_prodSubIssueRowHTML\)/.test(source),
'the sub-issue section renders the list in the order it was handed');

if (failures) process.exit(1);
console.log('\nProduction sub-issue ordering checks passed');
