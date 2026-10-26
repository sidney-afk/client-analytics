# Hidden red timer runs on seven lanes, 12 to 26 Oct 2026 (session Underneath)

OPEN_REPAIRS 507. Follows 505 (Nightly) and 506 (Dawn).

From 12 Oct the schedule-fallback guard stood down whenever the database timer had already run a
lane, and GitHub showed the stand-down copy as green. #2339 and #2340 turned on
`mirror_timer_failure`, so a red timer run now shows a red schedule row. Dawn counted the red
timer runs on seven lanes it did not diagnose. This report reads every one of those runs
(`workflow_dispatch`, `(db-timer)`), finds the cause, and classifies it:

- **(a)** a real problem in the product or data;
- **(b)** a stale or broken check;
- **(c)** an outside service.

Counts only. No client names, slugs, card or work-item ids.

Ranked by what matters to the business:

| # | Lane | Reds | Cause | Class | Anyone affected | Now |
|---|---|---|---|---|---|---|
| 1 | track-b-backup | 7 + 1 cancelled | No backup for about 51 h (10 to 12 Oct); and the freshness step is growing toward the job's time limit | (a) | Backup gap 10 to 12 Oct, closed. No data lost. | The growth: fixed in #2342 |
| 2 | card-calendar-status-drift | 70 | Four cards disagreed with their Production work items, one at a time, 13 to 17 Oct | (a) | Yes: staff and one client's change request, for hours to a day each | Fixed by #2114 and #2140; none since 17 Oct 15:27 |
| 3 | sheets-mirror-daily | 9 (+1 manual) | The Sheet mirror of Clients Info and Social Media Managers fell behind the database twice | (a), minor | Nobody reads those tabs now | Red until one row is copied (owner or Lighthouse) |
| 4 | samples-e2e-nightly | 8 | Four causes: a stale client driver, a runner image, a unit lane time cap, one realtime probe | (b) and (c) | No | Green 24 and 26 Oct; cap fixed here |
| 5 | production-polish-gate | 5 + 1 cancelled | Racy suites, then the runner image | (b) and (c) | No | Fixed by #2094 and #2277; green since 22 Oct |
| 6 | assurance-ledger-freshness | 14 | Ledger rows claimed FRESH or NEAR past their dates | (b), a stale record | No | Restated here |
| 7 | thumbnail-revision-scan | 4 | One 5xx answer from the function host, recovered on the next 10-minute run | (c) | No | Recovered each time |

Dawn's counts start at 12 Oct 00:00. The backup lane also failed four timer runs on 10 and 11 Oct,
which belong to the same gap.

---

## 1. track-b-backup: a real 51-hour backup gap (closed), and a time limit about to be hit (fixed here)

**The gap (a), 10 Oct 12:45 to 12 Oct 15:34 UTC.** Every timer run from 10 Oct 18:23 to
12 Oct 12:23 (seven runs) failed at `Backup privilege preflight failed (psql; exit=1)`, so no
snapshot was taken. On 12 Oct the freshness step reported `stale, age=35.6h, threshold=7h`.

- **Cause:** #2036 (10 Oct 12:51) added the table `pto_member_events`, and the backup role had no
  SELECT on it.
- **Fix:** #2046 (OPEN_REPAIRS 409, merged 12 Oct) added corpus `history-v13`, its grant, and a
  migration guard test.
- **Recovery:** the manual run at 12 Oct 15:34 took the first good snapshot.
- **Why it showed green:** the `(schedule)` copies stood down for the timer's run and showed green
  on every one of those days.

**The 24 Oct cancelled run** uploaded and verified its snapshot (HMAC, read-back and parent all
true) and passed freshness. It was then cancelled at the job's 25-minute limit, because the
snapshot step took 12.8 minutes that time.

**The growing step (a), fixed in #2342 (split out to merge first).** The "Check seven-hour Drive freshness" step downloads
and authenticates every snapshot of the current corpus in the Drive folder, about 156 MB each. The
folder is never pruned, and since `history-v13` began on 12 Oct each day adds about four snapshots.
Measured on every timer run:

| Date | Snapshot step | Freshness step | Whole job (limit 25 min) |
|---|---|---|---|
| 13 Oct | 2.3 min | 5.6 min | 8 min |
| 17 Oct | 2.1 min | 8.5 min | 11 min |
| 20 Oct | 2.2 min | 16.5 min | 19 min |
| 23 Oct | 2.2 min | 14.2 min | 16 min |
| 26 Oct 12:23 | 2.3 min | 18.9 min | 21 min |

At about a minute a day, every run would pass 25 minutes around 29 or 30 Oct. The snapshot would
still upload, because it runs first. But every timer run would then be cancelled (red), and the
freshness alarm would turn into constant noise, then silence.

**Fix.** `selectLatestAuthenticatedFromDrive` no longer downloads a candidate whose filename second
plus 999 ms is not later than the newest snapshot already authenticated.

- **Why that cannot change the winner:** a snapshot only counts if its filename equals its
  authenticated `generated_at` to the second, so such a file can never be selected.
- **What is unchanged:**
  - the newest listed candidate is still judged in full, so a bad newest file still fails
    `verification_failed`;
  - a file named in the winner's own second, or later, is still downloaded;
  - the same snapshot is selected;
  - the stale threshold, the receipt merge and the paging are untouched.
- **New output field:** `older_candidates_not_downloaded` says how many were skipped.
- **Tests:** `test/track-b-backup.js` gains four checks: older ones skipped, a later-named one
  listed after the winner still wins, a same-second one is still downloaded, and a corrupt newest
  file still fails the canary. They fail on the old code.

**Not changed:** the 25-minute limit and the folder contents. Pruning old snapshots is a retention
decision for the owner.

## 2. card-calendar-status-drift: 70 reds, four real drifted cards, both causes already fixed

Every red run (13 Oct 17:27 to 17 Oct 14:27, hourly) gated on exactly one drifted slot (two at
once on 14 Oct 21:27 and 22:27). Four different cards, one at a time:

| Window | Calendar showed | Work item said | What happened |
|---|---|---|---|
| 13 Oct 17:27 to 18:27 | For SMM Approval | In Progress | The SMM picked a status about 2 s after the bridge had written one; the second pick never reached the work item |
| 14 Oct 17:27 to 16 Oct 16:27 | Posted | Scheduled | The SMM set Approved, then Scheduled, then Posted within 10 s; Posted never reached the work item. An admin moved it by hand on 16 Oct 16:38 |
| 14 Oct 21:27 to 22:27 | For SMM Approval | Tweaks Needed | The same two-picks pattern |
| 16 Oct 19:27 to 17 Oct 14:27 | Tweaks Needed | Client Approval | A client asked for changes on a review link. The card took it; the video work item did not, for about 20 h. An admin moved it by hand on 17 Oct 15:22 |

**Causes (both bugs, both fixed before this session):**

- Two status picks inside the save wait: the second was dropped before production-write.
  OPEN_REPAIRS 424, #2114 (merged 16 Oct 10:51).
- A client's "Request changes" on a linked part could change the card and never reach the work
  item. OPEN_REPAIRS 429, #2140 (merged 17 Oct 02:52).

The check was right every time.

**Who was affected:**

- Staff on three cards saw a status in Calendar that Production did not have, for 1 to 2 hours,
  or for about 2 days on one card.
- On one client's post, the client's change request was missing from Production for about 20
  hours, until an admin moved it by hand.

**Now:** every timer run has been green since 17 Oct 15:27 (215 runs to this afternoon). Live
read today: three of the four cards agree with their work items; the fourth card is archived, so
it is out of the check's scope. No data was changed by this session.

## 3. sheets-mirror-daily: the Sheet mirror fell behind twice (minor; nobody reads it)

Since 2 Oct the database is the main copy of Clients Info and Social Media Managers
(`client_profiles_authority`). The page reads the database (`roster: database` since 9 Oct), and
n8n reads through `roster-read`. The two Sheet tabs are a mirror the database keeps (OPEN_REPAIRS
331, 374). The lane's strict parity steps prove that mirror.

- **15 to 18 Oct (4 timer runs and 1 manual run):** two roster differences, then one Clients Info
  value difference. A manual run at 18 Oct 19:01 was clean, so someone corrected it by hand.
  The tabs are still editable by people until the owner protects them, so the likely cause is a
  hand edit or a change that bypassed `roster-write`. The logs show counts only, so the cause is
  not proven.
- **22 Oct to today (5 runs):** one Clients Info row and one manager assignment are missing from
  the Sheet (42 database rows, 41 Sheet rows). Both are a second *test* client (kind `test`) seeded
  on 21 Oct 18:43 by a supervisor session straight into the database. Its manager assignment was
  added 4 s later the same way, so `roster-write`'s Sheet copy never ran.

**Class:** (a), minor: the mirror is genuinely behind. **Affected:** nobody; nothing reads the
tabs.

**Smallest fix (data, not done here):** either have the owner or Lighthouse put that test client's
two rows on the Sheet through `roster-write`'s Sheet copy, or archive the seeded test client if it
is no longer needed. The parity step is correct and was not changed. Until then the lane stays red.

**Lesson:** a database edit that skips `roster-write` does not reach the Sheet.

## 4. samples-e2e-nightly: four causes, none in the product

| Night(s) | Failed | Cause | Class |
|---|---|---|---|
| 17 Oct | `cal_realtime_twin.js`: "A's fresh edit persisted to the backend" | One night only, green the next; not reproduced | (c), likely a realtime blip |
| 18 to 23 Oct | Tree 14/24 paths, scenarios 1/3: every client action came back `disabled` | See below | (b) |
| 21 Oct | Every browser job: "Playwright does not support chromium on ubuntu26.04-x64" | `ubuntu-latest` moved to 26.04. Fixed by #2277 (21 Oct 12:57, pinned ubuntu-24.04) | (c) |
| 22 Oct | Unit lane: `test/truth-sync.js` | Truth docs past their re-verify date. Fixed by #2292 and #2308 (23 Oct) | (b) |
| 23 and 25 Oct | Unit lane: "timed out after 300s" with nothing failing | The cap was set with the runner on 29 Jun (`qa/master.js`, 1a110244). The suite now takes 265 to 300 s. **Fixed here:** 600 s, still a hang guard | (b) |

**The 18 to 23 Oct client failures.** The tree's client driver (`clientAct` in
`qa/scenario_engine.js`) acts on the old `.cal-review-card` panels. It returned `disabled` both
when the button was disabled and when the card or panel was not drawn at all, so the logs cannot
say which.

- **Start:** the first red night follows the 17 Oct review-page merges (#2131, then trains #2200
  and #2209). The test client was on `review_stage_client_pages` from #2131.
- **End:** the tree has been green on all three nights since (24, 25 and 26 Oct, 214/214
  assertions). No commit touching the tree, the Samples client page or the stage switch landed in
  between, and no switch changed. **The change that ended it is not identified.**
- **Data:** the test client's samples were being cleaned up nightly (archives equal creates), so
  it was not a pile-up.
- **Fixed here:** the driver now returns what it found (`no-panel`, or `disabled`), so the next
  time the logs say which.
- **Users:** none. Clients approve and ask for changes on the Review stage, which the dawn check
  exercises on the live site daily (506).

## 5. production-polish-gate: racy suites, then the runner image

- **12 and 15 Oct (heavy, `behav_wired:groupCollapse`), 13 Oct (fast, boot budget), 16 Oct
  (interaction inventory):** five races in the suites, none in the app. Reproduced and fixed by
  #2094 (16 Oct 15:56): "wait for the app instead of guessing". Class (b).
- **18 Oct 05:54:** cancelled by the next run at 05:58, which passed.
- **21 Oct:** the Ubuntu 26.04 image, as in section 4, fixed by #2277. Class (c).

Green on every timer run since 22 Oct. Nobody affected.

## 6. assurance-ledger-freshness: the ledger said FRESH past its dates

The gate is correct and was not changed. It goes red when a row in
`docs/testing/ASSURANCE_LEDGER.md` claims more freshness than its last-proven date allows.

- **From 13 Oct:** the five Tier 0 and Tier 1 rows proven on 9 Oct (client review links,
  share-link issuance, client thumbnails, Calendar staff writes, Samples and Kasper) passed half
  their 7- and 14-day windows while still saying FRESH. The Workload row and the four Tier 3 rows
  passed their windows while saying NEAR.
- **Fixed here:** each overstated State cell is restated to what its date supports (EXPIRED, with
  the day count), and the State column stamp moves to 2026-10-26. As the script says, restating is
  the honest alternative to re-proving.
- **Not touched:** every "Last proven" cell and method. Nothing was re-proven.
- **What to know:** the Tier 0 client surfaces have no ledger proof newer than 9 Oct. The daily
  dawn check exercises the client approve and request-changes paths, but nobody has written that
  up as a ledger proof.

## 7. thumbnail-revision-scan: four single 5xx answers

| Run | Answer |
|---|---|
| 13 Oct 11:50 | HTTP 504 |
| 14 Oct 02:10 | HTTP 520 |
| 21 Oct 15:10 | HTTP 503 |
| 26 Oct 05:00 | HTTP 503 |

Each time the next 10-minute run was green, and the scan picks up anything missed on its next
pass. Class (c), the function host. Recovered. Nobody affected.

## What this PR changes

The backup fix is #2342, split out at the supervisor's request.


| File | Change |
|---|---|
| `docs/testing/ASSURANCE_LEDGER.md` | Ten State cells restated, column stamp 2026-10-26 |
| `qa/master.js` | Unit lane cap 300 s to 600 s |
| `qa/scenario_engine.js` | The client driver reports `no-panel` when the card is not drawn |
| This report, OPEN_REPAIRS 507, STATE_OF_THINGS | |

No data changed. No check was skipped, disabled or loosened. Every assertion is kept; the raised
unit-lane time limit still stops a hang.
