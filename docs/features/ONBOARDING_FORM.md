# Centralized Onboarding Form (SyncView)

> **Current status (verified 2026-07-14): capture and the Kasper inbox are deployed, but the
> feature is not go-live ready.** F77/F85 block the read boundary, F81 blocks public-capture abuse,
> F110/F111 block durable completion and operator acknowledgement, and F118 blocks unproved public
> example-media rights. The current operator surface is Kasper → Onboarding, backed by Supabase
> Edge readers—not Templates and not the historical n8n list routes.

> **P0 READ-BOUNDARY BLOCKER (F77).** The three currently deployed onboarding-list Edge Functions
> accept anonymous requests and return the contact/questionnaire corpus with service-role access.
> Removing account-password fields does not make those responses public-safe. Disable or contain
> those readers, add active role-scoped least-field reads and opaque discovery, constrain CORS, and
> prove anonymous/cross-role denial before treating the dashboard inbox as operable.
>
> **ABUSE/INTEGRITY BLOCKER (F81).** The public intake must accept anonymous clients, but the
> deployed capture fallback currently accepts unbounded caller-chosen IDs/payloads and can emit
> caller text to alerts. It lacks nonce/session ownership, rate/CAPTCHA, strict size/schema/kind
> controls, conditional updates, and immutable creation time. Add those controls and TEST
> spam/replay/oversize/foreign-ID/alert failure before relying on the never-lose chain.
>
> **COMPLETION/HANDOFF BLOCKER (F110/F111).** The live standard/AI submit graphs acknowledge an
> intake-row insert—not completed onboarding. Credential import is fail-soft, provisioning starts
> after the response without waiting, and a duplicate row resumes neither branch. The browser then
> clears its draft/id and shows Thank You. Treat 2xx as **captured only** until one durable resumable
> job proves every step complete. Staff use the SyncView onboarding inbox/job as the current entry;
> the old Notion intake is replaced and is not an operational fallback.

A standalone, private-link onboarding page built into `index.html`. It replaces the
two old intake systems (the **Notion** "Onboarding Form" for normal clients and the
**JotForm** form for AI clients) — **two funnels rendered from one shared module**:

- **Standard funnel** (`/onboarding_form`) — everything the Notion form had, plus the
  **editing-direction / samples** module from the June 25 team call, the Slack thread,
  and Raha's Google Doc. **No AI-avatar section.**
- **AI funnel** (`/ai_onboarding_form`) — the same form minus the **Sample video**
  section, plus the **AI-avatar** section shown unconditionally (no "want to add an AI
  avatar?" opt-in — every client on this funnel is here for the avatar). This is the
  replacement for the old JotForm AI form.

### One module, two variants

Both forms are the *same* code. A single flag, `OB_VARIANT` (`'normal'` | `'ai'`),
selects which sections render. The entry router sets it before the form mounts (see
below), then `_obSections()` filters the master list:

- `s4` **Sample video** → standard funnel only.
- `s8` **AI avatar** → AI funnel only.

After filtering, sections are **renumbered and recoloured by position** (a `_RAMP` of 8
brand hues), so each variant shows a clean `1..7` with a continuous blue→rose gradient and
no gaps — e.g. on the AI funnel the AI section is `s8` in markup but renders as step **7**.

## How to open it

```
Standard:  https://syncview.synchrosocial.com/onboarding_form
AI funnel: https://syncview.synchrosocial.com/ai_onboarding_form
```

These are clean path URLs. Because the site is **GitHub Pages** (static, no server
rewrites), the file-less paths are handled by `404.html`: GitHub Pages serves it, and a
tiny script redirects into the SPA — `/onboarding_form → ?onboarding=1`,
`/ai_onboarding_form → ?onboarding=ai`. `navTo` then rewrites the address bar back to the
matching clean path (no query, no hash). Old `?onboarding=<anything>` links still work and
clean to `/onboarding_form`; `?onboarding=ai` cleans to `/ai_onboarding_form`. Neither is
in the main nav — reachable only by knowing the link. Like `?intake=1`, this mode:

- bypasses the staff password,
- hides all workspace chrome (header + pageTop),
- locks the SPA to the onboarding page (back button / logo stay on it),
- loads **no** dashboard/Sheet/Supabase data, so the form works even if the rest of
  the app's data sources are down.

The chrome hide happens **before first paint**: the pre-paint boot gate (a tiny
script in `<head>` in `index.html`) detects onboarding mode from the URL, tags
`<html>` with `boot-onboarding`, pre-paints the form's dark background (`#101216`),
and sets the SynchroSocial tab title + favicon — so the SyncView analytics dashboard
never flashes while the app script loads. (`404.html`'s interstitial uses the same
dark background so the redirect hop doesn't shift color.) The step-2 pages on
synchrosocial.com link straight to the `?onboarding=` query entry to skip the
404-redirect hop; the address bar is still rewritten to the clean path on mount.

Each funnel autosaves its own draft to `localStorage` — `syncview_onboarding_draft_v1`
(standard) and `syncview_ai_onboarding_draft_v1` (AI) — so the two never clobber each
other; the draft clears on a successful submit.

### Branding

In onboarding mode (**either** funnel) the tab is branded **SynchroSocial**: the entry
router sets `document.title = 'SynchroSocial'` and swaps the favicon to
`synchro-social-favicon.png` — a **square** 256×256 crop of just the infinity mark (the wide
logo lockup got squished in the square favicon slot; the on-page header still uses the full
`synchro-social-logo.png`). The SyncView dashboard keeps its own `SyncView` title +
`syncview-favicon.png` — the override only applies on the onboarding page.

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
left rail plus its numbered badge (`--sec-rail`). Hues are assigned **by visible position**
from the `_RAMP` (after variant filtering + renumber), so each funnel's sections form a calm
**blue → violet → magenta → rose** gradient with no gaps — all in the brand's purple family,
so it never reads as a rainbow. Within a section, sub-groups
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

Master list below. **Standard funnel** shows 1–7 (Basic info → Account access).
**AI funnel** drops **Sample video** and appends **AI avatar**, so it also shows seven
steps: Basic info → Brand & audience → Style → Photos & source → Goals → Account access →
AI avatar. (Markup ids `s1..s8` are stable; the displayed numbers are positional.)

1. **Basic info** — name, email, phone, who else to loop in, billing contact.
2. **Your brand & audience** — brand-guidelines link, then the original form's four questions
   (IDEAL target customer, PAIN points, DESIRED OUTCOMES, PROCESS), each with a "the more detail,
   the better" prompt.
3. **Style** — split into clear **Video** and **Thumbnail** groups (via `.ob-subhead`s).
   - **Creators for inspiration** — repeatable rows (kept; "what to **model** from them" — the copy
     deliberately avoids "copy"/"borrow" so it doesn't feel like stealing).
   - **── Video ──**
     - **Subtitle style** — cards **Elegant / Native / Bold**, each showing its name + the
       **Standard** and **+ Highlight** previews side-by-side (purpose-made sample clips,
       `onboarding-video/sub-<key>.mp4` + `-hl.mp4`). **Each preview is its own selectable option**
       with a radio **dot that fills** when picked — **Subtitle** = plain caption, **Subtitle +
       Highlights** = a key
       word pops in colour. One radio group (`subtitle_pick`, values `<style>` / `<style>__hl`);
       on change `_obPickSubtitle` writes the derived **`subtitle_style`** + **`subtitle_highlight`**
       into hidden carriers (so serialization, validation and the viewer are unchanged), and
       `_obStyleSel` reflects the carriers back onto the dots on restore. (Replaced the per-card
       "+ Add highlight" pill, which replaced the old bottom toggle — clients couldn't tell the
       "+Highlight" preview was selectable.)
     - **B-roll** — single-select chips: Stock / AI-generated / **Mix of both** / **My own footage** / No B-roll.
       Picking **My own footage** reveals an optional **`broll_link`** field (`_obBrollSync`) to paste
       a link to their own footage.
     - A **"this is direction, not final"** disclaimer (`.ob-tp-note`, same as the thumbnail one)
       sits in the Video subgroup — nothing is locked in.
     - **Music** — genre checkboxes with ▶ previews (`onboarding-audio/<key>.mp3`).
     - **Music reference** + **Video reference** — each asks for **links** *and* a free-text
       **description** of the look they want (`video_reference` + `video_reference_desc`). Copy is
       link-agnostic: the music reference invites **Spotify / YouTube / Apple Music / anything**
       (no Drive note), and the shared "share the link" note (`OB_DRIVE_NOTE`) now reads "any link
       works — Google Drive, Dropbox, WeTransfer…" so file fields don't read as Drive-only.
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
       Below the picker a **disclaimer** (`.ob-tp-note`) makes clear this is *direction, not final* —
       nothing's locked in; the font, highlight colour, music, etc. can all change later. The Style
       section intro carries the same "none of this is locked in" framing.
     - **Thumbnail reference** — **links** *and* a free-text **description**
       (`thumbnail_reference` + `thumbnail_reference_desc`).
   - **── Anything else ──** always/never notes (the do's & don'ts).
   - References were consolidated to exactly three (video / thumbnail / music); the old subtitle
     reference, visual reference, font preference, font reference image, and "clips you like" were
     folded in. *(No "video editing style" picker — editing feel is the B-roll + Music answers.)*
4. **Sample video** *(standard funnel only)* — its own section, with intro instructions explaining
   the process: *before* we produce the first real video we make a few short **sample edits**
   (different subtitle styles, thumbnails, looks) so the client can pick what they like — and to make
   those look like their real videos, the **sample clip of you** (~30s talking to camera) is the
   single most useful thing to give. The section leads with a **worked example** (`_obSampleExample`):
   a preview tile of a real ~30s talking-to-camera clip a teammate recorded, so the client can see
   exactly what to send. It uses the same preview + full-screen-zoom mechanic as the subtitle clips
   (`data-ob-zoom` → `_obZoom`, which auto-detects the `.mp4` and plays it **with sound**); the file is
   `onboarding-video/sample-example.mp4`. (Dropped on the AI funnel.)
5. **Photos & source material** — both optional links (photos of you, content to pull from).
6. **Goals** — what a win looks like, anything else, and a free-text **questions /
   clarifications** box for anything that didn't fit the options above.
7. **Account access** — IG / TikTok / FB / LinkedIn / YouTube logins, with a note offering
   to share credentials securely via LastPass to `house@synchrosocial.com` instead of typing
   them. Ends with a **confirmation checkbox** (`lastpass_sent`) — clients sharing via LastPass
   tick it to confirm they actually sent the details, so staff know to look for them. These login
   fields are the only ones the dashboard viewer strips (`lastpass_sent` is a harmless boolean, not
   a credential, so it passes through in `answers`).
8. **AI avatar** *(AI funnel only)* — last section. **No opt-in gate** — on the AI funnel
   the client is already here for the avatar, so the old "Want to add an AI avatar?" Yes/No
   question and its ⓘ add-on explainer are removed and the fields show unconditionally (with a
   short intro instead). Its fields are **required** on this funnel (`_obValidate` treats
   `OB_VARIANT==='ai'` the same way the old gate's "yes" answer worked). Fields: what to build
   the likeness from (reuses photos if given), personality, look (talking-to-camera / podcast,
   shown as **selectable preview images**), text-only-videos toggle (ⓘ explains avatar-in-background +
   on-screen text), setting, framing, accessories (incl. an "Other" write-in), hair, makeup,
   clothing, and — in the **Voice** group — the voice-clone capture script + recording link
   (`ai_voice_link`), plus an extra optional field (`ai_voice_samples`) asking for a Drive link
   to as many high-quality voice recordings as possible (≈3 h ideal) to improve the clone.
   *(The likeness helper reads `sample_clip` if present, but on the AI funnel that field is gone,
   so it falls back to the photo links — no error.)*

### Example media

> **PUBLICATION-RIGHTS BLOCKER (F118).** These assets are served by the public site. The prior
> implementation record described multiple files as derivatives of client-provided frames,
> folders, or Drive originals and recorded no rights/provenance decision for the audio set. That is
> not proof of permission for permanent public product use. Privacy/legal must classify each file's
> source, people/voice/brand rights, licence, audience, retention and deletion duty; replace any
> uncertain file with fictional, commissioned, or explicitly licensed material; and coordinate any
> removal with F64's history/cache assessment. Do not add another media file without a public-safe
> provenance entry.

The two AI "look" options (`OB_LOOK_TALKING` / `OB_LOOK_PODCAST`) are shown as **selectable
preview images** up front — `onboarding-ai/talking-head.jpg` + `podcast.jpg` — tick one or both,
same preview + select feel as the subtitle styles
(`.ob-look-row`; no more ⓘ-to-reveal). Music previews are byte-sliced MP3 clips under
`onboarding-audio/`.

The **subtitle** picker uses `_obStyleCards(group, items, isVideo)` — rows
`[key, name, desc, standardMedia, highlightMedia]` rendered as cards showing the standard +
`+highlight` previews side by side, **each preview a selectable radio pick** — `_obPickSubtitle` derives the hidden `subtitle_style` + `subtitle_highlight` carriers; `_obStyleSel` reflects them back on restore.
The **thumbnail** picker is the separate live `_obThumbPicker` described above (preview + Font/Style/
Highlight, `_obThumbSync` swaps the preview). The full-screen zoom (`_obZoom`) auto-detects video vs
image by extension.

- **Sample-video example** — `onboarding-video/sample-example.mp4`, a ~30 s talking-to-camera
  example shown in **step 4**. Its presence in the tree is not a rights record; F118 must classify
  or replace it before it remains a public product example.
- **Subtitle clips** — `onboarding-video/sub-{elegant,native,bold}.mp4` + a `-hl.mp4` for each
  (six files; every style now has a highlighted-keyword variant). Purpose-made 9:16 sample reels
  demoing each subtitle style. F118 owns source/talent/voice and public-use classification.
- **Thumbnail styles** — 24 hosted renders under `thumbnail-styles/<font>-<style>[-hl].jpg`
  (font ∈ bold/native/elegant, style ∈ plain/shadow/stroke/banner, `-hl` = highlighted line).
  One base cover is rendered in every combination. To change the set, first record the approved
  source/provenance, then add matching files and extend `OB_THUMB_FONTS` / `OB_THUMB_TSTYLES`.
- The two AI "look" frames are local selectable previews — `onboarding-ai/talking-head.jpg` +
  `podcast.jpg` (`OB_LOOK_TALKING` / `OB_LOOK_PODCAST`). F118 must classify or replace them.

## Data flow

Each funnel has its **own** webhook and its **own** Supabase table, so the two intake
streams stay cleanly separated for review/routing:

```
Standard form ─POST {submission}─▶ n8n `onboarding-submit`     ─▶ Supabase client_onboarding     ─▶ Slack DM (Sidney)
AI form       ─POST {submission}─▶ n8n `ai-onboarding-submit`  ─▶ Supabase ai_client_onboarding  ─▶ Slack DM (Sidney)
```

> **2026-07-02 — never-lose-a-submission layer.** The submit now retries once
> (20s timeout), then fails over to the Supabase Edge capture and the n8n
> fallback webhook; drafts sync server-side while the client types (throttled +
> tab-close beacon); the submission id is stable across retries so duplicates
> answer `{ok, duplicate:true}`; an insert failure dead-letters the payload and
> DMs Sidney; and the weekly Drive backup now dumps both onboarding tables
> (credential fields stripped). Full picture: **ONBOARDING_FALLBACK.md**.

The front-end picks the URL by variant: `_obSubmit` POSTs to `ONBOARDING_SUBMIT_URL`
(standard) or `AI_ONBOARDING_SUBMIT_URL` (AI), and stamps the payload's `source`
(`syncview-onboarding` | `syncview-ai-onboarding`), `funnel` (`standard` | `ai`), and
`ai_avatar` (`no` | `yes`) accordingly.

The browser **never** writes those tables directly. The tables are intended to have no anonymous
table access because they hold private contact/questionnaire data — see
`migrations/onboarding-supabase-migration.sql` and
`migrations/ai-onboarding-supabase-migration.sql`. **That table policy is not the current read
boundary:** three composed Edge readers use service-role access and currently accept anonymous
requests (F77). They must be contained and replaced with authenticated, minimized projections.

### Webhook contract — `POST /webhook/{onboarding-submit | ai-onboarding-submit}`

Both webhooks take the identical body shape:

```jsonc
{
  "submission": {
    "id": "o_<ts36>_<rand>",     // client-minted
    "slug": "firstlast",          // wlNormalizeClient(first+last), best-effort
    "first_name": "…", "last_name": "…", "email": "…", "phone": "…",
    "ai_avatar": "yes" | "no",   // always "yes" on the AI funnel
    "funnel": "standard" | "ai",
    "answers": { /* full structured form: every field id, style_matrix{}, asset_grid{} */ },
    "source": "syncview-onboarding" | "syncview-ai-onboarding",
    "created_at": "ISO", "updated_at": "ISO"
  }
}
```

Current response: `200` with JSON; the browser checks only `res.ok`. On a non-200 it retains the
draft and offers retry/fallback. On any 2xx—including capture-only fallback acceptance—it clears
the draft and stable submission id and renders Thank You.

The active graphs make that acknowledgement narrower than the UI implies. Each primary workflow
inserts the intake row, passes through a fail-soft staff notification, responds, and only then
dispatches provisioning without waiting. Credential import is a separate fail-soft branch from the
insert, outside the response dependency. A same-id insert conflict goes straight to duplicate 200
and reaches neither credential import nor provisioning. Therefore 2xx proves **captured**, not
provisioned; retry safety currently applies to the intake row only (F110). A second auto-message
after the onboarding *call* is a separate later workflow.

## Status

- ✅ Front-end — both funnels built from one module, dark-themed, renders, validates, autosaves,
  graceful submit-failure. Verified in a headless browser:
  - **Standard** (`?onboarding=test`): 7 sections incl. **Sample video**, **no** AI section, no
    JS errors, title `SynchroSocial`, favicon `synchro-social-logo.png`.
  - **AI** (`?onboarding=ai`): 7 sections, **no** Sample video, **AI avatar** shown gate-less &
    renumbered to step 7, positional recolour, no JS errors, same branding.
- ✅ `migrations/onboarding-supabase-migration.sql` — standard table `client_onboarding`.
- ✅ `migrations/ai-onboarding-supabase-migration.sql` — historical idempotent definition for the
  deployed AI table; do not use this status doc as permission to change live schema.
- ✅ n8n `onboarding-submit` webhook — workflow `ljNY7CKYLKzMOACZ`, `POST /webhook/onboarding-submit`
  → `client_onboarding`. (Active.)
- ✅ n8n `ai-onboarding-submit` webhook — **created + activated** (workflow id `hxLFIdKG9hUIzukO`,
  `POST /webhook/ai-onboarding-submit`): `Receive POST → Build Row (adds funnel:'ai',
  source:'syncview-ai-onboarding', ai_avatar:'yes') → Insert Submission (Supabase
  `ai_client_onboarding`, gate) → Notify Sidney (Slack DM, SyncView Bot) → Respond {ok}`.
  Cloned from the standard Submit workflow via the n8n SDK; Supabase + Slack ("SyncView Bot")
  credentials attached.
- **Historical deployment record only (not current reader guidance):** n8n `ai-onboarding-list`
  webhook — created and activated (workflow id `oDZ1Oljvaig5KSLD`,
  `GET /webhook/ai-onboarding-list`): reads `ai_client_onboarding`, strips credentials, returns
  `{ok,count,submissions}`. Feeds the dashboard's **AI avatar onboarding** section.
- ✅ Dashboard inbox — the current **Kasper → Onboarding** surface uses one authenticated
  `onboarding-full` Edge request for Standard + AI + Legacy. The separate three-reader viewer is a
  different, currently unsafe public path under F77. The Kasper inbox still lacks fallback rows,
  status/actions/paging/freshness under F110/F111.
- ✅ Inbox detail — renders the **client's chosen thumbnail image** (`_obvThumb`) and surfaces
  **every editor/designer field** incl. the video/thumbnail/music references + described looks,
  subtitle-highlight, creators-to-model notes, the questions box, and (AI) the extra voice samples.
  Verified end-to-end against the live backend with real test submissions.
- ✅ **Capture/read path live** — submissions have been captured and rendered through the dashboard.
  This is not completion evidence for credential import or provisioning: those steps currently lack
  the durable joined receipt required by F110.

### Deployment record — no operator actions

The standard/AI capture schema and workflows are deployed. Their migration files remain historical,
idempotent definitions—not paste-ready rollout instructions. Any live schema/workflow change follows
the normal reviewed release and B4 fingerprint/readback process. A saved intake row remains protected
against loss, but the product must say **captured** until F110 proves provisioning complete.

### Second auto-message (later)
The June 25 call also wanted a *second* Slack post after the onboarding **call** (built from the
Fathom transcript + this form's answers). That's a separate workflow, not part of this form.

---

## Viewing submissions in the dashboard (Kasper → Onboarding)

A **Onboarding** sub-tab in the Kasper page lists submissions and shows each one's
editor/designer-relevant sections (brand & audience, style, photos/source, goals, AI avatar).
The detail view surfaces **every field an editor/designer needs**, including the reference
material the form collects: **video reference** links + the client's described look, **thumbnail
reference** links + described look, **music reference**, the **subtitle-highlight** choice, the
**creators to model** (with notes), and the client's **questions** box. (Account logins are the
only fields withheld — stripped by the list webhook.) Contact `phone` shows in the header.
The **Style** section renders the **exact thumbnail the client built** in the picker — the real
`thumbnail-styles/<font>-<style>[-hl].jpg` image (mirroring the form's `_obThumbImg`) with a
"Font · Style · Highlight" caption, clickable to full size; if they toggled "build my own" off it
shows "Wants us to design the thumbnail look." instead (`_obvThumb`).
It is **split into two sections** — **Standard onboarding** and **AI avatar onboarding** —
each with its own count; an empty funnel shows a muted "None yet." so the two-funnel structure
is always visible.

The Kasper inbox uses one `onboarding-full` Edge request and currently receives the standard, AI,
and legacy tables. It does **not** include `onboarding_fallback`; although source rows carry status,
the list/card UI does not expose it. There is no acknowledge, complete, retry, archive, pagination,
polling, realtime, or durable job action. A successful refresh is therefore an unbounded snapshot,
not an operator-completion receipt. F110/F111 require a joined job/step ledger, fallback/dead-letter
visibility, staff acknowledgement, retry/resume controls, paging/freshness and an independent
capture-without-acknowledgement alarm.

The standalone client-profile viewer composes three Supabase Edge readers (`onboarding-list`,
`ai-onboarding-list`, and `legacy-onboarding-list`) from the Edge base. F77 blocks operating those
readers until they authenticate and minimize responses. The older n8n routes below are retained
only as history and are not a recovery path:

- `GET /webhook/onboarding-list` (workflow `slqt2zCDyIc7OAmY`) → `client_onboarding`.
- `GET /webhook/ai-onboarding-list` (workflow `oDZ1Oljvaig5KSLD`) → `ai_client_onboarding`.

Those historical routes fetched with the service-role credential and stripped account-credential
fields before returning. That stripping was never a sufficient public-access boundary: contact
and questionnaire data remained private, and the current anonymous Edge readers expose the wider
corpus (F77). The standalone viewer tags each row with its `funnel` and uses per-reader
`Promise.allSettled` behavior; the Kasper full inbox is instead one Edge call. Historical snapshots:
`n8n-backups/onboarding-list.2026-06-26.created.json`,
`n8n-backups/ai-onboarding-list.2026-06-28.created.json`.

On a current-reader failure, preserve the authorization boundary and investigate the Edge reader,
session/role, deployment fingerprint, and Supabase health. Do not publish or revive a historical
service-role list route as a shortcut.
