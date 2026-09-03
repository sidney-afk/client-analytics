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
 *   node scripts/deno-typecheck-ratchet.js --update --stamp=YYYY-MM-DD   rewrite it
 *   node scripts/deno-typecheck-ratchet.js --report=<file> --target=<slug> --status=<n>
 *   node scripts/deno-typecheck-ratchet.js --target=<slug>  just one function
 *   node scripts/deno-typecheck-ratchet.js --deno=<path>   non-PATH deno binary
 *   node scripts/deno-typecheck-ratchet.js --require-deno  absent deno FAILS (CI)
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

/* Every hand-deployed Edge Function with no type lane of its own. Item 94
   names only `production-write`; the argument it makes — safety-critical,
   hand-deployed, nothing in CI looks — is true of all of these, and measuring
   them cost one command each.

   THREE OF THEM ARE CLEAN, which is why the list is not just the one function.
   `deliverable-write`, `batch-write` and `workload-plan` have zero errors, so
   their baseline is empty and the ratchet is a real GATE on them: the first
   type error to appear fails. Only `production-write` (15), `linear-outbound`
   (12) and `linear-inbound` (12) carry recorded debt.

   `pto` is deliberately absent: it has a real gate in `pto-ui-tests.yml` and
   passes, so a ratchet there would be a weaker check replacing a stronger one. */
const TARGETS = [
    'production-write',
    'linear-outbound',
    'linear-inbound',
    'deliverable-write',
    'batch-write',
    'workload-plan',
];

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
        sawCheckLine: /Check file:/.test(plain),
        sawErrorLine: /\[ERROR\]/.test(plain),
    };
}

/* A report is only usable if it is a COMPLETE one. Codex P2 on #1256: a check
   killed after printing its diagnostics but before `Found N errors.` leaves
   `declared` null, and per-code counts that happen to match the baseline then
   printed a confident green over a truncated run. "We could not read the
   report" and "nothing got worse" are different facts and must not share a
   verdict.
   `status` is deno's exit code where it is known (null when a saved report is
   being replayed): a clean check exits 0, an erroring one does not, and the two
   disagreeing with the text is itself evidence the report is not what it looks
   like. */
function completeness(observed) {
    const o = observed || {};
    const known = typeof o.status === 'number';

    /* MEASURED 2026-09-03: a clean `deno check` on a warm cache prints NOTHING
       AT ALL and exits 0 — no "Check file:" line, no tally, no output. So the
       text cannot distinguish a clean run from a run that died before it wrote
       anything. The EXIT STATUS can, and it is the signal this leans on. */
    if (!known) {
        if (o.total > 0 && o.declared !== o.total) {
            return 'diagnostics were printed but the terminal "Found N errors." tally is absent or disagrees'
                + ' — the run was cut short or the output format moved, so the counts below are a fragment';
        }
        if (o.total === 0 && !o.sawCheckLine) {
            return 'the report shows no errors and no "Check file:" line, and no exit status was supplied,'
                + ' so a clean run cannot be told apart from an empty one';
        }
        if (o.total === 0 && o.sawErrorLine) {
            return 'the output contains an error line the parser did not classify,'
                + ' so a clean verdict cannot be trusted';
        }
        return '';
    }

    if (o.status === 0) {
        if (o.total > 0 || o.sawErrorLine) {
            return 'deno exited 0 while its output reports errors — text and exit status disagree';
        }
        return '';
    }
    // Non-zero exit: an erroring check must have printed a complete diagnosis.
    if (o.declared === null) {
        return 'deno exited ' + o.status + ' but printed no "Found N errors." tally —'
            + ' the run was cut short or the output format moved, so the counts below are a fragment';
    }
    if (o.declared !== o.total) {
        return 'deno reported ' + o.declared + ' errors but this parser matched ' + o.total
            + ' — the output format moved and every comparison below is unreliable';
    }
    if (o.total === 0) {
        return 'deno exited ' + o.status + ' while reporting no errors — text and exit status disagree';
    }
    return '';
}

/* The dependency graph a function is CHECKED against must be the one it is
   DEPLOYED against. `linear-inbound` carries a frozen per-function
   `deno.json`/`deno.lock`, and its deploy lane proves the source with
   `deno cache --frozen --config supabase/functions/linear-inbound/deno.json`
   (deploy-f27-linear-inbound.yml). Checking it with `--no-lock` instead
   resolves transitive dependencies from the repository root, so drift there
   could introduce or hide a diagnostic relative to the graph that is actually
   approved for deployment — Codex P2 on #1256. So: a target with its own
   config is checked under it; every other target keeps `--no-lock`, because a
   bare `deno check` writes a root `deno.lock` as a side effect and a checker
   must not leave anything behind. */
function denoArgsFor(target) {
    const rel = path.join('supabase', 'functions', target, 'index.ts');
    const cfg = path.join('supabase', 'functions', target, 'deno.json');
    if (fs.existsSync(path.join(ROOT, cfg))) {
        return { args: ['check', '--config', cfg, '--node-modules-dir=auto', rel], config: cfg };
    }
    return { args: ['check', '--no-lock', '--node-modules-dir=auto', rel], config: null };
}

function runDeno(target, denoBin) {
    const plan = denoArgsFor(target);
    const r = spawnSync(denoBin, plan.args, {
        cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    });
    if (r.error && r.error.code === 'ENOENT') {
        return { missing: true, text: '', status: null, config: plan.config };
    }
    return {
        missing: false,
        text: String(r.stdout || '') + String(r.stderr || ''),
        status: typeof r.status === 'number' ? r.status : null,
        config: plan.config,
    };
}

function compare(target, observed, baselineEntry) {
    const failures = [];
    const notes = [];
    const base = (baselineEntry && baselineEntry.counts) || {};
    /* An unusable report ends the comparison. Reporting BOTH "the report is a
       fragment" and "TS18047 is holding at 14" would be reporting a number read
       off a page that was torn. */
    const incomplete = completeness(observed);
    if (incomplete) return { failures: [target + ': ' + incomplete], notes: [], increases: [] };
    const increases = [];
    const codes = new Set(Object.keys(base).concat(Object.keys(observed.counts)));
    for (const code of Array.from(codes).sort()) {
        const was = base[code] || 0;
        const now = observed.counts[code] || 0;
        if (now > was) {
            increases.push(code + ' ' + was + ' → ' + now);
            failures.push(target + ': ' + code + ' went ' + was + ' → ' + now
                + (was === 0 ? ' — a KIND of type error this file did not have before' : ''));
        } else if (now < was) {
            failures.push(target + ': ' + code + ' went ' + was + ' → ' + now
                + ' — that is good news, and the baseline has to come down with it.'
                + ' Re-run with --update --stamp=YYYY-MM-DD and commit docs/ops/DENO_TYPECHECK_BASELINE.json.');
        } else if (now > 0) {
            notes.push(target + ': ' + code + ' holding at ' + now);
        }
    }
    return { failures, notes, increases };
}

function main() {
    const denoBin = argOf('--deno') || 'deno';
    const requireDeno = process.argv.indexOf('--require-deno') >= 0;
    const reportFile = argOf('--report');
    const update = process.argv.indexOf('--update') >= 0;
    const targetArg = argOf('--target');

    /* A REPLAYED REPORT BELONGS TO ONE FUNCTION. Codex P2 on #1256: without
       this, --report=<file> was re-read once per target, so a report captured
       from `production-write` was compared against all six baselines — and
       `--report … --update` would have rewritten every target with that one
       function's counts, destroying the per-function measurements it exists to
       hold. There is no shape of output that carries six functions, so the
       honest fix is to require the caller to say which one. */
    /* A CLEAN report has no terminal marker — a clean `deno check` on a warm
       cache prints nothing at all — so a saved file holding only the initial
       `Check file:` line is indistinguishable from a run killed a moment later.
       Replaying one therefore needs the exit status supplied; without it, a
       clean-baseline target would report green off a truncated file and
       `--update` could zero a dirty target's baseline. Codex P2 on #1256. */
    if (reportFile && argOf('--status') === null) {
        console.log('--report=<file> also needs --status=<exit code>: a clean deno check prints nothing,');
        console.log('so a saved report cannot be told apart from a run that died before writing.');
        process.exit(1);
    }
    if (reportFile && !targetArg) {
        console.log('--report=<file> also needs --target=<slug>: a saved report is the output of ONE');
        console.log('deno check, and replaying it against every baseline would compare a function');
        console.log('against measurements that are not its own.');
        process.exit(1);
    }
    if (targetArg && TARGETS.indexOf(targetArg) < 0) {
        console.log('--target=' + targetArg + ' is not covered by this ratchet. Covered: ' + TARGETS.join(', '));
        process.exit(1);
    }
    const targets = targetArg ? [targetArg] : TARGETS;

    let baseline = { schema: 'syncview_deno_typecheck_baseline_v1', targets: {} };
    if (fs.existsSync(BASELINE)) baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));

    const failures = [];
    const notes = [];
    const measured = {};

    for (const target of targets) {
        const statusArg = argOf('--status');
        const run = reportFile
            ? { missing: false, text: fs.readFileSync(reportFile, 'utf8'),
                status: statusArg === null ? null : Number(statusArg) }
            : runDeno(target, denoBin);
        if (run.missing) {
            /* A contributor without deno gets a skip; CI must not. Found by
               re-reading this file for the class of defect the review kept
               finding elsewhere in it: exit 0 here means the lane can install
               nothing, check nothing, and report a green — which is worse than
               having no lane, because it looks like one. The workflow passes
               --require-deno, and the suite asserts that it still does. */
            if (requireDeno) {
                console.log('deno is not on PATH and --require-deno was given, so nothing was checked.');
                console.log('A lane that checks nothing must not report a pass. Install deno (v2.5.2,');
                console.log('the version pto-ui-tests.yml pins) or pass --deno=<path>.');
                process.exit(1);
            }
            console.log('deno is not installed — nothing was checked, and that is a SKIP, not a pass.');
            console.log('Install it (the lane pins v2.5.2) or pass --deno=<path>.');
            process.exit(0);
        }
        const observed = parseReport(run.text);
        observed.status = run.status;
        measured[target] = { counts: observed.counts, total: observed.total };
        measured[target].incomplete = completeness(observed);
        const cmp = compare(target, observed, baseline.targets && baseline.targets[target]);
        measured[target].increases = cmp.increases || [];
        failures.push(...cmp.failures);
        notes.push(...cmp.notes);
    }

    if (update) {
        /* A baseline that records WHEN it was measured and then quietly keeps an
           old date is the failure this repository has an entry about (item 118),
           so an update has to restamp. Passed in rather than read from the clock
           so the value in the file is the one the author meant. */
        if (!argOf('--stamp')) {
            console.log('--update also needs --stamp=YYYY-MM-DD: the baseline records when it was');
            console.log('measured, and an update that keeps the old date makes the file lie about itself.');
            process.exit(1);
        }
        /* Refuse to write a baseline read off an unusable report. */
        for (const target of targets) {
            const why = measured[target].incomplete;
            if (why) {
                console.log('refusing to update ' + target + ': ' + why);
                process.exit(1);
            }
        }
        /* AN UPDATE MAY ONLY LOWER. Codex P2 on #1256: a fix landing alongside a
           NEW diagnostic produces both a decrease and an increase, and the
           decrease's own message tells the contributor to rerun with --update —
           which would then bless the new error and hand the next CI run a green.
           The instruction must not be a way round the gate. */
        for (const target of targets) {
            const up = measured[target].increases || [];
            if (up.length) {
                console.log('refusing to update ' + target + ': ' + up.join(', '));
                console.log('An update may only LOWER a baseline. Something went UP in the same run, and');
                console.log('writing it in would bless a new type error. Fix the increase first; the');
                console.log('decrease will still be there to record afterwards.');
                process.exit(1);
            }
        }
        baseline.targets = Object.assign({}, baseline.targets);
        for (const target of targets) baseline.targets[target] = measured[target];
        baseline.measured_on = argOf('--stamp');
        fs.writeFileSync(BASELINE, JSON.stringify(baseline, null, 2) + '\n');
        console.log('Baseline rewritten: ' + path.relative(ROOT, BASELINE));
        for (const target of targets) console.log('  ' + target + ': ' + JSON.stringify(measured[target].counts));
        process.exit(0);
    }

    console.log('deno check ratchet — new type errors fail, existing ones do not\n');
    for (const target of targets) {
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
module.exports = { parseReport, compare, completeness, denoArgsFor };
