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
