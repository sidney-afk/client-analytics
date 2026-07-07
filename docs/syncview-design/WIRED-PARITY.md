# Wired Production Parity Ledger

Source of truth: `docs/syncview-design/SyncView.html`. Status values:

- ✅ ported: wired `?prod=1` matches the artifact behavior in read-only form.
- 🔒 deferred-B3: artifact behavior mutates data and remains guarded until write authority moves.
- ⬜ pending: read-only-safe artifact behavior still needs transplant/adaptation.
- owner-question: live Linear behavior conflicts with the locked simplified skeleton or needs product scope confirmation.
- superseded: an older ledger row was completed or clarified by a later cycle.

## 2026-07-06 Live Linear Parity Cycle 1

| Behavior | Source | Status | Notes |
|---|---|---:|---|
| Observation safety | Live Linear probe profile | ✅ | Read-only cycle captured before/after visible issue rows; 20 rows before and after, `changed:false` in local private artifact. |
| Issue tab order | live Linear list topbar | ✅ | Prototype and wired tab now render `All issues`, `Active`, `Backlog`; `pixel-wired.js` enforces artifact and wired order. |
| Context menu delete shortcut label | live Linear row context menu on Windows | ✅ | Prototype and wired context menus now show `Ctrl Delete`; mutation remains guarded in wired B2. |
| Locked skeleton omissions | owner standing decision | 🔒 | Priority, labels, cycles, Inbox/Triage/Views nav, workspace switcher, and manual new issue chrome were observed in live Linear but intentionally not copied. |

## 2026-07-06 Live Linear Parity Cycle 2

| Behavior | Source | Status | Notes |
|---|---|---:|---|
| Observation safety | Live Linear probe profile | ✅ | Read-only cycle covered list selection/actionbar, issue detail, projects board, and project detail; 20 visible rows before and after, `changed:false` in local private artifact. |
| Compact project cards | live Linear projects board | ✅ | Prototype and wired board cards omit inline description copy, keeping name/status/menu/lead, issue count, and target/date. |

## 2026-07-06 Wired Parity Cycle 3

| Behavior | Source | Status | Notes |
|---|---|---:|---|
| Board column collapse control chrome | `renderProjects`, `.pcol-chev` | ✅ | Wired `.prod-col-collapse` now matches the artifact's transparent borderless chevron instead of a default button box; pixel lane compares border/background/opacity/cursor. |

## 2026-07-06 Live Linear Parity Cycle 4

| Behavior | Source | Status | Notes |
|---|---|---:|---|
| Observation safety | Live Linear probe profile | ✅ | Read-only cycle covered display/group menu, command palette, row hover, and row context menu; 20 visible rows before and after, `changed:false` in local private artifact. |
| Command palette focused-issue action mode | live Linear command palette | owner-question | Observed live Linear opens action commands for the focused issue, but includes removed Priority/Labels/Cycles rows. Left for owner decision so SyncView does not reintroduce locked removed surface. |
| Display menu breadth | live Linear display menu | owner-question | Observed list/board layout, grouping/sub-grouping/ordering, completed/sub-issue/triage toggles, and display-property chips. Several conflict with locked skeleton removals; left for owner decision. |

## 2026-07-06 Live Linear Parity Cycle 5

| Behavior | Source | Status | Notes |
|---|---|---:|---|
| Observation safety | Live Linear probe profile | ✅ | Read-only cycle covered sidebar hover, row hover/tooltip wait, notification popover, projects board, project-card context menu, and project detail; 20 visible rows before and after, `changed:false`. |
| Projects board insights panel | live Linear projects board | owner-question | Live Linear shows a right-side Health/Initiatives/Teams/Leads panel with update-health counts. Not ported because the current locked skeleton does not include project-health analytics. |
| Project detail tabs and rich side panels | live Linear project detail | owner-question | Live Linear has Overview/Activity/Issues tabs and rich properties/resources/progress. Several fields overlap removed features or mutating settings; left for owner decision. |
| Notification settings popover | live Linear topbar bell | 🔒 | Bell popover edits notification settings. Deferred from B2 read-only preview rather than adding a settings mutation surface. |

## 2026-07-07 Live Linear Parity Cycle 6

| Behavior | Source | Status | Notes |
|---|---|---:|---|
| Observation safety | Live Linear probe profile | ✅ | Read-only cycle covered My Issues, palette empty/search states, Graphics Issues, and Graphics Projects. Recovered list comparison after navigation returned 20 visible rows before and after, `changed:false`. |
| My Issues tab set and create-empty state | live Linear My Issues | owner-question | Live Linear shows Assigned/Created/Subscribed/Activity and a Create new issue empty-state button. Manual creation is a locked removed surface; owner decision needed before porting tab chrome or an adjusted empty state. |
| Graphics Issues saved board display | live Linear Graphics Issues | owner-question | Live Linear opened Graphics Issues as a board-style saved display ("Rocio's Board"). SyncView currently keeps team Issues as the simplified issue surface; display-mode parity remains an owner decision. |
| Team overview route from palette/navigation | live Linear navigation | owner-question | Palette/navigation probing can land on team overview. SyncView does not model team overview in the locked skeleton; left for owner scope decision. |

## 2026-07-07 Live Linear Parity Cycle 7

| Behavior | Source | Status | Notes |
|---|---|---:|---|
| Observation safety | Live Linear probe profile | ✅ | Read-only cycle covered row context menu, status/assignee/due/project submenus, issue detail, and detail property hover states; 20 visible rows before and after, `changed:false`. |
| Status submenu search/header row | live Linear status submenu / `pickerHTML` | ✅ | Live "Change status..." search row is already present in prototype and wired status pickers; `pixel-wired.js` covers context status submenu inventory. |
| Removed context-menu breadth | live Linear row context menu | 🔒 | Priority, Labels, Cycle, Create related, Move, Subscribe, Remind me, and similar live-only entries stay out of the simplified skeleton unless owner expands scope. |

## 2026-07-07 Live Linear Parity Cycle 8

| Behavior | Source | Status | Notes |
|---|---|---:|---|
| Observation safety | Live Linear probe profile | ✅ | Read-only cycle rechecked row context menu and status submenu DOM/chrome; 20 visible rows before and after, `changed:false`. |
| Status submenu order and key hints | live Linear status submenu / `STATUS_ORDER`, `pickerHTML` | ✅ | Live status picker presents Backlog first, Triage last, numbered hints, and the "Change status..." search row; prototype and wired already match and `pixel-wired.js` enforces the status picker order/hints. |
| Removed context-menu breadth | live Linear row context menu | 🔒 | Extra live rows remain out of scope unless the owner expands the simplified skeleton. |

## 2026-07-07 Live Linear Parity Cycle 9

| Behavior | Source | Status | Notes |
|---|---|---:|---|
| Observation safety | Live Linear probe profile | ✅ | Read-only cycle covered single selection, range selection, and Escape clear; 20 visible rows before and after, `changed:false`. |
| Issue selection actionbar quick buttons | live Linear selection actionbar / `renderActionBar`, `_prodSelectionBar` | ✅ | Live issue actionbar has count + Actions + Ask Linear + clear; prototype and wired removed direct Status/Assignee/Due quick buttons. Status/Assignee/Due remain guarded via Actions. |
| Ask Linear actionbar icon | live Linear selection actionbar | superseded | Completed in Cycle 16: prototype and wired preview now include the separate Ask Linear icon chrome; wired routes it to the read-only guard. |

## 2026-07-06 Foundation Session

| Behavior | Source | Status | Notes |
|---|---|---:|---|
| B1 rows adapt to artifact `ISSUES` / `PROJECTS` / `CLIENTS` / `EDITORS` shapes | `ISSUES`, `PROJECTS`, `CLIENTS`, `EDITORS` seeds | ✅ | `_prodAdapter()` is the single render boundary; see `ADAPTER.md`. |
| Batch parent owns children; siblings do not list each other | `childrenOf`, `subProg`, `rowHTML`, `renderDetail` | ✅ | Batch-parent issue is `deliverable.title == batch.name` after trim/case-insensitive normalization. |
| Missing project emoji falls back to project glyph | `I.project`, project card markup | ✅ | No `S` fallback remains in project/card/detail client glyphs. |
| Status glyph vocabulary | `statusSVG` | ✅ | Existing glyph family preserved; adapter feeds artifact status keys (`prog`, `smm`, `kasper`, `client`). |
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
| Mechanical port-fidelity checker | §10.8.3 | ✅ | `test/port-fidelity-check.js` maps 18 artifact/wired ports and requires `PORT-DELTA` on intentional divergences. |
| Wired behavior baseline | §10.8.6, `behav.js` | ✅ | `docs/syncview-design/tests/behav-wired.js` baseline is now `139/139 (guard mode)`. |
| Group headers collapse with chevron and hover state | `renderList`, `.grp-hd` | ✅ | Header click collapses/expands local rows; group checkbox visual is present and guarded. |
| Live filters | `openFilterMenu`, `openFilterSub`, `buildFilterValues`, `pillsHTML` | ✅ | Status, assignee, and client filters are live local reads; value pickers are searchable; remove and clear filters work. |
| Display options / group-by | `openGroupMenu`, `groupsFor` | ✅ | Status, assignee, and client/project grouping are live local reads. |
| Board column collapse | `renderProjects`, `data-pcolcollapse` | ✅ | Columns collapse to artifact-style vertical rails; no board writes are enabled. |
| Command palette search | `openSearch` | ✅ | Sidebar Search and Ctrl/Cmd+K open a read-only navigation palette for issues, clients, assignees, and view switches. |
| Keyboard list navigation | `document.keydown`, `flatOrder` | ✅ | Up/Down/J/K focus rows, Enter opens, Escape clears/goes back; S/A/Shift+D/Shift+P open guarded pickers. |
| Contextual empty states | `renderList` empty-state branch | ✅ | Empty tab/filter states show an icon and Clear filters when a filter caused the empty result. |
| Cosmetic context-menu fidelity | `CTX` | ✅ | Due/Project hints use `⇧D`/`⇧P`, Delete uses `Ctrl Delete`, and Assignee/Set lead use the person icon. |
| Full wired behavior coverage | `behav.js` | ✅ | Current guard-mode baseline is `139/139`; future PRs should only raise this number. |

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
| Brand workspace menu | `renderSidebar` `data-brandmenu` | ported | Ported in Round 3/4 as read-only chrome while retaining the Preview chip. |
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
| Brand workspace caret/menu | `brandCaret` | ported | Artifact brand caret/menu is present as read-only chrome while retaining the Preview chip. |
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
| Brand workspace menu | `renderSidebar` `data-brandmenu` | ported | Brand menu exposes the artifact's four read-only workspace rows while retaining the Preview chip. |
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
| Selection action bar geometry and controls | `renderActionBar`, `.actionbar` | ported | Wired bar now follows live Linear's compact issue selection shape: count + Actions + clear. Mutations still route to guarded/read-only pickers through Actions. |
| Bulk picker placement | owner Phase A finding, `layerPop` clamping | ported | Wired action-bar pickers anchor above the bar and remain on-screen. PORT-DELTA: the standalone artifact overlaps the bar in this scripted state; owner finding requires the safer embedded placement. |
| Filter pill affordance | `pillsHTML`, `.fpill` | ported | Cursor, remove button, click-to-edit, and local read-only remove behavior are covered by `pixel-wired.js`. |
| Embedded Escape cascade | owner Phase A finding | ported | In `?prod=1`: close overlay first, then clear multi-select/action bar, then navigate back. |

## 2026-07-06 Human-Audit Parity Loop, Cycle 1

Human-audit matrix pass (same viewport, artifact vs wired, screenshots local/private):

| Surface x action | Status | Notes / screenshot pairs |
|---|---:|---|
| List / toolbar visual inventory | checked | Reused `artifact-list.png` / `wired-list.png`; no new divergence beyond prior #704 fixes. |
| Selection actionbar / Actions controls | checked | `artifact-crop-selection-actionbar.png` / `wired-crop-selection-actionbar.png`; Cycle 9 removed non-live issue quick buttons. |
| Status picker from actionbar Actions | fixed | `artifact-crop-status-picker.png` / `wired-crop-status-picker.png`; fixed status order, visible `.kbd` hints, selected tick color/order/display. |
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

## 2026-07-07 Live-Linear Parity Loop, Cycle 10

Live Linear observation was read-only. Before/after visible issue-row snapshots for the probed VID issue list both contained 20 rows and `changed:false`; no issue or sub-issue data changed.

| Surface x action | Status | Notes / screenshot pairs |
|---|---:|---|
| Selected issue actionbar -> Actions | fixed | `selection-actions-menu.png` captured the live Linear command-style Actions panel. Prototype and wired now open a matching command panel before Status/Assignee/Due/Project pickers. |
| Selected Actions command inventory | fixed | `artifact-crop-selection-actions-menu.png` / `wired-crop-selection-actions-menu.png`; rows are Assign to..., Assign to me, Change status..., Move to project..., Change due date..., Copy issue URL. Removed skeleton surfaces remain omitted: priority, labels, cycles. |
| Selected Actions -> Change status | fixed | `artifact-crop-status-picker.png` / `wired-crop-status-picker.png`; status picker still opens from the Actions command panel, with wired selections guarded read-only. |

Ranked findings fixed in this cycle:

1. P1: selected-row Actions still opened the smaller row context menu, while live Linear opens a command-palette style Actions panel.
2. P1: the old selected Actions path exposed row-context items such as Delete/Move at the first layer; the live panel first shows command rows, with removed skeleton surfaces omitted.
3. P2: the prototype command-row click needed propagation isolation so the selected Actions status picker stays open.

Pixel lane additions: `pixel-wired.js` now inventories the selected Actions command panel, rejects removed priority/labels/cycles rows, captures command-panel screenshot pairs, and then opens the guarded status picker from inside that panel.

## 2026-07-07 Live-Linear Parity Loop, Cycle 11

Live Linear observation was read-only. Before/after visible issue-row snapshots for the probed VID issue list both contained 20 rows and `changed:false`; no issue or sub-issue data changed.

| Surface x action | Status | Notes / screenshot pairs |
|---|---:|---|
| Single selected Actions copy rows | fixed | `single-selection-actions-menu.png`; prototype and wired now include Copy issue ID, Copy issue URL, Copy issue title, and Copy title as link. Broader copy-content rows remain deferred rather than copying hidden description/body content. |
| Selected Actions search for `status` | fixed | `single-selection-actions-search-status.png`; typing `status` now adds direct `Change status <value>` commands. In wired B2, clicking those rows is read-only guarded. |

Ranked findings fixed in this cycle:

1. P1: the selected Actions command panel had only Copy issue URL, while live Linear exposes several safe copy commands.
2. P2: typing `status` in the selected Actions command search did not reveal direct status commands.

Pixel lane additions: `pixel-wired.js` now checks the expanded copy-command inventory and captures `artifact-crop-selection-actions-search-status.png` / `wired-crop-selection-actions-search-status.png`.

## 2026-07-07 Live-Linear Parity Loop, Cycle 12

Cycle 12 extends the accepted Cycle 11 selected-Actions evidence. The fresh headless live probe was rejected because Linear showed the desktop-app handoff page with zero issue rows, so the code change is limited to rows already present in the accepted Cycle 11 menu capture.

| Surface | Status | Notes |
|---|---:|---|
| Selected Actions copy-only inventory | ✅ | Added Copy issue description as Markdown, Copy issue content as Markdown, Copy git branch name, and Copy as prompt to prototype and wired preview. |
| Selected Actions write/mutation boundary | ✅ | Subscribe, Move to a different team, priority, labels, and cycles remain omitted. Wired status rows remain read-only guarded. |

Validation coverage: `pixel-wired.js` asserts the expanded copy-only inventory and rejects mutating/removed rows; `prod-structure-subset.js` asserts the wired copy-content row exists.

## 2026-07-07 Live-Linear Parity Loop, Cycle 13

Cycle 13 is safety-only because the live Linear browser profile is logged out and fresh live probes are rejected until issue rows can be captured again. It adds regression coverage that the wired selected-Actions `Copy issue content as Markdown` row produces local Markdown preview text and remains inside the existing zero non-GET request invariant.

## 2026-07-07 Live-Linear Parity Loop, Cycle 14

Cycle 14 closes a selected-Actions visual spacing delta from the accepted Cycle 11 screenshot: `Ask Linear` and the `Tab` hint now have explicit inline-flex spacing in prototype and wired preview. `pixel-wired.js` guards the spacing.

## 2026-07-07 Live-Linear Parity Loop, Cycle 15

Cycle 15 removes the prototype-only blue focused outline from selected Actions command inputs and mirrors the scoped no-outline rule in wired preview. `pixel-wired.js` now guards the selected Actions input outline state.

## 2026-07-07 Live-Linear Parity Loop, Cycle 16

Live Linear observation was read-only. Before/after visible issue-row snapshots for the probed VID issue list both contained 20 rows and `changed:false`; no issue or sub-issue data changed.

| Surface | Status | Notes |
|---|---:|---|
| Selected issue actionbar Ask Linear icon | ✅ | Live Linear shows a separate Ask Linear icon button between `Actions` and clear. Prototype and wired preview now include the same icon chrome; wired routes it to the read-only guard. |
| Selected Actions removed/mutating boundary | ✅ | Priority, labels, cycles, team move, and subscribe remain omitted from the simplified skeleton/write-safe B2 surface. |

Validation coverage: `pixel-wired.js` asserts the Ask Linear actionbar button exists in prototype and wired preview, compares its button styling, and checks the exact SVG path.

## 2026-07-07 Live-Linear Parity Loop, Cycle 17

Cycle 17 used the same accepted read-only live Linear capture as Cycle 16; no new issue/sub-issue surface was touched. The accepted capture showed Linear's persistent bottom-right Ask Linear dock.

| Surface | Status | Notes |
|---|---:|---|
| Global Ask Linear dock | ✅ | Prototype and wired preview now render the bottom-right Ask Linear and Chat history chrome. Wired buttons are tagged `data-prod-disabled` and route to `Preview - read-only`. |

Validation coverage: `pixel-wired.js` compares dock presence, placement styles, and icon paths; `prod-structure-subset.js` asserts both wired dock buttons are guarded.

## 2026-07-07 Live-Linear Parity Loop, Cycle 18

Live Linear observation was read-only and hover-only. Before/after visible issue-row snapshots for the probed VID issue list both contained 20 rows and `changed:false`; no issue or sub-issue data changed.

| Surface | Status | Notes |
|---|---:|---|
| Global Ask Linear dock hover geometry | fixed | Live dock buttons use 8px radius, default cursor, and main-button padding `0 12px 0 10px`. Prototype and wired preview now match those values; wired buttons remain guarded. |
| Bottom-left changelog/help chrome | owner-question | Live Linear currently shows account-state-dependent bottom-left changelog/help chrome. Not ported blindly because it is broader product chrome, not issue/sub-issue structure. |

Validation coverage: `pixel-wired.js` now also compares the dock main-button horizontal padding.

## 2026-07-07 Live-Linear Parity Loop, Cycle 19

Cycle 19 used the accepted live bottom-corner capture plus read-only DOM inspection. Follow-up no-op row snapshots still returned 20 visible issue rows before and after with `changed:false`; no issue or sub-issue data changed.

| Surface | Status | Notes |
|---|---:|---|
| Bottom-left changelog/help tray | fixed | Prototype and wired preview now render the live-style `What's new` / `Initiative properties` tray with the collapse-minus chrome. Wired buttons remain read-only guarded. |

Validation coverage: `pixel-wired.js` captures and compares `artifact-crop-newsdock.png` / `wired-crop-newsdock.png`, checks the tray text and collapse icon path, and `prod-structure-subset.js` asserts both wired controls are guarded.

## 2026-07-07 Live-Linear Parity Loop, Cycle 20

Cycle 20 captured the live workspace/brand menu in read-only mode. Before/after visible issue-row snapshots both contained 20 rows and `changed:false`; no issue or sub-issue data changed. The live capture showed a global menu chrome difference that does not alter the locked sidebar skeleton.

| Surface | Status | Notes |
|---|---:|---|
| Workspace brand menu rows | fixed | Prototype and wired preview now match the live menu inventory: Settings, Invite and manage members, Download desktop app, Switch workspace, and Log out. |
| Workspace brand menu hints | fixed | Shortcut hints and the Switch workspace submenu chevron now render in both prototype and wired preview. Wired rows remain read-only guarded. |

Validation coverage: `pixel-wired.js` captures and compares `artifact-crop-brand-menu.png` / `wired-crop-brand-menu.png`, checks menu text and chevron path, and `prod-structure-subset.js` asserts the wired menu inventory.

## 2026-07-07 Live-Linear Parity Loop, Cycle 21

Cycle 21 measured the live dark Linear workspace in read-only mode. Before/after visible issue-row snapshots both contained 20 rows and `changed:false`; no issue or sub-issue data changed. The capture showed the live account is on Linear's dark shell, while the prototype and wired preview were still on the older light token set.

| Surface | Status | Notes |
|---|---:|---|
| Dark shell palette | fixed | Prototype and wired preview now share the live-style dark neutral tokens for page, sidebar, row, menu, border, divider, text, and overlay surfaces. |
| Selected actionbar button fill | fixed | The selected-row actionbar buttons now use the dark hover token instead of the old light `#f7f7f7` fill. |
| Issue/sub-issue data model | unchanged | This cycle changed only visual variables and one selected-row hover token. Parent/child adapter logic, IDs, row data, and detail rendering were not changed. |

Validation coverage: the existing artifact-to-wired pixel lane continues to compare both pages after the token swap, and the live probe accepted only after row snapshots proved the issue list was unchanged.

## 2026-07-07 Live-Linear Parity Loop, Cycle 22

Cycle 22 ran a no-op live Linear snapshot in read-only mode. Before/after visible issue-row snapshots both contained 20 rows and `changed:false`; no issue or sub-issue data changed. The code changes were pure presentation token cleanup after the dark-shell migration.

| Surface | Status | Notes |
|---|---:|---|
| Dark scrollbars | fixed | Prototype scrollbars for sidebar, list, board, card lists, popover lists, and detail now use the dark border-soft token. Wired board/card scrollbars already matched. |
| Row status hover | fixed | Prototype and wired row status glyphs now use the dark hover token on hover. |
| Dark component text tokens | fixed | Prototype board/detail hardcoded light text colors were moved to `var(--text-strong)` / `var(--dim)`; wired property labels now use `var(--prod-dim)`. |
| Issue/sub-issue data model | unchanged | No JavaScript data mapping, adapter parent/child logic, issue IDs, or sub-issue relationships changed. |

Validation coverage: `pixel-wired.js` now includes the row status-hover affordance comparison, alongside the existing dark palette checks.

## 2026-07-07 Live-Linear Parity Loop, Cycle 23

Cycle 23 ran a no-op live Linear snapshot in read-only mode. Before/after visible issue-row snapshots both contained 20 rows and `changed:false`; no issue or sub-issue data changed. The code change was limited to wired preview due-pill presentation.

| Surface | Status | Notes |
|---|---:|---|
| Overdue due-date pill chrome | fixed | Wired overdue pills no longer use the old orange warning fill/border/text. They now keep neutral pill chrome and color only the calendar icon with the dark overdue token, matching the artifact. |
| Issue/sub-issue data model | unchanged | No JavaScript data mapping, adapter parent/child logic, issue IDs, or sub-issue relationships changed. |

Validation coverage: `pixel-wired.js` now compares overdue due-pill chrome and icon color between artifact and wired preview.

## 2026-07-07 Live-Linear Parity Loop, Cycle 24

Cycle 24 ran a no-op live Linear snapshot in read-only mode. Before/after visible issue-row snapshots both contained 20 rows and `changed:false`; no issue or sub-issue data changed. The code change was limited to wired preview tooltip presentation.

| Surface | Status | Notes |
|---|---:|---|
| Sidebar search tooltip shortcut/border | fixed | Wired search tooltip now renders the artifact shortcut hint `⌘K` instead of `Cmd+K`, and uses the artifact soft-border token. |
| Issue/sub-issue data model | unchanged | No JavaScript data mapping, adapter parent/child logic, issue IDs, or sub-issue relationships changed. |

Validation coverage: `pixel-wired.js` now compares sidebar search tooltip text and box styling between artifact and wired preview.

## 2026-07-07 Live-Linear Parity Loop, Cycle 25

Cycle 25 ran a read-only live Linear hover probe on the sidebar search button. Before/after visible issue-row snapshots both contained 20 rows and `changed:false`; no issue or sub-issue data changed. The code change was limited to prototype/wired tooltip text.

| Surface | Status | Notes |
|---|---:|---|
| Sidebar search tooltip live wording | fixed | Live Linear renders the search tooltip as `Search workspace` with `/` as the key hint. Prototype and wired preview now match that live wording while preserving the existing tooltip styling. |
| Issue/sub-issue data model | unchanged | No JavaScript data mapping, adapter parent/child logic, issue IDs, or sub-issue relationships changed. |

Validation coverage: `pixel-wired.js` now pins the search tooltip to the live-observed `Search workspace/` wording and compares artifact vs wired tooltip styling.

## 2026-07-07 Live-Linear Parity Loop, Cycle 26

Cycle 26 used the Cycle 25 live tooltip evidence without touching live Linear again. The code change was limited to non-mutating command-palette keyboard navigation.

| Surface | Status | Notes |
|---|---:|---|
| Sidebar search `/` shortcut | fixed | Prototype and wired preview now open the command palette on `/` when the user is not typing and no popup is open. Ctrl/Cmd+K remains supported. |
| Issue/sub-issue data model | unchanged | No JavaScript data mapping, adapter parent/child logic, issue IDs, or sub-issue relationships changed. |

Validation coverage: `behav.js` and `behav-wired.js` now include the slash-key command-palette assertion; wired guard-mode coverage is now 139/139.

## 2026-07-07 Live-Linear Parity Loop, Cycle 28

Cycle 28 ran a read-only live Linear sidebar Search click in a fresh issue-list tab. Before/after visible issue-row snapshots both contained 20 rows and `changed:false`; no issue or sub-issue data changed.

| Surface | Status | Notes |
|---|---:|---|
| Sidebar Search click | owner-question | Live Linear opens a full Search page; the current artifact and wired preview open the command palette. This is an information-architecture decision because the locked simplified skeleton names `Search(⌘K)`, so it remains unchanged pending owner direction. |
| Issue/sub-issue data model | unchanged | No JavaScript data mapping, adapter parent/child logic, issue IDs, or sub-issue relationships changed. |

## 2026-07-07 Live-Linear Parity Loop, Cycle 29

Cycle 29 ran a read-only live Linear Add Filter click in a fresh issue-list tab. Before/after visible issue-row snapshots both contained 20 rows and `changed:false`; no issue or sub-issue data changed.

| Surface | Status | Notes |
|---|---:|---|
| Add Filter menu taxonomy | owner-question | Live Linear exposes AI filter, Advanced filter, and the full Linear taxonomy, including removed concepts such as Priority, Labels, Initiative, and Cycle. The wired preview keeps the simplified filter set pending owner direction. |
| Issue/sub-issue data model | unchanged | No JavaScript data mapping, adapter parent/child logic, issue IDs, or sub-issue relationships changed. |

## 2026-07-07 Live-Linear Parity Loop, Cycle 30

Cycle 30 ran a read-only live Linear Display options click in a fresh issue-list tab. Before/after visible issue-row snapshots both contained 20 rows and `changed:false`; no issue or sub-issue data changed.

| Surface | Status | Notes |
|---|---:|---|
| Display options menu | owner-question | Live Linear combines List/Board layout switching, grouping/sub-grouping/ordering controls, toggles, and display-property chips including removed concepts. The wired preview keeps the simplified group-by control pending owner direction. |
| Issue/sub-issue data model | unchanged | No JavaScript data mapping, adapter parent/child logic, issue IDs, or sub-issue relationships changed. |

## 2026-07-07 Live-Linear Parity Loop, Cycle 32

Cycle 32 ran a read-only live Linear row-hover probe on the current issue-list tab. Before/after visible issue-row snapshots both contained 18 content rows and `changed:false`; no issue or sub-issue data changed.

| Surface | Status | Notes |
|---|---:|---|
| List row hover band and checkbox reveal | verified | Live Linear reveals the left checkbox and hover band on row hover. The prototype and wired preview already matched; `pixel-wired.js` now pins the contract with cropped row-hover screenshots and computed-style checks. |
| Issue/sub-issue data model | unchanged | No JavaScript data mapping, adapter parent/child logic, issue IDs, or sub-issue relationships changed. |

## 2026-07-07 Live-Linear Parity Loop, Cycle 33

Cycle 33 ran a read-only live Linear row-context-menu probe on the current issue-list tab. Before/after visible issue-row snapshots both contained 18 content rows and `changed:false`; no issue or sub-issue data changed.

| Surface | Status | Notes |
|---|---:|---|
| Row context-menu breadth | owner-question | Live Linear's row menu contains the broader shell, including Priority, Labels, Cycle, Create related, Mark as, Convert to, Open in, Favorite, Subscribe, Remind me, and Delete. The prototype/wired preview keep the existing simplified allowed subset pending owner direction, so no code change was made. |
| Issue/sub-issue data model | unchanged | No JavaScript data mapping, adapter parent/child logic, issue IDs, or sub-issue relationships changed. |

## 2026-07-07 Live-Linear Parity Loop, Cycle 34

Cycle 34 ran a read-only live Linear row-context Status submenu probe on the current issue-list tab. Before/after visible issue-row snapshots both contained 18 content rows and `changed:false`; no issue or sub-issue data changed.

| Surface | Status | Notes |
|---|---:|---|
| Row context Status submenu | verified | Live Linear's status submenu in this workspace uses the same production vocabulary and ordering already present in prototype/wired: Backlog first, number hints, Duplicate before Triage, and Triage last. Existing `pixel-wired.js` / `behav-wired.js` coverage already guards this. |
| Issue/sub-issue data model | unchanged | No JavaScript data mapping, adapter parent/child logic, issue IDs, or sub-issue relationships changed. |

## 2026-07-07 Live-Linear Parity Loop, Cycle 35

Cycle 35 ran read-only live Linear row-context Assignee and Due date submenu probes on the current issue-list tab. Both before/after visible issue-row snapshots contained 18 content rows and `changed:false`; no issue or sub-issue data changed.

| Surface | Status | Notes |
|---|---:|---|
| Row context Assignee submenu | verified | Live Linear's assignee picker shell matches the simplified picker shape. The live invite row remains omitted as mutation/scope-expanding chrome. |
| Row context Due date submenu | fixed | Prototype and wired now use live Linear's quick due placeholder, `Try: 24h, 7 days, Feb 9`. The live cycle-based quick option remains omitted because cycles are a locked skeleton removal. |
| Issue/sub-issue data model | unchanged | No JavaScript data mapping, adapter parent/child logic, issue IDs, or sub-issue relationships changed. |

## 2026-07-07 Live-Linear Parity Loop, Cycle 36

Cycle 36 ran a read-only live Linear row-context Copy submenu probe on the current issue-list tab. Before/after visible issue-row snapshots contained 18 content rows and `changed:false`; no issue or sub-issue data changed.

| Surface | Status | Notes |
|---|---:|---|
| Row context Copy submenu | fixed | Prototype and wired now use a `Copy` submenu with the live copy-only rows: ID, URL, title, title as link, description/content as Markdown, git branch name, and prompt. |
| Make a copy | deferred-B3 | Omitted because it creates/duplicates work and is not part of the read-only B2 preview. |
| Issue/sub-issue data model | unchanged | No JavaScript data mapping, adapter parent/child logic, issue IDs, or sub-issue relationships changed. |

## 2026-07-07 Live-Linear Parity Loop, Cycle 37

Cycle 37 ran a read-only live Linear row-context Project submenu probe on the current issue-list tab. Before/after visible issue-row snapshots contained 18 content rows and `changed:false`; no issue or sub-issue data changed.

| Surface | Status | Notes |
|---|---:|---|
| Row context Project submenu | owner-question | Live Linear includes `No project` above the team-scoped project list. The wired preview keeps client/project-linked production issues attached to a project pending owner direction. |
| Issue/sub-issue data model | unchanged | No JavaScript data mapping, adapter parent/child logic, issue IDs, or sub-issue relationships changed. |

## 2026-07-07 Live-Linear Parity Loop, Cycle 38

Cycle 38 navigated directly from the current live Linear issue list to one issue detail, waited for the detail page to render, then returned to the issue list. Before/after visible issue-row snapshots contained 18 content rows and `changed:false`; no issue or sub-issue data changed.

| Surface | Status | Notes |
|---|---:|---|
| Issue detail right rail | owner-question | Live Linear includes priority, labels, and cycle controls in the detail rail. The wired preview keeps the locked simplified detail structure and omits those removed surfaces pending owner direction. |
| Issue detail toolbar chrome | owner-question | Live Linear includes additional toolbar buttons around link/share/workflow controls. The wired preview keeps the current read-only detail toolbar pending owner direction. |
| Issue/sub-issue data model | unchanged | No JavaScript data mapping, adapter parent/child logic, issue IDs, or sub-issue relationships changed. |

## 2026-07-07 Live-Linear Parity Loop, Cycle 39

Cycle 39 was local-only. `pixel-wired.js` now compares artifact and wired detail side-card headings and row counts, while separately asserting the required wired-only `Controls disabled` read-only affordance remains disabled and titled `Preview - read-only`.

| Surface | Status | Notes |
|---|---:|---|
| Detail side-card inventory | test-hardened | Prototype and wired detail side-card structure is now regression-tested without treating the read-only Controls affordance as a missing artifact row. |
| Issue/sub-issue data model | unchanged | No live Linear probe ran and no JavaScript data mapping, adapter parent/child logic, issue IDs, or sub-issue relationships changed. |

## 2026-07-07 Live-Linear Parity Loop, Cycle 40

Cycle 40 was local-only. `pixel-wired.js` now fails if Priority, Labels, or Cycles are reintroduced as prototype or wired detail side cards.

| Surface | Status | Notes |
|---|---:|---|
| Detail locked removals | test-hardened | The detail rail keeps the locked simplified structure unless the owner explicitly expands scope. |
| Issue/sub-issue data model | unchanged | No live Linear probe ran and no JavaScript data mapping, adapter parent/child logic, issue IDs, or sub-issue relationships changed. |

## 2026-07-07 Live-Linear Parity Loop, Cycle 41

Cycle 41 was ledger-only. Early live-parity rows that were already owner-scope decisions now use `owner-question` instead of `⬜ pending`, and the old Ask Linear actionbar row is marked `superseded` by Cycle 16. This keeps the ledger from treating locked-skeleton product decisions as implementation backlog.

| Surface | Status | Notes |
|---|---:|---|
| Ledger status semantics | clarified | `owner-question` and `superseded` are now defined in the ledger status legend. |
| Issue/sub-issue data model | unchanged | No live Linear probe ran and no JavaScript data mapping, adapter parent/child logic, issue IDs, or sub-issue relationships changed. |

## 2026-07-07 Live-Linear Parity Loop, Cycle 42

Cycle 42 was local-only. `pixel-wired.js` now fails if broader live Linear row-context rows return to the prototype or wired preview: Priority, Labels, Cycle, Create related, Mark as, Convert to, Open in, Favorite, Subscribe, or Remind me.

| Surface | Status | Notes |
|---|---:|---|
| Row context locked removals | test-hardened | The simplified context-menu scope is now regression-tested while preserving allowed guarded artifact rows such as Move and Delete. |
| Issue/sub-issue data model | unchanged | No live Linear probe ran and no JavaScript data mapping, adapter parent/child logic, issue IDs, or sub-issue relationships changed. |

## 2026-07-07 Live-Linear Parity Loop, Cycle 43

Cycle 43 was local-only. `pixel-wired.js` now captures and compares the Filter and Display menus, and fails if broader live Linear taxonomy returns while those owner-scope decisions remain unresolved.

| Surface | Status | Notes |
|---|---:|---|
| Filter menu locked removals | test-hardened | AI/Advanced filter plus Priority, Labels, Initiative, Cycle, and other full-Linear filter fields remain out of the simplified preview. |
| Display menu locked removals | test-hardened | Layout/List/Board switching, ordering, sub-grouping, completed/triage toggles, display-property rows, and removed concepts stay out of the simplified group-by menu. |
| Issue/sub-issue data model | unchanged | No live Linear probe ran and no JavaScript data mapping, adapter parent/child logic, issue IDs, or sub-issue relationships changed. |

## 2026-07-07 Live-Linear Parity Loop, Cycle 44

Cycle 44 was local-only. `pixel-wired.js` now fails if removed full-Linear command-palette rows return to either the prototype or wired preview while those owner-scope decisions remain unresolved.

| Surface | Status | Notes |
|---|---:|---|
| Command palette locked removals | test-hardened | Priority, Labels, Cycles, manual issue creation, Inbox/Triage, team moves, subscription/reminder, conversion, and mark-as commands stay out of the simplified command palette. |
| Issue/sub-issue data model | unchanged | No live Linear probe ran and no JavaScript data mapping, adapter parent/child logic, issue IDs, or sub-issue relationships changed. |
