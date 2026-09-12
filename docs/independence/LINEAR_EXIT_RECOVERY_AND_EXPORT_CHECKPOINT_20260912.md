# Recovery and export preparation checkpoint

Historical checkpoint: read `LINEAR_EXIT_CONSOLIDATED_CHECKPOINT_20260912.md` for the later seven-owner preparation and remaining gaps.

This advances the earlier atomic-save checkpoint. It does not complete the build
or authorize installation. The original owner boundaries and tokenless serving
contracts remain unchanged. No hosted saves, installation, merge or n8n execution.

## New database owners

The fifth owner adds the approved transactional claim protocol and recovery of
failed, expired or unknown attempts. Recovery first locks the task, so an active
effect transaction must commit or roll back before the decision. A completed task
is returned unchanged; a retry receives a fresh attempt and lease. Legacy claims
without the protocol marker refuse recovery. The old claim RPC is no longer
executable by service_role. The marker binds a protocol, not deployed worker identity;
release still needs to fence legacy workers and verify the actual runtime.

- Source: `20260912193102_followup_transactional_retry_preparation.sql`.
- SHA-256: `95804e6978f98fa251fad73bfa9c009d4ec46e70d42b77f30cb965cc577cf33e`.
- PG17 retry receipt: `4b4dd8148fa34d898d985d67521af07f`.
- Seven refusal controls and actual held-row COMMIT/readback and ROLLBACK races pass.

The sixth owner creates an exact existing F27 snapshot while admission is closed.
It reuses the original F27 owner with a protected transaction context and exact
team/authority/row preimages. Only the intended rollback, snapshot intents and held
outbox rows can change. Existing guard branches are byte-identical after removing
the new snapshot branch. Its receipt explicitly reports external-worker fencing
as false. It does not replay provider work or claim provider success.

- Source: `20260912193957_provider_closed_snapshot_preparation.sql`.
- SHA-256: `cdfbd974375381a273f314e0089790780a60423eaac39473c683845ff177768f`.
- PG17 snapshot receipt: `f3beecdecfa542e69451557841cf597e`.
- Two exact rows, eight refusal controls, late rollback, other-team preservation
  and subsequent closed-gate discard pass.

## Final six-owner acceptance

| Check | Receipt | Result and limit |
| --- | --- | --- |
| Actual Deno/helper/SQL worker | `23bade37f0214036bf059683ed2c614d` | Six completions, actual graphic effects, fault rollback and stale refusal; six SQL and nine runtime files bound before/after; external bytes synthetic |
| Admission preflight | `2b4030b9760e4b9683ba47ee3454b303` | 20 functions, four private tables, 173 triggers; six actual catalog mutation refusals, including regranting the legacy claim |
| Complete application V2 recovery | `6f4816c89028413697b2b481bf58d0e9` | 90 tables, 89 populated, empty transaction context; exact schema/rows and retained failed second attempt/history; corruption rollback and encrypted reopen |

All three portable servers stopped. The final encrypted application artifact hash
is `2539576071765e5db43283b46a40a71202e497c117b6daf5262aac6d1c9ae390`.
Operational key custody and hosted restoration remain unproven. Earlier four/five
owner receipts remain historical evidence, not this final six-owner composition.

The six-owner source extension hash is
`984a5b08f3081154a845ee0af35f4074660993f7188caa661fff58af441e835c`.
The writer bundle retains the same candidate handler bytes. The updated private
worker bundle passes Deno type checking with the frozen lock. The portable check
uses the generated function directory with no inherited configuration and
`--node-modules-dir=none`; no endpoint or schedule was installed.

## Read-only Storage transport and metadata

The new adapter connects the existing encrypted export engine to Storage's bucket,
folder listing, object info and authenticated download APIs. Capture hashes actual
streamed bytes, checks version/size, and repeats the complete current namespace
census. Export requires the authenticated inventory and repeats those comparisons.
Redirects, invalid paths, missing objects, duplicate pages, altered bytes, changed
versions and absent required metadata fail closed without exposing credentials.

Content type, cache policy, user metadata, ETag and timestamps are retained in an
authenticated sidecar inside the encrypted package, bound to the exact inventory
hash and object identities. Existing V1 callers without metadata remain compatible.
The 102-object loopback HTTP test covers pagination, nested Unicode names, exact
decrypted bytes and metadata, changed metadata and missing metadata refusals.
These are actual local HTTP requests; no hosted object was downloaded for this proof.

Coverage is current object versions plus observed bucket configuration and metadata.
Application thumbnail history uses distinct stored snapshot paths; a later acceptance
check must reconcile every required SQL reference to a verified object. Backend
historical versions and delete markers require explicit capability/coverage
classification and are not proved by this adapter. Repeated reads are not an atomic
Storage snapshot. Hosted restore behavior, independent key retrieval and off-device
custody remain separate requirements.

## Installation composition and remaining work

The integrated source plan orders the original 64 owners, two explicit SQL
prerequisites and six admission owners. Its authenticated observed-prefix classifier
refuses wrong source/order, forged evidence and unrecognized catalog changes after
interruption. It is not an SQL executor and does not authorize resume. Required
preexisting application schemas must be classified separately; synthetic recovery
fixture DDL must never become an installation migration.

Still required: remaining helper-outcome coverage; complete installer execution and
internal-commit recovery; external provider-worker fencing and safe replay; source
coverage beyond application DML; worker cadence and monitoring; application asset
reference/version-history coverage and independent custody; notification handover;
and final activation implementation once those prerequisites are resolved. WR-101
remains a separate unbuilt release. Hosted compatibility and live acceptance remain
for a separately authorized owner window. The goal is still active.

Raw evidence stays in the private sibling evidence directory; code, harnesses and
sanitized receipts are portable. Failed retry rehearsals exposed a boolean-to-JSON
test observer error and a missing source-owned Calendar ACL fixture. They remain
failed receipts; corrections reused the exact grants rather than relaxing controls.
