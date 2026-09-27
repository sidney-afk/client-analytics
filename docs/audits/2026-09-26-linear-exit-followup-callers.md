# Linear exit follow-up caller inventory — source only

Scope: the seven tracked `scripts/linear-exit-followup-*.mjs` files at `3f5bd46e` (`origin/main`, 2026-09-26). This is a caller map, not an execution, installation, or hosted-state check. No helper, database, provider, workflow, or service was run.

| File | Tracked code caller or source use | Classification |
|---|---|---|
| `bundle.mjs` | Imported and called by `test/linear-exit-followup-bundle.mjs`; directly runnable only through its own absolute-new-directory CLI guard (lines 72–74). | Offline bundle test; available operator preparation command. |
| `compose.mjs` | Imported by `bundle.mjs` and the two `test/helpers/followup-*-deno.mjs` workers. | Bundle source composition and isolated-test helper. |
| `endpoint.mjs` | Imported by `test/linear-exit-followup-endpoint.mjs`; its bytes are copied by `bundle.mjs` into a generated `index.ts` import. | Mock endpoint test and prepared bundle input. |
| `postgres.mjs` | Imported by both Deno test helpers; its bytes are copied by `bundle.mjs` into a generated `index.ts` import. | Isolated-test database adapter and prepared bundle input. |
| `transaction.mjs` | Imported by `worker.mjs`, both Deno test helpers, and `test/linear-exit-followup-transaction.mjs`; its bytes are copied by `bundle.mjs`. | Worker dependency, isolated-test adapter, and prepared bundle input. |
| `worker.mjs` | Imported by both Deno test helpers and `test/linear-exit-followup-worker.mjs`; its bytes are copied by `bundle.mjs` into a generated `index.ts` import. | Isolated-test worker and prepared bundle input. |
| `supervisor.mjs` | Imported by `test/linear-exit-followup-supervisor.mjs`; its own CLI dispatches only with `--run` and `LINEAR_EXIT_SUPERVISOR_ENABLED=true` (line 18). | Mocked offline test and dormant, operator-gated command. |

`scripts/linear-exit-admission-release-extension.js:17` pins the source hashes of all seven files; hashing a source path is not a runtime call. `qa/linear-exit-rehearsal/run-portable.ps1:160-186` selects four follow-up **test files**, not a direct launch of these seven modules. The two PostgreSQL test drivers list the runtime source closure and pass through the Deno test helpers. Their presence is test coverage, not production scheduling.

A two-shape search (literal family paths and broader `followup` names) found no direct invocation of these seven files in tracked `package.json` or `.github/workflows`, and no app or checked-in function source imports them. Every file has a tracked test or preparation reference, so none is wholly unreferenced. The generated bundle entrypoint calls `Deno.serve`, but it exists as source text in `bundle.mjs`; its manifest explicitly records `deployment_authorized:false`, `installed:false`, `schedule_installed:false`, and `hosted_runtime_proven:false` (`bundle.mjs:24-65`). The [supervisor runbook](../ops/LINEAR_EXIT_FOLLOWUP_SUPERVISOR.md) likewise says no schedule or deployment is installed by its preparation. Those are repository statements, not a live inventory. No file here is a safe deletion candidate on this evidence alone.
