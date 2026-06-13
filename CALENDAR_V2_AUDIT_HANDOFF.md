# Calendar v2 (Phase 2) — Session Handoff & Audit Brief

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
- **OUTSTANDING BUG (high-confidence root cause identified, NOT yet fixed):** the post-save *echo merge* corrupts sub-statuses on the editing tab. **See "The outstanding bug" — verify and fix this first.**

---

## What the project is

Migrate the content calendar's storage from a Google Sheet (read/written via unauthenticated
n8n webhooks) to **Supabase** (Postgres + realtime), so the calendar behaves like a live
Google-Sheet for every viewer (no 90s poll, no refresh jumps, no clobbering). Phases:
1. Dual-write (Sheet + Supabase) — **done.**
2. Hidden v2 view behind `?v2=1` (read Supabase + realtime, write field-level patches) — **in progress (this is us).**
3. Make v2 the default (v1 behind a flag) — not started.
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

2. **#471 — refresh re-pulled video/graphic from Linear.** `_calReconcileLinearStatuses` runs
   on every *foreground* load and overwrites video/graphic sub-statuses from the linked Linear
   issues. In v2 that's redundant (the backend Linear-status-sync already writes Linear changes
   into Supabase → realtime). **Fix:** skip the reconcile when `_calV2Ready()`.
   *Audit note: this was a real contributor to "refresh changes my statuses," but it was NOT
   the user's main bug (that's the echo-merge below). Re-evaluate whether this skip is the
   right long-term call, or whether the reconcile should instead be made idempotent.*

---

## THE OUTSTANDING BUG — verify and fix this first

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

## Audit checklist (do all of these)

1. **Reproduce the bug** on `?v2=1` (two tabs) BEFORE changing anything, to ground the fix.
2. **Echo-merge** (the bug above) — fix and verify.
3. **Patch builder** (`_calFlushCardSave`, v2 branch): does it send exactly the changed fields?
   Does it ever omit something the row needs? Cross-check against the upsert `ALLOWED` list.
4. **`_calMigratePostShape` on partial data**: audit every caller that may pass a partial row
   (echo, realtime payloads if ever parsed, cache). The realtime path currently refetches FULL
   rows (good) — confirm it stays that way.
5. **#470 base_at='' for v2**: confirm comment merging still behaves; confirm same-field
   concurrent edits resolve sanely (last-writer-wins + realtime).
6. **#471 reconcile skip**: confirm Linear→calendar still reaches v2 via the backend sync +
   realtime when an issue changes in Linear directly (test by moving a Linear issue).
7. **Realtime storms**: a "set all" or rapid edits fire multiple writes → multiple events →
   debounced refetch. Confirm no flicker / no lost optimistic state.
8. **Overall `status` vs sub-statuses** in storage: patches write `status` (overall) but not
   unchanged subs; FE recomputes overall on load, so stored `status` is advisory — confirm
   nothing depends on stored overall being exact.
9. **reorder fallback** (`calendar-reorder`, id `OXd0sUoSJYMspGTF`) has no Supabase mirror;
   a fallback reorder won't reach v2 until the next `reorder-batch`/backfill. Decide: add the
   mirror (rebuild on the live per-row version; do NOT publish the divergent batched draft).

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

- Fix the echo-merge bug (above) — top priority.
- Re-evaluate #470 / #471 as part of the audit.
- `calendar-reorder` fallback Supabase mirror.
- Phase 3 (v2 default behind kill-switch), Phase 4 (remove legacy machinery; per-client RLS; close open webhooks).

## How to test

`https://syncview.synchrosocial.com/?v2=1#calendar` (note: GitHub Pages caches `index.html`
~10 min — **hard-refresh** after a deploy). Console: `calV2Status()` → `{flag,ready,keySet,subscribed,slug}`.
Use two tabs for realtime. caption-status is the cleanest test (no Linear confound). `?v2=0` reverts to v1.
