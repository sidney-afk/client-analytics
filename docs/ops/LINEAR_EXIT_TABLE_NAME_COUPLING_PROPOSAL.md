# The table-name coupling: declare it, and how

**PROPOSAL ONLY. Nothing here is implemented, and one question at the end is
the owner's to answer before anything is.** Written for owner ruling 3 of
2026-09-16: *the four-place table-name coupling gets declared rather than
patched — either the four derive from one source, or something asserts they
agree; propose which before implementing.*

**The recommendation is ASSERT, not derive.** The reasoning is in §3, and it
turns on a fact about one of the places that makes deriving actively wrong
rather than merely harder.

---

## 1. First, a correction to my own count: it is THREE places, not four

The sweep's summary said the same table-name set is written down in four places:
the guard list, the corpus, and "two catalog-name comparisons". **Measured
properly, the two comparisons are not independent writings of the set — they are
both consumers of the corpus.** There are **three** independent writings.

| # | Place | Count today | What kind of thing it is |
|---|---|---|---|
| 1 | `supabase/migrations/20260912183653_application_dml_admission_preparation.sql`, the `foreach` list | **87** | A hand-maintained enforcement list, in SQL, inside a pinned migration |
| 2 | `docs/independence/LINEAR_EXIT_COMPLETE_APPLICATION_DATA_V1.json` `tables` | **86** | A reviewed custody corpus, hash-pinned, read by `expectedNames()` |
| 3 | `docs/independence/LINEAR_EXIT_SOURCE_BASELINE_CATALOG_V1.json` `catalog.tables` | **86** | **An observation.** A captured catalog from a real cluster, hash-pinned |

Measured relations, both directions, today:

- **2 and 3 are the same set exactly.** Zero difference either way. (The prior
  survey established this too and it still holds.)
- **1 is 2 plus exactly one name**, `hiring_practical_test_jobs`, and nothing
  in 2 is missing from 1.
- `LINEAR_EXIT_COMPLETE_APPLICATION_DATA_V2.json` is 2 plus exactly four
  `card_write_*` names. It is a fourth file but a **declared** derivation — its
  own `basis` field says "reviewed V1 inventory plus four source-owned admission
  tables" — so it is not part of the undeclared problem.
- `test/helpers/remaining-application-fixture.js` `TABLES` is 22 names and a
  **proper subset** of 2. It seeds rows; it does not claim to be the set.

**The consumers**, which are what actually fail:

- `scripts/linear-exit-complete-application-data.js:29`, inside `captureRows()`
  — compares a live catalog's names to `expectedNames()`. This is survey site 9.
- `test/linear-exit-source-phases-postgres.js:26` and
  `test/linear-exit-source-baseline-catalog-postgres.js:5` — the two suites B10
  broke.

**A warning about counting consumers, earned twice now.** A grep for
`captureRows` returns four files. Three of them are noise:
`linear-exit-complete-application-data.js` *defines* it, and
`linear-exit-credential-capture.js` and `linear-exit-priority-capture.js` each
define their **own unrelated function of the same name**. Exactly one repo-side
caller reaches site 9, `scripts/linear-exit-control-companion.js`. The prior
survey said so, was corrected once for over-reporting consumers by name-matching,
and was right. This proposal's grep reproduced the same over-report. **Name
matching measures which files mention a symbol, never which reach the code.**

---

## 2. Why "derive from one source" is the wrong answer here

It is the instinctively better engineering answer and it fails on this shape,
for two independent reasons. Either alone is sufficient.

### 2.1 One of the three is evidence, and evidence cannot be generated

`LINEAR_EXIT_SOURCE_BASELINE_CATALOG_V1.json` is not a list somebody wrote. It
is a **captured catalog** — the recorded observation of a real cluster, written
by a run, carrying columns, ACLs and ownership alongside the names.

Deriving it from the corpus would mean writing the names we expect into an
artifact whose entire value is that it reports the names we **found**. It would
still be called evidence and would no longer be evidence.

This repository decided this exact question earlier today, in a different
costume, and decided it the other way: a dated proof record must be **re-run,
never edited**, because *"overwriting the dated file would be the same
falsification with extra steps."* Generating a captured catalog from a list is
that same falsification. Consistency with a decision taken ten hours ago is the
cheapest kind of correctness available.

### 2.2 Generating the guard list would detonate the pin chain on every corpus edit

The guard list lives inside
`20260912183653_application_dml_admission_preparation.sql`, and that migration
is **install-plan source #2**. Its bytes are embedded in the plan, so its hash
feeds the plan hash, which feeds every profile's plan pin, which feeds every
profile's target.

B10 measured exactly what that costs: editing that one file moved all three
profile plan hashes, invalidated all three targets, required a real install run
per profile on the owner's machine to re-derive them, and left the 2026-09-13
pipeline proof failing its own `SOURCE_PIN` gate.

**Generating the guard list from the corpus would make every corpus edit pay
that price**, automatically and by design. A custody corpus should be able to
gain a table without triggering three target re-derivations on a Windows
machine. Today it can. Under "derive", it could not.

---

## 3. The proposal: declare the relation, assert it, in the lane that runs

### 3.1 The shape

One new **offline** check — no PostgreSQL, no private inputs, no cluster —
that reads the three sets from their files and asserts the declared relation
between them. It would live in the **unit lane**, not the deferred set.

That last point is the entire value. Today's finding is that the checks
encoding a world literal are the checks nobody runs: 18 of the 61 deferred
suites carry one, and all three suites B10 broke are in that 61. **A coupling
assertion that lands in the deferred set would reproduce the exact failure it
exists to prevent.** This one is pure file reading, so it has no reason to be
deferred and every reason not to be.

### 3.2 What it would assert

| Assertion | Why |
|---|---|
| set(2) == set(3) | Measured true today. If a capture ever disagrees with the corpus, that is a real finding about the world, and it should surface as a named failure rather than as two suites failing on a diff |
| relation(1, 2) holds — **see §4, the open question** | This is the one that broke |
| set(V2) == set(2) + the four declared `card_write_*` names | Turns V2's prose `basis` field into a checked claim |
| fixture `TABLES` ⊆ set(2) | Measured true today; cheap; keeps the fixture honest as the corpus moves |

Each failure names the **relation** that broke, not a number. `87 !== 86`
tells a reader nothing about which of three files is wrong; "the admission
guard covers a table the custody corpus does not" tells them exactly.

### 3.3 What it deliberately does NOT do

- It does not move, merge or regenerate any of the three files.
- It does not touch the migration, so **no plan or target pin moves**. This
  proposal is free of the B10 blast radius, which is most of why it is the
  recommendation.
- It does not replace the existing consumer checks. Site 9 and the two suites
  keep working as they do; this check simply fails **first, offline, and in a
  lane that runs**, so the coupling is caught at the edit rather than at the
  next install rehearsal.
- It does not decide what the relation should be. That is §4.

---

## 4. THE OPEN QUESTION, which is the owner's and which blocks implementation

**Is the intended relation between the admission guard list and the custody
corpus EQUALITY, or CONTAINMENT?**

They were equal for the whole history before B10. They are now guard = corpus + 1.

- **If equality**, then the corpus is simply behind and should gain
  `hiring_practical_test_jobs`, which is also what ruling 4 implies when the
  three broken suites are re-based onto the settled world. The check asserts
  `==` and today's divergence is a bug to close.
- **If containment** (`guard ⊇ corpus`), then the two sets answer different
  questions — *what must be admission-guarded* versus *what must be captured for
  custody* — and they are allowed to differ. The check asserts `⊇`, and today's
  state is legal. But then something must say **why** this table is guarded and
  not captured, because a table that is guarded but never backed up is a real
  asymmetry and possibly a worse bug than the one we started with.

**I am not guessing at this, and the sweep did not settle it.** Nothing in the
repository states the intended relation; it has only ever been observed to hold.
Equality is the better guess from the history, and a guess is exactly what
should not be frozen into an assertion whose whole purpose is to state the rule
explicitly.

**What would settle it:** the owner saying which, or a reading of whether
`hiring_practical_test_jobs` should be in the custody backup at all. That second
question is answerable from the recovery scope and is worth answering regardless
of this proposal.

---

## 5. Sequencing, and what this is blocked behind

Nothing here is implemented, and nothing should be until:

1. the owner answers §4;
2. the storage session's backup-path fix (`6da6058`) has been reviewed, which is
   this session's next task and comes first when called;
3. ruling 4 lands — re-basing the three broken suites onto the settled world
   will itself move set(2), and an assertion written against today's sets would
   have to be revisited immediately.

Written against branch `prep/linear-exit-review-fixes-20260913`. Every count and
relation in §1 was measured from the files on that branch, not recalled.
