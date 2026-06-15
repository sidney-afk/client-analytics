# Phase 4 — Calendar v1 Cleanup Checklist (the "what to delete" map)

> **Why this exists:** v2 (Supabase + realtime) was flipped to the **default** on 2026-06-14
> (`_calV2Enabled()` defaults true, `?v2=0` = sticky kill-switch). In ~2 weeks, once v2 has proven
> out, the dead v1 machinery should be removed. A fresh session won't *know* what's safe to delete —
> this doc captures it while the v1/v2 boundaries are fresh, so the cleanup is guided surgery, not
> archaeology. Pair with `CALENDAR_REALTIME_MIGRATION.md`.

## The key fact that makes this safe
The anon key is committed (`index.html:11000`, non-empty) and `_calV2Enabled()` defaults true, so
**`_calV2Ready()` is already `true` for every user in production.** Therefore every
`_calV2Ready() ? v2 : v1` branch already takes the v2 path and every `if (!_calV2Ready())` v1 path is
**already unreachable at runtime.** Consequence:
- **Steps 1–2 below are behavior-preserving refactors** (deleting already-dead code + collapsing the
  flag). Low risk.
- **Step 3 (retiring the Sheet read fallback) removes a still-executing safety net** — real risk,
  do it last, only after Supabase reliability is proven, ideally with a monitoring window.

## Preconditions before starting
- v2 has been the default and stable for **~2 weeks** with no `?v2=0` escalations.
- This is a **refactor**: after it, **both harnesses must still pass** (`node
  test/calendar-v2-status-repro.js`, `node test/calendar-v2-banner-persist.js`) and a live two-tab
  smoke test must behave identically. Branch + PR; never push to `main`.
- **Line numbers below are approximate and WILL drift** — locate each item by **symbol name**
  (grep), not by line.

---

## ORDER OF OPERATIONS

### Step 1 — Delete provably-dead code (zero behavior change)
1. **`_calReconcileLinearStatuses`** (~13034–13104) + its only call (~14735) + **`LINEAR_STATUSES_URL`**
   (~10960). It early-returns under v2 (`if (_calV2Ready()) return;`) and the call is v2-skipped — the
   whole body is already unreachable. *(This is the Linear→calendar READ-back; do NOT confuse with
   `_calPushStatusToLinear`, the calendar→Linear WRITE-out, which stays live.)*
2. **`_calConflictNotified`** (~11949) + its orphan `.delete(realId)` (~17028) + comment. It's
   constructed and `.delete()`'d but **never `.has()`/`.add()`'d** — the conflict dialog it guarded no
   longer exists. Dead.
3. **Then sweep for newly-orphaned helpers** from (1): `_calMapLinearStatusStrict`,
   `_calIsRowRecentlyTouched`, `_calIsLocalStatusFresh` — grep each; delete only if no other caller.
   *(`_calClearStaleApprovals`, `_calNoLinearPush`, `_calFlushCardSave` are used elsewhere — KEEP.)*

### Step 2 — Collapse the flag (`_calV2Enabled`/`_calV2Ready` → `true`), branch by branch
Do these *before* deleting the flag functions, so each branch is simplified in place:
- **Read-swap** in `loadCalendarPosts` (~14504–14512): keep only `return _calV2FetchPosts(...)`;
  delete the `else` `CALENDAR_GET_URL` fetch.
- **Films runway** `_filmsFetchRunway` (~23048–23055): keep the `_calV2FetchPosts` call; delete the
  `else` n8n branch.
- **Kasper batch gate** (~23792): `if (remaining.length && _calV2Ready())` → `if (remaining.length)`.
- **`_calFlushCardSave` patch branch** (~16904): condition is `_calV2Enabled() && !wasNewRow &&
  Object.keys(edits).length > 0` → **drop only the `_calV2Enabled() &&` operand.** Keep the rest and
  keep the `else` whole-card block (new rows + forced resends still send whole-card). *(This is
  "delete one operand of an &&", not "delete a branch.")*
- **`_baseAtToSend`** in the card-save path (~16954): `_calV2Enabled() ? '' : String(post._baseAt||'')`
  → just `''`. **Only this card-save site** — see landmines.
- **Recent-save reconcile wrapper** (~14593): unwrap `if (_calV2Enabled()) { const reconciled =
  _calRecentSaveReconcile(...); if (reconciled) return reconciled; }` so reconcile always runs.
- **Return-refresh ternary** (~12295): `_calV2Ready() ? CAL_RETURN_REFRESH_MIN_MS_V2 :
  CAL_RETURN_REFRESH_MIN_MS` → keep the v2 floor; delete `CAL_RETURN_REFRESH_MIN_MS` (~12280)
  (optionally rename the V2 const back to `CAL_RETURN_REFRESH_MIN_MS`).
- **Then delete the flag itself:** `_calV2Enabled`, `_calV2Ready`, `_calV2FlagCache`, `CAL_V2_LS_KEY`,
  `CAL_V2_KILL_KEY`. Update or delete `window.calV2Status` (it references the flag functions — will
  break if you inline them without updating it).
- **`?v2debug` logging** (`_calV2DebugOn`/`_calV2Log`/`_calV2DebugLS`, ~14207–14229, ~9 call sites):
  pure diagnostics, NOT coupled to v1 — **keep (harmless) or remove deliberately.** If removing, strip
  all `_calV2Log(...)` calls **and** the `_calV2DebugOn()` MERGE-clobber diagnostic block (~14616–14625).

### Step 3 — Retire the Sheet read path (do LAST — removes a live safety net)
- `_calV2FetchPosts` internal `catch` fallback to `CALENDAR_GET_URL` (~14297–14302).
- Kasper `kasper-queue`/`calendar-get` fan-out in `_kasperFetchAllRelevantPosts` (~23823–23866) +
  **`KASPER_QUEUE_URL`** (~10957).
- Once those are gone, **`CALENDAR_GET_URL`** (~10945) has no readers → remove.
- Only after this can the n8n `calendar-get`/`kasper-queue` workflows + the Google Sheet itself be
  retired (decide: keep the Sheet as a human-readable export, or drop it).

---

## Classification reference (REMOVE / SIMPLIFY / KEEP)

**REMOVE (dead once v2 permanent):** `_calReconcileLinearStatuses`, `LINEAR_STATUSES_URL`,
`_calConflictNotified`; (step 3) `CALENDAR_GET_URL`, `KASPER_QUEUE_URL` + the Kasper fan-out.

**SIMPLIFY (delete a flag branch/operand, keep the function):** the read-swap in `loadCalendarPosts`,
the films-runway read-swap, the Kasper batch gate (23792), the `_calFlushCardSave` patch condition
(16904), `_baseAtToSend` (16954), the reconcile wrapper (14593), the return-refresh ternary (12295).
Then remove the flag plumbing: `_calV2Enabled`/`_calV2Ready`/`_calV2FlagCache`/`CAL_V2_LS_KEY`/
`CAL_V2_KILL_KEY`/`window.calV2Status`.

**KEEP — SHARED, v2 relies on these (do NOT remove):**
- Save/merge core: `_calPendingEdits`, `_calSaveInFlight`, `_calSaveTimers`, the `winner` IIFE,
  `_calLocalRecentSaves`, `_calRecentSaveFields`, `_calRecentSaveReconcile`, `CAL_CONFLICT_WINDOW_MS`,
  `_CAL_ROLLBACK_FIELDS`, `computeOverallStatus`, `_calMigratePostShape`, `_calClearStaleApprovals`,
  `_calMergePostComments`, `_calPushStatusToLinear`, `_baseAt` tracking.
- Read/cache/render: `_calV2FetchPosts` (now the only read), the SWR cache (`_calCacheRead/Write`,
  `CAL_CACHE_KEY_PREFIX`, `CAL_CACHE_TTL_MS`), the archive ledger (`_calArchived*`,
  `_calCleanArchiveLedger`, `_calIsArchivedRef`), `_calRefreshOnReturn` + `_calLastNetworkLoadAt`,
  `_calDedupeByLinearIssue`, `_calRenderBody`.
- Supabase runtime: `CAL_SUPABASE_URL/_ANON_KEY/_LIB_URL`, `CAL_V2_RT_DEBOUNCE_MS`,
  `_calV2LoadLib`/`_calV2Client`, `_calV2EnsureSubscribed`/`_calV2OnRealtimeChange`/`_calV2Teardown` +
  channel state, `CAL_RT_SELF_ECHO_MS`, `_calLastLocalWriteAt`, `_kasperV2EnsureSubscribed`/
  `_kasperV2Teardown` + Kasper channel, the Kasper Supabase batch read (~23783–23822).
  *(Their `if (!_calV2Ready())` guards become vacuous — keep or simplify, but keep the bodies.)*
  Optionally drop the `V2` suffix from these names since there's no longer a v1 to contrast.

---

## LANDMINES (where "remove v1" ≠ "delete the function")
- **`_calFlushCardSave`:** new rows + forced resends (`_calRetrySave`, empty `edits`) must keep
  whole-card semantics **even under v2**. Delete only the `_calV2Enabled() &&` operand at 16904.
- **`comments_base_at` has THREE save paths with different values:** settings save sends `''` always
  (~11807); card save sends the flag-gated `_baseAtToSend` (~16961, the one to set to `''`); a third
  path (~24508–24510) sends the **real `_baseAt` unconditionally** — **do not blindly empty it.**
- **The `winner` IIFE** (~14557–14615) is ONE merge serving both paths; only the 14593
  `if (_calV2Enabled())` reconcile wrapper is flag plumbing. Everything else is SHARED.
- **`_baseAt` is still computed/stored under v2** (~14556/14641/17010) for the comment 3-way merge —
  only its *transmission as a scalar base* changes. Don't delete `_baseAt` tracking.
- **`_v1` storage tags are NOT the calendar-v1 feature:** `'syncview_calCache_v1:'`, `KASPER_CACHE_KEY`,
  `syncview_captionJobs_v1`, the archive ledger keys — these are storage-schema versions. **A
  grep-for-`v1`-and-delete will corrupt the cache/ledger layer.** Leave them.
- **`_calPushStatusToLinear` (live, KEEP) vs `_calReconcileLinearStatuses` (dead, REMOVE):** opposite
  directions — don't conflate.
- **`window.calV2Status`** references the flag functions; inlining them breaks it — update/delete in
  the same pass.

## Verify after cleanup
- `node test/calendar-v2-status-repro.js` → `OVERALL: PASS`; `node test/calendar-v2-banner-persist.js`
  → all pass. (If the `_calV2Log`/`_calRecentSaveReconcile` names are touched, the harness extracts
  `_calRecentSaveReconcile` by name — keep that symbol.)
- Inline `<script>` `node --check` clean.
- Grep for orphans: no remaining references to any removed symbol (`_calV2Enabled`, `_calV2Ready`,
  `CALENDAR_GET_URL`, etc.).
- Live two-tab smoke test: a status change + a Kasper approval propagate within ~1s; a save round-trips
  and mirrors to Supabase — behavior identical to pre-cleanup.
