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
| 1 | Fixed in this PR: detail breadcrumb segments not clickable (owner report + screenshot) | Client crumb (`data-crumbclient`) opens that client's filtered view; parent crumb (`data-goparent`) opens the parent issue | `_prodDetailTopbar` now renders clickable client and parent/batch crumbs; structural test covers client and parent/batch deep-link navigation. |
| note | 2026-07-06 parity-loop update | P1 #1-#4 are fixed in this PR. The wired tab now has clickable detail breadcrumbs, read-only context menus with Copy link, self-parent suppression for batch-parent deliverables, and hidden empty Sub-issues sections. | Verified against `docs/syncview-design/SyncView.html` with a private side-by-side Playwright screenshot sweep (list, row context menu, detail, Projects board). Remaining known read-only-safe gaps are still the P2/P3 items below; no new P1/P2 divergence was found during this sweep beyond those already listed here. Context-menu mutations remain disabled until B3. |
| 2 | Fixed in this PR: no right-click context menus (owner report) | Row / multi-select / board card / detail all have context menus (status, assignee, due, copy link...) | `_prodOpenContextMenu` now handles rows, detail, batch detail, and project cards. Mutating items are disabled with `Preview - read-only`; Copy link produces `?prod=1` deep links and is covered by the structural suite. |
| 3 | Fixed in this PR: self-referential parent crumb (owner screenshot) | A top-level parent shows `client > ID title` with no parent segment | `_prodIsBatchParent` suppresses the parent crumb and Parent issue side card when the deliverable is its own batch parent (`deliverable.title == batch.name`). |
| 4 | Fixed in this PR: "Sub-issues 0" on a filming-plan parent (owner screenshot) | Sub-issue block hidden when empty (add-composer only, which is B3) | `_prodDetail` now omits the Sub-issues section entirely when there are no children; the structural suite opens a zero-child row and asserts the section is absent. |

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
