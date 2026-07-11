---
name: feedback-expansion
description: Turn raw, lazy owner feedback about a UI surface — observations written while using the live page beside its reference — into the RULE behind each observation, swept across the whole surface, expanded recursively into sibling rules until dry, gated against the reference and the owner-ratified boundaries, implemented artifact-first, and proven with machine assertions + master-test + human-audit. Every generalization the executor chooses NOT to build (or that is taste/ambiguous) is surfaced as a one-line owner decision so a wrong leap is vetoed, never silently shipped. General protocol for any wired-page-vs-reference pair; ships with a binding for the SyncView Production tab (?prod=1) vs real Linear. Use when the owner hands unstructured observations and wants connect-the-dots expansion, not literal one-element patches. Pairs with /master-test (whole-app health) and /human-audit (hand-and-eyes parity).
---

# Feedback Expansion — one observation becomes the whole rule, swept and proven

The owner is the **eyes**: they use the live page beside its reference and write down what
they don't like, lazily and unstructured. You are the **reasoning and the hands**: you do
NOT patch the sentence they wrote — you find the rule behind it, apply it everywhere it
belongs, push it recursively to the sibling rules it implies, and prove every fix. A single
observation is a sample of a rule, never the whole job.

Two hard-won constraints shape everything below:

- **Recursion generates candidates; gates decide adoption.** Expanding rules into sibling
  rules is unbounded creativity. What ships is bounded by the reference, the owner-ratified
  boundaries, and the owner's veto. The system's imagination is infinite; its *authority* is
  zero. That is the safety model — it turns over-reach risk into a controlled input.
- **This will outlive one context window.** A multi-generation sweep and multi-PR round is
  larger than any single run. An external state ledger is mandatory, not optional.

## TARGET BINDING (what varies per surface — default: Production tab)

- **Wired surface:** `index.html?prod=1` (the Production tab).
- **Reference:** real Linear, observed live and read-only.
- **Boundary doc:** `docs/independence/TRACK_B_LINEAR_REPLACEMENT_SPEC.md` §10.8 — the
  owner-ratified simpler-tool boundary (Linear wins only on look/feel/interaction of KEPT
  surfaces) and the artifact-first transplant rule.
- **Design artifact:** `docs/syncview-design/SyncView.html` (changed FIRST for anything
  that alters look/behavior, then transplanted to the wired `_prod*` tab with
  `// PORT-DELTA:` comments only where live data forces deviation).
- **Assertion lanes:** `behav-wired`, `prod-structure-subset`, `pixel-wired`
  (in `docs/syncview-design/tests/`) — suites only grow, never shrink.
- **Gate set per PR:** `npm test` (includes `test/port-fidelity-check.js`),
  `npm run test:prod-polish` (the full behavior/pixel/structure/layout/a11y/boot battery),
  `node docs/syncview-design/tests/prod-readonly-smoke.js` (zero non-GET),
  `git diff --check`, secret/model-id scan.
- **Write policy:** the surface is READ-ONLY (the Production read-only contract — distinct
  from the live-backend QA contract of `docs/testing/HEADLESS-TESTING-GUIDE.md` §5).
  Write-implying rules are PHASE-BOUNDED (stage 4) until a writable milestone is explicit.

To run this protocol on another surface, restate this block for it (surface, reference,
boundary doc, artifact-or-direct, assertion lanes, gate set, write policy) and leave every
stage below unchanged.

## GOAL (optimize toward this state, not toward executing steps once)

You are done ONLY when: (a) every feedback item maps to an extracted rule; (b) every rule
and every gate-passing descendant rule has been swept across the FULL surface; (c) every
inventory row is resolved as FIXED, PHASE-BOUNDED, BLOCKED, or OWNER-LISTED; and (d) one
further full expansion pass yields zero new gate-passing rows. Or you are blocked on owner
input. Never stop merely because the stages below ran once — that is the failure mode this
skill exists to prevent.

## STATE LEDGER (context-loss insurance — do this first, every round)

Create/load a PRIVATE local ledger file (never committed — raw feedback may contain client
names). It records: feedback items; rules with their generation number and gate verdicts;
the sweep inventory (element × location × current behavior × target behavior × reference
behavior × status); PRs opened; and the owner decision list. Update it after every stage.
**On any resume or restart, re-read the ledger FIRST** and continue from recorded state —
never restart from memory. If context is degrading, finish the current rule-group cleanly,
write the ledger, and report what remains.

## THE ROUND LOOP

**1 · INTAKE.** Parse the feedback into discrete items. REPRODUCE each on the real UI
(headless, established harness patterns) before touching anything. An item you can't
reproduce goes to the report as unreproduced — never fix what you haven't seen.

**2 · ORIENT (bigger before smaller).** Place each item in the surface hierarchy: shell →
view → region → component → element. Name the element's CLASS in the design's own
vocabulary (a navigation crumb, a state chip, a filter control, a group header, a
picker…). The class determines how far a rule reaches.

**3 · EXTRACT (generation 1).** Climb exactly ONE abstraction level: from "this element
doesn't do X" to "elements of this CLASS should do X." Write each rule as ONE testable
sentence. Merge items that share a rule. Do not climb two levels — a rule that covers the
whole app is a sign of over-generalization.

**4 · GATE every rule (any generation, same gates, no exceptions):**
- **Reference:** what does the binding's reference do for this element class? (live,
  read-only observation). Reference agrees → *ratified*. Reference disagrees or is silent →
  *OWNER-LISTED*, not built (the boundary doc decides what the reference is allowed to win
  on).
- **Boundary:** collides with a removed feature class or an owner-ratified rule (skeleton
  removals, read-only guard)? → *BLOCKED*, recorded with the rule it hit.
- **Write-implying:** the interaction ends in a mutation? → *PHASE-BOUNDED*: build the full
  affordance up to the write boundary (it opens / previews / navigates; the final mutation
  lands on the existing read-only guard exactly like other guarded controls). The affordance
  ships now; the write ships at the writable phase.

**5 · SWEEP each ratified rule across the ENTIRE surface.** Systematic walk: shell → views →
lists/boards → rows/cards → detail → popups/pickers → empty states. Every element the rule
touches becomes an inventory row. The element the owner named is ONE row, never the job. A
sweep that returns only the named element is a failed sweep.

**6 · EXPAND (generation N+1) — the recursive step.** From this generation's RATIFIED rules,
derive candidate SIBLING rules: same logic on an adjacent element class; same intent one
structural level deeper. Feed every candidate back through stage 4's gates, then stage 5's
sweep if ratified. Termination: a generation that produces ZERO ratified rules ends
expansion; hard cap of 3 generations per round regardless. Candidates that fail the gates
are NOT discarded — they go in the report, visible and unbuilt.

**7 · IMPLEMENT + land incrementally.** One draft PR per coherent rule-group (not per
feedback line, not one mega-PR — PRs are your crash checkpoints). Artifact-first per the
binding: change the design artifact first for anything that alters look/behavior, then
transplant to the wired surface; `// PORT-DELTA:` where live data forces deviation; never
weaken the read-only guard; never touch runtime flags, backend, n8n, or Linear wiring from
this work. Checkpoint the ledger after each PR.

**8 · PROVE.** Every FIXED inventory row gets a machine assertion in the binding's
assertion lanes (suites only grow, never shrink). Run the binding's full gate set per PR.
Then run `/master-test` and a `/human-audit` pass over every surface you changed.

**9 · REPORT (audited — the reviewer re-derives your sweep; gaps are protocol violations).**
Per feedback item: raw quote → reproduced? → rule (+ generation) → gate verdicts → inventory
count (how many sibling elements found) → per-row outcome (fixed / phase-bounded /
blocked-by-rule / owner-call) → assertions added. Then the consolidated **OWNER DECISION
LIST**: every OWNER-LISTED rule and every gate-failed candidate, each with a one-sentence
recommendation, so the owner approves or vetoes each expansion explicitly. "Nothing found"
is a claim — state it as one; it can be wrong.

**10 · SELF-APPLICATION (last stage, every round).** Apply stages 2–4 to THIS protocol and
to the round you just ran: what rule about the feedback PROCESS does this round's experience
imply? Propose concrete amendments to this skill in the decision list. NEVER self-modify
mid-run — the owner ratifies, the skill's version note bumps, the next round runs the new
version.

## Stop conditions

Goal state reached; or owner input required to proceed; or context degrading — then finish
the current rule-group cleanly, write the ledger, and report exactly what remains. Never
stop silently mid-sweep.

## Rails (standing, non-negotiable)

Public repo — no secrets, no client names/data in code, tests, committed screenshots, or PR
text (TEST-client `sidneylaruel` / dummy data only); screenshots stay local; live-reference
probing is observation-only on real data; read-only surfaces stay read-only; no runtime flag,
backend, n8n, or Linear-wiring changes; no model identifiers anywhere. Owner merges every PR.

## Why this shape (for a future editor of this skill)

It is written as a GOAL + LOOP, not a checklist, because an AI given steps runs them once and
stops; a goal makes the loop the natural behavior. The ledger exists because a real round has
already outlived a single context window. The generation cap and dry-out rule bound the
recursion so it can't run forever or drift into a redesign. The audited report + owner
decision list keep the owner's taste — not the executor's consistency — the final authority.
The target binding is separated from the loop because the loop is portable; only the
surface, reference, and gates change between targets.
