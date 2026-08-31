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

> **SUPERSEDED 2026-08-22 by item 25.** Read that first: neither lane is red in
> the way this entry implies. Each fails on exactly ONE assertion inside an
> otherwise green run, both causes are now diagnosed, and both are fixed.


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

## 59. [found 2026-08-29 02:00 UTC, live] The calendar keeps offering Linear link controls the flip already sealed — the seal is right, the re-render never happens

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

**THE REPAIR (not done):** in the post-authority hydrate path
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

---

## 65. [found 2026-08-30, live, HIGH] Every pending calendar-card job is now silently deleted, while the app promises it will retry them

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

## 77. [FIXED IN REPO 2026-08-30 — **DEPLOY PENDING**: the edge function must be redeployed (owner dispatches the linear-inbound deploy workflow) before this is live; until then production still runs the old gate] linear-inbound cannot see a CLEARED assignee — mechanism corrected, fix shipped with an executing test

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

## 85. [found 2026-08-30 hands-on test, HALF-FIXED same day — DEPLOY PENDING; the other half is an owner call]

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

## 87. [found 2026-08-31, unknowable-assertion sweep — 12 agents, adversarially verified] Eighteen more places the interface states something it cannot know

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

### 87.1 Production Assets panel prints "Not provided / Missing" for all four slots whenever the authenticated asset read has not answered or was refused — **FIXED 2026-08-31** (PR #1183, deployed): PROD_ASSET_UNREAD_GUIDANCE now covers every deliverable, not only synthetic parents.

**Verified by refutation attempt.** I established the mechanism independently and it is not fixed on this branch. CODE. index.html:47411 sets `unreadable` only for `issue.syntheticBatchParent === true`; 47414 therefore resolves every slot of a REAL deliverable to `missing`, because index.html:48683-48689 hardcodes `assets` to four empty strings. Both rescue loops — index.html:47519 (no staff identity) and index.html:47600 (read failed) — only upgrade rows already in state `checking`, which a real deliverable can never be in, since `checking` requires a URL the projection cannot supply. The value column at index.html:53003-53007 then prints "Not provided" and the pill at 53011 prints "Missing". LIVE MEASUREMENT (publishable key, project uzltbbrjidmjwwfakwve). `production_deliverables_browser_v1` returns 46 columns and none is asset-bearing (dumped); `deliverables` and `batches` both answer 42501 to the browser key — so the projection genuinely cannot carry these values, exactly as the candidate says. 5,883 live deliverable rows (3,585 video / 2,298 graphics) after applying `_prodDeliverableLive`'s marker filter. WHO IS MISLED, AND WHEN. (a) Persistent, every reader including admins: the edge function refuses when the declared client_slug is not an ACTIVE client (supabase/functions/production-write/index.ts:3754-3755, `if (!client || client.active !== true) throw 403`). 686 live cards fall in that set — 637 of them carry client_slug `unattributed`, plus testproject 22, jessicaencellcoleman 15, jesszweig 9. The browser sends `authorityProject || storedClientSlug || project` (index.html:47507), which for those rows is `unattributed`. Anyone triaging the unattributed backlog on Monday opens one and is told the post has no filming plan, no footage, no delivery folder and no file — while the red line underneath blames their staff account, which is also not the reason. (b) Persistent, cross-team creatives: policy.mjs:300-306 `staffAssetReadAllowed` admits admin/smm always, and creative only when memberTeam === targetTeam. team_members holds 3 active editors (video: Santi, Nahuel, Iara) and 1 active designer (graphics: Rocio); roleCompatible maps editor/designer onto keyRole `creative` (policy.mjs:143). So

**Traps in the obvious fix.** Three concrete risks. (1) The honest label must not survive a SUCCESSFUL read: the gateway legitimately returns per-slot state `missing` for a genuinely empty column, and SMMs/designers rely on "Missing" to know a filming plan has not been uploaded yet — a blanket seed change to `unavailable` would erase a true signal on the ~5,200 cards whose read succeeds. The change belongs keyed on `state.status` in the seed (47414) and the two rescue loops (47519, 47600), never on the row. (2) `checking` is already a user-visible label ("Checking", _prodAssetStateLabel), so reusing it for the pre-read seed would leave four rows reading "Checking" forever on any card whose read never returns. (3) test/prod-batch-parent-panels.js:313 pins the exact source expression `_calEsc(unreadable ? String(asset.guidance).trim() : 'Not provided')` with a text scanner; any edit to that line reds a currently green test and must be updated in the same commit.

### 87.2 Unassigned + undated sub-issues vanish from the whole Workload board, including the strip labelled "Needs assignment" — **FIXED 2026-08-31** (PR #1185): counted and reported by `wlExcludedSummaryText`; nothing re-bucketed.

**Verified by refutation attempt.** HOLDS — mechanism and scale independently reproduced against live data. MECHANISM (index.html:16340-16343). wlApplyData buckets in one pass. First branch: `if (!s.assigneeId) { if (inProg || workDate) unassigned.push(s); continue; }`. `workDate` = wlDisplayDate(s) (15656), empty unless a manual plan_date or a Linear due_date exists. So an active unassigned sub with no date and status != "In Progress" is pushed to no list and `continue`d past every later bucket, including needsTweak at 16352. Confirmed no console warning covers it: the two warns in this function are for unrecognised clients (16286) and non-allowlisted video editors (16315). I verified the consumer inventory myself rather than taking it on trust. renderWorkloadShell (15808-15900) has exactly five panels: Team-workload matrix, work-day calendar, "Needs assignment" strip, "Needs a work day or deadline" strip, legend. wlState.unassigned is read by one renderer only (renderLooseIssueStrip via 18208). The matrix (17914-17922), the freest-first row (18049-18053) and the popover 'active' source (18768) all iterate planned/nowWorking/tweaksNeeded/overdue/undated — never unassigned. wlState.allActiveSubs reaches the popover only via `data-wl-issue-id` on a rendered rollup element, and these rows render no element anywhere, so that path is genuinely unreachable. `.workload-empty` (CSS 3876) has zero call sites in the file. LIVE MEASUREMENT (workload_issues, 1,940 active rows read with the public key, replaying wlIsActiveStatus + wlIsAllowedClient + the bucketing loop): 210 active sub-issues for seed-roster clients; 167 visible; 42 silently discarded (20%). Two clients go 100% blank: Miki Agrawal 4/4 lost (VID-9645/9646/9647 "16/17/18 video" and VID-10327, all Tweak Needed, VID-10327 last touched 2026-08-28 — flip day), and Jesse Israel via candidate 4's gate. Partial loss: Dr. Sonia Chopra 23 of 33, Kasper Hytonen 9 of 14, Baya Voce 5 of 21, Sidney Laruel 1 of 5. Dropped statuses: 34 Todo, 8 Tweak Needed. The no-empty-state claim is exact: hasAnyData (17692) is computed on the UNFILTERED lists, so with 167 rows visible globally it is truthy and renderWeekGrid/renderMonthGrid paints an empty week rather than

**Correction as the verifier framed it.** Scale: 42 of 210 active sub-issues for roster clients (20%), not 44 of 62; the "Needs assignment" strip lists 5, not 18 — the auditor's 62/18/44 figures count non-roster client names, which a separate gate drops with a console.warn. Drop the "every new card the video team makes on Monday lands in this hole" framing: 197 of 221 sub-issues created since 2026-08-20 are assigned and 213 are dated, so the hole is old stock, not the growth path.

**Traps in the obvious fix.** Routing the 42 rows into wlState.unassigned turns a one-line strip into a wall — renderLooseIssueStrip (18211) maps the entire filtered array with no cap, and 34 of the 42 are stale Todo rows (Sonia 23, Kasper 9) nobody has touched in months, so the strip that today shows 5 chips shows 47 (112 with sheet-merged clients). Worse, that strip is built with applyEditorFilter=false, which means its chips carry NO "Set work day" button — the fix would surface 42 rows and offer no action on any of them. Bucketing them into needsTweak instead is the more dangerous option: every downstream consumer keys on assigneeId (wlGroupRollups 17714, ensureEditor 17836, wlDayOverCapacity 15781), so undated unassigned rows would collapse into a phantom '?' editor and distort the capacity math the auto-placement pass depends on. The low-risk shape is the one commit bfb02742 already ratified for Kasper: a counted, reported notice above the board plus a real empty-state when the current filter yields nothing, leaving the bucketing untouched.

### 87.3 The SMM's Review tab (and its badge) drops a card at "For SMM Approval" that has no media — **FIXED 2026-08-31** (PR #1185, commit `c19e714e`): counted notice in both queue states; the media gate and the badge deliberately unchanged, pinned by `test/smm-review-stranded-media.js`.

**Verified by refutation attempt.** HOLDS — reproduced exactly, to the single card, on live data. MECHANISM. _calReviewItems (41756): in smm mode `if (!_calHasMedia(p)) return false;` runs BEFORE the awaiting-approval test. _calApprovalBadgeCount (41717) repeats the same skip, so the badge agrees with the wrong list. _calHasMedia (41642) is asset_url OR thumbnail_url non-empty. renderCalReview (41778-41784) then prints the empty state. I read the whole function: there is no stranded list and no notice on this path. LIVE MEASUREMENT (calendar_posts, 9,326 rows read with the public key; 695 non-archived, replaying _calComponentsFor / _calNormStatus / _calHasMedia): 11 non-archived posts have a component at "For SMM Approval"; exactly 1 is hidden by the media gate. It is client `lukecutting`, name "Video 1", id p_native_891c58824ab4a68aae00cff23ad1_1, video_status="For SMM Approval", asset_url and thumbnail_url both empty, video_deliverable_id=del_fe263739-… (native), scheduled_date=2026-08-31 — Monday — last written 2026-08-28T22:18:29Z, flip day. It is the ONLY awaiting card on that client, so the queue that renders "Nothing waiting on SMM approval right now" is 100% wrong for lukecutting, and the badge is 0. lukecutting is a real live client, not a test slug: 27 rows, cards Posted through 2026-08-29. The contradiction claim is exact. _calSmmMediaGap (41653) computes beyondProgress('For SMM Approval') && !asset_url = true, so the same card renders _calSmmWarnDotHtml on the month pill (41188) and week pill (41323), _calSmmWarnOverlayHtml on the Sheet card thumb (37350), and _calSmmWarnBannerHtml in the preview (42821) — all saying "No video linked." Three surfaces flag it; the fourth, the queue the SMM works approvals from, says nothing is there. The tab is unavoidable for internal users: tabViews at 34997 is `['smmreview','organizer','month','week']` whenever !_isClientLink, and 35006 wires the badge to _calApprovalBadgeCount('smm'). This is the exact archetype commit bfb02742 fixed on Kasper's side hours ago — I diffed it: the fix added a `stranded` bucket at the identical media gate and _kasperRenderStrandedNotice above the queue. The SMM's gate 200 lines away in the same file was not given the s

**Correction as the verifier framed it.** Live scale is one card, not four: across all 695 non-archived posts exactly one is hidden by this gate (lukecutting "Video 1", Monday 2026-08-31). The filing's "one visible card and three hidden ones" case, where the empty-state copy does not even appear, has zero live instances today — today the copy does render and does name the rule, so the disclosure is partial rather than absent.

**Traps in the obvious fix.** Do not un-gate the filter. _calReviewCardHtml is built around media, so admitting the card into `items` renders a broken review card offering approve/tweak actions on a deliverable that does not exist. The safe fix is the shape already ratified for Kasper in bfb02742: a counted stranded list plus a notice above the queue, card still excluded. The badge is the judgement call — counting stranded cards changes its meaning from "items to review" to "items needing attention" and would make it disagree with the list length, so the notice should carry its own count instead. Whatever is done here must also be checked against the Samples twin, which has the identical pair at _sxrApprovalBadgeCount (56878) — fixing one surface and not its sibling is how this gate got missed the first time.

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

**Traps in the obvious fix.** Do not simply make `_prodLoadData` rethrow in silent mode. Two other silent callers — `_prodAutoRefreshOnReturn`'s `_prodRefresh({silent:true})` (index.html:54923) and the two post-create reloads at index.html:50793 and 50835 — currently rely on it never rejecting; a rethrow there produces an unhandled rejection and a console error, which the boot probes fail on by contract (qa/probes/lib.js's zero-console-error gate). The low-risk shape is to have `_prodLoadData` RETURN a boolean (true on the success path, false from the silent catch) and have `_prodDeltaRefresh` treat false exactly like a thrown error at 55126-55134, leaving `lastFullSyncAt` un-advanced. Second risk: the 401/403 branch already calls `_prodCachePurge()`, so a fix that also marks the tab degraded on that path will, on a genuinely signed-out session, show 'Live updates stopped: this session is no longer authorized.' over a board that has just been emptied — check that copy reads correctly against an empty board before shipping.

### 87.12 Every asset-failure message tells the reader to fix Google Drive sharing, on a team whose deliverables are 99% Frame.io — **FIXED 2026-08-31** (PR #1185, commit `c19e714e`): all three sentences provider-neutral, Drive steps kept.

**Verified by refutation attempt.** Independently established, and the scale claim is now measured rather than asserted. MECHANISM. The three states are produced host-agnostically in supabase/functions/production-write/index.ts:probeAssetUrl (~500-515): 401/403 -> permission_denied, 404/410 -> expired, everything else -> providerEvidenceState, which classifies a login-wall body as permission_denied and a thrown fetch (redirect_unapproved / timeout / unreachable) as unavailable. Nothing in that path knows or cares which host it probed, and policy.mjs:589-600 puts frame.io, app.frame.io, next.frame.io, f.io, dropbox.com and uploads.linear.app on the same allowlist as Drive. The browser then maps all three states onto Drive-only instructions in _prodAssetStateText (index.html ~50881-50890 in the CURRENT working tree; the tree is being edited concurrently, so anchor on the strings 'In Drive open Share', 'Drive reports the same' and 'The usual cause is sharing'). It also OVERRIDES the gateway's own host-neutral guidance (index.ts:338-339). REACHABILITY. The copy is only reached via code 'artifact_not_resolvable' in _prodWriteErrorText, and of the six throw sites the one that a creative hits is the attachment handler (index.ts:~4612), which is now open to video: ARTIFACT_TEAMS = {graphics, video} (index.ts:121), policy.mjs:217 'a creative may attach on their OWN team, video included' (dated 2026-08-30, not three days ago as filed), and _prodRoleCanWrite returns true for 'attachment' after the team match (index.html ~50038). MEASURED. deliverables.file_url is not granted to anon (42501 - itself archetype A), so I could not count it directly and say so. The adjacent artifact columns that ARE readable settle it: sample_reviews.asset_url = 3,439 frame.io vs 0 drive.google of 4,035 non-empty; calendar_posts.asset_url = 1,028 frame.io vs 5 drive.google. calendar_posts.thumbnail_url (the graphics artifact) is the mirror image: 651 drive, 0 frame.io. So the Drive copy is right for graphics and wrong for exactly the team that just gained the button. I also verified live that Frame.io produces these states: https://f.io/<bad-id> answers 404 (-> 'expired' -> 'Drive reports the same not found...') and next.frame.io

**Correction as the verifier framed it.** The filing dates the video role change to 'three days ago'; policy.mjs:217 and the browser gate both date it 2026-08-30. Also, only the attachment throw site reaches video - the other five artifact_not_resolvable sites are graphics-only, so a designer on Drive is not misled.

**Traps in the obvious fix.** The refusal object carries asset_state and guidance but NOT the URL, so host-aware copy has to read the host from state.draft in the browser - which the error path may have already cleared. The low-risk fix is to make the three sentences provider-neutral ('open the link's sharing settings and give the review team access; on Drive that is Share -> Anyone with the link, on Frame.io a public review link') rather than to branch on host. Whoever edits it must not delete the Drive specifics outright: the 2026-08-19 report that created this function was a designer who got 'could not be verified' with nothing to act on, and graphics really is Drive.

### 87.13 The Samples remove-link confirm still promises the clear sticks - the exact twin of the calendar bug fixed today — **FIXED 2026-08-31** (PR #1185): the sentence names the adopter; behaviour deliberately unchanged.

**Verified by refutation attempt.** Confirmed end to end, and it is a clean unfixed twin of a defect corrected in commit 030030bd earlier today. MECHANISM. _sxrLinearClear (index.html ~57925, body text ~57930) says unconditionally '...and nothing else about the sample changes.' _sxrAdoptDeliverableLinks (~57844-57900) walks every sample whose linear_issue_id / graphic_linear_issue_id is EMPTY but whose _writeUiNativeId is set, reads the deliverable's linear_issue_url, and upserts it back onto the sample row. It runs as a tail task of loadSxrCards (~57516) and again on the 4s/10s/20s/45s after-create timers (SXR_ADOPT_AFTER_CREATE_DELAYS_MS). I checked the obvious escape: clearing does NOT also clear the deliverable id - SXR_LINK_CLEAR_FIELDS/_sxrApplyClearSentinels only sends the clear sentinel for keys actually present in the patch, and the id is not touched. So the adopter refills on the next load. The calendar twin now branches on native and says 'the link will be restored automatically on the next load'; the samples function is even labelled 'The sample-review twin of _calLinearClear -- see the reasoning there' and kept the pre-fix sentence. REACHABILITY. Post-flip the ✕ is the only link control on a linked slot (_sxrLinearSlotHtml ~57782 renders open + ✕ in the sealed branch; the pencil is gone and an empty sealed slot renders nothing), and prod_authority reads {video: syncview, graphics: syncview} live, so the seal is on. MEASURED. The population where the promise is false is small but is exactly the post-flip shape and grows from Monday: 15 sample_reviews rows carry video_deliverable_id AND linear_issue_id, 21 carry graphic_deliverable_id AND graphic_linear_issue_id (of 6,370 samples). For the other ~5,200 linked samples - link, no native deliverable - the current sentence is true, which is why this reads as low-volume rather than universal.

**Traps in the obvious fix.** Low, but two traps. (1) The fix must use _writeUiNativeId(post, which) against sxrState.posts, not calState.posts - a copy-paste of _calLinearClear brings the wrong state object and would silently take the non-native branch for every sample. (2) Do not 'fix' it by suppressing the adopter for cleared rows: the adopter exists because a native sample is materialized before the Linear mirror drains, and the reported live case was a GRA url that never arrived. Change the sentence, not the behaviour.

### 87.14 'Reload before trying again' is offered for the one refusal the code's own comment says will recur forever — **FIXED 2026-08-31** (PR #1185): the reload prescription is gone; the message states the problem and names no remedy. The escalation to name is the owner call.

**Verified by refutation attempt.** Independently established, measured, and corroborated by the repo's own precedent. MECHANISM. WRITE_UI_FAILURE_CODE_TEXT.native_link_required (index.html ~25980-25983) reads 'This team now writes natively, but this cached card has no native deliverable link. Reload before trying again.' The refusal is thrown by makePayload inside _writeUiGatewayPost (`if (!intent.legacyOnly && !legacyParity && !intent.nativeId)`, ~26428) purely from the row's real state, and by _writeUiClassifyTargetless (~25144). Neither reads a cache. I confirmed there is no client-side backfill of video_deliverable_id/graphic_deliverable_id from a url anywhere in the file - _calAdoptDeliverableLinks runs the other direction (url FROM the deliverable) - so a reload re-reads the same server row and produces the same refusal. The comment fifteen lines above the copy already states it: 'makePayload throws native_link_required forever after. The card looks connected and fails on use.' REACHABILITY, MEASURED. The pill is not locked for these cards: _calCompLinked (26962-26973) returns true when EITHER the url or the native id is present, so a card with a Linear url and no deliverable id has a live, clickable status pill. Live counts (status != Archived): 111 cards with linear_issue_id and no video_deliverable_id, 149 with graphic_linear_issue_id and no graphic_deliverable_id. Of the 111, 36 are still in flight (18 In Progress, 9 Approved, 2 Tweaks Needed, 1 Client Approval, 6 blank) across dougcartwright, jesseisrael, chelseyscaffidi, daniellerobin and others. The throw propagates out of _calFlushCardSave before the source upsert, so the status genuinely does not move. CORROBORATION. The repo has already fought this exact shape: _writeUiReportFailure carries a block titled 'MAKE THE RELOAD ADVICE TRUE (OPEN_REPAIRS 13)' that evicts display caches for entity_not_found and batch_not_found so their reload advice becomes true. native_link_required is in the same `reload` class but was not added - and could not be, because the server row is the problem. Two lines below, the `artifact` class comment already concedes the principle: 'Reloading cannot fix that and never could.'

**Traps in the obvious fix.** The copy edit is trivial; the honest replacement is the hard part. Post-flip there is no in-app way to give a legacy card a native deliverable - Production create is closed (production_create_closed), the link paste is sealed, and Import from Linear only makes more of them - so a truthful message has to end in an escalation rather than a self-serve step. That is an owner decision, not a wording tweak. Do NOT 'fix' it by moving native_link_required into the cache-eviction list: the eviction would fire on every one of these 260 cards, forcing a full refetch per client, and still refuse.

### 87.15 Samples 'Set all' promises to set both components on a card whose own pill says one of them cannot be routed — **FIXED 2026-08-31** (PR #1185): the settable predicate is `_calCompLinked` on BOTH surfaces (not the calendar url-only test, which was the named trap), the samples apply loop iterates only the settable set, and the menu header and confirm both disclose the skip.

**Verified by refutation attempt.** Confirmed, and the samples side is strictly worse than the filing describes. MECHANISM. _sxrSetAllSettable (~58156) is `return true` and is DEAD - neither _sxrOpenSetAllMenu nor _sxrSetAllStatus calls it. The menu header is a hardcoded literal 'Apply to Video &amp; Thumbnail' (~58143) and the confirm is a hardcoded 'Set Video and Thumbnail to "..."' (~58186), while the apply loop iterates SXR_COMPONENTS unconditionally. The same card locks that pill 180 lines earlier with `const lock = !_calCompLinked(p, c) ? ' is-locked' : ''` (~58331) and disables it with title='Link a Linear sub-issue first' (~58339). The calendar twin does it correctly: _calSetAllSettable filters, the header spells out the skip, the confirm appends '(X not linked to Linear - skipped.)', and apply iterates only `settable`. OUTCOME IS WORSE THAN FILED. The unlinked component reaches _sxrPushStatusToLinear (~61304) with no url and no native id -> targetKey falsy -> _writeUiClassifyTargetless('sxr', ...) -> authority is syncview -> native_link_required THROWS. That throw happens in the video leg at ~58898, before the graphic leg and before the source upsert, so the legitimate half is lost too: both pills flip on screen, a 'Write not saved' dialog appears, the card gets a _saveError badge, and NOTHING is persisted. When it is the graphic that is unlinked, the video leg has already committed natively before the throw, so the deliverable moves and the sample row does not. MEASURED. 1,135 samples have a fully unlinked video component and 1,045 a fully unlinked graphic; 704 of the video ones were updated on or after 2026-07-01, and 205 samples have video unlinked while graphic IS linked - the exact mixed card where 'Set all' looks sensible and takes the good half down with it.

**Traps in the obvious fix.** The obvious fix - port _calSetAllSettable - is the trap. That predicate tests the Linear URL ONLY (`post.linear_issue_id`), whereas the pill lock next to it uses _calCompLinked (url OR native id). Porting it verbatim would make Set-all skip a native-only card whose pill is unlocked and whose write would succeed. Today that is latent, not live: 0 samples and 0 live calendar cards carry a deliverable id without a url. Use _calCompLinked as the predicate on both surfaces, and take the calendar's disclosure strings with it.

### 87.16 A locked status pill still says 'Link a Linear sub-issue first' after the flip removed every control that could do it — **FIXED 2026-08-31** (PR #1185): same repair as 87.8, same constant — they were always one defect on two surfaces.

**Verified by refutation attempt.** Small, but real, and I verified the one thing that could have killed it. MECHANISM. `lock` is computed from `!_calCompLinked(p, c)` alone (calendar ~37339, samples ~58339) and the disabled button carries title='Link a Linear sub-issue first'. Every affordance that could satisfy that instruction is sealed post-flip: _calLinearSlotHtml returns '' for an empty sealed slot (~36918-36929, with the comment 'the warn below was actively asking people to create the defect'), `needsLinear` is seal-gated (~37286) so the orange 'Link the Linear sub-issue' banner never renders, `parentComp` is seal-gated for both components (~37296-37298), and _calLinearEdit refuses with the sealed notice before opening an input. Both teams read syncview live. THE OBJECTION I TESTED. A title on a `<button disabled>` is not shown by every browser, which would have made this invisible. I measured it in Chromium via Playwright: a disabled button still receives pointerover/mouseover/mousemove and is still returned by document.elementFromPoint, so hit-testing works and the native tooltip renders. The string is genuinely on screen. MEASURED POPULATION. 66 live (status != Archived) cards have a fully unlinked video component and 36 a fully unlinked graphic - so ~100 locked pills carrying the stale instruction, plus the samples equivalents. The repo measured 143 unlinked live component slots when it shipped the N/A label, which is the same order. Why it is only low: the visible label already reads N/A and the control is inert, so the harm is a few seconds of hunting for a button that no longer exists, not a false belief about data.

**Traps in the obvious fix.** Near zero for the copy - the honest replacement already exists verbatim in _writeUiLinkSlotSealedNotice ('This work lives in SyncView...'). The one thing a fixer must not do is unlock the pill: the lock is correct, only the sentence is stale, and _calCompLinked is load-bearing for the N/A display rule and the client view.

### 87.17 "Preview - read-only" is still the answer five controls give AFTER hydration, three inches from a chip that says "Native writes" — and "Move to project" opens a full working picker that can never act — **FIXED 2026-08-31** (PR #1183 for the Project half, PR #1185 for Delete/Move and the ⌘ Actions button label).

**Verified by refutation attempt.** I established every leg myself. Live read: `prod_authority` = {"video":"syncview","graphics":"syncview"} (syncview_runtime_flags, read 2026-08-31), so `_prodModeText()` (index.html:46561) renders the sidebar chip as "Native writes". In the same paint, `_prodReadonlyGuard()` (index.html:50076) toasts `_prodPreviewText()` = 'Preview - read-only' from eight reachable call sites, which I read individually: ⌘/Ctrl+Backspace over a list selection (:~49851), project-board drop (`_prodBoardDrop`, :~51683), the Project picker pick handler (`if (!item || kind === 'proj') return _prodReadonlyGuard()`, :~53614), the project-level status/lead/target pickers (:~53835), context-menu mutating entries (:~54159), the group select-all checkbox (`_prodGuardGroupSelection`, :~54850, whose tooltip is literally the same string), and bulk 'Delete issues' (:~55447). The Project row is the sharpest: `_prodAttributionProjectControlHTML` (index.html:55742) emits a plain `<button class="prod-prop-btn">` with NO `_prodWriteGateAttrs`, no aria-disabled, no gate tooltip, sitting in `_prodProps` immediately below Status/Assignee/Due/Labels which all carry gate attrs and all write for real; and `_prodOpenPicker` skips its write-gate check entirely for `kind !== 'proj'`, so the searchable "Move to project…" popup of every client is built and wired before the pick hard-returns the guard. All of this is present in the deployed page (I fetched syncview.synchrosocial.com and confirmed `kind !== 'proj'` and the guard return are live). Who hits it and when: any signed-in SMM or admin on a deliverable detail panel — and moving a card to the right client is a real recurring job, which is why docs/ops/MOVE_CARD_BETWEEN_CLIENTS.md exists. What they see that is false: a sentence asserting the TAB is a read-only preview, on the one week the whole point is that it is not, contradicted by the chip in the same viewport. Not fixed on the branch (verified at HEAD cc411649).

**Correction as the verifier framed it.** Three corrections to the filing. (1) Severity is medium, not high — nothing is lost or corrupted; the cost is one false global claim that could make a reader conclude the surface is read-only. (2) The picker being a no-op is DELIBERATE and documented (docs/ops/MOVE_CARD_BETWEEN_CLIENTS.md: "There is deliberately no button for this"; docs/syncview-design/WIRED-PARITY.md marks these deferred-B3). So the defect is the wording plus the missing disabled affordance, not a missing feature. (3) The board drag is CLIENT/project cards between project-status columns (`_prodBoardDragStart` matches `.prod-card[data-prod-client-card]`), not deliverable cards between status columns.

**Traps in the obvious fix.** The literal 'Preview - read-only' is asserted verbatim across the parity estate — docs/syncview-design/tests/behav-wired.js (5 assertions), prod-structure-subset.js (2), pixel-wired.js, prod-readonly-smoke.js, prod-review-packet-validate.js — plus the skeleton copy at :7959. Changing the toast without moving those turns the Production polish gate red on main, the exact failure PR #1182 caused by moving a source without its pin. `_prodReadonlyGuard()` serves eight call sites of five different kinds, so ONE replacement sentence cannot be honest for all of them; an honest fix is per-call-site text, a wider edit than it looks. Do NOT fix by adding 'proj' to `_prodOpenPicker`'s gate — that would emit `_prodWriteGateText`, which asserts an authority/role reason that is also false. And do not remove the picker: prod-structure-subset.js:618 and prod-review-packet-validate.js:148 both assert the bulk menu still contains 'Move to project...'. The safe change is per-control copy plus aria-disabled/tooltip, shipped together with the suite updates.

### 87.18 Every batch parent in SyncLinear says "Labels unavailable" and offers a Retry that can never succeed — **FIXED 2026-08-31** (PR #1183): `_prodEnsureLabels` short-circuits a synthetic parent; the popover explains and offers no Retry.

**Verified by refutation attempt.** I established the whole chain. A synthetic batch parent's `id` is the BATCH id (index.html:~48946, `id: node.nodeId`, with the in-code note "nodeId is the batch id for a single-parent batch and a suffixed id for the second parent of a two-team batch"). `_prodRender` calls `_prodEnsureLabels(_prodState.openId, false)` unconditionally for every detail view (index.html:~55300), and `_prodEnsureLabels` (index.html:47366) has NO `syntheticBatchParent` short-circuit — I re-read it at HEAD cc411649 and on the deployed page, both unguarded. It POSTs `{action:'labels_read', id}` to production-write, whose `handleLabelsRead` (supabase/functions/production-write/index.ts:3940-3952) does `supabase.from("deliverables").select("*").eq("id", id).maybeSingle()` and throws `404 entity_not_found` when nothing comes back. `_prodLabelErrorText` (index.html:47351) has branches only for 401, 403, and incomplete_label_state, so it falls to the default 'Labels could not be loaded. Retry to check the current Linear state.' — which asserts a transient read failure and a Linear label state to re-check, when the truth is structural: a container with no deliverable row and no Linear issue of its own. `_prodLabelsPopHTML` then renders a Retry button that re-fires the identical request forever. The asymmetry the filer names is real: `_prodEnsureDescription` (index.html:~52720) and `_prodEnsureAssets` (index.html:~47549) both short-circuit on `syntheticBatchParent === true`, and `_prodOpenPicker` refuses status/assignee/due with the honest sentence "This is the post's batch parent — open its sub-issues to work on it." Labels is the one control the 2026-08-30 truth pass missed. Scale, measured by me not quoted: I reimplemented `_prodResolveBatchParentNodes` against live `batches` and `production_deliverables_browser_v1` with the adapter's liveness filter and got exactly 199 synthetic batch parents — independently reproducing the number in the code comment. They carry status `todo`, so they all sit in the default open list; opening one is the normal way to reach a post's sub-issues.

**Correction as the verifier framed it.** Severity medium is right. One nuance the filing missed: on a batch parent the Project row ALSO opens the working "Move to project…" picker and toasts 'Preview - read-only' instead of the batch-parent sentence, because `_prodOpenPicker` skips its gate for `kind === 'proj'`. That is candidate 2's mechanism landing on the same panel, so the two should be fixed in one pass.

**Traps in the obvious fix.** The obvious short-circuit must not strand the row at 'Loading labels…': `_prodLabelsButtonHTML` has only three states (loading/error/ready), so the new branch has to set `status:'ready'` with an empty catalog and empty selection — which renders "Add labels", a control inviting a write. That is survivable (`_prodCanWrite` returns false for `syntheticBatchParent === true` and `_prodWriteGateText` already answers with the honest batch-parent sentence) but it must be checked, not assumed. The alternative — hiding the Labels row entirely on a batch parent, the same rule the Assets refresh button adopted in 226b757a — is cleaner but `_prodProps` is shared with real deliverables and test/prod-batch-parent-panels.js asserts the panel set, so that suite moves with it. Either way the genuine transient path (401/403/incomplete catalog) must stay intact for real deliverables, or a real Linear read failure starts reading as structural.

---

## 88. [2026-08-31] `Production read-only smoke [timeout_unspecified]` — a true summary that named nothing, now instrumented

The fast Production lane has been red on the flip branch for three pushes with
exactly that line and nothing else. The suite's own output is deliberately
runner-private (F122: it renders live client text), and the public summary
carries one code from a fixed allowlist — so a reader gets "which suite" and a
generic timeout family, over a suite that walks fourteen sections any of which
can time out.

Three sittings were spent guessing at it from sources. Two speculative fixes
were pushed before the sandbox limitation was established rather than assumed:
**Chromium in this environment cannot reach the network at all**
(`ERR_CONNECTION_RESET` on every request; the Python REST probes work because
they use the agent proxy, which the browser does not). The browser lanes are not
runnable here, full stop, so the only way to learn where the suite stops is to
make it say so in CI.

**What shipped.** `prod-readonly-smoke.js` announces each section as it enters
it (`SMOKE_STAGE <name>`, fourteen of them, `boot` → `no_write_requests`).
`prod-polish-gate.js` harvests the legal names out of that file's own source and
qualifies the failure code with the LAST one announced, so the next red run
reads e.g. `timeout_unspecified@board_open`: the code says WHAT, the stage says
WHERE. Both halves are assembled from allowlists, never from run output — the
same discipline as `BEHAV_WIRED_CHECKS`, pinned by
`test/prod-polish-names-the-check.js`.

The three classifiers were also folded into one `failureReason(text)`. The first
draft inlined the composition as an IIFE on the `reason:` line, which preserved
the "never assigned from raw output" invariant and destroyed the ability to
CHECK it with a one-line regex — `test/prod-polish-gate-failure-codes.js` went
red and was right to.

**Still open:** the timeout itself. This item is the instrument, not the cure.

### 88b. Bisected: introduced by PR #1183, and located to one block

Two facts from the first instrumented run, both evidence rather than inference.

**WHERE.** `timeout_unspecified@parent_link` — the "Parent issue" side-card
block, which is nine sections in. The three sections before it
(`detail_open`, `detail_guards`, `comments_state`) all passed, so the child
deliverable's detail renders fine. Split into `parent_link_probe` /
`parent_link_click` / `parent_link_detail` on the next push, because that block
holds three awaits of two shapes and a `locator.*` timeout classifies the same
for all of them.

**WHEN.** Bisected across the fast lane on `main`, by conclusion per merge:

| merge | fast lane |
|---|---|
| #1179 `8e1f961f` | **green** |
| #1181 `583c8298` | **green** (heavy only) |
| #1182 `3761db54` | **green** (heavy only) |
| #1183 `b1f0cdee` | **RED** — first `Production read-only smoke` failure |
| #1184 `d86717df` | RED, same |

So the asset spec introduced it. That also kills the guess this session spent
two pushes on: `batch_files_read` cannot be the cause, because
`_prodEnsureBatchFiles` returns `null` before issuing any request when
`_syncviewStaffIdentityForHeaders()` is falsy — which it always is in this lane,
since the suite sets only the `syncview_auth_v1` marker and has no staff
session. Batching that read was worth doing on its own merits and was never
going to move this lane.

**Narrowed again, same night.** The split markers came back
`timeout_unspecified@parent_link_click`: it is the CLICK on `.prod-parent-link`,
not the probe before it and not the wait after. The element EXISTS at that
moment — `parentBtn.count()` is what gated entry to the block — so this is an
actionability failure, not a missing element. That leaves: not stable, not
visible, intercepted, offscreen, or detached. Not "disabled": the control is a
plain `<button>` with no disabled attribute.

`prod-polish-gate.js` now carries a `click_*` code for each of those, ranked
ABOVE the whole timeout family (a click timeout matches `timeout_unspecified`
too, and "the element never went stable" is a diagnosis where "something timed
out" is only a symptom). Each pattern matches a fixed string Playwright itself
emits, so they carry no more live content than the codes they outrank. The next
red run should read something like `click_unstable@parent_link_click` — cause
and location in one line, from a lane this sandbox cannot run.

**Third narrowing, and a method correction.** The gate grew `click_*` codes
keyed on strings like `element is not stable`, and on their first live run not
one matched — the summary still read `timeout_unspecified@parent_link_click`.
**That absence proved nothing.** Playwright states the POSITIVE ("element is
visible, enabled and stable") and on failure simply stops, so an unmatched
pattern is as consistent with a wrong regex as with any diagnosis. Guessing a
third party's log format is the same mistake as guessing the defect, one level
removed — and it cost a round trip.

The suite now diagnoses its OWN click failures: on catch it asks the DOM the
four questions that separate the causes — is the element still there, does it
have a box, is something on top of it, does its box move across two animation
frames — and reports through the stage channel (`parent_link_gone`,
`_zero_size`, `_hidden`, `_offscreen`, `_covered`, `_moving`, `_settled`,
`_undiagnosed`), then rethrows. No gate change was needed: those are real
`stage('...')` literals, so the harvester admits them and the gate still emits
nothing it did not read out of the suite's own source. The `click_*` codes stay
(`intercepts pointer events` is worth catching) but are no longer the authority.

**RESOLVED 2026-08-31 — and it was the same bug the round-3 tester found.**
`production-polish` went GREEN on `28e05b0f`, the commit carrying the
batch-parent label recursion fix (item 90). The lane had been red since #1183
merged; nothing else in that commit touches the smoke path.

So every narrowing below was measuring the same defect from the outside. The
page was mid-blown-render when Playwright reached for the click, which is why
the parent card was genuinely absent from the DOM and why `d.parent` read empty
on a row that had one moments earlier: `_prodEnsureLabels` was recursing through
`_prodRender`, and the DOM the diagnosis inspected was the wreckage.

**The method lesson is not that the instrumentation was wrong.** Every step of
it was true and each narrowed the search honestly. The lesson is that a symptom
measured from outside a frozen page can look like a data bug for four rounds
running -- `gone_no_parent_field` is a perfectly accurate reading of a render
loop -- while one person opening the screen and watching the tab die names it in
minutes. When a lane and a human are both available, the human is the shorter
path to the CAUSE and the lane is the better guard against its return. Reach for
both, and do not mistake a precise measurement of a symptom for a diagnosis.

The instrumentation stays: it is what will locate the next one, and it turned
`[timeout_unspecified]` into a stage name plus a DOM reason in three pushes.

**FOURTH NARROWING — and it is a product bug, not a test artefact.** The
suite's own diagnosis came back `parent_link_gone`: at the moment of the click
there is no `.prod-parent-link` in the DOM at all. Not covered, not moving, not
hidden — **gone**, between the `count()` that gated entry to the block and the
click a few milliseconds later.

So the "Parent issue" side card renders and then vanishes. That is visible to a
real person, not only to Playwright: open a sub-issue, and the card offering to
open its parent disappears under the cursor. The suite is not being fussy; it is
the only thing in the estate fast enough to have noticed.

`_prodDetail` builds it from `const parent = d.parent ? _prodIssue(d.parent) :
null`, so it stops rendering for four distinguishable reasons, wanting four
different fixes: the view moved off detail, the open issue no longer resolves,
the row lost its `parent` field, or the parent id stopped resolving in the
projection. The diagnosis now splits those (`gone_view_changed`,
`gone_openid_unresolved`, `gone_no_parent_field`, `gone_parent_unresolved`,
`gone_rendered_nowhere`) and reads them from `_prodState` rather than the DOM,
which by that point can only say "absent".

**The standing suspicion, to be confirmed or killed by that split rather than
assumed:** #1183 changed which rows the adapter yields (the synthetic
batch-parent work), and `_prodLoadBriefs({silent:true})` is scheduled 6500 ms
into the load — comfortably inside the window this block sits in, since the
`comments_state` wait above it allows 15 s. A projection that reclassifies or
filters the parent row would make `_prodIssue(d.parent)` start returning null on
a later paint, which is `gone_parent_unresolved`. If the answer comes back as
one of the other four, that story is wrong and should be discarded rather than
patched.

Worth noting for whoever picks this up: `waitForSelector` only needs the element
VISIBLE, while `locator.click()` also needs it STABLE — the same bounding box
across two consecutive frames. A page that never stops repainting passes every
`waitForSelector` in the suite and hangs on the first click. That asymmetry fits
the observed pattern exactly and is where to look first, but it is a lead, not
a finding: the split markers decide it.


### 88a. Two heavy-lane assertions were broken silently and are repaired here

Removing `data-prod-ctx` from the disabled bulk `Move to project...` row (PR
#1183) took it out of the palette's search and highlight index. Two lanes assert
the full six-label list through that selector —
`behav-wired.js:1780` and `prod-review-packet-validate.js:148` — and both run
only on `production-polish-heavy`, which is **skipped** on most PRs. So they
went red on main without anyone seeing it.

The refused rows now KEEP `data-prod-ctx` and are refused in `activate()` and
`hi()` instead, which repairs both lanes and fixes the real user-facing bug the
first version introduced: typing in the palette search hid every row around the
disabled one and left it on screen, unexplained.

**The lesson worth keeping:** a selector-level change to a disabled control is
not cosmetic. Check `docs/syncview-design/tests/` for the selector before
changing what a control carries, including on lanes that do not run on your PR.


---

## 89. [2026-08-31] ONE owner decision now unblocks three fixed items: what does a person DO about a card with no work item?

Three sweep findings were the same defect wearing different clothes — a refusal
that named a remedy the flip had deleted:

- **87.14** `native_link_required` said *"Reload before trying again"*, on a
  refusal the code's own comment called permanent.
- **87.8 / 87.16** the locked status pill said *"Link a Linear sub-issue
  first"*, naming a control that renders as the empty string post-flip.

All three now state the problem and **name no remedy**, which is honest and
incomplete. It is honest because there genuinely is no in-app path: Production
creation is closed for everyone, the link paste is sealed, `_calOpenNativePost`
is reachable only from the two Add-card paths, and Import from Linear only
manufactures more of these rows. Inventing a remedy would have reproduced the
exact defect being fixed.

**The decision needed is one sentence: who does a person go to, and how.** It is
the owner's because it is an operational routing choice, not a wording one.

**Scale, measured live 2026-08-31 (cards not archived):**

| shape | count |
|---|---|
| Linear video link, no deliverable id | 111 (36 still in flight) |
| Linear graphics link, no deliverable id | 149 |
| fully unlinked video component | 66 |
| fully unlinked graphic component | 36 |

The first two hit `native_link_required` on any status write; the last two carry
the locked pill. Overlapping, but the order of magnitude is a few hundred cards
and the in-flight 36 are the ones someone is actually trying to move.

Once the sentence exists it is a one-line change in two places:
`WRITE_UI_NO_WORK_ITEM_TEXT` and `CODE_TEXT.native_link_required`.


---

## 90. [found by the round-3 tester 2026-08-31, FIXED same night — PR #1187] The batch-parent detail view hard-froze the tab, and it had been red in CI for a day without anyone reading it as the same thing

`_prodRender` calls `_prodEnsureLabels` on every render. The synthetic
batch-parent branch — shipped that morning in #1183 to stop that control
claiming a transient read failure — sat **above** the shared memo guard and
called `_prodRefreshLabelSurfaces` unconditionally. That calls `_prodRender`,
which calls `_prodEnsureLabels`, which re-entered the same branch. Infinite
synchronous recursion, no termination check.

100% reproducible on two independent batches, cold load and same-tab navigation
alike. It took the parent asset panel and the file pills down with it, so the
entire asset spec was untestable — and the owner hit it live on two browsers
before the fix landed.

**The fix is a memo check INSIDE the branch**, not a move below the shared one.
Below it sit the writes check and the staff-identity read, and a synthetic
parent must reach neither: it has no deliverable row to write to and no identity
question to ask. Repainting once when the state first settles is what replaces
"Loading labels…" with "No labels"; repainting when it is already settled was
the defect. `test/batch-parent-labels-terminate.js` executes the real recursion
edge rather than reading source, so removing the guard fails loudly.

**What this cost, and the honest accounting.** Item 88 spent a night narrowing
the same defect through the CI lane, four rounds, without reaching it. The
narrowing was sound and the instrumentation is worth keeping — but a tester
opening the screen found it in one session. See the note in 88b.

## 91. [found by the round-3 tester 2026-08-31, FIXED same night — PR #1187, MIGRATION REQUIRED] Raw footage and Frame folder could not be saved by anyone, on any post

The tester replayed the write and read the raw response rather than trusting the
UI message: `entity_scope_unavailable`. `batches.team` is not reliably
populated — **303 of 1,644 batches** carry a null team, including one created
ninety seconds before the test, so this is not stale data.

Both halves refused independently, which is why a gateway-only fix would have
looked correct and changed nothing:

- `handleBatchAssetWrite` read `batches.team` for its permission check;
- `production_batch_asset_write` passes it to `production_assert_authority`,
  whose first act is `if p_team is null … raise 'authority_unavailable'`.

Both now derive the team from the batch's own deliverables when the column is
empty. Not a guess: a batch's team is the team of the work in it. **Not written
back**, deliberately — repairing the column belongs to intake, and guessing one
in on a read path is how a wrong value becomes permanent. With no deliverables
either, the refusal stands.

**Still open: the intake gap itself.** Some creation paths set `batches.team`
and some do not. This makes the product work without pretending the data is
fixed, and the 303 rows are still wrong.

## 92. [found by the round-3 tester 2026-08-31, FIXED same night — PR #1187] Create Post was completely broken by a cache nobody bounded

`_kasperFetchAllRelevantPosts` walks EVERY allowed client and wrote one calendar
payload per client under `syncview_kasper_cal_<slug>_v1`, never evicted. The
store grew with the roster and never shrank: 34 of them plus a 4.6MB cache
reached Chrome's ~10MB per-origin ceiling, at which point `setItem` throws and
the native intake write that stages a new post fails.

Round 1 saw the same pressure as a harmless console warning. It escalated to
blocking a core write path because nothing was bounded.

Two bounds, because either alone leaves a hole: **age** clears what the reader
would refuse anyway, **count** is what actually caps growth (age alone bounds
nothing when the roster exceeds the cap and every entry is fresh — exactly what
a full sweep produces). A write that still fails drops its own stale entry
rather than leaving the store full.

`native_intake_storage_unavailable` also had **no branch** in the error mapper
and fell through to the generic safe-to-retry text — which it was not, failing
identically forever. It now says the store is full and that retrying will not
help.
