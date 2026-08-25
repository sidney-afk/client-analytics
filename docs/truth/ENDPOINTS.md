# Endpoint inventory — what `index.html` actually calls

> Last verified: 2026-08-24 @ c7f088a (Slice 4 live since 2026-07-24; Slice 5 LIVE since the
> 2026-07-26 window: `assignee_options` and the transition policy serve from `production-write`
> v26, now retained in the F27 closure v27 — and the browser's keyset projection reads
> the applied view v2; the §3 TEST drills of `docs/ops/SLICE5_APPLY_WINDOW.md` remain owed)
> (23 literal + 4 composed app callers; 32 source slugs / 29 live — `production-archive` and
> `kasper-ad-performance-read` are deployed and callable from `main`; `hiring-applications` is
> source-only and default-off, with no deployed application capture, reviewer notification, or
> candidate email; `workload-linear` remains undeployed; #850 write gateway remains deployed dark)

**Machine-enforced:** `test/truth-sync.js` re-derives the n8n-webhook and Edge-Function sets
from `index.html` (`grep -oE 'webhook/[a-zA-Z0-9_-]+'` / `grep -oE 'functions/v1/[a-zA-Z0-9_-]+'`)
and fails if they differ from the sets named in this file. Add/remove an endpoint in code →
update this file in the same commit.

Several operations remain **dual-homed** after Track A: an n8n webhook and an Edge Function port
exist for the same operation. The three routing flags contain the full active roster, while unlisted
clients fall to n8n. Flag-read failure and some EF failures also silently select the unauthenticated
n8n writer (F67); this is an open auth/failover defect, not a safe fallback contract. See the audit
register and `ROLLBACK.md` before changing routing.

## n8n webhooks (54)

Calendar:
- `webhook/calendar-get`, `webhook/calendar-upsert-post`, `webhook/calendar-append-post`,
  `webhook/calendar-delete-post`, `webhook/calendar-reorder`, `webhook/calendar-reorder-batch`

Samples (legacy) and sample reviews (SXR):
- `webhook/samples-get`, `webhook/samples-upsert`, `webhook/samples-reorder`
- `webhook/sample-review-get`, `webhook/sample-review-upsert`, `webhook/sample-review-reorder`

Linear bridge:
- `webhook/linear-issues`, `webhook/linear-issue-statuses`, `webhook/linear-projects`,
  `webhook/linear-subissues`, `webhook/linear-set-status`, `webhook/linear-add-comment`,
  `webhook/linear-tweak-comments`, `webhook/log-linear-submission`

`linear-set-status` and `linear-add-comment` have team-direction gates but no incoming caller
authentication (F91). Do not confuse `prod_authority` with principal verification.

AI generation (briefs, captions, summaries):
- `webhook/generate-brief`, `webhook/generate-caption`, `webhook/generate-content-summary`,
  `webhook/generate-general-brief`, `webhook/generate-market-brief`,
  `webhook/generate-tab-summary`
- `webhook/caption-job-status`, `webhook/caption-job-update`, `webhook/caption-prompts-get`,
  `webhook/caption-prompts-save`

TikTok pilot (uploads + TTP auth):
- `webhook/tiktok-upload`, `webhook/tiktok-upload-status`, `webhook/tiktok-upload-cancel`,
  `webhook/tiktok-uploads-list`
- `webhook/tiktok-upload-url`, `webhook/tiktok-upload-direct` — direct-to-storage transport
  (2026-08-18, F-tiktok-cf-cap). Videos over 100 MB skip the in-band `tiktok-upload` webhook
  entirely: the browser calls `tiktok-upload-url` for a one-time Post For Me upload URL, PUTs
  the video straight to Post For Me's storage, then calls `tiktok-upload-direct` with only
  metadata + the resulting media URL. Exists because n8n Cloud sits behind Cloudflare, which
  hard-rejects request bodies over 100 MB before they reach any workflow — the browser saw only
  a generic "could not reach n8n" network error (root-caused 2026-08-18 from three independent
  reports: Laura 113 MB, Analia 122 MB). `tiktok-upload` (≤100 MB) is unchanged and stays the
  fallback. Both new workflows are live in n8n (n8n workflow IDs `FlvoUXIFwRDg8KUb` for
  `tiktok-upload-url`, `qGJ7mUjml98DSiGo` for `tiktok-upload-direct`), verified end-to-end
  2026-08-18 (mint → PUT to storage → create-post call, all confirmed live). No import needed.
  `n8n-backups/tiktok-upload-direct.2026-08-18.json` is kept only as the point-in-time backup
  copy, same convention as the other files in that directory — the live n8n copy is authoritative
  going forward.
- `webhook/ttp-auth-init`, `webhook/ttp-accounts-list`, `webhook/ttp-creator-info`,
  `webhook/ttp-list`, `webhook/ttp-status`, `webhook/ttp-submit`

Onboarding + intake forms:
- `webhook/onboarding-submit`, `webhook/onboarding-fallback`, `webhook/ai-onboarding-submit`,
  `webhook/sales-intake-submit`, `webhook/video-form`, `webhook/graphic-form`

`video-form` and `graphic-form` are active Linear mutation routes and authenticate no caller; the
password-bypassed `?intake=1` page sends no principal (F91). Current containment/auth is required
before the later native reroute/retirement.

`sales-intake-submit` is a separate active privileged paperwork route. Its live webhook also has
no caller authentication (F106). Both send branches respond before the client-email result; the
preview-send branch trusts browser-round-tripped row/contract/link state, and no durable request
idempotency key exists (F107). Treat its response as neither authorization nor completion evidence.

The standard and AI onboarding submit routes acknowledge after the intake-row insert (or direct
duplicate classification), not after onboarding completes. Credential import is a separate
fail-soft branch and provisioning is dispatched after the response without waiting; the duplicate
path reaches neither. Until F110 closes, a 2xx/Thank You screen proves **captured**, not provisioned,
and cannot be used as a new-client readiness receipt. The current operator handoff is the SyncView
standard/AI inbox, not the replaced Notion intake (F111).

Templates:
- `webhook/templates-get`, `webhook/templates-save`

Other:
- `webhook/editors-week` — editor workload panel
- `webhook/kasper-queue` — Kasper review queue
- `webhook/send-urgent-slack` — urgent pings to Slack
- `webhook/weekly-slack-top-reel` — weekly top-reel Slack post
- `webhook/filming-plan-tabs` — filming-plans tab data
- `webhook/add-hook-to-library` — hook library capture

## Supabase Edge Functions (23 literal URLs + 4 composed onboarding URLs)

- `functions/v1/calendar-upsert`, `functions/v1/calendar-reorder` — Track A ports of the
  calendar write path
- `functions/v1/sample-review-upsert`, `functions/v1/sample-review-reorder` — SXR write ports
- `functions/v1/templates-save`, `functions/v1/caption-prompts-save` — save-path ports. Candidate
  source applies the same fail-closed policy to all six writers: exactly one configured staff/
  automation key or active exact-client token, server-derived attribution, and no trust in caller
  actor/role claims. Reorder/settings writers are deployed with missing/wrong-key `401` plus restored
  TEST allow proof. `calendar-upsert` and `sample-review-upsert` are ⛔ FROZEN OWNER-UN-GATED live
  (2026-07-15 double-outage directive — AGENTS.md callout + ROLLBACK.md F35 row): intentionally
  tokenless so existing client links keep saving. DO NOT deploy or re-gate them without explicit
  owner approval AND full fresh-link re-issue. Direct legacy n8n writers remain F67.
- `functions/v1/onboarding-capture` — onboarding funnel capture
- `functions/v1/client-token-verify`, `functions/v1/client-review-link`, `functions/v1/client-credentials` — client auth, staff-only current review-link issuance, and staff credentials surface. F89: token telemetry logs access-allowed as `ok`, so permissive tokenless opens are not validation evidence. F84: credentials bulk-delivers plaintext before masking and accepts shared/legacy keys without active-member binding. **2026-08-04:** `client-review-link` source now provisions a client's missing `client_access.review_token` (INSERT-only for a verified staff principal against an active client; the single guarded UPDATE fires only on a blank token, so a live link is never rotated) and returns `provisioned`. `client_access` rows had only ever come from the one-time B0 seed, so every post-seed client — the first was 2026-07-29 — got `review_token_missing` from the share button. Deliberate-manual deploy: the live version still fails those clients closed until an operator redeploys. Companion layers: `migrations/2026-08-04-client-access-auto-provision.sql` (source-only) and `scripts/provision-client-access.js`.
- `functions/v1/key-verify` — B0 staff role-key verifier; the sign-in modal pings it at boot to revalidate the stored role key, and sensitive staff EFs share its secret-to-role matcher. F87 requires uniform denials, request controls, bounded audit retention, and explicit audit-outage behavior for both verifiers.
- `functions/v1/kasper-ad-performance-read` — admin-only read for the Kasper tab's Ad Performance
  panel (More > Analytics). Reads three tables (service role; none have anon/authenticated grant)
  and returns `rows` (daily campaign-level counts) plus a server-computed `summary` (CPC,
  landing-page-view rate, conversion rate, cost-per-booking with and without cancelled bookings) so
  the browser never re-derives a ratio the backend didn't, `by_ad` (same daily counts broken out by
  `kasper_ad_performance_by_ad_daily.ad_name`), and `leads` (`kasper_ad_leads` rows — real PII, name
  + email; the function logs aggregate counts only, never a row's content). Read-only — it never
  writes any of the three tables. **Deployed to production 2026-08-24, redeployed same day with
  the `by_ad`/`leads` fields** (`--no-verify-jwt`, deliberate-manual, no CI path yet, matching
  `workload-plan`'s first release); anonymous GET verified returning `401` after each deploy. The
  browser caller (`index.html`) for `rows`/`summary` is merged and live via #1127; the panel UI for
  `by_ad`/`leads` (date-range toggle, per-ad table, per-lead list) merged via #1131 and is live —
  Pages run `32782933105` deployed it and a live-HTML fetch confirmed it is actually serving.
- `functions/v1/quiz-leads-list` — admin-only read for the Kasper tab's Quiz Leads panel (More >
  Pipeline & Admin). Reads `quiz_responses` (service role; no anon/authenticated grant) and returns
  every submission from the synchrosocial.com Growth Bottleneck Quiz, newest first. Read-only — it
  never writes the table. `migrations/2026-08-24-quiz-responses.sql` was run by hand 2026-08-24; the
  function was deployed the same day (`--no-verify-jwt`, deliberate-manual, no CI path).
- The public, unauthenticated capture endpoint for the same quiz (Edge Function directory
  `supabase/functions/quiz-capture`) is deliberately **not** listed with a `functions/v1/` path
  here — it is not called by this app (`index.html`) at all; it's called from the separate
  `synchrosocial` repo's `/quiz` page. Listed by name because it writes to this project's Supabase
  (`quiz_responses` + `quiz_intake_log`). Gated by the `quiz_intake_enabled` runtime flag
  (fail-closed) and a durable per-hour rate limit, same posture as `public_intake_log`. Deployed to
  production 2026-08-24 (`--no-verify-jwt`); `quiz_intake_enabled` is still `{"enabled": false}`
  pending an end-to-end test, so the live endpoint currently fails closed.
- `functions/v1/workload-plan` — staff-authenticated Workload sidecar projection/writer. Candidate
  source allows Admin/SMM/Creative to list the same global plan projection while retaining
  Admin/SMM-only per-issue mutations. Creative's plan controls render read-only/disabled and its
  drag handles are absent. The function
  handles only internal
  `plan_date` rows keyed by stable sub-issue id, validates active issue/client scope, and reports
  rows actually written so the browser can require exactly one and revert on a short count. It never
  writes the Linear due date and has no n8n fallback or runtime flag. The function is ACTIVE v2 from
  merge `fd3e0eaa`; that live version still denies Creative list/set until the candidate source is
  manually deployed. Live readback matches the locked table posture represented by
  `2026-07-19-workload-plan.sql`, while F147 tracks the exact revoke-correction artifact provenance.
- `functions/v1/workload-linear` — source-only deliberate-manual Workload metadata/deadline gateway.
  Admin/SMM/Creative may request bounded exact due dates and `2× Workload` / `3× Workload`
  label metadata for active mirrored sub-issues; Admin/SMM alone may update a Linear due date.
  Metadata rejects incomplete alias/label connections, and writes require an exact Linear
  issue/date acknowledgement before a bounded best-effort mirror update. A missed mirror update is
  an explicit successful `mirror_pending` receipt, never a false pre-commit failure. The function
  uses only shared staff/browser-write auth plus `LINEAR_MIRROR_API_KEY`; it has no schema, n8n,
  frozen-writer, plan-sidecar, or runtime-flag fallback. It is not live and has no CI deploy path.
  Release is paired: exact-merge-SHA `workload-plan` must be deployed/read back before
  `workload-linear`, then Creative must prove plan/metadata reads `200` and both functions must prove
  mutation `403`; deploying only `workload-linear` preserves the old role-dependent calendar.
- `functions/v1/production-archive` — deliberate-manual F34 archive-repair reader, **deployed
  2026-07-24** from `1738ad3` (run `30129490033`) with its F34/F53 migration applied the same day.
  It provides bounded staff list/detail pages, repeats active-client and exact Admin/SMM or
  same-team Creative authorization, and exposes only capability-, private-folder-, and byte-readback-
  certified rescue links. Rescue configuration seed, full inventory reconciliation, and retrieval
  drills still require a separate owner-approved window.
- `functions/v1/production-comments` — bounded, no-store canonical-thread reader. The deployed
  version (from `1738ad3`, run `30129490033`, 2026-07-24) **includes the F39 scope closure — the
  cross-team read gap is CLOSED**: it resolves exactly one active compatible
  roster member or one active exact-client token, authorizes the exact target/team/client before
  reading bodies, records durable non-secret allow/deny audit, applies principal/request budgets,
  filters client pages/totals by audience, and uses non-enumerating denials. Client principals must
  also send the verified Samples Review `sxr` card/component identity, revalidated
  against the exact Samples-origin deliverable and component team. The client UI
  defensively projects client audience only and staff Client-visible depends on durable Samples-card
  linkage, not an endpoint assertion. The tokened TEST read drill is still owed before
  client-visible UI widens further.
- `functions/v1/production-write` — authenticated native status/comment/due/assignee gateway for the
  Linear mirror; browser controls fail closed unless the target team is SyncView-authoritative or
  the active TEST client uses the bounded override.
  **One deliberate exception, owner decision 2026-08-24: `intake_create` on the `submission`
  surface accepts a caller with NO credentials.** Clients and videographers submit footage through
  the `?intake=1` link and are not staff; from the 2026-08-14 full-roster enrollment until this
  landed, none of them could submit at all. The opening is bounded on five axes and each one is
  load-bearing: one operation, one surface, a default-OFF runtime flag (`public_intake_enabled`,
  fail-closed on a missing/unreadable/malformed value), a lower item cap than an authenticated
  caller gets, and a per-client plus overall rate limit counted from the service-role-only
  `public_intake_log`. Accepted rows are stamped `created_by = 'public-intake'`, so anything that
  arrives this way is identifiable and reversible in one query. The public principal is minted at
  the intake call site rather than inside `authenticate()`, which is what keeps every other handler
  closed, and a caller who DID present a credential is judged on it and can never fall through to
  this path. The client the submission names is caller-asserted — the owner chose one open link
  over per-client tokens, exactly as the legacy n8n lane it replaces already behaved — and the rate
  limit is what bounds that choice. The backend has CAS-capable operations, but
  Calendar/Samples callers omit a canonical expected version and the live two-writer drill proved
  last-write-wins (F36). Do not claim end-to-end CAS until every mutation sends the version, stale
  requests create no intent, and 409 compare/reapply UX is proved. Successful accepted operations
  commit through the ledger/outbox RPCs before the UI updates.
  Slice 5 (introduced by the 2026-07-26 `production-write` v26 deploy; current F27 closure v27) adds one protected read
  action, `assignee_options`, and changes no operation name. It resolves the target deliverable's own team
  and returns the same eligible-assignee projection the commit enforces (F94), gated by the same
  `assignee` authority as the write, with missing/cross-client/cross-team targets collapsed into one
  `assignee_scope_forbidden`. The same candidate makes `assignee` and `create` reject an ineligible
  or unmirrorable target **before** the native write, using one bounded Linear `users(id, active)`
  read per invocation that fails closed on a truncated pool, and gives the shared `status`/
  `attachment` guard the row's current status and assignee (F136).
  F53/F137 (live-applied and deployed 2026-07-24) adds the authenticated
  no-store typed-asset read and
  guarded Graphics attachment operation. Its paired migration — applied
  2026-07-24 — revokes
  browser table-level SELECT on `batches`/`deliverables`, withholds the three
  typed batch URL columns plus `file_url`, `brief`, and `linear_raw`, and
  exposes only bounded derived, URL-free fields through
  `production_deliverables_browser_v1`; service reads remain unchanged. The
  endpoint
  returns the exact four asset URLs only after active-client and role/team
  authorization. This also closed the historical
  `brief`/`linear_raw` body exposure: anonymous `linear_raw` reads were
  verified live returning `401` (and `production_deliverables_browser_v1`
  `200`); `brief` is covered by the same table-level revoke/withhold.
  PR #850's merged dark cohort extends this same endpoint—without creating another function—with shared
  Submit/Calendar `intake_create`. Calendar provides paired Video/Graphics creation and append to
  an active same-client `batch_id` under batch CAS; Submit still permits Advanced single-team
  intake until F101 closes. It validates persisted project and parent routes before
  the service-only atomic append RPC commits. Its principal-bound source-repair path permits only
  authenticated read-only `reconcile_only` receipt lookup for historical status/comment payloads;
  it bypasses no scope, authority, parity, RPC, drainer, or Linear gate and does not support intake.
  Browser credentials still cannot enter the service-only TEST override. The current F27 closure
  identity was read back from exact `main@968a895108beb2a2c41e86bb8b788115e35b14a0` at the
  2026-08-02 window close: `production-write` v27, with Section 4 run `30763278795` successful and
  the exact-four provider readback 4 PASS / 0 FAIL / 0 ERROR. The 2026-07-26 v26 run,
  2026-07-24 run, and earlier v24 identity remain superseded historical evidence;
  #850's callers are live on Pages only for the allowlisted dark cohort
  (last verified private TEST fixture only). Any real-client enrollment remains owner-gated, and an
  ordinary merge/push still deploys neither write function.
  F43 extends this same gateway with canonical add/reply/edit/delete/resolve/reopen,
  safe attachments, CAS/idempotency receipts, audit, refresh, and ordered existing-`comment`
  outbox debt. F2 `off` or drainer outage pauses applicable debt; it does not retire or discard it.
  Its migration was applied 2026-07-24, the gateway deployed from `1738ad3`, and the F42
  linked-cohort import executed 2026-07-25; the TEST drill remains separately owner-gated.
- `functions/v1/filming-plans` — filming plans backend. Source authenticates every GET before
  constructing the service-role client, accepts verified admin/SMM/creative staff role keys for
  reads, and keeps writes admin-only. The function is live and missing/wrong keys return `401`.
  Current Pages sends the reverified staff key and has no raw PostgREST, realtime-table, or Sheets
  fallback; the F88 raw-table revoke is already live.
- `functions/v1/hiring-applications` — **source-only and default-off.** The private, admin-gated
  Hiring Process panel may list application summaries/detail, update an internal review state, and
  queue a durable interview-invite job only through this function. Capture accepts only complete,
  fresh iClosed snapshots and advances the server-side state version. The proposed migration aborts
  rather than adopt an existing, malformed, or enabled `hiring_invites_enabled` row; its new value
  is false. A future dispatcher must recheck that flag immediately before claim and provider send,
  record a provider receipt before setting `invited`, and turn a stale claim into
  `delivery_uncertain` with no automatic resend. Only an explicit Admin retry of a confirmed
  pre-send failure is allowed. No hiring migration or Edge Function has been deployed, and no iClosed
  capture webhook, Slack/Telegram notification, interview invitation, or candidate email is enabled.
  The browser never calls iClosed, Gmail, n8n, or PostgREST directly.
- `functions/v1/smm-weekly-reports` — staff-gated SMM weekly reports. Anonymous GET and anonymous
  `sync_managers` return `401`; Admin/SMM may submit/read as allowed and manager sync is Admin-only.
  The signed n8n caller reaches the authenticated branch, and current Pages already sends the
  verified staff key for browser calls.
- `functions/v1/pto` — staff-key-authenticated PTO overview/request gateway and server-owned
  accrual engine. **LIVE-ON since 2026-07-15**: `pto_v1={"mode":"on"}` under owner decision D-36
  (the owner explicitly accepted launching on shared role keys; the individually revocable session
  gate in `docs/features/PTO_TRACKER.md` stays a roadmap upgrade, not a launch gate). All private
  PTO tables remain inaccessible through browser PostgREST, approval uses versioned
  snapshot/finalize RPCs, and admin-only decisions, adjustments, and member setup are role-checked
  here. Do NOT "correct" the flag to off based on older docs — off is the behavior kill for a live
  HR tool the team actively uses. Candidate source standardizes the policy day to the IANA zone
  America/Guatemala, minimizes non-admin calendar absences to rendered name/date fields, and adds
  an identity-bound read-only `quote` action for server-owned business-day counts outside the
  overview holiday projection. It also separates approved usage from adjustments in Admin balances,
  exposes future approved leave plus recent terminal history to Admin, serializes request creation
  against start-date setup, and preserves approval attribution when Admin cancels future leave. The
  additive cancellation-audit migration required for dedicated cancellation actor/time fields plus
  the request/setup RPCs and active-roster approval finalizer is source-only until a value-free
  apply/readback receipt confirms its columns, functions, and service-role-only grants.
- `functions/v1/thumbnail-folder-resolve` — thumbnail Drive-folder resolution
- `functions/v1/thumbnail-revision-read` — no-store Calendar/Samples Previous/Current reader. It
  accepts one `{surface, client, source_id}` scope, verifies either a staff role key plus exact
  active roster identity or the exact client review token, confirms the source card belongs to that
  client, and returns only minimal timestamps plus five-minute signed private-snapshot URLs. The SPA
  never receives raw Storage paths, Drive metadata, requester attribution, or internal scan errors.

The four calls composed from `ONBOARDING_EDGE_BASE` are `functions/v1/onboarding-list`,
`functions/v1/ai-onboarding-list`, `functions/v1/legacy-onboarding-list`, and
`functions/v1/onboarding-full`. All four now authenticate before constructing a service-role client;
the first three are live at v26 and missing/wrong keys return `401`. The SPA callers (live on Pages
since the 2026-07-15 #836 merge) obtain the key only after verified Admin sign-in and never
hardcode it. `onboarding-capture` remains public intake but has no stored-data SELECT/read
path. **F77 remains partial:** wildcard CORS and full-list background discovery still need closure.
**F85:** shared/legacy key compatibility does not bind an active member or audit reads, so retained
secret possession can still export the corpus; retire that fallback behind individual sessions.

### Backend-only Edge Functions (not part of the machine-enforced `index.html` set)

- `linear-inbound` — HMAC-verified Linear webhook target; the browser never calls it.
- `linear-outbound` — service-triggered durable-outbox drainer, deployed from pinned `1738ad3`
  (run `30129490033`, 2026-07-24) and invoked
  by scheduled/backend jobs rather than the SPA. Runtime mode must be read fresh before action.
  Part 2 provides a separately killed targeted `legacy_parity` allowance for server-derived
  create/status/comment intents while a team remains Linear-authoritative, plus F07's exact
  `syncview_live` target for successful SyncView-authoritative writes while normal outbound is live.
  Deployment does not itself enable either lane.
- `deliverable-write`, `batch-write` — service-only low-level wrappers over the existing ledger
  RPCs. They are not browser authorization boundaries and must not be exposed to the anon client.
  The Production tab calls `production-write`, never these low-level functions directly.
- `thumbnail-revision-scan` — bounded scheduled Drive scanner; the browser never calls it. It
  requires the dedicated `X-Syncview-Scheduler-Signature`, fails closed if the secret is absent or
  wrong, honors the backend `thumbnail_revision_v2` off/test/on scope, and exposes aggregate counts
  only. `THUMBNAIL_REVISION_SCAN_ENABLED=true` is live; scheduled run `29370658087` completed green
  with 239 checked, 239 unchanged, and 0 failed.

These are documented separately by design. Do not add them to the literal endpoint set checked by
`test/truth-sync.js` until `index.html` actually calls them.

## Supabase tables (curated — NOT machine-enforced)

Table names are partly built dynamically (`'/rest/v1/' + table`), so this list is maintained
by hand; verify before relying on it.

> **F88 live exhaustive correction:** this curated SPA list is not the public-read boundary. A
> count-only check across all 37 OpenAPI table paths found 20 nonempty anon-selectable tables,
> including operational rows/event histories and tables with no SPA reader. Client-token/UI checks
> do not constrain direct PostgREST. The owner must accept every exposed field as public or migrate
> to scoped projections and revoke raw policies. F86 separately blocks raw staff/client inactive
> rows and internal email/Slack/Linear/project mappings.

- String-literal in `index.html`: `syncview_runtime_flags` (kill switches), `calendar_posts`,
  `workload_issues` (read-only Linear mirror), `templates`, `content_samples`, `caption_prompts`.
- Via dynamic refs: `sample_reviews` (through `SXR_TABLE`), and the visible Linear mirror's
  internal `production` boot reads
  `clients`, `team_members`, `batches`, `deliverables` (plus `deliverable_events`) through a
  table-parameterized helper.
- Event ledgers: `sample_review_events`, `calendar_post_events` — written via backend paths
  *(per `docs/audits/2026-07-05-supabase.md`; UI-source rows only to date)*.
- Thumbnail comparison history: the SPA does **not** call PostgREST for
  `thumbnail_media_revisions`. The v2 migration revokes raw browser SELECT and the protected
  `thumbnail-revision-read` function is the sole browser projection. The migration is live: raw
  browser table access returns `401`, unsigned private-object access returns `400`, exact authorized
  reads pass, and cross-client scope returns `403`.
- Filming plans: current Pages calls the live staff-gated `filming-plans` Edge Function and no longer
  calls raw PostgREST, subscribes anonymously to table changes, or falls back to the Sheet. The
  `migrations/2026-07-14-f88-safe-sensitive-read-revocations.sql` table revoke is already live.
  `clients` is deliberately not in that safe-subset migration:
  Production still calls `_prodRestRows('clients', ...)` and needs a scoped projection first.
- PTO HR data: the SPA does **not** call PostgREST for `pto_members`, `pto_requests`, or
  `pto_adjustments`. The live base migration enables RLS with no anon/authenticated policies,
  revokes both browser roles, grants service role only, and exposes only the staff-authenticated
  `pto` projection; go-live readback verified that boundary. The candidate hardening delta reasserts
  the same boundary, adds only service-role RPC execution, and writes no HR rows or flag state, but
  is not yet claimed live.
- Workload plan dates: the SPA does **not** call PostgREST for `workload_plan`; the live
  service-role-only table is reachable only through the staff-authenticated `workload-plan`
  projection/writer. Historical 2026-07-20 release proof confirmed Creative `403` for both list and
  set. Candidate source supersedes only that list policy after manual deployment: Creative may read
  the same global projection but set remains `403`; direct browser-table access remains denied. The
  literal REST-table inventory remains 9.
