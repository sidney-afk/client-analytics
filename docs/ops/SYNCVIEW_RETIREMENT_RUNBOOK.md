# SyncView retirement admission runbook

**Preparation only; activation remains blocked.** The current source always
refuses `production_syncview_retirement_activate(text)`. Ordinary native receipts
and their retirement recognizer are now implemented; the remaining refusal is
not evidence that those source components are absent. Nothing in this runbook
merges, deploys, enables retirement or authorizes a hosted write.

## Current receipt capability

Use `NATIVE_ORDINARY_RECEIPTS_OWNER_MATRIX.md` for writer ownership and the exact
operation allowlist. The prepared source includes:

| Mutation family | Prepared completion contract | Retirement preparation limit |
| --- | --- | --- |
| Intake | Existing typed native intake receipt | Preserve its guard and exact replay. |
| Assignee | Existing typed native assignment receipt | Preserve its separate epoch. |
| Labels | Existing typed catalog receipt | Preserve its catalog/version binding. |
| Status, due, title, priority, archive, restore, parent, description, attachment | Typed ordinary receipt and immutable admission ledger | Source and isolated evidence exist; hosted capability is not inferred. |
| Comment add/reply/edit/delete/resolve/unresolve | Typed ordinary completion and lifecycle repair | Preserve durable identity/replay and the installed owner order. |
| Batch description and asset | Native row/event mutation without an outbox insert | Description is coordinated through the shared authority lock; asset coverage needs its own proof. |
| Other ordinary batch operations | Gateway refusal | Do not invent a provider bypass. |
| F27 reserved drill | Separate typed TEST receipt | Preserve the installed safety contract. |

`2026-09-10-syncview-retirement-native-ordinary-recognizer.sql` extends the
original recognizer to ordinary native receipts. Its inclusion and typed/malformed
receipt checks are in the prepared source and isolated tests. The activation RPC
in `2026-09-09-syncview-retirement-admission.sql` still unconditionally raises
`syncview_retirement_native_receipt_contract_required`; that error name is retained
for compatibility, not used here as a current missing-component diagnosis.

## What the outbox boundary does and does not cover

Stopping the outbound drain does not stop database writers. The retirement trigger
checks newly inserted outbox rows and refuses unsupported provider-shaped work;
its refusal rolls that owning transaction back. Accepted typed native receipts
remain immutable completion evidence. Exact retries retain their owner semantics.

A `SHARE ROW EXCLUSIVE` lock on `mirror_outbox` coordinates that table's writers.
Whole-application freeze coverage remains unproven. A writer can participate
in this lock through a shared guard even without inserting an outbox row:

| Path | Source owner | Needed boundary evidence |
| --- | --- | --- |
| Batch description | `2026-09-01-batch-description-cas-timestamptz.sql` | The isolated RPC blocks through `production_assert_authority`, which requests an outbox `ROW EXCLUSIVE` lock. |
| Batch asset | `2026-08-31-batch-asset-client-slug-insert-arm.sql` | Trace the shared authority guard and prove its scoped row/event boundary independently. |
| Calendar | Frozen `calendar-upsert` handler | Account for business-row/comment and separate event writes. |
| Samples | Frozen `sample-review-upsert` handler | Account for business-row/comment and separate event writes. |

The attempted description counterexample in isolated PG17 receipt
`930a5627` failed with a lock timeout in `production_assert_authority`.
It did not demonstrate a write crossing the held lock. Preserve that failure;
absence of an outbox insert does not imply absence of lock participation.

This is a minimum boundary-review list, not a complete caller census. Do not edit
or re-gate the frozen handlers to make a preparation test pass. A future reviewed
freeze must cover browser, stale-tab, retry, service and automation writes, with
explicit refusal and no partial accepted business/event state. Every write
accepted before the cutoff must be included in the final snapshot or a proved
delta handover. A human request to stop typing is insufficient.

## Reconcile B5 acceptance before activation

The B5 checklist currently says a retired TEST mutation creates zero outbox rows.
The prepared architecture intentionally retains typed terminal native receipts
in that table. These are different criteria. Do not mark the literal zero-row
box complete merely because provider debt is zero.

Proposed release-plan criterion: zero new provider-bound work and zero unresolved
provider debt, with only validated immutable native completions and the distinct
F27 contract permitted. The owner must ratify the final criterion in the later
implementation plan, or the implementation must meet the existing literal gate.
This preparation document does not silently change the approved checkbox.

## Future owner-run release prerequisites

Keep the activation RPC refusing while preparing the full freeze/race, final
snapshot/delta and recovery contract. Source-exact installation, serving/config
readback, archive/object completeness, notification handover and each teardown
inverse remain separate gates in `GO_LIVE_CHECKLIST.md` Phase5 and the recovery
checkpoint. No local test substitutes for their hosted evidence.

A later authorized window must follow the canonical B5 order: enforce the freeze,
classify and disposition final provider work, prove the scoped debt result,
disable normal outbound, perform a detect-only reconcile, finish archive/export,
and only then activate/read back the reviewed retired epoch. Any difference or
new provider intent aborts that progression under the freeze. Do not dispatch
or run these steps during preparation.

After authorized activation, aggregate census and an independent observer must
verify the boundary. Preserve `ordinary_post_cutoff_total`, `nonterminal_total`,
`native_post_cutoff_total` and `f27_post_cutoff_total` distinctions. A census query
is not proof that every outside-outbox writer was frozen. There is no generic
unretire RPC; reopening admission needs its own reviewed recovery decision.

Detailed source boundaries, deferred-request drain requirements and pending race matrix: [final freeze preparation](LINEAR_EXIT_FINAL_FREEZE_PREPARATION.md). This is a design contract, not activation authorization.
