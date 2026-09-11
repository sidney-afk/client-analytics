# Native sign-off reconciler compatibility contract

Preparation specification; unbuilt. Installation HOLD. No merge, deployment,
workflow execution, live repair or frozen-writer change is authorized here.
The upstream 165-check suite covers the carried reconciler, not this extension.

## Problem and selected approach

The carried reconciler requires carrier status written for repair eligibility.
An ordinary native approval intentionally has status skipped, so it remains
report-only even when the client's native write committed. Do not accept all
skipped receipts or infer approval from a current deliverable status.

Use a narrow service-only read-only attestation RPC over actual database rows.
The ordinary admission table revokes service_role access; preserve that boundary.
Do not grant general SELECT or let a request supply its own admission evidence.
The structural retirement recognizer is insufficient for this consumer because
it does not itself join the protected admission ledger.

## Required database verification

Input is a bounded list of actual outbox receipt IDs. Reject oversized or invalid
input explicitly; do not truncate and return an apparently complete answer.
Keep IDs lossless through JSON/JavaScript (decimal strings for bigint identities).
Return a result for each requested identity, with a minimal verified binding or
an explicit unverified outcome; no actor names, comment contents or ledger dump.
The precise batch cap and response schema must be pinned in implementation tests.

For a verified native approval require all of the following from database rows:

- Receipt status skipped, entity deliverable, operation status, payload status
  approved, role client, test_only false and legacy_parity false.
- An ordinary marker with schema 1, owner deliverable, native operation status,
  a valid token and epoch, joined to the admission token AND receipt_id.
- Admission owner/entity/native operation/receipt operation match that scope.
  Match entity ID, client, team, actor, role, dedup key, intent fingerprint and
  exact source_edited_at to the actual receipt, using database timestamp equality.
- Marker epoch and linear_result native_ordinary/epoch/owner/operation match the
  joined admission. Null or contradictory bindings do not verify.

Use the existing write guard as the binding authority:
2026-09-09-native-ordinary-receipts.sql (admission table and insert guard), with
2026-09-11-native-ordinary-receipt-repair.sql and
2026-09-12-native-ordinary-envelope-repair.sql supplying final ownership behavior.
An old admitted epoch remains historical evidence after the current epoch changes;
current write authorization is a separate check. The verifier performs no writes.
Restrict execution to service_role; anon/authenticated/public must not gain access.

## Reconciler integration

Both the initial outbox read and pre-write revalidation must retain actual receipt
IDs and request fresh database attestation. A verified binding must correspond to
the exact receipt used for the planned stamp, including client/entity and clock.
Never trust a cached local boolean, a payload marker, or fixture-provided JSON as
hosted attestation. Missing/unavailable verifier means an explicit native repair
refusal; it must not become a fallback to structural-marker acceptance.

Retain provider-written behavior and every existing crosswalk, component, current
card status, supersession and later-reopen check. Continue using the client's
committed clock for the stamp. Revalidation must discard the plan if its receipt
identity or verified binding changes. Detection of change requests remains
report-only; this work does not widen WRITABLE_KINDS or repair caption legs.

## Required evidence before claiming compatibility

1. Isolated PostgreSQL: an actual native client status-write produces a receipt
   and admission accepted by the verifier. Verify service-only execution and
   unchanged database rows before/after lookup; no direct ledger SELECT grant.
2. Reject forged marker, missing admission, another receipt's token, wrong client
   or entity, unbound receipt_id, mismatched owner/operation/epoch/result,
   timestamp/fingerprint/actor mismatch, TEST/parity and ordinary provider-skipped
   rows. Crafted superuser corruption is a negative fixture, not a supported API.
3. Offline reconciler: admitted native approval reaches stamp planning, while a
   later reopen/current card mismatch still refuses. Provider cases retain their
   behavior. Missing verifier and incomplete verification cannot plan native writes.
4. Pre-write path: replace the receipt or attestation after planning and prove
   no Calendar call occurs; verify the unchanged binding positive path.
5. Execute the real integrated reader/verifier/detector against isolated SQL.
   Mocked attestation alone is not end-to-end native compatibility evidence.

The verifier does not make the final Calendar write atomic with its preceding
reads. That existing race and the admitted-request drain remain separate HOLD
gates in LINEAR_EXIT_FINAL_FREEZE_PREPARATION.md. Do not present this extension
as proof of hosted installation, whole-application freeze or retirement readiness.
