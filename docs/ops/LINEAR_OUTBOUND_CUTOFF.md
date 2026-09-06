# Bounded Linear outbound cutoff prerequisite (G8)

**Sept6 source follow-up:** the ordinary worker now authorizes every provider read and mutation at its single transport boundary, and an empty queue never resolves the provider viewer. Exact evidence and limits: [read cutoff correction](../audits/2026-09-06-outbound-read-cutoff.md), 34 actual handler/SQL groups plus 33 offline checks. This supersedes the historical read-path gap below only for the new source. Old deployed isolates can still read and must quiesce; a grant preceding cutoff remains in flight. Installation, serving and global G8 remain held. The retained sections below describe the earlier SQL/mutation prerequisite and its dated proofs.

**Status (2026-09-06): 13 actual disposable PostgreSQL/gateway/worker-helper groups and 12 offline controls pass after independent correction. NOT installed, enabled, deployed, or global G8 proof.**

## Problem and bounded result

The `linear-outbound` worker currently claims and completes `mirror_outbox` rows with direct table updates. Runtime mode and authority checks happen after claim, but there is no server generation boundary between an old worker and a later cutoff. A delayed worker can therefore retain a lease across an operator decision.

`2026-09-06-linear-outbound-cutoff.sql` adds one inactive singleton control, generation and authorization fields, an enqueue-generation trigger, service-only claim/authorize/activate RPCs, and a stale-worker update guard. The Edge Function uses the claim RPC and obtains server authorization immediately before its provider mutation. Activation increments the generation and records the exact `max(id)` high-water observation while holding the same control row used by enqueue, claim, and authorization.

Native-only gateway receipts remain terminal `skipped` with their original identities and are not counted as outstanding provider debt. A client feedback transaction that still emits a provider mirror receipt commits its native comment/mutation receipt; its mirror remains `pending`, is classified `accepted_after_cutoff`, and cannot be claimed. No debt is deleted or converted to invented success. Generation stamping runs after the native receipt classifiers.

## Exact covered roots

| Root | Coverage |
|---|---|
| `linear-outbound` ordinary `mirror_outbox` claim | Replaced by `linear_outbound_claim_v1`; active/missing/drifted control refuses. |
| `linear-outbound` provider mutation | `linear_outbound_authorize_dispatch_v1` runs immediately before the mutation. The service-only debt census derives `claimed_before_cutoff` or `authorized_before_cutoff` from retained facts. Activation changes only control, preserving every accepted queue row. Later authorization is refused. |
| Direct checkpoint/release updates by that worker | The row trigger refuses a lease from an older generation after cutoff, including delayed application/unlock. |
| Production comment outbox | Covered only because `production_comment_write` durably enqueues comments in the same `mirror_outbox` lane. Native `production_comments` storage remains independent and accepted. |
| Native deliverable/batch outbox receipts | Native-only terminal receipts and exact retries stay unchanged; any still-provider mirror intent remains explicit pending debt. |

A provider response lost after a pre-cutoff authorization is not called success by the cutoff. If its terminal database receipt committed, replay sees the existing terminal/dedup identity. If it did not commit, the row remains `authorized_before_cutoff` pending debt and stale application is refused; provider-side outcome reconciliation remains required before any later release.

## Explicit red holds / not covered

This is **not global Linear cutoff**. The following remain red and must be inventoried and closed before G8:

* provider reads from old deployed `linear-outbound` isolates, including their unconditional viewer: the source follow-up above requires exact deployment/readback and old-worker quiescence before this hold can clear;
* F27 emergency provider replay beyond its retained snapshot, evidence-bound classification, and SQL-only drill terminal; the cutoff permits no ordinary F27 requeue, provider authorization, or provider dispatch;
* `linear-inbound`, webhook delivery, parity and semantic reconciliation roots;
* browser calls, retained browser queues, `workload-linear`, other Edge Functions, and any direct provider HTTP path;
* all n8n schedules/workflows and credentials, GitHub Actions schedulers, provider tokens, account controls, and billing;
* external authority needed to stop webhook delivery, disable workflows, revoke credentials, or observe attempted egress.

No n8n/workflow/scheduler, credential, runtime flag, F27 fence generation, authority, frozen anonymous writer authentication, live data, or provider setting changes in this source slice. In particular, this does not touch `calendar-upsert` or `sample-review-upsert`.

## Installation, rehearsal, and recovery dependencies

Installation is held until the exact migration and matching `linear-outbound` source are reviewed, installed/deployed as one release window, source/readback verified, and the existing F27 install/recovery contract is reconciled with the added table, columns, triggers, and changed function dependency. Deploying only the Edge Function fails closed at claim. With SQL installed, the corrected update guard also refuses a fresh lease from the unchanged old direct claimant after cutoff; it preserves only F27 snapshot/hold, a transition whose persisted rollback-intent row hash matches the pre-transition queue row, evidence-bound classification, and the existing drill's `no_external_call` terminal. It does not admit ordinary F27 requeue or emergency provider replay. This bounded control does not make a partial release ready. The new control owner is outside selected37 recovery and must be included in an explicit compatible recovery extension before installation. Source closure pins must be recomputed on the combined release candidate.

The primitive starts inactive (`cutoff_enabled=false`, generation zero). There is intentionally no public or automatic re-enable RPC. Recovery must first reconcile every `authorized_before_cutoff` row against provider truth and classify every `accepted_after_cutoff` receipt without deleting it or manufacturing success. A later reviewed recovery delta may advance from an exact generation only after that debt manifest and compatible accepted-work rollback exist.

Run `node scripts/linear-outbound-cutoff-rehearsal.js` normally for an explicit skip. With an owned disposable loopback PostgreSQL instance, set `G8_TEST_CONFIRM=LOCAL_DISPOSABLE_ONLY`, `G8_TEST_PSQL` to an absolute `psql`, `G8_TEST_PORT`, and its synthetic password. The rehearsal creates and retains one random database and private evidence; it never starts/stops a server or reaches external services. The discovered unit wrapper requires this actual lane under CI's existing explicit F63 binding. No hosted result is anticipated.

## Correction evidence and monitoring obligation

Imported cloud source is preserved at `7514281aad4cef7f5baebdc47fa54cbec5a57d96`. Its replacement real-schema proof produced 9 PASS / 2 FAIL: the old worker could obtain a new lease after cutoff, and native terminal receipts were classified as provider debt. The correction also removes activation's transaction-local exception and its queue-row updates. An independent review found table/control lock-order and missing-control false-empty census gaps; explicit table locks now precede control in claim/authorize/activation, and the census function raises when control is absent, including instead of returning an empty result.

Final actual result: 13 PASS / 0 FAIL with zero external requests. SQL SHA-256 `a706c7107d935e98f8520b98e1acaa6b648c07077fce1b964d421e0e0686709e`; worker source `ade50181c0bf79bc1bf81a774b0bff5b641213347b601a69cb2679a75cd13f28`; private report `12f1a405b539d2f904fb76682a50e05e1b55acc0d37ff25fb770b1723f281dee`. Actual concurrent sessions observe blocked table and enqueue locks, prove unchanged queue images across activation, retain native gateway acceptance/retry and client-comment receipts, and reject unavailable control. The lock-order cases use an F27-shaped table lock; they are not a full F27 rollback drill. A prior 10/1 correction run contains a fixture-only nested `SET ROLE` syntax error and is retained separately.

Before activation, an independent scheduled service reader must compare the census with the full outbox population, monitor receipt/debt growth and serving version, and deliver a deliberately failed-check notification to the owner's SyncViewbot Slack DM plus a separately verified missed-run fallback. It must treat a census error or missing control as failure, never zero debt, and publish counts/codes only. This requires operational scheduling/delivery work and is INACTIVE here. The census cannot prove absence of provider reads, other queues, other runtimes or a previously authorized network request; global egress evidence remains separate. Clients see no change while this draft is unapplied.
