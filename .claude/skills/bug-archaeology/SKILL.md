---
name: bug-archaeology
description: Mine the project's OWN bug/incident history into named fracture patterns, expand each past bug through six fixed lenses (mechanism, preconditions, class, cohabitants, context-shift, isomorphs), sweep the codebase pattern-by-surface for latent siblings, adversarially VERIFY every candidate before it may be called a finding, and ship survivors as fixes + register rows + regression guards. Runs as a bounded loop with explicit stop conditions and per-cycle self-supervision. Use when the owner asks to "find bugs before they happen", wants a preventive audit after a heavy change period, or invokes it by name. Pairs with /master-test (whole-app health), /human-audit (hand-and-eyes), /feedback-expansion (owner-feedback loop).
---

# Bug archaeology — the past predicts where it breaks next

The owner's founding insight, which this protocol operationalizes: **a real bug is never
alone — it is one sample of a pattern, and the pattern is the real object.** Every incident
that actually happened is proof that (a) a class of mistake can survive this project's
process, and (b) its siblings may already be in the code, unfound. So instead of hunting
randomly, start from the bugs that really happened, extract what *made* them, and go
looking for their family.

Two constraints shape everything below:

- **Hypotheses are cheap; findings are expensive.** The expansion machinery below generates
  *candidates* without limit. A candidate is NOT a finding until an independent adversarial
  pass has tried to refute it with `file:line` or read-only live evidence and failed.
  Report only survivors. (This gate is what separates a useful audit from noise — the
  2026-07-16 whole-system audit killed or downgraded a third of its candidates this way.)
- **This is a loop, and loops need stop conditions.** Per the loop-engineering guidance:
  define what "done" looks like *before* starting — deterministic criteria, explicit
  cycle caps — or the loop wanders and burns budget re-mining the same seam.

## 0. Scope and safety (read first, non-negotiable)

- READ-ONLY against live systems (curl GETs with the public key; MCP reads). Guarded live
  writes only on the TEST client and only if the run's mandate explicitly includes drills.
- ⛔ The client-writer FREEZE (AGENTS.md top callout) binds every recommendation: never
  propose re-gating `calendar-upsert`/`sample-review-upsert` as a "fix" without marking it
  OWNER-APPROVAL-REQUIRED.
- No secrets, tokens, client names, or HR values in any committed artifact.
- Findings that imply changing live state are RECOMMENDED, never executed, by this skill.

## 1. The corpus — where this repo's past bugs live

Build the bug inventory from (newest first, scope-bounded by the owner's ask):

- `EXECUTION_LOG.md` — every section titled INCIDENT, plus fix/outage narratives.
- `docs/independence/CUTOVER_AUDIT_2026-07-13.md` — the F-register: each row is a
  described defect with evidence grade and status.
- Merged PR titles/bodies matching fix/incident/recovery language (`gh`/MCP search).
- `ROLLBACK.md` rows — each encodes something that once went (or could go) wrong.
- `test/*.js` regression suites — a test that exists because of a bug names the bug.

## 2. The six lenses — how to describe one bug so it points at others

For each past bug, write one tight paragraph per lens. The lenses are the owner's
questions, made mechanical:

1. **Mechanism** — what exactly failed, at the code/system level, in one sentence.
2. **Preconditions** — what had to be true for it to happen (and who/what created those
   conditions). Root cause lives here.
3. **Class (bigger picture)** — name the family this bug belongs to. What does its
   existence prove about the system's habits?
4. **Cohabitants (same context)** — what else lives in the same file/flow/credential/
   trigger and is exposed to the same weather?
5. **Context-shift** — if the surrounding context changed (a flag flips, a credential
   rotates, a dependency updates, a client enrolls), where would this same logic break?
6. **Isomorphs (twisted logic)** — where else does the *shape* of this logic exist with
   different nouns? (Different table, different webhook, different allowlist.)

## 3. Pattern extraction — the repo's known fracture patterns

Lensed bugs condense into named patterns. Seed list from this project's real history —
extend it every run, never treat it as complete:

| Pattern | Archetype incident |
|---|---|
| **Two-correct-changes-collide** | Token column removed (F03) + writers gated (#836) → every client link 401'd, 2026-07-15 |
| **Consumer-of-revoked-credential** | F88 revoke left n8n's filming-plan reader on the anon key → all Submits failed, 2026-07-16 |
| **Upstream-shifted-under-us** | Linear renamed `Project.team`→`teams` → intake workers broke, 2026-07-16 |
| **Allowlist-missing-a-member** | CORS allow-headers omitted a header the caller sends (share button; then `x-syncview-source` caught pre-ship) |
| **Robot-with-too-broad-a-trigger** | Thumbnail deploy workflow could redeploy the FROZEN writers on unrelated pushes (defused in Part C) |
| **Docs-contradict-live** | ENDPOINTS.md said "do not enable" a tool that was live-on (PTO) — outage-by-documentation risk |
| **Queue-without-a-bell** | Undelivered Linear updates silently parked for weeks (F21) |
| **Name-as-identity** | Client/project resolution by display-name string match (Submit dropdown risk; PTO actor headers) |
| **Stale-branch-rot** | #813 parked 10 days → 24 conflicts, resurrection cost two sessions |
| **Sandbox-symbol-drift** | Reconciler eval'd an index.html function whose helper wasn't in the grab list → scheduled crash (`_sxrNormStatus`) |

## 4. The sweep — pattern × surface, prioritized

For each pattern, enumerate where its preconditions exist across surfaces (Calendar,
Samples, Submit/intake, Production mirror, PTO, client links, EFs, n8n workflows, GitHub
workflows, docs/truth). Score each candidate site BEFORE spending verification effort:

- **Impact**: client-facing > staff-facing > internal/ops.
- **Exposure**: active surface > dark/parked surface.
- **Cost-to-check**: cheap greps and single-file reads first; live probes second;
  multi-file trace last.

Work the queue in score order. Timebox each candidate; a candidate that can't be decided
within its box goes back in the queue with a note, not into the report.

## 5. The gate — adversarial verification

Every surviving candidate gets an independent verification pass whose explicit job is to
**refute** it: read the actual code path, run the read-only probe, check whether a guard
already covers it. Verdicts: CONFIRMED (evidence attached) / REFUTED (dropped, with the
refuting evidence noted so the pattern matrix learns) / UNDECIDABLE-WITHOUT-ACCESS
(listed separately, never presented as a finding). When fan-out is available, verification
runs as parallel skeptics; when not, it runs as a separate pass with fresh eyes on only
the claim and the evidence.

## 6. Recursion — going deeper without drowning

New patterns discovered mid-sweep (a confirmed finding that fits no existing pattern)
are added to the matrix and get their own mini-sweep **next cycle**, not immediately —
depth grows cycle-by-cycle, never mid-stride. Each cycle = extract → sweep → verify →
ship → reassess. This keeps depth-first rabbit holes out of the budget.

## 7. Loop mechanics and STOP conditions

Run as a bounded goal-based loop (per the loop-engineering guide: deterministic stop
criteria beat vibes):

- **Stop when**: two consecutive cycles produce ZERO new CONFIRMED findings, OR the
  owner's stated quota/budget/turn cap is reached — whichever first.
- **Cycle cap default**: 5 cycles unless the owner sets otherwise.
- **Never** loop on re-verifying already-refuted candidates (keep a `seen` ledger keyed
  by claim, deduplicate against it every cycle — including refuted ones, or the loop
  never converges).

## 8. Self-supervision — the part that keeps it honest

At the TOP of every cycle, answer in one paragraph (in the working notes, not the report):
what is the goal, what did the last cycle cost and yield, which queue items are pruned
and why, what this cycle will do. If the answer to "what is the goal" has drifted from
the owner's ask — stop and realign.

Every third cycle, run a **process critique**: are the lenses producing duplicates? Is one
pattern over-mined while surfaces sit unexamined? Is the scoring rubric matching where
confirmed findings actually came from? Amend the process *for the next cycle* and record
the amendment. Proposed permanent changes to this SKILL file are surfaced to the owner as
one-line decisions, never silently self-applied.

## 9. Output contract

- **Report**: confirmed findings only, ranked by impact, each with mechanism → evidence →
  proposed fix stage (now / next PR / enrollment gate / flip gate). Plain-English summary
  up top for the owner; refuted-candidate count disclosed for honesty.
- **Ship**: for each confirmed finding, the cheapest durable artifact — a fix PR (owner
  merges), a register row, and a regression-guard test when one is cheap (the
  `sample-reconcile-extraction` guard is the model: rebuild the failure, assert it can't
  recur).
- **Log**: value-free entry in `EXECUTION_LOG.md` (cycles run, candidates generated,
  refuted, confirmed, shipped) so the next archaeology run starts from a known baseline.

## 10. Invocation

Owner says something like: *"run bug archaeology"* / *"find the bugs before they happen"*
— optionally with scope (*"on the last 3 weeks"*, *"on the PTO tracker"*, *"on the write
UI"*) and a budget (*"max N cycles"* / a findings quota). Defaults: corpus = last 3 weeks
of incidents + all open register rows touching changed surfaces; 5-cycle cap;
2-dry-cycle stop.
