# Production tab foundation audit - 2026-07-09

## Goal

Make the `?prod=1` Production tab behave like a finished, polished read-only product surface.
This is not the B4/B5 writable production-management cutover. The standard for this pass is:

- every visible control either works, changes local read-only state, opens a real preview menu, or is clearly disabled/guarded;
- navigation, deep links, browser back/forward, refresh, keyboard shortcuts, hover, right-click, filters, grouping, selection, board cards, and detail panels stay coherent;
- mutating actions must not send writes and must explain the read-only boundary with `Preview - read-only`;
- no decorative Linear-copy chrome should silently lead nowhere.

## Baseline

Repo: `sidney-afk/client-analytics`
Branch for this work: `codex/prod-foundation-audit-2026-07-09`
Starting main commit: `bcdc0cfe95864a771cfff7cf92dc8c633cde0d78`
(`Merge pull request #735 from sidney-afk/agent/posted-dark-green`)

Primary source read for this pass:

- `TRACK_B_LINEAR_REPLACEMENT_SPEC.md`
- `docs/syncview-design/ADAPTER.md`
- `docs/syncview-design/WIRED-PARITY.md`
- `docs/syncview-design/tests/README.md`
- `qa/MASTER_TESTER.md`
- `.claude/skills/master-test/SKILL.md`
- `.claude/skills/human-audit/SKILL.md`
- `.claude/skills/feedback-expansion/SKILL.md`
- `_prod*` implementation in `index.html`

## Verification run

Initial gates before any fix:

| Gate | Result |
|---|---:|
| `npm test` | pass, 58/58 unit suites |
| `node docs/syncview-design/tests/prod-readonly-smoke.js` | pass |
| `node docs/syncview-design/tests/prod-structure-subset.js` | pass |
| `node docs/syncview-design/tests/behav-wired.js` | fail, 155/156 |
| `node docs/syncview-design/tests/pixel-wired.js` | not run until after fixing the behavioral failure |
| `node docs/syncview-design/tests/prod-interaction-inventory.js` | added in this pass |

Final Production gates after the fix:

| Gate | Result |
|---|---:|
| `node docs/syncview-design/tests/behav-wired.js` | pass, 156/156 guard-mode assertions |
| `node docs/syncview-design/tests/prod-interaction-inventory.js` | pass: sampled unique controls across list/detail/board/project states, right-click menus, hover tips, scroll reset, breadcrumb/body context, project toolbar display grouping/show-sub-issues behavior, pointer cursor, guarded add-sub-issue affordance, and no writes/errors |
| `node docs/syncview-design/tests/prod-structure-subset.js` | pass: structural detail coverage includes compact activity rows, title-first sub-issue rows with project metadata, child `Sub-issue of` context, leaf add-sub-issue affordance, project-detail tab removal, project toolbar order, project Display grouping, Show sub-issues, and workspace-menu cleanup |
| `node docs/syncview-design/tests/pixel-wired.js` | pass in light and dark |
| `node qa/master.js --profile=fast --no-server` with a local static server | pass/fail lanes green: unit, parity, probes, scenarios, visual capture |
| focused human/vision screenshot review | pass after mobile header and detail-crumb fixes |

The pixel suite wrote local/private screenshots to `.codex-tmp/prod-pixel-wired`; these are audit evidence only and should not be committed.
The first direct master run failed because the Windows environment has `python` but not `python3`;
rerunning with an already-started local server and `--no-server` passed. The master visual lane
still requires the normal human/vision review of its captured screenshots before claiming final
visual approval.

Focused human/vision sanity check: generated Production list, board, detail, project, palette,
selection, picker, context-menu, due-popover, filter, empty-state, light, dark, and mobile
screenshots were reviewed locally. That pass found and fixed two phone-width polish defects:
the global app header clipped/crowded the active Production tab, and the mobile detail breadcrumb
allowed `VID-10440`-style issue IDs to wrap at the hyphen. The final phone list/detail captures
show the Production tab visible, the nav scrollable, the theme control separated, and the detail
top bar kept to one line with ellipsis.

Additional interaction inventory: `prod-interaction-inventory.js` sampled unique visible controls
across list, selected list, filtered empty, detail, board, selected board, and project states. It
also checks right-click context zones, hover tooltips, real pointer clicks for row open/checkbox/status/
due/assignee/client-chip controls, browser errors, and write-like requests.

## Finding fixed

### P1: Escape inside a Production popover could also navigate the page

User-visible path:

1. Open a project detail in Production.
2. Open the project toolbar Filter or Display popover.
3. Press Escape.

Expected behavior: Escape closes the active popover and leaves the user on the project detail.

Actual behavior before this pass: the popover closed, then the same Escape event bubbled to the page-level Production key handler. Because the current view was `project`, the page handler interpreted Escape as "go back to board." The project toolbar disappeared, which made `projectToolbarMenusAndDetailsToggle` fail in `behav-wired.js`.

Fix: the Production popover Escape handler now stops propagation after closing the overlay. Overlay Escape is consumed by the overlay layer first, preserving the intended cascade:

1. close active overlay;
2. if no overlay is open, clear selection/actionbar;
3. if still no transient state is active, navigate back from detail/project.

No data, flags, backend code, n8n workflows, or Supabase objects were touched.

### P1: Detail transitions kept the old scroll position

User-visible path:

1. Open a parent issue detail.
2. Scroll down to its Sub-issues section.
3. Open a sub-issue.

Expected behavior: the newly opened sub-issue starts at the top of its detail view.

Actual behavior before this pass: the Production preview could preserve the old scroll position,
so the next issue appeared partway down the page.

Fix: opening a deliverable, batch, or project detail now resets the Production detail scroller
and brings the Production surface back to the top.

### P2: Project cards used a drag cursor in the read-only preview

Expected behavior: project cards look clickable with the normal pointer hand.

Actual behavior before this pass: the cards used the drag/grab cursor even though Production is
currently read-only.

Fix: project cards now use the pointer cursor by default; the grabbing cursor is reserved only
for an active drag state.

### P2: Sub-issue breadcrumbs lacked hierarchy labels

Expected behavior: when a user opens a sub-issue, the top breadcrumb makes the parent/current
hierarchy clear.

Actual behavior before this pass: the breadcrumb showed client, parent title, current issue ID,
and current title, but did not label which segment was the parent issue versus the sub-issue.

Fix: the detail breadcrumb now labels parent segments as `Issue` and current child segments as
`Sub-issue`; standalone issues remain labeled `Issue`.

### P2: Detail body still lacked Linear issue-page hierarchy polish

User-visible paths:

1. Open a parent issue with sub-issues.
2. Open one of its child sub-issues.
3. Compare the issue body, sub-issue section, and activity feed with Linear's issue detail.

Expected behavior: the main issue body is centered in the available detail pane, child details
show an inline `Sub-issue of` relationship near the title, parent sub-issue rows prioritize the
child title and show project metadata, add-sub-issue affordances are visible but guarded in the
read-only preview, and activity events are compact one-line rows.

Actual behavior before this pass: the detail body was left-weighted, child issue context lived
mostly in the breadcrumb/right panel, parent sub-issue rows repeated child issue IDs, the
add-sub-issue affordance was missing from the wired preview, and activity events rendered as
larger two-line blocks.

Fix: Production issue details now center the main column, child details add a body-level
`Sub-issue of` row with parent progress and project context, parent sub-issue rows are title-first
with project/due/assignee metadata, add-sub-issue controls are present and routed to the
read-only guard, and activity rows render as subtle one-line entries.

No data, flags, backend code, n8n workflows, or Supabase objects were touched.

### P1: Mobile header and detail breadcrumb looked unfinished

User-visible path:

1. Open the Production preview on a phone-width viewport.
2. Scroll the top app navigation to the Production tab.
3. Open a Production issue detail.

Expected behavior: the active Production tab is fully visible and the detail breadcrumb keeps
the current issue ID on one line while truncating less important title text.

Actual behavior before this pass: the global header still used its desktop three-column inline
grid, so the phone nav was squeezed between the logo and theme toggle. The active Production
pill was clipped/crowded, and the detail top bar allowed issue IDs such as `VID-10440` to wrap
across two lines.

Fix: the mobile header now uses a two-row layout with logo/actions on top and the tab nav in a
dedicated horizontally scrollable row. The Production detail breadcrumb now keeps the bold issue
ID/project label on one line and truncates the trailing title instead.

No data, flags, backend code, n8n workflows, or Supabase objects were touched.

### P2: Project detail toolbar kept copied controls without coherent behavior

User-visible paths:

1. Open a Production project detail.
2. Use the Open / Closed / All issues tabs.
3. Use the Display menu's `Group by` and `Show sub-issues` controls.
4. Open the sidebar workspace menu.

Expected behavior: every visible project-detail control either changes the visible issue map,
opens a useful local preview menu, or is removed. Workspace-level actions should match this
read-only Production preview, not account/admin chrome copied from Linear.

Actual behavior before this pass: the project detail exposed Open / Closed / All issues tabs
that were unclear in this app, while project Display controls did not fully regroup or hide/show
project child rows. The Project details toggle was separated from the Filter/Display toolbar,
and the workspace menu exposed irrelevant Settings, Invite members, and Log out actions.

Fix: project details now show one coherent issue list. The unclear status tabs are removed,
Project details sits as an icon control next to Filter, Display regrouping works for Status,
Client, and Assignee, and `Show sub-issues` hides/shows child issue rows in the project view.
The workspace menu now contains only preview-relevant actions: All issues, All projects, and
Copy current link.

No data, flags, backend code, n8n workflows, or Supabase objects were touched.

## Current interaction map

### Works as live read-only navigation/local UI

- Sidebar workspace/team navigation and preview-relevant workspace menu actions
- My issues, team issues, and Projects board navigation
- Client/project chips and project group headers
- Detail, batch, and project deep links
- Browser back/forward and refresh restoration
- Project detail issue grouping by Status, Client, or Assignee
- Project detail Show sub-issues toggle
- Project details side-panel toggle next to Filter
- Search button, Slash, and Cmd/Ctrl+K command palette
- Filter menu, filter value search, filter pills, remove/clear filters
- Display menu grouping/order/show-sub-issues controls
- Group collapse/expand
- Row focus, keyboard navigation, Enter open, J/K navigation
- Local row selection, range selection, select-all, and clear actionbar
- Board column collapse/expand
- Board card focus, selection, actionbar, and project open
- Detail scroll preservation and list scroll preservation
- Light and dark Production theme rendering
- Mobile list/detail smoke path

### Works as guarded read-only chrome

- Row status, assignee, due-date, and project pickers
- Detail Properties status, assignee, due-date, and project pickers
- Project status, lead, and target pickers
- Bulk row action pickers
- Bulk board-card action pickers
- Context-menu mutation entries
- Group checkbox selection
- Favorite/star controls
- Notification controls
- Composer box
- Board drag/drop attempts

All of the above must either keep adapter data unchanged or show `Preview - read-only`. Existing gates verify the zero-write invariant for browser requests.

### Intentionally disabled/unavailable in the read-only milestone

- Add deliverable / plus controls
- Project controls side-card button
- New issue creation
- Real status/assignee/due/project mutation
- Real comment creation/edit/delete
- Real project drag/drop persistence
- Real favorite persistence
- Undo stack for mutations

These are not loose ends in B2/B3 read-only preview; they are future writable-product work and remain covered as `deferred-B3` in `behav-wired.js` / `WIRED-PARITY.md`.

## Remaining risk

The existing automated gates plus the focused screenshot review are strong for the current read-only surface, but they are not a replacement for owner-side hands-on approval in the live app. Before promoting the Production tab from preview to a broadly shared working surface, run the `.claude/skills/human-audit` matrix against fresh live screenshots and manually inspect:

- menu placement and overlap at narrow widths;
- hover/focus states;
- long title wrapping;
- empty-state clarity;
- project/detail side-panel balance;
- anything that feels clickable but is not obviously live, guarded, or disabled.

## Rollback

This pass is reversible by reverting the July 9 Production hardening PR or the specific commit that contains:

- the `index.html` Escape propagation fix;
- the mobile app-header and Production detail-crumb polish rules;
- the project toolbar/display/menu cleanup;
- this audit report;
- the parity/doc ledger updates.

Because the code change is frontend-only and touches no data path, rollback does not require a Supabase flag flip, n8n change, migration rollback, or cleanup job.
