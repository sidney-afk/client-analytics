# Linear exit repair — installation dependency contract

**Status: PREPARED, NOT AUTHORIZED OR INSTALLED.** This is the technical
dependency order for the repaired candidate. It does not replace or ratify
`GO_LIVE_CHECKLIST.md`, `TRACK_B_LINEAR_REPLACEMENT_SPEC.md`, or a competing
cutoff/master sequence. Their unresolved owner decisions, final admission
fence, recovery, preservation and teardown gates still apply.

## The rule that prevents F01

Both workflows capable of deploying the lifted `production-write` now run
`scripts/linear-exit-deploy-preflight.js` before their **first** forward
deployment:

- [manual onboarding lane](https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-onboarding-edge-functions.yml): all 13 functions are one manual release scope. The check runs before the eight staff functions, not merely before the pinned provider/notification/gateway group. That group deploys `linear-outbound`, then `notify`, then `production-write`, then the two readers; the gateway cannot precede the sender it may wake.
- [F27 Section 4 lane](https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-f27-section4-closures.yml): the SQL check runs before `linear-outbound`, the first of four functions. Because this lane does not own `notify`, a second read-only gate requires the exact candidate `notify` closure and `verify_jwt=false` to be live before its first deploy.

The check issues one catalog-only `SELECT` through the Supabase Management API
using the workflows' existing protected access token. It compares exact
repository-derived function-body hashes, search paths, service/public grants,
enabled receipt triggers, required columns and configuration shapes. Its output
is only a PASS aggregate or a fixed failure code plus repository-public object
keys. It reads no application rows and prints no token, function body, flag
value, client identity or private source.

The F27 check is intentionally limited to `deploy-reviewed-release`.
`restore-captured-prior-four` does **not** require the new forward schema: an
old-source recovery must remain available when a failed or absent new SQL
prerequisite is the reason for restoring.

## Required database order

First capture and compare the actual installed schema, grants, flags, retained
receipts and recovery package. The files below contain non-idempotent owners;
do not blindly re-run an already-partial installation. The final candidate's
schema manifest must include the recovery/completion owners as well as the
gateway subset below; the nine-file gateway list by itself is incomplete.

Every database action below requires separate future owner authorization. The
SQL may come from an exact, pinned **unmerged** candidate commit, provided that
the reviewed bytes are the bytes later merged and deployed. This ordering does
not authorize applying that candidate now.

The concrete dependency order for a target on the audited baseline is:

1. Install and read back `2026-09-05-card-change-journal.sql` before admitting new repaired writes, plus `2026-09-05-calendar-feedback-recovery.sql` and the reviewed `2026-09-05-crosswalk-bind-and-import.sql` service-only recovery boundaries. These add no automatic recovery run.
2. Install the root manifest and composed intake group described below.
3. Install `2026-09-05-native-intake-reconcile.sql` after root manifest plus native epochs/receipts, then `2026-09-06-native-card-materialization-boundary.sql`, then `2026-09-07-legacy-intake-native-triage.sql`. The triage migration explicitly depends on root reconciliation and card materialization. Installing them does not run reconciliation or triage.
4. Install `2026-09-07-native-brief-media.sql` before a gateway can accept that private media contract. Verify the private bucket/table/ACL contract without printing object data.
5. Install `2026-09-06-linear-outbound-cutoff.sql` inactive before deploying cutoff-aware outbound source. Its presence is not authority to activate it, and the current retirement contract remains held while it blocks ordinary business writes.
6. Install assignment, labels, identifier mint, native client provisioning, the native browser projection, Editors attribution, ordinary native receipts and the notification outbox as detailed below.
7. Build and execute the integrated versioned backup/recovery package over this **final** owner set. Older selected-table snapshots do not prove the new schema, and recovery scripts are proof tooling rather than migrations to apply to production.

Within that order, the exact gateway/UI prerequisites are:

1. `migrations/2026-09-05-native-intake-root-manifest.sql` creates the private root-manifest owner used by the native intake upgrade.
2. `migrations/2026-09-05-native-label-catalog-foundation.sql` creates the immutable label catalog owner. It stages no real catalog and activates nothing.
3. Generate the **one atomic intake artifact** with `scripts/native-intake-named-append-compose.js`. It joins `2026-09-05-native-only-intake.sql` and `2026-09-07-native-intake-named-append.sql` under one outer transaction. At this candidate it must be SHA-256 `2571a909971f2bc52ef270400b7666c2b529d36ab4f6a56044f00d1b2ecf61ec`, 66,665 UTF-8 bytes, and report `outer_transactions: 1`. Never apply either half alone, and never apply `2026-09-07-production-intake-append-v8.sql` or the old native-only replacement afterward; either would replace the final hybrid `production_intake_append` body.
4. `migrations/2026-09-08-native-intake-receipt-retention.sql` adds DELETE/TRUNCATE protection after the composed artifact has created the intake receipt guard.
5. `migrations/2026-09-06-native-existing-assignment.sql` installs the default-provider assignment capability and retained native receipt contract.
6. `migrations/2026-09-06-native-label-writes.sql` extends the foundation with the default-provider, operator-attested native label capability and retained receipts.
7. `migrations/2026-09-07-native-identifier-mint.sql` installs the default-provider name mint. Seeding and activation are later deliberate operations, not part of schema installation.
8. `migrations/2026-09-09-native-client-provisioning.sql` adds `clients.native_project_ids` and the service-only provisioning receipt/RPC. Installation enrolls no client and changes no routing flag; invoking the RPC is a separately reviewed onboarding operation after serving proof.
9. `migrations/2026-09-09-native-attribution-browser-projection.sql` must follow native client provisioning **and** the complete Workload chain below, because the replaced view calls `production_workload_label_projection`. Preflight v6 also requires the `native_intake_legacy_project` source marker in the installed view definition; columns alone cannot distinguish the older projection that hides the new stamp. It precedes the browser source that reads its bounded `raw_attribution_project_id` and `raw_attribution_native_epoch` fields.
10. `migrations/2026-09-09-editors-event-assignee.sql` adds server-stamped event-time assignee attribution. It must precede the browser query that selects `event_assignee_id` and `event_assignee_attribution`; existing history remains honestly `unknown`.
11. Install `migrations/2026-09-09-native-ordinary-receipts.sql`, then the dormant `migrations/2026-09-09-syncview-retirement-admission.sql`, then `migrations/2026-09-10-syncview-retirement-native-ordinary-recognizer.sql`, `migrations/2026-09-11-native-ordinary-receipt-repair.sql` and `migrations/2026-09-12-native-ordinary-envelope-repair.sql`. The recognizer explicitly requires the dormant retirement routine and admissions table; none of these steps authorizes activation. Only deliverable and comment writers own ordinary receipts. Batch creation remains intake-owned, batch comments use the comment owner, and batch description/assets keep their separate native paths; the pre-existing `production_batch_write` is not replaced or ratified as an ordinary owner.
12. Install `migrations/2026-09-09-native-notification-outbox.sql` only after the current foundational B0/B1 schema, `migrations/2026-07-12-production-comments.sql`, step 10's event attribution, and the existing card/batch status and deliverable raw lifecycle owners are present. The repaired source does not require four new deletion columns. Read back all four private tables, their RLS/ACLs and sequences, the service-only RPCs, the exact four trigger definitions, and the security-invoker monitor view. Before any function deployment, a separately authorized service-only configuration write must create the protected `urgent_video_destination` object with exactly one valid `channel_id`; the deploy preflight reads only its shape and never prints the value.

### Notification lifecycle repair (2026-09-10; prepared source only)

A read-only `information_schema.columns` check confirmed that `deleted_at` is
absent from all four hosted tables: `calendar_posts`, `sample_reviews`,
`batches` and `deliverables` (all four tables themselves exist). Repository migration
inspection found notification consumers of these fields, but no migration
creating them on those four tables. The production-comments deletion column
is a separate owner and does not satisfy this prerequisite.

The earlier source and rehearsal incorrectly assumed those four columns.
The prepared notification owner now uses existing lifecycle state instead;
adding nullable columns would not establish that lifecycle contract. Earlier
isolated browser and notification results used synthetic columns and remain
historical evidence, not proof of this repaired source.
This metadata inspection read no application rows and changed no hosted state.

Source tracing narrows the repair: adding four nullable columns would not fix
the lifecycle mismatch. Calendar `_calArchiveOne` and Samples `_sxrArchiveOne`
in `index.html` archive cards with `status: 'Archived'`. Samples retains its
component substatus; Calendar's deliverable parking is best effort. Thus an
archived card can still have video substatus `Tweaks Needed`. B1 owns batch
`active`/`done`/`archived` status. Deliverable archive/delete evidence is retained
in `linear_raw` and interpreted by `_prodDeliverableLive`; canceled status is
not equivalent to deletion. `production_comments.deleted_at` remains a real,
separate comment contract.

The prepared notification repair must align gateway admission and SQL intent
creation/claim checks with those owners. Preserve client, reciprocal card,
assignee, team, round, authority and destination checks. Revalidate lifecycle
at claim time, including batch changes after admission; a later provider send
still has the documented point-in-time limitation. Required regression cases
include archived Samples retaining tweak substatus, archived Calendar after
failed parking, archived batches, raw-marked deliverables, and archive between
intent creation and claim. Retain positive active-target and canceled-status
semantics. Do not alter frozen card writers or create dummy deletion columns
to make the existing fixture pass. The repair is implemented in the prepared
candidate; exact isolated results and remaining limits are recorded in
`qa/linear-exit-rehearsal/RESULTS.md`. It has not been installed or served.

Use the existing normalized card-status predicate from component-fill and
reconciliation (`lower(btrim(coalesce(status,''))) <> 'archived'`). Deliverable
marker handling must preserve false-like values rather than interpreting every
non-null JSON field as deletion. Additional tests must cover marker variants,
card rebinding, batch/client/team changes, assignee changes, round advance and
physical row absence between enqueue and claim. Validate retained receipts
across archive/restore, and rerun existing status/comment cases. A shared SQL
eligibility predicate should prevent enqueue and claim checks from diverging;
its access contract must remain restricted with the other notification owners.

The shared liveness helpers preserve scalar false-like marker values and parse
one JSON-encoded object. Malformed/nonobject roots and array/object marker
values refuse eligibility consistently in SQL and gateway code. Canonical
comment deletion is rechecked before claim. Ordinary work on done batches
remains eligible; urgent work requires an active batch. Batch `team` is a
summary, not child authority: the intake owner creates mixed-team batches with
NULL there, and the append contract explicitly rejects using it as membership
proof. Urgent ownership remains the linked deliverable's video team. No new
batch-summary-team refusal is permitted.

For Workload, preserve its separate prerequisite chain: the native view before
the membership/snapshot RPC, then
`2026-09-08-workload-native-label-state-shape.sql` after the membership SQL, followed by
`2026-09-09-workload-native-roster.sql` for the authenticated capacity roster.
Complete this chain before native attribution browser projection step 9. Read
back the current installed revisions before deciding which steps remain; the
preflight pins the final Workload snapshot body and access contract, but does
not prove the live reader or the underlying view/data composition.

After the SQL set, run the preflight from the same pinned unmerged candidate in
read-only mode with the already-held operator credential. After that exact
candidate becomes reviewed `main`, each deploy workflow derives the same
contract from its reviewed-main checkout and repeats the preflight before its
first mutation. A PASS means the expected native SQL contract is present and
source-compatible. It does not mean the migration was safe on the captured
production schema, data was preserved, a catalog or mint was correctly seeded,
or any capability should be enabled.

## Serving order

1. Keep every new native capability in its installed dormant/provider state. Do not change authority, intake, assignment, label, identifier, ordinary-receipt, client-enrollment or cutoff flags. Leave notification sender/monitor variables and the gateway wake disabled.
2. Under a separate future database authorization, install the exact pinned unmerged candidate SQL and complete its schema/grant/trigger readback. The native client provisioning and native attribution projection migrations, plus the Editors event-assignee migration, must be present before the new browser reaches Pages. The ordinary-receipt final owners and notification outbox/config must be present before the corresponding gateway can deploy.
3. Complete the live read-only SQL preflight from that pinned candidate. Any `CONFIG_MISSING`, `READ_FAILED*`, `READ_RESPONSE_INVALID`, `CONTRACT_ABSENT` or `CONTRACT_MISMATCH` result stops before merge and before all Edge Function deployment.
4. Prove the old browser and old gateway tolerate the installed dormant schema, then merge only the byte-identical reviewed candidate. Pages publishes `main`, so its newly selected database fields must already exist. If policy prohibits applying SQL from an unmerged pinned candidate, the release is blocked until the new browser is changed and proved backward-compatible; elapsed time between publishes is not a substitute.
5. After merge, use the release manifest to choose **one** gateway owner lane. The onboarding lane deploys 13 functions and is the only existing lane that establishes the new `notify` sender before `production-write`. F27 Section 4 still deploys exactly four and requires its fresh sealed prior-four capture/upload plus merge freeze; it may serve a later gateway release only after the exact compatible `notify` source is already live. Each workflow rechecks source-compatible SQL from the reviewed-main checkout before its first deploy. Do not dispatch both merely because both are listed, and do not enable `NOTIFY_WAKE_ENABLED` before sender source/JWT readback passes.
6. Require exact source/JWT/version readback for every function the selected workflow actually deployed. A preflight PASS cannot turn a partial function deployment into success.
7. Only after the compatible gateway and browser are serving, run separately authorized TEST journeys and re-read every still-dormant capability. Flag changes, catalogue attestation, identifier seeding, client provisioning and final retirement remain distinct actions with their own receipts.

### Notification delivery cutover

Installing `2026-09-09-native-notification-outbox.sql` creates enabled observer
triggers immediately. There is no separate enqueue flag: eligible native UI
status/comment commits begin writing intents as soon as the migration commits,
even while the sender, monitor and gateway wake remain disabled. The sender
later claims every `pending`/due `retryable` row oldest-first; it has no release
cutoff that distinguishes an intent created before delivery activation.

That creates a mandatory disposition boundary. During the SQL-to-gateway and
provider-to-native ordinary-receipt window, an eligible status/comment may both
create a notification intent and retain its existing Linear outbound work. If
the sender is later enabled without inspection, it can post a delayed Slack
message for work that was also delivered to Linear and may already have caused
a Linear-side notification. Apply this order:

1. Keep `NATIVE_NOTIFICATION_SENDER_ENABLED` and `NOTIFY_WAKE_ENABLED` false. Enable no provider call merely because the SQL, sender source or monitor is present.
2. Record the separately authorized per-team ordinary-receipt native activation receipts. Prove that subsequent eligible status/comment writes produce terminal native receipts and no `linear-set-status`, `linear-add-comment` or `linear-outbound` delivery. A source assertion is insufficient.
3. With read-only service access, capture aggregate intent counts by `kind`, `state`, deliverable team and creation time on both sides of those activation receipts. Print no client, card, comment, member, channel or message data. Any pre-boundary `pending`/`retryable` row keeps sender activation on **HOLD**: the current protected reconciliation RPC has no truthful “obsolete/duplicate already notified through Linear” terminal action, and direct update/delete is not an allowed substitute. A reviewed repair or explicit decision to send that bounded backlog is required.
4. Prove the urgent route separately. A new browser/gateway sends a native-card urgent request only to `production-write`; a pre-deployment browser may fall back to `send-urgent-slack`, and an older cached browser can still call that n8n webhook directly. The legacy post and native intent share no server-side deduplication key. Before native urgent delivery, require current browser/gateway source proof plus a read-only n8n execution/in-flight check and a provider-channel check around the boundary. Legacy-only cards may retain their documented route; a native card must have exactly one route.
5. Enable and verify the monitor first. Only after the old notification paths are excluded and every pre-boundary row has an honest disposition may a separately authorized bounded sender invocation deliver the accepted post-boundary backlog. Enable the schedule after its receipt and monitor pass; enable gateway wakes last.

### Exact urgent workflow and editor-map retirement

Workflow `TJVMyfwl85qrFGeK` (`send-urgent-slack`) and its hardcoded email-to-Slack
fallback are explicitly included in this cutover. The earlier native n8n draft
reused that map; it is superseded by the owner's zero-new-n8n route. Native
urgent admission now reads the assigned deliverable and active
`team_members.slack_user_id`, while protected `urgent_video_destination` selects
Video Editing. No editor identity is inferred from a Google Sheet column.

Before retirement, privately verify mappings for every active editor who can
receive urgent work, including new hires, and exercise missing/wrong-recipient
failures plus exact-recipient provider receipts. Keep the live legacy map
accurate while any active caller still depends on it. Do not call that upkeep
wasted effort before the actual switchover. Only after the route/cached-browser/
in-flight checks above prove native coverage can a separately authorized
operator retire the old workflow entry and its map. This is not an instruction
to edit or deactivate n8n during the audit.

Turning the sender schedule and gateway wake off stops new provider calls but
does not stop the database triggers from recording intents. A gateway rollback
therefore disables both delivery switches first, preserves and recaptures the
intent census, and leaves the prior-four source restore independent of the new
notification schema and sender. Never delete queued evidence to make rollback
look quiet.

Retirement activation is **not** a safe last step while it blocks ordinary
native status, comment, due-date, title or other business writes. The release
must prove that every supported native business write continues under the
retired contract before activation. Stopping application writes is not an
acceptable way to make mirror debt stay at zero.

## Stop and recovery points

| Point | Stop condition | Safe response |
|---|---|---|
| Before SQL | Captured schema/recovery prerequisite differs from the reviewed baseline | Apply nothing; reconcile the candidate against the captured state. |
| During SQL | A transaction refuses or a post-step readback differs | Start no Edge Function deploy. Preserve the failure receipt and inspect partial earlier transactions; never “finish” by applying an old append replacement. |
| Preflight | Any non-PASS result | Zero functions deploy. Correct or complete SQL, then rerun the read-only check. |
| Partial F27 forward deploy | A deploy/readback fails after an earlier function changed | Hold affected admission, inspect exact live versions, then use the already-sealed `restore-captured-prior-four` operation or complete the reviewed compatible set. Restore remains independent of the new preflight. |
| Partial onboarding manual deploy | Any of the 13 deploys or final attestation fails | Hold affected admission and identify every live closure. This lane has no equivalent bundled 13-function restore; do not infer rollback from the job's final red state. In particular, never enable gateway notification wakes until compatible `notify` readback passes. |
| After accepted native work | A later canary or capability fails | Hold new admission and repair forward while preserving names, epochs, manifests, event attribution and receipts. Do not restore provider-only/bare-title functions or delete retained evidence. |

## Owner clarification — preserve existing behavior

Owner clarification, 2026-09-09, supersedes the earlier unanswered questionnaire:

1. Video-only and Graphics-only handling already exists. Preserve the current
   routing and visibility behavior; verify parity rather than inventing a new rule.
2. Replies in a client-visible thread remain visible to the people authorized
   to see that thread. This does not authorize exposing staff-only threads,
   another client's data, or content to unauthenticated visitors.
3. Completed/resolved comments remain accessible through the History icon,
   as they are today. Do not replace this with a dimmed-always-visible design.

The human escalation contact/channel for an unrepaired legacy card has not
been supplied. This is an operational routing detail, not an invitation to
redesign these three existing behaviors or a reason to stop independent repairs.

The separately recorded Slack scope remains status-only for `smm_approval`/`tweak`,
plus new sub-issue comments in the client creative channel without tags, and
urgent video work in the separate Video Editing channel. Those decisions are settled.

## Evidence still required before installation or cancellation

- Upgrade rehearsal over a current private production-schema capture, including interruption after every separately committed migration, plus empty-target schema/data/object recovery.
- A live read-only preflight PASS from the exact selected deploy workflow, followed by source/JWT/version readback for its complete function set.
- Disposable PostgreSQL notification proof for status, staff/client comments, urgent admission and claim-time revalidation, blocked/unknown reconciliation and concurrent claim/receipt paths; then a separately authorized provider sandbox proof that no intent is marked sent without its durable provider receipt. Source inspection and a configured channel row are not delivery evidence.
- Old/new browser and old/new compatible gateway coverage for intake, picker, assignment, labels, names, client provisioning and Editors; both teams; failed flag/config reads; and no change to the frozen tokenless calendar/review writers.
- P7 browser attribution: for both teams and both existing Linear project mappings and native-only client mappings, create a fresh card with provider transport denied, verify the expected client grouping, edit that same card through the ordinary browser, reload, and verify persistence. Existing mirrored cards and HTTP create success are insufficient. Preserve refusals for mismatched/inactive ownership and contradictory project/family evidence. Old unresolved cards require separate diagnosis; do not bulk-stamp them from their stored slug.
- Actual-handler plus disposable-SQL journeys with provider transport denied, including provider-era and native parents, lost response/browser, partial child/card completion, replay after actor/capability changes and concurrent activation.
- Private archive/assets/export completeness, accepted provider-era work disposition, complete backup corpus and recovery, and the live read-only n8n/webhook/cron/OAuth inventory.
- The original server-enforced final admission boundary, in-flight completion proof, outbox retired-mode contract, independent human alert path and post-cutoff monitoring. This document does not approve a weaker census/wait/off substitute.
- A typed retired-mode result for every ordinary native business operation,
  proving the application write and durable audit/receipt continue while no
  undeliverable provider debt is created. Retirement stays held until that is
  true.

Until those receipts exist, the install decision remains **HOLD**.

## Unreleased local Windows rehearsal repairs

The supplied `6b8637b47264f9df090e988c7c9c22d5cfe31822` candidate was rehearsed
against owned loopback PostgreSQL 16 and 17 instances on Windows. The initial
PG16 run failed 15 of 485 suites; this result is retained, not a clean baseline.
Two application defects were reproduced: sparse `deliverable_write` updates
failed required-scope constraints before `ON CONFLICT`, including through the
artifact owner; urgent notification routines could not resolve `digest` when
pgcrypto lived in `extensions`. The local repairs preserve scope from the locked
existing row and add the trusted extension schema to the two urgent routines.

Test repairs make the boot helpers importable without running their CLI,
correct Windows file URLs and UTF-8 SQL transport, provide current fixture
prerequisites, and fix an event-assignee assertion helper that checked the
message instead of the condition. The notification SQL lane now exercises
`deliverable_write` and `production_comment_upsert` rather than manually
stamping the positive status/comment events. Negative observer fixtures remain
explicit. Ordinary-receipt tests include the current event-assignee owner;
their separately disclosed F27/native-owner prerequisite triggers remain
no-ops, so this still does not prove the full owner composition.

The native Windows fallback is separate from the supplied Docker runner.
After the owner enabled firmware virtualization and restarted, WSL2 and Docker
became available. The first Docker run exposed Windows PowerShell treating
normal image-pull stderr as a terminating error; container cleanup also lost
embedded quotes in its label lookup. The local runner now checks Docker's exit
code and reads labels as JSON while retaining the exact ownership check. The
PG17 F27 Docker proof passed, including owned-container cleanup. The PG16 Docker
run had 482/485 passing suite exits: one test assumed `/tmp`, and two selected
the WSL Bash launcher instead of installed Git Bash. All three affected checks
passed after using the system temporary directory and Git Bash; the runner now
prefers Git Bash for this process and restores PATH afterward. The original
failed run is retained; no subsequent full 485/485 pass is claimed. Three
optional SQL rehearsals still skipped. Chromium tests with synthetic HTTP
responses do not establish an end-to-end browser/HTTP/SQL journey. Local provider
receipt simulations do not establish Slack delivery. No local result authorizes
installation, publication, activation, production data changes, or n8n execution.


### Returned-candidate deployment contract review (2026-09-10)

Review of returned commit `686add359bcf6c8a98e4d080cec763619013e852`
found both corrected urgent routines declare `public, extensions, pg_temp`,
while the deploy preflight still required `public, pg_temp`. Exact `proconfig`
comparison would reject a correctly installed candidate. Preflight v6 matches
the tested SQL declarations; a regression check now compares every declared
routine search path with its source migration. Application SQL is unchanged
from the returned local repair. This does not replace a real catalog readback
or turn the reported 482/485 PG16 run into a full green database run.

### Final local database continuation

The reviewed `c3397f93f` candidate completed the full 485-suite Docker PG16
lane and the separate PG17 F27 proof. Three optional SQL rehearsals skipped
inside that run. Explicit follow-up execution passed component fill and
crosswalk binding; client-access provisioning required normalizing Windows
CRLF output before comparing rows, then its real SQL assertions passed too.
This test-only portability correction does not alter application SQL or
provisioning expectations. Browser/SQL journeys and final source pins are
recorded in the separate private reproducible handoff; these local results
retain all installation and production restrictions above.

### Local browser findings after reviewed candidate c3397f9

Isolated Chromium -> current handler -> synthetic PostgreSQL journeys reproduced two defects. Fresh native intake rows now initialize a complete empty label snapshot only under an accepted native epoch; provider rows and existing unknown label state retain their prior behavior. Calendar/Samples append discovery now accepts parentless batches only when the fresh native-intake flag confirms every selected team. Failed or malformed capability reads retain the orphan refusal. The historical whole-handler comparison explicitly accounts for the bounded label initialization and retains equality outside that block. Frozen card writers are unchanged. Evidence and limitations are supplied separately in the private final-evidence harness; this is not production or installation approval.

The expanded local status-to-notification journey also reproduced a timestamp mismatch: eventFor always supplied a caller `ts`, while the event-assignee owner intentionally treats that field as historical provenance. Live status events now omit that ledger override and retain source_edited_at inside the exact outbound retry receipt. Create events keep their original timestamp. The actual event builder is regression-tested; the browser/SQL harness verifies committed notification intents without manually stamping events. No imported/source-timed SQL policy was relaxed.

### Incorporated upstream urgent-ping ledger source

The preparation branch now includes the source changes from upstream
`fcebb856d3f5ea607cf5665ac391c258ad173abb` (applied as a reviewed patch,
not a PR merge). The marker owner precedes
`2026-09-10-kasper-urgent-ping-ledger.sql`; that ledger migration creates four
triggers and backfills per-client/per-round event history. Its exact upstream
bytes passed isolated composition and authenticated recovery with restored
trigger behavior. These are synthetic results, not a refreshed hosted catalog.

The upstream writer edits remove duplicate event emission only. Their repository
authentication remains divergent from the frozen serving contract: do not deploy
these repository writers as part of Linear exit. Any later authorized SQL plan
must first compare actual installed trigger/function definitions and retained
ledger evidence; this document does not authorize rerunning a live backfill.

## Shared installation manifest: next implementation contract

Status: source inventory implemented; full installation/resume manifest not built. Existing schema composition and recovery evidence
remain valid in their bounded scopes; neither is an executable installation plan.

The shared manifest must be consumed by both installation and recovery
rehearsals. Each entry must contain a stable identifier, repository path and
SHA256 of exact source bytes, explicit predecessor entries, transaction boundary,
expected pre/post catalog signatures, and a reviewed resume rule. The atomic
intake composer is one entry with its generated hash and all input hashes;
never split its two inputs into independently resumable steps. Include the
upstream marker/ledger owner, its backfill and associated tests explicitly.

Concrete reconciliation work, based on current source:

- Move journal/feedback/crosswalk ownership before admitting repaired writes;
  current composition intentionally installs these only after48 assertions.
- Resolve the ordinary-receipt repair versus retirement-admission/recognizer
  order against final function definitions. The fixture and document currently
  differ; neither order may be declared authoritative merely because it exists.
- Include the complete intake composer/input chain, receipt retention, Workload
  label-state/roster, browser projection and inherited baseline owners. Recovery
  SOURCES currently pins only part of this transitive installation inventory.
- Separate platform/baseline requirements from executable candidate migrations.
  The eight dated card definitions and F42/Storage scaffolding are not a complete
  current target baseline; their presence cannot authorize production execution.

Acceptance requires one ordered run retaining representative accepted receipts,
then interruption after every separately committed entry. Reconnect with a new
connection and classify each step as absent, exact-installed, or divergent from
its pinned post-state. Resume only from proven compatible state; divergent
definitions require refusal. Prove an interrupted atomic entry rolled back and
a nontransactional entry's partial application is detected. Never blindly replay
an owner or use a table count as a substitute for function/trigger/ACL identity.
Keep accepted receipts, names, epochs and ordinary writes intact through every
supported resume boundary, and retain every failed receipt.

A fresh hosted schema capture and all live installation/cutover actions remain
separate gates. The current read-only preflight stops on absent notification
configuration with SQLSTATE42P01. A future diagnostic-only improvement could
validate metadata before querying optional configuration tables and guard JSON
object inspection against scalar input; it must preserve fail-closed behavior.
No preflight implementation change or hosted migration was made for this finding.

### Receipt-order source finding

Source inspection narrows the apparent ordering discrepancy: repair11 changes
the ordinary admission foreign key and event helper; repair12 supersedes that
helper and the comment lifecycle writer. Retirement admission and its recognizer
own different routines. Keep repair11 before repair12, and admission before
its recognizer. This does not prove equivalence of intermediate database states
or safe writes between commits. The shared plan may propose the documented
order, but its catalog and interruption proof remains required.

Resume signatures must describe each cumulative committed boundary, not merely
the latest definition created by an individual file: later owners intentionally
replace earlier routines. A match to an obsolete per-file body cannot establish
that the current prefix is installed correctly.

### Inventory implementation and reproduction

Run `node scripts/linear-exit-install-manifest.js` to emit the current inventory
without opening a database connection. Run
`node test/linear-exit-install-manifest.js` for offline contract validation.
The dated JSON artifact under docs/independence pins working-tree source bytes;
checkout line-ending differences require regeneration and review, not ignoring
a hash mismatch. Its verify() routine refuses source or contract drift.

The output distinguishes baseline-source inventory from candidate owners and
keeps atomic intake indivisible. It validates declared graph edges but explicitly
does not assert the graph is complete. No target catalog signature is invented,
no resume is authorized. Both existing rehearsals now verify the same inventory
before database creation and before PASS, while retaining their independent
execution orders. The supported installation-order lane now proves the remaining
42 entries execute in manifest order on the disclosed scoped baseline. The
installation-resume lane proves authenticated entry-boundary progress with the
parent alive, including forged-prefix and catalog-drift refusal. Neither proves
the full hosted baseline, internal-commit recovery or a production installer.
Savepoint validation resets state across transactions and models nested release
and rollback semantics; it does not execute the SQL or prove installed behavior.

### Accepted-work preservation case

Use the real root-intake and deliverable writer RPCs immediately after the
atomic intake entry, before later retention/ordinary/admission owners. The
existing seed in `scripts/card-history-backup-rehearsal.js` provides a starting
shape, but its older child dedup must be aligned with the root manifest's exact
expected child dedup. Read the actual local F27 generation and use a synthetic
native epoch/request; never assume generation zero or bypass the native guard.

Require actual skipped native receipts, matching request/epoch, and zero pending
provider debt. Preserve parent, child, root manifest, receipt and event identities
and admitted values through each later entry and resume boundary, then replay
the exact accepted calls without duplicate rows. Schema extensions may add new
columns: explicitly distinguish those additions from changes to pre-existing
values, rather than accepting changed old values or weakening failure checks.
The installation-resume lane now executes this case: one synthetic native request
preserved across 25 later entries, then exact final replay without duplicates.
Global provider debt remains zero. This is five-table scoped evidence, not full
data preservation, card materialization or interrupted internal-commit recovery.

### Selected internal-statement interruption evidence

The inventory identifies 12 remaining owners with autocommit statements. A
completed-entry checkpoint cannot establish safety inside these owners. A small
concrete negative case is the three-statement workload native label shape owner:
its function replacement precedes REVOKE and GRANT. Stop a disposable execution
after the replacement, reconnect, and require partial-state refusal against the
previous completed prefix before any further owner executes. Do not wrap the
file in a new transaction or certify the partial function/ACL state as complete.
An atomic intake case must separately prove rollback when its transaction is
interrupted. The supported installation-interruption lane now proves these two selected
connection-termination points, with atomic catalog/affected-row rollback and
partial autocommit refusal after 29 completed entries. The partial state is left
unrepaired; accepted business-call replay preserves current rows. All remaining
internal boundaries, parent/process-kill recovery and safe partial-state repair
remain unproven. This does not permit resuming a real installation.
