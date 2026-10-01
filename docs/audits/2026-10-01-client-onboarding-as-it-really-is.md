# How a new client is onboarded today (measured 2026-10-01)

Session Beacon. Read only: nothing was changed in n8n, Slack, Drive, HubSpot or Supabase, and no
message was sent. Purpose: the true picture, so SyncView can get an onboarding checklist and a
client profile (priority C in `docs/STATE_OF_THINGS.md`, which this feeds).

**Counts only, no client names or slugs.** "Active clients" below means the 35 rows in
`public.clients` with `active` and `kind = 'client'` (36 active rows including the one test client).

**Sources read:** this repo's docs and code, `synchro-brain`, `synchro-pipelines`, `synchrosocial`;
n8n (workflow graphs and executions); Slack (channel search and the first messages of the newest
channels); Google Drive (folder trees, sharing, the SYNCVIEW Sheet's shape); HubSpot (pipeline,
stages, deal and contact counts); Supabase (SELECT only).

**What could not be measured:** the n8n instance keeps only about 8 days of runs (oldest 2026-09-23),
so "last 30 days" of onboarding runs cannot be answered from n8n; the Clients Info Sheet read
returned its columns and one sample row, not every row (so its per-column counts come from the
Supabase copy, `client_profiles`); Slack channel member counts; the number of client-facing Slack
channels (most are private or shared and not visible to this account); Sandcastles; whether the
three Supabase onboarding functions were ever called (function statistics are switched off).

---

## The short version

1. Almost everything after the client pays is **a person (or a Claude session) doing a manual step**.
   Only four stretches are automatic: booking to HubSpot, contract and payment to the onboarding
   email, form submit to the client folder plus HubSpot "Closed Won", and the Slack creative
   channel.
2. The automatic chain has **not carried a new client since 2026-09-03**. The Slack channel queue has
   3 rows ever and all 3 ended in "manual reconciliation"; none completed by itself.
3. The repo's runbook is **right about most steps, wrong in a handful of places** (listed in
   section 3). The biggest: it says the client Slack channel is always manual, but the channel
   worker creates one itself and refuses to run if you already filled the field.
4. Most per-client facts are **already in Supabase** (35 of 35 on roster, token, profile, metrics).
   The facts with **no home anywhere** are the Drive client folder id, the HubSpot deal id, the
   contract and payment state, and who the SMM is (text match only).

---

## List 1: every onboarding step, in order

Who: **Owner** = Sidney, **Claude** = a Claude session, **Auto** = runs by itself, **Client** =
the client, **Staff** = Kasper or an SMM (the docs name them; who actually does it was not
verifiable for every step).
Reliable: Yes / Partly / No / Unknown, with the evidence.
Automate later: Yes / Partly / No.

### Before onboarding (the sale that triggers it)

| # | Step | What it does and where | Who | Produces | Reliable? | Automate later? |
|---|---|---|---|---|---|---|
| S1 | **Intro call booked** | Client books on the website's iClosed calendar. n8n "Call Booked" creates a HubSpot contact and a deal in "Call Scheduled", sends a confirmation, starts nurture, texts, and alerts Kasper on Telegram. | Client, then Auto | HubSpot contact + deal | Yes: 4 of 4 runs and 144 of 144 booking-recovery runs succeeded in the retained 8 days | Already automatic |
| S2 | **Sales intake submitted** | Staff fill the sales intake; n8n "Sales Intake - Submit" logs it, creates the e-signature contract, emails one message with the signing and payment links, DMs the owner, and makes the HubSpot deal if none exists. | Staff (who exactly: not verified) | Contract, payment link, deal | Yes: error workflow set, skips people who already have a deal | Partly (it is already a webhook) |
| S3 | **Client signs the contract** | e-signature provider calls n8n "Contract Signed": deal to "Contract Signed", sets `contract_signed`. | Client, then Auto | HubSpot flag | Partly: the check is a fixed secret in the workflow, not the provider's own signature (audit F115/F116) | Yes |
| S4 | **Client pays the first invoice** | Stripe or Commas calls n8n: deal to "Invoice Paid", sets `first_invoice_paid`, DMs the owner, ignores renewals. | Client, then Auto | HubSpot flag | Partly: Stripe path is open to anyone who can POST; Commas path checks a signature | Yes |
| S5 | **Onboarding email goes out** | Only when both flags are true: n8n sends the normal or the AI onboarding email, sets `onboarding_sent`, moves the deal to "Onboard Email". | Auto | Email + HubSpot stage | Partly: if both events land together neither may send (F115). Live now: 1 deal stuck in "Contract Signed" for 35 days; 2 in "Onboard Email" (6 and 43 days) | Already automatic |

HubSpot facts behind this: one pipeline "Client Acquisition", 8 stages, all ids and labels match the
docs (the only difference is a trailing space in "Contract Signed "). 39 deals: 6 Call Scheduled,
1 Contract Signed, 2 Onboard Email, 30 Closed Won. **26 of the 30 Closed Won deals were hand
imported on 2026-08-18** and carry no contract or payment flags; only 4 reached Closed Won through
the workflow in the last 90 days. That is why `contract_signed` is filled on just 5 of 31 customer
contacts, `first_invoice_paid` on 3, `onboarding_sent` on 3, and `is_ai_client` on none.

### Onboarding itself

| # | Step | What it does and where | Who | Produces | Reliable? | Automate later? |
|---|---|---|---|---|---|---|
| 1 | **Client watches "what to expect"** | Website step 1 (video). | Client | Nothing recorded | n/a | Could record a view; low value |
| 2 | **Client fills the SyncView onboarding form** | `/onboarding_form` or `/ai_onboarding_form`, 7 sections, autosaves. Submit goes to n8n, which writes `client_onboarding` (10 rows ever, newest 2026-09-02) or `ai_client_onboarding` (1 row ever), DMs the owner, and best-effort imports logins to the credentials vault. | Client, then Auto | Intake row, owner DM, vault rows | Partly: the form says "Thank you" on any success reply, even when only the backup copy saved (14 backup rows exist); no completion receipt (F110) | Partly (move to a Supabase function) |
| 3 | **Client books the kickoff call** | Website step 3 (`kickoff-call` or `ai-clone-consultation`, iClosed). | Client | A calendar booking, **not recorded in SyncView** | Unknown | Yes: a checklist tick from the booking |
| 4 | **Provisioning (automatic part)** | n8n "Client - Onboarding Provisioning": makes the Drive folder `{first}-{last}` in Clients, finds the HubSpot contact by email then phone, sets "customer", moves the deal to "Closed Won", queues one Slack job. | Auto | Drive folder, HubSpot end state, queue row | Partly: no run history kept; the Drive step has no error handling and blocks everything after it; error workflow now exists (docs still say it does not) | Partly |
| 5 | **Research: keywords, competitors, description** | Pull 5 to 10 reels, write `keywords`, `specific_keywords`, `content_description`, `competitors`. | Claude or Owner | Text fields | Partly: keywords, specific keywords, description filled for 29 of 35; competitors for 16 of 35 | Partly (Claude drafts, human approves) |
| 6 | **Clients Info row and SMM row** | The SYNCVIEW Sheet's `Clients Info` and `Social Media Managers` tabs. n8n "Append Client Row" can do both from one call, built for a Claude session. | Owner or Claude | The row that makes the client appear in SyncView | Partly: no retained runs; the call has no password (anyone with the address can write a client row) | Yes (this is priority A: move off Sheets) |
| 7 | **Create the canonical client row, token, four routing lists** | Documented as hand-run SQL (runbook 6e, 6f, 6k). Live: all 35 are on the roster, 35 have a token, all four lists contain all 35 (each list also holds 8 stale entries). | Owner or Claude per docs; **how it actually happened was not found** (34 of 35 rows say "source: sheet", the roster sync log shows 5 runs and 0 applied) | `clients` row, token, flags | Yes today (0 clients missing from any list); the process is unverified | Yes: a finished but never-run function does all of it in one transaction (`production_native_client_provision`, 0 receipts ever) |
| 8 | **Client Slack channel (private)** | Docs: manual. Reality: the channel worker creates a private `{client}` channel, invites Kasper and the SMM, and writes `slack_channel_id`. | Docs say Owner; worker does it | Channel + id | No: see section 3 | Yes |
| 9 | **Creative Slack channel** | Worker creates the public `{first}-{last}-creative` channel, invites 5 people, writes `creative_channel_id`, posts the kickoff, then the form answers. Waits until the Clients Info row, an SMM row with a Slack user id, and a filming plan link all exist. | Auto (webhook, daily check, and a 15 minute timer, all verified live) | Channel + id | **No**: 789 runs in 8 days all found nothing to do; queue has 3 rows ever, all ended "manual" (a missing Sheet column, a failed kickoff post, a channel that already existed). 98 creative channels are active but only 12 were bot made | Yes, already built |
| 10 | **Fill in the kickoff message** | The kickoff has placeholders (Team, Action items, Timeline, brand deck, onboarding call). The form answers message in newest channels was posted by a human account, not the bot, about 7 minutes later. | Staff (Kasper per the placeholders) | A completed brief | Unknown | Partly |
| 11 | **Filming plan Doc** | Create the master Google Doc in `Client Filming Plans / <client>`, share "anyone with the link, editor", one tab per month, then paste the link in SyncView's Filming Plans tab (admin). | Staff or Claude | Doc + `filming_plans` row | Mostly: 34 of 35 linked; 40 folders exist | Partly (the Doc can be created through `pipeline-google`) |
| 12 | **Assign the SMM** | Row in the `Social Media Managers` tab, plus the SMM's Slack user id. | Owner | SMM link | Partly: text match only, no id link; 33 of 35 match; `lead_member_id` is empty for all 35 | Yes |
| 13 | **Templates page (fonts, colours, thumbnail Canva link)** | Saved by staff in SyncView; nothing creates it for you. | Staff | `templates` row | Partly: 33 of 35 have a row; only 19 of 35 have a real Canva link | No (needs a person); a checklist reminder helps |
| 14 | **Brain folder and Editor brief** | Docs: a Claude session onboards the client in `synchro-brain`. Reality: all 32 folders were bulk made; no per-client onboarding commit exists; the automatic version is "in trial" and its form source reads "not read: query refused". | Claude | Four fact files + brief | Partly: 32 folders for 35 active clients; 3 forms ever saved as inputs | Yes, planned |
| 15 | **Ideas pipeline set up** (`new_client.py`) | Makes the client's pipeline config, then prints 3 manual steps: ideas Sheet, Sandcastles project, scope competitors. | Claude, then Owner | Config, ideas Sheet, Sandcastles id | Works but only 2 clients have it | Partly |
| 16 | **Social posting ids (optional)** | Connect TikTok or Instagram in Post For Me, paste the `spc_` id. | Owner | Account ids | Optional: 13 of 35 | No (client login needed) |
| 17 | **Sandcastles watchlist (recommended)** | Add the client and competitors. | Owner or Claude | Watchlist entries | Not measured | Partly |
| 18 | **Monthly check-in opt-in (optional)** | A row in `Monthly Checkup`. Runs on the 1st at 8:00 (ran today). | Owner | One row | Yes | Yes |
| 19 | **Verify and make the first real card** | Dashboard check, Create Post for the client, confirm a real row lands. | Staff | First `calendar_posts` row | 32 of 35 have cards | Partly (a scripted probe) |
| 20 | **Samples** | The form's sample video seeds sample edits for approval. | Staff | `sample_reviews` | Only 8 of 35 have any | No |
| 21 | **Next morning check** | New client appears in the daily metrics. | Auto | Metrics rows | Yes: 35 of 35 (but the daily metrics run failed on 09-24 to 09-27, fine since 09-28) | Already |

### Documented but not happening, and happening but not documented

**The docs describe it, but it does not (or is no longer true):**
- A Linear project per client. Retired 2026-09-20, yet runbook 6f still asks for Linear project ids and all 35 clients still carry them.
- The brain folder created automatically on intake. Planned and in trial; not working.
- `Weekly Slack, Top Reel` posting to client channels: switched off 2026-09-03.
- The runbook says "every `clients` row came from the July seed". Live: 34 of 35 say source "sheet".
- "Provisioning has no error workflow" (lifecycle map 15.20): it has one now.
- The Notion "New Client" workflow "has no production trigger": it is **active and failing every minute** (24 errors in 8 days, no alert).
- Pipelines runbook says 3 clients have a brain; there are 32.
- Native client provisioning is built and live in the database, called by nothing (0 receipts).
- "Calendar / Samples Provision Missing Tabs": inactive; harmless.

**It happens, but the docs do not say so:**
- The channel worker also makes the **private client channel** and writes `slack_channel_id`. Doing the documented manual step first sends the job to "manual" (this is what happened to one of the 3 queue rows).
- The form-answers Slack message in newest channels comes from a **human account** (footer "Sent using Claude"), not the bot.
- Older clients' onboarding form PDFs sit in their Drive folders (a 2025 process).
- **26 of 30 HubSpot customers were imported by hand** on 2026-08-18; for them there is no contract or payment record in HubSpot.
- A weekly backup copies the Sheet, repo, workflows and Supabase dumps to Drive every Sunday.
- 4 Slack bug channels from 2026-02-21 (`undefined-undefined`, `-creative`) show an earlier channel automation that was broken for a while.

### Other things worth knowing
- The bot has made only 7 real client channels (2026-07-26 to 2026-09-02); about 78 of all creative channels were made by hand by Kasper.
- Credentials are inlined into the kickoff message and stored in the queue table in clear text. The owner accepted this on 2026-08-24; not raised again.
- The Contract Signed secret is a fixed value inside the workflow, and the Append Client Row and Stripe webhooks have no authentication.

---

## List 2: every resource a client has

35 active clients. "Find automatically" says whether a later backfill could locate it for all
current clients without asking anyone.

| Resource | Lives today | Have / missing (of 35) | Find automatically for all? |
|---|---|---|---|
| Roster row | Supabase `clients` | 35 / 0 | Yes |
| Client profile (mirror of Clients Info) | Supabase `client_profiles` (authority still the Sheet) | 35 / 0 | Yes |
| Review token (secret) | Supabase `client_access` | 35 / 0 | Yes (never print) |
| Write routing (4 lists) | `syncview_runtime_flags` | 35 / 0 (plus 8 stale entries) | Yes |
| Email | profile | 27 / 8 | Partly (HubSpot has it for customers) |
| Instagram handle | profile | 32 / 3 | Partly |
| TikTok handle | profile | 18 / 17 | Blank can be valid |
| YouTube channel id | profile | 11 / 24 | Blank can be valid |
| Competitors | profile | 16 / 19 | No (needs research) |
| Keywords, specific keywords, description | profile | 29 / 6 | No (needs research) |
| Creative Slack channel id | profile and `clients` | 32 / 3 | Yes: search Slack by the name pattern |
| Client Slack channel id | `clients` 21 / 14; profile 32 / 3 | 32 / 3 | Partly: private and shared channels are not all visible; unclear if it is always a different channel from the creative one |
| Drive client folder | Google Drive "CLIENTS" (61 folders for 35 clients: legacy, duplicates, internal); **no id stored anywhere** | folder exists for nearly all; about 3 names have duplicates | Partly: match by name, needs a human for duplicates |
| Filming plan folder and Doc | Drive "Client Filming Plans" (40 folders) and Supabase `filming_plans` | link 34 / 1 | Yes |
| Templates row | Supabase `templates` | 33 / 2 | Yes |
| Thumbnail Canva link | `templates` | filled 33; real Canva link 19 / 16 | No for the 16 |
| Brain folder and brief | `synchro-brain` `clients/` | 32 folders (about 3 short, not slug matched); all 32 have 4 facts files and a brief | Yes |
| Onboarding form answers | Supabase (standard 7, AI 0, old Notion 14) and brain inputs (3) | any of the three tables 21 / 14 | Partly: the 14 are older clients with PDFs in Drive |
| Logins vault | Supabase `client_credentials` | at least one row for 17 / 18 | Yes (never print) |
| SMM | Sheet tab, text match; `lead_member_id` unused | 33 / 2 by text; 0 / 35 by id | Partly |
| HubSpot contact and deal | HubSpot; **not stored in SyncView** | 30 Closed Won deals; 29 have exactly one contact with an email | Partly: match by email or name |
| Contract and payment state | HubSpot flags | contract 5, payment 3 of 31 customer contacts | No for the 26 hand imports |
| Post For Me ids | profile | TikTok 13 / 22; Instagram 1 | No (client login) |
| Sandcastles project or watchlist | Sandcastles; pipelines config for 2 | Not measured; 2 with a project id | Partly |
| Calendar cards | `calendar_posts` | 32 / 3 | Yes |
| Sample reviews | `sample_reviews` | 8 / 27 | Yes |
| Analytics (metrics, top videos) | Supabase mirror | 35 / 0 | Yes |
| Old Roam group id | profile | 5 / 30 | Legacy |
| Kickoff call booking or recording | iClosed, Fathom | Not tracked per client | Partly (Fathom search by name) |

**Where data is thinner than it looks:** the two missing-from-everywhere facts are the Drive folder
id and the HubSpot deal id. Both could be found by matching and then saved once.

---

## Decisions needed from the owner

1. Should the checklist's source of truth be a new Supabase table (one row per client per step), with the checklist shown on the client profile in SyncView?
2. Which steps are required for "onboarded" and which are optional (Post For Me, Sandcastles, monthly check-in, samples, ideas pipeline)?
3. Keep the private client Slack channel being made by the channel worker, or turn that off and keep it manual as the docs say?
4. For a new client, should the SyncView Clients admin tab replace the Clients Info Sheet row (priority A) so step 6 disappears?
5. Switch on the finished native provisioning function as the "create client" button, or retire it?
6. Approve a read-only matching pass that proposes a Drive folder id, Slack ids and HubSpot ids for every current client, for you to approve before anything is saved?
7. Store the HubSpot deal and contract and payment state on the client profile (synced), or leave sales data in HubSpot only?
8. For the 26 hand imported customers with no contract or payment record, accept "unknown" or backfill from the e-signature and Stripe records?
9. Turn off the failing Notion "New Client" workflow in n8n (it needs your go)?
10. Finish automatic brain folder creation on intake, or keep it a Claude step in the checklist?
11. Who owns each step in the checklist (you, Kasper, the SMM, Claude)?
12. Add the kickoff call as a tracked step (booking or recording) in the checklist?
13. Clean up the 8 stale names in the four routing lists and the 13 inactive roster rows now, or leave them?

---

*Numbers measured live on 2026-10-01 by read-only queries. Cross-checked against
`docs/ops/NEW_CLIENT_ONBOARDING.md`, `docs/CLIENT_LIFECYCLE_MAP.md`, `docs/ops/N8N_EDIT_LOG.md`.*
