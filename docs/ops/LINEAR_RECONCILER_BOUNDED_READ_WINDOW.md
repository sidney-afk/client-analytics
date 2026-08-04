# Linear reconciler bounded-read install window

Status: **prepared only; no production action is authorized by this document.**

This is the owner window for `2026-08-03-linear-reconciler-bounded-inputs.sql`, its optional
concurrent comment-candidate index, and the matching reconciler source. The required migration
installs three service-only compute-on-read views and seven functions. It adds no source trigger,
sidecar/cache table, backfill, flag change, Linear write, source-row write, or new code in the
`deliverables` or `deliverable_events` write paths. Full `linear_raw` is available only through the
existing SHA-bound hydration RPC, capped at 100 exact IDs per run.

## Current cadence and measured cost

The shared trigger in active n8n workflow `qllIDZPkdNAPRj0b` still runs every 15 minutes. On
2026-08-03, only its `Trigger Reconciler V2` edge was moved to a dedicated
`Hourly - Reconciler V2 only` trigger at minute 0; Calendar, Samples, V2-summary monitoring,
incremental refresh, and outbound remain on the shared 15-minute path. A private pre-edit export was
captured first, the published graph was read back, and the first hourly V2 dispatch completed
successfully. The shared 15-minute trigger remains unchanged.

The repository schedule remains unchanged at `*/10 * * * *`. GitHub delivered 12, 14, and 13 native
scheduled runs on the last three complete UTC days, so the reviewed current estimate is 24 hourly
n8n dispatches plus about 13 native deliveries: roughly 37 full reconciler runs/day. This is an
observation, not a hard cap; the configured upper bound remains 168/day if GitHub begins honoring
every requested tick.

The current reader spills 34.1 MiB/run of temporary-block traffic. At 37 runs/day that is roughly
1.23 GiB/day of temp-file Disk IO. Both bounded designs eliminate that spill. The chosen view costs
about 49 seconds/day more database time than the trigger-maintained cache at 37 runs/day, while its
extra logical-buffer work stays in memory and it introduces no trigger writer. Linear scaling to the
historical roughly 110 runs/day is about 146 seconds/day of extra database time and still zero temp
spill. The owner accepted that trade.

No n8n edit is included in PR #1013. Keep the isolated hourly V2 relief in place through merge,
database installation, and the exact acceptance proof. The owner has directed that only the V2
branch return to 15 minutes after #1013 is installed and green; that later private-snapshot-backed
live edit must not slow, replace, or republish the shared trigger.

## Database and workflow window

1. While the old reconciler source is still on `main`, disable
   `linear-deliverables-reconcile.yml`, read back `disabled_manually`, and require a complete
   paginated run inventory with zero queued or in-progress runs. Only then merge #1013. Record the
   exact merged `main` SHA and prove the workflow remained disabled across the merge.
2. Re-run the read-only production measurement. Require the reviewed source counts/plan shape and
   confirm that no rival cache relation or reconciler source trigger exists. A material cohort or
   plan-shape change stops the window.
3. Apply `migrations/2026-08-03-linear-reconciler-bounded-inputs.sql` exactly once. The required
   views/functions/RPC install is one transaction and fails closed if the rival trigger/sidecar
   boundary or required existing service-role source/digest privileges do not match.
4. In a new read-only transaction require all of the following:
   - `linear_reconcile_projection_status_v1` returns exactly one row with `projection_version=1` and
     `ready=true`;
   - `linear_deliverables_reconcile_input_v1` has exactly the same row count as `deliverables`;
   - every projected row has an object `linear_raw` and a lowercase 64-hex source hash;
   - a PostgREST-shaped `id > cursor ORDER BY id LIMIT 1000` plan reaches `deliverables_pkey`, has no
     full-projection sort, and reports zero temp blocks;
   - `service_role` alone can select the bounded views and execute the capped hydration RPC using
     its existing source-table and digest privileges;
   - no rival sidecar relation or source trigger exists.
5. Optionally run `migrations/2026-08-03-linear-reconciler-comment-index-optional.sql` with psql
   autocommit enabled. It uses `CREATE INDEX CONCURRENTLY`, is not a readiness dependency, and must
   read back `indisvalid=true`, `indisready=true`, and `indislive=true`. The view remains exact
   lifetime aggregation with no time predicate whether this index is present or absent.
6. Re-enable the workflow. Dispatch `proof_only=true` against the exact merged SHA and a pinned
   reconciler summary event retained as provenance. Require `deployment_reader_verified=true`, exact
   behavioral equivalence, one shared bounded deliverable/comment and Linear/webhook snapshot, exact
   primary-key sets and selected-row values for all five support tables, identical legacy-versus-keyset
   repair/linkage/outbound counters in the same acceptance run, and the fail-closed zero-write network
   guard. Record the baseline, legacy, and candidate absolute counter values in the receipt as evidence
   only; do not assert a fixed value or require the historical baseline to equal the live run. This one
   acceptance run deliberately reads only the five support tables through their legacy OFFSET paths for
   comparison; it never restores the raw deliverables or whole-history payload-bearing
   `deliverable_events` reader, and ordinary runs never invoke the legacy support readers.
7. Observe at least 65 minutes outside n8n. Require no quarter-hour V2 `workflow_dispatch` calls,
   at most the expected minute-0 hourly n8n dispatches at the interval boundaries, and separately
   classify any native `schedule` deliveries. Record exact run event/SHA/terminal results; missing
   expected n8n work is a liveness failure, not a cadence pass.
8. After the installed reader and acceptance gate are green, execute the already owner-directed
   branch-only return to 15 minutes: take a new private pre-edit export, move only the V2 edge back
   to the unchanged shared trigger, remove only the hourly V2 trigger, publish, read back the active
   version/graph, and prove the first terminal V2 dispatch. Do not alter the shared trigger or its
   other branches.

## Remaining read exposure observed 2026-08-04

- The partial indexes are necessary but do not eliminate every cold-read failure. An independent
  `action=like.mirror_in*&order=ts.desc&limit=5` probe still returned one HTTP 500 / PostgreSQL
  `57014` after 3.8 seconds before five warm reads returned quickly. Treat this as unresolved
  `deliverable_events` cold-read exposure, not as a failure of the proven n8n `LIMIT 1` plans.
- `canonical_comment_read_required` is not closed by the reconciler comment-candidate index. The
  staff browser reads `production_comments` through the `production-comments` function and can make
  up to twenty sequential 50-row keyset requests per deliverable. That relation already has the
  matching `(deliverable_id, created_at desc, id desc)` partial index, but no live browser evidence in
  this window proves the amplified request chain reliable.
- The flip-critical lanes do not expose either unbounded shape. `linear-outbound-drain` uses a
  payload-free latest-summary lookup plus a time-bounded echo count; Graphics F2 evidence reads one
  terminal summary event by exact primary key. Neither performs a lifetime payload scan.

## Rollback

On any pre-COMMIT database failure, PostgreSQL rolls the required migration back and the workflow
stays disabled. Read back that all ten candidate objects are absent, revert repository source while
disabled, record the exact reverted `main` SHA, keep the isolated hourly V2 relief, then re-enable and
read back the reverted workflow and require one terminal-success run plus its reconciler summary.
Do not leave merged view-dependent source enabled without its database objects.

On a post-COMMIT proof failure:

1. disable `linear-deliverables-reconcile.yml` and require zero active runs;
2. if the optional index exists, drop only
   `public.deliverable_events_linear_comment_candidate_idx` with `DROP INDEX CONCURRENTLY`;
3. apply the owner-only rollback block at the end of the required migration (three views and seven
   functions; source rows remain untouched) and prove all ten objects are absent;
4. revert repository source while the workflow remains disabled and record the exact reverted SHA;
5. keep or restore the isolated hourly V2 relief before re-enabling the old unbounded reader; never
   return that reader to 15-minute n8n dispatches;
6. re-enable the reverted workflow, read back its state, and require one terminal-success run plus
   its summary before declaring rollback complete.

Rollback never changes runtime flags, authority, Linear objects, frozen writers, or the shared n8n
trigger cadence.
