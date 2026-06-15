# Content Calendar → Supabase — Complete-the-Migration Plan & Audit (paste into a fresh session)

> ⚠️ **SUPERSEDED / HISTORICAL (as of the 2026-06-15 audit).** This was a planning/handoff prompt;
> the work below is DONE (v2 is default-on; all 7 writers mirror to Supabase). **Current source of
> truth: `AUDIT_2026-06-15.md`.** In particular, **ignore any claim below that `calendar-reorder`
> lacks a Supabase mirror or carries a divergent unpublished draft** — its mirror has been LIVE
> since 2026-06-14. The write path is being inverted to Supabase-primary (Sheet kept as a backup
> mirror).

> **How to use:** open a fresh Claude Code session on this repo (`sidney-afk/client-analytics`)
> with the same MCP access (n8n, Supabase via the committed publishable key, Linear, GitHub) and
> paste everything below the line as the task. The goal of this session is to get **every surface
> that shows calendar data onto Supabase (live reads + realtime)**, prove the whole system works,
> and only THEN flip v2 to the default for everyone — followed by cleanup. Develop on a feature
> branch and open PRs; **never push to `main`**. Be rigorous and **empirical: verify against real
> data and the live backend; reproduce; don't guess.**

---

You are completing the **Content Calendar realtime migration (Google Sheets → Supabase)**. Phase 1
(dual-write) and Phase 2 (a hidden v2 read path behind `?v2=1` for the main calendar) are done and
in testing. The remaining job before making v2 the default is: **every place in the app that reads
calendar data must read it from Supabase (with realtime), not the Google Sheet** — otherwise some
surfaces would be live and others stale after the flip.

## 0. Read first (in full)
1. `CALENDAR_V2_AUDIT_HANDOFF.md` — current state, fixes, verified facts, known risks.
2. `CALENDAR_REALTIME_MIGRATION.md` — full plan, phase history, n8n workflow map.
3. Run the committed harnesses (Node, no deps): `node test/calendar-v2-status-repro.js` and
   `node test/calendar-v2-banner-persist.js` — both must pass.

## Ground rules
- **Branch, don't push to main.** v2 is gated behind `?v2=1`; v1 (default) must stay behaviorally
  unchanged for normal users until the deliberate Phase 3 flip.
- **Snapshot before any n8n edit** into `n8n-backups/<name>.<date>.<reason>.json` (redact the Linear
  API key → `[REDACTED-LINEAR-KEY]`). n8n's own version history is the real rollback.
- **No secrets in the repo.** Only the browser publishable key belongs here.
- **Verify with real data:** read Supabase REST with the committed publishable key; exercise the n8n
  webhooks against test client `sidneylaruel`; cross-check the Google Sheet. After any change,
  re-run the harnesses and do a live repro.
- **No polling / no idle n8n load.** Reads under v2 come from Supabase; realtime is push (WebSocket).
  Any Linear/n8n touch must be event-driven (focus / explicit refresh), cache-first, and throttled —
  never a timer, never on every realtime tick. An idle open tab must make zero calls.

## Key facts (verify still true)
- **Site:** `https://syncview.synchrosocial.com/?v2=1#calendar` (GitHub Pages caches `index.html`
  ~10 min — hard-refresh after deploy). Console: `calV2Status()` → `{flag,ready,subscribed,slug}`.
- **Supabase:** ref `uzltbbrjidmjwwfakwve`. Table `public.calendar_posts`, PK `(client,id)`, all text.
  Publishable key in `index.html` (`CAL_SUPABASE_ANON_KEY`). REST read:
  `/rest/v1/calendar_posts?select=*&client=eq.<slug>` (+ `apikey` / `Authorization: Bearer`). RLS:
  anon SELECT only; `service_role` (n8n) writes. Realtime: table in `supabase_realtime` publication,
  `replica identity full`.
- **n8n:** `synchrosocial.app.n8n.cloud`. Supabase credential `XdBpJ6Xk8PMpZXXT`. Code lives in one
  inline `<script>` in `index.html` (search `CALENDAR v2`, `_calV2`, `loadCalendarPosts`).

---

## 1. SURFACE INVENTORY — every reader of CALENDAR data (CONFIRM this; don't trust it)
Re-verify by grepping `CALENDAR_GET_URL`, `KASPER_QUEUE_URL`, `rest/v1/calendar_posts`, and callers of
`loadCalendarPosts`. Find anything this table missed.

| # | Surface | Function (index.html) | Reads today | On Supabase? |
|---|---|---|---|---|
| 1 | Main SMM calendar | `loadCalendarPosts` → `_calV2FetchPosts` | Supabase REST + realtime (v2) | ✅ (flag/default) |
| 2 | Client review (share link `?c=`) | same `loadCalendarPosts` | follows the v2 flag | ✅ (flag/default) |
| 3 | SMM review view (`view=review/smmreview`) | renders `calState.posts` | inherits #1 | ✅ |
| 4 | **Kasper queue/review** | `_kasperFetchAllRelevantPosts` | `kasper-queue` batchGet (all clients) + `calendar-get` — **the Sheet** | ❌ **MIGRATE** |
| 5 | **Filming runway** | `_filmsFetchRunway(slug)` | `calendar-get` — **the Sheet** | ❌ **MIGRATE** |
| 6 | Parity/verify helper | `_calFetchPostsForVerify` | `calendar-get` | ⚠️ diagnostic — migrate or retire |

**NOT calendar data (different sources — out of scope for THIS migration; do not move to Supabase):**
- **Workload view** (`loadLinearIssues` → `linear-issues`): the editor's **Linear** issues by due date.
  Linear is its source of truth; it's not in `calendar_posts`. (If "live workload" is wanted later,
  that's a separate Linear-realtime question, not this migration.)
- Filming **plans** (`FILMING_PLANS_URL` gviz / `filming-plan-tabs`), `editors-week`, caption jobs
  (`caption_jobs` n8n table), briefs / hooks / templates / samples / tiktok / forms — separate data.

So the concrete remaining migration work is **#4, #5, (#6)** — get the Kasper queue and the filming
runway reading calendar data from Supabase (with realtime where the surface is long-lived), behind
the same v2 gate, with v1 untouched.

## 2. Migrate the remaining calendar-data readers (Part B)
- **Kasper queue (`_kasperFetchAllRelevantPosts`)** — today it batchGets every `Calendar_<slug>` tab
  via `kasper-queue`. In Supabase all clients live in ONE table, so this becomes a single REST query
  (e.g. `select=*` filtered to the statuses Kasper cares about, or all rows then filter client-side
  like today). Add a realtime subscription (no client filter, or per the set of clients shown) so the
  queue updates live. Reuse the `_calV2FetchPosts` / `_calV2EnsureSubscribed` patterns; keep the
  `kasper-queue` webhook as the fallback on any Supabase error (so it can never blank). Gate on
  `_calV2Ready()` exactly like the calendar, so v1 is byte-identical.
- **Filming runway (`_filmsFetchRunway`)** — swap its per-client `calendar-get` read to the Supabase
  REST read (same shape) behind `_calV2Ready()`, n8n fallback retained. Realtime optional (it's a
  computed summary; a refresh-on-open is probably enough).
- **`_calFetchPostsForVerify`** — diagnostic; either point it at Supabase or leave it as the
  Sheet-side half of a parity check. Decide and note.
- Confirm: with `?v2=0` (or no flag) every one of these is byte-identical to today.

## 3. Full-system audit (Part C)
- **n8n workflows** — for each, confirm `active`, read the code, and verify the Supabase mirror is in
  the ACTIVE version (not a draft). Writers: `calendar-upsert-post` (`pWSqaqVw7dmqhYOA`),
  `calendar-append-post` (`iA54ipMOybicmYBh`), `calendar-delete-post` (`JcekBKUzELgX4HjH`),
  `calendar-reorder-batch` (`lTtZNLrQLpIZqwAY`), **`calendar-reorder` (`OXd0sUoSJYMspGTF`) — still
  has NO Supabase mirror + a divergent unpublished batched draft (rebuild the mirror on the LIVE
  per-row version; don't publish the draft).** Reads/sync: `linear-status-sync` (`MJbMZ789B5ExZz9x`),
  `linear-issue-statuses` (`GP8CSZDNcy5sGdFr`, returns `{statuses, meta}` incl. `hasProject`),
  `generate-caption` (`rNrRCwKPGuau7sLH`), `kasper-queue` (`TcWOfnKd4Csdnnbv`), `calendar-get`
  (`KViFEOqSRBNdCJRk`). Confirm mirror writes use the same `updated_at` the Sheet write uses.
- **FE v2 path** — gating (`_calV2Enabled`/`_calV2Ready`; v1 makes zero Supabase/extra calls);
  read swap + LWW merge + recent-save guard (`CAL_CONFLICT_WINDOW_MS`); write path
  (`_calFlushCardSave` field patches; echo-merge migrates the MERGED full row, not the partial echo —
  the status-revert fix; `comments_base_at:''` for v2); realtime (catch-up reload on re-subscribe;
  deferred-not-dropped mid-load event; 4 s return throttle); `_calMigratePostShape` never sees a
  partial row; `_calReconcileLinearStatuses` skipped under v2 (#471); the Linear-meta banner
  (`_calRefreshParentLinkFlags` sources project/due/editor from `linear-issue-statuses` for all
  linked cards; persisted; throttled).
- **Sheet ↔ Supabase parity** — compare row counts + a sample (statuses, comments, links,
  `updated_at`) for several clients incl. `sidneylaruel`. The `Backfill (ALL clients)` workflow
  (`yQBGgdbZPqOgn2eE`) doubles as a re-sync + parity report. Confirm no un-mirrored writes (reorder
  fallback) and no `updated_at` skew that would flip LWW.
- **Supabase config** — anon SELECT only (try an anon write → must fail); realtime publication +
  `replica identity full`; end-to-end event < ~1 s.
- **Security (flag now, fix in Phase 4)** — calendar webhooks are unauthenticated + CORS `*`; the
  live Linear API key is hardcoded in plaintext in `linear-status-sync` and `linear-issue-statuses`
  (rotate into a credential); rotate the service_role key.

## 4. Flip v2 to the default — Phase 3 (Part D)
Only once 1–3 are green: make v2 the default with v1 behind a kill-switch flag (e.g. `?v2=0`), for
~2 weeks. Writes keep mirroring to the Sheet, so rollback = flip the flag. This is a tiny, reversible
change — NOT a data migration (all clients/rows already dual-write). Watch for any divergence.

## 5. Cleanup — Phase 4 (Part E)
After v2 has been the default and proven: remove the legacy polling/LWW/conflict/ledger machinery
from `index.html`; add real per-client auth (Supabase RLS + keys) and tighten the anon policy from
`using (true)` to per-client; close the open unauthenticated webhooks; rotate the plaintext Linear
key + service_role key into credentials; decide whether to keep the Google Sheet as a
human-readable mirror/export (cheap safety net) or retire it.

## Required output
1. A confirmed/corrected **surface inventory** (what reads calendar data, from where, now).
2. **What you migrated** (Kasper queue, filming runway, …) with the live verification you did.
3. A **risk register** (blocker / should-fix / nice-to-have, with evidence + fix) and a
   **Sheet↔Supabase parity verdict** (numbers).
4. A clear **go / no-go** on flipping v2 to default, and the exact remaining work if no-go.
