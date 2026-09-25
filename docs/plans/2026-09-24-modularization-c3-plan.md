# Phase C, step C3: make the always-loaded core a set of ES modules (plan only)

**Date:** 2026-09-24 · **Session:** Mason
**Follows:** `docs/plans/2026-09-21-post-modularization-roadmap.md`, phase C step 3.
**Reads:** `docs/audits/2026-09-24-speed-map.md`, `docs/audits/2026-09-24-entry-tax.md`,
`docs/audits/2026-09-23-boot-baseline.md`, every fragment in `src/index/` at main `dbeee27`.
**This file is a plan. No app code, test or build script changed.** Counts and file
names only; no client names or slugs.

---

## 1. The answer in five lines

1. The 32 script fragments already cut cleanly: each one parses on its own, and none
   of them uses, *while the page is loading*, anything a later fragment defines. That
   is what makes a safe, one-fragment-at-a-time conversion possible.
2. The shared core is small by name and large by weight: **19 names are used by 10 or
   more fragments, 67 by 5 or more**. Most of them are escaping helpers, the
   notice/confirm dialogs, the backend address and key, the staff identity check,
   the client-name normalizers and the calendar's in-memory state.
3. Recommended shape: **write the fragments as ES modules, but keep shipping the same
   single script until the very end.** The build strips the `import` lines and the
   `export` words, so each conversion step produces a **byte-identical `index.html`**
   and can be checked against the base commit's page byte for byte (a check step 0 adds; §6). The runtime switch to
   real modules is one separate, measured step at the end (§6, step 13).
4. Order: pure helpers first, then shared state, then single-screen areas, then the
   production hub, and **the client approve / request-changes path last** (§5).
5. On-demand loading (C2) helps cold first visits and parse time. It does **not** help
   the tabs that are slow today on a warm load, because they wait on the sign-in check
   and on data, not on code (§7).

---

## 2. What a module is here, and why the order matters

Today every fragment is glued into one `<script>`. Anything any fragment declares at
its top level is visible to every other fragment by bare name: that shared space is the
"global scope", and it is the only interface between screens. Nothing states who uses
what, so a rename or a deletion in one screen can break another without warning.

An **ES module** is a JavaScript file that lists what it takes from other files
(`import`) and what it offers them (`export`). Anything not exported is private to that
file. Converting a fragment means writing those two lists down and making the tools
enforce them.

Three facts about ES modules decide the order of work:

- **An imported name cannot be reassigned by the importer.** If fragment A declares
  `let x` and fragment B does `x = 5`, B has to call a setter A offers instead. 122 such
  cross-fragment reassignments exist today (§4.3), so each conversion step fixes the ones
  it touches first.
- **Functions named in HTML click handlers must be on `window`.** A string like
  `onclick="_calClientApprove('p1')"` is resolved against the global scope when the
  user clicks. Inside a module, that function is private. This only bites at the runtime
  switch (step 13), and it bites on *click*, not on load, which is why it needs its own
  guard test.
- **`typeof x === 'function'` guards fail silently.** The page has 229 of them. In a
  module, a guard on a name that was never imported returns "not a function" and quietly
  skips the code, with no error anywhere. The module checker (step 0) has to treat an
  unimported name inside such a guard as an error.

---

## 3. How the map was measured

The assembled `index.html` at `dbeee27` was parsed with a standard JavaScript parser
(acorn) and a scope analyser (eslint-scope, the one ESLint uses). Every top-level name
was attributed to the fragment that declares it, and every use of it to the fragment the
use sits in. Inline handler strings (`onclick="..."` and friends, in HTML and in
template strings) were scanned separately. The scripts ran from a session scratchpad and
are not committed; step 0 below turns the same analysis into a checked-in tool.

| measure | count |
|---|---|
| inline `<script>` blocks | 3 (head boot in `005`, main script `040`→`340`, footer script in `350`) |
| top-level names in the main script | 4,435 (3,305 functions, 1,104 `let`/`const`, 1 `var`) |
| names used outside the fragment that declares them | 1,525 |
| ...used by exactly one other fragment | 1,038 |
| ...used by 2 or more other fragments | 487 |
| ...used by 5 or more | 67 |
| ...used by 10 or more | 19 |
| fragment pairs that use each other (two-way) | 115 |
| names reassigned from a fragment other than their own | 122 |
| inline handler attributes | 846 |
| functions called from those handlers | 528 (48 already copied to `window`, 480 not) |
| `window.x = x` copies already in the page | 652 |
| `typeof x === 'function'` guards | 229 |
| duplicate top-level function names | 4, all in `230` |
| uses, at load time, of a name a later fragment defines | **0** |
| main script parses as a module once the 4 duplicates go | yes, no other strict-mode syntax error |

---

## 4. The map

### 4.1 The shared core: what every tab leans on

Names used by 10 or more fragments, grouped by what they are and where they live today.

| group | names (users) | lives in | problem with where it lives |
|---|---|---|---|
| Escaping and HTML helpers | `_calEsc` (20), `_calEscAttr` (18), `_jsAttrArg` (16), `_svLoadingSkeletonHtml` (10) | `130-calendar-model-cache` | shared by every screen but sits in a calendar file |
| Notices and confirm dialog | `showNotify` (18), `showToast` (13), `showConfirm` (12) | `040-shared-briefs` | fine, but `040` also holds analytics state |
| Backend address and key | `CAL_SUPABASE_ANON_KEY` (22), `CAL_SUPABASE_URL` (19) | `100-onboarding-staff-controls` | shared config inside the onboarding file |
| Staff identity (the security gate) | `_syncviewStaffIdentityForHeaders` (17), `_syncviewRequireStaffIdentity` (10), plus 5 more at 5 to 7 users | `100` | same |
| Request headers | `_syncviewEfHeaders` (15) | `120-calendar-flags-write-repair` | shared, inside a calendar file |
| Client names | `wlNormalizeClient` (15), `WL_CLIENT_NAMES` (12), `wlCanonicalClient` (8), `wlIsAllowedClient` (6) | `070-workload-source` | shared, inside the Workload file |
| Which kind of link this is | `_isClientLink` (21), `_syncviewClientEntryCapability` (6) | `260-production-refresh-boot` | shared, inside the production file |
| Current screen | `currentNav` (11), `_syncviewNavEpoch`, `navTo` (6) | `060`, `090` | reassigned from 2 other fragments each |
| Calendar state | `calState` (13), `calClientSlug` (13), `_calPendingEdits` (7), `_calCommentsFor` (9) | `130` | also used by Samples, Kasper, Production |
| `fetch` itself | 27 fragments call it | wrapped in `070` (`wlWrapFetchForSnapshotWarm`) | every request in the app passes through a Workload hook once staff is confirmed |

The `fetch` row matters: `070` replaces `window.fetch` with a wrapper so that it can
notice Workload-relevant writes. Every other screen's requests go through it. It works
today and does not change in the strip-on-build stage, but it is a cross-screen side
effect that the Workload module must own explicitly and document.

### 4.2 Per fragment: how tangled each one is

"Uses" = names it takes from other fragments. "Offers" = its names other fragments use.
"Foreign writes" = other fragments' names it reassigns. "Handlers" = its functions named
in click/input strings. "On load" = top-level statements that run immediately (event
listeners, timers, `window.x = x` copies).

| fragment | declares | uses (from N frags) | offers (to N frags) | foreign writes | handlers | on load | reading |
|---|---|---|---|---|---|---|---|
| `040-shared-briefs` | 258 | 31 (9) | 128 (23) | 1 | 22 | 4 | shared UI **plus** analytics state that `260` and `050` reassign (25 names) |
| `050-market-briefs` | 159 | 110 (14) | 55 (7) | 12 | 22 | 1 | one screen; two-way with `060` (35 names each way) |
| `060-templates-filming` | 175 | 75 (12) | 42 (12) | 7 | 27 | 6 | holds `currentNav`, which other screens reassign |
| `070-workload-source` | 204 | 23 (8) | 99 (31) | 0 | 0 | 3 | offers the most names of any fragment: client normalizers, `fetch` wrapper |
| `080-workload-render` | 81 | 108 (8) | 12 (4) | 8 | 0 | 3 | screen-only |
| `090-workload-popovers-navigation` | 189 | 102 (23) | 19 (9) | 2 | 43 | 4 | Workload popovers **plus** app navigation (`navTo`) |
| `100-onboarding-staff-controls` | 238 | 62 (16) | 78 (27) | 8 | 8 | 1 | onboarding **plus** backend config and the staff gate |
| `110-time-off-reports` | 171 | 56 (9) | 40 (9) | 7 | 22 | 2 | time off **plus** 14 flag-state names that `120` reassigns |
| `120-calendar-flags-write-repair` | 179 | 56 (13) | 110 (24) | 14 | 0 | 4 | the write gateway (`_writeUi*`), shared by calendar, samples, Kasper |
| `125-title-name-rule` | 23 | 16 (8) | 4 (3) | 0 | 1 | 0 | already module-shaped |
| `130-calendar-model-cache` | 220 | 48 (10) | 134 (30) | 2 | 20 | 6 | the most-used fragment: calendar state **plus** app-wide escaping |
| `140-calendar-legacy-outbox` | 103 | 142 (14) | 50 (9) | 3 | 0 | 3 | Linear-era transport, still on the approve path (§8) |
| `150-calendar-hydration-import` | 86 | 104 (12) | 31 (18) | 13 | 18 | 1 | writes 13 names owned by `130` |
| `160-calendar-organize-ui` | 192 | 106 (15) | 63 (16) | 0 | 54 | 1 | most handler-called functions of any fragment |
| `170-calendar-links-status` | 121 | 113 (14) | 44 (13) | 1 | 16 | 3 | holds `_calClientApprove` |
| `180-calendar-native-post-media` | 113 | 129 (15) | 41 (11) | 11 | 19 | 2 | writes 9 caption-prompt names owned by `120` |
| `190-calendar-approval-comments` | 113 | 89 (10) | 39 (14) | 0 | 25 | 0 | review sheet approve / request tweak; Kasper uses 17 of its names |
| `200-intake-data-startup` | 70 | 67 (16) | 24 (9) | 4 | 10 | 0 | Submit screen |
| `210-production-state-writes` | 154 | 39 (12) | 84 (13) | 0 | 4 | 0 | production state |
| `220-production-attribution-views` | 127 | 76 (7) | 72 (7) | 1 | 11 | 0 | production |
| `230-production-create-comments` | 67 | 99 (13) | 29 (12) | 0 | 12 | 0 | has the 4 duplicate functions; client comment gateway |
| `240-production-description` | 105 | 36 (8) | 13 (4) | 0 | 21 | 3 | production, fairly self-contained |
| `250-production-controls-data` | 133 | 97 (8) | 63 (5) | 0 | 2 | 0 | production |
| `260-production-refresh-boot` | 104 | **215 (20)** | 26 (25) | **30** | 36 | 5 | the app's boot and router hub, not a production file |
| `270-samples-model` | 213 | 103 (15) | 58 (12) | 2 | 47 | 5 | samples, built on the calendar write gateway |
| `280-samples-cards-notes` | 180 | 138 (13) | 57 (9) | 0 | 23 | 2 | same |
| `290-samples-writes-review` | 90 | 158 (20) | 18 (10) | 4 | 15 | 11 | same; takes 33 names from `120` |
| `300-tiktok-upload` | 76 | 20 (2) | 11 (3) | 0 | 9 | 8 | **loosest area in the page** |
| `310-tiktok-pilot-sales` | 130 | 28 (7) | 9 (3) | 5 | 20 | 5 | loose |
| `320-kasper-dashboard-replies` | 235 | 90 (17) | 44 (10) | 1 | 38 | 4 | Kasper, tied to calendar state and `100` |
| `330-kasper-review-history` | 89 | 110 (14) | 24 (5) | 1 | 20 | 5 | Kasper review, tied to `190` approve/tweak |
| `340-editors-date-picker` | 33 | 27 (5) | 1 (1) | 0 | 7 | 29 | mostly `window.x = x` copies for Kasper |

### 4.3 Where state is reassigned across fragments (122 names)

These must become a setter call, or move to the fragment that writes them, before the
owning fragment can be converted. By owner:

| owner | count | written from | what it is |
|---|---|---|---|
| `040` | 25 | `260`, `050`, `060` | analytics profile state (charts, briefs, sort) |
| `130` | 15 | `150`, `140`, `260`, `290` | import wizard state, outbox timers, render flags |
| `110` | 14 | `120` | write-UI and settings flag state: **belongs in a flags module** |
| `060` | 12 | `050`, `090`, `100`, `200`, `320` | `currentNav`, nav epoch, onboarding view, Submit state |
| `100` | 10 | `260`, `110` | onboarding keys, time-off flag state |
| `120` | 9 | `180`, `290` | caption prompt jobs, last authority signature |
| `070` | 8 | `080` | Workload load generations and retry timers |
| `300` | 5 | `310` | TikTok timers shared by upload and pilot |
| `050` | 5 | `060`, `260` | template selection |
| others | 19 | various | 1–3 each |

### 4.4 Belongs to one screen only

1,038 of the 1,525 shared names have exactly one outside user, and 2,910 of the 4,435
top-level names have none. Those are private once their fragment is a module. The
fragments whose outside surface is smallest relative to their size are the natural
single-screen modules: `300` (offers 11 names), `310` (9), `340` (1), `080` (12), `240`
(13), `125` (4).

---

## 5. The riskiest couplings

Ranked by what breaks and who notices.

1. **Client approve and request changes.** `_calClientApprove` (`170`),
   `_calReviewApprove`, `_calReviewApplyApprove` and `_calReviewRequestTweak` (`190`)
   reach, within **two calls**, 217 names across **17 fragments**: the write gateway
   (38 names in `120`), the legacy outbox (37 in `140`), calendar state (22 in `130`),
   the review sheet (29 in `190`), render (20 in `160`), status and save (15 in `170`),
   review config (15 in `180`), **samples** (17 in `270`–`290`, which share the same
   gateway), the production client-comment gateway (`230`), client-link detection
   (`260`), the staff identity (`100`) and the confirm dialog (`040`). A mistake here is
   a client's approval that looks saved and is not. **Convert last**, one fragment per
   PR, each with the dawn-check approve and request-changes flows on the test client in
   addition to the standard gate.
2. **The write gateway is shared by three screens.** `120`'s `_writeUi*` family is used
   by calendar, samples (`290` takes 33 names) and Kasper review (`330` takes 19). It
   cannot be moved for one screen without moving it for all three.
3. **`260` is the router and boot, not a production file.** It uses 215 names from 20
   fragments and reassigns 30 names owned by others. Everything else should be a module
   before it, so that its imports are a list of finished modules, not a moving target.
4. **The staff gate lives in the onboarding file.** `100` holds the sign-in check that
   every staff data read waits on (`key-verify`, speed map §5.3). Moving it is a pure
   relocation, but a wrong import there is a security regression, so it gets its own PR
   and the `test/boot-entry-tax.js` and client-entry harness runs.
5. **480 handler-called functions are not on `window`.** Harmless until the runtime
   switch; then each missing one is a dead button, found only by clicking. Guard test
   required before step 13 (§6).
6. **229 `typeof` guards** can silently turn off code once names stop being global.
   The checker must flag every guard on an unimported name.
7. **Four functions are declared twice in `230`** (`_prodCommentDraftFor`,
   `_prodCommentDraftInput`, `_prodComposerHTML`, `_prodSubmitComment`). In today's
   script the second copy wins everywhere. A module refuses to load with a duplicate.
   Deleting the first copies is behaviour-identical but changes bytes.
8. **Tests read code out of `index.html` by text.** About 230 test files lift functions with
   the pattern `'function ' + name` (see `test/extract-function-integrity.js`). Writing
   `export function name(` keeps that text; converting functions to
   `export const name = (...) =>` would break those suites. **House rule for C3: export
   function declarations as they are; do not rewrite their shape.**

---

## 6. The plan: order of conversion, one PR each

### The mechanism (why most steps are provably zero-risk)

Stage 1 converts sources only. `scripts/build-index.js` learns one extra rule for
fragments marked as modules: drop their `import` lines and the leading `export ` word,
then concatenate as today. Because nothing is re-ordered, **the built `index.html` stays
byte-identical to the base commit's**, which proves "no runtime change" on every step that
only adds imports and exports.

**`npm run check:index` alone does not prove that.** It compares the assembled output
with the working tree and `HEAD`, and an annotate PR commits the regenerated page, so a
stripping bug would be present in all three copies and still pass. Step 0 therefore adds
a base comparison (`npm run check:index -- --against=origin/main`, or a separate script)
that fails unless the built page equals `git show <base>:index.html` byte for byte, and
runs it in CI on every PR labelled annotate-only. Until that exists, "byte-identical" in
this plan is a claim, not a check. A new checker (`scripts/check-modules.js`, step 0) parses
each module fragment as a real module and fails if it uses a name it did not import,
imports a name nobody exports, reassigns an import, or guards an unimported name with
`typeof`.

Steps that **move** code between fragments, or change a reassignment into a setter,
change bytes. Those get the full proof: `node docs/syncview-design/tests/prod-write-gateway-browser.js`,
`prod-boot-budget.js`, `npm test`, and a `/master-test` pass on the touched screens.

Stage 2 (step 13) is the one step that changes how the page runs.

### The steps

| step | PR | kind | proof | notes |
|---|---|---|---|---|
| 0 | Module checker + strip rule in the build + base comparison against the base commit's `index.html`; no fragment marked yet | tooling | byte-identical against base | checker = the analysis in §3, checked in; lists the 480 unbridged handlers and 229 guards as a report |
| 1 | Delete the 4 first-copy duplicates in `230` | move | browser gate + `npm test` | behaviour-identical (the later copy already wins) |
| 2 | New `core-html` module: move `_calEsc`, `_calEscAttr`, `_jsAttrArg`, `_svLoadingSkeletonHtml` and siblings out of `130` | move | full | pure functions, no state; hoisted, so moving is safe |
|  | **Done 2026-09-24 as an in-place split, not a move.** The helpers were already one contiguous run in `130`, so `130` was cut at function boundaries into `130-calendar-model-cache`, `131-core-html` (the 3 escapers), `132-calendar-dates-ids` (calendar-only date and id helpers that sat between them), `133-core-loading-skeletons` (all skeleton builders plus `_calLoaderHtml`) and `134-calendar-prefs-mount`. No byte moved, so the served page is byte-identical (proved with `check-modules.js --against=origin/main`). Where the core files sit in the page is irrelevant while they hold only hoisted functions; placing them first is left to the runtime switch. | split | byte-identical | |
| 3 | `125-title-name-rule` as a module in place | annotate | byte-identical | 0 foreign writes, 0 load-time code; first real module |
| 4 | New `core-ui` module: notices, toast, confirm, backdrop guard out of `040` | move | full | leaves `040` as analytics state |
| 5 | New `core-config` + `core-clients`: backend URL/key out of `100`; client normalizers out of `070` | move | full | constants and pure functions |
| 6 | New `core-identity`: staff gate and `_syncviewEfHeaders` out of `100` and `120` | move | full + `test/boot-entry-tax.js` + client-entry harness | security gate; its own PR, nothing else in it |
| 7 | New `core-flags`: the 14 flag-state names out of `110`, with setters for `120`, and the head-boot batch hand-off from `005` | move | full | removes the biggest misplaced shared state |
| 8 | New `core-nav`: `currentNav`, nav epoch, `navTo`, `_isClientLink`, client-entry capability, with setters for their 5 writers | move | full | Phase D's router work lands on this module |
| 9 | Single-screen areas in place, one PR each, loosest first: `300`, `310`, `340`, `240`, `080`, `200`, `110`, `050`+`060` (together, they are two-way), `070`+`090` | annotate (+ setters where §4.3 lists writes) | byte-identical where no setter was needed, full otherwise | each PR lists the names it now exports |
|  | **Started 2026-09-24 with `300` (TikTok upload), ahead of steps 3 to 8 at the owner's call.** That PR also lands the missing half of step 0: the strip rule (`scripts/index-modules.js`, used by `build-index.js` and `check-index.js`), the module list `src/index/modules.txt`, and the module rules in `check-modules.js` (import everything used from other fragments, nothing unused, never reassign an import, export exactly what others use). Format: column-0 `import { ... } from './<fragment>.js';` header, column-0 `export { ... };` footer, no renaming. `300` imports 19 names from `040` and `070` and exports 11; its 5 timer variables are reassigned by `310` and get setters when `310` is converted. | annotate | byte-identical | |
|  | **`340` (editors and date picker) next, ahead of `310`.** `310` reassigns `300`'s 5 timer variables, so converting it needs setters and changes bytes; the owner asked for byte-identical area PRs, so `310` waits for an explicit call. `340` needs no setter: it imports 27 names (from `070`, `100`, `131`, `320`, `330`) and exports 1 (`_kedPaint`, to `330`). | annotate | byte-identical | |
|  | **`310` is no longer a conversion target (2026-09-24).** The owner confirmed the TikTok Pilot was abandoned after TikTok rejected the app, so its code was deleted instead (its own PR): `310` is now `310-sales-intake-hiring` (Kasper Sales Intake and Hiring Process, unchanged) and converts like any other area. `300`'s pilot state (lines 84 to 124) stays until the owner lets `300` change; the timer setters above are therefore no longer needed. | remove | full | |
|  | **`240` (production description) next.** No setter needed: it imports 35 names (from `100`, `120`, `131`, `210`, `220`, `230`, `260`) and exports the 13 that `210`, `230`, `250` and `260` use. | annotate | byte-identical | |
|  | **`080` (Workload render) is not byte-identical, so `125` (step 3) went next.** `080` reassigns 8 names owned by `070` (the Workload load generations and retry timers listed in §4.3), so converting it needs setters in `070` and changes bytes. `125` imports 15 names (from `100`, `120`, `130`, `131`, `160`, `220`, `230`, `260`), exports the 4 that others use (`_calNameSyncSlotHtml`, `_calNameSyncScheduleRefresh`, `_calNameSyncAfterSave`, `_prodDetailTitleHtml`) and has no foreign writes and no load-time code. |
|  | **`070` (Workload source) next, byte-identical.** It imports 22 names (from `080`, `090`, `100`, `120`, `133`, `150`, `210`) and exports the 97 that others use. It has no foreign writes. The checker lists the 8 exports that `080` still reassigns as *pending setters*: they become setter calls in the `080` PR, which is the one that changes bytes. |
|  | **`210` (production state) next, byte-identical (plan step 10).** It imports 38 names (from `060`, `100`, `120`, `131`, `150`, `220`, `230`, `240`, `250`, `260`, `270`) and exports the 84 that others use. It has no foreign writes. |
|  | **`250` (production controls and data) next, byte-identical (plan step 10).** It imports 97 names (from `070`, `100`, `131`, `133`, `134`, `210`, `220`, `230`, `240`, `260`) and exports the 63 that others use. It has no foreign writes. |
|  | **`230` (production create and comments) next, byte-identical (plan step 10).** It imports 98 names (from `080`, `100`, `120`, `130`, `131`, `190`, `210`, `220`, `240`, `250`, `260`, `270`, `280`) and exports the 29 that others use. It has no foreign writes. |
|  | **`080` (Workload render), the first setter area, changes bytes (+1,079 served).** `070` gains 9 small functions (`_wlSetBackgroundRefreshPromise`, `_wlSetBackgroundRefreshMode`, `_wlSetNativeDueReceiptRetryPromise`, `_wlSetNativeDueReceiptRetryTimer`, `_wlSetNativeDueReceiptRetryAttempt`, `_wlTakeNativeDueReceiptRetryAttempt`, `_wlNextNativeDueReceiptGeneration`, `_wlNextPlanLoadGeneration`, `_wlNextPlanWriteGeneration`), and `080`'s 20 writes to `070`'s 8 variables become calls to them, with the same order and values. `080` imports 114 names and exports 12; `070` now exports 105 (`_wlPlanWriteGeneration` is no longer used outside it). No other fragment writes these variables. |
|  | **`090` (Workload popovers and navigation) changes bytes (+509 served).** `090` wrote 2 variables owned by `060`: `currentNav` (in `navTo`) and `_syncviewNavEpoch` (the Phase D navigation counter). `060` now offers `_syncviewSetCurrentNav(value)` and `_syncviewNextNavEpoch()`, and `navTo` calls them instead, at the same two points with the same values. Being hoisted function declarations, they behave like the direct writes on the early boot paths too. `090` imports 81 names and exports 15; `050` still writes both variables itself (1 each) and gets the same setters when `050` converts. One pending setter remains for others: `_linearResolvedPlanUrl` (owned by `090`). |
|  | **`200` (Submit screen) changes bytes (+747 served).** It wrote 4 variables it does not own: 3 of `060`'s intake-form state (`linearVideoCount`, `linearJustCreated`, `linearSubmitInFlight`) and `090`'s `_linearResolvedPlanUrl`. `060` now offers `_linearSetVideoCount`, `_linearNextVideoCount`, `_linearSetJustCreated` and `_linearSetSubmitInFlight`; `090` offers `_linearSetResolvedPlanUrl`; `200`'s 8 writes call them at the same points with the same values. `200` imports 65 names and exports 21; one pending setter remains for others: `_kasperUnlocked` (owned by `200`). |
| 10 | Production: `210`, `220`, `250`, `230`, then `260` last | annotate + setters | full | `260` needs setters for 30 foreign writes; split that PR by owner if it grows |
| 11 | Calendar model and UI: `130`, `150`, `160`, `180` | annotate + setters | full | `150` needs 13 setters into `130` |
| 12 | Approve path, one PR each: `120`, `140` (after B1 empties it, §8), `170`, `190`, `270`, `280`, `290`, `320`, `330` | annotate + setters | full + dawn-check approve / request-changes / Kasper review save on the test client | the riskiest block; nothing else in these PRs |
| 13 | Runtime switch: serve real modules | runtime | full + master-test full profile + boot re-measure | see below |

**Step 13, the switch.** Only after every script fragment is a module. Before it:
a guard test that opens each screen and asserts every function named in an inline
handler exists on `window` (480 to add, generated from the checker's report, one
`Object.assign(window, {...})` per module); and the 229 guards resolved. Then either
serve native `<script type="module">` files or bundle them (the choice is made on
measured numbers, not in this plan). Two runtime differences to prove harmless: module
scripts run after the whole document is parsed (today the main script runs before the
`350` footer markup and its own script exist), and the 29 load-time statements in
`340` run later. Measure boot again (`prod-boot-budget.js` and the
speed-map rig) in the same PR.

### Parallelism

Steps 0 and 1 first, alone. Steps 2–8 in order (each creates a core module the next may
import). Step 9 rows can run in parallel sessions, one fragment each, because each PR
touches one fragment plus, at most, a setter in its owner. Steps 10–12 in order. No two
sessions on the same owner fragment at once.

### How this sits against C2

The roadmap puts C2 (split the shipped file, load rare areas on demand) before C3. The
two only collide at step 13. Steps 0–12 change sources, not what is served, so they can
run before, during or after C2. C2 itself becomes easier after step 9, because each
on-demand area would then have a written list of what it needs from the core.

---

## 7. Where on-demand loading (C2) would and would not help

From the 2026-09-24 speed map: on a warm load **nine of fifteen tabs finish at the
same ~1,050–1,340 ms floor**, and for all of them the last thing to arrive is the shared
sign-in check or a flag read, not code. A warm reload transfers 300 bytes. The
2026-09-23 baseline found the page is 5.75 MB (1.40 MB gzipped), of which 367,680
gzipped bytes are seven rarely used areas.

**Would help**

- **Cold first visits** for everyone: less to download.
- **Parse and compile on every load**, warm included. The entry-tax audit notes the
  sign-in request used to wait on "1.4 MB of parsing"; that request now starts earlier,
  but the parse still happens. Not separately measured yet: C4 should record it.
- **Clients on phones**: a client link never opens TikTok, Kasper, editors, time off,
  hiring or onboarding code.

**Areas, by how easy the map says they are to split out**

| area | fragments | uses from core | offered to others | verdict |
|---|---|---|---|---|
| TikTok upload + pilot | `300`, `310` | 20 and 28 names, mostly notices | 11 and 9 names, to `090`, `100`, `320` | **easiest**; split first |
| Editors and date picker | `340` | 27 | 1 | easy, but its 29 load-time `window` copies serve Kasper; move with Kasper |
| Kasper dashboard / review / history | `320`, `330` | 90 and 110 | 44 and 24; `100` uses 14, `110` uses 6 | medium; `330` shares approve/tweak with `190`, so the shared part must stay in core |
| Time off | `110` | 56 | 40, of which 14 flag names | only after step 7 moves the flag state out |
| Onboarding / hiring | `100` | 62 | 78 to 27 fragments | only after steps 5–6 move config and the staff gate out |
| Samples | `270`–`290` | 103–158 each | built on the calendar write gateway | **poor candidate**: the gateway it needs is always loaded anyway, so little is saved |

**Would not help** (the slow tabs today):

- **Analytics, 3,339 ms and erratic**: waits on four Google Sheets reads.
- **SMM reports, 2,326 ms**: reads `smm-weekly-reports` twice before painting.
- **Calendar, 1,793 ms**: waits on its posts, a Sheets read and two template reads.
- **Kasper subtab reloads, never rendered**: a logic bug in the gate, not a speed issue
  (a fix merged in `b6c0f7f` after the map; re-measure before assuming).
- **The ~1.0 s shared floor**: that is `key-verify`, the security gate; it must stay.
- **Client review list, 3.6 s warm** (baseline §1): gated on two Sheets pulls.

C3 on its own changes no timing until step 13. Its payoff is safety: every screen gets
a written, enforced list of what it depends on, so a change in one cannot silently break
another.

---

## 8. Things to settle before starting

1. **`140-calendar-legacy-outbox` is Linear-era transport still wired into the approve
   path** (37 of the 217 names reached from approve). Phase B should delete what it can
   first; the roadmap's rule is not to modularize code that is about to be deleted. Step
   12 converts `140` last, or not at all if B empties it.
2. **The roadmap orders C2 before C3.** This plan keeps C3's runtime switch (step 13)
   after C2 and lets steps 0–12 run independently. The owner decides whether step 0 may
   start before C2 lands.
3. **Bundler or native modules at step 13** is left open on purpose; it should be
   decided with the boot numbers from C4, not before.
4. **One module per fragment** is the default. Merging `050`+`060` and `070`+`090`
   into one module each is suggested because they are two-way coupled; splitting `130`,
   `100` and `040` is what steps 2–8 do.

## 9. Gate summary per PR

- Annotate-only steps: `npm run build:index`, `npm run check:index`, **the base
  comparison from step 0 (built page equals the base commit's `index.html`)**, and
  `scripts/check-modules.js` green.
- Move or setter steps: the above, plus `node docs/syncview-design/tests/prod-write-gateway-browser.js`,
  `node docs/syncview-design/tests/prod-boot-budget.js`, `npm test`, and `/master-test`
  focused on the touched screens.
- Approve-path steps (12): all of the above plus the dawn-check approve,
  request-changes and Kasper review flows, on the test client only.
- Every PR: `node scripts/repo-identity-exposure-check.js --diff="origin/main"`, and the
  PR body records the fragment's exports before and after.
