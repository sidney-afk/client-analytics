# Native intake script callers (2026-09-26)

Source baseline: `3f5bd46e6086911ae2a7bb0d32507f03d5a44da8`. This is a second bounded slice of the `scripts/` audit after draft PR #1702. It follows all ten files in `scripts/native-intake-reconcile/` and `scripts/native-intake-completion/` through imports, tests, and workflow commands. No CLI, workflow, database, or live endpoint was run.

| Script | Tracked caller and purpose | Disposition |
|---|---|---|
| `native-intake-reconcile/run.js` | `test/native-intake-reconcile-cli.js` runs the manual, dry-run-first wrapper; it imports `runner-lib.js`. | Keep as a reviewed operator entry point. |
| `native-intake-reconcile/runner-lib.js` | Both `run.js` wrappers and the completion monitor import the bounded RPC runner/transport. | Keep shared implementation. |
| `native-intake-reconcile/reconcile-lib.js` | Runner, completion monitor, completion alias, and the disposable lane import its reconcile protocol/summary checks. | Keep shared implementation. |
| `native-intake-reconcile/lane.mjs` | `test/native-intake-reconcile.js` runs the disposable PostgreSQL journey; the completion lane imports it. | Keep offline proof lane. |
| `native-intake-reconcile/load-gateway.mjs` | Reconcile lane and card-history fixtures import the repository gateway loader. | Keep test support. |
| `native-intake-reconcile/load-writers.mjs` | Reconcile lane, card-atomic test, and Linear-exit rehearsal harness use the repository writer loader. | Keep test support. |
| `native-intake-completion/run.js` | `.github/workflows/native-intake-completion.yml` runs it with `--apply`; the CLI test runs it against mocks. It imports the canonical runner. | Keep active workflow entry point; never run as an audit check. |
| `native-intake-completion/monitor.js` | `.github/workflows/native-intake-completion-monitor.yml` runs the health observer; the health test imports its limits. | Keep active read-only monitor entry point. |
| `native-intake-completion/lane.mjs` | `test/native-intake-completion.js` runs this alias, which imports the canonical reconcile lane. | Keep compatibility proof entry. |
| `native-intake-completion/completion-lib.js` | `test/native-intake-completion-cli.js` and the health test import this alias of the canonical library. | Keep compatibility import. |

The earlier [A3 file inventory](2026-09-21-base-audit/A3-junk-inventory.md) correctly marked `runner-lib.js` and `completion-lib.js` as extensionless-import false positives. This caller graph confirms that all ten files have a tracked use, but it does **not** prove a configured workflow recently ran or that a manual CLI remains operational in production. No file is proposed for deletion. The rest of `scripts/` still needs separate family-by-family classification.
