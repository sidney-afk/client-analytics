# SyncView Dark Mode

## Scope

Dark mode is staff-only and opt-in. Light mode remains the default and must remain visually unchanged.

Included staff surfaces: analytics/home, client detail analytics and charts, content calendar views, Samples New views, Samples Old views, Templates, Workload, Linear/intake, TikTok Upload, TikTok Pilot, Kasper queue/subtabs, Production preview (`?prod=1`), modals, toasts, dropdowns, search panels, tooltips, and scrollbars.

Excluded surfaces:

- Client-facing `?c=` links stay light. The theme toggle is hidden and `data-theme` is not applied.

## Rollback

User rollback: click the sun/moon toggle back to Light. The preference is per-browser in `localStorage`.

Code rollback: revert the dark-mode PR. No runtime flags, Supabase Edge Functions, migrations, n8n workflows, or save/write paths are part of this change.

## Palette

Existing app variables remain the primary contract. Dark mode is a `[data-theme="dark"]` override on `html`; light mode is the current `:root`.

| Token | Light | Dark | Used for |
|---|---:|---:|---|
| `--bg` | `#f4f4f2` | `#101114` | App background |
| `--white` | `#ffffff` | `#181a1f` | Primary surfaces/cards/inputs |
| `--surface-raised` | `#ffffff` | `#20232a` | Popovers, elevated cards |
| `--surface-hover` | `#f8f8f6` | `#242730` | Hover states |
| `--border` | `#e4e4e0` | `#343842` | Standard borders |
| `--border-light` | `#ededea` | `#282c34` | Subtle dividers |
| `--text-primary` | `#111110` | `#f4f6f8` | Main text |
| `--text-secondary` | `#6b6b67` | `#c2c7cf` | Secondary text |
| `--text-muted` | `#b4b4ae` | `#aeb6c2` | Tertiary/help text |
| `--text-inverse` | `#ffffff` | `#ffffff` | Text on strong/accent fills |
| `--focus-ring` | `#6c5ce7` | `#8b7cf6` | Focus/selection rings |
| `--toast-bg` | `#111110` | `#20232a` | Toast surface |
| `--toast-color` | `#ffffff` | `#f4f6f8` | Toast text |
| `--selection-bg` | `#d8d8d4` | `#343842` | Text selection |
| `--scrollbar-thumb` | `#d8d8d4` | `#343842` | Scrollbar thumb |
| `--scrollbar-thumb-hover` | `#c4c4bf` | `#4a5060` | Scrollbar thumb hover |

Platform colors keep brand identity while dark mode swaps pale fills to dark tints:

| Token group | Light | Dark |
|---|---|---|
| Instagram | `--ig`, `--ig-light`, `--ig-mid`, `--ig-dark` | brand pink plus dark rose surfaces |
| TikTok | `--tt`, `--tt-light`, `--tt-mid`, `--tt-dark` | neutral/cyan accents plus dark neutral surfaces |
| YouTube | `--yt`, `--yt-light`, `--yt-mid`, `--yt-dark` | red accents plus dark red surfaces |

Status colors use the same scheme in light mode. In dark mode, operational status pills use brighter mid-tone fills with near-black text so states stay easy to distinguish on dark cards without becoming neon.

Calendar status pills use dedicated `--cal-status-*` variables. Light values map to the original status palette; dark values use vibrant fills with black text so component pills, dropdown rows, review pills, title-status squares, and TikTok queue pills stay distinct against dark cards. Notes notifications use `--cal-notes-*` variables for the unread dot, count badge, and active/open state.

## Variable Map

Hardcoded colors are migrated into variables in three layers:

1. Existing semantic variables: reusable app-wide roles such as `--bg`, `--white`, `--border`, `--text-primary`, `--text-muted`, `--ig-*`, `--yt-*`, `--up-*`, and `--dn-*`.
2. New semantic variables: dark-mode-specific roles such as `--surface-raised`, `--surface-hover`, `--text-inverse`, `--focus-ring`, `--shadow-sm`, `--chart-*`, `--theme-toggle-*`, `--toast-*`, `--selection-bg`, and `--scrollbar-*`.
3. Generated legacy tokens for one-off colors that do not yet have a clean semantic owner:
   - `--sv-bg-<literal>` for background/fill colors.
   - `--sv-fg-<literal>` for text/icon/stroke colors.
   - `--sv-border-<literal>` for borders/outlines/dividers.
   - `--sv-shadow-<literal>` for shadows and overlays.

Examples:

| Literal | Token |
|---|---|
| `#fef3c7` used as a background | `--sv-bg-fef3c7` |
| `#92400e` used as text | `--sv-fg-92400e` |
| `#fca5a5` used as a border | `--sv-border-fca5a5` |
| `rgba(0,0,0,0.08)` used as shadow | `--sv-shadow-rgba-0-0-0-0_08` |

The generated tokens are a compatibility bridge for this single-file app. New work should prefer semantic tokens instead of adding more generated one-offs.

In dark mode, generated background rgba tokens that encoded white or near-white light overlays are retinted to dark surface RGB with their original alpha preserved. Generated white border rgba tokens are retinted to the dark border RGB for subtle outlines. Foreground white rgba tokens intentionally remain white because they are used as text/icons over dark media and analytics panels, not as surface overlays.

## Charts

Canvas charts cannot rely on raw CSS `var()` strings in every Chart.js field. Chart colors are resolved through a tiny helper that reads CSS variables from `document.documentElement`, so chart axes, gridlines, tooltips, point borders, and platform series follow the active theme.

## Verification Notes

Light-mode screenshots are compared against the pre-change baseline with the new header toggle region masked. Stable staff surfaces should have no pixel changes outside that intentional header control. Dynamic live-data surfaces such as Workload may show timestamp/count drift; client-facing `?c=` links are verified as light-only boundaries. Production preview is verified in both light and dark against its locked dual-theme artifact.

Dark-mode contrast is audited in Playwright by walking visible text nodes and checking computed foreground/background contrast. Normal text must meet 4.5:1; large text must meet 3:1.

## Permanent Color Gate

`npm test` includes a no-hardcoded-colors scan. It fails on hex/rgb/hsl literals outside:

- variable definition blocks (`:root`, `[data-theme="dark"]`);
- Production preview's locked dual-theme UI (`--prod-*` tokens, `html[data-theme="dark"] .prod-*` overrides, and `.prod-*` selectors);
- Production preview's artifact-locked `_prod*` render region, bracketed by `no-hardcoded-colors: allow-start` / `allow-end` comments;
- documented validation regexes or dynamic color expressions that are not literal UI colors.

The `_prod*` render-region exemption is intentional. PR #689 ports Linear's exact status and project colors from `docs/syncview-design/SyncView.html` per spec §10.8. Production preview now follows the staff theme toggle using its own artifact-locked `--prod-*` palette: light is the default, and dark is applied under `html[data-theme="dark"]` on every Production overlay mount. Client-facing `?c=` links remain excluded from theme application.

This keeps future staff-facing UI automatically themeable.
