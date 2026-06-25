# Samples v2 ↔ Calendar — Parity Log

**Why this file exists.** Samples v2 ("Sample Reviews") is a **fully-isolated fork** of the content
calendar's review machinery (deliberate decision: no shared code, so a calendar change can never
break samples and vice-versa). The cost of a fork is **drift**: a bug fixed in the calendar is NOT
automatically fixed in the samples twin. This file is the safety net — the **single place to check
whenever you change the calendar**, so you remember to mirror the change into samples if it applies.

**The rule (please follow it):**
> When you change anything in the calendar's review / Linear-sync / realtime / upsert / Kasper code,
> open this file, find the samples twin in the **Mirror Registry**, and add a row to the **Change Log**
> recording whether samples needs the same change. Don't close the task until the log row is resolved.

A change that touches a calendar function/workflow with a samples twin **probably needs mirroring**.
A change to a REUSED (shared, generic) artifact below propagates automatically — no mirror needed.

---

## 0. What is SHARED vs FORKED

**SHARED / REUSED AS-IS (a calendar fix here applies to samples automatically — no mirror needed):**

| Artifact | Notes |
|---|---|
| n8n `linear-issue-statuses` (resolver, poison-hardened) | Samples call the same webhook URL. |
| n8n `linear-set-status` (status pusher) | Same URL. |
| n8n `linear-add-comment` | Same URL. |
| FE `_calMapLinearStatusStrict` (Linear↔status mapping) | Samples call it directly (pure string logic). |
| FE `_calV2LoadLib`, `_calV2Client` (supabase-js loader + client singleton) | Table-agnostic; reused. |
| FE `_calSupabaseFetchAllRows` (compound `(id,client)` keyset paginator) | Reused for the samples reads. |
| FE `_calEsc` / `_calEscAttr` / `_jsAttrArg` (escapers) | Reused. |
| FE `wlNormalizeClient` (slug normalizer) | Reused. |

> If you ever change one of these in a way that should NOT affect samples, that's a signal it needs to
> be forked — note it in the Change Log.

**FORKED (a samples twin exists; a calendar change here must be mirrored if it applies):** see the
Mirror Registry below.

---

## 1. Mirror Registry  (calendar artifact → samples twin)

### Supabase
| Calendar | Samples twin | File |
|---|---|---|
| `calendar_posts` table | `sample_reviews` table | `sample-reviews-migration.sql` |
| (none — new) | `sample_review_events` (append-only log) | `sample-reviews-migration.sql` |
| `_calmerge_is_expired_tomb` | `_sxrmerge_is_expired_tomb` | `sample-reviews-migration.sql` |
| `_calmerge_comment_cell` | `_sxrmerge_comment_cell` | `sample-reviews-migration.sql` |
| `calendar_merge_comments` RPC | `sample_review_merge_comments` RPC | `sample-reviews-migration.sql` |
| `calendar_posts_stamp_status_at` trigger | `sample_reviews_stamp_status_at` trigger | `sample-reviews-migration.sql` |

### n8n
| Calendar | Samples twin | Notes |
|---|---|---|
| `calendar-upsert-post` (`pWSqaqVw7dmqhYOA`) | `sample-review-upsert` | Clone all guards (phantom-row, read-fail, conflict, `__CLEAR_LINK__`+carry-forward, atomic merge, strip-tweaks-before-mirror, ISO updated_at). |
| `calendar-get` | `sample-review-get` | Read fallback. |
| `calendar-reorder` | `sample-review-reorder` | Per-row update. |
| `linear-status-sync` (`MJbMZ789B5ExZz9x`) | `sample-linear-status-sync` | Inbound Linear→sample; keep freshness/Posted/archived guards. |
| `scripts/linear-sync-reconcile.js` + trigger `AkiFmromoDkmsh39` | `scripts/sample-linear-reconcile.js` + new trigger + `sample-linear-reconcile.yml` | **Must extract `SXR_COMPONENTS=['video','graphic']`, not `CAL_COMPONENTS`.** |

### Front-end (`index.html`) — `_cal*` → `_sxr*`
| Calendar fn / const | Samples twin | What it does |
|---|---|---|
| `computeOverallStatus` (+ `CAL_COMPONENTS`) | `computeSampleOverallStatus` (+ `SXR_COMPONENTS`) | Worst-of over the components. |
| `_calClearStaleApprovals` | `_sxrClearStaleApprovals` | Clears stamps when a sub drops below Client Approval. |
| `_calIsClientReady` | `_sxrIsClientReady` | Client-surface visibility (minus collab). |
| `_calComponentsFor` | `_sxrComponentsFor` | Flat `['video','graphic']`. |
| `_calMigratePostShape` | `_sxrMigrateShape` | Never seeds caption/title. |
| `_calRenderInlineCard` | `_sxrRenderInlineCard` | The card DOM. |
| `_calOnFieldInput/Blur`, `_calFlushCardSave`, `_calPendingEdits`, `_CAL_ROLLBACK_FIELDS` | `_sxrOnFieldInput/Blur`, `_sxrFlushCardSave`, `_sxrPendingEdits`, `_SXR_ROLLBACK_FIELDS` | Optimistic field-patch save. |
| `persistCalReorder`, `_calReorderOptimistic` | `persistSxrReorder`, `_sxrReorderOptimistic` | Reorder + guard. |
| `_calV2Enabled/Ready/FetchPosts/EnsureSubscribed/OnRealtimeChange/Teardown` | `_sxrV2*` (channel `sxr-<slug>`, table `sample_reviews`) | Realtime runtime. |
| `_calReviewCardBody`, `_calReviewPanelHtml`, `_calReviewApprove`, `_calReviewRequestTweak`, `_calReviewComment` | `_sxrReview*` | Review surface. |
| `_calShowResolveDest`, `_calResolveLastTweak`, `_calApplyAutoStatus` | `_sxrShowResolveDest`, `_sxrResolveLastTweak`, `_sxrApplyAutoStatus` | Resolve chooser + auto-status. |
| `_calCommentsFor`, `_calCommentsForView`, `_calMsgAudience`, `_calMergePostComments`, `_calStringifyComments` | `_sxrComments*` | Comment threads + audience gating + merge. |
| `_calPushStatusToLinear`, `_calNoLinearPush`, `_calSyncStatusFromLinear`, `_calPostLinearComment` | `_sxrPushStatusToLinear`, `_sxrNoLinearPush`, `_sxrSyncStatusFromLinear`, `_sxrPostLinearComment` | Linear push / suppression / point-adopt / comment. |
| `syncview_linear_outbox_v1` (durable outbox) | `syncview_sxr_linear_outbox_v1` | **Separate key** (calendar outbox dispatches by hard-coded URL). |
| `_calLocalRecentSaves`, `_calIsStaleLinearRegress`, `_calReassertLinearStatus` | `_sxr*` equivalents | Stale-Linear-round-trip protection. |
| `_calLinearCommit`, `_calMoveLink`, `_calLinkConflict`, `CAL_CLEAR_LINK_SENTINEL` | `_sxrLinearCommit`, `_sxrMoveLink`, `_sxrLinkConflict`, sentinel | Link commit/move/dedupe. |
| `_kasperRenderCard` + queue/partition/finish/close | the Kasper **Samples section** (`_kasperSample*`, own state slice) | Separate slice; persists via `sample-review-upsert`, never `_kasperPersistPost`. |

### Tests
Each `test/samples-*.js` / `qa/golden_sample_*.js` / `qa/probes/ps*.js` mirrors a calendar test —
keep them in lock-step (see `SAMPLES_V2_PLAN.md` §13).

---

## 2. Change Log

> Add a row whenever you change the calendar side of any registry entry above (or a SHARED artifact in
> a way that affects only one surface). `Mirror?` = does samples need the same change. `Status` =
> Pending / Done / N/A.

| Date | Calendar change (commit / PR) | Affected registry entry | Mirror? | Samples action | Status |
|---|---|---|---|---|---|
| 2026-06-25 | Samples v2 FE M5b — CLIENT REVIEW SURFACE forked | `_calReviewComponentActive` (client mode) / `_calReviewPanelHtml` / `_calReviewCardBody` (client mode) / `_calIsClientReady` | Forked the calendar's client review PANEL shape into `_sxrClient*` render, restricted to video+graphic, on the `_isClientLink` surface only. NEW: render-gating predicate `_sxrClientCompActive` (actionable ONLY at Client Approval / Tweaks Needed — clone of `_calReviewComponentActive` client mode); `_sxrIsClientReady` (clone of `_calIsClientReady` MINUS collab — constant `_SXR_CLIENT_COLLAB=false`); `_sxrClientReviewBodyHtml` / `_sxrClientReviewPanelHtml` / `_sxrClientReadonlyLineHtml` / `_sxrClientReviewPreview` (panel/line/preview render); `_sxrClientReviewState` (drafts/saving/errors slice); `_sxrClientReviewOnDraftInput` / `_sxrClientReviewApprove` / `_sxrClientReviewRequestChange` / `_sxrClientRepaintReview` (UI wiring → the EXISTING M3b handlers `_sxrClientApproveComp` / `_sxrClientRequestTweakComp`). Wired into the read-only branch of `_sxrRenderCard` (`<div data-sxr-client-review>`). Reuses the calendar `cal-review-*` CSS + the `_cal*` preview helpers + `_sxrCommentsForView(…, true)` audience gating. SMM/editor + Kasper surfaces UNCHANGED (only `_isClientLink` gets the panel). Fields stay non-editable (M2/M3b handler guards enforce). NO Linear push (M4). | initial build | Done |
| 2026-06-25 | Samples v2 FE M5a — Kasper Samples section forked | `_kasperRenderCard` + queue/partition/finish/close → the Kasper **Samples sub-tab** | Cloned `_kasperRenderCard`/`_kasperRenderExpanded`/`_kasperPanelHtml`/`_kasperRenderThread`/`_kasperRepaintCard`/`_kasperOnPanelDraftInput`/`_kasperPaintReview` partition into `_sxrKasperRenderCard`/`_sxrKasperRenderExpanded`/`_sxrKasperPanelHtml`/`_sxrKasperRenderThread`/`_sxrKasperRepaintCard`/`_sxrKasperOnPanelDraftInput`/`_kasperPaintSamples`. NEW: `samples` entry in `KASPER_SUBTABS` (gated `_sxrEnabled()`), `_kasperState.sxrSamples` slice, `_kasperRenderSamples`/`_kasperLoadSamples`/`_sxrKasperFetchAllSamples` (cross-client `_calSupabaseFetchAllRows` paginator on `sample_reviews`), action wrappers `_sxrKasper{Approve,RequestTweak,ApproveAfterTweaks,Finish,Close}Btn/Card` → delegate to the EXISTING `_sxrKasper*` handlers (→ `sample-review-upsert`). Presentational SAMPLE badge literal. NO `_kasperPersistPost`/`computeOverallStatus`/`_calPostKasperVisible`/calendar maps. v1 omits URGENT (M4) + the Replies/Messages union. | initial build | Done |
| 2026-06-25 | Samples v2 FE M3b — review state machine forked | computeOverallStatus / _calClearStaleApprovals / _calApplyAutoStatus / _calShowResolveDest / _calResolveLastTweak / _calReviewApprove+Apply / _calReviewRequestTweak / _kasperApprove/RequestTweak/ApproveAfterTweaks/UndoApprove/Finish/Close + _calStatusPick | Forked into `_sxr*` over video+graphic (no caption/title; terminal Approved+Archived; NO Scheduled/Posted). Kept the f302624/d57594c/95ecf90/80d376b resolve-chooser fixes + the 028cbd7/b5e73f5 created-at finish rule + the 732b2b4 handler-level surface guard. NO Linear push (M4); Kasper PAGE render (M5) — handlers only. | initial build | Done |
| _add new rows here, newest first_ | | | | | |

---

## 3. How to use this in practice
1. Changing a calendar review/Linear/realtime/upsert/Kasper function or workflow?
2. Look it up in the **Mirror Registry**. Shared/reused → nothing to do. Has a twin → continue.
3. Decide if the change applies to samples (most correctness/security fixes do; pure visual/calendar-only
   features usually don't).
4. Add a **Change Log** row. If it applies, make the matching `_sxr*` / `sample-*` edit and add the
   matching samples test, then mark Done.
5. Don't merge the calendar change until the log row is resolved (Done or N/A).
