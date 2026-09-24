# B2: server-side Linear cleanup. Inventory and removal plan

Status: **partly executed.** Sections 1 to 3 were written on 2026-09-23 as
inventory and plan only. On the same day, with the owner's go-ahead, plan
Slices 1, 2, 5 and 6 were carried out; section 4 (execution log) records
exactly what changed live and how to roll each change back. Every other slice
is still pending. production-write was deployed by the owner for the brief
link rewrite, and 40 in-progress `deliverables.brief` rows were rewritten; both
are recorded at the end of section 4. No other table was changed except the one
flag row recorded in section 4. Measured 2026-09-23 (UTC) by the session
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

---

## 4. Execution log (2026-09-23, owner go-ahead for the n8n changes)

Owner decisions recorded with this go-ahead:
- Keep the frozen `workload_issues` table for now; its drop in Slice 9 is skipped.
- Leave everything on the Linear side untouched.
- The urgent-ping fallback, "Import from Linear", the tweak-comment preview, and every Edge Function or table change stay for later, because other sessions are editing that browser code.

### Slice 1 (plan Slice 1): archived the 5 inactive Linear-only n8n workflows. DONE 2026-09-23 ~13:55Z

| Workflow | id | Proof it was unused, re-checked right before archiving |
|---|---|---|
| Calendar - Linear Status Sync | `MJbMZ789B5ExZz9x` | inactive, 0 runs in retained history |
| Calendar - Linear Reconcile Trigger | `AkiFmromoDkmsh39` | inactive, 0 runs |
| Samples - Linear Reconcile Trigger | `ZJOtYpQZj73DcBB1` | inactive, 0 runs |
| Samples — Linear Status Sync | `qmDGbKnvrK0sPFKj` | inactive, 0 runs |
| Workload — Reconcile | `lGwC9WWPVJtxphtf` | inactive now; **correction to section 1b:** it had 390 runs in retained history, the last on 2026-09-21 14:50Z. That is exactly when `workload_issues.synced_at` froze, so this was the table's writer and was switched off then. It reads Linear, so it cannot run with the keys revoked. Archiving it does not touch the table, which the owner keeps. |

- **Rollback:** unarchive each workflow in n8n (Workflows, then the archived filter, then Unarchive). Its version history is kept. They stay inactive after unarchiving, which is how they were.

### Slice 2 (plan Slice 2): deactivated the 3 active Linear-only webhooks with no callers. DONE 2026-09-23 ~13:57Z

| Workflow | id | Last run, re-checked right before deactivating |
|---|---|---|
| Calendar - Linear Add Comment | `8stSpZUiyG7f2LQX` | none in retained history |
| Calendar - Linear Set Status | `VQqqeY9B2GZbh2Bt` | none in retained history |
| Calendar — Linear Issue Statuses | `GP8CSZDNcy5sGdFr` | 2026-09-22 21:43:37Z, the same as the inventory; nothing since |

- **Rollback:** re-activate (publish) each workflow in n8n with one toggle. They were deactivated only, not archived or edited. Archive them after two quiet weeks.

### Slice 3 (plan Slice 5): `linear_inbound_enabled` turned off. DONE 2026-09-23 14:02:01Z

- **Proof it was unused:** `linear-inbound` had zero Edge Function log entries in the 24 hours before the change, and none since 2026-09-20 23:08Z.
- **Change:** `syncview_runtime_flags` row `linear_inbound_enabled` went from `{"enabled": true}` to `{"enabled": false}`, `updated_by = 'owner-b2-slice5-inbound-off'`. The update was guarded on the old value.
- **Audit:** `flag_flips` id 124 recorded it automatically (key `linear_inbound_enabled`, old `{"enabled": true}`, new `{"enabled": false}`, actor `owner-b2-slice5-inbound-off`, ts 2026-09-23 14:02:01.858898Z).
- **Rollback:** guarded, so a newer change is never overwritten.
  ```sql
  update syncview_runtime_flags
     set value='{"enabled": true}'::jsonb, updated_by='owner-b2-slice5-rollback'
   where key='linear_inbound_enabled' and value='{"enabled": false}'::jsonb
  returning key, value, updated_at;
  ```
  - It must return exactly one row. Zero rows means someone changed the flag since this entry: stop and read `flag_flips` before doing anything.
  - Read the value back with `select value from syncview_runtime_flags where key='linear_inbound_enabled'`.
  - Confirm the reversal row in `flag_flips`.
- The Linear-side webhook subscription was left untouched, as the owner instructed.

### Slice 4 (plan Slice 6): retired 4 unscheduled Linear-only GitHub workflows. DONE in the repo PR that carries this entry

- **Deleted:** `b1-linear-incremental-refresh.yml`, `production-shadow-audit.yml`, `production-write-drill.yml`, `slice5-test-drills.yml`.
- **Proof they were unused:** all were dispatch-only (schedules commented out 2026-09-20). Every one was already marked `retired: 2026-09-20, linear-cutoff` in `scripts/monitoring-watchdog.js`. No other workflow triggers them.
- **Skipped, still present:**
  - `linear-outbound-drain.yml`: the PR-triggered `graphics-f2-evidence` lane looks up its runs by file name.
  - `linear-deliverables-reconcile.yml`: its contents are pinned by the F27 reconciler closure that `f27-team-rollback-proof` checks.
  - Both need those lanes retired first.
- **Tests:**
  - YAML assertions were removed from 8 tests; their script checks stay.
  - The watchdog tests now accept a deleted host file for a retired lane, and still fail on a missing host for a watched lane.
  - `scripts/monitoring-watchdog.js` itself is unchanged.
  - `npm test`: 566 of 572 suites pass. The 6 failures fail the same way on `origin/main`.
- **Secrets these workflows used:** `LINEAR_API_KEY`, `ROLE_KEY_ADMIN`, `ROLE_KEY_SMM`, `ROLE_KEY_CREATIVE`, plus shared ones. Deleting any secret is a separate owner decision: `LINEAR_API_KEY` is still read by other workflows, and the `ROLE_KEY_*` secrets may have other users.
- **Rollback:** revert only the workflow-retirement commit, `ci: retire unscheduled Linear-only GitHub workflows (B2 slice 6)` (`git revert <that sha>`). Do not revert the commit that adds this execution log: the n8n and flag changes it records stay live either way. The files come back as they were, and nothing ran them on a schedule.

### Slice 5 (plan Slice 4): retired the legacy n8n fallback of the urgent editor ping. DONE in the repo PR that carries this entry (not deployed; Pages ships it on merge)

- **What changed (browser only):** the URGENT editor ping ("URGENT TWEAKS NEEDED") now goes only through the native route (`native_urgent_dispatch` via production-write). `URGENT_SLACK_URL` and every browser POST to `/webhook/send-urgent-slack` are gone, including the branch that fell back to it when the gateway answered `400 unsupported_action`. A card with no `video_deliverable_id` is refused before any confirm or request with a visible notice: "Link a native video deliverable first … Nothing was sent." No fake success, no latch, no marker. The same guard sits in all four callers (calendar, samples, samples Kasper queue, calendar Kasper queue) and once more inside the shared dispatch. The native path is unchanged. The Kasper ping (`send-urgent-kasper-slack`) is untouched. URGENT stays video-only: the visibility gates answer false for graphic, thumbnail, caption and title, and the native payload always carries the video deliverable (both now covered by `test/native-urgent-ui.js`).
- **Proof (read-only SQL, 2026-09-23, counts only):** non-archived cards whose video sits at Tweaks Needed (the only state that shows the editor URGENT action): 2 in `calendar_posts`, 0 in `sample_reviews`; **0** of them lack a `video_deliverable_id`, so no card that can show the action today would still take the fallback. Latent: 81 non-archived calendar cards (any status) carry a Linear link but no `video_deliverable_id`; if one reaches Tweaks Needed it now gets the honest refusal instead of a POST that could only fail. `sample_reviews`: 0.
- **Tests:** `test/native-urgent-ui.js`, `test/kasper-urgent-ping.js` and `test/linear-dead-rehearsal.js` updated to the new contract (the dead-Linear harness keeps intercepting `send-urgent-slack` as a safety net for stale cached pages); `docs/independence/SYSTEM_MAP.md` inventory updated (n8n webhooks 51 → 50).
- **Rollback:** revert the PR. Nothing server-side changed.
- **Next (owner, n8n):** deactivate workflow `TJVMyfwl85qrFGeK` (Urgent Tweak → Slack) only AFTER this PR has merged and Pages has deployed it. Deactivating first would not break anything that works today (it can only fail since the revoke), but the order keeps the rollback clean.
- **Done 2026-09-23 ~19:32Z (after PR #1522 merged):** workflow `TJVMyfwl85qrFGeK` deactivated (unpublished) in n8n; it had 0 runs in retained history. Rollback: re-activate it in n8n.

### Plan Slice 3, part: browser stops calling `linear-subissues`. DONE in the repo PR that carries this entry (branch `claude/b2-import-from-linear`)

- **What changed (browser only, `src/index/` then `npm run build:index`):**
  - Removed the kebab items **Import from Linear** and **Bulk Linear sync**, their two dialogs, the multi-select "Match to Linear" bar, and every helper behind them (fragments 130, 150, 160, 180).
  - Removed the link-time status adoption `_calSyncStatusFromLinear` (150) and its two callers (160 link commit, 170 link move), and `_sxrSyncStatusFromLinear` (290). Its two Samples callers in 270 already check `typeof` first, so they are now no-ops and 270 is untouched.
  - Removed `LINEAR_SUBISSUES_URL` (100). `index.html` no longer contains `webhook/linear-subissues`.
- **What users saw before:** Import / Bulk sync asked the dead webhook and showed its error inline ("Linear lookup failed" or "Could not reach Linear"). Link-time sync failed silently in a `catch`. **After:** the two menu items are gone (Import from Excel and Create Post stay). Pasting or moving a link saves exactly as before; the card keeps its SyncView status. No fake success, nothing silent left: nothing is attempted.
- **Not changed:** existing linked cards still display their links and persisted banners; no sub-issue creation path was added; no n8n, Edge Function or database change.
- **Proof:** new retirement guards in `test/import-from-linear-sealed.js` and `test/calendar-kebab-import-menu.js`; `test/linear-import-optional-graphics.js` deleted (its subject is gone) and unregistered; tests that expected the sync call now assert it never happens. `docs/independence/SYSTEM_MAP.md` and `docs/truth/ENDPOINTS.md` updated. `prod-write-gateway-browser.js` passes. `npm test`: 574 of 575 suites pass; the one failure, `truth-sync`, is only the pre-existing "freshness commit is an ancestor" check that also fails on `origin/main`.
- **Rollback:** revert the PR.
- **Next (owner, n8n):** deactivate workflow `Nk3pwR6Fbl4VAPqH` ("Calendar — Linear Sub-Issues") **only after this merges** and GitHub Pages has deployed it.
- **Done 2026-09-23 ~19:57Z (after PR #1524 merged):** workflow `Nk3pwR6Fbl4VAPqH` deactivated (unpublished) in n8n; 0 runs in retained history. Rollback: re-activate it in n8n.

### Slice 5 (plan Slice 3, part): Workload tweak-comment preview no longer calls `linear-tweak-comments`. DONE in the repo PR that carries this entry

- **What changed:** the Tweak Needed popover in Workload already read native rows, and legacy rows bound to a native deliverable, from `production-comments`. Only rows with no native binding still went to the n8n webhook, which can only fail since the Linear keys were revoked. That lane is removed: `LINEAR_TWEAK_COMMENTS_WEBHOOK`, `_wlLegacyFetchTweakComments`, its 5-minute cache and TTL are gone (`070-workload-source`, `090-workload-popovers-navigation`).
- **What users see:** before, an unbound row showed "Couldn't load this deliverable's feedback. Retry..." after the webhook failed. Retrying could never work. Now that row shows at once "Feedback for this item isn't shown here. Open the post in SyncView to check its review notes." No request is sent. Native and bound rows are unchanged. The "older comments ... in Linear" overflow text is gone.
- **Proof:**
  - `test/workload-tweak-feedback-source.js` (219 checks) now fails on any request to the retired webhook. It asserts that unbound, unclassifiable, and stale-bound rows settle as `retired` with no request.
  - `test/system-map-sync.js` and `test/truth-sync.js` pass, apart from the 4 pre-existing shallow-clone freshness checks.
  - The webhook was removed from `SYSTEM_MAP.md` (50 n8n webhooks) and `ENDPOINTS.md`.
  - The `linear-dead-rehearsal` floor went from 4 to 3.
- **Rollback:** revert the PR. The webhook comes back but still fails, because Linear is revoked.
- **n8n:** deactivate workflow `d7Dod7OuQsVsl1CN` ("Workload — Tweak Comments") only **after this merges** and Pages serves it (**owner**). It is not touched here.
- **Done 2026-09-23 ~20:19Z (after PR #1526 merged):** workflow `d7Dod7OuQsVsl1CN` deactivated (unpublished) in n8n; 0 runs in retained history. Rollback: re-activate it in n8n.

### Brief images on Linear's servers (measured 2026-09-23, read-only)

- **Scope:** 41 in-progress deliverables (statuses todo, backlog, smm_approval, kasper_approval, client_approval) carry `uploads.linear.app` links. There are 90 references to 81 distinct files, all inside `brief`; none are in `file_url`.
- **Do the originals load from the live site's point of view?** No. We requested 3 sample files with no credentials and the live site as the page they come from. Every one answered `401` with a small JSON error, so they need a Linear login. The Linear side is to stay untouched and the API keys are revoked, so these originals are gone to us.
- **Copies already exist.**
  - `native_brief_media_occurrences` holds a `verified` copy for all 90 references (41 deliverables), 124.5 MB in total (JPEG, PNG and SVG). The copies were verified on 2026-09-20 by `native-brief-media-copy`.
  - All 90 objects exist in the private bucket `syncview-native-brief-media`.
  - `native_brief_media` has been in `mode: required` since 2026-09-21 (`flag_flips` id 123).
  - Estate-wide, 1,338 references across 486 deliverables were copied, about 3.0 GB.
- **What the site shows today.**
  - The Production tab renders briefs through the native media projection. That projection swaps each Linear link for a 5-minute signed link to our copy, so the images load there.
  - The stored `brief` text still holds the Linear links. Any view that renders the raw text shows broken images: the fallback path noted in `230-production-create-comments.js.part:2344-2353`, and any other surface that prints `brief` directly (fragments 040 and 240 read it).

**Proposal (plan only, nothing done).** Make the copies the only source by rewriting the brief text.
1. **Where:** keep the files where they already are, in the private `syncview-native-brief-media` bucket. There is nothing new to copy for these 41 deliverables: 0 MB to move now, 124.5 MB already stored.
2. **How the links are rewritten:** replace each `https://uploads.linear.app/...` link in `brief` with a stable internal reference to its occurrence, for example `syncview-media:<occurrence id>`. Do not use a signed URL, which expires after 5 minutes. The projection that already signs links would resolve the new form the same way it resolves Linear links today.
   - Use one guarded write per deliverable, through the normal production write path, so the change is audited.
   - Do it only when the stored `source_sha256` still matches the current brief. A brief edited since the copy is skipped and reported.
3. **Before the rewrite:** make every renderer of `brief` (fragments 040, 230, 240 and any client view) resolve the internal reference, and teach the projection the new form. That is browser work, so it waits until the other sessions finish there.
4. **Proof:** after the rewrite, count remaining `uploads.linear.app` matches in in-progress briefs (target 0). Also run one headless-browser render of an affected brief with no Linear session, and require every image to load with a 200 response from our storage.
5. **Rollback:** before rewriting, snapshot each touched brief (id, old text, sha256) to the SyncView Backups drive. Restoring means writing the old text back through the same path.
6. **Estate-wide:** the same rewrite can cover all 486 deliverables with copies (about 3.0 GB, already stored). Finished and archived work can go later, or never, since the archive viewer already resolves copies.

### Brief image links (plan "Brief images on Linear's servers"): rewrite built, browser shipped, server needs an owner deploy. PREPARED 2026-09-23 (superseded: deployed and applied, see the DONE entry below)

**Surfaces that render `deliverables.brief` (measured in `src/index/`).** Only the Production tab draws a deliverable brief. The read view (`_prodDescriptionHTML` → `_prodLinkify`, fragment 230) prefers the server projection `description_read.media.render_brief` and falls back to the raw brief (the fallback noted at 230, and after the 5-minute signed links expire). The rich editor (`_prodDescRichInline`/`_prodDescRichSerializeInline`, fragment 240) is always seeded from the raw brief, never the projection. Fragment 040 is the AI analytics/market "brief" (`raw_json`), not `deliverables.brief`; the project description at 260 reads a project field. Calendar, Samples, Workload and the client views do not render `deliverables.brief`.

**Existing server behaviour.** `projectBriefMedia` (`supabase/functions/_shared/native-brief-media.mjs`, used only by production-write `description_read`) understood only `uploads.linear.app` links. production-write's `description` operation accepts any string up to the size limit (`canonicalDescription`), so a brief carrying a new reference form saves fine; saving a brief never re-triggers a media copy (copies are made only by `scripts/native-brief-media-copy.mjs`). `linear_outbound_enabled` is `off`, so a description write does not reach Linear.

**Reference form: `syncview-media:<occurrence uuid>`.** It replaces only the URL characters at the occurrence's exact UTF-16 offset/length, so `![alt](...)` and `<...>` stay byte-identical. It names the verified `native_brief_media_occurrences` row directly, so no URL hash or offset has to survive later edits. It is never a URL: the bucket is private and only the server can sign, so a browser-only resolver is not possible with the publishable key.

**What changed in this PR.**
- Server source (needs deploy): `projectBriefMedia` also resolves `syncview-media:` ids, looked up only among the row's own verified same-client/team copies, with the same copy validation, and signs them exactly like Linear links. Legacy links still work, and a brief can mix both forms. An id that is not one of the row's copies leaves the projection incomplete.
- Browser (ships with Pages on merge): an unresolved `syncview-media:` reference in the read view is drawn as a dashed "Image not loaded" placeholder, never an `<img>` or a link. In the rich editor it is a non-editable "Stored image" chip that serializes back to its exact source.
- `scripts/b2-brief-link-rewrite.mjs`: the dry-run default prints counts only. `--apply --client=<slug> --snapshot=<file>` requires `B2_BRIEF_REWRITE_CONFIRM=REWRITE_BRIEF_LINKS`. It writes a 0600 snapshot (id, old sha256, old text, new sha256) before any write, then makes one audited production-write `description` write per deliverable with `expected_updated_at` CAS and reads it back. `--rollback=<snapshot>` restores only rows whose brief still equals the rewritten text. Before the first write it probes the deployed production-write (`description_read` on one target) and aborts, writing nothing, unless `media.reference_forms` lists `syncview_media_v1`; the new projection source adds that marker. A row whose slug equals the private `B2_TEST_CLIENT_SLUG` env uses the service `test_override` path (the server decides whether it is the test client). Real clients need `SYNCVIEW_STAFF_KEY` + `SYNCVIEW_ACTOR` + `SUPABASE_PUBLISHABLE_KEY`.
- `test/b2-brief-link-rewrite.mjs`: tests offsets (including non-BMP text), duplicates, angle, plain and bare forms, edited briefs, wrong offsets, foreign or unverified copies, ambiguity, idempotency, the projection for legacy, new and mixed forms, and the shipped renderers.

**Proof.**
- The test client has no deliverable with a Linear-hosted brief image, so nothing was applied. No test data was fabricated.
- Read-only dry-run on the 41 in-progress deliverables, done in SQL with the script's criteria and UTF-16 offsets corrected: 41 deliverables and 90 links. All 41 deliverables and all 90 links are rewritable, 0 were skipped as edited and 0 as unmapped.

**Still needs the owner, in this order.** (Historical: all three steps are done; see the DONE entry below. Do not re-run.)
1. Deploy production-write through the Section 4 lane (capture first). Nothing else imports the shared module at runtime.
2. Run `--apply` for one client, then check the Production tab. The count of `uploads.linear.app` matches in its in-progress briefs should be 0, and the images should load from storage.
3. Run it for the rest.

Put each snapshot in the SyncView Backups drive, not the repo, because it contains brief text. Applying before the deploy shows placeholders instead of images: honest, but a regression. Roll back with `--rollback`.

**Update 2026-09-23: runner no longer needs the service role for real clients.** `scripts/b2-brief-link-rewrite.mjs` now reads every brief (dry-run, `--apply`, readback, `--rollback`) through production-write `description_read` with the staff headers (`SUPABASE_PUBLISHABLE_KEY` as apikey/Authorization, `SYNCVIEW_STAFF_KEY`, `SYNCVIEW_ACTOR`; `SUPABASE_URL` from env). The target list comes from `--occurrences=<file.json>`, an array of occurrence metadata rows (no brief text) exported read-only out of band, because the publishable key cannot read `deliverables.brief` or `native_brief_media_occurrences` (both 401) and the gateway does not expose occurrence ids. It is required for a live dry-run and for `--apply`; `--input` still works offline. Readback now also requires `media.unresolved === 0`, and `--stop-on-first-failure` is on by default (`--no-stop-on-first-failure` to continue). The service role is read only for the `B2_TEST_CLIENT_SLUG` test override. Progress: 1 of 13 clients was done on 2026-09-23 with an equivalent runner; its snapshot is in the SyncView Backups drive.

**Reconciliation guard (review follow-up).** An incomplete or stale occurrences export would silently drop whole deliverables, so `--apply` now also requires `--expect-deliverables=<n> --expect-links=<n>`. The operator gets these from an independent read-only query, per `--client` allowlist: count the in-progress deliverables (`status in (todo, backlog, smm_approval, kasper_approval, client_approval)`) whose `brief` contains `uploads.linear.app`, and sum the Linear links in those briefs. Before the probe, the snapshot or any write, the runner compares these numbers with the deliverables and links it counts in the gateway-read briefs of the file's targets. Any mismatch aborts with counts only. Dry-run prints both sets of numbers side by side. The CLI exits 1 when a run stops early or counts any failure, for both apply and rollback.

### Brief image links: in-progress rewrite applied. DONE 2026-09-23, one client at a time

- **Scope:** 41 in-progress deliverables with 90 Linear links across 13 client buckets, one of them the unattributed bucket.
- **Applied:** 12 client buckets, 40 deliverables and 89 links. Every run passed the dry run with the expected counts and wrote and verified every row, with 0 failures. Readback found 0 Linear links and 0 unresolved references. All 88 inline images load from storage, and the 1 SVG shows as its download link.
- **Left out:** 1 deliverable with 1 link in the unattributed bucket. production-write `description_read` refused it with 403, so the owner chose to leave it out of this job. It keeps its Linear link.
- **Snapshots:** one per client in the SyncView Backups drive, each the same size as the local file. The local copies were deleted.
- **Download-only copies:** the projection shows a stored PDF, SVG, MP4 or MOV copy as a download link (`display: download`), never as an inline image, so an image check must count these separately. Two different type fields are involved. The storage object's Content-Type is `application/octet-stream`, because the bucket only admits the four raster image types, and it must stay that way. The occurrence row's `mime_type` keeps the real type (`application/pdf`, `image/svg+xml`, `video/mp4`, `video/quicktime`), and the projection uses it to choose `display: download`. It must never be set to octet-stream, because the copy validation rejects that and the link would show as unresolved. 27 stored objects have a non-image Content-Type: 20 PDF, 2 SVG, 4 MP4 and 1 MOV by their occurrence `mime_type`. All 27 are referenced from a brief: 1 by a `syncview-media:` reference and 26 by the Linear link in an older brief.
- **Out of scope, measured only:** 445 older deliverables (approved, duplicate, posted, scheduled) still hold 1,248 Linear links. Every link has a verified copy, with 0 missing and 0 partial.

### Brief image links: older-briefs rewrite applied. DONE 2026-09-24, one client at a time

- **Scope:** the 445 older deliverables (approved, duplicate, posted, scheduled) with 1,248 Linear links, in 25 client buckets. The unattributed bucket was left out again.
- **Applied:** all 25 buckets, 445 deliverables and 1,248 links, each after a dry run that matched the independent counts. 0 failures. Readback found 0 Linear links and 0 unresolved references. One bucket first failed its read with a 503 and wrote nothing; the retry passed.
- **Snapshots:** in the SyncView Backups Shared Drive, never the repo (they hold brief text). They are gzip-compressed: `b2-older-brief-link-rewrite-snapshot-2026-09-24-clientNNof25.json.gz`. Clients 22 to 25 were too large to upload whole, so each is split into numbered pieces ending `.part00`, `.part01` and so on. Every upload was byte-compared with the local file, and the pieces were checked to rejoin exactly. The local copies were deleted.
- **To restore a client:** download its file (or all its pieces), join the pieces in order, then uncompress, and pass the `.json` to `--rollback`. The runbook is in `ROLLBACK.md`, row "B2 older-briefs link rewrite".

### Slice 7 (plan Slice 7, split by owner decision): delete `workload-linear` and `linear-inbound`. Repo PR ready 2026-09-24; function deletion is the owner's

- **Owner decision 2026-09-24:** `linear-outbound` moves to Slice 8. It is wired into the four-function Section 4 lane that Slice 8 deploys through, so deleting it first would break that lane's capture and its rollback. Slice 8 rewrites the lane to three functions, and `linear-outbound` is deleted only after that three-function deploy is green.
- **Live evidence (read-only, 2026-09-24 ~03:40Z):**
  - Edge logs over three back-to-back 24-hour windows (72 hours): 0 requests to `workload-linear`, 0 to `linear-inbound` and 0 to `linear-outbound`. The same query counts 12,484 `production-write` log lines in one of those windows, so it does see traffic.
  - `cron.job`: 0 of 2 jobs call any of the three. Postgres functions: 1 mentions `linear-inbound`, only in a comment.
  - Runtime flags: `prod_authority` is `syncview` for both teams (since 2026-08-28), so the browser never takes its `workload-linear` path. `linear_inbound_enabled` is off (since 2026-09-23).
  - `mirror_outbox`: 0 rows waiting. 101 are `stale`, a finished state, and the newest is 150 hours old.
- **Repo change:** removes `deploy-f27-linear-inbound.yml`, the `workload-linear` source and its two function tests, and both functions' deploy-manifest entries. `linear-inbound` is recorded as RETIRED with no deploy path. Its source stays only as the frozen reference about ten contract tests read, and goes in Slice 10. `B4_TEST_PROJECT_IDS` is untouched until Slice 8 is done.
- **Rollback:** see `ROLLBACK.md`, row "B2 Slice 7".
- **Done:** the owner deleted both functions on 2026-09-24; `list_edge_functions` no longer shows either.

### Slice 8 (plan Slice 8): `production-write` stops reading Linear and loses its Linear-send paths; Section 4 lane releases three functions. Repo PR ready 2026-09-24; deploy and `linear-outbound` deletion are the owner's

- **Owner decisions 2026-09-24:**
  - `mirror_outbox` rows keep being created. They are the receipts the reconcile check reads (#1544), and the DB trigger writes them as `skipped`. No migration. Renaming the table can come later.
  - `B4_TEST_PROJECT_IDS` stays as it is. Replacing it with a native project list is a later tidy-up.
- **Live evidence (read-only, 2026-09-24):**
  - `mirror_outbox`: 12,611 rows in total. All 2,082 created since 2026-09-19 are `skipped`; the last row actually sent to Linear was 2026-09-18 16:08Z.
  - Edge logs: 0 calls to `linear-outbound` in the latest 24 hours (0 over 72 hours at Slice 7).
  - Flags: `prod_authority` is `syncview` for both teams, `linear_outbound_enabled` off, parity off. Native label catalog mode is `native`; native intake and native assignment epochs are on for both teams. So the new refusals (409 on legacy parity or non-native intake, 503 on a non-native label catalog) cannot fire for today's traffic.
- **Repo change:** `production-write` loses every `api.linear.app` read, the outbox drain, its calls to `linear-outbound` and the provider assignee lane; mirror results report `not_applicable`. The Section 4 lane now deploys and attests three functions (`production-write`, `deliverable-write`, `batch-write`) but still inspects and restores the sealed four-function prior bundle, so the owner's capture script is unchanged for this release. `linear-outbound` leaves the onboarding deploy loop and is marked RETIRING in the manifest. The rollback-row freshness check treats it as optional. `production-write` re-pinned with `ef-fingerprint`.
- **After the deploy is green:** the owner deletes `linear-outbound` and the secrets `LINEAR_MIRROR_API_KEY`, `LINEAR_READ_API_KEY`, `LINEAR_API_KEY`. A follow-up PR narrows the prior set to three and gives the owner a one-line change to the capture script.
- **Later tidy-ups (not this slice):** rename `mirror_outbox`; replace `B4_TEST_PROJECT_IDS`; remove the browser's `workload-linear` fallback, dead behind the authority guard.
- **Rollback:** see `ROLLBACK.md`, row "B2 Slice 8".

### Slice 8, part 2: Section 4 prior set narrowed to three; `linear-outbound` deleted. Repo PR ready 2026-09-24; function and secret deletion are the owner's
- **Deploy (owner, 2026-09-24):** Section 4 run 36023623936 from `049d3e68` was green. Live afterwards: `production-write` v88, `deliverable-write` v45, `batch-write` v45. Recorded in `EXECUTION_LOG.md` (2026-09-24) and the canonical F27 row of `ROLLBACK.md`. Its sealed prior bundle `70129953…` / 682023 bytes is the four-function set (v82/v41/v41 plus `linear-outbound` v54): the one-step restore is `restore-captured-prior-four` with it until this PR merges; after merge a fresh three-function capture is required before `restore-captured-prior-three`. The owner then deleted `linear-outbound` and three secrets; the resulting version bump (live v91/v48/v48) changed no source.
- **Live evidence before deletion (read-only):** 0 edge-log requests to `linear-outbound` in the latest 24 hours. No function source left outside the frozen `linear-outbound`/`linear-inbound` directories reads `LINEAR_MIRROR_API_KEY`, `LINEAR_READ_API_KEY` or `LINEAR_API_KEY`.
- **Repo change:** the Section 4 lane's prior (sealed) set becomes the same three functions as its release set, and `restore-captured-prior-four` becomes `restore-captured-prior-three`. The rollback CLI allowlist, the rollback-row freshness check and final verification drop both Linear slugs. The manifest marks `linear-outbound` RETIRED. Its source stays frozen until Slice 10.
- **Owner's capture script:** one line changes, only after this PR merges: `--slugs=production-write,deliverable-write,batch-write`.
- **Rollback:** see `ROLLBACK.md`, row "B2 Slice 8".

### Slice 9 (plan Slice 9): workload snapshot slimming. CLOSED 2026-09-24 as already delivered by `migrations/2026-09-23-workload-native-snapshot-cache.sql`; no new migration
- **What was already live:** the `native_snapshot_v2` action of `workload-plan` serves the cached snapshot through `workload_native_snapshot_slim_v1(jsonb)`. Per row it drops `linear_parent_ids`, drops `url` from native rows, and drops `parent_identifier` wherever a parent has a single identifier (sending it once per parent in a `parents` map). The live `pg_get_functiondef` of `workload_native_snapshot_slim_v1` matches the repo migration line for line.
- **Live evidence (read-only, 2026-09-24), cached snapshot body:**
  - 6,770 rows, all native (0 legacy). Wire size 7,286,083 bytes.
  - Rows carrying `url`: 0. Rows carrying `linear_parent_ids`: 0. Rows still carrying `parent_identifier`: 1,412 (parents with more than one identifier). `parents` map: 76,474 bytes.
  - Simulated size with all three fields and the `parents` map removed: 7,171,472 bytes. The most a further cut could save is 114,611 bytes (about 1.6%).
- **Why nothing more is cut:** the browser still reads two of the fields.
  - `parent_identifier` feeds Workload search (`src/index/080-workload-render.js.part`) and the fallback parent label when the parent row is not loaded (`080` and `src/index/090-workload-popovers-navigation.js.part`); `src/index/070-workload-source.js.part` restores it from `parents`.
  - `url` survives only on legacy rows (0 today) and drives the "Open in Linear" link; the owner kept the legacy arm.
  - `linear_parent_ids` is already gone from the snapshot; its other browser uses read the `batches` table directly.
- **Kept, per owner decision:** the frozen `workload_issues` table and the legacy arm of the view.
- **Later tidy-ups (not this slice):** the legacy arm of the view, `workload-source-freshness.yml`, the boot early-fetch, and an optional follow-up that moves parent-name search and labels to batch names so `parent_identifier` and `parents` can leave the snapshot (about 115 KB, 1.6%).
- **Rollback:** none needed; this slice changes no code, SQL or live state.
