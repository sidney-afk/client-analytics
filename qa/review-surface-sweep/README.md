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

## Result, 2026-09-10: 35 combinations, 3 flagged, and a new finding

### The new finding: recovery restores the status and LOSES the client's sign-off

A client approve that hits any of the three faults recovers its status to
`Approved` and never writes `client_video_approved_at`. The control run with no
fault writes it correctly, so this is the recovery path dropping it, not the
action failing to produce it.

| client / approve | source row after recovery | sign-off stamp |
|---|---|---|
| no fault (control) | `Approved` | **present** |
| gateway answer lost | `Approved` | **missing** |
| 5xx after commit | `Approved` | **missing** |
| source write rejected | `Approved` | **missing** |

**This corroborates the live incident independently.** The production row in
OPEN_REPAIRS 186 ended at `video_status = Approved` with
`client_video_approved_at = null`, which was noted at the time as unexplained.
It now has a mechanism and a reproduction. The consequence is worth stating in
business terms: the record ends up saying the work was approved, but not that
the CLIENT approved it. For an agency whose product is client sign-off, that is
the record that matters.

### The window, and what it is honest to conclude from it

Six combinations disagree at the moment of the fault, before any recovery runs:
an approve whose gateway answer is lost or answered 5xx after committing, on the
client's approve and BOTH SMM routes. During that window the server says one
thing and the `calendar_posts` row everyone else reads says another.

**What this harness does NOT establish:** that nothing would have finished the
row. It runs ONE browser and always restores connectivity before resuming. That
no other browser or background projector would have completed it is an inference
from there being no server-side projector, NOT a measurement here. The README
previously stated it as measured; that was an overstatement.

### Two things it rules out

- A plain comment never reaches the gateway on this path at all: it writes the
  card's tweaks column only, so the dual-write class does not apply.
- A request that never left the browser is honest everywhere: nothing moves on
  either side, and the failure is visible.

## What it does not cover, stated so nobody reads more into it

- A REAL tokened client link. `_calReviewMode()` returns `client` for any view
  that is not `smmreview`, so the client BRANCH is exercised from a staff boot,
  but the `_isClientLink` gates are not.
- Kasper's own surface (`_kasperState`) and the Samples (`sxr`) surface. Both
  carry their own copies of this two-leg shape and are untested here.
- The video component only, and one card at a time. No concurrency between two
  people acting on the same card.

## Ten harness bugs found while building it, all recorded

**Every published result from this probe was wrong until this one**, across six
review rounds: 6 flagged, then 11, then 0, then 11 again, now 3. Most of the
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
