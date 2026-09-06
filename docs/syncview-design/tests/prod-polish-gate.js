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
  /* WHY A CLICK DID NOT HAPPEN, ranked above every timeout code on purpose.
   *
   * A `locator.click()` that gives up prints "Timeout ... exceeded" followed by
   * an actionability call log naming the ONE condition that never became true.
   * Every code below matches a fixed string Playwright itself emits — none is
   * ever a fragment of the page, so these carry no more live content than the
   * timeout codes they outrank. They must sort first because a click timeout
   * matches `timeout_unspecified` as well, and "the element never went stable"
   * is a diagnosis where "something timed out" is only a symptom.
   *
   * Added 2026-08-31 after `timeout_unspecified@parent_link` located the fast
   * lane's failure to one block but said nothing about its cause — and the
   * sandbox this is maintained from cannot run Chromium against a network, so
   * the cause has to come back from CI or not at all.
   *
   * KEPT, BUT NOT THE AUTHORITY. On their first live run not one of these
   * matched, and that proved nothing about the defect: Playwright states the
   * POSITIVE ("element is visible, enabled and stable") and on failure simply
   * stops, so an unmatched pattern is as consistent with the wrong regex as
   * with any diagnosis. Guessing a third party's log format is the same mistake
   * as guessing the defect. They stay because `intercepts pointer events` is
   * a phrasing worth catching and the rest cost nothing — but the suite now
   * diagnoses its own click failures by asking the DOM directly and reporting
   * through the stage channel (`parent_link_gone`, `_covered`, `_moving`, …),
   * and THAT is what to read.
   *
   * Worth keeping in mind either way: every `waitForSelector` in these suites
   * passes straight through an unstable page, because visibility does not
   * require stability — so a repaint loop shows up for the first time at the
   * first click, several sections after whatever caused it. */
  ['click_unstable', /element is not stable/],
  ['click_intercepted', /intercepts pointer events/],
  ['click_not_visible', /element is not visible/],
  ['click_not_enabled', /element is not enabled/],
  ['click_offscreen', /outside of the viewport/],
  ['click_detached', /element was detached from the DOM/],
  ['shell_loaded_without_content', /Production preview shell loaded without content/],
  ['selector_timeout', /waitForSelector: Timeout|locator\S*\) to be visible/],
  ['response_timeout', /waitForResponse: Timeout/],
  ['navigation_timeout', /page\.(goto|waitForNavigation|waitForLoadState): Timeout/],
  ['action_timeout', /page\.(click|fill|press|hover|selectOption): Timeout/],
  ['unhandled_rejection', /triggerUncaughtException|UnhandledPromiseRejection/],
  ['assertion_failed', /AssertionError|assert\.(strictEqual|deepStrictEqual|ok)\b/],
  /* The console audit fails for three different reasons and 'page_error' said
   * all three the same way. On 2026-08-26 the structure-subset suite failed
   * page_error twice in a row on the same PR, and the code could not
   * distinguish "the app logged an error" (a product defect) from "a read was
   * still in flight when the suite finished" (the harness racing a background
   * refresh) — opposite diagnoses, identical code, and the runner log that
   * would separate them is private by F122.
   *
   * installReadConsoleAudit composes its message in a fixed order: console and
   * page errors first, then 'persistent read failures: ', then 'pending read
   * requests: '. So a message where one of those two prefixes comes FIRST is
   * one that carried no console error at all — which is why these patterns
   * anchor on 'Browser errors: ' immediately followed by the prefix, and stay
   * ahead of the general entry. Both codes remain assembled from literals in
   * this file; nothing from the message rides out. */
  ['page_error_pending_read', /Browser errors: pending read requests:/],
  ['page_error_persistent_read', /Browser errors: persistent read failures:/],
  // 'Browser errors: ' is prod-structure-subset.js's own console-audit throw
  // (:860). Without it that suite's console failures and its structural
  // assertion failures both landed as 'unclassified', which is why its first
  // classified run said nothing useful. Reached now only when a real console
  // or page error is present, since the two read-only shapes match above.
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

  /* WHERE, once WHY has had its chance.
   *
   * Everything above names a CAUSE and keeps priority, because a selector
   * timeout inside the submit section is better reported as a timeout than as
   * "submit". These last entries catch what used to fall through to the
   * ERROR_NAMES fallback: a suite's own assertion, which classified as
   * `error_generic` and told a reader nothing at all. That is not a rare tail --
   * for prod-write-gateway-browser.js it is EVERY assertion the suite can fail,
   * and it is exactly what the 2026-08-25 red run on PR #1143 reported.
   *
   * Each marker is emitted by that suite from a closed `PHASES` list, matched
   * here by a literal pattern, and emitted as a literal code. Nothing from the
   * suite's output is interpolated, so this path carries no more live content
   * than the suite-name allowlist does.
   */
  ['pwg_boot', /PWG_PHASE_BOOT\b/],
  ['pwg_create_closure', /PWG_PHASE_CREATE_CLOSURE\b/],
  ['pwg_quarantined_identity', /PWG_PHASE_QUARANTINED_IDENTITY\b/],
  ['pwg_assignee_projection', /PWG_PHASE_ASSIGNEE_PROJECTION\b/],
  ['pwg_authoritative_locks', /PWG_PHASE_AUTHORITATIVE_LOCKS\b/],
  ['pwg_submit', /PWG_PHASE_SUBMIT\b/],
  ['pwg_calendar_native_intake', /PWG_PHASE_CALENDAR_NATIVE_INTAKE\b/],
  /* Sub-phases carved out of quarantined_identity. Order among these does not
     decide anything -- every marker is a distinct literal, so no pattern here
     can shadow another. (An earlier note claimed these were "ranked before" the
     parent; they are not, and they do not need to be.) */
  ['pwg_quarantine_projection', /PWG_PHASE_QUARANTINE_PROJECTION\b/],
  ['pwg_quarantine_refusals', /PWG_PHASE_QUARANTINE_REFUSALS\b/],
  ['pwg_quarantine_gates', /PWG_PHASE_QUARANTINE_GATES\b/],
  ['pwg_quarantine_notice', /PWG_PHASE_QUARANTINE_NOTICE\b/],
  ['pwg_quarantine_no_traffic', /PWG_PHASE_QUARANTINE_NO_TRAFFIC\b/],
  // The other fifty lines that used to report as `pwg_quarantined_identity`.
  ['pwg_authority_restore', /PWG_PHASE_AUTHORITY_RESTORE\b/],
  ['pwg_status_write', /PWG_PHASE_STATUS_WRITE\b/],
  ['pwg_due_write', /PWG_PHASE_DUE_WRITE\b/],
  ['pwg_due_receipt', /PWG_PHASE_DUE_RECEIPT\b/],
  // The description flows (2026-09-06): the Markdown textarea and the five
  // sections of the in-place editor, each its own literal marker.
  ['pwg_description_markdown', /PWG_PHASE_DESCRIPTION_MARKDOWN\b/],
  ['pwg_inplace_place', /PWG_PHASE_INPLACE_PLACE\b/],
  ['pwg_inplace_type', /PWG_PHASE_INPLACE_TYPE\b/],
  ['pwg_inplace_link', /PWG_PHASE_INPLACE_LINK\b/],
  ['pwg_inplace_render', /PWG_PHASE_INPLACE_RENDER\b/],
  ['pwg_inplace_save', /PWG_PHASE_INPLACE_SAVE\b/],
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

/*
 * WHICH CHECK, for the one suite whose every assertion failure was unnamed.
 *
 * behav-wired.js runs 168 assertions and, when one fails, exits through its own
 * summary rather than through a framework error -- so no FAILURE_SIGNATURES
 * pattern matched and no ERROR_NAMES type applied. Every real assertion failure
 * in that suite therefore reported as `unclassified`, which is what run #607 on
 * main said and why nobody could act on it.
 *
 * The allowlist is read from behav-wired.js's OWN SOURCE: the check names are
 * string literals in that file, so this is a compile-time list in exactly the
 * sense the suite-name allowlist is. A name that is not in it is dropped. The
 * emitted code is assembled from allowlist entries, never from the run's
 * output, so this path can no more carry live text than the table above can.
 */
const BEHAV_WIRED_CHECKS = (() => {
  try {
    const src = require('fs').readFileSync(
      path.join(root, 'docs', 'syncview-design', 'tests', 'behav-wired.js'), 'utf8');
    const names = new Set();
    const re = /\bok\(\s*'([A-Za-z0-9_]+)'/g;
    let match;
    while ((match = re.exec(src))) names.add(match[1]);
    return names;
  } catch (_) { return new Set(); }
})();

/* Cap the emitted list. A suite-wide breakage fails dozens of checks at once,
   and a 40-name summary line is the same blackout in a different shape -- the
   first few name the area, and the count says how wide it went.

   RAISED FROM 5 TO 24 on 2026-09-04, because at 5 the cap became the blackout
   it was written to prevent. The heavy lane has been red since 2026-08-30 with
   SIX failing checks, and the public summary has reported the same line on
   every one of those runs:

       behav_wired:chip+kbProj+titleTooltip+ringClearOnNav+pcardNameTooltip+1more

   The sixth name is not in the ledger, not in the run history, and not
   recoverable afterwards -- the detail it came from is live-derived and stays
   on the ephemeral runner by design. So the one check nobody could name is the
   one check nobody has looked at, five days running (OPEN_REPAIRS 125).

   Nothing about the cap was protecting anything. The names are matched against
   BEHAV_WIRED_CHECKS, harvested from behav-wired.js's own source in this public
   repository, and the emitted string is assembled from allowlist entries -- so
   a longer list carries exactly as much live text as a short one, which is
   none. The cap is a readability limit and nothing more, and it was set below
   the size of a real failure. 24 names a realistic partial breakage in full
   while still collapsing a catastrophic one into a count. */
const BEHAV_WIRED_NAME_CAP = 24;

function behavWiredFailedChecks(text) {
  const line = (String(text || '').match(/BEHAV_WIRED_FAILED_CHECKS([^\n]*)/) || [])[1];
  if (!line) return '';
  const named = line.trim().split(/\s+/).filter(name => BEHAV_WIRED_CHECKS.has(name));
  if (!named.length) return '';
  const shown = named.slice(0, BEHAV_WIRED_NAME_CAP).join('+');
  return 'behav_wired:' + shown + (named.length > BEHAV_WIRED_NAME_CAP
    ? '+' + (named.length - BEHAV_WIRED_NAME_CAP) + 'more' : '');
}

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

/* The read-only smoke suite's stage names, harvested from its OWN SOURCE for
   exactly the reason BEHAV_WIRED_CHECKS is: a name this file did not find in
   that file is dropped, so the emitted code is assembled from allowlist entries
   and never from the run's output.

   This exists because `Production read-only smoke [timeout_unspecified]` is a
   true statement that helps nobody. A generic Playwright timeout tells you the
   suite stopped; the last stage it announced tells you WHERE, which is the
   difference between reading fourteen assertions hoping to recognise one and
   opening the right one. */
const SMOKE_STAGES = (() => {
  try {
    const src = require('fs').readFileSync(
      path.join(root, 'docs', 'syncview-design', 'tests', 'prod-readonly-smoke.js'), 'utf8');
    const names = new Set();
    const re = /\bstage\('([a-z0-9_]+)'\)/g;
    let match;
    while ((match = re.exec(src))) names.add(match[1]);
    return names;
  } catch (_) { return new Set(); }
})();

/* The LAST stage announced, which is the one that did not finish. Returns ''
   when the suite printed no marker at all, so a suite that has none -- or one
   whose markers were renamed out of the allowlist -- degrades to exactly the
   old behaviour rather than to a wrong answer. */
function smokeFailedStage(text) {
  const seen = String(text || '').match(/SMOKE_STAGE ([a-z0-9_]+)/g) || [];
  for (let i = seen.length - 1; i >= 0; i--) {
    const name = seen[i].slice('SMOKE_STAGE '.length);
    if (SMOKE_STAGES.has(name)) return name;
  }
  return '';
}

/* The one place the three classifiers are combined, so the caller's reason line
 * stays a single call and the "never assigned from raw output" rule is readable
 * without tracing an expression.
 *
 * Order is deliberate. A named check beats a generic code and only ever fires
 * when the suite reached its own summary -- a crash exits before printing the
 * marker and still classifies through the table. Failing that, a suite that
 * announces its stages gets the code QUALIFIED by the last stage it reached:
 * the code says WHAT broke, the stage says WHERE, and neither is quoted from
 * output -- both sides are assembled from allowlists read out of the suites'
 * own sources. A suite that announces no stages is unchanged.
 */
function failureReason(text) {
  const named = behavWiredFailedChecks(text);
  if (named) return named;
  const code = classifyFailure(text);
  const where = smokeFailedStage(text);
  return where ? code + '@' + where : code;
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
    /* One classifier, so the invariant stays checkable at a glance: `combined`
       appears here exactly once and only as an argument. */
    reason: run.status === 0 ? '' : failureReason(combined),
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
