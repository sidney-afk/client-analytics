# Deterministic create read-observation recovery preparation

This is preparation-only source and isolated evidence. No provider request, deployment, installation, activation, or sender execution was performed. Legacy batch/nonplanned create recovery remains required. Other uncertain operation types remain unresolved by this component.

## Source contract

The additive owner `supabase/migrations/20260913054339_provider_create_observation_recovery_preparation.sql` follows the reviewed `20260913051511_provider_create_recovery_preparation.sql`. It adds public observation/recovery RPCs and replaces the public ACK RPC to preserve observation evidence. It adds no private columns or tables and leaves the default outbound handler unchanged.

`production_provider_create_observe_v1` requires a closed current epoch, the original admitted deterministic issueCreate attempt, immutable outbox/context binding, original held lock, exact current outbox and previous observation CAS, and the exact source `SyncViewMirrorIssue` query with the planned issue UUID. It stores bounded raw HTTP/GraphQL observations in the existing private `provider_response` field. The attempt remains `admitted`; this is not a fabricated mutation ACK. Existing observations are retained in sequence. The `observed_at` field is database recording time, not a certified provider timestamp. Limits are 16 observations, 1 MiB per response, and 4 MiB aggregate history.

`production_provider_create_observed_recover_v1` requires a successful, non-error latest read containing the exact planned issue and source-derived create intent. It invokes the existing F203 identity-only linkage owner, preserves later native edits, writes the source `recovered_idempotently` receipt, and completes the tracked attempt in one transaction. Missing issues, transport/GraphQL errors, conflicting identity/intent, stale CAS, and malformed evidence remain unresolved. Repeat completion preserves the same receipt without another linkage audit. A late mutation ACK cannot overwrite the recorded observation history.

The helper pins the source read query, fixes the provider endpoint, rejects other queries/extra variables and redirects, uses a seven-second request deadline, and bounds response bytes. Its supplied authorization is never logged by this component. The SQL role trusts the approved observer transport to supply authentic provider responses; the envelope is not cryptographic provider attestation or proof of deployed runtime identity. External worker fencing and owner-window provider verification remain unproven. A drained tracked ledger alone does not authorize cutover.

## Reproduction

Use the protected portable runner with preinstalled PostgreSQL 17. Private database/log output stays outside the checkout.

```powershell
./qa/linear-exit-rehearsal/run-portable.ps1 -PgBin '<local PG17 bin>' -Lane provider-create-observation
node test/linear-exit-provider-create-observation-transport.mjs
```

The historical F203 SQL file is an explicit hashed prerequisite of this isolated scaffold. It is not a recommendation to replay a historical owner onto the observed installation baseline; the combined plan must preserve the observed current F203 definitions.

## Evidence

- `ISOLATED_POSTGRES`: receipt `022e0a15fb6041c19a4705b11c008db6`, exit 0, 11 checks, `LINEAR_EXIT_PROVIDER_CREATE_OBSERVATION_OK`; server stopped. Includes absence/error/conflict retention, four observations preserved, query/UUID refusal, stale CAS, actual held-attempt-row contention, late ACK refusal, whole-transaction rollback, exact source recovered receipt, repeat completion, and preserved later native edits.
- `OFFLINE_TEST`: eight transport checks passed. Exact query and request shape, fixed endpoint, mutation/extra-variable refusal, malformed/oversized body handling, and redirect refusal. Zero actual network/provider calls.
- Earlier narrower passing receipt `412df57d95ad4da7b751aded1336a660` remains prior evidence, not the final race/transport proof.

| Artifact | SHA-256 |
| --- | --- |
| New SQL owner | `f2c9a80e6bc4871c81f01e8659d587d23aa16dfc90ffa3ef388069ebc5066ee5` |
| Observation helper | `402ceae523145a5a929b371471bfe0058d53d251ded59f01294c1b8892f42a4e` |
| PostgreSQL test | `2f4522f452a858f8d9548a2c49b3cad5c5afc616f8bb523c8294c8d492a0713d` |
| Transport test | `5fd010ad3675fd260a04bd27c6247dae0842ac63cc571c1487838fcd6604602a` |
| Exact read query | `3b9dca6d2c4958575692c69ef6999a1659ff13edef22cd01b13e85559fd395dd` |

Combined installation/recovery integration is separate evidence. This slice does not prove complete provider recovery, complete installation, or hosted behavior.
