# Content Calendar — Full System Audit Prompt (pre–Phase 3)

> **How to use:** open a fresh Claude Code session on this repo (`sidney-afk/client-analytics`)
> with the same MCP access (n8n, Supabase via the committed publishable key, Linear, GitHub)
> and paste everything below the line as the task. It drives a rigorous, read‑only audit of the
> entire content‑calendar system before we flip v2 to the default (Phase 3). Develop on a branch
> if you fix anything; never push to `main`.

---

You are auditing the **Content Calendar realtime migration (Google Sheets → Supabase)** end to
end, to decide whether it is safe to make **v2 the default** (Phase 3). Be rigorous and
**empirical — verify against real data and the live backend, do not guess or trust the docs
blindly.** Reproduce, check the actual code/workflows/rows, and only then conclude.

## 0. First, read these in full (in order)
1. `CALENDAR_V2_AUDIT_HANDOFF.md` — current state, what's built/merged, verified facts, known risks.
2. `CALENDAR_REALTIME_MIGRATION.md` — the full migration plan + phase history + n8n workflow map.
3. Skim the committed test harnesses and RUN them (Node, no deps):
   - `node test/calendar-v2-status-repro.js` → expect `OVERALL: PASS` (status‑revert bug + 11 sequences).
   - `node test/calendar-v2-banner-persist.js` → expect `PASS` (Linear‑meta banner persistence + logic).

## Ground rules
- **Read‑only by default.** This is an audit. If you find a real bug, fix it on a feature branch
  and open a PR — never push to `main`. v2 is gated behind `?v2=1`; v1 (default) must stay
  behaviorally unchanged for normal users.
- **Snapshot before any n8n edit** into `n8n-backups/<name>.<date>.<reason>.json` (redact secrets,
  e.g. the Linear API key → `[REDACTED-LINEAR-KEY]`). n8n's own version history is the real rollback.
- **Do not put secrets in the repo** (commits, PRs, docs). The browser publishable key is the only
  key that belongs in the repo; service_role + Linear keys live only in n8n.
- **Verify with real data:** read Supabase REST with the committed publishable key; exercise the
  n8n webhooks against the test client `sidneylaruel`; cross‑check the Google Sheet.

## Access & key facts (verify these are still true)
- **Site:** `https://syncview.synchrosocial.com/?v2=1#calendar` (GitHub Pages caches `index.html`
  ~10 min — hard‑refresh after a deploy). Console helper: `calV2Status()`.
- **Supabase:** project ref `uzltbbrjidmjwwfakwve` (`https://uzltbbrjidmjwwfakwve.supabase.co`).
  Table `public.calendar_posts`, PK `(client, id)`, all columns `text`. Publishable key is in
  `index.html` (`CAL_SUPABASE_ANON_KEY`). REST read example:
  `/rest/v1/calendar_posts?select=*&client=eq.sidneylaruel` with `apikey`/`Authorization: Bearer` headers.
- **n8n:** `synchrosocial.app.n8n.cloud`. Supabase credential `Supabase - SyncView Calendar`
  (`XdBpJ6Xk8PMpZXXT`). Webhooks (unauthenticated, CORS `*`): `calendar-get`, `calendar-upsert-post`,
  `calendar-append-post`, `calendar-delete-post`, `calendar-reorder`, `calendar-reorder-batch`,
  `linear-status-sync`, `linear-issue-statuses`, `generate-caption`, `kasper-queue`.
- **Google Sheet:** doc `1Gsn5xLImJyMhBMCNjK_tigpoUfcSFnvxTQLkk-A9Yps`, one tab `Calendar_<slug>` per client.
- **Test client:** `sidneylaruel` (a few TEST cards, some linked to Linear VID-/GRA- sub‑issues).
- **Code:** everything is in `index.html` (one inline `<script>`). Search anchors: `CALENDAR v2`,
  `_calV2`, `_calFlushCardSave`, `_calMigratePostShape`, `loadCalendarPosts`, `_calRefreshParentLinkFlags`.

---

## 1. n8n workflows — audit every one that touches the calendar
For each: snapshot first (if you'll edit), confirm `active`, read the code nodes, and verify behavior
against a real call where feasible. Confirm the **Supabase mirror** is present AND published (active
version), not just in a draft.

| Workflow | id | What to verify |
|---|---|---|
| Upsert Post | `pWSqaqVw7dmqhYOA` | `Build Row From Patch` ALLOWED whitelist; phantom‑row / link‑clobber / duplicate‑link / 3‑way comment‑merge guards; **scalar conflict guard** (compares `comments_base_at` vs the SHEET's `updated_at`); Sheets `appendOrUpdate` (autoMapInputData, match `id`); **Supabase mirror fan‑out** (`onError: continueRegularOutput`). Response echoes ONLY the patched columns (`{id, updated_at, …}`). |
| Append Post | `iA54ipMOybicmYBh` | dual‑write mirror present. Dormant (FE doesn't call it) — confirm. |
| Delete Post | `JcekBKUzELgX4HjH` | soft delete (`status=Archived`) + mirror. |
| Reorder (fallback) | `OXd0sUoSJYMspGTF` | **NO Supabase mirror** (known gap); also a divergent unpublished batched draft — editing+publishing would flip live reorder to the draft. Decide: rebuild the mirror on the LIVE per‑row version without publishing the draft. |
| Reorder batch | `lTtZNLrQLpIZqwAY` | one `values:batchUpdate` + mirror. |
| Linear Status Sync | `MJbMZ789B5ExZz9x` | Linear webhook → patches ONLY the matched sub‑status via the upsert webhook (so it dual‑writes for free); never writes caption/overall; skips Posted/archived. ⚠️ **live Linear API key hardcoded in plaintext** in the code node. |
| Linear Issue Statuses | `GP8CSZDNcy5sGdFr` | Returns `{ok, statuses, meta}` (meta = `{state,isSubIssue,hasDue,hasEditor}`). The FE banner uses `meta` for done cards. ⚠️ **same plaintext Linear key.** Snapshots: `linear-issue-statuses.2026-06-14.{pre,post}-meta.json`. |
| Generate Caption | `rNrRCwKPGuau7sLH` | calls calendar‑get/upsert (inherits dual‑write); caption_jobs data table. |
| Kasper queue | `TcWOfnKd4Csdnnbv` | batchGet read of many tabs (Supabase read in a later phase). |
| Get | `KViFEOqSRBNdCJRk` | reads one tab; v2's fallback when Supabase read fails. |

**Checks:** (a) Is every FE‑reachable WRITE mirrored to Supabase? (`calendar-reorder` is the known
exception.) (b) Do mirror writes use the SAME `updated_at` the Sheet write uses (so LWW/realtime are
consistent)? (c) Are there workflows that write the Sheet directly and are NOT mirrored?

## 2. Front‑end v2 path (`index.html`) — audit holistically
- **Gating:** `_calV2Enabled()` (flag, sticky in localStorage) and `_calV2Ready()` (flag + anon key).
  Confirm v1 (flag off) makes **zero** Supabase/extra calls and is behaviorally identical.
- **Read swap + merge:** `loadCalendarPosts` → `_calV2FetchPosts` (Supabase REST, falls back to
  `calendar-get`). Normalize/dedupe/**LWW merge** with the **recent‑save guard** (`_calLocalRecentSaves`,
  `CAL_CONFLICT_WINDOW_MS=90s`) — prefers local within the window. Confirm this can't strand a stale
  optimistic value beyond a refresh.
- **Write path:** `_calFlushCardSave` field‑level patch builder (only changed cols + recomputed
  `status` + changed `*_tweaks`); **echo‑merge** must migrate the MERGED full row, NOT the partial
  echo (the status‑revert fix — confirm `_calMigratePostShape(merged)`, not `(saved)`); v2 sends
  `comments_base_at:''` (skips the scalar conflict guard). Re‑confirm the status harness still passes.
- **Realtime:** `_calV2EnsureSubscribed` (one channel/client; **catch‑up reload on re‑SUBSCRIBE**;
  teardown on client switch / leave). `_calV2OnRealtimeChange` debounces a background reload and
  **defers (not drops)** an event that lands mid‑load. `_calRefreshOnReturn` uses a 4 s throttle under
  v2 (vs 90 s v1). Verify: NO timers/polling; idle tabs make no n8n calls.
- **`_calMigratePostShape` callers:** confirm only full rows reach it (echo‑merge fixed; cache,
  network, Kasper hydrate/load all full). It must never invent absent sub‑statuses on a partial row.
- **#471 reconcile skip:** `_calReconcileLinearStatuses` early‑returns under v2 (Linear→calendar now
  flows via the backend sync → Supabase mirror → realtime). Confirm.
- **Banner:** `_calLinearMissingForCard` flags due date/editor only (project intentionally dropped);
  `_calRefreshParentLinkFlags` persists `_calLinearMetaByIdent` (localStorage, 7‑day TTL) and fetches
  meta for done‑card idents from `linear-issue-statuses` (throttled, session‑disabled if no `meta`).
  Confirm it never adds idle/polling load.

## 3. Google Sheet ↔ Supabase parity
- Pick a few clients (incl. `sidneylaruel`) and a high‑traffic one. Compare row counts and a sample
  of rows (statuses, comments, links, `updated_at`) between the Sheet (via `calendar-get`) and
  Supabase (REST). The `Backfill (ALL clients)` workflow (`yQBGgdbZPqOgn2eE`) doubles as a re‑sync +
  parity report — consider a dry read.
- Confirm NO drift class remains: e.g. rows present in one store but not the other; `updated_at`
  skew that would flip LWW; un‑mirrored writes (the reorder fallback).
- Confirm `0` rows have an overall `status` set with all three sub‑statuses empty (the legacy
  in‑memory‑seeding divergence) — the FE recomputes overall on load, so stored overall is advisory.

## 4. Supabase config & data integrity
- **RLS:** `anon` has SELECT (`using (true)`) and NOTHING else (no insert/update/delete). Only
  `service_role` (n8n) writes. Verify by attempting an anon write (should fail).
- **Realtime:** `calendar_posts` is in the `supabase_realtime` publication and has
  `replica identity full`. Verify an end‑to‑end event (subscribe, POST a patch, see it < ~1 s).
- **Data:** spot‑check types/coercion (all text), `(client,id)` uniqueness, no orphan/dup rows.

## 5. Security posture (informs Phase 4, but flag now)
- Calendar webhooks are **unauthenticated, CORS `*`** — anyone with a URL can read/write any client.
- **Live Linear API key is hardcoded in plaintext** in ≥2 code nodes (`linear-status-sync`,
  `linear-issue-statuses`). Recommend rotating into an n8n credential.
- The **service_role key** was pasted in chat in a prior session — recommend rotating it (update
  credential `XdBpJ6Xk8PMpZXXT`). The publishable key is browser‑safe.

---

## Required output
Produce a concise **Phase 3 go / no‑go** with:
1. A **risk register** — each finding: severity (blocker / should‑fix / nice‑to‑have), evidence
   (what you actually checked), and a concrete fix.
2. **Parity verdict** (Sheet ↔ Supabase) with the numbers you observed.
3. **Confirmation** the FE v2 path has no remaining status/echo/realtime/banner correctness bug
   (cite the harness runs + any live repro you did).
4. A clear recommendation: is it safe to flip v2 to default behind a kill‑switch flag (Phase 3),
   and if not, exactly what must be fixed first.

Phase 3 = make v2 the default with v1 behind a flag for ~2 weeks (writes keep mirroring to the
Sheet, so rollback = flip the flag). Phase 4 = remove the legacy polling/LWW/conflict/ledger
machinery, add real per‑client auth (RLS), close the open webhooks.
