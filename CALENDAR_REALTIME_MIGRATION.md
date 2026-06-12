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

## Open items / first steps for the next session

1. Verify n8n MCP access (it was not authorized in the audit session).
   List workflows; audit the ones not in `n8n-backups/`: `calendar-get`,
   `calendar-delete-post`, `calendar-reorder-batch`, the Linear
   status-sync workflow, `kasper-queue`, `linear-issues`.
2. Map exactly which workflows write to the calendar sheet → that's the
   Phase 1 dual-write list.
3. Snapshot each workflow into `n8n-backups/` before touching it.
4. Sidney to create the Supabase project (or decide who does) — keys must
   NOT be committed to this public repo; FE uses the publishable anon key +
   RLS only.
