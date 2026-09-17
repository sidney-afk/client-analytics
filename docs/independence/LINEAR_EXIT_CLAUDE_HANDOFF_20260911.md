# Linear exit: Claude continuation handoff

The owner requested a stop to conserve Codex usage and continue in Claude.
This is a preparation handoff, not approval to implement in production.

## Start here

- Repository: sidney-afk/client-analytics.
- Draft PR: https://github.com/sidney-afk/client-analytics/pull/1382
- Branch: integration/linear-exit-current-main-20260910.
- Last code commit: 9701c3a480c43428b92fd44fcad2507e1ec22b50.
  This handoff is a subsequent documentation commit on the same branch.
- Read AGENTS.md, docs/FIND_ANYTHING.md, docs/truth/BRIEFING.md, then this
  handoff and LINEAR_EXIT_RECOVERY_CHECKPOINT_20260910.md. Do not restart the
  historical audit. Verify branch/head and working tree before acting.
- The long checkpoint contains dated milestones. Older unbuilt/unproven claims
  can be superseded by later scoped evidence; none imply blanket readiness.

## Authorization that still applies

Prepare/review code, strategy and sanitized evidence on GitHub branches/draft PRs.
NO merge, deployment, workflow dispatch, production writes, or n8n execution/edit.
Production implementation comes later with explicit owner authorization.
Preserve frozen tokenless calendar-upsert and sample-review-upsert contracts.
Do not re-gate them. No secrets, client display names or share tokens in public
artifacts. Private recovery packages, keys and raw evidence remain private.
Installation remains HOLD. The Linear-removal objective is not complete.

## Current build and evidence

The integrated repair build is now in GitHub; do not assume the original bundle
or old scratch directory is required just to resume code work.

- Native sign-off: protected service-only read-only verifier in
  migrations/2026-09-11-native-signoff-verifier.sql passed 43 isolated PG17 checks
  from actual native client writes. Admission SELECT stays revoked.
- scripts/client-signoff-reconcile.js now uses fresh verifier results during
  initial reads and pre-write revalidation. The helper preserves string bigint
  IDs, microsecond ordering and row snapshots across asynchronous verification.
  Missing verification is reported as unresolved work. 39 focused offline checks
  and 165 existing checks pass. Those transport responses are synthetic; the
  combined real-SQL reader/planner/revalidation rehearsal is NOT done.
- Verifier is still a separate isolated supplement, not added to the pinned
  installation inventory/preflight. No hosted function was installed.
- Evidence: LINEAR_EXIT_NATIVE_SIGNOFF_VERIFIER_20260911.json and
  LINEAR_EXIT_NATIVE_SIGNOFF_INTEGRATION_20260911.json. Contract:
  ../ops/LINEAR_EXIT_NATIVE_SIGNOFF_CONTRACT.md.
- Upstream through fcebb856 was previously integrated. Only four exact files
  from newer main ca91d26a were subsequently carried forward: sign-off script,
  tests, runbook and dispatch-only workflow. This is NOT all of newer main.
  See LINEAR_EXIT_UPSTREAM_SIGNOFF_20260911.json. No workflow was dispatched.

Earlier prepared evidence remains revision-scoped: ordered installation/resume/
interruption, 52-table parent + nine priority tables + three credential tables,
sequence bounds, native identifiers and encrypted triple recovery. Read their
linked JSON receipts for exact scope. The remaining 22 observed table contracts,
complete schema/platform equivalence, off-device/key custody and hosted recovery
remain open. No broad suite was rerun at the final code commit.

## Freeze findings that must survive this handoff

The outbox lock blocks batch-description writes via their shared authority guard.
However, actual captured Calendar v49 status and event writes pass through that
lock under service_role in isolated SQL. A second controlled test proves HTTP
success and the card commit precede delayed event SQL; releasing it persists the
event. HTTP completion therefore cannot establish complete write drain.

See LINEAR_EXIT_RETIREMENT_FREEZE_20260911.json,
LINEAR_EXIT_CALENDAR_FREEZE_20260911.json,
LINEAR_EXIT_CALENDAR_DEFERRED_20260911.json and
../ops/LINEAR_EXIT_FINAL_FREEZE_PREPARATION.md. Exact source ACL/comment-RPC
supplements are disclosed; these are not fresh hosted serving/schema proofs.
Captured Calendar v49 is the positive serving contract. Repository Calendar 401
remains the negative control; do not change frozen writers to make it pass.

Ordinary native receipts and their retirement recognizer already exist. The
activation RPC still unconditionally refuses. B5 literally requires zero outbox
rows while prepared native receipts intentionally remain there; do not silently
reinterpret that checkbox as zero provider debt. Resolution belongs to the
future owner-reviewed release plan.

## Next bounded work

1. Test actual SQL-integrated native sign-off reading, verification, planning and
   pre-write revalidation. Use only synthetic isolated data and refused external
   transport. Include changed/missing receipt, later reopen within one millisecond,
   missing verifier, complete-batch failure, and provider regression cases.
2. Integrate the verifier into the source inventory/preflight with reviewed owner
   order and appropriate isolated installation/recovery checks. Do not assert the
   prior inventory already includes it.
3. Continue final admission/drain design across frozen handlers and active service
   callers, including the sign-off reconciler. Revalidation followed by Calendar
   POST is still non-atomic; this integration does not fix that write race.
4. Continue remaining preservation/custody, archive/object completeness, hosted
   configuration/recovery and notification-handover gates. WR-101 remains a
   separate future Edge Function release. No n8n runs.

## Local execution notes

Workspace used: C:/Users/Sidney/Documents/Codex/2026-09-10-linear-exit-continuation.
Private receipts: sibling 2026-09-10-continuation-evidence directory.
Portable runner: qa/linear-exit-rehearsal/run-portable.ps1; native-signoff uses
PG17. Preinstalled binaries were in sibling
2026-09-09-repair-evidence/postgres17/pgsql/bin. Docker was unavailable; do not
factory-reset it. Verify local paths instead of assuming another machine has them.
Runner rejects inherited hosted database/proof environment; clear only offending
variable names in the child shell, never print their values.

Quick offline checks: node test/client-signoff-native-verification.js and
node test/client-signoff-reconcile.js. CLI fixture syntax is --fixtures=path,
not a positional --fixtures path. Keep fixture subprocess credentials empty.
All disposable servers used for the published receipts were stopped. No test or
agent needs to keep running after this handoff.
