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

## 1. [repair] ~52 batches with `linear_parent_ids = null`

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

## 2. [repair] `bat_fd246364-0bca-49eb-8947-1f70cbb2b030` — roccopiazza, 2026-08-07T15:30:06Z

The wave-1 Create Post batch from the outage window. Diagnosed 2026-08-08:
**empty orphan** — `linear_parent_ids` null AND zero deliverables reference it
(`batch_id=eq.` returns nothing; the real child rows were re-imported under a
B1-minted batch after the by-hand Linear repair of VID-13263/13264). Nothing
operational reads it. Repair is cosmetic: archive the row, or leave it. Not a
soak or flip concern.

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

## 10. [repair] `scripts/write-ui-soak-pager.js` — retire or re-pin

The n8n pager transform was never applied and its pinned precondition
(versionId `16a436c6…`) no longer matches the live workflow (`ed76a77f…`), so
it refuses to apply — correctly. With #1041 the dead-man's switch now covers
both halves (stale + ran-and-failed) for the drill and shadow lanes through a
delivery-proven channel; the transform's six conditions are redundant except
for cosmetic threshold differences. Default: retire it (delete or mark
superseded) rather than re-pin and apply against a drifted production
workflow. Owner may overrule.

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

## 13. [repair] TEST-client ghost calendar cards — saves 404 `entity_not_found`

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

## 14. [repair] `artifact_not_resolvable` shows the wrong dialog — "reload the page" for a dead file link

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

## 16. [owner] Legacy batches carry a single-team Linear parent map

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

- Cheapest correct alternative, already live: let those batches age out. New
  batches (post deploy #12) carry a full map, so the population only shrinks.
- **Decide before the video flip.** Video-only maps are the majority, and the
  video flip removes the Linear-side path people currently use to work around
  them.
- Done when: an owner decision picks backfill / age-out / archive, and this
  entry links it.

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

## 23. [repair] `GRA-7112` is attributed to `unattributed`

Surfaced by the same census. Its status drift is cosmetic; the real defect is
that it carries no client mapping, so it appears in no client's view and its
status has no owner. Fixing the status would leave it unattributed anyway.

- Done when: the row is mapped to a real client or archived, and this entry says which.

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
