# Description image upload: source-only body bound review

Scope: `supabase/functions/description-image-upload/` at `origin/main` `3f5bd46e` on 2026-09-26. Draft #1707 already reviews `caption-prompts-save`, so this report does not repeat it. No function code changed, and no Edge Function, browser, database, or workflow was invoked.

## Finding

The upload promises a 4 MiB byte ceiling (`policy.mjs:17`, `docs/truth/ENDPOINTS.md:376-381`). In `index.ts:233-245`, the early check rejects only when a usable `Content-Length` exceeds that ceiling. An absent header becomes zero. The next step awaits `req.arrayBuffer()`, which buffers the complete request before `verifyImage` checks `bytes.byteLength` at `policy.mjs:603-607`. Thus a request with no usable length header can consume more than the policy's limit before receiving the expected `413`. This is an authenticated request path; the source does not show an oversized object being stored.

The offline test passes an already allocated `MAX_BYTES + 1` array to `verifyImage` (`test/description-image-upload.js:169-174`) and checks that authorization precedes `req.arrayBuffer()` (`:323-325`). Neither assertion covers how many request bytes the handler buffers when the length header is absent or understated. The source-level consequence is avoidable per-request memory use; any platform request cap or hosted impact is unverified.

## Proposed follow-up

After authorization, read the body with a running byte count and stop/cancel once it exceeds `MAX_BYTES`, returning the existing `413 image_too_large` response. Pass only a complete in-bound body to the unchanged image verifier. Add a fully mocked handler test with an absent length header and an over-limit stream that proves reading stops at the bound, plus a valid-image case. Keep the existing authorization order and byte/type checks. This report authorizes no deploy or live test.
