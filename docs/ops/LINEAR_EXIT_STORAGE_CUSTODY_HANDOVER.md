# Linear exit: owner-machine operator handover

Written 2026-09-16 by the session that operated the owner's Windows machine
from 2026-09-15 to 2026-09-16. Branch `prep/linear-exit-review-fixes-20260913`,
prep head `c34c7e31` when writing began; main frozen at `1abdd1fa`.

**Why this exists.** Everything below lived only in one session's context.
It is written so the next operator does not rediscover it at the keyboard.

**How to read it.** The sections say, for each fact, whether it was
**measured** (run and observed), **read** (from code or files, not executed),
or **reported** (told to the session, not checked). Nothing here is more
settled than that label. The journal
([LINEAR_EXIT_JOURNAL.md](LINEAR_EXIT_JOURNAL.md)) is the record of *what
happened*; this page is the record of *how to operate the machine*.

**This repository is public.** No private value appears here. Names of files
and directories are given; their contents are not. Anything secret is shown as
a named placeholder in angle brackets and explained where it is used.

---

## 1. Placeholders used on this page

| Placeholder | What it is | Where the real value lives |
|---|---|---|
| `<PROJECT_REF>` | The production Supabase project reference | Private evidence directory, and inside the private wrappers. Deliberately never written in this repository. |
| `<DB_PASSWORD>` | Production database password | Owner's DPAPI secret store, read only by the private wrappers through `read-private-secret.private.ps1 -Name database-password`. **Never run that helper by hand; its output is the secret.** |
| `<RECOVERY_RECORD>` | Encryption key, HMAC input and `keyId` for encrypted packages | Same DPAPI store, `-Name recovery-record`, read only inside the wrappers. The owner also holds it in iOS Notes. |
| `<SUPABASE_ACCESS_TOKEN>`, `<SUPABASE_SERVICE_ROLE_KEY>` | Management API token and service-role key | Set in the owner's **user** environment variables. Present in every new process. Their names may be printed; their values never. |
| `<BACKUP_DRIVE_FOLDER>` | The private Drive folder packages are uploaded to | Owner-only. Identified by ID inside `owner-custody-confirmations-20260914.private.json`, under a backup account that is **not** the account the session's Drive connector is signed into. |

---

## 2. Machine and toolchain

All **measured** on 2026-09-15/16 unless marked otherwise.

| Tool | Version / location | Notes |
|---|---|---|
| OS | Windows 11 Pro 10.0.26200 | |
| Windows PowerShell | 5.1.26100.9444 | The default shell the session's PowerShell tool runs. **Corrupts binary pipes between native programs** (section 6). |
| PowerShell 7 | **7.6.6**, Core | **Installed 2026-09-16 with owner approval:** `winget install --id Microsoft.PowerShell --source winget`. Installed as a Store/MSIX package under `C:\Program Files\WindowsApps\Microsoft.PowerShell_7.6.6.0_x64__8wekyb3d8bbwe\pwsh.exe`, reached through the alias `C:\Users\Sidney\AppData\Local\Microsoft\WindowsApps\pwsh.exe`. **Not** under `Program Files\PowerShell\7`. Processes started before the install do not see `pwsh` on PATH. |
| Node | v22.12.0 | |
| Python | 3.11.9, `C:\Users\Sidney\AppData\Local\Programs\Python\Python311\python.exe` | Used for journal edits and the Storage transport helper. |
| Deno | 2.5.2 (WinGet link) | The install-operator worker runs under Deno with `--cached-only` and a lockfile. It worked from the existing cache; the cache contents were never inspected. |
| git | 2.49.0.windows.1, with Git Bash beside it | `run-portable.ps1` requires `bin\bash.exe` next to git. |
| tar | `C:\Windows\system32\tar.exe`, bsdtar 3.8.8 | |
| PostgreSQL 17 (runbook copy) | 17.11, `D:/Sidney/Codex/2026-09-09-repair-evidence/postgres17/pgsql/bin` | Bundles **ICU 67**; its `en-US` ICU collation version is **153.14**. **Use this copy explicitly.** |
| PostgreSQL 17 (second copy) | 17.11, `C:\Users\Sidney\Documents\Codex\2026-09-09-repair-evidence\postgres17\pgsql\bin` | This one is on PATH. The B9 selfcheck found it when `F42_REHEARSAL_PGBIN` was unset. |
| Private DB driver | `postgres@3.4.7` under `D:/Sidney/Codex/2026-09-13-final-review-repairs/operator-runtime/node_modules` | Used by the private wrappers. Never install packages during a sitting. |
| TLS CA file | `%APPDATA%\postgresql\root.crt` | Supabase Root 2021 CA. The whole folder **disappeared once** (section 6). |

For comparison, **live** (measured by one read-only `pg_database` query on
2026-09-16): PostgreSQL 17.6, locale provider ICU, `datlocale en-US`, UTF8,
collation version **153.121**, no ICU rules.

---

## 3. Where things live

### Directories

| Path | What |
|---|---|
| `D:/Sidney/Codex/2026-09-13-linear-exit-review-fixes` | The checkout of this branch. **Other sessions push to it often**; always fetch and fast-forward before editing (section 6). |
| `D:/Sidney/Codex/2026-09-13-final-review-repairs` | **Private evidence directory.** All wrappers, receipts, run directories and targets. Many wrappers refuse output paths that are not **immediate children** of it. |
| `D:/Sidney/Codex/2026-09-12-fast-finish-evidence` | **Private observed-schema inputs** (below), plus the `observed67` target. |
| `D:/Sidney/Codex/2026-09-16-runner-before-05bf19f6` | Detached git worktree at `05bf19f6`, left for neutrality re-runs. |
| `D:/Sidney/Codex/2026-09-16-optout-before-d3cbca7f` | Detached git worktree at `d3cbca7f`, the last clean opt-out state before `8299108`. Left for re-runs. |

### The four private observed-schema capture files

All at the **top level** of `D:/Sidney/Codex/2026-09-12-fast-finish-evidence`.
Their exact names are hard-coded in `scripts/linear-exit-observed-schema.js`:

1. `live-full-catalog-20260912.private.json`
2. `live-routine-definitions-20260912.private.json`
3. `live-structural-definitions-20260912.private.json`
4. `live-sequence-ownership-20260912.private.json`

Pass the **directory**, never a file, as `--observed-input=` or
`-ObservedInputDirectory`. It is the 2026-09-12 67-table world; every
reconstruction starts from it.

### Targets (private files, public hashes)

| Profile | Target file | SHA-256 |
|---|---|---|
| `observed67` | `2026-09-12-fast-finish-evidence/linear-exit-observed-full-install-332df4aeaf7b48218006e705b9128ff7/full-target.private.json` | `f3db4b7c…` |
| `observed67_optout` | `2026-09-13-final-review-repairs/linear-exit-install-operator-e7df95d7435141cd8511ab3de749082e/optout-target.private.json` | `79710a7f…` |
| `settled68` | `2026-09-13-final-review-repairs/linear-exit-install-operator-38a3b52acf654a87b2b55ac63fd5b4d4/settled68-target.private.json` | `625430979c5508f2a87b18bfa9d7135806273c909c3f5baf9f5a5fe835f97356`, 1,613,093 bytes |

### Private wrappers (names only)

In the private evidence directory:
`run-storage-quiet-window.private.cjs`, `storage-quiet-window-operator.private.md`
(the authority for Storage flags), `storage-ciphertext-transport.private.py`,
`verify-downloaded-storage.private.cjs`, `read-install-day-catalog.private.cjs`,
`refresh-install-day-database.private.cjs`,
`restore-install-day-database.private.cjs` and `read-private-secret.private.ps1`.

---

## 4. Command catalogue

Every path is absolute, so the working directory does not matter unless a
command says otherwise. Every command writes into a **new** directory. Replace
`UNIQUE` with something never used before (date plus attempt number). Never
reuse the directory of a failed attempt.

### 4.1 Storage custody (step 1)

Read `storage-quiet-window-operator.private.md` first; it is the authority.
**Measured** on 2026-09-15. Attempt 1 refused on a transport error; attempt 2
passed.

```powershell
# Only after the owner confirms a genuine quiet window.
$env:STORAGE_QUIET_WINDOW_CONFIRMED='YES'
node D:/Sidney/Codex/2026-09-13-final-review-repairs/run-storage-quiet-window.private.cjs D:/Sidney/Codex/2026-09-13-final-review-repairs/storage-quiet-window-UNIQUE *> D:/Sidney/Codex/2026-09-13-final-review-repairs/storage-quiet-window-UNIQUE.private.log
Remove-Item Env:STORAGE_QUIET_WINDOW_CONFIRMED
```

It needs `<SUPABASE_ACCESS_TOKEN>` and `<SUPABASE_SERVICE_ROLE_KEY>` present in
the environment; they already are. Takes about 20 minutes and is safe to run in
the background. Pass means exit 0 plus `local_readback_verified: true` in
`real-storage-export-receipt.private.json`.

```powershell
python D:/Sidney/Codex/2026-09-13-final-review-repairs/storage-ciphertext-transport.private.py pack <CAPTURE_DIR>/real-storage-encrypted D:/Sidney/Codex/2026-09-13-final-review-repairs/storage-ciphertext-UNIQUE.zip D:/Sidney/Codex/2026-09-13-final-review-repairs/storage-transport-UNIQUE.json
# Owner uploads to <BACKUP_DRIVE_FOLDER> and downloads the archive again.
python D:/Sidney/Codex/2026-09-13-final-review-repairs/storage-ciphertext-transport.private.py verify <ABSOLUTE_DOWNLOADED_ZIP> D:/Sidney/Codex/2026-09-13-final-review-repairs/downloaded-storage-ciphertext-UNIQUE D:/Sidney/Codex/2026-09-13-final-review-repairs/storage-transport-UNIQUE.json
node D:/Sidney/Codex/2026-09-13-final-review-repairs/verify-downloaded-storage.private.cjs <CAPTURE_DIR> D:/Sidney/Codex/2026-09-13-final-review-repairs/downloaded-storage-ciphertext-UNIQUE D:/Sidney/Codex/2026-09-13-final-review-repairs/downloaded-storage-plaintext-UNIQUE D:/Sidney/Codex/2026-09-13-final-review-repairs/downloaded-storage-readback-UNIQUE.json
```

Before trusting the downloaded copy, compare its size and hash against the
packed archive yourself (`sha256sum` in Git Bash, or `Get-FileHash`). The
restored tree holds two more files than there are objects: `coverage.hmac` and
`storage-metadata.hmac` under `export-evidence`, which is not a bucket.

### 4.2 Catalog read (step 8)

```powershell
node D:/Sidney/Codex/2026-09-13-final-review-repairs/read-install-day-catalog.private.cjs D:/Sidney/Codex/2026-09-13-final-review-repairs/day-catalog-UNIQUE
```

**Read-only.** It prints the receipt JSON, and exits 2 when no reviewed profile
matches. **Measured:** on 2026-09-15 and 2026-09-16, live `ddfa4c4f…` gave
`profile: null`.

> **OPEN, read from code and not yet fixed.** The wrapper's catalog-to-profile
> map contains **only** `observed67` (`809c5dc7…`) and `observed67_optout`
> (`f5ed8a38…`). Pinning `settled68` in `scripts/linear-exit-install-profiles.js`
> does **not** reach this private file. Until the owner updates the wrapper, a
> settled live catalog yields `profile: null` and
> `matches_reviewed_baseline: false`, and the capture wrapper refuses that
> receipt (4.3). The wrapper's SHA-256 at last check was `5b44cf99…`.

> **Update 2026-09-16, storage session, measured.** The wrapper now maps
> `ddfa4c4f…` to `settled68`: one inserted entry, SHA-256 `5b44cf99…` →
> `6b6e2fe7…`, 3,248 → 3,327 bytes. The before-state is kept beside it as
> `….pre-settled68-20260916.bak`. The live read `day-catalog-20260916-4`
> returned `profile: "settled68"`, `matches_reviewed_baseline: true`, exit 0.
> **Run it from a Windows PowerShell 5.1 host, not pwsh 7** (section 6, last
> row). **Steps 9 and 10 still cannot pass:** public
> `linear-exit-native-preinstall-backup.js` `evidence()` asserts exactly 67
> tables, and the settled world has 68. The full record, including how to check
> the private change without seeing it, is in the journal entry of the same
> date headed "Storage session".

### 4.3 Database capture and restore (steps 9 and 10)

**These have NOT run in this project's current state.** The commands as the
wrappers accept them (**read** from the wrapper argument checks, 2026-09-16):

```powershell
node D:/Sidney/Codex/2026-09-13-final-review-repairs/refresh-install-day-database.private.cjs D:/Sidney/Codex/2026-09-13-final-review-repairs/day-catalog-UNIQUE D:/Sidney/Codex/2026-09-13-final-review-repairs/day-database-UNIQUE
node D:/Sidney/Codex/2026-09-13-final-review-repairs/restore-install-day-database.private.cjs D:/Sidney/Codex/2026-09-13-final-review-repairs/day-database-UNIQUE/encrypted D:/Sidney/Codex/2026-09-13-final-review-repairs/day-database-restore-UNIQUE
```

What the wrappers require that is easy to miss. All **read**, none run:

- **Capture:** a catalog receipt under one hour old, with
  `matches_reviewed_baseline: true`. Both paths must be immediate children of
  the evidence directory. It starts **no** scratch server, and on success
  prints only `DATABASE_CAPTURE_PASS; restore, private upload and
  downloaded-copy restore still required`. Nothing will ever say "scratch
  server stopped".
- **Restore:** the package path must be **inside** the evidence directory. A
  file in a Downloads folder is refused with `PRIVATE_NEW_PATHS_REQUIRED`, and
  a downloaded zip must be extracted first. Its owned scratch cluster
  `native-preinstall-scratch-d307b95366c94f169876769dec9b932a` must be stopped
  (`CLUSTER_NOT_STOPPED`) and that cluster's port free (`PORT_BUSY`). It stops
  the cluster in `finally` and prints only `ISOLATED_DATABASE_RESTORE_PASS`.

### 4.4 B9 derivation (isolated PG17, nothing hosted)

**Measured** on 2026-09-16. The first attempt failed; the second passed.

```powershell
node D:/Sidney/Codex/2026-09-13-linear-exit-review-fixes/scripts/linear-exit-b9-catalog-derive.js --selfcheck
```

Then start **your own** throwaway cluster on loopback, with **ICU `en-US`**:

```powershell
$pgbin='D:/Sidney/Codex/2026-09-09-repair-evidence/postgres17/pgsql/bin'
& "$pgbin/initdb.exe" -D "<NEW_DATA_DIR>" -U postgres --auth=trust -E UTF8 --locale-provider=icu --icu-locale=en-US --locale=en-US
& "$pgbin/pg_ctl.exe" -D "<NEW_DATA_DIR>" -l "<NEW_DATA_DIR>/../server.private.log" -o "-p <FREE_PORT> -c listen_addresses=127.0.0.1" -w start
$env:PATH = ($pgbin -replace '/','\') + ';' + $env:PATH
$env:F42_REHEARSAL_PGBIN=$pgbin; $env:PGHOST='127.0.0.1'; $env:PGPORT='<FREE_PORT>'; $env:F63_REQUIRE_POSTGRES='1'
Set-Location D:/Sidney/Codex/2026-09-13-linear-exit-review-fixes
node scripts/linear-exit-b9-catalog-derive.js "--observed-input=D:/Sidney/Codex/2026-09-12-fast-finish-evidence" "--out=D:/Sidney/Codex/2026-09-13-final-review-repairs/b9-derive-UNIQUE"
& "$pgbin/pg_ctl.exe" -D "<NEW_DATA_DIR>" -m fast -w stop
```

Plan hash from a settled catalog. Both paths **must be absolute**; the script
asserts it:

```powershell
node D:/Sidney/Codex/2026-09-13-linear-exit-review-fixes/scripts/linear-exit-b9-catalog-derive.js "--plan-from=D:/Sidney/Codex/2026-09-13-final-review-repairs/b9-derive-20260916-2/b9-settled-catalog.private.json"
```

### 4.5 Edge function fingerprint (B7)

Run from the repository root, since it reads git. It uses
`<SUPABASE_ACCESS_TOKEN>` from the environment. **Measured:** 12 PASS at
`0aa5954`.

```powershell
node scripts/ef-fingerprint.js 0aa5954a5c63e3b6f399caf739e562b371393325 --slugs=onboarding-list,ai-onboarding-list,legacy-onboarding-list,onboarding-full,client-credentials,filming-plans,smm-weekly-reports,key-verify,linear-outbound,production-comments,production-archive,production-write
```

### 4.6 Install-operator lane: proofs, neutrality and calibration

The reviewed route is `qa/linear-exit-rehearsal/run-portable.ps1 -Lane install-operator`.

- It builds a PG17 cluster with ICU `en-US` on `127.0.0.1`, libc `--locale=C`
  and password auth, then stops it in `finally`.
- It **refuses to start** if any inherited environment variable matches
  `^(PG|F42_|NIR_|WORKLOAD_TEST_|TRACK_B_RECOVERY_TEST_|SUPABASE|DATABASE_URL|NATIVE_|F63_|ARTIFACT_|INTAKE_MANIFEST_|PROOF_)`,
  and `SUPABASE_*` are always present on this machine.
- For this lane it **refuses `-CalibrateTarget`**, so the profile and the
  calibration flag travel as environment variables.

The session used this launcher script. It is not secret and is reproduced here
so it survives:

```powershell
param(
  [Parameter(Mandatory=$true)][string]$RepoRoot,
  [Parameter(Mandatory=$true)][ValidateSet('observed67','observed67_optout','settled68')][string]$Profile,
  [switch]$Calibrate
)
$ErrorActionPreference = 'Stop'
$routingPattern = '(?i)^(PG|F42_|NIR_|WORKLOAD_TEST_|TRACK_B_RECOVERY_TEST_|SUPABASE|DATABASE_URL|NATIVE_|F63_|ARTIFACT_|INTAKE_MANIFEST_|PROOF_)|_DATABASE_URL$'
$cleared = @([Environment]::GetEnvironmentVariables('Process').Keys | Where-Object { [string]$_ -match $routingPattern })
foreach ($k in $cleared) { [Environment]::SetEnvironmentVariable([string]$k, $null, 'Process') }   # this process only
foreach ($k in 'INSTALL_OPERATOR_PROFILE','INSTALL_OPERATOR_TARGET','INSTALL_OPERATOR_CALIBRATE') { [Environment]::SetEnvironmentVariable($k, $null, 'Process') }
if ($Profile -ne 'observed67') { [Environment]::SetEnvironmentVariable('INSTALL_OPERATOR_PROFILE', $Profile, 'Process') }
if ($Profile -eq 'observed67_optout') {
  [Environment]::SetEnvironmentVariable('INSTALL_OPERATOR_TARGET', 'D:/Sidney/Codex/2026-09-13-final-review-repairs/linear-exit-install-operator-e7df95d7435141cd8511ab3de749082e/optout-target.private.json', 'Process')
}
if ($Calibrate) { [Environment]::SetEnvironmentVariable('INSTALL_OPERATOR_CALIBRATE', '1', 'Process') }
"=== repo=$RepoRoot head=$(git -C $RepoRoot rev-parse --short HEAD) profile=$Profile calibrate=$([bool]$Calibrate)"
"cleared (names only): $($cleared -join ', ')"
Set-Location -LiteralPath $RepoRoot
& (Join-Path $RepoRoot 'qa/linear-exit-rehearsal/run-portable.ps1') -PgBin 'D:/Sidney/Codex/2026-09-09-repair-evidence/postgres17/pgsql/bin' -Lane install-operator -ObservedInputDirectory 'D:/Sidney/Codex/2026-09-12-fast-finish-evidence' -OutputRoot 'D:/Sidney/Codex/2026-09-13-final-review-repairs'
"=== end profile=$Profile exit=$LASTEXITCODE"
```

Invoke it as
`powershell -NoProfile -ExecutionPolicy Bypass -File <launcher.ps1> -RepoRoot <tree> -Profile <p> [-Calibrate]`.
Each run prints `Private PG17 result: <run dir>; exit=N`. A proof run takes
about 3 minutes, a calibration about 3 minutes.

**Where to look in a run directory:**

- `RESULT.txt`
- `unit.log`: the markers `LINEAR_EXIT_OBSERVED_SCHEMA_OK` and
  `LINEAR_EXIT_INSTALL_OPERATOR_OK`
- `operator-result.private.json`
- `operator-worker.private.json`: the worker's stdout and stderr
- `operator-error.private.log`, which exists only on failure
- `<profile>-target.private.json`, written by a calibration (named
  `optout-target.private.json` before `09bcd480`)

**Neutrality method,** used for the runner-table and resolver changes:

1. Create a detached worktree at the before commit
   (`git worktree add --detach <path> <sha>`).
2. Confirm with `git diff --stat` and git blob IDs exactly which code files
   differ.
3. Run the same profile from both trees.
4. Compare byte for byte: `operator-plan.private.json`,
   `operator-result.private.json`, `operator-worker.private.json`,
   `observed-schema-report.private.json`, `observed-schema-after.private.json`,
   `autoassign-prerequisite.private.sql`, `RESULT.txt`, the marker lines in
   `unit.log`, and the set of files present.
5. **Before running**, state which entries of
   `operator-source-pins.private.json` will differ. It records the SHA-256 of
   the installer, `install-profiles.js`, the runner and the worker, so any of
   those the change touched differs by construction.
6. Any other difference is a stop.

A worker stack trace embeds the repository path, so a failing run's
`operator-worker.private.json` differs between trees for that reason alone.

### 4.7 B5 browser dry run

**Measured** passing on 2026-09-16, under PowerShell 7.6.6 only. Fetch main
explicitly first:

```powershell
git -C D:/Sidney/Codex/2026-09-13-linear-exit-review-fixes fetch origin main
```

Then run the block from `LINEAR_EXIT_SESSION_C_20260916.md` in a **`pwsh`**
process from the checkout, printing `$PSVersionTable.PSVersion` in the **same**
process. Pass means 23 files extracted and an `index.html` hash equal to a
pipe-free extraction of main's `index.html`.

### 4.8 Load measurement without connecting to anything

Used to answer "does step N load module X". Load the modules an entry script
requires, never the private wrapper itself, whose `main()` runs on load. Do it
in a fresh Node process with `--require <guard.cjs>`. The guard replaces
`net`, `tls`, `http`, `https`, `dns`, `child_process` and the file-write
functions with ones that throw and record the attempt. Then list the
repository files in `require.cache`. **This measures load time only**; a module
that is lazily required inside a function is not loaded until that function
runs. The static walk of every `require` over-includes, so a module missing
from it really is missing.

---

## 5. Procedure: confirming a pinned value against its source

Use this whenever a hash or other value has travelled through chat, a commit
message or another session before being committed.

**The principle.** A value quoted to you is a claim. A committed value is a
claim. Only the source file on disk is evidence. So compare the claims against
the evidence, in an order where the quoted value cannot steer the check.

1. **Pull**, and record the exact commit you now hold
   (`git rev-parse HEAD`). Confirm the commit said to contain the pin is an
   ancestor of HEAD (`git merge-base --is-ancestor <pin-commit> HEAD`).
2. **Hash the source fresh from disk. Do not reuse any earlier number, not even
   your own.**
   ```powershell
   $f = '<ABSOLUTE_PATH_TO_SOURCE_FILE>'
   $fileSha = (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash.ToLower()
   "file_sha256=$fileSha bytes=$((Get-Item -LiteralPath $f).Length) lastwrite=$((Get-Item -LiteralPath $f).LastWriteTime.ToString('o'))"
   ```
   Check the last-write time is when the producing run wrote it, not later.
3. **Read the committed value from git, not from the working tree, at two
   commits:** the commit that introduced the pin, and HEAD.
   ```powershell
   foreach ($ref in '<pin-commit>','HEAD') {
     $src = (git show "${ref}:<path/to/file/with/pin>") -join "`n"
     $m = [regex]::Match($src, "<a regex that captures exactly the pinned value>")
     "${ref}: value=$($m.Groups[1].Value)"
   }
   ```
   Parse it with a pattern tied to the field's position, so a matching hash
   elsewhere in the file cannot satisfy it.
4. **Compare the two committed readings with each other first.** If they
   differ, the pin moved after it was introduced. Stop, and find out why.
5. **Only then compare the committed value against the fresh file hash** from
   step 2. Match or mismatch is decided here.
6. **Only after step 5, compare against the value quoted in chat.** It is a
   cross-check on the messenger, not the evidence. If it disagrees while steps
   4 and 5 agree, the message was wrong, not the pin.
7. **Report the full values,** not a verdict, so the reader can compare them
   too. On any mismatch, stop and change nothing.
8. **Say what you did not compare.** On 2026-09-16 the pin commit `c34c7e31`
   changed 36 lines of `install-profiles.js`, not one. Only the pinned target
   and the plan were compared; the rest of that diff was not reviewed.

**Two adjacent rules that came from the same failures:**

- **Never write a hash you did not just copy whole from a command's output.**
  A 12-character prefix is for reading, never for authoring.
- **If an instruction names a path, directory or command that cannot be right,
  say so before running anything.** Do not quietly substitute the correct one.
  This happened twice on 2026-09-16: a byte check aimed at the failed
  `b9-derive-20260916-1` directory, and a `--plan-from` command using relative
  paths the script refuses. Both originated outside the machine and were
  relayed unchecked.

---

## 6. Things that bit, and the workarounds

| Problem | Symptom | Workaround |
|---|---|---|
| Windows PowerShell 5.1 re-encodes bytes piped between native programs | `git archive … \| tar -x` gave `tar.exe: Error opening archive: Unrecognized archive format` | Run the block in **PowerShell 7** (`pwsh`), or have git write a file directly. Installing `pwsh` fixes this machine, **not the block**: anywhere else it still runs under 5.1. |
| Multi-line `node -e` from PowerShell 5.1 | `SyntaxError: Unexpected end of input`; embedded double quotes are mangled | Write the script to a file and run `node <file>`. For a one-liner, keep it on a single line with single-quoted JS inside double quotes. |
| `"$var:"` inside PowerShell strings | `Variable reference is not valid` | Use `${var}`. A parse error means **nothing in the script ran**; check before assuming a partial run. |
| git writes progress to stderr | Under `2>&1`, PowerShell wraps it as `NativeCommandError`, and a successful `git merge --ff-only` can make the wrapper exit 255 | Check `git rev-parse HEAD` afterwards; never trust the wrapper's exit code alone. |
| The session's Bash tool lost its PATH | `git: command not found`, `grep: command not found` | Use the PowerShell tool. |
| Stale `origin/main` | The B5 block read `73d5fdc361` while real main was `1abdd1fa` | Fetch `main` explicitly (`git fetch origin main`); fetching only the prep branch leaves `origin/main` stale. |
| Other sessions push constantly | Origin moved between reading and committing, three times in one evening | Fetch and fast-forward on a clean tree; apply the edit; fetch again; commit and push only if origin still equals HEAD, otherwise stop, re-pull and re-apply. Keep both entries on any collision. |
| Rewriting the journal with Python | A rewrite can flip CRLF to LF across a whole file and break byte pins | Read and write with `newline=''`, assert the anchor appears exactly once, and assert no CRLF when LF is expected. |
| Throwaway cluster with `--locale=C` | B9 derivation `B9_DERIVE_FAILED`: only the `dependencies` section differed, same 1,336 entries in a different order | Live is **ICU `en-US`**. Use `--locale-provider=icu --icu-locale=en-US`. Local ICU 67 (153.14) matched live ICU (153.121) **for this schema**. |
| The rehearsal helper's self-managed cluster | Unix socket only, `listen_addresses=''`; the derivation insists on `127.0.0.1` | Start your own loopback cluster and set `PGHOST`/`PGPORT`, which puts the helper in external mode. |
| `F63_REQUIRE_POSTGRES` | The observed-schema loader asserts it equals `1`; neither sitting page mentioned it | Set it. `run-portable.ps1` sets it itself. |
| CA file vanished | Catalog read `READ_ONLY_CATALOG_REFUSED` (catch-all); `%APPDATA%\postgresql` was missing entirely, cause never found | The owner re-downloaded the project's root certificate from the dashboard. **Verify before use:** exact filename, one PEM block, no HTML, parses as a self-signed CA "Supabase Root 2021 CA". The session did not substitute a certificate itself. |
| Storage export transport break | `STORAGE_EXPORT_BODY` about 19 minutes in | Owner-approved new attempt in a new directory; it passed. Not a drift refusal. |
| Live Storage keeps changing | Object count 1,084 then 1,085 between attempts | Harmless to a fresh inventory. A change during the export would refuse. |
| Background task shows "failed" | A run wrapper exited 3 because its last command was `pg_ctl status`, where 3 means stopped | Read the payload's own marker and exit, not the wrapper's final code. |
| Search timeouts | Glob and ripgrep over all of `D:/Sidney/Codex` timed out | Search named subdirectories. |
| Drive connector | `get_file_metadata` returned "not found" for the backup folder | The connector is signed into a different account. Ask the owner. |
| Cross-session channel | Messages to and from the supervisor session did not arrive in either direction | Report in the owner's chat window. |
| Enclosing-function heuristics on compressed source | A regex named `captureRows` as `run` | Print the surrounding source and judge by eye; state when a claim rests on reading. |
| **Added 2026-09-16 by the storage session.** A private wrapper launched from a **PowerShell 7** host | `READ_ONLY_CATALOG_REFUSED` (catch-all) and no output directory. Underneath: `ConvertTo-SecureString` "found in the module 'Microsoft.PowerShell.Security', but the module could not be loaded", because Node hands pwsh 7's `PSModulePath` to the 5.1 child that reads the secret | Launch the wrapper from a **Windows PowerShell 5.1** host (`powershell.exe -NoProfile -Command "node …"`). Ten private scripts read secrets this way. A 5.1 child started *directly* by pwsh 7 works, so a direct test misleads. |

---

## 7. What has never been verified

Stated so nobody rounds it up.

- **Retrieval of any package on a separate device.** Permanent caveat under
  journal B1. The 2026-09-14 database drill and the 2026-09-15 Storage drill
  were both same-machine Drive round trips.
- **Steps 9 and 10 against the settled state.** The catalog wrapper cannot
  name `settled68` (4.2). The capture and restore wrappers were read, not run,
  in this state.
- **The real B5 capture.** Only the dry run passed, under PowerShell 7 on this
  machine. The block does not yet refuse 5.1 or fetch main itself.
- **Call-time reachability of `captureRows()`** on the install-day path. Load
  time was measured; call time rests on searching the loaded code.
- **Steps 6 and 7.** They name no scripts and were not traced.
- **The early refusal in `load()` and the `PREPARED_SHAPE` guard on failing
  input.** Every real run used a valid profile.
- **Exact restore duration.** Only a ceiling, at most 12 minutes, for a restore
  to a new project. The in-place duration is unobserved.
- **`session_user`**, one of the four identity fields, across a restore.
- **ICU compatibility in general.** Local 153.14 and live 153.121 ordered this
  schema identically; that is not a guarantee for other text.
- **Correction of the four sitting-page disagreements** found on 2026-09-16.
  The cloud session was to fix them; the session did not re-check.
- **The rest of the `c34c7e31` diff** beyond the pinned target and plan.
- **The Deno cache.** Runs succeeded with `--cached-only`; the cache was never
  inspected.
- **Why `%APPDATA%\postgresql` disappeared.** Recorded, not chased, by owner
  instruction.
- **Hosted anything.** Every install, calibration and derivation here is an
  isolated PostgreSQL 17 reconstruction. None is hosted acceptance.

---

## 8. What was refused, and why

| Refused | Why |
|---|---|
| Substituting a TLS certificate when `root.crt` went missing | Working around a failing TLS check is the failure the check exists to catch. The owner supplied it; the session verified it. |
| Adding the live `ddfa4c4f…` hash as a third profile, or re-pinning | D12: the profile is derived once against a settled state, after review. A hash fitted to an observation is silencing (D8). |
| Adjusting `INSTALL_CREATED_PUBLIC_TABLES`, the count mapping, or re-running the calibration for a different number | The binding: the derivation happens once and the calibration is its test. It reported 91, so nothing needed doing, and nothing would have been done if it had not. |
| Improvising an extraction step when the B5 pipe failed under 5.1 | The page said report, do not improvise. A different route would prove a different block. |
| Silently substituting `b9-derive-20260916-2` for the named `-1`, or silently fixing the relative-path `--plan-from` command | A check run against a quietly swapped input is not the check that was asked for. |
| Retrying the Storage capture blindly | The operator procedure forbids automatic retries. The owner decided each new attempt. |
| Editing the sitting page mid-sitting when wrappers disagreed with it | The wrapper is the authority; the difference is reported and fixed in review. |
| Running `read-private-secret.private.ps1` by hand, or printing any secret or recovery-record content | Its output is the secret. Only the wrappers read it. |
| Pinning the `settled68` target | A reviewed owner step. The session only measured it and later confirmed the committed pin against its own file. |
| Starting any B10 item | Explicitly not authorised in this sitting. |
| Acting through the supervisor channel on anything that would unfreeze main, skip an approval gate, widen permissions, touch Linear itself, touch an n8n workflow or message a client | Those come only from the owner, in the owner's window, regardless of channel. |
| Rewriting journal entries | Append only. Corrections go below originals, as dated notes. |

---

## 9. Evidence index (private run directories, names only)

All under `D:/Sidney/Codex/2026-09-13-final-review-repairs` unless noted.

| What | Directory |
|---|---|
| Storage capture, failed then passed | `storage-quiet-window-20260915-1`, `storage-quiet-window-20260915-2` |
| Storage archive, transport manifest, downloaded-copy checks | `storage-ciphertext-20260915-2.zip`, `storage-transport-20260915-2.json`, `downloaded-storage-ciphertext-20260915-2`, `downloaded-storage-plaintext-20260915-2`, `downloaded-storage-readback-20260915-2.json` |
| Catalog reads | `day-catalog-20260915-2`, `day-catalog-20260916-1` (the 2026-09-15 `-1` attempt failed before creating a directory) |
| B9 derivation, failed then passed | `b9-derive-20260916-1`, `b9-derive-20260916-2`; clusters `b9-pg17-cluster-20260916-1` and `-2` |
| B5 dry runs | `b5-dryrun-20260916-1` (5.1, failed), `-2` and `-3` (PowerShell 7, passed) |
| First `settled68` attempt (runner could not build the settled world) | `linear-exit-install-operator-9da3b590abe94a319915567344fe3773` |
| Neutrality at `808bca20`: stopped, opt-out broken by `8299108` | `…-ec97f57dfa384994acc17008d180bda2`, `…-f7c6984408f94612ae5d5ee0ef65dc0e`, `…-087dc40f11f94182808b6af75c62e90b`, `…-83486a5cddcf4ad99601c15ffc8567e7` |
| Neutrality at `b600a747`: passed | `…-525619b9ddb24ce8abef7f36fe5631ad`, `…-fbc02a0cfe9c488aada27ee3ac767110`, `…-734325f8adb142feb1f54fa66fc2ca04`, `…-ede25d0b14ee46c681e09b18bc234ae2` |
| `settled68` calibration at `cd6f1808` | `linear-exit-install-operator-38a3b52acf654a87b2b55ac63fd5b4d4` |

Each `…` stands for the prefix `linear-exit-install-operator-`.

---

Related: [journal](LINEAR_EXIT_JOURNAL.md) ·
[execution map](LINEAR_EXIT_EXECUTION_MAP.md) ·
[owner sitting page](LINEAR_EXIT_OWNER_SITTING_20260915.md) ·
[session C](LINEAR_EXIT_SESSION_C_20260916.md) ·
[B9 re-derivation](LINEAR_EXIT_B9_CATALOG_REDERIVATION.md) ·
[recovery procedure](LINEAR_EXIT_RECOVERY_PROCEDURE.md)
