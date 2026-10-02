# Opening a post, a batch or a sub-issue: measured on the live site, fixed in order of impact

**Date:** 2026-10-01 · **Session:** Comet · **Owner request:** opening something must feel instant, from the Calendar, Workload, SyncLinear, Today and Samples; plus two approved saved-copy changes from the SyncLinear audit (section 6, items 1 and 2).
**Changed:** page code only (`src/index/` fragments, rebuilt into `index.html` and `js/`). No database, Edge Function, n8n, flag, permission or write path was touched, and none was needed. Reads only, signed in as the admin staff role, test client only.

---

## 1. Headline

- **The sign-in check is the floor, and it was not touched.** Every open in a new tab waits about 1.0 to 1.3 s for `key-verify` before any staff data is read or painted. That wait is the staff gate; the fixes below leave it exactly as it is and remove everything that was stacked on top of it.
- **The worst case was a link at a finished batch: title at 5.3 s, everything at 6.5 s (10 s in one run).** The page waited for the whole finished-items read (five serial pages, about 4,600 rows) before it could find the batch's parent card. It now reads the batch, its children and its parent directly, beside the board's own reads: title at 1.5 s warm, everything at 2.7 s.
- **A link at a finished card opened 0.7 s late on every warm visit** because the saved list leaves finished rows out. The finished rows now live in the saved copy too, so that card opens from the copy (2.16 s to 1.42 s).
- **Every link that opens in a new tab went through a 404 and a redirect first** (`/synclinear/<id>` is not a file; GitHub Pages answers 404 and `404.html` bounces to the app). That is 150 to 190 ms on the live site before the app starts. Links now point at the app document itself; the address bar still shows the clean path once the page loads.
- **Clicking a row in SyncLinear already painted the panel in about 30 to 70 ms** from what the page holds. What was slow was the reads behind it (comments, assets, description, labels), which started at the click. They now start when the pointer settles on a row (120 ms) or presses it: with a typical 300 ms dwell the panel is complete 0.37 s sooner (1,586 to 1,219 ms).
- **Calendar cards were already fast** from inside the app (350 to 520 ms) and, from a new tab, are bound by the same sign-in wait plus one read of the client's posts. Not changed (section 6).

---

## 2. Rig and method

- Playwright Chromium 1440 x 950, from a cloud sandbox whose traffic passes an egress proxy. Signed in as the admin staff member through the real `key-verify` (identity stored the way the app stores it). All data is the live backend; only the test client's items are opened.
- **Probe** (in the page, on every animation frame, absolute clock): **(a)** panel or page visible (the detail pane or the Calendar card exists), **(b)** title and status shown (the expected title and a status chip, or the card's name), **(c)** everything loaded (no skeleton or "loading" element left, every visible image decoded, and the description or comments or asset list present).
- **Cold** = a fresh browser profile. **Warm** = a profile that has already opened the SyncLinear (or Calendar) page for 11 s, so the saved list and the HTTP cache exist; in-tab warm is the second open of the same item.
- **Entry points measured:** a new-tab link to a sub-issue (what Workload, the Calendar's sub-issue buttons, Samples' sub-issue buttons and Today's "Open in SyncLinear" open), a new-tab link to a batch (Workload), a click on a row inside SyncLinear, a Calendar card from a new tab, a Calendar card from another page in the app (Today and Workload), and the Calendar's Notes. Samples has no live sample cards on the test client, so its own card open could not be timed; its sub-issue buttons use the same new-tab link.
- **Two real items of each kind** (A, B). B is a finished item (the awkward kind). 5 runs each, cold and warm, on the live site first (section 3); then **old build against new build, interleaved** (old, new, new, old, ...) on a local server that models GitHub Pages (a real 404 for non-file paths, 80 ms per document, 60 ms per script) against the same live backend, 5 runs each (section 5).

---

## 3. Before: the live site today (median of 5, ms)

| open | item | cold a / b / c | warm a / b / c | requests |
|---|---|---|---|---|
| sub-issue, link in a new tab | A | 2,345 / 2,345 / 4,581 | 1,378 / 1,378 / 3,276 | 54 |
| sub-issue, link in a new tab | B (finished) | 2,392 / 2,392 / 5,273 | 2,270 / 2,270 / 4,732 | 56 |
| batch, link in a new tab | A | 3,053 / 3,053 / 4,873 | 1,234 / 1,234 / 2,397 | 46 |
| batch, link in a new tab | B (finished) | 3,159 / 5,184 / 6,327 | 1,310 / **5,280** / **6,328** | 47 |
| row click inside SyncLinear | A | 60 / 60 / 1,403 | 28 / 28 / 28 (second open) | 6 |
| Calendar card, new tab | A | 2,224 / 2,224 / 2,224 | 1,818 / 1,818 / 1,818 | 32 |
| Calendar card, new tab | B | 2,188 / 2,188 / 3,021 | 1,600 / 1,600 / 2,255 | 37 |
| Calendar card from Today | A | 513 / 513 / 513 | 355 / 355 / 355 | 6 |
| Calendar card from Today | B | 525 / 525 / 1,244 | 352 / 352 / 352 | 6 |
| Calendar Notes | B | 17 / 17 / 17 (the dialog; the thread arrives from two reads that end at about 1.2 to 1.4 s) | 7 | 3 |

Requests, in order, for the kinds that matter (the waits are inferred from timing; full lists are in the session log):

1. **New-tab sub-issue, warm** (time since the click): 0 to 150 ms `GET /synclinear/<id>` answers 404 (the hop); the app document and 20 scripts load; **310 to 1,255 `key-verify`** (everything below waits on it); at 1,260 the batches read, three deliverable reads, clients and team members (all parallel, each waiting only on the gate); the saved list paints the panel at about 1,380 (a); `production-comments` and three `production-write` reads (assets, description, labels) start at 1,250 to 1,470 and end at 2,900 to 3,300 (c); the board's live read ends at about 3,800 and swaps the list in, which **re-asks** the three `production-write` reads and `analytics-read` (3,840 onward, no visible change).
2. **New-tab finished batch, warm:** the same until 1,260; then the batch's parent card is a *finished* row, which only the finished-items read carries: five serial pages from about 2,050 to 5,116. **The title appears when that read ends (5,280), then `production-write` for the batch's files takes until 10,040 in one run.**
3. **Row click inside SyncLinear, cold:** at 0 to 5 ms the panel paints from the row. At 78 ms the events read, a roster read and four reads for the panel (`production-write` x3, `production-comments`) start together; they end at 750 to 1,340 (c). Nothing is serial; nothing is fetched twice.
4. **Calendar card from a new tab:** 404 hop; `key-verify` ends at 1,030 to 1,330; templates, prompts, the client's posts and two analytics reads start together; the card paints when the posts arrive (a), then the thumbnail, deliverable links, `brain` and `thumbnail-revision-read` start (c).
5. **Calendar card from Today:** the client's posts read (35 to 350 ms), then the card paints (a); `brain`, the deliverable lookup, the thumbnail and `thumbnail-revision-read` start together (c at 1.1 to 1.3 s cold).
6. **Calendar Notes:** one deliverable lookup (0 to 364 ms), then two `production-comments` reads together (ending 1,260 and 1,431). The dialog paints at once and says "All clear" until they land (section 6).

---

## 4. Causes, checked (not assumed), and what was done

| # | Cause (evidence) | Verdict |
|---|---|---|
| 1 | **A finished batch's parent is only in the finished-items read.** Trace 2 above: the title lands exactly when the fifth finished-items page ends. | Fixed (new reads, below). |
| 2 | **A finished card is not in the saved list** (finished rows are dropped to fit localStorage), so a warm link at one waits for the live read: 2,155 vs 1,278 ms for a live card. | Fixed (finished rows kept in the IndexedDB copy). |
| 3 | **A 404 and redirect before the app starts**, on every new-tab link (150 to 190 ms live; the request at 0 ms in every trace). | Fixed (direct links). |
| 4 | **The reads behind a row click start at the click.** Trace 3: four reads at 78 ms, answers at 750 to 1,340. | Fixed (start on hover and press). |
| 5 | **Reads one after another that could run together.** Checked each trace: the sub-issue, batch and calendar opens already fire their reads in parallel (three `production-write`, comments, events). The only serial chain was the finished-items pages (cause 1). | Nothing to fix. |
| 6 | **Data the page already holds fetched again.** After the board's live read swaps the list in, the open card's three `production-write` reads and `analytics-read` are asked again (trace 1, 3,840 onward). | Kept (section 6): they re-check the card's scope against the new list; the panel keeps showing the first answers meanwhile. |
| 7 | **Code that loads on first open.** The Workload chunk (`sv-04`) is fetched at about 1,316 ms on the Linear page, right after the gate, by the idle prefetch; it does not delay the panel. | No change. |
| 8 | **A key or flag check before anything paints.** The staff check is the floor under every new-tab open (about 1.0 s). Four runtime-flag reads run beside it and do not gate the panel. | Not touched (it is the permission check). |
| 9 | **Heavy rendering of comments, images or the asset grid.** Not measurable as a cause: the panel's first paint is 30 to 70 ms after the click; "everything" is bound by the Edge Function reads (0.75 to 1.4 s) and the thumbnail download, not by rendering. | No change. |
| 10 | **Waiting for everything before showing anything.** Only for finished items (causes 1 and 2). Live items already paint from the saved list. | Fixed with 1 and 2. |

### Fixes, in order of impact

1. **A link at a finished batch reads what it needs directly** (`_prodDeepLinkFastPaint`, `250`). It reads the batch row, then, side by side, the batch's rows (`batch_id=eq.<id>`) and the parent card(s) the batch names, merges them the way the single-card fast paint already does, and lands on the parent card exactly as the post-load pass would. It never consumes the link, never writes the saved copy and never claims a missing card; a late or failed read leaves the old path untouched.
2. **The saved copy now carries the finished rows** (`210`, `250`): a separate IndexedDB record with the time of the last *full* pass. A boot with a copy under an hour old keeps those rows across the live swap and reads only the finished rows that changed since the newest one held; past an hour, the full pass runs, so a hard delete still converges, exactly as before. A hand-pressed Refresh is always a full read. The copy is validated like the list copy (schema, age, column list), purged with it on sign-out, and a copy that arrives after the live swap is ignored. The finished-items prefetch added on 2026-10-01 waits for the copy (a local read, 400 ms at most) before deciding, so an incremental boot starts no full download.
3. **Seven days, not 24 hours** (`PROD_CACHE_TTL_MS`). The saved list still says "Showing saved list from <weekday time> · updating" until the live read replaces it.
4. **Links that open in a new tab use the app document itself** (`svRoute.fast`, `003`; Workload `080`/`090`, Calendar `160`, Samples `270`, Today `097`, the Kasper "open this card" links). Same destination; the address bar is rewritten to the clean path after load, as it already was for old-style links. Copy-link buttons still copy the clean address.
5. **Reads start on intent** (`_prodPrefetchOpen`, `260`): when the pointer rests on a SyncLinear row for 120 ms, or presses it, the same idempotent per-row reads a click starts are started: comments, labels, description, assets. Each keeps its own scope and identity check when its answer lands; nothing is painted by the prefetch; a sweep across the list starts nothing; nothing starts during a list swap, in a hidden tab, or for the row already open.

---

## 5. After: interleaved old against new, same rig (median of 5, ms)

| open | item | temp | a: old to new | b: old to new | c: old to new | requests |
|---|---|---|---|---|---|---|
| batch, new tab | A | cold | 2,813 to **1,882** | 2,813 to 1,882 | 4,137 to 3,991 | 46 to 48 |
| batch, new tab | A | warm | 1,370 to 1,178 | 1,370 to 1,178 | 2,620 to 2,402 | 47 to 44 |
| batch, new tab | B (finished) | cold | 2,917 to 2,320 | 5,082 to **2,320** | 6,194 to **4,768** | 47 to 50 |
| batch, new tab | B (finished) | warm | 1,239 to 1,159 | 5,269 to **1,459** | 6,512 to **2,737** | 47 to 46 |
| sub-issue, new tab | A | cold | 2,114 to 2,106 | 2,114 to 2,106 | 3,884 to 4,050 | 54 to 53 |
| sub-issue, new tab | A | warm | 1,278 to 1,185 | 1,278 to 1,185 | 2,745 to 2,807 | 53 to 49 |
| sub-issue, new tab | B (finished) | cold | 2,210 to 2,144 | 2,210 to 2,144 | 5,416 to **4,329** | 56 to 55 |
| sub-issue, new tab | B (finished) | warm | 2,155 to **1,419** | 2,155 to 1,419 | 4,538 to **3,280** | 56 to 51 |
| row click, 300 ms hover | A | cold | 62 to 45 | 62 to 45 | 1,586 to **1,219** | 6 to 6 |
| row click, 300 ms hover | A | second open | 27 to 29 | 27 to 29 | 27 to 29 | 1 to 1 |
| Calendar card, new tab | A | cold / warm | 1,626 to 1,614 / 1,542 to 1,555 | same | same | 33 to 32 / 41 to 39 |
| Calendar card, new tab | B | cold / warm | 1,650 to 1,587 / 1,420 to 1,450 | same | 2,416 to 2,426 / 2,228 to 2,205 | 37 to 36 / 40 to 40 |

### The two approved saved-copy changes, on the SyncLinear list itself (old against new, interleaved, 4 cold and 12 warm opens each)

| | old | new |
|---|---|---|
| warm: first rows | 956 ms | 920 ms |
| warm: 1,500 rows on screen | 1,408 ms | 1,424 ms |
| warm: fresh data landed (the "saved list" label clears) | 2,969 ms | 3,174 ms (see below) |
| warm: **complete list** (the last rows whose ancestors are finished) | **5,250 ms** | **3,174 ms** |
| warm: requests / wire bytes | 71 / 2,360 KB | **63 / 1,252 KB** |
| warm: rows (deliverables and batches) | 18 requests, 1,889 KB | **10 requests, 780 KB** |
| warm: main thread frozen (sum of tasks over 50 ms) | 172 ms | 153 ms |
| cold: first rows / complete list | 3,183 / 5,514 ms | 2,835 / 5,324 ms (nothing is saved yet, so the same work; the difference is run noise) |

The 0.2 s later "fresh data" is real and consistent (the new median is 3,195 against 2,955 in the second run): the live swap now builds the list once with the finished rows already in it, where the old code built it twice, the second time at 5.2 s. The list is complete 2.1 s sooner and 1.1 MB lighter for that.

Reading it: the model server charges only 80 ms for the 404 hop where the live site charges 150 to 190 ms, so the live saving from the direct link is about double what the rows for live items show (-0.1 s). Calendar cards were not changed and read the same, which is the control. Control, row click with no hover at all (the harness clicks without pointer events, so nothing new can fire): 1,582 to 1,334 ms, inside run noise (individual runs 1,279 to 1,714), no regression.

---

## 6. Not changed on purpose (one-line decisions for the owner)

1. **The staff check (about 1.0 s) before any new-tab open.** It is the permission gate; weakening or skipping it is not on the table. Profiling `key-verify` is an Edge Function change and needs the owner's go first.
2. **The re-asks after the board's live read swaps the list in** (assets, description, labels, analytics: 3 to 4 requests). They re-check the open card's scope against the new list; the panel keeps the first answers on screen meanwhile (no skeleton). Removing them risks showing a link under a card that moved to another client.
3. **Calendar cards from a new tab (1.4 to 1.6 s).** Bound by the same sign-in wait plus one read of the client's posts; a head-script early read would save about 90 ms for a new moving part. Not worth it.
4. **The Notes dialog says "All clear" for about 1.3 s before its two reads land.** It is an honest-looking empty state for data that has not arrived. Showing "Loading" instead changes what the dialog shows; your call.
5. **No service worker or document caching.** The app document is re-fetched for every distinct address; caching it needs a service worker, a larger change with its own risks.
6. **Samples card opens were not timed** (no live sample cards on the test client). Its sub-issue buttons got the direct link.

---

## 7. Proof the content is the same

- **Items.** Each of the six items (a sub-issue, a batch and a Calendar card, A and B) was opened in a fresh profile on the old build (by its old clean address) and on the new build (by the new direct address) against the same live data, left for 16 s, and the whole pane compared: its visible text (elapsed-time words masked), every image address and whether it decoded, and every link address. **Text, images and links are identical for all six; the only difference anywhere is the address form of the two sub-issue buttons on each Calendar card** (`/synclinear/<id>` became `/?prod=1&d=<id>#production`, which is the point of the change). Two old-against-old runs were identical, so the comparison has no noise in it. Both builds end on the same clean address in the address bar.
- **The list.** The SyncLinear list (1,629 rows, 7 group headers, the sidebar) compared row by row, old against new, cold and warm, elapsed-time words normalised: **0 different rows, groups and sidebar equal.** (The raw control, one build against itself, differs in one row by a minute counter.)
- **Tests that fail on the old code.** `test/open-item-speed.js` (50 checks: the direct form for every link builder, the batch fast read, the 7 day life, the finished-rows copy and its refusal cases, the hourly full pass, the hover prefetch). On the old build it stops at its first check ("the router offers a direct form for new-tab links"); the same file, run there, covers every other behaviour as well because each is asserted on functions the old code does not have. `test/prod-deep-link-fast-paint.js`, `test/prod-tail-prefetch.js` and `test/workload-tweak-exclusive-bucket.js` were taught the new helpers and the new link form.

## 8. Limits

- Rig: one location, one egress path; 300 ms of run-to-run network variation, which is why old and new alternate.
- The local server models the document and script latency; the backend is live.
- Medians of 5; where old and new differ by under about 150 ms the table says "same".
