# Design-kit behavioral test suites (copied from the design machine, 2026-07-05)

Source: Sidney's `C:\Users\Sidney\linear-design-probe\` (shared via Drive folder
`linear-design-probe`, owner-provided). These are the proof-of-parity suites the Track B build
session re-runs against the wired Production tab (spec §10.6/§12, decision D-17 — now satisfied).

| File | What | How to run |
|---|---|---|
| `prod-readonly-smoke.js` | B2 wired-tab read-only suite. Runs against `index.html?prod=1`, verifies real migrated rows, team filters, detail/deep links, batch links, board columns, disabled write affordances, no write-like browser requests, and 0 page/console errors. | `node docs/syncview-design/tests/prod-readonly-smoke.js` |
| `prod-structure-subset.js` | Read-only structural subset adapted from `behav.js`/`sweep.js`. Runs against the wired `index.html?prod=1` tab and verifies the SyncView artifact sidebar tree, grouped list rows, status glyphs, detail cards, team-scoped Projects board, disabled mutating controls, and no write-like browser requests. | `node docs/syncview-design/tests/prod-structure-subset.js` |
| `behav.js` | The primary behavioral regression suite — **138 assertions**, one per shipped interaction (list/board/detail/pickers/palette/keyboard/multi-select/undo). Prints `ALL N BEHAVIORS PASS` + `JS ERRORS: 0`. | `node behav.js` (needs Playwright + a built prototype) |
| `qa-features.js` | Self-verify harness — drives every feature + menu regression sweep, asserts zero page/console errors. Prints `ALL GREEN`. | `node qa-features.js` |
| `sweep.js` | Interaction fuzz sweep — hovers/clicks every interactive element on all 6 surfaces, asserts 0 JS errors. Prints `SWEEP CLEAN`. | `node sweep.js` |
| `build.js` | Builds the prototype: injects the Inter font into the source (`__INTER_B64__` placeholder) → emits `out/SyncView.html` + `out/_sv.html`. | `node build.js` |
| `syncview-parity-audit.js` | The re-launchable 5-agent adversarial parity audit (Claude Workflow script). | `Workflow({scriptPath: ...})` |

**Path adaptation required before running here:** the scripts hardcode
`C:/Users/Sidney/linear-design-probe/out` as the build/output dir. In this repo the equivalents
are `docs/syncview-design/SyncView.html` (built) and `docs/syncview-design/syncview-app.src.html`
(source with the `__INTER_B64__` placeholder — `build.js` needs the Inter woff2, which is
embedded in the built `SyncView.html` and can be extracted from its `@font-face` base64).
For B2, the shipped Production tab is intentionally read-only while Linear remains authoritative,
so the mutating prototype assertions stay on the standalone prototype. The wired-tab gate is
`prod-readonly-smoke.js`; the original mutating suites become the B3/B4 gate when writes are
intentionally enabled.

When the Production tab is wired, the suites' selectors must also be adapted to the renamed
status keys (spec §10.1: prototype `prog`/`smm`/`kasper`/`client` → slugs
`in_progress`/`smm_approval`/`kasper_approval`/`client_approval`) — that adaptation is part of
the §12 lane work and its diffs should be committed alongside.

The probe harness (`probe.js` + captures) and the `.linear-probe-profile` browser profile were
deliberately NOT copied — the profile contains a live Linear login session and must never enter
this public repo.
