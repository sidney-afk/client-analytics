# Pull request checks: what runs, why, and when

Session Pitstop, 2026-10-19. The owner asked: "do we even need those checks? which checks do we need?"
This is the audit and what changed. Companion docs: `docs/ops/CI_SPEED.md` (how the jobs were split and
seated), `docs/ops/CI_GATE_AUDIT.md` (why main and pull requests trigger the way they do).

## What was slow

Two small pull requests (#2238, #2241) waited over four hours for the Calendar unit tests. The cause was one job
added that morning in #2237, the **Gauntlet Three** (`review-gauntlet-three`): three browser engines by three
widths, nine legs of 11 to 23 minutes, run one at a time (`max-parallel: 1`) on **one seat shared by every open
pull request**. Measured on #2238 (run 39274652292): the nine legs added up to 140 minutes of seat time for that
one pull request, so each further open pull request waited about 2 h 20 min more. Everything else in that run
finished within about 25 minutes. The second hot spot was guards seat 1, which carried browser-guards part 1,
the review phones and the repair checkpoint: about 24 minutes per pull request, measured waits of 33 to 39 min.

## Every check a pull request can run

Minutes are the job's own run time from Actions (main run 39262592453 and the pull request runs of #2234, #2237,
#2238, #2241), not queue time. "Seat" is the shared pull-request runner seat (14 in all, `test/ci-runner-seats.js`).

| Check | Protects | When it runs on a pull request (after this change) | Min | Decision |
|---|---|---|---|---|
| changes | Decides what the change can break (`scripts/ci-changes.js`) | Always | 0.6 | Keep: it is what makes everything else skippable |
| unit (3 parts, seats unit-1..3) | 764 offline unit suites, disposable Postgres | Always | 3 to 6 | Keep on every PR: cheap, catches most breakage |
| identity-exposure | No client slug or staff name lands in this public repo | Always | 0.8 | Keep on every PR: the repo is public; cannot run after the fact |
| module-check | The page fragments still load in order | Always | 0.8 | Keep on every PR: one minute |
| f27-team-rollback-proof (job) | F27 rollback proof, skips itself when its source is gone | Always | 0.5 | Keep: under a minute |
| entry-links-boot (3 parts) | Every entry link boots the right screen | Page or browser plumbing changed | 6 to 7 | Keep, area-gated (already) |
| browser-guards (2 parts) | Desktop dialogs, keys, uploads and similar guards | Page or browser plumbing changed | 6 to 9 | Keep, area-gated (already) |
| split-preview (2 parts) | The split build still works before it is switched on | Page or browser plumbing changed | 3 to 4 | Keep, area-gated (already) |
| staff-phone-rules (2 widths x 2 parts) | Staff phone screens | Staff phone files, page code or a file a phone suite reads | 8 | Keep, area-gated (already) |
| repair-checkpoint (seat guards-1) | Checkpoint ownership on three engines | Page or browser plumbing changed | 2.4 | Keep, area-gated |
| **review-stage-phones** (now seat guards-2) | Client and staff review on iPhone and Android | **Review page changed** (was: any page change) | 12 to 14 | **Reduced to review PRs; always on main.** Moved to the lighter guards seat |
| **review-gauntlet-pr** (new, seat guards-1) | Gauntlet Three on chromium at 1440: both roles and the YouTube title, every condition | **Review page changed** | about 6 to 7 (estimate) | **New reduced PR form.** Its three halves run side by side |
| **review-gauntlet-three** (9 legs) | Same checks on chromium, firefox and webkit at 1024, 1440, 1920 | **Never on a PR; every push to main** (3 legs at a time) | 11 to 23 per leg | **Moved after merge.** It fails main's run (see the open decision below) |
| calendar-ci-result | Sums the run up; the one required check | Always | 0 | Keep, unchanged |
| Production polish gate, fast lane | Production tab against the live backend | `src/index/**`, build, `docs/syncview-design/**` | 10 | Keep, already path-gated. Its heavy lanes already run only after merge |
| Pages site | The published site builds and its allowlist holds | Page files and site assets | 3 to 4.5 | Keep, path-gated, runs in parallel |
| PTO UI browser checks | Time-off screens | Page, PTO function and migrations | 2 to 3 | Keep, path-gated |
| Client entry visible boot | Client link paints something on first load | Page, boot and token-verify | 1 to 2 | Keep, path-gated |
| Linear exit isolated preparation | Linear-exit rehearsal stays green | Scripts, tests, functions, migrations | 1.5 to 2 | Keep, path-gated, parallel, short |
| Edge Function type ratchet | Deno type errors do not grow | `supabase/functions/**` | 2 | Keep, path-gated |
| TikTok carousel browser journey | TikTok carousel flow | Page and its own suite | 1 | Keep, path-gated |
| f27 / f42 / graphics-f2 workflows | Specific migrations and scripts | Only their named files | 1 to 3 | Keep, rarely run |

Nothing was dropped: no check is a duplicate of another. Two checks moved from "every page pull request" to
"review-page pull requests", and the eight Gauntlet legs that are not chromium 1440 moved to "every push to main".
Coverage after merge is unchanged: main still runs every suite in full.

**Open owner decision: who hears about a red main run.** Checks moved after merge show up as a red Calendar run on main
and GitHub's failed-run e-mail to whoever merged; nothing pages. A new notification needs the owner's go (AGENTS.md),
so none was added. Options: a Slack post from `calendar-ci-result` on a red push, or a line in the combined problem message.

**What counts as a review-page change** (`review` in `scripts/ci-changes.js`), failing safe: any page file that is
not a JavaScript part (styles, head, boot, shell, manifest); any JavaScript part the review, notes or comment parts
import, directly or through another part (the `import` lines of `src/index`, 52 of 66 parts today); any file whose
name says review, notes or comment under `src/`, `test/`, `qa/`, `docs/syncview-design/` or `supabase/functions/`;
any file the review suites read; or the build and shared browser plumbing. Only parts nothing on the review page
reaches skip it: Workload (067, 069, 071, 072, 080, 090), templates (060), quick jump, the staff phone shell and
bar, archive restore, Instagram and TikTok upload, the date picker. A doc never counts.

**Why chromium at 1440 for the pull request form:** 1440 is the width the review page is used at most, chromium is
the engine every other browser job already runs (so its install is the cheapest), and the single leg runs every
role, condition and the YouTube title, so a pull request still exercises the whole review flow. Firefox and webkit
differences, and the 1024 and 1920 layouts, are caught on main within about an hour of the merge.

## Before and after

| Kind of pull request | Before (measured) | After (estimate, no other PR queued) | After, one other PR ahead |
|---|---|---|---|
| Docs only | about 2 min | about 2 min | about 2 min |
| One area, not the review page (e.g. Workload only) | 2 h to 4 h+ (the Gauntlet's 140 min of seat time, queued behind other PRs) | about 12 to 15 min (slowest: guards seat 1 at about 11 min, polish gate 10) | about 20 to 25 min |
| Review page (e.g. #2237) | same, 2 h 20 min of Gauntlet seat time alone | about 20 min (guards seats at about 18 to 20 min) | about 35 to 40 min |
| Push to main | about 2 h 20 min (Gauntlet one leg at a time) | about 55 to 60 min (three legs at a time) | n/a |

The review form's 6 to 7 minutes is an estimate: a chromium 1440 leg took 11.4 to 12.4 min with its two halves one
after another; the first runs on the pull request will measure it. If the three halves side by side prove flaky on
the 4-CPU runner, change `--lanes=3` to `--lanes=2` in `review-gauntlet-pr`.

## How to change this

- A check is added as a line in a lane step (`scripts/ci-lanes.js`), not as a new job.
- The seat rules, the Gauntlet split and the main-run alert are pinned by `test/ci-runner-seats.js`; what a pull
  request needs is pinned by `test/ci-changes.js`.
