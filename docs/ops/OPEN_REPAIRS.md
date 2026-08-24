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

## 27. [owner] Two of a live client's thumbnails are invisible — attribution is invalidated and never re-derived

Found 2026-08-22 while chasing item 23, which turned out to be one instance of a
general defect.

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

- **STILL AN OWNER DECISION: whether the nudge should ever reload by itself.**
  The owner chose "tell them + auto-reload when idle" on 2026-08-24 — but chose
  it believing no nudge existed. The "tell them" half has shipped since July.
  The other half contradicts that feature's explicit, tested decision, *"It
  NEVER force-reloads — an SMM could be mid-edit"*, which `test/app-update-nudge.js`
  asserts.
  Not built, deliberately. Reloading somebody's tab can cost them work, the
  decision against it was made on purpose and written down, and reversing it
  needs the owner to say so knowing the nudge is already there. If it is
  wanted, the safe shape is narrow: only once the bar has been shown, only
  while `document.hidden`, and only after a grace period — a hidden tab is the
  one moment nobody is typing.

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
