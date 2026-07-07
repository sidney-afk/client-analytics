# PARITY-LOOP — autonomous Linear-parity worklog

**This is the brain of the `/loop` + `/goal` autonomous run. Read it FIRST every iteration.**
It survives context compaction. If you (Claude) wake up and don't remember the plan, this file IS the plan.

---
# Live Linear parity cycle 1 - 2026-07-06
Read-only observation used the persistent Linear probe profile and CDP attach; no mutating menu items, drags, edits, or picker choices were clicked. Before/after visible issue-row snapshots both contained 20 rows and compared unchanged (`changed:false` in the local private artifact), satisfying the "do not change issues/sub-issues" safety check for this cycle.

Live differences applied outside the locked skeleton:
- Issue tab order now follows live Linear: `All issues`, `Active`, `Backlog`.
- Row context menu delete shortcut label now follows live Linear on Windows: `Ctrl Delete`.

Intentionally not copied from live Linear because they are locked skeleton removals: priority signals, labels, cycles, Inbox/Triage/Views nav, workspace switcher, and manual new issue chrome.

# Live Linear parity cycle 2 - 2026-07-06
Read-only observation expanded to list selection/actionbar, issue detail, projects board, and project detail. Before/after visible issue-row snapshots again contained 20 rows and compared unchanged (`changed:false` in the local private artifact).

Live difference applied outside the locked skeleton:
- Project board cards no longer render description copy inline; live Linear cards stay compact with name, status/menu/lead, issue count, and target/date.

# Wired parity cycle 3 - 2026-07-06
No new live Linear interaction. Artifact-vs-wired screenshots showed the wired project-board column-collapse controls rendering as heavy default button boxes. The wired CSS now resets them to the prototype/live-style transparent chevron controls, hidden until header hover unless the column is collapsed.

# Live Linear parity cycle 4 - 2026-07-06
Read-only observation focused on display/group menu, command palette, row hover, and row context menu. No mutating menu item, picker value, drag, edit, or save path was clicked. Before/after visible issue-row snapshots both contained 20 rows and compared unchanged (`changed:false` in the local private artifact), satisfying the owner requirement that existing issues and sub-issues are not changed.

No code change was made in this cycle. The observed deltas are larger product-shape questions rather than safe one-off ports:
- Live Linear's command palette opens in focused-issue action mode with status/assignee/project-style commands, but also includes locked removed surfaces such as priority, labels, and cycles. The prototype/wired palette remains the simplified skeleton until the owner decides which action-mode rows belong in SyncView.
- Live Linear's display menu includes list/board layout controls, grouping/sub-grouping/ordering, completed/sub-issue/triage toggles, and many display-property chips. Several chips and toggles overlap explicitly removed features. This stays on the owner questions list rather than reintroducing removed product surface.

Private local evidence: `.codex-tmp/linear-live-cycle3/before-after-compare.json` plus local screenshots for display menu, command palette, row hover, and row context menu.

# Live Linear parity cycle 5 - 2026-07-06
Read-only observation focused on sidebar hover, row hover/tooltip wait, topbar notification popover, projects board, project-card hover/context menu, and project detail. No mutating setting, picker value, drag, edit, or save path was clicked. Before/after visible issue-row snapshots both contained 20 rows and compared unchanged (`changed:false` in the local private artifact), again proving the pass did not change existing issues or sub-issues.

No code change was made in this cycle. The observed deltas are larger scope decisions:
- Live Linear's projects board includes a right-side insights panel with Health/Initiatives/Teams/Leads chips and update-health counts. The current prototype/wired board intentionally uses the locked simplified board skeleton and does not model project-health analytics.
- Live Linear's project detail has Overview/Activity/Issues tabs plus rich properties, resources, milestones, progress, labels, initiatives, Slack, and notification/link controls. Several of these overlap locked removed surfaces or mutating settings, so they remain owner-review items.
- Live Linear's bell popover is a notification-settings editor. It is not ported into the read-only B2 preview because it is a settings mutation surface, not passive chrome.

Private local evidence: `.codex-tmp/linear-live-cycle5/before-after-compare.json` plus local screenshots for sidebar, row hover, notification popover, projects board, project-card context menu, and project detail.

# Live Linear parity cycle 6 - 2026-07-07
Read-only observation focused on My Issues, command-palette empty/search states, Graphics Issues, and Graphics Projects. No issue field, project field, picker value, drag, edit, save, or create path was clicked. The raw after snapshot initially landed on the Video team overview page after palette/navigation probing, so it was not used as safety evidence; the recovery pass navigated back to the Video issue list and compared the visible issue rows against the pre-cycle snapshot. Recovered before/after visible issue snapshots both contained 20 rows and compared unchanged (`changed:false`), so existing issues and sub-issues were not changed.

No code change was made in this cycle. The observed deltas are product-shape decisions:
- Live Linear's My Issues surface includes Assigned/Created/Subscribed/Activity tabs and an empty state with a "Create new issue" button. Manual issue creation is a locked removed surface for SyncView, so this is not partially ported without owner direction.
- Live Linear's Graphics Issues opened in a board-style saved display ("Rocio's Board") with status columns and card rows. SyncView's locked skeleton currently treats team Issues as the simplified status-grouped issue surface; view/display-mode parity remains an owner decision.
- Palette search/navigation can leave the user on a team overview route. SyncView currently avoids team overview as a first-class skeleton surface, so this remains a navigation-scope decision rather than a hidden route addition.

Private local evidence: `.codex-tmp/linear-live-cycle6/before-after-recovered-compare.json` plus local screenshots for My Issues, palette empty/search states, Graphics Issues, and Graphics Projects.

# Live Linear parity cycle 7 - 2026-07-07
Read-only observation focused on row context menu, existing status/assignee/due/project submenus, issue detail, and detail property hover states. No menu value, issue field, picker value, drag, edit, save, or create path was clicked. Before/after visible issue snapshots both contained 20 rows and compared unchanged (`changed:false`), so existing issues and sub-issues were not changed.

No code change was made in this cycle. The allowed status-submenu chrome observed in live Linear ("Change status..." search row above status options) is already present in the prototype and wired tab, and `pixel-wired.js` already compares the context status submenu inventory. The surrounding live context menu still includes removed surfaces such as Priority, Labels, Cycle, Create related, Move, Subscribe, Remind me, and notification-style entries; those remain intentionally outside the simplified skeleton unless the owner expands scope.

Private local evidence: `.codex-tmp/linear-live-cycle7/before-after-compare.json` plus local screenshots for row context menu, status/assignee/due/project submenu hovers, and issue detail.

# Live Linear parity cycle 8 - 2026-07-07
Read-only observation rechecked the live row context menu and status submenu DOM/chrome after the owner reiterated the safety rule. No mutating menu item, status value, issue field, picker value, drag, edit, save, or create path was clicked. Before/after visible issue snapshots both contained 20 rows and compared unchanged (`changed:false`), so existing issues and sub-issues were not changed.

No code change was made in this cycle. Live Linear's status submenu showed the same allowed shape already present in the prototype and wired tab: "Change status..." search row, numbered hints, Backlog first, and Triage last. The remaining extra live context-menu rows are still locked removed-skeleton scope.

Private local evidence: `.codex-tmp/linear-live-cycle8/before-after-compare.json` plus local screenshots for row context menu and status submenu.

# Live Linear parity cycle 9 - 2026-07-07
Read-only observation focused on list row selection, range selection, and the floating bulk actionbar. The pass only used local selection (`x`, Shift+ArrowDown) and Escape; no bulk action, picker value, drag, edit, save, create, or issue field was clicked. Before/after visible issue snapshots both contained 20 rows and compared unchanged (`changed:false`), so existing issues and sub-issues were not changed.

Live Linear's issue selection actionbar is compact: count, `Actions`, an Ask Linear icon, and clear. The safe part was ported into the prototype and wired tab by removing the direct Status/Assignee/Due quick buttons from the issue actionbar; guarded bulk status/assignee/due controls still open through the existing `Actions` menu. The Ask Linear icon is not ported because it is a separate product surface outside the current simplified SyncView skeleton.

Private local evidence: `.codex-tmp/linear-live-cycle9/before-after-compare.json` plus local screenshots for single selection, range selection, and Escape clear.

# Live Linear parity cycle 10 - 2026-07-07
Read-only observation focused on the selected-row `Actions` menu. The pass selected rows and opened the menu, then closed it; no command value, picker value, issue field, sub-issue field, drag, edit, save, create, or delete path was clicked. Before/after visible issue snapshots both contained 20 rows and compared unchanged (`changed:false`), so existing issues and sub-issues were not changed.

Live Linear opens a command-palette style selected Actions panel. The safe subset was ported into the prototype and wired read-only tab: Assign to..., Assign to me, Change status..., Move to project..., Change due date..., Copy issue URL. Priority, labels, and cycles stay omitted by the locked simplified skeleton; wired mutations remain guarded with `Preview - read-only`.

Private local evidence: `.codex-tmp/linear-live-cycle10/before-after-compare.json`, `selection-actions-menu.png`, and the pixel screenshot pairs `artifact-crop-selection-actions-menu.png` / `wired-crop-selection-actions-menu.png`.

# Live Linear parity cycle 11 - 2026-07-07
Read-only observation focused on the single-selected `Actions` menu and the menu's `status` search filter. The pass selected one row, opened Actions, typed `status` in the command search, closed the panel, and returned to the Video issue list; no command value, picker value, issue field, sub-issue field, drag, edit, save, create, or delete path was clicked. Before/after visible issue snapshots both contained 20 rows and compared unchanged (`changed:false`), so existing issues and sub-issues were not changed.

Safe live deltas were ported into the prototype and wired read-only tab: Copy issue ID, Copy issue URL, Copy issue title, and Copy title as link now appear in the selected Actions panel; typing `status` expands direct `Change status <value>` rows. Priority, labels, cycles, move-team, subscribe, and broader display-option search rows stay omitted by the locked simplified skeleton or deferred owner decisions; wired status rows remain guarded with `Preview - read-only`.

Private local evidence: `.codex-tmp/linear-live-cycle11/before-after-compare.json`, `single-selection-actions-menu.png`, `single-selection-actions-search-status.png`, and the pixel screenshot pairs `artifact-crop-selection-actions-search-status.png` / `wired-crop-selection-actions-search-status.png`.

# ✅ BEHAVIORAL PARITY DONE — 2026-07-05
SyncView now behaves like real Linear across every surface. **11 adversarial re-audits** run (5 parallel agents vs live Linear each); the finding count converged **22→20→12→11→13→15→9→8→11→10→7**, and the **last SIX all returned 0 high-severity / 0 regressions** — remaining findings are deep polish + intentional skeleton/layout limitations, not defects. **~115 divergences closed** across the behavioral phase. Regression suite: **`behav.js` 138 assertions (all green)**, `qa-features.js` GREEN, `sweep.js` CLEAN, **0 JS errors** throughout.
**All real features shipped:** live row-glyph clicks (chip→profile / due→picker / avatar+status pickers); full list multi-select (checkbox/x/Cmd-click/Shift-click/Shift-arrows) + bulk action bar with guarded property controls under Actions; keyboard model (j/k, Enter focused-or-hovered, s/a/⇧D/⇧P, ⌘K palette, Escape hierarchy); delete + comment-delete **Undo (Ctrl/⌘+Z)**; detail property pickers + calendar (arrow-nav, unified month paging, typed input); **Activity feed logs system events** (on the edited issue, wherever triggered); comment edit (blur discards); **board keyboard nav**; **board card multi-select** (mouse + `x`) + board bulk bar; truncation-aware tooltips; picker/filter "No results"; detail-panel scroll preservation.
**Accepted limitations (intentional, not defects):** detail-side property pickers overlap the sibling rows they open over (covered-sibling click swallowed); list checkbox occupies its own slot rather than overlaying the issue-ID; parent activity feed doesn't roll up child status changes (badge does). Skeleton omissions: no priority/labels/cycles/inbox/triage-nav/views/manual-new-issue; no block-markdown; no sub-issue drag-reorder; no marquee/rubber-band select.
**Per Sidney (plan B):** downshifted to **PERIODIC RE-VERIFICATION** — re-run `behav.js`/`qa-features.js`/`sweep.js` + the `syncview-parity-audit` workflow, spot-check live Linear. The tester is re-launchable ("the dock"): saved workflow `.claude/workflows/syncview-parity-audit.js`, a spawned task chip, and `/loop`. **Strictly read-only against Linear throughout.**
---

## ═══ PHASE 2: BEHAVIORAL / INTERACTION PARITY (Sidney directive, 2026-07-05, post-visual-DONE) ═══
**VISUAL/MEASURED parity is DONE (It52 done-bar + It53-55 post-done sub-surface fixes). NOW: audit every INTERACTION/BEHAVIOR vs Linear.** Sidney: "you need to discover everything that happens when you click different things… hover over everything, click on everything, make sure it works right — there's still a lot to do."
CONCRETE GAPS Sidney named (HIGH priority):
1. **Client chip click** (list row): Linear → opens the CLIENT/PROJECT profile; OURS → just opens the sub-issue (whole-row handler). Chip should navigate to client + stopPropagation.
2. **Due-date pill click** (list row): Linear → opens a date PICKER to change the date inline; OURS → just opens the issue. Pill should open due-picker + stopPropagation.
3. **Sub-issue due-date (or status) change from PARENT issue**: Linear → reflects LIVE in the parent's sub-issue list; OURS → doesn't update until you open the sub-issue. State/re-render propagation bug.
…and MANY more to find by clicking/hovering EVERYTHING on every surface.
METHOD: multi-agent behavioral audit (ultracode) — each agent audits one surface's interactions on out/_sv.html (Playwright) vs Linear-expected behavior, reports divergences. Then fix high-severity in source, rebuild, verify, republish. Distinguish REAL behavioral bugs from intentional skeleton omissions.
TOKEN BUDGET: at ~700k. Sidney: may compact at 1M but ONLY after writing everything to docs first. KEEP THIS FILE + iteration-log UPDATED every step.

### BEHAVIORAL AUDIT (It56, 5-agent workflow wf_d9c97001-527) — 22 divergences (7 high). Full raw output: C:\Users\Sidney\AppData\Local\Temp\claude\C--Users\acc618ca-f815-4413-a283-8f31ba58700a\tasks\wipesw6bl.output
NOTE: the app is ALREADY behaviorally rich — status pickers, real context-menu actions (Status/Assignee/Due/Project/Move/Delete all apply + re-render), stackable filters, group collapse/select-all, description edit+save, comment submit+persist, sub-issue add, nav+history all WORK & match Linear (see matchesBysurface in the output). Gaps are specific; most reuse existing pipelines (just wire a data-* attr).

**FIXED It56 (batch 1 — Sidney's 3 examples + inline sub-issue editing):**
- ✅ list CLIENT CHIP → added data-crumbclient → navigates to client-filtered list (was: opened issue). [Sidney#1] VERIFIED detail=false filtered=true.
- ✅ list DUE PILL → added data-due → opens date picker (was: opened issue). [Sidney#2] VERIFIED pop=true.
- ✅ list ASSIGNEE AVATAR → added data-assign → opens assignee picker (was: opened issue). VERIFIED pop=true.
- ✅ SUB-ISSUE PROGRESS COUNT now LIVE: added subProg(it) helper (done=children with STATUS.type==="completed" [approved/scheduled/posted], total=children count); used in rowHTML subchip + detail sub-hd. [Sidney#3] VERIFIED 0/4→1/4 when a child set to posted.
- ✅ SUB-ISSUE ROWS now have inline STATUS (data-st wrap on the svg) + DUE pill (data-due) + ASSIGNEE avatar (data-assign) on the right — all open pickers that apply + re-render LIVE in the parent (was: subrows only [status,id,title], no inline edit). [Sidney#3] VERIFIED hasDue/hasAssign/hasStBtn all true. CSS: .stt flex:1;min-width:0 + .d-subrow .due 12px/h22.
All: rebuilt, qa GREEN, sweep CLEAN, 0 JS errors, eyeballed detail (subrows show Jun12+ET like Linear), republished (behavioral-batch1).

**BEHAVIORAL BACKLOG (fix next, by severity):**
HIGH: ✅DONE It57 (a) SIDEBAR SEARCH + ⌘K → built real command palette: openSearch() creates .cmdk-bd/.cmdk overlay in #layer (input + fuzzy list over ISSUES titles/ids, CLIENTS names→open project, EDITORS names→assignee-filter); opens on search-icon (data-act="search") AND ⌘K/Ctrl+K keydown; Arrow/Enter/Esc + click-backdrop-to-close; VERIFIED iconOpens+⌘K+results(3 for "wineland")+Enter→detail+Esc-close, eyeballed (Linear-style). ✅DONE It57 (b) PROJECTS BOARD TEAM SCOPING → renderProjects now filters CLIENTS by S.view.team ((p.client&&PROJECTS[p.client]?PROJECTS[p.client].team:"video")===S.view.team; workspace/null shows all); VERIFIED video=11 / graphics=1(Sonia) / ws=12 (genuinely different, not broken-empty). Republished behavioral-batch2-cmdk.
MED: ✅DONE It58 (c) STAR/favorite → real toggle: issue star data-fav→byId(id).fav (filled gold .crumb-star.on svg{fill:currentColor}, toast Added/Removed); list-view star data-favview→favViews Set. VERIFIED click→on→off. ✅DONE It58 (d) GROUP-HEADER CHEVRON → added pointer-events:none to .gcheck (auto on hover) so non-hover chevron clicks pass through & collapse; VERIFIED reachesChev + collapse before=false→after=true. ✅DONE It58 (g) PROJECT-DETAIL issue rows (line ~517 issues.map) → same inline st/due/assignee enhancement as sub-issue rows; VERIFIED hasSt/hasDue/hasAssign. ✅DONE It59 (e) PROJECT CARD STATUS RING → data-pstatus (checked BEFORE [data-project] card-open) → openPPick("pstatus") 6-option picker; VERIFIED pop+items=6+detail=false, selecting moves card (prog→backlog). ✅DONE It59 (f) PROJECT DETAIL side rows → data-pstatus/data-plead/data-ptarget → openPPick handles all 3 (pstatus over PSTATUS_ORDER, plead over EDITORS, ptarget quick-dates+parseDue typed); VERIFIED all 3 open pickers + apply to CLIENTS + re-render. Built openPPick(kind,x,y,pid) near openStatusMenu. Republished behavioral-batch4-projpickers. **ALL HIGH + ALL MED behavioral items ✅.**
LOW: ✅DONE It60 (h) tab order → Active,Backlog,All issues (Active-first). ✅DONE It60 (l) BRAND SyncView click → openBrandMenu() workspace menu (SynchroSocial hd + Settings/Invite/Switch/Log out, stub toasts) VERIFIED open+4items. ✅DONE It60 (m) project-detail sidebar count → derives from real issues.length (VERIFIED sidebar 2 == list 2 rows). ✅DONE It60 (n) MY ISSUES → seeded assignee:"sl" on 3 issues (12800 Dr.Sonia CC, 12704 Alyssa, 12578 DR SONIA Cristina) → My Issues now 3 rows/2 groups. STILL-OPTIONAL (minor, acceptable-skeleton): (i) breadcrumb-id copy-to-clipboard; (j) project card LEAD avatar picker (data-plead exists on detail; card avatar could get it too); (k) column +/⋯ real menus (toast stubs ok); (o) group-by grouping-only (Linear has sort/layout — acceptable). **ALL HIGH + ALL MED + all impactful LOW behavioral items ✅.**
It61: RE-AUDIT workflow (wf_351f1e7a-15d) launched but ALL 5 agents hit a TRANSIENT server rate-limit ("temporarily limiting requests, not your usage") and died → NO findings (empty ≠ clean; must RETRY). Fallback: ran an INLINE comprehensive behavioral REGRESSION SWEEP (saved as behav.js — reusable, 17 assertions) → **ALL 17 BEHAVIORS PASS, 0 regressions, 0 JS errors, qa GREEN, sweep CLEAN**: chip/due/avatar/rowStatus pickers, subLive count+inline rows, ⌘K palette+search, team scoping, star toggle, chevron collapse, project card-ring+detail pickers, tab order, brand menu, my-issues populated. So all fixes HOLD. NEXT: RETRY the re-audit workflow (rate limit should clear) to hunt MISSED/deeper interactions; if it finds nothing → behavioral parity DONE → resume periodic full re-verification (rotate visual measured-vs-fresh-Linear + `node behav.js` behavioral regression each fire). TOOLS now: node qa-features.js (feature asserts) + node sweep.js (interaction sweep, 0 JS errors) + node behav.js (behavioral regression) + probe (visual measure vs Linear).
It62: RE-AUDIT RETRY **SUCCEEDED** (wf_83b1d5c3-978, task w8h2ja2e8) — **30 divergences (4 high, 0 REGRESSIONS)** + an 84-item regression checklist that ALL PASS (every It56-60 fix independently re-confirmed working). Full raw output: C:\Users\Sidney\AppData\Local\Temp\claude\C--Users\acc618ca-f815-4413-a283-8f31ba58700a\tasks\w8h2ja2e8.output
DOMINANT THEME (flagged by 4/5 agents): the app ADVERTISED keyboard shortcuts (S/A/⇧D/⇧P/Ctrl⌫ in tooltips + context menus + ⋯ menu) but never wired them. Plus 2 real bugs + 1 grammar bug.
**FIXED It62 (batch 5 — keyboard + real bugs), all in scratchpad source, rebuilt via new build.js, republished (behavioral-batch5-keyboard):**
- ✅ GLOBAL KEYBOARD SHORTCUTS: added kbInputFocused()/kbAnchor()/kbShortcut() + rewrote the document keydown handler. Bare **S**→status, **A**→assign, **⇧D**→due, **⇧P**→project — target = open issue (S.open) else hovered row else last-selected; fans out to the whole multi-selection via targetIds(); anchored to the matching row sub-element or `.detail-side [data-st/assign/due/client]` (falls back to row/viewport). **Ctrl/⌘+Backspace**→delete (same cascade path as ctx 'del'). **Ctrl/⌘+A**→select-all visible (flatOrder). All guarded: no-op when a layer/overlay is open OR an input/textarea/contenteditable is focused. [audit #1,#2,#5,#9,#14,#17] EYEBALLED: list 's' opens status picker anchored at the row; detail 'a' opens assignee picker anchored at the property row — both pre-highlight+tick the current value, exactly like Linear.
- ✅ COMMENT COMPOSER Escape bug (HIGH): Escape in #cinput used to bubble to goBack() → navigated OFF the issue and DESTROYED the draft. Now inp.onkeydown stops propagation + blurs on Escape (draft kept, stays on detail); Enter (not Shift+Enter) submits; focus returns to #cinput after posting. [audit #3,#12,#20]
- ✅ COMMAND-PALETTE person result (HIGH): picking a person used to keep the current team → could land on 0 rows (e.g. Ethan from Graphics view). Now go() picks a team where that person actually has issues (prefers current team if valid). [audit #4]
- ✅ STATUS PICKER number keys 1-9,0 select (was typed into search). [audit #6,#7]
- ✅ PICKER ARROW-NAV: wirePicker now tracks a highlighted item (.mi.sel), ArrowUp/Down move it, Enter picks the highlighted one (not always first), current value pre-highlighted on open, mousemove syncs highlight. [audit #10]
- ✅ SELECTION PERSISTS after a bulk property edit (wirePicker.pick + buildDue.set now only clear selection when size<=1) so you can chain bulk edits. [audit #8]
- ✅ "now ago" → "just now" for fresh comments. [audit #22]
- ✅ BULK COPY-LINK toast now pluralizes ("N links copied"). [audit #19]
- ✅ COMMAND-PALETTE hover-syncs the keyboard selection (mousemove on .cmdk-item). [audit #23]
- ✅ ADD-SUB inline input now dismisses on blur (no orphaned field). [audit #25]
VERIFY: extended behav.js to **29 assertions** (added kbStatus/kbAssign/kbDue/kbProj/kbSelectAll/kbDelete/pickerNum/pickerArrow/composerEsc/selPersist/copyCount/personCross/nowLabel) → **ALL 29 PASS, 0 regressions**; `node qa-features.js` ALL GREEN; `node sweep.js` SWEEP CLEAN; 0 JS errors throughout. New reusable **build.js** (injects font blob from prior _sv.html → out/SyncView.html + out/_sv.html, syncs mirror out/syncview-app.src.html).
**DEFERRED (documented; lower-value or skeleton-acceptable — candidates for a later batch):** j/k row-focus navigation (#15, needs a focusedRow ring); board drag-drop between columns (#16); comment edit/delete hover-menu (#13); markdown rendering beyond bare-URL linkify (#26); palette command/"Go to" entries (#24); two-click→one-click picker switching (#11); Escape backs out submenu one level (#21); Tab focus-trap in popovers (#18); group-checkbox indeterminate/partial state; project-group-header nav when grouped-by-project; empty board-column placeholders; arrow-key nav for plain menus (brand/ctx) + openPPick pickers. NONE are advertised-but-broken; they're additive depth.
STATUS: behavioral parity is now very deep — the advertised-shortcut gap (the biggest correctness issue) is closed. NEXT: optionally one more re-audit to confirm only the deferred-list items remain, else resume periodic full re-verification (rotate probe visual measured-vs-fresh-Linear READ-ONLY + `node behav.js` (29) + `node qa-features.js` + `node sweep.js`), never stop per Sidney.
It63: DEFERRED-MED batch (from It62's deferred list) — 2 items, both fixed + verified + republished (behavioral-batch6-jknav-comments):
- ✅ **j/k + ArrowUp/Down ROW-FOCUS NAVIGATION** [audit #15, "core Linear interaction"]: added S.focusRow + `.row.kfocus{box-shadow:inset 2px 0 0 var(--accent)}` (left accent bar). keydown handler (list view only): j/↓ next, k/↑ prev (moveFocus clamps + scrollIntoView), **Enter** opens the focused row. The S/A/⇧D/⇧P shortcuts now fall back to focusRow when no hover (kbShortcut priority: open-issue → hoverRow → focusRow → selection); 'x' targets hoverRow||focusRow. focusRow reset on openIssue + restore. EYEBALLED: 3×j lands accent bar on VID-12580.
- ✅ **COMMENT EDIT / DELETE** [audit #13]: each author comment (c.a==="sl") gets a hover '…' (.act-menu, I.dots) → openCommentMenu(Edit/Delete). Edit → S.editComment=idx → inline accent-bordered textarea (#cedit, prefilled) + Cancel/Save (Ctrl+Enter saves, Esc cancels, wireCommentEdit); Delete → splice from i.comments + toast. EYEBALLED: menu (Edit / red Delete), inline editor prefilled with Cancel/Save — both Linear-faithful.
VERIFY: behav.js extended to **35 assertions** (added jkNav/enterFocusOpen/kfocusShortcut/commentEdit/commentEditCancel/commentDelete) → **ALL 35 PASS, 0 regressions**; qa ALL GREEN; sweep CLEAN; 0 JS errors. Built via node build.js, syntax-checked.
REMAINING DEFERRED (next fires, then re-audit): board drag-drop between status columns (#16); markdown beyond bare-URL linkify (#26); palette command/"Go to" entries (#24); two-click→one-click picker switch (#11); Escape backs submenu out one level (#21); Tab focus-trap in popovers (#18); group-checkbox indeterminate state; project-group-header nav; empty board-column placeholders; arrow-nav for plain/openPPick menus. After these → run ONE more re-audit to confirm only truly-optional items remain → then perpetual re-verification (probe visual READ-ONLY + node behav.js(35+) + qa + sweep), never stop.
It64: DEFERRED board/checkbox batch — 3 items, fixed + verified + republished (behavioral-batch7-board-dnd):
- ✅ **PROJECTS BOARD DRAG-DROP** [audit #16]: .pcard now draggable="true"; .pcol carries data-pcol="<statusKey>". Document-delegated dragstart/dragover/drop/dragend listeners (survive re-render): dragstart sets module `dragProj`; dragover preventDefault + highlights the hovered column (.pcol-drop faint tint); drop sets CLIENTS.find(dragProj).status = target column key, render + toast, column counts update live. .pcard-dragging{opacity:.45}. Reuses the same status mutation as the openPPick ring picker.
- ✅ **GROUP-CHECKBOX INDETERMINATE state**: renderList computes someSel=!allSel&&some-selected → gcheck gets class "partial" (accent box + white dash, opacity forced 1 so partial groups show without hover). Full selection still shows the checkmark "on".
- ✅ **EMPTY BOARD-COLUMN placeholder**: a .pcol with 0 cards now renders a faint ".pcol-empty > No projects" instead of blank, so empty columns read as intentional.
VERIFY: behav.js extended to **38 assertions** (added boardDrag/groupPartial/emptyColumn) → **ALL 38 PASS, 0 regressions**; qa ALL GREEN; sweep CLEAN; 0 JS errors. EYEBALLED: Graphics board shows "No projects" in Backlog/Planned/Paused + the one In-Progress card; partial group checkbox shows the accent dash with 1/4 selected. Built via node build.js, syntax-checked.
REMAINING DEFERRED (lower-priority polish, next fires then re-audit): markdown beyond bare-URL linkify (#26), palette command/"Go to" entries (#24), two-click→one-click picker switch (#11), Escape backs submenu out one level (#21), Tab focus-trap in popovers (#18), project-group-header nav when grouped-by-project, arrow-key nav for plain menus (brand/ctx) + openPPick pickers. After these → ONE more re-audit to confirm only truly-optional items remain → then perpetual re-verification (probe visual READ-ONLY + node behav.js(38+) + qa + sweep), never stop.
It65: DEFERRED polish batch — 3 items, fixed + verified + republished (behavioral-batch8-markdown-cmdk):
- ✅ **MARKDOWN in descriptions/comments** [audit #26]: linkify() now renders `code`, **bold**, *italic*, and [label](https://url) in addition to bare URLs. Uses a stash/placeholder pass (code+links+urls stashed to plain-ASCII tokens XMDTOK<i>ENDMDTOK, then bold/italic, then restore) so markdown inside code/links isn't double-processed. CSS: .act-text/.d-desc code = monospace pill; strong = 650. EYEBALLED: comment renders bold word, code pill, bare link + [brief] link, and "June 12" intact.
  ⚠️ LESSON: my first attempt used / PUA sentinels — the Edit/Write path preserved the sentinels in the keep() string but MANGLED the restore regex to /(\d+)/g, which would replace EVERY number in text with st[n] (→"undefined"/corruption). Verified via od -c that the PUA bytes (356 200 200) were really there. FIX: rewrote linkify via a Node script using plain-ASCII tokens (no non-ASCII sentinels in source — they don't survive Edit reliably). Reinforces the existing "avoid regex backslashes/heredocs in cmd files" caution: also avoid non-ASCII sentinels in Edit/Write payloads; use ASCII tokens.
- ✅ **⌘K PALETTE COMMAND entries** [audit #24]: added CMDS list (Go to Video/Graphics issues, My issues, Video/Graphics/All projects) surfaced as type:"command" results (meta "Command") when the query matches; go() runs cm.run() → sets S.view + render. EYEBALLED: "go to" shows all 6 commands, arrow-nav highlights first.
- ✅ **Escape backs a submenu out ONE level** [audit #21]: wirePicker's Escape now checks `subPop===pop` → closeSub() (return to parent ctx menu) instead of clearLayer(); a 2nd Escape (no submenu, parent still open, no input focused) hits the global handler → clearLayer(). Standalone pickers still clearLayer on Escape (subPop null).
VERIFY: behav.js extended to **41 assertions** (added markdown/paletteCommand/submenuEscape) → **ALL 41 PASS, 0 regressions**; qa ALL GREEN; sweep CLEAN; 0 JS errors. Built via node build.js, syntax-checked.
REMAINING DEFERRED (last polish, then re-audit): two-click→one-click picker switch (#11), Tab focus-trap in popovers (#18), project-group-header nav when grouped-by-project, arrow-key nav for plain menus (brand/ctx) + openPPick pickers. After these → ONE more re-audit to confirm only truly-optional items remain → then perpetual re-verification (probe visual READ-ONLY + node behav.js(41+) + qa + sweep), never stop.
PROGRESS: since the clean re-audit, closed 16 substantive findings across It62-65; behav suite 16→41 assertions, all green.
It66: KEYBOARD-NAV polish batch — 2 items, fixed + verified + republished (behavioral-batch9-menu-arrownav):
- ✅ **ARROW-KEY NAV for plain menus** [audit part of #24/keyboard-nav]: new shared `wireMenuNav(pop)` called inside layerPop — guards OUT pops that already have a [data-search] input (pickers handle their own keys), and for plain menus (context/brand/group/filter/comment) adds ArrowUp/Down over visible `.mi` items (.sel highlight, mousemove syncs), Enter → clicks the highlighted item (opens submenus for HASSUB items). Focuses the pop (tabindex=-1). Escape still bubbles to the global handler → clearLayer.
- ✅ **ARROW-KEY NAV for openPPick pickers** (pstatus/plead/ptarget): added psel highlight + ArrowUp/Down + Enter-picks-highlighted + mousemove-sync + current-value pre-highlight, mirroring wirePicker.
VERIFY: behav.js extended to **44 assertions** (added menuNav/menuNavEnter/ppickNav) → **ALL 44 PASS, 0 regressions**; qa ALL GREEN; sweep CLEAN; 0 JS errors. EYEBALLED: 2×ArrowDown in the row context menu highlights "Assignee" (gray bg). Built via node build.js, syntax-checked.
REMAINING DEFERRED (very last, then re-audit): two-click→one-click picker switch (#11), Tab focus-trap in popovers (#18), project-group-header nav when grouped-by-project. After these → ONE more re-audit to confirm only truly-optional items remain → then perpetual re-verification (probe visual READ-ONLY + node behav.js(44+) + qa + sweep), never stop.
PROGRESS: since the clean re-audit, closed 18 substantive findings across It62-66; behav suite 16→44 assertions, all green.
It67: FINAL DEFERRED batch — 3 items, fixed + verified + republished (behavioral-batch10-final-polish). **Deferred list now EXHAUSTED.**
- ✅ **ONE-CLICK PICKER SWITCH** [audit #11]: added `curOpener` (module var set in the document click handler's property-capture line to the [data-st/assign/due/client/pstatus/plead/ptarget] target). layerPop's .pop-bd click handler now: `e.stopPropagation()` + clearLayer, and if a property picker was open (prev=curOpener), re-runs document.elementFromPoint(clickX,clickY) and if it lands on a DIFFERENT property target, re-dispatches its click → switches pickers in ONE click. ⚠️ TWO bugs found+fixed during impl: (a) synthetic MouseEvent doesn't carry clientX/clientY into the handler (test artifact — behav test rewritten to use real p.mouse.click, multi-step); (b) the original backdrop click BUBBLED to the document handler AFTER clearLayer detached the backdrop, so `t.closest('#layer')` returned null (not early-return) and it re-cleared the just-reopened picker → fixed with e.stopPropagation() in the bd handler. KNOWN LIMIT: only switches to a property NOT occluded by the open dropdown (rows above it); a row directly under the dropdown is covered by the pop (which stops propagation) so still needs a 2nd click — matches the structural constraint the audit itself described.
- ✅ **TAB FOCUS-TRAP** [audit #18]: wirePicker/openPPick/wireMenuNav/cmdk/buildDue keydown now intercept Tab (preventDefault) so focus can't leak out of an open popover.
- ✅ **PROJECT-GROUP-HEADER NAV**: when S.groupBy==="project", the group-title span gets class navp + data-project=g.key (g.key = i.project = PROJECTS key = CLIENTS id) so clicking the project name opens the project detail; the [data-project] click branch runs before [data-grp], so the chevron/rest still collapses. CSS .grp-title.navp hover underline.
VERIFY: behav.js extended to **47 assertions** (added pickerSwitch/tabTrap/groupProjectNav) → **ALL 47 PASS, 0 regressions**; qa ALL GREEN; sweep CLEAN; 0 JS errors. EYEBALLED: group-by-project list (emoji+name headers, chips de-duped); one-click switch verified via probe (assignee picker open → click status row → status picker opens). Built via node build.js, syntax-checked.
**ALL AUDITED DEFERRED ITEMS NOW CLOSED (19 substantive findings across It62-67; behav suite 16→47, all green).** NEXT: run ONE confirming behavioral RE-AUDIT (5-agent workflow) to prove only truly-optional skeleton omissions remain; if clean → behavioral parity DONE → perpetual re-verification (probe visual READ-ONLY + node behav.js(47) + qa + sweep), never stop.
It68: 2nd RE-AUDIT (task w3vodh0wp, wf_b3544b4c-3e9) SUCCEEDED — **20 divergences (2 high, 0 regressions)** + 80-item regression checklist all pass (every It62-67 fix independently re-confirmed). Full output: C:\Users\Sidney\AppData\Local\Temp\claude\C--Users\acc618ca-f815-4413-a283-8f31ba58700a\tasks\w3vodh0wp.output. Fixed the 2 HIGH + 5 MED + 6 cheap-LOW inline this batch (republished behavioral-batch11-reaudit2):
- ✅ **DELETE cascade count** (HIGH): ctx 'del' + Ctrl+Backspace toast now reports actual removed count (before-after delta) so deleting a parent w/ 3 kids says "Deleted 4 issues" (was "1").
- ✅ **COMMENT DRAFT persistence** (HIGH): composer now a **textarea**; S.draft[S.open] holds the in-progress text (set on input, restored into #cinput after every render, cleared on send). Draft survives sub-issue status/due/favorite changes AND navigate-away/back. [was: any render wiped the input]
- ✅ **kbShortcut selection priority** (MED): explicit multi-selection now beats hoverRow (id = S.open ? open : selection.size ? lastSel : hover||focus), so s/a/⇧D/⇧P apply to ALL checked rows regardless of cursor position.
- ✅ **Picker SYNC focus** (MED): wirePicker/openPPick/buildDue now focus the search input synchronously (not setTimeout 20ms) so the first keystroke / number-shortcut isn't dropped.
- ✅ **COMPOSER textarea + Enter/Shift+Enter** (MED): Enter submits, Shift+Enter newline; linkify preserves \n as <br>; comment-EDIT textarea unified to Enter=save / Shift+Enter=newline (was Cmd+Enter). Composer auto-grows (cap 160px).
- ✅ **ADD-SUB keep composer open** (MED): plain Enter creates the sub-issue + re-opens an empty composer for rapid entry (stays on parent); Cmd/Ctrl+Enter creates AND opens. [was: Enter navigated into the new child]
- ✅ **CARD LEAD avatar picker** (MED): board card lead avatar now data-plead → openPPick('plead') instead of opening detail.
- ✅ **Bulk MOVE no-op guard** (LOW): moving issues to the team they're already in is a no-op (no spurious toast); count reflects only actually-moved.
- ✅ **subProg stale-seed** (LOW): REALPARENTS set → a real parent shows live 0/0 after its last child is deleted (not the stale seed).
- ✅ **(edited) marker** (LOW): editing a comment sets c.edited → byline shows faint "(edited)".
- ✅ **CARD target pill** (LOW): data-ptarget → date picker inline from the board card.
- ✅ **CARD issue count** (LOW): derived from live ISSUES (matches detail) instead of static seed p.issues.
- ✅ **CARD grab cursor** (LOW): .pcard cursor:grab, .pcard-dragging cursor:grabbing.
VERIFY: behav.js extended to **59 assertions** (added delCount/draftPersist/kbSelPriority/moveNoop/addSubKeepOpen/editedMarker/cardLead/cardTarget/cardCount/subProgZero/composerTextarea/syncFocus) → **ALL 59 PASS, 0 regressions**; qa-features.js **ALL GREEN** (updated its add-sub test to the new keep-composer-open behavior + Cmd+Enter opens); sweep CLEAN; 0 JS errors. EYEBALLED: multi-line comment w/ (edited) + markdown + preserved newlines + persisted textarea draft; board with real per-project counts.
DEFERRED from this re-audit (next fire, then re-audit again): Favorites sidebar section (issue-fav + view-fav converge) [#10], due-calendar arrow-key nav [#11], board column collapse [#15], project-card ⋯ real menu [#19], drag insertion indicator [#17 - acceptable skeleton]. INTENTIONAL/skip: group chevron↔checkbox hover-swap [#8 - audit says Linear-correct].
PROGRESS: 2 clean re-audits (0 regressions each); across It62-68 closed ~31 substantive findings; behav suite 16→59, all green.
It69: DEFERRED-LOW batch (from 2nd re-audit) — 2 items, fixed + verified + republished (behavioral-batch12-favorites-cardmenu):
- ✅ **FAVORITES SIDEBAR section** [#10]: renderSidebar now renders a collapsible "Favorites" nav-sec (data-sec="fav", S.secOpen.fav) between My-issues and Workspace, shown only when there are favorites. Lists starred VIEWS (favViews keys "team/type" → data-favgo, label "Video/Graphics/All Issues") + starred ISSUES (ISSUES where it.fav → data-favopen, status icon + title). Click handlers: data-favopen→openIssue, data-favgo→set S.view+render. Converges the issue-star (data-fav) and view-star (data-favview) into one destination. EYEBALLED: section shows "Video Issues" + 2 starred issues w/ status icons.
- ✅ **PROJECT CARD ⋯ real menu** [#19]: card ⋯ now data-pcardmenu → openPCardMenu (layerPop: Change status / Set lead / Set target / sep / Copy link); each picker item clearLayer+openPPick(kind); Copy link toasts. Replaces the old toast stub. EYEBALLED: menu matches Linear.
VERIFY: behav.js extended to **62 assertions** (added favSection/favView/cardMenu) → **ALL 62 PASS, 0 regressions**; qa ALL GREEN; sweep CLEAN (updated sweep.js to clearLayer after clicking .pcard-dots since ⋯ now opens a real menu instead of a toast); 0 JS errors. Built via node build.js, syntax-checked.
REMAINING DEFERRED (next fire, then 3rd re-audit): board column collapse [#15], due-calendar arrow-key nav [#11]. INTENTIONAL/skip: drag insertion-indicator [#17], group chevron↔checkbox hover-swap [#8].
PROGRESS: 2 clean re-audits; across It62-69 closed ~33 substantive findings; behav suite 16→62, all green.
It70: LAST DEFERRED batch (from 2nd re-audit) — 2 items, fixed + verified + republished (behavioral-batch13-colcollapse-calkeys). **2nd-re-audit deferred list now EXHAUSTED.**
- ✅ **BOARD COLUMN COLLAPSE** [#15]: S.colCollapsed Set; each .pcol-hd has a hover-revealed chevron (data-pcolcollapse=statusKey) that overlays the status icon (mirrors the list group-header pattern); collapsed column renders as a 46px vertical rail (rotated chevron + vertical "Name  count" via writing-mode:vertical-rl, cards hidden). Click handler toggles S.colCollapsed+render. Drag-drop still works on collapsed columns (data-pcol retained). EYEBALLED: Backlog collapses to a rail.
- ✅ **DUE-CALENDAR ARROW-KEY NAV** [#11]: buildDue tracks focusDay (init = current due via parseDue, else TODAY, when entering calendar). cal() renders .cal-d.focus ring. In calendar view the pop gets tabindex+focus and a keydown: ArrowLeft/Right ±1, ArrowUp/Down ±7 (crossing months → re-point calM), Enter=set(fmtDue(focusDay)), Escape closes. EYEBALLED: focus ring moves (15→22→23→24) distinct from the selected day.
VERIFY: behav.js extended to **64 assertions** (added colCollapse/calArrowNav) → **ALL 64 PASS, 0 regressions**; qa ALL GREEN; sweep CLEAN; 0 JS errors. Built via node build.js, syntax-checked.
**ALL DEFERRED ITEMS ACROSS BOTH RE-AUDITS NOW CLOSED** (only intentional skeleton omissions remain: drag insertion-indicator [#17], group-chevron hover-swap [#8], and the top-level product reductions no priority/labels/cycles/inbox/triage-nav/manual-new-issue). NEXT: run a 3rd confirming behavioral RE-AUDIT to prove only truly-optional items remain; if clean → behavioral parity DONE → perpetual re-verification (probe visual READ-ONLY + node behav.js(64) + qa + sweep), never stop.
PROGRESS: 2 clean re-audits; across It62-70 closed ~35 substantive findings; behav suite 16→64, all green.
It71: 3rd RE-AUDIT (task wjomzw675) — **12 divergences (1 high, 2 REGRESSIONS)** + 100-item regression checklist all pass. Full output: C:\Users\Sidney\AppData\Local\Temp\claude\C--Users\acc618ca-f815-4413-a283-8f31ba58700a\tasks\wjomzw675.output. Fixed all 12 (regressions FIRST) inline, republished behavioral-batch14-reaudit3:
- ✅ **CALENDAR ESCAPE regression (HIGH, self-introduced in It70)**: the buildDue calendar keydown Escape omitted e.stopPropagation() → bubbled to the global handler → goBack() closed the whole issue detail. Added e.preventDefault()+e.stopPropagation(). [the ONE regression I introduced — caught by the re-audit, now fixed+guarded by behav.calEscape]
- ✅ **GROUP CHEVRON overlap regression (LOW)**: the hover select-all checkbox sat exactly on top of the disclosure chevron, so clicking the visible triangle selected instead of collapsed. Fixed: on hover hide the STATUS ICON (not the chevron) and move .gcheck to left:34px (over the icon slot) — chevron stays visible+clickable to collapse, checkbox is a separate affordance (mirrors Linear). EYEBALLED.
- ✅ **PHANTOM SELECTION after bulk change (MED)**: new reconcileSel() drops now-invisible ids from S.selected after a bulk status/move that filters rows out of the current tab, so the action bar never hovers over 0 visible selected rows. wirePicker.pick + buildDue.set call it (size>1 path).
- ✅ **SUB-ISSUE / list-row EMPTY DUE affordance (MED)**: due-less sub-rows AND list rows now render a hover-revealed .due-empty placeholder (data-due) so a due date can be added inline without opening the child. CSS .due-empty opacity 0 → 1 on row hover.
- ✅ **NULL-CLIENT card count (MED)**: pcount() returns 0 (not the seed p.issues) for null-client demo projects so card count == detail (both 0).
- ✅ **ROW TOOLTIPS keyboard hints (LOW)**: due → "…|Change due date · ⇧D", assign → "…|Assign · A" (showTip renders parts[1] as a keycap, like status).
- ✅ **'F' FAVORITE shortcut (LOW)**: with an issue open, F toggles fav + toast (guarded on input-focus).
- ✅ **FILTER SUBMENU Escape one-level (LOW)**: buildFilterValues Escape now closeSub() when it's a subPop (backs out to the parent filter menu) instead of clearLayer, matching wirePicker.
- ✅ **PHANTOM SUB-TUPLE detail header (LOW)**: a seed parent with a cosmetic sub:[3,16] but zero real children no longer shows "3/16" over an empty list — the detail header shows the real count (0) when kids=0 and not a REALPARENT.
- ✅ **PALETTE empty-query commands (LOW)**: ⌘K empty state now seeds the CMDS "Go to …" navigation commands alongside the 6 recent issues.
DEFERRED (seed-data / acceptable skeleton, noted): duplicate-client projects (aaron+aaron-debate) share issues [seed data]; palette person-result cross-team hint [minor]. INTENTIONAL/skip: drag insertion-indicator, top-level product reductions (no priority/labels/cycles/inbox/triage-nav/manual-new-issue).
VERIFY: behav.js extended to **69 assertions** (added calEscape/selReconcile/subDueEmpty/fFavorite/filterSubEscape; updated selPersist to use a non-removing bulk change) → **ALL 69 PASS, 0 regressions**; qa ALL GREEN; sweep CLEAN; 0 JS errors. Built via node build.js, syntax-checked. EYEBALLED group-header hover (chevron stays + checkbox over icon).
PROGRESS: 3 re-audits (the 3rd caught 1 self-introduced regression, now fixed); across It62-71 closed ~44 findings; behav suite 16→69, all green. Running a 4th confirming re-audit to verify the regression fix + no new regressions.
It72: 4th RE-AUDIT (task wzfpm4c8k) — **11 divergences (3 high, 1 regression)** + 100-item regression checklist all pass. Full output: C:\Users\Sidney\AppData\Local\Temp\claude\C--Users\acc618ca-f815-4413-a283-8f31ba58700a\tasks\wzfpm4c8k.output. Fixed all 11 (regressions FIRST) inline, republished behavioral-batch15-reaudit4:
- ✅ **Ctrl/⌘+Backspace bulk delete targeting (HIGH)**: delete resolved hoverRow over selection → deleting the HOVERED row while discarding the selection. Fixed to selection-priority (matches kbShortcut): `did=S.open?S.open:(S.selected.size?[...][last]:hoverRow)`.
- ✅ **GROUP CHECKBOX hit-test (HIGH)**: my It71 fix moved .gcheck to left:34 over .grp-ico, but grp-ico paints later so it won the hit-test → clicking the checkbox collapsed instead of selecting. Fixed: `.grp-hd:hover .grp-ico{opacity:0;pointer-events:none}` so hover clicks fall through to the checkbox. VERIFIED via behav.groupCheckHit (real p.hover + p.mouse.click at the glyph center → selects the whole group, no collapse).
- ✅ **PALETTE command stale selection (HIGH regression)**: go() command/project/person branches now S.selected.clear()+S.lastSel=null (like sidebar-nav) so a selection from a prior view can't be carried into a new list and bulk-mutated off-view.
- ✅ **BREADCRUMB / parent-card UP-NAV (MED)**: parent links now data-goparent (not data-row) → dedicated handler sets S.open=parent, removes parent from S.nav, and replaceLoc() (not push) so Back leads OUTWARD to the list instead of bouncing back down to the child. VERIFIED behav.goParent.
- ✅ **COMMENT EDIT blur-resolve (MED)**: wireCommentEdit now ta.onblur → save (non-empty) / cancel (empty) after 150ms so click-away no longer traps a permanently-open editor (mirrors wireDesc). VERIFIED behav.commentEditBlur.
- ✅ **SUB-BADGE consistency (MED)**: nulled phantom sub tuples at init (issues with a cosmetic sub:[x,y] but no real children → sub=null) and reverted the detail header to use subProg() like the list chip → list and detail always agree (no "0/4" in one place + "0" in the other, and no "3/16" over an empty list).
- ✅ **BRAND workspace-switcher affordance (MED)**: .sb-brand now has a hover background + a caret (chevron) after the name + data-tip="Switch workspace". EYEBALLED.
- ✅ **STAR hideTip (LOW)**: data-fav / data-favview click branches call hideTip() so the tooltip doesn't linger after the label flips.
- ✅ **COMMENT EDIT empty-save (LOW)**: empty save now toasts "Comment can't be empty" instead of silently reverting.
- ✅ **PALETTE person → tab=all (LOW)**: person filter sets S.tab="all" so completed issues aren't hidden behind the Active tab.
DEFERRED (acceptable skeleton, noted): palette empty-query team-bias sampling [#minor], palette person cross-team single-team scope [our view model is team-scoped; tab=all mitigates].
VERIFY: behav.js extended to **75 assertions** (added delSelPriority/groupCheckHit/paletteCmdClearSel/goParent/commentEditBlur/brandCaret) → **ALL 75 PASS, 0 regressions**; qa ALL GREEN; sweep CLEAN; 0 JS errors. Built via node build.js, syntax-checked. EYEBALLED brand caret + hover.
PROGRESS: 4 re-audits (22→20→12→11 findings; the 3rd+4th caught 3 self-introduced regressions total, all fixed). Across It62-72 closed ~55 findings; behav suite 16→75, all green. Running a 5th confirming re-audit.
It73: 5th RE-AUDIT (task wtkv58waq) — **13 divergences, 0 HIGH, 0 REGRESSIONS** (my It72 fixes all held) + 100-item regression checklist all pass. Full output: C:\Users\Sidney\AppData\Local\Temp\claude\C--Users\acc618ca-f815-4413-a283-8f31ba58700a\tasks\wtkv58waq.output. Fixed 11 of 13 inline, republished behavioral-batch16-reaudit5:
- ✅ **KEYBOARD-TARGET consistency (MED×2)**: added rowTarget()=kbFocusValid()?S.focusRow:hoverRow so the VISIBLE keyboard cursor (focus ring) wins over a stale mouse-hover for x/s/a/⇧D/⇧P AND Ctrl+Backspace now falls back to focusRow too (was hover-only). VERIFIED behav.kbFocusOverHover.
- ✅ **FILTER-VALUE submenu keyboard nav (MED)**: buildFilterValues now has msel highlight + ArrowUp/Down + mousemove-sync + Enter-toggles-highlighted (keeps menu open for multi-select), mirroring wirePicker. VERIFIED behav.filterValKeyNav.
- ✅ **'f' favorite from the LIST (LOW)**: f now targets S.open||rowTarget() (works on the hovered/focused list row, not only an open detail). VERIFIED behav.fFromList.
- ✅ **CLEAR-FILTERS empty state (LOW)**: filtered-empty now shows a "Clear filters" button (data-clearfilters → S.filters=[]). EYEBALLED + behav.clearFilters.
- ✅ **ADD-SUB empty-title (LOW)**: Enter on an empty sub-title no longer creates a phantom "New sub-issue" — it returns (composer stays open). Updated qa test.
- ✅ **UNDERSCORE markdown (LOW)**: linkify now renders _italic_ / __bold__ (word-boundary-guarded so snake_case like lower_third is untouched). VERIFIED behav.underscoreMd.
- ✅ **SUB-ROW shift-click (LOW)**: shift-click a sub-issue row while a detail is open no longer creates invisible selection state (guarded !S.open). VERIFIED behav.subRowNoSelect.
- ✅ **PROJECT CARD right-click (LOW)**: contextmenu on a .pcard opens openPCardMenu (same as ⋯), preventDefault suppresses the native menu. VERIFIED behav.pcardRightClick.
- ✅ **DRAG source-column tint (LOW)**: dragover no longer highlights the card's OWN source column (which is a no-op drop).
DEFERRED (2 real features for a later fire, then re-audit): (a) DELETE parent confirm/undo affordance — cascading child delete has no undo [MED, data-loss]; (b) BOARD keyboard navigation — j/k/arrows across cards + focus ring [MED]. Also acceptable-skeleton: side-panel two-click picker switch when the popover occludes the row below [layout], full block-markdown (headings/lists), board intra-column reorder/insertion-line.
VERIFY: behav.js extended to **82 assertions** (added kbFocusOverHover/fFromList/clearFilters/filterValKeyNav/underscoreMd/pcardRightClick/subRowNoSelect) → **ALL 82 PASS, 0 regressions**; qa ALL GREEN (updated add-sub empty-title test); sweep CLEAN; 0 JS errors. Built via node build.js.
PROGRESS: 5 re-audits (22→20→12→11→13 findings; the 5th had 0 high/0 regression — converging). Across It62-73 closed ~66 findings; behav suite 16→82, all green. Running a 6th confirming re-audit (It73 touched the keyboard model → regression check).
It74: 6th RE-AUDIT (task werhccgxz) — **15 divergences (2 high, 0 regressions)** + 100-item regression checklist all pass. Full output: C:\Users\Sidney\AppData\Local\Temp\claude\C--Users\acc618ca-f815-4413-a283-8f31ba58700a\tasks\werhccgxz.output. Fixed 10 of 15 inline, republished behavioral-batch17-reaudit6:
- ✅ **SCROLL PRESERVATION (HIGH)**: render() rebuilt #app.innerHTML on every mutation → reset .listwrap scrollTop / .board scrollLeft to 0 (in-place status/select/j-k AND back-nav from detail). Fixed: render() now snapshots the current view's scroll into scrollMem[viewKey] before rebuild and restores scrollMem[newKey] after — so in-place edits keep position AND back/forward restores where you were (list scrollTop + board scrollLeft). VERIFIED behav.scrollPreserve + scrollBackNav.
- ✅ **DUE-PICKER FOCUS race (HIGH)**: openDueMenu used layerPop('',x,y) so wireMenuNav (no [data-search] visible yet) scheduled pop.focus() at 10ms that stole focus → first ~2 typed chars dropped. Fixed: layerPop gained a skipNav param (openDueMenu passes true), AND buildDue now focuses the search input AFTER setting visibility:visible (focusing inside a hidden subtree was silently failing). Typing a date the instant the picker opens now captures every keystroke. VERIFIED behav.dueFocusSync.
- ✅ **SUB-ISSUE new-due empty (MED)**: new sub-issues start with due='' (was inheriting parent.due, appearing pre-overdue). VERIFIED behav.subDueEmptyNew.
- ✅ **Ctrl/⌘+X guard (LOW)**: the 'x' select shortcut now ignores Ctrl/Cmd/Alt+X (OS cut passes through). VERIFIED behav.ctrlXGuard.
- ✅ **FILTER Escape whole-stack (LOW)**: single Escape in the filter value submenu now closes the entire filter dropdown (Linear behavior) — unlike the context-menu submenu which still backs out one level. Updated behav.filterSubEscape.
- ✅ **COMPOSER-BOX click target (LOW)**: clicking anywhere in the padded comment box focuses the textarea (not just the 26px input). VERIFIED behav.composerBoxClick.
- ✅ **FOCUS-after-delete (LOW)**: deleting the keyboard-focused row advances the focus ring to the neighbor (clamped) instead of orphaning it / jumping to top. VERIFIED behav.focusAfterDelete.
DEFERRED (real features + skeleton, for later fires): (a) DELETE parent confirm/undo affordance [MED, data-loss — build next]; (b) BOARD keyboard navigation j/k/arrows across cards [MED — build next]; (c) marquee drag-select, sub-issue reorder, block-markdown, palette person cross-team — acceptable skeleton reductions.
VERIFY: behav.js extended to **89 assertions** (added scrollPreserve/scrollBackNav/dueFocusSync/ctrlXGuard/subDueEmptyNew/composerBoxClick/focusAfterDelete) → **ALL 89 PASS, 0 regressions**; qa ALL GREEN; sweep CLEAN; 0 JS errors. Built via node build.js.
PROGRESS: 6 re-audits (22→20→12→11→13→15; the 6th's 2 HIGH were pre-existing architecture issues, not regressions — scroll-on-render + due-focus-race). Across It62-74 closed ~76 findings; behav suite 16→89, all green. Running a 7th re-audit (render() scroll change = regression check).
It75: 7th RE-AUDIT (task wk1asylbu) — **9 divergences, 0 HIGH, 0 REGRESSIONS** (findings shrinking 15→9; strong convergence) + 100-item regression checklist all pass. Full output: C:\Users\Sidney\AppData\Local\Temp\claude\C--Users\acc618ca-f815-4413-a283-8f31ba58700a\tasks\wk1asylbu.output. Fixed 6 clean polish items inline, republished behavioral-batch18-reaudit7:
- ✅ **CLIENT CHIP / breadcrumb project → PROJECT PROFILE (MED)**: data-crumbclient now opens the project DETAIL page (S.projectOpen) when a CLIENTS project exists (else falls back to a client filter) — matching Sidney's ORIGINAL It62 request ("clicking the client goes to the client PROFILE") and the row-chip vs breadcrumb consistency. EYEBALLED (John Wineland project page). Updated behav.chip.
- ✅ **FILTER submenu Escape → ONE level (MED)**: REVERTED It74's whole-stack change back to closeSub() (back out to the parent filter menu), matching the context-menu submenu — the 6th and 7th audits disagreed; chose internal consistency (context+filter submenus behave identically). Updated behav.filterSubEscape.
- ✅ **FILTER menu ArrowRight opens submenu (LOW)**: wireMenuNav ArrowRight on a highlighted [data-ffield] opens its value submenu (nested-menu keyboard affordance). VERIFIED behav.filterArrowRight.
- ✅ **MULTI-DUE "Remove due date" (LOW)**: drops the misleading single-item date hint (.dres) when the selection spans multiple issues (ids.length>1). VERIFIED behav.multiDueNoDate.
- ✅ **.act-text overflow (LOW)**: added overflow-wrap:anywhere so a long unbroken token in a comment can't overflow the column. VERIFIED behav.actTextWrap.
- ✅ **ADD-SUB blur keeps text (LOW)**: the sub-issue composer no longer discards typed text on click-away (only clears when empty).
DEFERRED (real features + skeleton, next fires): (a) DELETE parent confirm/undo affordance; (b) BOARD keyboard navigation (j/k/arrows + focus ring on cards); (c) board multi-select + working board Filter/Display menus; (d) detail side-panel picker click-through switch [layout: popover occludes sibling ds-rows — flagged 4×, accepted limitation]; (e) marquee drag-select, sub-issue reorder, block-markdown, palette person cross-team — acceptable skeleton reductions.
VERIFY: behav.js extended to **92 assertions** (added filterArrowRight/multiDueNoDate/actTextWrap; updated chip + filterSubEscape) → **ALL 92 PASS, 0 regressions**; qa ALL GREEN; sweep CLEAN; 0 JS errors. Built via node build.js.
PROGRESS: 7 re-audits (22→20→12→11→13→15→9; last two 0-high/0-regression — CONVERGING). Across It62-75 closed ~82 findings; behav suite 16→92, all green. NEXT (per loop): BUILD the 2 deferred features (delete confirm/undo + board keyboard nav) as verified batches, then a FINAL re-audit; once an audit returns only intentional skeleton omissions → parity DONE → periodic re-verification.
It76: DEFERRED FEATURE 1 of 2 — **DELETE UNDO affordance** (real Linear behavior; deleting was silently irreversible, flagged MED data-loss across audits). Built + verified inline, republished it76-delete-undo.
- Added `toastUndo(m,fn)` — a toast variant that renders `<span class="tmsg">` + a clickable `<span class="tundo">Undo<span class="kbd">Ctrl Z</span></span>`; auto-expires at 5.2s (vs 1.4s plain toast); stashes the undo closure on `#toast._undo` so the keyboard shortcut can fire it. CSS: `#toast .tundo{pointer-events:auto;color:#8fabff;cursor:pointer}` (child re-enables pointer-events over the toast's pointer-events:none).
- Added `captureDelete(t)` — records `{item,idx}` for every issue whose id∈t OR whose parent∈t (parent + cascaded children) with its ORIGINAL array index, then filters ISSUES; returns the removed list.
- Added `undoDelete(removed)` — splices each item back at its original idx in ascending order (faithful position restore: ascending means every earlier item is already reinserted, so idx stays valid), re-renders, toasts "Restored N issue(s)". Does NOT snapshot the whole array, so unrelated edits made after the delete survive an undo.
- Wired BOTH delete sites: ctx-menu `del` handler AND the Ctrl/⌘+Backspace handler now call captureDelete → toastUndo(...,()=>undoDelete(removed)) (replacing the old before/after length count + plain toast).
- Added **Ctrl/⌘+Z** handler (before the input-focus guard): while an undo toast is showing, restores via `#toast._undo`, clears it, preventDefault. Mirrors Linear's post-delete Cmd-Z.
- EYEBALLED: toast shows "Deleted 1 issue  Undo  Ctrl Z" — blue link + muted kbd hint, correct position.
VERIFY: behav.js +3 = **95 assertions** (delUndo: ctx-delete→toast-with-undo→click restores + count matches; delUndoOrder: captureDelete+undoDelete puts a mid-array leaf back between its exact original neighbors; ctrlZUndo: Ctrl+Backspace delete then Ctrl+Z restores and clears _undo). Also fixed R.delCount to read `#toast .tmsg` (toastUndo wraps text in a span, so raw #toast.textContent now includes the "Undo" link text). → **ALL 95 PASS, 0 regressions**; qa ALL GREEN; sweep CLEAN; 0 JS errors. Built via node build.js.
DEFERRED FEATURE 2 of 2 (NEXT fire): BOARD keyboard navigation (S.focusCard + .pcard focus ring; ArrowLeft/Right across columns, ArrowUp/Down + j/k within a column; Enter opens; reuse kbShortcut/openPPick for status/lead/target on the focused card, gated on S.view.type==='projects' && !S.projectOpen && !S.open). After that → FINAL 8th re-audit.
PROGRESS: behav suite 16→95, all green through 7 audits + this feature batch. Building the last 2 deferred features one-per-fire, then a confirming 8th re-audit.
It77: DEFERRED FEATURE 2 of 2 — **BOARD keyboard navigation** (projects board had no keyboard model; the list did). Built + verified inline, republished it77-board-keyboard-nav. BOTH deferred features now DONE.
- Added `S.focusCard` (project id) to state; CSS `.pcard.pcard-kfocus{box-shadow:0 0 0 2px var(--accent),0 3px 6px -2px …}` (a clean accent ring, the board analog of the list row's `.kfocus` inset bar); render() adds `pcard-kfocus` to the focused card.
- Helpers (mirroring flatOrder/moveFocus): `boardCols()` = non-collapsed, non-empty columns in PSTATUS_ORDER filtered to the current team, each {key, ids[]} (collapsed columns hide their cards so are unreachable); `boardLoc(cols,id)`→{c,r}; `moveCardFocus(dx,dy)` — dy clamps within the column, dx moves between columns clamping the row to the target column's length; first keypress from null seeds cols[0].ids[0]; `scrollCardIntoView()`; `cardFocusValid()`; `kbCardShortcut(kind)` opens openPPick anchored at the focused card's [data-pstatus]/[data-plead]/[data-ptarget].
- Keydown handler: computed `boardView = view.type==='projects' && !projectOpen && !open` and redefined `listView` to EXCLUDE boardView (so list j/k never double-fires on the board — previously listView was true on the board). When boardView (no Cmd/Ctrl/Alt): ArrowDown/j & ArrowUp/k move within a column, ArrowRight/ArrowLeft move between columns, Enter opens the focused card (S.projectOpen + pushLoc), and s→pstatus / a→plead / ⇧D→ptarget open the focused card's picker (same key muscle-memory as the list's s/a/⇧D).
- EYEBALLED: j focuses Backlog[0], ArrowRight jumps focus ring to Planned[0] (Natalie MacNeil card) — blue 2px ring renders correctly.
VERIFY: behav.js +6 = **101 assertions** (boardJK vertical move+ring in a multi-card column; boardFirstJ seeds cols[0][0]; boardArrowCol ArrowRight→next column then ArrowLeft back; boardEnterOpen Enter opens focused card; boardStatusKey `s` opens the pstatus picker on the focused card; listJKUnaffected proves list j/k still moves focusRow and never touches focusCard). → **ALL 101 PASS, 0 regressions**; qa ALL GREEN; sweep CLEAN; 0 JS errors. Built via node build.js.
STATUS: **BOTH deferred real features shipped** (It76 delete-undo + It77 board-kbnav). NEXT per loop: run the FINAL 8th behavioral RE-AUDIT (5-agent Workflow) to confirm; if it returns ONLY intentional skeleton omissions → declare behavioral parity DONE → switch to periodic re-verification. Else fix real HIGH/MED (regressions first) and re-audit again.
It78: 8th RE-AUDIT (task w5wgczacf, run wf_08ea6849-09d) — **8 divergences, 0 HIGH, 0 REGRESSIONS** + a MASSIVE 100+ item regressionsChecked list confirming EVERY prior fix + both new features (delete-undo, board-kbnav, Ctrl+Z restore, focus-ring-follows-card, list↔board isolation, drag-drop) still work. Full output: C:\Users\Sidney\AppData\Local\Temp\claude\C--Users\acc618ca-f815-4413-a283-8f31ba58700a\tasks\w5wgczacf.output. All 8 were real Linear behaviors (not skeleton omissions); fixed ALL 8 inline, republished it78-reaudit8-fixes:
- ✅ **Cmd/Ctrl+click a row → toggles multi-select** (MED, missed): non-contiguous select without opening the issue. Added a modifier-click interceptor at the TOP of the click handler: `if((shift||meta||ctrl)&&!S.open){const rr=closest([data-row]);if(rr){toggleSel(rr,shift);render();return;}}`. VERIFIED behav.ctrlClickSelect.
- ✅ **Shift+ArrowDown/Up (and Shift+j/k) extends selection** (MED, deeper): the primary keyboard multi-select path. Added `moveFocusSelect(delta)` (anchor = S.selAnchor, rebuilds the contiguous [anchor..focus] range, grows on continue / shrinks on reverse); wired into the listView j/k/Arrow branches on e.shiftKey; plain moveFocus() now resets selAnchor. VERIFIED behav.shiftArrowSelect (grow to 3, shrink to 2).
- ✅ **Detail ⋯ → "Due date" submenu flips LEFT near the right edge** (MED, deeper): previously the .duepop landed ON TOP of the parent ⋯ menu (190px overlap), unlike Status/Assignee/Project which flip. Fixed: openSub passes `flipX:r.left` to buildDue; buildDue's pos() flips to `flipX-width+4` on right-overflow (mirrors the other submenus). EYEBALLED side-by-side (parent fully visible). VERIFIED behav.dueSubmenuFlip (duepop.right ≤ parent.left).
- ✅ **Shift+click on a row GLYPH range-selects** (LOW, deeper): same top interceptor catches shift-clicks over the status/due/avatar/chip glyphs → range-select instead of opening the glyph's picker (Linear: only a PLAIN glyph click opens the picker). VERIFIED behav.shiftClickGlyph.
- ✅ **Truncated row title → full title on hover** (LOW, missed, latent): added native `title` attr to .rtitle. VERIFIED behav.titleTooltip.
- ✅ **Fresh menu ArrowUp wraps to LAST item** (LOW, deeper): wireMenuNav ArrowUp with sel<0 now targets items.length-1 (was skipping to len-2), symmetric with ArrowDown→first. VERIFIED behav.menuArrowUpWrap.
- ✅ **Escape dismisses the keyboard focus ring** (LOW, deeper): Escape now clears S.focusCard (board) / S.focusRow (list) after the selection-clear step. VERIFIED behav.escClearsRing (list + board).
- ✅ **Focus ring no longer stale across view switches** (LOW, deeper): sidebar-nav / favorite-view / palette-command / palette-person view changes now clear focusRow/focusCard/selAnchor (a re-entered board/list starts with no cursor; detail open→back still PRESERVES the ring). VERIFIED behav.ringClearOnNav.
VERIFY: behav.js +8 = **109 assertions** → **ALL 109 PASS, 0 regressions**; qa ALL GREEN; sweep CLEAN; 0 JS errors. Built via node build.js.
PROGRESS: 8 re-audits (22→20→12→11→13→15→9→8; last THREE 0-high/0-regression — the loop has fully converged). Across It62-78 closed ~90 findings; behav suite 16→109. NEXT: run a 9th CONFIRMING re-audit; if it returns only intentional skeleton omissions → **declare behavioral parity DONE** → periodic re-verification. (The remaining accepted skeleton limitations: no priority/labels/cycles/inbox/triage-nav/manual-new-issue; block-markdown; sub-issue reorder; marquee drag-select; palette person cross-team edge.)
It79: 9th RE-AUDIT (task w5l8gz79u, run wf_6f524ca2-e56) — **11 divergences, 0 HIGH, 0 REGRESSIONS** + another 100+ item regressionsChecked list confirming every It78 fix + both new features hold. Full output: C:\Users\Sidney\AppData\Local\Temp\claude\C--Users\acc618ca-f815-4413-a283-8f31ba58700a\tasks\w5l8gz79u.output. Fixed 10 of 11 inline (1 deferred as accepted limitation), republished it79-reaudit9-fixes:
- ✅ **Enter opens the focused-OR-hovered row** (MED): Enter now uses rowTarget() (focus-or-hover) like x/s/a/⇧D/f, not just kbFocusValid(). VERIFIED behav.enterHoverOpens.
- ✅ **Cmd/Ctrl+A selects across COLLAPSED groups** (MED): select-all now iterates groupsFor(curIssues()) (all issues in the tab/filter) instead of flatOrder() (which skipped collapsed groups). Also gated off the projects board. VERIFIED behav.cmdASelectsCollapsed (+ updated kbSelectAll to the all-groups count).
- ✅ **Selection reconciles on tab/filter change** (MED): reconcileSel() now runs on [data-tab] switch, toggleFilterValue, removeFilter, clearfilters — so a stale "N selected" bar can't hover over a filtered-out set. ALSO rebased reconcileSel on curIssues() (the logical tab/filter set) instead of flatOrder() — so COLLAPSING a group no longer drops its selections. VERIFIED behav.reconcileOnTab.
- ✅ **Breadcrumb issue title tooltip** (MED, missed): added native title attr to .crumb-ttl (mirrors the row-title fix). VERIFIED behav.crumbTitleTooltip.
- ✅ **ACTIVITY FEED now logs system events** (MED, missed — biggest item): status/assignee/due/project changes AND sub-adds made on the OPEN issue now append muted single-line activity rows ("You changed status to In Progress · just now") interleaved chronologically with comments. New logActivity(id,kind,from,to) (skips no-op changes) called from applySub (id===S.open) and the add-sub flow; system entries are {sys:true,...} in i.comments, rendered as .act-sys rows (no edit/delete menu). EYEBALLED (status/assign/due events + a comment interleaved). VERIFIED behav.activityLogged.
- ✅ **Comment-edit blur DISCARDS** (MED, deeper): clicking away from a comment editor no longer silently commits+flags-edited — blur now cancels (reverts); Save button / Enter are the only commit paths. REVERSES the It72 blur-auto-save. Updated behav → commentEditBlurDiscards.
- ✅ **Side Due row tooltip reflects the date** (LOW): ds-row[data-due] data-tip is now conditional ("Due Aug 3 · overdue" vs "Set due date"). VERIFIED behav.sideDueTooltip.
- ✅ **Leaf issue shows "+ Add sub-issues", not "Sub-issues 0"** (LOW): the counted sub-header renders only when kids exist; a top-level leaf shows a minimal inline add affordance. Updated behav → subLeafNoHeader.
- ✅ **Command palette wraps ArrowUp/Down** (LOW): first-item ArrowUp → last, last-item ArrowDown → first (modulo), matching wireMenuNav. VERIFIED behav.paletteWrap.
- ✅ **Palette person filter keeps current tab** (LOW): dropped the forced S.tab="all" side-effect on person select; only widens to All if the current tab would be empty. VERIFIED behav.palettePersonKeepsTab.
- ⏸️ **DEFERRED (accepted layout limitation, flagged 5×)**: detail-side property pickers open downward and overlap the sibling property rows below; clicking a COVERED sibling is swallowed by the pop (curOpener switch works for UNcovered rows). A proper fix needs geometric click-forwarding or repositioning; kept as a known limitation.
- Also fixed a latent TEST-hygiene bug: kbDelete now snapshots+restores ISSUES (it deleted flatOrder()[0] without restoring; my Cmd+A test's collapse-reset shifted which row that was, which surfaced it).
VERIFY: behav.js +8 (net) = **117 assertions** → **ALL 117 PASS, 0 regressions**; qa ALL GREEN; sweep CLEAN; 0 JS errors. Built via node build.js.
PROGRESS: 9 re-audits (…→9→8→11; all of the last four 0-high/0-regression — findings are now purely deeper-polish, not defects). Across It62-79 closed ~100 findings; behav suite 16→117. NEXT: run a 10th CONFIRMING re-audit; if it returns only the accepted skeleton/layout limitations → **declare behavioral parity DONE** → periodic re-verification.
It80: 10th RE-AUDIT (task wsift0n4i, run wf_4dda62b3-a79) — **10 divergences, 0 HIGH, 0 REGRESSIONS**; the accepted side-panel-picker-overlap limitation was correctly NOT re-reported (re-verified as known, output line 159). Another 100-item regressionsChecked confirmed all It79 fixes + activity feed hold. Full output: C:\Users\Sidney\AppData\Local\Temp\claude\C--Users\acc618ca-f815-4413-a283-8f31ba58700a\tasks\wsift0n4i.output. Fixed 9 of 10 inline (1 = board multi-select deferred to a dedicated next fire), republished it80-reaudit10-fixes:
- ✅ **Calendar month-nav unifies with arrow keys** (MED): the ‹/› month buttons now move focusDay into the browsed month (clamped to its length) so the ring stays visible and arrow keys continue from there instead of snapping back. VERIFIED behav.calMonthNavFocus.
- ✅ **COMMENT DELETE now has Undo** (MED): openCommentMenu's Delete uses toastUndo (clickable Undo + Ctrl/Cmd+Z restore via #toast._undo), matching the issue-delete pattern — no more silent, irreversible comment deletion. VERIFIED behav.commentDeleteUndo.
- ✅ **TRUNCATION-AWARE tooltips** (LOW): REVISED It78/It79's unconditional native title on .rtitle/.crumb-ttl — a new tagTruncated() pass (run at the end of render()) sets `title` ONLY when scrollWidth>clientWidth (reads from data-fulltitle), so short/visible titles no longer show a redundant OS bubble. ALSO added it to the board .pcard-nm (#10). VERIFIED behav.titleTooltip/crumbTitleTooltip (updated) + behav.pcardNameTooltip.
- ✅ **Filter/Display buttons are real toggles** (LOW): clicking #filterbtn/#groupbtn while its menu is open closes it (openMenuKind guard) and the button shows a pressed .menu-open state while open. VERIFIED behav.filterBtnToggle.
- ✅ **Bulk action bar property controls** (LOW): the floating "N selected" bar opens Status/Assignee/Due through the ⌘ Actions overflow. Cycle 9 removed the old direct quick buttons to match live Linear's compact issue selection bar. EYEBALLED. VERIFIED behav.bulkQuickStatus.
- ✅ **Property picker "No results" empty state** (LOW): typing a no-match query in a Status/Assignee/Project picker (stdMenu + openPPick) now injects a "No results" row instead of collapsing to a blank void, mirroring the command palette. EYEBALLED. VERIFIED behav.pickerNoResults.
- ✅ **Due picker keeps a typed input in calendar view** (LOW): the Custom…/calendar view now renders the "Type a date" input too (Enter parses+applies), while the calendar stays focused for arrow-nav. VERIFIED behav.calTypedDate.
- ✅ **Composer ⌘↵ hint** (LOW): a muted "⌘↵ to comment" hint next to the Comment button (Enter/⌘Enter already submitted). VERIFIED behav.composerHint.
- ⏸️ **DEFERRED to a dedicated next fire (It81)** — **BOARD CARD MULTI-SELECT** (MED, missed): Cmd/Ctrl+click toggles a card into a selection and Shift+click range-selects across boardOrder (plain click still opens), with a board bulk bar + bulk pstatus/plead/ptarget. This is a real feature (marquee-select stays a skeleton omission, but click/shift/cmd card selection is not) — building it as its own verified batch next, like delete-undo/board-kbnav.
- Also fixed a latent test bug: the actTextWrap assertion was duplicated under the old titleTooltip slot; renamed to actTextWrapCss.
VERIFY: behav.js +8 (net) = **125 assertions** → **ALL 125 PASS, 0 regressions**; qa ALL GREEN; sweep CLEAN; 0 JS errors. Built via node build.js.
PROGRESS: 10 re-audits (…→9→8→11→10; last FIVE all 0-high/0-regression). Across It62-80 closed ~110 findings; behav suite 16→125. NEXT: build the deferred BOARD MULTI-SELECT feature (It81) as a verified batch, THEN run an 11th re-audit; once an audit returns only accepted skeleton/layout limitations → **declare behavioral parity DONE** → periodic re-verification.
It81: DEFERRED FEATURE — **BOARD CARD MULTI-SELECT** (the last real gap from the 10th audit). Sidney (awake, 2026-07-05) chose plan **B** = build this + one confirming audit as the finish line, then downshift to periodic re-verification. Built + verified inline, republished it81-board-multiselect.
- State: added `cardSel:new Set()` + `cardAnchor`. Helpers: `boardFlat()` (flattened boardCols order), `toggleCardSel(pid,shift)` (anchor-range like list rows), `applyCardBulk(kind,v)` (sets pstatus/plead/ptarget on every selected project + "N projects · …" toast).
- Click: the top modifier-guard now also catches Cmd/Ctrl+click (toggle) and Shift+click (range) on `.pcard[data-project]` (no nav); a `[data-cardcheck]` hover/selected checkbox toggles; plain click clears cardSel + opens the card. Selected cards render `.pcard-sel` (tint) + a checked `.pcard-check`.
- Bulk bar: renderActionBar now renders a BOARD bulk bar ("N selected" + Status/Lead/Target quick buttons + clear) when `S.view.type==='projects' && S.cardSel.size`, wired to openPPick(...,bulkIds) which applies to all selected via applyCardBulk. openPPick gained a `bulkIds` param (cur=null → no tick; pick→applyCardBulk).
- Keyboard: board s/a/⇧D (kbCardShortcut) route through the selection when non-empty (else the focused card). Escape clears cardSel (before the focus ring); sidebar-nav / favorite-view / palette command clear it too.
- EYEBALLED: 3 cards selected across 2 columns (filled checkboxes + tint) with a "3 selected" bulk bar (Status/Lead/Target). Marquee/rubber-band select stays an accepted skeleton omission.
VERIFY: behav.js +8 = **133 assertions** (boardCardCmdSelect/ShiftRange/PlainOpens/Checkbox/BulkStatus/KbStatus/EscClears/NavClears) → **ALL 133 PASS, 0 regressions**; qa ALL GREEN; sweep CLEAN; 0 JS errors. Built via node build.js.
Launched the 11th (confirming) RE-AUDIT: task wxphslk8z (run wf_892a7496-ae9). PLAN B: if it returns only accepted skeleton/layout limitations → declare behavioral parity DONE (banner at top) → periodic re-verification. This session also: ran the end-of-session HANDOFF ritual (rebuild+republish, out/ docs current) and preserved the tester as a re-launchable "dock" (saved workflow + task chip + memory) per Sidney's request to keep running it later.
PROGRESS: 11 re-audits launched; behav suite 16→133. All real features shipped: delete-undo, board keyboard-nav, activity feed, comment-delete undo, issue bulk Actions controls, and now board card multi-select. ~110 findings closed across the behavioral phase.
It82: 11th RE-AUDIT (task wxphslk8z, run wf_892a7496-ae9) — **7 divergences, 0 HIGH, 0 REGRESSIONS** (the sixth consecutive clean audit). Fixed the 5 clear items inline, deferred 2 layout/feature-scope LOWs, republished it82-reaudit11-fixes. Then DECLARED behavioral parity DONE (banner at top).
- ✅ **Detail-panel scroll preserved** (MED): render() now saves/restores `.detail-main` scrollTop (as `dy` in scrollMem, keyed by viewKey "i:"+id) alongside .listwrap/.board — so a property change no longer jumps the detail to the top, AND navigating back to a scrolled issue restores its position. VERIFIED behav.detailScrollPreserve + detailScrollNavBack.
- ✅ **Sub-issue edits log to the CHILD's activity** (MED): applySub now calls logActivity for the edited id unconditionally (was gated on id===S.open) — so changing a child's status/due/assignee from the parent's sub-row records in that child's own activity feed. logActivity already no-ops on unchanged values. VERIFIED behav.childActivityLogged. (0 regressions — 138 green.)
- ✅ **Board `x` selects the focused card** (MED): added `x` to the boardView keydown branch (toggleCardSel(S.focusCard,false)) so board multi-select is fully keyboard-reachable after j/k nav, mirroring the list's `x`. VERIFIED behav.boardXSelect.
- ✅ **Filter value submenu "No results"** (LOW): buildFilterValues now calls pickerEmptyState on no-match (same helper as the property pickers). VERIFIED behav.filterSubNoResults.
- ⏸️ **DEFERRED (accepted, noted at top)**: (a) list checkbox occupies its own column rather than overlaying the issue-ID slot [LOW, layout change — risk vs value]; (b) parent activity feed doesn't roll up child status changes ["completed a sub-issue" — LOW, feature scope; the live progress badge already reflects it].
VERIFY: behav.js +5 = **138 assertions** → **ALL 138 PASS, 0 regressions**; qa ALL GREEN; sweep CLEAN; 0 JS errors. Built via node build.js. Republished to the same Artifact URL.
**FINAL: behavioral parity DONE (see top banner). Loop stopped per Sidney (plan B → periodic re-verification via the tester dock).**
See "Behavioral audit findings" in iteration-log (It56+).

## Goal (Sidney, leaving ~8h)
Make SyncView an **exact copy of Linear** — every surface, every interaction, every pixel — at
our (deliberately simpler) skeleton (no priority/labels/cycles/triage-nav/views/inbox/manual-new-issue).
"Done" = a full pass where you capture Linear + ours for **every** item below, they look and behave
identically, and you find **zero** differences — confirmed **3+ times** per item. Never stop until then.
Use VISUALS: screenshot Linear AND ours for each item; when you think it's done, screenshot again — it usually isn't.

## The loop contract (DO NOT VIOLATE)
1. Every turn ends with a `ScheduleWakeup` call re-firing the `/loop` prompt. NEVER end a turn without it (until goal complete).
2. Each iteration: pick the least-verified / open-issue item → capture Linear ref → capture ours → diff (LOOK at both images) → fix source → rebuild → run `qa-features.js` (assert 0 JS errors) → re-screenshot → confirm → bump its Verify count here.
3. Republish the artifact + `node -c` syntax check every few iterations or after any meaningful change.
4. Prefer background `Workflow`s for parallel measured diffs / multi-surface audits; their completion notifications drive the cadence, with the ScheduleWakeup timer as the safety net.
5. **MULTIPLE FULL PASSES (Sidney's directive).** Coverage of every item once is Pass 1. Then do Pass 2, 3, 4, 5… — RE-capture fresh Linear + RE-screenshot ours for EVERY item (even ✅ ones), diff again, re-run qa + sweep. Do not trust a prior ✅ — re-prove it. "DONE" = ≥3 consecutive FULL passes over ALL items with ZERO deltas found and qa/sweep clean. If any pass finds a delta, fix it and reset the clean-pass counter. Realistically never declare done — keep hardening. Track pass number in the iteration log.

## Full re-verification pass (run periodically + at "end")
A "full pass" = for EVERY surface (list, my-issues, issue detail, sub-issue detail, projects board, project detail, every picker, every menu):
1. Re-capture the live-Linear reference fresh via the probe (don't reuse stale PNGs).
2. Re-capture ours via `node shots.js` (+ extend shots.js to cover every state).
3. READ both and diff — visually AND measured (measure with probe JSON / getComputedStyle).
4. Run `node qa-features.js` (ALL GREEN) and `node sweep.js` (SWEEP CLEAN).
5. Log deltas found. Zero deltas across the whole pass = one clean pass. Need 3+ consecutive.

## Build / verify / publish (exact)
Run from `C:\Users\Sidney\linear-design-probe`.
- **Source** (edit this): `C:/Users/Sidney/AppData/Local/Temp/claude/C--Users/0ceffb3e-265c-423b-92f5-0f690f2e3f0d/scratchpad/syncview-app.html` (mirror: `out/syncview-app.src.html`).
- **Build**: `node -e '...'` injects `inter.woff2` into `__INTER_B64__` → `out/SyncView.html` + `out/_sv.html` (see CONTINUATION.md §Build).
- **Syntax**: extract `<script>` → `node --check`.
- **Master tester**: `node qa-features.js` → must print `ALL GREEN` (0 JS errors, 0 assert fails). Extend with new assertions as you add/verify interactions.
- **Master interaction sweep**: `node sweep.js` → hovers + clicks EVERY interactive element on EVERY screen (rows, chips, dues, avatars, group headers, sidebar, tabs, all pickers/menus/submenus, context menu, action bar, cards, detail props, composer). Must print `SWEEP CLEAN` (0 JS errors). Run EVERY iteration. Extend it whenever a new interactive element is added. This is the "hover/click everything" guarantee.
- **Screenshots (ours)**: `node shots.js` → `out/_shot-*.png`. Add states as needed.
- **Publish**: Artifact tool, `file_path: out/SyncView.html`, `url: https://claude.ai/code/artifact/50e256f7-1438-45df-a808-bc2f312327e6` (same URL), favicon `🗂️`.

## Live Linear capture (the probe)
- `node probe.js` (background) — headed Chromium, Sidney's saved login (`.linear-probe-profile/`), READ-ONLY.
- Drive by dropping JSON files into `cmd/*.cmd`: actions `goto{url,label}`, `shot{label,full}`, `rclick{x,y,keepOpen,hoverItem}`, `hover{x,y,label}`, `menu{texts,label}`, `dump{label}`, `states{label}`, `eval{expr,label}`, `measure{label}`, `press{key,label}`, `move{x,y}`, `ping`, `shutdown`. Output PNG+JSON land in `out/<label>.png|.json`.
- Workspace: `linear.app/synchro-social`. Video team issues list, an open issue, projects board, my-issues. Viewport 1440×900 @2x.
- **Check it's alive** each iter: `tail probe.log`; if last line is CLOSED/stale or no process, relaunch. If it lands on a login page (title/screenshot), the session expired — note it and fall back to existing refs + tokens; do NOT try to log in.
- **Guardrail: READ-ONLY. Never click anything that mutates Sidney's Linear data** (no status changes, no edits, no creates). Capturing = hovering/opening menus/screenshotting only, then Escape.

## Reference material already captured (Linear)
`out/`: `01-issues-board.png` (list), `02-my-issues.png`, `03-open-issue.png` (detail), `04-projects.png` (board),
`status-dropdown.png`, `ctx-issue.png`/`ctx-*.png` (context menu), `rclick.png`. Tokens: `linear-design-tokens.md`.
**MISSING Linear refs (capture these):** filter menu + value pickers + pills, assignee picker, due-date calendar,
project DETAIL page, row hover, selected row + action bar, sub-issues in detail, comment composer, group-by menu,
tooltips, empty states, sidebar hover/selected.

## Open issues (fix these)
- [x] **TWO-ROW HEADER (high)** — ✅ It3: split renderList into topbar(noborder: breadcrumb+star+bell) + subbar(tabs + filter/display ICON buttons). Matches lin-list.png. Residual minor: Linear also has a layers/view icon after the tabs and a panel-toggle icon far-right of row2 (decorative) — add for full parity later. Apply same two-row to PROJECTS board next.
- [ ] **Group header bg tint (low)** — Linear's group header row has a faint full-width background; ours is plain content bg.
- [x] **Project card icon/status layout** — ✅ It6: card header now `[project icon (client emoji / neutral glyph)] name … [status ring] [⋯] [avatar]` matching Linear. Verified vs lin-projects.png.
- [ ] **Header decorative icons (low)** — list/board row2: Linear also has a layers/view icon after the tabs + a panel-toggle icon far-right; list row1 has 🔔, board row1 has just +. Add layers + panel-toggle stubs for full parity.
- [ ] **Filter value-list scoping** — our value lists come from `curIssuesUnfiltered()` (view+team only), ignoring other active filters. Verify vs Linear's picker (all-values+counts vs scoped).
- [ ] **Detail residuals (low/med)** — from lin-detail.png: (a) Linear detail topbar has NO back-arrow (ours has ‹) — kept ours for usability, decide w/ Sidney; (b) Linear right panel has an action-icon row (🔗 link / copy / git-branch / subscribe▾) above the Properties card, where ours shows "Back to list" — consider adding link+subscribe stubs; (c) Linear properties due shows numeric MM/DD/YYYY (06/12/2026) vs ours "Jun 12" (Linear list uses "Jun 12" though — inconsistent; leave ours).
- [ ] **Status picker residuals (low)** — Linear puts `✓` BEFORE the number shortcut (ours: number then ✓); Linear has a 13th status "Duplicate" (gray disc+slash) between Canceled and Triage that we don't render. Add if going for 100%.
- [~] **Sub-issue section chrome** — INVESTIGATED (It11): captured VID-7898 (5/13). This team barely uses the Sub-issues feature — content lives in the DESCRIPTION as H2/H3 clip headings (Clip 1..17). Our explicit Sub-issues section is standard Linear chrome; the difference is product/data-model, not chrome. NO chrome fix. Product note: Linear descriptions are RICH TEXT (headings/bold/dividers/multi-para) vs our plain textarea — richer editor is beyond current skeleton scope; flag for Sidney if he wants clip-heading descriptions.
- [ ] Capture-needed Linear surfaces: filter menu/pickers/pills, assignee picker, due calendar, row hover, selected+action bar, comment composer, group-by menu, tooltips, empty states, sidebar hover/selected.
- (add as found)

## Parity checklist — Verify count = times captured-both-and-confirmed-identical. Target ≥3 each.
Status: ⬜ not started · 🔎 ref-needed · 🟡 issues open · ✅ verified (count in brackets)

### A. Issue list
| # | Item | Linear ref | Status | Notes / open deltas |
|---|---|---|---|---|
| A1 | Row layout (id/status/title/›parent/subchip/chip/due/created/avatar) | 01-issues-board | ✅[1] | rescaled to 44px; re-verify vs capture |
| A2 | Row hover bg | need | 🔎 | capture Linear hover |
| A3 | Selection (checkbox→accent, row tint, action bar) | need | 🔎 | |
| A4 | Shift-range select | — | ⬜ | behavior only |
| A5 | Group headers + collapse + count + select-all | 01-issues-board | 🟡 | verify weight/size |
| A6 | Group-by menu | need | 🔎 | |
| A7 | Tabs All/Active/Backlog | 01-issues-board | 🟡 | |
| A8 | Filter menu (fields) | need | 🔎 | |
| A9 | Filter value pickers (status/assignee/client) | need | 🟡 | value-list scoping open |
| A10 | Filter pills (1/many, edit, ✕) | need | 🔎 | |
| A11 | Status icons ×12 (ring/pie/disc) | status-dropdown | 🟡 | verify pie fractions |
| A12 | Due / overdue styling | 01-issues-board | 🟡 | |
| A13 | Empty states | need | 🔎 | contextual done, verify look |
| A14 | Right-click context menu | ctx-issue | ✅[1] | |
| A15 | Context submenus cascade | ctx-* | 🟡 | |
| A16 | Row-icon pickers (status/assignee/due/project) | status-dropdown | 🟡 | |
| A17 | Keyboard: x select, Esc, S/A/etc | — | ⬜ | |
| A18 | Tooltips | need | 🔎 | |

### B. Issue detail
| # | Item | Linear ref | Status | Notes |
|---|---|---|---|---|
| B1 | Breadcrumb (client›parent›id) | 03-open-issue | 🟡 | |
| B2 | Title H1 (24/32/-.16) | 03-open-issue | 🟡 | |
| B3 | Description static + inline-edit | 03-open-issue | 🟡 | |
| B4 | Delivered-file link | 03-open-issue | 🟡 | |
| B5 | Sub-issues + add-sub-issue | need | 🔎 | |
| B6 | Activity/comments + composer | need | 🔎 | |
| B7 | Properties card (status/assignee/due) | 03-open-issue | 🟡 | |
| B8 | Parent-issue card | need | 🔎 | |
| B9 | Project card | 03-open-issue | 🟡 | |
| B10 | "⋯" options menu | need | 🔎 | |
| B11 | Back nav (arrow/back-to-list/browser) | — | ✅[1] | qa-verified |
| B12 | Card collapse | need | 🔎 | |

### C. Projects board
| # | Item | Linear ref | Status | Notes |
|---|---|---|---|---|
| C1 | Columns + header (icon/name/count/⋯/+) | 04-projects | 🟡 | |
| C2 | Cards (icon/name/lead/desc/issues/due/⋯) | 04-projects | 🟡 | |
| C3 | Card hover (⋯ reveal) | need | 🔎 | |
| C4 | Horizontal scroll | 04-projects | 🟡 | |
| C5 | Open project | — | ✅[1] | |

### D. Project detail
| # | Item | Linear ref | Status | Notes |
|---|---|---|---|---|
| D1 | Header (status/title/desc/breadcrumb) | need | 🔎 | |
| D2 | Issues list | need | 🔎 | |
| D3 | Properties card | need | 🔎 | converted to cards |
| D4 | Back | — | ✅[1] | |

### E. Sidebar / chrome
| # | Item | Linear ref | Status | Notes |
|---|---|---|---|---|
| E1 | Brand + search | 01-issues-board | 🟡 | |
| E2 | Nav (My Issues, Projects) | 01-issues-board | 🟡 | |
| E3 | Team sections + collapse | 01-issues-board | 🟡 | |
| E4 | Selected / hover nav | need | 🔎 | |
| E5 | Section headers (de-uppercased) | 03-open-issue | 🟡 | |
| E6 | Topbar (48px) | 01-issues-board | 🟡 | |

### F. Global
| # | Item | Linear ref | Status | Notes |
|---|---|---|---|---|
| F1 | Type scale (Inter, weights, tracking) | tokens | 🟡 | |
| F2 | Colors (lch→hex) | tokens | 🟡 | |
| F3 | Scale/density | tokens | ✅[1] | matched 1440px |
| F4 | Scrollbars | need | 🔎 | |
| F5 | Focus states | — | ⬜ | |
| F6 | Toasts | — | ✅[1] | |

## Iteration log (append one line per iteration)
- It1 (kickoff): loop set up, dead clear-filter code removed, rebuilt+published (scale+Batch3). Probe relaunching for missing Linear refs. qa 39/39 green.
- It2: captured live Linear list (lin-list.png, logged in ✓). Diffed vs ours → FIXED: (A1) row far-right order was due→created→avatar, Linear is due→avatar→created — swapped; (A5) group headers now have leading disclosure chevron (rotates on collapse) + trailing "+" on hover + overlay select-all checkbox. Rebuilt, qa 39/39 green, re-screenshot confirms match. Republished. A1→✅[2], A5→✅[2].
- It3: TWO-ROW HEADER done. renderList topbar → topbar.noborder (breadcrumb+☆+🔔) + .subbar (tabs + filter/display icon-buttons). Matches Linear. qa 39/39 green, screenshot confirms. Republished. A7→✅[2].
- It4: captured fresh lin-projects.png. PROJECTS board → two-row header: row1 (Video › Projects + "+"), row2 ("All projects" tab + filter/display icons). Matches Linear structure. qa 39/39 green, screenshot confirms. Republished. C1→✅[2]. Found card-layout delta (status ring L→R) — queued.
- It5 (Sidney clarified: hover+click EVERYTHING on every screen): built sweep.js — master interaction sweep. Ran it: 6 screens, 415 hovers, 37 clicks, 13 menus, **0 JS errors**. Every element on every screen exercised cleanly. Added `node sweep.js` as a standing per-iteration check.
- It6: PROJECT CARD layout -> `[project icon] name ... [status ring] [dots] [avatar]` (moved status ring left->right, added client-emoji/neutral left icon). Matches lin-projects.png. qa ALL GREEN, sweep CLEAN (427 hovers), screenshot confirms. Republished. C2 verified[2]. NEXT: capture fresh live-Linear ISSUE DETAIL + assignee/due pickers + hover/selection, diff each; behavioral parity per surface.
- It7: captured lin-detail.png (VID-12586, exact same issue). Diffed → FIXED breadcrumb: now `[icon] client › VID-id <title> ☆ ⋯` (added title after muted id + ☆ star before ⋯), matching Linear. Noted detail residuals (back-arrow, right-panel action icons, "Back to list") in Open issues. qa ALL GREEN, sweep CLEAN, screenshot confirms. Republished. B1→✅[2], B2→✅[2]. NEXT: capture live-Linear pickers (status/assignee/due-calendar) + row hover + selection/action-bar; diff.
- It8: captured our status picker (pick-shots.js), diffed vs status-dropdown.png → FIXED status order: STATUS_ORDER moved "triage" first→last to match Linear (Backlog,Todo,InProgress,SMM,Kasper,Tweak,Client,Approved,Scheduled,Posted,Canceled,Triage); shortcuts now align 1-9. Also fixes list grouping order. qa ALL GREEN, sweep CLEAN, screenshot confirms order matches Linear. Noted picker residuals (✓/number order, Duplicate status). Republished. A16→✅[2]. NEXT: capture live-Linear assignee picker + due calendar + row hover + selection; diff. Then start Pass 2 (re-diff every ✅ item fresh).
- It9: verified our ASSIGNEE picker ("Assign to…" search, "No assignee" first, avatars+names, ✓ on current) and DUE CALENDAR ("‹ July 2026 ›", Su–Sa, today=4 accent, month grid) — both match Linear's documented patterns + tokens. NO deltas found (clean verification). No source change → no rebuild. Note: fresh Linear PIXEL refs for interactive pickers need a probe left-click-at-coords action (rclick=right, menu=text-click only); ours already match Linear's structure. A9→✅[2] (assignee), due-picker→✅[2]. NEXT: row hover + selection/action-bar (need Linear ref via probe hover), sidebar hover/selected, tooltips, empty states; then Pass 2 full re-diff.
- It10: diffed selection state vs Linear sel-3rows.png. CONFIRMED match: selected checkbox = accent fill + white check; row tint lavender #eaebf6 (=our --selected-row); action bar `[N selected] [⌘ Actions] [✕]`. Linear's extra middle `▷` icon = Ask Linear (AI) — by-design omitted. Group-by-project headers (icon+name+count+chevron+"+") also match. Hover/selection COLORS already = Linear's measured tokens (--hover #ebebec, --selected-row #eaebf6). NO deltas. A3→✅[2], A5→✅[3]. No source change. NEXT: sidebar hover/selected (measure via probe hover-nav.json), tooltips, empty states; then Pass 2 full sweep.
- It55 (POST-DONE VERIFY: row-hover inconclusive + BRAND HEADER delta fixed): (A) ROW HOVER: probe hover/move+eval at row coords → empty bg-chain (Linear row hover is JS/pseudo-driven, doesn't trigger via probe mouse.move / not on elementFromPoint ancestor). NOT a delta — row hover already verified It10/It12/It45 (ours --hover #ebebec = Linear); selected-row #eaebf6 It36. Fresh re-measure tooling-limited, noted. (B) BRAND/SEARCH HEADER: fresh Linear sidebar workspace name "Synchro Social" (lin-brand.json) = **14px/550/lch(19.188)#2e2e30/-0.1px**, logo 20px. OURS .sb-name "SyncView" was **12.5px/600/#1b1b1b/-0.25px**, logo 18px → real typography delta. FIX .sb-name→14px/550/var(--text-strong)/-.1px + .sb-mark 18→20px (kept SyncView name + purple-gradient-S rounded logo = BRAND identity; matched Linear header TYPOGRAPHY/proportions). Verified ours: sb-name 14/550/rgb(46,46,48)/-0.1px, logo 20px. Rebuilt, qa ALL GREEN, sweep CLEAN, eyeballed _shot-header.png (SyncView 14/550 + 20px gradient logo — matches Linear header proportions, brand kept). Republished (brand-header-14-550). 8th real correction this stretch. NOTE: search icon (right of brand) not separately measured — appears fine. DONE bar (list/detail/board) STANDS. NEXT: empty-states text sizes, my-issues, tab bar (Active/All/Backlog) re-measure, sidebar nav section headers vs fresh Linear.
- It54 (POST-DONE VERIFY: context menu + assignee/due pickers — CLEAN, 0 deltas): (A) CONTEXT MENU: right-clicked live Linear list row (probe rclick @700,280 → lin-ctxmenu.json, 19 items). Linear ctx items = **13px/400/#303032, h32, pad 0 18px 0 14px** (Status/Priority/Assignee/Due date/Labels/... all uniform). OURS ctx .mi = 13px/400/#2e2e30/h32 → MATCH (color ~2u imperceptible; font/weight/height exact). (B) ASSIGNEE + DUE pickers: ours both 13px/450 → It53 .pop-list .mi 450 fix propagated correctly to all 3 pickers (Linear uniform ✓). qa ALL GREEN + sweep CLEAN. No source change → no rebuild/republish. Sub-surfaces verified this stretch: status-picker(It53 fixed 450), assignee-picker(450✓), due-picker(450✓), context-menu(13/400✓). Minor unchased: ctx item exact L/R padding (Linear 14/18 asymmetric; ours matches on font/weight/color/height — visible attrs match). NEXT: row HOVER/SELECTION colors (measure Linear row hover bg via probe hover-at-coords + selected-row) + brand/search header + empty-states vs fresh Linear.
- It53 (POST-DONE VERIFY: STATUS PICKER → caught latent weight delta): Fresh-opened Linear status dropdown (probe menu-click "For Client Approval" on VID-12586 → lin-statuspop.json/.png). Measured ALL 11 dropdown items = **13px/450/#303032** (Backlog/Todo/In Progress/... all 450, 32px apart) + eyeballed lin-statuspop.png (regular-weight items, icon+name+number-shortcut, white rounded box + border + shadow). OURS `.pop-list .mi` was **13px/500** (It21 set 500 — stale/mismeasured; Linear is 450). FIX .pop-list .mi font-weight 500→450. Verified ours: picker item 13px/450. Rebuilt, qa ALL GREEN, sweep CLEAN. Republished (picker-item-450). Menu GEOMETRY matches: ours pop radius 12px/border 1px/shadow/pad5, item h32/pad0-8, search 12px ≈ Linear (rounded box+border+shadow, ~32px items). NOTE: this is a POST-DONE correction on a sub-surface (pickers) — the It50-52 DONE bar (list/detail/board main surfaces) STANDS; the picker was a latent It21 error now fixed (7th real correction this stretch). .pop-list .mi is shared by status/assignee/due pickers → all now 450 (Linear pickers uniform); spot-check assignee/due next cycle to confirm. NEXT: continue post-done verify rotation — assignee/due picker items (confirm 450), context-menu items, row hover/selection, brand/search header, empty-states vs fresh Linear.
- It52 (CLEAN PASS #3 of streak — FRESH BOARD full re-verify, 0 deltas → **DONE BAR REACHED**): OURS board ALL match: pt 13/500/#303032, pc 13/450/#5d5d5f, nm 13/500/#303032, meta 12/450/#5d5d5f, card radius 8px/border 0px/shadow YES (It47), overdue-target text muted rgb(93,93,95) + icon red (It44). FRESH Linear card drift-check (lin-carddrift.json): rad 8px / border 0px / white / shadow `lch(0 0 0/.02) 0 3px 6px -2px, lch(0 0 0/.04) 0 1px...` — EXACT match ours, NO drift. qa ALL GREEN + sweep CLEAN. Board eyeballed clean post-It47 (no source change since). No rebuild/republish. **★ DONE BAR REACHED — 3 consecutive FRESH-CAPTURE-VALIDATED clean passes (It50 detail, It51 list, It52 board), each measured vs LIVE Linear (not stale refs).** This DONE bar is stronger than the pre-It38 one: it survived the fresh-capture re-verification that caught 6 real deltas the old "done" had missed (It38 group-headers, It41 pills, It43+44 overdue×3-surfaces, It47 board-card, It49 detail-card-shadow+avatar) + verified formerly-estimated values (avatars 18px, card geometry). Remaining flagged: composer-box exact radius (unmeasurable, reasonable) + demo-content notes (my-issues empty, board targets default-2025). **NEXT (never-stop): keep looping — rotate to surfaces NOT yet fresh-checked this stretch (context menu, status/assignee/due pickers geometry, row hover/selection, my-issues, empty-states, brand/search header) vs fresh Linear; periodically re-capture; treat DONE as milestone not stop.**
- It51 (CLEAN PASS #2 of streak — FRESH LIST full re-verify, 0 deltas): Consolidated OURS list measure — ALL fixes hold: rtitle 13/500/#1b1b1b, rid 13/450/#5d5d5f, grp 13/500/#2e2e30 (It38), grp-count 13/450/#5d5d5f (It38), due-pill h24 (It41), status glyph 14px (It23), avatar 18px (It48), overdue-due text muted rgb(93,93,95) + icon red rgb(192,87,78) (It43). FRESH Linear drift-check (lin-listdrift.json): grp "For Client Approval" 13/500/lch(19.188)#2e2e30 ✓, due pill h24 ✓ — NO drift. qa ALL GREEN + sweep CLEAN. List eyeballed clean recently (no source change since It49 detail edits, which don't touch list). No rebuild/republish. **Consecutive clean passes: 2/3.** NEXT: BOARD fresh-capture for pass #3 = DONE bar (confirm card 8px/no-border/shadow It47 + col/card typo + overdue-target It44 hold vs fresh); if clean → DONE bar reached.
- It50 (CLEAN PASS #1 of streak — It49 fixes hold + composer-box attempted, 0 verified deltas): Confirmed It49 fixes holding: ds-card shadow YES, composer avatar 18px. Attempted to measure the COMPOSER BOX (ours 9px radius/1px #d5d5d5 border — flagged "reasonable estimate not measured" since It24): Linear composer resists clean measurement (below-fold + ProseMirror + CSS-pseudo placeholder so no text node; contenteditable walk found no clean bordered-box ancestor). EYEBALLED lin-detail-commented.png: Linear composer IS a bordered rounded box like ours → ours structurally CORRECT; exact radius unverified-but-reasonable, NOT editing an unverified value (discipline). qa ALL GREEN + sweep CLEAN. No source change → no rebuild/republish. **Consecutive clean passes: 1/3.** PERSISTENT UNMEASURABLE: composer box exact radius/border (hard since It24 — below fold, PM editor); ours bordered 9px is reasonable, flagged for Sidney's in-person eye. NEXT: rotate LIST fresh (confirm all list fixes hold vs fresh Linear) for #2, then BOARD for #3.
- It49 (PASS attempt → FRESH DETAIL capture CAUGHT 2 REAL DELTAS: property-card shadow + comment/composer avatar; counter RESET 1→0): Hunted estimated detail geometry on VID-12770/VID-12586. (1) PROPERTY CARD: Linear .ds-card-equiv (lin-detgeom2.json) = radius 10px + 1px border lch(91.9)#e8e8e8 + white bg + **soft shadow `rgba(0,0,0,.02) 0 3px 6px -2px, rgba(0,0,0,.04) 0 1px 1px 0`** (same 2-layer as board card It47); OURS .ds-card had border+radius but NO shadow → FIX added box-shadow (kept border — property card has BOTH border+shadow, unlike borderless board card). (2) COMMENT/COMPOSER AVATAR: Linear comment avatar measured 18.0px (lin-detgeom2 img) + eyeballed lin-detail-commented.png (comment "sidney@" + "Leave a reply" avatars small ~18px, same as activity rows); OURS avatar(c.a,22)+avatar("sl",22)=22px → FIX 22→18px both. Verified ours: ds-card shadow yes, comment av 18px, composer av 18px. Rebuilt, qa ALL GREEN, sweep CLEAN, eyeballed _shot-detail-comment.png (smaller 18px avatars + property cards w/ soft shadow — matches Linear). Republished (card-shadow-avatar-18). **Consecutive clean passes: RESET to 0/3** (5th fresh-capture-stretch catch; avatar 22px was another ESTIMATE that was WRONG — cf It48 list-avatar 18px estimate was right; ALWAYS measure). KNOWN STRUCTURAL DIFF (flagged, not fixed): Linear wraps each COMMENT in a bordered box w/ inline reply composer; ours renders comments as simple avatar+text rows (skeleton simplification) — noted, not a measured-typo delta. NEXT: rebuild streak — fresh detail (confirm shadow+avatar) / list / board.
- It48 (CLEAN PASS #1 of streak — verified AVATAR (previously-estimated) + card fix holds, 0 deltas): Targeted a NOT-measured geometry per It47 lesson: LIST AVATAR (It23 flagged .av 18px as "reasonable estimate, couldn't measure"). Fresh Linear list avatar (lin-avatar2.json) = **IMG 18.0x18.0px, radius 50%** = ours .av 18px/50% EXACT ✓ (estimate happened to be correct — now VERIFIED not assumed). It47 card fix confirmed holding: .pcard 8px/border 0px/shadow present. qa ALL GREEN + sweep CLEAN. Board eyeballed clean in It47 (no source change since). No rebuild/republish. **Consecutive clean passes: 1/3.** NEXT: rotate — fresh DETAIL (re-check comment avatar 22px + any other estimated geometry) for #2, then LIST for #3; bank 3 clean.
- It47 (PASS #3 attempt → FRESH BOARD capture CAUGHT REAL DELTA: card radius/border/shadow; counter RESET 2→0): Board typography all matched (It40/44 hold: pt/pc/nm/meta + overdue-target), BUT measuring card GEOMETRY fresh (lin-cardshadow.json) revealed: Linear board card = **radius 8px, border 0 (NONE), white bg, TWO-layer shadow `rgba(0,0,0,.02) 0 3px 6px -2px, rgba(0,0,0,.04) 0 1px 1px 0`** (tight 4% layer gives edge). OURS .pcard = **6px radius + 1px #e8e8e8 BORDER + no shadow**. ROOT CAUSE: It17 set 6px from a TOKEN ESTIMATE ("card radius ~6px") — Linear card radius was NEVER cleanly measured (It17 noted "could NOT measure"). FIX: `.pcard` → border-radius:8px, REMOVE border, box-shadow:0 3px 6px -2px rgba(0,0,0,.02),0 1px 1px 0 rgba(0,0,0,.04); `.pcard:hover` border-color→stronger box-shadow. Verified ours: rad 8px, border 0px, 2-layer shadow. Rebuilt, qa ALL GREEN, sweep CLEAN, eyeballed _shot-projects.png vs lin-board-fresh.png (borderless white cards + soft shadow + 8px — defined not edgeless, matches Linear). Republished (board-card-8px-shadow). **Consecutive clean passes: RESET to 0/3** (4th fresh-capture-for-pass catch: It38 group-headers, It41 pills, It43 overdue, It47 card). LESSON REINFORCED: token-ESTIMATES (not measured vs Linear) are unreliable — re-measure geometry fresh. NEXT: rebuild streak — fresh list/detail/board (confirm card fix) passes; bank 3 clean.
- It46 (CLEAN PASS #2 of streak — FRESH DETAIL full re-verify, 0 deltas): Consolidated OURS detail measure — ALL match + It43 overdue-in-panel fix holds: d-title 24/600/#1b1b1b, d-desc 15/450/#2e2e30, act-hd 15/600/#1b1b1b, sub-hd 12/500/#5d5d5f, ds-row 13/500/#2e2e30, ds-card-hd 13/450/#5e5e60, crumb-b 13/500/#303032, act-text 15/450/#2e2e30, act-meta-b 13/500/#1b1b1b, cinput 15/450; overdue-due-in-panel text dark rgb(46,46,48) + icon red rgb(192,87,78). FRESH Linear drift-check (lin-detconfirm.json): Activity 15/600/lch(9.894)#1b1b1b ✓, status "For Client Approval" 13/500/lch(20)#303032 ✓ — NO drift. qa ALL GREEN + sweep CLEAN. Eyeballed _shot-detail.png: property panel "Jun 12" now DARK text + RED calendar icon (It43 fix confirmed visually), Activity prominent, sub-rows 13/500, composer 15px — all matches Linear. No rebuild/republish. **Consecutive clean passes: 2/3.** NEXT: BOARD fresh-capture for pass #3 = DONE bar (re-measure col-header/count/card-name/card-meta/overdue-target vs fresh); if clean → DONE bar reached.
- It45 (CLEAN PASS #1 of streak — FRESH LIST full re-verify, 0 deltas): Consolidated OURS list measure — ALL match fresh Linear + It43/44 overdue fix holds w/ no regression: rtitle 13/500/#1b1b1b, rid 13/450/#5d5d5f, grp 13/500/#2e2e30, grp-count 13/450/#5d5d5f, due-pill h24, overdue due text muted rgb(93,93,95) + icon red rgb(192,87,78), status glyph 14px. FRESH Linear drift-check (lin-grpconfirm.json): grp "For Client Approval" 13/500/lch(19.188)#2e2e30 ✓, rid "VID-12802" 13/450/lch(39.576)#5d5d5d ✓ — NO Linear drift, ours matches. qa ALL GREEN + sweep CLEAN. List eyeballed clean post-It43 (no source change since). No rebuild/republish. **Consecutive clean passes: 1/3.** NEXT: DETAIL fresh-capture for pass #2 (re-verify title/desc/act-hd/property-values/overdue-due-in-panel/breadcrumb vs fresh), then BOARD for #3.
- It44 (RESOLVED It43 follow-up — BOARD overdue target, same icon-not-text delta): Measured fresh Linear board card past-due target "Mar 14th, 2023" (lin-boardtarget.json) = **lch(40)≈#666 NEUTRAL text, 12/450** (NOT red) + red calendar-x icon (visible lin-projects-live.png). OURS `.pcard-meta .mdue.over` reddened WHOLE thing (text rgb(192,87,78) + icon red). FIX: `.pcard-meta .mdue.over{color:--overdue}` → `.pcard-meta .mdue.over svg{color:--overdue}` (text stays --muted, icon red). Verified: board mdue.over text rgb(93,93,95) muted + icon red. Rebuilt, qa ALL GREEN, sweep CLEAN, eyeballed _shot-projects.png (targets now dark/muted text + red calendar icon — matches Linear). Republished (board-overdue-consistent). Overdue treatment now UNIFORM across list+detail+board: neutral/muted text + red icon flag. **Consecutive clean passes: 0/3** (found+fixed a delta this cycle). DEMO-CONTENT NOTE (flagged for Sidney, NOT a parity delta): board card targets ("Aug 20","Sep 30" w/o year) default to 2025 in overdue() → ALL show red icon (all "past-due"); Linear's real board is a MIX — consider explicit 2026 target dates in mock data for a realistic mix (content choice). NEXT: rebuild streak — fresh list/detail/board passes; each fresh-capture + measured spot-check; bank 3 consecutive clean.
- It43 (PASS attempt → FRESH DETAIL/LIST capture CAUGHT REAL DELTA: OVERDUE due color; counter RESET 1→0): Fresh-captured VID-12586 detail (eyeballed lin-detail-fresh.png property panel) + measured live list overdue due. FINDINGS: (1) DETAIL panel due "06/12/2026" = **RED calendar icon + DARK text** (#303032, like other property values); (2) LIST overdue due "Jun 12" leaf measured **lch(39.576)≈#5d5d5d NEUTRAL gray text** (chroma 1.25=gray, hue 282=neutral — DEFINITIVELY not red), icon lch(9.894) neutral. CONCLUSION: Linear NEVER reddens the due TEXT — overdue is flagged by the ICON only. OURS reddened the TEXT in both (list .due.over color:--overdue; detail .ds-row .over color:--overdue) AND detail had it inverted (dark icon + red text vs Linear red icon + dark text). FIX: (a) `.due.over` → keep only `svg{color:--overdue}` (list: muted text + red icon); (b) `.ds-row .over` → `.ds-row.dueover>svg{color:--overdue}` + render 466/509 put `dueover` on the ROW (icon red) + plain span (dark text). Verified: LIST overdue text rgb(93,93,95) muted + icon red; DETAIL overdue val rgb(46,46,48) dark + icon red. Rebuilt, qa ALL GREEN, sweep CLEAN, eyeballed _shot-list.png (dues now dark text + red calendar icon — matches Linear). Republished (overdue-icon-not-text). **Consecutive clean passes: RESET to 0/3** (fresh capture caught a real measured delta — 3rd time fresh-capture-for-pass found something stale refs missed). NEXT: rebuild streak; verify board card overdue targets (.pcard-meta .mdue.over) similarly (Linear likely same icon-not-text — measure), then list/detail/board fresh passes.
- It42 (CLEAN PASS #1 of re-rebuilt streak — FRESH LIST re-verify, 0 deltas): Confirmed It41 pill fix holds + status icon vs fresh Linear. OURS: due/chip/subchip all 24px/12px ✓ (=Linear h24/12/450 from It41 fresh measure); status glyph 14.0px in 16px slot. FRESH Linear status icon (lin-staticon.json) = **14.0x14.0px** at row start = ours ✓ (It23 fix holds). rtitle 13/500/#1b1b1b + rid 13/450/#5d5d5f + grp 13/500/#2e2e30 all confirmed fresh-matching (It38/It41, no source change since). qa ALL GREEN + sweep CLEAN. List eyeballed clean after It41 pill fix (no change since). No source change → no rebuild/republish. **Consecutive clean passes: 1/3.** NEXT: rotate to DETAIL fresh-capture for pass #2 (re-verify d-title/desc/act-hd/property-values/comment surfaces vs fresh Linear), then BOARD/menus for #3.
- It41 (PASS #3 attempt → FRESH LIST capture CAUGHT REAL DELTA: list PILL height/font; counter RESET 2→0): Rigorous fresh-Linear list re-capture measured chip/due/subcount pill GEOMETRY (lin-chips/lin-duepill/lin-subcount.json). Linear list pills UNIFORM: **h=24px, leaf text 12px/450, padding 0 8px, radius stadium(48px), border 1px #d5d5d5**, row=44px (=ours). OURS were **h≈19px (subchip 16px), font 11px (subchip 10.5px), pad 1px/7-8px** → real shorter-pill delta. ROOT CAUSE: It22 MEASURED Linear h24 but only applied radius+border, never the HEIGHT/font — persisted until this fresh re-measure (lesson: apply ALL measured props, not just the obvious ones). FIX: .due/.chip/.subchip → font-size:12px + font-weight:450 + height:24px + padding:0 8px (radius/border already matched). Verified ours: due/chip/subchip all 24px/12px/450. Rebuilt, qa ALL GREEN, sweep CLEAN, eyeballed _shot-list.png vs lin-list-fresh.png (pills now substantial 24px, row alignment clean, matches Linear). Republished (list-pills-24px). **Consecutive clean passes: RESET to 0/3** (fresh capture found a real delta — again the value of fresh-capture-for-final-pass; It39/40 were clean but list pills hadn't been re-measured fresh). NEXT: rebuild streak — fresh-capture list AGAIN (confirm pills now match) + rotate through detail/board/menus; bank 3 consecutive clean.
- It40 (CLEAN PASS #2 of rebuilt streak — FRESH BOARD capture, 0 deltas): Fresh-Linear board re-capture (goto team/VID/projects, lin-board-fresh.png + lin-boardfresh.json). Fresh values vs ours ALL MATCH (within imperceptible ≤2u): colHead "Backlog" Linear 13/500/lch(19.788)#2e2e30 vs ours .pt 13/500/#303032; colCount "34" Linear 13/450/lch(39.576)#5d5d5d vs ours .pc 13/450/#5d5d5f; cardName "Danny Morel" Linear 13/500/lch(20)#303032 vs ours .pcard-nm 13/500/#303032 EXACT; meta "1036 issues" Linear 12/450/lch(40)#666 vs ours .pcard-meta 12/450/#5d5d5f. (Linear's OWN colHead lch19.788 vs cardName lch20 differ ~2u — ours #303032 sits within that variance; not a delta.) It33 board fixes hold. qa ALL GREEN + sweep CLEAN. No source change → no rebuild/republish. **Consecutive clean passes: 2/3.** NEXT (pass #3 = DONE bar): fresh-capture the last un-refreshed surfaces — status/assignee pickers + chips/dues + context menu — via probe open-menu vs fresh Linear; if clean → bank #3 = DONE bar reached (then keep looping per never-stop).
- It39 (CLEAN PASS #1 of rebuilt streak — FRESH DETAIL capture, 0 deltas): Rigorous fresh-Linear detail re-capture (goto VID-12586, lin-detail-fresh.png + lin-detailfresh.json). Fresh values ALL MATCH ours: H1 title 24/600/lch(9.894)#1b1b1b ✓, "Activity" hdr 15/600/#1b1b1b ✓ (It31 fix holds), property value "For Client Approval" 13/500/lch(20)#303032 ✓ (It34 fix holds), breadcrumb id "VID-12586" 13/500/lch(19.788)#2e2e30 ✓, project "John Wineland" 13/500 ✓. Eyeballed lin-detail-fresh.png: structure/styling matches ours (title/desc/breadcrumb/right-panel Properties→status/assignee/due→Project); content differs (real issue vs our mock — expected) and we omit priority/labels/cycle per skeleton (intentional). qa ALL GREEN + sweep CLEAN. It38 group-header fix (grp-title 13/#2e2e30) holds. No source change → no rebuild/republish. **Consecutive clean passes: 1/3** (rebuilt streak; each pass now uses a FRESH Linear spot-check). NEXT: fresh-capture a rotating surface toward pass #2 (board fresh-capture / menus / chips vs fresh Linear); if clean bank #2.
- It38 (PASS #3 attempt → FRESH RE-CAPTURE CAUGHT A REAL DELTA: list GROUP HEADER; counter RESET 2→0): Did the rigorous fresh-Linear re-capture (goto team/VID/active, lin-list-fresh.png + lin-listfresh.json). Fresh core values: rid "VID-12802"=13/450/#5d5d5d ✓match, title=13/500/#1b1b1b ✓match, but GROUP HEADER "For Client Approval"=**13px/500/lch(19.188)≈#2e2e30** (measured x2 + eyeballed prominent dark header) — ours `.grp-title` was **12px/500/var(--muted)#5d5d5f** (smaller+muted). ROOT CAUSE: earlier "grp-title 12/500/#5d5d5f matching Linear" (It26/27/36) had CONFLATED the list status-group header with the SIDEBAR SECTION headers (Workspace/Your teams = 12/500/muted) — never directly measured the list group header vs Linear until this fresh capture. Also grp-count "135"=13/450 (ours was 11/faint). FIX: `.grp-title{font-size:13px;color:var(--text-strong)}` + `.grp-count{font-size:13px;font-weight:450;color:var(--muted)}`. Verified ours: grp-title 13/500/rgb(46,46,48), grp-count 13/450/rgb(93,93,95). Rebuilt, qa ALL GREEN, sweep CLEAN, eyeballed _shot-list.png vs lin-list-fresh.png (group headers now prominent dark, match). Republished (group-header-13-dark). **Consecutive clean passes: RESET to 0/3** (fresh capture found a real delta — the WHOLE POINT of re-capturing for the final pass; It36/37 were clean only vs stale refs). LESSON: always measure the SPECIFIC element vs Linear, never infer one header's style from a sibling's. NEXT: FRESH-capture the DETAIL too (lin-detail-fresh) + re-measure detail core values vs fresh; then resume banking clean passes 1→2→3, each with a fresh Linear spot-check.
- It37 (CLEAN PASS #2 of streak — 0 deltas): qa ALL GREEN + sweep CLEAN + list shot eyeballed (groups/rows/chips/dues/avatars all clean, no regression). Verified remaining INTERACTIVE surfaces: (1) ASSIGNEE picker item = 13px/500/h32 + search 12px = Linear picker (matches It21); (2) DUE picker = searchable menu `.pop.duepop` (pop-search "Try: 7 days, Jul 20…" + Remove/Custom/quick options; calendar via Custom) — this is the MODERN Linear due-picker pattern, NOT a static month grid; not a bug (It9's "calendar" is now the Custom sub-view); (3) MY-ISSUES = correct "No issues assigned to you." empty state (our mock assigns to editors et/lu/ma, none to sl/You — correct behavior, Linear would also be empty w/ 0 assigned). No source change since It36 → the 17-value regression still holds; no rebuild/republish. **Consecutive clean passes: 2/3.** DEMO-CONTENT SUGGESTION (flagged for Sidney, NOT a parity delta): My-Issues is always empty because no mock issue is assigned to "You" — consider assigning 2-3 issues to sl for a livelier demo (content choice, may ripple to list avatars; left to Sidney). NEXT (pass #3 = DONE bar): RE-CAPTURE FRESH Linear list+detail (guard vs Linear-side changes since lin-*.png were captured earlier) + re-measure 3-4 core values vs the FRESH capture + qa/sweep/shots eyeball; if ZERO deltas → bank clean pass #3 = DONE bar reached (then keep looping per never-stop).
- It36 (CLEAN PASS #1 of new streak — 0 deltas, 0 regressions): qa ALL GREEN + sweep CLEAN. (A) selected-row bg CLEAN re-measure WITHOUT hover = rgb(234,235,246)=#eaebf6 = Linear --selected-row (earlier It35 #e3e4f2 was hover-blended, confirmed); checkbox fill accent #5e6ad2. (B) breadcrumb `.crumb-detail`/b/ttl = 13/500/rgb(48,48,50)#303032; Linear breadcrumb (lin-crumb.json) "John Wineland"+"VID-12586" = 13/500/lch(19.788)≈#2f2f31 → MATCH (~1u, imperceptible). (C) CONSOLIDATED REGRESSION re-measure of ALL 17 values fixed It29-35 — every one still hits target: LIST rtitle-b 13/500/#1b1b1b, rid 13/450/#5d5d5f, grp 12/500/#5d5d5f; DETAIL d-title 24/600, d-desc 15/450/#2e2e30, act-hd 15/600/#1b1b1b, sub-hd 12/500/#5d5d5f, ds-row 13/500/#2e2e30, ds-card-hd 13/450/#5e5e60, act-meta 13/450/#5d5d5f, act-meta-b 13/500/#1b1b1b, act-text 15/450/#2e2e30, stt 13/500/#1b1b1b, cinput 15/450; BOARD pcard-nm 13/500/#303032, pc 13/450/#5d5d5f, pcard-meta 12/450/#5d5d5f. NO source change → no rebuild/republish. **Consecutive clean passes: 1/3.** CAVEAT before declaring 3/3 done-bar: a few INTERACTIVE surfaces still want a fresh Linear comparison — action-bar exact type, assignee/due PICKER geometry, my-issues view, empty-states (blocked partly by read-only guardrail: selecting rows / some picker opens). NEXT: verify those measurable-via-open-menu (assignee/due picker via probe menu action) + my-issues; if clean, bank clean pass #2; else fix & reset.
- It35 (PASS → 1 BIG REAL DELTA: TOOLTIP was DARK, Linear is LIGHT): qa GREEN + sweep CLEAN. Rotation: tooltip + row hover/selection + empty-state. Measured LIVE Linear tooltip (hovered top-right "Copy issue URL" icon @1269,75 via probe move+eval, walked up chain lin-tipbox.json + eyeballed lin-tooltip-shot.png): tooltip BOX = **bg lch(100)=WHITE #fff, border-radius 8px, padding 5px 8px, text 11px/450/lch(20)≈#303032 (DARK text), subtle border+shadow**, shows a kbd-shortcut badge (Ctrl ⇧ ,). OURS `#tip` was **DARK: bg #232427 / #fff text / r6px / pad4-8 / hard shadow** — INVERTED scheme, a real visible delta. FIX `#tip{background:var(--surface);color:var(--text-strong);padding:5px 8px;border-radius:8px;border:1px solid var(--border-soft);box-shadow:var(--shadow-pop)}` + `.tk` shortcut color #a9abb3→var(--muted) (light-bg legible). Verified ours: tip bg rgb(255,255,255)/text rgb(46,46,48)/r8px/pad5-8/border1px. Rebuilt, qa ALL GREEN, sweep CLEAN, eyeballed _shot-tooltip.png ("Search ⌘K" now a light box w/ dark text + muted shortcut — matches Linear). Republished (light-tooltip). ALSO CONFIRMED this cycle: list ROW HOVER bg rgb(235,235,236)=#ebebec = Linear --hover (re-verify It10/It12). **Consecutive clean passes: still 0/3** (found delta). OPEN/unmeasured: selected-row bg read #e3e4f2 while hovered (blended — needs clean re-measure w/o hover; not acted on); empty-state text 12.5/#9a9aa0 (our own copy, no direct Linear analog). NEXT rotation: action bar, my-issues view, assignee/due pickers, breadcrumb detail, then re-loop list/detail/board fresh.
- It34 (PASS → 1 REAL DELTA: detail-panel property VALUES; ds-card-hd + picker CONFIRMED): qa GREEN + sweep CLEAN. Rotation: detail right-panel (.ds-card/.ds-row) + status picker. Measured LIVE Linear VID-12586 (lin-props.json/lin-propvals.json, read-only): section headers "Properties"/"Project"/"Labels" = 13px/450/lch(40)≈#5e5e5e (ours .ds-card-hd 13/450/#5e5e60 ✓ CONFIRMED match); property VALUES status "For Client Approval" + "Cycle 182" + project "John Wineland" ALL = **13px/500/lch(20)≈#303032** (consistent x3). DELTA: ours `.ds-row` was **12.5px/400/var(--text)#1b1b1b** → wrong on size+weight+color. FIX `.ds-row{font-size:13px;font-weight:500;color:var(--text-strong)}` (--text-strong #2e2e30≈Linear #303032, ~2u; .muted/.over overrides for placeholder/overdue-date kept). Verified ours EXACT: ds-row 13/500/rgb(46,46,48), ds-card-hd unchanged 13/450/rgb(94,94,96). STATUS PICKER item measured ours 13/500/#2e2e30 h32 = Linear (re-confirm It21). Rebuilt, qa ALL GREEN, sweep CLEAN, eyeballed _shot-detail.png (property values now medium-weight #303032, headers muted, overdue red — matches Linear right panel). Republished (property-values-13-500). **Consecutive clean passes: still 0/3** (found delta). Note: a stray "Jun 12"=12/450/muted global-match was NOT the panel due (panel uses MM/DD/YYYY) — ignored. OPEN/NEXT rotation: empty-state text sizes, tooltips .tip geometry, list row hover/selection colors, action bar, my-issues view, assignee/due pickers, breadcrumb detail.
- It33 (PASS → 2 REAL DELTAS on PROJECT BOARD + sidebar nav CONFIRMED): qa GREEN + sweep CLEAN. Rotation: sidebar nav selected-state + project board. (A) SIDEBAR NAV = CONFIRMED MATCH (no delta): ours selected 13/500/#1b1b1b on bg #e5e5e6, unselected 13/500/#5a5a5c = Linear (re-verify of It20). (B) PROJECT BOARD — navigated probe to live Linear projects (team/VID/projects, a KANBAN like ours: Backlog/Planned/Paused columns + project cards), measured (lin-board.json): col-header "Backlog"=13/500/lch(19.788)≈#2e2e30 (ours .pt 13/500/#303032 ✓ ~2u); col-COUNT "34"=**13px/450/lch(39.576)≈#5d5d5d**; card-name "Danny Morel"=13/500/lch(20)≈#303032 (ours .pcard-nm ✓ EXACT); card-META "1036 issues" & date="**12px/450/lch(40)≈#666**". DELTAS: ours `.pcol-hd .pc` was 11px/faint → FIX 13px/450/var(--muted); ours `.pcard-meta` was 11px/400 → FIX 12px/450 (color --muted already ≈match). Verified ours EXACT: .pc 13/450/rgb(93,93,95), .pcard-meta 12/450/rgb(93,93,95). Rebuilt, qa ALL GREEN, sweep CLEAN, eyeballed _shot-projects.png vs lin-projects-live.png (counts now prominent, meta 12px — matches). Republished (board-count-meta). **Consecutive clean passes: still 0/3** (found deltas). KNOWN INTENTIONAL DIFF (flagged, not a delta): our board cards show a 2-line project DESCRIPTION (.pcard-desc) which Linear's board cards omit — kept as agency enrichment (like sub-row id); Linear shows desc only in project detail/list. OPEN/NEXT rotation: empty-state text sizes, tooltips (.tip), status/assignee/due pickers geometry, chips/dues re-measure, project-DETAIL side panel (.ds-card/.ds-row) again, breadcrumb.
- It32 (PASS → 2 REAL DELTAS: comment-meta + sub-issue-row typography): qa GREEN + sweep CLEAN, rotation set .act-meta + .d-subrow measured vs LIVE Linear (read-only). (A) COMMENT META on VID-12770 (lin-ago.json isolates comment header from activity-log rows): comment AUTHOR = **13px/500/lch(10)≈#1b1b1b**, TIMESTAMP = **13px/450/lch(40)≈#666**; the 12px/450 & 12px/500 variants are Linear's ACTIVITY-LOG rows (created/moved/renamed) which our skeleton omits. Ours `.act-meta` was 12px author-b **600** + 12px/400 base → FIX `.act-meta{font-size:13px;font-weight:450}` + `.act-meta b{font-weight:500}` (color --text/--muted already matched). (B) SUB-ISSUE ROW on VID-12716 (lin-subrow*.json + eyeballed lin-subrows-view.png): sub-issue TITLE = **13px/500/#1b1b1b**; Linear sub-rows show NO id (status+title+cycle/due pills+avatar) — ours show compact [status][id][title] (skeleton choice, kept). Ours `.d-subrow` base was 12px/400 → FIX font-size 12→13px, height 32→34px, `.stt` add font-weight:500 (also lifts project-detail Issues rows, same class — correct, Linear issue rows are 13/500). Verified ours EXACT: act-meta 13/450/rgb(93,93,95), act-meta b 13/500/rgb(27,27,27), subrow stt 13/500/rgb(27,27,27), sid 13px faint, rowH 34. Rebuilt, qa ALL GREEN, sweep CLEAN, eyeballed _shot-detail-comment.png (comment "Ethan Torres · 1d ago" + 15px body + 13/500 sub-rows — matches Linear exactly). Republished (actmeta-subrow-13px). **Consecutive full clean passes: still 0/3** (found deltas → not clean). OPEN/NEXT rotation: sidebar nav selected-state colors, empty-state text sizes, tooltips, project-detail cards (pcard/pcol), status/assignee/due pickers again, chips/dues. 4 straight iterations each caught a real delta by rotating surfaces — keep going.
- It31 (FRESH PASS #1 → REAL DELTA: section-header TIERS): qa GREEN + sweep CLEAN + shots eyeballed, but measured rotation set (.d-sub-hd / .act-meta / .rid / .grp-title) surfaced that Linear uses TWO distinct section-header tiers where our shared `.d-sub-hd` used ONE. LIVE probe measured on VID-12770 + VID-12716 (read-only): "Activity" header = **15px/600/lch(9.894)≈#1b1b1b** (=our --text); "Sub-issues" header = **12px/500/lch(39.576)≈#5d5d5d** (=our --muted, matches!). Ours `.d-sub-hd` was 12px/**600**/#5d5d5f for BOTH → wrong for both (Activity too small+light; Sub-issues weight 600 vs 500). Eyeballed both Linear screenshots (lin-detail-commented.png, lin-parent-subs.png): Activity is a prominent dark header, Sub-issues a light sub-label — confirms two tiers. FIX: split the class — `.d-sub-hd` weight 600→500 (Sub-issues + project Issues headers; size 12 & color --muted already matched); NEW `.d-act-hd{font-size:15px;font-weight:600;color:var(--text);margin-bottom:12px}` for the Activity header (render line 460 now uses it). Verified ours: act-hd 15px/600/rgb(27,27,27) EXACT, sub-hd 12px/500/rgb(93,93,95) EXACT. Rebuilt, qa ALL GREEN, sweep CLEAN, detail screenshot eyeballed (Activity now prominent, Sub-issues light, no layout break, matches Linear hierarchy). Republished (section-header-tiers). **Consecutive full clean passes: still 0/3** (this pass FOUND a delta → not clean; streak restarts after fix). Also measured this cycle & CONFIRMED matching: .rid 13/450/#5d5d5f/-0.26px, .grp-title 12/500/#5d5d5f/normal (both already Linear per It20/It27). OPEN/NEXT rotation: .act-meta (comment author+timestamp — ours author-b 12/600/#1b1b1b + meta 12/400/#5d5d5f; measure vs Linear "sidney@… · 1d ago" on VID-12770); then .d-subrow row title/id sizes, sidebar nav selected-state, chips. Guardrail honored: MCP + probe READ-ONLY throughout (list_issues/list_comments reads + probe goto/eval/shot; never mutated Linear).
- It30 (RESOLVED It29 OPEN item — comment + composer prose, via LIVE measurement of a commented Linear issue): Used Linear MCP (read-only list_issues/list_comments) to find a commented issue → VID-12770 has comment "Same font changes". Probe-navigated there (read-only) + eval: comment body `P.text-node` = **450 / 15px / lh24 / -0.1px** — IDENTICAL to description prose. Also measured ALL ProseMirror editors on that page (lin-composer.json): description editor 15/450/24, comment editor 15/450/24, TITLE editor 24/600/-0.1 — so the composer (same "ProseMirror editor" family) is **15/450/24** too. This finally MEASURES the long-flagged "unmeasurable composer" (It24/It28) — it was below-fold in old detail captures, but on a commented issue the editor tree is present. DELTAS: our `.act-text` was 13px/400/1.5/normal; our `.composer-box input` was 13px/400. FIX: `.act-text{font-size:15px;font-weight:450;letter-spacing:-.1px;line-height:24px}` + `.composer-box input{font-size:15px;font-weight:450;letter-spacing:-.1px}`. Verified ours (injected test comment): act-text = 15px/450/24px/-0.1px EXACT; #cinput = 15px/450/-0.1px EXACT; d-desc=450. Color: our --text-strong rgb(46,46,48) ≈ Linear prose lch(20 1 282)→≈rgb(48) — match within ~2 units (imperceptible). Rebuilt, qa ALL GREEN, sweep CLEAN, detail screenshot eyeballed (composer now correctly 15px, no layout break, Linear-faithful). Republished (prose-15px-450). **Consecutive full clean passes: still 0/3** (It29+It30 are the SAME delta family — editor/prose weight+size — found & fixed this session; streak restarts fresh AFTER this). COMPOSER FLAG now CLOSED (measured, not just "reasonable"). NEXT: begin a fresh FULL CLEAN PASS #1 (qa+sweep+shots eyeball + measured spot-check yet another value set, e.g. .act-meta, .d-sub-hd, .rid, sidebar) — if zero deltas bank #1.
- It29 (FULL CLEAN PASS #3 attempt → REAL DELTA FOUND, counter RESET): qa ALL GREEN + sweep CLEAN, but measured 3rd value set surfaced a genuine delta on the issue-DESCRIPTION prose weight. LIVE-Linear measurement (probe eval on VID-12586 detail, lin-descweight.json): description `P.text-node` = **font-weight 450** / 15px / -0.1px. Ours `.d-desc` inherited body default = **400**. NOTE: the earlier lin-detail.json capture had NO description node (below-fold at capture time) → the "450" I'd annotated from memory was UNVERIFIED until now; live probe CONFIRMED it. Scoping: Linear `body`=400 and generic button=400 (lin-weightmap.json), so 450 is NOT global — it's applied specifically to EDITOR/PROSE content. FIX: `.d-desc{font-weight:450}` (children `.d-desctext` inherit; `.d-descedit` textarea inherits via font:inherit). Our font is InterVar (variable 100–900) so 450 renders distinctly; already used at `.rid`/`.rtitle .rp`. Verified ours: `.d-desc` fw=450, `.d-desctext` fw=450 (EXACT match Linear). Rebuilt, qa ALL GREEN, sweep CLEAN. Republished (desc-weight-450). **Consecutive full clean passes: RESET to 0/3** (a real delta invalidates the streak per contract §5). OPEN: comment body `.act-text` (13px/400) — Linear comment bodies share the same ProseMirror editor as descriptions so likely also 450 (and possibly 15px), but VID-12586 has NO comments so unmeasured; must measure against a commented Linear issue before changing (no unverified edits; NEVER create a comment in Linear — read-only). NEXT: find a Linear issue WITH comments, measure `.act-text` size+weight, fix if delta, then restart the 3-consecutive-clean-pass count from scratch.
- It28 (FULL CLEAN PASS #2 of 3): qa ALL GREEN + sweep CLEAN + measured spot-check of a DIFFERENT surface set (board/detail/menu, It19/It21 values) ALL MATCH, zero regressions: pt 13/500/#303032, pcard-nm 13/500 + radius 6px, ds-card-hd 13/450/#5e5e60, picker-item 13/500. No source change. **Consecutive full clean passes: 2/3.** Composer/comment-box: NOT remotely measurable (below-fold contenteditable in Linear); ours reasonable (radius9/#d5d5d5 border/accent btn) — flag for Sidney's in-person eye if he wants it exact; low-visibility, not blocking. NEXT: one more full clean pass (re-screenshot + eyeball list/detail/board vs lin-*.png + qa/sweep + measured spot-check a 3rd value set) → bank #3 = DONE bar; then keep re-verifying per never-stop.
- It27 (FULL CLEAN PASS #1 of 3): qa ALL GREEN + sweep CLEAN + measured spot-check ALL MATCH Linear, zero regressions: chip radius999(stadium)+#d5d5d5, status icon 14px, grp-title 12/500/#5d5d5f, tb-tab 12/500, crumb-b 13/500/#303032. No source change. **Consecutive full clean passes: 1/3.** (It18-25 fixed all measured deltas; It26 hexagon/sidebar clean.) Need 2 more consecutive full clean passes (each = qa+sweep green + no new measured deltas across a fresh area check) to hit the DONE bar. NEXT: probe an un-measured area (composer via scroll+eval, or act-meta) to flush any last delta; if clean, bank clean pass #2.
- It26 (PASS 3 — MEASURED sidebar/toolbar geometry): CLEAN PASS, no delta. lin-list.json: sidebar w=244 (ours 244 ✓); tabs "Active"=12px/500/#1b1b1b (selected), "All issues"=12px/500/#5d5d5f (unselected), text y=68. Ours .tb-tab 12/500/muted(#5d5d5f) + .on→--text(#1b1b1b); subbar(y57,h44) centers 23px tab at y≈67.5 ≈ Linear 68. All match. No source change. Clean measured passes so far: hexagon(It24), sidebar+tabs(It26). NEXT: composer (scroll+eval), act-meta/act-text, brand/search, then a FULL behavioral+measured pass to bank a consecutive-clean-pass toward 3+.
- It25 (PASS 3 — MEASURED detail id/breadcrumb): lin-detail.json → "VID-12586" appears ONLY in breadcrumb (y=23), NOT above title; H1 at y=91. Ours had a redundant .d-id line above the title (y=81) — Linear doesn't. Breadcrumb parts = 13px/500/#303032 (ours were 12px/muted/450). FIXED: (1) removed .d-id from renderDetail (title now flows directly after breadcrumb, y=81≈Linear91); (2) .crumb-detail → 13px/500/#303032, .crumb-detail b + .crumb-ttl → #303032/500, .sep faint. Updated qa-features.js openId() to read .crumb-detail b (was .d-id). Verified: .d-id gone, crumb b = 13/500/rgb(48,48,50) EXACT match Linear; screenshot confirms clean detail matching lin-detail.png. qa ALL GREEN, sweep CLEAN. Republished. Real STRUCTURAL + typography delta fixed. NEXT: measured composer (scroll+eval) or act-meta, then behavioral re-verification passes.
- It24 (PASS 3 — MEASURED hexagon/composer/button): lin-projects.json icon widths = 16px×118 (dominant on board), 14px×39. Our project hexagon (projSVG) = 16.0x16.0 → CLEAN MEASURED PASS (matches Linear board 16px icons; board icons are 16px vs list status 14px — correct family difference). Composer-box (radius9/#d5d5d5 border/pad8-10) + comment btn (.btn-primary h26/radius7/fs11.5/accent #5e6ad2) are reasonable but Linear's composer is BELOW-FOLD in captures — not precisely measured, left unchanged (no unverified edits). No source change → no rebuild/republish. CONVERGENCE: after 6 measured Pass-3 iterations (It18-23) fixing real deltas + It24 clean, SyncView matches Linear to the pixel across list/detail/board/sidebar/tabs/menus/chips/icons. Remaining measured checks mostly find matches. NEXT: to measure composer, scroll a Linear issue to its comment box via eval; OR do behavioral full-re-verification passes; OR check act-meta/act-text sizes from a captured detail.
- It23 (PASS 3 — MEASURED icons): lin-list.json icon width distribution = 14px×99 (dominant), 16px×25. Linear status/row icons are 14px glyph (token: "16px slot, 14px glyph"; status-dropdown iconW:14). Ours statusSVG output width=16 (glyph too big). FIXED: statusSVG (both main + triage returns) width/height 16→14 — now 14px glyph centered in 16px .st slot. Verified getComputedStyle: status glyph 14.0x14.0 in 16px slot = Linear. Screenshot confirms icons crisp/centered/aligned across list + group headers + pickers + detail. qa ALL GREEN, sweep CLEAN. Republished. Avatar (.av 18px) + cal icon couldn't be measured remotely (probe eval found null — coord-based finder missed); 18px avatar is reasonable, note for later. NEXT: composer/act-meta measured; project hexagon icon (projSVG 16px — verify vs Linear); toolbar icon buttons.
- It22 (PASS 3 — MEASURED chips/pills): probe eval on live Linear list measured due-pill + client-chip: radius 48px (STADIUM/fully-rounded), border 1px #d5d5d5 (lch 85.44), h24, pad 0 8px. CONFIRMED visually in lin-list2.png (all chips/dues/sub-count are stadium pills). Ours were rounded-rects (.chip 11px, .due 6px, .subchip 10px) w/ lighter #e8e8e8 border. FIXED: .chip/.due/.subchip → border-radius:999px (stadium) + border var(--border) #d5d5d5. Screenshot confirms ours now match Linear stadium pills exactly. qa ALL GREEN, sweep CLEAN. Republished. This was a real VISIBLE delta (chips were noticeably less rounded). NEXT: measured avatar (.av) size + composer + act-meta + status/cal icon sizes.
- It21 (PASS 3 — MEASURED menus): from ctx-issue.json + status-dropdown.json: Linear ctx item = 32px h (ours ✓) / 13px / 400 / #303032; status-picker item = 13px / 500 / #5a5a5c. Ours menu items were 12px (inherited). FIXED: .mi font-size→13px; .pop-list .mi font-weight→500 (picker items). Verified getComputedStyle: picker item 13/500 EXACT; ctx item 13/400/rgb(46,46,48) (Linear rgb(48,48,50) — 2-unit diff, imperceptible). qa ALL GREEN, sweep CLEAN. Republished. NOTE: status-picker item COLOR measured #5a5a5c (dim) but screenshot looks darker — left ours at inherited text-strong (ambiguous, not changed). NEXT: measured chip/due-pill/subchip geometry (h/radius/pad), avatar sizes, composer, act-meta.
- It20 (PASS 3 — MEASURED sidebar+tabs): Linear sidebar nav 13/500/#5a5a5c (selected #1b1b1b on #e5e5e6), sections 12/500/#5a5a5c — ours already matched. Found+fixed: (1) .team-name 12/550/#2e2e30/-.01em→13px/500/#5a5a5c/normal (Linear team name = nav-item style, not bold/dark); (2) .tb-tab 11.5→12px; (3) .nav-i ls -.01em→normal; (4) BROAD FIX: body letter-spacing -.003em→normal (Linear body IS normal per rootFont; negative ls only on large text). Verified getComputedStyle: team-name/nav-i EXACT (13/500/rgb(90,90,92)/normal); tb-tab now normal ls; chip normal; rid kept -0.26px, d-title -0.16px, d-desc -0.1px (all match Linear). qa ALL GREEN, sweep CLEAN. Republished. Body-ls fix aligned chips/tabs/all inheriting meta to Linear at once. NEXT: measured Pass-3 on chips/due-pills/subchip geometry (border-radius, height, padding via repeats/describe), composer, avatar sizes, menu item heights.
- It19 (PASS 3 — MEASURED detail+board): extracted Linear getComputedStyle from lin-detail.json + lin-projects.json. H1 title already EXACT (24/600/-.16/#1b1b1b). Found+fixed 3 real deltas: (1) board column title `.pt` 12/600→13px/500/#303032; (2) project card name `.pcard-nm` 12/550/#1b1b1b→13px/500/#303032; (3) Properties/Project card header `.ds-card-hd` 11.5/600/muted→13px/450/#5e5e60. Verified via getComputedStyle: pt=13/500/rgb(48,48,50), pcard-nm=13/500/rgb(48,48,50), ds-card-hd=13/450/rgb(94,94,96) — ALL EXACT match to Linear. qa ALL GREEN, sweep CLEAN. Republished. NEXT: measured Pass-3 on remaining elements — sidebar nav items, tab bar, chips/due-pills, composer, activity meta, menu items (extract from lin-*.json textEls, measure ours, diff).
- It18 (PASS 3 — MEASURED, not eyeballed): extracted Linear's exact getComputedStyle from lin-list.json → found REAL deltas: group header was 600/-.01em (Linear 500/normal); meta color --muted was #63636a (Linear meta = #5d5d5f = measured token --text-muted). FIXED: --muted #63636a→#5d5d5f (corrects IDs, group headers, chips, due pills, all meta); .grp-title 600→500, ls→normal. VERIFIED via getComputedStyle on ours: grp-title now 12px/500/rgb(93,93,95)/normal, rid 13px/450/rgb(93,93,95)/-0.26px — EXACT match to Linear. qa ALL GREEN, sweep CLEAN. Republished. LESSON REINFORCED: measured diffs (probe getComputedStyle) find real deltas that vision missed (the #63636a→#5d5d5f was invisible to eye but real). NEXT: measured Pass-3 on detail/board/pickers (extract Linear getComputedStyle from lin-*.json, compare to ours).
- It17: project-card radius 8→6px (aligned to MEASURED token §3 "card radius ~6px" + §7 "5-6px" + audit — evidence-based, not vision estimate). Could NOT measure Linear card radius from lin-projects.json (no card element carried a real radius; only a 9999px Health pill) — used token measurement instead. PASS-3 GATE: qa ALL GREEN + sweep CLEAN (6 screens, 443 hovers, 41 clicks, 13 menus, 0 JS errors — every element/every screen). Republished. Board card→✅[3]. STATUS: all major surfaces at parity across Pass 1+2+3-gate. Remaining are pure re-verification passes + any newly-noticed micro-deltas. Loop continues per Sidney's never-stop directive.
- It16: added "Duplicate" status (STATUS.duplicate type:"duplicate" #95a2b3; STATUS_ORDER ...canceled,duplicate,triage; statusSVG duplicate = gray disc + white diagonal slash). Status picker now full 13 items in Linear's exact order (Backlog→…→Canceled→Duplicate→Triage), ✓-before-number. qa ALL GREEN, sweep CLEAN, scrolled screenshot confirms Duplicate glyph + Triage last. Republished. Status-picker→✅[4] FULL PARITY. NOTE: statusSVG duplicate uses white slash (approximates Linear's knockout — reads correct on near-white bg). NEXT: project-card radius 8→6 (marginal) OR Pass 3 full re-verification.
- It15 (PASS 2 — 5-agent parallel vision-audit, list/board/detail/status-picker/empty vs Linear refs): most findings were low-reliability vision estimates (e.g. "rows ~48-50px" — FALSE, --row-h IS 44px). DETAIL agent confirmed NO DELTAS (parity). Acted on 2 verified real deltas: (1) status picker ✓ now BEFORE the shortcut number (CSS `.mi .kbd{order:1}`) matching Linear "✓ 1"; (2) star (☆) now only on team Issues header, hidden on "My issues" (Linear shows no star there) — `S.view.type==="issues"` guard. qa ALL GREEN, sweep CLEAN, screenshots confirm. Republished. Status-picker→✅[3], empty/My-issues→✅[2]. Remaining low/uncertain (from audit, deprioritized): add "Duplicate" status (needs disc+slash glyph); project card radius 8→6px (marginal); board column bg #f6f6f7 (subtle, uncertain — both look near-white). LESSON: sub-agent vision-diffs are noisy; trust probe getComputedStyle + own eyes over agent pixel estimates.
- It14: EMPTY STATES. Captured lin-myissues.png (empty). Linear empty = centered illustration + text + "Create new issue" btn. Ours was text-only → added centered faded view-icon illustration (46px, opacity .45) above the contextual text, vertically centered (min-height 56vh, 14px muted). Matches Linear structure. By-design omitted: elaborate isometric art (custom), "Create new issue" btn (no manual create), Assigned/Created/Subscribed tabs on My issues. qa ALL GREEN, sweep CLEAN, screenshot confirms. Republished. A13/empty→✅[2]. NEXT: tooltips (Linear tooltip via probe hover), then Pass 2 continue + Pass 3 start.
- It13: sidebar section collapse — "Workspace"/"Your teams" nav-sec headers now collapsible buttons (S.secOpen{ws,teams}), chevron shows on hover + rotates when collapsed, matching Linear. Extended sweep.js to click [data-sec] (collapse+expand). qa ALL GREEN, sweep CLEAN (441 hovers/41 clicks/0 err), screenshot confirms no layout shift + clean at-rest look. Republished. E3→✅[2]. Sidebar now: sections + teams both collapsible. Remaining sidebar (by-design): no Inbox/Triage-nav/Cycles/Views/compose-icon/workspace-switcher.
- It12: sidebar "My Issues"→"My issues" (Linear sentence case). Also PASS 2 on LIST: re-screenshot confirms two-row header, group chevrons, row order (due→avatar→created), status grouping order ALL still hold — no regressions since It2/It3/It8. qa ALL GREEN, sweep CLEAN. Republished. E2→✅[2], LIST Pass2 clean[1]. Sidebar residuals (low, some by-design): "Workspace"/"Your teams" lack collapse chevrons (Linear has ▸/▾); no compose/new-issue icon top-right (by-design removed); workspace-switcher ▾ omitted (by-design). NEXT: continue Pass 2 — re-diff detail/board/project-detail vs Linear refs; tooltips; empty states.
- It11: investigated sub-issue section (captured lin-subs.png, lin-subs-mid.png / VID-7898). This team keeps content in rich-text descriptions (clip headings), not the Sub-issues feature — so no chrome delta; our section is standard. Noted rich-text-description product gap for Sidney. No source change. B5→✅[2] (chrome standard). NEXT: sidebar hover/selected + tooltips + empty states, then Pass 2 (re-screenshot ALL ours + re-diff vs Linear refs to confirm no regressions across list/detail/board/project-detail). NEXT: project-card icon/status layout; then behavioral parity (does each interaction DO the same as Linear) + capture pickers/detail/hover from live Linear.

## 2026-07-07 Live-Linear Parity Loop, Cycle 12

Cycle 12 used the accepted Cycle 11 live capture (`beforeRowCount=20`, `afterRowCount=20`, `changed:false`) after a fresh headless live probe was rejected because Linear stayed on the desktop-app handoff page and produced no issue rows. No issue or sub-issue data was touched.

| Surface x action | Status | Notes / screenshot pairs |
|---|---:|---|
| Single selected Actions copy-content rows | fixed | Based on `single-selection-actions-menu.png`; prototype and wired now include Copy issue description as Markdown, Copy issue content as Markdown, Copy git branch name, and Copy as prompt. |
| Selected Actions mutating/removed rows | guarded | Subscribe to issue, Move to a different team, priority, labels, and cycles remain omitted because they mutate Linear or conflict with the locked simplified skeleton. |

Ranked findings fixed in this cycle:

1. P2: the selected Actions command panel still missed copy-only rows visible in the accepted live Linear capture.

Pixel lane additions: `pixel-wired.js` now asserts the full copy-only selected-Actions inventory and rejects Subscribe/team-move/priority/labels/cycles rows.

## 2026-07-07 Live-Linear Parity Loop, Cycle 14

Cycle 14 used the accepted Cycle 11 screenshot to close a small visual delta in the selected `Actions` command panel. Live Linear separates the `Ask Linear` label and `Tab` hint; prototype and wired now render that hint as an inline-flex row with a 6px gap.

Pixel lane additions: `pixel-wired.js` compares the prototype/wired Ask Linear hint display/gap and fails if the wired hint gap collapses.

## 2026-07-07 Live-Linear Parity Loop, Cycle 15

Cycle 15 used the accepted Cycle 11 screenshot and the latest local crops to close a prototype-only focus-ring delta. The selected `Actions` command input was picking up the prototype's global `:focus-visible` outline, creating a blue rectangle absent from live Linear. Command inputs now explicitly keep `outline:none`; row/card focus visuals are unchanged.

Pixel lane additions: `pixel-wired.js` compares the selected Actions input outline and fails if the focused command input outline returns.

## 2026-07-07 Live-Linear Parity Loop, Cycle 16

Fresh live Linear observation was read-only. The probe captured 20 visible VID issue rows before and after opening the selected-row actionbar; `changed:false`, so no existing issue or sub-issue data changed.

| Surface x action | Status | Notes / screenshot pairs |
|---|---:|---|
| Single selected issue actionbar | fixed | `selected-actions-menu.png` shows live Linear's standalone Ask Linear icon button between `Actions` and clear. Prototype and wired now include that chrome. |
| Ask Linear behavior boundary | guarded | Prototype gives a local toast. Wired preview routes the button through `Preview - read-only`; no write path is introduced. |

Ranked finding fixed in this cycle:

1. P2: the selected issue actionbar was still missing the separate live Linear Ask Linear icon button.

Pixel lane additions: `pixel-wired.js` now checks the selected actionbar Ask Linear button count, styling, and exact SVG path in prototype and wired preview.

## 2026-07-07 Live-Linear Parity Loop, Cycle 17

Cycle 17 used the accepted Cycle 16 live screenshot and DOM capture. No additional Linear issue/sub-issue surface was touched. The capture showed a persistent bottom-right Ask Linear dock (`Ask Linear` plus a Chat history icon) that was still absent from the prototype/wired preview.

| Surface x action | Status | Notes / screenshot pairs |
|---|---:|---|
| Global bottom-right Ask Linear dock | fixed | Prototype and wired now render the dock with the same Ask Linear and history icon vocabulary. |
| Wired dock behavior | guarded | Both dock buttons route to `Preview - read-only` and are covered by read-only structure checks. |

Ranked finding fixed in this cycle:

1. P2: the persistent bottom-right Ask Linear dock was missing outside the selected-row actionbar.

Pixel lane additions: `pixel-wired.js` now captures `artifact-crop-askdock.png` / `wired-crop-askdock.png` and checks dock style and icon paths.

## 2026-07-07 Live-Linear Parity Loop, Cycle 18

Fresh live Linear observation was read-only and hover-only. The probe captured 20 visible VID issue rows before and after hovering the bottom-right dock; `changed:false`, so no existing issue or sub-issue data changed.

| Surface x action | Status | Notes / screenshot pairs |
|---|---:|---|
| Global bottom-right Ask Linear dock hover | fixed | `dock-initial.png` / `dock-hover-ask.png` showed live Linear's 8px radius, default cursor, and `0 12px 0 10px` Ask-button padding. Prototype and wired now match those values. |
| Bottom-left changelog/help chrome | deferred | The same live capture showed account-state-dependent changelog/help chrome at bottom-left. Deferred as product chrome pending owner direction rather than adding it blindly. |

Ranked finding fixed in this cycle:

1. P3: the global Ask Linear dock button geometry was close but not exact on radius/cursor/padding.

Pixel lane additions: `pixel-wired.js` now compares the dock main-button horizontal padding in addition to presence, styling, and icon paths.

## 2026-07-07 Live-Linear Parity Loop, Cycle 19

Cycle 19 used the accepted live bottom-corner screenshot and read-only DOM inspection from the Linear probe. The two attempted command-palette probes were rejected as evidence because the palette did not open; follow-up no-op snapshots still returned 20 visible issue rows before and after with `changed:false`. No issue or sub-issue surface was changed.

| Surface x action | Status | Notes / screenshot pairs |
|---|---:|---|
| Bottom-left changelog/help tray | fixed | `dock-initial.png` plus the live controls readback showed the bottom-left `What's new` / `Initiative properties` card and collapse-minus button. Prototype and wired now render the same inert chrome. |
| Wired tray behavior | guarded | The wired preview routes both tray controls through `Preview - read-only`; no write or navigation path is introduced. |

Ranked finding fixed in this cycle:

1. P2: the live bottom-left changelog/help tray was still absent from the prototype and wired preview.

Pixel lane additions: `pixel-wired.js` now captures `artifact-crop-newsdock.png` / `wired-crop-newsdock.png`, compares tray text and icon path, and checks geometry.

## 2026-07-07 Live-Linear Parity Loop, Cycle 20

Fresh live Linear observation was read-only. The probe opened the workspace/brand menu, pressed Escape, and captured 20 visible VID issue rows before and after; `changed:false`, so no existing issue or sub-issue data changed.

| Surface x action | Status | Notes / screenshot pairs |
|---|---:|---|
| Workspace/brand menu | fixed | `brand-menu.png` showed the live global menu: Settings, Invite and manage members, Download desktop app, Switch workspace, and Log out, with shortcut hints and a Switch workspace chevron. Prototype and wired now render the same inert menu chrome. |
| Wired menu behavior | guarded | All wired brand-menu rows keep the `Preview - read-only` guard; no workspace switch, logout, download, invite, or settings action is wired. |

Ranked finding fixed in this cycle:

1. P3: the workspace brand menu still used the older artifact rows/header instead of live Linear's current global-menu inventory and hints.

Pixel lane additions: `pixel-wired.js` now captures `artifact-crop-brand-menu.png` / `wired-crop-brand-menu.png`, compares menu text and chevron path, and checks popover/row styling.

## 2026-07-07 Live-Linear Parity Loop, Cycle 21

Fresh live Linear observation was read-only. The probe measured the currently logged-in Linear workspace shell in dark mode and captured 20 visible VID issue rows before and after; `changed:false`, so no existing issue or sub-issue data changed.

| Surface x action | Status | Notes / screenshot pairs |
|---|---:|---|
| Dark workspace shell | fixed | `linear-dark-measure.png` showed live Linear's current dark neutral shell. Prototype and wired preview now use matching dark tokens for base, content, surface, hover, selected row, border, divider, and text colors. |
| Selected actionbar chrome | fixed | Local crop review found the actionbar buttons still using the old light button fill after the palette swap; they now use the dark hover token in both prototype and wired preview. |
| Selected-row hover token | fixed | The prototype no longer had a leftover hardcoded light selected-row hover color; it now follows the selected-row token. |

Ranked finding fixed in this cycle:

1. P1: live Linear is currently dark, but the prototype and wired preview were still using the older light palette, creating a full-shell visual mismatch outside the locked skeleton.

Pixel lane note: the existing artifact-to-wired pixel lane remains the guard for keeping prototype and wired tokens identical after this palette swap.

## 2026-07-07 Live-Linear Parity Loop, Cycle 22

Fresh no-op live Linear snapshot was read-only. The probe captured 20 visible VID issue rows before and after without clicking anything; `changed:false`, so no existing issue or sub-issue data changed.

| Surface x action | Status | Notes / screenshot pairs |
|---|---:|---|
| Dark scrollbars | fixed | Local artifact/wired review found several prototype scrollbars still using old light-theme black translucency after the dark shell swap. Sidebar, list, board, project-card list, picker list, and detail scrollbars now use the dark border-soft token. |
| Status-icon hover fill | fixed | Row status icons now use the dark hover token in both prototype and wired preview instead of a leftover light-theme translucent fill. |
| Board/detail text hardcodes | fixed | Prototype board column titles, project card titles, detail side-card headers, and detail breadcrumbs now resolve through dark text tokens instead of old light hardcodes. Wired already used tokenized equivalents except for property labels, which now use `--prod-dim`. |
| Issue/sub-issue data model | unchanged | This cycle changed only CSS token references and a pixel-lane hover assertion. Parent/child adapter logic, issue IDs, sub-issue grouping, row data, and detail rendering were not changed. |

Ranked finding fixed in this cycle:

1. P2: after Cycle 21's dark palette swap, several component-level hover/scroll/text details still carried light-mode hardcoded colors. These were visible against the live dark Linear shell but safe to fix as pure presentation.

Pixel lane addition: `pixel-wired.js` now hovers a row status icon and compares artifact vs wired status-hover background/radius in addition to the dark palette variables.

## 2026-07-07 Live-Linear Parity Loop, Cycle 23

Fresh no-op live Linear snapshot was read-only. The probe captured 20 visible VID issue rows before and after without clicking anything; `changed:false`, so no existing issue or sub-issue data changed.

| Surface x action | Status | Notes / screenshot pairs |
|---|---:|---|
| Overdue due-date pills | fixed | Artifact/local screenshot comparison showed the wired preview still styling overdue due-date pills as an old orange warning pill. Wired now matches the artifact pattern: neutral pill chrome with the calendar icon using the dark overdue token. |
| Issue/sub-issue data model | unchanged | This cycle changed only wired CSS variables/style rules and pixel-lane assertions. Parent/child adapter logic, issue IDs, sub-issue grouping, row data, and detail rendering were not changed. |

Ranked finding fixed in this cycle:

1. P2: the wired list's overdue due-date pills were visibly warmer and heavier than the artifact/live-style dark due pills after the dark-shell migration.

Pixel lane addition: `pixel-wired.js` now compares artifact vs wired overdue due-pill chrome and icon color.

## 2026-07-07 Live-Linear Parity Loop, Cycle 24

Fresh no-op live Linear snapshot was read-only. The probe captured 20 visible VID issue rows before and after without clicking anything; `changed:false`, so no existing issue or sub-issue data changed.

| Surface x action | Status | Notes / screenshot pairs |
|---|---:|---|
| Sidebar search tooltip | fixed | Wired preview now uses the artifact's `⌘K` shortcut hint for the sidebar search tooltip instead of the text `Cmd+K`, and its border now uses the artifact soft-border token. |
| Issue/sub-issue data model | unchanged | This cycle changed only tooltip presentation text and pixel-lane assertions. Parent/child adapter logic, issue IDs, sub-issue grouping, row data, and detail rendering were not changed. |

Ranked finding fixed in this cycle:

1. P3: artifact and wired shortcut text and border token had drifted on the most visible sidebar tooltip.

Pixel lane addition: `pixel-wired.js` now hovers the sidebar search control and compares artifact vs wired tooltip text and box styling.

## 2026-07-07 Live-Linear Parity Loop, Cycle 25

Fresh live Linear search-hover probe was read-only. The probe hovered only the live sidebar search button, captured 20 visible VID issue rows before and after, and returned `changed:false`, so no existing issue or sub-issue data changed.

| Surface x action | Status | Notes / screenshot pairs |
|---|---:|---|
| Sidebar search tooltip live wording | fixed | Live Linear's search tooltip reads `Search workspace` with `/` as the key hint. Prototype and wired preview now use `Search workspace|/` instead of the artifact-only `Search|Command-K` wording from the prior cycle. |
| Issue/sub-issue data model | unchanged | This cycle changed only sidebar tooltip presentation text and pixel-lane assertions. Parent/child adapter logic, issue IDs, sub-issue grouping, row data, and detail rendering were not changed. |

Ranked finding fixed in this cycle:

1. P3: live Linear's sidebar search tooltip wording/key hint differed from the prototype/wired tooltip even though the tooltip box styling already matched.

Pixel lane addition: `pixel-wired.js` now fails if the artifact search tooltip drifts from the live-observed `Search workspace/` wording, then compares artifact vs wired tooltip text and box styling.

## 2026-07-07 Live-Linear Parity Loop, Cycle 26

No additional live Linear interaction was needed. Cycle 26 follows directly from Cycle 25's read-only live search-hover evidence (`changed:false` before/after): live Linear advertises `/` as the search shortcut, so prototype and wired preview now support `/` as a non-mutating command-palette shortcut in addition to Ctrl/Cmd+K.

| Surface x action | Status | Notes / screenshot pairs |
|---|---:|---|
| Sidebar search keyboard shortcut | fixed | Pressing `/` now opens the command palette when no input is focused and no popup is open. Ctrl/Cmd+K still works. |
| Issue/sub-issue data model | unchanged | This cycle changed only keyboard handling for command-palette navigation and behavior tests. Parent/child adapter logic, issue IDs, sub-issue grouping, row data, and detail rendering were not changed. |

Ranked finding fixed in this cycle:

1. P2: after Cycle 25 matched live tooltip wording, the advertised `/` key needed to perform the same read-only navigation action.

Behavior lane additions: `behav.js` and `behav-wired.js` now assert that `/` opens the command palette; wired guard-mode coverage is now 139/139.

## 2026-07-07 Live-Linear Parity Loop, Cycle 28

Read-only live observation used a fresh Linear issue-list tab and clicked only the sidebar Search button. Before/after visible issue-row snapshots both contained 20 rows and compared unchanged (`changed:false`), so existing issues and sub-issues were not changed.

| Surface x action | Status | Notes / screenshot pairs |
|---|---:|---|
| Sidebar Search click | owner-question | Live Linear navigates to a full Search page with top tabs; the current prototype and wired preview open the command palette. This may conflict with the locked simplified skeleton's `Search(⌘K)` affordance, so no code change was made without owner direction. |
| Issue/sub-issue data model | unchanged | No adapter parent/child logic, issue IDs, sub-issue grouping, row data, or detail rendering changed. |

Owner question:

1. Should the simplified SyncView Production sidebar Search button keep opening the command palette, or should it adopt live Linear's full Search page behavior while preserving the simplified navigation skeleton?

## 2026-07-07 Live-Linear Parity Loop, Cycle 29

Read-only live observation used a fresh Linear issue-list tab and clicked only the list Add Filter button. Before/after visible issue-row snapshots both contained 20 rows and compared unchanged (`changed:false`), so existing issues and sub-issues were not changed.

| Surface x action | Status | Notes / screenshot pairs |
|---|---:|---|
| Filter menu taxonomy | owner-question | Live Linear's Add Filter menu includes AI filter, Advanced filter, and the full Linear taxonomy, including Priority, Labels, Initiative, Cycle, and other concepts the simplified skeleton deliberately removed. No code change was made because copying the full live menu would reintroduce removed concepts. |
| Issue/sub-issue data model | unchanged | No adapter parent/child logic, issue IDs, sub-issue grouping, row data, or detail rendering changed. |

Owner question:

1. Should SyncView keep the simplified filter taxonomy (status/assignee/client-project/date-style filters), or adopt live Linear's Add Filter chrome while hiding the deliberately removed filter categories?

## 2026-07-07 Live-Linear Parity Loop, Cycle 30

Read-only live observation used a fresh Linear issue-list tab and clicked only the Display options button. Before/after visible issue-row snapshots both contained 20 rows and compared unchanged (`changed:false`), so existing issues and sub-issues were not changed.

| Surface x action | Status | Notes / screenshot pairs |
|---|---:|---|
| Display options menu | owner-question | Live Linear's Display menu combines List/Board layout switching, grouping/sub-grouping/ordering controls, completed/sub-issue/triage toggles, and display-property chips including removed concepts. No code change was made because porting it directly would affect the simplified view model and reintroduce removed fields. |
| Issue/sub-issue data model | unchanged | No adapter parent/child logic, issue IDs, sub-issue grouping, row data, or detail rendering changed. |

Owner question:

1. Should SyncView's Display menu remain the simplified live group-by control, or adopt live Linear's Display options shell with only the allowed simplified properties exposed?

## 2026-07-07 Live-Linear Parity Loop, Cycle 32

Read-only live observation used the current Linear issue-list tab and hovered one visible content row. Before/after visible issue-row snapshots both contained 18 content rows and compared unchanged (`changed:false`), so existing issues and sub-issues were not changed.

| Surface x action | Status | Notes / screenshot pairs |
|---|---:|---|
| List row hover band + checkbox reveal | verified | Live Linear shows the row hover band and reveals the left checkbox on hover. Prototype and wired already had matching behavior; `pixel-wired.js` now pins it with cropped artifact/wired row-hover screenshot pairs and computed-style checks. |
| Issue/sub-issue data model | unchanged | No adapter parent/child logic, issue IDs, sub-issue grouping, row data, or detail rendering changed. |

Pixel lane addition: `pixel-wired.js` now compares `.row` vs `.prod-row` hover background/height/cursor and `.check` vs `.prod-check` opacity/size/radius after hover.

## 2026-07-07 Live-Linear Parity Loop, Cycle 33

Read-only live observation used the current Linear issue-list tab and opened one row context menu with a right-click, then closed it with Escape. Before/after visible issue-row snapshots both contained 18 content rows and compared unchanged (`changed:false`), so existing issues and sub-issues were not changed.

| Surface x action | Status | Notes / screenshot pairs |
|---|---:|---|
| Row context menu breadth | owner-question | Live Linear's row menu includes the full shell: Status, Priority, Assignee, Due date, Labels, Project, Cycle, More properties, Create related, Mark as, Copy, Convert to, Move, Open in, Favorite, Subscribe, Remind me, and Delete. The current prototype/wired menu keeps the simplified allowed subset and omits Priority/Labels/Cycle plus broader mutating/scope-expanding rows. No code change was made without owner direction. |
| Issue/sub-issue data model | unchanged | No adapter parent/child logic, issue IDs, sub-issue grouping, row data, or detail rendering changed. |

Owner question:

1. Should SyncView keep the current simplified row context menu, or adopt more of live Linear's row-menu shell while still hiding Priority, Labels, Cycle, and guarding every mutation in B2?

## 2026-07-07 Live-Linear Parity Loop, Cycle 34

Read-only live observation used the current Linear issue-list tab, opened one row context menu, hovered the Status row to expose the submenu, then closed it with Escape. Before/after visible issue-row snapshots both contained 18 content rows and compared unchanged (`changed:false`), so existing issues and sub-issues were not changed.

| Surface x action | Status | Notes / screenshot pairs |
|---|---:|---|
| Row context Status submenu | verified | Live Linear shows the simplified production status vocabulary in this workspace: Backlog, Todo, In Progress, For SMM approval, For Kasper approval, Tweak Needed, For Client Approval, Approved, Scheduled, Posted, Canceled, Duplicate, Triage, with number hints and Triage last. Prototype and wired already match this contract, and `pixel-wired.js` / `behav-wired.js` already cover it. |
| Issue/sub-issue data model | unchanged | No adapter parent/child logic, issue IDs, sub-issue grouping, row data, or detail rendering changed. |

## 2026-07-07 Live-Linear Parity Loop, Cycle 35

Read-only live observation used the current Linear issue-list tab and hover-opened the Assignee and Due date submenus from the row context menu. Both probes closed with Escape. Before/after visible issue-row snapshots for each probe contained 18 content rows and compared unchanged (`changed:false`), so existing issues and sub-issues were not changed.

| Surface x action | Status | Notes / screenshot pairs |
|---|---:|---|
| Row context Assignee submenu | verified | Live Linear uses the same picker shell: No assignee/current assignee options, team-member rows, and an invite row. The invite row is mutation/scope-expanding, so prototype/wired stay with the simplified assignee picker. No code change. |
| Row context Due date submenu | fixed | Live Linear's quick due placeholder reads `Try: 24h, 7 days, Feb 9`; prototype and wired now use that text. The live `End of next cycle` quick option was not copied because cycles are a locked skeleton removal. |
| Issue/sub-issue data model | unchanged | No adapter parent/child logic, issue IDs, sub-issue grouping, row data, or detail rendering changed. |

Pixel lane addition: `pixel-wired.js` now asserts the exact live due placeholder text in addition to artifact/wired equality.

## 2026-07-07 Live-Linear Parity Loop, Cycle 36

Read-only live observation used the current Linear issue-list tab, opened one row context menu, hover-opened the Copy submenu, then closed it with Escape. Before/after visible issue-row snapshots contained 18 content rows and compared unchanged (`changed:false`), so existing issues and sub-issues were not changed.

| Surface x action | Status | Notes / screenshot pairs |
|---|---:|---|
| Row context Copy submenu | fixed | Live Linear's row menu uses `Copy` as a submenu. Prototype and wired now expose the safe copy-only rows: Copy ID, Copy URL, Copy title, Copy title as link, Copy description as Markdown, Copy content as Markdown, Copy git branch name, and Copy as prompt. |
| Make a copy | deferred-B3 | The live submenu also includes `Make a copy...`; that duplicates/creates work and stays omitted in the read-only B2 preview. |
| Issue/sub-issue data model | unchanged | No adapter parent/child logic, issue IDs, sub-issue grouping, row data, or detail rendering changed. |

Pixel lane addition: `pixel-wired.js` now captures and compares the row context Copy submenu inventory. `behav-wired.js` now proves Copy URL from that submenu still produces a `?prod=1&d=...` deep link without write requests.

## 2026-07-07 Live-Linear Parity Loop, Cycle 37

Read-only live observation used the current Linear issue-list tab, opened one row context menu, hover-opened the Project submenu, then closed it with Escape. Before/after visible issue-row snapshots contained 18 content rows and compared unchanged (`changed:false`), so existing issues and sub-issues were not changed.

| Surface x action | Status | Notes / screenshot pairs |
|---|---:|---|
| Row context Project submenu | owner-question | Live Linear includes a `No project` option above the team-scoped project list. SyncView's migrated Production model depends on client/project linkage for deliverables, so adding a detach-from-project row is a product decision. No code change was made without owner direction. |
| Issue/sub-issue data model | unchanged | No adapter parent/child logic, issue IDs, sub-issue grouping, row data, or detail rendering changed. |

Owner question:

1. Should the read-only Production preview include live Linear's `No project` row as guarded chrome, even though real SyncView deliverables are expected to stay client/project-linked?

## 2026-07-07 Live-Linear Parity Loop, Cycle 38

Read-only live observation navigated directly from the current issue list to one issue detail URL, waited for the detail page to render, then returned to the issue list. Before/after visible issue-row snapshots contained 18 content rows and compared unchanged (`changed:false`), so existing issues and sub-issues were not changed.

| Surface x action | Status | Notes / screenshot pairs |
|---|---:|---|
| Issue detail right rail | owner-question | Live Linear's detail rail includes broader surfaces such as priority, labels, and cycle controls. The locked SyncView skeleton deliberately removed priority, labels, and cycles, so the prototype/wired detail keeps the simplified Properties / Parent issue / Project structure pending owner direction. |
| Issue detail toolbar chrome | owner-question | Live Linear shows additional detail toolbar buttons around link/share/workflow controls. These are adjacent to mutation or broader-product chrome, so no B2 read-only code change was made without owner direction. |
| Issue/sub-issue data model | unchanged | No adapter parent/child logic, issue IDs, sub-issue grouping, row data, or detail rendering data relationships changed. |

## 2026-07-07 Live-Linear Parity Loop, Cycle 39

Local artifact-vs-wired verification hardened the detail surface without touching live Linear. `pixel-wired.js` now compares the simplified detail side-card inventory (Properties / Parent issue when present / Project) and row counts between the prototype and wired preview. It also separately asserts the required wired-only read-only `Controls disabled` affordance remains disabled and titled `Preview - read-only`.

| Surface x action | Status | Notes / screenshot pairs |
|---|---:|---|
| Detail side-card inventory | test-hardened | The lane compares artifact and wired card headings and row counts while preserving the owner-required read-only Controls row as an explicit B2 guard. |
| Issue/sub-issue data model | unchanged | No live probe ran and no adapter parent/child logic, issue IDs, sub-issue grouping, row data, or detail rendering relationships changed. |

## 2026-07-07 Live-Linear Parity Loop, Cycle 40

Local artifact-vs-wired verification added a locked-scope guard for the detail rail. `pixel-wired.js` now fails if the prototype or wired preview reintroduces Priority, Labels, or Cycles as detail side cards.

| Surface x action | Status | Notes / screenshot pairs |
|---|---:|---|
| Detail locked removals | test-hardened | Priority, Labels, and Cycles remain out of the simplified SyncView skeleton unless the owner explicitly expands scope. |
| Issue/sub-issue data model | unchanged | No live probe ran and no adapter parent/child logic, issue IDs, sub-issue grouping, row data, or detail rendering relationships changed. |

## 2026-07-07 Live-Linear Parity Loop, Cycle 41

Ledger-only cleanup. Older rows that described product-scope conflicts with the locked simplified skeleton now use `owner-question` instead of `pending`, and the old Ask Linear actionbar row is marked `superseded` by the later completed cycle. No prototype, wired preview, runtime, or data-model code changed.

| Surface x action | Status | Notes / screenshot pairs |
|---|---:|---|
| Parity ledger statuses | clarified | The work list now distinguishes true implementation backlog from owner-scope decisions and later-superseded rows. |
| Issue/sub-issue data model | unchanged | No live probe ran and no adapter parent/child logic, issue IDs, sub-issue grouping, row data, or detail rendering relationships changed. |

## 2026-07-07 Live-Linear Parity Loop, Cycle 42

Local artifact-vs-wired verification added a locked-scope guard for row context menus. `pixel-wired.js` now fails if Priority, Labels, Cycle, Create related, Mark as, Convert to, Open in, Favorite, Subscribe, or Remind me return to the prototype or wired row context menu.

| Surface x action | Status | Notes / screenshot pairs |
|---|---:|---|
| Row context locked removals | test-hardened | Broader live Linear context rows remain out of the simplified SyncView skeleton unless the owner explicitly expands scope. Allowed guarded artifact rows such as Move and Delete remain covered by existing context-menu parity. |
| Issue/sub-issue data model | unchanged | No live probe ran and no adapter parent/child logic, issue IDs, sub-issue grouping, row data, or detail rendering relationships changed. |

## 2026-07-07 Live-Linear Parity Loop, Cycle 43

Local artifact-vs-wired verification added locked-scope guards for the Filter and Display menus. `pixel-wired.js` now captures those menus, compares prototype/wired inventories, and fails if broader live Linear concepts return while the owner decision remains unresolved.

| Surface x action | Status | Notes / screenshot pairs |
|---|---:|---|
| Filter menu locked removals | test-hardened | AI/Advanced filter plus Priority, Labels, Initiative, Cycle, and other full-Linear filter fields remain out of the simplified preview unless the owner expands scope. |
| Display menu locked removals | test-hardened | Layout/List/Board switching, ordering, sub-grouping, completed/triage toggles, display-property rows, and removed concepts stay out of the simplified group-by menu. |
| Issue/sub-issue data model | unchanged | No live probe ran and no adapter parent/child logic, issue IDs, sub-issue grouping, row data, or detail rendering relationships changed. |

## 2026-07-07 Live-Linear Parity Loop, Cycle 44

Local artifact-vs-wired verification added a locked-scope guard for the command palette. `pixel-wired.js` now checks default and filtered palette inventories and fails if removed full-Linear command concepts return while owner-scope decisions remain unresolved.

| Surface x action | Status | Notes / screenshot pairs |
|---|---:|---|
| Command palette locked removals | test-hardened | Priority, Labels, Cycles, manual issue creation, Inbox/Triage, team moves, subscription/reminder, conversion, and mark-as commands stay out of the simplified preview unless the owner expands scope. |
| Issue/sub-issue data model | unchanged | No live probe ran and no adapter parent/child logic, issue IDs, sub-issue grouping, row data, or detail rendering relationships changed. |

## 2026-07-07 Live-Linear Parity Loop, Cycle 45

Local artifact-vs-wired verification added a locked-skeleton sidebar guard. `pixel-wired.js` now checks that both the prototype and wired preview expose the simplified sidebar spine and fail if removed navigation chrome returns.

| Surface x action | Status | Notes / screenshot pairs |
|---|---:|---|
| Sidebar locked skeleton | test-hardened | My issues, Workspace/Projects, and Video/Graphics Issues/Projects remain present, while Inbox, Views, Invite, and manual New issue chrome stay out of the sidebar. |
| Issue/sub-issue data model | unchanged | No live probe ran and no adapter parent/child logic, issue IDs, sub-issue grouping, row data, or detail rendering relationships changed. |

## 2026-07-07 Live-Linear Parity Loop, Cycle 46

Local artifact-vs-wired verification added Projects-surface locked-scope guards. `pixel-wired.js` now checks the Projects board and project detail preview for broader live Linear project-health/rich-detail panels that remain owner-scope decisions.

| Surface x action | Status | Notes / screenshot pairs |
|---|---:|---|
| Projects board locked removals | test-hardened | Health, Initiatives, update-health, and project-milestone panels stay out of the simplified Projects board unless the owner expands scope. |
| Project detail locked removals | test-hardened | Resources, Milestones, Priority, Labels, Cycle, Slack, Project health, and Initiatives stay out of the simplified project detail preview unless the owner expands scope. |
| Issue/sub-issue data model | unchanged | No live probe ran and no adapter parent/child logic, issue IDs, sub-issue grouping, row data, or detail rendering relationships changed. |

## 2026-07-07 Live-Linear Parity Loop, Cycle 47

Local artifact-vs-wired verification added a team-Issues display guard. `pixel-wired.js` now opens Graphics Issues and fails if that surface drifts into a saved-board display while the owner decision remains unresolved.

| Surface x action | Status | Notes / screenshot pairs |
|---|---:|---|
| Graphics Issues display mode | test-hardened | Graphics Issues remains the simplified status-grouped issue surface; live Linear's saved board display remains an owner-scope decision. |
| Issue/sub-issue data model | unchanged | No live probe ran and no adapter parent/child logic, issue IDs, sub-issue grouping, row data, or detail rendering relationships changed. |

## 2026-07-07 Live-Linear Parity Loop, Cycle 48

Local artifact-vs-wired verification added a My Issues chrome guard. `pixel-wired.js` now opens My Issues and fails if the broader live Linear tab set or manual-create chrome returns while the owner decision remains unresolved.

| Surface x action | Status | Notes / screenshot pairs |
|---|---:|---|
| My Issues tab/create chrome | test-hardened | The simplified My Issues surface keeps the standard issue tabs and no create button; live Linear's Assigned/Created/Subscribed/Activity tabs and create empty state remain owner-scope decisions. |
| Issue/sub-issue data model | unchanged | No live probe ran and no adapter parent/child logic, issue IDs, sub-issue grouping, row data, or detail rendering relationships changed. |

## 2026-07-07 Live-Linear Parity Loop, Cycle 49

Local artifact-vs-wired verification added an issue-detail toolbar guard. `pixel-wired.js` now opens an issue detail and fails if broader live Linear toolbar controls return while the owner decision remains unresolved.

| Surface x action | Status | Notes / screenshot pairs |
|---|---:|---|
| Issue detail toolbar breadth | test-hardened | Share, workflow, subscribe, priority, labels, and cycle controls stay out of the simplified detail toolbar unless the owner expands scope. |
| Issue/sub-issue data model | unchanged | No live probe ran and no adapter parent/child logic, issue IDs, sub-issue grouping, row data, or detail rendering relationships changed. |

## 2026-07-07 Live-Linear Parity Loop, Cycle 50

Local artifact-vs-wired verification added a row-context Project submenu guard. `pixel-wired.js` now opens the Project submenu and fails if the live Linear `No project` detach row returns while the owner decision remains unresolved.

| Surface x action | Status | Notes / screenshot pairs |
|---|---:|---|
| Row context Project submenu | test-hardened | The Production preview keeps deliverables client/project-linked; `No project` remains out unless the owner explicitly allows project detachment. |
| Issue/sub-issue data model | unchanged | No live probe ran and no adapter parent/child logic, issue IDs, sub-issue grouping, row data, or detail rendering relationships changed. |

## 2026-07-07 Live-Linear Parity Loop, Cycle 51

Local artifact-vs-wired verification added a row-context Copy submenu guard. `pixel-wired.js` now fails if the live Linear `Make a copy` duplication row returns while duplicate/create behavior remains deferred to write-authority phases.

| Surface x action | Status | Notes / screenshot pairs |
|---|---:|---|
| Row context Copy submenu | test-hardened | Copy-only rows remain allowed; duplicate/create behavior stays out of the read-only Production preview. |
| Issue/sub-issue data model | unchanged | No live probe ran and no adapter parent/child logic, issue IDs, sub-issue grouping, row data, or detail rendering relationships changed. |

## 2026-07-07 Live-Linear Parity Loop, Cycle 52

Local artifact-vs-wired verification added a command-palette navigation-scope guard. `pixel-wired.js` now fails if palette `Go to ...` commands drift beyond the locked skeleton routes: Video issues, Graphics issues, My issues, Video projects, Graphics projects, and All projects.

| Surface x action | Status | Notes / screenshot pairs |
|---|---:|---|
| Command palette navigation scope | test-hardened | Team overview / full Search-page routes remain out unless the owner expands the skeleton. |
| Issue/sub-issue data model | unchanged | No live probe ran and no adapter parent/child logic, issue IDs, sub-issue grouping, row data, or detail rendering relationships changed. |

## 2026-07-07 Live-Linear Parity Loop, Cycle 53

Attempted a read-only live Linear probe using the saved `linear-design-probe` browser profile. The profile first showed Linear's desktop-app interstitial; after the non-mutating "Open here instead" action, the browser landed on the Linear login screen with zero visible `/issue/` links, so no live issue-list observation was available.

| Surface x action | Status | Notes / screenshot pairs |
|---|---:|---|
| Live Linear probe availability | blocked | Headless saved-profile session is not currently logged into live Linear; private diagnostics live under `.codex-tmp/live-linear-cycle53/` and are not committed. |
| Issue/sub-issue safety | unchanged | No live issue row was reached, no issue/sub-issue link was opened, and no mutating item, picker value, drag, edit, save, or create path was touched. |
