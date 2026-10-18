# Speed sweep, 2026-10-17

**Session:** Stopwatch (supervisor: Lighthouse), at the owner's request "make sure
everything is fast, everything is optimized, no hiccups". Speed only; session
Patrol had glitches and bugs.
**Compares against:** `docs/audits/2026-09-23-speed-map.md`, `2026-09-24-speed-map.md`,
`2026-10-01-synclinear-speed.md`, and `docs/syncview-design/tests/prod-boot-budget.js`.
**Reads only. No backend writes. Test client only.**

---

## 1. Headline

- **Most of the site is fast now.** Every staff page tested shows its content in
  1.0 to 2.0 s on a first visit and 0.8 to 1.3 s on a reload; calendar view
  switches (Review, Sheet, Month, Week) take 20 to 90 ms; most tab switches
  take 30 to 230 ms.
- **The biggest hiccup was invisible in the old maps:** every staff page load
  downloaded about 2.3 MB of Analytics data nobody on that page sees, and froze
  the page for 0.25 to 1.6 s while processing it, 3 to 5 s after it was ready,
  when staff are already typing. Fixed in #2168.
- **Six fixes, one per PR**, each measured before and after on the live site
  (section 4): Analytics extras on demand (#2168), Workload's two reads in
  parallel (#2169), Kasper's skip notes read in parallel (#2172), the client
  review link's check started in the page head (#2184), Calendar's and
  Samples' card read started in the page head (#2185), and the Kasper-seen
  ledger saved once per batch instead of once per post (#2189).
- **Still slow on a first visit:** the first switch to SyncLinear (~2.0 s), to
  Kasper (~1.6 s after #2172), and to Workload (~1.0 s after #2169). Section 5
  lists what I found and did not fix.

## 2. Rig

- Playwright Chromium, 1440×950, the live site `syncview.synchrosocial.com`,
  live backend. Fresh browser profile per load ("cold"), or the same profile
  reloaded ("warm").
- **Staff sign-in: the repo's robot pattern** (as `qa/dawn/dawn-check.js` and
  `qa/staff-gate-seed.js`): a stub identity "QA Staff" in the stored sign-in,
  `key-verify` answered locally, and the runner's staff role key on every
  function call. No real person's account. Every request that is not a read
  (any non-GET outside a short list of read-only functions) was aborted and
  counted; Linear's API was refused.
- **Client link:** the test client's real review link, its token resolved by
  `qa/test-client-entry.js`; staff identity absent.
- **Before/after:** both builds served **from disk on the live origin** (the
  live build downloaded once, the candidate built locally), interleaved
  live/candidate, so network luck and script delivery affect both equally.
  Plain-network numbers in section 3 vary by about ±300 ms run to run.
- Artifacts of the robot, not product findings: `team_members?id=eq.qa_staff`
  answers 400 (the stub id is not a real one).

## 3. What was measured (live site, before any fix)

**Page loads**, time until the page's own content shows (cold / warm):

| page | ready cold | ready warm | first paint | requests | slowest at the end |
|---|---|---|---|---|---|
| Today | 0.35 s* | 0.33 s* | 0.24 to 0.43 s | 68 | — |
| Calendar (Sheet) | 1.78 s | 1.18 s | 0.37 to 0.63 s | 38 | `calendar_posts` |
| Samples | 1.52 s | 1.22 s | 0.37 to 0.54 s | 35 | `sample_reviews` |
| Templates | 1.45 s | 1.31 s | 0.21 to 0.58 s | 36 | templates script |
| Filming | 1.56 s | 1.00 s | 0.24 to 0.29 s | 39 | `filming-plans` |
| Post | 1.11 s | 0.95 s | 0.21 to 0.26 s | 35 | tiktok script |
| Workload | 1.63 s | (noisy) | 0.21 to 0.24 s | 42 | `production_deliverables_browser_v1` |
| SyncLinear | 2.01 s | 1.05 s | 0.23 to 0.26 s | 48 | deliverables pages |
| Submit | 0.85 s | 0.84 s | 0.23 to 0.27 s | 19 | scripts |
| Analytics | 4.34 s | 1.03 s | 0.29 to 0.54 s | 39 | Metrics Sheet |
| Kasper | 1.45 to 2.7 s | 1.05 s | 0.22 to 0.50 s | 38 | `calendar_post_events` |
| Client link, Calendar (Review page) | 1.31 s | — | 1.22 s | 37 | `client-token-verify` |

\* Today paints its saved or early-read day; the first fresh read lands later.

Compared with the 2026-09-24 map (warm, first content): Calendar 1.79 → 1.18 s,
SyncLinear 1.15 → 1.05 s, Analytics 3.34 → 1.03 s warm. The page document is
now 243 KB plus about 22 scripts (the split from the load-per-tab plan), so the
shared floor before any tab's data is about 1.0 to 1.1 s on a cold load.

**Switching from Calendar** (page already loaded, first switch in the session):
Today 70 ms, Filming 27 ms, Messages 53 ms, Submit 107 ms, Samples 231 ms,
**Workload 1,279 ms, SyncLinear 1,783 ms, Kasper 1,960 ms**. These three load
their data on first entry; the 09-24 map's 43 / 128 ms were later switches.

**Calendar views:** Review 21 to 52 ms, Sheet 92 ms, Month 24 ms, Week 20 ms.

**Main-thread freezes after the page was ready** (Calendar landing, sum per
load): 386 to 1,649 ms, single freezes up to 1.5 s, all from processing the
Analytics extras (fixed in #2168).

**`prod-boot-budget.js`:** ready 361 ms, DOMContentLoaded 211 ms against budgets
of 6,000 and 3,500 ms. Comfortably inside; the budget only covers the offline
mocked SyncLinear boot.

## 4. What I fixed (one fix per PR, before → after, interleaved pairs)

| PR | fix | measured |
|---|---|---|
| #2168 | Staff pages no longer download the Analytics extras (top videos, briefs, summaries) until Analytics opens or a client page asks. Kasper's existing hold unchanged. | Calendar: Analytics data 2,643 → **593 KB**, freezes after ready 453 → **254 ms**, ready unchanged (904 vs 946 ms). Today: 2,644 → **593 KB**. |
| #2169 | Workload's archive-marker read starts beside the board read instead of after it (its request never used the board's answer). | Workload load 1,436 → **1,190 ms**; switch from Calendar 1,269 → **1,004 ms**. |
| #2172 | Kasper's review queue reads its skip notes (a fixed 14-day window) beside the calendars instead of after the sent-at read. | Kasper load 2,732 → **2,223 ms**; switch 1,817 → **1,639 ms**. |
| #2184 | The client review link starts its link check in the page head, with the app's own validity rules, and the app uses that answer only for a byte-identical request on the same address. | Client Calendar link: content ready 1,305 → **927 ms**, first paint 1,216 → **860 ms**. |
| #2185 | A `/calendar/<slug>` or `/sample-reviews/<slug>` load starts that client's first card page in the page head once the staff check passes (the Today/SyncLinear pattern), taken once by exact URL within 10 s. | Calendar cards visible 922 → **717 ms**; Samples 694 → **466 ms**. |
| #2189 | `_calMarkKasperSeen` rewrote the whole "seen by Kasper" ledger to localStorage on every new mark (hundreds per Kasper load in a fresh browser); now one write per batch. | CPU profile of the Kasper switch: ledger work ~200 → ~0 ms, queue processing ~410 → ~220 ms, switch ~1,900 → ~1,680 ms. |

Each PR carries a guard: a behavioural test that fails on the old code where
that was possible, and the measurements in its body.

Measured and dropped: reading `_kedRestIn`'s id chunks in parallel. It is a
real sequential chain, but Kasper's queue only ever had one chunk, so it made
no difference to anything staff wait on (1,865 vs 1,874 ms).

## 5. Found, not fixed

In rough order of how many people they cost time.

1. **The Analytics database copy of the numbers is more than 3 days old**, so
   every staff load (and every Analytics visit) falls back to downloading the
   Metrics Sheet (~300 KB) on top of the database answer. The page logs
   "numbers are older than 3 days, numbers from the Metrics Sheet, clients from
   the database". The daily copy of `metrics` into the database looks stalled.
   That is a data pipeline question, not page code; worth a look by whoever
   owns the Sheets move.
2. **Client review page (`195-review-stage.js.part`, off limits tonight):** the
   step strip shows each post's thumbnail at about 25×44 px but downloads the
   640 px Drive image (913 KB for the test client's post), and the same image
   is downloaded **twice** (at ~3.4 s and again at ~8.8 s). A strip-sized URL
   (`_calDriveImageUrl(id, p, 320)` is the smallest the helper allows; a
   dedicated small size would be better) and reusing the first download would
   save about 1.8 MB per client visit on a phone.
3. **The review-stage script (`188-review-stage-switch.js.part`, off limits)** is
   requested only after the switches answer (~1.7 s on the client link). It
   could be fetched in parallel with the link check for links whose client is
   on the switch.
4. **Calendar or Samples opened without a client in the address** (the saved
   client, or a click on the tab) still read their cards after the scripts
   load; #2185 covers addresses that name the client. The saved client could
   be predicted from local storage in the head the same way. The staff Samples
   card also downloads the 640 px Drive thumbnail (914 KB for the test client's
   sample); every view shares that one cached URL (`_calDeriveThumb`), so a
   smaller size needs a per-view decision, not a one-line change.
5. **Today reads its whole day twice on every load**: the early read, then once
   more when its live connection comes up (deliberate: a change between the two
   is never replayed). About 7 requests and 130 KB extra, off the critical
   path. Subscribing first, or skipping the re-read when the connection comes up
   within a second of the read starting, would remove it; a design call.
6. **First open of SyncLinear in a session** is ~2.0 s: four keyset pages of the
   deliverables view, one after another. Parallel paging was tried and rejected
   on 2026-10-01 (offset paging timed the database out). A reload paints from
   the saved copy in ~1.05 s.
7. **Kasper**: the 400 to 460 ms freeze right after the calendars arrive was
   mostly the ledger writes fixed in #2189. What is left is about 200 ms of
   shaping every client's posts plus Kasper's own queue cache write
   (`_kasperCalCacheWrite`, ~50 ms of `setItem`).
8. **Messages** could not be measured with the robot: the page stayed blank for
   10 s while three `team_members` lookups for the robot's invented id answered
   400. Probably the robot, but a blank page instead of an error message when
   that lookup fails is worth a look; passed to Patrol's ground.
9. Each load makes 4 to 6 `syncview_runtime_flags` reads besides the head's
   batch (150 to 450 ms each, in parallel, mostly off the critical path). Small.
10. A fresh browser's Analytics localStorage write fails on quota and spills to
    IndexedDB (handled); after #2168 it no longer happens on non-Analytics
    landings.

## 6. Reproduction

The probes were scratch scripts (not committed): Playwright with the robot
identity above, a request guard that aborts every non-read, readiness polled
every 50 ms on the selectors in the 2026-09-23 map §3 (Today `#tdyRoot .tdy-rw`,
Samples `#sxrView .cal-card` with a client in the address, and for the client
Review page the text "Finish reviewing" inside its shadow root), and for
before/after both builds fulfilled from disk on the live origin, alternating.
