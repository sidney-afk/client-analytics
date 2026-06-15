# New Client Onboarding Runbook (SyncView)

**Purpose:** the complete, do-not-forget checklist for bringing a brand-new client online across every SyncView system — the dashboard code, the Google Sheets, n8n, Supabase, Linear, Slack, and upload‑post.

**How to use it:** skim **§1 (Quick Checklist)** and tick the boxes. Each box links down to a detailed step. **§7** is a reference appendix (IDs, where the secrets live, the SMM roster).

> ⚠️ **This repo is public** (it ships to `syncview.synchrosocial.com` via GitHub Pages). Never paste API keys, review tokens, or other secrets into this file or any committed file. When a step needs a secret, it tells you which Sheet/tool to copy it from.

---

## 0. The systems involved (mental map)

| System | What it holds per client | Onboarding touch? |
|---|---|---|
| **Frontend** `index.html` | The **allowlist of client *names*** (`WL_CLIENT_NAMES`). Everything else is fetched at runtime. | ✅ **1 line** |
| **"SYNCVIEW" Google Sheet** (`10QQ…QqAU8`) | The real per‑client config: **Clients Info**, **Social Media Managers**, **FilmingPlans**, Templates, CaptionPrompts (+ data tabs the robots fill). | ✅ **3–4 rows** |
| **"SyncView Calendar" Google Sheet** (`1Gsn…A9Yps`) | `Calendar_<slug>` / `Samples_<slug>` / `TikTokUploads` tabs. **Now a legacy mirror** of Supabase. | ⚪ Optional |
| **Supabase** (`uzltbbrjidmjwwfakwve`) | `calendar_posts` + `content_samples` (the content calendar & the sample strip). | ❌ **Nothing — auto** |
| **n8n** | All the scrapers/automations (metrics, top videos, competitor & market research, weekly Slack, caption gen, calendar/samples sync). | ⚪ Mostly auto |
| **Linear** (`synchro-social`) | One **Project** per client across the **Video + Graphics** teams. | ✅ SMM does it |
| **Slack** | One channel per client (weekly reports + tweak pings post there). | ✅ Create channel |
| **upload‑post.com** | A posting **profile** per client (TikTok auto‑upload). | ⚪ Not urgent |
| **Notion** | The intake **"Onboarding Form"** that kicks everything off. | ▶️ Entry point |

---

## 1. Quick checklist (the whole thing)

**Research / prep**
- [ ] Intake form received (Notion → you get a Slack DM). → [§2](#2-intake)
- [ ] Scrape 5–10 of their Instagram **reels** and write the **keywords** + **content_description**. → [§3](#3-research-keywords--content-description)

**SYNCVIEW Google Sheet** (`10QQ…QqAU8`)
- [ ] **Clients Info** → add a row (name, handles, competitors, keywords, content_description, slack channel id, …). → [§4](#4-clients-info-row-the-big-one)
- [ ] **Social Media Managers** → add a row (who's their SMM). → [§5](#5-social-media-managers-row)
- [ ] **FilmingPlans** → create a master filming Google Doc, paste its URL. → [§6a](#6a-filming-plan)
- [ ] *(optional, later)* **Templates** → reels/thumbnail font & color prefs. → [§6b](#6b-templates--caption-prompts-optional)

**Slack / upload‑post**
- [ ] Create the client's **Slack channel**, grab its **channel ID** (→ Clients Info) and **member/SMM user ID** (→ SMM tab). → [§6c](#6c-slack-channel)
- [ ] *(not urgent)* Create their **upload‑post profile**, put the name in `upload_post_profile`. → [§6d](#6d-upload-post-profile-not-urgent)

**Code + platforms**
- [ ] **Frontend:** add the client's display name to `WL_CLIENT_NAMES` in `index.html` (≈line 8032), commit, push (auto‑deploys). → [§6e](#6e-frontend-the-only-code-change)
- [ ] **Supabase:** **do nothing** — the calendar & samples auto‑create. (Confirm why in [§6f](#6f-supabase-nothing-to-do).)
- [ ] **Linear (SMM):** create a Project for the client on the **Video + Graphics** teams, set the SMM as lead, link the Slack channel. → [§6g](#6g-linear-project-smm)

**Finish**
- [ ] Verify on the live dashboard (calendar loads, samples strip, weekly Slack target, metrics next morning). → [§6h](#6h-verify)

> Rough sequence that mirrors how it's actually done: **Slack channel + Linear project → research/keywords → Sheets rows → frontend allowlist → filming Doc → (samples/calendar fill in as work starts).**

---

## 2. Intake

A client submits the **Notion "Onboarding Form"** database. The n8n workflow **"New Client → Slack DM (Notion Onboarding)"** (`y1bEpXLggfR5HqYV`) watches it and DMs you on Slack the moment a row lands. That DM is your trigger to start this checklist. (Discovery‑call notes also live in Fathom if you record them.)

---

## 3. Research: keywords & content_description

This is the part that's easy to forget the *method* for. You're producing three text fields that later drive market research, AI briefs, and the "about this client" copy.

**Method (what you described, codified):**
1. Pull **5–10 of the client's Instagram Reels**. The fast way is the Apify reel scraper that's already wired in n8n — see the template workflow **"ONE‑SHOT — Scrape Terrin IG"** (`G1RRkIDs6Mh7RGk8`). It POSTs to the Apify actor `apify~instagram-reel-scraper` with `{ "username": ["<their_ig_handle>"], "resultsLimit": 20 }`. Duplicate it, swap the handle, run it. (You can also just transcribe the reels by hand.)
2. **Transcribe / read** the reels and figure out what their content is actually about — themes, tone, audience, signature formats.
3. Write the three fields **in the same format as the existing rows** (open the Miki Agrawal or Natalie MacNeil row in **Clients Info** as your template):

   - **`keywords`** — a broad comma‑separated list of every topic they touch (15–20 items).
   - **`specific_keywords`** — the tighter subset (≈8) that best defines them (this seeds market research).
   - **`content_description`** — a structured prose brief with **three labelled blocks**:

     ```
     CREATOR IDENTITY: who they are, where their authority comes from, how they position themselves.
     CONTENT DNA: the throughline of their content — recurring themes, tone, signature format elements.
     AUDIENCE CONTEXT: who follows them (age/psychographics), why it resonates, what the client drives toward.
     ```

   *(Real example — trimmed — from the Miki Agrawal row, to match the voice/length:)*
   > **CREATOR IDENTITY:** Miki is a serial entrepreneur, author, and mission‑driven founder (TUSHY, HERO) who sits at the intersection of business, nature, spirituality, and social impact… **CONTENT DNA:** unified by one throughline — nature already solved the problem; the smartest thing humans can do is learn from it… she closes each piece with an affirmation (a signature format element)… **AUDIENCE CONTEXT:** purpose‑driven entrepreneurs and conscious consumers (28–45) who want to build things that matter… she drives toward TUSHY, HERO, and her retreats.

4. **`competitors`** — a comma‑separated list of competitor **Instagram handles** (no `@`), e.g. `iamhoniakader,pagetkagy,davidghiyam,…`. This feeds the COMPETITOR RESEARCH / MARKET RESEARCH automations.

> Once these land in **Clients Info**, the scheduled robots (CLIENTS METRICS, TOP VIDEOS, COMPETITOR RESEARCH, MARKET RESEARCH) pick the client up automatically on their next run — no extra wiring.

---

## 4. "Clients Info" row (the big one)

**Where:** SYNCVIEW sheet (`10QQ…QqAU8`) → tab **`Clients Info`**.
**Key:** `client_name` — must match the frontend allowlist name **exactly** (see the slug rule below).

**Columns (verified header), in order:**

| Column | What to put | Notes / can be blank? |
|---|---|---|
| `client_name` | Display name, e.g. `Terrin Ammar` | **Required.** Must equal the `WL_CLIENT_NAMES` entry. |
| `email` | Client email | Low‑stakes. |
| `competitors` | Comma‑sep competitor **IG handles** | Drives competitor/market research. |
| `keywords` | Broad topic list (15–20) | See [§3](#3-research-keywords--content-description). |
| `specific_keywords` | Tight subset (~8) | Seeds market research. |
| `content_description` | 3‑block brief (CREATOR IDENTITY / CONTENT DNA / AUDIENCE CONTEXT) | See [§3](#3-research-keywords--content-description). |
| `instagram_handle` | IG handle, no `@` | e.g. `thequeenkollective`. |
| `tiktok_handle` | TikTok handle | **Blank/`N/A` is fine** — scrapers skip it. |
| `youtube_channel_id` | `UC…` channel ID | **Blank/`N/A` is fine.** |
| `slack_channel_id` | `C…` channel ID for their Slack | Fill after you create the channel ([§6c](#6c-slack-channel)). Weekly report posts here. |
| `upload_post_profile` | upload‑post profile name | **Usually blank** — only the 2 TikTok‑auto‑upload clients use it ([§6d](#6d-upload-post-profile-not-urgent)). |

**Also read by the app** (add if you have them; they live in this same tab to the right): `slack_team_id` (Slack workspace id, for deep‑links) and `client_review_token` (guards the client's `?c=…` share link — if blank the app still works but the share link is unguarded).

> 💡 The `instagram_handle` is **not** the slug. The slug comes from `client_name` (see below). E.g. Terrin Ammar's IG is `thequeenkollective` but her slug is `terrinammar`.

---

## 🔑 The slug rule (read this once)

Almost everything keys off a **slug** derived from `client_name` by `wlNormalizeClient()` (`index.html:8014`). The rule:

> **lowercase → strip accents → drop a leading "Dr." → collapse "and"/"&" to `&` → remove all spaces & punctuation.**

| `client_name` | slug |
|---|---|
| Baya Voce | `bayavoce` |
| Terrin Ammar | `terrinammar` *(not `terrin`)* |
| Dr. Sonia Chopra | `soniachopra` *(no "dr")* |
| Eben & Annie / Eben and Annie | `eben&annie` |
| Sidney Laruel | `sidneylaruel` |

There is **one** slug convention everywhere (calendar, samples, caption prompts, Supabase `client` column, localStorage caches). Keep the **display name spelling consistent** across every tab/tool — drift like "Miki Agrawal" vs "Miki‑agrawal" vs "Eben & Annie" vs "Eben and Annie" is the #1 source of "why isn't this client showing up" bugs.

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
**Where:** SYNCVIEW sheet → tab **`FilmingPlans`** — columns `client_name | doc_url | notes | plan_months`.

1. Create a **master Google Doc** for the client's filming plan on the shared Drive.
2. Inside it, use **one Docs *tab* per month** (title them like `July 2026`). The app reads those tabs via the n8n webhook **"Filming Plan Tabs"** (`5S4JyVVR2CpHEv9b`) and shows month coverage automatically.
3. Paste the Doc URL into the `doc_url` cell for the client. *(If you skip the per‑month tabs, you can hand‑set `plan_months` like `2026-07,2026-08` as a fallback.)*

The Filming Plans UI lives under the **Kasper tab → Filming Plans** sub‑tab; runway is computed live from the client's `calendar_posts`.

### 6b. Templates / caption prompts (optional)
- **`Templates` tab** — per‑client styling the editors/designers use: `reels_subtitle_font`, `reels_subtitle_main_color`, `reels_subtitle_highlight_color`, `reels_reference_link`, `reels_preferences`, `thumbnails_title_font`, `thumbnails_title_color`, `thumbnails_highlight_color`, `thumbnails_photos_link`, etc. Filled progressively from the dashboard's Templates editor — **not needed on day one**.
- **`CaptionPrompts` tab** — a per‑client caption‑gen prompt (keyed by **slug**). Managed from the UI; optional.

### 6c. Slack channel
1. Create the client's Slack channel (follow the existing naming pattern in Slack).
2. Copy the **channel ID** (`C…`) → paste into `slack_channel_id` in **Clients Info**.
3. Copy the SMM's **user ID** (`U…`) → into the SMM tab's `slack_profile_url` (and `slack_team_id` into Clients Info if you use deep‑links).

This is what the **"Weekly Slack – Top Reel of the Week"** automation (`BTxic5NSaCMtZMh6`) posts to every Monday, and where urgent tweak pings go.

### 6d. upload‑post profile (not urgent)
Only needed if the client uses **TikTok auto‑upload**. Create a profile on upload‑post.com, then put its name in `upload_post_profile` (Clients Info). If blank, the uploader falls back to the slug and shows a ⚠ badge — harmless until they actually use it.

### 6e. Frontend (the only code change)
Add the client's **display name** to the `WL_CLIENT_NAMES` array in `index.html` (≈**line 8032**):

```javascript
const WL_CLIENT_NAMES = [
    'Baya Voce',
    …
    'Terrin Ammar',
    'New Client Name',   // ← add here, exact spelling
];
```

The slug is auto‑derived — you don't add it anywhere else in code. Commit + push to `main`; GitHub Pages redeploys `syncview.synchrosocial.com` automatically.

> ⚠️ **Ignore two stale instructions:** (a) the comment right above the array (`index.html:8023–8031`) telling you to run "Provision Missing Tabs" — see [§6f](#6f-supabase-nothing-to-do); and (b) the **root `README.md`**, which describes an old Instaloader/`scraper.py` pipeline that no longer exists.

### 6f. Supabase (nothing to do)
**You do NOT manually create a content calendar or sample calendar in Supabase.** Under the current (Supabase‑primary) architecture:

- The content calendar = table **`calendar_posts`**, the sample strip = **`content_samples`**. Both have primary key **`(client, id)`** keyed by the slug.
- **Reads** of a brand‑new slug just return an empty `200` (empty calendar / empty strip — handled cleanly).
- **The first write creates the row** (every writer upserts on `(client, id)` through n8n's service‑role credential). No table, no seed, no RLS policy is added per client.

So: once the client is in the allowlist and work starts, their calendar and samples populate themselves.

*Legacy note:* the old `Calendar_<slug>` / `Samples_<slug>` Google‑Sheet tabs (created by the **"Provision Missing Tabs"** workflows `gB17L9M5yYxxk6GT` / `7Pdp6qnkBzwXP3YG`) are now just a **best‑effort mirror**, not load‑bearing. If you want the mirror + Drive backups to stay complete you *can* add the new slug to those workflows' hardcoded `SLUGS` arrays and run them — but the live app no longer depends on it.

### 6g. Linear project (SMM)
Usually done by the **Social Media Manager**. In the **`synchro-social`** workspace:

1. Create a **Project** named exactly like the client (you can duplicate the **"Client Example"** template project).
2. Attach it to the **Video (`VID`)** and **Graphics (`GRA`)** teams (most client projects use both).
3. Set the **SMM as the project lead**.
4. **Link the client's Slack channel** to the project.
5. Drop brand info into the project description (fonts, accent colors, approved video/thumbnail samples, Drive/Frame.io links) — that's where editors look.

### 6h. Verify
- Open the dashboard, switch to the new client: calendar and samples load (empty is fine).
- Confirm the weekly Slack target resolves (`slack_channel_id` set).
- Next morning, check that **CLIENTS METRICS** / **TOP VIDEOS** produced rows (confirms handles are right). A client with no metrics row still appears via a placeholder, so absence of data ≠ broken.

---

## What's automatic (don't waste time on it)

- **Supabase** content calendar & sample strip — auto‑create on first write. ([§6f](#6f-supabase-nothing-to-do))
- **Metrics, Top Videos, Competitor Research, Market Research** — scheduled n8n workflows that read **Clients Info**; they pick up the new client on their next run.
- **Per‑client caches / realtime channels / share‑link state** in the frontend — created at runtime from the slug.
- **No** per‑client brand‑color config in `index.html` (brand colors only exist in the separate `thumbnails/` app, which is unrelated to dashboard onboarding).

## Gotchas & drift to watch

1. **Name spelling must be identical** across `WL_CLIENT_NAMES`, Clients Info, Social Media Managers, FilmingPlans, and the Linear project. The slug is unforgiving (see the slug rule).
2. **Allowlist lives in several places** that can drift: the frontend `WL_CLIENT_NAMES` (authoritative for the app), the Clients Info tab, and the n8n provisioner `SLUGS` arrays (legacy). Keep them in sync if you touch the provisioners.
3. **Stale docs:** root `README.md` (old Instaloader pipeline) and the `index.html:8023–8031` "provision the tab" comment both predate the current architecture. Don't follow them.
4. **Duplicate Linear projects** are common (several clients already have 2–3). Search before creating; reuse the canonical one.
5. **Secrets stay out of git:** Linear API keys, `client_review_token`s, Supabase service‑role — they live in the Google Sheet / n8n only. This public repo must never contain them.

---

## 7. Reference appendix

**IDs & locations**
- SYNCVIEW Google Sheet: `10QQnWOQY73Aj44R8AumYJzFpxMd_bZZiCMXkZ6QqAU8` — tabs: `Clients Info`, `Social Media Managers`, `FilmingPlans`, `Templates`, `CaptionPrompts`, `Video Editors`, + data tabs (Metrics, TopVideos, Competitor/Market Research, ContentSummaries).
- SyncView Calendar Google Sheet (legacy mirror): `1Gsn5xLImJyMhBMCNjK_tigpoUfcSFnvxTQLkk-A9Yps` — `Calendar_<slug>`, `Samples_<slug>`, `TikTokUploads`.
- Supabase project: `uzltbbrjidmjwwfakwve` — tables `calendar_posts`, `content_samples` (PK `(client, id)`).
- Frontend: `index.html` → `WL_CLIENT_NAMES` (~`8032`), `wlNormalizeClient` (`8014`). Live at `syncview.synchrosocial.com`.
- Linear workspace: `synchro-social`; teams **Video (`VID`)**, **Graphics (`GRA`)**; duplicate the **"Client Example"** project.

**Key n8n workflows**
| Workflow | ID | Role |
|---|---|---|
| New Client → Slack DM (Notion Onboarding) | `y1bEpXLggfR5HqYV` | Intake alert |
| ONE‑SHOT — Scrape IG Reels | `G1RRkIDs6Mh7RGk8` | Onboarding reel scrape (keywords) |
| CLIENTS METRICS | `Q4n1bagJYBkurEaI` | Daily metrics (reads Clients Info) |
| TOP VIDEOS | `DyVPx0neUZ94R0hJ` | Daily top videos (reads handles) |
| COMPETITOR RESEARCH / MARKET RESEARCH | `0KMfHmYqVdlr5EhG` / `FD2QUIOlobkdLOgs` | Reads competitors/keywords |
| Weekly Slack – Top Reel | `BTxic5NSaCMtZMh6` | Posts to `slack_channel_id` |
| Filming Plan Tabs | `5S4JyVVR2CpHEv9b` | Reads filming‑Doc month tabs |
| Calendar / Samples Provision Missing Tabs | `gB17L9M5yYxxk6GT` / `7Pdp6qnkBzwXP3YG` | Legacy Sheet‑tab mirror |

**SMM roster** (first name → email; copy their Linear key / Slack ID from existing Sheet rows, don't hard‑code): Analia · Sebastian · Ludmila · Molly (Molly Morales) · Laura · Raha · Sidney. (Josefina, Camila, Ivana also appear as Linear leads on some accounts.)

---

*Maintainer note:* if the architecture shifts again (e.g. the Google Sheet mirror is retired per `PHASE4_CLEANUP_CHECKLIST.md`, or RLS becomes per‑client per `AUDIT_2026-06-15.md`), update [§6f](#6f-supabase-nothing-to-do) and the "stale docs" gotcha.
