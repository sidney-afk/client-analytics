# Production Preview Adapter Contract

Source of truth: `docs/syncview-design/SyncView.html`. The wired `?prod=1` tab reads live B1 Supabase rows, then `_prodAdapter()` converts those rows into the artifact data shapes used by the render layer: `ISSUES`, `PROJECTS`, `CLIENTS`, and `EDITORS`.

## Data Mapping

`_prodAdapter()` is the single boundary between B1 rows and the artifact render model. `_prod*` render functions consume adapter output, not raw Supabase rows.

### ISSUES

Each `deliverables` row becomes one artifact-shaped issue:

- `id`: the stable live deliverable id used by `?prod=1&d=...` deep links and event reads.
- `displayId`: `identifier || linear_identifier || id`, used for visible issue labels.
- `team`: deliverable team, falling back to its batch team.
- `project`: client slug.
- `title`: deliverable title.
- `status`: artifact status key.
- `assignee`: `team_members.id`.
- `due`: display date.
- `dueRaw`: original date for overdue comparison.
- `created`: display creation date.
- `desc`: deliverable brief.
- `file`: delivered file URL, falling back to batch delivery/footage/filming URL.
- `parent`: the parent issue id, or `null`.

Parent/children rule: for each batch, a deliverable whose `title` equals `batch.name` after trim + case-insensitive normalization is the batch-parent ISSUE. Its children are the batch's other deliverables. A non-parent deliverable has `parent = <batch-parent issue id>` if one exists and never lists siblings as children. If no batch-parent issue exists, batch-mates are not treated as each other's children.

### PROJECTS

Each `clients` row becomes an artifact `PROJECTS[slug]` entry:

- `id` / `client`: client slug.
- `name`: `display_name || slug`.
- `emoji`: the stored emoji when present.
- `team`: `video` or `graphics` when `kind` is known.

Icon fallback: if a client/project has no emoji, the render layer uses the artifact project glyph (`I.project` equivalent via `_prodIcon('project')`). It must never fall back to the letter `S`.

### CLIENTS

Each `clients` row also becomes one artifact board card:

- `id` / `client`: client slug.
- `name`: `display_name || slug`.
- `status`: artifact project status key.
- `lead`: `lead_member_id`.
- `issues`: count of top-level issues for the client.
- `target`: display target date.
- `desc`: board description.

### EDITORS

Each `team_members` row becomes an artifact `EDITORS[id]` entry:

- `name`: `name || email || "Unknown"`.
- `init`: stable initials from the display name.
- `color`: existing `avatar_color` when valid; otherwise deterministic hash of the name into the artifact editor palette: `#e2a03f`, `#4cb782`, `#e56cd6`, `#5e6ad2`, `#6c6f7d`.
- `active`: preserves the source active flag.

### Status Table

| B1/Supabase status | Artifact issue key |
|---|---|
| `triage` | `triage` |
| `backlog` | `backlog` |
| `todo` | `todo` |
| `in_progress` | `prog` |
| `smm_approval` | `smm` |
| `kasper_approval` | `kasper` |
| `client_approval` | `client` |
| `tweak` | `tweak` |
| `approved` | `approved` |
| `scheduled` | `scheduled` |
| `posted` | `posted` |
| `canceled` | `canceled` |
| `duplicate` | `duplicate` |

Project board status maps `in_progress` to the artifact project key `prog`; all other board statuses keep their names (`backlog`, `planned`, `paused`, `completed`, `canceled`).

## Environment Shim

The artifact is a standalone document. The wired Production tab is embedded inside the larger SyncView host page, so these assumptions are explicitly satisfied:

- CSS variables: artifact overlays assume surface/text/border variables resolve where overlays mount. `prodLayer`, `prodTip`, `prodToast`, and the command-palette backdrop are mounted on `document.body`, so the light defaults and `html[data-theme="dark"]` overrides for `--prod-*` variables are defined on `.prod-view`, `.prod-layer`, `.prod-tip`, `.prod-toast`, and `.prod-cmd-bd`.
- Tooltip ownership: the host page has a global title/data-tip tooltip binder. Production owns its artifact-style `data-prod-tip` layer, so the global binder opts out for `.prod-view`, `.prod-layer`, `.prod-tip`, `.prod-toast`, and `.prod-cmd-bd`. This prevents duplicate or misplaced dark host pills.
- Document keyboard listener: Production installs one document-level key listener scoped by `?prod=1` and `#prodRoot`. It handles Escape, command palette open, row focus, Enter-open, and guarded picker shortcuts without touching other SyncView tabs.
- Overlay z-index map: `prodLayer` uses `9999`, `prodToast` uses `10000`, and `prodTip` uses `10001`, matching the artifact's body-mounted overlay ordering while staying above the embedded tab.
- History API: Production owns only `?prod=1` URLs plus `team`, `view`, `issues`, `client`, `d`, and `batch` query params. It uses `history.pushState`/`replaceState` without touching runtime flags or any backend state.
- Native-write boundary: supported status, comment, due-date, and assignee affordances first pass `_prodCanWrite()` and then use the authenticated `_prodGatewayWrite()` path. Linear-authoritative, missing/malformed authority, unsigned/incompatible-role, inactive/unsupported, and every unimplemented mutation state routes to `_prodReadonlyGuard()` without changing adapter state or sending a write. The bounded active-TEST override is derived from the target row; callers cannot request legacy parity.

## Port Deltas

- Typography remains the host SyncView type scale by owner decision on 2026-07-06. Structure and behavior follow the artifact; font sizing is intentionally not pixel-copied.
- Live deep links and event reads require the database deliverable id, so adapter issues retain live `id` values and expose `displayId` for the artifact-style visible issue label.
- `_prodDeliverableLive()` filters rows whose `linear_raw` carries Linear webhook delete/archive markers before `_prodAdapter()` shapes issues. This is a wired data-layer PORT-DELTA: the standalone artifact has no Supabase mirror-delete payload to interpret. A `canceledAt` marker does NOT hide a row: canceled is a visible status key (Linear renders a Canceled group in project and All views); only archive/delete markers make a row dead.
