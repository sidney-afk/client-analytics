---
name: site-assurance
description: The umbrella loop that keeps the WHOLE website at its owner-ratified quality contract (docs/QUALITY_TIERS.md). Each cycle - read the contract and the coverage ledger, score every surface by tier weight x proof staleness x recent churn, prove the top surfaces with the right existing tool (/master-test lane, /human-audit, /overnight-test probes, /bug-archaeology pattern sweep, or a new targeted probe), file verified findings as fixes + guards, update the ledger, repeat until every Tier 0-1 surface is freshly proven and two cycles run dry, or the budget cap hits. Use when the owner asks to "check the whole website", "make sure everything still works", or wants systematic whole-site confidence rather than history-driven bug hunting (that is /bug-archaeology - the two compose).
---

# Site assurance — the whole site, held to its contract

`/bug-archaeology` reasons **from history** (what broke predicts what breaks). This skill
reasons **from the map** (here is everything the site is — is each part keeping its
promise?). They compose: archaeology's fracture patterns are one of this loop's proving
tools.

**This skill orchestrates; it does not duplicate.** Its job each cycle is to pick the
right target and dispatch the right existing prover, then account for the result.

## 0. Safety (identical to the house rules; non-negotiable)

Read-only live access; guarded writes only on the TEST client when the mandate includes
drills; ⛔ client-writer freeze binds all recommendations; no secrets/client names/HR
values in committed artifacts; fixes ship as PRs the owner merges.

## 1. Ground truth inputs

- **The contract:** `docs/QUALITY_TIERS.md` — tiers, promises, freshness windows,
  cross-tier invariants. If a surface is missing from the contract, surface a one-line
  owner decision to place it; do not self-assign.
- **The map:** `docs/truth/BRIEFING.md` first, then `docs/independence/SYSTEM_MAP.md`
  and the truth docs — the current-state description of every surface.
- **The ledger:** `docs/testing/ASSURANCE_LEDGER.md` — one row per surface: tier, last
  proven (date + method + evidence link), verdict, open gaps. Create it on first run by
  back-filling from EXECUTION_LOG verification records; keep it honest (an expired proof
  is an expired proof).

## 2. The cycle

1. **Refresh the ledger** against reality: expire rows past their tier's freshness
   window; mark surfaces touched by merges since the last run as CHURNED (a fresh proof
   predating a change to that surface is stale regardless of date).
2. **Score every surface:** tier weight (T0=8, T1=4, T2=2, T3=1) × staleness (expired=3,
   near-expiry=2, fresh=1) × churn (changed since last proof = ×2). Work the top of the
   list; 1–3 surfaces per cycle, never more.
3. **Prove with the right tool** — the cheapest tool that honors the tier's promise:
   - Data/flow correctness → the relevant `qa/` lane or a targeted read-only probe;
     `/master-test` when the whole app should be swept in one shot.
   - Human experience → `/human-audit` (hand-and-eyes) or the PTO-style lifecycle
     simulation pattern (mocked-lane matrix + minimal disposable live smoke).
   - Latent-defect suspicion → the relevant `/bug-archaeology` fracture patterns,
     swept over just this surface.
   - No prover exists → write the missing probe (it becomes a permanent asset) rather
     than proving by hand once.
4. **Account:** verified findings → fix PR + regression guard + register row (the
   `/bug-archaeology` gate applies: adversarially verify before calling anything a
   finding). Update the ledger row (date, method, verdict, evidence). Value-free
   EXECUTION_LOG line per cycle batch.
5. **Self-supervise** (top of every cycle, one paragraph in working notes): goal, last
   cycle's cost/yield, prunes, this cycle's picks. Every third cycle: process critique —
   is scoring matching where real findings come from? Propose amendments as owner
   one-liners.

## 3. Stop conditions (deterministic, decided before starting)

Stop when **either**:
- every Tier 0 and Tier 1 surface is within its freshness window AND two consecutive
  cycles produced zero new confirmed findings; **or**
- the owner's budget/cycle cap is reached (default cap: 6 cycles per run).

Tier 2–3 staleness never extends a run on its own; it queues for the next run.

## 4. Output contract

- **The ledger is the deliverable** — after every run the owner can read, in one table,
  what is proven, how, how recently, and what is not.
- Plain-English run summary for the owner: what was proven, what was found (confirmed
  only; refuted count disclosed), what expired and was not reached, recommended next run
  date.
- Never claim "the site works" — claim exactly which promises were verified, when.

## 5. Invocation

Owner says: *"run site assurance"* / *"check the whole website"* — optionally with focus
(*"staff surfaces"*, *"client-facing only"*), budget (*"max N cycles"*), or drill
permission (*"TEST drills allowed"*). Defaults: all tiers by score, 6-cycle cap, no live
drills beyond read-only probes.
