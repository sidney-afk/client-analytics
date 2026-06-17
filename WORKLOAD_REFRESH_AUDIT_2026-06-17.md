# Workload refresh latency — audit & fix (2026-06-17)

> Trigger: "when I change a sub-issue's assignee (editor) in Linear it takes a long
> time to show on the Workload, and clicking ↻ is really slow."

## How the Workload gets its data

The Workload view does **not** read from Supabase/the calendar. It pulls **live from
Linear** on every refresh, through the n8n webhook `…/webhook/linear-issues`
(`index.html:7856`, fetched by `loadLinearIssues` at `index.html:7903`). That endpoint
is the `Code in JavaScript7` node inside the **VIDEO PRODUCTION AUTOMATION** workflow
(`BrJSe8zCKUccfmIq`).

Refresh triggers (no interval polling, no realtime):
- navigating to the Workload tab (`initWorkloadView`, `index.html:8409`) — force-refetch
- the ↻ button (`wlManualRefresh`, `index.html:8495`) — force-refetch
- tabbing away and back (`visibilitychange` → `wlRefetchSilent`, `index.html:8515`)

So a reassignment made in Linear only appears on the next refresh, and each refresh
waits on the full Linear sweep.

## What the endpoint was doing (measured live, 2026-06-17)

Per call it fetches the SMM key list (Google Sheet CSV), then for **each of 6 workspace
API keys** runs a **paginated** Linear GraphQL query (`first: 250`, cap 10 pages),
de-dupes, drops completed/canceled **in JS**, and returns the rest.

Baseline (before fix):

| metric | value |
|---|---|
| latency | **12.4 s cold / 6.9 s warm** |
| response size | 517 KB |
| `totalRaw` fetched | **15,000** (6 × 10 pages × 250 — every workspace maxed the cap) |
| issues returned | 865 |

Two problems exposed:
1. **It downloaded ~15,000 issues to keep 865** — ~94% discarded after fetch.
2. **Hidden truncation bug**: because every workspace hit the 10-page cap (so each has
   >2,500 issues) and the query orders by `updatedAt` then trims, **active issues that
   hadn't been updated recently fell past the cap and silently vanished** from the board.

## Fix applied (live, published)

Added a server-side filter so Linear returns only the live issues:

```graphql
issues(first: 250, after: $after, orderBy: updatedAt,
       filter: { state: { type: { nin: ["completed", "canceled"] } } }) { … }
```

The board already discarded those statuses, so the **output set is unchanged in
meaning** — but each workspace now returns all of its *active* issues instead of the
newest-2,500-of-everything.

- Pre-change version : `6fe6ff13-eae2-4b3c-86f6-9f5807e914f7` ← rollback target
- Post-change version: `89d575e6-01d8-4102-9e52-a9fc86f38efe`
- Backup of the pre-change node: `n8n-backups/linear-issues-handler.2026-06-17.pre-state-filter.jsCode.js`

After fix:

| metric | value |
|---|---|
| latency | **9.9 s cold / 7.1 s warm** (≈ unchanged) |
| response size | 1,015 KB |
| `totalRaw` fetched | 10,647 → **1,781 unique** |
| issues returned | **1,781** (865 + 916 recovered) |

### Result
- ✅ **Correctness bug fixed**: 916 previously-truncated active issues now appear (mostly
  old `backlog`, 54 → 815). Of those, **341 are renderable sub-issues** (assigned or
  due) — i.e. the board now shows ~341 more real editor tasks it had been hiding.
- ⚠️ **Latency essentially unchanged** (~7 s warm). The filter was not the bottleneck.

## Why refresh is still slow (the real bottleneck)

- The dataset is genuinely ~1,781 active issues → **8 sequential cursor pages** per key
  (Linear caps page size at 250, and pages are cursor-chained so they can't be
  parallelised). That ~8-round-trip chain is the ~7 s warm floor.
- **n8n Code-node cold-start** adds the 7 s → 12 s swing (see
  `N8N_SAVE_LATENCY_AUDIT_2026-06-15.md`, finding #1).
- The 6 workspace keys are **~6× redundant** (10,647 raw → 1,781 unique) — they see
  overlapping issues. This wastes Linear API quota but does **not** affect wall-clock
  (the keys run in parallel).
- Sub-issues are 1,545 of 1,781; only 236 are parents — so "fetch sub-issues only"
  would cut ~13% and would break the parent rollup link-outs (`index.html:8583` builds
  `parentById` from parent entries). Not worth it.

## Recommended next steps (ranked)

1. **Infra — kill cold-start (no code).** Raise the n8n Cloud task-runner
   concurrency / keep-warm so the first Code node doesn't wait for a runner. Biggest
   remaining lever for "sometimes it's *really* slow"; this is the audit's #1.
2. **Re-architect to event-driven reads (the real "optimized way").** Stop sweeping
   Linear on every click: extend the existing Linear webhook (`linear-status-sync`,
   which today only handles `stateId`) to also mirror **assignee / dueDate / state** of
   sub-issues into a Supabase table, and have the Workload read that table (instant)
   instead of `linear-issues`. Refresh becomes sub-second and updates arrive in near
   real-time. Bigger build (table + webhook + FE read + one-time backfill).
3. **De-dupe the redundant keys** (efficiency/rate-limit hygiene, not latency): if the
   6 SMM keys share a Linear workspace, fetch with one and skip the rest.
