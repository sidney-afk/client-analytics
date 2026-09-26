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

## Operational runbooks

| Document | What it helps you find |
|---|---|
| [New client onboarding](ops/NEW_CLIENT_ONBOARDING.md) | The setup checklist, including warnings about retired steps and native-provisioning gaps. |
| [New staff onboarding](ops/NEW_STAFF_ONBOARDING.md) | The staff access checklist, with retired provider steps separated from native work. |
| [Monitoring coverage](ops/MONITORING.md) | Which critical paths are watched, where alerts go, and what the dated gaps are. |
| [Section 4 capture](ops/F27_SECTION4_CAPTURE_PLAYBOOK.md) | How the owner handles the sealed rollback bundle before a manual release. |
| [Flip and recovery](ops/FLIP_RUNBOOK.md) | Historical flip procedures and the retained per-team recovery contract; check State of things first. |
