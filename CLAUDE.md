# SyncView — session context

**Every session: read `docs/STATE_OF_THINGS.md` first.** It is the live-verified list of what is open, dormant and done, outranks older plans, and opens with the owner's priority order.

index.html is a build output; edit src/index/ fragments and run npm run build:index, never edit index.html directly. It is NOT committed (since 2026-10-15): never `git add` index.html, js/sv-*.js or src/index/INDEX.md; the Pages publish and CI build them

Single-file SPA (`index.html`, built from `src/index/`) + Supabase Edge Functions + Postgres migrations,
built and deployed to `syncview.synchrosocial.com` by `pages-site.yml` on every push to `main`;
Edge Functions deploy on merge too (above).
`AGENTS.md` is the house standard and outranks this file; `REPO_MAP.md` is the
directory map. This file exists for the things a session needs in the first
minute and would otherwise ask the owner for — again.

---

## ⛔ SIDNEY RUNS NOTHING FOR A DEPLOY. DO NOT SEND HIM A CAPTURE SCRIPT OR A DEPLOY BUTTON.

Since 2026-10-16 (session Conveyor) every Edge Function goes live by itself when
its change merges to `main`, through
[`deploy-edge-functions-on-merge.yml`](.github/workflows/deploy-edge-functions-on-merge.yml)
(runbook: `docs/ops/EF_AUTO_DEPLOY.md`). That includes the three F27 Section 4
functions (`production-write`, `deliverable-write`, `batch-write`): the merge
lane dispatches `deploy-f27-section4-closures.yml` with `capture`, and **that
lane seals the live three into the rollback bundle itself**, stores it
content-addressed in the `SyncView Backups/` Shared Drive root, fetches it back
and verifies it, and only then deploys and attests. The sealed SHA-256 and byte
length are printed in that run's summary; they are the two values a
`restore-captured-prior-three` needs.

**Do NOT** tell Sidney to run `%USERPROFILE%\.syncview\f27-capture.ps1` (or the
`f27capture` alias), drag a `.sourcebundle` into Drive, or paste bundle values.
That was the old way, and it failed on his laptop and made him the bottleneck.
The script still works, and a bundle captured that way is still accepted (pass
its two values instead of `capture`), but no session should ever ask for it. Do
NOT ask for or about his Supabase access token; the lanes hold it in the
`production` Environment.

**What still needs a person, and it is Lighthouse, not Sidney:**

- A merge that ADDS a migration file holds its functions until the migration is
  applied (unless the file says the functions cope without it, or says how to
  tell it is applied; see the runbook). Lighthouse applies it, then runs
  [the merge lane](https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-edge-functions-on-merge.yml)
  by hand: `commit_sha` = that merge, `migrations_applied` = true.
- Anything else the lane holds (a drift guard, a stale Section 4 pin, a failed
  safeguard) is listed in the run summary with how to release it, and the owner
  relay is paged.
- A change to a Section 4 function still has to re-pin its fingerprint in
  `deploy-f27-section4-closures.yml` in the same PR, or that lane refuses:
  `node scripts/ef-fingerprint.js <sha> --slugs=<slug> --expected-only`, never by hand.

**DO NOT MERGE ANYTHING while a Section 4 release is running.** That lane
requires `commit_sha` to equal main's tip at dispatch time (refused on
2026-09-02 and 2026-08-08 because PRs merged in that window). The merge lane
re-reads the tip just before it dispatches and retries once if a merge slipped
in during the dispatch, but it is still cheaper not to race it.

---

## Deploy lanes, and which need what

| Lane | Runs | Needs a person? |
|---|---|---|
| `deploy-edge-functions-on-merge.yml` | Every merge that changes a function, in order (notify, then the Section 4 three, then the comment and archive readers) | Only for a held function (see above) |
| `deploy-f27-section4-closures.yml` (`production-write`, `deliverable-write`, `batch-write`) | Dispatched by the merge lane with `capture`; seals, stores and verifies the rollback bundle in the run | No. Manual fallback: Run workflow with `capture` as both bundle inputs. `capture-only` is a dry run that deploys nothing |
| `deploy-single-function.yml`, `deploy-onboarding-edge-functions.yml`, `deploy-pto-edge-functions.yml`, the thumbnail, hiring, review-link and image-upload lanes | Manual fallback only | Only when a held function needs it |
| `calendar-upsert-live-delta.yml` | Manual; `calendar-upsert` is frozen and never auto-deployed | Yes, as before |

The two Linear sync functions (`linear-inbound`, `linear-outbound`) were deleted
on 2026-09-24. Their source stays in the repo only as a frozen reference; there
is no deploy path for them.

Always give a person the **direct Actions URL**, never just the workflow name,
and state which commit SHA to paste.

The lanes refuse on a fingerprint mismatch, which means they **fail closed**: a
wrong digest cannot deploy the wrong code, it can only decline to deploy. Digests
are **per function**, so two PRs re-pinning different functions do not conflict.

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
  Never seed calendar statuses with raw SQL on a card linked to Production work
  items: the status sync never sees it and the drift robot goes red for days
  (OPEN_REPAIRS 373). Use a throwaway unlinked card, or move the work item.
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
- The owner has decided the **Linear archive rescue (F34) is not needed**
  (2026-09-28): Linear is being cancelled and its text and brief images are
  already in SyncView. Do not raise it again.
- The owner has decided **not** to close the publishable-key reads of exactly
  three relations: `workload_issues`, `workload_issues_native_v1` and
  `production_deliverables_browser_v1` (they return staff names and emails;
  found by Keel on #1840, 2026-09-28). Do not raise those again. This is not a
  blanket Workload exception: `workload_plan` and any other relation must keep
  zero browser privileges, and a new public read anywhere else is a regression.

## Things that will waste a cycle if you forget them

- **Before changing the Higgsfield connector (`supabase/functions/higgsfield-mcp`),
  read `docs/ops/HIGGSFIELD_CONNECTOR_LESSONS.md`** and append a row when a bug
  reaches the team. Above all: make one real cheap call on the live connector
  after any model or setting change, because CI never talks to the providers.

- **Before telling the owner something is not built or not done, check the
  live system or `git log origin/main`, not a doc line or your own summary.**
  Stale "not built yet" lines have misled sessions several times (the refusal
  log, the New issue button, the Linear rescue). If a doc line is wrong, fix it
  in the same PR.

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
- With the browser publishable key you can READ many tables (not the card tables
  closed in #1691 phase 0) but write nothing;
  `production_comments` and every `production_comment_*` table return 42501.
- Refused writes on the Calendar, Samples, Production and intake paths are now
  reported to a server-side write-refusal log (since 2026-09-23; OPEN_REPAIRS 101
  described the old browser-only ring). It is best-effort: the report is
  fire-and-forget, and other surfaces (Filming plans, for one) do not report at
  all, so absence from the log does not prove a save succeeded. Covered
  surfaces are the fragments that call `_writeUiRecordFailure`. Making it easy to
  read, and widening coverage, is priority item 4 in `docs/STATE_OF_THINGS.md`.
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
- **A direct call to `client_profile_admin_edit`, `client_profile_service_write` or
  `smm_assign_client` queues the Sheet copy but never sends it.** Only a request
  through `roster-write`, `client-profile-write` or `client-onboarding` sends the
  queue (nothing does it on a timer), so a backfill by RPC leaves the Clients Info
  and Social Media Managers tabs behind until the next such request. On 26 Oct
  that was 30 Slack-person edits waiting since 23 Oct (OPEN_REPAIRS 507). Go
  through roster-write, or call its `copy_to_sheet` afterwards. Test clients
  never reach the Sheet by design, and both parity checks skip them except the
  main test client.
- **A byte-order mark in an Edge Function source deploys fine and then fails
  the attestation.** Those three invisible leading bytes are stripped by the
  deploy tooling on upload, while the fingerprint hashes the committed bytes,
  so the live source can never equal the expected source and redeploying never
  helps. The release lane deploys BEFORE it attests, so the code is already
  live when the run goes red. `npm test` now fails on any mark under
  `supabase/functions`; strip the bytes, never re-pin the fingerprint to them.
