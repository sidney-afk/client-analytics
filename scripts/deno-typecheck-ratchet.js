#!/usr/bin/env node
'use strict';
/**
 * A RATCHET on `deno check`, for the Edge Functions that have no type lane.
 *
 * OPEN_REPAIRS 94: `production-write` does not typecheck and nothing in CI
 * looks. It is *"the estate's most safety-critical write path, it is
 * hand-deployed, and the only thing standing between a type error and
 * production is review."* `pto-ui-tests.yml` already runs `deno check` on
 * `supabase/functions/pto/index.ts`, so the pattern exists and this function
 * simply is not in it.
 *
 * WHY A RATCHET AND NOT A GATE. The errors are already there — 14 measured on
 * 2026-08-31, and item 94 establishes that all of them are TypeScript's
 * inference limits rather than missing guards (a `const` that a long
 * disjunction cannot narrow; a five-way `Promise.all` destructure that loses
 * its tuple shape). Turning that into a red gate would block every PR on a
 * repair that item 94 says explicitly should NOT be done unattended, because
 * *any* edit to this file changes the deployed bundle and creates a capture-
 * and-hand-deploy obligation. So this holds the line instead: new errors fail,
 * existing ones do not.
 *
 * IT ALREADY HAS EVIDENCE. Re-measured 2026-09-03: **15**, not 14 — a
 * `TS2352` cast at line 1888, outside the assignee/parent-route region item 94
 * describes and of a code that entry never saw. One type error was added to
 * this file in three days with nothing to catch it, which is the case for the
 * ratchet made by the file itself.
 *
 * KEYED BY ERROR CODE, NOT BY LINE. Line numbers move whenever anything above
 * them is edited, and a check that goes red on an unrelated edit is a check
 * people learn to ignore. Counting per code also catches the swap a bare total
 * would miss — one error fixed and a different KIND introduced. A swap WITHIN
 * one code still slips through; that is the stated limit of this design.
 *
 * A DECREASE ALSO FAILS, on purpose. This repository keeps finding documents
 * that were true when written (OPEN_REPAIRS 118), and a baseline nobody has to
 * update is one of those. Fixing an error should cost one line here, and the
 * failure that asks for it says so in those words.
 *
 * Usage:
 *   node scripts/deno-typecheck-ratchet.js                 run deno, compare
 *   node scripts/deno-typecheck-ratchet.js --update        rewrite the baseline
 *   node scripts/deno-typecheck-ratchet.js --report=<file> parse a saved log
 *   node scripts/deno-typecheck-ratchet.js --deno=<path>   non-PATH deno binary
 *
 * Deliberately NO `npm run` alias: the leave-evidence packet fingerprints
 * `package.json` in its entirety, so adding any script marks a 101-screenshot
 * audit stale (OPEN_REPAIRS 94, second half). Invoke it by path, exactly as
 * `scripts/component-fill-rehearsal.js` is.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BASELINE = path.join(ROOT, 'docs', 'ops', 'DENO_TYPECHECK_BASELINE.json');

/* The functions this ratchet covers. `pto` is deliberately absent: it has a
   real gate in pto-ui-tests.yml and passes, so a ratchet there would be a
   weaker check replacing a stronger one. */
const TARGETS = ['production-write'];

function argOf(flag) {
    const hit = process.argv.find(a => a.indexOf(flag + '=') === 0);
    return hit ? hit.slice(flag.length + 1) : null;
}

/* Parse `deno check` output into { CODE: count }. Kept pure and exported so the
   suite can drive it over recorded output without deno installed — the parser
   is the part that can be wrong in a way nobody notices. */
function parseReport(text) {
    const plain = String(text || '').replace(/\x1b\[[0-9;]*m/g, '');
    const counts = {};
    const re = /^(TS\d+)\s+\[ERROR\]/gm;
    let m;
    while ((m = re.exec(plain))) counts[m[1]] = (counts[m[1]] || 0) + 1;
    const found = plain.match(/^Found (\d+) errors?\.$/m);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return {
        counts,
        total,
        // "Found N errors." is deno's own tally. If it disagrees with the lines
        // we matched, the parser has drifted from the format and every verdict
        // below it is worthless — so that is reported, never smoothed over.
        declared: found ? Number(found[1]) : null,
        clean: /Check file:/.test(plain) && !found && !/\[ERROR\]/.test(plain),
    };
}

function runDeno(target, denoBin) {
    const rel = path.join('supabase', 'functions', target, 'index.ts');
    const r = spawnSync(denoBin, ['check', '--node-modules-dir=auto', rel], {
        cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    });
    if (r.error && r.error.code === 'ENOENT') {
        return { missing: true, text: '' };
    }
    return { missing: false, text: String(r.stdout || '') + String(r.stderr || '') };
}

function compare(target, observed, baselineEntry) {
    const failures = [];
    const notes = [];
    const base = (baselineEntry && baselineEntry.counts) || {};
    if (observed.declared !== null && observed.declared !== observed.total) {
        failures.push(target + ': deno reported ' + observed.declared + ' errors but this parser matched '
            + observed.total + ' — the output format moved and every comparison below is unreliable');
    }
    const codes = new Set(Object.keys(base).concat(Object.keys(observed.counts)));
    for (const code of Array.from(codes).sort()) {
        const was = base[code] || 0;
        const now = observed.counts[code] || 0;
        if (now > was) {
            failures.push(target + ': ' + code + ' went ' + was + ' → ' + now
                + (was === 0 ? ' — a KIND of type error this file did not have before' : ''));
        } else if (now < was) {
            failures.push(target + ': ' + code + ' went ' + was + ' → ' + now
                + ' — that is good news, and the baseline has to come down with it.'
                + ' Re-run with --update and commit docs/ops/DENO_TYPECHECK_BASELINE.json.');
        } else if (now > 0) {
            notes.push(target + ': ' + code + ' holding at ' + now);
        }
    }
    return { failures, notes };
}

function main() {
    const denoBin = argOf('--deno') || 'deno';
    const reportFile = argOf('--report');
    const update = process.argv.indexOf('--update') >= 0;

    let baseline = { schema: 'syncview_deno_typecheck_baseline_v1', targets: {} };
    if (fs.existsSync(BASELINE)) baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));

    const failures = [];
    const notes = [];
    const measured = {};

    for (const target of TARGETS) {
        const run = reportFile
            ? { missing: false, text: fs.readFileSync(reportFile, 'utf8') }
            : runDeno(target, denoBin);
        if (run.missing) {
            console.log('deno is not installed — nothing was checked, and that is a SKIP, not a pass.');
            console.log('Install it (the lane pins v2.5.2) or pass --deno=<path>.');
            process.exit(0);
        }
        const observed = parseReport(run.text);
        measured[target] = { counts: observed.counts, total: observed.total };
        const cmp = compare(target, observed, baseline.targets && baseline.targets[target]);
        failures.push(...cmp.failures);
        notes.push(...cmp.notes);
    }

    if (update) {
        baseline.targets = Object.assign({}, baseline.targets);
        for (const target of TARGETS) baseline.targets[target] = measured[target];
        baseline.measured_on = argOf('--stamp') || (baseline.measured_on || '');
        fs.writeFileSync(BASELINE, JSON.stringify(baseline, null, 2) + '\n');
        console.log('Baseline rewritten: ' + path.relative(ROOT, BASELINE));
        for (const target of TARGETS) console.log('  ' + target + ': ' + JSON.stringify(measured[target].counts));
        process.exit(0);
    }

    console.log('deno check ratchet — new type errors fail, existing ones do not\n');
    for (const target of TARGETS) {
        console.log('  ' + target + ': ' + measured[target].total + ' error(s) '
            + JSON.stringify(measured[target].counts));
    }
    console.log('');
    if (failures.length) {
        failures.forEach(f => console.log('  ✗ ' + f));
        console.log('\n  OPEN_REPAIRS 94: do not "fix" these alongside an unrelated change — any edit to');
        console.log('  this file changes the deployed bundle and creates a capture-and-deploy obligation.');
        process.exit(1);
    }
    notes.forEach(n => console.log('  · ' + n));
    console.log('\n  No new type errors ✅');
}

if (require.main === module) main();
module.exports = { parseReport, compare };
