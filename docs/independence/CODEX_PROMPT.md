# CODEX_PROMPT.md — paste-ready handoff prompt for the executing agent

The owner pastes the block below into Codex (or any coding agent) to kick off execution.
It is versioned here so the prompt and the plan can't drift apart.

---

You are taking over the execution of a carefully planned, two-track migration for
SynchroSocial's internal operations app "SyncView" — repo `sidney-afk/client-analytics`,
deployed by GitHub Pages from `main` to syncview.synchrosocial.com. **The whole business runs
on this app. Safety beats speed on every decision.** The planning was done by another agent
with the owner on 2026-07-03 and repeatedly corrected since. Treat current `main`,
`CUTOVER_AUDIT_2026-07-13.md`, and the live systems as authority; the original feature branch is
historical context, not an execution source.

READ IN THIS ORDER before doing anything:
1. `INDEPENDENCE_PLAN.md` — strategy, the owner's 11 locked decisions, phase gates, risks.
   **Appendix A is the owner's original request verbatim — read it critically and sanity-check
   the whole plan against it and against the code you find. If anything looks wrong or
   contradictory, stop and ask the owner instead of following the plan blindly.**
2. `ROLLBACK.md` — the non-negotiable safety doctrine (one-step behavior containment plus
   evidence-bearing recovery, additive-only DB, never delete n8n workflows, snapshot before every
   phase, log everything, hard gates, rehearse recoveries, no secrets in this PUBLIC repo) and the Live State table you must keep
   current in the same PR as every change.
3. `TRACK_A_EDGE_FUNCTIONS_SPEC.md`, then `TRACK_B_LINEAR_REPLACEMENT_SPEC.md`.
4. The audit snapshots in `docs/audits/2026-07-03-*.md`.

MANDATORY FIRST STEP: read the current audit register and live-state docs, then run targeted live
preflights for every surface this task can change—repo/deployed source, active n8n graph, Linear,
Supabase, flags, and Sheets as applicable. Diff against the newest evidence, not only the 2026-07-03
snapshots. Update stale docs before touching behavior and flag material changes to the owner. Never
trust cited line numbers; re-locate by symbol/string.

HARD RULES (full detail in ROLLBACK.md — these are blocking, not advisory):
- Every cutover ships behind a server-readable one-step **behavior kill**, with the complete
  evidence-bearing recovery written and rehearsed on TEST before canary. F27 requires per-team
  outbox classification and machine-zero before Track-B authority reversal; F51 requires
  pinned/attested artifacts before an EF rollback is called exact.
- Old n8n paths may stay dormant through canary only when their authorization and scope are equivalent
  to the native path. Never preserve or select an anonymous writer as rollback (F67); fail visibly and
  repair/revert the authenticated caller instead. Deactivate (never delete) only after a gate passes.
  F46's crashed/inactive workflow is an explicit do-not-blind-activate exception. Export raw
  JSON to the private backup store before any edit and commit only a public-safe status stub under
  `n8n-backups/`—raw graphs can contain secrets.
- Database changes are additive-only until final cleanup. No DROP/RENAME/type changes.
- Snapshot before every phase (git tag `pre-<phase>`, n8n exports, Supabase dumps) and record
  everything in the existing `EXECUTION_LOG.md`: every deploy, flag flip,
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
- Linear: an API key for read-only GraphQL/audit checks; webhook changes require the current
  owner-approved gate (A3 is completed history).
- Google/Slack credentials only when the currently approved replacement or notification task
  requires them; completed Track-A/A3/A4 phase labels are not access instructions.

WORKING STYLE: start a fresh scoped branch from current `main`; the old Claude branch is historical
evidence only. Use one PR per independently reversible change, with a "How to roll this back"
section in every PR description,
matching updates to ROLLBACK.md's Live State table and EXECUTION_LOG.md in the same PR. Keep
commits small and descriptive. When uncertain between two interpretations, ask the owner —
checkpoint communication is expected and welcomed.

START NOW FROM THE CURRENT GATES, NOT THE 2026-07-03 PHASE-0 PLAN. Read every OPEN item in
`CUTOVER_AUDIT_2026-07-13.md`, then the Phase-0 fix pack and stop conditions in
`GO_LIVE_CHECKLIST.md`. Confirm current main/deployed source, flags, active workflow versions, and
the active TEST fixture without writing real-client data. Do **not** expect or manufacture an
execution on `MJbMZ789B5ExZz9x`: F46 proves it is inactive/unpublished, and publishing it requires
an owner topology decision plus a repaired TEST drill. Choose the highest-priority open blocker,
make its narrow reversible change, run the named TEST/negative/recovery proof, update the register
and Live State, and present the evidence plus explicit owner decisions before any runtime flag,
workflow activation, real cohort enrollment, or human cutover. Track A and B0–B3 are complete;
do not rebuild them from the historical sequence.
