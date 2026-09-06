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
  current authority allow it. There is no pre-flip exception: the browser TEST write bypass was
  removed 2026-08-06 because the gateway could never accept it.
- 🔒 unsupported/guarded: no native contract exists; the control must not send a write.
- ⬜ pending: artifact behavior still needs transplant/adaptation.

## 2026-07-13 Current Authority-Gated Write Milestone

This section supersedes unqualified “the mirror is read-only” language elsewhere in this ledger.
The dated sections below remain historical evidence: their “current,” “now,” `B2`, and
`deferred-B3` wording describes the milestone named by that section, not today's capability.

| Behavior | Current status | Contract |
|---|---:|---|
| Status, comment add, due date, and assignee | 🔐 authority-gated | The browser calls only the authenticated `production-write` gateway. A verified compatible role, active/supported target, valid SyncView authority for the row's team, and operation-specific server checks are required. There is no browser exception for TEST clients: the bypass removed on 2026-08-06 stamped a service-drill-only flag that `production-write` rejects from every browser credential, so it returned 401 `invalid_test_override` on every human write and the UI rendered that as an expired sign-in. TEST write coverage belongs to the service-authenticated drill. |
| Canonical comment thread lifecycle | 🔐 F39/F42/F43 source-only candidate | Exact team/client-scoped reads plus manifest-bound Calendar/SXR migration and guarded add/reply/edit/delete/resolve/reopen are implemented in candidate source. Verified client-link SXR Notes now binds token + exact card/component/deliverable and projects only client audience; staff Client-visible requires durable exact Samples-card linkage rather than endpoint self-attestation. **Wired-only delta from the artifact (#937 follow-up, unmerged):** the canonical surface now requires a crosswalk-**VALID** link — the deliverable's `origin`/`team`/`client_slug`/`card_id` must describe that exact card, validated in the browser exactly as `scripts/f42-card-comment-import.js` does — and falls back to legacy card-array rendering on mismatch, absent deliverable, fetch error, or an unresolved lookup; an empty canonical projection never overwrites non-empty legacy content. A deliverable id alone no longer counts as linked. **Browser-only mark-done CAS candidate (unmerged):** resolve discards cached pages and rereads the complete exact thread after the destination dialog, binds that result to the same staff identity and live card/deliverable, and permits one body-free resolve-only rebase after an exact `409/write_conflict`; a second conflict and every incomplete/failed reread remain fail-closed. Error-banner Retry preserves resolve rather than entering the reopen toggle. Edit/delete/reopen never inherit the automatic retry, and comment-only `stay` projection cannot recompute or send overall status. Migration, functions, import, and the tokened TEST drill are not live. |
| Linear-authoritative, missing/malformed authority, unsigned, incompatible-role, and unsupported states | 🔒 guarded | Controls stay read-only and fail closed. Current authority must be read back before any operational decision; the dated Linear/Linear state in `docs/truth/APP.md`/`ROLLBACK.md` is not a permanent guarantee. |
| Locked-state browser proof | ✅ F105 candidate green | `prod-readonly-smoke.js`, structure, interaction, behavior, and pixel coverage preserve zero live mutations and current fail-closed controls. F105 pins row-control checks to an exact non-TEST row, selects an exact child for the owner-ratified inline project-parent breadcrumb, permits empty-fixture fallback only after loaded state plus an independent zero owner-active row count, and requires exact eligible recovered-read correlation while persistent/pending/unmatched errors stay red. |
| Writable-state browser proof | ✅ ported | `prod-write-gateway-browser.js` uses a fully intercepted local mock to prove mixed authority, four supported operations, CAS, verified-role attribution, a locked active-TEST row, and stale-tab rejection without reaching a live backend. `test/production-write-ui-source.js` pins the source contract. |
| Parent/sub-issue creation | 🔒 CLOSED by owner ruling 2026-08-23 | **Neither top-level nor sub-issue creation happens in the Production tab.** Owner ruling: a sub-issue is a card, not a parent issue, and posts that are not on the content calendar should not exist. The reason is in the gateway, not the UI: the create insert hardcodes `card_id: null` for BOTH modes, so a sub-issue created under a parent that HAS a card is just as card-less as a top-level one. Nothing born there reaches the calendar, an approval queue, or a client review link. `_prodCreateGateText` returns a single refusal before every other reason, closing all four of its readers together; the hand-copied fifth gate inside `_prodCreateTopbarButton`'s unscoped branch is deleted (it evaluated to *allowed*, so that button rendered live). `production-write` refuses a new create with `403 production_create_closed`, placed AFTER `productionCreateReplay`. **Retained, deliberately: replay-only recovery.** An `ambiguous` draft may describe a create that already committed, and the replay is the only path that returns that row to its author — so the recovery gate stays open and the server refusal sits after the replay. A draft that earns the definitive 403 (proof nothing committed) is discarded rather than left offering a retry that can only refuse again. Measured before closing: the Production-create signature matches 53 outbox rows, all `test_only`, ZERO real-client rows ever. Posts are created on the Calendar or Samples tab, which creates the deliverable and its Linear issue together, linked. The F203 machinery below the refusal is retained unreachable so reopening at the video flip is a one-line deletion. Record: `OPEN_REPAIRS.md` item 31, `FLIP_BUG_LEDGER.md` §0-7, `ROLLBACK.md`. |
| Manual assignment candidates | ✅ F94 live | **Wired-only delta from the artifact.** The artifact's assignee menu lists the local roster; the wired picker now lists only the gateway's eligible-assignee projection, fetched per issue through the protected `assignee_options` action. Loading, refused, and unavailable states render a notice (plus Retry on failure) and offer no selectable member — including "Unassigned", because clearing an assignee is also a write. Merged and deployed in the 2026-07-26 Slice 5 window; proven end to end by TEST drill runs #17/#18 (2026-07-28). |
| Creative status choices | ✅ F136 live | **Wired-only delta from the artifact.** The artifact offers every status. The wired picker offers a creative exactly the transitions the gateway would accept from the row's *current* status, intersected across a multi-select, and the row's write gate additionally requires the row to be assigned to the signed-in member for `status`. Admin/SMM behaviour is unchanged. **Amended 2026-09-01.** This row also named `attachment` as assignee-bound. That stopped being true on 2026-08-18 (#1084, a graphics creative repairing the canonical file on any graphics row) and the row was not amended then; `CREATIVE_ASSIGNEE_BOUND_OPERATIONS` has held `status` alone since. `attachment` is no longer team-bound either -- see item 32. Merged and deployed in the 2026-07-26 Slice 5 window; the 13x13 transition matrix is proven by TEST drill run #18 (2026-07-28). |
| Foreground freshness control | ✅ F95 live | **Wired-only addition, not in the artifact.** A `.prod-freshness` chip sits in the list, project, and detail top bars: a polite live-region last-success age, a `data-prod-freshness="fresh\|degraded"` state, and a labelled `prod-icon-btn` Refresh reachable by keyboard and touch. At ≤900 px the age text collapses and the button remains. Its glyph is `PROD_REFRESH_ICON`, deliberately outside `PROD_ICON` so the artifact icon-object parity check (`test/port-fidelity-check.js`) still passes byte-for-byte. Merged and deployed in the 2026-07-26 Slice 5 window; convergence proven by TEST drill runs #17/#18 (2026-07-28). |
| Project moves, issue deletes/undo, favorites, and other unimplemented mutations | 🔒 unsupported/guarded | Historical prototype controls do not create runtime authority. Keep them guarded or absent until a separately designed, server-authorized, tested, and owner-approved milestone. |

## 2026-07-23 owner-ratified full-day parity target

This is a target contract, not a claim that the controls exist. It supersedes historical scope
decisions that removed labels, description writes, or manual issue creation. Until each guarded
contract is implemented and proved, the current unsupported/read-only state above remains truthful.
The complete ranked audit is
`docs/audits/2026-07-23-production-tab-graphics-gap-audit.md`.

| Behavior | Ratified target | Current gap owner |
|---|---|---|
| Client identity | The active SyncView roster is the only client catalog. Every current Linear project resolves to one roster client or an explicit internal/TEST classification; future unknowns enter visible repair. Parent/sub-issue families cannot silently disagree. | F200, with F54/F69 extensions |
| Labels | Read and guarded-set the real label catalog with Linear-parity search, colors, checkboxes, selected state, and description tooltips. Exact `2× Workload` / `3× Workload` labels must reach native Workload capacity. | F201 + F40 |
| Descriptions | Read and guarded-write descriptions on parent issues and sub-issues through `production-write`, preserving Markdown and conflict/audit semantics. | F202 |
| Native creation | ~~Create parent issues and sub-issues inside Production.~~ **WITHDRAWN as a target, owner ruling 2026-08-23.** Creation performing no implicit card write was precisely the defect, not the design: every row it made was card-less, in both modes. Production creates nothing; posts start on the Calendar or Samples card. Replay-only recovery of an already-committed create is retained. | F203 (closed) |
| Calendar/Samples relationship | Linking remains a separate explicit action. Native IDs own Production deep links and a later owner-selected picker/create-and-link/reverse-link UX; status/assignee/thread projections must converge. | F50/F112/F126/F43 |
| Saved views and ordering | Current personal Show sub-issues/group/Due-Updated-Created settings remain valid, but shared named views, favorites, board moves, and manual order need an owner scope decision before implementation. | F204 |
| Project property truth | A project card, its detail page, and status/lead/target pickers read one canonical object and cannot substitute defaults for loaded non-default values. | F205 |

F200/F202/F203 are now source-only implementation candidates, not live claims. F200 uses the active
roster/project-ID map, renders provisional/repair/conflict attribution explicitly, removes B1
client insertion, rechecks inbound/reconcile state, and gates the audited 72-row repair behind an
exact private owner manifest. F202 adds Admin/SMM exact-Markdown source/preview editing only for
root and child deliverables, with CAS/idempotency, audit/outbox mirror, authoritative refresh, and
conflict draft recovery. F203 adds Admin/SMM parent/sub-issue creation, deterministic native/Linear
IDs, exact ambiguous-response recovery, validated child dependency/batch reuse, and a closed
Production-only schema that cannot couple creation to Calendar/Samples linkage. Their live
repair/migration/function/TEST-drill gates remain closed.

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
| Compact activity rows | owner Linear screenshot feedback after PR #756 | **historical visual port; runtime blocked by F138** | Production invokes the event loader only for the Properties status-history hover; the Activity renderer remains dormant, and read failure collapses to empty. This is not live Activity parity. |
| Project detail tabs removed | owner project screenshot feedback after PR #757 | ported | The unclear project Open/Closed/All issues tabs are removed from the wired preview; stale `ptab` query params no longer silently filter project rows. |
| Project toolbar order | owner project screenshot feedback after PR #757 | ported | The Project details toggle is a right-side icon control placed immediately after Filter and before Display. |
| Project Display grouping/show sub-issues | owner project screenshot feedback after PR #757 | ported | Project detail rows now regroup by Status, Client, or Assignee, and the Display menu's Show sub-issues toggle hides/shows child rows in the project issue list. |
| Production workspace menu removed | owner project screenshot feedback after PR #757 | ported | The sidebar workspace brand is static; no workspace dropdown, account/admin rows, preview shortcuts, or copy-link action is exposed. |
| Project-card selection state | owner selection screenshot feedback on PR #763 | ported | Mouse selection/deselection no longer leaves the keyboard focus ring or a clipped blue outer border; keyboard selection keeps focus styling for navigation. |
| Project-row metadata clipping | owner project-row hover feedback on PR #763 | ported | Project issue rows let titles shrink before due/avatar/created metadata, so right-side chips stay visible on hover. |
| Searchable selected-issue Actions menu | owner action-menu feedback on PR #763 | ported | Multi-select Actions now opens a Linear-style searchable command menu with Assign to, Change status, Move to project, Copy issue ID, Change due date, and Delete issue; mutating commands stay guarded. |
| Combined filter pills and row identity | owner combined-filter screenshot feedback on PR #763 | ported | Status/client filter pills stay compact with ellipsis, and visible issue lists dedupe by issue ID before rendering. |
| Production polish gate | owner automation request after PR #764; F105 repair | **candidate green; cloud review + merge pending** | The runner selects all ten suites; only the fast lane runs automatically on pull requests. The F105 candidate based on current main `6a8416c` passed fast 7/7 in 143.8s and the complete aggregate in 484.4s, with exact non-TEST locked assertions, deterministic inline project-parent layout, independently proven empty-fixture recovery, fail-closed read/console correlation, fully mocked writable coverage, and post-settle zero-live-mutation audits. Require a green manual fast/interaction/heavy run on the exact candidate before merge. |
| Production boot/loading guard | `prod-boot-budget.js` | ported | `?prod=1` is source-checked against the Production skeleton route, opens within budget, and rejects visible/leaked Analytics skeletons during Production refresh. |
| Accessibility and keyboard-control guard | `prod-a11y-focus.js`, Production key handler | ported | Scoped axe checks pass; icon-only Filter/Display controls have accessible names; focused Production buttons keep native Enter/Space activation instead of being stolen by row keyboard shortcuts. |
| Layout clipping guard | `prod-layout-polish.js` | ported | Desktop, compact desktop, and mobile checks reject clipped row/card metadata, wrapped filter pills, stale project-card focus rings, and off-screen menus/toasts. |
| Reviewer visual packet | `prod-review-packet.js`, `prod-review-packet-validate.js` | 🚨 F122 private-only | The packet structure validator checks completeness, not privacy. Current CI does not upload the live-derived packet or copy its generated manifest/checklist into a public job summary. Generate and inspect it only in an access-controlled local workspace or ephemeral runner until fictional interception and strict archive canaries exist. |
| GitHub polish workflow and issue intake | `.github/workflows/production-polish-gate.yml`, `.github/ISSUE_TEMPLATE/production-polish.yml`, `.github/pull_request_template.md`, `AGENTS.md`, `.github/copilot-instructions.md` | ✅ F105 repaired / 🚨 F122 private-only | F105 repairs the fixture/layout/read-audit epoch on its candidate branch. The re-enabled workflow keeps detailed logs and review/visual output runner-local, publishes no Production artifact or live-derived summary, and sends nothing to Argos. Manual dispatch is the pre-merge cloud-review path for the exact candidate. |
| Existing behavioral gate | `docs/syncview-design/tests/behav-wired.js` | ported | Guard-mode coverage is green at `168/168`; mutation-only behavior is covered by the fully intercepted write-gateway suite. Reset waits for a loaded non-error list and uses a real-row fallback only when the default active-team fixture is empty. |
| Finished-surface inventory gate | `docs/syncview-design/tests/prod-interaction-inventory.js` | ported | Samples unique visible controls across list/detail/board/project states, right-click context zones, hover tips, row open/checkbox/status/due/assignee/client-chip pointer controls, sub-issue body context, guarded add-sub-issue affordances, and the no-write/no-error invariant. |
| Existing visual gate | `docs/syncview-design/tests/pixel-wired.js` | 🚨 F122 private-only | Local and ephemeral-runner runs write `.codex-tmp/prod-pixel-wired` and the wired side can read live Production data. CI does not upload that directory. Keep the output untracked and access-controlled until every live request is intercepted with fictional fixtures. |
| Rollback scope | frontend-only `_prod*` hardening | ported | Revert the July 9 PR/commit to undo this pass. No Supabase data, runtime flags, n8n workflows, or backend write paths were touched. |

## 2026-07-06 Foundation Session

| Behavior | Source | Status | Notes |
|---|---|---:|---|
| B1 rows adapt to artifact `ISSUES` / `PROJECTS` / `CLIENTS` / `EDITORS` shapes | `ISSUES`, `PROJECTS`, `CLIENTS`, `EDITORS` seeds | ✅ | `_prodAdapter()` is the single render boundary; see `ADAPTER.md`. |
| Real Linear parent owns children; siblings do not list each other | `_prodResolveParentLinks`, `childrenOf`, `subProg`, `rowHTML`, `renderDetail` | ✅ F145 merged (#885) | Production projects each deliverable's persisted Linear parent UUID and resolves it globally to the live native parent row, including cross-batch/team/client edges. Batch/title similarity never elects a parent; unresolved or malformed links stay visible as roots. Exact-head hosted Production review passed before owner merge. |
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
| Project card right-click and subrow selection | `pcardRightClick`, `subRowShiftSelects` | ported | Project card context opens without navigation; a shifted subrow click selects exactly that row (renamed and inverted 2026-08-26: it asserted the opposite until an owner report made sub-issue rows selectable — see 982f6ff2 and test/prod-multiselect-in-parent.js). Was: shifted subrow clicks do not create list selections. |
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
    not keep them private. Public Actions visual/review/Argos uploads were removed, all 414 named
    retained bundles were deleted, and the first post-merge proof created no public visual artifact
    or Argos delivery. Packet validation still proves shape, not data minimization; reconciler logs
    and historical external Argos builds remain open.
17. B1 and Production Actions were deliberately re-enabled 2026-07-15 after #836. The Production
    workflow retains its weekday schedule and per-ref concurrency cancellation while publishing no
    artifact, Argos delivery, or live-derived summary; detailed logs and review output remain
    runner-local. Preserve that boundary.
18. Project detail no longer reads as truly empty when filters hide its issues: the issue header shows visible vs total count (`0 of N`), the inline empty state names the active filter cause, and `Clear filters` restores the rows.
19. Issue detail descriptions render common migrated Linear Markdown instead of raw authoring syntax: headings, horizontal rules, bullets, bold labels, code spans, and resource links are formatted while malformed imported resource-link markers are normalized.
20. Filtered project boards label project-card counts as matching issue(s), hide empty columns when matching projects exist, and reserve `No matching projects` for true no-match filtered boards, so board copy reflects active issue filters instead of reading as total project size.
21. **Historical visual-port claim; runtime blocked by F138.** The artifact styling has an activity empty state. The wired SPA invokes its event loader only for the Properties status-history hover, collapses failure to empty, and never invokes the Activity renderer. Do not claim real Activity rows or empty-state behavior until loading/failure/confirmed-empty truth and visible rendering are wired and proved.
22. Delivered-file links on issue detail pages keep the original migrated URL as the destination, but the visible body text is a concise resource label such as `Open folder` instead of a raw Drive/Dropbox/Frame URL.
23. The Projects board `All projects` marker is a static active-scope label, not a button with no action, so every visible button still works, opens guarded chrome, navigates, or is clearly disabled.

## 2026-07-10 Desktop Project-Detail Row Polish

1. **Historical, superseded by owner-ratified #868:** this pass rendered parent context as a secondary line. Project-detail child rows now keep the title and parent breadcrumb inline within `.prod-title`; F105 updated `prod-layout-polish.js` to guard that current contract inside the row.
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
20. Detail description empty states use product copy, not migration scaffolding. Empty issue/sub-issue descriptions render `No description.` and empty project descriptions render `No project description.`. The prior `No activity yet.` claim is suspended under F138 because runtime detail reads events only for a failure-collapsed status-history hover and never renders native Activity.
21. Team sidebar issue navigation omits large numeric badges. `Video > Issues` and `Graphics > Issues` stay clickable but no longer show issue totals beside the label.
22. Panels stop asserting facts they cannot know (2026-08-30, from a live owner
    test). A **batch parent is a synthetic node** minted from the `batches` row,
    and its Assets grid read three columns the f34/f53 migration deliberately
    revoked from the browser grant — so every slot printed **Missing** while the
    same parent rendered the filming-plan link from its granted `description`
    column directly above, and its child resolved the plan correctly through a
    service-role read of the same row. Measured live: 199 synthetic parents, 189
    carrying a URL in the description. Widening `PROD_BATCH_SELECT` is not the
    repair — that read returns 42501 and takes the whole tab down. The three
    post-level slots first rendered **Unavailable** with the explanation as the
    VISIBLE value (a state pill alone leaves the loud `Not provided` in place,
    and a tooltip on a non-focusable span reaches neither keyboard nor touch),
    and `Deliverable file` is not rendered on a synthetic parent at all, since it
    is empty there by construction. Real hierarchy parents are unchanged: they
    are real deliverables and six hold an artifact today.

    **SUPERSEDED IN PART, 2026-08-31 — see item 26.** The `Unavailable`
    explanation is now the FALLBACK, not the resting state: the parent renders
    its Assets panel against a readable child and shows the real links. Two
    things from this entry still hold exactly and are the reason the fallback
    still exists: `PROD_BATCH_SELECT` is still not widened, and a parent with no
    readable child still says `Unavailable` rather than `Missing`.
23. Neither refresh control is offered where it cannot act (2026-08-30). The
    Description header `Refresh` is gone — its premise, Linear changing a
    description underneath the page, the flip retired, and on a batch parent it
    fired a toast for a row the gateway cannot read — and `Refresh access` is no
    longer rendered on a synthetic parent, where the authenticated prober has no
    row to authorize against. `_prodRefreshDescription` remains: the two
    error-banner `Retry` buttons are its real callers and a failed read must stay
    recoverable.
24. A non-graphics deliverable explains its read-only Assets panel (2026-08-30).
    It previously rendered four rows, a refresh control and no reason, because
    the `graphics &&` conjunct suppressed the gate sentence as well as the
    action. Attach is graphics-only at every layer down to
    `production_artifact_write`, so the panel now says so and names the control
    that does work for video — the video link on the calendar card.
25. The `invalid_artifact_url` message states the rule the code enforces
    (2026-08-30). It previously refused folders and never mentioned Frame.io,
    contradicting `assetTypeAllowed` since the 2026-08-16 owner ruling widened
    `deliverable_file` to accept a file OR a folder — so a designer pasting the
    exact shape the team ships was told to go and fix a valid link.

26. The batch parent shows the real links, by borrowing a reader that may see
    them (2026-08-31). Owner: *"I want the drive and frame URL and all the
    assets to be viewable on the parent issue too."* Item 22 was accurate and
    useless — nobody opens a parent issue to learn who may read a column. The
    three columns stay revoked from the browser grant (`index.html` ships its
    own anon key from a public repository, so a column readable there is
    readable by anyone with the key), and instead the panel renders against a
    CHILD of the same batch: a real deliverable row, whose `assetSnapshot` reads
    those exact columns off the batch the child names, through the service role.
    The same borrow `_prodBatchDetail` has made since it shipped. The candidate
    must be able to declare a client scope, using the SAME fallback chain the
    read itself uses (`authorityProject`, then `storedClientSlug`, then
    `project`) — requiring a resolved attribution looked safer and merely went
    on hiding links the server would have returned — while the two attribution
    sentinels are excluded, because sending one as a client slug is a guaranteed
    403 and a candidate that cannot succeed is worse than none. With no
    candidate the item-22 hedge stands.
27. Raw footage and the frame folder are editable; the filming plan is not
    (2026-08-31). Owner: *"anyone should be able to change the link of the raw
    footage, or the frame folder, or the deliverable file, just not the filming
    plan."* Both folder links live on the `batches` row and had no write path
    anywhere — the gateway refuses every batch-entity mutation except `comment`
    — so a wrong folder link was permanent from every seat in the product. The
    new `batch_asset` operation writes them through
    `public.production_batch_asset_write`, whose slot whitelist omits
    `filming_doc_url` so the filming plan is unreachable even for a caller that
    names it. `PROD_ASSET_SPECS` gives each slot a `write` operation and the
    filming plan has none, so **no control renders for it at all** rather than a
    disabled one implying some other role could. `batch_asset` was the FIRST
    operation where a creative is not confined to their own team: a batch is one
    shoot with one set of files worked by both teams and carries a single `team`
    value. `attachment` joined it on 2026-09-01 under the same reasoning and a
    second owner ruling -- item 32. Shape is enforced, reachability only reported — a frame folder made a
    minute ago is not shared yet — and an empty value clears the slot, because
    fixing a wrong link was half the original problem. The editor moved from one
    header button onto each row, since three writable slots and one permanently
    unwritable one cannot be expressed by a single button.
28. The Deliverable file and the calendar `Video URL` are one field with two
    windows (2026-08-31). Editor-to-calendar is the projection in
    `production_artifact_write`. The reverse is a READ, not a writer: giving the
    calendar save path a deliverable write would have it lock
    deliverable-then-card while the artifact path locks card-then-deliverable.
    So a deliverable carrying no canonical file shows the link on the card
    **bound** to it and names the surface in visible text; the first edit
    promotes it through the ordinary attach path, which projects the same value
    back. Only the bound card may speak — `graphicsApprovalArtifactCandidate`
    tolerates a blank binding because it answers whether an artifact exists,
    where old data is not a contradiction; this answers what file a row has,
    where an unbound card is not evidence.
29. Each sub-issue row carries a pill that opens its file (2026-08-31), beside
    the project and due-date pills. `production_deliverables_browser_v1` does
    not carry `file_url` and must not, so `batch_files_read` answers the whole
    batch in one authenticated request. It does not probe: a pill opens a link
    rather than certifying one, and probing each child would cost four outbound
    checks per sub-issue. Per-team read permission applies per row and a refused
    row is absent; a child with no file gets no pill rather than a dead one.
30. An empty asset slot never means the asset is absent (2026-08-31). The panel
    printed `Not provided / Missing` on all four rows for EVERY deliverable — on
    first paint, and permanently whenever the read was refused, underneath the
    banner explaining the refusal. `issue.assets` is hardcoded to four empty
    strings for every row the projection builds, because no asset column is
    browser-readable: the view carries 46 columns and none is asset-bearing, and
    `deliverables.file_url` and `batches.filming_doc_url` both answer 42501 to
    the browser key. Item 22 fixed this for synthetic parents only, and its
    failure path rescued only rows in state `checking`, which a real deliverable
    can never reach. Permanent for a creative opening the other team, for the
    686 live rows whose `client_slug` is not an active client, and for any 401.
    Measured 2026-08-30: 5,888 live deliverables, 1,340 in a batch whose own
    description carries the filming-plan URL the row called Missing. Every row
    now seeds an unreadable state with the reason it carries, and the edge
    function replaces that answer the moment it has one — including a genuine
    `missing`, which only the service role can establish.
    **Amended 2026-08-31, one word, after the owner reported the repaint.** The
    reasoning above holds; the word it chose was one too far. `unavailable`
    asserts a read was ATTEMPTED AND FAILED, and at seed time none has run, so
    every cache drop — a tab return, a save, a sibling batch-asset write
    invalidating the row — repainted all four slots red for the fraction of a
    second before the read answered ("this weird back and forth of refresh that
    I don't really like"). The three words the panel already had separate this
    exactly: `missing` is a fact about the WORLD (unknowable here), `unavailable`
    a fact about the READER (true only after a read failed), `checking` a fact
    about the REQUEST (true right now). So a real deliverable seeds `checking`
    and carries its guidance unattached; the two read-failure paths — which had
    been unreachable for an empty slot, because it was born `unavailable` — now
    convert it and attach the reason at the moment it becomes true. A SYNTHETIC
    parent still seeds `unavailable`: no read is coming there, and its branch
    settles without repainting, so `checking` would stick forever. The
    never-`missing` guarantee, which is what item 30 is really for, is unchanged.
31. **`Unavailable` stopped being said about links the probe never reached
    (2026-08-31).** `probeAssetUrl` already distinguished them — "`unavailable`
    with a status means the fetch completed and the content was not media,
    `unavailable` WITHOUT one" means the redirect chain was refused, the request
    timed out, or the host was unreachable — but the panel painted both the same
    red. A private Frame.io project URL redirects to an auth host deliberately
    absent from the probe's redirect allowlist, so it throws
    `asset_redirect_unapproved` and lands as `unavailable` with no
    `http_status`: the normal answer for a link that is fine, reported to the
    owner as a red pill under a Frame folder he had just saved and could open.
    A row now renders that case as a neutral `Not checked`. Browser-side only —
    `unverified` is not gateway vocabulary and `http_status` already reached the
    page, so no gateway change. The probe remains a REPORT, never a gate; a slot
    it could not reach must not be painted like a broken one.

32. **Reading a post's assets and brief is not a team privilege (2026-09-01).**
    The owner's only active graphics designer opened VID-13513 -- the VIDEO
    parent of a batch she has thumbnail work in -- and got "Description could
    not load" over four `Unavailable` rows and "This staff account cannot read
    assets for this issue." He opened the same screen as admin and saw
    everything, so it read as her account and was not: `staffAssetReadAllowed`
    admitted a `creative` on their OWN team only, and had since 2026-07-24. A
    post's parent row is a VIDEO deliverable on 105 of the batches carrying
    graphics work, and the brief a designer needs -- filming plan link, general
    drive, the client's photos -- lives in that parent's DESCRIPTION, which the
    same gate guards. One gate blanked both halves of her screen on any
    video-parented post, which is why the two symptoms arrived together.
    What the team match was not protecting: the caller is authenticated against
    a declared client scope and the row lookup is pinned to that client, so a
    cross-CLIENT read was never reachable through it. It separated two people
    working the same post, and nothing else.
    Owner ruling: *"I don't want this to be so strict ... anyone, graphic,
    video, social media manager, or admin to be able to edit assets, except for
    the filming plan ... on any parent issue or sub-issue or whatever."* So the
    read opens to any staff role on either team, and `attachment` moves above
    the team match beside `batch_asset` (item 27), which was widened the same
    way on 2026-08-30 for the same reason -- a post is the unit of work, not a
    team. **THE FILMING PLAN is the named exception and needed no new rule:** it
    is absent from `BATCH_ASSET_SLOTS`, `batchAssetColumn` resolves it to
    nothing, `PROD_ASSET_SPECS` gives it no `write` key so no Edit control
    renders, and `production_batch_asset_write` rejects the slot in the
    database. Three independent refusals, all asserted, none touched.
    The widening stops where the ruling stopped. `status`, `due` and `comment`
    keep the team match; `status` stays assignee-bound; descriptions stay
    admin/SMM on both the deliverable and the post -- reading the brief is not
    rewriting it. A creative with no roster team may read but not write, and a
    client principal never reaches either function. The browser gate mirrors the
    gateway and is asserted to decide `attachment` before the team match,
    because a mismatch there is exactly what #1203 shipped: a control the
    gateway would accept, hidden.

33. **The filming plan is the CLIENT's, and the slot now reads it that way
    (2026-09-01).** Owner, looking at a row that said `Missing` for a client who
    has a plan: *"I thought the asset in SyncLinear for the filming plan takes
    the filming plan from that client from Supabase, which she does have one, so
    isn't that how it's working?"* It was not, and the belief was the better
    design. `batches.filming_doc_url` is written in exactly ONE place -- the
    intake create path, which copies the client's plan onto the batch at
    creation (`index.ts`, the `filming_doc_url: intakePlan.planUrl` line) -- and
    nothing has ever re-read it. A batch made any other way (the calendar, the
    samples tab, a backfill, or anything predating the intake path) carries an
    empty column forever. Item 30 measured the consequence without naming this
    cause: 1,340 live deliverables sit in a batch whose own DESCRIPTION carries
    the filming-plan URL the row called Missing.
    So `assetSnapshot` resolves the slot the way the owner already believed it
    did: the batch column if it has one, otherwise the client's plan, through
    the same service-side helper the intake path uses (renamed
    `intakeFilmingPlanForClient` -> `clientFilmingPlanUrl`, since it now answers
    two callers who want the same one fact). The `client_slug` it needs was
    already in the batch projection.
    **This is a READ, and that is the whole safety argument.** The filming plan
    is the owner's standing write exception -- refused by `BATCH_ASSET_SLOTS`,
    by the absence of a `write` key in `PROD_ASSET_SPECS`, and by
    `production_batch_asset_write` -- so a derivation cannot overwrite a value
    some seat typed, because no seat can type one. All three refusals are
    asserted alongside the fallback, since a read-side derivation is exactly the
    change someone would later "finish" by adding a writer.
    The batch column still WINS when set and is never back-filled from this: a
    batch that names its own plan was told to, and one client can run more than
    one shoot. The derived case reports `source: "client_plan"` and the panel
    renders "from the client", the same way a borrowed deliverable file already
    names its card -- and here it is the only answer available on screen, since
    this slot deliberately has no Edit control to explain itself through. The
    ordinary case reports no source at all; relabelling every row in the estate
    to say what it has always meant is not an improvement.

34. **The batch-parent description write never worked, and the refusal carried
    nothing (2026-09-01).** Reported by the owner's SMM the morning after item
    #1203 shipped it: the description "isn't saving". The screen held ~10,000
    characters of Markdown and one red line, *"This change is not allowed on
    this issue."* Nothing about the row was wrong.
    ONE WRITE, THREE NAMES. A batch parent writes the POST's text onto the batch
    row through `batch_description`; every other row writes its own brief
    through `description`. Three places had to agree which name this row uses,
    and did not: the Edit control was gated with `description` (so it rendered
    ENABLED), the save sent `batch_description` (which `_prodCanWrite` refused,
    because its clause read `operation !== 'description'`), and the refusal
    sentence was computed with `description` again -- which the gate approved,
    returning `''`, which falls through to the last-resort sentence. So the one
    message the feature could produce was the one message that carries no
    information, and the gate that produced it was the gate that says the write
    is fine.
    `_prodDescriptionOperation(issue)` now derives the name once and all three
    ask it. The synthetic-parent clause tests the operation KIND
    (`_prodIsDescriptionOperation`) rather than one spelling, so a rename cannot
    reopen this.
    **A second mismatch was masked underneath it and is fixed in the same
    change.** `_prodRoleCanWrite` returned `!!memberTeam` for `batch_asset` and
    `batch_description` together, admitting every rostered creative for both.
    `staffOperationAllowed` returns false for `batch_description` -- settled on
    #1203's own review: a description is admin/SMM everywhere in the estate, and
    widening the post-level one is an owner ruling nobody has made. While the
    parent gate refused everyone the mismatch was unreachable; fixing the gate
    made it reachable, so the browser now refuses it exactly where the gateway
    does.

35. **A deep link to a Linear-only issue told the reader two things, one of them
    false (2026-09-01).** A video editor escalated an issue that "doesn't appear
    in SyncView"; the page said it *"may live only in Linear, or belong to a
    client this view does not cover."* Measured that day: the client was on the
    roster with `active = true` and 328 of its rows already visible, so the
    second half was wrong. The identifier had no row in `deliverables` at all.
    THE MECHANISM, which is what the notice now says instead: SyncView creates
    the issue in Linear, never the reverse. The only importer left is the B1
    stray-catcher, and `incrementalChangedSince()` scans from the previous run's
    `finished_at` minus a five-minute overlap on a 30-minute schedule. The
    `full` re-read that would find an older issue refuses to apply unless both
    teams are Linear-authoritative -- unavailable after F1 **by construction**.
    So an issue typed into Linear and left alone for an hour is not late; it is
    never arriving on its own, and this will recur until create is Linear-free.
    The notice states the one fact the page owns -- there is no row here -- then
    names the two things a person can do: ask an Admin to run the import, or
    create the post on the Calendar, which makes both sides at once. No Retry
    and no Linear link: this page holds no Linear credential, so a control there
    can only re-ask a question already answered. **Recovery for an existing
    stray needs no code**: the incremental lane already accepts `changed_since`,
    and stray mode is INSERT-ONLY, so a dispatch with a wide window imports what
    is missing and leaves every existing row alone.
    **Amended before merge, for a review finding.** The first rewrite said the
    above about EVERY missing deep link. `_prodApplyDeepLinkFallback` renders
    one notice for `?d=`, `?batch=` and `?view=project&client=`, and
    `deepLinkMissing` held only the identifier -- so a missing POST and a
    missing CLIENT were both told that issues created in Linear are not
    imported, which cannot apply to either. The kind rides along now and each
    gets a true sentence. It also separates a case the reader cannot tell apart
    but the page can: an ARCHIVED issue exists and was filtered by
    `_prodDeliverableLive`, so it is named as archived and told explicitly that
    nothing needs importing -- the old advice would have sent someone to create
    a duplicate of a row that is already there.

36. **A post parent showed four `Missing` slots while its own sub-issue showed
    the filming plan (2026-09-01).** Owner: *"that's weird"*. It is, and the
    cause is in the data. The parent is a B1-backfilled row (`b1_d_...`) whose
    `batch_id` is the B1 MIRROR batch (`b1_b_...`), which carries no asset
    columns; its children are native rows (`del_...`) on the native batch
    (`bat_...`), which is where the links actually live. Measured the same day:
    **5,729 of 6,230** live deliverables sit on a `b1_b_` batch and 5,679 rows
    are themselves `b1_d_` rows, so this is the estate's normal shape rather
    than an edge case. The read was truthful and useless.
    The browser already borrows a child's asset read for a batch parent
    (`_prodBatchAssetSource`), but it requires `syntheticBatchParent === true`
    and returns null for a REAL parent deliverable like this one -- which is why
    the gap survived it. `assetSnapshot` now performs the borrow, so every
    reader of the asset read gets it at once: when this row's own batch carries
    none of the three post-level links, it finds the children by this row's
    Linear uuid pinned to its client, and takes the first child batch that
    actually carries links. Bounded at 50 children, reached only on rows that
    are blank today, and `deliverable_file` is never borrowed -- that slot is
    per-row.
    **THE BORROW READS THE VIEW, NOT THE TABLE, and the first version did not.**
    `raw_issue_parent_id` is derived by `production_deliverables_browser_v1`
    from `linear_raw` and does not exist on `deliverables`, so the query
    answered 42703 -- and the guard that stops a lookup blip from 503-ing the
    asset panel turned that into "this parent has no children". The borrow would
    have shipped doing nothing, on the exact rows it was written to repair.
    Caught by review. **This is the third time in this file**: the same wrong
    column silently disabled `autoAssigneeForIntake`'s parent exclusion, and was
    only found on 2026-08-27 when it killed the B1 import lane, which does not
    degrade. `test/deliverables-view-only-columns.js` now sweeps every
    `.from("deliverables")` chain in the edge functions for the six
    view-derived columns and fails with the file and line, so there is no
    fourth.
    **`Invalid` stopped being said about a working Dropbox link, in the same
    change.** Owner: *"the raw footage says invalid but I want to remove that --
    even if it is a dropbox it should work. And it does work."* A Dropbox share
    of one recording is `/scl/fi/...`, which `assetUrlType` calls a FILE, and
    `raw_footage`/`delivery_folder` demanded `folder`. So a link that opens fine
    was painted red on a row nobody could repair. Both slots now accept a file
    or a folder, exactly as `deliverable_file` was widened on 2026-08-16 and for
    the same reason. The HOST allowlist is untouched and is what actually
    protects the slot: a Google Doc is still refused, because a brief is not
    footage.

37. **Two batch rows naming one Linear parent deleted the post (2026-09-01).**
    I told the owner a video editor's missing issue had been "created directly
    in Linear, never imported". He pushed back: *"are you saying that the issue
    she's sending me was created only on linear? I don't think so, I'm pretty
    sure it was created by our system, it even has the same naming as our
    system."* He was right, and item 35's diagnosis was wrong.
    SyncView created the batch AND its Linear parent; B1 then imported the same
    post as a mirror batch. So `bat_0212e7b2...` and `b1_b_881891e2...` -- same
    name, both created at 14:34 the same day -- each carry the one parent uuid
    in `linear_parent_ids`. Different batch ids, so
    `_prodResolveBatchParentNodes` marked the uuid ambiguous and
    `ambiguous.forEach(uuid => byUuid.delete(uuid))` removed it: no synthetic
    parent row, 32 children linked to nothing, and a deep link by its identifier
    resolving to nothing at all.
    **Measured across all 1,657 live batch rows:** 23 parent uuids across 14
    clients mint no row for this reason (djkasper, dougcartwright, bayavoce and
    jennaphillipsballard have three each), and 12 are this native-plus-mirror
    pair. Replayed through the real resolver over the real rows for the reported
    client: before, 0 parents and 32 orphaned children; after, the parent
    resolves to the NATIVE batch and all 32 link to it. Replayed again over all
    1,658 rows with statuses: 1,464 parents minted before, 1,477 after.
    **The native row wins, and the tie-break is not arbitrary:** `bat_` is the
    row SyncView writes to -- `batch_description` targets it, intake populates
    its asset columns, and item 36 measured that the mirror's asset columns are
    empty while the native ones carry the links. A pair with no native side
    stays ambiguous and is still dropped -- two mirrors or two native batches
    claiming one parent is a real conflict, and inventing a winner there would
    show one batch's description under another's parent. That is what the guard
    was written for and it keeps doing it.
    **AN ARCHIVED CLAIMANT NEVER WINS, checked before provenance.** Raised by
    review before merge, and it is not hypothetical: B1's own
    `dropClaimsOwnedByAnotherBatch` skips archived rows when deciding who owns a
    uuid (`b1-linear-backfill.js:1080`), so an ACTIVE import is *deliberately*
    allowed to reuse a claim held by an ARCHIVED batch -- while this projection
    loads batches with no status filter and sees both. A prefix-first rule would
    have handed live children to a retired post and rendered them under its
    stale title and description. Measured across all 1,658 batch rows: exactly
    1 of the 12 native-plus-mirror pairs is that shape (`VID-13587`), and the
    same rule rescues a second post (`GRA-6816`) whose two claimants are both
    mirrors with one archived -- so the recovery is **13 posts, not 12**: 11 by
    provenance and 2 by liveness. `done` is not archived and still competes; a
    finished post is a real post. Two claimants that are equally archived fall
    through to provenance, and two that match on both stay ambiguous.
    **Item 35's copy is corrected a second time.** It shipped asserting a single
    cause -- "issues created directly in Linear are not imported" -- and the
    very report that produced it was ours. Twice now that sentence has named a
    cause the page cannot establish, so it stops diagnosing: it states there is
    no row, ranks the likelier cause honestly, and routes to an Admin.

38. **Item 35's notice is now GATED on the row set being complete, not merely on
    the row being absent (2026-09-03).** Item 35 describes what the
    missing-target notice SAYS. It did not describe when the page is entitled to
    say it, and for two days that was the actual defect — five rounds of it
    (OPEN_REPAIRS 108, 116, 120). `_prodApplyDeepLinkFallback` and the three
    detail panes treated "not in `_prodState.deliverables`" as absence, when the
    boot read is two-phase and the terminal half arrives seconds later. The
    reader was evicted from a posted row, or told "Deliverable not found" about
    a row that landed a moment afterwards.
    Absence is now only evidence once `_prodRowSetComplete()` is true — a tail
    that has LANDED, none pending, none failed. Until then the pane shows a
    skeleton (`_prodIncompletePaneHTML`), and a tail that ran and threw says so
    and offers Refresh rather than claiming the row is gone. Measured in a real
    browser on a warm cache: before, 1.65 s of "Deliverable not found" on every
    refresh of a link to finished work; after, one continuous skeleton.
    Two consequences worth recording because they change how this row must be
    read: the notice item 35 documents is **deferred, never suppressed** — a
    genuinely absent row still gets it, with the same copy and the same kind
    distinction; and the number of exits that can make this claim is now
    enumerated and enforced by `test/prod-not-found-exits-enumerated.js`, so a
    fourth pane cannot say "not found" without consulting the same helper. The
    skeleton also carries a phase-anchored `animation-delay`, because
    `_prodRender` rebuilds the pane and CSS restarted the shimmer on every
    repaint.
    **Rollback boundary unchanged.** Browser-only, ships via Pages on merge; no
    Edge Function, no migration, no F27 Section 4 dispatch, so `ROLLBACK.md`
    needs no new row.

## 2026-09-04 Social Media Manager Side Card

-   **Who runs this client, under `Project`, derived and never held.** The
    SyncLinear detail column gained a `Social media manager` side card below
    `Project`. It is read-only and additive: no picker, no write path, nothing
    else reads its cache. The mapping is not stored in the app — n8n
    `y3rEWCVdB0esN3tO` mirrors the owner's Google Sheet into
    `social_media_managers` nightly, and `smm-weekly-reports` now returns the
    `source_clients` and `synced_at` it had always stored but never handed back.
    Sheet client names and app slugs meet through `wlNormalizeClient`, the same
    normalizer the workload uses, so there is no hand-kept pairing to rot;
    `test/prod-smm-line.js` asserts none exists.
-   **Parity note — this card is not visible to every role, by design.**
    `?action=options` is Admin/SMM and stays that way. Creative and the unsigned
    client preview cannot reach it and see no row at all, rather than an empty
    one. That is an access limitation to widen deliberately with a
    lower-privilege projection if wanted, never by regranting `anon` on
    `social_media_managers` — F88 revoked that on purpose and a live check still
    returns 401.
-   **The Production tab still makes no unprompted staff-authenticated read.**
    The first version fetched on detail render and turned the structure lane red
    against the forged fixture identity. The roster now comes from `_srpState`,
    which the weekly-reports page fills, and a request happens only when nothing
    has answered yet — bounded by a 5-minute TTL, a 1-minute retry and a
    three-failure stop, and dropped entirely on sign-out or account switch via
    `_prodSmmPurgeSensitiveState`.
-   **Keyboard and touch. SUPERSEDED 2026-09-05 — there is no provenance line.**
    It shipped as visible muted text (`Sheet, synced <date>`) because the
    Production tooltip layer is mouseover-only and a `title` would have reached
    neither a keyboard nor a phone. The owner asked for it removed, twice: the
    roster syncs nightly, the manager's name is the answer the reader opened the
    sub-issue for, and a second line under every card is noise on a surface he
    uses all day. **The card now renders the name alone.**
    The accessibility rule that shaped it still stands and is now enforced the
    other way round: `test/prod-smm-line.js` asserts the card carries NO tooltip,
    so the provenance cannot return as a `title` or `data-prod-tip`. If staleness
    ever needs surfacing again, surface it where it is actionable — when the
    nightly sync FAILS — not on every card forever.
-   **Rollback boundary CHANGED.** Two halves — the Pages browser half and the
    `smm-weekly-reports` function half deployed by
    `deploy-onboarding-edge-functions.yml`, which attests the fingerprint rather
    than gating on a stored digest. Safe in either order; `ROLLBACK.md` carries
    the new row.

## Raw footage and the Frame folder belong to the POST (2026-09-05)

Owner: "if someone uploads the frame folder from anywhere, sub-issue or parent
issue, it should appear everywhere, and same for the raw footage."

-   **Candidate behavior.** Both slots are stored as columns on a `batches` row,
    and the rows of one post routinely sit on more than one. Measured across all
    6,332 browser-visible deliverables: of 1,138 posts, **44 span more than one
    batch row**, stranding 141 rows off the bucket the post resolves first. So the
    panel was truthful about the row it read and useless about the post. The
    natural experiment is on the owner's own screen: of four slots the only one
    that AGREED between parent and sub-issue was the filming plan, the one slot
    not read off the batch row.
-   **The 2026-09-01 borrow did not cover it, twice over.** It walked only
    downward (`raw_issue_parent_id` = the reader's own uuid), so a sub-issue
    never reached the parent's row; and it was gated on the reader's own batch
    carrying none of the three, so the owner's own Frame-folder save switched it
    off and took the children's raw footage off the parent with it.
-   **Now.** `assetSnapshot` resolves the post from either direction, orders its
    batch rows native-`bat_`-first then id ascending — the tie-break the
    projection already applies to competing parent claims — and answers **per
    slot**. Correctness does not need the tie-break to pick the right row, only
    every seat to pick the same row. A post on one batch row (1,094 of 1,138)
    makes no extra query; a failed resolution degrades to what the row showed
    before, never to `Missing`. A value held on another row of the post renders
    a **"from the post"** origin chip, the same way a bound card and a client
    filming plan already name themselves.
-   **The write moved with the read, per slot.** A slot is written where its
    value already lives; an empty slot takes the first bucket belonging to this
    post alone; when none qualifies the browser writes the row it is on. **73 of
    1,567 buckets hold more than one post** (one holds ten), so a shared bucket
    is never offered as the target for an empty slot — the editor promises post
    scope and must not quietly reach another post. A read-only fix was rejected:
    it manufactures new splits as its normal mode of operation.
-   **Sub-issue file pills** are asked for once per distinct batch row of the
    post, for the same reason: `batch_files_read` answers one batch id while the
    sub-issue list is a Linear-parent set, so on a split post the response
    carried the parent row alone and every pill was omitted.
-   **Rollback boundary UNCHANGED in shape, two halves as before.** The Pages
    browser half and the `production-write` half deployed by
    `deploy-f27-section4-closures.yml`. Safe in either order: a browser ahead of
    the gateway reads no write target and writes the row it is on, which is the
    behavior that shipped before. `ROLLBACK.md` carries the row.

## The asset grid holds across a refresh; verdicts are reused by URL (2026-09-05)

Owner, with the post-level change live: "whenever it refreshes the link the
open link button disappears and reappears ... two or three times ... do we
really need to refresh access every single time? ... 99% of the time the asset
links are not gonna change."

-   **Candidate behavior.** Revalidate-in-place (2026-08-31) preserved a cached
    asset read only while `state.complete && state.scopeSignature`. A tab return
    invalidates TWICE (synchronously from `_prodRefresh`, then from
    `_prodLoadData` after the projection swap) with a render, and so a re-read,
    in between; the re-read sets `complete` false, the second pass dropped the
    stamped state, and the next render reseeded a skeleton for a link that had
    not moved. The delta tick deleted a changed row's read outright, the pill
    cache was cleared outright, and a `batch_asset` save deleted every other
    row of the post. Same shape four times: discard what is on screen, fetch it
    back identical.
-   **Wired behavior.** What is STAMPED stays: `preservable =
    !!state.scopeSignature`, because the stamp is the one thing the use-time
    gate in `_prodAssetState` needs and `complete` only says whether the LATEST
    read landed. The delta tick marks stale. A batch save writes the just-saved
    value into each sibling's cached slot as `checking` and marks it stale, so
    the next open shows the new link at once and re-reads underneath. Pill
    entries survive with a `batchId`/`scope` stamp and `_prodBatchFileFor(id,
    row)` refuses one whose row left that batch or changed scope; only the
    per-generation status is dropped, which is what makes a parent re-ask, and
    a successful re-ask EVICTS every entry it answered for earlier that the
    batch no longer names, so a cleared file takes its pill down (Codex P1 on
    #1305: the read omits a cleared deliverable, and upserting alone would have
    left the old pill up for the session).
    `_prodEnsureAssets` does not START a read for a stamped row while
    `_prodState.refreshing` is true: `requestStillCurrent()` would refuse it on
    landing (token bump, generation change), and the render after the swap
    starts the one that counts. First paints and the Refresh access button are
    never deferred.
-   **The wait is the probe, and the ledger already had the answer.** Every
    `asset_access_read` probed every slot live. `heldAssetEvidence` now asks
    `production_asset_access_checks` by `(slot, url_sha256)` across every
    deliverable, newest first, and a verdict within `ASSET_EVIDENCE_MAX_AGE_MS`
    (the approval gate's own window) replaces the network step only. The
    checks that depend on the clock or the slot still run first; a status-less
    `unavailable` (a probe that threw) is never reused; the reading row's ledger
    entry is still written with the ORIGINAL `checked_at`; the approval gate
    still probes live. Refresh access sends `recheck: true`.
-   **Parent grid.** A real hierarchy parent draws the three post-level slots
    and the Deliverable file row only when a value exists on it (owner: "there
    is no deliverable file for that").
-   **Rollback boundary UNCHANGED in shape.** Browser half on Pages, gateway half
    by `deploy-f27-section4-closures.yml`, safe in either order: a browser
    sending `recheck` to an older gateway is ignored and probed as before; a
    newer gateway under the older browser simply answers faster. The index
    migration is optional and independent. `ROLLBACK.md` carries the row.
-   **Suites.** `test/prod-asset-refresh-holds.js`, `test/asset-evidence-reuse.js`.

39. **The description edits in place, the way Linear's does (2026-09-06).**
    Owner: *"when we click edit it shouldn't change the way we are viewing
    things ... we shouldn't see those weird brackets ... when we paste an
    image we should just see the actual image ... when I click edit and
    scroll down, it scrolls back up."* Edit used to swap the rendered text for
    a boxed 190px textarea with Source/Preview tabs and raw Markdown in it.
-   **Rule.** A description of work edits IN PLACE: the editing surface is the
    rendered surface, same classes, same type, same box, growing with the
    text. Links render as links and hover to a small card that opens or edits
    them (text and URL); a pasted image shows as the image, with a chip while
    it uploads; typing `- `, `# ` or `---` shapes the line as Linear does;
    Ctrl/Cmd+K makes or edits a link; a URL pasted over a selection becomes
    its link; a click on the read text starts editing with the caret where the
    click landed.
-   **How.** One module, written in the artifact (`descRich*`,
    `descLinkPop*`) and transplanted whole (`_prodDescRich*`,
    `_prodDescLinkPop*`, 36 mapped ports in `test/port-fidelity-check.js`,
    whose normalize now also lowers the letter the `_prod` strip exposes). A
    contenteditable is built from the Markdown, one block per source line,
    every block and inline mark tagged with the exact source form it came from
    (`data-md`, `data-md-prefix`, `data-md-raw`), and a serializer walks it
    back. `descRichRoundTrips()` proves an untouched description comes back
    byte for byte BEFORE the editor is offered; a description it cannot keep
    opens as Markdown with a one-line reason, and the Markdown textarea stays
    one toggle away for everyone.
-   **Same box.** Read view and editor share `margin: 0 -6px; padding: 3px
    6px`; the editor adds a hairline accent ring and nothing else. The read
    renderer no longer draws a spare empty line after a heading, rule, bullet
    or image (its `<br>` join did, which laying the editor over it exposed),
    and the editor collapses the blank lines the read view does not draw with
    `display:none` so margins collapse identically. Five Markdown shapes
    measure pixel-equal in both.
-   **Scroll.** Every focus and caret restore, on every render, runs under
    `_prodDescriptionKeepScroll`, which puts the detail pane and the window
    back where they were: Chrome reveals a restored caret by scrolling, which
    is the "scrolls back up" of the report.
-   **Kept.** Explicit Save/Cancel (the artifact saves on blur; a blur-save
    here writes to Linear, so it is an owner decision, listed), Escape and
    Ctrl+Enter, the write gate on Edit AND on the click-to-edit body, the
    100,000-character ceiling (the count is shown only from 90,000), the NUL
    refusal, the upload placeholder guard on Save, the conflict/CAS flow.
-   **Environment.** One new body-mounted element, `#prodDescLinkPop`
    (`.prod-linkpop`, z-index 10000 with the toast; `ADAPTER.md`).
-   **Suites.** `test/prod-description-rich-editor.js` (Markdown → editor HTML
    in Node, the wiring contracts, the shared box), the in-place section of
    `docs/syncview-design/tests/prod-write-gateway-browser.js` (pixel-equal
    placement over the read view, caret from the click, typing, paste-to-link,
    the link card, render-while-editing keeps focus and pane offset, Escape
    discards, Save writes the exact Markdown).
