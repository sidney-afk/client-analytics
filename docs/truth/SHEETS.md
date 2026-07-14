# Google Sheets — current truth

> Last verified: 2026-07-11 @ ae8a492
> Live facts from `docs/audits/2026-07-05-sheets.md` (verified 2026-07-05) unless noted.
> Sheets change outside git and outside CI — treat every claim here as spot-verify-first.

## What the app reads

- The app fetches sheet tabs via **unauthenticated gviz CSV** — anything in those tabs is
  effectively public. **Never add secrets to sheet tabs** (see hazard below).
- Tabs in use: **Clients Info** (12 cols A–L), **Video Editors** (2 cols: name, email —
  **no `slack_user_id` column**; urgent-Slack resolution uses a hardcoded fallback map inside
  n8n), **Social Media Managers**, plus a calendar-mirror workbook (63 tabs at last count).

## Roster truth

- Effective app roster = sheet roster + seed-only names (33 = 29 + 4 at last count); some
  sheet-only clients are invisible to parts of the app; at least one SMM+Linear-only client
  is invisible to the app entirely; a confirmed duplicate slug pair exists
  (`terrinamar`/`terrinammar`).
- Client-name normalization is `wlNormalizeClient()` (strips accents + leading "dr.",
  maps "and"/&→'&') — any system that joins on client names must use it exactly.
- Frontend allowlists that shadow the sheets: `WL_VIDEO_EDITORS`, `WL_ALLOWED_GRAPHICS`
  (hardcoded in `index.html`).

## Standing hazards

- **`client_review_token` must never be added** to Clients Info: this sheet is anonymously
  downloadable. Tokens already exist in service-role-only `client_access`; audit F33 blocks the
  old sheet-based D-31 mechanism. Fix direction: a staff-authenticated exact-client link builder,
  then re-issue links before flipping fail-closed.
- The Social Media Managers tab carries a `linear_api_key` column (7 per-SMM Linear API
  keys) — **publicly readable** via gviz. Rotation + removal owed.
