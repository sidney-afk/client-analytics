# Parity test — samples (`_sxr`) vs the ORIGINAL calendar (`_cal`)

## Why this exists

Every earlier test suite (scenarios, temporal, overnight) checked the **rebuild
against my own expectations** — never against the calendar that the rebuild was
copied from. That's the gap that let real bugs through: a feature can be "working
as I imagined it" while still being an unfaithful copy of the original.

This harness fixes the methodology. The **calendar is the source of truth**. For
each interaction it drives **both** implementations' real, globally-defined
functions with the **same data** and diffs the resulting affordance/behaviour.
A *divergence* — the calendar produces something the samples don't — is a parity
**FAIL**: a feature that was dropped or simplified in the copy.

No backend, no mocking of the thing under test: `_cal*` and `_sxr*` are all
top-level functions, so we call them directly and inspect the real DOM
(`#resolveDestOverlay`) and the HTML they return.

- **Harness:** `qa/probes/parity_check.js` — run `node qa/probes/parity_check.js`
  (self-hosts `index.html` on `:8000`, headless Chromium, all external requests aborted).

## What it found, on its own — 8 divergences

It **independently rediscovered the bug the user reported by hand**, plus the
same bug on a second surface, plus **two gaps the user never tested**, plus the
**root cause**.

| # | Parity check | calendar | samples | Verdict |
|---|---|---|---|---|
| 1 | Notes button: unread "new reply" dot | ✅ shows | ❌ never | **DIVERGE** — *bonus, not user-reported* |
| 2 | Notes button: "approved-after-tweaks" badge | ✅ shows | ❌ never | **DIVERGE** — *bonus, not user-reported* |
| 3 | **Mark-done → resolve-destination chooser** | ✅ opens | ❌ silently flips done | **DIVERGE** — *exactly the reported bug* |
| 4 | Review-tab Approve → resolve chooser | ✅ opens | ❌ auto-resolves, no chooser | **DIVERGE** — *same bug, 2nd surface* |
| 5–8 | `_sxrShowResolveDest` / `_sxrResolveLastTweak` / `_sxrResolveDestReason` / `_sxrResolveDestRecommend` exist | ✅ all 4 | ❌ none | **MISSING** — *root cause* |

### The reported bug, reproduced mechanically (#3)

In the SMM view, resolving the **last** open change-request on a component is
supposed to open the route chooser — **Kasper / Client / Approve / Stay** — so the
SMM decides where the work goes next. The harness sets up one client change-request,
calls `_calToggleCommentDone(id)` and `_sxrToggleCommentDone(id)` on identical data,
and checks whether `#resolveDestOverlay` becomes active:

- `_cal` → overlay **active** (chooser opens). ✔ correct
- `_sxr` → overlay **inactive**; the comment just flips `done` and disappears. ✘ the bug

### Root cause (#5–8)

`_sxrToggleCommentDone` was left as the *simplified* v1 (flip `done`, repaint). The
whole chooser family — `_calShowResolveDest`, `_calResolveLastTweak`,
`_calResolveDestReason`, `_calResolveDestRecommend` — was **never ported**. The
samples side has only a dead `_sxrApplyAutoStatus` whose `smm_resolved_last` branch
is unreachable (the sole caller passes `'client_added'`). The in-code comment even
admits it: *"The resolve-route chooser is simplified (Mark done resolves in place;
no Kasper/Client route modal)."* So this was a **known, deliberate v1 shortcut that
was never finished** — not an accident — which is why my behaviour-only tests, that
never compared against the calendar, sailed past it.

## The other two complaints — NOT parity gaps (classified, not yet fixed)

These are real and worth fixing, but they are **not** divergences from the calendar,
so they're tracked separately from the parity failures above:

- **Copy: "Creative direction (brief for the editor)"** — `index.html:25836`, a
  **samples-only** string. The original SMM Sheet labels the same field just
  **"Creative direction"** (`index.html:11318`). Fix = drop the parenthetical in the
  samples placeholder. (Pure copy; no behaviour.)
- **Composer scroll-bar / up-down arrows** — `index.html:3181`,
  `.cal-cm-composer textarea { … overflow-y: auto }`. This CSS is **shared** by the
  calendar and the samples composer, so the arrows show in **both**. That answers the
  user's question directly: fixing it on the samples composer **also fixes the SMM
  one**, because they're the same rule. (Pure CSS; no behaviour.)

## Status

System built and run — bugs reproduced independently. **No fixes applied yet**
(per "before you fix anything"). Once fixes land, re-running `parity_check.js`
should turn every row green; that green run is the acceptance gate.
