# Schema recovery integration: selected37, local preparation

## 2026-09-06 successor: ordinary-view callable boundary

This narrow engine correction starts from `71b4647ba1a4d873008a732dbe1cdd20d6f69825`.
It changes no selected-data corpus, SQL owner, application, Edge Function, grants,
schedule or live state. The v8 owner rehearsal remains separate; historical v7
proof below retains its original source pins and limits.

The old classifier correctly refused the debt reader's original default-VOLATILE,
SECURITY DEFINER declaration. Changing that table reader to IMMUTABLE would be
incorrect. Its separately reviewed metadata-only correction is cutoff commit
`33bfd23a51c388008531ec8ecba58e3152a115e0`, migration SHA-256
`e78ae3db4da8bee59515d5200c7ab5565fd59ac6e074e471fe7106d4cc2a05e5`.
That source is a dependency to integrate; this engine patch does not alter it.

New `public_stable_view` references permit STABLE SQL/PLpgSQL SECURITY INVOKER
functions only through ordinary VIEW expressions. Defaults, CHECKs, generated
columns, domains, indexes and materialized views retain immutable-only public
callables. Every use is checked independently, including shared/transitive
functions and all observed overload bodies. Writing/dynamic statements, row
locks, SQL SELECT INTO, volatile or definer callees, unpinned extensions and
unknown qualified calls remain refused. PLpgSQL SELECT INTO a local variable and
missing-control exceptions remain supported. This is a conservative lexical and
catalog contract, not a general SQL semantic proof.

The new closure requires nonvolatile invoker metadata for builtin/extension
callees; target prerequisites recheck recorded aggregate overload metadata.
Legacy direct defaults such as sequence `nextval` retain their prior contract,
but cannot enter the new read-only closure. Capture checks the context contract
before writing an output package. Recovery-version 2 and all existing data-corpus
identities remain unchanged. Older engine readers reject the new class; they do
not silently treat it as immutable. Retain compatible readers and packages if
withdrawing this source.

`node test/track-b-recovery-stable-view-callables.js` has 52 passing offline
groups against actual classifier exports and authenticated synthetic packages;
the unchanged package/lexer suites retain 18/33 groups. The original classifier
refusal of a STABLE invoker reader is preserved as the baseline control. No SQL,
live catalog, source/target permissions, serving revision, client journey or
successful v8 restoration is proved by these controls. The combined actual
schema/data/replay rehearsal, named source review, and installed recovery gates
remain required before any activation.

This is a held implementation slice under
[`GO_LIVE_CHECKLIST.md`](../independence/GO_LIVE_CHECKLIST.md), not a second
execution plan. Base `bbe030766e595fccd88adaa98d97ca5177f2226e` preserves the
reviewed native card boundary and explicit history-v7 data corpus. The schema
engine is imported from PR1313 at
`fa4e175742e7fe7c903f694d9b341767d4929ed2`; that branch's competing 34-table v6
and staged label expansion are deliberately not integrated.

## Exact source boundary

`track-b-recovery-package.js`, `track-b-recovery-reconstruct.js`, and
`track-b-recovery-prerequisites.sql` initially retained fa4 bytes in
`b554db97a155b0ef2adec68a28f1fa1a659c6344`. The follow-up imports the exact reviewed
lexer from `33e0f576e40d61fabd8d4283fb0e9f11cfdf29b4` (engine SHA-256
`b86ecbfc52cc47e3e2981c170674963cd88c4e595ab66cd9b34f882ae456aff8`). It also limits
CLI failure guidance: validation failures no longer claim a rollback, and
retry-in-place guidance requires an observed empty-target rollback receipt.
The reconstruction core remains unchanged. No application, Edge
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

This preparation passed **18 package, 8 local-target/launch/CLI groups, 33 lexer,
21 existing v3-v7 corpus and 33 existing v3-v4 groups**. These are offline/synthetic package
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

The initial preparation was unexecuted. The coordinator subsequently ran exact
`26691a9da9e685a4e43be7516ee6e58b34f2fcd0`: **16 actual schema/data/replay groups
passed** on owned PostgreSQL16. A separate final target-state correction has
three actual SQL observation/outcome groups with a pre-DDL renderer seam and
seven offline groups; it is not relabeled as another full37 run. See the
[exact evidence and failures](../audits/2026-09-06-schema-v7-recovery.md).
The previous data-only12/37 proof and fa4's author-reported30 schema groups stay
separate. No installed-role, live capture, cloud restore, retention-duration or
activation claim follows. A new disposable CI step will run the combined schema
lane on the published final head; source configuration is not hosted execution.

## Next isolated run, after combined source review

Use an already running, privately owned disposable PostgreSQL server with
password authentication. The script never manages a server and never drops a
database. Set all of these explicitly:

- `TRACK_B_RECOVERY_TEST_CONFIRM=LOCAL_DISPOSABLE_ONLY`
- `TRACK_B_RECOVERY_TEST_PGHOST=127.0.0.1` and an owned port in
  `TRACK_B_RECOVERY_TEST_PGPORT`
- `TRACK_B_RECOVERY_TEST_PGUSER` and `TRACK_B_RECOVERY_TEST_PGPASSWORD`
- Absolute executable paths `TRACK_B_RECOVERY_TEST_PSQL` and
  `TRACK_B_RECOVERY_TEST_PG_DUMP`; record the actual client/server versions.
  The prior local 12-group data proof used PostgreSQL 16 tools; the dedicated CI
  lane selects PostgreSQL 17 clients. Neither version is inferred for a new run.
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

**Empty-target outcome correction (source, separate from schema execution).**
The prior outcome probe counted only tables/views/sequences, so a target holding
only a public function or type could refuse admission yet incorrectly receive
retry-in-place permission. The probe now observes the exact relation categories,
functions and types checked by admission, with separate receipt counters; missing
or malformed observations remain unknown. Retry requires a confirmed all-zero
target before and after the failed attempt. Seven offline outcome-module groups
pass with intercepted subprocesses; an additional optional private control
reproduces both false permissions in preserved `26691a9da9e685a4e43be7516ee6e58b34f2fcd0`
source (SHA-256 `73a688109b77cf44d9733fdcb226e4909bf2ac950ba7c50d4464097a7d752ba6`).
Command: `node test/track-b-recovery-empty-target.js`. These controls do not claim
real SQL execution or equality of target data from equal object counts. The
coordinator's separate three actual SQL groups at integrated `985ec992` reproduce
both false permissions and prove the corrected refusals plus empty-target
positive, under the declared pre-DDL renderer seam. The existing eight
local-target/CLI preparation groups also remain passing.
