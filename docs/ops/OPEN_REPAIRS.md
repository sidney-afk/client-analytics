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

## 3. [owner-click] VID-13261 / VID-13262 — re-read the outage window (no decision needed)

RESOLVED AS A NON-QUESTION on 2026-08-08. The "one card, two videos" framing
was wrong twice over: the Pt2 sub-issues were created by the SMM (not the
graphics designer), each already linked to ITS OWN calendar card
(`p_mrmzoec4_tev`, `p_mrmzofde_n36`), and both are properly nested under their
batch parents in Linear. The card-slot conflict that withheld them was debris
of the 2026-08-07 outage window — measured 2026-08-08: both cards' video slots
are EMPTY, so nothing conflicts anymore. The issues simply postdate the
incremental cursor and will not re-import on their own.

One click closes it: dispatch "B1 incremental refresh"
(b1-linear-incremental-refresh.yml → Run workflow) with
`changed_since = 2026-08-07T15:00:00Z`. That re-reads the whole outage window
— no Linear edits, no decisions. Done when both issues appear in SyncView.

## 4. [owner-click] client-review-link: dispatch the new deploy lane

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

One click closes it: merge the PR carrying the lane, then Actions →
"Deploy client-review-link" → Run workflow with main's head SHA → approve the
environment prompt. Done when the run is green (readback PASS is inside it).

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

## 11. [watch] The #1041 failing-lane page has never actually fired

Its logic is fully unit-tested, but no live page has traversed
watchdog → relay → Slack yet. It will prove itself the first time any lane
writes `ok:false` (item 6 guarantees candidates at the next nightly runs). If
the nightlies go red tomorrow and NO page arrives, the relay leg is broken and
that is a monitoring P0.
