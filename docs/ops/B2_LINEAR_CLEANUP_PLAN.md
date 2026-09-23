# B2: server-side Linear cleanup. Inventory and removal plan

Status: **inventory and plan only.** Nothing live was changed, nothing was
deployed, no n8n workflow was edited. Measured 2026-09-23 (UTC) by the session
named Sweep, supervised by Lighthouse. No staff or clients are named; counts only.

## Starting facts (verified by Lighthouse, re-read live where noted)

- Linear stopped being a work surface at the 2026-09-20 cutoff (LINEAR_CUTOFF_RUNBOOK STEPS 1 to 6).
- 2026-09-23: the owner revoked all 10 Linear API keys (this is the runbook's STEP 7, done earlier than the planned 2026-09-27). n8n showed zero errors afterwards.
- `syncview_runtime_flags`, read live: `prod_authority` = syncview for video and graphics (set 2026-08-28);
  `linear_outbound_enabled` = off (2026-09-20); `linear_legacy_parity_enabled` = false (2026-09-20);
  `linear_inbound_enabled` = **true** (unchanged since 2026-07-07); `linear_outbound_pending_age_alert` = 30 min.
- The browser no longer calls `linear-set-status` / `linear-add-comment` (OPEN_REPAIRS 239) or `linear-issue-statuses` (OPEN_REPAIRS 236).
- Staff Linear keys used to sit in a public sheet's "Social Media Managers" tab; the owner blanked that column.

### How much history the evidence covers

| Source | Retention seen | Consequence |
|---|---|---|
| n8n execution history | oldest retained run is 2026-09-18 23:59Z (about 4.5 days) | "zero runs" proves only "none since 2026-09-18". |
| Supabase `function_edge_logs` | at least 7 days (2026-09-16 queried fine) | per-function call counts below are for 2026-09-16 to 2026-09-23 05:59Z. |
| Table timestamps | full | last-write times below are exact. |

---

## 1. Inventory

Legend for "Still called?": **LIVE** = measured traffic now; **IDLE** = code path exists, no traffic in the window; **DEAD** = cannot run (flag/authority/revoked key).

### 1a. Edge Functions

| Item | What it is | Still called? (evidence) | What removal breaks |
|---|---|---|---|
| `linear-inbound` (deployed v52) | Receives Linear's signed webhook, writes deliverables/batches/comments. Kill switch `linear_inbound_enabled` (still **true**). Secret `LINEAR_INBOUND_SIGNING_SECRET`. | **IDLE since 2026-09-20 23:08Z.** Edge logs: 1,346 calls on 2026-09-20 (12:00 to 12:00Z window), zero from 2026-09-21 to now. No browser caller (comments only). The Linear-side webhook subscription itself is not visible from here and may still exist. | Deploy lane `deploy-f27-linear-inbound.yml`, `f27-team-rollback-proof.yml`, about 15 scripts, tests importing its helpers (`comment-normalize`, `f27-echo`, `label-normalize`). Nothing user-facing. |
| `linear-outbound` (deployed v54) | Drains `mirror_outbox` to the Linear GraphQL API. Secret `LINEAR_MIRROR_API_KEY` (now revoked). | **IDLE since 2026-09-20 20:03Z** (104 calls then 38, then zero). Its caller `linear-outbound-drain.yml` has its schedule commented out. Flag `off`, key revoked, so **DEAD**. | Section 4 lane (it is one of the four functions), the onboarding deploy lane, `scripts/ef-deploy-manifest.js` (multi-owner entry), `linear-outbound-drain.yml`, `graphics-f2-evidence.yml`, `f42-apply-rehearsal.yml`, about 30 scripts, b4 tests. |
| `workload-linear` (deployed v12) | Old Linear deadline reader/writer for Workload. | **DEAD.** Zero edge-log calls on every day checked (2026-09-16 to 2026-09-23). Returns 409 while both teams are syncview (its own header, OPEN_REPAIRS 79). | Two unreachable browser fetch sites (`070-workload-source.js.part:1232`, `080-workload-render.js.part:963`) and the manifest's manual-deploy entry. |
| Linear branches in `production-write` (about 340 mentions) | Label catalog read from Linear (`:848`), `linearRead` project-mapping validation (`:2497` to `:2925`, secrets `LINEAR_READ_API_KEY`, `LINEAR_MIRROR_API_KEY`, `LINEAR_API_KEY`), about 15 `mirror_outbox` enqueue sites, parent routing through `batches.linear_parent_ids`. Gated by `prod_authority`, `linear_outbound_enabled`, `linear_legacy_parity_enabled`. | **LIVE, partly.** The enqueue still runs: `mirror_outbox` got 1,177 new rows 2026-09-19 to 2026-09-23, **all `status=skipped`** (last 02:52Z today). Every one is created and immediately parked. Linear API reads are dead (keys revoked); whether any path still attempts one needs a log check (Slice 8). | Removing the flag reads without code changes makes every write return 503 (`:1373`, `:1434`). Must be a code change + Section 4 deploy. |
| `_shared/b4-write.ts`, `_shared/linear-create-id.mjs`, `_shared/write-refusal-codes.mjs` | Linear payload handling, deterministic Linear-issue id, 4 Linear refusal codes. | Shared by production-write/linear-outbound. | Fingerprints of every function that imports them (they change the digest). |
| `production-archive` | Read-only reader over `linear_archive`. | **LIVE** (40 calls in the last 24h). This is the history viewer, not integration. | **Keep.** |
| `calendar-upsert`, `sample-review-upsert`, `production-comments`, `workload-plan` | Carry `linear_issue_id` link columns, a duplicate-link guard, and a `prod_authority` check. | LIVE functions; the Linear parts are columns/guards only. | Out of B2 scope except as column consumers (Slice 8). |

### 1b. n8n workflows and webhooks (13 mention Linear; 8 active, 5 inactive)

Execution counts are "since 2026-09-18 23:59Z" (retention limit).

| Workflow (id) | Active | Runs in window | Notes / what removal breaks |
|---|---|---|---|
| Calendar - Linear Add Comment (`8stSpZUiyG7f2LQX`) `/webhook/linear-add-comment` | yes | **0** | Browser caller removed (OPEN_REPAIRS 239). Key revoked, so DEAD. Only `scripts/b4-comment-echo-probe.js` still names the URL. Breaks nothing. |
| Calendar - Linear Set Status (`VQqqeY9B2GZbh2Bt`) `/webhook/linear-set-status` | yes | **0** | Same as above. Breaks nothing. |
| Calendar — Linear Issue Statuses (`GP8CSZDNcy5sGdFr`) `/webhook/linear-issue-statuses` | yes | 367 since 2026-09-21; **last run 2026-09-22 21:43Z, none since** | Browser callers removed 2026-09-22 (OPEN_REPAIRS 236); the traffic stopped exactly then. Was 35% of the n8n bill (OPEN_REPAIRS 233). Breaks nothing now; a cached old page could still call it and get an error, harmless. |
| Calendar — Linear Sub-Issues (`Nk3pwR6Fbl4VAPqH`) `/webhook/linear-subissues` | yes | **0** | **Browser still calls it** ("Import from Linear" and link-time sync: `150:234, 350, 648`, `290:930`). With keys revoked it can only fail. Remove the browser caller first (B1), then deactivate. |
| Workload — Tweak Comments (`d7Dod7OuQsVsl1CN`) `/webhook/linear-tweak-comments` | yes | **0** | **Browser still calls it** (`090:496`, tweak-comment preview). Dead now. Browser first, then workflow. |
| Urgent Tweak → Slack (`TJVMyfwl85qrFGeK`) `/webhook/send-urgent-slack` | yes | **0** | Only the **legacy fallback** uses it: cards with a `video_deliverable_id` already go through the native route (`native_urgent_dispatch` in production-write, called from fragments 140, 270, 330). Cards without one fall back to this workflow (`100:1092`), which resolves the editor through the Linear API and so fails since the revoke. Urgent editor pings must be preserved (AGENTS.md owner clarification 2026-09-14). |
| Calendar — Upsert Post (`pWSqaqVw7dmqhYOA`) | yes | 1,355 in window, last 2026-09-22 21:05Z | NOT Linear-only: the legacy calendar write lane (about 1.3% of calendar writes, OPEN_REPAIRS 233). Its duplicate-Linear-link guard is incidental. **Out of B2.** |
| Calendar — Append Post (`iA54ipMOybicmYBh`) | yes | 0 | Legacy calendar append with a Linear-link guard. Not Linear-only. Out of B2; list for the n8n-lane retirement. |
| Calendar - Linear Status Sync (`MJbMZ789B5ExZz9x`) | no | 0 | Inbound Linear webhook to calendar. Inactive since 2026-07-13. Safe to archive. |
| Calendar - Linear Reconcile Trigger (`AkiFmromoDkmsh39`) | no | 0 | Dispatched a GitHub reconcile; inactive since 2026-07-05. Uses the GitHub PAT credential. Safe to archive. |
| Samples - Linear Reconcile Trigger (`ZJOtYpQZj73DcBB1`) | no | 0 | Same pattern. Safe to archive. |
| Samples — Linear Status Sync (`qmDGbKnvrK0sPFKj`) | no | 0 | Inbound Linear webhook to samples. Safe to archive. |
| Workload — Reconcile (`lGwC9WWPVJtxphtf`) | no | 0 | Wrote `workload_issues` from `/webhook/linear-issues`. Inactive. Safe to archive. |

**Webhook paths the browser still names but no n8n workflow's name or description matches:** `linear-issues` (`070:2`), `linear-projects` (`060:1623`), `log-linear-submission` (`060:1624`). One read of the node JSON of the active workflows (owner-side, read-only) should confirm whether anything serves them. If nothing does, those browser calls already fail today.

**n8n credentials:** any Linear credential in n8n now holds a revoked key. Deleting it is an owner action in the n8n UI, after the workflows that use it are archived.

### 1c. Database (project `syncview-calendar`)

No pg_cron or pg_net jobs exist (the `cron` schema is absent); all schedulers are GitHub Actions or n8n.

| Object | Size / rows | Last write | Still used? | Removal breaks |
|---|---|---|---|---|
| `mirror_outbox` | 21.3 MB, 11,706 rows (46 unprocessed, newest 2026-09-20 09:19Z) | **2026-09-23 02:52Z** (skipped rows) | LIVE as a sink: production-write and linear-inbound still enqueue. `outbox-debt-census.yml` watches it twice an hour. | production-write (about 15 queries), linear-inbound, census workflow. Code first, then the table. |
| `linear_archive` | 62.9 MB, 18,303 rows | 2026-09-17 09:30Z | LIVE (read by production-archive). | **Keep.** This is the permanent history. |
| `linear_archive_asset_refs` | 40 kB, 0 rows | never | Read by production-archive; the media rescue it was built for never wrote a row. | production-archive query paths. Keep until the brief-media question (Slice 0) is settled. |
| `linear_archive_asset_rescue_config` | 16 kB | n/a | Config for the rescue above. | Same. |
| `linear_intake_receipts` | 164 kB, 19 rows | 2026-08-10 | IDLE six weeks. | `_linear_intake_*` functions (7). |
| `linear_outbound_cutoff_control` | 1 row | 2026-09-17 | Cutoff control for linear-outbound. | `linear_outbound_*` functions. |
| `linear_project_ids_shape_migration_20260728` | 33 kB | one-off backup | none | nothing |
| `batches_parent_claim_backup_20260824` | small | one-off backup | none | nothing |
| `track_b_team_rollbacks`, `track_b_team_rollback_intents`, `track_b_f27_team_fences` | small | n/a | F27 rollback ledger (rollback to Linear authority, now impossible). | linear-inbound, linear-outbound, the f27 proof workflow. |
| `workload_issues` | 9.6 MB, 3,836 rows | `synced_at` max **2026-09-21 14:50Z** (frozen) | LIVE reads: boot early-fetch (`005:169`), Workload source (070), `workload-source-freshness.yml` (every 30 min), and the legacy arm of the native view. No writer remains. | Workload legacy rows, the freshness monitor (which will soon page on staleness). |
| Views `linear_deliverable_comment_ids_v1`, `linear_deliverables_reconcile_input_v1`, `linear_outbound_cutoff_debt_v1`, `linear_reconcile_projection_status_v1` | 0 | n/a | Used only by the reconcile/outbound tooling (unscheduled). | Scripts and dispatch-only workflows. |
| Schemas `linear_exit_install`, `linear_exit_maintenance`, `linear_exit_provider` | n/a | n/a | Linear-exit preparation tooling. | `linear-exit-*` scripts and `linear-exit-preparation-ci.yml`. |
| About 30 SQL functions (`mirror_outbox_*`, `linear_outbound_*` x7, `linear_reconcile_*` x7, `_linear_intake_*` x7, `production_outbox_replay`, `production_comment_bind_linear_id`, `production_comment_mirror_applicable`, `crosswalk_linear_identifier`, `b3_scoped_linear_url_projection`, `linear_deliverables_reconcile_hydrate`, `linear_archive_asset_ref_write`) | n/a | n/a | Mostly callable only from the Linear functions. `mirror_outbox_enqueue` is still reached from production-write. | Their callers above. |
| Flags `linear_inbound_enabled`, `linear_outbound_enabled`, `linear_legacy_parity_enabled`, `linear_outbound_pending_age_alert`, `prod_authority` | 5 rows | n/a | Read on every production write. A missing row returns 503. | Every write path, until the code stops reading them. **Flags are removed last.** |
| Linear-only columns | n/a | n/a | `deliverables.identifier, linear_issue_uuid, linear_identifier, linear_issue_url, linear_aliases, linear_raw`; `batches.linear_parent_ids`; `clients.linear_project_ids`; `calendar_posts.linear_issue_id, graphic_linear_issue_id`; `sample_reviews.linear_issue_id, graphic_linear_issue_id`; `production_comments.linear_*` (7 columns); `team_members.linear_user_id`; `mirror_outbox.linear_result`. | Many are the **only** link from old cards to their archived history (`linear_archive`). Drop none without a decision about keeping history reachable. |

### 1d. The Workload snapshot's Linear-era fields (OPEN_REPAIRS 230 item 2)

Measured live on `workload_native_snapshot_v1()` (the function behind `workload-plan` `native_snapshot`; the Edge Function passes the rows through unchanged):

| Field | Bytes in the snapshot | Rows with a value |
|---|---|---|
| whole snapshot | 9,799,381 (6,734 rows) | n/a |
| `linear_parent_ids` | 1,909,851 (19.5%) | 7,022 of 7,277 view rows |
| `url` | 420,330 (4.3%) | 5,486 |
| `parent_identifier` | 335,727 (3.4%) | 5,628 |
| **all three** | **2,665,908 (27.2%)** | n/a |

So dropping the three fields from the snapshot saves about **27% of the uncompressed answer (about 2.7 MB of 9.8 MB)**. The 2 MB OPEN_REPAIRS 230 measured is the compressed wire size; these fields are long ids that compress poorly, so expect roughly a quarter off the wire too (to be measured after the change, not assumed). `linear_parent_ids` alone is about 70% of the saving. Caveat: `linear_parent_ids` also feeds parent routing in the native arm of the view (`:172, :266, :289`) and `parent_identifier` is the batch name there, so this is a projection change (stop SENDING them to the browser), not a column drop.

### 1e. Browser code (`src/index/`, B1 territory but blocks B2)

- **Still calls dead Linear n8n webhooks:** `linear-subissues`, `linear-tweak-comments`, `send-urgent-slack` (Linear-dependent), `linear-issues`, `linear-projects`, `log-linear-submission`. Also `WORKLOAD_LINEAR_URL` (unreachable).
- **Reads Linear-era data:** `workload_issues` (boot early-fetch and Workload source), `batches.linear_parent_ids` (fragments 170, 180, 210), `prod_authority` (070, 080, 120), `linear_issue_id` literals (17 sites).
- **The public sheet's Linear key column: not read anywhere in the repo.** The only reader of the "Social Media Managers" tab (`320-kasper-dashboard-replies.js.part:29`, `330:168-194`) uses the client, manager, and Slack columns only. The two scripts reading that tab use only client and manager columns. If anything still reads the blanked column it is outside the repo (an n8n workflow would be the place to look; the two "ONE-OFF — Dump SMM sheet" style workflows are inactive).

### 1f. GitHub: workflows, secrets, scripts, docs

- **Linear-only workflows, all already unscheduled (dispatch only):** `b1-linear-incremental-refresh.yml`, `linear-deliverables-reconcile.yml`, `linear-outbound-drain.yml`, `production-shadow-audit.yml`, `production-write-drill.yml`, `slice5-test-drills.yml`, `monitoring-cutover-proof.yml`, `graphics-f2-evidence.yml`, `f27-team-rollback-proof.yml`, `f42-apply-rehearsal.yml`, `linear-exit-preparation-ci.yml`, and the lane `deploy-f27-linear-inbound.yml`.
- **Still scheduled and Linear-adjacent:** `outbox-debt-census.yml` (watches `mirror_outbox`), `workload-source-freshness.yml` (watches the frozen `workload_issues.synced_at`), `card-calendar-status-drift.yml`, `monitoring-crosscheck.yml`.
- **Secrets that only exist for Linear** (names from workflow files; the secret list itself is not readable from here): `LINEAR_API_KEY`, `LINEAR_MIRROR_API_KEY`, `LINEAR_READ_API_KEY` (Edge secret), `LINEAR_STATE_UUID_MAP`, `LINEAR_INBOUND_SIGNING_SECRET` (Edge secret). `B4_TEST_PROJECT_IDS` is not Linear-only while the TEST lane uses it (see Slice 7). All key values are already revoked at Linear, so deleting them is hygiene, not security.
- **Scripts:** 88 with "linear" in the name; about 135 in the wider B1/B4/F27/track-b/outbox family.
- **Tests:** 128 starting with `linear`; about 201 in the wider family.
- **Docs:** 54 in `docs/ops` with "linear" in the name (about 48 `LINEAR_EXIT_*`). Recommend archiving into one folder, not deleting: they are the audit trail.
- **Fingerprint pins:** `deploy-f27-linear-inbound.yml` pins `V39_BUNDLE_SHA256`, source, deno config and lock digests; the Section 4 lane pins `LINEAR_OUTBOUND_ENTRYPOINT_SHA256` and `LINEAR_OUTBOUND_SOURCE_SHA256`. Removing linear-outbound means changing the Section 4 lane's function set, the onboarding lane, and `scripts/ef-deploy-manifest.js`, then regenerating `docs/ops/EF_DEPLOY_MANIFEST.md`.

---

## 2. Removal plan, safest first

Every slice is one PR (or one owner action) and waits for the previous one to be green. "Owner" = needs the owner's hands or go-ahead (all n8n changes and all deploys do).

### Slice 0. Preconditions (read-only, no owner)
- Confirm the roadmap gate: STEP 7 (revoke) is done as of 2026-09-23; record that in `LINEAR_CUTOFF_RUNBOOK.md`.
- Settle the roadmap's second gate: has `scripts/native-brief-media-copy.mjs` run `apply` for real? `linear_archive_asset_refs` has 0 rows, which suggests not. With the keys revoked it now **cannot** re-fetch Linear-hosted media, so this is an owner decision: accept the loss, or check whether `uploads.linear.app` links still resolve without a key. Nothing below deletes archive data, so this does not block Slices 1 to 7.

### Slice 1. Archive the 5 inactive Linear n8n workflows (**owner**)
- Removes: Linear Status Sync (calendar and samples), both Reconcile Triggers, Workload Reconcile.
- Prove unused: already inactive; zero runs in the retained window; last edited July.
- Rollback: n8n archive is reversible (unarchive; version history kept).
- Risk: none.

### Slice 2. Deactivate the 3 dead active Linear webhooks (**owner**)
- Removes (deactivate, do not delete yet): Linear Add Comment, Linear Set Status, Linear Issue Statuses.
- Prove unused: zero runs since 2026-09-18 for the first two; Issue Statuses last ran 2026-09-22 21:43Z, matching the browser removal. Re-check the execution list the morning of the change.
- Rollback: re-activate (one toggle). Archive after two quiet weeks.
- Also: `scripts/b4-comment-echo-probe.js` loses its target; delete or retire it in the same repo PR.

### Slice 3. Browser: stop calling the dead Linear webhooks (repo PR, B1 style, no owner)
- Removes: `linear-subissues` callers ("Import from Linear"), `linear-tweak-comments` preview, `linear-issues` / `linear-projects` / `log-linear-submission`, `WORKLOAD_LINEAR_URL` sites.
- Prove unused: they cannot succeed (keys revoked); run `prod-write-gateway-browser.js` and the Workload source tests; show the page shrinks.
- Rollback: revert the PR (Pages redeploys on merge).
- Then (**owner**) deactivate Linear Sub-Issues and Tweak Comments in n8n, same as Slice 2.

### Slice 4. Urgent Tweak → Slack: retire only the legacy fallback (repo PR, then **owner** for n8n)
- The urgent editor ping stays; it must keep working (AGENTS.md, 2026-09-14). Only the n8n fallback for cards without a `video_deliverable_id` goes.
- Prove unused first: count cards whose urgent action would still take the fallback (no `video_deliverable_id`). If it is zero, remove the fallback branch in the browser. If not, bind those cards to native deliverables first.
- Rollback: revert the PR. Then (**owner**) deactivate the n8n workflow.

### Slice 5. Turn `linear_inbound_enabled` off (**owner**, one flag row)
- Removes: the last "on" Linear flag. linear-inbound then acknowledges without writing.
- Prove unused: zero edge-log calls since 2026-09-20 23:08Z.
- Rollback: set the flag back (one row update; the change is logged in `flag_flips`).
- Leave the webhook subscription on the Linear side untouched. Everything inside Linear stays as it is (AGENTS.md, 2026-09-14). With the flag off and the function deleted in Slice 7, a delivery simply fails on our side.

### Slice 6. Retire unscheduled Linear GitHub workflows and their secrets (repo PR, then **owner** for secrets)
- Removes: the dispatch-only workflows listed in 1f (keep `deploy-f27-linear-inbound.yml` until Slice 7), plus paired entries in `scripts/monitoring-watchdog.js`.
- Prove unused: schedules already commented out since 2026-09-20; no run in Actions history since then (check the Actions tab per workflow).
- Rollback: revert the PR. Secrets: the owner deletes `LINEAR_API_KEY`, `LINEAR_MIRROR_API_KEY`, `LINEAR_STATE_UUID_MAP` from repo settings only after the PR merges (values are revoked anyway, so no rollback is needed).

### Slice 7. Delete the three Linear Edge Functions (**owner**, deploy-class)
- Order: `workload-linear` first (zero calls in 7+ days, returns 409), then `linear-outbound`, then `linear-inbound`.
- Before: a repo PR removes them from `ef-deploy-manifest.js`, the Section 4 lane's function set and pins, the onboarding lane, the inbound lane, and their tests and scripts. That PR changes a deploy lane, so it needs the normal review.
- Prove unused: edge logs show zero calls for 72 hours before deletion.
- Rollback: redeploy from the last green commit (the Section 4 lane's sealed bundle already captures linear-outbound's live source). Keep the source in git history; note the commit SHA in OPEN_REPAIRS.
- Edge secrets to delete afterwards (owner): `LINEAR_MIRROR_API_KEY`, `LINEAR_READ_API_KEY`, `LINEAR_API_KEY`, `LINEAR_INBOUND_SIGNING_SECRET`. **Keep `B4_TEST_PROJECT_IDS`**: production-write's TEST intake path (`projectForIntake`, `:2475`) builds its allowlist from it and refuses with 403 without it. It goes only after Slice 8 moves the TEST override off project ids.

### Slice 8. production-write: stop enqueueing to `mirror_outbox` and stop reading Linear (**owner**, Section 4 deploy)
- Removes: about 15 enqueue sites (today 100% of new rows are `skipped`), the `linearRead` / label-catalog Linear calls, the parity-flag reads. Treat both authorities as permanently syncview.
- Prove unused: 1,177 of 1,177 rows since 2026-09-19 are `skipped`; zero `written` since 2026-09-18.
- Rollback: redeploy the previous Section 4 bundle (the capture script already produces it; upload before dispatch).
- Also retire `outbox-debt-census.yml` in the same PR so it does not page on an empty sink.

### Slice 9. Workload snapshot slimming (repo PR + SQL migration, **owner** for apply)
- Removes from the SNAPSHOT projection: `url`, `linear_parent_ids`, `parent_identifier` (about 27% of the uncompressed answer). Keep the columns in the view for parent routing.
- Also: `workload_issues` has no writer since 2026-09-21 14:50Z. Decide whether the legacy arm of the view is still needed; if not, drop it from the view and retire `workload-source-freshness.yml` and the boot early-fetch (`005:169`).
- Prove unused: browser code search for each field; `test/workload-native-view-contract.js` updated; measure the wire size before and after.
- Rollback: re-apply the previous view definition (kept in the migration).

### Slice 10. Drop Linear-only database objects (**owner** for apply; last)
- Order inside the slice: views and SQL functions that only the deleted functions used, then `linear_intake_receipts`, `linear_outbound_cutoff_control`, the two one-off backup tables, `track_b_*` rollback ledger, the `linear_exit_*` schemas, then `mirror_outbox` (21 MB), and last the four `linear_*` flags (keep `prod_authority` until every reader is gone).
- Before dropping, capture a full restore kit and store it in the SyncView Backups drive:
  - a schema-only dump of every object in the slice (tables, views, functions, triggers, the three schemas), including grants;
  - a data dump of each table;
  - the four flag rows, copied as they are.
- Rehearse the restore on the `syncview-restore-scratch` project before touching production. The drop does not ship until the kit recreates every object, grant and flag there, and the contract tests pass against it.
- Revokes and drops must name all four roles (`public`, `anon`, `authenticated`, `service_role`) where grants are touched.
- **Keep:** `linear_archive` and the link columns on deliverables, calendar posts, samples, and comments, because they are how old cards reach their history. Dropping those is a separate owner decision, not B2.
- Rollback: apply the rehearsed restore kit (schema, then data, then grants, then flag rows).

### Slice 11. Docs and credentials tidy (repo PR + **owner** in n8n)
- Move the Linear-exit docs into `docs/archive/linear-exit/` with an index; do not delete.
- Owner deletes the Linear credential(s) in n8n once no workflow uses them.

---

## 3. Open questions for the owner
1. Brief media: accept that Linear-hosted images in old briefs may no longer be fetchable (Slice 0)?
2. Urgent-tweak Slack ping: how many cards still lack a native deliverable and would take the legacy fallback (Slice 4)?
3. Keep the legacy `workload_issues` arm (frozen since 2026-09-21) or cut it (Slice 9)?
4. Confirm nothing outside the repo reads the blanked sheet column, and whether the three unnamed webhook paths (`linear-issues`, `linear-projects`, `log-linear-submission`) are served by any workflow.
