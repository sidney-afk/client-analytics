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
- **2026-10-15: assurance-ledger lane goes red again.** Four quality-tier rows
  were restated, not re-proven, and reach 90 days on about 2026-10-15
  (OPEN_REPAIRS 205a). The fix is to re-prove those surfaces, which needs live
  access from the owner's machine. The separate "Linear access extension to
  2026-10-15" is moot: all Linear keys were revoked on 2026-09-23.
- **Slack alerts become one message (owner said yes, 2026-09-28).** Build the
  single consolidated problem message with a quiet default proposed in
  `docs/ops/LINEAR_EXIT_STEP29C_ALERT_CONSOLIDATION.md`, AFTER the analytics
  move to Supabase lands.
- **Modularization C3 step 0 waits for Mason's C2 (owner, 2026-09-28).** Do
  not start it while the load-per-tab split is still editing the same files.

## Needs a session

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
- **Mixed-batch orphans:** a browser fix should re-attach 22 cards; nobody has
  confirmed it on a live read (journal 2026-09-22).
- **Copy transport retry is prepared for review** (OPEN_REPAIRS 223/279):
  bounded retries, 5xx handling, and ambiguous storage/receipt readback are
  tested offline. No live re-copy has been run.
- **F34 archive rescue is still open:** archived descriptions, comment bodies
  and attachments were never copied; the rescue config table has 0 rows. The
  brief-media half is done (see below).
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

- **Linear archive rescue (F34) is NOT needed. Owner decision 2026-09-28; do
  not raise it again.** Linear is being cancelled. Measured live the same day:
  3,478 briefs (with their images, see Brief media rescue below) and 14,205
  Linear comment bodies are already in SyncView, including those of cards
  archived in Linear. The only thing not copied is files pasted into about 246
  old comments on 46 cards (newest 2026-08-11), which stop opening once Linear
  is gone. The owner accepted that loss. The rescue script and its empty
  config table stay as dead reference.
- **Restore scratch Supabase project deleted** by the owner (only
  `syncview-calendar` remains, `list_projects` 2026-09-28).
- **Archived-in-Linear cards still open: swept 2026-09-28 on the owner's word**
  (OPEN_REPAIRS 282). 80 non-test cards in archived batches, with no calendar
  post link and untouched since their Linear archive, set to `canceled`. 8 left
  on purpose: 4 `posted` (correct), 1 edited after its archive, 3 linked to a
  calendar post (a status change there projects onto the client's calendar).
- **Design decisions closed 2026-09-28.** 212 (server recompute of a post's
  overall status): not needed, the page recomputes it on every load
  (`130-calendar-model-cache.js.part`), so the stored copy is never shown.
  Topbar "New issue": already removed in #1662. 254: not a decision; already
  deployed 2026-09-25 and checked live on the test client.
- **Analytics Sheets to Supabase:** the finishing prompt went to Prism on
  2026-09-28 (parity report, staff overview read, daily comparison, catch-up
  job, switch-on plan). Flags unchanged until the owner says go.

- **Guest-login gap closed before v2 sign-in (applied 2026-09-27).** The
  `authenticated` role no longer holds any right `anon` lacks: a live
  re-measure across tables, sequences, columns, functions, schemas and
  policies returns 0 rows (`migrations/2026-09-27-authenticated-grants-revoke-three.sql`,
  PR #1772). Anonymous sign-in stays OFF until the owner turns it on.
  Still open, separate: `anon` holds write and TRUNCATE grants (no SELECT) on
  the same three tables.

- **F27 capture guidance already names the three-function closure.** Read-only
  source check on 2026-09-26: `CLAUDE.md` and the Section 4 workflow both name
  `production-write`, `deliverable-write`, `batch-write`, and the old Linear
  inbound lane is absent. The saved `%USERPROFILE%\.syncview\f27-capture.ps1`
  also contains exactly `--slugs=production-write,deliverable-write,batch-write`
  and no Linear slug. This confirms the saved script text, not a fresh capture,
  bundle readback, or deployment; follow the fresh-capture gate before dispatch.
- **Linear is fully off.** No `linear-*` Edge Function is deployed
  (`linear-inbound`, `linear-outbound`, `workload-linear` all gone); all Linear
  API keys revoked 2026-09-23 (the runbook's STEP 7, which some docs still call
  pending). The n8n Linear calendar workflows and the monitoring pager are
  inactive, which also ends the n8n bill item in OPEN_REPAIRS 233.
- **Brief media rescue.** `native_brief_media` = `required` since 2026-09-21;
  1,338 of 1,338 occurrences `verified`, 1,338 files in the bucket. Supersedes
  F34 and LINEAR_MEDIA_RESCUE (the rest of F34 is not needed, see above). (The execution map row saying `off` is stale.)
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
- **Client links require their secret token.** `client-token-verify` runs
  browser entry in strict mode, which always requires one active client and
  its current token. `auth_enforcement` = `permissive` only affects legacy
  non-strict callers, and none remains: the only caller in this repo (and none
  in the other three repos) is the browser entry, which sends `strict: true`
  (`src/index/260-production-refresh-boot.js.part`).
- **Urgent ping and public intake** are both enabled (docs that say "flag row
  absent" or "off by default" are old).
