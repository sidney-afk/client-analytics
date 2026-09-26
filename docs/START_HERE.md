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
