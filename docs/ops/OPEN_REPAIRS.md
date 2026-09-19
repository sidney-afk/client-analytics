Warning: truncated output (original token count: 422776)
... 642525 bytes omitted ...

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
detect-only. Proven on a named row rather than asserted: `GRA-7045` reads
priority **Urgent in Linear, 2 in SyncView** — someone set it in Linear, where
graphics priority no longer counts. The `outbound_archive_mismatch` pairs
(`GRA-7064`/`7065`) are canceled-in-SyncView samples Linear has not archived.
None of it is lost work — `foreign-write-strand-check` reads **0 stranded** —
but it is the same conversation item 19 is about, now visible from a second
direction.

## 19. [repair] Editors and SMMs are still editing graphics in Linear

Post-flip, a Linear status edit on a graphics issue no longer takes effect.
Measured as `mirror_in_status_change` — a Linear-originated change the system
actually APPLIED: **1,406 in the week before the flip, 8 since.** That lane went
to zero by design; the open question is whether the people driving it noticed.

The residue says not entirely: the shadow audit still shows 29 graphics rows in
live disagreement with Linear four days on (item 18), and the largest bucket is
due dates (item 17).

Nothing tells the person their edit did nothing; it is a silent no-op on their
screen. This is a communications repair, not a code one — the people who still
work graphics out of Linear need to be told, individually, that graphics now
lives in SyncView.

- Do NOT size this from the raw `foreign_write_detected` count. Audited
  2026-08-20: of 932 such events since the flip, all 661 on flip day were a
  single Linear cycle rollover at 23:00Z, 40 are comments (which ARE persisted
  before the detect-only event is written), and 58 are our own writes echoing.
  See `FLIP_BUG_LEDGER.md` §1.
- **This is the single highest-leverage item for the video flip**, where the
  same lane is running at ~2,000 applied changes a week and covers the whole
  editor → SMM → review chain.
- Done when: the people concerned have been told, and the graphics rows in the
  shadow audit residue stop being replenished.

**RE-MEASURED 2026-08-22 — the graphics half is quieter than this entry
implies, and the video warning is confirmed.** Applied Linear-originated status
changes (`mirror_in_status_change`), split by team, which this entry's original
"8 since" figure did not show:

| day | video | graphics |
|---|---|---|
| 08-12 → 08-14 | 87–153 | 41–100 |
| 08-16 (flip day) | 1,183 | 0 |
| 08-17 | 463 | 8 |
| 08-18 → 08-21 | 99–186 | **0 every day** |

The graphics lane is genuinely closed: the 8 this entry counted were all on
08-17, and there have been none since. Video is running at 99–186 a day, which
is where the "~2,000 a week" warning comes from — so **the video-flip half of
this item stands exactly as written**, and it is the part worth acting on.

The behaviour behind it is also fading on its own. `foreign_write_detected`, the
people still editing graphics in Linear: 661 on flip day, then 119, 30, 88, 50,
28, and 2 so far on 08-22 (a partial day). Paired with the strand check — 2
genuinely stranded rows out of 402 touched in fourteen days — the cost of the
remaining behaviour is small and falling, not accumulating.

So the graphics conversations are worth having, but they are no longer urgent
and the residue is not being replenished at the rate this entry feared. What
does NOT change: none of this tells a person their Linear edit did nothing. It
is still a silent no-op on their screen, and that is the same shape as the
"reload the page" defect closed under item 13 — the system knowing something the
person cannot see.

## 20. [closed] Cards with a Linear link and no native row — backfill applied 2026-08-20

Measured 2026-08-20 across 581 active calendar cards: 110 carry a video Linear
link with no native video deliverable (104 the graphics equivalent). **An
earlier version of this entry, and the advice given from it, treated all 110 as
a pre-video-flip problem. Broken down by status they are almost entirely
finished work:**

| video_status | cards | |
|---|---|---|
| Posted | 75 | done; nothing will edit them again |
| N/A | 21 | an SMM deliberately marked the lane not-applicable |
| Approved | 12 | done |
| **In Progress** | **2** | **the only live work in the set** |

So the disposition for 108 of them is **accept as legacy** — no import, no
backfill, no action. They work today through the Linear gateway and will never
be touched again.

The 2 live ones both already HAVE their native deliverable (B1 imported it,
bound to the correct card); only the card fails to record the id. That is
exactly what the linkage backfill fills, so this item collapses into the one
below rather than needing anything of its own.

**Linkage backfill population (the real work item):** 78 fillable slots — 74
calendar video, 4 calendar graphic, 0 samples. A slot is fillable when the
card's own Linear link resolves to an existing deliverable and the id column is
null; the backfill invents nothing and decides nothing. It is authority-agnostic
since #1075 and can run now.

- **DONE 2026-08-20.** `APPLY=true node scripts/b3-linkage-backfill.js`,
  authority read live, teams `[video]`: 22 attempted, 0 skipped, 22 verified, 0
  failures, `remaining_archive_failures: 0`. `resolved_by_id` 679 → 701 and
  `resolved_by_exact_url` 22 → 0, exactly the dry run's projection.
- Verified after: **zero** fillable video slots remain on any non-archived card.
  The 49 that still resolve by URL are all on `Archived` cards. Both live cards
  (`VID-13437`, `VID-13426`) now carry their deliverable ids.
- The planned count was 22 rather than the 78 fillable slots this entry first
  named: the script also skips 189 `archive_only` and 5 `duplicate_live_link`,
  and it matches deliverable `kind` to the slot, so three cards whose VIDEO slot
  points at a GRAPHICS issue were correctly refused rather than mis-filled.

## 21. [closed] Deploy #19 — `production-write` v45 live 2026-08-20

`production-write` has been live on **v44** since deploy #17. The submit-tab
thumbnail-text feature merged 2026-08-19 (#1102) is edge-function source and is
therefore **inert until deployed**. Nothing is broken by the gap — the feature
simply does not exist in production — but the repository and the live function
have disagreed since then, which is the state deploy records exist to prevent.

The lane pins already match `main` (`production-write` `721028df…`,
`linear-outbound` `d83f0d7c…` at `7bfad747`), so no re-pin is needed; only the
sealed capture, its upload, and the dispatch remain.

- **DONE 2026-08-20.** Run `32401740096`, commit `2317bc4a`, all green.
  `production-write` 44 → **45**; the other three deployed byte-identical
  (`linear-outbound` 42, `deliverable-write` 30, `batch-write` 30). Sealed
  capture `d0cf9ee1…` / 430331 bytes is the CURRENT restore bundle; every
  earlier bundle is stale, including `bd79115c…` from deploy #18. Full record in
  `EXECUTION_LOG.md`.

## 22. [repair] Linear test-issue debris across two projects

> **⚠️ DUPLICATE NUMBER.** Two entries claim `22`. **This one is the Linear test/drill issue debris across two projects (flip week).** The other `22` is "Nothing reconciles `deliverables` against Linear" (2026-08-20). No reference outside this file cites either by number; cite them by number AND subject.

~354 test/drill issues accumulated across two Linear projects during the flip
week. They inflate `repair_list_size`, the shadow audit's entity counts and the
F40 counter, which makes every one of those numbers harder to read as a signal.

- Low priority, no functional impact.
- Done when: the debris is archived or the counters explicitly exclude the
  drill projects, and `PRE_FLIP_HEALTH_CHECK.md`'s CONTEXT floors are restated
  against the cleaned numbers.

### 2026-08-22 — re-measured, and the number was wrong

`~354` counted archived issues alongside live ones, which made a mostly-finished
cleanup look like an untouched pile. Counted again, live only:

| Linear project | live issues |
| --- | --- |
| [Sidney Laruel](https://linear.app/synchro-social/project/137d80cc-0798-4c0d-9604-1622b871ea9f) | 74 |
| [Test Project](https://linear.app/synchro-social/project/test-project-34326a93eba0) | 23 |
| **total** | **97** |

Those two projects are the whole of it — a workspace-wide search for `drill`
returns nothing outside them. Everything else counted under `~354` is already
archived. The live remainder is the `Write UI daily drill <timestamp>` fixtures
the write-drill lane creates (Backlog on Graphics, Triage on Video), the flip
week's card/deliverable pairs, and two `TEST (IGNORE)` posts.

**This one needs the owner's hands.** The Linear MCP surface has no archive
mutation and no `LINEAR_API_KEY` reaches a session, so it cannot be done from
here. In the Linear UI it is two bulk actions: open each project above, select
all (`Cmd/Ctrl-A`), and archive. Nothing outside those two projects is touched,
and both are the TEST client's.

Worth knowing before doing it: archiving the Video issues WILL flow back into
SyncView, because Video is Linear-authoritative — the mirror will archive their
deliverables too, which is the desired outcome for test rows. The Graphics ones
are SyncView-authoritative, so those archives are recorded as detect-only and
their SyncView rows stay put. If the graphics rows should go too, they need a
SyncView-side archive rather than a Linear one.

### 2026-08-22 — owner declined, on a premise the data does not support

The owner's reason: *"all of them are backlog. So if they're backlog, that means
it doesn't appear in the workload calendar and stuff."* Both projects still hold
all 97 issues, so nothing was archived.

Measured, because the premise is checkable and it is wrong in two steps:

- `wlIsActiveStatus` treats **Backlog as ACTIVE work**. Only `completed`,
  `canceled`, `duplicate` and `triage` are terminal, and `WL_PARKED_STATUSES`
  parks approval states — not Backlog.
- `'Sidney Laruel'` is **on `WL_CLIENT_NAMES`**, the Workload roster, so the
  test client's issues pass the client filter too.

So they do appear, and they are not unassigned noise:

| team | assignee | backlog issues | carrying a due date |
| --- | --- | --- | --- |
| Video | editor A | 23 | 23 |
| Graphics | editor B | 16 | 13 |
| Video | (unassigned) | 13 | 0 |
| Graphics | (unassigned) | 5 | 0 |

**39 fixture issues sit in two real editors' workload, 36 of them with real due
dates.** Whether that is worth two bulk archives is still the owner's call — but
it should be made against this, not against "backlog is invisible".

### 2026-08-23 — the owner made the premise TRUE instead

Owner ruling: *"backlog things should not appear."* `wlIsActiveStatus` now
excludes the Linear workflow-state type `backlog`, so all 39 of those fixture
issues left both editors' panels on their own. The archive is no longer needed to
get them off the Workload page.

Measured the same day, so the size of what left is on the record:

| | rows |
| --- | ---: |
| Workload rows before | 1,073 |
| Workload rows after | 392 |
| dropped | 681 (273 of them assigned) |

Of the 681, **51 carried both an assignee and a due date**: 36 are this test
client with FUTURE dates, and 15 are real clients with dates **already in the
past**. **Real-client rows with a future deadline that left the page: zero.**
The 15 overdue real rows are the one genuine loss of visibility here, and they
are backlog items nobody had started that were already past due.

It does NOT close the rest of this item: 97 fixture issues still inflate
`repair_list_size`, the shadow audit's entity counts, and — until 2026-08-23 —
the F40 counter. Archiving them is still two bulk actions in the Linear UI and
still the owner's hands. What changed is that it is now a counter-hygiene job
rather than something two editors see every day.

## 23. [repair] Archiving stopped parking its sub-issues — it has fired ONCE since it shipped

> **⚠️ DUPLICATE NUMBER.** Two entries claim `23`. **This one is archiving no longer parking its sub-issues (2026-08-20)** and is the one meant by `index.html` ("11 archives since the feature shipped, 0 parks") and `test/calendar-archive-parks-sub-issues.js`. The other `23` is the `GRA-7112` attribution row, which is what the foreign-write-strand entry in `PRE_FLIP_HEALTH_CHECK.md` means.

Found 2026-08-20 while unarchiving a card at an SMM's request. The card had been
archived 16 seconds after creation; both its Linear sub-issues were still sitting
in **Todo**, assigned and dated, for a post that no longer existed.

That is precisely the condition PR #1080 was written to remove (owner ruling
2026-08-17; measured that day: of 37 archived cards carrying deliverables, 33 of
their 50 sub-issues were still open, several in SMM or client approval).

Measured across the whole outbox:

- **Exactly ONE** `status` intent carrying `backlog` exists, created 2026-08-17 —
  the day the feature shipped.
- Of the **11 card archives since 2026-08-17** whose card names a graphics
  deliverable, **0** produced a Backlog park within ±3 minutes.

`_calArchiveOne` calls `_calArchiveParkSubIssues(calState.posts.find(p => p.id ===
id), useSlug)` and that helper returns immediately on a falsy `post`, so a card
missing from `calState.posts` at that instant parks nothing and reports nothing —
the `failed` counter only increments when a push actually throws, so the silent
path also skips the "Archived, but a sub-issue is still open" notice. That is a
hypothesis, not a diagnosis: the video leg pushes through the legacy n8n lane and
would leave no outbox row even on success, so only the graphics leg is evidence
here, and the reason it produced nothing has not been established.

- Do NOT fix this from the hypothesis above. Reproduce first on the TEST client:
  archive a card with a linked graphics sub-issue and watch for the outbox row.
- Worth checking in the same pass: whether the notification fires at all, since a
  silent failure is what let this run for three days unnoticed.
- Done when: an archive on the TEST client parks its graphics sub-issue to
  Backlog, a regression test executes the path rather than grepping it (the
  original shipped with source pins only), and the 10 unparked archives from
  2026-08-17 onward have a decided disposition.

### 2026-08-22 — one silent window PROVEN and closed; the live reproduction is still owed

The register was right that the cause was unestablished, so this was not fixed
from the hypothesis: `test/calendar-archive-parks-sub-issues.js` EXECUTES the
real `_calArchiveOne` + `_calArchiveParkSubIssues` and demonstrates the failure
rather than arguing it. What is now proven:

- The park target was read from `calState.posts` **after** the archive write
  and after two awaits. Executed with the row dropped from that list mid-write
  — which a refresh, a client switch or a filtered rerender does — the old code
  parked NOTHING.
- A falsy post returned `{parked:0, failed:0}`. The caller ignores the return,
  and `failed` only counts pushes that THREW, so that path also skipped the
  "a sub-issue is still open" notice. Silent by construction.

Closed: the row is captured BEFORE the write, the row the server echoes back is
used as a fallback (id-checked, so a mismatched echo cannot park the wrong
card), and an unresolvable card now RAISES a notice instead of returning
success. Eight behaviours are pinned by execution and five mutations are proven
fatal by exit code.

**This does not close the item.** It is not proof that this window caused the
11 unparked archives: the video leg pushes through the legacy n8n lane and
leaves no outbox row on success or failure, so the graphics leg is the only
evidence either way. Still owed, unchanged: the live TEST-client reproduction,
and a disposition for the 10 historical archives.

### 2026-08-22 — the TEST-client reproduction, from live data, and a correction

**The "ONE park exists" line above was misread.** That intent was created
`2026-08-17 20:45:31Z`. PR #1080 merged at `2026-08-18 00:02:52Z` — three hours
and seventeen minutes LATER. It cannot have come from a feature that did not
exist yet; it was a manual Backlog move that happened to land the same day. So
the correct statement is stronger than the one it replaces: **since the feature
merged, the number of archive-driven parks on any client is ZERO.**

**The reproduction.** Every TEST-client card archive since the feature merged,
joined to its graphics deliverable and to any Backlog intent within ±3 minutes:

| archived (UTC) | card | graphics deliverable | parks within ±3 min |
| --- | --- | --- | --- |
| 2026-08-20 19:08:26 | `p_mqjzobk2_xnw24` | GRA-6311 | 0 |
| 2026-08-20 19:08:25 | `p_mqjzlp3t_yk13m` | GRA-6273 | 0 |
| 2026-08-20 19:08:22 | `p_mqjznt6m_h4k9o` | GRA-6310 | 0 |
| 2026-08-18 16:35:48 | `p_native_ac44…_1` | (native) | 0 |
| 2026-08-18 15:29:00 | `p_native_e797…_1` | (native) | 0 |
| 2026-08-18 15:28:58 | `p_native_77a1…_1` | (native) | 0 |
| 2026-08-18 15:28:56 | `p_native_8733…_1` | (native) | 0 |
| 2026-08-18 00:15:25 | `p_native_8eb8…_1` | (native) | 0 |

**Eight for eight.** Three preconditions were checked so that "no outbox row"
means "the park did not run" rather than "the evidence went somewhere else":

- Every one of those cards carries BOTH Linear links AND both native deliverable
  ids, so the helper's `if (!url && !nativeId) continue` skip cannot explain it.
- `sidneylaruel` has been in `write_ui_reroute_clients` continuously since
  2026-08-04 (`flag_flips`), so these archives took the GATEWAY, not the legacy
  n8n lane. A legacy push would leave no outbox row and would have made this
  measurement worthless; it did not apply.
- Both the bulk (`_calArchiveSelected` → `_calRunPooled`) and single-card paths
  call the same `_calArchiveOne`, so there is no second archive path that skips
  the park.

**What this rules in and out.** A 100% failure rate is not a race. The window
closed above is real and provably loses the row, but a timing window would show
up as intermittent, not as eight for eight — so that fix is necessary and almost
certainly NOT sufficient. Two candidates survive, and they are distinguishable
by one observation:

- Stale tabs (F127: a deploy does not expire open tabs). An archive from a tab
  loaded before 2026-08-18 00:02Z runs pre-feature code and parks nothing,
  silently. This fits the real-client archives well; it fits a deliberate
  TEST-client bulk archive on 2026-08-20 less well.
- Something in the park push itself returning early after the archive write,
  leaving no row and raising nothing.

**The 30-second confirmation, for the owner.** Hard-reload SyncView first
(`Ctrl-Shift-R` — a normal reload can serve the old tab's script), open the TEST
client, and archive one card that has a graphics sub-issue. Then this settles it
without further guessing:

```sql
select m.id, m.created_at, m.deliverable_id, m.status, m.last_error,
       m.payload->>'status' as intent
from mirror_outbox m
where m.payload->>'status' = 'backlog'
  and m.created_at > now() - interval '15 minutes'
order by m.created_at desc;
```

A row means the fix is sufficient and stale tabs were the cause. No row, from a
freshly loaded tab, means the push itself is returning early and the next step is
the browser console during the archive, not more source reading.

- The 10 historical archives still need a disposition; nothing above changes
  that, and the parks that exist for six of those cards are the manual 14-second
  catch-up sweep of 2026-08-21 14:51–14:52, not the feature.

## 28. [owner] The credentials gateway treats an omitted field as a deletion

Found 2026-08-22 in review of the mark-reviewed button. `materializeCredential`
in `client-credentials` builds a FULL row and the caller updates with
`{...row}`, so a field the browser does not send is written as NULL — and
`raw_import` is a DIFF_FIELD, so the deletion is recorded in the audit trail as
if somebody meant it.

This is the same shape as item 24, one layer up: **absent meant NULL, not "no
opinion"**. Two browser callers were dropping `raw_import`, and all 47
`needs_review` rows carry it — those are exactly the rows the new confirm button
targets, so every click would have destroyed the provenance of an import.

Both callers now carry it through, and the confirm refuses outright if the row
it read has no `raw_import` key at all rather than writing one blank. That
closes it for every caller that exists today, since the browser is the only one.

What is NOT fixed, deliberately: the gateway itself still turns an omitted field
into null, so the landmine is armed for any future caller. Hardening
`materializeCredential` to preserve on absence is an Edge Function change and
would need a Section-4 deploy, and this PR is otherwise deploy-free — smuggling
an inert EF change into it would make that claim untrue. Recorded here instead.

- Done when: `materializeCredential` preserves a field the caller omitted rather
  than nulling it, and that ships in a deploy.

## 22. [repair] Nothing reconciles `deliverables` against Linear

> **⚠️ DUPLICATE NUMBER.** Two entries claim `22`. **This one is "nothing reconciles `deliverables` against Linear" (2026-08-20).** The other `22` is the Linear test/drill issue debris across two projects. No reference outside this file cites either by number; cite them by number AND subject.

Found 2026-08-20 while chasing a designer's report that her Workload and her
Production tab disagreed. That report was a red herring (her "Show sub-issues"
was off), but measuring it surfaced a real gap.

**The reconciler walks CARDS, not deliverables.** `scripts/linear-sync-reconcile.js`
iterates `calendar_posts` components and compares each against its Linear issue.
Post-flip it is additionally PULL-ONLY for a SyncView-authoritative team: F50
suppresses card→Linear on the reasoning that "the outbound mirror carries it"
(see the `mirrorOwned` branch). Both choices are defensible on their own. Together
they leave two populations with **no backstop at all**:

1. **A deliverable with no card.** The reconciler never enumerates it. `GRA-7087`
   sat drifted from 2026-08-19 18:26 until it was found by hand.
2. **A deliverable whose card disagrees with it.** The reconciler reconciles the
   CARD against Linear and is satisfied; the deliverable — which is what the
   Production tab actually renders — is never compared to anything.

The mirror is the only thing keeping graphics converged, and the mirror has
already been proven to drop writes: that was the self-echo bug, 61 clobbers,
fixed in deploy #18. A single component whose only guarantee is a component with
a known failure history is not a guarantee.

Live census 2026-08-20 (graphics, active, excluding canceled/duplicate/posted):
**7 rows** where the deliverable and Linear disagree. One real client
(`GRA-7087`), one unattributed (`GRA-7112`), five TEST fixtures. Six of the
seven disagree THREE ways at once — deliverable `todo`, card `In Progress`,
Linear `Backlog` — which is why there is no single value to push and why the
owner ruled to leave them (2026-08-20).

- Owner decision 2026-08-20 on the one real row: advance SyncView to match
  Linear (`smm_approval`), because the file was genuinely delivered — a
  SyncView canonical revision is attached — so Linear held the truer value and
  bouncing it back would have pulled finished work out of the SMM queue.
- Owner decision 2026-08-20 on the other six: leave them. No client sees any of
  them, and writing to TEST fixtures only adds foreign-write noise to the
  health check.
- **Before the video flip this must be answered, not repeated.** Video is the
  larger corpus and is about to become the mirror-owned side. Either extend the
  reconciler to enumerate deliverables directly (including card-less ones), or
  state explicitly that the mirror is the sole guarantee and give it its own
  drift alarm. Doing neither means the video flip inherits a lane where a
  dropped mirror write is permanent and invisible.
- Done when: a scheduled job compares `deliverables` to Linear for every
  authoritative team and reports a count, and this entry links its first green run.

### CORRECTION 2026-08-22 — the "done when" above is ALREADY DONE; the gap is narrower and different

This item's title is wrong as written, and acting on it would fund a build that
exists. `scripts/linear-deliverables-reconcile.js` IS the deliverables⇄Linear
diff engine this entry asks for: it fetches `deliverables` with **no `card_id`
filter** (`supabaseRows('deliverables', DELIVERABLE_SELECT, …)`, :648), so it
enumerates card-less rows too, compares status/title/due/priority/assignee/
parent/archive/comments per row, and writes the `linear_deliverables_reconcile_v2`
summary. n8n dispatches it **every 10 minutes** (`SyncView Monitoring Pager +
Reconciler V2 Trigger`, node `Trigger Reconciler V2`). `GRA-7087` — the row this
entry offers as proof that nothing watches — is in that engine's own residue.
The paragraph above about `linear-sync-reconcile.js` walking CARDS is true, but
that is the OTHER reconciler; the two were conflated.

What is actually missing is narrower, and cheaper:

1. **Nothing is permitted to ACT.** n8n dispatches it with `apply:"false"`, so
   it detects and never heals. That is a deliberate posture, not an oversight —
   but it is the posture, not the absence of a diff engine.
2. **Nothing ALARMS.** For a SyncView-authoritative team the outbound counter
   was demoted from GATING to CONTEXT on 2026-08-18 (correctly — see the health
   check), so a nonzero graphics number pages nobody at all.

Progress 2026-08-22: the *human* half of (2) now exists as
`scripts/foreign-write-strand-check.js`, wired into the health check's CONTEXT
list. It answers the question this entry actually cares about — "is anybody's
work sitting where SyncView cannot see it?" — and measured **2 rows in 14 days**
against 976 raw foreign writes, which is why the raw count must never be the
alarm. Still open: whether the reconciler may repair on its own, and an alarm on
the engine's own count for the video flip.

## 23. [owner] `GRA-7112` is attributed to `unattributed` — identified, SQL ready

> **⚠️ DUPLICATE NUMBER.** Two entries claim `23`. **This one is the `GRA-7112` attribution row** and is the one meant by the foreign-write-strand entry in `PRE_FLIP_HEALTH_CHECK.md`. The other `23` is archiving no longer parking its sub-issues (2026-08-20), which is what `index.html` and `test/calendar-archive-parks-sub-issues.js` mean.

Surfaced by the same census. Its status drift is cosmetic; the real defect is
that it carries no client mapping, so it appears in no client's view and its
status has no owner. Fixing the status would leave it unattributed anyway.

**IDENTIFIED 2026-08-22 — it is the TEST client, and the evidence is
unambiguous.** Three independent pointers all say `sidneylaruel`:

- its batch `bat_f1aa24b0…` is `client_slug = sidneylaruel`,
- its sibling row on the same card (the Video half) is `sidneylaruel`,
- the card itself, `p_native_8eb840a2…_1`, belongs to `sidneylaruel`, is named
  "Test 4", and is already archived.

So this is drill residue, not a real client's work, and the repair is to make
the row agree with the three things that already point at it. Written here
rather than done: the direct SQL path is blocked in this session, so it is one
paste for the owner. It goes through `deliverable_write` rather than a raw
UPDATE so the change is recorded as an event like every other status write, and
it rebuilds the payload FROM the stored row so nothing else can move:

```sql
begin;
select public.deliverable_write(
  (select jsonb_build_object(
     'id', id, 'client_slug', 'sidneylaruel', 'batch_id', batch_id,
     'team', team, 'kind', kind, 'title', title, 'status', status,
     'origin', origin, 'card_id', card_id, 'created_by', created_by,
     'created_at', created_at, 'linear_issue_uuid', linear_issue_uuid,
     'linear_identifier', linear_identifier, 'linear_issue_url', linear_issue_url)
     from deliverables where id = 'del_b0f1f2c9-5832-4708-9ac0-224a8e5d0ace'),
  jsonb_build_object('source','system','action','attribution_repair','actor','owner',
    'payload', jsonb_build_object('from','unattributed','to','sidneylaruel'))
) is not null as repaired;
select id, client_slug, batch_id, card_id, file_url, comments
  from deliverables where id = 'del_b0f1f2c9-5832-4708-9ac0-224a8e5d0ace';
commit;
```

`file_url` and `comments` are deliberately absent from that payload — a present
key is what `deliverable_write` treats as an instruction, so naming them would
blank them (see item 24). The readback prints both so you can see they survived.

- Done when: the row reads `sidneylaruel` and this entry says so.

---

## 24. [closed] The importer set `file_url` and `comments` to NULL on every operational write

Found 2026-08-22 while auditing what B1 writes. `deliverableRow` emitted
`file_url: null` and `comments: null` on every row it built (since 2026-07-10).
`deliverable_write` merges per column on key PRESENCE, not value —
`file_url = case when v_row ? 'file_url' then excluded.file_url else d.file_url
end` — and a JSON null is a present key. So "I have no opinion" was written as
"set it to NULL", and every write the importer made erased whatever file a
person had attached and whatever comment they had typed.

Proven, not reasoned: calling the live `deliverable_write` with `file_url` null
against a row holding a Drive link left the column NULL. The probe ran inside a
transaction that was rolled back, so nothing persisted.

Why the damage was not universal: `softClosedDeliverableRow` — the builder used
for closed and out-of-window issues — never emitted either key, so archived rows
survived while live ones did not. That split is exactly what the live evidence
showed: of the 11 rows that took a B1 write after a file was attached, the 10
archived drill rows kept their file and the one operational row lost it.

Measured 2026-08-22:

- B1 writes ~150–270 deliverables/day, so the mechanism fired constantly.
- 102 rows currently hold a `file_url`, 26 hold `comments`.
- 82 of the file-carrying rows belong to real clients; 40 of those are still in
  a non-terminal status, i.e. one Linear-side change away from losing the link.
- Detectable historical loss: ONE row, and it is the TEST client's drill
  fixture (`GRA-7029`, wiped 2026-08-11T15:57Z). Every real-client attachment
  recorded by an `attachment_change` event happened after that row's last B1
  write, so no client-visible loss is provable. That is the honest reading —
  attachments set by a path that logs no event cannot be checked either way.

Fixed by omitting both keys from `deliverableRow`, which is what the soft-closed
builder already did. Pinned by `test/b1-preserves-attachments-and-comments.js`,
which models the RPC merge rule and executes it against a stored row holding a
file and a comment, so restoring either key fails on the surviving value rather
than on a source regex. Five mutations were proved to kill it.

- Done when: shipped. No repair SQL is owed — the only wiped row is a drill
  fixture and its value is still recoverable from its `attachment_change` event
  if anyone ever wants it.

---

## 25. [repair] The nightly suites are not "red for weeks" — each is ONE assertion

Corrected 2026-08-22 after reading the lanes instead of the rollups. Both
nightlies report a single failing assertion inside an otherwise green run, and
the two failures are unrelated.

**Samples E2E — fixed here.** `scenarios 11/12 · assertions 86/87`; unit,
parity, realtime and tree green every night. The one failure is
`create_drag_reorder_persist`, and it is a harness defect: `smm.dragToFront`
returned `already-first` whenever the card it was asked to move was already at
the head of the strip, and the scenario supplied nothing to move it against —
it inherited whatever a previous run had left behind. On any night the TEST
client started clean, the newborn was the only card and the step failed. Failed
2026-08-16 → 2026-08-21 on exactly this assertion.

Fixed by making the helper round-trip an already-first card (back, drop, front,
drop) — which is a stronger exercise than the original, because the second drop
lands while the first is in flight and so covers the coalescing branch of
`_sxrPersistReorder` that the scenario title always claimed to cover — and by
making the scenario seed and PROVE its own anchor row. A strip holding a single
card now reports `nothing-to-reorder` rather than passing vacuously. Pinned by
`test/qa-drag-to-front-reorders.js`, which extracts and EXECUTES the real
helper; 5 mutations, all killed.

**Corrected 2026-08-27 — "fixed here" was premature; the lane stayed red on a
SECOND harness defect.** After the drag started really happening, the nightly
kept failing 2026-08-23 → 2026-08-27 on the same assertion with a new shape:
`DOM first="UI Drag Newborn" · DB first="XSESSION Drag Anchor"`. That read as
"reorder renders but does not persist" — the alarming interpretation — and it
was false. `sample_review_events` holds the proof for the 2026-08-27 run:
`sample-review-reorder` matched BOTH rows and wrote newborn→"999",
anchor→"1000" at 17:38:17, three seconds after the create. The reorder
persists, and always did.

The defect was in the gate itself: `sample_reviews.order_index` is a TEXT
column (Sheets-era legacy — PostgREST returns `"400"`, not `400`), and the
engine's DB check asked PostgREST for `order=order_index.asc&limit=1`, which
on text is LEXICOGRAPHIC — `"1000"` sorts before `"999"`, so the anchor was
"first" and the pass was impossible whenever the slots crossed a digit-count
boundary (the anchor is seeded at 999 precisely so the newborn lands at 1000).
Every real consumer sorts `Number(order_index || 0)` — the strip, the
calendar, the drop handler — so no user ever saw the wrong order; only the
harness's server-side sort did. The gate now fetches the live rows and takes
the numeric minimum, matching what the product actually does.

Two lessons on the record: (1) a nightly that has NEVER been green (checked
back to 2026-07-29 — its whole visible history is red) cannot alarm anyone
when it matters; each fix must be verified against the next actual run, not
declared from the diff. (2) When DOM and DB "disagree", check the COLLATION
of the comparison before the persistence path — the same column can sort two
different ways in two different consumers, and the durable event ledger
(`sample_review_events`) settles in one query what code-reading cannot.

- Done when: the next samples nightly is green. The fix cannot be run locally —
  the lane needs the staff key and a live backend — so the nightly is the proof.
- **ANSWERED 2026-09-03 by item 138: it went green.** Run 62, 2026-09-02 — the
  lane's first success in its visible history, and `create_drag_reorder_persist`
  passes. This half is DONE. Run 63 is red again on a different probe entirely
  (`sxr_gating_flags`), diagnosed in item 138 as a fixed-sleep race and fixed
  there; do not read that red as this entry re-opening.

**Calendar E2E — fixed here too.** `1 of 68 probes FAILED after 3 attempts:
p92_sxr_resolve_pill_inplace.js`, and the run printed exactly which assertions:

```
  OK   pill data-val flips in place, NO reload (got Kasper Approval)
  BAD  pill label flips in place (got N/A)
  BAD  pill colour class flips in place
```

`data-val` carries the STORED status and passed; the label and the colour class
carry the DISPLAYED status and did not. The probe seeded a row with NO Linear
link on either component, and since the 2026-08-20 display ruling an unlinked
component does not show its stored status at all — `_calPillDisplayStatus`
substitutes `N/A` for anything outside Approved / Scheduled / Posted. So the
probe demanded `Kasper Approval` while the product was correctly rendering
`N/A`. The product is right and the probe was stale.

The intermittence — green 08-16, 08-17, 08-18, 08-20 and red 08-19, 08-21 —
comes from `_calCompLinked` also accepting a `video_deliverable_id`, which the
native lane attaches to TEST-client rows asynchronously. The probe was racing
it, and three retries could not help because every attempt raced the same way.

Fixed by seeding both components LINKED, exactly as the scenario engine's own
default seed does, so the probe measures the thing it is named for. It also now
asserts the linkage precondition by name, so a seed that loses its link fails
with a readable reason instead of a confusing `N/A` three steps later. Pinned by
`test/p92-probe-seeds-a-linked-component.js`, which EXECUTES the real
`_calCompLinked` and `_calPillDisplayStatus` against the seed the probe actually
writes — reproducing both the failure and the race offline. 5 mutations killed.

Residual risk, stated rather than fixed: the probe still waits a fixed 400 ms
after clicking the destination before asserting. That was left alone
deliberately, so the next nightly is a clean test of the linkage diagnosis
rather than of two changes at once. If it still fails on the same two
assertions, the 400 ms is the next thing to replace with a bounded wait.

- Done when: the next calendar nightly is green.
- **ANSWERED 2026-09-03 by item 138 for THIS probe:** `p92_sxr_resolve_pill_inplace.js`
  reports `pass=10 fail=0`. The linkage diagnosis was right and the 400 ms
  residual risk recorded just above did not bite. The lane is still red, but on
  three OTHER probes (`p77`, `p81`, `p86`), all failing on the pre-F1 video
  link-paste contract — see item 138.

---

## 26. [closed] The "~6% of new cards miss the stamp" leak — re-measured, and closed

`GRAPHICS_FLIP_STATUS.md` carried that figure from 2026-08-06 onward and it kept
being read as current. Re-measured 2026-08-22.

The eight-week number really is still 6.0% (20 of 331 real-client cards), which
is the trap: 14 of those 20 are a single July day when thirteen cards were
bulk-created unlinked and archived hours later. Over the five weeks since, 215
cards produced 5 unlinked (2.3%), and the most recent full week produced 0 of 43.

Only TWO live unlinked cards exist in eight weeks, and neither is lost work: one
is a note card holding a document link in its caption — a legitimate use of the
calendar — and the other is an empty card created 2026-07-10 and never touched
again. That second one is clutter on a real client's calendar; archiving it is
an owner call, so it is listed under owner decisions rather than done here.

Made repeatable instead of re-asserted: `scripts/card-linkage-leak-check.js`
(read-only, public key, exits 0 always) reports created / unlinked / unlinked-and-
live per week and NAMES the actionable cards, because "is this a leak or a note
card" is a judgement a person has to make by looking. Pinned by
`test/card-linkage-leak-check.js`, which executes the real classifier against
fixtures shaped like each case; 7 mutations, all killed.

- Done when: shipped. The one owner decision is whether to archive the abandoned
  blank card (`p_mrf5by6o_kd4qb`).

---

## 27. [owner — active-client harm CLEARED 2026-08-27; mechanism still open] Two of a live client's thumbnails are invisible — attribution is invalidated and never re-derived

Found 2026-08-22 while chasing item 23, which turned out to be one instance of a
general defect.

**Measured 2026-08-27 16:20 UTC:** the waiting column is **0** — GRA-7068 and
GRA-7084, the two rows this item was filed for, have left it (86 unresolved
remain: 84 repairable test-fixture/former-client rows, 2 `no_project`, none
with an active client waiting). The MECHANISM below is unchanged and will
produce new instances on the next Linear structure change touching a graphics
row; the health check's context entry keeps watching the waiting column for
exactly that.

**The mechanism.** When a Linear structure change moves an issue,
`linear-inbound` stamps its attribution `needs_attribution`, clears
`client_slug`, keeps `previous_client_slug`, and sets `repair_required: true` —
a correct fail-closed, because a moved issue may now belong to somebody else.
Nothing then re-derives it. Since the graphics flip nothing CAN on that side: B1
is gated off a SyncView-authoritative team and `linear-inbound` will not apply a
foreign write to one either, so for a graphics row the invalidation is a one-way
door. A second door reaches the same place: a row imported while its project was
unmapped is stamped `direct_project_unmapped` — correct at the time — and never
re-checked once somebody maps that project.

A row with no `client_slug` appears in **no** client view, so its state has no
owner and nobody can see it is waiting.

**The measurement, and the number that actually matters.** 92 rows unresolved;
90 of them resolvable from their own project mapping; 87 of those still live.
That 87 is the misleading number, in exactly the way "6% of new cards" was: 60
resolve to a test fixture and 25 to clients who are no longer active. **Two
belong to an ACTIVE client:**

| issue | client | status | since | due |
|---|---|---|---|---|
| `GRA-7068` | Jenna Phillips Ballard | For Kasper approval | 2026-08-12 13:40Z (10 days) | 2026-08-19, past |
| `GRA-7084` | Jenna Phillips Ballard | For Kasper approval | 2026-08-14 17:37Z (8 days) | 2026-08-21, past |

Both are Rocío's, both correctly filed in the Jenna Phillips Ballard project in
Linear, both parented under the right VID issues — and both invisible in
SyncView because the row says `unattributed`. They also carry no `card_id`, so
they are not in a review queue either. **This is real work nobody can see.**

Note for honesty: three of the six `project_or_parent_changed` rows
(`GRA-7042/7043/7044`) were invalidated by the 2026-08-21 card move to Kasper
Ads. The invalidation was RIGHT — their project now maps to `djkasper`, not
`kasperhytonen` — but nothing applied the new answer either, so a deliberate,
correct move silently produced three orphans.

**Made visible on demand:** `node scripts/attribution-stuck-check.js` —
read-only, public key, exits 0 always. It marks with `!` only the rows an active
client is waiting on, and separates a project nobody has mapped (a decision) from
a project that already names one client (no decision needed). Pinned by
`test/attribution-stuck-check.js`; 8 mutations, all killed, including resolving
an ambiguous project by picking the first claimant.

**The two repairs, for the owner to paste.** Each goes through
`deliverable_write` so the change is recorded as an event, and rebuilds the
payload FROM the stored row so nothing else moves. `file_url` and `comments` are
deliberately absent — a present key is an instruction, and naming them would
blank them (item 24).

```sql
begin;
select public.deliverable_write(
  (select jsonb_build_object(
     'id', id, 'client_slug', '<CLIENT_SLUG>', 'batch_id', batch_id,
     'team', team, 'kind', kind, 'title', title, 'status', status,
     'origin', origin, 'card_id', card_id, 'created_by', created_by,
     'created_at', created_at, 'linear_issue_uuid', linear_issue_uuid,
     'linear_identifier', linear_identifier, 'linear_issue_url', linear_issue_url)
     from deliverables where id = d.id),
  jsonb_build_object('source','system','action','attribution_repair','actor','owner',
    'payload', jsonb_build_object('from','unattributed','to','<CLIENT_SLUG>',
      'evidence','linear project 313927b9-5809-458c-b526-88e3b5d1e733 maps to exactly one client'))
) is not null as repaired
from deliverables d
where d.id in ('del_bd76112b-5d09-4209-89f2-e7f5e64444e7',
               'del_b6108a62-b4b7-48b2-be22-0e6c5a3c298e');
select id, linear_identifier, client_slug, status, file_url, comments
  from deliverables
 where id in ('del_bd76112b-5d09-4209-89f2-e7f5e64444e7',
              'del_b6108a62-b4b7-48b2-be22-0e6c5a3c298e');
commit;
```

Repairing `client_slug` makes them visible; it does not give them a card. If
they should appear in a review queue as well, that is a second, separate step.

**The decision this needs.** Post-flip, SyncView owns graphics, so the
re-derivation belongs on the SyncView side — not in B1, which is gated off the
team by design, and not in `linear-inbound`, which must not apply a foreign
write. The obvious home is the deliverables reconciler, which already builds the
attribution graph every ten minutes and already computes these repairs; today it
reports and does not act. Whether it may act, and on which of the four buckets,
is an owner call — the `repairable` bucket needs no judgement, but "no
judgement needed" is not the same as "allowed to write".

- Done when: the two rows read the client's slug, and the owner has said
  whether anything is permitted to re-derive attribution automatically.

**CLOSED on the data 2026-08-22.** The stamp repair below ran. Both rows now
read `state: resolved` / `client_slug: <CLIENT_SLUG>` in the durable
`linear_raw.attribution`, matching the column that was already repaired.
`attribution-stuck-check.js` now reports **"an ACTIVE client is waiting: 0"** in
every bucket — `repairable` 88, `no_project` 2, and not one of them belongs to a
live client. What remains under this item is only the standing owner question
about automatic re-derivation.

**The cause is fixed (2026-08-22, owner ruling).** The owner's rule: *if only
the parent changed and the project is the same, don't throw the client away.*
`linear-inbound` now asks `attributionStillCertain()` before it invalidates, and
retains the client when the ONLY attribution field that moved is the parent AND
the issue carries its own project. A project change still invalidates, and so
does a re-parent of a project-less issue — that one genuinely inherits from its
ancestor, so its owner really can move. Retention is recorded on the event as
`attribution_retained: {reason: own_project_outranks_parent}`, so the decision is
auditable rather than silent. `test/linear-inbound-attribution-guard.js` runs the
real source; 4 mutations, all killed, including one that survived a first,
vacuous version of the alias assertion.

That closes the door for future moves. It does not repair the two rows already
through it.

**The half that is still open.** The repair above went through
`deliverable_write`, which fixes the `client_slug` COLUMN but does not touch the
durable stamp in `linear_raw.attribution`. Both rows now read
the client's slug and are visible — but their stamp still says
`needs_attribution` / `repair_required: true`, with `invalidated_fields:
["parentId"]`: the exact shape the new guard would now retain. Anything reading
the stamp rather than the column (the stuck-check, the shadow audit's
`attribution_claim_mismatch`) still counts them as broken.

Restoring the stamp is the same authorized repair, finished. It rebuilds the
stamp in the identical shape a healthy direct-project row carries, and is
guarded so it can only ever touch these two rows in this exact state:

```sql
update deliverables d
   set linear_raw = jsonb_set(
         d.linear_raw,
         '{attribution}',
         jsonb_build_object(
           'schema',            'syncview_attribution_v1',
           'state',             'resolved',
           'reason',            'direct_project_mapped',
           'source',            'direct_project',
           'owner_kind',        'client',
           'client_slug',       d.client_slug,
           'project_id',        d.linear_raw->'issue'->'project'->>'id',
           'direct_project_id', d.linear_raw->'issue'->'project'->>'id',
           'ancestor_distance', null,
           'ancestor_issue_id', null,
           'repair_required',   false,
           'mapping_revision',  'd759442cad3d261ea3255422d83a17be8a2f5cac3d28c7f2b87b719df9386705'
         ),
         false)
 where d.identifier in ('GRA-7068','GRA-7084')
   and d.client_slug = '<CLIENT_SLUG>'
   and d.linear_raw->'attribution'->>'state' = 'needs_attribution'
   and d.linear_raw->'issue'->'project'->>'id' = '313927b9-5809-458c-b526-88e3b5d1e733'
returning identifier, client_slug,
          linear_raw->'attribution'->>'state' as state,
          linear_raw->'attribution'->>'client_slug' as attr_slug;
```

Expect exactly two rows back, both `resolved` / the client's slug. The
ledger trigger records the update on its own. Re-run
`node scripts/attribution-stuck-check.js` afterwards: the two `!` lines should be
gone and only former-client and test-fixture rows should remain.

---

## 29. [repair] The PTO month grid loses its arrow-key walk on ~1 PR run in 7

Surfaced 2026-08-22 by CI on an unrelated branch. `pto-ui-polish.js` asserts that
focusing a day cell and pressing ArrowRight moves focus to the next day. It fails
on roughly one PR run in seven — twice in thirteen — on commits that do not touch
PTO at all.

**I called this a timing flake and I was wrong about the mechanism.** The first
attempt assumed the test read `document.activeElement` before the handler had
moved it, and added a wait. That wait then timed out at the full 30 seconds,
which disproves the theory: on a failing run focus never reaches the next day at
all. Waiting longer was the wrong fix — but a useful one, because a 30-second
timeout is evidence where an instant read was not.

What is still unknown is WHICH of two things breaks, and the assertion was
conflating them:

- the grid re-renders when the month changes, so focusing a node that is then
  replaced sends the keypress to `<body>` and nothing moves — a harness problem;
- or the product does not reliably keep a focusable roving tab stop after a
  month change — a real accessibility defect, and the more serious answer.

The assertion is now split so that a red run names the half that actually broke,
and both waits are capped at 5s so a failure is fast rather than costing 30
seconds twice. That is a diagnosis change, not a fix: the count of red runs
should not change.

This lane needs the staff key and a live backend, so it cannot be reproduced from
a session that has neither. The next red run settles it.

### 2026-08-22 — that last sentence was false, and it is what stopped anyone looking

`pto-ui-polish.js` needs **no** staff key and **no** live backend. It serves the
page statically and intercepts every request; every identity, date and balance
in it is a synthetic fixture. It runs anywhere. Claiming otherwise turned a
reproducible flake into something only CI could see, so nobody tried.

Run here, off CI: **26 green.** Fourteen sequential, then twelve more six-at-a-
time on four cores, to starve it of CPU the way a loaded runner does. At a true
1-in-7 rate, 26 clean runs is a ~1.8% outcome — so whatever triggers it is
environmental to CI rather than inherent to the assertion, and grinding more
local runs is not the way to find it.

So the next red run is still what settles it — and a red run that says only "it
broke" wastes the occurrence. Both halves now dump the DOM state they actually
saw, appended to the failure message ONLY when the check fails, so a green log
stays readable:

```json
{"active":"button","activeDay":"2030-05-21","activeIsBody":false,
 "startAttached":true,"startTabIndex":-1,"tabStops":1,
 "monthTitle":"May 2030","dayCells":31}
```

That single line answers the question the split assertion could only point at:
whether the start node is still attached (harness — it was replaced under us),
whether focus fell to `<body>` (the keypress never reached the grid), whether
the grid kept a roving tab stop at all (the accessibility defect), and whether
the month even changed. Proven to fire by pointing the assertion at a date that
cannot exist and reading the red message.

One thing the dump already settles: focus and the roving tab stop legitimately
DISAGREE after a programmatic `.focus()` — the focused cell reads `tabindex=-1`
while the single tab stop sits elsewhere. That is not the bug.
`_ptoCalGridKeydown` walks from the cell that actually holds focus, not from the
bookmark, and says so in its own comment. The design anticipated this.

- Context: the owner ruled on 2026-08-21 that a separate PTO Escape-key bug was
  "not worth too much work". This entry is deliberately scoped to match — one
  assertion split, no product change — but it is filed rather than dropped
  because a keyboard user losing the calendar's tab stop is an accessibility
  question, not a cosmetic one.
- Done when: a red run names which half broke, and that half is either fixed or
  ruled not worth fixing.

---

## 30. [owner] The assurance ledger has been asserting freshness it lost a month ago

Found 2026-08-22 chasing "why did the client-facing proofs stop". They stopped
on **2026-07-20**, and the ledger did not say so — it said the opposite.

`docs/testing/ASSURANCE_LEDGER.md` is a claim about EVIDENCE, and it carries its
own deterministic rule: `FRESH` = age ≤ half the tier window, `NEAR` = half to
full, `EXPIRED` = beyond. Nothing enforced it. **Thirteen rows read `FRESH`** —
staff sign-in, submit intake, PTO data correctness, calendar planning and staff
writes among them — while every one was more than a month past its window.

The measurement, against the ledger's own rules:

| tier | window | rows | past window |
| --- | --- | --- | --- |
| 0 — never knowingly broken (client-facing) | 7d | 3 | **3** (33d, 36d, 39d) |
| 1 — no silent failures | 14d | 6 | **6** (35–38d) |
| 2 — correct, batched polish | 30d | 6 | **6** (33–49d) |
| 3 — substance over looks | quarterly | 4 | 0 |

**15 of 19.** All three Tier 0 rows — the client-facing ones, on a SEVEN day
window — are more than a month cold. The rows were honest the day they were
written; they rotted, and nothing did the arithmetic.

**Why it stopped, which is the actual defect.** Nothing schedules this.
`/site-assurance` is a skill somebody invokes by hand; no cron, no workflow, and
no monitor notices its absence. Every other watcher in the repo alerts on what
it finds; the dead-man's switch exists precisely because a lane that stops
running is otherwise silent — and this lane is not registered with it. The stale
dates are the symptom.

**Done in this pass** (bookkeeping and instrumentation, not proof):

- Every State cell restated against today's arithmetic, with the age in days.
  No "Last proven" date, method or verdict was touched, and the header stamp
  still names 2026-07-20 as the last real cycle.
- `scripts/assurance-ledger-freshness.js` prints the arithmetic for every row.
  Read-only, exits zero always, public-safe.
- `test/assurance-ledger-freshness.js` refuses a row claiming MORE freshness
  than its date supports, judged as of the `State (YYYY-MM-DD)` column's own
  stamp — NOT the header's refresh stamp, which is what the first version did
  and which defeated the purpose (a restatement without a new cycle keeps that
  header stamp old, so every row computes FRESH against it). So an
  overstatement is caught when written, and a file nobody touched cannot
  spontaneously turn the suite red. Five mutations proven fatal by exit code,
  including both window boundaries and a flipped overstatement direction.

**Not done, and it is the half that matters.** Refreshing the three Tier 0 rows
needs a staff key and a tokened TEST client link; no session holds either. The
client-link render half of "client-visible thumbnails" has never been proven at
all, and the share-link issuance half has not been proven in a real browser
since #838.

- ~~Owner decision: should a stale ledger PAGE?~~ **DECIDED 2026-08-23 — yes,
  and it is wired.** `assurance_ledger` is now a dead-man lane
  (`scripts/monitoring-watchdog.js` LANES, daily 07:37 UTC) written by
  `.github/workflows/assurance-ledger-freshness.yml`. The destination is the
  existing relay, which is a DM to the owner, not a team channel.

  **What it fires on, and why not the obvious rule.** "Any EXPIRED row" would
  have shipped permanently red — 15 of 19 rows are past their window right now —
  which is verbatim the failure `docs/ops/PRE_FLIP_HEALTH_CHECK.md` opens by
  blaming for teaching a team to discount its own gates. So the gate fires when
  a row **stops supporting the state written beside it**: a claim that was true
  the day somebody wrote it and has since rotted. Today every one of those 15
  rows already SAYS `EXPIRED`, so they are recorded, not news, and the lane is
  green on the day it ships. It self-arms — re-proving a row rewrites it to
  FRESH, and from then on it pages the day its window closes without a new
  proof.

  **The second clause exists because the first one has an honest silence.**
  Restating pessimistically is legal and is exactly what this pass did on
  2026-08-22; a fully-pessimistic ledger has nothing left to lapse. So if
  nobody restates or re-proves ANYTHING for 60 days, that silence is itself the
  finding. Generous on purpose: a backstop against an abandoned ledger, not a
  nag.

  **What it does not do:** the three Tier 0 rows that are cold RIGHT NOW stay
  invisible to it, by construction, because they already say so here and in the
  daily report. That is a real limit of the rule and it is the reason the
  "not done" half below is still open.

- Still not done: the Tier 0 rows carry no proof taken within their window.
- Done when: the Tier 0 rows carry a proof taken within their window. The second
  half — the ledger going stale being something the owner is told about rather
  than something someone has to go and check — is closed.

---

## 31. [owner] Video-flip readiness: F40 is NOT READY, and graphics regressed past its own floor

> **UPDATE 2026-08-23 — F40 now reads READY on BOTH teams, and it is important to
> know why.** Measured with the same script minutes apart, against the same live
> data, with only `index.html` differing:
>
> | | graphics unprovable | video unprovable | gate |
> | --- | ---: | ---: | --- |
> | before (`c223041b`) | 6 | 2 | ❌ |
> | after the Backlog ruling | **0** | **0** | ✅ |
>
> **All eight rows were Backlog.** `GRA-7109`, `GRA-4260`–`GRA-4264`, `VID-8373`,
> `VID-8439` — every one of them. The gate did not go green because those rows
> were repaired; it went green because the Workload page stopped loading them,
> so this gate stopped auditing them. That narrowing is legitimate on its own
> terms — a row the page never draws cannot lose a deadline there, and all eight
> have **no due date** — but it is a change of scope, not a repair, and anyone
> reading a green F40 on flip night deserves to know that.
>
> What genuinely closed in between: the three with real deadlines
> (`VID-13360`/`13362`/`13364`, due 2026-08-24) are Todo, still audited, and all
> three now read `workload_labels_complete = true`. Receipt: a
> `linear_incremental_batch_refresh` at **2026-08-23 19:55:59 UTC** — B1 re-read
> them and their `linear_raw` carries the GraphQL label relation the projection
> needs, instead of the bare webhook array. **That was the part of this item
> with a clock on it (repairable only before F1, because B1 refuses to write a
> team it does not own) and the clock has stopped.**
>
> The `graphics: 5` accepted floor is retired in the same change
> (`scripts/f40-workload-readiness.js`). Its stated basis was that those five have
> no due date so nothing disappears at F1; they are now outside the audited set
> entirely, so the allowance can no longer be spent on them — only on five
> FUTURE graphics failures, by count alone. The gate is green with no floor.
>
> The cost the 2026-08-11 ruling priced is now paid earlier than it priced it:
> "the only forfeited capability is ADDING a deadline to them from the Workload
> page" was a flip-day cost and is now a today cost, for all eight rows.

Measured 2026-08-22 by running `scripts/f40-workload-readiness.js` against both
teams. F40 is a surviving gate for the video flip (`FLIP_BUG_LEDGER.md` §0-8),
and an unprovable row loses its due date and its editability the moment the team
flips — silently, to the designer who owns it.

### video — NOT READY, 5 unprovable of 191 audited

| kind | rows | what they are |
| --- | --- | --- |
| label state incomplete | 3 | `VID-13360`, `VID-13362`, `VID-13364` — created 2026-08-17, status Todo, **all due 2026-08-24**. Live work with real deadlines. |
| missing from projection | 2 | `VID-8373`, `VID-8439` — created May 2025, Backlog, **no due date**, no card link, no native row. |

**The three with deadlines are repairable today, and only today.** Their
`linear_raw` is still in WEBHOOK shape: a webhook delivers `labels` as a bare
array, while B1's GraphQL read delivers the `{nodes, pageInfo}` relation the
label projection requires, so `workload_labels_complete` stays false until B1
re-reads the issue. B1's incremental cursor only re-reads issues that CHANGED,
and these three have not changed in Linear since 2026-08-18 — so no scheduled
run will ever reach them. They need one dispatch with an explicit
`changed_since` behind that date. After F1, B1 refuses to write video at all and
the repair becomes impossible.

**The two from May 2025 are the same shape as the graphics floor of 5**:
pre-cutoff, unlinked, never imported, and carrying no due date — so nothing
disappears at F1 and the only forfeited capability is ADDING a deadline from the
Workload page. That is exactly the trade the owner accepted on 2026-08-11 for
`GRA-4260`–`GRA-4264`. **Proposed: an accepted floor of 2 for video**, by the
same reasoning. Not applied — the graphics floor was an explicit owner ruling
and this one should be too.

### graphics — regressed to 6, above its accepted floor of 5

Graphics has already flipped, so these are live losses, not risks.

- `GRA-7101` was one of them and is now correctly excluded: it is status
  **Duplicate**, and Workload's active filter did not treat `duplicate` as
  terminal even though `_prodIsDone` lists it beside `completed` and `canceled`.
  A closed duplicate kept its assignee and its due date and consumed that
  designer's capacity. Fixed, with a test that executes the real filter; three
  mutations proven fatal.
- `GRA-7109` remains, and it is the structural one: created in Linear on
  2026-08-17, AFTER the graphics flip. `linear-inbound` is detect-only for a
  SyncView-authoritative team and B1 refuses to write one, so **an issue born in
  Linear after its team flips can never acquire a native row**. It is not
  repairable by any lane that exists. Related to item 19.

### what this says about the video flip

The graphics number was 4% of active issues without a native row because B1 had
imported that team thoroughly beforehand. Video sits at **670 of 1,414 active
issues with no native row** today. Most are outside what the Workload page loads
(608 off-roster, 408 parked in the audited window), so the gate's 191-row audit
is the honest instrument and it finds only 2 — but every one of those 670
becomes permanently unrepairable at F1, and any of them that later joins the
roster surfaces as a row nothing can fix. The pre-flip import matters far more
for video than it did for graphics.

### the create door: attempted, reverted, and it is an OWNER decision

Attempted here and **backed out in full**. The record is worth keeping because
the reasoning went wrong in an instructive way.

The idea was to derive the dialog's team list from live authority so Video drops
out the moment Video becomes SyncView-authoritative, closing the orphan door with
no flip-day edit. Review found the first version leaked: `_prodSubmitCreate`
reads `draft.team` directly and `_prodCreateDefaults` falls back to
`team: 'video'` for **every** loose draft, so the picker would have read "No
options" while the draft stayed submittable. Correct finding.

Gating the submit path fixed that leak — and broke something bigger. With the
gate in, parent-mode creation becomes unreachable in **every** authority
configuration: a loose graphics context resolves to Video by design, so if Video
is refused there is no open door left at all, before or after the flip.
`prod-write-gateway-browser.js` proves it: it *simulates* the video flip
specifically so the modal's whole choreography — catalog, controls, conflict,
recovery, assignee projection — can be exercised at all, and it asserts a
graphics-context create opens as a Video draft. The gate turned ~15 assertions
of coverage into one `response_timeout`.

That is not a test getting in the way of a fix. It is the test stating the
current contract, and `FLIP_BUG_LEDGER.md` §0-7 already names the choice as open
— *"Close the door or re-scope it"*. Closing it entirely means the Production
create dialog does parent-mode creation never again, only pinned sub-issues.
That is a real product decision with a real cost, and making it silently inside a
pull request about other things was the wrong call. Reverted.

- What is now known and was not before: the dialog's parent-mode creation is
  **only ever reachable after a flip** — today Video is refused by the authority
  gate and Graphics is not offered — so §0-7's decision is not cosmetic. Whatever
  is chosen, choosing nothing means the door opens by itself on flip day.
- ~~Owner decision: close the door (parent-mode creation ends; sub-issues stay),
  or re-scope it~~ **DECIDED 2026-08-23 — close BOTH, and the framing above was
  wrong.**

  The owner corrected the premise: *"the add sub-issue mode isn't fine because a
  sub-issue is a card, not a parent issue ... we shouldn't be able to do parent
  issues or sub-issues because we don't want to do posts in sync linear that are
  not in the calendar."* Checked, and he is right — `production-write`'s create
  insert hardcodes `card_id: null` for BOTH modes. A sub-issue created under a
  parent that HAS a card comes out just as cardless as a top-level one. Every
  version of this item until now framed sub-issue mode as the safe half; it never
  was, and it was the only half still reachable.

  **The cost, measured rather than argued.** A Production-tab create leaves a
  signature nothing else produces: the deliverable carries `origin='manual'` and
  its outbox intent carries `legacy_parity=false`. Live count of rows matching
  both: **53, every one `test_only`. ZERO for a real client, in the app's whole
  history.** The discriminator is not vacuous — those 53 prove it matches, and
  the 82 non-test `legacy_parity=false` creates are `origin='calendar'` (55) and
  `origin='samples'` (12), i.e. graphics work where parity is simply off. So the
  door being closed is one nobody has ever walked through.

  **What the closure actually had to cover — five gates, not one.**
  `_prodCreateGateText` has four callers, and `_prodCreateTopbarButton` carries a
  fifth, hand-copied inline re-implementation of the same check. On the unscoped
  board and on a Graphics project page that copy evaluated to "allowed", so the
  New issue button rendered LIVE and clickable — not disabled, as every prior
  write-up here assumed. Closing only the real gate would have left the visible
  button working.

  **What is deliberately NOT closed:** `_prodCreateRecoveryGateText`. A draft
  marked `ambiguous` means its create may already have committed, and the retry
  is the only path that ever hands that row back to its author. The server
  refusal is placed AFTER `productionCreateReplay` for the same reason. Refusing
  earlier would strand a committed, cardless row with no owner — manufacturing
  the exact orphan this closure exists to prevent.

  **Still open, and bigger than this ever was:** the cardless-deliverable problem
  is arriving at roughly 39/week through a different door entirely — B1 importing
  issues people create directly in Linear. Closing this dialog does not touch
  that, and should not be read as having done so.

### a source-scanning test helper that could fail — and pass — for the wrong reason

Found while fixing the above: `extract()` in `test/production-write-ui-source.js`
slices a function out of `index.html` by balancing braces, and it tracked quotes
but not comments. One apostrophe in a `//` line inside an extracted function —
"the dialog's own subtitle" — opened a string that never closed, brace tracking
ran off the end, and `extract` returned **1,032,919 characters**: the rest of the
file, silently, instead of the function.

That is worse than a crash, because it is directional. A negative assertion
(*this function must not mention X*) then scans the whole file and goes red for
the wrong reason — which is exactly how it surfaced. A positive one (*this
function must contain Y*) goes GREEN for the wrong reason, and nothing says so.
Every assertion built on that helper inherits it.

The helper now skips line and block comments, and refuses any extraction larger
than a quarter of the file rather than returning it. Removing the line-comment
branch turns the suite red, which is the proof it is load-bearing; the
block-comment branch is symmetric and currently unexercised, and the comment
above it says so instead of implying otherwise.

### also fixed here

The gate's own repair instruction was impossible. It said "run the B1 refresh
over a full window", and `mode=full` refuses to apply unless BOTH teams are
Linear-authoritative — untrue since 2026-08-16. It now names the incremental
lane with an explicit `changed_since`, which is the path that actually applies.

The gate also hard-coded the terminal status types while reading the parked list
and the client names from `index.html`, so the one filter nobody was reading
drifted: the app learned `duplicate` was terminal and the gate went on counting
it. Both lists are now read from the app.

### the durable fix, which is bigger than these three rows

Repairing the three by dispatch fixes the rows, not the class. The class is
this: `production_workload_label_projection` calls a row complete only when
`linear_raw.issue.labels` is a `{nodes, pageInfo}` RELATION — the shape B1's
GraphQL query returns. A Linear WEBHOOK delivers `labels` as a bare array
alongside `labelIds`, and that array is the issue's complete label set at that
moment; Linear does not send a partial one. So a row whose last writer was the
webhook is called incomplete for a reason that is not true, and stays that way
until B1 happens to re-read it — which the incremental cursor guarantees will
never happen for an issue that stops changing.

Accepting the webhook shape when `labelIds` agrees with it would close the class
for every future row rather than the four that happen to be visible today. It is
a database function, so it needs a migration, and it is not a change to make
without the owner asking for it. Recorded rather than done.

- Done when: video's three deadline-carrying rows are repaired by a dispatch,
  the owner has ruled on a video floor of 2, `GRA-7109` has a disposition, and
  there is a decision on whether the projection should accept the webhook shape.

---

## 32. [closed] The visible-boot lane dies on its own History traversal under load

Found 2026-08-22 when CI went red on PR #1119 at
`runPendingSamplesBfcacheScenario`:

```
page.evaluate: Execution context was destroyed, most likely because of a navigation.
    at restoreFromBfcache (qa/boot/client-entry-sequence.js:1343)
```

**Not a product failure — the harness losing a race with the navigation it
asked for.** `restoreFromBfcache` did `await page.evaluate(() => history.back())`.
The traversal can complete, and tear down the execution context the call was
issued in, BEFORE Playwright's protocol response for that evaluate comes back.
Playwright then reports the navigation SUCCEEDING as a thrown error.

**Reproduced, rather than argued.** On an idle machine it does not happen: five
sequential runs, all green. Running the lane **three-at-a-time on four cores** —
which is what a loaded CI runner looks like — **one run in three died with the
identical error at the identical line**, in a DIFFERENT scenario
(`runStaffCalendarOwnedTailAndBfcacheScenario`). That difference is the tell: it
lands on whichever BFCache scenario loses the race, which is exactly why the
2026-08-20 red on this lane was a different scenario again. Ten call sites share
that one helper.

**The fix** routes all three traversal sites through `traverseHistory`, which
swallows exactly one error string — `Execution context was destroyed` — and
rethrows everything else.

It cannot mask a regression, and that is proven rather than asserted: every
caller still follows with a `waitForFunction` on the live location. Mutating the
helper so the traversal never happens leaves the suite **red on
`page.waitForFunction: Timeout 15000ms exceeded`**, so a traversal that genuinely
did not occur still fails on its own assertion.

- Worth knowing: this lane is deliberately "one attempt per navigation", which is
  correct for catching real boot regressions and is also why a plumbing race
  surfaces as a hard red instead of a retry. The fix removes the race rather than
  adding a retry, so that property is preserved.

**Verified, and NOT the whole story — correcting an overclaim in this entry.**
This first read "closed / re-verified", written before the verification finished.
The real numbers, same 3-way contention: **nine runs, zero occurrences of
`Execution context was destroyed`** — against one in three before, so the failure
CI actually hit is gone. But **one of those nine still failed**, on a different
thing entirely:

```
runPendingCalendarOwnershipScenario (client-entry-sequence.js:2847)
  <div id="staffIdentityOverlay" …> intercepts pointer events
```

A click racing an overlay that has not finished closing. Distinct cause, distinct
scenario, not addressed here and not diagnosed. It surfaced only under
three-at-a-time contention on four cores, which is HEAVIER than CI (one job per
runner), so there is no evidence yet that CI hits it — and fixing it blind is the
mistake this register keeps recording. Left as a known load-sensitive fragility
with its reproduction recipe rather than patched on a hypothesis.

- Done when: the traversal race is closed (**done**), and the overlay-intercept
  fragility is either reproduced deliberately and fixed, or ruled not worth it.

---

## 33. [owner] 147 of the 176 "attribution conflict" banners were a regex; the other 29 are real

Found 2026-08-23 from an owner screenshot: a sub-issue showing **"Client
attribution conflict. This issue family is read-only and queued for repair
(hierarchy conflict propagated)."** The first thing that measurement turned up is
that **not one row in the entire database carries a `conflict` state** — the
reconciler only ever persists `resolved` (`scripts/linear-deliverables-reconcile.js`).
The banner is not read from anywhere. It is recomputed in the browser on every
load by `_prodResolveAttributions`, which rebuilds the whole parent graph and
then runs a fixpoint that poisons an ENTIRE family if any one member conflicts.
That is why a single bad row costs ten good ones.

### The 147 — a sanitiser that disagreed with the roster it was sanitising

`production_deliverables_browser_v1` gates `raw_attribution_client_slug` behind a
hand-written character class and returns NULL when a value fails it. **Exactly
one of the 38 active roster slugs fails it**, on a single character. Its 147
deliverables therefore arrived in the browser with
`raw_attribution_state = 'resolved'` and no slug — while the very same view
passed the unfiltered `client_slug` through two dozen columns earlier.

The browser then read that ABSENCE as CONTRADICTION: no persisted slug ≠ the slug
today's mapping produces, so
`persisted_resolved_client_disagrees_with_current_mapping`, so
`hierarchy_conflict_propagated` across the family. 147 rows read-only,
mis-grouped, behind a banner describing nothing real.

**Fixed in two halves, and the halves are independent.**

- **Browser (merged 2026-08-23).** An absent persisted slug is missing evidence,
  not contradicting evidence: fall through to the freshly computed mapping and
  say `persisted_client_slug_unavailable_in_read_path`. Four mutations proven
  fatal by exit code in `test/attribution-absent-slug-not-conflict.js`, including
  one that widens the guard until a REAL disagreement stops raising a conflict.
  **This alone removes all 147 banners.** It also means the next time somebody
  tightens a projection column the UI fails soft instead of inventing a conflict.
- **Database — APPLIED 2026-08-23** by the owner, pinned to `8887d2a0`.
  `migrations/2026-08-23-attribution-slug-guard-widening.sql`, window at
  `docs/ops/ATTRIBUTION_SLUG_GUARD_WINDOW.md`, receipt in `EXECUTION_LOG.md`.
  Proved before applying with zero permanent change by instantiating the new body
  as a TEMPORARY view and comparing it in-query against the live one: 5,316 rows
  and 46 columns both sides, resolved-with-no-slug **147 → 0**, symmetric
  difference 294 rows = the same 147 counted once per direction. The transaction
  ended with an assertion that would have failed the whole migration if any active
  roster slug still failed the widened guard; it read 0 offending and committed.
  Post-apply readback matched the prediction exactly, and the inverse test
  confirms 147 rows now carry a slug the old guard rejected.

### The other 29 — real, and a data decision the owner has to make

These are genuine and the banner on them is TRUE. Three families, each a parent
in one active client's Linear project with sub-issues sitting in a DIFFERENT
active client's project:

| family parent | conflicting sub-issues | shape |
|---|---|---|
| `VID-13276` | `VID-13284`, `VID-13285`, `VID-13286` | parent in client A's project, children in client B's |
| `VID-13025` | `VID-13028`–`VID-13031` | parent attributed to client A, children in client C's project |
| `GRA-7034` | `GRA-7042`, `GRA-7043`, `GRA-7044` | children stored `unattributed` on client B's project under a client-A parent |

Plus one stale invalidation (a single graphics row carrying
`project_or_parent_changed_reconcile_required` that nothing re-derives, because
graphics is SyncView-authoritative — item 27's door). It should read as a repair,
not a conflict.

**OWNER RULING 2026-08-23: they are three genuinely different clients** — three
separate brands belonging to the same person, each with its own roster row and
its own Linear project. So a roster merge is OFF the table, and every one of
these is a filing error in Linear: a family whose parent sits under one brand
and whose children sit under another.

Re-measured under that ruling, and the three families are NOT the same shape.
They need OPPOSITE fixes, so they are set out separately:

| family | parent's project belongs to | children's project belongs to | which end looks wrong |
| --- | --- | --- | --- |
| 1 (video, 10 Aug) | brand A | brand B | the children |
| 3 (graphics, 10 Aug) | brand A | brand B, and stored `unattributed` | the children |
| 2 (video, 20 July) | brand A | brand C | **the parent** |

**Families 1 and 3 are one batch, not two.** Same date, same three child titles,
one video parent and one graphics parent. All SIX children were filed into brand
B while both parents stayed on brand A. Whatever is decided, it should be decided
for the batch, not per team.

**Family 2 points the other way, and this is the one worth reading twice.** Its
parent's own title names the work as PAID ADS, and its four children sit in the
paid-ads brand's project — which is where paid-ads work belongs. So here the
children look correctly filed and the PARENT is the one under the wrong brand.
Repairing this by moving the children — the obvious reading of "the children are
in the wrong place" — would file paid-ads work under the personal brand and make
it worse.

### 2026-08-24 — the families were never the defect. The rule was.

**OWNER RULING: a mixed family is legitimate, and the code now agrees.** The
owner, looking at the batch in Linear: *"the parent issue has different
sub-issues from different things ... some of them are for his social media and
some of them are for his dj stuff ... I guess what the parent issue does, like
the project of the parent issue doesn't really matter."*

He is right, and the code had already half-decided it. `linear-inbound` settled
the same question on 2026-08-23 with `own_project_outranks_parent`: an issue's
own project outranks its parent's. The BROWSER resolver never got that rule, so
two components answered one question in opposite ways, and the one that
disagreed with the owner was the one shipping.

**What the old rule cost, measured against live data before the change.** A
family of 11 was entirely `conflict` — and writes are gated on attribution being
`resolved`, so nothing in it could be advanced from SyncView at all. Seven of
those were sitting at **For Client Approval**, one was **Todo, two days
overdue**, one was **Tweak Needed, due the next day**. Not one was finished.
Every child in that family carried its own project and mapped cleanly to a
brand; the resolver had certain information and threw it away to manufacture a
conflict out of the container.

**The fix.** A row is SELF-ATTRIBUTED when its resolution came from its own
project or from an explicit owner classification — neither of which was
inherited. `nearest_mapped_ancestor` reads a parent and `unanimous_child_family`
reads children, so those two genuinely depend on the family agreeing; the other
two do not. A self-attributed row is neither conflicted by a disagreeing
relative nor poisoned by the propagation fixpoint.

**Blast radius, executed over every row in the projection (5,316):**

| | before | after |
| --- | ---: | ---: |
| `conflict` | 29 | **4** |
| `resolved` | 5,128 | 5,153 |
| rows made WORSE | — | **0** |
| rows now naming a DIFFERENT client | — | **0** |

All 25 freed rows moved `conflict -> resolved` and none changed which client it
names. The 4 that remain are a different class entirely — a stale
`needs_attribution` stamp that nothing re-derives (item 27's one-way door) — and
three of them are family 3's graphics children, which is precisely the split
predicted above: the video half of that batch heals, the graphics half does not.

**What the lost conflict was protecting: nothing.** If a child really is filed in
the wrong project it is mis-attributed either way, and consulting its parent
cannot fix that. All the rule added was ten more unusable rows beside it.

Six mutations run against the guard, five fatal by exit code; the sixth was
proven an EQUIVALENT mutant by executing both variants over all 5,316 live rows
and getting a zero-row difference, rather than by argument. An earlier version of
that guard passed for the wrong reason — its "inherited child" case conflicted in
the persisted branch, before the family loop ever ran, and three mutations
survived it. The replacement drives the propagation loop directly.

**A second trap, specific to family 3.** Its three children are on GRAPHICS, which
is SyncView-authoritative, and they are already stored `unattributed` /
`needs_attribution`. A Linear move on a graphics issue is recorded as a foreign
write and deliberately NOT applied, and nothing re-derives the invalidation
(item 27's one-way door). So the two 10-Aug families cannot be repaired the same
way even though they are one batch: the video half heals through Linear, the
graphics half needs a SyncView-side repair or a reconciler re-derivation.

**One trap, measured.** Moving the sub-issues in Linear does NOT clear the banner
by itself on a Linear-authoritative team. A moved issue is stamped
`needs_attribution` with its slug cleared (item 27's mechanism), so the origin
just moves from `persisted_resolved_client_disagrees_with_current_mapping` to
`persisted_attribution_disagrees_with_current_mapping` — which is exactly the
state the `GRA-7034` family is already stuck in. The move only works if a
reconciler re-derivation then persists the new resolution. Detaching the
sub-issues, or merging the roster rows, does not have this problem.

- ~~the slug-guard migration is applied~~ **done 2026-08-23.**
- ~~the owner rules on A/B/C~~ **done 2026-08-23 — three separate brands.**
- Done when: the three families are repaired in Linear, remembering that family 2
  needs its PARENT moved and not its children, and that family 3's graphics
  children will not heal from a Linear move. That is all that is left of this
  item; the 147 are closed on both halves.

## 34. [owner] The client Submit link has been a dead end for every client since wave 3

**The Submit tab's public entry — `?intake=1`, the link clients and
videographers use to send footage — cannot complete a submission for ANY
client, and has not been able to since 2026-08-14.** Diagnosed 2026-08-24 from
the owner's report ("it asks for credentials, but it should be accessible to
anyone"). Nothing is lost or corrupted; the submission simply cannot be made.

**The mechanism is three correct pieces meeting badly.**

1. Submit picks its transport per client: a client in `write_ui_reroute_clients`
   goes through the native gateway, anyone else through the legacy n8n lane
   (`index.html` `_submitLinearFormRoutedOnce`). The legacy lane asks for no
   credentials at all.
2. The native lane requires staff sign-in — `_syncviewRequireStaffIdentity('intake')`
   — and the capability matrix admits only `admin` or `smm`.
3. `_syncviewStaffEligible()` returns FALSE in intake mode
   (`!_isClientLink && !_isIntake && !_isOnboarding`), which is correct on its
   face: a client link must never show a staff sign-in dialog. So
   `_syncviewOpenStaffIdentity` returns immediately, the require throws, and the
   submit handler prints `Staff sign-in required.` with **no dialog and no way
   forward**.

Each piece is defensible alone. Together they mean: *enrolled client + intake
link = a message the visitor cannot act on.*

**Why it started on 2026-08-14 and not at the flip.** The gate is keyed on
enrollment, not authority. Before wave 3 most clients were not enrolled, so the
intake link quietly used the legacy lane and worked. **Wave 3 enrolled the FULL
roster** (`PRE_FLIP_HEALTH_CHECK.md` item 5) — verified live 2026-08-24: the
reroute flag holds all 38 slugs and equals the three `*_ef_clients` rosters. From
that moment every client took the gated branch. The enrollment was correct and
announced; this consequence was not noticed because **a staff-signed-in test
passes**. `docs/features/CLIENT_FOOTAGE_SUBMISSION.md` already warns about
exactly this: *"A staff-signed-in test proves nothing on this surface — that is
precisely why the regression shipped."* It was right, and it happened again.

**Removing the browser gate is NOT sufficient**, and this is the trap to avoid:
`production-write` independently rejects the caller at
`handleIntakeCreate` — a client-token principal or a non-admin/smm staff key
gets `403 operation_forbidden`, and no principal at all gets
`401 credentials_required`. Deleting the browser check just moves the dead end
from a readable message to a failed request, and the saved job then pins that
client to the native lane so retries can never fall back. Both halves have to
be decided together.

**Two adjacent facts the owner should know before choosing.**

- *The client picker shows every client.* The intake page loads the full active
  client list and reveals the first eight on focus, so anyone holding the link
  can read and search the whole client roster. This is pre-existing, not caused
  by the gate — but any decision that promotes this surface as public should
  settle it, and a per-client link removes the picker entirely.
- *Attribution is caller-chosen and unverified.* The submitter selects which
  client the work belongs to, and on the legacy lane nothing binds them to it.
  There is no rate or volume limit on either lane.

**The shape that already exists in this codebase** is the client review link:
`client-review-link` mints a scoped `review_token`, `client-token-verify`
validates it on entry, the browser sends `X-Syncview-Client-Token`, and
`production-write` turns it into a `kind: "client"` principal bound to exactly
one client slug. Widening that principal to `intake_create` **for its own slug
only** would fix the dead end, bind attribution server-side, and close the
roster exposure in one move — without inventing a new auth concept.

- ~~OWNER DECISION NEEDED~~ **DECIDED 2026-08-24: one open link for anyone,
  with server-side limits.** The owner chose the open endpoint over per-client
  scoped tokens, accepting that the client a submission names is caller-asserted
  — which is exactly how the legacy n8n lane it replaces already behaved.
  **BUILT the same day, and inert until switched on.** Both halves changed
  together, because either alone leaves the dead end in place:
  - *Server.* `production-write` admits a credential-less caller for
    `intake_create` on the `submission` surface only. The principal is minted at
    that call site rather than inside `authenticate()`, which is what keeps every
    other handler closed, and a caller who DID present a credential is judged on
    it and can never fall through and gain what it lacked. Bounded by a
    default-OFF flag (`public_intake_enabled`, fail-closed on missing/unreadable/
    malformed), a lower item cap (25 vs 100), and a per-client plus overall rate
    limit counted from the service-role-only `public_intake_log` — a durable
    ledger rather than process memory, because edge instances do not share state
    and an in-process counter would reset under exactly the load it exists to
    stop. Accepted rows are stamped `created_by = 'public-intake'`.
  - *Browser.* The client link no longer demands a staff identity, and the
    resume-time actor binding steps aside there too — on that link it could only
    ever throw, never pass. Both checks read the mode flag defensively so an
    uninitialised value resolves to the STRICT staff path. The staff tab is
    unchanged and still authenticates exactly as before.
  - *Proof.* `test/public-intake-open-submission.js` holds the boundary rather
    than the happy path; eleven mutants — dropping the surface restriction,
    widening the fall-through to any 401, accepting a truthy flag, opening on an
    unreadable flag or ledger, removing either ceiling, raising the cap,
    stamping the rows as staff, removing the role check, and both browser
    guards — each turn it red.
- **Still owed before it does anything:** apply
  `migrations/2026-08-24-public-intake-log.sql`, deploy `production-write` (one
  of the four F27 Section 4 functions, so an owner-window deploy), then flip
  `public_intake_enabled` on — `docs/ops/PUBLIC_SUBMIT_LINK.md` carries both statements and
  the readback. Turning the flag on before the deploy is harmless: the older
  function simply refuses as it does today.
- **Not addressed, and deliberately so:** the client picker still lists every
  active client to anyone holding the link. A per-client token would have
  removed it; the open link cannot, so it stays a known exposure rather than a
  silent one.
- This is also the standing unanswered question in
  `docs/features/CLIENT_FOOTAGE_SUBMISSION.md` §Open questions and in
  `CUTOVER_AUDIT_2026-07-13.md` ("who may mint an intake link, for which client,
  for how long, and how is it revoked") — answering it here answers it there.
- Done when: a client who is NOT staff, on a fresh profile with no staff
  identity stored, can complete a submission for an enrolled client end to end —
  and a probe proves it in that exact configuration, because no staff-signed-in
  test can.

## 35. [owner] New work can still be born "In Progress" — the 2026-08-17 fix is client-side only

**An editor reported on 2026-08-24 that SyncView showed him working on 15 videos
he had never touched.** He was right, exactly as the editor who reported the
same thing on 2026-08-17 was right. Diagnosed the same day; nothing is lost or
mis-assigned, but the Workload page overstated one editor by 17 units.

**What happened.** 15 videos + 15 thumbnails were submitted for one client at
14:34Z from the Submit tab. All 30 rows were created already `in_progress`, in
SyncView and in Linear both — the Linear issues' state history shows them born
into "In Progress", never Todo. The editor and designer named on them were
chosen by the submission, which is normal; only the status is wrong.

*Corrected after the owner supplied context the telemetry cannot carry: the
submitter was a VIDEOGRAPHER using an SMM's role key, not the SMM. The event
records the key's roster identity, so `actor` names the SMM either way. That
matters twice. It explains how someone who looks like a first-time submitter
had pre-#1073 code — he had opened SyncView earlier, hit the credential wall
item 34 fixes, and returned to the same tab once he was given a key. And it is
why the first pass of this entry reasoned from "same person, same session" and
had to be redone: never infer one browser from one `actor`.*

**Why, and the evidence it is a STALE BROWSER rather than a live defect:**

- PR #1073 (2026-08-17, "New work starts in To Do, not already In Progress")
  replaced `'in_progress'` at exactly four call sites — the create dialog, its
  restored-draft fallback, and **both intake item builders** — with the single
  constant `PROD_CREATED_STATUS = 'todo'`.
- The **calendar** create path was never one of the four; it already sent `todo`.
- **The comparison that settles it** is between the only two real (non-drill)
  submissions since the fix: 2026-08-21 produced **32 `todo`**, 2026-08-24
  produced **30 `in_progress`**. Same deployed file, three days apart, opposite
  results — so the difference lies in what each BROWSER had loaded, which is
  the definition of a stale client. *(An earlier draft argued instead from one
  person's calendar-vs-submission split within a single session. That reasoning
  died with the correction above: those were two different people sharing one
  key, so it was never one session. The conclusion survived; the argument for
  it did not, and only the second one is load-bearing.)*
- The deployed site is not the problem: `syncview.synchrosocial.com` serves
  `PROD_CREATED_STATUS = 'todo'`, byte-identical to `main`.
- Every other author since the fix creates `todo` (85 / 27 / 18 / 18 / 14
  across five people). The only `in_progress` creates are this one batch and
  the TEST write drill, which creates started work on purpose.

**The durable defect this exposes.** #1073 fixed four CLIENT call sites and
nothing server-side, so the invariant "work that was just created has not been
started yet" is enforced only by the browser. Any stale tab re-creates the
original bug in full — and this app is a single 4.6 MB `index.html` that people
leave open for days, so stale tabs are not an edge case, they are the norm.

Two server gaps, both in `production-write`:

1. **Nothing rejects a create that arrives already started.** `intake_create`
   accepts whatever status the caller sends, so an old client still creates
   started work. This is what actually happened here.
2. **The gateway's own default is still `in_progress`** —
   `lower(item.status || "in_progress")` at two call sites. #1073's comment
   states this plainly: *"production-write still falls back to 'in_progress'
   when a caller omits status entirely… it is corrected in the gateway on the
   next deploy rather than mid-flight during this one."* **That correction was
   never made** — deploy #21 (2026-08-24) shipped without it, a week later.

- ~~OWNER DECISION: refuse vs normalise.~~ **DECIDED AND BUILT 2026-08-24:
  NORMALISE, and count it.** A submission is often someone's whole shoot, so
  refusing it mid-flight to punish a stale tab costs a person real work to fix
  something they cannot see. `production-write` now corrects a started status at
  create to `todo` and reports `started_at_create_normalized` in both intake
  responses, so a stale client stays visible rather than silently accommodated.
  The gateway's own `|| "in_progress"` default is retired at both call sites.
  The TEST drill keeps its deliberate started state, gated on the authenticated
  principal rather than any caller-supplied field. Six mutants killed
  (`test/intake-created-status-server-guard.js`). **Ships with the pending
  `production-write` deploy** — the candidate is re-pinned in the same commit as
  the source, which is the rule the previous release wrote down and the one
  before this broke.
- ~~**AND THE GENERAL PROBLEM IS ADDRESSED: the tab now notices.** Owner
  decision the same day — tell them and reload only when clearly safe, no hard
  block. The app compares the deployed file's ETag against the one it booted
  with (HEAD, `no-store`, every 10 minutes and on every return to the
  foreground). On a change it reloads itself **only** when nothing can be lost,
  and otherwise shows a one-time bar with a Reload button. Eleven mutants
  killed (`test/stale-build-watch.js`)…~~
  **STRUCK 2026-08-24 — THIS DESCRIBES CODE THAT WAS REVERTED AND NEVER
  SHIPPED.** Every claim in it is false against the tree: `test/stale-build-watch.js`
  does not exist, and `index.html` contains exactly one `location.reload`, inside
  the nudge bar's button click handler. Nothing reloads itself, ever.
  What happened: this bullet was written while the stale-build watch was in
  #1128, and the watch was then reverted **in full** during that same PR's
  review — it duplicated `appUpdateNudge`, which had shipped in July and does
  the same ETag poll — but the bullet describing it survived the revert. Left
  struck rather than deleted, because a register that silently loses a claim
  teaches nobody; this one asserted a live safety mitigation that did not exist,
  which is the worst kind of stale entry to remove without a trace.
  *For what IS live, see the 2026-08-24 subsection below.*
- **The repair is split by authority and cannot be done in one place.** The 15
  VIDEO rows must be set to Todo *in Linear*, because video is still
  Linear-authoritative and SyncView follows it — a native-side change would be
  overwritten on the next mirror-in. The 15 GRAPHICS rows must be set in
  SyncView, because graphics is SyncView-authoritative and a Linear change
  there is recorded as a foreign write and ignored — and worse, the outbound
  mirror would then push the stale `in_progress` back over it. Doing either one
  in the wrong system silently does nothing, which is the trap worth naming.
- **VIDEO HALF REPAIRED 2026-08-24.** All 15 set to Todo in Linear and verified
  mirrored into SyncView within seconds (15/15 `todo`). That was the half
  inflating the editor's Workload board by 15 units, and the report that opened
  this entry.
- **GRAPHICS HALF OUTSTANDING** — 15 thumbnails on one designer's board. It has
  to go through the app rather than SQL: the gateway write is what enqueues the
  outbound intent that also corrects Linear, whereas a raw UPDATE would leave
  Linear saying In Progress with nothing scheduled to fix it.
- Also worth telling the person who submitted: hard-refresh (Ctrl/Cmd+Shift+R).
  Until then every submission they make is born started.
- Done when: the server enforces the invariant per the owner's choice, the
  gateway's `in_progress` default is retired, and a test proves a create
  arriving as `in_progress` cannot produce a started row. **DONE — #1128.**

### 2026-08-24 — the nudge that was supposed to prevent this was switched off where it mattered

SyncView already ships a stale-tab feature: `appUpdateNudge`, which polls the
deployed file's ETag and offers a Reload banner. Its second line was
`if (?prod=1) return;` — added in #779 (July 2026), when the Production tab was
an in-development preview.

**So the entire Production tab has had no stale-tab warning at all**, and at F1
it becomes the whole video team's daily surface: the place where a week-old tab
does the most damage, and the only one that never says a word about it.

The guard was also aimed at the wrong set. `test/app-update-nudge.js` justified
it as keeping "zero non-GET boot requests", but `isWriteLikeRequest` in
`prod-test-utils.js` explicitly exempts `HEAD`, which is the only request the
nudge ever makes. What it really bought was determinism in the browser suites —
and those serve over `http://127.0.0.1`, so it silenced every REAL `?prod=1`
user while leaving the nudge running in the harnesses that load the page
*without* the flag.

**Replaced with a loopback-host test**, which covers strictly more: every
harness serves from `127.0.0.1` or `localhost`, so all of them stay silent, and
it matches what the guard above it already says — this is only meaningful when
served from the deploy host. Shipped 2026-08-24.

**RESOLVED 2026-08-24 — the owner reversed the never-force-reload rule, knowing
the nudge was already there.** Asked directly, the ruling was: *"a tab should
reload itself when a new version is shipped, if it's in the background. But if
someone is in the tab, then they should just propose to reload it."*

Built to that, and to the narrow shape this entry had already argued for:

- A **visible** tab is only ever offered the banner. Nothing changed for anyone
  who is actually looking at the page.
- A **hidden** tab reloads itself — but only when a reload would cost nothing.
  `wouldLoseWork()` refuses if any rendered field has moved off its default, if
  any contenteditable holds text, or if anything is open on top of the page. A
  refusal falls back to the banner, which is waiting when the reader returns.
- One self-reload per tab per half hour, stamped in `sessionStorage` **before**
  `location.reload()` so the stamp survives the reload it caused. A host with an
  unstable ETag therefore reloads a tab once, not forever. No storage means no
  self-reload at all — failing to the banner costs a click, failing the other
  way costs a loop.
- The background poll had to be turned on for any of this to fire; the old
  `if (document.hidden) return;` at the top of `check()` is gone. Loopback hosts
  still return early, so every local harness stays silent.

The dirty check errs toward "dirty" on purpose, and has one known false
positive worth naming: Workload sets its client-search input through `.value`,
so a **filtered** Workload tab reads as dirty and gets the banner instead of a
silent reload — keeping its filter. An unfiltered one reloads normally.

**The first version of this check was wrong, and review caught it.** Every
SyncView control that carries a value is invisible by construction: `sv-select`
keeps its value in a `type="hidden"` input, `sv-date` in a 1px `opacity: 0`
one. Worse, a hidden input uses HTML's *"default" value mode* — assigning
`.value` writes the content attribute too, so `defaultValue` moves with it and
**can never disagree**. A Time Off request is a select, two dates and a tick and
nothing else, and it lives on a panel rather than in a dialog. The check called
that form clean. A reader who filled it in, tabbed away, and happened to be
holding a tab when a deploy landed would have come back to an empty form with
no explanation — the precise failure the condition exists to prevent.

Fixed in two halves, because neither alone is enough:

- **Value comparison, judged from the container.** Field visibility now walks
  up from `parentElement`, so a control that is invisible by design is still
  checked as long as its wrapper is on screen. Checkboxes and radios compare
  `checked` against `defaultChecked` — "PTO enabled" is a checkbox and nothing
  else.
- **An interaction marker**, for the case value comparison provably cannot see.
  One capture-phase listener on `input` and `change` stamps
  `data-sv-unsaved-edit` on whatever the reader touched; `_svSelectPick`, the
  stepper and the date picker all dispatch bubbling events, so every branded
  control is covered without any of them opting in. The marker lives **on the
  element**, so a re-render — which is what a successful save does — replaces
  the node and clears it. There is no flag to reset and no way for one to leak.

Verified against the real page, not just the stub: a headless load of the staff
Calendar, Production and Workload surfaces all read **clean** (so the feature
still fires), while a changed hidden input, a changed `opacity: 0` date input
and a ticked checkbox all read **dirty**.

Pinned by `test/app-update-nudge.js` (wiring) and the new
`test/app-update-self-reload-behavior.js`, which lifts `wouldLoseWork` out of
the shipped file and actually runs it against a stub DOM — this session already
produced the lesson that a source-scanning check can pass for the wrong reason,
and this is not a condition to leave to pattern matching.

---

## 36. [closed] "Open SyncView →" landed on the list and never opened the item

**Owner report 2026-08-24, opening a Workload rollup and following its "Open
SyncView" link: *"it just goes to the old team's issues, but it doesn't open
it."*** Fixed the same day; the link was never wrong.

**What was actually happening.** `mountProductionView` paints from the
localStorage snapshot first (stale-while-revalidate) and reads live afterwards.
The guard that drops an unresolvable deep-link target ran on **both** paints. On
the cached one it cleared `openId` — so any target created since the reader last
opened Production was discarded *before* the live read arrived, and the live read
then found `openId` already empty and had nothing left to open.

That is exactly what the report describes, phrase by phrase: the reader is left
looking at the **cached** list (old data, which is the "old team's issues") and
the item never opens. Nothing distinguishes it from a broken app, which is why
it could only be reported as "it doesn't open it".

- The cached paint now only chooses a view and keeps the request **pending**;
  the first authoritative read re-applies it against live data.
- It is consumed exactly once and never re-applied over a reader who navigated
  in the meantime, so a background refresh cannot yank anyone out of what they
  opened. A cold load with no cache at all takes the same path.
- When live data genuinely does not hold the target, the reader is now **told
  which identifier is missing** instead of being dropped on a list with no
  explanation. The silent fallback is the reason this went unreported for as
  long as it did — every symptom of it looks like the app failing.

**A second, independent cause of the same symptom, fixed alongside it.**
`linear_parent_ids` is a per-team map because one batch legitimately parents two
different Linear issues: a video parent and a graphics parent. The synthetic
parent resolver keyed its node map by **batch id**, so the second team overwrote
the first. One synthetic row survived, children of both teams hung under it, and
a deep link by the losing team's identifier resolved to nothing — arriving at the
same silent list from the other direction. Keyed by parent uuid now; a
single-parent batch keeps the bare batch id so no existing row id, cached
snapshot, or `?d=` URL changes meaning.

*The existing coverage only exercised the MIRRORED shape (both slots holding the
same uuid), where the dedupe hides the collapse. That is why a resolver with
behavioural tests still shipped this: the correctly-filled shape — item 16's
eight batches — was the one case never written down.*

- Pinned by `test/production-deep-link-survives-cache.js` (six paths: cached
  miss with a live hit, consumed-once, overtaken-by-navigation, genuinely
  absent, cold-load absent, and the batch/project variants) and by the new
  two-team case in `test/production-parent-link-hierarchy.js`.

## 37. [owner] A Linear rename forks the batch, and the fork hides the sub-issues

**Owner report 2026-08-23, from Workload: a family of 15 thumbnails opened as
15 top-level cards, each offering "Add sub-issue" on something that already is
one.** The same failure the owner had been describing since the tutorial
recording, but this time with a reproducible family attached.

**Root cause: the batch's primary key is a hash of editable text.**
`batchGroupKey` (`scripts/b1-linear-backfill.js`) hashes
`client | parent title | parent description`, and `batchIdForKey` turns that
hash into the batch id. Both inputs are things a person edits in Linear at
will. Rename a parent issue — "6 Reels" to "12 Reels", "Jul. 29" to
"Jun. 29" — and the next import mints a batch with a **new id** for a parent
that the existing batch still claims. Nothing ever releases the old claim.

`_prodResolveBatchParentNodes` then fails **closed**, by design: a uuid claimed
by two batches is ambiguous, so it refuses to guess and builds no synthetic
parent row at all. Every child of that issue renders top-level. The guard is
correct; what was wrong was that anything could produce the ambiguity.

**Live census, 2026-08-24** (all 1,453 batch rows and all 5,373 deliverable
rows, keyset-paged — an earlier count of the same thing was wrong because
PostgREST silently caps a request at 1,000 rows):

| | |
|---|---|
| distinct Linear parents claimed by a batch | 1,283 |
| parents claimed by **two or more** batches | **86** |
| batch rows holding a duplicate claim | 123 (107 minted by this importer) |
| sub-issues with no reachable parent because of it | **45** |

Only 12 of the 86 have visibly different names between claimants; the rest
forked on the parent **description**, which is also in the key and is edited far
more often than anyone tracks.

*An earlier note in this session put the orphan count at 541. That was wrong,
and wrong in the direction that overstates it: it counted every row whose
parent uuid appears in a duplicated set, but a parent that B1 also imported as
a deliverable row of its own resolves through the deliverable map and never
reaches the batch resolver at all. The projection-level figure — the one a
reader actually sees — is 45.*

### The repair (owner runs it; SQL handed over 2026-08-24)

One claimant is kept per parent, chosen by a rule that cannot lose information:
the claimant owning the most children of that parent, then a non-archived batch
over an archived one, then the batch holding the most claims, then batch id.
Every other claimant drops **only** the slots holding the duplicated uuid; a
batch left with no claims at all is nulled. 114 full clears, 9 partial slot
drops, and a full backup table written first — nothing is deleted outright.

Simulated against the shipped resolver over all 5,373 rows before handing it
over:

- parents left with **no** owner: **0**
- parents still claimed by 2+ batches afterwards: **0**
- rows that **lose** a parent: **0**
- rows that **gain** one: **45** — every orphan, including the reported family
  of 30 under VID-13555 and the 4 thumbnails under GRA-7129

Five rows keep the same Linear parent but move to a suffixed synthetic node id,
because their batch goes from one visible parent to two once the duplicate
clears. Harmless, with one narrow consequence worth writing down: a `?d=` link
saved against that bare batch id now resolves to the batch's *other* parent.
One batch, and only for a link someone saved earlier.

### The durable fix (shipped)

`adoptExistingParentClaimants` — when a freshly hashed group has no stored row
of its own but its parent is already claimed by an active batch, the group
**adopts that batch's id** instead of minting a new one. The rename then lands
as an ordinary UPDATE to the existing batch's name, and the children file with
their siblings. Three rules keep it safe: a group whose minted id already
exists is never moved, an archived shell is never a target, and at most one
group may adopt a given target per run. Every adoption is reported in the run
summary as `batch_parent_adoptions`, so an id rewrite can never be invisible.

**Two groups can reach one parent, and the loser must not mint.** The group key
includes the *client*, so when attribution moves a parent's children between
clients mid-run, one parent arrives under two keys — 16 of the 86 live
duplicates straddled `unattributed` and a real client. The first group adopts;
the second now **points its children at the same batch and withholds its own
batch row** from the write. Letting it keep its minted id would insert a fresh
claim on the parent the first group just adopted, recreating the ambiguity on
the very next run. Its children are safe either way: the adopted batch already
exists, so the foreign key holds.

**The receipt has to leave the process.** `batch_parent_adoptions` started life
on the in-memory plan only, which is no receipt at all — the scheduled workflow
suppresses the private log and uploads just the public artifact, so a run could
rewrite which batch a family of children belongs to and leave nothing behind.
It now reaches all three places, split by what each may carry: the persisted
`linear_incremental_refresh` event holds the **detail** (ids and parent uuids,
on the success and the failure payload alike, following `card_slot_conflicts`),
the report **prints the count unconditionally** so a zero is distinguishable
from a stale report, and the public artifact carries an **aggregate only** —
`{adopted, withheld}` — because it is uploaded from a public repository run and
its allowlist exists precisely so nothing row-shaped escapes.

Pinned by `test/b1-parent-uuid-adoption.js`, and by a new case in
`test/public-b1-artifact.js` that feeds the serializer real-shaped adoption rows
and asserts none of the ids appear anywhere in the output.

### The repair did not stay repaired, and that is the real lesson

**Measured 2026-08-25.** The owner ran the SQL at 00:42Z: 86 duplicated
parents → 0, confirmed by readback. At 03:24Z a re-count found **one back** —
`b1_b_c53b1ba8…` had been re-written by `linear-backfill` with both slots
claiming `80a1feb2…`, a parent `b1_b_ad6ed79…` (14 children to its 2) still
owns.

Nothing was wrong with the repair, and nothing was wrong with the adoption fix.
They simply do not cover this: clearing `linear_parent_ids` does not delete the
batch ROW, the row still hashes to that group, so adoption correctly leaves it
alone as an established home — and B1 then recomputes its parent map from the
run's issues and puts the claim straight back. Left alone the repair erodes one
batch at a time, and every eroded parent takes its children's parent card down
with it. **A data repair that a scheduled job can undo is a countdown, not a
fix.**

`dropClaimsOwnedByAnotherBatch` closes it by enforcing one-parent-one-batch at
WRITE time rather than at mint time: a claim is dropped from an outgoing row
when a different **active** stored batch already holds that parent. Ownership
is read from the store, never from the other rows in the same run, so two
groups reaching one parent cannot each defer to the other; a batch keeps a
claim it already owns; an unclaimed parent writes normally; an archived holder
never blocks. It runs on both plan paths, and on the incremental path
deliberately AFTER `mergeBatchParentIds`, because that merge accumulates the
stored map and can carry in a claim the run never recomputed.

Every dropped slot is reported — `batch_parent_claims_dropped` in the run
summary and the persisted event, a count in the printed report and in the
public artifact.

**The one row that came back needs the same SQL again**, once this is on main
and B1 has run with it:

```sql
update public.batches set linear_parent_ids = null
 where id = 'b1_b_c53b1ba8cef185946b072ade25bc';
```

Re-run the duplicate count afterwards; it should read 0 and stay there.

**Still open for the owner:** one of the 86 was a pair of `bat_`-prefixed
batches (GRA-7129) minted seconds apart by the same person through the native
gateway, not by this importer — a double-submit, which the adoption fix does
not cover because the gateway mints its own ids. Worth a look at the Create
Post submit path if it recurs.

## 38. [owner-reported 2026-08-25] Multi-select is inert inside a parent issue, and a status write waits on the wire

Three reports from one sitting, filed for repair after the F27 deploy. **Two of
them are the same defect.**

> *"when I select and shift to multi-select, when I'm in a parent issue, it
> doesn't work, like the shift select doesn't select multiple things"*
>
> *"when I multi-selected the thumbnails and I went to action and changed
> status, it just changed one, it didn't change the rest"*
>
> *"when I change a status of a sub-issue, it takes quite a lot of time to
> change. It should be, like, immediate."*

### 38a + 38b — one cause: `_prodFlatOrder()` does not know about sub-issue rows

`_prodFlatOrder()` builds its list from `_prodGroupsFor(_prodIssueRows())` —
the **list view's** grouped rows. The rows rendered inside a parent issue are
not in it. Two separate call sites then fail in two different ways, which is
why it was reported as two bugs:

- **Shift-select.** `_prodRangeSelectRow` does `order.indexOf(anchor)` and
  `order.indexOf(id)`. Inside a parent both return `-1`, so it takes the
  `a < 0 || b < 0` branch — which adds the single clicked id and returns.
  Shift-click therefore behaves exactly like a plain click.
- **Bulk status.** `_prodTargetIds` filters the selection through
  `const visible = new Set(_prodFlatOrder())`. Inside a parent that filter
  removes **every** selected id, `ids.length` is 0, and it falls through to
  `return [sid]` — one issue. The menu header even counts correctly on the way
  in (`_prodOpenBulkActions` reads `ids.length`), so the UI can say "15 issues"
  and still write one.

**CORRECTION 2026-08-25, on inspecting main rather than trusting the diagnosis
above.** Half of this had *already been fixed* and it did not help, which is
the more useful finding. `_prodVisibleRowOrder()` exists on main, and both
`_prodRangeSelectRow` and `_prodTargetIds` already call it — with a comment
naming this exact bug. The rows also already carry a `selected` class.

But the sub-issue row's `onclick` still called `_prodOpenDeliverable` directly.
**There was no handler that could ever put a row into `_prodState.selected`
from that surface**, so the ordering fix had nothing to order and the selected
class had nothing to paint. A reader could not select a sub-issue at all, which
is why the symptom survived a fix aimed squarely at it.

The remaining change is therefore two lines — route the sub-issue row and the
project issue row through `_prodRowClick`, exactly as the list row does. A
plain click still opens the deliverable (that is `_prodRowClick`'s own
fallthrough), so nothing changes for anyone not holding a modifier.

Two smaller gaps closed alongside it: `_prodVisibleRowOrder` had no `project`
branch, so the project view fell through to the top-level list order — a
different set of rows; and opening a sub-issue's *own* detail now reports an
empty order rather than the parent's children, since that view renders no child
list.

*Left deliberately alone:* `_prodFlatOrder` also drives keyboard focus movement
(`_prodMoveFocus`) and the group checkbox counts. Those read the LIST order and
are correct as they are; widening them is a separate question.

### 38c — the status write is sequential and has no optimistic paint

The apply loop awaits each gateway round-trip before starting the next:

```js
for (const issue of issues) {
    ...
    await _prodGatewayWrite(issue, operation, fields);
    completed++;
}
```

Nothing paints locally first, so even a **single** sub-issue waits a full
round-trip before the row changes — which is the "should be immediate" report.
With N selected it is N × round-trip, so 38b was hiding part of 38c: fixing the
selection bug alone would turn one slow write into fifteen slow writes in
series.

*The sequential shape is load-bearing and must survive the fix:* the catch
block reports the failing issue by position (`issues[Math.min(completed,
issues.length - 1)]`). Parallelising naively loses that attribution, which is
the difference between "3 of 15 failed, here they are" and a single vague
toast.

**FIXED 2026-08-25 by optimistic apply, keeping the sequential loop.** Each row
takes the new value locally before the first write goes out, so the change is
immediate no matter how many are selected; the writes then confirm it.
`_prodGatewayWrite` still applies the authoritative row on success, so a server
value that disagrees with the optimistic one still wins. Only rows that were
never written get rolled back — rolling back a completed one would discard a
receipt that already landed.

---

## 39. [owner-reported 2026-08-25] The calendar refuses a thumbnail status change: `native_link_required`

> *"my social media manager Sebastian says that when he wants to change the
> status of a post, it says save, failed, retry... it says native link required"*
> *"I need to fix all of them so I can tell my social media manager they can use
> the calendar."*

### Where it throws, and what it takes to reach the throw

`index.html:26067`, inside `makePayload` in `_writeUiGatewayPost`:

```js
if (!intent.legacyOnly && !legacyParity && !intent.nativeId) {
    throw _writeUiGatewayError(409, 'native_link_required');
}
```

`legacyParity` is `!!intent.legacyOnly || authority[intent.team] === 'linear'`,
and `intent.nativeId` comes from `_writeUiNativeId` — the card's own
`graphic_deliverable_id` / `video_deliverable_id` column. So the refusal needs
three things at once:

1. the component's team is **SyncView**-authoritative,
2. the card carries a **Linear link** for that component,
3. the card carries **no deliverable id** for it.

Live `prod_authority` read 2026-08-25: `{"video": "linear", "graphics":
"syncview"}`. **Video cannot produce this refusal at all** — it takes the legacy
parity lane where the URL itself is the write target. Every instance is a
graphic (thumbnail) slot, and every one of them dates from the 2026-08-16
graphics flip: before it, the same card worked.

A card with **neither** a link nor an id never reaches the throw —
`_calPushStatusToLinear` classifies it as targetless first. That is a different
defect, the one `scripts/card-linkage-leak-check.js` measures. This one is the
**half-linked** card: it looks connected, it shows a Linear issue, it fails on
use.

### How big it actually is — the number, measured, not estimated

`node scripts/calendar-native-link-gap-check.js`, run 2026-08-25 over all 8,805
calendar rows and 5,380 deliverables:

| bucket | slots |
|---|---|
| would throw `native_link_required` (real clients) | **163**, all graphic |
| ...on an archived card | 57 |
| ...card and thumbnail both at a terminal posted state | 89 |
| ...**actionable** — someone can still open it and be refused | **17** |
| ...**set after the flip** — proves the creation path is still open | **2** |

A further ~758 blocked slots belong to the TEST client's daily drill fixtures
and are excluded; counting them is how this looked like a 900-card catastrophe.
Of the 17 actionable, 15 point at Linear issues that are already **completed**
(`Approved`/`Posted`) — finished thumbnails whose card was simply never bound.
Sampled and confirmed against Linear: GRA-6231, 6323, 6327, 6378, 6384, 6401,
6475, 6476 are all `statusType: completed`.

### Root cause: `link_set` writes the link and nothing else

`calendar_post_events` records every `link_set`. Of **352** graphic `link_set`
events since the flip, 13 left a card with a link and no deliverable — 10 of
them TEST drill rows, and **three real**:

| when | who | what they pasted |
|---|---|---|
| 2026-08-18 | Raha (smm) | a GRA thumbnail belonging to a **different client** |
| 2026-08-24 23:22 | Sebastian (smm) | GRA-6678 — **the card he was refused on the next morning** |
| 2026-08-25 13:19 | Ludmila (smm) | GRA-7228, which has no deliverable row at all |

So this is not historical debris that is finished settling. Staff paste Linear
URLs into the card's link slot from the UI (`_calBulkLinkApply`, index.html
~32573, and the single-card slot) and that write sets `graphic_linear_issue_id`
and **never** `graphic_deliverable_id`. Before the flip that was a complete
link: authority was Linear, `legacyParity` was true, and the URL WAS the write
target. After it, the identical paste manufactures a card whose thumbnail status
can never be changed from the calendar — and the SMM who pasted it is usually
the one who later gets blocked by it.

**Reported by the person who caused it, without either of us knowing that,** is
the detail worth keeping: no one did anything wrong, the same gesture simply
stopped meaning the same thing on 2026-08-16 and nothing said so.

### The comment path has the identical defect

`_calPostLinearComment` (index.html:31137) builds the same intent through the
same `makePayload`. Staff comments on these cards fail with the same 409 today.
Any fix that resolves `nativeId` for status must NOT silently do so for
comments: the comment would commit into the deliverable's canonical thread while
the card keeps rendering legacy, so it would land somewhere the card cannot read
it back. `_prodCanonicalCoversLegacy` (index.html:25127, enforced at 50947 and
50992) is the shipped guard for exactly that hazard.

### Repair — one card, and the sanctioned tool agrees

`scripts/b3-linkage-backfill.js` is the runner for the card side (it fills the
additive linkage slots and says so in its header); `scripts/f42-linkage-defect-
repair.js` is the runner for the deliverable side (Class A: *"the deliverable is
still sitting at its `origin='manual'`, `card_id=NULL` default while a card
points at it... repair = finish the half-done link"*).

The b3 **planner was run against a fixture built from the live tables** — 8,805
cards, 5,380 deliverables, 6,086 sample reviews — and planned exactly **one**
write: `p_mt7v1ebq_phmny` → `b1_d_6edaa19c5e064f5ca040ddd40791c2c3`. That is
Sebastian's card. Everything else it refused for a reason that holds:

- the second same-client candidate (`p_mq8i3bz6_fqmvn`) is on an **archived** card,
- two cards of one client point at a single unbound row — a card-side fan-in, so binding
  either one silently steals it from the other,
- two cards resolve to **another client's** deliverables (`duplicate_live_
  link` / cross-client); binding those would be a cross-client status write.

`assertGraphicsApprovalArtifact` (production-write/index.ts:3644) fires only
when `nextStatus === 'smm_approval'`, so moving a card **out** of SMM approval —
the reported case — is unaffected. Stamping `card_id` also re-enables that
gate's card-thumbnail fallback, and this card carries a canonical Drive
thumbnail, so the inbound direction works too.

### Still open

- **[owner] Bind the link at link time.** The durable fix is for `link_set` to
  resolve the pasted issue to a deliverable and store the id, refusing a
  cross-client match and warning when nothing resolves. It changes a gesture
  staff used 352 times in nine days, so it needs an owner ruling on the
  unresolvable case (warn-and-allow vs refuse) before it is written.
- **[owner] `B1_STRAY_CATCHER=1`** is the sanctioned, INSERT-ONLY lane for
  minting deliverables on a SyncView-owned team, and is the right tool for
  GRA-7228 — the only actionable link whose Linear issue is still open.
  `isOpenIssue` excludes the completed ones, correctly: they are finished work.
- The 15 actionable slots pointing at completed Linear issues need no status
  change ever. They are recorded, not scheduled.

**Made repeatable instead of re-asserted:** `scripts/calendar-native-link-gap-
check.js` (read-only, publishable key, `--json`, `--gate`) reports every bucket
above and exits non-zero under `--gate` when any post-flip slot exists — so once
the creation path is closed, a new one fails a check instead of surfacing as a
staff complaint weeks later. `test/calendar-native-link-gap-check.js` executes
the real classifier against fixtures for each judgement it makes.

---

## 40. [FIXED 2026-08-25] A new client landed on none of the four routing flags

Owner report: a client onboarded today "is still doing it the old way" for samples.

The client (`clients` row created 15:13:45Z; slug withheld — F64, this repo is public) was
absent from **all four** routing flags. The three `*_ef_clients` rows had not been written since 2026-08-21,
still stamped `owner-onboarding-kasperads` — so nothing enrolled him, despite
`NEW_CLIENT_ONBOARDING.md` §6e stating the onboarding job writes them itself.

He was **the only one of 38 active clients** missing. That is how this class
hides: it breaks for the newest client while every look at the estate shows a
full roster.

A second mechanism, worth separating: `write_ui_reroute_clients` **was** written
at 15:13:54Z — nine seconds after his row appeared — by a full-roster job whose
list had been computed before he existed, and it overwrote. A flag that gets
written for you can still drop a client onboarded in the same minute.

Repaired by adding him to all four. **The repair itself then broke something:**
it stamped `updated_by = 'owner-enroll-<slug>'`, and
`PRE_FLIP_HEALTH_CHECK.md` item 5 derives the expected membership FROM that
stamp on the reroute flag and treats any unlisted value as a FAIL. So a correct
enrollment guaranteed a twice-daily red — the alarm-fatigue failure that
document exists to prevent. Restored to `owner-enrollment-wave-3-full-roster`.

*The generalisable part:* §6e already carried the right statement AND a note
saying the stamp must not change. The new guidance did not correct §6e, it
**competed** with it — which is how a runbook ends up with two procedures that
disagree and an operator following the wrong one. Docs now carry a standing
query that needs no slug and names any active client missing from any list.

## 41. [owner-reported 2026-08-25] The batch a post belongs to is invisible, so people make a second one

> *"en los batches creados no me aparece el issue de linear correspondiente"*
> *"si pongo crear batch nuevo se le asigna a santi un video nuevo (que en
> realidad es ese mismo) y se termina haciendo super confuso el workload"*

Three reported symptoms, one cause. Old batches recorded **one team's** Linear
parent. A "Video + Thumbnail" post needs a parent for both teams, so
`_calNativeBatchCompatible` hides every video-only batch — deliberately, since
the gateway would answer 409 `batch_parent_mapping_missing` anyway
(`parentIdsForTeam` returns nothing for the missing team).

So the SMM cannot see the batch she means, creates a new one, and the editor
gets a second video for the same episode. The Workload then shows work that
does not exist. **The invisible option is not the cosmetic part — the duplicate
it causes is the damage.**

Measured over 476 active batches: 93 map both teams, **149 map video only**
(148 of them holding real work), 124 graphics only, 110 nothing.

The shape to converge on already exists in production: a native batch records
the SAME Linear issue under both team keys and stamps `owner_team`, because one
parent issue carries both the video and the thumbnail sub-issue (confirmed:
GRA-7187's parent is VID-13539). Backfilling `graphics` → the existing video
entry reproduces that shape without inventing anything.

Verified before proposing it: Linear projects are per-CLIENT and shared across
teams (VID-13387 and GRA-7194 are both project `313927b9…`), so
`validateLinearBatchParent`'s project check passes.

**Still open [owner]:** the backfill itself, and whether the append route's
un-fixed twin (`validateLinearBatchParent(writtenParentId, team, …)`, which
#1089 fixed only for `directIds`) blocks native `bat_` batches. A live append
to a `bat_` batch answered 409 with the owner-team shape already present, which
that twin would explain — unproven, and the suite pins the current behaviour
deliberately, so it was NOT changed on a guess.

## 42. [owner-reported 2026-08-25] Empty parentless batches left by the rename-fork repair

The duplicate-batch census that item 37 repaired cleared `linear_parent_ids` on
the losing claimants but left the ROWS `active`. Live: **110 active batches have
no parent map at all; 84 of those also hold zero deliverables.**

They are already invisible to the picker (`_calNativeBatchHasLinearParents`
filters them), so they are clutter rather than a blocker — the shape is
unmistakable in the data: three empty twins minted in the same minute, then the
real batch minutes later (JENNA PB Episode 09, 10 and 11 each show it).

Archive is safe for the 84 that hold nothing. **The other 26 are parentless AND
hold work — those must not be archived** and want a separate look, since work
in a parentless batch cannot be appended to at all.

**2026-08-25, the 84 are archived; the 26 have a dry run.**
`scripts/batch-parent-recovery-dry-run.js` reads each of the 26 batches'
children out of Linear and prints the parent it WOULD write. It has no apply
path — running it cannot change anything. Probing four of them found two shapes,
and that is the whole reason this is a script and not one SQL statement:

- **A. the child has a parent.** GRA-7149 → VID-13469, GRA-6992 → VID-13203. The
  batch parent is that parent. Note it is a VIDEO issue above a GRAPHICS child:
  the house shape, one parent carrying both sub-issues, not an anomaly.
- **B. the deliverable IS a batch parent.** VID-13346 and VID-13355 have no
  parent, were authored by "SyncView Mirror", and carry a Filming Plan link as
  their description. They are parent issues that got imported into
  `deliverables` as if they were work. For the BATCH that issue is the answer;
  for the deliverables table it is a second defect, and the dry run reports it
  rather than repurposing the row.

Review caught two ways this could have produced a **confident wrong answer**,
which is worse here than no answer because the operator writes what it prints:

1. A parentless issue was called the batch parent unconditionally — but an
   ordinary top-level issue also has no parent. It now needs one of the two
   measured shape-B signals, and without either the verdict is `ambiguous`.
2. A failed Linear probe became `null` and was filtered away, so one unreadable
   child of two left one survivor — and one survivor with a parent reads as
   unanimous, when the unread child is exactly the one that might have
   disagreed. Any unread child now yields `probe_incomplete`: re-run, do not act.

`test/batch-parent-recovery-classify.js` executes the shipped classifier against
both shapes, both wrong answers, and the ways they mix.

**2026-08-25, the dry run RAN.** Not with the operator's Linear key — the same
reads were made through the Linear MCP tools already attached to the session, so
all 63 children of all 26 batches were probed. Verdicts:

| verdict | batches | |
|---|---|---|
| `recover_from_child` | 16 | every child agrees on one parent |
| `deliverable_is_the_parent` | 4 | one parentless issue carrying a batch-parent signal |
| `recover_per_team` | 1 | video children under one parent, graphics under another |
| `ambiguous` | 5 | left for a human — see below |
| `probe_incomplete` / `no_probe` | 0 | Linear answered for every identifier |

**Running it against the real 26 found two more classifier defects**, both of the
same family as the review findings above — a refusal that was wrong about what a
refusal is:

3. **Two parents is not always a disagreement.** `linear_parent_ids` is keyed BY
   TEAM, so a batch whose video children hang off one issue and whose graphics
   children hang off another is not in conflict — that pair IS the map. One batch
   was being refused for having exactly the shape the column exists to hold. Now
   `recover_per_team`, and a same-team disagreement is still refused.
4. **A third shape-B signal: the issue is titled what the batch is named.** Two
   batches each held one parentless issue authored by a PERSON with an ordinary
   description, so neither of the first two signals fired — yet each was titled
   exactly its batch's name, which is what a batch parent IS. A child never
   carries it; children are "Reel 03", "Thumbnail 1". Three sibling issues all
   titled as the batch stays ambiguous, so the signal cannot manufacture
   confidence where there is none.

**The 5 left for a human** hold 17 live deliverables between them (3 of those are
the TEST client's). Four are the same shape: a batch holding several issues that
are each a batch parent in their own right — separate Create Post runs whose
parents all landed in one batch row. Deciding which one owns the batch, or
splitting the batch, is a judgement about the work, not about the data.

**A second defect is visible in those 5 and is NOT repaired here:** their
`deliverables` rows point at PARENT issues rather than at work. The children that
are the actual deliverables ("Video 1", "Thumbnail 1") are not in the batch at
all. Writing a parent map over that would leave the batch appendable but still
wrong about what it contains.

The write SQL for the 21 confident batches was handed to the owner directly
rather than committed: it embeds Linear URLs, and those URLs carry client names
(F64, this repo is public).

## 43. [found 2026-08-25] Batch parent issues are stored as deliverables, and staff are counted for them

Item 42's five unrecoverable batches all shared a second defect: their
`deliverables` rows named a **parent** issue rather than a piece of work. That
turned out not to be a property of those five.

**A healthy batch holds only children.** Measured against a known-good native
batch: parent `VID-13417`, deliverables `VID-13418` (video) and `GRA-7131`
(thumbnail). The parent is not among them, which is the correct shape.

**Estate-wide, 1,079 deliverable rows are their own batch's parent.** 290 are
still live; **272 of those sit in 261 ACTIVE batches**. Shape of the live ones:
172 `video/video`, 96 `graphics/thumbnail`, 2 `video/thumbnail`, 2
`graphics/other`.

### What it actually costs, measured rather than assumed

The Create Post editor picker suggests whoever has the least open video work,
counting `production_deliverables_browser_v1` rows in `todo|in_progress|tweak`.
**332 rows are counted right now and 56 of them are parent rows** — 17% of the
number staff are shown.

| editor | counted | of which parents | real |
|---|---|---|---|
| A | 7 | 1 | 6 |
| B | 18 | 1 | 17 |
| C | 56 | 3 | 53 |
| D | 67 | 15 | 52 |

**The suggestion is not currently wrong** — the same person is freest either
way, and the picker was verified working on 2026-08-25 in response to an SMM
report. But the numbers in the disclaimer are overstated by up to 22%, and the
two heaviest editors are 52 vs 53 in reality where the dialog shows 67 vs 56 —
i.e. the displayed order of those two is already the reverse of the true one.
The ranking survives today by luck, not by construction.

Other consequences, not yet quantified: a parent row appears in Production and
Workload as work that can never independently complete, and a status transition
on it writes to the parent issue.

**Not repaired here, and deliberately not a one-line DELETE.** Item 42 already
established that a confident wrong answer about parentage is worse than none.

### The triage pass, written and run 2026-08-25

`scripts/batch-parent-row-triage.js` is that separation, read-only with no apply
path. It sorts all 1,079 rows into four outcomes whose ORDER is the safety
argument:

| outcome | rows | |
|---|---|---|
| `card_bound` | 2 | a calendar card points at it; never collateral |
| `terminal` | 805 | posted/approved/archived — history, nothing counts it |
| `detachable` | 174 | live, and the batch holds other live work |
| `sole_row` | 98 | live, and the ONLY live row in its batch |

**168 of the 272 live rows carry an assignee**, which is what puts them in the
editor workload counts.

Two results changed the shape of the repair:

1. **The `card_bound` worry was nearly right and would have been badly stated.**
   The original concern was that these rows might be the only thing binding a
   card to its batch. Among the 272 live rows in active batches, **zero** carry
   a card. Across all 1,079, **two** do — and both are terminal. So no repair
   candidate is card-bound, but "zero" on its own would have been wrong. The
   check stays, and `--gate` fails if that number ever moves.

2. **`sole_row` must not be touched, and it is more than a third of the live
   population.** Removing the parent row from a batch that holds nothing else
   leaves an empty batch, which reads as finished work — when the truth is the
   batch's real children were never imported. That is a worse failure than the
   one being repaired. Those 98 want an import, not a delete.

So a repair, when written, applies to `detachable` only — 174 rows — and the
other 98 are a separate piece of work with a different shape.

### The five remaining shells, and why their rows must NOT be retired yet

Traced 2026-08-26. The five active batches that still carry no parent map are
not undecidable parentage — that framing was wrong. **Every one of their parent
issues already has its own correct batch**, built in the modern shape: one
parent issue, its video sub-issue and its graphics sub-issue under it. Verified
for all thirteen.

So the five are **legacy shells**. What they hold:

| shell | holds |
|---|---|
| three of them | nothing but parent rows |
| two of them | parent rows plus 4 video rows stranded from the batch they belong to |

The 4 stranded rows have a repair with no judgement in it: each one's proper
batch is missing exactly its video half, and both Linear's parentage and the
target batch's own parent map agree on where it goes. That SQL went to the owner.

**The thirteen parent rows are a different matter, and the timing is the whole
point.** Ten of them are `todo` on the video team, so the Create Post editor
picker counts them as open work — they are part of item 43's 168. Retiring them
means a status change (`duplicate` is the exact word: they duplicate a parent
that lives in the proper batch, and `_wlIsLiveWork` already excludes it).

**Do not do it before the video flip.** Video is still LINEAR-authoritative, so
the reconciler's job is to bring native into line with Linear. A native-only
status change is native drift by definition — it would either be reverted or
show up as inbound diff noise in the week the flip is being judged on exactly
that counter. Direct SQL does not reach Linear (writes travel through
`mirror_outbox`, which only the gateway fills), so the change is safe from
Linear's side; it is the reconciler that makes the timing matter.

After F1, SyncView is authoritative and the same statement is simply true.
Sequence: move the 4 stranded rows now → flip → retire the 13 parent rows →
archive the shells. Archiving the shells first is cosmetic only: a batch with no
parent map is already hidden from the picker, and the rows it holds are counted
by status, not by batch.

## 44. [owner-asked 2026-08-25] Two front doors, and only one of them is a lock

The site has two ways in. The old one is a single shared password
(`synchrosocial2026`, hardcoded at `index.html:54844`) that sets a localStorage
flag and unlocks the entire staff workspace. The new one is a real staff sign-in:
roster name plus a per-role key, verified server-side.

Owner ruling 2026-08-25: *"there shouldn't be two login menus. I think we should
remove the old one … and the sign-in should make it so we can't access the page
if we don't sign in."*

**What the shared password is actually protecting: less than it looks.**
`production-write` resolves `x-syncview-key` through `matchingRoleForKey` and
throws `401 invalid_staff_key` when it does not match — unconditionally, without
consulting `auth_enforcement`. Every write already requires a real per-person
key. And reads run against Supabase with the publishable key, which the shared
password never gated. So removing it costs no write security and no read
security; what it buys is that a shared, unrevocable secret stops existing and
people identify themselves.

**Who must keep getting in without it.** The entry dispatch already branches
before the password for every one of these, and any change must keep them:
`_isClientLink` (`?c=` — clients opening a review link, and it is the FIRST
branch), `_isOnboarding`, `_isOnboardingView`, `_isSmmWeeklyEntry`, and
`_isIntake` (`?intake=1` — **the Submit tab, which the owner confirmed on
2026-08-26 must stay open to anyone with the link**; it hard-locks navigation to
`#linear`).

**The catch that makes this more than a deletion.** `_syncviewStaffIdentityValid()`
requires `_syncviewStaffIdentityVerified`, an IN-MEMORY flag that is false on
every page load until a server round-trip re-verifies the stored identity. A boot
gate written naively against it would demand the role key on every single reload.
Requiring sign-in at entry therefore means wiring the boot path to the existing
`_syncviewStaffBootPromise` verification and holding a gate until it settles —
which is the pre-paint boot sequence, the one surface with its own dedicated CI
lane (`client-entry-visible-boot.yml`). Not a one-line change, and not one to
make in the same week as the flip without the owner watching.


## 45. [FIXED 2026-08-26] The first-paint cache never fit, and it deleted the neighbours trying

Owner, 2026-08-26: *"sync linear is still pretty slow … do you think we can make
it even faster when loading?"*

SyncLinear paints from a `localStorage` snapshot and revalidates behind it. The
snapshot it actually serialised was **5.44M characters** — every client, member,
batch and deliverable. `localStorage` stores UTF-16, so that is ~10.9MB asking
for an origin budget of about 5MB. **The write could not succeed on any browser,
on any day, for anyone.** Every open therefore paid a full cold read: six
sequential keyset pages of 1,000 deliverable rows at ~0.5–0.7s each, measured
live at 1.9–3.5s of upstream time before the tab could paint anything real.

The expensive part was not the miss. On `QuotaExceededError` the writer evicts
the oldest same-family snapshot and retries, **one key at a time**. No number of
evictions could make room for 10.9MB, so every Production open walked that loop
to the end and deleted **every calendar and samples snapshot in the origin** —
and then still failed. Opening one tab quietly made two others slow, every time,
and nothing reported it.

### What was measured, 2026-08-26, live

| Part | Chars | Share |
|---|---|---|
| `batches.description` (1,465 rows) | 2.12M | 39% |
| deliverables (5,398 rows) | 2.57M | 47% |
| batches, everything else | 0.74M | 14% |
| clients + members + authority | ~0.01M | <1% |
| **total** | **5.44M** | ~10.9MB UTF-16 |

Deliverable status split: 3,902 terminal (approved 3,155 / posted 713 / canceled
32 / duplicate 2) against 1,496 live. **72% of the rows the snapshot carried are
work the default tab does not show.**

### The fix, and the rule underneath it

1. **The budget is checked before the first `setItem`.** A write that cannot
   possibly fit now costs its neighbours nothing. Checking after the first
   failure is the bug — by then the eviction has already started.
2. **What is cached is what the default view paints.** Batch descriptions are on
   no first paint (`_prodPreserveProjectedFields` already exists because a
   projection may omit them); terminal deliverables are history. Dropping both
   puts the snapshot at ~1.29M chars / ~2.5MB UTF-16, which fits *beside* the
   calendar and samples caches.

Because the snapshot is now a projection rather than a copy, schema 2 discards
any full snapshot written under the old contract, `_prodState.cachePartial`
marks the window between the cached paint and the live read, and the one tab
that shows completed work says it is still loading rather than "no issues here
yet". Deep links were already safe: `_prodApplyDeepLinkFallback` keeps the
request pending across a cached paint that cannot satisfy it.

Pinned by `test/production-cache-fits.js`, whose fixtures are sized from the
measurement above — so the estate outgrowing the projection arrives as a test
failure rather than as slowness.

### CORRECTION, same day: schema 2 did not fit either, and the test said it did

Everything above is right about the diagnosis and wrong about the repair.

The projection was sized from a **sixteen column** read. `PROD_DELIVERABLE_SELECT`
asks for **forty-four**; the line was read truncated and never checked against
the source. Measured properly against the shipped select: rows average **1,674**
characters, not ~499, and the schema-2 projection is **3,283,150** characters
against its own 1,800,000 budget. Still refused. Still every open a cold one.

`test/production-cache-fits.js` passed the whole time, because its fixtures were
built from the same wrong column list — it measured something 2.5x lighter than
reality. A green test asserting a false thing is worse than no test, and it cost
a day.

**Schema 3 (columnar) is the actual repair.** A verbatim row spends ~44 quoted
key names on every one of ~1,500 rows; columnar writes the names once and stores
each column's values as an array. Measured live through the shipped
`_prodCacheProject`: **3,283,150 -> 1,751,888 characters**, and a decode returns
the live rows byte-identical.

Three things the repair had to get right, all of which a naive version gets
wrong:

1. **Key presence.** `_prodHasOwn(row, field)` distinguishes "absent" from
   "present and null" for `identity_repair_*`, `brief`/`desc` and
   `board_desc`/`desc`. A union-of-keys encoder fabricates `null` for every row
   missing a column and flips those probes to TRUE — a reader looking at a
   confident "No description." over a brief that exists. The codec stores an
   explicit presence mask per row shape; distinct shapes are deduplicated, so
   today's estate (one shape) costs one string.
2. **Authority is no longer cached at all.** It decides whether write controls
   are live, and a snapshot may be 24 hours old. Caching it would mean that on a
   flip morning — or the morning after a rollback — a reader briefly sees the
   previous day's answer. Leaving it out reproduces exactly what happens today,
   since nothing was ever cached.
3. **The column list is pinned both ways.** The cache is sized from
   `PROD_DELIVERABLE_SELECT` at run time rather than from a restated list, and a
   snapshot written against a different column list is discarded on read rather
   than painted with a shape the running code no longer expects.

Proven in a real browser, not just arithmetic: with a 1,150,000-character
calendar snapshot and a 1,150,000-character samples snapshot already in the
origin, the 1,751,888-character Production snapshot **writes, reads back
identical, and leaves both neighbours intact**.

Budget raised 1,800,000 -> 2,400,000, which is ~648,000 characters of headroom
(about 850 more live rows). Sized deliberately generous because the failure mode
of being too generous is now benign — the budget is checked before the first
`setItem`, so an oversized payload is refused without evicting anybody.

Also fixed while in there: `descLoaded` was hardcoded `true` on batch-parent
issues while its two sibling builders derive it from the key that was present.
The cache drops batch descriptions by design, so a cached first paint is
precisely when that lie gets told — 1,186 batch parents carry both a description
and a parent map today.

## 46. [audited 2026-08-26] The gates go red for reasons that are not the code

Owner: *"could you maybe do a kind of a check-up on if all of those gates are
necessary … are they good? Because I'm always having problems with those."*

Full audit in **`docs/ops/CI_GATE_AUDIT.md`**. Four structural defects, three of
which produce a red mark unrelated to the pull request:

1. **A pull request and `main` do not run the same checks.** The heavy and
   interaction lanes carry `if: github.event_name != 'pull_request'`, so they
   run only *after* the merge. #585 was the last green run on `main`; #589, #593,
   #597, #606 and #607 all failed after green pull requests.
2. **A red heavy lane could not name what failed** — `Production wired behavior
   [unclassified]`. **FIXED 2026-08-26**: behav-wired now prints its failed check
   NAMES on their own line and the gate validates each against an allowlist read
   from that suite's own source (168 names, matching its own `TOTAL`). Pinned by
   `test/prod-polish-names-the-check.js`.
3. **Every commit on a branch ran the unit suite twice** — `push: ['**']` plus
   `pull_request` both matched. **FIXED 2026-08-26**: `push: [main]`.
4. **The heavy lane asserts 168 behaviours against the live database.** A row
   changing status in Linear can turn it red with no commit involved. Keep it,
   but it should not become a merge gate until (1) is addressed — and not during
   flip week.

Still open: (1) and (4), deliberately deferred until after the video flip, plus
diagnosing the actual heavy-lane failure now that it can name itself.

## 47. [FIXED 2026-08-26] A card deep link that failed looked exactly like one that opened the wrong card

Owner, 2026-08-26, forwarding an SMM's `#calendar/<slug>/<cardId>` link: *"she
sent me this link to that card, but when I opened it, it focused on another
card."* And, ruling out the obvious explanation: *"I have all month and all
content on my calendars."*

The card resolves. Checked live: the id in that link is a real row, on that
client's calendar, with a name, a status and both deliverables bound. So
`calState.posts.find(p => p.id === req.cardId)` succeeded and the "Card not
found" notice never fired — the failure was entirely downstream of the lookup,
in `_calApplyFocusRequest`.

**Two silent failures, and the silence is the whole report.** A reader who
follows a link and sees *nothing happen* is looking at the calendar's ordinary
state, in which a different card already carries `.cal-card-current`. Nothing
was focused; something else already was. "It focused on another card" is what
"it did nothing" looks like from the outside.

1. **One frame, one query, no word.** The DOM was queried inside a single
   `requestAnimationFrame` and `if (!card) return` gave up. The post is in
   `calState.posts` before the strip has finished painting it, so a card that
   rendered one frame late was abandoned without a notice.
2. **`behavior: 'smooth'`.** A smooth scroll computes its target offset ONCE and
   animates toward it. The strip's thumbnails decode during that animation,
   every card ahead of the target changes width, and the scroll finishes at an
   offset that now belongs to a neighbour — with the outline on the correct
   card, off screen.

**The fix:** keep looking for a bounded 40 frames (~0.6s) rather than one; put
the outline on *before* moving anything, so a misbehaving scroll still leaves
the reader able to see which card was meant; scroll INSTANTLY, because an
instant scroll cannot be invalidated mid-flight; correct once after 400ms for
the shift that happens *after* the scroll rather than during it, guarded on the
element still being in the document; and if the element never appears, **say
so** — naming the card and pointing at the Organize filters, which is the one
thing the reader can act on.

Pinned by `test/calendar-deep-link-focus.js`, which executes the shipped handler
against a fake DOM and drives the frames by hand.

*Not reproduced in a browser.* This is a diagnosis from the code and the live
row, not from a repro — the sandbox this was fixed in cannot reach Supabase from
a browser. Both changes are strictly safer than what they replace (a bounded
retry where there was an immediate give-up; an instant scroll where there was an
invalidatable one; a notice where there was silence), so shipping ahead of a
repro is the lower risk. If the report recurs, the notice added here is the next
piece of evidence.

## 48. [measured 2026-08-26] Half-linked cards: 6 estate-wide, 3 repairable

Owner, after repairing one client's card by hand: *"do you think we need to do
this for other cards?"*

Measured across all 8,895 calendar cards and 5,398 deliverables:

| | count |
|---|---|
| cards with a video deliverable bound | 529 |
| …of those, with NO graphic deliverable bound | 85 |
| …of those 85, with **no** graphics deliverable in the batch at all | **79** |
| …with exactly one FREE graphics twin in the same batch (repairable) | **3** |
| …with more than one free twin (ambiguous — needs a human) | **2** |
| …whose graphics twin is already bound to a different card | **1** |

**The answer is no — and the "3 repairable" is wrong, which is the useful part.**

The 79 are video-only posts with nothing to link to: the normal shape, not a
defect. Six cards are in the repaired card's shape. Three of those were counted
as repairable because each had exactly one *free* graphics deliverable in its
batch — but when the actual rows were pulled rather than the counts, **all three
name the SAME free deliverable**, one batch-level graphic
(`Chelsey Scaffidi · 26 May 2026`, GRA-6225) sitting in a batch of separate
videos. Binding it to one card leaves the other two exactly where they started,
and picking which one is a judgement nobody has made.

So the correct estate-wide count of cards that can be repaired without a person
choosing is **zero**. Item 42's rule holds without exception here: a confident
wrong answer about which deliverable belongs to which card is worse than no
answer.

*The counting mistake is worth keeping.* "Exactly one free twin" is a per-card
test, and it is not the same question as "this twin is free FOR this card" —
three cards can each pass a per-card uniqueness test while competing for one
row. A repair scripted from the first count would have bound the same
deliverable three times and reported success.

## 49. [FIXED 2026-08-26 — needs the migration + a deploy] A batch you just created cannot take a second post

An SMM, via the owner: *"I added a post with the Linear issue that was set
automatically since I chose new batch, and I want to add another post to that
same batch but it doesn't appear in the list."*

The batch exists. Checked live: active, created 2026-08-26 13:59 UTC, parent
`VID-13589` — exactly the issue she linked — and it already holds the video and
the thumbnail from her first post. It is missing from the picker for one reason:

**`batches.team = 'video'`.**

`_calNativeBatchCompatible(batch, mode)` ends `return false` for mode `both`
whenever the batch carries ANY team stamp. That is not an oversight — it mirrors
the gateway, which refuses a mismatched append with `batch_team_mismatch`
(`production-write/index.ts:2920`, and again at `:3165`). Offering the batch
would produce a late 409 instead of an early absence. The picker is right; the
ROW is wrong.

### Two creation paths, and only one of them gets this right

| Path | Line | Stamp |
|---|---|---|
| Native intake (`intake_create`) | `index.ts:5430` | `team: teamList.length === 1 ? teamList[0] : null` — **correct**: a Video + Thumbnail batch is born unstamped |
| Production create (`operation: "create"`) | `index.ts:3402` | `team: scope.team` — **always stamps**, whatever the batch will end up holding |

A batch created by the second path can therefore never accept a Video +
Thumbnail post, however complete its parent map is. Measured 2026-08-26: **15
active batches carry `team='video'`** (2 of them created in the last two days),
125 carry `team='graphics'`, and 256 are unstamped. The graphics ones are mostly
legitimate thumbnail-only batches; the video ones are the trap, because "Video +
Thumbnail" is the default mode of the dialog.

### The immediate unblock

```sql
update public.batches
   set team = null,
       updated_at = now()
 where id = 'bat_f2d8f5cb-a48b-480a-9715-eb903409b324'
   and status = 'active'
   and linear_parent_ids ? 'video'
   and linear_parent_ids ? 'graphics';
```

Safe because the guard requires a parent for BOTH lanes: clearing the stamp on a
batch that can only file one team would move the refusal from the picker to the
gateway, which is the failure this repair exists to prevent. The batch reappears
on the SMM's next refresh. She can also select **Video only** right now and the
batch is offered immediately, with no change at all — worth saying first,
because it needs nobody.

### What is not fixed

The stamp keeps being written. The repair is one of:
  (a) stop `operation: "create"` stamping `team` when the batch's parent map
      covers both lanes, or
  (b) relax BOTH the picker and the gateway to read the parent map rather than
      the `team` column — the column is legacy, and the "one team per batch"
      shape it encodes was superseded by ONE PARENT PER CARD (2026-08-18).

(b) is the honest fix and it touches the gateway, so it is not a flip-week
change. Until then this recurs at roughly one batch a day and the SQL above is
the workaround. **Do not run a blanket `team = null` over all 140 stamped
batches**: the 125 graphics ones are genuinely thumbnail-only and their stamp is
what makes "Thumbnail only" offer them correctly.

### Addendum 2026-08-26, later: the SQL workaround UNDOES ITSELF

Two more owner reports (a different client's batch, and an episode batch absent
from the picker) turned out to be this same item, and chasing them found the
thing the entry above is missing: **clearing the stamp does not stay cleared.**

`team` is in `batchFields` (`scripts/b1-linear-backfill.js:1382`), the list the
B1 import compares an existing row against, and a difference queues a rewrite
(`:1391`). The value it compares with is recomputed from the CHILDREN
(`:760` — one team if they all match, `null` if they span both). So a batch
whose children are all video gets `team='video'` written back on the next
incremental pass, which runs every 30 minutes and is live-writing today. The
script says why the two disagree in its own words at `:848-865`: `team` comes
from the children while the map keys come from each child's PARENT's team, and
"a graphics child can hang off a video batch card".

That makes the SQL a TIMED WINDOW, not a repair: clear the stamp, and the post
must be added before the next import. Once it is added the children genuinely
span both teams, the recomputed value is `null`, and it stays fixed for good.
Worth saying to whoever runs it, because otherwise it looks like the SQL simply
did not work.

Measured 2026-08-26 across all 397 active batches:

| shape | count | what it means |
|---|---|---|
| stamped, BOTH parent keys | 10 | the SQL above applies; 9 have single-team children and would be re-stamped, 1 already has mixed children and will self-heal |
| stamped, ONE parent key | 127 | the SQL must NOT touch these — no parent for the other lane, so clearing the stamp moves the refusal to the gateway |
| stamped, no parent map | 6 | excluded by the orphan filter anyway |
| unstamped | 254 | working normally |

### And a sharper guard than "both keys present"

Both keys is not by itself proof that both lanes can file. `synthesizeParentMap`
(`b1-linear-backfill.js:901-913`, deliberately unconditional) mirrors a graphics
parent into the VIDEO slot stamped `owner_team: 'graphics'`. On such a row the
append resolves the shared route for `video` (`index.ts:5238-5248`) and then
`validateLinearBatchParent` compares the issue's project against the VIDEO
project (`index.ts:2107`, the one half of that check `parentOwnerTeamFor` does
NOT relax) — so it would be refused late, exactly the failure this item exists
to prevent.

The safe test is therefore: the parent for the PRIMARY team (video whenever the
post needs both) must be owned by that team — `owner_team` absent, or equal.
Measured today: **0 of the 260 both-key active batches carry the mirrored
shape**, so the SQL above is safe as written right now; it is the code fix (b)
that must encode this, because the shape is producible at any import.

Why the 10 are safe to append to, for the record: a thumbnail child does not
need its own parent. `ownsDistinctParent` (`index.ts:5257`) is false when the
graphics key points at the same issue as the video key, so graphics REUSES the
shared video route — which is what ONE PARENT PER CARD intends, and why those
rows carry a graphics key pointing at a VID issue in the first place.

### The fix, 2026-08-26 (three layers, in this order)

The column stops deciding. What decides is what the gateway does when it files
the work: every team the post needs must have a parent recorded, and the PRIMARY
team's parent must be owned by that team.

| layer | change | ships by |
|---|---|---|
| `migrations/2026-08-26-production-intake-append-v7.sql` | removes `or (v_batch.team is not null and ...)` — one line, nothing else | the owner runs it |
| `production-write/index.ts` | the `batch_team_mismatch` veto is gone; the parent route still decides | Edge Function deploy |
| `index.html` `_calNativeBatchCompatible` | parent coverage + primary-owner check; reads the column nowhere | merge |

**Order is mandatory: SQL, then deploy, then merge.** Each earlier step only
widens what the server accepts, so each is safe on its own. The reverse order
shows an SMM an error where she used to see an absence.

The owner-team half is not decoration. `synthesizeParentMap` mirrors one team's
parent into the other's slot, and `validateLinearBatchParent` compares the parent
issue's PROJECT against the requesting team's project — the half the owner-team
relaxation deliberately does not cover. `test/batch-append-parent-map-rule.js`
pins that shape, the 127 one-parent rows that must stay hidden, and the property
that matters most: the same parents give the same answer whatever the stamp says.

One consequence worth knowing: on these shared-parent rows a THUMBNAIL-ONLY post
is still refused, because their graphics parent really is a video issue and the
gateway compares its project. Video and Video + Thumbnail both work. The picker
now agrees with the server on that instead of offering it and failing late —
which is what the by-hand `team = null` repair on its own would have caused.

v7 was compiled on a disposable PostgreSQL 16.13, installed over v6, and the
installed function body checked to confirm the clause is gone (house rule: no
migration is handed over unexecuted).

**Correction to the addendum above:** the live migration is **v6**, not v5, and
the clause sits at v6:233. The v5 reference was mine and it was wrong.

## 50. [FIXED 2026-08-27 — count half + display half; root cause recorded] 75 open "deliverables" are actually batch parents

Found while answering an editor's report that his Workload shows overdue items
that are not real work. Two of his rows were briefs: a February batch parent
sitting in `tweak` ever since, and a July container carrying the whole month's
editing notes, assigned to him, due 2026-07-17.

Measured precisely — an open deliverable row whose `linear_issue_uuid` equals a
parent uuid recorded in some batch's `linear_parent_ids`:

**75 of 535 open deliverable rows are batch parents, ~30 assigned to a person,
8 carrying due dates that keep them permanently overdue.**

The B1 import creates a BATCH from each parent group and is also importing the
parent issue itself as a deliverable inside it. The Workload board happens to be
protected (it filters `is_sub_issue`), but the deliverables mirror is not, so:

- the Create Post editor picker balances on "open videos per editor", and a
  parent row inflates its editor's count — the suggestion is skewed;
- the Production tab's flat counts include them;
- any assigned+dated parent shows as overdue work nobody can complete.

Repair direction (as originally filed): the import should not emit a
deliverable row for an issue it just recorded as a batch parent — or the
browser projection should exclude rows whose uuid matches their own batch's
parent map. The second is safer (no data rewrite) and testable against the
measurement above.

**Built 2026-08-27 (owner-approved), in two halves:**

- **Count half** — both editor-count consumers exclude parent rows before
  counting: the Create Post picker's freest-editor suggestion and the
  gateway's `autoAssigneeForIntake` derive a parent-uuid set from
  `raw_issue_parent_id` and skip those rows symmetrically (same degradation on
  a failed parent read). Pinned by `test/editor-count-excludes-parents.js`.
  Gateway half DEPLOYED 2026-08-27 ~16:00 UTC as `production-write` v55,
  attested live source `77a00199e586` == the pinned §4 closure (12/12 PASS).
- **THIRD SITE, found and fixed 2026-08-27 16:40** — `_calFetchNativeBatchPostCounts`,
  the count that decides which batches rank LAST as empty in Create Post. The
  ranking exists because an empty twin was being offered above the sibling
  holding the work; the imported parent row defeated it. Measured live:
  **317 of 402 active batches counted their own parent, and 60 showed as
  populated while holding ZERO real posts** — the exact rows the ranking was
  built to sink never sank. Fixed by deriving the parent uuids from the batch
  rows the picker already holds (no second network read). Three instances of
  one defect is a class, so the fix ships with a REGISTRY guard:
  `test/deliverable-counts-exclude-parents.js` sweeps every site that reads
  more than one deliverable row and fails until each is recorded as
  parent-aware or exempt-with-a-reason. A fourth consumer cannot now be added
  silently. (The sweep also cleared the rest of the estate: the gateway's
  append numbering is keyed on the `Video N` / `Thumbnail N` title pattern,
  which a parent title never matches, and every other multi-row read is
  id-keyed or is the tree projection where parents ARE the nodes.)
- **Display half** — NOT removal: dropping parent rows from the projection
  would orphan every imported child (`_prodResolveParentLinks` maps children
  to parents among deliverable rows only). Instead a row-aware gate,
  `_prodRowOverdue` / `_prodRowOverdueText`, withholds the overdue treatment
  (red chip, red side row, "overdue by N days") from any row the adapter
  already flags `isHierarchyParent`, at every render site. The date still
  renders; children keep their red; synthetic batch parents were never dated.
  Pinned by `test/prod-parent-rows-not-overdue.js`, which executes the parent
  link resolver, the hierarchy flagging and the gate, and proves by inversion
  that losing the flag would be caught.

**ROOT CAUSE FIXED 2026-08-27 evening (owner-directed: "I want to not have
those mistakes ever again").** The B1 importer no longer emits a deliverable
row for a container at all. `containerIssueIds` classifies an issue as a
container on any of three signals — an in-scope child names it as parent; an
existing row's `raw_issue_parent_id` names it (the same signal every count
fix keys on); or an existing batch records it in `linear_parent_ids` AND that
batch holds a row for a different issue, the extra clause being what keeps a
standalone work item (its own single-issue batch names it as parent) alive
run after run. Both lanes filter the row build through the set; a container
whose row already exists keeps tracking Linear through the incremental soft
lane but is never re-minted, so the 75 can only shrink. Pinned by
`test/b1-container-issues-not-work.js`, which executes every boundary
including the standalone-survival one. The three consumer-side exclusions and
the registry guard stay as defense in depth. Live proof pending the first
post-merge B1 run: the count of open parent rows must stop growing.

**Incident on the first shipped version (same evening; full entry in
`EXECUTION_LOG.md` 2026-08-27):** signal (b) read `raw_issue_parent_id` from
the deliverables TABLE, but the column exists only on the browser view — B1
runs **3295/3296** died on 42703 (cursor stayed pinned at the 17:30 green
window, zero data loss), and the deployed gateway's identical read had been
degrading to a no-op since v55, leaving that count correction silently
inert despite a 12/12 PASS attestation. Corrected in the follow-up PR:
signal (b) now derives from `linear_raw.issue.parent.id`, the gateway reads
the view, and `scripts/production-write-drill.js` gained a
`video_auto_assign_proof` stage that executes the parent read live and
recomputes the pick, so the degradation path can never again fail unseen.
Baseline for the live proof: **286 open parent-rows** measured ~17:55Z.

Assessed and left alone: the client tiles' flat count tallies top-level NODES
(one per batch, imported and synthetic alike) — a consistent tree notion, not
the defect. The root cause remains the B1 import emitting parent rows; fixing
that is an import-semantics change to a production script, recorded here as
the only lever left if the 75 (stable set) ever needs to reach zero in data.

## 51. [CLOSED 2026-08-27 — owner ruled; view already compliant; ruling pinned by test] "Waiting on approval" counts as the editor's overdue work

The editor's board shows **~133 overdue rows**, but only ~19 are actionable by
him. Owner ruling (2026-08-27): to-do / in-progress work past its date COUNTS
as the editor's overdue; approval-wait does NOT; `Tweak Needed` goes to the
NEEDED lane.

**Correction to the original entry** (same day, on implementation): the
mechanism sentence above the ruling was wrong. `wlIsActiveStatus` does NOT
keep approval states active — `WL_PARKED_STATUSES` (live on main since
`46e6d5db`) parks `For Client Approval` / `For SMM approval` / `For Kasper
approval` by name before any bucketing, and the partition routes tweak-family
rows to NEEDED before the past-due check. **The Workload view already
implemented the owner's ruling exactly.** Measured live at closure: 132
past-due active-type rows on the editor's plate = 107 approval-wait + 6 Tweak
Needed (5 of them with a trailing-space status string, caught only by
`wlNormStatus`'s trim) + 19 Todo/In Progress. The page shows ~19 overdue and
6 needed; the three-digit number is **Linear's own UI**, which calls every
non-terminal past-due issue overdue and which we do not render.

Closed with: `test/workload-overdue-ruling.js` — executes the real predicates
and the real partition loop (approval parked, both tweak spellings → NEEDED
and never overdue with inversion proof, late Todo/In Progress → overdue,
future-dated → planned), so the ruling survives refactors. Separately, 11 of
the 19 actionable rows were cancelled on owner instruction the same day (6
phantom "Video 1" placeholders, 5 no-footage briefs), taking the page's real
overdue for this editor to ~8.

Not taken (recorded as the only lever left): making LINEAR's own boards agree
with the ruling would mean clearing/adjusting due dates when an issue enters
an approval state — a production workflow change (n8n) that needs explicit
owner go-ahead per house rule.

## Full-estate audit — 2026-08-27 01:20 UTC (fresh-eyes pass, owner-requested)

Everything below measured live in one sweep: 5,445 deliverable rows, 8,918
cards (407 in a live status), 349 active batches.

| check | result | verdict |
|---|---|---|
| duplicate `linear_issue_uuid` across all deliverables | **0** | clean |
| duplicate `identifier` | **0** | clean |
| open deliverables with dangling card refs | **0** (8 apparent were samples-surface cards, a different table) | clean |
| drift-capable half-linked live cards (issue HAS a native row) | **3** — the same residue item 48 already tracks; no growth | matches ledger |
| live cards linked to a CANCELLED deliverable | ~~4~~ **0** | CORRECTED 2026-08-27: false positive — that check's terminal set missed capital-A `Archived` (the same class the half-link check was corrected for mid-audit). Verified live: all four cards are Archived and all four deliverables canceled — dead pairs, nothing to repair |
| active parentless batches (invisible to Create Post) | **6** — down from 26 at the #1152 dry run | improving |
| active childless batches older than a week | 5 | husks, cosmetic |
| duplicate (client, name) active batch pairs | 31, most on the TEST client's drills | cosmetic |
| batch parents imported as their own open child | **75** | item 50 |

Last week's ledger items, verified against the LIVE app (not the repo):
45 columnar cache (schema 3 serving), 46-47 deep links, 48 half-links (3, no
growth), 49 batch-team veto (all three layers live: v7 function body checked in
the database, gateway v54 attested, picker rule in the served page). The intake
cap (50), sheet-first fallback, refusal-advice mapping, warm-boot single load
and the audit drain are all in the served index.html. Every one of these ships
with an executed regression test in the 308-suite gate, green on main.

Recurrence sources that remain open, with owners:
- item 50 (parents-as-deliverables) — count half fixed same day; display half
  below;
- item 51 — CLOSED 2026-08-27 (owner ruled; view already compliant; pinned by
  `test/workload-overdue-ruling.js`);
- ~~11 phantom/no-footage issues~~ — CANCELLED 2026-08-27 on owner go-ahead:
  VID-13313/13316/13329/13337 + VID-13348/13354 (phantom "Video 1"
  placeholders) and VID-12977/12978/12980/12984/12985 (no-footage briefs, note
  left on their parent VID-12967); mirror propagation VERIFIED 13:18 UTC —
  all 11 `active=false` in `workload_issues` (the board reads `active=eq.true`,
  so they are off the Workload) and `canceled` in the deliverables mirror; the
  editor's actionable past-due stood at 3 real items after sync;
- ~~4 stale cards~~ — false positive, corrected in the table above (all four
  were already archived against canceled deliverables);
- ~~6 orphan batches (existing recovery SQL applies)~~ — re-diagnosed
  2026-08-27 13:20 UTC after the phantom cancellations synced: **5 remain and
  none is a batch that forgot its parent.** Every parentless row inside them
  is PARENT-SHAPED (title `<client> · <date>`, the batch-parent naming
  convention): one is 3 TEST-client sample drills in backlog; three hold 2-3
  duplicate parent issues and no live children at all (the two conflicting
  "candidates" the recovery dry-run refused to choose between are the
  duplicates themselves — for one client, the only children either duplicate
  ever had were the two phantom placeholders cancelled today); one holds TWO
  complete families (two parent issues, each with one real sub-issue in
  approval) which a per-team parent map cannot express — one video slot.
  Writing a parent map into any of these would bless one arbitrary parent, so
  the recovery SQL's refusal stands.
  **CORRECTED 2026-08-27 16:05 UTC, at the point of acting on owner-approved
  cleanup:** the "duplicate, cancel them" half of this entry was WRONG. The
  pre-cancellation safety check (children looked up estate-WIDE, not inside
  the five batches) found every one of the eight candidate parents heading a
  real family somewhere else — posted, scheduled and client-approval children
  included. The earlier "no children" reading was scoped to the five batches
  themselves, and the real families live in OTHER batches. Nothing was
  cancelled. What these five batches actually are: B1 groupings that collect
  several REAL parents' imported rows into one batch that can never take an
  append (no unambiguous parent map) — a cosmetic container, not a pile of
  fakes. The parents' own families flow normally elsewhere; item 50's
  display gate already keeps the imported parent rows out of the overdue
  lanes. No Linear-side repair exists that is not destructive; leave them.

## 52. [found 2026-08-27 15:00 UTC, live] The gateway's video assignee pool still contains a departed editor

Every assignee-less video create today (three of three) was auto-assigned to
the editor `WL_INACTIVE_EDITOR_IDS` has excluded from the FRONTEND rosters
since he left — because `autoAssigneeForIntake` draws its pool from
`team_members` rows with `active = true`, and his row still carries it. Under
the freest-editor rule a departed editor is unbeatable: he holds zero live
briefs forever, so ALL auto-assigned work funnels to a queue nobody reads.
This silently defeats the browser/gateway count symmetry item 50's fix
exists to protect — the browser names one suggested editor, the gateway
assigns a ghost.

Found while investigating an SMM's stale-tab report; surfaced because the
three ghost-assigned issues were visible in Linear. The one live one was
reassigned by hand (its two cancelled siblings needed nothing). Yesterday's
14-video intake went to a real editor (explicitly routed), so the blast
radius measured today is exactly those three.

**Repair is one owner SQL** (the table is not anon-writable, correctly):
deactivate the departed editor's `team_members` row, keyed by
`linear_user_id`. Readback should show 3 active video editors. Recurrence
guard: the pre-flip health check now carries a roster-hygiene line — no
`team_members.active=true` row may match an id in the frontend's
`WL_INACTIVE_EDITOR_IDS`; check it whenever someone leaves the team, since
nothing reconciles the shipped exclusion list against the table.

## 53. [found 2026-08-28 14:50 UTC, live] linear-inbound applies REassignment but never UNassignment

Found executing item 52's widened repair (unassigning 25 live video rows
held by inactive members, owner-ruled over reassignment): all 25 Linear
unassign events were DELIVERED — `mirror_in_status_change` rows 14:47–14:49Z,
webhook healthy — yet zero native `assignee_id` values cleared. Mechanism:
Linear omits null relations from webhook issue data, so an unassigned issue
arrives WITHOUT an `assignee` key, and the handler's `has(issue, "assignee")`
gate (supabase/functions/linear-inbound/index.ts, the assignee branch) never
fires. Setting a NEW assignee includes the key and applies; clearing one
never does. The asymmetry was invisible for the same reason as item 52's
class: nothing renders an inactive member's queue.

Post-video-flip this branch is detect-only for both teams, so the gap stops
mattering operationally — which is exactly why it is recorded: any future
team that is Linear-authoritative (or a rollback that makes one so) inherits
it. Candidate fix if ever needed: also key on `updatedFrom.assigneeId`
being present while `data.assignee` is absent — that pair IS the
unassignment signal Linear does send.

The 25 rows themselves were repaired by owner SQL (clear `assignee_id` for
live rows joined to `team_members.active=false`), recorded in
`PRE_FLIP_HEALTH_CHECK.md` item 11. Five of the 25 were archived TEST drill
fixtures whose native rows still carry live statuses — a separate small
cleanup candidate, harmless meanwhile.

## 54. [found 2026-08-28 ~15:00 UTC, live] A crash window in the writer manufactured a permanent "explicit review" badge

An SMM reported a calendar card wearing "Source repair receipt missing;
explicit review required" that survived every reload. Root: the
gateway-before-source writer's success path deletes the journal receipt
BEFORE the display-cache checkpoint cleanup; a tab death between the two
leaves a checkpoint with consumed receipts, which the resume path held —
correctly fail-closed, but with no exit: background merges carry the
residue onto every fresh row, the cache writer re-injects it into every
write, the TTL is waived for repair caches, and (since 2026-08-26) quota
eviction spares them. The failure copy promised reload would resolve it;
for this class it never could. Diagnosed by a six-agent workflow, every
claim adversarially re-derived twice; server-side sweep proved blast
radius of exactly one card / one browser / one principal, all of whose
writes HAD committed (native, source, and Linear all agreed).

SHIPPED same day: resume now HEALS the one provably-safe shape — a
receipt-less checkpoint with no held edits whose server `updated_at` is
strictly newer than its stamp (updated_at equals the stamp at checkpoint
time, so strictly-newer proves a commit landed after the repair began;
the native half precommitted before any checkpoint exists, so the worst
a drop can cost is the legacy-source half of an already-committed
write). Held edits, checkpoint-era stamps, unparseable stamps, and
other principals all keep the fail-closed hold. The heal persists
through the cache writer's `clearRepairIds` path (a plain write
re-injects the residue) and announces itself as
`cache_only_repair_superseded`. The failure copy now tells the truth.
Executed in `test/write-ui-writer-durability.js`.

STILL OWED: (a) the root ordering — consume receipts AFTER the cache
cleanup so the crash leaves a replayable orphan receipt instead of a
badge (deferred: the success path is long and heavily interleaved, and
the heal makes the residue self-clearing; reorder deliberately, not on
flip day); (b) `cache_only_repair_*` diagnostics are localStorage-only
(`window.peekWriteUiQueueDiagnostics()`) — no server side ever sees
them, so the owner learns of holds only when a human speaks up; (c) no
in-app review affordance for the surviving held case.

---

## 55. [found 2026-08-29, live] The shadow audit is red because writes owed to Linear are not landing — and the flip is not why

**This entry replaces an earlier draft of item 55 that was wrong.** That draft
claimed the F1(video) flip invalidated the shadow audit's comparison, and
proposed tolerating post-flip differences per team or re-baselining to gate on
growth. Both the premise and the remedy were false, and the remedy would have
silenced the audit's entire outbound classifier. A reviewer (Codex, PR #1176)
caught it; two independent agents then re-derived the answer from the code and
both confirmed the correction at high confidence. The wrong draft is not kept
here because it was never merged — but it is named, because the mistake is
instructive: an audit that is inconvenient is not thereby meaningless.

**Why the flip is irrelevant to this audit.**
`scripts/b4-outbound-shadow-audit.js:429` hardcodes
`data.prodAuthority = { video: 'syncview', graphics: 'syncview' }`, and
`git log -L 429,429` on that file returns exactly one commit — 9ee7743c,
2026-07-12 (PR #799). The line predates the graphics flip (2026-08-16) and the
video flip (2026-08-28) alike, and `assertSafe` validates the live
`prod_authority` but never feeds it to `buildPlan`. The audit has been running
post-flip semantics on both teams for six weeks. Telemetry confirms it: at the
flip the RECONCILER's video figures moved sharply (outbound 0 / inbound 162 at
23:10Z, to 23 / 0 at 00:04Z) while the audit's video count did not move at all —
it was already 22 before the flip.

**What an outbound diff actually means.** In `classifyOutboundDeliverable`
(`linear-deliverables-reconcile-lib.js:549-634`) every `addReal(...)` passes the
SyncView value as `expected` and the Linear value as `actual`, and each one
queues an `outbound_intent` writing SyncView's value TO Linear; the result
carries `direction: 'outbound'`. The inbound classifier is the mirror. So an
outbound diff is **a write SyncView owes Linear and has not delivered** — not a
Linear-side edit the native store ignored. With
`linear_outbound_enabled {"mode":"live"}`, that is a failure, not a steady state.

**The evidence that writes are genuinely lost, not merely pending.**
- `outbound_comment_missing_in_linear` (7) is computed from `mirror_outbox` rows
  at `status='written'` carrying a Linear-returned `comment_id` that Linear does
  not have (`reconcile.js:534-537`). A lost write by definition.
- `mirror_outbox` holds 14 rows stuck permanently at `status='failed'`,
  operation `archive`, from 2026-08-05..07, against 17 `outbound_archive_mismatch`.
- Some operations were never attempted at all: 6 `written` priority rows in all
  history (the last on 2026-07-12) against 5 open priority intents; 3 `written`
  parent rows ever against 10 parent intents.

**Scale and trend.** Latest run (`deliverable_events` id 88907, 2026-08-28
17:44Z, pre-flip): 99 unexpected divergences — 77 graphics, 22 video —
decomposing as 96 `outbound_*` each carrying a write intent, plus the 3
`attribution_claim_mismatch` of item 56 (which carry none). The four-day trend is
**68 → 73 → 91 → 99, growing**. The audit has run 40 times since 2026-07-18 and
has never once been green, so "it goes red every run" describes a condition six
weeks older than the flip.

**Reading note (not a defect):** `unexpected_divergences_by_reason` is truncated
to the top 8 by `topReasons` (`production-shadow-audit.js:22`), so it sums to 89,
not 99. Do not read a reason's absence from that map as its disappearance. Also,
the sample's `identifier` is the NATIVE identifier column, so some graphics rows
print with a `VID-` prefix; the per-team split is still sound.

**THE REPAIR (not done): a live outbound-delivery investigation, not a
baselining exercise.** Start with the two largest classes,
`outbound_due_date_mismatch` (24) and `outbound_archive_mismatch` (17): for a
handful of sample rows establish whether the SyncView edit ever produced a
`mirror_outbox` entry, whether it drained, and whether it failed. The 14 stuck
`failed` archive rows and the 7 phantom-written comments are concrete starting
points.

**Explicitly do NOT** tolerate these per team — that silences the whole
classifier. On growth-gating: the rule is real and ratified, but for the
RECONCILER's detect-only counter, whose unclearable population is rows edited in
LINEAR (`FLIP_BUG_LEDGER` A4, `PRE_FLIP_HEALTH_CHECK` item 1). This audit's
population is the opposite case — rows edited in SyncView whose writes are owed
outward — and provably contains lost and never-attempted writes. If a growth rule
is ever adopted here it must first separate genuinely unclearable Linear-side
residue from writes still owed, and gate absolutely on the latter.

## 56. [found 2026-08-28, corrected 2026-08-29] The GRA-7042/7043/7044 claim mismatch is repair residue, not an open attribution question

**This entry replaces an earlier draft that guessed.** That draft called the trio
"suspected to belong to a former client whose slug changed" and proposed either
re-attributing them or excluding them by identity. Both branches were wrong, and
the same reviewer caught it.

**Their attribution is not in question and needs no roster investigation.** The
answer is already recorded in this register: see item 18's mixed-family ruling
(a child's own project outranks its parent's) and item 33's ruling that the three
similarly-named client slugs are three genuinely different ACTIVE clients. The
live rows already agree — `state: resolved`, `repair_required: false` — and
Linear confirms it independently: the trio's project differs from their parent
GRA-7034's project, which is exactly the mixed-family shape item 18 settled.

**The proposed "exclude by identity" remedy was also forbidden**, independently
of the above: the 2026-08-27 owner ruling recorded in `scripts/f200-attribution.js`
is to attribute former clients too, "that way we have a clean database".

**Do not re-open item 18 over this.** Its mixed-family `conflict` was fixed in
the resolver — `selfAttributed` plus the exemption that skips a parent/child pair
where each settled from its own project. A parent and child in different projects
no longer raise a conflict, so this trio is not that bug recurring.

**What actually still differs is the SHAPE of the durable stamp, not its answer**
— provenance keys left by the 2026-08-24 owner repair which the current
classifier does not reproduce, so the audit's claim comparison flags a
difference. That is cosmetic residue of a repair, and it matters only because
item 55's investigation wants a clean count.

**THE REPAIR (not done):** reconcile the stamp shape so a repaired row's
provenance matches what the current classifier writes, then confirm the three
drop out of the audit's unexpected count. Do not touch their attribution.

## 57. [found 2026-08-29, live] The video flip did not take the sealed §4 rollback capture that G5 put on its checklist

**This entry replaces an earlier draft that under-scoped the obligation.** That
draft read `FLIP_BUG_LEDGER` §2-G5 as owing a behavioural drill and proposed
running the service-only TEST drill. G5 is about something else entirely, and as
written the entry could have been closed by a passing drill while the real hazard
stood. The reviewer caught this too.

**What G5 actually owes: a source-exact SEALED CAPTURE, plus a `ROLLBACK.md`
update — not a behavioural proof.** A drill neither creates the restore bundle
nor updates the version an operator would actually restore from.

**Why the flip made it worse.** The flip-day `deploy-onboarding-edge-functions`
dispatch redeployed four Section 4 functions, and that workflow contains no
capture step at all — zero occurrences of rollback/capture/bundle/seal. The
newest sealed bundle was already documented ten releases behind (`ROLLBACK.md`
line 115, captured v46 against a live v56); a redeploy bumps the version even when
byte-identical (`EXECUTION_LOG.md`), so it is now at least eleven behind, and no
deployed-versions record was written for the flip-day dispatch at all — the new
live versions are recorded nowhere.

**THE REPAIR (not done):** run the F27 edge-source capture per
`F27_INSTALL_RUNBOOK.md` for the Section 4 function set; upload and round-trip
the sealed bundle to the private Drive as `EXECUTION_LOG.md` describes; then
update the Section 4 provenance row at `ROLLBACK.md` line 115 with the new live
versions AND the now-current bundle, marking every earlier bundle stale.

**CLOSING CONDITION, stated so this cannot be closed short:** this entry stays
open until `ROLLBACK.md` line 115 names a bundle whose captured `production-write`
version equals the live version. A green deploy attestation does not close it —
the flip-day deploy attested 12/12 functions PASS at the pinned SHA with the
expected JWT posture, and honestly reported its own drill outcome as PENDING.
That is a fingerprint proof (the right source is live), not a restore proof.

**Durable defect worth fixing separately:** `ROLLBACK.md` line 115 instructs the
reader to "put it in the video-flip checklist", but no video-flip checklist
document exists anywhere in the repo — grepping that phrase returns only
`ROLLBACK.md` itself. The instruction pointed at nothing, which is why the
capture was missed. Either create that checklist or move the obligation into a
document the flip actually runs from.

## 58. [found 2026-08-29 01:15 UTC, live] The flip-day B1 import tripled the reconciler's attribution backlog, and the repair tool for it is now unreachable for video

The one-time full-window B1 dispatch at the video flip (run 33222018678,
`changed_since=2020-01-01T00:00:00Z`, apply on) was reported at the time as a
clean no-op because it created **zero** new `deliverables` rows. That reading
was incomplete. It created no rows, but it pulled a large previously
out-of-scope population INTO the reconciler's checked set, and the counters
moved sharply across the boundary:

| reconciler summary | 23:10Z (pre-import) | 00:04Z and 01:03Z (post) |
|---|---|---|
| `entities_checked` | 5848 | **7498** |
| `batches_checked` | 708 | **1706** |
| `attribution.repair_required` | 2 | **779** |
| `attribution.by_state` | resolved 5191, provisional 2 | resolved 5214, **needs_attribution 777**, provisional 2 |

**Severity, stated carefully.** This is NOT client-visible damage and no row
lost data. Every `deliverables` row still carries a `client_slug` — a direct
check for null/empty returns zero rows — and the F40 readiness gate passes on
BOTH teams with zero unprovable rows, so no card lost its due date or its
editability. What grew is the reconciler's own bookkeeping over Linear issues
it can now see and cannot attribute to a client. It is noise in a detect-only
counter, not lost work.

**Why it still matters.** A counter that jumps 2 → 779 destroys the baseline
that item 55's investigation and PRE_FLIP_HEALTH_CHECK item 1 both depend on:
"unexplained growth" is unreadable against a number that just moved by two and
a half orders of magnitude for a known reason. The explanation must be written
into the baseline or the next reader will either chase it or ignore a real rise.

**And the repair path for it is blocked for video.** The F200 attribution
repair lane hard-requires Linear authority. Video no longer has it, so the
video share of the backlog cannot be cleared by the existing tool at all — the
tool and the flip are now mutually exclusive. This is the same shape as the B1
`mode=full` lane, which also refuses to run post-flip by construction; the
difference is that one was designed and this one was not noticed.

**THE REPAIR (not done):**
(a) Characterise the 777 — are they archived/historical issues, batch parents
    with no project mapping, or genuinely unattributed live work? The answer
    decides whether this is permanent residue to baseline away or a real gap.
(b) Re-baseline `attribution.repair_required` at 779 with the cause recorded,
    so growth-gating stays readable.
(c) Decide what replaces the F200 lane for a SyncView-authoritative team, or
    record explicitly that post-flip attribution repair is manual — do not
    leave a tool in the tree that silently cannot run.

**Method note, recorded because it nearly went the other way:** this was found
by a post-flip audit whose own briefing (written by me) asserted the import was
a clean no-op. Two verifier agents rejected that premise as false and went to
the telemetry instead of accepting it. The briefing was wrong; the check
survived it only because the verifiers were instructed to refute rather than
confirm. A verification pass that trusts its own framing would have missed this.

## 59. [found 2026-08-29 02:00 UTC; **FIXED 2026-08-31 in `1ce02ff6`, verified 2026-09-02**] The calendar kept offering Linear link controls the flip had already sealed — the seal was right, the re-render never happened

After F1(video), calendar cards still render the PRE-flip Linear link affordances
— the orange "needs a Linear link" warning and the pencil edit button — on a
fully settled page, for the life of that page.

**The seal logic is correct; only the timing is wrong.** On a cold load the
calendar paints its cards before `_writeUiRefreshAuthority()` resolves, and
`_writeUiLinkSlotSealed()` deliberately fails OPEN while the snapshot is null
(index.html:24883-24890 — documented as acceptable for first paint). The bug is
that when the authority read DOES land, nothing re-renders the calendar body, so
the fail-open markup is not a flicker: it persists.

Measured on a settled page: first card paint at t=11606ms with warn=10 /
pencil=12 / cross=0; authority resolved 19ms later at t=11625ms; DOM still
warn=10 / pencil=12 / cross=0 at t=17599, 19604, 21608, 23612, 25615ms and again
at t=31455ms — roughly twenty seconds of a quiet page — while
`_writeUiLinkSlotSealed('video')` and `('graphic')` both returned true
throughout. A single pure `_calRenderBody()` produced the correct sealed DOM
immediately (warn=0, pencil=0, cross=12), proving the builder is right.

**Structural cause, independent of harness timing:** `_writeUiRefreshAuthority`
has 7 call sites in index.html and none re-renders. The boot-time read is a side
effect of `_writeUiResumeLegacyQueues` (:61360); on resolution it calls
`_writeUiLegacyHydrateConfirmedCacheAfterAuthority()`,
`_calPruneLinearMetaForAuthority()` (:31817) and `_calHydrateLinearMeta()`
(:31790) — all in-memory cache updates, no render. The authority read is issued
roughly 8 seconds and two chained round trips after the card data, so in
production the data normally wins that race regardless of network speed.

**No data can be harmed, which is why this is not urgent.** Both write gates
hold: the edit gate refuses on the cached snapshot (:36714) and the commit gate
re-reads authority live before writing (:36794), so a click on a stale control
produces the "Video links are set automatically now" notice rather than a
half-linked card. Verified during the same audit.

**Why it still matters:** the interface invites people to do something it will
then refuse — precisely what the 2026-08-25 seal shipped to prevent. And it is
not new tonight: graphics has shown the same stale affordances since its own flip
on 2026-08-16; the video flip merely doubled it onto every card's video slot.

**THE REPAIR — DONE, and this line said otherwise for two days.** Shipped in
commit `1ce02ff6` ("Fix item 59: re-render the calendar/samples grids when
authority resolves"). Verified in `index.html` 2026-09-02: the post-authority
hydrate path now compares a `JSON.stringify(authority)` signature against
`_writeUiLastRenderedAuthoritySig` and re-renders only when the value is NEW
information, gated on `currentNav` so only the visible surface repaints, and
deferred to the pending-render lane when `_calIsCalBusy()` / `_sxrIsBusy()` — so
a background repaint cannot drop a focused input or an open menu. Both the
calendar and Samples grids are covered. Pinned by
`test/write-ui-writer-durability.js`. The fail-open first paint is intact: the
seal never became a blocking dependency of the first render, which is what the
original text asked for. **The description below is kept as the diagnosis, not
as outstanding work.**

The original repair note read: in the post-authority hydrate path
(index.html:31790-31822) call the calendar re-render once the authority read
resolves, or move the authority read ahead of the calendar data load so the first
paint is already sealed. Prefer whichever keeps the fail-open first paint intact
for the genuinely-unknown case — the seal must not become a blocking dependency
of the first render.

**Provenance:** found by the post-flip audit (58 agents, 9 dimensions). It was
the ONLY one of sixteen raised anomalies to survive three-lens adversarial
verification; the other fifteen — identifier nulls, mismatched VID- rows,
unmapped assignees, n8n feed dips, a workload label gap, counter baselines — were
each chased with real queries and found expected-by-design or already recorded.

---

## 60. [RESOLVED 2026-08-30 — and the original diagnosis below was wrong in three ways; read this correction first] The Production tab (prod=1) hangs loading real content

> **CORRECTION, 2026-08-30. Everything below this box was written under a
> depleted budget on 2026-08-29 and is substantially WRONG. It is kept, not
> deleted, because the way it was wrong is the useful part — every claim in it
> was honestly measured, and the measurements were still misleading. The
> corrected account:**
>
> 1. **There is no hang, and no app bug.** The line-114 total stall is an
>    artifact of the agent sandbox this was diagnosed in. That container's
>    egress proxy does not relay the BROWSER's traffic — only Node and curl
>    reach the network (`qa/sxr_courier_lib.js` documents exactly this). Every
>    Supabase request from the page died `net::ERR_CONNECTION_RESET` after
>    ~25s, times the 3 retries in `_prodRestPage`, which overruns the test's
>    30s budget before `.prod-error` can render. Tunnelling the page's fetches
>    through Node and changing nothing else: the tab loads in **4.7s, 1414
>    rows, zero page errors, zero console errors**, against live data under the
>    real post-flip authority.
> 2. **"Confirmed on main" proved nothing.** The clean-worktree run reproduced
>    identically because the sandbox blocks browser egress on EVERY branch. The
>    conclusion it licensed — "not this PR's fault" — was right; the conclusion
>    it did NOT license — "therefore a live regression on main" — is the one
>    that got written down and then repeated in a PR comment. A control that
>    cannot distinguish the two hypotheses is not a control.
> 3. **The authority-shape hypothesis is DISPROVEN, by falsification.** The
>    authority read was stubbed to all four shapes and the page reloaded under
>    each: live `{syncview,syncview}` 4710ms/1414 rows; `{linear,syncview}`
>    4688ms; `{syncview,linear}` 4784ms; `{linear,linear}` 4666ms — all zero
>    errors. Authority shape has no effect on this load path.
> 4. **`data-boot-nav` staying empty was a red herring** — `navTo()` and
>    `render()` REMOVE that attribute on every successful route.
>
> **The line-163 failure is real, and it is a stale test assertion, not a
> regression.** `.prod-parent-link` has one render site and it calls
> `_prodOpenDeliverable(parent.id)`, producing `?prod=1&d=…`. `_prodOpenBatch`
> is dead code, so `?batch=` is unreachable from the UI. Commit `c4c28479`
> (2026-07-06) made that change; the assertion has been unsatisfiable for seven
> weeks and only *executes* when the first row happens to have a parent.
>
> **Why it fired on 2026-08-29, and this is the part worth keeping:** the video
> cutover PR set `B1_STRAY_CATCHER: '1'` unconditionally in the B1 refresh
> workflow. Stray mode's filter is "active ⇒ import", so the 00:00Z run on
> 08-29 inserted **392** legacy Linear issues (measured: 392 incremental events
> in that ten-minute window, all inserts; the same window on 08-25/26/27/30 has
> one). Among them VID-164, a 2023 issue with `due_date 2023-02-03` and status
> `todo` — the only row in the whole projection with `due_date < 2024 && status
> = todo`, so it now sorts first, and it has a parent. **Video flip → stray
> catcher becomes standing → 392 legacy imports → a 2023 issue tops the list →
> a seven-week-old dormant assertion finally runs.** The flip was causal, but
> through DATA, not through code.
>
> **And there is no evidence main's `production-polish` is red at all:**
> `git diff 4f650840 origin/main -- index.html docs/syncview-design/
> package.json` is EMPTY. The last green run tested byte-identical files; no
> run exists since only because every later merge was docs-only and the
> workflow is path-filtered.
>
> Fixed in `docs/syncview-design/tests/prod-readonly-smoke.js` — the assertion
> now checks what the control actually does. Verified: unmodified test fails at
> line 163 exactly as CI run #58 did; fixed test passes end to end.
>
> **Method lesson, for `FLIP_BUG_LEDGER` §4.** Executing the code is necessary
> and was not sufficient here. Three separate measurements (the standalone run,
> the clean-worktree run, the two-stopping-points "race") were all real and all
> pointed the wrong way, because none of them controlled for the *environment*
> doing the measuring. Before concluding that live production is broken from a
> sandbox result, prove the sandbox can observe a WORKING system — the falsify
> step here was one authority-stub reload, and it would have cost minutes.

*Original 2026-08-29 entry, retained as written and now known to be wrong:*

Discovered by accident while chasing a suspected regression in PR #1177
(the item-59 fix): production-polish CI failed identically on two different,
verified-correct pushes of that PR. Before assuming a third theory, the same
fast lane was run against a clean checkout of unmodified `main` (a
git worktree of `origin/main`, untouched), against tonight live backend.
**It failed identically.** This rules out PR #1177 entirely -- confirmed by
running the exact same test twice, once against the fix, once against main,
both producing the same five-suite failure signature.

**What is confirmed:**
- `node docs/syncview-design/tests/prod-polish-gate.js --lane=fast` fails the
  same five suites on both `main` (worktree, clean) and the PR branch:
  Production structure subset, Production read-only smoke, Production comment
  thread, Production accessibility/focus, Production layout polish.
- A direct minimal repro (bypassing the test harness, driving the real app in
  a real browser by hand) shows: the Production shell BOOTS cleanly --
  `#prodRoot` exists, the sidebar/nav renders correctly with real markup --
  and there are **zero page errors and zero console errors** over an 8-second
  observation window. The data-dependent content area (`.prod-row`,
  `.prod-board`, `.prod-detail`, or even `.prod-empty-state`) never appears.
  `document.documentElement.getAttribute('data-boot-nav')` stays empty the
  whole time.
- `Production write gateway` and `Production boot budget` (two of the seven
  suites in the fast lane) both PASS clean. Whatever is stuck is specific to
  the read/list-loading path, not the write gateway or the initial boot.
- `main`'s own last CONFIRMED green run of this exact CI workflow
  ("Production polish gate") was 2026-08-28 20:49:44Z -- **before** the video
  flip at 23:54:16Z (`flag_flips` id 89). There is no green run of this
  workflow against post-flip `main` on record. The timing lines up with the
  flip as the likely trigger, but this is circumstantial, not proven --
  nothing in tonight's investigation traced the hang to a specific line yet.

**What is NOT yet known:** the actual root cause. This needs someone to trace
`_prodLoadData` (index.html, ~line 53833) and whatever it awaits, with the
real live backend in front of them, to find exactly where the promise chain
stalls -- silently, since nothing throws and nothing logs. `PROD_AUTHORITY_FLAG_KEY`
(~line 46113) and the loader's own handling of `prod_authority` now reading
`{"video":"syncview","graphics":"syncview"}` (nothing Linear-authoritative,
a state that did not exist before tonight) is the most obvious place to look
first, given the timing, but this is a hypothesis, not a finding.

**Severity, read carefully rather than assumed:** the rendered shell carries
a `Preview - read-only` chip, and everything about this surface's own test
infrastructure (visual-parity packets, the Production Tab Checklist in the PR
template, `docs/syncview-design/**`) reads as an internal design-QA / Linear-
parity preview surface, not the tool editors use for daily client work --
that tool is the Calendar/Samples surfaces, which were verified working
throughout tonight's flip (real writes landing, zero error events, F40 gate
passing). This was NOT independently confirmed by opening the real deployed
site as a signed-in user tonight, only by this automated local reproduction --
so treat "not the daily tool" as the working assumption, not a certainty, and
have the first person to pick this up confirm it against the live deployed
`?prod=1` page before treating it as low-urgency.

**THE REPAIR (not done):** trace `_prodLoadData`'s promise chain to the exact
stall point with live data in front of a debugger; determine whether it is
authority-shape-related (per the hypothesis above) or something else that
happens to correlate in time; fix; add a regression assertion so a silent
hang like this fails loudly (with a message) rather than as a bare 30-60s
selector timeout in CI, which is what cost real time tonight tracking it down.

**Addendum [2026-08-29 13:33 UTC]:** Samples E2E nightly run #58 (the first
nightly run on `main` since PR #1175 merged, sha `5f415ec7`) failed the
`production-preview-smoke` job with a *different* symptom than every prior
observation of this bug: not the total hang at `.prod-row, .prod-empty,
.prod-error` (readonly-smoke.js:114), but a later failure —
`Batch detail did not write a stable ?prod=1&batch=... URL`
(readonly-smoke.js:163) — meaning that run got past the list load, the detail
open, and the batch-parent-link click before failing. Re-ran
`node docs/syncview-design/tests/prod-readonly-smoke.js` standalone just now,
same branch, same live backend: it reproduced the *original* total hang,
timing out at line 114 exactly as before. Two different stopping points on
two runs of the same unmodified test against the same live data is more
consistent with a race (the existing async-authority-read hypothesis above)
than with a second, distinct bug — but that is a read of the pattern, not a
proof, and the line-163 failure has not itself been root-caused. Filed here
rather than as a separate item because opening a second item without knowing
whether it is one bug or two would fragment the trail; whoever does the
debugger trace above should treat both stopping points as candidate symptoms
of the same stall until proven otherwise.

---

## 61. [found 2026-08-29 13:33 UTC, live] Two Linear-write probes now hit `[no-input]` on the video slot — correct post-flip behavior, stale test, and a rollback-coverage gap worth naming

`qa/probes/sxr_linear_deep.js` and `qa/probes/cal_linear_deep.js` (fixed for
the write-gateway rework in PR #1175, merged, confirmed working in nightly
run #58 on every assertion PR #1175 touched) still carry their *original*
clear/re-link/move assertions for the video Linear slot, written when video's
Linear links were still editable through the legacy input. Video flipped to
`syncview` authority on 2026-08-28 23:54:16Z (`flag_flips` id 89). Run #58
shows both probes now failing three-of-four assertions each on that section:

- `sxr_linear_deep.js`: pass=17 fail=3 — `cleared the video Linear slot via
  the real input` → `[no-input]`, `__CLEAR_LINK__: DB column emptied`,
  `re-linked sample A` all fail.
- `cal_linear_deep.js`: pass=16 fail=4 — the same three, plus `move relocated
  the link: B owns it, A cleared`.

**Confirmed mechanism** (index.html): both probes call
`_sxrLinearEdit(cid, 'video')` / `_calLinearEdit(pid, 'video')` directly
(sxr_linear_deep.js:71-73, mirrored in cal_linear_deep.js), then look for
`.cal-linear-input` in the DOM. `_calLinearEdit` (index.html:36719) and
`_sxrLinearEdit` (index.html:57311) both check `_writeUiLinkSlotSealed(which)`
first; when sealed they call `showNotify(...)` with the "links are set
automatically now" copy and `return` immediately — the input element is never
created. Every downstream step in both probes (`set.call(inp, ...)`,
`_sxrLinearCommit`/`_calLinearCommit`) depends on that element existing, so
one seal check fails all three-or-four dependent assertions in a cascade.
This is the shipped 2026-08-25 seal working exactly as designed — the same
mechanism item 59 is about, applied correctly here. **Not a bug, not
client-visible, no data at risk.**

**Why it's still worth an entry, not just a shrug:** Sidney's plan (stated
2026-08-28) is to keep Linear as a live rollback path for roughly two weeks.
If authority ever flips back to `linear` for either team during that window,
the exact code path these assertions exercise — real input, clear, re-link,
move-on-conflict — is the one that would need to work correctly again, and
right now nothing in CI would catch a regression in it, because both probes
only ever run under today's `syncview` authority. Deleting or loosely
patching these assertions to just tolerate `[no-input]` would silently drop
that rollback-path coverage rather than preserve it under a different label.

**THE REPAIR (not done):** don't weaken the existing assertions — split the
coverage instead. (a) Before the clear/re-link/move block, force
`prod_authority.video` (or whatever local override the harness already uses
for authority in tests, if one exists — not checked yet) to `'linear'` for
the probe's duration, so the real-input path keeps getting exercised as
rollback-readiness coverage, restoring it to what these assertions actually
verify today; (b) add one new short assertion, run under real `syncview`
authority, that calls `_sxrLinearEdit`/`_calLinearEdit` on the video slot and
asserts the sealed notice fires and no `.cal-linear-input` is inserted — the
positive-path confirmation of the item 59 seal that nothing currently checks
in these two probes. Neither half was implemented tonight — budget was spent
confirming the mechanism and writing this up, per standing guidance to file
rather than force a fix at this hour.

**Applied, not live-verified, 2026-08-31 (commit `12162251`):** both halves
landed in both probes. (a) stubs `_writeUiRefreshAuthority` and
`_writeUiAuthoritySnapshot` (the exact two functions `_calLinearCommit`'s
live seal check and `_calLinearEdit`'s render-time seal check each call) to
`{video:'linear', graphics:'linear'}` for the clear/re-link/move block,
restored before the outbox-drain section which needs genuine authority. (b)
is a new assertion up front, under real unmodified authority, confirming no
`.cal-linear-input` is created and the shared sealed-notice copy fires.
These probes drive a real headless Chromium against the live Supabase + n8n
backend (`qa/sxr_courier_lib.js`), gated on `SYNCVIEW_STAFF_KEY`, which this
environment does not have set — so this is verified by `node --check` and a
careful trace of the exact write paths (confirmed live authority is read
only via the two stubbed functions; the move handlers write with no seal
check at all and depend on the prior re-link step, the same cascade root
diagnosed above), not by an actual green run. Next live nightly run (or
anyone with the staff key) should confirm before trusting this fully.

---

## 62. [FIXED 2026-08-30, commit `6ff6897b`] The missing-metadata banner asked staff to go and edit a team that had flipped

`_calLinearMissingForCard` had no authority gate, while the parent-linked
banner rendered one line beside it in the same block did. A card whose linked
Linear sub-issue lacks a project, due date or editor showed the orange banner
whose click opens that Linear issue "so the SMM can fill the gap" — an edit
that is detect-only on a SyncView-authoritative team and is silently discarded.
The due date it names is read natively post-flip, so a blank on the Linear side
is not even the field that matters.

**Measured 2026-08-30, hours after F1(video):** of the live non-TEST cards
carrying a link, three video sub-issues (all missing a due date) would have
shown this banner to whoever opened the calendar. Graphics carried the same
hole from 2026-08-16. Proven by executing `_calLinearMissingForCard` against
the live app with both teams sealed — it returned a video result — with the
sibling parent-linked banner returning nothing as the control, which is what
shows the inconsistency was an oversight rather than a decision.

Fixed by the gate its neighbour already had, keyed on authority rather than on
the word "video" so a rollback restores the banner with no edit. Regression
suite `test/cal-linear-missing-banner-seal.js` slices and EXECUTES the shipped
function, and pins the mixed world, today's world, the rollback, and a
non-vacuity check.

**Two things this exposed that are NOT fixed** — see items 63 and 67:
the live-refresh path that feeds this cache has no authority filter (three of
the four cache writers have one), and the harness stubs the meta webhook to a
body with no `meta` key, so the whole banner feature is invisible to every
probe in the suite. That blind spot is why this survived two flips.

---

## 63. [found 2026-08-30, MOSTLY FIXED 2026-08-30 — drain gate shipped; the source_gate lane's final disposition remains the owner's call] The legacy outbox delivers to LIVE Linear with no authority check at all

> **UPDATE 2026-08-30 (commit 7f7cec2c + review follow-up):** both drains
> (`_linearOutboxFlushRun` and `_sxrLinearOutboxFlushRun`) now take one
> authority read per drain pass and, for direct-delivery items, parse the
> `VID-`/`GRA-` team from the issue ident: a flipped team's item is
> quarantined as `flipped_team_legacy_push`, an unparseable ident as
> `legacy_issue_team_unverifiable`, and an unreadable authority flag retries
> later (fail-closed — the system writes LESS to Linear). Covered by six
> executed scenarios in `test/write-ui-writer-durability.js` and the two deep
> probes, all mutation-verified. **One deliberate exemption:** items carrying
> a COMMITTED `source_gate` pair still deliver — quarantining them zeroes the
> reconcile outcome set and `_writeUiFlushDeferredLegacyTweak` then 409s the
> client forever (`legacy_tweak_delivery_unconfirmed`), which the tier-0
> probe `ot4_t0_client_edge_conditions.js` proved. The n8n server-side gates
> remain the backstop for that lane. Whether the source_gate lane should
> deliver, quarantine, or drain-and-retire post-flip is a product question —
> still the owner's decision; the original analysis below stands as found.

`_linearOutboxFlushRun`'s direct-delivery branch (`index.html` ~31008) reads:

```js
if (it && it.transport === 'legacy_n8n'
    && (it.source_gate || it.client_link || !_writeUiRerouteUseGateway(it.client_slug))) {
    ... await fetch(LINEAR_SET_STATUS_URL | LINEAR_ADD_COMMENT_URL, { method: 'POST', ... })
    continue;   // <- never reaches the team parse or the quarantine below
}
```

**There is no authority read anywhere on that branch**, and its `continue`
skips the `VID-`/`GRA-` team parse and the `legacy_actor_unverifiable`
quarantine that sit immediately below it. Confirmed twice: once by executing a
seeded queue post-flip and recording which endpoint was actually POSTed, and
once by reading the branch independently.

Measured outcomes for a queue drained post-flip:

| item | outcome |
|---|---|
| video status, empty `client_slug` | **POSTs `linear-set-status`** |
| video status, enrolled slug | quarantined, no push (correct) |
| video comment, enrolled slug | quarantined, no push (correct) |
| client-link comment, enrolled slug | **POSTs `linear-add-comment`** — the `client_link` clause bypasses the enrolment check |
| video status, unenrolled slug | **POSTs `linear-set-status`** |
| graphic status, empty `client_slug` | **POSTs `linear-set-status`** |

The graphics row is the important one: this is not a video-flip novelty, it has
been open since **2026-08-16**, and nothing caught it. `linear_outbound_enabled`
is `{"mode":"live"}`, so these reach real issues.

**Most likely live trigger (INFERRED, not observed):** `_writeUiRerouteClients`
is populated by a fetch with a 2000ms timeout that falls back to `{clients:[]}`
on any failure. A slow flag read on a resume makes every client look
unenrolled, which selects this branch for all of them. All 41 active clients
are genuinely enrolled today, so the enrolment path itself is not the exposure
— the timeout is.

**Not fixed tonight, deliberately.** The conservative fix is one authority read
plus a quarantine-instead-of-deliver, failing closed on an unreadable flag —
i.e. the system writes LESS to Linear, which is the safe direction. But this is
the production write path to a live external system, the `source_gate` receipt
lane may legitimately need to deliver, and the owner is asleep. **This is the
first thing to review on Sunday.** Do not merge a change here without deciding
what `source_gate` and `client_link` items are supposed to do post-flip — that
is a product question, not a code one.

**What is NOT known:** whether this has already fired since 2026-08-16.
Answering it needs a Linear-side audit of status changes filtered to
n8n-webhook origin, cross-referenced against SyncView's own writes.

---

## 64. [found 2026-08-30, live, HIGH] 87 live cards show a locked video pill whose tooltip instructs an action the app now refuses

The video pill locks when `_calCompLinked` is false, rendering `disabled` with
`title="Link a Linear sub-issue first"`. Post-flip the seal makes an EMPTY
video slot render **nothing at all** (executed: `_calLinearSlotHtml` returns
`""`; pre-flip it returned the orange warn button), and `needsLinear` is false,
so the thumbnail "Link the Linear sub-issue" banner is gone too. The
instruction survives; every control that could satisfy it is gone.

**Measured 2026-08-30:** 694 non-archived cards; 91 have neither
`linear_issue_id` nor `video_deliverable_id` → **87 excluding the TEST client,
across 21 clients**, 10 carrying a scheduled date of today or later, 36 with no
linkage of any kind on either component. This is `FLIP_BUG_LEDGER` §0-2 (the
12 greyed graphics cards, #1075) recurring for video at roughly seven times the
scale — and §0-2 was marked as a pre-flip item to drive to zero.

The seal is right. The pill's instruction is now a lie. The decision is
whether the tooltip changes to say where the work must be created, or the
calendar grows a way to bind an existing card to a native deliverable.

**Cross-referenced 2026-08-31.** This is the same defect the sweep filed
independently as 87.8/87.16 (found before this entry's cross-link was made)
and already marked **FIXED** (PR #1185): one shared `WRITE_UI_NO_WORK_ITEM_TEXT`
now sits on the pill instead of "Link a Linear sub-issue first" on both
surfaces, the lock itself is unchanged, and no remedy is named because none
exists in-app — the first of this entry's two decision branches, taken. The
second branch (should the calendar grow a way to bind an existing card to a
native deliverable at all) is still open and is a product decision, not a
copy fix — that part of "the decision" stays the owner's to make.

---

## 65. [found 2026-08-30, live, HIGH] Every pending calendar-card job is now silently deleted, while the app promises it will retry them — **FIXED** (commit `3b1daa90`): the discard now tells the user how many cards were lost and for which client, and deliberately does not repeat the retry-cap copy pointing at Import from Linear (which item 66 has since sealed anyway). Four assertions added under today's `{syncview,syncview}` authority shape in `test/calendar-card-write-jobs.js` §5b, where the suite's prior coverage stopped short.

`_resumePendingCalCardJobs` discards on
`if (teams.some(team => authority[team] !== 'linear'))`. Executed with three
seeded jobs:

| authority | jobs left | resumed | user is told |
|---|---|---|---|
| `{linear,linear}` | 3 | 3 | — |
| `{linear,syncview}` (since 08-16) | 1 | 1 | nothing |
| **`{syncview,syncview}` (now)** | **0** | **0** | **nothing** |

The discard writes only to a `localStorage` diagnostic ring nobody reads, while
the partial-failure path beside it tells the user "SyncView will retry the rest
automatically next time the app is opened", and the retry-cap branch DOES
notify. So the one path that silently drops work is the only one without a
notice, and post-flip it catches 100% of jobs. This re-arms a loss mode the
estate has seen before. Minimum fix: give the discard the notice its neighbour
already has, and correct the retry promise.

---

## 66. [found 2026-08-30, live, HIGH] "Import from Linear" is unsealed and mints exactly the cards the seal exists to prevent — **FIXED 2026-08-31** (commit `30a0e2c5`): `_calRunLinearImport` now reads live video authority via `_writeUiLinkSlotSealedLive('video')`, the same call `_calBulkLinkApply` uses, and refuses the whole import (checked before the archive-ledger mutation) when video is syncview-authoritative. All three in-app recommendations of this tool as a recovery path now point at Create Post instead, which works regardless of authority state. Pinned by `test/import-from-linear-sealed.js`.

`openCalLinearImport` → `_calRunLinearImport` has **zero authority checks**. It
writes new cards carrying `linear_issue_id` / `graphic_linear_issue_id` from
pasted Linear URLs and **no deliverable ids**, so every card it creates is born
into item 64's state (pill locked, slot unlinkable) and item 67's (status write
refused). Worse, in-app copy recommends it in three places — "use *Import from
Linear* with the parent link to backfill them" — text the flip made reachable.

Sibling, same shape: `_calBulkLinkApply` IS sealed, but only at Apply, so a user
completes the whole match-and-pick dialog and is refused at the last click.

---

## 67. [found 2026-08-30, live, HIGH] A video status change on a card without `video_deliverable_id` now 409s and rolls back

Executed `_calPushStatusToLinear` on three card shapes:

| card | pre-flip | now |
|---|---|---|
| Linear URL, no native id | committed via legacy-parity lane | **409 `native_link_required`** |
| no URL, no native id | `{skipped:true}` silent no-op | **409 `native_link_required`** |
| native id | committed | committed |

In the save funnel this reaches `_writeUiReportFailure`, sets the card to
`error`, and rolls the status back. **176 non-archived cards lack
`video_deliverable_id` across 22 clients; 99 of them have a video lane that is
not Posted/N-A.** The same 409 also breaks `_calArchiveParkSubIssues` for the
88 link-only cards — the archive succeeds and the park throws, producing
"Archived, but its sub-issues were not parked" (INFERRED: the archive path was
not executed end to end).

Items 64, 66 and 67 are one story told three ways: **a card is only fully
functional post-flip if it has native deliverable ids**, and the estate still
holds a few hundred that do not, with two unsealed doors still minting more.

**Partial, cross-referenced 2026-08-31.** The false "Reload before trying
again" promise attached to this exact `native_link_required` 409 was fixed
independently as sweep item 87.14 (PR #1185): the message now states the
problem and names no remedy, since none exists in-app. **The 409 itself is
untouched** — a video status change on one of these 176 cards still fails
and rolls back, `_calArchiveParkSubIssues` still throws for the 88 link-only
cards, and 87.14's own "Traps" section says the real fix (a truthful
escalation, or a way to attach a native id after the fact) is an owner
decision, not a wording tweak. Items 64 and 66 (see their entries) are now
fully addressed; this one still has its core defect open.

---

## 68. [found 2026-08-30, HIGH — this is why 62-67 all survived] The test estate is pinned to a world that no longer exists

Not a product bug; the reason the product bugs above went unseen. Four
independent instances, all measured:

1. **The probe harness stubs the reroute flag DARK for every context it
   creates** (`qa/sxr_courier_lib.js`, `qa/probes/lib.js`), with the comment
   "Real clients run legacy — keep the stand-in faithful." That is now false:
   **0 of 41 active clients are unenrolled.** All 95 `lib.js` probes and 23 of
   24 courier probes drive a routing lane no production client is on.
   `p95_write_ui_test_guard.js` is the only probe that opts into the live flag.
2. **The harness stubs `linear-issue-statuses` to `{ok:true}`** — no `meta`
   key — which makes the app self-disable its entire Linear-meta feature for
   the session. No probe can exercise or regress the metadata banners at all.
   This is precisely why item 62 survived two flips.
3. **`cal_linear_deep.js` asserts item 63's hole is CORRECT** — "outbox drain:
   queued push sent to the webhook" for a `VID-` status on an unenrolled slug,
   described as "the production case that still runs the legacy lane" — and it
   is green.
4. **`test/calendar-card-write-jobs.js` pins `{video:'linear',
   graphics:'linear'}`** for its whole resume half: 36 assertions passing
   against a configuration that has not existed since 2026-08-16.

Three `prod-*` polish suites fail for a fifth variant of the same class —
fixtures pinned to "whatever live data sorts first", which the stray-catcher
import changed underneath them (`prod-structure-subset`, `prod-comments-browser`,
`prod-layout-polish`). `prod-comments-browser` demands the string "read-only
while Linear is authoritative", emitted only when `authority[team] !==
'syncview'` — unreachable for every team now. That is `FLIP_BUG_LEDGER` §3-1's
vacuous-rule class landing in a test rather than the app.

**The repair is not "fix the probes".** It is to decide, per suite, which world
it is testing: the legacy lane as deliberate rollback-readiness coverage, or
the gateway lane as the production case — and to say so in the file. Item 61
proposes that split for two probes; this item is the same argument for the
estate.

**Status by point, 2026-08-31.** Three of the four instances are now closed,
individually, without waiting on "the estate" as a whole:
- **Point 2 FIXED** (commit `94516cd5`): `linear-issue-statuses` now stubs
  `{ ok: true, meta: {} }`, so the metadata banner no longer self-disables
  for the rest of a courier-driven probe's session.
- **Point 3 already fixed independently**: `cal_linear_deep.js`'s outbox-drain
  section now asserts the `flipped_team_legacy_push` quarantine (item 63's
  shipped behavior), not the old legacy-delivery expectation.
- **Point 4 already fixed independently**: `test/calendar-card-write-jobs.js`
  §5b adds real `{syncview,syncview}` coverage naming item 65 explicitly —
  the suite no longer stops at the mixed `{video:linear,graphics:linear}`
  world.
- **Point 1 stays open.** Genuinely the size of "the whole estate" — 95
  `lib.js` probes plus 22 courier probes stub the reroute flag dark, and
  re-deciding each one's world (rollback coverage vs. production case) the
  way item 61 modeled for two files is a real review, not a mechanical edit.
  The three `prod-*` polish-suite fixture failures in the paragraph above
  were NOT re-checked this pass — `prod-comments-browser.js` needs a live
  Supabase fetch straight from the browser (no courier tunnel), which this
  sandbox's egress proxy blocks, so a run here times out waiting on
  `.prod-row` regardless of whether the underlying fixture-selection defect
  is fixed. Status unconfirmed either way; don't take the original failure
  claim above as still current without re-running it somewhere with open
  browser egress.

---

## 69. [RESOLVED 2026-08-30 18:05:32Z — owner ran the repair SQL; read-back verified twice, `status = approved`. The divergence is closed and the reconciler pressure item 76 describes is off this row. The MECHANISM investigation stays open as item 70.] A real client's video approval reached the card and never reached the canonical row

**One card, confirmed, post-flip.** Independently measured twice — once by the
audit that found it, once from scratch against live REST before it was written
down here.

| | value |
|---|---|
| card | `p_native_4e8545ea47b4b5dad5d6ffecc5a8_1`, "Video 3", `VID-13512` |
| client | a real active roster client (not TEST) |
| card says | `video_status = Approved`, `video_status_at = 2026-08-29T13:28:49Z`, `client_video_approved_at = 2026-08-29T13:28:48Z` |
| canonical `deliverables` row says | `status = client_approval`, `updated_at = 2026-08-26T17:00:59Z` |
| `deliverable_events` for that row | **nothing after 2026-08-26.** No `status_change`, no outbound intent, no `foreign_write_detected` |

The client approved on the 29th. The canonical row still says it is waiting for
them, and was last touched three days earlier.

**This is not a systemic failure, and the scope matters.** Measured across the
whole estate: 562 cards carry a native video deliverable; 37 diverge from their
canonical row once the benign `In Progress`/`todo` vocabulary pair is excluded;
**exactly ONE of those moved post-flip** — this one. The other 36 pre-date the
flip and are a separate, older question. In the same window 24 post-flip
`status_change` events landed correctly, all on the native lane
(`legacy_parity: false`, zero on the parity lane). So the native path works;
this single write took a different path and evaporated.

**The client is not blocked and nothing they see is wrong** — the card shows
Approved, which is what they did. The damage is that the canonical row, which
is what Production and every downstream reader trust, still says otherwise.

**Repair (owner SQL).** Bring the canonical row up to what the client actually
did. Read back before and after:

```sql
-- before
select id, status, updated_at from public.deliverables
 where id = 'del_8a6d7ef6-7d5a-41ca-b2e2-c96b8538dd4a';

-- repair
update public.deliverables
   set status = 'approved', updated_at = now()
 where id = 'del_8a6d7ef6-7d5a-41ca-b2e2-c96b8538dd4a'
   and status = 'client_approval';

-- after
select id, status, updated_at from public.deliverables
 where id = 'del_8a6d7ef6-7d5a-41ca-b2e2-c96b8538dd4a';
```

The `and status = 'client_approval'` guard makes it a no-op if anything moved
the row in the meantime. Note this writes the row without producing a
`status_change` event, so the trail will show the repair as an owner action and
not as the client's approval — which is honest, and better than a fabricated
client event.

**Standing check this should become.** Nothing in the estate would have found
this. Add the divergence sweep as a scheduled read: for every live card with a
`*_deliverable_id`, map the card status to its native slug and compare against
`deliverables.status`, excluding the `In Progress`/`todo` pair. Today: 562
pairs, 37 disagreements, 1 post-flip. Gate on **new post-flip disagreements**,
not on the total.

---

## 70. [found 2026-08-30, LIVE, HIGH — the likely mechanism behind item 69] Two slow seconds at page load put a whole session on a lane that now fails silently

`WRITE_UI_REROUTE_FLAG_TIMEOUT_MS` is 2000. `_writeUiFetchRerouteFlagOnce`
races the enrolment read against that timeout and, on **any** failure or
timeout, sets the value to `{ clients: [] }` — every client unenrolled — with a
`console.warn` as the only trace. `_writeUiPrimeRerouteFlag` then **memoises
that result for the life of the page.** Nothing re-fetches it; only a realtime
UPDATE on the flag row can correct it, and subscribing does not deliver current
state.

So one two-second network blip at boot puts that tab on the legacy lane until
it is reloaded — and post-flip the legacy lane is a dead end:

- the `linear-set-status` / `linear-add-comment` webhooks were gated in July to
  return **HTTP 409 once their team flips to SyncView**. Video flipped on 08-28.
- on a failed push the client-side handlers `console.warn` and enqueue to a
  localStorage outbox. **No save error, no notice, no repaint.** The source row
  saves and the UI goes green.
- on drain, a 409 lands in the branch that returns the item to the queue
  **without incrementing `attempts`**, so it never reaches the retry cap and is
  never quarantined. It is retained, silently, forever.

This is the ledger §5 "parks silently, with no error anyone sees" hazard,
except it no longer needs an unenrolled client — **all 41 active clients are
correctly enrolled** (measured; zero active-not-enrolled, zero enrolled-but-
inactive). It needs a slow network for two seconds.

INFERRED, not proven, as item 69's cause: the decisive evidence is
`peekWriteUiQueueDiagnostics()` in that viewer's browser, which is not
observable from the server. **Whoever is at a machine that had SyncView open on
Friday should run it before loading anything** — a page load drains the queue.

**Not fixed.** The obvious repairs each have a real cost worth an owner
decision: raising the timeout delays first paint for everyone; failing CLOSED
instead of dark blocks writes during any flag outage; re-fetching on resume
adds a request to every focus. The one piece that looks unambiguous is the
silence — a lane that cannot deliver should say so rather than going green.

---

## 71. [found 2026-08-30, FIXED 2026-08-30] One failed read now blanks the entire Workload board; before the flip it cost half

> **UPDATE 2026-08-30 (commit 012a6f08):** `wlFetchNativeMetadata` now
> try/catches each 100-id chunk individually; a failed chunk's ids join
> `unavailableIssueIds` (their rows degrade exactly like the pre-flip
> per-partition failure) while every other chunk's rows survive. Only when
> EVERY chunk fails does the original throw — and its full consequence chain
> — still fire, which is correct: at that point nothing is provable. Covered
> by an executed 101-issue/two-chunk scenario in
> `test/workload-linear-browser.js` (one chunk 503s, 100 rows survive, the
> failed id is listed unavailable), mutation-verified. The "not covered by
> any test" line below described the pre-fix state.

`wlFetchLinearMetadata` used to split issues into two partitions — Linear-owned
and native-owned. A native read failure still left the Linear partition's rows,
so `rows.length > 0` and the page degraded per-partition. **Post-flip there is
only one partition**, so any native read failure means `rows.length === 0` and
`if (failures.length && !rows.length) throw` always fires.

Executed against live data, stubbing a 503 on the native projection over ten
real issues (five video, five graphics):

| authority | outcome |
|---|---|
| `{video:linear, graphics:syncview}` | DEGRADED — 5 rows survive, 5 of 10 unavailable |
| `{video:syncview, graphics:syncview}` | **THREW** — 10 of 10 unavailable |
| `{syncview,syncview}`, read OK (control) | 10 rows, no partial failure |

The consequence chain was executed end to end: the throw sanitizes metadata,
sets `dueDate = null` for **every** issue, clears the write routes, disables
every date control, and raises "Workload labels could not be refreshed.
Capacity may be understated; due-date editing is paused."

The native read chunks ids at 100 and throws on the first bad chunk, so with
~200 live issues either chunk 5xx-ing takes the board. **Nobody loses data**,
but every editor loses every deadline and all editing until it recovers.

**Reproduce by hand in fifteen seconds:** in DevTools block
`**/rest/v1/production_deliverables_browser_v1*` and hit refresh on Workload.

**Not covered by any test.** The existing native-failure case uses a fixture
with a SINGLE issue, so "all ids unavailable" and "the failing id" are
indistinguishable and nothing asserts a healthy sibling survives. Adding a
second provable issue to that fixture turns it red on today's code — that is
the cheapest possible regression guard for this.

---

## 72. [found 2026-08-30, live, HIGH] Workload still reads status and assignee from the Linear mirror, so SyncView-authoritative work can be invisible to the editor who owes it

The flip moved **only the due date and the workload weight** to the native
store. Workload still reads `status`, `statusType`, `assignee` and the
population itself from `workload_issues` — the Linear mirror — which drives
`wlIsActiveStatus`, the grouping, the roster filter and the capacity chips.

**Confirmed live case, `VID-13491`:**

| store | says |
|---|---|
| `production_deliverables_browser_v1` (authoritative) | `status = tweak`, `due_date = 2026-08-28`, assigned, not archived |
| `workload_issues` (the mirror Workload reads) | `status = "For Kasper approval"` — a PARKED status |

So SyncView says an editor owes a tweak that was due two days ago, and the
editor's own work page does not show it, because the retired system still
decides what counts as active.

**Scope, measured and then narrowed adversarially.** 351 native-authoritative
live video rows; 229 reach the Workload feed; 122 are dropped. But **110 of
those 122 carry `raw_issue_archived_at` and 109 have no card** — Workload is
mostly right to hide them, and the real defect there is that the native store
is stamped `todo`/`in_progress`/`tweak` on 110 rows Linear archived, with
nothing reconciling it. Only **5** dropped rows are clean: `VID-13109`,
`VID-13580`, `VID-13581`, `VID-13582`, and `VID-13491` above.

The reverse direction is clean: **0 of 230** Workload-live video rows are
parked or terminal natively, so there is no phantom work on the board.

A related asymmetry worth fixing in the same pass: the Workload capacity chips
and the Create Post editor picker answer the same "how busy is this editor"
question from **different stores** and disagree by up to 90% (31 vs 59, 24 vs
33, 30 vs 41). Neither excludes archived rows, which charges 22 archived rows
to live editors. The ranking happens to agree today, so no wrong assignment is
being made — but the inflation exceeds the gap between the two freest editors,
so that is luck rather than design.

**The check that would have caught this**, and should become standing: every
non-archived native row in `todo`/`in_progress`/`tweak` that is not a batch
parent must have a `workload_issues` row that is active, a sub-issue, and
non-parked. Baseline at today's five and gate on growth.

---

## 73. [found 2026-08-30, live, user-visible] The stray-catcher import left 63 ownerless live rows, and one of them tops the Production list

The cutover PR turned on `B1_STRAY_CATCHER` unconditionally, and the 00:00Z run
on 08-29 imported **392** legacy Linear issues in one pass (measured: 392
incremental events in that ten-minute window, all inserts; the same window on
adjacent days has one). They arrived without attribution.

**Sized the way §0-3 of the ledger demands — the actionable subset, not the
headline:**

| | count |
|---|---|
| production rows total | 6,152 |
| `client_slug = 'unattributed'` | 637 |
| unattributed **and live** (`todo`/`in_progress`/`tweak`) | **63** |
| of those, not archived | 63 |
| **of those, carrying a due date** | **1** |

So the number worth acting on is not 637 and not 842. It is **63 live rows
with no owner**, of which exactly **one** — `VID-164`, `todo`, due
**2023-02-03** — carries a date and therefore sorts to the **top of the Active
list ahead of every real client's work**. That single row is also what turned
a seven-week-dormant test assertion red (item 60).

Two distinct problems, and they want different answers:

1. **`VID-164` is cosmetic but prominent.** Anyone opening the Production tab
   today sees a three-year-old issue at the top of Active. Archive it, give it
   a real due date, or attribute it — an owner call, but a cheap one.
2. **The other 62 are ownerless, which is the real one.** A row with no
   `client_slug` appears in NO client view, so its state has no owner and
   nobody is looking at it. That is the same class as the standing attribution
   item, now fed by a continuous importer rather than a one-off.

**The importer is doing its job** — its whole point post-flip is to catch work
created in Linear so it does not stay invisible. The gap is that it imports
without attributing, and nothing downstream re-derives it. Worth deciding
whether the stray catcher should attribute on import, refuse to import what it
cannot attribute, or keep importing and hand the backlog to a repair lane.

**RE-MEASURED 2026-09-02, as this entry asks.** Every number is unchanged:
637 unattributed, **63 unattributed and live**, exactly **1** carrying a due
date — still `VID-164`, still `todo`, still due **2023-02-03**, still not
archived, still therefore at the top of Active. Total production rows moved
6,152 → 6,239 over the same period, so the estate grew while this population did
not.

**BUT THE FEEDER IS STILL RUNNING, and an earlier draft of this paragraph said
it was not.** `.github/workflows/b1-linear-incremental-refresh.yml` is on
`cron: '*/30 * * * *'` and sets `B1_STRAY_CATCHER: '1'` at the step level, which
since F1(video) is the STANDING mode for every run — the dispatch checkbox is
ignored. The importer inserts every newly encountered active Linear issue, and
item 74 directly below records that post-flip paths can still manufacture
unattributed rows. So the honest reading of a flat 637/63/1 is **no qualifying
issue arrived during this window**, which is a fact about the window and not
about the mechanism.

What that changes: the population is not decaying while the decision waits, but
it is not sealed either — a single new Linear issue lands another ownerless live
row within thirty minutes. Cheaper than it looked, not free. Raised by review on
#1221, correctly: calling the feeder absent understates the repair and invites
deferring it on a premise that is not true.

Note the reconciler's own `repair_required` counter has been **flat at 779
across 30 consecutive runs** with `entities_checked` flat at 7,498, so this is
not currently growing on that measure — the import was a step, not a trend.
Re-measure before assuming either.

---

## 74. [found 2026-08-30, backend audit] The F200 attribution repair lane now throws by construction — while inbound still manufactures the rows it exists to repair

`scripts/linear-deliverables-reconcile.js:1420`, `:1643`, `:1739` each gate the
repair on `authorityForTeam(...) !== 'linear'` and **throw** (not skip). With
no Linear-authoritative team left, the lane throws on its first target, every
time — the §3-1 UNDEFINED class, not the vacuous one.

The asymmetry is the finding: `linear-inbound` in detect-only mode STILL
invalidates attribution — it is the one deliberate exception to detect-only
(`linear-inbound/index.ts:728-762`, stamps `client_slug = "unattributed"`). So
post-flip the system can still CREATE unattributed rows and can no longer
repair them by any automated path.

Bounded, measured: 637 unattributed rows, **87 live video** (62 todo, 24
smm_approval, 1 tweak); the hourly reconciler sees all of them
(`repair_list_size: 637`) but never applies — the scheduled run is always
dry-run (`APPLY` is empty on a `schedule` event), and a manual apply would hit
the throw first. De-escalating context: `f200_attribution_repair` events all
time = **0** (the lane never once ran in production — a latent capability
lost, not a working repair broken), and `attribution_change` events since
2026-08-16 = 0, so the population is static.

**Repair:** give the gate the same `requiredAuthority` inversion B1's
stray-catcher got (`b1-linear-backfill.js:1771`), or re-scope the lane's
target to the item-73 decision. The 87 live rows themselves are item 73's
population — one decision covers both.

---

## 75. [found 2026-08-30, backend audit] The legacy-parity lane is dead across the whole stack but still switched on, and its failure mode is silent infinite retry

Post-flip the outbox drain's parity gate can never be true
(`linear-outbound/index.ts:1377-1379`: parity requires `authority === "linear"`).
Any outbox row carrying `legacy_parity = true` is counted `paused`, unlocked
for 30 minutes, and retried forever — it never reaches `failed`, so
`alerts.failed_write` stays false and nothing pages. Meanwhile
`production-write` 409s every parity request (`:1250`) and never sets parity
on its own intents (`:4936`), so the flag `linear_legacy_parity_enabled
{"enabled":true}` now **gates nothing** — a live switch with no effect, which
is exactly the shape that misleads an operator mid-incident.

The observable that fits this failure: drain summaries report a **constant
`backlog: 14`** with `oldest_pending_minutes: {video:null, graphics:null}` and
zero alerts. Whether any of those 14 carry `legacy_parity = true` **needs a
service-role read of `mirror_outbox`** (the publishable key cannot read it) —
the single highest-value unresolved read from the audit. Owner SQL:

```sql
select id, kind, legacy_parity, test_only, attempts, created_at
  from public.mirror_outbox
 where status <> 'written'
 order by created_at asc;
```

**Repair after that read:** quarantine-or-fail parity rows at the drain
instead of eternal pause; either retire the parity flag or make it gate
something true; and the paired browser-side hole is item 63.

---

## 76. [found 2026-08-30, backend audit, bears directly on item 69] The status reconcilers still APPLY Linear-to-card pulls for video, every 10-15 minutes — a second door into the surface users look at

`linear-sync-reconcile.js:323-324` (twin at `sample-linear-reconcile.js:300-301`)
classifies a syncview team with outbound live as PULL-ONLY: card→Linear pushes
are suppressed, but **Linear→card writes still run** — and both workflows run
with APPLY on schedule (the calendar one dispatched every 15 min by the n8n
pager, the samples one on a `*/10` cron).

So a human status edit in Linear on a video issue is refused on the canonical
`deliverables` row (detect-only, correct) but **can still land on the calendar
card minutes later**. The two SyncView stores then disagree, and the outbound
mirror — driven by `deliverables` — will not push back. This is a door the
ledger's flip inventory does not name.

Three structural facts, ledger-independent, from executing the reconciler
dry-run against live data: (a) the `gated`/detect-only counter is now
structurally zero — a reported number that can never move again; (b) the
bidirectional re-validation branch (`:443-445`, requires `linear` authority)
is dead code; (c) a dry run proposed reverting the item-69 card's video status
back to the pre-approval value — CAVEAT: that run used an empty arbitration
ledger, so it is NOT production's verdict, but it shows the pressure this
lane can exert on exactly the item-69 shape. **The item-69 repair SQL closes
that divergence from the safe side; run it before re-deriving anything here.**

**Decision owed:** is Linear→card projection for a flipped team a feature
(status visibility during the backup window) or a leak? If a feature, its
arbitration must be proven against the PRODUCTION ledger (restore
`.sync-ledger/` from the Actions cache and re-run dry); if a leak, the
pull-only classification should go detect-only for flipped teams.

---

## 77. [FIXED IN REPO 2026-08-30 — **DEPLOYED 2026-09-04** (run `33899387402`, closure `019a463d…`) AND STILL NOT IN EFFECT: the repair sits at `linear-inbound` index.ts:868, *after* the detect-only branch returns at ~803, and `isDetectOnlyTeam` is true for both teams while `prod_authority` reads `syncview`. So the code is live and unreachable. Owner SQL remains the only repair; see item 143's correction] linear-inbound cannot see a CLEARED assignee — mechanism corrected, fix shipped with an executing test

> **STATUS, 2026-09-03.** The blocker the 2026-09-01 correction below describes
> is CLOSED. `deploy-f27-linear-inbound.yml` now pins
> `CANDIDATE_SOURCE_SHA256: 019a463d…` and `REVIEWED_RELEASE_SHA: 72fbc4a5…`,
> `72fbc4a5` is an ancestor of `main`, and `test/ef-pin-drift-report.js` passes
> as a hard gate — so a dispatch today would be ACCEPTED, not rejected. What
> remains is the dispatch itself:
> <https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-f27-linear-inbound.yml>
> with `commit_sha=72fbc4a5be6c570c2d6638a49b320abd4e4b2c5c`,
> `operation=deploy-reviewed-release`,
> `confirm=DEPLOY_REVIEWED_LINEAR_INBOUND`. No capture is needed for this lane.
>
> Everything below is retained as written and is now HISTORY. It was found
> uncorrected on 2026-09-03 by an audit, still naming the superseded pins and
> still telling a reader that a dispatch would be rejected — which is the exact
> failure item 106's closing paragraph warns about, committed by the session
> that wrote that paragraph.

**CORRECTION 2026-09-01 — "owner dispatches the linear-inbound deploy workflow"
is not yet an instruction anyone can follow, and finding that out at dispatch
time would cost a cycle.** `.github/workflows/deploy-f27-linear-inbound.yml`
pins `CANDIDATE_SOURCE_SHA256: 3d91b2a2…`, last changed 2026-07-30 in PR #999.
The fix landed 2026-08-30 in `d9fbc2e7` and CHANGED that closure. The lane
compares the candidate against its pin and refuses on a mismatch, so a dispatch
today is rejected — correctly, and with nothing touched. **Re-pinning is a
code change and therefore a PR, not an operator step**, which is the part the
sentence above hides. **And `CANDIDATE_SOURCE_SHA256` is not the only pin that has to
move** — the first version of this correction said it was, and review on #1207
was right to refuse that. The same workflow also fixes
`REVIEWED_RELEASE_SHA: 661e5b1b…` (line 51) and requires
`DEPLOY_COMMIT == REVIEWED_RELEASE_SHA` (line 93), then checks out that exact
commit and fingerprints ITS source (lines 109, 306). So a PR that updated only
the closure pin would still be refused at the commit check, and a dispatch that
somehow got past it would deploy the OLD source. Both pins move together, to a
commit containing `d9fbc2e7`, along with any guard that restates either.

That lane needs no rollback capture (its bundle is pinned in the workflow as
`V39_BUNDLE_SHA256`), so once BOTH pins are re-pinned it is a three-input
one-click deploy: `commit_sha` (= the new reviewed-release SHA),
`deploy-reviewed-release`, `DEPLOY_REVIEWED_LINEAR_INBOUND`.

Noticed while answering "is there anything else I need to do?" after the
2026-09-01 Section 4 deploy — which does NOT ship this: that lane deploys
`linear-outbound`, `production-write`, `deliverable-write` and `batch-write`.
`linear-inbound` has its own lane and was untouched. Until it ships, an
unassignment done in Linear still leaves the native `assignee_id` stamped, and
the owner-SQL half remains the only way to clear one.

PRE_FLIP_HEALTH_CHECK item 11 recorded the symptom (25 unassigns delivered,
zero applied) and blamed "Linear omits null relations". **Half right, and the
half matters for the fix.** Measured against 40 real webhook payloads: Linear
always sends the `*Id` SCALAR twin of every relation (`assigneeId`,
`parentId`, `projectId`); only the relation OBJECT is omitted-when-null. The
apply block's parent gate already accepts both (`has(issue,"parent") ||
has(issue,"parentId")`); the assignee gate at `linear-inbound/index.ts:827`
checks `has(issue,"assignee")` ONLY — the sole field gate in the block
missing its scalar twin. Executed against the 40 payloads: the current gate
fires on 38/40; adding `|| has(issue,"assigneeId")` catches 39/40 including
the one live-captured unassignment.

Sibling sweep, so nobody re-audits this: `dueDate` SAFE (arrives
present-with-null; the `nullif(...,'')::date` in the migration coerces it —
a grep would have miscalled this a crash); `labels` SAFE (always `[]`,
`labelIds` carries truth); `description` cannot be cleared BY DESIGN
(`mergeLinearRaw:479` deliberately restores it on absence — flag for a
decision, not a fix).

Second half, same root: `recordDetectOnly` (`:766`) stores the issue but NOT
`payload.updatedFrom` — and since a clear is an absent key, the detect-only
trail is structurally unable to say "the assignee was cleared". `updatedFrom`
names every changed key regardless of value and the handler already uses it
in three places.

**Status: FIXED IN REPO, deploy pending.** The gate now accepts both forms,
resolving a scalar-only NON-null id the way the parent gate builds its map —
which also covers the trap case measured once in the 40 payloads, where a
naive absent-relation-means-null fix would have CLEARED a real assignment.
The detect-only record now carries `updated_from`. Both halves are pinned by
`test/linear-inbound-assignee-clear.js`, which slices and EXECUTES the shipped
gate against the captured payload shapes (clear, reassign, scalar-only
assign, neither-key, unknown-id anomaly) and is mutation-verified. Deploy is
the owner's dispatch; while both teams stay detect-only the gate is
unreachable in production, so the deploy is about rollback-readiness, not
urgency.

---

## 78. [found 2026-08-30, backend audit] Twenty legacy n8n webhook calls since the flip, every one a silent 409 that n8n logs as success

14 calls to Calendar - Linear Set Status and 6 to Add Comment since the flip.
Each necessarily returned `{ok:false, blocked:true,
reason:'syncview_authoritative', http_status:409}` and wrote nothing — and
n8n records all 20 executions as `success`, because the workflow completed.
Green dashboard, zero effect: the §4-3 trap live in production.

**Unknown: who is calling.** Candidates are a browser on the legacy lane
(items 63/70 — a caller cluster at 16:27-16:29Z looks synthetic/drill-like),
or a reconciler push path. Identifying the caller identifies whether item
70's timeout is firing in the wild. The n8n execution payloads carry the
issue ids — read a couple (READ-ONLY) and match against the outbox shapes.

Also noted for the same review: the VIDEO PRODUCTION AUTOMATION gate flipped
meaning at F1 **by design and is healthy** — it routes (legacy path vs native
F44 worker), it does not block; 252 executions since the flip, all success,
all down the native branch. No action; recorded so nobody re-diagnoses a
working handoff as a stuck gate.

---

## 79. [found 2026-08-30, backend audit + browser audit, two halves agree] workload-linear is now a dead edge function

Its only write path requires Linear authority (`workload-linear/index.ts:446`)
and 409s otherwise — permanently, now. The browser half was established
independently: `wlDueWriteRoute` routes every row native while both teams are
syncview, so the `WORKLOAD_LINEAR_URL` branch is unreachable from Workload.
Dead on both ends. Decide: delete, or keep as the rollback path with a
comment saying exactly that (its header currently describes a world that no
longer occurs). Cheap either way; the cost of doing nothing is the next
auditor re-deriving all of this.

**Partial, 2026-08-31 (commit `8a58c4c5`):** the header comment is corrected
to state plainly that both write paths are currently dead and why, so the
next reader isn't misled — but the delete-vs-keep call itself is still the
owner's to make, and nothing else changed. `test/workload-linear-source.js`
and the full suite stay green; this function's behavior is untouched.

---

## 80. [found 2026-08-30, backend audit — the monitoring-trust bundle] Three ways the estate can now fail without paging anyone

One item because one review should fix all three:

1. **B1 is in the "green no-op" future the ledger warned about** (§0-5: "a
   monitor that can never again say anything"). Flag on, heartbeat green
   every 30 min, 0 stray writes in 42+ hours — and a broken importer would
   look byte-identical to a quiet weekend. The flip-day full-window pass DID
   prove the write path (652 real inserts at 00:00:30Z), but steady-state
   stray-catching is unexercised. **Watch `writes.deliverable_rpc_writes` +
   `skipped_existing` in the summary events, not the heartbeat**: skipped
   moving while writes=0 is a healthy quiet lane; BOTH flat at 0 for long is
   either no Linear traffic or a dead loader, and those are not the same.
   The playbook's Part 5a is the live proof — run it.
2. **The watchdog's own lane flapped six times across the flip window**
   (`monitoring_watchdog_latch`, ages 190-296 min) — recurring false pages in
   exactly the 48h it needed to be trusted. §4-5 in progress.
3. **Nothing schedules the standalone monitors.** `foreign-write-strand-check`,
   `attribution-stuck-check`, `f40-workload-readiness` are referenced by zero
   workflows — they run when someone remembers. The strand check is the ONLY
   instrument for "someone edited a video issue in Linear and it went
   nowhere", which becomes live the moment the team returns Monday. Its
   output copy also still says "SyncView owns graphics" — it will name the
   wrong team the first Monday it matters. Schedule all three; fix the copy.

Related micro-gaps, same review: an inbound issue with NO native row is
dropped with only a console.warn (`:707`) — no event, no counter (the stray
catcher's 30-min window is the only net); and all 8 post-flip
`foreign_write_detected` rows are COMMENT echoes — zero issue-shaped
detections in 42h, indistinguishable between "editors stopped" and "issue
webhooks not arriving". Monday's traffic decides it; the strand check must be
scheduled before then.

**Partial, 2026-08-31 (commit `b072ff06`):** the copy half of point 3 is done —
`scripts/foreign-write-strand-check.js` no longer says "SyncView owns
graphics" as if video weren't also flipped; both header comment and the
human-facing summary line now name both teams. The detection query itself
was never team-filtered, so this is text-only, verified against
`test/foreign-write-strand-check.js` and the full suite (both green).
Scheduling the three standalone monitors (the actual point 3 ask, and
points 1-2 entirely) is untouched — that's a new recurring automated job
against production, which is a bigger call than this pass makes solo.

---

## 81. [found 2026-08-30 hands-on test, FIXED same day] A hand-off to Kasper with no file attached vanished from both sides

The tester drove a TEST card to `Kasper Approval` on both surfaces, confirmed
it on both (`deliverables.status = kasper_approval`, `calendar_posts.video_status
= "Kasper Approval"`), and could not find it anywhere in Kasper's queue. They
filed it as **"Kasper's review queue reads only the Sheets-backed `calendar-get`
webhook and is therefore blind to every natively-created card"** — HIGH,
client-affecting.

**That mechanism does not survive the data, but the observation was right.**
Measured live the same evening:

| probe | result |
|---|---|
| `_kasperFetchAllRelevantPosts` data source | Supabase-first for **every** client (`index.html` ~68700, gated on `_calV2Ready()`, which is ON by default), webhook only as fallback |
| `calendar_posts` size | 9,325 rows, of which **694** are non-archived — one page, no pagination, no timeout |
| non-archived rows carrying a native `*_deliverable_id` | **516** |
| native cards at `Kasper Approval` **with** media, real clients | **4**, all of which render |
| the tester's own card | `asset_url = ""`, `thumbnail_url = ""` |

The queue's content gate (`hasKasperWork && (hasAsset || hasThumb)`) dropped it.
Pre-flip that silence was nearly harmless — a media-less card at Kasper Approval
was a freshly-synced Linear stub nobody had handed over on purpose. **Post-flip
the Production tab moves status without touching media**, so an ordinary status
change strands a card in a state where the SMM believes it is with Kasper and
Kasper is never told it exists. **82 of 152** live native cards carry neither
media column, so the shape is common.

**Fixed (commit `bfb02742`).** Such cards stay out of the review list — there is
genuinely nothing to review — but are now reported above the queue with client
and card name. Covered by `test/kasper-stranded-handoff.js` (executed slice of
the shipped `extract()` loop against the measured row shapes), mutation-verified.

**Still open, and it is the deeper question:** nothing stops a status move to
Kasper Approval on a card with no deliverable attached. The notice makes the
dead end visible; it does not prevent it.

---

## 82. [found 2026-08-30 hands-on test, FIXED same day] The reconcilers applied Linear values the canonical row never held

The tester: *"the status projection is most-recent-action-wins and leaves no
audit trail — a foreign Linear edit overwrote the client-facing card twice while
the canonical row held."* Confirmed, with the mechanism named.

Both 15-minute reconcilers (`scripts/linear-sync-reconcile.js`,
`scripts/sample-linear-reconcile.js`, dispatched by the n8n pager) gate the
**wrong axis**. Post-flip they suppress card→Linear pushes and deliberately keep
Linear→card pulls running — correctly, because that pull is the only
server-side path carrying a Production-tab status onto a card. But nothing asked
where the Linear value **came from**, so an edit made directly in Linear was
applied to the client-facing card as though the mirror had delivered it.

**Measured on `VID-13659` (2026-08-30):** the deliverable held `smm_approval`
throughout, while the reconciler moved the card to `Approved` (18:31:26) and then
`Scheduled` (18:46:26) — each ~5 and ~12 minutes after a `foreign_write_detected`
on the same issue, on the 15-minute tick. The inbound edge function behaved
correctly (detect-only, no canonical change); the card leg is where it landed.

**Blast radius, measured:** 49 `foreign_write_detected` rows and 57
reconcile-sourced card writes since the flip, across **ten real clients**. These
columns drive the SMM calendar, Kasper's queue, Workload and the **client share
link**, and `pullLinearToCard` also rewrites the overall status and can clear
client-approval stamps — so a foreign pull can un-approve work in front of a
client.

**Fixed (commit `0b83dd7a`)** with an ECHO test, not a kill switch: a pull-only
Linear win applies only when the canonical `deliverables` row — mapped through
the app's own `_calMapNativeStatusStrict` — agrees with it. A disagreement is
foreign by construction: held, logged with both values every run, counted in the
job summary the pager reads. A card with no native deliverable id keeps its old
behavior, announced as unverified. Unreadable canonical status fails closed.
Three executed worlds in `test/f50-reconcile-pull-only.js` (foreign refused, echo
applies, unlinked still pulls) across both scripts, mutation-verified.

**The tester's audit-trail claim was ~90% right and worth stating exactly:** a
`calendar_post_events` row IS written (`source:'reconcile'`), but with
`actor`, `role` and `payload` all null — nothing names the Linear issue or state,
nothing links to the `foreign_write_detected` row, and nothing alerts. The fix
adds the suppression trail; **giving the reconciler a real automation identity on
the card ledger is still open.**

---

## 83. [found 2026-08-30 hands-on test, FIXED same day] Mojibake in user-visible text

`U+00C2 U+00B7` where a middle dot belongs — a Latin-1 → UTF-8 round trip frozen
into the source. The tester saw it on the Production list's provisional-attribution
badge; there were **six**, the others in the create modal's parent picker and
header and in two toasts. Fixed (`8660ecb4`) with a byte-level scanner over the
page and the edge functions (`test/source-text-encoding.js`) carrying a positive
control, since the fault is invisible in a diff.

---

## 84. [found 2026-08-30 hands-on test, FIXED same day] `#calendar/<slug>` and `#kasper` did not survive a load

Filed as "the view never mounts". **It mounts, and is then painted over** —
which is why every symptom looked contradictory: `currentNav` said `calendar`,
`calState.client` was right, and `#calView` was null, with no error and no empty
state.

**Root cause, one line:** `index.html`:11523, the catch-all `else` in the
`popstate` handler's stateless branch, calls `render('all')`, which replaces
`#content` with the analytics overview and destroys the mounted view.

A history entry with **no state** is one this app did not create — a fragment
navigation typed, bookmarked or followed into an already-open tab, and any
Back/Forward across such an entry. The browser fires `popstate` for it (before
`hashchange`; this file registers **zero** `hashchange` listeners) with
`state === null`, and that branch knew exactly three routes: `templates`,
`templates/<client>`, and a bare client name. `calendar/<slug>`, `kasper`,
`workload` and every other route fell through to the overview.

It is silent because `render()` never assigns `currentNav` and never touches the
nav pills or `calState` — so the pill keeps reading active while the DOM is gone.
Recovery is clicking the already-active nav button, exactly as the tester found.
The SMM's bookmarked client-calendar URL is precisely this shape.

**Fixed:** the stateless branch now routes the same hashes the boot router does,
carrying `calendar/<slug>[/<card>]` and `samples/<slug>` through as focus
requests, with `render('all')` kept for what is genuinely unrecognized. The two
unlock-gated tabs repeat their gates here on purpose — **popstate must never be
a way into a tab the session has not unlocked**, and that is asserted. Client
links are provably untouched: the handler returns for them at its first branch,
before any of this. Covered by `test/popstate-hash-route.js`, which executes the
shipped listener across 19 cases, mutation-verified.

**Worth noting for the class:** this was the third "silent" defect of the day
whose mechanism was not what the symptom suggested — the other two being the
Kasper queue (a content gate, not a data source) and the reconciler (provenance,
not direction). All three were found by measuring rather than by reading.

---

## 85. [found 2026-08-30 hands-on test, HALF-FIXED same day — **DEPLOYED 2026-09-04** (run `33899387402`); the enrichment half is live, and the other half remains an owner call]

`foreign_write_detected` is ~80% self-noise. **Root cause found, and it is one
branch.** There is exactly one producer of the signal — `recordDetectOnly` in
`supabase/functions/linear-inbound/index.ts` — and the comment lane reaches it
through a detect-only branch that is **echo-blind**: `echo` is a live parameter
one line below the return that skips it. So SyncView's own comment coming home
was recorded identically to a human typing in Linear, and the row shape could
not tell them apart either (`{detect_only, linear_comment_id}`, written
unconditionally).

Measured over the flip window: **22 of 29** comment-shaped detections had a
SyncView-originated write on the same deliverable within five seconds; the issue
lane — which still applies its echo drop at the dispatch site — had **1 of 20**.

**History:** #809 hoisted the comment dispatch above the echo drop and demoted
`echo` to metadata; before that a self-echo comment never reached the function.
It stayed latent while either team was Linear-authoritative, because
`isDetectOnlyTeam` was false for it. The video flip closed the last escape hatch.

**Costs nothing at runtime** — it only logs. It suppresses, retries and blocks
nothing; `persistProductionComment` runs before the branch, so no thread, queue
or client surface is affected. The damage is entirely to the tripwire's
signal-to-noise, which is the whole point of a tripwire.

**Correction found in verification, and it is immediately useful:** the
discriminator is **already persisted today, one row over**. `persistProductionComment`
stamps `echo_suppressed` into its own `deliverable_events` row, written
milliseconds before the `foreign_write_detected` row on the same deliverable.
An RLS policy hides those comment-event bodies from the anon key, which is why
neither the tester nor the investigation could see them — **a service-role
operator can build the clean alert right now**, by joining the two rows on
deliverable and timestamp, with no deploy at all. The rows are also externally
resolvable: every self-echo is authored by the single `SyncView Mirror` Linear
user and carries a `<!-- syncview-mirror: -->` marker, so the historical 29 can
be reclassified retroactively.

**Fixed half (deploy pending, same deploy as item 77):** the row is **enriched**,
not suppressed — `echo_suppressed` plus `echo_outbox_id`. Alert on
`echo_suppressed = false`. Covered by `test/linear-inbound-comment-echo-label.js`,
which executes the shipped branch in both directions.

**OWNER CALL, deliberately not taken:** whether this lane should also *stop
emitting* self-echoes (restore pre-#809 semantics by dropping the echo before
`recordDetectOnly`). It is the tidier end state, but it deletes rows the tripwire
currently emits — meaning a future bug in the echo matcher could silently hide a
genuine foreign write — and it puts a step change in two monitoring series
(`foreign-write-strand-check`'s `commentEchoRows` falls toward zero,
`linear-outbound`'s `counts.echo_dropped` rises). Enrichment was chosen first
because it cannot lose an event. Say the word and the drop ships.

---

## 86. [found 2026-08-30 hands-on test, BROWSER HALF FIXED — the cause is SERVER-SIDE and still live]

`calendar-get` returns an empty HTTP 200 for some clients, **and the webhook is
lying.** Measured live against the three slugs the tester named:

| client | calendar-get says | `calendar_posts` actually holds (non-archived) |
|---|---|---|
| A | HTTP 200, **zero-byte body** | **32** |
| B | HTTP 200, **zero-byte body** | **17** |
| C | `{"ok":true,"posts":[]}` | **24** |

All three are live clients with real Linear links and rows updated within a day.
The app's cards were right; the webhook's answer was wrong.

**The cause is server-side, and it is not a browser line.** The n8n workflow
"SyncView Calendar — Get" resolves a `Calendar_<slug>` sheet and reads it with a
Google Sheets node that has **no error branch**. A client with no tab makes that
node throw (`Sheet with name Calendar_<slug> not found` — visible as errored
executions), and the webhook emits **200 with a zero-byte body**. A client whose
tab exists but is empty succeeds and returns `{ok:true,posts:[]}`. Both are the
legacy Sheets store, which stopped being written per client as
`calendar_upsert_ef_clients` rolled out. **Do not edit that workflow without the
owner** — it is production automation — but it is the actual defect, and the
browser guards below only stop the app from believing it.

**Three unsafe handling sites, one shared assumption** — that a 200 from
`calendar-get` is a truthful census:

1. **`_calV2FetchPosts` (primary).** The zero-byte body already threw at
   `resp.json()`; `{ok:true,posts:[]}` did not. It became `calState.posts` and
   was then **written to the localStorage cache**, so one bad fallback could
   blank a calendar and keep it blank across a cold load.
2. **The Kasper per-client fallback.** Returned an empty queue for a not-ok
   answer and cached the lie for five minutes — a client dropping out of the
   review queue, indistinguishable from that client having no work.
3. The rejection path then discarded *which* client had failed, so nothing could
   report it.

**Fixed:** both readers treat a zero-row webhook answer as a **failed read**
(the same ratified guard the Workload native read uses) — the calendar keeps its
cards and says it could not refresh, and only a non-empty truth is ever cached.
The Kasper rejection now carries the client name, and the queue paints a notice
naming clients whose calendar could not be read. Covered by
`test/calendar-get-empty-200.js`, executing both shipped fallbacks against the
three measured response shapes, mutation-verified.

**Known cost, accepted:** a genuinely empty client, on a load where Supabase
*also* failed, now sees a refresh notice instead of a correct empty calendar.
That is the right side to be wrong on.

**DO NOT treat this item as closed on the strength of the browser guards.**
Adversarial review measured a case they do not cover: clients whose Sheet tab
still exists but froze when EF rollout stopped writing it return a **non-empty
STALE snapshot**, which passes every guard above and is accepted as truth. That
is a worse failure than the empty answer, because nothing about it looks wrong.
Closing item 86 properly means either retiring the Sheets fallback for enrolled
clients (the second owner call below) or giving the fallback a freshness test.

**NOT changed, deliberately — two owner calls:**

- **Make `_calCacheWrite` refuse to overwrite a non-empty cache with an empty
  one.** Tempting defence-in-depth, but it makes deletion asymmetric: archiving
  or deleting the last card would no longer clear the cache, so a stale card
  could survive a cold load. Needs an explicit exemption for the archive/delete
  write paths before it is safe.
- **Retire the Sheets fallback entirely for EF-enrolled clients.** Correct in
  principle — the Sheet is write-dead for them, so the fallback can only ever
  return a wrong answer — but it silently changes meaning the moment a client is
  taken *off* the allowlist. Wants the flag coupling made explicit first.

## 87. [found 2026-08-31, unknowable-assertion sweep — 12 agents, adversarially verified; **ALL EIGHTEEN FIXED — verified 2026-09-02**] Eighteen more places the interface states something it cannot know

The method that produced five of the seven flip-day bugs, run deliberately and
at width: six falsehood classes swept across every SyncView surface, each
candidate then handed to an independent verifier told to REFUTE it. Thirty-six
candidates were raised; **eighteen survived and eighteen were refuted**, which is
the number that makes the pass worth recording — a sweep that confirms
everything it finds has not been verified.

Two of the survivors were found independently and FIXED the same night (they are
listed first, marked, and left in place because the sweep finding them
separately is evidence the method works, not noise). One refutation is worth
reading on its own: the boot skeleton that says *Preview - read-only* before
hydration was raised and **refuted** — authority is deliberately never cached,
so the tab genuinely IS read-only for that whole interval, and the chip is a
fail-safe rather than a claim. The live defect is what item 5 below describes:
the same words AFTER hydration, next to a chip that says Native writes.

Nothing below is fixed unless it says so. Recorded here so none of it is lost,
ordered roughly by who hits it and how soon.

**STATUS 2026-09-02: every one of the eighteen now says so.** Swept the
sub-headings mechanically — all 18 carry a FIXED marker, so this item is closed
as a whole. It was still listed as open work because the parent heading was
never updated when the last child landed, which is worth noting as its own small
lesson: an item with children needs its own closing act, or it goes on
advertising work that no longer exists.

### 87.1 Production Assets panel prints "Not provided / Missing" for all four slots whenever the authenticated asset read has not answered or was refused — **FIXED 2026-08-31** (PR #1183, deployed): PROD_ASSET_UNREAD_GUIDANCE now covers every deliverable, not only synthetic parents.

**Verified by refutation attempt.** I established the mechanism independently and it is not fixed on this branch. CODE. index.html:47411 sets `unreadable` only for `issue.syntheticBatchParent === true`; 47414 therefore resolves every slot of a REAL deliverable to `missing`, because index.html:48683-48689 hardcodes `assets` to four empty strings. Both rescue loops — index.html:47519 (no staff identity) and index.html:47600 (read failed) — only upgrade rows already in state `checking`, which a real deliverable can never be in, since `checking` requires a URL the projection cannot supply. The value column at index.html:53003-53007 then prints "Not provided" and the pill at 53011 prints "Missing". LIVE MEASUREMENT (publishable key, project uzltbbrjidmjwwfakwve). `production_deliverables_browser_v1` returns 46 columns and none is asset-bearing (dumped); `deliverables` and `batches` both answer 42501 to the browser key — so the projection genuinely cannot carry these values, exactly as the candidate says. 5,883 live deliverable rows (3,585 video / 2,298 graphics) after applying `_prodDeliverableLive`'s marker filter. WHO IS MISLED, AND WHEN. (a) Persistent, every reader including admins: the edge function refuses when the declared client_slug is not an ACTIVE client (supabase/functions/production-write/index.ts:3754-3755, `if (!client || client.active !== true) throw 403`). 686 live cards fall in that set — 637 of them carry client_slug `unattributed`, plus testproject 22, jessicaencellcoleman 15, jesszweig 9. The browser sends `authorityProject || storedClientSlug || project` (index.html:47507), which for those rows is `unattributed`. Anyone triaging the unattributed backlog on Monday opens one and is told the post has no filming plan, no footage, no delivery folder and no file — while the red line underneath blames their staff account, which is also not the reason. (b) Persistent, cross-team creatives: policy.mjs:300-306 `staffAssetReadAllowed` admits admin/smm always, and creative only when memberTeam === targetTeam. team_members holds 3 active editors (video: Santi, Nahuel, Iara) and 1 active designer (graphics: Rocio); roleCompatible maps editor/designer onto keyRole `creative` (policy.mjs:143). So

**Traps in the obvious fix.** Three concrete risks. (1) The honest label must not survive a SUCCESSFUL read: the gateway legitimately returns per-slot state `missing` for a genuinely empty column, and SMMs/designers rely on "Missing" to know a filming plan has not been uploaded yet — a blanket seed change to `unavailable` would erase a true signal on the ~5,200 cards whose read succeeds. The change belongs keyed on `state.status` in the seed (47414) and the two rescue loops (47519, 47600), never on the row. (2) `checking` is already a user-visible label ("Checking", _prodAssetStateLabel), so reusing it for the pre-read seed would leave four rows reading "Checking" forever on any card whose read never returns. (3) test/prod-batch-parent-panels.js:313 pins the exact source expression `_calEsc(unreadable ? String(asset.guidance).trim() : 'Not provided')` with a text scanner; any edit to that line reds a currently green test and must be updated in the same commit.

### 87.2 Unassigned + undated sub-issues vanish from the whole Workload board, including the strip labelled "Needs assignment" — **FIXED 2026-08-31** (PR #1185): counted and reported by `wlExcludedSummaryText`; nothing re-bucketed.

**Verified by refutation attempt.** HOLDS — mechanism and scale independently reproduced against live data. MECHANISM (index.html:16340-16343). wlApplyData buckets in one pass. First branch: `if (!s.assigneeId) { if (inProg || workDate) unassigned.push(s); continue; }`. `workDate` = wlDisplayDate(s) (15656), empty unless a manual plan_date or a Linear due_date exists. So an active unassigned sub with no date and status != "In Progress" is pushed to no list and `continue`d past every later bucket, including needsTweak at 16352. Confirmed no console warning covers it: the two warns in this function are for unrecognised clients (16286) and non-allowlisted video editors (16315). I verified the consumer inventory myself rather than taking it on trust. renderWorkloadShell (15808-15900) has exactly five panels: Team-workload matrix, work-day calendar, "Needs assignment" strip, "Needs a work day or deadline" strip, legend. wlState.unassigned is read by one renderer only (renderLooseIssueStrip via 18208). The matrix (17914-17922), the freest-first row (18049-18053) and the popover 'active' source (18768) all iterate planned/nowWorking/tweaksNeeded/overdue/undated — never unassigned. wlState.allActiveSubs reaches the popover only via `data-wl-issue-id` on a rendered rollup element, and these rows render no element anywhere, so that path is genuinely unreachable. `.workload-empty` (CSS 3876) has zero call sites in the file. LIVE MEASUREMENT (workload_issues, 1,940 active rows read with the public key, replaying wlIsActiveStatus + wlIsAllowedClient + the bucketing loop): 210 active sub-issues for seed-roster clients; 167 visible; 42 silently discarded (20%). Two clients go 100% blank: Miki Agrawal 4/4 lost (VID-9645/9646/9647 "16/17/18 video" and VID-10327, all Tweak Needed, VID-10327 last touched 2026-08-28 — flip day), and Jesse Israel via candidate 4's gate. Partial loss: Dr. Sonia Chopra 23 of 33, Kasper Hytonen 9 of 14, Baya Voce 5 of 21, Sidney Laruel 1 of 5. Dropped statuses: 34 Todo, 8 Tweak Needed. The no-empty-state claim is exact: hasAnyData (17692) is computed on the UNFILTERED lists, so with 167 rows visible globally it is truthy and renderWeekGrid/renderMonthGrid paints an empty week rather than

**Correction as the verifier framed it.** Scale: 42 of 210 active sub-issues for roster clients (20%), not 44 of 62; the "Needs assignment" strip lists 5, not 18 — the auditor's 62/18/44 figures count non-roster client names, which a separate gate drops with a console.warn. Drop the "every new card the video team makes on Monday lands in this hole" framing: 197 of 221 sub-issues created since 2026-08-20 are assigned and 213 are dated, so the hole is old stock, not the growth path.

**Traps in the obvious fix.** Routing the 42 rows into wlState.unassigned turns a one-line strip into a wall — renderLooseIssueStrip (18211) maps the entire filtered array with no cap, and 34 of the 42 are stale Todo rows (Sonia 23, Kasper 9) nobody has touched in months, so the strip that today shows 5 chips shows 47 (112 with sheet-merged clients). Worse, that strip is built with applyEditorFilter=false, which means its chips carry NO "Set work day" button — the fix would surface 42 rows and offer no action on any of them. Bucketing them into needsTweak instead is the more dangerous option: every downstream consumer keys on assigneeId (wlGroupRollups 17714, ensureEditor 17836, wlDayOverCapacity 15781), so undated unassigned rows would collapse into a phantom '?' editor and distort the capacity math the auto-placement pass depends on. The low-risk shape is the one commit bfb02742 already ratified for Kasper: a counted, reported notice above the board plus a real empty-state when the current filter yields nothing, leaving the bucketing untouched.

### 87.3 The SMM's Review tab (and its badge) drops a card at "For SMM Approval" that has no media — **FIXED 2026-08-31** (PR #1185, commit `c19e714e`): counted notice in both queue states; the media gate and the badge deliberately unchanged, pinned by `test/smm-review-stranded-media.js`. **THE SAMPLES TWIN WAS MISSED AND IS NOW ALSO FIXED (2026-09-01)** — see below.

**Verified by refutation attempt.** HOLDS — reproduced exactly, to the single card, on live data. MECHANISM. _calReviewItems (41756): in smm mode `if (!_calHasMedia(p)) return false;` runs BEFORE the awaiting-approval test. _calApprovalBadgeCount (41717) repeats the same skip, so the badge agrees with the wrong list. _calHasMedia (41642) is asset_url OR thumbnail_url non-empty. renderCalReview (41778-41784) then prints the empty state. I read the whole function: there is no stranded list and no notice on this path. LIVE MEASUREMENT (calendar_posts, 9,326 rows read with the public key; 695 non-archived, replaying _calComponentsFor / _calNormStatus / _calHasMedia): 11 non-archived posts have a component at "For SMM Approval"; exactly 1 is hidden by the media gate. It is client `lukecutting`, name "Video 1", id p_native_891c58824ab4a68aae00cff23ad1_1, video_status="For SMM Approval", asset_url and thumbnail_url both empty, video_deliverable_id=del_fe263739-… (native), scheduled_date=2026-08-31 — Monday — last written 2026-08-28T22:18:29Z, flip day. It is the ONLY awaiting card on that client, so the queue that renders "Nothing waiting on SMM approval right now" is 100% wrong for lukecutting, and the badge is 0. lukecutting is a real live client, not a test slug: 27 rows, cards Posted through 2026-08-29. The contradiction claim is exact. _calSmmMediaGap (41653) computes beyondProgress('For SMM Approval') && !asset_url = true, so the same card renders _calSmmWarnDotHtml on the month pill (41188) and week pill (41323), _calSmmWarnOverlayHtml on the Sheet card thumb (37350), and _calSmmWarnBannerHtml in the preview (42821) — all saying "No video linked." Three surfaces flag it; the fourth, the queue the SMM works approvals from, says nothing is there. The tab is unavoidable for internal users: tabViews at 34997 is `['smmreview','organizer','month','week']` whenever !_isClientLink, and 35006 wires the badge to _calApprovalBadgeCount('smm'). This is the exact archetype commit bfb02742 fixed on Kasper's side hours ago — I diffed it: the fix added a `stranded` bucket at the identical media gate and _kasperRenderStrandedNotice above the queue. The SMM's gate 200 lines away in the same file was not given the s

**Correction as the verifier framed it.** Live scale is one card, not four: across all 695 non-archived posts exactly one is hidden by this gate (lukecutting "Video 1", Monday 2026-08-31). The filing's "one visible card and three hidden ones" case, where the empty-state copy does not even appear, has zero live instances today — today the copy does render and does name the rule, so the disclosure is partial rather than absent.

**Traps in the obvious fix.** Do not un-gate the filter. _calReviewCardHtml is built around media, so admitting the card into `items` renders a broken review card offering approve/tweak actions on a deliverable that does not exist.

**THE SAMPLES TWIN, MISSED AND THEN FIXED 2026-09-01.** The paragraph below this
one said, on the day 87.3 was fixed: *"Whatever is done here must also be checked
against the Samples twin, which has the identical pair at
`_sxrApprovalBadgeCount` — fixing one surface and not its sibling is how this
gate got missed the first time."* It was missed the second time too. The calendar
got `_calReviewStrandedForMedia` / `_calReviewStrandedNoticeHtml` and a notice in
both queue states; samples got nothing, so a sample at "For SMM Approval" with no
`asset_url` and no `thumbnail_url` still vanished from the SMM queue under an
empty state claiming nothing was waiting.

Found by a post-flip audit rather than by anyone hitting it, which is worth
recording: the prediction was written down, in this file, and still did not
prevent the recurrence — a note that says "check the twin" is not a check.
`test/samples-review-stranded-media.js` now asserts BOTH surfaces carry the pair,
so the next divergence fails a test instead of being predicted again. The safe fix is the shape already ratified for Kasper in bfb02742: a counted stranded list plus a notice above the queue, card still excluded. The badge is the judgement call — counting stranded cards changes its meaning from "items to review" to "items needing attention" and would make it disagree with the list length, so the notice should carry its own count instead. Whatever is done here must also be checked against the Samples twin, which has the identical pair at _sxrApprovalBadgeCount (56878) — fixing one surface and not its sibling is how this gate got missed the first time.

### 87.4 Workload silently deletes an assigned sub-issue whose assignee is not in the five-name hardcoded editor allowlist — **FIXED 2026-08-31** (PR #1185): same repair as 87.2; the predicate is about TEAM, and the comment now says so.

**Verified by refutation attempt.** HOLDS on the user-visible harm, but the filing's supporting argument about the console diagnostic is wrong and the scale is one row. MECHANISM CONFIRMED. wlIsAllowedEditor (15511-15519) buckets by team FIRST: `if (wlTeamBucket(teamKey, teamName) === 'graphics') return WL_ALLOWED_GRAPHICS.has(norm); return WL_ALLOWED_EDITORS.has(norm);`. WL_INACTIVE_EDITORS is a separate check one line above. So the predicate is "not on this ROW'S team roster", while the comment at 16345-16347 justifies the drop as "Sub-issues stuck on FORMER editors". A current graphics designer assigned to a video-team row is dropped exactly like a departed one. The auditor read the predicate correctly. DATA CONFIRMED. I pulled VID-12809 from workload_issues: title "Thumbnail 3", status "Tweak Needed" (status_type started, so wlIsActiveStatus passes), due_date 2026-07-09 — 7+ weeks overdue — team_key VID / team_name "Video", assignee Rocío Perez (rocio@synchrosocial.com), client Jesse Israel, active=true, synced 2026-08-30T23:50Z. wlTeamBucket('VID','Video') returns 'video', WL_ALLOWED_EDITORS does not contain 'rocioperez', so it is dropped at 16348 before the tweaks bucket. Replaying the full bucketing: it is Jesse Israel's ONLY active sub-issue, so filtering Workload to Jesse Israel yields a completely blank board — Team workload showing the three video editors at zero, an empty calendar, both strips empty, and no message, for the same reason as candidate 1 (hasAnyData at 17692 is unfiltered). This is a thumbnail deliverable filed on the video team: Rocío has 409 rows total, 407 on GRA/Graphics and only 2 on VID/Video, of which this is the only active sub-issue. So it is one mis-teamed row, not a class. WHERE THE FILING IS WRONG. The claim that "the one diagnostic an operator would reach for tells them the opposite of what happened" does not survive measurement. I replayed the reporting loop at 16297-16307 against live data: `graphicsPass` = {Rocío Perez} — true, her 407 graphics-team rows do pass — and `videoDropped` = {"Rocío Perez (1)"}, emitted as a console.warn that names exactly the row that was dropped. The diagnostic is correct today. The auditor's scenario (a graphics designer who is

**Correction as the verifier framed it.** Strike the console argument: measured live, the console.warn correctly reports "Rocío Perez (1)" as dropped, and zero graphics-team rows are misreported as "passing through" — WL_ALLOWED_GRAPHICS covers the only graphics designer on staff, so the auditor's scenario has no instances. Scale is exactly one row (Rocío has 407 GRA rows and 2 VID rows, only this one active), so this is a single mis-teamed issue, not a systematic drop of current staff.

**Traps in the obvious fix.** Widening the guard is the tempting fix and the wrong one: wlEditorCapacity (15775) keys on the ROW'S team, not the person's, so admitting Rocío's VID row would open a second 4-unit/day video capacity lane for her alongside her real 15-unit graphics lane, double-counting one person across two rows of the Team-workload matrix and feeding wlComputeAutoPlacements a capacity model for a queue she does not work. A union-of-allowlists change also silently re-admits anyone assigned across teams, which is what the guard exists to prevent. The correct fix is the same reported-not-dropped shape as bfb02742, plus repairing the comment at 16345-16347 to say what the predicate actually tests and dropping the stale "(no graphics allowlist yet)" from 16309. The underlying data problem — a GRA deliverable filed on the VID team — is a Linear-side repair, not a code change, and post-flip nothing reconciles it on its own.

### 87.5 Video "Attach / replace" does nothing at all, silently, whenever asset access has not finished loading — a leftover graphics-only clause the open PR forgot — **FIXED 2026-08-30** (commit `d55332b8` + the seventh layer): the graphics-only continuation clause is gone.

**Verified by refutation attempt.** Independently confirmed at /home/user/client-analytics/index.html:47655. `_prodBeginAssetEdit`'s fast gate (47624) is now team-agnostic (`!issue || !_prodCanWrite(issue,'attachment')`), but the async continuation still reads `if (!liveIssue || _prodWriteTeam(liveIssue.team) !== 'graphics' || !_prodCanWrite(...)) return;` and refuses by RETURNING, so the guidance toast three lines below (47657) is unreachable for video. Every other layer permits video: _prodCanWrite/_prodRoleCanWrite (49973/49946, 'A creative attaches on their OWN team, video included'), the renderer (52984-53020, 'Attach is no longer graphics-only'), ARTIFACT_TEAMS = {graphics, video} at supabase/functions/production-write/index.ts:120, and staffAssetReadAllowed at supabase/functions/production-write/policy.mjs:300. Live read of syncview_runtime_flags confirms prod_authority = {"video":"syncview","graphics":"syncview"} (updated_by owner-runbook, 2026-08-28), so the button paints data-prod-write="on" on a video row. The not-ready state is not exotic: _prodAssetState seeds status 'idle' (47428), _prodRefresh calls _prodInvalidateScopedReads and then rebuilds _prodState.assets keeping only rows with a pending attachment write (54732-54738), and _prodAutoRefreshOnReturn fires that on every tab return past a 30s floor (54745-54771) — i.e. exactly the alt-tab-back-from-Frame.io moment. The read is only re-armed from _prodRender (55050), so the whole window from invalidation to the asset_access_read resolving is a dead click for video and a spoken one for graphics. Git history is decisive: the continuation clause was introduced 2026-08-25 by 4711fbba and was NOT touched by d55332b8 (the 2026-08-30 video-attach commit), whose own message says 'Attach was graphics-only at six layers' — it fixed six and left the seventh. test/prod-asset-attach-gate.js corroborates: case 4 asserts 'a video deliverable now opens the editor, like graphics' but only on a READY state; every slow-path case (1, 2, 5) uses the graphics ISSUE fixture, so the gap ships green. Scale is not zero: 3,736 rows in production_deliverables_browser_v1 have team=video versus 2,425 graphics, and video is the team that starts inside this app M

**Correction as the verifier framed it.** One detail is overstated: the click is not literally inert on screen. The forced `_prodEnsureAssets(id, true)` sets status 'loading' and calls _prodRefreshAssetSurfaces, so the adjacent "Refresh access" button flips to a disabled "Checking…" (52020/53016). No editor opens, no toast, no error — but there is that one incidental chrome change.

**Traps in the obvious fix.** Dropping the team term makes the continuation open the editor for video after a forced read. `_prodOpenAssetEditor` sets state.editing = true, and an editing state is PRESERVED (not deleted) by _prodInvalidateScopedReads (52463-52470) — so a draft seeded from a pre-refresh deliverable_file.url can now survive a projection swap on video rows exactly as it already does on graphics; a known behaviour class, newly reachable by 3,736 more rows. The recheck of `_prodCanWrite(liveIssue,'attachment')` must stay, or a mid-read role/authority change slips through. And test/prod-asset-attach-gate.js must gain a video slow-path case or the fix ships unproven — its harness stub `_prodWriteTeam: t => (t === 'graphics' ? 'graphics' : 'video')` already makes that case one line.

### 87.6 The "Project" control is a complete, searchable, ticked picker that can never change anything — and its refusal calls the tab "Preview - read-only" while the sidebar calls it "Native writes" — **FIXED 2026-08-31** (PR #1183): the picker refuses at the door, the row is a span, and every entry carries PROD_PROJECT_MOVE_UNSUPPORTED.

**Verified by refutation attempt.** Confirmed, though the line numbers have drifted ~35 lines. The Project side-card is rendered at index.html:55746 via _prodAttributionProjectControlHTML (55567); on a resolved row it emits a bare `<button class="prod-prop-btn" data-prod-prop="project" onclick="return _prodOpenProjectMenu(...)">` with no title, no data-prod-tip, no aria-disabled — unlike its three neighbours at 55635/55636/55637, which all carry _prodWriteGateAttrs and really do write post-flip. _prodOpenProjectMenu is `_prodOpenPicker('proj', ...)` (53525); _prodOpenPicker exempts proj from the write gate at 53491 (`if (kind !== 'proj')`), _prodOpenSub does the same at 53425, so no gate sentence is ever computed. _prodPickerSpec('proj') (53296) builds a search:true list of every project, _prodPickerHTML ticks the current one, and _prodWirePicker's pick ends `if (!item || kind === 'proj') return _prodReadonlyGuard();` (53360). The same picker is reached by right-click → Project — built by `menuItem('Project', ..., '⇧P', 'proj')` at 53860 while Move and Delete one and three rows below are built by the `disabled(...)` helper with .disabled, title and data-prod-tip (53862/53864) — by the ⇧P shortcut (49773), and by the bulk palette's `command('Move to project...', ..., 'proj', 'P', true)` (55259). docs/syncview-design/WIRED-PARITY.md:42 ratifies project moves as unsupported and says to keep them 'guarded or absent'; this one is neither. The copy contradiction is real and I read both functions: _prodPreviewText() returns 'Preview - read-only' (46512) while _prodModeText() (46513) returns 'Native writes' whenever both teams are syncview — which the live flag read confirms they are — and that string is painted as the sidebar chip.

**Correction as the verifier framed it.** The candidate cites _prodOpenProjectPicker (now 53559) as a second instance of the same defect. It is not: that function serves the PROJECT page's own status/lead/target pickers (pstatus/plead/ptarget), a different, uniformly read-only surface. Only the deliverable 'Project' property is the defect described.

**Traps in the obvious fix.** 'proj' is wired into `hasSub` in two independent maps (53845 for the context menu, 55192 for the bulk palette) plus the ⇧P handler and the side-card. Guarding it in one place and not the others leaves a menu entry that opens nothing on hover. If the fix instead corrects the refusal string, note that 'Preview - read-only' is _prodPreviewText()'s literal and is asserted as the ratified refusal text in the parity/pixel lane (docs/syncview-design/WIRED-PARITY.md:158, docs/syncview-design/tests/pixel-wired.js) and reused in ~10 call sites — so it needs an operation-specific sentence added beside it, not a global rename.

### 87.7 Approve greys out the instant a reviewer types a word, and nothing anywhere says why — **FIXED 2026-08-31** (commit `f36db763`): a shared, escaped `REVIEW_APPROVE_DRAFT_TITLE` fires on all five render sites when hasDraft, and each of the four per-keystroke updaters restores the button's real idle title from a `data-idle-title` attribute (never blanks or reconstructs it), so the split-button alt segment's own routing hint survives a type-then-clear cycle. Pinned by `test/review-approve-draft-title.js`, including an executed DOM-simulation regression test for the alt-segment survival.

**Verified by refutation attempt.** Mechanism confirmed. index.html:41951 `const approveEnabled = showApprove && !saving && !hasDraft && !inTweaks;` and hasDraft is `!!draft.trim()` (41941). The buttons are emitted with a bare disabled attribute and no title on every surface: calendar SMM split 42014, calendar client button 42018, SXR review 59212/59214, SXR Kasper queue 62424, Kasper hero 69737, Kasper panel 69793. Three in-place updaters (_calReviewOnDraftInput 42181-42183, _sxrReviewOnDraftInput 59298, 70031) flip `b.disabled = nowHasDraft || saving` per keystroke without re-rendering, so the state changes under the cursor with no accompanying text. The suppression is deliberate (comment at 41944-41949) but the design genuinely stopped at 'visible without being misclickable' and never supplied the sentence, while Comment and Request change immediately below both carry explanatory titles. This reaches real clients on the share link every week.

**Correction as the verifier framed it.** Two overstatements. (1) 'no recoverable signal of any kind' is too strong: the same keystroke that dims Approve simultaneously ENABLES Comment and Request change (tweakEnabled = canActClient && !saving && hasDraft, 41952), so the panel does signal a mode switch — it just never names it; and 'Comment' posts the note, clears the draft, and re-enables Approve, so the flow is one click, not 'delete every character'. (2) This is not a control that structurally cannot do its job: the precondition is the user's own unsent draft, is caused by the action they just took, and is reversible in one keystroke. It is a missing label on a deliberate correctness gate, and it predates the flip by months — the weakest of the survivors, and low rather than medium.

**Traps in the obvious fix.** The panel markup is duplicated across five surfaces and its enable/disable is driven by three separate per-keystroke updaters that never re-render. A helper line added at render time will not appear or disappear as the user types unless all three updaters are taught to toggle it, and a static `title` set at render time would then lie in the enabled state. Any fix has to touch the render sites and the updaters as one unit or it will drift the way this panel's other pairs have.

### 87.8 A locked component pill still tells the SMM to "Link a Linear sub-issue first" — the flip deleted every control that could do that, and names no replacement — **FIXED 2026-08-31** (PR #1185): one shared `WRITE_UI_NO_WORK_ITEM_TEXT` on both surfaces; the lock is unchanged, and no remedy is named because none exists in-app. The escalation to name is still the owner call.

**Verified by refutation attempt.** Confirmed end to end. index.html:37297 sets `lock` when the component is not caption/title and `!_calCompLinked(p, c)`; _calCompLinked (26947) is false only when BOTH the Linear id and the native deliverable id are empty. The pill then renders `disabled title="Link a Linear sub-issue first"` (37324, mirrored on the Samples surface at 58170) and its label is forced to N/A by _calPillDisplayStatus (26982). Meanwhile _writeUiLinkSlotSealed (25074) is true for both teams under the live flag, and _calLinearSlotHtml returns the empty string for an EMPTY sealed slot (36906-36911, comment: 'the warn below was actively asking people to create the defect'); _calProdSlotHtml returns '' with no deliverable id (36930); _calLinearPileHtml renders nothing when all four are empty (36951). So the tooltip names an affordance that is deliberately absent from that exact card, and the stale comment at 36012 still asserts it is present. There is no alternative to point at: _calOpenNativePost is reachable only from the two Add-card paths (39778 calendar, 58249 samples), and Production creation is closed for everyone by PROD_CREATE_CLOSED_TEXT (_prodCreateGateText, 50014). Measured live, not asserted: of 9,326 calendar_posts, 6,666 have both linear_issue_id and video_deliverable_id null and 7,087 have both graphic ids null; restricted to scheduled_date >= 2026-08-01 that is 133 and 116 cards respectively — cards an SMM is looking at this week. CSS gives the disabled trigger `cursor: not-allowed` with no pointer-events:none (5490), so the tooltip does surface on hover.

**Correction as the verifier framed it.** The candidate's 'the SMM cannot find the control' is right for the empty slot but worth bounding: a slot that DOES carry a Linear link still shows the open+remove pair (36899), so the missing affordance is specific to the empty sealed slot — which is precisely the state the tooltip fires in.

**Traps in the obvious fix.** The string lives on two surfaces (37324, 58170) and the pill's label and data-val are recomputed by two in-place updaters (44229, 57435), so copy changed in one place drifts. More importantly there is no honest remedy to name for an existing card — creation is closed and the native path is new-card-only — so correct copy has to say the card has no work item for that component and that it cannot be created from here, which is an owner copy ruling, not a mechanical edit. The explanatory comment at 36012 must be corrected in the same change or it will re-seed the same stale claim.

### 87.9 "Delete issues" in the bulk Actions palette is styled as a live command, while the identical Delete one menu away is disabled and explained — **FIXED 2026-08-31** (PR #1185, commit pending): both refused palette rows are greyed, keep `data-prod-ctx` so search and the arrows still index them, and are refused in `activate()` and `hi()`. Pinned by `test/bulk-refusals-honest.js`.

**Verified by refutation attempt.** Confirmed at index.html:55255 (the `command(...)` helper) and 55262 (`command(plural ? 'Delete issues' : 'Delete issue', ..., 'delete', '', false, true)`). Every palette row, destructive included, emits a plain `.prod-mi` with only a danger colour to distinguish it — no .disabled class, no title, no data-prod-tip. _prodWireBulkCommandMenu handles it with `if (act === 'delete') { _prodReadonlyGuard(); _prodClearLayer(); }` (55193). The identical single-row command is built by the `disabled(...)` helper at 53864 with .disabled plus title and data-prod-tip carrying the refusal — the house pattern also used by _prodCreateTopbarButton and _prodAddSubIssueButtonHTML (50014). This matters because the palette really is a live write surface post-flip: Assign/Change status/Change due date route through _prodOpenSub → _prodRunPickerWrite and write for real. Deletes are ratified unsupported in docs/syncview-design/WIRED-PARITY.md:42.

**Correction as the verifier framed it.** One mitigating signal the candidate missed: the '⌘ Actions' button that opens the palette carries `title="Preview - read-only"` (55287). That is a weak and, post-flip, itself-false label — the palette's other four commands write — so it does not rescue the Delete row, but the surface is not entirely unlabelled.

**Traps in the obvious fix.** _prodWireBulkCommandMenu's keyboard `activate()` and its search filter both iterate `[data-prod-ctx]` rows (55191, 55219). A disabled row that keeps data-prod-ctx still fires on Enter; one that drops it falls out of the search/highlight index and shifts `sel`. The builder and the wiring have to change together, and the same is true of the 'Move to project…' row in the same list.

### 87.10 The group-header select-all checkbox refuses a purely client-side selection, and blames write authority for it — **FIXED 2026-08-31** (commit `f36db763`): the click guard and the checkbox's own hover tip both now use `PROD_GROUP_SELECT_UNSUPPORTED`, naming shift-click and Ctrl/Cmd+A instead of borrowing the read-only preview sentence. Behavior is unchanged — the checkbox still refuses to select; actually wiring it up is deliberately left for its own review, per the traps below. Pinned by `test/prod-group-select-honest.js`.

**Verified by refutation attempt.** Confirmed. index.html:55354 renders the group check with `onclick="event.stopPropagation(); return _prodGuardGroupSelection(key)" data-prod-tip="Preview - read-only"`, and _prodGuardGroupSelection (54615) is exactly `_prodReadonlyGuard(); return false;`. Selection is demonstrably not a write anywhere else in the same view: _prodToggleRowSelection (54440) mutates _prodState.selected with no gate, and Ctrl/Cmd+A rebuilds the whole set with no gate (49673-49677). The parity doc ratified only the VISUALS, not the refusal — WIRED-PARITY.md:173 says the .partial/.on group states were ported 'without enabling bulk writes', and line 202 confirms local selection chrome is explicitly allowed ('plain x toggles local selection chrome only'). So the guard is over-broad against the codebase's own rule, and the reason it gives is wrong twice: selection is not a write, and the sentence it prints is the same 'Preview - read-only' the sidebar chip contradicts with 'Native writes' under the live flag. The checkbox even paints its own state ('on'/'partial', computed at 55353 from per-row selections), so it reflects a state it will not let you set.

**Correction as the verifier framed it.** Cost to the user is small — shift-click and Cmd+A both do the job — so this is low, not a Monday blocker. It belongs in the sweep as the cheapest of the seven to make honest, not as a priority.

**Traps in the obvious fix.** Making it select is the smaller change but widens what lands in _prodState.selected, which feeds _prodSelectionBar, the bulk palette, and the guarded S/A/⇧D/⇧P shortcuts: a whole-group selection will include synthetic batch parents and attribution-repair rows, so _prodOpenSub's 'Applying to N of M' notice (53433-53438) will start firing routinely — correct, but noisy on day one. Removing the checkbox instead breaks the ratified .partial/.on visual parity (WIRED-PARITY.md:173) and its pixel-wired assertions.

### 87.11 A failed full Production refresh is recorded as a successful sync — and erases the failure notice the tab had already earned — **FIXED 2026-08-31** (PR #1185): `_prodLoadData` returns false; `_prodDeltaRefresh` routes that into the failure arm.

**Verified by refutation attempt.** Independently established by reading the current tree (line numbers below are today's; the filer's were ~150 lines stale). `_prodLoadData` (index.html:54393) computes `silent = !!(opts.silent && _prodState.loaded)`; its catch arm at index.html:54455-54456 is `console.warn('[Production] background refresh failed', e); return;` — no rethrow. An async function that catches and returns RESOLVES. `_prodDeltaRefresh` (index.html:55074) gates on `_prodState.loaded` at 55076, so silent is always true when it calls `await _prodLoadData({ silent: true })` at index.html:55100. Control therefore falls straight through: 55101 sets `lastFullSyncAt = Date.now()`, and 55130-55132 set `lastSyncAt = Date.now()`, `lastSyncError = ''`, `refreshFailures = 0`, then `return true`. Nothing was read. The finally block at 55137-55142 sees `hadError !== !!lastSyncError` and forces `_prodRender()`, so the whole freshness control is re-emitted from `_prodFreshnessHTML` (55027-55042) as fresh, including the `title`/`data-prod-tip` text 'Production refreshes automatically while this tab is open.' Reached by a real person two ways: the header Refresh button (`_prodManualRefresh`, index.html:55049-55056 — toasts 'Refreshing production data…' then calls `_prodDeltaRefresh({force:true, full:true})`), and the background tick every PROD_FULL_RECONCILE_MS = 10 min (55082-55084, driven from 55168). The sharpest form is the WARM BOOT, which the filer under-stated. `_prodHydrateFromCache` (index.html:46900-46926) restores clients/members/batches/deliverables from a snapshot whose TTL is 24 h (PROD_CACHE_TTL_MS, index.html:46583) and does NOT set `lastSyncAt`, so the chip honestly reads 'not yet synced'. A video or graphics team member opening Production on Monday over a flaky connection presses Refresh once and the chip becomes 'updated 1s ago', not degraded, over a board that may be a day old — and on this path no delta tick has failed yet, so nothing on screen contradicts it. Not fixed on the branch: `git log -15 -S"_prodDeltaRefresh"` returns nothing newer than 6557d384/f1266aed, and the uncommitted index.html diff has no hunk inside 54393-55145. Measured context: the projection is 6,161 rows = 7 ke

**Correction as the verifier framed it.** Two of the filer's three compounding consequences need trimming. (1) The backoff claim is overstated: only FULL attempts reset `refreshFailures`; a failing delta tick still increments it at index.html:55127, so `_prodOperationalRefreshDelay` (55146-55150) does engage between reconciles. (2) The lie is usually bounded, not permanent: ~30 s later the next tick takes the delta branch (watermark is intact, lastFullSyncAt was just advanced), fails, and re-sets `lastSyncError`. The genuinely durable sub-case — worth naming in the fix — is a failure confined to the reads the delta branch never repeats: clients, team_members, batches and authority. There the chip stays honestly-green forever while the roster/board metadata is frozen, and each failed attempt pushes `lastFullSyncAt` out another 10 minutes so `_prodMergeDeliverableRows` (index.html:54995-55011), which is add/update only, can never converge deletions. Also 'degraded banner' is imprecise: there is no banner, only the chip's `data-prod-freshness="degraded"` styling and its tooltip text.

**Traps in the obvious fix.** Do not simply make `_prodLoadData` rethrow in silent mode. Two other silent callers — `_prodAutoRefreshOnReturn`'s `_prodRefresh({silent:true})` (index.html:54923) and the two post-create reloads at index.html:50793 and 50835 — currently rely on it never rejecting; a rethrow there produces an unhandled rejection and a console error, which the boot probes fail on by contract (qa/probes/lib.js's zero-console-error gate). The low-risk shape is to have `_prodLoadData` RETURN a boolean (true on the success path, false from the silent catch) and have `_prodDeltaRefresh` treat false exactly like a thrown error at 55126-55134, leaving `lastFullSyncAt` un-advanced. Second risk: the 401/403 branch already calls `_prodCachePurge()`, so a fix that also marks the tab degraded on tha…62152 tokens truncated…ITERALLY. Three more probes build
theirs by concatenation —
`for (const wh of ['linear-set-status', …]) ctx.route('**/webhook/' + wh, …)` —
so `p47_title_review.js`, `p60_modal_smm.js` and `p68_linear_link_clear.js` were
never seen, and the offline test passed while all three still exercised a healthy
Linear during the documented full-manifest dead run. **There were seven, not
four.** All three are now converted to the shared helper, and the detector keys on
the WEBHOOK NAMES near the registration — pattern plus a 250-character lookback
that reaches the loop header — rather than on the shape of the pattern string.

One deliberate exclusion, recorded so nobody "fixes" it:
`ot4_t1_submit_intake_guards.js` has a `route('**/*')` catch-all naming two Linear
paths, but it is a sealed fixture whose default is `route.abort` — it refuses
everything it does not name and is not pretending Linear is healthy. Classifying
on the PATTERN rather than the whole handler body keeps it out without loosening
the check, which matters: the alternative was a false alarm that someone would
eventually silence by weakening the rule.

**G3.** `qa/probes/linear-hook-fulfil.js` was missing from `REPO_MAP.md`. Added.

**The count for this lane is now four guards that looked checked and were not:**
the wrong-polarity mock, the freshness watcher aimed at a source with no
watermark, a per-file assertion that survived reverting one of two handlers, and
now a detector blind to string concatenation. Every one was found by an
adversarial reader or a mutation, never by reading the code again. That is the
transferable lesson from this lane, and it is worth more than any single fix in
it: **write the mutation and watch it fail to go red.**

**Addendum, 2026-09-08, after merging main (`81a7b55`) — the LX-RESTORE
correction that lands on this lane, and the one it does not.** Item 179 point 6
reports that brief F's cutoff `undo:` drops "the four functions" where
`migrations/2026-09-06-linear-outbound-cutoff.sql` creates **seven** — four
service-only RPCs plus three trigger functions sharing their triggers' names.
Checked against the runbook rather than assumed: cost item 5 of §0 already counts
"7 functions, 3 triggers, 1 view, 1 table, 4 columns, 1 check constraint", so the
runbook was independently right and needs no correction. The brief is the wrong
document, and this lane does not execute it — §0's whole argument is that the
migration is not installed at all, so its undo is never taken on the prepared
path. **What did change:** the "if the owner wants the fence anyway" pointer at
the end of §0 now carries an explicit warning not to reuse the brief's undo for
that later lift, plus the fact that the migration is not re-runnable, so a partial
undo cannot be repaired by re-applying it. That pointer was the one place a reader
could have left this runbook holding a defective procedure.

**Ledger numbering, same merge.** This entry moved 175 → 180 (see **Number.**
above). Item 168's "spares from 176 up" rule is spent: on `81a7b55` the numbers
175 and 176 are each claimed twice and 178/179 are taken. **Superseded one merge
later:** lane LX-N8N claimed 181 on `main`, so the next free spare is **182** —
see the **Number.** paragraph above. The four pre-existing duplicate headers item
168 baselines (13, 14, 22, 23) are still four; neither merge added a new one.

**Proof bar on the merge.** `npm test` on the merge commit: 1 of 419 suites
failed, `test/truth-sync.js`, at **515 passed / 14 failed** — the documented
shallow-clone baseline, no delta. `node test/f27-reconciler-closure.js` passes 37
assertions, so the `scripts/monitoring-watchdog.js` closure pin still verifies
after main absorbed part 1 (PR #1348, `e797444`). The merge brought main's
`index.html` changes into the branch, as merges do; `git diff origin/main...HEAD`
lists no `index.html`, so this lane still touches none of it.


**Addendum, 2026-09-08, after merging main (`7291b55`) — a fifth guard that
looked checked and was not, found by another lane.** OPEN_REPAIRS 181 (lane
LX-N8N) names four webhooks that reach Linear through their n8n workflow while
carrying no `linear-` prefix: `editors-week`, `send-urgent-slack` (shaped like a
Slack write, but it resolves the issue's *current Linear assignee* to pick the
mention), `video-form` and `graphic-form`. Verified against this tree —
`index.html` calls all four, and `LINEAR_HOOK`'s prefix match sees none of them.

**Why this mattered more than a missed pattern.** The rehearsal's whole purpose
is to answer "does the app survive Linear being unreachable". Counting `linear-*`
names answers a different question — "which Linear-NAMED webhooks are
intercepted" — and the two look identical until something reaches Linear without
the name. Left as it was, a dead-Linear run would have sent these four to real
n8n and a **healthy** Linear, then reported four Linear-dependent flows as
surviving Linear's death on the strength of them having used a live one. That is
this mode's own founding polarity error, one layer further out, and **it would
have passed every assertion already in the suite.**

**The fix is dead-mode only.** `LINEAR_BACKED_HOOK` intercepts the four under
`if (LINEAR_DEAD)` and nowhere else. Healthy mode is untouched deliberately: the
courier has never mocked these four (one probe,
`ot4_t1_submit_intake_guards.js`, mocks `video-form`/`graphic-form` itself), so
mocking them in normal mode would silently change every existing probe rather
than only the rehearsal. `kasper-queue` is excluded alongside
`log-linear-submission` — it reads Sheets and survives Linear untouched.

Six mutations, each confirmed red before the fix was called done: dropping
`send-urgent-slack` from the pattern; widening it until it swallows
`log-linear-submission`; unanchoring the path boundary so it matches by prefix;
pinning the backed branch to one fixed fault instead of the rotating sequence;
firing the branch in healthy mode; and swallowing the `refused` shape with a 200
instead of aborting.

**The count for this lane is now five**, and the fifth is the one worth keeping:
the four before it were found by an adversarial reader or a mutation of my own
code. This one was found by **another lane's inventory of a system I had not
inventoried** — I had counted the webhooks whose names contained the word I was
looking for. No amount of re-reading my own regex would have surfaced it, and no
mutation of my own file would either, because the missing names were never in it.

**Addendum, 2026-09-08, after merging main (`8ea7809`) — my STEP 3 precondition
was one step short, and the missing step is the whole gate.** The coordination
lane's `docs/independence/LINEAR_EXIT_MASTER_SEQUENCE.md` landed on `main` and
flagged that an earlier draft of its own P1 named only three of the mint's four
live actions. This runbook's P1 had the same defect: it said the mint must be
"APPLIED AND SEEDED", which is steps 1-3.

Verified against the primary source rather than the summary —
`docs/ops/NATIVE_IDENTIFIER_MINT.md:82-91` lists four actions and says of the
fourth, in its own words, *"Step 4 is what lane F's outbound-off step waits on."*
Step 4 flips `syncview_runtime_flags.production_native_identifier_mint` to
`{"schema_version":1,"video":{"mode":"native"},"graphics":{"mode":"native"}}`,
and `production_native_identifier_capability(team)` returns `native` only when
the flag says native **and** a seed row exists. Stop after step 3 and the
allocator is installed and refusing: the mint is inert, a new card still takes
its name from Linear, and STEP 3 produces the precise nameless-card failure P1
exists to prevent.

**Why this one is worth recording rather than just fixing.** A precondition that
is three-quarters right is more dangerous than one that is absent, because it
gets ticked. An operator who applied the migration and seeded both teams would
have read P1, found it satisfied, and run STEP 3 into an inert mint. P1 and STEP
3 now both name all four steps and mark step 4 as the gate, with its undo
(`{"mode":"provider"}` per team) beside it.

**The check that already covered this, and why it stays.** P1 has always ended
with an empirical readback — create one card on `sidneylaruel` and read back a
non-null `deliverables.linear_identifier` that Linear did not mint. That test
fails correctly against a half-done gate no matter how the prose is worded, which
is the argument for ending every precondition in an observation rather than a
checklist. It is now stated as the check that cannot be satisfied by a half-done
gate, and ordered before the second team is seeded.


## 181. [2026-09-08, lane LX-N8N, WRITTEN — a plan, nothing executed] The seven n8n webhooks that die with Linear, and the three source documents that each get the list wrong differently

`181` was verified free before writing: the ledger's numbers run 1–129, 134–162,
170, 173, 174, and item 174 records the lane reservations (A took `169`, C took
`171`/`175`/`176`, D took `172`, E took `173`, F took `174`). Nothing claims
`177`–`180` on `main`; this lane takes `181` rather than the next free number so
a concurrent lane landing in the gap does not collide.

**Deliverable.** `docs/independence/N8N_REPLACEMENT_PLAN.md`. Read-only lane: no
n8n workflow was created, edited, activated, deactivated, or run; no migration,
deploy, or write of any kind.

**The list, re-derived from `main@d8866d9` rather than a July snapshot.** Seven
browser-called n8n webhooks reach Linear and fail when the account lapses:
`editors-week`, `linear-issues`, `linear-issue-statuses`, `linear-subissues`,
`linear-tweak-comments`, `linear-projects`, and — the one no reader list carries
— **`send-urgent-slack`**, which is shaped like a Slack write but resolves the
issue's current Linear assignee to pick the mention. Four more write Linear and
die with it (`linear-set-status`, `linear-add-comment`, `video-form`,
`graphic-form`). Two that look Linear-bound survive untouched:
`log-linear-submission` appends a Google Sheet, and `kasper-queue` reads Sheets.

**The three sources disagree seven ways**, each verified on `main@d8866d9` and
tabled in §2 of the plan. The two most likely to cost someone a day:

- **Every line number in `LINEAR_CUTOVER_TOUCHPOINT_INVENTORY.md` is dead.** It
  was verified at `e3961b6` on 2026-07-14 and says so, but nothing warns that its
  anchors have since moved by tens of thousands of lines. Not one range still
  points at its code — `editors-week` is cited at `index.html:43879-43925`; today
  its constant is at `22419` and its single fetch at `78774`. The dispositions in
  that document remain the best thinking available; only its coordinates are
  gone.
- **`docs/truth/ENDPOINTS.md` says "n8n webhooks (54)"; the real count is 56.**
  The *set* it enumerates is right and `test/truth-sync.js` proves it — but the
  parenthetical in the heading is not machine-checked, so it drifted two behind
  when `tiktok-upload-url` and `tiktok-upload-direct` landed on 2026-08-18.
  `SYSTEM_MAP.md:1537` is the correct one.

**One finding that is not a documentation problem.** The native replacement for
`editors-week` (PR #1346) reads `public.deliverable_events`. That table is
granted `select` to `anon` and `authenticated` under a permissive `using(true)`
policy (`migrations/2026-07-06-b1-linear-data-model.sql:682-688`, `:698`), and
**no migration in this repo revokes it.** The F53 migration
(`2026-07-23-f34-f53-production-attachments.sql:280,296`) revoked table-level
SELECT on `batches` and `deliverables` from `public, anon, authenticated` and did
not include `deliverable_events`; the only carve-out since is one restrictive
policy covering comment-body snapshots
(`2026-07-12-production-comments.sql:158-161`), which leaves the ordinary
activity rows — `client_slug`, `actor`, `role`, `from_status`, `to_status`, `ts`
— anon-readable. That is F48's exposure shape reproduced natively. **This is a
source-level reading; the live grant was NOT checked** and several tables here
were created by hand-run SQL that never reached the repo. Verify live before
relying on the finding or on its absence.

**The parity gap the replacement does not close.** `deliverable_events` has no
event-time assignee column, so attribution must join through
`deliverables.assignee_id` — the *current* assignee — which is exactly the defect
F48 records in the legacy endpoint. `CUTOVER_AUDIT_2026-07-13.md` already
measured what that costs (of 401 source transitions for the same production
videos, 27 absent natively and 239 unmatched or duplicative). Closing it needs a
schema change that is outside this lane and, as far as the PR description shows,
outside #1346. Until it lands the native Editors tab has delivery-count parity,
not report parity, and `GO_LIVE_CHECKLIST.md:999` is right to gate retirement on
full §9.11 parity.

**Ordering, stated because getting it backwards is a live outage.** `main`
today still calls `editors-week` at `index.html:78774`, so **PR #1346 must merge
before the endpoint is deactivated** or Kasper's Editors subtab dies with no
fallback beyond a one-week cache. The full order for all eleven endpoints is §5
of the plan. Two more that are easy to get wrong: `linear-issues` has a second,
undocumented caller (the Calendar bulk-create link poll shares its feeder and
cache), so merging the Workload half alone is not sufficient; and
`linear-projects`' legacy half must not be deleted until every client is enrolled
in `write_ui_reroute_clients`, because the native branch is cohort-gated and
un-enrolled clients would get an empty Submit dropdown — the "absence a user
cannot debug" failure the owner's permissive rule exists to prevent.

**What could not be established** is named specifically in §6 of the plan, eight
items: no live n8n workflow was inspected (the readbacks this leans on are eight
weeks old), the `deliverable_events` grant is source-level only, response shapes
are inferred from what the browser consumes rather than from a captured response,
#1346's diff was not read, `LINEAR_EXIT_LANES.md` is on #1351's branch and not on
`main` so the authoritative lane order could not be consulted, and no row counts
are published at all — deriving them needed a live read this lane did not take,
and `AGENTS.md`'s 2026-09-05 rule says an unmeasured number is worse than none.

### Addendum, 2026-09-08 — the n8n plan is merged, and one of its findings changes the degradation table

PR #1356 merged. `docs/independence/N8N_REPLACEMENT_PLAN.md` is now on `main`,
and three of its findings are folded into
`docs/independence/LINEAR_EXIT_MASTER_SEQUENCE.md` rather than left to be
discovered by whoever reads the two documents in the right order.

**1. `send-urgent-slack` is a Linear reader and no previous list carried it.**
Added to the 2026-09-15 degradation table. It is shaped like a pure Slack write,
and it is, except that it resolves the issue's **current Linear assignee** to
decide who to mention. It fails with the account. The method point is worth more
than the row: **an endpoint's dependencies are not inferable from its name or its
effect.** The mirror image is in the same finding — `log-linear-submission` only
appends a Google Sheet and `kasper-queue` only reads Sheets, so two endpoints
that read as Linear-bound survive untouched. The list was re-derived on `main`
instead of carried forward from the July audit, which is the only reason any of
this was caught.

**2. The `deliverable_events` anon grant is an independent, mandatory revoke.**
PR #1346's native `editors-week` reads `public.deliverable_events`, granted
`select` to `anon` under `using(true)` in
`migrations/2026-07-06-b1-linear-data-model.sql:682-688,698`, with no revoke
anywhere in this repo — F53 covered `batches` and `deliverables` and not this
table. That is F48's exposure shape reproduced natively. **Serving it through an
authenticated Edge Function does not satisfy the requirement**, because the
publishable key is committed and reaches the table through PostgREST regardless.
The master sequence's held-PR table now says #1346 carries this as an attached
obligation, so that merging it is not mistaken for closing F48's shape.

Recorded with the limit the lane stated and did not smooth away: this is a
**source-level reading and the live grant was not checked**, and tables here have
been created by hand-run SQL that never reached the repo. Verify live before
relying on the finding *or* on its absence.

**3. Every line number in `LINEAR_CUTOVER_TOUCHPOINT_INVENTORY.md` is dead.**
Verified at `e3961b6` on 2026-07-14, and nothing in it warns that its anchors
have since moved by tens of thousands of lines. Not one range still points at its
code. Its dispositions remain the best thinking available; only the coordinates
are gone. This is the same defect class as the truncated briefs and the
mis-scoped reversibility quote, in its third distinct shape: **a document that is
correct about what it says and wrong about where it points.**

**Addendum, 2026-09-08 — the §0 headline was scoped correctly in its evidence and
not in its sentence, and STEP 7 counted the wrong unit.** PR #1360 (the
coordination lane, unmerged at the time of writing) reports that labels reach
Linear from `production-write` ungated, and — more usefully — describes the trap
that produced it: *"I replaced a generalisation with an enumeration and did not
verify the enumeration, which produces a more confident wrong statement than the
vague one it replaced."* Both halves apply here, verified against the tree rather
than taken from the report.

**1. §0's claim was true and read wider than it is.** Every citation in it is to
`supabase/functions/linear-outbound/index.ts`, and the conclusion — the outbound
mirror stops on a flag, with no deploy — holds exactly as computed. But the
sentence *"no request reaches `api.linear.app`"* sits under a heading about the
whole cutoff, and a reader can carry it further than the evidence goes.
`production-write` reaches `api.linear.app` (`:241`, `:2291`) through four helper
functions that **no runtime flag gates**. It declares
`const OUTBOUND_FLAG = "linear_outbound_enabled"` at `:239` and never reads it
again — **the constant is dead**, so nothing in STEP 1-4 touches those reads. §0
now states the scope in its own words: the flags stop the outbound mirror, they do
not stop production-write, and nothing in this runbook claims otherwise. Which
was already the runbook's structure — P5 and STEP 7 exist for precisely these
reaches — but structure is not a sentence, and the sentence is what gets quoted.

**2. STEP 7 said "all FOUR of production-write's Linear call sites" and there are
nine.** Four HELPERS reach the API, through nine direct call sites, depended on by
five request handlers (`handleLabelsRead`, `handleEntityOperation`,
`handleCreateOptions`, `handleProductionCreate`, `handleAssigneeOptions`) plus five
intermediates. "Four" was right about helpers and wrong about call sites, and the
row gave one number for both. Worse, the label row's staff-visible column named
only *"cannot pick a label"* — the same helper also serves the label **read**
(`:4947`) and the label **write on an existing card** (`:5491`). Three surfaces,
one helper, one named. The table now separates helpers from call sites, because
they answer different questions: helpers are the unit for *what lane B removes*,
call sites are the unit for *whether they all went*.

**The pattern, stated because it is now three for three today.** P1 named three of
four mint steps. The rehearsal counted `linear-*` names instead of Linear
dependencies. STEP 7 counted helpers and called them call sites. Every one is an
enumeration that replaced a vaguer statement and was never itself checked against
the tree — and each read as *more* authoritative than what it replaced, which is
the actual harm. **An enumeration is a claim about completeness; it needs the same
verification as any other claim, and more than the generalisation it improves on.**

**Addendum, 2026-09-08 — STEP 7 named a failure that cannot happen, and P1 copied
a line its own source has since retracted.** Two more from PR #1360's later
rounds, both verified against the tree here rather than accepted from the report.

**1. "Revoking turns *create a deliverable* and *pick a label* into 503 for
staff" was half wrong, in the direction that inflates urgency.** Production
create has been closed since the owner's 2026-08-23 ruling, and the closure is
enforced in **two independent places that do not reference each other**:
`handleProductionCreate` throws `403 production_create_closed` at
`production-write:3592`, which is **above** its Linear reaches at `:3604`/`:3605`;
and `_prodCreateGateText` returns `PROD_CREATE_CLOSED_TEXT` as its *first
statement* at `index.html:53854`, above code the source labels *"kept,
unreachable, as the exact undo if the ruling is ever revisited"*. So the create
path never touches Linear from either side.

The surfaces that ARE live on revocation are label **read** (`handleLabelsRead`
`:4947`), label **write** on an existing card (`handleEntityOperation` `:5491`),
and the **assignee picker** (`handleAssigneeOptions`, reached from
`index.html:50116`, not behind the create gate). STEP 7 now names those three and
says why creating is not among them. Naming a failure that cannot happen is not a
harmless over-warning: it spends the reader's attention on the wrong row and
makes the other three look like part of a list they can discount.

**One that is neither live nor safe, and needs its own row:** `handleCreateOptions`
has **no closure check at all** — it validates surface and goes straight to
`linearLabelCatalog` + `mappedCreateAssignees`. It is unreachable only because both
browser entry points render disabled. **A live endpoint behind a dead UI**, which
becomes staff-visible the moment the create ruling is revisited. The transferable
fact about this codebase: **reachability here has two halves that do not cite each
other, and tracing one teaches you nothing about the other.**

**2. P1's proof step said "before seeding the second team". Its own source
retracted that.** Steps 2 and 3 seed both teams; a seed row is inert until the
flag moves, so the per-team caution belongs on the **step-4 flag transition**, the
only step that changes behaviour. I had copied the source's sentence at the same
time as correcting the source's omission of step 4 — reading it closely enough to
find one defect and not closely enough to notice it contradicted its own table
four lines above. Now reads *"before flipping the second team's flag"*.

**The through-line for whoever reads this ledger later.** Every defect in this
lane's docs today has been a **derived artefact disagreeing with a source that was
itself correct** — the table, the checklist, the summary sentence. The facts have
been right and the restatements wrong. That is the opposite of where review
attention naturally goes, and it is concentrated in exactly what a hurried
operator actually reads.

**Addendum, 2026-09-08 — the live-surface table I had just corrected was still
missing the common case.** One round after STEP 7's live/not-live table was
written, PR #1360 found that appends reach the provider by a route nobody had
traced. Verified here independently against the tree:

`parentRouteForAppend` (`production-write:2359`) calls `validateLinearBatchParent`
— a `linearRead` caller — whenever `validateExternal` is true, and it is true at
all three append sites. `handleComponentFill:6038` passes **seven** positional
arguments, so `validateExternal` takes its default `true`. `handleIntakeCreate`
`:6701` and `:6721` pass **eight**, with `validateExternal = !exactRowRetry`,
which is `true` on any normal append. Counted argument by argument rather than
inferred from the signature, because the positional default is the whole
mechanism.

**So two more staff surfaces go 503 on revocation — component fill, and every
append into an existing batch — and the second is the case most staff hit most
often**, since most posts join a batch that already exists. STEP 7 now carries
both rows and says so in the summary sentence.

**Why this one is instructive rather than just another miss.** The route reaches
Linear through neither the create path nor `projectForIntake`. Anyone tracing "how
does a post reach the provider" from the create flow — which is the obvious place
to start, and where I started — never arrives at it. The same blind spot produced
a proposed repair AND the acceptance checks meant to prove that repair, because
both were derived from the same reading. **A check derived from the same trace as
the fix cannot catch what the trace missed.** The argument that follows, and it
is the one worth carrying out of this lane: derive acceptance criteria from an
inventory of the operations a person performs, not from the code path you happened
to follow.

**Running count for this lane's documents today: six.** Three of four mint steps;
`linear-*` names counted as Linear dependencies; helpers counted as call sites; a
warning about a failure that cannot happen; a retracted line copied forward; and
now a live-surface table missing the commonest surface — written one round after
the table itself was the correction. Every one a derived artefact disagreeing with
a source that stayed correct.

**Addendum, 2026-09-08 — a DELIBERATE sweep of this runbook's own derived
artefacts, run instead of waiting for the seventh finding.** Six corrections
today had all arrived the same way: another lane found a restatement of mine that
had drifted from a source that stayed correct. Rather than wait, I swept the
runbook's tables and preconditions against their sources. Four findings, all mine,
none reported by anyone.

**1. STEP 6's list omitted a scheduled job it should have decided about.**
`linear-outbound-drain.yml` (cron `*/10`) keeps invoking `linear-outbound` every
ten minutes forever after STEP 3. It is genuinely harmless — `mode:"off"` makes
`readRows` return `[]` — and that is exactly why it survives: it holds no Linear
credential so the cutoff inventory never flags it, and it has no lane so the
dead-man's switch never mentions it. STEP 6 now requires a decision (disable, or
register as retired) rather than leaving it running by omission.

**2. The nightlies will keep proving the app survives a Linear that is gone.**
`grep -l SYNCVIEW_QA_LINEAR_DEAD .github/workflows/` returns **nothing**.
`samples-e2e-nightly.yml` and `calendar-e2e-nightly.yml` run the probe manifest on
a schedule with Linear mocked HEALTHY, and nothing flips them at the cutoff. From
2026-09-16 both go on passing, green, every night, against a Linear that has been
switched off. **This is this lane's founding polarity error at the schedule level
rather than the harness level** — and it would have shipped inside the very PR that
exists to correct that error. STEP 6 now carries the flip, with its one-line undo,
its verification (a run whose `linear_calls.jsonl` has `dead` values), and the
reason it must happen AT the cutoff and not before: flipping today turns both
nightlies red for a condition that is not yet true, and a red nightly everyone
learns to ignore costs more than the gap it announces. **The runbook does not edit
those workflows** — they are not this lane's, and the change would alter behaviour
before the cutoff.

**3. Extending STEP 6 silently invalidated its own abort row.** §4 row 6 said
"re-enable workflows/nodes; un-retire the lanes". Two paragraphs after adding two
new actions to STEP 6 I had left its undo describing the old step. Caught in the
same pass that created it, which is the argument for sweeping a change against the
table that summarises it *in the same edit* rather than trusting the next reader.

**4. P4 gated nothing.** `P4` appeared exactly once in the document: its own row.
P1/P2/P3 name STEP 3, P2 names STEP 6, P5 names STEP 7 — and the census
precondition named no step at all. It now gates STEP 3, which is where it belongs:
after outbound goes off the queue stops being consumed, so whatever the census
would have shown is what you freeze in place. **A precondition no step references
is decoration, and a reader who notices that is entitled to conclude the same
about its neighbours.** Also corrected in the same table: P1's row TITLE still read
"APPLIED AND SEEDED", the exact three-of-four formulation whose correction is
spelled out inside the cell — the stale summary sitting directly above its own fix,
which is the one line a hurried reader actually scans.

**What the sweep is worth as a method.** Six findings came from other lanes reading
my documents; four came from reading my own with the specific question *"which
sentence here is a restatement, and have I checked it against what it restates?"*
That question is cheap, it is answerable without any live access, and it found
things in twenty minutes that six rounds of review had not. It belongs in this
lane's handover as the standing check, not as a one-off.

**Addendum, 2026-09-08 — the sweep continued, and its first catch was the sweep's
own newest sentence.** Four more, all mine, all found by the same question.

**5. `dead` in the log does not mean dead mode ran, and I had just written a
verification that assumed it did.** The `api.linear.app` guard writes
`{path:"api.linear.app", dead:"refused"}` **in every mode, healthy included** —
deliberately, as a belt so a real-browser probe can never mutate a real editor's
issue (`sxr_courier_lib.js:595-600`, comment: *"ALWAYS refused, in every mode"*).
So any check of the form *"the log contains `dead` values"* passes on an ordinary
healthy run. STEP 6's nightly-flip verification said exactly that, written **hours
earlier in the same sitting that established sweeping restatements as this lane's
standing check**, and the rehearsal's R10 row was loose in the same direction.
Both now require `dead` values on rows whose `path` is a webhook name, or a
`backed:true` row, which exists only in dead mode. The check caught its own
author's newest sentence, which is the most useful thing it could have done.

**6. The rehearsal gated nothing — the same defect as P4, in this lane's
headline deliverable.** The session brief called the Linear-dead rehearsal the
thing that converts the deadline from a hope into a test. It was mentioned in §0's
argument and in the "what this runbook does not cover" list, and **no step
required it.** Now **P6**, gating STEP 3 and STEP 6's nightly flip.

**7. And P6 turned out to be load-bearing for the monitoring estate, not just for
confidence.** `samples_e2e_nightly` and `calendar_e2e_nightly` are REGISTERED
dead-man lanes (`monitoring-watchdog.js:135-138`, `max_age_minutes: 2160`). The
STEP 6 nightly flip I had added 30 minutes earlier would, if done before the app
actually survives a dead Linear, fail both nightly — latching `failing` and
emailing a red run every day. **That is precisely the harm this lane's part 1
(#1348) existed to remove for the four Linear-credentialed lanes, re-created with
two different lanes by my own newest instruction.** I had checked the flip against
the nightlies and not against the watchdog's lane list. Both documents were mine
and I had read both today.

**8. A placeholder path in the one line telling a reader where the rehearsal is.**
§5 cited `docs/audits/2026-09-XX-linear-dead-rehearsal.md`. The file is
`2026-09-15-...`. `XX` resolves to nothing; the citation had never been followed by
anyone, including me. Same class as LX-N8N's finding that every line number in
`LINEAR_CUTOVER_TOUCHPOINT_INVENTORY.md` is dead — a reference that was correct
when written as a placeholder and never became real.

**Where the count stands: six from other lanes, eight from sweeping my own.** The
sweep is now clearly the higher-yield of the two, and finding 7 says why: it caught
an interaction between two documents I had *both* written and *both* read the same
day. Reading a document for correctness and reading it against every other
document that constrains it are different activities, and only the second one finds
this class.

**Addendum, 2026-09-08 — the sweep's last pass, and a gap measured rather than
filled.** Comparing `docs/ops/MONITORING.md` against `LANES` in
`scripts/monitoring-watchdog.js` line by line: **three registered lanes appear
nowhere in the coverage document** — `monitoring_watchdog`, `samples_e2e_nightly`
and `calendar_e2e_nightly`. All three latch and page exactly like the lanes the
document does list. An operator reading MONITORING.md to answer *"what will wake
me, and why"* gets an answer short by three, **including the watchdog's own lane**
— the mechanism that reports every other lane's silence is itself absent from the
file that catalogues what reports what.

This is pre-existing and not created by this PR. Two of the three, though, became
load-bearing for this lane an hour ago: STEP 6's nightly flip acts on precisely
`samples_e2e_nightly` and `calendar_e2e_nightly`, which is finding 7 above, and P6
now gates it.

**Recorded, not fixed, and the distinction is deliberate.** Writing coverage rows
for three lanes this lane did not build would mean inventing detail about other
people's work — what each proves, what its failure means, what an operator should
do about it. **A confidently wrong row in a coverage document is worse than an
acknowledged absence**, because the absence at least prompts someone to look. The
measurement is the deliverable; the rows belong to whoever owns those lanes.

**Final count for the day: six findings from other lanes reading my documents,
nine from reading them myself against the documents that constrain them.** The
method is written up in this ledger and in the runbook's own handover section
rather than left as a habit, because the next session will not have watched it
work.

### Addendum, 2026-09-08 — there is a SECOND Linear exit programme, and the document that spans every lane did not know

The master sequence merged as PR #1357 an hour before this was found. Its stated
purpose is to be the one document carrying the order across every lane. It
carried the order across **this programme's** lanes and was silent about the
other one. That is the defect this file exists to prevent, committed by this
file, which is the reason it is recorded at this length rather than quietly
patched.

**What exists.** Three open drafts from an earlier effort, authored 2026-09-04 to
2026-09-07 and last touched hours before this programme's lanes started:
PR #1268 (draft, base `main`, docs only, its release packet is the reviewable
status), PR #1326 (draft, **base `main`**, all eight hosted jobs green at
`5bcc03bd`, a combined runtime candidate for the whole exit) and PR #1341 (draft,
on the integration branch, stacked on #1326, **a native urgent-alert
replacement**).

**Correction inside the hour, because the first version of this entry understated
the finding.** It said #1326 was based on an integration branch. It is based on
`main`. Only #1341 is on the integration branch. The difference is the finding: a
green draft on `main` covering native intake, card and feedback recovery and the
Workload cutoff is a **live alternative** to lanes A, D and F, not a stranded
experiment. Two independently-CI-green attempts at the same exit now exist, built
without knowledge of each other, and which one wins is an owner decision with a
second model rather than a session's call. The only factual argument available
without that review: #1326 preserves `main` at `70715496a` and is many merges
behind today's tip, so it needs a substantial re-merge before it can be weighed
at all, while this programme's four PRs are current. That is freshness, not
design quality.

**Four things it holds that this programme does not.**

1. **A live n8n inventory where ours is source-derived.** `N8N_REPLACEMENT_PLAN.md`
   (item 181) states plainly that no live n8n workflow was inspected and its
   readbacks are eight weeks old. The release packet reports a fresh read-only
   inventory over **129 of 129 current workflow IDs, 93 active**, every active
   published binding verified. Where they disagree about what exists, the measured
   one wins. The counts are **not** a contradiction and must not be reported as
   one: ours counts 56 browser-reached webhook endpoints, theirs counts 129
   workflows in the account. Different units. The real difference is measured
   versus inferred.
2. **"Two legacy write fences currently query Linear before refusing mutation, so
   native authority alone does not eliminate their reads."** Nothing in this
   programme's documents says this. It does not automatically make the
   "staff writes are safe" row wrong, but it means that row rests on a fence
   behaviour nobody here checked. The degradation table now carries the caveat
   rather than the flat claim.
3. **A different decomposition of the remaining n8n work** into seven finite
   groups, including one this programme never named: queues that refuse **before**
   the provider lookup rather than after.
4. **Independent corroboration of `send-urgent-slack`.** PR #1341 exists because
   the Slack workflow resolves the editor through Linear — reached from a
   different direction, days before PR #1356 re-derived it from source. Two
   independent derivations agreeing is the strongest evidence either has.

**A decision the owner may not know is on the table.** The release packet says a
short Linear extension targeting 2026-10-15 was prepared for review, with
2026-09-15 cancellation still scheduled meanwhile. The owner has said he cannot
extend, so this is recorded and not recommended. But it was prepared, and a
prepared option nobody is told about is the same as no option. If extension is
genuinely foreclosed, that belongs written down, because that packet is currently
planning around an availability it may not have.

**Why it was missed, which matters more than the miss.** Every lane was scoped
from `main` and from documents on `main`. **All three PRs are unmerged drafts, so
none of their content is on `main`** — that is the whole shared reason, and it is
the same for all three. (#1268 and #1326 target `main`; only #1341 is on the
integration branch. The base branch had nothing to do with why they were missed.)
The open-PR list would have named them. No lane read it, this coordinator included.

**Corrected within the hour, and the correction is itself an instance.** The first
version of this paragraph said "two are based on an integration branch". That count
was fixed in the master sequence and left standing here, which is exactly the
"you fixed the line I cited and left its siblings" defect that took three review
rounds on PR #1351 to stamp out. Doing it again, in the entry recording the
programme's coordination failures, while claiming to have learned it. **A wrong
count is bad; a wrong count inside a causal explanation is worse**, because it
teaches the next reader the wrong lesson about how the miss happened.

**The rule earned:** *a document claiming to span every lane must enumerate the
lanes from the PR list, not from the branch it is standing on.* Sibling to the
rule from item 178 about comparing failure sets rather than colours: in both
cases the cheap complete source was available and a convenient partial one was
used instead.

**The completion figure stays at ~60%.** Finding that more work exists than was
credited is not progress. It changes the honesty of the denominator, not the
numerator.

### Addendum, 2026-09-08 — Create Post reads Linear twice before it writes, and none of the four held PRs fixes it

> **SUPERSEDED IN PART, same day — read the correction addendum below before
> acting on anything here.** The heading's "reads Linear twice" describes the
> `create` operation, which is **closed** and never reaches a Linear read. The
> conclusion survives via `intake_create`; the trace below does not. Annotated in
> place rather than rewritten, per the append-only rule and the disambiguation
> precedent set by the 175/176 collision.

The most consequential finding of the day, and it contradicts a line the master
sequence carried for most of it. That document said staff writes are safe on
2026-09-15. True of status, comment and edit writes. **False of creating a post**,
which is the write staff make most.

**Source, on today's `main`.** `supabase/functions/production-write/index.ts`:
`operation === "create"` dispatches to `handleProductionCreate`, which calls
`productionCreateScope`, whose first substantive step is `projectForIntake`. Every
branch of that function that returns successfully calls `readLinearProject`, a
live `POST https://api.linear.app/graphql`. A real client with no tagged project is
refused `409` anyway and one with several is refused `409 ambiguous`, so **there is
no path to a successful create that does not read Linear.** Then
`handleProductionCreate` reads it a second time through `linearStateIdForCreate`,
for the status state id. Unreachable provider throws
`GatewayError(503, "project_mapping_validation_unavailable")` — **fails closed**,
so nothing is corrupted, and the create is refused.

**Two orderings make it worse than it first looks.**

1. **The provider read precedes the authority check.** `projectForIntake` runs
   before `authorityFor`/`authorityLane`, so a client whose authority is fully
   `syncview` still pays it, and flipping authority native does not avoid it. This
   is the shape the other programme's release packet describes as *"legacy write
   fences query Linear before refusing mutation, so native authority alone does
   not eliminate their reads"* — confirmed from source, and narrower and more
   actionable than that sentence.
2. **Neither read is flag-gated.** The third Linear-reading fence in the same file,
   the assignee eligibility pool, **is** flag-gated
   (`production_assignee_eligibility`) with a documented retirement path. The two
   on the create path have none, so this cannot be fixed by a flag flip at cutoff
   time.

**Held-PR coverage, checked directly rather than assumed.**
`claude/lx-a-workload-native`, `claude/lx-c-endpoints` and `claude/lx-d-feedback`
change **zero** lines of `production-write/index.ts`. Merging this programme's
entire held set leaves Create Post dependent on Linear.

**PR #1326 fixes it**, at `5bcc03bd`, by threading a `nativeEpoch` through
`projectForIntake` that short-circuits both branches before the provider read. That
is the strongest concrete argument for the other programme's work, and it is a gap
rather than a preference.

**What is NOT verified, stated because the distinction has burned this programme
twice.** This is a reading of **repo source, not of the deployed function**.
`production-write` reaches production only through the fingerprint-pinned F27
Section 4 lane, so live could differ. Two things settle it: the
`SYNCVIEW_QA_LINEAR_DEAD` rehearsal, now promoted to the **first** Phase 2 action
rather than the fourth, and a create attempted on the TEST client with the provider
unreachable. Until one runs, this is a strongly-evidenced source finding and not a
measured fact about the live system.

**Method note worth keeping.** This was found by verifying one sentence borrowed
from another team's document instead of citing it. The sentence was true, vaguer
than the truth, and pointed at something bigger than it claimed. **Checking a
borrowed claim against source is how a citation becomes a finding**, and it is the
opposite of the failure logged earlier the same day, where a true sentence was
quoted into a scope its source did not have.

**Follow-up the same hour: `create` is not the only affected operation.** Every
Linear read in `production-write` traced to the operation reaching it:

> **SUPERSEDED TABLE — corrected below.** `create` is unreachable, and
> `component_fill` is **Always**, not "Sometimes". Kept for the record.

| Operation | Reads Linear? | Behind a flag? |
|---|---|---|
| `create` | Yes, twice (`projectForIntake`, `linearStateIdForCreate`), plus parent validation | **No** |
| `intake_create` | Yes (`projectForIntake`, `parentRouteForAppend`) | **No** |
| `component_fill` | Sometimes — `parentRouteForAppend` validates externally by default, so a batch with an existing Linear parent reads it; a native batch whose parent outbox row is not `written` does not | **No** |
| **Changing a card's assignee** | Yes (`validateAssignee` → `assigneeProviderPool`) — an everyday action on an existing card, not only a create-time check | **Yes**, `production_assignee_eligibility` |
| `status`, `due`, `description` | No | n/a |
| `comment`, `attachment`, `labels` | No | n/a |
| `batch_description`, `batch_asset` | No | n/a |

**The safe rows are verified forward.** Tracing callers backwards shows only what
reaches a Linear read; it cannot establish that a path is clean, and the
reassuring half of a table is the more dangerous half to get wrong. So
`handleEntityOperation` was read forward: `status`, `due` and `description` each
take their own branch and none calls `validateAssignee`, which is reached only in
the final `else`. That branch is the mutate path's entire Linear exposure, and it
is flag-gated.

**The `component_fill` row hides a trap.** It degrades gracefully for natively
created batches and fails for batches that already have a Linear parent, which is
every card in existence today. So the graceful path applies only to cards that
cannot be created, because `create` is blocked by the row above it. **The two
defects conceal each other**: fix either alone and the other becomes visible, which
is why they were not caught by any lane looking at one surface at a time.

**The assignee row is the shape the other two should have had.** Same dependency,
but behind a flag, with a comment naming the pre-retirement state and a deliberate
choice that an absent flag row means strictest rather than a 503. The create-path
reads are not remarkable for reading Linear; they are remarkable because **nothing
can turn them off**.

### Addendum, 2026-09-08 — Route A verified from source, and the guard has a third disjunct

Applying the day's own lesson to the claim the entire cutoff plan rests on. The
runbook's §0 says that with `linear_outbound_enabled = off` and
`linear_legacy_parity_enabled = false`, the outbound worker's provider block is
skipped entirely. **Checked rather than quoted, and it holds.**

`linear-outbound/index.ts` guards the block with
`if (initialMode !== "off" || parityEnabled || f27ReplayRequestValue)`. `rows` is
declared empty at the top and assigned only inside that block, so it stays empty;
`readViewer()` is inside the block and is skipped; and **every** other Linear call
in the file (`readIssue`, `readTeam`, `readLinearComment`, `readCommentByMarker`,
`readAttachmentRevisionPresent`, `currentControl`, and the mutation execution)
runs inside `for (const candidate of rows)`, which never executes an iteration.
Nothing reaches `api.linear.app`. The flag really is sufficient and Route A is
safe as described.

**The refinement: that guard has THREE disjuncts and the runbook's wording carries
two.** The third is `f27ReplayRequestValue` — an F27 replay request re-opens the
provider path with the flag still `off`. That is a deliberate recovery and drill
mechanism, not a leak, and it requires an explicit owner action, so it cannot
happen by accident. It is recorded because "with outbound off, nothing reaches
Linear" is true of normal operation and not of a replay dispatch, and the person
reading the short version during an incident is exactly the person who might issue
one.

**Two verifications of borrowed claims today, opposite results.** The other
programme's write-fence sentence was true and *understated* what it pointed at,
and became this ledger's largest finding. This programme's own runbook sentence
was true and *slightly over-general*, and checking it cost minutes and produced a
caveat rather than a defect. Both were worth doing, and the asymmetry is the point:
**the check is cheap and its value is not predictable in advance**, so "the source
is trustworthy" is not a reason to skip it.

### Addendum, 2026-09-08 — CORRECTION: the Create Post finding traced dead code, and component_fill is worse than recorded

Three review findings on PR #1360, all correct, all against the entry above. The
conclusion survives; the trace supporting it did not.

**1. `create` never reaches a Linear read.** `production-write/index.ts:3592`
throws `GatewayError(403, "production_create_closed")` unconditionally, before
`productionCreateScope` on the very next line, under an owner ruling of 2026-08-23
that *"nothing is created from the Production tab."* **Everything after that throw
is dead code**, including both reads counted in the entry above.

**I traced a path without first checking it was reachable.** On the same day this
ledger recorded three variants of "a document correct about what it says and wrong
about where it points", this is a fourth and worse one: **correct about what the
code says, wrong that the code runs.** Reachability is the first question, not a
detail, and it is cheaper to answer than any of the tracing done after it. The
finding was reached by a method that would have produced the same confident writeup
had the conclusion been false.

**The conclusion survives** because the browser never sends `create`. The Calendar
Create Post flow sends **`intake_create`** (`index.html:42155`), and
`handleIntakeCreate` is not closed and calls `projectForIntake` **unconditionally,
once per team**, in the loop the source itself labels read-only validation before
the first native row write. So Create Post really does depend on Linear, by a path
this ledger had not looked at.

**2. `component_fill` is ALWAYS Linear-dependent, not "sometimes".**
`handleComponentFill:6008` calls `projectForIntake` unconditionally, **before**
`parentRouteForAppend` at `:6038`. The entry above said a native batch with an
unwritten parent takes a graceful path; it does not, it merely avoids the extra
parent-validation read. **The "two defects conceal each other" observation is
withdrawn** — it was a satisfying story resting on a false premise, and satisfying
is exactly when to check harder. The practical cost of the error would have been
real: "sometimes" invites leaving `component_fill` out of the cutoff repair scope,
and every fill would then fail after provider access ends.

**3. The replay caveat over-generalised.** An F27 **drill** provably cannot reach
Linear even with outbound off: `readViewer()` is skipped when `isDrill === true`,
and the row loop calls `executeF27DrillReplay` and `continue`s before
`currentControl` or any mutation, under a source comment saying exactly that. Only
a **non-drill recovery replay** re-opens the provider path. Telling an incident
operator that the drill mechanism reaches Linear is worse than saying nothing,
because the drill is the safe thing they should feel free to run.

**One thing the correction improved.** #1326's `nativeEpoch` fix is threaded into
exactly the two **reachable** call sites, `handleComponentFill` and
`handleIntakeCreate`, and deliberately not into the dead `create` one. A more
precisely targeted fix than the earlier entry credited, and evidence its authors
knew which paths run.

**Unchanged:** the four held PRs still change zero lines of `production-write`, and
the `SYNCVIEW_QA_LINEAR_DEAD` rehearsal stays the first Phase 2 action. It is now
the *only* thing that should settle this, because this analysis has already been
wrong once about which code runs, and a second source reading is not the remedy for
a source reading that missed a `throw`.

**Corrected twice: TWO request-construction sites, FOUR flows.** The first attempt
at this claimed three senders; it invented one and omitted a whole surface.

| Built at | Surface | Flows |
|---|---|---|
| `index.html:42155` | derived at `:42056`, `state.surface === 'sxr' ? 'sxr' : 'calendar'` | Calendar Create Post **and Samples/SXR**, whose entry calls `_calOpenNativePost(..., 'sxr')` at `:66086` |
| `index.html:48263` | `'submission'` | staff submission from the normal tab, and **the client link** (credential-less caller admitted for `intake_create` on `submission` only, behind a default-off flag, rate-limited, `public-intake`) |

`index.html:47372` is **not** a sender. It is inside `_linearIntakeRecoveryCopy`,
which builds a scrubbed `recovery_only`/`suspended` copy of an already-committed
job, and `_runNativeIntakeJob` skips its gateway fetch whenever `job.result`
exists.

**The omission mattered more than the invention.** Missing Samples/SXR left a live
surface out of the cutoff blast radius, and Samples is where a client's first
deliverables come from. Counting a recovery copy as a sender merely inflated a
number. The two errors do not cancel, and only the inflated count would have been
caught by anyone checking the total, which is the argument against treating a
table as "roughly right".

**Third borrowed claim checked today, third time it paid.** The other programme's
write-fence sentence understated its subject; this programme's runbook sentence
was slightly over-general; and a reviewer's line citation was correct but pointed
at one of three call sites. None of the three outcomes was predictable before
checking, which is the whole argument for checking.

**The sweep that should have happened after each correction, and the two siblings
it found.** Having just been caught leaving a stale count in this file after fixing
it in the master sequence, the obvious next move was to grep the *claims* rather
than the cited lines. It found two more, both in this ledger, both left behind by
earlier corrections in this same entry:

1. The addendum heading still asserted *"Create Post reads Linear twice before it
   writes"* — the superseded claim, in a **heading**, which is the worst place for
   one because headings are what a hurried reader trusts.
2. The operation table still carried `create` as a live row and `component_fill` as
   "Sometimes".

Both are **annotated in place with a pointer to the correction**, not rewritten:
the ledger is append-only, and the precedent for annotating rather than editing was
set today by the 175/176 disambiguation notes.

**The rule, stated so it is executable rather than aspirational:** after correcting
a claim, grep the *claim's words* across every document, including the ones you
already corrected, and including headings and tables rather than prose alone. A
correction that lands in the body while the heading still asserts the old thing is
not a correction; it is a contradiction with a timestamp.

Three rounds of review on this entry have now each found the same shape: the fix
landed where the reviewer pointed and not where the claim also lived.

### Addendum, 2026-09-08 — the sequence permitted reaching the cutoff with intake broken

Two P1s on PR #1360, both correct, and the second is the sharpest finding of the
day because it is about the document's **function** rather than its facts.

**1. Assignee changes were in the "safe writes" row and do not belong there.**
Changing a card's assignee runs `validateAssignee` → `assigneeProviderPool`, and
`docs/truth/APP.md:652-653` is explicit that a **missing or malformed**
`production_assignee_eligibility` flag *stays strictest* — only the exact
`{"provider_mapping_required": false}` value drops the provider requirement. So
doing nothing is not neutral: it leaves every assignee change dependent on a
provider about to stop answering, and the blanket word "edits" in that row hid it.
The row is now split, and **the flag is a numbered owner action (P6)** rather than a
detail inside a table. It is the only Linear-dependent write path whose author built
in an off switch; not using it would be the avoidable kind of failure.

**2. The sequence let a reader reach Phase 3 with every intake path refusing.**
#1326 was described only as an alternative programme's work. It appeared in no Phase
1 merge and no Phase 2 action. So a reader could do everything this document listed,
have the dead-Linear rehearsal **confirm** the refusals, read that as a pass —
because "fails cleanly" is what a rehearsal normally looks for — and turn the cutoff
on with post creation, Samples/SXR intake, staff submission and component fill all
already broken.

**On the intake paths, failing cleanly is the defect, not the proof.** That
sentence is now in the document, because the whole trap depends on the reader
applying the usual reading of a rehearsal result to a case where it is inverted.

Added: **P7, an explicit gate** requiring an owner-chosen `production-write` repair
(adopt #1326's `nativeEpoch` approach, or an equivalent minimal change) with a
**behavioural** acceptance criterion — with Linear dead, a Calendar post, a
Samples/SXR post and a component fill must all **succeed** on the TEST client, not
merely refuse cleanly. Plus a four-row **entry gate** at the head of Phase 3.

**And a claim of mine is retracted.** This document said merging the four held PRs
"converts an uncontrolled degradation into a controlled cutover". **False as
stated.** None of the four touches `production-write`. The four merges are
necessary and not sufficient; a controlled cutover needs them **plus** P6 **plus**
P7.

**The lesson, and it is different from the day's earlier ones.** Those were errors
of fact: a wrong line, an unreachable path, a stale count. This was an error of
**structure** — every individual statement in the sequence was true, and the order
they were written in still permitted an outcome the document elsewhere calls
unacceptable. A document that is the ordered list has a second correctness property
beyond its facts: **following it must not be able to produce a state it forbids.**
Nothing in a fact-check catches that. It is caught by asking what a reader who obeys
every line ends up doing.

**Follow-up: the gate was put in the wrong document, and saying so is part of the
fix.** The structural finding above was repaired by adding a gate to
`LINEAR_EXIT_MASTER_SEQUENCE.md`. That is the weakest available enforcement, and
noticing it matters more than the paragraph: the failure being repaired was that a
reader could satisfy every listed step and still reach a forbidden state, so a
second gate in prose, in a document the operator does not have open at cutoff time,
is a second thing to walk past.

`LINEAR_CUTOFF_RUNBOOK.md` is where the operator actually looks, and it lives on PR
#1350's branch, held. Rather than touch another lane's finished work, the
precondition was handed to that lane as a comment on #1350 in its existing
P-numbered style, with the load-bearing sentence spelled out: **with Linear dead, a
Calendar post, a Samples/SXR post and a component fill must all SUCCEED on the TEST
client; refusing cleanly is a FAIL, not a pass.** Plus the assignee flag literal.

The master sequence now says outright that its own gate is a note rather than a real
gate until #1350 carries it. **A document admitting where its enforcement is weak is
more useful than one that reads as though it has none** — and pretending otherwise
would repeat, in the repair, the defect the repair is for.

### Addendum, 2026-09-08 — labels are not safe either, and the enumeration that was supposed to fix generalising did not

Four more findings on PR #1360, three P1. The first one stings.

**1. Labels reach Linear, and I had just listed them as safe.** `handleLabelsRead`
calls `linearLabelSnapshot` unconditionally at `production-write:4947`, and the
`labels` write does the same at `:5491`; both go on to `linearLabelCatalog`, which
**pages the Linear API**. Neither is flag-gated.

**Why this one is worse than a missed row.** One round earlier, the fix for the
assignee error was to stop saying "edits" and **enumerate** the safe operations, on
the reasoning that a list cannot silently absorb a new member. The list I wrote
included `labels`. **I replaced a generalisation with an enumeration and then did
not verify the enumeration**, which produces a *more* confident wrong statement than
the vague one it replaced: "edits" invites a reader to check, a named list does not.
A remedy applied without doing the work the remedy exists to force is worse than the
defect.

The safe set, now verified per operation against an exhaustive map of every
Linear-reaching call site in the file: `status`, `due`, `description`, `comment`,
`attachment`, `batch_description`, `batch_asset`. Not safe: intake, component fill,
assignee changes, **labels (read and write)**, and the `create_options` action.

**2. The behavioural gate did not test the second request site.** It required a
Calendar post and a Samples/SXR post — which are built at **the same** browser site,
`index.html:42155`, differing only in a surface value. The staff submission is built
at `:48263`. So a surface-scoped repair could have passed every listed check while
normal staff submissions still refused after cutoff. **My own table two sections
above says there are two sites**; the gate I derived from it tested one twice. The
criteria are now six checks with a column saying what each one covers that the
others do not.

**3. Setting the assignee flag was not proof that it worked.** The document insists
elsewhere that deployed `production-write` may differ from repo source, then treated
an exact flag readback as sufficient. A readback proves what the flags table holds.
It is now check 6 of the behavioural gate: with Linear dead and the flag set, open
the picker and change an assignee, and see it succeed.

**4. "#1350 is merged" does not satisfy the gate.** The preconditions have to be
*in* the runbook the operator opens. Row 1 of the entry gate now reads "merged **and**
its runbook carries the P6/P7 preconditions", because merging it with the old text
leaves the enforcement exactly where it was.

**The pattern across today, stated once.** Every fix of mine has been applied at the
depth the reviewer pointed at, and the defect has lived one level deeper each time:
fix the line → fix the claim → fix the claim everywhere → fix the *kind* of claim.
Enumerating instead of generalising was right; enumerating without checking each
member was the same defect wearing the remedy's clothes.

**Closing my own three flagged uncertainties, and one of them was wrong.** After
the labels correction I listed three claims in the master sequence as unverified
and asked the reviewer to attack them. Checking them myself instead:

1. **`create_options` is NOT reachable, and I had listed it as reachable.** The
   handler does reach `projectForIntake`, and the browser does contain three
   references to the action, but its only two entry points are the New-issue button
   and Add-sub-issue, and both render `disabled` because `_prodCreateGateText`
   returns `PROD_CREATE_CLOSED_TEXT` as its **first statement**, above code the
   source labels *"kept, unreachable, as the exact undo if the ruling is ever
   revisited."*
2. **`batch_description` and `batch_asset` are genuinely clean** — both handlers
   read forward, neither reaches a provider call. They were in the safe set on the
   caller map alone, which after the labels error was not good enough.
3. The exhaustive call-site map stands as the basis for the rest.

**The fact about the codebase worth extracting**, rather than only the fact about
me: **the 2026-08-23 create closure is enforced in two independent places** — the
server's `production_create_closed` throw and the browser's `_prodCreateGateText`
— and **neither references the other**. I was caught by each separately on the same
PR, hours apart, having already learned the lesson from the first. Tracing one
teaches you nothing about the second, and both are guarded by early returns above
live-looking code that is deliberately retained as the undo.

Anyone assessing "is this surface reachable" in this repo needs to check both
halves. That belongs in the record as a navigation hazard, not as a confession.

### Addendum, 2026-09-08 — the summary-drops-the-list defect, third instance, this time in the gate

Five more findings on PR #1360, two P1. One (`create_options` unreachable) had
already been fixed independently. The rest:

**1. The Phase 3 entry gate named three of the six P7 checks**, and the three it
named covered one request site twice while omitting the staff submission, labels
and the assignee proof. Its row 3 also accepted the assignee **flag readback**,
which the same document says four screens earlier is not proof of effect.

**This is the third instance of one defect: a summary that drops members of the
list it summarises.** First the word "edits" absorbing assignee changes; then the
enumeration written to fix that, which included `labels` without checking; now a
four-row gate compressing six criteria. **A summary that drops members is not a
summary, it is a second and weaker specification**, and a reader working a checklist
uses the short one. The gate now repeats all six in full, which costs four lines.

**2. The minimal-repair option could not satisfy the gate it was offered under.**
P7 lets the owner choose a fresh minimal change instead of #1326's approach.
Short-circuiting `projectForIntake` fixes intake and component fill and does
**nothing** for labels, which reach the provider through `linearLabelSnapshot` →
`linearLabelCatalog` and never touch `projectForIntake`. That repair would deploy,
look complete, and still fail check 5 — **after an F27 Section 4 deploy had already
been spent**, which is the expensive kind of wrong. Now stated as a separate
required repair.

**3. The mint's step order contradicted its own table.** The proof said to enable
`video`, prove it, and do this "before seeding the second team" — but the numbered
table seeds **both** teams at steps 2 and 3. Anyone following the order had already
seeded graphics. The per-team caution belongs on the **flag transition**, not the
seeding, since a seed row is inert without the flag. Rewritten as four ordered
sub-steps.

**4. The F27 Section 4 deploy lane was named without its direct Actions URL**,
which `AGENTS.md:18-23` requires and which this programme has now been corrected on
four separate times.

**The pattern, and it is not the same as "I make mistakes".** Every one of these is
a *derived* artefact disagreeing with the source it was derived from, in the same
file, with the source still correct: the gate against P7's criteria, the repair
option against the operations table, the mint proof against the mint table. **The
facts have been right and the restatements wrong**, consistently, which means the
risk in this document is concentrated in exactly the places a hurried reader will
use: the tables, the checklists, the summaries.

**The sweep, run on this document's own derived statements rather than waiting to
be told.** Review established that the recurring defect on PR #1360 is a
restatement drifting from a source that stayed correct, so the two tables that had
never been re-read against their sources were swept. Both migration rows in Phase 0
had drifted, and both in the direction that overstates what this programme knows:

- *"`EXECUTION_LOG.md` 2026-09-08, recorded late"* — 2026-09-08 is when the **log
  entry** was written. The **application date is unrecorded**, and the log says it
  was *"discovered applied by measurement, not by record"* (item 176 read
  `workload_issues_native_v1` live over REST). "Recorded late" reads as a
  bookkeeping lapse; the truth is that nobody knows when it was applied, and it is
  only known to be applied because someone measured it.
- *"Same entry"* for the membership migration — flattening two different
  provenances. That one was **applied by the owner on 2026-09-07**, in the window
  before the `workload-plan` deploy that caused that night's outage. Known day,
  known actor, different kind of evidence entirely.

**Neither error changed a conclusion, and that is why they are worth recording.**
Both made the evidence sound better than it is, in a programme that has already
been wrong in **both directions** about which migrations are live. Overstating the
record on the two it is sure about is precisely the wrong direction to be sloppy in.

Also re-verified in the same sweep, and these held: all four merged PRs named in
Phase 0 (#1345, #1348, #1349, #1351) have real merge commits on `main`'s
first-parent history; and `NATIVE_IDENTIFIER_MINT.md:89-91` does say *"Do it per
team, video first"* of **step 4**, confirming that the per-team caution belongs on
the flag transition rather than the seeding.

**Two of three self-flagged uncertainties held; one did not.** That ratio is the
argument for sweeping rather than for confidence: the sweep is cheap, and which
items fail is not predictable in advance.

### Addendum, 2026-09-08 — the minimal repair had a second hole, and the acceptance checks had the matching one

Two findings, one P1, and the P1 also settles a question left open twice above.

**1. Short-circuiting `projectForIntake` does not fix component fill or appends.**
`parentRouteForAppend` reaches `validateLinearBatchParent`, a live provider read,
by a path that never touches `projectForIntake`:

- `handleComponentFill:6038` passes **seven** arguments, so `validateExternal`
  takes its default `true`.
- `handleIntakeCreate:6701` and `:6721`, the append-into-an-existing-batch paths,
  pass `validateExternal = !exactRowRetry` — **true on any normal append**.

That also closes the `validateExternal` positional-argument question this ledger
flagged twice and never resolved: seven at the fill, eight at the appends.

**2. The acceptance checks had the matching hole.** They said "create a post"
without distinguishing a **new** batch from an **append to an existing** one, and
**only the append reaches `parentRouteForAppend`**. So the minimal repair could have
passed all six checks while every append stayed broken — and **appends are the
common case**, since most posts join a batch that already exists. Added as check
3b; the gate is now seven checks.

**The shape, again, and it is getting specific enough to be actionable.** A repair
option and an acceptance criterion, both derived by me from the same finding, shared
one blind spot: I had traced *one* provider read on the intake path and then wrote
both the fix and the test for that read. **A test derived from the same reading as
the fix cannot catch what the reading missed.** That is a structural reason my
acceptance criteria keep needing widening, and it argues for deriving the checks
from the *surface inventory* — every operation a person performs — rather than from
the code path I happened to trace.

**3. The F27 order was abbreviated in the failing direction.** I wrote "the sealed
capture before the dispatch", which omits the **upload to the `SyncView Backups/`
Shared Drive root** between them. The lane does not receive the bundle, it fetches
it from Drive by content-addressed name, so skipping the upload fails in about 20
seconds with `OBJECT_MISSING` and deploys nothing. **This is the exact abbreviation
that failed run #37 on 2026-09-05**, and it is written out in `CLAUDE.md` in
capitals. I had the file in front of me and compressed three steps to two.

### Addendum, 2026-09-08 — the client link is LIVE, so the cutoff is client-facing, and I read a code default as a live value

One finding, P1, and unlike the last several rounds it is **not** a restatement
defect. It changes what breaks on 2026-09-15 and who sees it.

**`public_intake_enabled` = `{"enabled":true}` since 2026-08-25 03:22Z**, turned on
by the owner after the `production-write` deploy that made the path safe to admit.
It is written in `docs/truth/BRIEFING.md:133-134`, this repo's designated
current-truth file.

I described the client-link intake as *"behind a default-off runtime flag"* and
then as *"conditional on a flag whose live value this lane has not read"*. **The
first is the CODE's default; the second was false — the live value is recorded in
the repo and I did not look.** I read a source comment describing a default and
carried it as a statement about production.

**That is a distinct error class from the day's others**, and worth separating from
them. The rest have been restatements drifting from a source that stayed correct.
This one is **a code default read as a live value**, when the live value was
written down in the one file whose entire job is to hold live values. The remedy is
specific: *a flag's default in code is never evidence about its live state; the
live state lives in `docs/truth/BRIEFING.md` and `ROLLBACK.md`, and
`docs/ops/PRE_FLIP_HEALTH_CHECK.md` item 4 is the authority on expected values.*

**Consequence, which is the reason this is the most important finding since the
intake dependency itself:** at the cutoff, **clients** submitting through
`?intake=1` fail, not only staff. Every other surface in this document is internal.
This one is the one a client sees.

It also could not have been caught by the seven existing checks: the client link
takes a **distinct authentication branch** — `production-write` admits it
credential-less after a `credentials_required` failure, where the staff path
authenticates — so all seven could pass as staff while client submissions refuse.
Added as **check 8, mandatory**, and carried into the Phase 3 gate row, the
degradation table as its only client-facing row, and the #1350 runbook handoff.

**The sweep that finding earned, run immediately rather than waiting for the next
round.** If a code default had been read as a live value once, every other flag
claim in the master sequence deserved the same check against
`docs/truth/BRIEFING.md` and `ROLLBACK.md`. Results:

- `prod_authority`, `write_ui_reroute_clients`, `linear_outbound_enabled`
  (`{"mode":"live"}` — **not** off; the cutoff is what changes it) and
  `linear_legacy_parity_enabled` all **match** what this document says.
- **`production_assignee_eligibility` and `production_native_identifier_mint` appear
  in NEITHER live-state doc.** For the mint that is consistent with its SOURCE ONLY
  status. For the assignee flag it means **its live value is genuinely unknown to
  this repo** — which does not change P6, since the instruction is to set the exact
  literal either way, but nobody should claim to know what it is now.
- **One number was removed rather than corrected.** The staff-writes row said "all
  43 active clients are enrolled". BRIEFING gives **41** at the video flip and **38**
  for the Track-A allowlists on 2026-08-25; item 175 measured **43** on 2026-09-07.
  Those are not contradictions: BRIEFING says membership *"tracks the `*_ef_clients`
  rosters by equality"* and *"the count moves with onboarding"*.

**The lesson from that last one is worth more than the fix.** The number was never
the load-bearing fact — **the equality is**. Quoting a snapshot as though it were a
property is how three separately-true numbers come to look like a disagreement, and
it guarantees the claim rots the next time a client onboards. The row now states the
mechanism and cites no count.

That generalises past this document: **prefer the invariant to the measurement
whenever the invariant is what makes the claim true.** A count is evidence for a
mechanism; publishing it in the mechanism's place trades something permanent for
something that expires.

**Non-flag live claims, swept the same way. One check falls out.** Today's
`workload-plan` deploy from `d4b2365e` is properly recorded in
`EXECUTION_LOG.md:5-8`, so that Phase 0 row is sourced. The label-catalog capture is
sourced to item 170; it is a capture artefact rather than live database state, so
its absence from the live-state docs is correct rather than a gap.

**But `ROLLBACK.md:322` still names "the prior exact `workload-plan` v2 closure from
`fd3e0eaa`" as the restore target, and nobody has confirmed that is still the
correct prior version after today's deploy.** It may well be. This is deliberately
recorded as a **check, not a defect** — asserting it stale would be the same
source-vs-live error the round above just corrected, in the opposite direction.

**Why it is worth recording at all:** a deploy changes what "the prior version"
means, and a rollback target is read exactly once, during an incident, by someone
who has no time to verify it. The PR template asks whether `ROLLBACK.md` needs
updating when rollback scope changes; a deploy changes rollback scope by definition,
and today's deploy did not come with that check. **A minute of the owner's time
before the cutoff, not a blocker.**

### Addendum, 2026-09-08 — P7 would have caused a live outage, and the sweep that "found agreement" read one source

Two findings, one P1, and the P1 is the worst instruction defect on this PR because
following it would have taken a live surface down.

**1. Deploying #1326's gateway before its SQL takes Create Post DOWN.** The
candidate's `production-write` calls `production_native_intake_epochs`
**unconditionally** and refuses `503` when the RPC is absent — recorded in this
ledger at `16663-16666`, from lane D hitting exactly this. So a SHA carrying lane
B's writers, dispatched before lane B's SQL window has closed, takes Create Post and
Submit down immediately, from a deploy that looks like it only touches an Edge
Function.

**P7 went from "choose #1326" straight to "F27 dispatch" with nothing in between.**
`LINEAR_EXIT_BRIEF_B.md:173-200,220-231` lists the real dependency set: three intake
migrations plus the composed atomic artifact, the existing-assignment migration
(which seeds `native_assignment_epochs` **disabled**), two label migrations **plus** a
staged `version_id` without which `production_label_catalog_capability()` never
reports native, and the matching browser plumbing including a new
`intake_editor_options` endpoint.

**The structural point.** This document's acceptance checks run **after** a deploy.
That is fine when the risk is "the fix did not work" and useless when the risk is
"the deploy itself is the outage". **A post-deploy check cannot protect a
pre-deploy hazard**, and P7 was relying on it to. The constraint is now stated as an
ordering precondition — migrations applied and staged, capabilities reporting
native, *then* dispatch — with brief B named as the authority on the per-item order,
since it has the SHAs and file lists and this document does not.

**2. The live-state sweep reported "the sources match" having read one of the two
authorities it named.** `BRIEFING.md:124-127` says the reroute cohort is the **full
roster**, wave 3, 2026-08-14. `ROLLBACK.md:146` still says *"cohort UPDATED
2026-08-07: the TEST fixture plus enrollment wave 1 — two real clients"*.

BRIEFING is a week newer and is almost certainly current. **But `ROLLBACK.md` is the
rollback law**, and its row names the wave-1 cohort as the captured prior value to
restore — so an operator rolling back from it would restore a **two-client** cohort
onto a full-roster estate. Its own *"always read the live value fresh"* is the
mitigation and the only reason this is not worse.

**Not corrected here**: fixing the rollback law needs the live value read, which is
an owner action. Recorded so the conflict is visible rather than hidden behind a
sweep that claimed agreement.

**The sweep's own defect is the one worth keeping.** It was run *because* a
source-vs-live error had just been found, it named three authorities, it consulted
one, and it reported agreement. **Checking against one source and reporting
agreement with several is a stronger claim than the work supports** — the same shape
as every restatement defect on this PR, committed inside the correction for them.

**Applying the round's lesson to P1, unprompted, and it lands.** The finding above
was that a control sat on the wrong side of the risk. Asked of the naming mint, the
same question gives a real answer, and it inverts which step is dangerous.

`NATIVE_IDENTIFIER_MINT.md`'s undo column: **step 4, the flag flip, is reversible**
— it stops minting and renames nothing. **Steps 2 and 3, the seeds, are undoable
*"only while no name has been handed out for that team. Once one has, deleting the
cursor and re-seeding re-issues names."***

**So the proof step locks the seed.** The sequence is flip `video`, create a TEST
post, read back the minted name — and that read-back *is* the first handed-out name.
After it, the video cursor cannot be corrected without re-issuing names already
printed on cards.

**What that makes load-bearing.** `production_native_identifier_seed` derives the
prefix from live provider data and sets the cursor to
`observed_provider_max + gap + 1`. The **prefix** has a guard: it refuses with
`native_identifier_prefix_ambiguous` rather than guessing. **`observed_provider_max`
has none.** A degraded provider or a partial page during seeding returns a maximum
that is too low, the native band sits lower than it should, nothing reports it, and
it becomes visible only once names are being handed out — which is exactly when it
stops being fixable.

So P1 now says: **read and sanity-check the three returned values before flipping**,
not merely record them. The mint runbook says to record them; this says why the
recording must be a check and must precede step 4.

**The general form, which is the third distinct control-placement lesson today:**
*the reversible step is not always the later one.* Everyone treats "apply and seed"
as the safe preamble to a risky "flip", because installs feel provisional and
enablements feel committal. Here it is backwards, and the document was ordered on
the feeling rather than on the undo column that was sitting in the source the whole
time.

### Addendum, 2026-09-08 — the ordering fix over-corrected, and three more on the same section

Four findings, three P1. The first is the one worth leading with because it is a
correction **to a correction made an hour earlier**.

**1. I over-corrected the install order.** The first version went straight from
"choose #1326" to "dispatch" — gateway before SQL, an outage. The fix put **runtime
activation before the dispatch**, which is also wrong.
`LINEAR_EXIT_BRIEF_B.md:282-290` — the authority this document delegates to — orders
capture/upload, **the Section 4 deploy**, and *then* the intake, assignment and
label flips. Activating while the old closure is still live leaves the caller
without the native epoch and payload routing those flags enable.

**Correct: SQL and the label CAPTURE before; all runtime activation after.** Naming
an authority and then contradicting it in the same paragraph is a worse failure than
the original gap, because a reader who checks the citation finds the opposite of
what the text says.

**2. A second, independent hazard on the same side, and SQL-first does not fix it.**
Merging the browser half **publishes `index.html` immediately** via Pages, while
`production-write` only moves on the dispatch. Brief B's own adversarial review at
`:368-370` records it: the new browser calls `intake_editor_options`, the **old
gateway answers `400 unknown_action`**, and the Create Post picker is broken for the
entire capture → upload → dispatch interval. Needs a fallback in the browser hunk,
or the browser hunk held until the gateway is live.

**3. Recording the reroute conflict was not resolving it.** The previous entry noted
that BRIEFING and ROLLBACK disagree and stopped there. **If ROLLBACK's value is
live**, only the TEST fixture and two real clients are rerouted, every other client
still takes the legacy Linear lane, the "staff writes are safe" row is wrong, and
**every behavioural check passes on TEST while normal staff writes fail after
cutoff**. It is now **row 0** of the Phase 3 entry gate: the owner reads the value
live and confirms equality with the current writer rosters, before anything else is
judged. Carried into the #1350 handoff.

**4. I used `production_label_catalog_capability()` as proof of staging.** It reads
**only its runtime flag** and will report `native` for an arbitrary UUID with
nothing staged, then 503 one call later. **This document's own P1 section says
exactly that**, contrasting it with the mint capability's self-guarding — and I used
it as evidence two sections later. The gate now requires a staged-and-attested row
or a successful `production_label_catalog_read_attested`.

**The lesson from this round is narrower and more useful than "be careful".** Three
of these four are *the same document contradicting itself across a few screens* —
the delegated authority, the capability's own caveat, the conflict it had just
recorded. **Internal consistency is not something a document has by default; it is a
property that has to be checked for, the same way facts are.** Nothing about being
correct in each section makes the sections agree.

**The internal-consistency pass, run unprompted because the last round established
the document needs one. It found a gap the size of four surfaces.**

Reading the master sequence against itself rather than against source: **the eight
behavioural checks are all WRITE paths**, because they were derived from the intake
finding and grew by widening. The degradation table at the top of the same document
lists four more surfaces that fail at the cutoff, and **no gate row verifies any of
them**:

| Surface | Gate required | Should require |
|---|---|---|
| Workload board | #1344 merged | board **read with Linear dead**, checked against known-changed data |
| Kasper → Editors subtab | #1346 merged | the native panel **rendering a real week** with Linear dead |
| Tweak comments | #1346 merged | a Tweak-Needed row **showing its comment** with Linear dead |
| Urgent Slack alerts | **nothing at all** | see below |

**"Merged" is the standard this document explicitly rejects for the intake repair**,
and then applies to four surfaces three screens later. If merging were sufficient
evidence that a surface works, P7 would not exist. That is the same
one-standard-here-another-there defect as the round before, found this time by the
pass rather than by a reviewer.

**The Workload row needed its own warning.** Its failure mode is **freezing, not
emptying**, so "I opened it and it looked right" is the single form of evidence that
cannot distinguish pass from fail. It must be checked against data known to have
changed since the reconcile stopped.

**And one surface cannot be gated at all.** `send-urgent-slack`'s native
replacement is **PR #1341, a draft**, on the integration branch, stacked on #1326.
Nothing on `main` replaces it. So it is now written as an **owner decision** — ship
a replacement before the cutoff, or accept that urgent editor alerts are down and
tell the staff who use them. **A gate requiring something nobody has built is not a
gate, it is a way of making the sequence unfinishable**, and quietly omitting the
surface, which is what the document did until now, is worse than either.

**Method note.** This is the first finding on this PR produced by a pass whose only
input was the document itself. Every previous one came from checking the document
against source, a live-state doc, or a reviewer. Both are needed, and they find
different things: source checks catch wrong facts, self-checks catch **one section
being held to a standard another section rejects**.

### Addendum, 2026-09-08 — the read checks could PASS FROM CACHE, and the handoff dropped them

Three findings, two P1. The first invalidates checks written one round earlier.

**1. Both new read checks were unsound.** In a browser that opened either surface
before the rehearsal:

- **`_kasperLoadEditors(false)`** hits `_kedLoadEditorsCache()` first and, on a hit,
  paints and **returns with no network call at all** — its own comment says *"Last
  week's data never changes — hit localStorage first unless the user explicitly hit
  Refresh."*
- **`wlFetchTweakComments`** skips the fetch for any issue id cached inside a
  **five-minute TTL**.

So "I set dead mode and the panel rendered a real week" proves **nothing**. It
replays pre-rehearsal Linear data while the native path is broken, and it looks
exactly like a pass. Each check now requires an explicit Refresh or a cold cache
**plus a correlated successful native request** — the render is not the evidence,
the request is.

**This is the mirror of "failing cleanly is the defect, not the proof".** There the
trap was reading a clean refusal as a pass; here it is reading a successful render
as one. Both come from **checking the surface instead of the path**, and this
document has now produced one in each direction. The generalisation worth keeping:
*a check that observes the UI can be satisfied by anything that paints the UI,
including a cache, a stale store, or a fixture.*

**2. The #1350 handoff dropped the read checks** one screen after they were added to
the gate — the same summary-drops-members defect, again, inside the same commit that
fixed an instance of it. The handoff now carries the three read checks and the
`send-urgent-slack` decision alongside the eight write checks and the reroute read.

**3. The F48 order was two steps short.** It read merge #1346 → confirm the panel →
deactivate. `N8N_REPLACEMENT_PLAN.md:260-273,515-516` adds two prerequisites: the
**event-time-assignee migration** (without it the panel attributes historical
transitions to the *current* assignee, so the report renders convincingly and is
wrong) and the **`deliverable_events` anon revoke** before the replacement is
served. Following the old order would have deactivated the legacy endpoint with both
problems live — trading a known-broken surface for a plausible-looking wrong one and
an open PostgREST read.

**A wrong report that renders is worse than an endpoint that fails**, because
failure is legible and a confident wrong number is not. That is the same reason the
Workload board's freeze is rated above the surfaces that die visibly.

**Addendum, 2026-09-08, after merging main (`b42f702`) — PR #1360 merged and hands
this lane a precondition, correctly.** The coordination lane's own words, now on
main: its entry gate *"is a note in a coordination document rather than an enforced
precondition"* until this runbook carries it, because **the operator at cutoff time
has `LINEAR_CUTOFF_RUNBOOK.md` open, not that file.** That reasoning is right and
the handoff is accepted in full: **P7, P7a, P7b, P7c**, gating STEP 3.

**The finding underneath it is a real defect in this lane's rehearsal, and it is
the sharpest one of the day.** My result form R1-R12 checks that surfaces render,
that two writes commit, and that the harness did its job. **Not one row requires a
post to be creatable.** So a rehearsal in which Calendar post, Samples/SXR post,
staff submission, append, component fill, label, assignee and client-link
submission **all refused cleanly** would have completed the form and been read as a
pass — because "fails cleanly" is what a rehearsal is usually looking for.

**On the intake paths, failing cleanly is the DEFECT, not the proof.** Those
surfaces read Linear through `production-write`, and none of the held PRs changes
that file. This is not a wording problem: the rehearsal is this lane's answer to
"does the app survive Linear being unreachable", and it was capable of answering
yes while every write path was dead.

Both documents now carry the eight checks as behaviour that must **succeed**, with
`3b` (append into an existing batch) and `4` (component fill) as separate rows
because `projectForIntake` alone does not cover them — `parentRouteForAppend`
reaches `validateLinearBatchParent` independently, which this lane confirmed at
`handleComponentFill:6038` and `handleIntakeCreate:6701`/`:6721` before the handoff
arrived. **P7a** carries the live `write_ui_reroute_clients` read, without which all
eight can pass on TEST while real clients still take the legacy lane, and which the
two live-state docs disagree about. **P7b** carries the three read checks with the
cache defeats each requires: `_kasperLoadEditors(false)` returns **with no network
call at all** on a cache hit, and `wlFetchTweakComments` skips inside a five-minute
TTL, so "I set dead mode and the panel rendered a real week" proves nothing.
**P7c** requires the `send-urgent-slack` decision to be recorded either way.

**The pair worth keeping, because this lane has now produced one of each.** A clean
refusal read as a pass (the write trap) and a cached render read as a pass (the read
trap). **Both come from checking the surface instead of the path** — and both were
invisible to me while I was checking that my documents agreed with each other,
because the documents did agree. They were agreeing about the wrong question.

**Running total: fifteen findings from sweeping my own documents and from other
lanes reading them, plus this one — the first that no amount of internal
consistency-checking could have surfaced.**

**Addendum, 2026-09-08, after merging main (`2c87a94`) — the decaying-citation
failure arrived on schedule, one merge after I wrote about it.** PR #1361 changed
`supabase/functions/production-write/index.ts` by 89 lines. **Ten of this
runbook's line citations shifted in that single merge:** `handleCreateOptions`
3335→3362, `handleProductionCreate` 3523→3550, the `production_create_closed`
throw 3592→3619, the create-path Linear reads 3604/3605→3631/3632, the label
snapshots 4947→4974 and 5491→5518, component fill 6038→6065, the appends
6701/6721→6746/6766, plus `_prodCreateGateText` 53854→53860 and the
`assignee_options` caller 50116→50122 in `index.html`. Eighteen occurrences
corrected against `2c87a94`.

**This is exactly what OPEN_REPAIRS 181 records against
`LINEAR_CUTOVER_TOUCHPOINT_INVENTORY.md`** — *"not one range still points at its
code"* — happening to a document written by a session that had read that finding
the same day and used it as an example. The gap between knowing a failure mode and
being subject to it is apparently one merge.

**The fix is a convention, not a correction.** STEP 7's table now opens with a
warning that these numbers decay, lists which ones already did, and instructs the
reader to **read the symbol, not the number**: every citation names a function or a
literal precisely so `grep -n 'function handleComponentFill'` re-finds it in one
command. A line number is a cache of a lookup, with no invalidation; the symbol is
the lookup itself. The numbers stay because they are useful when fresh, and are now
labelled with the commit they were fresh at.

**What this says about the cutoff, and it is the reason this is a ledger entry
rather than a commit note:** the runbook will be read on a day when `main` has
moved again, by an operator following it literally, on the surfaces that break
clients. **Every `production-write` citation in it must be re-verified by symbol at
cutoff time.** That instruction is now in the document rather than only here.

**Addendum, 2026-09-08, after merging main (`709b79c`) — two lanes moved the same
pinned file, and neither side's pin described the result.** PR #1363 changed
`scripts/monitoring-watchdog.js`, which this lane's brief reserves to it, while
this branch was also changing it. Both sides therefore re-pinned the same closure
member, and **the merge produced content that neither recorded hash matched** —
mine (`4a884593…`) described a file with two lanes registered and the old
threshold; main's (`c1a773a3…`) described one with the new threshold and no new
lanes. The merged file has both.

Resolved by recomputing against the merged content (`c2cc93ab…`) and writing **one
note covering both changes**, since a pin whose note explains only half of what
moved is a pin nobody can review. The note keeps main's distinction between the
**threshold** (180 → 360 for `monitoring_watchdog`) and the **detection time**
(threshold plus the observation interval, near 634 minutes, an estimate from the
worst observed host gap rather than a bound) — that separation is the error main's
lane had to correct twice, and flattening it back on merge would have undone their
work silently.

`MONITORING.md` conflicted the same way: my three new coverage rows against main's
rewritten dead-man row. Kept all three of mine plus **main's** version of the row
they changed, rather than mine.

**Worth noting for the coordinator, without complaint:** the brief assigned
`scripts/monitoring-watchdog.js` to this lane exclusively, and another lane changed
it anyway — correctly, as it happens, since the switch was paging about itself on
five of its last eight runs and that is worth fixing immediately. **The exclusivity
rule did its job even when broken**, because the collision surfaced as a merge
conflict on a pinned hash rather than as two silently diverging thresholds. The
lesson is not "enforce the rule harder": it is that **a content pin catches a
coordination failure that a file-ownership rule only discourages.**

Verified after committing, because this suite reads from git HEAD: closure 37
assertions, `monitoring-watchdog` passes with all ten lanes present and the new
threshold, `repo-map-sync` 316, `repo-identity-exposure` clean.

## 182. [2026-09-08, FIXED in the browser; nothing to deploy] SyncLinear felt "sometimes really slow" while the backend answered in half a second: the tab was downloading every batch description on every open and every return

**Owner report.** "Sometimes SyncLinear is pretty slow today. It was really fast a
couple of days ago." Calendar and Workload "feel slow" too, on and off.

**What was measured (sandbox, 2026-09-08 22:00 UTC, twelve samples over two
minutes).** Every read the Production tab makes at boot answered in 0.3 to 0.6
seconds; one deliverables page in twelve took 1.8 seconds. The GitHub Pages fetch
of the app took under half a second. Supabase's status page showed "partially
degraded" for an unrelated 401 incident. So the server was not the slowness. The
weight was in what the tab pulled, and how often:

| Read at boot | Compressed | Note |
|---|---|---|
| `index.html` | 1.3 MB | cached 10 minutes by Pages |
| `batches`, 2 sequential pages | 1.1 MB | **1.0 MB of it is the `description` column**: 2.3 million characters across 1,688 rows, median 743, evenly spread, not one bad row |
| live deliverables, 3 sequential pages | 0.75 MB | 2,316 rows |
| terminal tail, ~5 pages | ~1 MB | 4,098 rows, deferred |

And `_prodAutoRefreshOnReturn` re-ran the FULL load (batches and live projection
again, about 2 MB) on every return to the tab after 30 seconds away. On a link
whose throughput moves around, that is exactly "fast one day, slow the next,
slow within the same day". The description column was consumed in one place: the
detail panel of the parent that is open. Deliverable descriptions (`brief`) had
already been taken off the boot read for the same reason; batches had not.

**What changed (`index.html` only, so it ships with the merge; no function deploy,
no migration).**

1. `PROD_BATCH_SELECT` no longer carries `description`. A batch parent's panel
   reads its ONE row on open through the synthetic branch of
   `_prodEnsureDescription`, over the same browser grant, with the same three
   late-answer guards as the deliverable path (request token, projection
   generation, row scope). The old branch declared the description "ready"
   without reading anything, which was only true because boot had read it.
   `_prodCarryBatchDescriptions` keeps a held description across a full reload
   only while the row's `updated_at` is unchanged: the description write is a
   compare-and-swap on that stamp (item 2026-09-01), so a moved stamp means
   read it again.
2. A tab return calls `_prodRefresh({ silent: true, incremental: true })`, which
   routes to the existing `_prodDeltaRefresh` (rows stamped since the watermark,
   full reconcile every ten minutes as before) instead of the full load. Authority
   is still re-read on return. The delta now also walks `batches` on their own
   watermark (`_prodMergeBatchRows`), so a filming day planned since the last
   read appears on the next tick rather than at the reconcile; a batch whose
   stamp moved marks its open panel stale (`_prodMarkBatchDescriptionsStale`) so
   the text is re-read rather than shown as current.

Not done, by the owner's choice: trimming the 20+ `raw_*` attribution columns from
the deliverable select (the third proposal).

**Effect.** Boot drops from about 3.2 MB to about 2.2 MB compressed and loses the
slowest single query (the description-only read alone took 1.9 s). A tab return
drops from about 2 MB to a few kilobytes unless rows changed. The manual Refresh
button keeps the full path.

**Proof.** `test/prod-boot-payload-diet.js` (new) pins both rules against the
shipped source and executes the two merges and the return listener.
`test/prod-deep-link-fast-paint.js` and `test/production-preview-source.js` were
updated for the renamed batch merge. The mocked browser gate
(`docs/syncview-design/tests/prod-write-gateway-browser.js`) and the boot budget
were run before push.

### 182a. Two defects the first draft shipped, both caught by Codex review on #1364

Recorded because the wiring tests passed while both were live, which is the
transferable lesson: an assertion that the call EXISTS is not an assertion that
it WORKS.

**P1 — the one-row read could not terminate.** The first draft called
`_prodRestRows('batches', PROD_BATCH_DESCRIPTION_SELECT, 'id=eq.<id>', 1, 1)`.
That helper only returns when a page comes back SHORTER than the page size, so
an exact one-row match filled the only page, fell out of the loop, and threw
`batches read exceeded pagination cap`. **Every batch-parent description would
have rendered "Description could not load."** The page size is now 1000 (an
`id=eq.<uuid>` returns at most one row, and 1000 matches the sibling id-list
read rather than inventing a second convention). `test/prod-boot-payload-diet.js`
now EXECUTES the real pager with both argument sets: it asserts the old ones
throw — so the test can fail for the reason it names — and the shipped ones
return.

**P2 — the direct batch view was never served.** `?batch=<id>` is view `batch`
with `openBatchId`, and `_prodBatchDetail` renders `batch.description` straight
off the row. The on-demand loader was reached only from view `detail` with an
`openId`, so that view sat on its loading skeleton forever once the column left
the boot read. The read now lives in one shared function
(`_prodReadBatchDescriptionRow`) with a second entry point
(`_prodEnsureBatchDescription`) called from the render pass for the batch view,
terminating the same way `_prodEnsureLabels` does: a row that already has the
column returns before the read, and a failed read is remembered, so
render → ensure → render cannot spin. A failed read now says
**Description could not load.** rather than holding the skeleton, and both the
manual refresh and a delta that moves the batch's stamp clear the remembered
failure so it is not permanent for the session.

### 182b. A third defect, also from Codex review on #1364: the superseded direct-batch read

`_prodEnsureBatchDescription` guarded its answer on `_prodState.projectionGeneration`
alone. That counter only advances in `_prodLoadData` — **the operational delta
never touches it** — so a delta that moved a batch's stamp mid-read left the
generation equal and the older answer comparing as current:

1. Read A goes out for batch `b1`.
2. The 30s delta sees a newer `updated_at`, `_prodMergeBatchRows` replaces the
   row without its description, and the stale-mark drops the read state.
3. The next render starts read B, which lands with the fresh text.
4. Read A lands afterwards, passes the generation check, and overwrites the
   fresh text with **stale text and an older `updated_at`**.
5. The row now carries the column, so it looks loaded and is never re-read.
   The stale stamp also lowers `_prodDeliverableWatermark(_prodState.batches)`,
   so the delta re-fetches ground it has already covered.

Fixed with a per-batch request token (`batchDescriptionTokens`), the same shape
`descriptionRequestTokens` already gives the deliverable path. Both the manual
refresh and a delta that moves a batch's stamp now retire the reads in flight
for those rows rather than only dropping their state.

**A wedge in the first draft of that fix, found by writing the test.** Making a
superseded read touch nothing at all is correct when a NEWER READ owns the state
entry, and wrong when only the GENERATION moved: nothing then releases the
`loading` marker, and the guard that refuses to start a read while one is in
flight would lock that batch out of ever loading again. A superseded read now
releases the entry only when its token says it still owns it. Today the full
load that moves the generation always runs `_prodMarkDescriptionsStale` first,
which clears the entry anyway — the repair is so this stops depending on that
ordering holding forever.

The regression test drives the real race, with both reads resolved in the
damaging order, and asserts the newer text survives, the older stamp is not
written back, and the newer read keeps ownership of the state.

### 182c. Two more from Codex round three: a second token domain, and a cursor made of local writes

**The two readers of a batch row did not retire each other.** A batch row's
description has two readers, keyed differently — the synthetic parent panel by
ISSUE id (`descriptionRequestTokens`) and the direct `?batch=` view by BATCH id
(`batchDescriptionTokens`). The token added in 182b protected only the second.
So leaving a `?batch=` view with a read in flight and then opening or editing the
synthetic parent let the older read land on top of the newer answer. Through the
save path it is worse than stale text: all four writers of a batch description
(the optimistic pre-save value, the committed save, and both conflict restores)
funnel through `_prodSyncBatchDescriptionRow`, so a read that started before a
save landed after it and **silently reverted text the user had just committed**.

Both readers now take the same shared per-batch token, and every write through
that funnel retires it. The rule is now one sentence: whichever read STARTED
LAST is the only one whose answer can land, and any completed write retires
every read older than it.

**The batch delta cursor was derived from rows that local writes mutate.** It
was `_prodDeliverableWatermark(_prodState.batches)` — the newest stamp among
local rows — but a point read and every description save write a fresh
`updated_at` onto ONE row. Open one batch whose row is newer than the rest and
the cursor jumps to it, so `updated_at >= cursor` excludes every batch changed
between the last real read and that stamp; those stay invisible until the
ten-minute reconcile. There is now a real `batchDeltaCursor` advanced ONLY from
server answers (seeded on a full load from the raw rows, before the merge lets a
local value near them), compared as parsed instants rather than strings, and it
never moves backwards.

**A pre-existing twin, NOT fixed here, deliberately.** `_prodSyncDescriptionRow`
does the same thing to `deliverables.updated_at`, and the DELIVERABLE delta
watermark is still `_prodDeliverableWatermark(_prodState.deliverables)`. That is
the identical defect on the older path and it predates this change; it is left
alone rather than widening a PR already three review rounds deep. Worth its own
repair — the fix is the same shape as the one above.

### 182d. Codex round four: two defects the round-three fix created

Both are consequences of the shared per-batch token added in 182c, which is
worth stating plainly: each repair in this sequence exposed the next layer.

**A displaced reader never released what it owned.** The shared token means one
read can supersede another. The superseded synthetic read returned bare, leaving
its panel's `state.refreshing` set — and the guard at the top of
`_prodEnsureDescription` refuses to start a read while that is set, so the panel
short-circuited on every later open and **never loaded again**. Reachable by
switching between the two synthetic parents of a split-team batch, which share a
`batchId` and therefore share the token. Separately, when a synthetic read
superseded an in-flight direct read and then FAILED, the direct read's
`batchDescriptionReads` entry stayed on `loading`, stranding the `?batch=` view
on its skeleton until an unrelated refresh.

Now: a displaced read releases its OWN per-issue panel state (and only while its
own issue token still says it owns it), and whichever read holds the shared token
owns the shared entry on both exits — `loading` on start, `ready` on success,
`error` on failure. One reader, one truth.

**Stamp equality masked real remote changes.** A description-only read or save
writes a fresh `updated_at` over otherwise old fields. When a batch's metadata
changed remotely and a description read landed before the next delta, the delta
then received the complete row carrying that same stamp, `_prodMergeBatchRows`
read the equality as "unchanged", and the adapter was never rebuilt — so the
batch **name, status or `linear_parent_ids` stayed stale** until the ten-minute
reconcile. Rows advanced by a partial write are now tracked in
`batchPartialRows`; the merge refuses stamp equality for them, clears the mark
once a complete row replaces it, and a full load clears the set entirely because
every row in it came from a complete read.

The regression test executes the second one on the exact shape of the bug: a
complete row arriving at the SAME stamp as a partially advanced local row still
counts as changed, its fresh fields land, and the mark is not sticky afterwards.

### 182e. Codex round five: the Refresh button could not clear a failed batch read

`_prodMarkDescriptionsStale` clears the remembered batch-description read states,
and it is reached from `_prodRefresh`. **The visible topbar Refresh button does
not go that way.** It runs `_prodManualRefresh` →
`_prodDeltaRefresh({ full: true })` → `_prodLoadData`, none of which touches
`_prodMarkDescriptionsStale`. So an `error` left by a failed one-row read
survived the very control offered to clear it: the full load replaced the batch
row (still without `description`), `_prodEnsureBatchDescription` returned early
on the retained `error`, and the batch view kept saying **Description could not
load.** until a page reload or an unrelated change to that batch.

Fixed by retiring every remembered read inside `_prodLoadData` itself, beside
where it already clears `batchPartialRows` — the shared
`_prodInvalidateBatchDescriptionReads(null)` rather than a bare clear, so a read
still in the air is retired rather than left able to land on the new projection.

The regression test walks the whole button path instead of assuming it: that
`_prodManualRefresh` goes through `_prodDeltaRefresh({full:true})`, that the full
branch reaches `_prodLoadData`, and that **neither calls
`_prodMarkDescriptionsStale`** — the last one being the fact that made the
original placement wrong, so the test fails for the reason it names.

**Running count on #1364: eight findings across five rounds.** The original
change (drop a column from a boot read, route tab returns through the existing
delta) has held up; every finding after the first two came from the machinery
added to fix the ones before. The cost is concentrated in one place — putting a
new on-demand read into a surface that already had two readers and two
invalidation schemes. If a future session touches batch descriptions again, the
cheaper design is ONE owner for the read with ONE state machine that both
surfaces render from, not two readers cooperating through a shared token.

### 182f. Round six stopped the patching: the two-reader arrangement was the defect

Codex's sixth round found two more, both inside the machinery added to fix
rounds three through five, which is the condition #1364 had already committed to
stopping on.

**Both verified before acting.** A synthetic parent replaced mid-read by a real
one (hierarchy rebuild) failed the panel's currency check while the shared batch
token had not moved, so the panel released only its own state and left
`batchDescriptionReads[batchId]` on `loading` — after which every later direct
`?batch=` read refused to start. And `batchPartialRows` was marked
unconditionally, so a read returning the SAME stamp still marked the row partial;
since the batch delta filter is `updated_at >= cursor` and therefore inclusive,
the boundary row returned on every tick, the merge called it changed, the
description was dropped and re-read, and the row was marked partial again. A
30-second loop costing an extra request and a skeleton flash — undoing the
saving this change exists for.

**The repair was not a seventh patch.** Four of the ten findings on #1364
existed only because TWO functions read and wrote one batch row, cooperating
through a shared token across two state maps: an older answer landing on a newer
one, a save reverted by a read that started before it, a displaced reader
stranding its own panel, and a displaced reader stranding the other reader's
entry. The arrangement was the defect; each fix created the conditions for the
next.

`_prodEnsureBatchDescription` is now the sole owner, keyed by batch id. The
synthetic parent panel waits for it and reflects the row instead of running its
own read. That deletes the shared token, the second writer of the shared read
state, and the whole "which reader owns this entry" question rather than
answering it a fifth time. What stays per-panel is what genuinely is per-panel:
a split-team batch has two synthetic parents sharing one `batchId`, each with
its own editor state, caret and scope, so each keeps its own token and its own
release.

Partial marking is now one comparison in one place, against the stamp captured
before the write.

**The general lesson, for whoever adds the next on-demand read here.** A test
that asserts a call EXISTS is not a test that it WORKS: the wiring assertions on
this PR passed while a read that could never terminate and a view that never
loaded were both live. And when a second reader of the same row starts needing a
token to coordinate with the first, the reader is the thing to remove, not the
token to refine.

### 182g. The redesign's own regression: a background read destroyed an open editor

The single-owner collapse in 182f shipped with a defect the unit suite could not
see, and it is the most user-visible thing found on #1364.

`_prodEnsureBatchDescription` repainted on EVERY completed read, for any batch,
open or not. `_prodRender` rebuilds the surface, and the description editor is a
`contenteditable` — so a background read for an unrelated batch tore out an
in-progress edit on the row the user actually had open, along with the caret and
focus. Anyone typing a description while a batch read landed would have lost it.

**How it was caught, which is the transferable part.** The mocked browser gate
failed at `inplace_link` — hover a link in a deliverable's editor, apply an edit,
expect focus back. That same step had genuinely flaked earlier in the session, so
the tempting read was "known flake, re-run". It failed twice. The decisive test
was not another re-run: it was checking out the PREVIOUS commit into a worktree
and running the gate there in the same sandbox, where it passed. Previous commit
green + this commit red twice = regression, not flake. A third re-run would have
been a coin toss dressed up as evidence.

The repaint is now gated on the batch being what the reader is looking at: the
direct `?batch=` view of that batch, or a synthetic parent of it. The panel that
delegates does its own repaint afterwards, and a batch nobody has open needs
none — the state is written either way and the next natural render picks it up.

**Two assertions in `prod-boot-payload-diet` had to be repaired with it**, and
that is worth recording rather than quietly fixing: they asserted "repaints
exactly once" while driving a batch that was NOT on screen, so under the correct
behaviour they were measuring zero repaints and passing for the wrong reason.
They now put the view on the batch under test. The regression itself is pinned in
both directions — a read for an unopened batch writes state and does not repaint;
a read for the batch whose synthetic parent is open still does.

**The standing lesson for this surface:** a description read is a background
operation, and a background operation must never repaint a surface that owns an
editor unless its own result is on screen.

### 182h. Concurrent waiters, the first finding the redesign made ordinary

Codex round seven, on the single-owner code. Worth recording because of what KIND
of finding it is: not another negotiation between two readers of one row, but a
plain single-flight question — the class the redesign was meant to reduce this
surface to.

`_prodEnsureBatchDescription` skipped a read already in flight instead of joining
it. A second caller's `await` therefore resumed BEFORE the column existed, and
the delegating panel treated an absent column as a completed failure and set
`error` — which its own guard then used to refuse every later non-forced attempt.
"Description could not load." until a manual refresh. Reachable with the two
synthetic parents of a split-team batch (they share a `batchId`), or by moving
from `?batch=` to that batch's parent mid-read.

Two independent repairs, either of which prevents the wedge:

1. **Join, don't skip.** `batchDescriptionInFlight` maps a batch id to the
   promise in the air; a caller arriving mid-read awaits that promise. Two panels
   now issue ONE network read and both resume with the answer.
2. **Only a recorded failure is a failure.** The panel calls an absent column an
   error only when the owner actually wrote `error`; otherwise it lands on `idle`,
   which the guard does not block, so the next render can ask again. A retired
   read is not a failed one.

**A third gap surfaced while writing the test, and nobody reported it.**
`_prodInvalidateBatchDescriptionReads` retired a read's token and read state but
left its in-flight promise, so the next caller would JOIN a read whose answer the
token check was already guaranteed to discard — resuming with nothing. It now
drops the in-flight entry too, so the next caller starts fresh; the retired
promise settles harmlessly against its stale token. Single flight joins live
reads, not dead ones.

### 182i. The single-flight cleanup evicted the wrong read

Codex round eight, on the round-seven fix. The textbook single-flight bug, and it
reads as tidying up rather than logic:

```js
finally { _prodState.batchDescriptionInFlight.delete(batchId); }
```

Read A is invalidated, read B starts and stores its own promise, then A settles
and its `finally` evicts **B's** entry. The next render sees nothing in flight,
starts read C, advances the token, and guarantees B's perfectly good answer is
discarded. Longer loading and redundant requests, from a line whose only apparent
job is housekeeping.

The entry is now removed only when the map still holds THIS invocation's promise.
The regression test drives that exact ordering — A retired, B started, A settling
late — and asserts B's entry survives and B's answer is the one that lands.

**Why this one is filed as ordinary.** Rounds three through six were each a
consequence of the previous fix inside the two-reader arrangement, which is why
#1364 stopped and replaced it. Rounds seven and eight are instead standard
single-flight questions with standard answers: join a live read, and clean up
only what you own. That is the shape this surface was meant to have after the
redesign, and it is the signal that the redesign did what it was for.

## 183. [2026-09-09, OPEN — owner decision, measured] Command-palette description search: what item 182 narrowed, and what it was already

Codex round nine on #1364 raised this, and it is the first finding on that PR that
is a FEATURE question rather than a defect. Verified before writing it down.

**What the palette actually matched, before and after.** `_prodPaletteItems`
ranks `i.desc`. For a deliverable that is empty and always has been: `brief` is
not in `PROD_DELIVERABLE_SELECT`, so a deliverable's description never reaches the
browser at boot. For a synthetic batch parent it came from
`node.batch.description`, which the boot read carried until item 182 stopped it.

| Row kind | Description searchable BEFORE 182 | After |
|---|---|---|
| Deliverable (6,325 rows) | **No** — `brief` was never in the select | No |
| Synthetic batch parent (1,540 of 1,688 batches carry one) | Yes | **No** |

So the parity claim at `WIRED-PARITY.md` was already only partly true, and 182
took the remaining part. `WIRED-PARITY.md` now states this accurately instead of
claiming search the app does not do.

**Why this is not being patched inside #1364.** The two cheap repairs are both
wrong. Reinstating `description` in the boot read restores 1 MB on every open,
which is the entire defect 182 exists to fix. Lazy-loading every batch
description when the palette opens moves the same megabyte to a keystroke and
makes the palette feel worse than the boot did.

**The right repair is a different feature: ask the server.** When the palette has
a query of a few characters, issue a `description=ilike.*<query>*` read against
`batches` (and, if briefs are ever wanted, the deliverable projection), merge
those ids into the ranked list, and debounce it. That is a new read path with its
own ranking and cancellation semantics — a feature, not a bug fix, and not
something to bolt onto a PR that has already absorbed nine review rounds.

**Owner decision, one line:** is palette search over post/batch description text
worth building as server-side search, or is title and identifier matching enough?
Nobody has reported missing it; it is recorded here so the answer is a choice
rather than an accident.

### 182j. The retraction: no description-only write advances a row's stamp

Codex round eleven found a THIRD defect in the same mechanism, which is the
signal that the mechanism was the defect.

**The finding.** A batch delta answering from a snapshot taken before a local
point read could return that batch at an older stamp. Because the row was marked
partial, the merge bypassed its equality branch, cleared the marker, and replaced
the newer local row with the older response — discarding a just-loaded or
just-saved description and regressing the batch's other displayed fields until a
later delta repaired them.

**The root cause was one decision, not three bugs.** A description-only read or
save wrote its `updated_at` onto the local row. That makes an otherwise-stale row
LOOK freshly read, and every consequence needed its own guard:

| Round | Consequence | Guard added |
|---|---|---|
| 182f | a complete row at the same stamp looked unchanged | `batchPartialRows` marker |
| six | marking unconditionally built a 30-second refetch loop | mark only when the stamp advances |
| eleven | an older snapshot could overwrite the newer local row | *(would have been a third guard)* |

**The repair is removal.** No description-only write advances a row's stamp any
more — not the one-row read, not the save funnel. `batchPartialRows` is gone from
the code entirely. The merge can trust stamp equality again, because every stamp
it sees came from a complete read.

Nothing is lost. A batch nothing changed sits below the delta cursor and never
comes back. A batch that genuinely moved comes back with a different stamp,
counts as changed, and its description is re-read. The description's own stamp
lives in the panel state (`state.sourceUpdatedAt`), which is what the
compare-and-swap actually reads — the row's copy was never load-bearing for it.

**Codex proposed exactly this in round four** ("avoid copying the row-level stamp
from that partial read") and I took the marker instead. That was the wrong call,
it cost three review rounds, and this is the retraction. Two tests that asserted
the stamp write now assert its absence.

**The rule worth keeping:** a third finding in one mechanism is not a third bug.
It is the mechanism asking to be deleted.

### 182k. I asserted the CAS read one thing and it read another

Codex round twelve, and the most instructive finding on #1364 because it was an
error of ASSERTION, not of code.

Justifying the 182j retraction I wrote, in a code comment and again on the PR:
*"the description's own stamp lives in the panel state (`state.sourceUpdatedAt`),
which is what the compare-and-swap actually reads — the row's copy was never
load-bearing for it."*

**That was false.** `_prodGatewayWrite` builds `expected_updated_at` from
`_prodBatch(payload.id).updated_at` — the ROW's copy — with attachment evidence
as the only preferred source. I never checked before writing it down twice.

**What it would have cost.** Saving a synthetic-parent description twice before
the next complete refresh: the first save succeeds and its committed clock is
discarded, the second sends the pre-save clock and takes a 409, and the conflict
restore routes through the same helper so the retry conflicts again — until a
delta or full reconcile happens to replace the row.

**The fix is a split, not a revert.** Those were one field doing two jobs, which
is the same conflation that generated 182f, round six and 182j:

| Value | Means | Read by |
|---|---|---|
| `batches.updated_at` (the row) | freshness of the last COMPLETE read | the delta merge's equality test |
| `batchDescriptionClocks[batchId]` | the CAS clock for the description column | `_prodGatewayWrite`, for `batch_description` only |

Every description write advances the clock; the one-row read seeds it; a complete
row retires it, because that row's own stamp is authoritative again.

**And the fix shipped its own defect, caught locally.** The clock was first
consulted for EVERY batch write, so a `batch_asset` write would have taken a
clock belonging to a column it does not touch. `test/batch-asset-write.js` caught
it by pinning that fallback. It is now scoped to `batch_description`, and both
suites pin the scoping from opposite sides.

**The rule worth keeping:** "X is what actually reads this" is a claim about
code, and it takes one grep. Writing it from memory into a comment makes it
durable, and into a PR comment makes it persuasive. Neither makes it true.

### 182l. The batch delta is removed, and five findings go with it

Codex round thirteen raised TWO more findings on the CAS clock added one round
earlier — a failed save's rollback restoring a stale clock, and a full load
clearing a clock newer than its own in-flight response. That was the fourth round
on the same small area, so the mechanism went instead of gaining a fourth guard.

**What was actually at fault, traced back.** #1364 added a 30-second batch delta
so a filming day planned elsewhere appeared sooner. Nothing else needed it. But a
delta needs `batches.updated_at` to mean *freshness of the last complete read*,
and `_prodGatewayWrite` has always needed the same column to mean *the clock to
send on the next description save*. One field, two meanings, and the fight
produced every finding after the first two:

| # | Finding | Guard I added |
|---|---|---|
| 1 | a complete row at the same stamp looked unchanged | `batchPartialRows` marker |
| 2 | marking unconditionally built a 30-second refetch loop | mark only on a stamp advance |
| 3 | an older delta snapshot overwrote a newer local row | *(removal of the marker)* |
| 4 | the CAS then sent pre-save clocks — a second save 409s | a separate clock map |
| 5 | that clock map had its own lifecycle holes | *(would have been more guards)* |

**The removal.** Gone: the batch delta read, `batchDeltaCursor`,
`_prodAdvanceBatchDeltaCursor`, `_prodMergeBatchRows`, `batchPartialRows`,
`batchDescriptionClocks`, `_prodMarkBatchDescriptionsStale`. 162 deletions
against 34 insertions. `batches.updated_at` means exactly what the gateway always
took it to mean, and the description CAS is the two-term expression that shipped
before this PR.

**The cost, stated rather than buried.** A batch created elsewhere can be up to
ten minutes stale in an open tab — the full reconcile, the manual Refresh, or any
full load will bring it in. That is what it was before #1364, so nothing
regresses against today's behaviour; only the extra freshness this PR briefly
added is withdrawn. Worth building again one day as its own change, with the
column conflict designed for rather than discovered.

**Unharmed, and the entire point of #1364:** batch descriptions are still off the
boot read (~1 MB an open) and a tab return is still incremental (~2 MB a return).

**The rule, now twice-proven:** when one small area produces a third finding, the
area is the bug. And when the mechanism came in as a nice-to-have rather than the
goal, removing it costs almost nothing and settles the whole class.

### 182m. A recovery on one split-team parent never reached its sibling

Codex round fourteen. Small, real, and the last behavioural finding on #1364.

A batch that spans video and graphics has TWO synthetic parents sharing ONE row,
each with its own panel state. When the shared description read failed both
remembered `error`. Retrying from one populated the row — but the sibling's own
`error` made the guard at the top of `_prodEnsureDescription` return before it
ever looked at the row, so it kept saying **Description could not load.** until
it was retried separately or a full refresh cleared it.

The panel now reconciles from the loaded row BEFORE honouring a remembered
failure. Scoped to a panel showing nothing (an `error`, or no value yet) so a
loaded panel is not re-adopted on every render, and idempotent because adopting
sets `ready` and `hasValue`.

**Also corrected: the test file's own header contract**, which still promised
that batches ride along in the delta. After 182l that is the opposite of the
truth, and a stale contract at the top of a gate is worse than none — someone
debugging a future failure would have read it and set about restoring the
mechanism this PR deliberately removed. It now states the ten-minute batch
staleness as the ACCEPTED behaviour rather than a gap to close.

## 184. [2026-09-09] The archive was re-downloaded six times an hour, and a background tick could land mid-keystroke

Owner-approved follow-up to item 182, from the same report ("as fast and as
smooth as it can be"). Two independent changes, both browser-only.

**The archive.** `_prodLoadTerminalTail` read every terminal row on every full
reconcile. Measured live 2026-09-09 against the deployed backend: **4,098
terminal rows**, 182 KB compressed per page of 1,000, **five strictly
sequential pages**, so ~0.9 MB and several seconds. `PROD_FULL_RECONCILE_MS` is
ten minutes, so an open tab re-downloaded the finished work **six times an
hour** — roughly 43 MB across an eight-hour day, for rows that by definition
are not moving.

It never needed that cadence. The 30-second delta reads `updated_at >=
watermark` with **no status filter**, so a row that CHANGES — including one that
has just become approved or posted — already arrives on the next tick. The only
thing a full re-read adds is convergence for a hard DELETE, which no watermark
read can see. So the full pass survives at `PROD_TERMINAL_FULL_MS` (one hour),
on the first tail of a projection, and on anything the reader asked for (boot
and Refresh both reach `_prodLoadData` non-silently); the ten-minute reconcile
takes a watermarked read instead.

Two details that are easy to get wrong and are pinned in
`test/prod-terminal-tail-and-busy-guard.js`:

- The watermark is over the **terminal rows only** (`_prodTerminalWatermark`).
  The whole-projection watermark is almost always newer, because the live half
  moves constantly, and using it would skip the very rows this is for.
- The incremental read **updates in place** (`_prodMergeDeliverableRows`). The
  full read may append only ids it has never seen, because the live half it
  joins is the fresher of the two; this read is the opposite — every row it
  returns moved *after* the copy held here.

**The tick, while someone is typing.** `_prodRefreshBusy` already deferred a
background tick for an open menu layer and for an in-flight write. It did not
defer for a caret in a field. `_prodRender()` rebuilds `#prodRoot` wholesale, so
a tick landing mid-keystroke replaces the node being typed into and takes the
caret and selection with it; the board's own filter and search inputs had
nothing protecting them at all. Workload has guarded its search input this way
since it shipped and Calendar defers on the same condition. Scoped to the board,
so a field focused on another surface cannot freeze this one.

### 184a. The correction that cost two browser-gate runs

The first draft added a SEPARATE mechanism: a `_prodIsBusy` / `_prodRenderWhenIdle`
pair that did the read and deferred the *paint*, and it routed the
batch-description arrival through it. That starved the arrival: the description
panel's editor is focused as a matter of course, so the repaint that panel was
waiting for never landed. `inplace_link` in the mocked browser gate timed out
twice, passed on `43b1455`, and passed again the moment the guard alone was
neutered — which is how it was narrowed to that one line.

Two rules came out of it, both now pinned:

1. **A repaint that IS the answer to a read the visible panel asked for must
   never be deferred.** Deferral is for UNSOLICITED repaints landing on a reader
   who is mid-interaction.
2. **Extend the guard that exists rather than adding a second one.** The draft
   duplicated the menu-layer check that `_prodRefreshBusy` already performed,
   which is how the two mechanisms could disagree about what "busy" meant.

Also recorded because it was stated wrongly to the owner first: Production was
**not** unguarded. Menus and in-flight writes were already covered, and
`_prodInvalidateScopedReadsFor` already preserves an open editor's draft. Typing
was the one real gap.

### 184b. The incremental read was a no-op, and the test could not see it

Codex on #1366, P2, and it was right about both halves.

`_prodLoadData` replaces `_prodState.deliverables` with the **live-only**
`PROD_LIVE_FILTER` result and only afterwards calls `_prodLoadTerminalTail`. So
by the time the tail computed `_prodTerminalWatermark()` there were no terminal
rows left to compute it from: the watermark was always `''`, the filter fell
back to the unwatermarked `PROD_TERMINAL_FILTER`, and the browser downloaded
all 4,098 rows on every reconcile exactly as before. **The change did nothing,
and every test passed.**

It could not be fixed by moving the watermark alone. An incremental read cannot
rebuild the archive, so if phase one drops the finished rows there is nothing
for phase two to add to. The archive has to survive phase one instead:

- `_prodTerminalTailFullDue(silent)` decides the mode **before** the projection
  is replaced, and the same value is handed to the tail rather than re-derived
  there. One rule, one place.
- `_prodCarryTerminalRows(live, previous)` carries the finished rows across the
  replacement when the next tail is incremental, with the **live half winning
  every collision** — a row that just left a terminal status appears in `live`
  with its new value, and the held copy is by definition older.
- On a full pass nothing is carried, so the full read's fresh rows are not
  shadowed by held copies. Boot and Refresh are always full passes, so the
  two-phase boot is byte-for-byte what it was.
- The in-memory carry cannot grow the cache: `_prodCacheProject` already drops
  terminal rows before writing.

**The test lesson is the sharper one.** `test/prod-terminal-tail-and-busy-guard.js`
seeded terminal rows straight into its sandbox and called the tail, so it
exercised the reader in a state the real caller never produces. It asserted the
mechanism worked while the mechanism was disconnected. A unit test that
constructs its own preconditions proves the function, not the feature; where a
caller establishes the precondition, the test has to establish it the same way.
The suite now runs the phase-one replacement first and asserts the watermark
survives it, and pins that the decision and the carry both precede the
replacement.

### 184c. A late incremental tail could revert a row that had moved on

Codex on #1366, second round, P2, and also right.

`_prodMergeDeliverableRows` replaces a held row whenever the incoming
`updated_at` *differs* — it never checks that the incoming one is NEWER. That is
safe for the 30-second delta, whose watermark is the maximum over the whole
projection, so no response it returns can predate a row already held. It is not
safe for the incremental tail, whose watermark is the **archive's** (routinely
older than any live row) and whose read spans several seconds across pages.

The case that bites is a row **leaving** the archive. The tail selects it while
it is still `approved`; a delta tick or a user write moves it to `in_progress`
while the read is in flight; the late response reverts the row's status in the
open tab until a later refresh — and someone can then act against that stale
state, which is the same shape as the reverts item 101 exists for.

`_prodDropSupersededRows(rows, previous)` filters the tail response against the
copies currently held before the merge sees it. An identical stamp is kept (a
same-second echo is not stale), and a row with no parseable stamp on either
side is kept, because absence of proof that it is stale is not proof. The full
pass needs none of this: it appends only ids it has never seen, so it cannot
overwrite anything.

Deliberately NOT fixed inside `_prodMergeDeliverableRows`. Making the shared
merge refuse older rows would be a no-op for the delta by the argument above,
so it would buy nothing there while quietly changing the contract of the path
that every write already depends on.

## 185. [2026-09-09] The pixel lane has been red for ten days without naming a single failing check

`production-polish-heavy` has failed on `main` on every run since 2026-08-30,
and every one of those runs reported the same public line:

```
Production heavy gate failed at: Production pixel parity [error_generic]
```

Nobody has looked at it, which is the correct response to a message that says
nothing. **The block was never the divergence; it was that the divergence could
not be seen.**

`pixel-wired.js` throws `${gaps.length} pixel parity gap(s) found` and prints
each gap to stderr. A gap's `message` is live-derived — computed CSS values,
element counts, console text — so it stays on the ephemeral runner by design in
a public repository, and nothing in the thrown message matched a classifier
signature, so `classifyFailure` fell through to the error-type fallback.

A gap's `state` is a different kind of thing: every one is a **string literal at
its call site in that same public file** (plus the two `<theme> palette` labels
built from its own closed theme list). So the labels can be published while the
messages cannot. `pixel-wired.js` now emits them on a `PIXEL_WIRED_FAILED_STATES`
marker line, and the gate matches each against `PIXEL_WIRED_STATES`, harvested
from pixel-wired.js's own source, before emitting `pixel_wired:topbar+icons`.

This is the mechanism the behaviour lane already uses (`BEHAV_WIRED_CHECKS`,
item 125, which records the identical blackout and the identical fix), reused
rather than reinvented, including the 24-name cap so a wide breakage summarises
instead of dumping.

Two properties are pinned in `test/pixel-parity-failure-is-nameable.js`, and the
second matters more than the first:

1. A known label is published.
2. **A label that is not a literal in pixel-wired.js is dropped entirely** —
   tested by feeding the matcher a fabricated client name and asserting it
   produces nothing, and by asserting a known label beside an unknown one
   publishes only the known one. The marker is also built from `state` only,
   never `message`, and that is asserted against the source.

**This makes the failure diagnosable. It does not fix it.** Whatever `main` is
actually diverging on is still diverging; the next run will simply say which
part. That is the prerequisite for anyone doing something about it.

## 186. [2026-09-09, FIXED in `production-write`; NEEDS A SECTION 4 DEPLOY] A client whose approve had already landed was told, permanently, that her account was not permitted to approve

**Reported by the owner from a client's screenshot**: the dialog said *"Your
account is not permitted to make this change on this item. Retrying will not
change that — ask an SMM or the owner to make it, quoting this code"* with
`operation_forbidden`, on a card she was trying to approve. It was not a
permission problem, no SMM could have helped, and the retry advice was correct
only by accident: the row was already sitting on the exact status she was
asking for.

**MEASURED, one active client slug, card `p_mrb65aeu_cjq0m`, 2026-09-09.**

| Where | What it says |
|---|---|
| `deliverable_events` 19:18:09 | `status_change`, role `client`, `client_approval → approved`, source `ui` |
| `deliverables` (video) | `approved`, `status_at` 19:18:12 |
| `calendar_posts` | `video_status` = **`Client Approval`**, `client_video_approved_at` = **null** |

Her approve **committed server-side**. The source row never followed. The
client Review tab reads the sheet, not the canonical row, so the card kept
showing "Awaiting your approval" with a live Approve button — and every click
after 19:18 asked `approved → approved`.

**The refusal.** `clientOperationAllowed` (`policy.mjs`) admitted a client
status write only when the CURRENT status was one a client may act from
(`client_approval` or `tweak`). A no-op — the row already on the value asked
for — fell through to the same `403 operation_forbidden` as a client trying to
jump a row out of `kasper_approval`, and `WRITE_UI_FAILURE_CODE_CLASS` maps
that code to the `access` class, whose text is the accusation above. So a
half-committed write presented itself to a paying client as a permission
problem, permanently, with no path out that did not involve staff.

**The fix (this PR).** The no-op is admitted. A client can still only ever name
`approved` or `tweak` — `CLIENT_STATUSES` is checked first and unchanged — and
the new arm fires only when the row already holds the value requested, so
nothing previously unreachable becomes reachable; the write is idempotent by
construction. What it buys is **self-healing**: the retry now succeeds, the
source-row upsert behind it runs, and the sheet catches up on the client's own
next click. `tweak → tweak` was already admitted by the transition arm; only
the `approved` case was stranded.

**What this does NOT fix, and it is the deeper item.** *Why* the
`calendar_posts` write did not follow its own committed gateway write at
19:18 is not established here. The gateway leg is acknowledged and the source
leg is not, which is precisely the shape `_writeUiRetrySourceAt` /
`checkpointCommittedSource` exist to hold — so either the checkpoint did not
take or the rollback in `_calReviewApplyApprove` ran anyway. Worth noting that
per item 101 a refused write leaves no server-side trace, so the browser-side
half of this is only recoverable from the client's own `localStorage` ring, in
her browser, which we do not have. **The client-visible symptom is closed; the
half-commit is not.**

**Live blast radius at the time of writing**: one card on one slug (one
component, video). Any client on any slug whose approve half-commits lands
in the same trap until this deploys.

---
---

## 187. [2026-09-09, FIXED — copy only] A card SyncView had just created said "Client attribution needs repair" for the twelve seconds before Linear answered

An SMM reported that a thumbnail he had just filed from the content calendar
refused every edit and accused the client of a broken mapping. The client was
fine. The report was a race with our own mirror, dressed as a data defect.

**Measured on the live row.** `GRA-7437` / `del_56236b60…`, graphics, an active
roster client. `deliverable_events` has it created from the calendar at
**19:28:29.255Z** (`action: create`, `source: ui`, `surface: calendar`) and the
mirror stamping it at **19:28:41.440Z**: twelve seconds. The stored row carried
the right `client_slug` throughout, and the browser view read
`raw_attribution_state: resolved` / `direct_project` on the far side of the gap.
`attribution-stuck-check.js` reports the row in no stuck bucket, and the client
has zero live rows with a missing project or an unresolved stamp.

**Mechanism.** Native creation writes the deliverable row first and mirrors it
into Linear after. `_prodResolveAttributions` derives the client from the
MIRRORED fields only — the row's own Linear project, then its ancestors, then
the persisted stamp — and never from the `client_slug` column SyncView itself
wrote at creation. So before the mirror answers there is no evidence at all and
the row resolves `needs_attribution` / `repair_required`. Run against the live
row with its mirrored fields stripped, the shipped resolver returns exactly
that; run against the row as it stands, it returns `resolved` / `direct_project`.

The gate was RIGHT for those twelve seconds — nothing had confirmed who owned
the row — but it announced itself as a repair, so a transient sync read as a
broken client and cost a round trip. **The fix is copy, not verdict.** A row in
the narrow syncing shape (no persisted stamp, no project from any source, no
Linear issue yet, and a stored slug that is a currently ACTIVE roster client)
now reads "Syncing to Linear" in its chip, its notice, its side-card project row
and its gate text, in the neutral muted key rather than the amber repair one.
The write is still refused, the row still groups under the needs-attribution
sentinel, and every other unresolved state — a stamp Linear invalidated, an
unmapped project, a conflict, a slug that is not on the active roster — keeps
the repair banner it has always had.

`test/prod-attribution-sync-pending-copy.js` executes the real functions out of
the shipped file and pins both halves: the softer wording for the syncing shape,
and each of the six ways out of it keeping its own banner.

**What this does NOT fix,** and is the owner's call: attribution still ignores
the row's own `client_slug`, so if the mirror ever fails outright rather than
lagging, the card stays read-only until somebody notices. Resolving a native,
pre-mirror row from its stored active-roster slug would close that, and is a
verdict change rather than a copy change. Measured today: **139 live rows**
carry no `raw_project_id`, so this read path reaches further than the one card.

- Done when: shipped (copy). The verdict question above stays open.

## 188. [2026-09-09, lane LX-URGENT, SUPERSEDED STATUS — the EF half is deployed (see 193) and the front end was corrected (see 194); the repo's writer copies are still NOT deployable, see below] The URGENT ping only ever pointed one way, and the second direction had to be the same machine rather than a second one

The URGENT ping covered exactly one case: a **video at Tweaks Needed**, pinging the
editor in `#video-editing`. The mirror case had no affordance at all. A card parked
at **Kasper Approval** could sit there indefinitely, and the only escalation was the
SMM chasing Kasper by hand — which leaves no trace on the row, so nothing on Kasper's
own screen said which of the cards in his queue could not wait.

**Shape.** The second flavour is deliberately ONE machine with the first, not a
parallel one: same button, same `_calUrgentSlackDispatch` confirm → POST → latch,
same four-column marker, same "the marker dies with its round" rule.
`URGENT_PING_KINDS` holds the only two things that actually differ (destination and
copy) and `kind` defaults to `'editor'` at every call site, so **no pre-existing call
path changed behaviour**. A third flavour would be a row in that table.

**The one predicate.** `_calKasperUrgentActive(post)` decides BOTH the button's Sent
latch and membership of the new Urgent section. That is the point: the section is not
a second opinion about what is urgent, it is the same fact rendered twice, so the two
cannot drift. Urgent is a **split of waiting**, not a fourth bucket — an urgent card
is a waiting card with a ping on it, and it renders, acts and finishes identically.
Both queue-count pills had to add the split back (`urgent + waiting`), or pinging a
card would silently shrink the count of work Kasper still owes.

**Two things this ran into that the video ping never had to.**

**1. Only video and graphic carried a change-stamp.** `video_status_at` /
`graphic_status_at` exist because the Linear reconciler needed them (2026-06-19,
GRA-6339); caption and title never did. The round key needs one for whichever
component the ping was fired from, so the migration extends the existing
`calendar_posts_stamp_status_at` trigger to all four. Rows that predate it carry
null, and the predicate treats **unstamped-and-still-at-Kasper-Approval as live**
rather than as a failed round — the generous direction on purpose, because the
failure that matters here is a pinged card silently *missing* from the Urgent
section, not one lingering a round too long.

**2. A pill can change flavour in place.** `_calUpdateCardStatusDisplay` used to
toggle the URGENT button's *state*; a component moving Tweaks Needed → Kasper
Approval now has to swap the **button**, because the two carry different handlers.
Restyling it in place would have left a pill that looks right and pings the wrong
person — a bug with no visible symptom until someone in `#video-editing` is asked
about a card they have nothing to do with. Both in-place updaters (calendar and
samples) now remove-and-rebuild on a `data-urgent-kind` mismatch.

**Recipient is never in the payload.** The browser sends card context only, exactly
as the editor ping does; `send-urgent-kasper-slack` resolves Kasper itself and
rebuilds the review-tab link, accepting a URL from the request only when it is on
the SyncView origin. Same reason the editor ping never trusted a mention: a webhook
that takes its recipient from an open page is a spam relay with extra steps.

**The deploy instruction this item first carried was the 2026-07-15 landmine,
verbatim.** It read: run the migration, then deploy `calendar-upsert` and
`sample-review-upsert` by hand because both are `NO CI DEPLOY PATH`. That is
true of the manifest and catastrophic in practice. Those two writers are the
⛔ FROZEN pair: live is `calendar-upsert` v43 / `sample-review-upsert` v44,
**owner-un-gated**, reverted to the pre-#836 tokenless source so clients' existing
review links keep saving. The repo source still calls `authorizeBrowserWrite`.
A plain `supabase functions deploy` of the repo source therefore RE-GATES them and
`401`s every client approval and comment on a pre-existing link — the outage that
happened **twice on 2026-07-15**, and `--no-verify-jwt` does not help because the
refusal is application-level, not JWT-level.

The generalisation, and the reason this keeps recurring: **`NO CI DEPLOY PATH`
reads like "deploy it by hand" and for these two it means "there is a live
divergence CI is deliberately not allowed to overwrite".** The manifest states
deploy ownership; it does not state whether the repo source is what is live. For
every other function those are the same sentence. For these two they are opposite
ones, and nothing in the manifest says so. PR #813's readiness pass already had to
replace these two functions' stale "deploy after merge" notes with freeze markers
once (`EXECUTION_LOG.md`, 2026-07-16). This is the third time the instruction has
been re-derived from the manifest and been wrong.

**So the marker columns are NOT deployable from this branch, and this item does
not claim otherwise.** The source change here is correct as *source* — it is what
the reviewed tree should say — but shipping it to the live writers means porting
the allow-list delta onto the exact live un-gated sources and deploying those,
which is an owner-approved operation under the freeze, not a step in a PR
description. Until that happens the allow-list drops the four marker fields: the
DM still sends and the Urgent section stays empty. **That failure mode is quiet**,
and it is now the expected state rather than a symptom of something broken.

**Owner step that IS safe and self-contained:** the migration
(`migrations/2026-09-09-kasper-urgent-pings.sql`). It only adds columns and widens
an existing trigger — it touches no Edge Function and cannot re-gate anything.

**THE SAME ASSUMPTION IS IN THE MIGRATION, ONE LAYER DOWN.** Its
`create or replace function public.calendar_posts_stamp_status_at()` was written
by copying the body out of `migrations/calendar-status-at-migration.sql` and
adding two branches. That copy assumes **the repo's migration file matches the
live function** — the identical assumption that made the deploy instruction
above dangerous, applied to Postgres instead of to an Edge Function. If the live
trigger has drifted from that file, `create or replace` silently overwrites the
drift. Nothing in the repo can tell you whether it has. Read the live definition
FIRST and compare its video/graphic branches:

```sql
select pg_get_functiondef('public.calendar_posts_stamp_status_at'::regproc);
```

The generalisation, which is the actual lesson of this item and is bigger than
either instance: **this repository is not the state of the system.** For most
files it is, which is exactly why the exceptions are dangerous — they read
identically. Two are now known (the frozen writers; possibly this trigger), both
found only because something checked rather than assumed. Before any change is
applied to a live artifact, read the live artifact.

**Owner decisions, 2026-09-09 (second round).** The owner asked for the feature
to be made safe to merge rather than held indefinitely, and chose the register +
review gates below but NOT the re-issue-every-link path that would close the
divergence for good. So:

3. **A kill-switch, defaulting OFF, now gates the whole affordance**
   (`kasper_urgent_ping_enabled` in `syncview_runtime_flags`; the browser fails
   closed on a missing row, missing key, failed read or malformed value). With it
   off the feature is INERT — no button, so no click, no write, no DM. This is
   what makes merging safe before the EF half exists, and it is one row to turn
   on afterwards with no deploy.

   It exists because "the front-end just adds a button" was wrong. Without the
   EF, a ping still POSTs a patch whose four marker fields the allow-list drops,
   leaving an UPDATE that writes only `updated_at` — and `dedupeByLinearIssue`
   (`scripts/linear-sync-reconcile.js:285`) picks the canonical row by most-recent
   `updated_at`, so on a card sharing a Linear link with another, a no-op ping can
   flip which row the calendar shows. Its own comment names that hazard. Status
   direction is unaffected (it keys on `*_status_at`, the GRA-6339 fix).
4. **`docs/ops/LIVE_DIVERGENCE_REGISTER.md` + `test/live-divergence-register.js`.**
   A change touching a registered path must touch the register in the same diff;
   a registered file must carry its own inline ⛔ warning and no copy-pasteable
   deploy command. The register is parsed for its own path list, so adding an
   entry arms the gate with no second place to edit. The owner declined the
   re-issue path, so this divergence is permanent — which is precisely why it
   needed a machine, not a memory.

**Owner decisions, 2026-09-09 (first round).**
1. **The PR was HELD, not merged** (marked draft, title prefixed `[HOLD]`). The
   owner's standard is that a client's approvals must never break, and half of
   this feature cannot be proven until the Edge Function half is real. It merges
   when the marker fields are live in the un-gated writers, not before.
2. **The `send-urgent-kasper-slack` webhook stays unauthenticated**, at parity
   with `send-urgent-slack` and every other browser-called SyncView webhook.
   Codex's P1 is accurate and is accepted, not refuted: an unauthenticated caller
   can cause repeated bot DMs to one person. It reads nothing, writes nothing,
   cannot inject a mention or an off-origin link past the sanitiser, and the
   recipient can mute it. Authentication is deferred to the n8n replacement
   (`docs/independence/N8N_REPLACEMENT_PLAN.md`) so the whole surface moves
   together rather than one endpoint being hardened while its twin stays open.

**TWO DEFECTS THAT MUST BE FIXED *IN* THE PORT, NOT BEFORE IT.** Codex's third
round found both. Neither is fixable in this branch in any way that could ship,
because both live in the artifact that has not been written yet — the live
un-gated writer source — and both are unreachable while the kill-switch is off
(no button, so no click path at all). Recording them here rather than patching
the un-shippable copy:

1. **The marker needs a delivered state, not just a sent-at.** Round 2 moved the
   Kasper ping to persist-before-Slack so a failed write could not produce a DM
   about a section that never populates. That traded one failure for its mirror:
   the marker now lands, the card repaints as Urgent, and if the webhook then
   fails, Kasper never got the DM — while the blank-field guard stops the empty
   marker from clearing it, so reloads keep suppressing the retry. Slack and
   Postgres have no shared transaction, so *some* window exists whichever order
   you pick; the fix is to stop pretending otherwise. Add
   `kasper_urgent_delivered_at` and require it in `_calKasperUrgentActive`, so a
   marker with no delivery is pending, invisible in the Urgent section, and
   retryable. That is a schema + writer change, i.e. the port.
2. **The marker guard reads a stale snapshot.** `applyKasperUrgentMarkerGuards`
   approves against `readExisting`, and the `.update()` that follows carries no
   status predicate — so a component moved out of Kasper Approval by another
   reviewer inside that window still gets a marker written, and the DM points at
   a section the live row already excludes it from. The fix is a conditional
   update (`.eq(comp + "_status", "Kasper Approval")` plus the round key) in both
   writers. Also the port.

Both are listed in the register entry's "to ship a change" path. A port that
lands the allow-list delta without them ships two known P1s.

**The exact delta to port when the writers are done.** Recorded here so the
person doing it is not re-deriving it from a diff. Onto the LIVE un-gated source
of each of `calendar-upsert` and `sample-review-upsert`:

```
1. ALLOWED             += kasper_urgent_pinged_at, kasper_urgent_status_at,
                          kasper_urgent_comp, kasper_urgent_by
2. SCALAR_FIELDS       += the same four
3. + KASPER_URGENT_MARKER_FIELDS  (the same four, as a roster const)
4. + KASPER_URGENT_COMPONENTS     (calendar: video/graphic/caption/title;
                                   samples: video/graphic)
5. + kasperUrgentComp() and applyKasperUrgentMarkerGuards(), called from
     applyGuards() right after applyUrgentMarkerGuards()
6. + the kasper_urgent_ping row in buildEvents()
```

Steps 5 and 6 are lifted verbatim from this branch. Steps 1-4 are list additions.
Nothing in the delta touches authorization, CORS, or any existing guard — which
is what makes it portable onto a source this branch does not contain.

## 189. [2026-09-09] The half-commit behind 186, replicated, root-caused, and half fixed: a lost response is not a failed write

Item 186 closed the client-visible refusal and said plainly that it did not
explain why the `calendar_posts` leg never followed its own committed gateway
write. This is that explanation, established by replication rather than by
reading, in `qa/client-approve-half-commit/probe.js`.

**Method.** The harness serves the repo, boots the real `index.html`, seeds one
card at `Client Approval` and drives the REAL client approve path. The client
branch needs no client token: `_calReviewMode()` returns `client` for any view
that is not `smmreview`, so `_calReviewApplyApprove` takes the same branch,
stamps the same `client_<comp>_approved_at` and routes the same gateway write.
Leg 1 (gateway) and leg 2 (`calendar_posts`) are recorded separately and each
fault is scored against the fingerprint measured on the live card: committed AND
stale AND unstamped AND still reading `Client Approval` to the client.

| Fault injected | Leg 1 | Leg 2 | Verdict |
|---|---|---|---|
| none (control) | commits | writes | correct |
| **gateway response lost** | **commits** | **never** | **reproduces** |
| storage refuses the checkpoint | commits | never | no: card stays Approved, storage error shown |
| source write rejected (500) | commits | attempted | no: card stays Approved, retry armed |

**Only a lost response reproduces it**, and the other two are ruled out on the
record rather than by argument. A browser cannot distinguish "the server never
received it" from "the server committed it and the reply was lost". The catch in
`_calFlushCardSave` assumed the first, rolled the card back through
`_CAL_ROLLBACK_FIELDS`, and abandoned leg 2. **The rollback is the whole
mechanism**: it is what put the card back to `Awaiting your approval` with the
Approve button live, which is what produced the repeat clicks that met 186's
refusal.

**The finding that decides the fix.** The durable repair journal ALREADY
completes leg 2 correctly. Harness case `A2` proves it: lose the first response,
restore connectivity, let `_writeUiResumeSourceRepairs` run, and the source row
lands with the right status and the right sign-off stamp. Nothing is missing.

**THE BROWSER FIX WAS ATTEMPTED AND WITHDRAWN. Four review rounds, seven
findings, every one a real defect in the FIX rather than in the original code.**
Recorded in full, because the next person to open this will otherwise make the
same attempt:

1. *Absence had no route home.* A request that died before reaching the server
   threw `status_reapply_required`, and `_calRetrySave` refuses to checkpoint
   without a committed repair ref, so the write was lost while the journal went
   on insisting it was owed.
2. *No CAS on this lane.* Reissuing on proven absence can overwrite another
   actor's status: Calendar/SXR status payloads carry neither `expected_status`
   nor `expected_updated_at`, and `production-write` requires them on the
   `production` surface only. The comment claiming server CAS settled that race
   was false.
3. *Legacy fallback.* A missing or rolled-back reroute flag sends the reissue to
   `_calLegacyPushStatusToLinear`, which fires unawaited and returns `skipped`.
4. *A 5xx is not proof of non-commit,* so treating it as definitive rolls the
   card back and re-arms the control: the original incident through another door.
5. *But a blanket `status >= 500` is wrong too.* `authority_unavailable` throws
   503 BEFORE `beforeAttempt` reserves the journal record, while
   `gatewayAttempted` is already true, so a never-sent request would arm a
   checkpoint with no repair refs and strand the card as "Source repair receipt
   missing".
6. *The optimistic approval was invisible as unconfirmed.* `_calReviewPanelHtml`
   returns the "Approved / Locked in" collapse before any error is read, and
   both queue predicates plus `_calReviewCardBody` filter on
   `_calReviewComponentActive`, which an optimistically-Approved component
   fails. The not-confirmed copy therefore never reaches a real client link in
   the single-component case: exactly the case the change targeted.
7. *The harness kept not proving what it claimed.* It recorded a commit before
   every simulated abort (masking the pre-server path), scored only against the
   fingerprint (so a broken recovery passed for the wrong reason), and DEFINED
   an `error-after-commit` fault it never ran.

**Why withdrawn rather than iterated.** The server half of 186 is deployed
(`production-write` v70), so a client no longer meets the refusal loop and this
is defence in depth, not an emergency. The area couples optimistic card state, a
two-leg write, a repair journal, authority preflight and two queue predicates,
and each patch surfaced another interaction. A correct fix needs CAS on the
calendar status lane and one coherent unconfirmed-state contract across the
review surfaces: edge-function work that overlaps almost entirely with the
server-side reconciler. Half of it, shipped to a client-facing surface, is how
the original incident happened.

**What ships instead: the replication, with the defect pinned.** Harness case
`A` asserts the CURRENT behaviour by name (a committed-but-lost response rolls
the card back and drops the sign-off stamp), so this cannot be quietly "fixed"
or regress further without someone deliberately rewriting a contract.

**What is still open, and it is the real one.** That repair runs only in that
client's browser, only if she comes back. She met an error, reported it, and
closed the tab, so a write the server had already committed was left unfinished
with nothing server-side able to complete it; her card stayed stale until an
unrelated staff browser projected the canonical status back at 19:32. **The
completion of a committed write still depends on one particular browser session
surviving.** Closing that needs a server-side reconciler (a deliverable whose
status disagrees with its card row is a repairable fact, visible without any
browser), which is an owner decision about who owns the card row and is
deliberately NOT taken here. The planned review-surface fault sweep across
Client / SMM / Kasper should shape it before it is built.

## 190. [2026-09-10, OPEN — reproduced, corroborated by the live row] Two silent losses on the review surfaces: the client's sign-off stamp, and a change request that never reaches the card

**Found by the review-surface sweep (`qa/review-surface-sweep`), and it explains
an anomaly item 186 recorded as unexplained.**

A client approve that meets ANY of the three write faults recovers its component
status to `Approved` and never writes `client_<comp>_approved_at`. The no-fault
control writes it correctly, so this is the recovery path dropping it rather
than the action failing to produce it.

| client / approve | source row after recovery | sign-off stamp |
|---|---|---|
| no fault (control) | `Approved` | **present** |
| gateway answer lost | `Approved` | **missing** |
| 5xx after commit | `Approved` | **missing** |
| source write rejected | `Approved` | **missing** |

**The live row agrees.** Item 186's production card ended at
`video_status = Approved` with `client_video_approved_at = null`, and that was
noted at the time as unexplained. It now has a mechanism and a reproduction.

**Why this one matters more than its size suggests.** Every other symptom in
this family is a temporary disagreement that heals. This one is a PERMANENT loss
of the only record that the client personally signed off. The status says the
work was approved; nothing says who approved it. On a product whose entire
service is client approval, that row IS the evidence, and after any network
hiccup it is blank. Nobody notices, because the card looks correct.

**A SECOND, DISTINCT SPLIT ON THE SAME SURFACE, AND IT IS UNCONFIRMED: a change
request may commit on the server and never reach the card.** Read the caveat
under it before acting: the eighth review round showed at least one of its six
rows is a harness artifact, so this is a lead, not an established defect.** Client and SMM alike, under a lost gateway
answer, a 5xx after commit, or a never-sent request that later resumes: the
gateway records the comment, `calendar_posts` gets nothing, and the resume does
not close the gap. The editor opens the card and sees no change request while
the server holds one. This one is worse in a specific way: with the approve at
least the STATUS eventually agrees, whereas here the card shows no sign that
anything was ever asked for.

It was missed twice, and the reason is worth recording: the sweep's scorer
skipped its thread check whenever no source write landed, which is precisely the
case where the split happens, so two published versions of the sweep concluded
"requesting a change is sound on both surfaces". A committed comment is a fact
about the SERVER and has to be compared whether or not any source patch landed.

**THE SWEEP'S COUNTS ARE NOT TRUSTWORTHY, and finding 1 does not depend on
them.** After eight review rounds the probe was shown to be wrong in both
directions at once: it over-reports (a staff boot creates a repair journal a
real client link would not, since client comments get `repair = null`) and
under-reports (its pre-resume window compares only component status, missing the
comment splits). Finding 1 stands anyway because the LIVE production row
corroborates it independently. Finding 2 does not, and is held as a lead until
someone reruns it from a real tokened client context. `qa/review-surface-sweep`
is marked instrument-only for the same reason.

**Not fixed here.** The sweep is an instrument, not a repair, and the fix likely
belongs with the server-side reconciler rather than as another browser patch:
the recovery path that restores the status is the same one that would carry the
stamp, and OPEN_REPAIRS 189 records why patching that path in the browser was
abandoned after seven review findings.

**What would prove a fix:** the sweep's `client / approve` rows flag zero
companion problems across all four faults with the control still writing the
stamp, AND every `request-change` row carries its committed comment into the
source row.

## 191. [2026-09-10, FIXED in the browser; ships on merge, no deploy] The client's sign-off stamp survives recovery now, and the proof is a negative control rather than a passing test

**Fixes half of item 190.** A client approve that met any write fault recovered
its component status to `Approved` and never wrote `client_<comp>_approved_at`,
so the record said the work was approved but not that the CLIENT approved it.

**The patch, twelve visible lines, three hunks.** Two pass `repairEdits`
carrying ONLY this action's sign-off edit into the status push, so the repair
journal actually holds the stamp instead of losing it with the rest of the
source patch. The third applies the existing stale-approval rule when a captured
stamp meets a newer reviewer state: a receipt can return a status this card has
since moved past, and a stamp must never be resurrected onto a component that is
no longer at a client-visible approval status. Neither hunk invents a stamp from
a status, which the focused test asserts directly.

**Provenance, stated plainly.** The patch and its unit test came from a
predecessor session's recovery packet (PR #1376, draft), whose own checkout,
browser harness and raw logs became inaccessible before publication. That
session's reported results are NOT carried forward as evidence. Everything below
was re-run here from a clean checkout.

**Proof, negative control first.**

| check | result |
|---|---|
| `test/client-review-repair-stamp.js` on UNPATCHED main | **fails**, on `newer status must govern whether a captured stamp is stale` |
| same test with the patch | passes, 12 status/component combinations |
| `qa/review-surface-sweep` before | 9 flagged, of which **3 = `client sign-off stamp missing`** |
| `qa/review-surface-sweep` after | 6 flagged, **0 sign-off**, only the unrelated comment split remains |
| `node test/run-all.js` | 423 of 425; the two failures (`ef-deploy-provenance`, `truth-sync`) fail identically on `origin/main` |
| `prod-write-gateway-browser` | passes |

The sweep is still marked instrument-only and its absolute counts are not
trustworthy, but a BEFORE/AFTER differential on one named signal is exactly what
it can support, and the signal it clears is the one item 190 corroborated
against the live production row.

**One honest wrinkle.** The browser gate failed on its first run of this session
at `prod-write-gateway-browser.js:1646`, a hover-then-tooltip wait in the
`labels_projection` phase, then passed twice. That code is the Production label
picker, which this patch does not touch, and the failure mode is timing on a
hover tooltip. Recorded rather than hidden; if it recurs on an unrelated PR it is
that gate's flake, not this change.

**What this does NOT fix**, all still open in 190 and 189: the confirmed
comment/card split (a change request commits on the server and never reaches the
card, now confirmed from a real tokened client context by the predecessor
session), the closed-tab case, the server-side reconciler, and repair of rows
ALREADY carrying an approved status with no stamp. This patch stops new losses;
it does not go back for the old ones.

---

## 192. [2026-09-10] Item 39/89 closed a door that needed one more room: a narrow, named escape hatch for a completed-issue card someone is still actually blocked on

Item 39 measured 17 actionable half-linked cards, 15 of them pointing at Linear
issues already `completed`, and closed with: *"`isOpenIssue` excludes the
completed ones, correctly: they are finished work"* and *"the 15 actionable
slots pointing at completed Linear issues need no status change ever. They are
recorded, not scheduled."* Item 89 asked for one owner decision on what to tell
a blocked person, and stayed open.

**"Never" was wrong for at least one of them.** Card `p_lin_vid12672`
("Video 3") was reported live 2026-09-10 by the owner trying to move it to
Posted via Set All To Posted, hitting `native_link_required` on the thumbnail
leg exactly as item 39 describes, on a card whose Linear issue (completed
months before the graphics flip) item 39 already had on its own sampled list.
12 other cards on the same client carry the identical shape, confirmed live
against the `deliverables` table: no row exists for any of them, on either
team.

Neither sanctioned repair reaches it: `b3-linkage-backfill.js` only stamps a
card onto a deliverable that already EXISTS, and none does here; B1's
stray-catcher insert path requires `isOpenIssue`, by design, for exactly the
reason item 39 gave.

**What shipped:** `B1_ALLOW_CLOSED_IDENTIFIERS`, a manual-only, explicit
allowlist input on the B1 Linear Incremental Refresh Action. A human names
specific closed Linear identifiers; only those pass the `isOpenIssue` gate, and
every other guard (insert-only, the existing-deliverable skip, the card-slot
conflict withhold) still applies untouched to a named issue exactly as it does
to any other stray candidate. Empty by default, so item 39's "correctly" still
describes every standing scheduled or ordinary dispatched run — this is not a
reversal of that finding, it is the one room the finding didn't anticipate: a
completed issue that needs a manual, named exception because a person is
actually blocked on it, not the general case of 900 quietly finished tickets.

**Correction to item 39/89's closing claim.** "Need no status change ever"
holds for most of the completed-issue bucket, but not provably all of it — this
is the counterexample. A report of `native_link_required` on a completed-issue
card is reachable and actionable, not "recorded, not scheduled" by default;
check whether someone is actually trying to move it before filing a new one
under the closed bucket.

**Dispatch sequence** (Actions → B1 Linear Incremental Refresh → Run workflow):
1. `changed_since` — far enough back that the named identifier's `updatedAt`
   falls inside the window; the issue's own completion date is a safe floor.
2. `allow_closed_identifiers` — comma-separated Linear identifiers, e.g.
   `GRA-6384,VID-11945`.
3. `apply` — on.
4. Verify: the card's `video_deliverable_id` / `graphic_deliverable_id` is no
   longer empty, and the write that was refused now succeeds.

**Not done here.** The 12 other same-shape cards found live on 2026-09-10 are
not yet dispatched — whoever runs the fix should include every identifier
actually blocking someone in one dispatch rather than one at a time.
`scripts/calendar-native-link-gap-check.js` still finds the remaining bucket
across every client.


## 193. [2026-09-10, LIVE; feature flag remains off] Frozen writers persist urgent markers without re-gating client saves

Follow-up to 188. Calendar v48 → v49 and Samples v49 → v50 were deployed from the exact downloaded ungated live sources plus the reviewed additive marker patch. Samples also required MIRROR_COLS additions. Calendar strips caption/title status timestamps from updates. Both retain verify_jwt=false, zero authorizeBrowserWrite occurrences, unchanged CORS and byte-identical shared code. Repository writer copies remain unsuitable for deployment.

Twenty offline cases pass. Real tokenless name/comment saves and all six supported component-marker writes returned HTTP 200/ok:true; separate database reads confirmed persistence and server-derived marker clocks. Dedicated test cards were removed with last-write guards. No notification or interactive-browser behavior is claimed. The feature flag was absent and remains off.

Full versions, bundle hashes, evidence limits, rollback and next action: [deployment receipt](FROZEN_WRITER_URGENT_MARKER_DEPLOY_2026-09-10.md). Next: owner decides when to enable and check the visible ping flow; no additional marker deployment is owed. Separate approval-recovery work is unchanged.

## 194. [2026-09-10, FIXED in the browser; ships on merge, no deploy] The two urgent pings stopped being one machine, and the switch could only be thrown for everybody at once

Follow-up to 188 and 193. Two things were wrong with the front end the moment the writers went live, and both were the same mistake: a Kasper-flavoured special case where the whole design was that there is no special case.

**The ordering.** The Kasper ping wrote its marker BEFORE sending the DM; the editor ping has always sent Slack first. That was introduced to stop a failed write producing a DM about an Urgent section that never populates. It bought that by trading the failure for its exact mirror: marker written, DM never sent, and the blank-field guard then refusing the retry — a card that looks pinged, to a reviewer who was never told. Slack and Postgres share no transaction, so SOME window exists whichever way round it goes; ordering only chooses which half can be lost, and the lost DM is the worse half because it is the deliverable. Reverted to Slack-first, so the dispatch path is now one code path with no per-flavour branch. `persistFirst` is gone from the source, and a test fails if the string comes back.

**The switch.** `kasper_urgent_ping_enabled` was read as `{enabled:true}` and nothing else, so the only rollout available was all clients at once. It now takes `{"clients":[…]}` as well — the same roster shape `calendar_upsert_ef_clients` and `write_ui_reroute_clients` already use — and both affordance gates pass their own surface's client (`calState.client`, `sxrState.client`). Every other shape is still OFF, including a roster that does not name the client asking, a slug of `''`, `{"enabled":"true"}`, a malformed value, a failed read and a missing row. The click-time re-read added in 1370 round 3 now carries the slug too, so a client can be dropped from the roster mid-dialog and the ping still refuses.

**Codex found two defects in the roster work itself, both real, both fixed before merge.** They are worth recording because they share a shape: a gate that fails closed is still wrong when it fails closed on the wrong input.

1. *(P1)* The two click handlers still called `_kasperUrgentPingOnLive()` with no argument, so after the re-fetch the roster was asked about the empty client and refused. The affordance gate passed its client, so the button rendered normally and then answered "Urgent pings are off" on every click — a dead button, for every client, whenever the flag used the roster form. The test that was supposed to cover this counted the three call sites without looking at their arguments, so it stayed green while two of them asked about nobody. It now asserts that no call site is bare and that each names its own surface's client.
2. *(P2)* The comparison only trimmed and lower-cased. `calState.client` and `sxrState.client` hold **display names**; the roster holds **slugs**. Anything with a space, an accent, a leading `Dr.`, or an `and` the slug writes as `&` therefore never matched, and the failure was invisible: no button, no error, just a feature that quietly never appeared for the client it was turned on for. Both sides now go through `calClientSlug` / `_calRuntimeFlagClients`, exactly as `_calUpsertUseEf` and `_writeUiRerouteUseGateway` already do. The test fixtures were themselves complicit — they used the same string for the display name and the slug, which is the one shape that passes without any normalization at all — so they now differ.

Verified: unit suite green including new sandboxes (roster naming this client / roster naming another / no flag at all) and normalization cases for spaces, `and`/`&`, `Dr.`, padding and near-miss names. Both fixes carry a negative control: reverting the P1 fix makes the new guard fail, and the old comparison is shown missing all three display-name shapes. `prod-write-gateway-browser.js` green, `prod-boot-budget.js` green, live-divergence register green, identity-exposure clean. Test fixtures use a synthetic slug, never a live one. Next: the n8n DM copy still asserts "It is in the Urgent section at the top", which Slack-first can send a beat early — that edit is the owner's call and has not been made.

## 195. [2026-09-10, HALF LIVE — trigger written and backfilled, the four triggers await the owner's SQL run] The Kasper ping's paper trail existed only in a file that does not run

Follow-up to 188/193/194, found by going to look for a ledger row that should have been there and was not.

**The hole.** The tweaks ping has written an `urgent_ping` row to `calendar_post_events` since 2026-07-10 — 148 rows. The Kasper ping, shipped the day before this item, wrote none. Both repo writer copies carry an `ev("kasper_urgent_ping")` branch and a test asserted it was present, but the DEPLOYED functions do not have it: reading calendar-upsert v49 and sample-review-upsert v50 straight off production shows twelve emittable actions each, `urgent_ping` among them, `kasper_urgent_ping` in neither. The branch was simply not carried across when the marker patch was ported onto the live un-gated source. The first real ping wrote its marker at 20:01:03 and produced no event row at all — not even the status_change that a normal write leaves — which is what made it findable.

**Why nothing caught it.** Every guard we had pointed at the repo. The live-divergence register enforced that a known divergence stayed visible and annotated; it had nothing to say about a capability the repo GAINED that production never received. So the repo asserted a behaviour, the test agreed with the repo, and both were describing a file that does not execute.

**The repair, and why it is not an edge-function change.** Adding six lines to each live writer means redeploying the two functions that have broken client approvals twice. That is not a trade worth making for a ledger row. `migrations/2026-09-10-kasper-urgent-ping-ledger.sql` puts the write in a database trigger instead, which is better on the merits: it cannot drift from the live writers because it is not in them, and it records the ping whatever path performed the write, so the next writer or lane is covered without being told. It gives up `role`, which only the request context knows; `actor` comes from the marker's own `kasper_urgent_by` and `source` is `'db'`, which is honest about who wrote the row.

Built so it cannot hurt the tables it watches: the WHEN clauses mean the body never executes on an ordinary save, the body swallows every exception so no schema change can ever 500 a client approval, and it takes SECURITY INVOKER because the marker columns are only written by the service-role writers.

**State as of this entry.** The trigger function is created in production and the backfill has run (the one pre-existing ping is now in the ledger, marked `via: backfill` and carrying its original timestamp rather than pretending to be a live observation). The four triggers themselves are NOT attached — the environment refused to create triggers on the production tables, so the owner runs those four statements. Until then, new pings still go unrecorded.

**The guard needed three rounds of its own, and the last one is the lesson.** A guard built out of a regex inherits the regex's blind spots, and every one of them is silent. `/ev\("([a-z_]+)"/` reported `ev("approve_" + comp)` as the action `approve_` — a name that does not exist anywhere in production, which holds `approve_caption`, `approve_graphic`, `approve_title` and `approve_video` — so the register's first recorded row was itself a small fiction. Worse, the same regex could not see `ev('x')`, a template literal, or `const a = "kasper_urgent_ping"; ev(a)`, so the exact branch it was built to keep out could have walked back in with every check green.

`test/helpers/ev-actions.js` replaces it: it delegates comment removal to the house `strip-comments.js`, reads each `ev(` call's first argument, and sorts it into a literal, a composed name EXPANDED to the concrete domain of its enclosing loop, or **UNRESOLVED — which fails the gate by name rather than being skipped**. It carries no wildcard, deliberately: a first pass recorded `approve_*`, which hides the operand's domain, so adding a fifth component would have emitted a brand-new action with parity still green. Expanded, it resolves to `approve_caption`/`approve_graphic`/`approve_title`/`approve_video`, which is exactly what production holds. Both gates share it, so they cannot disagree about what a file emits. Proven against five reintroduction spellings: double-quoted, single-quoted, backtick, via a variable, and an interpolated template. All five fail both suites; the last two fail as UNRESOLVED with the offending text quoted back.

**Three things this turned up that were already wrong.** (a) The extractor's own first row recorded `approve_`, an action production has never held. (b) `docs/truth/SUPABASE.md` described the two event ledgers as "~22k rows / ~473 rows, 100% `source='ui'` to date … inbound/reconcile bypass the ledger" — all three parts false, and the counts off by roughly 80x. Re-measured by grouping on `source`: `calendar_post_events` holds 39,506 rows (32,173 `ui`, plus `calendar-reorder` 4,883, **`reconcile` 2,159**, `linear` 230, `calendar-upsert` 58, `sql` 2, `db` 1) and `sample_review_events` holds 62,173 (62,026 `ui`, `sample-review-reorder` 79, **`reconcile` 68**). Reconcile has written to the ledger continuously since 2026-07-07; it never bypassed it. That matters beyond bookkeeping, because AGENTS.md directs sessions to trust `docs/truth/` before re-auditing, and the doc's Track-B conclusion rested on the false premise. (c) The first draft of the shared extractor hand-rolled a comment stripper, when `test/helpers/strip-comments.js` already existed, is used across the suite, and its header rejects exactly that stateful approach with measurements. It now delegates, and lives in `test/helpers/` rather than an undocumented `test/lib/`, with a `REPO_MAP.md` row.

**The guard that would have caught this.** `docs/ops/LIVE_DIVERGENCE_REGISTER.md` now carries a Verified live capability section: per registered writer, the version, the date it was read, and the event actions the DEPLOYED function was observed to emit. `test/live-divergence-register.js` fails when a repo copy claims an action the register does not record as live, naming it. It cannot reach production from CI and does not pretend to — it compares the repo against a human-verified record and tells you how to refresh it. The failure it removes is believing the repo by default. Verified with a negative control: an invented action added to a repo copy fails the gate by name. Both repo copies now drop the branch entirely and point at the trigger, so repo and live agree again.
## 196. [2026-09-10, CLOSED] The Kasper ping records itself now, and the DM stopped claiming something it cannot know

Closes the half-installed state left by 195. The owner ran the four triggers; they read back attached and enabled on both tables.

**Proved through the writers rather than the database, on BOTH surfaces.** A marker write went to the live `calendar-upsert` for one TEST-client card and another to the live `sample-review-upsert` for one TEST-client sample — the exact call the browser makes once Slack succeeds, with the Slack step skipped so nobody was pinged — and each trigger wrote its ledger row on its own, carrying component, actor, both timestamps and `via: trigger`. The Samples half was added after review caught that the first drill was Calendar-only: it is a distinct code path into a distinct table, and since the trigger swallows every exception, a Samples-specific failure would have been invisible while approvals carried on working. "Attached" is not "working", and one surface working is not both. Clearing the test marker afterwards produced no second row, which is the correct behaviour: the triggers fire when a ping appears, never when one is removed. Testing through the database would have proved the trigger and left the interesting half, the writer-to-trigger hand-off, unproven.

**The DM copy.** It ended "It is in the Urgent section at the top." The browser sends the DM BEFORE writing the marker, so that sentence could be read a moment before the card moved, and stays false for good if the write fails. It now reads "Urgent cards sit at the top of your review tab" — a statement about where the section is, which no ordering can falsify. One string in one node; the version diff confirms nothing else moved. **The edit landed as a DRAFT and had to be published separately**; had that not been checked, this entry would have claimed a fix the live webhook was not running. That is the third time today a change looked applied and was not.

**And the reconciler question 195 raised.** `docs/truth/SUPABASE.md` said reconcile bypassed the ledger while 2,227 rows said otherwise. The reconciler writes no events: it sets `X-Syncview-Source: reconcile` and posts through the ordinary writer, which logs the change under the declared source. **Ledger coverage is a property of the ROUTE, not the caller** — `upsertUrlForClient` picks the EF or the legacy n8n lane per `calendar_upsert_ef_clients` (calendar) and `sample_review_ef_clients` (Samples). My first reading of that was too strong, and Codex caught it: I wrote that pre-enrollment reconciler writes were *invisible*, but the retained legacy writer appends `sample_review_events` too, with `source: 'ui'` HARD-CODED. So a reconcile through that lane was recorded and MIS-LABELLED, not lost. 2026-07-07 is therefore when source attribution became truthful, not when coverage began, and some share of the earlier `ui` rows are probably reconciler writes wearing the wrong label — unknowable from the `source` column, since that is the column that was lying. Whether the original claim was ever true is open, not settled. Nothing is broken; the ledger is more complete than advertised. The mechanism and the caveat are both in the truth doc rather than waiting to be re-derived.

## 197. [2026-09-10, BUILT — dry-run until dispatched with `dry_run=false`] The closed-tab case closes: a committed client action is now completable server-side, and two of the three "still open" items were badly mis-sized

**Closes the mechanism behind items 189 and 190.** Item 189 named the real one:
"the completion of a committed write still depends on one particular browser
session surviving." `scripts/client-signoff-reconcile.js` +
`.github/workflows/client-signoff-reconcile.yml` remove that dependency. A
committed client action whose card never received it is a repairable fact,
visible without any browser. Full design in
`docs/ops/CLIENT_SIGNOFF_RECONCILE.md`.

**The two rules it is built on**, both of which the tests attack rather than
confirm: evidence repairs and never invents (a stamp is the COMMIT TIME of the
client's approve, never `now()` and never derived from a status), and a card
that has moved on is never overwritten (staleness is decided by `index.html`'s
own `_calClearStaleApprovals`, extracted at runtime, so this job and the browser
cannot drift apart on the definition).

### Measuring first changed two of the three tasks

The ledger's own framing of what remained was wrong in both directions, and only
querying the live rows showed it.

| item as recorded | as measured | what it actually was |
|---|---|---|
| "rows already carrying an approved status with no stamp" | 8,316 rows | **not damage.** Most work is approved by staff or through Linear and no client sign-off is ever claimed. A null stamp is the NORMAL state; only a stamp missing against a *committed client approve* is a defect. |
| the same, scoped to committed client approvals | 11 | of which 6 sit on cards that have since moved to Tweaks Needed / In Progress and must NOT be stamped. |
| **repairable today** | **5** | |
| "the confirmed comment/card split" | 78 of 82 "lost" | **an artifact of the measurement.** The card stores comments as a JSON array, so any request containing a quote or a newline is held escaped and a raw-text search reports a miss. |
| the same, parsing the cell | 21 | 10 are backfill rows derived FROM the card; most of the rest are the same escaping artifact. |
| **repairable today** | **1** | one request from 2026-08-24, still at `Client Approval`, that the team has never seen. |

**Item 190's finding 2 was recorded as "confirmed"; it is real but roughly two
orders of magnitude smaller than the number attached to it.** That is the third
time in this thread that a count from a text-shaped comparison has been wrong,
which is why the repair parses the cell and the test pins a body that defeats a
raw search.

### Proof

| check | result |
|---|---|
| `test/client-signoff-reconcile.js` | 19 checks pass, offline, no credentials |
| negative control: stale-approval gate removed | **fails** (stamp resurrected onto a moved-on card) |
| negative control: closed-round gate removed | **fails** (settled work reopened) |
| negative control: body comparison removed | **fails** (duplicate delivered) |
| negative control: stamp taken as `now()` | **fails** |
| negative control: stale sweep skipped on delivery | **fails** (sign-off kept on a component asked to change) |
| `node test/run-all.js` | see the PR; the two pre-existing failures fail identically on `origin/main` |

A bug caught while writing it, worth recording because it would have failed the
first live run with a confusing error rather than a clear one: the read named an
`archived` column, which `calendar_posts` does not have. PostgREST errors the
whole select on an unknown column. Archived is the card's OVERALL status, the
same test `scripts/linear-sync-reconcile.js` applies.

### Not done here

- **Nothing has been written to any client's card.** The job is dry-run until
  dispatched with an explicit `dry_run=false`, and the workflow fails closed on
  a missing or malformed input rather than defaulting to apply.
- No cadence. The other reconcilers are dispatched by a monitored n8n pager;
  this one is dispatch-only until the owner decides it has earned a schedule.
- The browser-side write path is untouched. Item 189 records why patching it was
  abandoned after seven review findings, and this is the alternative that item
  named.

### 197a. [2026-09-10] Five review findings on the reconciler, all real, all verified against live rows before being fixed

Codex raised three P1 and two P2 on PR #1380. Every one was checked against the
database rather than accepted or argued with, and one of them was **narrower
than proposed** in a way that mattered.

| finding | verdict | evidence |
|---|---|---|
| P2 the cap is coerced, not validated | real | `Number('25x')` is `NaN`, every comparison false, mass-repair abort bypassed. Now exits 2 on a non-positive or non-integer cap. |
| P2 `processed_at` is outbound completion, not the client's write | real | `source_edited_at` precedes it by 2 to 4s typically, more on a retry. The documented contract is the commit time, so the originating clock now wins. |
| P1 identity misses `native_comment_id` | real | the card stores the native id: **row id matches 4 card entries, native id matches 57**. |
| P1 body matching swallows a repeated request | real | a client repeating a request in a later round matched the first round's entry. Fixed by CONSUMING each card entry at most once rather than existence-checking. |
| P1 an approval superseded by a later round can be resurrected | real | the current status alone cannot see approve → reopen → staff re-approve. |
| P1 no CAS between read and write | real, partially closed | see below. |

**The supersession fix had to be narrower than the finding.** The obvious rule,
"any later transition supersedes", was measured against the live candidates
first: **all five would have been discarded.** Their later transitions are
`posted`, and one is the staff browser at 19:32 projecting the client's own
decision back, which is item 186's incident, not a supersession. Only a move
back BELOW `Approved` is a reopen, ranked with the app's own `CAL_PRIORITY`
after its own native mapper, unmapped counting as a reopen. Under the corrected
rule all five survive and the finding's scenario is still blocked.

**Round numbers were considered and rejected as the repeat discriminator:** 2 of
317 live body matches sit on a different round, so a round-equality rule would
have delivered those as duplicates. Consuming entries one-for-one needs no
agreement about round numbering between the two systems.

**The CAS finding is honestly half-closed.** Every repair is now revalidated
against a freshly read row immediately before writing, by re-running the whole
detection so it cannot drift from the rules. That narrows the window to one
round-trip; it does not close it. A real fix needs compare-and-set on the write,
and this lane has none (item 189, finding 2) — Edge Function work, deliberately
not smuggled into a script PR.

Six new sabotage controls, all confirmed to fail the suite: the reopen gate
removed, unmapped status treated as safe, the outbound clock preferred, the
native id dropped, entries no longer consumed one-for-one, the body fallback
removed. 25 checks.

### 197b. [2026-09-10] A second review round, and the finding that mattered most: a fix that was inert in production

Five more findings on PR #1380, all real. One of them is the most useful thing
either review round produced.

**THE FIX FROM ROUND 1 NEVER RAN.** Round 1 changed the sign-off stamp to prefer
`source_edited_at`, the client's own write clock, over `processed_at`. The live
projection never SELECTED `source_edited_at`, so in production the code fell
straight through to `created_at` while the fixtures — which set the field —
proved the new behaviour perfectly. **A green suite and a wrong result, from one
missing column in a select.** The lesson is not "add the column"; it is that a
fixture asserting a field the real query never fetches proves nothing about
production. Fixed, and the doc now says so at the point where the projection is
built.

**Outbound delivery was being equated with source commit.** The read filtered
`status=eq.written`, but a row exists in `mirror_outbox` because the NATIVE
write committed; `status` describes what the Linear carrier did afterwards
(`pending` in flight, then `written`, `skipped`, `stale`). A reopen whose
delivery was pending or skipped was therefore invisible to the supersession
test, which is the one thing that lets a stale approval be restored. Live rows
show 683 `skipped` and 85 `stale` status rows in the window, and two of the five
live candidates carry later `skipped:approved` rows that were being dropped.

The two uses are now deliberately **asymmetric**: supersession (leave the card
alone) reads every row whatever the carrier did; repair (touch the card) still
requires a `written` client approval. Both directions err toward leaving the
card alone. All five candidates still repair; zero reopens appear under the
broader read.

**Identity now claims in two passes.** Ids are exact, so they get first refusal
across EVERY request before any body fallback runs. Single-pass in date order
had a real hole: two requests sharing a body where the card holds only the later
one under its native id let the EARLIER request consume that entry by body, and
the later one was then delivered again while the older request's identity and
round vanished.

**The body fallback no longer consumes an entry that cannot be the client's.**
A staff note, a reply, or a deleted entry carrying the same words is not a
delivery. Measured before restricting: all 327 live card entries matching a
client request are client-authored roots, and 18 of them carry `is_tweak:false`
— so authorship and shape are required and `is_tweak` deliberately is not.

Plus the doc now carries the direct Actions URL rather than a repo path, per
this repo's own standing rule about handing the owner a link.

30 checks, twelve sabotage controls in total, six added this round: an
undelivered approval acted on, the fallback consuming a staff note, a reply
counting as delivery, a deleted entry counting as delivery, staff roles not
excluded, and the id-claim pass bypassed.

### 197c. [2026-09-10] Round 3: a request names its component, and guessing when the name is unknown is how the wrong review gets mutated

One finding, real and latent rather than live. `production_comments` carries a
`title` component (YouTube title review), and the component map did not. The
code then fell back to the DELIVERABLE KIND, normally `video`, so a client's
title feedback would have been appended to `video_tweaks` and dragged
`video_status` to Tweaks Needed while `title_tweaks` stayed empty: the wrong
review, mutated on the strength of a guess, and the right one still missing.

**Latent, not live.** Client tweaks in the last 180 days are video (165),
graphic (106) and caption (74). **Zero title.** So nothing has been corrupted
and nothing needed repairing; the hole was waiting for the first YouTube title
request.

**The fix is the fallback, not the mapping.** Adding `title` closes today's
case; removing the silent fallback closes the class. A request that NAMES a
component the job cannot map is now reported (`unmapped_component`) and left
alone. The deliverable kind stands in only when the request names nothing at
all. The card read and the pre-write re-read both carry the title fields now.

The overall pill is unaffected either way: `computeOverallStatus` derives from
`CAL_COMPONENTS`, which is video/graphic/caption; title lives in
`CAL_REVIEW_COMPONENTS` only. So a title repair moves the title lane and
nothing else.

33 checks; two more controls (silent fallback restored, title dropped from the
map) both confirmed to fail the suite.

### 197d. [2026-09-10] Round 4: cards are keyed by (client, id), and this job was keying by id

The most serious finding of the four rounds, caught before a single write.

`calendar_posts` has the composite primary key `(client, id)`. **Card ids are
not globally unique: 13 live ids are used by more than one client, and 17
deliverables point at one of them.** This job kept its card map, its comment
consumption tallies and its pre-write re-read keyed by id alone, so one client's
card could stand in for another's. On an apply run that means writing a client's
approval, or their own words, onto **a different client's card**.

Nothing had been written, so nothing leaked. Every lookup, tally and re-read is
now composite, and a deliverable naming no client resolves to no card rather
than being guessed. `deliverables.client_slug` and `calendar_posts.client` both
hold the slug and compare directly (unlike `calState.client` in the browser,
which holds a display name — the trap PR #1381 hit).

**Two of the four new controls did not fire on the first attempt, and the tests
were wrong rather than the code.** A tally shared across clients only produces a
wrong answer when BOTH cards already hold the request; giving only one client
the entry leaves the other's list empty either way, so the assertion passed
under both implementations. Same shape for the blank-client case, which the
composite key refuses on its own unless the fixture's card also has a blank
client. Both fixtures were rebuilt until removing the rule actually fails.

That is the third time in this thread a check has been found to pass for the
wrong reason. It is the reason every rule here carries a sabotage control, and
the reason a control that does not fire is treated as a broken test rather than
a redundant one.

**AND IT WAS ALREADY IN THE LIVE REPAIR LIST.** This was not a latent risk. Of
the five stamp repairs the job had been reporting, re-running the detection with
the composite join returns **four**. The fifth (`p_native_93e7…_1`, graphic) is a
card id that belongs to TWO clients, and the id-only lookup had selected the one
that does not own the deliverable. Dispatching an apply run before this round
would have written one client's approval onto another client's card. The dry-run
discipline is the only reason it did not.

Also this round: the runbook still published 30 checks after Round 3 raised it
to 33. Corrected, now 37, with a note to keep it current.

### 197e. [2026-09-10] Round 5: four more, and two of them were ways this job could DESTROY client content rather than merely miss it

Every earlier round found ways to write the wrong thing. Two of these are worse:
ways to lose what is already there.

**An incomplete comment cell was being read as an empty one.** The parser
accepted valid JSON that is not an array (returning empty), and accepted arrays
holding entries with no id. `stringifyComments` and the merge RPC DROP id-less
entries, so a repair that rebuilt the array over such a cell would have **erased
real client feedback that simply predates the id field**. The browser's own
`_calLoadCommentsField` already treats both shapes as an incomplete read and
says so in its comment; this job did not. Both are now refused as unreadable.
Refusing costs a missed repair; treating them as empty costs the content.

**A resolved request would have been republished as open work.** `103 of 345`
live client requests carry a resolution. The writer hard-coded `done: false`, so
any resolved request that never reached the card would have landed on it as a
fresh task for the team. The resolution now travels with the request.

**The write side used the wrong identity.** The delivered entry stored
`production_comments.id`, while the browser's canonical projector and its
source-repair journal both key on `native_comment_id` (89 of the live rows have
a native id that differs). If this job completed a closed browser's failed leg
and that browser later resumed its journal, the atomic merge would have kept
BOTH copies and the client would see their own request twice. Detection already
recognised either id; the writer now emits the native one so the two recoveries
converge.

**Paged reads had no stable order.** PostgREST offset pagination without an
order is not stable across pages, and the outbox read exceeds one page. A
skipped row is the dangerous direction: a skipped reopen means the supersession
test never sees it. `restRows` now refuses to run without a unique order column,
checked BEFORE the credential because a missing order is a defect in every
environment while a missing key is environmental.

44 checks, five more controls, all confirmed to fail the suite.

**Five rounds, seventeen findings, all real.** The rate is not falling, which is
itself the argument for the dry-run posture: this job writes to client-facing
records unattended, and the review is still finding a way to get that wrong
every single round.

### 197f. [2026-09-10] Round 6: the round-5 fix was half a fix, and its test looked at the wrong half

Two findings, and the first is a lesson about the test rather than the code.

**A resolved request still reopened the round.** Round 5 carried the resolution
into `done`, which was the visible half. The status branch stayed
unconditional, so a resolved request whose component read `Client Approval`
still flipped it to `Tweaks Needed`, and the stale sweep then stripped the
client's sign-off on the strength of a request nobody was waiting on. Carrying
`done` while still moving the status is the worst of both.

**The round-5 test asserted `done` and never looked at the status**, which is
why it passed a half-applied fix. The replacement asserts the WHOLE patch:
status absent, overall pill absent, sign-off untouched, entry present and done.
That is the fourth check in this thread found to pass for the wrong reason, and
the pattern is now unmistakable: a test written to confirm the change I just
made will confirm exactly the part I was thinking about.

**A partial repair could never be finished.** `calendar-upsert` merges comments
and updates scalars as two separate operations (`writeCalendarRow`). If the
merge commits and the update fails, the request lands on the card with no status
change — and on the next run the id pass sees it, calls it delivered, and
suppresses the finding permanently. The round would sit at `Client Approval`
with an unanswered client request on it, forever.

Closed with a postcondition rather than an atomic write, which this lane cannot
offer: every delivered entry already carries `recovered_by`, so a claimed entry
with that marker, for an unresolved request, on a component still at `Client
Approval`, is reported as an unfinished status leg and repaired with the status
alone. The marker scopes it to this job's own work, so an ordinary card at
`Client Approval` can never match. It runs as its own pass AFTER both claim
passes, because the id pass is precisely the one that recognises the earlier
delivery — the first attempt sat behind that pass's `continue` and never ran,
which the test caught immediately.

49 checks, four more controls, all confirmed to fail the suite.

**Six rounds, nineteen findings, all real.**

### 197g. [2026-09-10] Round 7: one tightening taken, one suggestion declined with the number behind it

**Taken.** The unfinished-status-leg pass ignored the card entry's own
lifecycle. `loadWorld` reads the source comments once and the card is re-read
later, so `pc.resolved_at` can be stale while the card already shows the entry
done. In that window the pass would have moved a resolved component back to
`Tweaks Needed` and the sweep would have stripped its sign-off. It now refuses
any claimed entry marked `done` or `deleted`: the card was read later, so where
the two disagree the card is the better evidence.

**Declined, and this is the first suggestion in seven rounds not implemented as
proposed.** The suggestion was to exempt resolved requests from the closed-round
refusal, since round 6 made resolved patches status-neutral, so restoring one
would reopen nothing. The reasoning is sound. The measurement is what decided
it:

```sql
-- resolved client requests whose round has closed, and how many are
-- actually missing from their card
-- (full query in the round-7 session; the shape is: production_comments
--  role=client is_tweak, joined to deliverables and calendar_posts on
--  (client, id), component status not in Client Approval / Tweaks Needed,
--  and NOT EXISTS a card entry matching by id, native id, or normalised body)
```

**100 resolved requests sit on closed rounds. Zero are missing from their
card.** So the change repairs nothing today, while making a class of 100 closed
cards writable by a job whose matching logic has been wrong in six of the last
seven rounds. The standing bias is to leave a card alone, and this is exactly
the case for it.

What was done instead: those rows are now reported under their own reason,
`review_round_closed_resolved`, so a dry run shows them and the concern behind
the finding — "the request remains absent forever" — is answered by visibility
rather than by a write. If that count ever stops being zero the gate is one line
to relax, and the doc says so.

52 checks, two more controls.

**Seven rounds, twenty-one findings, twenty implemented, one declined on
measured evidence.**

### 197h. [2026-09-10] Round 8: both findings are holes in earlier fixes, which is now three rounds running

**Both real, both fixed, and the pattern is the finding.**

**1. The body fallback could be satisfied by a COMPLETED entry.** An unresolved
request whose only body match is a `done` card entry was treated as delivered,
leaving live client feedback invisible.

The proposed fix — require unresolved requests to match only unresolved entries
— was measured before being taken, and **it is not safe either**. Of 261 live
body matches, **108 land on a `done` entry, and 8 of those pair an UNRESOLVED
source request with a DONE card entry.** Under the proposed rule all 8 become
findings and get written, appending a duplicate of words already on the card.

Neither answer is right, because body text cannot distinguish:

- the done entry is an OLDER request with the same words, so the live one is
  genuinely missing (deliver is correct); from
- the done entry IS this request, resolved on the card while the source row
  lagged (deliver duplicates the client's own words back at them).

So the job does neither. It **reports** the 8 as
`ambiguous_repeat_of_completed_request` and a person decides. That is the honest
option, and it is the clearest evidence yet that request DELIVERY is a guessing
game in a way stamp repair is not.

**2. Revalidation refreshed the card but not the source row.** Round 7 answered
the half of this the CARD can see; this is the half only the source knows. A
request resolved or deleted between `loadWorld` and the write — precisely the
two-leg window this job exists for — would have been appended as open, or had a
status leg finished that was no longer owed. Revalidation now re-reads the exact
`production_comments` row, and a row that has vanished is dropped rather than
falling back to the snapshot.

55 checks, two more controls.

### THE TREND IS NOW THE MOST IMPORTANT FINDING

| round | findings | origin |
|---|---|---|
| 1 to 5 | 17 | defects in the original design |
| 6 | 2 | a defect in a round-5 fix |
| 7 | 2 | a defect in a round-6 fix |
| 8 | 2 | defects in round-5 and round-7 fixes |

Three consecutive rounds where the patch created the next round's bug. **Item
189 records this exact pattern once already**, on the browser-side attempt at
the same problem, abandoned after seven findings with the conclusion that each
patch surfaced another interaction.

Almost every finding since round 2 has landed on **change-request delivery**,
not on stamp repair. Delivery has to decide identity across two systems that do
not share ids, reconcile two lifecycle clocks, merge into a cell whose format
predates ids, and survive a non-atomic two-step write. Stamp repair reads a
committed approve, checks for a later reopen, and writes one dated field.

**Recommendation to the owner, put on the PR: ship the stamp repair, and demote
change-request delivery to detection-only.** It fixes 4 of the 6 live rows,
retires the surface that produced the defects, and turns the remaining 2 into a
report a person acts on. Not taken unilaterally: it narrows work the owner
asked for.

### 197i. [2026-09-10, OWNER DECISION] Narrowed to stamp repair; change-request delivery is detection-only

The owner chose to narrow after round 8, on the recommendation in 197h and the
trend table there. **This job now writes exactly one thing: a missing client
sign-off stamp.** Change requests that never reached a card are still fully
detected and reported by card, component and request id, and a person decides.

**Why the split falls where it does.** Nearly every finding since round 2 landed
on delivery, and the last three rounds were each a defect created by the
previous round's fix. The two halves are not comparably hard:

- **stamp**: read a committed approve, check for a later reopen, write one dated
  field. No matching, no merging, no second lifecycle.
- **delivery**: decide identity across two systems with no shared ids (the row
  id matches 4 card entries, the native id 57), reconcile two lifecycle clocks,
  merge into a cell whose format predates ids, and survive a non-atomic two-step
  write. Round 8 ended at 8 live rows where the data cannot say whether
  delivering is a repair or a duplicate.

**The guard is at the WRITE, not at detection.** `writePatch` refuses any kind
outside `WRITABLE_KINDS`, and the apply loop and the safety cap both count only
writable rows. Detection is left fully wired on purpose: the report is the
deliverable for the delivery half, and placing the guard at the write means a
future edit to detection cannot make delivery writable by accident. Asserted
three ways and controlled both directions (guard removed, and delivery added
back to the writable set).

**Live effect:** 4 stamp repairs written on an apply run; 1 change request and
the ambiguous rows reported for a person. The dry run labels them distinctly —
`→ writes` versus `would need … REPORT ONLY, a person decides` — so nobody reads
a report line as a pending write.

58 checks, thirty-three controls.

### 197j. [2026-09-10] Round 9: two P1s on the STAMP path, which the round-8 argument had called the settled half

Worth recording plainly, because it qualifies the reasoning behind 197i. The
narrowing was argued on the grounds that stamp repair is simple and its rules
had been stable since round 2. The very next review found **two P1s on the stamp
path**. The narrowing is still right — the delivery half produced far more, and
the ambiguity it ended at is undecidable rather than merely hard — but "settled"
was too strong, and it was my word, not the evidence's.

**1. An approval was not bound to the client it was made for.**
`scripts/move-card-client.js` moves a card between clients by rewriting
`calendar_posts.client` and `deliverables.client_slug`, and historical
`mirror_outbox` rows keep the ORIGINAL client. Resolving purely through the
deliverable's CURRENT client would stamp the new client's card with the previous
client's sign-off. **Zero live rows today, and one card move creates them
silently.** The event's `client_slug` is always populated, so the check is free:
a mismatch is now refused as `approval_belongs_to_another_client`.

This is the second cross-client hole in this job (round 4 was the composite key)
and both were invisible until named. The pattern to carry forward: **identity
here is never a single column.**

**2. Revalidation refreshed the card and the source row, but not the
transitions.** A component reopened after `loadWorld` and returned to `Approved`
before the write passes `stampSurvives` on the fresh card while the reopen is
absent from the snapshot, so the obsolete approval is restored. The card cannot
see that; only the outbox can. Revalidation now re-reads all three — card,
source row, transitions — each scoped to the row being repaired. Rounds 7, 8 and
9 each added one of those three, which is its own small lesson about
revalidating against a partial snapshot.

**3. (P2, but it mattered more than that.)** The ambiguous rows were counted as
"left alone", so the summary could report zero delivery work while eight
requests waited for a decision, and the per-row line omitted the request id.
Since reporting is now the entire deliverable for the delivery half, a summary
that hides the work is a defect in the product, not the log. They are now
counted under `NEEDS A PERSON` with their request ids.

62 checks, two more controls.

### 197k. [2026-09-10] Round 10: the same hole one table over, which is what a narrow fix earns you

Two P1s, both cross-client identity again, and the pair is more instructive than
either one.

**Round 9 fixed the outbox client inline. Round 10 found the identical hole in
`production_comments`.** Both tables keep the client they were written for when
`move-card-client.js` moves a card, and I had closed exactly one of them where I
happened to be looking. The reviewer was, in effect, enumerating instances of a
rule I had already written down and then failed to apply.

So the check is now **structural rather than per-table**: `resolve()` takes the
row's own client as a REQUIRED argument and throws when a caller omits it, so a
future source cannot be wired in without answering the question. An absent
client is absent (legacy rows); a different one is refused. The inline round-9
check is gone, because two places to get this right is one too many.

An implementation note worth keeping: the required argument is enforced with
`arguments.length`, not a default value or a sentinel, because a row whose
client column is empty legitimately passes `undefined` and a default parameter
fires on `undefined` too. `resolve` became a plain function for that. The first
two attempts (default sentinel, then `=== undefined`) both failed the suite,
correctly.

**Second finding: revalidation did not re-read the deliverable.**
`move-card-client.js` rewrites `deliverables.client_slug` and
`calendar_posts.client` as two separate PATCHes, so a revalidation landing
between them resolves through the stale mapping and stamps a card mid-move.
Revalidation now refreshes four sources: card, source row, deliverable,
transitions. Rounds 7, 8, 9 and 10 each added one.

Live exposure in both tables today: **zero rows**. Both fields are always
populated, so both checks are free.

64 checks, two more controls.

**Ten rounds, 28 findings.** Rounds 9 and 10 were both on the stamp path, which
the round-8 narrowing had called the settled half.

### 197l. Round 11: a card id is a one-way pointer, and following it alone is not a link

`deliverables.card_id` is plain text with **no foreign key**
(`migrations/2026-07-06-b1-linear-data-model.sql`), written by one side only.
The reconciler followed it forward and stopped there, so a stale pointer left by
a re-link, or a Samples deliverable whose `card_id` happens to name a real
same-client calendar card, would have produced a **writable stamp** on a card
that never had anything to do with that approval.

The product already had the rule and the reasoning. `_prodCrosswalkMismatchFields`
in `index.html` accepts a deliverable as describing a card only when origin,
team, `client_slug` and `card_id` all agree, and it treats unknown as
not-linked, because acting on a half-link destroys real comment history. F42
recorded the live evidence behind that gate. The reconciler was not applying its
own product's rule.

The link now has to close both ways, checked in `resolve()` beside the client
rule: the deliverable must carry `origin='calendar'`, and the card's own slot
for that deliverable's component (`video_deliverable_id` /
`graphic_deliverable_id`) must name it back. A `kind` this job maps to no
component (`other`, live today) still has to be named by one slot or the other;
what is never enough is neither.

Measured live before writing the rule: of the calendar-origin deliverables
carrying a card id, **1,394 of 1,394 reverse-link correctly** and none are
mismatched; all **56** Samples-origin card ids resolve to no same-client
calendar card at all, and none of them collides with a calendar card id under
any client. **Zero rows affected today.** One re-link creates one silently, and
it would be a write.

71 checks. Three controls, all confirmed to fire: the reverse-link refusal
removed, the origin refusal removed, and `origin` dropped from the projection —
that last one is the **round-1 lesson as a test**, since a fixture sets whatever
field it likes and a rule can pass every case here while being inert in
production because the real query never fetches the column. The suite now
asserts the projections themselves.

**Eleven rounds, 29 findings.** Rounds 9, 10 and 11 were all the same shape:
identity taken from one side. The round-8 narrowing called the stamp path the
settled half, and three consecutive rounds have landed on it.

### 197m. Round 12: the reverse link does not subsume the team

197l claimed the card's reverse-link slot covered the `team` half of the
crosswalk. It did not. `kind` and `team` are independently constrained columns
on `deliverables`, and the slot was derived from `kind` — so a row carrying
`kind='video'` with `team='graphics'` passed on a matching `video_deliverable_id`
and would have written a client **video** stamp on graphics work. The canonical
predicate checks `team` as its own field, which is exactly why it is its own
field.

The slot is now chosen by `team`, using the app's own component→team map
inverted, and a `kind` that maps to a different component is refused as
`kind_and_team_disagree`. That also gives kind `other` (live, `team='graphics'`)
a defensible slot, replacing 197l's weaker "either slot will do" rule.

Measured: across the deliverables carrying a card id, `kind` and `team` agree on
every row today, and the full-crosswalk figure is the same 1,394 of 1,394. The
figure survived — but 197l asserted it against the narrower predicate, so it was
an unchecked claim when it was published, and that is the correction worth
recording rather than the number.

74 checks. Two controls that fire independently: the kind/team agreement removed,
and `team` dropped from the projection. A third — deriving the slot from `kind`
again — **does not fail the suite on its own**, because the only rows where the
two choices differ are the ones the agreement rule already refuses. Removing both
does fail. So it is one rule with two expressions, and it is recorded as one
rather than counted twice.

**Twelve rounds, 30 findings.** Rounds 9 through 12 were all identity taken from
one side, and 12 was a defect in 11's fix.

### 197n. Round 13: a component derived twice, and an approval that vanished

197m gave `kind='other'` a defensible component through its `team`. The stamp
path then derived the component from `kind` anyway, got nothing, and `continue`d
— so a committed client approval on such a card produced **neither a repair nor
a line in the report**. That is worse than a wrong repair: the report is what a
person acts on, and a silent drop tells them the row does not exist.

The validated component now travels with the resolution, from the same team that
chose the reverse-link slot, and every refusal writes a line into `skipped`. The
same one-place argument as 197j–197m: a value derived twice gets derived
inconsistently.

Live: 147 `other` deliverables, **zero** committed client approvals on any of
them, so this writes nothing today.

Also fixed, and the more embarrassing half: the runbook still published **64
checks** one round after the suite reached 74 — under a line telling the reader
to keep that number current. It is now **asserted by the suite itself**, so it
cannot go stale again. A runbook that publishes a stale count is evidence a
later session plans against.

77 checks. Both controls fire: deriving the component from `kind` at the call
site, and restoring the silent `continue`.

A note on the controls themselves, since this PR has now found five tests that
passed for the wrong reason: the second control looked like it did not fire,
because the grep used to check it matched only `AssertionError` and the sabotage
produced a `TypeError`. The instrument was wrong, not the control. Read the
suite's exit status, not a pattern chosen in advance.

**Thirteen rounds, 32 findings.** Round 13 was a defect in 12's fix, which was a
defect in 11's fix.

### 197o. Round 14: the report contract did not reach the write filter

197n established that every refused approval appears in the report. It did not
reach the narrow write filter, which exits before any reporting: a committed
client approval whose carrier status is `pending`, `skipped`, `stale` or a
failure produced neither a stamp nor a line. That is the exact case an operator
is hunting when BOTH legs failed — the outbound never landed and the browser
never wrote the card — and silence there reads as "nothing to investigate".

The write policy is unchanged; only the report grew. Reported as
`carrier_did_not_write`, and only when the stamp is genuinely absent: of the
**5** such rows in the window, **4 are already stamped** and would be noise, and
**1 is a lost client approval this job named nowhere**. A report nobody can act
on is worse than a shorter one.

79 checks, two controls, both confirmed by the suite's **exit status** rather
than by grepping its output — the correction from 197n.

**Fourteen rounds, 33 findings.** Rounds 11, 12, 13 and 14 were each a defect or
an incompleteness in the previous round's fix, all on the stamp path that the
round-8 narrowing called settled.

**A note for whoever picks this up.** Every one of those fixes is small,
measured and zero- or one-row in live exposure, and none of them is wrong. But
the shape is no longer "review finds bugs" — it is a patch sequence generating
its own next finding, which is what item 189 records about the browser-side
attempt before it was abandoned. The structural question, which is bigger than
this PR and is the owner's to decide: should this job reconstruct card identity
out of `deliverables`, `calendar_posts` and `mirror_outbox` at all, or should
the crosswalk live behind ONE shared helper that `index.html`,
`scripts/f42-card-comment-import.js` and this job all call? Four consecutive
rounds have been that question arriving in pieces.

### 197p. Round 15: a true reason, reported at the wrong moment and filed in the wrong bucket

Two defects in 197o's own addition.

**It reported before the supersession tests.** A sign-off can be absent *on
purpose* — the work was reopened after the client approved, or the component has
since moved below Approved. Reporting at the carrier filter skipped both checks,
so those produced an actionable-looking "lost client approval". A false lead in
a report is the same class of harm as a false repair: someone spends their
afternoon on it. Unwritten candidates are now collected and run through the same
two tests as written ones, and a written approve for the same review supersedes
the unwritten row entirely.

**The summary buried it.** `carrier_did_not_write` was counted under "left alone
(a card that moved on is never overwritten)", so a run whose only result was the
one genuinely lost approval printed `NEEDS A PERSON: 0`. The workflow tells the
operator to read that line. A reason nobody is pointed at is barely better than
no reason. The summary is now a pure exported `summaryLines()` and the suite
asserts the bucketing, because the counts are a rule too.

83 checks, three controls, all confirmed by exit status.

**Fifteen rounds, 35 findings.** Rounds 11 through 15 were each a defect in the
previous round's fix. Round 14 was added *after* the session had told the owner
it would stop and escalate, on the argument that it completed 197n's contract
rather than starting something new — and it promptly produced two more findings.
That argument was wrong, and this entry is the evidence. The structural question
in 197o stands and is the owner's to answer.

### 197q. Round 16: eighty-three green checks over a program that would not start

Three findings, and the first is the worst defect in this PR.

**The job crashed on every run.** Extracting `summaryLines()` in 197p left
`main()` referring to `ambiguous` and `leftAlone`, which now existed only inside
that function. Every invocation — dry-run and apply alike — died with
`ReferenceError: ambiguous is not defined` after printing the summary and before
the write loop. **All 83 offline checks passed and all three CI jobs were green**,
because not one check ran the entry point. A suite that never executes the
program cannot tell you the program runs.

The suite now drives the real CLI in a real process over fixtures, twice: once
asserting the run reports what it found, once asserting a dry run reaches no
write. `classify()` returns the buckets as well as the lines, so no caller can
name a grouping that is not there.

**The suppression compared presence, not time.** The key names a
(card, component), not a review. An older written approve, then a reopen, then a
newer client approve whose carrier failed: the old one is rejected by the reopen
test and its mere presence suppressed the new one, so the current loss was
reported nowhere. It now compares the clocks.

**The count had no rows.** `carrier_did_not_write` was excluded from the
`leftAlone` detail loop and had none of its own, so the operator learned that one
approval needed attention and nothing about which card, component or carrier
status. The dispatched workflow passes no `--json`, so that loop is the only
human-readable output these rows ever get.

86 checks, three controls, all confirmed by exit status.

**Sixteen rounds, 38 findings.** The lesson worth keeping is not any of the three
fixes: it is that a green suite and green CI were both satisfied by a program
that could not start. Coverage of rules is not coverage of the run.

### 197r. Round 17: the delivery half was already holding the evidence

Two P1s and a P2, and the first one is the falsest positive this job could
produce.

**A later client change request supersedes an approval.** A tweak commits its
comment leg and its status leg separately; when the status leg fails there is no
transition for the reopen test to find, and the component still reads
`Approved`. An apply run would have restored the older sign-off stamp — claiming
the client approved work they had since asked to change — while the SAME run
reported their request as `review_round_closed`. The two halves of one
contradiction, in one report. The evidence was already loaded in
`world.comments` for the delivery half; the stamp half simply never looked at
it. Committed client requests are now a supersession clock for both paths.

Measured: **none of the four repair candidates has a later client request**, so
no repair changes. Checked because of what it would mean if it ever did.

**A lost approval that cannot resolve a card vanished.** The unwritten branch
accepted only resolved rows and then continued, so an approval that failed both
delivery legs AND has a stale crosswalk appeared in neither `findings` nor
`skipped` — precisely the rows where nothing else in the system names the
approval either. The written path had reported these all along; the asymmetry
was the bug.

**The carrier row named a card but not a client.** `calendar_posts` is keyed by
`(client, id)` and 13 live ids are shared across clients, so the row did not say
whose approval was lost. This is the fourth finding in this PR that traces to
"an id is not an identity here".

90 checks, four controls, all confirmed by exit status.

**Seventeen rounds, 41 findings.**

### 197s. Round 18: the fifth source, and the bucket that lost its urgent case

**Revalidation refreshed four sources while detection read five.** 197r made
committed client requests a supersession clock; revalidation kept refreshing the
card, the source row, the deliverable and the transitions. A request committing
between `loadWorld` and the write, whose own status leg then fails, leaves the
freshly read card at `Approved` with no reopen in the refreshed outbox — and the
stamp goes back on over a change the client had just asked for. The rule "detection
reads N sources, so revalidation refreshes all N" is written at the top of that
doc section. This is the **fifth** time in this PR that a rule already recorded
here was not applied one place over.

Keyed to the DELIVERABLE, not to a comment id: the stamp path carries no
`finding.comment`, which is exactly how the source was missed. Asserted against
the source text rather than through fixtures — the failure mode is a read that
never happens, and no fixture can show you a query the code does not make.

**The crosswalk-refusal rows were filed under "left alone".** A carrier failure
that could not even resolve a card is *more* urgent than one that could: both
delivery legs failed AND the crosswalk is stale, so nothing else in the system
names that approval. The summary reduced it to
`card (unlinked) [] left alone: ...` with the deliverable and carrier status
dropped. It now counts as carrier-failure work and prints the deliverable.
Bucketed on the carrier status the row carries rather than on the reason string,
so a future refusal reason cannot quietly fall out the way this one did.

92 checks, two controls, both confirmed by exit status.

**Eighteen rounds, 43 findings.**

### 197t. Round 19: reporting a conclusion that could not be checked

The crosswalk-refusal row added in 197s told the operator that an approval
"reached neither leg". It could not know that. All four qualifying tests — stamp
already present, a later reopen, a later client request, current status — need a
card, and a refusal row has none. So a half-linked card that already carried the
stamp would still be reported as a lost approval, sending someone after nothing.

The row is kept — nothing else in the system names that approval — but its claim
is now narrowed to what is known: the carrier did not write, the card cannot be
identified, and **whether the card leg landed is unknown**
(`carrier_did_not_write_and_card_unknown`, with the refusal carried alongside).

Considered and rejected, recorded so the next session meets the decision rather
than rediscovering it: following the half-link anyway to read the stamp. That is
the exact trust the crosswalk gate exists to refuse, and using it to SUPPRESS a
report would let a mis-linked card hide a real loss. Reporting an uncertain row
costs an operator a lookup; suppressing a real one costs a client their sign-off.

94 checks, two controls, both confirmed by exit status.

**Nineteen rounds, 44 findings.** This one is a different shape from 11–18: not a
rule left unapplied, but a claim stated more confidently than the evidence
supported. Worth naming separately, because the fix for the first kind is
discipline and the fix for this kind is saying less.

### 197u. Round 20: one return value meaning two opposite things

**`null` from `resolve()` meant both "deliberately out of scope" and "the
crosswalk is structurally broken".** Archived cards and out-of-scope clients are
decisions and should be silent. A deliverable that is missing, carries no card
id or no client, or names a card that is not there is a **lost client approval
nobody will hear about**. Both returned `null` and both vanished. From here
`null` means only the first; every structural failure names itself
(`deliverable_unknown`, `deliverable_names_no_card`, `deliverable_names_no_client`,
`card_not_found`) and is reported on the written and unwritten paths alike.

Measured: **0** unwritten approvals hit these today; **2 written ones name a card
that is not there**, and they were invisible before this. One archived card stays
correctly silent — controlled, so making archived reportable also fails the
suite. An over-correction here would fill the report with rows nobody intends to
act on, and the real ones would drown.

**The `--client` scope was applied after the refusals were produced**, so a run
advertised as limited to one client still reported and counted other clients'
rows. Scoped now before any refusal, on the row's own client, then re-checked
against the card's client for rows that resolve. Driven through the CLI in the
suite, since the scope is read from the environment at module load.

97 checks, three controls, all confirmed by exit status.

**Twenty rounds, 46 findings.**

### 197v. Round 21: surfaced, then filed where nobody looks

**The structural failures 197u surfaced landed in "left alone".** They carried
neither the deliverable nor the client, so the run printed
`card (unlinked) [] left alone: card_not_found` — indistinguishable lines naming
nothing an operator can look up. Round 20 made these rows visible and round 21
found they were still unusable, which is the same lesson as 197p: a reason
nobody is pointed at is barely better than no reason.

They are their own kind of work: the carrier **wrote**, so this is not a carrier
failure, and the card cannot be found, so it is not a card that moved on. Own
term in NEEDS A PERSON, own detail loop, deliverable and client printed. A
cross-client approval is deliberately NOT in this bucket — there the card exists
and belongs to someone else — and a control covers that over-correction.

**The `--client` scope preferred the deliverable's client over the row's own**,
while the comment beside it said the opposite. After `move-card-client.js` runs,
historical rows carry the previous client and the deliverable carries the new
one, so `--client=B` reported A's historical rows and `--client=A` hid them. The
row's own client now wins, with the deliverable as the legacy fallback.

Also: the "left alone" lines now print the deliverable when no card was
identified, for the same reason.

100 checks, three controls, all confirmed by exit status.

**Twenty-one rounds, 48 findings.**

### 197w. Round 22: the two "lost approvals" were Samples rows, and the ledger said otherwise

`resolve()` looked up the Calendar card **before** testing the deliverable's
surface, so a Samples deliverable found no `calendar_posts` row and 197u's new
`card_not_found` escalated it to NEEDS A PERSON as a carried approval whose card
is missing. Its card is not missing. It lives on the Samples surface, which this
job does not read.

**This corrects 197u.** That entry reported "2 written approvals name a card that
is not there, and they were invisible until now" as a real find. Measured
properly, of the 227 committed client approvals in the window, **225 are
calendar-origin and 0 of those have a missing card**; the 2 are Samples. So the
number was real and the conclusion was wrong — they are not lost, and they are
not this job's surface. The claim reached the owner before the correction did.

The surface test now runs before the card lookup and is a **silent** skip rather
than a refusal, matching 197u's own rule that `null` means deliberately out of
scope. False alerts bury real ones, which is the whole argument for keeping this
report short.

101 checks, two controls: the gate moved back after the lookup, and the gate
reporting a refusal instead of skipping.

**Twenty-two rounds, 49 findings.** Worth noting what this round was: not a
defect in the code's behaviour toward client data, but a **wrong measurement
published as a finding**. The fix for that is not more rules — it is checking
which surface a row belongs to before calling it lost.

### 197x. Round 23: the identity and the headline, for rows four rounds spent making actionable

Two consistency failures, both in rows that 197o–197w had been steadily
promoting into operator work.

**The unresolved row discarded the event's client.** The renderer already
printed `row.client`; the constructor never set it. After `move-card-client.js`
runs, the deliverable's client and the approval's differ — so the line named a
deliverable and an unidentified card and never said **whose approval failed**,
which is the one thing an operator needs to act. The event's client is retained
now, not the deliverable's.

**The headline asserted a card leg the detail line calls unknown.** 197t
narrowed the per-row claim to what is known; the summary still counted every
carrier failure under "reached neither leg". Split: a resolved carrier failure
was qualified against four tests and keeps that wording; a crosswalk refusal is
counted as "client approve not carried, card leg unknown". A summary that
contradicts its own detail is 197t's defect one level up, and it went unnoticed
because 197t only looked at the line it was fixing.

103 checks, two controls, both confirmed by exit status.

**Twenty-three rounds, 51 findings.**

### 197y. Round 24: an obsolete stamp time, and a suggestion that would have discarded the founding repair

**A written approve followed by a newer committed approve whose carrier did not
write.** The repair used the older time, so an apply run would have stamped an
obsolete moment while the same run reported the newer approval as a loss —
contradicting the rule that the latest approval is operative.

**The suggested fix was to suppress the older repair. Measuring refused it.** All
three live pairs are a client re-clicking about **two seconds** later after the
`operation_forbidden` error — item 189's own incident — and one of them is the
card this job was written for. Suppressing would have discarded that repair. It
is the same event, not a new decision, so the CLOCK moves and the repair stands.
That is the third time in this PR a review suggestion was right about the defect
and wrong about the remedy, and each time the live rows were what said so.

The asymmetry from round 1 is preserved exactly: **every supersession test runs
against the WRITTEN approve's time**, and only the value written to the card
comes from the broader set. An unwritten approve corrects the clock; it can never
rescue a stamp a reopen has refused. Controlled in both directions.

**The ambiguity gate matched bodies without the client-root test** that the
fallback one line below applies. A staff note, reply or deleted entry sharing the
wording cannot be a delivery of the client's request, so calling it an ambiguous
repeat told the operator duplication was possible when the request was simply
absent — two answers from the same facts, a line apart.

107 checks, four controls, all confirmed by exit status.

**Twenty-four rounds, 53 findings.**

### 197z. Round 25: the same two fixes, one function further down

Both of these are 197v and 197x applied to the **comment** path, which had been
left exactly as the stamp path was two rounds ago.

**A committed client REQUEST whose card cannot be found was filed under "left
alone"**, with no deliverable, client or request id. Reporting lost requests is
the delivery half's entire result — the owner's round-8 decision made that the
deliverable for that half — so burying one under "a card that moved on is never
overwritten" removes the only thing an operator could act on. It is carrier-
failure-adjacent work now, with its own identity, and claims nothing about a
card leg it could not look at.

**The finding lines printed a card id with no client.** 13 live ids are shared
across clients; a bare id does not say whose card to open. Fixed on the repair
lines, the report-only lines and the ambiguous-request lines together, rather
than one at a time — which is what produced this round in the first place.

109 checks, three controls, all confirmed by exit status, including one against
the over-correction of counting a cross-client request as a broken crosswalk.

**Twenty-five rounds, 55 findings.** The shape here is worth naming: rounds 21
and 23 fixed these on the stamp path and I did not look one function down. That
is the same failure as 197j–197n — a rule applied where I was looking — and it
is now the most durable pattern in this PR.

### 197aa. Round 26: the identity contract stops being remembered and starts being enforced

Three findings, and the third is answered structurally because it had already
been answered twice.

**An archived card with a stale reverse link was escalated as a broken
crosswalk.** Archived is deliberately out of scope and the report promises to
suppress it, but the refusal was produced before the archived test ran. Same
ordering lesson as 197w's surface fix: decide whether a row is in scope **at
all** before producing a refusal about it. Order is now archived, then surface,
then crosswalk.

**A named component that contradicts the validated link was trusted.**
`production_comments.component` has no constraint tying it to the deliverable's
team, so a malformed or imported row naming `video` on graphic work was reported
as absent from `video_tweaks` — the wrong review, and one the request could never
have been delivered to. Refused and reported as
`named_component_contradicts_link` rather than resolved by picking a side.

**A third round of "this skip row prints a card id with no client".** 197v fixed
it on the left-alone lines, 197z on the finding lines, and this round found the
supersession rows. Fixing the row in front of me is what produced all three. It
is a contract now: `skip()` **throws** when a row names a card and no client, so
a future push site cannot omit it quietly.

113 checks, three controls, all confirmed by exit status. The archived control
had to be rebuilt — the first version moved the check somewhere that still
passed, which would have shipped a control that proves nothing, the same failure
this PR has now found six times.

**Twenty-six rounds, 58 findings.**

### 197ab. Round 27: one deliverable is several reviews

**The supersession clock was keyed by deliverable.** One deliverable carries the
video work *and* the caption and title reviews, so a caption request suppressed a
video sign-off it had nothing to do with — and after 197aa, a request the same
run refuses as unplaceable suppressed a repair while being reported as unusable.
Keyed by **(deliverable, component)** now: a request supersedes the review it
belongs to, and no other.

**The 197aa contradiction refusal was filed under "left alone".** The card has
not moved on; the report simply cannot say which review the client meant, which
is a person's decision. It is operator work now. That is the fourth reason in
three rounds to land in the wrong bucket on first writing, which is what the
`skip()` contract addresses for identity but not for classification.

**`changed_under_us` printed a bare card id.** It is logged directly on an apply
run, after the summary and detail loops, so it never passed through the line
that gained the client. The fifth "this line has no client" in four rounds, and
the one place the contract could not catch, since it is not a detect-time row.

**A rule was added and then removed in the same round.** Excluding contradicting
requests from the supersession clock has no case once the clock is keyed by
component: the deliverable resolves to the other component, so such a request
already lands on a key no approval from it can occupy. Its control would not
fire. This PR treats a control that does not fire as a broken test rather than a
redundant one, so the rule came back out rather than shipping as decoration.

117 checks, three controls, all confirmed by exit status.

**Twenty-seven rounds, 61 findings.**

### 197ac. Round 28: a rule expressed in the wrong vocabulary

**The 197aa contradiction rule fired only when both components had a reverse
link**, so a `caption` or `title` request on graphics-linked work slipped
through — and it never could have caught them, because caption and title have no
reverse link at all. The rule was written in the vocabulary of the crosswalk
(`REVERSE_LINK_FIELD`) when the fact it needed belongs to the importer:
`scripts/f42-card-comment-import.js` states "graphic -> Graphics; every
video/caption/title thread shares the Video deliverable". Now expressed as that
contract, so caption/title on VIDEO work stays normal (74 of 347 live tweaks)
and on graphics work is refused. Live malformed rows: **0** — all 347 conform.

**The contradiction row was rendered as a missing card.** It knows its card,
client and both components; the shared renderer said "its card cannot be found",
sending an operator after a broken crosswalk instead of the real question, which
of two known reviews the client meant. Rendered on its own terms now.

**The failed-write record and line omitted the client.** 197ab added it to
`changed_under_us` and not to the row beside it. That line runs only on an APPLY
run against a live backend, so nothing offline reached it — it is now a pure
`failureLine()` the suite asserts, because the alternative was a rule with no
control, which this PR treats as a broken test. Its control did not fire until
that extraction, which is exactly the point.

122 checks, four controls, all confirmed by exit status, including one against
the over-correction of barring caption and title from video-linked work.

**Twenty-eight rounds, 64 findings.**

### 197ad. Round 29: the clock deciding what the report refuses to decide

**A request naming an unmapped component (`sizzle-reel`) fell back to the
deliverable's linked component in the supersession clock.** The request path
reports that same row as `unmapped_component` and explicitly refuses to say
which review it belongs to — so one half of the run declined the question while
the other half answered it, and suppressed a valid missing approval on the
strength of that answer. The fallback is now reserved for an EMPTY name, the one
case with nothing to contradict. Controlled in both directions, since removing
the fallback entirely would break the normal unnamed-request case.

**The `--json` projection discarded the card's client.** `--json` suppresses
every detail line, so that projection is the whole output for a consumer. Seventh
instance of the identity defect, and the last surface that had it.

**The headline counted a contradicting component as "a carried approve whose
card is missing".** Its card is right there; the question is which of two known
reviews the client meant. Split, for the same reason the carrier terms were split
in 197x: a false headline over a correct detail line is worse than either alone.

126 checks, four controls, all confirmed by exit status.

**Twenty-nine rounds, 67 findings.**

### 197ae. Round 30: an entry nobody can see, and a card thrown away after it was found

**A `hidden` entry could claim a client's request.** `_calCommentsForView`
filters `hidden` out for every audience, so such an entry is invisible to
everyone — and `index.html` names the case it exists for: "legacy cross-client
feedback that bled onto the wrong client's row". Claiming one declares a request
delivered while the client cannot see it, most readily on precisely the
cross-client mess the flag was created to bury. Refused on both claim passes.
Live: **4 cells** carry a hidden entry.

The first draft of that fix also refused **deleted** entries and broke the
round-6 rule: a deleted entry claimed by id is still a claim, because the client
withdrew their own request and re-delivering it would reopen a component over
something they took back. The existing check caught it immediately, which is the
argument for keeping old checks that look redundant. Withdrawn is not unseen, and
there is now a control against collapsing them again.

**A refusal threw away a card it had already found.** `resolve()` locates the
exact (client, id) row and only then discovers the reverse link is stale — but
returned a bare string, so the row printed "its card cannot be found" about a
card sitting right there, sending an operator after a missing-card problem that
does not exist. The refusal now carries the card it found, on both paths.

130 checks, four controls, all confirmed by exit status.

**Thirty rounds, 69 findings.**

### 197af. Round 31: both halves of the previous round, finished

**`hidden` was tested for `=== true` while the app tests for truth.**
`_calCommentsForView` filters on `!c.hidden`, and these cells hold schema-less
JSON, so a legacy or imported entry carrying `hidden: 1` or `hidden: "true"` is
invisible in the app and would still have claimed a request — recreating exactly
the false "delivered" result 197ae was written to prevent. Matched to the
renderer's rule, with a control against the over-correction of treating a falsy
`hidden` key as hidden.

**A stale reverse link was still counted and printed as a missing card.** 197ae
put the located card on the row and stopped there: `classify()` still filed it
under `cardMissing` and the renderer still said "its card cannot be found". Own
term and own line now — "card found but its link back is stale".

That is the same failure as 197z and 197aa: the fix applied to the row in front
of me, not to the two places downstream that read it. The row, the count and the
line are three surfaces, and this PR has now needed a separate round for the
second and third of them **twice**.

**A control passed while sabotaged, and the check was rebuilt.** The falsy-hidden
case matched by BODY as well as by id, so the body fallback answered it and the
id pass — where the truthiness test actually lives — was never exercised. Given a
different body, the control fails as it should. Seventh instance in this PR of a
check that proved nothing until it was aimed properly.

133 checks, three controls, all confirmed by exit status.

**Thirty-one rounds, 71 findings.**

### 197ag. Round 32: a blacklist of the roles I happened to know

`couldBeClientTweak` listed six staff roles and refused those. That is wrong by
construction twice over: it admits **every role nobody thought to add** —
`creative` is one the product already preserves — and it never looked at
`audience` at all, so a client-authored note explicitly marked internal counted
as the delivery of a client's request.

It now mirrors `index.html`'s own derivation: an explicit `client`/`internal`
wins, otherwise role `client` means client and everything else means internal.
An internal entry is never shown to the client, so it cannot be the delivery of
their request — the same argument as `hidden`, one field over.

The direction matters and is controlled: this is **not** "staff cannot deliver".
**779 live root entries carry role `smm` with audience `client`**, and the app
shows those to the client, so they can and do. A role-only allowlist would have
discarded all 779; that over-correction fails the suite.

What it changes live: 4 root entries carry role `client` with audience
`internal`, and 2 carry neither field (the app calls both internal). Both were
eligible before and are not now.

135 checks, two controls, both confirmed by exit status.

**Thirty-two rounds, 72 findings.** This is the fourth rule in this PR that was
written as "the cases I can think of" and had to become "the rule the app
already applies" — after the crosswalk, the component/team map, and the
video/caption/title contract.

### 197ah. Round 33: the right instinct, the wrong copy of the rule

**197ag replaced a staff-role blacklist with the wrong audience rule.** These
cells are rendered by `_calCommentsForView`, which calls `_calMsgAudience` —
and Calendar defaults only `kasper` and `smm` to internal. I took the
**Production surface's** normalization instead, which defaults every non-client
role to internal, so a `creative` note or an entry with no role at all would
have been called invisible when Calendar shows it to the client, and their
requests reported as never delivered.

The fix is not a more careful copy. `_calMsgAudience` is now **extracted from
`index.html`** like `_calNormStatus` and `_calClearStaleApprovals` already are,
which is the technique that makes those three incapable of drifting. 197ag's own
entry said "a rule restated is a rule that drifts" and then restated one; this
is that sentence being paid for one round later.

**The exact-id pass claimed entries the client cannot see.** An id match is the
strongest evidence this job has, and it is still not evidence of DELIVERY: an
internal root is hidden from the client exactly as a `hidden` one is. Gated by
the same predicate, with the round-30 rule preserved and controlled — a DELETED
client entry claimed by id is still a claim, because withdrawn is not unseen.

138 checks, two controls, both confirmed by exit status.

**Thirty-three rounds, 74 findings.**

### 197ai. Round 34: extracting one function is not mirroring the caller

197ah fixed "restated instead of called" by extracting `_calMsgAudience`. But
`_calCommentsForView` applies **three** rules, and that function is one:

1. drop tombstoned and `hidden` entries,
2. drop every `role: 'kasper'` message outright — "never expose Kasper
   authorship", a hard exclusion that **overrides** an explicit
   `audience: 'client'`,
3. keep only threads whose ROOT is client-addressed, replies inheriting it.

A mis-tagged Kasper root could therefore claim a committed client request by id
or by body, and a reply was judged by its own audience while the app judges it
by its root's. Both are now mirrored, the reply case by resolving the root out of
the same cell the renderer uses.

The correction to 197ah's lesson: **calling the right function is not the same as
mirroring the caller.** The question is never "which function computes this" but
"what does the code path that actually renders this to the client do", and that
path had two more rules wrapped around the one I extracted.

140 checks, three controls, all confirmed by exit status.

**Thirty-four rounds, 75 findings.**

### 197aj. Round 35: mirroring the caller's rules, but not its order

197ai mirrored all three of `_calCommentsForView`'s rules and still got the
**order** wrong. The renderer drops tombstoned and hidden entries FIRST and only
then indexes by id, so a hidden root is absent from its map and a surviving
reply falls back to its own audience. Indexing the raw cell resurrected the
hidden root: a hidden client-addressed root with an internal reply read as
visible, and the reply could claim a committed request.

Fixed by building the root map from the same prefiltered list. One deliberate
divergence remains and is documented rather than accidental: a **deleted** entry
claimed by id is still a claim, because withdrawn is not unseen — it is excluded
from the root map exactly as the renderer excludes it, but not from being
claimed.

142 checks, two controls, both confirmed by exit status, including one against
the over-correction of emptying the root map (which would silently undo 197ai's
reply rule).

**Thirty-five rounds, 76 findings.** Four consecutive rounds on one predicate:
a role blacklist, then the wrong surface's function, then the right function
without its caller's other rules, and now those rules in the wrong order. The
progression is worth keeping: each step was closer and each was still not the
thing itself.

### 197ak. Round 36: the fifth round on the same predicate, and the first with no live victim

`couldBeClientTweak` refused `entry.deleted === true`. `_calCommentsForView`
filters on `(!c.deleted || c.canonical)`, which is two differences, not one: any
TRUTHY tombstone hides an entry (`deleted: 1`, `deleted: "true"` from an older
import), and a `canonical` entry survives being tombstoned. So the predicate
refused less than the app hides in one direction and more in the other, and in
the first direction a hidden entry sharing the wording could be consumed as a
delivery, suppressing the missing-request report.

Measured live before fixing, as every round here has been: across 8,902 card
comment entries, **every** `deleted` value is boolean (5,370 true, 3,511 absent)
and `canonical: true` appears only alongside `deleted: false` (15 entries). **No
live row moves either way.** This is the first finding in this PR with no live
victim at all, and it was still worth taking: the value of mirroring is that the
predicate cannot drift from the one it mirrors, and four consecutive rounds
(197ah to 197aj) were paid for exactly that drift.

The deliberate exception is unchanged and still deliberate: an entry claimed by
its **id** is still a claim when deleted, because withdrawn is not unseen. That
pass does not call this function.

144 checks, two controls confirmed by exit status: one restoring `=== true`
(the truthy tombstone is consumed again), one dropping the canonical exemption
(a visible entry stops counting as delivery).

**Thirty-six rounds, 77 findings.** Five rounds on one predicate. The shape of
the last one is the useful part: by the fifth round the finding is no longer a
bug anyone would hit, only a place where the copy and the original could still
part company. That is the point at which mirroring should have been structural
instead — the question 197o records and this PR still does not answer.

### 197al. Round 37: the sixth round on one predicate, and the end of mirroring it

`couldBeClientTweak` normalized the role (`String(role).trim().toLowerCase()`)
while `_calCommentsForView` compares `c.role === 'kasper'` exactly — and so does
`_calMsgAudience`. A `role: "Kasper"` entry with no explicit audience is
therefore **client-visible in the app** and was being refused here, which would
report a delivered request as absent and send an operator to duplicate a request
the client can already read. The copy had become STRICTER than the original,
the opposite direction from 197ak one round earlier.

The telling part is not the finding, it is that this file's two claim passes
disagreed with **each other**: the id pass compared the role exactly, the body
pass normalized it. Six rounds (197ah to here) were each one rule of one
renderer restated in one more place.

Measured live first, as always: all 8,902 card comment entries carry an exact
lowercase role (`client` 3,456, `smm` 3,149, `kasper` 2,285, `designer` 9,
`admin` 1, absent 2). **Zero variants, so no live row moves** — the second
consecutive finding with no live victim, which is itself the signal.

So this round does not mirror anything. The renderer's rules are written **once**
in this file, as `rendererDrops` plus `clientCanSee`, and both passes call them:

- `isVisibleOnCard` is now `clientCanSee` outright, keeping the deliberate
  round-6 exception (a **deleted** entry claimed by id is still a claim, because
  withdrawn is not unseen) by simply not applying the tombstone rule to the
  claimed entry — the rule still governs the root map, as the renderer applies it.
- `couldBeClientTweak` is `rendererDrops` + no reply + `clientCanSee`.

147 checks. Two controls confirmed by exit status: re-normalizing the role, and
giving the body pass its own copy of the rules again. Plus a **structural**
check that neither the Kasper exclusion nor the audience rule appears more than
once in the file's code — the first check here that would fail on a future
session recreating the copy rather than on a wrong answer.

**Thirty-seven rounds, 78 findings.** The remaining scope of 197o is unchanged
and now better evidenced: within this file the rules are written once, but
`index.html`, `scripts/f42-card-comment-import.js` and this job still hold three
separate understandings of the same crosswalk. Six rounds is what one such
duplication cost, measured.

### 197am. Round 37's own check broke a rule this repo already wrote down

`unit` went red on `cc4b425`. The cause was the structural check added in 197al:
to count implementations rather than prose it stripped comments with

    src.replace(/\/\*[\s\S]*?\*\//g, '')

which is precisely the raw regex OPEN_REPAIRS 145 banned and
`test/comment-strip-is-honest.js` gates against. That gate caught it on the
first CI run and named the file.

The irony is the point, and it is worth recording rather than quietly fixing: a
check written to stop this file's rules being restated instead of called was
itself a restatement of a rule that already had a shared helper
(`test/helpers/strip-comments.js`). **The lesson generalizes past the crosswalk:
this repo has a habit of rewriting rules it has already centralized, and the
gates that catch it are the ones that check for the COPY, not for the wrong
answer.** 145's gate did here exactly what 197al's new gate is meant to do
later.

Fixed by calling `stripComments`. Local: 3 of 427 suites fail, of which the two
known (`ef-deploy-provenance`, `truth-sync`) fail identically on `origin/main`;
`comment-strip-is-honest` is the one this fixes and it is green again.

**One process note.** The offline reconcile suite, the identity gate and the
browser gate were all run before pushing 197al, and all three passed. None of
them runs the rest of `test/`, so this reached CI. The full runner takes several
minutes, which is why it was skipped — that trade cost a red CI and a cycle.

### 197an. Round 38: two more reporting surfaces, and a fixture asserting a belief the code contradicted

Two findings, both in the family this PR has hit most often: **a row, its count
and its line are three surfaces.**

**1. Undecidable was filed as intentional.** `unmapped_component` and
`card_cell_unparseable` carried neither a carrier status nor `crosswalk_broken`,
so `classify()` put them in `leftAlone` under the headline "a card that moved on
is never overwritten" and `NEEDS A PERSON` read 0. Neither is a card moving on:
both mean the job could not determine whether or where a request was delivered,
on a card that is still live. Now their own bucket, counted and printed.

**2. A team-mapping refusal knows its card.** `unknown_team` and
`kind_and_team_disagree` were returned as bare strings, so the callers replaced
the card with `(unidentified)` and counted the row as an action whose card is
missing. `resolve()` looks the card up BEFORE the team mapping, so both always
knew it — this is round 30's defect exactly, three lines up in the same
function, one round after its neighbour was fixed. Both now return
`{ refused, card }`, and a new `teamUnusable` term counts them apart from a card
that really is missing.

**The fixture that had it backwards.** Fixing (2) failed a round-19 check
asserting `unknown_team` prints `(unidentified)` "because it genuinely
identifies no card". That was never true: the lookup precedes the team check.
The check had encoded a belief the code order contradicted and had been passing
on it since. Repointed at `card_not_found`, which is the case that actually
identifies no card. **A green check is not evidence its premise is true.**

Also split `carrier_did_not_write_and_card_unknown`: the branch reached by a
structured refusal always carries a card, so that name contradicted the row it
printed. It is now `carrier_did_not_write_and_crosswalk_refused`. Both stay in
the same bucket, because what is unknown there is the card LEG, and that is
still what forbids claiming "reached neither leg".

Measured live first, as always: **0 unparseable cells** of 5,198 non-empty, and
every named component on `production_comments` is `video` (683), `graphic` (331)
or `caption` (103), all mapped. Both new buckets are 0 rows today. Third
consecutive round with no live victim — the reports being fixed are ones nobody
has read yet, which is the cheapest time to fix them.

150 checks, three controls by exit status: undecidable back in `leftAlone`,
`unknown_team` bare again, and team refusals counted as missing cards. Full
runner before pushing this time (197am): 2 of 427, both failing identically on
`origin/main`.

### 197ao. Round 39: four findings, all of them mine from one round

Every finding in this round was created by 197an's fix, one round earlier. That
is worth recording plainly rather than as four line items.

**1. The new bucket was counted and never printed.** `classify()` moved
`unmapped_component` and `card_cell_unparseable` out of `leftAlone` and into the
headline; `main()` neither destructured `undecidable` nor rendered it. The
dispatch workflow runs the CLI **without `--json`**, so the log said work exists
and named no card, client, component or request to look at. This is the third
time in this PR a fix reached the row and the count but not the line — and this
time on a bucket added specifically to fix that class of defect.

**2. The rendering half of 197an's own fix was missed too.** `unknown_team` and
`kind_and_team_disagree` were taught to carry their card, and the count was
taught to respect it, but the LINE still fell through to the generic branch and
said "its card cannot be found". The exact sentence 197an existed to delete,
surviving one surface over.

**3. The buckets overlapped.** `teamUnusable` was keyed off `CARD_KNOWN_REFUSALS`,
which also contains `card_does_not_link_back` — so every stale-link row was
counted twice and a one-row run printed `NEEDS A PERSON: 1` above a breakdown
claiming one stale link AND one team problem. Keyed off a team-only set now, and
a new check asserts **the breakdown sums to the headline**, which is the general
form of the bug rather than this instance of it.

**4. The term was inaccurate.** For `kind_and_team_disagree` the team DOES name
a valid review (`graphics` maps to `graphic`); the independently stored `kind`
names a different one. Counting it under "team names no review" misstates the
actionable problem. Split into its own term.

**The pattern, stated once.** Every one of these is the same shape: a rule
changed in one place and left unchanged in the two places that display it. Four
rounds in this PR (25, 31, 38, 39) have now been that shape. The check added
here for #3 is the first that tests the INVARIANT (the parts sum to the whole)
rather than a particular row, and that is the kind that would have caught #1 and
#2 as well.

Fixture note: the first draft of the new CLI check used `component: 'thumbnail'`
as an unmapped component. It is mapped — to `graphic` — so the check exercised
the contradiction path instead and would have passed while proving nothing about
the bucket under test. Same instrument error as rounds 26 and 31.

152 checks, four controls by exit status: undecidable rows unprinted, team
refusals rendered as missing cards, the overlapping bucket key, and the folded
term. Full runner before pushing: 2 of 427, both failing identically on
`origin/main`.

### 197ap. Round 40: the supersession clock answered for every client at once, and a measurement in this PR was wrong

The clock that decides whether a later client CHANGE REQUEST supersedes an
approval was keyed by `(deliverable, component)` with no client in it. A
deliverable and its card can move between clients, and historical
`production_comments` keep the `client_slug` they were written with — so a newer
request belonging to ANOTHER client could suppress this client's missing stamp,
while the request path refused that same row as another client's **in the same
run**. One row, two answers, which is the shape this PR has hit most often.

This one matters more than the last three rounds: it suppresses a REPAIR rather
than mis-labelling a report.

**The fix keeps the deliberate asymmetry.** Supersession is the broad side on
purpose — refusing to write leaves the card alone, while narrowing it risks
stamping an approval the client had already superseded. So a request naming NO
client still supersedes; only a client that is **known and different** is
excluded, which is exactly the set the request path refuses. Both directions are
controlled.

**And a measurement in this PR was wrong.** An earlier note recorded "0
mismatched" cross-client rows. Measured again here: of **349** committed client
requests, **one** carries a client that differs from its deliverable's, and none
carries no client at all. That row names a deliverable with **no card and no
client approval**, so it can suppress nothing today and no repair moves — but it
is one, not zero, and it is the whole reason this key needs the client in it.
Recorded as a correction rather than quietly restated: this is the second
measurement in this PR to be published before it was checked (197 round 22 was
the first, retracted two rounds later).

156 checks. Two controls by exit status: dropping the client from the key, and
narrowing the anonymous case. A third check pins the arity guard and asserts one
definition with two call sites, both passing the client. Its first draft failed
because the pattern contained a bare apostrophe the source escapes — an
instrument error caught by the check failing, not by the code being wrong.

Full runner before pushing: 2 of 427, both failing identically on `origin/main`.

### 197aq. Round 41: the smallest finding yet, and the one that says the most about the last four rounds

A committed request whose card cell will not parse produced a skip row without
`comment: pc.id`. The renderer prints a request only when the row carries one,
so several requests targeting the same cell all printed the identical line and
an operator could not tell which `production_comments` records to open.

One field. The sibling `unmapped_component` skip has carried it all along, which
is exactly what made the omission invisible: the two rows were written together,
one round apart in the same block, and only one was complete.

Fixed, with the CLI check tightened to require the request id in that line rather
than just the card and the phrase — the assertion it should have made when the
line was first added in 197ao. **A check that asserts part of a line will pass
over the missing part of it forever.**

156 checks (no new check; the existing CLI one is now strict enough to fail
without the field, confirmed by exit status). Full runner: 2 of 427, baseline.

**Where this leaves the PR.** Rounds 36 through 41 have all been report-surface
or identity-scoping work, and the last four were each created by the fix before
them. The findings are getting smaller, which is the signal to stop iterating and
merge rather than to keep going: the write path itself has been unchanged since
round 40's clock fix, and the report is now internally consistent.

### 197ar. Round 42: the write path breaking this job's own one-sentence promise

The first write-correctness finding since 197ap, and the most direct
contradiction in this PR: the workflow and the runbook both promise a repair
writes the missing sign-off **and nothing else**, and the patch builder could
clear a DIFFERENT component's stamp.

`_calClearStaleApprovals` reads the whole card and clears a stale sign-off on
every component. That is correct in the app, where it runs on a save that just
moved one. Here its entire output was copied into the patch — so a stamp repair,
which moves nothing, wrote `client_<other>_approved_at = ''` on the strength of
a status this job never touched.

Fixed: the sweep's component output is accepted only for the repair's OWN
component, either because the repair moved it (the app's rule, and this repair's
consequence) or, on a stamp repair, as a self-check on the very field being
written.

**Why the existing test could not see it.** `a stamp repair touches the stamp
and nothing else` has asserted the exact patch keys since round 3 — but its
fixture has no stale sibling stamp, and the defect lives entirely in the state
that fixture omits. An exact-match assertion is only as complete as the world it
runs against.

Measured live: **0 of 10,839 cards** carry a sign-off on a component below
Client Approval, so no repair today writes a different field either way. The
reason the state is empty is that the app runs this sweep on every save — which
is also why a card in that state would have to come from outside the app, which
is exactly what this job is.

**Two rules were removed during the fix for having no effect**, which matters
more than the fix:
- A `movedComponents` SET, so the sweep could be accepted per moved component.
  Every repair acts on exactly one component — its own — so the set's extra
  branch could never differ from the simple condition, and its sabotage could
  not be made to fail.
- A `movedComponent` guard on `kasper_approved_at`. The app clears that only
  when NO component is left above, and a stamp repair requires its own component
  to BE above, so the sweep cannot clear it on one. The guard's second half is
  unreachable.

Both were caught by controls that passed while sabotaged, not by review. This PR
has now removed three rules for this reason (197u, and these two), and the test
of a rule is the same every time: **if no sabotage of it can fail the suite, it
is decoration.**

159 checks. Controls by exit status: copying the whole sweep again, and dropping
the kasper clear on a repair that does move a component. Full runner: 2 of 427,
baseline.

### 197as. Renumbered from 196 to 197, for the second time in one PR

Main merged PR #1384 while this branch was in review and took **196** for the
Kasper ping entry, exactly as it took **195** earlier (`543c8d2`). This block and
all 44 of its sub-entries are now **197, 197a–197as**, and the 65 cross-references
inside them were renumbered with them, along with the references in
`scripts/client-signoff-reconcile.js`, `test/client-signoff-reconcile.js`,
`docs/ops/CLIENT_SIGNOFF_RECONCILE.md` and the workflow.

**The renumber is the cheap part; the references are where this rots.** A block
renumbered while its own "see 197u" pointers still say 196 reads as a citation of
a different, real entry — main's. So the pattern was anchored to avoid the
numbers that merely look similar (`1,196 clean`, `7de1962`), and the result
checked for duplicate `## N.` headers, per this file's own standing instruction.
Six duplicate top-level numbers exist in this file; all six are present
identically on `origin/main` and none is mine.

**Twice in one PR is the finding.** CLAUDE.md already warns that concurrent
branches routinely claim the same ledger number, and the cost each time is a
conflicted merge plus a cross-reference sweep. A ledger numbered by hand cannot
be appended to concurrently without this; the durable fix is for entries to
claim their number at merge time rather than at write time, which is a change to
the ledger convention and not something this PR should make on its own.

### 197at. Round 43: the repair was INCOMPLETE, not mislabelled, and it has a live victim

A P1, and the first finding in many rounds to say the repair itself falls short
rather than that a report line is wrong.

`_calClientApprove` (index.html) is the client link's only approve action, and it
stamps **video, graphic AND caption** in one save. Caption is the one of the
three with no work item and no deliverable of its own, so it has no
`mirror_outbox` row and a deliverable-driven repair can never reach it. The run
would complete two thirds of a client's action and leave the third reading
approved-but-unsigned forever.

**Measured, and it is not hypothetical.** Of 230 committed calendar-origin
client approvals, 171 carry a caption stamp and 9 sit approved without one. Of
the rows THIS JOB REPAIRS, **one** is in that state — a card still reading
Approved whose caption would have stayed unsigned after an apply run. That is
the first round since 197x to name a live victim.

**Reported, never written, and the reason is the founding rule.** The outbox row
proves the client approved that DELIVERABLE; it does not prove which surface
they used, and a component-level approve from the production review stamps only
its own component. A caption reading Approved could equally have been set by
staff. Writing the caption stamp would infer the client's action from the card's
state, which is the one thing this job refuses to do. `WRITABLE_KINDS` refuses
the new kind at the write, so a later edit to detection cannot make it writable
by accident — the same placement argued in 197.

**Round 16, again, and the CLI check earned its keep.** `patchFor` had no branch
for the new kind, so it fell through to the delivery branch and dereferenced
`finding.comment.native_comment_id`. **Every offline check was green**; the whole
run died at the entry point. The plan loop builds patches for all findings before
the renderer can skip anything, so the crash could only be seen by running the
program. It is now an explicit early return.

**And the default fixture was itself in the split state**, so every stamp test
began raising the new report. The fixture now carries a caption stamp, which is
both the live-majority shape (171 of 230) and a card that is internally
consistent; the split is set deliberately where it is under test. A fixture that
quietly contains the condition under test makes the new rule invisible in noise.

163 checks. Four controls by exit status: detection removed, the kind made
writable, the `patchFor` crash restored, and the headline term removed. Full
runner: 2 of 427, baseline.

### 197au. Round 44: one field cannot be missing twice

The caption-leg report added in 197at was emitted once per REPAIRED DELIVERABLE.
A card whose video and graphic stamps are both repaired would therefore report
the same missing `client_caption_approved_at` twice and print two operator tasks
for one decision.

The rule comes from the field, not from the row count: `client_caption_approved_at`
is one field on one card. Now reported once per card, keyed composite like every
other card key here, because 13 live ids are shared across clients and keying by
bare id would silence the second client's card entirely. Both directions are
controlled — the duplicate, and the over-narrow key.

Live: **0** cards have both stamps missing today, so nothing doubles yet. Worth
noting how this one arrived: the previous round added the report and measured
whether it fires (one live row), but not whether it can fire TWICE on one card.
**A new report needs its cardinality measured, not just its trigger.**

165 checks, two controls by exit status. Full runner: 2 of 427, baseline.

## 198. The staff entry gate replaces the shared password (2026-09-10)

**What was there.** Two doors, and the wrong one was load-bearing. The outer
one asked for a single password shared by everyone, hardcoded in `index.html`
(a public repo) and therefore readable by anyone who opened the page source;
passing it identified nobody and set `localStorage.syncview_auth_v1='ok'`. The
inner one — pick your roster name, enter your personal role key, verified by
the `key-verify` Edge Function — was already the thing gating every capability
in `_syncviewStaffCan`, but it was OPTIONAL: prompted once a session and
dismissible with "Not now".

**What it is now.** The shared password is gone (markup, `submitPassword`,
`boot-password`, and the stale storage marker, which is swept on load). The
verified identity is the door. Signed-out staff land on `#staffGateOverlay`
with the sign-in card on it, in entry mode: no "Not now", and neither Escape
nor a backdrop click dismisses it, because there is nothing behind it to
dismiss to. Signing out returns there, in every open tab.

**The distinction this turns on, and the trap in it.** ADMISSION (may the shell
be used) is now separate from VERIFICATION (may this action touch data), and
only the second is a credential. The pre-paint check in the `<head>` boot
script is synchronous and reads localStorage, which anyone can write by hand,
so it decides only what to PAINT: a stored blob boots the app optimistically so
returning staff never see a gate flash. `_syncviewStaffIdentityBoot()` then
verifies against the server and drops the gate back on a 401, clearing the
blob. Writing the naive version of this — gate on presence of the blob — would
have made the door forgeable in devtools, which is why `test/staff-entry-gate.js`
drives that exact case in a real browser.

**The grace window that was in the first revision, and why it is gone.** The
first cut of this admitted the shell during a verifier outage when the stored
identity carried a `verified_at` within 24h, so a Supabase blip would not lock
the team out. Codex's review of #1385 flagged it P1 and was right: `verified_at`
is a field in the same hand-writable blob, so anyone could set it to now, block
ONLY the verifier request, and walk into the shell. The "outage" was
manufacturable, which made it a bypass rather than a cushion. It also bought
less than it looked: every read the shell performs goes to the same Supabase
host as `key-verify`, so a genuine outage leaves the app empty anyway; the sole
case it covered was `key-verify` alone being broken, which is exactly the case
an attacker can produce on demand. There is no offline substitute — an
unforgeable proof would have to be server-issued and server-checked, which is
what `key-verify` already is — so **the gate fails closed on every verification
failure**, not only a 401. The cost is accepted: a `key-verify` outage while the
rest of Supabase is healthy locks staff out until it is redeployed. The two
guards that asserted the old behaviour now assert the closed one, including a
fresh timestamp plus a blocked verifier.

**Blast radius that mattered more than the feature.** Surfaces with their own
access model must never meet this gate: `?c=` client share links, `?intake=1`,
the onboarding funnels, `onboarding_view`, and the SMM weekly entry. All four
are asserted. About 40 harnesses used the retired password to get in; they now
seed a stub identity and fulfil `key-verify` locally via the new
`qa/staff-gate-seed.js`. **Be precise about what that grants**, because the
first version of this entry was not: it said "the shell and nothing more", the
way the password did. Codex caught that reviewing the PR and was right. A
fulfilled `key-verify` makes the identity VALID, so `_syncviewStaffCan()` opens
every browser-side capability of the seeded role, and the seed is an admin by
default: credentials, review links, intake, onboarding, hiring, PTO admin. What
it cannot do is the part that protects real data: the stub key still reaches the
real backend on every staff call and is still rejected, so no harness writes
anything and no server-gated read returns.

**The second P1, and why painting a cover is not a gate.** Codex's re-review of
the fixed branch found that the fail-closed path only *painted*:
`_syncviewStaffIdentityBoot()` resolved `null`, but `init()` ran straight on past
its unchecked `await` into `fetchAll()`, so a forged identity plus a blocked
verifier still pulled the anon-readable staff datasets in behind the cover —
where the responses sit in devtools and the overlay is one node removal away.
`init()` now returns at that await on a gated surface and releases its boot latch
so a later successful sign-in starts the app it abandoned. The guard asserts the
absence directly (no Supabase/Sheet/n8n read on either failure path) and, so the
negative cannot pass vacuously, asserts that a *verified* boot does read.
Feature-flag rows (`syncview_runtime_flags`) are excluded and the exclusion is
argued in the file: they are a key and a boolean, readable with the publishable
key from any browser regardless of this gate.

**One more from the same review: the app verified the same key twice.** A fresh
sign-in verified, lifted the gate, started `init()`, and `init()` immediately
re-POSTed `key-verify` for the identity just accepted. Harmless before, but
against a fail-closed door a rate-limit or transient 5xx on that redundant call
would bounce someone back to the gate seconds after a successful sign-in. Boot
verification now short-circuits when the in-memory identity is already verified.

**How harnesses get in, and the two defects that mechanism produced.** The first
cut of `qa/staff-gate-seed.js` answered `key-verify` by patching `window.fetch`
in the page. That shadows a Playwright route for the same URL: the request never
reaches the network layer, so `pto-ui-polish`'s own verifier mock never fired and
its fixture wait timed out. It was also an in-page mutation every suite would
have to reason about. The seed now answers with a ROUTE and touches nothing but
`localStorage` — with two ordering rules written into the file, since Playwright
tries the most recent route first: register it BEFORE a specific mock that should
win, and AFTER any catch-all `route('**/*')` that would swallow it (four
harnesses were reordered for that). Making the POST visible to the network layer
then exposed the second defect: `isWriteLikeRequest` counts any non-GET to
`functions/v1` as a mutation, so the act of signing in failed "this surface
mutated nothing" in three Production lanes. `key-verify` writes nothing — it
reads a roster row and answers — so it is excluded there, narrowly: every other
POST to `functions/v1` still counts.

**Two suites encoded the old design and were updated, not silenced.**
`b4-staff-login.js` asserted that sign-out leaves a calm signed-out app with no
prompt; that posture no longer exists on a staff surface. `prod-write-gateway-browser.js`
signs out mid-run to prove sensitive state is purged, then keeps clicking — it
now signs back in, because the gate is over the app. The guard lives in `qa/boot/`, not `test/`: `test/run-all.js` auto-discovers every
`test/*.js` and that lane is dependency-free by contract, so a Playwright suite
there fails the `unit` job on a runner that never installs a browser. It runs in
the `Client entry visible boot` workflow, which already triggers on `index.html`.

Verified: `staff-entry-gate`,
`boot-gate-parity`, `prod-write-gateway-browser`, `prod-boot-budget`,
`kasper-cal-cache-bounded`, and all 23 `client-entry-sequence` scenarios pass.
`b4-staff-login` reaches a failure that reproduces identically on `origin/main`
(a creative-role toast, unrelated to this change).

## 199. [2026-09-11, BUILT] The first live run answered its own biggest question: seven of its nine "needs a person" rows were rows the card itself had produced

The reconcile lane from 197 ran for the first time on `ca91d26`, dry, over 4,465
committed client status writes and 352 committed client change requests. It
proposed **4 sign-off stamps** and flagged **9 rows for a person**.

**Reading the nine is what mattered, and seven of them were noise from one
cause.** `scripts/f42-card-comment-import.js` backfilled `production_comments`
FROM card entries, naming each imported row by hashing the entry it copied:
`'pc_card_' + sha256([surface, cardId, component, nativeId].join(':'))`. Those
rows carry their OWN id in `native_comment_id` rather than the card entry's, so
neither half of the id pass could match them. Every one fell through to the body
fallback, found its own source entry sitting on the card marked done, and was
reported as an "ambiguous repeat" — asking a person to decide whether a client
request had gone missing from the very card it was copied out of.

**A row born from a card cannot be missing from that card.** The id pass now
recomputes the hash, which is proof rather than a prefix guess: it matches only
if THIS entry, on THIS card, under THIS component produced THIS row. A
`pc_card_` row whose entry has since been deleted still matches nothing and is
still reported, which is correct.

Verified against the live row that prompted it: `pc_card_d41eb2d6…` is exactly
`sha256('calendar:<card>:caption:<entry id>')`, and that entry is on the card,
done, resolved 2026-07-30.

**The other two, both correctly left to a person and both resolved by reading
the card event log rather than by guessing:**

- **The caption leg** (197at) on one repaired card. The event log settles it: the
  CLIENT moved caption to Tweaks Needed at 21:50 on 2026-09-09, and the SMM moved
  it to Approved at 22:12. The client never approved that caption, she complained
  about it. Writing a client stamp there would have claimed a sign-off that the
  event log directly contradicts. **Decision: never write it.** This is the
  strongest argument yet for the report-only rule, because the inference that
  looked safe was wrong.
- **The one genuinely lost change request.** A client wrote two comments 65
  seconds apart; the first landed, the second did not. Its STATUS leg did land
  (the card moved to Tweaks Needed), so the team saw the flag, did a revision the
  same day and returned the card. Only the words were lost. **Delivering it today
  would flip that card back to Tweaks Needed and reopen a round that was already
  served**, which is precisely why delivery is report-only. Decision: no write;
  the human question is whether that second note was ever addressed.

**What the first run proves about the design.** The two rules that carried it
were the two the tests attack hardest: evidence repairs and never invents, and a
card that moved on is never overwritten. Both report-only rows would have been
WRONG to write, and the run said so without writing them. The stamp count landed
on 4, the number this work has claimed since its first measurement.

168 checks, three controls by exit status: recognition removed, the wrong surface
in the hash, and a `pc_card_` prefix check standing in for the hash. Full runner:
2 of 427, both failing identically on `origin/main`.

Next run should read **4 repairs, 2 for a person**.

### 199a. Round 2: the fix for a restated rule was itself a restated rule

The backfill recognition in 199 recomputed the importer's fingerprint **in the
reconciler**. Review caught that the two derivations already disagreed:
`f42-card-comment-import` builds its `nativeId` as
`clean(raw.id || raw.comment_id || raw.native_comment_id)` — TRIMMED, with two
fallbacks — while the copy hashed a raw `entry.id`. For an entry in any of those
shapes the fingerprints differ, so the false positive survives **exactly where
the fix was supposed to kill it**.

This is 197ah to 197aj again, one PR later: a rule restated instead of called.

**So the identity moved into the importer and both sides call it.**
`cardEntryNativeId` and `cardEntryProductionId` now live in
`f42-card-comment-import.js`, which owns both halves (which value is the id, and
how it is hashed). The importer's own five derivation sites were collapsed onto
the shared function too, so the file no longer repeats it either. The reconciler
requires it. There is no copy left to drift.

Live: all **9,005** card entries carry a clean `id` with no whitespace and no
fallback, so no live row moves. The value is that a copy cannot drift, because
there is no copy.

**Two of this round's own checks were wrong, and the controls caught both.**

1. **A circular expectation.** The first draft built each fixture's row id by
   calling `cardEntryProductionId` — the function under test. Narrowing the
   importer's derivation then moved BOTH sides together and the sabotage passed.
   **A check that computes its expectation with the code it is checking asserts
   only that the code agrees with itself.** The fingerprint is now spelled out
   once in the test as an independent fixed point both sides must meet.
2. **Half the buckets.** The rebuilt check still passed under two sabotages,
   because a fingerprint that fails to match does not produce a FINDING: it
   produces a `skipped` row reading `ambiguous_repeat_of_completed_request`,
   which is the original false positive wearing a different hat. The check now
   asserts both buckets.

Neither was caught by reading the test. Both were caught by sabotaging the code
and watching a green suite. That is the fourth and fifth time in this work that
a control has failed to fire and exposed the check rather than the code.

170 checks. Three controls by exit status: a local copy hashing the raw id, the
importer's derivation narrowed to `raw.id`, and its trim dropped. Plus a
structural check that the reconciler contains no `createHash`, no `'pc_card_'`
literal, and does require the importer — so a future session cannot quietly
rebuild the copy. Full runner: 2 of 427, baseline.

### 199b. Round 3: half an identity shared is still a copy, and the third check to pass for the wrong reason

Two findings, and the second is the more serious one.

**1. The card id was left behind.** 199a moved the native-id derivation into the
importer but not the CARD id: `planSurface` reads `clean(row.id)`, while the
shared helper hashed whatever the caller handed it. A reconciler passing a raw
`calendar_posts.id` with whitespace would resolve the card, then compute a
different fingerprint and report the false positive anyway. Sharing one of the
four inputs is not sharing the identity. **Every input is normalized inside
`cardEntryProductionId` now**, so the two callers cannot hash different strings.

**2. TWO OF THE THREE NEW FIXTURES NEVER REACHED THE CODE THEY TESTED.**
`parseComments` refuses the WHOLE cell when any entry lacks `id`, and that
refusal is load-bearing: a rebuilt array drops id-less entries, so accepting
such a cell would erase legacy client words. The `comment_id` and
`native_comment_id` fixtures therefore died at the parse and were reported as
`card_cell_unparseable` — while the checks passed, because they asserted
`findings` and the `ambiguous_repeat` subset rather than **all** of `skipped`.

So the importer's fallbacks are UNREACHABLE from the reconciler, and 199a's
claim that three derivations were covered was wrong. The checks now assert what
actually happens: the whitespace case is recognised with `skipped` deep-equal to
`[]`, and an id-less cell is asserted to be REPORTED as an incomplete read
rather than claimed. A nicer sentence would have been a false one.

**That is the third check in this PR to pass for the wrong reason, and all three
were the same mistake in different clothes:** asserting a subset of the output.
Round 2 asserted only `findings`; its fix asserted `findings` plus one skip
reason; round 3 shows the answer is to assert the whole shape and let anything
unexpected fail. `assert.deepEqual(skipped, [])` cannot be satisfied by a row
quietly moving to another bucket.

Live: 10,978 cards and 9,005 card entries, none with whitespace in an id, none
missing `id`. No live row moves. Everything here is about two copies being
unable to disagree.

172 checks. Three controls by exit status: the card id no longer normalized, the
native id trim dropped, recognition removed entirely. Full runner: 2 of 427,
baseline.

### 199c. Renumbered from 198 to 199, the third collision in two days

Main merged PR #1385 (the staff entry gate) while this branch was in review and
took **198**. This block and its sub-entries are now **199, 199a–199c**, with the
three cross-references inside them moved along.

That is the third time in two days: 195 to 196, 196 to 197 (197as), and now 198
to 199. The cost each time is a conflicted merge plus a reference sweep, and the
risk each time is a renumbered block whose own pointers still name the old
number, which then reads as a citation of a different, real entry.

**197as proposed the durable fix and it is still the right one: a ledger entry
should claim its number at MERGE time, not at write time.** Three collisions in
two days is enough evidence to stop treating this as bad luck. It is a change to
the ledger convention, so it stays a proposal rather than something this PR
makes on its own.

Checked after the merge, per this file's own standing instruction: no duplicate
`## N.` headers introduced, and no duplicate `### 199x.` sub-headers. The six
duplicate top-level numbers in this file are all present identically on
`origin/main`.

---

## 200. [2026-09-14, BUILT] The Workload cold boot: cached snapshot first, an honest loading matrix, and a shimmer that keeps moving

The owner watched a hard refresh of `#workload` and saw three things in a row:
the boot skeleton, then a page whose team matrix already read "Free / Clear / 0"
for every editor over a calendar skeleton, then that skeleton's shimmer stopping
dead for a beat before the board appeared.

**Three causes, three fixes, all in `index.html`.**

1. **The matrix painted a roster of zeros while loading.** `renderWorkloadOverviewMatrix`
   always merged live rows onto the fixed editor roster, so with nothing loaded
   yet every editor was "Free" and every count "0": false data dressed as a
   result. It now holds skeleton rows, blank totals and `aria-busy` until the
   board has anything real.
2. **A refresh ignored the snapshot it already had.** `initWorkloadView` read the
   localStorage cache but `wlLoadSnapshot` only used it if the live read
   FAILED; past the 5-minute TTL every refresh held the skeleton for the whole
   Linear round trip. The cached issues now go on screen as soon as the
   saved-plan read settles and was not refused, at the same `planLoading`
   placement the fast paint uses (Planning… labels, no private pins, nothing
   editable), and the live read replaces them in place. The fail-closed
   contract is untouched: a 401/403 plan read still holds the skeleton.
3. **The shimmer froze.** `.sv-skeleton` animated `background-position`, which
   runs on the main thread, so the long first-render task stopped it. The sheen
   now rides a `::after` `transform`, which the compositor keeps moving through
   any main-thread task. This is app-wide: every skeleton shares the class.

**Proof.** `workload-render-browser.js` gained a `holdIssues` harness option and
two phases, `cold_boot_skeleton` and `cache_first_paint`, pinning both the
loading matrix and the stale-cache paint; 77 assertions across 15 phases pass,
`workload-board-browser.js` still passes 88 across 18.

---

## 201. [2026-09-12, MEASURED — the growth is one bucket on one team; the mechanism is NOT established] The shadow-audit residue rose 94 → 122 in eleven days, and 19 of the 28 are `outbound_archive_mismatch`

The `production_shadow_audit` lane has been red continuously since 2026-07-24
and is CONTEXT with a growth gate (`PRE_FLIP_HEALTH_CHECK.md`), so the only
question it ever asks is whether the residue is growing for a reason nobody
recorded. Four consecutive scheduled checks reported the rise and did not
decompose it, which is how "no explanatory repair" became the standing note.
This is the decomposition. It is a measurement, not a diagnosis, and it names
no cause.

`unexpected_divergences` per daily run, from `deliverable_events` (no run
recorded on 09-03):

| run date | total | `outbound_archive_mismatch` | video | graphics |
|---|---|---|---|---|
| 2026-09-01 | 94 | 18 | 22 | 72 |
| 2026-09-02 | 104 | 17 | 32 | 72 |
| 2026-09-04 | 101 | 17 | 31 | 70 |
| 2026-09-05 | 103 | 20 | 32 | 71 |
| 2026-09-06 | 114 | 31 | 43 | 71 |
| 2026-09-07 | 114 | 31 | 43 | 71 |
| 2026-09-08 | 116 | 32 | 43 | 73 |
| 2026-09-09 | 119 | 37 | 44 | 75 |
| 2026-09-10 | 122 | 37 | 47 | 75 |
| 2026-09-11 | 122 | 37 | 47 | 75 |

**One bucket.** Every other reason is flat or near-flat across the window:
`outbound_parent_mismatch` 10 throughout, `outbound_priority_mismatch` 6,
`outbound_batch_title_mismatch` 12, `outbound_comment_missing_in_linear` 8,
`outbound_due_date_mismatch` 15 → 17, `outbound_assignee_mismatch` 8 → 9,
`outbound_state_mismatch` 7 → 13. The deltas sum to the headline +28 and
`outbound_archive_mismatch` supplies 19 of them.

**One team.** Video went 22 → 47 and graphics 72 → 75. Video supplied 25 of the
28.

**Two steps, not a drift.** +11 between the 09-05 and 09-06 runs (both ~09:40Z)
and +5 between 09-08 and 09-09, flat on every other day. A daily lane that jumps
twice and sits still otherwise is recording two events, not an accumulating
leak — which is the difference between a repair and a conversation.

**What the bucket means.** `linear-deliverables-reconcile-lib.js:606-617`: the
native row's archived-or-deleted state disagrees with the Linear issue's, and
the disagreement is not one `historicalWriteDisposition` tolerates — that
function tolerates `restore` and `parent` on historical entities and never
tolerates `archive`.

**A proxy that does NOT answer this, recorded so nobody spends the query
twice.** Joining `deliverables` to `workload_issues` and comparing
`status = 'archived'` against `workload_issues.active` returns 0 in the
native-archived/Linear-active direction on both teams and 599 graphics + 641
video in the other. Neither number is the audited population.
`deliverableArchivedOrDeleted` (`:157-162`) reads `linear_raw` — webhook delete
markers, `issue.archivedAt`, `issue.canceledAt` — not the mirror's `active`
flag, so the mirror is the wrong side of the comparison entirely.

**One arithmetic note, so a future reader does not chase it.** The
`unexpected_divergences_by_reason` map sums to exactly 10 fewer than the
headline `unexpected_divergences` on EVERY run in the window, 09-01 included.
It is a constant offset, so it changes nothing about the growth attribution
above; it does mean the map is not a complete partition of the total, and the
missing 10 have not been identified.

**Not done, and deliberately not repaired here.** What would answer it: the
lane's own `unexpected_divergence_sample` for the 09-06 and 09-09 runs
restricted to `outbound_archive_mismatch`, set against whatever was archived in
SyncView on 09-05 and 09-08. The sample in the stored event payload is too
small to carry it.

---

## 202. [2026-09-12, MEASURED — one bulk edit, not 98 drifts] Foreign-write STRANDED reads 98 against a baseline of 2, and 97 of the 98 land inside two minutes

`foreign-write-strand-check.js` is CONTEXT with a growth gate, and the number it
gates on is STRANDED — Linear moved, the native row never caught up — measured
at **2** on 2026-08-22. Tonight's run over the trailing 14 days reads **98**.
Read as a growth signal that is a 49x rise. Read as events it is one action plus
one ordinary case.

Grouping the 98 by the minute of the Linear edit:

| Linear edit | rows |
|---|---|
| 2026-09-06T23:04Z | 64 |
| 2026-09-06T23:05Z | 33 |
| 2026-09-09T16:33Z | 1 |

95 of the 98 are video and 3 are graphics. 86 of the 98 have the native row in
`backlog` while Linear reads `Todo` (62) or `For SMM approval` (24).

**What it costs, post-F1.** Both teams are SyncView-authoritative, so a Linear
edit on these rows records `foreign_write_detected` and is deliberately not
applied. Nothing is lost and nothing needs healing: SyncView owns the answer and
the native value stands. What it costs is that whatever was done in Linear in
those two minutes has no effect. The rows roll out of the 14-day window around
2026-09-20 and the number falls back on its own, with no repair and no ledger
close.

**The one row that is not part of the burst** is `VID-13334`: Linear says Posted
as of 2026-09-09T16:33Z, SyncView says `smm_approval`, last touched
2026-09-05T20:53Z. That is the ordinary shape this check exists to find, and in
fourteen days it is the only one.

**The question is for a human and it is not a repair.** A 97-row edit inside two
minutes is not a person working; it is a bulk action or an automation. Which one
it was, and whether those rows were meant to move, is the part worth knowing —
and nothing on this side of the system can answer it. The same entry's standing
note applies: a stranded row is never auto-healed, because SyncView owns both
teams and the Linear value is not automatically the truth.

Checked after appending, per this file's own standing instruction: no new
duplicate `## N.` headers. The six pre-existing duplicate numbers (13, 14, 22,
23, 175, 176) now each carry a disambiguation block naming which entry is which
and which references mean it; none were renumbered, because 175 and 176 are
cited from a dozen places in `index.html` and the tests and the same hazard
applies to the rest.

---

## 203. [2026-09-12, MEASURED — 635 rows are 11 decisions, and one of them is 92% of the population] The `unmapped_project` bucket is historical projects, not a live attribution gap

`PRE_FLIP_HEALTH_CHECK.md`'s attribution entry says to "flag anything landing in
`unmapped_project` — that bucket is a decision somebody owes, not a repair."
Tonight it reads **635**, every row live, and the health check's own gating
column — an ACTIVE client is waiting — reads **0**. A number that large against
a waiting count of zero is unreadable without decomposing it, so here is the
decomposition.

`attribution-stuck-check.js --json`, `buckets.unmapped_project`, grouped by
`project_id`:

| rows | Linear project (uuid) | project status | project created |
|---|---|---|---|
| 585 | `2c6bf693-b689-4748-99eb-2162e50e8ca4` | Backlog | 2023-01 |
| 22 | `cb21f363-1646-42cc-89e4-a9ed33db5f2d` | Completed 2025-09 | 2023-09 |
| 8 | `95b04203-85a2-41b1-bd2b-3b174c475eab` | Completed 2024-01 | 2023-05 |
| 6 | `4a972b36-7796-42fc-9990-acf52760b832` | Completed 2026-01 | 2024-04 |
| 4 | `f80e0fea-cd20-4a0e-9f05-3c94c2e5e7a1` | Completed 2024-01 | 2023-07 |
| 3 | `5984daba-3636-4ca7-9a62-605a73bb9eb9` | In Progress | 2023-10 |
| 3 | `a0ecb524-ed37-4836-8d81-93ae8f1d65ec` | Completed 2024-06 | 2024-03 |
| 1 | `a8312b32-8e74-409d-b30b-1cea1324d1f0` | In Progress | 2024-10 |
| 1 | `2a8d3dd5-3b59-40fe-9925-25548f0cbd91` | Backlog | 2024-10 |
| 1 | `dfb58bb0-2280-4a91-9b3f-c1b63b65b42a` | Backlog | 2024-10 |
| 1 | `ecf471a7-daf1-4667-a19e-9bbdeccceed0` | Backlog | 2024-12 |

**Eleven projects, and one holds 585 of the 635.** Nine of the eleven are named
for people who are not on the live roster; two are internal projects from 2023.
None was created later than 2024-12. Names are deliberately not written here —
public repo, F64 — and resolve from the uuid for anyone with the workspace.

**Every single row is `backlog`.** Not one is in a working or approval status,
on either team. That is why the waiting column is 0 and stays 0: a row with no
`client_slug` appears in no client view, and a backlog row appears on nobody's
board either, so the absent attribution costs nothing today.

**`days_stuck` is 7 or 14 across the whole bucket** — the rows were last touched
in two sweeps, not continuously, which is consistent with a bulk import rather
than anything anyone is doing now.

**So the decision is smaller than the number.** It is not 635 rows needing
attribution; it is eleven projects needing one ruling each, and the ruling for
at least nine of them is presumably the one the owner already gave for former
clients elsewhere (the f200 graph includes inactive roster mappings). Two —
`a8312b32` and `5984daba`, both In Progress — are the only ones where a live
answer might differ from a historical one, and they hold four rows between them.

**Not done, and not a repair.** Nothing is proposed here and nothing is mutated.
The value of the entry is that the next reader does not have to decide whether
635 is an emergency: it is eleven mappings, 92% of the weight is one of them,
and no active client is waiting on any of it.

---

## 204. [2026-09-12, ROOT-CAUSED; the fix was REDESIGNED after review — see 204a, and note the header's original claim "the Edge Function is NOT deployed" was WRONG] The thumbnail revision scan has been red about half the time for days, and it is three Drive files the scanner cannot read plus a round-robin cursor

**The symptom.** `Thumbnail revision scan` (cron `*/10`) has been flapping with
no owner and no diagnosis. Its last eight scheduled runs, newest first:
FAIL, FAIL, FAIL, pass, FAIL, pass, FAIL, pass. Five of eight, in no pattern,
on an unchanged `main`.

**What the red actually says.** The whole of the failing log is:

```
thumbnail revision scan completed with failed items
{"ok":true,"checked":300,"changed":0,"unchanged":299,"failed":1,"skipped":0}
```

One item in three hundred. The caller prints aggregates only, on purpose
(`scripts/thumbnail-revision-scan.js` header: source URLs, post ids, storage
paths and per-item errors must never reach an Actions log), so the red says
nothing about which row or why. That is the right privacy call and it is also
why this sat undiagnosed.

**The row-level error is persisted, though, and that is where the answer was.**
`thumbnail_media_revisions.error`, live:

| rows | error | status |
|---|---|---|
| 3 | `File not found: <drive file id>.` | `pending` |
| 1 | `thumbnail revision capture failed` | `error` |

Three `pending` rows point at Google Drive files that no longer resolve. Their
rows were created 2026-07-30 and 2026-08-06 and have been retried ever since.

**Why it alternates.** `scanPendingThumbnailRevisions` selects
`status = 'pending'` ordered by `last_checked_at` ascending — a round-robin over
the pending set. There are **579** pending rows and a run covers 300
(`limit` 25 x `batches` 12), so every row comes round about every second run.
Three permanently-failing rows scattered through that ordering produce exactly
the observed five-in-eight. Nothing is intermittent; the cursor is.

**Why it was never going to settle itself.** The catch writes the error and
leaves `status` at `pending` (`thumbnail-revisions.ts`, scan loop), so the row
re-enters the rotation forever. And retiring it does not work either:
`syncview_thumbnail_revision_backfill`
(`migrations/2026-07-14-thumbnail-revision-v2.sql:327`) inserts a fresh pending
row for any active, non-archived source with a Drive file id and **no pending
row** — so a terminal status would simply be re-created on the next run, and the
table would grow instead of settling. That is why the 116 rows sitting quietly
in `skipped` do not flap: their sources dropped out of the backfill's candidate
set. These three did not.

~~**The fix, in repo and NOT deployed.** A Drive 404 is a deleted or unshared
file. It is permanent, no scan can clear it ... The scan loop counts a 404 as
`missing_source` instead of `failed` ... the caller does **not** exit 1 on it.
**Ordering is safe in both directions** ... Neither order breaks. **Still to do
— the owner's call:** the function half needs a plain dispatch of
`deploy-thumbnail-edge-functions.yml`.~~

> **SUPERSEDED by 204a, 2026-09-13.** Three of the claims above are wrong, and
> Codex caught all three on the PR before any of it merged. The 404 is NOT
> unambiguously a deleted file; the ordering is NOT safe in both directions as
> originally written; and the function does NOT wait for a manual dispatch. The
> struck text is kept rather than edited away because a reader who finds it
> quoted elsewhere needs to see what replaced it. **Read 204a for what actually
> shipped.**


**Not addressed here, deliberately.** The three sources still carry a
`thumbnail_url` pointing at a Drive file that is gone, so the cards themselves
show a broken thumbnail to whoever opens them. That is a content question for
the owner — re-upload or clear the link — and not something a monitor should
decide. The scan counting them correctly does not make them right.

---

## 205. [2026-09-12, MEASURED — three scheduled lanes have been red for weeks and the twice-daily health check has been reporting ALL CLEAR over the top of them] Nothing was watching the watchers

Found while chasing the thumbnail scan flap (item 204): if one unowned lane had
been quietly red for days, it was worth asking what else was. One query over the
heartbeats the lanes already write answers it for all of them.

```sql
select payload->>'lane' as lane,
       count(*) filter (where payload->>'ok' = 'false') as red,
       count(*) as runs,
       max(ts) filter (where payload->>'ok' = 'true') as last_green
  from public.deliverable_events
 where action = 'monitoring_heartbeat'
   and ts > now() - interval '21 days'
 group by 1 order by red desc;
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

**Amendment, 2026-09-19 — exporter guard completed.**
`scripts/linear-label-catalog-export.cli.js` now has no default project URL.
Its live card-state REST path requires `SUPABASE_URL` before it can make a
request, uses the same missing-variable and origin-shape refusal as
`native-calendar-status-backfill.js`, and is covered by an offline regression
test that proves the unset path refuses without reaching a transport. Fixture,
`--card-state-file`, and `--skip-card-state` modes remain offline because they
do not make that REST read. A two-shape sweep of `scripts/` found other
hard-coded project URLs; they are deliberately not changed by this exporter-only
repair and are listed in the PR body for their separate classification.

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
