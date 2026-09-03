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
ok(/printed no "Found N errors\." tally/.test(
    completeness(Object.assign(parseReport('Check file:///x\nTS18047 [ERROR]: x\n'), { status: 1 }))),
    'a non-zero exit with diagnostics but no tally is a fragment, not a count');

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
ok(/^\d{4}-\d{2}-\d{2}$/.test(String(raw.measured_on || '')),
    'the baseline says when it was measured, in a shape that cannot be mistaken for prose');

/* Every hand-deployed function with no type lane of its own is covered, and
   three of them are CLEAN — on those the ratchet is a real gate, so an empty
   baseline is load-bearing rather than a placeholder. Asserted by name because
   quietly dropping a function from the list is how a lane stops covering the
   thing it was built for, and nothing else would notice. */
const COVERED = ['production-write', 'linear-outbound', 'linear-inbound',
    'deliverable-write', 'batch-write', 'workload-plan'];
for (const t of COVERED) ok(!!(raw.targets && raw.targets[t]), 'the baseline covers ' + t);
ok(!raw.targets.pto,
    'and NOT pto — it has a real gate in pto-ui-tests.yml, and a ratchet there would replace a stronger check with a weaker one');
/* At least one target is expected to be clean — that is what makes this a gate
   rather than only a ratchet — but WHICH ones is a measurement that may change,
   so the count is asserted, not the names. */
const cleanTargets = COVERED.filter(t => raw.targets[t] && raw.targets[t].total === 0);
ok(cleanTargets.length >= 1,
    'at least one covered function is recorded CLEAN, so for it the first type error to appear fails');
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
const bare = spawnSync(process.execPath, [RATCHET, '--report=' + tmpReport], { encoding: 'utf8' });
ok(bare.status === 1 && /also needs --target=/.test(bare.stdout),
    '--report without --target is refused, instead of being replayed against every baseline');
const wrongTarget = spawnSync(process.execPath,
    [RATCHET, '--report=' + tmpReport, '--target=not-a-function'], { encoding: 'utf8' });
ok(wrongTarget.status === 1 && /not covered by this ratchet/.test(wrongTarget.stdout),
    'and a --target this ratchet does not cover is refused rather than silently added');
const oneTarget = spawnSync(process.execPath,
    [RATCHET, '--report=' + tmpReport, '--target=production-write', '--status=1'], { encoding: 'utf8' });
ok(/production-write/.test(oneTarget.stdout) && !/linear-outbound/.test(oneTarget.stdout),
    'and with a target it reports that function ALONE, not all six');
fs.unlinkSync(tmpReport);

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
