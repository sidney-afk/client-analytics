# Linear exit: reproducible isolated rehearsal

**Preparation only. No deployment, merge, live writes or installation approval.**

This package moves the reviewed local journey harness onto GitHub so another
session can reproduce it from the candidate branch. It runs actual Chromium,
repository handlers and disposable PostgreSQL, using synthetic identities and
an SDK-to-SQL adapter. It is not hosted Supabase/PostgREST/JWT/RLS or real Slack
delivery proof. The smaller fixture schema is not a complete production schema.

## Windows prerequisites

- A full checkout of the candidate, including historical commit
  `c3397f93f7851964a39dc99ca6c16551aec6e377` (old accepted-write replay control).
- Node 22.12 or compatible later Node 22, Git for Windows, PowerShell, and the
  dependencies in the repository package.json. Install with
  `npm install --ignore-scripts --package-lock=false`, then install the pinned
  Playwright Chromium using `npx playwright install chromium` if absent.
- Existing PostgreSQL 16 binaries (`initdb`, `pg_ctl`, `psql`) for journeys and
  unit/optional checks; PostgreSQL 17 binaries for the separate F27 lane.
  The runner installs nothing, accepts no database URL and does not use Docker.
- A clean process environment with no inherited database-routing variables.

From the repository root, replace the example local binary path:

```powershell
& ./qa/linear-exit-rehearsal/run-portable.ps1 -PgBin 'C:/local/pgsql16/bin' -Lane journey -ServingMode captured-positive
& ./qa/linear-exit-rehearsal/run-portable.ps1 -PgBin 'C:/local/pgsql16/bin' -Lane journey -ServingMode repository-negative
& ./qa/linear-exit-rehearsal/run-portable.ps1 -PgBin 'C:/local/pgsql16/bin' -Lane optional
& ./qa/linear-exit-rehearsal/run-portable.ps1 -PgBin 'C:/local/pgsql16/bin' -Lane composition
& ./qa/linear-exit-rehearsal/run-portable.ps1 -PgBin 'C:/local/pgsql16/bin' -Lane notifications
& ./qa/linear-exit-rehearsal/run-portable.ps1 -PgBin 'C:/local/pgsql16/bin' -Lane recovery
& ./qa/linear-exit-rehearsal/run-portable.ps1 -PgBin 'C:/local/pgsql16/bin' -Lane deferred-defaults
& ./qa/linear-exit-rehearsal/run-portable.ps1 -PgBin 'C:/local/pgsql16/bin' -Lane unit
& ./qa/linear-exit-rehearsal/run-portable.ps1 -PgBin 'C:/local/pgsql17/bin' -Lane f27
```

Each command creates a new owned database on a random loopback port, writes
private results to a unique temporary directory and stops that database in
`finally`. It retains the real exit code. **The repository-negative command
must exit 1**, preserving the original public materialization failure; it is
not relabelled as a successful application journey. Do not reuse a production
server or replace public browser headers with staff credentials.

The recovery lane uses the existing `history-v11` rehearsal and requires
`pg_dump` beside the supplied PostgreSQL binaries. It reconstructs the selected
52-table data corpus plus its public schema into an empty local target, subject
to the recovery engine's checks. Results remain private under the owned run
directory. This is a migration-shaped synthetic source, not the current hosted
database or Storage objects; a successful run would not authorize installation.
The runner requires the versioned PASS report and stops its server on failure.

The `deferred-defaults` lane is a smaller real PostgreSQL proof. It uses raising
direct and SQL-wrapper generators to verify no invocation during explicit-column
COPY and deferred default restoration, preserved synthetic token bytes, actual
failure when a stored COPY column is omitted, and complete rollback after a late
failure. The runner requires its full completion marker. This focused lane does
not replace authenticated full-schema recovery or hosted data/Storage proof.

## Source contract and assertions

`serving/functions/calendar-upsert/index.ts` is the exact Calendar v49 source
captured read-only on 2026-09-10, with verify_jwt=false. Its sole local dependency
is included beside it. Both were reviewed for public content; environment
variable references are code, not credentials. Only these two source files are
included, not the management response, deployment metadata or captured records.

The loader verifies their SHA256 hashes before execution and adapts only the
SDK import, dependency path and server registration for the isolated harness.
It does not manufacture a serving fixture by removing repository authentication.
These files are **test fixtures, never deployment entrypoints**. They do not
replace or modify either frozen writer in `supabase/functions/` and do not
claim the hosted version can never change after capture.

The positive mode uses captured Calendar only for the final public submission:
one accepted child, unauthenticated materialization, exactly one linked card,
cleared recovery, staff reload/open/edit. All earlier cases use repository
writers. The negative mode keeps the repository Calendar writer and requires
401, retained child, absent card and pending recovery.

The browser proxy forwards only two verified loopback origins; external and
CONNECT attempts are refused. Final accounting runs after teardown. Blocked
attempts stay visible and are distinct from successful external forwarding.
Node handler fetch is simulated; provider receipts are local fixtures.

The harness covers 24 checkpoints in the positive lane and 23 before the
negative control's expected failure. Schema upgrades/interruption, full F27
and native owner composition, production data/Storage restoration, real
notification handover and all client-review combinations remain separate gates.

## Evidence handling

The `composition` lane installs real A1/B0, legacy artifact prerequisites,
full F27 and selected native owners together. See
[`scripts/linear-exit-composition/README.md`](../../scripts/linear-exit-composition/README.md)
for its exact scope and remaining gaps. It does not replace full production
schema, notification, Workload or database/data/Storage recovery proof.

Keep generated databases, raw logs, screenshots and request traces out of Git.
The runner defaults to temporary output outside the checkout. Publish only
reviewed aggregate results and hashes. `RESULTS.md` records the completed run
and its exact source; the recovery checkpoint records current program status.

## Pinned upstream ledger rehearsal

Use the portable runner with `-Lane upstream-ledger` and the same local PG16
binary path as composition. This separate lane requires Git object
`fcebb856d3f5ea607cf5665ac391c258ad173abb` to exist locally; it must fail if
the exact upstream migration cannot be retrieved. A shallow checkout may need
to fetch that commit first. The migration is exercised only in a disposable
database and is not installed into the candidate source tree or any hosted
system. The existing marker migration supplies its real column prerequisites.

This tests the new ledger together with the prepared composition. It does not
prove full upstream integration or trigger behavior after authenticated recovery;
those remain separate gates. Raw temporary source and receipts stay private.

Use `-Lane recovery-upstream-ledger` to extend the full authenticated history-v11
recovery rehearsal with those same pinned owners. The runner requires both
the standard52-table PASS report and an explicit
`upstream_ledger_verified: true` result; a plain recovery PASS cannot satisfy
this lane. The source remains synthetic, and hosted recovery/Storage custody
remain outside its scope.

## Inventory-ordered installation attempt

Use `-Lane installation-order` with the same owned local PG16 prerequisites.
This lane verifies the source inventory, reuses the established scoped baseline
bootstrap, and applies each remaining owner once in declared dependency order.
The dated baseline capture is only partially represented by that bootstrap;
it is never blindly replayed as a complete target snapshot.

The lane records catalog fingerprints after entries and stops at the first
failed owner. These are after-entry checkpoints, not proof of every internal
commit in autocommit or multi-transaction files. A complete pass would establish
only declared-order execution on this synthetic baseline; accepted-work
continuity, per-commit interruption/resumption and hosted installation remain
separate requirements. The runner requires an explicit completion marker.

## Entry-boundary resume rehearsal

Use `-Lane installation-resume` for fresh-process continuation across the
ordered entries. A parent owns the disposable database; each child verifies
the published inventory, checkpoint authentication, exact completed prefix and
current catalog before executing one owner. The per-run signing key stays
separate from the private checkpoint. Deliberate catalog drift and checkpoint
cursor tampering must refuse before owner execution.

This is entry-boundary continuation with the parent still alive. It does not
prove parent/process-kill recovery, concurrent-worker exclusion, internal commit
recovery, or the gap between SQL commit and checkpoint replacement. Catalog
fingerprints do not attest business data; accepted-work preservation remains
a separate requirement. No production resume mechanism is authorized.

## Internal-step interruption rehearsal

Use `-Lane installation-interruption` for the focused interruption test. It
uses actual inventory source prefixes in the disposable database. Atomic intake
is interrupted before its outer COMMIT; rollback must retain the prior catalog
and checkpoint before a fresh normal worker executes it. A later autocommit
owner is interrupted after its first statement; the resulting catalog must
refuse continuation from the old checkpoint. The lane stops at that refusal
and checks accepted work, rather than repairing or certifying the partial state.

A PASS covers these selected interruption points only. It does not establish
every internal boundary, operating-system process kill, parent restart/key
custody, concurrent-worker exclusion or recovery of a partial installation.
The complete normal resume lane remains a separate proof.

The recovery-upstream-ledger lane now uses the same published inventory order
and scoped bootstrap as installation-order. It retains 31 recovery assertions
across 52 history-v11 tables. Older recovery lanes retain their original setup.
See RESULTS.md for revision-specific evidence and retained failed attempts.

Use `-Lane preflight` for the focused disposable PostgreSQL readiness diagnostic
test: actual missing-relation refusal before configuration reads and seven JSON
shape cases. The latter use exact SQL predicates with a synthetic row source.
Run `node test/linear-exit-deploy-preflight.js` for the offline transport/contract
cases. Neither command invokes the hosted Management API or authorizes release.

Use `-Lane preflight-installed` to install the pinned inventory on the disclosed
local baseline and execute the actual release metadata query. The test validates
the exact expected key set before emitting only object keys and booleans, then
requires every metadata object to be present and compatible. Configuration and
current hosted readiness are not covered; failed objects remain failures.

Use `-Lane view-provenance` to reconstruct repository-owned predecessor views
and compare PostgreSQL's pretty view definition with the pinned hosted SHA256
observation. This test needs no private captured source and executes no hosted
SQL. A match identifies the selected definition at the recorded observation;
it does not prove grants, dependencies, complete baseline or upgrade safety.

For the explicit PostgreSQL 17 recovery variant, use `-Lane recovery-upstream-ledger`
with `-RecoveryPostgres17` and PostgreSQL 17 binaries. The switch is refused for
other lanes; the normal recovery lane still requires PostgreSQL 16. Report exact
versions separately: matching a hosted major version does not prove matching
patch versions, platform configuration or live recovery.

Use `-Lane priority-companion` with PostgreSQL 16 binaries for the isolated
nine-table row companion rehearsal. It uses synthetic schemas built from the
pinned observed column/key contract. It is not a production capture tool or a
complete schema restore: defaults, triggers, policies, semantic dependencies,
sequence custody and referenced objects require separate recovery proof.

Use `-Lane priority-snapshot` with PostgreSQL 16 binaries (including pg_dump)
for the integrated parent/companion snapshot rehearsal. The lane requires an
owned disposable server and uses synthetic schema/data, not hosted captures.
Consult RESULTS.md for run-specific outcomes; selecting the lane is not proof
of complete recovery, sequence consistency or an authorized release.

Use `-Lane priority-restore` for the combined synthetic parent/companion restore
rehearsal. The prepared `reconstructPairSql` API authenticates both byte buffers,
loads the companion before post-data constraints/triggers, and verifies covered
rows plus remaining omitted-table emptiness before the single commit. It does
not execute SQL itself or authorize a hosted target. Run-specific results and
remaining application-schema/custody limits are recorded in RESULTS.md.

Use `-Lane priority-application-schema` to compare the nine-table observed row
contract with the actual published installation order. This lane adds no missing
owners or synthetic priority tables. It emits a sanitized catalog gap report and
exits nonzero unless all nine exact row/key shapes match. Missing/mismatched
results remain failures; they do not invalidate the separately scoped synthetic
round-trip tests or establish a complete application backup.

Use -Lane priority-application-supplement for the explicit four-source supplement before the same strict nine-table comparison. It stays separate from the published inventory and fails while any table is missing.

Use `-Lane priority-observed-baseline` with PostgreSQL 17 binaries for the explicit
current-catalog backup baseline plus known-owner supplement. It requires the
backup table to be absent and uses the captured standard owner/ACL, including
MAINTAIN. Selected catalog fields are verified transactionally and with a fresh
read before the nine-table match can pass. This is a local observed baseline,
not a historical migration or full hosted/platform recovery proof.

Use -Lane priority-application-recovery with PG17 binaries including pg_dump for populated synthetic capture/restore on ordered application owners plus the explicit supplements. It uses restricted roles and existing verification; it does not prove hosted or object recovery.
