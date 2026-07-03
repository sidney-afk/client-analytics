# n8n Phase 0 Snapshot Status

Date: 2026-07-03

This is not the full n8n workflow JSON export. The full unredacted snapshot must stay private because workflow exports may contain credentials, tokens, webhook secrets, and private business payloads.

## What was verified

- Live n8n workflow count from `search_workflows`: 87.
- Existing workflow `SyncView - Weekly Backup` (`jlVfbg0Njxf1It7h`) is active and schedule-triggered.
- Last retained successful weekly backup execution before this phase: `166880`, started `2026-07-02T20:49:47.170Z`, stopped `2026-07-02T20:50:11.222Z`.
- Rechecked retained executions on 2026-07-03 after the denied manual run; no newer execution was present.
- Workflow `MJbMZ789B5ExZz9x` is active and successfully received the Phase 0 Linear Graphics TEST issue probe via execution `190952`.

## Full export status

- Owner approved running `SyncView - Weekly Backup` manually for the private full export.
- The n8n execution tool rejected the run under tenant safety policy because it would export private repo data, Supabase rows, and unredacted workflow JSON to an external Google Drive folder.
- No workaround was attempted.
- Owner then ran the workflow manually in n8n. Execution `191240` succeeded (`manual`, started `2026-07-03T21:28:30.983Z`, stopped `2026-07-03T21:28:54.203Z`).
- Private Drive folder: weekly-backup private location, verified outside the public repo.

## Private backup artifacts

- Main sheet copy: `SyncView Main Sheet - 2026-07-03`, verified in the private weekly-backup Drive folder.
- Repo zip: `client-analytics-2026-07-03.zip`, verified in the private weekly-backup Drive folder.
- n8n workflows JSON: `n8n-workflows-2026-07-03.json`, verified in the private weekly-backup Drive folder.
- Supabase JSON: `supabase-2026-07-03.json`, verified in the private weekly-backup Drive folder.

## Required before Track A cutover

- Complete: private backup execution and artifact metadata are recorded without committing secrets or raw workflow JSON to the public repo.
