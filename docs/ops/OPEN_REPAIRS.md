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

## 3. [owner-click] VID-13261 absent + three stale card pointers (one client)

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

Two independent halves:

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

Also unresolved and load-bearing: the two vocabularies differ (13 deliverable
statuses vs 8 calendar / 6 samples), five have no card equivalent, and the
owner has not yet ratified what happens to them.

Next step is a design round 2 that answers all 21, not an implementation.

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

## 6. [watch] Nightly E2E lanes: samples red 26 nights, calendar 16

samples-e2e-nightly first red: run #10, 2026-07-13. calendar-e2e-nightly first
red: run #34, 2026-07-23. Both carry a "page on scheduled failure" webhook step
that has delivered zero pages across all 42 failures (secret absent → the step
degrades to a log warning). Both are now dead-man's-switch lanes (this PR), so
the next watchdog pass after their next scheduled runs pages `ran and failed`
once and latches. Triage starts from the FIRST red run of each streak, not the
latest. Until triaged, treat both suites' coverage as absent, not as failing.

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

## 9. [owner] Flip staging: the machine gates are currently unsatisfiable

`FLIP_RUNBOOK.md` requires, before F2: the production Environment holding
`GRAPHICS_F2_READONLY_DATABASE_URL` (+ two more secrets), the one-time
evidence-role ACL revoke, and a literal `GO graphics_f2_preflight` receipt.
None exist yet and nobody is named to stage them. This is days of lead time,
not minutes — schedule it before the soak ends, not after.

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
