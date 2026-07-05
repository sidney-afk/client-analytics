# SyncView design handoff — START HERE

You're receiving the **locked design + interactive reference** for the Linear
replacement inside SyncView. This session's job was to nail the *look, feel, and
behavior* (pixel-matched to real Linear) so your build session only has to wire
logic + connect it to the existing website. Read this, then the files it points to.

> **Status 2026-07-05:** Phase 1 (visual parity) **done**, Phase 2 (**behavioral/
> interaction parity**) **essentially done** — 11 adversarial re-audits vs live Linear
> (last five 0-high/0-regression), ~110 divergences closed, a 133-assertion regression
> suite all green. The prototype now behaves like Linear across list, board, detail,
> pickers, palette, keyboard, multi-select, activity feed, and undo. Per Sidney, we've
> downshifted to **periodic re-verification** (plan B). The full behavioral changelog is
> **`PARITY-LOOP.md`**; the re-runnable tester is in **`CONTINUATION.md` → "The behavioral tester"**.

---

## The plan (context you gave, in one place)
- **Goal:** replace Linear entirely with an in-app **SyncView** workspace, so the
  video/graphics editors stop depending on Linear. It must **look and feel exactly
  like Linear** so editors aren't disoriented when they switch.
- **Model:** client = **project**, a shoot/batch = **parent issue**, each
  deliverable (video / thumbnail) = **sub-issue** with a status, assignee, due date,
  and **comments** (where feedback + delivered Drive file links live).
- **How issues get created (important):** NOT manually in this view. They come from
  the **content-calendar** system — when an SMM makes a card / a new sample, a
  **sub-issue is auto-created**, choosing an existing **parent batch** or creating a
  new one. (Previously the content calendar linked sub-issue video/graphic links to
  Linear; now everything lives on SyncView and is interconnected.)
- **Removed vs Linear** (deliberate): priority, labels, cycles, the Triage/Views/
  Inbox/Invite nav, the workspace switcher, and manual "new issue." **Kept:** the
  Triage *status* (needed for migrating existing data).
- **Theme:** light for now. Sidney will do a **dark mode across the whole site later**
  (that needs re-measuring Linear's dark palette — not done yet).
- **This session locked:** the design tokens, the status-icon system, and a fully
  interactive HTML prototype matched to Linear via a capture→match→verify loop.

---

## The artifacts (read in this order)
1. **`CONTINUATION.md`** — the operational resume doc: file map, exact build/verify/
   publish commands, prototype architecture, gotchas already solved, and the full
   TODO order. *Everything you need to keep building is here.*
2. **`PARITY.md`** — the parity checklist + backlog (what matches Linear ✅, what's
   left 🟡/TODO). Sidney's latest requests are the "High priority" section.
3. **`linear-design-tokens.md`** — the **visual source of truth**: measured Linear
   colors, type scale, geometry, status-icon rendering, interaction/menu specs. Build
   the real UI to these values.
4. **`SyncView.html`** — the **behavior source of truth**: the working prototype.
   Open it (or the live version) and match its interactions. Live URL:
   https://claude.ai/code/artifact/50e256f7-1438-45df-a808-bc2f312327e6
5. **`PARITY-LOOP.md`** — the **behavioral changelog / brain** (It56–It81): every
   interaction audit + fix, the accepted limitations, and how the tester works. Read
   this to understand exactly how each interaction should behave.
6. `Linear Design Tokens.html` — a visual token reference (nice-to-have).
7. **The behavioral tester** (`.claude/workflows/syncview-parity-audit.js` + `behav.js` /
   `qa-features.js` / `sweep.js`) — re-runnable proof-of-parity; see CONTINUATION.md.

> These live in `C:\Users\Sidney\linear-design-probe\out\`. Recommended: copy this
> whole `out/` folder into the repo (e.g. `client-analytics/docs/syncview-design/`)
> so it's versioned with the code and your build session sees it naturally.

---

## Your job (build session)
- Build the SyncView workspace UI into the repo to **match `SyncView.html` (behavior)
  and `linear-design-tokens.md` (visuals)**, then wire it to the real data /
  content-calendar / website.
- Start with the design faithful; then connect logic.

## ⬅ Keep these docs current (Sidney's instruction)
As you build, **update the docs so they stay the source of truth:**
- **`PARITY.md`** — flip items to ✅ as you ship them; add anything new.
- **`CONTINUATION.md`** — record decisions, deviations, and new file locations.
- **`linear-design-tokens.md`** — if any token changes, update it here.
Then this handoff stays accurate for the next hand-off.
