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

## Result, 2026-09-10: 35 combinations, 6 flagged, ONE defect

| actor | action | lost answer / 5xx after commit | never sent | source write rejected |
|---|---|---|---|---|
| client | approve | **server and sheet disagree** | honest failure | agrees, error shown, repair armed |
| smm | approve (to Kasper) | **server and sheet disagree** | honest failure | agrees, error shown, repair armed |
| smm | approve (to client) | **server and sheet disagree** | honest failure | agrees, error shown, repair armed |
| both | request a change | agrees | honest failure | agrees, error shown, repair armed |
| both | comment | gateway not involved | gateway not involved | error shown |

**The one defect: an approve whose gateway answer is lost, or answered 5xx after
the commit, moves the server and leaves the card behind.** All six flags are
that. It is NOT client-only, which is the finding that matters: the same hole is
under the SMM's approve and under approve-and-route-to-client. A staff approval
can be recorded on the server while the calendar keeps showing the card as
awaiting review.

**Three things this rules out**, which is as useful as what it found:

- *Requesting a change is sound.* The status commits, the sheet follows, and a
  rejected source write shows an error and arms the repair.
- *A plain comment never reaches the gateway on this path at all* -- it writes
  the card's tweaks column only, so the whole dual-write class does not apply.
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

## Two harness bugs found while building it, both recorded

Both produced FALSE CLEAN results, which is the failure mode that matters in a
test:

1. Drafts were written to `window._calReviewState`, which is a different object
   from the script-scope binding the app reads. Every comment and change-request
   row reported a clean result for an action that never ran. The control run now
   fails loudly if it wrote nothing anywhere.
2. The scorer compared the gateway's `tweak` against the card's `Tweaks Needed`
   with a naive underscore swap and flagged sound behaviour as a disagreement.
   It now uses the app's own vocabulary mapping.
