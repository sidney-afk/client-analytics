# Bounded Linear outbound cutoff prerequisite (G8)

**Status (2026-09-06): SOURCE + OFFLINE checks; disposable PostgreSQL rehearsal is opt-in. NOT installed, enabled, deployed, or global G8 proof.**

## Problem and bounded result

The `linear-outbound` worker currently claims and completes `mirror_outbox` rows with direct table updates. Runtime mode and authority checks happen after claim, but there is no server generation boundary between an old worker and a later cutoff. A delayed worker can therefore retain a lease across an operator decision.

`2026-09-06-linear-outbound-cutoff.sql` adds one inactive singleton control, generation and authorization fields, an enqueue-generation trigger, service-only claim/authorize/activate RPCs, and a stale-worker update guard. The Edge Function uses the claim RPC and obtains server authorization immediately before its provider mutation. Activation increments the generation and records the exact `max(id)` high-water observation while holding the same control row used by enqueue, claim, and authorization.

This is deliberately not a writer freeze. A native staff/client transaction that already owns an outbox receipt continues to commit during cutoff. Its receipt remains `pending`, is stamped `accepted_after_cutoff`, and cannot be claimed. It is classified debt, not deleted and not converted to `written`, `skipped`, or any invented success. Existing dedup keys remain the durable retry identities.

## Exact covered roots

| Root | Coverage |
|---|---|
| `linear-outbound` ordinary `mirror_outbox` claim | Replaced by `linear_outbound_claim_v1`; active/missing/drifted control refuses. |
| `linear-outbound` provider mutation | `linear_outbound_authorize_dispatch_v1` runs immediately before the mutation. A claim that serialized before cutoff is marked `claimed_before_cutoff`; if it already obtained dispatch authorization it is instead marked `authorized_before_cutoff`. Later authorization is refused. |
| Direct checkpoint/release updates by that worker | The row trigger refuses a lease from an older generation after cutoff, including delayed application/unlock. |
| Production comment outbox | Covered only because `production_comment_write` durably enqueues comments in the same `mirror_outbox` lane. Native `production_comments` storage remains independent and accepted. |
| Native deliverable/batch outbox receipts | Enqueue stays durable and idempotent; post-cutoff rows are held/classified instead of dispatched. |

A provider response lost after a pre-cutoff authorization is not called success by the cutoff. If its terminal database receipt committed, replay sees the existing terminal/dedup identity. If it did not commit, the row remains `authorized_before_cutoff` pending debt and stale application is refused; provider-side outcome reconciliation remains required before any later release.

## Explicit red holds / not covered

This is **not global Linear cutoff**. The following remain red and must be inventoried and closed before G8:

* provider reads made by `linear-outbound` before mutation construction, including viewer/issue/context reads;
* the F27 replay/drill RPC and its emergency provider path beyond the ordinary mutation authorization seam;
* `linear-inbound`, webhook delivery, parity and semantic reconciliation roots;
* browser calls, retained browser queues, `workload-linear`, other Edge Functions, and any direct provider HTTP path;
* all n8n schedules/workflows and credentials, GitHub Actions schedulers, provider tokens, account controls, and billing;
* external authority needed to stop webhook delivery, disable workflows, revoke credentials, or observe attempted egress.

No n8n/workflow/scheduler, credential, runtime flag, F27 fence generation, authority, frozen anonymous writer authentication, live data, or provider setting changes in this source slice. In particular, this does not touch `calendar-upsert` or `sample-review-upsert`.

## Installation, rehearsal, and recovery dependencies

Installation is held until the exact migration and matching `linear-outbound` source are reviewed, installed/deployed as one release window, source/readback verified, and the existing F27 install/recovery contract is reconciled with the added table, columns, triggers, and changed function dependency. Deploying only the Edge Function fails closed at claim; installing only SQL leaves the old direct claimant able to bypass the claim RPC, although the stale-worker guard still blocks post-cutoff application. Neither partial state is releasable.

The primitive starts inactive (`cutoff_enabled=false`, generation zero). There is intentionally no public or automatic re-enable RPC. Recovery must first reconcile every `authorized_before_cutoff` row against provider truth and classify every `accepted_after_cutoff` receipt without deleting it or manufacturing success. A later reviewed recovery delta may advance from an exact generation only after that debt manifest and compatible accepted-work rollback exist.

Run `node scripts/linear-outbound-cutoff-rehearsal.js` normally for an honest `UNPROVEN` skip. Against an explicitly owner-started disposable loopback PostgreSQL instance, set `G8_TEST_CONFIRM=LOCAL_DISPOSABLE_ONLY`, `G8_TEST_PSQL` to an absolute `psql`, and `G8_TEST_PORT`. The rehearsal creates and removes one random database; it never starts/stops a server or reaches external services. It proves two workers contending around cutoff, stale application refusal, lost-response replay behavior, native and feedback receipt survival, unavailable-control refusal, and exact receipt/debt conservation.
