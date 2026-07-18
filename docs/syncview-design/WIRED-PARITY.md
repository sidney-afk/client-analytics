# Wired Production Parity Ledger

Source of visual truth: `docs/syncview-design/SyncView.html`. Runtime authority and native-write
truth come from the current source, gateway contract, and an immediate `prod_authority` readback;
the static artifact cannot authorize a write. Current status values:

> **P0 PUBLIC-ACTIONS CONTAINMENT (F122; verified 2026-07-15).** The B1 and Production workflows
> were deliberately re-enabled after #836. The first B1 artifact proved success-only, one-day,
> aggregate-only JSON with exact-schema/no-array checks; Production creates no Actions artifact,
> Argos delivery, or live-derived summary. The 414 named retained bundles remain deleted.
> Reconciler public logs and any historical external Argos builds remain open; detailed logs and
> live-derived visuals stay runner-local/private.

Visible shell note: the app's top-nav label is now **Linear**, but this ledger retains
**Production** for the internal `production` module and historical design-kit terminology. The
submission form is labeled **Submit** while retaining internal key `linear`.

- ✅ ported: wired `?prod=1` matches the applicable artifact behavior.
- 🔐 authority-gated: shipped native behavior opens only when role, team, target, operation, and
  current authority allow it (or for the bounded active-TEST override).
- 🔒 unsupported/guarded: no native contract exists; the control must not send a write.
- ⬜ pending: artifact behavior still needs transplant/adaptation.

## 2026-07-13 Current Authority-Gated Write Milestone

This section supersedes unqualified “the mirror is read-only” language elsewhere in this ledger.
The dated sections below remain historical evidence: their “current,” “now,” `B2`, and
`deferred-B3` wording describes the milestone named by that section, not today's capability.

| Behavior | Current status | Contract |
|---|---:|---|
| Status, comment, due date, and assignee | 🔐 authority-gated | The browser calls only the authenticated `production-write` gateway. A verified compatible role, active/supported target, valid SyncView authority for the row's team, and operation-specific server checks are required; the bounded active-TEST override is the only pre-flip exception. |
| Linear-authoritative, missing/malformed authority, unsigned, incompatible-role, and unsupported states | 🔒 guarded | Controls stay read-only and fail closed. Current authority must be read back before any operational decision; the dated Linear/Linear state in `docs/truth/APP.md`/`ROLLBACK.md` is not a permanent guarantee. |
| Locked-state browser proof | ✅ F105 candidate green | `prod-readonly-smoke.js`, structure, interaction, behavior, and pixel coverage preserve zero live mutations and current fail-closed controls. F105 pins row-control checks to an exact non-TEST row and lets the behavior reset fall back from a legitimately empty active-team fixture only after loaded-state proof. |
| Writable-state browser proof | ✅ ported | `prod-write-gateway-browser.js` uses a fully intercepted local mock to prove mixed authority, four supported operations, CAS, verified-role attribution, TEST override, and stale-tab rejection without reaching a live backend. `test/production-write-ui-source.js` pins the source contract. |
| Project moves, deletes/undo, new issues/sub-issues, favorites, comment edit/delete, and other unimplemented mutations | 🔒 unsupported/guarded | Historical prototype controls do not create runtime authority. Keep them guarded or absent until a separately designed, server-authorized, tested, and owner-approved milestone. |

## 2026-07-09 Foundation Hardening Audit

Full report: `docs/audits/2026-07-09-production-foundation-audit.md`.

| Behavior | Source | Status | Notes |
|---|---|---:|---|
| Global nav promotion | owner direction, top-nav shell | ported | Visible order is Analytics → Linear mirror → Submit. The mirror keeps `#production` / `?prod=1`, the form keeps `#linear`, and the mirror remains read-only. |
| Global nav keyboard boundary | focused human-audit pass | ported | Production's document-level row shortcuts yield whenever any real app control is focused, so Enter on the global Submit link performs native navigation instead of opening the first mirror row. |
| Expanded desktop nav containment | master-tester vision pass at 1440px | ported | The center nav owns a bounded, scrollbar-free horizontal strip and reveals the active tab, so role-only tabs never collide with staff/account/theme controls after adding the promoted mirror. |
| Finished read-only product standard | owner direction, Track B B2/B3 boundary | ported | The Production tab is treated as finished-quality read-only chrome: each visible control must work locally, navigate, open a guarded picker/menu, or be clearly disabled. |
| Project toolbar overlay Escape cascade | `projectToolbarMenusAndDetailsToggle`, overlay key handling | ported | Fixed a real loose end where Escape inside a project Filter/Display popover also bubbled to the page-level handler and navigated from project detail back to board. |
| Phone app-header layout | human/vision review at 390px wide | ported | The global header switches to a two-row mobile layout so the active Production tab is visible in its own horizontally scrollable nav row instead of colliding with the theme toggle. |
| Phone detail breadcrumb | human/vision review at 390px wide | ported | Production detail breadcrumbs keep the issue/project label on one line and truncate the trailing title, avoiding `VID-10440`-style line breaks in the top bar. |
| Detail navigation scroll reset | owner feedback after PR #751 | ported | Opening a deliverable, batch, project, or sub-issue detail starts the new view at the top instead of inheriting the previous detail scroll position. |
| Project-card pointer affordance | owner feedback after PR #751 | ported | Read-only project cards use the pointer cursor rather than the drag/grab cursor; grabbing is reserved for active drag state only. |
| Issue/sub-issue breadcrumb labels | owner feedback after PR #751 | ported | Detail breadcrumbs label parent rows as `Issue` and child rows as `Sub-issue` so the hierarchy is legible when moving from parent to child. |
| Centered issue detail body | owner Linear screenshot feedback after PR #756 | ported | Issue and sub-issue detail bodies are centered within the detail pane instead of being left-weighted against the sidebar. |
| Body-level sub-issue relationship | owner Linear screenshot feedback after PR #756 + 2026-07-17 round | ported | Child issue details show `Sub-issue of` with parent issue, parent progress, and project context ABOVE the title (Linear places the parent breadcrumb with the title block, not below it); the artifact now carries the same `detail-context` element. |
| Parent sub-issue row polish | owner Linear screenshot feedback after PR #756 | ported | Parent issue sub-issue rows are title-first, omit the child issue ID, expose project/due/assignee metadata, and include a guarded add-sub-issue affordance. |
| Compact activity rows | owner Linear screenshot feedback after PR #756 | **historical visual port; runtime blocked by F138** | The dormant renderer styles events as subtle single-line rows, but Production never invokes the event loader/renderer. This is not live Activity parity. |
| Project detail tabs removed | owner project screenshot feedback after PR #757 | ported | The unclear project Open/Closed/All issues tabs are removed from the wired preview; stale `ptab` query params no longer silently filter project rows. |
| Project toolbar order | owner project screenshot feedback after PR #757 | ported | The Project details toggle is a right-side icon control placed immediately after Filter and before Display. |
| Project Display grouping/show sub-issues | owner project screenshot feedback after PR #757 | ported | Project detail rows now regroup by Status, Client, or Assignee, and the Display menu's Show sub-issues toggle hides/shows child rows in the project issue list. |
| Production workspace menu removed | owner project screenshot feedback after PR #757 | ported | The sidebar workspace brand is static; no workspace dropdown, account/admin rows, preview shortcuts, or copy-link action is exposed. |
| Project-card selection state | owner selection screenshot feedback on PR #763 | ported | Mouse selection/deselection no longer leaves the keyboard focus ring or a clipped blue outer border; keyboard selection keeps focus styling for navigation. |
| Project-row metadata clipping | owner project-row hover feedback on PR #763 | ported | Project issue rows let titles shrink before due/avatar/created metadata, so right-side chips stay visible on hover. |
| Searchable selected-issue Actions menu | owner action-menu feedback on PR #763 | ported | Multi-select Actions now opens a Linear-style searchable command menu with Assign to, Change status, Move to project, Copy issue ID, Change due date, and Delete issue; mutating commands stay guarded. |
| Combined filter pills and row identity | owner combined-filter screenshot feedback on PR #763 | ported | Status/client filter pills stay compact with ellipsis, and visible issue lists dedupe by issue ID before rendering. |
| Production polish gate | owner automation request after PR #764; F105 repair | **candidate green; cloud review + merge pending** | The runner selects all ten suites; only the fast lane runs automatically on pull requests. The F105 candidate based on `0cdcb43` passed the complete aggregate locally in 1014.5s, with exact non-TEST locked assertions, bounded empty-fixture recovery, fully mocked writable coverage, and unchanged zero-live-mutation audits. Require a green manual long-lane run on the exact candidate before merge. |
| Production boot/loading guard | `prod-boot-budget.js` | ported | `?prod=1` is source-checked against the Production skeleton route, opens within budget, and rejects visible/leaked Analytics skeletons during Production refresh. |
| Accessibility and keyboard-control guard | `prod-a11y-focus.js`, Production key handler | ported | Scoped axe checks pass; icon-only Filter/Display controls have accessible names; focused Production buttons keep native Enter/Space activation instead of being stolen by row keyboard shortcuts. |
| Layout clipping guard | `prod-layout-polish.js` | ported | Desktop, compact desktop, and mobile checks reject clipped row/card metadata, wrapped filter pills, stale project-card focus rings, and off-screen menus/toasts. |
| Reviewer visual packet | `prod-review-packet.js`, `prod-review-packet-validate.js` | 🚨 F122 private-only | The packet structure validator checks completeness, not privacy. Current CI does not upload the live-derived packet or copy its generated manifest/checklist into a public job summary. Generate and inspect it only in an access-controlled local workspace or ephemeral runner until fictional interception and strict archive canaries exist. |
| GitHub polish workflow and issue intake | `.github/workflows/production-polish-gate.yml`, `.github/ISSUE_TEMPLATE/production-polish.yml`, `.github/pull_request_template.md`, `AGENTS.md`, `.github/copilot-instructions.md` | ✅ F105 repaired / 🚨 F122 private-only | F105 repairs the fast/long test epoch on its candidate branch. The re-enabled workflow keeps detailed logs and review/visual output runner-local, publishes no Production artifact, and sends nothing to Argos. Manual dispatch is the pre-merge cloud-review path for the exact candidate. |
| Existing behavioral gate | `docs/syncview-design/tests/behav-wired.js` | ported | Guard-mode coverage is green at `168/168`; mutation-only behavior is covered by the fully intercepted write-gateway suite. Reset waits for a loaded non-error list and uses a real-row fallback only when the default active-team fixture is empty. |
| Finished-surface inventory gate | `docs/syncview-design/tests/prod-interaction-inventory.js` | ported | Samples unique visible controls across list/detail/board/project states, right-click context zones, hover tips, row open/checkbox/status/due/assignee/client-chip pointer controls, sub-issue body context, guarded add-sub-issue affordances, and the no-write/no-error invariant. |
| Existing visual gate | `docs/syncview-design/tests/pixel-wired.js` | 🚨 F122 private-only | Local and ephemeral-runner runs write `.codex-tmp/prod-pixel-wired` and the wired side can read live Production data. CI does not upload that directory. Keep the output untracked and access-controlled until every live request is intercepted with fictional fixtures. |
| Rollback scope | frontend-only `_prod*` hardening | ported | Revert the July 9 PR/commit to undo this pass. No Supabase data, runtime flags, n8n workflows, or backend write paths were touched. |

## 2026-07-06 Foundation Session

| Behavior | Source | Status | Notes |
|---|---|---:|---|
| B1 rows adapt to artifact `ISSUES` / `PROJECTS` / `CLIENTS` / `EDITORS` shapes | `ISSUES`, `PROJECTS`, `CLIENTS`, `EDITORS` seeds | ✅ | `_prodAdapter()` is the single render boundary; see `ADAPTER.md`. |
| Batch parent owns children; siblings do not list each other | `childrenOf`, `subProg`, `rowHTML`, `renderDetail` | ✅ | Batch-parent issue is `deliverable.title == batch.name` after trim/case-insensitive normalization. |
| Missing project emoji falls back to project glyph | `I.project`, project card markup | ✅ | No `S` fallback remains in project/card/detail client glyphs. |
| Status glyph vocabulary | `statusSVG` | ✅ | Existing glyph family preserved; adapter feeds artifact status keys (`prog`, `smm`, `kasper`, `client`). |
| Canceled issues stay visible (Canceled group in project + All views) | `STATUS.canceled`, `groupsFor` | ✅ | `_prodDeliverableLive()` no longer treats `canceledAt` as deleted; archive/delete markers still hide rows (owner feedback 2026-07-17). |
| Written date format on all date pills (compact "Jul 15"; year accuracy in the hover) | `fmtDue`, seed date strings | ✅ | `_prodFmtDate` renders the compact written form for due/created/updated/target; `_prodFmtDateFull` adds ", YYYY" for non-current years in every date tooltip; raw ISO fields still drive ordering and overdue math (owner feedback 2026-07-17, compact ruling 2026-07-18). |
| Active tab hides approved items | `curIssues` active set | ✅ | `_prodTabAllows` active list matches the artifact (`todo/prog/smm/kasper/client/tweak/scheduled`); approved rows live on the All tab (owner decision 2026-07-18, staff-visible change). |
| Informational tips survive the write gate (status name, due + overdue-by-N-days, assignee, created) | `rowHTML`/`renderDetail` `data-tip` strings, `overdueText` | ✅ | `_prodWriteGateAttrs` composes `info|action-or-gate` instead of replacing the tip; artifact gained `overdueDays`/`overdueText` and all four due-tip sites use them (owner feedback 2026-07-17). |
| Time-in-status hover (rows: current-status age; detail: per-status breakdown) | `statusAge`/`statusHistory` seed strings in `rowHTML`/`renderDetail` tips | ✅ | Wired derives the same text live: `statusAtRaw` powers row status hovers, and the detail Properties status hover reads lazy-loaded `deliverable_events` (first runtime consumer of `_prodLoadEventsFor`; the F138 activity feed itself stays dormant). |
| Context menu shell | `CTX`, `openContextMenu`, `layerPop` | ✅ | Row/detail/batch/project context menus open; Copy link remains active. |
| Context menu mutation entries | `openSub`, `stdMenu`, picker wiring | 🔒 | Status/Assignee/Due/Project submenus render current values; clicking values routes to `Preview - read-only`. |
| Detail Properties pickers | `renderDetail` side-card rows | 🔒 | Status, assignee, due, and project rows open the same guarded picker layer. |
| Due-date popover and calendar | `buildDue`, `openDueMenu` | 🔒 | Calendar renders, current value can be highlighted, date selection is guarded. |
| Row status icon click | `rowHTML` `data-st` | 🔒 | Stops row navigation and opens guarded status picker. |
| Body-mounted overlay environment | `#layer`, tooltip, `#toast` | ✅ | `--prod-*` variables resolve on body overlays; global host tooltip opts out of Production. |
| Side-by-side visual capture | §10.8.6 screenshot pass | ✅ | `scripts/prod-parity-screenshots.js` saves artifact/wired pairs locally for reviewer inspection. |
| Bulk selection, drag/drop, delete/undo, comments, new issue/add sub-issue | `behav.js` mutation assertions | 🔒 | Deferred until B3 write authority. |

## 2026-07-06 Converge Session 2

| Behavior | Source | Status | Notes |
|---|---|---:|---|
| Mechanical port-fidelity checker | §10.8.3 | ✅ | `test/port-fidelity-check.js` maps 17 artifact/wired function pairs and requires `PORT-DELTA` on intentional divergences. |
| Wired behavior baseline | §10.8.6, `behav.js` | ✅ | `docs/syncview-design/tests/behav-wired.js` baseline: `26/138 (guard mode)`. |
| Group headers collapse with chevron and hover state | `renderList`, `.grp-hd` | ✅ | Header click collapses/expands local rows; group checkbox visual is present and guarded. |
| Live filters | `openFilterMenu`, `openFilterSub`, `buildFilterValues`, `pillsHTML` | ✅ | Status, assignee, and client filters are live local reads; value pickers are searchable; remove and clear filters work. |
| Display options / group-by | `openGroupMenu`, `groupsFor` | ✅ | Status, assignee, and client/project grouping are live local reads. |
| Board column collapse | `renderProjects`, `data-pcolcollapse` | ✅ | Columns collapse to artifact-style vertical rails; no board writes are enabled. |
| Command palette search | `openSearch` | ✅ | Sidebar Search and Ctrl/Cmd+K open a read-only navigation palette for issues, clients, assignees, and view switches. |
| Keyboard list navigation | `document.keydown`, `flatOrder` | ✅ | Up/Down/J/K focus rows, Enter opens, Escape clears/goes back; S/A/Shift+D/Shift+P open guarded pickers. |
| Contextual empty states | `renderList` empty-state branch | ✅ | Empty tab/filter states show an icon and Clear filters when a filter caused the empty result. |
| Cosmetic context-menu fidelity | `CTX` | ✅ | Due/Project hints use `⇧D`/`⇧P`, Delete uses `Ctrl ⌫`, and Assignee/Set lead use the person icon. |
| Full 138-assertion wired behavior coverage | `behav.js` | ⬜ | Current guard-mode baseline is 26 assertions; future PRs should only raise this number. |

This ledger supersedes `docs/audits/2026-07-06-prod-parity-gaps.md` for ongoing B2 parity tracking.

## 2026-07-06 Parity Coverage Round

| Behavior | Source | Status | Notes |
|---|---|---:|---|
| Wired behavior baseline | `behav.js` | ported | `docs/syncview-design/tests/behav-wired.js` baseline raised to `55/138 (guard mode)`. |
| Artifact-order batch `chip` -> `kfocusShortcut` | `behav.js` assertions 1-32 | ported | New wired assertions cover client-chip navigation, row due/status/assignee pickers, sub-issue controls, palette/search, team project board, guarded favorite, tabs, My issues, keyboard picker shortcuts, Ctrl+A multi-select, guarded bulk delete, picker number/arrow navigation, guarded composer, selected-state persistence, multi-copy links, assignee palette navigation, and j/k focus/open shortcuts. |
| Row client chip navigation | `rowHTML` `data-crumbclient` | ported | `.prod-chip-client[data-prod-crumbclient]` opens the client/project view without opening the row. |
| Row/detail assignee affordances | `rowHTML`, `renderDetail` `[data-assign]` | ported | Row and sub-issue avatars open the artifact-style assignee picker; selections route to `Preview - read-only`. |
| Sub-issue guard-mode controls | `renderDetail` subrow status/due/assign controls | ported | Subrows expose status, due, and assignee controls; picker choices toast and leave adapter rows unchanged. |
| Project card status/lead/target pickers | `renderProjects`, `openPPick` | ported | Board cards expose guarded status, lead, and target pickers with current values ticked. |
| Read-only multi-select visuals | `flatOrder`, keyboard shortcuts, actionbar | ported | Ctrl+A selects visible rows, shows a count/action bar, and bulk actions open guarded pickers. |
| Guarded favorite/composer affordances | `renderList`, `renderDetail` | ported | Favorite and composer controls keep `Preview - read-only` title/tooltip and now give the same guard toast on click. |
| Project detail side panel | `renderPDetail` / `S.projectOpen` | ported | Ported in Round 4: board cards now open read-only project detail with guarded properties. |
| Static Production workspace brand | owner feedback over `renderSidebar` `data-brandmenu` | ported | The wired Production preview intentionally removes the artifact workspace menu and keeps only a static SyncView brand plus Preview chip. |
| Comment edit/delete/send mutations | `renderDetail`, comment handlers | deferred-B3 | B2 composer and comment mutation surfaces are guarded; full activity mutation behavior waits for write authority. |

## 2026-07-06 Parity Coverage Round 2

| Behavior | Source | Status | Notes |
|---|---|---:|---|
| Wired behavior baseline | `behav.js` | ported | `docs/syncview-design/tests/behav-wired.js` baseline raised to `75/138 (guard mode)`. |
| Artifact-order batch `commentEdit` -> `calArrowNav` | `behav.js` assertions 33-64 | ported/deferred | Read-only-safe rows were adapted in order; write-path-only rows are explicitly deferred below. |
| Indeterminate/full group check visuals | `groupPartial` | ported | Direct selection state shows `.partial` for mixed groups and `.on` for fully selected groups without enabling bulk writes. |
| Empty project-board columns | `emptyColumn` | ported | Live-data-tolerant assertion uses a local no-match read filter to prove empty column chrome renders. |
| Markdown/link renderer | `linkify` | ported | `_prodLinkify()` mirrors artifact markdown/code/link handling for read-only descriptions. |
| Plain context-menu keyboard navigation | `menuNav`, `menuNavEnter`, `submenuEscape` | ported | Arrow keys move `.sel`; Enter opens the selected submenu; Escape from a submenu closes only the submenu. |
| Project picker keyboard navigation | `ppickNav`, `tabTrap` | ported | Project-card pickers support Arrow navigation and Tab trapping in the artifact layer. |
| One-click picker switch | `pickerSwitch` | ported | Body overlay click shim re-dispatches clicks to underlying Production picker triggers, allowing status/assignee/due/project picker switching without writes. |
| Client/project group header navigation | `groupProjectNav` | ported | Client-group titles become `.navp[data-prod-project]` and open the client/project view without toggling collapse. |
| Selected-row priority for guarded keyboard shortcuts | `kbSelPriority` | ported | `S/A/Shift+D/Shift+P` target the current multi-selection before hover/focus rows, while still routing choices to the read-only guard. |
| Project card lead/target/count/menu | `cardLead`, `cardTarget`, `cardCount`, `cardMenu` | ported | Lead/target pickers open guarded; counts come from adapter rows; card context mutation items toast read-only. |
| Empty sub-issues section | `subLeafNoHeader` | ported | Wired B2 keeps the owner-approved empty-section suppression; the artifact inline add-sub composer remains deferred with writes. |
| Due calendar keyboard focus | `calArrowNav` | ported | Arrow keys move the focused date and Enter routes to the read-only guard without changing rows. |
| Comment edit/cancel/delete, board drag, delete count, drafts, move, add sub-issue, edited marker, composer textarea, favorites | `commentEdit`, `commentEditCancel`, `commentDelete`, `boardDrag`, `delCount`, `draftPersist`, `moveNoop`, `addSubKeepOpen`, `editedMarker`, `composerTextarea`, `favSection`, `favView` | deferred-B3 | These assertions require comment/issue/project/favorite mutations or writable composer state. B2 keeps the chrome guarded with `Preview - read-only`; B3 flips them to real behavior when write authority exists. |

## 2026-07-06 Parity Coverage Round 3

| Behavior | Source | Status | Notes |
|---|---|---:|---|
| Wired behavior baseline | `behav.js` | ported | `docs/syncview-design/tests/behav-wired.js` baseline raised to `94/138 (guard mode)`. |
| Artifact-order batch `calEscape` -> `filterArrowRight` | `behav.js` assertions 65-90 | ported/deferred | Read-only-safe rows were adapted in order; mutation-only rows are explicitly deferred below. |
| Due calendar escape and focus sync | `calEscape`, `dueFocusSync` | ported | Escape closes only the due popover while detail stays open; due inputs receive the artifact focus pass. |
| Filter submenu keyboard behavior | `filterSubEscape`, `filterValKeyNav`, `filterArrowRight` | ported | Filter submenus keep parent menus open on Escape; Arrow keys/Enter apply local read filters; ArrowRight opens the selected field submenu. |
| Read-only group checkbox hit | `groupCheckHit` | ported | Group checkbox clicks keep collapse state unchanged and route to the read-only guard. |
| Palette command clears selection | `paletteCmdClearSel` | ported | Command palette navigation clears selected rows while switching views, with live-data-tolerant command lookup. |
| Parent navigation | `goParent` | ported | Child detail parent side-card opens the parent issue without creating selection side effects. |
| Static Production workspace brand | `brandStatic` | ported | Owner feedback removed the brand caret/menu; the wired preview keeps the SyncView brand and Preview chip without opening workspace actions. |
| Keyboard focus beats hover | `kbFocusOverHover` | ported | `_prodState.hoverRow` is separate from keyboard `focusRow`, so shortcuts stay on the focused row. |
| Clear filters and markdown underscore handling | `clearFilters`, `underscoreMd` | ported | Empty-state Clear filters works; `_prodLinkify()` handles `_italic_`/`__bold__` without styling filename underscores. |
| Project card right-click and subrow click safety | `pcardRightClick`, `subRowNoSelect` | ported | Project card context opens without navigation; shifted subrow clicks do not create list selections. |
| List scroll preservation | `scrollPreserve`, `scrollBackNav` | ported | `_prodRender()` preserves list scroll across read-only rerenders and detail/back navigation. |
| Row `x` selection guard | `ctrlXGuard` | ported | `Ctrl+X` is inert; plain `x` toggles local selection chrome only. |
| Composer read-only click | `composerBoxClick` | ported | Composer click shows the `Preview - read-only` guard toast. |
| Selection reconcile after mutation, favorites, delete priority/focus, comment blur discard, add-sub due | `selReconcile`, `fFavorite`, `delSelPriority`, `commentEditBlurDiscards`, `fFromList`, `subDueEmptyNew`, `focusAfterDelete` | deferred-B3 | These require status/delete/comment/add-sub/favorite mutations. B2 preserves guarded chrome only. |

## 2026-07-06 Parity Coverage Round 4

| Behavior | Source | Status | Notes |
|---|---|---:|---|
| Wired behavior baseline | `behav.js` | ported | `docs/syncview-design/tests/behav-wired.js` now covers every artifact assertion name: `138/138 (guard mode)`. |
| Artifact-order batch `multiDueNoDate` -> `filterSubNoResults` | `behav.js` assertions 91-138 | ported/deferred | Read-only-safe rows were adapted in order; write-path-only rows remain explicitly deferred below. |
| Project detail side panel | `renderProjectDetail`, `S.projectOpen`, `data-pstatus`, `data-plead`, `data-ptarget` | ported | Board card plain click now opens a read-only project detail with Status, Lead, and Target rows wired to guarded project pickers. |
| Board card keyboard navigation | `boardCols`, `boardFlat`, `moveCardFocus`, `kbCardShortcut` | ported | J/K/arrow focus cards, Enter opens project detail, and S opens guarded project status picker without writes. |
| Board card multi-select visuals | `toggleCardSel`, project actionbar | ported | Ctrl/Cmd click, Shift range, checkbox, Escape/nav clear, `x`, and card bulk status chrome are local read-only state. |
| Row range selection and title tooltips | `toggleSel`, `rowHTML` title attributes | ported | Ctrl/Cmd row title toggles, Shift range selection, Shift+Arrow ranges, and long row/card/crumb titles get artifact `title` behavior. |
| Filter and picker no-results states | `openFilterSub`, picker search | ported | Filter submenus and status pickers render `No results` on empty searches. |
| Detail scroll preservation | `renderDetail` | ported | Issue detail scroll position survives read-only re-renders and child/parent navigation. |
| Static Production workspace brand | `renderSidebar` `data-brandmenu` | ported | Current wired preview removes the workspace menu entirely and retains the Preview chip; account/admin and preview shortcut rows are intentionally omitted after owner feedback. |
| Comment/issue/project write mutations | `commentEdit`, `commentEditCancel`, `commentDelete`, `delCount`, `delUndo`, `delUndoOrder`, `ctrlZUndo`, `nowLabel`, `activityLogged`, `childActivityLogged`, `boardDrag`, `moveNoop`, `addSubKeepOpen`, `draftPersist`, `editedMarker`, `composerTextarea`, favorites | deferred-B3 | These assertions require mutating comments, issues, projects, favorites, drafts, or the undo stack. B2 keeps the matching chrome guarded with `Preview - read-only`. |

## 2026-07-06 Pixel-Parity Foundation

Phase 0 side-by-side use pass ranked findings:

1. P1: toolbar chrome still exposed non-artifact "New issue" and "Refresh" controls in the wired topbar. The artifact has neither; the Preview chip remains the only whitelisted extra.
2. P1: `_prodIcon()` was a hand-drawn switch, so icon paths drifted from the artifact `I` object (notably Filter/Display).
3. P1: bulk action-bar pickers opened too low because the wired code anchored to the clicked button and measured before picker content finalized.
4. P1: Escape closed overlays but did not clear the active multi-select/action bar in the embedded tab cascade.
5. P2: selected checkbox checkmarks were not grid-centered like the artifact.
6. P2: filter pills looked interactive but kept text-cursor/inert affordances around the value and remove control.
7. P2: the bulk action bar used SyncView text-button geometry instead of the artifact floating pill.
8. P2: soft-border/shadow token mismatches were visible on filter pills and the action bar.

| Behavior | Source | Status | Notes |
|---|---|---:|---|
| Artifact icon object as single source | `I` object | ported | `_prodIcon()` now delegates to `PROD_ICON`, a checker-enforced copy of the artifact object; `assign` remains a compatibility alias for `assignI`. |
| Mechanical icon-object fidelity | `test/port-fidelity-check.js` | ported | Checker now maps `I` -> `PROD_ICON` in addition to the 17 render/function pairs. |
| Non-artifact topbar chrome removed | `renderList` / topbar artifact | ported | "New issue" and manual "Refresh" are gone from the wired topbar; background GET-only refresh runs on focus/visibility. |
| Selection action bar geometry and controls | `renderActionBar`, `.actionbar` | ported | Wired bar now uses the artifact count + icon quick-actions + Actions + clear structure. Mutations still route to guarded/read-only pickers or context menu. |
| Bulk picker placement | owner Phase A finding, `layerPop` clamping | ported | Wired action-bar pickers anchor above the bar and remain on-screen. PORT-DELTA: the standalone artifact overlaps the bar in this scripted state; owner finding requires the safer embedded placement. |
| Filter pill affordance | `pillsHTML`, `.fpill` | ported | Cursor, remove button, click-to-edit, and local read-only remove behavior are covered by `pixel-wired.js`. |
| Embedded Escape cascade | owner Phase A finding | ported | In `?prod=1`: close overlay first, then clear multi-select/action bar, then navigate back. |

## 2026-07-06 Human-Audit Parity Loop, Cycle 1

Human-audit matrix pass (same viewport, artifact vs wired, screenshots local/private):

| Surface x action | Status | Notes / screenshot pairs |
|---|---:|---|
| List / toolbar visual inventory | checked | Reused `artifact-list.png` / `wired-list.png`; no new divergence beyond prior #704 fixes. |
| Selection actionbar / quick actions | checked | `artifact-crop-selection-actionbar.png` / `wired-crop-selection-actionbar.png`; matched after #704. |
| Status picker from actionbar | fixed | `artifact-crop-status-picker.png` / `wired-crop-status-picker.png`; fixed status order, visible `.kbd` hints, selected tick color/order/display. |
| Row context menu | fixed | `artifact-crop-row-context-menu.png` / `wired-crop-row-context-menu.png`; fixed disabled Move row to keep the artifact chevron while staying read-only. |
| Context menu Status submenu | fixed | `artifact-crop-context-status-submenu.png` / `wired-crop-context-status-submenu.png`; inherits status order, `.kbd`, and tick fixes. |
| Filter pill / remove control | fixed | `artifact-crop-filter-pill.png` / `wired-crop-filter-pill.png`; fixed status field glyph and remove glyph to match the artifact. |
| Board overview | checked | `artifact-board.png` / `wired-board.png`; no new cycle-1 divergence. |
| Detail overview | checked | `artifact-detail.png` / `wired-detail.png`; no new cycle-1 divergence. |

Ranked findings fixed in this cycle:

1. P1: status picker order drifted from the artifact (`triage` first in wired, last in artifact).
2. P1: status picker rows had guarded number-key behavior but no visible `.kbd` hints.
3. P1: filter pill status field used the generic Issues icon instead of the artifact `statusField` glyph.
4. P1: row context menu disabled Move row dropped the artifact submenu chevron.
5. P2: selected picker tick rendered after the `.kbd` hint and used accent coloring; artifact tick is before the hint and uses text color.
6. P2: filter pill remove mark used the wrong close glyph.

Pixel lane additions: `pixel-wired.js` now performs a two-way row inventory for the status picker and row context/status-submenu surfaces, checking labels, shortcuts, cursor where applicable, and SVG path data. Remaining full-matrix surfaces for later cycles: due popover, palette, empty states, browser back/forward/refresh restoration, and scroll/drag visual affordances.
| Pixel wired lane | §10.8.6 visual verification | ported | `docs/syncview-design/tests/pixel-wired.js` drives artifact + wired pages through list, selection/actionbar, picker, filter pill, board, and detail states. Screenshots: `.codex-tmp/prod-pixel-wired/artifact-list.png`, `wired-list.png`, `artifact-selection-actionbar.png`, `wired-selection-actionbar.png`, `artifact-actionbar-status-picker.png`, `wired-actionbar-status-picker.png`, `artifact-filter-pill.png`, `wired-filter-pill.png`, `wired-filter-pill-editor.png`, `artifact-board.png`, `wired-board.png`, `artifact-detail.png`, `wired-detail.png`. |

## 2026-07-06 Human-Audit Parity Loop, Cycle 2

Human-audit matrix pass (continued from Cycle 1; screenshots local/private):

| Surface x action | Status | Notes / screenshot pairs |
|---|---:|---|
| Due quick popover | fixed | `artifact-crop-due-popover.png` / `wired-crop-due-popover.png`; fixed the wired preview to use the artifact's fixed `TODAY` date, matching quick-row date hints and placeholder text. |
| Due custom calendar | fixed | `artifact-crop-due-calendar.png` / `wired-crop-due-calendar.png`; calendar month and today marker now match the artifact in the scripted blank-due state. |
| Command palette default open | fixed | `artifact-crop-palette-default.png` / `wired-crop-palette-default.png`; default results now follow the artifact shape: six top-level issues plus six command rows. |
| Command palette search | fixed | `artifact-crop-palette-search-command.png` / `wired-crop-palette-search-command.png`; search caps to the artifact's twelve-row result limit and command labels/icons match the artifact. |
| Command palette empty state | checked | Covered by `pixel-wired.js`; empty text matches the artifact. |

Ranked findings fixed in this cycle:

1. P1: due quick-popover date hints came from the live clock instead of the artifact's frozen preview date.
2. P1: due quick-popover placeholder and Custom row used ASCII ellipses instead of the artifact glyph.
3. P1: command palette default results showed the whole live search corpus instead of the artifact's six root issues plus command rows.
4. P1: command palette command labels drifted from the artifact `Go to ...` copy and omitted `Go to All projects`.
5. P1: project command rows used project icons; the artifact uses the same command glyph for every command row.

Pixel lane additions: `pixel-wired.js` now checks due-popover quick rows, custom calendar month/today state, command-palette default inventory, command search, and palette empty state. Remaining full-matrix surfaces for later cycles: contextual empty states beyond the palette, browser back/forward/refresh restoration, and scroll/drag visual affordances.

## 2026-07-06 Human-Audit Parity Loop, Cycle 3

Human-audit matrix pass (contextual empty-state surface; screenshots local/private):

| Surface x action | Status | Notes / screenshot pairs |
|---|---:|---|
| Filtered list empty state | fixed | `artifact-crop-empty-filtered-list.png` / `wired-crop-empty-filtered-list.png`; added a pixel lane for icon/message/Clear filters behavior and fixed the wired pane width so the empty state fills the Production content area like the artifact. |

Ranked findings fixed in this cycle:

1. P2: the wired filtered-list empty state was content-width in the flex pane; the artifact empty state fills the available list pane. Wired now uses `width: 100%` without stretching vertically beyond the artifact layout contract.

Pixel lane additions: `pixel-wired.js` now covers filtered-list empty state inventory, Clear filters behavior, and local pane-fill geometry. Remaining full-matrix surfaces for later cycles: browser back/forward/refresh restoration and scroll/drag visual affordances.

## 2026-07-06 Human-Audit Parity Loop, Cycle 4

Human-audit matrix pass (browser history and refresh restoration; screenshots local/private):

| Surface x action | Status | Notes / screenshot pairs |
|---|---:|---|
| Detail open -> Back -> Forward | fixed | `artifact-history-detail.png` / `wired-history-detail.png`, `artifact-history-back-list.png` / `wired-history-back-list.png`, `artifact-history-forward-detail.png` / `wired-history-forward-detail.png`; Back now restores the list view and Forward restores the opened detail. |
| Wired detail refresh | fixed | `wired-history-refresh-detail.png`; a `?prod=1&d=<id>` detail deep link restores the same detail after reload. |

Ranked findings fixed in this cycle:

1. P1: Production URL restoration did not clear stale detail state when browser Back removed `d=`, leaving `view='detail'` with no open row. `_prodPrimeFromUrl()` now clears stale detail/batch/project/client IDs and defaults back to list when the URL has no detail/batch/project view.

Pixel lane additions: `pixel-wired.js` now covers browser Back/Forward restoration for list/detail and wired detail deep-link refresh. Remaining full-matrix surface for later cycles: scroll/drag visual affordances.

## 2026-07-06 Human-Audit Parity Loop, Cycle 5

Human-audit matrix pass (board scroll and drag visual affordances; screenshots local/private):

| Surface x action | Status | Notes / screenshot pairs |
|---|---:|---|
| Projects board scroll axis | fixed | `artifact-board.png` / `wired-board.png`; wired board now matches the artifact horizontal board scroller with vertical scrolling owned by each card column. |
| Project card drag start / dragover | fixed | `artifact-crop-board-drop-target.png` / `wired-crop-board-drop-target.png`; wired cards now expose the artifact grab cursor, dragging opacity state, and target-column highlight. |
| Project card drop attempt | fixed | The wired drop path stays B2 read-only: it shows `Preview - read-only`, clears drag chrome, and does not change the client/project status. |

Ranked findings fixed in this cycle:

1. P2: Production project cards had a normal pointer cursor and no drag-start/drop-target visual state, while the artifact presents board cards as draggable project cards. Wired now ports the artifact drag chrome but routes the drop through the read-only guard.
2. P2: The wired board allowed generic overflow on both axes; it now matches the artifact board axis split (`overflow-x:auto`, `overflow-y:hidden`) while columns own their vertical card scrolling.

Pixel lane additions: `pixel-wired.js` now covers board scroll-axis parity, card drag cursor, drag-start/drop-highlight chrome, and read-only guarded drop cleanup. Full hand+eyes matrix pass complete for the currently known surfaces; no remaining unreviewed surface category is listed.

## 2026-07-07 Live-Linear Parity Triage

Scope correction after PR #710 review: SyncView remains a simpler tool than Linear. Live Linear wins for look/feel on kept SyncView surfaces, but feature classes removed from the SyncView skeleton stay removed.

Kept and re-proved in this triage branch:

1. Compact project board cards: prototype and wired cards omit description rows; `pixel-wired.js` rejects `.pcard-desc` / `.prod-card-desc` render output.
2. Transparent board column-collapse chevrons: wired chevrons now match the prototype hidden-until-hover / transparent button treatment; `pixel-wired.js` checks the collapse control style.
3. Search workspace tooltip and slash shortcut: prototype and wired search buttons use `Search workspace|/`; behavior suites cover `/`.
4. Dark-shell neutral palette and overdue due-pill treatment: prototype and wired CSS variables now share the dark neutral palette; overdue color is applied to the calendar glyph.
5. Row hover band and checkbox reveal remain covered by the pixel lane.
6. Due placeholder copy uses `Try: 24h, 7 days, Feb 9` in both prototype and wired.
7. Actionbar compaction: issue multi-select exposes count, Actions, and clear only. Direct bulk Status/Assignee/Due quick buttons and Ask Linear are not part of SyncView.

Dropped as deliberate removals, not parity gaps: Ask Linear dock/rows/buttons, Initiative properties, What's new, Copy git branch name, Copy as prompt, and Switch workspace chrome.

## 2026-07-07 Production Theme-Follow Ratification

Owner decision: the Production preview follows SyncView's existing staff light/dark toggle. Light is the default, matching the rest of the app; dark applies only when `syncview_theme=dark` is active. The locked prototype is now dual-theme too: its pre-#711 light palette is restored as the default and the live-Linear dark palette is scoped under `html[data-theme="dark"]`.

Implementation notes:

1. `--prod-*` variables resolve on all five Production mounts (`.prod-view`, `.prod-layer`, `.prod-tip`, `.prod-toast`, `.prod-cmd-bd`) in both themes so body-mounted overlays do not lose their palette.
2. Light keeps the artifact's distinct hover-family tokens (`--prod-hover`, `--prod-selected-nav`, `--prod-menu-hover`); dark intentionally collapses them to the same neutral value.
3. Popovers, command palette, actionbar, and tooltip now share `--prod-shadow-pop`; toast shadow remains the known wired deviation.
4. Danger text uses the artifact red scale (`--prod-danger`) instead of the old amber fallback.

## 2026-07-07 Editor-Feedback Display Controls

Owner-ratified B2 read-only additions, first added to the locked artifact and then ported into the wired Production tab:

1. Display menu includes `Show sub-issues`, default on. Turning it off hides only sub-issues whose parent is also in the current view; orphaned sub-issues remain visible so in-flight work does not disappear.
2. Display menu includes `Ordering` with Due date, Updated, and Created. The default remains the existing status -> due-date -> label ordering; Created/Updated use the same status grouping with newest rows first inside each status.
3. Group-by, ordering, and sub-issue visibility persist in the wired tab through localStorage and URL/history state. This is a wired-only `PORT-DELTA`; the artifact keeps display state in memory.
4. Command-palette issue search now also matches issue briefs/descriptions. The wired predicate uses migrated B1 brief text, marked as a `PORT-DELTA`.
5. Client group headers and row client chips route through the project page path, matching the artifact and showing top-level parent issues first instead of a flat client-filtered list.

Owner-accepted wired-exceeds-artifact divergences:

1. The wired Projects board filter is live and local while the artifact board filter remains a toast stub.
2. The wired tab keeps filters across sidebar navigation while the artifact clears them.

## 2026-07-09 Owner Feedback Follow-Up

Owner-feedback refinements applied on top of the read-only wired tab:

1. `?prod=1` now maps to a Production-specific pre-paint skeleton instead of briefly showing the Analytics loading surface on refresh.
2. The Production workspace menu is removed entirely; `.prod-brand` is static and `brandNoMenu`/structure tests reject `data-prod-brandmenu`.
3. Project-detail grouped issue hover bands now align with group headers, and the Display menu remains responsible for real Status/Client/Assignee regrouping plus Show sub-issues.
4. `_prodRender()` clears stale tooltips before navigation draws the next view, covering the parent-link `Open parent` tooltip.
5. Sub-issue breadcrumbs label `Sub-issue` but omit the child issue ID; the title remains visible after the label.
6. Production-scoped `contextmenu` handling suppresses the browser menu for inert areas such as group headers while preserving app context menus for rows/cards/detail surfaces.
7. Project-card mouse selection/deselection clears transient focus state, so selected cards no longer show clipped outer rings and deselected cards do not keep blue borders.
8. Project issue-row metadata chips are fixed-width/shrink-safe on hover, so due dates, assignees, and created dates remain visible.
9. Selected issue Actions opens a searchable command menu with only the useful commands; `Copy issue ID` is active, while mutating commands continue to use guarded read-only pickers.
10. Combined filter pills are constrained with ellipsis and visible issue rows are deduped by ID before rendering.
11. A single `npm run test:prod-polish` gate now packages boot/loading, structure, interaction, accessibility/focus, layout clipping, behavior, and pixel checks for Production PRs.
12. The gate found and fixed a keyboard accessibility gap: focused Production buttons now keep native Enter/Space behavior, and Filter/Display icon buttons have accessible names.
13. GitHub Actions, an issue template, `AGENTS.md`, and Copilot instructions now make future Production polish feedback easier to hand to an AI agent without losing the read-only/no-write boundary.
14. `npm run test:prod-review` generates a compact local screenshot packet, browsable gallery, Markdown manifest, review checklist, and machine-readable JSON manifest for access-controlled reviewer/agent inspection; `npm run test:prod-review:validate` proves packet shape only. Public Actions and Argos distribution are disabled because live-derived pixels and evidence fields can contain customer-visible text.
15. The repo PR template now includes a Production checklist for read-only boundaries, interaction polish, `npm run test:prod-polish`, review-packet inspection, and docs/rollback updates.
16. **F122 artifact sublane contained; the finding remains open:** keeping packets out of Pages did
    not keep them private. Public Actions visual/review/Argos uploads are removed in candidate source,
    all 414 named retained bundles were deleted, and both unsafe producers are disabled pending merge
    plus post-merge proof. Packet validation still proves shape, not data minimization; reconciler
    logs and historical external Argos builds remain open.
17. The Production polish workflow retains its weekday schedule and per-ref concurrency cancellation,
    but is currently disabled. Re-enable it only after the no-public-output source merges and verify
    the first run creates no visual artifact or Argos delivery.
18. Project detail no longer reads as truly empty when filters hide its issues: the issue header shows visible vs total count (`0 of N`), the inline empty state names the active filter cause, and `Clear filters` restores the rows.
19. Issue detail descriptions render common migrated Linear Markdown instead of raw authoring syntax: headings, horizontal rules, bullets, bold labels, code spans, and resource links are formatted while malformed imported resource-link markers are normalized.
20. Filtered project boards label project-card counts as matching issue(s), hide empty columns when matching projects exist, and reserve `No matching projects` for true no-match filtered boards, so board copy reflects active issue filters instead of reading as total project size.
21. **Historical visual-port claim; runtime blocked by F138.** The artifact styling has an activity empty state, but the wired SPA never invokes its native event loader/renderer. Do not claim real Activity rows or empty-state behavior until a protected reader is wired and proved.
22. Delivered-file links on issue detail pages keep the original migrated URL as the destination, but the visible body text is a concise resource label such as `Open folder` instead of a raw Drive/Dropbox/Frame URL.
23. The Projects board `All projects` marker is a static active-scope label, not a button with no action, so every visible button still works, opens guarded chrome, navigates, or is clearly disabled.

## 2026-07-10 Desktop Project-Detail Row Polish

1. Project-detail issue rows now render parent issue context as a secondary line under the primary issue title instead of squeezing both into one row. `prod-layout-polish.js` guards that parent trails stay inside the row and remain visually subordinate to the title.
2. Projects board columns now balance empty and non-empty statuses: columns with project cards get readable card width, while empty status columns remain visible but narrower. The Production review packet now records per-screenshot Production state and validates clean board/project baselines separately from the intentionally filtered list screenshot.
3. Parent-detail review screenshots choose a compact parent issue and record visible sub-issue rows and the guarded add-sub-issue affordance. Their historical Activity-section evidence is visual-only and is not runtime event proof (F138).
4. Selected-actions and Combined filters review screenshots now record manifest evidence for their visible desktop state: selected row count, searchable bulk command menu labels, status/client filter pills, and deduped filtered rows.
5. Project detail now keeps the active team scope when opening mixed-team projects from Video or Graphics. Rows, counts, breadcrumb team, and the `Video project` / `Graphics project` label all use the same scope, and the review packet records row-team evidence for the Video project-detail screenshot.
6. Empty project-board columns are static lanes: they keep title/count, collapse, and empty copy, but do not show fake add/options controls. Populated column headers follow the same read-only contract, and the review packet records board-column action-control evidence.
7. Issue-list and project-detail group headers no longer show no-op add buttons in the read-only preview. Detail pages still keep the guarded add-sub-issue affordance where it explains hierarchy. The review packet records zero group-header add controls for desktop list and project-detail screenshots.
8. Project-detail side metadata now follows Display visibility. When Show sub-issues is off, the main Issues count, grouped rows, and right-side Issues card all report the same visible parent-row count instead of mixing visible rows with the broader project total.
9. Project-board column headers no longer show fake add/options controls in the read-only preview. Headers keep collapse, status, title, and count only, and the review packet records zero board-column action controls across empty and populated columns.
10. Production topbars no longer show fake favorite/notification controls in the read-only preview. List, project detail, issue detail, and the Production skeleton keep navigation/context chrome only, and the review packet records zero fake topbar action controls for the desktop list, project-detail, and parent-detail screenshots.
11. Parent issue details now show a visible `+ Add sub-issues` affordance instead of an unlabeled plus icon. The action remains guarded/read-only, and the review packet records the visible label in the parent-detail screenshot evidence.
12. Selected issue command menus now match the selected count. With multiple issues selected, the menu says `Copy issue IDs` and `Delete issues`; the single-selection path keeps singular copy.
13. Project-card context menus now match visible project controls. `Change status`, `Set lead`, and `Set target` open guarded read-only project pickers instead of rendering as fake disabled mutation rows; `Copy link` remains the active deep-link action.
14. Detail Properties cards no longer show literal `Controls disabled` scaffold pills. The status, assignee, due, project, lead, and target rows remain the visible controls; selecting a guarded value still shows the read-only preview guard.
15. Project-detail issue rows no longer show icon-only empty due controls. Rows with no due date render a readable `Add date` pill that still opens the guarded due-date picker.
16. Project board status lanes use equal readable widths for empty and populated columns. Empty `Planned`, `Paused`, `Completed`, and `Canceled` lanes no longer collapse into narrow strips; overflow is handled by the board's horizontal scroll.
17. Selected issue command menus follow the Linear-style selected-row command panel: the searchable `Actions` menu opens as a centered, roomier panel above the action bar, the action bar stays visible, and hovering command rows only highlights them instead of opening blocking picker submenus.
18. Project board scope chrome separates static context from real controls. `All projects` renders as quiet non-interactive text, while the team scope (`Video`, `Graphics`, etc.) remains the clickable filter pill.
19. Project board cards keep empty target metadata compact: untargeted projects show an icon-only guarded target control instead of repeating `No target` labels across the board, while real target dates remain visible.
20. Detail description empty states use product copy, not migration scaffolding. Empty issue/sub-issue descriptions render `No description.` and empty project descriptions render `No project description.`. The prior `No activity yet.` claim is suspended under F138 because runtime detail never loads/renders native events.
21. Team sidebar issue navigation omits large numeric badges. `Video > Issues` and `Graphics > Issues` stay clickable but no longer show issue totals beside the label.
