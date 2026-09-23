# Boot baseline — phase C step 1

**Date:** 2026-09-23 · **Session:** Gauge (supervisor: Lighthouse)
**Scope:** `docs/plans/2026-09-21-post-modularization-roadmap.md`, phase C step 1 —
"Measure first. Numbers before any change." **Measurement only: no app code changed,
nothing live mutated.**

Every later phase C step is compared against the numbers in this file. The method in
§4 is written so a later session can repeat it exactly rather than re-inventing it.

---

## 1. Headline

- The page everyone downloads is **5,752,561 bytes, 1,403,987 on the wire** (gzip).
- **A quarter of it — 367,680 gzip bytes — is code for seven areas most visitors never open.**
- A **staff** calendar is usable in **1,171 ms cold / 795 ms warm** (median).
- A **client** review list is usable in **4,564 ms cold / 3,601 ms warm** (median) —
  roughly **4× slower than staff**, on a view that shows far less.
- The client's wait is **not** bytes. On a warm reload the whole page transfers
  **300 bytes** (a 304) and content still takes **3.6 s**. The client view is gated on
  two Google Sheets CSV pulls; the staff view is not gated on Sheets at all.

The practical consequence for step 2: **code splitting improves the cold first visit, and
does essentially nothing for the client's repeat visit.** Both facts are needed to
choose what to split.

---

## 2. Offline — `prod-boot-budget.js`

`node docs/syncview-design/tests/prod-boot-budget.js`, on `origin/main`, 4 consecutive runs:

| run | ready | DOMContentLoaded | result |
|---|---|---|---|
| 1 | 272 ms | 194 ms | pass |
| 2 | 298 ms | 219 ms | pass |
| 3 | 274 ms | 192 ms | pass |
| 4 | 266 ms | 190 ms | pass |

Budgets are `PROD_BOOT_READY_BUDGET_MS=6000` and `PROD_BOOT_DCL_BUDGET_MS=3500`, so
current headroom is ~22× and ~16×. This harness serves `index.html` from a local static
server and opens `?prod=1`; it is a **structural** check (Production boot target, visible
root, no Analytics skeleton leak, no write-like requests), not a live-network measurement.

**It needs a route to the live Supabase backend.** In a sandbox with no egress it fails
immediately on `syncview_runtime_flags` with `net::ERR_ABORTED` — that is the sandbox,
not a regression. This matches the warning in `CLAUDE.md` about `test:prod-polish`.

This harness reports no paint timings: headless Playwright pages driven this way produce
no `paint` entries, which is why §3 exists.

---

## 3. Live — real browser, cold and warm, 5 runs each

Live page: `https://syncview.synchrosocial.com`. Two views:

- **Staff**, signed in as the owner (admin role), `#calendar/<test-client-slug>`.
- **Client**, the test client's client link (a `?c=…&v=calendar&t=…` share URL).
  The link and the display name it carries are deliberately **not recorded in this repo**;
  the driver strips the whole query string from same-origin URLs before printing.

Readiness ("the calendar is usable") is defined per view and recorded separately,
because **the two views render different components**:

| view | readiness selector | what it is |
|---|---|---|
| staff | `.cal-card` | a calendar grid card |
| client | `.cal-review-card` | a review-list row (the tab the client link lands on) |

The driver waits for **either** (`.cal-card, .cal-review-card`) and records which one
fired. In all 10 staff loads it was `.cal-card`; in all 10 client loads, `.cal-review-card`.
No load hit the 15 s ceiling; 20 of 20 reached ready.

### 3.1 Staff view

| metric | cold (min / median / max) | warm (min / median / max) |
|---|---|---|
| first paint | 128 / **136** / 460 ms | 124 / **148** / 156 ms |
| first contentful paint | 128 / **136** / 512 ms | 144 / **152** / 160 ms |
| **calendar usable** | 1,061 / **1,171** / 1,875 ms | 707 / **795** / 845 ms |
| DOMContentLoaded | 198 / 234 / 775 ms | 172 / 188 / 197 ms |
| **index.html transfer** | **1,404,287 B** (all 5) | **300 B** (all 5, 304) |
| **total transferred** | **2,517,441 B** (all 5) | **300 B** (all 5) |
| requests | 36 / 38 / 40 | 35 / 41 / 41 |

### 3.2 Client view

| metric | cold (min / median / max) | warm (min / median / max) |
|---|---|---|
| first paint | 148 / **180** / 388 ms | 108 / **128** / 172 ms |
| first contentful paint | 2,360 / **4,528** / 4,660 ms | 2,156 / **3,624** / 3,708 ms |
| **content usable** | 2,381 / **4,564** / 4,711 ms | 2,146 / **3,601** / 3,686 ms |
| DOMContentLoaded | 663 / 740 / 1,014 ms | 168 / 182 / 197 ms |
| **index.html transfer** | **1,404,287 B** (all 5) | **300 B** (all 5, 304) |
| **total transferred** | 2,497,901 / 2,498,201 / 2,498,201 B | 300 / 300 / 600 B |
| requests | 17 / 21 / 22 | 18 / 21 / 23 |

`index.html` is **1,404,287 B on the wire and 5,752,561 B decoded** — the same in both
views, since both are served the same single file. Cold totals exceed it by ~1.09 MB
(staff ~1.11 MB) of subresources: a jsDelivr `chart.js` bundle (~205 KB decoded),
Google Fonts CSS, the favicon, ten nav icons, and on staff also Drive-hosted thumbnails
(one at 935,324 B).

**Largest-contentful-paint never resolved** in any of the 20 loads, in either view.
Not investigated here; flagged for phase D/E.

### 3.3 Five slowest requests (run 0 of each)

Transfer bytes of 0 mean served from cache or CORS-opaque timing, not a zero-cost request.

**Staff, cold** — Sheets `sheet=Metrics` 2,217 ms · Sheets `sheet=Clients Info` 2,154 ms ·
Supabase `functions/v1/key-verify` 817 ms · Supabase `functions/v1/thumbnail-revision-read`
813 ms · `lh3.googleusercontent.com` thumbnail 667 ms (935,324 B).

**Staff, warm** — n8n `webhook/caption-prompts-get` 1,009 ms · n8n `webhook/templates-get`
918 ms · Supabase `thumbnail-revision-read` 764 ms · Sheets `sheet=Metrics` 566 ms ·
Sheets `sheet=Clients Info` 510 ms.

**Client, cold** — Sheets `sheet=TopVideos` 3,432 ms · Sheets `sheet=Clients Info` 2,200 ms ·
Sheets `sheet=Metrics` 2,195 ms · Supabase `functions/v1/client-token-verify` 1,014 ms ·
Sheets `sheet=Market Research Briefs` 968 ms.

**Client, warm** — Sheets `sheet=TopVideos` 3,208 ms · Sheets `sheet=Metrics` 2,329 ms ·
Sheets `sheet=Clients Info` 2,013 ms · Sheets `sheet=Competitor Briefs` 1,956 ms ·
Sheets `sheet=ContentSummaries` 1,925 ms.

All Sheets rows are `docs.google.com/spreadsheets/d/<id>/gviz/tq?tqx=out:csv&sheet=<name>`.

### 3.4 Which Sheets calls finish *before* content appears

At the instant readiness fired, the driver snapshotted every resource whose
`responseEnd` had already passed. This answers whether content is actually waiting on
Sheets or merely racing them.

**Staff: none.** On all 10 staff loads, **zero** Sheets requests had completed before the
calendar was usable. The staff calendar does not wait on Sheets.

**Client: exactly two, on all 10 loads** — `Metrics` and `Clients Info`:

| run | `Metrics` ends | `Clients Info` ends | content usable | gap after later sheet |
|---|---|---|---|---|
| cold 0 | 4,214 ms | 4,219 ms | 4,711 ms | +492 ms |
| cold 1 | 1,958 ms | 1,900 ms | 2,381 ms | +423 ms |
| cold 2 | 4,126 ms | 1,856 ms | 4,646 ms | +520 ms |
| cold 3 | 4,129 ms | 3,495 ms | 4,564 ms | +435 ms |
| cold 4 | 2,056 ms | 1,720 ms | 2,517 ms | +461 ms |
| warm 0 | 3,248 ms | 2,932 ms | 3,601 ms | +353 ms |
| warm 1 | 1,645 ms | 1,525 ms | 2,146 ms | +501 ms |
| warm 2 | 3,231 ms | 2,872 ms | 3,589 ms | +358 ms |
| warm 3 | 3,342 ms | 1,002 ms | 3,686 ms | +344 ms |
| warm 4 | 3,259 ms | 3,265 ms | 3,673 ms | +408 ms |

Content appears **344–520 ms after the later of the two**, on every single run, cold and
warm. `Metrics` is the later one on 8 of 10. **The client's review list is gated on
`Metrics` and `Clients Info`.**

The converse is just as useful: `TopVideos` is the *slowest* request on every client run
(3.2–3.4 s) and finishes **after** content. So do `Competitor Briefs`,
`Market Research Briefs` and `ContentSummaries`. They are wasted work on this view, but
removing them alone would **not** move time-to-content.

---

## 4. Method — repeat this exactly

Driver: Playwright (the repo's own dependency), Chromium, viewport 1440×950, against the
**live** site. Not the in-app browser pane — see §6.

1. **Readiness probe, installed via `page.addInitScript`** so it is armed before any page
   script runs, on every navigation including reloads. It `requestAnimationFrame`-polls
   for the first element matching `.cal-card, .cal-review-card` with a box larger than
   1×1 px, records `performance.now()`, records which half of the selector matched, and
   snapshots every `PerformanceResourceTiming` whose `responseEnd` is at or before that
   instant.
2. **Cold** = `cdp.send('Network.clearBrowserCache')`, then `page.goto('about:blank')`,
   then `page.goto(url, {waitUntil:'commit'})`. `localStorage` is **kept** (the staff
   identity lives there); only the HTTP cache is emptied.
3. **Warm** = `page.reload({waitUntil:'commit'})` immediately after, so the cache is
   populated by the preceding cold load.
4. **Ceiling: 15,000 ms per load**, enforced by a `Promise.race` *above* the readiness
   wait, so one stalled load cannot stall the run. Then a 2,000 ms settle, then collect.
5. 5 iterations of (cold, warm) per view; **client view first, staff second**, never
   concurrently — two browsers contend for CPU and network and corrupt the timings.
6. **Staff** runs in a persistent Chromium profile that the owner signed into by hand,
   once. The role key is never read, copied, or transported by the session.
   **Client** runs in a fresh context with empty `localStorage`.
7. Metrics come from `PerformanceNavigationTiming`, `PerformancePaintTiming`,
   `largest-contentful-paint` and `PerformanceResourceTiming`. Total bytes =
   sum of resource `transferSize` + navigation `transferSize`.

### Two traps that produced wrong numbers before they were caught

- **A `#fragment`-only `goto()` does not reload.** The staff URL is
  `/#calendar/<slug>`; navigating to it while already there is a *same-document*
  navigation, so the "cold" step was a no-op and every reading slid one slot —
  `warm[i]` came back exactly equal to `cold[i+1]`, and a "cold" load reported a
  300-byte 304. The `about:blank` hop in step 2 is what fixes it. **Cross-check the
  `index.html` transfer column against the cold/warm label before trusting any run:**
  cold must be 1,404,287 and warm must be 300.
- **Readiness selectors are per view, and must be derived from an empty profile.**
  `.cal-card` looked correct for the client link when tested in a browser that already
  held a staff identity for the same origin — it was rendering the *staff* calendar under
  a client URL. A clean profile gets the real client view, which lands on the Review tab
  and renders `.cal-review-card`. This is `AGENTS.md`'s "measure with the key the shipped
  code uses", applied to readiness.

### Not measured

- **Largest-contentful-paint**, which never resolved in 20/20 loads.
- Mobile viewports, throttled networks, and cross-region latency. All numbers are one
  machine, one connection, one evening; treat them as a **baseline for this rig**, and
  re-measure on the same rig after each phase C step rather than comparing absolutes
  across machines.

---

## 5. Sizing — what is in the page, by area

From `src/index/*.part` on `origin/main` (37 fragments, 5,752,561 bytes, byte-identical
to the served `index.html`). Gzip is level 9 per fragment; the sum of fragment gzips
(1,402,011 B) is within 2.3% of the whole file's gzip (1,370,400 B), so per-area gzip
shares are sound.

| Area | Fragments | Raw B | % raw | Gzip B | % gzip |
|---|---|---|---|---|---|
| Samples | `270`, `280`, `290` | 482,986 | 8.4% | 124,543 | 8.9% |
| Kasper (dashboard/replies, review/history) | `320`, `330` | 344,610 | 6.0% | 92,555 | 6.6% |
| TikTok (upload, pilot/sales) | `300`, `310` | 232,881 | 4.0% | 54,613 | 3.9% |
| Onboarding + staff controls | `100` | 172,931 | 3.0% | 43,358 | 3.1% |
| Time off + reports | `110` | 152,886 | 2.7% | 34,613 | 2.5% |
| Editors + date picker | `340` | 68,007 | 1.2% | 17,998 | 1.3% |
| **Split candidates** | **10 of 37** | **1,454,301** | **25.3%** | **367,680** | **26.2%** |
| Always-loaded remainder | 27 | 4,298,260 | 74.7% | ~1,034,331 | 73.8% |
| **Total** | **37** | **5,752,561** | 100% | 1,402,011 | 100% |

By kind: JavaScript 4,905,066 B (85.3%), CSS 752,719 B (13.1%), HTML 94,776 B (1.6%).
The two style fragments `010` and `020` alone are 752,719 B raw.

**How much of the page load is code for screens most people never open? About a
quarter — 367,680 gzip bytes of the 1,403,987 every visitor downloads.**

### Correction to the roadmap's candidate list

The roadmap names **hiring** as a split candidate. There is no hiring fragment. Hiring is
an **admin-only tab inside Kasper**: `_kasperState.tab === 'hiring-process'` gated by
`_syncviewStaffCan('hiring')` (which returns `role === 'admin'`), implemented across
`320-kasper-dashboard-replies.js.part` and `330-kasper-review-history.js.part`, with the
capability check in `100-onboarding-staff-controls.js.part:1292` and one call site in
`310-tiktok-pilot-sales.js.part:1248`. It cannot be split on its own; it moves with
Kasper. The table above folds it into the Kasper row.

---

## 6. Why the in-app browser pane could not be used

The task specified the Claude desktop Browser pane. It cannot produce these numbers:
pages there load with `document.visibilityState === "hidden"` (a `visibility-state`
entry at t=0), and Chrome **suppresses `paint` and `largest-contentful-paint` entries
entirely** for pages that start hidden, while throttling timers and `requestAnimationFrame`.
The pane reports hidden even while visibly rendering on screen, so no user action fixes it.
`getEntriesByType('paint')` returns `[]`, and any time-to-interactive measured there is
distorted by throttling. An iframe harness inside the pane has the same problem.

A later session repeating §4 should use the Playwright path, not the pane.

---

## 7. Recommendation for step 2 — **projection, not measurement**

> Everything in this section is an **estimate**. Nothing below has been measured.
> The measured numbers are §2, §3 and §5 only.

### Split in this order

1. **Samples** (`270`, `280`, `290`) — 124,543 gzip B, **8.9%**. Biggest single win,
   three whole fragments, one clean feature boundary.
2. **Kasper + hiring** (`320`, `330`) — 92,555 gzip B, **6.6%**. Second biggest, and the
   hiring tab inside it is admin-only, so most staff and *every* client carry code they
   can never reach. Split Kasper and hiring together; they are not separable.
3. **TikTok** (`300`, `310`) — 54,613 gzip B, **3.9%**.
4. **Onboarding + staff controls** (`100`) — 43,358 gzip B, **3.1%**. Caution: `100`
   also holds `_syncviewStaffCan`, the capability gate other areas call. Extract the gate
   into the always-loaded core before splitting this one, or it will pull Kasper back in.
5. **Time off + reports** (`110`) — 34,613 gzip B, **2.5%**.
6. **Editors + date picker** (`340`) — 17,998 gzip B, **1.3%**. Smallest; do it last, and
   verify first that the date picker is not used by the calendar core — if it is, it
   belongs in the core and this row disappears.

Doing 1–3 removes an estimated **271,711 gzip B (19.4%)** from first load. All six
remove **367,680 gzip B (26.2%)**.

### What the saving is worth — and what it is not

**Projected, for the cold first visit only:** 1,403,987 → ~1,036,307 gzip B, a 26%
smaller document. Parse-and-execute is the dominant cost of a 5.75 MB decoded script, so
the honest expectation is that staff cold time-to-usable (median 1,171 ms) improves by
roughly its share of parse time — **plausibly 150–350 ms**. That is a projection from
byte share, not a measurement, and it could be materially smaller if boot time is
dominated by network round trips rather than parsing.

**It is worth stating plainly what step 2 will not fix.** On a warm reload the entire
page transfers **300 bytes**, and the client still waits **3,601 ms** for content.
Splitting 26% off a 300-byte transfer saves nothing. **For the client's repeat visit —
the most common visit a client makes — code splitting is projected to deliver ~0 ms.**

### The larger finding, outside step 2's scope

The client-view gap (4,564 ms cold / 3,601 ms warm, versus staff's 1,171 / 795) is
**not a bytes problem and code splitting will not touch it.** §3.4 shows the review list
waiting on `Metrics` and `Clients Info`, with content landing 344–520 ms after the later
of them on 10 of 10 runs, while `TopVideos` — the slowest request every time — is not on
the critical path at all.

Two changes are projected to be worth far more to clients than the entire modularization:

- **Take `Metrics` and `Clients Info` off the client's critical path** (render the review
  list from Supabase and let the Sheets data fill in after). Projected to remove
  **~1.5–3.0 s** from client time-to-content, cold and warm alike.
- **Do not fetch `TopVideos`, `Competitor Briefs`, `Market Research Briefs` or
  `ContentSummaries` on the client review view at all.** Projected to save little
  time-to-content directly, but it removes the slowest request on the page and frees
  connections for the two that do block.

Both are outside phase C. Recommend raising them with the owner as their own item rather
than folding them into step 2, which should stay a pure build-output change so its
render-identity gate stays meaningful.

---

## 8. Reproduction

- Offline: `node docs/syncview-design/tests/prod-boot-budget.js` (needs live-backend egress).
- Live: the driver in §4. It was run from a scratchpad, not committed — it takes the
  page URL from the environment, and for the client view that URL carries a share token
  and a client display name, neither of which belongs in a public repo. §4 is complete
  enough to rebuild it in a few minutes.
- Sizing: `ls -l src/index/*.part` for raw bytes; `zlib.gzipSync(buf, {level:9}).length`
  per fragment for gzip.
