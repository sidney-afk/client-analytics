# Supabase — current truth

> Last verified: 2026-07-14 @ e3961b6 (Management API and live readback)
> Live facts from `docs/audits/2026-07-05-supabase.md` (verified 2026-07-05) unless noted.

## Tables

See `docs/truth/ENDPOINTS.md` for the access inventory. Highlights:

> **READ-ACCESS BLOCKER (F88; live count-only census 2026-07-14).** Of 37 exposed table paths, 20
> have nonempty rows selectable with the browser publishable key, including cross-client operational
> rows/events, rosters/mappings, reports, filming plans, and thumbnail revision metadata. Client
> tokens gate SPA behavior only; direct PostgREST does not consult them. The owner must explicitly
> accept every exposed field as public (with legal/client review) or replace raw policies with
> principal/client/role-scoped projections. F86 specifically requires minimizing raw staff/client
> tables. B1 proved anonymous writes were denied; it did not prove read confidentiality.
>
> **Thumbnail v2 source remediation (not yet a live claim):**
> `migrations/2026-07-14-thumbnail-revision-v2.sql` revokes anon/authenticated SELECT from
> `thumbnail_media_revisions`. The SPA instead calls a principal- and card-scoped Edge reader that
> returns short-lived signed images and no raw paths/Drive/requester/error fields. F83 closes only
> after the migration and negative PostgREST/read-scope probes are applied and read back live.

- `calendar_posts` — main calendar store (~3.4k rows at last count; ~77% belong to the TEST
  client; most rows archived).
- `sample_reviews` — SXR store (GA but barely adopted by real clients at last count).
  Referenced in code via `SXR_TABLE`.
- `workload_issues` — **read-only mirror** of Linear (4 teams present: VID/GRA/CON/STR;
  56 messy `client_name` variants — normalize via `wlNormalizeClient()`).
- `syncview_runtime_flags` — runtime kill-switches / migration routing. Values have different
  schemas and move during cutover; **never** assume they are all TEST-only. Read them live and
  reconcile with `ROLLBACK.md` plus `docs/independence/GO_LIVE_CHECKLIST.md` before an operation.
  B0's `BEFORE UPDATE` trigger maintains `updated_at`, and the separate `flag_flips` trigger records
  old/new value plus actor/time; read both after every change. Canonical `prod_authority` sides are
  only `linear`/`syncview`. F55 remains open because several backends also accept legacy `supabase`
  while the browser rejects it; do not use that alias.
- Event ledgers `sample_review_events` (~22k rows) + `calendar_post_events` (~473):
  **100% `source='ui'` to date** — the `linear_in`/`linear_out`/`reconcile` paths have never
  written events; inbound/reconcile bypass the ledger. `deliverable_events` (Track B) must
  not inherit that bypassability.
- Track B tables (`batches`, `deliverables`, `deliverable_events`, `clients`, `team_members`)
  are additive; read by the visible Linear mirror's internal `production` boot.
- `thumbnail_media_revisions` stores private baseline/latest metadata and Storage object paths for
  Calendar/Samples continuous Drive-thumbnail history (with the older graphic-tweak capture as a
  fast path). Browser SELECT is removed by the 2026-07-14 migration;
  the private bucket remains non-public. `thumbnail-revision-read` is the only browser comparison
  projection and binds one authenticated principal to one surface/client/card before signing the
  two image objects for five minutes.

## Write contract (calendar/SXR upsert paths)

- Payload shape `{client, post|sample, comments_base_at}`; `__CLEAR_LINK__` sentinel clears
  a Linear link; a guard gauntlet exists in n8n and is ported to the EFs.
- The EF ports string-extract 11 symbols from `index.html` **by name** (`grabFunc`) — renaming
  those symbols silently breaks the port. Check `supabase/functions/` before renaming
  anything the write path touches.
- Known dropped field: SXR writes `kasper_finish_log` but the column doesn't exist on
  `sample_reviews` and the EF allow-list omits it (calendar has both). Data is lost silently.
- Thumbnail v2 uses server-owned `thumb_rev` for cross-viewer cache invalidation. The additive
  database triggers mint for enrolled clients on media assignment (including a same-value
  assignment) and when graphics leave `Tweaks Needed`; the two upsert EFs mint before responding.
  They also enroll active Drive thumbnails in continuous watches; a bounded service-role repair RPC
  fills older-path gaps. A confirmed scanner change is rotated in one locked transaction: close the
  Previous/Current pair, bump the exact source row's `thumb_rev`/`updated_at`, and install Current as
  the next pending baseline. That reaches open tabs through their existing realtime row and keeps
  later replacements detectable even when no SyncView write occurs.

## Edge Functions

Client/staff verifier truth is also not ready for enforcement: F87 records missing request controls,
uniform denials, bounded event retention, and explicit audit-outage behavior. F89 proves
`client_access_events.ok` means access-allowed rather than credential-valid; the current seven-day
window has zero valid-token events and cannot satisfy the spec's active-client validation gate.

Live set in `docs/truth/ENDPOINTS.md`. Source now represents 25 functions. The existing onboarding
deploy Action covers 7 and still uses an unpinned latest CLI; this branch adds a separate pinned
`2.109.0` workflow for the 4 thumbnail-path functions. That new workflow is source coverage, not
evidence that its first main run or the deployed function fingerprints were verified. Seven
functions use floating `supabase-js@2` (six npm aliases plus one `esm.sh` alias), and no function
has a committed lock/import map. Treat every deployment/rebuild/rollback as F51-gated until all 25
source closures, dependencies, JWT settings, toolchain, release SHA, and downloaded server
fingerprints are manifested and independently read back.

Thumbnail v2 is controlled by backend flag
`thumbnail_revision_v2={"mode":"off|test|on","clients":[...]}`. `off` fails the protected reader
and scanner closed and prevents v2 server token minting; `test` requires an explicit enrolled client
scope; `on` permits all clients. The scheduled scanner separately requires
`X-Syncview-Scheduler-Signature`, fails closed when its secret is absent, limits each request, and
returns aggregate counts only. The GitHub caller remains dark unless repository variable
`THUMBNAIL_REVISION_SCAN_ENABLED` is exactly `true`.

## Backup and capacity truth

- The live project is on **Pro**, not Free. The 2026-07-13 readback showed seven completed daily
  physical backups spanning the included seven-day retention window; the newest completed that day.
- PITR was **off** at the readback. That matches the approved temporary-window policy, but means PITR
  must be explicitly enabled and read back before each named risky window; it cannot be assumed.
- Database disk utilization was **0.45 GiB used**. The old "approaching a 500 MB Free cap" framing is
  obsolete. Capacity monitoring should use the live Pro disk/usage readbacks.
- No successful scratch restore rehearsal is documented. Backup existence is not restore proof;
  the timed restore + replay verification remains a hard pre-flip gate.
- The Management API does not settle billed egress or the project's spend-cap posture. Before the
  first flip, the owner must answer from **Dashboard -> Usage/Billing**: what is current egress, and
  is the spend cap enabled or disabled?

## Migrations

`migrations/` is additive-only SQL, manually applied, baseline-plus-deltas
(`migrations/README.md`). Log every applied migration in `EXECUTION_LOG.md`.
