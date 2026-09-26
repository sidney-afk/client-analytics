# Start here: SyncView documentation

Browse the core documents by topic below. Read [State of things](STATE_OF_THINGS.md)
first for checked operational status; it takes precedence over older plans and
historical passages. Each reference document states when and how it was checked.
For a specific question, use [Find anything](FIND_ANYTHING.md).

## Orientation and navigation

| Document | What it helps you find |
|---|---|
| [State of things](STATE_OF_THINGS.md) | The dated list of open work, deliberate holds, and work already completed. |
| [Find anything](FIND_ANYTHING.md) | A question-led route to the document that owns a fact. |
| [Session briefing](truth/BRIEFING.md) | A first-session explanation of the app, its sources of truth, and its safety rules. |
| [Repository map](../REPO_MAP.md) | Where the code, tests, and documentation live. |

## System references

| Document | What it helps you find |
|---|---|
| [Reference-doc contract](truth/README.md) | How the living system references are checked and updated. |
| [App behavior](truth/APP.md) | What the app does on its main screens and where that behavior lives. |
| [Endpoint inventory](truth/ENDPOINTS.md) | Which external services the app calls and where those calls come from. |
| [Database and functions](truth/SUPABASE.md) | Tables, runtime settings, functions, and write contracts. |
| [Workflow inventory](truth/N8N.md) | Workflow roles and recorded on/off state, with dated verification scope. |
| [Sheet inventory](truth/SHEETS.md) | Sheet tabs, roster fields, and client lookup rules. |
| [Linear history](truth/LINEAR.md) | Former integration terms and data shapes; use State of things for the current cutoff. |

## Product and design

| Document | What it helps you find |
|---|---|
| [Client lifecycle map](CLIENT_LIFECYCLE_MAP.md) | The journey from first contact to production, with older migration passages marked as historical. |
| [Quality tiers](QUALITY_TIERS.md) | The reliability promise for each part of the app. |
| [UI design standards](features/UI_DESIGN_STANDARDS.md) | Requirements for controls, explanations, keyboard use, touch, and mobile layouts. |
| [Production design kit](syncview-design/README.md) | The current screen contract and the separate frozen prototype evidence. |

## Owner vision and documentation design

| Document | What it helps you find |
|---|---|
| [The step back](vision/STEP_BACK_2026-07-18.md) | The owner's rationale for shared company-and-software documentation and small, connected research slices. |
| [Repository-map improvement pass](vision/IMPROVEMENT_PASS_2026-07-20.md) | A proposal to make the repository map easier to scan while keeping current-state ownership clear. |

## Testing and assurance

| Document | What it helps you find |
|---|---|
| [Testing map](testing/README.md) | Which test suites and checks run, and what each one proves. |
| [Assurance ledger](testing/ASSURANCE_LEDGER.md) | When each product surface was last proven and where proof has expired or is missing. |
| [Calendar test catalog](testing/CALENDAR-TEST-CATALOG.md) | The scenarios to check across staff, client, and reviewer Calendar controls; its live probes need separate authorization. |
| [Headless testing guide](testing/HEADLESS-TESTING-GUIDE.md) | How browser probes exercise the served app and live backend, including the test-client boundary. |
| [Production polish automation](testing/PRODUCTION_POLISH_AUTOMATION.md) | The Production check suite, screenshot packet, and limits of each test lane. |

## Production design references

| Document | What it helps you find |
|---|---|
| [Wired parity ledger](syncview-design/WIRED-PARITY.md) | The current Production UI capability and visual comparison ledger, with older provider claims marked historical. |
| [Adapter contract](syncview-design/ADAPTER.md) | How native database rows become the Production view model and where writes are gated. |
| [Design test map](syncview-design/tests/README.md) | Runnable design checks and the boundary between live reads and mocked writes. |
| [Frozen design tokens](syncview-design/linear-design-tokens.md) | Dated visual measurements used by the prototype; not a current runtime rule. |
| [Frozen prototype](syncview-design/SyncView.html) | The preserved visual reference that must be judged against current app behavior. |

### Quarantined prototype pointers

These files retain old names to redirect readers; none is a current runbook.

| Document | What it helps you find |
|---|---|
| [Prototype continuation](syncview-design/CONTINUATION.md) | A safe redirect from an obsolete prototype-session continuation to current design references. |
| [Design-session handoff](syncview-design/HANDOFF.md) | A safe redirect from an old design handoff to the current design and test guides. |
| [Prototype parity loop](syncview-design/PARITY-LOOP.md) | A safe redirect from the old parity loop to the living parity ledger and tests. |
| [Prototype parity checklist](syncview-design/PARITY.md) | A frozen checklist that points to current parity and adapter references. |

## Feature contracts

| Document | What it helps you find |
|---|---|
| [Clean addresses](features/CLEAN_URLS.md) | How readable page addresses map to older links without losing navigation context. |
| [Dark mode](features/dark-mode.md) | Staff-only theme rules, colors, rollback, and visual checks. |
| [Time off](features/PTO_TRACKER.md) | The live leave-request and admin policy, with proposed changes marked separately. |
| [Filming plans](features/FILMING_PLANS_DESIGN.md) | The filming-plan view, its data sources, and the documented read-access limits. |
| [Weekly reports](features/SMM_WEEKLY_REPORTS.md) | The staff report and reviewer screens, including access limits and release notes. |
| [Hiring process](features/HIRING_PROCESS.md) | Application capture and invitation flow; State of things has the latest sender status. |
| [Component feedback](features/COMPONENT_FEEDBACK.md) | A source-only draft for showing mapped review feedback beside a production component. |
| [Ad performance](features/KASPER_AD_PERFORMANCE.md) | The read-only campaign dashboard and the data that feeds it. |
| [Review state](features/KASPER_REVIEW_GLOBAL_ROLLOUT.md) | How review handoff and close state persist across refreshes and devices. |
| [Onboarding form](features/ONBOARDING_FORM.md) | Captured answers, the staff inbox, and the blockers that keep full onboarding from go-live. |
| [Onboarding backup](features/ONBOARDING_FALLBACK.md) | How draft and submit backups preserve answers while completion remains unproved. |
| [Older onboarding forms](features/LEGACY_ONBOARDING.md) | How original-form records are shown and which access gates remain open. |
| [Onboarding readers](features/ONBOARDING_EDGE_MIGRATION.md) | The move to Edge list readers and the identity and access gaps still open. |
| [Sales intake](features/SALES_INTAKE_DESIGN.md) | The deployed intake and paperwork handoff, with its go-live blockers. |
| [Thumbnail refresh token](features/THUMBNAIL_CACHE_ROLLOUT.md) | The persisted refresh token for ordinary image writes and the limits of that earlier contract. |
| [Thumbnail revisions](features/THUMBNAIL_REVISION_HISTORY.md) | Current image refresh and previous/current comparison behavior across viewers. |
| [Title review](features/YOUTUBE_TITLE_REVIEW_DESIGN.md) | Title approval and feedback routing, including an open stale-approval case. |

## Feature proposals and history

| Document | What it covers |
| --- | --- |
| [Credential vault design](features/CLIENT_CREDENTIALS_DESIGN.md) | A historical access design with open security blockers, not approval to operate the vault. |
| [Footage handoff proposal](features/CLIENT_FOOTAGE_SUBMISSION.md) | An unbuilt proposal to simplify how clients hand off filmed content. |
| [Time-off implementation handoff](features/PTO_TRACKER_HANDOFF.md) | Original leave-tracker decisions and examples; use Time off above for current behavior. |
| [Samples go-live record](features/SAMPLES_GO_LIVE.md) | A dated launch checklist kept as evidence; its steps are no longer operating instructions. |
| [Samples parity log](features/SAMPLES_PARITY_LOG.md) | The append-only build history and mirror registry, with older integration claims kept as history. |
| [Samples rebuild spec](features/SAMPLES_REBUILD_SPEC.md) | The historical rebuild blueprint, whose flag and integration steps are no longer operative. |
| [Samples rebuild strategy](features/SAMPLES_REBUILD_STRATEGY.md) | The dated build approach and source map; use current contracts for runtime behavior. |
| [TikTok pilot audit pack](features/TIKTOK_PILOT_AUDIT.md) | A proposed posting-review pack that remains disabled and is not ready for submission. |

## Operational runbooks

| Document | What it helps you find |
|---|---|
| [New client onboarding](ops/NEW_CLIENT_ONBOARDING.md) | The setup checklist, including warnings about retired steps and native-provisioning gaps. |
| [New staff onboarding](ops/NEW_STAFF_ONBOARDING.md) | The staff access checklist, with retired provider steps separated from native work. |
| [Monitoring coverage](ops/MONITORING.md) | Which critical paths are watched, where alerts go, and what the dated gaps are. |
| [Section 4 capture](ops/F27_SECTION4_CAPTURE_PLAYBOOK.md) | How the owner handles the sealed rollback bundle before a manual release. |
| [Flip and recovery](ops/FLIP_RUNBOOK.md) | Historical flip procedures and the retained per-team recovery contract; check State of things first. |

## Plans

| Document | What it helps you find |
|---|---|
| [Version 2 plan](plans/2026-09-25-syncview-v2-plan.md) | The proposed screen-by-screen rebuild, shared data, and safe switch to a new app; plan only. |
| [Sheets migration plan](plans/2026-09-24-sheets-to-supabase.md) | The phased move from spreadsheet reads to database reads; check State of things for what has shipped. |
| [Post-split roadmap](plans/2026-09-21-post-modularization-roadmap.md) | The ordered work phases after the source split and the gates for each phase. |
| [Module conversion plan](plans/2026-09-24-modularization-c3-plan.md) | The proposed order and checks for turning source fragments into modules; plan only. |

## Independence program and history

| Document | What it helps you find |
|---|---|
| [System map](independence/SYSTEM_MAP.md) | A surface-by-surface map of data flow, roles, and failure paths, with older integration passages kept as history. |
| [Independence plan](independence/INDEPENDENCE_PLAN.md) | The original automation-removal and in-app replacement strategy, retained as pre-cutoff history. |
| [Webhook replacement plan](independence/N8N_REPLACEMENT_PLAN.md) | The historical inventory of webhooks that read the former tracker and their proposed replacements. |
| [Exit sequence](independence/LINEAR_EXIT_MASTER_SEQUENCE.md) | The cross-lane exit order retained as history; use State of things for current status. |

### Native work and data links

| Document | What it helps you find |
|---|---|
| [Create-post intake model](independence/CREATE_POST_INTAKE_MODEL.md) | The locked product model for creating batches and deliverables, with older provider routing marked as history. |
| [Samples native creation](independence/SAMPLES_NATIVE_CREATE_PLAN.md) | The implementation record for creating Samples batches through native writes. |
| [Samples legacy removal](independence/SAMPLES_LEGACY_REMOVAL_MAP.md) | The phased old-Samples route map and the client-link boundary that blocks treating removal as complete. |
| [F42 comment import](independence/F42_CARD_COMMENT_IMPORT_RUNBOOK.md) | The linked-card comment import method, completed-run evidence, and limits on further runs. |
| [F42 linkage investigation](independence/F42_CARD_DELIVERABLE_LINKAGE_REPORT.md) | The read-only investigation of cards whose deliverable link could not support comment import. |
| [F42 link repair plan](independence/F42_LINKAGE_DEFECT_REPAIR_PLAN.md) | A non-authorizing proposal for repairing mismatched card-to-deliverable links. |
| [Native intake mapping](independence/NATIVE_INTAKE_PROJECT_MAPPING.md) | The old project-mapping readiness check and its pointer to the newer native provisioning contract. |

### Program decisions and cutover records

| Document | What it helps you find |
|---|---|
| [Graphics flip status](independence/GRAPHICS_FLIP_STATUS.md) | The dated graphics coordination snapshot and its cutover gates; use State of things for current status. |
| [Go-live checklist](independence/GO_LIVE_CHECKLIST.md) | The original cutover gates, retained as historical evidence rather than current instructions. |
| [B4 readiness](independence/B4_READINESS.md) | Gate evidence and owners for the earlier B4 bridge to writable Production. |
| [Track A specification](independence/TRACK_A_EDGE_FUNCTIONS_SPEC.md) | The historical design for moving interactive writes from workflows to Edge Functions. |
| [Track B specification](independence/TRACK_B_LINEAR_REPLACEMENT_SPEC.md) | The phased design for in-app production management, with pre-cutoff status preserved. |
| [Exit handoff](independence/LINEAR_EXIT_HANDOFF.md) | The dated session handoff and then-open exit work, retained as history. |
| [Exit lane map](independence/LINEAR_EXIT_LANES.md) | The parallel work lanes and file ownership rules used during exit preparation. |
| [Cutover touchpoints](independence/LINEAR_CUTOVER_TOUCHPOINT_INVENTORY.md) | A dated inventory of former tracker reads and writes across the app and services. |

### Preparation and recovery evidence

| Document | What it helps you find |
|---|---|
| [Asset-reference coverage](independence/LINEAR_EXIT_ASSET_REFERENCE_COVERAGE_20260912.md) | How an offline adapter compares captured application references with restored object bytes. |
| [Atomic-save checkpoint](independence/LINEAR_EXIT_ATOMIC_SAVE_CHECKPOINT_20260912.md) | The earlier isolated save proof and its pointer to later recovery evidence. |
| [Recovery and export checkpoint](independence/LINEAR_EXIT_RECOVERY_AND_EXPORT_CHECKPOINT_20260912.md) | A dated checkpoint for transaction recovery and data-export preparation. |
| [Complete-data rehearsal](independence/LINEAR_EXIT_COMPLETE_DATA_CHECKPOINT_20260912.md) | Isolated complete-application-data reconstruction evidence and its limits. |
| [Consolidated checkpoint](independence/LINEAR_EXIT_CONSOLIDATED_CHECKPOINT_20260912.md) | The consolidated preparation snapshot and its pointer to later handoff evidence. |
| [Control-record recovery](independence/LINEAR_EXIT_CONTROL_RECOVERY_20260912.md) | Isolated recovery checks for private control records and their source pins. |
| [Provider recovery](independence/LINEAR_EXIT_PROVIDER_RECOVERY_20260912.md) | Prepared paths for reconciling acknowledged provider effects without assuming a retry is safe. |
| [Observed target calibration](independence/LINEAR_EXIT_OBSERVED_FULL_CALIBRATION_20260912.md) | Disposable-database comparison of the captured schema with the proposed installation target. |

### Earlier audits and migration designs

| Document | What it helps you find |
|---|---|
| [Cutover findings](independence/CUTOVER_AUDIT_2026-07-13.md) | The dated findings register behind the former cutover gates and decisions. |
| [Edge migration design](independence/EDGE_FUNCTIONS_MIGRATION.md) | A superseded workflow-to-Edge design for two older handlers; its steps are not current instructions. |
| [Comment backfill record](independence/LINEAR_COMMENT_BACKFILL_PLAYBOOK.md) | The completed comment-history import and withdrawn rollback, preserved as history rather than a rerun guide. |
| [Phase 0 audit](independence/PHASE0_AUDIT_2026-07-28.md) | The July classification of unchecked early launch gates against evidence available then. |
| [Phase 2 merge review](independence/PHASE2_MERGE_READINESS_2026-07-16.md) | The dated whole-system review of an earlier dark merge and its required fixes. |
| [Slack-to-Roam audit](independence/SLACK_ROAM_MIGRATION_AUDIT.md) | The June inventory of Slack dependencies and a proposed move to Roam; audit only. |

### Exit handoffs and lane briefs

The six lane briefs preserve clipped historical instructions. Their links help
locate evidence; they are not safe instructions to execute.

| Document | What it helps you find |
|---|---|
| [Original agent prompt](independence/CODEX_PROMPT.md) | The preserved two-track migration kickoff prompt, not a current work order. |
| [Workload lane brief](independence/LINEAR_EXIT_BRIEF_A.md) | The historical Workload-native lane assignment and its restoration notes. |
| [Write-path lane brief](independence/LINEAR_EXIT_BRIEF_B.md) | The historical write-path lane assignment and its restoration notes. |
| [Endpoints lane brief](independence/LINEAR_EXIT_BRIEF_C.md) | The historical endpoints-and-Submit lane assignment and its restoration notes. |
| [Feedback lane brief](independence/LINEAR_EXIT_BRIEF_D.md) | The historical comments-and-feedback lane assignment and its restoration notes. |
| [Media lane brief](independence/LINEAR_EXIT_BRIEF_E.md) | The historical media-rescue lane assignment and its restoration notes. |
| [Cutoff lane brief](independence/LINEAR_EXIT_BRIEF_F.md) | The historical cutoff-and-watchers lane assignment and its restoration notes. |
| [September 11 handoff](independence/LINEAR_EXIT_CLAUDE_HANDOFF_20260911.md) | The then-current preparation source and open questions at the first continuation handoff. |
| [September 12 handoff](independence/LINEAR_EXIT_CLAUDE_HANDOFF_20260912.md) | The dated reviewer handoff for the preparation build and its separate acceptance gates. |
| [September 14 resume](independence/LINEAR_EXIT_CLAUDE_RESUME_20260914.md) | The later preparation entrypoint and then-open owner decisions; historical. |
| [Fast-finish plan](independence/LINEAR_EXIT_FAST_FINISH_PLAN_20260912.md) | The dated plan linking preparation owners, isolated proofs, and the installation hold. |

### Retained preparation checkpoints

| Document | What it helps you find |
|---|---|
| [Composition checkpoint](independence/LINEAR_EXIT_COMPOSITION_CHECKPOINT_20260912.md) | The source inventory and isolated composition checks recorded on September 12. |
| [Observed schema and journal](independence/LINEAR_EXIT_OBSERVED_BASELINE_AND_JOURNAL_20260912.md) | The captured starting schema and isolated installation-journal rehearsal. |
| [September 10 recovery checkpoint](independence/LINEAR_EXIT_RECOVERY_CHECKPOINT_20260910.md) | An earlier restore and preparation snapshot, superseded by later handoffs. |

## Archived migrations and incidents

These records explain earlier decisions and failures. Their dated status claims are not current operating instructions.

| Document | What it helps you find |
|---|---|
| [June migration audit](archive/AUDIT_2026-06-15.md) | The June 15 Calendar and Samples migration readback and the source decisions it recorded then. |
| [June Calendar audit](archive/AUDIT-2026-06-18.md) | The June 18 staff and client Calendar defects, fixes, and test evidence. |
| [July system audit](archive/AUDIT-2026-07-03.md) | A dated survey of the app, automation, backend, and release risks. |
| [Calendar QA audit](archive/CALENDAR_QA_AUDIT_2026-06-20.md) | The June cross-surface browser scenarios and the defects they exposed. |
| [Calendar migration plan](archive/CALENDAR_REALTIME_MIGRATION.md) | The original move from Sheet reads to database reads and live updates. |
| [Calendar Phase 2 handoff](archive/CALENDAR_V2_AUDIT_HANDOFF.md) | The earlier audit brief and open questions for the Calendar migration. |
| [Calendar Phase 3 handoff](archive/CALENDAR_V2_HANDOFF_2026-06-14.md) | A dated session handoff for finishing the Calendar source switch. |
| [Migration cleanup record](archive/CLEANUP_2026-06-29.md) | The late-June cleanup changes, checks, and rollback notes. |
| [Browser testing evaluation](archive/HEADLESS_TESTING_EVAL_2026-06-26.md) | An assessment of nightly browser tests, monitoring, and evidence limits at that time. |
| [Status drift incident](archive/LINEAR_DRIFT_INCIDENT_2026-06-19.md) | Why a missed provider event left a card status stale for hours. |
| [Save latency investigation](archive/N8N_SAVE_LATENCY_AUDIT_2026-06-15.md) | The June investigation of delayed saves and proposed workflow fixes. |
| [Phase 3 audit prompt](archive/PHASE3_AUDIT_PROMPT.md) | A superseded session prompt for completing the Calendar migration. |
| [Pages redeploy note](archive/REDEPLOY_2026-07-03.md) | A dated GitHub Pages deployment failure and its recovery evidence. |
| [Samples parity plan](archive/SAMPLES_PARITY_PLAN.md) | The approved build plan for matching Samples review to Calendar behavior. |
| [Samples migration kickoff](archive/SAMPLES_SUPABASE_KICKOFF.md) | The original three-phase plan for moving Samples from Sheets to the database. |
| [Samples v2 plan](archive/SAMPLES_V2_PLAN.md) | An earlier proposal for rebuilding Samples with its former provider integration. |
| [Thumbnail drift incident](archive/THUMBNAIL_DESYNC_INCIDENT_2026-06-24.md) | The deeper cause of a thumbnail and provider-status mismatch. |
| [Track B audit handoff](archive/TRACK_B_FABLE5_HANDOFF.md) | A historical planning brief for replacing the former provider work surface. |
| [Workload latency audit](archive/WORKLOAD_REFRESH_AUDIT_2026-06-17.md) | The former provider-backed Workload refresh delay and its proposed fix. |

## Archived Samples test evidence

| Document | What it helps you find |
|---|---|
| [Divergence catalog](archive/qa/DIVERGENCE_REPORT.md) | Differences between Samples and Calendar, with their historical dispositions. |
| [Parity coverage ledger](archive/qa/PARITY_LEDGER.md) | The interactions and rendered states compared during the Samples parity work. |
| [Parity test report](archive/qa/PARITY_REPORT.md) | How the old parity harness compared the two review surfaces. |
| [Live-update status report](archive/qa/SAMPLES_REALTIME_STATUS.md) | The status propagation bug, fix, and multi-view checks. |
| [Scenario suite report](archive/qa/SCENARIO_REPORT.md) | The 51 multi-actor Samples scenarios and their dated results. |
| [Response-time report](archive/qa/TEMPORAL_REPORT.md) | Historical click, save, flicker, and reload measurements for Samples. |
