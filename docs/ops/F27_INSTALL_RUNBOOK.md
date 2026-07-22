# F27 snapshot-first install and exact rollback runbook

**Status:** future, owner-gated operation. This file describes how to install
the corrective F27 source after its draft PR is cloud-reviewed and owner-merged.
It is not authorization to run any command. PR #901 records the correctly
aborted earlier attempt; no F27 object was installed then.

This recipe is bound to these repository paths:

- `migrations/2026-07-20-f27-team-rollback.sql`
- `supabase/functions/linear-outbound/`
- `supabase/functions/linear-inbound/`
- `supabase/functions/production-write/`
- `supabase/functions/deliverable-write/` and
  `supabase/functions/batch-write/`, whose closure includes
  `supabase/functions/_shared/b4-write.ts`
- `scripts/linear-deliverables-reconcile.js`

Fill every placeholder from the merged corrective release before opening the
change window:

```text
CORRECTIVE_PR=<owner-merged corrective PR>
RELEASE_SHA=<exact 40-character merge SHA on main>
MIGRATION_SHA256=<sha256 of migrations/2026-07-20-f27-team-rollback.sql at RELEASE_SHA>
PRIOR_LINEAR_OUTBOUND_VERSION=<captured live version>
PRIOR_LINEAR_INBOUND_VERSION=<captured live version>
PRIOR_PRODUCTION_WRITE_VERSION=<captured live version>
PRIOR_DELIVERABLE_WRITE_VERSION=<captured live version>
PRIOR_BATCH_WRITE_VERSION=<captured live version>
PRIOR_RECONCILER_SHA=<captured pre-F27 main/source closure>
```

An unresolved placeholder, non-`main` SHA, dirty source closure, failed
fingerprint, missing prior artifact/source closure, or changed starting posture
is a stop. The owner opens the window; the cloud reviewer verifies the final
live state. The installer never merges the source PR and never flips authority.

## 0. Required starting posture and exclusions

Read back, do not infer:

- `prod_authority` is exactly `{"video":"linear","graphics":"linear"}`;
- `linear_outbound_enabled` is exactly `{"mode":"off"}`;
- `linear_legacy_parity_enabled` is exactly `{"enabled":false}`;
- there are no live F27 tables/functions/trigger/columns from an earlier partial
  attempt; and
- no unrelated migration or deploy is in progress.

Stop on any mismatch. This installation leaves all three values unchanged.
It must not deploy `calendar-upsert` or `sample-review-upsert`, touch n8n, read or
write a real client row for testing, or run a real-team rollback. Public evidence
contains only hashes, counts, versions, aggregate assertions, and synthetic
identifiers.

## 1. Snapshot the live queue before any DDL

`mirror_outbox` is a live queue. Create a private, immutable snapshot bundle
before beginning the migration. The bundle must contain all rows and all schema
and code needed to put the table boundary back exactly:

1. a transactionally consistent full `mirror_outbox` row export in stable
   primary-key order, plus the exact ordered pre-install column list used to
   reproduce the same projection after additive columns exist;
2. row count and the newest N rows as public-safe projections: rank, team,
   status, timestamp, and canonical private-row SHA-256 only (no IDs, clients,
   payloads, actors, or bodies in the PR), plus aggregate team/status counts;
3. every table constraint from `pg_constraint`, including its name, type,
   validation state and `pg_get_constraintdef(..., true)`;
4. every non-internal trigger from `pg_trigger`, including enabled state and
   `pg_get_triggerdef(..., true)`;
5. `pg_get_functiondef` plus owner/ACL/config for every trigger function and
   every public function whose definition references `mirror_outbox`, including
   the pre-install `mirror_outbox_enqueue` and `production_assert_authority`
   closures;
6. columns, defaults, indexes, RLS state/policies, table owner and grants;
7. the prior deployed source closure, version ID, JWT setting, and downloaded
   server fingerprint for every Edge Function listed above, plus the prior
   reconciler script/workflow source closure and Git SHA needed to restore an
   apply-capable run; and
8. the exact `RELEASE_SHA`, migration bytes/hash, CLI/toolchain version, project
   ref, database server version, and snapshot time.

Use a repeatable-read, read-only database transaction for the database bundle.
Hash each file, then hash a stable manifest containing relative path, byte
length, and file SHA-256. Make the private bundle immutable/read-only and copy it
to the approved private backup location. Independently download and re-hash it
before DDL. The draft evidence PR records only:

```text
snapshot_manifest_sha256=<hash>
mirror_outbox_row_count=<count>
newest_public_safe_rows=<rank/team/status/time/private-row-sha256 only>
newest_public_safe_aggregates=<team/status counts only>
constraint_definition_sha256=<hash>
trigger_definition_sha256=<hash>
dependent_function_closure_sha256=<hash>
prior_function_versions=<version ids only>
prior_function_source_closure_sha256=<hashes>
independent_private_readback=PASS
```

Never paste row bodies, client values, credentials, connection strings, or the
private artifact URL into the repository or Actions output. If the row export,
definitions, prior function closures, or independent readback are incomplete,
do not apply DDL.

## 2. Prove the exact source before applying it

From a clean checkout of `RELEASE_SHA`:

1. confirm the SHA is the owner-merged corrective commit on `main`;
2. verify `MIGRATION_SHA256` against the checked-out migration;
3. run the full offline unit suite and the disposable F27 PostgreSQL proof;
4. require its terminal `F27_PROOF_OK`, including
   `late_pre_authorized_insert_rejected`, the complete drill assertions, and
   `f27_lane_dormant`; and
5. confirm the two frozen writer directories are byte-identical to their
   captured pre-window hashes.

No failure is waived. Do not edit the migration in the SQL editor: apply the
exact checked-in bytes as one transaction.

## 3. Apply the migration; let its self-probe guard COMMIT

The exact migration owns `BEGIN` and `COMMIT`. Near its end, before `COMMIT`, it
creates `SAVEPOINT f27_enqueue_probe`, calls the new `mirror_outbox_enqueue`
with one reserved synthetic TEST intent bound to the current Video generation,
then `ROLLBACK TO SAVEPOINT`. Therefore the same migration transaction proves
the new columns, constraints, enqueue function, and trigger accept a
representative enqueue while leaving no probe row.

Apply the file once. Do not wrap it in a second transaction, remove the
self-probe, retry selected statements, force a constraint, or manually insert a
substitute probe. Any error—including the probe—is a full abort. Capture the
client transcript privately and record only the migration hash, transaction
success/failure, and public-safe probe result in the evidence PR.

Immediately after commit, read back and compare:

- `mirror_outbox` count equals the pre-DDL snapshot count;
- every pre-existing row projected through the captured pre-install column
  list has the same canonical hash as the private snapshot; the new F27 columns
  are checked separately for their expected defaults (a whole-row hash would
  legitimately change when additive columns appear);
- the synthetic migration dedup/entity/client values do not exist;
- the two real team fences exist at generation 0;
- there are zero rollback rows and zero rollback intents;
- the F27 columns, constraints, indexes, trigger, function definitions, grants,
  and RLS posture match `RELEASE_SHA`;
- the three runtime flag values and their `flag_flips` count are unchanged; and
- frozen writer live/source fingerprints are unchanged.

Any row loss, changed pre-existing row, residual probe, definition mismatch,
flag audit, or frozen-writer drift invokes the rollback in §7; do not continue
to deployment.

## 4. Deploy every changed runtime closure from the same merge

The generation fence is a cross-layer contract. Release the exact
`RELEASE_SHA` closures for `linear-outbound`, `linear-inbound`,
`production-write`, `deliverable-write`, and `batch-write`; do not mix SHAs.
`deliverable-write` and `batch-write` include the changed `_shared/b4-write.ts`.
The repository reconciler already comes from the merged SHA and must pass its
generation-binder and fenced-requeue source tests before its next apply-capable
run. Capture its prior source closure/restore SHA before the window; it is part
of rollback, not an unversioned operational script.

`calendar-upsert` and `sample-review-upsert` are explicitly excluded and remain
byte-identical. No merge/push side effect may deploy them. No n8n workflow is
changed.

For each deployed function:

1. record the prior version ID and private prior source closure before deploy;
2. deploy from the clean exact-SHA checkout with the pinned toolchain/JWT mode;
3. read back active version, status, JWT setting, provider bundle hash, and full
   downloaded source closure; and
4. run `scripts/ef-fingerprint.js RELEASE_SHA --slugs=<exact slugs>` and require
   `PASS` for every slug.

A version integer alone is not source proof. A warning plus a passing deploy is
not source proof. Stop and roll back if any downloaded closure differs.

After readback, exercise only public-safe non-mutating/denial checks. Confirm an
ordinary request with no rollback selector stays on the established path, an
F27 selector without the exact confirmation fails closed, and the normal
outbound lane remains dormant because F2 is off.

## 5. Run the bounded drill and retain its audit

Use only the reserved `__f27_drill__` scope. Never substitute a real client or
team. The drill sequence is:

1. call `track_b_f27_begin_drill` with an exact Linear/Linear expected value;
2. read back the one-row immutable snapshot, row hash, aggregate snapshot hash,
   reserved binding, and open drill ledger;
3. prove quarantine/discard/already-reflected are refused, then classify that
   exact intent `replay` with a public-safe drill reason;
4. call `linear-outbound` for that exact rollback/dedup with the case-sensitive
   confirmation `F27_ROLLBACK_DRILL`;
5. verify the deterministic hash-bearing receipt is exact-bound, says
   `no_external_call=true`, and is already stored on the intent atomically with
   the synthetic outbox terminal;
6. re-present that exact returned receipt through
   `track_b_f27_record_terminal` and require the idempotent readback. If the
   HTTP response was lost, read the same immutable receipt from the intent
   ledger; never hand-build a substitute;
7. invoke the real `track_b_f27_finalize` only as the negative assertion and
   require `f27_drill_authority_cas_refused`; and
8. call `track_b_f27_finalize_drill`, requiring one complete terminal audit and
   zero open rollback rows.

Before and after, hash/compare all real-team outbox rows and both real-team
fences; read back all three control flags and the `flag_flips` count. They must
be unchanged. Provider/Linear request telemetry must show no request from the
drill correlation. The drill row, intent, outbox result and receipts are
permanent audit history: **do not delete or clean them up**.

## 6. Required evidence and completion gate

The draft evidence PR must contain only public-safe proof:

- exact corrective PR and `RELEASE_SHA`;
- migration and private snapshot-manifest SHA-256 values;
- pre/post row counts, canonical equality result, and newest-row aggregates;
- constraint/trigger/dependent-function definition hashes before and after;
- migration self-probe accepted-and-rolled-back result;
- prior/new Edge Function version IDs and exact-source fingerprint PASS rows;
- drill snapshot/receipt hashes and aggregate assertions, with identifiers
  redacted or replaced by stable public-safe labels;
- explicit permanent audit retention;
- frozen-writer hashes before/after;
- exact runtime flags and zero flag-flip delta; and
- the filled rollback manifest from §7.

State every invariant individually: Linear/Linear unchanged; F2 off unchanged;
F4 false unchanged; no open rollback; no real team/client row touched by the
drill; frozen writers byte-identical/not deployed; no n8n change; no client data
mutation. The session is not complete until a cloud reviewer independently
verifies the live readback. The owner alone decides whether the separate live
install PR is merged/closed.

## 7. Exact one-shot rollback prepared before DDL

Rollback is generated from the private snapshot, not reconstructed from memory
or the repository baseline. Before DDL, prepare and syntax-check one operator
script with these exact phases:

1. stop and verify zero in-flight apply-capable reconciler runs; restore its
   captured prior script/workflow closure (or keep APPLY disabled), then
   redeploy each prior Edge Function source closure/artifact and JWT setting
   and read back every captured prior version/source fingerprint;
2. in one database transaction, take the outbox lock, disable the newly added
   `track_b_f27_hold_guard` trigger on `mirror_outbox`, and restore every
   captured pre-install function/trigger definition and enabled state so old
   writers regain their exact boundary. Revoke the F27 mutating RPC grants, but
   retain the additive F27 columns/tables, disabled trigger/guard function, and
   every drill/rollback audit row as inert evidence; operational rollback is
   not schema erasure;
3. before committing, compare every pre-install queue row through the captured
   old-column projection and require exact count/hash equality. Separately hash
   and retain only the explicitly bound synthetic drill audit rows; and
4. after commit, read back all prior operative definitions/hashes, prior
   function and reconciler closures, flags, frozen-writer hashes, revoked F27
   mutation grants, zero open rollback rows, and retained audit evidence.

The generated script must embed or consume the captured `pg_get_*def` and
`pg_get_functiondef` outputs and exact object identities. The explicit
`ALTER TABLE public.mirror_outbox DISABLE TRIGGER track_b_f27_hold_guard` is
required to restore the old operative boundary while obeying the additive-only
rule; do not drop its audit tables/columns, do not restore rows over a live
queue, and do not delete audit evidence. Any later schema retirement is a
separate, reviewed retention
migration; it is never part of the one-shot operational rollback and never
pretends a completed drill did not exist.

The rollback manifest must be copy-paste complete before the forward window:

```text
rollback_script_sha256=<private generated script hash>
baseline_snapshot_manifest_sha256=<hash from section 1>
linear-outbound=<prior version + source closure hash + restore artifact>
linear-inbound=<prior version + source closure hash + restore artifact>
production-write=<prior version + source closure hash + restore artifact>
deliverable-write=<prior version + source closure hash + restore artifact>
batch-write=<prior version + source closure hash + restore artifact>
reconciler=<prior Git SHA + script/workflow closure hash + restore/disable action>
database_definition_bundle_sha256=<hash>
rollback_rehearsal=<scratch result and observer>
```

If the platform cannot restore an exact prior function artifact, the operation
remains blocked under F51. Rebuilding old source with floating dependencies is
not an exact rollback.
