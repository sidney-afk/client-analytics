# Linear exit: review repairs and shortest remaining path

Preparation only. No merge, installation, deployment, workflow dispatch, production write, notification send or n8n execution is authorized by this document.

## Current review candidate

Published draft [PR #1391](https://github.com/sidney-afk/client-analytics/pull/1391), branch `prep/linear-exit-review-fixes-20260913`, starts from fetched main `14fb430afd82471ba6f875ccd460ca304fa0721f`. The reviewed preparation delta through `d4e67e1c1c68253ebbe38453d661fd45fe2dd59c` was applied without a merge; conflicting paths were reviewed individually and newer main work retained. First complete publication is `fc6290d952df4f0181b013d5a88d3c38ba1705d8`; GitHub confirmed no branch conflicts and began ordinary PR checks. Read the PR's current head/check results for subsequent CI-only repairs and final execution status. Original draft PR #1382 is the historical preparation reference, not the current review entrypoint.

The installation runtime pins in `../independence/LINEAR_EXIT_OBSERVED_FULL_PIPELINE_20260913.json` still match. The earlier full installation/interruption proof remains bounded to those exact pinned files; this does not claim a new whole-tree rehearsal. The prepared native signoff reconciliation behavior was restored after an integration omission; 172 reconciler and 39 native-verification checks pass. A separate QA helper import was corrected. Exact pinned artifact bytes were preserved after checkout line-ending drift; 17 affected offline contract/package suites pass again without changing their expected hashes. Test routing now explicitly distinguishes unit suites from required isolated profiles; see `LINEAR_EXIT_CI_ROUTING.md`.

The write-refusal diagnostics browser suite also passed separately using existing local Chromium: 20 reports, zero retries/external escapes, draft preserved. It exercises the isolated helper harness and is not hosted save proof. It remains a required browser profile rather than being silently treated as a dependency-free unit test.

## Review findings addressed

| Finding | Evidence and remaining boundary |
| --- | --- |
| Branch conflicts with newer main | Resolved and published in PR #1391; GitHub confirms no merge conflicts. No merge was performed. |
| Final ACL owner missing from latest switch/recovery run | Fresh PG17 switch receipt `7369ef65f2454f4fa36967560bf1a970`: 46 checks. Recovery receipt `db8b06715a7f41b4ab95ca2d366ff982`: 94 tables, 32 selected routines. Both include owner 190840 and stopped-server evidence. See the refreshed switch and control-retirement JSON manifests. |
| Stale hosted catalog check | Fresh read-only catalog matches the recorded baseline: 67 public tables, 115 functions, no changed sections. Recheck immediately before an installation window. |
| Incomplete CI selection | Every top-level test has an explicit classification; separate profiles are reported NOT_RUN, never silently counted as passed. New isolated PR jobs have no production credentials or deployment steps. Ordinary PR checks now execute; consult PR #1391 for actual results. Initial GitHub validation exposed runner-context placement in two prepared workflows; the correction preserves their existing trigger and authorization boundaries. |
| Real pre-installation database backup shape | Dedicated native public-schema encrypted backup/restore passes both the populated 67-table fixture (`390c6f261f91431284a1a0e144576fed`) and exact observed 67-table schema (`a00008a48e20449bb8c6301478dcbd76`): 8 checks each, servers stopped, exact catalog/row/sequence comparisons. See `LINEAR_EXIT_NATIVE_PREINSTALL_BACKUP_PREPARATION.md` and its JSON proof. This is an isolated mechanism/schema proof; no live data has been exported, and non-public platform dependencies and asset bytes remain separate. |
| Browser reads before the additive schema is installed | The current hosted projections lack three planned fields. Compatibility reads handle only their exact missing-column responses and retry the same safe view/filters without those additions. Missing native proof remains absent and cannot authorize native attribution. Other errors propagate. Focused tests cover installed/pre-install shapes and refusals; PR #1391 records the final browser-gate execution. |

The prepared write-diagnostics function was freshly typechecked with zero diagnostics and added to the existing ratchet baseline; its ratchet unit test passes. This does not clear other functions: the known 12 provider baseline Deno diagnostics remain red, and no claim of a clean whole-project typecheck is made.

The staged-schema read repair passes 17 focused compatibility controls and the absent-native-proof refusal check. Its previous strict console audit remained red for expected missing-column responses because it required identical-URL recovery. On 2026-09-14 the owner explicitly approved the narrow, response-bound exception documented at the top of AGENTS.md. The first full browser run with that exception correctly found an additional runtime defect: delta refresh bypassed the compatibility helper. Delta refresh now uses the same helper, preserving its encoded timestamp filter, page size, cap and primary-key cursor. Independent review and focused refresh/count tests pass; no other direct full-projection bypass remains. Consult PR #1391 for the final browser and CI results; unrelated failures and unproven fallbacks remain failures. Public-key OpenAPI discovery returned 401 requiring a secret key; no secret is placed in the browser.

## Remaining real-world checks

The subsequent combined browser run passed seven of eight suites. Accessibility still failed while its CPU-heavy scan overlapped initial read recovery. The accessibility harness now asserts the existing bounded read audit before starting that scan, then retains its original final audit, keyboard/geometry assertions and no-write checks. The focused browser rerun passes with zero Axe findings and 12 verified recovered reads; independent review confirms no audit records are cleared and no recovery window or assertion was weakened. Final combined and GitHub results are recorded on PR #1391, including any remaining failures.

Keep these as one ordered acceptance list, not another audit:

1. **Recovery copy:** after explicit export authorization, capture the actual pre-installation public database through the reviewed backup path, encrypt it, store it off this computer, retrieve it and restore into an isolated target. Verify the public-schema scope and separately account for non-public platform dependencies and asset bytes. A database backup containing file links does not preserve the files themselves.
2. **Files:** complete the actual asset census and verify access/preservation. Current direct-field census includes Drive, Frame.io, two distinct Linear URLs and two distinct non-HTTP references for active clients. This is not yet historical coverage or proof of readable originals/copies. Preserve private URLs outside GitHub.
3. **Notifications:** confirm intended destinations for 16 active client records with missing channel configuration. Read-only search found candidates for 10, including 3 ambiguous cases; 6 had no candidate. These are suggestions, not confirmed mappings. The native notification function and configuration table are absent; real delivery requires its separately authorized release and one controlled acceptance check.
4. **Installation and capability acceptance:** authorize the exact reviewed release only after recovery and compatibility prerequisites pass. Follow the existing final installation plan; check actual hosted saves and workers before activating capabilities.
5. **Linear retirement:** only at the later retirement window, stop and verify every actual external worker, reconcile uncertain outcomes and require zero Linear-bound work. Keep native save receipts. Do not disable workers during preparation.

The read-only aggregate evidence is `../independence/LINEAR_EXIT_LIVE_PRECHECK_20260913.json`. Private captures and destination candidates are under `D:/Sidney/Codex/2026-09-13-final-review-repairs`; older exact schema/routine inputs and proof receipts are under `D:/Sidney/Codex/2026-09-12-fast-finish-evidence`. These directories are not uploaded to GitHub.

## Simplest custody arrangement

The owner may be the sole keyholder; a second person is not required. Owner-approved route (2026-09-14): an encrypted backup in the owner's Google Drive, with a separate recovery record in the owner's password manager accessible from another device. The existing codec requires both its encryption and integrity keys plus its non-secret key identifier; keep these together as one recovery record, separate from the encrypted backup. Do not put that record in GitHub, a chat, or beside the backup.

The owner must personally confirm retrieval of the recovery record from another device. Merely choosing Drive or storing a local key is not evidence of off-device recovery. No key was generated, no backup was uploaded, and no access was shared in this preparation.
