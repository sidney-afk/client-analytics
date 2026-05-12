# CLAUDE.md

Guidance for Claude Code sessions working in this repo.

## What this is

**SyncThumbnails** is a static HTML/React/Babel app for generating creator thumbnails. No build step. No bundler. No npm. It's intentionally simple so any browser can run `SyncThumbnails.html` directly.

Sister app: **SyncView** (`sidney-afk/client-analytics`). Theme is pulled from there — keep them visually consistent.

## Architecture rules

- **No build step.** Don't introduce Webpack, Vite, Next.js, or TypeScript without asking. The whole app is `<script type="text/babel">` tags + plain `<script src>`.
- **Scope is shared via `window.*`.** Each Babel script gets its own transpilation scope, so components/data must be attached to `window` to be visible across files. See `data.js` for the pattern.
- **Style object names must be unique.** If you create a JSX file with a `const styles = {...}`, rename it (e.g. `editorStyles`). Babel-script collisions silently break the app.
- **One file per screen.** Components live in `screens/*.jsx`. Top-level routing lives in `app.jsx`.

## Theme — match SyncView, don't reinvent

The CSS tokens in `styles.css` come directly from `sidney-afk/client-analytics/index.html`. Don't drift:

- Font: `Plus Jakarta Sans` (heavy on 800 for titles, 500–600 for body)
- Background: `#f4f4f2` (off-white), cards on `#ffffff`
- Borders: `#e4e4e0` (1px, sometimes 1.5px on inputs)
- Primary action: black bg (`#111110`) + white text + 10px radius
- Page titles: 1.7rem / 800 / letter-spacing -0.03em
- Field labels: 0.72rem / 700 / uppercase / letter-spacing 0.08em

If a new component needs a new pattern, **steal it from `sidney-afk/client-analytics/index.html` first** (it's 500KB of reference CSS — use grep).

## Layout system

Each profile in `data.js` declares which `LAYOUT_OPTIONS` it supports. Layouts are implemented in two places in `screens/editor.jsx`:

1. **`drawCanvas`** — canvas-rendering logic for the actual export.
2. **`LayoutPreview`** — small JSX preview tiles shown in the layout picker.

Both must be updated for any new layout. The `centered-bottom-twotone` layout (Baya's) is the reference implementation — it uses no background, white text with the last line in the profile's accent color, and a soft drop shadow for legibility.

## Per-profile rendering

Profiles encode their own typography rules:
- `font` + `fontWeight` + `fontUrl` — Google Font, loaded on demand.
- `accent` — emphasis color (used by `emphasisRule`).
- `emphasisRule: 'last-line'` — last visual line of the wrapped headline gets `accent` color, rest get `secondary`.
- `textCase: 'sentence' | 'upper' | 'title'` — applied before render.

When adding a new client, study their actual thumbnails first. Codify the rule. Don't ship a "close enough" rendering — creators notice.

## Mocked vs. real

| Feature | Status | Where to start if implementing |
|---|---|---|
| Frame extraction | Mocked (`SMART_PICKS` in `data.js`) | `ffmpeg.wasm` in a Web Worker |
| Frame scoring | Mocked scores | `face-api.js` for face detection + Laplacian variance for sharpness |
| Thumbnail history persistence | In-memory only | localStorage for metadata, IndexedDB for image blobs |
| Profile CRUD | Real (localStorage) | — |
| Canvas → PNG export | Real | — |

## Testing

There are no tests. The app is small enough to verify by opening in a browser. If adding tests, prefer Playwright over Jest — it can drive the real `SyncThumbnails.html` directly.

## Things to ask before doing

- "Should I add a build step?" — almost always no.
- "Should I migrate to TypeScript?" — no.
- "Should I add a backend?" — yes, but ask first what the data model should be. Profiles probably want to sync; thumbnail history might.
- "Can I delete `index.html` and `samples.html`?" — they're imported from SyncView for theme reference. Ask Sidney; he may want them gone or want them deployed alongside.

## Common pitfalls

- Forgetting to attach a new component to `window` → "X is not defined" at runtime.
- Naming a styles object `styles` → collision with another file's `styles`, page breaks silently.
- Using a build-time `import` syntax → won't transpile through Babel standalone.
- Loading a custom font without adding it to `FONT_OPTIONS` → it won't show up in the profile creator.
- Changing class names in `styles.css` without updating the JSX → broken layout.

## Conventions

- Profile IDs: kebab-case (`baya-voce`, `tom-boyd`).
- Colors: uppercase hex (`#E81E1E`, not `#e81e1e`) — matches the Tweaks UI conventions.
- File naming: kebab-case for `.jsx` files, PascalCase for component names inside.
- Commits: descriptive, present tense ("Add Baya profile" not "Added Baya profile").
