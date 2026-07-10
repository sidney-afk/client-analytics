# Production Polish Automation

This repo now has a single Production polish gate:

```bash
npm run test:prod-polish
```

It runs the checks that matter for making the Production tab feel finished:

- boot skeleton routing for `?prod=1`, including a guard against the Analytics skeleton flashing;
- structural parity for the Linear-style sidebar, rows, details, menus, and project board;
- interaction inventory across click, right-click, hover, selection, Escape, keyboard, filters, display options, and guarded read-only controls;
- accessibility/focus basics with axe-core plus custom keyboard checks;
- layout clipping checks across desktop, compact desktop, and mobile viewports;
- existing behavior and pixel parity suites.

For reviewer screenshots, run:

```bash
npm run test:prod-review
```

That writes `.codex-tmp/prod-review-packet/manifest.md` plus named desktop, dark, and mobile PNGs for the core Production surfaces. The GitHub workflow uploads this folder as `production-review-packet`.

## GitHub Workflow

`.github/workflows/production-polish-gate.yml` runs this gate on pull requests that touch Production UI/test files, and can also be started manually from GitHub Actions.

The workflow uploads two visual artifacts:

- `production-polish-screenshots`: the side-by-side pixel/parity screenshots from `.codex-tmp/prod-pixel-wired`;
- `production-review-packet`: a compact reviewer packet with `manifest.md` and named screenshots from `.codex-tmp/prod-review-packet`.

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
5. Update the Production parity docs and rollback notes with what the new check protects.
