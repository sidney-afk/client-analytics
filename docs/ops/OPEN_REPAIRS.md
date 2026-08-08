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

## 3. [owner] VID-13261 / VID-13262 — can one card hold two videos?

Both Pt2 issues are withheld by `withholdCardSlotConflicts`
(`scripts/b1-linear-backfill.js` — the card's video slot is held by the Pt1
issue; one video + one graphic slot per card by unique index). This is the
importer refusing to guess an ownership question. Withholding repeats every
incremental run and is REPORTED in each run summary (`card_slot_conflicts`), so
it is visible, but only an owner call resolves it:

- **Split**: give Pt2 its own card → both ingest.
- **Replace**: point the card slot at Pt2 → Pt1 unlinks.
- **Schema change**: allow N videos per card → real design work, not a tweak.

Done when: the owner picks one and the two issues ingest (or are archived).

## 4. [owner] client-review-link: merged fix (#1016) never deployed

Live is the 2026-07-15 v2; main has carried the mint-on-demand token fix since
2026-08-03. Verified blast radius 2026-08-08: one active client (lukecutting)
plus every future onboard hits the "Share with client" dead-end until this
deploys. It is in the deliberate-manual lane (`docs/ops/EF_DEPLOY_MANIFEST.md`)
so no workflow will ever ship it. The fix only MINTS missing tokens — it never
rotates one, so it cannot 401 an existing link (the F35 rule is untouched).
Waiting on an explicit owner yes to a manual deploy + fingerprint readback.

## 5. [watch] Shadow audit: first meaningful verdict after re-classification

The lane had NEVER passed (0 green in its entire history; ~4,100 "unexpected"
divergences daily since 2026-07-24). Diagnosis 2026-08-08: its classifier
predates the attribution stamps, so the entire `attribution_stamp_absent`
class — historical rows written before stamps existed, the same family the
reconciler deliberately reports as non-gating — landed in "unexpected".
Re-classified (this PR): absent stamps are expected-explainable;
`attribution_claim_mismatch` (a WRONG stamp) stays red; the telemetry event now
carries per-reason maps.

- Watch: the first post-merge 05:17 UTC run. Expected: unexpected_divergences
  collapses from ~4,100 to (mismatches + the 34 unexpected intents), and the
  by-reason map names whatever remains. If the residue is nonzero, THAT is the
  real signal this lane existed to send — investigate before the flip.
- The lane's heartbeat (added #1039) also proves here: first
  `production_shadow_audit` heartbeat row should appear after the same run.

## 6. [watch] Nightly E2E lanes: samples red 26 nights, calendar 16

samples-e2e-nightly first red: run #10, 2026-07-13. calendar-e2e-nightly first
red: run #34, 2026-07-23. Both carry a "page on scheduled failure" webhook step
that has delivered zero pages across all 42 failures (secret absent → the step
degrades to a log warning). Both are now dead-man's-switch lanes (this PR), so
the next watchdog pass after their next scheduled runs pages `ran and failed`
once and latches. Triage starts from the FIRST red run of each streak, not the
latest. Until triaged, treat both suites' coverage as absent, not as failing.

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

## 8. [owner] Soak policy: do mid-soak deploys reset the clock?

Wave-1 soak started 2026-08-07T15:17Z (target 4–5 clean days → ends
2026-08-11/12). Two production deploys (v38, v33) happened inside the window on
day 0. The project's rules are silent on whether that resets or merely
annotates the clock. One owner sentence settles it; record the answer in
`docs/independence/GRAPHICS_FLIP_STATUS.md` and EXECUTION_LOG.

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

## 11. [watch] The #1041 failing-lane page has never actually fired

Its logic is fully unit-tested, but no live page has traversed
watchdog → relay → Slack yet. It will prove itself the first time any lane
writes `ok:false` (item 6 guarantees candidates at the next nightly runs). If
the nightlies go red tomorrow and NO page arrives, the relay leg is broken and
that is a monitoring P0.
