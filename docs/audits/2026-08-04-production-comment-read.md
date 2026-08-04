# Production canonical-comment read: bounded complete-thread candidate

> Measured 2026-08-04 against production. Source status: draft only. No Edge Function,
> schema, index, runtime flag, authority, n8n, or data change was made.

## Decision

The canonical Calendar/Samples projection should request one server-owned complete thread instead
of walking up to twenty 50-row pages through `production-comments`. The candidate adds the opt-in
`read_mode: "complete"` contract, keeps ordinary detail pagination compatible, and leaves
`canonical_comment_read_required` unchanged and fail-closed.

This needs **both** a `production-comments` Edge Function change and a browser change. It needs no
new index, migration, trigger, RPC, or n8n change. Deploying `production-comments` remains a
separate owner-gated production action and did not occur during this work.

## Measured baseline

Production held 13,896 comment rows: 4,651 deliverable-mapped comments across 2,720 threads. The
busiest live thread had 22 rows; p95 was 5, p99 was 9, and no live thread exceeded the current
50-row page. Therefore the staff incident observed on 2026-08-04 happened on a one-page thread.
The twenty-page amplification is a real structural exposure, but it is not an honest explanation
for that incident by itself.

The existing partial index is sufficient:

| Exact production shape | Plan | Cost | Execution | Buffers |
|---|---|---:|---:|---|
| Staff exact count | Aggregate -> Index Only Scan | 6.23 | 0.213 ms | 12 hit; 0 read/temp |
| Staff rows, limit 51 | Limit -> Index Scan | 25.97 | 0.201 ms | 24 hit; 0 read/temp |
| Candidate rows, limit 1,000 | Limit -> Index Scan | 25.97 | 0.210 ms | 24 hit; 0 read/temp |
| Client rows | Limit -> same Index Scan | 13.70 | 0.169 ms | 13 hit; 0 read/temp |

The index was valid, ready, live, and used. Adding an audience-specific or covering index is not
justified by these plans.

In the inspected 24-hour runtime window, deployed `production-comments` v18 returned 139/139 POST
requests with HTTP 200 (p50 1,006 ms, p95 2,388.6 ms, max 5,752 ms). Its internal comment GET and
count HEAD requests were also all successful, and no inspected Postgres `57014` identified
`production_comments`. This does not disprove the staff report; it means the evidence does not
identify slow comment SQL as its cause. A transient response/browser path remains plausible.

## Before and candidate

| Surface | Deployed v18/browser | Draft candidate |
|---|---:|---:|
| Browser POSTs for a complete 1,000-row thread | up to 20 | normally 1; at most 2 if the browser loses the first response |
| PostgREST comment requests | up to 40: 20 count HEAD + 20 row GET | normally 1 count-bearing GET; at most 2 inside one Edge invocation on `57014`, or 4 only if a lost response also causes the whole bounded browser retry |
| Principal-budget takes | up to 20 | normally 1; at most 2 if the browser loses the first response |
| Durable allow audits | up to 20 | normally 1; at most 2 if the browser loses the first response |
| Identity/target authorization passes | up to 20 | normally 1; at most 2 on the same lost-response retry |
| Exact completeness | page loop could finish partial-ready after a later-page failure or at the cap | exact numeric total, <=1,000 rows, unique nonblank IDs, normalized-row equality, allowed audience, no cursor, `has_more=false` |

The structural worst case is 40 PostgREST comment requests down to 1 (97.5% fewer). On today's busiest
22-row thread it is 2 down to 1. Six read-only direct replicas of each exact live shape returned the
same total (22), rows, and 30,688 response bytes. This proves equivalent data and fewer calls; it
does **not** prove a production latency or reliability improvement before deployment. In that
small alternating sample, caller-observed completion of the comment data phase was about 155 ms
median for the current parallel HEAD+GET pair versus about 282 ms for the candidate count-bearing
GET. The measured benefit is eliminated amplification and fewer failure points, not a direct-read
latency win.

The browser remains compatible with deployed v18 during release ordering: if the old endpoint
does not emit `complete_thread`, it performs the existing keyset walk but now requires the exact
first-page lifetime total, the same numeric total on every later page, full exhaustion, no
page/refresh error, <=1,000 rows, and unique nonblank IDs. Partial, drifting, or malformed state is
cleared and returned as `error`. The ordinary 50-row endpoint remains on the v18 query shape—a
cursor-free lifetime count plus the cursor-scoped page query—so its public `total` does not shrink
on continuation pages. Only opt-in complete mode uses the single count-bearing GET.

## Deterministic proof

The offline contract/browser proof requires all of the following without weakening the existing
write gate:

- exactly 1,000 unique rows complete through one canonical request;
- 1,001 rows, count mismatch, duplicate/missing IDs, nonnumeric totals, missing rows, hidden-row
  normalization loss, malformed cursor, and wrong client audience all fail closed;
- first SQLSTATE `57014` retries once inside the authorized Edge invocation; a second `57014` and
  every non-`57014` error fail closed;
- one browser transport loss retries once; two losses fail closed;
- the deployed-v18 compatibility walk must prove exact total and cursor exhaustion;
- a wrong-audience client receipt leaves the exact gate unready and an attempted comment produces
  zero `production-write` calls.

## Validation receipt

- `npm test`: all 194 unit suites passed.
- `prod-comments-browser.js`: complete-thread, v18 fallback, total-drift, transport, malformed,
  overflow, hidden-row, wrong-audience, identity-switch, and zero-write sabotage passed.
- Deno checked the exact `production-comments` entrypoint plus imported closure successfully.
- The read-only Production structure and smoke fixtures passed after recognizing only the exact
  new read envelope and the already-existing protected `description_read` action.
- The aggregate Production-polish runner is not claimed green: frozen main's
  `prod-write-gateway-browser.js` fixture still mocks only the legacy `deliverables` table while the
  current UI first reads `production_deliverables_browser_v1`; it receives an empty 200 and fails
  before reaching this PR's comment mock. That unrelated baseline fixture was not rewritten here.

## Owner-gated deployment and after gate

No production after result exists yet. The current manual workflow is not a one-function lane: it
deploys eight push-safe functions and the four-function Track-B set. Do not use that broader lane
for this change without separate owner approval. The owner must authorize either an exact-SHA
one-function `production-comments` deployment or a separately reviewed deployment mechanism.

After the freeze lifts and the PR is merged, deployment acceptance is:

1. Snapshot active v18 source identity and `verify_jwt=false`; prepare the exact source rollback.
2. Deploy only the reviewed `production-comments` source closure from an exact SHA on `main`, after
   explicit owner approval. Read back its version/source identity and unchanged JWT posture, and
   prove no unrelated function, flag, authority, n8n object, schema, index, or data changed.
3. With separate approval for the read's budget/audit writes, open the current busiest staff thread
   in six fresh browser contexts spaced across at least 65 minutes. Require 6/6 canonical-ready,
   exact `total === comments.length`, unique IDs, `complete_thread=true`, `has_more=false`, null
   cursor, and one complete-mode POST per open unless its one lost-response retry is recorded.
4. Correlate each call in Edge/API logs: one count-bearing comment GET, no count HEAD/older-page
   calls, no 5xx/`57014`, and no `canonical_comment_read_required`. Require all organic
   `production-comments` traffic in the same window to remain successful.
5. Stop and restore v18 on any incomplete receipt, unexpected extra page, non-2xx response,
   fail-open writer, source/JWT drift, or unrelated deployment.

Do not claim the live staff failure is resolved until this after gate passes.
