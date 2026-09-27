# Thumbnail revision Edge routes: source review

**Scope:** `supabase/functions/thumbnail-revision-read/index.ts` and
`supabase/functions/thumbnail-revision-scan/index.ts` at `origin/main`
`3f5bd46e6086911ae2a7bb0d32507f03d5a44da8` on 2026-09-26. This is a
proposal-only review. No endpoint, database, Drive API, scheduler, or browser was
called; no function or runtime code was changed. The reader's staff/client
credential requirements and the scanner's dedicated signature must remain.

The route inventory is `docs/truth/ENDPOINTS.md`; the feature contract is
`docs/features/THUMBNAIL_REVISION_HISTORY.md`. The separate folder resolver's
known F79/F80 authorization and compare-and-set findings are excluded. Existing
`test/thumbnail-revision-history.js` and `test/thumbnail-revision-scheduler.js`
cover source contracts and scheduler behavior, not the request branches below.

| Source finding | Exact evidence and consequence | Proposed follow-up |
|---|---|---|
| An unsigned request can distinguish active from inactive client scope when the feature allows that scope. | `thumbnail-revision-read/index.ts:229-244` checks the flag and reads the active `clients` row before calling `authorize`. An absent/inactive row throws `inactive_client`, mapped to 403 at lines 152-160; an active row with no credentials reaches `credentials_required`, mapped to 401. This conditional status difference exposes one bit of client status without proving a principal. This is source reasoning, not a hosted probe. | Validate the same staff key or exact client token before exposing target-client status, and use one public denial for unauthenticated requests. Preserve the current client/card checks after authorization. Add isolated active/inactive × missing/invalid/valid credential tests. |
| An invalid explicit scanner scope can silently become a broader scan. | `thumbnail-revision-scan/index.ts:69-85` normalizes `client`, chooses `source_id || id`, and rejects only a **nonempty** source ID without a client. A supplied client that normalizes to empty or a supplied empty/falsy source ID can therefore become an omitted scope. When mode is `on`, the call reaches `scanPendingThumbnailRevisions` at lines 97-111; `supabase/functions/_shared/thumbnail-revisions.ts:764-785` converts empty scope values to null for backfill and skips the client/source filters. The response can be `ok:true` for a batch other than the one the caller meant to target. | Distinguish omitted scope fields (the scheduled broad scan) from supplied-but-invalid fields. Reject empty/invalid supplied client or source ID with 400 before any backfill/query; keep the authenticated scheduled no-scope request valid. Add mocked request tests for both targeted mistakes and the deliberate broad scheduler call. |

**Limits:** These are reachable source branches, not measured live requests or
confirmed incidents. No claim is made about current client counts, scan outcomes,
or deployed byte identity. Any fix needs offline request tests and a separate
release decision.
