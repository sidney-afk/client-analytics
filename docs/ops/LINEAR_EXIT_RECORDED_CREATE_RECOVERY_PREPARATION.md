# Recorded batch and non-F203 create recovery preparation

This component recovers recorded V2 create attempts for batches and older deliverables without replaying a stale full-row write. It is preparation-only: no hosted writes, provider calls, deployments, or activation were performed. Attempts without their original immutable admission/context remain unresolved; the code does not infer missing history from current titles or provider absence.

## Contract

The additive public-only owner `supabase/migrations/20260913055621_provider_recorded_create_linkage_recovery_preparation.sql` follows the observed-create owner `20260913054339_provider_create_observation_recovery_preparation.sql`. It adds shared source-derived intent/UUID/parent/label helpers, recorded-create recovery and read-observation RPCs, and a narrow extension of the existing application DML guard. Private table shapes are unchanged.

Recovery recomputes the source UUID from the immutable deduplication key using the exact namespace, UTF-8/SHA-1 algorithm, and UUID version/variant bits. The immutable request ID, saved context create ID, and provider issue ID must agree. Original outbox identity/payload, current epoch, attempt lock, native identity, and exact provider intent are checked before any write. Both a stored successful ACK and the distinct append-only read-observation protocol are supported. Neither path resends a provider mutation.

Batch linkage merges only the accepted owner/declared parent teams into the current parent map. It preserves newer names/descriptions, unrelated parent teams, and entry metadata; a conflicting identity on a targeted team refuses. Complete label IDs still validate the create intent, but batches do not require label-node hydration that the source batch branch never performs.

Deliverable linkage patches identity and initializes missing/unchanged label evidence from the complete source-validated response or original native fallback. It preserves newer native title/body/label selections and other current fields. Work becomes clean when unchanged; later native changes or pending intents remain pending. Recovery-owned label hydration has an exact second comparison baseline, so clean recovery replays remain clean while genuinely later label selections remain pending and preserved. This avoids the old handler's stale full-row `deliverable_write` behavior.

Recovery requires exactly one source-compatible `mirror_out_create_link` audit for the original outbox. It inserts a missing audit once even when the identity is already linked, preserves an exact existing audit, and refuses conflicting/duplicate evidence. The native write, journal entry, audit, outbox checkpoint/release, and completion are one transaction. Repeat completion verifies the same stored receipt and audit.

## Reproduction and evidence

```powershell
./qa/linear-exit-rehearsal/run-portable.ps1 -PgBin '<local PG17 bin>' -Lane provider-recorded-create
```

`ISOLATED_POSTGRES`: final receipt `6b9ae18a114e44a1a512ab00bab182cd`, exit 0, 27 checks, marker `LINEAR_EXIT_PROVIDER_RECORDED_CREATE_OK`; server stopped. Additional assertions compare the actual source UUID implementation (including Unicode/trim cases), parent merge helper, complete-label fallback, extracted ACK/read receipt expressions, and source audit event expression.

The proof covers dual-team batches, unrelated-parent preservation, a truncated batch label page with exact label IDs, recorded non-F203 ACK and batch read recovery, later native body/label edits, normal clean/newer pending behavior, missing/existing audit, already-linked replay, rollback, foreign native/target-parent refusal, and missing original context refusal. Zero actual provider calls occurred. Earlier receipts `c43015af585a4e3cb16a1419bc463623` and `3a7096f9274e41a5b4db92d492632c02` remain prior evidence. Regression receipt `306103bf292b41a2afed3faaa82aff42` preserved the actual hydrated-label replay refusal before the correction. Corrected receipt `dd0c282cd51a4120a6bd724b8be7e573` passed 24 checks; the final 27-check receipt additionally isolates newer label-only changes from title/body changes and proves their preservation through replay.

| Artifact | SHA-256 |
| --- | --- |
| New SQL owner | `f9a5a1915c4adb96cc3c0ef90f8c4cfe769ce8b46ec989c9c1250a0bb532414e` |
| Recovery/observation helper | `031aad0e3f8229df69c4c012eb6e79311d62080ac96228754e29d1efa8cf461c` |
| PostgreSQL test | `51b638da7eb05554e7443374f260558729095ac174ce39802dfe7d3050b9718f` |
| Source UUID helper | `6f6dbe6ffa0c7a63e6c13a2b385418fb1ca818dc426999c3e6d62f94048da0ae` |
| Source mapping helper | `dad75fc2c545628108a9a6e84cd5c55922455ab144b302a47410efc843ca45ef` |

The historical F203 file used by the inherited disposable scaffold is not a pending installation instruction. Full observed-plan integration must preserve the current observed source owners. Combined installation/recovery proof is separate. Unrecorded attempts, other uncertain operation types, actual observer identity, external-worker fencing, and hosted verification remain outside this receipt; no installation/retirement readiness follows from these isolated checks.
