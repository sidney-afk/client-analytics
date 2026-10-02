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

**Agreed with Roster on 2026-10-01** (their PR: 1924, plan `docs/plans/2026-10-02-roster-native.md`, migration `migrations/2026-10-02-roster-native.sql`):
1. Roster's Step 1 has no page change. The profile panel is the existing Clients tab code; Beacon mounts its two sections from its own fragment into the panel container, and Roster will not move or rename that container without telling Beacon.
2. "Create client" calls Roster's `client_profile_service_write` with a display name (it creates the client or restores an archived one, and writes history to `client_profile_edits`). It is service role only and refuses unless `client_profiles_authority` reads `syncview`, with role `admin` or `n8n`. So Beacon's own Edge Function checks the admin key and calls it with role `admin`; the browser never calls Roster's n8n-key function, and Beacon never inserts into `client_profiles` directly. A new profile fact field goes through Roster (`p_extra`, `allowed_extra` in the migration, `EXTRA_FIELDS` in `supabase/functions/_shared/roster-native.mjs`); Beacon asks first.
3. Roster's migration applies first, Beacon's after; Beacon references `client_profiles(slug)` only.
4. The switch reads `sheet` today, so "Create client" refuses until the owner approves the flip. The test client proofs plan for that: the preview mode works either way; the real create is proven only after the flip.

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
| 2.2 | Edge Function `client-onboarding` | Read a client's checklist and resources, and change a step. **Both the read and the change are admin only** (owner decision 2026-10-01, widened only when the owner says so); the handler tests must prove a non-admin staff role is refused on read and on every write; version checked like `client-profile-write`; every change writes an event; refuses clients not on the roster. Registered in the deploy manifest and the refusal log coverage list. | Offline handler tests; deployed by the owner through [Deploy one allowlisted Edge Function](https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-single-function.yml) |
| 2.3 | Script | `scripts/client-resource-census.js`: the audit's counts as a repeatable read-only report (counts only, never names). Also the detector behind "auto" steps: roster row, token, four routing entries, filming plan link, channels, templates, first card. | Run against live (read only) and match the audit's numbers |
| 2.3b | Edge Function `client-hubspot-sync` | Read-only HubSpot reader that fills `client_sales_state` (deal id, stage, contract and payment flags; `unknown` for the hand-imported customers). Refreshes **daily** from a database timer (`pg_cron` calling the function) and **whenever a profile is opened** (the page asks for a refresh, rate limited per client). **Never n8n** (owner, 2026-10-01). Needs a HubSpot read-only token stored as a function secret by the owner; the token never appears in the repo or the page. Admin only. | Offline handler tests with a fake HubSpot; read-only live run on the test client's deal, then the owner approves the all-clients run; deployed by the owner through the single-function workflow linked above |
| 2.4 | Page | Clients tab: the Resources section (each resource: found, missing, unknown, with its source and a link) and the Checklist section (steps in order, who owns each, done or not, evidence, "mark done" and "skip optional"). Required steps count toward "onboarded"; the optional step never blocks. Built in its own fragment; `npm run build:index`. | The mocked browser gates for the Clients tab; then a real browser pass on the test client only |

**Step 2.4 built (2026-10-02, OPEN_REPAIRS 327):** fragment `src/index/324-client-onboarding-panel.js.part`, mounted under a client's details in the Clients tab, admin only. Three sections: HubSpot (deal, contract, payment; "Unknown" where HubSpot has nothing; a refresh is asked for when the profile opens), Resources (found, missing or unknown, with its source and a link), and the 27-step checklist (owner of each step, evidence, note; Mark done with optional evidence; a one-click skip for the two optional steps; a required step is skipped only with a note; Reopen). Proof: `docs/syncview-design/tests/clients-onboarding-browser.js` (mocked, offline) and `qa/probes/clients_onboarding_live.js` (live, test client only).
| 2.5 | Function and page | "Create client": calls `production_native_client_provision` (atomic: roster row, project ids, token, four routing entries, receipt) then Roster's profile create, then starts the checklist and queues the Slack finalizer. **In test mode the Slack queue is suppressed** (a test client never reaches the live finalizer; posting to any Slack destination for a test needs its own explicit approval, and none is assumed). A preview mode shows exactly what it would create, with nothing written. | Preview on the test client first (owner decision 2026-10-01); the one real create and its teardown only after the switch is flipped, see "Owner answers" below |
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

## Stale roster entries (done as a migration, owner approved 2026-10-01)

Seven stale names come out of all four routing lists (43 entries each become 36: the 35 clients and
the test client, which stays everywhere), and the inactive roster rows are archived, not deleted
(`board_status` set to `canceled`; the internal placeholder row is kept and the row that still has
calendar cards is archived with its cards untouched). Source only, applied by Lighthouse after merge:
PR 1926, `migrations/2026-10-02-roster-stale-cleanup.sql`. Names went to the owner in chat, not
into the repo.

## Owner answers (2026-10-01)

1. **Create client:** previewed on the test client first. After the owner flips `client_profiles_authority` to `syncview`, one real create with a clearly named throwaway client, then it is removed. **Finding from review, verified in the source (`migrations/2026-09-09-native-client-provisioning.sql`): this cannot be done with the existing function.** It always writes `kind = 'client'`, and its receipt is immutable and references the client row with `ON DELETE RESTRICT`, so a client it creates can never be deleted, and a teardown that insists on `kind = 'test'` would refuse it. So the throwaway proof needs one of two owner choices (open decision below). Either way: no Slack job is queued in test mode, and neither the real create nor any delete runs without the owner saying go at that moment.
2. **Checklist visibility:** admin only for now.
3. **HubSpot refresh:** daily and whenever a profile is opened, through our own Edge Function (step 2.3b), never n8n.

## Open decision (from the review of this plan)

The throwaway proof needs either:
- **A (recommended):** a small dedicated test path in step 2.5: a second database function that shares the real function's body but creates `kind = 'test'`, writes its receipt to a deletable test table (or none), and never queues Slack. The real function stays untouched. The throwaway can then be deleted, and the proof still exercises the same creation code. It is one more source-only migration, applied by Lighthouse after the owner's go.
- **B:** use the real function and keep the throwaway forever as an inactive, archived client (it cannot be deleted by design). No new database code, but a permanent leftover row and receipt.
