# F27 snapshot-first install and source-exact rollback runbook

**Status:** future, owner-gated operations only. Merging this runbook or its
operator toolkit authorizes no database statement, deployment, drill, flag
write, authority change, webhook change, n8n change, or client-data access.
PR #901 is the prior stop proof: F27 is not installed. The corrective source
and this toolkit must be cloud-reviewed and owner-merged before either window
below can be proposed.

F201/F202/F53 source compatibility is additive and does not change that status:
the parked F27 `mirror_outbox_enqueue` allowlist now includes `labels` and
`description`, plus the Graphics `attachment` operation, so a future F27
install cannot regress any separately gated operation. This is source-only;
F27 remains parked and uninstalled. It authorizes no live F201/F202/F53
constraint change, `production-write` deployment, or real TEST
labels/description/attachment drill.

The runbook is the single mechanical source of truth. Run the sections in
order. Stop on any mismatch; do not reconstruct a command, DDL fragment, source
closure, or drill step from memory.

## P. Separate owner-gated preparatory inbound baseline

This is a distinct quiet-window deployment before the F27 install. It requires
its own explicit owner authorization after this toolkit merges. Do not combine
it with the migration window.

### P.1 Why the preparation is required

The currently deployed `linear-inbound` v39 was built from the floating import
`https://esm.sh/@supabase/supabase-js@2`. Its exact resolved dependency graph is
unrecoverable under every available recovery option: Supabase CLI 2.109.0 can
download source and create a new deployment, but cannot reactivate or restore a
prior ESZip. Source text from v39 therefore cannot reproduce v39's unknown
resolved graph.

The merged toolkit changes only `linear-inbound` to
`npm:@supabase/supabase-js@2.49.8` and commits its frozen per-function
`deno.json` plus Supabase-compatible Deno v4 `deno.lock` (generated and checked
with Deno 2.2.15). No other function import changes here. The six
floating onboarding-family imports are out of scope because their directories
are automatic-deploy path triggers; pinning them is a later deliberate release.

The owner-defined rollback boundary is source exact. If the pinned candidate
fails, redeploy the exact captured provider-returned v39 source paths/bytes and
entrypoint with its captured JWT posture, then independently download the new
deployment and require its source/entrypoint and JWT hashes to match the
capture. The historical transitive graph is unrecoverable, irrelevant to this
standard, and remains recorded as F51. Once the pinned deployment passes, its
version provenance plus source/entrypoint and JWT hashes become the inbound
rollback baseline. The local `deno.json`/`deno.lock` are only a candidate-source
gate; they are never part of a captured live baseline, restore bundle,
deployment readback equality, or historical provenance.

### P.2 Preconditions and capture

From a clean checkout of the exact owner-merged toolkit commit on `origin/main`:

1. read back `prod_authority`, `linear_outbound_enabled`, and
   `linear_legacy_parity_enabled`; require Linear/Linear, F2 off, and F4 false;
2. confirm no F27 database object or rollback row exists;
3. confirm no unrelated deploy is in progress and select a quiet window;
4. record active inbound version/status/JWT posture/provider hash and capture
   its exact provider-returned source paths/bytes and entrypoint:

   ```text
   PROJECT_REF=<private> SUPABASE_ACCESS_TOKEN=<private> \
   node scripts/f27-edge-source-rollback.js capture \
     --slugs=linear-inbound --bundle=<absolute private sealed file>
   ```
5. upload that sealed capture to the approved private Shared Drive with
   `scripts/f27-private-snapshot-store.js --artifact-kind edge-source`,
   independently download it, and require its SHA-256 round-trip to match; and
6. run the hermetic source-restore rehearsal and require captured prior source
   -> throwaway candidate -> captured prior source -> independent source/JWT
   hash readback PASS:

   ```text
   node scripts/f27-edge-source-rollback.js rehearse
   ```

   It must report zero network/provider calls plus exact restored source and
   JWT hashes. This is a source-restore contract test, not an attempt to
   reconstruct a historical dependency graph.

Only hashes, byte lengths, version IDs, JWT posture, and PASS/FAIL results may
enter public evidence. Never publish source closures, access tokens, project
references, private file IDs, webhook bodies, or row bodies.

### P.3 Deploy only pinned inbound

Verify the merged file contains exactly the `2.49.8` npm import and that Deno
accepts the frozen lock without changing it. Deploy **only** `linear-inbound`
with Supabase CLI 2.109.0, the captured JWT setting, and the checked-out merged
source closure. Do not apply the F27 migration and do not deploy any other
function.

Resolve `<CAPTURED_INBOUND_JWT_ARG>` before the window: it is exactly
`--no-verify-jwt` when the captured setting is false and an empty argument when
true. Then run from the clean repository root:

```text
supabase --version
supabase functions deploy linear-inbound \
  --project-ref <private project ref> \
  <CAPTURED_INBOUND_JWT_ARG> --use-docker --yes
```

Stop unless the version output is exactly `2.109.0`. `--use-docker` is the
selected deployment mechanism for this operator command only; it does not
establish rollback exactness or add anything to the captured live baseline.

This pre-migration deployment is fail-safe: the F27 echo path activates only
for a row carrying `rollback_id`; none can exist before the migration, and the
rollback-table lookup is caught and returns to ordinary behavior. The
15-minute reconciler remains the heal-all net.

Immediately read back the new active version, status, JWT posture, provider
hash, and complete downloaded source closure. Require the provider-returned
source paths/bytes, entrypoint, and JWT hashes to match the merged candidate.
The local `deno.json`/`deno.lock` check was completed before deployment and is
not a deployed readback field or rollback equality criterion. Capture only the
successful provider source/entrypoint and JWT posture as the new sealed live
baseline, record the new version as provenance, and run the repository
fingerprint:

```text
PROJECT_REF=<private> SUPABASE_ACCESS_TOKEN=<private> \
node scripts/f27-edge-source-rollback.js capture \
  --slugs=linear-inbound \
  --bundle=<absolute private pinned-inbound baseline file>

PROJECT_REF=<private> SUPABASE_ACCESS_TOKEN=<private> \
node scripts/ef-fingerprint.js <merged preparatory SHA> \
  --slugs=linear-inbound --format=json
```

Store the sealed inbound baseline in the approved private Shared Drive with an
independent byte/hash round-trip. Then run:

```text
SUPABASE_PROJECT_REF=<private 20-character project ref> \
SUPABASE_URL=https://<same project ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<private> \
  node scripts/f27-inbound-freshness.js
```

PASS requires a latest `mirror_in_*` `deliverable_events` row from actor
`Linear webhook` less than six hours old and a nonzero exact count in the last
12 hours. The result exposes no event ID or body. Any deploy/readback/freshness
failure invokes the captured v39 source-exact rollback and stops:

```text
PROJECT_REF=<private> SUPABASE_ACCESS_TOKEN=<private> \
F27_EDGE_ROLLBACK_CONFIRM=RESTORE_CAPTURED_SOURCE_SET:linear-inbound \
node scripts/f27-edge-source-rollback.js restore \
  --slugs=linear-inbound --bundle=<absolute private sealed file> \
  --expected-bundle-sha256=<captured sealed_bundle_sha256> --apply
```

Record the successful pinned inbound version provenance, provider-returned
source/entrypoint hash, JWT posture/hash, provider hash, merged SHA, CLI
version, freshness receipt, and unchanged flags. These become
`PINNED_INBOUND_BASELINE_*` for the later install. That later window does not
redeploy inbound.

## 0. F27 install starting posture and exclusions

The later install requires a separate explicit owner go and a clean checkout
of the then-current owner-merged `origin/main` commit. Fill every value before
opening the window:

```text
RELEASE_SHA=<exact 40-character main SHA>
MIGRATION_SHA256=<checked-in migration SHA-256>
PINNED_INBOUND_BASELINE_VERSION=<successful preparation version>
PINNED_INBOUND_BASELINE_SOURCE_SHA256=<successful preparation closure hash>
PRIOR_LINEAR_OUTBOUND_VERSION=<captured active version>
PRIOR_PRODUCTION_WRITE_VERSION=<captured active version>
PRIOR_DELIVERABLE_WRITE_VERSION=<captured active version>
PRIOR_BATCH_WRITE_VERSION=<captured active version>
PRIOR_RECONCILER_SHA=<captured apply-capable source SHA>
```

Read back, do not infer:

- `prod_authority` is exactly `{"video":"linear","graphics":"linear"}`;
- `linear_outbound_enabled` is exactly `{"mode":"off"}`;
- `linear_legacy_parity_enabled` is exactly `{"enabled":false}`;
- active inbound exactly matches every `PINNED_INBOUND_BASELINE_*` value;
- there are no live F27 objects from a partial attempt and no open real-team
  rollback row; and
- no unrelated migration, deploy, or apply-capable reconciler run is active.

Stop on any mismatch. The install never deploys `linear-inbound`,
`calendar-upsert`, or `sample-review-upsert`; never touches n8n; never flips a
flag or authority; and never uses a real team/client as a drill fixture. Public
evidence contains only hashes, counts, versions, controlled aggregate labels,
and PASS/FAIL assertions.

## 1. Snapshot the live queue and rollback sources before DDL

`mirror_outbox` is a live queue. First create one private, deterministic bundle
inside a `REPEATABLE READ, READ ONLY` transaction:

```text
F27_DATABASE_URL=<private PostgreSQL URL> \
F27_CONFIRM_MIRROR_OUTBOX_SNAPSHOT=1 \
node scripts/f27-mirror-outbox-snapshot.js \
  --mode capture \
  --output-dir <absolute empty private directory> \
  --confirm-project-ref <private project ref> \
  --confirm-database postgres \
  --release-sha <RELEASE_SHA>
```

The tool captures every row in stable primary-key order; the exact old-column
projection; all columns/defaults/indexes/constraints; all non-internal triggers;
every dependent function definition plus owner/ACL/config; RLS/policies/table
owner/grants; the exact three F27 control-flag values and total `flag_flips`
count; database/tool metadata; row count; and public-safe newest-row projections.
The capture must include these boundary identities even when their definitions
do not mention the queue:

```text
public.mirror_outbox_enqueue(text,text,text,jsonb,text,timestamp with time zone,text,text,text,text,text,text,text,bigint,boolean)
public.production_assert_authority(text,text,boolean,boolean)
```

Require `pre_f27_baseline=PASS`: all F27 tables/outbox additions/trigger/indexes
must still be absent, and only those two exact pre-F27 function identities may
exist. The capture also requires clean `HEAD == origin/main == RELEASE_SHA`.

It writes private bytes only beneath the explicit destination and prints a
redacted receipt.

Upload the sealed `.snapshot` file to the existing private Track-B Shared Drive
and independently re-fetch/re-hash it:

```text
F27_CONFIRM_PRIVATE_SNAPSHOT_UPLOAD=1 \
TRACK_B_BACKUP_DRIVE_FOLDER_ID=<private> \
TRACK_B_BACKUP_GOOGLE_CREDENTIALS_JSON=<private> \
node scripts/f27-private-snapshot-store.js \
  --artifact-kind mirror-outbox \
  --source <absolute private .snapshot file> \
  --expected-sha256 <snapshot_bundle_sha256>
```

The destination must resolve as one writable/listable Shared Drive folder.
My Drive, a repository path, symlinks, overwrites, duplicate names, a missing
credential, or any metadata/byte/hash mismatch fails closed.

Before DDL also capture one sealed source-exact bundle for the **four** functions
that this install will deploy:

```text
PROJECT_REF=<private> SUPABASE_ACCESS_TOKEN=<private> \
node scripts/f27-edge-source-rollback.js capture \
  --slugs=linear-outbound,production-write,deliverable-write,batch-write \
  --bundle=<absolute private sealed file>
```

For these four historical deployments, “source exact” is the owner-defined
boundary: exact provider-returned source paths/bytes and entrypoint plus JWT
posture. Their capture contains no synthetic lock/config and makes no
historical ESZip or transitive-graph claim. Historical graphs are unrecoverable,
irrelevant to this standard, and remain recorded as F51.

Capture the prior apply-capable reconciler source/workflow SHA separately.
Store the Edge bundle in the same approved private destination with
`--artifact-kind edge-source --source <sealed file> --expected-sha256 <sealed_bundle_sha256>`
and prove independent readback. `linear-inbound` is represented by its already-
proven pinned source/entrypoint and JWT baseline; do not recapture it during the
install window.

Still before DDL, render the database half of the one-shot rollback from the
exact sealed snapshot. The destination is a new private `.sql` file outside
every worktree:

```text
F27_CONFIRM_DATABASE_ROLLBACK_RECIPE=1 \
node scripts/f27-database-rollback-recipe.js \
  --bundle=<absolute private .snapshot file> \
  --expected-bundle-sha256=<snapshot_bundle_sha256> \
  --output=<absolute new private rollback .sql file> \
  --confirm-project-ref=<private project ref> \
  --confirm-database=postgres \
  --release-sha=<RELEASE_SHA>
```

Require `static_validation=PASS`, `private_readback=PASS`, and record only the
returned rollback recipe SHA-256. Do not proceed unless the recipe, snapshot,
release, project, and database binders all match.

The evidence PR receives only:

```text
snapshot_manifest_sha256=<hash>
snapshot_bundle_sha256=<hash>
mirror_outbox_row_count=<count>
pre_f27_baseline=PASS
pre_f27_baseline_sha256=<hash>
newest_public_safe_rows=<rank/team/status/time/private-row-sha256 only>
constraint_definition_sha256=<hash>
trigger_definition_sha256=<hash>
dependent_function_closure_sha256=<hash>
table_boundary_definition_sha256=<hash>
runtime_flags=<three controlled values>
runtime_safety_state_sha256=<controlled-value/count hash>
flag_flips_count=<count>
local_private_readback=PASS
prior_function_versions=<four version IDs>
prior_function_source_closure_sha256=<four hashes>
independent_private_readback=PASS
```

If any row, definition, prior source, reconciler source, or private round-trip is
incomplete, do not apply DDL.

## 2. Prove the exact source

From the clean `RELEASE_SHA` checkout:

1. prove the SHA is current `origin/main` and owner-merged;
2. verify the migration hash and the generated checklist with
   `node scripts/f27-install-checklist.js --check`;
3. require the only F27-target dependency change to be the inbound
   `npm:@supabase/supabase-js@2.49.8` pin plus its frozen lock/config;
4. run the full offline unit suite, the edge source rollback rehearsal, and the
   disposable F27 PostgreSQL proof; use the migrated disposable database to run
   snapshot mode `fingerprint-post` and retain its public-safe
   `f27_post_contract_sha256` for the live readback;
5. require `F27_PROOF_OK`, late pre-authorized insert rejection, complete
   reserved drill assertions, and `f27_lane_dormant`; and
6. prove both frozen writer directories are byte-identical to their captured
   hashes and absent from the deploy set.

The inbound lock proof uses the compatible runtime named in source, with no
lock rewrite permitted:

```text
deno --version
deno cache --frozen \
  --config supabase/functions/linear-inbound/deno.json \
  supabase/functions/linear-inbound/index.ts
git diff --exit-code -- \
  supabase/functions/linear-inbound/deno.json \
  supabase/functions/linear-inbound/deno.lock
```

Require Deno `2.2.15`, lock format `4`, and a clean diff. No other function
directory gains a dependency lock in this scoped release. This is solely a
predeploy candidate-source gate. It is not captured from live state, added to a
restore bundle, compared during deployed readback, or treated as historical
dependency provenance.

The disposable exact-contract command is:

```text
F27_DISPOSABLE_DATABASE_URL=<loopback disposable PostgreSQL URL> \
F27_CONFIRM_DISPOSABLE_POST_CONTRACT=1 \
node scripts/f27-mirror-outbox-snapshot.js \
  --mode fingerprint-post \
  --confirm-database <disposable database name> \
  --release-sha <RELEASE_SHA>
```

No failure is waived. Apply the exact checked-in migration bytes; do not edit a
copy in a SQL editor.

## 3. Apply the migration and let its self-probe guard COMMIT

The migration owns `BEGIN` and `COMMIT`. Near the end it creates a savepoint,
calls the new `mirror_outbox_enqueue` with one reserved synthetic TEST intent
under the new generation fence, proves acceptance, and rolls back to that
savepoint before COMMIT.

Apply the file once through the release/hash/project-bound operator. The private
output directory must already exist, be empty, and be outside every worktree:

```text
F27_DATABASE_URL=<private PostgreSQL URL> \
F27_CONFIRM_APPLY_MIGRATION=APPLY_F27_MIGRATION_ONCE \
node scripts/f27-apply-migration.js \
  --output-dir <absolute empty private migration-transcript directory> \
  --snapshot-bundle <absolute private .snapshot file> \
  --expected-snapshot-bundle-sha256 <snapshot_bundle_sha256> \
  --confirm-project-ref <private project ref> \
  --confirm-database postgres \
  --release-sha <RELEASE_SHA> \
  --expected-migration-sha256 <MIGRATION_SHA256>
```

The tool passes the connection only through the private psql environment,
requires clean `HEAD == origin/main == RELEASE_SHA`, lets the migration own its
transaction, and writes psql bytes to one private content-addressed transcript.
It also re-verifies that the sealed snapshot is the true pre-F27 baseline for
this exact release, migration, project, and database before invoking psql.
Public evidence receives only its hashes and the terminal
`migration_transaction_and_self_probe=PASS`; the echoed
`snapshot_bundle_sha256` must exactly equal the Section 1 baseline. Do not wrap
the file, remove the self-probe, retry selected statements, force a constraint,
or substitute a manual probe. Any SQL/self-probe error before COMMIT rolls the
transaction back. A transport or acknowledgement ambiguity is **UNKNOWN**:
never retry, preserve the private transcript, run only the read-only
`verify-after` below against the sealed baseline to determine landed/not-landed,
and stop for owner review.

Immediately use the snapshot tool's `verify-after` mode against the sealed
baseline:

```text
F27_DATABASE_URL=<private PostgreSQL URL> \
F27_CONFIRM_MIRROR_OUTBOX_VERIFY_AFTER=1 \
node scripts/f27-mirror-outbox-snapshot.js \
  --mode verify-after \
  --bundle <absolute private .snapshot file> \
  --expected-bundle-sha256 <snapshot_bundle_sha256> \
  --expected-post-contract-sha256 <disposable f27_post_contract_sha256> \
  --confirm-project-ref <private project ref> \
  --confirm-database postgres \
  --release-sha <RELEASE_SHA>
```

It must prove:

- row count equals the pre-DDL count;
- every old-column projection has the identical stable hash;
- new F27 columns have only expected defaults;
- no synthetic migration probe remains;
- the two real-team fences exist at generation zero;
- zero rollback row and zero rollback intent exists;
- expected new constraints, indexes, trigger, dependent functions, grants, and
  RLS match the checked-in migration; and
- the three exact control flags and total `flag_flips` count equal the sealed
  pre-DDL baseline.

The database tool cannot attest deployed artifacts. In the same stop gate,
independently read back the active pinned inbound version/source/JWT hash and
both frozen-writer live versions/source hashes, and compare them with their
captured pre-window baselines. Record those separate PASS results beside the
database receipt.

Any row loss/change, residual probe, definition mismatch, flag audit, inbound
drift, or frozen-writer drift runs Section 7 and stops before deployment.

## 4. Deploy the remaining fenced closures

Deploy in this order from the same clean `RELEASE_SHA` checkout:

1. `linear-outbound`;
2. `production-write`;
3. `deliverable-write`;
4. `batch-write`.

The last two include the changed `_shared/b4-write.ts`. `linear-inbound` is
already live at the pinned preparatory baseline and is not redeployed. The
merged reconciler must pass its generation-binder and fenced-requeue tests
before its next apply-capable run.

For each function, deploy with the recorded CLI/JWT mode; read back active
version, status, JWT setting, provider hash, and complete source closure; and
run `scripts/ef-fingerprint.js RELEASE_SHA` for the exact four-slug set. Require
every source hash to match. A version integer or deploy-success message alone is
not proof.

Resolve each `<CAPTURED_*_JWT_ARG>` before the window by the same exact rule as
Section P, then execute these commands individually and stop after the first
failure:

```text
supabase functions deploy linear-outbound \
  --project-ref <private project ref> <CAPTURED_LINEAR_OUTBOUND_JWT_ARG> --use-docker --yes
supabase functions deploy production-write \
  --project-ref <private project ref> <CAPTURED_PRODUCTION_WRITE_JWT_ARG> --use-docker --yes
supabase functions deploy deliverable-write \
  --project-ref <private project ref> <CAPTURED_DELIVERABLE_WRITE_JWT_ARG> --use-docker --yes
supabase functions deploy batch-write \
  --project-ref <private project ref> <CAPTURED_BATCH_WRITE_JWT_ARG> --use-docker --yes
PROJECT_REF=<private> SUPABASE_ACCESS_TOKEN=<private> \
node scripts/ef-fingerprint.js <RELEASE_SHA> \
  --slugs=linear-outbound,production-write,deliverable-write,batch-write \
  --format=json
```

Here too, `--use-docker` is only the selected deployment mechanism. Exactness
comes from the independent provider source/entrypoint and JWT readback, not the
deployment transport or a reconstructed dependency graph.

Run non-mutating denial/source-contract checks. An ordinary request with no
rollback selector must remain on the established path; an unconfirmed F27
selector must fail closed; the normal outbound lane remains dormant because F2
is off. Stop and run Section 7 on any mismatch.

## 5. Run the reserved drill and retain its audit

Use only the merged reserved team constant `__f27_drill__` and the packaged
runner:

```text
SUPABASE_URL=https://<private project ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<private> \
node scripts/f27-drill-runner.js \
  --confirm=F27_RESERVED_DRILL_ONLY \
  --confirm-project=<private project ref> \
  --actor=<public-safe operator label>
```

If any response may have been lost after the drill opened, **do not start a
second drill**. Copy only the public refusal receipt's reserved v4
`rollback_id`, keep the identical project and actor, and resume exactly once:

```text
SUPABASE_URL=https://<private project ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<private> \
node scripts/f27-drill-runner.js \
  --confirm=F27_RESERVED_DRILL_RESUME \
  --confirm-project=<same private project ref> \
  --resume-rollback-id=<receipt rollback_id> \
  --actor=<same public-safe operator label>
```

Resume binds the exact reserved row, project, and actor, then advances only
from its persisted unclassified/classified/terminal/finalized stage. A normal
start refuses while any reserved drill remains open. Never infer or substitute
a rollback ID.

The runner re-reads the exact Linear/Linear, F2-off, F4-false posture; opens one
`is_drill=true` rollback; validates its immutable snapshot/hash; refuses the
wrong classifications; classifies the exact synthetic intent for replay; calls
the deployed replay lane; validates the exact-bound correlated terminal receipt
and `no_external_call=true`; proves idempotent receipt readback; invokes the real
final authority CAS and requires `f27_drill_authority_cas_refused`; then closes
the drill through its drill-only finalizer.

Before/after hashes must prove no real-team row, fence, flag, or flag-flip count
changed. No external Linear request may carry the drill correlation. The drill row,
snapshot, intent, outbox result, and receipts are permanent audit history:
never delete or clean them up.

## 6. Verify dormant and assemble public evidence

Run the inbound freshness checker again and require PASS. Then read back:

- Linear/Linear authority unchanged;
- F2 off and F4 false unchanged, with zero flag-flip delta;
- no open real-team rollback row and no open drill row;
- replay selection finds no eligible open rollback, so `f27Replay` is dormant;
- active pinned inbound still matches its preparatory baseline;
- all four deployed versions/source hashes match `RELEASE_SHA`;
- frozen writers are byte-identical and were not deployed;
- the old-column queue snapshot remains exact; and
- no n8n workflow or real client/team row changed.

The draft evidence PR contains only the release SHA, migration/snapshot/source
hashes, counts, version IDs, public-safe newest-row aggregates, self-probe and
definition PASS results, source readbacks, freshness receipt, drill hashes and
aggregate assertions, permanent-audit statement, invariant-by-invariant
readback, and the filled Section 7 rollback manifest.

The operator declares the session final but does not merge the evidence PR.
Completion still requires independent cloud review of live state and owner
merge. Enabling outbound/shadow, changing authority, or changing n8n is a
separate owner-gated operation.

## 7. Exact one-shot rollback prepared before DDL

Supabase CLI 2.109.0 cannot activate a prior deployed ESZip. Its recovery path
downloads source and creates a new deployment/version, so the old version ID is
provenance rather than an activation handle.

For every F27-target function, the final rollback standard is the same:
redeploy the exact captured provider-returned source paths/bytes and entrypoint
with its captured JWT posture, then independently download the deployment and
require its source/entrypoint and JWT hashes to equal the capture. The prepared
inbound's local Deno v4 config/lock remains a predeploy candidate-source gate
only; it is excluded from the captured live baseline, restore bundle,
deployment readback equality, and historical provenance.

No step attempts to reactivate an old ESZip or reconstruct a historical
transitive dependency graph. That graph is unrecoverable for the currently
deployed functions and remains the accepted F51 platform limitation; it is not
required by this source-exact behavioral rollback standard. Prior version IDs
are provenance only, while restored deployments receive new version IDs.

Section 1 generated and readback-verified one private database recipe from the
sealed pre-DDL snapshot. The complete one-shot rollback performs these phases:

1. stop and prove zero in-flight apply-capable reconciler runs; restore its
   prior source/workflow closure or keep APPLY disabled;
2. restore the captured owner-defined source-exact closure and JWT setting for
   the four functions deployed in Section 4, creating new active version IDs;
   independently read back and require each provider source/entrypoint and JWT
   hash to equal capture;
   leave inbound at its unchanged pinned preparatory baseline (or redeploy that
   exact pinned baseline only if independent readback proves it drifted);
3. in one database transaction, lock `mirror_outbox`, disable the new
   `track_b_f27_hold_guard`, restore every captured pre-install dependent
   function/trigger definition and enabled state, and revoke F27 mutating RPC
   grants while retaining the additive F27 columns/tables, disabled
   trigger/guard function, and every drill/audit row;
4. before COMMIT, compare every captured pre-install queue row through the old-
   column projection and require exact equality while allowing later rows; and
5. after COMMIT, read back operative definitions/hashes, restored source
   closures, pinned inbound baseline, reconciler posture, flags, frozen-writer
   hashes, revoked F27 mutation grants, zero open rollback rows, and retained
   audit evidence.

Never restore a row dump over the live queue. Never drop the additive F27 schema
or delete audit evidence as operational rollback. Any later schema retirement
is a separate reviewed retention migration.
The recipe must retain the additive F27 columns/tables, disabled trigger/guard function,
and every audit row.

The generated private SQL uses the captured object identity and includes this
exact behavior kill before restoring the captured operative definitions:

```sql
ALTER TABLE public.mirror_outbox DISABLE TRIGGER track_b_f27_hold_guard;
```

The exact four-function source restore is executed only from its sealed bundle:

```text
PROJECT_REF=<private> SUPABASE_ACCESS_TOKEN=<private> \
F27_EDGE_ROLLBACK_CONFIRM=RESTORE_CAPTURED_SOURCE_SET:batch-write,deliverable-write,linear-outbound,production-write \
node scripts/f27-edge-source-rollback.js restore \
  --slugs=linear-outbound,production-write,deliverable-write,batch-write \
  --bundle=<absolute private sealed file> \
  --expected-bundle-sha256=<captured sealed_bundle_sha256> --apply
```

Then execute the already-hashed private database recipe exactly once. The
executor rechecks clean `HEAD == origin/main == RELEASE_SHA`, all four binders,
the generated SQL contract, the strict Supabase database endpoint/TLS posture,
and streams the verified bytes to psql without placing the URL, password, or
recipe path in argv:

```text
F27_DATABASE_URL=<private PostgreSQL URL> \
F27_CONFIRM_DATABASE_ROLLBACK_EXECUTE=EXECUTE_F27_DATABASE_ROLLBACK \
node scripts/f27-database-rollback-execute.js \
  --recipe=<absolute private rollback .sql file> \
  --expected-recipe-sha256=<rollback_script_sha256> \
  --transcript=<absolute new private rollback transcript> \
  --release-sha=<RELEASE_SHA> \
  --confirm-project-ref=<private project ref> \
  --confirm-database=postgres \
  --snapshot-bundle-sha256=<snapshot_bundle_sha256>
```

Require `execution=PASS`, private transcript readback PASS, and the exact
recipe/snapshot/transcript hashes. Any failure preserves the private transcript
and stops; never retry selected statements.

The manifest is complete before the forward window:

```text
rollback_recipe_sha256=<private generated SQL recipe hash>
baseline_snapshot_manifest_sha256=<Section 1 hash>
baseline_snapshot_bundle_sha256=<Section 1 hash>
linear-inbound=<pinned preparation version + provider-source/entrypoint/JWT hashes>
linear-outbound=<prior version + provider-source/entrypoint/JWT hashes>
production-write=<prior version + provider-source/entrypoint/JWT hashes>
deliverable-write=<prior version + provider-source/entrypoint/JWT hashes>
batch-write=<prior version + provider-source/entrypoint/JWT hashes>
reconciler=<prior Git SHA + closure hash + restore/disable action>
table_boundary_definition_sha256=<Section 1 hash>
private_round_trip=PASS
source_restore_rehearsal=PASS
```

<!-- F27_INSTALL_CHECKLIST_BEGIN -->
## Operator checklist

### Separate preparatory inbound window -- requires its own owner go

- [ ] Confirm clean owner-merged `origin/main`, quiet window, Linear/Linear, F2 off, F4 false, no F27 objects, and no unrelated deploy.
- [ ] Capture exact active v39 version provenance, provider-returned source paths/bytes and entrypoint, and JWT posture privately; record that historical transitive graphs are unrecoverable, irrelevant to the source-exact standard, and remain F51.
- [ ] Prove private Shared Drive store -> re-fetch -> SHA-256 match and the hermetic throwaway prior -> candidate -> restore -> source/JWT readback rehearsal.
- [ ] Prove only `linear-inbound` changed to `npm:@supabase/supabase-js@2.49.8` with frozen `deno.json`/`deno.lock`; onboarding-family floats remain untouched for a later deliberate release.
- [ ] Deploy only `linear-inbound`; independently read back exact provider source/entrypoint and JWT hashes plus new version provenance; run inbound freshness immediately; confirm flags, authority, n8n, schema, and all other functions unchanged. The local lock is only the completed candidate-source gate.
- [ ] Record the successful pinned inbound version provenance plus source/entrypoint and JWT hashes as the new exact baseline. Stop; do not start the F27 install without a new owner go.

### F27 install window -- separately owner-gated

- [ ] Confirm exact current owner-merged main SHA, generated-checklist hash, pinned inbound baseline, Linear/Linear, F2 off, F4 false, no partial F27 state, and no active unrelated operation.
- [ ] Before DDL, capture the full repeatable-read queue/definition bundle; require `pre_f27_baseline=PASS` (zero F27 tables/outbox columns/constraints/index/trigger/unexpected functions and exactly the two allowed boundary identities); seal it; store it in the approved private Shared Drive; independently re-fetch and re-hash it.
- [ ] Before DDL, capture/seal/private-round-trip the prior exact source/JWT closure for `linear-outbound`, `production-write`, `deliverable-write`, and `batch-write`, plus the prior reconciler closure.
- [ ] Before DDL, generate/read back the private database rollback recipe from the sealed snapshot, record `rollback_recipe_sha256`, and prefill the exact Edge restore plus database executor commands with every release/project/database/snapshot binder.
- [ ] Run all source, inbound candidate-source lock, frozen-writer, source/JWT rollback-rehearsal, unit, disposable-PostgreSQL, and public-hygiene gates. Stop on any failure.
- [ ] Apply the exact migration once through the tool mechanically bound to the sealed snapshot; require its identical echoed snapshot hash and pre-COMMIT enqueue savepoint/self-probe. A transport/ack ambiguity is UNKNOWN: never retry; run only read-only verify-after and stop for owner review.
- [ ] Run snapshot `verify-after`; require preserved count/old-column hashes, no residual probe, exact F27 definitions/grants/defaults, unchanged authority/F2/F4 and flag-flip count, and zero rollback rows/intents. Separately read back pinned inbound and both frozen writers.
- [ ] Deploy only the four remaining fenced closures in runbook order; require exact version/JWT/source readback and fingerprints. Do not deploy inbound or either frozen writer.
- [ ] Run only the `__f27_drill__` drill; require snapshot/classification/replay/correlated receipt and the correct authority-CAS refusal. On a lost response, resume the exact reported UUID with `F27_RESERVED_DRILL_RESUME`; never open a second drill. Preserve all audit rows.
- [ ] Run inbound freshness and dormant-state readbacks; require no real-team/open rollback, replay dormant, unchanged authority/F2/F4, exact function hashes, unchanged queue, frozen writers, and n8n.
- [ ] Fill the source-exact rollback manifest and public-safe evidence PR; declare final only after cloud live-state review. Owner alone merges.
<!-- F27_INSTALL_CHECKLIST_END -->
