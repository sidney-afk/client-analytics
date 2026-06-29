# Samples vs Calendar — Divergence Catalog (the sweep)

Produced by the **master tester** — `qa/probes/twin_render.js` (renders each surface
for BOTH the calendar and the samples and diffs the *observable snapshot*: every
visible action label, state label, and preview visual), plus two deep code audits
(Kasper flow + realtime). Standard = **exact clone**: every entry below is a bug to
fix, unless listed under "By-design".

> **This is the handoff for the fix session.** Nothing here is fixed yet.

## How the master tester catches what the old tests missed
The old tests compared shared *function outputs* (blind to features that don't exist
in samples) or rendered one component's CSS (blind to behaviour), and the scenario
suite *reloaded the tab before every assert* (which erased realtime bugs). The master
tester instead diffs the **set of visible affordances/states** between the two real
surfaces — so a missing "Finish reviewing" button shows up immediately, the way you
see it by eye. Run it: `node qa/probes/twin_render.js`.

---

## A. Auto-detected by the twin render-diff (run today)

| # | Surface | Divergence | Severity |
|---|---|---|---|
| A1 | **Kasper review card** | Missing **"Finish reviewing"**, **"Close card"**, and the full-screen thumbnail lightbox. The samples Kasper is a *simplified* per-component model — see section B for the complete gap. | **High** (your reported bug) |
| A2 | SMM Review panel **and** Client review panel | Thumbnail opens a **new browser tab** (`<a href>`), but the calendar opens a **full-screen lightbox** (`_calOpenThumbLightbox`). Label: "Open thumbnail" vs "Open thumbnail full screen". | Medium |
| A3 | SMM Sheet card | Missing **"Tag this card with a color"** — the card colour-tag button (`cal-card-color-tag` / `_calOpenColorPicker`) was never ported to the samples card. | Medium |

## B. Kasper review — full flow gap (code audit)
The samples Kasper sub-tab (`_sxrKasper*`, ~line 27800) is a simplified per-component
model. The calendar's Kasper review (`_kasper*`, ~29980–32535) has an entire decision
flow that samples lacks. To make it an exact clone, port:

1. **"Finish reviewing" button + "Sent to SMM" badge** — card-level hand-off; disabled until every component is decided (`_kasperDismiss` ~32447, guard `_kasperUndecidedComps` ~23129).
2. **Queue partitions** — Waiting / **Tweaks pending** / **Approved history** (`_kasperPartitionItems` ~31420). Samples shows one flat list.
3. **"Changes requested" state label** on a tweaked component (samples shows none).
4. **Cross-device stamps** — `kasper_finished_at`, `kasper_closed_at`, `kasper_finish_log` (durable audit). Samples writes none.
5. **isFinished / isClosed resurfacing** — a finished card sits in "Tweaks pending" and resurfaces on a new message or a fresh ask (`_kasperIsFinished` ~31382, `_kasperIsClosed` ~31409).
6. **"Close" (X) button**, **"Comment"** (internal-only, no status change), **URGENT**, **Slack** affordances.
7. **`_touchedComps` pinning** so a card doesn't vanish mid-review.
8. **Hero (single-component) vs 2×2 grid layout**, **history grouped by day**, **Undo** on approve (`_kasperUndoApprove`).

> Scope: medium-high — the model is ~20–30% different; the rest is largely a transplant
> from the calendar Kasper code, adjusted for the samples one-upsert / no-per-item-cache architecture.

## C. Realtime cross-tab (code audit + your report)
**Your bug:** edit in the client tab → the other tab doesn't update without a refresh.

Both surfaces wire an identical Supabase `postgres_changes` subscription
(`_sxrV2OnRealtimeChange` ~27768 → `loadSxrCards({background:true})`; calendar
`_calV2OnRealtimeChange` ~16524). The handler *does* repaint all visible views, so the
likely culprits to verify live:
- The realtime **WebSocket isn't connecting/subscribing** on one tab (so no event arrives), or
- the self-echo window / the `sxrClientSlug(sxrState.client) !== slug` guard (~27769) drops the event when tabs are on a different client, with **no pending-refresh fallback** (the calendar has refresh-on-return listeners; confirm samples' fire).

> This needs a **live two-tab check** (two real browser tabs, edit in one, watch the other
> with NO reload) — the headless courier can't tunnel the realtime WebSocket, so it's the
> one dimension the automated tester flags for manual/live verification.

## D. By-design (registered as intentional, NOT bugs)
The samples is a structural subset, so these are expected and the tester ignores them:
- No **caption / title** component → "Alt caption", "Generate" (AI caption), "Show more" (caption expand), the Caption status pill.
- No **Scheduled / Posted** status (samples pipeline ends at Approved).
- Samples-only **creative-direction visibility eye** ("Toggle client visibility").

---

## Coverage of the master tester (and what's next)
- **Covered now (render layer):** SMM Sheet card, SMM Review panel, Kasper review card, Client review panel — observable-snapshot diff (actions / states / preview visuals).
- **Next layer (for the fix session or follow-up):** drive the **same live journey on both surfaces** through the real backend with a **second tab never reloaded**, to catch flow + realtime divergences end-to-end (reuse `qa/sxr_courier_lib.js` + `qa/scenario_engine.js` verbs; add calendar-side role helpers). This is the live half of the plan in `~/.claude/plans/`.
- **Suggested fix order:** C (realtime — small, high-impact) → A2/A3 (thumbnail lightbox, colour tag — small) → B (Kasper flow — the big rebuild).
