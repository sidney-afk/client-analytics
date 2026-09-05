# Root native intake expected-request manifest

Status: draft implementation, unapplied. No production request, database install,
Edge Function deployment, flag change, or provider write belongs to this proof.

## Scope and dependencies

Started from main `a4925097aad2be1d8b4710e56da1220a19c850c5`.
Historical native evidence PR1274 at `7d2812ac60358b3e73e26de2622cc2d25b90bb90`
remains separate. This package copies only its bootstrap and SQL transport shim
into a new namespace and adapts its actual-handler loader; it does not replace
that evidence or turn its readiness failures green. Browser preservation PR1284
at `87065ce5c6ae328856843a31d4e8b5ffcb0b2ffe` is complementary, not a merge
dependency: no browser source changes are included here.

The bounded main advance `27889a8dc3ecb0935d3771a5b733680a7397d9fc` changes
assetSnapshot and the client artifact error wording in production-write, plus
the imported policy's Dropbox query allowlist. It does not change the root
handler or writer. Its new migration replaces production_artifact_write; root
intake never calls that RPC and the manifest introduces no artifact dependency.
The final candidate includes this main advance; the focused gateway proof uses
the integrated policy source. No conclusion about installed/serving source follows.

## Storage and identity contract

`production_intake_manifests` has one immutable row per global root `request_id`.
That scope matches the existing deterministic root batch ID, which is derived
from request identity without a client suffix. Reusing a request for another
actor/client is a conflict, not a second namespace. The manifest records:

- validated actor key, actor role, existing auth kind, client slug, surface and
  original source timestamp;
- whitelisted original batch/item input and the first resolved batch snapshot;
- all expected item indexes, stable native IDs, card IDs, source/generated
  briefs, normalized row content, original child dedup keys/fingerprints;
- the existing parent dedup key, intent fingerprint, owning team and lane.

Request headers, role keys and unrelated request properties are never copied.
Briefs and asset links may contain confidential information: RLS is enabled,
anon/authenticated have no table privileges or policies, and service_role may
only SELECT. Service role may execute the wrapper, but cannot directly insert,
update or delete manifests. There is no browser-facing read/recovery endpoint.
Database owners and service credentials remain privileged; this is access
control using the existing database protection, not field-level encryption.
Operational backups must treat this table as confidential retained evidence.

The gateway's existing authentication/client/role/provider/F27 checks execute
first. The wrapper independently runs the existing database authority check
before consulting/inserting the manifest. A public-intake request remains bound
to the existing `public-intake` principal and client slug; this does **not** prove
the identity of an anonymous individual or strengthen its abuse policy.

`production_intake_root_begin` inserts or checks the manifest and invokes the
unchanged `production_batch_write` in one SQL transaction. A deferred batch FK
ties the first accepted parent to the manifest. Parent refusal or manifest
failure rolls both back. The root lock serializes equal request identities;
the original writer and outbox locks still decide receipt replay. Child writes
remain separate transactions. Thus interruption before child two can leave
parent+child one, with the complete expected plan durable.

Retries retain the original caller intent, scope, source time, semantic expected
rows and receipt keys/fingerprints. Differing caller content/cardinality conflicts.
Derived brief enrichment and `linear_raw` attribution metadata may change without
changing caller intent. The wrapper returns its first accepted expected rows
internally to the gateway, which uses that original brief/attribution on an
explicit retry, including the child outbound description. Original fingerprints
and current F27 fences remain untouched. The manifest itself stays immutable.
There is no automatic retry when acceptance is ambiguous: the complete original
caller request must still be supplied and pass all existing validation.
Omitting `source_edited_at` remains supported: the first server-assigned clock
governs the manifest, child creation/status clocks and receipt event on replay.
Changing an explicitly supplied timestamp conflicts; a newly defaulted server
clock on an otherwise identical timestamp-omitted request does not.

## What this proves and leaves open

The focused runner uses real production-write source and imports, real repository
migrations, and PostgreSQL transactions. Supabase HTTP is replaced by a narrow
SQL translator; provider/drainer fetch is entirely synthetic and cannot dispatch
live calls. Separate SET ROLE assertions test SQL permissions (the translator's
ordinary table calls use the fixture database owner).

The negative control loads the original a492 root source, creates a parent and
one child, then fails before child two: no expected manifest exists. The candidate
must distinguish that two-item partial state from a complete one-item request,
retain the missing content after browser payload loss, and pass explicit and
concurrent retries, changed-content/scope refusal, transaction-failure and
privacy checks. Test results are recorded below after execution; a SKIP is not
proof. Synthetic fixture payloads are never printed in the public report.

The real thumbnail generator gate has a separate baseline/candidate case: create
the first generated brief, fail before that child, change the protected plan and
generator template, then resend the unchanged original request. Existing source
accepts that replay but skips generation because the parent now exists, losing
the missing child's first brief. The candidate must accept the replay and reuse
the first stored content. Direct service-role replay also changes only derived
metadata and must return the immutable first plan. No new provider dependency is
introduced. Filming-plan fixture DDL is taken from the exact repository migration
prefix; historical real-client seeds and realtime registration are excluded.

This closes only prospective root detectability/storage. It does not reconstruct
children, materialize cards, remove provider reads/outbox prerequisites, drain
anything, activate an epoch, alter append/fill, repair old untracked partials, or
change public-intake budgeting. Existing receipts without a manifest can acquire
one only during an explicit replay with the full validated original request.
Lost historical payloads remain unreconstructable from the old receipt alone.
Dual outbox/parity, inbound workers and installed/live behavior remain UNPROVEN.

## Forward and retained-data rollback contract

This is an additive migration with no row backfill and no drop inverse. Before
any authorized release, capture the complete current deployed closure/JWT
posture and confidential database pre-state under the existing Section 4 process.
Apply the migration before deploying the new production-write closure; a missing
RPC fails before root acceptance. No activation/deployment is authorized here.

For behavior rollback, redeploy the exact captured prior production-write source
and verify serving source/JWT independently. **Keep the table, wrapper, grants,
and all accepted/inflight receipts.** New callers already in flight can finish
against the retained wrapper; old writer replay continues to work. Do not drop,
truncate, overwrite manifests, delete their parents, revoke the wrapper during
inflight calls, or blindly reverse authority/drain queues. Old EF root requests
after rollback do not gain manifests; new detectability is no longer guaranteed
for those requests. Existing evidence remains readable by the service role.
Live rollback and stale-serving population behavior remain a release gate.

## Execution receipt

Pending focused disposable PostgreSQL execution and exact-head CI.
