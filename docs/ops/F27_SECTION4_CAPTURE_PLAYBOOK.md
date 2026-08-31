# F27 Section 4 — capturing the sealed rollback bundle (owner, Windows)

The deploy lane (`.github/workflows/deploy-f27-section4-closures.yml`) will not
touch a function until it can **fetch and independently verify a rollback
artifact that already exists in Drive**. Two of its five inputs
(`rollback_bundle_sha256`, `rollback_bundle_byte_length`) name that artifact.
The lane does not create it. You do, on your machine, before dispatching.

`docs/ops/COMMENT_GATEWAY_ROLLOUT.md` §A.1 gives the one command that produces
it. This file exists because that command is not the part that goes wrong. What
goes wrong is everything around it — where the file may live, what it must be
called, and which Drive folder it lands in — and each of those fails *closed*,
several minutes into a dispatch, with an error that does not name the cause.

Written after the 2026-08-31 deploy, where the rename step was worked out
mid-flow while three staff were blocked on the fix being deployed.

## 0. What the numbers are for

The bundle seals the **currently live** four functions, so a failed forward
deploy can be restored to exactly what was running before it. It is captured
minutes before the dispatch, not reused from a previous one: a bundle sealing
an older live set restores the wrong code. Every earlier bundle is stale the
moment a deploy succeeds.

## 1. Capture

PowerShell, one line per step. Do not use backtick line-continuations when
pasting interactively — a blank line between them breaks the continuation and
PowerShell runs each fragment as its own broken command.

```powershell
# A directory OUTSIDE any git worktree. validatePrivateBundlePath refuses a
# path inside one (BUNDLE_PATH_WORKTREE), refuses a relative path
# (BUNDLE_PATH_NOT_ABSOLUTE), and refuses a destination that already exists
# (BUNDLE_DESTINATION_EXISTS) -- so the filename carries a timestamp.
New-Item -ItemType Directory -Force -Path 'C:\F27-Bundles' | Out-Null
$bundle = "C:\F27-Bundles\prior-four-$(Get-Date -Format 'yyyyMMdd-HHmmss').sourcebundle"

$env:PROJECT_REF = 'uzltbbrjidmjwwfakwve'
$env:SUPABASE_ACCESS_TOKEN = '<your token — never paste it into a chat, a file, or a commit>'

# Run from the repo: the script path is repo-relative, the bundle path is not.
Set-Location 'C:\Users\<you>\client-analytics'
node scripts/f27-edge-source-rollback.js capture --slugs=linear-outbound,production-write,deliverable-write,batch-write --bundle=$bundle

Remove-Item Env:\SUPABASE_ACCESS_TOKEN
```

The receipt must show `"result": "PASS"`, `"provider_contract": "PASS"` and
`"provider_source_exactness": "PASS"`. Take exactly two values from it:

| receipt field | workflow input |
|---|---|
| `sealed_bundle_sha256` | `rollback_bundle_sha256` |
| `sealed_bundle_byte_length` | `rollback_bundle_byte_length` |

Sanity check worth doing: each function's `source_closure_sha256` in the
receipt should equal what that function is running now. For `production-write`
that is the pin in the deploy workflow **before** the release you are about to
deploy. If it does not match, the capture sealed something other than the live
set and the rollback would restore the wrong code.

## 2. Get it into Drive — two ways, and the first is better

### 2a. The uploader (preferred)

`scripts/f27-private-snapshot-store.js` derives the content-addressed name from
the file's own hash, uploads it to the Shared Drive root, and performs an
independent readback. Nothing to rename, and nothing to get wrong:

```powershell
$env:F27_CONFIRM_PRIVATE_SNAPSHOT_UPLOAD = '1'
$env:TRACK_B_BACKUP_DRIVE_FOLDER_ID = '<the SyncView Backups root folder id>'
$env:TRACK_B_BACKUP_GOOGLE_CREDENTIALS_JSON = '<the scoped service-account JSON>'
node scripts/f27-private-snapshot-store.js --artifact-kind edge-source --source $bundle --expected-sha256 <sealed_bundle_sha256>
Remove-Item Env:\TRACK_B_BACKUP_GOOGLE_CREDENTIALS_JSON, Env:\F27_CONFIRM_PRIVATE_SNAPSHOT_UPLOAD
```

Those two Drive values are the same secrets the workflow uses. If you do not
have them on your machine, use 2b.

### 2b. Rename and drag-and-drop (fallback)

The fetcher looks the artifact up **by exact, content-addressed name** and
fails closed on anything else, so the timestamped capture filename will not be
found. Rename it to `syncview-f27-edge-source-<sha256>.sourcebundle`, using the
`sealed_bundle_sha256` from the receipt:

```powershell
Rename-Item -Path $bundle -NewName "syncview-f27-edge-source-<sealed_bundle_sha256>.sourcebundle"
Get-ChildItem C:\F27-Bundles | Select-Object Name, Length
```

`Length` must equal `sealed_bundle_byte_length`. The name and the bytes have to
agree or the fetch fails.

Then upload it to the **`SyncView Backups/` Shared Drive ROOT**. Three things a
manual upload can quietly break, each of which fails the lane rather than the
upload:

* **Not the `track-b-backups/` child.** That folder is the weekly Track-B
  snapshot store; the F27 artifacts live at the root.
* **It must be the sole file with that exact name.** The fetcher does an
  exact-name lookup and refuses an ambiguous result, so delete any older copy
  carrying the same name first.
* **mimeType must be `application/octet-stream`.** Drive infers type from the
  extension and does not recognise `.sourcebundle`, so it normally lands
  correctly — but a client that rewrites the extension, or an upload that lets
  Drive convert the file, will not.

## 3. Dispatch

Actions → **Deploy F27 Section 4 closures** → Run workflow, branch `main`:

| input | value |
|---|---|
| `commit_sha` | current `main` head, 40 lowercase hex |
| `operation` | `deploy-reviewed-release` |
| `confirm` | `DEPLOY_REVIEWED_F27_SECTION4_CLOSURES` |
| `rollback_bundle_sha256` | from §1 |
| `rollback_bundle_byte_length` | from §1 |

**Re-read `main`'s head immediately before pressing Run, not when you prepare
the rest.** The lane requires the input to equal main's tip *at dispatch time*.
A dispatch was rejected in 16 seconds on 2026-08-08 because four PRs merged
inside an hour while the inputs were being assembled (EXECUTION_LOG). Nothing
was touched, but it cost a cycle. The other four inputs are stable; only
`commit_sha` decays.

A failed or ambiguous forward is **never** retried forward. Use the same lane's
`restore-captured-prior-four` with `RESTORE_CAPTURED_F27_SECTION4_CLOSURES` and
the same two bundle values.

## 4. Secret handling

The Supabase access token grants deploy and full project read, and this
repository is public. It goes in an environment variable in your own shell and
nowhere else — not in a chat, a file, a commit, a screenshot or a job summary.
If one is ever exposed, rotate it at the Supabase dashboard account tokens page
before anything else; rotating does not invalidate a bundle already captured.

The receipt's hashes and byte length are safe to share. The Drive folder id and
the service-account JSON are not.
