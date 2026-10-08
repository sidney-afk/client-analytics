# Clients Info and Social Media Managers: SyncView's database becomes the main copy

Session Roster, 2026-10-02. Owner direction 2026-10-01: move everything off Google
Sheets, Clients Info first. Counts and roles only, no client names, slugs or
spreadsheet ids (public repository). Follows `docs/plans/2026-09-24-sheets-to-supabase.md`
("Later: a Clients admin tab") and section 3 of `docs/plans/2026-09-28-analytics-switch-on.md`.

## What "main copy" means here

Today the Clients Info and Social Media Managers tabs are typed in by hand or by
n8n, and a daily job copies them into the database. After the switch it is the
other way round: the database is where changes are made, and the Sheet is a
read-only mirror that is kept up to date until the last reader has moved off it.
One switch decides which is which: the runtime flag `client_profiles_authority`
(`{"source":"sheet"}` today). It covers both tabs, because they move together.

## Step 1 (this PR): the database pieces and two doors. Nothing is switched on.

| Piece | What it is |
|---|---|
| `migrations/2026-10-02-roster-native.sql` | The manager's Slack id; a history of who moved which client to which manager; a retry list for the Sheet copy; two functions (create or change a client, assign a manager) that **refuse unless the switch says "syncview"**; the Clients tab's own edit now also queues the Sheet copy once the database is main. Source only: Lighthouse applies it after the owner's go. Way back: `...ROLLBACK.sql`. |
| `roster-read` (Edge Function) | n8n reads clients and managers from the database. JSON, or CSV with the Sheet's own headers and quoting, so a reader that parses the Sheet's CSV parses this unchanged. Answers at any time and says which copy is the main one. |
| `roster-write` (Edge Function) | n8n writes: `upsert_client` (onboarding, with the manager in the same call; creating or restoring also puts the client on the four save-permission lists), `archive_client`, `set_client_fields` (with an optional "only if it still holds X" check, for the Slack channel finalizer), `assign_manager`. Also `copy_to_sheet`, `queue_full_copy` and `status`. And `sync_managers`, the Sheet-is-main door for Manager Sync, now carrying the Slack id; it refuses once the database is main. |
| `client-profile-write` | The Clients tab save. Its Sheet path is unchanged. Once the switch is "syncview" it saves to the database only (same version check, same history) and then copies the row to the Sheet. |
| The read-only Sheet copy | After each database change the same change is written to the Sheet: only changed cells, as plain text, never another column, one read and one write per tab per call (so a full resync of the roster is a handful of requests). A copy that cannot be made stays queued and is retried; the database change stands. It is refused outright while the Sheet is the main copy (after a rollback nothing queued can overwrite it), and a change queued while another copy was running gets one more copy so the newest state is always written last. |

Both doors are for n8n only: no browser access, a key (`ROSTER_SERVICE_KEY`, 32+
characters, a Supabase secret, never in a file) checked before anything is read.
Edits are recorded in `client_profile_edits` (every field, who, from, to) and
`smm_assignment_edits`.

**To switch on (Lighthouse, each with the owner's go):** apply the migration;
set the secret `ROSTER_SERVICE_KEY`; confirm `GOOGLE_SERVICE_ACCOUNT_JSON` and
`CLIENTS_INFO_SHEET_ID` are set (the Clients tab already uses them) and that
the service account can edit the Sheet; deploy `roster-read`, `roster-write`
and `client-profile-write` from "Deploy one allowlisted Edge Function" (the
workflow page, the function, and the merged commit to paste). Deploying changes
nothing a user sees.

## Step 2: the n8n edits (DONE 2026-10-02 with the owner's go; versions and undo in `docs/ops/N8N_EDIT_LOG.md`, OPEN_REPAIRS 331)

Done 2026-10-02 (the table is what the plan said; what was actually changed is in the edit log). Every Sheets node named here existed
(read from the live workflows 2026-10-01). n8n gets one new credential, "Roster
service key" (header `X-Roster-Key`).

| Workflow | Today | Becomes |
|---|---|---|
| Onboarding: Append Client Row | Two Sheet nodes (Clients Info, Social Media Managers). The webhook has no authentication. Has never run (no retained execution). | One call to `roster-write` `upsert_client` with the manager. Also adds the missing `postforme_instagram_account_id` and drops `linear_api_key` from its mapping. |
| Slack Creative Channel Finalizer (every 15 minutes) | Reads Clients Info and Social Media Managers; writes `creative_channel_id`; reads it back | `roster-read` for both reads; `roster-write` `set_client_fields` with the "still empty" check; read back from `roster-read`. About 96 runs a day stop reading the Sheet. |
| CLIENTS METRICS | Reads Clients Info (two nodes, one a disabled copy) | **No edit from this plan.** Harbor's PR (daily metrics job in our own Edge Function, shadow first) reads the roster from `client_profiles`, so n8n's Clients Info read goes away with the n8n job. Until n8n is switched off it keeps reading the Sheet, which stays a faithful copy. |
| TOP VIDEOS | Reads Clients Info | **Harbor's next step** (its Top Videos port reads `client_profiles` too). Edit here only if that port is not ready when the switch happens: then `roster-read` clients. |
| MARKET RESEARCH | Reads Clients Info (a Sheets node and two CSV downloads) | `roster-read` clients (csv), unless Harbor's Market Research port lands first |
| Clients: Content Ready Notify | Reads one client's row | `roster-read` clients with `client_name` |
| SMM Reports: Manager Sync | Daily; reads the managers tab; sends names, emails, client lists | Before the switch: send the Slack id too, to `roster-write` `sync_managers`. After the switch: switch it off. |
| VIDEO PRODUCTION AUTOMATION | Three CSV downloads of the managers tab; one code step also reads `linear_api_key` (dead, Linear is cancelled) | `roster-read` managers (csv); drop the Linear step |
| Inactive or one-off (Weekly Slack Top Reel and its test copy, AI WORKFLOW, Slack Private Channel Provisioner, Workload Tweak Comments, 16 one-offs) | Read or write the tabs | Left alone; each would need `roster-read` before being switched on again |

Not covered here: the **page** still reads both tabs itself (`CLIENTS_URL` for the
client list and allowlist, `KASPER_SMM_URL` for the review queue's manager map).
That is its own step (a staff-key read for the page), so Step 1 stays
server-only. **Built 2026-10-08 (session Quarry, OPEN_REPAIRS 369), behind the switch
`"roster": "database"`; steps in `docs/ops/ROSTER_PAGE_SWITCH_STEPS.md`.** The Video Editors tab is a separate move.

## Step 3: the switch (DONE 2026-10-02 20:00 UTC, clean parity before and after; steps 1 to 5 below ran in that order; step 6 is the owner's)

Order, in one sitting: (1) run the daily copy once and the parity check, so the
database equals the Sheet; (2) set `client_profiles_authority` to
`{"source":"syncview"}`; (3) publish the Onboarding and Finalizer edits, then the
readers, then switch Manager Sync off; (4) `queue_full_copy`, then `copy_to_sheet`
until nothing is pending, so the Sheet matches; (5) prove it on the test client
only (create, change, assign, one Finalizer run, the Clients tab save, the Sheet
shows each change); (6) the owner protects the two tabs in Google (only the
service account and the owner may edit), which makes the Sheet truly read-only.
After the switch the daily Sheet copy refuses to run by itself (existing rule).

**Way back, one step:** set the flag back to `{"source":"sheet"}`. Anything changed
natively meanwhile exists only in the database, so before reversing run
`queue_full_copy` and `copy_to_sheet` so the Sheet has it. Then re-point the n8n
nodes to their previous version (n8n keeps it).

## Retiring the Sheet (proposed, not done)

When Step 2 is done and the page has moved, nothing reads the two tabs. Then:
stop the Sheet copy, keep the tabs for one month, archive them. Owner decides.

## Linear key column

The Social Media Managers tab still has a `linear_api_key` header (empty on every
row; checked 2026-10-02). Nothing in the database has one. Removing the column
from the Sheet would break the Onboarding node that still maps it, so it goes
right after that node's edit (Step 2); two code steps that read it by name
(VIDEO PRODUCTION AUTOMATION, the inactive Workload Tweak Comments) simply find
nothing. Docs that tell people to fill it in are corrected in this PR.

## Questions the owner asked, answered

- **PostTracking** (5,648 rows, one per post): one row per scraped post holding
  its first-seen date, views yesterday and views today. CLIENTS METRICS reads it
  each run to work out "views gained today" (today minus yesterday, per post) and
  writes the new numbers back. Nothing else reads it: no page, no other
  workflow. It is working memory for that one job, not reporting data. Harbor's
  PR (`docs/plans/2026-10-01-n8n-off-analytics.md`) already moves it: a table
  `analytics_post_tracking`, seeded from the tab (5,648 usable rows, the same count
  as above), written in the same transaction as the day's row. So PostTracking is
  Harbor's and this plan does nothing for it; the tab stops being updated once
  n8n's job is off. Harbor's job reads `client_profiles` (keep `archived_at is null`
  as the rule for a current client); after the switch that table is edited natively,
  so its roster stays right with no Sheet in the loop.
- **PTO Accrual Tracker:** archived 2026-10-02 (owner's go): moved, not deleted, into a new `Archive` folder at the top of the Drive; undo by dragging it back. Nothing reads it. The Time Off page and the `pto`
  function use the database (10 members, 13 requests, 9 adjustments); no n8n
  workflow references the file; the PTO handoff doc said to retire that interim Sheet.
  Deleting it for good stays the owner's call.
- **Project Central:** archived 2026-10-02 (owner's go): its n8n workflow is unpublished
  (not deleted; undo and version in `docs/ops/N8N_EDIT_LOG.md`). The workbook is untouched.

## Findings from checking every reader against the one Sheet

- Every workflow with a Sheets node was read (2026-10-02, all 120 by name or id). Each
  points at the main Sheet or the live Calendar workbook, with these exceptions: **VIDEO PRODUCTION
  AUTOMATION's four calendar nodes write to an older calendar workbook** (a
  different, older file; the live Calendar workbook appears in none of them), and
  the three Project Central workflows use their own workbook. One inactive
  workflow (BACKUPS) cannot be opened over MCP, so its ids are unknown.
- The daily copy job and the page read the main Sheet.
- Pasted secrets exist in several n8n Code nodes (listed in the session report,
  not here).

## Decided by the owner, 2026-10-02: the four save-permission lists follow the client

A client that is not on `sample_review_ef_clients`, `calendar_upsert_ef_clients`,
`settings_ef_clients` and `write_ui_reroute_clients` has its Calendar, Samples and Settings saves
paused (raised by Beacon). So, in the database functions of this change, in the same transaction:

- **Creating or restoring a client** (`client_profile_service_write` with a display name) adds it to
  all four lists and makes its `clients` row active (if it has one). A plain field change never touches the lists.
- **Archiving** (new `client_profile_archive`, door `roster-write` action `archive_client`) takes it off
  all four lists, makes it inactive, writes the history, and the Sheet copy deletes its Clients Info row
  (otherwise the daily roster job, which reads that tab, would bring it back).
- **The test client is never touched.** Not enrolled, not removed, not archivable (`kind = 'test'` or the
  test slug; creating or changing its profile still works, so the proofs can run on it).
- A list that is missing, not an object, not an array of strings or holds a duplicate **refuses the
  whole call** (nothing created, nothing archived); a live flag is never rewritten from a bad shape.
  The four rows are locked in key order, as the native client provisioning does.
- The result of every call says what it did to the lists (`routing.changed`). Rollback does not undo
  list changes already made (they are live settings; the rollback file says so).

Not done here: `public.clients` rows are still created by the native provisioning or by hand (this
change never invents one), and `clients-roster-sync` still reads the Sheet tab, which after the switch is a
mirror (it works, because the copy keeps the tab right; moving it to read the database is its own step).
PR 1926 (removing seven stale names from the lists) is separate and unaffected.

## For Beacon (onboarding project)

The Clients tab design is left open. A client's profile is one row plus a free
`extra` object, every change is a row in `client_profile_edits`, and a new field
is added in three places: the `extra` list in the migration's functions
(`allowed_extra`), `EXTRA_FIELDS` in `supabase/functions/_shared/roster-native.mjs`,
and (only if it should appear in the Sheet) the Sheet's header. A checklist can be
a new table keyed by client slug that follows the same pattern (a service
function, a history table, no browser access).
