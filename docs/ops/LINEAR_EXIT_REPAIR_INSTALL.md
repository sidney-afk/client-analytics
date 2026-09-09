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

- [manual onboarding lane](https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-onboarding-edge-functions.yml): all 12 functions are one manual release scope. The check runs before the eight staff functions, not merely before `production-write` at position 10.
- [F27 Section 4 lane](https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-f27-section4-closures.yml): the check runs before `linear-outbound`, the first of four functions.

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

The concrete dependency order for a target on the audited baseline is:

1. Install and read back `2026-09-05-card-change-journal.sql` before admitting new repaired writes, plus `2026-09-05-calendar-feedback-recovery.sql` and the reviewed `2026-09-05-crosswalk-bind-and-import.sql` service-only recovery boundaries. These add no automatic recovery run.
2. Install the root manifest and composed intake group described below.
3. Install `2026-09-05-native-intake-reconcile.sql` after root manifest plus native epochs/receipts, then `2026-09-06-native-card-materialization-boundary.sql`, then `2026-09-07-legacy-intake-native-triage.sql`. The triage migration explicitly depends on root reconciliation and card materialization. Installing them does not run reconciliation or triage.
4. Install `2026-09-07-native-brief-media.sql` before a gateway can accept that private media contract. Verify the private bucket/table/ACL contract without printing object data.
5. Install `2026-09-06-linear-outbound-cutoff.sql` inactive before deploying cutoff-aware outbound source. Its presence is not authority to activate it, and the current retirement contract remains held while it blocks ordinary business writes.
6. Install assignment, labels, identifier mint, native client provisioning and Editors attribution as detailed below.
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
9. `migrations/2026-09-09-editors-event-assignee.sql` adds server-stamped event-time assignee attribution. It must precede the browser query that selects `event_assignee_id` and `event_assignee_attribution`; existing history remains honestly `unknown`.

For Workload, preserve its separate prerequisite chain: the native view before
the membership/snapshot RPC, then
`2026-09-08-workload-native-label-state-shape.sql` after the membership SQL.
Read back the current installed revisions before deciding which steps remain;
the gateway preflight does not certify the Workload reader.

After the SQL set, run the preflight from the exact candidate in read-only mode
with the already-held operator credential. A PASS means the expected native SQL
contract is present and source-compatible. It does not mean the migration was
safe on the captured production schema, data was preserved, a catalog or mint
was correctly seeded, or any capability should be enabled.

## Serving order

1. Keep every new native capability in its installed dormant/provider state. Do not change authority, intake, assignment, label, identifier, client-enrollment or cutoff flags.
2. Complete the live read-only SQL preflight. Any `CONFIG_MISSING`, `READ_FAILED*`, `READ_RESPONSE_INVALID`, `CONTRACT_ABSENT` or `CONTRACT_MISMATCH` result stops before all Edge Function deployment.
3. Merge only a candidate whose new-browser/old-gateway paths are proved. Because Pages publishes `main` and both Edge Function workflows require a commit on `main`, this compatibility evidence is what covers the short Pages-to-gateway interval; timing estimates do not.
4. Use the release manifest to choose **one** gateway owner lane. The onboarding lane deploys 12 functions; F27 Section 4 deploys exactly four and requires its fresh sealed prior-four capture/upload plus merge freeze. Do not dispatch both merely because both are listed.
5. Require exact source/JWT/version readback for every function the selected workflow actually deployed. A preflight PASS cannot turn a partial function deployment into success.
6. Only after the compatible gateway and browser are serving, run separately authorized TEST journeys and re-read every still-dormant capability. Flag changes, catalogue attestation, identifier seeding, client provisioning and final retirement remain distinct actions with their own receipts.

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
| Partial onboarding manual deploy | Any of the 12 deploys or final attestation fails | Hold affected admission and identify every live closure. This lane has no equivalent bundled 12-function restore; do not infer rollback from the job's final red state. |
| After accepted native work | A later canary or capability fails | Hold new admission and repair forward while preserving names, epochs, manifests, event attribution and receipts. Do not restore provider-only/bare-title functions or delete retained evidence. |

## Evidence still required before installation or cancellation

- Upgrade rehearsal over a current private production-schema capture, including interruption after every separately committed migration, plus empty-target schema/data/object recovery.
- A live read-only preflight PASS from the exact selected deploy workflow, followed by source/JWT/version readback for its complete function set.
- Old/new browser and old/new compatible gateway coverage for intake, picker, assignment, labels, names, client provisioning and Editors; both teams; failed flag/config reads; and no change to the frozen tokenless calendar/review writers.
- Actual-handler plus disposable-SQL journeys with provider transport denied, including provider-era and native parents, lost response/browser, partial child/card completion, replay after actor/capability changes and concurrent activation.
- Private archive/assets/export completeness, accepted provider-era work disposition, complete backup corpus and recovery, and the live read-only n8n/webhook/cron/OAuth inventory.
- The original server-enforced final admission boundary, in-flight completion proof, outbox retired-mode contract, independent human alert path and post-cutoff monitoring. This document does not approve a weaker census/wait/off substitute.
- A typed retired-mode result for every ordinary native business operation,
  proving the application write and durable audit/receipt continue while no
  undeliverable provider debt is created. Retirement stays held until that is
  true.

Until those receipts exist, the install decision remains **HOLD**.
