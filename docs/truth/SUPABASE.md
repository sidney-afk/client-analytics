# Supabase — current truth

> Last verified: 2026-07-11 @ ae8a492
> Live facts from `docs/audits/2026-07-05-supabase.md` (verified 2026-07-05) unless noted.

## Tables

See `docs/truth/ENDPOINTS.md` for the access inventory. Highlights:

- `calendar_posts` — main calendar store (~3.4k rows at last count; ~77% belong to the TEST
  client; most rows archived).
- `sample_reviews` — SXR store (GA but barely adopted by real clients at last count).
  Referenced in code via `SXR_TABLE`.
- `workload_issues` — **read-only mirror** of Linear (4 teams present: VID/GRA/CON/STR;
  56 messy `client_name` variants — normalize via `wlNormalizeClient()`).
- `syncview_runtime_flags` — runtime kill-switches / migration routing. All flags currently
  `{"clients":["sidneylaruel"]}` (TEST only) — must match the `ROLLBACK.md` live-state table.
  **Hazard:** `updated_at` is provably not maintained on update; don't trust it for audit
  trail (Track B wants an update trigger or flip log).
- Event ledgers `sample_review_events` (~22k rows) + `calendar_post_events` (~473):
  **100% `source='ui'` to date** — the `linear_in`/`linear_out`/`reconcile` paths have never
  written events; inbound/reconcile bypass the ledger. `deliverable_events` (Track B) must
  not inherit that bypassability.
- Track B tables (`batches`, `deliverables`, `deliverable_events`, `clients`, `team_members`)
  are additive; read by the visible Linear mirror's internal `production` boot.

## Write contract (calendar/SXR upsert paths)

- Payload shape `{client, post|sample, comments_base_at}`; `__CLEAR_LINK__` sentinel clears
  a Linear link; a guard gauntlet exists in n8n and is ported to the EFs.
- The EF ports string-extract 11 symbols from `index.html` **by name** (`grabFunc`) — renaming
  those symbols silently breaks the port. Check `supabase/functions/` before renaming
  anything the write path touches.
- Known dropped field: SXR writes `kasper_finish_log` but the column doesn't exist on
  `sample_reviews` and the EF allow-list omits it (calendar has both). Data is lost silently.

## Edge Functions

Live set in `docs/truth/ENDPOINTS.md`. The path-triggered
`.github/workflows/deploy-onboarding-edge-functions.yml` deploys its explicit function list.
For #813, changes anywhere under `supabase/functions/linear-outbound/` (including its local mapping
and monitoring modules), `supabase/functions/production-write/`, or
`supabase/functions/_shared/` trigger that workflow. Merge-day manual dispatch pins
one exact main SHA and deploys `linear-outbound` before `production-write`, so the outbound target
contract and gateway caller cannot drift across releases.

## Open operational question

Plan/PITR tier unconfirmed (spec assumed PITR; docs imply free tier). Owner call needed
before relying on point-in-time recovery. *(Still open as of 2026-07-11.)*

## Migrations

`migrations/` is additive-only SQL, manually applied, baseline-plus-deltas
(`migrations/README.md`). Log every applied migration in `EXECUTION_LOG.md`.
