# New Client Onboarding Runbook (SyncView)

**Purpose:** the complete, do-not-forget checklist for bringing a brand-new client online across every SyncView system — the dashboard code, the Google Sheets, n8n, Supabase, Linear, Slack, Roam, and Post For Me.

**How to use it:** skim **§1 (Quick Checklist)** and tick the boxes. Each box links down to a detailed step. **§7** is a reference appendix (IDs, where the secrets live, the SMM roster).

> ⚠️ **This repo is public** (it ships to `syncview.synchrosocial.com` via GitHub Pages). Never paste API keys, review tokens, or other secrets into this file or any committed file. When a step needs a secret, it tells you which Sheet/tool to copy it from.

---

## 0. The systems involved (mental map)

| System | What it holds per client | Onboarding touch? |
|---|---|---|
| **Frontend** `index.html` | Derives the live client list from the **Clients Info** sheet at runtime (hardcoded list is just a fallback seed). | ❌ **Auto** — the Clients Info row does it |
| **"SYNCVIEW" Google Sheet** (`10QQ…QqAU8`) | The real per-client config for **Clients Info**, **Social Media Managers**, Templates, CaptionPrompts (+ data tabs the robots fill). | ✅ **2-3 rows** |
| **"SyncView Calendar" Google Sheet** (`1Gsn…A9Yps`) | `Calendar_<slug>` / `Samples_<slug>` / `TikTokUploads` tabs. **Now a legacy mirror** of Supabase. | ⚪ Optional |
| **Supabase** (`uzltbbrjidmjwwfakwve`) | `filming_plans` (master filming Doc links), `calendar_posts`, and `content_samples`. | ✅ Filming plan link via app; calendar/samples auto |
| **Google Drive** | The actual master filming Docs, inside **Client Filming Plans / <client display name>** with one folder per client — never inside the general **Clients / <client>** folder. | ✅ Create/move Doc |
| **n8n** | All the scrapers/automations (metrics, top videos, competitor & market research, weekly Slack, caption gen, calendar/samples sync). | ⚪ Mostly auto |
| **Linear** (`synchro-social`) | One **Project** per client across the **Video + Graphics** teams. | ✅ SMM does it |
| **Slack** | One channel per client (weekly reports + tweak pings post there). | ✅ Create channel |
| **Roam** | One automated **public** creative group per client; onboarding kickoff + full form answers post here after readiness checks pass. | ⚪ Queue after setup; worker creates it |
| **Sandcastles** | Content-intelligence watchlist — channel recaps, top hooks/topics/formats, outlier alerts. | ✅ Add the client **+ their competitors** |
| **Post For Me** (`postforme.dev`) | A connected **TikTok account** per client (TikTok auto‑upload). | ⚪ Not urgent |
| **SyncView onboarding** | Standard/AI intake rows and the staff onboarding inbox. A captured row is not yet proof of provisioning (F110). | ▶️ Current entry point |
| **Notion** | Replaced historical intake; retained records only. Its legacy workflow is not an operational fallback (F111). | ❌ Do not wait on it |

---

## 1. Quick checklist (the whole thing)

**Research / prep**
- [ ] SyncView standard/AI intake is visible in the protected onboarding inbox; record the durable
      job/receipt when F110 ships. A Slack alert is a convenience, not the source of truth. → [§2](#2-intake)
- [ ] Scrape 5–10 of their Instagram **reels** and write the **keywords** + **content_description**. → [§3](#3-research-keywords--content_description)

**SYNCVIEW Google Sheet** (`10QQ…QqAU8`)
- [ ] **Clients Info** → add a row (name, handles, competitors, keywords, content_description, Slack channel ID, Roam group ID, …). → [§4](#4-clients-info-row-the-big-one)
- [ ] **Social Media Managers** → add a row (who's their SMM). → [§5](#5-social-media-managers-row)
- [ ] *(owner/Kasper opt-in only)* **Monthly Checkup** → add a row only after approval. → [§6j](#6j-monthly-check-in-email)
- [ ] *(optional, later)* **Templates** → reels/thumbnail font & color prefs. → [§6b](#6b-templates--caption-prompts-optional)

**Filming plans source of truth**
- [ ] Create/move the client's master filming Google Doc inside **Client Filming Plans / <client display name>** — **not** their general **Clients / <client>** folder — and **share it "Anyone with the link → Editor"**. SyncView stores the URL; it does not grant access. → [§6a](#6a-filming-plan)
- [ ] In SyncView, sign in with an **Admin** staff identity, then open the main **Filming Plans** tab and add/update the client Doc link. → [§6a](#6a-filming-plan)

**Slack, Roam / Post For Me**
- [ ] Create the client's **Slack channel**, grab its **channel ID** (→ Clients Info) and **member/SMM user ID** (→ SMM tab). → [§6c](#6c-slack-channel--automated-roam-creative-group-both-required-for-now)
- [ ] Confirm the **Clients Info** row, assigned SMM row, and linked filming plan are ready; the Roam finalizer then creates the one public creative group and writes `roam_channel_id`. → [§6c](#6c-slack-channel--automated-roam-creative-group-both-required-for-now)
- [ ] *(not urgent)* Connect their **TikTok account in Post For Me**, put the account's `spc_…` id in `postforme_account_id`. → [§6d](#6d-post-for-me-account-not-urgent)

- [ ] *(recommended)* Add the client to **Sandcastles** — their **own** IG/TikTok **and** their **competitor** handles to the watchlist. → [§6h](#6h-sandcastles-content-intelligence)

**Code + platforms**
- [ ] **Roster display is automatic; write enrollment is not** (F69): a Clients Info row makes the
  client visible, but the new slug is absent from the three static Track-A routing flags and falls
  to unauthenticated n8n writers. Do not call onboarding complete until the atomic server receipt
  proves all required authenticated routing entries/readbacks. → [§6e](#6e-roster-automatic-write-enrollment-blocked)
- [ ] **Create the `public.clients` row — nothing does this for you** (found 2026-07-29): the
  Clients Info sheet and the Supabase `clients` table are **two separate rosters**, and no sync
  connects them. Every row in `clients` was bulk-seeded on 2026-07-05/06; not one has been added
  since. A client added only to the sheet gets calendar cards, Slack, and Drive — and stays
  invisible to every canonical read, so their Linear issues land as `direct_project_unmapped` and
  a flipped team would refuse their first native create with `409 project_mapping_missing`.
  → [§6f](#6f-create-the-canonical-clients-row)
- [ ] **Confirm the client has a review token** — the value every "Share with client" link is
  built from, and the thing whose absence made that button fail for the first client onboarded
  after the 2026-07-05/06 seed. Provisioned automatically since 2026-08-04; the one command that
  proves it is in → [§6k](#6k-review-token-the-share-with-client-link)
- [ ] **Supabase today:** only the filming-plan link is entered through the app; the calendar &
  samples still auto-create. **Cutover blocker (B2/F44):** before native enrollment, the onboarding
  service must also atomically create/read back the canonical client/team mapping and protected
  review token plus every required Track-A authenticated routing enrollment—never by copying a
  token into a Sheet. (Confirm current behavior in
  [§6f](#6f-supabase-calendar--samples-no-manual-row-but-routing-is-required).)
- [ ] **Linear (SMM):** create a Project for the client on the **Video + Graphics** teams, set the SMM as lead, link the Slack channel. → [§6g](#6g-linear-project-smm)

**Finish**
- [ ] Verify on the live dashboard (calendar loads, samples strip, filming plan opens from the main tab/Templates/Kasper, Slack and Roam targets, metrics next morning). → [§6i](#6i-verify)

> Rough sequence that mirrors how it's actually done: **research/keywords + Sheets rows + Slack channel + Linear project → filming Doc in Client Filming Plans / <client display name> → Filming Plans tab link → Roam finalizer creates/posts the public creative group → client goes live in the dashboard → (samples/calendar fill in as work starts).**

---

## 2. Intake

The client submits the current SyncView **standard** or **AI** onboarding form. An authorized staff
member opens the protected onboarding inbox and verifies the exact submission there; a fail-soft
Slack alert may prompt that check but is not the receipt. Today, the intake-row 2xx/Thank You screen
does not prove credential import or provisioning (F110), so do not advance this checklist until the
required side effects have been read back manually. The target state is one protected, resumable
`captured → processing → complete|failed` job with an independent unacknowledged-capture alarm.

The old Notion form was replaced. Its active-labelled legacy workflow currently reports no
production trigger, describes itself as pending setup, and has no retained execution metadata.
Do not wait for or revive that DM path from this runbook; archive it only through F60's private
backup/restore and identifier-free zero-use proof (F111).

---

## 3. Research: keywords & content_description

This is the part that's easy to forget the *method* for. You're producing three text fields that later drive market research, AI briefs, and the "about this client" copy.

**Method (what you described, codified):**
1. Pull **5–10 of the client's Instagram Reels**. The fast way is the Apify reel scraper that’s already wired in n8n — see the one-shot IG reel-scraper template workflow (`G1RRkIDs6Mh7RGk8`). It POSTs to the Apify actor `apify~instagram-reel-scraper` with `{ "username": ["<their_ig_handle>"], "resultsLimit": 20 }`. Duplicate it, swap the handle, run it. (You can also just transcribe the reels by hand.)
2. **Transcribe / read** the reels and figure out what their content is actually about — themes, tone, audience, signature formats.
3. Write the three fields **in the same format as the existing rows** (open the Maria Garcia or Natalie MacNeil row in **Clients Info** as your template):

   - **`keywords`** — a broad comma‑separated list of every topic they touch (15–20 items).
   - **`specific_keywords`** — the tighter subset (≈8) that best defines them (this seeds market research).
   - **`content_description`** — a structured prose brief with **three labelled blocks**:

     ```
     CREATOR IDENTITY: who they are, where their authority comes from, how they position themselves.
     CONTENT DNA: the throughline of their content — recurring themes, tone, signature format elements.
     AUDIENCE CONTEXT: who follows them (age/psychographics), why it resonates, what the client drives toward.
     ```

   *(Real example — trimmed — from the Maria Garcia row, to match the voice/length:)*
   > **CREATOR IDENTITY:** Miki is a serial entrepreneur, author, and mission‑driven founder (TUSHY, HERO) who sits at the intersection of business, nature, spirituality, and social impact… **CONTENT DNA:** unified by one throughline — nature already solved the problem; the smartest thing humans can do is learn from it… she closes each piece with an affirmation (a signature format element)… **AUDIENCE CONTEXT:** purpose‑driven entrepreneurs and conscious consumers (28–45) who want to build things that matter… she drives toward TUSHY, HERO, and her retreats.

4. **`competitors`** — a comma‑separated list of competitor **Instagram handles** (no `@`), e.g. `iamhoniakader,pagetkagy,davidghiyam,…`. This feeds the COMPETITOR RESEARCH / MARKET RESEARCH automations.

> Once these land in **Clients Info**, the scheduled robots (CLIENTS METRICS, TOP VIDEOS, COMPETITOR RESEARCH, MARKET RESEARCH) pick the client up automatically on their next run — no extra wiring.

---

## 4. "Clients Info" row (the big one)

**Where:** SYNCVIEW sheet (`10QQ…QqAU8`) → tab **`Clients Info`**.
**Key:** `client_name` — must use the canonical display spelling **exactly** (see the slug rule below).

**Columns:** use the exact headers below; the provisioning workflow reads `roam_channel_id` by
header name, **not** by a fixed column position.

| Column | What to put | Notes / can be blank? |
|---|---|---|
| `client_name` | Display name, e.g. `Jane Doe` | **Required.** This is what makes the client appear in the dashboard and derives the slug. |
| `email` | Client email | Low‑stakes. |
| `competitors` | Comma‑sep competitor **IG handles** | Drives competitor/market research. |
| `keywords` | Broad topic list (15–20) | See [§3](#3-research-keywords--content_description). |
| `specific_keywords` | Tight subset (~8) | Seeds market research. |
| `content_description` | 3‑block brief (CREATOR IDENTITY / CONTENT DNA / AUDIENCE CONTEXT) | See [§3](#3-research-keywords--content_description). |
| `instagram_handle` | IG handle, no `@` | e.g. `jane.doe.living`. |
| `tiktok_handle` | TikTok handle | **Blank/`N/A` is fine** — scrapers skip it. |
| `youtube_channel_id` | `UC…` channel ID | **Blank/`N/A` is fine.** |
| `slack_channel_id` | `C…` channel ID for their Slack | Fill after you create the channel ([§6c](#6c-slack-channel--automated-roam-creative-group-both-required-for-now)). **Retain it:** weekly reports, tweak pings, and alert DMs still use Slack. |
| `roam_channel_id` | Bare Roam **Group Settings UUIDv4** | Written by the Roam finalizer after it verifies the new public group. Never use a `G-` identifier, group URL, or API credential. A manual-reconciliation case is the only exception. |
| `postforme_account_id` | Post For Me account id (`spc_…`) | **Usually blank** — only the TikTok‑auto‑upload clients use it ([§6d](#6d-post-for-me-account-not-urgent)). |

**Also read by the app** (add if you have it; it lives in this same tab to the right): `slack_team_id` (Slack workspace id, for deep-links). **Never add `client_review_token` here.** Clients Info is anonymously readable; review tokens stay in service-role-only `client_access` and must be distributed through the authenticated link-builder required by audit F33.

PR #850 merged signed-in Admin/SMM copy actions that call the already-live v2 exact-client issuer at copy time. Distribution still requires the owner-gated link re-share/current-token proof before real-client enrollment; `client-review-link` is not redeployed unless its source changes.

> 💡 The `instagram_handle` is **not** the slug. The slug comes from `client_name` (see below). A
> fictional display name `Example Alpha` might use handle `@example.alpha.media` while its slug is
> `examplealpha`.

---

## 🔑 The slug rule (read this once)

Almost everything keys off a **slug** derived from `client_name` by `wlNormalizeClient()` (`index.html:8014`). The rule:

> **lowercase → strip accents → drop a leading "Dr." → collapse "and"/"&" to `&` → remove all spaces & punctuation.**

| `client_name` | slug |
|---|---|
| Example Alpha | `examplealpha` |
| Example Beta | `examplebeta` *(not `example`)* |
| Dr. Example Gamma | `examplegamma` *(no "dr")* |
| Alpha & Beta / Alpha and Beta | `alpha&beta` |
| QA Fixture | `qafixture` |

There is **one** slug convention everywhere (calendar, samples, caption prompts, Supabase `client` column, localStorage caches). Keep the **display name spelling consistent** across every tab/tool—drift between punctuation, spacing, or `and`/`&` variants is the main source of “why isn't this client showing up” bugs. Examples above are fictional.

### A second brand for an existing client

An existing client who signs a **second brand** is not a new person, and the automation has no
concept of "same human, two brands" — everything keys off the slug. Get this wrong and the two
brands silently share calendar, samples, caption prompts and Supabase rows.

1. **The second brand needs its own display name, and it must be the brand's name, not the
   person's.** The onboarding form only collects a first and last name, so a second submission
   arrives carrying the person's name and is stamped with the **same slug as the first brand** — the
   collision is already present in the record before you touch anything. Agree the exact spelling
   with Sidney **before creating anything**, then use it byte-identically in Clients Info, Social
   Media Managers, the Linear project, the Drive folders and Roam.
2. **Check the slug actually differs.** Run the display name through the rule above and confirm the
   result is not already in use. `Example Brand` and `Example  Brand` collapse to the same slug;
   so do `Alpha and Beta` and `Alpha & Beta`.
3. **The finalizer matches on `client_name`, not email.** Its "exactly one row" checks filter
   Clients Info and the SMM tab by display name, then assert that the row's email equals the queued
   one. So reusing one email across two brands does **not** trip `ambiguous_client_row` — but a
   queued email that differs from the sheet **does** park the job at `client_email_mismatch`. Decide
   with Sidney which email the brand carries and make the Clients Info row match the submission.
4. **A queued job whose `client_name` is the person's name will never match a brand-named row.** It
   parks at `waiting_for_readiness` ("Clients Info row is not ready") forever. Fix it with a
   corrected queue record — **never** by re-running provisioning ([§6c](#6c-slack-channel--automated-roam-creative-group-both-required-for-now)).

---

## 5. "Social Media Managers" row

**Where:** SYNCVIEW sheet → tab **`Social Media Managers`**.
**Key:** `client_name` (matched by slug in the app).

**Columns:** `client_name | social_media_manager | linear_api_key | slack_profile_url`

- `social_media_manager` — first name of the SMM (e.g. `Analia`, `Sebastian`, `Ludmila`, `Molly`, `Laura`, `Raha`, `Sidney`).
- `linear_api_key` — **copy the value from any existing row for that same SMM** (the key is per‑SMM, shared across their clients). 🔒 Don't paste it anywhere public.
- `slack_profile_url` — that SMM's Slack **user ID** (`U…`), also copyable from their other rows.

This is what makes the SMM's name/avatar and Slack DM appear on the Kasper review cards. (The SMM roster is in [§7](#7-reference-appendix).)

---

## 6. The remaining steps

### 6a. Filming plan
**Where:** SyncView dashboard → main **Filming Plans** tab. This writes the master Doc link to Supabase `filming_plans`, which is now the source of truth for filming-plan links.

1. In the shared **Client Filming Plans** Drive folder, create or open **Client Filming Plans / <client display name>**. This is a separate top-level location from the general **Clients / <client>** folder.
2. Create the **master Google Doc** for the client's filming plan inside that Client Filming Plans folder. If the Doc was created anywhere else — including the general client folder — move the same Doc into this folder before linking it.

   **House format, and how to generate it (2026-08-10).** Plans open with the Synchro Social logo,
   the client's display name in bold, `Filming Plan` beneath it, and a `====` rule. Creating the Doc
   from **plain text loses all of that** and someone has to redo the header by hand. Upload
   **`text/html`** instead: Drive converts it to a Google Doc, keeps the bold/size/structure, and
   **fetches `<img src>` from a public URL and embeds it** — the logo at
   `https://synchrosocial.com/images/logo-updated.png` imports cleanly at `width="80"`.
   `_TEMPLATE — Filming Plan` in the Client Filming Plans folder is the reference; generate each
   client's Doc from that HTML with the name swapped rather than copying the template, so nothing
   has to be edited afterwards.

   Two things the API still cannot do: create the per-month Docs **tabs** (step 3 — add those in the
   Docs UI), and edit a Doc after creation. So get the content right at creation time; changing it
   later means a new Doc and re-linking it in the Filming Plans tab.

   Sharing is inherited, not set: the **Client Filming Plans** folder is shared `anyone: writer`, so
   a Doc created inside it is already "Anyone with the link → Editor". Verify rather than assume —
   check the new Doc's permissions show `{"role":"writer","type":"anyone"}` before linking.
3. **Share it "Anyone with the link → Editor" before you link it.** A newly created Doc is private to
   its creator, and SyncView only stores the URL — it does not grant access. Without this, the link
   opens for you and returns a permission wall for the client, the SMM, and every editor, and
   nothing in the app reports that. Verify by opening the link in a signed-out or incognito window;
   a request-access screen means the plan is not shared.
3. Inside it, use **one Docs *tab* per month** (title them like `July 2026`). The app reads those tabs via the n8n webhook **"Filming Plan Tabs"** (`5S4JyVVR2CpHEv9b`) and shows month coverage automatically.
4. In SyncView, sign in with an **Admin** staff identity, open **Filming Plans**, search the client, and add/update the Doc URL. The app reuses that verified role identity; it does not ask for a separate onboarding passphrase. The old onboarding key remains a backend-only transition fallback until the documented retirement gate.
5. Verify the same Doc opens from the main **Filming Plans** tab, the client's **Templates** page, and **Kasper → Filming Plans**. *(If you skip the per-month tabs, you can hand-set `plan_months` like `2026-07,2026-08` as a fallback.)*

Now that Supabase and the Edge Function are live, the old SYNCVIEW Google Sheet tab **`FilmingPlans`** (`client_name | doc_url | notes | plan_months`) is no longer an onboarding step or browser fallback. Do not use or maintain it as an emergency copy; review its sharing and retire/private it through the owner-approved data-retention process.

The operational source-of-truth UI is the main **Filming Plans** tab. Kasper's **Filming Plans** sub-tab reads that same source and combines it with the client's `calendar_posts` runway.

### 6b. Templates / caption prompts (optional)
- **`Templates` tab** — per‑client styling the editors/designers use: `reels_subtitle_font`, `reels_subtitle_main_color`, `reels_subtitle_highlight_color`, `reels_reference_link`, `reels_preferences`, `thumbnails_title_font`, `thumbnails_title_color`, `thumbnails_highlight_color`, `thumbnails_photos_link`, etc. Filled progressively from the dashboard's Templates editor — **not needed on day one**.
- **`CaptionPrompts` tab** — a per‑client caption‑gen prompt (keyed by **slug**). Managed from the UI; optional.

### 6c. Slack channel + automated Roam creative group (both required for now)

**Slack (still used by unmigrated automations)**

1. Create the client's Slack channel (follow the existing naming pattern in Slack).
2. Copy the **channel ID** (`C…`) → paste into `slack_channel_id` in **Clients Info**.
3. Copy the SMM's **user ID** (`U…`) → into the SMM tab's `slack_profile_url` (and `slack_team_id` into Clients Info if you use deep‑links).

This is what the **"Weekly Slack – Top Reel of the Week"** automation (`BTxic5NSaCMtZMh6`) posts to every Monday, and where urgent tweak pings go. A Roam UUID does **not** replace this Slack field or belong in Linear's Slack-channel field.

**Roam creative group (automatic; this is the onboarding destination)**

> **Required roster — enforced in the published finalizer since 2026-08-10.** Every client creative
> group carries **five** members: the owner/Sidney, Kasper, **Rocío**, the assigned SMM, and the
> Organization API Client. Rocío's private identity mapping now exists, and the finalizer treats her
> exactly like the other named identities — a missing, ambiguous or **inactive** mapping for any of
> them blocks the job at `roam_identity_mapping_missing` instead of creating a group without them.
> The post-create roster verification covers her too, so Roam failing to return her sends the job to
> manual reconciliation before anything is posted.
>
> ✅ **Proven against live Roam 2026-08-10.** The first group created under both the new name rule
> and the five-member roster was `(INTERNAL) Luke Cutting - Bible Break`
> (`86005899-4cbb-498a-a915-03dbff751ba0`, public). Its roster verified with the owner/Sidney,
> Kasper, Rocío, the assigned SMM and the Organization API Client; the finalizer wrote the bare UUID
> to `Clients Info.roam_channel_id` and read it back; and the kickoff posted at 13:15:09 with the
> full brief at 13:15:10 — correct order, one public group, no private companion.

The onboarding provisioning workflow preserves one immutable private brief snapshot after the Drive folder exists. The separate **Client — Roam Creative Group Finalizer** checks every 15 minutes for a snapshot whose setup is complete:

1. Exactly one matching **Clients Info** row with the canonical display name and email.
2. Exactly one assigned-SMM row.
3. Exactly one linked filming plan in Supabase.
4. Exact private Roam identity mappings for the owner/Sidney, Kasper, **Rocío**, and the assigned SMM; the Organization API Client address is read from the Roam token at runtime.

For a newly hired SMM, an administrator maintains that person's exact Roam identity once in the private n8n identity map before their first client is queued. Rocío and the two fixed identities are held to the same standard and are already mapped. Never put a Roam address, group ID, or API credential in the public repo or the anonymously readable **Clients Info** tab.

Only then does it create **one public group** — never a second private companion group — using the
name rule **`(INTERNAL) <client display name>`**: the literal string `(INTERNAL)`, one space, then
the **Clients Info `client_name` verbatim** (internal runs of whitespace collapsed to one space).
Example: `(INTERNAL) Kasper Hytonen`. Capitals, spaces, parentheses, accents and punctuation are
preserved — the name is **not** lowercased, slugified or otherwise sanitised, and a leading `Dr.` is
**not** stripped (unlike the viewer slug). This Roam-name rule is separate from the SyncView viewer
slug. *(Changed 2026-08-10; the previous rule was `<first>-<last>-creative`, lowercase and
hyphen-collapsed. Existing groups were deliberately **not** renamed — see the note below.)*

The name is derived from the **matched Clients Info row**, not from the queued snapshot, so it always
follows the canonical display name. That is what keeps a client's second brand distinct from their
first: the provisioning workflow runs at form-submit time, when only the person's name is known, so
it cannot be the authority. Three guards send the job to manual reconciliation rather than guessing:
an empty display name; a derived name over **64 characters** (`(INTERNAL) ` costs 11, leaving 53 for
the display name — it is never silently truncated); and a display name containing control characters.

> ⚠️ The `channel_name` column in the private queue is **advisory only** and still carries the
> retired `<first>-<last>-creative` value, because the workflow that writes it cannot know the
> display name. **Never hand-create a group from that column during manual reconciliation** — build
> the name from the Clients Info display name.

**Existing groups (owner decision, 2026-08-10): new groups only; nothing was renamed.** The rule
change is forward-looking. At the time of the change the finalizer had created **zero** groups under
the old rule, and every creative group in the workspace had been made by hand and already read
`(INTERNAL) <name>` — so there was nothing to migrate. Two things follow. First, if you find a group
whose name does not match its Clients Info display name, that is a **pre-existing hand-naming
choice**, not drift introduced by this change; renaming it is a separate owner call, and delivery
will keep working either way because posting uses the stored UUID. Second, a client whose row
already carries a `roam_channel_id` is refused with `existing_group_requires_reconciliation` — the
finalizer will never rename or re-point an existing group.

The creation request includes the owner/Sidney, Kasper, assigned SMM, and Organization API Client. The worker verifies the resulting roster, records the Alpha `G-…` identifier privately, verifies the stable bare Group Settings UUID, writes that UUID to `Clients Info.roam_channel_id`, and reads the Sheet back before posting. It posts the kickoff first and the complete form answers second through stable `POST /v1/chat.sendMessage`.

The group **name** is load-bearing only at creation time, in exactly two places: refusing to proceed
if a public group already uses that name, and resolving the new group's stable Group Settings UUID by
exact name match. Every later read and write — both Roam posts and `Clients Info.roam_channel_id` —
addresses the group by that stored UUID, so no automation looks a group up by name after creation.

The workflow posts normally to **Roam only**. It uses the explicit `syncview` / **SyncView** sender, Markdown enabled, `**bold**` section headings and labels, and blank lines between visible rows. Do not use Slack quote blocks, backtick-style placeholders, Block Kit, or the Alpha chat API in this production path.

The client onboarding-form link included in the Resources block is useful to Admin staff, but an SMM-role identity cannot open it: the viewer is Admin-only and deliberately credential-stripped. The full posted brief retains **Account access** by owner decision.

If setup is still incomplete, the worker leaves the private job pending and posts nothing. If a group already exists, a name/identity is ambiguous, a stable-ID readback fails, or any Roam write is uncertain, it marks the job **manual reconciliation** and sends the owner one private Slack fallback containing the preserved brief. It never automatically retries an uncertain group create or message send. Do not rerun the non-idempotent provisioning workflow. For historical clients, use a controlled queue record or manual reconciliation rather than rerunning intake.

### 6d. Post For Me account (not urgent)
Only needed if the client uses **TikTok auto‑upload**. In [Post For Me](https://www.postforme.dev) connect the client's TikTok account, copy that account's id (`spc_…`), and put it in `postforme_account_id` (Clients Info). If blank, the TikTok Upload tab shows a ⚠ badge and blocks submit for that client — there's deliberately no fallback, because guessing an account could post one client's video to another's TikTok. (The n8n "SyncView TikTok Upload — Submit" workflow needs an httpBearerAuth credential named **Post For Me** holding the API key.)

### 6f. Create the canonical `clients` row

**Why this step exists.** Found 2026-07-29, from a real gap: a client onboarded 2026-07-27 had a
Linear project on both teams, 13 live calendar cards, and all three `*_ef_clients` routing flags —
but **no row in `public.clients` at all**. Putting them in the Clients Info sheet was done, and was
correct; it drives the legacy calendar/samples/Slack/Drive workflows. It does **not** reach the
Supabase `clients` table. Nothing does. Every one of that table's rows was created on 2026-07-05 or
2026-07-06 by a one-time seed, and none has been added since — so the first new client after that
seed was the first to fall through.

**What breaks while the row is missing**

- Canonical reads have no client to join to — no display name, emoji, or brand kit.
- The client's Linear issues cannot be attributed and surface in the reconciler as
  `client_attribution / direct_project_unmapped`, raising `repair_list_size`.
- The three routing flags name a slug the roster does not contain.
- **After a team flips, their first native create fails** with `409 project_mapping_missing`,
  because `projectIdsForTeam` has no mapping to read.

**Do this, in the Supabase SQL editor.** Replace the slug, display name, and project ids. Get the
project id(s) from Linear: one project serving both teams is the normal case, so the same id goes in
both keys; a client with separate Video and Graphics projects gets the two different ids (confirm
which is which in Linear — do not guess). The block refuses rather than duplicating if a row for
that slug already exists.

```sql
begin;
do $$
declare v_inserted int;
begin
  insert into public.clients (slug, display_name, kind, active, linear_project_ids)
  values (
    '<SLUG>',
    '<DISPLAY NAME>',
    'client',
    true,
    jsonb_build_object('video', '<VIDEO_PROJECT_ID>', 'graphics', '<GRAPHICS_PROJECT_ID>')
  )
  on conflict (slug) do nothing;

  get diagnostics v_inserted = row_count;
  if v_inserted <> 1 then
    raise exception 'expected exactly 1 client row to be created, got % — a row for that slug already exists; inspect it by hand', v_inserted;
  end if;
  raise notice 'client row created';
end $$;
commit;

select slug, display_name, kind, active, board_status, linear_project_ids
from public.clients where slug = '<SLUG>';
```

Leave `slack_channel_id`, `emoji`, and `lead_member_id` unset here and fill them the normal way — a
wrong value is worse than an empty one. Do not commit a filled-in copy of this block to this
repository (F64); this repo is public.

**Read back.** The final `select` must show the row with a non-empty id for **both** teams. Within a
reconcile cycle or two, `repair_list_size` should fall by that client's issue count.

**Until a sheet → `clients` sync exists, this step is mandatory for every new client.** Treat a
missing row as an onboarding defect, not a cosmetic gap.

Once `migrations/2026-08-04-client-access-auto-provision.sql` is applied, this insert also mints the
client's review token in the same transaction — see [§6k](#6k-review-token-the-share-with-client-link).
Before it is applied, provision that token yourself.

### 6e. Roster automatic; write enrollment is a REAL per-client step

> **Do not skip this, and do not assume it is already handled.** Measured 2026-07-27 against the
> live flags: all three `*_ef_clients` lists carry 33 slugs, and **every one of the 32 active
> `kind=client` rows is enrolled in all three**. The lists have been kept current, so a missing slug
> is not a historical backlog — it means *that* client was never enrolled. At the time of
> measurement the only gap was the most recently onboarded client, absent from all three under
> every spelling. Enrollment is the last step of onboarding, not a flip-era cleanup.
>
> Enroll in **all three flags atomically, then read back**. Two of three is worse than none: writes
> then split between the authenticated Edge Function and the anonymous n8n fallback depending on
> which surface the client touches. The flags live in `syncview_runtime_flags` and require the
> service role, so this is an owner-gated change — never an ad-hoc edit.


The dashboard derives its visible client roster from the **Clients Info** sheet at load time
(`wlMergeClientsFromSheet` in `index.html`), so a new row appears without a frontend deploy. That is
**display visibility only**, not write readiness. The three `*_ef_clients` runtime flags are static
lists; a new slug is absent until explicitly enrolled and read back. Current fallback then routes
Calendar/SXR/settings writes to unauthenticated n8n service-role webhooks (F67/F69). Do not ask the
client/team to write until one atomic onboarding receipt proves the client row, project mapping,
protected review token, all required authenticated Track-A routing entries, and first-write path.
Longer term, replace manual static allowlists with an authenticated active-client policy.

> ⚠️ The **root `README.md`** is still stale (it describes an old Instaloader/`scraper.py` pipeline that no longer exists) — ignore its "Add More Clients" section.

### 6f. Supabase calendar & samples: no manual row, but routing is required
You do not manually seed a content-calendar or SXR row. Under the current architecture:

- The content calendar uses **`calendar_posts`** and Samples/SXR uses **`sample_reviews`**. The
  retained Samples Old compatibility store is separate (F57).
- **Reads** of a brand‑new slug just return an empty `200` (empty calendar / empty strip — handled cleanly).
- **The first write creates the row**, but it must use the authenticated Track-A Edge Function after
  exact routing enrollment. An omitted slug currently falls to the unauthenticated n8n writer; that
  is a security/readiness failure, not an acceptable automatic setup (F69).

So: after the server-generated onboarding receipt and a TEST-safe authenticated first-write probe,
the client's Calendar/SXR rows can populate on demand. A visible empty surface alone is not proof.

Exception: filming-plan master Doc links are intentionally managed in Supabase through the app's **Filming Plans** tab. You still should not edit Supabase directly; use the dashboard so the signed-in Admin gate, attribution, and app refresh behavior stay consistent.

*Legacy note:* the old `Calendar_<slug>` / `Samples_<slug>` Google‑Sheet tabs (created by the **"Provision Missing Tabs"** workflows `gB17L9M5yYxxk6GT` / `7Pdp6qnkBzwXP3YG`) are now just a **best‑effort mirror**, not load‑bearing. If you want the mirror + Drive backups to stay complete you *can* add the new slug to those workflows' hardcoded `SLUGS` arrays and run them — but the live app no longer depends on it.

### 6g. Linear project (SMM)
Usually done by the **Social Media Manager**. In the **`synchro-social`** workspace:

1. Create a **Project** named exactly like the client (you can duplicate the **"Client Example"** template project).
2. Attach it to the **Video (`VID`)** and **Graphics (`GRA`)** teams (most client projects use both).
3. Set the **SMM as the project lead**.
4. **Link the client's Slack channel** to the project.
5. Drop brand info into the project description (fonts, accent colors, approved video/thumbnail samples, Drive/Frame.io links) — that's where editors look.

**Do not call this complete from the project name alone.** The cutover preflight must resolve
exactly one eligible project for each required team, the intended SMM credential, filming plan,
and creative roster, then read back the native mapping. The current Create Post project endpoint
silently returns only its first 50 of 58 eligible projects (F45), so dropdown presence/absence is
not a completeness check until that reader is paginated and reconciled.

### 6h. Sandcastles (content intelligence)
**Where:** Sandcastles → the **watchlist** (add via the web app, or the MCP tool `add_channels_to_watchlist`). One workspace, **"My Workspace"**, holds the whole watchlist.

Add **both** to the watchlist (`add_channels_to_watchlist`, or the web app):

1. The client's **own** Instagram/TikTok — to track their own performance.
2. The client's **competitor** handles (the `competitors` column in Clients Info) — to mine the niche for hooks/formats. If competitors aren't filled in yet, do that first ([§3](#3-research-keywords--content_description)); that same list feeds the competitor/market-research robots.

New-to-Sandcastles channels are submitted automatically and finish scraping within a few minutes. After that you can pull `channel_recap`, `top_hooks` / `top_topics` / `top_formats`, and outlier alerts on any of them. (A deep `analyze_video` on a single post costs 1 analysis credit; tracking and recaps are free.)

> **Audit (2026-06-20):** the watchlist was a small (~9 channels), relationship/marriage-coaching–heavy set that wasn't organized by client — almost none of the clients' own channels or competitors were in it. Treat this step as net-new for nearly every client.

### 6i. Verify
- Open the dashboard, switch to the new client: calendar and samples load (empty is fine).
- Open the client's filming plan from the main **Filming Plans** tab, the client's **Templates** page, and **Kasper → Filming Plans**. All three should open the same master Doc from Supabase.
- Confirm the weekly Slack target resolves (`slack_channel_id` set).
- Confirm the exact **public** Roam creative group exists with all five required members — owner/Sidney, Kasper, Rocío, the assigned SMM, and the Organization API Client; that its exact bare UUID is in `roam_channel_id`; and that the kickoff visibly precedes the full onboarding brief.
- Before any real-client #850 cohort enrollment, require a server-side onboarding receipt proving the exact team
  mapping, protected review token, and all required authenticated Track-A routing entries exist and
  read back. Prove the first Calendar/SXR/settings write reaches the authenticated EF and cannot
  fall through to anonymous n8n (F67/F69). On TEST, submit one batch and verify the receipt,
  parent/children, Calendar/Samples projection, and tokened client link after reload. A green
  “Issue created” banner is not proof: F44 verified that the legacy workflow can return 200 and
  clear the draft before parent creation later fails.
- Next morning, confirm the new client appears in the **CLIENTS METRICS typed terminal coverage
  receipt**, not merely a new row or placeholder (F124), and check roster coverage, write failures,
  run duration, and Sheets quota. The current Metrics contract is live-proved at version
  `b92fb693-1dd4-4ce2-a60e-98a1701c369d` by scheduled execution `287059` (29/29 unique receipts,
  29 writes, zero write failures, provider-failure last-good preservation, and fresh legitimate
  zeros). TOP VIDEOS remains degraded: require a distinct per-client/platform completeness receipt,
  distinguish valid empty from provider failure, and preserve last-good data with visible staleness.

### 6j. Monthly check-in email
**Where:** SYNCVIEW sheet → tab **`Monthly Checkup`** — columns `client_name | email`.

The n8n workflow **"Clients — Monthly Check-in"** (`alZ87zcRVKgcGVY7`) runs on the **1st of every month at 8 AM** and emails **every opted-in row of this tab** a friendly check-in from the privately configured workspace sender with the iClosed booking link. Adding the row is the only wiring — the workflow reads the tab live on each run, no n8n change needed. Do not publish workspace account addresses (F64).

This is never an automatic onboarding step. Add a row only after explicit approval from Sidney or Kasper; absence from this tab means no monthly check-in email.

### 6k. Review token (the "Share with client" link)

**What it is.** One opaque per-client secret in service-role-only
`public.client_access.review_token`. Every client-facing link is
`?c=<display name>&t=<token>`; `client-token-verify` checks the presented `t` against that stored
value before a client sees anything. It is **never** in the Clients Info sheet, `clientMap`, or any
committed file (F33/F64).

**Why this section exists.** Found 2026-08-04, from the same root cause as
[§6f](#6f-create-the-canonical-clients-row): `client_access` rows had only ever been created by the
one-time 2026-07-05/06 B0 seed. Nothing created one afterwards. So the first client onboarded after
that seed — roster row created 2026-07-29 — had a `clients` row, a Linear project, live calendar
cards, and **no token**, and every "Share with client" button (Analytics, Calendar, Samples, Sample
Reviews) died on a bare `review_token_missing` toast with nothing the SMM could do about it.

**What is automatic now.** Three layers, so no single missed step reproduces it:

| Layer | Covers |
|---|---|
| `migrations/2026-08-04-client-access-auto-provision.sql` | An `after insert` trigger on `public.clients` mints the token in the same transaction as the roster row — including the by-hand [§6f](#6f-create-the-canonical-clients-row) insert. It also backfills every active client that was already missing one. |
| `client-review-link` | If a token is still missing when a signed-in staff member clicks share, the issuer mints it on the spot and returns the link. Deliberate-manual deploy: the live version predates this and still fails closed. |
| `scripts/provision-client-access.js` | Operator backfill/verify — closes a gap in one command without deploying anything. |

None of them can rotate a stored token. Every write is `ON CONFLICT DO NOTHING` or an insert; the
one update in the Edge Function is guarded on the token being blank. **This is not negotiable** —
rotating a token silently `401`s every link the client already holds, which is the 2026-07-15
double-outage class (AGENTS.md frozen-writer callout, `ROLLBACK.md` F35 row). There is deliberately
no `--rotate` anywhere. A genuine rotation is an owner-gated exercise that re-issues and confirms
every affected client on a fresh link first.

**The check.** Requires the service role (`client_access` is not anon-readable), prints slugs and
never token values, and exits non-zero if any active client is missing one:

```bash
SUPABASE_SERVICE_ROLE_KEY=... node scripts/provision-client-access.js --check
```

Swap `--check` for `--apply` to mint whatever it reports. Then confirm end to end the way an SMM
would: open the client in SyncView, kebab → **Share with client**, and load the copied URL in a
signed-out window.

**If the button still errors**, read the toast — it now names the next step rather than a machine
code. `…has no active roster row yet` means [§6f](#6f-create-the-canonical-clients-row) was skipped
(or the client is archived); `…run scripts/provision-client-access.js --apply` means the roster row
exists but the token does not.

1. When approved, add a row: `client_name` (same spelling as Clients Info) + the client's `email` (watch for typos and trailing spaces — this goes straight into the To: field).
2. Do not add a client by default. If the client should not receive the check-in, leave them off this tab.

> ⚠️ **Format matters:** the workflow only reads the `client_name` and `email` **columns**, one client per **row**. Don't add clients as extra columns — as of 2026‑07 the tab had client data sitting in the header row, which the automation can't see, so those clients silently received no check-ins.

---

## What's automatic—and what is not

- **Roster visibility only** — the Clients Info row appears without a frontend deploy, but the
  client is **not write-ready** until F69's atomic authenticated routing receipt/readback succeeds.
  ([§6e](#6e-roster-automatic-write-enrollment-blocked))
- **Supabase row seeding** — Calendar/SXR rows can be created on first authenticated EF write; no
  manual row is needed. Routing/auth enrollment is still mandatory.
  ([§6f](#6f-supabase-calendar--samples-no-manual-row-but-routing-is-required))
- **Metrics, Top Videos, Competitor Research, Market Research** — scheduled n8n workflows read
  **Clients Info**. CLIENTS METRICS has a live-proved typed terminal receipt contract; onboarding is
  not complete until the new client appears in that receipt and its coverage/quota checks pass.
  TOP VIDEOS remains incomplete until its own per-client/platform receipt and degraded-state
  handling distinguish valid empty from provider failure.
- **The review token** — automatic since 2026-08-04 at three layers (roster-insert trigger,
  on-demand minting in `client-review-link`, and the operator backfill). It was automatic at
  **none** before that, which is why the first post-seed client could not be shared with at all.
  Verify it rather than assume it: [§6k](#6k-review-token-the-share-with-client-link).
- **Per‑client caches / realtime channels / share‑link state** in the frontend — created at runtime from the slug.
- **No** per‑client brand‑color config in `index.html` (brand colors only exist in the separate `thumbnails/` app, which is unrelated to dashboard onboarding).

## Gotchas & drift to watch

1. **Name spelling must be identical** across Clients Info, Social Media Managers, the Filming Plans tab, and the Linear project. The slug is unforgiving (see the slug rule). The hardcoded `WL_CLIENT_NAMES` list is only an offline fallback seed now.
2. **Clients Info controls roster visibility, not every write allowlist.** The three Track-A routing
   flags are separate static slug lists and must be atomically enrolled/read back until replaced
   (F69). Legacy Provision Missing Tabs arrays affect only the optional Sheet mirror.
3. **Filming plan links are not just a URL.** The linked master Doc must live in **Client Filming Plans / <client display name>**, never in the general **Clients / <client>** folder. If a correct-looking Doc lives elsewhere, move the same Doc into the Client Filming Plans folder before treating the link as healthy.
4. **Stale doc:** root `README.md` describes an old Instaloader pipeline that no longer exists — don't follow it. (The old `index.html` "provision the tab" comment was corrected in this PR.)
5. **Duplicate Linear projects** are common (several clients already have 2–3). Search before creating; reuse the canonical one.
6. **Secrets stay out of git and public Sheets:** Linear API keys, `client_review_token`s, and the Supabase service role belong only in their protected server-side stores. In particular, review tokens live in service-role-only `client_access`, never Clients Info, `clientMap`, or n8n payload logs.

---

## 7. Reference appendix

**Locations (identifiers stay in private operator config)**
- Primary workspace Sheet: tabs `Clients Info`, `Social Media Managers`, `Templates`,
  `CaptionPrompts`, `Video Editors`, `Monthly Checkup`, and analytics data tabs. The old
  `FilmingPlans` tab is historical only (not a fallback); Supabase is current truth.
- Legacy Calendar Sheet: `Calendar_<slug>`, `Samples_<slug>`, `TikTokUploads`; optional mirror only.
- Supabase: `filming_plans`, `calendar_posts`, `sample_reviews`, plus protected onboarding/client
  tables. Obtain the project reference privately.
- Frontend: locate `WL_CLIENT_NAMES` and `wlNormalizeClient` by symbol, never a dated line number.
- Linear: obtain workspace/team/template identifiers from private operator config; do not publish
  project/client names.

**Key n8n workflows**
| Workflow | ID | Role |
|---|---|---|
| SyncView standard/AI submit + onboarding inbox | resolve current objects from private operator config | Current intake capture; F110 durable completion receipt still required |
| New Client → Slack DM (Notion Onboarding) | resolve only for F60 retirement evidence | Replaced legacy object; not an intake alert (F111) |
| ONE‑SHOT — Scrape IG Reels | `G1RRkIDs6Mh7RGk8` | Onboarding reel scrape (keywords) |
| CLIENTS METRICS | `Q4n1bagJYBkurEaI` | Daily metrics (reads Clients Info) |
| TOP VIDEOS | `DyVPx0neUZ94R0hJ` | Daily top videos (reads handles) |
| COMPETITOR RESEARCH / MARKET RESEARCH | `0KMfHmYqVdlr5EhG` / `FD2QUIOlobkdLOgs` | Reads competitors/keywords |
| Weekly Slack – Top Reel | `BTxic5NSaCMtZMh6` | Posts to `slack_channel_id` |
| Clients — Monthly Check-in | `alZ87zcRVKgcGVY7` | 1st of month 8 AM — emails every opted-in row of the **Monthly Checkup** tab |
| Filming Plan Tabs | `5S4JyVVR2CpHEv9b` | Reads filming‑Doc month tabs |
| Calendar / Samples Provision Missing Tabs | `gB17L9M5yYxxk6GT` / `7Pdp6qnkBzwXP3YG` | Legacy Sheet‑tab mirror |

**SMM roster:** use the current owner-approved private employment/role roster and existing protected
Sheet rows. Do not publish names, emails, Linear keys, or Slack IDs; F31 requires offboarding and
individual revocation proof before treating a listed actor as current.

---

*Maintainer note:* if the architecture shifts again (for example, the Sheet mirror retires or RLS
becomes per-client), update [§6f](#6f-supabase-calendar--samples-no-manual-row-but-routing-is-required)
and the stale-docs warning.
