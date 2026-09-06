# Schema recovery integration: selected37, local preparation

This is a held implementation slice under
[`GO_LIVE_CHECKLIST.md`](../independence/GO_LIVE_CHECKLIST.md), not a second
execution plan. Base `bbe030766e595fccd88adaa98d97ca5177f2226e` preserves the
reviewed native card boundary and explicit history-v7 data corpus. The schema
engine is imported from PR1313 at
`fa4e175742e7fe7c903f694d9b341767d4929ed2`; that branch's competing 34-table v6
and staged label expansion are deliberately not integrated.

## Exact source boundary

`track-b-recovery-package.js`, `track-b-recovery-reconstruct.js`, and
`track-b-recovery-prerequisites.sql` initially retain fa4 bytes. The separately
reviewed callable lexer correction must be integrated before any real capture
rehearsal can close the known lexical safety finding. No application, Edge
Function, migration, runtime flag, backup schedule, or existing data-restore
implementation changes in this preparation. The frozen anonymous client writers
and every existing accepted receipt remain untouched.

The data library still interprets v3/v4/v5/v6/v7 as exactly **14/21/33/35/37**
tables. Older packages remain readable with their original limits, and existing
omitted-evidence refusers remain in place. The schema package is a separate
authenticated format, recovery-version 2, with the selected data corpus named
inside its binding. Lossy recovery-version 1 remains refused. The experimental
fa4 34-table v6 is not silently reinterpreted as canonical v6.

Whole `public` schema plus selected37 data is not a full database/platform
backup. The two G3 evidence tables, card provenance, Calendar recovery evidence,
manifest/comment/outbox receipts, source cards, Workload plans and the journal
are selected. `production_label_catalog_versions` is outside this integrated
source and selected37; its installation/activation and recovery expansion remain
held. Any future new owner needs a separately versioned data-corpus decision.

## Executable preparation and proof limits

Offline commands:

```text
node test/track-b-recovery-package.js
node test/track-b-recovery-v7-preparation.js
node test/track-b-backup-integrated-corpus.js
node test/track-b-backup-corpus.js
```

This preparation passed **18 package, 6 local-target/launch-adapter, 21 existing
v3-v7 corpus and 33 existing v3-v4 groups**. These are offline/synthetic package
checks. The first new corpus assertion incorrectly assumed old COPY order was
a prefix; v5 intentionally places referenced owners first. It was corrected to
verify every retained table's exact primary-key/identity metadata and independently
preserve all version counts/refusers. No corpus implementation was changed.

The rewritten `scripts/track-b-recovery-rehearsal.js` is prepared for the actual
selected37 source. It reuses the existing migration-shaped history setup, real
Workload view/membership migrations, current crosswalk binder and materialization
SQL. Four actual gateway/extracted-browser creation envelopes produce genuine
card receipts, followed by human edits and a held unknown ingress. A separate
canonical-comment RPC creates an accepted note/outbox receipt. The source
fixture is not an installed schema reconstruction; inherited platform functions
and migration extraction repairs remain exactly those of the owning fixtures.
The legacy Workload population is empty and outside37. Zero-row selected tables
are explicitly counted and digested, not represented as exercised business paths.

The prepared lane checks capture-role write denial, target-role restrictions,
password-authentication negatives, a catalog-race refusal, and a writing-callable
capture negative with comment-like string literals. It does not remove sampled
application objects to obtain a passing capture. The only dropped source objects
are the explicitly introduced synthetic negative table/functions and race column.
It then requires one authenticated schema/data package to reconstruct the empty
restricted target, exact textual row images for all37, full-width sequence values
and next allocations, current-row card replay in hold, exact extra ingress
accounting, canonical receipt replay, privacy/retention triggers, and late COPY
rollback. A test-only module transport seam forwards real reconstruction SQL and
refuses only the independent post-commit verification subprocess; the resulting
committed target must remain quarantined and an in-place retry must refuse.

**This combined schema/replay lane has not been executed in this preparation.**
The previous data-only 12-group v7 proof and fa4's author-reported schema proof
do not prove this combination. There is no current authenticated-schema PASS,
capture approval, installed-role evidence, restore-duration result, retention
duration proof, or recovery activation claim.

## Next isolated run, after lexical correction and source review

Use an already running, privately owned disposable PostgreSQL server with
password authentication. The script never manages a server and never drops a
database. Set all of these explicitly:

- `TRACK_B_RECOVERY_TEST_CONFIRM=LOCAL_DISPOSABLE_ONLY`
- `TRACK_B_RECOVERY_TEST_PGHOST=127.0.0.1` and an owned port in
  `TRACK_B_RECOVERY_TEST_PGPORT`
- `TRACK_B_RECOVERY_TEST_PGUSER` and `TRACK_B_RECOVERY_TEST_PGPASSWORD`
- Absolute executable paths `TRACK_B_RECOVERY_TEST_PSQL` and
  `TRACK_B_RECOVERY_TEST_PG_DUMP` (use the already reviewed PostgreSQL 17 clients)
- Absolute `TRACK_B_RECOVERY_TEST_OUTPUT` outside the repository

Run `node scripts/track-b-recovery-rehearsal.js`. Missing configuration fails;
there is no silent SKIP. It clears inherited libpq overrides before local
subprocesses, binds literal loopback and owned database names, and disables
password prompting on its SQL adapter. Raw package/schema/rows/failures and the
database inventory stay private; stdout reports aggregate outcome only. Keep
all uniquely named databases and private reports for review, including failures.
No capture/upload/workflow/alert is scheduled by these files.

Progression requires a named review and a passing **exact combined head**
schema/data/replay receipt. A callable, catalog, target-prerequisite or restore
failure remains red; preserve the sampled source and fix the narrow cause.
Installed schema/role/source provenance, source consistency while capturing,
omitted-data accounting, external asset coverage and actual restore drills remain
separate release gates under the canonical plan.

## Withdrawal and recovery

This source is unapplied; withdrawing it changes no client behavior or database.
Preserve existing data packages and receipts. A failed precommit reconstruction
may be retried only after evidence confirms the same target is still empty.
A committed-unverified target is preserved/quarantined; use a fresh empty target
for another attempt. Deleting the package is never a database rollback. No
automatic source or target cleanup, production privilege change or writer
re-gate is authorized here.
