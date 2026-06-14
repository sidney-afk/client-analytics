# Content Calendar — Realtime Migration Plan (Sheets → Supabase)

Status: **approved direction, not started** (audit done 2026-06-12).
Goal: make the content calendar behave like Google Sheets — always live for
every user, no refresh jumps, no desyncs — without ever breaking the live site.

## Architecture today (audit summary)

- **Storage:** one Google Sheet ("SyncView Calendar Sheet",
  doc `1Gsn5xLImJyMhBMCNjK_tigpoUfcSFnvxTQLkk-A9Yps`), one tab per client
  named `Calendar_<slug>`. Schema documented at the top of the
  CONTENT CALENDAR MODULE in `index.html` (~line 10891).
- **API:** unauthenticated n8n webhooks on `synchrosocial.app.n8n.cloud`:
  `calendar-get`, `calendar-upsert-post`, `calendar-delete-post`,
  `calendar-reorder`, `calendar-reorder-batch`, `kasper-queue`, plus the
  Linear status-sync workflows and `generate-caption`.
- **Sync model:** pull-only. The FE fetches on mount and on tab focus,
  throttled to 90 s (`CAL_RETURN_REFRESH_MIN_MS`) because `calendar-get`
  was ~46% of all n8n executions. Saves are optimistic, debounced 650 ms,
  and send the **whole card** to the upsert webhook.

## Key audit findings

1. **Concurrent edits clobber each other.** Documented incident 2026-06-11
   (see `n8n-backups/calendar-upsert-post.2026-06-11.pre-guards.json` note):
   two SMMs on one calendar → full-card saves overwrote each other, cards
   "vanished and swapped titles/dates". Guards added since (link-clobber,
   phantom-row, 3-way comment merge) patch symptoms only.
2. **Conflict resolution depends on browser clocks** — LWW on
   client-generated `updated_at`, 90 s conflict windows, in-flight locks,
   pending-edit overlays, localStorage archive ledger, dedupe-by-Linear-issue.
   Thousands of FE lines exist only to compensate for no realtime backend.
3. **No push channel** — teammates' changes are invisible until a throttled
   refetch; that refetch + Linear reconcile is the visible "refresh jump".
4. **Sheets limits:** no transactions, no change feed, ~5-concurrent-read
   quota (`KASPER_CAL_CONCURRENCY = 5`), 1–2 s read-modify-write.
5. **Security:** calendar webhooks are unauthenticated with CORS `*`
   (anyone with the URL can read/write every client's calendar). API keys
   were pasted into n8n code nodes (redacted in backups, live in n8n).
6. n8n workflows have no version control — `n8n-backups/` snapshots are the
   convention; **always snapshot a workflow there before editing it.**

## Decision

Migrate calendar storage to **Supabase** (Postgres + built-in realtime
subscriptions, free tier). FE stays on GitHub Pages and subscribes over
WebSocket; n8n keeps doing Linear sync / caption automation but writes to
Postgres; the Google Sheet becomes a mirror (kept during transition, optional
afterwards). Field-level atomic patches replace whole-card upserts, which
deletes the clobbering bug class and most of the FE guard machinery.

## Migration plan — no copy repo, no big-bang

One repo, one website. Every phase is invisible until proven and has
one-click rollback. The risky part is the data, not the code.

- **Phase 1 — Dual-write (zero user-facing change).**
  Create Supabase project + `calendar_posts` table (one table; `client`
  column replaces tabs; columns = the sheet schema; PK `(client, id)`;
  `updated_at` server-set). Backfill all `Calendar_*` tabs. Modify the n8n
  write workflows (upsert, delete, reorder, Linear status sync, caption
  save) to write to BOTH Sheets and Supabase. Site still reads Sheets.
  Verify parity for a few days (a small n8n compare workflow or script).
- **Phase 2 — Hidden v2 view, same repo.**
  Flag (e.g. `?v2=1` on `#calendar`) switches the calendar module to read
  from Supabase with a realtime subscription, and to save field-level
  patches. Dual-writes keep v1 and v2 showing identical data. Sidney + one
  SMM test on real calendars for ~a week.
- **Phase 3 — Flip the default.** v2 default, v1 behind a flag for ~2 weeks.
  Writes keep mirroring to the Sheet → rollback = flip the flag; anything
  else reading the Sheet keeps working.
- **Phase 4 — Cleanup.** Remove the polling/LWW/conflict/ledger machinery
  from `index.html`; decide whether to keep the Sheet mirror as a
  human-readable export (cheap, nice safety net). Add real auth (Supabase
  RLS + keys) and close the open-webhook hole.

## Quick wins (valid even before/without migration)

- FE sends only changed fields to `calendar-upsert-post` (the workflow's
  "Build Row From Patch" already supports partial patches; the FE currently
  sends the whole card — see `wirePost` in `_calFlushCardSave`,
  `index.html` ~line 16430). Kills most clobbering on its own.
- Add a compare-and-swap version check in the upsert workflow so stale
  saves are rejected instead of silently overwriting.

## n8n workflow audit — Phase 1 prep (done 2026-06-12)

n8n MCP access confirmed (47 workflows on synchrosocial.app.n8n.cloud).
Every workflow below was snapshotted to `n8n-backups/*.2026-06-12.pre-supabase.json`
before anything gets edited. No live workflow behavior was changed.

### Dual-write list (workflows that WRITE to `Calendar_<slug>` tabs)

Only **five** webhooks touch the sheet directly — these are the Phase 1
dual-write targets:

| Workflow (id) | Webhook | Sheet write |
|---|---|---|
| Calendar — Upsert Post (`pWSqaqVw7dmqhYOA`) | `calendar-upsert-post` | appendOrUpdate matched on `id` (all guards live here) |
| Calendar — Append Post (`iA54ipMOybicmYBh`) | `calendar-append-post` | append (dup-link guard) — **was missing from the plan above** |
| Calendar — Delete Post (`JcekBKUzELgX4HjH`) | `calendar-delete-post` | update: `status=Archived` + `updated_at` (soft delete) |
| Calendar — Reorder (`OXd0sUoSJYMspGTF`) | `calendar-reorder` | per-row update of `order_index`/`updated_at` (see caution below) |
| Calendar — Reorder batch (`lTtZNLrQLpIZqwAY`) | `calendar-reorder-batch` | one `values:batchUpdate` of `order_index`/`updated_at` |

Plus one inactive utility: Calendar — Provision Missing Tabs
(`gB17L9M5yYxxk6GT`, manual trigger, inactive) creates `Calendar_<slug>`
tabs; with one `calendar_posts` table it becomes unnecessary post-migration.

### Finding that simplifies Phase 1: indirect writers funnel through upsert

**Linear Status Sync** (`MJbMZ789B5ExZz9x`) and **Generate Caption**
(`rNrRCwKPGuau7sLH`) do NOT touch the sheet directly — both call the
`calendar-get` / `calendar-upsert-post` webhooks over HTTP from code nodes.
The plan above listed them as separate dual-write targets; they aren't.
Once `calendar-upsert-post` dual-writes, both inherit it for free, and the
upsert webhook stays the single choke point for all card-content writes.

### Caution: calendar-reorder has an unpublished draft

Workflow `OXd0sUoSJYMspGTF` has diverged draft vs published versions: the
draft is a batched `values:batchUpdate` rewrite (saved 2026-06-10, never
published); the LIVE version is still the original per-row update loop
(= `n8n-backups/calendar-reorder.2026-06-10.pre-batch.json`). Editing and
publishing this workflow in Phase 1 will ALSO flip live behavior to the
batched draft — do that intentionally, or rebuild the Phase 1 change on
top of the active version.

### Read-only calendar workflows (no dual-write needed; become Supabase reads in Phase 2)

- Calendar — Get (`KViFEOqSRBNdCJRk`): reads one tab, returns `{ok, posts[]}`.
- Kasper — Queue batch (`TcWOfnKd4Csdnnbv`): reads many tabs via batchGet.
- Linear Issue Statuses (`GP8CSZDNcy5sGdFr`), Linear Sub-Issues, Linear Set
  Status, Linear Add Comment, Tweak Comments: Linear-API-only, never touch
  the sheet.
- Caption Jobs Status/Update use the n8n `caption_jobs` data table, not the
  sheet — unaffected by the migration.
- Weekly Backup (`jlVfbg0Njxf1It7h`) copies the calendar sheet to Drive
  weekly — keeping the sheet as a mirror keeps this working untouched.

### Security note (confirms finding 5)

The same live Linear API key is hardcoded in plain text in at least two
code nodes (`linear-status-sync`, `linear-issue-statuses`). Redacted as
`[REDACTED-LINEAR-KEY]` in the repo snapshots. Recommend rotating it into
an n8n credential during the migration; Supabase keys must go into n8n
credentials from day one, never into code nodes or this repo.

### Schema notes for `calendar_posts` (from the live write paths)

- `id` is generated server-side as `p_<ts36>_<rand>` when absent → text PK
  `(client, id)` works as planned.
- `updated_at` is already server-set (n8n `new Date().toISOString()`) in
  upsert/append/delete/reorder → Postgres `now()` is a drop-in upgrade.
- Column whitelist (ALLOWED in upsert/append) is the authoritative column
  list; upsert additionally allows `kasper_seen`,
  `kasper_approved_after_tweaks`, and mirrors `video_tweaks` → legacy
  `tweaks`.
- Delete is a soft delete (`status=Archived`) → keep that semantic; no row
  deletion in Phase 1.
- The stale-save conflict guard compares ISO strings (`comments_base_at` vs
  stored `updated_at`) → becomes a real compare-and-swap in Postgres.

## Open items / first steps for the next session

1. ~~Verify n8n MCP access~~ done 2026-06-12 — access works, audit above.
2. ~~Map the dual-write list~~ done — 5 direct writers (see table).
3. ~~Snapshot each workflow into `n8n-backups/`~~ done
   (`*.2026-06-12.pre-supabase.json`). Generate Caption already has a
   same-day snapshot (`generate-caption.2026-06-12.pre-jobs.json`); take a
   fresh one immediately before its Phase 1 edit if it changes again.
4. Sidney to create the Supabase project. Needed for Phase 1 (n8n side):
   - project URL (`https://<ref>.supabase.co`);
   - **service_role key** — paste it ONLY into an n8n credential (e.g.
     Header Auth) for the dual-write nodes; never into a code node, never
     into this public repo;
   - the **anon (publishable) key** is only needed in Phase 2 for the FE,
     and may only ship in the repo once RLS policies are enabled.
5. Then: create `calendar_posts` (PK `(client, id)`, server-set
   `updated_at`), backfill all `Calendar_*` tabs, add dual-writes to the 5
   workflows, and stand up the parity check.

## Phase 1 progress — 2026-06-13

Supabase project created (`uzltbbrjidmjwwfakwve.supabase.co`). n8n
credential `Supabase - SyncView Calendar` (id `XdBpJ6Xk8PMpZXXT`, type
`supabaseApi`) holds the service_role key — NOT in this repo.

- ✅ **Table created.** `public.calendar_posts`, PK `(client, id)`, all
  columns `text` (mirrors the sheet exactly; types can be refined in a
  later phase). RLS enabled with no policies → only the service_role key
  (n8n) can read/write; the public/anon role is denied, so the anon key is
  not yet needed and is safe to leave unused.
- ✅ **Backfill done + verified.** All allowlisted clients copied via the
  `kasper-queue` webhook. Parity check: **616 sheet posts = 616 Supabase
  rows, 15 clients with data, 0 mismatches, 0 errors.** Read-only on
  Sheets; no live workflow or website change.
- n8n one-off workflows (manual trigger, inactive — safe to leave or
  delete):
  - `aw2b98wxraQTEulJ` — Supabase Backfill (TEST one client)
  - `yQBGgdbZPqOgn2eE` — Supabase Backfill (ALL clients), re-runnable
    (clears table then re-inserts; idempotent)
  - (`qKknR6IIuqUqdGLB` archived — first draft used an HTTP node that
    couldn't bind the Supabase credential; native Supabase node used
    instead.)

### Implementation note for the dual-write step (next)

The n8n **HTTP Request node cannot bind a `supabaseApi` credential**
through the MCP tooling (its credential schema only accepts the generic
auth types). Use the **native Supabase node** (`n8n-nodes-base.supabase`,
`resource: row`) for all Supabase writes — it binds the credential
cleanly. PostgREST array-upsert via HTTP is therefore not available
through this path; the dual-writes should upsert per-row with the native
node (or, if batch upsert is needed, create a dedicated Header/Custom-auth
credential).

### Remaining Phase 1 work (not started — the delicate part)

Add the Supabase write, in parallel with the existing Sheets write, to the
5 direct writers (`calendar-upsert-post`, `calendar-append-post`,
`calendar-delete-post`, `calendar-reorder`, `calendar-reorder-batch`).
Additive only — the Sheets write (what the site reads) stays unchanged, so
a Supabase-side failure can't break the live calendar. Snapshot each
workflow into `n8n-backups/` immediately before editing it (fresh
snapshots already taken 2026-06-12). Remember the `calendar-reorder`
draft-vs-published divergence flagged above.

### Dual-write status — 2026-06-13

Pattern used (uniform): after the existing Sheets write, a fan-out
side-branch mirrors the row into Supabase via the **native Supabase node**
(credential `Supabase - SyncView Calendar`), set to
`onError: continueRegularOutput` so a Supabase failure can never fail the
save or alter the webhook response. The response path is byte-unchanged.
Tested on `sidneylaruel` (create + update + archive + reorder all verified
writing to Supabase).

| Workflow | Mirror nodes added | Status |
|---|---|---|
| `calendar-upsert-post` (`pWSqaqVw7dmqhYOA`) | Prep Mirror → Row Existed? → Mirror Update / Mirror Create (create-or-update) | **LIVE (published 2026-06-13)** — confirmed: caption edit on the site appeared in Supabase |
| `calendar-delete-post` (`JcekBKUzELgX4HjH`) | Prep Mirror Del → Mirror Archive (update) | **LIVE (published 2026-06-13)** — verified via n8n MCP: mirror nodes in the active version, `active:true` |
| `calendar-reorder-batch` (`lTtZNLrQLpIZqwAY`) | Prep Mirror Reorder → Mirror Reorder (update per row) | **LIVE (published 2026-06-13)** — verified via n8n MCP |
| `calendar-append-post` (`iA54ipMOybicmYBh`) | Prep Mirror Append → Mirror Create Append (create) | **LIVE (published 2026-06-13)** — verified via n8n MCP (dormant: FE does not call this webhook) |
| `calendar-reorder` (`OXd0sUoSJYMspGTF`) | — | **NOT TOUCHED** — divergent unpublished batched draft; editing+publishing would also flip live reorder to the batched version. It's only the FE fallback when `reorder-batch` fails. Decide separately: (a) publish batched + add dual-write, or (b) rebuild dual-write on the active per-row version. Until then, a fallback reorder won't mirror (self-heals on next backfill or next `reorder-batch`). |

Note: `publish_workflow` via MCP is approval-gated and could not be
completed programmatically; workflows are published manually in the n8n UI.
All three were subsequently published — verified 2026-06-13 via
`get_workflow_details` (active version carries the mirror nodes).

Mirror semantics: upsert = create-or-update (keyed on the Sheets
`Read Existing Row` result); delete = update `status=Archived`; reorder =
update `order_index` of existing rows only (no insert, matching the Sheets
phantom-row guard). All filters use `allFilters` on `(client, id)`.

Test residue: an archived card `p_test_dw_001` ("DUALWRITE TEST") exists on
`sidneylaruel` in both Sheets (invisible) and Supabase — safe to ignore or
delete.

### Phase 1 remaining
- ~~Publish `delete-post`, `reorder-batch`, `append-post`~~ **DONE** (verified
  2026-06-13: all three published & live-mirroring to Supabase).
- Decide on `calendar-reorder` fallback (above) — still the only FE-reachable
  write path without a Supabase mirror; only fires when `reorder-batch` fails.
- Optional: a periodic parity check (sheet vs Supabase) now that writes are
  mirrored; the `Backfill (ALL clients)` workflow (`yQBGgdbZPqOgn2eE`)
  doubles as a re-sync + parity report.

## Phase 2 progress — 2026-06-13 (FE built, dormant; awaiting Supabase activation)

The calendar front-end (`index.html`) now contains the full v2 path, hidden
behind the `?v2=1` flag (sticky in `localStorage`; `?v2=0` clears it). With the
flag OFF the site is byte-identical to v1 — no Supabase calls, no extra network
requests (supabase-js is lazy-loaded only when v2 actually activates). The inline
script syntax-checks clean. Search `CALENDAR v2` in `index.html`.

Two independent gates:

- **`_calV2Enabled()`** — the flag alone. Turns on **field-level patch writes**:
  `_calFlushCardSave` sends only the columns an edit touched (`{ id, ...changed }`)
  instead of the whole card. The upsert workflow's "Build Row From Patch" +
  Google-Sheets `autoMapInputData` already write only the keys present in the
  payload (matched on `id`, every other column untouched), so this needs NO
  backend change and deletes the whole-card clobber bug class. Brand-new rows and
  forced retries (`_calRetrySave`) still send the full card. **Testable now** with
  `?v2=1` against the live upsert webhook.
- **`_calV2Ready()`** — flag AND the anon key set. Switches **reads** to Supabase
  REST (`/rest/v1/calendar_posts?select=*&client=eq.<slug>`, same `{ok,posts[]}`
  shape → reuses the entire normalize/dedupe/LWW-merge/render/cache pipeline) and
  opens a **realtime** Postgres-changes subscription filtered `client=eq.<slug>`.
  A change coalesces into one debounced background reload from Supabase (cheap, no
  n8n quota) routed through the existing merge, so a teammate's edit appears with
  no 90 s wait and no refresh jump. On any Supabase read error it falls back to
  the n8n `calendar-get` webhook, so v2 can never blank the calendar.

Writes still flow through the n8n upsert webhook (Phase 1 dual-writes them to
Supabase) — Linear sync / caption automation untouched; the realtime echo is what
surfaces a write to every other viewer.

### To ACTIVATE the realtime read (Sidney — Supabase dashboard)

1. **Run this once in the Supabase SQL editor** (paste-and-run; idempotent).
   It lets the browser (anon) READ — writes stay denied, only n8n's
   service_role writes — and streams row changes over realtime:
   ```sql
   -- READ for the browser (anon); writes stay denied.
   grant select on public.calendar_posts to anon;
   drop policy if exists "anon read calendar_posts" on public.calendar_posts;
   create policy "anon read calendar_posts"
     on public.calendar_posts for select to anon using (true);

   -- Stream row changes over realtime (respects the policy above).
   do $$
   begin
     if not exists (
       select 1 from pg_publication_tables
       where pubname='supabase_realtime' and schemaname='public' and tablename='calendar_posts'
     ) then
       execute 'alter publication supabase_realtime add table public.calendar_posts';
     end if;
   end $$;
   alter table public.calendar_posts replica identity full;
   ```
   `using (true)` = the same exposure as today's open `calendar-get` webhook;
   tighten to per-client in Phase 4 when real auth lands.
2. **Anon key — paste the project's anon/publishable key into
   `CAL_SUPABASE_ANON_KEY`** (`index.html`, in the "CALENDAR v2 … config" block).
   It's a browser key, safe to commit once the RLS policy in (1) is live (this
   doc's standing guidance). `CAL_SUPABASE_URL` is already set
   (`uzltbbrjidmjwwfakwve.supabase.co`). Find it in the dashboard under
   Settings → API → Project API keys (`anon`/`public`, or `Publishable`).

Verify in the browser console: `calV2Status()` →
`{ flag, ready, keySet, subscribed, slug }`.

### Phase 1 dual-write status (verified 2026-06-13 via n8n MCP)

For v1 and v2 to show identical data, Supabase must mirror ALL writes. Verified
live-mirroring: `calendar-upsert-post`, `calendar-delete-post`,
`calendar-reorder-batch`, `calendar-append-post` (the last is dormant — the FE
never calls it). The **only** FE-reachable write path without a Supabase mirror
is `calendar-reorder` (`OXd0sUoSJYMspGTF`), the per-row fallback the FE uses only
when `calendar-reorder-batch` fails — and it also carries a divergent unpublished
batched draft. A reorder that falls back therefore won't mirror until the next
`reorder-batch` or backfill. Low priority for the test; fix = rebuild the
Supabase mirror on the live per-row version (doc option b) without publishing the
batched draft.

### Next (Phase 2 cont. → Phase 3)
- Publish the remaining Phase 1 dual-write workflows (above).
- Activate (steps above); then Sidney + one SMM run real calendars on `?v2=1`
  for ~a week, watching for any divergence vs v1.
- Phase 3 = flip v2 to default behind a kill-switch flag once proven.

## Phase 2 progress — 2026-06-14 (activated, bug-fixed, hardened)

v2 is live behind `?v2=1` and in active testing on `sidneylaruel`. Work merged
(PRs #473 / #474 / #475):

- **Status-revert bug FIXED (#473).** Field-level patch echoes are partial
  (only the written columns); `_calFlushCardSave` was running
  `_calMigratePostShape` on that partial echo, which invented the absent
  sub-statuses and clobbered correct local state on the editing tab (latent
  until the next status click; healed by a refresh). Fix: migrate the MERGED
  full row, not the partial echo. Reproduced + proven via
  `test/calendar-v2-status-repro.js` (extracts the real shipped functions; A/Bs
  buggy vs fixed across 11 sequences + comments). FE-only; no backend change.
- **Realtime freshness (#474).** Cross-tab updates were intermittent: a
  backgrounded tab's WebSocket suspends and Supabase realtime doesn't replay
  missed events, and the only fallback (refresh-on-focus) was throttled 90s (a
  v1 guard for the costly `calendar-get`). Now under v2: tab-return refetches
  from Supabase almost always (cheap; still event-driven, never a poll); a
  catch-up reload fires on realtime re-subscribe; a mid-load event is deferred,
  not dropped.
- **Linear-meta banner — persisted + consistent (#474/#475 + backend).** The
  "incomplete sub-issue" banner (driven by Linear meta not on the Supabase row)
  is persisted (localStorage, 7-day TTL) so it's instant + survives a refresh,
  refreshed on tab-return (cache-first, throttled — no idle n8n load), and now
  also shows on Approved/Posted cards via an additive extension to
  `linear-issue-statuses` (returns `{statuses, meta}`; snapshots
  `linear-issue-statuses.2026-06-14.{pre,post}-meta.json`). It flags only **due
  date + editor** — "no project" was dropped (a sub-issue's project is
  inconsistent and not the actionable signal). Guard:
  `test/calendar-v2-banner-persist.js`.
- **#470 / #471 re-confirmed correct** (scalar-conflict guard bypass for v2;
  skip the FE Linear reconcile under v2 — Linear→calendar flows via the backend
  sync → mirror → realtime).

### Before Phase 3 — run the full-system audit
`PHASE3_AUDIT_PROMPT.md` is a paste-in prompt for a fresh session: audit every
n8n workflow, the FE v2 path, Sheet↔Supabase parity, Supabase RLS/realtime, and
security, with an empirical go/no-go for flipping v2 to default.

### Still open (carried into Phase 3/4)
- ~~`calendar-reorder` fallback has no Supabase mirror~~ — see the reorder-mirror
  note in the Phase 3-prep section below.
- Rotate the plaintext Linear API key (in `linear-status-sync` +
  `linear-issue-statuses` code nodes) and the service_role key into credentials.
- Phase 4: remove legacy polling/LWW/conflict/ledger machinery; per-client RLS;
  close the open unauthenticated webhooks.

## Phase 3 prep — 2026-06-14 (audit + remaining readers migrated)

A full empirical audit (live Supabase + n8n, not just docs) and the migration of
the two remaining calendar-data readers. **Branch only; default NOT flipped.**

### Audit verdict (all verified against the live backend)
- **Sheet ↔ Supabase parity: PERFECT** — 617 rows / 15 clients, 15 fields each
  (overall + 3 sub-statuses, order_index, updated_at, scheduled_date, asset/
  thumbnail, caption, both Linear links, all three comment threads): 0 missing,
  0 field diffs.
- **Writers** `upsert`/`append`/`delete`/`reorder-batch`: all active, mirror in
  the LIVE version (`versionId === activeVersionId`), mirroring with the **same
  `updated_at`** as the Sheet write (why parity is exact).
- **`calendar-reorder` (fallback)**: confirmed `versionId 188e6149 ≠
  activeVersionId 8a591214` — active version is the per-row loop with **no
  mirror**; editor draft holds the batched rewrite. Last fired 2026-06-10; parity
  still perfect → order_index drift self-heals on the next reorder-batch/backfill.
- **`linear-status-sync`**: active; calls `calendar-upsert-post` over HTTP →
  inherits the mirror; writes only the matched sub-status, never the overall.
- **RLS**: anon SELECT works; anon write → **HTTP 401**. **Realtime**: a
  `postgres_changes` subscription on `calendar_posts` is accepted live (binding id
  returned) → table is in the publication + replica identity is set.
- Recent `upsert` "error" executions are the **phantom-row guard** firing as
  designed (they throw before any write — not mirror failures).
- **v1 is byte-identical**: every `CAL_SUPABASE_URL` reference is gated behind
  `_calV2Ready()`; with the flag off, zero Supabase calls and supabase-js never
  loads.

### Readers migrated (behind `?v2=1`; v1 byte-identical; n8n fallback retained)
- **Kasper queue** (`_kasperFetchAllRelevantPosts`): under v2 a **single Supabase
  REST read** (`select=*`) covers every client (one table); rows are grouped by
  the `client` column and run through the **same `extract()`** the Sheet path
  uses. On any Supabase error it falls through to the existing `kasper-queue`
  batch + per-client `calendar-get` fan-out (can never blank). Plus a **realtime
  subscription** (`_kasperV2EnsureSubscribed`/`_kasperV2Teardown`, channel
  `kasper-cal`, all clients) that pushes a **debounced** call to the existing
  `_kasperMaybeBackgroundRefresh` — so the queue is live without a poll; an idle
  tab makes no n8n calls. Torn down on leaving the Kasper view.
  *Verified live: the single grouped query reproduces every client's
  `calendar-get` id-set exactly (15/15, 617 rows).*
- **Filming runway** (`_filmsFetchRunway`): per-client read swapped to
  `_calV2FetchPosts` under v2 (which already falls back to `calendar-get`).
  Refresh-on-open only — no realtime (it's a computed summary).
- **`_calFetchPostsForVerify`**: **deliberately left on the Sheet.** It's the
  post-bulk-import retry check; the upsert webhook writes the Sheet synchronously
  (responds after) but mirrors to Supabase async, so a Supabase read here could
  see mirror lag and trigger spurious re-sends. Revisit when the Sheet is retired.

After this, every live calendar-data surface reads from Supabase under v2.
Checks: inline script syntax-clean; both harnesses pass; parity perfect.

### Reorder-mirror — snapshotted; needs a human UI step (do NOT auto-edit via MCP)
Snapshot of the LIVE per-row active version taken first:
`n8n-backups/calendar-reorder.2026-06-14.pre-mirror.json` (activeVersionId
`8a591214`, verified current).

**Why this can't be safely automated via MCP** (confirmed this session): the n8n
`update_workflow` tool applies operations (addNode/addConnection/…) to the
workflow's **current draft** — and for `calendar-reorder` that draft is the
**batched** version (`versionId 188e6149`), NOT the live per-row one
(`activeVersionId 8a591214`). So `addNode` would attach the mirror to the batched
graph, and any publish would flip live reorder to batched+mirror — the exact
unintended behavior change the original audit said to avoid. There is no clean
MCP op to reset the draft back to the per-row version, so this is left for a
human in the n8n UI (which is also where it self-evidently shows which version is
being edited). This matches why the prior session deferred it.

**Safe UI recipe (option b — per-row + mirror, ~2 min):**
1. Open workflow `OXd0sUoSJYMspGTF` (SyncView Calendar — Reorder). The editor
   shows the **batched** draft — discard it: revert/restore to the **published**
   (per-row) version so the canvas shows `Fan Out Reorder Items → Strip Routing →
   Update Order Index → Wrap Response → Respond JSON` (the snapshot above is the
   source of truth if a rebuild is needed).
2. Copy the two mirror nodes from **SyncView Calendar — Reorder (batch)**
   (`lTtZNLrQLpIZqwAY`): `Prep Mirror Reorder` (code) and `Mirror Reorder`
   (Supabase, credential `Supabase - SyncView Calendar` / `XdBpJ6Xk8PMpZXXT`,
   `onError: continueRegularOutput`).
3. Change ONLY `Prep Mirror Reorder`'s code to source rows from the per-row
   workflow's fan-out instead of the batch workflow's plan:
   ```js
   const items = $('Fan Out Reorder Items').all().map(i => i.json || {});
   return items.map(it => ({ json: {
     client: String(it._client || ''), id: String(it.id),
     order_index: String(it.order_index), updated_at: String(it.updated_at)
   } }));
   ```
4. Wire: `Update Order Index` → (existing) `Wrap Response` AND (new)
   `Prep Mirror Reorder` → `Mirror Reorder`. Leave the response path unchanged.
5. Publish. Verify with a fallback reorder (or re-run the parity check) that
   `order_index` mirrors to Supabase.

Until then: a reorder that falls back to `calendar-reorder` won't mirror, but it
self-heals on the next `reorder-batch`/backfill. Current `order_index` parity is
**perfect** (0 diffs), and the fallback last fired 2026-06-10 — so the live risk
is minimal.

### NOT done (needs explicit sign-off)
- **Phase 3 flip** (v2 → default). Technically green + reversible, but v2 has only
  been dogfooded ~1–2 days (mostly `sidneylaruel`); recommend a few more days of
  real use first. Migrating Kasper/runway was NOT a hard blocker for the flip
  (dual-write keeps the Sheet current) — it's needed for live-everywhere + Sheet
  retirement.
- Security (Phase 4): the **live** plaintext Linear key, open unauthenticated
  webhooks + CORS `*`, service_role rotation, tightening anon RLS to per-client.

## Write-path hardening — 2026-06-14 (STAGED in n8n, awaiting publish)

Bucket 2, part 1 from the evening handoff. The ~5-min Google Sheets outage
(21:42–21:47 UTC) lost saves. **Root cause re-confirmed from the live failed
execution (`pWSqaqVw7dmqhYOA` exec 68798), not just the docs:** `Read Existing
Row` ran **185,312 ms** then (with `onError: continueRegularOutput`) forwarded an
item shaped `{ json: { error: 'Service unavailable…' }, error: {NodeApiError} }`.
`Merge Comments` read that as `existsAlready=false` and the **phantom-row guard
threw** on `p_mq5noms6_ju5k2` — a *real existing* `sidneylaruel` row — so a
status-only save was rejected and lost. Five execs failed this way in the window
(68798/802/806/810/814).

**Fix (staged):** a **read-failure guard** at the top of `Merge Comments` — if the
`Read Existing Row` item carries an error (`.json.error` string / item `.error`
object), early-return `{ _conflict:true, ok:false, error:'…briefly unavailable…' }`
through the existing **no-write** path (`Is Conflict` true → `Respond JSON`). This
(a) stops the phantom-row throw on a failed read, (b) stops a failed read from
**bypassing the link-clobber/conflict guards** on content patches, and (c) returns
a clean, retryable response — the FE's `if(!json.ok) throw` path shows the message
on the save chip and keeps the user's typed text (verified against
`_calFlushCardSave`, index.html ~16861). A genuine "row not found" (`{json:{}}`,
no error) is unaffected, so new-row creates still work.

- **Snapshots:** `n8n-backups/calendar-upsert-post.2026-06-14.pre-readfail-guard.json`
  (live pre-edit, activeVersionId `e6d87360…`) and `…post-readfail-guard.json`
  (reference). Patched code syntax-checked (`node --check`).
- **Status:** staged to the **draft** via MCP (`versionId fc5368e1…`); the
  **active version is unchanged** (`activeVersionId e6d87360…`) — production is
  byte-identical until **Sidney publishes** it in the n8n UI. Only `Merge
  Comments`.jsCode changed; 14 nodes, all other guards intact.
- **NOT addressed — the ~3-min hang itself.** The handoff's part (a) ("give Read
  Existing Row a ~10 s timeout") is **not possible on the native Google Sheets
  node** — it has no per-node request-timeout option (that's an HTTP Request node
  feature). So during an outage the read still hangs ~185 s before this guard can
  return the clean error. Fail-fast would require converting `Read Existing Row`
  to an HTTP Request node (raw Sheets API + `options.timeout`) or an n8n-level
  execution timeout — a larger, separate change. The data-loss/clobber bug is
  fixed by the guard regardless of hang time.
- **To publish + verify (Sidney):** open `calendar-upsert-post`, review the
  `Merge Comments` diff (the new guard block right after `const twinItems =
  $input.all();`), **Publish**. Then `activeVersionId` should become `fc5368e1…`.
  Optional live check: a normal save still round-trips (create + status patch),
  and the calendar still mirrors to Supabase.
- **Bigger cure still pending:** make Supabase the write target (writes are still
  Sheet-first, amplified ~3× by Linear status-sync). Phase-4-scale; plan later.
- **Update 2026-06-14:** the read-failure guard was **published** — upsert
  `activeVersionId fc5368e1` carries it live (verified via n8n MCP).

## Phase 3 — flip v2 to the DEFAULT (2026-06-14, prepped)

v2 is now the **default** (no flag needed) behind a sticky `?v2=0` kill-switch.
`_calV2Enabled()` returns true unless this browser opted out via `?v2=0` (which
sets `CAL_V2_KILL_KEY` in localStorage); `?v2=1` force-enables and clears the
opt-out. One contained change to one function — it flips the main calendar, the
client share view (`?c=`), the SMM review, the **Kasper queue**, and the
**filming runway** together (all gated on `_calV2Ready()`). **Samples is
unaffected** (its own `?sv2=1`). Writes still dual-write to the Sheet, so
rollback is trivial and lossless.

- **Rollback (everyone):** change `let on = true` back to `let on = false` in
  `_calV2Enabled()` and redeploy (or merge a revert).
- **Rollback (one browser):** open `?v2=0` (sticky).
- **Prereqs that landed first (both done):** the Kasper→SMM approval-clobber fix
  (the 90 s recent-save guard now adopts a third party's genuinely-newer
  sub-status instead of keeping + re-saving the stale local copy; regression
  test §E in `test/calendar-v2-status-repro.js`, replays the live clobber) and
  the `calendar-upsert-post` read-failure guard (live).
- **Watch after deploy:** v2 had only ~2 days of dogfooding (mostly
  `sidneylaruel`) before the flip, now exposed to every client — watch the first
  day; `?v2=0` is the instant escape hatch.
- **Status:** prepped on the feature branch; **deploying it to everyone is a
  deliberate merge** (own PR, separate from the already-merged #484).

### Still open → Phase 4 (cleanup + security, not started)
- Rotate the plaintext Linear key + the `service_role` key into n8n credentials.
- Close the open unauthenticated webhooks + CORS `*`; tighten anon RLS from
  `using(true)` to per-client when real auth lands.
- Remove the legacy polling/LWW/conflict/ledger machinery once v2 has proven out;
  remove the `?v2debug=1` logging when no longer needed.
- **Separate track:** Samples → Supabase (its own `?sv2=1`, architectural twin).
