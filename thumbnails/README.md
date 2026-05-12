# SyncThumbnails

A creator-first thumbnail tool. Upload a video, get smart-picked frames, drop a headline on it in your style — all in seconds. Built as a companion to **SyncView** (`sidney-afk/client-analytics`).

## Quick start

It's a static HTML/React/Babel app. No build step, no install — just open the file.

```bash
# Local
open SyncThumbnails.html

# Or serve it (recommended — file:// blocks some browser features)
npx serve .
# then open http://localhost:3000/SyncThumbnails.html
```

## File map

```
SyncThumbnails.html     ← Entry point. Loads React + Babel + all screen scripts.
styles.css              ← Design tokens + every screen's styles.
                          Theme matches SyncView (Plus Jakarta Sans, off-white #f4f4f2 bg,
                          black primary buttons, soft borders).
data.js                 ← Profiles (CLIENT_PROFILES), font catalog (FONT_OPTIONS),
                          layouts (LAYOUT_OPTIONS), mock smart-picks (SMART_PICKS),
                          and localStorage persistence helpers.
app.jsx                 ← Top-level router. Tracks current screen + selected profile/frame/draft.

screens/
  sidebar.jsx           ← Left nav, brand mark, profile list, "+ New thumbnail" CTA.
  dashboard.jsx         ← Recent thumbnails grid + profile cards.
  new.jsx               ← Step 1: pick a profile + upload/paste a video URL.
  picker.jsx            ← Step 2: fake "extracting frames" progress, then smart-picks grid + scrubber.
  editor.jsx            ← Step 3: canvas renderer. Layouts, headline input, font/color tweaks.
                          Per-profile rendering rules (e.g. Baya's two-tone bottom layout).
  create-profile.jsx    ← Profile creator. Upload sample thumbnails, pick fonts/colors, choose layout.

samples.html, index.html, syncview-favicon.png
                        ← Imported from sidney-afk/client-analytics for theme reference.
                          (samples.html and index.html are NOT linked from the app — keep or
                          delete depending on whether you want them as reference in-repo.)
```

## Data model

Everything lives in `window.*` globals (Babel scripts don't share scope across files, so this is the bridge).

**`CLIENT_PROFILES`** — array of profile objects. Each:
```js
{
  id: 'baya-voce',                  // kebab-case, used as key
  name: 'Baya Voce',
  handle: '@bayavoce',
  colors: ['#FFFFFF', '#E81E1E', '#000000', '#1A1A1A'],
  accent: '#E81E1E',                // emphasis color (last line / highlight)
  secondary: '#FFFFFF',             // main text color
  font: 'Inter Tight',
  fontWeight: 900,
  fontUrl: 'https://fonts.googleapis.com/...',
  style: 'Reels',                   // 'Reels' | 'YouTube' | etc
  layouts: ['centered-bottom-twotone'],
  textCase: 'sentence',             // 'sentence' | 'upper' | 'title'
  emphasisRule: 'last-line',        // how the accent color is applied
  sampleHeadlines: ['...'],
  createdAt: 1234567890,
}
```

**`FONT_OPTIONS`** — curated Google Fonts catalog used by the profile creator.

**`LAYOUT_OPTIONS`** — the layout IDs the editor knows how to render. Adding a new one means:
1. Add `{ id, label }` here.
2. Add a render branch in `screens/editor.jsx` (`drawCanvas` function).
3. Add a `<LayoutPreview kind="...">` JSX branch in the same file (used for the picker tiles).

## Persistence

Profiles are persisted to `localStorage` under `sync_profiles`. Seeded profiles in `data.js` are merged with the saved ones (user edits win by id). See `window.loadProfiles()` / `window.saveProfile()` in `data.js`.

Recent thumbnails (`RECENT_THUMBS`) are not yet persisted — they reset on reload.

## What's mocked vs. real

| Feature | Status |
|---|---|
| Profile CRUD | Real (localStorage) |
| Video upload | Mocked — input accepts a file but it's not used. The picker shows hardcoded `picsum.photos` frames. |
| Frame extraction / scoring | Mocked. Real impl needs ffmpeg in a worker (or server-side). |
| Smart-pick scores + signals | Hardcoded in `SMART_PICKS`. |
| Canvas rendering | Real. Each layout draws to an actual `<canvas>` via the profile's font + colors. |
| Export to PNG | Real — canvas `.toDataURL()` download. |
| Multi-account / sync | Not implemented. Single-user, single-device. |

## Theme

Pulled from SyncView (`client-analytics/index.html`). Tokens in `styles.css`:

```
--bg: #f4f4f2          /* page background */
--white: #ffffff       /* cards */
--border: #e4e4e0      /* dividers */
--text-primary: #111110
--text-secondary: #6b6b67
--text-muted: #b4b4ae
--ig / --tt / --yt     /* platform accents */
```

Font: `Plus Jakarta Sans` (400/500/600/700/800).
Mono: `JetBrains Mono`.

## Next steps (suggested)

1. Wire real video upload → ffmpeg.wasm in a Web Worker for frame extraction.
2. Score frames (face detection + sharpness — `face-api.js` or MediaPipe).
3. Persist `RECENT_THUMBS` to localStorage (or IndexedDB for the actual image blobs).
4. Add more client profiles. The Baya profile is the reference pattern.
5. Build out the remaining layouts (`split-screen`, `top-strip` are stubs).

## License / ownership

Private. © Sidney.
