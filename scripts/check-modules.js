'use strict';
/*
 * check-modules.js -- phase C step C3, step 1 of the C3 plan,
 * docs/plans/2026-09-24-modularization-c3-plan.md (added by PR #1564, which
 * merges before this one; the roadmap it follows is
 * docs/plans/2026-09-21-post-modularization-roadmap.md).
 *
 * Proves, over the src/index/ script fragments, the facts that the plan's
 * one-fragment-at-a-time conversion to ES modules depends on. It changes
 * nothing; it reads the fragments (and, with --against, one git blob).
 *
 * CHECKS (each fails the run):
 *
 *   1. STANDALONE. Every `*.js.part` fragment parses on its own as a classic
 *      script. A fragment that begins or ends mid-statement cannot become a
 *      module, so a cut that breaks this is caught at the cut.
 *
 *   2. NO DUPLICATE TOP-LEVEL DECLARATIONS. In today's single classic script a
 *      second `function f` silently replaces the first everywhere; in a module
 *      it is a SyntaxError. Names already known to be duplicated are listed in
 *      KNOWN_DUPLICATES below and reported, not failed; any other duplicate
 *      fails. That list only ever shrinks.
 *
 *   3. PARSES AS A MODULE. The assembled main script (fragments 040..340) is
 *      parsed with sourceType "module": strict-mode syntax, and the duplicate
 *      rule above as the parser itself enforces it. The earlier copies of the
 *      KNOWN_DUPLICATES are blanked (same length, so positions hold) before
 *      this parse and only then.
 *
 *   4. NO LOAD-TIME FORWARD REFERENCE. Code that runs while the page is still
 *      loading (top-level statements, outside any function body) must not use
 *      a top-level name that a LATER fragment declares. Measured 0 on
 *      2026-09-24; it is what makes converting one fragment at a time safe,
 *      and what a module loader would turn into a real ordering bug.
 *      Function bodies are skipped because they run later, EXCEPT a function
 *      invoked where it is written (`(() => x)()`, `new function(){}`,
 *      `(function(){}).call(this)`), whose body runs at load and is walked;
 *      class computed keys, static field initialisers and static blocks are
 *      walked for the same reason. Approximations, stated: (a) names bound
 *      inside the statement itself (block let/const, catch and invoked-
 *      function parameters, destructuring) are excluded by name, not by exact
 *      scope, which can only hide a violation whose name is also such a local
 *      binding; (b) a callback handed to a function that happens to call it
 *      synchronously (`list.forEach(x => ...)` at top level) is treated as
 *      deferred, because that cannot be known without running the code.
 *
 *   5. --against=<git-ref> (optional). Assembles index.html from the
 *      fragments exactly as scripts/build-index.js does (raw bytes, manifest
 *      order, no separators) and requires it to equal `git show
 *      <ref>:index.html` byte for byte. `npm run check:index` compares the
 *      build with the working tree and HEAD only, so a PR that commits a
 *      regenerated page passes it even if the page changed; this is the check
 *      that proves an annotate-only step left the served page untouched.
 *
 * REPORT (--report, informational, never fails): per-fragment top-level
 * declaration counts, functions named in inline handler strings that are not
 * copied onto `window`, and `typeof x === 'function'` guards. These are the
 * two hazards the plan's final runtime switch must clear; counting them here
 * keeps the number visible as it moves.
 *
 * DEPENDENCY. Needs the `acorn` parser. package.json is content-pinned (the
 * F27 reviewed closure and the leave-evidence fingerprint both hash it), so
 * acorn is NOT a declared dependency: CI installs it into a temp prefix and
 * points NODE_PATH at it (see calendar-unit-tests.yml, `module-check`).
 * Locally: npm install --no-save --no-package-lock --prefix /tmp/c3 acorn@8.15.0
 * then NODE_PATH=/tmp/c3/node_modules node scripts/check-modules.js
 *
 * Usage: node scripts/check-modules.js [--against=<git-ref>] [--report]
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

let acorn;
try { acorn = require('acorn'); } catch (e) {
  console.error('check-modules: the acorn parser is not installed. See the DEPENDENCY note at the top of this file.');
  process.exit(2);
}

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src', 'index');

// Earlier copies are dead today (the later declaration wins in a classic
// script). Remove a name from this list in the same change that deletes its
// earlier copy.
const KNOWN_DUPLICATES = new Set([]);

const args = process.argv.slice(2);
const againstArg = args.find(a => a.startsWith('--against='));
const against = againstArg ? againstArg.slice('--against='.length) : '';
const wantReport = args.includes('--report');

const failures = [];
const fail = (msg) => failures.push(msg);

const manifest = fs.readFileSync(path.join(SRC_DIR, 'manifest.txt'), 'utf8')
  .split(/\r?\n/).map(s => s.trim()).filter(Boolean);
const scriptFrags = manifest.filter(f => f.endsWith('.js.part'));
const short = f => f.split('-')[0];

// ---- 1. every script fragment parses on its own ---------------------------
const SCRIPT_OPEN = '<script>';
const pieces = [];
for (const f of scriptFrags) {
  let text = fs.readFileSync(path.join(SRC_DIR, f), 'utf8');
  let lead = 0;
  // The first script fragment carries the opening tag of the main <script>.
  if (text.startsWith(SCRIPT_OPEN)) { lead = SCRIPT_OPEN.length; text = text.slice(lead); }
  try {
    acorn.parse(text, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true });
  } catch (e) {
    fail(`${f}: does not parse on its own as a script (${e.message})`);
  }
  pieces.push({ f, text });
}

// Assemble the main script from the pieces, remembering where each begins.
let code = '';
const starts = [];
for (const p of pieces) { starts.push({ f: p.f, at: code.length }); code += p.text; }
const fragAt = (pos) => { let hit = starts[0].f; for (const s of starts) { if (s.at <= pos) hit = s.f; else break; } return hit; };
const fragIndex = new Map(scriptFrags.map((f, i) => [f, i]));

let ast;
try {
  ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script', ranges: true, allowReturnOutsideFunction: true });
} catch (e) {
  fail(`assembled main script does not parse as a script (${e.message})`);
}

// ---- walker ----------------------------------------------------------------
function children(node) {
  const out = [];
  for (const key of Object.keys(node)) {
    if (key === 'range' || key === 'start' || key === 'end' || key === 'loc') continue;
    const v = node[key];
    if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') out.push([c, node, key]); }
    else if (v && typeof v.type === 'string') out.push([v, node, key]);
  }
  return out;
}
function bindingNames(pattern, into) {
  if (!pattern) return;
  switch (pattern.type) {
    case 'Identifier': into.add(pattern.name); break;
    case 'ObjectPattern': for (const p of pattern.properties) bindingNames(p.type === 'RestElement' ? p.argument : p.value, into); break;
    case 'ArrayPattern': for (const e of pattern.elements) bindingNames(e, into); break;
    case 'AssignmentPattern': bindingNames(pattern.left, into); break;
    case 'RestElement': bindingNames(pattern.argument, into); break;
  }
}

const decls = new Map(); // name -> [{ frag, node }]
if (ast) {
  for (const node of ast.body) {
    const frag = fragAt(node.start);
    const names = new Set();
    if ((node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') && node.id) names.add(node.id.name);
    else if (node.type === 'VariableDeclaration') for (const d of node.declarations) bindingNames(d.id, names);
    for (const n of names) { if (!decls.has(n)) decls.set(n, []); decls.get(n).push({ frag, node }); }
  }

  // ---- 2. duplicates ---------------------------------------------------------
  const blank = [];
  for (const [name, list] of decls) {
    if (list.length < 2) continue;
    const where = list.map(d => short(d.frag)).join(', ');
    if (KNOWN_DUPLICATES.has(name)) {
      console.log(`known duplicate: ${name} declared ${list.length} times (fragments ${where}); the last copy is the live one`);
      for (const d of list.slice(0, -1)) blank.push(d.node.range);
    } else {
      fail(`duplicate top-level declaration: ${name} (fragments ${where}); a module refuses this`);
    }
  }
  for (const name of KNOWN_DUPLICATES) {
    if (!decls.has(name) || decls.get(name).length < 2) {
      fail(`KNOWN_DUPLICATES lists ${name}, which is no longer duplicated; remove it from the list`);
    }
  }

  // ---- 3. parses as a module -------------------------------------------------
  let moduleCode = code;
  for (const [a, b] of blank) moduleCode = moduleCode.slice(0, a) + moduleCode.slice(a, b).replace(/[^\n]/g, ' ') + moduleCode.slice(b);
  try {
    acorn.parse(moduleCode, { ecmaVersion: 'latest', sourceType: 'module' });
  } catch (e) {
    const pos = e.pos != null ? e.pos : 0;
    fail(`assembled main script does not parse as a module: ${e.message.replace(/\s*\(\d+:\d+\)$/, '')} in ${fragAt(pos)}`);
  }

  // ---- 4. no load-time forward reference ------------------------------------
  const isFunction = t => t === 'FunctionDeclaration' || t === 'FunctionExpression' || t === 'ArrowFunctionExpression';
  // A function body normally runs later, not at load. The exception is a
  // function invoked where it is written: `(() => x)()`, `new function () {}`,
  // `(function () {}).call(this)`. Its body runs at load, so it is walked.
  const runsWhereWritten = (node, parent, key, grand) => {
    if (!parent) return false;
    if ((parent.type === 'CallExpression' || parent.type === 'NewExpression') && key === 'callee') return true;
    return parent.type === 'MemberExpression' && key === 'object' && !parent.computed
      && parent.property.type === 'Identifier' && (parent.property.name === 'call' || parent.property.name === 'apply')
      && !!grand && grand.type === 'CallExpression' && grand.callee === parent;
  };
  let forward = 0;
  for (const stmt of ast.body) {
    if (stmt.type === 'FunctionDeclaration') continue;
    const frag = fragAt(stmt.start);
    const myIndex = fragIndex.get(frag);
    // Names this statement binds for itself (never a top-level reference),
    // including the parameters and locals of functions invoked where written.
    const local = new Set();
    const collectLocal = (node, parent, key, grand) => {
      if (isFunction(node.type)) {
        if (node.id && node.type === 'FunctionDeclaration') local.add(node.id.name);
        if (!runsWhereWritten(node, parent, key, grand)) return;
        for (const param of node.params) bindingNames(param, local);
      }
      if (node.type === 'VariableDeclaration' && node !== stmt) for (const d of node.declarations) bindingNames(d.id, local);
      if (node.type === 'CatchClause' && node.param) bindingNames(node.param, local);
      if (node.type === 'ClassDeclaration' && node.id && node !== stmt) local.add(node.id.name);
      for (const [c, p, k] of children(node)) collectLocal(c, p, k, parent);
    };
    collectLocal(stmt, null, null, null);
    const visit = (node, parent, key, grand) => {
      // Runs later, not at load -- unless invoked where it is written.
      if (isFunction(node.type) && !runsWhereWritten(node, parent, key, grand)) return;
      if (node.type === 'ClassBody') {
        // Methods and instance fields run later. Computed keys, static field
        // initialisers and static blocks run when the class is defined.
        for (const el of node.body) {
          if (el.computed) visit(el.key, el, 'key', node);
          if (el.type === 'StaticBlock') for (const b of el.body) visit(b, el, 'body', node);
          else if (el.type === 'PropertyDefinition' && el.static && el.value) visit(el.value, el, 'value', node);
        }
        return;
      }
      if (node.type === 'Identifier') {
        if (parent && parent.type === 'MemberExpression' && key === 'property' && !parent.computed) return;
        if (parent && (parent.type === 'Property' || parent.type === 'PropertyDefinition' || parent.type === 'MethodDefinition') && key === 'key' && !parent.computed) return;
        if (parent && (parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' || parent.type === 'ContinueStatement')) return;
        if (parent && parent.type === 'VariableDeclarator' && key === 'id') return;
        if (local.has(node.name)) return;
        const list = decls.get(node.name);
        if (!list) return;
        const owner = list[list.length - 1].frag;
        if (fragIndex.get(owner) > myIndex) {
          forward++;
          fail(`${short(frag)} uses ${node.name} while loading, but it is declared later in ${owner}`);
        }
        return;
      }
      for (const [c, p, k] of children(node)) visit(c, p, k, parent);
    };
    visit(stmt, null, null, null);
  }

  // ---- report ---------------------------------------------------------------
  const topLevelCount = decls.size;
  console.log(`${scriptFrags.length} script fragments, ${topLevelCount} top-level names, ${forward} load-time forward references`);
  if (wantReport) {
    const perFrag = new Map(scriptFrags.map(f => [f, 0]));
    for (const list of decls.values()) perFrag.set(list[list.length - 1].frag, perFrag.get(list[list.length - 1].frag) + 1);
    console.log('\ntop-level names per fragment:');
    for (const [f, n] of perFrag) console.log(`  ${f}  ${n}`);
    const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const handlerRe = /\bon[a-z]+\s*=\s*(\\?["'])([\s\S]{0,300}?)\1/g;
    const called = new Set();
    let m;
    while ((m = handlerRe.exec(page))) {
      for (const id of (m[2].match(/[A-Za-z_$][\w$]*/g) || [])) {
        const list = decls.get(id);
        if (list && list[list.length - 1].node.type === 'FunctionDeclaration') called.add(id);
      }
    }
    const bridged = new Set([...page.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=/g)].map(x => x[1]));
    const unbridged = [...called].filter(n => !bridged.has(n));
    const guards = (code.match(/typeof\s+[A-Za-z_$][\w$]*\s*[!=]==?\s*['"]function['"]/g) || []).length;
    console.log(`\nfunctions named in inline handlers: ${called.size}; already copied onto window: ${called.size - unbridged.length}; not copied: ${unbridged.length}`);
    console.log(`typeof x === 'function' guards in the main script: ${guards}`);
  }
}

// ---- 5. byte identity against a base commit ---------------------------------
if (against) {
  const built = Buffer.concat(manifest.map(f => fs.readFileSync(path.join(SRC_DIR, f))));
  let base;
  try {
    base = execFileSync('git', ['show', `${against}:index.html`], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    fail(`--against=${against}: could not read index.html at that ref`);
  }
  if (base) {
    if (Buffer.compare(built, base) === 0) {
      console.log(`built index.html is byte-identical to ${against}:index.html (${built.length} bytes)`);
    } else {
      let i = 0;
      while (i < built.length && i < base.length && built[i] === base[i]) i++;
      fail(`built index.html differs from ${against}:index.html (built ${built.length} bytes, base ${base.length} bytes, first difference at byte ${i})`);
    }
  }
}

if (failures.length) {
  console.error('');
  for (const f of failures) console.error('FAIL  ' + f);
  console.error(`\ncheck-modules: ${failures.length} failure(s)`);
  process.exit(1);
}
console.log('\ncheck-modules: all checks passed');
