**Corrected 2026-09-21:** Historical record; its Linear workflow/topology statements describe the period recorded, not current operations. See the [cutoff record](LINEAR_CUTOFF_RUNBOOK.md) for the 2026-09-20 retirement (outbound and parity off; inbound remains; STEP 7 pending).

# External worker handover preparation

This is a procedure for a separately authorized operator window. No scheduler, n8n workflow, hosted function, credential or production row has been changed by preparing it. A closed database gate cannot undo a provider request already sent or stop an older worker that does not use the new admission ledger.

## Inventory and evidence

Start from the reviewed repository revision and reconcile it with the actual hosted inventory. Repository leads include `.github/workflows/linear-outbound-drain.yml`, `linear-sync-reconcile.yml`, `linear-deliverables-reconcile.yml`, `sample-linear-reconcile.yml`, `b1-linear-incremental-refresh.yml`, and the Linear inbound/outbound and workload functions. These are search leads, not a complete inventory or a declaration that each sends mutations. Include independently hosted schedulers, n8n, queued/manual runs, webhook ingress and any direct Linear clients discovered by the operator.

For every executable caller, retain privately: its immutable source/configuration identity, trigger and credentials owner, whether it reads Linear, mutates Linear or writes SyncView, maximum request/run lifetime, current runs, and the exact stopping mechanism. Classify unknown callers as unresolved. Public evidence contains only source hashes, sanitized counts and result categories. Never publish credentials, client names or share links.

## Ordered operator window

1. Obtain separate authorization for the concrete hosted actions. Capture current configuration, trigger state, active/queued runs and rollback information before changing anything.
2. Stop new external dispatch and enqueue paths using their actual control plane. Confirm every inventory entry with a readback of the applied configuration. A disabled repository file or a proposed change is not evidence that a hosted trigger stopped.
3. Close application admission with its expected epoch. Retain accepted-save and followup receipts. Wait for already running work to settle or stop it using the relevant host's supported operation; preserve each uncertain outcome. Process termination and elapsed time alone do not prove a remote request failed.
4. Reconcile every in-flight provider operation. For recorded attempts, use the prepared source-bound ACK/read recovery appropriate to that operation. For older unrecorded work, retain original evidence and use an explicitly reviewed source disposition or recovery path. Never manufacture an original admission row, replay blindly, or label unknown work successful. Reconcile durable card followup intents through their owning transactional recovery or a reviewed disposition, including failed/unknown outcomes and expired leases. Lease expiry is not completion.
5. Re-read the inventory and queues after the last possible pre-stop run. Require no caller able to launch a new unaccounted mutation, no unresolved provider attempts, no unresolved card followup debt and no Linear-bound work. Keep verified native and historical receipts. Missing execution history, an unknown run lifetime or an unclassified caller remains a hold.
6. Capture the reviewed database/object recovery material and independent custody evidence. Bind the private worker inventory, stop readbacks, reconciliation results and custody evidence to a single reviewed evidence artifact. Its hash records the operator's reviewed assertion; the switch RPC does not establish its truth.
7. Only after the separate activation decision, invoke the guarded switch while admission remains closed. Verify its retained receipt, then make the separately reviewed native reopen call. Confirm native saves and permanent provider-send refusal with the authorized acceptance checks. Do not re-enable an old Linear sender after retirement.

## Failure and recovery

Before activation, an incomplete stop or reconciliation leaves admission closed until the operator has reviewed a concrete recovery decision. Restoring old configuration must not overlap a new sender or erase accepted changes. After activation, use the prepared native recovery path; the old Linear reopen/re-enable path is not a rollback mechanism. Restore retains historical identity but starts closed, and requires fresh operator checks before reopening.

The completed handover record must identify the exact build and observed hosted identities, inventory closure, each stop/readback, disposition of every in-flight item, retained receipt counts, independent custody confirmation and the approving operator. Empty inventory or zero newly created ledger rows is not a substitute for this evidence. This procedure is preparation; actual inventory closure and hosted execution remain unproven until the authorized window.
