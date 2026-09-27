# Provider preparation script callers (2026-09-26)

Source baseline: `3f5bd46e6086911ae2a7bb0d32507f03d5a44da8`. This is the ten-file `scripts/linear-exit-provider-*` family, a bounded continuation of the [scripts entrypoint draft](https://github.com/sidney-afk/client-analytics/pull/1702). The 2026-09-26 [state summary](../STATE_OF_THINGS.md) says the old outbound function is gone and Linear keys were revoked. This audit did not re-read those live conditions, run an operator script, or infer whether someone used a file outside the repository.

No member of this family is named by a `package.json` command or a `.github/workflows` command. A tracked path mention is not an execution: several recovery tests merely pin source bytes, while other tests actually import the module. The owner should not delete these as unused solely because there is no scheduled command.

| Script under `scripts/` | Tracked caller or reference | Purpose and disposition |
|---|---|---|
| `linear-exit-provider-send-compose.js` | `test/linear-exit-provider-send.js` calls `compose`; `linear-exit-provider-send-v2-compose.js` imports it. | Builds prepared handler source without deploying; retain as a dependency. |
| `linear-exit-provider-send-v2-compose.js` | Recovery/observation tests list it in source-pin arrays; `docs/ops/LINEAR_EXIT_PROVIDER_ISSUE_OBSERVATION_PREPARATION.md` records its checkout bytes. No tracked command or test calls `compose` here. | Prepared variant and custody reference; review with its owner before any removal. |
| `linear-exit-provider-create-observation.mjs` | Imported by three sibling observation/recovery modules and by `test/linear-exit-provider-create-observation.js` plus its transport test. | Shared read-query and transport contract; retain. |
| `linear-exit-provider-comment-observation.mjs` | Imported by `test/linear-exit-provider-comment-observation.js` and its transport test. | Comment observation contract; retain. |
| `linear-exit-provider-issue-observation.mjs` | Imported by `test/linear-exit-provider-issue-observation.js` and its transport test. | Issue observation contract; retain. |
| `linear-exit-provider-recorded-create-recovery.mjs` | Imported by `test/linear-exit-provider-recorded-create-recovery.js`; sibling tests also pin its bytes. | Recorded-create recovery helper; retain for its isolated proof. |
| `linear-exit-provider-create-recovery.mjs` | Imported by `test/linear-exit-provider-create-recovery.js`. | Create recovery helper; retain for its isolated proof. |
| `linear-exit-provider-comment-recovery.mjs` | Imported by `test/linear-exit-provider-comment-recovery.js`. | Comment recovery helper; retain for its isolated proof. |
| `linear-exit-provider-checkpoint-recovery.mjs` | Imported by `test/linear-exit-provider-checkpoint-recovery.js`. | Checkpoint recovery helper; retain for its isolated proof. |
| `linear-exit-provider-ack-recovery.mjs` | Imported by `test/linear-exit-provider-ack-recovery.js`. | Acknowledgement recovery helper; retain for its isolated proof. |

The recovery and observation integration tests require the local `F63_REQUIRE_POSTGRES=1` disposable PostgreSQL lane, not the ordinary unit lane. Three transport tests are separately registered in `test/suite-classification.json`. The ten scripts have tracked source or test relationships, but no current automated repository command. This is a source-use classification, not live execution proof or a deletion authorization. No code, migration, function, workflow, or live system changed.
