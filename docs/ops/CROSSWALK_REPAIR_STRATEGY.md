# The card ↔ deliverable crosswalk: what is actually broken, and the order to fix it

**Status (2026-09-05): PARTLY EXECUTED. Phase 1 ran; Phase 2's migration is
WRITTEN but NOT APPLIED.** Source availability and live execution are two
different things and this line separates them deliberately:

| | State |
|---|---|
| Phase 1 (90 cards with no legacy thread) | **RAN 2026-09-04.** 172 mismatching slots → 112; 60 repaired. Owner-executed SQL. |
| Phase 2's combined RPC | **WRITTEN**, `migrations/2026-09-05-crosswalk-bind-and-import.sql`, rehearsed against a disposable PostgreSQL 16 (`scripts/crosswalk-bind-rehearsal.js`, `test/crosswalk-bind-and-import.js`). **NOT APPLIED to the live database, and no card has been repaired through it.** |
| Phase 2 (the remaining slots) | **NOT STARTED.** Needs the migration applied and a per-card call list measured fresh. |
| Phase 3 (verify) | Not started. |

~~**Status: PROPOSAL. Nothing here has been executed. No migration is written.**~~
*(Superseded 2026-09-05. Kept because the sentence was quoted as evidence the
operation did not exist; it now exists in source only.)*

**Revision 2, 2026-09-04.** Revision 1 was reviewed and four of its claims were
wrong. They are corrected below and the wrong ones are kept, struck, because one
of them would have caused a data-corrupting "repair" and the record of that is
worth more than a clean document. Background: `OPEN_REPAIRS.md` items 102, 103,
99, 100, 104.

---

## 1. The repair set — defined by the predicate, not by NULLs

Item 102 measures the whole table: 5,150 of 6,330 `deliverables` have `card_id`
NULL. That is the right number for item 102's question and the wrong one for
this repair, which is scoped to **cards on clients' calendars**.

~~The client-facing gap is 137 rows: the deliverables a calendar card points at
whose `card_id` is NULL.~~ **Wrong — a non-NULL `card_id` does not mean a valid
crosswalk.** `_prodCrosswalkMismatchFields` (index.html:25631) compares **four**
fields, and NULL-vs-set is only one of them:

| field | must equal |
|---|---|
| `origin` | `'calendar'` for the calendar surface |
| `team` | `'graphics'` for a graphic slot, `'video'` otherwise |
| `client_slug` | the card's client, exactly after trimming |
| `card_id` | the card's id, exactly after trimming |

Run over every client-calendar slot, live 2026-09-04:

| | |
|---|---|
| slots examined (739 cards × their filled slots) | **1,271** |
| deliverable row missing entirely | **0** |
| **clean under all four checks** | **1,099** |
| **MISMATCHING — the repair set** | **172**, across **153 cards** |

By reason:

| slots | mismatching fields |
|---|---|
| 134 | `card_id` + `origin` |
| 17 | `origin` |
| 8 | `card_id` |
| 8 | `team` |
| 2 | `card_id` + `team` |
| 2 | `card_id` + `origin` + `team` |
| 1 | `card_id` + `client_slug` + `origin` |

**The eight `card_id`-only rows are the dangerous ones**, and they are the eight
item 99 already recorded: a non-NULL `card_id` naming a *different* card. A
missing binding fails safe; a wrong one points confidently at the wrong place.
Revision 1 counted only the NULLs and would have left all 38 non-NULL defects
untouched while asserting the set was clean.

The remaining ~5,000 NULL rows outside this set are `manual` deliverables no
calendar card references. They cannot reach a client and are item 102's separate
question.

---

## 2. ~~A PRECONDITION: `calendar_posts.id` is not unique~~ — RETRACTED, and it would have corrupted data

~~9,909 distinct ids across 9,937 rows: 13 duplicated, one appearing sixteen
times. The backfill would name two or more rows. Phase 0 must resolve the
collisions.~~

**This was wrong, and acting on it would have been worse than doing nothing.**
`calendar_posts` has `PRIMARY KEY (client, id)`
(`migrations/live-schema-baseline-2026-07-03.sql:310`). The id is unique **per
client**, and the deliverable contract joins through `(client_slug, card_id)` —
which is why `_prodCrosswalkMismatchFields` compares `client_slug` *and*
`card_id` rather than the id alone.

Re-measured on the composite key: **`(client, id)` pairs appearing more than
once: 0.** The key holds perfectly. The 13 "collisions" are one bare id used by
up to 16 *different* clients — a per-client row, exactly as designed, and the
ledger already documents the sixteen-way one as valid data.

So "resolve the 13 collisions" would have renumbered or merged legitimate
per-client rows to fix a violation that does not exist. **Phase 0 is now:
validate the composite identity**, i.e. confirm `(client, id)` is unique and
that every repair keys on the pair, never on the bare id.

The lesson is the one this repository keeps relearning: a count is not a finding
until you know what the key is.

---

## 3. The hazard — corrected: it is the projection, not a routing inversion

Item 103 records two hazards from backfilling first. The first stands; the second
described behaviour the shipped code no longer has.

**Hazard 1 — adds refused while the canonical read is outstanding.** Stands.
With the crosswalk valid, the gate answers `{linked: true, ready: false}` until
the canonical thread is read, and `_calAppendComment` refuses on exactly that —
the client too. Transient, browser-side, and item 101 applies: nothing records it.

~~Hazard 2 — the split inverts: staff go legacy while the client goes
canonical.~~ **Not the shipped behaviour.** `_prodCommentAddRoutesLegacy`
(index.html:26068) routes legacy only when the verdict is `mismatch`; a
`legacy_retained` stamp does not send staff to the legacy lane, and the item-99
fix closed that inversion deliberately.

**The real hazard 2**, which the rehearsal must actually validate: with the
crosswalk valid but the canonical store empty, `_prodCanonicalCoversLegacy`
returns false and the read is stamped `legacy_retained`, so **the projection
keeps showing the legacy thread while new writes land canonically.** Nobody is
refused and nothing errors — the card simply displays one conversation while
accumulating another. That is harder to notice than a refusal, not easier.

One nuance worth carrying into the design: `frontDoorAdmits` treats a mismatch of
`card_id` **alone**, with the deliverable unbound, as admissible. So a pure
NULL-binding is already tolerated by the front door; it is the *combinations*
(134 of the 172 are `card_id + origin`) that are not.

Sized against the repair set, of the 153 affected cards: **63 carry legacy
comment messages (160 in total), the rest carry none.**

---

## 4. Phase 2 is not executable as revision 1 wrote it

Revision 1 said: copy the legacy thread into the canonical store first, then
backfill the binding. **The existing lane cannot do that.**
`production_comment_card_import` raises `production comment card import
crosswalk mismatch` (`migrations/2026-07-23-production-comment-thread-lifecycle.sql:689`)
when team, client_slug, card_id or origin disagree — **before it copies
anything.** So the import refuses precisely while the crosswalk is still broken,
which is the only moment the copy would be needed. And doing the backfill first
to satisfy the guard re-opens the hazard-3 window this ordering exists to avoid.

**Phase 2 therefore requires a new combined RPC** that takes the intended
binding, validates it against the card, and commits **the binding and the import
in one transaction**. That is a schema change with an owner decision behind it,
and naming it here is the point of this revision: without it there is no legal
order, and revision 1's plan would have stalled at its second step.

**That RPC is now written** (2026-09-05):
`public.production_comment_card_bind_and_import(p_binding, p_comments, p_event)`
in `migrations/2026-09-05-crosswalk-bind-and-import.sql`, service-role only.
**Written is not applied** — nothing in the live database has this function yet.

It refuses more than the first draft did, and the two additions are worth
naming here because they change what Phase 2 can finish on its own. Binding on
the card's own pointer is not enough authority: a STALE pointer that happens to
name an unbound row of the same client would have that unrelated row rewritten
and the card's conversation copied onto it. So the function also requires

  * the deliverable's `kind` to be the kind the card slot implies — `team` is
    too coarse, because `team='video'` covers `kind='video'` and `kind='other'`;
  * the card and the deliverable to name **the same Linear issue**, with either
    side missing treated as unproven rather than as permission.

These are the same two questions `scripts/f42-linkage-defect-repair.js`
(`classAObjections`) already asks before planning a Class A repair, so the SQL
repair and the JS planner now agree about what "the same work item" means.
**Consequence for the plan:** a slot that cannot prove its identity is not a
slot this RPC will repair. Those are for a person, and the Phase 2 call list has
to be measured with that in mind rather than assumed to cover every remaining
slot.

---

## 5. The order

**Phase 0 — validate the composite identity.** Confirm `(client, id)` is unique
(measured: it is), and that every statement in the repair keys on the pair.
Nothing keys on a bare id.

**Phase 1 — the 90 cards with no legacy thread.** Repair the mismatching fields
for their slots. There is no thread to strand, so the projection hazard cannot
fire, and it proves the mechanics on rows that cannot misdisplay.

**Phase 2 — the cards with threads, through the combined RPC.** ~~Blocked on
that RPC existing.~~ The RPC is written (see §4); Phase 2 is now blocked on it
being **applied** to the live database. The call list has been measured fresh
(below) rather than reused: Phase 1's 60 repairs moved the counts, so the "63
cards" above is stale. Binding plus import, one transaction, per card.

### The Phase 2 call list, measured 2026-09-05 01:48 UTC

Read-only, with the browser publishable key, over `calendar_posts` and
`production_deliverables_browser_v1` (`deliverables` itself returns 42501 to
that key). Population: 42 active client slugs, 9,937 calendar posts, **1,214
client-calendar slots that name a deliverable**, of which **107 mismatch** on
`_prodCrosswalkMismatchFields`. Each is then run through every guard the RPC
enforces, in the order it enforces them:

| Outcome | Slots |
|---|---|
| **REPAIRABLE** — no legacy thread to carry | 22 |
| **REPAIRABLE** — has a legacy thread, needs the combined call | 20 |
| Refused: `kind_does_not_match_slot`, deliverable `kind='other'`, Linear identity AGREES | 26 |
| Refused: `kind_does_not_match_slot`, video slot naming a `kind='thumbnail'` row, Linear identity AGREES | 14 |
| Refused: `slot_occupied` | 18 |
| Refused: `already_bound_elsewhere` | 5 |
| Refused: `client_mismatch` | 1 |
| Refused: `linear_identity_unproven` | 1 |

**42 of 107 the RPC can repair unattended.** The identity requirement added on
2026-09-05 costs exactly one slot (`linear_identity_unproven`), so it is close
to free — the guard's value is that it makes the other refusals trustworthy,
not that it excludes work.

**The 40 kind refusals are one owner decision, not forty investigations, and
they are the largest single block.** In all 40 the card and the deliverable
name the SAME Linear issue, so these are not stale pointers aimed at innocent
rows — they are rows whose `kind` disagrees with the slot holding them. The
live vocabulary explains why: `graphics/thumbnail` is the normal shape (2,326
rows) but **173 graphics rows carry `kind='other'` and 81 video-team rows carry
`kind='thumbnail'`**. So the question is whether `other` is a mis-classified
thumbnail (fix the kind, then these 26 repair normally) or a genuinely
different artifact (leave them). The 14 video-slot rows pointing at a
`thumbnail` row are the more suspicious half and should be looked at as a group.
`scripts/f42-linkage-defect-repair.js` already refuses this whole class for the
planner, so the RPC refusing it is consistency, not a new restriction.

**The other 25 need a person for substantive reasons** — a contested slot, a
deliverable already bound elsewhere, a cross-client reference (the one item 147
§2 records), and one slot where neither side names an issue.

**Phase 3 — verify against the predicate.** `_prodCrosswalkMismatchFields` must
return empty for all 1,271 slots. Item 99's lesson: do not relax a readback to a
row count.

**Rehearsal first, each phase.** The repo has the pattern
(`scripts/component-fill-rehearsal.js`, `f42-apply-rehearsal.yml`): a dry run
that reports what it would write and changes nothing. §1's table is the expected
shape to compare against, and the eight wrong-`card_id` rows should be listed
individually for a human to look at before anything writes — a wrong binding may
be evidence of something other than drift.

---

## 6. The long-term answer

Two stored columns that must agree is a bug class, not a bug: written by
different code at different times, nothing enforcing the match, drift only ever
found afterwards. Cheapest first:

1. **Guard it** — fail when a card names a deliverable that does not name it
   back, using the real four-field predicate rather than a NULL check. Smallest
   change, same shape as the guards already running here, and it should exist
   whichever of the next two is chosen. Revision 1's error is the argument for
   it: a NULL check would have reported this repair complete with 38 defects
   still in place.
2. **Write both sides in one transaction**, in a database function.
3. **Stop storing it twice** — derive the deliverable→card direction from the
   card side, which is the populated one.

**And the generator: B1 imports a Linear issue into a deliverable no SyncView
card ever produced**, which is where the ~5,000 unreferenced `manual` rows come
from. The Linear exit removes it, so that population stops growing as a side
effect of work already planned. That argues for the exit before any large
backfill, and for keeping this repair scoped to what a client can see.

**Recommendation:** the guard now regardless; Phase 0 and 1 next; Phase 2 only
once the combined RPC is agreed; structural change after the Linear exit.
