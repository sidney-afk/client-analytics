# Calendar v2 (Phase 2) — Session Handoff & Audit Brief

> ⚠️ **SUPERSEDED / HISTORICAL (as of the 2026-06-15 audit).** Current source of truth:
> **`AUDIT_2026-06-15.md`**. Correction to checklist item #9 and the TL;DR below: the
> **`calendar-reorder` Supabase mirror is LIVE** (added + published 2026-06-14) — it is **no longer
> deferred** and there is **no divergent draft**. All 7 writers mirror to Supabase. The write path
> is being inverted to Supabase-primary (Sheet kept as a backup mirror).

**Date:** 2026-06-13
**Prev session branch:** `claude/busy-hamilton-44ajpb` (merged via PRs #469, #470, #471)
**Purpose:** Hand off the calendar realtime migration (Phase 2) to a fresh session for a
rigorous audit + a proper fix of a persistent status bug. Read this top-to-bottom,
then `CALENDAR_REALTIME_MIGRATION.md` for the full migration plan.

> The user is (rightly) frustrated by iterative patch-and-pray. **Do not guess.**
> Reproduce, verify root cause against the actual code/data, fix, then prove the fix
> with the two-tab repro below. v2 is flag-gated (`?v2=1`); v1 (default) is unaffected,
> so normal users are safe — but the user is testing v2 and hitting a real bug.

---

## TL;DR

- **Phase 1 (dual-write Sheets→Supabase): done & verified** (all FE-used write workflows mirror to Supabase; only the rare `calendar-reorder` *fallback* lacks a mirror).
- **Phase 2 (hidden v2 behind `?v2=1`): built, merged, live.** v2 reads from Supabase REST + a realtime subscription, and writes **field-level patches** to the existing n8n upsert webhook.
- **Verified working:** realtime delivers in <1s; field patches persist to Supabase; caption-status (no Linear link) round-trips cleanly; sidneylaruel Sheet↔Supabase in sync; 0 legacy null-sub rows across all 617 rows / 15 clients.
- **STATUS-REVERT BUG: FIXED 2026-06-13.** Root cause confirmed against the real code AND
  the live backend, reproduced deterministically, fixed FE-only, proven with the two-tab
  repro + 11 related sequences + comment round-trip. **See "THE STATUS-REVERT BUG — RESOLVED"
  below.** Regression guard: `test/calendar-v2-status-repro.js`.

### 2026-06-14 updates (merged: PRs #473 / #474 / #475)
- **Realtime freshness (#474):** cross-tab updates were intermittent (observer tab sometimes
  only updated on a manual refresh). Fixes: under v2 the tab-return refetch drops the 90s
  throttle (Supabase reads are cheap; still event-driven, never a poll); a **catch-up reload
  when the realtime socket re-subscribes** (a suspended background tab misses events — Supabase
  doesn't replay them); a realtime event that lands mid-load is **deferred, not dropped**.
- **Linear-meta banner persistence (#474):** the "incomplete sub-issue" banner (project/due/
  editor) is now persisted (localStorage, 7-day TTL) so it's instant on load + survives refresh,
  and refreshed on v2 tab-return so it self-heals. No timer/poll; no idle n8n load.
- **Banner on done cards (#475 + backend):** Approved/Posted issues are excluded from the
  workload feed, so done cards showed no banner. The FE now fetches their meta from the
  **extended `linear-issue-statuses` webhook** (now returns `{statuses, meta}`; see
  `n8n-backups/linear-issue-statuses.2026-06-14.post-meta.json`). Throttled, persisted,
  degrades gracefully. Meta-only — never touches sub-statuses (so #471 holds).
- **Banner consistency (this branch):** stopped flagging **"no project"** entirely. A sub-issue's
  project is inconsistent (some carry it, some inherit a client via the feed's mapping, many +
  their parents have none) and is never the actionable signal — the banner now flags only due
  date + editor, so it reads the same on every card. Guard: `test/calendar-v2-banner-persist.js`.
- **NEXT:** before Phase 3, run the full-system audit in **`PHASE3_AUDIT_PROMPT.md`**.

---

## What the project is

Migrate the content calendar's storage from a Google Sheet (read/written via unauthenticated
n8n webhooks) to **Supabase** (Postgres + realtime), so the calendar behaves like a live
Google-Sheet for every viewer (no 90s poll, no refresh jumps, no clobbering). Phases:
1. Dual-write (Sheet + Supabase) — **done.**
2. Hidden v2 view behind `?v2=1` (read Supabase + realtime, write field-level patches) —
   **built, merged, live; status-revert bug fixed; realtime + banner hardened.** Audit
   pending before flipping the default (see `PHASE3_AUDIT_PROMPT.md`).
3. Make v2 the default (v1 behind a flag) — **next** (run the Phase 3 audit first).
4. Remove the legacy polling/LWW/conflict/ledger machinery; add real per-client auth (RLS); close the open webhooks — not started.

---

## What was done this session (Phase 2) + code locations

All in `index.html` (one ~25k-line file; single inline `<script>`). Search `CALENDAR v2`.

- **Config** (~line 10983): `CAL_SUPABASE_URL`, `CAL_SUPABASE_ANON_KEY` (publishable key, committed — see Secrets), `CAL_SUPABASE_LIB_URL` (supabase-js UMD, lazy-loaded), `CAL_V2_LS_KEY`, `CAL_V2_RT_DEBOUNCE_MS`.
- **v2 runtime module** (~line 14080): `_calV2Enabled()` (flag: `?v2=1` sticky in localStorage, `?v2=0` clears), `_calV2Ready()` (flag AND anon key set), `_calV2LoadLib/_calV2Client` (lazy supabase-js), `_calV2FetchPosts` (Supabase REST read, falls back to n8n `calendar-get` on error), `_calV2EnsureSubscribed/_calV2OnRealtimeChange/_calV2Teardown` (realtime: a change debounces into one background `loadCalendarPosts({background:true})`). `window.calV2Status()` is a console helper.
- **Read swap** inside `loadCalendarPosts` (~line 14316): `if (_calV2Ready()) return _calV2FetchPosts(...)` else the n8n fetch. Same `{ok,posts[]}` shape → reuses the entire normalize/dedupe/LWW-merge/render/cache pipeline.
- **Subscribe hook** at the end of `loadCalendarPosts` success (~line 14512): `if (_calV2Ready()) _calV2EnsureSubscribed(slug)`.
- **Field-level patch write** in `_calFlushCardSave` (~line 16657): when `_calV2Enabled() && !wasNewRow && Object.keys(edits).length>0`, build `wirePost = {id, ...only the changed fields}` (+ recomputed `status` if any sub-status changed, + per-component `*_tweaks` only if comments changed). New rows / forced retries still send the whole card.
- **Teardown hooks**: `navTo` (~line 10866, on leaving calendar) and `mountCalendar` (~line 12202, on remount).

### Activation (done by the user in Supabase)
- RLS: `anon` SELECT policy on `public.calendar_posts` (writes still denied → only n8n service_role writes).
- Realtime: table added to `supabase_realtime` publication; `replica identity full`.
- Anon/publishable key pasted into `CAL_SUPABASE_ANON_KEY`.

---

## Bugs found & fixed this session (assess these critically too)

1. **#470 — false-rejected saves under concurrent editing.** The upsert workflow's conflict
   guard (`Merge Comments` → `Is Conflict`) compares the FE's `comments_base_at` against the
   **Google Sheet's** `updated_at`. v2 reads Supabase and set `_baseAt` from *Supabase's*
   `updated_at`; those drift (and with two editors, each save advances the Sheet ts past the
   other's base), so the guard rejected v2 scalar saves as false conflicts → status fields
   rolled back (they're in `_CAL_ROLLBACK_FIELDS`), caption silently didn't save.
   **Fix:** v2 sends `comments_base_at: ''` (skips the scalar-conflict check; comment 3-way
   merge still unions). Verified: stale base → `{ok:false}`, empty base → `{ok:true}`.
   *Audit note: is fully disabling that guard for v2 acceptable? It's a v1 (Sheet-authoritative)
   mechanism; field patches + realtime are meant to replace it. Confirm no regression for
   two people editing the SAME field (last-writer-wins is expected).*
   **→ CONFIRMED CORRECT 2026-06-13.** For v2 the scalar guard is genuinely obsolete: a field
   patch only writes the column it changed, so two people on DIFFERENT fields never collide,
   and on the SAME field LWW + realtime is the intended semantic (harness `concurrent
   same-field` case: both tabs converge to the last write). Comment merge still unions with an
   empty base (confirmed live).*

2. **#471 — refresh re-pulled video/graphic from Linear.** `_calReconcileLinearStatuses` runs
   on every *foreground* load and overwrites video/graphic sub-statuses from the linked Linear
   issues. In v2 that's redundant (the backend Linear-status-sync already writes Linear changes
   into Supabase → realtime). **Fix:** skip the reconcile when `_calV2Ready()`.
   *Audit note: this was a real contributor to "refresh changes my statuses," but it was NOT
   the user's main bug (that's the echo-merge below). Re-evaluate whether this skip is the
   right long-term call, or whether the reconcile should instead be made idempotent.*
   **→ CONFIRMED CORRECT 2026-06-13.** The skip is the right call for v2: Linear changes reach
   v2 through the backend (Linear Status Sync → `calendar-upsert-post` → Supabase mirror →
   realtime, workflow verified **active**), so the FE pull is redundant AND was actively
   harmful (a stale Linear read could clobber a fresh approval). The backend sync is the single
   Linear→calendar path under v2; no need to make the FE reconcile idempotent.*

---

## THE STATUS-REVERT BUG — RESOLVED (2026-06-13)

**Fix (FE-only):** `_calFlushCardSave` echo-merge now overlays the partial echo onto the
full local row *first*, then runs `_calMigratePostShape` on the **merged full row** —
so every sub-status is present and nothing is invented. One-line essence:

```js
// before (buggy):  _calMigratePostShape(saved);  Object.assign({}, local, saved)
// after  (fixed):  Object.assign({}, local, saved) → _calMigratePostShape(merged)
```

No n8n / Supabase change was needed (the backend was already correct — only the editing
tab's in-memory adoption of the echo was wrong).

**Verified mechanism (why ONLY video flips, one step LATE — confirmed, not guessed):**
1. The upsert echo is a field-level patch — captured live, it is literally
   `{id, updated_at, status, caption_status}` for a caption change (no video/graphic).
2. `_calMigratePostShape` on that partial echo sets `video_status = graphic_status =
   'In Progress'` (its `isLegacyOnly` guard is false once caption is present), and the
   `Object.assign({}, local, saved)` overlays those onto the correct local values.
3. The save **success path does not re-render**, so the clobber is **latent** in
   `calState`. The realtime reload that follows keeps the clobbered local copy (the
   `_calLocalRecentSaves` recent-save guard prefers local for 90 s) AND finds
   `dataChanged=false` (clobbered == clobbered) → **no repaint**. So the DOM keeps the
   correct optimistic value while memory is wrong.
4. The clobber lands at step 2 (graphic save invents video→In Progress) but only becomes
   **visible** at step 3, when the caption click calls `_calRenderBody` and repaints the
   whole card from the latently-clobbered `calState`. Graphic still shows its step-2
   optimistic value (never repainted away), so only video appears to flip.
5. A hard refresh clears the in-memory `_calLocalRecentSaves`, so the merge takes the
   correct Supabase row → self-heals. Tab 2 always refetched the full row → always correct.

**Live-data fingerprint found:** sidneylaruel card `p_mpyjfkmz_fhdlr` had correct subs
(video=For SMM Approval, graphic=Client Approval, caption=Approved) but stored
`status=In Progress` — impossible from `computeOverallStatus` unless the overall was
computed while video was clobbered. (Repaired this session as a side effect of the echo probe.)

**Proof:** `test/calendar-v2-status-repro.js` extracts the *real* shipped functions
(by name) and a webhook simulator validated against the live echoes; it reproduces the
bug under the old merge, shows it gone under the fix, and passes a battery of 11 related
sequences (canonical, reversed, caption-twice, regression-to-Tweaks, interleaved, mixed
seeds, set-all incl. a skipped/unlinked component, realtime storm, concurrent same-field)
plus a comment-preservation case. `node test/calendar-v2-status-repro.js` → `OVERALL: PASS`.

---

## (historical) The original bug brief — verify and fix this first

### Exact repro (user, two tabs on the same `sidneylaruel` calendar, `?v2=1`)
1. Tab 1: video → SMM Approval. Propagates to Tab 2. ✅
2. Tab 1: graphic(thumbnail) → Client Approval. Propagates. ✅
3. Tab 1: caption → Approved. Propagates. ✅ — **but now Tab 1's video flips to "In Progress" on its own.**
   - Tab 1 shows: video=In Progress, graphic=Client Approval, caption=Approved.
   - Tab 2 shows (correct): video=SMM Approval, graphic=Client Approval, caption=Approved.
4. Refresh Tab 2 → unchanged (correct). Refresh Tab 1 → **self-heals** to the correct values.

So: the bug is **local to the editing tab's in-memory state right after a save**; storage
(Supabase), the other tab (realtime), and any refresh are all correct.

### Root cause (high confidence — verify it)
Field-level patches mean the upsert **echo** (`json.post`) contains **only the patched
columns**. In `_calFlushCardSave` (search `const saved = json.post`):

```js
const saved = json.post || post;        // partial in v2: e.g. {id, updated_at, caption_status, status}
_calMigratePostShape(saved);            // BUG: invents the ABSENT sub-statuses
const i2 = calState.posts.findIndex(p => p.id === realId);
if (i2 >= 0) {
    const merged = Object.assign({}, calState.posts[i2], saved);  // clobbers good local video/graphic
    ...
}
```

`_calMigratePostShape` (search `function _calMigratePostShape`) seeds missing sub-statuses:
when at least one sub is present (here caption) but video/graphic are absent, `isLegacyOnly`
is false, so it sets `video_status = graphic_status = 'In Progress'`. Then
`Object.assign({}, local, saved)` overlays those invented `'In Progress'` values over the
correct local ones. The other tab refetches the FULL row from Supabase, so `_calMigratePostShape`
sees all three subs and keeps them — which is why only the editing tab is wrong and a refresh
fixes it. This matches the repro exactly.

### Proposed fix (verify, then apply)
Migrate the **merged full row**, not the partial echo, so absent echo fields are filled from
local state instead of invented:

```js
const saved = json.post || post;
const i2 = calState.posts.findIndex(p => p.id === realId);
if (i2 >= 0) {
    const merged = Object.assign({}, calState.posts[i2], saved); // overlay only the echo's keys
    _calMigratePostShape(merged);                                // migrate the FULL row
    const queued = _calPendingEdits[realId];
    if (queued) for (const k in queued) merged[k] = calState.posts[i2][k];
    _calMergePostComments(merged, calState.posts[i2]);
    merged._baseAt = String(saved.updated_at || merged.updated_at || merged._baseAt || '');
    calState.posts[i2] = merged;
}
```

Equivalent for v1 (full echo). For v2 (partial echo) it preserves local video/graphic.
**After fixing, run the 4-step repro above and confirm Tab 1 no longer flips.**

---

## Audit checklist — WORKED 2026-06-13 (conclusions inline)

1. ✅ **Reproduce the bug** — done deterministically via the extracted-real-code harness
   grounded in live webhook echoes + live Supabase data (see RESOLVED section).
2. ✅ **Echo-merge** — fixed (migrate the merged full row) and proven.
3. ✅ **Patch builder** — sends exactly the changed scalar fields + recomputed `status` (only
   when a sub changed) + only the `*_tweaks` whose thread changed; all keys are in the upsert
   `ALLOWED` list. Stale-approval clears (`_calClearStaleApprovals`) write into the same
   `_calPendingEdits` bucket, so they ride along in `edits` and are sent. No needed field is omitted.
4. ✅ **`_calMigratePostShape` on partial data** — all 5 callers audited. Only the echo-merge
   passed a partial row (now fixed). The other four — cache read (`loadCalendarPosts`), network
   fetch (`loadCalendarPosts`), Kasper cache-hydrate, Kasper network-load — all pass FULL rows.
   The realtime path refetches FULL rows via Supabase REST `select=*` (confirmed) and stays that way.
5. ✅ **#470 base_at='' for v2** — comment merging still unions correctly with an empty base
   (verified live: the echo for a caption patch returned the pre-existing comment merged in).
   Same-field concurrent edits resolve as last-writer-wins and both tabs converge once the
   recent-save window passes (harness `concurrent same-field` case). Disabling the *scalar*
   conflict guard for v2 is correct: field patches only write the changed field, and realtime
   surfaces the other editor within ~1 s, so the Sheet-authoritative guard is obsolete for v2.
6. ✅ **#471 reconcile skip** — sound. `_calReconcileLinearStatuses` early-returns under
   `_calV2Ready()` (verified). Linear→calendar reaches v2 via the backend: Linear Status Sync
   (`MJbMZ789B5ExZz9x`, **active**) sends a sub-status-only patch to `calendar-upsert-post`,
   which dual-writes to Supabase → realtime → v2 (no echo processing on the backend; the FE
   reload pulls the FULL row, so no partial-echo hazard there). The live mirror is confirmed
   writing to Supabase. (A literal Linear-move test was skipped — it depends on Linear→n8n
   webhook delivery that can't be observed here; the path is verified active by inspection.)
7. ✅ **Realtime storms** — harness `set-all` (incl. a skipped/unlinked component → partial echo)
   and `storm` (several saves before one coalesced reload) cases pass under the fix; no lost
   optimistic state, no flicker.
8. ✅ **Overall `status` vs sub-statuses** — nothing depends on the stored overall being exact:
   every load path runs `_calMigratePostShape` which recomputes `status = computeOverallStatus`.
   The Linear sync deliberately never writes the overall column either. Confirmed against the
   live data (the fingerprint card displayed correctly despite a wrong stored `status`).
9. ⏸️ **reorder fallback** (`calendar-reorder`, `OXd0sUoSJYMspGTF`) — **DEFERRED** (unrelated to
   the status bug; only fires when `reorder-batch` fails; self-heals on the next `reorder-batch`
   / backfill). Fixing it means editing that workflow, which carries the divergent unpublished
   batched-draft hazard (editing+publishing would flip live reorder to the batched version).
   Recommended later: rebuild the Supabase mirror on the LIVE per-row version without publishing
   the batched draft. Not worth the risk during the v2 test week.

---

## Verified working (so you can trust the infra)

- Realtime end-to-end: subscribed via supabase-js (publishable key), triggered a webhook write,
  event arrived in <1s. (Repro harness: subscribe to `postgres_changes` on `calendar_posts`
  filtered `client=eq.<slug>`, then POST to `calendar-upsert-post`.)
- Field-level status patch persists to BOTH Sheet and Supabase (autoMapInputData writes only
  the keys present, matched on `id`; other columns untouched). Mirror is an async fan-out, so
  it lags the webhook response slightly — but the realtime event fires *after* the mirror writes.
- caption_status (no Linear issue) round-trips cleanly through a patch.
- sidneylaruel: 3 live cards, Sheet↔Supabase in sync, no timestamp drift, sub-statuses populated.
- All 617 live rows / 15 clients: **0** rows have a status set with all sub-statuses empty
  (so the legacy in-memory-seeding divergence is NOT present in current data).

---

## Backend (n8n) facts (MCP access available; snapshot before editing into `n8n-backups/`)

- **Upsert** (`calendar-upsert-post`, `pWSqaqVw7dmqhYOA`): `Build Row From Patch` (ALLOWED
  whitelist; writes only keys present) → `Read Existing Row` → `Merge Comments` (3-way comment
  merge + **scalar-conflict guard**: blocks if `existing.updated_at(SHEET) > comments_base_at`
  AND a scalar field changed → `{ok:false, conflict:true}`) → upsert (Sheets `appendOrUpdate`,
  `autoMapInputData`, match `id`) → async Supabase mirror fan-out. **LIVE, dual-writing.**
- **Linear status-sync** (`MJbMZ789B5ExZz9x`): Linear webhook → patches ONLY the matched
  sub-status (video OR graphic) of the matched card; never writes caption or overall; skips
  Posted/archived. Calls the same upsert webhook (so it dual-writes for free).
- **delete-post / reorder-batch / append-post**: dual-write mirrors LIVE (verified 2026-06-13).
- The FE pushes sub-statuses TO Linear in `_calFlushCardSave` success (`_calPushStatusToLinear`),
  video_status→video issue, graphic_status→graphic issue (caption has no Linear issue).

---

## Secrets / activation

- `CAL_SUPABASE_ANON_KEY` = the **publishable** key (`sb_publishable_...`), browser-safe, committed.
- **⚠️ Rotate the service_role key:** it was pasted into chat in plaintext this session. New key →
  update the n8n credential `Supabase - SyncView Calendar` (`XdBpJ6Xk8PMpZXXT`). It is NOT in the repo.
- Supabase project ref: `uzltbbrjidmjwwfakwve`.

## Open items / phases remaining

- ~~Fix the echo-merge bug~~ **DONE 2026-06-13** (FE-only; proven; regression guard committed).
- ~~Re-evaluate #470 / #471~~ **DONE** — both confirmed sound (see checklist 5 & 6).
- `calendar-reorder` fallback Supabase mirror — still deferred (see checklist 9).
- ⚠️ The live Linear API key is still hardcoded in plaintext in the Linear Status Sync code
  node (migration-doc finding #5). Rotate it into an n8n credential; keep it out of the repo.
- Phase 3 (v2 default behind kill-switch), Phase 4 (remove legacy machinery; per-client RLS; close open webhooks).

## How to test

`https://syncview.synchrosocial.com/?v2=1#calendar` (note: GitHub Pages caches `index.html`
~10 min — **hard-refresh** after a deploy). Console: `calV2Status()` → `{flag,ready,keySet,subscribed,slug}`.
Use two tabs for realtime. caption-status is the cleanest test (no Linear confound). `?v2=0` reverts to v1.
