---
name: night-shift
description: The house protocol for UNATTENDED work under usage limits - overnight loops, long autonomous runs, and fleets of parallel sessions sharing one usage pool. Use when the owner asks for all-night/unattended work, when planning a run that outlives a 5-hour usage window, when several sessions will run concurrently, or when a session hits a usage/rate error mid-run. Core law - a usage cap is a PAUSE, never a failure - and work must be sliced so that every completed unit is already pushed before the pause can happen. Encodes checkpoint discipline, the usage-window clock, the sleep-across-the-reset pattern, and the honest partial-report rule. Pairs with /loop-style wakeups and the overnight-test/site-assurance skills (they do the testing; this governs their survival).
---

# Night-shift — unattended work that survives the usage clock

Why this exists (owner, 2026-07-18): multiple sessions run overnight on one shared
usage pool; when the pool empties, unprepared sessions stall silently and work
held only in context is lost. The owner asked for this to be a standing skill so
it never needs to be re-explained.

## The three laws

1. **Every finished unit is pushed before you start the next one.** A unit is a
   commit on the session's branch, a PR update, or a written verdict — never
   "progress" living only in the context window. If the session dies this
   instant, the night's completed work must already be safe in git.
2. **A usage/rate error is a pause, not a failure.** Never conclude, apologize,
   or abandon on a limit error. Checkpoint whatever is clean, note the exact
   resume point in the last commit message or working notes, and resume after
   the reset (see the clock below). Report the gap honestly afterward — "paused
   HH:MM–HH:MM for the usage window" — never paper over it.
3. **Know the clock before starting.** The 5-hour window resets on a fixed
   schedule; the owner's usage panel shows percent-used and time-to-reset. Plan
   the night as: FRONT-LOAD the heaviest work while the pool is fresh, slice
   finer as the pool drains, and schedule the long sleep ACROSS the empty gap
   (scheduled trigger / send-later landing shortly after the reset) instead of
   burning wakeups into a wall of errors.

## For a session ABOUT to start unattended work

- Structure the run as cycles with the loop pattern: work → push → re-arm.
- Prefer scheduled triggers (send-later / wakeups) over continuous grinding:
  they survive the gap because the harness re-invokes AFTER the reset.
- State in the kickoff message what the resume point is, so a human (or the
  reviewer session) can restart the run with one sentence if all else fails.

## For a session that HIT the limit

Paste-able owner instruction (works mid-run in any session):

> You likely hit the shared usage limit — treat it as a pause, not a failure
> (night-shift skill, law 2). Checkpoint now: commit and push everything
> completed, note the exact resume point, then continue from that point. Do not
> restart from scratch and do not conclude the run.

## For the fleet (multiple concurrent sessions)

- The pool is SHARED: N sessions divide one budget. When commissioning several,
  stagger the heavy ones (testing fleets) away from each other, and give every
  commissioning prompt a resilience paragraph: *"Checkpoint every cycle as a
  pushed commit; on usage/rate errors treat it as a pause — checkpoint, wait for
  the reset, resume from the last checkpoint; report any pause honestly."*
- The reviewer session's sentry loop verifies pushed checkpoints as they land,
  so even a session that never wakes again has its completed work harvested.

## Output contract

A night-shift run ends with: everything pushed; a morning summary that separates
DONE (verified, pushed) / PAUSED (resume point named) / NOT REACHED; and zero
work products that exist only in a context window.
