# Flip test — round 3 log (2026-08-31)

Executed against `docs/ops/FLIP_TEST_ROUND3.md` on the live product, TEST client
`sidneylaruel` only. Model: Sonnet 5 (switched mid-session from Opus 5, which
ran the 2026-08-30 flip-day playbook). Branch continues from
`main` @ `d86717df` (merge of #1184), which already contains fixes for the
2026-08-30 findings (items 76/81/82/83/84/85/86 in OPEN_REPAIRS — my Findings
A/B/C/D/E/F from that day, all closed same-day).

**The client share-link token is never written to this file.** Where a finding
needs it, it is given to the owner in chat.

---

## P0 — the batch-parent detail view hard-freezes on load (BLOCKS §2a, part of §3)

**SAW:** Opening a batch parent's detail view in Production —
`?prod=1&d=bat_<id>`, or clicking through from a sub-issue's parent link — never
finishes rendering. The tab becomes unresponsive to clicks and screenshots
within ~1 second. DevTools console fills with dozens of
`RangeError: Maximum call stack size exceeded` per second until the tab is
navigated away.

**EXPECTED:** The parent's Assets panel (Filming plan / Raw footage / Frame
folder, no Deliverable file — §2a) and Labels ("No labels", no Retry — §3)
render normally.

**STEPS (100% reproducible, 3/3 attempts, 2 independent batch ids):**
1. Open `https://syncview.synchrosocial.com/?prod=1&d=bat_cdf2acc0-5657-4761-b2a0-c98cffded7ac` in a **fresh tab** (cold load, not a same-tab navigation).
2. Wait ~1s. The tab is now unresponsive.
3. Repeated independently against `bat_480a9afa-9952-4c69-bc31-b4c0de9b299c` (an unrelated batch, the parent B1 adopted my stray-catcher sub-issue into on 2026-08-30) — identical freeze, identical stack trace.
4. Also reproduced via same-tab navigation: clicking the parent-issue link from sub-issue VID-13659 (`Sub-issue of VID-13658…`).

Only recovery: navigate the tab to a different URL. The frozen tab does not
recover on its own.

**ROOT CAUSE (read from source, index.html):**

`_prodRender()` (line 55575) calls `_prodEnsureLabels(_prodState.openId, false)`
unconditionally on every render pass when the view is `'detail'`. Inside
`_prodEnsureLabels` (line 47443), the branch for a synthetic batch parent
(`issue.syntheticBatchParent === true`) runs **before** the memoization guard
`if (!force && current) return current;` that every other issue type relies on
to short-circuit repeat calls. The synthetic-parent branch unconditionally
calls `_prodRefreshLabelSurfaces(id)` (line 47435), which — if `#prodRoot`
exists — calls `_prodRender()` again. That closes the cycle:

```
_prodRender (55575)
  → _prodEnsureLabels (47477, synthetic-parent branch, no memo check)
    → _prodRefreshLabelSurfaces (47436)
      → _prodRender (55575)
        → _prodEnsureLabels ...  [repeats until the call stack overflows]
```

This is a regression **introduced by the fix this very round is meant to
verify**. The code comment at 47443 explains the intent correctly — a synthetic
batch parent has no Linear issue of its own, so `handleLabelsRead` would 404
forever, and the fix settles the state to `{status:'ready', catalog:[],
structural:true}` instead of leaving a Retry loop. That part is right. What's
missing is a check *before* re-entering the synthetic branch — something
equivalent to `if (current && current.structural) return current;` — so the
settled state is honoured on the next render instead of being recomputed (and
re-triggering a render) every single time.

**Consequence for this round's testing:** §2a (parent asset panel) cannot be
visually verified — the page that would show it never paints. The backend data
it would show is verified separately below via REST, but that is not the same
as confirming the UI renders it, and the UI in its current state cannot be
opened by anyone, staff or otherwise. The "Labels on a batch parent" half of
§3 is unverifiable for the same reason — ironic, since the labels fix is the
proximate cause.

**Not filed as multiple findings** — one root cause, one fix needed.
