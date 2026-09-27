# Onboarding readers: Edge Function source review

**Scope:** `supabase/functions/onboarding-full/index.ts` and
`supabase/functions/legacy-onboarding-list/index.ts` at `origin/main`
`3f5bd46e6086911ae2a7bb0d32507f03d5a44da8` on 2026-09-26. This is a
proposal-only source review. No endpoint, database, or live workflow was called;
no function or browser code was changed. The existing role-key and legacy-key
access rules are preserved in every proposal.

`docs/truth/ENDPOINTS.md` owns the current route and access inventory;
`docs/features/ONBOARDING_EDGE_MIGRATION.md` describes the four-reader contract.
The previously recorded F77 full-list discovery and F85 individual-session
issues are outside this slice. `test/onboarding-reader-auth.js` and
`test/staff-sensitive-surface-auth.js` cover key boundaries, but do not drive
the read-failure branches below.

| Source finding | Exact evidence and effect | Proposed follow-up |
|---|---|---|
| All three full-reader queries may fail while the response says success and the viewer says the inbox is empty. | `onboarding-full/index.ts:45-49` reads three sources. Lines 51-87 turn each missing `data` into an empty array, collect `error.message` strings in `warnings`, and always return `200 {ok:true,count,submissions,warnings}`. By contrast, `legacy-onboarding-list/index.ts:40-43` returns 500 on its query error. The current full-view caller reads warnings (`src/index/060-templates-filming.js.part:343-362`), but the empty-state branch at lines 379-386 displays “No onboarding submissions yet” when `submissions` is empty and no `error` was supplied; it only renders the warning in the nonempty branch. This is a reachable source path, not an observed outage. | Keep intentional partial results if needed, but return a distinct failure when no source succeeds; give each source a structured outcome and test all-fail and one-fail cases with the existing viewer. Do not weaken either access gate. |
| Both readers accept methods outside their stated GET contract. | `legacy-onboarding-list/index.ts:16-20,27-43` and `onboarding-full/index.ts:22-26,33-49` advertise `GET, OPTIONS`, but the handlers only special-case `OPTIONS`. Any other method carrying an accepted key reaches the same service-role reads. CORS headers do not enforce a server-side method rule for direct callers. | Return the existing JSON error envelope with HTTP 405 for non-GET/non-OPTIONS methods, while retaining the same authentication and data boundaries. |
| Unexpected setup/read exceptions bypass each route's JSON error shape. | Both handlers construct the service-role client with non-null-asserted environment reads and no configuration guard or outer catch (`legacy-onboarding-list/index.ts:39-43`; `onboarding-full/index.ts:44-49`). A missing setting or thrown client/query error therefore does not pass through their `{ok:false,error}` response helper. | Check required configuration after authentication, catch unexpected failures, and return a bounded JSON 500. Add isolated tests with absent configuration and a throwing mocked read. |

**Limits:** This report proves source control flow and the current viewer branch,
not deployed versions, incidence, data completeness, or hosted response bytes.
No live read, write, deployment, or browser test was performed. Future work
should verify a proposed fix offline before a separate release decision.
