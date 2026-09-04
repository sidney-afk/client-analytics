# The card ↔ deliverable crosswalk: what is actually broken, and the order to fix it

**Status: PROPOSAL. Nothing here has been executed. No migration is written.**
Owner asked for the strategy first, and for it to be reviewed before any of it
runs.

Background is `OPEN_REPAIRS.md` items 102 (the root), 103 (the ordering hazard),
99, 100 and 104 (the symptoms). This file exists because item 102 ends with *"this
is an architecture decision with a data migration behind it, and it is not a
change to make unattended"* — so this is the decision written down, with the
population measured rather than assumed.

---

## 1. The headline number is misleading for the thing the owner cares about

Item 102 measures the whole table: **5,150 of 6,330 `deliverables` have
`card_id` NULL**, 81%. True, and alarming, and *not* the number that matters
here. The owner's scope is explicit: **cards on clients' calendars**. Measured
2026-09-04 against live:

| | |
|---|---|
| `calendar_posts` rows | 9,937 |
| cards carrying at least one `*_deliverable_id` | **739** |
| distinct deliverables those slots reference | **1,261** |
| of those, rows that do not exist (dangling) | **0** |
| of those, already carrying `card_id` — the crosswalk is ALREADY two-way | **1,124** |
| **of those, `card_id` NULL — the actual client-facing gap** | **137** |

**The client-facing repair is 137 rows, not 5,150.** All 137 are
`origin = 'manual'`; 71 graphics, 66 video. The remaining ~5,013 NULL rows are
`manual` deliverables that no calendar card references at all — nothing a client
can see, and out of scope for this repair. They are item 102's separate question
about where they come from.

By status, the 137: 51 posted, 27 client approval, 19 approved, 14 SMM approval,
9 todo, 8 tweak, 4 backlog, 3 scheduled, 2 canceled.

---

## 2. A PRECONDITION nobody had found: `calendar_posts.id` is not unique

Measured across all 9,937 rows: **9,909 distinct ids. 13 ids are duplicated,
accounting for 28 extra rows, and one id appears 16 times.**

This is load-bearing and it is why this document exists rather than a one-line
`UPDATE`. The backfill writes `deliverables.card_id = <card id>`. For a
duplicated id, the resulting binding names **two or more rows** — which is
exactly the `rows.length !== 1` condition item 100 is about, and the repair
would therefore *manufacture* the ambiguity that item 100 spent three rounds
learning to report honestly.

At least one of the 13 is already inside the client-calendar set: one duplicated
id carries **two different video deliverables and two different graphic
deliverables** across its two rows, so "the card knows its deliverable" is
already ambiguous for it today.

**Phase 0 is therefore not optional.** Either the 13 collisions are resolved
first, or the binding is keyed on something that is unique. Nothing else in this
plan may run before that, and a repair that skips it is worse than no repair.

---

## 3. Why the obvious fix makes things worse — item 103, now with numbers

The tempting move is to backfill `card_id` and stop. Item 103 records two ways
that misfires; both were read out of code at HEAD, and this measurement says how
many rows each applies to.

**Hazard 1 — every add refused while the canonical read is outstanding.** With
the crosswalk valid, `_prodCanonicalCommentGate` returns
`{linked: true, ready: false}` until the canonical thread has been read, and
`_calAppendComment` opens by refusing on exactly that. It refuses the **client**
too. This is a transient window rather than a permanent break, but it is a
larger blast radius than the bug it replaces and it is browser-side, so item 101
applies: nothing records it.

**Hazard 2 — the split INVERTS, permanently.** Once the read completes with
canonical empty and legacy non-empty, `_prodCanonicalCoversLegacy` returns false,
the read is stamped `legacy_retained`, and the gate answers `linked: false` even
though the crosswalk is now clean. Staff then go legacy while the client — who
consults the crosswalk directly and never the gate — goes canonical. Same bug,
opposite sides.

Hazard 2 needs **canonical empty AND legacy non-empty**. So it applies to
exactly the cards that already carry a legacy thread. Measured, of the **121
cards** those 137 deliverables sit on:

| | |
|---|---|
| cards carrying legacy comment messages | **63** |
| total legacy messages on them | **160** |
| cards with no legacy thread at all | **58** |

Those 63 by card status: 15 archived, 14 in progress, 13 client approval, 12
posted, 5 approved, 4 tweaks needed.

---

## 4. The order

**Phase 0 — make the key trustworthy.** Resolve the 13 duplicated
`calendar_posts.id` values, or establish a unique key for the binding. Verify by
re-running the uniqueness count to zero. *Nothing proceeds until this is clean.*

**Phase 1 — the 58 cards with no legacy thread.** Backfill `deliverables.card_id`
from the card side for their deliverables only. Hazard 2 cannot fire: there is no
legacy thread to strand, so canonical-empty is the correct state rather than a
lie. Hazard 1's loading window still applies and is accepted as transient.
Smallest possible first slice, and it proves the mechanics on rows that cannot
invert.

**Phase 2 — migrate 160 messages, then backfill the remaining 63.** Copy each
card's legacy thread into the canonical store FIRST, so that when the crosswalk
goes valid the canonical read finds content and `_prodCanonicalCoversLegacy`
answers true. Then backfill those 63 cards' deliverables. Per card, in one
transaction, so a card is never left with a valid crosswalk and an empty
canonical thread — that state is precisely hazard 2.

**Phase 3 — verify against the predicate, not against a row count.**
`_prodCrosswalkMismatchFields` must return empty for every one of the 739
client-calendar cards. Item 99's own lesson applies: *do not relax a readback to
a row count* — check the value the row actually holds.

**Rehearsal before any of it.** This repo has the pattern
(`scripts/component-fill-rehearsal.js`, `f42-apply-rehearsal.yml`): a dry run
that reports exactly what it would write and changes nothing. Phase 0 through 3
each get one, and the numbers in §1–§3 are the expected shape to compare against.

---

## 5. The long-term answer — how this never happens again

The backfill is a repair, not a fix. The owner's actual question is why the
estate got here, and the answer is structural in three parts.

**Two stored columns that must agree is a bug class, not a bug.** `card.*_deliverable_id`
and `deliverable.card_id` are written by different code at different times and
nothing enforces that they match, so drift is not a possibility, it is a
certainty on a long enough timeline — and it can only ever be found afterwards.
The durable shapes, cheapest first:

1. **Guard it** — a check that fails when a card names a deliverable that does
   not name it back. This is the smallest change, it is the same shape as the
   guards this repo already runs, and it converts a silent decay into a red
   build. It should exist regardless of which of the next two is chosen.
2. **Write both sides in one transaction**, in a database function, so a card
   and its deliverable cannot be created half-linked.
3. **Stop storing it twice.** The card side is the populated side — 739 cards
   name their deliverables, and 1,124 of the 1,261 already agree. Deriving the
   deliverable→card direction from the card side removes the disagreement by
   removing the second copy. This is the real answer and the largest change.

**Where the 5,013 unreferenced `manual` rows come from — and why the Linear exit
removes the generator.** They are `origin = 'manual'` with no card because they
were imported from Linear by B1, which creates a deliverable for a Linear issue
that no SyncView card ever produced. That import is the thing manufacturing
rows with nothing to bind to. **When Linear goes, so does the generator** — which
means the crosswalk problem stops growing on its own as a side effect of work
the owner is already doing. That is an argument for doing the Linear exit
*before* any large-scale backfill of the ~5,013, and for scoping this repair to
the 137 that a client can actually see.

**Recommendation.** Guard (1) now, regardless. Repair the 137 in the phased
order above. Defer (2) and (3) until after the Linear exit, when the write paths
that would have to change are the ones that will survive.
