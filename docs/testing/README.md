# Testing — the map

One page that ties every test suite, gate, and Claude skill together. If you
only remember one file about testing, remember this one.

## The three safety contracts (never confuse them)

| Contract | Applies to | Rule | Canonical text |
|---|---|---|---|
| **Live-backend QA** | `test/`, `qa/` (probes, scenarios, master) | Mutating the backend is *expected* — but ONLY the test client `sidneylaruel`, unique ids, archive on exit, Linear always mocked, 0 app JS errors | `HEADLESS-TESTING-GUIDE.md` §5 (+ the mocked-Linear / 0-JS-errors clauses in `qa/MASTER_TESTER.md` → Safety) |
| **Production locked-state safety** | `prod-readonly-smoke.js` and authority-aware guard coverage | Read-only live observation is allowed, including the bounded comment-read POST; ZERO live mutations, runtime-flag changes, n8n writes, or Linear writes; guarded controls stay guarded | `AGENTS.md` + `docs/independence/TRACK_B_LINEAR_REPLACEMENT_SPEC.md` §10.8 |
| **Production native-write capability** | `test/production-write-ui-source.js` and `prod-write-gateway-browser.js` | Status/comment/due/assignee are real authority-gated capabilities. Browser coverage uses a fully intercepted local mock only; it proves role/team/authority/TEST/CAS/stale-tab behavior without reaching a live backend | `docs/truth/APP.md` + `ROLLBACK.md` write-UI rows |
| **PTO lifecycle simulation** | `qa/pto-lifecycle/` | Lane A is fully intercepted and synthetic, but uses the production PTO policy engine; Lane B is opt-in and may touch only pre-existing dedicated TEST identities, one disposable unpaid request, and exact cleanup in `finally`. Live screenshots stay untracked and no HR values are printed. | `qa/pto-lifecycle/README.md` |

The TEST client, locked mirror state, and mocked writable state answer different questions:
"which live fixture may a probe mutate?", "does a locked tab stay network-read-only?", and "does
the shipped capability open and fail closed correctly?" A rule merged across them is wrong in one
direction or the other. `npm run test:prod-polish` intentionally combines the latter two contracts.
Locked lanes may read live production data; only the writable-capability lane is fully mocked, and
no design-kit suite may send a live mutation.

## "Parity" means two unrelated things here

- **Samples-parity** — the `parity` lane of `qa/master.js`: Samples `_sxr*` is a
  faithful clone of calendar `_cal*`. Owned by `qa/MASTER_TESTER.md`.
- **Production-parity** — the `?prod=1` tab matches Linear / the locked design
  artifact (`docs/syncview-design/SyncView.html`). Owned by the design kit
  (`docs/syncview-design/`) and the polish gate.

## Suites and gates

| Command | What it runs | When |
|---|---|---|
| `npm test` | Every `test/*.js` — offline pure-logic suites, auto-discovered (includes `test/port-fidelity-check.js` and `test/repo-map-sync.js`) | Every push (CI) and before every commit |
| `npm run test:e2e` | Live probes in `qa/probes/nightly-manifest.txt` | Nightly CI; on demand |
| `npm run test:master` | `qa/master.js` fast profile (smoke subset + visual capture); `npm run test:master:full` runs every master-registered lane — see `qa/MASTER_TESTER.md`. Feature-scoped PTO runs separately. | Big changes; nightly subset |
| `npm run test:prod-polish` | Aggregate Production gate: boot, structure, locked live-read/zero-mutation smoke, comment reads, fully mocked write gateway, interactions, a11y, layout, behavior, pixels. F105 repaired the post-#813 fixture/layout/read-audit epoch: only exact eligible recovery is accepted, pending/unmatched errors and every live mutation remain fatal, and the fast PR subset alone is not a go-live pass. | Any Production-tab change; must be green on the exact candidate before go-live |
| `node docs/syncview-design/tests/prod-readonly-smoke.js` | Production read-only invariant (zero non-GET) | Production parity work; samples nightly |
| `node docs/syncview-design/tests/prod-write-gateway-browser.js` | Fully mocked authority-gated status/comment/due/assignee capability; no live backend | Production write-gateway or authority work |
| `npm run test:pto-lifecycle` | Stateful three-person PTO lifecycle, error/retry, tabs/session, responsive/keyboard, and policy time travel; screenshots for each lifecycle action plus transient controls | PTO UI, Edge policy, or lifecycle work; fully mocked and CI-safe |
| `npm run test:pto-live-drill` | One opt-in production unpaid TEST request → approve → exact delete → zero matching request-row residue | Release drill only; requires dedicated TEST staff/admin private variables and never runs in CI |

## The six Claude skills (a 2×2 + two conductors)

|  | **Whole app** (Samples/Calendar, live backend) | **Production tab** (vs its reference) |
|---|---|---|
| **One-shot check** | `/master-test` — run every lane, then judge screenshots with eyes | `/human-audit` — hand-and-eyes parity loop vs the reference artifact |
| **Continuous loop** | `/overnight-test` — autonomous probe-writing QA loop, morning report | `/feedback-expansion` — owner observations → rules → sweep → prove |

Outside the 2×2: `/bug-archaeology` — preventive, history-driven. Mines past
incidents into fracture patterns, sweeps the codebase for latent siblings,
adversarially verifies every candidate, ships survivors as fixes + regression
guards. Use after heavy change periods ("find the bugs before they happen").

And the conductor: `/site-assurance` — the umbrella loop that holds the WHOLE
site to the owner-ratified contract in `docs/QUALITY_TIERS.md`. Each cycle it
scores every surface (tier × proof staleness × churn), proves the top ones by
dispatching the right skill above (or writing the missing probe), and updates
the coverage ledger `docs/testing/ASSURANCE_LEDGER.md` — so "does the website
work?" always has a current, honest, surface-by-surface answer.

`/human-audit`, `/feedback-expansion`, and `/overnight-test` are written as a
**general protocol plus a target binding** — the protocol survives feature
changes; retarget by swapping the binding block. `/master-test` is bound to
the `qa/master.js` engine by design: new coverage goes into the engine's
scenarios/lanes, and the skill picks it up automatically.

## Reading order for a fresh session

1. `HEADLESS-TESTING-GUIDE.md` — how to drive the real app headless (the model
   behind every harness), and the live-backend safety contract (§5).
2. `qa/README.md` — what lives in `qa/` and the everyday run commands.
3. `qa/MASTER_TESTER.md` — the unified engine: lanes, profiles, vision pass.
4. `CALENDAR-TEST-CATALOG.md` — *what to check*: the exhaustive inventory of
   review-flow behaviors and transition pairs.
5. `PRODUCTION_POLISH_AUTOMATION.md` — the Production gate and review packet.
6. `docs/syncview-design/tests/README.md` — the per-suite catalog for the
   Production design kit.
