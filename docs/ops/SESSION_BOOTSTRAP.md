# Session Bootstrap — get any AI session grounded in 5 minutes

**Who this is for:** any new Claude/Codex session working on SyncView. Read this INSTEAD of
re-auditing the whole system from scratch. Everything here is either a pointer to a live source
of truth (trust those) or a stable recipe (verified 2026-07-14). When this file and reality
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

- **Public repo.** No secrets, no real client names/handles/PII in any committed file or PR text.
  F64 is an active P0: a schema-only replacement is prepared locally but must land only after a
  separate guard-only PR is merged, followed by guarded scrub proof and immediate guard removal.
  Public main/history/cache/fork/clone assessment and the wider tracked-exposure scrub remain open.
  Obtain the active TEST fixture only from private operator config; committed examples
  use generic TEST labels or fictional names.
- **No model identifiers** in commits/PRs/code/docs — chat replies only.
- **Every forward cutover is blocked until its behavior rollback is proved.** A kill flag may
  contain new behavior in one step, but Track-B team authority rollback currently requires
  FLIP_RUNBOOK R2's audited intent classification/team-zero (F27), and EF code rollback is not
  exact without pinned/attested artifacts (F51). Database changes stay additive. Track-A fallback
  workflows remain active-but-dormant through their approved rollback gate; once retirement is
  authorized, deactivate/archive rather than delete and retain a drilled inverse. Back up n8n
  before editing (private export + public-safe stub).
- **Every runtime-flag mutation is owner-only.** This includes all three `*_ef_clients` rosters,
  `auth_enforcement`, `prod_authority`, `linear_inbound_enabled`, `linear_outbound_enabled`,
  `linear_legacy_parity_enabled`, and any newly deployed cohort/epoch flag. Read-only inspection is
  not permission to flip one.
- **Linear is read-only** except sanctioned mutations on the private active TEST project,
  reverted/archived afterward; never publish its name or identifier.
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

### Locked tab label ↔ route mapping

- Visible **Linear** tab → `navProd` → internal key `production` → `#production`; `?prod=1`
  remains its direct-entry/deep-link alias. #812 ships status/comment/due/assignee controls through
  `production-write`; they are authority-gated and real teams render read-only under the current
  Linear/Linear stance, while the bounded active-TEST lane can write. The B4 outbox →
  `linear-outbound` backend was proven live end-to-end on 2026-07-12. F50/F53 remain hard gaps:
  deliverable status does not reach the linked review card, and Graphics has no canonical protected
  media-link operation. Read `prod_authority` / `linear_outbound_enabled` live instead of assuming.
- Visible **Submit** tab → `navLinear` → internal key `linear` → `#linear`. This is the existing
  Create Linear Issue submission form.

The label/key mismatch is deliberate. Do not rename the hashes, `navTo()` arguments,
`currentNav` comparisons, or the `?prod=1` alias to match the visible labels.

## 4. The verification toolkit (copy-paste recipes)

All reads use the browser-safe publishable key already public in `index.html`
(`CAL_SUPABASE_ANON_KEY`) against `https://uzltbbrjidmjwwfakwve.supabase.co`. In this repo's
cloud sessions, curl needs `--cacert /root/.ccr/ca-bundle.crt`.

**Runtime flags (the system's switchboard):**
`GET /rest/v1/syncview_runtime_flags?select=key,value,updated_at` — expect the three
`*_ef_clients` rosters (33 slugs), `auth_enforcement`, `prod_authority`,
`linear_inbound_enabled`, `linear_outbound_enabled` (`off`/`shadow`/`live`), and the independent
`linear_legacy_parity_enabled` (currently disabled). Do not assume
a stance for the last two — the B4 live-path proof ran 2026-07-12 (flips 24/25) and the everyday
stance between epochs is Linear authority with outbound off (D-26); `ROLLBACK.md` §2 has intent,
the live flag row has truth.
`flag_flips` holds the audited history of every change.

**Mirror health (reconciler v2 summaries):**
`GET /rest/v1/deliverable_events?select=ts,payload&action=eq.linear_deliverables_reconcile_v2&order=id.desc&limit=10`
→ `payload.summary.{diff_count,repair_list_size,linkage_actionable,deliverables_checked}`.
Healthy = 0/0/0 on a ~15-min cadence; a single non-zero tick that self-clears next run is a
known transient (read-race), two consecutive is a page.

**Outbound health (B4):**
`GET /rest/v1/deliverable_events?select=id,ts,payload&action=eq.linear_outbound_summary&order=id.desc&limit=10`
→ `payload.{mode,counts,backlog,alerts}`. `mode` must match the live flag. Any fresh summary with
a failed write, growing backlog, volume-spike flag, or shadow mismatch is a page. Summary-freshness
paging (>90 minutes) applies while normal outbound mode is active (`shadow`/`live`); `off` suppresses
that staleness alarm but does **not** stop F4 legacy parity. For unknown/mixed bad Linear writes,
stop affected users, set normal outbound `off`, set legacy parity `false`, and read back both.
Returning one team's authority to `linear` is blocked until FLIP_RUNBOOK R2's immutable snapshot,
classify/replay/quarantine/discard decisions, and machine-read team zero are complete (F27).

**Mirror inflow freshness:** same table, `&source=eq.mirror&limit=3` — actor "Linear webhook";
>12 h silence on a workday = webhook may have auto-disabled. **Only while that team's
`prod_authority` is `linear`** — under `syncview` authority inbound is detect-only, applied
`mirror_in_*` writes go quiet by design, and the staleness signal to watch instead is the
reconciler's `outbound_diff_count`.

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
Relay `Tfhc3vebZyG6obOg` (EF anomaly → owner DM) · legacy **unauthenticated fallback writers**
(F67; not a security-safe failover): calendar upsert
`pWSqaqVw7dmqhYOA`, samples upsert `gPY5DL4D0n5nwius`, reorders `lTtZNLrQLpIZqwAY`/`OXd0sUoSJYMspGTF`/`XOT7IDFGxTwOUCCP`,
templates `oPX1nH7TxzCITNAz`, caption prompts `RGkuE8d4uJg6CPde` (all dormant since 2026-07-07 —
executions on the upsert pair are QA-harness traffic on the TEST client; anything outside QA
burst windows is a finding). New clients are omitted from static routing lists by construction
until F69 is fixed. Calendar Linear Status Sync `MJbMZ789B5ExZz9x`
(**inactive/unpublished** at the 2026-07-13 readback; saved five-node graph is authority-gated, but
must not be treated as a real-time path or republished before its crash/topology decision).

**GitHub Actions (13 workflow files):** reconcilers `linear-sync-reconcile.yml`,
`sample-linear-reconcile.yml`, `linear-deliverables-reconcile.yml` (pager-dispatched; GitHub cron
can throttle); `b1-linear-incremental-refresh.yml`; `linear-outbound-drain.yml`;
`production-write-drill.yml`; `production-shadow-audit.yml`; `n8n-execution-quota-watchdog.yml`;
`production-polish-gate.yml`; the Edge-Function deploy; two nightlies; and unit tests.

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
- `mirror_in_*` applied events going quiet while a team's authority is `syncview` → inbound is
  detect-only by design in that stance, not a webhook outage; watch `outbound_diff_count` instead.

## 6. Phase pointer (as of 2026-07-12 — verify against B4_READINESS.md and the live flags, do not trust)

Track A (writes off n8n): **complete, closed out**. Track B: **B4 outbound pipe PROVEN LIVE** —
on 2026-07-12 the bounded TEST/shadow/live evidence passed, then production authority returned to
the coherent everyday stance: Linear/Linear with outbound off. #812's Production
status/comment/due/assignee controls are shipped but authority-locked for real teams; the bounded
active-TEST override remains. The **Submit** tab and Calendar/Samples reroute in draft #813 are not
merged, and current #813 head lacks the required per-client dark gate (F02/F23). Day-to-day real-team
work therefore stays on the legacy surfaces. Re-enabling outbound/authority is an owner operation,
not proof that F50/F53 or the other audit gates are closed. Read live flags and the register before
assuming any stance. The `linear-*` n8n family retires only at B5 (§13.4).
