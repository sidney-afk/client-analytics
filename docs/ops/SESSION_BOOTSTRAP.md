# Session Bootstrap — get any AI session grounded in 5 minutes

**Who this is for:** any new Claude/Codex session working on SyncView. Read this INSTEAD of
re-auditing the whole system from scratch. Everything here is either a pointer to a live source
of truth (trust those) or a stable recipe (verified 2026-07-11). When this file and reality
disagree, reality wins — and fix this file in the same PR.

## 1. The cast, and the rules between them

- **The owner** (Sidney) directs, reviews, and merges every PR. He is not deeply technical —
  write reports in plain language, lead with the outcome, and surface decisions explicitly.
- **Codex** (local, on the owner's machine) is the primary builder. It holds the service-role
  credentials and can deploy Edge Functions, apply migrations, edit n8n, and store secrets.
- **Claude sessions** (cloud) plan, review, verify, and author docs/skills. The reviewer session
  holds only the public **anon/publishable** Supabase key — read-only against the backend by
  construction. It independently verifies every substantive Codex report before the owner merges.
- Flow: Claude prepares prompts → owner pastes them to Codex → Codex reports → Claude verifies
  against the live system → owner merges. **Nobody merges their own work.**

## 2. Standing rails (non-negotiable — from ROLLBACK.md rule set)

- **Public repo.** No secrets, no real client names/handles/PII in any committed file or PR text
  (a 2026-07-11 scrub removed historical leaks — do not reintroduce). TEST client is
  `sidneylaruel`; use it or fictional names for every example and probe.
- **No model identifiers** in commits/PRs/code/docs — chat replies only.
- **One-step rollback for everything**; additive-only DB during the migration; old n8n paths
  stay deactivated-not-deleted; back up n8n before editing (private export + public-safe stub).
- **Runtime flags are owner-only decisions.** Never flip `auth_enforcement`, `prod_authority`,
  `linear_inbound_enabled`, or the `*_ef_clients` rosters without explicit owner approval.
- **Linear is read-only** except sanctioned mutations on the TEST project ("Sidney Laruel"),
  reverted/archived afterward.
- Secrets are handed to AIs **by name, never by value** (e.g. `LINEAR_MIRROR_API_KEY`).

## 3. Live sources of truth (read these first, in this order)

| File | What it answers |
|---|---|
| `ROLLBACK.md` §2 Live State | what is serving production right now + every kill switch |
| `docs/independence/B4_READINESS.md` | current phase gates, auth work-packages, evidence |
| `docs/independence/SYSTEM_MAP.md` | every surface, its backends, Track-B impact |
| `docs/independence/TRACK_B_LINEAR_REPLACEMENT_SPEC.md` | the authoritative design (spec wins) |
| `REPO_MAP.md` | where files live (CI-enforced) |
| `docs/ops/MONITORING.md` | which watcher covers which sync edge |
| `EXECUTION_LOG.md` (tail) | what happened recently, newest at the bottom |

## 4. The verification toolkit (copy-paste recipes)

All reads use the browser-safe publishable key already public in `index.html`
(`CAL_SUPABASE_ANON_KEY`) against `https://uzltbbrjidmjwwfakwve.supabase.co`. In this repo's
cloud sessions, curl needs `--cacert /root/.ccr/ca-bundle.crt`.

**Runtime flags (the system's switchboard):**
`GET /rest/v1/syncview_runtime_flags?select=key,value,updated_at` — expect the three
`*_ef_clients` rosters (33 slugs), `auth_enforcement`, `prod_authority`,
`linear_inbound_enabled`, and B4's default-off `linear_outbound_enabled`.
`flag_flips` holds the audited history of every change.

**Mirror health (reconciler v2 summaries):**
`GET /rest/v1/deliverable_events?select=ts,payload&action=eq.linear_deliverables_reconcile_v2&order=id.desc&limit=10`
→ `payload.summary.{diff_count,repair_list_size,linkage_actionable,deliverables_checked}`.
Healthy = 0/0/0 on a ~15-min cadence; a single non-zero tick that self-clears next run is a
known transient (read-race), two consecutive is a page.

**Outbound health (B4 staged dark):**
`GET /rest/v1/deliverable_events?select=id,ts,payload&action=eq.linear_outbound_summary&order=id.desc&limit=10`
→ `payload.{mode,counts,backlog,alerts}`. Before the owner handoff, expect `mode=off`, zero writes,
and zero backlog. In shadow/live, any failed write, growing backlog, volume-spike flag,
shadow mismatch, or summary older than 90 minutes is a page. Global stop is mode `off`; a team's
everyday pause is `prod_authority[team]=linear`.

**Mirror inflow freshness:** same table, `&source=eq.mirror&limit=3` — actor "Linear webhook";
>12 h silence on a workday = webhook may have auto-disabled.

**New-issue adoption heartbeat:** `&action=eq.linear_incremental_refresh` — gaps well beyond
30 min mean GitHub is throttling the cron (known failure mode; pager dispatch is the cure).

**Ledger error scan:** on `calendar_post_events`, `sample_review_events`, `deliverable_events`:
`?or=(action.ilike.%error%,action.ilike.%fail%,action.ilike.%anomaly%,action.ilike.%unmapped%,action.ilike.%unknown%)&ts=gte.<12h ago>`
— expect zero rows.

**Event-table cheatsheet:** `calendar_post_events` / `sample_review_events` (staff+client card
writes, actor/role/source columns since WP-A1) · `deliverable_events` (mirror + reconciler +
backfill + B4 drainer summaries; `source` ∈ ui/mirror/reconcile/backfill/system/outbound) · `settings_events`,
`syncview_auth_events`, `client_access_events` (service-role-only — anon read returns 42501,
which is itself the "exists and locked" proof) · `flag_flips`.

**Reviewing a PR/branch (the standard harness):**
```
git fetch origin <branch>
git worktree add --detach <scratch>/wt origin/<branch>
cd <scratch>/wt && ln -sfn <repo>/node_modules node_modules && npm test
git diff origin/main...origin/<branch> -- <load-bearing paths first>
```
Load-bearing paths, always inspected: `index.html` (the whole app), `supabase/functions/**`,
`.github/workflows/**`, `migrations/**`, `CNAME`/`404.html`/root PNGs (GitHub Pages serves root).
Then live-verify every checkable claim in the PR body (counts, flags, event ids) — the PR body
is a claim, the database is the evidence. Finish with a client-name / secret / model-id scan of
changed files.

**n8n quick reference (workflow ids are public-safe; webhooks already appear in index.html):**
Monitoring Pager `qllIDZPkdNAPRj0b` (15-min reconciler dispatch + staleness pager) · Edge Alert
Relay `Tfhc3vebZyG6obOg` (EF anomaly → owner DM) · legacy write fail-safes: calendar upsert
`pWSqaqVw7dmqhYOA`, samples upsert `gPY5DL4D0n5nwius`, reorders `lTtZNLrQLpIZqwAY`/`OXd0sUoSJYMspGTF`/`XOT7IDFGxTwOUCCP`,
templates `oPX1nH7TxzCITNAz`, caption prompts `RGkuE8d4uJg6CPde` (all dormant since 2026-07-07 —
executions on the upsert pair are QA-harness traffic on the TEST client; anything outside QA
burst windows is a finding) · Calendar Linear Status Sync `MJbMZ789B5ExZz9x` (active).

**GitHub Actions:** reconcilers `linear-sync-reconcile.yml`, `sample-linear-reconcile.yml`,
`linear-deliverables-reconcile.yml` (dispatched by the pager — GitHub's own cron throttles);
`b1-linear-incremental-refresh.yml` (new-issue adoption); `linear-outbound-drain.yml` (B4,
default-off outbox worker); `production-polish-gate.yml` (fast
lane on PRs, heavy lanes on main/schedule); two nightlies; unit tests on every push.

## 5. Known patterns that look like problems but aren't

- Hundreds of executions on the dormant n8n write webhooks → QA harness seeding on the TEST
  client (dense bursts, seconds apart). Verify by quiet-window counts, not totals.
- A single reconciler tick with `diff_count` 1–3 that self-clears → read race, not drift.
- `linkage_actionable` creeping up from zero → normal inflow awaiting the linkage lane; it is
  maintenance, not mirror unfaithfulness (drained via the sanctioned linkage backfill).
- Null `actor` on ledger events → traffic that sends no attribution headers (QA harness, old
  tabs) — expected while `auth_enforcement` is permissive.
- GitHub scheduled workflows firing hourly instead of every 10–30 min → GitHub cron throttling,
  the reason the n8n pager exists.

## 6. Phase pointer (as of 2026-07-11 — verify against B4_READINESS.md, do not trust)

Track A (writes off n8n): **complete, closed out**. Track B: **B4 outbound in progress** — B3
inbound remains live and Linear-authoritative; the additive outbox/drainer, strict echo guard,
two-way reconciler lane, TEST shadow/live/pause drills, and outbound pager are staged dark behind
`linear_outbound_enabled=off`. D-25's full-roster shadow window and the owner live flip have not
started. Production write affordances and intake re-pointing remain gated; the `linear-*` n8n
family retires only at B5 (§13.4).
