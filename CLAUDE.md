# SyncView — session context

Single-file SPA (`index.html`) + Supabase Edge Functions + Postgres migrations,
deployed to `syncview.synchrosocial.com` by GitHub Pages on every push to `main`.
`AGENTS.md` is the house standard and outranks this file; `REPO_MAP.md` is the
directory map. This file exists for the things a session needs in the first
minute and would otherwise ask the owner for — again.

---

## ⛔ THE OWNER'S MACHINE ALREADY HAS THE CAPTURE SCRIPT. DO NOT MAKE THEM REBUILD IT.

Before any F27 Section 4 deploy, a sealed four-function rollback bundle has to be
captured. **It is already automated.** The script lives on the owner's Windows
machine, carries the credentials it needs, and names the file itself — a
content-addressed `syncview-f27-edge-source-<sha256>.sourcebundle` written
beside the script in `%USERPROFILE%\.syncview\`, whose full path it prints on
its last line. Read that line rather than assuming a folder; an earlier version
of this file said `C:\F27-Bundles\`, which is not where run #37's bundle
landed:

```powershell
& "$env:USERPROFILE\.syncview\f27-capture.ps1"
```

**Hand over that line, not the alias.** `f27capture` is the same script aliased
in the owner's `$PROFILE`, and it is shorter — but on 2026-09-05 it answered
`CommandNotFoundException` in a fresh window (the profile had not loaded), which
cost a round trip in the middle of a deploy. The full path always works, so lead
with it and mention the alias only as the shorthand.

**RUN IT FROM ANY DIRECTORY — there is no `cd` to work out, and the owner should
never be left wondering where to launch PowerShell from.** The script cds into
the repo itself and loads its own `PROJECT_REF` / `SUPABASE_ACCESS_TOKEN` from a
sibling file in `.syncview\` (see `AGENTS.md`), and every path it uses is
absolute. A fresh PowerShell window at the default `C:\Users\<name>` prompt is
exactly right. If a session is ever asked "where do I run this from", the answer
is *anywhere* — do not send the owner hunting for a folder.

**Do NOT** hand them the raw PowerShell from
`docs/ops/F27_SECTION4_CAPTURE_PLAYBOOK.md` step by step, do NOT ask for or
about their Supabase access token, and do NOT ask them to build a script. The
playbook documents what the script automates — it is the reference, not the
instruction. Asking the owner to re-derive this by hand has now happened more
than once and it is the single most reliably annoying thing a session does here.

### THE BUNDLE GOES TO DRIVE **BEFORE** THE DISPATCH, NOT AFTER

The order below is load-bearing and this file used to state it backwards, which
failed run #37 on 2026-09-05:

1. Run the capture.
2. **Drag the named `.sourcebundle` into the `SyncView Backups/` Shared Drive
   root.** The script prints its full path on the last line.
3. *Then* dispatch, pasting `sealed_bundle_sha256` and
   `sealed_bundle_byte_length` from the receipt.

The lane does not receive the bundle — it FETCHES it out of Drive by
content-addressed name during the run, and verifies an independent round-trip.
Dispatching first fails in about 20 seconds with:

```
{"status":"FAIL","code":"OBJECT_MISSING",
 "message":"The content-addressed private object was missing."}
##[error]The sealed prior-four private fetch or independent round-trip failed
```

**That error means the upload, nothing else.** Nothing deployed, the capture is
still valid because the live set did not move, and main is still the right SHA —
so the recovery is: upload, then `Re-run jobs` on the same run, which keeps all
five inputs. Do not re-capture and do not retype anything.

Capture minutes before dispatching — a bundle that sealed an older live set
restores the wrong code, and every earlier bundle is stale the moment a deploy
succeeds.

---

## Deploy lanes, and which need what

| Lane | Needs a capture? | Inputs |
|---|---|---|
| `deploy-f27-section4-closures.yml` (`linear-outbound`, `production-write`, `deliverable-write`, `batch-write`) | **Yes** — run the script above | commit SHA, `deploy-reviewed-release`, `DEPLOY_REVIEWED_F27_SECTION4_CLOSURES`, bundle sha256, bundle byte length |
| `deploy-f27-linear-inbound.yml` (`linear-inbound`) | **No** — its bundle is pinned as `V39_BUNDLE_SHA256` | commit SHA, `deploy-reviewed-release`, `DEPLOY_REVIEWED_LINEAR_INBOUND` |

Always give the owner the **direct Actions URL**, never just the workflow name,
and state which commit SHA to paste.

**DO NOT MERGE ANYTHING between handing over a deploy SHA and the owner's
dispatch.** The Section 4 lane requires `commit_sha` to equal main's tip *at
dispatch time*. A dispatch was rejected on 2026-09-02 because a docs PR was
merged in that window, and on 2026-08-08 because four PRs were. It fails in
about 19 seconds and deploys nothing, so the cost is only a wasted cycle and the
owner's patience — but it is entirely avoidable by simply not merging until they
say it is green.

Both lanes refuse on a fingerprint mismatch, which means they **fail closed**: a
wrong digest cannot deploy the wrong code, it can only decline to deploy. Digests
are **per function**, so two PRs re-pinning different functions do not conflict.
Regenerate with `node scripts/ef-fingerprint.js <sha> --slugs=<slug> --expected-only`
— never by hand.

---

## Standing constraints

- **The repo is PUBLIC.** No secrets, tokens, client display names or share-link
  tokens in code, comments, commit messages, test fixtures or CI output. Client
  **slugs** are fine; prefer counts over names.
- **Mutate only the test client `sidneylaruel`** unless the owner names another.
- **Never edit an n8n workflow** without the owner's explicit go-ahead in that
  same request. They are production sales automation.
- **Sub-issue creation must not be possible from SyncLinear** — only from the
  content calendar.
- The owner has decided **not** to rotate the Supabase publishable key. Do not
  raise it again.

## Things that will waste a cycle if you forget them

- `npm test` is the full suite and takes several minutes. `npm run test:prod-polish`
  **cannot pass in a sandbox with no route to the live backend** — all 8 lanes
  fail identically on `origin/main`, so verify against `main` before calling it a
  regression. Its heavy lanes only run post-merge (`if: github.event_name != 'pull_request'`).
- `docs/ops/OPEN_REPAIRS.md` is the ledger and the owner cares about it. Append,
  never rewrite. **Check for duplicate `## N.` headers after any merge** —
  concurrent branches routinely claim the same number.
- With the browser publishable key you can READ most tables but write nothing;
  `production_comments` and every `production_comment_*` table return 42501.
- A refused write leaves no server-side trace — only a 50-row `localStorage` ring
  in the browser it happened in (OPEN_REPAIRS 101). This is why client-reported
  bugs are hard to diagnose here, and it is the highest-value thing left to build.
