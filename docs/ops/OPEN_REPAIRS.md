Warning: truncated output (original token count: 422905)
... 643043 bytes omitted ...

# Open repairs and pending owner decisions

Created 2026-08-08 from the reset audit, because several known repairs lived
only in chat transcripts and session summaries — which is how the ~52
unparented batches went two days with no file anywhere tracking them. An item
leaves this file by being DONE (link the PR/run) or by an owner decision to
drop it, never by silence.

Legend: **[owner]** needs a decision or click from the owner; **[repair]** is
executable by anyone with the named access; **[watch]** resolves itself if the
named signal appears.

---

## 1. [closed] ~52 batches with `linear_parent_ids = null` — leave them, on evidence

Batches created through Create Post between the 2026-08-02 deploy and the
2026-08-07 v38 fix have no recorded Linear parent (the autolink false-mismatch
terminalized the parent's outbox row before `applyCreateLinkage` ran). Almost
all are the TEST client's disposable drill fixtures; the fix (#1035) stops NEW
orphans and the drill now asserts nesting (#1036/#1037), but **nothing
re-parents the backlog**.

- Count as of 2026-08-08: ~52 (TEST client) + see item 2 for the one real one.
- Disposable candidates: TEST-client rows can simply stay null — nothing reads
  them — or be archived in a cleanup pass. A repair script would need the
  service role key and a bounded two-sided write; nobody has committed to
  writing one, deliberately, until someone shows a reader that cares.
- Done when: an owner decision picks "archive", "repair", or "leave", and this
  entry links it.

**ANSWERED 2026-08-22 — LEAVE, on evidence.** This entry was waiting on one
thing: "until someone shows a reader that cares". Nobody had looked. Re-measured
today, the whole population is 58 batches:

| owner | null-parent batches | ACTIVE | with children |
|---|---|---|---|
| TEST client | 57 | **0** | 55 |
| `roccopiazza` | 1 | 1 | **0** |

Every TEST-client row is inactive, so nothing operational can reach one. The
single real row is item 2: active, but empty — no deliverable references it.

And the one surface that could offer it already refuses to.
`_calNativeBatchHasLinearParents` filters a batch with no parent map out of BOTH
Create Post picker lists, precisely because appending to it could only ever
produce a 409 `batch_parent_mapping_missing`. That filter is already pinned
twice — `test/native-batch-picker-parents.js` (both the `{}` and the `null`
shapes) and `test/create-post-picker.js` — so it cannot quietly stop holding.
The only other reader iterates the map's entries, and an empty map contributes
nothing.

So there is no reader that cares, no repair is owed, and no service-role write
needs to happen. Archiving the 58 rows remains available purely for tidiness —
it needs the service key and changes nothing anybody sees — so it is the owner's
call whether it is worth the keystroke, not a repair anyone is waiting on.

## 2. [closed] `bat_fd246364…` — roccopiazza, empty orphan, invisible and left

The wave-1 Create Post batch from the outage window. Diagnosed 2026-08-08:
**empty orphan** — `linear_parent_ids` null AND zero deliverables reference it
(`batch_id=eq.` returns nothing; the real child rows were re-imported under a
B1-minted batch after the by-hand Linear repair of VID-13263/13264). Nothing
operational reads it. Repair is cosmetic: archive the row, or leave it. Not a
soak or flip concern.

**CONFIRMED 2026-08-22 and folded into item 1.** Still active, still zero
children, and still invisible: the Create Post picker's orphan filter excludes
it, and that filter is pinned in two suites. Cosmetic remains the right word.

## 3. [closed] VID-13261 ingested + all three card pointers repaired — verified in live data 2026-08-10

**This entry has been wrong twice and overstated once; this version is the
measured one, re-measured 2026-08-09 evening.**

Two corrections to the version committed earlier today:

1. **The re-dispatch advice is viable again.** It was genuinely impossible on
   2026-08-08 (see the conflict receipt below), but the squatting deliverable
   has since moved to its own card. Re-measured this evening: a query for a
   `kind=video` deliverable claiming card `p_mrmzoec4_tevvb` returns **zero
   rows** — the slot is now FREE, so the importer would create VID-13261 rather
   than withhold it.
2. **"Three cards DISPLAY the wrong video" was an overstatement.** The stale
   pointer feeds `_calProdSlotHtml` (index.html:34600-34615), which returns
   empty for client links (`if (_isClientLink) return ''`) and renders nothing
   once the F42 crosswalk verdict resolves to anything but valid, precisely so
   a mismatched id cannot "navigate somewhere misleading". So no client sees
   this, and staff see a wrong-target production link only in the unresolved
   grid state. Real inconsistency, modest impact — not the client-facing defect
   the earlier text claimed.

Original conflict receipt, from the live `linear_incremental_refresh` event for
the owner's 2026-08-08 dispatch (`changed_since=2026-08-07T15:00:00Z`), which
recorded `card_slot_conflict_count: 1`:

    incoming VID-13261 → card p_mrmzoec4_tevvb, slot already held by VID-12995

`--changed-since` filters on `updatedAt` (b1-linear-backfill.js:474) and
VID-13261's `updatedAt` is inside the window, so the importer DID fetch it. It
withheld the row on purpose: a card has exactly one video slot
(`deliverables_card_slot_unique`), the card's Linear link had been repointed at
a new issue while the OLD issue still occupied the slot, and resolving that
"means deciding which issue owns the card slot — a judgement this importer must
not make on its own" (b1-linear-backfill.js:186-200, check at :217-239). The
run still reports `ok:true` and advances the cursor by design, and the public
artifact strips the conflict entirely, so it reads as a clean success.

A full sweep of all 7,315 calendar cards (2026-08-09) found exactly **three**
whose card-side `*_deliverable_id` pointer disagrees with the Linear issue the
card links to — all one client, all inside the 2026-08-07 outage sequence, none
on the graphics team. Contained, not systemic.

The two sides have since diverged in a useful way. The DELIVERABLE side is
already correct and self-consistent — each row's `card_id` matches the card
whose name equals its Linear title:

| deliverable | claims card | card name | correct? |
|---|---|---|---|
| VID-12995 (Video 9)     | p_mrmzoeyu_6u70h | Video 9     | yes |
| VID-13262 (Video 9 Pt2) | p_mrmzofde_n36kt | Video 9 Pt2 | yes |
| VID-13261 (Video 8 Pt2) | — does not exist — | (slot free) | missing |

Only the CARD side is stale: those two cards still point at VID-12996 /
VID-12997 (both `origin=manual`, `card_id=null`), and the Video 8 Pt2 card
still points at VID-12995's row.

Does NOT block the flip: Video team, and no F2/F1 gate reads deliverable parity.

CLOSED 2026-08-10, fresh-eyes audit verification: VID-13261 exists
(`origin=calendar`, correct `card_id`, conflict count 0 on the ingesting run),
and all three card-side `video_deliverable_id` pointers now match their cards'
Linear links — the reconciler's linkage pass carried them once the deliverable
side was correct. Nothing remains here.

Original plan, kept for the record — two independent halves:

- **The missing video — one owner click.** Dispatch "B1 Linear Incremental
  Refresh" with `changed_since = 2026-08-07T15:00:00Z` and `apply` on. The slot
  is free, so this creates VID-13261. Verify by re-reading the conflict count
  on the resulting event: it must be 0.
- **The three stale card pointers — not fixed by that dispatch.**
  `b1-linear-backfill.js` never writes `video_deliverable_id`; the reconciler
  owns those columns and currently reports 40 actionable linkage writes in
  dry-run, above its own `cap` of 15. Applying 40 cross-client writes to
  correct 3 cosmetic pointers is disproportionate. Leave until someone reviews
  what the other 37 are.

## 12. [repair] F50 / F40 are surviving flip gates and appear in NO flip document

Found 2026-08-09 by gate audit, verified by hand. The 2026-07-28 owner re-scope
kept F50 (creative status projection) and F40 (per-team workload authority) as
flip gates, but neither is mentioned in `FLIP_RUNBOOK.md` or
`docs/independence/GRAPHICS_FLIP_STATUS.md` — the two documents the owner would
actually follow. That status doc instead says the last code blocker closed and
"what remains is soak time and evidence, not engineering."

F50, verified directly today:

- The native writer never touches the card. `grep` for
  `calendar_posts|video_status|graphic_status` in
  `supabase/functions/production-write/index.ts` returns **zero** matches; it
  writes `deliverables` only.
- Every client-facing surface reads the card columns instead —
  `graphic_status`/`video_status` appear 56 times each in `index.html`.
- Both bridges that currently reconcile the two disable themselves at flip:
  `production_assert_authority` raises `legacy_parity_not_allowed` once a team
  is not `linear` (migrations/2026-07-12-write-ui-outbox-parity.sql:228-230),
  and the reconciler logs `authority freeze: team is not live
  Linear-authoritative` (scripts/linear-sync-reconcile.js:313-316), with its
  write path gated on `authority === 'syncview'` (:268).

Net: the morning after the flip, a graphics status change would land in
`deliverables` and reach no reviewer or client surface — invisible to the
designer, who sees their own change fine. This is build work, not a drill, and
it is the flip's whole premise.

Done when: an owner decision picks "build the projection" or "move the readers",
the work ships, and both documents name the gate.

**The DOCUMENT complaint is resolved (verified 2026-08-22).** This entry's
headline — that the two gates "appear in NO flip document" — has not been true
for a while, and nobody had checked back. Both now name both gates at length:

- `docs/ops/FLIP_RUNBOOK.md` carries a **F50 — creative status projection**
  block ("recorded here 2026-08-10 per OPEN_REPAIRS item 12") and a **F40 —
  per-team workload authority** block that states the owner floor of 5 and the
  exact command the gate runs.
- `docs/independence/GRAPHICS_FLIP_STATUS.md` records **F50 closed** (#1053,
  merged 2026-08-10, both reconcilers pull-only) and **F40 closed** (#1054,
  merged 2026-08-11, plus the owner's full-window refresh), and reproduces this
  item's finding and the 2026-08-11 F40 correction verbatim.

Deliberately NOT claimed here: that the engineering gate is closed. That call
was the owner's and is recorded in those documents; this note only retires the
part of the complaint that was about documentation, so the entry stops asserting
something false about two files that have since been written.

### Design round 1 — DESIGNED, REFUTED, DO NOT BUILD AS WRITTEN (2026-08-10)

Direction settled: **build the projection**, as a SECURITY DEFINER SQL RPC
cloning `production_artifact_write`, not a reader migration. The reader
migration was measured, not assumed: 101 generic `[comp + '_status']` read
sites, each of which would have to branch per component because graphics flips
while video stays Linear-authoritative. That direction stands.

The detailed plan was then attacked by three independent reviewers and **all
three refuted it**, 21 defects. It must not be built as written. The three that
change the shape of the work:

1. **It would have broken production BEFORE any flip.** The plan ordered the
   parity early-return *ahead* of `production_deliverable_write`. Verified in
   live code: `legacyParityAllowed` admits exactly calendar/sxr + status/comment
   (`policy.mjs:364-371`) and `authorityLane` forces every other graphics write
   to 409 while authority is `linear` (`index.ts:1046-1057`) — so **100% of real
   graphics status writes are on the parity lane today**. Returning early there
   means the deliverable never persists and no `mirror_outbox` row is created,
   while the gateway still answers `ok:true, native_committed:true` from the
   unchanged row (`index.ts:4153-4162`). Silent total loss on the live path,
   introduced by the fix, before anyone flips anything. Correction: write the
   deliverable first, gate only the projection block on `p_legacy_parity`.
2. **It would resurrect archived cards.** The plan recomputes the overall
   `status` unconditionally; that un-archives archived cards and republishes
   them to clients.
3. **A live deliverable→card projector already exists and the plan ignored it.**
   `_writeUiAdoptReplayStatus` / `_writeUiDisplayStatus` (`index.html:23914-23937`)
   already writes card status from a deliverable status on the gateway replay
   path — with the pass-through vocabulary the plan's own §4 proves is harmful
   (unstyled pill, card drops out of Kasper's queue, permanently invisible to
   the client). A total SQL map does not help while that browser path still
   writes illegal strings into the same column.

**OWNER RULING 2026-08-10 — the unmapped statuses (settled, AMENDED same day;
do not re-open).**
The two vocabularies differ: 13 deliverable statuses against 8 calendar / 6
samples. The ruling arrived in two parts, both in the owner's own words:

1. First sitting: five statuses with no card equivalent (`triage`, `backlog`,
   `todo`, `canceled`, `duplicate`) keep the card's previous status, and the UI
   states plainly that the change is not reflected on the calendar. Reasoning,
   recorded because it governs future changes here: the calendar vocabulary is
   deliberately small so the team is not confused by it — these statuses are
   absent by intent and must not be "helpfully" added.
2. Amendment, same day, after the count showed 37 of 304 card-linked graphics
   rows sitting in `todo` (which would have blanked 37 cards at flip): **`todo`
   and `backlog` display as "In Progress"** — the owner: "keep In Progress for
   To Do and Backlog … this is what I originally did … I want our calendar to
   show In Progress when it's To Do or Backlog." This matches what the calendar
   shows TODAY for the equivalent Linear states, so the flip changes nothing
   visible. `triage`, `canceled` and `duplicate` remain keep-previous-status.
   The underlying rule both halves satisfy: **add no new words to the
   calendar** — todo/backlog need no new word; the other three would.

Implemented by `_calMapNativeStatusStrict` (index.html) and pinned exhaustively
in test/f50-native-status-map.js.

**The disclosure half SHIPPED 2026-08-22.** It had been a code comment since the
ruling, deferred as prospective because no card-linked graphics deliverable was
in an unmapped status at the time. Graphics flipped on 2026-08-16, so it is
prospective no longer, and the deferral was conditioned on "before the flip" —
which has passed. The ruling itself settled the behaviour, so shipping it
carries out the decision rather than making a new one.

The Production status picker now says, under Triage / Canceled / Duplicate on a
card-linked deliverable: *"Not shown on the calendar — the card keeps the status
it has now."* Three things about the shape, each deliberate:

- It is DERIVED from `_calMapNativeStatusStrict`, not from a hand-kept list of
  the three names, so the sentence can never disagree with what the projection
  does. It comes out right for free on the surface-specific case too: Scheduled
  and Posted are ordinary calendar words with no equivalent on a samples sheet,
  and a samples card gets the notice for them.
- It appears only where there is a card to be out of step with, and a
  multi-select says how MANY of the selected cards are affected rather than
  implying all of them.
- It lives in the picker, before the choice, not in a toast afterwards — a
  person deciding between Canceled and Duplicate should know what each one will
  and will not do, and one more after-the-fact notification is the noise the
  owner asked to be rid of on 2026-08-21.

Pinned by `test/f50-card-blind-status-disclosure.js`, which executes the real
helper against the real mapper across all 13 statuses on both surfaces; 8
mutations, all killed. Limitation stated rather than hidden: the picker branch
itself cannot be executed offline, so its two uses of the note are pinned at
source level and mutation-proved by removing each one.

## 4. [closed] client-review-link: deployed via the new lane, 2026-08-08

Corrected 2026-08-08 by measurement + owner observation: live is v3 (not the
manifest's hand-written "v2"), still NOT the #1016 fix (fingerprint
live != main, verified), but lukecutting's link WORKS — old code + working
link proves his token was backfilled. Blast radius is therefore FUTURE clients
only. The owner approved deploying; the session cannot run production CLI
deploys, so the deliberate-manual lane was replaced with a dispatch-only CI
lane (`deploy-client-review-link.yml`) — production-Environment approval
preserves the deliberateness, and the fingerprint readback gates the run.
Never-rotate is held by construction (reuse on any non-blank token;
CI-exercised policy).

CLOSED: the owner dispatched the lane on 2026-08-08 (after #1044 fixed the
pasted-SHA validation that failed run #1); the deploy run went green with
readback PASS, and live v4 == main was independently verified. Future-client
mint-on-demand is now actually deployed.

## 5. [watch] Shadow audit: first meaningful verdict after re-classification

The lane had NEVER passed (0 green in its entire history; ~4,100 "unexpected"
divergences daily since 2026-07-24). Diagnosis 2026-08-08: its classifier
predates the attribution stamps, so the entire `attribution_stamp_absent`
class — historical rows written before stamps existed, the same family the
reconciler deliberately reports as non-gating — landed in "unexpected".
Re-classified (this PR): absent stamps are expected-explainable;
`attribution_claim_mismatch` (a WRONG stamp) stays red; the telemetry event now
carries per-reason maps.

- The watch FIRED on 2026-08-09 (first reclassified run, 05:58Z):
  unexpected_divergences collapsed 4,065 → 14, and the by-reason map names
  them — parent 5, assignee 5, batch_title 3, state 1; 7 video / 7 graphics.
  The heartbeat also proved (row present, `ok:false` as expected).
- The 14 are a STABLE SET, not transients: unexpected_intents was exactly 14
  on both the 2026-08-08 and 2026-08-09 runs (34/35 before the 2026-08-07
  fix-wave deploys). Persistent field-level drift on ~14 entities —
  the real residue this lane existed to find.
- Remaining before the flip: WHICH 14. The row detail lives only in the
  runner-local private artifact, so the telemetry now carries a bounded
  `unexpected_divergence_sample` ({entity, team, identifier, reasons} — no
  client slugs, no values; same public-safety precedent as the reconciler's
  `inbound_identifier_sample`). Next 05:17Z run — or a manual
  workflow_dispatch of production-shadow-audit.yml after merge — names the
  rows; then characterize each as repair / tolerated-historical stamp / real
  drift. Done when the 14 are dispositioned.

**Repair executed 2026-08-10 (owner, SQL editor; EXECUTION_LOG entry of the
same date):** the five `outbound_parent_mismatch` GRA rows were re-batched to
the fresh graphics batch. Expectation for the next 05:17Z run: unexpected
divergences drop from 12 to ≤7 and the five GRA parent rows leave the sample.
If the count is ABOVE 7, the repair did not take — investigate before
trusting anything else that morning.

### Six of the twelve diagnosed 2026-08-10 — one cause, one character

The 05:17 run named the rows. Five `outbound_parent_mismatch` (GRA-6893…6897)
and one `outbound_batch_title_mismatch` (GRA-6892) are **the same defect**.

The importer's batch grouping key is `client | parent title | parent
description`, normalised and lower-cased, and **the team is not part of it**
(`b1-linear-backfill.js:177-184`). One client's 29 Jul work has two batch cards
whose titles differed only by a capital `B`, and after a 2026-08-03 13:43 edit
their descriptions normalised identically too. From that moment the two cards
produced the SAME batch id, so the graphics children were filed into the video
batch. Linear itself was never wrong: all five still report the correct parent.

Owner renamed the graphics card 2026-08-10 16:33 to break the collision. The
parent re-filed itself into a fresh graphics batch on the next run.

**The five children did NOT move, and no importer run will ever move them.**
They are in `completed` Linear states (`Approved` / `Posted`), so `isOpenIssue`
is false (`:130-133`), so they are excluded from `operationalIssues` (`:697`) —
and only the operational path recomputes `batch_id` from `batchGroupKey`
(`deliverableRow`, `:788`). The soft-closed path preserves it verbatim
(`softClosedDeliverableRow`, `:1104`). This is deliberate and correct in
general; it just means a batch mis-grouping that lands on a finished item is
permanent until something writes the row directly.

Consequence for the flip: post-F1 the reconciler would emit a real write for
each — "set this issue's parent to the batch's parent" (`…-lib.js:600-603`) —
moving five Graphics issues under a Video batch card in Linear. Must be
repaired before the flip, not after.

Repair is a bounded 5-row `batch_id` update, owner-run (this session cannot
execute SQL). The durable fix — put the team in the grouping key and drop the
"no entry for your team, use whoever's first" fallback
(`linear-deliverables-reconcile.js:518-519`) — is a separate PR, and it needs a
decision because batch ids are a hash of that key, so changing it re-mints ids
for existing rows. Worth doing: naming the video and graphics batch cards
identically is the house convention, so this recurs.

## 6. [watch] Nightly E2E lanes: samples red 26 nights, calendar 16

> **SUPERSEDED 2026-08-22 by item 25, and again 2026-09-03 by item 138.** Read
> those first — this header's counts have been wrong since 2026-08-22 and the
> lanes have moved twice more since. Item 25 diagnosed one assertion per lane
> and fixed both; **item 138 read the actual runs and confirms both fixes
> worked** — samples went GREEN on 2026-09-02 (run 62, its first success in the
> visible history) and the calendar's p92 now passes. What is red today is not
> what was red when this entry was written: samples on a fixed-sleep race in the
> opt-out probe, the calendar on three probes that assert the pre-F1 video
> link-paste contract.


**2026-08-11 — TRIAGED. The nightly could not report its own failure.** Run
`31468417739` (27th consecutive red) says `tree paths 23/24 fully green ·
assertions 200/210` and then lists 19 [PASS] lines. The five video
client-approval paths — one of which holds the ONLY failure — appear nowhere:
not as PASS, not as FAIL.

They ran. Arithmetic proves it: the 19 printed paths carry 150 assertions, the
summary counts 210, and the graphic client subtree (the video subtree's exact
twin, since `samplesReviewTree` is compiled once per component) is exactly 60.
So 60 assertions ran unprinted, 50 passed and 10 failed.

Cause, in `qa/master.js`: a failing scenario lane reported `tail(r.out, 25)` —
the LAST 25 lines. `run_scenarios.js` prints one line per path as it runs and
puts a failing path's assertion detail immediately beneath that path's own line,
and the video tree is compiled first, so the diagnosis was always among the
first lines printed and always the first thing the tail discarded. Four weeks of
a report naming every path except the broken one.

Fixed by selecting failure output by MEANING rather than position:
`failureDigest()` keeps every `[FAIL]` line, the indented detail beneath it, and
the trailing SUMMARY, capped, with a tail fallback for a crash that emits no
`[FAIL]` at all. `test/master-failure-digest.js` reconstructs the exact shape
and asserts both that the digest recovers a first-line failure AND that the old
positional tail genuinely lost it — mutation-proved (reverting either lane fails
4 checks).

**This does not fix the underlying test failure** — it makes it legible for the
first time. The next nightly will name the failing video client path and print
its assertion detail; triage that from a report that can finally speak.

Done when: the next samples-e2e nightly names its failing path, and that path's
actual defect is diagnosed and fixed (or the run goes green).


samples-e2e-nightly first red: run #10, 2026-07-13. calendar-e2e-nightly first
red: run #34, 2026-07-23. Both carry a "page on scheduled failure" webhook step
that has delivered zero pages across all 42 failures (secret absent → the step
degrades to a log warning). Both are now dead-man's-switch lanes (this PR), so
the next watchdog pass after their next scheduled runs pages `ran and failed`
once and latches. Triage starts from the FIRST red run of each streak, not the
latest. Until triaged, treat both suites' coverage as absent, not as failing.

**Correction 2026-08-10 (fresh-eyes audit):** the samples lane failed AGAIN on
post-#1045 code (run 31367788634) — the "pre-merge code" explanation held for
the 08-10 06:00Z run only, and the residual failure is real and untriaged.
Calendar has been green two days running. Samples needs a fresh triage from
that run's failure codes; treat samples coverage as absent until then.

Update 2026-08-09: TRIAGED and fixed — #1045 (merged 2026-08-09) carries the
full diagnosis (samples: depth-1 checkout broke the git-dependent unit tests,
plus F141 write-gating 401ing the unsigned harness; calendar: teardown
AbortController races read as JS errors, plus p93) and the fixes. The
2026-08-09 06:00Z samples run still went red on pre-merge code — correctly
heartbeated `ok:false` and correctly PAGED (see item 11). Watch: the first
post-merge scheduled runs (samples 06:00Z / calendar 08:00Z, 2026-08-10).
Done when both lanes run green on schedule.

## 7. [repair] Description round-trip still parked at `observe`

`PRODUCTION_WRITE_DRILL_DESCRIPTION_ROUNDTRIP=observe` was to flip to `enforce`
"once the description-mirroring Edge Function revision is deployed". The
2026-08-07 deploys made live == main for all four gateway functions, yet drill
#32 still recorded `description_readback_scope: not_verified` — so either the
gating comment's premise is wrong (the revision it waits for is not these four
functions) or something else eats the round-trip. Needs one diagnostic drill
dispatch with a longer `PRODUCTION_WRITE_DRILL_DESCRIPTION_OBSERVE_MS` and a
read of the mirror receipt for the description dedup key. Do NOT flip to
`enforce` on faith — that recreates the 22-red-nights pattern.

## 8. [closed] Soak policy: the clock STANDS — owner ruling 2026-08-08

Owner ruled 2026-08-08 ("I would keep counting"): the 2026-08-07 deploys
(v38/v33) ANNOTATE the soak, they do not reset it. Clock: started
2026-08-07T15:17Z; day 1 completed clean; flip decision window opens
2026-08-11T15:17Z (day 4) and closes 2026-08-12T15:17Z (day 5). The two
readings differed by under six hours anyway — the deploys landed ~5.5h after
enrollment — which is why this was safe to ratify rather than agonize over.

## 9. [closed] Flip staging: staged, then PROVEN end to end — GO printed 2026-08-11

`FLIP_RUNBOOK.md` requires, before F2: the production Environment holding
`GRAPHICS_F2_READONLY_DATABASE_URL` (+ two more secrets), the one-time
evidence-role ACL revoke, and a literal `GO graphics_f2_preflight` receipt.
~~None exist yet and nobody is named to stage them.~~ **CORRECTED 2026-08-11:
that claim was wrong.** Walking the checklist live found the owner had already
staged two of the three prerequisites roughly a week earlier: all three
`production` Environment secrets existed, and the one-time ACL revoke was
already applied (paste #2 raised `graphics_f2_target_public_execute_missing`,
its own already-done signal). Only the evidence ROLE was genuinely absent —
which is the piece the runbook demanded but never supplied SQL for, and the
reason the gates read as unsatisfiable. The lead time was hours, not days.

**2026-08-11 — staged into a paste-ready sequence.** The runbook demanded a
precisely-constrained evidence role but never provided the SQL to create it —
that gap is what made the gates "unsatisfiable". `docs/ops/F2_STAGING_CHECKLIST.md`
now carries the owner's exact five-step sequence: the role-provisioning block
(self-verifying against the same catalog checks `graphics-f2-evidence.js`
runs, so a mismatch is a readable error today instead of a REFUSE on flip
night), the three `production` Environment secrets with exact names and the
pooler username form, the pointer to the runbook's fenced ACL-revoke block,
and the GO-preflight dispatch. Remaining work is owner paste/click only.

**Live progress 2026-08-11:** role created and self-verified (RLS enabled on all
four evidence tables with today's read access preserved — anon reads confirmed
working immediately after: flags, `deliverable_events`, `flag_flips`, and an
untouched control table all still readable with the publishable key);
`GRAPHICS_F2_READONLY_DATABASE_URL` repointed at the new role; ACL revoke
confirmed already applied. Only the GO pre-flight dispatch remains.

Done when: the pre-flight prints its `GO graphics_f2_preflight` line.

**CLOSED 2026-08-11 ~22:24Z — the pre-flight printed the literal GO.** The full
chain ran end to end on production: pre-f2 evidence run `31530468004` PASS
(binder `f2-graphics-…`, release `7c0822cf`) → scheduled drainer `31542047873`
→ `GO graphics_f2_preflight` with `production_residue=0` across both parity
lanes and all attempts. Every machine gate this item once called unsatisfiable
is proven satisfiable on production. The completion record — plus the three
flip-night lessons learned the expensive way (a GO is consumed immediately or
not at all; the n8n 15-minute drainer dispatch eats two of every three
pre-flight windows, so disable that single node with owner approval and keep it
disabled until post-f2 PASSes; GitHub really runs the `*/10` cron at 44–69
minute gaps) — lives in `docs/ops/F2_STAGING_CHECKLIST.md`. The staging chain
itself is consumed by design: flip night rebuilds a fresh one (fresh pre-f2
evidence, fresh binder, fresh scheduled run, fresh GO) on whatever `main` is
current then. What carries over: the provisioned evidence role, the three
Environment secrets, and the proof the machinery works.

## 10. [closed] `scripts/write-ui-soak-pager.js` — retired 2026-08-22, not deleted

The n8n pager transform was never applied and its pinned precondition
(versionId `16a436c6…`) no longer matches the live workflow (`ed76a77f…`), so
it refuses to apply — correctly. With #1041 the dead-man's switch now covers
both halves (stale + ran-and-failed) for the drill and shadow lanes through a
delivery-proven channel; the transform's six conditions are redundant except
for cosmetic threshold differences. Default: retire it (delete or mark
superseded) rather than re-pin and apply against a drifted production
workflow. Owner may overrule.

**RETIRED 2026-08-22, and kept.** The standing rule is do not delete anything, so
the file and its transform stay exactly as they were and stay covered by
`test/write-ui-soak-pager.js` — which is precisely what makes a deliberate
revival cheap. What changed is that the CLI now refuses instead of reaching for
the live workflow, and it says why.

It refuses in BOTH modes, which is the part worth stating: a dry run is not the
safe half here. It reads a production workflow and prints a plan that must not
be carried out, and the drift has since grown — the live version moved again on
2026-08-21 when the `v2_nonzero` alert was muted at the owner's request.

To revive: re-read the live workflow, update `LIVE_PRECONDITION` to its current
versionId and condition hash, remove the guard, and record here why the #1041
dead-man's switch is no longer sufficient. 4 mutations, all killed, including
one that refuses only `--apply` and leaves the dry run pointed at production.

## 11. [closed] The #1041 failing-lane page: proven live, twice

Proven end-to-end. First live traversal 2026-08-08 06:24:56Z
(production_shadow_audit `ran and failed` — watchdog → relay → Slack,
delivered). Second, independent lane: 2026-08-09 08:05:56Z latch for
samples_e2e_nightly (`incident_kind: failing`) after that morning's red
pre-#1045 run. The latch ledger shows the full designed lifecycle —
latch on failure, reset on recovery — across four lanes. Closed.

## 13. [closed] Seven terminal mis-filed rows — verified healed 2026-08-11, no SQL needed

> **⚠️ DUPLICATE NUMBER.** Two entries claim `13`. **This one is the seven terminal mis-filed rows (promoted 2026-08-10, verified healed 2026-08-11).** The other `13` is the TEST-client ghost calendar cards (2026-08-14), and that is the one meant by every `OPEN_REPAIRS 13` reference in `index.html` (the "MAKE THE RELOAD ADVICE TRUE" block), `test/write-ui-failure-messages.js` and `EXECUTION_LOG.md`.

Surfaced by #1051's review, promoted here 2026-08-10 so it stops living only in
a PR description. Three batch-title collisions (same mechanism as item 5's GRA
family: two same-named parent cards collapsing to one batch id) mis-filed rows
of which **7 are in completed Linear states** — so, exactly like the GRA-6893
family, no importer path will ever re-batch them; they need the same bounded
owner-run SQL repair. The three batch ids (suffixes): `…9fb82565`,
`…4f72032f`, `…21c377ea`. The open siblings re-batch themselves now that
#1051 accumulates the parent map; ONLY the terminal 7 need hands.

**CLOSED 2026-08-11 — verified against live data, the owner SQL is no longer
needed.** The owner authorized the repair; deriving the exact rows found the
defect gone. All three mechanisms checked, all empty:

1. No row inside any of the three batches has a foreign parent — every child's
   `raw_issue_parent_id` resolves to one of that batch's own parent cards.
2. No child of any of the six parent cards sits in a different batch (0 strays).
3. No same-named sibling batch exists for any of the three names (the GRA-689x
   shape).

What healed them: the "mis-filing" was the truncated parent MAP (a batch that
did not know one team's parent, sending the reconciler to the wrong team's
card), and the 2026-08-11 full-window refresh ran #1051's merge over every
batch — `…9fb82565` and `…4f72032f` now carry BOTH team parents. The terminal
children never needed to move; their batch needed to learn their parent, and it
did. The third batch (`…21c377ea`, missing its graphics map entry) is a
non-issue: its entire four-issue family is ARCHIVED in Linear (2026-08-05/07),
so it is excluded from every operational set and can distort nothing, pre- or
post-flip. Its map entry would heal only via item 14's full backfill, which is
where that residue now lives.

Original done-condition kept below for the record.

Done when: the owner runs a guarded exactly-N UPDATE per batch (same shape as
the EXECUTION_LOG 2026-08-10 repair) and the next audit shows no parent
mismatches for these families.

## 14. [repair] The #1051 parent map can never FORGET a stale entry

> **⚠️ DUPLICATE NUMBER.** Two entries claim `14`. **This one is the #1051 parent-map stale entry** and is the one meant by `.github/workflows/b1-linear-incremental-refresh.yml` and by the `outbound_parent_mismatch` rule in `PRE_FLIP_HEALTH_CHECK.md` (POST-FLIP item 5). The other `14` is the `artifact_not_resolvable` wrong-dialog fix (2026-08-16, closed 2026-08-22), which is what `test/write-ui-failure-messages.js` means.

#1051 deliberately made the incremental importer merge-not-replace the
per-team parent map — clearing by omission was the bug. Consequence, flagged
by the fresh-eyes audit: a parent entry whose card was genuinely deleted or
re-filed in Linear now lives forever, because no scheduled job runs the full
backfill (both workflows pass `--incremental`), and post-flip the reconciler
turns a stale entry into a real Linear parent write
(linear-deliverables-reconcile-lib.js:594-604). One scary-but-inert specimen
already exists on a zero-children batch.

**2026-08-11 — the lane now exists; the run is an owner dispatch.** The blocker
was not that a full backfill is hard, it is that NOTHING COULD RUN ONE: every
workflow passed `--incremental` unconditionally, so the authoritative path that
replaces (and therefore may clear) the parent map was unreachable from the
repository. Same shape as F40 — a correct code path no job touches, invisible
until the moment it matters. `b1-linear-incremental-refresh.yml` now takes a
`mode` input (`incremental` default / `full`), with:

- a scheduled run pinned to the literal `incremental` by expression, so no cron
  can take the authoritative path by accident;
- `changed_since` REFUSED with `mode=full` rather than ignored, since full
  already sweeps everything and accepting both would misreport coverage;
- the script's own pre-existing freeze doing the real gating — a full apply
  requires a LIVE flag read confirming BOTH teams Linear-authoritative
  (`assertFullApplyAuthority`), so this lane closes itself at F1 instead of
  depending on the operator remembering.

`test/b1-full-mode-lane.js` pins all of it, mutation-proved twice: restoring the
unconditional `--incremental` fails, and dropping the cron guard fails.

**Recommended sequence (owner, after the F2 GO — it re-shas nothing, but one
thing at a time):** dispatch `mode=full` with **apply OFF** first. That is a
read-only measurement and its plan reports exactly how many batch rows the
authoritative map differs on, which sizes the repair before any write. Then
re-dispatch with apply ON if the number is sane.

Done when: a full-mode apply run has completed pre-F1 and the next audit shows
no stale parent entries.

**2026-08-12 — DO NOT RUN THE APPLY. The lane above cannot close this item, and
running it would risk re-creating the damage #1051 healed.** The owner dispatched
the recommended read-only sizing run (`mode=full`, apply OFF, run `31551247143`
on `e880dc41`). It reported `planned_write_counts.batches = 5`. Investigating
what those 5 are, before authorising a write, found three things that together
invert the recommendation above:

1. **It cannot reach this item's own specimen.** The paragraph above names a
   "scary-but-inert specimen on a zero-children batch". `batchRowsFor`
   (`scripts/b1-linear-backfill.js:712`) groups only issues that survived the
   operational filter (`:705-709`: open AND (card-linked OR created inside the
   12-month cutoff)). A batch with no qualifying open child produces no group,
   so its row is never built, never compared, never written. The apply would
   leave the named defect exactly where it is.

2. **Full mode REPLACES the parent map from a NARROWER, STALER child set than
   the one it overwrites.** The incremental lane merges (`:1350`
   `mergeBatchParentIds`) and windows on `now` (`:1250`). The full path does
   neither: no merge (`:1120-1128`), and `asOf` is the hardcoded literal
   `'2026-07-05T00:00:00.000Z'` (`:1046`) — five weeks stale and drifting
   further every day. So the authoritative map is computed from fewer children
   than the accumulated state, then written over it. A batch whose graphics or
   video children are merely CLOSED, or fall outside that frozen window, loses
   that team's parent entry. `batchParentId` then falls back to the first parent
   of any team (`scripts/linear-deliverables-reconcile.js:514-519`), which
   post-F1 is a real Linear reparent under the wrong team's card — the exact
   93-batch shape the 2026-08-11 refresh healed. The repair runs backwards.

3. **`5` was never a count of stale parents.** The filter at `:1120-1128` counts
   a batch when it is NEW, when any scalar field drifted, OR when the parent map
   differs — and `batchParentsChanged` is symmetric, firing equally for an entry
   that is stale-and-extra (this item) and one that is legitimately missing (the
   opposite problem). The per-batch breakdown existed only in the runner's
   `.codex-tmp/b1-private.log`, which the workflow deliberately never uploads;
   the public artifact is counts-only by construction
   (`scripts/public-b1-artifact.js`). Re-running the sizing cannot recover it.

**Doing nothing is the cheaper risk, and the failure mode is visible rather than
silent.** Post-F1 a stale entry surfaces as `outbound_parent_mismatch` in the
deliverables reconciler, which n8n dispatches with `apply: "false"` (workflow
`qllIDZPkdNAPRj0b`, node `Trigger Reconciler V2`, `cap 15`). Converting it into
an actual Linear write takes a deliberate manual apply dispatch. So the cost of
leaving it is an alert somebody reads; the cost of the apply is an unattended
write with no transaction and no resume (`applyPlan` `:1529-1584` has neither,
writes every batch before any deliverable, and uploads its artifact only on
success — a mid-run failure or the job's 20-minute timeout leaves production
half-written with the log discarded).

This corrects the "Recommended sequence" above, which this repo wrote on
2026-08-11. The sizing step was right and did its job: it is what surfaced all
of this. The "then re-dispatch with apply ON" half is withdrawn.

**Item 14 is therefore NOT closable by this lane.** It stays open as a
monitor-only item: watch `outbound_parent_mismatch` after F1, and never dispatch
the deliverables reconciler with `apply=true` without first checking the
mismatch list by hand. A genuine fix needs either a targeted write against the
specific batch rows, or a full path that MERGES and windows on `now` — neither
of which exists today.

**Separate finding, not a flip gate, filed here because it was found here.**
Every B1 deliverable write — the 30-minute incremental lane included, not just
full mode — sends `file_url: null` and `comments: null` as PRESENT keys
(`deliverableRow` `:906-907`; `applyPlan`/`applyIncrementalPlan` send the whole
unprojected row as `p_row`; `supabaseRpc` `:592-605` is a bare
`JSON.stringify`). The RPC's guard is key-PRESENCE, not value
(`migrations/2026-07-06-b1-linear-data-model.sql:560-561`,
`case when v_row ? 'file_url' ...`), and a JSON null satisfies `?`, so both
columns are set to NULL on every row written. `deliverableFields` (`:1118`) is
the COMPARISON list only, so neither column can ever appear in a plan. Because
the incremental lane has done this every 30 minutes for months, this is either a
long-standing silent data loss or those two columns are vestigial for
B1-managed rows. It could not be measured from here: the anon key has no
column-level SELECT on `deliverables.file_url`/`.comments` (401), so it needs an
owner-side read to settle. Do NOT treat this as a reason to prefer incremental
over full — both do it identically.

## 15. [repair] F40's code was ready; its DATA was not — every audited graphics row

Found 2026-08-11 by probing the native read against live data rather than
reading its code. Item 12 recorded F40 as "unbuilt". That was wrong by the time
it was written: the browser already routes a SyncView-authoritative team's due
dates to the native gateway (`wlDueWriteRoute`, `wlFetchNativeMetadata`), so
`workload-linear`'s `team_is_syncview_authoritative` 409 is never reached. The
gate that actually survives is the data the native reader depends on.

Measured on live data, active graphics sub-issues (`f40-workload-readiness.js`):

| | graphics | video |
|---|---|---|
| active sub-issues | 328 | 1161 |
| provable natively | 186 | 363 |
| **unprovable** | **142** | **798** |
| — label relation erased | 133 | 161 |
| — no `deliverables` row | 9 | 637 |

**Cause.** `scripts/b1-linear-backfill.js` selected the issue without its
`labels` relation and stored that issue verbatim as `linear_raw.issue`, while
`deliverableFields` lists `linear_raw` — so every write REPLACED the column and
erased the relation `linear-inbound` had carefully preserved
(`linear-inbound/index.ts:451-452`). Because `sameValue` compares objects with a
bare `JSON.stringify`, a stored relation always differed from B1's label-less
build, so the rewrite fired: a one-way ratchet toward stripped. Fixed by adding
`labels(first: 250) { nodes { id name color } pageInfo { hasNextPage } }` to the
selection, pinned by `test/b1-workload-labels-preserved.js`.

**Why it was invisible.** The native branch is taken only when
`authority[team] === 'syncview'`, so with both teams on Linear it never runs.
Every defect in it was latent and would have appeared for the entire team in the
same minute. All 219 unit suites passed throughout.

**Second fix — blast radius.** `wlFetchNativeMetadata` threw on the first
unprovable row, and that throw failed the whole syncview partition: one bad row
blanked every graphics due date and disabled editing for all of them. The
safety property worth keeping is only "never apply a weight we cannot prove",
which excluding the row satisfies exactly. Unprovable rows are now withheld
individually and reported through the existing `partialFailure` path. Existing
coverage used single-issue reads, where throwing and withholding look identical;
the multi-row case is now pinned in `test/workload-linear-browser.js`.

**Ordering — this is the part that cannot be got wrong.** B1 writes a
deliverable only while its team is Linear-authoritative (`deliverableAllowed`),
so it cannot repair graphics AFTER F1. The healing full-window run must precede
the flip.

~~Converges with item 14 — one run satisfies both.~~ **CORRECTED 2026-08-11,
reset audit: this convergence claim was wrong.** The owner's healing run was the
refresh workflow, which ALWAYS passes `--incremental` — a full *window* is not
full *mode*. Incremental merges the batch parent map (that is #1051's fix) and
therefore can never clear a stale entry; only the non-incremental path replaces
the map authoritatively, and no workflow exposes it. The label heal is real; the
item-14 stale-parent risk is untouched and remains open before F1.

**What the backfill will fix.** Within the audited population it should clear
every erased label relation, and the 5 remaining missing rows — all of which
belong to a current roster client, so attribution resolves and B1 will import
them. Off-roster rows are skipped forever (both plan paths filter on
`r.client_slug &&`), but as the correction below establishes, those never reach
the page in the first place. **OWNER RULING 2026-08-11 — ACCEPTED.** In the owner's words: *"for Danny
Morrell and Lucas Alame, they're not client of ours anymore, so I don't really
care."* The rows stay as they are.

**CORRECTION, same day — they were never a risk at all, and the first version of
this gate was wrong.** A Codex review of PR #1054 pointed out that the Workload
page filters candidates through `wlIsAllowedClient` (index.html:13996) before
anything reaches the native reader. Checking that claim against the source found
it true, and found a second filter it did not mention: `wlIsActiveStatus`, which
also drops parked and terminal issues. So the gate was auditing a population the
page never loads. Corrected numbers for graphics: of 327 active sub-issues, 243
are parked/terminal and 4 are off-roster — including all three ex-client rows —
leaving **80** the page actually loads. The expected floor is therefore **0, not
3**, and `PRE_FLIP_HEALTH_CHECK.md` item 10 is corrected to match.

The same review also caught the gate accepting a projection row on the WRONG
team: it tested membership in `{video, graphics}` where the browser requires
equality with the mirrored issue's team (`nativeTeam !== team`,
index.html:14145). A mislinked or mid-move row would have read as provable and
the gate could have reported READY for a row the page refuses. Both fixes are
pinned in `test/f40-workload-readiness-source.js` and mutation-proved; the
population pins had to be tightened to the ASSIGNMENTS, because the predicates
also appear in the negated reporting lines and a substring pin stayed green
while the real filter was deleted.

**RESOLVED 2026-08-11 — the repair worked, measured end to end.** #1054 merged
(`35ba7711`), then one owner-dispatched full-window refresh
(`changed_since=2020-01-01T00:00:00Z`, run `31509332785`). Graphics moved from
**0 provable / 83 unprovable to 70 provable / 5**, with `label state incomplete`
going **78 → 0**. Every relation B1 had erased is restored, and the ratchet is
closed at the source.

**The 5 that remain are not a bug and not fixable by another refresh.** They are
`GRA-4260`–`4264` (plus their parent `GRA-4259`), sub-issues of a current roster
client, non-parked — so the Workload page does load them. B1's operational
filter is `linked || alreadyTracked || created >= cutoff`
(`b1-linear-backfill.js:1286-1294`) and all three are false: created
**2025-06-16**, outside the **12-month** `--cutoff-months` default, no card link,
no existing row. B1 archives them by design. This also corrects the guess made
earlier in this item that they would heal once attribution resolved — the cause
is the cutoff window, verified against both the code and the issues' creation
dates, not the f200 mapping.

**OWNER RULING 2026-08-11 — ACCEPTED, do nothing. This item is CLOSED.** In the
owner's words: *"Luciana doesn't even work with us anymore… if it's backlogged,
does it really matter… they were created like a year ago, so yeah, it doesn't
matter. I guess we just do nothing."* The gate floor is 5: PASS at 5, FAIL above
it. F40 no longer blocks the flip.

Worth recording so nobody re-opens this expecting a loss: all six issues have
**no due date set at all**, so nothing disappears from anyone's screen at F1 —
the box is already blank. The only forfeited capability is *adding* a deadline
to those six from the Workload page, and Linear can still do it.

**Spun out of this ruling — a separate, non-blocking finding.** The owner
mentioned in passing that the assignee no longer works here. She still holds
**9 active graphics sub-issues** (`GRA-4260`–`4264` plus `GRA-4312`–`4315`),
across 2 clients, all Backlog and none parked — so the Workload board still
counts her as a working editor with a queue. Since #1050 made automatic
placement capacity-aware, an editor who cannot work distorts the capacity math
for everyone else. Not a flip gate and not urgent; tracked here so it is not
rediscovered from scratch. Fix is reassignment or closure in Linear, an owner
call, not a code change.

**Proven live, the expensive way (2026-08-11).** A full-window refresh was
dispatched on `main` BEFORE this fix was merged (run `31444949880`). The old
selection rewrote every graphics row it saw, and the gate went **186 provable →
0**: all 318 remaining relations stripped in a single pass. That is the ratchet
described above, running at full speed, and it is the clearest possible
demonstration that the defect is real. It is also fully recoverable — a
full-window run WITH the fix restores every relation from Linear — and it is
invisible to users, because nothing reads this projection until F1. The lesson
for the runbook: **the healing run is only healing if the fix is on `main`
first.** Dispatching it earlier actively makes the number worse.

Done when: `node scripts/f40-workload-readiness.js --team=graphics` PASSes at
or under the owner-accepted floor of **5** unprovable rows — the 2026-08-11
ruling is encoded in the script itself (`ACCEPTED_FLOORS { graphics: 5 }`,
merged PR #1061), so the bare run's exit code IS the gate — and that check is
part of the pre-flip gate (now item 10 of `PRE_FLIP_HEALTH_CHECK.md`).
Satisfied as measured 2026-08-11: exactly 5 unprovable = PASS. (An earlier
version of this line demanded 0 unprovable rows; the owner ruling above
superseded it.) Video's 798 do not gate the graphics flip — video keeps using
the Linear gateway — but must close before any video flip.

## 13. [closed] TEST-client ghost calendar cards — swept, and the loop closed

> **⚠️ DUPLICATE NUMBER.** Two entries claim `13`. **This one is the TEST-client ghost calendar cards (2026-08-14)** and is the one meant by every `OPEN_REPAIRS 13` reference in `index.html` (the "MAKE THE RELOAD ADVICE TRUE" block), `test/write-ui-failure-messages.js` and `EXECUTION_LOG.md`. The other `13` is the seven terminal mis-filed rows (2026-08-10).

Found 2026-08-14 while drilling the comment front door. The TEST client's
calendar renders cards (e.g. "Sample 1") whose backing `deliverables` rows no
longer exist, so every status/notes save against one is refused by
`production-write` with `entity_not_found` — correct fail-closed behavior, but
the card keeps rendering (localStorage cache survives hard refreshes, and a
failed background refetch silently keeps stale rows), so it presents as "saving
is broken" to whoever clicks it. Not caused by the 2026-08-14 deploy (diff
`58856fce…bea22afb` touches only the two client-comment authorization
branches); the TEST client is full of harness debris (B3 HARNESS, MIRROR
PROBE rows) and something deleted the Sample rows out from under the cards.

Scope check before fixing: is any REAL client rendering ghost cards, or is
this TEST-client debris only? (A read-only sweep comparing rendered card
sources against live `deliverables` ids answers it.) Fix directions, in
preference order: make the card render read the row's live existence (drop or
badge cards whose id no longer resolves), and/or purge the TEST client's
orphaned card entries. Low priority; nothing blocks the flip — but close it
before the next time someone drills on the TEST client.

Done when: the TEST client's calendar shows no card whose save 404s, and a
ghost card elsewhere (if the sweep finds any) has a decided disposition.

**CLOSED 2026-08-22.** The scope check the item asked for was run as a read-only
sweep of every card on every client, comparing each stored
`video_deliverable_id` / `graphic_deliverable_id` against live `deliverables`:

```sql
select p.client, count(*)
  from calendar_posts p
 where p.id <> 'p_cal_settings'
   and ( (nullif(trim(coalesce(p.video_deliverable_id,'')),'') is not null
          and not exists (select 1 from deliverables d where d.id = p.video_deliverable_id))
      or (nullif(trim(coalesce(p.graphic_deliverable_id,'')),'') is not null
          and not exists (select 1 from deliverables d where d.id = p.graphic_deliverable_id)) )
 group by 1;
```

**Zero rows, on every client including TEST.** No card anywhere points at a
deliverable that does not exist, so there is nothing left to purge and no real
client was ever affected. That answers both halves of the scope question.

What was NOT fixed by that, and is now: the browser loop. `entity_not_found` and
`batch_not_found` are in the `reload` class, so the dialog tells the person to
reload — but the display cache lives in localStorage and survives a hard
refresh, so the stale card came straight back and refused again. That is why it
presented as "saving is broken" rather than as a missing row. Those two refusals
now drop the display caches first, so the reload the message asks for actually
reads server truth.

The shared evictor is used rather than a per-slug delete because the refusal
does not carry the slug it was raised for, and it already refuses to touch a
cache holding unacknowledged repair state — the one thing in there that is not
re-fetchable. That guard predated this use and nothing pinned it; it is pinned
now, because relying on it silently would have turned a stale-card recovery into
data loss. `test/write-ui-failure-messages.js` sections 9 and 10; 6 mutations,
all killed.

The remaining fix direction on record, deliberately NOT built: making the card
render check the row's live existence. With zero instances in the data that
would be speculative work, and the eviction closes the loop that made it hurt.

## 14. [closed] `artifact_not_resolvable` shows the wrong dialog — closed 2026-08-22

> **⚠️ DUPLICATE NUMBER.** Two entries claim `14`. **This one is the `artifact_not_resolvable` wrong-dialog fix (found 2026-08-16, closed 2026-08-22)** and is the one meant by `test/write-ui-failure-messages.js`. The other `14` is the #1051 parent-map stale entry, which is what `.github/workflows/b1-linear-incremental-refresh.yml` and the `outbound_parent_mismatch` rule in `PRE_FLIP_HEALTH_CHECK.md` mean.

Found 2026-08-16 during post-flip live testing. Moving a graphics card to
**For SMM Approval** runs `assertGraphicsApprovalArtifact` (production-write
`index.ts`): the card's `file_url` must resolve to a live artifact — the EF
probes the link before allowing the review request. Correct, deliberate gate
(fired correctly on a TEST card with no real file; Kasper-approval/Posted
transitions have no such requirement and passed).

The defect is presentation only: the frontend's error-category map files
`artifact_not_resolvable` under the 'reload' bucket (index.html ~24424), so
the user sees "This page is holding an out-of-date copy… reload the page" —
which is false and sends them into a reload loop. It should say what the
gate means: "this card's file link is missing or not reachable — fix the
Thumbnail/Video link before requesting SMM approval" (the 409 payload already
carries `asset_state` and `guidance` fields the dialog could surface).

Done when: the dialog for `artifact_not_resolvable` (and its sibling
`asset_scope_forbidden` if it shares the bucket) explains the file-link
problem and points at the link field, and a UI-level check pins the mapping.

**CLOSED 2026-08-22.** Two of the three parts had already shipped and this entry
had not caught up. The `artifact` failure class exists and carries "Add the
deliverable link first"; `asset_scope_forbidden` is filed under `access`, which
is right — it is a permission answer, not a broken link; and the Production
dialog already routes the refusal through `_prodAssetStateText`, which turns the
machine `asset_state` into an action and passes the gateway wording through
untouched for the states it already explains.

The missing part was the third: the UI-level check. The code sits in a long list
one line away from the `reload` list, and nothing failed if it moved back — so
the fix could silently regress into the exact loop it was made to stop.
`test/write-ui-failure-messages.js` section 8 now executes the real resolver and
the real Production dialog and pins that neither ever answers a dead file link
with a reload, that the copy names the link, and that the `expired` case still
names BOTH causes cheapest-first (Drive returns the same 404 for a deleted file
and for one that was never shared). 5 mutations, all killed — including moving
the code back into the `reload` bucket.

---

# Post-graphics-flip intake — added 2026-08-20

Everything above predates the 2026-08-16 graphics flip. The four days after it
produced 36 merged PRs and a set of items that were surfaced, diagnosed and
then left open — living only in session transcripts, which is exactly the
failure this file was created to stop. Numbering continues from 15; the two
duplicate 13/14 pairs above are a pre-existing artefact, left alone rather than
renumbered so older references still resolve.

The flip's full bug record, and what it implies for the VIDEO flip, is now in
`docs/ops/FLIP_BUG_LEDGER.md`.

## 16. [closed] Legacy batches carry a single-team Linear parent map

Of **430 active calendar batches, 255 carry a video-only parent map and 132 a
graphics-only one** (measured 2026-08-20). All predate ONE PARENT PER CARD
(deploy #12, 2026-08-17). A batch with a video-only map cannot take a Thumbnail
or a Video + Thumbnail post: the gateway parents each child under the batch's
parent for its own team, so the thumbnail leg has nowhere to go and the whole
append is refused 409 `batch_parent_mapping_missing`. Exactly ONE of them could
still have succeeded, through a batch-create outbox dependency the browser
cannot see.

Mitigated but not repaired by #1104: the picker no longer OFFERS a batch that
cannot parent the chosen post (they stay visible in the incompatible list, with
a reason), empty duplicate twins rank last, and the message names the batch
instead of blaming the client's filing. So nobody hits a late 409 any more —
they are told up front to start a new batch.

The open question is whether to BACKFILL the missing per-team parent entries.
That is a two-sided write against 387 live batches across every client, so it
needs an explicit owner decision, not a default.

- ~~Cheapest correct alternative, already live: let those batches age out. New
  batches (post deploy #12) carry a full map, so the population only shrinks.~~
  **The premise is FALSE — re-measured 2026-08-24: the class GREW, 255 → 272
  video-only** (graphics-only 132 → 133; 50 carry both; 4 none). The growth is
  not people misusing the native flow: of the 38 active video-only maps born
  after deploy #12, **31 were written by `linear-backfill` — B1 itself**,
  importing Linear batches that only ever had a video leg and stamping the map
  with exactly the teams it saw. "New batches carry a full map" is true of the
  NATIVE create path only; the importer has gone on minting single-team maps at
  ~6/day. Two consequences, pulling opposite directions: age-out CANNOT
  converge while B1 keeps importing — but the writer IS B1, so the growth
  self-terminates at F1 when `batchAllowed` empties (FLIP_BUG_LEDGER §0-5).
  Age-out therefore means "accept ~272+ frozen at flip-day size, forever."
  The 7 post-#12 video-only maps NOT written by B1 (6 member-created, 1
  unattributed) deserve one look before the decision — if the native path can
  still produce a single-team map, that is a live defect, not legacy.
  - *Looked at, 2026-08-24: NOT a live defect.* Three shapes. (a) FIVE are
    empty just-created batches whose lone video entry carries
    `owner_team: "video"` — the outbound mapping's by-design lifecycle since
    the 2026-08-18 one-parent-per-card ruling: the parent is stamped under
    exactly the teams the card carries at mint, and `mergeBatchParentIds`
    widens the map when the first graphics work drains. (b) ONE is a
    `bat_move_` row: the move-card lane copied a single-team map verbatim
    from its source — inherited shape, not minted; the lane could synthesize
    the second slot but doesn't (cosmetic gap, no action). (c) ONE, on the
    test client, holds a real thumbnail with no graphics slot — and it was
    minted 2026-08-17, ONE DAY before the multi-team stamp landed (its entry
    lacks `owner_team`, unlike the five). Verified in Linear: the thumbnail's
    parent IS the batch's video issue, so the mirror fill is exactly right
    for it, and the sweep or age-out handles it. The native path has not
    minted a wrong single-team map since 2026-08-18.
- **OWNER RULING 2026-08-24: backfill, scoped to the batches that can still be
  used.** "Just make it so they can have it" — confirmed after the shape was
  laid out: the fix copies the batch's own video parent pointer into its empty
  graphics slot, inside our database only; Linear is never touched. Scope
  chosen by measurement, not by the raw count:

  | population | rows | disposition |
  | --- | ---: | --- |
  | video-only maps, active | 272 | — |
  | …attached to a card still in flight | 55 | the work list |
  | …of those, with a graphics-only counterpart batch (same name+client) | 8 | SET ASIDE for an individual look — pointing them at the video parent could split their thumbnails across two parents |
  | …of those, with thumbnails already under a GRA parent | 0 | (the hazard measured empty) |
  | **swept by the backfill** | **47** | graphics slot = copy of the video entry + `owner_team: video`, matching the modern same-issue-serves-both shape (33 of 50 modern batches) and existing practice (72 of 76 cross-team thumbnails already sit under VID parents) |

  The ~217 finished/posted ones stay untouched — a blank pointer on a batch
  that will never take another thumbnail costs nothing, and writing to them
  buys nothing. ~~Growth of the class stops at F1 (the writer is B1).~~
  **Corrected in review (PR #1123): that held only while B1's retirement was
  assumed.** Under the 2026-08-24 ruling B1 SURVIVES the flip as the
  stray-catcher, and `batchRowsFor` builds a batch's parent map solely from
  the teams present in the imported group — so the retained importer would
  keep minting video-only maps indefinitely. Ending the growth is therefore a
  requirement ON the stray-catcher build (parent-map synthesis, FLIP_BUG_LEDGER
  §0-5 piece 4), not a free consequence of the flip. The interim ~6/day
  regrowth is accepted either way, and any batch that regrows into the live
  set is caught by re-running the same scoped query.
- **The 8 counterpart pairs had their individual look 2026-08-24.** Reproduced
  live first (the class re-measured 61 in-flight video-only, up from 55 — the
  ~6/day regrowth — and the pair subset still lands on exactly 8). Findings:
  **7 of 8 are true mirrored pairs sharing the same calendar cards** — the
  video rows sit under the VID parent in one batch while the SAME cards'
  thumbnails sit under the GRA parent in the counterpart batch — and the 8th
  has an empty counterpart (the GRA parent exists, no thumbnails anywhere yet,
  so no split hazard at all). Disposition, same for all 8: fill the video
  batch's empty graphics slot with the **true counterpart GRA parent**
  (`owner_team: graphics`), NOT the video mirror the 47-row sweep uses —
  future thumbnails then file under the same parent the existing ones already
  live under, which is the exact split the set-aside existed to avoid. SQL
  handed to the owner with per-row pinned ids, expected-state predicates, and
  an exactly-8 row-count check; **unrun**. Ordering note: once PR #1123's
  parent-map synthesis is live, B1's next touch of these groups would mirror
  the video entry into these empty slots — the counterpart SQL deliberately
  overwrites a non-counterpart value, so it is correct in either order; running
  it promptly just avoids the interim mirror. Also observed outside this
  scope, no action taken: a few duplicate EMPTY video batch shells point at
  the same VID parents as their populated siblings (none in-flight).
  - **Both numbers RE-DERIVED after #1123 merged (2026-08-24 14:0xZ), and the
    morning's in-flight count was wrong.** Two corrections, one measurement
    bug and one live change:
    1. *The bug.* "Attached to an in-flight card" resolved card status against
       `calendar_posts` ONLY. A deliverable with `origin='samples'` keys into
       `sample_reviews` (`b1-linear-backfill.js:688` splits exactly this way),
       so every samples row resolved to `undefined`, which is not terminal,
       and counted as live. Resolving both tables — and treating `archived`
       as terminal alongside `Posted`/`N/A` — puts the in-flight class at
       **49**, not 61. The sweep is **43**, not 47.
    2. *The live change.* The merged parent-map synthesis is ALREADY WORKING:
       12 formerly video-only in-flight batches now carry B1's own mirror, and
       the video-only class is falling (272 → 270 within the hour). The
       backfill is therefore no longer the only thing that can close this —
       it finishes immediately what B1 would otherwise close only for batches
       whose issues happen to change again.
    3. *And that makes the counterpart fill TIME-SENSITIVE, not order-free.*
       The note above ("correct in either order") is right about the end state
       but understates the cost: B1's mirror is the WRONG value for a pair, and
       it has already landed on **2 of the 8** (one of them a native `bat_`
       batch whose pair only formed today). Until the counterpart SQL runs,
       any pair whose issues move gets the mirror, and a thumbnail created in
       that window files under the video parent while its siblings sit under
       the GRA one. The pair set is re-derived by shape, not by the old id
       list: video slot present, graphics slot **empty OR holding the mirror**,
       in-flight, with a name+client graphics-only counterpart. Still 8 today
       (one finished and left, two joined).
    4. *Hazard re-checked, still 0.* Sampled the graphics rows living inside
       sweep batches directly in Linear: every one parents to the batch's own
       VID issue (the modern same-issue-serves-both shape), so the mirror fill
       describes what is already true rather than moving anything.
- ~~Done when: the 43-row mirror sweep is applied with its readback, and the
  8-row counterpart fill is applied with its readback.~~ **BOTH APPLIED
  2026-08-24 by the owner; both readbacks match and were independently
  re-read: `mirrored = 43`, `filled_correctly = 8`.** Active-batch class shape
  after: video-only **270 → 219**, both-slots **56 → 107** (68 mirror-filled,
  8 true-counterpart). The 219 that remain are the finished/posted ones the
  ruling left alone on purpose. EXECUTION_LOG entry of the same date.
- **This item is CLOSED as a repair.** What remains is not a backlog but a
  property to keep: B1's synthesis now fills both slots on every batch it
  imports, so the class no longer regrows — verify that claim rather than
  assume it by re-running the video-only count after the video flip's
  full-window import, when B1 touches every open issue at once and any gap in
  the synthesis would show up in one pass.
- ~~Done when: an owner decision picks backfill / age-out / archive, and this
  entry links it.~~ **Superseded 2026-08-24 — the decision was made and
  applied.** The owner picked BACKFILL, scoped by measurement (the ruling table
  above), and both statements ran with verified readbacks. Struck rather than
  deleted so a reader who finds this condition quoted elsewhere can see what
  answered it; leaving it live read as "still pending" and invited someone to
  repeat production database work that is already done.

## 17. [closed] Due-date intents that never reached Linear — 4 replayed and verified 2026-08-20

14 `due` outbox rows sit terminal-without-delivery (8 `skipped`, 6 `stale`,
created 2026-08-17 → 19). **Each was read back against the live Linear issue on
2026-08-20 before proposing any repair, and only 4 are genuine divergences.**

| outbox id | issue | SyncView | Linear | verdict |
|---|---|---|---|---|
| 2422 | `GRA-6922` | 2026-08-18 | 2026-08-15 | **replay** |
| 2423 | `GRA-7056` | 2026-08-18 | 2026-08-14 | **replay** |
| 2621 | `GRA-7104` | 2026-08-19 | 2026-08-24 | **replay** |
| 2623 | `GRA-7105` | 2026-08-19 | 2026-08-24 | **replay** |

**The 8 `skipped` rows are NOT a backlog.** `GRA-6788`, `-6789`, `-6790`,
`-6924`, `-6925`, `-6926`, `-6927`, `-6928` — every one already carries in
Linear exactly the date the intent wanted. They were skipped because they were
no-ops. Nothing to repair, and replaying them would write nothing.

**2 `stale` rows are correctly excluded.** Ids 2075 / 2077 (`GRA-7102`,
`GRA-7103`) carry a **null** `due_date` intent against deliverables whose status
is `duplicate`. Replaying them would try to CLEAR a date in Linear. Leave them
terminal.

In all four repair cases Linear holds the OLDER value and SyncView the newer, so
the drop is a lost delivery rather than a human Linear edit being overwritten —
consistent with the rows never having been delivered at all (`processed_at` set,
`attempts` 1, no lock, no dependency, not test-only, not legacy-parity).

- Repair shape is the proven one from 2026-08-19: reset those exact ids to
  `pending` and let the fixed drainer replay their own original intents. Nothing
  hand-authored; every gateway and authority check intact.
- **Lesson recorded because it nearly cost four unnecessary production writes:**
  the outbox's terminal state says what the MIRROR did, not whether the two
  systems disagree. Read the far side before repairing from a queue state.
- **DONE 2026-08-20.** All four reset to `pending`; each drained on the FIRST
  attempt at 18:00:43–18:00:49Z with no conflict. Direct Linear read after:
  `GRA-6922` 08-18, `GRA-7056` 08-18, `GRA-7104` 08-19, `GRA-7105` 08-19 — all
  matching SyncView, every `stateHistory` unchanged, so only the due date moved.
  Recorded in `EXECUTION_LOG.md` under deploy #19.

## 18. [watch] Shadow audit residue: 33 unexpected divergences

Measured 2026-08-20 05:44Z — 29 graphics (of 2,552 entities checked), 4 video
(of 3,357). By operation: due 15, parent 4, priority 4, restore 4, comment 2,
status 2, title 2. Named rows include `GRA-7087` (`outbound_state_mismatch`),
`GRA-7048` (`outbound_comment_missing_in_linear`), `GRA-7056`
(`outbound_due_date_mismatch`), `GRA-7064` / `GRA-7065`
(`outbound_archive_mismatch`).

CONTEXT, not a gate (see `PRE_FLIP_HEALTH_CHECK.md`) — but it grew 15 → 33
across the flip week, and the growth rule says to flag a rise the known repairs
do not explain. Item 17 accounts for the largest bucket. The rest do not yet
have an explanation.

- Done when: each residue row is either repaired or classified as
  known-and-tolerated, so the count is a work list rather than a number nobody
  can act on.

**RE-MEASURED 2026-08-22 — it is 95, not 33, and the growth now HAS an
explanation.** The telemetry event carries a by-reason breakdown, which nobody
had trended. Doing so answers the question this entry left open.

| date | video | graphics | total |
|---|---|---|---|
| 2026-08-13 → 08-17 | 5–7 | 1–3 | 6–10 (flat for weeks) |
| 2026-08-18 | 11 | 15 | 26 |
| 2026-08-19 | 5 | 10 | 15 |
| 2026-08-20 | 4 | 29 | 33 ← this entry |
| 2026-08-21 | 9 | 37 | 46 |
| 2026-08-22 | 43 | 50 | **95** |

By reason, the jump from 46 to 95 is ENTIRELY two labels that had read zero
every single day beforehand:

| reason | 08-21 | 08-22 |
|---|---|---|
| `attribution_claim_mismatch` | 0 | **24** |
| `attribution_repair_sentinel_mismatch` | 0 | **24** |
| everything else, summed | 46 | 47 |

The non-attribution residue is FLAT — due-date drift even fell (15 → 10). So the
alarming curve is one defect arriving, not a general decay, and that defect is
**item 27**: attribution invalidated by a structure change and never re-derived.
Two independent measurements, from opposite directions, of the same thing.

Trap checked before believing it: both labels have existed in the classifier
since 2026-08-05/08-08 (`linear-deliverables-reconcile-lib.js`), so this is a
real rise in the data and not a reason that was newly added and made the number
look like it grew.

Stated as an open question rather than dressed up: a step from 0 to exactly
24/24 on two co-occurring labels, after nine flat days, looks more like a set of
rows becoming visible at once than a gradual drift, and **which** 24 rows cannot
be read from here. The event's row sample is capped at 20 and came back all
graphics; the per-row detail goes to a private artifact that needs the service
role key. Anyone with that key can settle it in one run.

One hypothesis was tested and REJECTED rather than left hanging: that the
2026-08-21 card move to Kasper Ads caused it. The move did produce three stuck
rows (`GRA-7042/43/44`, item 27), but the audit's sample names `GRA-7034`–`7041`
too, and those are `resolved` and correctly claim `kasperhytonen` — their Linear
project still maps there. So the move explains three, not the sample, and not 24.

**SETTLED 2026-08-24 — the 27 rows are named, and the audit is measuring
against a rule the owner has since overruled.** The open question above ("which
24 rows cannot be read from here") is answerable without the service-role
artifact: the count identifies them exactly.

The two attribution labels are ONE population counted twice — every flagged row
carries both — so 27+27 is 27 rows, half of the 104. And 27 is not a coincidence
of scale, it is a complete class: **every deliverable belonging to the two
SECONDARY brands of the one multi-brand client** (F64: slugs deliberately not
written here; they are the two non-primary brands of the client described in the
2026-08-24 mixed-family ruling). One holds 12 rows (6 graphics + 6 video), the
other 15 (video); 12 + 15 = 27, and the reconciler's live
`attribution.by_state.conflict` reads 27.

The mechanism, in one sentence: those rows sit in Linear families whose PARENT
lives in the main brand's project while the CHILD lives in the secondary
brand's, so the resolver classifies the family `conflict` — and
`attribution_repair_sentinel_mismatch` fires only when
`attribution.state !== 'resolved'` (`linear-deliverables-reconcile-lib.js:287`),
which is why a row can be flagged while its stored slug is perfectly correct.

*The claim above that `GRA-7034`–`7041` are `resolved` is now stale* — that was
measured on 08-22, before the mixed-family ruling shipped. Verified today:
`GRA-7034`–`7041` store the PRIMARY brand's slug and `GRA-7042/43/44` store the
secondary one, which is EXACTLY the owner ruling of 2026-08-24 ("a parent does
not out-vote a child that already knows its own answer"). Their Linear parent
sits in the primary brand's project while those three children sit in the
secondary brand's — the mixed family, behaving as ruled. No batch spans two
slugs —
the families split cleanly into one batch per brand, same batch NAME under both,
which is the ruling's intended end state.

So the data is right and the auditor is out of date. What the auditor wants —
`attribution_repair_sentinel_mismatch` proposes moving the row to the unresolved
sentinel slug — would be actively HARMFUL if applied: a sentinel row appears in
no client view at all, so it would hide 27 rows of live work from two real
brands to satisfy a rule the owner replaced. Do not "repair" these rows.

- **The fix is in the classifier, not the data.** A family that is mixed only
  because a client legitimately runs multiple brands is not a conflict; it is
  the documented shape. Either teach the resolver that a child with its own
  mapped project is `resolved` regardless of its parent's project, or allowlist
  this shape in `b4-outbound-shadow-audit.js` the way `attribution_stamp_absent`
  is allowlisted — with the same care the comment at its line 82 demands, since
  the whole point of splitting those two labels was to avoid hiding real drift.
  NOT built: this is a live classifier that gates nothing today, and the owner
  should choose which of the two shapes it learns.
- Until then, expect a floor of ~54 in this counter that means nothing, and
  trend the OTHER buckets separately or the useful signal stays buried.

**VERIFIED 2026-08-24, and the prediction held exactly.** PR #1124 shipped the
classifier fix — the shared resolver learning the mixed-family ruling the
webhook and the browser already knew — and the reconciler's own
`attribution.by_state` answers it on live data without anyone reading code:

| reconciler run | conflict | resolved |
|---|---:|---:|
| 16:10Z (pre-merge) | **27** | 5,022 |
| 16:55Z (first run after merge) | **absent, i.e. 0** | 5,055 |
| every run since | 0 | 5,055 |

The 27 did not move to a sentinel, get repaired, or get archived — they became
`resolved` on their own stored slugs, which is what "the data was right and the
auditor was out of date" predicted and is the only outcome that leaves the two
brands' work visible. The ~54 floor in the shadow-audit residue (27 rows × 2
labels) should disappear with it on the next daily run; the remaining ~50 are
item 19 and are unaffected.

**The other ~50 have a different and more mundane cause: people are still
editing graphics in Linear** (item 19), and post-flip those edits are
detect-only. Proven on a named row…222152 tokens truncated…der by red desc;
```

| lane | red / runs | last green |
|---|---|---|
| `production_shadow_audit` | 21 / 21 | never — red since 2026-07-24 |
| `samples_e2e_nightly` | 19 / 21 | 2026-09-04 |
| `calendar_e2e_nightly` | 18 / 21 | **2026-08-25** |
| `assurance_ledger` | 11 / 20 | 2026-08-31 |
| `reconciler_pager` | 10 / 288 | green now |
| `b1_incremental_refresh` | 5 / 1277 | green now |
| `monitoring_watchdog` | 0 / 601 | green now |
| `production_write_drill` | 0 / 21 | green now |

`production_shadow_audit` is the one everybody knows about — it has its own
CONTEXT entry and an owner ruling. The other three are not.

**`calendar_e2e_nightly` has failed every single night since 2026-08-26.** Its
most recent run: `19 of 70 probe(s) FAILED after 3 attempts`, across features
with nothing in common — Linear sync, set-all, tweak rounds, Kasper handoff,
cross-client isolation, link validation, the capstone. Nineteen unrelated probes
failing together is the shape of one broken precondition, not nineteen
regressions; but that is a hypothesis, and the 2026-08-26 run's log no longer
retains the probe list to compare against, so what actually broke that night is
NOT established here.

**Every one of those nights also posted a Slack alert** reading "❌ Calendar E2E
nightly FAILED on main — the practice robot found real trouble or needs care."
Seventeen identical alerts in a row is the alarm-fatigue mode the 2026-08-04
Slack work was undone by, and this file's own CONTEXT section exists because of
it. Either the probes found something real weeks ago and nobody looked, or the
harness is broken and the alert is worthless. Both are bad, and they need
different work.

**Why the twice-daily health check never said so.** `PRE_FLIP_HEALTH_CHECK.md`
item 8 gates on three reconcilers BY NAME. Every lane outside that list is
invisible to the check, so it can report ALL CLEAR — truthfully, by its own
spec — while three lanes fail nightly. That gap is now closed on the reporting
side: the query above is added to the CONTEXT section as a standing report, with
the rule that it is reported and never gated, because a red E2E lane is
something to go and look at and not a reason to roll anything back.

**One more gap the same query exposes.** A lane with no heartbeat does not appear
at all. `thumbnail-revision-scan.yml` writes none, which is exactly why item 204
could flap for days unnoticed — it is not in the watchdog's registry either.
Absence from this result is not evidence of health, and giving that lane a
heartbeat is a candidate repair this entry does not make.

**Not done here, deliberately.** No E2E harness change and no probe triage. The
probes run against the live app with credentials this session does not hold, and
19 failures is an investigation, not a night's tidy-up. What this entry buys is
that the failure is now counted, dated, and visible to every future run of the
check instead of living in a Slack channel nobody reads any more.

### 205a. The assurance-ledger lane was right, and it is green again — restated, not re-proven

The third chronically-red lane turned out to be the cheapest and the most
honest. `scripts/assurance-ledger-freshness.js --gate` is fully offline — it
reads `docs/testing/ASSURANCE_LEDGER.md` and does arithmetic — and it was
failing because four Tier-3 rows still read `FRESH` while their proof date
(2026-07-17) had aged to 57 days against a 90-day window. Past half the window
is `NEAR` by the ledger's own rule.

**Why the unit suite stayed green while the scheduled lane went red, which is
the interesting half.** `test/assurance-ledger-freshness.js` judges every claim
against the **State column's own stamp** (`State (2026-08-22)`), deliberately —
the comment in the script explains that anchoring to the refresh stamp instead
is what let a restatement sail through in the first place. The scheduled lane
passes `--gate`, which judges against **today**. So the offline suite cannot go
red as the calendar advances, and the lane can. Both are behaving correctly;
they are answering different questions.

Restated the four cells to `NEAR`, with each cell now carrying its own as-of
date and saying in so many words that **nothing was re-proven** — the arithmetic
moved, not the evidence. The State column stamp is left at 2026-08-22 on
purpose: bumping it would re-anchor every OTHER row in the table against today
in one unreviewed edit, and the four that needed restating are the four the gate
named. The word `FRESH` is kept out of the new text because `claimedState`
returns the first state word it finds, so a cell reading "NEAR … was FRESH" is
read as a FRESH claim.

Lane green as of this commit. It will correctly go red again when those rows
reach 90 days on about 2026-10-15, and at that point the honest answer is to
re-prove the surfaces rather than to restate them again — three of the four are
deploy workflows, monitors and admin tooling, and each needs live access this
session does not have.

### 205b. First triage of the 19 failing calendar E2E probes — clusters, not one broken precondition

Recorded so the next person starts from evidence instead of from the run link.
This is a TRIAGE of one night's log (run `34600106702`, 2026-09-11). It is not a
diagnosis, and only five of the nineteen were read in detail.

My first guess was that nineteen unrelated probes failing together had to be one
broken precondition. **The log does not support that.** They fall into at least
four groups with nothing in common:

- **A probe credential, not the app.** `p96_description_image_upload` fails 8 of
  its 12 assertions on `401 invalid_staff_key`. Its first four PASS — the
  function answers preflight, is deployed, and its runtime flag is on — so the
  probe reaches the live function and is refused at the key. The app is not
  implicated by any of those eight.
- **A stale assertion after a deliberate copy change.** `p95_write_ui_test_guard`
  asserted `state.saveError === 'native_link_required'` — exact equality against
  a bare code — while `_saveError` now carries the reader-facing sentence that
  ENDS in `(code: native_link_required)`. The app change was intentional (the
  "MAKE THE RELOAD ADVICE TRUE" work). **Fixed in this commit**: assert the code
  is present rather than that the string equals it, which proves the same thing
  and survives the next copy edit.
- **The link-move conflict dialog, twice.** `p81_link_move_conflict` fails 3 of 4
  and `p86_hidden_owner_warns` fails 1 of 5, and both failures are the same
  sentence: the "already linked — Move it here?" conflict does not surface. Two
  probes, one feature, almost certainly one cause. NOT investigated here.
- **Route chooser and the urgent badge.** `p87_resolve_on_route` fails 2 of 19
  (`B: routing sends caption → Kasper Approval`, `B: the TICKED change-request is
  resolved`) and `p92_sxr_resolve_pill_inplace` fails 1 of 10 (`URGENT badge does
  not linger after leaving Tweaks Needed`). The urgent-marker surface changed
  recently, so this one has a plausible neighbour; that is a lead, not a finding.

The remaining twelve — `p28`, `p34`, `p41`, `p53`, `p54`, `p55`, `p71`, `p56`,
`p57`, `p62`, `p77`, `p78`, `p79` — were not read. Their names are recorded so
the next run's log can be diffed against this list rather than re-derived.

**What this changes about the lane.** Some of the nineteen are the probes being
wrong, some look like the app being wrong, and telling them apart one at a time
is the actual work. Until that happens the nightly Slack alert is worth nothing,
because it has said the same thing every night since 2026-08-26 and at least two
of its nineteen reasons are the harness.

---

## 206. [2026-09-12, FIXED] Two nightly probes printed live client slugs into a PUBLIC Actions log, and the gate that exists to stop that could not see them

Found while triaging item 205b, in the raw text of the calendar E2E log.

`qa/probes/p95_write_ui_test_guard.js` read the LIVE `write_ui_reroute_clients`
flag and printed it:

```js
ok(true, 'live reroute flag loaded with the TEST client (' + JSON.stringify(flagClients) + ')');
```

That flag is the full roster. The line ran on every successful nightly run and
published **43 client slugs** into a log that, on a public repository, anybody
can read. A second copy sat on the skip path three lines above.

`qa/probes/p56_cross_client_isolation.js` printed
`JSON.stringify(perClient.clients)` in the message of its isolation assertion.
On the pass path that is only the TEST client. **On the FAIL path — the only
path where the line matters — it would print the very slugs that leaked.** That
probe is currently in the failing set.

**Why the exposure gate never caught either.** `scripts/repo-identity-exposure-check.js`
scans the repository tree and, in CI, the lines a pull request ADDS. Neither
probe contains a client slug: they fetch the roster at run time and interpolate
it into a log line. The string that leaks never exists in the repository, so the
tree scan and the diff scan are both structurally blind to it. This is a third
surface — **what a job PRINTS** — and nothing was watching it.

**Fixed here.** Both lines now report counts: the number of slugs on the
allowlist, and for the isolation check the number of distinct clients plus how
many of them were not the TEST client. Every assertion keeps exactly the same
strength — a failing isolation check still fails, and still says how badly —
and the slugs stay one query away for anyone entitled to see them. Same rule the
exposure checker already follows for itself: report the count, never the match.

**Checked and NOT leaking, so nobody re-checks it.** The 10-minute reconciler
prints `plan.summary` and its markdown, and both are aggregate-only: the
`linkage_sample`, `repair_sample` and `tolerated_sample` arrays that DO carry
`client_slug` sit at the top level of the `deliverable_events` payload and are
never in what the job prints. `repo-identity-exposure-check.js` prints file
counts only, by design. No other probe log line was found interpolating live
roster data — the many `client` matches in `qa/probes/` are the app's client
ROLE, not a slug.

**Not done.** Nothing here removes the slugs already in the retained logs of
past runs; Actions log retention and whether it is worth purging is the owner's
call, and the same judgement as `GIT_HISTORY_PII_PURGE_2026-07-14.md`. And no
gate now watches job OUTPUT — a checker for that is a real repair and is not
attempted here.

### 204a. What actually shipped, after review killed three claims in 204

Codex reviewed PR #1390 and filed two P1s and a P2. All three were verified
against the source and all three were right. None of it had merged.

**P1 — the function was never going to wait for a manual dispatch.**
`deploy-thumbnail-edge-functions.yml:3-12` triggers on `push` to `main` with
path filters that include BOTH
`supabase/functions/thumbnail-revision-scan/**` and
`supabase/functions/_shared/thumbnail-revisions.ts`, and its deploy step
publishes both thumbnail functions. This change touches both paths. **Merging
this PR IS the production rollout** — there is no separate owner dispatch, and
204 said there was, twice. Nothing in the code needed to change for this one;
what was wrong was the claim, and it had already been repeated to the owner.

**P1 — a Drive 404 does not mean what 204 said it means.** Google answers 404
identically for a file that was deleted and for one that exists but is not
shared with the caller. This repository **already pins that exact ambiguity**
(`test/prod-asset-state-guidance.js:12-13`: *"Google returns the SAME 404 for a
Drive file that was deleted and for one that exists but was never shared"*), so
the original design's premise — that a 404 is permanent and harmless — was
contradicted by a test already in the tree. Under it, revoking the scanner
service account's access to a whole folder would have turned every affected row
into a silently-exempt `missing_source` and left the lane green while nothing
was being scanned. That is precisely the silent-outage failure the caller's own
comment exists to prevent, rebuilt by the change meant to respect it.

**P2 — "safe in both orders" was false in one order.** Making `missing_source` a
sibling bucket meant a response could raise `checked` without raising any bucket
an older caller knows, so a new function answering an older caller would fail
its conservation check and throw `invalid aggregate response`. The claim in 204
was not merely optimistic; it was backwards for the deploy-first direction.

**What replaced it.** One change fixes both code findings:

- **`missing_source` is a reported SUBSET of `failed`, not a bucket beside it.**
  A 404 still increments `failed`, unconditionally. The four-way conservation
  `checked = changed + unchanged + failed + skipped` is therefore byte-for-byte
  what every caller has always applied, and P2 disappears: an old caller against
  the new function balances and behaves exactly as it does today.
- **`missing_source_new` is the counter that pages.** The first time a 404 is
  seen for a row, the scan writes its own marker (`drive_404: `) into that row's
  `error` column; a later 404 on a row already carrying the marker is "known".
  New ones keep the lane red. So three long-dead files stop flapping the lane,
  and a folder-wide access revocation still turns it red immediately — which is
  the distinction P1 said was missing. The success path already sets
  `error: null`, so a re-shared source drops the marker by itself.
- The caller exits 1 when `failed - missing_source > 0` (a real failure) or when
  `missing_source_new > 0` (something just became unreadable), and fails closed
  if a response claims a subset larger than its superset rather than subtracting
  nonsense into a negative and reading it as green.

**Cost, stated plainly:** the three known-dead rows will turn the lane red ONCE
more after this deploys, because none of them carries the marker yet. Then they
settle. That is the correct behaviour and not a wart — a row nobody has recorded
as unreadable should be announced exactly once.

**Guard, and the one that nearly did not hold.** Three sabotage controls, each
verified by exit status: dropping the new-vs-known split, dropping the subset
validation, and re-exempting the 404 from `failed`. The third — the exact bug
Codex found — initially PASSED the suite, because the assertion looked for
`out.failed++` anywhere in the file and `if (!driveGone) out.failed++;` contains
it. The guard now requires the increment to be a bare, unguarded statement and
separately refuses any `driveGone` condition on it. An assertion that a sabotage
control does not trip is not a test; it is a comment.


**Second review round, 2026-09-15 — a fourth P1, on the fix for the first three.**
Codex was asked to re-review because it had never seen the fix commit, and it
found that the marker above was bound to the fact of a 404 rather than to the
FILE that produced one.

`migrations/2026-07-14-thumbnail-revision-v2.sql:163-185` preserves the existing
pending watcher when a source is re-linked from file A to file B — its own
comment says so: *"On A -> B link changes the existing A watcher is deliberately
preserved so the scanner can archive A as Previous."* The insert is
`on conflict … do nothing`, so the row keeps A's `drive_file_id` AND A's error
text, while the scan reads the CURRENT source and therefore asks Drive about B.
Replace a dead thumbnail with a replacement you forget to share, and a
prefix-only test calls B "already known": `missing_source_new` stays 0, the
caller subtracts the failure, and the lane goes green for a source nobody can
read. Same class as the finding it was fixing — a signal that should be loud,
silently exempted.

The marker now carries the file id (`drive_404[<fileId>]: `) and is compared
against the file THIS scan read, captured from the source rather than from the
row's stored `drive_file_id` — which is still A and would have been no help. A
failure that throws before the file id is known counts as NEW, which is the
fail-loud direction. A fourth sabotage control reverts the comparison to the bare
prefix and fails the suite by exit status.

**Three rounds, three findings of the same shape.** The original design exempted
a 404; the first fix exempted the wrong 404s; the guard for the first fix matched
a substring that the broken version also contained. Each was caught by review
rather than by the tests as written, which is the honest summary of how much this
particular change wanted to be wrong.

## 207. [2026-09-15, BUILT] The Workload cold boot, second pass: the network was serial three times over

After 200 shipped the owner still measured about six seconds on `#workload`.
The offline harness showed every request settling in well under a second, so
the time was in the live network, and timing the live endpoints from the
sandbox found it:

- **The issue read was three round trips, one after another.** The mirror holds
  about 2,100 active rows and PostgREST caps a page at 1,000, so
  `_wlV2FetchIssues` walked pages serially: ~0.65 s each from a datacenter,
  ~660 KB each, and nothing painted until the last one landed. Page 0 now
  sends `Prefer: count=exact`, reads the total off `Content-Range`, and every
  remaining page is fetched at once (measured: three serial pages 1.5 s, the
  same three in parallel 0.6 s). No count header falls back to the old walk.
- **The read waited for a 5 MB document to parse first.** The head boot script,
  which already knows the route before first paint, now starts page 0 the
  moment it sees `#workload` (same kill switch and same 5-minute cache gate
  as `loadLinearIssues`) and the app adopts that in-flight response instead of
  issuing its own. `<link rel="preconnect">` to Supabase opens the connection
  in the same window. The URL literal is duplicated in the head script by
  necessity; the render harness pins it equal to `CAL_SUPABASE_URL`.
- **The metadata sweep after the fast paint was eight serial requests.**
  `wlFetchNativeMetadata` awaited each 100-id chunk before starting the next.
  The chunks are independent reads, so they go out together and are folded
  back in index order; `firstChunkError` and `failedChunkIds` keep their exact
  meaning.

Rendering is not the cost: `wlApplyData` plus `renderWorkloadAll` for 800
sub-issues measured 45 ms.

**What is left and why it is not in this pass.** The document itself is 5.5 MB
raw, 1.3 MB gzipped, and is parsed on every hard refresh; that is a build-step
question (splitting the single file), not a Workload one. Edge functions
(`key-verify`, `workload-plan`) answer in 0.3 to 0.5 s each and the plan read
gates the first paint by design (fail closed). The issue payload carries
timestamp columns the board does not display (about a fifth of the bytes);
left as is because `syncedAt` and `updatedAt` are read on other paths.

**Proof.** `workload-render-browser.js` gained `early_issue_fetch` (URL parity,
page 0 requested exactly once, board renders from the adopted response); 80
assertions across 16 phases. `workload-board-browser.js` 88 across 18 and the
mocked Production write-gateway gate still pass.

## 208. [2026-09-15, BUILT] The Workload boot was never mostly network — it was the board recomputing the same answers millions of times

207 made the network side of `#workload` about as fast as it can be, and the
owner still measured about six seconds on an ordinary refresh. So this pass
measured the CLIENT instead, with a fixture at live shape (2,128 rows, ~1,700
sub-issues, ~40% carrying a due date, spread over eight weeks) served from
localhost with **zero network latency**. Time to the board appearing: **8.5
seconds**. None of it was the network, and only 0.3 s of it was parsing the
5.5 MB document.

**Four findings, all the same mistake in different clothes: a pure answer
recomputed inside a hot loop.**

1. **`wlFormatShort` built a fresh `Intl` date string per card** — 942 ms of a
   3.1 s render. It is a pure function of an ISO date.
2. **The classification pass re-derived constants per sub-issue** —
   `wlNormalizeClient` 157 ms and `wlWorkloadTodayISO` 85 ms of a 446 ms
   `wlApplyData`, the latter running `Intl.formatToParts` to ask what today is,
   once per row.
3. **Both loose strips were rebuilt by every render** — one chip with two links
   and an icon per loose sub-issue, 2.3 s of a 2.6 s render. A cold boot paints
   twice (the fast paint, then the settle) and the lists are almost always
   identical across the two.
4. **The capacity placement pass was quadratic, and then some.** This is the
   big one: the second `wlApplyData`, the one that runs only once saved plans
   are authoritative, took **105 seconds** on this fixture. Three causes, each
   found by CPU profile rather than guessed at:
   - `reshuffleFor` found the entries sharing a capacity slot by scanning
     *every* placed entry, for every candidate day, for every entry it settled.
   - the urgency sort called `automatic.indexOf(entry)` inside its comparator.
   - `fits`, `reserve`, `release` and `slotOf` recomputed each sub-issue's
     capacity key, weight and editor capacity on every call — `wlTeamBucket`
     alone was 37% of the pass, reached three times per `fits`.

**What changed.** Each of these is now answered once: memoised pure helpers
(`wlFormatShort`, `wlNormalizeClient`, `wlNormalizeEditor`, `wlAddWorkingDays`,
`wlSubWorkingDays`, `wlTeamBucket`, and a one-second memo on the no-argument
`wlWorkloadTodayISO`), a content signature that skips a loose-strip rebuild
when nothing it renders has changed, a slot index for the reshuffle candidates,
a precomputed urgency order, and a per-pass `factsOf` map for the three
constants the placement asks about a sub-issue.

**Every memo is function-scoped, not module-level.** Several suites compile
these functions in isolation out of `index.html`, and
`workload-today-formatter-hoisted` asserts exactly that, so each cache hangs
off its own function rather than introducing a global. Getting this wrong first
is what broke five suites mid-pass.

**Measured on the same fixture, same machine:**

| | before | after |
|---|---|---|
| board on screen | 8.5 s | 3.6 s |
| settle recompute (`wlApplyData`) | 105.5 s | 31.3 s |
| repeat render, strips unchanged | 2.6 s | 0.2 s |

**Nothing about placement changed, and that is the point.** The reshuffle still
moves only same-editor automatic work inside its own window, never recurses,
never moves a pin, and rolls a failed day back exactly; the weight is still
`wlWorkloadWeight` and the ceiling still `wlEditorCapacity`. Two guards in
`workload-plan-source.js` pinned the *old expression* of those contracts and
were rewritten to pin the same contracts against the new shape — the whole
`workload-capacity-placement` suite, which checks the placements themselves,
passes untouched.

**What is left.** The remaining 31 s on that fixture is the combinatorial
reshuffle itself, and the fixture is deliberately pathological: 1,700
sub-issues across three editors at four units a day. The live board spreads the
same work over eleven. Making the search cheaper is real work and wants its own
pass.

## 209. [2026-09-15, FIXED] The Refresh button could make cards disappear off the Workload calendar, pins included, and said nothing

The owner reported that the Refresh control on the work-day calendar "is
refreshing in a bad way... it's like removing the pins, things that I'm doing".
Driven in the board harness across the conditions that button actually meets,
four of them, with a card pinned to a day first:

| what happens to the plan/issue read | the pinned card after refresh | was the owner told? |
|---|---|---|
| everything fine | stays pinned | n/a |
| refresh races an in-flight pin write | stays pinned | n/a |
| plan read refused (403) | pins withheld, deadline fallback | yes, banner |
| plan read fails (500) | stays pinned, editing paused | yes, banner |
| **Linear webhook returns fewer issues than the board had** | **card gone from the board** | **NOTHING** |

**The last row is the bug, and it belongs to this button specifically.** The
manual refresh is the ONE read that bypasses the Supabase mirror and goes
straight to the Linear webhook — deliberately, to honour its "from Linear"
contract (`loadLinearIssues(force)`). It is therefore the one read whose
payload can come back SHORTER than the board it replaces: a workspace that
errored inside the n8n aggregate, a truncated response. Every sub-issue the
payload omitted simply vanished off the calendar, with `planStatus` still
reading `ready` and no notice of any kind.

**Nothing was ever lost server-side** — the harness confirms the saved work day
is still in `workload_plan`, and the pin is still in `planByIssueId` in memory.
The CARD carrying it is what disappears, until the next reload reads the
complete mirror and brings it back. That is exactly the shape of "the refresh
undid what I was doing", and it explains why it looks random: it depends on
what the webhook happened to return that second.

**Fixed by saying it.** `wlLoadSnapshot` now captures the active sub-issue ids
the board is showing BEFORE a forced load replaces them (before the fast paint
overwrites `allActiveSubs`), compares them against the incoming payload, and
records how many went missing and how many of those were planned to a work day.
`renderWorkloadPlanStatus` reports it at the same lowest priority as the
existing exclusion note, ranked just ahead of it: a card that vanished is more
urgent than one knowingly filtered out. An ordinary (non-forced) load reads the
complete mirror, so it supersedes and clears the report.

**Deliberately NOT done: refusing the short payload.** Refusing to adopt any
refresh that shrinks the board would also refuse a legitimately deleted or
completed issue, and would then keep refusing until a reload. Reporting cannot
make anything worse; refusing can. If the owner would rather the refresh hold
the previous board and retry, that is a one-line change to the same branch and
the decision is theirs.

**And the reload it advises had to be made true.** The forced read writes
whatever the webhook returned straight into the five-minute issue cache
(`wlWriteCache` inside `loadLinearIssues`), so the reload would have replayed
the same short board from that cache and cleared the warning with it — worse
than saying nothing. A detected shortfall now drops that cache
(`wlDropCache`), so the reload misses it and reads the complete mirror. Caught
by the Codex review on the first version of this fix.

**Proof.** `workload-board-browser.js` gained `refresh_short_payload` (the card
really is dropped from the refreshed payload, the saved work day is untouched,
and the banner names the count, how many were planned, and what to do, and the short
snapshot is gone from the issue cache) and `refresh_complete_payload` (an
ordinary refresh keeps the pin exactly where it was, says nothing about a
shortfall when there was none, and leaves its own snapshot cached). 101
assertions across 20 phases. Verified pre-existing: the same probe on `555e662`, before
any of the boot-speed work, loses the card in exactly the same silence.

---
---

## 210. [2026-09-15, PARTIALLY FIXED — live budget raised; the real fix is still open] Two people, one card, two different days: `workload-plan`'s alias deadline was a coin flip

**REPORTED** as "I pinned a card to Wednesday, I still see Wednesday after a
refresh, my SMM sees Tuesday." Neither browser was wrong and neither was stale.
The endpoint answered them differently.

**MEASURED, live, before any change.** Three overrides for one client had been
saved minutes earlier, all three to the same day, all three present in
`workload_plan` with the right date. Nothing was lost at any point.

**MECHANISM.** `workload_plan` holds two identity namespaces for the same card:
the Linear issue uuid (262 rows) and the native `del_…` deliverable id (80 rows,
first written 2026-09-08). `action:'list'` papers over that with
`legacyPlanAliases()`, which emits every override under BOTH keys — but only
when the enriched snapshot wins a race against `LIST_ENRICH_BUDGET_MS`. On the
losing branch the endpoint answers `ok_unaliased`: every stored override, keyed
exactly as stored, no aliases. A board keyed on the Linear uuid then cannot see
a natively-keyed override at all, so those cards fall back to automatic
placement — one working day before the deadline. That is one column earlier,
which is exactly the divergence that was reported.

The three cards in the report have a deadline of the day AFTER the pinned day,
so the unaliased board placed them the day BEFORE the pin. Same data, same code,
different column.

**WHY IT WAS A COIN FLIP.** In the function logs the enriched snapshot lands at
**2.5–2.8 s** against a **3.0 s** deadline. Of 40 consecutive `list` calls, 18
logged `ok_unaliased` at a flat ~3004 ms. Not degraded under load, not an
outage: a deadline set a few hundred milliseconds above the thing it was timing.
Which board you got depended on nothing a person could see or control, which is
why it read as one person's browser being broken.

**NOTHING WARNED ANYONE.** `renderWorkloadPlanStatus()` speaks for a plan read
that FAILED. This one succeeded — `{ok:true, complete:true}` — with a subset of
the overrides it should have carried. The board painted a clean, confident,
wrong calendar. The unaliased path already knows it is degraded (it has its own
outcome string); the browser is never told.

**DONE.** `LIST_ENRICH_BUDGET_MS` 3000 → 5000, deployed to live as
`workload-plan` v12 (operator-manual lane, `--no-verify-jwt` preserved,
smoke-tested: unauthenticated `list` → 401 `unauthorized`, bad action → 400
`invalid_action`). 5 s is ~1.8× the measured cost with 3 s still inside the
browser's 8 s abort — the abort matters, because a snapshot that HANGS is now
held 5 s before the bounded read may answer, and overrunning the abort loses
every saved day plus editing, which is worse than an unaliased list.

**THEN DONE PROPERLY, same day, because the budget was only headroom.**

1. **The fallback aliases on its own** (`planAliasPairs`, live as v14). It reads
   the id pairing straight out of `deliverables`, bounded to the ids already in
   the answer it is returning, under a 1.2 s deadline of its own. Losing the
   snapshot race now costs latency, never correctness — and it does not matter
   WHY the snapshot was unavailable, since a validation refusal takes the same
   path as a slow one. Two id namespaces are still the root cause; this stops
   them being able to move a card.

   It keeps the snapshot validator's safety property rather than re-deriving its
   contract: a saved day whose client no longer matches its card's is never
   re-keyed onto that card, and an ambiguous claim aliases neither side. That
   ambiguity check was WRONG in the first draft — the bounded read cannot see a
   second deliverable claiming the same Linear id, because that row is not in
   the answer — and a harness case caught it. It now confirms every candidate
   Linear id with one extra bounded read before aliasing to it.

   **MEASURED against the live table:** 342 stored days, 336 aliases emitted, 6
   refused as client drift — the same 6 rows the snapshot path has been dropping
   since item 177. Coverage of the two paths is now identical.

2. **The degraded answer speaks.** The response carries `alias_mode`
   (`snapshot` | `pairs` | `none`) and `plans_unaliased`, and the board renders a
   warning above the metadata and short-refresh notes, because a board that is
   WRONG about where work sits outranks one that is incomplete about weights.
   A response without those fields reads as complete, so an older open tab is
   unaffected.

   **Client drift is reported separately (`plans_drifted`) and never reaches the
   banner.** It is permanent until the data is repaired, it does not go down,
   and a standing warning is how a real one stops being read. Counting those 6
   on the board was in this change until it was caught in review of my own diff.

**STILL OPEN.** One canonical key, with the 80 native rows migrated, ends the
class rather than compensating for it. Owner decision — scope §6.1 in
`docs/ops/WORKLOAD_NATIVE_SOURCE.md` — and a key migration, not a flag. Until
then two namespaces remain, and every reader of `workload_plan` has to know it.

**PROOF.** `docs/syncview-design/tests/workload-board-browser.js` phases
`plan_alias_incomplete`, `plan_alias_unavailable`, `plan_alias_complete` (9
assertions; 110 across 23 phases, so the 20 pre-existing phases also prove the
no-fields-means-complete path). The pairing itself is covered by a 13-check
harness run against the compiled function bundle, including drift, ambiguity,
collision, a failed lookup and the slug/client-key normalization; that harness
belongs with the function source, which is NOT on main — see the drift note
below. `prod-write-gateway-browser` passes; `prod-boot-budget` fails identically
on `origin/main` in this sandbox (external CDN TLS), so it is not this change.

**REPO/LIVE DRIFT, found on the way and worth its own attention.** Live
`workload-plan` is far ahead of `main`: the deployed function has the native
snapshot, the alias adapter, `native_snapshot`, and the RPC write path, none of
which exist in `supabase/functions/workload-plan/` on `main` (that copy would
REJECT a native id outright). The deployed bytes match
`origin/prep/linear-exit-review-fixes-20260913` — verified file by file before
redeploying, which is the only reason this change could be made without
regressing live. `docs/ops/EF_DEPLOY_MANIFEST.md` still records "deployed by
operator from `fd3e0eaa` on 2026-07-20". Anything that captures `main` as the
rollback truth for this function is capturing code that is not live.

## 211. [2026-09-15, FIXED — DEPLOY REQUIRED (F27 §4)] Every post created without a filming plan orphaned its Linear issue, because Linear escaped a bracket we sent

Reported as "the client needs attribution" on two calendars. The banner was
honest and pointed at the wrong thing: the cards' stored client was correct and
active, but attribution is decided from the Linear PROJECT on the mirrored
issue, and these cards never got one.

**Surfaced by an outage, caused by a bug.** Linear's account hit a usage limit
at 13:49Z and refused every issue CREATE for ~84 minutes (reads and updates to
existing issues kept working throughout, which is what made it look like a
SyncView fault). Service returned at 15:13Z. One calendar's five videos then
mirrored normally. The other's did not, and that second failure is ours:

```
{"conflict": {"reason": "linear_create_intent_mismatch",
              "decision": "idempotency_conflict",
              "mismatched_fields": ["description"]}}
```

We sent `[SyncView] FILMING PLAN MISSING - submission accepted; SMM follow-up
required.` Linear stored `\[SyncView\] FILMING PLAN MISSING - ...`, escaping the
markdown-significant brackets. Post-create verification byte-compared the two,
found a difference it had not made, and terminalized the row as a conflict —
so `applyCreateLinkage` never ran and the issue sat in Linear owned by nobody.

**This is the 2026-08-07 auto-link orphan again, one rewrite later** (ledger
entry and `test/linear-autolink-parent-linkage.js`). Same mechanism, same
consequence, different Linear-side rewrite. The first fix normalized the
auto-link form on both sides of that comparison and stopped there; escaping was
never considered.

**Three things make this one worse than its sibling.**

1. **The trigger is a string this app writes itself.** That bracketed sentence
   is the template for any batch created with no filming plan. So it is not an
   occasional paste, it is a permanent class: every such post orphans.
2. **It fires on the FIRST attempt, not on a retry.** Verification reads back
   after every create. The outage was not a precondition; it was only what drew
   attention to it.
3. **Recreating the post reproduces it.** Told the first four cards were outage
   damage, the owner archived them and made two fresh ones. Those orphaned in
   seventeen seconds, adding VID-13919 beside VID-13912 — two correct issues in
   Linear, both `createdBy: SyncView Mirror`, both unlinked. The natural repair
   makes the problem bigger.

**Isolated by the calendar that worked.** Its batch description was a bare
filming-plan URL. No brackets, no escaping, no mismatch — same minute, same
lane, same account. That contrast is what identified the character class rather
than the outage.

**The fix.** `collapseLinearEscapes` drops a backslash that directly precedes a
character CommonMark defines as escapable, and `canonicalLinearDescription`
composes it after the existing auto-link collapse. `createIntentMismatches`
compares descriptions through that one normalizer on BOTH sides, exactly as the
auto-link fix does, so it can only ever make an intent compare equal to Linear's
rendering of that same intent. A lone backslash, or one before a letter, is left
alone.

**The paragraph that stood here was wrong, and Codex caught it on #1406.** It
read: *"Equality does widen by one step, deliberately: a foreign issue reading
`[x]` now matches an intent of `\[x\]`. Adoption still requires team, project,
title, status, due date, assignee, parent and labels to match as well."* The
first sentence was true and the justification was not. `\# Heading` and
`# Heading` RENDER DIFFERENTLY — literal text versus a heading — and a symmetric
unescape canonicalizes them to one string; the other fields cannot catch that,
because a **description-only** edit leaves every one of them matching. And the
precondition is this incident: a create that succeeded with its linkage lost,
which happened twice in one afternoon.

**So the comparison is DIRECTIONAL**, which is what the asymmetry always called
for — Linear ADDS escapes, it never removes ours. `linearDescriptionMatches`
accepts a stored description that is byte-identical to our intent, or whose
escapes stripped from **the stored side alone** yield our intent exactly. Our
own intent is never rewritten, so a difference we did not send always survives:

| intent | stored | verdict |
|---|---|---|
| `[x]` | `\[x\]` | adopt — Linear escaped ours |
| `\[x\]` | `\\[x\\]` | adopt — Linear escaped our backslash |
| `\*t\*` | `\*t\*` | adopt — byte-identical |
| `\# H` | `# H` | **refuse** — a person changed it |

The last row is the one symmetric normalization got wrong, and it is the row
that matters: refusing there costs an orphan a human can see and fix, while
adopting there silently links an issue whose text somebody else chose. The
auto-link collapse stays symmetric and unchanged.

**AND THE DIRECTIONAL VERSION WAS STILL WRONG — same reviewer, second pass.**
Directionality closes the collision in ONE direction. Run it backwards: we send
a real heading `# H`, a person edits the still-unlinked issue to the literal
`\# H`, and stripping escapes from the stored side yields `# H`, our intent
exactly, so we adopt their edit. The stored bytes of *"Linear escaped our `#`"*
and *"a person typed `\#`"* are **identical**, so nothing about direction can
separate them. The directional commit even shipped a test ASSERTING that
adoption as correct, justified by Linear's rewrite being the likelier cause —
and an assertion written from the same wrong premise as the code it guards is
not evidence of anything.

**So the escape set is now evidence-gated:** exactly `[` and `]`, the characters
the live orphan `\[SyncView\]` actually named. Nothing is in it by extrapolation
from CommonMark, and widening it needs a real orphan naming the character.

**The asymmetry is the whole argument.** Too narrow costs an orphan: visible,
reported, recoverable, and it arrives carrying exactly the evidence needed to
widen the set correctly — which is how `[` and `]` got here. Too wide silently
links an issue whose text somebody else chose. Those costs are not comparable,
so this errs narrow and says so in the source.

**AND THE NARROWED SET WAS STILL TOO BROAD — same reviewer, third pass.** The
live evidence established that Linear escapes ONE STANDALONE TEMPLATE,
`\[SyncView\] …`, and nothing about brackets in general. A description
intending a reference link `[label][ref]`, edited by a person to
`\[label\][ref]`, renders differently and still compared equal. So the
exception is now scoped to the observed FORM: a leading `\[SyncView\] ` marker,
this app's own (`production-write/index.ts:262`, `:1046`, `:1066`), un-escaped
once at the start. Brackets anywhere else orphan rather than adopt.

**WHY IT KEPT HAPPENING, which is the finding worth more than the fix.**
Ownership of a create is ALREADY established by the id. The drainer looks the
issue up at a UUIDv5 it mints itself from the row's `dedup_key` and hands to
Linear as `input.id` (`_shared/linear-create-id.mjs`) — re-derived against the
live orphan, the dedup_key of outbox 9435 yields `54f839e2…`, which is
VID-13912's uuid exactly. **An issue at that id is ours by construction and no
foreign issue can occupy it.** Yet `createIntentMismatches` justifies its
exactness as "the property the `already_exists` gate depends on to refuse
adopting a foreign issue" — a foreign issue it cannot encounter on this path.

So the guard's real effect is not "refuse a foreign issue". It is **"refuse to
link our own issue when its text changed"**, and refusing is precisely what
produces the orphan this entry exists for. All three holes are symptoms of
using text to establish ownership the id already established.

**Dropping `description` from the create comparison would remove the class
rather than its instances. Deliberately NOT done here** — it retires a guard on
the production write path and deserves its own reviewed change, not a fourth
same-session patch. Owner decision, 2026-09-15, with the narrow fix shipped
today and the architectural one left open. **This is the highest-value item
this entry leaves behind.**

**AND THE TEMPLATE SCOPING WAS A REGRESSION — same reviewer, fourth pass,
raised P1.** `production-write` writes the marker on THREE generated shapes and
only one puts it first: `:262` is the marker alone, while `:1046` and `:1066`
place it in the SECOND paragraph after a `Filming Plan: <url>` line. Matching
with `startsWith` covered one and silently missed two — and the two missed are
the shapes that ALSO carry a bare URL, so they meet both Linear rewrites at
once. **I cited all three line numbers in that version's justification without
reading where in the description each marker lands.** Citing a source is not
reading it. The exception now matches the marker at the start of any LINE, which
covers every position the generator uses and widens the discriminator by
nothing.

**The method note, and it is now the fifth restatement of the same failure.**
Each wrong version was defended in the code comment, the commit message and the
PR body before anyone read it. Four times. Writing a justification down, in
three places, did not make it true on any of the three occasions; a reviewer
constructing one concrete counterexample did, four times. Worse, the second
version shipped a TEST asserting its own hole as correct — an assertion written
from the same premise as the code it guards proves nothing, and it passed.

The lesson this entry is really recording is that confidence expressed in prose
is not evidence, that each draft deserved the same adversarial reading as the
first and never got it from me, and that when a reviewer names the same
direction three times the answer is to take the narrow option they keep
pointing at rather than to find a cleverer general one.

**Proof.** `test/linear-description-escape-orphan.js`, 13 assertions, built on
the exact live strings — including the pre-fix assertion that the raw comparison
really does differ, so the suite evidences the bug and not only the fix, and a
check that a genuinely different description still refuses adoption.
`test/linear-autolink-parent-linkage.js` had pinned the literal call spelling of
the description comparison and failed on a change that strictly widened it; it
now pins the PROPERTY (one normalizer, both sides, auto-link collapse still
inside it), which is what it meant all along.

**NOT done here, flagged for a decision.** The `description` UPDATE operation
compares `actual === intended` with no normalization at all — not even the
2026-08-07 auto-link collapse. On this reading a description containing either
rewrite would never register as already-applied and would be re-sent, and a
re-send bumps the issue clock the stale guard reads. Not measured against a live
row, so it is stated as a suspicion, not a defect, and left out of a fix that is
otherwise minimal and reviewable.

**Still outstanding after this ships:** the two orphaned issues need adopting or
retiring, and the owner's two cards need linking to one of them. Six thumbnails
on a third calendar were queued behind the outage itself, not this bug, and
clear on their own.

## 212. [2026-09-18, FIXED — MIGRATION REQUIRED] The flip cut the content calendar's only supply of production statuses

**What the SMM saw.** Four video cards moved to `smm_approval` by an editor
between 19:12Z and 19:25Z; the calendar still read "Tweaks Needed" at 20:20Z,
when they re-set all four by hand. At 20:44Z ten components across seven clients
were lagging their linked card (six video, four graphics), the oldest since
17:34Z. Reported by card and deliverable id; one of the seven is the test
client.

**Why.** The calendar's copy of a production status has always come from Linear.
The card write lands in `deliverables`, the outbound mirror carries it to Linear,
and `scripts/linear-sync-reconcile.js` pulls it back onto
`calendar_posts.video_status` / `graphic_status`. Native receipts send nothing to
Linear, so from the ordinary-receipts flip that chain carried nothing — the
reconciler resolved the link, got the stale Linear state, and its provenance
test correctly refused to write it. Nothing else had ever written that column.
Changes made FROM the calendar were never affected; they write both copies.

**Fix.** `migrations/2026-09-18-native-calendar-status-bridge.sql` projects the
change in the database, in the same transaction as the deliverable write: the
mapped calendar value, its `*_status_at` stamp through the existing BEFORE
trigger, and one `calendar_post_events` row with `source = 'native-bridge'`.
`scripts/native-calendar-status-backfill.js` (dry-run by default) catches up the
cards that already lagged. No Edge Function changes, so no fingerprint moves and
no sealed bundle is needed — but the migration has to be applied and the deploy
preflight now expects four more objects.

**The hazard that shaped it.** `calendar_posts.video_status_at` is the urgent
editor ping's deduplication key —
`intent_key = 'urgent:' || sha256(deliverable_id || '|' || video_status_at)` —
so a projection that re-stamps it without a card-visible change lets one tweak
be pinged twice. Every write is predicated on the mapped value actually
differing from the card's. A repair falls out of the same reading: the urgent
ping has been unreachable on natively-changed cards since the flip, because
`urgentSnapshot` requires the card to read `Tweaks Needed`.

**Proof.** `test/native-calendar-status-bridge.js` (mapping parity against
`index.html` over all 90 status/origin pairs, seen to fail on a planted drift)
and `test/native-calendar-status-bridge-postgres.js` (32 assertions on a real
disposable PostgreSQL, including a CONTROL that drops the trigger and reproduces
the regression, and the `ROLLBACK.md` inverse rehearsed in the same lane).

**Amended before merge, after review.** The first draft moved the status and
left the approval stamps, so a regressing component showed "Tweaks Needed" beside
a live client sign-off — the stamps are stored, and unlike the roll-up nothing
recomputes them on reload. The projection now clears them under
`_calClearStaleApprovals`'s own conditions, scoped to the component that
regressed. The backfill's apply also re-reads the deliverable in the same
statement and logs only rows an UPDATE returned.

**Not done here.** The card's overall `status` roll-up is still recomputed only
by the next calendar write; `computeOverallStatus` and `_calClearStaleApprovals`
have no server-side twin and inventing a second one in SQL is how the two drift.
Worth a decision, not a silent addition.

**Amendment, 2026-09-18, after the 22:38Z apply.** The trigger half of this
works live. The backfill half did not run at all: every call through the API
refused with SQLSTATE 21000 "DELETE requires a WHERE clause" before reading a
row, because the routine cleared its two temp tables with a bare
`delete from <table>;` and Supabase loads the `safeupdate` guard for the role
PostgREST connects as. Repaired by
`migrations/2026-09-18-native-calendar-backfill-temp-table-clear.sql`, which
replaces the routine using `truncate`. **The backfill therefore still has not
been run against production** — the entry above should be read as the trigger
being live and the already-lagging cards still lagging until the repaired
routine is applied and the script run with `--apply`. See 213.

**Amendment, 2026-09-19 — CLOSED.** `production_native_calendar_status_backfill`
has now run against production twice, with `--apply`, after the temp-table-clear
repair above: 2026-09-18 23:45Z (16 posts) and 2026-09-19 01:10Z (1 post). The
sentence in `scripts/card-calendar-status-drift-check.js` claiming the backfill
"has still never been run" was true when written and is false now; it has been
corrected to name these two runs, and to state — which was previously left
unsaid — that the pre-bridge rows the drift check still lists are deliberately
left unbackfilled: several of those posts were published without the component
the bridge compares, so there is no value a backfill could write for them that
would be correct. That is a scope statement, not a residual failure, so this
entry is closed.

**Correction, 2026-09-19, same day.** The paragraph immediately above overclaims.
`pre_bridge` in the drift check is a pure date cutoff (moved before
`BRIDGE_GO_LIVE`); nothing in the classifier or in the backfill itself tests for
"published without the component," so that reason applies to at least some of
the rows still listed, not to the pre-bridge backlog as a whole — caught by a
Codex review comment on #1428 before this entry misled anyone into treating the
whole remaining list as explained. The script's wording is corrected to say so
explicitly. Entry stays closed on its actual subject — the backfill has run —
but the residual pre-bridge backlog itself is not fully accounted for and
remains open as a fact, just not as an item this entry was ever tracking.

## 213. [2026-09-18, OPEN] The live project's REST origin is a default in at least one more script

`scripts/native-calendar-status-backfill.js` shipped with the production
project's REST origin as a `SUPABASE_URL` fallback. Two problems, not one: the
repository is public, so the fallback published an identifier for the production
database; and it made the dangerous direction the silent one, since a run with
the variable unset or misspelled would have pointed a `--apply` at production
instead of refusing. That script now requires the variable, with no default.

`scripts/linear-label-catalog-export.cli.js` line 384 has the identical
fallback and is **not** fixed — it has its own callers and its own lane, and
widening a regression PR to reach it is how an unrelated tool ends up untested
in a hurry. The same sweep should check the rest of `scripts/` rather than these
two files: a grep for the project ref finds it in several more, and whether each
is a default (dangerous) or a documented constant in a read-only diagnostic
(merely public) has not been measured.

## 214. [2026-09-19, OPEN — REGRESSION, not intended] The Create Post editor picker is disabled because a completeness guard fires on a read PostgREST truncates at 1000 rows

Owner observation during the identifier-mint check 3 walkthrough on the test
client: in Create Post the **Video editor** dropdown is disabled and stuck on
*"Assigned automatically"*.

**It is a regression. It is not how native assignment is meant to behave.** The
picker exists because of an explicit owner request (2026-08-24, quoted in
`index.html` above `_calNativeVideoEditorPool`): *"there should be a drop-down
for the editor. By default, it should be the one that is the freest, and it
should disclaim it, but people should be able to choose a different video
editor."* Native assignment was supposed to make that picker **more** correct,
not remove it — the whole point of moving the decision to `intake_editor_options`
was that the browser could stop reproducing the gateway's eligibility rule.

### What the symptom actually encodes

The control is disabled on `state.videoEditorStatus === 'loading' || !editorItems.length`,
and it reads *"Checking workloads…"* while loading. So **"Assigned automatically"
plus disabled" means the pool read finished and produced nothing** — status
`unavailable`, which is the `.catch` arm. It is not a slow network.

### Root cause, measured 2026-09-19

`handleIntakeEditorOptions` (`supabase/functions/production-write/index.ts:3793`)
issues three reads through `completeIntakeEditorRows`, which refuses any read
whose exact `count` disagrees with the rows returned:

```ts
if (result.error || !Array.isArray(result.data)
    || !Number.isSafeInteger(result.count) || Number(result.count) !== result.data.length
    ...) throw new GatewayError(503, "intake_editor_options_unavailable");
```

One of those three reads is over the 1000-row PostgREST ceiling:

| read | rows | verdict |
|---|---|---|
| `team_members`, active video | 4 | fine |
| `deliverables`, team video, live statuses | 354 | fine |
| `production_deliverables_browser_v1`, team video, `raw_issue_parent_id` not null | **3,232** | **truncated** |

Measured directly against the live REST endpoint with the browser key:

```
GET /rest/v1/production_deliverables_browser_v1?select=id&team=eq.video
    &raw_issue_parent_id=not.is.null&limit=10000
→ HTTP 206, content-range: 0-999/3232, 1000 rows returned
```

**`.limit(10000)` does not raise PostgREST's ceiling.** The server caps the
response at 1000 regardless, and returns the true total in `content-range` —
which is exactly the `count: "exact"` the guard compares against. So the guard
sees 1000 ≠ 3232 and answers **503**, the browser's `!response.ok` branch
throws, `videoEditorStatus` becomes `unavailable`, and the control renders
disabled with its placeholder.

### The guard is right; the read is wrong

Nothing here should be loosened. `completeIntakeEditorRows` exists precisely so
a truncated read is never mistaken for evidence that an editor has no work —
which would rank the wrong person first, and is the same class as item 210's
coin-flip deadline. **A silent 1000-row cap that changed who the dialog
suggested would be a far worse bug than a disabled dropdown.** The guard failing
closed is the system working.

The defect is that the read was written as though `.limit()` controls the
ceiling. Fix shape, in preference order:

1. **Do not ship the parent set to the gateway at all.** The three reads exist
   to compute one small thing: an open-video count per editor, excluding
   parents. That is an aggregate. A `security definer` routine returning one row
   per editor moves 4 rows instead of 3,586 and cannot be truncated.
2. If it must stay in the gateway, **paginate with `.range()`** until the
   returned count reaches the exact `count`, and keep the completeness guard on
   the assembled total.

Option 1 is the honest one. Option 2 keeps an O(rows) read on a dialog open.

### Scope, and what is NOT broken

- **Only the native lane reaches this.** In the provider lane the handler
  returns `lane: "provider"` before these reads and the browser falls back to
  `_calLegacyVideoEditorPool`. So the picker worked until the native intake
  epoch went on, and broke without anything changing in the picker itself.
- **Posts still get an editor.** The gateway assigns automatically at
  submission through the same `nativeIntakePool`, so the placeholder is telling
  the truth. What is lost is the owner's ability to *see who* and to *choose
  someone else* — the entire feature.
- Graphics is deliberately not offered here and is unaffected.
- The roster is healthy: 4 active video editors, all with a Linear mapping, so
  no eligibility rule is excluding anyone.

### How it would have been caught

`test/native-post-editor-picker.js` pins the browser against the contract, and
the contract is satisfied — the gateway really does answer 503. Nothing in the
suite builds a fixture over 1000 rows, because no test has a reason to. **The
general form: a row-count ceiling is invisible to every test whose fixture is
smaller than the ceiling, and production data crosses it silently.** A sweep for
other `count: "exact"` reads with a `.limit()` above 1000 is worth its own pass;
this entry does not claim to have run one.

Not fixed here. Found while walking the identifier-mint step 27 checks; fixing
it inside that PR would have widened a docs change into an Edge Function deploy.
**Any fix is a `production-write` change and needs the F27 Section 4 lane**, with
its sealed capture.

## 215. [2026-09-19, OPEN — whole-repo pattern, 13 sites] A press that starts inside a dialog and ends outside it dismisses the dialog, losing everything typed

Owner observation, same walkthrough: in the Create Post dialog, **drag-selecting
text in the batch name field from right to left closes the whole form.** Press
inside, release outside, dialog gone with every field in it.

### Why it happens

`index.html:45034`:

```js
overlay.onclick = event => { if (event.target === overlay) _calCloseNativePost(); };
```

The DOM dispatches `click` **at the nearest common ancestor of the mousedown
target and the mouseup target**. Press in the batch-name input, release over the
backdrop, and that ancestor is the overlay itself — so `event.target === overlay`
is true and the handler cannot tell the difference between "the user clicked the
backdrop to dismiss" and "the user finished a text selection out here". Both look
identical at `click`.

This is not exotic input. Selecting right-to-left in a field near the left edge
of a dialog puts the release outside it as a matter of course, and so does
overshooting a drag.

The input's own `onmousedown="… event.stopPropagation();"` does **not** help:
that stops the *mousedown* from bubbling, while `click` is a separate later
event dispatched at the common ancestor.

### Fix shape

Record where the press began and only dismiss when it began on the backdrop:

```js
overlay.addEventListener('mousedown', e => { overlay._pressBeganOnOverlay = (e.target === overlay); }, true);
overlay.onclick = event => {
    if (event.target === overlay && overlay._pressBeganOnOverlay) _calCloseNativePost();
};
```

**The `true` is load-bearing.** It registers on the capture phase, which runs on
the way *down* and therefore still fires for presses inside the batch-name
input despite that input's `stopPropagation()` on the bubble phase. A
bubble-phase listener would never see those presses, so the flag would keep a
stale `true` from an earlier backdrop press and the bug would survive in a
narrower form — which is worse than leaving it, because it would then look
fixed.

A `pointerdown`/`pointerup` pair is equivalent and the repo already uses
`pointerdown` with capture elsewhere (`_kasperOnPointerDown`, `index.html:79080`),
including a comment about exactly this hazard: *"a button pressed, tearing that
button out between pointerdown and click"*. So the house already knows this
shape; the overlays never got it.

### This is a class, not one line

Thirteen dismiss sites share the unguarded pattern and **none** checks where the
press began:

`index.html` 8143, 8163, 22515, 24958, 39551, 39554, 39557, 39560, 39567, 39570,
41015, 45034, 68020.

Create Post is where it hurts most — the dialog holds a mode, a post count, a
batch choice, a batch name, per-post names and an editor choice, and there is no
draft recovery — but the sign-in overlay (24958), the comments overlays and the
import dialogs all carry it. **The repair should be one shared helper applied to
all thirteen, not a patch at 45034**, or this returns the next time someone
drags in a different dialog.

Two of the thirteen are deliberately *not* equivalent and need reading before
they are swept: 24958 has an extra `!overlay._syncviewEntry` condition, and the
confirm overlays at 8143/8163 are inline attributes rather than bound listeners.

### Before any fix

`index.html` change on a Production/Calendar write surface, so the offline
browser gate must run before pushing:

```
node docs/syncview-design/tests/prod-write-gateway-browser.js
```

It is fully mocked, runs without a route to the live backend, and drives the
Calendar dialog end to end — which is exactly the surface this touches. Per
`CLAUDE.md`, skipping it is what put a red `production-polish` on #1353.
`prod-boot-budget.js` also runs offline and should ride along.

Not fixed here. Found during the identifier-mint step 27 walkthrough; it is a
browser change with no relation to that capability and does not belong in its PR.

**Amendment, 2026-09-19, later the same day — FIXED.** Fixed independently on `claude/beautiful-einstein-34h3m5` before this entry (session B's original report) had merged; the two described the same bug and this reconciles them into one entry per the numbering-collision note in CLAUDE.md.

**What it was.** In the Create Post dialog, drag-selecting text in the batch
name field from right to left — or any press that starts inside a dialog and
releases on the backdrop — closed the whole dialog, discarding every field in
it. Thirteen backdrop-dismiss sites across `index.html` shared the same
unguarded pattern: `onclick="if(event.target===this)FN()"` (ten inline
markup sites) or the JS equivalent `overlay.onclick = event => { if
(event.target === overlay) FN(); }` (three JS-created overlays). The DOM
dispatches `click` at the nearest common ancestor of the mousedown and mouseup
targets, so a press in a field and a release on the backdrop makes
`event.target === overlay` true at click time — indistinguishable from an
actual backdrop click. The field's own `stopPropagation()` on `mousedown`
does not help, since `click` is a separate, later event.

**Fix.** One shared, delegated, capture-phase `mousedown` listener on
`document`, added once near the top of the app script, records on every press
whether it began directly on an element marked `data-backdrop-dismiss` (not on
one of its descendants):

```js
document.addEventListener('mousedown', event => {
    const backdrop = event.target && event.target.closest && event.target.closest('[data-backdrop-dismiss]');
    if (backdrop) backdrop._backdropPressBegan = (event.target === backdrop);
}, true);
```

Capture phase is load-bearing for the same reason session B's entry gives: the
batch-name field's `stopPropagation()` on `mousedown` would stop a bubble-phase
listener on the overlay from ever seeing that press. Delegating at `document`
rather than arming each overlay individually also means a dialog whose markup
is re-rendered (a fresh overlay element replacing the old one — several of
these are inside `innerHTML` template re-renders, not static markup) is
covered without anything to re-arm.

Each of the thirteen sites' own dismiss check now additionally requires
`overlay._backdropPressBegan` (or `this._backdropPressBegan` for the inline
markup sites) before calling its dismiss function — true only when both the
press and the click landed on the backdrop itself. All thirteen go through
this one mechanism; none carries a bespoke per-dialog patch. Sites:
`confirmOverlay`, `resolveDestOverlay`, `smCommentsOverlay`,
`calPreviewOverlay`, `calImportOverlay`, `calLinearImportOverlay`,
`calBulkLinkOverlay`, `calCommentsOverlay`, `calPromptOverlay`,
`sxrCommentsOverlay` (marked via the `data-backdrop-dismiss` HTML attribute),
and `staffIdentityOverlay`, `thumbCompareOverlay`, `calNativePostOverlay`
(marked via `overlay.setAttribute('data-backdrop-dismiss', '')` at creation,
guarded with a `typeof overlay.setAttribute === 'function'` check so a
non-DOM test stub that stands in for the overlay in `test/create-post-picker.js`
doesn't crash).

**Proof.**
- `node docs/syncview-design/tests/prod-write-gateway-browser.js` — new
  assertion in the `calendar_native_intake` phase drives the exact shape of
  the bug in a real (headless) browser: fills `#calNativeBatchName`, presses
  down inside it, drags to a corner of `#calNativePostOverlay` (guaranteed to
  be backdrop, since the overlay is `position: fixed; inset: 0` with the modal
  centered inside it), and releases there. Confirmed to fail against the
  pre-fix `index.html` with `a press that began in the batch-name field and
  released on the backdrop closed Create Post`, and to pass with the fix.
- `node test/resolve-route-chooser.js` — updated its static-markup assertion
  for the new onclick pattern and added one asserting the
  `data-backdrop-dismiss` marker is present.
- `node test/create-post-picker.js` — the `_calOpenNativePost` open-flow test
  exercises the new `overlay.setAttribute` call against a bare stub object;
  guarded rather than left to crash the test.
- `node test/run-all.js` — 564 of 566 suites pass; the same 2
  (`test/native-intake-editor-browser.js`, `test/truth-sync.js`) fail
  identically against unmodified `origin/main` in this sandbox (a missing git
  blob in a shallow clone, and pre-existing doc-rollout findings unrelated to
  this change) — not a regression.
- `node docs/syncview-design/tests/prod-boot-budget.js` fails identically
  against unmodified `origin/main` in this sandbox with no route to the live
  backend (`net::ERR_CERT_AUTHORITY_INVALID` against fonts/CDN/Supabase/Sheets)
  — the known CLAUDE.md caveat, not a regression from this change.

**Not done here.** The two sites session B's entry flagged as not equivalent
to the other eleven — `staffIdentityOverlay`'s extra `!overlay._syncviewEntry`
condition, and the confirm overlays being inline attributes rather than bound
listeners — were read and carried through unchanged rather than collapsed:
the guard fix is orthogonal to both, and folding them together was not this
fix's job.

**Addendum, 2026-09-19, same day — "thirteen" was incomplete.** A Codex review
on the PR (#1431) found the fix landed on only the thirteen sites session B's
walkthrough had actually found, and a fresh sweep of `index.html` for the same
`event.target === <overlay-like-thing>` shape turned up **eleven more**,
missed by both sessions because they don't share one naming convention:
Production's Create-issue backdrop (`_prodCloseCreate`, `data-prod-create-backdrop`)
and its Archive-repair backdrop (`_prodCloseArchiveRepair`,
`data-prod-archive-backdrop`), the Production command palette (`_prodOpenPalette`'s
`bd` element), the transcript preview modal (`transcriptOverlay`, written as an
inverted early-return — `if (e.target !== overlay) return;` — rather than the
positive check, same bug underneath), the detail-info and MR-info popovers
(`detail-info-overlay`, `mr-info-overlay`), and all five Kasper credential
overlays (`_ccOpenEdit`, `_ccOpenHistory`, `_ccOpenOnboardingImport`,
`_ccOpenBulkImport`, `_ccOpenModal`). All eleven now go through the identical
`data-backdrop-dismiss` + `_backdropPressBegan` mechanism the original thirteen
use — same helper, no new logic. The count in this entry's body above (and its
"thirteen"/"eleven" markup-site counts) is now stale text describing the first
pass; left as-is per the ledger's append-only rule rather than edited to match,
since the code and this addendum are what's current. Sweep method used to find
these: `grep` across `index.html` for every `.target === `/`.target !== `
comparison, read each hit by hand rather than trusting the pattern's shape
alone (the transcript modal's inverted early-return would have been missed by
a positive-shape-only grep). No further ones found on a second pass after the
fix.

The one library-adjacent thing this pass deliberately left alone:
`_calCardSelectClick`/`_sxrCardSelectClick`'s card-selection-checkbox overlays
also compare against a click target, but they select a card rather than
dismiss a dialog holding a draft, so the same-press/same-release ambiguity has
no data to lose — out of the class this fix addresses, not a missed instance
of it.

## 216. [2026-09-19, FIXED — MIGRATION REQUIRED, then DEPLOY REQUIRED (F27 §4)] The Create Post editor picker greyed out because it counted 3,232 rows through a 1,000-row window

**This is the fix for 214 above.** The owner's report and this entry were
written in parallel on the same day and both claimed the number; 214 keeps it
because it merged first, and this one moved to 216. 214 stays OPEN as written
— nothing in it is rewritten here — and what follows is what was done about
it: the count moved into the database, so the picker stops refusing an answer
it cannot complete.

**What the SMM saw.** The Video editor dropdown in Create Post greyed out: no
editor could be chosen, and the dialog offered no reason.

**Why.** The native picker answers "how much open video work does each editor
hold" by counting two populations — every live video deliverable, and every
`production_deliverables_browser_v1` row carrying a `raw_issue_parent_id`, so
that batch parents (a container nobody can complete) are not charged to
anyone. Both were DOWNLOADED and counted in the Edge Function. The parent
population has reached 3,232 rows. PostgREST caps a single request at 1,000
and `limit` cannot raise it, so the read came back truncated, the picker's own
`completeIntakeEditorRows` check refused it — correctly; a truncated read is an
unavailable count, not evidence that an editor is free — and the 503 is what
greyed the control out.

The refusal was right and the read was wrong. Nothing here needed a bigger
window: the answer is an aggregate, one number per editor.

**Fix.** `migrations/2026-09-19-native-intake-open-load.sql` adds
`production_native_intake_open_load(text)`, which returns one count per editor
with the live-status filter and the batch-parent exclusion inside the same
statement. Both native paths take it: `handleIntakeEditorOptions` (the picker)
and `autoAssigneeForIntake` (the silent Submit-tab pick). No row limit is left
to reach and there is no second read to keep consistent with the first.

**The other half, which nobody had looked at.** The auto-assign path had no
completeness check at all. Its open-work read was subject to the same cap, so
once that population crossed 1,000 it had been balancing on a silently
truncated count — the failure mode the picker was refusing to have. It now gets
the same aggregate or a refusal.

**What changed about degradation, deliberately.** The old parent read degraded
to an empty set on failure, on the argument that a skewed suggestion beats a
refused submission. Count and exclusion are now one statement, so there is no
half to lose; a count that cannot be established is refused rather than
reported as a load. The BROWSER's provider-lane loader keeps its degradation —
it still does two reads and still cannot refuse usefully.

**Order.** The migration is a PREREQUISITE, not a follow-up: a database without
the routine refuses the picker instead of degrading. Apply the migration, run
the read-only deploy preflight from the owner's machine, then dispatch the
F27 §4 lane at
https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-f27-section4-closures.yml
(`deploy-f27-section4-closures.yml`), which needs a sealed bundle captured
minutes before the dispatch. The routine is in the preflight `ROUTINES` list and in the install
manifest, so a database missing it stops the release at the gate rather than
inside a dispatch.

**Proof.** `test/production-write-gateway.js` runs the real handler against a
supabase double whose row reads answer exactly like the live API at the cap —
1,000 rows of a 3,232-row population — and asserts counts of 2,300 and 1,001
survive intact, that no open-work or parent rows are pulled at all, and that a
count that cannot be established is refused. A CONTROL feeds that same capped
shape to the completeness check and reproduces the 503 the dropdown was
reporting. The statuses in the SQL are pinned against the gateway's declared
`INTAKE_LOAD_LIVE_STATUSES`, and the parent-exclusion symmetry is re-pointed at
the SQL in `test/editor-count-excludes-parents.js` and
`test/deliverable-counts-exclude-parents.js`.

**Correction to this entry's own first draft: the function HAS been executed.**
It first said the SQL was argued from the statement rather than measured,
because no disposable-database lane was in reach. That was true of the session's
first hour and stopped being true: a PostgreSQL 16 server was installed locally
and the native intake lanes were run against it. `production_native_intake_open_load`
now answers the real gateway handler over a real database in
`test/native-intake-editor-projection.js` — 45 of 45 checks, including the
batch-parent exclusion (an editor holding one real video and one parent row
counts 1) and a journey that PARKS the routine out of the way and gets the 503
back, which is the state a deploy passes through if the SQL is not applied
first. `native-assignee-eligibility`, `native-intake-manifest`,
`native-intake-completion`, `native-intake-reconcile` and
`native-existing-assignment` pass on the same server.

What remains unmeasured is narrower and still real: the ACL. The migration's
`revoke`/`grant` lines are not applied in those fixtures — they name hosted
roles a disposable cluster does not have — so "service_role and nobody else can
execute it" is proven by the deploy preflight against the live database, not
here. Run that preflight from the owner's machine BEFORE dispatching.

**Amendment, same day — the two isolated PG17 lanes were red before their first
assertion, and it was this change.** Adding the migration as a candidate owner
made `scripts/linear-exit-install-manifest.js` disagree with the published
inventory, which `plan()` in `test/helpers/linear-exit-install-step.js` verifies
by STRICT equality, so every lane installing from it refused at setup. Re-issued
as `docs/independence/LINEAR_EXIT_INSTALL_SOURCE_INVENTORY_20260919.json` with
the eight references repointed — the same move #1428 made for the same reason.
The frozen 2026-09-10 base still verifies, because `verifyFrozen` tolerates a
new owner and nothing existing moved.

**Second amendment — five more lanes were red, and that was this change too.**
The `unit` lane failed five isolated-PostgreSQL suites
(`native-assignee-eligibility`, `native-intake-completion`,
`native-intake-editor-projection`, `native-intake-manifest`,
`native-intake-reconcile`), all for the same reason and all correctly: those
fixtures build their database from a pinned chain of migrations, the new routine
was not in it, and the gateway therefore refused exactly as it will against any
database that has not had the migration applied. The routine is now installed by the five
intake chains themselves, alongside the browser projection it reads, both
extracted verbatim from the repository
(`test/helpers/intake-open-load-fixture.js`, with an inline twin inside
`test/native-assignee-eligibility.js`'s `applyChain` because two suites extract
that function's source and re-evaluate it with only fs/path/__dirname bound).

**And the first attempt at that was wrong in the other direction, caught by the
same CI.** It installed out of `scripts/native-intake-manifest/harness.js`, so
EVERY lane on that harness got the view — including four that install the real
`production_deliverables_browser_v1` from the attachments migration a moment
later, which then failed `relation ... already exists`
(`native-ordinary-receipts-postgres`, `native-test-client-parity-postgres`,
`native-assignment-auth-kind-postgres`, `native-label-seed-parity-postgres`).
A fixture helper must not install what a lane's own migration chain installs;
the helper now says so in its header, and all ten lanes were run against a real
PostgreSQL 16 before this was pushed.

Two picker journeys had to change shape with it: they injected an inflated exact
count on the two row reads to prove a truncated read is refused, and those reads
no longer exist. The same contract is now asserted against the aggregate — a
parked routine, a null, an array, a non-integer and a negative count are each a
503 — plus a journey proving the picker answers again once the routine is back.

**Third amendment — the last two `unit` failures were mine as well, and the
entry's own "pre-existing" claim was wrong.** They were called pre-existing on
the strength of a control run against a local `main` that was 20 commits stale;
against the real base branch one of them passes. Both are now fixed:

- `linear-exit-write-diagnostics-handlers` pins the sha256 of
  `production-write/index.ts` (WR-101's composition refuses on
  `WR101_SOURCE_DRIFT`), so any gateway edit has to re-pin it, exactly like the
  deploy fingerprint. Re-pinned to the current bytes.
- `native-intake-editor-browser` FREEZES four gateway symbols byte-for-byte
  against the reviewed catch-up merge, and `autoAssigneeForIntake` is one of
  them. The guard did its job. Rather than re-baseline the whole symbol against
  a commit nobody has reviewed, the one contiguous region that changed is named
  in the suite as an exact before/after pair — the same treatment
  `handleIntakeCreate`'s additive routing metadata already gets — so everything
  else in that function must still be byte-identical and any other drift still
  fails.

The lesson is the cheap one: a control run proves nothing if it is run against
the wrong base. `git fetch origin main` first, every time.

## 217. [2026-09-19, DOCUMENTATION CORRECTED — implementation remains open] Native intake closure had conflated the outbound drain with direct browser legacy submission

The first Step 26 intake plan treated a straddling batch and the browser legacy
fallback as if one outbound switch governed both. Current source says otherwise:
for ordinary real-client, non-parity native work, `linear_outbound_enabled=off`
stops normal drain selection, while TEST/parity retain their explicit exceptions;
the browser legacy path posts directly and bypasses that switch.

The correction also removes the proposed batch-age prerequisite, requires a
read-only disposition for unfinished legacy identities, adds the missing
storage-read failure to the browser exits, and makes unenrolled clients a visible
hold rather than automatic enrollment or legacy submission. SQL observability,
if selected, requires an additive migration plus Storage-authorized installation
and readback; it cannot ship through GitHub Pages. A flag-only cutoff uses the
canonical Storage flag-control procedure, not the Section 4 function deploy.

No production behavior changed in this repair. The browser closure, any optional
observability, and the final cutoff remain separate future work.
