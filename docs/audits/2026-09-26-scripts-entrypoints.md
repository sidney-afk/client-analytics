# Scripts audit: automated entry points (2026-09-26)

Source baseline: `3f5bd46e6086911ae2a7bb0d32507f03d5a44da8`. This is a repository-only inventory. It did not execute an operator script, dispatch a workflow, or measure whether a configured job still runs. Draft PR #1693 holds separate workflow run-date evidence; this report stands alone until that PR lands.

The folder has 250 tracked code, SQL, and PowerShell files, plus three README files. An exact-path scan finds 65 files named in `package.json` or `.github/workflows/*.yml`; that includes path filters, comments, and fixtures as well as commands, so it is **not** 65 proved executions. The table is a bounded sample of **confirmed command** entry points that should not be classified as unused from age or name.

| Script | Confirmed tracked caller | What the command does / disposition |
|---|---|---|
| `build-index.js`, `check-index.js` | `package.json` (`build:index`, `check:index`); `calendar-unit-tests.yml` calls the check | Assemble and verify the served page; keep. |
| `check-modules.js` | `calendar-unit-tests.yml` | Validate modular fragment syntax and assembly contract; keep. |
| `repo-identity-exposure-check.js`, `byte-pinned-line-ending-check.js` | `calendar-unit-tests.yml` | Guard public-repo identity and pinned bytes in PRs; keep. |
| `test-suite-routing.js` | `linear-exit-preparation-ci.yml` | Run the configured CI lane; keep while that workflow remains. |
| `deno-typecheck-ratchet.js` | `edge-function-type-ratchet.yml` | Check Edge Function types; keep. |
| `ef-fingerprint.js` | `deploy-single-function.yml` and other deploy workflows | Compare function source fingerprint before a deployment; keep even though this audit did not deploy. |
| `monitoring-watchdog.js` | `monitoring-deadman.yml`, `monitoring-crosscheck.yml`, and heartbeat commands in other workflows | Validate monitoring heartbeats; keep. A workflow mention alone does not prove the heartbeat still ran. |
| `assurance-ledger-freshness.js` | `assurance-ledger-freshness.yml` | Check the ledger freshness and gate result; keep. |
| `card-calendar-status-drift-check.js` | `card-calendar-status-drift.yml` | Check status drift and gate result; keep. |
| `workload-source-freshness.js` | `workload-source-freshness.yml` | Check Workload source freshness; keep. |
| `outbox-debt-census.js` | `outbox-debt-census.yml` | Count outbox debt; keep. |
| `n8n-execution-quota-watchdog.js` | `n8n-execution-quota-watchdog.yml` | Check execution quota; keep. |
| `native-intake-completion/monitor.js` | `native-intake-completion-monitor.yml` | Monitor completion state; keep. |

## Review queue, not a deletion list

A basename scan found 17 files with no named caller in a tracked workflow, package command, test, or other script. Six are **false positives** because callers import their extensionless module names: `linear-exit-complete-sequence-bounds.js`, `linear-exit-provider-send-compose.js`, `linear-exit-storage-version-capability.js`, `linear-exit-write-diagnostics-compose.js`, `native-intake-completion/completion-lib.js`, and `native-intake-reconcile/runner-lib.js`. Their exact import sites are in `scripts/` or `test/`; retain them.

The remaining 11 lack a tracked executable caller by this scan: `b4-comment-echo-probe.js`, `b4-role-key-probe.js`, `b4-write-attribution-probe.js`, `backfill-thumbnail-parent-folders.js`, `card-materialization-history-rehearsal.js`, `plpgsql-if-case-lint.js`, `prepare-urgent-editor-website-only.js`, `prod-parity-screenshots.js`, `query-shape-sweep.js`, and the v8/v9 `track-b-history-*-backup-prerequisites.sql` files. Documentation mentions them, and several are operator-only diagnostics or recovery inputs. The earlier [A3 inventory](2026-09-21-base-audit/A3-junk-inventory.md) explicitly retains multiple items after a deeper import/owner-purpose check. No deletion is proposed. The other scripts need a follow-up inventory of internal imports, test harnesses, and manual runbooks before calling them used or stale.
