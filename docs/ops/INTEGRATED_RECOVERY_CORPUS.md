# Integrated recovery data corpus (local, held)

September6 successor: [explicit history-v8](RECOVERY_SCHEMA_V8.md) adds the separately retained catalog and cutoff owners with20 local schema/data/replay groups across39 tables. Older formats and their dated evidence below retain their exact scope. No scheduled format, installed state or release gate changes automatically.

Base integration: `6b306f473524b8f4759d6f03f09df45e8ba0aaf7`. The independent review found that card provenance and Calendar feedback materialization receipts have no foreign keys and were outside history-v5. Its FK preflight therefore could not detect their omission. Restoring source cards without their recovery evidence can change whether a deleted, cleared or already-materialized action is considered owed.

The additive `history-v6` package contains the existing v5's exact33 tables plus `production_card_provenance` (identity id) and `calendar_feedback_materializations` (attempt_key): **35 tables**. It has its own authenticated magic/version/corpus and scratch trigger helper. v3/v4/v5 remain readable with their original14/21/33 meanings. Old restore plans now refuse a target containing either FK-free recovery table before disabling triggers or truncating data; v5 export preflight also refuses this known incomplete scope. The scheduled default remains legacy-v3. No configuration or live backup was changed.

## Proof

- New offline package/coverage checks: **12 PASS**; existing v5 **41**, v4 **33**, and original backup tests PASS.
- One finite combined disposable PostgreSQL proof: **10 PASS**. It installs the real journal, native manifest/epoch, reconciliation/provenance and corrected Calendar feedback migrations in the same synthetic migration-shaped database, with the existing F27 enqueue/hold functions and trigger. The actual production-write handler commits an interrupted native intake with provider transports refused; Stage1 recovers the missing child and Stage2 binds an existing card. The canonical comment RPC writes an accepted note and its receipt. Both journal-insertion failure and provenance-insertion failure roll back all current/historical rows. The private backup role dumps all35; the dedicated scratch role restores exact row images, preserves trigger state, native epochs and reciprocal completion, and repeated restore adds no history. Oldv5 restore refuses the expanded target without changing it.
- The Calendar materialization row is an explicitly synthetic schema-level receipt fixture. This proves retention and restore, **not execution of the feedback recovery RPC in this combined fixture**. Newton's separate corrected migration was pinned by SHA256 `ee6858accc21b28c03f18579c49d4361dd1287645b785dd20e0136e7ee5851cb`; its separate handler proof does not erase this combined-path limit.
- The preparatory failures are preserved: first the source loader's fictional admin name differed from the history bootstrap's same UUID; then the direct comment fixture lacked the current F27 generation. The fixture was aligned and the real fence retained. Native source was not weakened. Inherited Node warnings and intentional interruption logs remain recorded.

Run the finite local probe only against an explicitly owned disposable server using `CARD_HISTORY_TEST_CONFIRM=LOCAL_DISPOSABLE_ONLY`, the existing `CARD_HISTORY_PG*` connection variables, `CARD_HISTORY_FEEDBACK_SQL` pointing to the reviewed corrected migration and `CARD_HISTORY_FEEDBACK_SHA256` matching its exact bytes; invoke `node scripts/card-history-integrated-rehearsal.js`. It never starts/stops a server. It retains its uniquely named databases and private output directory, including synthetic dump/package, for review; do not publish those files. `CARD_HISTORY_INTEGRATED_OUTPUT` may name an explicit private output directory. The normal offline command is `node test/track-b-backup-integrated-corpus.js`.

### Combined Workload proof, 2026-09-06

Integration base `688947308c96e6f00b09a495a1f16f939fde479d`: **17 isolated
PostgreSQL/actual-handler groups PASS**. This separate finite lane installs the
actual Workload view/membership migrations into the same history-v6 fixture.
`workload_plan` is already one of the journal's six owners; no recorder was
invented or changed. The complete Workload handler and shared auth run with an
in-process Supabase-to-SQL adapter; reads and RPCs explicitly use `service_role`.
Old UUID and native-key callers retain the same stored plan day. Conflicting
aliases refuse without row changes; an injected journal insert failure refuses
the plan write and rolls back all35 current/historical tables. A private backup
role dumps all35 and a private scratch role restores exact row images and
trigger state. Both actual handler read forms return the same aliases/dates
after restore, and the next plan save resumes journal capture. Anonymous and
authenticated SQL roles cannot execute the private snapshot RPC. External
fetch and legacy mutation transports are refused and their call counts are zero.

Run `node test/workload-history-integrated.js` with
`CARD_HISTORY_TEST_CONFIRM=LOCAL_DISPOSABLE_ONLY`, explicit loopback
`CARD_HISTORY_PGHOST`, `CARD_HISTORY_PGPORT`, `CARD_HISTORY_PGUSER`,
`CARD_HISTORY_PGPASSWORD`, and absolute `CARD_HISTORY_PSQL` /
`CARD_HISTORY_PG_DUMP` paths. `CARD_HISTORY_WORKLOAD_OUTPUT` may name a private
artifact directory. Opted-in missing setup fails; normal offline invocation
prints an explicit SKIP. The harness neither manages servers nor drops its
uniquely named databases. Inherited libpq connection overrides are removed;
SQL travels over UTF-8 stdin with password prompting disabled.

This is a synthetic migration-shaped fixture, not an installed-schema capture.
The legacy `workload_issues` relation is empty and outside35: no CON/STR or
provider-population recovery claim follows. Native intake and Calendar recovery
RPCs are installed but not invoked by this Workload lane. Node type-stripping
and module warnings remain recorded. This does not prove browser behavior,
serving, capacity, schema artifacts or cloud restore. Runtime, corpus membership,
workflow configuration and frozen anonymous writers are unchanged; clients see
no change. This test-only delta can be reverted without changing saved work.

## Release and integration holds

### Explicit materialization extension, 2026-09-06

The combined dormant card boundary adds `history-v7`, exact37: the unchanged
v6 corpus plus its two UUID-keyed retained materialization owners. Formats
v3/v4/v5/v6 keep their original identities and 14/21/33/35 table counts.
The [final recovery record](../audits/2026-09-06-native-card-materialization-recovery.md)
documents 12 actual local groups against the final SQL, including four original
accepted envelopes, exact37 row images, non-UTC current-row replay and late-COPY
rollback. The separate v7 prerequisite artifact is unapplied outside disposable
fixtures. This extension does not repair the authenticated schema reconstruction
hold below or add label-catalog coverage.

1. Install required native manifest/epoch RPCs before the new production-write serving revision: provider-default intake also calls `production_intake_epoch_read`. Then prove exact gateway/feedback-reader serving revisions before exposing dependent frontend flows. Never redeploy or re-gate the frozen anonymous writers to accomplish this.
2. Prove frontend comment/save-failure continuity before installing journal/provenance triggers; either recorder's failure aborts its business transaction. Existing separate browser or SQL passes do not prove combined write/recovery behavior.
3. Complete an authenticated schema + data capture and empty-target, trigger-aware restoration for this35-table corpus before calling it recoverable. The v6 grant artifact supplies no schema bundle. Source catalog preflight is separate from the data snapshot and cannot rule out concurrent DDL drift. The separate PR1313 schema effort must consume this object inventory; it is not silently expanded here. The label catalog remains outside35 and install-held.
4. Run the corrected Calendar recovery handler against the combined schema, with failure atomicity, stale browser/owned-attempt readback, and late canonical lifecycle changes. This slice proves table retention only.
5. Keep native intake activation and automatic missing-card creation held. Preserve accepted manifests, epochs, outbox/comment receipts, source-repair receipts, provenance and journal rows through rollback. Bind-only debt and old-browser overwrite limitations remain as recorded in the reciprocal review.
6. Rebuild/hash the Samples reader inverse and feedback-consumption inverse from the final integrated HTML. Old release HTML files are historical artifacts, not an inverse for the combined page. Prove forward/recovery/forward with the final source and retained recovery records.

Manual staging uses `scripts/track-b-history-v6-backup-prerequisites.sql`: its existing dedicated private role must pass exact35 keys, sequence and privilege checks; scratch uses the distinct v6 helper to suspend/re-enable user triggers transactionally. The operator separately verifies the target. No grants, schema installation, workflow dispatch or corpus-selection change happened here. Installing these artifacts is a later gated action, not an effect of this local commit.

Rollback before installation is to discard this source delta. After approved use, retain v6 packages and all recovery data. Old packages remain useful only in their explicitly limited compatible targets; do not bypass their refusal, use CASCADE, or drop newer recovery evidence to make them restore. Clients see no change during this local preparation.
