# A4 — native onboarding eligibility after the Linear cutoff

Date: 2026-09-21  
Scope: read-only code trace plus aggregate-only live database reads. No names, ids, emails, slugs, tokens, writes, or test submissions were read or emitted.

## Answer

**No on a native lane; yes on the retained provider lane.** A new editor or designer whose
`team_members.linear_user_id` is `NULL` is eligible for native assignment when the row is active,
has the exact team, and has the exact creative role (`editor` for video, `designer` for graphics).
The native epoch makes `providerMappingRequired: false`
(`supabase/functions/production-write/policy.mjs:501-533`). The provider fallback deliberately
keeps the old mapping requirement and excludes the same row.

This distinction matters at each surface: Create Post asks the gateway which lane is current;
Production asks the gateway for the target row's accepted native-assignment epoch; the write
gateway validates again with that epoch. No browser answer alone authorizes the write.

## Assignee decision paths

| Surface | Exact path | Effect of `linear_user_id IS NULL` |
|---|---|---|
| Create Post editor list | `_calNativeVideoEditorPool()` calls `production-write` action `intake_editor_options` (`src/index/170-calendar-links-status.js.part:1864-1935`). `handleIntakeEditorOptions()` reads active video rows including `linear_user_id`, then passes them to `nativeIntakePool()` (`supabase/functions/production-write/index.ts:3835-3865`). | **Included when native.** `nativeIntakePool()` calls `assigneeEligibility(... providerMappingRequired:false)` (`policy.mjs:549-562`). **Excluded only in the provider fallback:** `_calLegacyVideoEditorPool()` adds `linear_user_id=not.is.null` (`170-calendar-links-status.js.part:1937-1973`). |
| Create Post automatic assignment | `autoAssigneeForIntake()` uses `intakeAssigneePool()` (`production-write/index.ts:3105-3144`). | **Included when `nativeEpoch` is non-empty** via `nativeIntakePool`; **excluded when provider**, at the explicit `rows.filter(member => clean(member.linear_user_id))` (`index.ts:3116-3120`). Graphics then requires exactly one eligible `default_for_team` row (`index.ts:3123-3129`); video requires an eligible editor (`index.ts:3132-3144`). |
| Production existing-card picker | `_prodEnsureAssigneeOptions()` calls action `assignee_options` (`src/index/210-production-state-writes.js.part:1112-1209`). `handleAssigneeOptions()` resolves the deliverable and calls `existingAssignmentContext()`, then `existingAssignmentOptions()` (`production-write/index.ts:4036-4089`). | **Included for a native assignment epoch.** The complete roster read includes `linear_user_id`, but the native projection explicitly passes `providerMappingRequired:false` (`index.ts:3072-3079`). With no native epoch it falls back to `mappedCreateAssignees()` and the provider policy (`index.ts:3022-3040`). |
| Production create modal | `_prodLoadCreateOptions()` calls `create_options` (`src/index/230-production-create-comments.js.part:46-100`); the server currently calls `mappedCreateAssignees()` without a native epoch (`production-write/index.ts:4022-4033`). | **Policy/flag dependent, not epoch-bound.** A NULL is excluded while `production_assignee_eligibility.provider_mapping_required` is strict, and included only if that retirement flag is exactly false (`policy.mjs:413-452`). This is separate from Create Post and existing-card reassignment. |
| Write gateway, intake override | Intake resolves `nativeEpochByTeam`, then calls `assertEligibleAssignee(..., nativeEpoch)` for every explicit video choice (`production-write/index.ts:7327-7349, 7511-7529`). | **Included when native; excluded when provider.** `assertEligibleAssignee()` reads the roster field, derives the lane policy, and only requires/verifies the provider id on the provider lane (`index.ts:2962-3003`; `policy.mjs:432-452, 524-533`). |
| Write gateway, existing-card assignment | The assignment receipt supplies its epoch; the native branch calls `assertEligibleAssignee(..., epoch)`, otherwise `validateAssignee()` uses provider policy (`production-write/index.ts:6664-6677`). | **Included when the accepted assignment epoch is native; excluded when provider.** Replays preserve the accepted request identity and do not re-decide eligibility (`index.ts:6665-6673`). |

## Complete `linear_user_id` read inventory in the scoped code

- `policy.mjs:408-452,455-470`: canonicalizes the value and applies it only when provider mapping
  is required. NULL is native-eligible, provider-ineligible.
- `policy.mjs:557-562`: native pool invokes the same policy with the requirement off. NULL is not
  excluded. `policy.mjs:579-624` reads it only to count mapped/unmapped readiness; unmapped rows
  remain in the native creative pool.
- `production-write/index.ts:2962-3003`: single-target gateway validation. NULL is excluded only
  when the resolved lane requires provider mapping.
- `index.ts:3022-3040`: provider/retirement-flag projection used by `create_options` and by the
  non-native fallback for assignment options. NULL is excluded in strict provider mode.
- `index.ts:3072-3079`: native existing-assignment projection. NULL is not excluded.
- `index.ts:3105-3120`: automatic intake pool. NULL is not excluded with a native epoch and is
  explicitly filtered without one.
- `index.ts:3835-3865`: Create Post native editor-options read. The field is selected, but the
  native pool does not exclude NULL.
- `index.ts:3576-3577` validates a stored create receipt's `linear_user_id`; this is receipt
  consistency, not roster eligibility. `index.ts:4415-4440` persists the resolved value (NULL on
  native unmapped assignment); neither chooses a candidate.
- Browser source has one direct field read/filter: the provider fallback at
  `src/index/170-calendar-links-status.js.part:1937-1970`. A second search for the bare field and
  for roster SELECTs found no other scoped browser reader.

## Live aggregate check (read-only)

Live project aggregate on 2026-09-21; all rows, grouped only by role:

| role | `linear_user_id` NULL | set | total |
|---|---:|---:|---:|
| admin | 1 | 1 | 2 |
| designer | 0 | 2 | 2 |
| editor | 0 | 10 | 10 |
| smm | 6 | 2 | 8 |

This does not prove the NULL-hire path by example: there is currently no NULL editor/designer row.
It does prove the live roster still carries the legacy field and that other roles already tolerate
NULL. A second aggregate-only read confirmed the native provisioning RPC is installed, both teams
are native-authoritative, both native intake epochs are enabled and non-empty, and all four routing
flags have the required object-plus-client-array shape.

## Brand-new client: native attribution contract

The supported native step already exists: service-role RPC
`production_native_client_provision(text,text,text)`. It atomically creates an active `clients` row
with `kind='client'`, `source='syncview_native'`, two distinct generated native project identities,
a non-rotated review-token row, membership in all four routing flags, and an immutable idempotency
receipt (`migrations/2026-09-09-native-client-provisioning.sql:196-275`). It refuses unless both
native intake epochs are enabled, both teams are SyncView-authoritative, and all four routing flags
are well formed (`:180-194`; `docs/ops/NATIVE_CLIENT_PROVISIONING.md`).

For card creation, `clientBySlug()` needs the canonical slug row and reads `display_name`, `active`,
`kind`, `linear_project_ids`, and `native_project_ids` (`production-write/index.ts:1096-1102`).
Admission requires the row to exist and be active (`index.ts:7289-7312`). On a native epoch,
`projectForIntake()` accepts exactly one valid per-team native project id when no legacy mapping is
present (`index.ts:2804-2840`), and `intakeAttribution()` stamps `state='resolved'`, the canonical
client slug, `source='native_intake_project'`, the native project id, and the accepted epoch
(`index.ts:2685-2754`). The row is written with that stamp before the first commit
(`index.ts:7698-7724`). No Linear project is required for a newly native-provisioned client.

The four per-client flags are `calendar_upsert_ef_clients`, `sample_review_ef_clients`,
`settings_ef_clients`, and `write_ui_reroute_clients`. The provisioner enrolls all four in the same
transaction (`native-client-provisioning.sql:259-268`). They govern the surrounding authenticated
Calendar/Samples/settings and write-UI routes; `production-write` card admission itself is governed
by the canonical client row, `native_intake_epochs`, and `prod_authority`. Treating only the card
create as onboarding proof would therefore miss broken downstream write routing.

## Proposed runbook corrections

1. **New staff:** replace the Linear invitation/manual `linear_user_id` step in
   `NEW_STAFF_ONBOARDING.md` with: create the active exact-role/exact-team roster row; set
   `default_for_team` only under the existing single-default designer rule; leave
   `linear_user_id` NULL; confirm the authenticated Create Post editor-options response (video) or
   the Production assignee-options response for a native TEST deliverable (video/graphics) includes
   the hire, then confirm the native assignment and retry keep one request identity. The code proves
   NULL eligibility. The live roster lacks a NULL creative row, so a throwaway-row acceptance drill
   is still needed before calling that operational procedure live-proven.
2. **New client:** replace manual client insert + Linear project creation + four separate flag edits
   with one reviewed service-role call to `production_native_client_provision`, using a unique
   request id, followed by an identical replay readback. Then perform the existing TEST-safe first
   Create Post journey and verify its persisted attribution is resolved with source
   `native_intake_project`, its native epoch is present, and its first Calendar/Samples/settings
   writes use authenticated routes. The installed code and live boolean preconditions prove this
   route exists; this audit did not execute it or authorize a real-client write.

## Finding

The onboarding docs are stale, but the native implementation is not blocked: both replacement
paths exist. The real remaining gap is acceptance evidence for a NULL-mapped creative. No code fix
is justified by this trace; the runbooks should be corrected and the bounded TEST drill recorded.
