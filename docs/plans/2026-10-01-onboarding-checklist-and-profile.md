# Plan: client profile, onboarding checklist and backfill (Stages 2 and 3)

Session Beacon, 2026-10-01. Follows `docs/audits/2026-10-01-client-onboarding-as-it-really-is.md`
(the measured picture; Stage 1) and the owner's answers recorded there. **That file is in PR 1919; merge
it before this plan** (the plan cites its numbers and decisions). The runbook corrections that make the
client Slack channel automatic are in PR 1922; the owner decided this on 2026-10-01, so the checklist
treats both channels as automatic and detected, not manual steps. Priority C in
`docs/STATE_OF_THINGS.md`, built on top of priority A (Clients tab and Sheets move, session Roster).

**Rules for every step below.** One branch and one PR per step; Lighthouse merges. Every database
change is a source-only migration that Lighthouse applies only after the owner's go (the PR says so
and names the readback). Tested on the test client only. Counts and ids only in anything committed:
no client names, slugs, tokens or credentials (the repo is public).

## What the owner decided (summary)

A database table is the checklist's source of truth, shown on the client profile in the Clients
tab. Every step is required except "SyncView link sent" (optional, never blocks); no kickoff call
step. The client Slack channel stays automatic. The Clients tab replaces the Clients Info Sheet row
for new clients. The native provisioning function becomes a "Create client" button. HubSpot deal and
contract and payment state are stored on the profile; the 26 hand-imported customers are
"unknown". The matching pass reads `synchro-brain` first, then HubSpot, Drive and Slack, and saves
nothing until the owner approves. The owner owns every step by default; brain folder creation and
the other Claude steps stay Claude steps.

## Coordination with Roster

Roster (branch `claude/funny-mayer-e0v338`, plan `docs/plans/2026-10-02-roster-native.md`, migration
`2026-10-02-roster-native.sql`, not merged when this was written) is making the database able to be
the main copy of Clients Info and Social Media Managers. Read from its source-only migration:
write functions that refuse unless `client_profiles_authority` reads `syncview`, an append-only
SMM assignment log, and a retry list for Sheet catch-up.

**Split, so neither session edits the other's files:**

| Owned by Roster | Owned by Beacon |
|---|---|
| `client_profiles` and its edit rules, SMM assignment, `client_profiles_authority`, the Sheet catch-up | Checklist tables, resource and sales tables, backfill proposals, the new Edge Function, the "Create client" button |
| The Clients tab list and the profile's fact fields (handles, channels, keywords, SMM) | Two new sections on the same profile panel (Resources, Checklist) in their own fragment `src/index/324-client-onboarding-panel.js.part` |

**Agreements to confirm with Roster before 2.4** (message to be sent once; its answer goes in the 2.1 PR description):
1. The Clients tab opens a client's profile as a panel. Beacon adds a section slot (a function that returns the two sections) rather than editing Roster's markup.
2. The "Create client" button needs a way to create the `client_profiles` row. Does Roster Step 1 include a create function? If not, Roster adds `client_profile_create(slug, display_name)` behind the same authority check, and Beacon calls it.
3. Migration order: Roster's first (it adds the authority checks Beacon relies on), Beacon's after. Different file names; no shared table.
4. "Create client" works only when `client_profiles_authority` reads `syncview`. Until the owner switches it, the button is hidden except for the test client in preview mode.

## Data model (Stage 2, step 2.1)

All additive, no browser grants (staff reach it only through the new Edge Function), `service_role`,
`anon`, `authenticated` and `public` each named explicitly in every revoke (house rule).

- `onboarding_steps`: the catalog. One row per step: key, label, position, `required` (true except the optional SyncView link step), `kind` (`client`, `auto`, `claude`, `owner`), default owner (the owner), what proves it, and whether the system can detect it. Seeded from list 1 of the audit minus the kickoff call, plus one step the audit missed: **send the client their SyncView link** (optional).
- `client_onboarding_progress`: one row per client per step: `status` (`todo`, `done`, `skipped`, `unknown`), done by and when, evidence (a link or id, never a credential), note, who is responsible (defaults to the owner), and `source` (`manual`, `detected`, `backfill`). Unique on (client, step).
- `client_onboarding_events`: append-only history of every change (who, what, before, after), like the profile edit log.
- `client_resources`: only what has no home today: Drive client folder id, HubSpot contact id, brain folder path, Sandcastles id, Post For Me ids if not on the profile. Columns: client, resource key, value, `status` (`found`, `missing`, `unknown`, `not_applicable`), source, confirmed by and when.
- `client_sales_state`: per client: HubSpot deal id, HubSpot stage, `contract_state` and `payment_state` (`signed`/`paid`, `unsigned`/`unpaid`, `unknown`), `imported_unknown` (true for the 26 hand-imported customers, so the page shows "unknown", never "unpaid"), last synced.
- `client_backfill_proposals`: Stage 3 only: client, resource key, proposed value, source (`brain`, `hubspot`, `drive`, `slack`), how sure, evidence summary, `status` (`pending`, `approved`, `rejected`, `applied`), decided by and when.
- A read view `client_resource_status_v1` that joins what already lives elsewhere (roster, token present or not, profile channel ids, filming plan link, templates row and Canva link, credentials vault present or not, cards, samples, metrics) with the tables above, so the profile shows one honest list without copying data. Tokens and credentials appear only as present or missing.

Checks in the migration PR: the SQL runs on a throwaway Postgres in the test lane; a grants readback query (all four roles named) is in the PR; the migration does nothing until the owner's go.

## Stage 2: client profile with resources and checklist

| Step | PR | What | Proof |
|---|---|---|---|
| 2.1 | Migration | The tables and view above, plus `onboarding_steps` seed. Source only. | Throwaway Postgres suite; grants readback; owner's go, then Lighthouse applies |
| 2.2 | Edge Function `client-onboarding` | Read a client's checklist and resources; change a step (the allowed roles depend on open question 2: admin only until the owner answers; version checked like `client-profile-write`); every change writes an event; refuses clients not on the roster. Registered in the deploy manifest and the refusal log coverage list. | Offline handler tests; deployed by the owner through [Deploy one allowlisted Edge Function](https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-single-function.yml) |
| 2.3 | Script | `scripts/client-resource-census.js`: the audit's counts as a repeatable read-only report (counts only, never names). Also the detector behind "auto" steps: roster row, token, four routing entries, filming plan link, channels, templates, first card. | Run against live (read only) and match the audit's numbers |
| 2.4 | Page | Clients tab: the Resources section (each resource: found, missing, unknown, with its source and a link) and the Checklist section (steps in order, who owns each, done or not, evidence, "mark done" and "skip optional"). Required steps count toward "onboarded"; the optional step never blocks. Built in its own fragment; `npm run build:index`. | The mocked browser gates for the Clients tab; then a real browser pass on the test client only |
| 2.5 | Function and page | "Create client": calls `production_native_client_provision` (atomic: roster row, project ids, token, four routing entries, receipt) then Roster's profile create, then starts the checklist and queues the Slack finalizer. A preview mode shows exactly what it would create, with nothing written. | Preview on the test client; the real create only after the open question below is answered |
| 2.6 | Docs | Replace the runbook's quick checklist with a pointer to the in-app checklist; keep the runbook as the reference. Update `STATE_OF_THINGS.md` and the lifecycle map. | Link check; identity check |

**What the checklist will contain** (from list 1 of the audit): sale and payment signals shown
read only (HubSpot); form received; provisioning ran; research (Claude step); roster row (replaced
by "Create client"); SMM assigned; Slack channels (automatic, detected); filming plan Doc and link;
Templates and Canva link; brain folder and Editor brief (Claude step); ideas pipeline set up
(Claude step); first real card; metrics appearing next morning; and, optional, the SyncView link
sent and the social posting ids. Each shows "owner" as responsible unless changed.

**Claude steps today** (kept as Claude steps, marked as such with a copy-ready prompt that names
the session): brain folder and Editor brief, keyword and description research, filming plan Doc
creation, ideas pipeline set up. Everything else defaults to the owner.

## Stage 3: backfill for the current 35 clients

Principle: **find, propose, wait, then save.** Nothing is written to a resource, step or sales row
until the owner approves the proposals. Source order is fixed by the owner: `synchro-brain` first,
then HubSpot, Drive and Slack to fill what the brain does not say.

| Step | PR | What | Proof |
|---|---|---|---|
| 3.1 | Script | `scripts/client-resource-match.js`: read only. For each active client, in order: (1) the brain folder (facts, brief and any input files that name a Drive folder, Doc, Slack channel or HubSpot record); (2) HubSpot (match by the email on the profile, then name; one deal and contact per client; stage; contract and payment flags); (3) Drive (client folder under Clients and the filming plan folder, by name with duplicate detection); (4) Slack (creative and client channel by name pattern). Output: a proposal per client per resource with source, how sure, and the evidence kind. Written to the private `client_backfill_proposals` table (or a local file kept out of git), never to the repo. | Dry run on the test client against known truth first |
| 3.2 | Run | Proposals for all 35, read only. The owner sees counts by source and how sure, and the list of ambiguous matches (duplicate Drive folders, a client with two channels, a contact with two deals). | Report of counts only; no names in any committed file |
| 3.3 | Page and function | An approvals screen in the Clients tab: approve or reject a proposal, or a whole batch of high-confidence ones; only approved proposals are applied, each with an event. | Test client first; owner approves the real batch |
| 3.4 | Data | Mark the 26 hand-imported customers `unknown` for contract and payment; set all other sales fields from HubSpot as approved; run the census again. | Census before and after, counts only |

**What the backfill can and cannot find** (from the audit): roster, token, channels, filming plan
link, templates, calendar and metrics already exist and are only read. Genuinely new: the Drive
client folder (by name; about 3 names have duplicates that need a human), the HubSpot deal and
contact (29 of 30 customer deals have one contact with an email), and the contract and payment
state (known for only the few workflow-driven deals; `unknown` for the 26 imports).

## Stale roster entries (separate, owner approval first)

Not part of the stages. Seven client names are stale in all four routing lists (43 entries each:
35 clients, the test client, 7 stale) and 13 roster rows are inactive. The list of exact names
was given to the owner in chat. Removal needs the owner's yes; it is one transaction with a
readback, and the test client stays everywhere.

## Open questions for the owner

1. "Create client" refuses to recreate a client that exists. To test the real create, may Beacon use one throwaway test-kind row (removed afterwards), or should the real create only be previewed on the test client?
2. Who sees the checklist: admin only, or SMMs too?
3. Should HubSpot state be refreshed on a schedule (daily) or only when someone opens the profile?
