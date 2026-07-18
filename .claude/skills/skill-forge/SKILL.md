---
name: skill-forge
description: The house method for turning the owner's spoken intent into a new durable skill (or improving an existing one). Use whenever the owner says "create a skill for/of X", "make this a skill", "we should have a skill that…", or describes a working method they want to reuse ("document this way of working"). Encodes the two things that make a skill OURS - the amplification intake (the owner's examples are pointers into a space, not the list) and the house invariants every skill must carry (bounded loops, deterministic stops, adversarial verification, owner one-liners, public-safety, ship-as-PR, results feed the vault). Also governs agent-initiated skills - the agent may DRAFT a skill proactively when it notices the same method being re-derived, but it ships as a PR the owner ratifies. Pairs with every other skill: this is the one that writes them.
---

# Skill-forge — the skill of making skills

Why this exists (owner, 2026-07-18): *"The more I create skills with you, the better
you're gonna be. Maybe we could create together a skill that you would use to create
skills… that way I just have to tell you 'create a skill of that' and you would
already know what to do."* Full intent: `docs/vision/STEP_BACK_2026-07-18.md`.

## Step 0 — Amplify the ask (ALWAYS first)

The owner explains by example, and the examples are **pointers, not the list**:

1. Name the concept the examples point at (not the examples themselves).
2. Enumerate the space: what else lives inside that concept? Generate wide — a
   dozen candidates costs nothing.
3. Filter for value: keep what serves the owner's actual goal; name what you are
   deliberately excluding and why (silent narrowing is the failure mode being
   corrected; silent bloat is the overcorrection).
4. Present the amplified map with provenance — *owner-named* vs *amplified* — and
   where a kept/cut call is genuinely taste, surface it as an owner one-liner
   instead of deciding silently.

This step applies to every owner brief, skill-related or not (vision doctrine #4).

## Step 1 — Mine the house before writing

- Read the existing skills (`.claude/skills/*/SKILL.md`): does one already cover
  part of this? **Compose, don't duplicate** — new skills state what they do that
  siblings don't, and add "pairs with" lines both ways.
- Read `docs/QUALITY_TIERS.md` (the prioritization contract every QA skill obeys)
  and `docs/vision/` (the standing doctrines).
- A skill that overlaps an existing one is an EDIT of that one, not a new file.

## Step 2 — The house invariants (every skill carries these)

1. **Safety block first**: read-only against live systems by default; guarded
   writes only on the TEST client under an explicit drill mandate; ⛔ the frozen
   client writers are never "fixed" by a skill; no secrets / client names / HR
   values in committed artifacts (public repo).
2. **Bounded loop**: deterministic stop conditions decided before starting (dry-
   cycle rule and/or cycle cap) — a skill that can wander is not finished.
3. **Findings earn their name**: candidates pass an adversarial verification gate
   before being reported; refuted counts are disclosed.
4. **Owner one-liners**: decisions the skill cannot self-assign (product taste,
   tier placement, live-state changes) are surfaced as one-sentence questions,
   never absorbed.
5. **Ship as PR**: artifacts land as draft PRs the owner merges; the cloud
   reviewer verifies independently before merge.
6. **Feed the vault**: durable results go into the documented layer (truth docs,
   registers, EXECUTION_LOG value-free entry) before the session ends.

## Step 3 — Structure (what a SKILL.md looks like here)

- Frontmatter `description` is written for the trigger-matcher: concrete "use
  when the owner says…" phrases, plus what it does NOT cover (its siblings).
- Body: why-it-exists (one paragraph, quote the owner when the skill was owner-
  conceived) → safety → ground-truth inputs → the method/loop → stop conditions →
  output contract → invocation examples with defaults.
- Length: long enough that a cold session can run it alone; short enough to be
  read in two minutes. Link, don't inline, anything that already lives in a doc.

## Step 4 — Dogfood and register

- Run the new skill's own checklist against itself once (this file passed its own
  Step 0–3 before shipping).
- Propose the listing updates (`REPO_MAP.md` skills row, `docs/testing/README.md`
  if it is a QA skill) in the same PR — never leave the maps stale.

## Agent-initiated skills (the owner's "skills for yourself")

The agent may DRAFT a skill unprompted when it catches itself or another session
re-deriving the same method a second time — that repetition is the signal. The
draft ships as a PR with the trigger story in its description; **the owner's merge
is the ratification**. No skill self-applies silently, and no skill edits another
skill's mandate without an owner one-liner.

## Invocation

Owner: *"create a skill for X"* / *"make this a skill"* / *"we should have a skill
that…"* — or agent-initiated per the rule above. Output: the SKILL.md (+ listing
updates) as a PR, plus a three-line plain-English summary of what the skill will do
the next time it fires.
