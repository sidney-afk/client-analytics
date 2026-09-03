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
machine, carries the credentials it needs, writes to `C:\F27-Bundles\` and names
the file itself:

```powershell
f27capture
```

That is the whole instruction. Give them that word. It is aliased in the owner's
`$PROFILE` (recorded in `AGENTS.md`); if the alias ever misses, the same script
is:

```powershell
& "$env:USERPROFILE\.syncview\f27-capture.ps1"
```

**Do NOT** hand them the raw PowerShell from
`docs/ops/F27_SECTION4_CAPTURE_PLAYBOOK.md` step by step, do NOT ask for or
about their Supabase access token, and do NOT ask them to build a script. The
playbook documents what the script automates — it is the reference, not the
instruction. Asking the owner to re-derive this by hand has now happened more
than once and it is the single most reliably annoying thing a session does here.

After it runs: take `sealed_bundle_sha256` and `sealed_bundle_byte_length` from
the receipt, hand them to the deploy form, and the owner drags the bundle into
the SyncView backup folder on Drive. Nothing else.

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
