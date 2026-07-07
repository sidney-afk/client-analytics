# Wired Production Parity Ledger

Source of truth: `docs/syncview-design/SyncView.html`. Status values:

- ✅ ported: wired `?prod=1` matches the artifact behavior in read-only form.
- 🔒 deferred-B3: artifact behavior mutates data and remains guarded until write authority moves.
- ⬜ pending: read-only-safe artifact behavior still needs transplant/adaptation.

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
