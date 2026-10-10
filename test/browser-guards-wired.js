'use strict';
/*
 * Every offline browser regression test runs somewhere, or says why not.
 *
 * Found 2026-10-10 (Digger, bug archaeology, OPEN_REPAIRS 396): 30 fully
 * mocked browser tests had never been started by any workflow. They were
 * written as the proof for a fix (the edit that stayed with its client, the
 * dialog press-and-release guard, Workload's signed-out privacy, the TikTok
 * queue guards and more), classified `isolated_browser` / `not_run_by_unit_ci`
 * or left in docs/syncview-design/tests unreferenced, and then nothing ran
 * them. Run on that day's main, 9 of the 30 failed: the behaviour they pinned
 * had moved and nobody was told. A guard that never runs is not a guard.
 *
 * What must hold:
 *   1. test/: a suite classified `isolated_browser` is `ci: "representative"`
 *      exactly when a workflow runs it (`node test/<file>`), and one that no
 *      workflow runs is listed in NOT_WIRED below with the reason.
 *   2. docs/syncview-design/tests/: every entry point (a file no other test
 *      file loads as a helper) is started by a workflow, directly, through an
 *      `npm run` script a workflow calls, or through a runner a workflow
 *      starts (the Production polish gate, the master tester); or it is
 *      listed in NOT_WIRED with the reason.
 *   3. NOT_WIRED holds no stale entry: a listed file that is now wired, or no
 *      longer exists, fails until the line is removed.
 *
 * Offline and dependency-free: it reads files only.
 */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WF_DIR = path.join(ROOT, '.github', 'workflows');
const DOCS_TESTS = 'docs/syncview-design/tests';

/* Path -> reason. A file here is NOT run by any workflow, on purpose or as a
   known debt; the reason says which. Remove the line when the file is wired. */
const NOT_WIRED = {
  'docs/syncview-design/tests/b4-staff-login.js': 'offline, but fails on main 2026-10-10: its key-toggle label contradicts the pin in test/b4-staff-login-source.js, and its menu keyboard checks predate the September menu rework; settle the label, then repair before wiring (OPEN_REPAIRS 396)',
  'docs/syncview-design/tests/workload-board-browser.js': 'stale since #1391 (2026-09-17): its harness still serves the retired Linear-era reads, not the workload-plan native snapshot; the harness needs rewriting before wiring (OPEN_REPAIRS 396)',
  'docs/syncview-design/tests/workload-render-browser.js': 'same harness as workload-board-browser, stale since #1391 (2026-09-17); rewrite before wiring (OPEN_REPAIRS 396)',
};

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function mentions(text, rel) {
  const esc = rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(^|[\\s/\'"`=])' + esc + '(?=$|[\\s\'"`;)&|])', 'm').test(text);
}

// What the workflows start: their own text, the npm scripts they call, and the
// runner files they start (one level, which is all the repo uses).
const workflows = fs.readdirSync(WF_DIR).filter(f => /\.ya?ml$/.test(f))
  .map(f => fs.readFileSync(path.join(WF_DIR, f), 'utf8')).join('\n');
const scripts = JSON.parse(read('package.json')).scripts || {};
const npmCalled = Object.keys(scripts).filter(name =>
  new RegExp('npm run ' + name.replace(/[:.*+?^${}()|[\]\\]/g, '\\$&') + '(?=$|\\s)', 'm').test(workflows)
  || (name === 'test' && /npm test(?=$|\s)/m.test(workflows)));
const RUNNERS = [`${DOCS_TESTS}/prod-polish-gate.js`, 'qa/master.js'].filter(rel => fs.existsSync(path.join(ROOT, rel)) && mentions(workflows, rel));
const started = [workflows, ...npmCalled.map(n => scripts[n]), ...RUNNERS.map(read)].join('\n');
function wired(rel) {
  if (mentions(started, rel)) return true;
  // Runners name their lanes by bare file name inside their own folder.
  const base = path.basename(rel);
  return RUNNERS.some(r => path.dirname(r) === path.dirname(rel) && mentions(read(r), base));
}

const problems = [];
const notWiredSeen = new Set();

// 1. test/ browser profiles.
const registry = JSON.parse(read('test/suite-classification.json'));
const browser = registry.profiles.filter(p => p.route === 'isolated_browser');
assert.ok(browser.length > 0, 'no isolated_browser profiles found: the registry format changed under this test');
for (const p of browser) {
  const rel = 'test/' + p.file;
  const isWired = mentions(workflows, rel);
  if (isWired && p.ci !== 'representative') problems.push(`${rel}: a workflow runs it, so classify it ci "representative"`);
  if (!isWired && p.ci === 'representative') problems.push(`${rel}: classified ci "representative" but no workflow runs it`);
  if (!isWired) {
    if (NOT_WIRED[rel]) notWiredSeen.add(rel);
    else problems.push(`${rel}: no workflow runs it; add it to a browser job, or to NOT_WIRED with the reason`);
  }
}

// 2. docs/syncview-design/tests entry points.
const docsFiles = fs.readdirSync(path.join(ROOT, DOCS_TESTS)).filter(f => /\.m?js$/.test(f)).sort();
const helperText = docsFiles.map(f => read(`${DOCS_TESTS}/${f}`)).join('\n')
  + '\n' + ['qa', 'test'].flatMap(dir => fs.readdirSync(path.join(ROOT, dir)).filter(f => /\.m?js$/.test(f)).map(f => read(`${dir}/${f}`))).join('\n');
function loadedAsHelper(file) {
  const stem = file.replace(/\.m?js$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(require\\(|from |import\\()\\s*['"][^'"]*\\b${stem}(\\.m?js)?['"]`).test(helperText);
}
let entryPoints = 0;
for (const f of docsFiles) {
  const rel = `${DOCS_TESTS}/${f}`;
  if (loadedAsHelper(f) && !NOT_WIRED[rel]) continue;
  entryPoints++;
  if (wired(rel)) continue;
  if (NOT_WIRED[rel]) notWiredSeen.add(rel);
  else problems.push(`${rel}: no workflow, npm script a workflow calls, or runner starts it; wire it, or add it to NOT_WIRED with the reason`);
}
assert.ok(entryPoints > 20, `only ${entryPoints} entry points found in ${DOCS_TESTS}: the helper detection is wrong`);

// 3. No stale NOT_WIRED line.
for (const rel of Object.keys(NOT_WIRED)) {
  if (!fs.existsSync(path.join(ROOT, rel))) problems.push(`NOT_WIRED: ${rel} no longer exists; remove the line`);
  else if (!notWiredSeen.has(rel)) problems.push(`NOT_WIRED: ${rel} is now run by a workflow; remove the line`);
  assert.ok(String(NOT_WIRED[rel]).length > 20, `NOT_WIRED: ${rel} needs a real reason`);
}

assert.deepEqual(problems, [], 'browser regression tests that never run:\n  ' + problems.join('\n  '));
console.log(`browser-guards-wired: ${browser.length} test/ browser suites and ${entryPoints} ${DOCS_TESTS} entry points each run in a workflow or carry a reason (${Object.keys(NOT_WIRED).length} not wired)`);
