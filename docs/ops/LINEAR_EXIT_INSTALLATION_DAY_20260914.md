# Installation day — controlled execution

Preparation only. Do not execute mutation steps without authorization for the exact revision, target and release order. Keep all private captures, connection settings and recovery keys outside Git. Never send to client Slack channels.

## 1. Freeze one candidate

Use a clean private worktree. Record the exact candidate and frozen main SHAs. Run the day-of main catch-up rehearsal once:

```powershell
node scripts/linear-exit-main-catchup.js --main=<frozen-main-SHA> --output=<new-absolute-private-directory>
```

This is a rehearsal, not a branch merge. Inspect its conflict report and all new main SQL: newly introduced migrations are not automatically part of the reviewed 48-source plan. Any changed dependency, expected catalog or executable source needs explicit classification before proceeding.

Only after separate authorization for the actual branch catch-up:

```powershell
git merge --no-commit --no-ff <frozen-main-SHA>
```

Stop on unexpected conflicts. Do not invent conflict resolutions or use blanket ours/theirs. Use the rehearsed resolution only against the exact matching conflict state:

```powershell
node scripts/linear-exit-main-catchup.js --stage-resolution=<absolute-rehearsal-receipt.json>
git diff --cached --check
git commit -m "Catch up frozen main for reviewed installation"
node scripts/ef-fingerprint.js HEAD --slugs=production-write --expected-only --format=json
node test/f27-section4-deploy-lane.js
node scripts/repo-identity-exposure-check.js --diff=<pre-catchup-SHA> --json
git push origin HEAD:prep/linear-exit-review-fixes-20260913
gh pr checks 1391 --repo sidney-afk/client-analytics --watch
gh pr view 1391 --repo sidney-afk/client-analytics --json headRefOid,statusCheckRollup
```

Require exit zero on each command before the next. Compare the calculated fingerprint, entrypoint hash and file count with the deploy lane and its test. The resolver refuses edited or unexpected conflicts before staging. It never commits or pushes. Check the returned headRefOid equals the local commit and count the 12 designated passing jobs; optional skipped lanes do not count as passes. Finish review of the resulting exact commit; require all 12 designated CI checks green on that SHA, with no pending, failed or substituted skipped check. A later commit invalidates that check association.

## 2. Recoverable pre-state and compatibility

Refresh the read-only hosted catalog against the published observed certificate. Require exact supported baseline, project/database identity and prerequisite classification. Record current authority, all existing runtime settings and serving fingerprints privately. Preserve already-active legacy flags; “dormant” applies to new exit controls.

Storage comes first if still pending. Follow the private quiet-window procedure below; do not start while the owner is changing files. The owner declined a window during preparation and expects one later at night, requiring a fresh confirmation. Allow approximately 20?30 minutes for capture/readback plus transfer time. Source drift means STOP and a new quiet window, never reuse an incomplete attempt.

Prepared private commands (use a fresh immediate-child directory for every attempt):

```powershell
node D:/Sidney/Codex/2026-09-13-final-review-repairs/read-install-day-catalog.private.cjs D:/Sidney/Codex/2026-09-13-final-review-repairs/day-catalog-UNIQUE
node D:/Sidney/Codex/2026-09-13-final-review-repairs/refresh-install-day-database.private.cjs D:/Sidney/Codex/2026-09-13-final-review-repairs/day-catalog-UNIQUE D:/Sidney/Codex/2026-09-13-final-review-repairs/day-database-UNIQUE
node D:/Sidney/Codex/2026-09-13-final-review-repairs/restore-install-day-database.private.cjs D:/Sidney/Codex/2026-09-13-final-review-repairs/day-database-UNIQUE/encrypted D:/Sidney/Codex/2026-09-13-final-review-repairs/day-database-restore-UNIQUE
```

Run the catalog command before Storage; if that capture takes over an hour, refresh the catalog into a new directory before the database command. Require the catalog receipt's supported-baseline and TLS checks; then DATABASE_CAPTURE_PASS and ISOLATED_DATABASE_RESTORE_PASS, exit zero and stopped scratch server. Any refusal means STOP and preserve diagnostics. These private wrappers retrieve the existing secret record internally; no password belongs in chat or a command argument.

The database refresh follows [the native backup route](LINEAR_EXIT_NATIVE_PREINSTALL_BACKUP_PREPARATION.md). After local restore, upload the encrypted package to the existing private Drive backup folder, download that exact package, compare its full SHA-256/file manifest and run the same isolated restore command against the downloaded package in a new output directory. Custody is incomplete until that downloaded-copy restore passes. Do not confuse public-schema recovery with full platform or asset recovery. Keep Drive/Frame historical gaps explicit. The 14 inaccessible references have a private decision sheet; no replacement or deletion is authorized and those decisions do not block the dormant install.

## 3. Install the pinned SQL, still dormant

Two finite baseline profiles are supported: observed67 (809c5dc...) and observed67_optout (f5ed8a38..., the exact #1393 opt-out column/ACL migration already present). Choose the profile whose complete fresh catalog matches; never provide a replacement target hash. The profiles do not accept other drift. The authoritative order is generated by `scripts/linear-exit-observed-full-install-plan.js`, not lexical migration order and not `supabase db push`. The reviewed plan contains **48 source entries / 55 chunks**, plan SHA-256 `3c000b76db5cf6dc31a90b61ad7dc7751d6ce02c74b6d40939dbbcccbe6acbfb`, with final target SHA-256 `f3db4b7cd0649800e4811d1c4b32cf3f37e5c2bf951d4b12d22009faf08aa28f`. In particular: 62741 → 190840 → 181213 → 183021 → 62149. Verify every raw source pin in [the machine proof](../independence/LINEAR_EXIT_OBSERVED_FULL_PIPELINE_20260913.json); never normalize pinned bytes.

The separate `scripts/linear-exit-install-operator.js` adapter uses the existing maintenance/bootstrap/journal/finalizer safeguards. Root independently reviewed the adapter and actual PG17 execution passed; this remains preparation, requiring the explicit day-of authorization and preconditions below. The original loopback rehearsal worker remains unchanged.

Private JSON configuration requires `profile` (observed67 or observed67_optout), `projectRef`, exact direct `host` (`db.<projectRef>.supabase.co`), `port:5432`, `database:"postgres"`, `user:"postgres"`, private `password`, absolute `caFile`, absolute `baselineFile`, absolute independently saved `targetFile`, exact `expectedDatabaseIdentity` (database, database_oid, system_identifier, session_user), and `ownerWindowEvidenceSha256`. Use the preinstalled private postgres@3.4.7 runtime: set NODE_PATH to D:/Sidney/Codex/2026-09-13-final-review-repairs/operator-runtime/node_modules and verify with node -p "require.resolve('postgres')" before opening a connection. Do not install packages during the release. Include an existing absolute owner-private diagnosticsDirectory; failure receipts contain only fixed code and stage. The window hash binds the operator's reviewed record; it does not prove external fencing or custody by itself.

```powershell
node scripts/linear-exit-install-operator.js <absolute-private-config.json>
```

Default is a read-only identity/TLS/catalog observation. Existing installation state is reported, not declared resumable. After explicit approval, the second argument is `APPLY:<pinned-plan-SHA>:<SHA256-of-canonical-expectedDatabaseIdentity>:<ownerWindowEvidenceSha256>`; derive it through exported `consent(config)` and keep it in the private invocation. A token is an explicit operator control, not independent evidence that authorization exists. The same API revalidates exact private ownership, identity, committed prefix and catalog on resume. The config may never select a caller-supplied SQL plan or arbitrary host.

Success requires all 55 chunks journaled, exact final public/private catalog and routine/ACL comparisons, unchanged retirement dependency check, and successful finalizer removal of only registered installation guards. Installation does not call retirement activation/native reopen or change runtime authority.

There is no built-in SQL statement or lock deadline in this adapter. Do not promise a fixed installation duration. If blocked, inspect the actual backend and lock state privately; do not start another installer or assume a timeout rolled back a committed chunk. Any deliberate interruption must be followed by the exact journal/prefix checks below.

On failure, stop and preserve logs, catalog and journal. Never restart from chunk zero or manually mark a chunk complete. Resume only with the same identity/stage/plan after exact committed-prefix and current-catalog validation. The rehearsal proved rollback at prefix54 and fresh resume to55; it does not justify retrying arbitrary nontransactional effects. A remaining maintenance guard is a failed/incomplete installation, not permission to drop it manually.

## 4. Merge and the chosen Edge release

The existing workflow is [Deploy staff-sensitive edge functions](https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-onboarding-edge-functions.yml). It requires manual deployment SHA to be on `origin/main`. A branch-only SHA cannot use this lane before merge.

Before authorizing merge, accept the ordering interval explicitly: Pages publishes `main:/`; a matching push can deploy eight staff functions. Manual Track-B deployment occurs afterward. If that interval is unacceptable, stop for a separately reviewed release mechanism rather than bypassing ancestry checks.

After authorized merge and successful push lane, record the exact main SHA and dispatch only with explicit deployment authorization:

```powershell
gh workflow run deploy-onboarding-edge-functions.yml --ref main -f commit_sha=<exact-main-SHA>
```

The workflow first runs the SQL preflight, then eight staff functions, then `linear-outbound` → `notify` → `production-write` → `production-comments` → `production-archive`. Require all 13 fingerprints and JWT posture to match that SHA. Deployment attestation leaves the separate TEST drill pending; do not call it capability acceptance. This lane does not deploy every separately prepared native component.

Stop on preflight, deployment or fingerprint failure. Preserve the exact partial deployment list. Do not retry a different SHA or deploy readers ahead of their writer. Use the reviewed rollback/release procedure for that actual partial state.

## 5. Observe current behavior, leave new controls dormant

Verify served browser SHA and safe existing reads, then only explicitly approved TEST saves. Check status/body, stored row, receipt/event and draft retention; a successful HTTP response alone is insufficient. No client Slack delivery tests.

Compare settings with pre-state: existing Linear inbound/outbound and legacy capability settings unchanged; new notification sending/wake, follow-up supervisor, reconcile apply and automatic census gates remain at their separately approved dormant posture. Do not blanket-disable existing live flags. Do not call the retired-epoch switch or native reopen. Confirm no worker was stopped and no provider connection was removed.

Record SQL completion, website SHA, exact Edge deployment/fingerprints, TEST observations, unchanged settings and remaining gaps separately. Native activation requires its own hosted acceptance. Linear retirement, shutdown, cancellation and deletion are outside the owner scope and must not be scheduled or inferred.
## Known pre-applied main prerequisite

The fresh read-only catalog found #1393's `migrations/2026-09-14-team-members-auto-assign-opt-out.sql` already applied. Its exact difference is only `team_members`: the new boolean NOT NULL default-false column, removal of anon/authenticated table SELECT, and SELECT grants over the original eleven columns. Do not replay it on that baseline or describe the old 809c catalog as current.

Use `profile:observed67_optout` for complete catalog SHA-256 `f5ed8a38a4454e62905192c49de9a6a790c1bb48e247884efed12562b1161c25`. It preserves the 48 executable source order but binds plan `0c88914972800f8268a9a5857535ca8cb624f6b25460b19b34091ea4b58ced57` and independently calibrated target `79710a7f96855c6f3975ab88558e9c6f3b51ffc01a7b7d56a2508982955456f0`. Calibration receipt e7df95d7435141cd8511ab3de749082e is separate from fresh operator verification b2498e97f5764e308467fbf9c07f675c, which passed with start/end source pins equal. Its private target file is `linear-exit-install-operator-e7df95d7435141cd8511ab3de749082e/optout-target.private.json` under the final-review evidence directory.

The original profile and historical target remain supported without changing their recorded meaning. If the original profile is selected, #1393 remains a separate prerequisite before the new Edge gateway; do not silently count its application inside the 48-source proof. Preserve existing opted-out values in either path.

## Private Storage operator

Use D:/Sidney/Codex/2026-09-13-final-review-repairs/storage-quiet-window-operator.private.md. Only after actual owner confirmation, set STORAGE_QUIET_WINDOW_CONFIRMED=YES and run its run-storage-quiet-window.private.cjs with a new absolute immediate-child output directory. This performs fresh inventory, full export barriers and decrypted readback; upload and downloaded-copy restoration remain separate. Never reuse a failed output directory.

## Reproduce adapter proof (isolated only)

```powershell
./qa/linear-exit-rehearsal/run-portable.ps1 -PgBin D:/Sidney/Codex/2026-09-09-repair-evidence/postgres17/pgsql/bin -Lane install-operator -ObservedInputDirectory D:/Sidney/Codex/2026-09-12-fast-finish-evidence -OutputRoot D:/Sidney/Codex/2026-09-13-final-review-repairs
```

The proof executes actual SQL against a disposable observed-schema cluster. Its TLS-status query is explicitly shimmed for the local transport; it does not prove hosted TLS. It tests base48 target and finalized replay, then the separately pinned main auto-assign prerequisite inside a rolled-back transaction. Final original-profile receipt cdbf6fed120744039665ce4aef2d3f1a and new-profile receipt b2498e97f5764e308467fbf9c07f675c passed; both servers stopped: real48-source installation, exact target/finalizer, finalized retry and identity/consent refusals. See [machine proof](../independence/LINEAR_EXIT_INSTALL_OPERATOR_PG17_20260914.json). The new profile also preserves one synthetic opted-out member and all its original fields across installation and finalized replay. The separate migration column/ACL checks pass in rollback; this does not prove hosted data or TLS.
