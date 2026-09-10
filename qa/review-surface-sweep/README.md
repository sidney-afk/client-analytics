# Review-surface fault sweep

## Why

OPEN_REPAIRS 186/189 found one shape: a review action writes TWO legs (the
gateway's deliverable row, then the `calendar_posts` row humans read), and when
the second leg is abandoned the screen and the server disagree with nobody able
to tell. That was found on ONE action, by one client noticing. This asks the
same question of every review action on every surface it can reach.

## How to run

```
npm install
node qa/review-surface-sweep/probe.js     # ~35 headless runs, a few minutes
```

Two questions per combination, answered mechanically:

- **AGREE** — do the server and the source row end up saying the same thing?
- **TRUTHFUL** — is what the person is left looking at true? An optimistic card
  counts as truthful only if the work committed, or is visibly owed (an error
  shown, or a repair armed to finish it).

A run can agree and still lie, and can disagree honestly. Both are scored.

## STATUS: INSTRUMENT ONLY. THE COUNTS ARE NOT TRUSTWORTHY.

Do not quote a number from this probe. After eight review rounds and fourteen
findings, the eighth round showed the count is wrong in **both directions at the
same time**:

- **Over-reporting.** `client / request-change / never-sent` is a harness
  artifact. This boots a STAFF session, so `_isClientLink` is false; a real
  client link gets `repair = null` for comments (`index.html` ~33102), while
  this run creates a staff repair journal whose resume reissues the never-sent
  comment. A real client produces no resumed commit there at all.
- **Under-reporting.** The pre-resume window metric compares only component
  status, so it misses the comment splits entirely: six published where this
  same mock demonstrates ten.
- And a companion check has a presence guard that skips the exact missing-field
  case it claims to cover.

Being wrong in both directions simultaneously is the signal that this needs
rebuilding around a different measurement model, not another patch. Stopping
here was a pre-committed rule, stated on the PR before this round ran.

## The one finding that stands on evidence OUTSIDE this harness

**A client approve loses the sign-off stamp.** The status recovers to
`Approved`; `client_video_approved_at` is never written. The no-fault control
writes it correctly.

This one survives the harness being untrustworthy because **the live production
row agrees**: OPEN_REPAIRS 186's card ended at `video_status = Approved` with
`client_video_approved_at = null`, recorded at the time as unexplained. Two
independent sources, one of them production data. The record says the work was
approved but not that the CLIENT approved it, on a product whose service is
client sign-off.

## The second finding is UNCONFIRMED

**A change request may commit on the server and never reach the card.** The
mechanism is plausible and the mock demonstrates it, but at least one of the six
rows is the staff-only artifact above, and the count is unreliable in both
directions. It needs a real tokened client-link boot before anyone acts on it.

## What a rebuild needs, so the next attempt does not repeat this

1. **A real tokened client context**, not a staff boot relying on
   `_calReviewMode()` returning `client`. The client-link branches
   (`repair = null` for comments, the `_isClientLink` status gate) materially
   change the recovery contract, and inferring client behaviour from a staff
   session is what produced the artifact.
2. **One measurement model applied uniformly**: every field an action writes,
   compared at BOTH checkpoints (settled, and after resume), for status and
   comments alike. The bugs here came from checking different things at
   different checkpoints and gating some checks and not others.
3. **A no-resume lane**, so "would anything have finished this" stops being an
   inference.

## What it does not cover, stated so nobody reads more into it

- A REAL tokened client link. `_calReviewMode()` returns `client` for any view
  that is not `smmreview`, so the client BRANCH is exercised from a staff boot,
  but the `_isClientLink` gates are not.
- Kasper's own surface (`_kasperState`) and the Samples (`sxr`) surface. Both
  carry their own copies of this two-leg shape and are untested here.
- The video component only, and one card at a time. No concurrency between two
  people acting on the same card.

## Fourteen harness bugs found while building it, all recorded

**EVERY published result from this probe has been wrong**, across eight review
rounds: 6 flagged, then 11, then 0, then 11, then 3, then 9. Two of those tables
also carried a WRONG CONCLUSION ("requesting a change is sound"), not just a
wrong count. All fourteen bugs were found by review; none by the author. Most of the
bugs produced FALSE CLEANS. That history is kept here deliberately, because a
number from this file is only worth what the scorer behind it is worth.

Both produced FALSE CLEAN results, which is the failure mode that matters in a
test:

1. Drafts were written to `window._calReviewState`, which is a different object
   from the script-scope binding the app reads. Every comment and change-request
   row reported a clean result for an action that never ran. The control run now
   fails loudly if it wrote nothing anywhere.
2. The scorer compared the gateway's `tweak` against the card's `Tweaks Needed`
   with a naive underscore swap and flagged sound behaviour as a disagreement.
   It now uses the app's own vocabulary mapping.
3. The upsert mock recorded the SUBMITTED post before returning its mocked 500,
   so every `source-write-rejected` row scored as though the row held a status
   it had merely been asked to hold. That turned five real disagreements into
   clean passes, and the first published version of the table above was wrong
   because of it. Attempted and persisted state are now separate, and only a
   2xx moves the persisted one.
4. A run that threw became a result row that the summary then excluded, so a
   sweep where every single run failed to boot could print
   `35 combinations, flagged: 0` and read as a clean bill of health. Harness
   errors are now fatal, and per-run cleanup moved into `finally` so a thrown
   run cannot leave the browser and HTTP server open holding node alive. The
   same treatment applies to a control run that writes nothing anywhere.
5. **Recoverability was INFERRED from a flag instead of measured**, and that
   produced the wrong headline. `_writeUiRetrySourceAt` is absent on an
   ambiguous gateway failure only because the source-save phase never began,
   while `_writeUiGatewayWithRepair` has already persisted an attempted repair
   journal BEFORE transport, which a later resume reconciles. Reading the flag
   therefore labelled every journal-backed case STUCK when none of them are.
   The probe now ends the outage, runs the real resume, and classifies on what
   actually lands.

6. **Receipts always answered `absent`**, including for faults where the mock
   had already recorded the commit. The real gateway answers `committed_exact`
   when the durable outbox receipt exists, and the browser takes a materially
   different recovery branch for each. Every ambiguous committed write was
   therefore recovering down the wrong path, and the 35/35 that produced was
   measuring something other than what it claimed. Receipts are now keyed by
   request id.
7. **A handler that threw, or an async page error, did not fail the run.** Only
   outer harness exceptions were fatal, so product-code crashes could still
   print a clean sweep. Both signals are now failure criteria.
8. **The scorer read only `video_status`**, so a recovery that saved the status
   and dropped the overall status or the sign-off stamp scored as full
   agreement. It now scores the whole projection the action carries. THIS IS
   THE BUG THAT WAS HIDING THE ONE REAL FINDING ABOVE.
9. **Then it over-flagged in the other direction**: companion fields were
   demanded even where nothing was expected to persist, turning honest failures
   into flags. Companion checks now apply only where the write was expected to
   land.
10. **The summary filtered on a field the scorer no longer emitted**, so once
    anything WAS flagged it would have printed every failure as permanently
    stuck regardless of the measured recovery.

11. **The empty-row gate hid six real disagreements.** Skipping the thread check
    whenever no source write landed suppressed exactly the case the sweep exists
    to find: a change request that commits server-side and writes nothing to the
    card. A committed comment is a fact about the SERVER and must be compared
    whether or not any source patch landed. This is what took the count from 3
    to 9 and overturned the "request-change is sound" conclusion.

12. **The staff boot cannot stand in for a client link.** A real client link
    gets `repair = null` for comments while this creates a staff repair journal,
    so at least one published client finding is an artifact of the harness.
13. **The pre-resume window metric compared only component status**, missing the
    comment splits: six published where the same mock demonstrates ten.
14. **The overall-status companion check has a presence guard** that skips the
    exact missing-field case it claims to cover.
