# Testing — the map

One page that ties every test suite, gate, and Claude skill together. If you
only remember one file about testing, remember this one.

## The two safety contracts (never confuse them)

| Contract | Applies to | Rule | Canonical text |
|---|---|---|---|
| **Live-backend QA** | `test/`, `qa/` (probes, scenarios, master) | Mutating the backend is *expected* — but ONLY the test client `sidneylaruel`, unique ids, archive on exit, Linear always mocked, 0 app JS errors | `HEADLESS-TESTING-GUIDE.md` §5 (+ the mocked-Linear / 0-JS-errors clauses in `qa/MASTER_TESTER.md` → Safety) |
| **Production read-only** | The `?prod=1` Production tab and its suites | ZERO writes of any kind — no write-like browser requests (only GET/HEAD/OPTIONS), no runtime flags, no backend/n8n/Linear changes; guarded controls stay guarded | `AGENTS.md` + `docs/independence/TRACK_B_LINEAR_REPLACEMENT_SPEC.md` §10.8 |

They share the `sidneylaruel` name but answer different questions ("which rows
may I mutate?" vs "may anything be written at all?"). A rule merged across them
is wrong in one direction or the other.

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
| `npm run test:master` | `qa/master.js` fast profile (smoke subset + visual capture); `npm run test:master:full` runs every lane — see `qa/MASTER_TESTER.md` | Big changes; nightly subset |
| `npm run test:prod-polish` | The complete Production polish gate (boot, structure, zero-write smoke, interactions, a11y, layout, behavior, pixels); CI splits it into a fast required PR lane and parallel full `main`/nightly lanes — see `PRODUCTION_POLISH_AUTOMATION.md` | Any Production-tab change |
| `node docs/syncview-design/tests/prod-readonly-smoke.js` | Production read-only invariant (zero non-GET) | Production parity work; samples nightly |

## The four Claude skills (a 2×2)

|  | **Whole app** (Samples/Calendar, live backend) | **Production tab** (vs its reference) |
|---|---|---|
| **One-shot check** | `/master-test` — run every lane, then judge screenshots with eyes | `/human-audit` — hand-and-eyes parity loop vs the reference artifact |
| **Continuous loop** | `/overnight-test` — autonomous probe-writing QA loop, morning report | `/feedback-expansion` — owner observations → rules → sweep → prove |

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
