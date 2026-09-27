# B4 script callers and cutoff context (2026-09-26)

Source baseline: `3f5bd46e6086911ae2a7bb0d32507f03d5a44da8`. This checks all eight tracked `scripts/b4-*` files, after the broad [scripts entrypoint draft](https://github.com/sidney-afk/client-analytics/pull/1702). The [current state summary](../STATE_OF_THINGS.md) records outbound off, the old outbound function gone, and Linear credentials revoked. That state was not re-read live for this report. A file's test caller does not make its old operator procedure current.

None of the eight is directly named by a package command or workflow command. Five are imported by tracked unit tests; three have documentation references but no tracked executable caller found across package commands, workflows, tests, or other scripts.

| Script under `scripts/` | Tracked caller or reference | Review disposition |
|---|---|---|
| `b4-linear-comment-backfill.js` | `test/b4-linear-comment-backfill.js` imports it; `docs/independence/LINEAR_COMMENT_BACKFILL_PLAYBOOK.md` describes the historical import. | Keep the tested dry-run/apply contract as history. Its own header says a new apply needs a new owner-reviewed runbook and run ID. |
| `b4-linear-outbound-harness.js` | `test/b4-linear-outbound-harness.js` imports it; cutoff and comment-backfill docs refer to it. | Keep the test contract. The source is a TEST mutation harness, not a current production command. |
| `b4-outbound-shadow-audit.js` | `test/b4-outbound-shadow-audit.js` and two attribution/source contract tests import or inspect it. | Keep the tested read-only classifier for historical evidence; do not infer current outbound operation. |
| `b4-pager-incremental-refresh.js` | `test/b4-pager-incremental-refresh.js` imports its workflow transform; `LINEAR_EXIT_STEP29B_INVENTORY.md` mentions it. | Keep the source test. The script can patch n8n with `--apply`, so its old pager plan is not a current instruction. |
| `b4-pager-outbound.js` | `test/b4-pager-outbound.js` imports its workflow transform; the same inventory mentions it. | Keep the source test; the old outbound dispatch plan must not be treated as active after cutoff. |
| `b4-comment-echo-probe.js` | Readiness, cutoff-touchpoint, and cleanup docs mention it; no tracked executable caller. | Manual TEST mutation probe; require an explicit current purpose before any run or deletion decision. |
| `b4-role-key-probe.js` | The earlier A3 junk inventory records no executable caller and marks it `KEEP`. | Manual role-auth diagnostic using private inputs; caller absence is not proof of obsolescence. |
| `b4-write-attribution-probe.js` | The earlier A3 junk inventory records no executable caller and marks it `KEEP`. | Manual TEST write drill using private inputs; no evidence its verification obligation is retired. |

This table distinguishes a test import, a documentation mention, and a live command. It proposes no deletion, n8n change, workflow dispatch, database write, or Linear call. The five unit tests were identified through their source imports and `test/suite-classification.json`; they were not run by this audit.
