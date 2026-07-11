# Endpoint inventory — what `index.html` actually calls

> Last verified: 2026-07-11 @ ae8a492

**Machine-enforced:** `test/truth-sync.js` re-derives the n8n-webhook and Edge-Function sets
from `index.html` (`grep -oE 'webhook/[a-zA-Z0-9_-]+'` / `grep -oE 'functions/v1/[a-zA-Z0-9_-]+'`)
and fails if they differ from the sets named in this file. Add/remove an endpoint in code →
update this file in the same commit.

Several operations are **dual-homed** during the Track A migration: an n8n webhook and an
Edge Function port exist for the same operation, selected at runtime by Supabase
`syncview_runtime_flags` (currently TEST-client-only). See `docs/independence/` for the plan.

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

## Supabase Edge Functions (12)

- `functions/v1/calendar-upsert`, `functions/v1/calendar-reorder` — Track A ports of the
  calendar write path
- `functions/v1/sample-review-upsert`, `functions/v1/sample-review-reorder` — SXR write ports
- `functions/v1/templates-save`, `functions/v1/caption-prompts-save` — save-path ports
- `functions/v1/onboarding-capture` — onboarding funnel capture
- `functions/v1/client-token-verify`, `functions/v1/client-credentials` — client auth surface
- `functions/v1/filming-plans` — filming plans backend
- `functions/v1/smm-weekly-reports` — SMM weekly reports
- `functions/v1/thumbnail-folder-resolve` — thumbnail Drive-folder resolution

## Supabase tables (curated — NOT machine-enforced)

Table names are partly built dynamically (`'/rest/v1/' + table`), so this list is maintained
by hand; verify before relying on it.

- String-literal in `index.html`: `syncview_runtime_flags` (kill switches), `calendar_posts`,
  `workload_issues` (read-only Linear mirror), `templates`, `filming_plans`,
  `content_samples`, `caption_prompts`.
- Via dynamic refs: `sample_reviews` (through `SXR_TABLE`), and the Production-tab boot reads
  `clients`, `team_members`, `batches`, `deliverables` (plus `deliverable_events`) through a
  table-parameterized helper.
- Event ledgers: `sample_review_events`, `calendar_post_events` — written via backend paths
  *(per `docs/audits/2026-07-05-supabase.md`; UI-source rows only to date)*.
