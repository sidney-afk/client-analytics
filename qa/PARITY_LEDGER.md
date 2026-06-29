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

### Batch 2 — pure logic (`parity_logic.js`) — 88 comparisons, no gaps
| Check | Result |
|---|---|
| Overall status = worst-of(video, graphic) — 36-cell matrix | ✅ |
| `normStatus` (legacy/casing/aliases) | ✅ |
| `msgAudience` default (internal vs client) | ✅ |
| `msgIsTweak` default | ✅ |
| `openCommentCount` over mixed thread (tweak/plain/done/deleted/reply) | ✅ |
| `nextTweakRound` numbering | ✅ |
| `hasBeenToKasper` via real signals (status / kasper_seen csv / kasper comment) | ✅ |
| `hasBeenToKasper` @ Scheduled/Posted | ◌ samples has no schedule/publish stage |
| `showApprovedAfterTweaks` | ✅ (◌ @ Scheduled/Posted) |
| `resolveDestRecommend` (fresh→kasper, seen→client, AAT→client) | ✅ |

## Next territory (not yet probed)
- **Client-visibility gating** — `_calCommentsForView` vs `_sxrCommentsForView` in CLIENT mode (hide internal/Kasper threads). Needs `_isClientLink` flip.
- **Review queue membership** — `_calReviewComponentActive` / `_calApprovalBadgeCount` per mode (smm vs client).
- **Stale-approval clearing** — `_calClearStaleApprovals` vs `_sxrClearStaleApprovals` (above-set; client_*_approved_at clearing).
- **Comment merge / freshness** — `_calMergePostComments` vs `_sxrMergePostComments` (newer-wins, tombstones).
- **Can-delete rules per role** — `_calCanDeleteComment` vs `_sxrCanDeleteComment`.
- **Linear routing** — `_calLinearUrlFor` vs `_sxrLinearUrlFor`; notes→Linear comment push.
- **Kasper surface** — unread-reply predicate, cross-client queue membership.
- **Status labels / pills** — `_calStatusLabel` vs `_sxrStatusLabel`.
- **Approve-split routing** — primary/alt button (seen-by-Kasper → client default).
- **Archive ledger** — per-client archive hide/show.
