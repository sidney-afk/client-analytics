# Quiz Edge Functions: bounded source review (2026-09-26)

Scope: `supabase/functions/quiz-capture/index.ts` and
`supabase/functions/quiz-leads-list/index.ts` at `origin/main@3f5bd46e`.
This is a source-only review of input checks, error handling and response
contracts. No endpoint was called, no live data or function version was
inspected, and no function, migration or deployment was changed. The capture
flag/rate-log and the list route's admin check are present in source; this
review does not propose changing either authorization boundary. Findings below
are proposals, not observed production failures.

| Priority | Source evidence | Consequence and proposal |
|---|---|---|
| High — retry can replace a response | `quiz-capture/index.ts:114-115` accepts any nonempty trimmed `response_id`; `:160-165` upserts on that ID and always replies `{ok:true,response_id}`. The [table contract](../../migrations/2026-08-24-quiz-responses.sql#L25-L27) instead says a retry returns `duplicate:true`; the ID is unique at lines 52-53. [Supabase's upsert reference](https://supabase.com/docs/reference/javascript/upsert) confirms that `onConflict` overwrites an existing row by default. | A caller reusing an ID can replace the stored answer/contact fields, and a retry is indistinguishable from a first save. Keep the first accepted payload immutable, return an explicit duplicate result, and test identical and conflicting retries with synthetic data. |
| Medium — structured input has no application byte/shape bound | `quiz-capture/index.ts:106-112` reads and parses the whole request; `:122-125` limits only the number of top-level answer keys; `:149-152` passes `answers` and `result_scores` through when `typeof` is `object`, including arrays and arbitrarily nested values. | A small number of keys can carry a very large or malformed JSON value. Set an explicit request-size ceiling and validate plain-object answer/score keys and value types against the quiz contract before rate logging or writing. Keep a stable validation error code. |
| Medium — downstream HTTP refusal is treated as success | `quiz-capture/index.ts:86-99` awaits `fetch` but never checks its HTTP status; thrown errors are swallowed. `:163-165` then returns success after the row write. | A non-2xx handoff has no receipt or retry path in this function, so downstream nurture delivery cannot be inferred from the capture success. Preserve success for the durable response row, but record a bounded handoff outcome and provide a separately controlled retry/reconciliation path. Do not log contact payloads. |
| Medium — list count may describe only the returned page | `quiz-leads-list/index.ts:35-57` makes one `select("*")` with no range and sets `count` to the returned array length. The [endpoint contract](../truth/ENDPOINTS.md#L182-L186) says every submission; the browser likewise uses `leads.length` as Total (`src/index/320-kasper-dashboard-replies.js.part:1140-1145`). Supabase documents a [configurable maximum returned-row setting](https://supabase.com/docs/reference/python/select). | Once the result exceeds that setting, the endpoint can present a partial list as complete. Add explicit page/cursor and `has_more` or a verified total; make the UI distinguish a page count from a corpus total. This is a future-size risk, not a measured truncation. |
| Low — method and database-error shapes differ from the declared API | `quiz-leads-list/index.ts:16-19` advertises GET/OPTIONS, but `:27-36` runs the read for any non-OPTIONS method. Both functions return raw database `error.message` on 500 (`quiz-capture/index.ts:160-161`; `quiz-leads-list/index.ts:35-37`), while validation/auth failures use stable codes. | Return 405 for unsupported list methods and keep client-facing failures in one stable `{ok:false,error:<code>}` shape, with diagnostic detail confined to protected logs. |

Suggested verification for a separate implementation PR: fully local function
tests with mocked database and fetch calls for conflicting retries, oversized
or array-shaped answers, a downstream 500/timeout, a list above the configured
row limit, unsupported methods and stable error bodies. Repeat an exact release
readback only if an owner later authorizes deployment; this report supplies no
hosted proof.
