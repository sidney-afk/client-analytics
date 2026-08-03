# F133 canonical-title install and adoption

Status: reviewed source only until the migration, exact-three closure lane, and
adoption proofs have merged. Merging F133 is inert: the migration seeds
`f133_canonical_title_enabled` to `{"enabled":false}`. Before this browser has
ever observed that row, loading, timeout, CDN, or socket failure preserves the
pre-install v3 intake and legacy linked-title editing; create/submit/title
actions, visible-tab return, and online return re-read it. Duplicate or malformed
rows still fail closed. Exact false is a visible installed pause that owns linked
names and permits no new v3/v4 intake or title mutation; it permits only an
exact already-committed v3 receipt recoverable through the authenticated
adopter. After row presence has been observed, that latch is durable and every
later loading, missing, timeout, CDN, socket, malformed, or unreadable state
fails closed.

`Video N`, `Graphic N`, and `Graphics N` (case- and whitespace-normalized) are
display placeholders only. The browser, gateway, inbound convergence, and SQL
contract reject them as a proposed canonical target. An existing pre-F133
placeholder may remain visible and may be used only as the exact CAS base for a
reviewed repair to a real title; it is never accepted as the repaired target.

This runbook installs one canonical title across Calendar/Samples cards,
deliverables, Production, and Linear. It also classifies and repairs only the
two reviewed historical states emitted by the F133 inventory operator:
`exact_converged` and `exact_f133_generated_split`. A missing exact title clock
is an action attached to one of those states, never a third accepted state.

The owner gives a separate GO at every marked boundary. Stop on any mismatch.
Do not improvise a query, broaden the inventory, retry an ambiguous mutation,
or publish private inventories, titles, client identities, provider IDs, raw
responses, credentials, Drive IDs, or source bundles.

## 0. Value sheet and gates

Record these values before the window:

```text
RELEASE_SHA=
MIGRATION_SHA256=
MIGRATION_BYTE_LENGTH=

PRIOR_LINEAR_INBOUND_VERSION=
PRIOR_LINEAR_INBOUND_SOURCE_SHA256=
PRIOR_LINEAR_OUTBOUND_VERSION=
PRIOR_LINEAR_OUTBOUND_SOURCE_SHA256=
PRIOR_PRODUCTION_WRITE_VERSION=
PRIOR_PRODUCTION_WRITE_SOURCE_SHA256=
PRIOR_THREE_SOURCE_BUNDLE_SHA256=
PRIOR_THREE_SOURCE_BUNDLE_BYTE_LENGTH=

F133_INVENTORY_SHA256=
F133_INVENTORY_BYTE_LENGTH=
F133_PLAN_DIGEST=
F133_REPAIR_COUNT=
F133_FLIP_CERTIFICATE_SHA256=
```

Require all of the following before capture or mutation:

1. `HEAD == origin/<default branch> == RELEASE_SHA`, with a clean tree.
2. The migration bytes hash exactly to `MIGRATION_SHA256` and have the recorded
   byte length.
3. Before the pre-DDL closure deploy, `f133_canonical_title_enabled` is either
   absent (a first install) or exactly `{"enabled":false}` (a retained
   reinstall). Exact true or any malformed value is a stop. After the migration
   creates/adopts the flag, every later gate requires exact false until the
   owner activation in Section 7.
4. `prod_authority` is exactly Linear/Linear; `linear_outbound_enabled` is
   exactly off; `linear_inbound_enabled` is exactly true;
   `auth_enforcement` is exactly permissive; and
   `linear_legacy_parity_enabled` is exactly true.
5. No migration, Edge Function deploy, repair apply, title drainer, or other
   apply-capable reconciler is in flight.
6. The exact reviewed migration and all three exact reviewed Edge Function
   closures are present at `RELEASE_SHA`.

Public evidence is limited to PASS/FAIL, enums, counts, versions, byte lengths,
and SHA-256 values.

**OWNER GO 1: private capture only.**

## 1. Capture and seal the exact prior three closures

Dispatch `.github/workflows/deploy-f133-canonical-title.yml` from the current
default branch. It derives the project identity from reviewed
`supabase/config.toml`, installs Supabase CLI 2.109.0, and captures exactly
these provider closures and no others:

```text
linear-inbound
linear-outbound
production-write
```

Canonical dispatch inputs:

```text
commit_sha=<RELEASE_SHA>
operation=capture-prior-three
confirm=CAPTURE_F133_PRIOR_THREE_CLOSURES
rollback_bundle_sha256=<empty>
rollback_bundle_byte_length=<empty>
```

Require exactly three records, the three exact slugs above, active provider
versions, exact source-closure and entrypoint hashes, and captured JWT posture.
Record the three versions and hashes in the value sheet.

The lane stores the sealed bundle at the `SyncView Backups/` Shared Drive root,
never the weekly `track-b-backups/` child or its same-named repository
variable, then independently re-fetches it with the exact hash and byte length.
Require a binary SHA-256 round-trip PASS and the reviewed root-ID hash. A
missing, duplicate, MIME-mismatched, or wrong-folder object is a stop. The
public receipt contains only versions, counts, hashes, byte length, JWT posture,
and PASS/FAIL; it never publishes source or private identities.

**OWNER GO 2: deploy the exact reviewed closures while F133 is OFF.**

## 2. Deploy and read back exactly three Edge Functions

Dispatch `.github/workflows/deploy-f133-canonical-title.yml` from the current
default branch. It is dispatch-only, binds forward `commit_sha` to the trusted
current default-branch head before exposing a secret or release-owned script,
uses Supabase CLI exactly 2.109.0 with Docker bundling, and has no dynamic slug
input or deploy loop. Its fixed forward order is:

`linear-outbound` -> `production-write` -> `linear-inbound`

Dispatch inputs:

```text
commit_sha=<RELEASE_SHA>
operation=deploy-reviewed-release
confirm=DEPLOY_REVIEWED_F133_CANONICAL_TITLE_CLOSURES
rollback_bundle_sha256=<PRIOR_THREE_SOURCE_BUNDLE_SHA256>
rollback_bundle_byte_length=<PRIOR_THREE_SOURCE_BUNDLE_BYTE_LENGTH>
```

Before mutation the lane independently fetches and inspects the exact sealed
prior-three bundle and proves the reviewed-SHA candidate closures. Every one of
the three full repository-local dependency closures must contain exactly one
`npm:@supabase/supabase-js@2.49.8` import. It pins Deno 2.2.15 for the frozen
`linear-inbound` lock; `linear-outbound` and `production-write` must still have
no lock artifacts. Immediately before function 1, the lane freshly reads all
three active provider closures and requires byte-exact source plus exact
entrypoint, JWT posture, and version equality with the sealed prior-three
capture. In a separate `REPEATABLE READ, READ ONLY` production snapshot, before
any deploy step receives the provider token, it also requires zero open
`operation='title'` rows in `pending|failed|shadow_ok` and reports the flag as
only `absent` or exact `off`. Exact true, malformed flag state, any open title
intent, or any deploy/freeze breach since capture stops before mutation.
After each literal deploy, it reads the active provider source, entrypoint, JWT
posture, status, and version and requires exact equality before the next deploy
can start. Stop on the first source, entrypoint, JWT-posture, status, version,
frozen-lock, import, CLI, Docker, release, or project-identity mismatch. Never
retry a forward deploy. With the flag row absent, the reviewed closures preserve
the exact pre-install v3 compatibility lane. With the flag exactly false, they
enforce the installed pause: no new v3/v4 intake or title mutation, with only an
exact already-committed v3 receipt recoverable through the authenticated
adopter. `production-write` binds its v3 append name to the same exact capability
decision: before DDL it calls the existing service-only
`production_intake_append`; after DDL it calls the preserved service-only
`production_intake_append_v3`, while v4 calls only `production_intake_commit`.
If the migration commits between the capability read and append call, it may
switch names once only after the exact old-name `42501 permission denied` or the
exact `_v3` missing-function response, both of which prove that no function body
ran. A timeout, transport failure, unexpected permission error, or any
function-body error is never retried under another name. `linear-inbound` may
fall back only on the exact pre-migration missing-RPC response. Use the restore
operation in Section 8.

After all three readbacks pass, re-read the Section 0 flags and require F133
still OFF and every unrelated function version unchanged.

**OWNER GO 3: apply the migration exactly once.**

## 3. Apply and verify the migration

Immediately re-read every Section 0 gate and all three exact reviewed closure
readbacks. Capture a private before transcript. Apply
`migrations/2026-08-02-f133-canonical-title.sql` exactly once in one transaction
with `ON_ERROR_STOP`. Preserve stdout/stderr only in the private transcript
directory.

An exit without an unambiguous commit acknowledgement is UNKNOWN. Never retry.
Use read-only catalog and flag verification to decide committed versus not
committed, preserve both transcripts, and stop for owner review.

After an acknowledged commit require:

- the activation flag remains exactly OFF;
- every reviewed function, trigger, constraint, and grant matches the merged
  migration contract;
- all three reviewed Edge closures remain exact and active;
- no browser role gained direct execution of service-only functions;
- no title/card/deliverable row, outbox intent, client, authority, or n8n state
  changed during DDL.

**OWNER GO 4: capture the plan only.**

## 4. Read-only plan and sealed inventory

Dispatch `.github/workflows/f133-canonical-title-repair.yml` from the current
default branch:

```text
commit_sha=<RELEASE_SHA>
operation=plan
confirm=PLAN_F133_CANONICAL_TITLE_REPAIR
```

The plan takes one private `REPEATABLE READ, READ ONLY` full-outer snapshot,
reads every exact linked Linear issue independently, and must return READY.
BLOCKED is a successful stop. Review the public counts and private manifest;
only `exact_converged` and `exact_f133_generated_split` may appear. Binder
adoption is an action count only. The workflow seals the inventory in the
private Shared Drive root and independently re-fetches the exact bytes.

Record its inventory SHA-256, byte length, plan digest, and repair count.

**OWNER GO 5: apply exactly the reviewed inventory.**

## 5. Adopt binders, repair exact splits, and drain exact title intents

Re-read all flags and require F133 exactly OFF. Dispatch:

```text
commit_sha=<RELEASE_SHA>
operation=apply
confirm=APPLY_REVIEWED_F133_CANONICAL_TITLE_REPAIR
inventory_sha256=<F133_INVENTORY_SHA256>
inventory_byte_length=<F133_INVENTORY_BYTE_LENGTH>
plan_digest=<F133_PLAN_DIGEST>
repair_count=<F133_REPAIR_COUNT>
```

The lane independently re-fetches the reviewed private inventory, verifies the
deployed `production-write` and `linear-outbound` source/JWT closures, then
re-captures the entire live state before its first write. It may:

1. adopt a missing title clock only through the exact service-role evidence RPC;
2. run the authenticated idempotent title CAS only for an exact reviewed split;
3. drain only the exact deterministic title dedups created by that CAS, serially.

Every terminal receipt must bind the exact reviewed deliverable and Linear
issue UUID, expected title, dedup, mutation, and provider receipt clock. A lost
response stops with the exact private journal. Resume only the same sealed
inventory and deterministic identity; never generate a replacement plan or a
second repair identity.

The apply journal must complete its own private store and independent re-fetch
round-trip even on failure.

**OWNER GO 6: independent verification.**

## 6. Independent equality certificate

Dispatch:

```text
commit_sha=<RELEASE_SHA>
operation=verify
confirm=VERIFY_F133_CANONICAL_TITLE_REPAIR
inventory_sha256=<F133_INVENTORY_SHA256>
inventory_byte_length=<F133_INVENTORY_BYTE_LENGTH>
plan_digest=<F133_PLAN_DIGEST>
repair_count=<F133_REPAIR_COUNT>
```

Require PASS with:

- exact title equality across every linked Calendar/Samples card, deliverable,
  stored Linear projection, and fresh Linear read;
- exact identity/linkage and title-clock binders;
- exact title-change events and terminal outbox receipts for repaired splits;
- zero open real title intents;
- zero full-outer linked-title divergence;
- one public `f133_flip_certificate_sha256`.

Any red predicate stops before activation.

**OWNER GO 7: activate the browser lane.**

## 7. Owner activation and observation

The owner changes only `f133_canonical_title_enabled` from exact OFF to exact
`{"enabled":true}` in one guarded transaction, then reads it back. The operator
does not flip this flag on the owner's behalf.

After activation require a fresh browser session to read ON and prove, on the
reviewed TEST-only path, exact title equality for latest/new batch, single and
multiple deliverables, whitespace rejection, no-op/duplicate retry, pre/post
review edits, two tabs, reload, and lost-response replay. Offline attempts must
remain visibly uncommitted and must not invent a canonical server state.

For every successful TEST title mutation, obtain the public-safe correlation
from the same browser tab with
`f133LatestTitleObservationCorrelationSha256()`. The getter returns only the
SHA-256 of the private request id; it never returns or stores the raw id. It is
populated only after that request has a durable browser journal readback.
Dispatch `.github/workflows/f133-test-title-observe.yml` from current main with:

```text
commit_sha=<RELEASE_SHA>
operation=observe-reviewed-test-title
confirm=OBSERVE_REVIEWED_F133_CANONICAL_TITLE_TEST
request_correlation_sha256=<SHA256_OF_PRIVATE_BROWSER_REQUEST_ID>
```

The lane accepts no caller-selected client, card, deliverable, title, or dedup.
It derives one exact request for the repository's fixed active TEST client,
requires exactly one or two non-parity TEST-only title intents, drains those
exact dedups serially with `B4_TEST_ONLY` while global F2 remains OFF, and then
independently requires title equality across the Calendar/Samples card, every
linked deliverable, stored Linear projection, and fresh Linear provider read.
A lost workflow response is resumed by dispatching the same correlation: rows
already terminal are read back and are never sent to the provider again. The
public result contains only PASS/FAIL, counts, hashes, and the reviewed release;
the lane retains every TEST title event and terminal outbox row as audit evidence.
Run successful predecessor/successor edits in browser commit order. Negative
browser cases (whitespace, local no-op, offline, and conflict) must produce no
invented server terminal and remain covered by the source/browser proof suite.

Keep the private source bundle, plan inventory, apply journal, migration
transcript, provider readbacks, and equality certificate for rollback and
diagnosis.

## 8. Kill and rollback

The primary kill is owner-only: set `f133_canonical_title_enabled` back to exact
OFF and read it back. This visible installed pause owns linked title fields and
blocks every new v3/v4 intake and title mutation without undoing valid canonical
titles; only an exact already-committed v3 job may finish through the reviewed
authenticated adopter. Stop repair applies and targeted drains; preserve all
journals and receipts. An absent flag row alone is the pre-install v3 state;
loading, duplicate, malformed, or unreadable state also blocks new split writes.

Do not restore an old `linear-outbound` while any F133 `title` intent is open.
With F133 OFF, either finish the exact already-reviewed dedups using the current
closure or stop with the new closure retained.

The preferred kill retains both the additive F133 database contract and the
new exact-three closures with the flag OFF. Valid canonical titles, receipts,
and evidence remain installed; no provider restore or destructive inverse is
part of that primary path.

A full rollback needs a separate owner GO. After proving F133 is OFF, open title
intents are zero, no repair/drain is in flight, and the private transcript is
ready, apply the migration's owner-only database inverse exactly once **before**
restoring any prior Edge closure. The still-deployed reviewed inbound closure
must treat only the exact now-expected missing canonical RPC as pre-DDL fallback;
the still-deployed reviewed `production-write` closure likewise switches from
the now-absent `_v3` append name to the restored legacy append name only on that
exact missing-function response. Any other schema/cache/guard error remains a
stop. Verify the database inverse, then restore the three captured provider
closures through the reviewed CI operation in reverse dependency order with
source/entrypoint/JWT readback after each.

The restore operation also enforces that ordering mechanically. Before the
first prior closure receives a production deploy token, it runs
`scripts/f133-post-inverse-verify.js` against one `REPEATABLE READ, READ ONLY`
snapshot. The gate requires exact F133 OFF, zero open title intents, removal of
every reviewed F133 RPC/helper/guard trigger, exact restoration of the pre-F133
append/linkage functions and service-only ACLs, and the exact retained
`title_revision`/CHECK posture. Any retained F133 guard or RPC, or any other
predicate mismatch, stops the workflow before `linear-inbound` is restored.

The exact fixed order is `linear-inbound` -> `production-write` ->
`linear-outbound`; each restore and independent provider readback completes
before the next starts.

```text
commit_sha=<RELEASE_SHA>
operation=restore-captured-prior-three
confirm=RESTORE_CAPTURED_F133_CANONICAL_TITLE_CLOSURES
rollback_bundle_sha256=<PRIOR_THREE_SOURCE_BUNDLE_SHA256>
rollback_bundle_byte_length=<PRIOR_THREE_SOURCE_BUNDLE_BYTE_LENGTH>
```

Never restore the prior closures before the database inverse in a full rollback:
that would remove the reviewed inbound missing-RPC fallback at the moment the
inverse removes its RPC. After restore, re-read F133 OFF, the exact prior three
versions/source/entrypoint/JWT values, zero title intents, and the reviewed
inverse database boundary.

Pre-F133 v3 debt remains eligible only for the same sealed two-state operator:
never infer a title from `Graphic N`, a regex alone, or two conflicting real
titles. A committed v4 intake remains a valid atomic card/deliverable intake
after the flag is turned OFF; preserve its titles, events, binders, and intents.
Do not downgrade a v4 row into browser-only recovery. Missing-card intake debt
belongs to F134's server-side ledger/reconciler, not this rollback.

The window closes only after the final flag, three function versions and
source/JWT readbacks, open-title-intent count, and operator-lane state are
recorded. No merge/deploy freeze may lift before that readback.
