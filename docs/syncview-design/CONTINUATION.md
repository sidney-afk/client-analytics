# SyncView prototype — continuation / handoff

Read this first to resume work. It's the single source for what exists, how to
build/verify/publish, and what's left.

## What this is
Sidney runs **SynchroSocial** (social-media agency). He's replacing Linear with an
in-app workspace inside **SyncView** (repo: `F:\SIDNEY LARUEL\Documents\SYNCVIEW\client-analytics`).
This folder holds an **interactive single-file prototype** of that workspace, being
iterated to **pixel-parity with real Linear** via a capture→match→verify loop.
Editors' workflow: each **client = a project**, each **batch/shoot = a parent issue**,
each **video/thumbnail = a sub-issue** with status/assignee/due/comments. Issues will
be created from a **content-calendar** system (SMM makes a card → a sub-issue is
created under a selected parent) — so there is **no manual "new issue"** in this view.

**Live prototype (Artifact, redeploys to same URL):**
https://claude.ai/code/artifact/50e256f7-1438-45df-a808-bc2f312327e6

## ⭐ Session update — 2026-07-05: PHASE 2 (behavioral/interaction parity) — essentially DONE
After Phase 1 (visual/measured parity) was done, this session ran an **adversarial behavioral re-audit loop**: 5 parallel agents drive every surface via Playwright, find interaction divergences vs real Linear, then fixes land one batch at a time, each guarded by a regression suite. **11 re-audits run; the last five all returned 0 high-severity / 0 regressions.** ~110 divergences closed. Everything works and behaves like Linear now (list, board, detail, pickers, palette, keyboard, multi-select, activity feed, undo).
- **New behaviors shipped** (all test-guarded): live row-glyph clicks (chip→profile, due→picker, avatar/status pickers); full list multi-select (checkbox / x / Cmd-click / Shift-click / Shift-arrows) + bulk action bar w/ inline quick-actions; keyboard model (j/k focus ring, Enter, s/a/⇧D/⇧P, ⌘K palette, Escape hierarchy); **delete Undo + Ctrl/⌘+Z**; detail property pickers + calendar (arrow-nav, unified month paging, typed input); **Activity feed logs system events**; comment edit (blur discards) + **comment-delete Undo**; **board keyboard nav**; **board card multi-select** + board bulk bar; truncation-aware tooltips; picker "No results"; Filter/Display toggle buttons.
- **Canonical worklog:** `out/PARITY-LOOP.md` (It56–It81) — read it for the full blow-by-blow.
- **Sidney's decision (plan B):** parity reached → **downshift to periodic re-verification** (re-run behav/qa/sweep + spot-check Linear), not endless micro-divergence hunting. And: **keep the tester re-launchable** (done — see "The behavioral tester" below).
- **Accepted limitations (intentional):** detail-side pickers overlap the sibling rows they open over; skeleton omissions (no priority/labels/cycles/inbox/triage-nav/manual-new-issue; no block-markdown; no sub-issue reorder; no marquee select).

## File map (all under `C:\Users\Sidney\linear-design-probe\`)
| File | What |
|---|---|
| `out/SyncView.html` | **Built** prototype (Inter font injected). This is what gets published. |
| *(scratchpad)* `syncview-app.html` | **Prototype SOURCE** — edit this. Has `__INTER_B64__` placeholder for the font. Full path: `C:\Users\Sidney\AppData\Local\Temp\claude\C--Users\0ceffb3e-265c-423b-92f5-0f690f2e3f0d\scratchpad\syncview-app.html` |
| *(scratchpad)* `inter.woff2` | Inter variable font (48KB) injected at build. |
| `out/PARITY.md` | **The parity checklist / backlog** — what's ✅ vs 🟡 vs TODO. Start here for what to do next. |
| `out/linear-design-tokens.md` | Measured Linear design tokens (colors/type/geometry/status icons/interactions) — the build spec. |
| `out/Linear Design Tokens.html` | Visual token reference (separate artifact). |
| `probe.js` | Playwright harness that drives **live Linear** to capture reference screenshots + computed styles. |
| `build.js` | **The build command** (Phase 2). `node build.js` injects the Inter font into the scratchpad source → writes `out/SyncView.html`, `out/_sv.html`, and `out/syncview-app.src.html` (source mirror) in one step. Use this instead of the inline node -e below. |
| `behav.js` | **Behavioral regression suite** (Phase 2, the primary one). **138 assertions** — every fixed/added behavior has a test. Loads `out/SyncView.html`, drives real interactions, prints `ALL N BEHAVIORS PASS` + `JS ERRORS: 0`. Run `node behav.js` after every build; extend it for every new behavior. |
| `qa-features.js` | Playwright **self-verify** harness for the prototype. Loads `out/_sv.html`, exercises every feature + a menu regression sweep, asserts `pageerror`/console-error == 0. Run `node qa-features.js` after each build (needs `out/_sv.html`, which the build step writes). Prints `ALL GREEN`. |
| `sweep.js` | **Interaction fuzz sweep** (Phase 2) — hovers/clicks across all 6 surfaces, asserts 0 JS errors. `node sweep.js` → `SWEEP CLEAN`. |
| `out/PARITY-LOOP.md` | **The behavioral worklog / brain** (It56–It81). Canonical record of every audit + fix. Read FIRST to resume the behavioral loop. |
| `.claude/workflows/syncview-parity-audit.js` | **The re-launchable adversarial tester** (saved workflow) — 5 parallel agents re-audit every surface vs Linear. `Workflow({name:"syncview-parity-audit"})` or `/workflows`. See "The behavioral tester" below. |
| `out/syncview-app.src.html` | **Survivable copy of the SOURCE** (has `__INTER_B64__` placeholder). Mirror of the scratchpad source; if the scratchpad is gone next session, edit this and point the build `SC` at `out/`. |
| `.linear-probe-profile/` | Persistent browser profile — **Sidney's Linear login is saved here** (gitignored). Relaunching the probe restores the session; no re-login. |
| `.gitignore` | Keeps profile/node_modules out of git. |

> The scratchpad dir is session-specific; if it's gone in a new session, the source
> is recoverable from `out/SyncView.html` (strip the `@font-face` base64 back to
> `__INTER_B64__`), or just keep editing `out/SyncView.html` directly and skip the
> inject step.

## Build → verify → publish (exact commands)
Run from `C:\Users\Sidney\linear-design-probe`. Node 22 + Playwright + chromium are installed.

**1. Inject font + build:**
```bash
node -e '
const fs=require("fs");const SC="C:/Users/Sidney/AppData/Local/Temp/claude/C--Users/0ceffb3e-265c-423b-92f5-0f690f2e3f0d/scratchpad";
const html=fs.readFileSync(SC+"/syncview-app.html","utf8");const b64=fs.readFileSync(SC+"/inter.woff2").toString("base64");
fs.writeFileSync("out/SyncView.html",html.replace("__INTER_B64__",b64));
fs.writeFileSync("out/_sv.html","<!doctype html><html><head><meta charset=utf-8></head><body>"+fs.readFileSync("out/SyncView.html","utf8")+"</body></html>");'
```
**2. Syntax-check the app JS** (extract `<script>` → `node --check`).
**3. Verify headlessly** — drive `file:///.../out/_sv.html` with Playwright, click every
control, screenshot, **assert `pageerror`/console-error count == 0**, then Read the PNGs and look.
**4. Publish** — call the Artifact tool with `out/SyncView.html` (same file path ⇒ same URL).
Clean up `out/_sv.html` and `out/_qa-*.png` after.

## The parity loop (the method — this is how we polish)
Per surface/interaction:
1. **Capture Linear** with the probe: relaunch `node probe.js` (background), then drop
   JSON command files into `cmd/` — actions: `goto`, `rclick {x,y,keepOpen}`, `hover {x,y}`,
   `eval {expr}`, `shot {label}`, `menu`, `states`, `dump`. Screenshots + JSON land in `out/`.
   (To capture a submenu: `rclick keepOpen` → `eval` to find the item's coords → `hover` there → `shot`.)
2. **Diff** Linear's screenshot vs the prototype's (look + measured deltas).
3. **Fix** the source, rebuild, re-verify (0 errors), look.
4. Mark it in `PARITY.md`.
Realistic: ~90% is autonomous (capture/build/self-verify/eyeball); last ~10% is Sidney's eye.

## Prototype architecture (single file, vanilla JS)
- `S` = state object (`view`, `open` issue id, `nav` back-stack, `projectOpen`, `selected` Set, `groupBy`, `tab`, `filter`, `collapsed`, `teamOpen`).
- `render()` rebuilds `#app` innerHTML from `mainView()` (list / projects board / issue detail / project detail).
- Overlays live in `#layer` (z-index 55, above the action bar 45); `layerPop()` adds a full-screen backdrop + the pop; pops `stopPropagation` clicks.
- Menus: `openContextMenu` (right-click), cascading submenus via `openSub` on `mouseenter`; pickers via `PICK(kind)` + `pickerHTML`/`wirePicker` (Status/Assignee/Project searchable, ✓ on current); `buildDue` = custom date picker (quick options + natural-language `parseDue` + month `cal()`).
- Data: `ISSUES` (parents via `P(...)`, subs via `C(...)` with a `parent`), `PROJECTS` (clients), `EDITORS`, `STATUS`/`STATUS_ORDER`, `CLIENTS` (projects board), `PSTATUS`.
- `TODAY = new Date(2026,6,4)` drives due/overdue/calendar.

## Gotchas already hit (don't repeat)
- **CSS class collisions**: a pop with class `due` inherited the row `.due{display:inline-flex}` → renamed to `duepop`. Watch for reused class names between components.
- **Event propagation**: the global document click-handler closes `#layer` if it has content; anything that OPENS a pop from its own `onclick` (action bar, submenu items) must `stopPropagation`, or the handler closes it immediately.
- **Menu z-order**: `#layer` must be above `.actionbar`.
- **Cursors**: `.app{user-select:none}` kills the I-beam on chrome; re-enable `user-select:text` only on `.d-desc`/`.act-text`/inputs. Interactive elements need explicit `cursor:pointer`.
- Removed features (per Sidney): **priority, labels, cycles, triage-nav, views, inbox, invite, workspace switcher, manual new-issue**. Kept: Triage *status* (migration).

## Product/data decisions (for the eventual real build in the repo)
- Issues come from the **content calendar**, not manual creation here; creating a card → a sub-issue under a chosen parent (or a new parent batch).
- Rows read **`sub-title › parent batch`** (bold sub, muted parent).
- No priority/labels. Statuses = the video workflow (Backlog, Todo, In Progress, For SMM/Kasper/Client approval, Tweak Needed, Approved, Scheduled, Posted + Triage/Canceled).
- Light theme now; Sidney will do a **dark mode** across the whole site later (would need re-measuring Linear's dark palette).

## What's next (see PARITY.md + PARITY-LOOP.md for detail)
**Phase 1 (visual) DONE, Phase 2 (behavioral) ✅ DONE** (2026-07-05). All named gaps + ~115 audited divergences closed; 11 re-audits, last SIX 0-high/0-regression. Suites: `behav.js` 138 / `qa-features.js` GREEN / `sweep.js` CLEAN, 0 JS errors.
**Per Sidney (plan B): downshift to PERIODIC RE-VERIFICATION.** Each session, instead of hunting new micro-divergences: (1) `node build.js` (only if source changed), (2) `node behav.js` + `node qa-features.js` + `node sweep.js` (confirm all green), (3) optionally re-launch the adversarial tester (below) to spot-check, (4) rotate a probe visual check of ONE surface vs fresh Linear (READ-ONLY). Only fix if something real regresses.
**If you DO resume active polishing:** read `out/PARITY-LOOP.md` (It56–It81) first — it's the behavioral brain. Remaining are accepted skeleton/layout limitations (not defects). The real-repo build (in `F:\…\SYNCVIEW\client-analytics`) can now port these behaviors from the prototype.

## The behavioral tester (re-launchable) — "the dock"
The adversarial loop Sidney liked is preserved so it can run any time:
- **Saved workflow:** `.claude/workflows/syncview-parity-audit.js` — 5 parallel agents each re-audit a surface (list-rows / list-chrome / detail-props / sub-issues+activity / board+sidebar) vs real Linear via Playwright, returning `{divergences, regressions, regressionsChecked}` ranked by severity. Launch with `Workflow({name:"syncview-parity-audit"})`, or pick it from `/workflows`. It reads `out/_sv.html` (built) + `out/syncview-app.src.html` (source), so run `node build.js` first.
- **The full loop** (autonomous, self-pacing) is invoked with `/loop <prompt>` — the prompt in PARITY-LOOP.md's latest entry is the template: build→verify(behav/qa/sweep)→eyeball→republish→log→re-audit→triage→repeat. A **task chip** was also spawned this session so Sidney can one-click re-open the loop.
- **The three local suites** are the fast inner check (no agents, ~seconds each): `node behav.js` / `node qa-features.js` / `node sweep.js`.
- Keep the tester's "ALREADY FIXED" list current when you add behaviors, so agents verify rather than re-flag them.

## End-of-session handoff ritual (DO THIS before the session ends)
This `out/` folder is what Sidney hands to the repo/build session — leave it current:
1. **Rebuild + republish** — inject the font → `out/SyncView.html`, then re-publish the
   Artifact (same file path ⇒ **same URL**) so the live link reflects your changes.
2. **Save the editable source in `out/`** (NOT just the scratchpad — it's session-specific
   and won't survive): keep `out/syncview-app.src.html` with the `__INTER_B64__` placeholder,
   or edit `out/SyncView.html` directly and note that.
3. **Update `PARITY.md`** — flip shipped items to ✅, add new deltas, put Sidney's newest
   requests at the top of the backlog.
4. **Update `CONTINUATION.md`** — a short "changed this session" note + new decisions/gotchas +
   the current "what's next," so the next session resumes with zero re-explaining.
5. **Update `linear-design-tokens.md`** if any measured token changed.
6. **Update `HANDOFF.md`** only if the plan or artifact list changed.
7. **Update the memory** (`…/memory/syncview-linear-prototype.md`) if the resume path/status changed.
Leave `out/` self-contained: docs current, build commands valid, live URL fresh.

## Guardrail
This has been **read-only against Linear** throughout (measuring/capturing only; never
edited Sidney's Linear data). Keep it that way.
