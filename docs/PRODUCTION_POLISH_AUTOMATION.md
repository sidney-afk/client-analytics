# Production Polish Automation

This repo now has a single Production polish gate:

```bash
npm run test:prod-polish
```

It runs the checks that matter for making the Production tab feel finished:

- boot skeleton routing for `?prod=1`, including a guard against the Analytics skeleton flashing;
- structural parity for the Linear-style sidebar, rows, details, migrated Markdown/resource descriptions, clean delivered-file links, menus, and project board;
- interaction inventory across click, right-click, hover, selection, Escape, keyboard, filters, display options, display-driven project counts, filtered project-board copy, fake board-header/topbar action prevention, guarded read-only controls, and dead-button prevention;
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

That writes `.codex-tmp/prod-review-packet/index.html`, `manifest.md`, `review-checklist.md`, `review-manifest.json`, plus named desktop, dark, and mobile PNGs for the core Production surfaces. The GitHub workflow uploads this folder as `production-review-packet`.
The validator checks that the gallery, Markdown manifest, review checklist, JSON manifest, PNG screenshots, required surfaces, viewport metadata, themes, routes, inspection notes, screenshot Production state, and read-only invariant are all present. It also verifies that the clean Project board/detail screenshots are unfiltered baselines while the Combined filters screenshot records active status/client filter pills and deduped visible rows. The Project board screenshot must prove empty columns stay static and that all board column headers have zero fake add/options controls. The desktop list and Project detail screenshots must record zero fake group-header add controls, and the desktop list, Project detail, and Parent detail screenshots must record zero fake topbar favorite/notification controls. The Project detail screenshot must also prove that the Video baseline contains only Video rows and that its breadcrumb/detail labels stay scoped to Video. Selected-actions screenshots must record the visible action bar, searchable command menu, and expected selected-issue command labels. Parent-detail screenshots must record visible sub-issue rows, a visible `Add sub-issues` guarded affordance, and visible activity evidence in the first desktop viewport.
The Argos preparation step validates that same packet, then exports only the desktop/dark PNGs plus companion `.argos.json` metadata files to `.codex-tmp/prod-argos-snapshots`. Set `SYNCVIEW_ARGOS_INCLUDE_MOBILE=1` only if the team decides to include mobile screenshots in Argos billing/review.

## GitHub Workflow

`.github/workflows/production-polish-gate.yml` runs this gate on pull requests that touch Production UI/test files, can be started manually from GitHub Actions, and runs on `main` at 09:17 UTC Monday through Friday after this PR merges. The workflow cancels superseded in-progress runs for the same ref so repeated pushes do not leave stale browser jobs queued.

The workflow uploads two visual artifacts:

- `production-polish-screenshots`: the side-by-side pixel/parity screenshots from `.codex-tmp/prod-pixel-wired`;
- `production-review-packet`: a compact reviewer packet with `index.html`, `manifest.md`, `review-checklist.md`, `review-manifest.json`, and named screenshots from `.codex-tmp/prod-review-packet`, validated before upload.
- `production-argos-snapshots`: the clean Argos upload folder with desktop Production PNGs and metadata, generated only after the review packet validates.

The workflow also appends the review-packet manifest and checklist to the GitHub job summary, so reviewers can see the screenshot map and inspectable items before downloading the artifact. Open `index.html` from the artifact for a browsable gallery. Use `review-manifest.json` when another automation agent needs screenshot names, routes, viewport sizes, themes, inspection notes, or the read-only invariant result without parsing Markdown.

The live SyncView app is already served from GitHub Pages (`main` at `syncview.synchrosocial.com`), so this workflow deliberately does not publish temporary review packets through Pages. The artifact gallery gives reviewers the same single-page scan without changing the production Pages source.

## Optional Argos Visual Diff

The workflow has a guarded Argos upload. It prepares `.codex-tmp/prod-argos-snapshots` and uploads it with `npm exec -- argos upload .codex-tmp/prod-argos-snapshots --build-name production-desktop` only when the repository secret `ARGOS_TOKEN` is configured; otherwise it writes a skip note to the job summary and continues. To activate PR visual diffs:

1. Create/import the `sidney-afk/client-analytics` project in Argos.
2. Add the project token as the GitHub Actions secret `ARGOS_TOKEN`.
3. Optionally set the repository Actions variable `ARGOS_PROJECT` to the Argos `account/project` slug if tokenless or multi-project auth ever needs disambiguation.
4. Run the Production polish workflow on `main` once so Argos has a reference build.

## Pull Request Checklist

`.github/pull_request_template.md` includes a Production-specific checklist. For any PR touching `?prod=1`, `_prod*`, or `docs/syncview-design/**`, keep the checklist honest: the preview should remain read-only unless a writable milestone is explicit, and visible UI changes should include `npm run test:prod-polish` plus review of the `production-review-packet` gallery artifact.

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
2. Add the narrowest check to one of:
   - `prod-layout-polish.js` for clipping, stuck focus rings, responsive layout, or floating chrome placement;
   - `prod-a11y-focus.js` for keyboard/focus/control naming;
   - `prod-boot-budget.js` for refresh/loading/skeleton problems;
   - `prod-interaction-inventory.js` or `behav-wired.js` for clicks, hovers, menus, routing, or state changes.
3. Run `npm run test:prod-polish`.
4. Run `npm run test:prod-review` when the reviewer needs fresh screenshots.
5. Run `npm run test:prod-review:validate` before using or uploading the packet.
6. Run `npm run test:prod-argos:prepare` before changing the Argos export contract.
7. Update the Production parity docs and rollback notes with what the new check protects.
