# n8n Snapshot Status - 2026-07-08 Pager Tuning

Public-safe status stub for the live n8n workflow edit requested on 2026-07-08.

## Workflow

- `qllIDZPkdNAPRj0b` - `SyncView Monitoring Pager + Reconciler V2 Trigger`

## Private Snapshots

- Pre-edit export stored outside the public repo:
  - `C:\Users\Sidney\Documents\Codex\private-backups\2026-07-08-pager-tuning\pager.qllIDZPkdNAPRj0b.pre-tuning.20260708-084829.json`
  - SHA-256: `57e05da343ece83a5b3f00a2aa06bf2ce54acb42e1255bf1345e7f2dfc5f73a4`
- Post-edit readback stored outside the public repo:
  - `C:\Users\Sidney\Documents\Codex\private-backups\2026-07-08-pager-tuning\pager.qllIDZPkdNAPRj0b.post-tuning.20260708-085204.json`
  - SHA-256: `feb9a6c290eb383776fb50a574cc2b7329e6afe71c5ca81ae62499f037b85346`
- Pre stale-alert noise fix export stored outside the public repo:
  - `C:\Users\Sidney\Documents\Codex\private-backups\2026-07-08-pager-tuning\pager.qllIDZPkdNAPRj0b.pre-stale-noise-fix.20260708-090641.json`
  - SHA-256: `8315f948e37f663914065cb5a9beff3ccb4c9c43f5d21b525eda51e6d31bf0fa`
- Final post stale-alert noise fix readback stored outside the public repo:
  - `C:\Users\Sidney\Documents\Codex\private-backups\2026-07-08-pager-tuning\pager.qllIDZPkdNAPRj0b.post-stale-noise-fix.20260708-090745.json`
  - SHA-256: `7118dc17c0b606bb78845e38dc44a251f31dba00c509922c9fe9ea42162aa277`

## Public-Safe Change Summary

- Added pager dispatches for the calendar and samples status reconcilers every 15 minutes using schedule-equivalent healing mode (`dry_run=false`, cap 15).
- Tuned v2 non-zero diff paging so a single non-zero v2 tick is logged quietly; DM paging happens only on two distinct consecutive non-zero v2 summaries or a growing non-zero sequence.
- After the first tuned tick, corrected the stale-run check to treat a fresh queued/in-progress card reconciler dispatch as healthy, so the pager does not DM stale while the workflow it just dispatched is still completing.
- Kept existing one-hour per-condition DM throttling.

## Verification

- First tuned tick `222743` completed successfully and dispatched all three reconciler workflows, but produced a samples stale false page because the newly dispatched samples run was still completing.
- Final post-fix scheduled tick `222824` completed successfully with 0 alert items and dispatched successful runs for v2 (`28953791214`), calendar (`28953792681`), and samples (`28953796285`).

No secrets are stored in this stub.
