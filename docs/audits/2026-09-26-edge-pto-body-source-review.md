# PTO Edge request-body response: source-only proposal

Scope: `supabase/functions/pto/index.ts` at `3f5bd46e6086911ae2a7bb0d32507f03d5a44da8` (`origin/main` on 2026-09-26). This reviews committed source only. The PTO feature contract distinguishes deployed behavior from later candidate source; no deployed-version or endpoint claim is made here.

For POST, `pto/index.ts:982-990` catches JSON parse failures as `400 invalid_json` but casts any successfully parsed JSON to `JsonMap` without checking its shape. JSON `null` is valid, so a POST with body `null` and no action query reaches `body.action` at line 990 and throws. The outer catch at lines 1046-1048 then returns `500 pto_service_failed`. An array or non-null scalar body instead reaches `400 unknown_action`; the same malformed-body class therefore has inconsistent responses. This path is outside the normal browser object's shape, and no production occurrence was measured.

The adjacent Workload Plan handler validates a parsed body is a non-array object and returns `400 invalid_body` (`supabase/functions/workload-plan/index.ts:95-106`), so the proposed PTO behavior has an in-repo precedent. Validate the PTO POST body as an object before reading `action` or member fields; keep malformed JSON and unknown action responses distinct. An offline handler test should cover `null`, array, scalar, malformed JSON, and an ordinary object with synthetic credentials and no backend call.

No function code, protected file, endpoint, database, or live workflow was changed or called. This is a response-contract proposal, not a runtime fix or a claim about the live PTO closure.
