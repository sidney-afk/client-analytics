'use strict';
/*
 * The SyncLinear lookup tables answer exactly what the scans they replaced did.
 *
 * `_prodIssue` and `_prodChildrenOf` used to walk the whole issue list on every
 * call (about 5,700 rows, called per row of a ~1,600 row list render). They now
 * read per-adapter tables (`_prodLookups`). This suite runs the SHIPPED
 * functions against a verbatim copy of the OLD ones over thousands of generated
 * issue sets built to hurt: duplicate ids, a display id equal to another row's
 * id, an alias that collides with a canonical key, missing and null parents,
 * non-string ids, equal titles, untyped teams. Every answer must be identical,
 * by reference for `_prodIssue` and in order for `_prodChildrenOf`, and a
 * fresh array every call.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed++; console.log('  ok  ' + m); };

function grab(name) {
  const at = INDEX.search(new RegExp('function\\s+' + name + '\\s*\\('));
  assert.ok(at >= 0, 'function not found: ' + name);
  let depth = 0;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    if (INDEX[j] === '{') depth++;
    else if (INDEX[j] === '}' && --depth === 0) return INDEX.slice(at, j + 1);
  }
  throw new Error('unbalanced ' + name);
}
function constant(name) {
  const m = new RegExp('const ' + name + '\\s*=\\s*([^;]+);').exec(INDEX);
  assert.ok(m, 'missing const ' + name);
  return m[0];
}

// ---- the shipped functions, in a sandbox whose issue list we control --------
const sandbox = { rows: [], String, Map, WeakMap, Set, Array, Object, Number };
vm.createContext(sandbox);
vm.runInContext([
  constant('PROD_TEAM_ORDER'),
  grab('_prodWriteTeam'), grab('_prodChildTeamRank'), grab('_prodChildOrder'),
  'const _prodLookupCache = new WeakMap();',
  grab('_prodLookups'), grab('_prodIssue'), grab('_prodChildrenOf'),
  'function _prodIssues() { return rows; }',
  'this.shippedIssue = _prodIssue; this.shippedChildren = _prodChildrenOf; this.order = _prodChildOrder;'
].join('\n'), sandbox);
ok(typeof sandbox.shippedIssue === 'function' && typeof sandbox.shippedChildren === 'function',
  'the shipped lookups extract and execute (the harness is not vacuous)');

// ---- the OLD implementations, verbatim from before the change ---------------
function legacyIssue(rows, id) {
  const sid = String(id || '');
  if (!sid) return null;
  return rows.find(i => i.id === sid || i.displayId === sid)
    || rows.find(i => i.aliasId && i.aliasId === sid)
    || null;
}
function legacyChildren(rows, id) {
  return rows.filter(d => d.parent === id).sort(sandbox.order);
}

// ---- generator ---------------------------------------------------------------
let seed = 20261001;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const pick = a => a[Math.floor(rnd() * a.length)];
const TEAMS = ['video', 'graphics', 'Video', ' graphics ', '', null, undefined, 'other'];
const TITLES = ['Video 2', 'Video 10', 'video 1', 'Reel 5', 'Thumbnail 3', 'Thumbnail 03', '', null, 'Same', 'Same', 'Same'];
function makeRows() {
  const n = 1 + Math.floor(rnd() * 40);
  const keys = Array.from({ length: Math.max(3, Math.floor(n * 0.7)) }, (_, k) => 'k' + k);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const row = {
      id: rnd() < 0.05 ? 7 : (rnd() < 0.1 ? pick(keys) : 'id' + i),               // numbers and duplicate ids
      displayId: rnd() < 0.15 ? pick(keys) : (rnd() < 0.8 ? 'D-' + Math.floor(rnd() * 12) : undefined),
      aliasId: rnd() < 0.3 ? (rnd() < 0.5 ? pick(keys) : 'D-' + Math.floor(rnd() * 12)) : '',
      parent: rnd() < 0.4 ? null : (rnd() < 0.1 ? undefined : pick(keys.concat(['id0', 'id1', 'D-3']))),
      title: pick(TITLES), team: pick(TEAMS)
    };
    if (rnd() < 0.1) delete row.parent;
    rows.push(row);
  }
  return rows;
}

let comparisons = 0;
for (let iter = 0; iter < 3000; iter++) {
  const rows = makeRows();
  sandbox.rows = rows;
  const probes = ['', null, undefined, 0, 7, '7', 'k0', 'k1', 'k2', 'id0', 'id1', 'D-3', 'D-11', 'nope']
    .concat(rows.slice(0, 6).flatMap(r => [r.id, r.displayId, r.aliasId, r.parent]));
  for (const probe of probes) {
    const a = legacyIssue(rows, probe), b = sandbox.shippedIssue(probe);
    if (a !== b) assert.fail('_prodIssue differs for ' + JSON.stringify(probe) + ' on ' + JSON.stringify(rows));
    const x = legacyChildren(rows, probe), y = sandbox.shippedChildren(probe);
    if (x.length !== y.length || x.some((r, k) => r !== y[k])) {
      assert.fail('_prodChildrenOf differs for ' + JSON.stringify(probe) + ' on ' + JSON.stringify(rows));
    }
    comparisons += 2;
  }
}
ok(comparisons > 100000, comparisons + ' generated answers: _prodIssue (same row, by reference) and _prodChildrenOf (same rows, same order) are identical to the old scans');

// ---- freshness of arrays, and the cache is per adapter ----------------------
sandbox.rows = [{ id: 'p', parent: null, title: 'P' }, { id: 'a', parent: 'p', title: 'A', team: 'video' }, { id: 'b', parent: 'p', title: 'B', team: 'video' }];
const first = sandbox.shippedChildren('p'); first.push('junk'); first.reverse();
ok(sandbox.shippedChildren('p').map(r => r.id).join() === 'a,b', 'a caller that edits the returned array cannot corrupt the next answer');
ok(sandbox.shippedChildren('p') !== sandbox.shippedChildren('p'), 'and each call returns a fresh array, as `filter` did');
const rows2 = [{ id: 'p', parent: null }, { id: 'z', parent: 'p', title: 'Z' }];
sandbox.rows = rows2;
ok(sandbox.shippedChildren('p').map(r => r.id).join() === 'z' && sandbox.shippedIssue('z') === rows2[1],
  'a new issue list (a new adapter) is looked up afresh, never answered from the old one');
console.log('\nprod-lookup-equivalence: ' + passed + ' checks passed ✅');
