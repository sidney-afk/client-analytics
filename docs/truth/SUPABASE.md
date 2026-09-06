# Supabase — current truth

**2026-09-05 scoped source addition, baseline `ab636613`:** the [dormant native label catalog foundation](../ops/NATIVE_LABEL_CATALOG_FOUNDATION.md) adds a service-only immutable version owner and validation RPCs. It is **unapplied**, has no live catalog, always refuses activation/active reads, and changes no current writer/authority/outbox. The new private relation/functions/triggers require explicit schema + data corpus + retained-data restore coverage before installation; current history-v5's 33-table corpus does not cover them. This scoped source note does not refresh the historical live facts below.

> Last verified: 2026-08-24 @ c7f088a + scoped kasper_ad_performance v2 and v3 additions (see
> callouts below) + scoped F27 verification 2026-08-02 @ 968a895 + Slice 5 read path LIVE
> (`migrations/2026-07-25-slice5-production-read-path.sql` applied 2026-07-26 ~23:45Z pinned to
> `f3cf20e`: view v2 single-detoast body + `deliverables_updated_at_idx`, 46 columns / grants /
> `security_barrier` read back; measured 1,273→392 ms per full page; Slice 5 introduced through
> `production-write` v26/run `30226070558` and is now served by F27 closure v27; TEST drills still owed)
> + Slice 4 live (five migrations applied 2026-07-24 ~22:00Z
> pinned to `1738ad3`; `linear-outbound` → `production-write` → `production-comments` →
> `production-archive` deployed from `1738ad3` via run `30129490033`; F42 linked-cohort import
> executed 2026-07-25) + F27 installed and production-verified on 2026-08-02
> (attempt 2 entered from the retained 2026-08-01 Section 7 boundary; migration/self-probe,
> four protected closure readbacks, reserved drill, and packaged final verification all PASS)
> + Phase-3 Order-1 reconciliation + Workload Creative read-only plan
> candidate (plan-date effective schema/grants and v2 live; exact correction provenance F147; #850
> write gateway deployed dark; candidate function source requires manual deployment)
> Live facts from `docs/audits/2026-07-05-supabase.md` (verified 2026-07-05) unless noted.

> **Scoped F27 update:** attempt-2 owner/window receipts on 2026-08-02 establish
> the installed contract, pinned function versions, restored parity, and ACTIVE
> monitor-only reconciler posture described below. They do not refresh unrelated
> Supabase facts retained from the earlier dated evidence.

> **Scoped kasper_ad_performance_daily addition (2026-08-24):**
> `migrations/2026-08-24-kasper-ad-performance.sql` adds one new standalone table (see the Tables
> section below). **Applied to production 2026-08-24** via `supabase db query --linked`; readback
> confirmed all 9 columns and that `service_role` holds exactly SELECT/INSERT/UPDATE with no
> anon/authenticated grant. It changes no existing table, flag, or authority value. This scoped note
> does not refresh unrelated Supabase facts retained from earlier dated evidence.

> **Scoped kasper_ad_performance v2 addition (2026-08-24):**
> `migrations/2026-08-24-kasper-ad-performance-v2.sql` adds two new standalone tables (see the
> Tables section below): `kasper_ad_performance_by_ad_daily` (per-ad breakdown of the existing
> daily metrics) and `kasper_ad_leads` (per-lead HubSpot funnel status — carries real PII, name +
> email). Same locked-down posture as `kasper_ad_performance_daily`. **Applied to production
> 2026-08-24** via `supabase db query --linked`; readback confirmed both tables and that
> `service_role` holds exactly SELECT/INSERT/UPDATE on each with no anon/authenticated grant. It
> changes no existing table, flag, or authority value. This scoped note does not refresh unrelated
> Supabase facts retained from earlier dated evidence.

> **Scoped kasper_ad_performance v3 addition (2026-08-24):**
> `migrations/2026-08-24-kasper-ad-performance-unfinished-leads.sql` adds one new standalone table
> (see the Tables section below): `kasper_ad_unfinished_leads` (people who started the iClosed
> booking flow but never finished — carries real PII, name/email/phone). Same locked-down posture
> as the other `kasper_ad_*` tables. **Applied to production 2026-08-24** via
> `supabase db query --linked`; readback confirmed the table and that `service_role` holds exactly
> SELECT/INSERT/UPDATE with no anon/authenticated grant. It changes no existing table, flag, or
> authority value. This scoped note does not refresh unrelated Supabase facts retained from earlier
> dated evidence.

> **Scoped Hiring Process sidecar (2026-08-25; private capture/review live, invitation delivery
> default-off):**
> `migrations/2026-08-24-hiring-applications.sql` installed a separate private application mirror,
> invite-job outbox, and minimal event ledger. The `hiring_invites_enabled` row is exactly false;
> an existing, malformed, or enabled value would have aborted the migration rather than being
> adopted or overwritten. Both `hiring-applications` and the server-to-server
> `hiring-automation` bridge are deployed. The active n8n capture workflow mirrors only the
> dedicated application event and alerts Kasper; a strict branch in the existing iClosed booked-call
> receiver records only the dedicated interview booking. The invitation dispatcher remains inactive
> and the false flag prevents candidate email. The applied authorization and output-name-qualification
> deltas keep the one-shot receipt and state transitions fail-closed.

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
- `kasper_ad_performance_daily` — **live, applied 2026-08-24.** One row per UTC day of Kasper's
  Meta prospecting campaign (raw spend/impressions/clicks/landing-page-views plus iClosed booking
  counts, both including and excluding cancellations). Same posture as `workload_plan`: RLS enabled,
  zero anon/authenticated policy or grant, service-role SELECT/INSERT/UPDATE only, DELETE/TRUNCATE/
  REFERENCES/TRIGGER revoked even from service role — readback-confirmed live. Only raw counts are
  stored — CPC, conversion rate, and cost-per-booking are computed at read time by
  `kasper-ad-performance-read`, never persisted. Written by the `Kasper Ad Performance — Daily Pull`
  n8n workflow on a 2x/day cron; read only by the admin-gated Edge Function behind the Kasper tab's
  Ad Performance panel (merged and live in `index.html` on `main` via #1127).
- `kasper_ad_performance_by_ad_daily` — **live, applied 2026-08-24.** Same shape as
  `kasper_ad_performance_daily` plus an `ad_name` dimension (PK `(date, ad_name)`), joined to
  iClosed bookings via `utm_content`, matched with a trailing `| COPY N` suffix stripped from
  Meta's `ad_name` (Meta appends this when an ad is split for delivery testing; the booking's UTM
  tag is never updated to match) — same grouping `iclosed_bookings.py` already used locally for its
  own per-ad breakdown. Same locked-down posture. Read by `kasper-ad-performance-read`'s `by_ad`
  field; written by the same n8n workflow's per-ad Meta pull.
- `kasper_ad_leads` — **live, applied 2026-08-24. Carries real PII (lead name + email).** One
  row per iClosed booking for the prospecting campaign, with `iclosed_status` and
  `hubspot_lifecyclestage` synced from the matching HubSpot contact (joined by email) so the
  dashboard can show real funnel outcome — "customer" in `hubspot_lifecyclestage` is the actual
  closed-deal signal, not just "booked". Same locked-down posture as the other two tables. The
  reading Edge Function logs aggregate counts only, never a row's name or email (see
  `test/kasper-ad-performance-auth.js`).
- `kasper_ad_unfinished_leads` — **applied 2026-08-24, n8n writer credential-wired and proven
  2026-08-25. Carries real PII (name/email/phone).** PK `lead_key`. One row per abandoned iClosed
  booking (prospecting campaign, still pending follow-up), mirrored from n8n's own
  `booking_recovery` Data Table rather than a new capture path — that table is fed by the
  pre-existing "Sales — Booking Recovery Capture (iClosed)"/"Dispatch" workflows.
  `email_sent_at`/`sms_sent_at` are set once the recovery email/SMS actually sends. Same
  locked-down posture as the other three `kasper_ad_*` tables. Read by
  `kasper-ad-performance-read`'s `unfinished_leads` field (deployed); written by a new independent
  branch on the `Kasper Ad Performance — Daily Pull` n8n workflow — rebuilt twice same-week, now
  `6OtjILbhkYLY6yVE` (superseding `CdCYzye6Khp6x5A6`, itself superseding `BKl9OFVMb4VS2IHf`),
  published and live on the 2x/day cron. The second rebuild fixed a real filter bug found
  2026-08-25 (`status='pending'` silently excluded already-contacted leads; fixed to exclude only
  on `suppressed_reason`) and is proven via real execution `431479`, whose branch correctly
  re-discovered and corrected 4 real leads that a manual backfill had gotten wrong — see
  `docs/truth/N8N.md` for the full writeup.
- `hiring_applications`, `hiring_invite_jobs`, and `hiring_application_events` — **private live
  schema; capture and booking status mirroring live, candidate email default-off.** The sidecar
  mirrors completed iClosed applications only after the authenticated capture path accepts a full
  verified payload, stores a single durable interview-invite job per applicant, and records minimal
  non-content audit events. Browser roles receive no direct table access. The sidecar deliberately
  does not reuse `sales_intakes`, sales webhooks, or any public browser write path. Capture rejects
  partial/stale source snapshots and increments `state_version` on each accepted fresh snapshot. The
  iClosed contact ID, not email, binds a later dedicated interview booking. A dispatcher must reread
  the default-off flag directly before claim and provider send; only a provider receipt marks an
  application `invited`. A stale dispatch is `delivery_uncertain` with no automatic resend; only a
  verified Admin may explicitly retry a confirmed pre-send failure.
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
- F27 is installed. Attempt 2 on 2026-08-02 entered from the exact retained
  Section 7 boundary left by the real 2026-08-01 failed attempt. The migration
  applied exactly once with transaction/self-probe PASS; immediate verify-after
  preserved all 661 queue rows, left zero probe residue and a zero flag-flip
  delta, and matched post-contract SHA-256
  `7bbfbedc30fb12674d7f581e80efd92c7a82352e2387fd52120f531a5cdb04ff`.
  The installed contract includes the rollback/intent ledgers, per-team
  generation fence and hold, guarded begin/classify/replay/finalize functions,
  and permanent audit. The final production receipt reported 0 open rollbacks,
  0 replay-eligible work, and exactly one retained completed reserved drill.
  The 2026-08-01 Section 7 event remains historical evidence, not current state.
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

- In the current live release, Linear `due_date` remains display-only in Workload. The
  `workload_plan.plan_date` is an
  independent Admin/SMM-owned scheduling value keyed by the exact sub-issue id; clearing it restores
  the item-local automatic day derived from the mirrored deadline.
- The browser never calls `workload_plan` through PostgREST. It uses the staff-authenticated
  `workload-plan` Edge Function. Candidate source allows Admin/SMM/Creative to list the same global
  plan projection, while only Admin/SMM may set or clear an internal plan day. Creative receives no
  enabled browser planning controls or drag handles, and the server validates an active sub-issue and normalized client
  scope before every service-role write. The list widening is not live until this exact function
  source is manually deployed.
- The Workload actual-count contract requires the function to report the number of rows it actually
  wrote, not the number requested, and the browser to require exactly one. A short count, non-OK
  response, or malformed result reverts the optimistic date and notifies the user. Workload guards
  use Workload-specific names; F141 remains reserved for the Samples reorder finding.
- The projection uses stable issue-id keyset pages and rejects partial-list success. Browser reads
  and writes have bounded abort timers; only the newest overlapping refresh may publish state.
  Ordinary read failures retain a last-good snapshot with editing paused, while `401`/`403`
  responses purge the private plan projection instead of leaving revoked data visible.
- This path has no n8n or Linear-write fallback and no runtime flag. The migration, v2 function, and
  browser caller are live; the candidate list widening is not. Historical 2026-07-20 release proof
  covered a pre-write `409 issue_not_writable` browser revert/notify, Creative `403` on list and set,
  one actual-row save surviving a fresh list, clear to due-date fallback, exact row cleanup, and
  unchanged runtime flags.

## Workload Linear metadata/deadline contract (candidate; not live)

- `workload-linear` is an isolated deliberate-manual Edge Function. Admin/SMM/Creative may request
  exact due-date and `2× Workload` / `3× Workload` metadata for at most 100 unique active
  sub-issue ids; only Admin/SMM may call `set_due_date`. It uses the shared browser-write auth
  helper and `LINEAR_MIRROR_API_KEY`, never `production-write`, n8n, a frozen client writer, or a
  runtime flag.
- Metadata is alias-batched 20 ids at a time and reports honest requested/returned/completeness
  counts. Missing GraphQL aliases, errors, malformed/truncated label connections, or an omitted
  due-date field keep `complete=false`; the browser rejects that chunk instead of silently
  downgrading a weighted item to one unit.
- A due write validates the exact active mirrored sub-issue/client before Linear and requires an
  exact returned issue id and due date. Only after that commit does it make a 2.5-second bounded
  update to `workload_issues.due_date`, `linear_updated_at`, and `synced_at`. The selected-row count
  is the actual mirror count. Zero/multiple/timed-out mirror rows return success with
  `mirror_pending=true` because a confirmed Linear commit must not be reversed or reported as a
  failure; the normal mirror reader converges it later.
- No migration or grant change is required. The function is absent from `supabase/config.toml` and
  has no CI deployment path. Deploy only after merge from the exact SHA with `--no-verify-jwt`,
  fingerprint readback, and a private TEST drill.

## Edge Functions

Client/staff verifier truth is also not ready for enforcement: F87 records missing request controls,
uniform denials, bounded event retention, and explicit audit-outage behavior. F89 proves
`client_access_events.ok` means access-allowed rather than credential-valid; the current seven-day
window has zero valid-token events and cannot satisfy the spec's active-client validation gate.

**`client_access` had no writer at all** (found 2026-08-04). Every row in it was created by the
one-time 2026-07-05/06 B0 seed (`scripts/b0-seed-auth-scaffold.js`); nothing has added one since, so
a client whose roster row postdates that seed has no `review_token` and `client-review-link` refuses
their share link with `review_token_missing`. Live count as of 2026-08-04: exactly one such client
(`lukecutting`, roster row 2026-07-29) — every other roster row predates the seed. The candidate fix
provisions at three layers (roster-insert trigger in the source-only
`migrations/2026-08-04-client-access-auto-provision.sql`, on-demand minting in the deliberate-manual
`client-review-link`, and `scripts/provision-client-access.js`), and none of them can rotate: writes
are INSERT / `ON CONFLICT DO NOTHING`, and the single UPDATE is guarded on the stored token being
blank. Rotation stays owner-gated behind full re-issue (F35).

The client-entry review candidate narrows the browser boundary without changing
`auth_enforcement`: requests carrying `strict: true` require a current token and an active client
regardless of permissive mode. `client-token-verify` resolves `client_access` plus its referenced
`clients` row in one joined PostgREST statement, so token/current-active proof is not split across
two snapshots. A successful strict response carries the explicit
`syncview-client-entry-v1` protocol, `strict: true`, `active: true`, exact view/slug, and canonical
display name; strict denials remain non-enumerating. Non-strict callers retain the existing
permissive-window behavior, so this does not claim F87/F89 or global token enforcement closed.
The function has no CI deploy path: deploy/read back the exact reviewed source and pass the
synthetic/TEST strict-protocol matrix before the matching Pages caller is served. The browser rejects
the old response shape, making an inverted rollout fail closed but visibly unavailable.

PR #850 superseded closed-unmerged #813 without broadening the workflow's push paths:
`linear-outbound` and `production-write` remain absent from the merge/push trigger and deploy only
from a manual `workflow_dispatch` pinned to one exact 40-character SHA already on `main`. The
current F27 closure identity was read back at the 2026-08-02 window close from
exact `main@968a895108beb2a2c41e86bb8b788115e35b14a0`. P.3 established
`linear-inbound` v40. Section 4 run `30763278795` dispatched exactly once and
completed successfully; independent provider readback returned 4 PASS / 0 FAIL /
0 ERROR for `linear-outbound` v35, `production-write` v27,
`deliverable-write` v26, and `batch-write` v26, with exact-four aggregate
SHA-256 `33cc19f9f91aea9a288230f1979abd6ee1afbcc14cf905f5a406b9e12258868f`.
The 2026-07-26 v26 production-write run, the 2026-07-24 run, and the earlier
`main@9d76df6` run remain superseded historical evidence. An ordinary
merge/push still deploys neither manually gated function. `calendar-upsert` and
`sample-review-upsert` remained frozen and unchanged throughout the F27 window.

Live set in `docs/truth/ENDPOINTS.md`. Source represents 35 deployable function slugs and the live
inventory is 35 after the 2026-08-25 deployments of `hiring-applications` and
`hiring-automation`; its candidate-email kill switch remains exactly false;
`workload-plan` is ACTIVE v2 with the four-file deployed source closure byte-identical to merge
`fd3e0eaa`; that deployed version still denies Creative list and set. The candidate widens only list
access and requires a deliberate manual deployment after merge. The release is a paired exact-SHA
operation: deploy/read back `workload-plan` first so Creative receives the shared plan snapshot, then
deploy/read back `workload-linear`; deploying only the new gateway leaves Creative on the old
deadline-fallback calendar. Both are intentionally absent from
`supabase/config.toml`, because that shared file is a push trigger for the unrelated thumbnail
deploy workflow; the post-merge operator deploys use explicit `--no-verify-jwt` instead. The
existing onboarding deploy Action covers 8 push-safe functions plus 2 guarded manual-only
functions and still uses an unpinned latest CLI. The separate pinned `2.109.0`
thumbnail workflow deployed and read back `calendar-upsert` v32, `sample-review-upsert` v33,
`thumbnail-revision-read` v12, and `thumbnail-revision-scan` v17 from the merged release. This
F27 P.3 replaced the sole floating F27-target import (`linear-inbound`'s `esm.sh`
alias) with npm package @supabase/supabase-js version `2.49.8` and its function-local
frozen Deno v4 lock/config. The four install closures keep their existing exact `2.49.8` import
surfaces byte-identical—direct in outbound/production-write and through
`supabase/functions/_shared/b4-write.ts` for deliverable-write/batch-write—and do not claim
synthetic locks for historical deployments. The final receipt read inbound v40
back exact and fresh. Six onboarding-family functions
still float on npm `@2` and remain deliberately
untouched because their directories auto-deploy on merge. F51 therefore remains open for broader
fleet release hygiene and records that historical transitive graphs are unrecoverable. The accepted
source-exact rollback standard captures provider source/entrypoint/JWT/release, redeploys it, and
requires an independent deployed-source/JWT hash match; it does not reconstruct that graph.

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

## Production browser projection read cost (measured 2026-07-25)

`production_deliverables_browser_v1` is the only browser-readable projection of `deliverables`;
the underlying table's `linear_raw`, `brief`, `file_url` and legacy `comments` remain revoked. The
view derives 24 of its 45 columns with separate `linear_raw #>> ...` extractions, and **each one
detoasts the row's Linear document again**. Read-only anon probes
(`qa/probes/prod_read_path_timing.js`) over the live 4,612-row mirror:

| shape (1000-row page) | upstream |
|---|---:|
| full 43-column browser projection + `ORDER BY team,status,due_date` | ~1.2–1.5 s |
| same projection + `ORDER BY id` | ~1.2–1.4 s |
| base scalar columns only (no `raw_*`) + same order | ~33–92 ms |
| `id,status` + same order | ~14–24 ms |
| `raw_*`/`identity_repair_*` columns only | ~1.17 s |
| 0 / 1 / 24 `raw_*` columns under the same order | 16 / 224 / 1216 ms |

`ORDER BY` makes every page project the whole relation, so an offset walk of the projection costs
~5.9–6.0 s of upstream time; a sequential primary-key keyset walk costs ~3.4 s. Under the shipped
4-wide page burst each request inflates to 2.1–2.5 s (three bursts observed 2026-07-25, 0/12
failures in that window; the separately reported 15/15 `57014`/HTTP 500 is the same mechanism
crossing the anon statement timeout at higher baseline load). A composite index on
`deliverables(team, status, due_date)` was measured and does **not** help — the planner keeps the
sequential scan because the cost is projection, not ordering.

`migrations/2026-07-25-slice5-production-read-path.sql` (source-only, unapplied) replaces the view
body so each row detoasts once via a guarded `jsonb_to_record` lateral, leaves the Workload label
lateral byte-identical, and adds `deliverables_updated_at_idx` for the F95 delta predicate. Offline
PostgreSQL 16 over 4,626 rows: 951.8 ms → 312.5 ms per page (3.0×), delta window 6.9 ms → 3.2 ms,
with zero-row `EXCEPT ALL` equivalence in both directions across every column including 14
adversarial `linear_raw` shapes, and `create or replace view` preserving grants and
`security_barrier`.

## Migrations

`migrations/` is additive-only SQL, manually applied, baseline-plus-deltas
(`migrations/README.md`). Log every applied migration in `EXECUTION_LOG.md`.
