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

## ⚠ Open findings — divergences pending decision
1. **Unlinked-thumbnail gate missing on the samples Kasper queue.** The calendar's
   `_calCompKasperVisible` returns false for a `graphic` at `Kasper Approval` with no
   `graphic_linear_issue_id` (a junk status, e.g. from a Linear sync through a removed
   link, would otherwise show Kasper a thumbnail panel nobody can act on). Samples'
   `_sxrKasperLoadQueue` / `_sxrKasperRenderCard` (index.html:27797, 27822) have no such
   gate. **Fix:** port `_calCompKasperVisible`/`_calPostKasperVisible` to `_sxr` and use it
   for queue membership + panel rendering. *(higher confidence — clear robustness gate)*
2. **Re-review hand-off dropped.** The calendar keeps a component visible in Kasper's
   queue while it's at `Tweaks Needed` IF Kasper still has an unresolved tweak on it
   (`_calCompHasUnresolvedKasperTweak`), so he can track the re-review. Samples drops it
   the moment it leaves `Kasper Approval`. **Fix:** include the same clause. *(genuine but
   subtler workflow difference — worth a quick confirm)*

## Next territory (not yet probed)
- **Kasper surface** — unread-reply predicate, cross-client queue membership (Surface 8).
- **Approve-split routing** — primary/alt button (seen-by-Kasper → client default), `_calReviewApplyApprove` target.
- **Post-level save merge** — `_calMergePostComments`/field-level merge vs `_sxr` (no clobber under concurrent edits).
- **Archive ledger** — per-client archive hide/show (`_sxrArchived*`).
- **Card affordances (DOM)** — Sheet-card status pill set, media/missing-media flags, urgent ping (`_calShowUrgent` is video-only) — for `parity_check.js`.
- **Composer toggles** — audience/tweak/component segmented controls default + placeholder text.
