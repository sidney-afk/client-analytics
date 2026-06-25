# Centralized Onboarding Form (SyncView)

A standalone, private-link onboarding page built into `index.html`. It replaces the
two old intake systems (the **Notion** "Onboarding Form" for normal clients and the
**JotForm** form for AI clients) with one form that has everything the Notion form
had, plus the JotForm AI-Avatar flow (gated behind an opt-in), plus the new
**editing-direction / samples** module from the June 25 team call, the Slack thread,
and Raha's Google Doc.

## How to open it

```
https://syncview.synchrosocial.com/?onboarding=<anything>
```

Any non-empty `?onboarding=` value renders the form. It is **not** in the main nav —
reachable only by knowing the link. Like `?intake=1`, this mode:

- bypasses the staff password,
- hides all workspace chrome (header + pageTop),
- locks the SPA to the onboarding page (back button / logo stay on it),
- loads **no** dashboard/Sheet/Supabase data, so the form works even if the rest of
  the app's data sources are down.

The page autosaves a draft to `localStorage` (`syncview_onboarding_draft_v1`) as the
client types, and clears it on a successful submit.

## Sections (the approved question set)

0. Welcome
1. Basic Information
2. Your Brand & Audience
3. **Editing Direction & Style** (the new module)
   - Reference creators (up to 5) + "clips you like"
   - 7 style matrices — Music, Transitions, Subtitles, B-Roll, Animations, VFX/Colour,
     Pacing — each a **Yes / No / Mix per option** grid with a **▶ Watch example** slot
   - Visual identity (fonts, colours, typography, thumbnails)
   - General direction (approach, tone, hard restrictions, must-haves, avoid)
   - AI / stock usage grid (Preferred / Allowed / Not allowed)
   - Sample video request (a short client clip so the first sample is real)
4. Source Material & Photos
5. Goals & Collaboration
6. **AI Avatar Add-On** — hidden unless the gate question = "Yes, I'm in". Includes the
   voice-clone capture script and all avatar-style questions.
7. Account Access & Credentials (last — most sensitive, highest drop-off)

### ▶ Example clips (placeholder mechanism)

The style matrices were designed (per the call) to let clients preview each style. The
clips don't exist yet, so each option shows **"▶ Example coming soon"**. To go live, add
a URL to `OB_EXAMPLE_CLIPS` in `index.html` keyed by `` `${catKey}:${optValue}` `` (e.g.
`'music:bold'`). No code change beyond filling the map.

## Data flow

```
Browser form ──POST {submission}──▶ n8n `onboarding-submit` (service role)
                                        ├─▶ Supabase  client_onboarding   (durable record)
                                        └─▶ Slack      per-client creative channel  (auto-post)
```

The browser **never** writes Supabase directly. `client_onboarding` deliberately has
**no anon read/write** (it holds passwords + personal data) — see
`onboarding-supabase-migration.sql`. Only the service-role n8n webhook touches it.

### Webhook contract — `POST /webhook/onboarding-submit`

Request body:

```jsonc
{
  "submission": {
    "id": "o_<ts36>_<rand>",     // client-minted
    "slug": "firstlast",          // wlNormalizeClient(first+last), best-effort
    "first_name": "…", "last_name": "…", "email": "…", "phone": "…",
    "ai_avatar": "yes" | "no",
    "answers": { /* full structured form: every field id, style_matrix{}, asset_grid{} */ },
    "source": "syncview-onboarding",
    "created_at": "ISO", "updated_at": "ISO"
  }
}
```

Expected response: `200` with any JSON (the form only checks `res.ok`). On a non-200 the
form keeps the draft and shows a retry message, so a flaky webhook never loses answers.

The webhook should: (1) upsert the row into `client_onboarding` (PK `id`, via the
service-role Supabase credential `XdBpJ6Xk8PMpZXXT`), and (2) post a readable summary to
the client's Slack creative channel — this is the "automated onboarding message after the
form is submitted" from the June 25 call. (A second auto-message after the onboarding
*call* — from the Fathom transcript — is a later step, not part of this form.)

## Status

- ✅ Front-end page — built, renders, validates, autosaves, graceful submit-failure. Verified
  in a headless browser (`?onboarding=test`): 7 sections, 7 style matrices, AI gate reveal,
  required-field validation, draft restore.
- ✅ `onboarding-supabase-migration.sql` — committed; **run it once** in the Supabase SQL
  editor (project `uzltbbrjidmjwwfakwve`).
- ⏳ n8n `onboarding-submit` webhook + Slack auto-post — the remaining backend wiring.
  Until it exists, submit returns the graceful "saved on this device, try again" message.
