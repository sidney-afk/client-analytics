# C3 step 13: prep done, and a measured proposal for the switch

**Date:** 2026-09-29 · **Session:** Keystone
**Follows:** `docs/plans/2026-09-24-modularization-c3-plan.md` (§6, step 13).
**This PR does the prep only. It does not switch anything.** Counts and file names
only; no client names or slugs.

---

## 1. The answer

- **Prep is done.** Every button's function is now listed on `window` by its own module,
  a guard fails CI if a list goes stale, and the one dead guard is gone. The served page
  behaves the same (boot times unchanged, section 3).
- **Recommendation for the switch: do not serve 56 native module files. Serve the same
  code in the same order as today, wrapped so it no longer leaks into the global scope,
  optionally minified.** It boots, it is the cheapest, and minifying alone makes the
  phone-speed boot about 20 % faster and the download 55 % smaller.
- **Why not native modules or a bundler on the import graph:** both were tried on this
  branch and neither boots (section 4). The import order is not the order the code has
  always run in, and the code depends on that order in at least 2 places.

## 2. What this PR adds

1. **Window exports.** 511 function names that inline handlers (`onclick="fn()"`) call now
   sit in one `Object.assign(window, {...})` at the end of the module that owns them
   (36 modules). Written by `node scripts/check-modules.js --write-window-exports`,
   never by hand. Without the flag, the same command **fails** if any block is missing a
   handler-called name or lists one no handler calls, and if a handler calls a `let` or
   `var` (a copy on `window` would go stale). Handlers are found in four written forms:
   `onclick="..."`, the same inside a JS string, `setAttribute('onclick', '...')`, and an
   options key (`{ onchange: '...' }`).
2. **The screen guard** is `docs/syncview-design/tests/inline-handlers-browser.js`, which
   already opened every screen (staff tabs, Kasper subtabs, entry links, client links) and
   read the rendered buttons. It now also **fails** when a drawn button calls a function
   that is in no module's export block, when a function resolves but is not on `window`,
   and when a block names a browser built-in (the copy would overwrite it). On its first
   run it caught two Time Off form selects that the text scan had missed (their handlers
   are written as an options key), which is why the fourth handler form exists; that
   form added 7 names (511 in all).
3. **Guards.** `check-modules.js` now fails on a `typeof x === 'function'` guard whose name
   no fragment declares and that is not a browser global. The 493 guards in modules are
   names a module owns, names it imports (already forced by the existing "uses it
   without importing it" rule, so they cannot silently read "not there") or browser
   globals; the new rule proves that split. One is dead:
   `_sxrSyncStatusFromLinear` (removed in B2) is still tested in two places in `270`, so
   the code behind it can never run. It is listed as a known dead guard in
   `check-modules.js` rather than deleted, because `test/sxr-move-link-*.js` stub the
   function and pin those two calls. Deleting the calls and updating those two tests is
   the follow-up that empties the list.

The 38 recorded on-demand-loading hazards in `lazy-safety-baseline.txt` (34 buttons, 4
guards, all in areas that are not lazy today) are a different list, owned by the
load-per-tab plan, and are not touched here.

## 3. Boot numbers

Rig: a local HTTP/2 server with brotli, a fresh browser per run, staff sign-in seeded,
every outside request answered empty, medians of 7. "Ready" is the moment `navTo` exists
and the tab bar is drawn. "Phone" is 4x slower CPU with 100 ms latency and 10 Mbit/s.

| # | what is served | download (brotli) | files | desktop ready, cold | phone ready, cold | phone ready, repeat |
|---|---|---|---|---|---|---|
| 1 | main today, staff (split into parts) | 908 KB | 16 | 448 ms | 1,960 ms | 1,632 ms |
| 2 | **this PR**, staff (parts) | 911 KB | 16 | 431 ms | 1,898 ms | 1,609 ms |
| 3 | this PR, one full file (client links) | 1,107 KB | 2 | 543 ms | 2,393 ms | 1,879 ms |
| 4 | same code, wrapped in one function | 1,108 KB | 2 | 604 ms | 2,669 ms | 1,904 ms |
| 5 | same, wrapped and minified | 497 KB | 2 | 453 ms | 2,052 ms | 1,336 ms |

- **The prep costs nothing you can measure**: +3 KB downloaded, boot within noise (1 vs 2).
- The wrapper by itself changes nothing that matters (3 vs 4 is inside the noise).
- **Minifying is the real gain** (4 vs 5: 55 % smaller, about 20 % faster on the phone
  profile) and is independent of the switch.
- **`prod-boot-budget.js` itself cannot finish in this sandbox** (it needs the live
  backend; it fails the same way on `origin/main`, on certificate errors for the backend
  and the chart library). Its two numbers, DOMContentLoaded and Production ready, could not
  be taken here. The rig above is a stand-in that measures the same first-paint path
  without the backend. Re-run `prod-boot-budget.js` on a machine with a route to the live
  backend before merging the switch; that is a required gate in the plan and stays one.

## 4. Why not native modules or a bundler

Both were built from this branch's fragments (not committed) and opened in the same rig.

| try | result |
|---|---|
| 56 native `<script type="module">` files, preloaded | **does not boot**: `Cannot access '_isClientLink' before initialization`. `290` calls `_writeUiResumeLegacyQueues()` at load; that reads a constant in `260`, which a module loader has not run yet. |
| esbuild bundle of the same import graph | **does not boot**: `_isSmmWeeklyRoute` reads a value that is not set yet. Same cause, a different place. |
| today's order, wrapped in one function | boots (row 4) |

The cause: today the fragments run in file order (`040`, `050`, ...). A module loader runs
each file's imports before the file itself, and the imports form loops (`040` imports
from `260`, `260` from `040`), so the loader has to pick a different order. The checker's
"no load-time forward reference" rule looks only at statements that run directly at load,
and finds 0. It cannot see a load-time call that reaches a constant *through other
functions*, which is what both failures are.

## 5. Proposal

**Step 13 in two moves.**

- **13a (the switch, low risk).** Keep today's build (strip the import and export lines,
  concatenate in file order, split into parts and lazy areas as now) and add a wrapper
  around each served file group so nothing leaks into the global scope. The window
  blocks from this PR are then the entire public surface, which is what makes the guard
  test above meaningful. Minify in the same step or right after it. Gate: this PR's
  checks, `prod-write-gateway-browser.js`, `inline-handlers-browser.js`, the split-load
  suites, `prod-boot-budget.js` on a machine with the live backend, and a
  `/master-test` full pass.
  Caution for 13a: a wrapper hides names from other classic scripts and from tests that
  read globals (row 4 boots, but the page's own `page.evaluate` probes and any QA script
  that reads a bare name would need `window.`). The window blocks cover handler names
  only, so **the suite run is the proof, not this table**.
- **13b (optional, later): real isolation between fragments.** Needs the load-time
  order problem fixed first: extend rule 4 in `check-modules.js` to follow calls
  transitively, then either move the start-up calls that break (the two found so
  far: `290`'s resume loop and a call to `_isSmmWeeklyRoute`) into the boot routine in
  `260`, or keep an explicit order list. Only after that can a loader or bundler derive the order from the imports. It
  buys stricter privacy, not speed (56 files would need preloading; the ordered bundle
  already has the fewest requests).

Not measured here, and worth knowing: real GitHub Pages latency, the live backend, and
the on-demand areas' first open under a wrapper. Runs are noisy by roughly 10 %, so treat
differences under that as equal.
