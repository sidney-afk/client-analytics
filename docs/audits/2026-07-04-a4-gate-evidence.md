# A4 Gate Evidence - 2026-07-04

Public-safe evidence for draft PR #673 (`codex/a4-settings-edge-functions`).

## PR state

- PR #673 remains draft, open, and unmerged.
- Hosted GitHub Actions passed on the A4 PR branch before the read-routing fix; the PR description records the current head and latest hosted check after each push.

## Runtime flags

Readback at `2026-07-04T18:10:28Z`:

- `calendar_upsert_ef_clients={"clients":["sidneylaruel"]}`
- `sample_review_ef_clients={"clients":["sidneylaruel"]}`
- `settings_ef_clients={"clients":[]}`

No real client is enabled for A4. A1/A2 remain TEST-client only.

## Read/write routing fix

The A4 staged frontend reads n8n as the base store and overlays Supabase rows only for clients listed in `settings_ef_clients`, using the same runtime flag as the write path:

- Staff Templates bulk-load: n8n map first, then Supabase overlay for flagged clients only.
- Caption prompts: n8n map first, then Supabase overlay for flagged clients only.
- Empty flag, flag-read failure, or Supabase read failure leaves the n8n base in place.

This prevents unflagged clients from writing to Google Sheets through n8n while reading stale Supabase backfill data on reload.

## A4 fallback state

Read-only n8n metadata check at `2026-07-04T18:10:28Z`:

- `RhEdtimfMUeogyL2` (`SyncView Templates - Get`) active, unarchived.
- `oPX1nH7TxzCITNAz` (`SyncView Templates - Save`) active, unarchived.
- `3hZnjXmHdNv4bttw` (`SyncView Caption Prompts - Get`) active, unarchived.
- `RGkuE8d4uJg6CPde` (`SyncView Caption Prompts - Save`) active, unarchived.

Supabase function readback at the same gate:

- `templates-save` active, version 1, `verify_jwt=false`.
- `caption-prompts-save` active, version 1, `verify_jwt=false`.

## Validation

Fresh local recheck at `2026-07-04T18:07:32Z`:

- `node --check scripts/a4-settings-backfill-parity.js`
- `node test/a4-settings-edge-source.js`
- `git diff --check origin/main...origin/codex/a4-settings-edge-functions`
- A4 public secret-pattern scan
- `npm.cmd test` with Git Bash on PATH: all 39 unit suites passed

## Scope audit

- Changed files are limited to A4 settings work.
- No A3 Linear bridge endpoints or files were added.
- No `linear-set-status`, `linear-add-comment`, or `linear-issue-statuses` migration work appears in the A4 diff.
- No filming-plan migration appears in the A4 diff.
- The only new `generate-caption` references are source assertions that caption generation remains on n8n and the A4 Edge Functions do not touch it.

## Rollback

The one-step A4 rollback remains:

```sql
update public.syncview_runtime_flags
set value = '{"clients":[]}'::jsonb, updated_by = 'rollback'
where key = 'settings_ef_clients';
```

With the current empty value, all clients remain on the old n8n/Sheets path for templates and caption-prompt writes.
