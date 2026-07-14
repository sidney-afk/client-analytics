# Endpoint inventory — what `index.html` actually calls

> Last verified: 2026-07-14 @ 08e18e6 + live routing/thumbnail readback

**Machine-enforced:** `test/truth-sync.js` re-derives the n8n-webhook and Edge-Function sets
from `index.html` (`grep -oE 'webhook/[a-zA-Z0-9_-]+'` / `grep -oE 'functions/v1/[a-zA-Z0-9_-]+'`)
and fails if they differ from the sets named in this file. Add/remove an endpoint in code →
update this file in the same commit.

Several operations remain **dual-homed** after Track A: an n8n webhook and an Edge Function port
exist for the same operation. The three routing flags contain the full active roster, while unlisted
clients fall to n8n. Flag-read failure and some EF failures also silently select the unauthenticated
n8n writer (F67); this is an open auth/failover defect, not a safe fallback contract. See the audit
register and `ROLLBACK.md` before changing routing.

## n8n webhooks (55)

Calendar:
- `webhook/calendar-get`, `webhook/calendar-upsert-post`, `webhook/calendar-append-post`,
  `webhook/calendar-delete-post`, `webhook/calendar-reorder`, `webhook/calendar-reorder-batch`

Samples (legacy) and sample reviews (SXR):
- `webhook/samples-get`, `webhook/samples-upsert`, `webhook/samples-reorder`
- `webhook/sample-review-get`, `webhook/sample-review-upsert`, `webhook/sample-review-reorder`

Linear bridge:
- `webhook/linear-projects`, `webhook/linear-issues`, `webhook/linear-issue-statuses`,
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
- `webhook/content-ready` — content-ready notification
- `webhook/add-hook-to-library` — hook library capture

## Supabase Edge Functions (16 literal URLs + 4 composed onboarding URLs)

- `functions/v1/calendar-upsert`, `functions/v1/calendar-reorder` — Track A ports of the
  calendar write path
- `functions/v1/sample-review-upsert`, `functions/v1/sample-review-reorder` — SXR write ports
- `functions/v1/templates-save`, `functions/v1/caption-prompts-save` — save-path ports
- `functions/v1/onboarding-capture` — onboarding funnel capture
- `functions/v1/client-token-verify`, `functions/v1/client-credentials` — client auth + staff credentials surface. F89: token telemetry logs access-allowed as `ok`, so permissive tokenless opens are not validation evidence. F84: credentials bulk-delivers plaintext before masking and accepts shared/legacy keys without active-member binding.
- `functions/v1/key-verify` — B0 staff role-key verifier; the sign-in modal pings it at boot to revalidate the stored role key, and sensitive staff EFs share its secret-to-role matcher. F87 requires uniform denials, request controls, bounded audit retention, and explicit audit-outage behavior for both verifiers.
- `functions/v1/production-comments` — bounded, no-store Production-thread reader; it verifies a
  staff role key and active roster selection before service-role reads, but does not enforce the
  requested deliverable's team against that member (F39). Comment bodies are not anon-readable;
  creative cross-team scope remains an open gate.
- `functions/v1/production-write` — authenticated native status/comment/due/assignee gateway for the
  Linear mirror; browser controls fail closed unless the target team is SyncView-authoritative or
  the active TEST client uses the bounded override. The backend has CAS-capable operations, but
  Calendar/Samples callers omit a canonical expected version and the live two-writer drill proved
  last-write-wins (F36). Do not claim end-to-end CAS until every mutation sends the version, stale
  requests create no intent, and 409 compare/reapply UX is proved. Successful accepted operations
  commit through the ledger/outbox RPCs before the UI updates.
- `functions/v1/filming-plans` — filming plans backend
- `functions/v1/smm-weekly-reports` — SMM weekly reports
- `functions/v1/thumbnail-folder-resolve` — thumbnail Drive-folder resolution
- `functions/v1/thumbnail-revision-read` — no-store Calendar/Samples Previous/Current reader. It
  accepts one `{surface, client, source_id}` scope, verifies either a staff role key plus exact
  active roster identity or the exact client review token, confirms the source card belongs to that
  client, and returns only minimal timestamps plus five-minute signed private-snapshot URLs. The SPA
  never receives raw Storage paths, Drive metadata, requester attribution, or internal scan errors.

The four calls composed from `ONBOARDING_EDGE_BASE` are `functions/v1/onboarding-list`,
`functions/v1/ai-onboarding-list`, `functions/v1/legacy-onboarding-list`, and
`functions/v1/onboarding-full`. **F77 P0:** the first three
currently strip dedicated credential fields but remain anonymous service-role readers of real
contact/questionnaire data; field stripping is not an auth boundary. `onboarding-full` is the
unstripped inbox and accepts the admin role key plus the legacy onboarding-key fallback during
transition. **F85:** that key-only check does not bind an active member or audit reads, so retained
shared/legacy secret possession can export the full corpus and credential arrays after member
deactivation. Gate all readers, replace bare discovery, and retire the legacy full-reader fallback.

### Backend-only Edge Functions (not part of the machine-enforced `index.html` set)

- `linear-inbound` — HMAC-verified Linear webhook target; the browser never calls it.
- `linear-outbound` — service-triggered durable-outbox drainer. It is dark by default behind
  `linear_outbound_enabled={"mode":"off"}` and is invoked by scheduled/backend jobs, not the SPA.
  Part 2 adds a separately killed, targeted `legacy_parity` allowance for server-derived
  create/status/comment intents while a team remains Linear-authoritative. It is deployed for
  backend verification but does not enable the global drainer.
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
  `workload_issues` (read-only Linear mirror), `templates`, `filming_plans`,
  `content_samples`, `caption_prompts`.
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
