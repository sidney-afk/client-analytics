# Edge Functions on merge

Since 2026-10-16 (session Conveyor) a change to an Edge Function goes live when it
merges to `main`. Nobody presses Run workflow for an ordinary change, and Sidney
runs nothing on his own machine.

- Lane: [`deploy-edge-functions-on-merge.yml`](https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-edge-functions-on-merge.yml)
- Policy (what is held, what stays manual, the order): `scripts/ef-auto-deploy-plan.js`
- Section 4 step: `scripts/ef-auto-deploy-f27.sh`
- Notice: `scripts/ef-auto-deploy-notice.js`
- Proof: `test/ef-auto-deploy.js` (unit lane)

## What one run does

1. **Validates first**, from the trusted default branch, with no secret and no
   script of the merge run: the commit must be on `main` and carry the attestor.
2. **Counts the changes since the last run that fully succeeded.** Not the last
   run that ran: a run that was red (a function held or failed) is not a starting
   point, so whatever it left undone is planned again by every later run until it
   is live (GitHub also drops a pending run when a newer one queues, so the push's
   own "before" is never enough). If the list of earlier runs cannot be read, the
   run fails instead of guessing. A function changed when its folder, or any file it imports, changed
   (the import walk of `scripts/ef-deploy-manifest.js`), or when its source
   fingerprint (`scripts/ef-fingerprint.js`) moved.
3. **Plans, with no secret.** Each changed function gets one decision:

   | Decision | Meaning |
   |---|---|
   | `deploy` | deployed by this run, in order, then attested |
   | `f27-lane` | `production-write`, `deliverable-write`, `batch-write`: released by dispatching the Section 4 lane with `capture` (below) |
   | `manual` | never automatic: `calendar-upsert` and `sample-review-upsert` (frozen), `linear-inbound`/`linear-outbound` (retired), `client-token-verify` (deliberate-manual). A warning in the run, not red |
   | `held` | not deployed this time; the summary says why and how to release it. The run is red and the owner relay is paged |
   | `already-live` | live already runs this commit's source; nothing to do |

4. **Gates on live state, read only** (the token is in that step only):
   - **Drift guard.** A function is deployed only if what is live now is a
     version that was on `main` (at the base of this run or one of the 40 newest
     function-touching commits). Something deployed from elsewhere is never
     overwritten; it is held instead. A brand-new function has nothing live and
     is deployed. A manual run skips this guard on purpose (a person chose it): its
     summary says "Drift guard: skipped" and its table marks any function whose
     live source was not a recent `main` version with `DRIFT`.
   - **Order across runs.** A function that must follow another (below) is
     deployed only when that other one is live at this commit's source. If the
     other one is in this plan, the order handles it; if it is not (a later merge
     touched only `production-comments`), its live source is read, and the
     follower is held until it matches.
   - **Already live.** Whatever held a function, if the live source already equals
     this commit's, it is `already-live` and nothing is done.
   - **The manual lanes' own safeguards**, the same reads: the onboarding,
     HubSpot sync and Frame.io keeper schema readbacks
     (`deploy-single-function.yml`), `PTO_SCHEMA_CONTRACT`
     (`deploy-pto-edge-functions.yml`), the hiring source checks and contract
     test (the hiring lanes), the Linear-exit native SQL preflight before
     `notify`, `production-comments`, `production-archive`
     (`deploy-onboarding-edge-functions.yml`).
   - **`verify_jwt`.** Every attested function is JWT-off and authenticates
     itself; a function whose `supabase/config.toml` block says
     `verify_jwt = true` is held.
5. **Deploys in order**, one function at a time, `--no-verify-jwt`, and stops at
   the first failure (nothing after it is deployed). The order where it matters
   is the Track-B one: `notify` before `production-write` (its wake calls the
   sender; the Section 4 lane also refuses unless `notify` is live), and
   `production-write` before `production-comments` and `production-archive` (a
   new reader against the old gateway would mis-handle an edit as a create). If
   a function that must go first is held, the ones after it are held too.
6. **Attests** every function it deployed against the commit: live source equals
   the committed source, `verify_jwt=false`. This also runs when a later deploy
   failed, so what went live is always proved. Nothing is attested after a
   failed gate, because nothing was deployed.
7. **Reports**: a table in the run summary (function, decision, result, why and
   how to release), and on any failure or hold a page through the owner alert
   relay (`SLACK_ALERT_WEBHOOK`, the same relay the backup and the watchdog use).

## The Section 4 three

A merge that changes `production-write`, `deliverable-write` or `batch-write` must
re-pin that function's `*_SOURCE_SHA256` in `deploy-f27-section4-closures.yml` in
the same PR (`node scripts/ef-fingerprint.js <sha> --slugs=<slug> --expected-only`).
Without the pin the plan holds it, because that lane would refuse.

With the pin, this lane deploys `notify` first if it changed, then dispatches
[`deploy-f27-section4-closures.yml`](https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-f27-section4-closures.yml)
with `operation=deploy-reviewed-release`, `confirm=DEPLOY_REVIEWED_F27_SECTION4_CLOSURES`,
`commit_sha` = main's tip and `capture` as both bundle inputs, and waits for it.
That lane, in one run: validates (`commit_sha` must be main's tip), **captures
the live three itself** (`scripts/f27-edge-source-rollback.js capture`, the same
script and format the owner's Windows capture used, cross-checked against an
independent live fingerprint read), stores the sealed bundle content-addressed
in the F27 Shared Drive root with an independent readback, fetches it back and
inspects it with the unchanged steps, and only then deploys and attests. The
sealed SHA-256 and byte length are in its summary; they are what a
`restore-captured-prior-three` needs. A failed forward is never retried forward.
The lane only accepts main's tip, and it does not look at the merges between
the planned commit and the tip. So this lane dispatches only at the planned
commit, or at a tip where nothing it plans from (functions, config, migrations,
the planner, the two lanes) changed since. If any of those changed, it dispatches
nothing and hands Section 4 to the run of the newer tip, which plans it with the
migrations and pins of every merge in between. That hand-over shows as a red run
that says so and pages nobody; the tip's run pages if it fails. If a merge slips
in during the dispatch, the lane refuses at validation, before any secret, and
the rule is applied again at the new tip.

Dry run of the capture: Run workflow on the Section 4 lane with
`operation=capture-only`, `confirm=CAPTURE_F27_SECTION4_PRIOR_THREE`, both bundle
inputs `capture`. It captures, seals, stores, fetches back and inspects, and
deploys nothing.

## Migrations: how a held function is released

A merge that **adds** a file under `migrations/` or `supabase/migrations/` holds
every function it changed, because a function must not go live before the
column or table it needs. Two lines near the top of a migration file change that:

- `-- ef-auto-deploy: functions-cope-without-this` says the functions in this
  merge work without it (for example a new index, or a column the code checks
  for). Reviewers see it in the diff. The functions deploy at once.
- `-- ef-auto-deploy-applied-when: select to_regclass('public.new_table') is not null`
  gives a one-statement read that answers `true` once it is applied. The gate
  runs it read-only (the same screen `scripts/repo-vs-live.js` uses); if every
  such migration answers `true`, the functions deploy.

Otherwise, **Lighthouse**:

1. applies the migration in the Supabase SQL editor, as today, and reads it back;
2. opens [the lane](https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-edge-functions-on-merge.yml),
   Run workflow, branch `main`: `commit_sha` = the merge commit the summary
   names, `migrations_applied` = ticked, `functions` empty (or the held ones);
3. checks that the run is green and its table says `deployed` for each.

A manual run deploys what that one merge changed (or the functions named), with
every other check, including the order rule; it reports drift instead of
stopping (its summary says the drift guard was skipped and marks each function
with `DRIFT` when live was not a recent `main` version), because a person chose
it. It never deploys a commit that is not on `main`.

A migration holds only the functions its own merge changed, so a run that spans
several merges (after a red run) does not hold an unrelated function because an
earlier merge added a migration.

## Other holds

| Held because | Release |
|---|---|
| drift guard: live is not a recent `main` version | look at what is live, then run the lane by hand with `functions=<name>` |
| a safeguard failed (schema missing, `PTO_SCHEMA_CONTRACT`, hiring checks, Linear-exit preflight) | fix that, then run by hand with `commit_sha` |
| waits for a predecessor (in this plan, or live at an older source) | release the predecessor first (run this lane by hand with `functions=<predecessor>`), then run by hand |
| stale Section 4 pin | re-pin in a PR; its merge releases it |
| `verify_jwt = true` in config | deploy by hand after review |

## What Sidney does

Nothing for an ordinary merge. The `production` Environment already holds the
secrets this lane uses (`SUPABASE_ACCESS_TOKEN`, `SLACK_ALERT_WEBHOOK`,
`N8N_API_KEY`, and for the Section 4 lane `F27_PRIVATE_SHARED_DRIVE_ROOT_ID` and
`TRACK_B_BACKUP_GOOGLE_CREDENTIALS_JSON`). If a run says one is missing, the run
names it.

## Ways back

- **Stop automatic deploys at once:** disable the workflow (Actions, this lane,
  "..." menu, Disable workflow). Every manual lane still works.
- **Undo the change:** revert the PR that added this lane. That brings back the
  `push:` triggers of the onboarding, PTO, thumbnail and description-image lanes
  and removes this one.
- **A Section 4 release to undo:** `restore-captured-prior-three` with the two
  values from that run's summary.
