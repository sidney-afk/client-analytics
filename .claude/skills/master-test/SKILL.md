---
name: master-test
description: Run the unified MASTER TESTER for the SyncView app — every qa/master.js lane in one pass PLUS a VISION pass where Claude opens the real app's screenshots and LOOKS at them to judge whether the UI looks right AND behaves right. Use when the user wants to test a change end-to-end the way they would by hand — clicking through and eyeballing it — instead of trusting backend-state assertions alone. Accepts an optional description of what changed so the eyes know where to focus. Pairs with /overnight-test (continuous loop), /human-audit (Production-tab parity), and /feedback-expansion (owner-feedback loop).
---

# Master tester

Run **every** kind of test we have, then do the thing the mechanical lanes
never could: **look at the screen with eyes** (yours, via Claude's vision) and
judge whether the result both *works* and *looks right* — replacing the manual
"open the page, click around, see if anything's off" pass.

The mechanical engine is `qa/master.js`. Its full manual — the lane table,
profiles, flags, and the vision-pass mechanism — is `qa/MASTER_TESTER.md`;
read it once per fresh session instead of trusting any lane list quoted
elsewhere (lists drift; the manual is canonical).

## When the user gives you a change description

If the user said what they changed ("I tweaked the approve button", "redid the
Kasper queue card"), keep it — pass it via the `MASTER_CHANGE_NOTE` env var and
use it to focus the vision pass. If they didn't, ask once for a one-liner (or
default to a broad sweep).

## 1. Pick a profile and scope

- **fast** (default) for a normal "I changed something, check it" run;
  **full** for pre-release / "test everything". Narrow with `--scn=<keys>` /
  `--lane=<lanes>` per the manual.
- Environment: with open egress, `export SXR_COURIER=0` (scenarios run much
  faster). In a sandbox whose proxy blocks the browser's own egress, the
  courier (default on) is required and full scenarios are slow — prefer a small
  `--scn` set or `--lane=visual --scn=clean_both` while iterating.

## 2. Run the mechanical lanes

```bash
cd /home/user/client-analytics
MASTER_CHANGE_NOTE="<what changed, or empty>" node qa/master.js --profile=fast
```

`master.js` prints a per-lane summary, writes `qa/MASTER_REPORT.md`
(git-ignored), and exits non-zero if any pass/fail lane failed. The **visual**
lane never fails the run on its own — it CAPTURES, and hands the verdict to
you (step 3).

## 3. The VISION pass — this is the point of the skill

After the run, read `qa/visual/manifest.json`. It lists every screenshot
grouped by flow, with the step label and absolute path. For **each** shot:

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

Cross-check behavior against the live DB when useful: the scenario engine
already asserted `sample_reviews` columns (they show in the run output) — use
them to disambiguate "looks empty" from "is actually wrong".

Write your verdicts into `qa/visual/VISION_VERDICT.md` (overwrite each run) and
update the checkboxes in `qa/visual/VISUAL_REVIEW.md`.

## 4. Report back like a QA teammate

- one line per mechanical lane (pass/fail),
- the vision verdict: what looked right, and **every ⚠️/❌ with the shot path
  and a plain-English description** of what's off,
- if the change note pointed at a specific area, lead with whether that area
  is clean.

Do not dump all screenshots; surface the problems. Attach problem shots with
the SendUserFile tool when a picture explains it faster than words.

## Safety — live-backend QA contract

Full contract: `docs/testing/HEADLESS-TESTING-GUIDE.md` §5. Core, always:

- Test client **`sidneylaruel`** ONLY. Never touch another client's data.
- Every seeded row is archived on exit (the scenario engine does this).
- **Linear is always mocked** — never let a status/comment reach live Linear.
- The run asserts 0 app JS errors; a real app error is a finding, not noise.

## Unattended / CI vision (when you're not in the loop)

When this skill runs, **you** are the vision pass (step 3). For runs with no
Claude session — nightly CI — the master tester can judge screenshots itself
via `MASTER_VISION=cli|api|auto` (a `broken` verdict then fails the run). The
full spec, including model selection, is in `qa/MASTER_TESTER.md` → Automated
vision. Default is off — the lane only captures and waits for you.

## Retargeting note

This skill is bound to `qa/master.js` by design. New coverage belongs in the
engine, not here: add scenarios to `qa/scenarios.js` / branches to
`qa/scenario_tree.js`, or a new lane in `master.js` — this skill and the
vision pass pick them up automatically.
