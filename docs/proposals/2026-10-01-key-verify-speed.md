# The staff sign-in check (key-verify): measured, one change shipped, three server changes proposed

**Date:** 2026-10-01 · **Session:** Comet · **Owner request:** speed up the staff sign-in check, since every page and every new tab waits on it. Measure first; propose before deploying anything; the owner deploys server functions.
**Shipped in this PR (page only, no deploy needed):** the check is sent as a "simple" browser request, so the browser no longer sends a preflight first.
**Proposed, NOT done, NOT deployed:** three server changes (section 4). Nothing under `supabase/functions/` is touched by this PR, so no deploy lane is triggered.

---

## 1. What the wait is made of (measured)

Every staff page and every new tab holds all staff data until `key-verify` answers (the staff gate, untouched). Measured from the Edge Function log (24 h, 1,506 successful checks) and from a real browser against the live function:

| piece | measure | what it is |
|---|---|---|
| browser preflight (`OPTIONS`) | server time median **157 ms**, 1,336 calls a day; about 0.3 to 0.5 s end to end from the test rig | the call carries a custom header and `application/json`, so the browser first asks permission with an `OPTIONS` request, a whole extra round trip and an Edge Function call. The function sends no `Access-Control-Max-Age`, so the browser keeps the permission for 5 s only. |
| the check itself (`POST`) | server time median **362 ms**, p75 458, p90 832, p99 2,983 | about 157 ms of platform overhead (an `OPTIONS` that does nothing costs the same) plus about 205 ms of work: three database round trips one after another (the `auth_enforcement` flag, the team member row, the audit-log insert) |
| process start | `booted` events 20 to 27 ms | not a cold-start problem; swapping the database client library would not help |
| network to the function | 130 to 200 ms for a plain read from the test rig | not in our hands |

In a page, against the live function (12 interleaved pairs): median **736 ms with the preflight, 507 ms without**, both 200 OK.

## 2. What this PR changes (page only)

The two places that call `key-verify` (the head script's early check and `_syncviewVerifyStaffIdentity`) now post `text/plain` with the key inside the body instead of in an `X-Syncview-Key` header. A cross-origin POST with a safelisted content type and no custom header is a "simple request": the browser sends it at once. The deployed function already reads the key from the body when no header carries it (`clean(req.headers.get("x-syncview-key") || body.key)`) and parses the body whatever its content type, so **this needs no deploy** (verified live: same 200 answer, same member and role).

Nothing about who may sign in moves: the same function checks the same key against the same secrets and the same member row, and the page still waits for the answer before any staff data is read (`qa/boot/staff-entry-gate.js` passes). The key travels in the request body over the same TLS connection as it did in the header; request bodies are not in the function's edge log fields.

Old against new, interleaved, medians of 4 (ms), full page opens in a new tab on the test client:

| open | gate answered | panel or card visible | everything loaded |
|---|---|---|---|
| sub-issue A, warm | 1,127 to 693 | 1,342 to 926 | 2,877 to 2,503 |
| sub-issue A, cold | 896 to 652 | 2,200 to 1,948 | 4,472 to 4,251 |
| sub-issue B (finished), warm | 1,060 to 742 | 2,248 to 1,942 | 4,458 to 4,163 |
| sub-issue B (finished), cold | 928 to 702 | 2,172 to 1,967 | 4,926 to 4,160 |
| Calendar card A, warm | 1,046 to 690 | 1,455 to 1,484 | same |
| Calendar card B, warm | 1,090 to 852 | 1,515 to 1,320 | 2,107 to 1,993 |

The gate now answers 0.2 to 0.4 s sooner in every case. Where the page itself is the slower part (Calendar card A, bound by the client's posts read), the saving does not show in the visible time within run noise.

## 3. Why the rest is for the owner to decide

Everything below is a change to an Edge Function (a deploy), so it is proposed here, not made.

## 4. Proposals (server side)

### A. Let browsers remember the permission: `Access-Control-Max-Age: 7200` (recommended, tiny, low risk)

Add one header to the CORS map of the functions the page calls on its hot path, and to the `OPTIONS` reply: `"Access-Control-Max-Age": "7200"` (Chrome caps it at 2 hours). Without it the browser re-asks every 5 s per function address, so every first call to each function in a tab pays an extra round trip (about 0.3 s). Opening a sub-issue fires `production-comments` and three `production-write` reads in parallel right after the gate; each pays that preflight, which is part of the 0.7 to 1.4 s the panel's "everything loaded" waits on.
- Hot-path functions (first batch): `production-write`, `production-comments`, `analytics-read`, `calendar-upsert`, `brain`, `thumbnail-revision-read`, `smm-weekly-reports`, `workload-plan`. `key-verify` itself no longer needs it after this PR.
- 40 files define their own CORS map today and none sets the header; a shared constant in `_shared` would be the tidy way, but the first batch can be a one-line change each.
- Risk: none for security (the header only lets the browser cache a permission that the function already grants to every origin with `Access-Control-Allow-Origin: *`). A later change to the allowed headers reaches browsers up to 2 hours late.
- Caveat: `production-write` is in the sealed deploy lane; this is a header only, but it still goes through that lane.
- Expected: about 0.3 s off the "everything loaded" time of a sub-issue open for any browser that has opened the app in the last 2 hours (not measured: needs the deploy).

### B1. `key-verify`: run the flag read and the member read together (recommended, small)

Today three database calls run one after another. The flag read and the member read do not depend on each other, so run them together; the audit insert still follows (it needs both answers) and still gates the sign-in, so an audit failure still fails the check closed exactly as now. Saves one database round trip (about 65 ms of the 362 ms median).

```ts
// replaces: const mode = await authMode(supabase); const role = ...; const member = role ? await resolveMember(...) : null;
const role = matchingRoleForKey(key);                 // pure, no I/O
const [mode, member] = await Promise.all([
  authMode(supabase),
  role ? resolveMember(supabase, body, req) : Promise.resolve(null),
]);
```
Also select only the columns the answer uses (`id,name,email,role,team,active`) instead of `*` in the by-id read.

### B2. `key-verify`: write the audit row after answering (decision for the owner)

`EdgeRuntime.waitUntil(logAuth(...))` returns the answer without waiting for the insert and saves another round trip (about 65 ms). The trade: today an audit-log failure makes the sign-in fail (500 `verify_failed`), i.e. the audit log is part of the gate. With `waitUntil` a failed insert would be logged to the function log but sign-in would succeed. That is a security-posture choice, not a speed one, so it is not recommended unless you want it.

### C. Not proposed

- Replacing the database client library or keeping the function warm: `booted` is 20 to 27 ms, so neither would help.
- Caching the member row: a deactivated person must stop signing in at once.
- Skipping or weakening the check on any path: not on the table.

### Expected effect, summed

Client change (shipped): gate 0.2 to 0.4 s sooner. A: about 0.3 s off "everything loaded" per sub-issue open for returning browsers. B1: about 65 ms. B2: about 65 ms more, only if wanted. Only the client change is measured; A, B1 and B2 are estimates from the log and need the deploy to measure.

## 5. Limits

Rig: one location, one egress path; run-to-run network variation about 300 ms, so old and new alternate. n = 4 per cell for the page opens and 12 pairs for the in-page request timing. Server times are the platform's own `execution_time_ms`, which excludes the network.
