# Design-kit behavioral test suites (copied from the design machine, 2026-07-05)

Source: Sidney's `C:\Users\Sidney\linear-design-probe\` (shared via Drive folder
`linear-design-probe`, owner-provided). These are the proof-of-parity suites the Track B build
session re-runs against the wired Production tab (spec §10.6/§12, decision D-17 — now satisfied).

| File | What | How to run |
|---|---|---|
| `prod-readonly-smoke.js` | B2 wired-tab read-only suite. Runs against `index.html?prod=1`, verifies real migrated rows, team filters, detail/deep links, batch links, board columns, disabled write affordances, no write-like browser requests, and 0 page/console errors. | `node docs/syncview-design/tests/prod-readonly-smoke.js` |
| `prod-structure-subset.js` | Read-only structural subset adapted from `behav.js`/`sweep.js`. Runs against the wired `index.html?prod=1` tab and verifies the SyncView artifact sidebar tree, Production boot skeleton wiring, grouped list rows, status glyphs, centered detail cards, compact activity rows, child `Sub-issue of` context, title-first sub-issue rows, project toolbar order, project Display grouping/show-sub-issues behavior, removed workspace menu, searchable selected-issue Actions menu, team-scoped Projects board, disabled mutating controls, and no write-like browser requests. | `node docs/syncview-design/tests/prod-structure-subset.js` |
| `behav-wired.js` | Primary wired-tab interaction coverage in guard mode. Drives list, board, project detail, issue detail, project Display grouping/show-sub-issues behavior, static workspace brand/no-menu behavior, menus, pickers, palette, keyboard, selection/focus cleanup, selected-issue Actions search and Copy issue ID, combined filters, hover/right-click, history, scroll, compact activity rows, and zero-write checks. Mutation-only Linear behaviors stay listed as `deferred-B3`. | `node docs/syncview-design/tests/behav-wired.js` |
| `prod-interaction-inventory.js` | Finished-read-only inventory sweep. Samples unique visible controls across list, selected list, filtered empty, detail, board, selected board, and project states; checks app right-click menus plus native browser-menu suppression, hover tips, row open/checkbox/status/due/assignee/client-chip pointer controls, sub-issue scroll reset, breadcrumb/body context, project toolbar controls, guarded add-sub-issue affordance, project-card cursor, no browser errors, and no write-like requests. | `node docs/syncview-design/tests/prod-interaction-inventory.js` |
| `pixel-wired.js` | Wired-tab visual/placement parity pass for light and dark mode. Checks list, icons, palette, selection/actionbar, selected-action picker anchoring, status picker inventory, context menus, due popover, filter pill, filtered empty state, board drag/scroll, project detail toolbar tab removal, detail, and browser-history parity. | `node docs/syncview-design/tests/pixel-wired.js` |
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
so the mutating prototype assertions stay guarded or disabled in the wired tab. The wired-tab
gates are `prod-readonly-smoke.js`, `prod-structure-subset.js`, `behav-wired.js`,
`prod-interaction-inventory.js`, and `pixel-wired.js`; the original mutating suites become the B3/B4 gate when writes are
intentionally enabled.

When the Production tab is wired, the suites' selectors must also be adapted to the renamed
status keys (spec §10.1: prototype `prog`/`smm`/`kasper`/`client` → slugs
`in_progress`/`smm_approval`/`kasper_approval`/`client_approval`) — that adaptation is part of
the §12 lane work and its diffs should be committed alongside.

The probe harness (`probe.js` + captures) and the `.linear-probe-profile` browser profile were
deliberately NOT copied — the profile contains a live Linear login session and must never enter
this public repo.
