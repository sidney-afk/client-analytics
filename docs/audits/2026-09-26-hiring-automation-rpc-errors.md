# Hiring automation: source-only RPC error response review

Scope: `supabase/functions/hiring-automation/index.ts` at `origin/main` `3f5bd46e` on 2026-09-26, compared with the staff-facing `hiring-applications` function. No function code was changed; no Edge Function, workflow, database, or provider was invoked.

## Finding

`safeRpcCode` accepts a fixed set of known RPC error messages and otherwise returns `automation_unavailable` (`hiring-automation/index.ts:187-198`). The shared `rpc` wrapper assigns **HTTP 422 to every returned RPC error**, including that fallback (`:200-204`), and the handler sends the assigned status unchanged (`:403-424`). An unrecognized database error therefore reaches the caller as `422 {"ok":false,"code":"automation_unavailable"}`. This is a source-derived response path, not an observed provider or hosted failure.

The same bridge uses 503 for missing service configuration and unexpected thrown errors, and 502 for malformed RPC results (`:181-184, 243-244, 419-423`). The staff-facing hiring function also maps unknown RPC errors to `503 service_unavailable` (`hiring-applications/index.ts:402-425`). The bridge's 422 response can make an unavailable dependency look like a rejected request; whether any n8n caller retries by HTTP status has not been verified. The existing offline bridge contract checks the allowed RPCs and key boundary but does not assert unknown-error status (`test/hiring-automation-contract.js`).

## Proposed follow-up

Keep the safe public error code and the existing known domain refusals, but return 503 when an RPC error does not match that allowlist. Add fully mocked tests for one known refusal and one unrecognized RPC error, asserting both code and HTTP status without a database or workflow call. Check the n8n caller's retry policy before changing a deployed response. This report authorizes no live test or deploy.
