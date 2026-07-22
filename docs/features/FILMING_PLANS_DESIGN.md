# Filming Plans — Design Spec

**Status:** Implemented; Edge containment live, Pages/table cutover staged; historical design notes retained · **Date:** 2026-06-03, updated 2026-07-22
**Owner area:** Kasper tab → new **Filming Plans** sub-tab

> **P0 READ-BOUNDARY BLOCKER (F82).** Live proof showed the Edge GET and independent anonymous table
> policy exposing the complete client/Doc-link roster. The staff-gated Edge reader is now live and a
> missing/wrong key returns `401`. Candidate Pages source requires the reverified staff key, removes
> browser REST/realtime/Sheet fallbacks, purges caches on sign-out, and carries the narrow anon-SELECT
> revoke. Current Pages still uses the table directly, so that revoke is intentionally held until the
> caller merges. F82 remains open pending intended-role browser proof, table denial, and private
> document-sharing review.
>
> **2026-07-14 implementation update:** the original design below used the SYNCVIEW Google Sheet
> `FilmingPlans` tab. Supabase `public.filming_plans` remains the source of truth. In candidate source,
> all browser reads go through the live staff-gated Edge Function and fail closed; the Sheet is no
> longer a browser fallback. Admin, SMM, and creative/editor/designer role keys can read; only admin
> can edit. The old `ONBOARDING_STAFF_KEY` stays as transition compatibility pending its approved
> retirement gate; `CREDENTIALS_STAFF_KEY` is not accepted.

> **2026-07-22 content-bank update (current behavior).** The Kasper view no
> longer treats the latest scheduled date as the client’s content runway. It
> counts every non-archived calendar card that is undated or dated today/future;
> past-dated cards are treated as consumed. The three pills are **Need a plan**
> (10 or fewer pieces, no Doc, or an overdue plan), **Soon** (11–20 pieces, an
> unknown plan month, or a plan due within 14 days), and **Covered** (21+ pieces
> with a plan more than 14 days away). A June plan tab is expected to supply July
> content, so its next plan is due in August. The original runway-oriented
> design notes below are historical context where they conflict with this update.

---

## 1. The problem (in one line)

Kasper writes a filming plan per client roughly every month, but there's no
single place that tells him **which clients are about to run out of content and
therefore need a new plan now.** Today that knowledge lives in his head.

## 2. What this feature does

Adds a **Filming Plans** sub-tab next to *Editors* in the Kasper tab that answers,
at a glance:

1. **Who needs a filming plan right now** (the alert list, sorted by urgency).
2. **Which months each client already has a plan for** (the month grid).
3. **One click to open the actual plan** (the Google Doc tab).

It pulls two things together that already exist but were never connected:

- **When content runs out** — computed live from each client's content calendar
  (the latest `scheduled_date` on their cards).
- **What plans exist** — read automatically from each client's master filming-plan
  Google Doc (one tab per month).

---

## 3. How a filming plan gets into the system

**Decision: one master Doc link per client; the app reads the Doc's tabs automatically.**

- Kasper keeps doing exactly what he does today: one Google Doc per client, with a
  **new tab for each month's plan** (Docs tabs, titled e.g. `July 2026`, `June 2026`).
- The **only** new habit: paste each client's master Doc link **once** through the main
  dashboard **Filming Plans** editor. It persists to `public.filming_plans`; the former Google Sheet
  is historical only and is not a browser read fallback. After that, every new monthly
  tab he adds shows up automatically—no extra data entry per month.

### What we can and can't get from tabs (important)

- ✅ Each Google Docs tab has a **title** and a **tab ID in the URL** (`...?tab=t.xxxx`),
  both readable via the Google Docs API (`document.tabs`). We can link straight to a tab.
- ❌ Tabs do **not** expose a reliable "created on" date. So the view keys off the
  **month a tab represents** (parsed from its title), not a literal creation date.
  This is actually the more useful signal: the question is "is there a plan for the
  upcoming month?", not "what day did he type it."

### Tab-title parsing

We infer month/year from the tab title. Supported, in priority order:

| Tab title example | Parsed as |
|---|---|
| `July 2026`, `Jul 2026`, `2026-07`, `07/2026` | 2026-07 |
| `July` (no year) | current/most-likely year by position in the tab list |
| `Week of Jul 7` / free text | unparseable → listed under "Other tabs", not counted as a month |

Unparseable tabs never block anything — they just don't count toward month coverage.

---

## 4. The screen (UI)

Following 2026 dashboard best practice: **answer the urgent question in two seconds,
colour-code hard, reveal detail on demand.**

### 4a. Top: the alert list (primary)

One row per client, **sorted most-urgent first**:

```
🔴  Baya Voce        Content until Jun 20 · 17 days left      No July plan → write it now
🟡  Acme Co          Content until Jul 04 · 31 days left      Aug plan not started
🟢  Kasper Hytonen   Content until Aug 12 · 70 days left      Jul plan ready
```

Each row shows:
- **Status dot** (🔴 / 🟡 / 🟢) — see §5 for the rule.
- **Client name** → click expands the month history (progressive disclosure).
- **Content runway** — "Content until `<latest scheduled_date>` · `<N>` days left".
- **Latest plan month** + a **plan/next-action hint** ("No July plan → write it now").
- A small **Open Doc** button (deep-links to the latest tab).

### 4b. Expanded row: per-client month strip

Expanding a client shows the recent months and whether each has a plan:

```
Baya Voce
  Apr ✅   May ✅   Jun ✅   Jul ⬜ (needed)   Aug ⬜
  Content scheduled through Jun 20 · last plan tab: "June 2026"
  [ Open filming Doc ]
```

### 4c. Bottom: month grid (overview)

Clients down the side, last ~6 months across the top, a filled cell where a plan tab
exists. Empty cells in the current/next month are highlighted. Click a filled cell →
opens that month's Doc tab.

```
              Mar  Apr  May  Jun  Jul
Baya Voce      ●    ●    ●    ●    ○
Acme Co        ●    ●    ●    ○    ○
Kasper H.      ●    ●    ●    ●    ●
```

### Visual language
- Reuse existing Kasper styles (`.kasper-subtab`, card/border tokens) so it feels native.
- Colours: green `--emerald`, amber `--amber`, red `--red` (already in the theme).
- A small **info (ⓘ)** button explaining the colour rules, matching the Editors tab pattern.

---

## 5. The alert rule ("both combined")

A client turns **🔴 / 🟡 / 🟢** from two inputs:

- **Runway** = days from today until the client's **latest `scheduled_date`** across
  their content-calendar cards (ignoring archived/deleted).
- **Coverage** = does a filming-plan tab exist for the **upcoming month** (the month
  the content is rolling into)?

| State | Condition |
|---|---|
| 🟢 **Healthy** | Upcoming month is covered **OR** runway > amber threshold |
| 🟡 **Plan soon** | Runway ≤ amber threshold **and** upcoming month not covered |
| 🔴 **Act now** | Runway ≤ red threshold **and** upcoming month not covered |

**Default thresholds (configurable):** red ≤ **10 days**, amber ≤ **21 days**.

Edge cases:
- No content calendar / no future cards → show 🔴 "No scheduled content" (can't compute
  runway; almost certainly needs attention).
- No Doc link pasted for a client → 🟡 "No filming Doc linked" prompt to paste it.
- Plan already exists for the upcoming month → 🟢 regardless of runway.

---

## 6. Data & plumbing

> **Historical design below.** Published GViz and unauthenticated backend-reader guidance is not an
> approved current read boundary. F82's authenticated, least-field contract supersedes it.

### 6a. Historical Google Sheet tab: `FilmingPlans`

This was the original read design and is retained only as historical context. The dashboard must
not fetch this published CSV: it reads the staff-gated `filming-plans` Edge Function instead.

| Column | Example | Notes |
|---|---|---|
| `client_name` | `Baya Voce` | Must match the existing client name key |
| `doc_url` | `https://docs.google.com/document/d/<id>/edit` | Master filming-plan Doc |
| `notes` *(optional)* | | Free text, ignored by logic |

The former `FILMING_PLANS_URL` browser constant and fail-open fallback have been removed.

### 6b. New n8n webhook: read a Doc's tabs
The dashboard is a static page — it can't call the Google Docs API directly with the
needed auth. We mirror the existing calendar pattern with a small backend endpoint:

- **Endpoint:** `GET /webhook/filming-plan-tabs?doc=<docId>`
  (host: `synchrosocial.app.n8n.cloud`, same as the calendar webhooks).
- **Server step:** Google Docs API `documents.get` → return the `tabs` list as
  `[{ tabId, title, url }]`.
- **Auth note / setup task:** the n8n Google credential that already reads the Sheets
  must have the **Google Docs read scope** added. (One-time setup — flag for whoever
  owns the n8n workspace.)
- **Caching:** cache per-doc response for ~10 min (same TTL the Editors tab uses) so
  opening the sub-tab doesn't hammer the API across all clients.

### 6c. Content runway source (already exists)
Reuse the current calendar fetch (`/webhook/calendar-get?client=<slug>`). For each
client, `runwayDate = max(scheduled_date)` over non-archived cards. To avoid N calls on
load, fetch lazily / in small batches and cache; the alert list can render progressively
(skeleton → fill), consistent with how Editors loads.

### 6d. Where the new code lives (follows existing conventions)
- Add `{ key: 'filming-plans', label: 'Filming Plans', icon: … }` to `KASPER_SUBTABS`
  (~line 18852). The button, URL hash `#kasper/filming-plans`, and persistence come free.
- Add `_kasperState.filming*` fields (data, loading, error, loadedAt, expanded map),
  mirroring the `editors*` fields.
- Route in `_kasperRenderTab()` (~line 19081) → new `_kasperRenderFilms()`.
- Loader `_kasperLoadFilms()` + painter `_filmsPaint()` mirroring
  `_kasperLoadEditors()` / `_kedPaint()`.
- CSS prefixed `.kfilm-*`, mirroring `.ked-*`.

---

## 7. What's explicitly out of scope (v1)
- Writing/creating filming plans from the dashboard (Kasper still writes in Docs).
- Auto-creating next month's tab.
- Notifications / Discord pings when a client goes red (good v2 — the data is all here).
- Per-tab creation dates (not available from Docs; see §3).

## 8. Current operational dependencies

The Supabase table, dashboard editor, Kasper reader, Templates consumer and Docs-tab lookup are
already implemented. Do not recreate the original Sheet-first build sequence. Current readiness is:

1. Merge/deploy the protected Pages caller and prove all intended staff allow paths; then apply the
   filming-table clause of the F88 revoke and prove direct anonymous table denial. The Edge reader is
   already deployed/fingerprinted and denies missing/wrong keys with `401`.
2. Keep the former Sheet path out of browser fallback logic; privately review whether the source
   Sheet and linked Google Docs still allow unauthenticated access.
3. Add/update each master Doc link through the authenticated dashboard editor and verify the
   Supabase readback plus Docs-tab projection.
4. Keep Google credential/scope values in managed runtime configuration; never copy them into this
   repository or operator output.

## 9. Historical build record

The original order was Sheet tab → n8n Docs lookup → runway computation → Kasper UI. It is retained
only to explain the architecture and is not a current rollout recipe. Current changes must follow
the reviewed release/fingerprint/readback gates and the F82 access-boundary acceptance matrix.

---

### Decisions captured
- **Source of truth:** one master Doc link per client; auto-read tabs. *(chosen)*
- **Alert trigger:** content runway **and** missing upcoming-month plan combined. *(chosen)*
- **Thresholds:** red ≤ 10d, amber ≤ 21d. *(default — confirm with Kasper)*
