# Onboarding standard list and fallback capture: source-only review

Scope: `onboarding-list` and `onboarding-capture` at `3f5bd46e6086911ae2a7bb0d32507f03d5a44da8` (`origin/main` on 2026-09-26). This is a proposal, not a runtime finding. No endpoint was called and no function, database, or workflow was changed. The separate full/legacy and AI/quiz reader reviews are in draft PRs #1724 and #1727.

## Standard list can report a partial result as complete

`supabase/functions/onboarding-list/index.ts:47-62` makes one newest-first `select("*")` without a range, an independent total, or a completeness flag, then returns `ok:true` and `count:submissions.length`. [Supabase's API configuration reference](https://supabase.com/docs/guides/local-development/cli/config#api-max_rows) gives a configurable maximum number of returned rows (1,000 by default), and [its JavaScript reference](https://supabase.com/docs/reference/javascript/using-modifiers-range) documents pagination with `range()`. If the standard table exceeds that configured cap, older rows are omitted while the response still looks complete. The standalone client-profile caller builds its onboarding-button slug index from this list (`src/index/060-templates-filming.js.part:225-275`), so a missing older row can hide that button. This is a conditional source inference; no current row count or live truncation was measured.

Follow-up: choose a bounded, least-field lookup or prove every page has been read before returning a complete count/index. Use a synthetic result over the configured cap to test that an omitted tail is never reported as complete. Preserve the existing staff-key gate and F77/F85 read-boundary requirements.

## A late draft can replace a captured submission marker

The browser sends draft sync without waiting for its result (`src/index/100-onboarding-staff-controls.js.part:777-793`), and sends the `submitted` copy without waiting after primary success (the same file, lines 712-719). Both use the same submission ID. `supabase/functions/onboarding-capture/index.ts:45-78` accepts the caller's `kind` and performs an unconditional [upsert](https://supabase.com/docs/reference/javascript/upsert) on that ID, replacing `kind`, `payload`, `note`, and `created_at`; it then returns `200 {ok:true,id,kind}` (line 97). If an earlier draft request reaches the server after the submitted copy, the stored row becomes `draft` again and the late request receives a success receipt. This is a source-inferred race, not an observed loss; the primary table may still hold the submission. It makes the existing F81 conditional-update and immutable-creation requirements concrete.

Follow-up: keep terminal kinds from being demoted by a draft, preserve the original creation timestamp, and test reversed draft/submitted completion order with synthetic IDs and payloads. Keep the public capture path available to legitimate clients.

The optional alert has a separate receipt gap: `onboarding-capture/index.ts:80-97` awaits `fetch` but never checks the HTTP status, so a non-2xx alert response can still produce capture `ok:true`. The stored-copy receipt should remain distinct from alert delivery or staff acknowledgement, as the F110/F111 contract already requires. A focused synthetic non-2xx alert test would cover this without contacting Slack.
