# Complete application-data rehearsal checkpoint

Status: bounded isolated evidence, not installation approval or final acceptance.

The separately versioned `complete-application-data-v1` package reconstructs the
86-table application inventory. It embeds the unchanged history-v11 parent and
adds authenticated rows and stored-column metadata for its 34 omitted tables.
It refuses unclassified or missing tables. This does not silently expand an old
history-v11 backup or turn it into a complete application backup.

## First successful database rehearsal

- PG17 receipt: `linear-exit-complete-application-recovery-d9f28fae6c32408eb6e8353e68ec07bb`.
- Artifact SHA-256: `531f8269db3572d61aeae2447fa3e23a5398d85819570370adf199df0f0a7615`.
- Installation source inventory SHA-256: `6c57462d97876157322b8ecffbc6d46b0b40d9cfc669c14be61df871c5e43122`.
- Application-data inventory SHA-256: `fb24bcc7fce59194e92fa1b10e41909d46a9e87e305948273fd216f985d7a10f`.
- 86 tables reconstructed and independently compared as row multisets; 43 had
  synthetic rows. The other 43 were empty, so this is not an all-tables-populated
  proof. Broader population and fault tests remain to be completed.
- Restricted capture and restore roles, authenticated reopened artifact, byte
  tamper refusal, exact catalog/row/sequence verification. Process exited zero;
  the disposable server shut down successfully.

The sequence checks cover catalog-visible direct integer consumers and refuse
observed state drift. They do not establish a concurrent-writer fence or prove
all dynamic sequence callers. The source schema uses the pinned installation
inventory plus explicitly hashed source supplements; hosted equivalence remains
unproven. Unsupported external dependencies are refused, not fabricated.

## Expanded source-data rehearsal

Receipt `linear-exit-complete-application-recovery-6c579435fc7e46cc886efbdd78ff2924`
also passed and stopped successfully. It reused the existing actual gateway and
materialization fixtures, including four accepted materializations, retained
unknown ingress, and the media/triage fixture. All 86 tables were independently
compared; 60 contained synthetic rows. Artifact SHA-256:
`710ebc875e8688910e52ca378955414a17f5d5763059650809467e9d021a051f`.
The follow-up receipt `linear-exit-complete-application-recovery-ec615d3d02804ddfaf3d9370c252d880`
adds a late omitted-row corruption control: the specific multiset mismatch
refused the restore, the transaction left zero public tables, and the clean
retry passed all 86 comparisons with 60 populated tables. Artifact SHA-256:
`a97df7614fcfbfb86be33dadaac219d6ac01d7c506956f32666f8a9e4c9169bb`.
The run exited zero and its disposable server stopped.

The subsequent full-population receipt
`linear-exit-complete-application-recovery-d2373f9c4c0b487a85756aa9dc2d29f4`
passed with **86 of 86 tables populated**, every row multiset independently
compared, the late corruption refusal, an empty target after rollback, and a
successful clean retry. Artifact SHA-256:
`71be394e2359f14c9466a54078b3f72b680b5c6befbde97012872bf5560693e1`.
The private empty-table list is empty and the server stopped successfully.
Additional fixtures use actual native lifecycle/identifier/notification RPCs
and constrained synthetic historical rows; none represents hosted activity.
Standalone routing-variable refusal and final inventory-drift verification are
included. No hosted behavior follows from this evidence.

## Final admission-schema successor

Explicit `complete-application-data-v2` adds the four private admission/operation/
follow-up/context tables without changing V1's inventory, bytes or default.
V2 requires the transaction context table to be empty, while retaining accepted
operations, pending tasks and control history. It does not erase work to make a
backup fit an older contract.

Final four-owner PG17 receipt:
`linear-exit-complete-application-recovery-f56c618f50dd4103bf3c7813f8167820`.
All 90 table multisets and the complete schema fingerprint match; 89 tables
contain synthetic rows and only transaction context is empty. A late corrupted
operation row refuses restoration, leaves an empty target, and a clean retry
passes. The actual resulting artifact is encrypted and reopened byte-for-byte.
Artifact SHA-256:
`b27584fcfa1bfc22c42043382131b58d14b4e9add3dc44ebddbf36bad2334734`.
The disposable server stopped and its stderr was empty. The ephemeral encryption
key used by this test is not operational key custody.

The first V2 runs stayed red on a schema fingerprint mismatch. Private comparison
isolated a Windows input-transport issue: 13 carriage returns inside the captured
Calendar function body were removed on reconstruction. The repair escapes only
carriage-return-bearing function bodies for SQL transport. It preserves their
stored bytes, the immutable serving capture and the existing strict fingerprint;
it does not normalize away a mismatch. V1 decoding and offline regressions pass.

## Retained earlier failures

`68d6b2c88fc34f3f865b93fa2731e4bd` failed because the test adapter returned formatted
psql output instead of JSON scalar output. `24524dee7efd47e1946432817c1e9967`
failed because a synthetic hiring URL violated the actual source constraint.
The adapter and synthetic value were corrected; the constraints were retained.
Both runs stopped and their private failure logs remain available.

## Scope still missing

This relational format authenticates but does not itself encrypt private data.
An encrypted streaming wrapper now passes local round trips, wrong-key and
corruption controls. The populated 86-table artifact above was encrypted and
reopened byte-for-byte in private receipt
`complete-encrypted-reopen-d4a149c3-b999-487b-a5d6-9a6331cbc9f5`.
That rehearsal used an ephemeral key; it is not operational key custody.

Object export now has an adapter-driven paginated inventory and verified-byte
path into that encrypted wrapper. Synthetic tests cover missing, extra,
duplicate, changed and corrupt objects, changed bucket metadata and cursor
loops. There is no live export adapter or atomic hosted inventory proof yet.

Off-device retrieval, independent key custody, hosted restore/access checks,
and final admission/drain remain unproved. No production backup, configuration,
data or function was changed. Installation HOLD continues.
