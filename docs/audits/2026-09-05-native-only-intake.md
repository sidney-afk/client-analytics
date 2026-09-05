# Disabled native-only intake draft

Status: unapplied, undeployed, disabled by default. This is a bounded F32 intake
slice, not Decision A, B5 activation, full Linear retirement, or live server proof.

**Chosen-editor intake is still provider-dependent.** Explicit VIDEO assignment
uses the unchanged eligibility policy; missing, unreadable or strict
`production_assignee_eligibility` can require Linear and refuse the request when
Linear is unavailable. The actual-handler degraded chosen-editor control keeps
this readiness gate red with zero partial native commit. The automatic-assignment
native cases do not establish universally provider-free intake. Assignment policy
and rollout remain outside this slice.

## Exact dependency and drift boundary

The branch starts at independently reviewed PR1293
`5418ab5618595d9469f0527bd94623e9229a637e`, depending on its root manifest migration
and handler. PR1293 remains separate. PR1274 at
`7d2812ac60358b3e73e26de2622cc2d25b90bb90` and the PR1293 audit are historical
evidence, not authority to activate anything. The native manifest harness is
reused; no historical readiness result is relabelled.

Remote main was captured once as `731e7c248fd8c055a577e7c7f40a81236532250c`.
Its eleven newer files concern crosswalk bind/import repair, its runner, tests,
workflow and documentation. They do not change production-write or this intake
SQL chain. No main reset, merge or unrelated repair is included. Later main
advances belong to a future exact integration review.

The coordinator later named main `244de82a83a446d17b1a6b05e3b6c0828b631151` for a
read-only drift assessment. Its production-write change is confined to
assetSnapshot's full-page exclusivity inference; the intake/epoch/append/fill
code and policy import are unchanged. An existing graphics SMM-approval row on
intake retry still traverses the artifact precheck, so future integration must
rerun post-asset-resolution, asset and intake regressions and recompute the
Section 4 closure pins. Neither branch's source pin is serving evidence. That
main advance is not merged into this exact-PR1293 draft.

## Acceptance and replay contract

`native_intake_epochs` is a server-read flag with exactly two team entries:
`video` and `graphics`, each with an `enabled` boolean and an operator-chosen
epoch string. The migration seeds both disabled with null epochs, using
ON CONFLICT DO NOTHING. Missing, unreadable or malformed configuration fails
closed for new admission. The browser does not choose or override the lane.
Existing authentication, public-intake limits, client scope, reviewed per-team
project mappings, assignment rules, prod_authority and F27 fences remain required.
This slice removes provider project/parent reads for native-only intake; it does
not remove the persisted mapping prerequisite or change assignment policy.

Root manifests gain an immutable `native_epochs` map. Empty team strings mean
provider work. Existing manifests default to an empty map, interpreted as their
original provider lane. The root wrapper compares the accepted map on retry,
locks current flags and both team generations on first admission, validates all
expected child authorities and active F27 holds, then commits the map, complete
expected manifest and parent together. A failed prerequisite leaves no native
parent, manifest, child or outbox receipt. The existing public rate ledger is a
separate pre-admission anti-abuse record; that claim does not erase it.

Every new intake payload carries `_native_intake_epoch` and
`_native_intake_request` without changing the existing fingerprint inputs or
dedup keys. Native outbox rows are inserted with terminal `skipped` status,
zero attempts, processed timestamp and a `native_only` epoch result. They remain
idempotency receipts and dependency evidence, with no actionable provider work.
This intentionally retains rows: the full B5 spec's zero-outbox-row requirement
is not claimed satisfied. Terminal receipts cannot be requeued or converted into
provider receipts, and provider receipts cannot be converted into native ones.

The new receipt trigger sorts after `track_b_f27_hold_guard`. The installed F27
trigger sees the original pending row and checks hold/generation before the
native trigger terminalizes it. The F27 enqueue function, hold function and
authority-generation column contracts are not replaced by this migration.

On explicit retry, the gateway resolves original manifest/receipt epochs before
reading mutable flags or calling Linear. A lost parent response or a missing
child therefore retains the accepted native epoch after disablement or a new
epoch. A pre-manifest parent receipt pins missing children to provider behavior.
Current authentication/authority/F27 checks still apply: provenance does not
override an operator hold. Provider requests keep their provider reads, original
fingerprints, parity, pending receipts and replay behavior.

Append/fill remain atomic. Their exact existing receipt identifies the original
epoch on replay. A native append/fill uses the validated native batch as parent
and never requires its Linear parent receipt to drain. Existing row/card locks,
card existence/occupancy, origin, numbering, CAS and replay checks remain.
Provider routing is unchanged, including rejection when its only parent is a
native terminal receipt. No SyncLinear creation surface is added.

Mixed roots preserve the existing single parent owner, video when present.
Provider video parent plus native graphics works; native video parent plus
provider graphics is refused before native commit because the provider child
would have no provider parent. Single-team native roots work independently.
This is an explicit bounded limitation, not an automatic route fallback.

## Client and stale-caller behavior

No browser payload or UI changes are required. Fresh and stale browser callers
use their existing request IDs, items and source timestamps. Native success
returns the existing committed response shape with `mirror_pending=false` for
fully native work. A mixed request reports any genuine provider mirror debt.
Unknown acceptance remains unknown: retain the complete original request and
reconcile its receipt/manifest. Never mint a replacement ID, claim failure means
zero acceptance, or tell the user to resubmit as new work.

Old Edge Function closures are a different compatibility boundary. With flags
disabled, old root callers continue using the retained SQL interfaces. Once a
native epoch has accepted work, a stale closure without epoch metadata is refused
when it would create a missing native child as provider work. It may also still
attempt provider reads. Deployment must prove the actual serving population;
source files and a successful manual build do not prove that. Retain an
epoch-aware gateway for accepted native replay during behavior rollback.

## Operator roles, release order and abort gates

No step below is executed by this draft.

1. The owner authorizes a separate release window. The SQL operator captures
   confidential database state, flags, receipts and manifests; the Edge Function
   operator captures the actual deployed closure and JWT posture through the
   existing Section 4 process. Capture exact current main and dependency heads.
2. Apply PR1293's root manifest migration, then
   `migrations/2026-09-05-native-only-intake.sql`. Both teams remain disabled.
   SQL owner privileges are needed for DDL/flag updates. Do not grant flag write
   access to browsers or add a gateway flag mutation operation. Existing flag
   table grants are unchanged; service-role access is already privileged.
3. Verify the installed manifest column/default, replaced root/append/fill RPCs,
   new service-only epoch readers, terminal trigger ordering and retained ACLs.
   Service role can SELECT manifests and execute the existing authenticated
   writer interfaces; it cannot directly INSERT/UPDATE/DELETE manifests.
   Public and authenticated roles cannot execute the new epoch readers.
4. Deploy the exact reviewed production-write closure and independently read
   back source/JWT through the pinned manual Section 4 path. Existing five-file
   closure membership remains unchanged. Do not deploy either frozen anonymous
   writer, change their authentication, or change the publishable key.
5. Keep activation HELD. Any future per-team flag update requires explicit
   operator authority, an exact old-value CAS/readback, a unique recorded epoch,
   complete provider debt classification, F27/freeze proof and the still-missing
   installed/full serving and materialization readiness evidence. This narrow
   intake flag is not authority to retire Linear or flip prod_authority/F2/F4.

Abort on missing/malformed flag state, stale source/JWT/catalog, mismatched
dependency heads, ambiguous project/parent mappings, generation/hold failures,
unexpected provider dispatch, unclassified old intent debt, conflicting retries,
missing manifests or any missing-child/card/full-serving readiness failure.

## Retained-data rollback

Disable new native admission with the exact per-team flag CAS and readback;
keep epoch history in all accepted manifests/receipts. Accepted native requests
continue via the epoch-aware gateway and unchanged IDs. New provider requests
may resume only when their provider prerequisites are independently healthy;
new provider append/fill on a native-only parent remains refused.

Retain the new SQL, manifest column, reader RPCs, terminal guard, expected
payloads, native rows, events and outbox receipts. Do not drop/truncate/rewrite
tables, delete accepted parents, strip epoch markers, reset receipts to pending,
blindly reverse authority or drain queues. A source rollback to a pre-epoch
gateway can suspend native recovery and requires explicit containment and a
reviewed compatible forward release; it cannot reinterpret accepted native work.

## Local evidence and limits

The actual production-write handler and repository migrations execute against
disposable PostgreSQL 16.14 bound only to 127.0.0.1. The existing PR1293 SQL shim
replaces Supabase HTTP; its recording fetch replaces all provider/drainer traffic.
The focused native runner also executes exact repository F27 enqueue/hold
functions, their trigger and rollback table. This is the write fence subset,
not the complete F27 installer/recovery system or installed production state.

The original manifest regression suite passed 41 checks plus 3 baseline controls.
The expanded native suite passed 50 checks, covering root, append/fill, native
and provider histories, mixed teams/authority, provider unreachability, unreadable
and malformed flags, lost responses, concurrent identical/conflicting requests,
epoch flip between read/commit and admission/replay, stable manifests, terminal
receipt immutability and zero-partial-commit prerequisite failures. Concurrent
append requests may both return 201 because both gateway preflights saw no
receipt; the actual SQL result proves one replay and one durable child/receipt.

Missing-child and missing-card controls explicitly show those readiness
failures still present; a missing-card fill remains refused. No scheduled
materializer, assignment rollout, cosmetic removal, event-sourcing program,
Calendar/Samples linkage repair, n8n edit, credential or billing action is part
of this slice. Installed/full serving prerequisites remain HELD/UNPROVEN.
The explicit readiness report remains FAIL for missing-child materialization,
missing-card materialization and chosen-editor provider independence, and
UNPROVEN for installed/full serving.

The full local required-PostgreSQL run executed all 403 suites: 400 passed and
three failed. Two were runner configuration failures because PGDATABASE had not
been explicitly set to `postgres`: f63-flip-runbook-sql-gate and
linear-deliverables-reconcile-bounded-postgres both passed targeted reruns with
that required setting. The remaining asset-access-any-team failure is the
Windows `ERR_UNSUPPORTED_ESM_URL_SCHEME` import error, independently reproduced
on exact base `5418ab56`; it is unchanged and remains red. This is not a claim
that one full local invocation passed. Some unrelated opt-in/server-binary lanes
still report their own SKIP; the native/manifest PostgreSQL lanes did not skip.

Focused gateway, append, intake convergence/status, Samples, public intake,
thumbnail text, post-asset-resolution, error guidance, deploy provenance,
Section 4 pins, truth-sync and repo-map checks pass. Node 22 type-strip/module
warnings and deliberately injected synthetic transport errors remain in the
private local logs; they are not hidden as clean runtime output.

Expected production-write closure:
`3a4e3557d4bddd596de90180cf07a4bd7807219494e4df010a7e4b6cdd12f541`;
entrypoint SHA256:
`6dab61076818be8423bfc0f0c8a5bcd0069d8ef761672bc9b6592bfc998d94b7`.
Five closure files; generated deployment-ownership manifest unchanged.
Hosted exact-head results are recorded in the PR handoff.
