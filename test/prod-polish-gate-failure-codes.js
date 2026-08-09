'use strict';
/*
 * The Production polish gate must say WHY it failed, in a fixed vocabulary
 * that cannot carry live customer text.
 *
 * WHAT THIS FIXES. The gate names WHICH suite failed and nothing more, because
 * full suite output is deliberately runner-private (it renders live
 * customer-visible text — F122). That was enough to leave the gate red from
 * 2026-08-03 through at least 2026-08-07 with nobody able to act on it: the
 * 2026-08-07 15:17 run reported four failing suites and not one word about the
 * cause, so "the gate is broken" and "the app is broken" stayed
 * indistinguishable and the gate went unowned. Naming a suite is not a
 * diagnosis.
 *
 * The line that must NOT move: the reason is always one code from the fixed
 * list. The classifier may never quote, echo, or interpolate the suite's own
 * output — that output is exactly the live-derived text the privacy rule
 * exists to contain. A code says "selector timed out"; a quotation could say
 * which client's row never rendered.
 */
const path = require('node:path');
const fs = require('node:fs');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

const ROOT = path.join(__dirname, '..');
const GATE = path.join(ROOT, 'docs', 'syncview-design', 'tests', 'prod-polish-gate.js');
const source = fs.readFileSync(GATE, 'utf8');
const workflow = fs.readFileSync(
  path.join(ROOT, '.github', 'workflows', 'production-polish-gate.yml'), 'utf8');

// --- 1. The classifier, exercised directly ---------------------------------
// Extract with its real source (plus the table it reads) rather than
// re-implementing it, so this test runs the shipped logic.
const tableStart = source.indexOf('const FAILURE_SIGNATURES');
const tableEnd = source.indexOf('];', tableStart) + 2;
const fnStart = source.indexOf('function classifyFailure');
const fnEnd = source.indexOf('\n}', fnStart) + 2;
ok(tableStart > -1 && fnStart > tableStart, 'FAILURE_SIGNATURES is defined ahead of classifyFailure');
// eslint-disable-next-line no-eval
const classifyFailure = eval(`(() => { ${source.slice(tableStart, tableEnd)}\n${source.slice(fnStart, fnEnd)}\nreturn classifyFailure; })()`);

const CASES = [
  ['a Playwright selector timeout is named, not quoted',
    'page.waitForSelector: Timeout 30000ms exceeded.', 'selector_timeout'],
  ['the shell-without-content failure keeps its own code (it is the common one)',
    'Error: Production preview shell loaded without content after retry.', 'shell_loaded_without_content'],
  ['a response timeout is distinct from a selector timeout',
    'page.waitForResponse: Timeout 30000ms exceeded while waiting for event "response"', 'response_timeout'],
  ['an unhandled rejection is recognised',
    'triggerUncaughtException(err, true /* fromPromise */);', 'unhandled_rejection'],
  ['a network-level page error is recognised',
    'Failed to load resource: net::ERR_CONNECTION_RESET', 'page_error'],
  ['a broken require is not misreported as a product failure',
    "Error: Cannot find module 'playwright'", 'module_or_syntax_error'],
  ['anything unrecognised degrades to a code, never to raw text',
    'something nobody has seen before', 'unclassified'],
];
for (const [message, input, expected] of CASES) {
  ok(classifyFailure(input) === expected, message);
}

// --- 2. Public safety: no live text can ride out on the reason -------------
// The whole point. A suite prints live client rows; the classifier sees that
// text and must still emit only a code.
const leaky = [
  'page.waitForSelector: Timeout 30000ms exceeded waiting for row "Acme Corp — Video 8" of client acme-corp',
  'Failed to load resource: net::ERR_CONNECTION_RESET https://uzltbbrjidmjwwfakwve.supabase.co/rest/v1/deliverables?client=acme-corp',
];
for (const text of leaky) {
  const code = classifyFailure(text);
  ok(!/acme|Acme|supabase|http|Video 8/.test(code),
    'the reason code carries no fragment of the suite output it was derived from');
  ok(/^[a-z_]+$/.test(code),
    'every reason code is a bare lowercase identifier — structurally incapable of carrying a slug or URL');
}
ok(classifyFailure('') === 'unclassified' && classifyFailure(null) === 'unclassified'
  && classifyFailure(undefined) === 'unclassified',
'empty, null and undefined all classify rather than throwing');

// --- 3. The summary line carries the code, and only for failures ----------
ok(/FAIL \$\{r\.seconds\}s \$\{r\.label\} \[\$\{r\.reason\}\]/.test(source),
  'a failing suite writes its reason code into the public summary');
ok(/PASS \$\{r\.seconds\}s \$\{r\.label\}`/.test(source),
  'a passing suite writes no reason, so the summary stays quiet on healthy runs');
ok(/reason: run\.status === 0 \? '' : classifyFailure\(combined\)/.test(source),
  'the reason is computed only from the classifier, never assigned from raw output');

// --- 4. The suite output still reaches the private log --------------------
// Capturing must not silently delete the detail an engineer needs on the
// runner; it is re-emitted verbatim and only the classification is new.
ok(/process\.stdout\.write\(combined\)/.test(source),
  'captured suite output is written straight back out, so the private runner log is unchanged');
ok(!/stdio: 'inherit'/.test(source),
  'the gate captures rather than inherits, which is what makes classification possible at all');
ok(/maxBuffer:/.test(source),
  'capture sets an explicit maxBuffer, so a chatty suite cannot truncate into a false classification');

// --- 5. The workflow renders the failed list correctly --------------------
/* `paste -sd ', '` treats ", " as a LIST of delimiters and cycles them, so
 * four failing suites rendered as "a,b c,d" — the 2026-08-07 run really did
 * print "Production comment thread Production write gateway" with no comma,
 * making four failures read as three. */
ok(!/paste -sd ', '/.test(workflow),
  'the cycling two-character delimiter is gone (it silently merged adjacent suite names)');
const pasteLines = workflow.match(/paste -sd[^\n]*/g) || [];
ok(pasteLines.length === 3 && pasteLines.every(line => /paste -sd ',' - \| sed 's\/,\/, \/g'/.test(line)),
  'all three lanes join the failed-suite list with a single delimiter and space it afterwards');

if (failures) {
  console.error(`\n${failures} prod-polish-gate failure-code check(s) failed`);
  process.exit(1);
}
console.log('\nProduction polish gate failure-code checks passed');
