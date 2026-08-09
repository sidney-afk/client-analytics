'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..', '..', '..');
const groups = new Set(['all', 'fast', 'interaction', 'heavy']);
const laneArg = process.argv.find(arg => arg.startsWith('--lane='));
const lane = laneArg ? laneArg.slice('--lane='.length) : 'all';

if (!groups.has(lane)) {
  console.error(`Unknown Production polish lane: ${lane}`);
  process.exit(2);
}

const suites = [
  ['fast', 'Production boot budget', 'docs/syncview-design/tests/prod-boot-budget.js'],
  ['fast', 'Production structure subset', 'docs/syncview-design/tests/prod-structure-subset.js'],
  ['fast', 'Production read-only smoke', 'docs/syncview-design/tests/prod-readonly-smoke.js'],
  ['fast', 'Production comment thread', 'docs/syncview-design/tests/prod-comments-browser.js'],
  ['fast', 'Production write gateway', 'docs/syncview-design/tests/prod-write-gateway-browser.js'],
  ['interaction', 'Production interaction inventory', 'docs/syncview-design/tests/prod-interaction-inventory.js'],
  ['fast', 'Production accessibility/focus', 'docs/syncview-design/tests/prod-a11y-focus.js'],
  ['fast', 'Production layout polish', 'docs/syncview-design/tests/prod-layout-polish.js'],
  ['heavy', 'Production wired behavior', 'docs/syncview-design/tests/behav-wired.js'],
  ['heavy', 'Production pixel parity', 'docs/syncview-design/tests/pixel-wired.js'],
].filter(([group]) => lane === 'all' || group === lane);

/* Fixed public-safe failure vocabulary.
 *
 * WHY THIS EXISTS. The summary below already names WHICH suite failed, and
 * that alone left this gate red from 2026-08-03 to at least 2026-08-07 with
 * nobody able to act: the only thing a reader could learn was a suite name,
 * because full suite output is deliberately runner-private (it renders live
 * customer text — F122). "Which" without "why" is not actionable, so the gate
 * went unowned.
 *
 * Same fix the repo already applied twice — the Slice 5 drill failure codes
 * and the suite-name allowlist directly below. Each entry is a FIXED code
 * matched by a pattern that only ever matches framework-generated text
 * (Playwright/Node error shapes). The matched text is NEVER emitted; only the
 * code is. Order matters: first match wins, most specific first.
 */
const FAILURE_SIGNATURES = [
  ['shell_loaded_without_content', /Production preview shell loaded without content/],
  ['selector_timeout', /waitForSelector: Timeout|locator\S*\) to be visible/],
  ['response_timeout', /waitForResponse: Timeout/],
  ['navigation_timeout', /page\.(goto|waitForNavigation|waitForLoadState): Timeout/],
  ['action_timeout', /page\.(click|fill|press|hover|selectOption): Timeout/],
  ['unhandled_rejection', /triggerUncaughtException|UnhandledPromiseRejection/],
  ['assertion_failed', /AssertionError|assert\.(strictEqual|deepStrictEqual|ok)\b/],
  ['page_error', /Console\/page errors|net::ERR_/],
  ['module_or_syntax_error', /Cannot find module|SyntaxError|ReferenceError/],
  ['browser_launch_failed', /Executable doesn't exist|browserType\.launch/],
];

/* Classify WITHOUT quoting. Returns one code from the list above or
 * 'unclassified' — never a fragment of the suite's own output, so a live
 * client name, row body, or URL in that output cannot reach the summary.
 * Mirrors classifyFailure() in scripts/production-write-drill.js. */
function classifyFailure(text) {
  const haystack = String(text || '');
  for (const [code, pattern] of FAILURE_SIGNATURES) {
    if (pattern.test(haystack)) return code;
  }
  return 'unclassified';
}

const failures = [];
const results = [];
const started = Date.now();

for (const [, label, script] of suites) {
  console.log(`\n=== ${label} ===`);
  const suiteStarted = Date.now();
  /* Captured rather than inherited so the gate can classify the failure.
   * The raw text is written straight back out below, so the private runner
   * log keeps byte-for-byte what it always had; only the classification is
   * new, and only the code travels into the public summary. */
  const run = spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: process.env,
  });
  const combined = `${run.stdout || ''}${run.stderr || ''}`;
  process.stdout.write(combined);
  const seconds = ((Date.now() - suiteStarted) / 1000).toFixed(1);
  results.push({
    label,
    seconds,
    exit: run.status,
    pass: run.status === 0,
    reason: run.status === 0 ? '' : classifyFailure(combined),
  });
  if (run.status !== 0) {
    failures.push(`${label} failed with exit ${run.status == null ? 'unknown' : run.status}`);
    // Keep going: one failing suite must not hide the health of the rest.
    // The gate spent weeks red with only its FIRST failure visible, which
    // made "the gate is broken" indistinguishable from "everything after
    // the first suite is broken". Suites are read-only against a static
    // server, so continuing is side-effect-free.
  }
}

/* Public-safe per-suite summary. Suite LABELS are hardcoded strings in this
   file (already public); pass/fail and duration reveal nothing live-derived.
   CI redirects full suite output to a private runner-only log, which left a
   red run saying nothing about WHICH suite failed — the same fixed-allowlist
   lesson as the Slice 5 drill failure codes. Nothing from suite stdout ever
   enters this file: the trailing reason is one code from FAILURE_SIGNATURES,
   chosen by classifyFailure(), never a quotation of what the suite printed. */
const publicSummaryPath = process.env.PROD_POLISH_PUBLIC_SUMMARY;
if (publicSummaryPath) {
  try {
    require('fs').writeFileSync(
      publicSummaryPath,
      results.map(r => (r.pass
        ? `PASS ${r.seconds}s ${r.label}`
        : `FAIL ${r.seconds}s ${r.label} [${r.reason}]`)).join('\n') + '\n',
    );
  } catch (_) { /* summary is best-effort; never fail the gate over it */ }
}

const elapsed = ((Date.now() - started) / 1000).toFixed(1);
if (failures.length) {
  console.error(`\nprod-polish-gate (${lane}) failed after ${elapsed}s`);
  failures.forEach(f => console.error('  - ' + f));
  process.exit(1);
}

console.log(`\nprod-polish-gate (${lane}): all ${suites.length} selected suite(s) passed in ${elapsed}s`);
