# Calendar feedback recovery with combined evidence stores

**Source acceptance only, 2026-09-06.** Based on integration commit
`d07d06d843c0a0b61d1d26b1eb2aec00d9dddf26`, which includes the corrected
PR1317 recovery implementation, native provenance and history-v6. No application,
Edge Function, migration, frozen writer or deployment configuration is changed
by this proof. Workload's later schema integration is a separate lane.

The focused command `node test/calendar-feedback-recovery-integrated.js`
actually executed **7 groups / 81 assertions** against an owned disposable
PostgreSQL 16.14 server with password authentication. A wrong-password control
was refused; the server was stopped after the run. The actual production-write
and frozen calendar-upsert handlers run through the existing synchronous psql
Supabase transport seam. External fetches are refused; zero were attempted.
The [public-safe JSON receipt](2026-09-06-calendar-feedback-combined-proof.json)
records exact source hashes, executed schema-statement hashes, full-row digest
and the private receipt digest. No raw row images, tokens or local paths are
published.

| Executed case | Result and comparison |
| --- | --- |
| Combined native schema plus journal, provenance and materialization evidence | All three stores and eight capture triggers present; 35 selected tables; no foreign servers |
| Accepted video note and graphic tweak | Actual add and the tweak's bound own status commit, then actual recovery materializes one source copy. Canonical comments, accepted receipts, outbox, native events and provenance stay exact; one journal row contains the complete resulting card image |
| Lost recovery response followed by the identical request | `already_materialized`; all 35 tables' row images remain equal |
| Native comment resolved after acceptance | `native_lifecycle_changed`; all 35 tables' row images remain equal |
| Journal insert failure during recovery | Source change and materialization receipt both roll back; accepted comment/status evidence remains. Removing the fault permits one materialization |
| Provenance insert failure with ordinary feedback | Recovery still succeeds and provenance rows remain exact: feedback changes no slots, so the real trigger has no provenance insert to perform |
| Provenance insert failure during an actual frozen-writer slot clear | `__CLEAR_LINK__` exercises the writer's real explicit-clear contract. Required provenance failure rolls back all 35 row sets. Removing the fault permits the clear and records one slot-change fact while retaining feedback/acceptance receipts |

The prior complete handler/browser matrices are preserved and were not broadly
repeated. This focused lane represents the failed original source save by its
absent source content. It does **not** repeat the actual browser's 403, refresh
and Retry interaction, nor claim a simultaneous transaction race. Full row
equality excludes sequence state: failed insert attempts may consume values.
The fixture uses the existing migration-shaped native/history setup, adds the
real client-review dependencies, and places pgcrypto in `extensions`, matching
that setup. UTF-8 schema text passes through temporary SQL files to avoid
Windows command-line character conversion. This is not reconstruction of the
installed Supabase schema, deployed privilege proof, a backup/restore run,
production data proof, or release readiness.

The initial interrupted Windows process-output run, UTF-8/schema-placement
setup failures and blank-link fixture failure are retained privately. The last
was the frozen writer correctly preserving an existing link when given blank
input; the corrected fixture uses its explicit clear sentinel. No product
assertion was weakened and no writer change was needed.

## Local transport guard correction and CI registration

The original guard validated `PGHOST` but passed inherited `PGHOSTADDR`,
`PGSERVICE` and `PGSERVICEFILE` to libpq. The new actual-launch interception
negative control fails on the preserved base without any database connection.
`pg.js` now removes those environment keys case-insensitively for both SQL
paths and its availability probe, retaining the fixture password and explicit
local arguments. The original 13 parsing groups plus three intercepted-launch
groups pass (**16 total, zero database calls**).

The new top-level test is picked up by `test/run-all.js`. Local execution needs
`CALENDAR_RECOVERY_INTEGRATED=LOCAL_DISPOSABLE_ONLY` and an explicit owned local
server. In CI, missing opt-in fails instead of skipping; that negative control
was also exercised without a database. The matching existing PostgreSQL 16
unit-job environment binding is the separately coordinated workflow commit
`63aab6afee7756d489531d3a73b5f0144971043f`. Both changes must be integrated
together before current-head CI can pass. No hosted CI claim is made here.

This is a QA-only forward change. Removing the new test/proof files reverses
test registration; retain the local transport guard. No application rollback,
schema inverse or accepted-data deletion is introduced. The caller owns its
disposable server and its retained test database; never point this destructive
fixture at a shared or live database.
