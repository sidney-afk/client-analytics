# Native intake manifest test-tool callers (2026-09-26)

Source baseline: `3f5bd46e6086911ae2a7bb0d32507f03d5a44da8` (`origin/main`). This source-only inventory covers the eleven code files under `scripts/native-intake-manifest/`; its README is documentation. It is separate from draft #1709's `native-intake-reconcile/` and `native-intake-completion/` inventory. No lane, database, workflow, or live service was run.

No tracked `package.json` command or `.github/workflows/` step directly names a code file in this folder. Four lane files are launched by named tests; other files are imported, read as source into a runner, or mentioned only in prose. A registered test is a configured caller, not proof that CI or a disposable database ran recently.

| Code file | Tracked caller and role |
|---|---|
| `assignee-lane.mjs` | Spawned by `test/native-assignee-eligibility.js`; also read as the source template by `editor-projection-lane.mjs` and `existing-assignment-lane.mjs`. This is a direct local test lane, not three independent commands. |
| `editor-projection-journeys.mjs` | `editor-projection-lane.mjs` reads and appends its source to the reviewed loader. It is a journey fragment, not a standalone command or an ES module import. |
| `editor-projection-lane.mjs` | Spawned by `test/native-intake-editor-projection.js`; local test entry point. |
| `editor-projection-shim.mjs` | Loaded into the two wrapper-generated runners in place of `fault-shim.mjs`; `qa/linear-exit-rehearsal/harness/sdk.mjs` also imports it. Shared test transport, not a direct command. |
| `existing-assignment-journeys.mjs` | Read and appended by `existing-assignment-lane.mjs`; journey fragment, not a standalone command. |
| `existing-assignment-lane.mjs` | Spawned by `test/native-existing-assignment.js`; local test entry point. |
| `fault-shim.mjs` | Imported by `assignee-lane.mjs` for one-read fault injection. The editor/existing wrappers rewrite that import to the editor projection shim; this file is a helper, not their direct entry point. |
| `gateway-lane.mjs` | Spawned by `test/native-intake-manifest.js`; local test entry point. |
| `harness.js` | Required by the four named test launchers and many other PostgreSQL tests; `scripts/card-history-integrated-rehearsal.js` also imports its fixture. Shared disposable-cluster helper, not a command. |
| `native-only-lane.mjs` | No tracked executable caller found. At the source baseline, the folder README prescribed `test/native-only-intake.js`, but that file does not exist; the other source hits are comments or documentation. Keep for owner-purpose review rather than deleting from an absence search. |
| `supabase-shim.mjs` | Imported by the gateway/assignee/native-only lanes, both fault shims, other local scripts, and QA/test harnesses (including native-intake reconcile). Shared SQL-backed test transport, not an unused script. |

The README's stale command is corrected in this PR without guessing a replacement. Three links there to dated audits absent from this checkout are also replaced with existing test/report paths. Its mentions of `assignee-lane.mjs` and `harness.js` are not themselves callers. Searches used both full folder paths and bare basenames with `rg`, then a tracked-file `git grep` and the loader source reads/rewrite sites. The one absent tracked caller is a source finding, not proof of no off-repo/manual use or a reason to remove the lane.
