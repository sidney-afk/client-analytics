# Evaluation: Is nightly headless-browser testing the right way to test SyncView?

*Prepared 2026-06-26 for the SyncView solo operator. Scope: the `test/*.js` offline layer and the `qa/probes/*.js` nightly headless E2E layer.*

---

## 1. TL;DR — Direct answer

Headless browser E2E is the **right layer** for SyncView: your core value and core risk is cross-surface state consistency (SMM / Client / Kasper) over a real Supabase + n8n + realtime backend, and that genuinely cannot be proven by unit logic alone. The implementation also gets several hard things right (it drives the real shipped file; the offline tier tests real shipping code). But three problems undercut exactly what you're trusting it to do, and they are the ones to fix first:

1. **Zero failure alerting** — a 3am red build is silent; you find out by accident. This is the direct answer to "while I sleep" and it's the highest-leverage fix.
2. **`PROBE_ATTEMPTS=3` retry-to-green hides intermittent races** — the concurrency/realtime bug class this product is *most* prone to passes the gate silently.
3. **Most probes drive internal handlers via `page.evaluate` and assert on private state** — so they're integration-in-a-browser, not true E2E for most probes; a passing run does not prove a client can click Approve.

Running against the **live production backend** is also a real issue but a more *moderate* one — the realistic worst case is leaked test rows and false-greens, not destroyed client data (there is no hard-delete primitive anywhere, and the committed key is a read-only anon key behind RLS). Don't over-panic about it; do add defense-in-depth.

Finally, "nightly while you sleep" is the **wrong mechanism for your real goal**: a once-a-day CI gate can't tell you the calendar broke at 3am — that's a *monitoring* job, not a *testing* job. **Keep the technique; fix the implementation; and split "is it working right now" out into real synthetic monitoring with alerts.** For a solo operator the high-ROI path is incremental: alerting + a managed synthetic monitor first, full rebuild later and optional.

---

## 2. What you have today

Two test layers, correctly separated by cost and cadence:

- **Tier 1 — offline "wiring" tests** (`test/*.js`, ~28–30 files, runner `test/run-all.js`). Run on **every push/PR** via `.github/workflows/calendar-unit-tests.yml` (10-min cap). Each test **string-extracts the real shipping functions/consts** out of `index.html` (via `grabFunc` brace-matching + `grabConst` regex) and runs them in a `new Function` sandbox with hand-built stubs. No browser, no network. Tests pure logic: status math, state machines, echo-merge/LWW reconciliation, guard predicates. Many are named regressions tied to specific reported bugs.

- **Tier 2 — nightly headless E2E "probes"** (`qa/probes/*.js` + `qa/golden_*.js`, ~90+ files, ~61–70 in `qa/probes/nightly-manifest.txt`). Run **nightly at 08:00 UTC** (+ `workflow_dispatch`) via `.github/workflows/calendar-e2e-nightly.yml` (120-min cap, `PROBE_ATTEMPTS=3`). A hand-rolled runner (`qa/run-probes.js`) serves the app with `python3 -m http.server`, then `spawnSync`s each probe **serially**. Probes drive the real `index.html` in headless Chromium against the **live** Supabase + n8n backend, scoped to test client `sidneylaruel`. They use **Playwright's raw `chromium` driver, not `@playwright/test`**. Coverage is modelled rigorously: `docs/interaction-path-generator.js` encodes the status graph once and enumerates 33 transition-pairs + 6 golden paths; `docs/CALENDAR-TEST-CATALOG.md` crosses a control list against 14 lenses.

---

## 3. What's genuinely good

Give yourself real credit here — several things are better than what most solo projects ship:

- **High fidelity to the shipped artifact.** The whole app is one static file served as identical bytes everywhere, and the probes drive that exact file the same way GitHub Pages does. No build-step skew between test and prod. *This is a genuine, distinctive strength — and it's the reason a real-artifact-against-real-backend tier must survive any rebuild (see §6).*
- **The offline tier tests REAL shipping code, not paraphrases.** `grabFunc` extracts actual function bodies (`computeOverallStatus`, `_sxrApplyAutoStatus`, `_kasperIsFinished`), so logic bugs are caught against production source. `calendar-v2-status-repro.js` even validates its n8n webhook simulator against captured live echo shapes. This is a high-ROI layer; its weaknesses (below) are at the edges, not the core.
- **Exhaustive-by-construction interaction model.** The 33-transition-pair enumeration from a single source-of-truth status graph, with the catalog honestly noting the path explosion (28→252→2356→∞) and why pairs are the right cheap criterion, is materially better than ad-hoc scenario lists.
- **Assertions on the source of truth.** Probes assert on the Supabase row every surface renders from (plus Kasper-queue membership and the client-computed view), which catches cross-surface desync — the product's core risk.
- **Error capture.** Every page collects `console.error` / `pageerror` / `requestfailed` into `page._errs`, filtering benign 503s, and nearly every probe asserts zero app JS errors.
- **Self-cleanup discipline + safety scoping.** Unique time-based IDs, `finally`-block archival, all writes funnelled through one `up()` helper that hardcodes `client:'sidneylaruel'`. There is **no hard-delete primitive anywhere** — worst case is leaked test rows, not destroyed client data. Linear webhooks are intercepted in the probes that touch them.
- **The two-tier shape is correct** — fast/deterministic on every push, expensive/side-effecting on a schedule.
- **Good docs.** `docs/HEADLESS-TESTING-GUIDE.md` writes down the scope/safety rules and the "assert on the DOM, not internals" principle (even if the probes don't follow it).
- **One model hermetic probe already exists.** `p87_kasper_finish_stale_refresh.js` intercepts both the Supabase reads/upserts **and** the n8n upsert webhook via `ctx.route` to present an exact stale snapshot, asserts on rendered DOM, and writes nothing live — proof you already know the better pattern, for both read and write paths.

---

## 4. The problems, severity-ranked

| # | Problem | Why it bites you (especially unattended overnight) | Evidence |
|---|---------|----------------------------------------------------|----------|
| 1 | **No failure alerting** | This is the direct answer to "while I sleep." A failing probe at 3am produces only a red X in the Actions tab you must proactively open. A broken approve flow / dropped Linear sync can sit unseen for hours-to-days until a client complains. The detection engine runs and then **throws the result on the floor**. | No `discord\|slack\|notify\|email` step in any workflow; `calendar-e2e-nightly.yml` ends at the `run` step with no `if: failure()`. README's `DISCORD_WEBHOOK_URL` belongs to a **defunct** Instagram scraper, not wired to nightly. |
| 2 | **`PROBE_ATTEMPTS=3` retry-to-green hides real bugs** | A race that fails 1-in-3 — exactly the concurrency/realtime class this product is most exposed to — passes the gate silently and reports green. No flake count is recorded, so erosion is invisible. You wake to a green check papering over a real intermittent desync. | `run-probes.js`: `for (let attempt=1; attempt<=MAX_ATTEMPTS && !ok; attempt++)`; "counts as failed only if every attempt fails." |
| 3 | **UI-bypassing `page.evaluate` — integration-in-a-browser, not true E2E for most probes** | 346 `*.evaluate()` calls across 95 files vs ~28 real `.click()`/locator calls. Probes call private handlers (`_calStatusPick`, `_kasperApproveComp`) and assert on `calState`/`_kasperState`. These stay green even if the Approve button is invisible, disabled, mis-wired, or removed — **a passing run does not prove a user can approve.** This contradicts the repo's own guide. (It's a spectrum, not a binary — `p87` shows you can do it right.) | `p42:25-26`, `p49:37`, `p71` call private handlers; `clientHasCaption`/`waitForPost` assert on `calState`, never DOM. Guide (`HEADLESS-TESTING-GUIDE.md:247-249`): "Never assert on private internals." |
| 4 | **Tests run against LIVE PRODUCTION backend** (MEDIUM — leaked rows / false-green, not data loss) | The nightly suite mutates the same Supabase + n8n that paying clients use. The only isolation is a hardcoded string + RLS; there is no runtime scope assertion and no defense-in-depth. A crashed/timed-out probe skips its `finally` and leaks rows with no reclamation sweep. Every status change fires real n8n workflows (notifications, mirrors) on test data. Realistic worst case is leaked test rows + false signal, **not** destroyed client data. | `qa/golden_lib.js` hardcodes `https://...n8n.cloud/webhook/calendar-upsert-post` + prod Supabase URL; cleanup only in `finally` (`p74`, `p84`, `p28`); `spawnSync` SIGTERM on 240s timeout skips it; no pre-run sweep in `run-probes.js`. |
| 5 | **No artifacts captured** | When you wake to a red run, you get **25 lines of truncated stdout** (and the Actions log is itself subject to GitHub's log-retention window) — no trace, screenshot, video, DOM dump, or per-attempt breakdown. You can't tell a real regression from a backend hiccup, so you re-run the live probe locally — the exact toil the suite was meant to remove. | No `actions/upload-artifact` anywhere; only `lastOut.split('\n').slice(-25)` (`run-probes.js:73`). Raw chromium driver → no tracing infra at all. |
| 6 | **Pervasive hardcoded sleeps** | 346 `waitForTimeout` calls with magic constants (700/2500/5000/8000/12000ms). Too short under a slow nightly runner or n8n latency spike → false red, burning the retry budget; too long → minutes of dead time. Playwright's own best-practices guide states `waitForTimeout` "should only be used for debugging" ([Playwright Best Practices](https://playwright.dev/docs/best-practices)). | `lib.js` openers sleep 2500/5000/8000ms; `p38:47` sleeps 12000ms; magic-count polls (`i<25`, `i<22`) are timeouts in disguise. |
| 7 | **Not using `@playwright/test`** | The hand-rolled runner re-implements (badly) what the official runner gives free: fixtures, per-test isolation, parallel workers, sharding, auto-trace-on-retry, HTML report, `webServer`. No traces/parallelism/reports is the root cause of #5 and the serial-runtime problem. | `run-probes.js` is a `spawnSync` for-loop; `makeOk` is a homemade assert counter; no `@playwright/test` dependency. |
| 8 | **Serial run risks the 120-min timeout** | ~61 probes run strictly serially, each booting its own browser with multi-second sleeps, each ×3 on retry. A bad night (slow Supabase, a few flaky probes, two 4-min hangs) balloons toward 120 min; GitHub then **kills the job mid-suite** producing a red run with no summary and (per #1) no alert. | `run-probes.js:63-74` single `for...of` + `spawnSync`; no sharding/matrix. |
| 9 | **Data-leak / fragility on crash + no heartbeat** | Best-effort `finally` cleanup is skipped on kill; the documented-fragile `python3 -m http.server` has no in-CI restart (the guide itself warns it "occasionally dies"), turning one dead process into a cascade of `ERR_CONNECTION_REFUSED` false-reds ×3 retries. Worse for "while I sleep": cron only fires from the **default branch**, so work on another branch silently drifts the schedule, and there is **no heartbeat / dead-man's-switch** — the suite can stop running entirely and you'd see "green because it never ran," indistinguishable from healthy. | Guide warns of server death + recommends a pgrep guard `run-probes.js` lacks; schedule-from-default-branch gotcha unmarked in `calendar-e2e-nightly.yml`; no heartbeat step. |
| 10 | **SMM real-handler never exercised E2E; pyramid inverted; manifest gaps** | SMM status moves are simulated via the raw `up()` webhook, not the real `_calStatusPick`/`_calApplyAutoStatus` handler — the one surface with no real-handler E2E. The suite is top-heavy (~61 live E2E vs ~29 offline). The §11 checklist's own required lenses (XSS `p02`, role-matrix `p07`, fuzz, timezone `p04`) are in the **excluded** `p00–p27` set, not in the nightly gate. | `golden_lib.js` comment; `p14_pairs.js` `fire()` uses `G.up`; `nightly-manifest.txt`: "p00-p27 ... not part of the gate." |
| 11 | **Single browser/viewport; concurrency asserts row-only** | Chromium-only at a fixed desktop viewport — no WebKit/mobile, though clients very plausibly approve on a phone (Safari/iOS). Concurrency probes assert the DB converged but never re-read either rendered surface, so a UI clobber ("my approval disappeared") passes green. | Launches `chromium` only at 1400–1500×950; `p42` asserts Supabase row only. |
| 12 | **Offline-tier stub drift (false-green risk)** | Hand-copied stubs (e.g. `_CAL_REVIEW_CFG` in `title-review-lifecycle.js:50-53`) duplicate real config that `grabConst` can't extract; nothing asserts they still match reality. If the real mapping changes, the test stays green while prod breaks. Brace-counting extraction is string/comment-unaware and can silently truncate a function. *(This is an edge weakness in an otherwise high-value layer — see §3.)* | `title-review-lifecycle.js:50-53`; `grabConst` is single-line only; ~184 source-string-presence assertions that test code *looks* right, not *works*. |

**Note on security:** there is **no real secret leak** — the committed Supabase key is a publishable (anon) key, byte-identical to one already public in `index.html` (line 12422), read-only behind RLS; no service_role/JWT appears anywhere; CI uses zero Actions secrets (correctly). Two legitimate concerns the tests *surface* (they don't cause them): (1) the n8n upsert webhook is **unauthenticated and trusts a client-supplied `client` field** — your nightly suite exercises that open write path against prod every night, protected only by probe self-discipline; and (2) the app's auth gate is a **cleartext client-side password** (`synchrosocial2026`) the probes bypass — cosmetic security that should not be mistaken for access control. Both fixes are backend-side (webhook auth + server-side client allow-listing; real auth), reinforced by giving the suite an isolated backend.

---

## 5. How this compares to 2026 best practices

**The layer is right; the shape, environment, and flake-handling are not.**

- **Pyramid / Testing Trophy.** The 2026 consensus is a wide fast base, a thick *integration* middle, and a *thin* E2E cap — roughly 70/20/10 unit/integration/E2E ([Fowler, Practical Test Pyramid](https://martinfowler.com/articles/practical-test-pyramid.html); [Kent C. Dodds, Write Tests](https://kentcdodds.com/blog/write-tests); [Google Testing Blog](https://testing.googleblog.com/2015/04/just-say-no-to-more-end-to-end-tests.html)). SyncView is ~65% slow live E2E / 35% string-extraction unit tests (high-ROI but brittle at the edges), with almost no fast integration middle — the textbook **inverted "ice-cream cone."** E2E gives the worst signal-to-noise: a red probe could be the app, network, Supabase, n8n, realtime timing, or the test.

- **`@playwright/test` + auto-waiting locators + Trace Viewer.** The raw `playwright` library "ships NO test runner, assertions, isolation, retries, or reporting" — it's for scripts, not suites ([Playwright Library docs](https://playwright.dev/docs/library)). Best practice is web-first auto-retrying assertions (`expect(locator).toBeVisible()`) and semantic locators (`getByRole`/`getByText`) instead of `waitForTimeout` and internal pokes ([Playwright Best Practices](https://playwright.dev/docs/best-practices)), with `trace: 'on-first-retry'` so a CI failure is a clickable timeline, not a log tail ([Trace Viewer](https://playwright.dev/docs/trace-viewer-intro)). `webServer` replaces your hand-spawned static server ([webServer docs](https://playwright.dev/docs/test-webserver)); workers/sharding replace the serial loop ([parallelism](https://playwright.dev/docs/test-parallel)); projects add WebKit/mobile coverage ([projects](https://playwright.dev/docs/test-projects)).

- **Hermetic / seeded backends — don't test against prod, but keep a real-backend integration tier.** 2026 guidance "strongly recommends against production testing" in favour of ephemeral, production-*like* environments ([Bunnyshell E2E 2025](https://www.bunnyshell.com/blog/best-practices-for-end-to-end-testing-in-2025/)). A hermetic test "executes exactly the same way, every single time, so that when a test fails, we can trust that something really broke" ([hitchdev](https://hitchdev.com/hitchstory/approach/hermetic-end-to-end-test/)). Your stack ships the primitives: **Supabase Branching** gives an isolated per-PR instance seeded from `seed.sql` and auto-deleted on merge ([Supabase Branching](https://supabase.com/docs/guides/deployment/branching)), and **`supabase start` + `db reset`** runs the full stack locally with no quota/network ([Supabase Local Dev](https://supabase.com/docs/guides/local-development)). For most interaction *logic*, Playwright `route`/`fulfill`/`routeFromHAR` mocking removes "the single biggest source of flaky E2E" — the network — while you keep a small real-backend smoke set ([Playwright Mocking](https://playwright.dev/docs/mock)). **Important caveat for this product:** mocks cannot catch contract drift, RLS behaviour, realtime websocket timing, or Linear/n8n side-effects — so an *isolated-but-real* Postgres tier (`supabase start` / Branch) must survive for exactly those cases. Mock the logic bulk; keep a real-backend integration set.

- **E2E vs synthetic monitoring — two tools, different jobs.** They're "two sides of the same coin": E2E gates bugs *pre-deploy* in CI; synthetic monitors re-run the same journeys *continuously against production* and **alert** when live breaks ([USENIX/SREcon](https://www.usenix.org/publications/loginonline/synthetic-monitoring-e2e-testing-two-sides-same-coin); [Elastic](https://www.elastic.co/blog/why-and-how-replace-end-to-end-tests-synthetic-monitors); [Microsoft Eng Playbook](https://microsoft.github.io/code-with-engineering-playbook/automated-testing/synthetic-monitoring-tests/)). **Your nightly suite is mislabelled E2E**: it behaves like a synthetic monitor (hits prod on a cron) but is framed and retried like a gate — and a once-daily run can't tell you the calendar broke at 3am.

- **Retries-with-trace, not retry-to-green.** Retries are "a temporary unblocking mechanism, NOT a fix"; the named anti-pattern is **silent retry** that keeps CI green while masking the problem ([QA Wolf](https://www.qawolf.com/blog/what-your-system-should-do-with-a-flaky-test)). The right form is bounded retry **plus** logging which attempt passed **plus** a trace, so you can distinguish "flaked once → fix the test" from "fails across retries → real bug" ([BrowserStack](https://www.browserstack.com/guide/playwright-flaky-tests)). Track a flakiness score and quarantine chronic offenders rather than blanket-retrying ([TestDino](https://testdino.com/blog/flaky-tests-complete-guide/)). Flake is not free: Google reported ~1.5% of runs flaky affecting ~16% of tests ([Google, 2016](https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html)), and more recent industry analysis puts the cost at ~1.28% of developer time / on the order of ~$2,250/developer/month ([TestDino flaky-tests guide](https://testdino.com/blog/flaky-tests-complete-guide/)).

- **Failure alerting is mandatory for unattended runs.** Add an `if: failure()` notification (Slack/Discord/email) so you wake to a *signal*, not a silent red X ([notify-slack-action](https://github.com/ravsamhq/notify-slack-action)). Also: GitHub cron is best-effort — top-of-hour slots are delay/drop-prone, and public-repo schedules auto-disable after 60 days of *repository* inactivity ([GitHub docs](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows)). For *this* repo the per-push unit-test workflow gives regular pushes, which mitigates auto-disable — but workflow runs themselves don't count as activity, so a "missing green run" is still ambiguous without alerts plus an explicit heartbeat.

- **Synthetic-monitoring services.** For a solo operator, a managed Playwright-native monitor beats a hand-rolled cron: **Checkly** runs your existing Playwright code on a schedule with retries, traces, video, and alerting (email/Slack/PagerDuty), free Hobby tier ~1,500 browser runs/mo ([Checkly + Playwright](https://www.checklyhq.com/blog/synthetic-monitoring-with-checkly-and-playwright-test/); [Check Suites](https://www.checklyhq.com/product/playwright-check-suites/)). Avoid dumb URL/200 pings — a GitHub Pages 200 says nothing about Supabase/n8n; use a content-aware check ([UptimeRobot limits](https://qodex.ai/blog/uptimerobot-alternatives)). Datadog Synthetics is the wrong economics for solo ([Checkly cost note](https://www.checklyhq.com/blog/how-to-spend-ten-grand-12-bucks-at-a-time/)).

- **AI / agentic testing maturity.** Playwright has decisively won the OSS E2E race and is the substrate every serious AI testing layer (MCP, agents, Checkly, Octomind, QA Wolf) is built on ([tech-insider](https://tech-insider.org/playwright-vs-cypress-vs-selenium-2026/)). Headless Playwright remains the *right foundation* for deterministic regression of an app you own — AI browser agents trade reproducibility for adaptability, the opposite of what an assertion suite wants ([tinyfish](https://www.tinyfish.ai/blog/headless-browser-vs-ai-agents)). The genuinely production-grade AI piece today is the **Healer** agent (~75% on *selector* failures) — use it locally/human-in-the-loop, never auto-wired into CI, because it heals selectors, **not** your Supabase/n8n/Linear logic ([Playwright Test Agents](https://playwright.dev/docs/test-agents); [TestDino ecosystem](https://testdino.com/blog/playwright-ai-ecosystem)). Skip autonomous test-gen platforms (Octomind/QA Wolf/Momentic) — they "win Week 1 and lose Week 6" on conditional multi-surface flows exactly like yours ([bug0](https://bug0.com/blog/best-qa-automation-tools-2026)).

---

## 6. Recommendation — a target architecture

Four tiers, each matched to the job it's actually good at. **For a solo operator, treat this as a destination, not a sprint:** the high-ROI moves (alerting + a synthetic monitor) are days of work; the full `@playwright/test` + hermetic-backend rebuild is *optional and aspirational*, done incrementally if and when it pays for itself. The live nightly run has real value today — keep it running while you migrate.

**(a) Keep & expand the fast offline layer — your gate's foundation.**
Keep the extract-and-run unit tests (they pin the hardest-to-eyeball pure logic against real source). Harden the technique: make `grabConst` multi-line-aware so configs like `_CAL_REVIEW_CFG` are *extracted not copied* (kills the stub-drift false-green class), add a one-time stub-vs-reality assertion for any remaining hand-copy, and extract the duplicated `grabFunc`/`grabConst` into one string-aware module. Then **add jsdom DOM tests** (still offline, no network) to convert the ~184 "code looks right" string assertions into "renders/wires right" assertions — in-memory component testing of a single-file app is well-supported practice ([Thoughtworks: Component Testing](https://www.thoughtworks.com/radar/techniques/component-testing); [alexwlchan on Playwright for static sites](https://alexwlchan.net/2026/playwright/)). This pulls a large slice of coverage *down* out of the live run.

**(b) (Aspirational, incremental) Convert the E2E probes to `@playwright/test` against a HERMETIC seeded backend — run on PR / pre-deploy, not blind nightly.**
This is the largest item and is **optional for a solo dev** — do it gradually, not as one migration. Replace `qa/run-probes.js` with `playwright.config.js` (gets you workers, sharding, HTML report, Trace Viewer, `webServer`, retries-with-trace for free). Drive the **real UI** (`getByRole`/`getByText` + a few `data-testid`s on the review/approve/tweak controls) and assert on rendered DOM, not `calState`. Point the *interaction-logic bulk* at `route`/`fulfill` mocks, and run the cases that need real Postgres/realtime/n8n side-effects against an **isolated-but-real** backend (`supabase start` local stack or a per-PR Branch). **Do not mock away the real-backend integration tier** — contract drift, RLS, realtime timing and Linear/n8n side-effects are precisely what mocks hide, and real-artifact-against-real-backend fidelity is the distinctive strength from §3 worth preserving. Fold `seedCaptionCard`/archive into a setup-project / global-teardown.

**(c) Split out a SMALL set of LIVE production smoke checks as SYNTHETIC MONITORING with real alerting.**
This is what actually answers "is my calendar working while I sleep." Take ~3–6 golden-path journeys (load calendar → open post → assert components render; one canonical approve), point them at **live prod**, and run them **continuously** (every 5–15 min) via Checkly (or a content-aware cron) with **failure alerts to Slack/Discord/email**. Reframe these as availability monitoring — few, alert-driven, read-mostly — not a correctness gate.

**(d) Add failure alerting + trace artifacts NOW, regardless of the bigger migration.**
Even before any rebuild, the nightly job must (1) post run URL + failed-probe list on `if: failure()`, and (2) upload screenshots/`page._errs`/traces via `actions/upload-artifact` (14–30 day retention).

**Why this cadence split matters:** a CI gate's job is to catch a regression *before it ships* — it must run on PR/pre-deploy, in seconds-to-minutes, hermetically, or it's "too late" (a noon regression is live on Pages until tomorrow's 08:00 run). A monitor's job is to catch *production breaking right now* — it must run continuously against prod and page you. **"Nightly headless E2E" tries to be both and is good at neither.** Stop asking one cron to do two jobs. And because **`main` = the live site**, getting even a small smoke subset onto a *pre-merge blocking gate* matters more than its placement in the action plan suggests — that's your only defense against shipping a regression straight to clients.

---

## 7. Prioritized action plan

**Do this week (hours of work, huge ROI):**
1. **Add `if: failure()` alerting** to `calendar-e2e-nightly.yml` posting run URL + failed-probe names to Discord/Slack. *This single change makes "while I sleep" real.*
2. **Surface flake instead of hiding it.** Make `run-probes.js` record and print which attempt passed (`p49 passed on attempt 3/3 — FLAKY`); treat any retry as a yellow signal worth a ticket. (Cheaper interim than removing retries.)
3. **Upload artifacts on failure** — `page.screenshot()` + `page._errs` dump via `actions/upload-artifact`. Stop debugging from a 25-line stdout tail.
4. **Move cron off the top of the hour** (`17 8 * * *`), add a **heartbeat / dead-man's-switch** (e.g. a healthchecks.io ping on success so "it never ran" is itself an alert), and add a runtime assert that every mutated row's `client === 'sidneylaruel'` (cheap defense-in-depth for the single-string scoping).

**Do this month:**
5. **Stand up a live production synthetic monitor** (Checkly free tier or content-aware cron): one browser journey + one Supabase-health check, alert-driven. This is the real "is it working overnight" answer.
6. **Gate a small smoke subset pre-merge.** Because `main` deploys live, get ~3–6 real-UI smoke checks running as a *blocking* PR gate — this is higher-leverage than its size suggests and can be done before the full migration.
7. **De-duplicate probes** (p14 already subsumes much of golden/p45/p47; merge p37+p52) and **close the manifest gaps** — pull XSS (`p02`), role-matrix (`p07`), timezone (`p04`), fuzz back into the gate, and add a real-handler SMM E2E path.

**Bigger bets (incremental, optional for a solo operator):**
8. **Migrate the probe suite to `@playwright/test`** gradually: `webServer`, parallel workers, `trace: 'on-first-retry'`, HTML report. Retire the bespoke runner + retry-to-green logic as you go; replace `waitForTimeout`/magic-count polls with web-first assertions.
9. **Give E2E a hermetic backend** — add a `supabase/` dir (`config.toml`, `migrations/`, `seed.sql`), run `supabase start`/`db reset` or per-PR Branching. Mock Supabase/n8n via `route` for the interaction-logic bulk; **keep a tiny isolated-but-real backend set** for realtime/n8n/RLS/contract drift.
10. **Rebalance the pyramid** — push interaction coverage down into the hermetic Playwright + jsdom layers; shrink live E2E to a thin smoke cap.
11. **Add cross-surface coverage gaps** — at least one WebKit/mobile project (clients approve on phones), re-read *rendered surfaces* after concurrency races (not just the DB row), and harden the backend (webhook auth + server-side client allow-listing; replace the cosmetic client-side password with real auth).
12. **Adopt the Playwright Healer agent locally/human-in-the-loop** for selector drift; skip autonomous test-gen platforms and in-CI MCP runs.

---

## 8. Sources

- https://martinfowler.com/articles/practical-test-pyramid.html
- https://kentcdodds.com/blog/write-tests
- https://testing.googleblog.com/2015/04/just-say-no-to-more-end-to-end-tests.html
- https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html
- https://www.thoughtworks.com/radar/techniques/component-testing
- https://www.digitalapplied.com/blog/software-testing-strategy-2026-engineering-reference
- https://playwright.dev/docs/library
- https://playwright.dev/docs/best-practices
- https://playwright.dev/docs/test-fixtures
- https://playwright.dev/docs/trace-viewer-intro
- https://playwright.dev/docs/trace-viewer
- https://playwright.dev/docs/test-webserver
- https://playwright.dev/docs/test-parallel
- https://playwright.dev/docs/test-projects
- https://playwright.dev/docs/test-reporters
- https://playwright.dev/docs/mock
- https://playwright.dev/docs/network
- https://playwright.dev/docs/test-global-setup-teardown
- https://playwright.dev/docs/aria-snapshots
- https://playwright.dev/docs/ci
- https://playwright.dev/docs/test-agents
- https://playwright.dev/docs/accessibility-testing
- https://playwright.dev/docs/test-snapshots
- https://github.com/microsoft/playwright-mcp
- https://hitchdev.com/hitchstory/approach/hermetic-end-to-end-test/
- https://www.bunnyshell.com/blog/best-practices-for-end-to-end-testing-in-2025/
- https://www.bunnyshell.com/blog/end-to-end-testing-for-microservices-a-2025-guide/
- https://supabase.com/docs/guides/deployment/branching
- https://supabase.com/docs/guides/local-development
- https://www.sachith.co.uk/contract-testing-with-pact-best-practices-in-2025-practical-guide-feb-10-2026/
- https://totalshiftleft.ai/blog/best-practices-test-data-management
- https://www.usenix.org/publications/loginonline/synthetic-monitoring-e2e-testing-two-sides-same-coin
- https://www.elastic.co/blog/why-and-how-replace-end-to-end-tests-synthetic-monitors
- https://microsoft.github.io/code-with-engineering-playbook/automated-testing/synthetic-monitoring-tests/
- https://www.datadoghq.com/knowledge-center/flaky-tests/
- https://www.qawolf.com/blog/what-your-system-should-do-with-a-flaky-test
- https://www.browserstack.com/guide/playwright-flaky-tests
- https://testdino.com/blog/flaky-tests-complete-guide/
- https://testdino.com/blog/playwright-pr-health/
- https://testdino.com/blog/playwright-ai-ecosystem
- https://github.com/ravsamhq/notify-slack-action
- https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows
- https://www.checklyhq.com/product/playwright-check-suites/
- https://www.checklyhq.com/blog/synthetic-monitoring-with-checkly-and-playwright-test/
- https://www.checklyhq.com/blog/how-to-spend-ten-grand-12-bucks-at-a-time/
- https://www.checklyhq.com/docs/detect/synthetic-monitoring/browser-checks/playwright-support/
- https://qodex.ai/blog/uptimerobot-alternatives
- https://tech-insider.org/playwright-vs-cypress-vs-selenium-2026/
- https://www.tinyfish.ai/blog/headless-browser-vs-ai-agents
- https://bug0.com/blog/best-qa-automation-tools-2026
- https://www.shiplight.ai/blog/best-self-healing-test-automation-tools
- https://applitools.com/blog/ai-driven-testing-with-applitools-autonomous/
- https://argos-ci.com/
- https://alexwlchan.net/2026/playwright/

---

*Method: this evaluation was produced by a 15-agent analysis — 6 agents statically auditing the repo's test setup, 6 researching 2025–2026 best practices with cited sources, then synthesis + an adversarial fact-check pass against the actual files. No probes were executed (they hit the live production backend).*
