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

## Result, 2026-09-10: 35 combinations, 0 permanently broken, 1 real defect

**Every combination recovers**, once that browser comes back with connectivity
and `_writeUiResumeSourceRepairs` runs. The browser's repair machinery is sound
across every actor, action and fault tested here. An earlier version of this
file claimed six STUCK rows; that was wrong, and the mistake is recorded below.

What IS real, and measured:

| | measured |
|---|---|
| Does the card disagree with the server at the moment of the fault? | **Yes**, for an approve whose gateway answer is lost or answered 5xx after committing (`settledDisagreed`) |
| Does it recover on a later load in the same browser? | **Yes**, every time |
| Does it recover if that browser never comes back? | **No. Nothing else finishes it.** |

**So the defect is not that the repair is broken. It is that the repair lives in
the wrong place.** It runs only in the browser that made the write, only if that
browser returns online. Someone who meets an error and closes the tab (which is
what people do) leaves a card that disagrees with the server, and the calendar
row is what *everyone else* reads in the meantime. That is exactly what happened
in OPEN_REPAIRS 186: the client's card stayed stale until an unrelated staff
browser happened to project the canonical status back, fourteen minutes later.

This is a stronger argument for the server-side reconciler than the earlier
wrong reading was, not a weaker one: the logic does not need inventing, it needs
relocating somewhere that does not depend on one person's tab.

**Two things it rules out**, which is as useful as what it found:

- *A plain comment never reaches the gateway on this path at all* -- it writes
  the card's tweaks column only, so the dual-write class does not apply.
- *A request that never left the browser is honest everywhere.* Nothing moves on
  either side and the failure is visible.

## What it does not cover, stated so nobody reads more into it

- A REAL tokened client link. `_calReviewMode()` returns `client` for any view
  that is not `smmreview`, so the client BRANCH is exercised from a staff boot,
  but the `_isClientLink` gates are not.
- Kasper's own surface (`_kasperState`) and the Samples (`sxr`) surface. Both
  carry their own copies of this two-leg shape and are untested here.
- The video component only, and one card at a time. No concurrency between two
  people acting on the same card.

## Five harness bugs found while building it, all recorded

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
