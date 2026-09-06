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
 * What is compared, all of it derived from the repository and nothing else:
 *   1. the GitHub run id and the dispatched commit,
 *   2. every function's active version and source-closure hash,
 *   3. the one-step rollback bundle's claimed capture — it must be the version
 *      that was live BEFORE the newest deploy, i.e. the previous receipt's, or
 *      it is not one step back,
 *   4. that no OTHER workflow which deploys these functions has shipped since
 *      the newest §4 receipt. The §4 lane is not the only one — see
 *      otherOwningLanes(), which derives the list from .github/workflows —
 *      and a deploy this guard cannot read is not a deploy that did not
 *      happen. That is exactly how the row went stale on 2026-08-27.
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
/* --root points the two MARKDOWN files at a fixture pair. The workflow files are
   not data under test, they are this repository's own answer to "which lanes can
   move these functions", so they are always read from the real checkout — a
   fixture that had to carry a copy of .github/workflows to exercise the lane
   check would be testing its own copy, not the shipped roster. */
const REPO = path.resolve(__dirname, '..');
const SLUGS = ['production-write', 'linear-outbound', 'deliverable-write', 'batch-write'];
const SCHEMA = 'syncview_f27_section4_deployed_versions_v1';
/* The JSON key line that marks a receipt block. The bare token also appears
   in prose ("`syncview_f27_section4_deployed_versions_v1` JSON block"), which
   is a sentence about the schema, not a receipt. */
const SCHEMA_LINE = new RegExp('"schema"\\s*:\\s*"' + SCHEMA + '"');

const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

/* ---- EXECUTION_LOG.md: every deploy receipt, oldest first ---------------- */

/* The receipt exists in two shapes and BOTH are load-bearing. The lane's own
   instruction is to copy the full JSON attestation block; entries have shipped
   with only the human-readable table (noted on #1215 and again in item 118),
   and refusing to read those would make this check blind exactly when the
   record is already thinner than it should be. So: read the JSON when it is
   there, fall back to the table, and SAY which one was used. */
/* Fenced code blocks, line by line. A block that reaches a heading before its
   closing fence is truncated and ends there, so a broken paste cannot swallow
   the next entry's block the way a lazy regex did. */
function fencedBlocks(log) {
    const out = [];
    let pos = 0, open = null;
    for (const line of log.split('\n')) {
        const fence = /^\s*```/.test(line);
        if (open) {
            if (fence) { out.push({ from: open.at, to: pos + line.length, content: log.slice(open.contentStart, pos) }); open = null; }
            else if (/^#{1,6} /.test(line)) { out.push({ from: open.at, to: pos, content: log.slice(open.contentStart, pos) }); open = null; }
        } else if (fence) {
            open = { at: pos, contentStart: pos + line.length + 1 };
        }
        pos += line.length + 1;
    }
    if (open) out.push({ from: open.at, to: log.length, content: log.slice(open.contentStart) });
    return out;
}

function receiptsFromJson(log) {
    const out = [];
    for (const b of fencedBlocks(log)) {
        if (!SCHEMA_LINE.test(b.content)) continue;
        let obj = null;
        try { obj = JSON.parse(b.content.trim()); } catch (e) { obj = null; }
        if (!obj || obj.schema !== SCHEMA || !Array.isArray(obj.functions)) {
            /* A block that carries the schema line but does not parse, or is
               not the lane's shape, is a broken paste of a receipt. Under a
               generic heading it used to be invisible: no receipt, no table
               row, nothing for the sweep to count (Codex, twenty-first round on
               #1306). The sweep counts it like an unreadable table row. */
            receiptsMeta.unreadableAttestations.push({ at: b.from });
            continue;
        }
        receiptsMeta.parsedJson.push({ from: b.from, to: b.to });
        const m = { index: b.from };
        const fns = {};
        for (const f of obj.functions) {
            if (!f || !f.slug) continue;
            fns[f.slug] = {
                version: String(f.active_version || '').trim(),
                closure: String(f.source_closure_sha256 || '').trim().toLowerCase(),
            };
        }
        /* The §4 lane attests all four functions, always. A block naming fewer
           is truncated or hand-written, and the dangerous kind: under an old
           entry's run id it folds into that run's complete receipt and the
           function it omitted -- the one that changed -- is never compared
           (Codex, thirteenth round on #1306). */
        const named = SLUGS.filter(slug => fns[slug]);
        if (named.length < SLUGS.length) {
            receiptsMeta.incompleteAttestations.push({
                at: m.index, run: String(obj.github_run_id || '').trim(), named: named.length,
                missing: SLUGS.filter(slug => !fns[slug]),
            });
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
    /* Leading indentation is allowed: Markdown tables inside list content are
       routinely indented, and a parser that required the pipe in column 1 was
       blind to them (Codex, eleventh round on #1306). `m.index` stays the line
       start, which is what the unreadable-row sweep compares against. */
    const rowRe = /^[ \t]*\|\s*`([a-z-]+)`\s*\|([^|]*)\|\s*`([0-9a-f]{64})`\s*\|/gm;
    const rows = [];
    let m;
    while ((m = rowRe.exec(log))) {
        if (SLUGS.indexOf(m[1]) < 0) continue;
        const nums = String(m[2]).match(/\d+/g);
        if (!nums || !nums.length) continue;
        receiptsMeta.parsedRows.add(m.index);
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

/* WHERE A DISPATCH BEGINS — and the reason the nearest run TOKEN is not it.

   Codex P1 on #1253, with evidence in the file: deploy #5's own heading names
   run `31217806479`, and its very first sentence says the deploy was "fully
   green, including the final four-function verification step that FAILED on run
   `31214635190`". The nearest preceding run token before #5's table is
   therefore the id of a run that deployed nothing. Its table receipt was being
   filed under that failed run, which splits one deploy into two identities:
   with the JSON block present they disagree and a phantom receipt appears, and
   without it the deploy vanishes under the wrong id and a stale live row
   passes.

   A run token is a MENTION. An anchor is a CLAIM — a heading that says "this
   section is deploy N, run X", or the concise-prose marker that says the same
   thing inline. Only anchors decide identity and section bounds; a bare token
   is the last-resort fallback for a receipt with no anchor above it at all. */
function deployAnchors(log) {
    const out = [];
    const heading = /^#{2,6} [^\n]*?\brun `(\d{6,})`/gm;
    const prose = /\*\*Section 4 forward from `[0-9a-f]{7,40}`, run `(\d{6,})`/g;
    let m;
    while ((m = heading.exec(log))) out.push({ at: m.index, run: m[1] });
    while ((m = prose.exec(log))) out.push({ at: m.index, run: m[1] });
    out.sort((a, b) => a.at - b.at);
    return out;
}

/* The anchor a receipt belongs to: the LAST one inside the receipt's own
   section or one of its actual ancestors' preambles (the ranges proseContext
   computes), never one under a closed sibling heading, and never one under a
   different `##` entry. */
function enclosingAnchor(ranges, anchors) {
    let best = null;
    for (const a of anchors) {
        if (ranges.some(r => a.at >= r.from && a.at < r.to)) best = a;
    }
    return best;
}

/* Run id and dispatched commit live in the entry's prose when the JSON block is
   absent. Look backwards from the table to the entry heading above it. */
/* THE NEAREST PRECEDING MENTION, not the first in the entry. One `##` entry can
   hold many deploys — the 2026-08-05 one names TWELVE run ids and carries six
   receipts — so taking the first match assigns a later table-only receipt the
   identity of the oldest deploy in its entry, after which `byRun` folds it away
   as a duplicate and the newest deploy can disappear entirely. Codex P1 on
   #1253. A receipt whose own attestation block carries the run id never reaches
   here; this is the fallback for the table-only shape, which is exactly the
   shape that would vanish. */
function lastMatch(text, re) {
    const g = new RegExp(re.source, re.flags.replace('g', '') + 'g');
    let m, last = null;
    while ((m = g.exec(text))) last = m;
    return last;
}

/* A DATE HAS TO BE A DATE. `2026-99-99` matches the shape, sorts after every
   real date, and would have made the second chronology signal meaningless while
   looking present. Round-tripped through Date so only a real calendar day
   counts. Codex P2 on #1253. */
function validDate(text) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(text || ''))) return '';
    const d = new Date(text + 'T00:00:00Z');
    return isFinite(d.getTime()) && d.toISOString().slice(0, 10) === text ? text : '';
}

function proseContext(log, at, anchors) {
    const start = log.lastIndexOf('\n## ', at);
    const chunkStart = start < 0 ? 0 : start;
    const chunk = log.slice(chunkStart, at);
    /* Every heading above the receipt inside its `##` entry, by absolute position. */
    const heads = [...chunk.matchAll(/(?:^|\n)(#{2,6}) ([^\n]*)/g)].map(m => ({
        at: chunkStart + m.index + (m[0][0] === '\n' ? 1 : 0),
        level: m[1].length,
        text: m[2],
    }));
    /* THE RECEIPT'S OWN HEADING AND ITS ACTUAL ANCESTORS, nothing else. Walking
       upward, a heading counts only if it is shallower than every heading
       already counted; a closed sibling (same level or deeper) is skipped, so
       its date, run id and dispatched commit are never borrowed. A dated
       "### Deploy #15" followed by an undated "### Deploy #40" used to lend #40
       its date, which silenced the missing-date failure and left run-id order
       with nothing real to be cross-checked against (Codex, fourteenth round on
       #1306). Each counted heading contributes its own preamble only: the text
       from that heading to the next heading of any level, or to the receipt
       itself for the nearest one. */
    const ranges = [];
    let ceiling = Infinity;
    for (let i = heads.length - 1; i >= 0; i--) {
        if (heads[i].level >= ceiling) continue;
        ceiling = heads[i].level;
        ranges.push({ from: heads[i].at, to: i + 1 < heads.length ? heads[i + 1].at : at, text: heads[i].text });
    }
    ranges.reverse();
    /* A container's date IS inherited when the deploy heading carries none:
       the container is a real ancestor, its date is the entry the author
       placed the deploy in, and an early date can only make this guard
       stricter (a later-dated receipt trips the chronology check below, and
       the unreadable-section sweep softens less). A sibling's date could go
       either way, which is why it is never borrowed. */
    const chain = ranges;
    const scope = chain.length ? chain : [{ from: chunkStart, to: at, text: '' }];
    const visible = scope.map(r => log.slice(r.from, r.to)).join('\n');
    /* An anchor OUTRANKS a bare token, always. See deployAnchors: the token
       nearest a table is routinely the id of the run that failed before it. */
    const anchor = anchors ? enclosingAnchor(scope, anchors) : null;
    const run = anchor ? null : lastMatch(visible, /[Rr]un\s+`(\d{6,})`/);
    const commit = lastMatch(visible, /from\s+`([0-9a-f]{7,40})`/);
    /* The NEAREST dated heading in that chain, at any level 2-6, with the `##`
       entry heading as the last resort. The 2026-08-05 container holds `###`
       deploys dated through 2026-08-19, so a receipt written under
       "### 2026-09-06 — Deploy #40" inside it is a 2026-09-06 receipt, not a
       2026-08-05 one; dating it by the parent made the newest deploy by run id
       disagree with the date order and fail chronology (Codex, twelfth round on
       #1306). Same rule the unreadable-section sweep already applies. */
    let date = '';
    for (let i = chain.length - 1; i >= 0 && !date; i--) {
        const d = chain[i].text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
        if (d) date = validDate(d[1]);
    }
    return {
        run: anchor ? anchor.run : (run ? run[1] : ''),
        commit: commit ? commit[1].toLowerCase() : '',
        date,
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

/* THE DISPATCH SECTION a receipt belongs to, not its whole entry — bounded by
   ANCHORS now, for the reason deployAnchors gives. The previous version used
   run tokens, and Codex P1 on #1253 showed why that is not enough: deploy #5's
   own TEST-drill run (`31217933580`) is mentioned between its receipt and its
   bundle, so the section ended before the bundle line and the entry-wide
   fallback below took over — reaching back to the FIRST bundle in a `##` entry
   that holds six of them, i.e. deploy #4's. That is the wrong digest presented
   as this deploy's, and the captured-version check cannot catch it whenever the
   intervening deploy moved a different function. A drill run is a mention; it
   does not begin a dispatch, and now it does not end one either. */
function deploySection(log, at, anchors) {
    const entryStart = log.lastIndexOf('\n## ', at);
    const entryEnd = log.indexOf('\n## ', at);
    const from = entryStart < 0 ? 0 : entryStart;
    const to = entryEnd < 0 ? log.length : entryEnd;
    let start = from, end = to;
    for (const a of (anchors || [])) {
        if (a.at < from || a.at > to) continue;
        if (a.at <= at) start = a.at;
        else { end = a.at; break; }
    }
    return log.slice(start, Math.max(start, end));
}

/* HOW MANY DISPATCHES THIS `##` ENTRY HOLDS. One is the shape where the entry
   and the section are the same text and an entry-wide fallback is harmless.
   More than one is exactly the shape where it is not. */
function anchorsInEntry(log, at, anchors) {
    const entryStart = log.lastIndexOf('\n## ', at);
    const entryEnd = log.indexOf('\n## ', at);
    const from = entryStart < 0 ? 0 : entryStart;
    const to = entryEnd < 0 ? log.length : entryEnd;
    return (anchors || []).filter(a => a.at >= from && a.at < to).length;
}

/* BOTH SPELLINGS, because the log overwhelmingly uses the one this did not
   read. `sealed_bundle_sha256 = <hex>` appears ONCE in EXECUTION_LOG.md;
   `rollback_bundle_sha256   <hex>` — the shape the capture receipt actually
   prints, no equals sign — appears six times. So the bundle comparison was
   silently skipped for every entry written in the common shape, which is a
   check that reports the same thing whether it looked or not. */
function sealedBundleIn(text) {
    const t = String(text || '');
    const sha = t.match(/(?:sealed|rollback)_bundle_sha256\s*=?\s*`?([0-9a-f]{64})/);
    const bytes = t.match(/(?:rollback_bundle_)?byte_length\s*=?\s*`?(\d+)/);
    return sha ? { sha: sha[1], bytes: bytes ? bytes[1] : '' } : null;
}

/* ---- the lanes this guard does NOT read ---------------------------------- */

/* EVERY WORKFLOW THAT CAN MOVE THESE FOUR FUNCTIONS, derived from the workflow
   files rather than listed here — the roster lesson this repo has now learned
   twice. Today it finds two: the §4 lane, and `deploy-onboarding-edge-functions`
   (workflow name "Deploy staff-sensitive edge functions"), whose Track-B step
   deploys `linear-outbound` and `production-write`.

   Codex P1 on #1253, and it is not hypothetical: ROLLBACK.md's own row records
   that this row "decayed again within three days" of the update step being
   added, "because the deploys went through the ONBOARDING lane, which the step
   does not cover", and calls the onboarding-lane gap "the durable fix still
   owed". That lane emits an `ef-fingerprint` attestation into its job summary,
   not the §4 JSON/table/prose shapes this file reads — so a deploy through it
   moves the live versions and leaves this guard reporting agreement. */
function otherOwningLanes() {
    const dir = path.join(REPO, '.github', 'workflows');
    let files = [];
    try { files = fs.readdirSync(dir); } catch (e) { return []; }
    const out = [];
    for (const f of files) {
        if (!/^deploy-.*\.ya?ml$/.test(f)) continue;
        if (f.indexOf('section4') >= 0) continue;   // the lane this guard reads
        let text = '';
        try { text = fs.readFileSync(path.join(dir, f), 'utf8'); } catch (e) { continue; }
        const owned = SLUGS.filter(sl => new RegExp('\\b' + sl + '\\b').test(text));
        if (!owned.length) continue;
        const nm = text.match(/^name:\s*(.+)$/m);
        out.push({ file: f, base: f.replace(/\.ya?ml$/, ''), name: nm ? nm[1].trim().replace(/^["']|["']$/g, '') : '', slugs: owned });
    }
    return out;
}

/* A dispatch of one of those lanes recorded AT OR AFTER the newest §4 receipt's
   day. Deliberately narrow: the lane has to be named as a reference — its
   filename in backticks, or its workflow name in quotes — not merely alluded to
   in prose ("not the onboarding one" is a sentence about a lane, not a record
   of running it). Narrow because a rollback guard that cries wolf gets skimmed,
   which is the failure this repository documents most often.

   Three refinements, Codex's fifteenth round on #1306:
   - the entry need not repeat a slug. The lane roster already says which of
     the four a lane moves, and the log's own concise companion form
     ("`deploy-onboarding-edge-functions` dispatch (archive comment ordering EF
     goes live)") names none of them;
   - the receipt this guard compares against gets no blanket exemption: in its
     own block (its heading to the next heading of any level) a lane dispatch
     with an older run id is one the receipt superseded, one with a newer run
     id is a finding, and one with no run id is reported as unplaceable; a
     follow-up written later in the same `##` entry is judged like any other;
   - the reference has to record a dispatch that HAPPENED: a run id or a
     completed-dispatch word in its paragraph, and not a forward-looking one.
     "inert until a `deploy-onboarding-edge-functions` dispatch carries the
     merged closure" is a plan, and the log already says it that way. */
function laneDispatchesSince(log, sinceDate, exemptAt, sinceRun) {
    const lanes = otherOwningLanes();
    if (!lanes.length) return [];
    const heads = headingsOf(log);
    const exempt = ownBlock(log, exemptAt);
    const found = [];
    const seen = new Set();
    for (const lane of lanes) {
        const refs = ['`' + lane.base + '`', '`' + lane.file + '`'].concat(lane.name ? ['"' + lane.name + '"'] : []);
        for (const ref of refs) {
            for (let k = log.indexOf(ref); k >= 0; k = log.indexOf(ref, k + ref.length)) {
                const ev = recordsADispatch(log, k, ref.length);
                if (!ev) continue;
                /* RUN IDS ORDER DISPATCHES ACROSS EVERY LANE. When the record's
                   run id and the receipt's are both known they decide, and the
                   day-level date is only the fallback. A run older than the
                   receipt's is a dispatch the §4 deploy superseded, on any day
                   and in any block, the receipt's own included (Codex,
                   twentieth round on #1306: a same-day companion run that
                   preceded the receipt is not a finding). A newer one is a
                   finding wherever it sits, the receipt's own block included
                   (same round: that block used to be skipped before the run id
                   was read). Without run ids: a reference in the receipt's own
                   block cannot be placed before or after it and is reported as
                   such; elsewhere the section's date decides, the section being
                   whatever heading holds the record, at any level, dated by its
                   own heading or the nearest dated actual ancestor. The
                   2026-08-05 container holds dated `###` deploys through
                   2026-08-19, and a "### 2026-09-06 — companion release" inside
                   it is a 2026-09-06 record (Codex, nineteenth round). */
                const inOwn = !!(exempt && k >= exempt.from && k < exempt.to);
                const cmp = ev.run && /^\d+$/.test(String(sinceRun || '')) ? Math.sign(Number(ev.run) - Number(sinceRun)) : null;
                if (cmp !== null && cmp <= 0) continue;
                const newerRun = cmp === 1;
                const date = dateAt(heads, k);
                let unplaced = false;
                if (!newerRun) {
                    if (inOwn) unplaced = true;
                    else if (!date || (sinceDate && date < sinceDate)) continue;
                }
                const section = sectionAt(heads, k);
                const key = lane.base + '|' + (section ? section.at : -1);
                if (seen.has(key)) continue;
                seen.add(key);
                found.push({
                    at: k, date, run: ev.run, newerRun, unplaced, line: lineAt(log, section ? section.at : k),
                    lane: lane.base, name: lane.name, slugs: lane.slugs,
                });
            }
        }
    }
    found.sort((a, b) => a.at - b.at);
    return found;
}

/* Every heading of level 2 to 6, with the date its text carries, if any. */
function headingsOf(log) {
    const out = [];
    const re = /^(#{2,6}) ([^\n]*)/gm;
    let m;
    while ((m = re.exec(log))) {
        out.push({ at: m.index, level: m[1].length, text: m[2], date: validDate((m[2].match(/\b(\d{4}-\d{2}-\d{2})\b/) || [])[1] || '') });
    }
    return out;
}

/* The heading whose section holds position k: the nearest heading above it. */
function sectionAt(heads, k) {
    let best = null;
    for (const h of heads) {
        if (h.at > k) break;
        best = h;
    }
    return best;
}

/* The date of the section holding k: its own heading's, else the nearest
   dated ACTUAL ancestor's, the chain rule proseContext applies to receipts;
   a closed sibling's date is never borrowed. */
function dateAt(heads, k) {
    let ceiling = Infinity;
    for (let i = heads.length - 1; i >= 0; i--) {
        if (heads[i].at > k || heads[i].level >= ceiling) continue;
        ceiling = heads[i].level;
        if (heads[i].date) return heads[i].date;
    }
    return '';
}

function lineAt(log, at) {
    let n = 1;
    for (let i = 0; i < at && i < log.length; i++) if (log.charCodeAt(i) === 10) n++;
    return n;
}

/* The block a position belongs to: from the nearest heading at or above it, at
   any level, to the next heading of any level after it. */
function ownBlock(log, at) {
    if (typeof at !== 'number' || !(at >= 0)) return null;
    const hre = /^#{2,6} /gm;
    let from = 0, to = log.length, m;
    while ((m = hre.exec(log))) {
        if (m.index <= at) from = m.index;
        else { to = m.index; break; }
    }
    return { from, to };
}

/* The text a lane reference is judged by: its own Markdown list item when it
   sits in a list, else its blank-line paragraph. Two bullets written back to
   back without a blank line are two records, not one: "`lane` dispatch
   completed successfully" followed by "Follow-up smoke probe: NOT DISPATCHED"
   used to read as one paragraph, and the second bullet's verdict silenced the
   first (Codex, sixteenth round on #1306). And one item can span several
   paragraphs: a bullet line "`lane` dispatch:" followed by a blank line and an
   INDENTED paragraph "Completed successfully" is one item, so the item runs
   from its bullet line to the line before the next bullet at any indentation,
   across blank lines as long as the paragraph after the blank is indented
   (Codex, seventeenth round). A paragraph at column zero after a blank line
   is the end of the list, not part of the item. */
function referenceScope(log, k, len) {
    const wStart = k - 3000 <= 0 ? 0 : log.lastIndexOf('\n', k - 3000) + 1;
    let wEnd = log.indexOf('\n', k + len + 3000);
    if (wEnd < 0) wEnd = log.length;
    const lines = [];
    let pos = wStart;
    for (const text of log.slice(wStart, wEnd).split('\n')) {
        lines.push({ from: pos, to: pos + text.length, text });
        pos += text.length + 1;
    }
    const idx = lines.findIndex(l => k >= l.from && k <= l.to);
    const isBullet = t => /^[ \t]*(?:[-*+]|\d+[.)])\s/.test(t);
    const isBlank = t => /^\s*$/.test(t);
    const isIndented = t => /^[ \t]+\S/.test(t);
    const paragraph = () => {
        let a = idx, b = idx;
        while (a > 0 && !isBlank(lines[a - 1].text)) a--;
        while (b + 1 < lines.length && !isBlank(lines[b + 1].text)) b++;
        return { from: lines[a].from, to: lines[b].to };
    };
    if (idx < 0) return { from: Math.max(0, k - 800), to: Math.min(log.length, k + len + 800) };
    /* Backwards to the item's bullet line. Crossing a blank line is allowed
       only when the paragraph being left starts indented, i.e. is a
       continuation paragraph of an item rather than a paragraph after the list. */
    let first = -1;
    for (let j = idx; j >= 0; j--) {
        const t = lines[j].text;
        if (isBullet(t)) { first = j; break; }
        if (isBlank(t)) {
            if (j + 1 > idx || !isIndented(lines[j + 1].text)) break;
        }
    }
    if (first < 0) return paragraph();
    /* Forwards to the line before the next bullet. At a blank line, the item
       continues only if the next non-blank line is indented and not a bullet. */
    let last = idx;
    for (let j = idx + 1; j < lines.length; j++) {
        const t = lines[j].text;
        if (isBullet(t)) break;
        if (isBlank(t)) {
            let n = j + 1;
            while (n < lines.length && isBlank(lines[n].text)) n++;
            if (n >= lines.length || isBullet(lines[n].text) || !isIndented(lines[n].text)) break;
            continue;
        }
        last = j;
    }
    return { from: lines[first].from, to: lines[last].to };
}

/* Does the lane reference at k record a dispatch that happened? Returns the
   evidence ({ run } with the run id that follows the reference, or '' when the
   proof is a completed-dispatch word), or null. Judged on the
   CLAUSE that names the lane, inside its list item or paragraph (see
   referenceScope): the text between sentence separators (. ; ! ?) around the
   reference. One item can carry two verdicts about two different things,
   "`lane` completed successfully (run `X`)." and then "Follow-up smoke probe:
   NOT DISPATCHED." (Codex, eighteenth round on #1306), so a negation counts
   only in the lane's own clause. In that clause: NOT DISPATCHED means it did
   not happen; a run id AFTER the reference is how a completed dispatch is
   identified ("dispatch (run `X`)") and is proof; a run id before it is some
   other run ("After run `X`, the next `lane` dispatch will carry ...", same
   round) and proves nothing; a forward-looking word (until, next, will,
   planned ...) makes it a plan. Otherwise it takes a completed-dispatch word,
   in the clause or in a colon-terminated lead-in that opens the item and
   governs every clause it introduces ("**Companions merged/dispatched the
   same day:** ...; `lane` dispatch (...)"). */
const DONE_WORDS = 'dispatched|went out|deployed|redeployed|shipped|ran|passed|PASS|green|succeeded|success|successful|successfully|completed|went live|goes live|is live|now live';
/* Forward-looking or negating words. Tested against the clause with the lane
   reference replaced by LANE, so "without a LANE dispatch" is caught while
   "completed without errors" is not (Codex, twenty-second round on #1306:
   a bare "without" read a completed run as a plan). */
const AHEAD_WORDS = 'until|pending|awaiting|await|next|future|upcoming|planned|planning|will|would|not yet|owed|instead of|rather than|to be dispatched|without (?:a |the |any |ever )?(?:LANE )?(?:dispatch|dispatching|run|running)';
/* Checks that are not deployments: a completion word about one of these
   ("dry-run passed", "validation succeeded", "passed the typecheck") says
   nothing about the dispatch, and a run id that follows one of these is the
   check's run (Codex, twenty-third round on #1306). */
const CHECK_WORDS = 'dry[- ]?runs?|validations?|validated?|plan[- ]only|plan mode|previews?|no-?ops?|typechecks?|lint|smoke[- ]?tests?|probes?';
const DISPATCH_DONE = new RegExp('\\b(' + DONE_WORDS + ')\\b', 'i');
const DISPATCH_AHEAD = new RegExp('\\b(' + AHEAD_WORDS + ')\\b', 'i');
const CHECK_ONLY = new RegExp('\\b(' + CHECK_WORDS + ')\\b', 'i');
/* A check's completion phrase, with every completion modifier that follows it
   ("validation completed successfully", "dry-run ran green") and any auxiliary
   between the noun and its verdict ("validation was completed successfully",
   "dry-run has passed"), so nothing of the check's verdict is left to read as
   the dispatch's (Codex, twenty-fourth and twenty-fifth rounds on #1306). */
const AUX_WORDS = 'was|were|is|are|has|had|have|been|got|also|then|all|both|not|never|no longer';
/* A negated completion ("was not completed", "never dispatched") is not a
   completion, of a check or of the dispatch (Codex, twenty-sixth round on
   #1306). */
/* Explicit failure wording is a negated verdict too: "the dispatch failed
   without deploying any function (run `X`)" deployed nothing (Codex,
   twenty-eighth round on #1306). A positive verdict beside it still stands
   ("completed (run `X`) but the post-deploy probe failed"). */
const FAILED_RUN = /\b(failed|aborted|cancell?ed|refused|rejected|errored|crashed|timed out|deployed nothing|deploying nothing|no deployment|without deploying|did not deploy|never deployed)\b/gi;
const NEGATED_DONE = new RegExp('\\b(?:not|never|no longer|isn\'t|wasn\'t|hasn\'t|hadn\'t|didn\'t|weren\'t|haven\'t)\\b(?:\\s+(?:was|were|been|be|get|got))*\\s+(?:' + DONE_WORDS + ')\\b(?:\\s+(?:' + DONE_WORDS + ')\\b)*', 'gi');
const CHECK_DONE = new RegExp('\\b(?:' + CHECK_WORDS + ')\\b(?:\\s+(?:' + AUX_WORDS + ')\\b)*\\s+(?:' + DONE_WORDS + ')\\b(?:\\s+(?:' + DONE_WORDS + ')\\b)*'
    + '|\\b(?:' + DONE_WORDS + ')\\b(?:\\s+(?:' + DONE_WORDS + ')\\b)*\\s+(?:the |its |a |all )?(?:' + CHECK_WORDS + ')\\b', 'gi');
function firstIndex(re, text) {
    const m = text.match(re);
    return m ? m.index : -1;
}
function lastIndex(re, text) {
    const g = new RegExp(re.source, 'gi');
    let m, last = -1;
    while ((m = g.exec(text))) {
        last = m.index;
        if (!m[0].length) g.lastIndex++;
    }
    return last;
}
function recordsADispatch(log, k, len) {
    const scope = referenceScope(log, k, len);
    const span = log.slice(scope.from, scope.to);
    const rel = k - scope.from;
    const sep = /[.;!?](?=\s|$)/g;
    let cStart = 0, cEnd = span.length, m;
    while ((m = sep.exec(span))) {
        if (m.index < rel) cStart = m.index + 1;
        else if (m.index >= rel + len) { cEnd = m.index; break; }
    }
    const clause = span.slice(cStart, cEnd);
    if (/\bNOT DISPATCHED\b/i.test(clause)) return null;
    const before = span.slice(cStart, rel);
    const after = span.slice(rel + len, cEnd);
    /* Completion words about a check are not about the dispatch. */
    const norm = text => text.replace(CHECK_DONE, ' ').replace(NEGATED_DONE, ' NEGATED ').replace(FAILED_RUN, ' NEGATED ');
    /* PLANNING THE DISPATCH IS NOT PLANNING THE FOLLOW-UP. A forward-looking
       word makes a plan only when no completion word precedes it in the text
       considered: "completed successfully and will be smoke-tested tomorrow
       (run `X`)" is a completion, "will run `X` after approval" and "the next
       LANE dispatch (run `X`)" are plans (Codex, twenty-first and
       twenty-third rounds on #1306). */
    const plans = text => {
        const t = norm(text);
        const ahead = firstIndex(DISPATCH_AHEAD, t);
        if (ahead < 0) return false;
        const done = firstIndex(DISPATCH_DONE, t);
        return done < 0 || ahead < done;
    };
    const rm = after.match(/\brun\s+`?#?(\d{6,})/i);
    if (rm) {
        const pre = before + ' LANE ' + after.slice(0, rm.index);
        if (plans(pre)) return null;
        /* THE RUN ID BELONGS TO THE NEAREST PREDICATE BEFORE IT. After a check's
           phrase ("dry-run passed (run `X`)") or a bare check noun it is the
           check's run and proves no deployment; after the dispatch's own
           completion word ("dry-run passed, then the dispatch completed (run
           `X`)") it is the dispatch's (Codex, twenty-fourth round on #1306: a
           check noun anywhere in the clause used to discard the run id). */
        const marked = pre.replace(CHECK_DONE, ' CHECKDONE ');
        const lastCheck = Math.max(lastIndex(/\bCHECKDONE\b/, marked), lastIndex(CHECK_ONLY, marked));
        /* A negated verdict with no positive one anywhere in the clause ("was
           not completed (run `X`)", "(run `X`) was not completed") says the run
           deployed nothing, run id or not (Codex, twenty-seventh round on
           #1306). A positive verdict beside a negated one about something else
           ("completed (run `X`), but the smoke probe was not completed") stands. */
        const cleaned = norm(before + ' LANE ' + after);
        if (/\bNEGATED\b/.test(cleaned) && !DISPATCH_DONE.test(cleaned)) return null;
        if (lastCheck < 0 || lastIndex(DISPATCH_DONE, marked) > lastCheck) return { run: rm[1] };
    }
    const whole = before + ' LANE ' + after;
    if (plans(whole)) return null;
    if (DISPATCH_DONE.test(norm(whole))) return { run: '' };
    const lead = cStart > 0 ? span.match(/^[^.;!?]*?:\**(?=\s)/) : null;
    return lead && DISPATCH_DONE.test(norm(lead[0])) && !DISPATCH_AHEAD.test(lead[0]) && !/\bNOT DISPATCHED\b/i.test(lead[0]) ? { run: '' } : null;
}

/* THE CONCISE PROSE SHAPE, which produced no receipt at all. EXECUTION_LOG.md
   opens with one: "**Section 4 forward from `5a3365f2`, run `33434655418`,
   PASS.** `production-write` 62 → **63**, closure `a54b6bad…`. The other three
   were byte-identical redeploys." No table, no attestation block — so run
   33434655418 was simply ABSENT from this guard's picture of history. If the
   next dispatch is logged that way, the deploy before it stays `live` and its
   stale row exits 0. Codex P1 on #1253.

   These cannot be RECONSTRUCTED — "the other three were byte-identical" names
   no versions — so they are detected and left incomplete on purpose: the
   newest-receipt checks then fail them by name, which is the honest outcome and
   tells the writer what the entry is missing. */
function receiptsFromProse(log) {
    const out = [];
    const re = /\*\*Section 4 forward from `([0-9a-f]{7,40})`, run `(\d{6,})`[^*]*\*\*([\s\S]{0,600})/g;
    let m;
    while ((m = re.exec(log))) {
        const fns = {};
        const fre = /`([a-z-]+)`\s*(\d+)\s*(?:→|->)\s*\*\*(\d+)\*\*[\s\S]{0,40}?closure\s*`([0-9a-f]{64})`/g;
        let f;
        while ((f = fre.exec(m[3]))) {
            if (SLUGS.indexOf(f[1]) < 0) continue;
            fns[f[1]] = { version: f[3], closure: f[4].toLowerCase() };
        }
        out.push({
            at: m.index, source: 'concise prose', run: m[2], commit: m[1].toLowerCase(), fns,
        });
    }
    return out;
}

function executionLogReceipts() {
    const log = read('EXECUTION_LOG.md');
    const anchors = deployAnchors(log);
    const all = receiptsFromJson(log).concat(receiptsFromTables(log)).concat(receiptsFromProse(log));
    all.sort((a, b) => a.at - b.at);
    receiptsMeta.positions = all.map(r => r.at);
    for (const r of all) {
        const p = proseContext(log, r.at, anchors);
        r.run = r.run || p.run;
        r.commit = r.commit || p.commit;
        r.date = p.date || '';
        /* This receipt's own dispatch section first. The entry-wide fallback is
           allowed ONLY where the entry holds a single dispatch, because that is
           the shape where the two are the same text; in a multi-dispatch entry
           it is how deploy #4's bundle got presented as deploy #5's. */
        r.sealed = sealedBundleIn(deploySection(log, r.at, anchors))
            || (anchorsInEntry(log, r.at, anchors) > 1 ? null : sealedBundleIn(entryText(log, r.at)));
    }
    receiptsMeta.log = log;

    // Group by deployment identity, preferring the richer shape within a group.
    const byRun = new Map();
    const unidentified = [];
    receiptsMeta.conflicts = [];
    for (const r of all) {
        if (!r.run) { unidentified.push(r); continue; }
        const prev = byRun.get(r.run);
        if (!prev) { byRun.set(r.run, r); continue; }
        /* TWO RECEIPTS FOR ONE RUN MUST AGREE. The fold below keeps the richer
           shape and drops the other, which is right when both describe the same
           deploy (a table beside its own attestation). It is exactly wrong when
           a NEW deploy was written under an old entry without its own run id: it
           inherits that entry's run, disagrees with the surviving receipt on a
           version, and vanishes into the fold (Codex, twelfth round on #1306).
           So a disagreement on any function's version or closure is recorded
           and reported, whichever shape survives. */
        /* And they must name the SAME functions when both are structured
           shapes (an attestation block or a table). The concise-prose receipt
           legitimately names only what moved ("the other three were
           byte-identical redeploys"), so it is exempt from the keyset rule and
           held only to agreement on what it does name. */
        const structured = x => x.source === 'attestation block' || x.source === 'summary table';
        if (structured(prev) && structured(r)) {
            for (const slug of SLUGS) {
                if (!!prev.fns[slug] !== !!r.fns[slug]) {
                    receiptsMeta.conflicts.push({
                        run: r.run, slug, at: r.at,
                        kept: { source: prev.source, version: prev.fns[slug] ? prev.fns[slug].version : '(absent)' },
                        other: { source: r.source, version: r.fns[slug] ? r.fns[slug].version : '(absent)' },
                    });
                }
            }
        }
        for (const slug of SLUGS) {
            const a = prev.fns[slug], b = r.fns[slug];
            if (!a || !b) continue;
            if (a.version !== b.version || (a.closure && b.closure && a.closure !== b.closure)) {
                receiptsMeta.conflicts.push({
                    run: r.run, slug, at: r.at,
                    kept: { source: prev.source, version: a.version },
                    other: { source: r.source, version: b.version },
                });
            }
        }
        const rank = x => x.source === 'attestation block' ? 3 : x.source === 'summary table' ? 2 : 1;
        if (rank(r) > rank(prev)) byRun.set(r.run, r);
        else if (prev.source === r.source) prev.siblings = (prev.siblings || []).concat([r]);
    }
    const receipts = Array.from(byRun.values()).sort((a, b) => {
        const d = BigInt(a.run) - BigInt(b.run);
        return d < 0n ? -1 : d > 0n ? 1 : 0;
    });
    receipts.unidentified = unidentified;
    return receipts;
}

/* The log text, kept so main() can run the other-lane sweep without re-reading
   and re-parsing the file; and the position of every receipt it parsed, so the
   unreadable-entry sweep below can tell an entry with a receipt from one without. */
const receiptsMeta = { log: '', positions: [], parsedRows: new Set(), parsedJson: [], unreadableAttestations: [], conflicts: [], incompleteAttestations: [] };

/* A DEPLOY ENTRY THIS GUARD CANNOT READ IS A DEPLOY THIS GUARD CANNOT SEE.
   Codex P1 on #1306. On 2026-09-05 two forward deploys were logged with the
   slugs unquoted in the versions table, no run id in the heading and no
   attestation block -- none of the three receipt shapes above. Both parsed to
   nothing, the guard compared ROLLBACK.md against the previous receipt, and the
   Live State row sat two releases stale while this check exited 0.

   PER SECTION, NOT PER `##` ENTRY. Codex's second finding on the same PR: one
   `##` entry legitimately holds several deploys as `###` subsections (the
   2026-08-05 entry carries six), so a rule that accepted a whole entry because
   SOME receipt sat inside it let a malformed subsection ride on a readable
   sibling. Every heading of level 2-4 opens a section here, judged on its own:
     - a versions-table row in the section's own block (heading to the next
       heading of any level) that the strict table parser did not read -- a
       slug without backticks, a bold cell -- is a deploy record this guard is
       blind to, whatever the heading says and whatever else the block holds;
     - a heading that names a deploy, and names Section 4 itself OR sits under
       an ancestor heading that does, must have at least one parsed receipt
       somewhere in its SUBTREE (down to the next heading of the same or a
       higher level). So a container heading over readable subsections passes,
       a deploy heading with nothing readable under it does not, and -- Codex's
       third finding on #1306 -- a `### Deploy #40` written under a Section 4
       container with only prose beneath it is judged on its own rather than
       riding on a sibling's receipt through the parent. "NOT DISPATCHED" in the
       heading is the one exemption, the shape the log already uses for a
       deploy that did not happen.

   ONE way a finding is softened, table or heading alike: the section is dated
   strictly BEFORE the newest readable receipt, so it cannot be the newest
   deploy, cannot make the row stale, and is reported as a note rather than a
   failure. The log's own "Deploys #9-#13 —
   GAP" section (2026-08-05 entry) is exactly this: four of its five runs were
   never receipted and never will be, and failing on it forever would teach
   people to ignore this check. The entry date is the section's OWN `##`
   heading, whatever its level: a `##` heading dates itself, and a nested
   heading is dated by a date in ITS OWN text ("### Deploys #9-#13 — GAP,
   recorded retroactively 2026-08-18"), never by the `##` above it -- the
   2026-08-05 container holds subsections dated through 2026-08-19, so the
   parent's date says nothing about a child's (Codex, eighth round on #1306).
   A heading that names a run id at or past the newest receipt's is newer by
   construction (GitHub run ids increase) and is never softened. A section
   with no usable date of its own cannot be placed in time and is NOT
   softened.

   There is deliberately NO "readable by reference" softening. A first draft
   let a section pass when every run id it mentioned had a receipt elsewhere;
   Codex showed the obvious counter-example, `### Deploy #40 — supersedes run
   <known id>`, which mentions a receipted run while recording a deploy nobody
   can read. A mention is not an identity, and no text rule can tell "this is
   run X" from "this comes after run X". A heading that names a deploy carries
   its own receipt, or does not call itself a deploy. */
function unreadableDeployEntries(log, receiptPositions, newestDate, newestRun) {
    const out = [];
    /* A candidate versions-table row is any row whose first cell is one of the
       four slugs, quoted or not, bold or not, with at least two more cells. It
       is NOT required to carry a 64-hex closure: an abbreviated closure
       (`c7c6edce...`) is itself a reason the strict parser cannot read the row
       (Codex, eighth round). Rows are grouped by adjacency; a group in which no
       row was ACCEPTED BY receiptsFromTables is a table this guard is blind
       to. Whether a row was accepted is asked of the parser itself, by
       position, not re-derived here with a lookalike regex: the first draft's
       lookalike required the closure but not the numeric version the parser
       requires, so a row with a quoted slug, a full closure and a version of
       "unknown" made its whole group look readable while the parser had
       rejected every row (Codex, ninth round on #1306). EVERY row of a group
       has to have been accepted: a group with one accepted row and three the
       parser rejected is three rows of a deploy this guard cannot read, and the
       accepted row is no defence -- it inherits the entry's run id, folds into
       that run's existing receipt at deduplication, and vanishes (Codex, tenth
       round). Only the rejected rows are counted. The 2026-08-31 entry
       abbreviates one closure beside three full ones; it predates the newest
       receipt, so it is a note, as the GAP section is. */
    const candidateRow = /^[ \t]*\|\s*\**`?(batch-write|deliverable-write|linear-outbound|production-write)`?\**\s*\|[^|\n]*\|[^|\n]*\|/;
    /* A group must also name all four functions, once each. The §4 lane
       deploys the four as one serial set, so a table naming one or two of them
       is a truncated record -- and a truncated record whose rows all PARSE is
       the dangerous kind: it inherits the entry's run id, folds into that run's
       receipt, and disappears (Codex, twelfth round). Measured on the real log:
       17 groups, every one naming all four exactly once. */
    const unreadableTableRows = (block, blockStart) => {
        let rejected = 0;
        let truncated = 0;
        let group = [];
        let offset = 0;
        const flush = () => {
            if (group.length) {
                rejected += group.filter(g => !receiptsMeta.parsedRows.has(g.at)).length;
                const distinct = new Set(group.map(g => g.slug));
                if (distinct.size < SLUGS.length || distinct.size !== group.length) truncated += 1;
            }
            group = [];
        };
        for (const line of block.split('\n')) {
            const m = line.match(candidateRow);
            if (m) group.push({ at: blockStart + offset, slug: m[1] });
            else flush();
            offset += line.length + 1;
        }
        flush();
        return { rejected, truncated };
    };
    const heads = [];
    const hre = /^(#{2,6}) [^\n]*/gm;
    let m;
    while ((m = hre.exec(log))) heads.push({ at: m.index, level: m[1].length, text: m[0] });
    const within = (from, to) => receiptPositions.some(at => at >= from && at < to);
    const namesSection4 = text => /(Section 4|§4)/i.test(text) || SCHEMA_LINE.test(text);
    const ancestors = [];
    for (let i = 0; i < heads.length; i++) {
        const h = heads[i];
        while (ancestors.length && ancestors[ancestors.length - 1].level >= h.level) ancestors.pop();
        const underSection4 = ancestors.some(a => a.section4);
        const blockEnd = i + 1 < heads.length ? heads[i + 1].at : log.length;
        let treeEnd = log.length;
        for (let j = i + 1; j < heads.length; j++) {
            if (heads[j].level <= h.level) { treeEnd = heads[j].at; break; }
        }
        const block = log.slice(h.at, blockEnd);
        const tables = unreadableTableRows(block, h.at);
        const unreadableRows = tables.rejected;
        const truncatedTables = tables.truncated;
        const attestations = (receiptsMeta.unreadableAttestations || []).filter(u => u.at >= h.at && u.at < blockEnd).length;
        /* Section 4 may be named in the heading, in an ancestor heading, or --
           the concise-prose layout the top of this log uses -- only in the body
           ("**Section 4 forward from `<sha>`, run `<id>`**" under a generic
           "Deploy" heading). Codex, sixth round on #1306: a malformed entry in
           that layout named Section 4 nowhere a heading-only rule looked. A body
           that claims a Section 4 forward is deploy-shaped whatever its heading
           says. */
        const bodyClaimsForward = /Section 4 forward/i.test(block);
        /* What descendants inherit: Section 4 named in this heading OR in its
           own block body. Codex, seventh round on #1306: a generic "Deploys"
           container that named Section 4 only in its body passed that context
           to nobody, so an unreceipted `### Deploy #40` under it rode on a
           readable sibling again. */
        ancestors.push({ level: h.level, text: h.text, section4: namesSection4(h.text) || namesSection4(block) });
        const sectionFourHere = namesSection4(h.text) || underSection4 || namesSection4(block);
        /* A heading whose "deploy" is forward-looking is not a deploy record:
           "Built: ... (awaits migration + first deploy)" is an entry about code
           that has NOT shipped, and it names Section 4 in its body only to say
           which lane will carry it. Surfaced by the merge of #1310 during
           review of #1306. Only the bare future form counts ("deploy",
           "deployment", "not yet deployed", "to be deployed"): "Pending fixes
           deployed via F27 Section 4" records a deploy that happened (Codex,
           twenty-eighth round). "NOT DISPATCHED" is the same idea in the log's
           own words. */
        const deployAhead = /\b(awaits?|awaiting|pending|before|until|not yet|to be|planned|upcoming|will|would|without|ahead of)\b[^\n]{0,40}?\bdeploy(?:ment)?\b/i.test(h.text)
            || /\b(not yet|never|not|to be|will be|would be|yet to be|still to be)\s+(?:\w+\s+)?deployed\b/i.test(h.text);
        const headSaysDeploy = (bodyClaimsForward || (sectionFourHere && /deploy/i.test(h.text) && !deployAhead))
            && !/NOT DISPATCHED/i.test(h.text);
        const noReceiptUnder = headSaysDeploy && !within(h.at, treeEnd);
        if (!unreadableRows && !truncatedTables && !attestations && !noReceiptUnder) continue;
        const heading = h.text.replace(/^#+ /, '').slice(0, 120);
        const line = log.slice(0, h.at).split('\n').length;
        /* Dated by ITS OWN heading only, at any level; and a run id in the
           heading at or past the newest receipt's makes it newer whatever any
           date says. */
        const entryDate = validDate((h.text.match(/\b(\d{4}-\d{2}-\d{2})\b/) || [])[1] || '');
        const ownRun = (h.text.match(/[Rr]un\s+`?(\d{6,})`?/) || [])[1] || '';
        const runNewer = !!(ownRun && newestRun && Number(ownRun) >= Number(newestRun));
        const predates = !runNewer && !truncatedTables && !!entryDate && !!newestDate && entryDate < newestDate;
        out.push({
            line,
            heading,
            tableRows: unreadableRows,
            attestations,
            severity: predates ? 'note' : 'failure',
            message: (predates
                ? 'an unreadable Section 4 deploy section at line ' + line + ' ("' + heading + '") is dated by its own heading'
                    + ' before the newest readable receipt (' + entryDate + ' < ' + newestDate + '), so it cannot be the newest deploy and is'
                    + ' left as history; it is still invisible to this guard. '
                : '')
                +  'the EXECUTION_LOG.md section at line ' + line + ' ("' + heading + '") '
                + (unreadableRows
                    ? 'carries ' + unreadableRows + ' versions-table row(s) this guard cannot read'
                    : truncatedTables
                    ? 'carries ' + truncatedTables + ' versions table(s) that do not name all four functions once each -- a'
                        + ' truncated record, which the §4 lane never produces, and one whose parsed rows would otherwise inherit'
                        + ' this entry\'s run id and fold silently into its receipt'
                    : attestations
                    ? 'carries ' + attestations + ' attestation block(s) this guard cannot read (the fenced JSON names the ' + SCHEMA
                        + ' schema but does not parse, or is not the lane\'s shape with a functions array): a broken paste of a receipt'
                    : 'reads as a Section 4 deploy' + (namesSection4(h.text) ? ''
                        : underSection4 ? ' (under a Section 4 heading)' : ' (Section 4 named in its body)')
                        + ' but holds no receipt this guard can read, in it or under it')
                + ': quote the four slugs in the table (`production-write`, not production-write or'
                + ' **production-write**), put the run id in the heading as run `<id>`, write "dispatched from'
                + ' `<sha>`", and copy the lane\'s JSON attestation block; if the section is commentary about a'
                + ' deploy recorded elsewhere, do not call it a deploy. Until then the deploy it records is'
                + ' invisible here, which is exactly how the Live State row went two releases stale on 2026-09-05.',
        });
    }
    return out;
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
    for (const i of (receiptsMeta.incompleteAttestations || [])) {
        failures.push('an attestation block at character ' + i.at + ' of EXECUTION_LOG.md (run ' + (i.run || '?') + ') names '
            + i.named + ' of the four functions and omits ' + i.missing.join(', ') + '. The §4 lane attests all four, always;'
            + ' a block naming fewer is truncated or hand-written, and under another entry\'s run id it would fold into that'
            + ' run\'s receipt with the omitted function never compared. Copy the lane\'s full attestation.');
    }
    const says = v => (v === '(absent)' ? 'does not name it' : 'says v' + v);
    const an = s => (/^[aeiou]/i.test(s) ? 'an ' : 'a ') + s;
    for (const c of (receiptsMeta.conflicts || [])) {
        failures.push('two receipts claim run ' + c.run + ' but disagree on ' + c.slug + ': the ' + c.kept.source + ' '
            + says(c.kept.version) + ', ' + an(c.other.source) + ' at character ' + c.at + ' of EXECUTION_LOG.md ' + says(c.other.version)
            + '. A receipt that inherited an older entry\'s run id is a new deploy recorded without its own identity;'
            + ' give it its own heading with run `<id>` and "dispatched from `<sha>`".');
    }
    for (const u of unreadableDeployEntries(receiptsMeta.log, receiptsMeta.positions || [], live ? live.date : '', live ? live.run : '')) {
        if (u.severity === 'note') notes.push(u.message);
        else failures.push(u.message);
    }
    /* Second signal, because one is a single point of failure: the entry dates
       must agree with the run-id order about which deploy is newest. */
    if (live && !live.date) {
        /* The date is the SECOND chronology signal, and a check that quietly
           drops to one signal when the first is missing is a single point of
           failure wearing a belt. Codex P2 on #1253. */
        failures.push('the newest receipt (run ' + (live.run || '?') + ') sits under a heading with no'
            + ' usable YYYY-MM-DD date — absent, or shaped like one without being a real calendar day —'
            + ' so run-id order has nothing to be cross-checked against. Date that EXECUTION_LOG heading.');
    }
    if (live && live.date) {
        const laterByDate = receipts.filter(r => r.date && r.date > live.date);
        if (laterByDate.length) {
            failures.push('the newest receipt by run id (' + live.run + ', ' + live.date + ') is not the newest by'
                + ' date — ' + laterByDate.map(r => r.run + ' @ ' + r.date).join(', ')
                + '. The two chronology signals disagree, so which deploy is live cannot be established.');
        }
    }

    /* A DEPLOY THIS GUARD CANNOT READ IS NOT A DEPLOY THAT DID NOT HAPPEN.
       Codex P1 on #1253. The §4 lane is not the only workflow that deploys
       these functions, and the other one has already made this exact row stale
       once (ROLLBACK.md records it: "decayed again within three days … because
       the deploys went through the ONBOARDING lane"). Comparing against the
       newest §4 receipt while another lane has shipped since is agreement about
       the wrong deploy. */
    if (live) {
        for (const d of laneDispatchesSince(receiptsMeta.log, live.date || '', live.at, live.run || '')) {
            const where = d.unplaced
                ? 'the newest §4 receipt\'s own entry records a `' + d.lane + '` dispatch' + (d.name ? ' ("' + d.name + '")' : '')
                    + ' with no run id, which cannot be placed before or after the receipt (run ' + (live.run || '?') + ').'
                    + ' Add run `<id>` after the lane reference: older than the receipt\'s means the §4 deploy superseded it,'
                    + ' newer means the live versions may have moved.'
                : (d.date ? 'the ' + d.date + ' entry' : 'the undated section at line ' + d.line)
                    + ' records a `' + d.lane + '` dispatch' + (d.run ? ' (run ' + d.run + ')' : '')
                    + (d.name ? ' ("' + d.name + '")' : '') + ', at or after the newest §4 receipt (run '
                    + (live.run || '?') + ', ' + (live.date || 'undated') + ')'
                    + (d.newerRun ? '; its run id is newer than the receipt\'s, whatever heading it sits under' : '') + '.';
            failures.push(where + ' That lane deploys '
                + d.slugs.join(' and ') + ', and it does not emit the ' + SCHEMA
                + ' receipt this guard reads — so the live versions may have moved where this check'
                + ' cannot see it, which is the exact way this row went stale on 2026-08-27.'
                + ' Record that dispatch\'s live versions in the same entry (the lane prints them'
                + ' through scripts/ef-fingerprint.js) so the newest deploy is readable.');
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
            /* A receipt closure must actually BE a closure. Codex P1 on #1253:
               an attestation block naming all four functions but omitting one
               `source_closure_sha256` stored '', the shared prefix length came
               out zero, and two empty slices compared equal — so that
               function's closure was never checked and the guard exited 0. */
            if (!/^[0-9a-f]{64}$/.test(a.closure)) {
                failures.push(slug + ': the newest receipt records no usable source closure ('
                    + (a.closure ? a.closure : 'empty') + '), so ROLLBACK.md\'s ' + b.closure
                    + ' was not checked against anything');
            } else if (!/^[0-9a-f]{6,64}$/.test(b.closure)) {
                failures.push(slug + ': ROLLBACK.md records no usable closure for it');
            } else {
                const n = Math.min(a.closure.length, b.closure.length);
                if (a.closure.slice(0, n) !== b.closure.slice(0, n)) {
                    failures.push(slug + ': ROLLBACK closure ' + b.closure + ' does not prefix-match live ' + a.closure);
                }
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
        live: live ? { run: live.run, commit: live.commit, date: live.date || '', source: live.source, functions: live.fns } : null,
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
module.exports = { executionLogReceipts, rollbackClaim, deployAnchors, deploySection,
    sealedBundleIn, otherOwningLanes, laneDispatchesSince };
