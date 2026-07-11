# Master tester

**One command that runs every kind of test we have — plus eyes.**

For a long time we had several separate testers, each good at one thing and blind
to the others. The master tester unifies them behind a single entry point
(`qa/master.js`) and adds the one thing none of them had: a **vision pass** that
*looks* at the rendered screen and judges whether it works *and* looks right —
the thing you used to do by hand, opening the page and clicking around.

## The lanes (every old tester is now a lane)

| Lane | Was | What it checks | Browser? |
|------|-----|----------------|----------|
| `unit` | `test/run-all.js` (every `test/*.js`, auto-discovered) | pure transform/state-machine logic | no |
| `parity` | `parity_*.js`, `render_parity.js`, `realtime_parity.js` | Samples `_sxr*` is a faithful clone of calendar `_cal*` (logic + DOM + CSS + realtime/immediacy wiring) | yes¹ |
| `realtime` | `realtime_parity.js` + `p88_realtime_handler.js` *(new)* | **Layer A** (static, no browser): every calendar realtime/immediacy hook has a wired samples twin (subscription + teardown + dataChanged gate). **Layer B** (real browser): GIVEN a push, the never-reloaded surface repaints, a no-op echo doesn't rebuild, and the Kasper queue updates. Together: A = "the socket calls the handler", B = "the handler updates the UI". | yes (B only) |
| `probes` | `run-probes.js` + `p*.js` | calendar lifecycle/routing/sync — drives via app **handlers** (`page.evaluate`), not real clicks | yes |
| `scenarios` | `scenario_engine.js` + `scenarios.js` | Samples multi-actor flows (SMM/Kasper/Client) — clicks **real DOM nodes in-page** (`element.click()` + input events; not Playwright synthetic mouse/keyboard), asserted against the live DB. The flat library (`qa/scenarios.js`). | yes |
| `tree` | `scenario_tree.js` *(new)* | same engine, specs from the **branching scenario tree** (shared prefixes + branch points, compiled to root→leaf paths) | yes |
| `temporal` | `temporal_lib.js` + `ot_temporal_*.js` | UI reaction speed + no flicker/revert | yes |
| `visual` | *(new)* | drives a flow, screenshots every step, hands the frames to the **vision pass** (judged by a human / Claude via `/master-test` — not automated in CI) | yes |

Nothing was thrown away — each lane shells the existing tester. The `full` profile
runs them all (zero coverage loss); the default `fast` profile runs a smoke subset
(see below). The master gives them one server, one summary, one exit code.

> ¹ `realtime_parity.js` (Layer A) is pure source analysis — no browser. It rides
> the `parity` lane on **every** run (including `fast`) so a missing/unwired samples
> realtime twin breaks the build instantly. The `realtime` lane adds Layer B (the
> real-browser handler-injection probe) and is in the `full` profile + on demand
> (`--lane=realtime`). **Why this exists:** the Supabase realtime WebSocket can't be
> tunneled headless (the egress proxy refuses WS upgrades), so a real cross-tab push
> can't be observed in the sandbox — but the *handler logic* and the *wiring* (where
> the two realtime bugs actually lived) are fully testable this way. A real-WS,
> two-browser-context lane is opt-in for open-egress CI (`SXR_COURIER=0`).

> **Honest note on "real interactions":** only the `scenarios`/`tree`/`visual` lanes
> drive the UI by locating real DOM elements; they activate them with in-page
> `element.click()` and set inputs via the native value-setter, which is much closer
> to a user than calling functions but is **not** Playwright synthetic mouse/keyboard
> (no trusted events, hover, or focus). The `probes` lane still invokes app handlers
> directly. Moving probes onto real input is future work.

## Profiles

- **fast** (default) — `unit` + `parity(logic)` + a scenario smoke set + a visual
  smoke set. Run this on every change.
- **full** — every lane: the whole scenario library, the branching tree, all
  nightly probes, parity, realtime, temporal, visual. Run this nightly / before a release.

## Usage

```bash
cd client-analytics

# fast profile (default) — run on every change
node qa/master.js

# everything
node qa/master.js --profile=full

# just some lanes
node qa/master.js --lane=unit,visual

# focus on specific scenarios (and feed the eyes a change note)
MASTER_CHANGE_NOTE="redid the approve button" node qa/master.js --lane=visual --scn=clean_both

# reuse an already-running :8000 static server
node qa/master.js --no-server

# the branching scenario tree
node qa/scenario_tree.js                          # print the compiled root→leaf paths (no browser)
node qa/master.js --lane=tree                     # run the tree through the engine
node qa/probes/run_scenarios.js --tree --shots    # run it directly, with screenshots
```

npm shortcuts:

```bash
npm test            # fast logic gate only (node test/run-all.js) — per-push CI
npm run test:master # the full master tester — node qa/master.js
```

### Environment notes

- **Open egress (dev laptop / CI):** `export SXR_COURIER=0` — the browser talks to
  the backend directly and scenarios run fast.
- **Sandboxed (browser egress blocked):** the courier (`SXR_COURIER=1`, default)
  tunnels every backend call through Node/curl. Correct, but slower — prefer a
  small `--scn` set while iterating.

## Known blind spots (and what covers them now)

Two bugs shipped in 2026-07 that every lane missed; each exposed a structural
blind spot worth knowing when you write new tests:

1. **"Does the screen tell the truth?" vs "is the state right?"** The
   `resolve_via_*` scenarios drove the exact broken flow (SMM resolves the last
   tweak → chooser → Kasper) with real DOM clicks — and passed, because every
   assertion read the **live DB**, which was correct; the sheet pill on screen
   lied until a refresh (`_sxrUpdateCardStatusDisplay` was a stub). The
   `temporal` lane asserts optimistic pills, but only on the status-menu path
   (full re-render — never broken). **Now:** the `expectPill` verb asserts the
   rendered pill *in place, pre-reload*; every mutation step that changes a
   visible status should pair with a DOM-level expect. Probe `p92` guards the
   original flow.
2. **Fresh-profile testing can't see cross-session staleness.** Every lane
   boots a fresh browser context (empty localStorage), so a stale cached
   snapshot + a server-side archive this browser never saw + quota pressure —
   the exact recipe behind the "phantom card flashes on every refresh" bug —
   cannot exist in any test run. Worse, the suite *manufactured* the bug for
   real users: thousands of archived QA rows bloated the per-client cache to
   quota scale. **Now:** probe `p93` seeds a stale cache + quota-stuffed
   storage and asserts the phantom heals after one boot and never re-renders.
   When adding cache/ledger features, add a dirty-profile probe like it.

Also remember the vision caveat below: the `visual` lane **captures** the
evidence but nothing judges it unattended unless `MASTER_VISION` is set — a
screenshot of a broken screen in `qa/visual/` is not a failed test.

## The vision pass (the "eyes")

The `visual` lane **captures**; it does not auto-judge. After a run it writes:

- `qa/visual/manifest.json` — every screenshot, grouped by flow, with step + path
- `qa/visual/VISUAL_REVIEW.md` — a per-shot checklist

The judging is done by a reviewer who **looks** at each shot and asks two things:

1. **Does it LOOK right?** layout, overlap, alignment, clipping, broken/missing
   media, wrong colors, empty-where-it-shouldn't-be, unfinished states.
2. **Did it DO the right thing?** the screen reflects what the action produced.

Run the **`/master-test` skill** to have Claude do this pass interactively (it
reads each shot, judges it against your change note, and reports findings like a
QA teammate). Or open the shots yourself and tick the checklist.

### Automated vision (optional, off by default)

For an unattended pass that fails the run on a `broken` verdict, set
`MASTER_VISION`:

```bash
# subscription-powered, no API key — runs on your logged-in Claude Code (great locally)
MASTER_VISION=cli node qa/master.js --lane=visual --scn=clean_both

# API key (per-token billing) — the clean path for CI
MASTER_VISION=api ANTHROPIC_API_KEY=… node qa/master.js --profile=full

# auto: cli if `claude` is on PATH, else api if a key is set, else off
MASTER_VISION=auto node qa/master.js
```

- **`cli`** shells out to `claude -p` and runs on whatever auth Claude Code is
  logged into — i.e. **your Pro/Max subscription, no key, no per-call charge**.
  Needs `claude` installed + logged in where the run happens (so: great on your
  machine, awkward in GitHub Actions). Note: if `ANTHROPIC_API_KEY` is set it
  takes precedence over the subscription.
- **`api`** calls the Anthropic Messages API via `curl` (so it tunnels through
  the same egress proxy the courier uses). Requires `ANTHROPIC_API_KEY`.
- Model via `MASTER_VISION_MODEL` (default: see `DEFAULT_MODEL` in
  `qa/vision_judge.js`; set a smaller model to cut cost on high-volume runs).
- Verdicts are written to `qa/visual/VISION_VERDICT.md`. A `broken` verdict marks
  the visual lane failed and fails the whole run; `warn`/`ok` don't.

When `MASTER_VISION` is unset (default), the visual lane only **captures** and
leaves the verdict to a human / `/master-test` — nothing calls a model and
nothing bills.

Enhancement worth making someday: the visual lane currently shoots only the
**result** frame after each step — a before+after pair per step (in
`scenario_engine.js`'s `shot()`) would sharpen "did it change correctly"
judgments.

Why vision instead of pixel-diff baselines? Baselines only catch *drift from a
saved snapshot* and scream on every intentional tweak; they can't judge "does
this brand-new thing look good." Open-ended vision generalizes to **any** change
— you just say what you touched, and it goes and looks. (A pixel baseline can be
added later as a cheap extra net *under* the vision pass; they complement.)

## The branching scenario tree

`qa/scenario_tree.js` models the review lifecycle as a **tree** instead of a flat
list. A node is one beat of the flow (`{ key, title, seed?, steps?, children? }`);
`compile()` walks root→leaf and emits one flat `{ key, title, seed, steps }` spec
per leaf — exactly what `runScenario` already consumes — so the proven engine runs
each path unchanged. The win: a **shared prefix is authored once at the branch
point** and reused by every leaf beneath it, instead of being copy-pasted across
scenarios (which is what `scenarios.js` does today).

Example: from one `For SMM Approval` root, "SMM approves → Kasper" is written once,
then branches into Kasper-approves (→ Client approves / Client requests change),
Kasper-requests-change, and Kasper-approve-after-tweaks — six leaf paths sharing
two authored prefixes. `node qa/scenario_tree.js` prints the expansion.

The flat `scenarios` lane and the `tree` lane coexist — the tree is the
new structured way to add coverage; existing flat scenarios are migrated into trees
over time, never lost.

## Safety

Same contract as `docs/testing/HEADLESS-TESTING-GUIDE.md` §5: test client `sidneylaruel`
only, unique ids, archive on exit, **Linear always mocked**, assert 0 app JS
errors.

## Output

- `qa/MASTER_REPORT.md` — per-lane status table + overall result (written each run)
- `qa/visual/` — the vision pass inputs/outputs (regenerated each run; git-ignored)
