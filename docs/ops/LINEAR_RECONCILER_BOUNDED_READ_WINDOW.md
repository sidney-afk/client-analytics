# Linear reconciler bounded-read install window

Status: **prepared only; no production action is authorized by this document.**

This is the owner window for `2026-08-03-linear-reconciler-bounded-inputs.sql` and the matching
hourly `linear-deliverables-reconcile.yml` source. It installs the measured compute-on-read route:
three read views and seven functions, with no source trigger, sidecar/cache table, backfill, flag
change, Linear write, or source-row write.

## Blocking cadence prerequisite

The repository cron is not the only caller. Active n8n workflow `qllIDZPkdNAPRj0b` currently runs
every 15 minutes and dispatches `linear-deliverables-reconcile.yml` with `apply=false`. Merely changing
the GitHub cron to hourly would therefore leave at least four n8n-triggered database reads per hour,
plus any GitHub schedule delivery. The 24-runs/day compute estimate is valid only after that duplicate
dispatcher is removed from the read path.

Before this install can start, the owner must separately authorize an n8n change that disables or
bypasses only the `Trigger Reconciler V2` GitHub dispatch while preserving the combined pager's other
lanes and health reads. Do not slow or disable the whole 15-minute pager. Capture its exact active
version and node hash to the existing private snapshot path first; after publish, read back the new
active version and graph, and observe one full 15-minute cycle with zero reconciler-v2 dispatches.
The private pre-edit snapshot is the n8n rollback.

No n8n edit is included in PR #1013, and none should be made without that separate owner approval.
Until the prerequisite is complete and read back, #1013 must remain draft and the measured hourly
risk conclusion must not be used to authorize installation.

## Database and workflow window

After the cadence prerequisite is green:

1. While the old reconciler source is still on `main`, disable
   `linear-deliverables-reconcile.yml`, read back that it is disabled, and wait until its complete
   paginated run inventory has zero queued or in-progress runs. Only then merge #1013. Record the
   exact merged `main` SHA and prove the workflow remained disabled across the merge. A merge while
   the workflow is enabled stops the window because the new reader requires objects not yet installed.
2. Re-run the read-only production measurement and require the source relation counts and plan shape
   to remain within the reviewed cohort. A materially larger or physically-read plan stops the window.
3. Apply `migrations/2026-08-03-linear-reconciler-bounded-inputs.sql` exactly once. The file owns one
   transaction and fails closed if either prior sidecar relation or prior source trigger exists.
4. In a new read-only transaction require all of the following:
   - `linear_reconcile_projection_status_v1` returns exactly one row with `projection_version=1` and
     `ready=true`;
   - `linear_deliverables_reconcile_input_v1` has exactly the same row count as `deliverables`;
   - every projected row has an object `linear_raw` and a lowercase 64-hex source hash;
   - `service_role` can select both bounded views and execute the capped hydration RPC using its
     pre-existing Supabase source-table/extension privileges;
   - no `linear_reconcile_deliverable_cache` or `linear_reconcile_comment_event_map` relation exists;
   - no `linear_reconcile_deliverable_cache_after` or `linear_reconcile_comment_event_after` trigger
     exists.
5. Re-enable the workflow. Dispatch `proof_only=true` against the exact merged SHA and one pinned
   reconciler summary event. Require `deployment_reader_verified=true`, behavioral equivalence, the
   owner-approved counter gate, and a zero-write network guard.
6. Observe outside n8n until two consecutive normal scheduled database-reading runs reach terminal
   state. Require zero ordinary n8n `workflow_dispatch` calls and require the two `run_started_at`
   values to be at least 60 minutes apart. Record each exact GitHub run ID/event/SHA/start/result. A
   missing second run or observation timeout is a liveness failure, not a cadence pass; do not replace
   this spacing proof with a count over an arbitrarily aligned wall-clock window.

## Rollback

On any pre-COMMIT database failure, PostgreSQL rolls the transaction back. Keep the workflow
disabled, read back that all ten candidate objects are absent, revert the repository source, record
the exact reverted `main` SHA, then re-enable/read back the reverted workflow and require one
terminal-success run plus its reconciler summary. Restore the private n8n snapshot only if the owner
explicitly abandons the hourly route, with the same active-version/node-hash and first-terminal-run
proof required below. Do not leave the merged view-dependent source enabled without its objects.

On a post-COMMIT proof failure:

1. disable `linear-deliverables-reconcile.yml` again and wait for zero active runs;
2. apply the owner-only rollback block at the end of the migration (three views, seven functions;
   source rows remain untouched);
3. read back that all ten objects are absent;
4. revert the repository source while the workflow remains disabled and record the exact reverted
   `main` SHA;
5. re-enable `linear-deliverables-reconcile.yml`, read back that it is enabled, dispatch the reverted
   source at that exact SHA, and require one terminal-success run plus its reconciler summary before
   declaring rollback complete;
6. restore the private n8n snapshot only if the owner explicitly abandons the hourly route, then
   verify its active version/node hash and first terminal dispatch.

Do not restore the 15-minute n8n dispatch while the compute-on-read source is active: that would
silently invalidate the measured cadence assumption.
