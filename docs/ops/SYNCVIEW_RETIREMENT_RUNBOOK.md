# SyncView retirement admission runbook

**Status: source-only — NOT READY FOR ACTIVATION.** Applying the migration installs an **active** gate and read-only census; it does not stop admission or change any flag. The activation RPC intentionally refuses until ordinary native mutations have server-issued typed receipts. Do not replace that missing contract with a client setting, a stopped outbound worker, a deleted queue row, or an n8n edit.

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

## Current capability matrix

| Mutation family | Current receipt | Safe after retirement? | Required work |
| --- | --- | --- | --- |
| Intake create | Typed native intake epoch and terminal result | Yes | Existing contract; preserve it. |
| Assignee | Typed native assignment epoch and terminal result | Yes | Existing contract; preserve it. |
| Labels | Typed native catalog version and terminal result | Yes | Existing contract; preserve it. |
| Status, due, title, priority, archive, restore, parent | Provider-shaped `mirror_outbox` receipt from `production_deliverable_write` | **No** | Issue a server-owned native epoch/receipt inside the same wrapper transaction. |
| Description, attachment | Same provider-shaped deliverable receipt | **No** | Same server-owned native receipt work. |
| Comment add/edit/delete | Provider-shaped `mirror_outbox` receipt from comment write/lifecycle RPCs | **No** | Add an equivalent typed receipt to both comment transactions. |
| Comment resolve/unresolve | Native lifecycle mutation with no outbox receipt | **Not proven** | Define durable native completion/replay evidence before activation. |
| Batch ordinary mutation | Provider-shaped batch receipt | **No** | Add a typed batch receipt or retain an explicit provider path. |
| TEST/provider receipts | Provider-shaped, even when TEST | No | TEST never bypasses retirement admission. |
| Reserved F27 drill | Reserved rollback-id typed TEST receipt | Yes | Existing contract; preserve it. |

The current trigger would reject the unsupported rows rather than create hidden debt, which correctly protects the queue but rolls their transaction back. That is why the activation RPC is intentionally blocked.

## Future release sequence (after the matrix is complete)

1. Apply `migrations/2026-09-09-syncview-retirement-admission.sql` through the approved database release path. It aborts if the installed F27 and typed-native triggers are absent. Confirm the monitor reports `{"verdict":"dormant","ok":true}`.

2. Drain and verify the queue in the same release window. The activation RPC refuses any row whose status is `pending`, `failed`, or `shadow_ok`; do not waive that refusal. Inspect the aggregate census only:

```sql
select public.production_syncview_retirement_census();
```

3. Replace the blocked activation RPC only after every unsupported row above has a server-owned typed receipt and an exact replay test. The future activation must take `mirror_outbox` in `share row exclusive` mode before recording the high-water. Writers already inside finish before that high-water; later writers wait and then read retired mode in the trigger. A concurrent ordinary mutation must therefore either get its typed native receipt or be refused before its business mutation commits.

4. Re-run the census and retain its aggregate result with the release evidence. Required retired values are `ordinary_post_cutoff_total = 0` and `nonterminal_total = 0`. `native_post_cutoff_total` and `f27_post_cutoff_total` may be nonzero because they are separately typed terminal receipts.

```sql
select public.production_syncview_retirement_census();
```

5. Confirm `.github/workflows/syncview-retirement-census.yml` completes green after activation. It is a read-only health check and must remain scheduled after the cutoff. Retire a main schedule only in that schedule’s own paired workflow/watchdog change; this contract does not disable schedules.

## Retry and recovery

At present, `production_syncview_retirement_activate(...)` always fails with `syncview_retirement_native_receipt_contract_required`. This is the expected result until the capability matrix is complete; it performs no flag, queue, or business-row mutation.

There is intentionally no unretire RPC in this migration. Reopening server admission changes the release boundary and needs its own reviewed recovery decision with the stored high-water and F27 state still intact.
