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

## Operational status and retained records

| Document | What it covers |
| --- | --- |
| [Open repairs](ops/OPEN_REPAIRS.md) | Numbered repairs and owner decisions; use State of things for the latest verified summary. |
| [Live source differences](ops/LIVE_DIVERGENCE_REGISTER.md) | Files whose committed source differs from the live service and the checks around those exceptions. |
| [Session bootstrap](ops/SESSION_BOOTSTRAP.md) | Starting pointers for a new working session, with older integration steps kept as history. |
| [Public Submit link](ops/PUBLIC_SUBMIT_LINK.md) | Why public footage intake has its own runtime switch and how an owner checks it. |
| [Repository privacy decision](ops/REPO_PRIVATE_COST_STUDY_2026-09-24.md) | Dated hosting and CI cost research behind the decision to keep this repository public. |
| [Archived-asset rescue](ops/F34_LINEAR_ASSET_RESCUE.md) | The still-open archived-media and text rescue contract; the brief-media portion is complete. |
| [Retirement admission](ops/SYNCVIEW_RETIREMENT_RUNBOOK.md) | A prepared retirement procedure whose activation remains blocked. |
| [Private backup rehearsal](ops/TRACK_B_BACKUP.md) | Isolated backup and restore proof, with hosted recovery still unproven. |
| [Cutoff record](ops/LINEAR_CUTOFF_RUNBOOK.md) | Dated cutoff and recovery steps; State of things supersedes its old credential status. |
| [Exit execution map](ops/LINEAR_EXIT_EXECUTION_MAP.md) | The retirement program's dated step map, whose old progress counters are historical. |
| [Installation recovery](ops/LINEAR_EXIT_RECOVERY_PROCEDURE.md) | Prepared recovery choices and evidence to preserve if an installation fails; real recovery needs owner authorization. |
| [Storage custody handoff](ops/LINEAR_EXIT_STORAGE_CUSTODY_HANDOVER.md) | A dated handoff of private backup locations and operator tools that must be rechecked before use. |
| [Exit journal](ops/LINEAR_EXIT_JOURNAL.md) | The chronological decisions and observed results behind the retirement program. |
| [Safety-net install](ops/F27_INSTALL_RUNBOOK.md) | The completed installation record and source-exact rollback rules; current captures use Section 4 capture above. |
| [Install checklist](ops/F27_INSTALL_CHECKLIST.md) | A generated checklist from the historical safety-net installation, not a fresh deployment instruction. |
| [Function deploy inventory](ops/EF_DEPLOY_MANIFEST.md) | Generated source and workflow paths for functions, not a live deployment list. |
| [Write-authorization window](ops/F27_WRITE_AUTH_WINDOW.md) | The completed authorization-window record, whose old apply steps must not be rerun. |
| [CI gate audit](ops/CI_GATE_AUDIT.md) | A dated review of CI checks and their costs; inspect current workflows for today's setup. |
| [Workload source scope](ops/WORKLOAD_NATIVE_SOURCE.md) | The early native Workload rationale, with old loading and fallback details superseded. |
| [Rename plan](ops/RENAME_PLAN.md) | The original rename-propagation proposal; its plan-only status was superseded by applied releases. |

## Native capability contracts and holds

| Document | What it covers |
| --- | --- |
| [Native client setup](ops/NATIVE_CLIENT_PROVISIONING.md) | A dormant server-side setup path for new clients, with no active onboarding caller. |
| [Existing-card assignment](ops/NATIVE_EXISTING_ASSIGNMENT.md) | The original assignment draft; its unapplied banner predates native activation. |
| [Native work IDs](ops/NATIVE_IDENTIFIER_MINT.md) | How in-app work IDs are issued and the recorded correction that this change was applied. |
| [Intake completion](ops/NATIVE_INTAKE_COMPLETION.md) | Prepared recovery workflows for incomplete native intake that remain switched off. |
| [Named intake append](ops/NATIVE_INTAKE_NAMED_APPEND.md) | An uninstalled proposal for keeping post names when appending native intake work. |
| [Label catalog capture](ops/NATIVE_LABEL_CATALOG_CAPTURE.md) | The completed catalog capture record, with old recapture steps retained as history. |
| [Label catalog foundation](ops/NATIVE_LABEL_CATALOG_FOUNDATION.md) | An early source-only label-write design whose disabled status predates native activation. |
| [Native notifications](ops/NATIVE_NOTIFICATIONS.md) | The prepared notification outbox and sender design; activation remains a separate decision. |
| [Notification handover](ops/NATIVE_NOTIFICATION_HANDOVER_PREPARATION_20260912.md) | Proposed installation checks for notifications, not permission to switch them on. |
| [Ordinary receipt owners](ops/NATIVE_ORDINARY_RECEIPTS_OWNER_MATRIX.md) | Which write path owns each native receipt; its provider-default statement is historical. |
| [Ordinary receipt repair](ops/NATIVE_ORDINARY_RECEIPTS_REPAIR_SPEC.md) | The safe-receipt design and remaining retirement gate; activation is still blocked. |
| [Urgent handoff](ops/NATIVE_URGENT_HANDOFF.md) | Inactive source design for urgent video handoff and its access checks. |
| [Urgent workflow draft](ops/NATIVE_URGENT_N8N_DRAFT.md) | A superseded receiver draft kept as evidence; its new workflow must not be installed. |
| [Native Workload rollout](ops/LINEAR_EXIT_STEP26_NATIVE_WORKLOAD.md) | Dated plan for replacing Workload's old data source; check State of things for present status. |
| [Native label rollout](ops/LINEAR_EXIT_STEP26_NATIVE_LABELS.md) | Dated acceptance record for moving labels to native storage after its original blockers were resolved. |
| [Native intake rollout](ops/LINEAR_EXIT_STEP26_NATIVE_INTAKE.md) | Pre-cutoff design for closing the older intake fallback; its source snapshot is historical. |
| [Native identifier rollout](ops/LINEAR_EXIT_STEP26_NATIVE_IDENTIFIER_MINT.md) | Dated plan and evidence for native work IDs; State of things records the current capability. |
| [Native sign-off](ops/LINEAR_EXIT_NATIVE_SIGNOFF_CONTRACT.md) | Offline-tested reconciliation compatibility contract whose installation remains held. |
| [Sequence safety](ops/LINEAR_EXIT_SEQUENCE_ALLOCATION_CONTRACT.md) | A proposed rule to prevent ID collisions during recovery, not yet fully implemented. |
| [Writer package binding](ops/LINEAR_EXIT_ATOMIC_WRITER_INSTALLATION_BINDING.md) | How a prepared writer package binds to a reviewed database catalog without installing it. |

## Exit preparation evidence (September 2026)

| Document | What it covers |
| --- | --- |
| [Catalog recalibration](ops/LINEAR_EXIT_B9_CATALOG_REDERIVATION.md) | The September plan to recalculate a catalog check against a settled database state. |
| [Test routing](ops/LINEAR_EXIT_CI_ROUTING.md) | How unit and isolated tests were assigned to CI for the September exit candidate. |
| [Credential recovery](ops/LINEAR_EXIT_CREDENTIAL_RECOVERY_CONTRACT.md) | The dated local restore proof for credential tables and its hosted-recovery and custody limits. |
| [Deferred tests: final report](ops/LINEAR_EXIT_D22_AUTHORITATIVE_20260917.md) | The 2026-09-17 outcome report for deferred test suites; it records results without fixing them. |
| [Deferred tests: first pass](ops/LINEAR_EXIT_D22_DEFERRED_FIRST_PASS_20260917.md) | The preliminary 2026-09-17 test run, superseded by the final report above. |
| [External worker handover](ops/LINEAR_EXIT_EXTERNAL_WORKER_HANDOVER_PREPARATION.md) | A historical checklist for finding and stopping external workers in a separately authorized window. |
| [File-hash pin sweep](ops/LINEAR_EXIT_FILE_HASH_PIN_SWEEP_20260917.md) | The 2026-09-17 inventory of pinned file hashes and whether CI then enforced them. |
| [Final freeze design](ops/LINEAR_EXIT_FINAL_FREEZE_PREPARATION.md) | Prepared freeze design with isolated proof, not an executable release procedure. |
| [Final switch decision](ops/LINEAR_EXIT_FINAL_SWITCH_DECISION_20260912.md) | The 2026-09-12 decision allowing preparation only, without installation or activation. |
| [Follow-up supervisor](ops/LINEAR_EXIT_FOLLOWUP_SUPERVISOR.md) | A default-disabled worker supervisor design and the gates around an authorized run. |
| [Guard-count survey](ops/LINEAR_EXIT_GUARD_COUNT_SITES.md) | A survey of hard-coded count checks and possible replacements, with no fix made. |
| [Installation-day plan](ops/LINEAR_EXIT_INSTALLATION_DAY_20260914.md) | The pre-cutoff installation sequence retained as history, not today's runbook. |
| [Preinstall backup](ops/LINEAR_EXIT_NATIVE_PREINSTALL_BACKUP_PREPARATION.md) | Isolated database-backup proof and its limits, separate from any live restore. |
| [Observed pipeline rehearsal](ops/LINEAR_EXIT_OBSERVED_FULL_PIPELINE_PREPARATION.md) | A disposable-database installation rehearsal and exact comparison without release authorization. |
| [Owner before and after](ops/LINEAR_EXIT_OWNER_BEFORE_AFTER_20260914.md) | The 2026-09-14 plain-English explanation of the planned installation, now historical. |
| [Owner preparation sitting](ops/LINEAR_EXIT_OWNER_SITTING_20260915.md) | The 2026-09-15 read-only keyboard sequence for catalog and backup preparation. |
| [Preparation checkpoint](ops/LINEAR_EXIT_PREPARATION_CHECKPOINT_20260914.md) | A dated checkpoint whose earlier provider and progress details are historical. |
| [Release matrix](ops/LINEAR_EXIT_RELEASE_MATRIX_20260912.md) | The 2026-09-12 readiness matrix and evidence limits, retained after cutoff. |
| [Repair installation order](ops/LINEAR_EXIT_REPAIR_INSTALL.md) | Prepared dependency order for a repaired candidate, not permission to install it. |
| [Review repairs](ops/LINEAR_EXIT_REVIEW_REPAIRS_20260913.md) | The 2026-09-13 review-repair handoff and local proof scope, retained as preparation history. |
| [Second preparation sitting](ops/LINEAR_EXIT_SESSION_C_20260916.md) | The 2026-09-16 read-only calibration sequence for a later owner work session. |
| [Hard-coded world sweep](ops/LINEAR_EXIT_WORLD_LITERAL_SWEEP_20260916.md) | The 2026-09-16 inventory of fixed database counts and fingerprints; survey only. |

## Exit recovery and repair records

| Document | What it covers |
| --- | --- |
| [Application-schema recovery](ops/LINEAR_EXIT_PRIORITY_APPLICATION_SCHEMA_PLAN.md) | A preparation-only plan to extend isolated recovery proof to application tables. |
| [Priority recovery](ops/LINEAR_EXIT_PRIORITY_RECOVERY_CONTRACT.md) | Bounded local backup and restore evidence for priority tables, without hosted recovery proof. |
| [Comment observation](ops/LINEAR_EXIT_PROVIDER_COMMENT_OBSERVATION_PREPARATION.md) | Source-only recovery of uncertain comments from recorded reads, without resending them. |
| [Create observation](ops/LINEAR_EXIT_PROVIDER_CREATE_OBSERVATION_PREPARATION.md) | Source-only recovery of uncertain item creation from bounded read observations. |
| [Issue observation](ops/LINEAR_EXIT_PROVIDER_ISSUE_OBSERVATION_PREPARATION.md) | Source-only recovery of uncertain item changes and attachments from recorded reads. |
| [Historical receipt eligibility](ops/LINEAR_EXIT_PROVIDER_TERMINAL_HISTORY_PREPARATION.md) | Source-only rules for classifying old provider receipts, without fresh provider verification. |
| [Recorded create recovery](ops/LINEAR_EXIT_RECORDED_CREATE_RECOVERY_PREPARATION.md) | Source-only recovery for recorded batch and item creation while preserving later in-app edits. |
| [Side-by-side restore decision](ops/LINEAR_EXIT_RESTORE_TO_NEW_PROJECT_PROPOSAL.md) | The 2026-09-16 decision that a separate restored copy aids proof but is not the recovery route. |
| [Retirement switch design](ops/LINEAR_EXIT_RETIREMENT_SWITCH_PREPARATION.md) | The isolated-tested guarded switch design, without hosted activation proof. |
| [Settled-world runner proposal](ops/LINEAR_EXIT_RUNNER_SETTLED_WORLD_PROPOSAL.md) | An unapplied 2026-09-16 proposal to build the settled test database before calibration. |
| [Schedule and alert inventory](ops/LINEAR_EXIT_STEP29B_INVENTORY.md) | A read-only pre-cutoff inventory of workflow, schedule, and alert paths. |
| [Alert consolidation](ops/LINEAR_EXIT_STEP29C_ALERT_CONSOLIDATION.md) | An unapplied design for consolidating alerts after older workflows are retired. |
| [Table-name coupling](ops/LINEAR_EXIT_TABLE_NAME_COUPLING_PROPOSAL.md) | A 2026-09-16 proposal to check that four table-name references agree. |
| [Urgent link review](ops/LINEAR_EXIT_URGENT_LINK_VERIFICATION.md) | Captured-source review of urgent notification links, without proof of delivered messages. |
| [Intake receipt recovery](ops/LINEAR_INTAKE_RECOVERY.md) | Pre-cutoff steps for failed intake receipts, retained as historical recovery context. |
| [Media rescue proposal](ops/LINEAR_MEDIA_RESCUE.md) | A superseded media-copy plan; the native brief-media copy was completed later. |
| [Bounded reconciler reads](ops/LINEAR_RECONCILER_BOUNDED_READ_WINDOW.md) | A prepared 2026-08-03 installation window for bounded reads, not authorization to run it. |
| [Retired status reconciler](ops/LINEAR_SYNC_RECONCILE.md) | The former status reconciler and workflows, retired on 2026-09-22. |
| [Stray-item catcher](ops/B1_STRAY_CATCHER_DESIGN.md) | A pre-cutoff design for importing stray external work; implementation was pending when written. |
| [Server cleanup plan](ops/B2_LINEAR_CLEANUP_PLAN.md) | The 2026-09-23 cleanup inventory and record of the slices executed at that time. |
| [Client sign-off reconciliation](ops/CLIENT_SIGNOFF_RECONCILE.md) | How a committed client review is reconciled into its card after a partial update. |
| [Card-link repair](ops/CROSSWALK_REPAIR_STRATEGY.md) | The September repair strategy and execution record for card-to-deliverable links. |
| [Comment gateway rollout](ops/COMMENT_GATEWAY_ROLLOUT.md) | A dated rollout runsheet for an earlier comment entry route; check State of things before use. |
| [Retirement assertion drift](ops/RETIREMENT_ASSERT_DRIFT_2026-09-24.md) | The 2026-09-24 diagnosis and proposal later superseded by an applied repair. |

## Flip and test history

| Document | What it covers |
| --- | --- |
| [Flip staging checklist](ops/F2_STAGING_CHECKLIST.md) | The pre-cutoff staging sequence for flip test access and gates; its instructions are dated. |
| [Flip bug ledger](ops/FLIP_BUG_LEDGER.md) | August 2026 lessons from the graphics flip and checks proposed for the video flip. |
| [Flip-day test log](ops/FLIP_DAY_TEST_LOG_2026-08-30.md) | What the 2026-08-30 hands-on test observed, as dated evidence rather than current proof. |
| [Flip-day test playbook](ops/FLIP_DAY_TEST_PLAYBOOK.md) | The 2026-08-30 browser test steps for the video flip, retained as history. |
| [Flip test round two](ops/FLIP_TEST_ROUND2.md) | Follow-up journey checks after the first round found defects; a historical test plan. |
| [Flip test round three](ops/FLIP_TEST_ROUND3.md) | The 2026-08-31 asset-handling checks planned after round two. |
| [Round-three tester prompt](ops/FLIP_TEST_ROUND3_PROMPT.md) | Companion tester handoff text for the August round-three checklist. |
| [Graphics drill artifact](ops/GRAPHICS_DRILL_ARTIFACT_SETUP.md) | Dated setup for the parked test graphic used by a self-test. |
| [Graphics flip pointer](ops/GRAPHICS_FLIP_STATUS.md) | A pointer to the maintained independence status, plus an old resolved blocker. |
| [Parity-arm record](ops/PARITY_ARM_WINDOW.md) | The July 2026 switch-arming record; State of things records its later shutoff. |
| [Pre-flip health check](ops/PRE_FLIP_HEALTH_CHECK.md) | The read-only watch specification used while the graphics flip was pending. |
| [Test project mapping](ops/TEST_CLIENT_GRAPHICS_PROJECT_MAPPING.md) | A historical setup note for the test Graphics project mapping. |

## Other release and repair records

| Document | What it covers |
| --- | --- |
| [Old slot-repair proposal](ops/2026-09-24-linear-only-slot-repair.md) | A 2026-09-24 proposal retained after a dry run found zero slots to repair. |
| [Attribution guard window](ops/ATTRIBUTION_SLUG_GUARD_WINDOW.md) | Record of the 2026-08-23 guard application and its readbacks. |
| [Section 4 deploy request](ops/DEPLOY_REQUEST_2026-08-05_SECTION4.md) | A dated request for the older four-function release lane; the document itself dispatched nothing. |
| [Description image upload](ops/DESCRIPTION_IMAGE_UPLOAD.md) | The 2026-09-05 design and code record for pasted description images, with rollout steps to recheck. |
| [Frozen-writer urgent marker](ops/FROZEN_WRITER_URGENT_MARKER_DEPLOY_2026-09-10.md) | The 2026-09-10 deployment record for urgent markers in frozen writers; feature visibility was separate. |
| [Git-history privacy purge](ops/GIT_HISTORY_PII_PURGE_2026-07-14.md) | A 2026-07-14 incident-only history rewrite plan for private snapshots, not routine cleanup. |
| [Moving a card](ops/MOVE_CARD_BETWEEN_CLIENTS.md) | A 2026-08-21 manual card-move procedure whose old provider steps are historical. |
| [Quarantined cleanup draft](ops/PHASE4_CLEANUP_CHECKLIST.md) | A withdrawn Calendar cleanup recipe whose assumptions proved false; do not execute it. |
| [Slice 5 apply window](ops/SLICE5_APPLY_WINDOW.md) | The 2026-07-26 apply and deploy record, with test drills still owed when written. |
| [Write-refusal diagnostics](ops/WRITE_REFUSAL_DIAGNOSTICS_PREPARATION_20260912.md) | The 2026-09-12 diagnostic preparation, partly superseded by later source integration. |

## Plans

| Document | What it helps you find |
|---|---|
| [Version 2 plan](plans/2026-09-25-syncview-v2-plan.md) | The proposed screen-by-screen rebuild, shared data, and safe switch to a new app; plan only. |
| [Owner backlog](plans/2026-09-24-owner-backlog.md) | A September 24 capture of two requests for future plans: repository privacy and a parallel version 2 app. |
| [Sheets migration plan](plans/2026-09-24-sheets-to-supabase.md) | The phased move from spreadsheet reads to database reads; check State of things for what has shipped. |
| [Post-split roadmap](plans/2026-09-21-post-modularization-roadmap.md) | The ordered work phases after the source split and the gates for each phase. |
| [Module conversion plan](plans/2026-09-24-modularization-c3-plan.md) | The proposed order and checks for turning source fragments into modules; plan only. |
| [Original source-split plan](plans/2026-09-21-modularization-plan.md) | The strategy for a byte-preserving split of the page, written before its build tooling existed. |

## Independence program and history

| Document | What it helps you find |
|---|---|
| [System map](independence/SYSTEM_MAP.md) | A surface-by-surface map of data flow, roles, and failure paths, with older integration passages kept as history. |
| [Independence plan](independence/INDEPENDENCE_PLAN.md) | The original automation-removal and in-app replacement strategy, retained as pre-cutoff history. |
| [Webhook replacement plan](independence/N8N_REPLACEMENT_PLAN.md) | The historical inventory of webhooks that read the former tracker and their proposed replacements. |
| [Exit sequence](independence/LINEAR_EXIT_MASTER_SEQUENCE.md) | The cross-lane exit order retained as history; use State of things for current status. |

## Historical retrospective

| Document | What it helps you find |
|---|---|
| [September 20 exit retrospective](retrospectives/2026-09-20-linear-exit-retrospective.md) | A dated account of the native transition, evidence practices, and lessons for the source split; not current operating guidance. |

## Dated audit evidence (August–September 2026)

These records describe what was checked at the time, not the current operating state. Use State of things and the system references above for current status.

| Document | What it covers |
|---|---|
| [Sep 24 — speed remeasure](audits/2026-09-24-speed-map.md) | Read-only test-client warm-load and tab-switch timings compared with the September 23 map. |
| [Sep 24 — feature usage](audits/2026-09-24-feature-usage.md) | A read-only 30-day row and 24-hour function-call snapshot; zero calls in that window do not prove disuse. |
| [Sep 24 — entry tax](audits/2026-09-24-entry-tax.md) | Before-and-after boot request evidence for the early key and flag read change. |
| [Sep 24 — Analytics first content](audits/2026-09-24-analytics-blocking-requests.md) | A read-only cloud-rig request trace whose absolute timings are affected by proxy retries. |
| [Sep 23 — speed map](audits/2026-09-23-speed-map.md) | Measurement-only first-load and switch timings across fifteen tabs using a test client. |
| [Sep 23 — boot baseline](audits/2026-09-23-boot-baseline.md) | The first-load measurement method and baseline for the source-split roadmap. |
| [Sep 21 — document freshness](audits/2026-09-21-base-audit/A1-docs-freshness.md) | A source survey of guidance after the cutoff, not a fresh runtime check of every document. |
| [Sep 21 — dead-code inventory](audits/2026-09-21-base-audit/A2-dead-code-inventory.md) | Source and lexical reachability evidence with explicit limits on what may be removed. |
| [Sep 21 — file-purpose inventory](audits/2026-09-21-base-audit/A3-junk-inventory.md) | A repository-only survey of assets, scripts, tests, and folders; deletion remains a proposal. |
| [Sep 21 — onboarding eligibility](audits/2026-09-21-base-audit/A4-native-onboarding-eligibility.md) | A code trace and aggregate-only live read comparing native and retained provider assignment paths. |
| [Sep 21 — pre-deletion boot](audits/2026-09-21-base-audit/C1-boot-baseline.md) | Committed page bytes and anonymous Chromium startup measurements before browser-source deletions. |
| [Sep 15 — retirement rehearsal](audits/2026-09-15-linear-dead-rehearsal.md) | A prepared failure rehearsal and blank result form; the exercise was not run in this record. |
| [Sep 8 — composed intake apply](audits/2026-09-08-composed-intake-apply-evidence.json) | Disposable PostgreSQL 16 apply proof for a composed intake artifact, not a hosted installation. |
| [Sep 7 — urgent action UI](audits/2026-09-07-native-urgent-ui.md) | Source-only, uninstalled urgent-action preparation with synthetic transport and state checks. |
| [Sep 7 — named intake append](audits/2026-09-07-native-named-append-evidence.json) | Restored-target SQL checks and an offline composition result that was not applied in that record. |
| [Aug 5 — roster project coverage](audits/2026-08-05-roster-project-coverage.md) | A dated read-only, aggregate live-data check of project-mapping gaps before the Graphics flip. |
| [Aug 5 — comment Mark done](audits/2026-08-05-production-comment-mark-done-cas.md) | A browser-only candidate and offline race audit for the canonical-comment completion action. |
| [Aug 5 — attribution write paths](audits/2026-08-05-attribution-write-paths.md) | A source enumeration of deliverable creation and attribution stamping paths; no change was made. |
| [Aug 5 — attribution soak signal](audits/2026-08-05-attribution-stamp-soak-signal.md) | An analysis of how attribution stamps distorted the then-current drift counter and an unreleased candidate fix. |
| [Aug 4 — monitoring readiness](audits/2026-08-04-monitoring-readiness-cutover.md) | Historical pre-cutover evidence about the alert relay, watchdog, and monitoring proof lanes. |
| [Aug 2 — Graphics evidence lane](audits/2026-08-02-graphics-f2-evidence-lane.md) | Source and isolated F2 evidence-tool proof; no authority flip or live action was performed. |

## July 2026 audit evidence

These records capture checks and proposals from July. Their dated findings do not establish the current operating state; some cover superseded or operator-gated work.

| Document | What it covers |
|---|---|
| [Jul 30 — flip status](audits/2026-07-30-flip-status-review.md) | A dated, read-only status review after the Graphics flip work; no change was made by the review. |
| [Jul 29 — B3 zero gate](audits/2026-07-29-b3-zero-gate-investigation.md) | A read-only investigation of gate counters and an alarm gap at that date. |
| [Jul 28 — Graphics flip gates](audits/2026-07-28-graphics-flip-gates-report.md) | Offline and isolated evidence for five proposed gates, without a live-provider drill or authority change. |
| [Jul 23 — Production and Graphics gaps](audits/2026-07-23-production-tab-graphics-gap-audit.md) | Read-only findings and design options for the then-current Production tab and Graphics workflow. |
| [Jul 22 — staff boot and history](audits/2026-07-22-staff-boot-refresh-history-audit.md) | An immutable, public-safe audit of staff boot, refresh, history, and browser cache behavior. |
| [Jul 22 — F27 operator toolkit](audits/2026-07-22-f27-install-operator-toolkit.md) | Source-only preparation for a future owner-gated installation; it records no installation. |
| [Jul 21 — F27 corrective proof](audits/2026-07-21-f27-corrective-source-proof.md) | Source-only corrections for two identified races and a bounded drill contract. |
| [Jul 20 — F27 rollback proof](audits/2026-07-20-f27-team-rollback-proof.md) | Superseded isolated TEST proof, explicitly marked not installable. |
| [Jul 19 — vault audit](audits/2026-07-19-vault-audit.md) | A read-only review of the documentation system and its cross-repository boundaries. |
| [Jul 19 — F141 browser drill](audits/2026-07-19-f141-live-drill/README.md) | A dated owner-authorized browser drill on TEST scope, not current release proof. |
| [Jul 19 — boot and history](audits/2026-07-19-boot-refresh-history-audit.md) | A controlled browser evidence snapshot with separately labeled later source and remediation addenda. |
| [Jul 17 — PTO visual review](audits/2026-07-17-pto-lifecycle-simulation/VISUAL_REVIEW.md) | Synthetic TEST screenshots of the time-off lifecycle; no live personnel screenshots. |
| [Jul 17 — PTO simulation findings](audits/2026-07-17-pto-lifecycle-simulation/FINDINGS.md) | Synthetic time-off lifecycle findings and fixes from an isolated simulation. |
| [Jul 17 — bug archaeology](audits/2026-07-17-bug-archaeology.md) | A dated sweep of the preceding three weeks of changes and the issues it found. |
| [Jul 15 — PTO release audit](audits/2026-07-15-pto-release-audit.md) | A dated time-off release audit with source, test, and bounded read-only data evidence. |
| [Jul 11 — B4 shadow evidence](audits/2026-07-11-b4-postmerge-shadow-evidence.md) | Historical post-merge readback and a read-only full-roster shadow aggregate. |
| [Jul 11 — B3 scenario harness](audits/2026-07-11-b3-inbound-mirror-scenario-harness.md) | The scope and safeguards of a historical TEST-project scenario harness, not a current run instruction. |
| [Jul 9 — Production foundation](audits/2026-07-09-production-foundation-audit.md) | A dated audit of the read-only Production foundation against its design reference. |
| [Jul 7 — former tracker state map](audits/2026-07-07-linear-state-map.md) | A public-safe review of status and type names for the former tracker; private identifiers were not committed. |
| [Jul 6 — Production parity gaps](audits/2026-07-06-prod-parity-gaps.md) | A source and artifact comparison that seeded a then-current Production parity backlog. |
| [Jul 6 — data assumptions](audits/2026-07-06-data-assumption-sweep.md) | A sweep of unverified data assumptions and proposed checks in the then-current migration plan. |
| [Jul 5 — Supabase re-audit](audits/2026-07-05-supabase.md) | Read-only anonymous API checks of reachability and schema visibility at that date. |
| [Jul 5 — Sheets re-audit](audits/2026-07-05-sheets.md) | Read-only views and a workflow inspection of the then-current roster and editor-feed shape. |
| [Jul 5 — re-audit summary](audits/2026-07-05-reaudit-summary.md) | A dated summary of parallel read-only service and source re-audits, with their coverage limits. |
| [Jul 5 — n8n re-audit](audits/2026-07-05-n8n.md) | A read-only workflow inventory compared with the July 3 snapshot; no workflow was run or edited. |
| [Jul 5 — sync logic](audits/2026-07-05-logic-sync.md) | A source trace of the former tracker consistency, reconciliation, and workload paths. |
| [Jul 5 — Samples logic](audits/2026-07-05-logic-samples.md) | A source-only trace of then-current Samples reads and legacy behavior. |
| [Jul 5 — review logic](audits/2026-07-05-logic-reviews.md) | A source-only trace of client and staff review flows at that commit. |
| [Jul 5 — Calendar logic](audits/2026-07-05-logic-calendar.md) | A source-only trace of Calendar behavior at that commit. |
| [Jul 5 — former tracker re-audit](audits/2026-07-05-linear.md) | Read-only workspace findings that distinguish measured facts from estimates. |
| [Jul 4 — settings gate evidence](audits/2026-07-04-a4-gate-evidence.md) | Public-safe readback and review-gate evidence for the then-draft settings rollout. |
| [Jul 3 — marketing repository](audits/2026-07-03-synchrosocial-repo.md) | A source audit of the marketing site and its then-observed relationship to this app. |
| [Jul 3 — Supabase](audits/2026-07-03-supabase.md) | A dated schema and access snapshot of the repository and backend. |
| [Jul 3 — n8n](audits/2026-07-03-n8n.md) | A read-only workflow inventory with partial node-level coverage. |
| [Jul 3 — former tracker](audits/2026-07-03-linear.md) | A read-only workspace inventory that separates measured facts from estimates. |
| [Jul 3 — application code](audits/2026-07-03-code.md) | A dated source survey of app structure, deployment paths, and key flows. |
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
