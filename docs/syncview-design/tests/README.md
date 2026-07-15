# Design-kit behavioral test suites (copied from the design machine, 2026-07-05)

The current `prod-*`/`behav-wired` suites are the repository proof path. The
`design-machine-originals/` files were imported from a prototype-era external workspace and remain
only as frozen adaptation evidence. That external workspace/profile is not a current dependency;
F64/D-17 provider-session containment remains open.

| File | What | How to run |
|---|---|---|
| `prod-readonly-smoke.js` | B2 wired-tab read-only suite. Runs against `index.html?prod=1`, verifies real migrated rows, team filters, detail/deep links, batch links, board columns, disabled write affordances, no write-like browser requests, and 0 page/console errors. | `node docs/syncview-design/tests/prod-readonly-smoke.js` |
| `prod-polish-gate.js` | Aggregate runner for boot, structure, locked live-read/zero-mutation smoke, comment reads, fully mocked write gateway, interaction, accessibility/focus, layout, behavior, and pixels. CI splits `fast`/`interaction`/`heavy`; only `fast` runs on PRs. **F105: aggregate is currently red because interaction/heavy retain superseded guard-mode picker assertions.** Locked lanes may read live data; no lane may send a live mutation. | `npm run test:prod-polish` |
| `prod-comments-browser.js` | Fully intercepted comment-read contract: staff auth, newest/older paging, refresh races, merge/escaping/visibility/error states, and a Linear-authoritative composer that remains guarded. Its POST is a read operation to the mocked `production-comments` function. | `node docs/syncview-design/tests/prod-comments-browser.js` |
| `prod-write-gateway-browser.js` | Fully intercepted native-write contract. Proves mixed team authority, verified-role headers, status/comment/due/assignee operations, CAS, bounded active-TEST override, locked-team rejection, and stale-tab authority refresh against a local mock only. | `node docs/syncview-design/tests/prod-write-gateway-browser.js` |
| `prod-boot-budget.js` | Production refresh/loading check. Verifies `?prod=1` maps to the Production pre-paint skeleton, the mounted root becomes visible within budget, the Analytics skeleton is not visible/leaked, and no writes/errors occur during boot. | `node docs/syncview-design/tests/prod-boot-budget.js` |
| `prod-structure-subset.js` | Read-only structural subset adapted from `behav.js`/`sweep.js`. Runs against the wired `index.html?prod=1` tab and verifies the SyncView artifact sidebar tree, Production boot skeleton wiring, grouped list rows, status glyphs, centered detail cards, dormant activity-renderer style structure (not runtime event loading; F138), child `Sub-issue of` context, title-first sub-issue rows, project toolbar order, project Display grouping/show-sub-issues behavior, removed workspace menu, searchable selected-issue Actions menu, team-scoped Projects board, disabled mutating controls, and no write-like browser requests. | `node docs/syncview-design/tests/prod-structure-subset.js` |
| `behav-wired.js` | Historical guard-mode interaction corpus. It still expects supported pickers to open while the write gate is closed and still labels shipped status/comment/due/assignee behavior `deferred-B3`. **F105: not current go-live evidence until split into explicit locked and fully mocked writable states.** | `node docs/syncview-design/tests/behav-wired.js` (expected red under F105) |
| `prod-interaction-inventory.js` | Broad live-read/zero-mutation surface inventory. **F105: currently red because its row status/due/assignee checks expect the pre-write “open picker, then guard selection” model, while current source and the structure suite fail closed before opening a picker.** | `node docs/syncview-design/tests/prod-interaction-inventory.js` (expected red under F105) |
| `prod-a11y-focus.js` | Accessibility/focus polish gate. Runs scoped axe-core checks, verifies visible controls have names/types, focused icon controls activate with Enter/Space, Escape closes transient chrome, and keyboard row navigation still works. | `node docs/syncview-design/tests/prod-a11y-focus.js` |
| `prod-layout-polish.js` | Layout clipping gate across desktop, compact desktop, and mobile widths. Checks row/card metadata, filter pills, selected project cards, project details, and floating chrome stay inside their containers/viewports. | `node docs/syncview-design/tests/prod-layout-polish.js` |
| `prod-review-packet.js` | Local reviewer packet generator. Captures named desktop, dark, and mobile screenshots plus a `manifest.md`. The images can contain live customer-visible text and must never be committed, uploaded by public Actions, or sent to Argos. | `npm run test:prod-review` |
| `prod-review-packet-validate.js` | Validates the local review packet (gallery, manifests, checklist, required surfaces/viewports/themes, screenshot Production state, read-only invariant) before local use. Validation is not a privacy projection. | `npm run test:prod-review:validate` |
| `prod-test-utils.js` | Shared module for the wired suites: static server, Production init script, `openProduction`, write-like request detection. Not run directly. | (library) |
| `prod-argos-export.js` | Local-only Argos-format export. It validates the packet, then writes desktop/dark PNGs plus metadata under `.codex-tmp`; public CI distribution remains disabled until the source is fully fictional and canary-tested. | `npm run test:prod-argos:prepare` |
| `pixel-wired.js` | Wired-tab visual/placement parity pass for light and dark mode. Checks list, icons, palette, selection/actionbar, selected-action picker anchoring, status picker inventory, context menus, due popover, filter pill, filtered empty state, board drag/scroll, project detail toolbar tab removal, detail, and browser-history parity. | `node docs/syncview-design/tests/pixel-wired.js` |
| `design-machine-originals/behav.js` | Frozen prototype behavioral regression source, retained to explain wired-suite adaptation. | **NO-RUN — historical source only** |
| `design-machine-originals/qa-features.js` | Frozen prototype self-verify source. | **NO-RUN — historical source only** |
| `design-machine-originals/sweep.js` | Frozen prototype interaction-sweep source. | **NO-RUN — historical source only** |
| `design-machine-originals/build.js` | Frozen prototype external-build source. It is not the repository build path. | **NO-RUN — historical source only** |
| `design-machine-originals/syncview-parity-audit.js` | Frozen prototype workflow source. It must not relaunch an external profile/session. | **NO-RUN — historical source only** |

> The five `design-machine-originals/` files are the prototype-era suites copied verbatim from
> the design machine. They contain obsolete external paths and are **not runnable in this repo**.
> They explain how the current wired suites were adapted; do not path-adapt, build, publish, or
> relaunch them. Git history and the frozen source are sufficient for archaeology.
The B2 read-only milestone is historical. Production now ships authority-gated native status,
comment, due-date, and assignee writes, while a Linear-authoritative/unsigned state remains locked
and the bounded active-TEST override can exercise the gateway. The aggregate gate therefore keeps
both contracts: `prod-readonly-smoke.js` proves zero live mutations in the locked state, and
`prod-write-gateway-browser.js` proves the writable/fail-closed states against a fully intercepted
local mock. The other wired gates remain `prod-polish-gate.js`, `prod-comments-browser.js`,
`prod-structure-subset.js`, `behav-wired.js`, `prod-interaction-inventory.js`,
`prod-a11y-focus.js`, `prod-layout-polish.js`, `prod-review-packet.js`, `prod-argos-export.js`, and
`pixel-wired.js`. F105 requires the interaction/behavior/pixel contracts to declare and mock their
authority state explicitly before the aggregate can pass. The prototype originals remain historical references; they are not authority to
enable unsupported project moves, deletes, new issues/sub-issues, favorites, comment edits/deletes,
or other mutations.

The current wired suites already adapt prototype status keys (`prog`/`smm`/`kasper`/`client`) to
database slugs (`in_progress`/`smm_approval`/`kasper_approval`/`client_approval`). The frozen
originals are not a future migration recipe; preserve them unchanged and test current selectors in
the wired suites.

The probe harness, raw provider reference screenshots, and saved browser profile were deliberately
not copied. That profile historically held a provider login and must never enter this public repo
or be relaunched from these instructions. F64/D-17 still require provider-side revocation, denial
proof, and private copy/cache review. The content-minimized measurement JSON remains in
`../probe-data/` as frozen evidence.
