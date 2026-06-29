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

## Next territory (not yet probed)
- **Kasper surface** — unread-reply predicate, cross-client queue membership (Surface 8).
- **Approve-split routing** — primary/alt button (seen-by-Kasper → client default), `_calReviewApplyApprove` target.
- **Post-level save merge** — `_calMergePostComments`/field-level merge vs `_sxr` (no clobber under concurrent edits).
- **Archive ledger** — per-client archive hide/show (`_sxrArchived*`).
- **Card affordances (DOM)** — Sheet-card status pill set, media/missing-media flags, urgent ping (`_calShowUrgent` is video-only) — for `parity_check.js`.
- **Composer toggles** — audience/tweak/component segmented controls default + placeholder text.
