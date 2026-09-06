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
        /* A SLUG NAMED TWICE IS NOT A RECEIPT. A five-row block whose second
           `production-write` row carries a stale version used to overwrite the
           first while still counting as four functions named, so malformed
           pasted evidence could certify a stale row (Codex, forty-second round
           on #1306). */
        const seen = new Set();
        let duplicated = false;
        for (const f of obj.functions) {
            if (!f || !f.slug) continue;
            if (seen.has(f.slug)) duplicated = true;
            seen.add(f.slug);
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
        if (duplicated) {
            receiptsMeta.unreadableAttestations.push({ at: b.from });
            continue;
        }
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
    /* A HEADING THAT NAMES A DIFFERENT ACTIVITY IS NOT A DEPLOY'S IDENTITY.
       "##### Verification run 33000000000" above a receipt's table would hand
       that receipt the verification's run id and file a real deploy under an
       older run (Codex, thirty-fourth round on #1306). Every deploy anchor in
       this log says so in its heading ("Deploy #4 — RECORDED (run `X`)",
       "F27 Section 4 deploy, run `X`"), so a heading that names a check and
       never says deploy is skipped. */
    const otherActivity = /\b(verification|verify|verifying|validation|validate|validating|drill|rehearsal|probe|smoke|audit|readback|read-back|confirmation|confirm|confirming|checks?|checking|checked|typecheck|lint|test run|dry[- ]run)\b/i;
    let m;
    while ((m = heading.exec(log))) {
        const line = m[0].split('\n')[0];
        /* "##### Post-deploy verification run `X`" names a check, and its
           "deploy" belongs to the phrase post-deploy, not to a deployment this
           heading records (Codex, forty-first round on #1306). The mention is
           removed before the heading is tested, as the sweep already does. */
        /* "##### Deployment verification run `X`" is the same phrase the other
           way round: the deploy word modifies the check and does not record a
           deployment of its own (Codex, fiftieth round on #1306), so it goes
           the same way before the heading is judged. */
        const named = line
            .replace(/\b(?:post|pre)[- ]?deploy(?:ment)?\b/gi, ' ')
            .replace(/\bdeploy(?:ment)?\s+(?=(?:verification|verify|validation|validate|confirmation|confirm|check|readback|read-back|audit|smoke|probe|drill|rehearsal|test)\b)/gi, ' ')
            .replace(/\b(?:verification|validation|confirmation|readback|read-back|audit|smoke test|probe|drill|rehearsal)\s+of\s+(?:the\s+)?deploy(?:ment)?\b/gi, ' verification ')
            /* And the verb-led form of the same phrase: "Verify deployment run
               `X`" is a check, not a deploy (Codex, fifty-first round). */
            .replace(/\b(?:verify|verifying|verified|validate|validating|validated|confirm|confirming|confirmed|test|testing|tested|re-?test(?:ing|ed)?|check|checking|checked|re-?check(?:ing|ed)?|audit|auditing|smoke[- ]?test(?:ing|ed)?|probe|probing|read[- ]?back)\s+(?:the\s+|this\s+)?deploy(?:ment)?\b/gi, ' verification ');
        /* AND A HEADING MUST SAY IT RECORDS A DEPLOY. Skipping the check
           words this guard happens to know left every other activity -- a
           capture, a rehearsal named something new -- accepted as an anchor
           merely for carrying a run id (Codex, sixtieth round on #1306). The
           test is now the other way round: a heading anchors a receipt when it
           says deploy, release, ship, rollout or cutover, or names Section 4;
           anything else is some other activity, whether or not this guard has
           a word for it. */
        /* A CHECK-LED HEADING IS A CHECK, WHATEVER ITS OBJECT SAYS. "Check
           deployed functions — run `X`" carries a deploy word in its object,
           not in what the heading records (Codex, sixty-first round on #1306),
           so the leading verb decides before any deploy word is read. */
        /* AND "DEPLOYED" AS AN ADJECTIVE DESCRIBES THE OBJECT, NOT THE ACT.
           "Inspect deployed functions — run `X`" says what is being looked at,
           so the word is dropped where it modifies a noun rather than governing
           a phrase ("deployed via", "deployed from" still record a deploy).
           Object-shaped, so no list of check verbs has to be complete (Codex,
           sixty-second round on #1306). */
        /* Any form of the word behaves the same way: "deployment
           configuration", "deployed functions" and "deploy plan" name a
           THING, while "deployed via", "deployed from" and a bare "deploy"
           before punctuation record the act (Codex, sixty-second and
           sixty-third rounds on #1306). */
        /* A SHIPPING VERB THAT LEADS THE HEADING GOVERNS ITS OBJECT: "Deploy
           production functions — run `X`" records the act, while "Inspect
           deployment configuration" names a thing (Codex, sixty-fifth round on
           #1306). So the object rule runs only on what does not lead. */
        const bare = named.replace(/^#+\s*/, '').replace(/^\d{4}-\d{2}-\d{2}\s*[—–-]*\s*/, '').trimStart();
        const leadsShipping = /^(?:(?:[a-z]+ly|now|already|just|then|finally|today|again)\s+)*(?:re-?)?(?:deploy|deployed|deploying|deploys|releas(?:e|ed|ing|es)|ship|shipped|shipping|rollout|roll out|rolled out|cut ?over)\b/i.test(bare);
        const objectless = leadsShipping ? named : named
            /* A NOUN FORM NAMES A THING: "Inspect deployment", "deployment
               configuration". A PARTICIPLE IS A PREDICATE unless it takes an
               object of its own: "Hotfix deployed — run `X`" records the act,
               "Inspect deployed functions" does not (Codex, sixty-eighth round
               on #1306). */
            .replace(/\b(?:deployment|deploy|rollout|release|cut ?over)\b(?!\s+(?:(?:was|is|are|were|has|have|had|been|got|went|goes|going|gone|came|comes)\s+)*(?:(?:now|already|finally|just|then|[a-z]+ly)\s+)*(?:complete|completed|succeeded|successful|finished|done|failed|green|live|out|up|via|from|to|by|on|at|in|into|through|with|as|after|before|during|the|this|run)\b)(?:\s+[a-z]+\b)?/gi, ' ')
            .replace(/\b(?:deployed|released|shipped|rolled out)\s+(?!via\b|from\b|to\b|by\b|on\b|at\b|in\b|into\b|through\b|with\b|as\b|after\b|before\b|during\b|the\b|this\b|run\b|[a-z]*ly\b|and\b|then\b|but\b)[a-z]+\b/gi, ' ');
        const leads = objectless.replace(/^#+\s*/, '').replace(/^\d{4}-\d{2}-\d{2}\s*[—–-]*\s*/, '').trimStart();
        if (/^(?:re-?)?(?:check|checking|checked|verify|verifying|verified|validate|validating|validated|confirm|confirming|confirmed|test|testing|tested|audit|auditing|probe|probing|read[- ]?back|smoke[- ]?test)\b/i.test(leads)) continue;
        const saysDeploy = /\b(?:re-?)?deploy|\b(?:re-?)?releas(?:e|ed|es|ing)\b|\bshipp?(?:ed|ing|s)?\b|\brollout\b|\broll(?:ed|ing)? out\b|\bcut ?over\b/i.test(objectless)
            || /(Section 4|§4)/i.test(objectless);
        if (!saysDeploy) continue;
        if (otherActivity.test(objectless) && !/\bdeploy/i.test(objectless)) continue;
        out.push({ at: m.index, run: m[1] });
    }
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
    /* TWO DIGESTS IN ONE ENTRY NAME TWO BUNDLES, and reading the first one is a
       coin toss: "Superseded sealed_bundle_sha256 = A" above "Current capture
       sealed_bundle_sha256 = B" used to certify A (Codex, sixty-fifth round on
       #1306). Where the entry does not say which is this deploy's, the entry
       has no readable bundle, so the row is asked to prove it rather than
       matched against a guess. */
    const shas = [...new Set([...t.matchAll(/(?:sealed|rollback)_bundle_sha256\s*=?\s*`?([0-9a-f]{64})/g)].map(m => m[1]))];
    if (shas.length > 1) return null;
    const sha = shas[0];
    const lens = [...new Set([...t.matchAll(/(?:rollback_bundle_)?byte_length\s*=?\s*`?(\d+)/g)].map(m => m[1]))];
    return sha ? { sha, bytes: lens.length === 1 ? lens[0] : '' } : null;
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
        /* A LANE THAT ONLY MOVES THESE FUNCTIONS WHEN A PERSON DISPATCHES IT.
           `deploy-onboarding-edge-functions` auto-deploys its own staff
           functions on a push to main, but the Track-B step that carries
           `production-write` and `linear-outbound` is gated on
           `github.event_name == 'workflow_dispatch'` -- the workflow says so
           itself: "A normal merge/push must never deploy that set." So a push
           run of that lane moves nothing this guard tracks (Codex,
           thirty-second round on #1306). Read from the workflow, never listed
           here: a step that loses its gate must make this guard stricter, not
           leave a stale exemption behind. */
        const steps = text.split(/\n(?=\s*- (?:name|id|uses|run):)/);
        const carrying = steps.filter(st => owned.some(sl => new RegExp('\\b' + sl + '\\b').test(st)) && /\brun:|\buses:/.test(st));
        const manualOnly = carrying.length > 0
            && carrying.every(st => /if:[^\n]*github\.event_name\s*==\s*'?"?workflow_dispatch/.test(st));
        out.push({ file: f, base: f.replace(/\.ya?ml$/, ''), name: nm ? nm[1].trim().replace(/^["']|["']$/g, '') : '', slugs: owned, manualOnly });
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
/* ANOTHER ATTEMPT'S EVIDENCE IS NOT THIS ONE'S, wherever it is read. One
   definition serves both readers: the dispatch reader and the unreadable-entry
   sweep had drifted apart, so a label fixed in one still slipped through the
   other (Codex, fifty-fourth round on #1306). */
/* The NOUN is not the signal, the modifier is: "the earlier execution",
   "the previous go", "the first pass" all hand the claim to something other
   than this run, and a list of nouns will always be one short (Codex,
   fifty-sixth round on #1306, asking for exactly this). So any noun after a
   modifier that points elsewhere counts, and a claim is read as this run's
   only when it names this run or points nowhere else at all. */
const OTHER_ATTEMPT = new RegExp(
    /* "failed" and "aborted" describe a state, not an order: "the failed
       deployment deployed nothing" is this run describing itself (Codex,
       sixty-first round on #1306), so they are not pointers on their own. */
    '\\b(?:the|a|an|that|its|their|our)\\s+(?:previous|earlier|prior|first|second|third|last|original|preceding|repeat|another|other|subsequent|later|initial)\\s+[a-z][\\w-]*\\b'
    /* Without a determiner, a word that is also a verb is not a modifier:
       "the dispatch failed without deploying any function" describes THIS
       run, so `failed` and `aborted` are read as pointers elsewhere only
       after "the", "that" and the like. */
    /* Unless the entry has already said it means THIS one: "this initial
       attempt failed without deploying any function" is the current run
       describing itself, and demanding a receipt for a zero-deploy failure
       is a false alarm (Codex, fifty-seventh round on #1306). */
    + '|(?<!\\bthis\\s)(?<!\\bcurrent\\s)\\b(?:previous|earlier|prior|original|preceding|another|other|subsequent|initial|repeat)\\s+[a-z][\\w-]*\\b'
    /* And whatever the modifier, a MODIFIED occurrence noun points elsewhere:
       "the follow-up attempt", "a second pass", "their later execution". The
       modifier space is open, so this branch closes it from the other side --
       any word standing between the determiner and the noun, unless it says
       the occurrence is this one (Codex, fifty-eighth round on #1306). */
    + '|\\b(?:the|a|an|that|its|their|our|some)\\s+(?!(?:current|latest|newest|same|very|only|present)\\b)(?:[a-z]+-[a-z]+|[a-z]+er|next|new|second|third|fourth|final|repeat|extra)\\s+(?:attempts?|runs?|dispatch(?:es)?|tr(?:y|ies)|jobs?|executions?|passes|pass|rounds?|cycles?|goes|go)\\b'
    /* And the same thing said the other way round: "the attempt before it",
       "the run after that", "the dispatch preceding this one" put the pointer
       AFTER the noun (Codex, fifty-ninth round on #1306). */
    /* A qualifier between the noun and its pointer changes nothing: "the
       attempt immediately before it" is the same reference (Codex, sixty-fourth
       round on #1306). */
    + '|\\b(?:attempts?|runs?|dispatch(?:es)?|tr(?:y|ies)|jobs?|executions?|passes|pass|rounds?|cycles?)(?:\\s+(?:just|immediately|right|directly|shortly|long|somewhat|closely))*\\s+(?:before|after|preceding|following|prior to|ahead of|behind|either side of)\\b'
    /* And "ago" points backwards as plainly as "before": "the attempt two
       runs ago deployed nothing" is that attempt's evidence (Codex,
       seventy-fourth round on #1306). */
    + '|\\b(?:attempts?|runs?|dispatch(?:es)?|tr(?:y|ies)|jobs?|executions?|passes|pass|rounds?|cycles?)\\b[^.\\n]{0,30}\\bago\\b'
    + '|\\b(?:retry|re-?run|redo)\\b', 'i');

function laneDispatchesSince(log, sinceDate, exemptAt, sinceRun) {
    const lanes = otherOwningLanes();
    if (!lanes.length) return [];
    const heads = headingsOf(log);
    const exempt = ownBlock(log, exemptAt);
    const found = [];
    const seen = new Set();
    for (const lane of lanes) {
        /* The lane named as a reference: its base or filename in backticks,
           its workflow name in quotes, its canonical Actions URL, or a
           Markdown link whose text names it. The repository's own convention
           for a lane is the direct workflow link, so a companion deploy
           recorded that way must be read (Codex, thirty-first round on #1306). */
        const esc = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const refs = [
            new RegExp('`' + esc(lane.base) + '`', 'g'),
            new RegExp('`' + esc(lane.file) + '`', 'g'),
            new RegExp('/actions/workflows/' + esc(lane.file) + '\\b', 'g'),
            new RegExp('\\[[^\\]\\n]*' + esc(lane.base) + '[^\\]\\n]*\\]\\(', 'g'),
        ].concat(lane.name ? [new RegExp('"' + esc(lane.name) + '"', 'g')] : []);
        for (const re of refs) {
            let rm;
            while ((rm = re.exec(log))) {
                const k = rm.index;
                const ev = recordsADispatch(log, k, rm[0].length);
                if (!ev) continue;
                /* A lane whose guarded step is dispatch-gated moves nothing
                   here on a push run, so a record that SAYS it was a push,
                   merge or auto run is not a companion deploy. Only an explicit
                   statement exempts it: a terse record of a real dispatch ("the
                   onboarding lane deployed `production-write`, run `X`") names
                   no trigger at all, and requiring positive dispatch evidence
                   would blind this guard to exactly the deploy it exists to
                   catch. Fails closed, as everything here does. */
                if (lane.manualOnly && pushRun(log, k, rm[0].length)) continue;
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
   from its bullet line to the line before the next bullet at its own
   indentation or shallower (a deeper bullet is its child), across blank lines
   as long as the paragraph after the blank is indented (Codex, seventeenth
   and thirtieth rounds). A paragraph at column zero after a blank line is
   the end of the list, not part of the item. */
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
    /* A HEADING'S RESULT IS THE PARAGRAPH BELOW IT. "## 2026-09-06 —
       `lane`" followed by "Completed successfully (run `X`)." is one record,
       and scoping the reference to the heading line alone dropped the verdict
       (Codex, seventy-first round on #1306). The scope stops at the next
       heading, so a section's later paragraphs stay out of it. */
    if (/^#{2,6}\s/.test(lines[idx].text)) {
        let b = idx;
        while (b + 1 < lines.length && isBlank(lines[b + 1].text)) b++;
        /* AND THROUGH THE WHOLE SECTION, not just the first paragraph under it:
           a heading, a paragraph describing the change, then "Completed
           successfully (run `X`)" is one record, and stopping at the first
           blank line lost the verdict (Codex, seventy-ninth round on #1306).
           The next heading still ends it. */
        while (b + 1 < lines.length && !/^#{1,6}\s/.test(lines[b + 1].text)) b++;
        return { from: lines[idx].from, to: lines[b].to };
    }
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
    /* Forwards to the line before the next bullet AT THE ITEM'S OWN INDENTATION
       OR SHALLOWER: a deeper bullet is the item's child and carries its result
       ("- `lane` dispatch:" then "  - Completed successfully (run `X`)."; Codex,
       thirtieth round on #1306). At a blank line, the item continues only if
       the next non-blank line is indented and not such a sibling. */
    const indentOf = t => (t.match(/^[ \t]*/) || [''])[0].length;
    const own = indentOf(lines[first].text);
    const sibling = t => isBullet(t) && indentOf(t) <= own;
    let last = idx;
    for (let j = idx + 1; j < lines.length; j++) {
        const t = lines[j].text;
        if (sibling(t)) break;
        if (isBlank(t)) {
            let n = j + 1;
            while (n < lines.length && isBlank(lines[n].text)) n++;
            if (n >= lines.length || sibling(lines[n].text) || !isIndented(lines[n].text)) break;
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
const AHEAD_WORDS = 'until|pending|awaiting|await|next|future|upcoming|planned|planning|scheduled|scheduling|queued|to run|will|would|not yet|owed|instead of|rather than|to be dispatched|without (?:a |the |any |ever )?(?:LANE )?(?:dispatch|dispatching|run|running)';
/* Checks that are not deployments: a completion word about one of these
   ("dry-run passed", "validation succeeded", "passed the typecheck") says
   nothing about the dispatch, and a run id that follows one of these is the
   check's run (Codex, twenty-third round on #1306). */
/* The nouns a routine check goes by. Verification, confirmation and readback
   wording was missing, so "the LANE verification passed (run `X`)" read as a
   deployment and a routine check could block an otherwise-correct rollback
   update (Codex, fifty-fifth round on #1306). */
const CHECK_WORDS = 'dry[- ]?runs?|validations?|validated?|verifications?|verified|confirmations?|checks?|checking|checked|read[- ]?backs?|audits?|plan[- ]only|plan mode|previews?|no-?ops?|typechecks?|lint|smoke[- ]?tests?|probes?';
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
/* "AS PLANNED" LOOKS BACK, NOT FORWARD. "As planned, the LANE manual
   dispatch completed successfully (run `X`)" records a deploy that happened;
   the planning word only says it went the way it was meant to (Codex,
   thirty-fifth round on #1306). Removed before a clause is read so it can
   neither make a plan nor hide one. Module scope because the unreadable-entry
   sweep reads result sentences the same way (eightieth round). */
const RETROSPECTIVE = /\b(?:just |exactly |right )?as (?:planned|scheduled|expected|intended|arranged|agreed)\b/gi;
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
/* Does the record at k say the RUN IT NAMES was a push, merge or automatic one
   rather than a dispatch? Judged on the reference's own clause, never the whole
   scope: "the `lane` manual dispatch completed successfully (run `X`) after the
   previous push run failed" records a real dispatch, and the unrelated push
   beside it must not discard it (Codex, thirty-third round on #1306). A clause
   that names any dispatch marker at all is never exempted, so an ambiguous
   record fails closed. */
function pushRun(log, k, len) {
    const clause = referenceClause(log, k, len);
    if (/\b(dispatch|dispatched|dispatching|workflow_dispatch|manual|manually|owner-dispatched|re-run|rerun)\b/i.test(clause)) return false;
    /* THE COMMIT A RUN DEPLOYED FROM IS NOT ITS TRIGGER. Manual Track-B
       dispatches are pinned to a commit, so "completed successfully from
       commit `<sha>`" says nothing about how the run started (Codex,
       forty-first round on #1306). Only push and merge wording counts. */
    return /\bpush[- ]?(run|deploy|deployed|deployment|build|triggered)\b/i.test(clause)
        || /\b(on|from|by) (?:a |the )?(?:push|merge)\b/i.test(clause)
        || /\b(auto-deploy|auto-deployed|automatic(?:ally)? (?:deploy|deployed|ran|run)|merge run|push to main)\b/i.test(clause);
}

/* The sentence around a reference, inside its item or paragraph. */
function referenceClause(log, k, len) {
    const scope = referenceScope(log, k, len);
    const span = log.slice(scope.from, scope.to);
    const rel = k - scope.from;
    const sep = /[.;!?](?=\s|$)/g;
    let cStart = 0, cEnd = span.length, m;
    while ((m = sep.exec(span))) {
        if (m.index < rel) cStart = m.index + 1;
        else if (m.index >= rel + len) { cEnd = m.index; break; }
    }
    return span.slice(cStart, cEnd);
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
    /* A FAILED RUN IS SILENT ONLY WHEN IT PROVES IT SHIPPED NOTHING. The
       onboarding lane deploys its functions one after another, so a run that
       "failed after deploying `production-write`" or "failed while deploying
       `production-comments`" is past both guarded functions and left them live
       (Codex, thirty-ninth and fortieth rounds on #1306: naming a guarded slug
       was too narrow a test, because the step it died on need not be one of
       the four). Failure wording is a negation only where the record says the
       whole run deployed nothing; otherwise the run is read like any other and
       its dispatch stands. */
    const NOTHING_SHIPPED = /\b(no deployment|nothing (?:was )?deployed|deployed nothing|no function(?:s)? (?:were|was) deployed|without deploying|did not deploy|never deployed|before any (?:mutation|deploy)\b|before any functions?\b(?!\s+[a-z])|before (?:it|they|we|the run|the lane|the job) could deploy|before deploying)\b(?![^.\n]{0,40}\b(?:of the |for the )?(?:remaining|other|rest|further|additional|subsequent|later|three|two|second)\b)(?!\s+(?:the\s+)?`?[a-z][a-z0-9]*(?:-[a-z0-9]+)+`?)/i;
    /* AND THE CLAIM HAS TO BE ABOUT THIS ATTEMPT. "the current run `X` failed,
       while the previous attempt deployed nothing" used to negate the current
       failure with the older attempt's evidence (Codex, fiftieth round on
       #1306), so a clause that hands the claim to another attempt does not
       silence this one. */
    /* AND A CLAIM THAT NAMES A RUN BELONGS TO THAT RUN. "the current run `X`
       failed, while run `Y` deployed nothing" carries no other-attempt word at
       all, and the second clause is about `Y` (Codex, sixty-fifth round on
       #1306), so run ids decide where the words do not. */
    const wholeRunSilent = t => {
        /* A CONTRAST CLAUSE IS ABOUT SOMETHING ELSE. The pieces are marked so a
           claim that follows "while", "but" or "whereas" can be held to a
           stricter test than one continuing the same sentence (Codex,
           sixty-eighth round on #1306). */
        const marked = t.replace(/,\s*(?:while|whereas|although|though|but)\s/g, '\u0001');
        const pieces = marked.split(/[.;]\s/).flatMap(sent => sent.split('\u0001')
            .map((c, i) => ({ text: c, contrast: i > 0 })));
        const clauses = pieces.map(p => p.text);
        const runIn = c => (c.match(/\brun\s+`?#?(\d{6,})`?/) || [])[1] || '';
        /* The failure VERBS only: FAILED_RUN also carries the no-deployment
           wording, and a clause matching itself would make every claim its own
           run's. */
        const failedRuns = clauses
            .filter(c => /\b(failed|aborted|cancell?ed|refused|rejected|errored|crashed|timed out)\b/i.test(c))
            .map(runIn)
            .filter(Boolean);
        return pieces.some(({ text: clause, contrast }) => {
            if (!NOTHING_SHIPPED.test(clause) || OTHER_ATTEMPT.test(clause)) return false;
            const said = runIn(clause);
            if (!said) return true;
            /* And a claim that names a run cannot answer a failure that named
               none: "the current run failed, while run `Y` deployed nothing" is
               about `Y` (Codex, sixty-sixth round on #1306). */
            const unnumberedFailure = clauses.some(c =>
                /\b(failed|aborted|cancell?ed|refused|rejected|errored|crashed|timed out)\b/i.test(c)
                && !runIn(c));
            /* An unnumbered failure is unnumbered whatever noun it uses -- "the
               current deployment failed" as much as "the current run failed"
               (Codex, sixty-eighth round) -- but only a CONTRAST clause is
               about something else: "refused on the ancestry check; no
               deployment occurred in run `X`" continues the same sentence about
               the same run. */
            if (contrast && unnumberedFailure) return false;
            return !failedRuns.length || failedRuns.includes(said);
        });
    };
    const norm = text => {
        const t = text.replace(RETROSPECTIVE, ' ').replace(CHECK_DONE, ' ').replace(NEGATED_DONE, ' NEGATED ');
        return wholeRunSilent(t) ? t.replace(FAILED_RUN, ' NEGATED ') : t;
    };
    /* PLANNING THE DISPATCH IS NOT PLANNING THE FOLLOW-UP. A forward-looking
       word makes a plan only when no completion word precedes it in the text
       considered: "completed successfully and will be smoke-tested tomorrow
       (run `X`)" is a completion, "will run `X` after approval" and "the next
       LANE dispatch (run `X`)" are plans (Codex, twenty-first and
       twenty-third rounds on #1306). */
    /* AN INTRODUCTORY CLAUSE DOES NOT GOVERN THE DISPATCH. "Originally
       scheduled for Monday, the LANE manual dispatch completed successfully
       (run `X`)" records a deploy: the scheduling language is set off before
       the reference and describes how the run came to be, not what is still
       to come (Codex, thirty-sixth round on #1306). So a leading phrase that
       ends in a comma before the reference is dropped before the clause is
       judged. "The LANE dispatch, scheduled for Monday, will run then" keeps
       its forward reading, because there the reference comes first. */
    /* A PLANNING ADJECTIVE IS NOT A FORWARD PREDICATE. "The planned LANE
       manual dispatch completed successfully (run `X`)" records a deploy: the
       adjective describes the run that has now happened (Codex, thirty-seventh
       round on #1306). "the NEXT LANE dispatch" keeps its forward reading,
       because next says the run is still to come. */
    const ADJECTIVAL = /\b(?:planned|scheduled|proposed|intended|anticipated|agreed|expected)\s+(?=(?:\w+[- ]){0,3}(?:LANE|dispatch|deploy|deployment|release|run\b))/gi;
    const dropIntro = text => {
        const at = text.indexOf('LANE');
        const cut = text.lastIndexOf(',', at < 0 ? text.length : at);
        return cut > 0 ? text.slice(cut + 1) : text;
    };
    /* AN APPOSITIVE SAYS WHEN IT WAS PLANNED, NOT THAT IT IS STILL TO COME.
       "The LANE manual dispatch, scheduled for Monday, completed successfully
       (run `X`)" is a completed dispatch: the clause between the commas dates
       the plan behind a run that has since finished (Codex, forty-eighth round
       on #1306). Only a clause with no predicate of its own is dropped. */
    const APPOSITIVE = /,\s*(?:originally\s+|initially\s+|previously\s+)?(?:scheduled|planned|slated|booked|expected|intended|due)\s+(?:for|on|to run|to go)\b[^,.\n]*,/gi;
    const plans = text => {
        const t = dropIntro(norm(text)).replace(APPOSITIVE, ' ').replace(ADJECTIVAL, ' ');
        const ahead = firstIndex(DISPATCH_AHEAD, t);
        if (ahead < 0) return false;
        const done = firstIndex(DISPATCH_DONE, t);
        return done < 0 || ahead < done;
    };
    /* THE RUN ID BELONGS TO THE NEAREST PREDICATE BEFORE IT. After a check's
       phrase ("dry-run passed (run `X`)") or a bare check noun it is the
       check's run and proves no deployment; after the dispatch's own
       completion word ("dry-run passed, then the dispatch completed (run
       `X`)") it is the dispatch's (Codex, twenty-fourth round on #1306: a
       check noun anywhere in the clause used to discard the run id). A
       negated verdict with no positive one anywhere in the clause ("was not
       completed (run `X`)", "(run `X`) was not completed") says the run
       deployed nothing, run id or not (twenty-seventh round); a positive
       verdict beside a negated one about something else ("completed (run
       `X`), but the smoke probe was not completed") stands. Returns the
       evidence, null for a plan or a non-deployment, or undefined when the run
       id is a check's and the clause must be read without it. */
    const judgeRun = (runId, pre) => {
        if (plans(pre)) return null;
        const marked = pre.replace(CHECK_DONE, ' CHECKDONE ');
        const lastCheck = Math.max(lastIndex(/\bCHECKDONE\b/, marked), lastIndex(CHECK_ONLY, marked));
        const cleaned = norm(before + ' LANE ' + after);
        if (/\bNEGATED\b/.test(cleaned) && !DISPATCH_DONE.test(cleaned)) return null;
        /* AND THE ID MUST BE THIS DISPATCH'S. "the current run failed, while run
           `Y` deployed nothing" names `Y` for the OTHER run, so adopting it
           would file this failure under an older dispatch and hide it (Codex,
           sixty-sixth round on #1306). With no id of its own the record is
           judged by its date, which is what an unplaceable dispatch deserves. */
        const failedBefore = /\b(failed|aborted|cancell?ed|refused|rejected|errored|crashed|timed out)\b/i.test(pre)
            && !/\d{6,}/.test(pre)
            /* Only across a contrast: "failed after deploying `production-write`
               (run `X`)" keeps its own id, while "the current deployment failed,
               while run `Y` ..." does not own `Y`. */
            && /,\s*(?:while|whereas|although|though|but)\s/i.test(pre);
        if (lastCheck < 0 || lastIndex(DISPATCH_DONE, marked) > lastCheck) return { run: failedBefore ? '' : runId };
        return undefined;
    };
    const rm = after.match(/\brun\s+`?#?(\d{6,})/i);
    if (rm) {
        const pre = before + ' LANE ' + after.slice(0, rm.index);
        /* And the rest of the clause still counts: "run `X` is scheduled for
           tomorrow after approval" puts its forward language AFTER the run id
           (Codex, forty-second round on #1306). It makes a plan only where no
           completion precedes the run id, so "went out (run `X`), which will
           need a fresh capture" is unaffected. */
        /* In the text after the run id, ORDER decides as it does before it:
           "run `X` completed successfully, while the next dispatch is
           scheduled for tomorrow" completes this run and plans another
           (Codex, forty-third round on #1306). It is a plan only where the
           forward word comes first. */
        const post = norm(after.slice(rm.index));
        const postAhead = firstIndex(DISPATCH_AHEAD, post);
        const postDone = firstIndex(DISPATCH_DONE, post);
        const r = (firstIndex(DISPATCH_DONE, norm(pre)) < 0
            && postAhead >= 0 && (postDone < 0 || postAhead < postDone))
            ? null
            : judgeRun(rm[1], pre);
        if (r !== undefined) return r;
    } else {
        /* THE BINDING FORM puts the run before the lane and ties them with a
           preposition: "Run `X` of `lane` completed successfully" (Codex,
           thirty-first round on #1306). The run is the lane's; the verdict
           follows the lane, so forward-looking words after it still make a
           plan ("Run `X` of `lane` is scheduled for tomorrow"). */
        /* A preposition binds the run to the lane, and so does punctuation:
           "Run `X`: the LANE manual dispatch completed successfully" (Codex,
           forty-fifth round on #1306). */
        const bind = before.match(/\brun\s+`?#?(\d{6,})`?\s+(?:of|for|on|by|in|from|through|via)\s+(?:the\s+|this\s+|that\s+)?(?:[\w-]+\s+){0,2}$/i)
            || before.match(/\brun\s+`?#?(\d{6,})`?\s*[:,—–-]\s*(?:the\s+|this\s+|that\s+)?(?:[\w-]+\s+){0,3}$/i);
        if (bind) {
            const r = judgeRun(bind[1], before.slice(0, bind.index) + ' LANE ' + after);
            if (r !== undefined) return r;
        }
    }
    const whole = before + ' LANE ' + after;
    if (plans(whole)) return null;
    if (DISPATCH_DONE.test(norm(whole))) return { run: '' };
    /* A FAILURE THAT SAYS WHAT IT DEPLOYED IS STILL A DISPATCH. "the LANE
       dispatch failed after deploying `production-write`" moved a guarded
       function and carries no run id, so it is placed by its date rather than
       dropped for having no completion word (Codex, sixty-ninth round on
       #1306). */
    /* Named or counted, the record says a function moved: "failed after
       deploying the first function" is the same evidence as naming it
       (Codex, seventieth round on #1306). */
    if (new RegExp('\\b(?:failed|aborted|cancell?ed|refused|rejected|errored|crashed|timed out)\\b[^.\\n]{0,80}\\bdeploy(?:ed|ing|s)?\\b[^.\\n]{0,40}(?:`?(?:' + SLUGS.join('|') + ')`?|(?:the\\s+)?(?:first|second|third|one|two|three|1st|2nd|3rd)\\s+functions?)', 'i').test(whole)) return { run: '' };
    const lead = cStart > 0 ? span.match(/^[^.;!?]*?:\**(?=\s)/) : null;
    if (lead && DISPATCH_DONE.test(norm(lead[0])) && !DISPATCH_AHEAD.test(lead[0]) && !/\bNOT DISPATCHED\b/i.test(lead[0])) return { run: '' };
    /* A BARE LABEL TAKES THE SENTENCE THAT FOLLOWS IT AS ITS RESULT: "- `lane`
       dispatch. Completed successfully (run `X`)." is one record split at a
       period (Codex, twenty-ninth round on #1306). Only when the clause carries
       no verdict of its own, and only when the next sentence, inside the same
       item or paragraph, opens with a verdict rather than a subject of its own
       ("Smoke probe completed successfully" is about the probe). */
    if (!/\bNEGATED\b/.test(norm(whole)) && !CHECK_ONLY.test(whole)) {
        const opensWithVerdict = new RegExp('^(?:(?:it|this|that|which|was|were|is|has|had|been|also|then|all|not|never)\\s+)*(?:' + DONE_WORDS + '|NOT DISPATCHED|' + AHEAD_WORDS.replace(/LANE /g, '') + '|failed|aborted|cancell?ed|refused|rejected|errored|crashed|timed out)\\b', 'i');
        /* AND CONTEXT MAY STAND BETWEEN THE LABEL AND ITS RESULT. Reading only
           the FIRST sentence after the reference dropped the record whenever
           two sentences of context preceded "Completed successfully (run `X`)",
           so a lane that can move `production-write` went unseen and the stale
           row exited 0 (Codex, eightieth round on #1306). The scan runs on
           through the section to the first sentence that OPENS with a verdict,
           which is what makes it this label's result rather than a statement
           about something else -- "Smoke probe completed successfully" still
           opens with a subject of its own and is still passed over. */
        let rest = span.slice(cEnd + 1);
        let next = '';
        while (rest.trim()) {
            const nm = rest.match(/[.;!?](?=\s|$)/);
            const cand = (nm ? rest.slice(0, nm.index) : rest).replace(/^\s*(?:Result|Outcome|Status|Verdict)\s*:\s*/i, '').trim();
            rest = nm ? rest.slice(nm.index + 1) : '';
            if (cand && opensWithVerdict.test(cand)) { next = cand; break; }
        }
        if (next) {
            if (/\bNOT DISPATCHED\b/i.test(next)) return null;
            const nrm = next.match(/\brun\s+`?#?(\d{6,})/i);
            if (nrm && !plans(next.slice(0, nrm.index)) && !/\bNEGATED\b/.test(norm(next))) return { run: nrm[1] };
            if (plans(next) || /\bNEGATED\b/.test(norm(next))) return null;
            if (DISPATCH_DONE.test(norm(next))) return { run: '' };
        }
    }
    return null;
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
        /* AND ON THE COMMIT THEY DEPLOYED FROM. Two receipts for one run that
           name different commits cannot both be right, and preferring the
           attestation silently discarded the disagreement (Codex,
           seventy-third round on #1306). The commit is provenance this guard
           checks against the row, so a conflict in it is reported like any
           version conflict. */
        /* An abbreviated sha and the full one name the same commit, so they
           are compared over the shorter one's length (Codex, seventy-fifth
           round on #1306, catching the false alarm the comparison itself
           introduced). */
        const sameCommit = (x, y) => {
            const n = Math.min(x.length, y.length);
            return n >= 7 && x.slice(0, n).toLowerCase() === y.slice(0, n).toLowerCase();
        };
        if (prev.commit && r.commit && !sameCommit(prev.commit, r.commit)) {
            receiptsMeta.conflicts.push({
                run: r.run, slug: 'deploy commit', at: r.at,
                kept: { source: prev.source, version: prev.commit.slice(0, 8) },
                other: { source: r.source, version: r.commit.slice(0, 8) },
            });
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
        /* A LEADING TEMPORAL PHRASE DOES NOT MAKE THE DEPLOY FORWARD-LOOKING.
           "Before lunch, F27 Section 4 deployment completed, run `X`" records a
           deploy that happened; the "before" belongs to the time of day, not to
           the deployment (Codex, thirty-ninth round on #1306). The same rule
           the lane parser applies to introductions: a leading phrase ending in
           a comma, ahead of the shipping word, is dropped before the heading is
           judged. */
        const headMain = (() => {
            const w = h.text.search(/\b(?:deploy|releas|shipp|rollout|cutover)/i);
            const cut = w > 0 ? h.text.lastIndexOf(',', w) : -1;
            return cut > 0 ? h.text.slice(cut + 1) : h.text;
        })();
        const deployAhead = /\b(awaits?|awaiting|pending|before|until|not yet|to be|planned|upcoming|will|would|without|ahead of)\b[^\n]{0,40}?\b(?:deploy(?:ment)?|release|ship|rollout|cutover)\b/i.test(headMain)
            || /\b(not yet|never|not|to be|will be|would be|yet to be|still to be)\s+(?:\w+\s+)?deployed\b/i.test(headMain)
            /* and the plan noun after the deployment noun: "deployment plan
               approved for tomorrow" (Codex, thirty-first round on #1306). */
            || /\bdeploy(?:ment)?\s+(?:plan|planning|schedule|proposal|checklist|readiness|rehearsal|preview|window|slot)\b/i.test(headMain)
            /* and the forward word after the shipping noun: "release planned
               for Monday", "cutover scheduled" (Codex, thirty-fifth round). */
            || /\b(?:deploy(?:ment)?|releas(?:e|ing)|shipping|rollout|cutover)\s+(?:is |was |has been |to be )?(?:planned|planning|scheduled|proposed|pending|upcoming|awaited|owed)\b/i.test(headMain);
        /* A DEPLOY THAT FAILED WITHOUT DEPLOYING ANYTHING CANNOT HAVE A
           RECEIPT, and the log keeps those attempts as history (run #37 on
           2026-09-05 is one). Both halves are required -- a failure word AND an
           explicit statement that nothing shipped -- so a PARTIAL deploy, which
           does move live versions, still fails closed (Codex, thirty-second
           round on #1306). */
        /* The heading ENDS a sentence: with only a newline between them, a
           body claim inherited the heading's run id and answered for it
           (Codex, seventy-first round on #1306). */
        const entryText = h.text.replace(/\s*$/, '') + '.\n' + block.replace(/^\s*#{1,6}[^\n]*\n?/, '');
        const headRunEarly = (h.text.match(/[Rr]un\s+`?#?(\d{6,})`?/) || [])[1] || '';
        /* The no-deployment claim has to cover the WHOLE run. "No deployment of
           the remaining three functions occurred" is a claim about a subset,
           and the run that says it moved one function already (Codex,
           thirty-third round on #1306). Two ways it fails to cover: the claim
           is qualified by a subset word, or the entry says somewhere that one
           of the four WAS deployed. Either way the entry is asked for its
           receipt, because a partial deploy moved a live version. */
        const NOTHING_HERE = /\b(no deployment|nothing (?:was )?deployed|deployed nothing|no function(?:s)? (?:were|was) deployed|without deploying|did not deploy|before any (?:mutation|deploy)\b|before any functions?\b(?!\s+[a-z])|before (?:it|they|we|the run|the lane|the job) could deploy|before deploying)\b(?![^.\n]{0,40}\b(?:of the |for the )?(?:remaining|other|rest|further|additional|subsequent|later|three|two|second)\b)(?!\s+(?:the\s+)?`?[a-z][a-z0-9]*(?:-[a-z0-9]+)+`?)/i;
        /* AND IT HAS TO BE ABOUT THIS RUN. An entry that keeps a previous
           attempt's history ("The current attempt failed (run `X`). The
           previous attempt deployed nothing (run `Y`).") used to borrow that
           older sentence as its own proof (Codex, forty-ninth round on #1306),
           so a claim is read only where it names this heading's run or names
           no run at all. */
        const nothingShipped = entryText.split(/(?<=[.!?])\s|\n{2,}|,\s*(?:while|whereas|although|though|but)\s/).some(sentence => {
            if (!NOTHING_HERE.test(sentence)) return false;
            /* Naming no run is not the same as describing this one: "The
               previous attempt deployed nothing" is another attempt's evidence
               whether or not it carries a run id (Codex, fifty-second round on
               #1306). */
            if (OTHER_ATTEMPT.test(sentence)
                && !new RegExp('\\b(?:this|the current|current)\\s+(?:attempt|run)\\b', 'i').test(sentence)) {
                const named = (sentence.match(/\brun\s+`?#?(\d{6,})`?/) || [])[1] || '';
                if (!named || (headRunEarly && named !== headRunEarly)) return false;
            }
            const said = (sentence.match(/\brun\s+`?#?(\d{6,})`?/) || [])[1] || '';
            return !said || !headRunEarly || said === headRunEarly;
        });
        /* THE FORMATTING OF THE SHIPPED FUNCTION MUST NOT DECIDE THIS. Reading
           only backticked slugs paired with `deployed`/`deploys` let "failed
           after deploying production-write. No deployment occurred after that
           point" keep its exemption, so a partial live deploy stayed
           unreceipted (Codex, forty-sixth round on #1306). The slug is read
           quoted or bare, and the verb in every form it takes. */
        const SLUG_RE = '`?(?:' + SLUGS.join('|') + ')`?\\b';
        const DEPLOY_VERB = '\\bdeploy(?:ed|s|ing|ment of)?\\b';
        /* AND THE VERB NEED NOT BE "DEPLOY". "failed after the first function
           went live" is a partial deploy stated in the lane's own serial terms
           (Codex, forty-eighth round on #1306), so going live, shipping and
           being released count, whether the function is named or counted. */
        const LIVE_VERB = '(?:went|gone|going|was|were|is|are|had gone)\\s+live|shipped|ship|shipping|releas(?:ed|ing)|rolled out';
        const someShipped = new RegExp(DEPLOY_VERB + '[^.\\n]{0,60}' + SLUG_RE, 'i').test(entryText)
            || new RegExp(SLUG_RE + '[^.\\n]{0,60}\\b(?:was |were |had been |been )?deploy(?:ed|s|ing)?\\b', 'i').test(entryText)
            || new RegExp(SLUG_RE + '[^.\\n]{0,60}\\b(?:' + LIVE_VERB + ')\\b', 'i').test(entryText)
            || new RegExp('\\b(?:the\\s+)?(?:first|second|third|one|two|three|1st|2nd|3rd|an? )\\s*functions?\\b[^.\\n]{0,40}\\b(?:' + LIVE_VERB + '|(?:was |were |had been |been )?deploy(?:ed|s|ing)?)\\b', 'i').test(entryText);
        /* AND IT MUST DESCRIBE THIS DEPLOY. A successful entry that keeps the
           history of an earlier attempt ("Completed successfully. The previous
           attempt failed; no deployment occurred in run `Y`.") used to exempt
           itself with another run's failure (Codex, forty-fifth round on
           #1306). Two ways it fails to describe this one: the entry claims a
           completion of its own, or the failure names a run that is not this
           heading's. */
        const claimsCompletion = /\b(completed|succeeded|success|successful|successfully|shipped|went out|green|PASS)\b/i
            /* The failure clause ENDS at the conjunction that turns the
               sentence: "The initial job failed but the re-run completed
               successfully" claims a completion, and swallowing the rest of
               the sentence hid it (Codex, fifty-first round on #1306). */
            .test(entryText.replace(new RegExp(FAILED_RUN.source + '[^.\n]*?(?=\\b(?:but|yet|although|though|whereas|while|then|before|after|and then|so)\\b|[.\\n]|$)', 'gi'), ' '));
        const failureRuns = [...entryText.matchAll(new RegExp('(?:' + FAILED_RUN.source + '|no deployment|nothing (?:was )?deployed)[^.\n]{0,120}?\\brun\\s+`?#?(\\d{6,})', 'gi'))]
            .map(m => m[m.length - 1]);
        const failureIsOurs = !failureRuns.length
            || failureRuns.some(r => !headRunEarly || r === headRunEarly);
        const failedNothing = new RegExp(FAILED_RUN.source, 'i').test(entryText)
            && nothingShipped && !someShipped && !claimsCompletion && failureIsOurs;
        /* "##### Post-deploy verification" is commentary ABOUT a deploy, not a
           record of one, and its subtree has no receipt of its own by nature
           (Codex, thirty-fourth round on #1306). The post/pre-deploy mention is
           removed before the heading is tested, so a heading that also names a
           deploy some other way still counts. */
        const headDeployWords = h.text.replace(/\b(?:post|pre)[- ]?deploy(?:ment)?\b/gi, ' ');
        /* "F27 Section 4 release, run `X`" ships the same four functions and
           says so without the word deploy (Codex, thirty-fifth round on
           #1306). Release, ship, rollout and cutover count like deploy, and
           the forward-looking test applies to them the same way. */
        /* Release wording counts only where the heading NAMES Section 4: "F27
           Section 4 release, run `X`" ships the same four functions, while a
           nested "### Companion release" under a Section 4 entry is another
           lane's business and has never been asked for a §4 receipt. "deploy"
           keeps its inherited context, as before. */
        const shipWord = /releas(?:e|ed|ing)|shipp(?:ed|ing)|\bships?\b|rollout|roll(?:ed|ing)? out|cutover|cut over/i;
        const claimsShip = (sectionFourHere && /deploy/i.test(headDeployWords))
            || (namesSection4(h.text) && shipWord.test(headDeployWords));
        const headSaysDeploy = (bodyClaimsForward || (claimsShip && !deployAhead))
            && !/NOT DISPATCHED/i.test(h.text) && !failedNothing;
        const noReceiptUnder = headSaysDeploy && !within(h.at, treeEnd);
        if (!unreadableRows && !truncatedTables && !attestations && !noReceiptUnder) continue;
        const heading = h.text.replace(/^#+ /, '').slice(0, 120);
        const line = log.slice(0, h.at).split('\n').length;
        /* Dated by ITS OWN heading only, at any level; and a run id in the
           heading at or past the newest receipt's makes it newer whatever any
           date says. */
        const entryDate = validDate((h.text.match(/\b(\d{4}-\d{2}-\d{2})\b/) || [])[1] || '');
        /* THE RUN A BROKEN RECEIPT CARRIES STILL DATES IT. A truncated
           attestation under an older-dated heading can name a github_run_id
           newer than the live receipt's; reading only the heading let the
           date soften it to a note while it proved a newer deploy may be
           invisible (Codex, thirty-eighth round on #1306). The newest run the
           section names anywhere, heading or block, decides. */
        /* AND SO DOES THE RUN ITS RESULT SENTENCE NAMES. An unreadable entry
           often states its outcome in prose alone -- "Completed successfully
           (run `X`)" -- so neither the heading nor a JSON block carries the id,
           and an older heading date softened a NEWER deploy to a note while its
           four malformed rows went unread (Codex, eightieth round on #1306). A
           run id counts when its own sentence says this deploy finished: not a
           plan, not a check, not a negation, not another attempt's, and not one
           the entry already binds to a failure. */
        const proseRuns = entryText.split(/(?<=[.!?])\s|\n{2,}/).flatMap(sentence => {
            const t = sentence.replace(RETROSPECTIVE, ' ').replace(CHECK_DONE, ' ').replace(NEGATED_DONE, ' NEGATED ');
            if (!DISPATCH_DONE.test(t) || /\bNEGATED\b/.test(t)) return [];
            if (CHECK_ONLY.test(t) || OTHER_ATTEMPT.test(sentence)) return [];
            const ahead = firstIndex(DISPATCH_AHEAD, t);
            const done = firstIndex(DISPATCH_DONE, t);
            if (ahead >= 0 && (done < 0 || ahead < done)) return [];
            return [...sentence.matchAll(/\brun\s+`?#?(\d{6,})`?/gi)].map(m => m[1]);
        }).filter(r => !failureRuns.includes(r));
        const runsHere = [(h.text.match(/[Rr]un\s+`?(\d{6,})`?/) || [])[1] || '']
            .concat([...block.matchAll(/"github_run_id"\s*:\s*"?(\d{6,})/g)].map(x => x[1]))
            .concat(proseRuns)
            .filter(Boolean);
        const ownRun = runsHere.sort((a, b) => Number(b) - Number(a))[0] || '';
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
    const says = v => (v === '(absent)' ? 'does not name it' : /^[0-9a-f]{7,}$/i.test(v) ? 'says `' + v + '`' : 'says v' + v);
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
            /* THE PREVIOUS §4 RECEIPT IS NOT ALWAYS THE PREVIOUS LIVE STATE. An
               owning lane can move `production-write` between two Section 4
               releases, and this guard cannot read that lane's versions, so the
               version live just before the newest release is not derivable and
               the row's correct claim would be reported as two steps back
               (Codex, forty-second round on #1306). Where such a dispatch is
               recorded in between, the mismatch is a note naming the reason
               rather than a failure. The bundle's IDENTITY is unaffected: it is
               still matched against the digest and byte length the newest
               receipt sealed. */
            /* Between means BETWEEN, by run id where the ids are known: two
               receipts can share a date, and an owning-lane run from earlier
               that day is not intervening (Codex, forty-third round on
               #1306). A dispatch with no readable run id is judged by date
               alone, as before. */
            const num = x => (/^\d+$/.test(String(x || '')) ? Number(x) : null);
            const lo = num(prior.run), hi = num(live.run);
            /* No date floor on the scan: a dispatch recorded retroactively can
               sit under a section dated before the prior receipt while its run
               id falls between the two, and flooring by date discarded it
               before the run-id filter below could see it (Codex, forty-fourth
               round on #1306). The filter decides. */
            /* The prior run id is the floor, so a dispatch recorded under an
               UNDATED heading survives the scan on its run id alone; without it
               the scan dropped such an entry for lacking a date before the
               filter below could place it (Codex, forty-sixth round on #1306). */
            const between = laneDispatchesSince(receiptsMeta.log, '', prior.at, prior.run || '')
                .filter(d => {
                    const r = num(d.run);
                    if (r !== null && lo !== null && hi !== null) return r > lo && r < hi;
                    return (!prior.date || d.date >= prior.date) && (!live.date || d.date <= live.date);
                });
            const msg = 'rollback bundle ' + claim.bundle.sha + ' claims it captures production-write v'
                + claim.bundle.captured + ', but the release before the newest one was v'
                + prior.fns['production-write'].version;
            if (between.length) {
                const where = between[0].date
                    ? 'the ' + between[0].date + ' entry'
                    : (between[0].run ? 'the run `' + between[0].run + '` entry' : 'an undated entry');
                notes.push(msg + ' — ' + where + ' records a `' + between[0].lane
                    + '` dispatch between the two, and that lane\'s versions are not readable here, so the'
                    + ' version live just before the newest release cannot be derived from this log. The'
                    + ' bundle itself still matches the digest and byte length the newest receipt sealed.');
            } else {
                failures.push(msg + ' — restoring it would step back more than once');
            }
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
