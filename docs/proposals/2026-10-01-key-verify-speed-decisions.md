# The staff sign-in check: owner decisions on the server proposals, and what each function needs

**Date:** 2026-10-01 · **Session:** Comet. This records the owner's answers to three server proposals about the staff sign-in check (key-verify) and the source change that carries them out (OPEN_REPAIRS 324). **Source only. Nothing is deployed; the owner deploys each function.** The full proposal is in the sign-in speed-up PR (sidney-afk/client-analytics#1932, file docs/proposals/2026-10-01-key-verify-speed.md on its branch); the facts it rests on are repeated here so this record stands alone.

## What the decisions rest on (measured 2026-10-01)

- Every staff page and new tab waits for key-verify before reading any staff data. From the Edge Function log (24 h, 1,506 successful checks): the check itself has a server-time median of 362 ms (p75 458, p90 832, p99 2,983); an OPTIONS preflight that does nothing costs a median 157 ms of server time (1,336 a day), so about 157 ms of each check is platform overhead and about 205 ms is work: three database calls one after another (the auth_enforcement flag, the team member row, the audit insert).
- Process start ("booted") is 20 to 27 ms, so cold starts are not the problem.
- No function sets Access-Control-Max-Age, so browsers re-ask each function's permission every 5 s; the first call to each function in a tab pays an extra round trip (about 0.3 s from the test rig).
- In a page against the live function, the check measured a median 736 ms with the preflight and 507 ms without (12 interleaved pairs).

## Decisions and build status

- **A. Accepted, except `production-write`.** `Access-Control-Max-Age: 7200` is in the CORS map of `key-verify`, `production-comments`, `analytics-read`, `brain`, `thumbnail-revision-read`, `smm-weekly-reports` and `workload-plan`. **`production-write` is deliberately not changed here: it gets the same one-line header at the next sealed Section 4 deploy** (it is a gated function; its source must move only inside that ceremony). **`calendar-upsert` is also left alone**: it is frozen by owner directive (its repo source must never be deployed), so it cannot take the header either; if the header is wanted there, that is a separate owner decision.
- **B1. Accepted.** `key-verify` runs the flag read and the member read together (the member read still only for a recognised key) and selects only `id, name, email, role, team, active` instead of `*`. The audit insert is unchanged: still after both reads, still awaited, still before the answer.
- **B2. Declined.** The audit write stays before the answer.
- **One thing the review found about today's audit behaviour (unchanged, for the owner to know).** The audit insert blocks sign-in only when the call cannot be made at all (an exception, which ends in the 500). supabase-js reports a refused insert (permissions, a missing table) as a returned error object, which `logAuth` has never looked at, so a refused audit insert has never blocked a sign-in. This change keeps that exactly as it was; making a refused insert block sign-in too would be a one-line change but a behaviour change, so it is not made.

### Deploy map (what each function needs from you)

| function | what the change is | how it reaches production |
|---|---|---|
| `key-verify` | B1 and the header | **deploys by itself when this merges** (the staff-sensitive lane's push step, with `smm-weekly-reports` and the onboarding functions; it redeploys those from the same commit, unchanged apart from `smm-weekly-reports`) |
| `smm-weekly-reports` | the header | same push step as above |
| `thumbnail-revision-read` | the header | **deploys by itself when this merges** (the thumbnail lane runs on a push to main that touches the function, and redeploys `thumbnail-revision-scan` from the same commit, unchanged) |
| `analytics-read` | the header | manual: dispatch "Deploy one allowlisted Edge Function" with `analytics-read` and the merge commit SHA |
| `brain` | the header | manual: the same lane with `brain` |
| `workload-plan` | the header | manual: the same lane with `workload-plan` |
| `production-comments` | the header | manual, and the only path is the staff-sensitive lane's manual dispatch, which also redeploys `notify`, `production-write` and `production-archive` from the same commit (their source is unchanged by this change, but a dispatch is a redeploy of `production-write` outside Section 4). It is not on the single-function lane's list. Your call whether to dispatch it now or leave it for the next dispatch that is needed anyway |
| `production-write` | not changed | waits for the next sealed Section 4 deploy (add the header then) |
| `calendar-upsert` | not changed | frozen; never deployed from the repo |

Because two lanes deploy on merge, the owner's "I deploy when Lighthouse hands me the links" applies to the four manual ones; the three automatic ones go out at the moment of the merge. If that is not wanted, hold the merge or split those three out.

