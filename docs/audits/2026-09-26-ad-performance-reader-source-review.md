# Ad performance reader: source review (2026-09-26)

Scope: `supabase/functions/kasper-ad-performance-read/index.ts` at
`main@3f5bd46e`. The system map calls this an app-called candidate that is
**not yet live**. This is a proposal only; no endpoint, private row, or hosted
setting was read. The handler already requires an admin role key before it
creates the service-role client, and its own log records counts rather than
lead content. Preserve both properties.

| Source path | Conditional consequence | Proposed follow-up |
| --- | --- | --- |
| Five `.select(...).order(...)` calls have no `.range(...)`, count, or completeness check. | Supabase's [documented project row cap](https://supabase.com/docs/reference/javascript/v1/select) defaults to 1,000 and is configurable. If any source table exceeds the configured cap, the handler returns `ok: true` with only the first page. `summary` is computed over the returned daily rows and `campaigns` over returned campaign rows, so both can look complete while omitting history. The lead arrays can also silently omit records. No current table count or hosted cap was checked. | Define a bounded page/aggregate contract, then test a mocked cap boundary and page two. If totals need all history, compute them in a database aggregate rather than over one response page. Keep the role gate and lead-field minimization in scope. |
| Each query error returns its raw `error.message` as a `500` response. A rejected query promise or missing service configuration has no surrounding catch. | A caller can receive database-specific error text in one path and a platform-generated failure in another, rather than one stable JSON error contract. The role gate still limits the caller; this is not evidence of public access. | Map database failures to stable error codes, log private detail server-side without lead values, and test returned-error, rejected-promise, and missing-config cases offline. |

Before any release or code fix, confirm the intended history window and response
shape with the owner. The repo source does not establish live row volume,
effective API cap, or a hosted deployment of this candidate function.
