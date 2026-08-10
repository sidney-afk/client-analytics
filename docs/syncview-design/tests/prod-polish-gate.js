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
 * that alone left this gate red from 2026-07-23 to at least 2026-08-10 with
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
  // 'Browser errors: ' is prod-structure-subset.js's own console-audit throw
  // (:860). Without it that suite's console failures and its structural
  // assertion failures both landed as 'unclassified', which is why its first
  // classified run said nothing useful.
  ['page_error', /Console\/page errors|Browser errors:|net::ERR_/],
  ['module_or_syntax_error', /Cannot find module|SyntaxError|ReferenceError/],
  ['browser_launch_failed', /Executable doesn't exist|browserType\.launch/],
  ['browser_closed', /Target (page|context|browser) has been closed|Execution context was destroyed/],
  ['network_unreachable', /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN/],
  // Bare HTTP status classes only. A status code is a fixed three-digit
  // number, never live content.
  ['http_client_error', /\bHTTP 4\d\d\b|\bstatus(?: code)?[ :=]+4\d\d\b/],
  ['http_server_error', /\bHTTP 5\d\d\b|\bstatus(?: code)?[ :=]+5\d\d\b/],
  // Deliberately last of the timeout family: catches a timeout whose specific
  // Playwright call shape is not one of the above, so it lands as a timeout
  // rather than as 'unclassified'.
  ['timeout_unspecified', /\bTimeout\b|\btimed out\b/i],
];

/* Fallback vocabulary: JavaScript's own built-in error constructor names.
 *
 * ADDED 2026-08-10, from the first real run of this classifier. The PR run on
 * the commit that introduced it reported
 *   structure subset [unclassified], comment thread [selector_timeout],
 *   write gateway [response_timeout], accessibility/focus [unclassified]
 * — two of four still unnamed. That is the same blackout one level in: an
 * 'unclassified' tells a reader no more than a bare suite name did, and the
 * text needed to widen the table is exactly the runner-private text nobody
 * may read. So the fallback cannot come from the message; it comes from the
 * error TYPE, which is a closed set defined by the language itself.
 *
 * Every name here is a JS built-in. Matching is anchored to that fixed list
 * and the emitted code is built from the list entry, never from the input —
 * so this path is as incapable of carrying live text as the table above.
 */
const ERROR_NAMES = [
  'TimeoutError', 'AssertionError', 'TypeError', 'RangeError',
  'EvalError', 'URIError', 'AggregateError', 'Error',
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
  /* No signature matched. Fall back to the error TYPE, drawn from the fixed
   * ERROR_NAMES list — the code is assembled from the list entry, so nothing
   * from `haystack` is ever interpolated. 'Error' is checked last because it
   * is a substring of the more specific names. */
  for (const name of ERROR_NAMES) {
    if (new RegExp(`\\b${name}\\b`).test(haystack)) {
      return `error_${name.replace(/Error$/, '').toLowerCase() || 'generic'}`;
    }
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
