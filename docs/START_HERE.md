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
