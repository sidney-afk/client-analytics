# SyncView Monitoring Coverage

This page answers: what watches each critical SyncView sync edge, where alerts land, and how to roll it back in one step.

| Edge | Watcher | Cadence | Alert / evidence | One-step rollback |
|---|---|---:|---|---|
| Staff UI -> Supabase writes | Track A Edge Function guard suites, source tests, parity harnesses, and the TEST-scoped Calendar/Samples E2E nightlies | On PR + nightly | Failed GitHub Actions run; write failures are also recorded in the relevant event ledger | Remove the affected slug from the Track A runtime flag, or set the flag to `{"clients":[]}` |
| Supabase -> staff UI render | Unit tests, visual/source tests, and `prod-readonly-smoke.js` for the Production preview | On PR + nightly after this PR merges | Failed GitHub Actions run; Production smoke asserts rows render, 0 console errors, and 0 non-GET requests | Revert the frontend PR and let GitHub Pages redeploy |
| Linear -> calendar/sample cards | Existing n8n webhook `MJbMZ789B5ExZz9x` plus `Linear ⇄ SyncView status reconcile`, `Samples ⇄ Linear status reconcile`, and the n8n monitoring pager | Webhook real-time; calendar is n8n-requested every 10 min; GitHub schedules are cron-requested every 10 min but may deliver roughly hourly; pager checks staleness every 15 min | Reconciler run summaries and card event ledgers; n8n `errorWorkflow` alerts DM Sidney; pager alerts if a reconciler's latest completed run is older than 2h | Remove affected slugs from `calendar_upsert_ef_clients` / `sample_review_ef_clients`; for inbound fallback, keep n8n active; disable the pager workflow if it becomes noisy |
| Linear -> deliverables mirror | `linear-inbound` webhooks plus `Linear ⇄ deliverables reconcile v2` and the n8n monitoring pager | Webhook real-time; GitHub cron is requested every 10 min but observed delivery may be roughly hourly; n8n pager dispatches v2 dry-run every 15 min and alerts if no summary is fresh within 90 min | Reconciler summary events; pager alerts on non-zero `diff_count`, `repair_list_size`, or `linkage_actionable`; unmapped state and unknown-assignee anomalies POST to the n8n Edge Alert Relay once `SLACK_ALERT_WEBHOOK` is set and the Edge Function alert code is deployed | Set `linear_inbound_enabled` to `{"enabled":false}`; hard stop is disabling the two EF-bound Linear webhooks; disable the pager workflow to stop v2 dispatch/alerts |
| Card linkage slots | Reconciler v2 `linkage_actionable` metric and the linkage backfill plan | n8n pager dispatches v2 dry-run every 15 min; GitHub schedule remains a fallback | Summary event field `linkage_actionable`; classified raw residue is counted separately | Leave slots dormant or reverse the specific private-artifact slot fills if owner asks |
| Front-end render health | Calendar/Samples E2E nightlies and Production read-only smoke | Nightly + on demand | Failed GitHub Actions run; screenshots/log artifacts stay in Actions or private local artifacts | Revert the frontend PR and let GitHub Pages redeploy |

## Alert destinations

- n8n workflow failures use the existing `SyncView - Error Alerts -> DM Sidney` wiring.
- Edge Function anomaly alerts use the project `SLACK_ALERT_WEBHOOK` secret and send public-safe messages only: anomaly type, Linear issue identifier, and team. They do not include client names, assignee names, emails, or raw payloads. n8n workflow `Tfhc3vebZyG6obOg` is the active Edge Alert Relay to DM Sidney and synthetic relay execution `219237` succeeded on 2026-07-08. The Supabase secret + `linear-inbound` redeploy remain a separate live step because the alerting code is still on the draft monitoring branch until owner approval/merge.
- n8n workflow `qllIDZPkdNAPRj0b` is the active Monitoring Pager + Reconciler V2 Trigger. It runs every 15 minutes, dispatches `linear-deliverables-reconcile.yml` with `apply=false`, checks latest v2/mirror/calendar/samples evidence, and throttles each alert condition to at most once per hour.

## Nightly test boundaries

- Calendar and Samples nightlies are scoped to the `sidneylaruel` TEST client and dummy/test rows; each probe cleans up after itself.
- The Production preview smoke is read-only. It serves `index.html`, opens `?prod=1`, verifies migrated rows render, and asserts zero write-like browser requests.
