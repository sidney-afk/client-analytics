---
name: human-audit
description: Simulate the owner auditing a UI surface like a human — a HAND (left-click, right-click, hover, Escape/Enter, browser back/forward, refresh, scroll, drag attempts) and EYES (screenshot pairs after every action, compared like an obsessive designer) — driven side-by-side against a reference page until ZERO divergences remain. General protocol for any wired-page-vs-reference pair, or single-page brokenness audits; ships with a preset for the SyncView Production tab vs the locked design artifact. Use when the user wants "make it exactly the same" (or "find what's broken") verified the way they would verify it themselves — by using it and looking at it — not just by DOM/behavior assertions. Pairs with /master-test (whole-app health) and /feedback-expansion (owner-feedback loop).
---

# Human audit — the hand-and-eyes parity loop

Simulate the owner — a human with a hand and eyes — using the wired page and
its reference side by side in headless Chromium, refusing to accept any
difference, and converting every catch into a permanent machine assertion so
it can never regress.

**Division of labor (why this exists alongside machine lanes):** machine
suites exhaustively check what they *know* to check. The human audit finds
what they *don't yet* check. Everything it finds must graduate into a machine
assertion in the same round — that's the loop's contract.

## Target binding (what varies per audit)

Every audit binds five things. The skill argument overrides any of them; with
no argument, use the **Production-tab preset** below.

1. **Wired page** — the surface under audit, served locally.
2. **Reference** — the page it must match. In *single-page mode* (no
   reference) the same hand runs, and the eyes judge against common sense —
   a brokenness audit instead of a parity audit.
3. **Allowed differences** — an explicit whitelist; everything else is a
   divergence.
4. **Assertion lane** — where fixes get encoded as machine assertions.
5. **Gate set** — what must be green before the next cycle.

### Preset: Production tab vs the locked design artifact

- **Wired page:** `index.html?prod=1` served locally (same server pattern as
  `docs/syncview-design/tests/prod-readonly-smoke.js`).
- **Reference:** `docs/syncview-design/SyncView.html` — the locked artifact.
- **Allowed differences:** typography only (`font-family`, `font-size`,
  `line-height`, `letter-spacing`), plus the `Preview - read-only` chip.
  Nothing else.
- **Assertion lane:** `docs/syncview-design/tests/pixel-wired.js` (visual /
  placement), `behav-wired.js` (behavior), `prod-structure-subset.js`
  (structure).
- **Gate set (all green before the next cycle):** `npm test` (includes
  `test/port-fidelity-check.js`), `npm run test:prod-polish` (runs the full
  behav/pixel/structure/layout/a11y/boot battery — every assertion, whatever
  the current count), `node docs/syncview-design/tests/prod-readonly-smoke.js`
  (zero non-GET), `git diff --check`, secret/model-id scan. Never build a
  cycle on a red gate.
- **Fix rule:** verbatim-transplant per
  `docs/independence/TRACK_B_LINEAR_REPLACEMENT_SPEC.md` §10.8 — change the
  artifact first, transplant to the wired tab, `// PORT-DELTA:` only where
  live data forces it.
- An argument like "focus on the board" narrows the matrix.

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
  shortcut battery is owned by the behavior suite (`behav-wired` in the
  Production preset) — do not re-audit it here.
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
  raw pixel-diff wired vs reference — the allowed differences (typography,
  in the preset) differ by design; cross-side judgment is the eyes plus the
  computed-style lane.
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
2. **Fix** everything found, per the binding's fix rule.
3. **Encode** every fix as a machine assertion in the binding's assertion
   lane so it can never regress. A fix without an assertion is not done.
4. **Gates green** (the binding's gate set) before the next cycle.

## Stop condition

Stop ONLY when one FULL hand+eyes matrix pass plus the complete inventory
sweep find **zero divergences** outside the binding's allowed differences —
state this explicitly with the final matrix — or when context runs low: stop
cleanly at a cycle boundary and say exactly what remains.

## Hard rails

Universal, every audit:

- Screenshots stay local/private (never committed); list flagged pair
  filenames in the run report/PR.
- One draft PR, one commit per cycle; the owner merges.

Production preset (read-only contract):

- Read-only surfaces stay read-only: no write paths, no runtime flags, no
  backend/auth/n8n changes, zero write-like browser requests from the page.
  (This is the **Production read-only contract** — distinct from the
  live-backend QA contract in `docs/testing/HEADLESS-TESTING-GUIDE.md` §5,
  which governs `qa/` suites and permits test-client mutation.)

## Retargeting recipe (new pair in ~4 lines)

To audit any other surface: state the five bindings (wired page, reference or
single-page mode, allowed-differences whitelist, assertion lane, gate set) in
your run notes, confirm which safety contract applies (read-only vs
live-backend QA), then run the protocol above unchanged.
