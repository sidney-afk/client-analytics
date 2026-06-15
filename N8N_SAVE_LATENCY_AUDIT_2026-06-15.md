# n8n Save-Latency Audit & Fix Plan — 2026-06-15

> **Status: INVESTIGATION ONLY. Nothing in n8n has been changed.** This is a
> review-first plan for the "sometimes a save says *Saving…* for ~5 seconds"
> report. Snapshot/rollback IDs are recorded below; apply nothing until signed off.
>
> Companion to the front-end fixes in PR #493 (reorder smoothness, thumbnail
> reload, toolbar badge) — those are independent and already done. This doc is
> only about the **backend save latency**, which is an n8n/infra problem, not a
> workflow-logic bug.

## TL;DR
The save **round-trip is healthy** (Supabase-primary; the writes are sub-second).
The occasional 5–16s "Saving…" is **n8n Code-node task-runner cold-start / queue
latency** on the shared n8n Cloud instance — the *first* code node in the upsert
sometimes waits seconds for a runner before its JS even starts. It's made worse
by **write amplification**: every Linear state change fans out a heavy
`calendar-get` + upsert through `linear-status-sync` (4,964 executions), and a
single hung run can tie up a runner for a minute. The cure is **infra
concurrency + lightening `linear-status-sync`**, not rewiring the upsert.

## Evidence (live executions, 2026-06-15)

The upsert response path is correct and Supabase-primary — `Respond JSON` fires
right after the Supabase `Mirror Update`; the Google Sheets `Upsert Calendar Row`
is a **fire-and-forget dead-end branch** (`onError: continueRegularOutput`) and
does **not** block the response.

Per-node timings for the same trivial `Build Row From Patch` code node:

| Execution | total | **Build Row From Patch** | Read Existing Row (Supabase) | Mirror Update (Supabase) | Sheets mirror | verdict |
|---|---|---|---|---|---|---|
| 71290 (fast) | 1.3 s | **5 ms** | 159 ms | 173 ms | ~1 s (off-path) | normal |
| 71312 (slow) | 16.6 s | **14,622 ms** | 270 ms | 417 ms | 1,095 ms (off-path) | **cold-start** |

Same code, **5 ms vs 14,622 ms**. In 71312 the `new Date()` *inside* the node
produced a timestamp **14.6 s after the node "started"** — i.e. the node sat in
the runner queue, not in its own logic. Every other step (Supabase reads/writes,
the Sheets mirror) is sub-second. **The latency is runner scheduling, full stop.**

### Amplification — `linear-status-sync` (`MJbMZ789B5ExZz9x`)
- **4,964 executions.** Webhook responds immediately ("Workflow got started"), so
  it never blocks a user synchronously — but each run does, in one Code node:
  **1 Linear GraphQL call + 1 full `calendar-get` (returns ALL of the client's
  rows) + N upserts** (one per matched row; each upsert is itself a 5-code-node
  workflow).
- Observed run **71344 errored after 61 s** (14:53:19 → 14:54:20) — a hung Linear
  GraphQL or `calendar-get`. A run like that holds a worker/runner for a full
  minute and is exactly what starves the upsert code nodes into the cold-start
  queue seen above.
- It already **skips the no-op upsert** when the sub-status is unchanged
  (`if (sameVideo && sameGraphic) continue;`), so app-initiated echoes don't
  double-write — **but the heavy `calendar-get` still runs on every state change.**

### Why the front end "feels" stuck (not data loss)
Saves are **optimistic** — the edit is applied to `calState` and the local cache
immediately, and the per-card "Saving…" chip just tracks the round-trip. So a
5 s chip is a cosmetic/perception issue, not a lost edit (the write does land).

## Remediation options (ranked by leverage ÷ risk)

### 1. Infra — runner concurrency (lowest risk, biggest lever, NO workflow change)
The cold-start is fundamentally n8n scheduling Code-node runners on demand under
load. Review the n8n Cloud plan's task-runner concurrency / keep-warm settings
(or, if self-hosting is ever on the table, `N8N_RUNNERS_*` + concurrency). No
logic touched, nothing to roll back. **Do this first and re-measure.**

### 2. Lighten `linear-status-sync` (medium risk — snapshot first)
   a. **Targeted read instead of full `calendar-get`.** It already has the issue
      `identifier`; query Supabase REST filtered by `linear_issue_id`/
      `graphic_linear_issue_id` instead of pulling every row for the client. Much
      cheaper per event, and removes the per-event `calendar-get` load.
   b. **Add short timeouts** (~10 s) to the Linear GraphQL + read calls so a hung
      call fails fast instead of holding a runner for ~60 s (cf. run 71344). This
      mirrors the read-failure-guard discipline already used in the upsert.

### 3. Trim upsert hot-path code nodes (medium risk, lower payoff — snapshot first)
`calendar-upsert-post` has 5 Code nodes (Build Row From Patch, Merge Comments,
Strip Routing, Prep Mirror, Wrap Response). Collapsing Strip Routing / Prep
Mirror / Wrap Response would cut per-execution runner hops, but the dominant cost
is the **first** node's cold-start, which fewer nodes won't fix. Only worth it
after (1) and (2). The guards (phantom-row, link-clobber, dup-link, conflict,
read-failure) must be preserved exactly — high blast radius.

### 4. Front-end perception (no n8n change, optional)
The chip already reflects truth. If desired, after ~2 s show a softer "saving
(server's busy)…" so a slow round-trip reads as "slow" rather than "broken." Low
priority — the real fix is (1)+(2).

**Recommended sequence:** (1) infra concurrency → re-measure → (2a/2b) lighten
`linear-status-sync` (snapshot first) → re-measure → revisit (3) only if needed.

## ⚠️ Security finding (pre-existing, flagged in AUDIT_2026-06-15.md)
The **live Linear API key is in plaintext** in the `linear-status-sync` "Handle
Linear Event" Code node (`const LINEAR_KEY = 'lin_api_…'`). Move it to an n8n
credential and **rotate** it. Not reproduced here (never commit the real key —
repo backups redact it as `[REDACTED-LINEAR-KEY]`). Independent of the latency
work but worth doing in the same pass on this workflow.

## Snapshots / rollback (capture BEFORE any edit)
n8n's version history is the authoritative rollback. Current live versions:

| Workflow | id | live versionId (rollback target) | repo backup |
|---|---|---|---|
| Calendar — Upsert Post | `pWSqaqVw7dmqhYOA` | `82cc37a9-c8aa-4d3b-ba52-b067bdf36bfe` (Supabase-primary, 2026-06-15) | **none yet** — latest is `n8n-backups/calendar-upsert-post.2026-06-14.post-readfail-guard.json`; **export the current version before editing** |
| Calendar — Linear Status Sync | `MJbMZ789B5ExZz9x` | `edac6163-829f-4c2b-96da-b25135fc094d` (2026-06-12) | `n8n-backups/linear-status-sync.2026-06-12.pre-supabase.json` (redact the key on any re-export) |

> I did **not** hand-transcribe the live JSON into a new backup file — an
> inexact "backup" is worse than none for rollback. Export from n8n (or via the
> MCP `get_workflow_details`) at edit-time and commit it to `n8n-backups/` with a
> `_backup_note`, exactly as the existing snapshots were made.
