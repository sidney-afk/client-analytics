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

The page is **dark-themed** — the dark palette is scoped to `body.onboarding-mode`
(redefining `--bg`, `--white`, `--text-primary`, etc., plus a new `--ob-accent` indigo
for selected states / the submit button), so the rest of the dashboard keeps its light
`:root` theme untouched.

Every section is **collapsible** (expanded by default). The numbered section header is a
`role="button"` row with a rotating chevron; click it (or focus + Enter/Space) to toggle.
The body animates open/closed via a `grid-template-rows: 1fr → 0fr` transition. Jumping to
a section from the top nav, or hitting a missing required field on submit, auto-expands the
relevant section.

The page leads with the official **Synchro Social logo** (`synchro-social-logo.png` — the
full infinity + wordmark lockup, a transparent PNG cropped tight) given presence with a soft
purple glow, above a small "Client Onboarding" label.

**Visual hierarchy** is conveyed with colour. Every main section owns a hue — a coloured
left rail plus its numbered badge (`--sec-rail`, set per section in `_obSections`). The eight
section hues form a calm **blue → violet → magenta → rose** gradient — all in the brand's
purple family, so it never reads as a rainbow. Within a section, sub-groups
(`_obSubgroup(title, color, fields)`) sit behind a thinner, indented rail with a small dot, in
an **analogous neighbour** of the parent section's hue — so a section and its children read as
one family rather than clashing. Sub-groups exist in **Style** (Video / Thumbnail / Anything
else) and in **AI avatar**, whose fields are grouped into *Your likeness → Personality &
delivery → Scene & framing → Appearance → Voice*. The whole scheme is muted on purpose, so the
Section → group → field nesting reads almost subconsciously rather than shouting.

Sub-groups are **collapsible too** (expanded by default), animating the same `grid-template-rows`
way the sections do (`_obToggleSubgroup`). Overflow is kept hidden during the animation then restored
to visible once expanded, so custom-select dropdowns inside a sub-group aren't clipped. Missing-field
validation expands the enclosing sub-group as well as its section.

The **coloured rail itself is the collapse handle**: every section and sub-group renders a clickable
`.ob-rail` element (the vertical line) — `data-ob-rail`, `role="button"`, keyboard-toggleable — that
**widens 3px→6px and brightens on hover** so it reads as interactive. Clicking the rail collapses its
container (the rail's `parentElement` is the `.ob-sec` or `.ob-subgroup`). The headers stay clickable
too as a secondary affordance.

All controls are custom-styled and emoji-free: the music-genre checkboxes use a custom
`.ob-chk` box (indigo when checked) instead of the native control, and the "share the link"
note uses a small inline lock **SVG** (no 🔒 emoji).

## Sections (the approved question set)

1. **Basic info** — name, email, phone, who else to loop in, billing contact.
2. **Your brand & audience** — brand-guidelines link, ideal customer, pain points,
   desired outcomes, process.
3. **Style** — split into clear **Video** and **Thumbnail** groups (via `.ob-subhead`s).
   - **Creators for inspiration** — repeatable rows (kept; the one structured "who to copy" field).
   - **── Video ──**
     - **Subtitle style** — single-select cards **Elegant / Native / Banner**. Each card shows
       its name + the **Standard** and **+ Highlight** previews side-by-side (real ~10s client
       clips, `onboarding-video/sub-<key>.mp4` + `-hl.mp4`). A separate **Add highlighted
       keywords** toggle (`subtitle_highlight`) is **disabled until a style with a highlight
       variant is selected** (`_obStyleSel`); Banner has no highlight, so the toggle stays off
       for it. The toggle no longer swaps previews — both are always shown.
     - **B-roll** — single-select chips: Stock / AI-generated / **Mix of both** / No B-roll.
     - **Music** — genre checkboxes with ▶ previews (`onboarding-audio/<key>.mp3`).
     - **Music reference** + **Video reference** — each asks for **links** *and* a free-text
       **description** of the look they want (`video_reference` + `video_reference_desc`).
   - **── Thumbnail ──**
     - **Thumbnail style** — an interactive **live preview** picker (`_obThumbPicker`): a 9:16 preview
       that swaps in place beside tight controls — **Font** (Bold / Native / Elegant) × **Style**
       (Plain / Shadow / Stroke / Banner) × a **Highlight** toggle = 24 real renders of the same cover,
       hosted in `thumbnail-styles/<font>-<style>[-hl].jpg` (resized from the client's Drive originals).
       Controls are clustered next to the preview so the cursor barely moves; clicking any control swaps
       the preview instantly (all 24 preloaded). A **"Build my own thumbnail look"** toggle
       (`thumbnail_build`, default on) lets a client opt out — switch it off and the picker hides
       (we design it for them). The current trio auto-saves as `thumbnail_font` + `thumbnail_text_style`
       + `thumbnail_highlight` and restores from the draft. (Replaced the old Elegant/Box/Bold cards.)
     - **Thumbnail reference** — **links** *and* a free-text **description**
       (`thumbnail_reference` + `thumbnail_reference_desc`).
   - **── Anything else ──** always/never notes (the do's & don'ts).
   - References were consolidated to exactly three (video / thumbnail / music); the old subtitle
     reference, visual reference, font preference, font reference image, and "clips you like" were
     folded in. *(No "video editing style" picker — editing feel is the B-roll + Music answers.)*
4. **Sample video** — its own section (it's the single most useful thing a client can give us, and
   it isn't really a *style* choice): the **sample clip of you** (~30s talking to camera), clearly
   named so it's distinct from the photos / source-material links.
5. **Photos & source material** — both optional links (photos of you, content to pull from).
6. **Goals** — what a win looks like, anything else, and a free-text **questions /
   clarifications** box for anything that didn't fit the options above.
7. **Account access** — IG / TikTok / FB / LinkedIn / YouTube logins, with a note offering
   to share credentials securely via LastPass to `house@synchrosocial.com` instead of typing
   them. These login fields are the only ones the dashboard viewer strips.
8. **AI avatar (optional)** — last section. Gated behind the "Want to add an AI avatar?"
   Yes/No question (**defaults to No**) with an ⓘ explainer that frames it as a separate
   add-on — its own production system and pricing, handled directly with Casper (deliberately
   no prices or firm promises). When Yes: what to build the likeness from (reuses the sample
   clip / photos if given), personality, look (talking-to-camera / podcast, each with an ⓘ
   example frame), text-only-videos toggle (ⓘ explains avatar-in-background + on-screen text),
   setting, framing, accessories (incl. an "Other" write-in), hair, makeup, clothing, and — in the
   **Voice** group — the voice-clone capture script + recording link (`ai_voice_link`), plus an extra
   optional field (`ai_voice_samples`) asking for a Drive link to as many high-quality voice recordings
   as possible (≈3 h ideal) to improve the clone.

### Example media

The two AI "look" options show a real reference frame from Sandcastles thumbnails (public
`storage.googleapis.com` URLs in `OB_LOOK_TALKING` / `OB_LOOK_PODCAST`). Music previews are
byte-sliced MP3 clips under `onboarding-audio/`.

The **subtitle** picker uses `_obStyleCards(group, items, isVideo)` — rows
`[key, name, desc, standardMedia, highlightMedia]` rendered as cards showing the standard +
`+highlight` previews side by side, with a gated `subtitle_highlight` toggle (`_obStyleSel`).
The **thumbnail** picker is the separate live `_obThumbPicker` described above (preview + Font/Style/
Highlight, `_obThumbSync` swaps the preview). The full-screen zoom (`_obZoom`) auto-detects video vs
image by extension.

- **Subtitle clips** — `onboarding-video/sub-{elegant,native,banner}.mp4` plus
  `sub-elegant-hl.mp4` / `sub-native-hl.mp4`. Trimmed to ~10s, 480×854 H.264
  (`yuv420p`, `+faststart`, no audio), ~0.3–0.5 MB each, cut from real client reels
  (Elegant=Chelsey, Native=Jesse, Banner=Lily; Elegant-hl=Danielle, Native-hl=Lisa).
  Reels are pulled with `yt-dlp` then cut: `ffmpeg -ss <t> -i src.mp4 -t 10 -vf scale=-2:854
  -an -c:v libx264 -profile:v main -pix_fmt yuv420p -crf 27 -preset slow -movflags +faststart out.mp4`.
- **Thumbnail styles** — 24 hosted renders under `thumbnail-styles/<font>-<style>[-hl].jpg`
  (font ∈ bold/native/handwritten, style ∈ plain/shadow/stroke/banner, `-hl` = highlighted line).
  Same base cover ("The red flag nobody tells you to look for") rendered every way; resized to
  800px-wide JPEG (~85 KB each, ~2 MB total) from the client's Drive originals. To swap the base or
  add a font/style, drop in matching files and extend `OB_THUMB_FONTS` / `OB_THUMB_TSTYLES`.
- The two AI "look" frames use `OB_LOOK_TALKING` / `OB_LOOK_PODCAST` (hot-linked Sandcastles URLs).

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

- ✅ Front-end page — dark-themed, built, renders, validates, autosaves, graceful submit-failure.
  Verified in a headless browser (`?onboarding=test`): 8 collapsible sections, style pickers,
  AI gate reveal, required-field validation (auto-expands collapsed sections), draft restore.
- ✅ `onboarding-supabase-migration.sql` — committed; **run it once** in the Supabase SQL
  editor (project `uzltbbrjidmjwwfakwve`).
- 🟡 n8n `onboarding-submit` webhook — **created** (workflow id `ljNY7CKYLKzMOACZ`,
  `POST /webhook/onboarding-submit`): `Receive POST → Build Row → Insert Submission
  (Supabase, gate) → Notify Sidney (Slack DM) → Respond {ok}`. Snapshot in
  `n8n-backups/onboarding-submit.2026-06-25.created.json`. Two small finish steps remain
  (the MCP write/permission prompts errored out mid-session, so these are left for the n8n UI).

### Finish steps (≈2 min, one time)

1. **Run the SQL.** In the Supabase SQL editor (project `uzltbbrjidmjwwfakwve`), run
   `onboarding-supabase-migration.sql` to create `client_onboarding`.
2. **Fix the Slack credential.** Open workflow `ljNY7CKYLKzMOACZ` → **Notify Sidney** node →
   switch the Slack credential from the auto-assigned **"Slack account 2"** to **"SyncView Bot"**
   (`qUlAcjdhd6EpKOTL`) — same bot the existing Notion-intake notifier uses.
3. **Activate** the workflow (toggle Active / publish).

Until step 1 + 3 are done, the form's submit returns the graceful "saved on this device, try
again" message — no data is lost. Because the Supabase insert is the gate (`onError:
stopWorkflow`), a submission is never silently dropped: if the table is missing the webhook
500s and the browser keeps the draft.

### Second auto-message (later)
The June 25 call also wanted a *second* Slack post after the onboarding **call** (built from the
Fathom transcript + this form's answers). That's a separate workflow, not part of this form.

---

## Viewing submissions in the dashboard (Templates → Onboarding)

A new **Onboarding** sub-tab in the Templates tab lists submissions and shows each
one's editor/designer-relevant sections (brand & audience, style, photos/source,
goals, AI avatar). It reads `GET /webhook/onboarding-list` (workflow
`slqt2zCDyIc7OAmY`), which fetches `client_onboarding` with the service-role
credential and **strips the account-credential fields** before returning — so no
passwords ever reach the public dashboard. Snapshot:
`n8n-backups/onboarding-list.2026-06-26.created.json`.

**One-time finish step:** activate workflow `slqt2zCDyIc7OAmY` in n8n (toggle Active).
Until then, the Onboarding tab shows "couldn't load submissions".
