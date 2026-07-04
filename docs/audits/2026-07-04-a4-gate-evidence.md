# A4 Gate Evidence - 2026-07-04

Public-safe evidence for draft PR #673 (`codex/a4-settings-edge-functions`).

## PR state

- PR #673 remains draft, open, and unmerged.
- Remote head checked: `ce86f10b2236f6eb0c21330a021163c9521dea32`.
- Hosted GitHub Actions run `28714721464` (`Calendar unit tests`) passed on the PR head.

## Runtime flags

Readback at `2026-07-04T18:10:28Z`:

- `calendar_upsert_ef_clients={"clients":["sidneylaruel"]}`
- `sample_review_ef_clients={"clients":["sidneylaruel"]}`
- `settings_ef_clients={"clients":[]}`

No real client is enabled for A4. A1/A2 remain TEST-client only.

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
