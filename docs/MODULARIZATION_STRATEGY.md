# Modularizing `index.html` — parked strategy

**Status: DRAFT — parked, not ratified, not started.** Nothing here has been
built. No code has moved. This document exists so the thinking survives and can
be improved before any work begins. The owner parked it deliberately on
2026-09-13 to return to it later.

**Do not act on this document without the owner saying so in that same request.**

---

## 1. The problem

`index.html` is the whole app in one file. Measured 2026-09-13 at `14fb430`:

| Region | Lines | What it is |
|---|---|---|
| 1–198 | 198 | Head |
| 199–7,955 | ~7,700 | One CSS block |
| 8,404–81,813 | ~73,400 | One JavaScript block, ~3,271 functions |
| 81,854–82,208 | ~350 | A second, small script block |
| **Total** | **82,210** | |

There is no build step. `package.json` carries test scripts only. GitHub Pages
serves the file exactly as written on every push to `main`.

What the size actually costs us:

- Code is hard to find.
- Concurrent branches collide in the same file constantly.
- Nothing can be tested in isolation.
- The blast radius of any change is the entire app.

What the size does **not** cost us: it is not a performance problem today, and
`prod-boot-budget.js` is the thing that would tell us if that changed.

---

## 2. Two reviews, and where they disagreed

This strategy came out of a session with one model, then a second model
reviewed it independently. Both agreed on the shape: incremental extraction,
no framework, keep shipping features throughout. The review corrected three
claims, and the corrections are load-bearing.

**Correction 1 — "byte-identical source" does not prove identical behavior.**

The first proposal leaned on a check that concatenates the extracted files and
asserts they are textually identical to the original block, and called that
proof of safety. It is not. Moving code into an ES module changes strict mode,
scope, and evaluation timing. The concrete trap here: functions inside a module
are no longer global, so any `onclick="doThing()"` written directly in the
markup silently stops resolving — and it fails on the *click*, not at boot, so a
green boot check proves nothing about it. `index.html` carries 447 `id="..."`
attributes, so inline handlers are near-certain to exist in quantity.

The check is still worth building. It is a **move-integrity check** — it catches
an accidental edit during a large mechanical move, which is a real failure mode
— and that is the only thing it may be claimed to prove.

**Correction 2 — "record everything and diff it" does not survive contact.**

The first proposal suggested instrumenting the page to log every DOM mutation,
network call and console message during an interaction, approving one run as a
baseline, and diffing every later run against it. The objection: a DOM observer
does not see every state change (CSS animation, canvas, some property changes)
and may record mutations that were never painted, so "event-driven" does not
mean "no gaps". And the normalization problem is where it dies — normalize too
little and every run is noise, normalize too much and real bugs hide.

The better move is to extend `qa/temporal_lib.js`, which already exists and
already does the hard part, with **explicit behavior rules per interaction**.
For a save: acknowledged promptly · success shown only after confirmation · an
injected stale reload cannot undo it · a fresh read confirms persistence · a
rejected write shows an error and leaves a coherent state · an unauthorized role
cannot perform it. Control the delays and ordering deliberately rather than
hoping a race shows up during a recording.

**Correction 3 — the real risk is shared mutable state, not file size.**

One 82k-line file can become 100 files that still interfere with each other.
Finding code gets better; isolation does not. For every extracted feature we
have to answer: who owns this state, who may write it, and how do listeners and
subscriptions get cleaned up. That question is the actual work. The file split
is the easy half.

**Also noted:** nightly gates run after users already have the change. Behavior
gates belong before deploy. And baseline failures caused by sandbox limits must
be *classified*, not waved through.

---

## 3. The strategy

Four phases. Each is independently shippable and independently abandonable.

### Phase 1 — Map before you move

Read-only. Ships no behavior change. Produces:

- Every global variable, and who reads/writes it.
- Every inline event handler in the markup (`onclick=`, `onchange=`, …).
- Startup order: what must run before what.
- A dependency sketch per feature area.

This is the step the first proposal skipped, and it is what tells us where the
safe cuts are. Without it, the phase order below is guesswork.

### Phase 2 — Move the code out without changing how it runs

Two mechanical PRs:

1. CSS → an external `.css` file. Preserve order. Check relative asset URLs.
2. The script block → one external `.js` file, loaded as a **classic script,
   not a module**, in the same position with the same attributes.

A classic external script has the same semantics as an inline one: still
non-strict, still global scope, inline handlers still resolve. So this removes
~80k lines from `index.html` while changing nothing about execution. It proves
the plumbing (paths, caching, CI, deploy) before any semantic change.

### Phase 3 — Split into modules, one feature at a time

Order by *dependency count and test coverage*, not by line quota. For each
feature area, in its own PR:

- Decide who owns its state.
- Replace inline handlers with real event listeners.
- Extract it to a module.
- Ship it. Then the next one.

Never combine a move with a change. If a PR does both and something breaks, we
cannot tell which caused it.

### Phase 4 — Shared state last

Auth, caches, realtime, optimistic updates. The first proposal called the data
layer a "natural seam, easy to verify"; the review flagged that as unevidenced,
and it is probably the most entangled region in the file. By the time features
are out, we will know exactly what touches it. It goes last on purpose.

---

## 4. The gate

Per PR, **before merge**, not nightly:

1. **Move-integrity check** — moved source is textually identical to what was
   there. Claims only that nothing was accidentally edited.
2. **Boot** — page loads, zero JS errors (`prod-boot-budget.js`).
3. **Offline behavior gate** — `prod-write-gateway-browser.js`.
4. **Inline-handler check** — no handler in the markup references a symbol that
   is no longer global. Needed from Phase 3 onward; this is the failure mode the
   boot check cannot see.
5. **Temporal rules for the touched feature** — the Phase-2 rule set above.
6. **Visual pass** — only on CSS changes and feature extractions.

`qa/master.js --profile=full` still runs nightly on `main` as the net, not as
the gate.

Before any of this: run the suite on unmodified `main` and record what passes,
fails, and skips, with each failure classified as environmental or real. Without
that baseline we cannot tell a regression from a sandbox limit.

---

## 5. Working alongside feature development

The risk is merge conflicts in a huge file.

- Feature work always has right of way. The refactor rebases, never the reverse.
- Never refactor the area currently being built in. Check first — "nobody edits
  CSS" is an assumption, not a policy.
- Refactor PRs live hours, not days.
- A refactor PR that conflicts badly gets **closed and redone**, not resolved. A
  pure move is disposable; that is the one luxury this work has.

---

## 6. Explicitly not doing yet

- **Next.js or any framework rewrite.** It is a rewrite, not a refactor, and it
  would destroy the browser test suite at the same moment it changes the code.
  React islands or web components stay open for a specific surface later.
- **A bundler.** Vite without React is a legitimate option and can emit static
  files for Pages. But "no build step" should be a current fact, not a
  principle — revisit if the boot budget or asset versioning asks for it.
- **A universal recorder.** Strengthen `qa/temporal_lib.js` first.

---

## 7. Open questions for the owner

1. Phase 1 is pure investigation with no shipped change. Worth the cycle?
2. Which feature area is the pilot for Phase 3? It should have the best test
   coverage and the fewest globals — Phase 1 answers that.
3. Is the four-phase order right, or should Phase 2 ship on its own and the rest
   be re-decided afterward with real evidence?
4. Do we want the move-integrity check at all, given it proves less than the
   first draft claimed?

---

## 8. Known limit this does not address

A refused write leaves no server-side trace — only a 50-row `localStorage` ring
in the browser it happened in (OPEN_REPAIRS 101). Every tool discussed here runs
in our browser with our permissions, so none of it makes a client-side failure
on someone else's machine any easier to diagnose. That remains separate, and by
our own reckoning higher value.
