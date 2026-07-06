# ROLLBACK.md — the "back to a working website in one step" runbook

**This file is law.** The owner's requirement, verbatim in spirit: *"I need to make sure that if
there's a bug or a problem or anything happening, I can click on a button and everything goes
back to normal. Our whole business depends on this."* Every phase of the independence plan is
executed under the rules below, and the **Live State table** in this file must be updated in the
same PR as any change it describes. If this file is out of date, the migration is out of
compliance — stop and fix it.

## 1. Standing rules (non-negotiable)

1. **One-step rollback, always.** Every cutover ships behind a single flip point — a runtime
   kill switch where possible (URL param / localStorage flag / config row checked at load), a
   single frontend constant otherwise. Rolling back must never require re-implementing anything:
   flip the switch, or `git revert` the one flagged commit and merge to `main` (GitHub Pages
   redeploys automatically; allow ~10 min for Pages cache).
2. **The old path stays alive until the new path has baked.** n8n workflows being replaced are
   left ACTIVE during canary, then only DEACTIVATED (never deleted) after their gate passes,
   then archived only at final cleanup. Rollback = one click ("Activate") in n8n. Before
   touching ANY n8n workflow, export its JSON — **raw workflow JSON contains hardcoded keys and
   must NEVER be committed to this public repo (rule 8 wins): export to the private weekly-backup
   Drive folder and commit only a public-safe status stub to `n8n-backups/` (dated), the
   Phase-0/A2 precedent** — in the same PR as the change.
3. **Additive-only database changes during the entire migration.** New tables and new columns
   are allowed; DROP/RENAME/type-changes are forbidden until the final cleanup phase after
   everything has baked. This guarantees the old code path always still works against the
   current schema — which is what makes rule 1 honest.
4. **Snapshot before every phase.** (a) git tag `pre-<phase>` (e.g. `pre-A1`) on `main`;
   (b) JSON export of every n8n workflow the phase touches; (c) Supabase dump (CSV or SQL) of
   every table the phase writes, stored in the private weekly-backup Drive folder, and note the
   public-safe file names in `EXECUTION_LOG.md`.
5. **Log everything.** `EXECUTION_LOG.md` (create in the first execution PR) gets a dated entry
   for every deploy, flag flip, n8n change, DB migration, backup taken, incident, and rollback —
   with enough detail to reconstruct events later. This complements the in-app event ledgers
   (owner decision D7).
6. **Gates are hard stops.** At every gate in `INDEPENDENCE_PLAN.md` §6: post the evidence
   (test results, canary metrics, reconciler-correction count), get the owner's explicit OK,
   only then proceed.
7. **Verify the rollback, not just the deploy.** For each phase, before its canary starts,
   actually EXERCISE the rollback once on the QA client (flip back, confirm the old path works,
   flip forward again). An untested rollback is a hope, not a button.
8. **The repo is public.** No secrets in code, docs, commits, or logs — ever.

## 2. Live State table — what is serving production RIGHT NOW

Update in the same PR as any change. "Rollback" must be executable by the owner alone.

| Surface | Current production path | Kill switch / rollback | Last verified |
|---|---|---|---|
| Calendar writes (upsert/reorder) | n8n webhooks for all clients except the approved canary clients. A1/A2 Edge Functions are deployed, PR #668/#670/#680 are merged, and GitHub Pages is serving B0.5 merge commit `c776ad6` with import-verify Supabase readback and EF reorder fallback fixes. The runtime flag `syncview_runtime_flags.calendar_upsert_ef_clients` is `{"clients":["sidneylaruel","jesseisrael"]}`, so only the Sidney TEST client and first real canary Jesse Israel route calendar upserts/reorders to Edge Functions; every other real client remains on n8n. | Remove `jesseisrael` from `syncview_runtime_flags.calendar_upsert_ef_clients` to roll the real canary back to n8n in one step while leaving the Sidney TEST client enabled. Set the flag to `{"clients":[]}` to force all calendar upserts/reorders, including Sidney, back to n8n. This rollback was rehearsed on TEST for A1 and remains the one-step rollback with the merged code live. | 2026-07-06 (B0.5 #680 live; Jesse first real canary) |
| Samples New (SXR) writes | n8n webhooks for all clients except the approved canary clients. A2 `sample-review-upsert` and `sample-review-reorder` Edge Functions are deployed, PR #670/#680 are merged, GitHub Pages is serving B0.5 merge commit `c776ad6`, and live n8n workflow `MJbMZ789B5ExZz9x` contains fail-safe samples routing through `sample_review_ef_clients`. The runtime flag `syncview_runtime_flags.sample_review_ef_clients` is `{"clients":["sidneylaruel","jesseisrael"]}`, so only Sidney TEST and Jesse route samples upserts/reorders and samples Linear-sync upserts to the Edge Function; every other real client remains on n8n. Jesse currently has 0 active sample rows. | Remove `jesseisrael` from `syncview_runtime_flags.sample_review_ef_clients` to roll the real canary back to n8n in one step while leaving Sidney enabled. Set the flag to `{"clients":[]}` to force all samples writes, including Sidney, back to n8n. If the n8n routing edit itself needs rollback, restore/publish the private pre-A2 `Handle Sample Linear Event` node backup. | 2026-07-06 (B0.5 #680 live; Jesse first real canary) |
| Samples Old writes | n8n webhooks (baseline; out of migration scope, D4) | n/a | 2026-07-03 |
| Linear -> app realtime sync | n8n workflow `MJbMZ789B5ExZz9x` active version `655b6aa5-e571-451e-8f65-f4fcf78aff02`; two Linear webhooks cover both VID and GRA. Its calendar and samples upsert calls are runtime-flagged: `sidneylaruel` and `jesseisrael` route to the relevant Edge Functions, and all other real clients fall back to n8n. `errorWorkflow` is wired to `SyncView - Error Alerts -> DM Sidney` (`itqDXSl2ybsRSAiQ`). `Plan Workload Row` now skips cycle-only `Issue` update events without `updatedFrom.stateId`, and `Handle Sample Linear Event` has the calendar-matching diacritics slugify range. | Remove `jesseisrael` from `calendar_upsert_ef_clients` and `sample_review_ef_clients` for the real-canary rollback. Set either flag empty for a full rollback of that writer family. If the n8n hardening edit itself fails, restore/publish the private `2026-07-06-n8n-hardening` pre-edit workflow backup or deactivate the workflow; reconcilers continue healing regardless. | 2026-07-06 (B0.5 Jesse canary; cycle-only guard live; sample slugify fixed) |
| App → Linear pushes (set-status/comment) | n8n webhooks + FE localStorage outboxes (baseline) | n/a — baseline | 2026-07-03 |
| Status drift healing | GitHub Actions reconcilers every ~10 min (n8n triggers `AkiFmromoDkmsh39` active, `ZJOtYpQZj73DcBB1` inactive) | Must stay ACTIVE until Track B5 — this is the global safety net | 2026-07-03 |
| Client access/auth scaffold (Track B B0) | Additive B0 Supabase tables (`clients`, `team_members`, `client_access`, `client_access_events`, `syncview_auth_events`, `flag_flips`) and verifier Edge Functions (`client-token-verify`, `key-verify`) exist. Runtime flags are seeded as `auth_enforcement={"mode":"permissive"}`, `prod_authority={"video":"linear","graphics":"linear"}`, and `linear_inbound_enabled={"enabled":false}`. Client tokens and role keys are stored only in private secret stores/backups. Critical workflow-level `errorWorkflow` settings are wired and verified. No production tab is live, no real client is routed away from Linear/n8n, and PR #679 is merged. | Keep or reset `syncview_runtime_flags.auth_enforcement` to `{"mode":"permissive"}`. This is the B0 fail-open rollback and was rehearsed by flipping to enforced on the Sidney TEST token check, observing the blocked invalid-token response, then flipping back to permissive. If needed, revert PR #679; the additive DB objects can stay dormant. | 2026-07-05 (B0 scaffold complete; permissive rollback rehearsed; errorWorkflow verified) |
| Templates / caption prompts | n8n Sheet webhooks for all clients except the approved canary clients. A4 Supabase tables (`templates`, `caption_prompts`) exist, were backfilled from the live Sheet reads, A4 write Edge Functions (`templates-save`, `caption-prompts-save`) are deployed, PR #673/#680 are merged, and GitHub Pages is serving B0.5 merge commit `c776ad6`. The runtime flag `syncview_runtime_flags.settings_ef_clients` is `{"clients":["sidneylaruel","jesseisrael"]}`, so Sidney TEST and Jesse read flagged Supabase overlays and write settings through Edge Functions; every other real client still reads the n8n base and writes to n8n. Caption generation and filming-plan tabs remain on n8n and are out of A4 scope. | Remove `jesseisrael` from `syncview_runtime_flags.settings_ef_clients` to roll the real canary back to n8n in one step while leaving Sidney enabled. Set the flag to `{"clients":[]}` to force all template and caption-prompt reads/writes, including Sidney, back to n8n. This rollback was rehearsed before the A4 canary with the merged code live. | 2026-07-06 (B0.5 #680 live; Jesse first real canary) |
| Filming plans runway | Production still uses n8n `filming-plan-tabs` (baseline). QA/headless harness stubs this endpoint by default to stop cold-cache n8n load; set `SYNCVIEW_QA_LIVE_FILMING_TABS=1` for a deliberate live probe. | Revert the QA harness commit, or run QA with `SYNCVIEW_QA_LIVE_FILMING_TABS=1`. Production rollback remains n/a; baseline n8n path is still live. | 2026-07-03 |
| Production tab (Track B) | The tab still does not exist in production. B1 additive Supabase data-model tables/functions (`batches`, `deliverables`, `deliverable_events`, `mirror_outbox`, `linear_archive`, `batch_write`, `deliverable_write`) are live and populated by the approved read-only Linear backfill; detailed counts and verification artifacts are private. B1 also applied approved insert-only inactive reconciliation rows and null-only team-member Linear linkage fills. No runtime flag was changed; Linear/n8n remain the production authority. | No user-facing rollback is needed because nothing routes to these tables yet. If the dormant B1 data causes an incident, leave it dormant or run an explicit cleanup plan for the additive B1 rows/tables; do not touch Track A flags. Revert PR #682 only after owner review because the live DB has already been additively backfilled. | 2026-07-06 (B1 backfill complete; Production tab still not live) |

## 3. Emergency full rollback (worst case, any time during Track A)

1. `git revert` the offending commit(s) or reset `main` to the last `pre-<phase>` tag; push.
   GitHub Pages redeploys the site (~10 min worst case; hard-refresh to bypass cache).
2. In n8n: re-activate any workflow the current phase had deactivated (they were never deleted).
3. Confirm the reconciler trigger (`AkiFmromoDkmsh39`) is active — it heals any status drift the
   incident caused within ~10 minutes.
4. Run the relevant `qa/master.js` lane against production to confirm green.
5. Write the incident + timeline into `EXECUTION_LOG.md` before resuming any migration work.

During Track B the same applies, plus: the Production tab is flag-gated and additive — turning
the flag off returns everyone to the Linear-era flow, and the one-way mirror means Linear was
kept current the whole time, so nothing is lost.

## 4. Backup inventory (what exists, where)

- **Weekly** (Sun 02:00, n8n `jlVfbg0Njxf1It7h`): main Sheet copy, repo zip, ALL n8n workflow
  JSONs, Supabase dumps (calendar_posts, content_samples, + onboarding tables) → private
  weekly-backup Drive folder. On 2026-07-06, the workflow export filter was corrected so the
  weekly backup includes all workflows, not just the 45 inactive workflows; REST inventory
  readback at the time of the fix was 120 total workflows (75 active, 45 inactive), including
  `MJbMZ789B5ExZz9x`.
- **Repo**: `n8n-backups/` (point-in-time workflow JSONs), `migrations/` (schema), git history
  + tags. Phase snapshots per rule 4 add to these.
- **Phase 0 baseline closed 2026-07-03**: live schema committed at
  `migrations/live-schema-baseline-2026-07-03.sql`; private full n8n export confirmed via
  weekly-backup execution `191240`. Because this repo is public, raw unredacted workflow JSON
  remains private; repo evidence is summarized in `n8n-backups/2026-07-03-phase0-snapshot-status.md`.
- **Pre-A1 snapshot started 2026-07-03**: git tag `pre-A1` points to `main` commit
  `ba365410`; `calendar_posts` was dumped privately to
  `private-backups/2026-07-03-pre-A1/calendar_posts.pre-A1.2026-07-03.json` (outside the
  public repo). A1-scoped n8n workflow versions are recorded in
  `n8n-backups/2026-07-03-pre-A1-snapshot-status.md`; raw workflow JSON remains private.
- **A1 staged rollback point**: the `calendar_upsert_ef_clients` runtime flag is the single
  flip point for browser and reconciler calendar-upsert routing. The value `{"clients":[]}`
  means all clients use the old n8n upsert path. Canary may set only `{"clients":["sidneylaruel"]}`;
  any real-client value requires the owner's next explicit gate approval.
- **A1 TEST deploy/parity status 2026-07-03**: additive A1 support tables are live, the
  `calendar-upsert` Edge Function is deployed, and n8n workflow `MJbMZ789B5ExZz9x` is published
  with flag-based routing. Rollback was rehearsed with `sidneylaruel` and returned to
  `{"clients":[]}`. Final TEST parity passed all six cases, including comment merge; no real
  client is enabled.
- **A1 TEST browser canary status 2026-07-04**: after fixing the stale `p87` probe,
  GitHub Actions `calendar-e2e-nightly.yml` baseline run `28690695855` with the flag empty
  and EF run `28691435661` with only `sidneylaruel` flagged both completed green on current
  PR head `ee2de4dd76fe0e96745ac1b1085d3c4c7cff6234`. Both logs report `All 67 probes
  passed`; A1-relevant probes `p89`-`p94` passed on both paths. Rollback was executed
  immediately after the EF run: `calendar_upsert_ef_clients` is `{"clients":[]}` and no real
  client is enabled. `Calendar E2E (nightly)` and `Samples E2E (nightly)` are both
  `disabled_manually`.
- **A1 merged TEST-only live check 2026-07-04**: PR #668 was merged to `main` as merge commit
  `eecfa4b`; GitHub Pages deployment run `28695476386` completed successfully for that commit.
  After Pages completed, `calendar_upsert_ef_clients` was set to
  `{"clients":["sidneylaruel"]}`. This enables only the Sidney TEST client for owner-driven
  live testing. Rollback remains one SQL update to `{"clients":[]}`; no real client is enabled.
- **A2 n8n snapshot/edit status 2026-07-04**: live workflow `MJbMZ789B5ExZz9x` was exported
  privately before and after the A2 samples-branch routing edit; public-safe evidence is in
  `n8n-backups/2026-07-04-a2-snapshot-status.md`. The active version is now
  `405ab03a-12bb-43ca-b70a-14aee3ba7f35`. The old sample-review n8n upsert webhook remains the
  fallback when `sample_review_ef_clients` is empty, missing, or unreadable.
- **A2 TEST deploy/parity status 2026-07-04**: additive flag migration
  `migrations/2026-07-04-a2-writer-edge-functions.sql` has been applied. `calendar-reorder`
  is deployed at version 2; `sample-review-upsert` and `sample-review-reorder` are deployed at
  version 1, all with JWT verification disabled. Live TEST parity passed for
  `calendar-reorder-batch-shape`, `sample-review-reorder`, `sample-review-upsert-create`,
  `sample-review-upsert-link-clobber`, `sample-review-upsert-clear-link`,
  `sample-review-upsert-conflict`, and `sample-review-upsert-comment-merge`. Cleanup verified
  0 `a2_parity_%` rows/events and `sample_review_ef_clients` remains `{"clients":[]}`. No real
  client is enabled and A2 remains draft/unmerged.
- **Pre-B0.5 Track B snapshot 2026-07-05**: git tag `pre-B0.5-track-b-2026-07-05`
  points to post-B0 `main` before the B0.5 branch. Public-safe runtime flag and table-count
  snapshots are stored privately under
  `private-backups/2026-07-05-pre-B0.5-track-b`; raw secrets and workflow JSON remain outside
  the public repo. B0.5 is staged only and must not add any real client to Track A flags.
- **Pre-B1 Track B snapshot 2026-07-06**: git tag `pre-B1-track-b-2026-07-06`
  points to `main` commit `f7d77561c823335964e6d78dd854b0086957884d`. Public-safe snapshot
  evidence is in `n8n-backups/2026-07-06-pre-B1-track-b-snapshot-status.md`; private Supabase
  JSON snapshots are stored outside the repo under
  `private-backups/2026-07-06-pre-B1-track-b\supabase`. B1 does not edit n8n workflows, and the
  additive B1 model is live but empty until the owner approves the backfill gate.
