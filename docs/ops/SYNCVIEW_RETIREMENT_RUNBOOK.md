# SyncView retirement admission runbook

**Status: source-only.** Applying the migration installs an **active** gate; it does not stop admission or change any flag. The final release action is the server-side RPC below. Do not replace it with a client setting, a stopped outbound worker, a deleted queue row, or an n8n edit.

## What this closes

`linear_outbound_enabled = {"mode":"off"}` stops the drain. It does not stop the database RPCs for ordinary status, comment, due date, title, description, attachment, or provider-mode create work from inserting more `mirror_outbox` rows. The retirement trigger is on that common insert boundary, so a refusal rolls the owning mutation back atomically.

The gate permits only receipts whose earlier native guards have already proven their own typed terminal semantics:

| Kind | Required proof | Why it may pass after retirement |
| --- | --- | --- |
| Native intake | `_native_intake_epoch`, request marker, `status='skipped'`, and matching `linear_result.native_only/epoch` | The native write completed in the same server transaction; the receipt is its immutable evidence. |
| Native assignment | `_native_assignment_epoch`, `status='skipped'`, and matching `linear_result.native_assignment/epoch` | Same durable receipt identity, already checked by the assignment guard. |
| Native labels | catalog UUID marker, `status='skipped'`, and matching `linear_result.native_labels/catalog_version` | Same durable receipt identity, already checked by the label guard. |
| F27 drill | Reserved `__f27_drill__` TEST row with rollback ID and `f27_drill=true` | The installed F27 drill contract remains distinct from both native and provider work. |

No other TEST row, no provider receipt, and no bare `skipped` status is admitted. Existing exact retries remain the installed enqueue helper’s pre-insert idempotency result; a new ordinary insert is refused.

## Release sequence

1. Apply `migrations/2026-09-09-syncview-retirement-admission.sql` through the approved database release path. It aborts if the installed F27 and typed-native triggers are absent. Confirm the monitor reports `{"verdict":"dormant","ok":true}`.

2. Drain and verify the queue in the same release window. The activation RPC refuses any row whose status is `pending`, `failed`, or `shadow_ok`; do not waive that refusal. Inspect the aggregate census only:

```sql
select public.production_syncview_retirement_census();
```

3. Activate the boundary once, with the approved release reason:

```sql
select public.production_syncview_retirement_activate('linear-cutoff');
```

The function takes `mirror_outbox` in `share row exclusive` mode before recording the high-water. Writers already inside finish before that high-water; later writers wait and then read retired mode in the trigger. A concurrent ordinary mutation therefore cannot be accepted on the wrong side of the boundary.

4. Re-run the census and retain its aggregate result with the release evidence. Required retired values are `ordinary_post_cutoff_total = 0` and `nonterminal_total = 0`. `native_post_cutoff_total` and `f27_post_cutoff_total` may be nonzero because they are separately typed terminal receipts.

```sql
select public.production_syncview_retirement_census();
```

5. Confirm `.github/workflows/syncview-retirement-census.yml` completes green after activation. It is a read-only health check and must remain scheduled after the cutoff. Retire a main schedule only in that schedule’s own paired workflow/watchdog change; this contract does not disable schedules.

## Retry and recovery

Calling `production_syncview_retirement_activate('linear-cutoff')` again returns the same census. A different reason fails with `syncview_retirement_activation_conflict`, preserving the original release identity. A non-empty queue fails with `syncview_retirement_drain_required`; drain it and retry the same reason.

There is intentionally no unretire RPC in this migration. Reopening server admission changes the release boundary and needs its own reviewed recovery decision with the stored high-water and F27 state still intact.
