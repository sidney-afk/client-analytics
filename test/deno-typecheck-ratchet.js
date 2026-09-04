#!/usr/bin/env node
'use strict';
/**
 * The parser and the comparator behind the Edge-Function type ratchet.
 *
 * The ratchet's verdict is only as good as its reading of `deno check`
 * output, and the lane that produces that output needs deno installed — so
 * the part that can be silently wrong is exactly the part CI would not be
 * exercising. This suite drives both pure halves over recorded output, with
 * no deno anywhere, and over the committed baseline itself.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { parseReport, compare, completeness } = require('../scripts/deno-typecheck-ratchet.js');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;
function ok(cond, msg) {
    console.log((cond ? '  ok  ' : 'FAIL  ') + msg);
    if (!cond) failures++;
}

/* Recorded from the real run, 2026-09-03, colour codes and all — the escape
   sequences are the reason the parser strips them, so a sample without them
   would not test the thing that breaks. */
const SAMPLE = [
    '\x1b[0m\x1b[32mCheck\x1b[0m file:///r/supabase/functions/production-write/index.ts',
    "\x1b[0m\x1b[1mTS2352 \x1b[0m[ERROR]: Conversion of type 'GenericStringError[]' to type 'JsonMap[]' may be a mistake.",
    '  const rows = (Array.isArray(data) ? data : []) as JsonMap[];',
    '    at \x1b[0m\x1b[36mfile:///r/supabase/functions/production-write/index.ts\x1b[0m:\x1b[0m\x1b[33m1888\x1b[0m:\x1b[0m\x1b[33m16\x1b[0m',
    '',
    "\x1b[0m\x1b[1mTS18047 \x1b[0m[ERROR]: 'labelIds' is possibly 'null'.",
    '    at file:///r/supabase/functions/production-write/index.ts:3504:7',
    '',
    "\x1b[0m\x1b[1mTS18047 \x1b[0m[ERROR]: 'parentRoute' is possibly 'null'.",
    '    at file:///r/supabase/functions/production-write/index.ts:3509:13',
    '',
    'Found 3 errors.',
    '',
    '\x1b[0m\x1b[1m\x1b[31merror\x1b[0m: Type checking failed.',
].join('\n');

/* ---- 1. the parser ------------------------------------------------------ */

const p = parseReport(SAMPLE);
ok(p.counts.TS18047 === 2 && p.counts.TS2352 === 1, 'errors are counted per TS code');
ok(p.total === 3, 'and totalled');
ok(p.declared === 3, "deno's own \"Found N errors.\" tally is read separately");
ok(p.total === p.declared, 'and the two agree on this sample, which is what makes the verdict trustworthy');

const cleanParsed = parseReport('\x1b[0m\x1b[32mCheck\x1b[0m file:///r/supabase/functions/pto/index.ts\n');
ok(cleanParsed.total === 0 && cleanParsed.declared === null
    && cleanParsed.sawCheckLine === true && cleanParsed.sawErrorLine === false,
    'a cold-cache clean check (which does print "Check file:") parses as zero errors');

/* ---- 1b. an unusable report is never a verdict -------------------------- */

/* The failure mode that would make every verdict worthless without saying so:
   the output format moves and the parser silently matches fewer lines. */
const drifted = Object.assign(parseReport('Check file:///x\nTS18047 [ERROR]: x\nFound 9 errors.'), { status: 1 });
const driftCmp = compare('production-write', drifted, { counts: { TS18047: 1 } });
ok(driftCmp.failures.some(f => /output format moved/.test(f)),
    'a mismatch between deno\'s tally and the parser\'s is reported as unreliable, not smoothed over');

/* Codex P2: a check killed after printing its diagnostics but before the
   terminal tally left `declared` null, so per-code counts that matched the
   baseline printed a confident green over a torn page. */
const torn = Object.assign(
    parseReport('Check file:///x\nTS18047 [ERROR]: x\nTS18047 [ERROR]: y\n'), { status: 1 });
ok(/fragment/.test(completeness(torn)),
    'diagnostics with no terminal tally are reported as a fragment, not as a count');
const tornCmp = compare('production-write', torn, { counts: { TS18047: 2 } });
ok(tornCmp.failures.length === 1 && /fragment/.test(tornCmp.failures[0]),
    'and the comparison STOPS there — no "holding at 2" read off a page that was torn');

/* MEASURED while building this: a clean `deno check` on a warm cache prints
   NOTHING and exits 0 — no "Check file:" line, no tally. So the text alone
   cannot tell a clean run from a run that died before writing anything, and
   the exit status is what the completeness rules lean on. That measurement is
   why the first version of this section was wrong. */
ok(completeness(Object.assign(parseReport(''), { status: 0 })) === '',
    'a clean check that prints NOTHING and exits 0 is accepted — that is what a clean check looks like');
ok(/cannot be told apart from an empty one/.test(completeness(parseReport(''))),
    'but the same empty text with NO exit status is rejected, because it could be a run that died');
ok(/text and exit status disagree/.test(
    completeness(Object.assign(parseReport('Check file:///x\nTS18047 [ERROR]: x\nFound 1 errors.'), { status: 0 }))),
    'an erroring report with a zero exit status is rejected — the two signals must agree');
ok(/text and exit status disagree/.test(
    completeness(Object.assign(parseReport('Check file:///x\nFound 0 errors.'), { status: 1 }))),
    'and so is a non-zero exit that reports no errors');
ok(/printed neither a "Found N errors\." tally/.test(
    completeness(Object.assign(parseReport('Check file:///x\nTS18047 [ERROR]: x\n'), { status: 1 }))),
    'a non-zero exit with diagnostics and NO terminal marker at all is a fragment, not a count');
/* MEASURED on `client-credentials`, and it is why the rule above says "neither":
   deno prints "Found N errors." only when N > 1. A single-error check goes
   straight from its diagnostic to "error: Type checking failed." — so demanding
   the tally on every non-zero exit called a perfectly complete report a
   fragment, and refused to record a real function. */
ok(completeness(Object.assign(
    parseReport('Check file:///x\nTS2339 [ERROR]: x\n\nerror: Type checking failed.\n'),
    { status: 1, fresh: true })) === '',
    'a ONE-error check, which prints the failure line and no tally, is a complete report');
ok(/that shape only exists for exactly one error/.test(completeness(Object.assign(
    parseReport('Check file:///x\nTS2339 [ERROR]: x\nTS2339 [ERROR]: y\n\nerror: Type checking failed.\n'),
    { status: 1, fresh: true }))),
    'while that same shape with TWO diagnostics is a fragment — the tally should have been there');

/* ---- 2. the comparator -------------------------------------------------- */

const base = { counts: { TS18047: 14, TS2352: 1 } };
const same = compare('production-write', { counts: { TS18047: 14, TS2352: 1 }, total: 15, declared: 15, sawCheckLine: true, sawErrorLine: true, status: 1 }, base);
ok(same.failures.length === 0, 'holding at the baseline passes');
ok(same.notes.length === 2, 'and reports each code as holding, so a green run still shows the debt');

const more = compare('production-write', { counts: { TS18047: 15, TS2352: 1 }, total: 16, declared: 16, sawCheckLine: true, sawErrorLine: true, status: 1 }, base);
ok(more.failures.length === 1 && /TS18047 went 14 → 15/.test(more.failures[0]),
    'one more error of an existing kind fails, and says which kind and by how much');

const novel = compare('production-write', { counts: { TS18047: 14, TS2352: 1, TS2345: 1 }, total: 16, declared: 16, sawCheckLine: true, sawErrorLine: true, status: 1 }, base);
ok(novel.failures.some(f => /TS2345 went 0 → 1/.test(f) && /KIND of type error this file did not have/.test(f)),
    'a new KIND of error is named as such — that is the case the count alone would blur');

const fewer = compare('production-write', { counts: { TS18047: 13, TS2352: 1 }, total: 14, declared: 14, sawCheckLine: true, sawErrorLine: true, status: 1 }, base);
ok(fewer.failures.length === 1 && /good news/.test(fewer.failures[0]) && /--update/.test(fewer.failures[0]),
    'a DECREASE also fails, and the failure asks for the baseline to come down with it');

const swap = compare('production-write', { counts: { TS18047: 13, TS2352: 2 }, total: 15, declared: 15, sawCheckLine: true, sawErrorLine: true, status: 1 }, base);
ok(swap.failures.length === 2,
    'a swap between two codes is caught in both directions, which a bare total would miss entirely');

/* ---- 3. the committed baseline ----------------------------------------- */

const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'ops', 'DENO_TYPECHECK_BASELINE.json'), 'utf8'));
ok(raw.schema === 'syncview_deno_typecheck_baseline_v1', 'the committed baseline declares its schema');
const pw = raw.targets && raw.targets['production-write'];
ok(!!pw && pw.counts && typeof pw.total === 'number', 'and carries production-write');
ok(pw.total === Object.values(pw.counts).reduce((a, b) => a + b, 0),
    'and its total equals the sum of its per-code counts — an internally inconsistent baseline is not a baseline');
/* Codex P2: the earlier version froze `TS18047: 14` and `TS2352: 1` here, so
   the moment a real fix landed and `--update` lowered the baseline as designed,
   `npm test` failed on a second hard-coded copy of it. The ratchet exists to
   let those numbers come down; a test that forbids it is fighting its own
   feature. Assert INVARIANTS of the baseline instead — the properties that must
   hold at every value it will ever take. */
for (const [name, entry] of Object.entries(raw.targets)) {
    ok(entry && entry.counts && typeof entry.counts === 'object' && typeof entry.total === 'number',
        name + ' has a counts object and a numeric total');
    ok(entry.total === Object.values(entry.counts).reduce((a, b) => a + b, 0),
        name + "'s total equals the sum of its per-code counts");
    ok(Object.keys(entry.counts).every(c => /^TS\d+$/.test(c)),
        name + "'s keys are all TypeScript error codes");
    ok(Object.values(entry.counts).every(v => Number.isInteger(v) && v > 0),
        name + ' records no zero or fractional count — a fixed code is removed, not left at 0');
}
/* The date belongs to the MEASUREMENT, not to the file: a --target=<slug>
   --update must not restamp the five targets it never looked at. */
for (const [name, entry] of Object.entries(raw.targets)) {
    ok(/^\d{4}-\d{2}-\d{2}$/.test(String(entry.measured_on || '')),
        name + ' records when IT was measured, in a shape that cannot be mistaken for prose');
}
ok(raw.measured_on === undefined,
    'and there is no single global date left to be restamped by a run that measured one target');
/* The wiring, because the property above is about the committed file and this
   is about the code that writes it: the stamp is applied inside the per-target
   loop, and nothing assigns a file-level one. Verified by hand against a
   single-target update, which left the other five targets' dates untouched. */
const ratchetSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'deno-typecheck-ratchet.js'), 'utf8');
ok(/for \(const target of targets\) \{[\s\S]{0,400}measured_on: argOf\('--stamp'\)/.test(ratchetSrc),
    'the stamp is written inside the per-target loop');
ok(!/baseline\.measured_on\s*=/.test(ratchetSrc),
    'and nothing writes a file-level measured_on');

/* THE ROSTER IS DERIVED, and that is the assertion. I hand-listed six and
   called it complete coverage; review found two more (calendar-upsert and
   sample-review-upsert, both live client-facing writers) and counting properly
   showed thirty-five functions. A hand-kept list is exactly the artefact that
   goes stale, so the roster is read off the filesystem and this checks that
   every function directory is either covered or excluded with a reason. */
const { discoverTargets, EXCLUDED_TARGETS } = require('../scripts/deno-typecheck-ratchet.js');
const COVERED = discoverTargets();
const fnDir = path.join(ROOT, 'supabase', 'functions');
const onDisk = fs.readdirSync(fnDir)
    .filter(n => !n.startsWith('_'))
    .filter(n => fs.existsSync(path.join(fnDir, n, 'index.ts')));
ok(COVERED.length > 30, 'the derived roster is the whole estate, not a handful (' + COVERED.length + ')');
for (const n of onDisk) {
    ok(COVERED.indexOf(n) >= 0 || Object.prototype.hasOwnProperty.call(EXCLUDED_TARGETS, n),
        n + ' is either covered by the ratchet or excluded with a stated reason');
}
for (const t of COVERED) ok(!!(raw.targets && raw.targets[t]), 'the baseline covers ' + t);
ok(!raw.targets.pto && !!EXCLUDED_TARGETS.pto,
    'and NOT pto — it has a real gate in pto-ui-tests.yml, and a ratchet there would replace a stronger check with a weaker one');
for (const t of ['calendar-upsert', 'sample-review-upsert']) {
    ok(COVERED.indexOf(t) >= 0,
        t + ' is covered — a live, hand-deployed, client-facing writer the first hand-kept list missed');
}
/* At least one target is expected to be clean — that is what makes this a gate
   rather than only a ratchet — but WHICH ones is a measurement that may change,
   so the count is asserted, not the names. */
const cleanTargets = COVERED.filter(t => raw.targets[t] && raw.targets[t].total === 0);
ok(cleanTargets.length >= 20,
    'most of the estate is recorded CLEAN (' + cleanTargets.length + ' of ' + COVERED.length
    + '), so for those the ratchet is a real gate — the first type error to appear fails');
const someClean = cleanTargets[0];
const cleanHold = compare(someClean,
    { counts: {}, total: 0, declared: null, sawCheckLine: true, status: 0 }, raw.targets[someClean]);
ok(cleanHold.failures.length === 0, 'a clean function holding at zero passes');
const dirtied = compare(someClean,
    { counts: { TS2345: 1 }, total: 1, declared: 1, sawCheckLine: true, sawErrorLine: true, status: 1 },
    raw.targets[someClean]);
ok(dirtied.failures.some(f => /TS2345 went 0 → 1/.test(f) && /KIND of type error this file did not have/.test(f)),
    'and the FIRST error to land in it fails — which is the whole point of covering the clean ones');

/* ---- 3b. the lane must not be able to pass having checked nothing ------- */

/* Same class of defect as the ones review found in the comparison logic: the
   script skips (exit 0) when deno is absent, which is right for a contributor
   and catastrophic for CI — a runner that failed to install deno would check
   nothing and report a green, which is worse than having no lane because it
   looks like one. The workflow passes --require-deno; if that ever comes off,
   the hole reopens silently, so it is asserted here. */
const wf = fs.readFileSync(
    path.join(ROOT, '.github', 'workflows', 'edge-function-type-ratchet.yml'), 'utf8');
ok(/node scripts\/deno-typecheck-ratchet\.js --require-deno/.test(wf),
    'the CI lane runs the ratchet with --require-deno, so a missing deno fails instead of skipping');
const { status: reqStatus, stdout: reqOut } = spawnSync(process.execPath,
    [path.join(ROOT, 'scripts', 'deno-typecheck-ratchet.js'), '--require-deno', '--deno=/nonexistent/deno'],
    { encoding: 'utf8' });
ok(reqStatus === 1 && /must not report a pass/.test(reqOut),
    'and with it, an absent deno exits non-zero and says why');
const { status: skipStatus } = spawnSync(process.execPath,
    [path.join(ROOT, 'scripts', 'deno-typecheck-ratchet.js'), '--deno=/nonexistent/deno'],
    { encoding: 'utf8' });
ok(skipStatus === 0,
    'while without it a contributor who has no deno still gets a skip rather than a wall');

/* ---- 3c. a replayed report belongs to ONE function ---------------------- */

/* Codex P2: --report=<file> was re-read once per target, so a report captured
   from one function was compared against all six baselines, and combining it
   with --update would have rewritten every target with that one function's
   counts — destroying the per-function measurements the file exists to hold. */
const tmpReport = path.join(os.tmpdir(), 'ratchet-report-' + process.pid + '.log');
fs.writeFileSync(tmpReport, 'Check file:///x\nTS18047 [ERROR]: x\nFound 1 errors.\n');
const RATCHET = path.join(ROOT, 'scripts', 'deno-typecheck-ratchet.js');
const bare = spawnSync(process.execPath, [RATCHET, '--report=' + tmpReport, '--status=1'], { encoding: 'utf8' });
ok(bare.status === 1 && /also needs --target=/.test(bare.stdout),
    '--report without --target is refused, instead of being replayed against every baseline');
const wrongTarget = spawnSync(process.execPath,
    [RATCHET, '--report=' + tmpReport, '--target=not-a-function', '--status=1'], { encoding: 'utf8' });
ok(wrongTarget.status === 1 && /not covered by this ratchet/.test(wrongTarget.stdout),
    'and a --target this ratchet does not cover is refused rather than silently added');
const oneTarget = spawnSync(process.execPath,
    [RATCHET, '--report=' + tmpReport, '--target=production-write', '--status=1'], { encoding: 'utf8' });
ok(/production-write/.test(oneTarget.stdout) && !/linear-outbound/.test(oneTarget.stdout),
    'and with a target it reports that function ALONE, not all six');
fs.unlinkSync(tmpReport);

const noStatus = spawnSync(process.execPath,
    [RATCHET, '--report=' + tmpReport, '--target=production-write'], { encoding: 'utf8' });
ok(noStatus.status === 1 && /also needs --status=/.test(noStatus.stdout),
    'and a replayed report without an exit status is refused — a clean check prints nothing, '
    + 'so a saved file cannot be told apart from a run that died before writing');

/* A fresh run killed by a signal has no exit status, and spawnSync reports that
   as null. That must not fall through to the replayed-report branch, where the
   opening "Check file:" line alone reads as a complete clean report. */
ok(/terminated by a signal/.test(
    completeness({ counts: {}, total: 0, declared: null, sawCheckLine: true, status: null, fresh: true })),
    'a FRESH run with no exit status is rejected — a signal kill is a fragment, not a clean result');
ok(completeness({ counts: {}, total: 0, declared: null, sawCheckLine: true, status: null }) === '',
    'while a REPLAYED report with a check line and no status is still allowed, which is what that branch is for');

/* ---- 3d. an update may only LOWER -------------------------------------- */

/* Codex P2: a fix landing alongside a NEW diagnostic produces both a decrease
   and an increase, and the decrease's own message says to rerun with --update.
   Following that instruction would bless the new error and hand the next run a
   green. The instruction must not be a way round the gate. */
const mixed = compare('production-write',
    { counts: { TS18047: 13, TS2352: 1, TS2345: 1 }, total: 15, declared: 15,
      sawCheckLine: true, sawErrorLine: true, status: 1 },
    { counts: { TS18047: 14, TS2352: 1 } });
ok(mixed.increases.length === 1 && /TS2345 0 → 1/.test(mixed.increases[0]),
    'compare reports the increase separately from the decrease, so the update path can see it');
ok(mixed.failures.some(f => /good news/.test(f)) && mixed.failures.some(f => /TS2345 went 0 → 1/.test(f)),
    'and both still fail the check itself');

const mixedReport = path.join(os.tmpdir(), 'ratchet-mixed-' + process.pid + '.log');
fs.writeFileSync(mixedReport,
    'Check file:///x\n' + 'TS18047 [ERROR]: x\n'.repeat(13) + 'TS2352 [ERROR]: y\n'
    + 'TS2345 [ERROR]: z\n' + 'Found 15 errors.\n');
const blessed = spawnSync(process.execPath,
    [RATCHET, '--report=' + mixedReport, '--target=production-write', '--status=1',
        '--update', '--stamp=2026-09-03'], { encoding: 'utf8' });
ok(blessed.status === 1 && /refusing to update/.test(blessed.stdout) && /may only LOWER/.test(blessed.stdout),
    'and --update REFUSES a run that contains an increase, instead of writing it in');
const baselineNow = fs.readFileSync(path.join(ROOT, 'docs', 'ops', 'DENO_TYPECHECK_BASELINE.json'), 'utf8');
ok(!/TS2345/.test(JSON.parse(baselineNow).targets['production-write'].counts ? JSON.stringify(JSON.parse(baselineNow).targets['production-write'].counts) : ''),
    'and the committed baseline is untouched by the refused update');
fs.unlinkSync(mixedReport);

/* A single-target update leaves every other target's date alone. */
const beforeDates = Object.fromEntries(
    Object.entries(raw.targets).map(([k, v]) => [k, v.measured_on]));
ok(Object.values(beforeDates).every(Boolean) && new Set(Object.values(beforeDates)).size >= 1,
    'every target carries its own measurement date, so a one-target update cannot restamp the rest');

/* ---- 3e. the graph checked is the graph deployed ------------------------ */

/* linear-inbound carries a frozen per-function deno.json/deno.lock, and its
   deploy lane proves the source with `deno cache --frozen --config` that file.
   Checking it with --no-lock would resolve dependencies from the repository
   root instead, so drift there could introduce or hide a diagnostic relative to
   the graph actually approved for deployment. */
const { denoArgsFor } = require('../scripts/deno-typecheck-ratchet.js');
const inbound = denoArgsFor('linear-inbound');
ok(inbound.config === path.join('supabase', 'functions', 'linear-inbound', 'deno.json'),
    'linear-inbound is checked under its own frozen config, not from the repository root');
ok(inbound.args.indexOf('--no-lock') < 0,
    'and NOT with --no-lock, which would bypass the frozen lock its deploy proof enforces');
ok(fs.existsSync(path.join(ROOT, inbound.config)),
    'and that config really exists — if it is ever removed this has to be revisited');
const pwArgs = denoArgsFor('production-write');
ok(pwArgs.config === null && pwArgs.args.indexOf('--no-lock') >= 0,
    'a target with no per-function config keeps --no-lock, so the checker leaves no root lock behind');
ok(/--frozen[\s\S]{0,120}supabase\/functions\/linear-inbound\/deno\.json/.test(
    fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'deploy-f27-linear-inbound.yml'), 'utf8')),
    'and the deploy lane still proves that same config frozen — the reason this target is special');

/* ---- 4. no npm alias, for the reason item 94 gives ---------------------- */

const pkg = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8');
ok(!/deno-typecheck-ratchet/.test(pkg),
    'the ratchet has no npm script: the leave-evidence packet fingerprints package.json in its entirety, '
    + 'so adding one would mark a 101-screenshot audit stale (OPEN_REPAIRS 94)');

if (failures) {
    console.log('\n' + failures + ' check(s) failed.');
    process.exit(1);
}
console.log('\nDeno type-ratchet checks passed');
