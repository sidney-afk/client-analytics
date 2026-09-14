# Claude resume: Linear exit preparation

> **Owner decision, 2026-09-14: NO CLIENT NOTIFICATIONS.** Client-facing notifications are outside the requested Linear-exit rollout. Do not send, test-send, enable, configure for delivery, or replay queued notifications to any client/channel through this migration. Roster access and earlier destination/exclusion decisions were preparation only and do not authorize delivery. Installation, activation or retirement approval does not override this decision. Keep client delivery disabled; do not require a client message to satisfy an acceptance gate. Internal staff/operator alerts are a separate, unapproved scope until exact recipients, content, triggers and channels are agreed. Before any release involving notify or its callers, prove all client-delivery paths remain disabled, including scheduled sends, gateway wakeups and backlog replay; existing tests and documentation alone do not prove that hosted behavior. This documentation change does not modify existing live automations.

Continue from draft [PR #1391](https://github.com/sidney-afk/client-analytics/pull/1391), branch `prep/linear-exit-review-fixes-20260913`. Inspect its current head and checks before making a readiness claim. PR #1382 is historical. Do not restart the audit or substitute an older snapshot for this candidate.

The owner wants a short, efficient installation path after preparation is verified. Publication to reviewed branches/draft PRs is authorized. No merge (including local merge), deployment, installation, manual workflow dispatch, production writes, notification sends or n8n run/edit is authorized. Read-only checks and isolated rehearsals are permitted. Keep public content free of secrets, client identities and share tokens.

The owner additionally said never to send anything to client Slack channels. The designated client roster is read-only input for preparing mappings, not permission to send tests or notifications. Any delivery test must use a separately approved internal TEST destination. The owner-selected recovery record is in iOS Notes, with phone access personally confirmed; do not require a new password manager or second keyholder.

## Start with these files

1. `../ops/LINEAR_EXIT_REVIEW_REPAIRS_20260913.md`: repaired review findings, staged-schema browser compatibility, owner decisions and the remaining real-world checklist.
2. `../ops/LINEAR_EXIT_CI_ROUTING.md`: exact test coverage, historical failed/cancelled runs, corrections and separate required proof profiles. Consult current PR checks for later executions; skipped profiles are not passing profiles.
3. `../ops/LINEAR_EXIT_NATIVE_PREINSTALL_BACKUP_PREPARATION.md` and `LINEAR_EXIT_NATIVE_ONLINE_SEQUENCE_PG17_20260914.json` (current), with `LINEAR_EXIT_NATIVE_PREINSTALL_BACKUP_PG17_20260913.json` retained historically: actual pre-install public-schema backup adapter, private-input invocation, source pins and populated/observed 67-table isolated restore proofs.
4. `LINEAR_EXIT_OBSERVED_FULL_PIPELINE_20260913.json` and `../ops/LINEAR_EXIT_OBSERVED_FULL_PIPELINE_PREPARATION.md`: existing final 48-source/55-chunk installation plan, exact runtime pins and interruption/resume proof. Later browser/test changes are not a new full installation rehearsal.
5. `LINEAR_EXIT_RETIREMENT_SWITCH_PG17_20260913.json` and `LINEAR_EXIT_CONTROL_RETIREMENT_PROOF_20260913.json`: refreshed final-ACL switch and 94-table/32-routine recovery proofs.
6. `LINEAR_EXIT_LIVE_PRECHECK_20260913.json`: dated live-read catalog and aggregate notification/asset findings. Refresh time-sensitive observations before action.

## Decisions already authorized

- Narrow internal atomic Calendar/Samples preparation, preserving existing links, payload compatibility and tokenless access. No new auth gate.
- Keep verified native receipts; final retirement requires zero Linear-bound work and unresolved debt, not deletion of successful native receipts.
- The specific three-field browser-audit exception in root `AGENTS.md`, approved 2026-09-14. It requires a verified safe fallback and retains all unrelated errors, page-error checks and mutation guards. Do not ask again for that same exception.
- Google Drive for encrypted backup custody; the owner alone holds the recovery record separately. The recovery record was generated privately and the owner confirmed phone access through iOS Notes. Actual encrypted public-database capture and isolated restoration passed; the package was uploaded to a new private Drive folder. The owner-downloaded Drive ZIP matched the original SHA-256 and restored successfully into a second isolated database; the owned scratch server then stopped.

## Remaining execution work

**Treat the eventual merge as a live release action.** Read-only verification of GitHub Pages found legacy publishing from `main:/`; merging changes the served browser. This PR also changes the onboarding deployment workflow, which matches its own main-push filter and can run its existing eight-function staff deployment lane, subject to its environment. Default-branch schedules also change. Do not describe merging as having no live effect. Coordinate it with the explicitly authorized installation window and the existing release prerequisites. The two census business schedules are now prepared as opt-in; dormant host heartbeats are not evidence that a census ran.

Actual 67-table public-database capture and isolated restoration passed on 2026-09-14, and encrypted Drive upload was verified private. The downloaded Drive copy also restored exactly; refresh the time-sensitive backup/catalog before the eventual installation window as needed. Public-schema backup does not cover non-public Supabase platform state or external file bytes; account for those explicitly.

Complete real asset access/preservation. Earlier notification mappings are historical only and superseded for rollout use by the owner decision above. Do not enable client notifications or treat delivery as an unmet client acceptance requirement. Internal monitoring/alerts need separately agreed recipients and behavior; no sender is authorized.

Use the existing phase separation: `LINEAR_EXIT_FAST_FINISH_PLAN_20260912.md` and `../ops/LINEAR_EXIT_RELEASE_MATRIX_20260912.md` require classified baseline and recoverable pre-state before dormant installation, then capability-specific hosted acceptance before activation, and required asset custody/handover before retirement. Do not turn incomplete historical Drive/Frame custody into an invented blanket dormant-install gate, or silently waive its later requirements. After the applicable recovery and compatibility prerequisites, obtain authorization for the exact dormant installation; follow pinned unmerged SQL/readback/preflight before live merge and one chosen Edge release lane in `../ops/LINEAR_EXIT_REPAIR_INSTALL.md`. Keep authority, workers and capability flags unchanged until their separate acceptance. External-worker shutdown/debt closure and actual Linear retirement are a later, separate step. Do not stop workers during preparation. Local green tests do not authorize installation.

## Local material

- Checkout: `D:/Sidney/Codex/2026-09-13-linear-exit-review-fixes`.
- Current private logs/captures: `D:/Sidney/Codex/2026-09-13-final-review-repairs`.
- Earlier exact schema/routine inputs and receipts: `D:/Sidney/Codex/2026-09-12-fast-finish-evidence`.

These private directories are not GitHub artifacts. Use sanitized hashes/counts in public reports. If unavailable, identify the exact missing input instead of silently reconstructing or substituting evidence.

## Latest custody outcome

Actual public-database backup: captured, encrypted, uploaded privately, owner downloaded, SHA-256 matched, and second isolated restore passed for all 67 tables/rows/archived sequences; scratch server stopped. Recovery record phone access is owner-confirmed. Private receipts are `real-preinstall-capture-receipt.private.json`, `drive-downloaded-database-restore-receipt.private.json` and `owner-custody-confirmations-20260914.private.json` under the current private directory.

Storage: a signed 1,045-object inventory passed, but first encrypted export refused a request and the bounded export-only attempt correctly refused source drift to 1,047 objects. No complete encrypted Storage copy or off-device Storage custody is proven. Do not reuse stale inventory as current or weaken its final check. Plan a fresh capture in a stable source window under the relevant authorization.

Private notification configuration is `notification-configuration-manifest-20260914.private.json`; exact unresolved file assessments are `drive-exception-recovery-assessment-20260914.private.json` and its Markdown companion. These are not public GitHub inputs or authorization to send messages.

## Actions still needing explicit owner agreement

Preparation/publication is not approval for the following live actions:

- Merge/release: Pages updates the live browser, and the onboarding workflow can automatically deploy eight staff functions on the merge. Review that full effect, not just the Linear gateway.
- Database/function installation: schema, routine, trigger and access changes affect a running service even when native feature flags remain off. Select the exact SQL and Edge-function release scope, including any notify dependency and its verified no-client-delivery configuration.
- Native activation: moving work ownership from Linear to SyncView, enabling background workers, scheduled writes, gateway wakeups or new automation requires its own scope. Internal staff/operator messages are not implicitly approved.
- Maintenance/pauses and recovery: pausing submissions, freezing writes, stopping workers, replaying jobs, or restoring data over accepted newer saves requires an explicit window and concrete recovery decision. Do not stop n8n or unrelated workflows under a generic Linear-exit instruction.
- File decisions: missing-file exceptions, substitutions, link changes, broader uploads/sharing or retention changes are not approved by choosing the existing private encrypted-backup route.
- Retirement: shutting off Linear integrations, revoking credentials, deleting webhooks/workflows, cancelling billing or deleting the workspace/data are separate decisions; preserve native receipts.
- Client access: do not change existing tokenless Calendar/Samples links or add a login gate under this migration.

These are proposed/restricted actions found in the strategy, not actions already performed or approvals already granted. Existing live automation behavior has not been exhaustively audited by this documentation review.
