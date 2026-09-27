# Settings writer Edge Functions: bounded source review (2026-09-26)

Scope: `supabase/functions/templates-save/index.ts` and
`supabase/functions/caption-prompts-save/index.ts` at
`origin/main@3f5bd46e`. This is a source-only review of save/error responses,
input checks and cross-request behavior. No endpoint, database, workflow or
deployed version was called or changed. Both functions call the shared
`authorizeBrowserWrite` before mutation; this review does not propose changing
that authorization boundary. Findings are proposals, not hosted observations.

| Priority | Source evidence | Consequence and proposal |
|---|---|---|
| High — saved row can be reported as a failed save | `templates-save/index.ts:75-103` upserts the setting, then separately inserts `settings_events`, throwing on an event error. `caption-prompts-save/index.ts:52-79` has the same order. The Templates caller requeues a patch after any failed response (`src/index/050-market-briefs.js.part:1480-1508`). | If the event insert fails after the row succeeds, the API returns 500 even though the setting changed; a later retry can write it again. Make row and event one transaction, or return an explicit durable outcome that distinguishes an applied setting from a refused write. Test an event failure after a successful row write with local mocks before choosing retry behavior. |
| Medium — concurrent template patches can erase each other | `templates-save/index.ts:64-84` reads the whole `data` JSON object, merges one patch in memory, then upserts the whole object without a version precondition. The browser's in-flight guard (`src/index/050-market-briefs.js.part:1465-1475`) serializes only its own queue. | Two tabs can read the same old object, update different keys, and each return success while the later full-object upsert drops the earlier key. Apply a patch atomically in the database or require a version/CAS precondition and a defined 409/reapply path. Preserve the existing arbitrary-key template contract; test two simultaneous disjoint patches locally. |
| Medium — malformed bodies and coerced values have no stable validation boundary | Both functions cast parsed JSON to a record without checking for `null` or arrays (`templates-save/index.ts:51-57`; `caption-prompts-save/index.ts:39-43`). A JSON `null` reaches property access and the 500 catch; an invalid Templates `patch` becomes `{}` at `templates-save/index.ts:36-45`, while a non-string Caption `prompt` is stringified. Neither function sets an application value-size cap. | Reject malformed top-level bodies and wrong field types with stable 400 codes before authorization/write work; distinguish an intentionally empty patch from an invalid patch. Bound keys/value sizes without replacing the intentionally flexible template field set. |
| Low — internal exception text becomes a client-facing error | Both 500 catch paths return `e.message` or `String(e)` (`templates-save/index.ts:100-103`; `caption-prompts-save/index.ts:76-79`), while auth errors use stable codes. | Keep a stable `{ok:false,error:<code>}` response and put diagnostic detail only in protected logs. Preserve the current authorization status mapping. |

Suggested verification for a separate implementation PR: fully local mocked
function tests for row-success/event-failure, concurrent disjoint patches,
`null`/array/malformed JSON, non-string fields, oversized values and stable
error bodies. The existing source guards
`test/a4-settings-edge-source.js` and `test/b4-write-attribution-source.js`
assert route and attribution presence, not these behavioral outcomes. This
report supplies no deployment or live-write proof.
