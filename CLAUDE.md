# SyncView — session context

index.html is a build output; edit src/index/ fragments and run npm run build:index, never edit index.html directly

Single-file SPA (`index.html`) + Supabase Edge Functions + Postgres migrations,
deployed to `syncview.synchrosocial.com` by GitHub Pages on every push to `main`.
`AGENTS.md` is the house standard and outranks this file; `REPO_MAP.md` is the
directory map. This file exists for the things a session needs in the first
minute and would otherwise ask the owner for — again.

---

## ⛔ THE OWNER'S MACHINE ALREADY HAS THE CAPTURE SCRIPT. DO NOT MAKE THEM REBUILD IT.

Before any F27 Section 4 deploy, a sealed three-function rollback bundle (`production-write`, `deliverable-write`, `batch-write`) has to be
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
##[error]The sealed prior-three private fetch or independent round-trip failed
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
| `deploy-f27-section4-closures.yml` (`production-write`, `deliverable-write`, `batch-write`) | **Yes** — run the script above | commit SHA, `deploy-reviewed-release`, `DEPLOY_REVIEWED_F27_SECTION4_CLOSURES`, bundle sha256, bundle byte length |

The two Linear sync functions (`linear-inbound`, `linear-outbound`) and the
`deploy-f27-linear-inbound.yml` lane were deleted on 2026-09-24 (B2 Slices 7
and 8). Their source stays in the repo only as a frozen reference; there is no
deploy path for them. The capture script's slug list must read
`--slugs=production-write,deliverable-write,batch-write`.

Always give the owner the **direct Actions URL**, never just the workflow name,
and state which commit SHA to paste.

**DO NOT MERGE ANYTHING between handing over a deploy SHA and the owner's
dispatch.** The Section 4 lane requires `commit_sha` to equal main's tip *at
dispatch time*. A dispatch was rejected on 2026-09-02 because a docs PR was
merged in that window, and on 2026-08-08 because four PRs were. It fails in
about 19 seconds and deploys nothing, so the cost is only a wasted cycle and the
owner's patience — but it is entirely avoidable by simply not merging until they
say it is green.

The lane refuses on a fingerprint mismatch, which means they **fail closed**: a
wrong digest cannot deploy the wrong code, it can only decline to deploy. Digests
are **per function**, so two PRs re-pinning different functions do not conflict.
Regenerate with `node scripts/ef-fingerprint.js <sha> --slugs=<slug> --expected-only`
— never by hand.

---

## Standing constraints

- **The repo is PUBLIC.** No secrets, tokens, client display names or share-link
  tokens in code, comments, commit messages, test fixtures or CI output.
  **Client slugs are NOT fine either** — this line used to say they were, and
  that cost a red `identity-exposure` on #1371 on 2026-09-09. The gate
  (`scripts/repo-identity-exposure-check.js`) checks the live roster's client
  slugs alongside staff full names and fails on any slug a change ADDS, so a
  slug in a code comment, a ledger entry or a test comment is a blocked merge.
  Record the measurement by card/deliverable id and say "one active client
  slug"; prefer counts over names. Run it before pushing:
  `node scripts/repo-identity-exposure-check.js --diff="origin/main"` — it
  reads the diff of your COMMITTED work, so commit first, and it prints file
  counts only, never what it matched.
- **Mutate only the test client `sidneylaruel`** unless the owner names another.
- **A prompt handed to an executor session must SAY, in a sentence, which session
  it is for.** Write `You are the session named Mirror.` — not `Mirror:` and not
  `Mirror <instruction>`. A bare name followed by a colon reads as punctuation,
  not identity, and the receiving session cannot tell it is being addressed by
  name. This matters because Codex renames sessions on completion, so the name
  in the prompt body is the only durable handle the owner has when pasting.
  Owner's instruction, 2026-09-22.
- **Never edit an n8n workflow** without the owner's explicit go-ahead in that
  same request. They are production sales automation.
- **Sub-issue creation must not be possible from SyncLinear** — only from the
  content calendar.
- The owner has decided **not** to rotate the Supabase publishable key. Do not
  raise it again.

## Things that will waste a cycle if you forget them

- `npm test` is the full suite and takes several minutes. `npm run test:prod-polish`
  **cannot pass WHOLE in a sandbox with no route to the live backend** — the
  live-read lanes fail identically on `origin/main`, so verify against `main`
  before calling one a regression. Its heavy lanes only run post-merge
  (`if: github.event_name != 'pull_request'`).
  **But two fast-lane suites DO run offline, and one of them is the browser
  gate for Create Post** (measured 2026-09-08):
  `node docs/syncview-design/tests/prod-write-gateway-browser.js` is fully
  mocked and drives the Calendar dialog end to end, and
  `prod-boot-budget.js` runs too. Run the first before pushing any
  `index.html` change to the Calendar or Production write surfaces. This line
  used to say all lanes fail here; reading that as "none of it runs" is what
  put a red `production-polish` on #1353.
- `docs/ops/OPEN_REPAIRS.md` is the ledger and the owner cares about it. Append,
  never rewrite. **Check for duplicate `## N.` headers after any merge** —
  concurrent branches routinely claim the same number.
- With the browser publishable key you can READ most tables but write nothing;
  `production_comments` and every `production_comment_*` table return 42501.
- A refused write leaves no server-side trace — only a 50-row `localStorage` ring
  in the browser it happened in (OPEN_REPAIRS 101). This is why client-reported
  bugs are hard to diagnose here, and it is the highest-value thing left to build.
- **A gate that has never run against its real target is untested.** The
  Linear-exit deploy preflight first executed live on 2026-09-17, inside a
  dispatch, and refused **10 of 156 keys** — so the release stopped at the
  gate instead of at a plan. Run a lane's read-only preflight from the owner's
  machine BEFORE dispatching, never for the first time inside the dispatch.
- **Supabase grants `service_role`, `anon` and `authenticated` full rights on
  every new object by default**, so a `revoke` must name every role it means.
  A list that omits a role has not revoked from that role, and "we revoked it"
  is not the same claim as "that role cannot do it". Two migrations revoked
  `from public, anon, authenticated` and left `service_role` holding EXECUTE
  and sequence UPDATE; a first repair named only `anon` on the sequences and
  left `authenticated` holding USAGE, SELECT and UPDATE. Name all four, or
  measure the ones you left out.
- **A byte-order mark in an Edge Function source deploys fine and then fails
  the attestation.** Those three invisible leading bytes are stripped by the
  deploy tooling on upload, while the fingerprint hashes the committed bytes,
  so the live source can never equal the expected source and redeploying never
  helps. The release lane deploys BEFORE it attests, so the code is already
  live when the run goes red. `npm test` now fails on any mark under
  `supabase/functions`; strip the bytes, never re-pin the fingerprint to them.
