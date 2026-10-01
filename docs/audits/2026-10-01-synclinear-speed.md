# SyncLinear (the Linear tab) speed: measured on the live site, fixed in order of impact

**Date:** 2026-10-01 · **Session:** Comet · **Owner request:** make the Linear tab as fast as it can be without changing what it shows or how it behaves.
**Changed:** page code only (`src/index/` fragments, rebuilt into `index.html` and `js/`). No database, Edge Function, n8n, flag or write path was touched. Reads only, signed in as the admin staff role, test client only.

---

## 1. Headline

- **The tab is quick to open and quick to use; it is slow to be finished.** On the live site a returning staff member sees rows at about 1.1 s (the same shared sign-in wait every tab has), switching to the tab takes about 60 ms, scrolling never drops a frame, and opening a card takes under 100 ms. What is slow is everything behind the first screen: fresh data lands about 3.5 s in, and the complete list (the last 117 rows and the sub-issue counts) lands about 7.9 s in, after a freeze of about 0.75 s. A first-ever open (no saved copy) shows rows at 3.0 to 4.9 s.
- **The 2026-09-24 speed map is right about what it measured, and it measured the wrong end.** It timed "first content": SyncLinear 1,150 ms warm, at the shared floor. Today's live reading is 1,107 ms. By that measure Analytics (3,339), SMM reports (2,326) and Calendar (1,793) were slower. SyncLinear is the slowest tab only in **time to the complete list** and in **bytes** (3.25 MB cold, 2.37 MB on every warm open), neither of which that map recorded.
- **Three changes and one safety read, none changes what the page shows.** Cold open: first rows 3.69 to 3.15 s (-15%), complete list 8.24 to 5.85 s (-29%). Warm open: fresh data 3.46 to 3.16 s (-9%), complete list now inside 5.3 s (it used to land after about 7 to 8 s), first rows unchanged. Every number is in section 6.
- **Proof the page is unchanged:** all 1,642 rendered rows, the 7 group headers and the sidebar were compared character for character between the old and new build against the same live data, cold and warm: **0 differences** (age labels such as "37 minutes" normalised; the old build against itself also shows 0).

---

## 2. Rig and method

- Playwright Chromium 1440 x 950 from a cloud sandbox whose traffic passes an egress proxy, signed in as the admin staff member with the staff role key through the real `key-verify` function (identity written to storage, so no sign-in screen). Same shape as the 2026-09-23 and 09-24 maps. Only `SYNCVIEW_STAFF_KEY` was used.
- **Cold** = a fresh browser profile (no HTTP cache, no saved copy). **Warm** = `reload()` of a primed page, which paints from the saved copy (an IndexedDB snapshot: it is too big for localStorage).
- Readiness is polled on `requestAnimationFrame`: **first rows** = the first `.prod-row`; **1,500 rows** = the saved or fetched list is on screen; **fresh data** = the freshness label turns from "saved copy" to live; **complete list** = the last row-count change, after the finished-items read lands.
- **"Before" and "after" were measured on the same rig, interleaved** (old build, new build, old build...), because this rig's network varies by about 300 ms from run to run and a sequential comparison drowned the effects (three of my early comparisons did, and are not used). Both builds were served locally against the live backend. Script responses were delayed 700 ms to model GitHub Pages delivery, calibrated so the old build's cold first rows (3.69 s) sit inside the live site's range (3.0 to 4.9 s, five live cold loads plus two earlier ones). **The "after" numbers on the live site itself can only be taken after this merges**; re-run section 8 then.
- Requests and bytes come from the browser's network events (wire bytes, compressed).

---

## 3. Before: the live site today

| | cold (5 loads) | warm (8 reloads) |
|---|---|---|
| first rows | 3.0 to 3.8 s, median 3.13 (two earlier loads: 3.9, 4.9) | 0.92 to 1.38 s, median 1.12 |
| list on screen (1,500 rows) | 3.4 to 4.2 s, median 3.53 | 1.33 to 1.88 s, median 1.66 |
| fresh data landed | same moment (nothing was saved) | 3.2 to 4.0 s, median 3.49 |
| complete list (1,642 rows) | median 7.9 s (up to 8.3) | after about 7 to 8 s |
| requests | 78 | 71 |
| wire bytes | 3.25 MB | 2.37 MB |
| of which rows (deliverables and batches, 18 to 20 requests) | 1.89 MB | 1.89 MB |
| scripts (21 requests) | 0.81 MB | 0 (cached) |
| other data and API reads (16 to 22 requests) | 0.31 MB | 0.31 MB |

Hand-feel on the live site: switching from the calendar 26 to 134 ms (median 59), scrolling 120 frames with the worst at 22 ms and none over 50 ms, opening a card 42 to 89 ms. These are fine and are not touched by this work (after: 16 to 102 ms, worst frame 24 ms, 37 to 96 ms).

**Where the time goes** (full request waterfalls, CPU profiles and per-render timings were taken; the findings, biggest first):

1. **The finished-items read is the last thing to land, and it only starts after the first paint.** About 4,600 finished rows come down in five serial 1,000-row pages (about 1.2 MB, 3.5 s), starting only after the live read has finished and the board has painted. The 117 rows whose ancestors are finished, and the sub-issue counts, only appear when it lands, with a 0.75 s render block. This is the "full list arriving after the first rows".
2. **On a cold open the data reads wait for the app to start, not only for sign-in.** The sign-in check (`key-verify`) answers at about 0.85 s but the two big reads were sent at about 1.6 s, when every script had downloaded and the tab had mounted.
3. **Every list render does millions of needless comparisons.** `_prodChildrenOf` rescanned and re-sorted all ~5,700 issues for every row, `_prodIssue` scanned them again per row, and the "today" date was formatted with `Intl` for every row's overdue text. A full render of ~1,500 rows cost 305 to 455 ms, and the page renders in full three times on a warm open and a fourth time when the finished items land.
4. **The row markup is heavy** (about 4.4 KB per row, 6.5 MB and 39,000 elements per full render). Not changed; see section 7.

---

## 4. The changes, in order of impact, each measured

| # | Change | Where | Measured effect (interleaved, same rig) |
|---|---|---|---|
| 1 | **Start the finished-items read beside the live read.** Whenever a full tail is due (every non-silent load such as a boot, a page's first load, and once an hour) the answer is known when the load begins, so the read starts then. Same request, same rows, same merge order. A catch-up point for the next regular refresh follows (below). | `src/index/250-production-controls-data.js.part` (`_prodStartTailPrefetch`, `_prodTakeTailPrefetch`, `_prodState.catchUpSince`), `260-production-refresh-boot.js.part` (`_prodDeltaRefresh`) | Cold complete list 7.2 to 5.3 s in the step test (n=10), first rows unchanged (3.12 vs 3.08 s). Warm: the complete list now lands inside 5.3 s. |
| 2 | **Start page one of the batches and live-deliverables reads the moment sign-in passes**, not after every script has loaded. Same shape and same rule as the Today tab's early read: the requests wait for the early `key-verify`, so a rejected or unreachable check sends nothing (`qa/boot/staff-entry-gate.js` now covers the Linear tab, and fails if the wait is removed). | `src/index/005-head-boot.html.part`, `210-production-state-writes.js.part` (`_prodTakeEarlyRead`) | First data request 1.6 to 0.86 s on the delayed-script rig; cold first rows 3.70 to 3.12 s (n=8). On a fast local server it saves nothing, because scripts were never late there. |
| 3 | **Lookup tables, built once per adapter**, for `_prodIssue` and `_prodChildrenOf`, and a per-whole-second memo for "today". Same answers: first match wins, the alias match still only applies when no canonical match exists, a stable sort of the already ordered bucket. | `220-production-attribution-views.js.part` (`_prodLookups`), `250-production-controls-data.js.part` (`_prodPolicyTodayISO`) | A full render 455/337/305 ms to 275/295/212 ms. Warm list on screen 1,492 to 1,351 ms, fresh data 3,412 to 3,079 ms (n=30). |

**Overall, final build against the old one** (cold n=10, warm n=40, interleaved, delayed-script rig):

| | cold before | cold after | warm before | warm after |
|---|---|---|---|---|
| first rows | 3,689 | **3,146** | 949 | 1,092 (see below) |
| list on screen | 4,128 | **3,425** | 1,538 | 1,499 |
| fresh data landed | n/a | n/a | 3,460 | **3,155** |
| complete list (1,644 rows) | 8,241 | **5,853** | after the 4 s window (7 to 8 s) | **5,267** |

Warm first rows sit at the shared sign-in floor and did not move: a second pair of warm-only runs (26 reloads each) gave medians 945 ms before and 909 ms after, with individual loads from 0.6 to 2.4 s in both builds; the 1,092 above is that noise, not a regression. Requests and bytes are exactly the same as before: the catch-up below adds no request at load time.

**One bounded risk, handled.** With the two reads overlapping, a card that moves between the live and finished sets inside the few seconds both are in flight could miss both reads (an approval is the common case; before this change the same gap existed in the other direction, for reopened cards, over a longer window). The catch-up closes it exactly: once the finished items land the page remembers a point 30 s before the load began (`catchUpSince`), and the next regular refresh (the 30-second poll, or a realtime-triggered one) starts from that point instead of from the newest row held, merging through the same path. A first version sent the catch-up read straight away; the Production polish gate rejected it because the read was still in flight when its test ended, and sending it with the refresh that was going to run anyway is both quieter and just as exact (a missed card heals within 30 s, against up to an hour for the same gap before).

**Database safety of the overlap**, because an earlier session found that four-wide parallel OFFSET pages timed out the database (57014). This is two keyset walks, each page scanning only what is left: 10 trials of both walks at once and 12 trials with three staff members' worth at once (six walks), all read-only, **0 failures and no slower pages**, and the pair finishes in 2.2 s against 3.0 s one after the other.

---

## 5. What was tried and dropped

- **Render only a screenful on re-renders ("spread").** Measured gain was inside the noise, and it makes the list shrink to a screen for a moment on each load render, a visible change. Dropped.
- **Merge the two small flag-answer renders into one.** Cut CPU by about 250 ms but no wall-clock gain on the 40-reload test, and it delays write controls. Dropped.
- **Parallel pages with offsets or boundary probes.** The boundary probe (`select=id&offset=1000`) costs as much as a page, and offset paging is what timed out the database. Dropped.
- **Batch the write-authority and cut-over flags into the head's flag read.** `test/boot-entry-tax.js` pins that `prod_authority` stays a live read and that the batch holds exactly seven keys. That is a decision, not a gap; not touched.

---

## 6. Not changed on purpose; owner decisions and recommendations

These each change what the page shows, how it behaves, or a documented design choice, so they are listed rather than done.

1. **(DONE 2026-10-01, owner-approved, OPEN_REPAIRS 321: now 7 days.) Saved copy lifetime is 24 hours** (`PROD_CACHE_TTL_MS`). A staff member who last opened the tab more than 24 hours earlier gets the cold path (3 to 5 s to first rows) instead of 1.1 s. Raising it (for example to 7 days; the copy is already labelled "saved list" and replaced by the live read) would turn most "first open of the day" cases from cold to warm. It changes what is shown for the first second, so it is the owner's call.
2. **(DONE 2026-10-01, owner-approved, OPEN_REPAIRS 321: finished rows kept in the IndexedDB copy, incremental read, hourly full pass kept; warm 2,360 to 1,252 KB, complete list 5.25 to 3.17 s.) Every warm open still downloads 2.37 MB**, 1.9 MB of it rows, because the saved copy leaves out finished rows and the finished-items read is a full pass at every boot. Keeping the finished rows in the IndexedDB copy (it has no 2.4M-character limit) and reading only what changed would remove about 1.2 MB, five serial pages and the 0.75 s end-of-load render from every warm open. It reverses the documented choice that the cache drops finished rows, and the hourly full pass exists so hard deletes converge. Needs the owner's go.
3. **The row markup is 4.4 KB per row** (five inline SVGs, three inline handlers carrying the row id). A full render is 6.5 MB and 39,000 elements, and that parse is now the largest remaining cost per render (about 90 ms of each, plus layout). Sharing the SVGs (`<use>`) or windowing the list would cut it, but both change the DOM that tests, keyboard focus, browser find and print rely on.
4. **`key-verify` takes 0.5 to 1.0 s end to end from this rig** (one 3.4 s outlier in six direct calls) against 0.2 to 0.3 s for a plain table read. It is the floor under every tab's first rows (the 09-24 map said the same). Profiling it is an Edge Function change and a deploy, outside this change.
5. **The Analytics tab's 297 KB read happens on SyncLinear's cold boot too** (`analytics-read`, after the first rows). It does not delay the list but shares the connection with the finished-items pages. Deferring it would slow the Analytics tab's first open, so left alone.

---

## 7. Limits

- One sandbox rig with an egress proxy, one connection, one admin staff account, the workspace-wide list (about 1,640 rows; the test client's own rows are a small part of it). Real phones and slower links will see larger absolute gains from the early start and the overlap, and larger absolute costs from the 4.6 MB-of-markup renders.
- Run-to-run noise on this rig is about 300 ms, which is why every comparison above is interleaved and why effects under that size (the render-batching and spread ideas) were dropped rather than claimed.
- "After" is the new build served locally against the live backend. Re-measure on the live site after merge with the same method.
- `docs/syncview-design/tests/prod-boot-budget.js` fails in this sandbox on the original code as well (its test browser rejects the proxy's TLS certificate), so it was not usable as a gate here. The mocked `prod-write-gateway-browser.js` passes.
- The unit suite: 640 of 645 suites pass; the 5 that fail (`native-intake-editor-browser`, `native-label-catalog-foundation`, `track-b-recovery-deferred-defaults`, `truth-sync`, `workload-native-membership`) fail identically on the unchanged code (shallow git history and sandbox limits).

---

## 8. Reproduction

The drivers ran from a session scratchpad and are not committed (they take the staff role key from the environment, like the earlier maps). The method in section 2 rebuilds them: sign in by posting the key to `key-verify` and storing the returned identity, open `/synclinear` (or `/?prod=1#production`), and poll `.prod-row` and the freshness label on `requestAnimationFrame`; count requests and wire bytes from network events; and for before/after, serve both builds and alternate loads. Never open the app with `?sxr=0` during a run (it turns Samples off for that browser).

**What to re-measure after merge:** cold first rows and complete list, warm fresh data and complete list, request count (expect the old count), and the three hand-feel checks. Way back: revert the PR (nothing else was changed).
