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

The remaining 26 empty owners are recorded privately and remain a population
coverage gap. Standalone routing-variable refusal and final inventory-drift
verification are now included. No hosted behavior follows from this evidence.

## Retained earlier failures

`68d6b2c88fc34f3f865b93fa2731e4bd` failed because the test adapter returned formatted
psql output instead of JSON scalar output. `24524dee7efd47e1946432817c1e9967`
failed because a synthetic hiring URL violated the actual source constraint.
The adapter and synthetic value were corrected; the constraints were retained.
Both runs stopped and their private failure logs remain available.

## Scope still missing

This format authenticates but does not encrypt private data. Object bytes,
off-device retrieval, independent key custody, hosted restore/access checks,
and final admission/drain are not proved. A streaming object-byte package is
being prepared separately. No production backup, configuration, data or function
was changed. Installation HOLD continues.
