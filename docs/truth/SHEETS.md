# Google Sheets — current truth

> Last verified: 2026-07-20 @ 09e3dd6 (Metrics receipt schema and first scheduled production rows; other statements retain their dated sources)
> Live facts from `docs/audits/2026-07-05-sheets.md` (verified 2026-07-05) unless noted.
> Sheets change outside git and outside CI — treat every claim here as spot-verify-first.

## What the app reads

- The app fetches sheet tabs via **unauthenticated gviz CSV** — anything in those tabs is
  effectively public. **Never add secrets to sheet tabs** (see hazard below).
- Tabs in use: **Clients Info** (12 cols A–L), **Video Editors** (2 cols: name, email —
  **no `slack_user_id` column**; urgent-Slack resolution uses a hardcoded fallback map inside
  n8n), **Social Media Managers**, plus a calendar-mirror workbook (63 tabs at last count).

## Analytics metrics

- `Metrics` now uses columns A–Q; Q is `analytics_receipt`. Each new CLIENTS METRICS row carries a
  public-safe `syncview.analytics.receipt.v1` JSON value with one typed state per platform:
  `success`, `genuinely_empty`, `provider_failed`, or `not_configured`. It stores controlled error
  classes rather than raw provider messages.
- The first scheduled production run after activation wrote one row for every one of the 29 roster
  clients, with 29 parseable terminal receipts, 29 unique client keys, no duplicate/missing name,
  and zero failed writes. A provider failure exactly reused a last-good row whose affected values
  were already legitimate zeros; successful numeric zeros remained fresh. No `genuinely_empty`
  receipt occurred in that live run; its evidence remains the pinned pre-publish execution
  `286168`. Because the app reads Sheets through unauthenticated gviz CSV, receipt fields must
  remain free of secrets and raw provider payloads.

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

- **Project Central's active Sheet API is an unauthenticated destructive replace path (F123).** Its
  three source reads continue independently, so one failed tab can become a valid-looking partial
  tree. Save then clears all three live sheets before validating or reappending, with no staging,
  revision/CAS, transaction, idempotency, or restore receipt. Empty/partial/stale/concurrent saves
  can erase the hierarchy. Require role/scope auth and an atomically validated staged replacement;
  never use the current path as a recovery tool.

- **`client_review_token` must never be added** to Clients Info: this sheet is anonymously
  downloadable. Tokens already exist in service-role-only `client_access`; audit F33 blocks the
  old sheet-based D-31 mechanism. Fix direction: a staff-authenticated exact-client link builder,
  then re-issue links before flipping fail-closed.

- **#813 candidate containment:** the SPA strips `client_review_token` if it appears in a fetched
  or cached public row, and signed-in staff copy actions request one scoped token from the
  already-live authenticated `client-review-link` v2 function at copy time. Release still requires
  the guarded caller merge, link re-share, and documented fail-closed proof; the issuer is not
  redeployed unless its source changes.
- The Social Media Managers tab carries a `linear_api_key` column (7 per-SMM Linear API
  keys) — **publicly readable** via gviz. Rotation + removal owed.
