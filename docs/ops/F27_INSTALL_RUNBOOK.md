# F27 snapshot-first install and source-exact rollback runbook

**Status: INSTALLED AND PRODUCTION-VERIFIED 2026-08-02.** Attempt 2 ran from
exact release `968a895108beb2a2c41e86bb8b788115e35b14a0`: the exact migration
applied once with transaction/self-probe PASS, Section 4 run `30763278795`
deployed and read back all four protected closures, the reserved drill returned
`F27_DRILL_RUNNER_OK`, and the packaged verifier returned
`F27_FINAL_VERIFICATION_OK` with PASS across all 17 enumerated assertions. At
window close the installed inbound v40, outbound v35, production v27,
deliverable v26, and batch v26 closures were ACTIVE; parity had been restored
to enabled and the reconciler was ACTIVE, quiescent, and monitor-only with
default `apply=false`.

The 2026-08-01 attempt and its successful Section 7 rollback remain part of the
record. Superseded 2026-08-01 status: “the operative F27 install remains rolled back and parked.”
Attempt 2 explicitly entered from that exact retained Section 7 boundary; it
does not erase or recast the failed attempt. Sections P–6 below are retained as the exact executed install contract
and as a recovery/reinstall reference. Section 7 remains the defective-release
rollback path. No text in this runbook authorizes a database statement,
deployment, drill, flag write, authority change, webhook change, n8n change, or
client-data access without a fresh owner go.

F201/F202/F53 source compatibility is additive: the installed F27
`mirror_outbox_enqueue` allowlist now includes `labels` and
`description`, plus the Graphics `attachment` operation. This current status authorizes no new
F201/F202/F53 constraint change, `production-write` deployment, or real TEST
labels/description/attachment drill.

For any separately owner-approved recovery or reinstall, this runbook remains
the single mechanical source of truth. Run the applicable sections in order.
Stop on any mismatch; do not reconstruct a command, DDL fragment, source
closure, or drill step from memory.

## P. Separate owner-gated preparatory inbound baseline

For the completed install, preparation was split into a read-only
capture/rehearsal gate (P.2) and the inbound deployment/readback gate (P.3).
The same separation remains mandatory for any future recovery or reinstall:
never cross from P.2 into P.3 without the exact current owner go, and never
combine either with the migration window.

### P.1 Why the preparation is required

The pre-P.3 `linear-inbound` v39 was built from the floating import
`https://esm.sh/@supabase/supabase-js@2`. Its exact resolved dependency graph is
unrecoverable under every available recovery option: Supabase CLI 2.109.0 can
download source and create a new deployment, but cannot reactivate or restore a
prior ESZip. Source text from v39 therefore cannot reproduce v39's unknown
resolved graph.

P.3 changed only `linear-inbound` to
`npm:@supabase/supabase-js@2.49.8` and commits its frozen per-function
`deno.json` plus Supabase-compatible Deno v4 `deno.lock` (generated and checked
with Deno 2.2.15). No other function import changes here. The six
floating onboarding-family imports are out of scope because their directories
are automatic-deploy path triggers; pinning them is a later deliberate release.

The owner-defined rollback boundary is source exact. P.3 passed and established
the installed v40 source/entrypoint/JWT artifact as the pinned inbound rollback
baseline. If that artifact must be recovered, use only the captured exact
baseline and require an independent deployed source/entrypoint/JWT hash match;
the provider-returned v39 source remains the pre-P.3 restoration artifact, not
the current baseline. The historical transitive graph is unrecoverable,
irrelevant to this standard, and remains recorded as F51. The local
`deno.json`/`deno.lock` are only a candidate-source
gate; they are never part of a captured live baseline, restore bundle,
deployment readback equality, or historical provenance.

### P.2 Preconditions and capture

From a clean checkout of the exact owner-merged toolkit commit on `origin/main`:

1. read back `prod_authority`, `linear_outbound_enabled`, and
   `linear_legacy_parity_enabled`; require Linear/Linear and F2 off, record F4
   exactly, and leave it unchanged. The owner-approved 2026-07-28 early arm
   permits F4 true in this preparatory window; never disarm it here. The later
   F27 drill/finalization window still requires F4 false;
2. require exactly one of the two reviewed entry states below. They are a
   closed union: any partial retained install, extra object, definition drift,
   unresolved intent, unexplained generation, or grant drift is a hard stop.

   - `pristine_pre_f27`: the only F27 objects present are
     `public.track_b_f27_team_fences` (exact schema/owner/constraints, exactly
     Video and Graphics at generation 0, no `PUBLIC`/`anon`/`authenticated` or
     unexpected grantee access, and `service_role` SELECT only) and
     `public.track_b_f27_write_authorization(text)` (exact
     source/attributes/ACL).
   - `exact_post_section7`: every additive table, column, constraint, index,
     function, implicit table type, and disabled hold trigger retained by
     Section 7 matches its reviewed definition; the three operative boundary
     functions match the captured preinstall definitions; table grants remain
     service-role SELECT-only; all eight mutating RPCs have no non-owner
     EXECUTE grant; there is no open rollback or unresolved intent; and each
     real-team fence is a nonnegative preserved generation backed by one exact,
     contiguous completed-real-rollback audit chain from generation zero.
     Terminal drill audit is retained and does not advance a real-team fence.

   The preexisting `public.mirror_outbox_enqueue(...)` boundary must retain its
   reviewed owner-default plus exact service-role-only EXECUTE posture so its
   captured preinstall ACL remains source-exact for rollback.
   The preexisting non-F27
   `public.production_assert_authority(text,text,boolean,boolean)` must also be
   present and match the applied 2026-07-12 definition/attributes/ACL. Function
   source comparisons normalize CRLF and lone CR to LF on both sides before
   exact comparison; this accepts the browser-SQL-editor line-ending difference
   without rewriting the live function. Table-owner ACL vocabulary is
   PostgreSQL-version-dependent (including `MAINTAIN` on newer versions), so the
   fence-table access check is semantic rather than a hardcoded owner aclitem.
   Any state other than those two exact contracts is a hard stop. The
   2026-08-01 production receipt is corroborating evidence, not an allowlist:
   restored three-function boundary SHA-256
   `c4fa6e8e34feb187980a616a076d2aa1f5b7580a4c76204d2661ba3e208296d9`
   and successful private rollback transcript SHA-256
   `e884b7d369389388ed5e55c376f3518f4fdc4379e64c683596adf4cb9ab2772c`.
   Reviewed source and catalog predicates, rather than either receipt alone,
   define `exact_post_section7`;

   Run the executable read-only P gate from the exact owner-merged release:

   ```text
   F27_DATABASE_URL=<private> F27_CONFIRM_WINDOW_P_PREFLIGHT=1 \
   node scripts/f27-mirror-outbox-snapshot.js \
     --mode window-p-preflight \
     --confirm-project-ref <private project ref> \
     --confirm-database postgres \
     --release-sha <exact owner-merged origin/main SHA>
   ```

   It applies the same exact catalog/row predicate used by the later sealed
   snapshot while requiring the owner-approved P posture: Linear/Linear, F2
   off, and F4 true unchanged. It is one repeatable-read, read-only transaction,
   writes no artifact, and publishes only hashes, counts, flags, versions, and
   PASS/FAIL. Record its `mirror_outbox_non_terminal_row_count`;
> **Operator conventions (owner ruling 2026-08-19).** Two standing rules for
> every capture/deploy from here on:
>
> 1. **One fixed capture folder.** Sealed bundles go to a single dedicated
>    directory on the operator machine, reused for every deploy -- never the
>    Desktop, never a per-deploy folder. Earlier deploys scattered bundles
>    across several locations, which makes "which bundle is current?" a
>    question that has to be reconstructed instead of read. The literal path is
>    intentionally NOT recorded here: this repository is public and F64 keeps
>    operator-local paths out of commits. Any command handed to the owner must
>    already point at that folder.
> 2. **Always link the workflow.** Any instruction that names a GitHub Actions
>    workflow must include its direct Actions URL, not just its filename.
>
3. confirm no unrelated deploy is in progress and select a quiet window;
4. record active inbound version/status/JWT posture/provider hash and capture
   its exact provider-returned source paths/bytes and entrypoint:

   ```text
   PROJECT_REF=<private> SUPABASE_ACCESS_TOKEN=<private> \
   node scripts/f27-edge-source-rollback.js capture \
     --slugs=linear-inbound --bundle=<absolute private sealed file>
   ```
5. upload that sealed capture to the root folder `SyncView Backups/` of the
   approved private Shared Drive with
   `scripts/f27-private-snapshot-store.js --artifact-kind edge-source`,
   independently download it, and require its SHA-256 round-trip to match.
   For this store command, set `TRACK_B_BACKUP_DRIVE_FOLDER_ID` explicitly to
   that root ID. Do not copy the repository variable with the same name: it
   belongs to the weekly backup and identifies
   `SyncView Backups/track-b-backups/`;
   and
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

**Current owner boundary (2026-07-30 mechanism change): build and review the
P.3 CI lane only.** Do not dispatch it from this change. The owner merges the
reviewed lane, and only the owner or a fresh explicit owner go dispatches it.
No migration, deploy, flag change, or client write is authorized while the
lane PR is under review.

### P.3 Deploy only pinned inbound

P.3 deploys through the dispatch-only
`.github/workflows/deploy-f27-linear-inbound.yml` lane. It has no push or pull
request trigger. Its `commit_sha` input is hard-bound to the reviewed release
`661e5b1bf9dc0643c89d09d47b93a1362c5af275`; the workflow checks out and
deploys exactly that commit after proving it is on current main.

Before dispatch, confirm the protected `production` Environment permits only
main and exposes `SUPABASE_ACCESS_TOKEN`,
`F27_PRIVATE_SHARED_DRIVE_ROOT_ID`, and
`TRACK_B_BACKUP_GOOGLE_CREDENTIALS_JSON` as secrets. The folder identity must
not be supplied as an Actions variable because public-repository step
environment listings can expose variable values. Never use a workflow input
for a project reference, Drive/file identity, credential, source closure, or
token.

`F27_PRIVATE_SHARED_DRIVE_ROOT_ID` means the root folder
`SyncView Backups/`. It never means the weekly backup child
`SyncView Backups/track-b-backups/`, and the P.3 lane deliberately has no
fallback to `TRACK_B_BACKUP_DRIVE_FOLDER_ID`. Before deployment, the lane
rejects a fetch receipt whose root ID SHA-256 is not
`9d1480048b17bcd038650c4d3191e12cb94b65938374ab335b955a9cab2df042`.

Dispatch the forward operation only after the owner go:

```text
gh workflow run deploy-f27-linear-inbound.yml --ref main \
  -f commit_sha=661e5b1bf9dc0643c89d09d47b93a1362c5af275 \
  -f operation=deploy-reviewed-release \
  -f confirm=DEPLOY_REVIEWED_LINEAR_INBOUND
```

Both operations require Supabase CLI `2.109.0`, a live local Docker daemon,
and the independently verified sealed v39 bundle described below. The forward
operation additionally fails before mutation unless all of these are exact:

- Deno `2.2.15`;
- the sole `npm:@supabase/supabase-js@2.49.8` source import;
- the reviewed frozen `deno.json` and `deno.lock` bytes, followed by a
  successful `deno cache --frozen` that changes neither file nor the function
  tree;
- the five-file merged candidate source closure hash; and
- the captured JWT argument `--no-verify-jwt`.

Before either forward deployment or rollback, the lane privately fetches the
content-addressed v39 sealed bundle from the approved `SyncView Backups/`
Shared Drive root, requires one exact object, and independently verifies its
49,968 bytes and
`cd0b391962a18b5e912dacf0c0e63c2ae972818343d1c41f77058039dd570690`
SHA-256 into a `0700` runner directory and `0600` file. The public receipt
distinguishes a missing object from a non-unique object and reports only the
configured folder ID's SHA-256,
`9d1480048b17bcd038650c4d3191e12cb94b65938374ab335b955a9cab2df042`,
never the folder ID. A different folder hash is a hard stop. Only then may the
forward operation execute the sole literal deploy command:

```text
supabase functions deploy linear-inbound \
  --project-ref <masked project ref> \
  --no-verify-jwt --use-docker --yes
```

Raw provider/Drive output and private material stay in the runner's bounded
temporary directory and are deleted on every outcome. Public receipts contain
only PASS/FAIL, versions, hashes, byte/file counts, and JWT posture.
`--use-docker` is mandatory; any indication of server-side bundling is a hard
stop. Docker deployment plus a successful command still does not establish
rollback exactness or replace provider source readback.

This pre-migration deployment is fail-safe: the F27 echo path activates only
for a row carrying `rollback_id`; none can exist before the migration, and the
rollback-table lookup is caught and returns to ordinary behavior. The
15-minute reconciler remains the heal-all net.

After the forward workflow reports PASS, return to the existing local
Node-only readback/capture path. Immediately read back the new active version,
status, JWT posture, provider hash, and complete downloaded source closure.
Require the provider-returned source paths/bytes, entrypoint, and JWT hashes to
match the merged candidate. The CI `deno.json`/`deno.lock` check was completed
before deployment and is not a deployed readback field or rollback equality
criterion. Capture only the successful provider source/entrypoint and JWT
posture as the new sealed live baseline, record the new version as provenance,
and run the repository fingerprint:

```text
PROJECT_REF=<private> SUPABASE_ACCESS_TOKEN=<private> \
node scripts/f27-edge-source-rollback.js capture \
  --slugs=linear-inbound \
  --bundle=<absolute private pinned-inbound baseline file>

PROJECT_REF=<private> SUPABASE_ACCESS_TOKEN=<private> \
node scripts/ef-fingerprint.js <merged preparatory SHA> \
  --slugs=linear-inbound --format=json
```

Store the sealed inbound baseline in the approved private `SyncView Backups/`
Shared Drive root with an independent byte/hash round-trip. Then run:

```text
SUPABASE_PROJECT_REF=<private 20-character project ref> \
SUPABASE_URL=https://<same project ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<private> \
  node scripts/f27-inbound-freshness.js
```

PASS requires a latest `mirror_in_*` `deliverable_events` row from actor
`Linear webhook` less than six hours old and a nonzero exact count in the last
12 hours. The result exposes no event ID or body.

A pre-mutation gate failure stops without a restorative production write. Once
the forward deploy command begins, any ambiguous/failed deploy response or any
post-deploy readback/capture/freshness failure invokes the captured v39
source-exact rollback and stops. Never retry the forward operation. The retry
path is the `restore-captured-v39` operation of the **same workflow**, with the
same pinned release SHA:

```text
gh workflow run deploy-f27-linear-inbound.yml --ref main \
  -f commit_sha=661e5b1bf9dc0643c89d09d47b93a1362c5af275 \
  -f operation=restore-captured-v39 \
  -f confirm=RESTORE_CAPTURED_V39_LINEAR_INBOUND
```

That operation re-fetches the exact sealed v39 bytes, invokes
`f27-edge-source-rollback.js restore` with the captured hash and confirmation,
uses Supabase CLI 2.109.0 plus Docker, and requires provider-returned
source/entrypoint and JWT readback to match the three-file v39 closure. It
must not reconstruct v39 from a Git commit and must not use server-side
bundling.

Record the successful pinned inbound version provenance, provider-returned
source/entrypoint hash, JWT posture/hash, provider hash, merged SHA, CLI
version, freshness receipt, and unchanged flags. These become
`PINNED_INBOUND_BASELINE_*` for the later install. That later window does not
redeploy inbound.

## 0. F27 install starting posture and exclusions

The later install requires a separate explicit owner go and a clean checkout
of the then-current owner-merged `origin/main` commit. Fill every value in this
pre-window sheet before opening the window:

```text
RELEASE_SHA=<exact 40-character main SHA>
MIGRATION_SHA256=<checked-in migration SHA-256>
PINNED_INBOUND_BASELINE_VERSION=<successful preparation version>
PINNED_INBOUND_BASELINE_SOURCE_SHA256=<successful preparation closure hash>
PINNED_INBOUND_BASELINE_BUNDLE_SHA256=<sealed preparation source-bundle SHA-256>
PINNED_INBOUND_BASELINE_BUNDLE_BYTE_LENGTH=<sealed preparation source-bundle byte length>
PRIOR_LINEAR_OUTBOUND_VERSION=<captured active version>
PRIOR_PRODUCTION_WRITE_VERSION=<captured active version>
PRIOR_DELIVERABLE_WRITE_VERSION=<captured active version>
PRIOR_BATCH_WRITE_VERSION=<captured active version>
PRIOR_FOUR_SOURCE_BUNDLE_SHA256=<captured sealed bundle SHA-256>
PRIOR_FOUR_SOURCE_BUNDLE_BYTE_LENGTH=<captured sealed bundle byte length>
PRIOR_RECONCILER_SHA=<captured apply-capable source SHA>
PRIOR_RECONCILER_CLOSURE_SHA256=<captured workflow/runtime closure SHA-256>
PRIOR_RECONCILER_BUNDLE_SHA256=<captured sealed reconciler bundle SHA-256>
PRIOR_RECONCILER_BUNDLE_BYTE_LENGTH=<captured sealed reconciler bundle byte length>
N8N_ORIGIN_SHA256=<SHA-256 of the canonical private HTTPS n8n origin>
N8N_INSTANCE_WIDE_WORKFLOW_READ_CONFIRM=CONFIRMED_INSTANCE_WIDE_WORKFLOW_READ
```

Derive `N8N_ORIGIN_SHA256` privately from the same `N8N_BASE_URL` later supplied
to the checker. This command emits only the hash and refuses a URL with
userinfo, a path, query, fragment, or non-default port:

```text
node -e "const c=require('node:crypto');const r=String(process.env.N8N_BASE_URL||'').trim();let u;try{u=new URL(r)}catch{process.exit(1)}if(u.protocol!=='https:'||!u.hostname||u.username||u.password||u.port||u.pathname!=='/'||u.search||u.hash||(r!==u.origin&&r!==u.origin+'/'))process.exit(1);process.stdout.write(c.createHash('sha256').update(u.origin,'utf8').digest('hex')+'\n')"
```

These eight in-window fields do not exist before the owner opens the window.
Sections 1-2 create them after the workflow-disable/F4-false preconditions and
before DDL; fill each immediately after its sealed capture and private
readback:

```text
PRE_F27_ENTRY_STATE=<pristine_pre_f27|exact_post_section7>
PRE_F27_FENCE_GENERATIONS_SHA256=<sealed preserved-generation binder>
PRE_F27_RETAINED_AUDIT_SHA256=<sealed retained rollback/intent binder>
F27_POST_CONTRACT_SHA256=<normalized exact-source post-contract SHA-256>
F27_POST_CONTRACT_RAW_INVENTORY_SHA256=<private disposable raw-inventory SHA-256>
F27_POST_CONTRACT_RAW_INVENTORY_BYTE_LENGTH=<private disposable raw-inventory byte length>
FINAL_VERIFICATION_BASELINE_SHA256=<sealed Section 2 baseline for Section 6>
FINAL_VERIFICATION_BASELINE_BYTE_LENGTH=<sealed Section 2 baseline byte length>
```

The reconciler capture is read-only; it does not stop or edit the workflow.
GitHub run records do not expose the dispatch input needed to distinguish
`apply=true` from a monitor dispatch. A default-false source check followed by
one zero-run observation is therefore raceable and is not sufficient. As the
first action inside the separately authorized install window, manually disable
the workflow, then run the read-only verifier:

```text
gh workflow disable linear-deliverables-reconcile.yml \
  --repo sidney-afk/client-analytics

GH_TOKEN=<private GitHub token> \
node scripts/f27-reconciler-closure.js verify-disabled \
  --release-sha=<RELEASE_SHA> \
  --bundle=<absolute private sealed reconciler bundle> \
  --expected-bundle-sha256=<PRIOR_RECONCILER_BUNDLE_SHA256> \
  --expected-bundle-byte-length=<PRIOR_RECONCILER_BUNDLE_BYTE_LENGTH> \
  --expected-closure-sha256=<PRIOR_RECONCILER_CLOSURE_SHA256>
```

The verifier itself never disables, enables, cancels, reruns, or dispatches a
workflow. Require exact captured closure equality, workflow state
`disabled_manually`, two zero `queued`, `in_progress`, `waiting`, `pending`, or
`requested` scans, and byte-stable complete paginated run inventories whose
every row is terminal. The inventory is read before the first fragmented
status scan and again after the second; any partial page, count drift, active
row, completion transition, or state change fails closed. Keep the workflow disabled
through Sections 1-6 and through any Section 7 rollback. A completed
reconciler conclusion is not part of this gate: in particular, the known
pre-existing PostgreSQL `57014` cancellation at `loadLiveData` is neither a
green nor a red F27 readiness signal. Do not rerun, repair, or change its
timeout/read behavior in this window.

Read back, do not infer:

- `RELEASE_SHA` is at or after `1738ad3` (2026-07-24 Slice 4): the live outbox
  operation CHECK already includes `labels`, `description`, and `attachment`
  (five migrations applied 2026-07-24, see `EXECUTION_LOG.md`), so an older
  toolkit checkout would regress that live constraint;
- `prod_authority` is exactly `{"video":"linear","graphics":"linear"}`;
- `linear_outbound_enabled` is exactly `{"mode":"off"}`;
- `linear_legacy_parity_enabled` is exactly `{"enabled":false}`;
- active inbound exactly matches every `PINNED_INBOUND_BASELINE_*` value;
- exactly one reviewed preinstall entry state is present and unchanged:
  `pristine_pre_f27` or `exact_post_section7`. The former has only the two
  reviewed F27 prerequisites plus the reviewed preexisting operative boundary;
  the latter has the complete exact retained Section 7 inventory, preserved
  generation/audit chain, zero open or unresolved work, disabled hold trigger,
  restored operative boundary, and all eight mutating grants revoked. Both
  states require the reviewed service-role-only `mirror_outbox_enqueue` ACL and
  reject every extra overload/object/grant; and
- no unrelated migration or deploy is active; the reconciler workflow is
  `disabled_manually`; and its two complete run-state observations each find
  zero potentially apply-capable non-terminal runs.

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
The capture must include these preinstall boundary identities even when their
definitions do not mention the queue:

```text
public.mirror_outbox_enqueue(text,text,text,jsonb,text,timestamp with time zone,text,text,text,text,text,text,text,bigint,boolean)
public.track_b_f27_write_authorization(text)
public.production_assert_authority(text,text,boolean,boolean)
```

Require `pre_f27_baseline=PASS` and record its exact `entry_state`. The gate is
one closed union, not a compatibility warning:

- `pristine_pre_f27` requires the exact reviewed fence table and write-
  authorization function, exactly Video and Graphics at generation zero, and
  no other F27 table/function/column/constraint/index/trigger or rollback row;
- `exact_post_section7` requires every additive object retained by the generated
  Section 7 recipe to match reviewed source and catalog semantics exactly. It
  requires the hold trigger disabled, the three operative functions restored to
  their captured preinstall definitions, all eight mutating RPCs owner-only,
  the exact service-role-only table grants, no open rollback, no unresolved
  intent, and a complete retained real-team generation audit chain. Each team
  starts at generation zero, every completed real rollback advances exactly
  once, and the current fence equals the end of that contiguous chain; terminal
  drill audit is retained but never advances a real-team fence.

Both states require the preexisting `public.mirror_outbox_enqueue(...)` to
retain owner-default privileges plus exactly one non-owner service-role EXECUTE
grant. Both require the exact captured 2026-07-12
`public.production_assert_authority(text,text,boolean,boolean)` definition,
attributes, and ACL. Normalize CRLF and lone CR to LF on both sides of reviewed
function-body predicates; do not rewrite a live function merely to alter
whitespace. Any state outside those two exact contracts is a hard failure,
never a warning. Record the non-terminal `mirror_outbox` count, entry-state
contract hash, preserved-generation hash, and retained-audit hash from this
same repeatable-read transaction. The capture also requires clean
`HEAD == origin/main == RELEASE_SHA`.

On `PRE_F27_BASELINE_REQUIRED`, the capture must first retain one canonical
content-addressed `f27-retained-state-failure-*.inventory.json` beneath the
already-protected private output directory. Require
`private_retained_state_inventory=PASS` plus its SHA-256, byte length, record
count, and entry-state receipt. The inventory is emitted before the unchanged
gate inside the same `REPEATABLE READ, READ ONLY` transaction; a missing,
partial, or unreadable inventory fails instead as
`RETAINED_STATE_EVIDENCE_WRITE_FAILED`. Never publish the private file.

For a retained-state refusal, diagnose the exact source contract without
changing the database:

```text
F27_DATABASE_URL=<private PostgreSQL URL> \
F27_CONFIRM_RETAINED_STATE_DIAGNOSE=1 \
node scripts/f27-retained-state-diagnose.js \
  --confirm-project-ref <private project ref> \
  --confirm-database postgres \
  --release-sha <RELEASE_SHA>
```

The diagnostic extracts all 21 ordered predicates from the migration between
the reviewed preinstall markers and executes those fragments source-exactly in
one `REPEATABLE READ, READ ONLY` transaction. Its single public-safe JSON names
every predicate as PASS/FAIL; a root FAIL includes only bounded object identity
and expected/observed catalog metadata when that difference is source-derived.
Otherwise it says `difference_isolated=false`, emits only a predicate-scoped
contract hash plus bounded category receipts, and directs the operator to the
private same-transaction inventory rather than guessing at a culprit. Function
bodies are represented only by normalized SHA-256. `scope=READ_ONLY_DIAGNOSTIC_ONLY` is evidence, never an
install-authorizing terminal; later predicates remain their raw PASS/FAIL and
are labelled downstream/additional rather than rewritten. Any FAIL still stops
the window for owner review. The diagnostic itself writes no artifact. The
private file described above belongs only to the preceding snapshot refusal
and remains beneath that snapshot's explicit protected destination.

Upload the sealed `.snapshot` file to the private `SyncView Backups/` Shared
Drive root and independently re-fetch/re-hash it. This is not the
`track-b-backups/` child used by the weekly backup:

```text
F27_CONFIRM_PRIVATE_SNAPSHOT_UPLOAD=1 \
TRACK_B_BACKUP_DRIVE_FOLDER_ID=<private Shared Drive root ID> \
TRACK_B_BACKUP_GOOGLE_CREDENTIALS_JSON=<private> \
node scripts/f27-private-snapshot-store.js \
  --artifact-kind mirror-outbox \
  --source <absolute private .snapshot file> \
  --expected-sha256 <snapshot_bundle_sha256>
```

The destination must resolve as the writable/listable Shared Drive root.
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

This operator capture refuses before its first provider read unless
`PROJECT_REF` equals the one exact project target in the clean reviewed
release and the installed Supabase CLI is exactly 2.109.0. After sealing, it
reopens the bundle and privately requires every captured provider record to
match that project, CLI, the approved Management readback adapter, and the
Docker source-restore adapter. Require public `provider_contract=PASS` before
upload or DDL; a mismatch is a hard pre-DDL stop.

Capture the exact prior reconciler workflow/runtime closure separately from the
four-function provider bundle:

```text
node scripts/f27-reconciler-closure.js capture \
  --release-sha=<RELEASE_SHA> \
  --bundle=<absolute new private sealed reconciler bundle>
```

The operator reads raw Git blob bytes from the exact clean
`HEAD == origin/main == RELEASE_SHA` tree. Its reviewed closure is the workflow,
the CommonJS package boundary, both literal workflow entrypoints, and every
recursive repository-local runtime dependency. A missing, dynamic, external,
new, or path-escaping dependency fails closed instead of being omitted. Require
one public-safe PASS receipt containing the prior Git SHA, closure SHA-256,
sealed-bundle SHA-256/byte length, file count, `rollback_action=keep_apply_disabled`,
and local private readback.

The closure is exactly these eleven sorted raw-Git blobs—no glob and no
operator-selected path:

1. `.github/workflows/linear-deliverables-reconcile.yml`
2. `package.json`
3. `scripts/b3-linkage-backfill.js`
4. `scripts/f200-attribution-plan.js`
5. `scripts/f200-attribution.js`
6. `scripts/linear-deliverables-reconcile-lib.js`
7. `scripts/linear-deliverables-reconcile.js`
8. `scripts/linear-reconcile-inbound-pager.js`
9. `scripts/monitoring-alert-relay.js`
10. `scripts/monitoring-watchdog.js`
11. `scripts/prod-authority-guard.js`

Entries 9 and 10 joined on 2026-08-04, when the reconcile workflow began
recording its own heartbeat and running the dead-man's-switch check, and the
pager moved to the shared alert-relay client. Both are read/alert only: they
reconcile nothing, apply nothing, and touch no runtime flag or authority
value. See `docs/audits/2026-08-04-monitoring-readiness-cutover.md`.

The fingerprint frames each sorted repository path and its raw blob byte
length/bytes before SHA-256. The capture refuses comment-obscured, computed,
aliased, dynamic, external, new, or path-escaping module loading; it never
silently broadens or truncates the inventory. In addition, every one of the
eleven raw blobs is pinned to its separately reviewed SHA-256 in the operator.
Any runtime byte change therefore fails closed even if it does not alter an
obvious import. A reconciler source change requires its own reviewed update to
that map before a later install; the live window never edits or relaxes it.

Store and independently re-fetch the distinct reconciler artifact:

```text
F27_CONFIRM_PRIVATE_SNAPSHOT_UPLOAD=1 \
TRACK_B_BACKUP_DRIVE_FOLDER_ID=<private Shared Drive root ID> \
TRACK_B_BACKUP_GOOGLE_CREDENTIALS_JSON=<private> \
node scripts/f27-private-snapshot-store.js \
  --artifact-kind reconciler-source \
  --source <absolute private sealed reconciler bundle> \
  --expected-sha256 <PRIOR_RECONCILER_BUNDLE_SHA256>
```

Require the same root identity, unique immutable object, byte-length, and
independent SHA-256 round-trip as the other F27 artifacts. Never place this
closure inside the Edge source bundle: the Section 4 deploy/restore lane must
continue to consume exactly four provider closures. After the explicit
workflow disable in Section 0, run `verify-disabled` immediately before the
final-verification baseline capture and again immediately before DDL.

Store the Edge bundle in the same approved private destination with
`--artifact-kind edge-source --source <sealed file> --expected-sha256 <sealed_bundle_sha256>`
and prove independent readback. `linear-inbound` is represented by its already-
proven pinned source/entrypoint and JWT baseline; do not recapture it during the
install window.

This Node-only Section 1 operation, not the Section 4 deploy workflow, produces
the four `PRIOR_*_VERSION` values plus the sealed bundle SHA-256 and byte
length. It requires the exact CLI version for provenance but needs no Docker,
and must finish before DDL. The Section 4 lane only consumes and independently
verifies that already-sealed baseline; discovering or creating a prior capture
during deployment would be too late.

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
pre_f27_entry_state=<pristine_pre_f27|exact_post_section7>
preserved_fence_generations_sha256=<hash>
retained_audit_sha256=<hash>
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
prior_reconciler_sha=<Git SHA>
prior_reconciler_closure_sha256=<hash>
prior_reconciler_bundle_sha256=<hash>
n8n_origin_sha256=<hash>
n8n_instance_wide_workflow_read=PASS
final_verification_baseline_sha256=<hash>
final_verification_baseline_byte_length=<count>
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
   disposable F27 PostgreSQL 17 proof; after merge, dispatch the reviewed
   post-contract capture lane so the migrated disposable database produces the
   public-safe normalized hash and seals the private raw seven-category
   inventory to the Shared Drive root for the live readback;
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

The disposable exact-contract capture is dispatch-only. From current `main`,
dispatch `.github/workflows/f27-post-contract-capture.yml` with exactly:

```text
workflow=f27-post-contract-capture.yml
ref=main
commit_sha=<RELEASE_SHA>
operation=capture-reviewed-post-contract
confirm=CAPTURE_REVIEWED_F27_POST_CONTRACT
```

The lane must prove that its exact checked-out SHA is current `origin/main`, use
only `postgres:17`, run `fingerprint-post`, and publish the sole raw inventory
through `f27-private-snapshot-store.js --artifact-kind
post-contract-inventory`. It aliases the protected
`F27_PRIVATE_SHARED_DRIVE_ROOT_ID` secret to the store helper's legacy
process-local folder variable; it never reads the repository variable that
identifies `track-b-backups/`. Require `private_round_trip=PASS`, the expected
root-ID SHA-256 receipt, and record
`F27_POST_CONTRACT_SHA256`, `F27_POST_CONTRACT_RAW_INVENTORY_SHA256`, and
`F27_POST_CONTRACT_RAW_INVENTORY_BYTE_LENGTH`. The lane must not upload the raw
inventory as a GitHub artifact or print it.

Independently re-fetch the sole content-addressed inventory into a new private
path outside every worktree:

```text
F27_PRIVATE_SHARED_DRIVE_ROOT_ID=<SyncView Backups root ID> \
TRACK_B_BACKUP_GOOGLE_CREDENTIALS_JSON=<private> \
F27_CONFIRM_PRIVATE_SNAPSHOT_FETCH=FETCH_PRIVATE_POST_CONTRACT_INVENTORY:<F27_POST_CONTRACT_RAW_INVENTORY_SHA256> \
node scripts/f27-private-snapshot-fetch.js \
  --artifact-kind post-contract-inventory \
  --destination <absolute new private expected .inventory.json path> \
  --expected-sha256 <F27_POST_CONTRACT_RAW_INVENTORY_SHA256> \
  --expected-byte-length <F27_POST_CONTRACT_RAW_INVENTORY_BYTE_LENGTH>
```

Require `independent_private_readback=PASS` and `local_private_readback=PASS`.
The fetched file contains the unnormalized disposable records for exactly `columns`,
`constraints`, `triggers`, `functions`, `indexes`, `table_boundaries`, and
`function_execute_grants`; never publish its definitions or raw ACL text.
The normalized contract proves owner privileges relative to the running
server's `acldefault(...)` and compares every non-owner grant exactly, so a
PostgreSQL privilege-vocabulary change cannot alter the contract by itself.

After that exact post-contract hash exists, capture the last pre-DDL comparison
baseline. This command is read-only against PostgreSQL, Supabase, n8n, and
GitHub. It performs only `REPEATABLE READ READ ONLY` database transactions and
GET-only external reads, and writes one new private sealed file outside every
worktree:

```text
F27_DATABASE_URL=<private PostgreSQL URL> \
SUPABASE_ACCESS_TOKEN=<private> \
SUPABASE_URL=https://<same private project ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<private> \
GH_TOKEN=<private GitHub token> \
N8N_BASE_URL=<private HTTPS n8n base URL> \
N8N_API_KEY=<private instance-wide workflow-read n8n API credential> \
F27_CONFIRM_FINAL_BASELINE=CAPTURE_F27_FINAL_BASELINE \
node scripts/f27-final-verification.js capture-baseline \
  --output-dir=<absolute new empty private baseline directory> \
  --release-sha=<RELEASE_SHA> \
  --project-ref=<private project ref> \
  --database=postgres \
  --snapshot-bundle=<absolute private mirror-outbox snapshot> \
  --snapshot-sha256=<snapshot_bundle_sha256> \
  --pinned-inbound-bundle=<absolute private pinned-inbound source bundle> \
  --pinned-inbound-sha256=<PINNED_INBOUND_BASELINE_BUNDLE_SHA256> \
  --prior-four-bundle=<absolute private prior-four source bundle> \
  --prior-four-sha256=<PRIOR_FOUR_SOURCE_BUNDLE_SHA256> \
  --prior-four-byte-length=<PRIOR_FOUR_SOURCE_BUNDLE_BYTE_LENGTH> \
  --reconciler-capture=<absolute private reconciler bundle> \
  --reconciler-capture-sha256=<PRIOR_RECONCILER_BUNDLE_SHA256> \
  --reconciler-release-sha=<PRIOR_RECONCILER_SHA> \
  --reconciler-closure-sha256=<PRIOR_RECONCILER_CLOSURE_SHA256> \
  --expected-post-contract-sha256=<F27_POST_CONTRACT_SHA256> \
  --n8n-origin-sha256=<N8N_ORIGIN_SHA256> \
  --n8n-read-scope=<N8N_INSTANCE_WIDE_WORKFLOW_READ_CONFIRM>
```

Before the command, canonicalize `N8N_BASE_URL` to its exact HTTPS origin
(`https://host`, with no path, query, fragment, userinfo, or non-default port),
SHA-256 those UTF-8 origin bytes privately, and record only
`N8N_ORIGIN_SHA256`. The verifier checks that hash before it constructs an n8n
credential header or performs a request. Require production scope and
`F27_FINAL_BASELINE_CAPTURE_OK`, record
`FINAL_VERIFICATION_BASELINE_SHA256` and
`FINAL_VERIFICATION_BASELINE_BYTE_LENGTH`, and privately resolve the sole file
as
`<output-dir>/f27-final-baseline-<FINAL_VERIFICATION_BASELINE_SHA256>.f27final`.
The sealed payload contains hashes, counts, versions, JWT posture, and semantic
inventory fingerprints only—never database rows, provider source, n8n bodies,
project refs, credentials, or private paths. It binds the complete
`public.clients` and `public.team_members` tables, not merely F27-reachable
rows.

The n8n API key must belong to an instance-owner or equivalent principal whose
workflow-list permission is instance-wide. Confirm that posture in the private
n8n control plane and use the exact value-sheet confirmation above. A
project-scoped, shared-project-only, or otherwise filtered key is a hard stop:
pagination can prove completeness only over workflows visible to the supplied
principal. The baseline seals `n8n_read_scope=INSTANCE_WIDE`; the checker never
silently infers global visibility from a successful partial list.

Store it at the approved Shared Drive root and require the independent
byte/hash re-fetch:

```text
F27_CONFIRM_PRIVATE_SNAPSHOT_UPLOAD=1 \
TRACK_B_BACKUP_DRIVE_FOLDER_ID=<private Shared Drive root ID> \
TRACK_B_BACKUP_GOOGLE_CREDENTIALS_JSON=<private> \
node scripts/f27-private-snapshot-store.js \
  --artifact-kind final-verification \
  --source <absolute private .f27final file> \
  --expected-sha256 <FINAL_VERIFICATION_BASELINE_SHA256>
```

Require `independent_private_readback=PASS`. Re-run
`f27-reconciler-closure.js verify-disabled` immediately after the baseline
round-trip and immediately before DDL. Any warning, skipped adapter, incomplete
page, unstable provider version, or missing binder stops the window.

No failure is waived. Apply the exact checked-in migration bytes; do not edit a
copy in a SQL editor.

## 3. Apply the migration and let its self-probe guard COMMIT

The migration owns `BEGIN` and `COMMIT`. Before its first persistent DDL, its
locked preinstall gate must classify the database as exactly
`pristine_pre_f27` or `exact_post_section7`. From the pristine state it creates
the absent additive objects. From the retained state it definition-checks and
adopts every retained additive object, preserves both fence generations and all
terminal audit rows, and advances only the three operative function definitions
and the disabled hold trigger into the installed posture. It never truncates a
ledger, resets a fence, or treats `IF NOT EXISTS` as proof of equality. Any
partial/drifted retained state aborts before persistent DDL.

Near the end it creates a savepoint, calls the new `mirror_outbox_enqueue` with
one reserved synthetic TEST intent under the preserved generation fence, proves
acceptance, and rolls back to that savepoint before COMMIT. The self-probe is
identical for both entry states.

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
It also re-verifies that the sealed snapshot is the exact reviewed preinstall-
subset baseline for this release, migration, project, and database before
invoking psql.
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
  --output-dir <absolute new empty private verify-after transcript directory> \
  --bundle <absolute private .snapshot file> \
  --expected-bundle-sha256 <snapshot_bundle_sha256> \
  --expected-post-contract-sha256 <F27_POST_CONTRACT_SHA256> \
  --expected-post-contract-inventory <absolute private expected .inventory.json> \
  --expected-post-contract-inventory-sha256 <F27_POST_CONTRACT_RAW_INVENTORY_SHA256> \
  --expected-post-contract-inventory-byte-length <F27_POST_CONTRACT_RAW_INVENTORY_BYTE_LENGTH> \
  --confirm-project-ref <private project ref> \
  --confirm-database postgres \
  --release-sha <RELEASE_SHA>
```

It must prove:

- row count equals the pre-DDL count;
- every old-column projection has the identical stable hash;
- new F27 columns have only expected defaults;
- no synthetic migration probe remains;
- the two real-team fence generations exactly equal the sealed pre-DDL values;
- every sealed completed real-team rollback/intent remains exact, its
  generation receipts are contiguous and internally bound, and no open or
  unresolved rollback/intent exists;
- expected new constraints, indexes, trigger, dependent functions, grants, and
  RLS match the checked-in migration; and
- the three exact control flags and total `flag_flips` count equal the sealed
  pre-DDL baseline.

On `POST_CONTRACT_MISMATCH`, the verifier must first write the expected and
observed raw seven-category inventories into the private transcript directory,
independently read back both files, and return only their hashes and byte
lengths in the public-safe failure. If either write or readback fails, the
terminal is `POST_CONTRACT_EVIDENCE_WRITE_FAILED`, never a bare contract
mismatch. A passing comparison leaves the transcript directory empty.

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

The only Section 4 deployment mechanism is the protected, dispatch-only
`.github/workflows/deploy-f27-section4-closures.yml` lane. The older onboarding
lane retains `linear-outbound` and `production-write` only for its established
writer-before-comment/archive release order; it is not an F27 install path and
must never substitute for this exact-four lane.

Before mutation, the lane requires the exact Section 1 sealed-bundle SHA-256
and byte length, independently fetches it from the F27 Shared Drive root, and
proves that it contains exactly the four prior provider source/entrypoint/JWT
closures with the recorded `PRIOR_*_VERSION` values. Privately, it also proves
all four captures target the same masked reviewed project, exact Supabase CLI
2.109.0, and the approved provider-readback/Docker-restore adapters; only the
aggregate PASS is public. It then requires
`commit_sha ==` the trusted current default-branch workflow SHA, Supabase CLI
exactly 2.109.0, a working Docker bundler, the three exact
`npm:@supabase/supabase-js@2.49.8` import sites, and the reviewed candidate
closure hashes. Before forward mutation it also resolves the four recorded JWT
postures to the reviewed captured arguments and requires all four to be
`--no-verify-jwt`; any captured mismatch stops before the first deploy. Restore
does not make that forward-only assumption and always uses each exact captured
JWT posture. None of these four functions currently has a `deno.json` or
`deno.lock`, so frozen-lock applicability is honestly zero; the lane stops if
one appears until a separately reviewed frozen-lock proof is added.

Dispatch:

```text
gh workflow run deploy-f27-section4-closures.yml --ref main \
  -f commit_sha=<RELEASE_SHA> \
  -f operation=deploy-reviewed-release \
  -f confirm=DEPLOY_REVIEWED_F27_SECTION4_CLOSURES \
  -f rollback_bundle_sha256=<sealed_bundle_sha256> \
  -f rollback_bundle_byte_length=<sealed_bundle_byte_length>
```

The workflow contains four literal Docker deploy commands in the required
order, never a function loop or slug input. After each command it performs a
version-stable provider capture plus a one-slug repository/live fingerprint,
requiring exact source bytes/path inventory, normalized entrypoint, JWT-off
posture, status, version, provider hash, and file count before the next deploy
can start. After `batch-write`, it repeats a version-stable exact-four provider
capture plus the exact four-slug fingerprint, and requires every final version
and provider hash to equal its immediate per-function receipt. A version
integer or deploy-success message alone is not proof.

If a deploy response is failed or ambiguous, or any per-function readback
differs, do not retry forward and do not deploy the next function. Preserve the
sealed prior bundle and dispatch the separately confirmed Section 7 restore
operation. `--use-docker` is only the selected deployment mechanism; exactness
comes from the independent provider source/entrypoint/JWT readbacks, not the
transport or a reconstructed dependency graph.

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

Run exactly one aggregate checker:

```text
F27_DATABASE_URL=<private PostgreSQL URL> \
SUPABASE_ACCESS_TOKEN=<private> \
SUPABASE_URL=https://<same private project ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<private> \
GH_TOKEN=<private GitHub token> \
N8N_BASE_URL=<private HTTPS n8n base URL> \
N8N_API_KEY=<private instance-wide workflow-read n8n API credential> \
F27_CONFIRM_FINAL_VERIFICATION=VERIFY_F27_FINAL_READ_ONLY \
node scripts/f27-final-verification.js verify \
  --baseline=<absolute private .f27final file> \
  --baseline-sha256=<FINAL_VERIFICATION_BASELINE_SHA256> \
  --release-sha=<RELEASE_SHA> \
  --project-ref=<private project ref> \
  --database=postgres \
  --snapshot-bundle=<absolute private mirror-outbox snapshot> \
  --snapshot-sha256=<snapshot_bundle_sha256> \
  --pinned-inbound-bundle=<absolute private pinned-inbound source bundle> \
  --pinned-inbound-sha256=<PINNED_INBOUND_BASELINE_BUNDLE_SHA256> \
  --prior-four-bundle=<absolute private prior-four source bundle> \
  --prior-four-sha256=<PRIOR_FOUR_SOURCE_BUNDLE_SHA256> \
  --prior-four-byte-length=<PRIOR_FOUR_SOURCE_BUNDLE_BYTE_LENGTH> \
  --reconciler-capture=<absolute private reconciler bundle> \
  --reconciler-capture-sha256=<PRIOR_RECONCILER_BUNDLE_SHA256> \
  --reconciler-release-sha=<PRIOR_RECONCILER_SHA> \
  --reconciler-closure-sha256=<PRIOR_RECONCILER_CLOSURE_SHA256> \
  --expected-post-contract-sha256=<F27_POST_CONTRACT_SHA256> \
  --n8n-origin-sha256=<N8N_ORIGIN_SHA256> \
  --n8n-read-scope=<N8N_INSTANCE_WIDE_WORKFLOW_READ_CONFIRM>
```

This is the sole Section 6 terminal verdict. Require exit zero,
`status=PASS`, `scope=PRODUCTION`, and
`terminal=F27_FINAL_VERIFICATION_OK`. A disposable proof carries
`scope=DISPOSABLE_ONLY`, uses distinct terminal names, and its sealed baseline
is mechanically rejected by production verification. It mechanically
enforces all of the following under database safety bookends:

- both database reads are `REPEATABLE READ READ ONLY`, with no database drift
  while the external readbacks run;
- every pre-DDL old-column queue row is byte-semantically exact and the only
  addition is one exact completed reserved-drill row;
- the exact normalized post-migration definitions/grants/defaults match the
  single reviewed post-contract, while both real-team fences equal the sealed
  pre-DDL values and remain consistent with their monotone completed-audit
  chains;
- Linear/Linear authority, F2 off, F4 false, and the complete `flag_flips`
  count/hash are unchanged;
- no open real-team or drill rollback and no unresolved intent exists, every
  pre-window completed real-team audit remains exact, replay selection is zero,
  and exactly one new retained terminal `__f27_drill__` audit is internally
  bound without advancing either real-team fence;
- the complete `public.clients` and `public.team_members` count/hash baselines
  are unchanged;
- active pinned inbound matches its sealed source/entrypoint/JWT/version
  baseline, all four Section 4 functions match `RELEASE_SHA`, and both frozen
  writers retain their exact version/source/entrypoint/JWT posture; the public
  Section 4 receipt is a fixed four-slug map containing only active version,
  source hash, entrypoint hash, and JWT posture;
- the complete paginated n8n semantic workflow inventory is unchanged and
  stable across its own list bookend, with list/detail active-version identity
  and node webhook identity included;
- the exact reconciler bundle/release/closure still matches, its workflow is
  `disabled_manually`, its complete run inventory is terminal and stable, and
  both five-status scans are zero; and
- Linear inbound freshness passes the reviewed six-hour safety margin with a
  nonzero exact twelve-hour event count and no timestamp more than five minutes
  in the future.

Any warning, skip, unavailable read, incomplete page, unstable provider
version, non-GET adapter call, mismatched binder, or non-PASS terminal is a
hard failure and invokes Section 7. The checker emits exactly one bounded
public-safe JSON terminal: controlled counts, versions, hashes, JWT posture,
and PASS/FAIL only. It never emits source, rows, project refs, workflow or
private file IDs, URLs, tokens, paths, or response bodies. Keep the reconciler
workflow disabled after PASS; enabling it is a separate owner-authorized
post-final operation.

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

1. require the reconciler workflow to remain `disabled_manually`; run the
   read-only `f27-reconciler-closure.js verify-disabled` command and require
   exact captured closure equality plus both complete zero-in-flight
   observations. The primary recovery action is `keep_apply_disabled`; a
   source/workflow drift is a stop for a separately reviewed repository
   restoration, never an automatic operator rewrite;
2. restore the captured owner-defined source-exact closure and JWT setting for
   the four functions deployed in Section 4, creating new active version IDs;
   independently read back and require each provider source/entrypoint and JWT
   hash to equal capture;
   leave inbound at its unchanged pinned preparatory baseline (or redeploy that
   exact pinned baseline only if independent readback proves it drifted);
3. in one database transaction, lock `mirror_outbox`, disable the new
   `track_b_f27_hold_guard`, restore every captured pre-install dependent
   function/trigger definition and enabled state—including restoring
   `production_assert_authority` to its captured 2026-07-12 definition instead
   of dropping it—and revoke F27 mutating RPC grants while retaining the
    additive F27 columns/tables, disabled trigger/guard function, both
    monotone generation fences at their current values, and every drill/audit
    row;
4. before COMMIT, compare every captured pre-install queue row through the old-
   column projection and require exact equality while allowing later rows; and
5. after COMMIT, read back operative definitions/hashes, restored source
   closures, pinned inbound baseline, reconciler posture, flags, frozen-writer
    hashes, revoked F27 mutation grants, zero open or unresolved rollback work,
    preserved generation values with their contiguous completed-real-rollback
    chains, and retained audit evidence.

Never restore a row dump over the live queue. Never drop the additive F27 schema,
reset a generation, or delete audit evidence as operational rollback. The exact
resulting boundary is the second legitimate reinstall entry state; it is not a
partially installed exception. Any later schema retirement is a separate
reviewed retention migration. The recipe must retain the additive F27
columns/tables, disabled trigger/guard function, generation counters, and every
audit row.

The generated private SQL uses the captured object identity and includes this
exact behavior kill before restoring the captured operative definitions:

```sql
ALTER TABLE public.mirror_outbox DISABLE TRIGGER track_b_f27_hold_guard;
```

Before any Edge or database rollback, mechanically re-prove the primary
reconciler containment:

```text
gh workflow disable linear-deliverables-reconcile.yml \
  --repo sidney-afk/client-analytics

GH_TOKEN=<private GitHub token> \
node scripts/f27-reconciler-closure.js verify-disabled \
  --release-sha=<RELEASE_SHA> \
  --bundle=<absolute private sealed reconciler bundle> \
  --expected-bundle-sha256=<PRIOR_RECONCILER_BUNDLE_SHA256> \
  --expected-bundle-byte-length=<PRIOR_RECONCILER_BUNDLE_BYTE_LENGTH> \
  --expected-closure-sha256=<PRIOR_RECONCILER_CLOSURE_SHA256>
```

Keep the workflow disabled throughout Edge restore, database rollback, and all
rollback readbacks. The completed known `57014` run is irrelevant; only current
disabled state, exact closure, and the two zero-in-flight observations gate
rollback. This exact `gh workflow disable` plus `verify-disabled` pair is the
canonical `keep_apply_disabled` restore action recorded in the manifest. A
source/workflow mismatch does not authorize an operator-side rewrite: preserve
the sealed bundle, keep APPLY disabled, and restore repository source only
through a separate owner-reviewed commit. After either a successful Section 6 final verification or a
completed and verified Section 7 rollback, re-enabling the reconciler is a
separate owner-authorized post-final action:

```text
gh workflow enable linear-deliverables-reconcile.yml \
  --repo sidney-afk/client-analytics
```

Do not run that command without the separate owner go and an immediate
post-enable workflow-state readback.

The exact four-function source restore is executed only from its sealed bundle
through the same protected CI lane, so Edge recovery needs no workstation:

```text
gh workflow run deploy-f27-section4-closures.yml --ref main \
  -f commit_sha=<RELEASE_SHA> \
  -f operation=restore-captured-prior-four \
  -f confirm=RESTORE_CAPTURED_F27_SECTION4_CLOSURES \
  -f rollback_bundle_sha256=<captured sealed_bundle_sha256> \
  -f rollback_bundle_byte_length=<captured sealed_bundle_byte_length>
```

The lane re-fetches and independently verifies the exact bundle before any
restore mutation. Restore remains strictly serial and, after every function,
requires the provider-returned source paths/bytes, entrypoint, and JWT posture
to equal the capture before advancing. Prior version IDs remain provenance;
each restored deployment receives a new active version. It then captures the
final exact four again and binds every final active version/source/entrypoint/
JWT value to the serial restore receipt and sealed prior capture. The workflow
itself always runs from trusted current `main`; restore accepts the recorded
install `RELEASE_SHA` only when it remains an ancestor of that current main, so
the Edge-source restore dispatch does not expire on the next merge. Require the
workflow PASS receipt before executing the database recipe below. A
partial/ambiguous restore is a stop for read-only owner classification, never a
blind retry.

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

The pre-mutation recovery manifest is complete before any forward mutation.
It contains only facts already captured and actions already prepared:

```text
rollback_recipe_sha256=<private generated SQL recipe hash>
baseline_snapshot_manifest_sha256=<Section 1 hash>
baseline_snapshot_bundle_sha256=<Section 1 hash>
pre_f27_entry_state=<pristine_pre_f27|exact_post_section7>
pre_f27_fence_generations_sha256=<Section 1 preserved-generation binder>
pre_f27_retained_audit_sha256=<Section 1 retained-audit binder>
prior_four_source_bundle_sha256=<Section 1 sealed Edge bundle hash>
prior_four_source_bundle_byte_length=<Section 1 sealed Edge bundle byte length>
linear-inbound=<pinned preparation version + provider-source/entrypoint/JWT hashes>
linear-outbound=<prior version + provider-source/entrypoint/JWT hashes>
production-write=<prior version + provider-source/entrypoint/JWT hashes>
deliverable-write=<prior version + provider-source/entrypoint/JWT hashes>
batch-write=<prior version + provider-source/entrypoint/JWT hashes>
reconciler=<prior Git SHA + closure hash + sealed bundle hash/bytes>
rollback_action=keep_apply_disabled
final_verification_baseline_sha256=<Section 2 sealed baseline hash>
final_verification_baseline_byte_length=<Section 2 sealed baseline byte length>
reconciler_disabled=PASS
reconciler_post_final_action=OWNER_GATED_ENABLE
table_boundary_definition_sha256=<Section 1 hash>
private_round_trip=PASS
source_restore_rehearsal=PASS
```

After Section 6, append these public-safe outcome fields to the evidence PR;
they are not prerequisites for, or inputs to, rollback:

```text
final_verification=PASS
final_verification_receipt_sha256=<public-safe receipt hash>
reconciler_still_disabled=PASS
```

<!-- F27_INSTALL_CHECKLIST_BEGIN -->
## Operator checklist

### Separate preparatory inbound window -- requires its own owner go

- [ ] Confirm clean owner-merged `origin/main`, quiet window, Linear/Linear, F2 off, owner-approved F4 true recorded and unchanged, and exactly one reviewed entry state: `pristine_pre_f27` or `exact_post_section7`. Require the reviewed mirror-enqueue ACL and exact preexisting 2026-07-12 production-authority function in either state; reject every partial/extra/drifted F27 object, grant, generation, or audit row. Never disarm F4 in this window.
- [ ] Run the read-only `window-p-preflight` mode from that exact release; require exact-subset PASS, F4 true unchanged, and record the `mirror_outbox` non-terminal count.
- [ ] Capture exact active v39 version provenance, provider-returned source paths/bytes and entrypoint, and JWT posture privately; record that historical transitive graphs are unrecoverable, irrelevant to the source-exact standard, and remain F51.
- [ ] Prove private store at the `SyncView Backups/` Shared Drive root -> re-fetch -> SHA-256 match and the hermetic throwaway prior -> candidate -> restore -> source/JWT readback rehearsal. For the store command, set `TRACK_B_BACKUP_DRIVE_FOLDER_ID` explicitly to the root; never copy the weekly backup repository variable that identifies its `track-b-backups/` child.
- [ ] STOP after P.2, report, and obtain a separate owner go for P.3. Building/reviewing the CI lane is not authorization to dispatch it.
- [ ] From the protected main-only production Environment, require the distinct `F27_PRIVATE_SHARED_DRIVE_ROOT_ID` secret for `SyncView Backups/`, then dispatch `deploy-f27-linear-inbound.yml` with the exact reviewed SHA and `deploy-reviewed-release`; require the expected root ID SHA-256 receipt, CLI 2.109.0, Deno 2.2.15, Docker, only the exact `npm:@supabase/supabase-js@2.49.8` import, unchanged frozen `deno.json`/`deno.lock`, the five-file candidate closure, captured JWT-off posture, and an independently verified private v39 bundle before mutation. A pre-mutation gate failure stops without restore. Once deploy begins, an ambiguous/failed response or any post-deploy readback/capture/freshness failure must never retry forward; use the same workflow's `restore-captured-v39` operation.
- [ ] After workflow PASS, independently read back exact provider source/entrypoint and JWT hashes plus new version provenance; run inbound freshness immediately; confirm flags, authority, n8n, schema, and all other functions unchanged. The CI lock proof is only the completed candidate-source gate.
- [ ] Record the successful pinned inbound version provenance plus source/entrypoint and JWT hashes as the new exact baseline. Stop; do not start the F27 install without a new owner go.

### F27 install window -- separately owner-gated

- [ ] Confirm exact current owner-merged main SHA, generated-checklist hash, pinned inbound baseline, Linear/Linear, F2 off, F4 false, exactly one reviewed entry state (`pristine_pre_f27` or `exact_post_section7`), and no active unrelated operation. In the retained state require every Section 7 object/definition/grant exact, the trigger disabled, generations backed by contiguous terminal audit, and zero open or unresolved work; every third state fails closed.
- [ ] As the first owner-window operation, manually disable `linear-deliverables-reconcile.yml`, then run `f27-reconciler-closure.js verify-disabled`. Require the exact sealed eleven-file closure, `disabled_manually` state bookends, two zero nonterminal-status scans, and two identical complete paginated all-terminal run inventories. Keep APPLY disabled through success or rollback. The known completed `57014` whole-history read cancellation is not a readiness predicate and does not require a later green run.
- [ ] Before DDL, capture the full repeatable-read queue/definition bundle and record its non-terminal count; require `pre_f27_baseline=PASS` plus the exact entry-state, generation, and retained-audit binders. `pristine_pre_f27` requires the two exact prerequisites and no other F27 state. `exact_post_section7` requires the complete exact retained inventory, restored operative definitions, disabled trigger, eight revoked mutating grants, preserved monotone generations with contiguous terminal audit, and zero open or unresolved work. Both require the reviewed mirror-enqueue ACL and exact 2026-07-12 production-authority function after line-ending normalization; any third state fails. On `PRE_F27_BASELINE_REQUIRED`, require the same-transaction private retained-state inventory write/readback receipt before the verdict, then run only the source-exact 21-predicate `f27-retained-state-diagnose.js` read-only explainer and stop for owner review; the diagnostic never authorizes install. Seal a passing snapshot, store it at the `SyncView Backups/` Shared Drive root using an explicitly root-bound `TRACK_B_BACKUP_DRIVE_FOLDER_ID`, and independently re-fetch/re-hash it.
- [ ] Before DDL, use the separate Node-only Section 1 operations to capture/seal/private-round-trip the prior exact source/JWT closure for `linear-outbound`, `production-write`, `deliverable-write`, and `batch-write`, and separately the reconciler's exact raw-Git workflow/runtime closure. Before the first provider read require the clean release's exact project target and CLI 2.109.0; after sealing require all-four private provider project/CLI/readback-adapter/restore-adapter compatibility and public `provider_contract=PASS`. Record all four `PRIOR_*_VERSION` values, both bundle SHA-256/byte-length pairs, `PRIOR_RECONCILER_SHA`, and `PRIOR_RECONCILER_CLOSURE_SHA256`. The Section 4 lane consumes only the four-function bundle.
- [ ] Before DDL, generate/read back the private database rollback recipe from the sealed snapshot, record `rollback_recipe_sha256`, and prefill the exact Edge restore plus database executor commands with every release/project/database/snapshot binder.
- [ ] Run all source, inbound candidate-source lock, frozen-writer, source/JWT rollback-rehearsal, unit, disposable-PostgreSQL 17, and public-hygiene gates. Dispatch only `f27-post-contract-capture.yml` from current `main` with the exact `RELEASE_SHA`, `capture-reviewed-post-contract`, and `CAPTURE_REVIEWED_F27_POST_CONTRACT`; require the private Shared Drive-root round-trip, then independently re-fetch the raw seven-category inventory by its SHA-256/byte length into a private local path. Stop on any failure.
- [ ] After the disposable exact-post contract exists and immediately before DDL, privately compute and record `N8N_ORIGIN_SHA256`, confirm the n8n key has instance-wide workflow-read visibility, and supply the exact `CONFIRMED_INSTANCE_WIDE_WORKFLOW_READ` binder; then run `f27-final-verification.js capture-baseline`. Require `scope=PRODUCTION`, exact queue/flags/fences plus full `clients`/`team_members` hashes, pinned inbound, frozen writers, complete n8n inventory, and exact disabled/quiescent reconciler. Seal the sole `.f27final` file, store it at the Shared Drive root with `--artifact-kind final-verification`, independently re-fetch/re-hash it, record its SHA-256/byte length, then re-run `verify-disabled`.
- [ ] Apply the exact migration once through the tool mechanically bound to the sealed snapshot; require its locked gate to classify the sealed exact entry state before persistent DDL, adopt an exact retained boundary without resetting either generation/audit ledger, and return the identical pre-COMMIT enqueue savepoint/self-probe. A transport/ack ambiguity is UNKNOWN: never retry; run only read-only verify-after and stop for owner review.
- [ ] Run snapshot `verify-after` with the private expected raw-inventory binders and a fresh empty private transcript directory; require preserved count/old-column hashes, no residual probe, owner-relative default privileges, exact non-owner grants/definitions, unchanged authority/F2/F4 and flag-flip count, fence generations equal to the sealed values, the same complete generation audit chains, and zero open or unresolved work. Require the same normalized post-contract for pristine and retained entry states. On `POST_CONTRACT_MISMATCH`, require both expected and observed raw seven-category inventories to be privately retained and independently re-hashed before the failure; evidence-write failure is its own hard stop. Separately read back pinned inbound and both frozen writers.
- [ ] Dispatch only `deploy-f27-section4-closures.yml` from current `main` with the exact `RELEASE_SHA`, `deploy-reviewed-release`, `DEPLOY_REVIEWED_F27_SECTION4_CLOSURES`, and the sealed prior-four bundle hash/length. Require CLI 2.109.0, Docker, all-four private restore-target/CLI/adapter compatibility, exact import/candidate gates, all four captured forward JWT arguments equal to `--no-verify-jwt`, four literal serial deploys in runbook order, per-function source/entrypoint/JWT/version/provider readback before the next deploy, and the final version-stable four-function capture/fingerprint bound to every immediate receipt. Never use the onboarding or inbound lane; do not deploy inbound or either frozen writer. A failed/ambiguous response is never retried forward: use the same lane's separately confirmed `restore-captured-prior-four` operation.
- [ ] Run only the `__f27_drill__` drill; require snapshot/classification/replay/correlated receipt and the correct authority-CAS refusal. On a lost response, resume the exact reported UUID with `F27_RESERVED_DRILL_RESUME`; never open a second drill. Preserve all audit rows.
- [ ] Run exactly one `f27-final-verification.js verify` command. Require `scope=PRODUCTION` and its single aggregate PASS for database bookends, exact old queue plus one terminal reserved drill, the converged post-contract, preserved fences and completed real-team audit, flags/flip ledger, zero open or unresolved work, dormant replay, the exact new retained drill audit, full clients/team-members hashes, pinned inbound, all four release closures with per-function version/source/entrypoint/JWT receipts, both frozen writers, complete n8n inventory, disabled/quiescent reconciler, and inbound freshness. Any warning, skip, partial page, unstable version, unavailable read, or mismatch invokes Section 7.
- [ ] Fill the source-exact rollback manifest and public-safe evidence PR, including reconciler and final-verification bundle hashes. Keep reconciler APPLY disabled through cloud live-state review and any rollback; re-enable only under a separate owner go. Declare final only after cloud review. Owner alone merges.
<!-- F27_INSTALL_CHECKLIST_END -->
