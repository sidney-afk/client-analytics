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
| `boot/` | Fully synthetic full-Chromium lane that streams `index.html` in two chunks and asserts the actual visible first-paint/reload/BFCache sequence for client Calendar, Brief, invalid and retryable verifier entry, pending analytics/Calendar/Samples reads, Calendar route/Linear-tail/realtime replacement, pending and settled staff Calendar BFCache recovery, and legacy Samples exact-client traversal. |
| `test-client-entry.js` | Strict TEST-client URL builder plus the nightly-only current-token resolver. It fails closed without the protected job token and emits only `c,t,v[,sxr]`; no token is committed or logged. |
| `run-probes.js` | Runs the probes listed in `probes/nightly-manifest.txt` (`npm run test:e2e`; nightly CI). |
| `probes/` | Individual live probes. The **manifest** decides what the nightly gate runs; probes not in it (`p00`–`p27`, `p_g2*`) are kept as reference material only. |
| `scenario_engine.js` + `scenarios.js` + `scenario_tree.js` | The multi-actor Samples review lifecycle: seeds a card, drives the real SMM/Kasper/Client handlers through the UI, and asserts DB + DOM after every step. The scenario library covers the golden review paths end to end (clean approve, Kasper/client tweak loops, approve-after-tweaks, undo, archive). |
| `golden_lib.js`, `lib.js` (in `probes/`), `sxr_courier_lib.js`, `temporal_lib.js` | Shared harness libraries. `golden_lib.js` drives the real Kasper/client handlers plus the upsert webhook and is required by the probe harness (named for the retired golden-path probes it once powered; the library outlived them). |
| `visual.js`, `vision_judge.js` | The vision lane: turns per-step screenshots into a review manifest and verdict. |
| `overnight_entry.js`, `overnight_runner.sh`, `overnight_cron_chunk.sh`, `posix_session_guard.js`, `windows_job_worker.js`, `windows_job_guard.ps1`, `windows_bash_supervisor.sh` | Unattended continuous testing (see the `/overnight-test` skill). Protected runs enter through `node qa/overnight_entry.js runner` or `node qa/overnight_entry.js cron`; after the caller supplies a clean Node startup, the broker scrubs child interpreter controls, establishes platform process-tree containment, and then releases the TEST-only capability to trusted Bash 5.1+. Curated results land in `OVERNIGHT_TEST_REPORT.md`. |
| `ef-writepath/` | Edge-Function write-path suite (Track A gates) — see its own README. |
| `pto-lifecycle/` | PTO human-journey simulation. Lane A is a stateful fully mocked browser matrix with a screenshot after every logical action; Lane B is a separately gated disposable live TEST drill. See its README. |

## Run

```bash
npm run test:e2e            # manifest probes (live backend)
npm run test:master         # all master-registered lanes + vision pass
npm run test:boot           # offline streamed first-paint/reload guard
node qa/master.js --lane=boot                              # same guard through the QA orchestrator
npm run test:pto-lifecycle  # fully mocked PTO lifecycle + screenshot series
node qa/master.js --lane=scenarios --scn=create_via_ui   # a single scenario
node qa/probes/p88_realtime_handler.js                   # a single probe
node qa/overnight_entry.js runner                        # continuous unattended matrix
node qa/overnight_entry.js cron                          # one rotating bounded chunk
```

Run those protected commands with `NODE_OPTIONS`, `LD_PRELOAD`, `LD_AUDIT`,
`LD_LIBRARY_PATH`, `DYLD_INSERT_LIBRARIES`, and `DYLD_LIBRARY_PATH` unset before
the staff key enters Node. That clean launch is a trusted caller/scheduler
precondition: the broker diagnoses these controls but cannot undo startup code
already executed by Node or the OS loader. It also fails visibly when trusted
Bash 5.1+ is unavailable; on Windows it uses Git Bash directly.
Windows script mode pins the OS helpers under `C:\Windows` and Git Bash under
`C:\Program Files`; caller-overridden helper roots and per-user Git installs
are refused before the issuer is released.

The broker releases the issuer only after a POSIX session guardian is ready or
after a blocked native Windows worker has been assigned to a kill-on-close Job.
Normal completion is not success until that guardian confirms the contained
tree is empty; surviving descendants are killed and reported visibly. POSIX
protected workloads must remain foreground-attached: operative commands must
stay in their assigned process group, and the workload must not daemonize into
a different session. Either escape leaves the supported containment boundary.

Live client-route lanes require the current protected token for the TEST client. Each
operative harness resolves it through the protected `client-review-link` issuer using
`SYNCVIEW_STAFF_KEY`, keeps it only in local process memory, and passes it explicitly to
`gotoTestClientEntry`, which redacts navigation failures. The token is never exported through `GITHUB_ENV` or `process.env`,
and browser/unrelated child environments have client-entry credentials stripped. Never
put the value in a command, fixture, URL example, source file, or log.

## How the harness works (`golden_lib.js`)

- **Kasper actions** → real handlers (`_kasperApproveComp`, `_kasperRequestTweakComp`, `_kasperApproveAfterTweaksComp`, and the Undo toast).
- **Client actions** → real `_calReviewApprove` / `_calReviewRequestTweak` on a live client page (client mode).
- **SMM status moves** → the upsert webhook (the exact write the SMM status control performs).
- **Assertions** → the Supabase row (what every surface renders from), polled after each step, plus Kasper-queue membership.

Test inventory & conventions: `docs/testing/CALENDAR-TEST-CATALOG.md` (what to
check), `docs/testing/HEADLESS-TESTING-GUIDE.md` (how to run), and
`docs/testing/interaction-path-generator.js` (full path/pair enumeration).
Historical point-in-time QA reports live in `docs/archive/qa/`.
