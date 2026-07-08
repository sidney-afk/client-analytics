# SyncView Monitoring Coverage

This page answers: what watches each critical SyncView sync edge, where alerts land, and how to roll it back in one step.

| Edge | Watcher | Cadence | Alert / evidence | One-step rollback |
|---|---|---:|---|---|
| Staff UI -> Supabase writes | Track A Edge Function guard suites, source tests, parity harnesses, and the TEST-scoped Calendar/Samples E2E nightlies | On PR + nightly | Failed GitHub Actions run; write failures are also recorded in the relevant event ledger | Remove the affected slug from the Track A runtime flag, or set the flag to `{"clients":[]}` |
| Supabase -> staff UI render | Unit tests, visual/source tests, and `prod-readonly-smoke.js` for the Production preview | On PR + nightly after this PR merges | Failed GitHub Actions run; Production smoke asserts rows render, 0 console errors, and 0 non-GET requests | Revert the frontend PR and let GitHub Pages redeploy |
| Linear -> calendar/sample cards | Existing n8n webhook `MJbMZ789B5ExZz9x` plus `Linear ⇄ SyncView status reconcile` and `Samples ⇄ Linear status reconcile` | Webhook real-time; reconcilers about every 10 min | Reconciler run summaries and card event ledgers; n8n `errorWorkflow` alerts DM Sidney | Remove affected slugs from `calendar_upsert_ef_clients` / `sample_review_ef_clients`; for inbound fallback, keep n8n active |
| Linear -> deliverables mirror | `linear-inbound` webhooks plus `Linear ⇄ deliverables reconcile v2` | Webhook real-time; reconciler about every 10 min | Reconciler summary events; unmapped state and unknown-assignee anomalies POST to the existing Slack alert webhook, throttled to one alert per anomaly type per hour | Set `linear_inbound_enabled` to `{"enabled":false}`; hard stop is disabling the two EF-bound Linear webhooks |
| Card linkage slots | Reconciler v2 `linkage_actionable` metric and the linkage backfill plan | About every 10 min | Summary event field `linkage_actionable`; classified raw residue is counted separately | Leave slots dormant or reverse the specific private-artifact slot fills if owner asks |
| Front-end render health | Calendar/Samples E2E nightlies and Production read-only smoke | Nightly + on demand | Failed GitHub Actions run; screenshots/log artifacts stay in Actions or private local artifacts | Revert the frontend PR and let GitHub Pages redeploy |

## Alert destinations

- n8n workflow failures use the existing `SyncView - Error Alerts -> DM Sidney` wiring.
- Edge Function anomaly alerts use the project `SLACK_ALERT_WEBHOOK` secret and send public-safe messages only: anomaly type, Linear issue identifier, and team. They do not include client names, assignee names, emails, or raw payloads. Metadata check on 2026-07-07 found this secret is not yet present in Supabase, so it must be added before deploying the alerting code if live Slack delivery is required.

## Nightly test boundaries

- Calendar and Samples nightlies are scoped to the `sidneylaruel` TEST client and dummy/test rows; each probe cleans up after itself.
- The Production preview smoke is read-only. It serves `index.html`, opens `?prod=1`, verifies migrated rows render, and asserts zero write-like browser requests.
