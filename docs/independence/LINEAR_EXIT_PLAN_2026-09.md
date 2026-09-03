# Linear exit — the plan as the system actually stands, 2026-09-03

**Status:** strategy, owner-gated. Nothing here has been executed.
**Supersedes the ORDERING of `TRACK_B_LINEAR_REPLACEMENT_SPEC.md` §13** (5a–5i). That
section's steps are still the right *inventory*; six of its orderings are now wrong,
because §13 was written before both team flips and does not contemplate the state the
system is in today. Where the two disagree, this file wins and says why.
`docs/ops/PHASE4_CLEANUP_CHECKLIST.md` is quarantined (F104) and is not cited here.

Every number below was measured live on 2026-09-03 (16:29–16:40Z) read-only. Where a
number could not be verified through the browser publishable key it is marked
**unproven** rather than estimated.

---

## 1. The one-paragraph version

Both teams are already SyncView-authoritative, all 42 active clients are enrolled, and
staff write paths on the Content Calendar, Samples, Kasper's board, the client review
page and the submit tab already go native — the legacy n8n write lanes are unreachable
for every live client. What is left is **not a migration of people**. It is three
mechanical facts: the Content Calendar has no native way to learn a deliverable's
status and borrows Linear as a relay; Workload's board is rebuilt from Linear every ten
minutes and has no reader for its native replacement; and native Create Post cannot
commit without a live Linear read. Remove those three and Linear is an export problem,
not an operational one.

---

## 2. What is already done

| | Evidence |
|---|---|
| Both teams SyncView-authoritative | `prod_authority = {"video":"syncview","graphics":"syncview"}` since 2026-08-28T23:54Z |
| Every active client enrolled | `write_ui_reroute_clients` = 42 slugs against 42 active clients; **0 of 780 live calendar cards and 0 of 19 live sample rows sit on a non-enrolled slug** |
| Legacy n8n write lanes unreachable | `_writeUiRerouteUseGateway` true for every live client, so `legacyParity` is false on every team; the legacy pushers, both outbox drains and both re-assert helpers are dead code for live traffic |
| Submit tab creates natively and authoritatively | `production-write` `intake_create` builds the native row; the Linear issue is a downstream artifact of `linear-outbound`. `deliverables` by origin: calendar 1,220 · samples 38 · manual 5,042 · submission 0 |
| Client-visible data is already native | Nothing a client sees on either surface is read from Linear |
| `workload-linear` Edge Function | Dead on both ends by its own header; permanently 409s. Free to delete |
| Calendar Linear Status Sync (n8n `MJbMZ789B5ExZz9x`) | `active: false`, confirmed live. Preserve the graph (F46) |

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

### B2 — Workload's board is a Linear read relay with no reader for its replacement

`_wlV2FetchIssues` reads **only** `workload_issues`, which n8n `lGwC9WWPVJtxphtf`
rebuilds every 10 minutes from `/webhook/linear-issues`, hosted by the active
`BrJSe8zCKUccfmIq`. Turn Linear off and the board silently shrinks.

`public.workload_issues_native_v1` exists (owner applied it 2026-09-02) and is **more
complete than the Linear-fed table**: renderable rows **1,022 native vs 985**, the +37
being live sub-issues the board cannot display at all today (OPEN_REPAIRS 113/95). It
has **zero readers** — that negative is load-bearing and should be asserted by a test.

Three blockers `WORKLOAD_NATIVE_SOURCE.md` lists are now empty by measurement:
renderable native rows with `linear_id IS NULL` = **0**; `native_sync_state` across
5,165 rows = clean 5,165, drift 0, missing 0, orphan 0, stale 0; the duplicated
`For Client approval` casing exists only on the Linear side. §5.1 says step 1 is
"pending owner apply" — **it is applied**; the scope doc is stale.

### B3 — Native Create Post cannot commit without a live Linear read (F32)

`handleProductionCreate` awaits **both** `linearStateIdForCreate` and
`linearLabelCatalog` on every native create; `handleCreateOptions`, `handleLabelsRead`
and the `labels` entity op await the label snapshot. There is **no native label
vocabulary and no native state-id source**.

This is not a teardown item. It is a live fragility: **a Linear outage stops Create Post
today, under SyncView authority.** §13 treats the retired epoch as a step-3
precondition; it belongs at the front of the queue.

---

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
   42-slug flag. Retiring them while the reconcilers run breaks the relay.

---

## 5. The corrected order

Each step states its gate. Do not start a step whose gate is unmet.

**Step 0 — Make native Create Post Linear-free (F32).**
Native label vocabulary + state-id source in Supabase; `production-write` stops awaiting
Linear on create/label paths. *Gate: a create succeeds with the Linear API unreachable.*
This is first because it is the only item that is a live outage risk today.

**Step 1 — Backfill the unbound card↔deliverable slots.**
420 calendar component slots (299 with no deliverable id, 121 crosswalk-mismatched) and
13 sample slots cannot be served natively. 193 are in-flight work. Run
`scripts/b3-linkage-backfill.js` / the F42 import to completion, and close the leak that
still manufactures them — the gap check finds **31 actionable slots today, 4 created
after the flip**. *Gate: unbound in-flight slots = 0 and the post-flip creation rate = 0.*

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

- That editors work in Linear. **They do not** — they work in SyncLinear. An earlier read
  of this session's data said otherwise; it was a join across two different status
  vocabularies and it was wrong. 46 of 58 sampled reconcile-sourced calendar changes are
  echoes of native SyncLinear work by editors and designers.
- That the residual `foreign_write_detected` traffic is human. It is *Linear-origin*, and
  the reconciler already refuses it. Who or what generates it is **unproven** and is worth
  establishing before step 5's freeze gate is called met.
- Any figure for `production_comments`, `linear_archive` or `workload_plan` row counts —
  all are RLS-blocked to the browser key and must be measured with the service role.
