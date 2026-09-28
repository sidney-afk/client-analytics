#!/usr/bin/env node
'use strict';
/*
 * check-lazy-safety.js — safety nets for loading staff-only areas on demand.
 * Plan: docs/plans/2026-09-28-load-per-tab-plan.md, step 1. Changes nothing
 * that is served; it reads src/index/ and fails CI on new hazards.
 *
 * src/index/areas.txt puts every script fragment in "core" (loaded on every
 * visit) or a named staff-only area (a later step loads it the first time its
 * tab opens). Once an area is loaded on demand, three kinds of code break
 * quietly when they reach into it before it has loaded:
 *
 *   button  An inline handler string (onclick="fn(...)") in one area names a
 *           function that another, on-demand area owns. The click does
 *           nothing and nothing reports an error.
 *   guard   `typeof fn === 'function'` in one area, where fn is owned by
 *           another on-demand area. The guard reads "not loaded" and skips the
 *           work, silently: a pending save that is never flushed, say.
 *   import  A fragment imports a name from another on-demand area. Until that
 *           tie is cut, loading the importer pulls the whole area in (this is
 *           the step 3 worklist; reported, never a failure).
 *
 * RULES (each one fails the run):
 *   1. areas.txt lists every script fragment exactly once, and the approve /
 *      request-changes path (APPROVE_PATH below, a second copy on purpose) is
 *      "core!": in core, never split.
 *   2. Every button and guard hazard is recorded in
 *      src/index/lazy-safety-baseline.txt. A new one fails: fix it, or record
 *      it with --update so the diff shows it to the reviewer. A recorded one
 *      that no longer exists also fails, so the list only ever shrinks.
 *
 * REPORT (always printed): hazards and import ties per on-demand area, and
 * separately every one whose caller is on the approve path.
 *
 * Needs the acorn parser (see the DEPENDENCY note in scripts/check-modules.js).
 * Usage: node scripts/check-lazy-safety.js [--update]
 */
const fs = require('fs');
const path = require('path');
const { readModuleList, splitModuleFragment } = require('./index-modules');

let acorn;
try { acorn = require('acorn'); } catch (e) {
  console.error('check-lazy-safety: the acorn parser is not installed. See the DEPENDENCY note in scripts/check-modules.js.');
  process.exit(2);
}

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src', 'index');
const AREAS_FILE = path.join(SRC, 'areas.txt');
const BASELINE_FILE = path.join(SRC, 'lazy-safety-baseline.txt');
const UPDATE = process.argv.includes('--update');

// The client approve / request-changes path. Owner, 2026-09-28: it stays in
// core and is never split. Kept here as well as in areas.txt on purpose.
const APPROVE_PATH = [
  '120-calendar-flags-write-repair.js.part', '125-title-name-rule.js.part',
  '130-calendar-model-cache.js.part', '131-core-html.js.part', '132-calendar-dates-ids.js.part',
  '133-core-loading-skeletons.js.part', '134-calendar-prefs-mount.js.part',
  '140-calendar-legacy-outbox.js.part', '150-calendar-hydration-import.js.part',
  '160-calendar-organize-ui.js.part', '170-calendar-links-status.js.part',
  '180-calendar-native-post-media.js.part', '185-client-review-queue.js.part',
  '190-calendar-approval-comments.js.part', '270-samples-model.js.part',
  '280-samples-cards-notes.js.part', '290-samples-writes-review.js.part',
];

const errors = [];
const manifest = fs.readFileSync(path.join(SRC, 'manifest.txt'), 'utf8')
  .split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
const scriptFrags = manifest.filter(f => f.endsWith('.js.part'));
const htmlFrags = manifest.filter(f => f.endsWith('.html.part'));
const modules = readModuleList(SRC);

// ---- rule 1: the area map ---------------------------------------------------
const area = new Map();
const pinned = new Set();
for (const [i, raw] of fs.readFileSync(AREAS_FILE, 'utf8').split(/\r?\n/).entries()) {
  const line = raw.replace(/#.*/, '').trim();
  if (!line) continue;
  const [frag, a, extra] = line.split(/\s+/);
  if (!a || extra) { errors.push(`areas.txt line ${i + 1}: expected "<fragment> <area>"`); continue; }
  if (area.has(frag)) errors.push(`areas.txt lists ${frag} twice`);
  if (!/^(core!?|[a-z][a-z-]*)$/.test(a)) errors.push(`areas.txt: ${frag} has an invalid area "${a}"`);
  if (a === 'core!') pinned.add(frag);
  area.set(frag, a === 'core!' ? 'core' : a);
}
for (const f of scriptFrags) if (!area.has(f)) errors.push(`areas.txt does not list ${f}`);
for (const f of area.keys()) if (!scriptFrags.includes(f)) errors.push(`areas.txt lists ${f}, which is not a script fragment in manifest.txt`);
for (const f of APPROVE_PATH) {
  if (!scriptFrags.includes(f)) errors.push(`approve-path fragment ${f} is missing from manifest.txt (update APPROVE_PATH if it was renamed)`);
  else if (!pinned.has(f)) errors.push(`${f} is on the client approve / request-changes path and must be "core!" in areas.txt (never split)`);
}
for (const f of pinned) if (!APPROVE_PATH.includes(f)) errors.push(`${f} is "core!" in areas.txt but not on APPROVE_PATH in this checker; add it to both or neither`);
for (const f of htmlFrags) area.set(f, 'core');

// ---- who owns each top-level name ------------------------------------------
const bodyOf = new Map();
for (const f of manifest) {
  const buf = fs.readFileSync(path.join(SRC, f));
  bodyOf.set(f, (modules.has(f) ? splitModuleFragment(buf).body : buf).toString('utf8'));
}
const owner = new Map(); // name -> fragment (the last declaration wins, as in the page)
const imports = [];      // [importer, name, source fragment]
for (const f of scriptFrags) {
  let ast;
  try { ast = acorn.parse(bodyOf.get(f), { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true }); }
  catch (e) { errors.push(`${f}: does not parse (${e.message})`); continue; }
  for (const n of ast.body) {
    if (n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration') owner.set(n.id.name, f);
    if (n.type === 'VariableDeclaration') for (const d of n.declarations) if (d.id.type === 'Identifier') owner.set(d.id.name, f);
  }
  if (modules.has(f)) {
    const header = splitModuleFragment(fs.readFileSync(path.join(SRC, f))).header.toString('utf8');
    for (const m of header.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\/([^']+)\.js'/g)) {
      for (const name of m[1].split(',').map(s => s.trim()).filter(Boolean)) imports.push([f, name, m[2] + '.js.part']);
    }
  }
}
const lazy = f => area.get(f) && area.get(f) !== 'core';
const crosses = (from, to) => to && from !== to && lazy(to) && area.get(from) !== area.get(to);

// ---- hazards ----------------------------------------------------------------
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'return', 'function', 'typeof', 'new', 'catch', 'void', 'delete', 'in', 'of', 'await']);
const found = new Map(); // "kind caller name" -> count
const note = (kind, caller, name) => { const k = `${kind} ${caller} ${name}`; found.set(k, (found.get(k) || 0) + 1); };
for (const f of manifest) {
  const text = bodyOf.get(f);
  for (const m of text.matchAll(/\bon[a-z]+\s*=\s*(\\?["'])([\s\S]{0,400}?)\1/g)) {
    for (const c of m[2].matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
      const name = c[2];
      if (!KEYWORDS.has(name) && crosses(f, owner.get(name))) note('button', f, name);
    }
  }
  for (const m of text.matchAll(/typeof\s+(?:window\.)?([A-Za-z_$][\w$]*)\s*[!=]==?\s*['"]function['"]/g)) {
    if (crosses(f, owner.get(m[1]))) note('guard', f, m[1]);
  }
}

// ---- rule 2: the ratchet ----------------------------------------------------
const current = [...found.keys()].sort();
if (UPDATE) {
  const head = [
    '# Recorded on-demand-loading hazards: "<kind> <caller fragment> <name>".',
    '# Written by `node scripts/check-lazy-safety.js --update`; see that file for what each kind means.',
    '# The list may only shrink: a new line needs a reason in its PR, and a line whose hazard is gone must be removed.',
  ];
  fs.writeFileSync(BASELINE_FILE, head.concat(current).join('\n') + '\n');
  console.log(`check-lazy-safety: wrote ${current.length} hazards to ${path.relative(ROOT, BASELINE_FILE)}`);
} else {
  const recorded = fs.existsSync(BASELINE_FILE)
    ? fs.readFileSync(BASELINE_FILE, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'))
    : [];
  const rec = new Set(recorded);
  for (const k of current) if (!rec.has(k)) errors.push(`new hazard: ${k} (see the header of scripts/check-lazy-safety.js)`);
  for (const k of recorded) if (!found.has(k)) errors.push(`recorded hazard is gone, remove its line from lazy-safety-baseline.txt: ${k}`);
}

// ---- report -----------------------------------------------------------------
const areas = [...new Set([...area.values()].filter(a => a !== 'core'))].sort();
console.log('on-demand area         fragments  buttons  guards  import ties (names / importing files)');
for (const a of areas) {
  const frags = [...area].filter(([, v]) => v === a).map(([k]) => k);
  const into = ([kind, caller, name]) => kind !== 'import' && area.get(owner.get(name)) === a;
  const keys = [...found.keys()].map(k => k.split(' '));
  const b = keys.filter(k => k[0] === 'button' && into(k)).length;
  const g = keys.filter(k => k[0] === 'guard' && into(k)).length;
  const ties = imports.filter(([imp, , src]) => area.get(src) === a && area.get(imp) !== a);
  console.log(`${a.padEnd(22)} ${String(frags.length).padStart(9)} ${String(b).padStart(8)} ${String(g).padStart(7)}  ${new Set(ties.map(t => t[1])).size} / ${new Set(ties.map(t => t[0])).size}`);
}
const fromApprove = [...found.keys()].filter(k => pinned.has(k.split(' ')[1]));
const approveTies = imports.filter(([imp, , src]) => pinned.has(imp) && lazy(src));
console.log(`\napprove path reaching into on-demand areas: ${fromApprove.length} hazards, ${approveTies.length} import ties`);
const byArea = {};
for (const [imp, name, src] of approveTies) (byArea[area.get(src)] = byArea[area.get(src)] || new Set()).add(name);
for (const [a, names] of Object.entries(byArea).sort()) console.log(`  ${a}: ${[...names].sort().join(', ')}`);

if (errors.length) {
  console.error('\ncheck-lazy-safety: FAIL');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(`\ncheck-lazy-safety: all checks passed (${current.length} recorded hazards)`);
