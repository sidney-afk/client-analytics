# Load only the tab you open

**Status:** approved by the owner 2026-09-28 up to and including step 4 (switch on for
staff only). Step 5 (client links) needs the owner's separate go after a week of staff use.
Written by the session named Mason. This is roadmap phase C2
(`docs/plans/2026-09-21-post-modularization-roadmap.md`), planned now that every script
fragment is an ES module (C3, `docs/plans/2026-09-24-modularization-c3-plan.md`).

## The idea

Today every visit downloads the whole app: one 5.9 MB file, 1.44 MB compressed. The plan
splits it into an always-loaded **core** (sign-in, the client link check, routing, shared
helpers, and the whole client approve / request-changes path) and one file per
**staff-only area**, fetched the first time its tab opens. Staff get the other areas
quietly in the background once the first screen is showing.

**The client approve / request-changes code stays in core and is never split** (owner,
2026-09-28). `src/index/areas.txt` marks it `core!`, and `scripts/check-lazy-safety.js`
holds a second copy of that list and fails if either moves.

## Baseline (2026-09-28)

Today's live page, byte-identical to `main`, served locally with gzip and timed in
headless Chromium (5 cold loads each, median). The sandbox browser cannot reach the live
site through its proxy, so this measures what the code costs, which is the only part this
plan changes. "Ready" is DOMContentLoaded: the whole file read and run.

| profile | download | ready |
|---|---|---|
| desktop | 1,443,114 B | 756 ms |
| phone, typical 4G (9 Mbps, 60 ms, 4x slower CPU) | 1,443,114 B | 3,073 ms |
| phone, slow (1.6 Mbps, 150 ms, 4x slower CPU) | 1,443,114 B | 9,090 ms |

Estimate, from test pages with the staff-only code removed (slightly optimistic):

| | download | ready, phone 4G | ready, phone slow |
|---|---|---|---|
| client link | 825 KB (−43%) | ~1.7 s | ~5.1 s |
| staff on Calendar | 704 KB (−51%) | ~1.5 s | ~4.3 s |

Not fixed by this plan: a client's repeat visit waits 2–4 s on two Google Sheets reads,
not on code (`docs/audits/2026-09-23-boot-baseline.md` §3.4).

## Steps (one PR each; same gates as C3; Vigil hand test whenever the served page changes)

1. **Safety nets, nothing served changes.**
   - `src/index/areas.txt`: every script fragment's area; the approve path pinned `core!`.
   - `scripts/check-lazy-safety.js` (CI, module-check job): the pin, and a one-way
     ratchet (`src/index/lazy-safety-baseline.txt`) on two quiet failures: a button whose
     code lives in another on-demand area, and a `typeof fn === 'function'` check that
     would silently skip work when that area has not loaded. Reports the import ties per
     area (the step 3 worklist).
   - `docs/syncview-design/tests/inline-handlers-browser.js` (CI, entry-links-boot job):
     opens every staff tab, the signed-out entry links and the client link with a review
     card open, and fails if any button names code that does not exist.
   - `qa/lazy/fragment-usage.js`: which areas' code actually runs on each screen, written
     to `docs/audits/2026-09-28-fragment-usage.md`.
2. **The build makes both versions.** Today's single file plus a split version behind an
   on/off switch, left off. Split files carry a fingerprint of their contents in their
   name, so an old core only ever fetches its matching old files. Turning the switch off
   is the way back at every later step.
3. **Cut the ties, one area per PR, easiest first:** TikTok, editors, Today and SMM
   clients, Submit, Time off, Templates and Filming, Workload (its client-name helpers move
   to core first), Kasper, SyncLinear last. Shared state the approve path borrows from an
   area moves into core in that area's PR; the approve-path code itself is not split.
4. **Switch on for staff only.** Client links keep the single file. A week of normal use.
5. *(Needs the owner's separate go.)* Client links, the test client first, Vigil hand tests
   on a phone, then everyone.
6. Measure again the same way; write the numbers next to this baseline.

## Step 1 findings (2026-09-28)

- 94 recorded hazards: 42 buttons and 52 guards that reach into another on-demand area.
- The approve path borrows 110 names from staff-only areas. Most are the Calendar write
  flags that live in the Time Off file (`110`), the client comment gateway in SyncLinear
  (`210`–`250`), and the client-name helpers in Workload (`070`). They are state and
  helpers, not screens; step 3 moves them into core.
- A client link today calls functions in eight staff-only areas during start-up (named in
  the fragment-usage report). Each is on the step 3 worklist for its area.
- The browser check found 2 Samples buttons (`_sxrTabScrollBy`, `_sxrUpdateTabScroll`)
  that work today only because the page is one classic script; they are named constants,
  not on `window`. They must be put on `window` before the page runs as real modules.
