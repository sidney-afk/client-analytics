# Reorder Edge Functions: bounded source review (2026-09-26)

Scope: `supabase/functions/calendar-reorder/index.ts` and
`supabase/functions/sample-review-reorder/index.ts` at `origin/main@3f5bd46e`.
This is a source-only review of validation, error handling, and response shape.
No function was called or changed, and no live write or deploy was made. Both
routes call `authorizeBrowserWrite` before their database updates (calendar
lines 73-80; sample reviews lines 74-81); preserve that boundary. These are
proposals, not observed hosted failures.

| Priority | Source evidence | Consequence and proposal |
|---|---|---|
| High: a refused batch can leave a partial reorder | Each route updates one row per loop iteration, throws on a later row error, and inserts events only after the loop (`calendar-reorder/index.ts:80-105`; `sample-review-reorder/index.ts:81-107`). The catch then returns 500 (`calendar-reorder/index.ts:109-116`; `sample-review-reorder/index.ts:116-123`). The browser treats an error as a failed reorder (`src/index/180-calendar-native-post-media.js.part:2170-2176`; `src/index/280-samples-cards-notes.js.part:205-210`). | Earlier rows may already have new positions when a later update or event insert fails. Use a single transaction for row updates and events, or return an explicit partial outcome and reconcile from a fresh read before retry. Prove row-two and event-insert failures with local mocks/disposable data. |
| Medium: invalid input is reported as a server fault | Both routes parse JSON and call `parsePayload` inside one catch (`calendar-reorder/index.ts:64-66,109-116`; `sample-review-reorder/index.ts:65-67,116-123`). `null`, malformed JSON, missing client/items, or a bad item therefore reaches a 500 response. Both convert `order_index` with `Number(...)`, which accepts `null` and an empty string as zero (`calendar-reorder/index.ts:44-50`; `sample-review-reorder/index.ts:45-51`). | Return a stable 400 code for malformed or missing fields, and require a deliberate finite numeric representation before writing. Keep authorization refusals on their existing status/code path. |
| Medium: batch size and duplicate IDs are unbounded | Both parsers require a nonempty `items` array but set no maximum or unique-ID check (`calendar-reorder/index.ts:42-52`; `sample-review-reorder/index.ts:43-53`). Each matching update increments `updated`, so the same ID twice counts twice (`calendar-reorder/index.ts:80-89`; `sample-review-reorder/index.ts:81-90`). Both browser callers compare that number with the requested item count (`src/index/180-calendar-native-post-media.js.part:2175`; `src/index/280-samples-cards-notes.js.part:205`). | Reject duplicate IDs and bound batch length before any write. Define `updated` as distinct matched rows, and test a repeated ID and an oversized batch offline. |

Suggested separate implementation proof: fully local mocked requests for invalid
JSON, `null`, empty `order_index`, duplicate IDs, second-row failure, and event
failure, followed by a transaction-backed test against disposable PostgreSQL
if the design changes. Existing source guards do not prove these behaviors.
