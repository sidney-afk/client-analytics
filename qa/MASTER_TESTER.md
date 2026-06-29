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
| `unit` | `test/run-all.js` (29 suites) | pure transform/state-machine logic | no |
| `parity` | `parity_*.js`, `render_parity.js` | Samples `_sxr*` is a faithful clone of calendar `_cal*` (logic + DOM + CSS) | yes |
| `probes` | `run-probes.js` + `p*.js` | calendar lifecycle/routing/sync — drives via app **handlers** (`page.evaluate`), not real clicks | yes |
| `scenarios` | `scenario_engine.js` + `scenarios.js` | Samples multi-actor flows (SMM/Kasper/Client) — clicks **real DOM nodes in-page** (`element.click()` + input events; not Playwright synthetic mouse/keyboard), asserted against the live DB. Flat library of 51 paths. | yes |
| `tree` | `scenario_tree.js` *(new)* | same engine, specs from the **branching scenario tree** (shared prefixes + branch points, compiled to root→leaf paths) | yes |
| `temporal` | `temporal_lib.js` + `ot_temporal_*.js` | UI reaction speed + no flicker/revert | yes |
| `visual` | *(new)* | drives a flow, screenshots every step, hands the frames to the **vision pass** (judged by a human / Claude via `/master-test` — not automated in CI) | yes |

Nothing was thrown away — each lane shells the existing tester. The `full` profile
runs them all (zero coverage loss); the default `fast` profile runs a smoke subset
(see below). The master gives them one server, one summary, one exit code.

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
  nightly probes, parity, temporal, visual. Run this nightly / before a release.

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
- Model via `MASTER_VISION_MODEL` (default `claude-opus-4-8`; set
  `claude-sonnet-4-6` or `claude-haiku-4-5` to cut cost on high-volume runs).
- Verdicts are written to `qa/visual/VISION_VERDICT.md`. A `broken` verdict marks
  the visual lane failed and fails the whole run; `warn`/`ok` don't.

When `MASTER_VISION` is unset (default), the visual lane only **captures** and
leaves the verdict to a human / `/master-test` — nothing calls a model and
nothing bills.

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

The flat `scenarios` lane (51 paths) and the `tree` lane coexist — the tree is the
new structured way to add coverage; existing flat scenarios are migrated into trees
over time, never lost.

## Safety

Same contract as `docs/HEADLESS-TESTING-GUIDE.md` §5: test client `sidneylaruel`
only, unique ids, archive on exit, **Linear always mocked**, assert 0 app JS
errors.

## Output

- `qa/MASTER_REPORT.md` — per-lane status table + overall result (written each run)
- `qa/visual/` — the vision pass inputs/outputs (regenerated each run; git-ignored)
