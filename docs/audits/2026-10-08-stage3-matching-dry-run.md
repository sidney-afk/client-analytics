# Stage 3 matching pass: dry-run report (2026-10-08)

Session Beacon. Step 3.1 and the first read of 3.2 in
`docs/plans/2026-10-01-onboarding-checklist-and-profile.md`. **Nothing was saved anywhere.** Counts only;
the per-client detail (names, ids, evidence) lives in a private file outside the repository and goes to
the owner on request, never into git.

## How it was run

- Script: `scripts/client-resource-match.js` (unit test `test/client-resource-match.js`). It reads local
  snapshot files only, makes no network call, refuses to write its detail inside a git checkout, and prints
  counts.
- Snapshots, all read only, taken 2026-10-08: the roster (35 active clients, one read-only SELECT);
  `synchro-brain` at its 2026-10-08 daily commit (read first, owner's order); HubSpot (41 contacts: the 31
  customers plus 10 leads on deals; 42 deals, all in the one pipeline); Google Drive (61 child folders of
  CLIENTS, 2 of them not clients; 40 of Client Filming Plans); Slack (104 channels visible to the reader,
  97 ending in `-creative`, 6 private).
- Test client first: run alone (`--only`), it came back with no brain folder and nothing else, which is
  the known truth (the brain holds real clients only).

## Result for the 35 clients

| Resource | Proposed | Confirms what SyncView holds | Conflict | Ambiguous (needs a person) | Nothing found |
|---|---|---|---|---|---|
| Brain folder | 32 | | | | 3 |
| Drive client folder | 31 | | | 1 | 3 |
| Drive filming plan folder | 34 | | | | 1 |
| Filming plan Doc named in the brain | | 23 | 1 | | |
| HubSpot contact | 26 (24 by the profile email, 2 by name) | | | | 9 |
| HubSpot deal | 25 | | | 1 | 9 |
| Contract state | 26: 6 signed, 20 unknown | | | | 9 |
| Payment state | 26: 4 paid, 22 unknown | | | | 9 |
| Creative Slack channel | | 31 (21 matched by name, 10 saved id only) | | 1 | 3 |
| Client Slack channel | | 31 (4 by name, 1 via the brain, 26 saved id only) | | 1 | 3 |

200 proposals in all: 192 high confidence, 8 medium, 0 low; by source brain 35, HubSpot 103, Drive 62.

## What this means

- **The two facts stored nowhere today are now findable.** A Drive client folder for 31 of 35 (1 needs a
  person to choose between two folders) and a HubSpot deal for 25 of 35 (1 contact has two deals).
- **Contract and payment stay mostly "unknown"**, as decided: no HubSpot flag is read as unknown, never as
  unsigned or unpaid. Only 6 contracts and 4 payments are positively known.
- **The 9 with no HubSpot contact:** 8 have no email on their profile and no exact name match in HubSpot;
  1 is an internal row that is on the roster as a client. Adding the missing emails is the cheapest fix.
- **Slack:** every saved channel id is either matched by name or kept as is; no saved id was contradicted.
  26 client channels are private or shared and invisible to the reader, so they are "saved id only", not
  verified. The 3 with nothing are the 3 internal rows on the roster (no channels by design).
- **One filming plan conflict:** the brain names a different Doc from the one linked in SyncView for one
  client. A person should look before anything is changed.

## Next (each with the owner's go)

1. The owner reads the private detail file (Lighthouse can hand it over) and says which batches to approve:
   "all high confidence" is 192 rows.
2. Step 3.3, the approvals screen, writes approved rows to `client_backfill_proposals` and then to
   `client_resources` / `client_sales_state`, each with a history row. Not built.
3. Run the census before and after (`scripts/client-resource-census.js`).
