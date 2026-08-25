'use strict';
/*
 * A red gate that cannot say WHERE is a gate nobody owns.
 *
 * docs/syncview-design/tests/prod-polish-gate.js keeps full suite output on the
 * runner because it renders live customer text, so a failure reaches a reader as
 * a suite name plus one classification code. Its own header records the cost of
 * getting that wrong: it sat red from 2026-07-23 to at least 2026-08-10 because
 * "which suite" without "why" is not actionable.
 *
 * On 2026-08-25 the same blackout happened one level in. prod-write-gateway-
 * browser.js went red on PR #1143 and reported `error_generic` -- twice, on two
 * different commits -- while the suite passed twelve consecutive local runs on a
 * byte-identical tree, the pinned Playwright build, a two-core cpuset, and with
 * the CDN and Sheets dependencies served from disk so nothing off-box differed.
 * `error_generic` is not a rare tail for that suite: every one of its ~120
 * expect() calls throws a plain Error, so EVERY assertion it can fail classifies
 * that way, and no amount of local reproduction can name one.
 *
 * The fix is the one this repo already reached for twice -- the Slice 5 drill
 * codes and the suite-name allowlist: a CLOSED list of constants. This suite
 * pins the two halves of it and, more importantly, that they cannot drift apart.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GATE = path.join(ROOT, 'docs', 'syncview-design', 'tests', 'prod-polish-gate.js');
const SUITE = path.join(ROOT, 'docs', 'syncview-design', 'tests', 'prod-write-gateway-browser.js');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* Both files run something on load -- the gate spawns every suite, the suite
 * launches a browser -- so neither can be require()d. Slice out the real
 * declarations and EXECUTE them. This is not a source scan: the functions under
 * test are the shipped ones, byte for byte, and a rename breaks the slice
 * loudly rather than passing vacuously. */
function evaluateSlice(file, from, to, exportNames) {
  const src = fs.readFileSync(file, 'utf8');
  const start = src.indexOf(from);
  const end = src.indexOf(to, start);
  if (start < 0 || end < 0) throw new Error('could not slice ' + path.basename(file) + ' -- did a declaration get renamed?');
  const body = src.slice(start, end);
  const factory = new Function(body + '\nreturn {' + exportNames.join(',') + '};');
  return factory();
}

const gate = evaluateSlice(GATE, 'const FAILURE_SIGNATURES = [', 'const failures = [];',
  ['FAILURE_SIGNATURES', 'ERROR_NAMES', 'classifyFailure']);
const suite = evaluateSlice(SUITE, 'const PHASES = [', '(async () => {',
  ['PHASES', 'phase', 'marker', 'expect']);

ok(typeof gate.classifyFailure === 'function' && Array.isArray(suite.PHASES) && suite.PHASES.length > 0,
  'the real classifier and the real phase list both load (harness is not vacuous)');

/* 1. Every declared phase has a code. This is the assertion that matters: add a
 *    phase and forget the signature, and the marker falls through to
 *    error_generic -- the exact blackout this exists to end. */
for (const name of suite.PHASES) {
  const code = gate.classifyFailure('PWG_PHASE_' + name.toUpperCase() + ' some assertion text');
  ok(code === 'pwg_' + name, 'phase "' + name + '" classifies as pwg_' + name + ' (got ' + code + ')');
}

/* 2. And no code exists for a phase the suite does not declare, so the table
 *    cannot quietly accumulate names that can never be emitted. */
const declared = new Set(suite.PHASES.map(name => 'pwg_' + name));
const tabled = gate.FAILURE_SIGNATURES.map(([code]) => code).filter(code => code.startsWith('pwg_'));
ok(tabled.length === declared.size && tabled.every(code => declared.has(code)),
  'the gate table and the suite phase list name exactly the same set');

/* 3. A CAUSE still outranks a location. A selector timeout inside the submit
 *    phase is more useful reported as a timeout, so the phase entries sit after
 *    every technical signature -- not before them. */
ok(gate.classifyFailure('PWG_PHASE_SUBMIT waitForSelector: Timeout 5000ms exceeded') === 'selector_timeout',
  'a Playwright timeout inside a phase still classifies as the timeout, not the phase');
ok(gate.classifyFailure('PWG_PHASE_BOOT Browser errors: something') === 'page_error',
  'a page error inside a phase still classifies as the page error');
ok(gate.classifyFailure('PWG_PHASE_CREATE_CLOSURE net::ERR_CONNECTION_RESET') === 'page_error'
  || gate.classifyFailure('PWG_PHASE_CREATE_CLOSURE net::ERR_CONNECTION_RESET') === 'network_unreachable',
  'a transport failure inside a phase still classifies as transport');

/* 4. Nothing else regressed: an unmarked plain Error still falls back, and an
 *    unmarked unknown is still unclassified rather than mislabelled. */
ok(gate.classifyFailure('Error: some suite without phases failed') === 'error_generic',
  'an unmarked plain Error still classifies as error_generic');
ok(gate.classifyFailure('') === 'unclassified',
  'empty output is still unclassified');

/* 5. The marker itself. expect() must PREFIX it, so the assertion text the
 *    runner-private log keeps is unchanged and only the marker is new. */
suite.phase('submit');
let thrown = null;
try { suite.expect(false, 'the original assertion text'); } catch (error) { thrown = error; }
ok(thrown instanceof Error && thrown.message === 'PWG_PHASE_SUBMIT the original assertion text',
  'expect() prefixes the marker and leaves the assertion text intact');
ok(gate.classifyFailure(thrown.message) === 'pwg_submit',
  'and the thrown message classifies as its phase end to end');

let passedThrough = true;
try { suite.expect(true, 'must not throw'); } catch (_error) { passedThrough = false; }
ok(passedThrough, 'a satisfied expect() still throws nothing');

/* 6. An undeclared phase fails at author time. Silently accepting one would
 *    reintroduce error_generic through the back door. */
let rejected = false;
try { suite.phase('not_a_real_phase'); } catch (_error) { rejected = true; }
ok(rejected, 'phase() refuses a name that is not in the closed list');

/* 7. Public safety, which is the whole reason the output is hidden: the emitted
 *    code is assembled from the closed list, never from the input. Feed the
 *    classifier a live-looking client name and prove none of it survives. */
const leaky = gate.classifyFailure('PWG_PHASE_SUBMIT client "Some Real Client" row https://example.invalid/secret?token=abc');
ok(leaky === 'pwg_submit' && !/Some Real Client|token|example\.invalid/.test(leaky),
  'the code carries no fragment of the text it classified');

/* 8. THE DEFECT THAT MADE THE FIRST SPLIT USELESS.
 *
 * `quarantined_identity` was set TWICE: once for the quarantine block, and
 * again immediately after it for fifty lines of authority-restore and
 * status/due assertions that are not about quarantine at all. So carving the
 * quarantine block into five sub-phases changed nothing — a red still reported
 * `pwg_quarantined_identity`, and it was still ambiguous across two unrelated
 * regions holding seven more assertions between them.
 *
 * Check 2 above already proves the two halves of the mechanism name the same
 * set. It cannot see this, because the list was right and the CALLS were wrong.
 * A phase name is a LOCATION; reusing one makes the location plural, which is
 * the single property this whole apparatus exists to remove.
 */
const suiteSource = fs.readFileSync(SUITE, 'utf8');
const entered = [...suiteSource.matchAll(/(?<![\w.])phase\('([a-z_]+)'\)/g)].map(match => match[1]);
ok(entered.length > 0, 'the suite actually calls phase() (harness is not vacuous)');
const repeated = [...new Set(entered.filter((name, index) => entered.indexOf(name) !== index))];
ok(repeated.length === 0,
  'no phase name is entered twice — a reused name makes the reported location plural'
    + (repeated.length ? ' (' + repeated.join(', ') + ')' : ''));
/* PHASES[0] is the value `currentPhase` starts at, so the suite is inside it
   from the first line and never calls phase() to enter it. Every other name has
   to be reachable, or it is a code the gate can emit and the suite can never
   produce. */
const unentered = suite.PHASES.slice(1).filter(name => !entered.includes(name));
ok(unentered.length === 0,
  'every declared phase after the implicit first one is actually entered'
    + (unentered.length ? ' (' + unentered.join(', ') + ')' : ''));
/* Both checks above pass on a correct suite, which is also what they look like
   when the extraction silently matches nothing. Prove the logic bites. */
const synthetic = ["phase('submit')", "phase('submit')"].join('\n');
const syntheticEntered = [...synthetic.matchAll(/(?<![\w.])phase\('([a-z_]+)'\)/g)].map(m => m[1]);
ok(syntheticEntered.length === 2
  && syntheticEntered.filter((n, i) => syntheticEntered.indexOf(n) !== i).length === 1,
  'the reuse detector actually fires on a phase entered twice');

if (failures) { console.error('\nprod-polish failure-location checks FAILED: ' + failures); process.exit(1); }
console.log('\nprod-polish failure-location checks passed');
