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
& ./qa/linear-exit-rehearsal/run-portable.ps1 -PgBin 'C:/local/pgsql16/bin' -Lane unit
& ./qa/linear-exit-rehearsal/run-portable.ps1 -PgBin 'C:/local/pgsql17/bin' -Lane f27
```

Each command creates a new owned database on a random loopback port, writes
private results to a unique temporary directory and stops that database in
`finally`. It retains the real exit code. **The repository-negative command
must exit 1**, preserving the original public materialization failure; it is
not relabelled as a successful application journey. Do not reuse a production
server or replace public browser headers with staff credentials.

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
