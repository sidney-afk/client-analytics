'use strict';

/*
 * Track B §10.8 mechanical fidelity lane.
 *
 * Each entry maps a wired Production function to the artifact function it ports
 * from docs/syncview-design/SyncView.html. Differences are allowed only when the
 * wired function carries a PORT-DELTA comment with a reason. This keeps new
 * transplants honest without pretending the embedded, live-data tab can be a
 * byte-for-byte copy of the standalone artifact.
 */

const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const artifactPath = path.join(repo, 'docs', 'syncview-design', 'SyncView.html');
const wiredPath = path.join(repo, 'index.html');
const artifact = fs.readFileSync(artifactPath, 'utf8');
const wired = fs.readFileSync(wiredPath, 'utf8');

const PAIRS = [
  ['statusSVG', '_prodStatusSVG'],
  ['renderSidebar', '_prodSidebar'],
  ['groupsFor', '_prodGroupsFor'],
  ['rowHTML', '_prodRow'],
  ['renderList', '_prodList'],
  ['renderProjects', '_prodBoard'],
  ['renderDetail', '_prodDetail'],
  ['layerPop', '_prodLayerPop'],
  ['openSub', '_prodOpenSub'],
  ['buildDue', '_prodBuildDue'],
  ['openContextMenu', '_prodOpenContextMenu'],
  ['pillsHTML', '_prodPillsHTML'],
  ['buildFilterValues', '_prodBuildFilterValues'],
  ['openFilterSub', '_prodOpenFilterSub'],
  ['openFilterMenu', '_prodOpenFilterMenu'],
  ['openGroupMenu', '_prodOpenGroupMenu'],
  ['openSearch', '_prodOpenPalette']
];
const CONST_PAIRS = [
  ['I', 'PROD_ICON']
];

function findFunction(src, name) {
  const needle = 'function ' + name + '(';
  const start = src.indexOf(needle);
  if (start < 0) return null;
  const bodyStart = src.indexOf('{', start);
  if (bodyStart < 0) return null;
  let depth = 0;
  let quote = '';
  let esc = false;
  let line = false;
  let block = false;
  for (let i = bodyStart; i < src.length; i++) {
    const ch = src[i];
    const nx = src[i + 1];
    if (line) {
      if (ch === '\n') line = false;
      continue;
    }
    if (block) {
      if (ch === '*' && nx === '/') { block = false; i++; }
      continue;
    }
    if (quote) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && nx === '/') { line = true; i++; continue; }
    if (ch === '/' && nx === '*') { block = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

function findConstObject(src, name) {
  const needle = 'const ' + name;
  const start = src.indexOf(needle);
  if (start < 0) return null;
  const bodyStart = src.indexOf('{', start);
  if (bodyStart < 0) return null;
  let depth = 0;
  let quote = '';
  let esc = false;
  let line = false;
  let block = false;
  for (let i = bodyStart; i < src.length; i++) {
    const ch = src[i];
    const nx = src[i + 1];
    if (line) {
      if (ch === '\n') line = false;
      continue;
    }
    if (block) {
      if (ch === '*' && nx === '/') { block = false; i++; }
      continue;
    }
    if (quote) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && nx === '/') { line = true; i++; continue; }
    if (ch === '/' && nx === '*') { block = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        let end = i + 1;
        while (src[end] && /\s/.test(src[end])) end++;
        if (src[end] === ';') end++;
        return src.slice(start, end);
      }
    }
  }
  return null;
}

function hasPortDelta(src, fnStart) {
  const before = src.slice(Math.max(0, fnStart - 260), fnStart);
  return /PORT-DELTA:\s*\S/.test(before);
}

function normalize(fn, names) {
  let out = fn;
  out = out.replace(/\/\/ PORT-DELTA:[^\n]*\n/g, '');
  out = out.replace(/function\s+[_a-zA-Z0-9]+\s*\(/, 'function FN(');
  out = out.replace(new RegExp(names.wired.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), names.artifact);
  out = out.replace(/_prodState/g, 'S');
  out = out.replace(/_prodReadonlyGuard\(\)/g, 'READ_ONLY_GUARD()');
  out = out.replace(/_prod/g, '');
  out = out.replace(/prod-/g, '');
  out = out.replace(/data-prod-/g, 'data-');
  out = out.replace(/_calEscAttr/g, 'esc');
  out = out.replace(/_calEsc/g, 'esc');
  out = out.replace(/_jsAttrArg/g, 'esc');
  return out.replace(/\s+/g, ' ').trim();
}

function normalizeConst(obj, names) {
  let out = obj;
  out = out.replace(new RegExp('const\\s+' + names.artifact + '\\s*='), 'const ICON=');
  out = out.replace(new RegExp('const\\s+' + names.wired + '\\s*='), 'const ICON=');
  out = out.replace(/\bic\s*\(/g, 'IC(');
  out = out.replace(/_prodRawIcon\s*\(/g, 'IC(');
  out = out.replace(/const ICON=\s+{/g, 'const ICON={');
  out = out.replace(/:\s+IC\(/g, ':IC(');
  out = out.replace(/:\s+'/g, ":'");
  out = out.replace(/:\s+"/g, ':"');
  return out.replace(/\s+/g, ' ').trim();
}

let failed = 0;
const notes = [];

for (const [artifactName, wiredName] of PAIRS) {
  const af = findFunction(artifact, artifactName);
  const wf = findFunction(wired, wiredName);
  if (!af) {
    console.error('missing artifact function: ' + artifactName);
    failed++;
    continue;
  }
  if (!wf) {
    console.error('missing wired function: ' + wiredName);
    failed++;
    continue;
  }
  const wStart = wired.indexOf('function ' + wiredName + '(');
  const same = normalize(af, { artifact: artifactName, wired: wiredName }) === normalize(wf, { artifact: artifactName, wired: wiredName });
  if (same) {
    notes.push('exact/allowed: ' + wiredName + ' -> ' + artifactName);
    continue;
  }
  if (!hasPortDelta(wired, wStart)) {
    console.error('unmarked port delta: ' + wiredName + ' -> ' + artifactName);
    failed++;
    continue;
  }
  notes.push('annotated delta: ' + wiredName + ' -> ' + artifactName);
}

for (const [artifactName, wiredName] of CONST_PAIRS) {
  const ao = findConstObject(artifact, artifactName);
  const wo = findConstObject(wired, wiredName);
  if (!ao) {
    console.error('missing artifact const object: ' + artifactName);
    failed++;
    continue;
  }
  if (!wo) {
    console.error('missing wired const object: ' + wiredName);
    failed++;
    continue;
  }
  const same = normalizeConst(ao, { artifact: artifactName, wired: wiredName }) === normalizeConst(wo, { artifact: artifactName, wired: wiredName });
  if (!same) {
    console.error('unmarked icon-object drift: ' + wiredName + ' -> ' + artifactName);
    failed++;
    continue;
  }
  notes.push('exact object: ' + wiredName + ' -> ' + artifactName);
}

if (failed) process.exit(1);
console.log('port-fidelity-check: ' + (PAIRS.length + CONST_PAIRS.length) + ' mapped ports checked');
notes.forEach(n => console.log('  ' + n));
