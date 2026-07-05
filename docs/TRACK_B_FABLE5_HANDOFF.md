# Track B — deep-audit & plan-hardening handoff (for a fresh Fable 5 session)

**Paste this whole file as the opening prompt of the new session.** Your job is **planning and
auditing, NOT building.** You are hardening the plan to replace Linear with an in-app workspace so
that when the build session finally runs, it is a smooth, no-surprises operation. The whole
business runs on this app; **safety and completeness beat speed on every decision.**

---

## 0. Who / what / where

- **Sidney** runs **SynchroSocial**, a social-media agency. **SyncView** is the internal app:
  repo `sidney-afk/client-analytics`, a single ~36k-line `index.html`, deployed by GitHub Pages
  from `main` to syncview.synchrosocial.com.
- **Track A is done** (calendar + samples writes moved off n8n to Supabase Edge Functions, behind
  runtime flags; A3 was skipped by decision). Client-roster resolution was just normalized to one
  canonical accessor (`getClientRoster()`).
- **Track B (your focus)** replaces **Linear** — used by the video (VID) and graphics (GRA) editors
  — with an in-app workspace. The **UI/interaction design is already locked** (a pixel- and
  behavior-matched Linear clone in `docs/syncview-design/`). The **backend/logic plan** is drafted
  in `TRACK_B_LINEAR_REPLACEMENT_SPEC.md`. **Your job is to verify and dramatically deepen that
  plan** by first understanding the *entire* current system, then connecting the two.

## 1. Read in this order (do not skip; do not trust cited line numbers — re-locate by symbol)

1. `INDEPENDENCE_PLAN.md` — the umbrella strategy + the owner's locked decisions + Appendix A
   (owner's original request, verbatim). Sanity-check everything against it.
2. `ROLLBACK.md` — the non-negotiable safety doctrine (one-step rollback, additive-only DB, never
   delete n8n workflows, snapshot before every phase, log everything, hard gates, no secrets in
   this PUBLIC repo). It governs Track B too.
3. `TRACK_B_LINEAR_REPLACEMENT_SPEC.md` — **the plan you are hardening.** Read every section.
4. `docs/syncview-design/` — the locked design: `HANDOFF.md` → `CONTINUATION.md` → `PARITY.md` →
   `linear-design-tokens.md` → open `SyncView.html` (the behavior source of truth) → skim
   `PARITY-LOOP.md`. This is the *look and feel* the build must match; you connect it to real data.
5. `docs/audits/2026-07-03-*.md` — the prior audit snapshots (code, n8n, linear, supabase, sheets).
6. `EXECUTION_LOG.md` — what Track A actually did.

## 2. MANDATORY deep re-audit (weeks have passed — the system changes daily)

Re-audit the live system yourself and diff against the 2026-07-03 snapshots. **Read-only** — do
not mutate any live system (see §5). Cover, at minimum:

- **The repo / `index.html`:** how the content calendar, the samples surfaces (new "SXR" + old),
  the workload tab, the `linear` intake tab, the Kasper review, and the client review flow are
  actually wired today — every read source, every write path, every flag, every localStorage
  outbox, every reconciler entry point. Map the load-bearing symbols.
- **Live Linear** (org `synchro-social`, teams VID + GRA): projects, users, workflow **state
  names** (exact strings), volumes (open vs total), how parent/sub-issues + comments + due dates +
  assignees are really used, the Slack project integration, and the current app↔Linear sync
  (webhook + reconcilers). Re-count operational vs archive at 3/6/12-month cutoffs.
- **Supabase** (project `uzltbbrjidmjwwfakwve`): current schema, the Track-A tables/flags/EFs,
  RLS, realtime publications, triggers, RPCs — and exactly what the Track-B schema (spec §2) adds.
- **n8n** (`synchrosocial.app.n8n.cloud`): every workflow Track B will retire or depend on
  (VIDEO PRODUCTION AUTOMATION, the reconcilers, `Workload — Reconcile`, `linear-tweak-comments`,
  `editors-week`, the nightly due-date bumper, Slack senders). Note what is safe to cut and when.
- **Google Sheets:** the "Clients Info" / "Video Editors" tabs that feed the roster + editor list.

## 3. THE core deliverable — map the real logic, then connect the new Linear to it

This is what the owner most wants and what the current plan is thinnest on. **Document the actual
end-to-end logic** of, and then specify precisely how the new workspace hooks into:

- **The content calendar:** card lifecycle, statuses, how a card links to a Linear sub-issue
  today, YouTube-title handling, scheduling/posting.
- **The samples system** (new SXR + old): full review lifecycle across **SMM → Kasper → Client**,
  the comment/notes threads, approvals, reorder.
- **All three review flows** — **client review**, **Kasper review**, **SMM approval** — every
  state transition, who can do what, what notifies whom, and where each comment currently lands.
- **The status sync** that exists today (calendar/samples ↔ Linear) and every place status,
  assignee, due date, name, and comments must stay consistent.

Then verify/improve the plan against reality on the specific owner requirements already in the
spec §9: deliverable↔card deep links + origin labels (Sample / off-calendar), **name
interconnection** (deliverable title == card name, incl. YouTube titles, synced both ways),
**internal comments** (client/Kasper/SMM feedback writes to the deliverable's Supabase thread,
mirrored to Linear only during transition), the **two-phase mirror** (Phase 1 reflects Linear
*exactly*; never true two-way sync), the **operational + archive** migration split, and the
**single `clients` source of truth**.

## 4. Verify + harden the plan (adversarial, exhaustive)

For **every** subsystem in `TRACK_B_LINEAR_REPLACEMENT_SPEC.md` (§1 rollout, §2 data model, §3
client SoT, §4 sync engine, §5 migration, §6 auth, §7 reliability/DR, §8 monitoring, §9 flows,
§10 UI wiring, §11 notifications, §12 testing, §13 cutover):

- Pressure-test it against what you actually found. Where it's wrong or thin, **fix it in place.**
- **Hunt worst cases:** sync loops/conflicts, partial failures, a client renamed mid-flight, an
  editor assigned to a deleted batch, Supabase down, Linear down, a comment lost in the mirror, a
  status that changed with no actor, backup that can't restore. For each, the plan must have an
  answer (detect → contain → recover → never lose data).
- **Find what's missing** — the things neither the owner nor the prior planner thought of. Use
  multi-agent / adversarial passes for this; a "what did we miss?" critic each round.
- Every phase must have: a single flip point, a written rollback, a hard gate with evidence, and
  additive-only DB changes.

## 5. Hard rules (blocking)

- **PLANNING ONLY. Write no product code and mutate no live system.** Audits are read-only. Do not
  touch Linear data, n8n workflows, Supabase rows, Sheets, or `index.html` behavior. (Reading via
  MCP/API is fine; writing is not.)
- **This repo is PUBLIC. No secrets in any doc, ever.** (Track A's Supabase anon key + n8n webhook
  URLs are already public by design; never add service-role keys, Linear/Slack tokens, etc.)
- **Improve the plan IN PLACE** in `TRACK_B_LINEAR_REPLACEMENT_SPEC.md` — do **not** spawn a
  competing plan doc. Your *audit findings* and the *logic map* (§2–§3) belong in **new files under
  `docs/audits/`** (dated), consistent with the existing audit pattern — that is the one place new
  files are expected. Update the design docs in `docs/syncview-design/` only if a measured value or
  status genuinely changed.
- **Stop-and-confirm with the owner** at real forks; do not silently pick architecture. Surface
  open decisions in the plan's §14.

## 6. Access you'll need (ask the owner for each at the moment you need it; store only in proper
secret stores, never in the repo)

GitHub read (repo `sidney-afk/client-analytics`); Supabase read (project `uzltbbrjidmjwwfakwve`);
n8n API read (`synchrosocial.app.n8n.cloud`); Linear API/read (org `synchro-social`); Google
Sheets read (the "Clients Info" workbook). The design kit is already in-repo — no Linear login
needed to read it.

## 7. Deliverables (what "done" looks like for this session)

1. A **dated audit + logic-map** under `docs/audits/` covering §2–§3 (current system truth +
   the content-calendar/samples/three-review-flow logic + the sync surfaces).
2. A **materially hardened `TRACK_B_LINEAR_REPLACEMENT_SPEC.md`** — every subsystem verified against
   reality, gaps closed, worst-cases answered, open decisions surfaced in §14, each phase
   gate-ready. Extensive and detailed enough that the build session hits no surprises.
3. A short **"what changed and why" summary** for the owner, plus the list of decisions you need
   from him.

## 8. Working style

Loop the planning: audit → map → harden → adversarial "what's missing" → repeat until each
subsystem is execution-ready. Bias to thoroughness — this is the plan the whole business will
depend on once Linear is gone. When two interpretations exist, ask the owner. Keep everything in
this repo (plan in place, audits in `docs/audits/`) so the next session resumes with zero
re-explaining.
