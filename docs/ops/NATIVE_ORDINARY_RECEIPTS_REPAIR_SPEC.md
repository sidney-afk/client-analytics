# Native ordinary receipts repair specification

**Status: design gate, not an activation plan.** `SYNCVIEW_RETIREMENT_RUNBOOK.md` remains **NOT READY FOR ACTIVATION**. This document specifies the next bounded implementation that must land and be proven before `production_syncview_retirement_activate()` can be made executable.

## Problem and boundary

The current retirement admission trigger correctly refuses a fresh ordinary `mirror_outbox` INSERT once retired. That would also roll back the native business mutation because the present writers commit the business row/event and provider-shaped outbox receipt in one SQL transaction. A retirement implementation must preserve the business mutation by issuing a **server-owned, typed, terminal native receipt in that same transaction**. It must not change an ordinary receipt to `skipped` in a generic trigger or use `status='skipped'` as evidence.

Source trace:

| Owner/path | Evidence | Current result |
| --- | --- | --- |
| Production gateway ordinary entity route | `supabase/functions/production-write/index.ts:5700-6595` | `handleEntityOperation` sends ordinary non-assignee/non-label writes to `production_deliverable_write` at `:6545`. |
| Deliverable authoritative wrapper | `migrations/2026-07-12-write-ui-outbox-parity.sql:242-297` | Checks authority, exact replay, advisory dedup, row CAS, then calls `deliverable_write`; it owns the right transaction boundary. |
| Batch authoritative wrapper | `migrations/2026-07-12-write-ui-outbox-parity.sql:300-360` and gateway `index.ts:6627` | Same provider receipt shape for batch writes. |
| Comment add | gateway `index.ts:5938-6205`; `migrations/2026-07-23-production-comment-thread-lifecycle.sql:217-350` | Normalizes the comment, inserts the native mutation receipt, then enqueues provider `comment`. |
| Comment lifecycle | gateway `index.ts:6237`; `migrations/2026-07-23-production-comment-thread-lifecycle.sql:440-620` | Edit/delete enqueue provider `comment`; resolve/unresolve currently have no outbox completion receipt. |
| Existing native pattern | `migrations/2026-09-06-native-existing-assignment.sql:82-120,134-175`; `migrations/2026-09-06-native-label-writes.sql:100-180`; `migrations/2026-09-05-native-only-intake.sql:80-134` | Typed marker, scope/epoch validation, terminal result, receipt retention, exact replay, and native row/event/receipt atomicity. |

## Required capability contract

Add one explicit, service-only capability, for example `production_native_ordinary_receipts()`, with a versioned per-team value. It must be separate from intake, assignment, labels, `prod_authority`, and F27 generation. The value needs these states:

| State | Fresh ordinary mutation | Exact accepted native replay | Existing provider receipt |
| --- | --- | --- | --- |
| `provider` | Preserve the present provider receipt and drain behavior exactly. | Return the existing provider result by existing identity rules. | Preserve as provider history; never relabel or requeue. |
| `native` with nonempty epoch | Admit only listed operations and issue a typed terminal receipt. | Read and validate original marker/identity, return current scoped state, apply no second mutation. | Preserve as provider history; do not adopt it as native. |
| `hold` | Refuse before native row/event/outbox changes. | Allow exact prior native receipt adoption only. | Do not restart provider drain. |

Malformed, missing, or unreadable capability state is a visible refusal. It is never a provider fallback. The capability reader locks its flag row `FOR SHARE` through the mutation transaction; a mode/epoch change waits for the accepted transaction or causes the fresh request to refuse.

### Operation allowlist

The capability must use an explicit allowlist owned by each writer, not `operation != 'create'`.

| Writer owner | Operations that need typed native receipts | Exclusions / separate owner |
| --- | --- | --- |
| `production_deliverable_write` | `status`, `due`, `title`, `priority`, `archive`, `restore`, `parent`, `description`, `attachment` | `assignee` stays in `production_assignee_write`; `labels` stays in `production_labels_write`; `create` stays in the intake contract. |
| `production_batch_write` | Only actual supported non-create batch operations after tracing its outbound envelope | Batch creation remains intake/provider-specific; no inferred batch operation is allowed. |
| `production_comment_write` | `comment` add/reply | Preserve normalized body, comment ID, audience and existing native-comment identity. |
| `production_comment_lifecycle_write` | `comment` edit/delete; resolve/unresolve need a durable native completion receipt even though they do not currently enqueue | Do not manufacture a Linear comment for resolve/unresolve. |
| Crosswalk/import repair | None by default | `migrations/2026-09-05-crosswalk-bind-and-import.sql:351` directly calls the helper for a provider-side eviction. It needs its own reviewed disposition, never a blanket capability bypass. |
| F27 drill | None | Keep its reserved typed TEST receipt separate. |

No client-facing or tokenless writer is changed. TEST and legacy-parity/provider paths are excluded from fresh native ordinary admission unless a later explicit contract says otherwise; they must not borrow the native marker.

## Receipt proof and immutable identity

For each allowed fresh mutation, the owning SQL wrapper must add a marker generated only after it has passed its own authoritative checks:

```text
_native_ordinary_receipt: {
  schema: 1,
  epoch: <server-read capability epoch>,
  owner: <deliverable|batch|comment>,
  operation: <exact allowed operation>
}
linear_result: {
  native_ordinary: true,
  epoch: <same epoch>,
  owner: <same owner>,
  operation: <same operation>
}
status: skipped
```

This typed receipt means *the native row/event mutation committed*; it does not mean Linear mirrored it. The marker must be written by the owning wrapper or its operation-specific guard after validation, never by a generic retirement trigger and never from a caller payload.

The guard must require all of the following before terminalizing:

1. Current server authority plus the current F27 generation/hold checks for fresh work.
2. The applicable capability is `native` and its locked epoch equals the server-issued marker.
3. Entity, target, team, actor, role, `test_only=false`, `legacy_parity=false`, dedup key, and `_intent_fingerprint` exactly match the owner’s accepted envelope.
4. The marker owner and operation are in that owner’s allowlist.
5. The native row/event/comment mutation is in the same SQL transaction and its row CAS/version checks passed.

The native receipt cannot be updated, deleted, truncated, requeued, or converted into provider work. Its marker, terminal status, and result are immutable. Exact replay must first compare the original full identity and fingerprint, then return current scoped state without a second business mutation, event, provider call, or drain. A changed actor, target, payload, operation, team, role, epoch, test/parity scope, or fingerprint is `idempotency_conflict`.

`service_role` direct `mirror_outbox` INSERT is **not proof**. The implementation must keep the production table’s service workflow working until the ordinary provider paths are retired, but direct insertion may never produce `_native_ordinary_receipt` or terminalization. Once the new owner wrappers are installed and all direct writers are accounted for, service direct mutation can be separately revoked behind an exact replacement plan; it cannot be revoked early because the current outbound worker updates `mirror_outbox` directly.

## Required transaction and lock order

Keep the installed order rather than adding an independent trigger lock that can deadlock it:

1. `public.production_assert_authority(...)` obtains the established `mirror_outbox` row-exclusive/table-to-flag-to-fence order (`migrations/2026-07-20-f27-team-rollback.sql:2480-2510`).
2. Acquire the dedup advisory lock and inspect the existing receipt (`production_outbox_replay`; `migrations/2026-07-12-write-ui-outbox-parity.sql:120-190`). Exact retained-native replay returns here after identity validation.
3. Lock the ordinary capability row `FOR SHARE`, then validate its epoch and owner operation.
4. Acquire the existing target advisory lock and row lock/CAS. The deliverable pattern is `production-deliverable:<id>` then `FOR UPDATE` (`2026-07-12-write-ui-outbox-parity.sql:284-295`); comments retain their comment-row/version lock (`2026-07-23-production-comment-thread-lifecycle.sql:497-525`).
5. Write the native row, event/journal, and typed terminal outbox receipt. The existing F27 trigger must run before the new ordinary-native receipt guard; the new guard terminalizes only after its own proof.

Any rejection, event/journal failure, receipt failure, stale CAS, flag/epoch change, or F27 hold/generation mismatch rolls back **all** row/event/receipt changes. The retirement activation can only take `mirror_outbox` `SHARE ROW EXCLUSIVE` after every owner wrapper follows this order; it records the high-water after pre-boundary writers finish and makes later writers see the retired gate.

## Provider-era and F27 preservation

- Existing provider receipts remain provider receipts through native/hold/retired transitions. They must retain their original payload, generation, status, dependencies, and replay identity; no migration mass-updates them to `skipped`.
- F27’s installed `track_b_f27_hold_guard` and generation binder stay first in the receipt chain (`migrations/2026-07-20-f27-team-rollback.sql:2390-2465`). The reserved `__f27_drill__` shape remains the only F27 exception and never becomes an ordinary native receipt.
- Native receipt guards must not weaken F27 replay/drill identity, and F27 recovery may not treat a terminal ordinary-native receipt as a provider delivery.
- Native/provider/TEST census buckets remain disjoint. A row yielding NULL for a recognizer is ordinary until explicitly proven otherwise; every census predicate uses `coalesce(recognizer(row), false)`.

## Proof required before enabling retirement

1. **Actual PostgreSQL tests:** a disposable cluster executes the new migration with the current F27/native prerequisites. Each allowed operation proves one native row/event and one terminal typed receipt commit together; injected event, journal, outbox, flag-read, CAS, and F27 failures leave all three unchanged.
2. **Identity and replay tests:** exact response-loss retries return the current scoped row with no extra row/event/receipt; each changed identity field conflicts. Later human mutations survive replay. Provider-era receipts retain provider behavior and never adopt a native epoch.
3. **Race tests:** overlapping mutation versus capability flip/hold, F27 hold/generation change, and retirement activation all prove no cross-boundary accepted ordinary row and no deadlock. The activation path must retain the actual high-water and report zero ordinary rows above it.
4. **No Linear network tests:** run the actual `production-write` handler/SQL paths for every native ordinary operation with all Linear calls refused; no request to `api.linear.app`, upload host, or Linear webhook may occur. Then run the repository’s `SYNCVIEW_QA_LINEAR_DEAD=1` rehearsal for the relevant Calendar/Samples/Production flows. The source harness blocks the API host at `qa/sxr_courier_lib.js:609-618`; a healthy mock is not proof of dead-provider survival.
5. **Monitoring proof:** the retirement census is a completion monitor, not a debt alarm. Before activation it may report `dormant`; after activation it must fail on ordinary-post-high-water or any nonterminal row. `outbox-debt-census` is the separate pre-activation/provider-debt alarm and remains responsible for pending/failed/shadow_ok aging. The dead-man watchdog monitors whether either checker ran; it does not prove the check passed. Keep these three signals separate.
6. **Manual completion evidence:** capture aggregate high-water census before and after activation, per-operation native receipt counts, zero ordinary post-cutoff count, zero nonterminal count, and exact deployed SQL/function hashes. Do not log client slugs, receipt keys, payloads, or display names.

## Definition of done

Only after every owner row in the allowlist has the proof above may a reviewed change replace the blocked activation RPC. That change must update `SYNCVIEW_RETIREMENT_RUNBOOK.md`, remove the not-ready state, and add the operation-specific tests in the same commit. It must not modify n8n, frozen tokenless client writers, deployment workflow ownership, or existing F27 recovery contracts as a shortcut.
