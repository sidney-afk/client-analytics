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
const { parseReport, compare } = require('../scripts/deno-typecheck-ratchet.js');

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

const clean = parseReport('\x1b[0m\x1b[32mCheck\x1b[0m file:///r/supabase/functions/pto/index.ts\n');
ok(clean.total === 0 && clean.declared === null && clean.clean === true,
    'a clean check parses as zero errors, not as unreadable output');

/* The failure mode that would make every verdict worthless without saying so:
   the output format moves and the parser silently matches fewer lines. */
const drifted = parseReport("TS18047 [ERROR]: 'x' is possibly 'null'.\nFound 9 errors.");
const driftCmp = compare('production-write', drifted, { counts: { TS18047: 1 } });
ok(driftCmp.failures.some(f => /output format moved/.test(f)),
    'a mismatch between deno\'s tally and the parser\'s is reported as unreliable, not smoothed over');

/* ---- 2. the comparator -------------------------------------------------- */

const base = { counts: { TS18047: 14, TS2352: 1 } };
const same = compare('production-write', { counts: { TS18047: 14, TS2352: 1 }, total: 15, declared: 15 }, base);
ok(same.failures.length === 0, 'holding at the baseline passes');
ok(same.notes.length === 2, 'and reports each code as holding, so a green run still shows the debt');

const more = compare('production-write', { counts: { TS18047: 15, TS2352: 1 }, total: 16, declared: 16 }, base);
ok(more.failures.length === 1 && /TS18047 went 14 → 15/.test(more.failures[0]),
    'one more error of an existing kind fails, and says which kind and by how much');

const novel = compare('production-write', { counts: { TS18047: 14, TS2352: 1, TS2345: 1 }, total: 16, declared: 16 }, base);
ok(novel.failures.some(f => /TS2345 went 0 → 1/.test(f) && /KIND of type error this file did not have/.test(f)),
    'a new KIND of error is named as such — that is the case the count alone would blur');

const fewer = compare('production-write', { counts: { TS18047: 13, TS2352: 1 }, total: 14, declared: 14 }, base);
ok(fewer.failures.length === 1 && /good news/.test(fewer.failures[0]) && /--update/.test(fewer.failures[0]),
    'a DECREASE also fails, and the failure asks for the baseline to come down with it');

const swap = compare('production-write', { counts: { TS18047: 13, TS2352: 2 }, total: 15, declared: 15 }, base);
ok(swap.failures.length === 2,
    'a swap between two codes is caught in both directions, which a bare total would miss entirely');

/* ---- 3. the committed baseline ----------------------------------------- */

const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'ops', 'DENO_TYPECHECK_BASELINE.json'), 'utf8'));
ok(raw.schema === 'syncview_deno_typecheck_baseline_v1', 'the committed baseline declares its schema');
const pw = raw.targets && raw.targets['production-write'];
ok(!!pw && pw.counts && typeof pw.total === 'number', 'and carries production-write');
ok(pw.total === Object.values(pw.counts).reduce((a, b) => a + b, 0),
    'and its total equals the sum of its per-code counts — an internally inconsistent baseline is not a baseline');
ok(pw.counts.TS18047 === 14 && pw.counts.TS2352 === 1,
    'and matches what was measured on 2026-09-03: the 14 OPEN_REPAIRS 94 describes, plus one that arrived after it');

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
for (const t of ['deliverable-write', 'batch-write', 'workload-plan']) {
    ok(raw.targets[t].total === 0 && Object.keys(raw.targets[t].counts).length === 0,
        t + ' is recorded CLEAN, so the first type error to appear in it fails');
}
const cleanHold = compare('batch-write', { counts: {}, total: 0, declared: null }, raw.targets['batch-write']);
ok(cleanHold.failures.length === 0, 'a clean function holding at zero passes');
const dirtied = compare('batch-write', { counts: { TS2345: 1 }, total: 1, declared: 1 }, raw.targets['batch-write']);
ok(dirtied.failures.some(f => /TS2345 went 0 → 1/.test(f) && /KIND of type error this file did not have/.test(f)),
    'and the FIRST error to land in it fails — which is the whole point of listing the clean ones');

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
