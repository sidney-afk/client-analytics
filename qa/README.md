# `qa/` — browser journeys, live probes, and scenarios

> **Want to run the master-registered lanes at once?** See **[`MASTER_TESTER.md`](./MASTER_TESTER.md)** —
> one command (`npm run test:master`) runs every master-registered lane (unit,
> parity, probes, scenarios, temporal) plus a **vision pass** that looks at real
> screenshots and judges whether the UI looks right *and* behaves right.
> Feature-scoped PTO runs separately below. The `/master-test` skill drives the
> registered lanes with Claude's eyes in the loop.

> **The established probe/scenario lanes hit the LIVE backend and mutate the
> `sidneylaruel` test client.** They are deliberately **not** in `test/` (that
> suite is offline/pure). Every live probe/scenario seeds its own data and
> archives its card at the end. Only ever run those lanes against the test
> client. Safety contract: `docs/testing/HEADLESS-TESTING-GUIDE.md` §5.
>
> `pto-lifecycle/` is the explicit exception: its default Lane A intercepts
> every external request and uses synthetic TEST personas only. Its separate
> Lane B is an opt-in, exact-cleanup production drill that fails closed without
> dedicated TEST identities and private confirmation.

## Layout

| Path | What it is |
|---|---|
| `master.js` | Unified orchestrator — one summary/exit code for its registered lanes (`npm run test:master` = fast profile; `npm run test:master:full` = every master-registered lane). PTO remains a separate feature-scoped command. |
| `run-probes.js` | Runs the probes listed in `probes/nightly-manifest.txt` (`npm run test:e2e`; nightly CI). |
| `probes/` | Individual live probes. The **manifest** decides what the nightly gate runs; probes not in it (`p00`–`p27`, `p_g2*`) are kept as reference material only. |
| `scenario_engine.js` + `scenarios.js` + `scenario_tree.js` | The multi-actor Samples review lifecycle: seeds a card, drives the real SMM/Kasper/Client handlers through the UI, and asserts DB + DOM after every step. The scenario library covers the golden review paths end to end (clean approve, Kasper/client tweak loops, approve-after-tweaks, undo, archive). |
| `golden_lib.js`, `lib.js` (in `probes/`), `sxr_courier_lib.js`, `temporal_lib.js` | Shared harness libraries. `golden_lib.js` drives the real Kasper/client handlers plus the upsert webhook and is required by the probe harness (named for the retired golden-path probes it once powered; the library outlived them). |
| `visual.js`, `vision_judge.js` | The vision lane: turns per-step screenshots into a review manifest and verdict. |
| `overnight_runner.sh`, `overnight_cron_chunk.sh` | Unattended continuous testing (see the `/overnight-test` skill); curated results land in `OVERNIGHT_TEST_REPORT.md`. |
| `ef-writepath/` | Edge-Function write-path suite (Track A gates) — see its own README. |
| `pto-lifecycle/` | PTO human-journey simulation. Lane A is a stateful fully mocked browser matrix with a screenshot after every logical action; Lane B is a separately gated disposable live TEST drill. See its README. |

## Run

```bash
npm run test:e2e            # manifest probes (live backend)
npm run test:master         # all master-registered lanes + vision pass
npm run test:pto-lifecycle  # fully mocked PTO lifecycle + screenshot series
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
