# Supabase — current truth

> Last verified: 2026-07-20 @ c722984 + Phase-3 Order-1 reconciliation (Workload plan-date effective schema/exact-source function live and TEST drill cleaned; exact correction provenance F147; #850 write gateway deployed dark)
> Live facts from `docs/audits/2026-07-05-supabase.md` (verified 2026-07-05) unless noted.

## Tables

See `docs/truth/ENDPOINTS.md` for the access inventory. Highlights:

> **READ-ACCESS BLOCKER (F88; pre-thumbnail-remediation live census 2026-07-14).** Of 37 exposed table paths, 20
> have nonempty rows selectable with the browser publishable key, including cross-client operational
> rows/events, rosters/mappings, reports, filming plans, and thumbnail revision metadata. Client
> tokens gate SPA behavior only; direct PostgREST does not consult them. The owner must explicitly
> accept every exposed field as public (with legal/client review) or replace raw policies with
> principal/client/role-scoped projections. F86 specifically requires minimizing raw staff/client
> tables. B1 proved anonymous writes were denied; it did not prove read confidentiality. This was
> not rerun as a 37-path census after thumbnail remediation, so the historical count remains the
> baseline and systemic F88 stays open.
>
> **Thumbnail v2 remediation verified live; F83 closed 2026-07-14:** the migration revoked raw
> anon/authenticated reads, and a browser-key table request now returns `401`. Unsigned private-object
> access returns `400`; the SPA instead uses a principal/card-scoped Edge reader that returns only
> short-lived signed images. Exact authorized reads pass and cross-client scope returns `403`.
>
> **F88 safe-subset remediation (partly live):**
> `migrations/2026-07-14-f88-safe-sensitive-read-revocations.sql` repeatably revokes anon SELECT
> from `thumbnail_media_revisions`, `social_media_managers`, `smm_weekly_reports`, and
> `filming_plans`. Anonymous reads to the thumbnail and both weekly-report tables now return `401`.
> The gated filming-plan Edge reader is live and denies a missing/wrong key with `401`; its protected
> browser caller is staged here, so the table revoke must wait for the Pages caller to merge. The
> migration deliberately leaves `clients` alone: Production
> still reads it directly through `_prodRestRows('clients', ...)`. The other direct-use tables named
> in F88 likewise remain separate projection work.

- `calendar_posts` — main calendar store (~3.4k rows at last count; ~77% belong to the TEST
  client; most rows archived).
- `sample_reviews` — SXR store (GA but barely adopted by real clients at last count).
  Referenced in code via `SXR_TABLE`.
- `workload_issues` — **read-only mirror** of Linear (4 teams present: VID/GRA/CON/STR;
  56 messy `client_name` variants — normalize via `wlNormalizeClient()`).
- `workload_plan` — **live internal sidecar**, keyed by stable sub-issue id, with normalized
  client scope, nullable `plan_date`, and server-owned update attribution/time. It intentionally has
  no foreign key or added column on the rebuildable `workload_issues` mirror. Live readback shows
  RLS with zero policies, no browser PostgREST privilege, and service-role
  SELECT/INSERT/UPDATE only; DELETE/TRUNCATE/REFERENCES/TRIGGER are explicitly revoked. Exact release
  cleanup left the table empty. F147 tracks which exact SQL correction artifact established those
  effective grants.
- `syncview_runtime_flags` — runtime kill-switches / migration routing. Values have different
  schemas and move during cutover; **never** assume they are all TEST-only. Read them live and
  reconcile with `ROLLBACK.md` plus `docs/independence/GO_LIVE_CHECKLIST.md` before an operation.
  B0's `BEFORE UPDATE` trigger maintains `updated_at`, and the separate `flag_flips` trigger records
  old/new value plus actor/time; read both after every change. Canonical `prod_authority` sides are
  only `linear`/`syncview`. F55 remains open because several backends also accept legacy `supabase`
  while the browser rejects it; do not use that alias. Two additional live flags:
  `write_ui_reroute_clients` (Phase-2 write-UI dark-launch allowlist, TEST-only; missing/unreadable
  reads fail to the LEGACY lane — opposite of the Track-A fail direction) and `pto_v1` (staff PTO
  tracker, live ON since 2026-07-15, owner decision D-36).
- Event ledgers `sample_review_events` (~22k rows) + `calendar_post_events` (~473):
  **100% `source='ui'` to date** — the `linear_in`/`linear_out`/`reconcile` paths have never
  written events; inbound/reconcile bypass the ledger. `deliverable_events` (Track B) must
  not inherit that bypassability.
- Track B tables (`batches`, `deliverables`, `deliverable_events`, `clients`, `team_members`)
  are additive; read by the visible Linear mirror's internal `production` boot.
- `thumbnail_media_revisions` stores private baseline/latest metadata and Storage object paths for
  Calendar/Samples continuous Drive-thumbnail history (with the older graphic-tweak capture as a
  fast path). Browser SELECT is removed by the 2026-07-14 migration;
  the private bucket remains non-public. `thumbnail-revision-read` is the only browser comparison
  projection and binds one authenticated principal to one surface/client/card before signing the
  two image objects for five minutes.

## Write contract (calendar/SXR upsert paths)

- Payload shape `{client, post|sample, comments_base_at}`; `__CLEAR_LINK__` sentinel clears
  a Linear link; a guard gauntlet exists in n8n and is ported to the EFs.
- Candidate source gives all six browser writer EFs one fail-closed policy: exactly one configured
  staff/automation key or active client token scoped to the written client; the server derives
  attribution and ignores caller actor/role claims. `calendar-reorder`, `sample-review-reorder`,
  `templates-save`, and `caption-prompts-save` are live with missing/wrong-key `401` and restored
  TEST allow proof. `calendar-upsert` and `sample-review-upsert` are ⛔ FROZEN OWNER-UN-GATED live
  (2026-07-15 double-outage directive — see the AGENTS.md callout and the ROLLBACK.md F35 row): the
  live functions are intentionally tokenless so existing client review links keep saving. DO NOT
  deploy or re-gate them — not even "atomically after merge" — without the owner's explicit
  approval AND confirmed fresh-link re-issue for every active client. Direct legacy n8n writers
  remain F67.
- The EF ports string-extract 11 symbols from `index.html` **by name** (`grabFunc`) — renaming
  those symbols silently breaks the port. Check `supabase/functions/` before renaming
  anything the write path touches.
- Known dropped field: SXR writes `kasper_finish_log` but the column doesn't exist on
  `sample_reviews` and the EF allow-list omits it (calendar has both). Data is lost silently.
- Thumbnail v2 uses server-owned `thumb_rev` for cross-viewer cache invalidation. The additive
  database triggers mint for enrolled clients on media assignment (including a same-value
  assignment) and when graphics leave `Tweaks Needed`; the two upsert EFs mint before responding.
  They also enroll active Drive thumbnails in continuous watches; a bounded service-role repair RPC
  fills older-path gaps. A confirmed scanner change is rotated in one locked transaction: close the
  Previous/Current pair, bump the exact source row's `thumb_rev`/`updated_at`, and install Current as
  the next pending baseline. That reaches open tabs through their existing realtime row and keeps
  later replacements detectable even when no SyncView write occurs.

## Workload internal plan-date contract (live)

- Linear `due_date` remains display-only in Workload. The new `workload_plan.plan_date` is an
  independent Admin/SMM-owned scheduling value keyed by the exact sub-issue id; clearing it falls
  back to the mirrored due date.
- The browser never calls `workload_plan` through PostgREST. It uses the Admin/SMM-authenticated
  `workload-plan` Edge Function to list, set, or clear an internal plan day; Creative is denied for
  both projection reads and mutations. The server validates an active sub-issue and normalized
  client scope before the service-role write.
- The Workload actual-count contract requires the function to report the number of rows it actually
  wrote, not the number requested, and the browser to require exactly one. A short count, non-OK
  response, or malformed result reverts the optimistic date and notifies the user. Existing Workload
  test comments reuse `F141`, but that register ID belongs to the Samples reorder finding; F148 is the
  open Workload source-guard gap.
- The projection uses stable issue-id keyset pages and rejects partial-list success. Browser reads
  and writes have bounded abort timers; only the newest overlapping refresh may publish state.
  Ordinary read failures retain a last-good snapshot with editing paused, while `401`/`403`
  responses purge the private plan projection instead of leaving revoked data visible.
- This path has no n8n or Linear-write fallback and no runtime flag. The migration, function, and
  browser caller are live. Release proof covered a pre-write `409 issue_not_writable` browser
  revert/notify, Creative `403` on list and set, one actual-row save surviving a fresh list, clear to
  due-date fallback, exact row cleanup, and unchanged runtime flags.

## Edge Functions

Client/staff verifier truth is also not ready for enforcement: F87 records missing request controls,
uniform denials, bounded event retention, and explicit audit-outage behavior. F89 proves
`client_access_events.ok` means access-allowed rather than credential-valid; the current seven-day
window has zero valid-token events and cannot satisfy the spec's active-client validation gate.

PR #850 superseded closed-unmerged #813 without broadening the workflow's push paths:
`linear-outbound` and `production-write` remain absent from the merge/push trigger and deploy only
from a manual `workflow_dispatch` pinned to one exact 40-character SHA already on `main`. Pinned run
`29601466479` used that path at `main@9d76df6`, deploying `linear-outbound` v33 before
`production-write` v24 and passing both source fingerprints. An ordinary merge still deploys
neither function.

Live set in `docs/truth/ENDPOINTS.md`. Source and live inventory now represent 28 functions;
`workload-plan` is ACTIVE v2 with the four-file deployed source closure byte-identical to merge
`fd3e0eaa`. It is intentionally absent from
`supabase/config.toml`, because that shared file is a push trigger for the unrelated thumbnail
deploy workflow; the post-merge operator deploy uses explicit `--no-verify-jwt` instead. The
existing onboarding deploy Action covers 8 push-safe functions plus 2 guarded manual-only
functions and still uses an unpinned latest CLI. The separate pinned `2.109.0`
thumbnail workflow deployed and read back `calendar-upsert` v32, `sample-review-upsert` v33,
`thumbnail-revision-read` v12, and `thumbnail-revision-scan` v17 from the merged release. Seven
functions use floating `supabase-js@2` (six npm aliases plus one `esm.sh` alias), and no function
has a committed lock/import map. Treat every deployment/rebuild/rollback as F51-gated until all 28
source closures, dependencies, JWT settings, toolchain, release SHA, and downloaded server
fingerprints are manifested and independently read back.

The 2026-07-14 containment deployments and anonymous `401` proofs remain independently recorded in
`EXECUTION_LOG.md`. Pinned same-source run `29601466479` later refreshed all three onboarding list
readers to v26, `smm-weekly-reports` to v23, and `filming-plans` to v25 from exact
`main@9d76df6`; their fingerprints passed. The four safe-to-deploy writers above are also live and
deny missing/wrong credentials. Function versions can increment when project secrets restart
functions, so the source commit plus downloaded/server fingerprint—not the version integer
alone—is the release identity.

Thumbnail v2 is controlled by backend flag
`thumbnail_revision_v2={"mode":"off|test|on","clients":[...]}`; the verified live value is
`{"mode":"on","clients":[]}`. `off` fails the protected reader
and scanner closed and prevents v2 server token minting; `test` requires an explicit enrolled client
scope; `on` permits all clients. The scheduled scanner separately requires
`X-Syncview-Scheduler-Signature`, fails closed when its secret is absent, limits each request, and
returns aggregate counts only. Repository variable `THUMBNAIL_REVISION_SCAN_ENABLED` is live as
`true`; first scheduled run `29370658087` completed green with 239 checked and 0 failed.

## Backup and capacity truth

- The live project is on **Pro**, not Free. The 2026-07-13 readback showed seven completed daily
  physical backups spanning the included seven-day retention window; the newest completed that day.
- PITR was **off** at the readback. That matches the approved temporary-window policy, but means PITR
  must be explicitly enabled and read back before each named risky window; it cannot be assumed.
- Database disk utilization was **0.45 GiB used**. The old "approaching a 500 MB Free cap" framing is
  obsolete. Capacity monitoring should use the live Pro disk/usage readbacks.
- **A successful independent restore rehearsal is now documented (2026-07-15, PR #840).** The
  independent Track-B backup/restore package (`docs/ops/TRACK_B_BACKUP.md`) is merged and active: a
  6-hourly HMAC-signed 14-table snapshot to a private Google Shared Drive with independent readback,
  and a proven 229 s dedicated-scratch restore (exact counts, zero core orphans). This satisfies the
  D-1 export/restore gate; native Supabase physical-backup restore-to-new-project entitlement remains
  available as a separate recovery path.
- The Management API does not settle billed egress or the project's spend-cap posture. Before the
  first flip, the owner must answer from **Dashboard -> Usage/Billing**: what is current egress, and
  is the spend cap enabled or disabled?

## Migrations

`migrations/` is additive-only SQL, manually applied, baseline-plus-deltas
(`migrations/README.md`). Log every applied migration in `EXECUTION_LOG.md`.
