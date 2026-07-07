# SyncView ↔ Linear — parity checklist

The living tracker for polishing the SyncView prototype to match Linear. It turns
"Sidney finds a bug and tells Claude" into "Claude works down a list against the
real thing." Method per surface:

1. **Capture** the real Linear surface (probe → screenshot + `getComputedStyle` at 1440px).
2. **Diff** vs ours (side-by-side + measured deltas).
3. **Fix** ours to close the deltas; re-capture.
4. **Self-drive + look** (Playwright clicks it, screenshots, asserts 0 JS errors; eyeball each frame).
5. **Mark** ✅ / note residual deltas.

Legend: ✅ matches · 🟡 built, deltas remain · 🔨 in progress · ⬜ not started · ➖ N/A (removed feature)

---
## Live Linear parity cycle 1 - 2026-07-06

Read-only live observation found two non-skeleton deltas and closed them in both the prototype and the wired preview: issue tabs now read `All issues`, `Active`, `Backlog`, and the row context menu delete hint now reads `Ctrl Delete` on Windows. Before/after visible issue-row snapshots matched with no changed rows. Priority, labels, cycles, Inbox/Triage/Views nav, workspace switcher, and manual new issue chrome remain intentionally removed.

Cycle 2 expanded the read-only live sweep to list selection/actionbar, issue detail, projects board, and project detail. Before/after issue rows again matched with no changed rows. The project board cards now match live Linear's compact card read: no inline description copy on the board card itself.

Cycle 4 rechecked display/group menu, command palette, row hover, and row context menu against live Linear in read-only mode. Before/after visible issue rows again matched (`changed:false`). No code change was made: the remaining live differences are command-palette action mode and display-menu breadth, both crossing the locked simplified-skeleton boundary because live Linear includes Priority/Labels/Cycles and broader view/property controls that SyncView intentionally removed.

Cycle 5 rechecked sidebar hover, row hover/tooltip wait, notification popover, projects board, project-card context menu, and project detail. Before/after visible issue rows again matched (`changed:false`). No code change was made: the observed deltas are larger owner decisions around a project-health insights panel, richer project-detail tabs/properties, and a notification-settings editor.

Cycle 6 rechecked My Issues, command-palette empty/search states, Graphics Issues, and Graphics Projects. A recovered Video issue-list comparison proved the same 20 visible rows before and after (`changed:false`). No code change was made: the observed deltas involve My Issues creation/tab chrome, Graphics Issues saved board display, and team overview navigation scope.

Cycle 7 rechecked row context menu, status/assignee/due/project submenus, issue detail, and detail property hover states. Before/after visible issue rows matched (`changed:false`). No code change was made: the allowed status submenu search row is already present and tested; the remaining live context-menu breadth is removed-skeleton scope.

Cycle 8 rechecked row context menu and status submenu DOM/chrome after the owner reiterated the no-issue-change safety rule. Before/after visible issue rows matched (`changed:false`). No code change was made: Backlog-first/Triage-last status order, numbered hints, and the "Change status..." search row are already present and tested.

Cycle 9 rechecked list selection, range selection, Escape clear, and the floating bulk actionbar. Before/after visible issue rows matched (`changed:false`). The issue actionbar now follows live Linear's compact shape by removing direct Status/Assignee/Due quick buttons; guarded property controls remain available through `Actions`. The live Ask Linear icon is held as an owner/product-scope question.

Cycle 10 rechecked the selected-row `Actions` menu. Before/after visible issue rows matched (`changed:false`). The prototype and wired preview now open the live-style command panel first, with the safe subset only: Assign to..., Assign to me, Change status..., Move to project..., Change due date..., Copy issue URL.

Cycle 11 rechecked the single-selected `Actions` menu and its `status` search filter. Before/after visible issue rows matched (`changed:false`). The safe non-mutating copy rows now include Copy issue ID/URL/title/title-as-link, and typing `status` expands direct status command rows. Wired status commands remain guarded read-only.

Cycle 12 used the accepted Cycle 11 live capture to finish the selected `Actions` copy-only subset: Copy issue description as Markdown, Copy issue content as Markdown, Copy git branch name, and Copy as prompt. Mutating rows observed in live Linear (Subscribe, team move, priority, labels, cycles) remain omitted.

Cycle 14 used the accepted Cycle 11 screenshot to fix a visual spacing delta in the selected `Actions` command panel: the `Ask Linear` label and `Tab` hint now render as separated inline items instead of visually running together.

Cycle 15 fixed the prototype-only blue focus outline on the selected `Actions` input. Live Linear shows no blue ring there; command inputs now opt out of the global focus-visible outline while row/card keyboard focus states remain intact.

## ⭐ PHASE 2 — BEHAVIORAL / INTERACTION parity (2026-07-05) — ✅ DONE
After visual/measured parity (Phase 1) was done, an **adversarial re-audit loop** drove SyncView to behavioral parity: 5 parallel agents interact with every surface via Playwright, find divergences vs real Linear, then fixes land one-per-batch guarded by a growing regression suite. **11 re-audits run; the last SIX all returned 0 high / 0 regressions** — findings converged from ~22 down to only deep polish + accepted skeleton/layout limitations. **~115 divergences closed. `behav.js` grew 16 → 138 assertions (all green), `qa-features.js` ALL GREEN, `sweep.js` CLEAN, 0 JS errors throughout.**

**Per Sidney (awake 2026-07-05): plan B — this + one confirming audit is the finish line, then downshift to periodic re-verification.** The full blow-by-blow worklog is in **`out/PARITY-LOOP.md`** (It56–It81) — that is the canonical behavioral record.

Behavioral features shipped this phase (all ✅, all test-guarded):
- **Row sub-element clicks**: client-chip → project/client PROFILE, due-pill → date picker, avatar → assignee picker, status-icon → status picker (each intercepts + applies live; never opens the issue). Live sub-issue status/due/assignee that reflect in the parent list + progress badge.
- **Multi-select (list)**: checkbox / `x` / Cmd-Ctrl+click (toggle) / Shift+click anywhere incl. glyphs (range) / Shift+↓↑ + Shift+j/k (keyboard range); group-checkbox select-all + partial state; Cmd/Ctrl+A across collapsed groups; selection reconciles on tab/filter change; floating bar with guarded property controls under ⌘ Actions; bulk apply to all selected + keep/clear semantics.
- **Keyboard**: j/k focus ring + Enter-opens (focused-or-hovered) + s/a/⇧D/⇧P pickers; Escape hierarchy (menu → selection → focus ring); ⌘K palette (wraps, person/issue/project/command results); Ctrl/⌘+Backspace delete → **Undo toast + Ctrl/⌘+Z restore**.
- **Detail**: property pickers (status/assignee/due/project) apply+rerender, keyboard nav, focus-trap, number-keys, click-same-twice-closes; **due calendar** (arrow-nav, month paging unified with focus, typed input in calendar too); STAR favorite (persists across nav); breadcrumb parent/client nav; ⋯ menu (submenus flip left near edge); **Activity feed logs system events** (status/assignee/due/sub-add) interleaved with comments; comment edit (blur discards, no silent commit) + **comment-delete Undo**; composer Enter/⌘Enter/Shift+Enter + ⌘↵ hint + per-issue draft persistence.
- **Board**: team-scoped columns; card status-ring/lead/target pickers + card ⋯ menu; HTML5 drag between columns; column collapse; **board keyboard nav** (j/k/arrows focus ring, Enter opens, s/a/⇧D pickers); **board card MULTI-SELECT** (Cmd/Shift+click, hover checkbox, board bulk bar for status/lead/target).
- **Truncation-aware** native tooltips (rows/breadcrumb/board-card names only when clipped); picker "No results" empty states; Filter/Display buttons are real toggles.

**Accepted limitations (intentional, re-confirmed):** detail-side property pickers overlap the sibling rows they open over (covered-sibling click is swallowed) — layout limitation. Skeleton omissions: no priority/labels/cycles/inbox/triage-nav/views/manual-new-issue; no block-level markdown; no sub-issue drag-reorder; no marquee/rubber-band drag-select.

**The tester lives on** — see `out/CONTINUATION.md` → "The behavioral tester (re-launchable)". Sidney can re-run the whole adversarial loop any time.

---

## Chrome & layout
| Surface | Linear ref | Built | Parity |
|---|---|---|---|
| Sidebar (brand, nav, teams, collapse) | ✅ | ✅ | ✅ |
| Top bar (breadcrumb, tabs, filter/group) | ✅ | ✅ | ✅ |
| List row (sub-title › parent, chips, due, created, avatar) | ✅ | ✅ | ✅ |
| Group headers (status) | ✅ | ✅ | ✅ |
| Cursors (no I-beam on chrome) | — | ✅ | ✅ |
| Scale / density | ✅ | ✅ | ✅ (rescaled to Linear's measured 1440px values: 44px rows, 244px sidebar, 48px topbar, 24px title, 15px body) |

## Pickers & menus
| Surface | Linear ref | Built | Parity |
|---|---|---|---|
| Status picker (+search) | ✅ | ✅ | ✅ (search-as-label, ✓ on current) |
| Assignee picker (+search) | ✅ | ✅ | ✅ ("No assignee", search-as-label, ✓ on current) |
| Project picker (+search) | ✅ | ✅ | ✅ (search-as-label, ✓ on current) |
| **Due-date picker → CALENDAR** | ✅ | ✅ | ✅ (quick options w/ resolved dates + natural-language input + Custom→month calendar; dates match Linear exactly) |
| Priority picker | ➖ | ➖ | ➖ (removed) |
| Right-click context menu + cascading submenus | ✅ | ✅ | ✅ |
| Selection + floating action bar | ✅ | ✅ | ✅ (live-style selected Actions command panel; copy-only rows ported; removed/mutating priority/labels/cycles/team-move/subscribe omitted) |
| Filter menu + pill | ✅ | ✅ | ✅ (stackable Status/Assignee/Client conditions; searchable multi-select; "is / is any of" pills, edit + ✕ per pill) |
| Group-by menu | ✅ | ✅ | ✅ |

## Detail & navigation
| Surface | Linear ref | Built | Parity |
|---|---|---|---|
| Issue detail (title, desc, file link, activity, composer) | ✅ | ✅ | ✅ (desc now inline-editable) |
| Properties panel | ✅ | ✅ | ✅ (Properties/Project cards, icon+value rows, no key labels, collapsible) |
| Sub-issue list / parent link / add sub-issue / back stack | ✅ | ✅ | ✅ (＋ Add sub-issue on parents) |
| Browser back/forward (history API) | ✅ | ✅ | ✅ (pushState/popstate, deduped; back mirrors app nav) |
| "⋯" options menu | ✅ | ✅ | ✅ |
| Projects board (columns, cards) | ✅ | ✅ | ✅ (354px columns; column ⋯/＋; card ⋯ on hover; 8px radius) |
| Project detail page | ✅ | ✅ | ✅ (Properties-card style, matches issue detail) |

## States
| State | Built | Parity |
|---|---|---|
| Overdue due-date | ✅ | ✅ |
| Hover / selected row | ✅ | ✅ |
| Empty states | ✅ | ✅ (contextual: filters / My Issues / backlog / active) |
| Tooltips | ✅ | ✅ |
| Status icons (all 12, incl. triage centering) | ✅ | ✅ |

## Backlog / not-yet-wired

### High priority — from Sidney's review — ✅ DONE (2026-07-04)
- ✅ **Editable description** — click `.d-desctext` on a parent OR sub → inline `#descedit` textarea; saves to `i.desc` on blur or ⌘/Ctrl+Enter, Esc cancels, multi-line preserved. (`wireDesc()`)
- ✅ **Add sub-issue** — `＋` in the parent's Sub-issues header → inline title input → creates child via `nextVid()` (max id + 1), opens it, bumps `parent.sub` total (list subchip updates). Scoped to parents only (`!i.parent`); empty title → "New sub-issue". (`wireAddSub()`)
- ✅ **Browser back/forward** — `snapshot()`/`restore()` + `pushLoc()` (pushState, deduped via `sameLoc`) on forward nav; `replaceLoc()` keeps filter/tab/group in the current entry; `popstate` restores under a `popping` guard; back arrow / Esc / close-project = `history.back()`; `backToList()` uses `replaceLoc()` (no ping-pong). Initial `replaceState` seeds entry 0. Verified by `qa-features.js` (31 assertions, 0 JS errors) + a 3-lens adversarial review (3 findings, all fixed).

### Batch 3 — ✅ DONE (2026-07-04)
- ✅ **Full rescale to Linear's measured 1440px scale** (Sidney: "look exactly Linear"). `--row-h` 31→44, `--sidebar` 214→244, topbar 38→48, `.mi` 29→32; title 21→24/32/−.16, body 13.5→15/24/−.1, list ID 11.5→13 muted, list title 12→13, nav 12→13, section headers de-uppercased 12px, action bar 40→44/12, kbd→10, Actions btn `#f7f7f7`. Grounded in `linear-design-tokens.md`.
- ✅ **Filter** — stackable conditions. `S.filters=[{field,values[]}]`; AND across, OR within (`matchFilters`). Menu → Status/Assignee/Client → searchable multi-select w/ checks; toolbar pills "Field is/is any of value(s)" with per-pill edit + ✕; "Assigned to me" quick toggle. History-serialized (deep-copied).
- ✅ **Project detail** → Properties-card style (`.ds-card`, icon-leading rows), matching issue detail.
- ✅ **Projects board polish** — 354px columns, column ⋯/＋ header buttons, card ⋯ on hover (toast stubs), 8px card radius.
- ✅ **Contextual empty states**.
Verified: `qa-features.js` (39 assertions, 0 JS errors) + screenshots of all 6 surfaces + adversarial review.

### Lower / next — mostly CLOSED in Phase 2 (see the ⭐ section above + PARITY-LOOP.md)
- ✅ **⌘K Search palette** — real (issues/projects/people/commands, keyboard nav + wrap).
- ✅ **Keyboard shortcuts** — extensive (j/k, Enter, x, s/a/⇧D/⇧P, ⌘A, Ctrl+Backspace + Ctrl+Z, Escape hierarchy, board nav).
- ✅ **Card ⋯ / project-card menus** — real (Change status / Set lead / Set target / Copy link); column ⋯/＋ remain intentional toast stubs.
- 🟡 **Copy link** — toasts a confirmation (no real clipboard URL; fine for a prototype).
- ⬜ Loading skeletons — none (no async in the prototype).
- ➖ **Dark mode** — deferred (whole-site later; would need re-measuring Linear's dark palette).
- Optional future: capture live Linear to pixel-calibrate the newest surfaces; port these behaviors into the real repo build.

### Sidney's standing decisions (2026-07-05)
- **Plan B**: behavioral parity reached → **downshift to periodic re-verification** (re-run behav/qa/sweep + spot-check Linear), not endless micro-divergence hunting.
- **Keep the tester** re-launchable (done — see CONTINUATION.md).
