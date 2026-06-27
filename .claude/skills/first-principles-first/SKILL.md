---
name: first-principles-first
description: A general, always-on reasoning discipline for ANY coding decision or problem — go big-to-small. Before generating options, name what the core thing fundamentally IS (and what it already contains or guarantees), derive the properties that hold by its nature, and let those settle the decision. Prefer the simplest move those properties permit, reuse what already exists or is already proven, read what a concrete thing already contains instead of guessing, and verify the assumptions a decision truly depends on instead of asserting them. Apply by default whenever about to write code, choose an approach, debug, refactor, name something, pick a tool, or plan any change — not just one kind of task.
---

# First principles first (reason big → small)

A default habit for **every** coding decision and problem — not a special-case
procedure for one kind of task. Before you write code, choose an approach, debug,
refactor, name a thing, or pick a tool: reason from the big picture down. Start
from what the thing fundamentally **is**; let its nature settle the decision
before you generate any options.

Horizontal — it applies to the smallest choice and the largest, every time.

## The loop (run it on any decision)

1. **State the goal in one plain sentence.** Strip the framing down to what you
   actually want.
2. **Name the core thing the problem is about; ask what it fundamentally IS** —
   and what it already contains or guarantees. Define it from first principles,
   not from how it happens to be used here.
3. **Write down the properties that hold by its nature** — the things that must
   always be true of it, regardless of this situation.
4. **Check whether those properties already settle the decision.** Most of the
   time the simple right answer falls straight out and clever alternatives become
   unnecessary.
5. **Choose the simplest move those properties permit.** Reuse what already
   exists or is already proven before building anything new.
6. **Find the assumptions the decision actually depends on** — the ones that, if
   wrong, break the whole plan — and verify those by experiment, not assertion.

## The spirit of it

The most important fact in a problem is usually the nature of the thing you're
working with, and most decisions are already answered by it. You rarely need a
new mechanism — you need to notice what the existing one already guarantees.
Reaching for options first is how you talk yourself past the simple answer.
Define the thing, read its guarantees, let them decide. Options come last, if at
all.

## Anti-patterns (catch yourself doing these)

- **Options-first:** comparing approaches before you've defined what the core
  thing is. If you're weighing plans and haven't done that, stop.
- **Clever over simple:** inventing a new scheme when a basic operation already
  does the job. Fluency biases you toward the elaborate move — resist it.
- **Guessing what you could read:** a concrete thing you can inspect often
  already contains the answer — read it instead of inferring it.
- **Discarding work that's already correct or verified** to rebuild a "cleaner"
  version that yields the same result.
- **Asserting instead of verifying:** running the one check that would settle a
  claim beats stating the claim confidently.
- **Holding the key fact but not using it:** you often already have what you
  need. After step 3, ask — given what's true of this thing, what follows?
