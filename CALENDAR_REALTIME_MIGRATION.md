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
| `calendar-delete-post` (`JcekBKUzELgX4HjH`) | Prep Mirror Del → Mirror Archive (update) | Draft built + tested — **awaiting publish** |
| `calendar-reorder-batch` (`lTtZNLrQLpIZqwAY`) | Prep Mirror Reorder → Mirror Reorder (update per row) | Draft built + tested — **awaiting publish** |
| `calendar-append-post` (`iA54ipMOybicmYBh`) | Prep Mirror Append → Mirror Create Append (create) | Draft built — **awaiting publish** (dormant: FE does not call this webhook) |
| `calendar-reorder` (`OXd0sUoSJYMspGTF`) | — | **NOT TOUCHED** — divergent unpublished batched draft; editing+publishing would also flip live reorder to the batched version. It's only the FE fallback when `reorder-batch` fails. Decide separately: (a) publish batched + add dual-write, or (b) rebuild dual-write on the active per-row version. Until then, a fallback reorder won't mirror (self-heals on next backfill or next `reorder-batch`). |

Note: `publish_workflow` via MCP is approval-gated and could not be
completed programmatically; workflows are published manually in the n8n UI.

Mirror semantics: upsert = create-or-update (keyed on the Sheets
`Read Existing Row` result); delete = update `status=Archived`; reorder =
update `order_index` of existing rows only (no insert, matching the Sheets
phantom-row guard). All filters use `allFilters` on `(client, id)`.

Test residue: an archived card `p_test_dw_001` ("DUALWRITE TEST") exists on
`sidneylaruel` in both Sheets (invisible) and Supabase — safe to ignore or
delete.

### Phase 1 remaining
- Publish `delete-post`, `reorder-batch`, `append-post` (UI).
- Decide on `calendar-reorder` fallback (above).
- Optional: a periodic parity check (sheet vs Supabase) now that writes are
  mirrored; the `Backfill (ALL clients)` workflow (`yQBGgdbZPqOgn2eE`)
  doubles as a re-sync + parity report.
