# CODEX_PROMPT.md — paste-ready handoff prompt for the executing agent

The owner pastes the block below into Codex (or any coding agent) to kick off execution.
It is versioned here so the prompt and the plan can't drift apart.

---

You are taking over the execution of a carefully planned, two-track migration for
SynchroSocial's internal operations app "SyncView" — repo `sidney-afk/client-analytics`,
deployed by GitHub Pages from `main` to syncview.synchrosocial.com. **The whole business runs
on this app. Safety beats speed on every decision.** The planning was done by another agent
with the owner on 2026-07-03; everything you need is committed on branch
`claude/reduce-n8n-linear-deps-vmphp6`.

READ IN THIS ORDER before doing anything:
1. `INDEPENDENCE_PLAN.md` — strategy, the owner's 11 locked decisions, phase gates, risks.
   **Appendix A is the owner's original request verbatim — read it critically and sanity-check
   the whole plan against it and against the code you find. If anything looks wrong or
   contradictory, stop and ask the owner instead of following the plan blindly.**
2. `ROLLBACK.md` — the non-negotiable safety doctrine (one-step rollback, additive-only DB,
   never delete n8n workflows, snapshot before every phase, log everything, hard gates,
   rehearse rollbacks, no secrets in this PUBLIC repo) and the Live State table you must keep
   current in the same PR as every change.
3. `TRACK_A_EDGE_FUNCTIONS_SPEC.md`, then `TRACK_B_LINEAR_REPLACEMENT_SPEC.md`.
4. The audit snapshots in `docs/audits/2026-07-03-*.md`.

MANDATORY FIRST STEP (the plan's preamble demands it): re-run the full audit — repo code, live
n8n workflows, live Linear workspace, Supabase schema, Google Sheets — and diff against the
2026-07-03 snapshots. This system changes daily; update the plan/specs to match reality before
touching anything, and flag material changes to the owner. Never trust cited line numbers;
re-locate by symbol/string.

HARD RULES (full detail in ROLLBACK.md — these are blocking, not advisory):
- The owner must ALWAYS be able to return to a fully working website in ONE step. Every cutover
  ships behind a single flip point, its rollback is written in ROLLBACK.md, and you rehearse the
  rollback on the QA client before the canary starts.
- Old n8n paths stay live through canary; deactivate (never delete) only after a gate passes;
  export JSON to `n8n-backups/` before touching any workflow.
- Database changes are additive-only until final cleanup. No DROP/RENAME/type changes.
- Snapshot before every phase (git tag `pre-<phase>`, n8n exports, Supabase dumps) and record
  everything in `EXECUTION_LOG.md` (create it in your first PR): every deploy, flag flip,
  migration, backup, incident, rollback — dated.
- STOP at every gate in `INDEPENDENCE_PLAN.md` §6 and get the owner's explicit OK with evidence
  (test results, canary metrics, reconciler-correction count) before proceeding.
- `npm test` and the relevant `qa/master.js` lanes must be green before any cutover; each
  Track A endpoint needs the byte-parity check described in the Track A spec §6.
- This repo is PUBLIC. No secrets in code, docs, commits, or logs, ever. Never rename the
  load-bearing symbols listed in the plan's risk register (tests and the reconciler extract
  them from index.html by name).

ACCESS — ask the owner for each credential AT THE MOMENT you need it; store them only in the
proper secret stores (Supabase function secrets, GitHub Actions secrets, your environment):
- GitHub: push access to `sidney-afk/client-analytics` (+ Actions).
- Supabase project `uzltbbrjidmjwwfakwve`: an access token for the `supabase` CLI (functions
  deploy, secrets set) and dashboard/SQL-editor access (or a DB connection string) for the
  schema baseline dump and migrations.
- n8n `synchrosocial.app.n8n.cloud`: an n8n API key (workflow export/inspection) and UI access
  for activate/deactivate steps.
- Linear: an API key (GraphQL reads; webhook management in phase A3).
- Later phases only: a Google service account with read access to the filming-plan Docs (A4),
  a Slack bot token (Track B notifications).

WORKING STYLE: continue on branch `claude/reduce-n8n-linear-deps-vmphp6` (or per-phase branches
off it), one PR per phase with a "How to roll this back" section in every PR description,
matching updates to ROLLBACK.md's Live State table and EXECUTION_LOG.md in the same PR. Keep
commits small and descriptive. When uncertain between two interpretations, ask the owner —
checkpoint communication is expected and welcomed.

START NOW WITH PHASE 0 (`INDEPENDENCE_PLAN.md` §5): items 1–2 are already done (recorded
in-place); verify item 2b (the "Workload — Graphics" Linear webhook — the owner may have created
it; verify with a Graphics test issue in the "Sidney Laruel" TEST project producing an execution
on n8n workflow `MJbMZ789B5ExZz9x`, then update the plan and ROLLBACK.md); then do items 3
(live schema baseline into `migrations/`), 4 (full n8n workflow export snapshot), and 5 (QA
harness stub for `filming-plan-tabs`). After Phase 0, present your concrete A1 execution plan
(from the re-audited state) to the owner for approval BEFORE writing the Edge Function.
