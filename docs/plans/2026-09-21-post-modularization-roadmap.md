# Post-modularization roadmap — what "next" is, in order

**Status: ratified by the owner 2026-09-21 evening; phase A started the same evening.**
Written by the supervisor session the day the index.html split completed
(`docs/plans/2026-09-21-modularization-plan.md`, execution notes). This file is
the order of work from here. Each phase names its gate, its parallelism, and
what it must not touch. Phases are sequential; sessions inside a phase may run
in parallel where the phase says so.

## What the split did, and did not, do

The split stored `index.html` as 37 ordered text fragments under `src/index/`
that `npm run build:index` concatenates back into the one file GitHub Pages
serves. **The served page did not change**: same bytes, same single `<script>`,
same global scope, same boot cost. Nothing is an ES module yet (an ES module is
a JavaScript file that declares what it imports from and exports to other
files; the browser can then load it separately and on demand). What the split
bought is *editability*: a change to one screen is a change to one 2–3k line
file instead of an 86k line file, which is cheaper for people, for executor
sessions (they read one fragment, not the whole page), for reviews, and for
merges.

Turning the fragments into real modules is **phase C** below, not a separate
later project. It is done after the dead code is out, because there is no point
modularizing code that is about to be deleted.

## Phase A — base audit (read-mostly, parallel, no code deletion)

Gate to start: none. Gate to finish: three reports merged under
`docs/audits/2026-09-21-base-audit/` and the owner has read them.

Three sessions, independent files, no shared writes:

- **A1, docs freshness ("Surveyor").** Every document that still describes
  Linear as the system of record, a live mirror, an outbound write target, or a
  place people work, gets either a dated correction in place or a move to
  `docs/archive/` with a one-line pointer. Starts with
  `docs/CLIENT_LIFECYCLE_MAP.md` (last edited 2026-09-03, before the cutoff).
  Output: one PR of doc edits plus `A1-docs-freshness.md` listing every file
  touched and every file judged still-true.
- **A2, dead-code inventory ("Miner").** Per fragment, the functions, flags and
  code paths that exist only to talk to Linear or to the legacy transports
  (`linear-outbound`, `mirror_outbox` writers, `_writeUiLegacyOutbox*`,
  `_calPushStatusToLinear`'s Linear leg, SyncLinear-era URL builders that
  point at linear.app, the b1 import, the reconcilers' browser halves). For
  each: fragment, function name, why it is dead (which flag is off, which
  caller is gone), and whether it is safe to delete BEFORE the STEP 7 key
  revoke or only after. **Read-only; writes nothing but the report**
  `A2-dead-code-inventory.md`. This report is phase B's worklist.
- **A3, junk and orphan files ("Sweeper").** Files nothing references: assets
  no fragment or doc links to, scripts no workflow or package.json script
  calls, tests not in `test/suite-classification.json`, top-level folders
  whose contents predate the current app. Also the 58 open PRs from before
  2026-09-14 (24 edit the pre-split `index.html` and cannot merge as they
  are). Output: `A3-junk-inventory.md` with a proposed delete list and a
  proposed close list; **deletes nothing and closes nothing** — the owner
  says which.

Rules for all three: public repo (no client names or slugs in reports; counts
and card ids only); do not touch `docs/ops/OPEN_REPAIRS.md` (the supervisor
adds ledger entries after the reports merge, to avoid number collisions); do
not edit any `src/index/` fragment; report token usage.

## Phase B — delete the Linear-era code

Gate to start: A2 merged. Two halves:

- **B1, browser side, safe now.** Everything A2 marks "dead with outbound
  off / parity off / inbound irrelevant to the browser". One PR per fragment
  or per feature, each proving: the deleted symbols have no remaining callers
  (grep in the assembled page), `node test/run-all.js` and the browser gate
  green, the page shrinks (record bytes before and after in the PR body). The
  Codex bot reviews each PR; real findings are fixed.
- **B2, server side, after STEP 7.** `linear-inbound`, `linear-outbound`, the
  brief-media copy tool's Linear re-fetch, the drain workflows and their
  secrets. Only after the owner revokes the Linear key (STEP 7, date owner's)
  and after `scripts/native-brief-media-copy.mjs` has run `apply` for real,
  since that copy reads Linear once per file.

Gate to finish: A2's list is empty or every remaining row says "after STEP 7"
and STEP 7 has not happened yet.

## Phase C — measure boot, then load on demand (the real modularization)

Gate to start: B1 merged.

1. **Measure first.** `docs/syncview-design/tests/prod-boot-budget.js` and a
   real-browser timing of the live page, cold and warm, recorded in a dated
   audit file. Numbers before any change.
2. **Split the shipped file.** Teach `scripts/build-index.js` to emit, next to
   `index.html`, one JavaScript file per rarely used area (candidates: TikTok
   upload and pilot, Kasper dashboard/review/history, editors and date picker,
   hiring, onboarding, time off, samples) and to leave a small loader in the
   page that fetches an area the first time it is opened. This is the step
   that changes the served bytes, so it gets the full gate: the byte-identity
   check is replaced by a "renders and behaves identically" proof (the
   browser gate plus a master-test pass), not skipped.
3. **Make the always-loaded core a set of ES modules** with explicit
   imports/exports, one fragment at a time, so the global scope stops being
   the only interface between screens. Same proof per step.
4. **Measure again.** Same file, numbers after.

## Phase D — navigation, back/forward, refresh

Gate to start: C2 merged (so the router is working against the final shape).
The owner's observations (going back and forth between screens, what refresh
should do, deep links) are collected first as a feedback-expansion intake, then
implemented against the routing fragments only.

## Phase E — UI

Gate to start: D merged. The two style fragments (`010`, `020`) plus the one
behaviour fragment per screen. Owner's UI notes go through the same
feedback-expansion intake.

## What stays true throughout

- `index.html` is a build output; edit fragments, run `npm run build:index`.
- Every PR keeps `npm run check:index` green until phase C2 replaces the check
  with the render-identity proof.
- Only Storage touches live data. No n8n edits without the owner's word.
- The supervisor merges main into a trailing branch and regenerates
  `INDEX.md` itself rather than spending an executor round on it.
