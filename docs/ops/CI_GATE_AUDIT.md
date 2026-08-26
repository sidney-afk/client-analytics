# CI gate audit — 2026-08-26

Asked for by the owner: *"could you maybe do a kind of a check-up on if all of
those gates are necessary, like all of the check-ups, like the production polish
and such, are they good? Because I'm always having problems with those."*

Everything below is measured from run history and workflow source on
2026-08-26. Run numbers are cited so each claim can be re-checked.

---

## Short answer

The gates are not the problem. **Four structural defects** are, and three of
them produce a red mark that has nothing to do with the code in the pull
request. That is why the gates feel arbitrary: much of the time, they are.

| # | Defect | Effect the owner sees |
|---|--------|-----------------------|
| 1 | A pull request and `main` do not run the same checks | A green PR turns `main` red on merge |
| 2 | A red heavy lane cannot name what failed | Red, unowned, for days |
| 3 | Every commit on a branch runs the unit suite **twice** | Double cost, double chance of an infrastructure red |
| 4 | The heavy lane asserts 168 behaviours against the **live database** | Data changes can turn it red with no commit involved |

---

## Inventory — 34 workflows, four classes

**Class A — gates that can block a pull request (7).** These are the ones worth
arguing about, because they are the only ones that ever stop work.

| Workflow | Runs on | Verdict |
|---|---|---|
| `calendar-unit-tests.yml` | push `**` + PR | **Keep, fix trigger** (defect 3) |
| `production-polish-gate.yml` | PR (fast only), push `main` (all 3), schedule | **Keep, fix lane split** (defects 1, 2, 4) |
| `pto-ui-tests.yml` | push + PR | Keep |
| `client-entry-visible-boot.yml` | PR + push | Keep |
| `graphics-f2-evidence.yml` | PR | Keep |
| `f27-team-rollback-proof.yml` | PR | Keep |
| `f42-apply-rehearsal.yml` | PR | Keep |

**Class B — production automation on a schedule (9).** Not tests. These do
real work and must keep running: `b1-linear-incremental-refresh` (30 min),
`linear-deliverables-reconcile` (10 min), `sample-linear-reconcile` (10 min),
`thumbnail-revision-scan` (10 min), `monitoring-deadman` (15 min),
`linear-outbound-drain`, `track-b-backup` (6 h), `n8n-execution-quota-watchdog`,
`assurance-ledger-freshness` (daily).

**Class C — scheduled test runs (5).** `calendar-e2e-nightly` (08:00),
`samples-e2e-nightly` (06:00), `production-shadow-audit` (05:17),
`production-write-drill` (04:17), and the `production-polish-gate` weekday
09:17 schedule. These never block a pull request; they only produce mail.

**Class D — on-demand only, `workflow_dispatch` (13).** Deploys and drills.
They cost nothing and block nothing. **No action needed on any of them** — this
is where most of the 34 lives, and it is why the count looks worse than it is.

---

## Defect 1 — a pull request and `main` do not run the same checks

`production-polish-gate.yml` defines three jobs. Two carry:

```yaml
if: github.event_name != 'pull_request'
```

So a pull request runs **only** the fast lane. The interaction and heavy lanes
run on the push to `main` and on the weekday schedule — that is, **after the
merge**.

Evidence: PR #1152 was green and merged; run **#606** on the merge commit
`cbcc314a` failed, and so did **#607**, **#597**, **#593**, **#589**. **#585**
(2026-08-25 09:50) is the last green run on `main`. The most recent, **#609** on
`b3cde566` (the PR #1153 merge), is the same picture with the blame narrowed:
the fast and interaction lanes both passed and **only `production-polish-heavy`
failed** — so the lane that no pull request runs is the only lane that is red.

This is the whole "I merge and then it goes red" experience. Nothing about the
merge caused it; the checks that decide `main` had simply never run on the
branch.

**Fix:** run the heavy and interaction lanes on pull requests too. They are
15-minute jobs. The cost is CI minutes; the benefit is that the answer a pull
request gives is the answer `main` will give.

Blocked on defect 2: with the heavy lane currently red, turning it on for pull
requests would block every pull request. Cause first, then the trigger.

## Defect 2 — a red gate that cannot name what failed

Run **#607**, heavy lane, verbatim:

```
Production heavy gate failed at: Production wired behavior [unclassified].
```

`unclassified` means no entry in the gate's failure-signature table matched.
The suite's real output is deliberately runner-private (it renders live
customer text, F122), so a reader gets a suite name and nothing else. The
repo's own comments record that exactly this blackout left the gate red from
2026-07-23 to at least 2026-08-10 with nobody able to act.

The gap is specific and fixable. `behav-wired.js` ends with:

```js
console.error('behav-wired failures: ' + failed.map(([k, v]) => k + '=' + v).join(', '));
```

The **keys** are code identifiers — `boardColumnCollapse`, `noConsoleErrors`,
`detailPropertyGuard` — and carry no customer text. The **values** may. The
repo has already solved this shape twice (the Slice 5 drill codes and the
`PWG_PHASE_*` markers): emit a names-only line and match it against a
compile-time allowlist, so nothing from suite output is ever interpolated.

**Fix:** a names-only failure line from `behav-wired`, allowlisted in
`prod-polish-gate.js`. Then a red heavy lane names the check, and defect 1's
fix becomes safe to apply.

## Defect 3 — every commit on a branch runs the unit suite twice

`calendar-unit-tests.yml`:

```yaml
on:
  push:
    branches: ['**']
  pull_request:
```

A commit pushed to an open pull request's branch matches both. Measured on
`fc068d15`:

- run **#3499**, event `push` — **success**
- run **#3500**, event `pull_request`, *same commit* — **failure**

Two runs of the same suite on the same source, disagreeing. The duplication is
pure cost and doubles the exposure to defect 4.

**Fix:** `push: branches: [main]`. Pull requests keep their run; `main` keeps
its post-merge run; the duplicate disappears.

## Defect 4 — red without a test running

Run **#3500** above is worth looking at closely. Its two jobs never left
`queued` — `started_at` equals `created_at`, status `queued`, and the run's
conclusion is `failure`. **Not one test executed.** The red mark on that pull
request carried no information about the code at all.

There is no repo-side fix for a runner that never starts. There is a
process-side one: when a run fails with no job having run, re-run it rather
than reading it as a result. Defect 3's fix halves how often this is seen.

## Defect 5 — the heavy lane tests the live database

`behav-wired.js` describes itself as a *"guard-mode behavioral baseline for the
wired `?prod=1` tab … adapts the artifact behav.js assertions to **live B1
data**"* — 168 assertions, run against whatever the production estate contains
at that moment.

That is a deliberate and valuable design: it catches real breakage a fixture
cannot. But it has a consequence worth stating plainly, because it explains the
"random" reds: **a row changing status in Linear can turn this gate red with no
commit involved.** The weekday 09:17 schedule exists to run it against fresh
data, so it will keep finding data-shaped reds.

**Recommendation: keep it, but do not treat it as a merge gate** until defect 2
is fixed. A check that can go red for reasons outside the diff belongs on a
schedule with an owner, not in front of a merge — unless it can at least say
what it saw.

---

## Recommended order

1. **Names-only failure reporting for `behav-wired`** (defect 2). Small,
   self-contained, no behaviour change. Unblocks everything else.
2. **`push: branches: [main]` on `calendar-unit-tests.yml`** (defect 3). One
   line, halves unit-suite CI, removes a whole class of confusing red.
3. **Diagnose the actual heavy-lane failure**, now that it can name itself.
4. **Then** run heavy + interaction on pull requests (defect 1) — once they are
   green, so the change adds signal rather than a blockade.

Steps 1 and 2 are safe to do at any time. Steps 3 and 4 should wait until after
the video flip: turning a currently-red lane into a merge gate during a cutover
week is the wrong order, whatever its long-term value.

## What is NOT wrong

- The 13 `workflow_dispatch`-only workflows cost nothing and block nothing.
- The Class B schedules are production automation, not checks, and removing any
  of them would break real sync.
- The gates' *content* is sound. Every failure examined here was a structural or
  infrastructure fault, not a wrong assertion.

---

## Outcome — 2026-08-26, same day

**Defect 2 is fixed and it immediately paid for itself.** Run **#611** on `main`
(`847bc14a`), the first run carrying the names-only summary, printed:

```
Production heavy gate failed at: Production wired behavior [behav_wired:subRowNoSelect]
```

One check out of 168, instead of `unclassified`. The answer it gave: **the app
was right and the test was a day out of date.** `subRowNoSelect` asserted that
shift-clicking a sub-issue row selects nothing — true until 2026-08-25, when an
owner report made it a defect and `982f6ff2` ("Make sub-issue rows selectable")
deliberately routed the row through `_prodRowClick`.

That closes the loop on defect 1 with a concrete casualty. The lane went red on
the merge that carried `982f6ff2` (**#589**, 16:42Z) and stayed red for a day and
a half, because the lane never ran on the pull request that changed the
behaviour and could not name what it had caught when it finally did run.

**Defect 3 is fixed** — `calendar-unit-tests.yml` now takes `push` on `main`
only.

### One thing that is NOT a defect, recorded because it nearly became one

While driving PRs #1154–#1156 it looked as though a pull request opened through
the integration got no checks at all: the check-run list came back empty for
several minutes on two consecutive PRs, and the obvious inference was that only a
push to an already-open PR (`synchronize`) ever triggers them. That inference was
**wrong**. On #1156 the same list was empty at first and then held seven check
runs created at **17:16:35**, forty seconds after the PR was opened at
**17:16:00**.

The real behaviour is a delay of up to a few minutes between opening a pull
request and its checks appearing, made worse by the queue backlog this repository
sees at busy times. Anyone polling once and concluding "no CI ran" will reach the
same false finding. Poll again before believing it.

*This entry exists because the false version was one edit away from being written
into this document as "defect 5". A CI audit that invents a defect is worth less
than no audit — the whole value of this file is that every claim in it has a run
number behind it.*
