---
name: human-audit
description: Simulate the owner auditing a SyncView surface like a human — a HAND (left-click, right-click, hover, Escape/Enter, browser back/forward, refresh, scroll, drag attempts) and EYES (screenshot pairs after every action, compared like an obsessive designer) — driven side-by-side against a reference page until ZERO divergences remain. Built for the Production tab vs the locked design artifact (docs/syncview-design/SyncView.html), but works for any wired-page-vs-reference pair. Use when the user wants "make it exactly the same" verified the way they would verify it themselves — by using it and looking at it — not just by DOM/behavior assertions. Pairs with /master-test (whole-app health) as the parity-focused sibling.
---

# Human audit — the hand-and-eyes parity loop

This skill encodes the protocol that closed the Production-tab parity gap
(PRs #689 → #704): **simulate the owner** — a human with a hand and eyes —
using the wired page and its reference side by side in headless Chromium,
refusing to accept any difference, and converting every catch into a
permanent machine assertion so it can never regress.

**Division of labor (why this exists alongside the machine lanes):** the
machine lanes (`port-fidelity-check`, `behav-wired`, `prod-structure-subset`,
`pixel-wired`) exhaustively check what they *know* to check. The human audit
finds what they *don't yet* check. Everything it finds must graduate into a
machine assertion in the same round — that's the loop's contract.

## Defaults (override via the skill argument)

- **Wired page:** `index.html?prod=1` served locally (same server pattern as
  `docs/syncview-design/tests/prod-readonly-smoke.js`).
- **Reference:** `docs/syncview-design/SyncView.html` — the locked artifact.
- **Typography exception (the ONLY allowed difference):** `font-family`,
  `font-size`, `line-height`, `letter-spacing`.
- **Extra-element whitelist:** the `Preview - read-only` chip. Nothing else.
- An argument like "focus on the board" narrows the matrix; "single-page"
  mode (no reference) turns this into a brokenness audit: same hand, eyes
  judge against common sense instead of a reference.

## THE HAND — act like a person on every surface (extrapolate freely)

- **Left-click** every interactive element, one by one, including elements
  that only appear on hover.
- **Right-click** everywhere: rows, sub-rows, cards, columns, group headers,
  detail body, sidebar items, empty space.
- **Hover** every element and WAIT: tooltips (same text, same delay feel),
  hover backgrounds/underlines/reveals, and **cursor shape** must match —
  assert cursor via computed style, screenshots cannot show it.
- **Keys, human-scale only:** Escape at every state (the full cascade:
  popup → selection → back) and Enter to open the focused thing. The full
  shortcut battery is owned by `behav-wired` — do not re-audit it here.
- **Navigate like a human:** click into things, then **browser Back and
  Forward** — history must restore identical states on both sides;
  **refresh mid-state** — deep links must restore the view; click outside
  popups to close; double-click; attempt drags (guarded surfaces must
  guard); scroll every scrollable region.
- **Order — most-used first:** list → selection/actionbar → context menus +
  every submenu → pickers/due popover → detail → board + project detail →
  filters/pills → palette → empty states → sidebar/brand.

## THE EYES + screenshot discipline

- **Capture liberally, look selectively.** Save a screenshot pair to disk
  after every meaningful state change (cheap). Spend the vision budget in
  prioritized batches, most-used surfaces first.
- **Crop.** For element comparisons, screenshot the ELEMENT/REGION on both
  sides (the menu, the pill row, the card) — small pairs compare directly
  and cost far less context. Full-page pairs once per surface per cycle.
- **Pre-filter.** Pixel-diff each side against ITS OWN previous cycle's
  shot to find what changed; skip re-examining unchanged surfaces. Do NOT
  raw pixel-diff wired vs reference — typography differs by design;
  cross-side judgment is the eyes plus the computed-style lane.
- **Compare like an obsessive designer:** presence / absence / extra;
  position, alignment, centering, spacing; colors, borders, shadows, radii;
  icon SHAPES (SVG path data, not vibes); text content, casing, truncation;
  what appears/disappears on each action; selection and focus states.
- **Log every divergence** with its screenshot pair, ranked by user impact.
- **Coverage matrix** (surface × action) maintained in the run notes,
  checked off as you go — no cell skipped, coverage auditable.

## The cycle

1. **Audit** — run the hand+eyes matrix (full on cycle 1; on later cycles,
   every surface you touched plus one full sweep at the very end).
2. **Fix** everything found. For the Production tab: verbatim-transplant
   rule per spec §10.8, `PORT-DELTA` only where live data forces it.
3. **Encode** every fix as a machine assertion (for the Production tab:
   `pixel-wired.js`) so it can never regress. A fix without an assertion is
   not done.
4. **Gates green before the next cycle** (Production tab set):
   `port-fidelity-check`, `behav-wired` 138/138, `prod-structure-subset`,
   `prod-readonly-smoke` (zero non-GET), `pixel-wired`, `npm test`,
   `git diff --check`, secret scan. Never build a cycle on a red gate.

## Stop condition

Stop ONLY when one FULL hand+eyes matrix pass plus the complete inventory
sweep find **zero divergences** outside the typography exception and the
whitelist — state this explicitly with the final matrix — or when context
runs low: stop cleanly at a cycle boundary and say exactly what remains.

## Hard rails

- Read-only surfaces stay read-only: no write paths, no runtime flags, no
  backend/auth/n8n changes, zero non-GET browser requests from the page.
- Screenshots stay local/private (never committed); list flagged pair
  filenames in the run report/PR.
- One draft PR, one commit per cycle; the owner merges.
