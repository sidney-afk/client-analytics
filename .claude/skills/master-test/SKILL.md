---
name: master-test
description: Run the unified MASTER TESTER for the SyncView app — every test lane in one pass (unit, parity, calendar probes, Samples scenarios, temporal) PLUS a VISION pass where Claude opens the real app in a headless browser, drives it with real clicks, and LOOKS at screenshots to judge whether the UI looks right AND behaves right. Use when the user wants to test a change end-to-end the way they would by hand — clicking through and eyeballing it — instead of trusting backend-state assertions alone. Accepts an optional description of what changed so the eyes know where to focus.
---

# Master tester

This is the one tester that runs **every** kind of test we have, then does the
thing the others never could: it **looks at the screen with eyes** (yours, via
Claude's vision) and judges whether the result both *works* and *looks right* —
replacing the manual "open the page, click around, see if anything's off" pass.

The mechanical engine is `qa/master.js`; this skill is its front door and the
**vision pass** on top.

## When the user gives you a change description

If the user said what they changed ("I tweaked the approve button", "redid the
Kasper queue card"), keep it — you'll pass it to the run via the
`MASTER_CHANGE_NOTE` env var and use it to focus the vision pass. If they didn't,
ask once for a one-liner (or default to a broad sweep).

## 1. Pick a profile

- **fast** (default) — unit + parity(logic) + a scenario smoke set + a visual
  smoke set. Use for a normal "I changed something, check it" run.
- **full** — every lane, the whole scenario library, all nightly probes. Use for
  pre-release / "test everything thoroughly".
- Target a specific area with `--scn=<keys>` (comma-separated scenario keys, e.g.
  `--scn=clean_both,kasper_request_video`) and/or `--lane=<lanes>`.
- The `tree` lane (full profile, or `--lane=tree`) runs the **branching scenario
  tree** (`qa/scenario_tree.js`) — shared prefixes + branch points compiled to
  root→leaf paths. `node qa/scenario_tree.js` prints the expansion without a browser.

## 2. Run the mechanical lanes

```bash
cd /home/user/client-analytics
MASTER_CHANGE_NOTE="<what changed, or empty>" node qa/master.js --profile=fast
```

In an open-egress environment (dev laptop / CI) export `SXR_COURIER=0` first —
scenarios run much faster without the curl courier. In this sandbox the courier
is required (browser egress is blocked) and full scenarios are slow, so prefer a
small `--scn` set or `--lane=visual --scn=clean_both` when iterating.

`master.js` prints a per-lane summary, writes `qa/MASTER_REPORT.md`, and exits
non-zero if any pass/fail lane failed. The **visual** lane never fails the run on
its own — it CAPTURES, and hands the verdict to you (step 3).

## 3. The VISION pass — this is the point of the skill

After the run, read `qa/visual/manifest.json`. It lists every screenshot grouped
by flow, with the step label and absolute path. For **each** shot:

1. **Read the image** (use the Read tool on the `path`).
2. Judge it on two axes, informed by the change note:
   - **Does it LOOK right?** layout, alignment, overlap, clipping, broken or
     missing images/thumbnails, wrong colors, empty-where-it-should-have-content,
     ugly/unfinished states. This is the eyeball test.
   - **Did it DO the right thing?** does the screen reflect what that step's
     action should have produced (e.g. after `kasper-approve`, the card should
     have left the Kasper queue and the status should read the next stage)?
3. Record a verdict per shot: ✅ fine · ⚠️ suspicious · ❌ broken — with a short
   reason and the shot path for anything not ✅.

Cross-check behavior against the live DB when useful: the scenario engine already
asserted `sample_reviews` columns (those show in the run output) — use them to
disambiguate "looks empty" from "is actually wrong".

Write your verdicts into `qa/visual/VISION_VERDICT.md` (overwrite each run) and
update the checkboxes in `qa/visual/VISUAL_REVIEW.md`.

## 4. Report back like a QA teammate

Give the user a tight summary:
- one line per mechanical lane (pass/fail),
- the vision verdict: what looked right, and **every ⚠️/❌ with the shot path and
  a plain-English description** of what's off,
- if the change note pointed at a specific area, lead with whether that area is
  clean.

Do not dump all screenshots; surface the problems. Attach problem shots with the
SendUserFile tool when a picture explains it faster than words.

## Safety (same contract as docs/testing/HEADLESS-TESTING-GUIDE.md §5)

- Test client **`sidneylaruel`** ONLY. Never touch another client's data.
- Every seeded row is archived on exit (the scenario engine does this).
- **Linear is always mocked** — never let a status/comment reach live Linear.
- The run asserts 0 app JS errors; a real app error is a finding, not noise.

## Unattended / CI vision (when you're not in the loop)

When this skill runs, **you** are the vision pass (step 3). For runs with no Claude
session — nightly CI — the master tester can judge screenshots itself: set
`MASTER_VISION=cli` (runs on the logged-in Claude Code subscription, no key) or
`MASTER_VISION=api` (needs `ANTHROPIC_API_KEY`). A `broken` verdict then fails the
run on its own. See `qa/MASTER_TESTER.md` → Automated vision. Default is off — the
lane only captures and waits for you.

## Notes / future

- The visual lane currently shoots the **result** frame after each step. A
  before+after pair per step would sharpen "did it change correctly" judgments —
  a worthwhile enhancement to `scenario_engine.js`'s `shot()`.
- Pixel-diff baselines can be layered in later as a cheap regression net under
  the vision pass (the vision pass catches "looks wrong on something new"; a
  baseline catches "subtly drifted from last known good"). They complement; the
  vision pass is the heart.
