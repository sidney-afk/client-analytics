# Endpoint inventory — what `index.html` actually calls

> Last verified: 2026-07-13 @ baseline gateway backend deployed dark; caller/gateway delta staged
> (runtime flags unchanged)

**Machine-enforced:** `test/truth-sync.js` re-derives the n8n-webhook and Edge-Function sets
from `index.html` (`grep -oE 'webhook/[a-zA-Z0-9_-]+'` / `grep -oE 'functions/v1/[a-zA-Z0-9_-]+'`)
and fails if they differ from the sets named in this file. Add/remove an endpoint in code →
update this file in the same commit.

Several operations are **dual-homed** during the Track A migration: an n8n webhook and an
Edge Function port exist for the same operation, selected at runtime by Supabase
`syncview_runtime_flags` (the Calendar/Samples upsert routing is now full-active-roster, while
other flags retain their documented scopes). See `docs/independence/` for the plan.

## n8n webhooks (54)

Calendar:
- `webhook/calendar-get`, `webhook/calendar-upsert-post`, `webhook/calendar-append-post`,
  `webhook/calendar-delete-post`, `webhook/calendar-reorder`, `webhook/calendar-reorder-batch`

Samples (legacy) and sample reviews (SXR):
- `webhook/samples-get`, `webhook/samples-upsert`, `webhook/samples-reorder`
- `webhook/sample-review-get`, `webhook/sample-review-upsert`, `webhook/sample-review-reorder`

Linear bridge:
- `webhook/linear-issues`, `webhook/linear-issue-statuses`,
  `webhook/linear-subissues`, `webhook/linear-tweak-comments`, `webhook/log-linear-submission`
- `webhook/linear-set-status`, `webhook/linear-add-comment` — retained for status/comment writes
  from clients outside the `write_ui_reroute_clients` allowlist

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
  `webhook/sales-intake-submit`
- `webhook/video-form`, `webhook/graphic-form` — retained for Submit writes from clients outside
  the `write_ui_reroute_clients` allowlist

Part 2 removes the SPA caller for legacy `linear-projects`. Status/comment and intake callers now
coexist with `production-write`: only clients in `write_ui_reroute_clients` use the gateway, while
all other clients keep the legacy n8n request shapes. The allowlist is seeded TEST-only so merge is
dark for real clients.

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
- `functions/v1/client-token-verify` — service-role client-link verifier; the browser submits the scoped URL token but never reads the stored token
- `functions/v1/client-review-link` — no-store, copy-time review-link issuer; requires a verified Admin/SMM role key plus the exact active roster identity, then reads one scoped token with the service role. Tokens never transit Clients Info or browser storage
- `functions/v1/client-credentials` — staff credentials surface; accepts admin/SMM role keys while both legacy surface keys remain transition-compatible
- `functions/v1/key-verify` — B0 staff role-key verifier; the sign-in modal pings it at boot to revalidate the stored role key, and sensitive staff EFs share its secret-to-role matcher
- `functions/v1/production-comments` — bounded, no-store Production-thread reader; it verifies the staff role key and active roster identity before service-role reads, so comment bodies are never granted to the browser's anon role
- `functions/v1/production-write` — authenticated native status/comment/due/assignee plus the shared
  Submit/Calendar `intake_create` gateway. Submit and Calendar new-batch requests create a batch;
  Calendar may instead append a paired Video + Graphics item to an active same-client `batch_id`
  with batch CAS. Append validates the existing batch, each team's persisted project mapping, and
  each team's parent route before committing under the batch lock. This adds a calendar doorway,
  not a new Edge Function. Mirror controls fail closed unless the target team is
  SyncView-authoritative; the bounded pre-flip TEST override remains service-authenticated and a
  browser credential cannot self-elevate. Calendar/SXR status/comments and Submit/Calendar intake
  may use only the server-derived targeted parity lane while authority is Linear. Scalar
  writes carry CAS; intake returns stable native IDs. A successful gateway response means the
  ledger/outbox commit completed. Calendar/SXR/Kasper callers first persist and read back the exact
  principal-bound source-repair payload, then await the response before their source-row save. If an
  attempted status/comment loses that authoritative response, the same authenticated caller may send
  the historical payload with `reconcile_only=true`. This is a read-only receipt lookup: it bypasses
  no auth or scope check and invokes no authority lane, parity gate, RPC, drainer, or Linear call.
  HTTP 200 returns `committed_exact` or `absent`; HTTP 409 returns `conflict`. Exact includes the
  current public entity row and, for comments, the canonical body/author/identity plus edit/delete/
  resolve lifecycle. Absent status stays held unless newer native status supersedes it; absent
  append-only comment may reissue through the current lane. Cache/local acknowledgements never prove
  commit and never auto-apply. `reconcile_only` does not support `intake_create`. The
  deployed v11 baseline must be privately snapshotted, then this branch's
  gateway delta deployed and TEST-verified before the caller bundle.
- `functions/v1/filming-plans` — filming plans backend
- `functions/v1/smm-weekly-reports` — SMM weekly reports
- `functions/v1/thumbnail-folder-resolve` — thumbnail Drive-folder resolution

The four calls composed from `ONBOARDING_EDGE_BASE` are `onboarding-list`,
`ai-onboarding-list`, `legacy-onboarding-list`, and `onboarding-full`. The first three are
credential-stripped reads; `onboarding-full` is the unstripped inbox and accepts the admin role
key plus the legacy onboarding-key fallback during transition.

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
- `thumbnail-revision-scan` — scheduled Drive scanner; the browser never calls it.

These are documented separately by design. Do not add them to the literal endpoint set checked by
`test/truth-sync.js` until `index.html` actually calls them.

## Supabase tables (curated — NOT machine-enforced)

Table names are partly built dynamically (`'/rest/v1/' + table`), so this list is maintained
by hand; verify before relying on it.

- String-literal in `index.html`: `syncview_runtime_flags` (kill switches), `calendar_posts`,
  `workload_issues` (read-only Linear mirror), `templates`, `filming_plans`,
  `content_samples`, `caption_prompts`, and `clients` (native Submit registry read).
- Via dynamic refs: `sample_reviews` (through `SXR_TABLE`), and the visible Linear mirror's
  internal `production` boot reads
  `team_members`, `batches`, `deliverables` (plus `deliverable_events`) through a
  table-parameterized helper.
- Event ledgers: `sample_review_events`, `calendar_post_events` — written via backend paths
  *(per `docs/audits/2026-07-05-supabase.md`; UI-source rows only to date)*.
