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
| `probes` | `run-probes.js` + `p*.js` | calendar lifecycle/routing/sync end-to-end | yes |
| `scenarios` | `scenario_engine.js` + `scenarios.js` | Samples multi-actor flows (SMM/Kasper/Client), **real clicks/typing**, asserted against the live DB | yes |
| `temporal` | `temporal_lib.js` + `ot_temporal_*.js` | UI reaction speed + no flicker/revert | yes |
| `visual` | *(new)* | drives a flow with real clicks, screenshots every step, hands the frames to the **vision pass** | yes |

Nothing was thrown away — each lane shells the existing tester, so there is **zero
coverage loss**. The master just gives them one server, one summary, one exit code.

## Profiles

- **fast** (default) — `unit` + `parity(logic)` + a scenario smoke set + a visual
  smoke set. Run this on every change.
- **full** — every lane, the whole scenario library, all nightly probes. Run this
  nightly / before a release.

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

Run the **`/master-test` skill** to have Claude do this pass automatically (it
reads each shot, judges it against your change note, and reports findings like a
QA teammate). Or open the shots yourself and tick the checklist.

Why vision instead of pixel-diff baselines? Baselines only catch *drift from a
saved snapshot* and scream on every intentional tweak; they can't judge "does
this brand-new thing look good." Open-ended vision generalizes to **any** change
— you just say what you touched, and it goes and looks. (A pixel baseline can be
added later as a cheap extra net *under* the vision pass; they complement.)

## Safety

Same contract as `docs/HEADLESS-TESTING-GUIDE.md` §5: test client `sidneylaruel`
only, unique ids, archive on exit, **Linear always mocked**, assert 0 app JS
errors.

## Output

- `qa/MASTER_REPORT.md` — per-lane status table + overall result (written each run)
- `qa/visual/` — the vision pass inputs/outputs (regenerated each run; git-ignored)
