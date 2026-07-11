# `qa/` — live end-to-end probes and scenarios

> **Want to run everything at once?** See **[`MASTER_TESTER.md`](./MASTER_TESTER.md)** —
> one command (`npm run test:master`) runs every lane (unit, parity, probes,
> scenarios, temporal) plus a **vision pass** that looks at real screenshots and
> judges whether the UI looks right *and* behaves right. The `/master-test` skill
> drives it with Claude's eyes in the loop.

> **These hit the LIVE backend and mutate the `sidneylaruel` test client.**
> They are deliberately **not** in `test/` (that suite is offline/pure). Every
> probe/scenario seeds its own data and archives its card at the end. Only ever
> run these against the test client. Safety contract:
> `docs/testing/HEADLESS-TESTING-GUIDE.md` §5.

## Layout

| Path | What it is |
|---|---|
| `master.js` | Unified orchestrator — every lane behind one summary/exit code (`npm run test:master`). |
| `run-probes.js` | Runs the probes listed in `probes/nightly-manifest.txt` (`npm run test:e2e`; nightly CI). |
| `probes/` | Individual live probes. The **manifest** decides what the nightly gate runs; probes not in it (`p00`–`p27`, `p_g2*`) are kept as reference material only. |
| `scenario_engine.js` + `scenarios.js` + `scenario_tree.js` | The multi-actor Samples review lifecycle: seeds a card, drives the real SMM/Kasper/Client handlers through the UI, and asserts DB + DOM after every step. The scenario library covers the golden review paths end to end (clean approve, Kasper/client tweak loops, approve-after-tweaks, undo, archive). |
| `golden_lib.js`, `lib.js` (in `probes/`), `sxr_courier_lib.js`, `temporal_lib.js` | Shared harness libraries. `golden_lib.js` drives the real Kasper/client handlers plus the upsert webhook and is required by the probe harness. |
| `visual.js`, `vision_judge.js` | The vision lane: turns per-step screenshots into a review manifest and verdict. |
| `overnight_runner.sh`, `overnight_cron_chunk.sh` | Unattended continuous testing (see the `/overnight-test` skill); curated results land in `OVERNIGHT_TEST_REPORT.md`. |
| `ef-writepath/` | Edge-Function write-path suite (Track A gates) — see its own README. |

## Run

```bash
npm run test:e2e            # manifest probes (live backend)
npm run test:master         # all lanes + vision pass
node qa/master.js --lane=scenarios --scn=create_via_ui   # a single scenario
node qa/probes/p88_realtime_handler.js                   # a single probe
```

## How the harness works (`golden_lib.js`)

- **Kasper actions** → real handlers (`_kasperApproveComp`, `_kasperRequestTweakComp`, `_kasperApproveAfterTweaksComp`, and the Undo toast).
- **Client actions** → real `_calReviewApprove` / `_calReviewRequestTweak` on a live client page (client mode).
- **SMM status moves** → the upsert webhook (the exact write the SMM status control performs).
- **Assertions** → the Supabase row (what every surface renders from), polled after each step, plus Kasper-queue membership.

Test inventory & conventions: `docs/testing/CALENDAR-TEST-CATALOG.md` (what to
check), `docs/testing/HEADLESS-TESTING-GUIDE.md` (how to run), and
`docs/testing/interaction-path-generator.js` (full path/pair enumeration).
Historical point-in-time QA reports live in `docs/archive/qa/`.
