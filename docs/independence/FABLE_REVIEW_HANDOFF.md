# Review handoff: the Linear exit, six held PRs

**Written 2026-09-08 by the coordinating session, for a fresh reviewing session.**
Paste the prompt at the bottom, or read this whole file first.

SyncView's Linear account is cancelled **2026-09-15**. Six PRs are finished, CI-green
and **deliberately unmerged**, because merging to `main` publishes the live site
through GitHub Pages immediately. Nothing here has changed production.

---

## The one thing to know before reading anything else

**This document and its siblings were written by a session that was wrong repeatedly.**
PR #1360 took fourteen review rounds and thirty-one findings, and **every finding came
from review rather than from the author.** The prose reads confidently; the process
that produced it caught almost nothing on its own.

Four conclusions survived all fourteen rounds and are the load-bearing ones:

1. Read `write_ui_reroute_clients` live before anything else. **Done 2026-09-08: 43
   client slugs, the full roster.** `ROLLBACK.md` had a stale two-client value and is
   corrected.
2. Run the dead-Linear rehearsal **requiring observed successes, not clean refusals.**
   On the intake paths a tidy error message is the defect, not the proof.
3. The intake repair is a **gate**, not a recommendation.
4. #1326 closes a gap the four original PRs do not.

Everything else moved at least once. **Trust the rehearsal over the writing.**

---

## What breaks on 2026-09-15 without these merges

| Surface | Effect |
|---|---|
| Creating a post — Calendar, Samples/SXR, staff submission, **and the client link** | refused; `?intake=1` is LIVE, so this is client-facing |
| Appending to an existing batch | refused; the common case |
| Filling a component | refused |
| Labels, read and write | refused |
| Changing a card's assignee | refused, unless one flag is set |
| Workload board | **freezes rather than empties** — looks current, is stale |
| Kasper's Editors subtab, tweak comments | fail visibly |
| **URGENT TWEAKS NEEDED** button | editor lookup fails |
| Status, due date, description, comments, attachments | **safe**, verified per operation |

---

## The six PRs, in review order

| # | What it does | Note |
|---|---|---|
| **#1344** | Workload board reads native data | **Its backend is already deployed and verified live.** Merging makes the repo catch up to production, not the reverse |
| **#1347** | Read every piece of feedback without Linear | Its Edge Function deploy needs the merge first. Forward- and backward-compatible by construction: an old gateway ignores the new optional field |
| **#1346** | `editors-week` rebuilt natively | Carries an attached obligation: the anonymous `deliverable_events` grant must be revoked **separately**. Serving it through an authenticated function does not satisfy that — the publishable key reaches the table through PostgREST regardless |
| **#1350** | Cutoff runbook, watchers, dead-Linear rehearsal. **Merges last** | Its runbook must gain the P6/P7 preconditions before it counts as satisfying the Phase 3 gate |
| **#1358** | Four defects already live on the site | **Not a Linear change.** The retry-message fix is the valuable one: "nothing was committed, try again" was printed over failures where the write may have landed |
| **#1362** | The native write gateway + the native urgent alert | The largest. A **lift** of #1326 and #1341, not a rewrite |

---

## Where to look hardest

**In #1362, the `index.html` hunks.** They were ported **by hand**, deliberately, because
taking that file wholesale from #1326 auto-merges onto `main` with **zero conflict
markers** while silently interleaving hundreds of hunks from two independent rewrites of
an 80,000-line file. A clean merge there is a red flag, not a green light. Check the
hand-ported hunks are faithful and complete.

**In #1362, that `production-write/index.ts` carries BOTH changes.** Main's #1361
(Submit-tab / AI thumbnail titles) landed in that file *after* the swap was verified
safe. The merged closure digests to `e1c6443c…` files=6, which differs from **both**
`663e7e42…` (the lift alone) and `27d1a608…` (#1361 alone). A pin equal to either would
mean one side silently won.

**The behavioural gate in `LINEAR_EXIT_MASTER_SEQUENCE.md`.** Eight checks plus three
read checks. Two traps are documented there and both are easy to fall into: a clean
refusal read as a pass, and a **render served from cache** read as a pass —
`_kasperLoadEditors(false)` returns from `localStorage` with no network call at all.

**Anything derived.** The recurring defect in these documents is a table, checklist or
summary drifting from the correct prose it was derived from. Facts held up; restatements
did not. Check any table against the section it came from.

---

## After approval: the install order

**Nothing below has been done.** All of it is the owner's.

1. **The dead-Linear rehearsal** (`SYNCVIEW_QA_LINEAR_DEAD`), requiring successes.
2. **The naming mint, four steps:** apply the migration, seed `video`, seed `graphics`,
   **then flip the flag**. Check the seed's returned `prefix` / `observed_provider_max` /
   `next_ordinal` **before** flipping — the flip's own proof step is what makes the seed
   irreversible.
3. **`production_assignee_eligibility`** to exactly `{"provider_mapping_required": false}`.
   A missing flag stays strictest, so doing nothing is not neutral.
4. **#1362's SQL FIRST, then the F27 dispatch, then the flags.** Deploying that gateway
   before its SQL takes Create Post down. Capture the sealed bundle → **upload to the
   Drive** → *then* dispatch. Skipping the upload fails in ~20 seconds with
   `OBJECT_MISSING`.
5. **F48:** merge #1346 → apply the event-time-assignee migration → revoke the
   `deliverable_events` grant → *then* deactivate the legacy `editors-week` workflow.

---

## Still owed, and not code

- **The composed intake SQL has never been executed.** Its digest reproduces exactly
  (`2571a909…`, 66,665 bytes) but it has never run against a target lacking the native
  columns. A disposable PostgreSQL 16 run is owed **before** the real window.
- **The urgent alert's credentials are not provisioned.** The gateway answers
  `503 native_urgent_not_configured` until they are.
- **`send-urgent-slack`'s n8n side is untouched** and needs the owner's explicit
  go-ahead in the moment. Nothing in this programme has edited an n8n workflow.
- **The label catalog capture** that brief B's item B7 calls owed before 2026-09-15.

---

## The prompt

> You are reviewing six held pull requests in `sidney-afk/client-analytics` that move
> SyncView off Linear before the account is cancelled on 2026-09-15. Start by reading
> `docs/independence/FABLE_REVIEW_HANDOFF.md`, then
> `docs/independence/LINEAR_EXIT_MASTER_SEQUENCE.md`.
>
> Review in this order: #1344, #1347, #1346, #1350, then #1358, then #1362.
>
> Merging any of them publishes the live site immediately, so do not merge anything.
> Report what you would change and what you would block.
>
> The author of these documents was wrong repeatedly and every correction came from
> review rather than from them. Treat confident prose as unverified. The recurring
> defect is a derived artefact — a table, checklist or summary — drifting from correct
> prose elsewhere in the same file, so check any table against the section it came from.
>
> Look hardest at: the hand-ported `index.html` hunks in #1362 and whether they are
> faithful and complete; whether `production-write/index.ts` in #1362 genuinely carries
> both the native lift and main's #1361 thumbnail-title fix; and whether the behavioural
> gate can be satisfied by a clean refusal or by a cached render rather than by a real
> success.
