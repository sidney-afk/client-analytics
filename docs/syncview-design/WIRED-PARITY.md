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
| Group collapse, richer filters, keyboard list navigation | `behav.js`, `renderList` | ⬜ | Read-only-safe, not completed in this session. |
| Bulk selection, drag/drop, delete/undo, comments, new issue/add sub-issue | `behav.js` mutation assertions | 🔒 | Deferred until B3 write authority. |

This ledger supersedes `docs/audits/2026-07-06-prod-parity-gaps.md` for ongoing B2 parity tracking.
