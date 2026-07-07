# Linear Design Tokens — measured from the live SynchroSocial workspace

**Purpose:** a pixel-accurate design-token spec for rebuilding the Linear
issue/project experience inside SyncView. Hand this to the design assistant to
snap the mockup to exact values, and to Codex as the build spec.

> **Status 2026-07-07:** the live workspace shell is currently dark. Cycle 21
> added a sanitized dark-shell measurement (`lin-dark-shell.json`) and moved the
> prototype + wired read-only preview to the dark neutral shell. The older light
> measurements below remain the historical component geometry/type source unless
> a newer cycle explicitly supersedes a value. Cycle 22 removed leftover light
> component fills from scrollbars/status hovers and moved board/detail hardcoded
> text colors onto the same dark shell tokens. Cycle 23 aligned wired overdue
> due-date pills to the artifact pattern: neutral pill chrome, overdue color on
> the calendar icon.
> Phase 2 (behavioral parity) added new *component* styles in the prototype source
> (e.g. `.act-sys` activity rows, `.pcard-check`/`.pcard-sel` board selection,
> `.pop-empty` picker empty-state, `.composer-hint`, action-bar quick-action buttons) —
> these are interaction affordances, not re-measured Linear tokens. See `out/PARITY-LOOP.md`
> for the behavioral changelog and `out/SyncView.html` / `out/syncview-app.src.html` for the CSS.

**How this was measured (per `synchrosocial/docs/pixel-matching-playbook.md`):**
a headed Playwright + Chromium browser loaded the *live* workspace
(`linear.app/synchro-social`) at a **1440 px** CSS viewport, and values were read
off the rendered DOM with `getComputedStyle()` + `getBoundingClientRect()` —
keyed off element **text**, not class names (Linear ships hashed classes). Colors
are authored by Linear in **`lch()`**; each was resolved to sRGB **hex** through
the browser's own canvas engine (exact, not eyeballed). Screenshots were captured
full-page at 1440 px CSS width, exported at 2× (2880 px) for clarity.

**Theme:** the current logged-in workspace runs Linear in **DARK mode**. The
Cycle 21 shell palette is the active prototype/wired palette; most detailed
component measurements below were captured earlier in light mode and remain
useful for geometry, icon, menu, and behavior parity.

**Screens measured:** Video › Issues (list, `/team/VID/all`) · My Issues
(`/my-issues/assigned`) · an open issue (`/issue/VID-7624`) · Projects board
(`/projects/all`). Screenshots sit next to this file (`01-issues-board.png`,
`02-my-issues.png`, `03-open-issue.png`, `04-projects.png`, `status-dropdown.png`).

---

## 0. Current dark shell palette (Cycle 21 addendum)

Captured read-only from the live workspace at a 1440 px viewport. The accepted
probe recorded 20 visible issue rows before and after, with `changed:false`; no
issue or sub-issue data changed. Live issue text was not retained in the public
measurement artifact.

```css
:root {
  --bg:            #070708;
  --bg-content:    #0c0c0d;
  --surface:       #151518;
  --bg-column:     #111113;
  --hover:         #1e1e21;
  --selected-nav:  #1f1f22;
  --selected-row:  #171923;
  --menu-hover:    #1f1f22;
  --border:        #2a2a2d;
  --border-soft:   #242428;
  --divider:       #1d1d20;
  --text:          #f4f4f5;
  --text-strong:   #ededee;
  --text-dim:      #b6b6bb;
  --text-muted:    #8f8f96;
  --text-faint:    #6f6f78;
  --link:          #8ea0ff;
  --danger:        #ff6b6b;
  --overdue:       #ff5f5f;
}
```

## 1. CSS custom properties (paste-ready)

```css
:root {
  /* ---- Surfaces / backgrounds ---- */
  --bg:            #f3f3f4; /* app chrome + sidebar   lch(95.94 0.5 282) */
  --bg-content:    #fcfcfd; /* main panel / list bg   lch(98.94 0.5 282) */
  --surface:       #ffffff; /* cards, menus, popovers lch(100 0.5 282)  */
  --bg-column:     #f6f6f7; /* board column backdrop  lch(96.94 0.5 282) */
  --hover:         #ebebec; /* row / nav hover              lch(93.14 0.5 282) */
  --selected-nav:  #e5e5e6; /* selected sidebar item        lch(91.04 0.5 282) */
  --selected-row:  #eaebf6; /* selected issue row (accent tint) */
  --menu-hover:    #f3f3f3; /* context-menu item hover      lch(96 0 282)     */

  /* ---- Borders / dividers ---- */
  --border:        #d5d5d5; /* primary hairline border lch(85.44 0 282) */
  --border-strong: #cdcdcd; /* stronger border         lch(82.44 0 282) */
  --divider:       #e5e5e5; /* row / section divider   lch(90.84 0 282) */
  --divider-soft:  #e1e1e1; /*                         lch(89.49 0 282) */

  /* ---- Text ---- */
  --text:          #1b1b1b; /* primary (titles, active) lch(9.9 0 282)   */
  --text-strong:   #2e2e30; /* near-black secondary     lch(19.2 1.25 282) */
  --text-dim:      #5a5a5c; /* secondary / sidebar item lch(38.4 1.25 282) */
  --text-muted:    #5d5d5f; /* IDs, headers, meta       lch(39.6 1.25 282) */
  --text-faint:    #9e9ea1; /* tertiary / micro-meta    lch(65.3 1.25 282) */
  --text-onaccent: #ffffff; /* text on accent buttons                     */

  /* ---- Brand / links ---- */
  --accent:        #5e6ad2; /* Linear indigo (buttons, "Posted") lch(48 59.31 288.43) */
  --link:          #4162db; /* inline links in issue bodies                */

  /* ---- Workflow status colors (issue states) ---- */
  --st-backlog:    #a4a8ae; /* dashed ring, hollow      */
  --st-todo:       #a8a8a8; /* solid ring, hollow       */
  --st-in-progress:#c6a333; /* amber — ring + pie       */
  --st-smm:        #ed86bc; /* pink  — ring + pie   (For SMM approval)   */
  --st-kasper:     #eb5757; /* red   — ring + pie   (For Kasper approval) */
  --st-tweak:      #db6e1f; /* orange— ring + pie   (Tweak Needed)       */
  --st-client:     #ff0016; /* bright red — ring + pie (For Client Approval) */
  --st-approved:   #43bc58; /* green — disc + check     */
  --st-scheduled:  #0044ff; /* blue  — disc + check     */
  --st-posted:     #5e6ad2; /* indigo— disc + check     */
  --st-canceled:   #95a2b3; /* blue-gray — disc + ✕     */
  --st-duplicate:  #95a2b3; /* blue-gray — disc + slash */
  /* --st-triage:  ~#f2994a  orange — see note §5 (not precisely sampled) */

  /* ---- Radii ---- */
  --radius-chip:    5px;  /* date/tab pills                     */
  --radius-row:     6px;  /* hover/selected row highlight, cards */
  --radius-popover: 12px; /* context menus, dropdowns, popovers  */

  /* ---- Type ---- */
  --font: "Inter Variable", "SF Pro Display", -apple-system, BlinkMacSystemFont,
          "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans",
          "Helvetica Neue", "Linear Thai", sans-serif;
}
```

> Note the two near-identical secondary grays `--text-dim #5a5a5c` and
> `--text-muted #5d5d5f`. Linear uses `#5a5a5c` for sidebar items & default icons
> and `#5d5d5f` for issue IDs / group headers / meta. They're interchangeable to
> the eye; keep both only if you want 1:1 fidelity.

---

## 2. Type scale

Font family everywhere: **Inter** (`"Inter Variable"` — a variable font, hence the
unusual `450`/`550` weights). All sizes in px at the 1440 viewport.

| Role | Size | Weight | Line-height | Letter-spacing | Color |
|---|---|---|---|---|---|
| Issue title — **detail page (H1)** | 24px | 600 | 32px | −0.16px | `--text` |
| Issue body / description | 15px | 450 | 24px | −0.1px | `--text-strong` |
| Inline link (body) | 15px | 450 | 24px | −0.1px | `--link` |
| **Issue title — list row** | 13px | 500 | normal | normal | `--text` |
| **Issue ID** (VID-####) | 13px | 450 | normal | **−0.26px** | `--text-muted` |
| **Sidebar item** (Inbox, Issues…) | 13px | 500 | normal | normal | `--text-dim` (selected → `--text`) |
| Sidebar section header (Workspace, Your teams) | 12px | 500 | normal | normal | `--text-dim` |
| Workspace name (top-left) | 14px | 550 | 23px | −0.1px | `--text-strong` |
| **Column / group header** (list) | 12px | 500 | normal | normal | `--text-muted` |
| Board column header (Projects) | 13px | 500 | normal | normal | `--text-strong` |
| Toolbar tab (All issues / Active) | 12px | 500 | normal | normal | `--text` active / `--text-muted` |
| **Meta text** (dates, counts, "1036 issues") | 12px | 450 | normal | normal | `--text-muted` |
| Micro-meta (timezone "ET") | 9px | 400 | — | normal | `--text-faint` |
| Right-panel property label (issue) | 13px | 450 | normal | normal | `#5e5e60` |

---

## 3. Geometry & spacing

| Element | Value |
|---|---|
| Sidebar width | **244px** (nav items inset 12px left; item row 28px tall) |
| Sidebar / nav icon size | 16×16px |
| Top toolbar height | ~48px |
| **List row height (issues)** | **44px** (measured row-to-row pitch; single line) |
| Status icon size | **16×16px** slot, **14px** drawn glyph |
| Priority icon size | 16×16px |
| List content left edge | ~x=253 (priority icon x≈287, ID x≈311, status icon x≈360, title x≈406) |
| **Board column width (Projects)** | **354px** (board scrolls horizontally; total ~2132px for 6 columns) |
| **Project card** | **327px wide × 74px tall**, ~13.5px inset inside the 354px column |
| Card vertical gap | ~0 (cards adjacent; separated by internal padding + hairline) |
| Card / row content padding | ~12–13px horizontal |
| Chip / pill radius (dates, tabs) | 5px |
| Row highlight / card radius | ~6px |

---

## 4. Workflow status states (the video/editor workflow)

Measured from the live **status dropdown** on issue VID-7624 (13 states). Each icon
is 14px, drawn in a 16px slot. `type` is Linear's category (drives the icon family).

| # | State | type | Color | Icon rendering |
|---|---|---|---|---|
| — | Backlog | backlog | `#a4a8ae` | **dashed** circle outline, hollow (dotted ring) |
| — | Todo | unstarted | `#a8a8a8` | **solid thin** circle outline, hollow (0% fill) |
| 1 | **In Progress** | started | `#c6a333` (amber) | ring + pie wedge ≈ **1/6** filled |
| 2 | **For SMM approval** | started | `#ed86bc` (pink) | ring + pie ≈ **2/6** filled |
| 3 | **For Kasper approval** | started | `#eb5757` (red) | ring + pie ≈ **3/6 (half)** filled |
| 4 | **Tweak Needed** | started | `#db6e1f` (orange) | ring + pie ≈ **4/6** filled |
| 5 | **For Client Approval** | started | `#ff0016` (bright red) | ring + pie ≈ **5/6** filled |
| 6 | **Approved** | completed | `#43bc58` (green) | **solid disc + check** (check knocked out / white) |
| 7 | **Scheduled** | completed | `#0044ff` (blue) | solid disc + check |
| 8 | **Posted** | completed | `#5e6ad2` (indigo) | solid disc + check |
| — | Canceled | canceled | `#95a2b3` (blue-gray) | solid disc + ✕ knocked out |
| — | Duplicate | duplicate | `#95a2b3` (blue-gray) | solid disc + slash knocked out |
| — | Triage | triage | ~`#f2994a` orange *(see §5)* | solid disc + inward chevrons |

The 9 states you asked about are #1–#8 above plus **Todo** — all precisely sampled.

---

## 5. Status-icon rendering notes (how to draw them)

All state icons are a **14px circle inside a 16px box**, built from raw SVG (not a
font). Three families:

**Backlog — dashed ring.** Two concentric `<circle>` (r=6 + r=2), `fill:none`,
`stroke:#a4a8ae`, `stroke-width` 1.5, `stroke-dasharray:"1.4 1.74"` → evenly dotted
outline, empty center.

**Todo → started states — ring + pie.** A `rect rx=6` (i.e. a circle) outline of the
state color at `stroke-width:1.5`, **plus** an inner pie `<path>` filled with the same
color. The pie sweeps clockwise from 12 o'clock; the **fill fraction encodes progress
by workflow position**. With 5 "started" states here it steps evenly:
- Todo (unstarted) = **0%** (ring only)
- In Progress ≈ 60° (**~1/6**), For SMM ≈ 120° (**2/6**), For Kasper = 180° (**half**),
  Tweak ≈ 240° (**4/6**), For Client ≈ 300° (**5/6**).
- (Endpoints measured from the arc paths; e.g. Kasper's path ends straight-down =
  exactly half.)

**Completed / canceled — solid disc + knockout glyph.** A single `<path>` fills the
whole 14px disc with the state color, using `fill-rule:evenodd` to **knock out** the
glyph (a check for Approved/Scheduled/Posted, an ✕ for Canceled, a slash for
Duplicate) so the page background shows through — reads as a white check on the disc.

**Distinctive:** the three *completed* states are distinguished **only by hue**
(green / blue / indigo) — same disc+check shape. So in the rebuild, drive them from a
single "completed" icon component + a `color` prop. Same for the 5 "started" states:
one ring+pie component parameterized by `(color, fillFraction)`.

> **Triage caveat:** the automated capture grabbed the *sidebar* "Triage" nav icon
> (gray `#5a5a5c`) instead of the dropdown's orange Triage glyph, because "Triage"
> also appears in the sidebar. The dropdown clearly renders it **orange** (Linear's
> standard triage ≈ `#f2994a`). Triage isn't part of the editor video workflow, so
> this is informational only — re-sample if you actually need it exact.

---

## 6. Selection, actions & context menus

### 6a. Interaction backgrounds

| State | Background | Notes |
|---|---|---|
| Hover (nav item / row) | `#ebebec` | one uniform hover token across nav + rows |
| Selected sidebar item | `#e5e5e6` (gray) | e.g. active "Issues"; text darkens to `--text` |
| **Selected issue row** | `#eaebf6` (lavender = accent tint) | the row element base computes `#e4e5f1` |
| Context-menu item hover | `#f3f3f3` | |
| Primary button ("Create new issue", "+") | `--accent` `#5e6ad2` bg, white text | |

### 6b. Selecting issues

- A **checkbox** sits at the far left of each row — appears on row hover, and is always shown once any issue is selected. Toggle by clicking it or pressing **`x`** while hovering the row.
- **Checked state:** checkbox fills to accent `#5e6ad2` with a white check; the whole row background tints to `#eaebf6`.
- **Selection action bar:** while ≥1 issue is selected, a floating pill appears **bottom-center** of the list: `[N selected] [⌘ Actions] [⧉] [✕]`.
  - White surface `#ffffff`, height **44px**, radius **12px**, soft popover shadow.
  - The **Actions** button (bg `#f7f7f7`, 28px, radius 7px) opens the same menu as right-click; **✕** clears the selection (also `Esc`).
- Range-select with **Shift-click**; the bulk menu / bar acts on all selected issues at once.

### 6c. Right-click context menu (single issue — 18 items)

**Panel:** `#ffffff`, radius **12px**, border **1px `#e8e8e8`**, shadow `0 6px 18px rgba(0,0,0,.02), 0 3px 9px rgba(0,0,0,.04), 0 1px 3px rgba(0,0,0,.07)`, inner padding 6px.
**Items:** height **32px**, font **13px / 400**, color `#2e2e30`, leading 16px icon, hover bg `#f3f3f3`, right-aligned muted shortcut hint, trailing `▸` chevron when it opens a submenu. Groups are separated by 1px `#e5e5e5` dividers.

| Item | Shortcut | Submenu | Group |
|---|---|---|---|
| Status | `S` | ▸ (the workflow-state list, §4, with number shortcuts 1–9,0) | properties |
| Priority | `P` | ▸ | |
| Assignee | `A` | ▸ | |
| Due date | `⇧D` | ▸ | |
| Labels | `L` | ▸ | |
| Project | `⇧P` | ▸ | |
| Cycle | `⇧C` | ▸ | |
| More properties | | ▸ | |
| Create related | | ▸ | actions |
| Mark as | | ▸ | |
| Copy | | ▸ | clipboard / move |
| Convert to | | ▸ | *(single-issue only)* |
| Move | | ▸ | |
| Open in | | ▸ | *(single-issue only)* |
| Favorite | `Alt F` | | subscribe |
| Subscribe | `⇧S` | | |
| Remind me | `⇧H` | ▸ | |
| **Delete** | `Ctrl Delete` | | destructive — rendered in red |

**Multi-select menu = 16 items:** identical, minus **Convert to** and **Open in** (which are single-issue actions); applies to every selected issue.

> **Sub-issues** use the **same** context menu and selection behavior as top-level issues — no separate menu. Archiving isn't a top-level menu item in this workspace; issues leave the active board by moving to a completed/canceled status (or `Delete` for removal).

---

## 7. Distinctive Linear details worth copying

- **Font is Inter** at slightly-heavier-than-usual weights (450 body, 500 UI labels,
  550 workspace name, 600 issue H1) with subtle **negative letter-spacing** on larger
  text (−0.1 to −0.26px). This tight, medium-weight look is a big part of "feeling like
  Linear."
- **Very low chroma, cool-gray light theme.** Backgrounds are near-white with a faint
  blue cast (all `lch(... 282)` hue). Sidebar `#f3f3f4` is a hair darker than the
  content `#fcfcfd`, giving a soft two-tone split with **no hard border** between them.
- **Hairline borders `#d5d5d5`**, generous whitespace, small **5–6px** radii — nothing
  is heavily boxed.
- **Rows aren't cards** in the issue list — they're flat, separated by whitespace, and
  only get a rounded `#ebebec` highlight on hover. The "card" look only appears on the
  **Projects board** (327×74 cards in 354px columns).
- Status icons are the signature element: **16px slot, 14px glyph**, ring→pie→disc
  progression, color = state. Get these exactly right and it will read as Linear.

---

### Provenance
All values above are from rendered-pixel measurement of the live workspace on
2026-07-04 at a 1440px viewport (raw per-screen JSON dumps kept alongside the
screenshots in this folder). State *names/types* were confirmed against Linear's
read-only API (`list_issue_statuses`, Video team); every *color* and *dimension* is
measured from the rendered DOM.
