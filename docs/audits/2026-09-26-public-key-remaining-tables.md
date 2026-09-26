# Remaining source-table public-key read inventory (2026-09-26)

Source baseline: `3f5bd46e6086911ae2a7bb0d32507f03d5a44da8`. The companion [explicit-grant draft](https://github.com/sidney-afk/client-analytics/pull/1708) covers 20 tables; this report checks the other 80 `public` tables created in `migrations/*.sql` and `supabase/migrations/*.sql`. The scan found 119 `CREATE TABLE` declarations: 115 `public` declarations collapse to 100 distinct table names, and four declarations name other schemas. Some SQL in those folders is preparation rather than confirmed installed schema.

At 2026-09-26 21:36 UTC, the browser public key from source made a `HEAD /rest/v1/<table>?select=<one-source-column>&limit=0` request for each of the 100 distinct source-created tables. No row body, client identifier, or table value was retrieved. Fifteen requests returned `200`, and 85 returned `401`. The 15 accepted tables are `batches`, `calendar_post_events`, `calendar_posts`, `caption_prompts`, `client_credentials_rev`, `clients`, `deliverable_events`, `deliverables`, `flag_flips`, `sample_review_events`, `sample_reviews`, `syncview_runtime_flags`, `team_members`, `templates`, and `workload_issues`. All 15 are described in the companion draft; `calendar_posts` already has a separate owner lane and is not proposed for repair here.

Every remaining source-created table returned `401` on its one-column request. `analytics_top_videos` had one transient request failure and returned `401` on the completed retry. The `Source` column gives one file declaring the table, not a proof that the file was installed.

| Table | Source | Public-key `HEAD` |
|---|---|---:|
| `ai_client_onboarding` | `migrations/ai-onboarding-supabase-migration.sql` | 401 |
| `analytics_content_summaries` | `migrations/2026-09-25-sheets-mirror-phase1.sql` | 401 |
| `analytics_ingest_receipts` | `migrations/2026-09-25-sheets-mirror-phase1.sql` | 401 |
| `analytics_market_research_briefs` | `migrations/2026-09-25-sheets-mirror-phase1.sql` | 401 |
| `analytics_metrics` | `migrations/2026-09-25-sheets-mirror-phase1.sql` | 401 |
| `analytics_top_videos` | `migrations/2026-09-25-sheets-mirror-phase1.sql` | 401 |
| `calendar_feedback_materializations` | `migrations/2026-09-05-calendar-feedback-recovery.sql` | 401 |
| `card_change_journal` | `migrations/2026-09-05-card-change-journal.sql` | 401 |
| `card_write_admission_v1` | `supabase/migrations/20260912174907_card_atomic_admission_preparation.sql` | 401 |
| `card_write_followups_v1` | `supabase/migrations/20260912174907_card_atomic_admission_preparation.sql` | 401 |
| `card_write_operations_v1` | `supabase/migrations/20260912174907_card_atomic_admission_preparation.sql` | 401 |
| `card_write_transaction_context_v1` | `supabase/migrations/20260912183653_application_dml_admission_preparation.sql` | 401 |
| `client_access` | `migrations/2026-07-05-b0-linear-auth-scaffold.sql` | 401 |
| `client_access_events` | `migrations/2026-07-05-b0-linear-auth-scaffold.sql` | 401 |
| `client_credential_events` | `migrations/client-credentials-migration.sql` | 401 |
| `client_credentials` | `migrations/client-credentials-migration.sql` | 401 |
| `client_onboarding` | `migrations/live-schema-baseline-2026-07-03.sql` | 401 |
| `client_profile_edits` | `migrations/2026-09-25-client-profile-edits.sql` | 401 |
| `client_profiles` | `migrations/2026-09-25-sheets-mirror-phase1.sql` | 401 |
| `description_images` | `migrations/2026-09-05-description-images.sql` | 401 |
| `hiring_application_events` | `migrations/2026-08-24-hiring-applications.sql` | 401 |
| `hiring_applications` | `migrations/2026-08-24-hiring-applications.sql` | 401 |
| `hiring_invite_jobs` | `migrations/2026-08-24-hiring-applications.sql` | 401 |
| `hiring_practical_test_jobs` | `migrations/2026-09-15-hiring-video-editor-role.sql` | 401 |
| `kasper_ad_campaign_daily` | `migrations/2026-08-27-kasper-ad-performance-multi-campaign.sql` | 401 |
| `kasper_ad_leads` | `migrations/2026-08-24-kasper-ad-performance-v2.sql` | 401 |
| `kasper_ad_performance_by_ad_daily` | `migrations/2026-08-24-kasper-ad-performance-v2.sql` | 401 |
| `kasper_ad_performance_daily` | `migrations/2026-08-24-kasper-ad-performance.sql` | 401 |
| `kasper_ad_unfinished_leads` | `migrations/2026-08-24-kasper-ad-performance-unfinished-leads.sql` | 401 |
| `legacy_intake_native_triage` | `migrations/2026-09-07-legacy-intake-native-triage.sql` | 401 |
| `legacy_onboarding` | `migrations/legacy-onboarding-migration.sql` | 401 |
| `linear_archive` | `migrations/2026-07-06-b1-linear-data-model.sql` | 401 |
| `linear_archive_asset_refs` | `migrations/2026-07-23-f34-f53-production-attachments.sql` | 401 |
| `linear_archive_asset_rescue_config` | `migrations/2026-07-23-f34-f53-production-attachments.sql` | 401 |
| `linear_intake_receipts` | `migrations/2026-07-14-linear-intake-receipts.sql` | 401 |
| `linear_outbound_cutoff_control` | `migrations/2026-09-06-linear-outbound-cutoff.sql` | 401 |
| `linear_project_ids_shape_migration_20260728` | `migrations/2026-07-28-linear-project-ids-team-shape.sql` | 401 |
| `mirror_outbox` | `migrations/2026-07-06-b1-linear-data-model.sql` | 401 |
| `native_brief_media_occurrences` | `migrations/2026-09-07-native-brief-media.sql` | 401 |
| `onboarding_fallback` | `migrations/live-schema-baseline-2026-07-03.sql` | 401 |
| `production_asset_access_checks` | `migrations/2026-07-23-f34-f53-production-attachments.sql` | 401 |
| `production_card_materialization_ingress` | `migrations/2026-09-06-native-card-materialization-boundary.sql` | 401 |
| `production_card_materialization_receipts` | `migrations/2026-09-06-native-card-materialization-boundary.sql` | 401 |
| `production_card_provenance` | `migrations/2026-09-05-native-intake-reconcile.sql` | 401 |
| `production_comment_card_links` | `migrations/2026-07-23-production-comment-thread-lifecycle.sql` | 401 |
| `production_comment_import_conflicts` | `migrations/2026-07-23-production-comment-thread-lifecycle.sql` | 401 |
| `production_comment_mutation_receipts` | `migrations/2026-07-23-production-comment-thread-lifecycle.sql` | 401 |
| `production_comment_read_audit` | `migrations/2026-07-23-production-comment-thread-lifecycle.sql` | 401 |
| `production_comment_read_budget` | `migrations/2026-07-23-production-comment-thread-lifecycle.sql` | 401 |
| `production_comments` | `migrations/2026-07-12-production-comments.sql` | 401 |
| `production_intake_manifests` | `migrations/2026-09-05-native-intake-root-manifest.sql` | 401 |
| `production_label_catalog_versions` | `migrations/2026-09-05-native-label-catalog-foundation.sql` | 401 |
| `production_native_client_provisions` | `migrations/2026-09-09-native-client-provisioning.sql` | 401 |
| `production_native_identifier_grants` | `migrations/2026-09-07-native-identifier-mint.sql` | 401 |
| `production_native_identifier_mint` | `migrations/2026-09-07-native-identifier-mint.sql` | 401 |
| `production_native_ordinary_receipt_admissions` | `migrations/2026-09-09-native-ordinary-receipts.sql` | 401 |
| `production_notification_config` | `migrations/2026-09-09-native-notification-outbox.sql` | 401 |
| `production_notification_delivery_receipts` | `migrations/2026-09-09-native-notification-outbox.sql` | 401 |
| `production_notification_intents` | `migrations/2026-09-09-native-notification-outbox.sql` | 401 |
| `production_notification_reconciliations` | `migrations/2026-09-09-native-notification-outbox.sql` | 401 |
| `pto_adjustments` | `migrations/2026-07-15-pto-tracker.sql` | 401 |
| `pto_members` | `migrations/2026-07-15-pto-tracker.sql` | 401 |
| `pto_requests` | `migrations/2026-07-15-pto-tracker.sql` | 401 |
| `public_intake_log` | `migrations/2026-08-24-public-intake-log.sql` | 401 |
| `quiz_intake_log` | `migrations/2026-08-24-quiz-responses.sql` | 401 |
| `quiz_responses` | `migrations/2026-08-24-quiz-responses.sql` | 401 |
| `rename_propagation_outbox` | `migrations/2026-09-23-rename-propagation.sql` | 401 |
| `sales_intakes` | `migrations/live-schema-baseline-2026-07-03.sql` | 401 |
| `settings_events` | `migrations/2026-07-11-b4-write-attribution.sql` | 401 |
| `syncview_auth_events` | `migrations/2026-07-05-b0-linear-auth-scaffold.sql` | 401 |
| `syncview_retirement_admission` | `migrations/2026-09-09-syncview-retirement-admission.sql` | 401 |
| `tiktok_accounts` | `migrations/live-schema-baseline-2026-07-03.sql` | 401 |
| `tiktok_oauth_state` | `migrations/live-schema-baseline-2026-07-03.sql` | 401 |
| `tiktok_pilot_posts` | `migrations/live-schema-baseline-2026-07-03.sql` | 401 |
| `track_b_f27_team_fences` | `migrations/2026-07-20-f27-team-rollback.sql` | 401 |
| `track_b_team_rollback_intents` | `migrations/2026-07-20-f27-team-rollback.sql` | 401 |
| `track_b_team_rollbacks` | `migrations/2026-07-20-f27-team-rollback.sql` | 401 |
| `workload_plan` | `migrations/2026-07-19-workload-plan.sql` | 401 |
| `workload_snapshot_cache` | `migrations/2026-09-23-workload-native-snapshot-cache.sql` | 401 |
| `workload_snapshot_invalidation` | `migrations/2026-09-23-workload-native-snapshot-cache.sql` | 401 |

A `401` proves that the **tested route and column** did not accept this key at that time. It does not prove that the relation exists in live Postgres, that every other column is denied, or that a privileged role cannot read it. The public OpenAPI catalog endpoint also returned `401`, so this source inventory cannot discover live-only tables, effective default grants, or current exposed-schema settings. The source scan found no `ALTER DEFAULT PRIVILEGES` statements in these two migration folders. A schema owner should use a privileged read-only catalog query to close those gaps before calling the live inventory exhaustive.

The source-backed cross-client concern remains the 15 accepted table routes and the three public views in the companion draft. This follow-up finds no additional accepted table route among the 80 source-created tables it checks. It changes no policy, grant, data, or function.
