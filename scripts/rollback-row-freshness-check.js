#!/usr/bin/env node
'use strict';
/**
 * ROLLBACK.md's live row against EXECUTION_LOG.md's newest deploy receipt.
 *
 * WHY THIS EXISTS (OPEN_REPAIRS 118, and the row's own middle column). The
 * F27 Section 4 lane emits its deployed-versions receipt into
 * EXECUTION_LOG.md automatically. The "what is live" row in ROLLBACK.md is
 * hand-maintained, so it decays silently after every dispatch — it has been
 * found stale twice on record, once ELEVEN deploys behind. Both the row and
 * docs/ops/F27_INSTALL_RUNBOOK.md already carry a written rule saying a deploy
 * is not finished until the row is updated. A written rule has now failed
 * twice, which is the argument for a derivable check rather than a third
 * reminder.
 *
 * The danger is specific and it does not announce itself: a stale row does not
 * fail loudly, it hands whoever is mid-incident a rollback bundle that reverts
 * one MORE release than they intended.
 *
 * What is compared, all of it derived from the two files and nothing else:
 *   1. the GitHub run id and the dispatched commit,
 *   2. every function's active version and source-closure hash,
 *   3. the one-step rollback bundle's claimed capture — it must be the version
 *      that was live BEFORE the newest deploy, i.e. the previous receipt's, or
 *      it is not one step back.
 *
 * Usage:  node scripts/rollback-row-freshness-check.js [--json]
 * Exit 0 agreement, 1 disagreement or nothing to compare.
 */
const fs = require('fs');
const path = require('path');

/* --root lets the suite point the same code at a fixture pair. Without it a
   test could only ever assert that today's two files agree, which is the one
   thing that says nothing about whether the check can SEE a stale row. */
const rootArg = process.argv.find(a => a.indexOf('--root=') === 0);
const ROOT = rootArg ? path.resolve(rootArg.slice('--root='.length)) : path.resolve(__dirname, '..');
const SLUGS = ['production-write', 'linear-outbound', 'deliverable-write', 'batch-write'];
const SCHEMA = 'syncview_f27_section4_deployed_versions_v1';

const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

/* ---- EXECUTION_LOG.md: every deploy receipt, oldest first ---------------- */

/* The receipt exists in two shapes and BOTH are load-bearing. The lane's own
   instruction is to copy the full JSON attestation block; entries have shipped
   with only the human-readable table (noted on #1215 and again in item 118),
   and refusing to read those would make this check blind exactly when the
   record is already thinner than it should be. So: read the JSON when it is
   there, fall back to the table, and SAY which one was used. */
function receiptsFromJson(log) {
    const out = [];
    const re = new RegExp('```json\\s*(\\{[\\s\\S]*?\\})\\s*```', 'g');
    let m;
    while ((m = re.exec(log))) {
        if (m[1].indexOf(SCHEMA) < 0) continue;
        let obj;
        try { obj = JSON.parse(m[1]); } catch (e) { continue; }
        if (!obj || obj.schema !== SCHEMA || !Array.isArray(obj.functions)) continue;
        const fns = {};
        for (const f of obj.functions) {
            if (!f || !f.slug) continue;
            fns[f.slug] = {
                version: String(f.active_version || '').trim(),
                closure: String(f.source_closure_sha256 || '').trim().toLowerCase(),
            };
        }
        out.push({
            at: m.index, source: 'attestation block',
            run: String(obj.github_run_id || '').trim(),
            commit: String(obj.deploy_commit || '').trim().toLowerCase(),
            fns,
        });
    }
    return out;
}

/* A four-function table. The version cell is "34", "**51**" or "65 → **66**";
   the deployed version is the LAST number in it, never the first — reading the
   first would report the version this deploy replaced as the one that is live,
   which is the precise error this whole check exists to catch. */
function receiptsFromTables(log) {
    const rowRe = /^\|\s*`([a-z-]+)`\s*\|([^|]*)\|\s*`([0-9a-f]{64})`\s*\|/gm;
    const rows = [];
    let m;
    while ((m = rowRe.exec(log))) {
        if (SLUGS.indexOf(m[1]) < 0) continue;
        const nums = String(m[2]).match(/\d+/g);
        if (!nums || !nums.length) continue;
        rows.push({ at: m.index, slug: m[1], version: nums[nums.length - 1], closure: m[3].toLowerCase() });
    }
    /* Contiguous rows are one table. A REPEATED slug starts a new one — that is
       what separates two deploys logged close together, and a byte-distance
       heuristic alone silently swallowed the newer table when it did. */
    const out = [];
    let cur = null;
    for (const r of rows) {
        if (cur && !cur.fns[r.slug] && r.at - cur.end < 2000) {
            cur.fns[r.slug] = { version: r.version, closure: r.closure };
            cur.end = r.at;
            continue;
        }
        if (cur) out.push(cur);
        cur = { at: r.at, end: r.at, source: 'summary table', fns: { [r.slug]: { version: r.version, closure: r.closure } } };
    }
    if (cur) out.push(cur);
    return out.filter(t => Object.keys(t.fns).length >= 3);
}

/* Run id and dispatched commit live in the entry's prose when the JSON block is
   absent. Look backwards from the table to the entry heading above it. */
function proseContext(log, at) {
    const start = log.lastIndexOf('\n## ', at);
    const chunk = log.slice(start < 0 ? 0 : start, at);
    const run = chunk.match(/[Rr]un\s+`(\d{6,})`/);
    const commit = chunk.match(/from\s+`([0-9a-f]{7,40})`/);
    return { run: run ? run[1] : '', commit: commit ? commit[1].toLowerCase() : '' };
}

function executionLogReceipts() {
    const log = read('EXECUTION_LOG.md');
    const all = receiptsFromJson(log).concat(receiptsFromTables(log));
    all.sort((a, b) => a.at - b.at);
    /* A JSON block sits inside the same entry as its own summary table. Fold
       those two into one receipt, keeping the block — but ONLY across the two
       different shapes. Folding table into table would erase a deploy whenever
       two entries sat close together, which is the newest deploy exactly when
       the log is busy. */
    const merged = [];
    for (const r of all) {
        const prev = merged[merged.length - 1];
        if (prev && prev.source !== r.source && Math.abs(r.at - prev.at) < 6000) {
            if (r.source === 'attestation block') merged[merged.length - 1] = r;
            continue;
        }
        merged.push(r);
    }
    for (const r of merged) {
        if (!r.run || !r.commit) {
            const p = proseContext(log, r.at);
            r.run = r.run || p.run;
            r.commit = r.commit || p.commit;
        }
    }
    return merged;
}

/* ---- ROLLBACK.md: the current live claim -------------------------------- */

function rollbackClaim() {
    const md = read('ROLLBACK.md');
    // The FIRST bold "Live as of" is the current claim; the superseded history
    // below it in the same cell is prose and must never be parsed as live.
    const i = md.indexOf('**Live as of');
    if (i < 0) return null;
    const cell = md.slice(i, i + 900);
    const run = cell.match(/run\s+`(\d{6,})`/);
    const commit = cell.match(/from\s+`([0-9a-f]{7,40})`/);
    const fns = {};
    const re = /`([a-z-]+)`\s*v(\d+)\s*\/\s*`([0-9a-f]{6,64})/g;
    let m;
    while ((m = re.exec(cell))) {
        if (SLUGS.indexOf(m[1]) < 0) continue;
        if (!fns[m[1]]) fns[m[1]] = { version: m[2], closure: m[3].toLowerCase() };
    }
    const bundle = md.slice(i, i + 3000)
        .match(/newest sealed[^.]*?`([0-9a-f]{6,64})[^`]*`\s*\/\s*(\d+)\s*bytes[\s\S]{0,120}?captures\s+`production-write`\s+at\s+v(\d+)/);
    return {
        run: run ? run[1] : '', commit: commit ? commit[1].toLowerCase() : '', fns,
        bundle: bundle ? { sha: bundle[1], bytes: bundle[2], captured: bundle[3] } : null,
    };
}

/* ---- compare ------------------------------------------------------------ */

function main() {
    const failures = [];
    const notes = [];
    const receipts = executionLogReceipts();
    const claim = rollbackClaim();
    const live = receipts[receipts.length - 1];
    const prior = receipts[receipts.length - 2];

    if (!live) failures.push('EXECUTION_LOG.md carries no deploy receipt this check can read.');
    if (!claim) failures.push('ROLLBACK.md carries no "**Live as of" claim this check can read.');

    if (live && claim) {
        if (live.source !== 'attestation block') {
            notes.push('the newest receipt is a ' + live.source + ', not the ' + SCHEMA
                + ' block the lane instructs you to copy — the comparison below still holds,'
                + ' but the entry is thinner than the record it is supposed to be');
        }
        if (live.run && claim.run && live.run !== claim.run) {
            failures.push('run id: ROLLBACK says ' + claim.run + ', newest receipt says ' + live.run);
        }
        if (live.commit && claim.commit) {
            const n = Math.min(live.commit.length, claim.commit.length);
            if (live.commit.slice(0, n) !== claim.commit.slice(0, n)) {
                failures.push('deploy commit: ROLLBACK says ' + claim.commit + ', newest receipt says ' + live.commit);
            }
        }
        for (const slug of SLUGS) {
            const a = live.fns[slug], b = claim.fns[slug];
            if (!a) { notes.push(slug + ' is absent from the newest receipt'); continue; }
            if (!b) { failures.push(slug + ' is absent from ROLLBACK.md\'s live row'); continue; }
            if (a.version !== b.version) {
                failures.push(slug + ': ROLLBACK says v' + b.version + ', live is v' + a.version);
            }
            const n = Math.min(a.closure.length, b.closure.length);
            if (a.closure.slice(0, n) !== b.closure.slice(0, n)) {
                failures.push(slug + ': ROLLBACK closure ' + b.closure + ' does not prefix-match live ' + a.closure);
            }
        }
        // One step back, not two. The named bundle must capture what was live
        // BEFORE this deploy — which is exactly the previous receipt.
        if (claim.bundle && prior && prior.fns['production-write']) {
            const want = prior.fns['production-write'].version;
            if (claim.bundle.captured !== want) {
                failures.push('rollback bundle ' + claim.bundle.sha + ' claims it captures production-write v'
                    + claim.bundle.captured + ', but the release before the newest one was v' + want
                    + ' — restoring it would step back more than once');
            }
        } else if (!claim.bundle) {
            notes.push('ROLLBACK.md names no "newest sealed" bundle in a shape this check can read,'
                + ' so the one-step property was not verified');
        }
    }

    const out = {
        ok: failures.length === 0,
        receipts: receipts.length,
        live: live ? { run: live.run, commit: live.commit, source: live.source, functions: live.fns } : null,
        rollback: claim,
        failures, notes,
    };
    if (process.argv.indexOf('--json') >= 0) {
        console.log(JSON.stringify(out, null, 2));
    } else {
        console.log('ROLLBACK.md live row vs EXECUTION_LOG.md newest deploy receipt\n');
        if (live) {
            console.log('  newest receipt   run ' + (live.run || '?') + ' from ' + (live.commit || '?')
                + '  (' + live.source + ')');
            for (const slug of SLUGS) {
                const a = live.fns[slug], b = claim && claim.fns[slug];
                console.log('    ' + slug.padEnd(18)
                    + ' live v' + (a ? a.version : '?').padEnd(4)
                    + ' rollback v' + (b ? b.version : '?'));
            }
        }
        if (notes.length) { console.log('\n  NOTE'); notes.forEach(n => console.log('    • ' + n)); }
        console.log('');
        if (failures.length) {
            console.log('  ROLLBACK.md is STALE or wrong — a rollback from this row is not one step back:');
            failures.forEach(f => console.log('    ✗ ' + f));
            console.log('\n  Fix the row, not this check. The newest receipt is the fact.');
        } else {
            console.log('  ROLLBACK.md agrees with the newest deploy receipt ✅');
        }
    }
    process.exit(failures.length ? 1 : 0);
}

if (require.main === module) main();
module.exports = { executionLogReceipts, rollbackClaim };
