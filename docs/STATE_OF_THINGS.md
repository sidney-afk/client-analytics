# State of things

**Read this first.** One short, true list of what is open, what is switched off on
purpose, and what is already done even though an older doc still calls it open.
Every line below was checked against the live system on **2026-09-26** (read-only
SQL on `syncview_runtime_flags`, tables and row counts; the live Edge Function
list; the n8n workflow list). Where a doc and the live system disagree, the live
system wins and this page says so. Counts only, no client names.

When you close or change something here, update its line in the same PR. If a
line is older than a week, re-check it before relying on it.

---

## Needs the owner

- **Retire the hiring senders once the editor hire closes.** Both n8n hiring
  dispatchers (interview invite, practical test) are still active and run every
  5 minutes, and the journal says the "Hiring Raw Log" data table (applicant data) is to be cleared then (not re-counted today).
  Evidence: n8n list 2026-09-26, both `active: true`. No deadline, but it is
  personal data sitting in a third-party tool.
- **Stop the restore scratch project.** The second Supabase project
  (`syncview-restore-scratch`) is ACTIVE_HEALTHY. Storage custody step 1 says
  "scratch server stopped". Evidence: `list_projects` 2026-09-26. It costs money
  and holds a restored copy of production data.
- **Client-link token check is still permissive.** `auth_enforcement` =
  `permissive`, unchanged since 2026-07-05. By owner decision client links stay
  tokenless (AGENTS.md), so this is a confirm-and-record item, not a bug; the
  go-live checklist still has an unchecked "read back `enforced`" box.
- **2026-10-15: assurance-ledger lane goes red again.** Four quality-tier rows
  were restated, not re-proven, and reach 90 days on about 2026-10-15
  (OPEN_REPAIRS 205a). The fix is to re-prove those surfaces, which needs live
  access from the owner's machine. The separate "Linear access extension to
  2026-10-15" is moot: all Linear keys were revoked on 2026-09-23.
- **123 cards archived in Linear before the cutoff still show as open** in
  SyncView (test client excluded). A sweep needs the owner's word
  (OPEN_REPAIRS 224, journal 2026-09-21). Not re-counted today.
- **Open design decisions, each waiting on one ruling:** whether the server
  should recompute a calendar post's overall status (OPEN_REPAIRS 212); the
  Create Post server-side card link design point (254); the topbar "New issue"
  control; Step 29c alert consolidation; modularization C3 step 0 start.

## Needs a session

- **CLAUDE.md deploy-lane table is stale.** `linear-inbound` and `linear-outbound`
  are deleted (not in the live function list), `deploy-f27-linear-inbound.yml`
  no longer exists, and the Section 4 lane now releases **three** functions
  (`production-write`, `deliverable-write`, `batch-write`), not four. The owner's
  capture script needs `--slugs=production-write,deliverable-write,batch-write`.
- **Duplicate ledger numbers in OPEN_REPAIRS:** 13, 14, 22, 23, 175, 176, 177,
  180 each appear twice, and 220 sits before 218/219. Append a renumbering
  note; never rewrite.
- **Write-refusal log works; read it.** 4,573 refusals recorded since
  2026-09-23 (OPEN_REPAIRS 225 said "never recorded one"). 4,206 are
  `invalid_staff_key` on the Production gateway, almost all on 09-23 and 09-24
  and down to 2 on 09-25, so it looks like one automated caller that stopped.
  Next: the new `traffic` column (256) is still empty on every row; confirm it
  fills on new rows.
- **Scheduled lanes that are red** (`production-polish-gate` red since 09-17;
  the lanes in OPEN_REPAIRS 205). Repair or retire each. Not re-checked today.
- **Workload plan `list` deadline** is only budget-raised, not fixed
  (OPEN_REPAIRS 210).
- **A press that starts in a dialog and ends outside closes it**, 13 sites
  (OPEN_REPAIRS 215).
- **Calendar rename does not reach the deliverable title in Production**
  (journal 2026-09-22). Rename propagation is on for samples and card to
  sub-issue; this path is still a gap.
- **Mixed-batch orphans:** a browser fix should re-attach 22 cards; nobody has
  confirmed it on a live read (journal 2026-09-22).
- **Copy scripts die on a bare network error** (OPEN_REPAIRS 223).
- **Onboarding runbooks have no native steps** for their retired Linear parts
  (OPEN_REPAIRS 227).
- **Sheets to Supabase, next steps:** the mirror write is on and backfilled
  (about 5,200 metric rows, 57,000 top-video rows); the mirror READ is off and
  enrolled only for the test client. `client_profiles_authority` is still
  `sheet`. n8n dual-write nodes wait on the owner's go-ahead per workflow.
- **`mirror_outbox` still grows** (236 new rows in the last 24 hours, all
  receipts; 12,974 total). Retiring it is a planned later slice, not urgent.

## Dormant on purpose (switched off, leave alone unless asked)

- `linear_outbound_enabled` = off and `linear_legacy_parity_enabled` = false
  since the 2026-09-20 cutoff. Kept only because `production-write` reads them.
- `native_card_materialization` = `hold` since 2026-09-17 (dropped, could reopen).
- Native client provisioning and SyncView retirement activation: the SQL
  functions exist and are never called; retirement activation always refuses.
- Native intake completion, native notification sender, native urgent handoff,
  named append, existing-card assignment: built or drafted, not switched on.
- Linear-only calendar slots: the repair script found **0** slots to connect
  (2026-09-24), so there is nothing to apply.
- Five Linear-only GitHub workflows are unscheduled but kept for hand dispatch.
- SyncView v2 (Next.js) and making the repo private: plans only; the owner
  decided on 2026-09-24 to keep the repo public for now.

## Done (was listed as open somewhere)

- **Linear is fully off.** No `linear-*` Edge Function is deployed
  (`linear-inbound`, `linear-outbound`, `workload-linear` all gone); all Linear
  API keys revoked 2026-09-23 (the runbook's STEP 7, which some docs still call
  pending). The n8n Linear calendar workflows and the monitoring pager are
  inactive, which also ends the n8n bill item in OPEN_REPAIRS 233.
- **Brief media rescue.** `native_brief_media` = `required` since 2026-09-21;
  1,338 of 1,338 occurrences `verified`, 1,338 files in the bucket. Supersedes
  F34 and LINEAR_MEDIA_RESCUE. (The execution map row saying `off` is stale.)
- **All native capabilities on:** intake epochs, assignment, ordinary receipts,
  label catalog, identifier mint are `native` for both teams.
- **Migrations applied** that the ledger still calls "built, not applied":
  rename propagation release 1 and 2 (242, 243; flag on 2026-09-23), secure
  2026-08-24 backup table (248; RLS on, no browser grants), retirement assert
  re-pin (249), B2 Slice 10 (view dropped, two flag rows gone), sheets mirror
  phase 1, client profile edits, write-refusal page and traffic (256).
- **Deploys done:** `production-write` v95 (2026-09-25), `write-diagnostics`
  v14 (2026-09-25), `brain` (2026-09-24, OPEN_REPAIRS 251), `analytics-read`,
  `analytics-write`, `client-profile-write`.
- **Urgent ping and public intake** are both enabled (docs that say "flag row
  absent" or "off by default" are old).
