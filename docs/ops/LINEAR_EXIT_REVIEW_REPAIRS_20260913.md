# Linear exit: review repairs and shortest remaining path

Preparation only. No merge, installation, deployment, workflow dispatch, production write, notification send or n8n execution is authorized by this document.

## Current review candidate

Branch `prep/linear-exit-review-fixes-20260913` starts from fetched main `14fb430afd82471ba6f875ccd460ca304fa0721f`. The reviewed preparation delta through `d4e67e1c1c68253ebbe38453d661fd45fe2dd59c` was applied without a merge; conflicting paths were reviewed individually and newer main work retained. Publication and actual GitHub CI results must be recorded before this branch is called published or green. Original draft PR #1382 remains historical until that publication is confirmed.

The installation runtime pins in `../independence/LINEAR_EXIT_OBSERVED_FULL_PIPELINE_20260913.json` still match. The earlier full installation/interruption proof remains bounded to those exact pinned files; this does not claim a new whole-tree rehearsal. The prepared native signoff reconciliation behavior was restored after an integration omission; 172 reconciler and 39 native-verification checks pass. A separate QA helper import was corrected. Exact pinned artifact bytes were preserved after checkout line-ending drift; 17 affected offline contract/package suites pass again without changing their expected hashes. Test routing now explicitly distinguishes unit suites from required isolated profiles; see `LINEAR_EXIT_CI_ROUTING.md`.

The write-refusal diagnostics browser suite also passed separately using existing local Chromium: 20 reports, zero retries/external escapes, draft preserved. It exercises the isolated helper harness and is not hosted save proof. It remains a required browser profile rather than being silently treated as a dependency-free unit test.

## Review findings addressed

| Finding | Evidence and remaining boundary |
| --- | --- |
| Branch conflicts with newer main | Resolved in the new main-based preparation branch. Remote conflict status and CI remain pending publication. |
| Final ACL owner missing from latest switch/recovery run | Fresh PG17 switch receipt `7369ef65f2454f4fa36967560bf1a970`: 46 checks. Recovery receipt `db8b06715a7f41b4ab95ca2d366ff982`: 94 tables, 32 selected routines. Both include owner 190840 and stopped-server evidence. See the refreshed switch and control-retirement JSON manifests. |
| Stale hosted catalog check | Fresh read-only catalog matches the recorded baseline: 67 public tables, 115 functions, no changed sections. Recheck immediately before an installation window. |
| Incomplete CI selection | Every top-level test has an explicit classification; separate profiles are reported NOT_RUN, never silently counted as passed. New isolated PR jobs have no production credentials or deployment steps. Actual job results remain pending. |
| Real pre-installation database backup shape | Dedicated native public-schema encrypted backup/restore passes both the populated 67-table fixture (`390c6f261f91431284a1a0e144576fed`) and exact observed 67-table schema (`a00008a48e20449bb8c6301478dcbd76`): 8 checks each, servers stopped, exact catalog/row/sequence comparisons. See `LINEAR_EXIT_NATIVE_PREINSTALL_BACKUP_PREPARATION.md` and its JSON proof. This is an isolated mechanism/schema proof; no live data has been exported, and non-public platform dependencies and asset bytes remain separate. |

The prepared write-diagnostics function was freshly typechecked with zero diagnostics and added to the existing ratchet baseline; its ratchet unit test passes. This does not clear other functions: the known 12 provider baseline Deno diagnostics remain red, and no claim of a clean whole-project typecheck is made.

## Remaining real-world checks

Keep these as one ordered acceptance list, not another audit:

1. **Recovery copy:** after explicit export authorization, capture the actual pre-installation public database through the reviewed backup path, encrypt it, store it off this computer, retrieve it and restore into an isolated target. Verify the public-schema scope and separately account for non-public platform dependencies and asset bytes. A database backup containing file links does not preserve the files themselves.
2. **Files:** complete the actual asset census and verify access/preservation. Current direct-field census includes Drive, Frame.io, two distinct Linear URLs and two distinct non-HTTP references for active clients. This is not yet historical coverage or proof of readable originals/copies. Preserve private URLs outside GitHub.
3. **Notifications:** confirm intended destinations for 16 active client records with missing channel configuration. Read-only search found candidates for 10, including 3 ambiguous cases; 6 had no candidate. These are suggestions, not confirmed mappings. The native notification function and configuration table are absent; real delivery requires its separately authorized release and one controlled acceptance check.
4. **Installation and capability acceptance:** authorize the exact reviewed release only after recovery and compatibility prerequisites pass. Follow the existing final installation plan; check actual hosted saves and workers before activating capabilities.
5. **Linear retirement:** only at the later retirement window, stop and verify every actual external worker, reconcile uncertain outcomes and require zero Linear-bound work. Keep native save receipts. Do not disable workers during preparation.

The read-only aggregate evidence is `../independence/LINEAR_EXIT_LIVE_PRECHECK_20260913.json`. Private captures and destination candidates are under `D:/Sidney/Codex/2026-09-13-final-review-repairs`; older exact schema/routine inputs and proof receipts are under `D:/Sidney/Codex/2026-09-12-fast-finish-evidence`. These directories are not uploaded to GitHub.

## Simplest custody arrangement

The owner may be the sole keyholder; a second person is not required. Proposed route: an encrypted backup in the owner's Google Drive, with a separate recovery record in the owner's password manager accessible from another device. The existing codec requires both its encryption and integrity keys plus its non-secret key identifier; keep these together as one recovery record, separate from the encrypted backup. Do not put that record in GitHub, a chat, or beside the backup.

The owner must personally confirm retrieval of the recovery record from another device. Merely choosing Drive or storing a local key is not evidence of off-device recovery. No key was generated, no backup was uploaded, and no access was shared in this preparation.
