# Load only the tab you open

**Status:** approved by the owner 2026-09-28 up to and including step 4 (switch on for
staff only). Step 5 (client links) was given its own go by the owner on 2026-09-29, who
waived the week of staff use (step 4 had been live since 2026-09-29 and passed Vigil's hand
test). Step 5 is built, see "Step 5" below.
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

- 95 recorded hazards: 42 buttons and 53 guards that reach into another on-demand area.
- The approve path borrows 110 names from staff-only areas. Most are the Calendar write
  flags that live in the Time Off file (`110`), the client comment gateway in SyncLinear
  (`210`–`250`), and the client-name helpers in Workload (`070`). They are state and
  helpers, not screens; step 3 moves them into core.
- A client link today calls functions in eight staff-only areas during start-up (named in
  the fragment-usage report). Each is on the step 3 worklist for its area.
- The browser check found 2 Samples buttons (`_sxrTabScrollBy`, `_sxrUpdateTabScroll`)
  that work today only because the page is one classic script; they are named constants,
  not on `window`. They must be put on `window` before the page runs as real modules.

## Step 2 (2026-09-28): how the switch works

GitHub Pages serves the committed files as they are, so the switch lives in the build:
`src/index/split.json`. Off (the default and the way back), `index.html` is the plain
concatenation, byte for byte what it was, and nothing else is written. On, the main
script moves into content-hashed files under `js/` and a small loader takes its place:

- **Client links, the intake and onboarding forms, signed-out visitors: `full`.** One file,
  `js/sv-full-<hash>.js`, holding the same script that was inline, byte for byte. This is
  how "client links keep today's single file" holds in step 4: same code, one file,
  loaded at the same moment in the page; the only difference is that it is a separate
  download the browser can keep between visits.
- **Signed-in staff: `parts`.** The same script cut into 16 runs of consecutive fragments
  of one area, in page order. Step 3 then moves one area at a time from "loaded in
  order" to "loaded when its tab opens".
- Hashed names mean a page from the browser's cache only asks for the files it was
  built with. Every file records that it ran; if one did not arrive, the page reloads
  itself once.

Measured on the split build (offline, all gates): `index.html` drops from 5.9 MB to
0.9 MB (markup and styles); the full script is one 5.0 MB file. Every browser gate passes
on it, both as it would ship and with everyone, clients included, on the parts.

## Step 3, area 1 of 9: TikTok (2026-09-28)

- 040 gains the area registry: `svAreaRegister`, `svAreaApi`, `svArea`, `svWithArea`, and a quiet
  background fetch of the remaining on-demand areas once the first screen is up. An area that
  has not loaded has nothing to tear down or re-render, so `svAreaApi` returning null is the
  honest answer; a tab that needs one draws it through `svWithArea` (at once when the code is
  here, which is always on the single-file page; else "Loading…", then the tab, or a Retry).
- 300 registers `render`, `mount`, `teardown`, `isMounted`, `renderForm`; 040 (roster
  refresh) and 090 (navTo draw and teardown) go through the registry. No fragment imports from
  300 any more, and its one recorded guard is gone.
- `split.json` lists `"lazy": ["tiktok"]`; `check-lazy-safety.js` now fails if a lazy area still
  has an import tie or a recorded button or guard pointing into it.
- Found on the way: the Workload area (`090`) holds `navTo`, the router every tab uses, so
  Workload can only go on demand after the router moves to core. That move is part of the
  Workload step.

## Step 3, area 2 of 9: Editors (2026-09-28)

`340-editors-date-picker` was three things in one file: Kasper's Editors board, the block that
puts Kasper's button functions on `window`, and two site-wide features (the styled hover
tooltip and the date picker) that every page uses, client links included. It is now two
consecutive fragments with the same bytes, so the served page is byte-identical:

- `340-kasper-editors-board`: the board and the `window` bridges. Area **kasper** (it is
  Kasper's code), so it goes on demand with Kasper, not on its own. This also drops Kasper's
  outside import ties from 56 names to 37, since `330` importing `_kedPaint` is now inside the
  area.
- `345-core-tooltip-date-picker`: the tooltip and the date picker. **core**.

The separate "editors" area no longer exists; the remaining order is Today and SMM clients,
Submit, Time off, Templates and Filming, Workload, Kasper (with the Editors board), SyncLinear.

## Step 3, areas 3 and 4 of 9: Today, SMM clients and Submit stay in core (2026-09-28)

Since #1798 the bare address opens Today for staff, so Today is the first screen of almost
every staff visit. Loading it on demand would make that first screen wait for an extra
download: the opposite of the goal. SMM clients (`098`) is used only by Today. And core
already leans on Today in three places: the "My clients" part of the client dropdown (`095`),
the sign-out purge (`100`) and start-up (`260`). So both move to **core** in `areas.txt`; the
three recorded Today guards are no longer hazards and leave the baseline (91 left). Nothing
served changes.

**Submit (`200`) stays in core too.** The file is three things: the Submit form screen (its
first ~190 lines, only 2.8 KB compressed), the background queue that sends submissions and
writes their Calendar cards (resumed at start-up and used by the approve path: `180`, `290`),
and start-up plus Kasper access checks. Only the form could go on demand, and 2.8 KB is less
than one extra network round trip costs. So `200` is core; six more recorded guards stop
being hazards, including the approve path's `290` → `_linearResumeSubmissionHold` (85 left).

Compressed sizes of what is left to split, which is where the gain is: SyncLinear ~213 KB,
Workload ~138 KB, Kasper with the Editors board ~133 KB, Templates and Filming ~39 KB,
Time off ~37 KB.

Remaining order: Time off, Templates and Filming, Workload, Kasper (with the Editors board),
SyncLinear.

## Step 3, area 5 of 9, part 1: Time off split three ways (2026-09-28)

`110-time-off-reports` was three consecutive sections, now three fragments with the same bytes
(the served page is byte-identical):

- `110-time-off` (area **time-off**, ~23 KB compressed): the Time Off tab and admin.
- `112-smm-weekly-reports` (area **smm-weekly**, ~11 KB): the SMM weekly report form (a public
  entry, which always gets the full file) and the staff reports list.
- `115-core-calendar-flags` (**core!**, pinned with the approve path in `areas.txt` and in
  `check-lazy-safety.js`): the Calendar write-routing flags and their setters. The approve path
  used to import 37 names from the Time Off file for these; it now imports none from Time off,
  and its ties into staff-only areas fall from 110 names at step 1 to 56.

Time Off's own outside ties drop from 54 names to 11. Part 2 makes Time off load on demand.

**Part 2 was dropped (owner, 2026-09-28): Time off stays in core.** Wiring it through the
registry changes lines the leave-evidence fingerprint hashes (`qa/pto-lifecycle/review.js`),
which would mean re-reviewing 101 approved screenshots for ~23 KB. Before each remaining
area, check whether it touches an approved-screenshot fingerprint; if it does, the owner
gets the size saved and the screenshot count before anything is built. `areas.txt` now marks
`110` **core**, so its six recorded hazards are no longer hazards.

## Step 3, area 6 of 9, part 1: Templates and Filming lose their shared tail (2026-09-28)

Fingerprint check first: the only approved-screenshot fingerprint over the page's code is the
leave-evidence one, and no line of `060` matches it, so this area needs no re-review.

`060-templates-filming` ended with state the whole app reads: the current tab (`currentNav`,
read by 13 other files, the approve path among them), the Submit form's settings and receipts
keys, and the client-project list the form loads. That tail (~4 KB compressed) is now
`065-core-nav-intake-state`, **core**, with the same bytes, so the served page is
byte-identical. `060` keeps Templates (~21 KB), the onboarding inbox it shows (~11 KB) and
Filming plans (~5 KB). Its outside ties drop from 52 names in 16 files to 23 in 6; the approve
path now imports nothing from it. Four recorded guards moved with the tail and are renamed in
the baseline (79 left, after the six Time off ones above). Part 2 makes Templates load on demand.

## Step 3, area 6 of 9, part 2: Templates and Filming load on demand (2026-09-28)

Fingerprint check: none of the lines this changes match the leave-evidence fingerprint
(`test/leave-evidence-fingerprint-coupling.js` and `test/pto-ui-wiring.js` pass unchanged), so
no screenshot re-review. Saves ~37 KB compressed from every staff first load.

- `060` registers the area `templates`: the Templates and Filming plans tabs, the filming-plan
  list the Submit form and Kasper read, the onboarding inbox (Kasper's Onboarding subtab and the
  `?onboarding_view=` viewer), and the sign-out clean-up of its private data. Live state (the
  inbox list, whether it is loading) is read through getters.
- Callers: `090` navTo draws both tabs with `svWithArea`, and the Submit form's filming-plan
  lookup waits for the area with `svArea`; `050` redraws Templates only when it has loaded;
  `095` sets the Filming plans search before the tab draws; `100` clears the area's private data
  on sign-out only if it has loaded (if not, there is nothing to clear); `260` opens the
  standalone onboarding viewer through `svArea`; `320` Kasper draws its Onboarding subtab with
  `svWithArea`, reads the unread count only once the list exists, and fetches the area quietly
  for its tab count. `040` now exports `svArea`.
- `split.json` lists `tiktok` and `templates` as lazy. Templates has no outside import ties; one
  recorded guard is gone (78 left). `split-load-browser.js` now opens every view of an area cold
  (Templates and Filming plans) and requires one download each.

Remaining order: Workload (the router moves to core first), Kasper (with the Editors board),
SyncLinear.

## Step 3, area 7 of 9, part 1: Workload's shared pieces become core (2026-09-28)

Fingerprint check: the leave-evidence fingerprint hashes the Time Off lines of the page in
order. Workload holds one of them (in `navTo`), and a same-bytes split keeps every line in
place, so no screenshot re-review.

Workload (~116 KB compressed) was used by 27 other files, the approve path among them, for
four things that are not the Workload board: its state object (read by a loading skeleton),
date helpers, the client-name list and helpers, and the page router `navTo` with the Submit
form helpers. Those now sit in their own core fragments, cut with the same bytes in the same
order, so the served page is byte-identical:

- `070-workload-source` became `066-core-workload-state` (core), `067-workload-board-source`,
  `068-core-workload-dates` (core), `069-workload-planning-helpers`, `070-core-client-names`
  (core) and `071-workload-planner`.
- `090-workload-popovers-navigation` became `090-workload-popovers` and
  `092-core-submit-form-navigation` (core: the Submit form helpers, the tab favicon and pill,
  and `navTo`).

About 25 KB compressed of it is core; the rest (~90 KB) is Workload. Its outside ties drop from
32 names in 28 files to 11 in 5, none from the approve path. 17 recorded hazards are gone; two
guards now sit in the core router (`092` → `_kasperTeardown`, moved from `090`, and
`092` → `_wlV2Teardown`, which became a cross-area guard when the router left Workload; part 2
routes it through the registry). 63 recorded hazards. Workload is now three runs of fragments
(`067`, `069`, `071`–`090`) with core between them, so part 2 also lets an on-demand area be
built from several runs into one file.

## Step 3, area 7 of 9, part 2: Workload loads on demand (2026-09-28)

Fingerprint check: the Time Off line in `navTo` is untouched and keeps its place;
`test/leave-evidence-fingerprint-coupling.js` passes, so no screenshot re-review. Saves
~90 KB compressed from every staff first load.

- `090` (Workload's last fragment) registers the area `workload`: draw, start, tear-down, the
  Supabase client, the sign-out purge, the quiet refresh after sign-in, and the two due-date
  receipt hooks the Production writes use.
- Callers: `092` navTo draws Workload with `svWithArea` and tears it down through the registry;
  `100` purges and refreshes it only when it has loaded (its plan data lives only in memory, so
  there is nothing to clear before it loads); `230` updates a loaded board from a Production due
  write, and always sends the cross-tab due receipt (loading Workload for it if needed), since
  that receipt is what makes Workload boards in other tabs refetch; `260` Production's realtime
  gets the Supabase client through `svArea`.
- Moved into core, because they only use core pieces: the Workload v2 read switch
  (`_wlV2Enabled`, into `066`), which the router reads before it drops `?wl2` from the address;
  and `wlOpenInContentCalendar` (into `092`), so Today opens a card without waiting for
  Workload. The Submit form's search suggestions escape names with core `_calEscAttr`, which
  escapes the same five characters as `wlEscape`.
- `scripts/index-split.js`: an on-demand area may now be several runs of fragments with core
  between them; its runs are one file, in page order. Workload is `067`, `069` and `071`–`090`.
- `split.json` lists `tiktok`, `templates` and `workload` as lazy. Workload has no outside import
  ties; five recorded guards are gone (58 left).

## Step 3, area 8 of 9: Kasper loads on demand (2026-09-28)

Fingerprint check: Kasper holds 15 of the lines the leave-evidence fingerprint hashes (its Time
Off subtab), and the leave page calls two Kasper functions on hashed lines (`_kasperSetTabCount`,
`_kasperGotoTab`). None of those lines is edited or reordered: the two Kasper pieces that must stay
loaded and contain hashed lines (the subtab list and `_kasperRefreshTabCounts`) are cut out in
place, and everything else that moves contains no hashed line.
`test/leave-evidence-fingerprint-coupling.js` passes unchanged, so no screenshot re-review. Kasper
is ~112 KB compressed; ~11 KB stays loaded and ~100 KB now loads on demand.

- **Nothing on the approve path changes.** The sample-review approve path (`270`, `290`, `120`)
  used ten Kasper names. The ones it needs whether or not Kasper is open (the review state, its
  saved copy and the two save functions, the client-map loader, the sample-repair resume, the
  tab counts) move into core with the pieces they use; its lines are untouched.
- `305-core-kasper-shared` (new, core): those pieces, in their original order, plus Kasper's
  dropdown and show-password widget (the staff sign-in form uses it before Kasper loads),
  `_svOpenStaffPage`, `CA_RECENT_KEY`, and stand-ins. `320-kasper-dashboard-replies` became
  `320-core-kasper-subtabs` (core), `321-kasper-dashboard-replies`, `322-core-kasper-tab-counts`
  (core) and `323-kasper-dashboard-tail`.
- **Stand-ins** (core `305`): `_kasperPaintReview`, `_kasperOpenLightbox`, `_kasperGotoTab`,
  `_kasperFallbackToReview` and `_ccOpenModal` keep their names, so every caller's line stays as
  it was (the approve path's guards, the leave page's hashed line, the Calendar menu's button),
  and forward to Kasper's real function (renamed `...Now`) once Kasper has loaded. Painting does
  nothing before that (none of Kasper is on screen); the others load Kasper first.
- `340` registers the area `kasper`. Callers: `092` navTo draws Kasper and the standalone staff
  pages (Onboarding, Client Credentials) with `svWithArea` and tears down through the registry;
  `100` sign-out purges Kasper's hiring, client and credential data if it has loaded and always
  clears the saved recent-clients list; `100`'s identity-change repaints and `110`'s flag-change
  redraw go through the registry; `060`'s onboarding and filming redraws too.
- `split.json` lists `kasper` as lazy (switch still off). Kasper has no outside import ties;
  20 recorded hazards are gone (38 left).
- **Review fixes (Codex, #1841), which apply to every on-demand area:** (1) `svArea` now starts an
  area's download only once the document has finished loading, since an area uses always-loaded
  fragments that sit later in the page than the start-up router, and a refresh on an on-demand tab
  asks for the area while the page is still being read; `split-load-browser.js` refreshes on
  `#kasper` with the slowest always-loaded part delayed (it failed with the fix removed). (2) A
  Kasper download that fails when started from a button (Calendar Credentials, the thumbnail zoom)
  now shows a message; pressing the button again retries.

## Step 4: the split is switched on for staff (2026-09-29)

`src/index/split.json` is `enabled: true`, lazy areas TikTok, Templates, Workload, Kasper.
Signed-in staff get the loader plus content-hashed parts; **client links, forms, signed-out
visitors and the public entry links keep getting the whole script** (`js/sv-full-*.js`), the
same code unsplit. Numbers: `docs/audits/2026-09-29-step4-first-load.md` (staff on phone 4G:
-19% download, -33% time to ready; client link unchanged apart from +2 KB).

- **Tests.** Several hundred suites and about 23 scripts read the app's source out of
  `index.html`. `test/helpers/single-file-index.js` is a preload that answers a read of
  `index.html` with the plain concatenation (byte-identical to the switched-off build), and
  `test/run-all.js` passes it to every suite through `NODE_OPTIONS`. The leave-evidence
  fingerprint files under `qa/pto-lifecycle/` are not edited (that would change the
  fingerprint); the two workflow steps that run them pass the preload from outside. Browser
  suites that serve `index.html` from disk still get the real loader and parts.
- **Way back, one step:** `node scripts/split-switch.js off`, commit, merge (`status` and `on`
  also exist). One browser: `?split=0` / `?split=1`.
- `scripts/prune-split-js.js` lists (or with `--delete` removes) `js/sv-*.js` files no recent
  `index.html` names.
- Step 5 (client links): see below.

## Step 5: client share links get the split parts (2026-09-29)

Owner's go, 2026-09-29, waiving the week of staff use. A client link (`?c=` or `?t=`) now
gets the loader plus the same content-hashed parts staff get, minus the four on-demand areas
(TikTok, Templates, Workload, Kasper). **Forms (intake, onboarding, onboarding view), the SMM
weekly report and signed-out visitors still get the whole script as one file.**

- **What changed.** `scripts/index-split.js`: the loader sends a client link to the parts when
  `split.json` says `"clients": true` (missing means false, so an old config keeps the single
  file). A client link never gets the quiet background download of the on-demand areas
  (`self.__svLoad.client`, checked in `040`'s `_svPrefetchAreas`): a client has none of those tabs, and
  an area it did ask for would still load through `svArea`. The loader now reads `?split=0`
  on a client link (before, the client check returned first, so the opt-out never stuck there).
  **This line originally claimed the way back worked on a client link. It did not on the live
  site:** the client link check refused the extra key ("This link isn't valid"). See the fix below.
- **Ways back, three.** Everyone: `node scripts/split-switch.js off`, commit, merge (index.html is
  the single file again, byte for byte). Client links only: `node scripts/split-switch.js clients off`
  (staff keep the parts). One browser: `?split=0` (sticks; `?split=1` clears it); on a client link this works only from the fix below on.
  `test/index-split.js` runs the real loader against a fake browser for 16 kinds of visitor with
  clients on and off; `test/split-switch.js` covers the config; `split-load-browser.js` covers the
  shipped page in a browser, including that a client link fetches no staff-only file.
- **The client approve and request-changes code did not change.** It is `core!` and every part of it
  is in always-loaded files. `test/client-review-requests-unchanged-browser.js` and
  `test/calendar-client-carveout-byte-identical-browser.js` both serve the real page from disk, so they
  now run on the parts (each asserts it was served as "parts") and compare the same goldens recorded
  from `main`. One change to the carve-out test: it ignores the random suffix of a NEW COMMENT'S ID
  (`c_<clock>_<random>`), because the test seeds "random" and one line of Workload's start-up code
  (an id for the live plan sync) drew one value on a client link before and no longer runs there, which
  shifts every later value by one. The clock part of the id, and everything else, is still compared byte
  for byte. The other test already normalised the comment id.
- **Numbers:** `docs/audits/2026-09-29-step5-client-first-load.md`.
- Vigil hand-tests the live client link (test client only) after merge; the checklist is in the PR.
- Left for step 6: measure everything again, and the still-unsplit areas (SyncLinear stays in core by
  the owner's decision).

### Step 5 fix: `?split=0` / `?split=1` on a client link (2026-09-29)

Vigil found on the live site that adding `&split=0` or `&split=1` to a client link showed "This link
isn't valid". Cause: the client link check (`SYNCVIEW_CLIENT_ENTRY_KEYS` in `260`) accepts only the keys
`c`, `t`, `v` and `sxr` and refuses anything else as `mixed_entry`, and #1868 taught the loader to read
`split` on a client link without teaching the check. The #1868 tests did not notice because
`split-load-browser.js` only asked which script the page loaded (`self.__svLoad.mode`), not whether the
link was accepted; it now also checks that the review card draws and no "isn't valid" screen shows.

- **The check now accepts `split`, and only that:** exactly one `split` key, with the value `0` or `1`.
  `split=2`, an empty or repeated split, `SPLIT`, `splitx` and every other key (alone or next to `split`)
  are refused as before, and no verify request is sent for them. `split` never stands in for a credential.
- **The key leaves the address.** The loader removes `split=0|1` from a client link's address right after it
  has read it (only when there is exactly one `split`, so a repeated key stays and is refused), and the
  check's canonical rewrite after verification drops it too (this covers the single-file page, where there is
  no loader). The rest of the link is untouched.
- **Tests:** `test/client-entry-preflight.js` (the check itself, including each refused key) and
  `docs/syncview-design/tests/client-link-split-key-browser.js` (real client links for Calendar, Samples and
  Analytics with `&split=0` and `&split=1` through the real check, the address afterwards, the way back
  sticking and clearing, and the refused cases). Run against `main` before the fix it fails with "This link
  isn't valid".

