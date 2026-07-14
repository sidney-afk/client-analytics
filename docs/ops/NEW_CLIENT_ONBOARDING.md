# New Client Onboarding Runbook (SyncView)

**Purpose:** the complete, do-not-forget checklist for bringing a brand-new client online across every SyncView system — the dashboard code, the Google Sheets, n8n, Supabase, Linear, Slack, and Post For Me.

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
| **Google Drive** | The actual master filming Docs, inside the shared **Client Filming Plans** folder with one folder per client. | ✅ Create/move Doc |
| **n8n** | All the scrapers/automations (metrics, top videos, competitor & market research, weekly Slack, caption gen, calendar/samples sync). | ⚪ Mostly auto |
| **Linear** (`synchro-social`) | One **Project** per client across the **Video + Graphics** teams. | ✅ SMM does it |
| **Slack** | One channel per client (weekly reports + tweak pings post there). | ✅ Create channel |
| **Sandcastles** | Content-intelligence watchlist — channel recaps, top hooks/topics/formats, outlier alerts. | ✅ Add the client **+ their competitors** |
| **Post For Me** (`postforme.dev`) | A connected **TikTok account** per client (TikTok auto‑upload). | ⚪ Not urgent |
| **Notion** | The intake **"Onboarding Form"** that kicks everything off. | ▶️ Entry point |

---

## 1. Quick checklist (the whole thing)

**Research / prep**
- [ ] Intake form received (Notion → you get a Slack DM). → [§2](#2-intake)
- [ ] Scrape 5–10 of their Instagram **reels** and write the **keywords** + **content_description**. → [§3](#3-research-keywords--content_description)

**SYNCVIEW Google Sheet** (`10QQ…QqAU8`)
- [ ] **Clients Info** → add a row (name, handles, competitors, keywords, content_description, slack channel id, …). → [§4](#4-clients-info-row-the-big-one)
- [ ] **Social Media Managers** → add a row (who's their SMM). → [§5](#5-social-media-managers-row)
- [ ] **Monthly Checkup** → add a row (client_name + email) so the client gets the automated monthly check-in email. → [§6j](#6j-monthly-check-in-email)
- [ ] *(optional, later)* **Templates** → reels/thumbnail font & color prefs. → [§6b](#6b-templates--caption-prompts-optional)

**Filming plans source of truth**
- [ ] Create/move the client's master filming Google Doc inside their folder in the shared **Client Filming Plans** Drive.
- [ ] In SyncView, sign in with an **Admin** staff identity, then open the main **Filming Plans** tab and add/update the client Doc link. → [§6a](#6a-filming-plan)

**Slack / Post For Me**
- [ ] Create the client's **Slack channel**, grab its **channel ID** (→ Clients Info) and **member/SMM user ID** (→ SMM tab). → [§6c](#6c-slack-channel)
- [ ] *(not urgent)* Connect their **TikTok account in Post For Me**, put the account's `spc_…` id in `postforme_account_id`. → [§6d](#6d-post-for-me-account-not-urgent)

- [ ] *(recommended)* Add the client to **Sandcastles** — their **own** IG/TikTok **and** their **competitor** handles to the watchlist. → [§6h](#6h-sandcastles-content-intelligence)

**Code + platforms**
- [ ] **Roster display is automatic; write enrollment is not** (F69): a Clients Info row makes the
  client visible, but the new slug is absent from the three static Track-A routing flags and falls
  to unauthenticated n8n writers. Do not call onboarding complete until the atomic server receipt
  proves all required authenticated routing entries/readbacks. → [§6e](#6e-roster-automatic-write-enrollment-blocked)
- [ ] **Supabase today:** only the filming-plan link is entered through the app; the calendar &
  samples still auto-create. **Cutover blocker (B2/F44):** before native enrollment, the onboarding
  service must also atomically create/read back the canonical client/team mapping and protected
  review token plus every required Track-A authenticated routing enrollment—never by copying a
  token into a Sheet. (Confirm current behavior in
  [§6f](#6f-supabase-calendar--samples-no-manual-row-but-routing-is-required).)
- [ ] **Linear (SMM):** create a Project for the client on the **Video + Graphics** teams, set the SMM as lead, link the Slack channel. → [§6g](#6g-linear-project-smm)

**Finish**
- [ ] Verify on the live dashboard (calendar loads, samples strip, filming plan opens from the main tab/Templates/Kasper, weekly Slack target, metrics next morning). → [§6i](#6i-verify)

> Rough sequence that mirrors how it's actually done: **Slack channel + Linear project → research/keywords → Sheets rows → client goes live in the dashboard → filming Doc in the Drive folder → Filming Plans tab link → (samples/calendar fill in as work starts).**

---

## 2. Intake

A client submits the **Notion "Onboarding Form"** database. The n8n workflow **"New Client → Slack DM (Notion Onboarding)"** (`y1bEpXLggfR5HqYV`) watches it and DMs you on Slack the moment a row lands. That DM is your trigger to start this checklist. (Discovery‑call notes also live in Fathom if you record them.)

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

**Columns (verified header), in order:**

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
| `slack_channel_id` | `C…` channel ID for their Slack | Fill after you create the channel ([§6c](#6c-slack-channel)). Weekly report posts here. |
| `postforme_account_id` | Post For Me account id (`spc_…`) | **Usually blank** — only the TikTok‑auto‑upload clients use it ([§6d](#6d-post-for-me-account-not-urgent)). |

**Also read by the app** (add if you have it; it lives in this same tab to the right): `slack_team_id` (Slack workspace id, for deep-links). **Never add `client_review_token` here.** Clients Info is anonymously readable; review tokens stay in service-role-only `client_access` and must be distributed through the authenticated link-builder required by audit F33.

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

1. In the shared **Client Filming Plans** Drive folder, create or open the client's folder.
2. Create the **master Google Doc** for the client's filming plan inside that client folder. If the Doc was created somewhere else, move it into the folder before linking it.
3. Inside it, use **one Docs *tab* per month** (title them like `July 2026`). The app reads those tabs via the n8n webhook **"Filming Plan Tabs"** (`5S4JyVVR2CpHEv9b`) and shows month coverage automatically.
4. In SyncView, sign in with an **Admin** staff identity, open **Filming Plans**, search the client, and add/update the Doc URL. The app reuses that verified role identity; it does not ask for a separate onboarding passphrase. The old onboarding key remains a backend-only transition fallback until the documented retirement gate.
5. Verify the same Doc opens from the main **Filming Plans** tab, the client's **Templates** page, and **Kasper → Filming Plans**. *(If you skip the per-month tabs, you can hand-set `plan_months` like `2026-07,2026-08` as a fallback.)*

Now that Supabase and the Edge Function are live, the old SYNCVIEW Google Sheet tab **`FilmingPlans`** (`client_name | doc_url | notes | plan_months`) is no longer an onboarding step. Treat it as a historical/emergency fallback only; do not use it as the source of truth or keep it manually in sync unless we deliberately roll back Supabase.

The operational source-of-truth UI is the main **Filming Plans** tab. Kasper's **Filming Plans** sub-tab reads that same source and combines it with the client's `calendar_posts` runway.

### 6b. Templates / caption prompts (optional)
- **`Templates` tab** — per‑client styling the editors/designers use: `reels_subtitle_font`, `reels_subtitle_main_color`, `reels_subtitle_highlight_color`, `reels_reference_link`, `reels_preferences`, `thumbnails_title_font`, `thumbnails_title_color`, `thumbnails_highlight_color`, `thumbnails_photos_link`, etc. Filled progressively from the dashboard's Templates editor — **not needed on day one**.
- **`CaptionPrompts` tab** — a per‑client caption‑gen prompt (keyed by **slug**). Managed from the UI; optional.

### 6c. Slack channel
1. Create the client's Slack channel (follow the existing naming pattern in Slack).
2. Copy the **channel ID** (`C…`) → paste into `slack_channel_id` in **Clients Info**.
3. Copy the SMM's **user ID** (`U…`) → into the SMM tab's `slack_profile_url` (and `slack_team_id` into Clients Info if you use deep‑links).

This is what the **"Weekly Slack – Top Reel of the Week"** automation (`BTxic5NSaCMtZMh6`) posts to every Monday, and where urgent tweak pings go.

### 6d. Post For Me account (not urgent)
Only needed if the client uses **TikTok auto‑upload**. In [Post For Me](https://www.postforme.dev) connect the client's TikTok account, copy that account's id (`spc_…`), and put it in `postforme_account_id` (Clients Info). If blank, the TikTok Upload tab shows a ⚠ badge and blocks submit for that client — there's deliberately no fallback, because guessing an account could post one client's video to another's TikTok. (The n8n "SyncView TikTok Upload — Submit" workflow needs an httpBearerAuth credential named **Post For Me** holding the API key.)

### 6e. Roster automatic; write enrollment blocked
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
- Before any #813 enrollment, require a server-side onboarding receipt proving the exact team
  mapping, protected review token, and all required authenticated Track-A routing entries exist and
  read back. Prove the first Calendar/SXR/settings write reaches the authenticated EF and cannot
  fall through to anonymous n8n (F67/F69). On TEST, submit one batch and verify the receipt,
  parent/children, Calendar/Samples projection, and tokened client link after reload. A green
  “Issue created” banner is not proof: F44 verified that the legacy workflow can return 200 and
  clear the draft before parent creation later fails.
- Next morning, check that **CLIENTS METRICS** / **TOP VIDEOS** produced rows (confirms handles are right). A client with no metrics row still appears via a placeholder, so absence of data ≠ broken.

### 6j. Monthly check-in email
**Where:** SYNCVIEW sheet → tab **`Monthly Checkup`** — columns `client_name | email`.

The n8n workflow **"Clients — Monthly Check-in"** (`alZ87zcRVKgcGVY7`) runs on the **1st of every month at 8 AM** and emails **every row of this tab** a friendly check-in from the privately configured workspace sender with the iClosed booking link. Adding the row is the only wiring — the workflow reads the tab live on each run, no n8n change needed. Do not publish workspace account addresses (F64).

1. Add a row: `client_name` (same spelling as Clients Info) + the client's `email` (watch for typos and trailing spaces — this goes straight into the To: field).
2. **Default: every active client gets added.** If a client shouldn't receive these (special arrangement etc.), flag it with Kasper — but don't block onboarding on the question; removing a row later takes five seconds.

> ⚠️ **Format matters:** the workflow only reads the `client_name` and `email` **columns**, one client per **row**. Don't add clients as extra columns — as of 2026‑07 the tab had client data sitting in the header row, which the automation can't see, so those clients silently received no check-ins.

---

## What's automatic—and what is not

- **Roster visibility only** — the Clients Info row appears without a frontend deploy, but the
  client is **not write-ready** until F69's atomic authenticated routing receipt/readback succeeds.
  ([§6e](#6e-roster-automatic-write-enrollment-blocked))
- **Supabase row seeding** — Calendar/SXR rows can be created on first authenticated EF write; no
  manual row is needed. Routing/auth enrollment is still mandatory.
  ([§6f](#6f-supabase-calendar--samples-no-manual-row-but-routing-is-required))
- **Metrics, Top Videos, Competitor Research, Market Research** — scheduled n8n workflows that read **Clients Info**; they pick up the new client on their next run.
- **Per‑client caches / realtime channels / share‑link state** in the frontend — created at runtime from the slug.
- **No** per‑client brand‑color config in `index.html` (brand colors only exist in the separate `thumbnails/` app, which is unrelated to dashboard onboarding).

## Gotchas & drift to watch

1. **Name spelling must be identical** across Clients Info, Social Media Managers, the Filming Plans tab, and the Linear project. The slug is unforgiving (see the slug rule). The hardcoded `WL_CLIENT_NAMES` list is only an offline fallback seed now.
2. **Clients Info controls roster visibility, not every write allowlist.** The three Track-A routing
   flags are separate static slug lists and must be atomically enrolled/read back until replaced
   (F69). Legacy Provision Missing Tabs arrays affect only the optional Sheet mirror.
3. **Filming plan links are not just a URL.** The linked master Doc should live inside that client's folder in the shared **Client Filming Plans** Drive. If a correct-looking Doc lives elsewhere, move it into the client folder before treating the link as healthy.
4. **Stale doc:** root `README.md` describes an old Instaloader pipeline that no longer exists — don't follow it. (The old `index.html` "provision the tab" comment was corrected in this PR.)
5. **Duplicate Linear projects** are common (several clients already have 2–3). Search before creating; reuse the canonical one.
6. **Secrets stay out of git and public Sheets:** Linear API keys, `client_review_token`s, and the Supabase service role belong only in their protected server-side stores. In particular, review tokens live in service-role-only `client_access`, never Clients Info, `clientMap`, or n8n payload logs.

---

## 7. Reference appendix

**Locations (identifiers stay in private operator config)**
- Primary workspace Sheet: tabs `Clients Info`, `Social Media Managers`, `Templates`,
  `CaptionPrompts`, `Video Editors`, `Monthly Checkup`, and analytics data tabs. The old
  `FilmingPlans` tab is historical fallback; Supabase is current truth.
- Legacy Calendar Sheet: `Calendar_<slug>`, `Samples_<slug>`, `TikTokUploads`; optional mirror only.
- Supabase: `filming_plans`, `calendar_posts`, `sample_reviews`, plus protected onboarding/client
  tables. Obtain the project reference privately.
- Frontend: locate `WL_CLIENT_NAMES` and `wlNormalizeClient` by symbol, never a dated line number.
- Linear: obtain workspace/team/template identifiers from private operator config; do not publish
  project/client names.

**Key n8n workflows**
| Workflow | ID | Role |
|---|---|---|
| New Client → Slack DM (Notion Onboarding) | `y1bEpXLggfR5HqYV` | Intake alert |
| ONE‑SHOT — Scrape IG Reels | `G1RRkIDs6Mh7RGk8` | Onboarding reel scrape (keywords) |
| CLIENTS METRICS | `Q4n1bagJYBkurEaI` | Daily metrics (reads Clients Info) |
| TOP VIDEOS | `DyVPx0neUZ94R0hJ` | Daily top videos (reads handles) |
| COMPETITOR RESEARCH / MARKET RESEARCH | `0KMfHmYqVdlr5EhG` / `FD2QUIOlobkdLOgs` | Reads competitors/keywords |
| Weekly Slack – Top Reel | `BTxic5NSaCMtZMh6` | Posts to `slack_channel_id` |
| Clients — Monthly Check-in | `alZ87zcRVKgcGVY7` | 1st of month 8 AM — emails every row of the **Monthly Checkup** tab |
| Filming Plan Tabs | `5S4JyVVR2CpHEv9b` | Reads filming‑Doc month tabs |
| Calendar / Samples Provision Missing Tabs | `gB17L9M5yYxxk6GT` / `7Pdp6qnkBzwXP3YG` | Legacy Sheet‑tab mirror |

**SMM roster:** use the current owner-approved private employment/role roster and existing protected
Sheet rows. Do not publish names, emails, Linear keys, or Slack IDs; F31 requires offboarding and
individual revocation proof before treating a listed actor as current.

---

*Maintainer note:* if the architecture shifts again (for example, the Sheet mirror retires or RLS
becomes per-client), update [§6f](#6f-supabase-calendar--samples-no-manual-row-but-routing-is-required)
and the stale-docs warning.
