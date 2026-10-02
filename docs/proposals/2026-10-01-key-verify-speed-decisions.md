# The staff sign-in check: owner decisions on the server proposals, and what each function needs

**Date:** 2026-10-01, updated 2026-10-02 · **Session:** Comet. This records the owner's decisions on the server proposals about the staff sign-in check (key-verify) and the source change that carries them out (OPEN_REPAIRS 324). **Source only. The owner deploys what is not automatic; see the deploy map.**

**The page-side idea was not shipped.** The first proposal also moved the page's own key-verify call to a form that skips the browser preflight (key in the request body, plain-text content type). It measured well (below) but touches files the published leave-simulation evidence is fingerprinted against, and the owner chose (2026-10-02) not to re-review those screenshots, so that change was dropped. The two-hour preflight cache header (decision A) covers most of the same gain for returning browsers once deployed.

## What the decisions rest on (measured 2026-10-01)

- Every staff page and new tab waits for key-verify before reading any staff data. From the Edge Function log (24 h, 1,506 successful checks): the check itself has a server-time median of 362 ms (p75 458, p90 832, p99 2,983); an OPTIONS preflight that does nothing costs a median 157 ms of server time (1,336 a day), so about 157 ms of each check is platform overhead and about 205 ms is work: three database calls one after another (the auth_enforcement flag, the team member row, the audit insert).
- Process start ("booted") is 20 to 27 ms, so cold starts are not the problem.
- No function sets Access-Control-Max-Age, so browsers re-ask each function's permission every 5 s; the first call to each function in a tab pays an extra round trip (about 0.3 s from the test rig).
- In a page against the live function, the check measured a median 736 ms with the preflight and 507 ms without (12 interleaved pairs). That is the saving the header recovers for every repeat visit inside two hours; only the first call per browser per two hours pays the preflight.

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
| `production-comments` | the header | manual, and the only path is the staff-sensitive lane's manual dispatch, which also redeploys `notify`, `production-write` and `production-archive` from the same commit (their source is unchanged by this change, but a dispatch is a redeploy of `production-write` outside Section 4). It is not on the single-function lane's list. **Owner decision 2026-10-02: leave it for the next staff-sensitive dispatch the owner needs anyway** (noted in STATE_OF_THINGS) |
| `production-write` | not changed | waits for the next sealed Section 4 deploy (add the header then) |
| `calendar-upsert` | not changed | frozen; never deployed from the repo |

**Owner decision 2026-10-02:** `key-verify`, `smm-weekly-reports` and `thumbnail-revision-read` may deploy on merge, as the push lanes do. The audit write in `key-verify` keeps today's behaviour exactly (no change, see above).

