# Production tab (B2) — parity gap list vs the locked artifact (2026-07-06)

Snapshot taken right after PR #689 (artifact-structure render layer) merged to `main`
(`6c315a5`). Source of truth: `docs/syncview-design/SyncView.html` (behavior) +
`linear-design-tokens.md` (visuals). Standing exception: the wired tab keeps the app's own
typography (owner preference) — fidelity is **structural/behavioral**, not pixel-identical.

Method: line-level diff of the wired `_prod*` render layer against the artifact's
`renderSidebar` / `rowHTML` / `renderList` / `renderProjects` / `renderDetail` / `statusSVG` /
event wiring, plus owner reports from live use. This list is the seed backlog for the
autonomous parity loop (see spec §10.8); the loop should re-verify each item against the
artifact, not against this prose.

Every item below is **read-only-safe** to build during B2 (navigation, presentation, or inert
chrome) unless marked **B3**. Nothing here may add a write path, touch flags, or violate the
`prod-readonly-smoke.js` zero-write invariant.

## P1 — owner-reported, fix first

| # | Gap | Artifact behavior | Wired behavior today |
|---|---|---|---|
| 1 | Detail breadcrumb segments not clickable (owner report + screenshot) | Client crumb (`data-crumbclient`) opens that client's filtered view; parent crumb (`data-goparent`) opens the parent issue | `_prodDetailTopbar` renders plain `<span>`s; only Back works |
| 2 | No right-click context menus (owner report) | Row / multi-select / board card / detail all have context menus (status, assignee, due, copy link…) | No `contextmenu` handling at all. B2 form: menu opens, **mutating items disabled** with the Preview tooltip; "Copy link" can work (read-only) |
| 3 | Self-referential parent crumb (owner screenshot) | A top-level parent shows `client › ID title` — no parent segment | A deliverable that IS its batch's plan/parent row shows the batch name as its own parent (`<client> › <batch> › <ID> <same title as batch>`). Suppress the batch segment when `title == batch.name` / row is the batch parent |
| 4 | "Sub-issues 0" on a filming-plan parent (owner screenshot) | Sub-issue block hidden when empty (add-composer only, which is B3) | Always renders "Sub-issues 0 / No sub-issues in this batch." **Investigate first**: the row's children may be data-missing (completed children → archive; operational-only backfill) vs a `batch_id` linkage miss. Then hide the empty block to match |

## P2 — high-visibility interaction parity (read-only-safe)

5. **Tooltips**: artifact has a rich `data-tip` tooltip system (names + keyboard hints) on nearly
   every element; wired tab uses bare `title=` attributes. Port the tooltip layer.
6. **Group headers**: artifact groups collapse on click (`data-grp`, chevron rotates), have
   hover states and a group check. Wired groups are `cursor: default`, non-collapsible.
7. **Filters**: artifact has a working filter system (status / assignee / client pills with
   is/is-any-of operators, searchable value pickers). Filtering is pure read — can be fully
   live in B2. Wired filter buttons are inert `disabled` stubs.
8. **Display options / groupBy**: artifact supports group-by status / assignee / project.
   Read-only — can be live in B2. Wired tab is status-grouping only, button inert.
9. **Board column collapse** (`data-pcolcollapse`, collapsed rail with vertical name) — absent.
10. **⌘K command palette / search**: artifact palette navigates (issues, views). Read-only
    navigation subset can be live in B2; the sidebar Search button is currently inert.
11. **Keyboard navigation**: artifact has full keyboard model (↑/↓ row focus, Enter open,
    Esc back…). Mutation keys (S/A/⇧D…) stay disabled in B2 (toast/tooltip).
12. **Empty states**: artifact shows contextual messages per view/tab/filter with icon and
    "Clear filters" affordance; wired tab has a single generic empty card.

## P3 — polish / conditional

13. **Multi-select visuals** (checkboxes exist but selection state/count bar absent) — selection
    itself is read-only; bulk actions stay disabled until B3.
14. **Favorites**: sidebar section is wired but no data source sets `favorite`/`fav` on rows
    (B1 schema has no favorites column). Either seed from a local-pref store (read-only,
    per-browser) or leave dormant; decide in the loop.
15. **My Issues identity**: `_prodMyMemberId()` guesses "sidney" by name regex. Correct
    mapping arrives with B3 auth identity; keep the guess but mark it clearly deferred (D-6/§6).
16. **Detail hover affordances** (row hover on sub-issues, avatar/status hover rings) — partial.
17. **Toasts** for inert actions (artifact `toast(...)` pattern) instead of silent no-ops where
    a tooltip alone is unclear.

## Explicitly out of scope for the loop (B3+, write-path)

Status/assignee/due/project pickers actually mutating; comment composer; add sub-issue;
drag-and-drop (board card moves, list reorder); undo; New issue. These are §9/§10.7 build items
behind B3 gates — the loop must not wire them, only keep their disabled chrome faithful.

## Standing verification lanes (must stay green every loop round)

- `node docs/syncview-design/tests/prod-structure-subset.js` (structural subset, wired tab)
- `node docs/syncview-design/tests/prod-readonly-smoke.js` (read-only + zero-write invariant)
- `npm test` (all unit suites)
- Secret scan + `git diff --check` per round; no runtime-flag or backend changes ever.
