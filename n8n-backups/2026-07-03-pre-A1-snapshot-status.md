# n8n Pre-A1 Snapshot Status

Date: 2026-07-03

This is not a raw n8n workflow JSON export. Raw workflow exports may contain credentials,
tokens, webhook secrets, and private business payloads, so they must stay out of this public
repository.

## Workflows in A1 Scope

| Workflow | ID | Live state | Version checked before A1 |
|---|---|---|---|
| SyncView Calendar - Upsert Post | `pWSqaqVw7dmqhYOA` | active | `7ef44971-5c6b-46d7-b7d1-68a504913d28` |
| SyncView Calendar - Linear Status Sync | `MJbMZ789B5ExZz9x` | active | `2fc824c2-1b60-413a-b2c3-e51135f7448a` |

## Private Backup Evidence

- The private Phase 0 weekly-backup execution `191240` contains the full unredacted
  2026-07-03 workflow export for all 87 live workflows.
- Before A1 work started, both A1-scoped workflow version IDs above were re-read from live n8n
  and still matched the versions covered by that private backup.
- A1 later edited only `MJbMZ789B5ExZz9x` (`Handle Linear Event`) to add per-client
  `calendar_upsert_ef_clients` routing. The old calendar-upsert n8n URL remains the default
  path when the flag is empty or unreadable.
- The edited draft was published on 2026-07-03; live `versionId` and `activeVersionId` both
  became `ece94b2c-cdba-46b3-a1e5-966abda0e8f6`.
- `pWSqaqVw7dmqhYOA` (`SyncView Calendar - Upsert Post`) was not edited during A1.

## Required Before Any Further A1 n8n Edit

- Re-read the target workflow immediately before editing it.
- If the live version ID differs from the table above, stop and take a fresh private workflow
  export before applying the change.
- Keep the old n8n path active through canary; rollback for A1 is the Supabase runtime flag,
  not deleting or deactivating the old workflow.
