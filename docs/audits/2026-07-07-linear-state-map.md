# Linear State Slug Map

Date: 2026-07-07

Purpose: public-safe review record for the B3 `LINEAR_STATE_UUID_MAP` Edge Function secret. The
actual UUID-to-slug JSON is stored only as a Supabase Edge Function secret and is not committed.

## Graphics Team

| Linear state name | Linear type | SyncView slug |
|---|---|---|
| Scheduled | completed | `scheduled` |
| Duplicate | duplicate | `duplicate` |
| For Client approval | started | `client_approval` |
| For SMM approval | started | `smm_approval` |
| For Kasper approval | started | `kasper_approval` |
| Approved | completed | `approved` |
| Tweak Needed | started | `tweak` |
| Posted | completed | `posted` |
| Canceled | canceled | `canceled` |
| In Progress | started | `in_progress` |
| Backlog | backlog | `backlog` |
| Todo | unstarted | `todo` |

## Video Team

| Linear state name | Linear type | SyncView slug |
|---|---|---|
| Scheduled | completed | `scheduled` |
| Duplicate | duplicate | `duplicate` |
| For Client Approval | started | `client_approval` |
| For SMM approval | started | `smm_approval` |
| Posted | completed | `posted` |
| For Kasper approval | started | `kasper_approval` |
| Approved | completed | `approved` |
| Tweak Needed | started | `tweak` |
| Triage | triage | `triage` |
| In Progress | started | `in_progress` |
| Canceled | canceled | `canceled` |
| Backlog | backlog | `backlog` |
| Todo | unstarted | `todo` |

## Secrets Updated

- `LINEAR_STATE_UUID_MAP`: set in Supabase Edge Function secrets with 25 UUID entries.
- `LINEAR_LEGACY_COMMENT_ACTORS`: set in Supabase Edge Function secrets after verifying the house Linear identity from a live legacy `(via SyncView)` comment.

No Linear webhook, runtime flag, n8n workflow, or production authority setting changed.
