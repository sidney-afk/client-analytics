# Production Polish Automation

The Production tab has a single polish gate:

```bash
npm run test:prod-polish
```

It runs the checks that matter for making the Production tab feel finished:

- boot skeleton routing for `?prod=1`, including a guard against the Analytics skeleton flashing;
- structural parity for the Linear-style sidebar, rows, details, migrated Markdown/resource descriptions, clean delivered-file links, menus, and project board;
- the explicit Linear-authoritative/unsigned live-read smoke, including its zero-live-mutation invariant;
- comment-read paging/race/auth behavior through a fully intercepted mock;
- the fully mocked authority-gated native-write lane: status, comment, due date, assignee, role/team gates, bounded active-TEST override, CAS, and stale-tab rejection, with no live-backend mutation;
- interaction inventory across click, right-click, hover, selection, Escape, keyboard, filters, display options, display-driven project counts, filtered project-board copy, project-card context menu pickers, fake board-header/topbar/scaffold action prevention, guarded read-only controls, and dead-button prevention;
- detail activity empty states, including a guard against unresolved placeholder bars in migrated rows;
- accessibility/focus basics with axe-core plus custom keyboard checks;
- layout clipping checks across desktop, compact desktop, and mobile viewports, including project-detail filtered-empty states;
- existing behavior and pixel parity suites.

For reviewer screenshots, run:

```bash
npm run test:prod-review
npm run test:prod-review:validate
npm run test:prod-argos:prepare
```

That writes `.codex-tmp/prod-review-packet/index.html`, `manifest.md`, `review-checklist.md`, `review-manifest.json`, plus named desktop, dark, and mobile PNGs for the core Production surfaces. These files can contain live customer-visible text. Keep them local and access-controlled; the public GitHub workflow validates them only inside its ephemeral runner and never uploads them.
The validator checks that the gallery, Markdown manifest, review checklist, JSON manifest, PNG screenshots, required surfaces, viewport metadata, themes, routes, inspection notes, screenshot Production state, and **locked-state** read-only invariant are all present. That screenshot invariant is not a claim that Production lacks native-write capability. It also verifies that the clean Project board/detail screenshots are unfiltered baselines while the Combined filters screenshot records active status/client filter pills and deduped visible rows. The Project board screenshot must prove empty columns stay static and that all board column headers have zero fake add/options controls. The desktop list and Project detail screenshots must record zero fake group-header add controls, and the desktop list, Project detail, and Parent detail screenshots must record zero fake topbar favorite/notification controls. The Project detail screenshot must also prove that the Video baseline contains only Video rows and that its breadcrumb/detail labels stay scoped to Video. Selected-actions screenshots must record the visible action bar, searchable command menu, expected selected-issue command labels, and plural multi-select copy. Parent-detail screenshots must record visible sub-issue rows, a visible `Add sub-issues` guarded affordance, and visible activity evidence in the first desktop viewport.
The Argos preparation step validates that same packet, then exports only the desktop/dark PNGs plus companion `.argos.json` metadata files to `.codex-tmp/prod-argos-snapshots`. Set `SYNCVIEW_ARGOS_INCLUDE_MOBILE=1` only if the team decides to include mobile screenshots in Argos billing/review.

## GitHub Workflow

`.github/workflows/production-polish-gate.yml` keeps the required `production-polish` PR check under five minutes by running boot, structure, the explicit locked-state live-read/zero-mutation smoke, mocked comment reads, the fully mocked write-gateway lane, accessibility/focus, and layout. The longer interaction inventory, `behav-wired`, pixel parity, review packet, validation, and Argos export run only after relevant pushes to `main`, on weekday schedule, and on manual dispatch—not on pull requests. **F105 is open:** the fast PR job passes while the post-merge interaction/heavy jobs fail because legacy guard-mode assertions still expect pickers to open before a locked write; heavy failure also skips review-packet/Argos generation. A green fast job is not aggregate readiness. A Playwright-version-keyed cache reuses Chromium and skips the apt install on cache hits. The workflow cancels superseded in-progress runs for the same ref so repeated pushes do not leave stale browser jobs queued.

The full `main`/scheduled/manual workflow does **not** upload `production-polish-screenshots`, `production-review-packet`, or `production-argos-snapshots`, and does not send the live-derived images to Argos. The packet validator still runs in the ephemeral runner. The job summary contains only fixed inspection guidance, never screenshot pixels, row payloads, descriptions, names, contacts, client identifiers, or manifest evidence copied from the live surface.

The live SyncView app is already served from GitHub Pages (`main` at `syncview.synchrosocial.com`). Neither Pages nor Actions artifacts are an acceptable distribution path for live-derived review packets.

## Visual Diff Distribution

Argos upload is disabled for the live-derived packet. Re-enable any external or public visual distribution only after every network read is intercepted with a clearly fictional fixture and a canary test proves that no live name, contact, client identifier, title, description, comment, or asset is present.

## Pull Request Checklist

`.github/pull_request_template.md` includes a Production-specific checklist. For any PR touching `?prod=1`, the `_prod*`-prefixed identifiers inside `index.html` (not a file glob), or `docs/syncview-design/**`, keep the checklist honest: the preview should remain read-only unless a writable milestone is explicit, and visible UI changes should include local `npm run test:prod-polish` plus a local, access-controlled gallery review when visual evidence is needed before merge.

## Turning Feedback Into Work

Use `.github/ISSUE_TEMPLATE/production-polish.yml` for rough feedback. The template asks for:

- where the issue happens;
- what feels wrong;
- what should happen instead;
- screenshots or recordings;
- the affected surface;
- a concrete done checklist.

For AI-agent PRs, keep the issue text natural, but include the route and screenshots. The agent instructions in `.github/copilot-instructions.md` and `AGENTS.md` tell future agents to keep Production read-only, preserve deep links, and add a regression check for each owner feedback item.

## Adding a New Polish Regression

1. Reproduce the issue in `?prod=1`.
2. Add the narrowest check to one of (all in `docs/syncview-design/tests/`):
   - `prod-layout-polish.js` for clipping, stuck focus rings, responsive layout, or floating chrome placement;
   - `prod-a11y-focus.js` for keyboard/focus/control naming;
   - `prod-boot-budget.js` for refresh/loading/skeleton problems;
   - `prod-interaction-inventory.js` or `behav-wired.js` for clicks, hovers, menus, routing, or state changes.
3. Run `npm run test:prod-polish`.
4. Run `npm run test:prod-review` when the reviewer needs fresh screenshots.
5. Run `npm run test:prod-review:validate` before using the packet locally; never upload a live-derived packet.
6. Run `npm run test:prod-argos:prepare` before changing the Argos export contract.
7. Update the Production parity docs (`docs/syncview-design/WIRED-PARITY.md`) and rollback notes (`ROLLBACK.md`, `EXECUTION_LOG.md`) with what the new check protects.
