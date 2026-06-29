# Parity coverage ledger — samples (`_sxr`) vs original calendar (`_cal`)

Running record of what the parity system has compared, so each loop iteration
pushes into fresh territory instead of re-treading. Calendar = source of truth.

- **Harnesses:** `qa/probes/parity_check.js` (affordances/DOM) · `qa/probes/parity_logic.js` (pure logic) · `qa/probes/verify_chooser.js` (chooser routing).
- **Legend:** ✅ parity held · 🔧 divergence found→fixed · ◌ by-design difference (not a bug).

## Covered

### Batch 1 — affordances / DOM (`parity_check.js`)
| Check | Result |
|---|---|
| Notes button: unread "new reply" dot | 🔧 fixed (PR #614) |
| Notes button: "approved after tweaks" badge | 🔧 fixed (PR #614) |
| Mark-done → resolve-destination chooser | 🔧 fixed (PR #614) |
| Review-tab Approve → resolve chooser | 🔧 fixed (PR #614) |
| Resolve-chooser functions present (structural) | 🔧 fixed (PR #614) |

### Batch 2–3 — pure logic + visibility (`parity_logic.js`) — 125 comparisons, no gaps
| Check | Result |
|---|---|
| Overall status = worst-of(video, graphic) — 36-cell matrix | ✅ |
| `normStatus` (legacy/casing/aliases) | ✅ |
| `msgAudience` / `msgIsTweak` defaults | ✅ |
| `openCommentCount` over mixed thread (tweak/plain/done/deleted/reply) | ✅ |
| `nextTweakRound` numbering | ✅ |
| `hasBeenToKasper` via real signals (status / kasper_seen csv / kasper comment) | ✅ |
| `showApprovedAfterTweaks` | ✅ |
| `resolveDestRecommend` (fresh→kasper, seen→client, AAT→client) | ✅ |
| `reviewComponentActive` per mode (smm / client) × status | ✅ |
| `approvalBadgeCount` (review-queue size) per mode | ✅ |
| `canDeleteComment` / `canResolveComment` role rules | ✅ |
| `clearStaleApprovals` (clear below Client Approval, keep at/above) | ✅ |
| **client-visibility filter** — `_calCommentsForView` vs `_sxrCommentsForView` on a real `?c=` page (hide internal + Kasper; replies inherit root audience) | ✅ |
| `linearUrlFor` (video / graphic / empty) | ✅ |
| `mergeCommentLists` — newer-wins + tombstone-wins-over-stale | ✅ |
| `statusLabel` text | ✅ (alias of `_calStatusLabel`) |
| `hasBeenToKasper` / `showApprovedAfterTweaks` / `statusLabel` @ Scheduled/Posted | ◌ samples has no schedule/publish stage (4 diffs) |

### Batch 4 — Kasper review queue (`parity_logic.js`) — 5 checks, **2 GAPS FOUND**
| Check | Result |
|---|---|
| `kasperQueueVisible` video@Kasper · graphic@Kasper+linked · nothing@Kasper | ✅ |
| **graphic@Kasper + UNLINKED thumbnail** | 🔴 **GAP** — cal hides (un-actionable); samples surfaces a full approve/request panel |
| **video@Tweaks-Needed + open Kasper tweak** | 🔴 **GAP** — cal keeps the re-review hand-off in Kasper's queue; samples drops it |

### Batch 5 — merge / archive / card affordances (`parity_logic.js`) — 7 checks, **2 GAPS**
| Check | Result |
|---|---|
| `mergePostComments` (field-level, newer-wins per component) | ✅ |
| `isArchivedRef` by id / video link | ✅ |
| `isArchivedRef` by graphic link | ◌ samples also archives by graphic link (stricter) |
| **URGENT ping affordance** (video@TweaksNeeded+link) | 🔴 **GAP** — samples has no `_sxrShowUrgent` / URGENT button at all |
| **Status-pill lock for an unlinked component** | 🔴 **GAP** — cal disables the pill; samples lets you set any status |

## ✅ Findings RESOLVED — all 4 gaps fixed (PR #615)

All four are faithful ports of the calendar; `parity_logic.js` now reports **NO GAPS**.
- **#4 Status-pill lock** — `_sxrRenderInlineCard` now disables a component's status pill
  (`is-locked` + "Link a Linear sub-issue first") until its Linear sub-issue is linked.
- **#1 Unlinked-thumbnail gate + #2 re-review hand-off** — new `_sxrCompKasperVisible` /
  `_sxrPostKasperVisible` / `_sxrCompHasUnresolvedKasperTweak` (mirror of `_calCompKasperVisible`),
  used at all three Kasper-queue sites (load, render-awaiting, post-action removal).
- **#3 URGENT ping** — new `_sxrShowUrgent` + URGENT button on the Sheet card, wired to a
  new `_sxrSendUrgentSlack` that reuses the calendar's shared `_calUrgentSlackDispatch`.

> Note for review: with #2, after Kasper requests-a-change / approve-after-tweaks, his card
> now **stays** in the queue (re-review hand-off) instead of vanishing — matching the calendar.

<details><summary>Original finding details (now fixed)</summary>

**Theme A — unlinked components aren't gated (2 gaps, connected):**
4. **No status-pill lock.** Calendar disables a component's status pill until a Linear
   sub-issue is linked (`_calRenderInlineCard`: `is-locked` + `disabled "Link a Linear
   sub-issue first"`). Samples' `_sxrRenderInlineCard` (index.html:26100) has no lock —
   you can set an unlinked thumbnail to any status. **This is the root that lets #1 happen.**
1. **Unlinked-thumbnail gate missing on the samples Kasper queue.** The calendar's
   `_calCompKasperVisible` returns false for a `graphic` at `Kasper Approval` with no
   `graphic_linear_issue_id` (a junk status, e.g. from a Linear sync through a removed
   link, would otherwise show Kasper a thumbnail panel nobody can act on). Samples'
   `_sxrKasperLoadQueue` / `_sxrKasperRenderCard` (index.html:27797, 27822) have no such
   gate. **Fix:** port `_calCompKasperVisible`/`_calPostKasperVisible` to `_sxr` and use it
   for queue membership + panel rendering. *(higher confidence — clear robustness gate)*
**Theme B — missing affordances:**
2. **Re-review hand-off dropped.** The calendar keeps a component visible in Kasper's
   queue while it's at `Tweaks Needed` IF Kasper still has an unresolved tweak on it
   (`_calCompHasUnresolvedKasperTweak`), so he can track the re-review. Samples drops it
   the moment it leaves `Kasper Approval`. **Fix:** include the same clause. *(genuine but
   subtler workflow difference — worth a quick confirm)*
3. **URGENT ping not ported.** Calendar shows an "URGENT" button on a video at
   `Tweaks Needed` with a Linear link (`_calShowUrgent` → `_calSendUrgentSlack`, pings
   #video-editing). Samples has neither function nor button — though the Surface-2 header
   comment lists "URGENT" as in-scope, so it's an unfinished port. **Fix:** port
   `_calShowUrgent` + the ping button (+ a `_sxrSendUrgentSlack` if the Slack webhook is
   wired for samples). *(confirm whether the Slack ping is wanted for samples)*

### Batch 6 — composer + approve-split (inspection) — no new gaps
| Check | Result |
|---|---|
| Approve-split routing (primary/alt = seenByKasper ? client : kasper) | ✅ byte-identical source; rides `hasBeenToKasper` (already ✅) |
| Composer placeholder text | ◌ by-design copy refinement (rebuild reworded — not a behavioural gap) |

</details>

## Coverage status — high-value parity territory largely exhausted
Six batches, **140+ comparisons** across status math, routing predicates, visibility,
review-queue rules, Kasper surface, merge/freshness, archive, card affordances. New
*real* divergences have dried up — the last two passes turned up only by-design/cosmetic
differences. **4 real gaps stand open** (below) and are the high-value next step.
Remaining un-probed areas are low-yield (realtime echo dedup, drag-reorder persistence —
both already covered by the live scenario/temporal suites) so the finder is moving to a
slow heartbeat pending the fix decision.

## Next territory (low-yield, not yet probed)
- **Kasper surface** — unread-reply predicate, cross-client queue membership (Surface 8).
- **Approve-split routing** — primary/alt button (seen-by-Kasper → client default), `_calReviewApplyApprove` target.
- **Post-level save merge** — `_calMergePostComments`/field-level merge vs `_sxr` (no clobber under concurrent edits).
- **Archive ledger** — per-client archive hide/show (`_sxrArchived*`).
- **Card affordances (DOM)** — Sheet-card status pill set, media/missing-media flags, urgent ping (`_calShowUrgent` is video-only) — for `parity_check.js`.
- **Composer toggles** — audience/tweak/component segmented controls default + placeholder text.
