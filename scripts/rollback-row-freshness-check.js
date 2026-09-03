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
        rows.push({
            at: m.index, slug: m[1], version: nums[nums.length - 1], closure: m[3].toLowerCase(),
            entry: log.lastIndexOf('\n## ', m.index),
        });
    }
    /* A table belongs to the ENTRY it is written in — that is the real boundary,
       and it is knowable, so the byte-distance heuristic is gone. It merged rows
       from two entries whenever the first table was SHORT, which is exactly the
       truncated-receipt case: the lone surviving row joined the next deploy's
       table and the truncation disappeared. A repeated slug still starts a new
       table, for the before/after pair some entries carry. */
    const out = [];
    let cur = null;
    for (const r of rows) {
        if (cur && cur.entry === r.entry && !cur.fns[r.slug]) {
            cur.fns[r.slug] = { version: r.version, closure: r.closure };
            cur.end = r.at;
            continue;
        }
        if (cur) out.push(cur);
        cur = {
            at: r.at, end: r.at, entry: r.entry, source: 'summary table',
            fns: { [r.slug]: { version: r.version, closure: r.closure } },
        };
    }
    if (cur) out.push(cur);
    return out;
}

/* Run id and dispatched commit live in the entry's prose when the JSON block is
   absent. Look backwards from the table to the entry heading above it. */
function proseContext(log, at) {
    const start = log.lastIndexOf('\n## ', at);
    const chunk = log.slice(start < 0 ? 0 : start, at);
    const run = chunk.match(/[Rr]un\s+`(\d{6,})`/);
    const commit = chunk.match(/from\s+`([0-9a-f]{7,40})`/);
    const date = chunk.match(/^\n?## (\d{4}-\d{2}-\d{2})/);
    return {
        run: run ? run[1] : '',
        commit: commit ? commit[1].toLowerCase() : '',
        date: date ? date[1] : '',
    };
}

/* FILE POSITION IS NOT CHRONOLOGY, and this is the finding that made the first
   version of this check pass by luck. EXECUTION_LOG.md is REVERSE-chronological
   at the top (2026-08-31 at line 5, descending) and forward-chronological
   further down (2026-08-25 → 2026-09-01 → 2026-09-02). Taking the last receipt
   in the file happens to be right today; the next entry written at the top the
   way the top section is written would silently make it compare against an
   older deploy, and a stale ROLLBACK row would pass. Codex P1 on #1253.

   The run id is the unambiguous signal: GitHub run ids increase with time, and
   every receipt carries one in its block or in its entry's prose. It also
   solves the folding question — a JSON block and its own summary table are the
   SAME deploy because they carry the same run id, not because they sit near
   each other in the file. */
/* The whole entry a receipt sits in, heading to next heading. The sealed-bundle
   line comes AFTER the versions table in a forward-deploy entry, so the
   backwards-only prose slice above cannot see it. */
function entryText(log, at) {
    const start = log.lastIndexOf('\n## ', at);
    const from = start < 0 ? 0 : start;
    const next = log.indexOf('\n## ', at);
    return log.slice(from, next < 0 ? log.length : next);
}

function sealedBundleIn(text) {
    const sha = String(text || '').match(/sealed_bundle_sha256\s*=\s*([0-9a-f]{64})/);
    const bytes = String(text || '').match(/byte_length\s*=\s*(\d+)/);
    return sha ? { sha: sha[1], bytes: bytes ? bytes[1] : '' } : null;
}

function executionLogReceipts() {
    const log = read('EXECUTION_LOG.md');
    const all = receiptsFromJson(log).concat(receiptsFromTables(log));
    all.sort((a, b) => a.at - b.at);
    for (const r of all) {
        const p = proseContext(log, r.at);
        r.run = r.run || p.run;
        r.commit = r.commit || p.commit;
        r.date = p.date || '';
        r.sealed = sealedBundleIn(entryText(log, r.at));
    }

    // Group by deployment identity, preferring the richer shape within a group.
    const byRun = new Map();
    const unidentified = [];
    for (const r of all) {
        if (!r.run) { unidentified.push(r); continue; }
        const prev = byRun.get(r.run);
        if (!prev) { byRun.set(r.run, r); continue; }
        if (prev.source !== 'attestation block' && r.source === 'attestation block') byRun.set(r.run, r);
        else if (prev.source === r.source) prev.siblings = (prev.siblings || []).concat([r]);
    }
    const receipts = Array.from(byRun.values()).sort((a, b) => {
        const d = BigInt(a.run) - BigInt(b.run);
        return d < 0n ? -1 : d > 0n ? 1 : 0;
    });
    receipts.unidentified = unidentified;
    return receipts;
}

/* ---- ROLLBACK.md: the current live claim -------------------------------- */

function rollbackClaim() {
    const md = read('ROLLBACK.md');
    // The FIRST bold "Live as of" is the current claim; the superseded history
    // below it in the same cell is prose and must never be parsed as live.
    const i = md.indexOf('**Live as of');
    if (i < 0) return null;
    /* BOUND THE CLAIM TO ITS OWN BOLD SPAN. A fixed window ran past the end of
       the claim into the deliberately-retained "Superseded history" prose in the
       same table cell, which carries an older run id, commit and version set in
       the identical format. So a claim that OMITTED its run id silently borrowed
       the superseded one and compared against that — found while testing Codex's
       "absence is not agreement" P2, and worse than the finding itself. */
    const closing = md.indexOf('.**', i);
    const cell = md.slice(i, closing < 0 ? i + 900 : closing + 3);
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

    /* Chronology has to be ESTABLISHED, not assumed. A receipt with no run id
       cannot be placed in time, so it cannot be ruled out as the newest — and
       "probably not the newest" is not a property a rollback guard may rest on. */
    for (const r of (receipts.unidentified || [])) {
        failures.push('a deploy receipt at character ' + r.at + ' of EXECUTION_LOG.md carries no run id,'
            + ' so it cannot be placed in time and the newest deploy cannot be established.'
            + ' Add the run id to that entry (the attestation block carries it as github_run_id).');
    }
    /* Second signal, because one is a single point of failure: the entry dates
       must agree with the run-id order about which deploy is newest. */
    if (live && live.date) {
        const laterByDate = receipts.filter(r => r.date && r.date > live.date);
        if (laterByDate.length) {
            failures.push('the newest receipt by run id (' + live.run + ', ' + live.date + ') is not the newest by'
                + ' date — ' + laterByDate.map(r => r.run + ' @ ' + r.date).join(', ')
                + '. The two chronology signals disagree, so which deploy is live cannot be established.');
        }
    }

    if (live && claim) {
        if (live.source !== 'attestation block') {
            notes.push('the newest receipt is a ' + live.source + ', not the ' + SCHEMA
                + ' block the lane instructs you to copy — the comparison below still holds,'
                + ' but the entry is thinner than the record it is supposed to be');
        }
        /* ABSENCE IS NOT AGREEMENT. Codex P2 on #1253: a claim missing its run id
           or its dispatched commit skipped these comparisons and exited 0, so the
           row lost exactly the provenance this guard says it verifies. */
        if (!claim.run) {
            failures.push('ROLLBACK.md\'s live claim names no run id, so the deploy it describes cannot be'
                + ' identified — the provenance this guard verifies is simply absent');
        } else if (live.run && live.run !== claim.run) {
            failures.push('run id: ROLLBACK says ' + claim.run + ', newest receipt says ' + live.run);
        }
        if (!claim.commit) {
            failures.push('ROLLBACK.md\'s live claim names no dispatched commit, so what was deployed'
                + ' cannot be checked against what the receipt records');
        } else if (!live.commit) {
            /* The receipt's side of the same rule. Codex P2 on #1253: a
               table-only receipt whose prose omits "from <sha>" left
               live.commit empty and the comparison was skipped, so the row
               could name an ARBITRARY commit and still pass — on a guard whose
               whole claim is that it verifies deployment provenance. */
            failures.push('the newest receipt (run ' + (live.run || '?') + ') records no dispatched commit,'
                + ' so ROLLBACK.md\'s ' + claim.commit + ' cannot be checked against anything.'
                + ' Add "dispatched from `<sha>`" to that EXECUTION_LOG entry.');
        } else {
            const n = Math.min(live.commit.length, claim.commit.length);
            if (live.commit.slice(0, n) !== claim.commit.slice(0, n)) {
                failures.push('deploy commit: ROLLBACK says ' + claim.commit + ', newest receipt says ' + live.commit);
            }
        }
        for (const slug of SLUGS) {
            const a = live.fns[slug], b = claim.fns[slug];
            /* A truncated receipt must not leave a function silently unchecked:
               the §4 lane deploys the four as one serial set, so a receipt naming
               three of them is incomplete, not a receipt about three functions. */
            if (!a) {
                failures.push(slug + ' is missing from the newest receipt (run ' + (live.run || '?')
                    + '), so ROLLBACK.md\'s claim about it was not verified against anything');
                continue;
            }
            if (!b) { failures.push(slug + ' is absent from ROLLBACK.md\'s live row'); continue; }
            if (a.version !== b.version) {
                failures.push(slug + ': ROLLBACK says v' + b.version + ', live is v' + a.version);
            }
            const n = Math.min(a.closure.length, b.closure.length);
            if (a.closure.slice(0, n) !== b.closure.slice(0, n)) {
                failures.push(slug + ': ROLLBACK closure ' + b.closure + ' does not prefix-match live ' + a.closure);
            }
        }
        /* One step back, not two. The named bundle must capture what was live
           BEFORE this deploy — which is exactly the previous receipt.

           EVERY branch of this is a FAILURE, never a note. Codex P1 on #1253:
           a row that updates the live versions while naming no readable bundle
           passes nothing on to the person mid-incident, which is the exact
           hazard this guard exists for. "We could not check" and "it is fine"
           must not print the same verdict. */
        if (!claim.bundle) {
            failures.push('ROLLBACK.md names no "newest sealed" bundle this check can read, so the row'
                + ' updates what is live while leaving the one-step restore unverified — the state this'
                + ' guard exists to prevent. Keep the sentence in the form: the newest sealed §4 rollback'
                + ' bundle is `<sha8>…` / <N> bytes and it captures `production-write` at v<NN>.');
        } else if (!prior) {
            failures.push('bundle ' + claim.bundle.sha + ' claims production-write v' + claim.bundle.captured
                + ', but EXECUTION_LOG.md holds no receipt older than the newest one, so "one release back"'
                + ' cannot be checked against anything.');
        } else if (!prior.fns['production-write']) {
            failures.push('bundle ' + claim.bundle.sha + ' claims production-write v' + claim.bundle.captured
                + ', but the previous receipt (run ' + (prior.run || '?') + ') does not name production-write,'
                + ' so "one release back" cannot be established.');
        } else if (live.sealed && (
            claim.bundle.sha.length === 0
            || live.sealed.sha.slice(0, claim.bundle.sha.length) !== claim.bundle.sha)) {
            /* The captured VERSION matching is not the bundle matching. Codex P1
               on #1253: with the right version the row could name any digest —
               `deadbeef… / 1 bytes` passed — and an older bundle is exactly the
               one that is indistinguishable by version when an intervening
               deploy moved a different function. The receipt records the sealed
               bundle it was dispatched against; that is the identity to match. */
            failures.push('rollback bundle: ROLLBACK names ' + claim.bundle.sha
                + '…, but the newest deploy receipt sealed ' + live.sealed.sha.slice(0, 16)
                + '… — the row names a different bundle from the one that deploy captured');
        } else if (live.sealed && !live.sealed.bytes) {
            /* Codex P2 on #1253: a receipt with a sealed digest but no
               byte_length made this comparison truthiness-skip, so the bundle
               was accepted without its length ever being proved. A missing
               length fails exactly like a missing digest — half an identity is
               not an identity. */
            failures.push('the newest receipt records sealed_bundle_sha256 but no byte_length, so the'
                + ' bundle ROLLBACK.md names is only half checked. Copy both fields from the capture'
                + ' receipt into that EXECUTION_LOG entry.');
        } else if (live.sealed && claim.bundle.bytes !== live.sealed.bytes) {
            failures.push('rollback bundle ' + claim.bundle.sha + '…: ROLLBACK says '
                + claim.bundle.bytes + ' bytes, the receipt records ' + live.sealed.bytes);
        } else if (!live.sealed) {
            failures.push('the newest deploy receipt records no sealed_bundle_sha256, so the bundle'
                + ' ROLLBACK.md names cannot be checked against the one that deploy actually captured.'
                + ' Copy the capture receipt into the EXECUTION_LOG entry.');
        } else if (claim.bundle.captured !== prior.fns['production-write'].version) {
            failures.push('rollback bundle ' + claim.bundle.sha + ' claims it captures production-write v'
                + claim.bundle.captured + ', but the release before the newest one was v'
                + prior.fns['production-write'].version
                + ' — restoring it would step back more than once');
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
