# Linear exit — the plan as the system actually stands, 2026-09-03

**Status:** strategy, owner-gated. Nothing here has been executed.
**Companion:** `docs/ops/ACTION_HISTORY_PLAN_2026-09.md` (the action-record plan). The
two are independent; the one place they touch is that this plan's B1 removes the
reconciler's calendar writes, which is where much of that surface's automation record
comes from today.
**Supersedes the ORDERING of `TRACK_B_LINEAR_REPLACEMENT_SPEC.md` §13** (5a–5i). That
section's steps are still the right *inventory*; seven of its orderings are now wrong,
because §13 was written before both team flips and does not contemplate the state the
system is in today. Where the two disagree, this file wins and says why.
`docs/ops/PHASE4_CLEANUP_CHECKLIST.md` is quarantined (F104) and is not cited here.

Every number below was measured live on 2026-09-03 (16:29–16:40Z) read-only. Where a
number could not be verified through the browser publishable key it is marked
**unproven** rather than estimated.

---

## 0. Why this plan was redone, and how its claims are checked now

The owner stopped the first implementation attempt with a fair question: if the strategy
was any good, how did it not know that the create path already behaved differently than
described? The answer is that the first draft of this file was written by reading code and
grepping for Linear calls, and that method produced two confident wrong answers about the
same question, in opposite directions:

1. It said native Create Post cannot commit without a live Linear read, citing
   `linearStateIdForCreate` and `linearLabelCatalog` inside `handleProductionCreate`. That
   function opens with an unconditional `throw new GatewayError(403,
   "production_create_closed")` — the owner's own 2026-08-23 ruling that nothing is created
   from the Production tab. Every Linear call it makes is **unreachable**. The claim was
   true of dead code.
2. Correcting that mid-implementation, it then said the calendar's real create path
   touches Linear nowhere — because grepping *inside* `handleIntakeCreate`'s line range
   finds no Linear call. It reaches one **two hops away**, through
   `projectForIntake → readLinearProject`.

Both mistakes have one root: reading for the **presence** of a Linear call near a name,
instead of computing **reachability** from a live entry point. Nobody can hold a
7,000-line call graph in their head, and the failure mode is not "I don't know" — it is a
fluent, specific, wrong answer.

**So the question is no longer answered by a person.** `scripts/linear-dependency-map.js`
builds the call graph, discards code below a top-level `throw`, resolves the endpoint
through constant aliases, and reports the shortest path from each entry point to the
Linear API. `test/linear-dependency-map.js` proves each rule on a fixture whose answer is
obvious, asserts the facts that were hand-verified against the real file, and runs a
**mutant** for each rule that removes it and requires the old wrong answer to come back —
because all three rules were added only after they produced a visibly absurd result. The
alias rule, for instance, was added when the analyzer reported that `linear-outbound`
depends on Linear nowhere.

Four questions now stand behind every claim in this file, and where one is unanswered the
claim says **unproven** rather than guessing:

1. **Is the code reachable?** — the analyzer, above.
2. **Is it deployed?** — `docs/ops/EF_DEPLOY_MANIFEST.md`. Fourteen functions carry **NO CI
   DEPLOY PATH**, including `calendar-upsert` and `sample-review-upsert`, so for those the
   repository is not evidence about production.
3. **Is it flag-gated, and what is the flag set to right now?** — read live.
4. **Does live data agree?** — the strongest check, and the one that caught the
   deployment gap: live `calendar_post_events` rows carry a shape the repository's
   `calendar-upsert` could not have written.

---

## 1. The one-paragraph version

Both teams are already SyncView-authoritative, all 43 active clients are enrolled, and
staff write paths on the Content Calendar, Samples, Kasper's board, the client review
page and the submit tab already go native — the legacy n8n write lanes carry no live
traffic while the routing flags read cleanly, though they are still the fallback when one
does not (§2). What is left is **not a migration of people**. It is three
mechanical facts: the Content Calendar has no native way to learn a deliverable's
status and borrows Linear as a relay; Workload's board is rebuilt from Linear every ten
minutes and its native replacement cannot be swapped in without a key migration, because
saved plan days are keyed on the Linear issue uuid; and six live `production-write` entry
points still read the Linear API, the costly one being **creating a post**, which
validates the client's per-team Linear project on every create. Moving a status, by
contrast, already touches Linear nowhere. Remove those three and Linear is an export
problem, not an operational one.

---

## 2. What is already done

| | Evidence |
|---|---|
| Both teams SyncView-authoritative | `prod_authority = {"video":"syncview","graphics":"syncview"}` since 2026-08-28T23:54Z |
| Every active client enrolled | `write_ui_reroute_clients` = 43 slugs against 43 active clients, re-read 16:55Z (an earlier pass this session recorded 42/42; the flag and the roster agree either way); **0 of 780 live calendar cards and 0 of 19 live sample rows sit on a non-enrolled slug** |
| Legacy n8n write lanes unreachable **on the success path only** | `_writeUiRerouteUseGateway` is true for every live client, so `legacyParity` is false on every team. **They are not dead code.** `_writeUiRerouteUseGatewayWhenReady` primes the flag first, and `_writeUiSetRerouteFlagValue({clients: []})` on an unreadable read makes the predicate false for everyone — the browser then takes the legacy lane. The calendar and Samples upsert allowlists fall back the same way (`_calFetchUpsertFlagOnce`), as does `scripts/linear-sync-reconcile.js`. So teardown needs the **failure path** replaced and a zero-caller proof, not just an enrolled roster; retiring the endpoints while that fallback exists routes a save into a removed URL during any transient flag-read failure |
| Submit tab creates natively and authoritatively | `production-write` `intake_create` builds the native row; the Linear issue is a downstream artifact of `linear-outbound`. `deliverables` by origin: calendar 1,220 · samples 38 · manual 5,042 · submission 0 |
| Client-visible data is already native | Nothing a client sees on either surface is read from Linear |
| `workload-linear` Edge Function | Dead on both ends by its own header; permanently 409s. Free to delete |
| Calendar Linear Status Sync (n8n `MJbMZ789B5ExZz9x`) | `active: false`, confirmed live. Preserve the graph (F46) |

---

## 2b. Every surface, audited — revision 2, 2026-09-03

The owner's challenge was fair: a strategy that had not established whether each
surface reads Linear was not a strategy. Revision 1 covered three blockers found by
reading. This is the surface-by-surface sweep, browser included, which revision 1 did
not do — and it found a live dependency on the Content Calendar that revision 1 missed
entirely.

Method: every remote endpoint the browser calls was enumerated, the eight Linear-named
n8n webhooks were traced to their call sites, each call site to its enclosing function,
and each function to its callers and guards. Edge Functions come from
`scripts/linear-dependency-map.js`.

| Surface | Depends on Linear today? | Exactly what, and where |
|---|---|---|
| **SMM Content Calendar — status** | **No** (as of item 131) | It reads `deliverables` directly. `_calReconcileLinearStatuses` is dead under v2 — its second statement is `if (_calV2Ready()) return;`, and v2 is every staff tab |
| **SMM Content Calendar — card banner** | **YES, on every load** ⚠️ | `_calRefreshParentLinkFlags` fires from `loadCalendarPosts`' tail on every foreground load and posts every linked issue id to the `linear-issue-statuses` webhook, to source project / due date / editor / sub-vs-parent for the card banner. Feeds `_calLinearMetaById`, read in ~8 render sites. **Revision 1 missed this.** Display metadata, but a live per-load Linear read |
| **Create Post (calendar + samples)** | **YES** | `handleIntakeCreate → projectForIntake → readLinearProject`. Validates the client's per-team Linear project on every create |
| **Submit tab** | **YES** | `_submitLinearFormOnce` needs `fetchLinearProjects` (`linear-projects` webhook) to populate its client picker; `_linearIntakeSendTelemetry` also posts to `log-linear-submission`. The work itself is created natively via `intake_create` |
| **Workload board** | **YES** | Renders from `workload_issues`, rebuilt from Linear every 10 min. `wlFetchTweakComments` reads the `linear-tweak-comments` webhook. An "Open in Linear" link sits in the popover |
| **Kasper's review board** | **No** | Reads `calendar_posts` only |
| **Client review — calendar** | **No** | Reads `calendar_posts` only |
| **Samples calendar (SXR)** | **No** for status | `_sxrSyncStatusFromLinear` fires only when someone pastes/edits a Linear URL on a card, not on load |
| **Client view — samples** | **No** | Reads `sample_reviews` only |
| **Import from Linear / bulk link** | **YES, by definition** | `_calLinearImportFetch`, `_calBulkLinkFetch`, `_sxrLinearImportFetch` — deliberate Linear-reading features that disappear with Linear |
| **Legacy write lanes** | Dormant, not dead | `_calLegacyPushStatusToLinear`, `_calLegacyPostLinearComment`, `_linearOutboxFlushRun` and the SXR twins are unreachable while the routing flags read cleanly, and are the fallback when one does not (§2) |

**So the honest count is five live dependencies, not three:** the calendar banner read,
Create Post, the Submit tab's client picker, the Workload board, and the deliberate
import features. Kasper's board, both client views and the samples calendar are already
clean.

**Two are cosmetic-ish and cheap.** The calendar banner and the Submit tab picker both
read Linear for *display* — a project name, a due date, an editor, a client list — all of
which exist natively in `deliverables`, `clients` and `team_members`. Neither blocks a
write. They are listed first because they are the least work and the most visible.

---

## 3. The three things that actually block switch-off

### B1 — The Content Calendar has no native status path (the relay)

A status set in the Production tab writes `deliverables` and **nothing notifies the
card**. `production-write` never touches `calendar_posts.*_status` (zero occurrences).
No browser channel subscribes to `deliverables`. The value reaches the card only by
going out to Linear through the mirror and being pulled back by
`scripts/linear-sync-reconcile.js`.

- Measured lag, card vs its bound deliverable: **p50 510 s, p90 806 s** (n=113).
- Relay volume is **bounded**, contrary to the looser figure in OPEN_REPAIRS 129:
  `SAFETY_CAP` is 15 *actionable* corrections and the run aborts with zero writes above
  it, so the ceiling is **≤60 calendar card writes/hour**; measured **≈23/hour**. The
  rest of `calendar_posts` churn is artifact/thumbnail projection, not the relay.
- **The relay already verifies itself.** `linear-sync-reconcile.js` computes the
  canonical deliverable status and admits a pull only when it *agrees* with Linear
  (`echo`). A Linear value the deliverable does not hold is classed `foreign` and
  **refused every run** — 10 of 10 on the 16:30Z run. So the statuses landing on cards
  are already checked against native truth.
- The exception is `unlinked`: a card with no deliverable id has nothing to check
  against, so Linear is applied unverified. **128 live calendar cards** and **10 of 17**
  linked live sample rows are in that state.

**Consequence:** because an applied pull is one where Linear and the deliverable already
agree, the Linear leg is redundant for the linked majority — the same value is already
in hand. The unbound population is simultaneously the only thing the Linear read is
still needed for and the only thing that breaks when it goes.

### B2 — Workload's board is rebuilt from Linear, and the swap is a key migration

`_wlV2FetchIssues` renders from `workload_issues`, which n8n `lGwC9WWPVJtxphtf`
rebuilds every 10 minutes from `/webhook/linear-issues`, hosted by the active
`BrJSe8zCKUccfmIq`. Turn Linear off and the board silently shrinks.

`public.workload_issues_native_v1` exists (owner applied it 2026-09-02) and is **more
complete than the Linear-fed table**: renderable rows **1,022 native vs 985**, the +37
being live sub-issues the board cannot display at all today (OPEN_REPAIRS 113/95).

**Correction to an earlier draft of this file, which said the native view has "zero
readers" and that someone "just has to point the board at it".** Both were wrong, and the
second was the more misleading. `?wlnative=1` already reads the native view *alongside*
the Linear-fed one and prints the difference (`_wlNativeDiffEnabled`, `WL_NATIVE_VIEW`).
It deliberately "never touches `wlState`, never renders" — it is a measuring instrument,
which is what `WORKLOAD_NATIVE_SOURCE.md` step 2 asks for. So the view has a reader; it
has no *rendering* reader, on purpose.

And the swap is not a flag. The code says why, and it is right: `public.workload_plan` is
keyed on the **Linear issue uuid**, and `workload-plan`'s `requireWritableIssue()`
validates every write against `workload_issues`. A deliverable that was never mirrored has
no Linear uuid at all, so swapping the read alone would put rows on the board whose plan
day **silently fails to save** — a drag that looks like it worked. That is a key migration
plus scope §6.1's owner decision, not a switch.

Three blockers `WORKLOAD_NATIVE_SOURCE.md` lists are, separately, now empty by
measurement: renderable native rows with `linear_id IS NULL` = **0**; `native_sync_state`
across 5,165 rows = clean 5,165, drift 0, missing 0, orphan 0, stale 0; the duplicated
`For Client approval` casing exists only on the Linear side. §5.1 says step 1 is "pending
owner apply" — **it is applied**; the scope doc is stale there.

### B3 — Six live entry points still need a Linear read, and creating a post is one

**This section replaces a claim that was wrong twice.** See §0 for how, and for the
machine check that now answers the question instead of a person reading greps.

`node scripts/linear-dependency-map.js` computes reachability over the call graph,
discounting code that cannot execute. Against `production-write`:

| entry point | needs a live Linear read? | path |
|---|---|---|
| `handleIntakeCreate` — **the calendar's Create Post** | **yes** | `→ projectForIntake → readLinearProject → linearRead` |
| `handleComponentFill` | **yes** | `→ projectForIntake → readLinearProject → linearRead` |
| `handleCreateOptions` | **yes** | `→ linearLabelCatalog → linearLabelsRequest` |
| `handleLabelsRead` | **yes** | `→ linearLabelSnapshot → linearLabelsRequest` |
| `handleAssigneeOptions` | **yes** | `→ mappedCreateAssignees → assigneeEligibilityContext → assigneeProviderPool → linearRead` |
| `handleEntityOperation` | **on two branches only** | `labels` → `linearLabelSnapshot`; `assignee` → `validateAssignee`. **`status`, `due` and `description` are Linear-free** |
| `handleProductionCreate` — the SyncLinear-tab create | **no — it is closed** | 247 lines unreachable behind `throw … "production_create_closed"` (owner ruling 2026-08-23) |
| `handleAssetAccessRead`, `handleBatchAssetWrite`, `handleBatchDescriptionWrite`, `handleBatchFilesRead`, `handleDescriptionRead` | no | — |

`deliverable-write`, `batch-write` and `production-comments` reach Linear **nowhere**.
`linear-outbound` (9 functions) and `workload-linear` (3) do, which is their job.

**What this means in practice.** Creating a post is a live outage risk *today*: it
validates the client's per-team Linear project through `readLinearProject` on every
create, so a Linear outage refuses the create. Moving a status is not — that path never
touches Linear. The work is therefore narrower than "make Create Post native": it is to
give `projectForIntake` a native source of truth for the client→project mapping, and to
give labels and assignee native vocabularies.

**A caveat this table cannot express.** Reachability is not frequency: "needs Linear"
means *some* path reaches the API, which for `handleEntityOperation` is two branches out
of five. Read the named path before concluding an entry point is blocked.

**And a second caveat that outranks the whole table.** This is repository source.
`docs/ops/EF_DEPLOY_MANIFEST.md` marks `calendar-upsert`, `sample-review-upsert`,
`calendar-reorder` and eleven others **NO CI DEPLOY PATH** — for those, what is in the
repo is not what is running, as the `authorizeBrowserWrite`/tokenless split in
`ACTION_HISTORY_PLAN_2026-09.md` §3 G3 demonstrated. `production-write` *does* have a
deploy lane and was last deployed at version 66, so the table above describes live
behaviour; a claim about the un-deployed functions does not.


## 4. Where §13's ordering is now wrong

1. **5b (kill inbound) must not come before the read paths.** `linear-inbound`'s comment
   ingest runs *before* the authority gate and is **the only genuine human-edit ingest
   still live**. Killing inbound first stops Linear-authored comments arriving with no
   refusal, no event and no UX. Inbound dies last among the read paths, or simultaneously
   with an enforced freeze.
2. **5e's premise is false.** It says "tab reads `deliverables`". The tab reads
   `workload_issues`. The native view has zero readers. 5e is blocked on
   `WORKLOAD_NATIVE_SOURCE` steps 2–5, not on a flag.
3. **5f hosts 5e's data source.** `BrJSe8zCKUccfmIq` serves `/webhook/linear-issues`.
   Retiring it before the Workload native cutover blanks the board.
4. **Step 0/4 (retired epoch) is the front of the queue, not a background precondition** —
   see B3.
5. **5d bundles two unlike things.** Samples reconcile applies unconditionally on its own
   cron over **19 live rows** and is nearly free to retire. Calendar reconcile is
   dispatch-only, covers **778 live rows**, and is the calendar's sole status projection.
   Separate steps, separate replacements.
6. **"Never run reconciler apply after F2 is off" is not a rule any more, it is an
   automatic outage.** `pullOnly` requires `outboundMode === 'live'`, and an unreadable
   flag defaults to `off`. The moment F2 flips off, every component drops to detect-only
   and the calendar's status projection stops **without anyone choosing it**. The native
   projection must land *before* F2 goes off.
7. **5h mis-scopes the legacy card-write webhooks.** `calendar-upsert-post` and
   `sample-review-upsert` are the reconcilers' own fallback for any client outside the
   enrolled-slug flag. Retiring them while the reconcilers run breaks the relay.

---

## 5. The corrected order

Each step states its gate. Do not start a step whose gate is unmet.

**Step 0 — Make creating a post Linear-free.**
Narrower than the earlier draft claimed, and aimed at the paths the analyzer actually
names (§B3), not at the closed Production-tab create:
  a. **The client→project mapping.** `projectForIntake` calls `readLinearProject` purely to
     confirm the tagged project belongs to the expected team. Persist that team
     association natively (it is already stored per client in `linear_project_ids`) and the
     read disappears from `handleIntakeCreate` and `handleComponentFill` together.
  b. **The label vocabulary**, for `handleCreateOptions`, `handleLabelsRead` and the
     `labels` branch of `handleEntityOperation`.
  c. **The assignee eligibility pool**, for `handleAssigneeOptions` and the `assignee`
     branch — the roster already lives in `team_members`.
*Gate: `node scripts/linear-dependency-map.js` reports every `production-write` entry
point linear-free, AND a create succeeds with the Linear API unreachable.*
First because creating a post is the one thing that fails **today** if Linear is down.
Note this is an Edge Function change, so it does not take effect until the owner runs the
F27 Section 4 deploy lane; the code landing on `main` changes nothing by itself.

**Step 1 — Nothing to backfill on the calendar. Measured 2026-09-03, and this is a
correction: an earlier draft called for backfilling "420 calendar component slots … 193
in-flight".** That number counted every component with no deliverable id, which is not the
same question. A migration is only needed where **Linear holds a work item that SyncView
does not**. Classified over all 783 live cards × 2 components:

| | |
|---|---|
| 1,126 | already agree with their native deliverable |
| 169 | no native record, status **Posted** — finished work, nothing to migrate |
| 133 | no native record **and no Linear link** — no work item exists on either side |
| 107 | component not in use (blank or N/A) |
| **0** | **a Linear issue with no native record — the only shape that needs migrating** |

So the calendar has **no Linear-only work left**. The 94 native-created components in that
133 are the uncommissioned half of a card (63 video-linked with a graphic gap, 31 the
reverse, never both) carrying a default `In Progress` status behind a pill the app already
locks — the same family as the caption defect in OPEN_REPAIRS 127, not a linkage leak.

**Samples, measured the same way:** 19 live rows · 23 components with a native record ·
13 with no record and no Linear link · 2 not in use · **0 Linear-only**.

*Gate: met on both surfaces.* Nothing on a live Content Calendar card or a live sample row
holds work that exists only in Linear.

**What the same pass did find**, separately from the exit and not blocking it: 1,055 of
1,155 card→deliverable links are correct in both directions; **2 cards point at a
deliverable belonging to a different card**; ~98 links are one-way (the deliverable does
not name the card back); and a cluster of `kind` mismatches sits mostly on three clients —
video slots holding `kind=thumbnail` rows and graphic slots holding `kind=other`. `kind`
is not cosmetic: `linear-inbound:704` picks the slot to backfill from it. Filed as its own
investigation rather than folded in here, because it is a pre-existing data-integrity
question with its own blast radius and it does not gate the Linear exit.

**Step 2 — Make the calendar read deliverable status natively.**
Smallest first move: in `linear-sync-reconcile.js` (and the samples twin) write the
already-computed canonical value and drop the Linear read for linked components. Then add
a `deliverables` realtime subscription beside the existing card channel — the table is
already in the realtime publication and the anon read grant exists — to collapse 510 s to
sub-second. Then fold `status,status_at` into the existing per-load deliverable batch so a
missed event self-heals. *Gate: card status advances with the Linear read disabled;
watch the 31 currently-diverged slots converge. One thing to verify before relying on
realtime: a column-grant-only anon role must actually receive `postgres_changes` payloads.*

**Step 3 — Re-source the URGENT tweak ping.**
`_calSendUrgentSlack` refuses without `linear_issue_id` and the workflow resolves the
editor **from Linear**. 655 of 687 active video components carry a link, so this is a
working feature that hard-refuses on switch-off. Re-source to
`deliverables.assignee_id → team_members`. *Gate: an urgent ping fires on a card with no
Linear link.* **Requires owner go-ahead — it is an n8n edit.**

**Step 4 — Workload native cutover.**
`WORKLOAD_NATIVE_SOURCE` steps 2–5: `requireWritableIssue` must accept native ids
(currently validates against `workload_issues` and 409s `issue_not_writable`); move
`wlFetchTweakComments` off `linear-tweak-comments` to `production-comments`; default
`?wlnative=1` and retire `?wlnative=0`; then stop the reconcile. *Gate: the board renders
1,022 rows from the native view and plan-day writes succeed on native ids.*
**The tweak-comment move requires owner go-ahead — n8n.**

**Step 5 — Freeze, and prove the freeze.**
Human Linear work is measurably **not** frozen: **50 `foreign_write_detected` in 24 h,
1,735 in 7 d**, and the 16:30Z reconcile run held 10 foreign edits. A freeze that is not
server-enforced is a request. *Gate: `foreign_write_detected` ≈ 0 for a full week.*

**Step 6 — Export everything that exists only in Linear** (§6 below). *Gate: receipts in
Drive, reconciled counts.*

**Step 7 — Then the teardown**, in this order: samples reconcile → calendar reconcile →
5g webhooks (noting two are server-consumed) → 5f → 5h → F4 parity false → drain to zero
→ F2 off → 5b inbound → secrets → workspace.
*Gate for the 5h webhook retirement specifically:* the browser, both upsert allowlists and
the reconciler all fall back to the legacy n8n URLs when a routing flag cannot be read
(§2), so those fallbacks must first be made to fail closed — refuse and report rather than
route — and proven to have zero callers. Enrollment alone does not make the endpoints
retirable; it only makes them quiet.

---

## 6. Irreversible, and what must be exported first

**There is no scheduled Linear-side export anywhere in this repository.**
`track-b-backup.yml` snapshots Postgres only.

Exists **only** in Linear today:

1. **Attachments and inline images.** F34 records that the migration, EF deploy, rescue
   config, discovery, copy, disposition and retrieval drill are all *unauthorized* and
   need an owner window. Unsigned `linear_upload` URLs are private and need a Linear
   bearer token. These die with the workspace.
2. **Issue activity history.** `deliverable_events` begins 2026-07-06; anything earlier
   is Linear-only. `editors-week` computes labour from that transition history — it has
   no native equivalent.
3. **Comments not yet mirrored.** Completeness is **unproven** from a browser
   (`production_comments` is 42501 to the publishable key) and must be established with
   the service role.
4. **Archived and deleted issues.** `linear_archive` completeness against a real export
   has never been proven, and OPEN_REPAIRS 110 records issues deleted in Linear seconds
   after creation — deleted issues are not in the archive pull at all.
5. **The label catalog and team state definitions** — no native table exists (B3).
6. **Unmapped Linear user identities** — unresolvable once the workspace is gone.
7. **The crosswalk itself is partly Linear-derived.** OPEN_REPAIRS 102 measured 5,150 of
   6,241 deliverables with `card_id` NULL; the mapping back to a card runs through the
   Linear link. Capture it **while both sides are readable** — 103's ordering hazard makes
   "later" strictly worse.
8. **`workload_plan.issue_id` is the Linear UUID.** Saved plan days do not error when the
   join breaks; they stop appearing.

One-way actions, in the order they become safe: per-SMM key revocation → webhook deletion
(`LINEAR_INBOUND_SIGNING_SECRET` is unrecoverable; capture and rehearse recreation first,
per F60) → `LINEAR_API_KEY` rotation (six workflows plus n8n plus `production-write`; a
partially-rotated key reports phantom deletions rather than an auth failure — see
OPEN_REPAIRS 126) → workspace cancellation. Prefer deactivate/archive over deletion for
every n8n workflow; `MJbMZ789B5ExZz9x` is still unexplained (F46) and must be preserved.

---

## 7. Owner decisions this plan needs

1. **Step 3 and step 4 both require n8n edits** (urgent-ping re-source; tweak comments to
   `production-comments`). House rule: explicit go-ahead in the same request.
2. **The F34 asset-rescue window** — nothing can be switched off until Linear-hosted
   attachments are copied, and that work is currently unauthorized.
3. **`workload_plan.issue_id` remap** — native id vs keeping the Linear uuid
   (`WORKLOAD_NATIVE_SOURCE` §6.1), and what `url` should point at (§6.2).
4. **Whether to stop the samples reconcile now.** It is nearly free — 12 Linear-origin
   changes in 7 days, 21 in 30, against 19 live rows — and it is the cheapest way to prove
   the shape of step 7 on a small surface.
5. **The `linear-inbound` deploy still pending** (OPEN_REPAIRS 77) — unrelated to this
   plan but outstanding.

---

## 8. What this plan deliberately does not claim

- **That its first two answers about Create Post were right.** They were not, in opposite
  directions, and §0 records both. The corrected answer — creating a post DOES need a live
  Linear read, through `projectForIntake`, while moving a status does not — is machine-
  computed and pinned by `test/linear-dependency-map.js`, not asserted from reading.
- **That the analyzer is a proof.** It resolves calls by name, so a function invoked only
  through a variable or a property would be missed; it treats a top-level `throw` as
  terminal, which is the shape the closures in this estate take but not a language rule;
  and it says nothing about deployment. It exists to stop a confident wrong answer, not to
  replace reading the code.
- **Anything about the functions marked NO CI DEPLOY PATH.** For `calendar-upsert`,
  `sample-review-upsert` and twelve others, repository source is not evidence about
  production, and this file makes no claim that rests on it.

- That editors work in Linear. **They do not** — they work in SyncLinear. An earlier read
  of this session's data said otherwise; it was a join across two different status
  vocabularies and it was wrong. 46 of 58 sampled reconcile-sourced calendar changes are
  echoes of native SyncLinear work by editors and designers.
- That the residual `foreign_write_detected` traffic is human. It is *Linear-origin*, and
  the reconciler already refuses it. Who or what generates it is **unproven** and is worth
  establishing before step 5's freeze gate is called met.
- Any figure for `production_comments`, `linear_archive` or `workload_plan` row counts —
  all are RLS-blocked to the browser key and must be measured with the service role.
