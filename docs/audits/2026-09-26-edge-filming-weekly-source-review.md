# Filming plans and weekly reports: Edge Function source review

**Scope:** `supabase/functions/filming-plans/index.ts` and
`supabase/functions/smm-weekly-reports/index.ts` at `origin/main`
`3f5bd46e6086911ae2a7bb0d32507f03d5a44da8` on 2026-09-26. This is a
proposal-only source review. It did not call either endpoint, inspect live data,
change a function, or prove deployed behavior. The existing staff-key gates and
legacy compatibility paths remain outside this review's proposed changes.

The owning endpoint inventory is `docs/truth/ENDPOINTS.md` (filming plans and
weekly reports). The feature contracts are `docs/features/FILMING_PLANS_DESIGN.md`
and `docs/features/SMM_WEEKLY_REPORTS.md`. Existing offline tests cover the
staff-key boundaries (`test/staff-sensitive-surface-auth.js`,
`test/smm-weekly-auth.js`) and filming-plan source wiring
(`test/filming-plans-source.js`); they do not exercise the failure paths below.

| Source finding | Evidence and consequence | Proposed follow-up |
|---|---|---|
| Weekly roster synchronization can report success after an incomplete replacement. | `smm-weekly-reports/index.ts:276-295` checks the upsert result, but ignores the subsequent active-roster select's `error` and every deactivation update result. The handler then returns `ok: true` at line 297. If a later call fails, the response does not tell the caller that active rows may be stale. This is a source path, not an observed production failure. | Check both later results. Return a distinct failure or partial-result response when replacement cannot finish; decide retry/reconciliation behavior before treating a partial write as safe to repeat. Keep the existing Admin/legacy caller gate at lines 309-333. |
| Weekly report reads can silently lose the available-weeks list. | `smm-weekly-reports/index.ts:173-187` runs the report and week queries together, checks only the report query's `error`, and converts missing week data into `weeks: []` with `ok: true`. A failed secondary query is therefore indistinguishable from no available weeks. | Check `weekResp.error` and return a failure that the viewer can distinguish from an empty list. |
| A nonempty invalid week can become a different, immutable report week. | `smm-weekly-reports/index.ts:57-66` substitutes the current date for a non-date string or invalid date and normalizes a calendar-overflow date. `submitReport` uses this helper for `week_start_date` at line 204 before inserting at lines 225-236. The feature contract says a submission is immutable. A malformed supplied week is therefore accepted under another Monday rather than refused. | Keep an omitted-week default only if callers need it, but validate any supplied `YYYY-MM-DD` as a real date and return 400 before insert. Apply the same explicit rule to the reports filter at lines 156-170 so a bad filter does not silently select another week. |
| JSON `null` is classified as a server error in both POST routes. | Both handlers cast `await req.json().catch(() => ({}))` to `JsonMap` (`filming-plans/index.ts:110`; `smm-weekly-reports/index.ts:328`). A valid JSON `null` then reaches `body.clientName` (filming line 111) or `body.action` (weekly line 329), throws, and is caught by the outer 500 handler (filming lines 142-144; weekly lines 336-338). Other missing fields receive 400 responses. | Require a non-null plain object before reading fields and return the existing `{ ok: false, error }` shape with 400. Keep database and unexpected failures as 500. |

**Limits:** No hosted request, database read/write, deployment, or browser check
was performed. The findings identify reachable source branches and proposed
tests, not measured incidence. A follow-up implementation should add isolated
handler tests with mocked Supabase failures and malformed request bodies before
any release decision.
