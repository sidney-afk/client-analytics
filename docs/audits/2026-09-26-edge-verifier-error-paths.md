# Verifier error paths: source review (2026-09-26)

Scope: `supabase/functions/key-verify/index.ts` and
`supabase/functions/client-token-verify/index.ts` at `main@3f5bd46e`. This is a
source-only proposal. No hosted call, failure injection, schema change, or
deployment was made. The existing F87 entry in
`docs/independence/CUTOVER_AUDIT_2026-07-13.md` remains the owning register.

| Source path | What the code does | Why it matters | Proposal |
| --- | --- | --- | --- |
| Both `authMode` helpers | Each awaits a `syncview_runtime_flags` `.maybeSingle()` query but reads only `data`, discarding `error`; missing, failed, or malformed mode becomes `permissive`. | In `client-token-verify`, `allowed = valid || (!strict && mode !== "enforced")`. If the flag read returns an error while enforcement is intended, a non-strict request with an invalid or missing token can receive `ok: true`. Strict entry still requires a valid token. In `key-verify`, the reported mode can be wrong, but a role key and compatible active member are still required. | Treat query errors and an absent or unrecognized mode as unavailable, with an explicit denial/error outcome. Preserve the strict-entry contract. Test a returned `{ data: null, error }` separately from a thrown request failure. |
| Both audit helpers | `logAuth` and `logAttempt` await `.insert(...)` and discard its returned `error`. | A database-reported insert failure can leave a normal verifier response with no audit event. F87 currently says an audit failure returns 500; that is only true if the call throws, not if it resolves with an `error`. This is a source-level contract gap, not evidence of missing live records. | Decide whether each response must fail closed when the audit insert returns an error; handle that result explicitly and add offline success/error/throw cases. Keep client-facing denials uniform. |
| Both request parsers | `req.json().catch(() => ({}))` is cast to an object without validating its shape. | Valid JSON `null` reaches `body.key` or `body.slug` and throws, so an invalid payload produces `500 verify_failed` instead of a controlled `400` response. Malformed JSON is silently treated as `{}`. | Validate a plain-object body before field access; test `null`, arrays, malformed JSON, and expected empty-object behavior. |

Supabase's JavaScript reference documents `data` and `error` result fields for
[`maybeSingle`](https://supabase.com/docs/reference/javascript/using-modifiers-maybesingle)
and [`insert`](https://supabase.com/docs/reference/javascript/insert); its
[error-handling guide](https://supabase.com/docs/guides/api/handling-errors-in-supabase-js)
shows checking returned errors. The conclusions above are inferences from those
return contracts and the checked-in source. They do not establish that a flag
or audit read/write has failed in the hosted system.

Before any behavioral fix, the owner should confirm the intended fail-closed
response for the legacy non-strict client-link path and audit outages, then
review both verifiers together so they cannot disagree about mode or error
semantics. No change to `auth_enforcement` is proposed here.
