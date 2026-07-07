# Wired Production Parity Ledger

Source of truth: `docs/syncview-design/SyncView.html`. Status values:

- ✅ ported: wired `?prod=1` matches the artifact behavior in read-only form.
- 🔒 deferred-B3: artifact behavior mutates data and remains guarded until write authority moves.
- ⬜ pending: read-only-safe artifact behavior still needs transplant/adaptation.

## 2026-07-06 Live Linear Parity Cycle 1

| Behavior | Source | Status | Notes |
|---|---|---:|---|
| Observation safety | Live Linear probe profile | ✅ | Read-only cycle captured before/after visible issue rows; 20 rows before and after, `changed:false` in local private artifact. |
| Issue tab order | live Linear list topbar | ✅ | Prototype and wired tab now render `All issues`, `Active`, `Backlog`; `pixel-wired.js` enforces artifact and wired order. |
| Context menu delete shortcut label | live Linear row context menu on Windows | ✅ | Prototype and wired context menus now show `Ctrl Delete`; mutation remains guarded in wired B2. |
| Locked skeleton omissions | owner standing decision | 🔒 | Priority, labels, cycles, Inbox/Triage/Views nav, workspace switcher, and manual new issue chrome were observed in live Linear but intentionally not copied. |

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
| Cosmetic context-menu fidelity | `CTX` | ✅ | Due/Project hints use `⇧D`/`⇧P`, Delete uses `Ctrl Delete`, and Assignee/Set lead use the person icon. |
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
