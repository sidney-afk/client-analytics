# SyncView Atlas

Verified 2026-09-30. Repository evidence is pinned to client-analytics main `3caef657e0a832b265af33d67009ac4649c60112` after incorporating concurrent source changes. Live catalog observations are from the read-only pass; source status was refreshed after the rebase. Live catalogs were read during this pass. Nothing was deployed, dispatched, edited or sent in a live system.

Find a name with your browser's Find command, or use the section links below. Each entry points to its owner. [State of things](STATE_OF_THINGS.md) sets priorities; [Find anything](FIND_ANYTHING.md) routes deeper questions; [Open repairs](ops/OPEN_REPAIRS.md) records unresolved work.

| Find | Open |
| --- | --- |
| Repo boundaries and connections | [Four repos](#four-repos) |
| A tab, form or screen | [Screens](#screens) |
| Stored data and browser access | [Tables and views](#tables-and-views) |
| A backend function | [Edge functions](#edge-functions) |
| An automation or its exit step | [n8n](#n8n) |
| A spreadsheet or tab | [Google Sheets](#google-sheets) |
| A timer or workflow | [Scheduled jobs and GitHub workflows](#scheduled-jobs) |
| An outside service | [Outside services](#outside-services) |
| Where a secret name lives | [Secrets](#secret-names-and-locations) |
| How something deploys | [Deploy lanes](#deploy-lanes-and-owner-action) |
| A broken behavior | [Where do I look when](#where-do-i-look-when) |
| Migration source | [Table creating migrations](#table-creating-migration-inventory) |
| What this check proves | [Keeping this true](#verification-limits-and-keeping-this-map-true) |

## Four repos

Staff and client pages in client-analytics use Supabase and n8n. The Brain holds editorial knowledge; the pipelines read that knowledge and publish review material to Google. The marketing site supplies sales, quiz and onboarding intake to the same backend ecosystem.


| Repo | Owner | Purpose and connection |
| --- | --- | --- |
| client-analytics | [Source map](../REPO_MAP.md) and [Pages publishing](../.github/workflows/pages-site.yml) | SyncView, its Supabase source, operational docs and monitoring. Pages publishes an allowlisted site from main; Edge Functions have separate lanes below. |
| synchro-pipelines | [Pipeline entry](https://github.com/sidney-afk/synchro-pipelines/blob/main/README.md) and [Google bridge](https://github.com/sidney-afk/synchro-pipelines/blob/main/supabase/functions/pipeline-google/index.ts) | Research and concept review tools read a sibling Brain checkout. Local runs publish Sheets and Docs through n8n or pipeline-google; this repo has no GitHub workflow files. |
| synchro-brain | [Knowledge layout](https://github.com/sidney-afk/synchro-brain/blob/main/README.md) and [Change processor](https://github.com/sidney-afk/synchro-brain/blob/main/.github/workflows/process-syncview-change.yml) | Private editorial knowledge. SyncView brain reads files and adds change inputs; the Brain workflow files those changes into facts on main. Its README still contains an older disconnected state description, superseded by this code path. |
| synchrosocial | [Marketing map](https://github.com/sidney-afk/synchrosocial/blob/main/docs/ECOSYSTEM_MAP.md) and [Site deploy](https://github.com/sidney-afk/synchrosocial/blob/main/.github/workflows/deploy.yml) | Marketing and acquisition site. Its build publishes dist to GitHub Pages from main; sales, onboarding and quiz flows feed n8n and Supabase. Its Enterprise Atlas remains the company map. |

Sibling source commits read in this pass: `synchro-pipelines` `9ed2cfa6d7c2ba841c0e0d78d9c252754503b504`; `synchro-brain` `5e77a75fb6abcff9b7d819c28fa39a2b7d16eb0b`; `synchrosocial` `7683ad4b581ff365dcd96f358bbcce6a63f4c7eb`. These are source snapshots, without a live browser or publication proof for the sibling sites.

## Screens

Visibility below comes from page source and role checks. Shared rules live in [staff capabilities](../src/index/100-onboarding-staff-controls.js.part). A visible screen does not itself grant database access. [Clean addresses](../src/index/003-sv-route.html.part) and [the fragment map](../src/index/INDEX.md) own routing and assembly.


| Screen | Who sees it | Fragment and purpose |
| --- | --- | --- |
| Today | Staff; admin and SMM see their relevant work. | [097-today.js.part](../src/index/097-today.js.part). Daily work and review priorities. |
| Analytics overview and client profile | Staff; verified client link sees its own profile. | [040-shared-briefs.js.part](../src/index/040-shared-briefs.js.part). Social metrics, top videos and period comparisons. |
| Brief, market research and content summaries | Staff and scoped client profile. | [050-market-briefs.js.part](../src/index/050-market-briefs.js.part). Existing research and content summary views. |
| Content Calendar and card dialog | Staff and scoped client link. | [134-calendar-prefs-mount.js.part](../src/index/134-calendar-prefs-mount.js.part). Calendar cards and review state. |
| Calendar create, intake and media | Staff; separate public intake entry. | [180-calendar-native-post-media.js.part](../src/index/180-calendar-native-post-media.js.part). Native work creation and video, thumbnail or brief material. |
| Calendar approval, changes and comments | Staff and scoped client link. | [190-calendar-approval-comments.js.part](../src/index/190-calendar-approval-comments.js.part). Native status, canonical threads and client review. |
| Samples and sample card | Staff and scoped client link. | [270-samples-model.js.part](../src/index/270-samples-model.js.part). Sample reviews; old Samples routes redirect here. |
| Sample notes, media and comments | Staff and scoped client link. | [280-samples-cards-notes.js.part](../src/index/280-samples-cards-notes.js.part). Card editing and comment rendering. |
| Sample approval and changes | Staff and scoped client link. | [290-samples-writes-review.js.part](../src/index/290-samples-writes-review.js.part). Saves and review actions. |
| Archived Calendar cards and Samples | Admin and SMM. | [186-archived-restore.js.part](../src/index/186-archived-restore.js.part). Find and restore recently archived cards. |
| Client approval repair queue | Client review links. | [185-client-review-queue.js.part](../src/index/185-client-review-queue.js.part). Shows partly committed approvals while their card catches up. |
| Templates and Brain facts | Staff. | [060-templates-filming.js.part](../src/index/060-templates-filming.js.part). Creative settings and editorial facts. |
| Filming Plans directory | Staff; edits use onboarding capability. | [060-templates-filming.js.part](../src/index/060-templates-filming.js.part). Client filming Doc references. |
| Workload board and week | Staff reads; admin and SMM plan days. | [080-workload-render.js.part](../src/index/080-workload-render.js.part). Native work by creative and day. |
| Workload issue popovers and drag planning | Staff; role checks govern writes. | [090-workload-popovers.js.part](../src/index/090-workload-popovers.js.part). Issue details; 071-workload-planner owns placement. |
| SyncLinear (header button shows the text "Linear"; "SyncLinear" is only its hidden title and ARIA label) | Staff; native authority and role checks govern writes. | [210-production-state-writes.js.part](../src/index/210-production-state-writes.js.part). Native work tree. Route key is production; Submit uses linear. |
| SyncLinear views and attribution | Staff. | [220-production-attribution-views.js.part](../src/index/220-production-attribution-views.js.part). List, board, filters, ownership and parents. |
| SyncLinear create and canonical comments | Staff; client operations stay scoped. | [230-production-create-comments.js.part](../src/index/230-production-create-comments.js.part). Native creation and comment lifecycle. |
| SyncLinear descriptions and images | Staff. | [240-production-description.js.part](../src/index/240-production-description.js.part). Brief editing and image attachments. |
| SyncLinear dates, assignees and labels | Staff; role and team gates apply. | [250-production-controls-data.js.part](../src/index/250-production-controls-data.js.part). Native work controls and read projection. |
| Submit | Admin and SMM; public intake has its own entry. | [200-intake-data-startup.js.part](../src/index/200-intake-data-startup.js.part). Native video and graphic submission. |
| TikTok Upload and queue | Staff. | [300-tiktok-upload.js.part](../src/index/300-tiktok-upload.js.part). Video and carousel upload, scheduling, result and cancel. |
| Instagram side of TikTok Upload | Staff; server allowlist limits posting. | [299-instagram-upload.js.part](../src/index/299-instagram-upload.js.part). Reel upload, cover and scheduling; real posting was not tested here. |
| Kasper Review Session | Admin. | [323-kasper-dashboard-tail.js.part](../src/index/323-kasper-dashboard-tail.js.part). Calendar and Samples approvals and urgent review. |
| Kasper Messages | Admin. | [321-kasper-dashboard-replies.js.part](../src/index/321-kasper-dashboard-replies.js.part). Replies and inbox grouping. |
| Kasper Editors | Admin. | [340-kasper-editors-board.js.part](../src/index/340-kasper-editors-board.js.part). Editor work and labor reporting. |
| Kasper Filming and review history | Admin. | [330-kasper-review-history.js.part](../src/index/330-kasper-review-history.js.part). Doc tabs, batches and past reviews. |
| Kasper Sales Intake and Hiring Process | Admin. | [310-sales-intake-hiring.js.part](../src/index/310-sales-intake-hiring.js.part). Sales and private hiring review. |
| Kasper Onboarding and full form viewer | Admin in Kasper; staff viewer uses onboarding capability. | [100-onboarding-staff-controls.js.part](../src/index/100-onboarding-staff-controls.js.part). Standard, AI and old submissions. |
| Kasper Client Credentials | Admin in Kasper; separate page admits admin and SMM. | [321-kasper-dashboard-replies.js.part](../src/index/321-kasper-dashboard-replies.js.part). Protected credentials and reveal history. |
| Kasper Clients, Save problems, Ad Performance and Quiz Leads | Admin. | [321-kasper-dashboard-replies.js.part](../src/index/321-kasper-dashboard-replies.js.part). Profiles, refusal log, acquisition funnel and quiz intake. |
| Time Off and Kasper Time Off | Staff requests; admin manages. | [110-time-off.js.part](../src/index/110-time-off.js.part). Private leave requests, balances and decisions. |
| Caption prompts and caption generation dialog | Staff edits prompts; generation follows Calendar scope. | [Caption and prompt controls](../src/index/180-calendar-native-post-media.js.part). Native progress and guarded prompt save; legacy fallback reads remain. |
| Standalone onboarding viewer | Staff with onboarding capability. | [Protected full form viewer](../src/index/060-templates-filming.js.part). Full client onboarding shown in a separate browser tab. |
| SMM weekly report form and viewer | Admin and SMM submit; admin manages. | [112-smm-weekly-reports.js.part](../src/index/112-smm-weekly-reports.js.part). Manager updates and report history. |
| Standard and AI onboarding forms | Public form entry. | [100-onboarding-staff-controls.js.part](../src/index/100-onboarding-staff-controls.js.part). Submission, autosave and fallback capture. |
| Sales intake form | Admin Kasper form. | [310-sales-intake-hiring.js.part](../src/index/310-sales-intake-hiring.js.part). Sales agreement inputs. |
| Staff sign in and account menu | Staff entry; verified roles afterward. | [100-onboarding-staff-controls.js.part](../src/index/100-onboarding-staff-controls.js.part). Roster and personal role key verification. |
| Client link boot and update screen | Scoped client review entry. | [260-production-refresh-boot.js.part](../src/index/260-production-refresh-boot.js.part). Strict token validation, startup and stale callers. |
| Quick jump and shared client picker | Staff. | [096-quick-jump.js.part](../src/index/096-quick-jump.js.part). Cross-screen navigation; 095-shared-client owns shared selection. |
| Transcript, media and date dialogs | Audience follows parent screen. | [350-footer.html.part](../src/index/350-footer.html.part). Shared dialog markup; behavior lives in parent fragments and 345-core-tooltip-date-picker. |


All Kasper subtab keys live in [KASPER_SUBTABS](../src/index/320-core-kasper-subtabs.js.part). [SyncThumbnails](../thumbnails/README.md) is a retained standalone mockup absent from the published allowlist. TikTok Pilot is retained hidden source in [the TikTok fragment](../src/index/300-tiktok-upload.js.part).

## Tables and views

The live catalog has **171 application and platform relations** outside system catalogs: 115 in public, four in private application schemas, and 52 owned by Supabase or extensions. The dedupe ledger was re-read after the concurrent analytics repair. Every row below is a catalog observation. Source links identify readers, writers or SQL owners; their presence does not prove that every historical routine is invoked today.

Direct browser access below means SELECT grants and the catalog policy boundary for anon and authenticated. A granted view can expose its projection even when its base tables deny SELECT. RLS without a matching read policy permits no rows. Scoped Edge readers are separate. This pass did not test every REST route or inspect private data rows.


| Public relation | What it holds | Reader and writer code owners | Direct browser access |
| --- | --- | --- | --- |
| `ai_client_onboarding` | Table. AI funnel onboarding submissions. | [ai-onboarding-list](../supabase/functions/ai-onboarding-list/index.ts) / [onboarding-full](../supabase/functions/onboarding-full/index.ts) | No direct browser SELECT grant. |
| `analytics_content_summaries` | Table. Copied client content summaries. | [Scoped reader](../supabase/functions/analytics-read/index.ts); [mirror writer](../supabase/functions/analytics-write/index.ts) uses the shared dataset mapping. | No direct browser SELECT grant. |
| `analytics_ingest_receipts` | Table. Receipts proving which analytics copy is complete. | [analytics-read](../supabase/functions/analytics-read/index.ts) / [analytics-write](../supabase/functions/analytics-write/index.ts) | No direct browser SELECT grant. |
| `analytics_market_research_briefs` | Table. Copied market research briefs. | [Scoped reader](../supabase/functions/analytics-read/index.ts); [mirror writer](../supabase/functions/analytics-write/index.ts) uses the shared dataset mapping. | No direct browser SELECT grant. |
| `analytics_metrics` | Table. Daily social account metrics copied from Sheets. | [Scoped reader](../supabase/functions/analytics-read/index.ts); [mirror writer](../supabase/functions/analytics-write/index.ts) uses the shared dataset mapping. | No direct browser SELECT grant. |
| `analytics_metrics_dedupe_log` | Table. Removed duplicate Metrics rows and repair reasons, retained for rollback. | [Owner-approved SQL repair and rollback reader](../migrations/2026-10-01-analytics-metrics-dedupe-quoted-empty.sql); no browser or ordinary app writer. | No direct browser SELECT grant; RLS is enabled. |
| `analytics_top_videos` | Table. Top video history copied from Sheets. | [Scoped reader](../supabase/functions/analytics-read/index.ts); [mirror writer](../supabase/functions/analytics-write/index.ts) uses the shared dataset mapping. | No direct browser SELECT grant. |
| `batches` | Table. Production batches and parent cards. | [Browser references](../src/index/067-workload-board-source.js.part); [batch-write](../supabase/functions/batch-write/index.ts) / [brain](../supabase/functions/brain/index.ts) / [production-write](../supabase/functions/production-write/index.ts); [SQL readers and writers](../supabase/migrations/20260913183021_provider_issue_observation_recovery_preparation.sql) | No direct browser SELECT grant. |
| `batches_parent_claim_backup_20260824` | Table. Retained parent claim repair backup. | [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `calendar_feedback_materializations` | Table. Recoverable Calendar feedback copied into native comments. | [SQL readers and writers](../migrations/2026-09-05-calendar-feedback-recovery.sql) | No direct browser SELECT grant. |
| `calendar_post_events` | Table. Calendar save history. | [Browser references](../src/index/186-archived-restore.js.part); [calendar-reorder](../supabase/functions/calendar-reorder/index.ts) / [calendar-upsert](../supabase/functions/calendar-upsert/index.ts); [SQL readers and writers](../migrations/2026-09-18-native-calendar-status-bridge.sql) | SELECT to anon, authenticated with RLS: true. |
| `calendar_posts` | Table. Calendar cards, components, approvals and comments. | [Browser references](../src/index/097-today.js.part); [calendar-reorder](../supabase/functions/calendar-reorder/index.ts) / [calendar-upsert](../supabase/functions/calendar-upsert/index.ts) / [production-write](../supabase/functions/production-write/index.ts) and other callers; [SQL readers and writers](../migrations/live-schema-baseline-2026-07-03.sql) | SELECT to anon, authenticated with RLS: true. |
| `caption_jobs` | Table. Caption progress, result, error and cancellation state. | [caption-jobs](../supabase/functions/caption-jobs/index.ts) | No direct browser SELECT grant. |
| `caption_prompts` | Table. Saved caption instructions per client. | [Browser references](../src/index/180-calendar-native-post-media.js.part); [caption-prompts-save](../supabase/functions/caption-prompts-save/index.ts) | SELECT to anon, authenticated with RLS: true. |
| `card_change_journal` | Table. Before and after images for native card changes. | [SQL readers and writers](../migrations/2026-09-26-card-journal-slim.sql) | No direct browser SELECT grant. |
| `card_write_admission_v1` | Table. Admission receipts for atomic card writes. | [SQL readers and writers](../supabase/migrations/20260913183021_provider_issue_observation_recovery_preparation.sql) | No direct browser SELECT grant. |
| `card_write_followups_v1` | Table. Follow-up work owed after a card write. | [SQL readers and writers](../supabase/migrations/20260913062149_retirement_switch_preparation.sql) | No direct browser SELECT grant. |
| `card_write_operations_v1` | Table. Idempotent card operation records. | [SQL readers and writers](../supabase/migrations/20260912174907_card_atomic_admission_preparation.sql) | No direct browser SELECT grant. |
| `card_write_transaction_context_v1` | Table. Transaction context binding card writes and follow-ups. | [SQL readers and writers](../supabase/migrations/20260913183021_provider_issue_observation_recovery_preparation.sql) | No direct browser SELECT grant. |
| `client_access` | Table. Private client review tokens and their active scope. | [analytics-read](../supabase/functions/analytics-read/index.ts) / [client-review-link](../supabase/functions/client-review-link/index.ts) / [client-token-verify](../supabase/functions/client-token-verify/index.ts) and other callers; [SQL readers and writers](../migrations/2026-09-09-native-client-provisioning.sql) | No direct browser SELECT grant. |
| `client_access_events` | Table. Client token access audit. | [client-token-verify](../supabase/functions/client-token-verify/index.ts) | No direct browser SELECT grant. |
| `client_credential_events` | Table. Credential change and reveal audit. | [client-credentials](../supabase/functions/client-credentials/index.ts) | No direct browser SELECT grant. |
| `client_credentials` | Table. Private client platform credentials. | [client-credentials](../supabase/functions/client-credentials/index.ts) | No direct browser SELECT grant. |
| `client_credentials_rev` | Table. Credential revision history. | [Browser references](../src/index/321-kasper-dashboard-replies.js.part); [client-credentials](../supabase/functions/client-credentials/index.ts) | SELECT to anon, authenticated with RLS: true. |
| `client_onboarding` | Table. Standard onboarding submissions. | [onboarding-full](../supabase/functions/onboarding-full/index.ts) / [onboarding-list](../supabase/functions/onboarding-list/index.ts) | No direct browser SELECT grant. |
| `client_profile_edits` | Table. Audit of client profile edits. | [SQL readers and writers](../migrations/2026-09-25-client-profile-edits.sql) | No direct browser SELECT grant. |
| `client_profiles` | Table. Clients Info mirror and source authority. | [Browser references](../src/index/040-shared-briefs.js.part); [analytics-read](../supabase/functions/analytics-read/index.ts) / [analytics-write](../supabase/functions/analytics-write/index.ts) / [client-profile-write](../supabase/functions/client-profile-write/index.ts) and other callers; [SQL readers and writers](../migrations/2026-09-25-client-profile-edits.sql) | No direct browser SELECT grant. |
| `clients` | Table. Canonical client registry and native project mappings. | [Browser references](../src/index/040-shared-briefs.js.part); [analytics-read](../supabase/functions/analytics-read/index.ts) / [brain](../supabase/functions/brain/index.ts) / [client-review-link](../supabase/functions/client-review-link/index.ts) and other callers; [SQL readers and writers](../supabase/migrations/20260912200637_thumbnail_parser_contract_alignment.sql) | SELECT to anon, authenticated with RLS: true. |
| `clients_roster_sync_log` | Table. Roster sync receipts and changes. | [SQL readers and writers](../migrations/2026-09-28-clients-roster-sync.sql) | No direct browser SELECT grant. |
| `content_samples` | Table. Retained legacy Samples records. | [SQL readers and writers](../migrations/samples-supabase-migration.sql) | No direct browser SELECT grant. |
| `deliverable_events` | Table. Native work item changes and monitor heartbeats. | [Browser references](../src/index/186-archived-restore.js.part); [production-write](../supabase/functions/production-write/index.ts); [SQL readers and writers](../supabase/migrations/20260913055621_provider_recorded_create_linkage_recovery_preparation.sql) | SELECT to anon, authenticated with RLS: true; (action IS DISTINCT FROM 'attachment_change'::text); ((event_key IS NULL) OR (action <> ALL (ARRAY['comment_add'::text, 'comment_edit'::text, 'comment_delete'::text, 'comment_resolve'::text, 'comment_unresolve'::text, 'comment_link_linear'::text, 'comment_link_native'::text]))); (action IS DISTINCT FROM 'description_change'::text). |
| `deliverables` | Table. Native production work items, statuses, owners and dates. | [Browser references](../src/index/067-workload-board-source.js.part); [deliverable-write](../supabase/functions/deliverable-write/index.ts) / [notify](../supabase/functions/notify/index.ts) / [production-comments](../supabase/functions/production-comments/index.ts) and other callers; [SQL readers and writers](../supabase/migrations/20260913183021_provider_issue_observation_recovery_preparation.sql) | No direct browser SELECT grant. |
| `description_images` | Table. Images attached to native briefs. | [description-image-upload](../supabase/functions/description-image-upload/index.ts) | No direct browser SELECT grant. |
| `filming_plan_tabs_cache` | Table. Cached Google Doc tab summaries. | [filming-plan-tabs](../supabase/functions/filming-plan-tabs/index.ts) | No direct browser SELECT grant. |
| `filming_plans` | Table. Filming plan Doc references. | [filming-plans](../supabase/functions/filming-plans/index.ts) / [production-write](../supabase/functions/production-write/index.ts); [SQL readers and writers](../migrations/2026-07-09-filming-plans-source.sql) | No direct browser SELECT grant. |
| `flag_flips` | Table. Runtime switch history. | [SQL readers and writers](../migrations/2026-07-05-b0-linear-auth-scaffold.sql) | SELECT to anon, authenticated with RLS: true. |
| `hf_generations` | Table. Team media generation jobs and charges. | [higgsfield-mcp](../supabase/functions/higgsfield-mcp/index.ts); [SQL readers and writers](../migrations/2026-09-28-higgsfield-team-connector.sql) | No direct browser SELECT grant. |
| `hf_team_members` | Table. Team connector identities and personal access tokens. | [higgsfield-mcp](../supabase/functions/higgsfield-mcp/index.ts) | No direct browser SELECT grant. |
| `hiring_application_events` | Table. Application review and delivery history. | [SQL readers and writers](../migrations/2026-09-15-hiring-video-editor-role.sql) | No direct browser SELECT grant. |
| `hiring_applications` | Table. Private job applications and review state. | [hiring-applications](../supabase/functions/hiring-applications/index.ts); [SQL readers and writers](../migrations/2026-09-15-hiring-video-editor-role.sql) | No direct browser SELECT grant. |
| `hiring_invite_jobs` | Table. Durable interview invitation queue. | [SQL readers and writers](../migrations/2026-09-15-hiring-video-editor-role.sql) | No direct browser SELECT grant. |
| `hiring_practical_test_jobs` | Table. Durable practical test email queue. | [SQL readers and writers](../migrations/2026-09-15-hiring-video-editor-role.sql) | No direct browser SELECT grant. |
| `instagram_uploads` | Table. Instagram Reel queue, provider IDs and results. | [instagram-upload](../supabase/functions/instagram-upload/index.ts) | No direct browser SELECT grant. |
| `kasper_ad_campaign_daily` | Table. Campaign totals by day. | [kasper-ad-performance-read](../supabase/functions/kasper-ad-performance-read/index.ts); [SQL readers and writers](../migrations/2026-08-27-kasper-ad-performance-multi-campaign.sql) | No direct browser SELECT grant. |
| `kasper_ad_leads` | Table. Booked acquisition lead and CRM status. | [kasper-ad-performance-read](../supabase/functions/kasper-ad-performance-read/index.ts); [SQL readers and writers](../migrations/2026-08-27-kasper-ad-performance-multi-campaign.sql) | No direct browser SELECT grant. |
| `kasper_ad_performance_by_ad_daily` | Table. Daily ad breakdown. | [kasper-ad-performance-read](../supabase/functions/kasper-ad-performance-read/index.ts); [SQL readers and writers](../migrations/2026-08-27-kasper-ad-performance-multi-campaign.sql) | No direct browser SELECT grant. |
| `kasper_ad_performance_daily` | Table. Daily acquisition funnel totals. | [kasper-ad-performance-read](../supabase/functions/kasper-ad-performance-read/index.ts); [SQL readers and writers](../migrations/2026-08-27-kasper-ad-performance-multi-campaign.sql) | No direct browser SELECT grant. |
| `kasper_ad_unfinished_leads` | Table. Unfinished bookings and follow-up status. | [kasper-ad-performance-read](../supabase/functions/kasper-ad-performance-read/index.ts); [SQL readers and writers](../migrations/2026-08-27-kasper-ad-performance-multi-campaign.sql) | No direct browser SELECT grant. |
| `legacy_intake_native_triage` | Table. Legacy captured intake awaiting native classification. | [production-write](../supabase/functions/production-write/index.ts); [SQL readers and writers](../migrations/2026-09-07-legacy-intake-native-triage.sql) | No direct browser SELECT grant. |
| `legacy_onboarding` | Table. Imported old onboarding forms. | [legacy-onboarding-list](../supabase/functions/legacy-onboarding-list/index.ts) / [onboarding-full](../supabase/functions/onboarding-full/index.ts); [SQL readers and writers](../migrations/legacy-onboarding-migration.sql) | No direct browser SELECT grant. |
| `linear_archive` | Table. Retained raw Linear export. | [production-archive](../supabase/functions/production-archive/index.ts); [SQL readers and writers](../migrations/2026-07-23-f34-f53-production-attachments.sql) | No direct browser SELECT grant. |
| `linear_archive_asset_refs` | Table. Historical attachment references. | [production-archive](../supabase/functions/production-archive/index.ts); [SQL readers and writers](../migrations/2026-07-23-f34-f53-production-attachments.sql) | No direct browser SELECT grant. |
| `linear_archive_asset_rescue_config` | Table. Retained attachment rescue configuration. | [SQL readers and writers](../migrations/2026-07-23-f34-f53-production-attachments.sql) | No direct browser SELECT grant. |
| `linear_deliverable_comment_ids_v1` | View. Compatibility comment identifier projection. | [SQL view](../migrations/2026-08-03-linear-reconciler-bounded-inputs.sql) | No direct browser SELECT grant. |
| `linear_deliverables_reconcile_input_v1` | View. Retained comparison input view. | [SQL readers and writers](../migrations/2026-08-03-linear-reconciler-bounded-inputs.sql) | No direct browser SELECT grant. |
| `linear_intake_receipts` | Table. Legacy intake capture and creation receipts. | [SQL readers and writers](../migrations/2026-09-07-legacy-intake-native-triage.sql) | No direct browser SELECT grant. |
| `linear_outbound_cutoff_control` | Table. Controls sealing the retired outbound lane. | [SQL readers and writers](../migrations/2026-09-06-linear-outbound-cutoff.sql) | No direct browser SELECT grant. |
| `linear_project_ids_shape_migration_20260728` | Table. Project ID migration backup. | [SQL readers and writers](../migrations/2026-07-28-linear-project-ids-team-shape.sql) | No direct browser SELECT grant. |
| `linear_reconcile_projection_status_v1` | View. Retained projection health view. | [SQL view](../migrations/2026-08-03-linear-reconciler-bounded-inputs.sql) | No direct browser SELECT grant. |
| `mirror_outbox` | Table. Historical mirror delivery intents and receipts. | [production-write](../supabase/functions/production-write/index.ts); [SQL readers and writers](../supabase/migrations/20260913183021_provider_issue_observation_recovery_preparation.sql) | No direct browser SELECT grant. |
| `native_brief_media_occurrences` | Table. Preserved brief media and verification receipts. | [SQL definition](../migrations/2026-09-07-native-brief-media.sql) | No direct browser SELECT grant. |
| `onboarding_fallback` | Table. Backup onboarding drafts, submissions and dead letters. | [onboarding-capture](../supabase/functions/onboarding-capture/index.ts) | No direct browser SELECT grant. |
| `production_asset_access_checks` | Table. Recorded checks of archived media access. | [production-write](../supabase/functions/production-write/index.ts) | No direct browser SELECT grant. |
| `production_card_materialization_ingress` | Table. Durable requests to build native cards. | [SQL readers and writers](../migrations/2026-09-06-native-card-materialization-boundary.sql) | No direct browser SELECT grant. |
| `production_card_materialization_receipts` | Table. Native card creation outcomes. | [SQL readers and writers](../migrations/2026-09-06-native-card-materialization-boundary.sql) | No direct browser SELECT grant. |
| `production_card_provenance` | Table. Card origin and source binding. | [SQL readers and writers](../migrations/2026-09-06-native-card-materialization-boundary.sql) | No direct browser SELECT grant. |
| `production_comment_card_links` | Table. Canonical comment to Calendar or Sample bindings. | [SQL readers and writers](../migrations/2026-09-12-native-ordinary-envelope-repair.sql) | No direct browser SELECT grant. |
| `production_comment_import_conflicts` | Table. Comment import conflicts requiring classification. | [SQL definition](../migrations/2026-07-23-production-comment-thread-lifecycle.sql) | No direct browser SELECT grant. |
| `production_comment_mutation_receipts` | Table. Idempotent comment change receipts. | [production-write](../supabase/functions/production-write/index.ts); [SQL readers and writers](../migrations/2026-09-12-native-ordinary-envelope-repair.sql) | No direct browser SELECT grant. |
| `production_comment_read_audit` | Table. Canonical thread read audit. | [production-comments](../supabase/functions/production-comments/index.ts); [SQL readers and writers](../migrations/2026-07-23-production-comment-thread-lifecycle.sql) | No direct browser SELECT grant. |
| `production_comment_read_budget` | Table. Limits and usage for canonical thread reads. | [SQL readers and writers](../migrations/2026-07-23-production-comment-thread-lifecycle.sql) | No direct browser SELECT grant. |
| `production_comments` | Table. Canonical production comments and lifecycle state. | [notify](../supabase/functions/notify/index.ts) / [production-archive](../supabase/functions/production-archive/index.ts) / [production-comments](../supabase/functions/production-comments/index.ts) and other callers; [SQL readers and writers](../supabase/migrations/20260913181213_provider_comment_observation_recovery_preparation.sql) | No direct browser SELECT grant. |
| `production_deliverables_browser_v1` | View. Browser projection of native work items. | [Browser references](../src/index/067-workload-board-source.js.part); [production-write](../supabase/functions/production-write/index.ts); [SQL readers and writers](../migrations/2026-09-19-native-intake-open-load.sql) | SELECT to anon, authenticated; view projection governs rows. |
| `production_intake_manifests` | Table. Validated intake roots and component topology. | [production-write](../supabase/functions/production-write/index.ts); [SQL readers and writers](../migrations/2026-09-07-legacy-intake-native-triage.sql) | No direct browser SELECT grant. |
| `production_label_catalog_versions` | Table. Native label catalog snapshots. | [SQL readers and writers](../migrations/2026-09-18-native-label-retired-state.sql) | No direct browser SELECT grant. |
| `production_native_client_provisions` | Table. Native onboarding provisioning receipts. | [SQL readers and writers](../migrations/2026-09-09-native-client-provisioning.sql) | No direct browser SELECT grant. |
| `production_native_identifier_grants` | Table. Authority to mint native identifiers. | [SQL readers and writers](../migrations/2026-09-07-native-identifier-mint.sql) | No direct browser SELECT grant. |
| `production_native_identifier_mint` | Table. Native identifier counters and assignments. | [SQL readers and writers](../migrations/2026-09-07-native-identifier-mint.sql) | No direct browser SELECT grant. |
| `production_native_ordinary_receipt_admissions` | Table. Ordinary native completion admission receipts. | [SQL readers and writers](../migrations/2026-09-18-native-test-client-parity.sql) | No direct browser SELECT grant. |
| `production_notification_config` | Table. Per-client notification destinations. | [SQL readers and writers](../migrations/2026-09-18-notification-creative-channel.sql) | No direct browser SELECT grant. |
| `production_notification_delivery_receipts` | Table. Provider outcomes for notifications. | [SQL readers and writers](../migrations/2026-09-18-notification-creative-channel.sql) | No direct browser SELECT grant. |
| `production_notification_intents` | Table. Durable native notification queue. | [notify](../supabase/functions/notify/index.ts); [SQL readers and writers](../migrations/2026-09-18-notification-creative-channel.sql) | No direct browser SELECT grant. |
| `production_notification_monitor_v1` | View. Notification debt and health projection. | [SQL view](../migrations/2026-09-09-native-notification-outbox.sql) | No direct browser SELECT grant. |
| `production_notification_reconciliations` | Table. Reconciliation of uncertain notification sends. | [SQL readers and writers](../migrations/2026-09-18-notification-creative-channel.sql) | No direct browser SELECT grant. |
| `pto_adjustments` | Table. Time off balance adjustments. | [pto](../supabase/functions/pto/index.ts); [SQL readers and writers](../migrations/2026-07-15-pto-tracker.sql) | No direct browser SELECT grant. |
| `pto_members` | Table. Private staff time off profiles. | [pto](../supabase/functions/pto/index.ts); [SQL readers and writers](../migrations/2026-07-15-pto-tracker.sql) | No direct browser SELECT grant. |
| `pto_requests` | Table. Time off requests and decisions. | [pto](../supabase/functions/pto/index.ts); [SQL readers and writers](../migrations/2026-07-15-pto-tracker.sql) | No direct browser SELECT grant. |
| `public_intake_log` | Table. Public production submission audit. | [production-write](../supabase/functions/production-write/index.ts) | No direct browser SELECT grant. |
| `quiz_intake_log` | Table. Quiz capture audit. | [quiz-capture](../supabase/functions/quiz-capture/index.ts) | No direct browser SELECT grant. |
| `quiz_responses` | Table. Marketing quiz responses. | [quiz-capture](../supabase/functions/quiz-capture/index.ts) / [quiz-leads-list](../supabase/functions/quiz-leads-list/index.ts) | No direct browser SELECT grant. |
| `rename_propagation_outbox` | Table. Names waiting to propagate between cards and work items. | [SQL readers and writers](../migrations/2026-09-23-rename-propagation.sql) | No direct browser SELECT grant. |
| `rename_propagation_status_v1` | View. Name propagation debt view. | [Browser references](../src/index/125-title-name-rule.js.part) | SELECT to anon, authenticated; view projection governs rows. |
| `sales_intakes` | Table. Sales intake and agreement requests. | [SQL definition](../migrations/sales-intake-migration.sql) | No direct browser SELECT grant. |
| `sample_review_events` | Table. Sample review save history. | [Browser references](../src/index/186-archived-restore.js.part); [sample-review-reorder](../supabase/functions/sample-review-reorder/index.ts) / [sample-review-upsert](../supabase/functions/sample-review-upsert/index.ts); [SQL readers and writers](../migrations/2026-09-10-kasper-urgent-ping-ledger.sql) | SELECT to anon, authenticated with RLS: true. |
| `sample_reviews` | Table. Sample cards, review state and comments. | [Browser references](../src/index/186-archived-restore.js.part); [production-write](../supabase/functions/production-write/index.ts) / [sample-review-reorder](../supabase/functions/sample-review-reorder/index.ts) / [sample-review-upsert](../supabase/functions/sample-review-upsert/index.ts) and other callers; [SQL readers and writers](../migrations/sample-reviews-migration.sql) | SELECT to anon, authenticated with RLS: true. |
| `settings_events` | Table. Template and caption instruction change history. | [caption-prompts-save](../supabase/functions/caption-prompts-save/index.ts) / [templates-save](../supabase/functions/templates-save/index.ts) | No direct browser SELECT grant. |
| `smm_weekly_reports` | Table. Private weekly manager reports. | [smm-weekly-reports](../supabase/functions/smm-weekly-reports/index.ts) | No direct browser SELECT grant. |
| `social_media_managers` | Table. Protected manager directory copied from Sheets. | [smm-weekly-reports](../supabase/functions/smm-weekly-reports/index.ts) | No direct browser SELECT grant. |
| `smm_also_sees` | Table. Staff-only "also sees" grants for Today and My clients (by roster manager or one client); never changes the roster. | [smm-weekly-reports](../supabase/functions/smm-weekly-reports/index.ts) | No browser grant; service role SELECT only. |
| `syncview_auth_events` | Table. Staff authentication audit. | [client-review-link](../supabase/functions/client-review-link/index.ts) / [key-verify](../supabase/functions/key-verify/index.ts) | No direct browser SELECT grant. |
| `syncview_retirement_admission` | Table. Recorded retirement boundary admissions. | [SQL readers and writers](../supabase/migrations/20260913062149_retirement_switch_preparation.sql) | No direct browser SELECT grant. |
| `syncview_runtime_flags` | Table. Runtime switches and routing rosters. | [Browser references](../src/index/040-shared-briefs.js.part); [analytics-read](../supabase/functions/analytics-read/index.ts) / [analytics-write](../supabase/functions/analytics-write/index.ts) / [client-profile-write](../supabase/functions/client-profile-write/index.ts) and other callers; [SQL readers and writers](../supabase/migrations/20260913183021_provider_issue_observation_recovery_preparation.sql) | SELECT to anon, authenticated with RLS: true. |
| `team_members` | Table. Canonical staff roster, roles and provider mappings. | [Browser references](../src/index/097-today.js.part); [client-profile-write](../supabase/functions/client-profile-write/index.ts) / [description-image-upload](../supabase/functions/description-image-upload/index.ts) / [key-verify](../supabase/functions/key-verify/index.ts) and other callers; [SQL readers and writers](../migrations/2026-09-24-workload-native-snapshot-board-builder.VERIFY.sql) | No direct browser SELECT grant. |
| `templates` | Table. Client creative template settings. | [Browser references](../src/index/040-shared-briefs.js.part); [templates-save](../supabase/functions/templates-save/index.ts) | SELECT to anon, authenticated with RLS: true. |
| `thumbnail_media_revisions` | Table. Private thumbnail revision metadata. | [thumbnail-revision-read](../supabase/functions/thumbnail-revision-read/index.ts); [SQL readers and writers](../supabase/migrations/20260912184931_card_followup_outcome_proof.sql) | No direct browser SELECT grant. |
| `tiktok_accounts` | Table. Retained TikTok Pilot account connections. | [SQL definition](../migrations/ttpilot-schema-migration.sql) | No direct browser SELECT grant. |
| `tiktok_oauth_state` | Table. Retained TikTok Pilot OAuth handshake state. | [SQL definition](../migrations/ttpilot-schema-migration.sql) | No direct browser SELECT grant. |
| `tiktok_pilot_posts` | Table. Retained TikTok Pilot upload queue. | [SQL definition](../migrations/ttpilot-schema-migration.sql) | No direct browser SELECT grant. |
| `track_b_f27_team_fences` | Table. Team write fences for guarded recovery. | [SQL readers and writers](../supabase/migrations/20260912193957_provider_closed_snapshot_preparation.sql) | No direct browser SELECT grant. |
| `track_b_team_rollback_intents` | Table. Captured intents awaiting classified rollback. | [SQL readers and writers](../supabase/migrations/20260913183021_provider_issue_observation_recovery_preparation.sql) | No direct browser SELECT grant. |
| `track_b_team_rollbacks` | Table. Team rollback sessions and proof state. | [SQL readers and writers](../supabase/migrations/20260913183021_provider_issue_observation_recovery_preparation.sql) | No direct browser SELECT grant. |
| `workload_issues` | Table. Frozen legacy Linear issue snapshot. | [Browser references](../src/index/067-workload-board-source.js.part); [workload-plan](../supabase/functions/workload-plan/index.ts); [SQL readers and writers](../migrations/2026-09-24-workload-native-snapshot-board-builder.VERIFY.sql) | SELECT to anon, authenticated with RLS: true. |
| `workload_issues_native_v1` | View. Native Workload issue projection. | [Browser references](../src/index/067-workload-board-source.js.part); [SQL readers and writers](../migrations/2026-09-24-workload-native-snapshot-board-builder.VERIFY.sql) | SELECT to anon, authenticated; view projection governs rows. |
| `workload_plan` | Table. Staff internal work day pins. | [workload-plan](../supabase/functions/workload-plan/index.ts); [SQL readers and writers](../migrations/2026-09-24-workload-native-snapshot-board-builder.VERIFY.sql) | No direct browser SELECT grant. |
| `workload_snapshot_cache` | Table. Prebuilt native Workload snapshots. | [SQL readers and writers](../migrations/2026-09-24-workload-native-snapshot-board-builder.sql) | No direct browser SELECT grant. |
| `workload_snapshot_invalidation` | Table. Marks native Workload snapshots dirty. | [SQL readers and writers](../migrations/2026-09-24-workload-native-snapshot-board-builder.sql) | No direct browser SELECT grant. |


### Private application schemas


| Relation | Purpose and owner | Direct browser access |
| --- | --- | --- |
| `linear_exit_install.journal_v1` | Installation transaction journal. [SQL definition](../supabase/migrations/20260912203454_installation_transaction_journal_preparation.sql) | No direct browser SELECT grant. |
| `linear_exit_maintenance.gate_v1` | Maintenance admission gate. [SQL definition](../supabase/migrations/20260913035202_installation_maintenance_gate_preparation.sql) | No direct browser SELECT grant. |
| `linear_exit_provider.send_attempts_v1` | Retained provider send attempt receipts. [SQL definition](../supabase/migrations/20260913034324_provider_send_admission_preparation.sql) | No direct browser SELECT grant. |
| `write_refusal_diagnostics.receipts_v1` | Private save refusal receipts read by Save problems. [SQL definition](../supabase/migrations/20260913044451_write_refusal_diagnostics_preparation.sql) | No direct browser SELECT grant. |


### Supabase and extension owned relations

These are backend platform stores. Service access depends on platform roles; browsers normally use the service API. No auth, Storage object or decrypted Vault value was read; the Vault name-only query returned no rows.


| Relation | Platform owner and data | Direct browser access |
| --- | --- | --- |
| `auth.audit_log_entries` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.custom_oauth_providers` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.flow_state` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.identities` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.instances` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.mfa_amr_claims` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.mfa_challenges` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.mfa_factors` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.mfa_recovery_code_sets` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.mfa_recovery_codes` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.oauth_authorizations` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.oauth_client_states` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.oauth_clients` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.oauth_consents` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.one_time_tokens` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.refresh_tokens` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.saml_providers` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.saml_relay_states` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.schema_migrations` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.scim_tokens` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.scim_users` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.sessions` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.sso_domains` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.sso_providers` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.users` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.webauthn_challenges` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `auth.webauthn_credentials` | Auth account, session or sign-in state; Auth service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `cron.job` | Scheduler definitions or execution history; pg_cron owns it. [Catalog context](truth/SUPABASE.md) | SELECT to anon, authenticated with RLS: (username = CURRENT_USER). |
| `cron.job_run_details` | Scheduler definitions or execution history; pg_cron owns it. [Catalog context](truth/SUPABASE.md) | SELECT to anon, authenticated with RLS: (username = CURRENT_USER). |
| `extensions.pg_stat_statements` | Extension statistics or statement information; installed extension owns it. [Catalog context](truth/SUPABASE.md) | SELECT to anon, authenticated; view projection governs rows. |
| `extensions.pg_stat_statements_info` | Extension statistics or statement information; installed extension owns it. [Catalog context](truth/SUPABASE.md) | SELECT to anon, authenticated; view projection governs rows. |
| `realtime.messages` | Routing or subscription state; Realtime service owns it. [Catalog context](truth/SUPABASE.md) | SELECT granted to anon, authenticated; RLS has no browser read policy. |
| `realtime.messages_2026_09_28` | Routing or subscription state; Realtime service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `realtime.messages_2026_09_29` | Routing or subscription state; Realtime service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `realtime.messages_2026_09_30` | Routing or subscription state; Realtime service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `realtime.messages_2026_10_01` | Routing or subscription state; Realtime service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `realtime.messages_2026_10_02` | Routing or subscription state; Realtime service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `realtime.messages_2026_10_03` | Routing or subscription state; Realtime service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `realtime.messages_2026_10_04` | Routing or subscription state; Realtime service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `realtime.schema_migrations` | Routing or subscription state; Realtime service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `realtime.subscription` | Routing or subscription state; Realtime service owns it. [Catalog context](truth/SUPABASE.md) | SELECT to anon, authenticated; RLS is off. |
| `storage.buckets` | Object or bucket metadata; Storage service owns it. [Catalog context](truth/SUPABASE.md) | SELECT granted to anon, authenticated; RLS has no browser read policy. |
| `storage.buckets_analytics` | Object or bucket metadata; Storage service owns it. [Catalog context](truth/SUPABASE.md) | SELECT granted to anon, authenticated; RLS has no browser read policy. |
| `storage.buckets_vectors` | Object or bucket metadata; Storage service owns it. [Catalog context](truth/SUPABASE.md) | SELECT granted to anon, authenticated; RLS has no browser read policy. |
| `storage.migrations` | Object or bucket metadata; Storage service owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `storage.objects` | Object or bucket metadata; Storage service owns it. [Catalog context](truth/SUPABASE.md) | SELECT granted to anon, authenticated; RLS has no browser read policy. |
| `storage.s3_multipart_uploads` | Object or bucket metadata; Storage service owns it. [Catalog context](truth/SUPABASE.md) | SELECT granted to anon, authenticated; RLS has no browser read policy. |
| `storage.s3_multipart_uploads_parts` | Object or bucket metadata; Storage service owns it. [Catalog context](truth/SUPABASE.md) | SELECT granted to anon, authenticated; RLS has no browser read policy. |
| `storage.vector_indexes` | Object or bucket metadata; Storage service owns it. [Catalog context](truth/SUPABASE.md) | SELECT granted to anon, authenticated; RLS has no browser read policy. |
| `supabase_migrations.schema_migrations` | Applied migration history; migration tooling owns it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `vault.decrypted_secrets` | Encrypted secret store or decrypted view; privileged Vault callers own it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |
| `vault.secrets` | Encrypted secret store or decrypted view; privileged Vault callers own it. [Catalog context](truth/SUPABASE.md) | No direct browser SELECT grant. |


## Edge functions

There are 46 entrypoint folders and one shared helper folder here. The live project has **47 functions**, all with platform JWT verification false. That setting does not remove function authentication. Presence and version below are verified; live byte equality to this checkout was not attested. [The deploy manifest](ops/EF_DEPLOY_MANIFEST.md) owns release paths and source closures.


| Function | Purpose and caller | Live presence and release lane |
| --- | --- | --- |
| <!-- atlas:edge _shared -->[`_shared`](../supabase/functions/_shared/) | Shared auth, write, media and policy helpers; not an endpoint. | Bundled with its caller; never deployed alone. |
| <!-- atlas:edge ai-onboarding-list -->[`ai-onboarding-list`](../supabase/functions/ai-onboarding-list/index.ts) | Staff reads AI onboarding submissions. | Live v59. [deploy-onboarding-edge-functions.yml](../.github/workflows/deploy-onboarding-edge-functions.yml) |
| <!-- atlas:edge analytics-market-research-collect -->[`analytics-market-research-collect`](../supabase/functions/analytics-market-research-collect/index.ts) | Our own run of the Market Research brief job (n8n MARKET RESEARCH, generate-market-brief), in shadow beside n8n; request-driven, timer-called, key-protected. | Not deployed yet (built 2026-10-02, OPEN_REPAIRS 335). [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge analytics-metrics-collect -->[`analytics-metrics-collect`](../supabase/functions/analytics-metrics-collect/index.ts) | Our own run of the daily metrics job (n8n CLIENTS METRICS), in shadow beside n8n; timer-called, key-protected. | Not deployed yet (built 2026-10-01, OPEN_REPAIRS 322). [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge analytics-top-videos-collect -->[`analytics-top-videos-collect`](../supabase/functions/analytics-top-videos-collect/index.ts) | Our own run of the daily Top Videos job (n8n TOP VIDEOS), in shadow beside n8n; timer-called, key-protected. | Not deployed yet (built 2026-10-02, OPEN_REPAIRS 327). [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge analytics-read -->[`analytics-read`](../supabase/functions/analytics-read/index.ts) | Staff or verified client links read scoped analytics and profiles. | Live v12. [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge analytics-write -->[`analytics-write`](../supabase/functions/analytics-write/index.ts) | The daily copy and n8n mirror key write analytics with receipts. | Live v9. [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge batch-write -->[`batch-write`](../supabase/functions/batch-write/index.ts) | Service callers write native batch fields. | Live v58. [deploy-f27-section4-closures.yml](../.github/workflows/deploy-f27-section4-closures.yml) |
| <!-- atlas:edge brain -->[`brain`](../supabase/functions/brain/index.ts) | Staff reads the private Brain and submits changes to its input folder. | Live v11. [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge calendar-reorder -->[`calendar-reorder`](../supabase/functions/calendar-reorder/index.ts) | Calendar staff calls reorder existing cards. | Live v58. No CI deploy path; reviewed operator release only. |
| <!-- atlas:edge calendar-upsert -->[`calendar-upsert`](../supabase/functions/calendar-upsert/index.ts) | Staff and client links save Calendar cards. Frozen live writer. | Live v70. Frozen by [owner rule](../AGENTS.md). No redeploy or re-gating without the owner. |
| <!-- atlas:edge caption-generate -->[`caption-generate`](../supabase/functions/caption-generate/index.ts) | Generate caption off n8n: Frame.io, Whisper, Claude with the client prompt, Brain voice and fixed writing rules, or a pasted transcript; progress in caption-jobs. Used only for clients in `caption_generate_ef_clients`. | Not deployed yet (OPEN_REPAIRS 388). [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge caption-jobs -->[`caption-jobs`](../supabase/functions/caption-jobs/index.ts) | Calendar and Generate Caption read progress and request cancellation or updates. | Live v4. [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge caption-prompts-save -->[`caption-prompts-save`](../supabase/functions/caption-prompts-save/index.ts) | Staff saves per-client caption instructions. | Live v56. No CI deploy path; reviewed operator release only. |
| <!-- atlas:edge client-credentials -->[`client-credentials`](../supabase/functions/client-credentials/index.ts) | Admin and SMM manage protected platform credentials. | Live v67. [deploy-onboarding-edge-functions.yml](../.github/workflows/deploy-onboarding-edge-functions.yml) |
| <!-- atlas:edge client-onboarding -->[`client-onboarding`](../supabase/functions/client-onboarding/index.ts) | Admin reads and changes one client's onboarding checklist and resources (presence and ids only, never tokens or credentials). | Source only, not deployed; needs `migrations/2026-10-03-onboarding-checklist-tables.sql`. [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge client-profile-write -->[`client-profile-write`](../supabase/functions/client-profile-write/index.ts) | Admin edits profiles and the authoritative Clients Info Sheet. | Live v7. [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge client-review-link -->[`client-review-link`](../supabase/functions/client-review-link/index.ts) | Admin and SMM issue a scoped client review link. | Live v29. [deploy-client-review-link.yml](../.github/workflows/deploy-client-review-link.yml) |
| <!-- atlas:edge client-token-verify -->[`client-token-verify`](../supabase/functions/client-token-verify/index.ts) | Client entry verifies its current review token in strict mode. | Live v54. No CI deploy path; reviewed operator release only. |
| <!-- atlas:edge deliverable-write -->[`deliverable-write`](../supabase/functions/deliverable-write/index.ts) | Service callers write native work item fields. | Live v58. [deploy-f27-section4-closures.yml](../.github/workflows/deploy-f27-section4-closures.yml) |
| <!-- atlas:edge description-image-upload -->[`description-image-upload`](../supabase/functions/description-image-upload/index.ts) | Staff uploads brief images into private Storage. | Live v25. [deploy-description-image-upload.yml](../.github/workflows/deploy-description-image-upload.yml) |
| <!-- atlas:edge filming-plan-tabs -->[`filming-plan-tabs`](../supabase/functions/filming-plan-tabs/index.ts) | Staff reads and caches Google Doc tabs, with per-Doc n8n fallback. | Live v4. [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge filming-plans -->[`filming-plans`](../supabase/functions/filming-plans/index.ts) | Staff reads and updates filming plan Doc references. | Live v56. [deploy-onboarding-edge-functions.yml](../.github/workflows/deploy-onboarding-edge-functions.yml) |
| <!-- atlas:edge higgsfield-mcp -->[`higgsfield-mcp`](../supabase/functions/higgsfield-mcp/index.ts) | Team chat apps generate images and video through personal connector identities. | Live v26. [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge hiring-applications -->[`hiring-applications`](../supabase/functions/hiring-applications/index.ts) | Admin reviews job applications and queues candidate mail. | Live v27. [deploy-hiring-applications.yml](../.github/workflows/deploy-hiring-applications.yml) |
| <!-- atlas:edge hiring-automation -->[`hiring-automation`](../supabase/functions/hiring-automation/index.ts) | n8n captures hiring events and claims or receipts candidate sends. | Live v25. [deploy-hiring-automation.yml](../.github/workflows/deploy-hiring-automation.yml) |
| <!-- atlas:edge instagram-upload -->[`instagram-upload`](../supabase/functions/instagram-upload/index.ts) | Staff submits, lists, schedules, cancels and checks Instagram Reels through Post For Me. | Live v3. [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge tiktok-upload -->[`tiktok-upload`](../supabase/functions/tiktok-upload/index.ts) | Staff mints the Post For Me upload URL, creates, lists, checks and retries TikTok posts; the queue is `tiktok_uploads` (OPEN_REPAIRS 362). Replaces the n8n TikTok Upload URL, Submit, Submit (Direct), List and Status webhooks once `tiktok_upload_source` reads supabase. Admin-only one-time copy of the TikTokUpload Sheet tab. Receives Post For Me's result webhook (`?pfm_webhook=1`, its own secret, no staff key) and asks about every overdue open row (OPEN_REPAIRS 370). | [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge tiktok-upload-cancel -->[`tiktok-upload-cancel`](../supabase/functions/tiktok-upload-cancel/index.ts) | Staff cancels a scheduled TikTok upload: deletes the post in Post For Me, proves it is gone, then marks the queue row cancelled (the `tiktok_uploads` table first, the TikTokUpload Sheet tab only for a row the table does not have). | [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge thumbnail-titles -->[`thumbnail-titles`](../supabase/functions/thumbnail-titles/index.ts) | Background step (pg_cron timer only): writes a short AI title from the filming plan into each new empty thumbnail work item made from the Submit tab or a Calendar post, or a "Needs info" line; never over text a person wrote. Switch `thumbnail_titles`, default off. | [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge thumbnail-title-prompts -->[`thumbnail-title-prompts`](../supabase/functions/thumbnail-title-prompts/index.ts) | Staff read and save a client's thumbnail title prompt from the Calendar "..." menu (the twin of caption-prompts-save). | [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge kasper-ad-performance-read -->[`kasper-ad-performance-read`](../supabase/functions/kasper-ad-performance-read/index.ts) | Admin reads acquisition metrics and private lead status. | Live v29. No CI deploy path; reviewed operator release only. |
| <!-- atlas:edge key-verify -->[`key-verify`](../supabase/functions/key-verify/index.ts) | Staff entry verifies a roster identity and role key. | Live v61. [deploy-onboarding-edge-functions.yml](../.github/workflows/deploy-onboarding-edge-functions.yml) |
| <!-- atlas:edge legacy-onboarding-list -->[`legacy-onboarding-list`](../supabase/functions/legacy-onboarding-list/index.ts) | Staff reads imported old onboarding forms. | Live v59. [deploy-onboarding-edge-functions.yml](../.github/workflows/deploy-onboarding-edge-functions.yml) |
| <!-- atlas:edge linear-inbound -->[`linear-inbound`](../supabase/functions/linear-inbound/index.ts) | Retired provider webhook source retained for contract tests. | Absent from live list. Retained source; absent live. Never restore as ordinary maintenance. |
| <!-- atlas:edge linear-outbound -->[`linear-outbound`](../supabase/functions/linear-outbound/index.ts) | Retired provider delivery source retained for contract tests. | Absent from live list. Retained source; absent live. Never restore as ordinary maintenance. |
| <!-- atlas:edge notify -->[`notify`](../supabase/functions/notify/index.ts) | Staff and the notification sender deliver ordinary urgent or queued Slack messages. | Live v25. [deploy-onboarding-edge-functions.yml](../.github/workflows/deploy-onboarding-edge-functions.yml); [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge onboarding-capture -->[`onboarding-capture`](../supabase/functions/onboarding-capture/index.ts) | Public forms durably capture onboarding and fallback submissions. | Live v55. No CI deploy path; reviewed operator release only. |
| <!-- atlas:edge onboarding-full -->[`onboarding-full`](../supabase/functions/onboarding-full/index.ts) | Staff reads one full protected onboarding submission. | Live v59. [deploy-onboarding-edge-functions.yml](../.github/workflows/deploy-onboarding-edge-functions.yml) |
| <!-- atlas:edge onboarding-list -->[`onboarding-list`](../supabase/functions/onboarding-list/index.ts) | Staff reads standard onboarding submission summaries. | Live v59. [deploy-onboarding-edge-functions.yml](../.github/workflows/deploy-onboarding-edge-functions.yml) |
| <!-- atlas:edge production-archive -->[`production-archive`](../supabase/functions/production-archive/index.ts) | Admin reads retained archive media and rescue metadata. | Live v30. [deploy-onboarding-edge-functions.yml](../.github/workflows/deploy-onboarding-edge-functions.yml) |
| <!-- atlas:edge production-comments -->[`production-comments`](../supabase/functions/production-comments/index.ts) | Staff and client scope read canonical comment threads. | Live v46. [deploy-onboarding-edge-functions.yml](../.github/workflows/deploy-onboarding-edge-functions.yml) |
| <!-- atlas:edge production-write -->[`production-write`](../supabase/functions/production-write/index.ts) | Staff and client review operations write native production state through one gateway. | Live v102. [deploy-f27-section4-closures.yml](../.github/workflows/deploy-f27-section4-closures.yml); [deploy-onboarding-edge-functions.yml](../.github/workflows/deploy-onboarding-edge-functions.yml) |
| <!-- atlas:edge roster-read -->[`roster-read`](../supabase/functions/roster-read/index.ts) | n8n reads the client roster and who manages each client from the database (not yet used; key-guarded). | Not deployed yet. [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge roster-write -->[`roster-write`](../supabase/functions/roster-write/index.ts) | n8n writes clients and manager assignments to the database once the owner moves the main copy; also the Sheet-main Manager Sync door (not yet used; key-guarded). | Not deployed yet. [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge pto -->[`pto`](../supabase/functions/pto/index.ts) | Staff requests time off; admin decides and manages balances. | Live v29. [deploy-pto-edge-functions.yml](../.github/workflows/deploy-pto-edge-functions.yml) |
| <!-- atlas:edge quiz-capture -->[`quiz-capture`](../supabase/functions/quiz-capture/index.ts) | The marketing site captures quiz responses and forwards intake. | Live v26. No CI deploy path; reviewed operator release only. |
| <!-- atlas:edge quiz-leads-list -->[`quiz-leads-list`](../supabase/functions/quiz-leads-list/index.ts) | Admin reads captured marketing quiz leads. | Live v26. No CI deploy path; reviewed operator release only. |
| <!-- atlas:edge sample-review-reorder -->[`sample-review-reorder`](../supabase/functions/sample-review-reorder/index.ts) | Staff reorders existing Sample review cards. | Live v58. No CI deploy path; reviewed operator release only. |
| <!-- atlas:edge sample-review-upsert -->[`sample-review-upsert`](../supabase/functions/sample-review-upsert/index.ts) | Staff and client links save Sample reviews. Frozen live writer. | Live v71. Frozen by [owner rule](../AGENTS.md). No redeploy or re-gating without the owner. |
| <!-- atlas:edge smm-weekly-reports -->[`smm-weekly-reports`](../supabase/functions/smm-weekly-reports/index.ts) | Managers submit reports; admin reviews; n8n copies the manager directory. | Live v54. [deploy-onboarding-edge-functions.yml](../.github/workflows/deploy-onboarding-edge-functions.yml) |
| <!-- atlas:edge syncview-session -->[`syncview-session`](../supabase/functions/syncview-session/index.ts) | Prepared v2 guest sign-in exchanges a verified SyncView credential for scoped app metadata. | Live v7. [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge templates-save -->[`templates-save`](../supabase/functions/templates-save/index.ts) | Staff saves creative templates. | Live v56. No CI deploy path; reviewed operator release only. |
| <!-- atlas:edge thumbnail-folder-resolve -->[`thumbnail-folder-resolve`](../supabase/functions/thumbnail-folder-resolve/index.ts) | Calendar and Samples resolve a public Drive folder reference. | Live v48. No CI deploy path; reviewed operator release only. |
| <!-- atlas:edge thumbnail-revision-read -->[`thumbnail-revision-read`](../supabase/functions/thumbnail-revision-read/index.ts) | Staff and scoped client reviews obtain signed thumbnail revisions. | Live v51. [deploy-thumbnail-edge-functions.yml](../.github/workflows/deploy-thumbnail-edge-functions.yml) |
| <!-- atlas:edge thumbnail-revision-scan -->[`thumbnail-revision-scan`](../supabase/functions/thumbnail-revision-scan/index.ts) | The scheduled scanner discovers Drive thumbnail changes. | Live v55. [deploy-thumbnail-edge-functions.yml](../.github/workflows/deploy-thumbnail-edge-functions.yml) |
| <!-- atlas:edge workload-plan -->[`workload-plan`](../supabase/functions/workload-plan/index.ts) | Staff reads native Workload; admin and SMM edit internal plan dates. | Live v39. [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge write-diagnostics -->[`write-diagnostics`](../supabase/functions/write-diagnostics/index.ts) | Browsers report save refusals; admin reads Save problems. | Live v22. [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge client-hubspot-sync -->[`client-hubspot-sync`](../supabase/functions/client-hubspot-sync/index.ts) | Keeps each client's HubSpot deal, contract state and payment state in SyncView (read only toward HubSpot, never n8n): refreshed when an admin opens a profile and by a daily timer. | Source only, not deployed; needs `migrations/2026-10-04-client-hubspot-sync.sql`, the secrets `HUBSPOT_READ_TOKEN` and `HUBSPOT_SYNC_KEY`, and the switch row `client_hubspot_sync`. [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |
| <!-- atlas:edge monitoring-watchdog-tick -->[`monitoring-watchdog-tick`](../supabase/functions/monitoring-watchdog-tick/index.ts) | The monitoring dead-man's switch on Supabase's own timer: every 15 minutes (pg_cron) it runs the same heartbeat check as `scripts/monitoring-watchdog.js --check` and pages the owner through the alert relay; the GitHub hosts stay as a second observer. | Source only, not deployed; needs the secrets `MONITORING_WATCHDOG_KEY` and `MONITORING_ALERT_WEBHOOK`, then `migrations/2026-10-09-monitoring-watchdog-tick-ping.sql` and `-schedule.sql` (OPEN_REPAIRS 388). [deploy-single-function.yml](../.github/workflows/deploy-single-function.yml) |


### Live functions owned outside this repo


| Live function | Owner and purpose | Deployment finding |
| --- | --- | --- |
| `pipeline-google` | [Source](https://github.com/sidney-afk/synchro-pipelines/blob/main/supabase/functions/pipeline-google/index.ts). Pipeline key authenticates Docs, Sheets and Drive operations. | Live v5; operator deployment from synchro-pipelines, no workflow there. |
| `fp-tab-test` | [Retired test stub](https://github.com/sidney-afk/synchro-pipelines/blob/main/supabase/functions/fp-tab-test/index.ts). Returns a retired test result and no longer creates Doc tabs. | Live v5; source and live read confirm the retired stub. |
| `doctors-partial-capture` | [Capture workflow](#n8n). Marketing doctors form relays qualified partial leads into email-only recovery. | Live v1; source read through Supabase. No source file in any of the four repo trees checked, so deploy provenance is unverified. |


## n8n

The live census has **120 workflows: 76 active and 44 inactive** (2026-10-01: one more is inactive now, the Notion New Client workflow; other changes since are not recounted). Two complete list reads agreed; all 76 published active graphs were read. Active means enabled, not proven healthy. The [truth register](truth/N8N.md) holds IDs; the [phase 2 exit plan](plans/2026-09-30-n8n-exit-phase-2.md) owns decisions, evidence gates and retirement dates. Timers use the stated workflow timezone; instance timezone was not independently read. Node defaults that are absent from serialized settings are left unknown.


| Active workflow | Trigger and cadence | What it touches | Exit status |
| --- | --- | --- | --- |
| <!-- atlas:n8n udkwwzdFuPW3K2CE -->[`udkwwzdFuPW3K2CE`](https://synchrosocial.app.n8n.cloud/workflow/udkwwzdFuPW3K2CE) Client, Slack Creative Channel Finalizer | Every 15 minutes; POST webhook; Daily 15:07; instance timezone | Finalizer queue, Clients Info and Slack channel membership. | A: direct trigger built; keep safety timers until real client proof. |
| <!-- atlas:n8n nQ4vnZ8bmG3E3Lor -->[`nQ4vnZ8bmG3E3Lor`](https://synchrosocial.app.n8n.cloud/workflow/nQ4vnZ8bmG3E3Lor) Sales, Booking Recovery Dispatch | Hourly; instance timezone | Booking recovery queue, HubSpot, email, SMS and booking alerts. | C: due-work gate planned; hourly dispatch still enabled. |
| <!-- atlas:n8n a2sJJ3oZMefASPl2 -->[`a2sJJ3oZMefASPl2`](https://synchrosocial.app.n8n.cloud/workflow/a2sJJ3oZMefASPl2) Sales, Booking Recovery Heartbeat | Daily 09:00; America/New_York | Recovery queue health and Slack alert. | Keep as recovery heartbeat. |
| <!-- atlas:n8n 8nq6jGbpmCDZxnQz -->[`8nq6jGbpmCDZxnQz`](https://synchrosocial.app.n8n.cloud/workflow/8nq6jGbpmCDZxnQz) Sales, Doctors Partial Lead Capture | POST webhook; instance timezone | Doctors partial lead queue for email recovery. | Keep; external marketing intake. |
| <!-- atlas:n8n xoPqojySDriQ8Mzh -->[`xoPqojySDriQ8Mzh`](https://synchrosocial.app.n8n.cloud/workflow/xoPqojySDriQ8Mzh) Sales, Call Booked (iClosed) | POST webhook; instance timezone | iClosed booking into HubSpot and sales handlers. | Keep; external event. |
| <!-- atlas:n8n 31DnMJLU3YM89py1 -->[`31DnMJLU3YM89py1`](https://synchrosocial.app.n8n.cloud/workflow/31DnMJLU3YM89py1) Sales, Booking Recovery Capture (iClosed) | POST webhook; instance timezone | iClosed abandonment into booking recovery queue. | Keep; external event. |
| <!-- atlas:n8n rNrRCwKPGuau7sLH -->[`rNrRCwKPGuau7sLH`](https://synchrosocial.app.n8n.cloud/workflow/rNrRCwKPGuau7sLH) SyncView Calendar, Generate Caption | POST webhook; instance timezone | Frame.io media, Apify, Replicate transcription and Anthropic caption; native caption-jobs progress. | B: native progress live; finished caption still uses legacy Calendar Upsert. |
| <!-- atlas:n8n s8lsPpKqWYhscLPV -->[`s8lsPpKqWYhscLPV`](https://synchrosocial.app.n8n.cloud/workflow/s8lsPpKqWYhscLPV) Sales, Booked Call to Meta CAPI | POST webhook; instance timezone | Booked call event into Meta conversion API. | Keep; external event. |
| <!-- atlas:n8n Tfhc3vebZyG6obOg -->[`Tfhc3vebZyG6obOg`](https://synchrosocial.app.n8n.cloud/workflow/Tfhc3vebZyG6obOg) SyncView Edge Alert Relay to DM Sidney | POST webhook; instance timezone | Sanitized edge alerts into owner Slack DM. | Keep; alert relay. |
| <!-- atlas:n8n Q4n1bagJYBkurEaI -->[`Q4n1bagJYBkurEaI`](https://synchrosocial.app.n8n.cloud/workflow/Q4n1bagJYBkurEaI) CLIENTS METRICS | Timer defaults not serialized; instance timezone | Clients Info, Apify, YouTube, Metrics and PostTracking Sheets. | Keep scraping; analytics dual-write still pending. |
| <!-- atlas:n8n DyVPx0neUZ94R0hJ -->[`DyVPx0neUZ94R0hJ`](https://synchrosocial.app.n8n.cloud/workflow/DyVPx0neUZ94R0hJ) TOP VIDEOS | daily/default interval 4:00; unspecified fields use defaults; instance timezone | Clients Info, Apify, YouTube, TopVideos and analytics-write. | Keep scraping; TopVideos dual-write graph enabled. |
| <!-- atlas:n8n IjayuU6jkA21aKo3 -->[`IjayuU6jkA21aKo3`](https://synchrosocial.app.n8n.cloud/workflow/IjayuU6jkA21aKo3) SyncView TikTok Upload, Status | GET webhook; instance timezone | TikTokUpload Sheet status and Post For Me result lookup. | D: browser backoff shipped; provider calls remain here. |
| <!-- atlas:n8n eiisSbHsD1OnnNdQ -->[`eiisSbHsD1OnnNdQ`](https://synchrosocial.app.n8n.cloud/workflow/eiisSbHsD1OnnNdQ) Hiring, Practical Test Dispatch | Every 5 minutes; instance timezone | Hiring outbox through hiring-automation into practical-test email. | Keep until hiring closes; owner decision. |
| <!-- atlas:n8n su5afuhg17V2xhgh -->[`su5afuhg17V2xhgh`](https://synchrosocial.app.n8n.cloud/workflow/su5afuhg17V2xhgh) Hiring, Interview Invite Dispatch | Every 5 minutes; instance timezone | Hiring interview outbox through hiring-automation into invitation email. | Keep until hiring closes; owner decision. |
| <!-- atlas:n8n oi4BPg79dykdet6H -->[`oi4BPg79dykdet6H`](https://synchrosocial.app.n8n.cloud/workflow/oi4BPg79dykdet6H) Hiring, Application Capture (iClosed) | POST webhook; instance timezone | iClosed application, hiring bridge, Slack and Telegram. | Keep; external intake. |
| <!-- atlas:n8n oUf7Bj0lsLf72gIl -->[`oUf7Bj0lsLf72gIl`](https://synchrosocial.app.n8n.cloud/workflow/oUf7Bj0lsLf72gIl) Editor AI, Music Upload to Drive v2 | POST webhook; instance timezone | Editor music upload into Google Drive. | Keep; webhook tool. |
| <!-- atlas:n8n L6XjD7Kp6wDLCy5d -->[`L6XjD7Kp6wDLCy5d`](https://synchrosocial.app.n8n.cloud/workflow/L6XjD7Kp6wDLCy5d) Editor AI, Music Upload to Drive | POST webhook; instance timezone | Older editor music upload into Google Drive. | Keep; parallel webhook tool. |
| <!-- atlas:n8n 1WjZZjfQjDlg1Crf -->[`1WjZZjfQjDlg1Crf`](https://synchrosocial.app.n8n.cloud/workflow/1WjZZjfQjDlg1Crf) SyncView, Urgent Kasper Review to Slack | POST webhook; instance timezone | Urgent review notification into Slack DM. | Keep; webhook notification. |
| <!-- atlas:n8n TMJFYCqgqhZUBQpl -->[`TMJFYCqgqhZUBQpl`](https://synchrosocial.app.n8n.cloud/workflow/TMJFYCqgqhZUBQpl) Client Ideas, publish formatted tab (headers from payload) | POST webhook; instance timezone | Create formatted Google Sheet tab using payload headers. | Keep; pipeline publishing. |
| <!-- atlas:n8n tSQZx390d98JlHda -->[`tSQZx390d98JlHda`](https://synchrosocial.app.n8n.cloud/workflow/tSQZx390d98JlHda) Client Ideas, append rows to an existing tab | POST webhook; instance timezone | Append idea rows to caller-selected Google Sheet tab. | Keep; pipeline publishing. |
| <!-- atlas:n8n AWnfZXFbHFr43HuQ -->[`AWnfZXFbHFr43HuQ`](https://synchrosocial.app.n8n.cloud/workflow/AWnfZXFbHFr43HuQ) Client Ideas, publish formatted tab | POST webhook; instance timezone | Create formatted Google Sheet tab for client ideas. | Keep; pipeline publishing. |
| <!-- atlas:n8n qGJ7mUjml98DSiGo -->[`qGJ7mUjml98DSiGo`](https://synchrosocial.app.n8n.cloud/workflow/qGJ7mUjml98DSiGo) SyncView TikTok Upload, Submit (Direct) | POST webhook; instance timezone | Media submission into Post For Me and TikTokUpload Sheet. | Keep; D changes polling only. |
| <!-- atlas:n8n fqoI8XrN5hpY9SOj -->[`fqoI8XrN5hpY9SOj`](https://synchrosocial.app.n8n.cloud/workflow/fqoI8XrN5hpY9SOj) Arketa REVIVAL , daily member report to Slack | Cron `0 6 * * *`; Pacific/Honolulu | Arketa membership report into n8n report store and Slack. | Keep; external vendor report. |
| <!-- atlas:n8n chwr81f1GG5tgKtV -->[`chwr81f1GG5tgKtV`](https://synchrosocial.app.n8n.cloud/workflow/chwr81f1GG5tgKtV) Arketa REVIVAL , report watchdog | Cron `0 8 * * *`; Pacific/Honolulu | Arketa report freshness into Slack alert. | Keep; watchdog. |
| <!-- atlas:n8n 2Ax4c78jgI7roXzv -->[`2Ax4c78jgI7roXzv`](https://synchrosocial.app.n8n.cloud/workflow/2Ax4c78jgI7roXzv) Kasper Ad Performance, Daily Pull | Cron `0 9 * * *`; Cron `0 21 * * *`; instance timezone | Meta ads, HubSpot bookings and five Kasper performance tables. | G: possible optional move; current pull stays. |
| <!-- atlas:n8n BrJSe8zCKUccfmIq -->[`BrJSe8zCKUccfmIq`](https://synchrosocial.app.n8n.cloud/workflow/BrJSe8zCKUccfmIq) VIDEO PRODUCTION AUTOMATION | POST webhook; GET webhook; instance timezone | Video and graphic intake, AI, Drive and retained Linear branches. | H: keep large graph; production authority is native, retained branches are not live-write proof. |
| <!-- atlas:n8n t2RP7QNHrbQx52f4 -->[`t2RP7QNHrbQx52f4`](https://synchrosocial.app.n8n.cloud/workflow/t2RP7QNHrbQx52f4) Client, Onboarding Provisioning | Called by workflow; instance timezone | Drive folders, HubSpot and Slack finalizer queue. | Keep provisioning; A trims finalizer polling only. |
| <!-- atlas:n8n ghpbQQJizAnR6p2b -->[`ghpbQQJizAnR6p2b`](https://synchrosocial.app.n8n.cloud/workflow/ghpbQQJizAnR6p2b) Normal Sales, Booking Handler | Called by workflow; instance timezone | HubSpot booking, sales emails, Twilio and Telegram. | Keep; invoked sales handler. |
| <!-- atlas:n8n m6T2atZGGXKlDqfw -->[`m6T2atZGGXKlDqfw`](https://synchrosocial.app.n8n.cloud/workflow/m6T2atZGGXKlDqfw) Sales, Inbound SMS Relay | POST webhook; instance timezone | Inbound Twilio SMS relayed into Telegram. | Keep; external event. |
| <!-- atlas:n8n 1qZmOQPtG6rKYlK7 -->[`1qZmOQPtG6rKYlK7`](https://synchrosocial.app.n8n.cloud/workflow/1qZmOQPtG6rKYlK7) SyncView TikTok Upload, Result | POST webhook; instance timezone | Post For Me result callback updates TikTokUpload Sheet. | Keep; external callback. |
| <!-- atlas:n8n z9Rt1Np00nfvFe6J -->[`z9Rt1Np00nfvFe6J`](https://synchrosocial.app.n8n.cloud/workflow/z9Rt1Np00nfvFe6J) AI Client, Send Onboarding Email | Called by workflow; instance timezone | AI onboarding email and HubSpot record. | Keep; invoked onboarding handler. |
| <!-- atlas:n8n I6EES5l97h2fCims -->[`I6EES5l97h2fCims`](https://synchrosocial.app.n8n.cloud/workflow/I6EES5l97h2fCims) Normal Client, Send Onboarding Email | Called by workflow; instance timezone | Normal onboarding email and HubSpot record. | Keep; invoked onboarding handler. |
| <!-- atlas:n8n K8eriMC5r8sudLDB -->[`K8eriMC5r8sudLDB`](https://synchrosocial.app.n8n.cloud/workflow/K8eriMC5r8sudLDB) Sales Intake, Submit | POST webhook; instance timezone | Sales intake record, contract, Stripe, email and Slack. | Keep; external intake. |
| <!-- atlas:n8n 1T64i88a7oXh1TP8 -->[`1T64i88a7oXh1TP8`](https://synchrosocial.app.n8n.cloud/workflow/1T64i88a7oXh1TP8) Sales, Payment Received (Commas) | POST webhook; instance timezone | Payment signal into HubSpot contract and onboarding gates. | Keep; signed external event. |
| <!-- atlas:n8n RFi70kokkNFHoRC0 -->[`RFi70kokkNFHoRC0`](https://synchrosocial.app.n8n.cloud/workflow/RFi70kokkNFHoRC0) Onboarding, Append Client Row | POST webhook; instance timezone | Clients Info and Social Media Managers onboarding rows. | Keep; Sheets dual-write still pending. |
| <!-- atlas:n8n OmAExq4kdDdNk1HP -->[`OmAExq4kdDdNk1HP`](https://synchrosocial.app.n8n.cloud/workflow/OmAExq4kdDdNk1HP) Sales, Invoice Paid (Stripe) | POST webhook; instance timezone | Stripe invoice signal into HubSpot and onboarding gates. | Keep; external event. |
| <!-- atlas:n8n FlvoUXIFwRDg8KUb -->[`FlvoUXIFwRDg8KUb`](https://synchrosocial.app.n8n.cloud/workflow/FlvoUXIFwRDg8KUb) SyncView TikTok Upload, Media Upload URL | GET webhook; instance timezone | Post For Me media upload URL. | Keep; provider integration. |
| <!-- atlas:n8n 310kO3OnG1yytE2D -->[`310kO3OnG1yytE2D`](https://synchrosocial.app.n8n.cloud/workflow/310kO3OnG1yytE2D) Normal Sales, Pre-Call Nurture | Called by workflow; instance timezone | Normal pre-call nurture emails with waits and cancellation checks. | Keep; invoked sales handler. |
| <!-- atlas:n8n GaYgLJy8NCPUUfw5 -->[`GaYgLJy8NCPUUfw5`](https://synchrosocial.app.n8n.cloud/workflow/GaYgLJy8NCPUUfw5) AI Sales, Pre-Call Nurture | Called by workflow; instance timezone | AI pre-call nurture emails with waits and cancellation checks. | Keep; invoked sales handler. |
| <!-- atlas:n8n jlVfbg0Njxf1It7h -->[`jlVfbg0Njxf1It7h`](https://synchrosocial.app.n8n.cloud/workflow/jlVfbg0Njxf1It7h) SyncView, Weekly Backup | Sunday 02:00; instance timezone | Google Drive copies of Sheets, repo archive, n8n graphs and selected database tables. | Keep; partial backup, not complete restore proof. |
| <!-- atlas:n8n kI7M7R5UTJupOsFv -->[`kI7M7R5UTJupOsFv`](https://synchrosocial.app.n8n.cloud/workflow/kI7M7R5UTJupOsFv) SyncView SMM Reports, Weekly Reminder | Monday 09:00; America/Guatemala | Weekly social manager reporting reminder email. | Keep; timer. |
| <!-- atlas:n8n gAqqhjIcpBxW9wB6 -->[`gAqqhjIcpBxW9wB6`](https://synchrosocial.app.n8n.cloud/workflow/gAqqhjIcpBxW9wB6) Sales, Contract Signed | POST webhook; instance timezone | Signed contract event into HubSpot and onboarding gates. | Keep; external event. |
| <!-- atlas:n8n alZ87zcRVKgcGVY7 -->[`alZ87zcRVKgcGVY7`](https://synchrosocial.app.n8n.cloud/workflow/alZ87zcRVKgcGVY7) Clients, Monthly Check-in | Monthly 08:00; day not serialized; instance timezone | MonthlyCheckup Sheet into client check-in emails. | Keep; timer. |
| <!-- atlas:n8n II3sJbSLrptmtWLR -->[`II3sJbSLrptmtWLR`](https://synchrosocial.app.n8n.cloud/workflow/II3sJbSLrptmtWLR) Clients, Content Ready Notify | POST webhook; instance timezone | Clients Info into content-ready email. | Keep; webhook notification. |
| <!-- atlas:n8n XM70AtHSrsCsfd3k -->[`XM70AtHSrsCsfd3k`](https://synchrosocial.app.n8n.cloud/workflow/XM70AtHSrsCsfd3k) AI Sales, Post-Call Next Steps | Form submission; instance timezone | Post-call form into HubSpot, Stripe and next-step email. | Keep; form intake. |
| <!-- atlas:n8n y3rEWCVdB0esN3tO -->[`y3rEWCVdB0esN3tO`](https://synchrosocial.app.n8n.cloud/workflow/y3rEWCVdB0esN3tO) SyncView SMM Reports, Manager Sync | Daily 06:00; America/Guatemala | Social Media Managers Sheet copied through smm-weekly-reports. | G: optional move; Sheet migration dependency. |
| <!-- atlas:n8n ydbhXgV3X7SVnkSy -->[`ydbhXgV3X7SVnkSy`](https://synchrosocial.app.n8n.cloud/workflow/ydbhXgV3X7SVnkSy) SyncView Onboarding, Legacy List | GET webhook; instance timezone | Legacy onboarding Supabase list read. | Keep compatibility wrapper; no phase 2 off date. |
| <!-- atlas:n8n hxLFIdKG9hUIzukO -->[`hxLFIdKG9hUIzukO`](https://synchrosocial.app.n8n.cloud/workflow/hxLFIdKG9hUIzukO) SyncView AI Onboarding, Submit | POST webhook; instance timezone | AI onboarding submission into Supabase and Slack. | Keep external form wrapper. |
| <!-- atlas:n8n ljNY7CKYLKzMOACZ -->[`ljNY7CKYLKzMOACZ`](https://synchrosocial.app.n8n.cloud/workflow/ljNY7CKYLKzMOACZ) SyncView Onboarding, Submit | POST webhook; instance timezone | Normal onboarding submission into Supabase and Slack. | Keep external form wrapper. |
| <!-- atlas:n8n u4ACOKArXHidVJXl -->[`u4ACOKArXHidVJXl`](https://synchrosocial.app.n8n.cloud/workflow/u4ACOKArXHidVJXl) SyncView Onboarding, Fallback Capture | POST webhook; instance timezone | Failed onboarding into n8n fallback table and Slack. | Keep recovery capture. |
| <!-- atlas:n8n r8b6IU2762qkmSvZ -->[`r8b6IU2762qkmSvZ`](https://synchrosocial.app.n8n.cloud/workflow/r8b6IU2762qkmSvZ) AI Sales, Call Cancelled (iClosed) | POST webhook; instance timezone | iClosed cancellation into n8n cancellation table. | Keep; external event. |
| <!-- atlas:n8n itqDXSl2ybsRSAiQ -->[`itqDXSl2ybsRSAiQ`](https://synchrosocial.app.n8n.cloud/workflow/itqDXSl2ybsRSAiQ) SyncView, Error Alerts to DM Sidney | Production error; instance timezone | Production workflow failures into Slack DM. | Keep; coverage depends on each workflow error setting. |
| <!-- atlas:n8n rhDX5VfnmOylc8o7 -->[`rhDX5VfnmOylc8o7`](https://synchrosocial.app.n8n.cloud/workflow/rhDX5VfnmOylc8o7) SyncView Editors, Labor Week | POST webhook; instance timezone | Retained Linear labor-week read. | Keep in plan; current credential success was not tested. |
| <!-- atlas:n8n oDZ1Oljvaig5KSLD -->[`oDZ1Oljvaig5KSLD`](https://synchrosocial.app.n8n.cloud/workflow/oDZ1Oljvaig5KSLD) SyncView AI Onboarding, List | GET webhook; instance timezone | AI onboarding Supabase list read. | Keep compatibility wrapper. |
| <!-- atlas:n8n pWSqaqVw7dmqhYOA -->[`pWSqaqVw7dmqhYOA`](https://synchrosocial.app.n8n.cloud/workflow/pWSqaqVw7dmqhYOA) SyncView Calendar, Upsert Post | POST webhook; instance timezone | Calendar Sheet, native Calendar mirror and comment merge helper. | Phase 1: retain through bake; B and K still have callers. |
| <!-- atlas:n8n slqt2zCDyIc7OAmY -->[`slqt2zCDyIc7OAmY`](https://synchrosocial.app.n8n.cloud/workflow/slqt2zCDyIc7OAmY) SyncView Onboarding, List | GET webhook; instance timezone | Normal onboarding Supabase list read. | Keep compatibility wrapper. |
| <!-- atlas:n8n gPY5DL4D0n5nwius -->[`gPY5DL4D0n5nwius`](https://synchrosocial.app.n8n.cloud/workflow/gPY5DL4D0n5nwius) Sample Review, Upsert | POST webhook; instance timezone | Native sample card, comments and save event. | Phase 1: earliest off October 29, after client and pinned-repair gates. |
| <!-- atlas:n8n XOT7IDFGxTwOUCCP -->[`XOT7IDFGxTwOUCCP`](https://synchrosocial.app.n8n.cloud/workflow/XOT7IDFGxTwOUCCP) Sample Review, Reorder | POST webhook; instance timezone | Native sample card order. | Phase 1: earliest off October 29 and zero-run proof. |
| <!-- atlas:n8n EUGX35UmyUgSCjWD -->[`EUGX35UmyUgSCjWD`](https://synchrosocial.app.n8n.cloud/workflow/EUGX35UmyUgSCjWD) Sample Review, Get | GET webhook; instance timezone | Native Samples read compatibility endpoint. | F: browser fallback retired in source; retain live wrapper until published page and zero-call proof. |
| <!-- atlas:n8n o6wWaGNlIlyZFTX7 -->[`o6wWaGNlIlyZFTX7`](https://synchrosocial.app.n8n.cloud/workflow/o6wWaGNlIlyZFTX7) SyncView TikTok Upload, Submit | POST webhook; instance timezone | Post For Me submission and TikTokUpload Sheet ledger. | Keep; D changes polling only. |
| <!-- atlas:n8n meM78zr1Gcl72c6f -->[`meM78zr1Gcl72c6f`](https://synchrosocial.app.n8n.cloud/workflow/meM78zr1Gcl72c6f) Calendar Comment Merge (helper) | Called by workflow; instance timezone | Atomic native Calendar comment merge called by upsert. | Retire with Calendar Upsert after all gates. |
| <!-- atlas:n8n iA54ipMOybicmYBh -->[`iA54ipMOybicmYBh`](https://synchrosocial.app.n8n.cloud/workflow/iA54ipMOybicmYBh) SyncView Calendar, Append Post | POST webhook; instance timezone | Calendar Sheet append and native mirror. | Phase 1: earliest off October 29 and zero-run proof. |
| <!-- atlas:n8n JcekBKUzELgX4HjH -->[`JcekBKUzELgX4HjH`](https://synchrosocial.app.n8n.cloud/workflow/JcekBKUzELgX4HjH) SyncView Calendar, Delete Post | POST webhook; instance timezone | Calendar Sheet delete state and native mirror. | Phase 1: earliest off October 29 and zero-run proof. |
| <!-- atlas:n8n lTtZNLrQLpIZqwAY -->[`lTtZNLrQLpIZqwAY`](https://synchrosocial.app.n8n.cloud/workflow/lTtZNLrQLpIZqwAY) SyncView Calendar, Reorder (batch) | POST webhook; instance timezone | Calendar Sheet batch ordering and native mirror. | Phase 1: earliest off October 29 and zero-run proof. |
| <!-- atlas:n8n OXd0sUoSJYMspGTF -->[`OXd0sUoSJYMspGTF`](https://synchrosocial.app.n8n.cloud/workflow/OXd0sUoSJYMspGTF) SyncView Calendar, Reorder | POST webhook; instance timezone | Calendar Sheet ordering and native mirror. | Phase 1: earliest off October 29 and zero-run proof. |
| <!-- atlas:n8n 5KnYvvZ33B78Khny -->[`5KnYvvZ33B78Khny`](https://synchrosocial.app.n8n.cloud/workflow/5KnYvvZ33B78Khny) SyncView Caption Jobs, Status | GET webhook; instance timezone | Legacy n8n caption job status store. | B: retain 30 days after native browser progress ships. |
| <!-- atlas:n8n vwRfBZsmUMtDqbYM -->[`vwRfBZsmUMtDqbYM`](https://synchrosocial.app.n8n.cloud/workflow/vwRfBZsmUMtDqbYM) SyncView Caption Jobs, Update | POST webhook; instance timezone | Legacy n8n caption job update store. | B: retain 30 days after native browser progress ships. |
| <!-- atlas:n8n TcWOfnKd4Csdnnbv -->[`TcWOfnKd4Csdnnbv`](https://synchrosocial.app.n8n.cloud/workflow/TcWOfnKd4Csdnnbv) SyncView Kasper, Queue (batch) | POST webhook; instance timezone | Calendar Sheet batch reads for review queue. | F: browser fallback retired in source; retain live wrapper until published page and zero-call proof. |
| <!-- atlas:n8n y1bEpXLggfR5HqYV -->[`y1bEpXLggfR5HqYV`](https://synchrosocial.app.n8n.cloud/workflow/y1bEpXLggfR5HqYV) New Client to Slack DM (Notion Onboarding) | Notion poll every minute; instance timezone | New Notion onboarding page into Slack DM. | Turned off 2026-10-01 (owner's go, `ops/N8N_EDIT_LOG.md`); kept unarchived for the F60 retirement proof. Listed here until the active table is regenerated. |
| <!-- atlas:n8n FD2QUIOlobkdLOgs -->[`FD2QUIOlobkdLOgs`](https://synchrosocial.app.n8n.cloud/workflow/FD2QUIOlobkdLOgs) MARKET RESEARCH | POST webhook; instance timezone | Apify and Anthropic into Market Research Briefs and Hook Library. | Keep; five enabled webhooks, daily and content-summary branches disabled. |
| <!-- atlas:n8n Jr7JviDpBHee508N -->[`Jr7JviDpBHee508N`](https://synchrosocial.app.n8n.cloud/workflow/Jr7JviDpBHee508N) Project Central, Sheet API | GET webhook; POST webhook; instance timezone | Project Central Sheet reads and full-tab replacement writes. | Keep; outside analytics Sheet migration. |
| <!-- atlas:n8n 3hZnjXmHdNv4bttw -->[`3hZnjXmHdNv4bttw`](https://synchrosocial.app.n8n.cloud/workflow/3hZnjXmHdNv4bttw) SyncView Caption Prompts, Get | GET webhook; instance timezone | CaptionPrompts Sheet fallback read. | Keep first-load fallback; no phase 2 off date. |
| <!-- atlas:n8n RGkuE8d4uJg6CPde -->[`RGkuE8d4uJg6CPde`](https://synchrosocial.app.n8n.cloud/workflow/RGkuE8d4uJg6CPde) SyncView Caption Prompts, Save | POST webhook; instance timezone | CaptionPrompts Sheet save compatibility. | Phase 1: earliest off October 29 and zero-run proof. |
| <!-- atlas:n8n iYb1896sIAclGvy8 -->[`iYb1896sIAclGvy8`](https://synchrosocial.app.n8n.cloud/workflow/iYb1896sIAclGvy8) SyncView TikTok Upload, List | GET webhook; instance timezone | TikTokUpload Sheet list. | Keep; D changes polling only. |
| <!-- atlas:n8n 4ca3li54eRFtSfXE -->[`4ca3li54eRFtSfXE`](https://synchrosocial.app.n8n.cloud/workflow/4ca3li54eRFtSfXE) SyncView TikTok Upload, Cancel | POST webhook; instance timezone | TikTokUpload Sheet cancellation state. | Keep; not proof of provider cancellation. |
| <!-- atlas:n8n KViFEOqSRBNdCJRk -->[`KViFEOqSRBNdCJRk`](https://synchrosocial.app.n8n.cloud/workflow/KViFEOqSRBNdCJRk) SyncView Calendar, Get | GET webhook; instance timezone | Calendar Sheet fallback read. | F: browser fallback retired in source; retain live wrapper until published page and zero-call proof. |


### Inactive retained workflows

These 44 IDs still exist but are disabled. They are history or recovery assets, not schedules. Individual inactive graphs and past execution health were not audited; do not reactivate them from this map. Names of client-specific one-time tasks are omitted.


| Workflow | Purpose from retained name | Status |
| --- | --- | --- |
| <!-- atlas:n8n TJVMyfwl85qrFGeK -->[`TJVMyfwl85qrFGeK`](https://synchrosocial.app.n8n.cloud/workflow/TJVMyfwl85qrFGeK) | SyncView, Urgent Tweak to Slack | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n YftXIbiMkgin50HI -->[`YftXIbiMkgin50HI`](https://synchrosocial.app.n8n.cloud/workflow/YftXIbiMkgin50HI) | Create AI Generated Music Folder (setup) | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n qR1Wgr71HTohlCzH -->[`qR1Wgr71HTohlCzH`](https://synchrosocial.app.n8n.cloud/workflow/qR1Wgr71HTohlCzH) | Filming Plan, Docs BatchUpdate (webhook) | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n LRf1OxhXlyv5YEyV -->[`LRf1OxhXlyv5YEyV`](https://synchrosocial.app.n8n.cloud/workflow/LRf1OxhXlyv5YEyV) | Private one-time maintenance task | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n L8mem5VAJyNZiuk7 -->[`L8mem5VAJyNZiuk7`](https://synchrosocial.app.n8n.cloud/workflow/L8mem5VAJyNZiuk7) | Private one-time maintenance task | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n 6UyCt01RNlt2YO9B -->[`6UyCt01RNlt2YO9B`](https://synchrosocial.app.n8n.cloud/workflow/6UyCt01RNlt2YO9B) | Private one-time maintenance task | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n 2JxqOqTUtlfUWI9N -->[`2JxqOqTUtlfUWI9N`](https://synchrosocial.app.n8n.cloud/workflow/2JxqOqTUtlfUWI9N) | Private one-time maintenance task | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n Zw2TIvLuMlIo81Vp -->[`Zw2TIvLuMlIo81Vp`](https://synchrosocial.app.n8n.cloud/workflow/Zw2TIvLuMlIo81Vp) | Private one-time maintenance task | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n e7IQzG58w5dRNSvV -->[`e7IQzG58w5dRNSvV`](https://synchrosocial.app.n8n.cloud/workflow/e7IQzG58w5dRNSvV) | Private one-time maintenance task | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n xOVa10JrMFXAe2xJ -->[`xOVa10JrMFXAe2xJ`](https://synchrosocial.app.n8n.cloud/workflow/xOVa10JrMFXAe2xJ) | Private one-time maintenance task | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n tzHL7vV2n4IZUCGW -->[`tzHL7vV2n4IZUCGW`](https://synchrosocial.app.n8n.cloud/workflow/tzHL7vV2n4IZUCGW) | Private one-time maintenance task | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n iz42ILXhZ3eBj3IJ -->[`iz42ILXhZ3eBj3IJ`](https://synchrosocial.app.n8n.cloud/workflow/iz42ILXhZ3eBj3IJ) | Private one-time maintenance task | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n E9MUbcDUVt4FJu2i -->[`E9MUbcDUVt4FJu2i`](https://synchrosocial.app.n8n.cloud/workflow/E9MUbcDUVt4FJu2i) | Private one-time maintenance task | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n ABiN18oLVsE0X5Pt -->[`ABiN18oLVsE0X5Pt`](https://synchrosocial.app.n8n.cloud/workflow/ABiN18oLVsE0X5Pt) | Private one-time maintenance task | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n 3ZA0GIMuklByBScV -->[`3ZA0GIMuklByBScV`](https://synchrosocial.app.n8n.cloud/workflow/3ZA0GIMuklByBScV) | Private one-time maintenance task | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n K1iSkFMQCroJvbPc -->[`K1iSkFMQCroJvbPc`](https://synchrosocial.app.n8n.cloud/workflow/K1iSkFMQCroJvbPc) | Private one-time maintenance task | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n QibBgR4ahxWbCo30 -->[`QibBgR4ahxWbCo30`](https://synchrosocial.app.n8n.cloud/workflow/QibBgR4ahxWbCo30) | Private one-time maintenance task | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n 4p3IWVnSaFNFhGWv -->[`4p3IWVnSaFNFhGWv`](https://synchrosocial.app.n8n.cloud/workflow/4p3IWVnSaFNFhGWv) | Client, Slack Private Channel Provisioner | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n 824XucXIPu0YBRHs -->[`824XucXIPu0YBRHs`](https://synchrosocial.app.n8n.cloud/workflow/824XucXIPu0YBRHs) | Private one-time maintenance task | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n AHTwSZPubALe6OJU -->[`AHTwSZPubALe6OJU`](https://synchrosocial.app.n8n.cloud/workflow/AHTwSZPubALe6OJU) | Private one-time maintenance task | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n BfUkVRGAOSsH3pmi -->[`BfUkVRGAOSsH3pmi`](https://synchrosocial.app.n8n.cloud/workflow/BfUkVRGAOSsH3pmi) | Sales, Growth Quiz Capture | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n 7PMVMQ9NuuxBa2Gi -->[`7PMVMQ9NuuxBa2Gi`](https://synchrosocial.app.n8n.cloud/workflow/7PMVMQ9NuuxBa2Gi) | Sales, Growth Quiz Heartbeat | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n 8OcmLPacyrug0V3M -->[`8OcmLPacyrug0V3M`](https://synchrosocial.app.n8n.cloud/workflow/8OcmLPacyrug0V3M) | Sales, Growth Quiz Nurture Dispatch | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n NeTWOfflUndxTe1C -->[`NeTWOfflUndxTe1C`](https://synchrosocial.app.n8n.cloud/workflow/NeTWOfflUndxTe1C) | Kasper Ad Performance, ONE-TIME Backfill (manual only) | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n UYUTvvj7YGJOeZuz -->[`UYUTvvj7YGJOeZuz`](https://synchrosocial.app.n8n.cloud/workflow/UYUTvvj7YGJOeZuz) | Kasper Ad Performance, Daily Pull | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n qllIDZPkdNAPRj0b -->[`qllIDZPkdNAPRj0b`](https://synchrosocial.app.n8n.cloud/workflow/qllIDZPkdNAPRj0b) | SyncView Monitoring Pager + Reconciler V2 Trigger | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n 8stSpZUiyG7f2LQX -->[`8stSpZUiyG7f2LQX`](https://synchrosocial.app.n8n.cloud/workflow/8stSpZUiyG7f2LQX) | SyncView Calendar, Linear Add Comment | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n VQqqeY9B2GZbh2Bt -->[`VQqqeY9B2GZbh2Bt`](https://synchrosocial.app.n8n.cloud/workflow/VQqqeY9B2GZbh2Bt) | SyncView Calendar, Linear Set Status | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n BTxic5NSaCMtZMh6 -->[`BTxic5NSaCMtZMh6`](https://synchrosocial.app.n8n.cloud/workflow/BTxic5NSaCMtZMh6) | Weekly Slack, Top Reel of the Week | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n ukLGHr6uDJIEP1pM -->[`ukLGHr6uDJIEP1pM`](https://synchrosocial.app.n8n.cloud/workflow/ukLGHr6uDJIEP1pM) | Weekly Slack, Top Reel + Top Videos in Niche (TEST) | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n GP8CSZDNcy5sGdFr -->[`GP8CSZDNcy5sGdFr`](https://synchrosocial.app.n8n.cloud/workflow/GP8CSZDNcy5sGdFr) | SyncView Calendar, Linear Issue Statuses | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n ROx3VQ36xm58AaIM -->[`ROx3VQ36xm58AaIM`](https://synchrosocial.app.n8n.cloud/workflow/ROx3VQ36xm58AaIM) | Register PFM Result Webhook (run once) | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n yQBGgdbZPqOgn2eE -->[`yQBGgdbZPqOgn2eE`](https://synchrosocial.app.n8n.cloud/workflow/yQBGgdbZPqOgn2eE) | SyncView Calendar, Supabase Backfill (ALL clients) | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n aw2b98wxraQTEulJ -->[`aw2b98wxraQTEulJ`](https://synchrosocial.app.n8n.cloud/workflow/aw2b98wxraQTEulJ) | SyncView Calendar, Supabase Backfill (TEST one client) | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n G1RRkIDs6Mh7RGk8 -->[`G1RRkIDs6Mh7RGk8`](https://synchrosocial.app.n8n.cloud/workflow/G1RRkIDs6Mh7RGk8) | Private one-time maintenance task | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n 7Pdp6qnkBzwXP3YG -->[`7Pdp6qnkBzwXP3YG`](https://synchrosocial.app.n8n.cloud/workflow/7Pdp6qnkBzwXP3YG) | SyncView Samples, Provision Missing Tabs | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n gB17L9M5yYxxk6GT -->[`gB17L9M5yYxxk6GT`](https://synchrosocial.app.n8n.cloud/workflow/gB17L9M5yYxxk6GT) | SyncView Calendar, Provision Missing Tabs | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n d7Dod7OuQsVsl1CN -->[`d7Dod7OuQsVsl1CN`](https://synchrosocial.app.n8n.cloud/workflow/d7Dod7OuQsVsl1CN) | SyncView Workload, Tweak Comments | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n 5S4JyVVR2CpHEv9b -->[`5S4JyVVR2CpHEv9b`](https://synchrosocial.app.n8n.cloud/workflow/5S4JyVVR2CpHEv9b) | Filming Plan Tabs | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n fJNyB5fNCRSTYNfQ -->[`fJNyB5fNCRSTYNfQ`](https://synchrosocial.app.n8n.cloud/workflow/fJNyB5fNCRSTYNfQ) | Project Central, Inspect (debug) | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n 6yhqWsM8RT2c7AOp -->[`6yhqWsM8RT2c7AOp`](https://synchrosocial.app.n8n.cloud/workflow/6yhqWsM8RT2c7AOp) | Private one-time maintenance task | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n Nk3pwR6Fbl4VAPqH -->[`Nk3pwR6Fbl4VAPqH`](https://synchrosocial.app.n8n.cloud/workflow/Nk3pwR6Fbl4VAPqH) | SyncView Calendar, Linear Sub-Issues | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n VAqlVLk8wczPq6DQ -->[`VAqlVLk8wczPq6DQ`](https://synchrosocial.app.n8n.cloud/workflow/VAqlVLk8wczPq6DQ) | AI WORKFLOW | Disabled; retained, no ordinary deployment or off-date action. |
| <!-- atlas:n8n vb3O0wkTK6Q7Rtro -->[`vb3O0wkTK6Q7Rtro`](https://synchrosocial.app.n8n.cloud/workflow/vb3O0wkTK6Q7Rtro) | BACKUPS | Disabled; retained, no ordinary deployment or off-date action. |


### Historical IDs still mentioned in truth

These are absent from the current full live list. They remain linked because the truth register preserves old execution and rollback receipts.


| Historical workflow | Evidence and state |
| --- | --- |
| <!-- atlas:n8n 19ZqxaOt09KPLGx1 -->[`19ZqxaOt09KPLGx1`](truth/N8N.md) | Absent from current live census; retained documentary history. |
| <!-- atlas:n8n 6OtjILbhkYLY6yVE -->[`6OtjILbhkYLY6yVE`](truth/N8N.md) | Absent from current live census; retained documentary history. |
| <!-- atlas:n8n BKl9OFVMb4VS2IHf -->[`BKl9OFVMb4VS2IHf`](truth/N8N.md) | Absent from current live census; retained documentary history. |
| <!-- atlas:n8n CdCYzye6Khp6x5A6 -->[`CdCYzye6Khp6x5A6`](truth/N8N.md) | Absent from current live census; retained documentary history. |
| <!-- atlas:n8n DBQvKxonjhTt7rKC -->[`DBQvKxonjhTt7rKC`](truth/N8N.md) | Absent from current live census; retained documentary history. |
| <!-- atlas:n8n FPQo6G2zi8WcIfa1 -->[`FPQo6G2zi8WcIfa1`](truth/N8N.md) | Absent from current live census; retained documentary history. |
| <!-- atlas:n8n MJbMZ789B5ExZz9x -->[`MJbMZ789B5ExZz9x`](truth/N8N.md) | Absent from current live census; retained documentary history. |
| <!-- atlas:n8n ZJOtYpQZj73DcBB1 -->[`ZJOtYpQZj73DcBB1`](truth/N8N.md) | Absent from current live census; retained documentary history. |
| <!-- atlas:n8n lGwC9WWPVJtxphtf -->[`lGwC9WWPVJtxphtf`](truth/N8N.md) | Absent from current live census; retained documentary history. |
| <!-- atlas:n8n wP0yLVDIOJph1bcM -->[`wP0yLVDIOJph1bcM`](truth/N8N.md) | Absent from current live census; retained documentary history. |
| <!-- atlas:n8n xEhLpKwNv8uTaeAK -->[`xEhLpKwNv8uTaeAK`](truth/N8N.md) | Absent from current live census; retained documentary history. |


## Google Sheets

Workbook metadata was read without cell values. IDs, private workbook titles, client tab names and share URLs are deliberately absent from this public map. The [Sheets truth page](truth/SHEETS.md) and [move plan](plans/2026-09-24-sheets-to-supabase.md) own deeper context. Metadata proves a tab exists; it does not prove that a human still uses it.

The main SyncView workbook has **20 tabs**. Browser readers below come from [config](../src/index/040-shared-briefs.js.part) and [loaders](../src/index/040-shared-briefs.js.part); n8n owners link to the active registry above. Staff analytics currently has native mirror reads enabled; the global client mirror switch is off, with one enrolled test link. Clients Info is still the roster authority.


| Main workbook tab | Readers and writers | Move status and owner evidence |
| --- | --- | --- |
| `Clients Info` | Browser roster and allowlist; metrics, top videos and onboarding workflows read it. Humans, Append Client Row and finalizer write it. | Phase 1 roster dual-write pending; client_profiles_authority remains sheet. [Reader and writer registry](#n8n) |
| `Videographer Contact` | Retained contacts tab; no enabled active-graph caller found. | Human use unverified; no confirmed cutover. [Reader and writer registry](#n8n) |
| `Legacy Clients` | Retained historical roster; no enabled active-graph caller found. | Human use unverified; preserved. [Reader and writer registry](#n8n) |
| `Social Media Managers` | Browser review queue and Manager Sync read it; humans and Append Client Row write it. | Daily copied into social_media_managers; Sheet retained. [Reader and writer registry](#n8n) |
| `Competitors` | Retained competitor reference; no enabled active-graph caller found. | Human use unverified; preserved. [Reader and writer registry](#n8n) |
| `Old_Clients` | Retained historical roster; no enabled active-graph caller found. | Human use unverified; preserved. [Reader and writer registry](#n8n) |
| `Monthly Checkup` | Monthly Check-in reads it for client emails. | Outside analytics move; retained. [Reader and writer registry](#n8n) |
| `Metrics` | Browser analytics reads it when native receipt is incomplete; CLIENTS METRICS appends. | Mirror table exists; writer dual-write pending. [Reader and writer registry](#n8n) |
| `PostTracking` | CLIENTS METRICS reads and updates tracking state. | Outside the five analytics mirror copies; retained. [Reader and writer registry](#n8n) |
| `TopVideos` | Browser analytics fallback; TOP VIDEOS appends and dual-writes analytics-write. | Mirror table exists; workflow dual-write enabled, comparison not certified here. [Reader and writer registry](#n8n) |
| `ContentSummaries` | Optional browser fallback; MARKET RESEARCH writer branch is disabled. | Mirror table exists; no enabled content-summary writer found. [Reader and writer registry](#n8n) |
| `Competitor Briefs` | Old generator and browser download removed; retained tab exists. | Retired by owner; not migrating. [Reader and writer registry](#n8n) |
| `Market Research Briefs` | Browser Brief fallback; MARKET RESEARCH webhook branches write it. | Mirror table exists; writer dual-write pending. [Reader and writer registry](#n8n) |
| `CaptionPrompts` | Caption Prompts Get reads and Save writes compatibility copy. Browser uses native table first. | Save earliest retirement October 29; Get stays fallback. [Reader and writer registry](#n8n) |
| `Video Editors` | Video Production Automation reads editor assignment rows. | Outside analytics move; retained. [Reader and writer registry](#n8n) |
| `Templates` | Retained compatibility tab; current browser and templates-save use native templates. | Native primary copy; no enabled graph writer found. [Reader and writer registry](#n8n) |
| `Hook Library` | MARKET RESEARCH appends generated hooks. | Outside analytics move; retained. [Reader and writer registry](#n8n) |
| `Linear Submissions` | Video Production Automation retains intake receipt branch. | Native production authority is on; retained branch does not prove current Linear writes. [Reader and writer registry](#n8n) |
| `TikTokUpload` | TikTok submit, callback, list, status and cancel workflows use provider ledger. | Outside analytics move; Instagram uses native instagram_uploads. [Reader and writer registry](#n8n) |
| `FilmingPlans` | Retained plan tab; browser and filming-plans use native filming_plans. | Native primary copy; no enabled graph writer found. [Reader and writer registry](#n8n) |


### Other workbooks and dynamic tabs


| Workbook family | Tabs and readers or writers | Move status |
| --- | --- | --- |
| Calendar mirror | 64 tabs: one hidden `Sheet1`, 32 private `Calendar_<client>` tabs and 31 private `Samples_<client>` tabs. Live Calendar Get, Queue and legacy writes use Calendar tabs; the current browser has retired Get and Queue fallback calls. Samples reads use Supabase. [Owners](#n8n) | Calendar fallback retired in browser source; live wrapper waits on publication and zero-call proof. Legacy writers bake until October 29 or later. Samples tabs retained; individual human use unverified. |
| Video automation workbook | 18 private client tabs, metadata verified. Video Production Automation references the workbook; individual tab usage was not closed. [Owner](#n8n) | Retained legacy intake material; no blanket migration claim. |
| Project Central workbook | `Projects`, `Areas`, `Items` are graph references for Sheet API GET and POST replacement. Metadata read returned 403. [Owner](#n8n) | Outside the analytics move. Tab existence and human use unverified. |
| Client Ideas workbooks | Caller-selected workbooks and tabs used by the three publish or append workflows and pipeline-google. [Writer rules](https://github.com/sidney-afk/synchro-pipelines/blob/main/GOOGLE_WRITES.md) | Dynamic inventory cannot be exhaustively resolved from static graphs; not part of analytics retirement. |


## Scheduled jobs

These are configured triggers, not guarantees that recent runs succeeded. [Monitoring map](ops/MONITORING.md) and [Open repairs](ops/OPEN_REPAIRS.md) own operational receipts. Every active n8n timer, including Notion polling, is shown in [the active table](#n8n). Workflow-local timezone and unresolved defaults are recorded there.

### Database jobs

All three live jobs are active. Cron clock interpretation is UTC; recent execution success was not audited.


| Job | Schedule | What it does and source |
| --- | --- | --- |
| `workload-snapshot-warm` | Every 10 seconds | Warms native workload snapshot. [SQL source](../migrations/2026-09-23-workload-native-snapshot-server-warm.sql) |
| `workload-snapshot-warm-history` | `17 3 * * *` | Removes this warmer's cron history older than one day. [Live catalog context](truth/SUPABASE.md) |
| `write-refusal-retention-daily` | `17 4 * * *` | Runs production_write_refusal_retention_daily_v1 for bounded diagnostic retention. [Diagnostic reader](../supabase/functions/write-diagnostics/index.ts) |


### GitHub Actions

There are **50 workflow files** in this checkout. The GitHub catalog includes additional historical entries with no current file; catalog presence alone is not a runnable source or a deployment. Cron expressions below use UTC. Manual evidence workflows can write data when dispatched; this session dispatched none.


| Workflow file | Trigger and schedule | Purpose |
| --- | --- | --- |
| <!-- atlas:action .github/workflows/alert-digest.yml -->[`alert-digest.yml`](../.github/workflows/alert-digest.yml) | Manual, Push, Cron `47 * * * *` | Builds the one combined problem message; posts only if the `ALERT_DIGEST_ENABLED` variable is `true` (off today, so shadow). |
| <!-- atlas:action .github/workflows/assurance-ledger-freshness.yml -->[`assurance-ledger-freshness.yml`](../.github/workflows/assurance-ledger-freshness.yml) | Manual, Push, Cron `37 7 * * *` | Checks evidence ledger age. |
| <!-- atlas:action .github/workflows/calendar-e2e-nightly.yml -->[`calendar-e2e-nightly.yml`](../.github/workflows/calendar-e2e-nightly.yml) | Manual, Cron `0 8 * * *` | Runs Calendar browser journeys. |
| <!-- atlas:action .github/workflows/calendar-unit-tests.yml -->[`calendar-unit-tests.yml`](../.github/workflows/calendar-unit-tests.yml) | Push, Pull request | Runs unit inventory and source checks, including atlas-sync. |
| <!-- atlas:action .github/workflows/card-calendar-status-drift.yml -->[`card-calendar-status-drift.yml`](../.github/workflows/card-calendar-status-drift.yml) | Manual, Push, Cron `27 * * * *` | Reads native card and Calendar status drift. |
| <!-- atlas:action .github/workflows/client-entry-visible-boot.yml -->[`client-entry-visible-boot.yml`](../.github/workflows/client-entry-visible-boot.yml) | Manual, Push, Pull request | Checks client entry render without exposing private links. |
| <!-- atlas:action .github/workflows/client-signoff-reconcile.yml -->[`client-signoff-reconcile.yml`](../.github/workflows/client-signoff-reconcile.yml) | Manual | Reconciles client review receipts into native state. |
| <!-- atlas:action .github/workflows/clients-roster-sync.yml -->[`clients-roster-sync.yml`](../.github/workflows/clients-roster-sync.yml) | Manual, Cron `41 6 * * *` | Copies and compares Sheet roster into clients; apply variable is true. |
| <!-- atlas:action .github/workflows/crosswalk-phase2-repair.yml -->[`crosswalk-phase2-repair.yml`](../.github/workflows/crosswalk-phase2-repair.yml) | Manual | Runs owner-gated crosswalk repair. |
| <!-- atlas:action .github/workflows/dawn-check.yml -->[`dawn-check.yml`](../.github/workflows/dawn-check.yml) | Manual, Cron `30 11 * * 1-5` | Checks health and reports owner alerts. |
| <!-- atlas:action .github/workflows/deploy-client-review-link.yml -->[`deploy-client-review-link.yml`](../.github/workflows/deploy-client-review-link.yml) | Manual | Deploys the function set in its source; see owner release lanes below. |
| <!-- atlas:action .github/workflows/deploy-description-image-upload.yml -->[`deploy-description-image-upload.yml`](../.github/workflows/deploy-description-image-upload.yml) | Manual, Push | Deploys the function set in its source; see owner release lanes below. |
| <!-- atlas:action .github/workflows/deploy-f27-section4-closures.yml -->[`deploy-f27-section4-closures.yml`](../.github/workflows/deploy-f27-section4-closures.yml) | Manual | Deploys the function set in its source; see owner release lanes below. |
| <!-- atlas:action .github/workflows/deploy-hiring-applications.yml -->[`deploy-hiring-applications.yml`](../.github/workflows/deploy-hiring-applications.yml) | Manual | Deploys the function set in its source; see owner release lanes below. |
| <!-- atlas:action .github/workflows/deploy-hiring-automation.yml -->[`deploy-hiring-automation.yml`](../.github/workflows/deploy-hiring-automation.yml) | Manual | Deploys the function set in its source; see owner release lanes below. |
| <!-- atlas:action .github/workflows/deploy-onboarding-edge-functions.yml -->[`deploy-onboarding-edge-functions.yml`](../.github/workflows/deploy-onboarding-edge-functions.yml) | Manual, Push | Deploys the function set in its source; see owner release lanes below. |
| <!-- atlas:action .github/workflows/deploy-pto-edge-functions.yml -->[`deploy-pto-edge-functions.yml`](../.github/workflows/deploy-pto-edge-functions.yml) | Manual, Push | Deploys the function set in its source; see owner release lanes below. |
| <!-- atlas:action .github/workflows/deploy-single-function.yml -->[`deploy-single-function.yml`](../.github/workflows/deploy-single-function.yml) | Manual | Deploys the function set in its source; see owner release lanes below. |
| <!-- atlas:action .github/workflows/deploy-thumbnail-edge-functions.yml -->[`deploy-thumbnail-edge-functions.yml`](../.github/workflows/deploy-thumbnail-edge-functions.yml) | Manual, Push | Deploys the function set in its source; see owner release lanes below. |
| <!-- atlas:action .github/workflows/edge-function-type-ratchet.yml -->[`edge-function-type-ratchet.yml`](../.github/workflows/edge-function-type-ratchet.yml) | Push, Pull request | Ratchets edge TypeScript validation. |
| <!-- atlas:action .github/workflows/f27-post-contract-capture.yml -->[`f27-post-contract-capture.yml`](../.github/workflows/f27-post-contract-capture.yml) | Manual | Captures private F27 deploy closure evidence. |
| <!-- atlas:action .github/workflows/f27-team-rollback-proof.yml -->[`f27-team-rollback-proof.yml`](../.github/workflows/f27-team-rollback-proof.yml) | Manual, Pull request | Runs private F27 team rollback proof. |
| <!-- atlas:action .github/workflows/f42-apply-rehearsal.yml -->[`f42-apply-rehearsal.yml`](../.github/workflows/f42-apply-rehearsal.yml) | Manual, Pull request | Runs owner-gated F42 apply rehearsal. |
| <!-- atlas:action .github/workflows/f42-card-comment-import.yml -->[`f42-card-comment-import.yml`](../.github/workflows/f42-card-comment-import.yml) | Manual | Imports approved historical card comments. |
| <!-- atlas:action .github/workflows/graphics-f2-evidence.yml -->[`graphics-f2-evidence.yml`](../.github/workflows/graphics-f2-evidence.yml) | Manual, Pull request | Captures private graphics evidence. |
| <!-- atlas:action .github/workflows/graphics-f2-preflight.yml -->[`graphics-f2-preflight.yml`](../.github/workflows/graphics-f2-preflight.yml) | Manual | Runs graphics read-only preflight. |
| <!-- atlas:action .github/workflows/linear-deliverables-reconcile.yml -->[`linear-deliverables-reconcile.yml`](../.github/workflows/linear-deliverables-reconcile.yml) | Manual | Retained Linear reconciliation lane; runtime gates decide admission. |
| <!-- atlas:action .github/workflows/linear-exit-preparation-ci.yml -->[`linear-exit-preparation-ci.yml`](../.github/workflows/linear-exit-preparation-ci.yml) | Pull request | Runs isolated Linear-exit preparation proofs. |
| <!-- atlas:action .github/workflows/linear-outbound-drain.yml -->[`linear-outbound-drain.yml`](../.github/workflows/linear-outbound-drain.yml) | Manual | Retained outbound lane; live outbound flag is off. |
| <!-- atlas:action .github/workflows/monitoring-crosscheck.yml -->[`monitoring-crosscheck.yml`](../.github/workflows/monitoring-crosscheck.yml) | Manual, Cron `*/20 * * * *` | Crosschecks monitoring inputs. |
| <!-- atlas:action .github/workflows/monitoring-cutover-proof.yml -->[`monitoring-cutover-proof.yml`](../.github/workflows/monitoring-cutover-proof.yml) | Manual | Runs isolated monitoring cutover proof. |
| <!-- atlas:action .github/workflows/monitoring-deadman.yml -->[`monitoring-deadman.yml`](../.github/workflows/monitoring-deadman.yml) | Manual, Cron `*/15 * * * *` | Checks missed monitoring heartbeat. |
| <!-- atlas:action .github/workflows/n8n-execution-quota-watchdog.yml -->[`n8n-execution-quota-watchdog.yml`](../.github/workflows/n8n-execution-quota-watchdog.yml) | Manual, Cron `17 13 * * *` | Reads n8n execution quota and alerts. |
| <!-- atlas:action .github/workflows/native-intake-completion-monitor.yml -->[`native-intake-completion-monitor.yml`](../.github/workflows/native-intake-completion-monitor.yml) | Manual, Cron `12,27,42,57 * * * *` | Checks native intake completion health. |
| <!-- atlas:action .github/workflows/native-intake-completion.yml -->[`native-intake-completion.yml`](../.github/workflows/native-intake-completion.yml) | Manual, Cron `5,20,35,50 * * * *` | Drains admitted native intake jobs. |
| <!-- atlas:action .github/workflows/native-notification-monitor.yml -->[`native-notification-monitor.yml`](../.github/workflows/native-notification-monitor.yml) | Manual, Cron `2-59/5 * * * *` | Checks notification delivery health. |
| <!-- atlas:action .github/workflows/native-notification-preview.yml -->[`native-notification-preview.yml`](../.github/workflows/native-notification-preview.yml) | Manual | Previews notifications without sending. |
| <!-- atlas:action .github/workflows/native-notification-sender.yml -->[`native-notification-sender.yml`](../.github/workflows/native-notification-sender.yml) | Manual, Cron `*/5 * * * *` | Sends admitted native notifications; enable variable is true. |
| <!-- atlas:action .github/workflows/pages-site.yml -->[`pages-site.yml`](../.github/workflows/pages-site.yml) | Manual, Push, Pull request | Builds index and publishes GitHub Pages for matching source paths. |
| <!-- atlas:action .github/workflows/production-polish-gate.yml -->[`production-polish-gate.yml`](../.github/workflows/production-polish-gate.yml) | Manual, Push, Pull request, Cron `17 9 * * 1-5` | Runs production visual and interaction gate. |
| <!-- atlas:action .github/workflows/pto-ui-tests.yml -->[`pto-ui-tests.yml`](../.github/workflows/pto-ui-tests.yml) | Manual, Push, Pull request | Runs PTO browser checks. |
| <!-- atlas:action .github/workflows/rename-propagation-drain.yml -->[`rename-propagation-drain.yml`](../.github/workflows/rename-propagation-drain.yml) | Manual, Cron `*/5 * * * *` | Drains admitted rename propagation jobs. |
| <!-- atlas:action .github/workflows/samples-e2e-nightly.yml -->[`samples-e2e-nightly.yml`](../.github/workflows/samples-e2e-nightly.yml) | Manual, Cron `0 6 * * *` | Runs Samples browser journeys. |
| <!-- atlas:action .github/workflows/schedule-fallback-guard.yml -->[`schedule-fallback-guard.yml`](../.github/workflows/schedule-fallback-guard.yml) | Called by the 17 timer-dispatched workflows | First job of each: on a GitHub schedule run it stands the run down when the database timer already started that slot, so a job runs once; when the timer missed, the run goes ahead (OPEN_REPAIRS 397). |
| <!-- atlas:action .github/workflows/sheets-mirror-daily.yml -->[`sheets-mirror-daily.yml`](../.github/workflows/sheets-mirror-daily.yml) | Manual, Cron `23 9 * * *` | Copies and compares analytics mirrors; apply variable is true. |
| <!-- atlas:action .github/workflows/thumbnail-revision-scan.yml -->[`thumbnail-revision-scan.yml`](../.github/workflows/thumbnail-revision-scan.yml) | Manual, Cron `*/10 * * * *` | Scans admitted thumbnail revisions. |
| <!-- atlas:action .github/workflows/tiktok-carousel-browser-journey.yml -->[`tiktok-carousel-browser-journey.yml`](../.github/workflows/tiktok-carousel-browser-journey.yml) | Manual, Push, Pull request | Runs provider upload browser journey. |
| <!-- atlas:action .github/workflows/track-b-backup.yml -->[`track-b-backup.yml`](../.github/workflows/track-b-backup.yml) | Manual, Cron `23 */6 * * *` | Creates encrypted private backup evidence. |
| <!-- atlas:action .github/workflows/track-b-recovery-rehearsal.yml -->[`track-b-recovery-rehearsal.yml`](../.github/workflows/track-b-recovery-rehearsal.yml) | Manual | Rehearses restoration in isolated targets. |
| <!-- atlas:action .github/workflows/workload-source-freshness.yml -->[`workload-source-freshness.yml`](../.github/workflows/workload-source-freshness.yml) | Manual | Checks native workload source freshness. |


The database timer ([migrations/2026-10-09-github-workflow-dispatch-timer.sql](../migrations/2026-10-09-github-workflow-dispatch-timer.sql), OPEN_REPAIRS 388; built, not applied) dispatches every scheduled workflow above through GitHub's workflow_dispatch API at its own cron, because GitHub runs `schedule:` crons hours late; the two dead-man hosts are left on GitHub's own schedule as the independent observer. Each dispatched workflow keeps its `schedule:` block as the fallback, and its first job ([schedule-fallback-guard.yml](../.github/workflows/schedule-fallback-guard.yml)) lets that late copy run only when the timer missed the slot. It replaced the resident `lane-ticker.yml`, deleted 2026-10-09. Owner variables and concurrency gates still control each dispatched lane.


| Other repo workflow | Trigger | Purpose |
| --- | --- | --- |
| [check-brain](https://github.com/sidney-afk/synchro-brain/blob/main/.github/workflows/check-brain.yml) | Main push and pull request | Validates private knowledge files. |
| [process-syncview-change](https://github.com/sidney-afk/synchro-brain/blob/main/.github/workflows/process-syncview-change.yml) | Change-file push and manual | Claude processes admitted SyncView knowledge edits; writes private repo. |
| [atlas-freshness](https://github.com/sidney-afk/synchrosocial/blob/main/.github/workflows/atlas-freshness.yml) | Monday `0 9 * * 1`, Atlas path push and manual | Checks the marketing Atlas. |
| [deploy](https://github.com/sidney-afk/synchrosocial/blob/main/.github/workflows/deploy.yml) | Main push and manual | Builds marketing dist and publishes GitHub Pages. |


Synchro Pipelines has no workflow files at its pinned tree. Supabase and n8n schedules were inventoried separately above.


## Outside services

These purposes are source or active-graph references. Credential existence and enabled nodes are not proof that a paid provider or revoked credential works today.


| Service | Used for and owner |
| --- | --- |
| Post For Me | TikTok upload and status via [n8n registry](#n8n); native Instagram Reel upload via [function](../supabase/functions/instagram-upload/index.ts). |
| Frame.io | Video assets, review media and production automation. [Provider endpoints](truth/ENDPOINTS.md). |
| Replicate | Caption audio transcription and retained editor AI calls. [Generate Caption](#n8n). |
| Apify | Instagram and TikTok metrics, top-video and market research scraping. [Scraper owners](#n8n). |
| Anthropic | Caption, research and production text generation in n8n; private Brain edit worker. [Worker](https://github.com/sidney-afk/synchro-brain/blob/main/.github/workflows/process-syncview-change.yml). |
| Slack | Creative channels, owner error alerts and native notification delivery. [Native sender](../supabase/functions/notify/index.ts); [workflow owners](#n8n). |
| Google | Sheets roster and analytics, Drive assets and backups, Docs filming plans, Gmail onboarding and sales mail, YouTube analytics. [Write boundaries](https://github.com/sidney-afk/synchro-pipelines/blob/main/GOOGLE_WRITES.md). |
| HubSpot | Sales contacts, booking state, contract and payment gates, ad attribution. [Sales handlers](#n8n). |
| Meta | Facebook ads and conversions, Instagram provider account connection. [Ad pull and CAPI](#n8n). |
| Twilio and Telegram | Sales SMS and booking alert relays. [Recovery handlers](#n8n). |
| iClosed, Calendly, Stripe, eSignatures and Commas | Booking and application signals, invoices and contract signatures. [Event handlers](#n8n). |
| Notion and Arketa | Onboarding polling and membership reporting. [Active owners](#n8n). |
| Higgsfield, OpenAI and Google AI | Editor asset generation and model helpers. [Editor function](../supabase/functions/higgsfield-mcp/index.ts); [In-chat result viewer](../supabase/functions/higgsfield-mcp/viewer.ts). |
| Linear | Retained history and legacy branches; native production is authoritative and outbound is off. Source-only inbound/outbound functions are not live endpoints. [Exit map](independence/SYSTEM_MAP.md). |


## Secret names and locations

Names only. Values were never exported into this repo. Live GitHub and Supabase inventories verify name presence, not usability. Supabase includes protected configuration slots as well as credentials. A name in source can be optional, obsolete or inherited; it is separated from configured names below. n8n login names are exact literals, including their punctuation; credential values and IDs are omitted.


| Location | Configured names |
| --- | --- |
| client-analytics GitHub repository secrets | `ANALYTICS_MIRROR_WRITE_KEY`, `LINEAR_API_KEY`, `N8N_API_KEY`, `N8N_QUOTA_ALERT_WEBHOOK`, `NATIVE_NOTIFICATION_NOTIFY_URL`, `NATIVE_NOTIFICATION_RUNNER_KEY`, `SLACK_ALERT_WEBHOOK`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, `SYNCVIEW_STAFF_ACTOR`, `SYNCVIEW_STAFF_KEY`, `THUMBNAIL_REVISION_SCAN_KEY`, `TRACK_B_BACKUP_DATABASE_URL`, `TRACK_B_BACKUP_GOOGLE_CREDENTIALS_JSON`, `TRACK_B_BACKUP_HMAC_KEY`, `TRACK_B_RESTORE_DATABASE_URL` |
| client-analytics GitHub production environment | `B3_ACCELERATOR_DATABASE_URL`, `F27_PRIVATE_SHARED_DRIVE_ROOT_ID`, `GRAPHICS_F2_OWNER_DISPATCH_ATTESTATION`, `GRAPHICS_F2_READONLY_DATABASE_URL`, `LINEAR_MIRROR_API_KEY`, `ROLE_KEY_ADMIN`, `ROLE_KEY_CREATIVE`, `ROLE_KEY_SMM`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`, `TRACK_B_BACKUP_GOOGLE_CREDENTIALS_JSON` |
| client-analytics GitHub github-pages environment | No environment secrets returned. |
| Supabase project secrets | `ANALYTICS_MIRROR_WRITE_KEY`, `B4_TEST_PROJECT_BY_TEAM`, `B4_TEST_PROJECT_IDS`, `BRAIN_GITHUB_TOKEN`, `CLIENTS_INFO_SHEET_ID`, `CREDENTIALS_STAFF_KEY`, `GOOGLE_AI_KEY`, `GOOGLE_DRIVE_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `GRAPHIC_TITLE_API_KEY`, `GRAPHIC_TITLE_MODEL`, `GRAPHIC_TITLE_PROMPT`, `HIGGSFIELD_KEY`, `HIRING_AUTOMATION_KEY`, `HIRING_INTERVIEW_EVENT_URL`, `HIRING_INTERVIEW_EVENT_URL_VIDEO_EDITOR`, `INSTAGRAM_UPLOAD_ALLOWED_CLIENTS`, `N8N_QUIZ_CAPTURE_SECRET`, `NOTIFY_FORMAT`, `NOTIFY_PREVIEW_SLACK_USER_ID`, `NOTIFY_RUNNER_KEY`, `NOTIFY_WAKE_ENABLED`, `ONBOARDING_STAFF_KEY`, `OPENAI_KEY`, `PIPELINE_GOOGLE_KEY`, `POST_FOR_ME_API_KEY`, `ROLE_KEY_ADMIN`, `ROLE_KEY_CREATIVE`, `ROLE_KEY_SMM`, `SLACK_ALERT_WEBHOOK`, `SLACK_BOT_TOKEN`, `SUPABASE_ANON_KEY`, `SUPABASE_DB_URL`, `SUPABASE_JWKS`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, `SYNCVIEW_WRITER_STAFF_KEY`, `THUMBNAIL_REVISION_SCAN_KEY`, `WRITE_DIAGNOSTICS_ENABLED`, `WRITE_DIAGNOSTICS_RUNNER_KEY` |
| synchro-brain GitHub repository | `CLAUDE_CODE_OAUTH_TOKEN`; live name list read. |
| synchro-pipelines and synchrosocial GitHub repository secrets | No repository secret names returned. Brain and Pipelines have no GitHub environments; marketing github-pages returns no secrets. All four repos belong to a personal account, so organization secret inheritance does not apply. |


Source-only Supabase environment references absent from the live configured list: `BRAIN_BRANCH`, `BRAIN_REPO`, `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `HF_MONTHLY_CAP_USD`, `LINEAR_MIRROR_API_KEY`, `SB_REGION`, `THUMBNAIL_REVISION_MAX_BYTES`. [Source owners](../supabase/functions/) describes defaults and required inputs. GitHub workflow secret references absent from both checked repo and production environment lists: `LINEAR_STATE_UUID_MAP`, `SYNCVIEW_ROLE_KEY`, `TRACK_B_RECOVERY_SOURCE_DATABASE_URL`, `TRACK_B_RECOVERY_TARGET_DATABASE_URL`. Automatic `GITHUB_TOKEN` is issued by Actions. All exposed GitHub environments were checked; Supabase Vault has zero named secret rows. Local operator environments and unnamed keys embedded in retained n8n nodes remain private and are not an exhaustive inventory.


| n8n credential login name | Type and location |
| --- | --- |
| `Analytics mirror key` | `httpHeaderAuth` in n8n credential store. |
| `APIFY @HOUSE` | `httpQueryAuth` in n8n credential store. |
| `Arketa Partner API` | `httpCustomAuth` in n8n credential store. |
| `Bearer Auth account` | `httpBearerAuth` in n8n credential store. |
| `Calendly account` | `calendlyApi` in n8n credential store. |
| `Calendly account 2` | `calendlyApi` in n8n credential store. |
| `Calendly account 3` | `calendlyOAuth2Api` in n8n credential store. |
| `Claude` | `httpHeaderAuth` in n8n credential store. |
| `eSignatures.com (token)` | `httpQueryAuth` in n8n credential store. |
| `Facebook Graph account` | `facebookGraphApi` in n8n credential store. |
| `Gemini API` | `httpHeaderAuth` in n8n credential store. |
| `GitHub PAT â€” reconcile` | `httpHeaderAuth` in n8n credential store. |
| `Google Docs account` | `googleDocsOAuth2Api` in n8n credential store. |
| `Google Drive account` | `googleDriveOAuth2Api` in n8n credential store. |
| `Google Sheets account` | `googleSheetsOAuth2Api` in n8n credential store. |
| `Header Auth account` | `httpHeaderAuth` in n8n credential store. |
| `Hello email` | `gmailOAuth2` in n8n credential store. |
| `Hiring Automation Key` | `httpHeaderAuth` in n8n credential store. |
| `House gmail` | `gmailOAuth2` in n8n credential store. |
| `HubSpot account` | `hubspotAppToken` in n8n credential store. |
| `iClosed API, Kasper` | `httpHeaderAuth` in n8n credential store. |
| `Kasper` | `slackOAuth2Api` in n8n credential store. |
| `Kasper User Token` | `slackApi` in n8n credential store. |
| `LINEAR` | `httpHeaderAuth` in n8n credential store. |
| `n8n account` | `n8nApi` in n8n credential store. |
| `Notion OAuth2 API` | `notionOAuth2Api` in n8n credential store. |
| `OPENAI` | `httpHeaderAuth` in n8n credential store. |
| `Post For Me` | `httpBearerAuth` in n8n credential store. |
| `Replicate` | `httpHeaderAuth` in n8n credential store. |
| `Roam API` | `httpHeaderAuth` in n8n credential store. |
| `Sidney Slack account` | `slackOAuth2Api` in n8n credential store. |
| `sidney@synchrosocial` | `googleDriveOAuth2Api` in n8n credential store. |
| `Slack account 2` | `slackApi` in n8n credential store. |
| `Slack account 3` | `slackApi` in n8n credential store. |
| `Stripe account` | `stripeApi` in n8n credential store. |
| `Supabase, SyncView Calendar` | `supabaseApi` in n8n credential store. |
| `SyncView Bot` | `slackApi` in n8n credential store. |
| `SyncView Client Credentials Staff Key` | `httpHeaderAuth` in n8n credential store. |
| `Telegram â€” Booking Alerts` | `telegramApi` in n8n credential store. |
| `Twilio â€” SMS` | `twilioApi` in n8n credential store. |
| `Upload-Post` | `httpHeaderAuth` in n8n credential store. |
| `YOUTUBE` | `httpQueryAuth` in n8n credential store. |


Pipeline operator configuration is described in [the pipeline README](https://github.com/sidney-afk/synchro-pipelines/blob/main/README.md); actual local operator environments are not accessible. [Deploy manifest](../docs/ops/EF_DEPLOY_MANIFEST.md) and workflow files are the authority for required release credentials.


## Deploy lanes and owner action

Lighthouse reviews and merges this PR. This session changed no deployment, settings, workflow activation or data. An owner instruction is still required for live releases and manual writer or migration lanes.


| Lane | What deploys | What the owner does |
| --- | --- | --- |
| [Pages site](https://github.com/sidney-afk/client-analytics/actions/workflows/pages-site.yml) | client-analytics fragments rebuild index and GitHub Pages deploys matching main pushes or manual dispatch. Live Pages build type is workflow, status built. | Review and merge a source change that matches path filters; inspect Actions deploy result. Docs-only merge does not trigger this lane. |
| [Onboarding functions](https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-onboarding-edge-functions.yml) | The function list in the workflow; main path pushes or manual dispatch. | Approve the writer release; confirm function list and admission test before dispatch. F27 production-write requires its bound proof. |
| [PTO functions](https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-pto-edge-functions.yml) | `pto` only; workload-plan uses the single-function lane. | Approve function release; inspect configured path trigger or dispatch and live auth evidence. |
| [Thumbnail functions](https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-thumbnail-edge-functions.yml) | Scan and revision-read closures; resolver has no CI lane. | Approve release and inspect fingerprint and provider access; enabling scan is separate. |
| [Client review link](https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-client-review-link.yml) | `client-review-link`. | Approve and inspect exact release closure; no private share URL in public evidence. |
| [Description upload](https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-description-image-upload.yml) | `description-image-upload`. | Approve release and inspect storage and authorization proof. |
| [Hiring applications](https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-hiring-applications.yml) | `hiring-applications`. | Approve release; preserve hiring automation gates. |
| [Hiring automation](https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-hiring-automation.yml) | `hiring-automation`. | Approve release separately from turning invitation delivery on. |
| [F27 Section 4](https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-f27-section4-closures.yml) | Exactly production-write, deliverable-write and batch-write private attested closures. | Use bound private capture and owner dispatch, production approval, exact closure receipt and rollback evidence. Never substitute ordinary CLI release. |
| [Single function](https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-single-function.yml) | Only allowlisted functions chosen by manual input. | Approve the selected function, confirm manifest source closure and deployment evidence. Frozen functions are excluded from ordinary releases. |
| [Manifest operator rows](ops/EF_DEPLOY_MANIFEST.md) | Source functions without CI plus sibling pipeline functions. | Authorize reviewed operator deployment from the stated owning repo; capture exact source and live receipt. |
| [Database migrations](../migrations/) | Schema and functions; no blanket automatic apply lane. | Approve exact SQL, prestate and rollback; apply through authorized migration tooling. This Atlas applies none. |
| [n8n exit plan](plans/2026-09-30-n8n-exit-phase-2.md) | Published n8n graphs, maintained outside GitHub deploy. | Approve each live edit; private export, public-safe receipt and readback. Retirement is deactivate after proof, never delete. |
| [Marketing Pages](https://github.com/sidney-afk/synchrosocial/actions/workflows/deploy.yml) | synchrosocial main build and Pages publish. | Review and merge marketing source; inspect marketing Actions deploy. |
| [Brain worker](https://github.com/sidney-afk/synchro-brain/actions/workflows/process-syncview-change.yml) | Processes private knowledge changes; no site deployment. | Review admitted knowledge edit and worker result. Pipelines operator publishing is separate. |


## Where do I look when...


| Question | First place and next evidence |
| --- | --- |
| A save failed? | [Save problems entry](../src/index/321-kasper-dashboard-replies.js.part) and [private diagnostic reader](../supabase/functions/write-diagnostics/index.ts); [write contract](truth/SUPABASE.md#write-contract-calendarsxr-upsert-paths). Follow the screen owner to its write function and Supabase function logs. |
| A caption did not generate? | [Caption progress](../src/index/180-calendar-native-post-media.js.part); native `caption_jobs` and `caption-jobs` logs, then [Generate Caption](#n8n) execution and Frame.io or model error. |
| A client link is broken? | [Token verifier](../supabase/functions/client-token-verify/index.ts) and [Review link](../supabase/functions/client-review-link/index.ts); `clients` and `client_access` enrollment, then [client boot proof](truth/APP.md). Keep the real URL private. |
| A TikTok post failed? | [Upload screen](../src/index/300-tiktok-upload.js.part); [Submit, Status and Result workflows](#n8n), `TikTokUpload` row and Post For Me provider result. |
| An Instagram Reel failed? | [Native Instagram function](../supabase/functions/instagram-upload/index.ts) logs, `instagram_uploads` row and Post For Me job result; [owner gates](STATE_OF_THINGS.md). |
| Analytics is stale or blank? | [Receipt-aware mirror reader](../supabase/functions/analytics-read/index.ts), `analytics_ingest_receipts` and [Sheet fallback owners](#google-sheets); [migration comparison](plans/2026-09-24-sheets-to-supabase.md). |
| A card or sample vanished? | [Production writer](../supabase/functions/production-write/index.ts) or [Sample writer](../supabase/functions/sample-review-upsert/index.ts); `deliverables`, `calendar_posts`, `sample_reviews` and events; [repair ledger](ops/OPEN_REPAIRS.md). |
| A filming plan or Doc tab will not load? | [Tab gateway](../supabase/functions/filming-plan-tabs/index.ts), `filming_plan_tabs_source` flag and Google access; [plan store](../supabase/functions/filming-plans/index.ts). |
| A notification or creative channel is missing? | [Notification monitor](../.github/workflows/native-notification-monitor.yml), `production_notification_delivery_receipts` and `native_intake_jobs`; [Provisioning and Finalizer](#n8n) execution. |
| An onboarding or hiring form failed? | [Onboarding capture](../supabase/functions/onboarding-capture/index.ts) or [Hiring capture](../supabase/functions/hiring-applications/index.ts) logs and [form wrapper workflow](#n8n); `onboarding_fallback` or hiring delivery outbox. |
| Workload or PTO looks wrong? | [Workload snapshot owner](../supabase/functions/workload-plan/index.ts) and [PTO owner](../supabase/functions/pto/index.ts); `workload_issues_native_v1`, `workload_plan`, `pto_requests` and snapshot warmer job. |
| Which release or scheduled job changed this? | [Deploy lanes](#deploy-lanes-and-owner-action) and [schedule registry](#scheduled-jobs); Actions run logs, Supabase function logs or `cron.job_run_details`, n8n execution list, then [OPEN_REPAIRS](ops/OPEN_REPAIRS.md). |


## Table-creating migration inventory

Each linked file contains table-creating DDL, including retained backup and temporary tables. This is source inventory, not evidence that every statement was applied. Some files retain tables later dropped or renamed. Live relations above decide current presence. Both migration roots are checked.


| Migration file | DDL table names |
| --- | --- |
| <!-- atlas:migration migrations/2026-10-01-analytics-metrics-collect-shadow.sql -->[`migrations/2026-10-01-analytics-metrics-collect-shadow.sql`](../migrations/2026-10-01-analytics-metrics-collect-shadow.sql) | `public.analytics_metrics_shadow`, `public.analytics_post_tracking`, `public.analytics_metrics_collect_queue` (not applied) |
| <!-- atlas:migration migrations/2026-10-02-analytics-top-videos-collect-shadow.sql -->[`migrations/2026-10-02-analytics-top-videos-collect-shadow.sql`](../migrations/2026-10-02-analytics-top-videos-collect-shadow.sql) | `public.analytics_top_videos_shadow`, `public.analytics_top_videos_collect_queue` (not applied) |
| <!-- atlas:migration migrations/2026-10-06-analytics-collect-live.sql -->[`migrations/2026-10-06-analytics-collect-live.sql`](../migrations/2026-10-06-analytics-collect-live.sql) | `public.analytics_collect_daily_checks`; "edge" added to the source checks of `public.analytics_metrics`, `public.analytics_top_videos`, `public.analytics_ingest_receipts` (not applied) |
| <!-- atlas:migration migrations/2026-10-02-analytics-market-research-collect-shadow.sql -->[`migrations/2026-10-02-analytics-market-research-collect-shadow.sql`](../migrations/2026-10-02-analytics-market-research-collect-shadow.sql) | `public.analytics_market_research_collect_queue`, `public.analytics_market_research_shadow` (not applied) |
| <!-- atlas:migration migrations/2026-10-01-analytics-metrics-dedupe-quoted-empty.sql -->[`migrations/2026-10-01-analytics-metrics-dedupe-quoted-empty.sql`](../migrations/2026-10-01-analytics-metrics-dedupe-quoted-empty.sql) | `public.analytics_metrics_dedupe_log`, temporary `_twins` |
| <!-- atlas:migration migrations/2026-07-03-a1-calendar-upsert.sql -->[`migrations/2026-07-03-a1-calendar-upsert.sql`](../migrations/2026-07-03-a1-calendar-upsert.sql) | `public.calendar_post_events`, `public.syncview_runtime_flags` |
| <!-- atlas:migration migrations/2026-07-04-a4-settings-edge-functions.sql -->[`migrations/2026-07-04-a4-settings-edge-functions.sql`](../migrations/2026-07-04-a4-settings-edge-functions.sql) | `public.templates`, `public.caption_prompts` |
| <!-- atlas:migration migrations/2026-07-05-b0-linear-auth-scaffold.sql -->[`migrations/2026-07-05-b0-linear-auth-scaffold.sql`](../migrations/2026-07-05-b0-linear-auth-scaffold.sql) | `public.team_members`, `public.clients`, `public.client_access`, `public.client_access_events`, `public.syncview_auth_events`, `public.flag_flips` |
| <!-- atlas:migration migrations/2026-07-06-b1-linear-data-model.sql -->[`migrations/2026-07-06-b1-linear-data-model.sql`](../migrations/2026-07-06-b1-linear-data-model.sql) | `public.batches`, `public.deliverables`, `public.deliverable_events`, `public.mirror_outbox`, `public.linear_archive` |
| <!-- atlas:migration migrations/2026-07-09-filming-plans-source.sql -->[`migrations/2026-07-09-filming-plans-source.sql`](../migrations/2026-07-09-filming-plans-source.sql) | `public.filming_plans` |
| <!-- atlas:migration migrations/2026-07-09-thumbnail-media-revisions.sql -->[`migrations/2026-07-09-thumbnail-media-revisions.sql`](../migrations/2026-07-09-thumbnail-media-revisions.sql) | `public.thumbnail_media_revisions` |
| <!-- atlas:migration migrations/2026-07-10-smm-weekly-reports.sql -->[`migrations/2026-07-10-smm-weekly-reports.sql`](../migrations/2026-07-10-smm-weekly-reports.sql) | `public.social_media_managers`, `public.smm_weekly_reports` |
| <!-- atlas:migration migrations/2026-07-11-b4-write-attribution.sql -->[`migrations/2026-07-11-b4-write-attribution.sql`](../migrations/2026-07-11-b4-write-attribution.sql) | `public.settings_events` |
| <!-- atlas:migration migrations/2026-07-12-production-comments.sql -->[`migrations/2026-07-12-production-comments.sql`](../migrations/2026-07-12-production-comments.sql) | `public.production_comments` |
| <!-- atlas:migration migrations/2026-07-14-linear-intake-receipts.sql -->[`migrations/2026-07-14-linear-intake-receipts.sql`](../migrations/2026-07-14-linear-intake-receipts.sql) | `public.linear_intake_receipts` |
| <!-- atlas:migration migrations/2026-07-15-pto-tracker.sql -->[`migrations/2026-07-15-pto-tracker.sql`](../migrations/2026-07-15-pto-tracker.sql) | `public.pto_members`, `public.pto_requests`, `public.pto_adjustments` |
| <!-- atlas:migration migrations/2026-10-10-pto-member-setup-audit.sql -->[`migrations/2026-10-10-pto-member-setup-audit.sql`](../migrations/2026-10-10-pto-member-setup-audit.sql) | `public.pto_member_events` (append-only Member setup record, written only by `pto_set_member_start_v2`; not applied, OPEN_REPAIRS 399) |
| <!-- atlas:migration migrations/2026-07-19-workload-plan.sql -->[`migrations/2026-07-19-workload-plan.sql`](../migrations/2026-07-19-workload-plan.sql) | `public.workload_plan` |
| <!-- atlas:migration migrations/2026-07-20-f27-team-rollback.sql -->[`migrations/2026-07-20-f27-team-rollback.sql`](../migrations/2026-07-20-f27-team-rollback.sql) | `public.track_b_f27_team_fences`, `public.track_b_team_rollbacks`, `public.track_b_team_rollback_intents` |
| <!-- atlas:migration migrations/2026-07-23-f34-f53-production-attachments.sql -->[`migrations/2026-07-23-f34-f53-production-attachments.sql`](../migrations/2026-07-23-f34-f53-production-attachments.sql) | `public.production_asset_access_checks`, `public.linear_archive_asset_rescue_config`, `public.linear_archive_asset_refs` |
| <!-- atlas:migration migrations/2026-07-23-production-comment-thread-lifecycle.sql -->[`migrations/2026-07-23-production-comment-thread-lifecycle.sql`](../migrations/2026-07-23-production-comment-thread-lifecycle.sql) | `public.production_comment_read_audit`, `public.production_comment_read_budget`, `public.production_comment_mutation_receipts`, `public.production_comment_card_links`, `public.production_comment_import_conflicts` |
| <!-- atlas:migration migrations/2026-07-28-f27-write-authorization-only.sql -->[`migrations/2026-07-28-f27-write-authorization-only.sql`](../migrations/2026-07-28-f27-write-authorization-only.sql) | `public.track_b_f27_team_fences` |
| <!-- atlas:migration migrations/2026-07-28-linear-project-ids-team-shape.sql -->[`migrations/2026-07-28-linear-project-ids-team-shape.sql`](../migrations/2026-07-28-linear-project-ids-team-shape.sql) | `public.linear_project_ids_shape_migration_20260728` |
| <!-- atlas:migration migrations/2026-08-24-hiring-applications.sql -->[`migrations/2026-08-24-hiring-applications.sql`](../migrations/2026-08-24-hiring-applications.sql) | `public.hiring_applications`, `public.hiring_invite_jobs`, `public.hiring_application_events` |
| <!-- atlas:migration migrations/2026-08-24-kasper-ad-performance-unfinished-leads.sql -->[`migrations/2026-08-24-kasper-ad-performance-unfinished-leads.sql`](../migrations/2026-08-24-kasper-ad-performance-unfinished-leads.sql) | `public.kasper_ad_unfinished_leads` |
| <!-- atlas:migration migrations/2026-08-24-kasper-ad-performance-v2.sql -->[`migrations/2026-08-24-kasper-ad-performance-v2.sql`](../migrations/2026-08-24-kasper-ad-performance-v2.sql) | `public.kasper_ad_performance_by_ad_daily`, `public.kasper_ad_leads` |
| <!-- atlas:migration migrations/2026-08-24-kasper-ad-performance.sql -->[`migrations/2026-08-24-kasper-ad-performance.sql`](../migrations/2026-08-24-kasper-ad-performance.sql) | `public.kasper_ad_performance_daily` |
| <!-- atlas:migration migrations/2026-08-24-public-intake-log.sql -->[`migrations/2026-08-24-public-intake-log.sql`](../migrations/2026-08-24-public-intake-log.sql) | `public.public_intake_log` |
| <!-- atlas:migration migrations/2026-08-24-quiz-responses.sql -->[`migrations/2026-08-24-quiz-responses.sql`](../migrations/2026-08-24-quiz-responses.sql) | `public.quiz_responses`, `public.quiz_intake_log` |
| <!-- atlas:migration migrations/2026-08-27-kasper-ad-performance-multi-campaign.sql -->[`migrations/2026-08-27-kasper-ad-performance-multi-campaign.sql`](../migrations/2026-08-27-kasper-ad-performance-multi-campaign.sql) | `public.kasper_ad_campaign_daily` |
| <!-- atlas:migration migrations/2026-09-05-calendar-feedback-recovery.sql -->[`migrations/2026-09-05-calendar-feedback-recovery.sql`](../migrations/2026-09-05-calendar-feedback-recovery.sql) | `public.calendar_feedback_materializations` |
| <!-- atlas:migration migrations/2026-09-05-card-change-journal.sql -->[`migrations/2026-09-05-card-change-journal.sql`](../migrations/2026-09-05-card-change-journal.sql) | `public.card_change_journal` |
| <!-- atlas:migration migrations/2026-09-05-description-images.sql -->[`migrations/2026-09-05-description-images.sql`](../migrations/2026-09-05-description-images.sql) | `public.description_images` |
| <!-- atlas:migration migrations/2026-09-05-native-intake-reconcile.sql -->[`migrations/2026-09-05-native-intake-reconcile.sql`](../migrations/2026-09-05-native-intake-reconcile.sql) | `public.production_card_provenance` |
| <!-- atlas:migration migrations/2026-09-05-native-intake-root-manifest.sql -->[`migrations/2026-09-05-native-intake-root-manifest.sql`](../migrations/2026-09-05-native-intake-root-manifest.sql) | `public.production_intake_manifests` |
| <!-- atlas:migration migrations/2026-09-05-native-label-catalog-foundation.sql -->[`migrations/2026-09-05-native-label-catalog-foundation.sql`](../migrations/2026-09-05-native-label-catalog-foundation.sql) | `public.production_label_catalog_versions` |
| <!-- atlas:migration migrations/2026-09-06-linear-outbound-cutoff.sql -->[`migrations/2026-09-06-linear-outbound-cutoff.sql`](../migrations/2026-09-06-linear-outbound-cutoff.sql) | `public.linear_outbound_cutoff_control` |
| <!-- atlas:migration migrations/2026-09-06-native-card-materialization-boundary.sql -->[`migrations/2026-09-06-native-card-materialization-boundary.sql`](../migrations/2026-09-06-native-card-materialization-boundary.sql) | `public.production_card_materialization_receipts`, `public.production_card_materialization_ingress` |
| <!-- atlas:migration migrations/2026-09-07-legacy-intake-native-triage.sql -->[`migrations/2026-09-07-legacy-intake-native-triage.sql`](../migrations/2026-09-07-legacy-intake-native-triage.sql) | `public.legacy_intake_native_triage` |
| <!-- atlas:migration migrations/2026-09-07-native-brief-media.sql -->[`migrations/2026-09-07-native-brief-media.sql`](../migrations/2026-09-07-native-brief-media.sql) | `public.native_brief_media_occurrences` |
| <!-- atlas:migration migrations/2026-09-07-native-identifier-mint.sql -->[`migrations/2026-09-07-native-identifier-mint.sql`](../migrations/2026-09-07-native-identifier-mint.sql) | `public.production_native_identifier_mint`, `public.production_native_identifier_grants` |
| <!-- atlas:migration migrations/2026-09-09-native-client-provisioning.sql -->[`migrations/2026-09-09-native-client-provisioning.sql`](../migrations/2026-09-09-native-client-provisioning.sql) | `public.production_native_client_provisions` |
| <!-- atlas:migration migrations/2026-09-09-native-notification-outbox.sql -->[`migrations/2026-09-09-native-notification-outbox.sql`](../migrations/2026-09-09-native-notification-outbox.sql) | `public.production_notification_config`, `public.production_notification_intents`, `public.production_notification_delivery_receipts`, `public.production_notification_reconciliations` |
| <!-- atlas:migration migrations/2026-09-09-native-ordinary-receipts.sql -->[`migrations/2026-09-09-native-ordinary-receipts.sql`](../migrations/2026-09-09-native-ordinary-receipts.sql) | `public.production_native_ordinary_receipt_admissions` |
| <!-- atlas:migration migrations/2026-09-09-syncview-retirement-admission.sql -->[`migrations/2026-09-09-syncview-retirement-admission.sql`](../migrations/2026-09-09-syncview-retirement-admission.sql) | `public.syncview_retirement_admission` |
| <!-- atlas:migration migrations/2026-09-15-hiring-video-editor-role.sql -->[`migrations/2026-09-15-hiring-video-editor-role.sql`](../migrations/2026-09-15-hiring-video-editor-role.sql) | `public.hiring_practical_test_jobs` |
| <!-- atlas:migration migrations/2026-09-18-native-calendar-backfill-temp-table-clear.sql -->[`migrations/2026-09-18-native-calendar-backfill-temp-table-clear.sql`](../migrations/2026-09-18-native-calendar-backfill-temp-table-clear.sql) | `native_calendar_backfill_scope`, `native_calendar_backfill_applied` |
| <!-- atlas:migration migrations/2026-09-18-native-calendar-status-bridge.sql -->[`migrations/2026-09-18-native-calendar-status-bridge.sql`](../migrations/2026-09-18-native-calendar-status-bridge.sql) | `native_calendar_backfill_scope`, `native_calendar_backfill_applied` |
| <!-- atlas:migration migrations/2026-10-08-native-calendar-na-wins-one-client.sql -->[`migrations/2026-10-08-native-calendar-na-wins-one-client.sql`](../migrations/2026-10-08-native-calendar-na-wins-one-client.sql) | `native_calendar_backfill_scope`, `native_calendar_backfill_applied` |
| <!-- atlas:migration migrations/2026-09-23-rename-propagation.sql -->[`migrations/2026-09-23-rename-propagation.sql`](../migrations/2026-09-23-rename-propagation.sql) | `public.rename_propagation_outbox` |
| <!-- atlas:migration migrations/2026-09-23-workload-native-snapshot-cache.sql -->[`migrations/2026-09-23-workload-native-snapshot-cache.sql`](../migrations/2026-09-23-workload-native-snapshot-cache.sql) | `public.workload_snapshot_invalidation`, `public.workload_snapshot_cache` |
| <!-- atlas:migration migrations/2026-09-24-workload-native-snapshot-board-builder.VERIFY.sql -->[`migrations/2026-09-24-workload-native-snapshot-board-builder.VERIFY.sql`](../migrations/2026-09-24-workload-native-snapshot-board-builder.VERIFY.sql) | `workload_board_verify` |
| <!-- atlas:migration migrations/2026-09-25-client-profile-edits.sql -->[`migrations/2026-09-25-client-profile-edits.sql`](../migrations/2026-09-25-client-profile-edits.sql) | `public.client_profile_edits` |
| <!-- atlas:migration migrations/2026-09-25-sheets-mirror-phase1.sql -->[`migrations/2026-09-25-sheets-mirror-phase1.sql`](../migrations/2026-09-25-sheets-mirror-phase1.sql) | `public.client_profiles`, `public.analytics_metrics`, `public.analytics_top_videos`, `public.analytics_market_research_briefs`, `public.analytics_content_summaries`, `public.analytics_ingest_receipts` |
| <!-- atlas:migration migrations/2026-09-28-clients-roster-sync.sql -->[`migrations/2026-09-28-clients-roster-sync.sql`](../migrations/2026-09-28-clients-roster-sync.sql) | `public.clients_roster_sync_log` |
| <!-- atlas:migration migrations/2026-09-28-higgsfield-team-connector.sql -->[`migrations/2026-09-28-higgsfield-team-connector.sql`](../migrations/2026-09-28-higgsfield-team-connector.sql) | `public.hf_team_members`, `public.hf_generations` |
| <!-- atlas:migration migrations/2026-10-02-roster-native.sql -->[`migrations/2026-10-02-roster-native.sql`](../migrations/2026-10-02-roster-native.sql) | `public.client_profile_service_write`, `public.client_profile_archive`, `public.roster_route_enrol`, `public.smm_assign_client`, `public.roster_sheet_outbox`, `public.smm_assignment_edits` |
| <!-- atlas:migration migrations/2026-09-29-filming-plan-tabs-cache.sql -->[`migrations/2026-09-29-filming-plan-tabs-cache.sql`](../migrations/2026-09-29-filming-plan-tabs-cache.sql) | `public.filming_plan_tabs_cache` |
| <!-- atlas:migration migrations/2026-09-30-caption-jobs.sql -->[`migrations/2026-09-30-caption-jobs.sql`](../migrations/2026-09-30-caption-jobs.sql) | `public.caption_jobs` |
| <!-- atlas:migration migrations/2026-10-02-roster-stale-cleanup.sql -->[`migrations/2026-10-02-roster-stale-cleanup.sql`](../migrations/2026-10-02-roster-stale-cleanup.sql) | `public.roster_cleanup_log` (source only, not applied) |
| <!-- atlas:migration migrations/2026-10-03-onboarding-checklist-tables.sql -->[`migrations/2026-10-03-onboarding-checklist-tables.sql`](../migrations/2026-10-03-onboarding-checklist-tables.sql) | `public.onboarding_steps`, `public.client_onboarding_progress`, `public.client_onboarding_events`, `public.client_resources`, `public.client_sales_state`, `public.client_backfill_proposals` (source only, not applied) |
| <!-- atlas:migration migrations/2026-09-30-instagram-uploads.sql -->[`migrations/2026-09-30-instagram-uploads.sql`](../migrations/2026-09-30-instagram-uploads.sql) | `public.instagram_uploads` |
| <!-- atlas:migration migrations/2026-10-07-tiktok-uploads.sql -->[`migrations/2026-10-07-tiktok-uploads.sql`](../migrations/2026-10-07-tiktok-uploads.sql) | `public.tiktok_uploads`; switch `tiktok_upload_source` (NOT APPLIED) |
| <!-- atlas:migration migrations/2026-10-09-thumbnail-titles.sql -->[`migrations/2026-10-09-thumbnail-titles.sql`](../migrations/2026-10-09-thumbnail-titles.sql) | `public.thumbnail_title_prompts`, `public.thumbnail_title_queue`; switch `thumbnail_titles` (off); timer `thumbnail-titles-tick` |
| <!-- atlas:migration migrations/ai-onboarding-supabase-migration.sql -->[`migrations/ai-onboarding-supabase-migration.sql`](../migrations/ai-onboarding-supabase-migration.sql) | `public.ai_client_onboarding` |
| <!-- atlas:migration migrations/client-credentials-migration.sql -->[`migrations/client-credentials-migration.sql`](../migrations/client-credentials-migration.sql) | `public.client_credentials`, `public.client_credential_events`, `public.client_credentials_rev` |
| <!-- atlas:migration migrations/legacy-onboarding-migration.sql -->[`migrations/legacy-onboarding-migration.sql`](../migrations/legacy-onboarding-migration.sql) | `public.legacy_onboarding` |
| <!-- atlas:migration migrations/live-schema-baseline-2026-07-03.sql -->[`migrations/live-schema-baseline-2026-07-03.sql`](../migrations/live-schema-baseline-2026-07-03.sql) | `public.ai_client_onboarding`, `public.calendar_posts`, `public.client_credential_events`, `public.client_credentials`, `public.client_credentials_rev`, `public.client_onboarding`, `public.content_samples`, `public.onboarding_fallback`, `public.sales_intakes`, `public.sample_review_events`, `public.sample_reviews`, `public.tiktok_accounts`, `public.tiktok_oauth_state`, `public.tiktok_pilot_posts`, `public.workload_issues` |
| <!-- atlas:migration migrations/onboarding-fallback-supabase-migration.sql -->[`migrations/onboarding-fallback-supabase-migration.sql`](../migrations/onboarding-fallback-supabase-migration.sql) | `public.onboarding_fallback` |
| <!-- atlas:migration migrations/onboarding-supabase-migration.sql -->[`migrations/onboarding-supabase-migration.sql`](../migrations/onboarding-supabase-migration.sql) | `public.client_onboarding` |
| <!-- atlas:migration migrations/sales-intake-migration.sql -->[`migrations/sales-intake-migration.sql`](../migrations/sales-intake-migration.sql) | `public.sales_intakes` |
| <!-- atlas:migration migrations/sample-reviews-migration.sql -->[`migrations/sample-reviews-migration.sql`](../migrations/sample-reviews-migration.sql) | `public.sample_reviews`, `public.sample_review_events` |
| <!-- atlas:migration migrations/samples-supabase-migration.sql -->[`migrations/samples-supabase-migration.sql`](../migrations/samples-supabase-migration.sql) | `public.content_samples` |
| <!-- atlas:migration migrations/ttpilot-schema-migration.sql -->[`migrations/ttpilot-schema-migration.sql`](../migrations/ttpilot-schema-migration.sql) | `public.tiktok_accounts`, `public.tiktok_oauth_state`, `public.tiktok_pilot_posts` |
| <!-- atlas:migration migrations/workload-issues-supabase-migration.sql -->[`migrations/workload-issues-supabase-migration.sql`](../migrations/workload-issues-supabase-migration.sql) | `public.workload_issues` |
| <!-- atlas:migration migrations/2026-10-03-native-client-test-provision.sql -->[`migrations/2026-10-03-native-client-test-provision.sql`](../migrations/2026-10-03-native-client-test-provision.sql) | `public.production_native_client_test_provisions` (source only, not applied) |
| <!-- atlas:migration supabase/migrations/20260912174907_card_atomic_admission_preparation.sql -->[`supabase/migrations/20260912174907_card_atomic_admission_preparation.sql`](../supabase/migrations/20260912174907_card_atomic_admission_preparation.sql) | `public.card_write_admission_v1`, `public.card_write_operations_v1`, `public.card_write_followups_v1` |
| <!-- atlas:migration supabase/migrations/20260912183653_application_dml_admission_preparation.sql -->[`supabase/migrations/20260912183653_application_dml_admission_preparation.sql`](../supabase/migrations/20260912183653_application_dml_admission_preparation.sql) | `public.card_write_transaction_context_v1` |
| <!-- atlas:migration supabase/migrations/20260912203454_installation_transaction_journal_preparation.sql -->[`supabase/migrations/20260912203454_installation_transaction_journal_preparation.sql`](../supabase/migrations/20260912203454_installation_transaction_journal_preparation.sql) | `linear_exit_install.journal_v1` |
| <!-- atlas:migration supabase/migrations/20260913034324_provider_send_admission_preparation.sql -->[`supabase/migrations/20260913034324_provider_send_admission_preparation.sql`](../supabase/migrations/20260913034324_provider_send_admission_preparation.sql) | `linear_exit_provider.send_attempts_v1` |
| <!-- atlas:migration supabase/migrations/20260913035202_installation_maintenance_gate_preparation.sql -->[`supabase/migrations/20260913035202_installation_maintenance_gate_preparation.sql`](../supabase/migrations/20260913035202_installation_maintenance_gate_preparation.sql) | `linear_exit_maintenance.gate_v1` |
| <!-- atlas:migration supabase/migrations/20260913044451_write_refusal_diagnostics_preparation.sql -->[`supabase/migrations/20260913044451_write_refusal_diagnostics_preparation.sql`](../supabase/migrations/20260913044451_write_refusal_diagnostics_preparation.sql) | `write_refusal_diagnostics.receipts_v1` |
| <!-- atlas:migration supabase/migrations/20261007150000_smm_also_sees.sql -->[`supabase/migrations/20261007150000_smm_also_sees.sql`](../supabase/migrations/20261007150000_smm_also_sees.sql) | `public.smm_also_sees` |


## Verification limits and keeping this map true

Read-only evidence covers the pinned source, four repo trees, live schema metadata, function catalog, three database jobs, full n8n lists and all active graphs, configured secret names and accessible workbook metadata. It does not prove successful current provider calls, recent scheduled executions, live function byte equality or every human Sheet reader. Project Central metadata returned 403; dynamic workbook targets and private operator environments cannot be enumerated from accessible graphs. Live-only doctors-partial-capture has no traced repo deploy source. Local operator environments and unnamed retained n8n keys are not closed. No real post, caption generation, recovery send, restore, schema apply or deployment was run. These gaps require private access or explicitly authorized live proof; they are not marked passed.

[atlas-sync](../test/atlas-sync.js) runs in the [unit suite](../test/suite-classification.json). It compares both directions for edge folders including helpers, table-creating SQL in both migration roots, every workflow file and n8n IDs recorded in [N8N truth](truth/N8N.md). Missing, stale, duplicate, invisible and malformed entries fail; local links are checked. This offline test cannot detect an unrecorded live n8n or database change. After a live change, update the dated truth census and this map together from a read-only inventory. A future owner-authorized live monitor would be a separate task.
