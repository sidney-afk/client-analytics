# A2 n8n Snapshot Status

Captured: 2026-07-04

## Scope

- Workflow touched: `MJbMZ789B5ExZz9x` (`SyncView Calendar - Linear Status Sync`)
- Node touched: `Handle Sample Linear Event`
- Purpose: route the embedded sample-review upsert call through `sample_review_ef_clients`, defaulting to the existing n8n `sample-review-upsert` webhook whenever the flag is empty, missing, or unreadable.

## Public-Safe Evidence

- Pre-edit raw workflow export was saved outside the public repo under `private-backups/2026-07-04-a2/`.
- Post-edit raw workflow export was saved outside the public repo under `private-backups/2026-07-04-a2/`.
- Raw workflow JSON is not committed because this public repo must not contain n8n credentials, Linear keys, Supabase keys, or other secret-shaped workflow material.
- The active workflow version after the A2 samples-branch routing edit is `405ab03a-12bb-43ca-b70a-14aee3ba7f35`.

## Safety State

- The live n8n workflow remains active.
- The old sample-review n8n upsert webhook remains the default/fallback path.
- `sample_review_ef_clients` is designed as an allow-list. Empty/missing/unreadable flag state routes all sample writes through n8n.
- No real client was added to any runtime flag as part of this snapshot/edit.
- Supabase A2 deployment and TEST-only parity have completed. The flag row `sample_review_ef_clients` exists and remains `{"clients":[]}`.
- Deployed A2 Edge Function versions: `calendar-reorder` version 2, `sample-review-upsert` version 1, and `sample-review-reorder` version 1.
- Final TEST parity passed for `calendar-reorder-batch-shape`, `sample-review-reorder`, all five sample-upsert guard cases, and the required sample comment-merge case.

## Rollback

If the n8n routing edit itself needs rollback, restore the `Handle Sample Linear Event` code node from the private pre-A2 export in `private-backups/2026-07-04-a2/` and publish the workflow. If the Edge Function canary later misbehaves after deployment, the one-step rollback is setting `syncview_runtime_flags.sample_review_ef_clients` to `{"clients":[]}`.
