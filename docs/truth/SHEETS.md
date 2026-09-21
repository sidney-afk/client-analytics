# Google Sheets — current truth

**Corrected 2026-09-21:** Linear was retired as a work surface at the 2026-09-20 cutoff. Staff work in SyncView; normal outbound writes and legacy parity are off. The inbound webhook remains, and STEP 7 credential revocation is still owner-gated. Earlier Linear topology, provider-write and authority statements below are retained for provenance and are superseded by this cutoff state. Legacy symbols, IDs, stored rows and endpoint definitions may remain without being live work paths. This correction does not re-verify unrelated counts, versions or historical findings. See [cutoff record](../ops/LINEAR_CUTOFF_RUNBOOK.md).

> Last verified: 2026-09-18 @ 043369b5 (re-verification of the same claims the 2026-08-19 stamp covered — the three `*_ef_clients` rosters, the duplicate-slug claim and the code anchors — plus the live Clients Info header row. Three facts had drifted; they are corrected in the block directly below, not silently. Sheet tabs other than Clients Info, and the Video Editors and Social Media Managers column claims, were NOT re-read this pass.)
>
> **Re-verification 2026-09-18, results and corrections to claims further down this page:**
> - `*_ef_clients` rosters: all three present and **still identical to one another** (the gate). They now hold **43 slugs each, not 36** — the "36 slugs each" line under *Roster truth* is superseded.
> - Duplicate-slug claim: **holds.** One matching slug in `clients`, active, `kind=client`, one entry in each of the three rosters.
> - Code anchors: `wlNormalizeClient()`, `WL_ALLOWED_GRAPHICS` and the `client-review-link` Edge Function still exist on main. **`WL_VIDEO_EDITORS` does not**: it was removed from `index.html` at `87283f92` (2026-09-13). The *Frontend allowlists* line under *Roster truth* is superseded for that one name.
> - Clients Info header, read live through the same unauthenticated gviz CSV the app uses: **14 named columns**, but **`creative_channel_id` is column K (11th), not N**. Live order: `client_name`, `email`, `competitors`, `keywords`, `specific_keywords`, `content_description`, `instagram_handle`, `tiktok_handle`, `youtube_channel_id`, `slack_channel_id`, `creative_channel_id`, `roam_channel_id`, `upload_post_profile`, `postforme_account_id`. The header ends in `postforme_account_id`, and gviz returns 13 further blank header cells. The app reads this tab by header name, so the position does not break it; anything that reads it by column letter would. The "(N)" position and the A–N list order under *What the app reads* are superseded.
> - Previously verified 2026-08-19 @ f05c3132; that scope note is kept verbatim below.
>
> Previous stamp (2026-08-19 @ f05c3132) (Supabase-side re-verification: the three `*_ef_clients` rosters, the duplicate-slug claim, and the four code anchors below. Sheet-tab shapes and column counts were NOT re-read this pass and retain their 2026-07-05 audit source)
> **Scoped Clients Info column-count correction (2026-08-25 @ 1a15097):** live-read via two
> independent paths (direct Sheets API `values.get` and Drive's content index) during the
> §19 creative-channel-finalizer incident (`docs/CLIENT_LIFECYCLE_MAP.md`). The "12 cols A–L"
> claim below was already stale before this pass — the live header row was 13 columns
> (A–M) even before this change, including `upload_post_profile` (L), which was never listed
> here. This edit adds the 14th, `creative_channel_id` (N), and corrects the count/list to
> match what was actually read. No other claim in this file was re-checked this pass.
> Live facts from `docs/audits/2026-07-05-sheets.md` (verified 2026-07-05) unless noted.
> Sheets change outside git and outside CI — treat every claim here as spot-verify-first.

## What the app reads

- The app fetches sheet tabs via **unauthenticated gviz CSV** — anything in those tabs is
  effectively public. **Never add secrets to sheet tabs** (see hazard below).
- Tabs in use: **Clients Info** (14 cols A–N, live-verified 2026-08-25: `client_name`,
  `email`, `competitors`, `keywords`, `specific_keywords`, `content_description`,
  `instagram_handle`, `tiktok_handle`, `youtube_channel_id`, `slack_channel_id`,
  `roam_channel_id`, `upload_post_profile`, `postforme_account_id`, `creative_channel_id`),
  **Video Editors** (2 cols: name, email —
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

- Effective app roster = sheet roster + seed-only names (33 = 29 + 4 as of the 2026-07-05
  audit; the sheet side was not re-read on 2026-08-19); some sheet-only clients are invisible
  to parts of the app; at least one SMM+Linear-only client is invisible to the app entirely.
- The three `*_ef_clients` rosters hold **36 slugs each and are identical to one another**
  (verified 2026-08-19; the gate is equality between them, never a count -- see
  `docs/ops/PRE_FLIP_HEALTH_CHECK.md` item 6).
- **The `terrinamar`/`terrinammar` duplicate slug pair is RESOLVED on the Supabase side**
  (verified 2026-08-19). Only `terrinammar` exists: it is the sole match in `clients` for
  `slug like *terri*`, active, `kind=client`, and the sole match in the enrollment rosters.
  The earlier text asserted the pair as a standing condition; it is no longer one there.
  Whether the source SHEET still carries both spellings was not re-read this pass.
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

- **#850 merged containment:** the SPA strips `client_review_token` if it appears in a fetched
  or cached public row, and signed-in staff copy actions request one scoped token from the
  already-live authenticated `client-review-link` v2 function at copy time. Real-client enrollment
  still requires link re-share/current-token and documented fail-closed proof; the issuer is not
  redeployed unless its source changes.
- The Social Media Managers tab carries a `linear_api_key` column (7 per-SMM Linear API
  keys) — **publicly readable** via gviz. Rotation + removal owed.
