# Hard-coded world literals: a deliberate sweep

**Read-only. Nothing in this document was fixed, and nothing should be fixed on
the strength of it alone.** The list is the deliverable. Its purpose is to
answer a question nobody could answer this morning: *how big is this?*

Three checks were found silently broken on 2026-09-16, all by accident, all the
same shape — a table count or a catalog fingerprint written down when the world
looked one way, never updated when the world moved, sitting in code nobody runs
often enough to notice. This sweep looks for the rest on purpose.

**Scope of the answer: 43 sites examined, in 27 files.** Seven are stale, three
of them failing right now. Fifteen are deliberate frozen contracts that are
still true. Eleven are correct today but bound to a single world and will refuse
the moment a second world is put through them. Four could not be settled here,
and each says what would settle it.

**This does not supersede [`LINEAR_EXIT_GUARD_COUNT_SITES.md`](LINEAR_EXIT_GUARD_COUNT_SITES.md),
it extends it.** That survey catalogued the nine sites restating the
post-install table count and is the prior art for this question. §3 of this
document records the current state of all nine, including the three since
fixed, and §4.1 records that its site 9 has gone from a predicted future
refusal to an actual one.

**The most important finding is not on the list.** It is the reason the list
exists at all, and it is in §2.

---

## 1. Method, and what it does NOT cover

Stated first so the limits travel with the findings. The house rule is that a
search proves what it found and never what it did not, so every class below was
swept twice in different shapes and the results reconciled.

| Shape | What it caught |
|---|---|
| `.length` compared to a numeric literal, all `.js/.mjs/.ts` | 178 raw hits, filtered to 39 world-relevant |
| Each world number as a **bare literal** (67, 68, 86, 87, 90, 91, 115) | the dumb search; caught sites the clever one missed |
| 64-hex literals in code, then filtered by surrounding key name | separated catalog fingerprints from file-content pins |
| `*catalog_sha256*` keys across `docs/`, `scripts/`, `test/` | six distinct world fingerprints, three of them unexplained |
| SQL: `count(*)`, `array_length`, `cardinality` against a literal | **negative result**, see below |
| Workflow YAML, world numbers | **negative result** |
| `index.html`, the 85,490-line SPA | **negative result**, see below |
| **Running the suites** | this is what actually found the worst of it |

**Negative results, stated because they narrow the problem usefully.**

- **SQL carries no world-size counts of this class.** Every numeric comparison
  found in 163 `.sql` files is a per-row structural bound (`cardinality(...) <> 1`,
  `count(*) > 2`), not a claim about how big the world is. The two SQL files
  that *do* describe a world do it as an explicit enumerated contract, not a
  number (§4).
- **The deploy workflows carry none.** The only numeric constants are CLI
  versions.
- **`index.html` carries none.** Its three named count constants
  (`LINEAR_DEFAULT_VIDEO_COUNT = 12`, `FILMING_CONTENT_RED_COUNT = 10`,
  `FILMING_CONTENT_COVERED_COUNT = 21`) are product defaults about clients and
  filming plans. They are not database-world literals and are out of scope.

**Not covered, and a later sweep should:** the private evidence directories on
the owner's machine (the storage session swept those separately and found the
hash-to-profile map in exactly one file); `qa/` probe fixtures, swept only for
the world numbers and not exhaustively; and any literal expressed in prose in a
`docs/` page rather than in code.

---

## 2. THE STRUCTURAL CAUSE: 61 suites the unit lane never runs

**This is the finding that matters.** Every hard-coded world literal that went
stale without anyone noticing is sitting in a suite that `npm test` does not
run.

`scripts/test-suite-routing.js` classifies 547 suites as the unit lane and
**defers 61** as `NOT_RUN_BY_UNIT_LANE`. They are deferred for good reasons —
they need a disposable PostgreSQL, a private observed input directory, or a
browser — and the runner honestly prints each one as `NOT_RUN` rather than
counting it as passing. Nothing here is hidden.

But the consequence is not written down anywhere: **a check that never runs
cannot fail, so a literal inside it can go stale for an arbitrary length of time
and the repository will look green the whole while.** Of the 61 deferred
suites, **18 carry a world-size literal.**

Setting `F63_REQUIRE_POSTGRES=1` and having a real PostgreSQL 17 available does
**not** change this. The routing is static. Those 61 are only ever run by hand,
one at a time, by someone who already suspects something.

### 2a. A correction to this session's own claim, on the record

When B10 landed, this session reported **zero regressions**, on the evidence of
the full 547-suite run plus a clean control worktree.

**That claim was true of the 547 and false of the repository.** Measured today,
by running the deferred suites by hand against a PostgreSQL 17 cluster, and
controlled against the pre-B10 commit `9b6990d`:

| Suite | pre-B10 `9b6990d` | post-B10 `8940583` | Cause |
|---|---|---|---|
| `test/linear-exit-application-dml-admission.js` | **PASS** | **FAIL** | `87 !== 86` |
| `test/linear-exit-source-phases-postgres.js` | **PASS** | **FAIL** | name list missing the new table |
| `test/linear-exit-source-baseline-catalog-postgres.js` | **PASS** | **FAIL** | name list missing the new table |

**B10 broke three suites and the verification method could not see them.** The
method was not careless — a full run plus a control worktree is the right shape
— it simply had the exact blind spot this sweep is about. A "clean control"
comparison over a suite set that excludes the affected suites reports clean.

That is the whole problem in one example: **the checks most likely to encode a
world literal are the checks least likely to be run**, and the tooling that
would normally catch a stale literal is the same tooling that skips them.

---

## 2b. The prior survey's nine, re-checked

[`LINEAR_EXIT_GUARD_COUNT_SITES.md`](LINEAR_EXIT_GUARD_COUNT_SITES.md) catalogued
nine sites restating the post-install public table count. Three were fixed at
commit `8299108` to derive the number instead. **Six still hold a literal.**
Re-checked by reading each line today:

| # | Site | State today |
|---|---|---|
| 1 | `scripts/linear-exit-install-operator.js` | **FIXED** — reads `expectedGuards`, resolved in preflight |
| 2 | `scripts/linear-exit-observed-full-target.js:12` | **FIXED** — reads `expectedTables` from the plan's own starting catalog |
| 3 | `test/helpers/install-operator-worker.mjs:9` | **FIXED** — derives via `postInstallPublicTables` |
| 4 | `test/helpers/observed-full-pipeline-worker.mjs:11` | literal `90` remains |
| 5 | `test/linear-exit-observed-full-pipeline.js:33` | literal `90` remains |
| 6 | `test/linear-exit-observed-full-install.js:11` | literal `90` remains |
| 7 | `test/helpers/control-recovery-proof.js:54` | literal `90` remains |
| 8 | `test/linear-exit-control-restore-only-postgres.js:16` | literal `90` remains |
| 9 | `scripts/linear-exit-complete-application-data.js:29` | **not a count; now actually refusing — see §4.1** |

Sites 4 to 8 are all correct today, for the reason that survey gave: each is
bound to a world whose post-install count is 90. They are carried into §5 of
this document rather than re-argued here. **Sites 7 and 8 were found by that
survey and not independently by this sweep** — both count
`linear_exit_maintenance_dml_v1` triggers rather than tables, so neither matched
any search shape in §1. That is worth stating plainly: two of the eleven
single-world sites in this document exist here only because somebody had already
written them down.

---

## 3. STALE — measured, wrong now

Each row was settled by running something, not by reading.

### 3.1 `test/linear-exit-application-dml-admission.js:16`

```
assert.equal(c.scalarJson("select count(*)::int from pg_trigger where tgname='aaa_application_dml_admission_statement'"), 86);
```

- **World it describes:** the admission guard's table list *before* B10, 86
  tables, one statement trigger each.
- **Verdict: STALE.** The guard list is 87. Measured: `87 !== 86`.
- **Also line 52**, in the same file, reports `tables_guarded:86` inside the
  suite's own success marker. It is not an assertion, so it would not fail; it
  would print a false number into the evidence if line 16 were fixed alone.

### 3.2 `docs/independence/LINEAR_EXIT_COMPLETE_APPLICATION_DATA_V1.json`, consumed via `scripts/linear-exit-complete-application-data.js:18` `expectedNames()` — *and this was predicted*

- **World it describes:** the 86 application tables, as an enumerated, pinned
  name list.
- **Verdict: STALE against the guarded set.** Measured: the corpus holds 86
  names, the admission guard holds 87, and the difference is exactly
  `hiring_practical_test_jobs`. Before B10 the two sets were identical; they
  have now diverged by one.
- **Blast radius:** this single divergence is what fails both
  `linear-exit-source-phases-postgres.js:26` and
  `linear-exit-source-baseline-catalog-postgres.js:5`, each of which compares a
  live catalog's table names against `expectedNames()`.
- **Note the coupling nobody declared:** the guard list lives in a SQL
  migration, the corpus lives in a pinned JSON artifact, and nothing in either
  says the two must agree. They agreed by history, not by construction.
- **THIS WAS PREDICTED AND THE PREDICTION WAS RIGHT.** Site 9 of
  `LINEAR_EXIT_GUARD_COUNT_SITES.md` says, in as many words: *"On the settled
  database, with `hiring_practical_test_jobs` present and absent from v2, it
  refuses."* So this is not a discovery, it is a forecast coming true, and the
  sweep's only addition is **when**. The forecast was about the settled
  *database*, a day-of concern. B10 made the shared test fixture apply the
  hiring migration, which put the new table into the *fixture* world too. The
  refusal therefore arrived early, in two suites, on the branch — months before
  anyone expected to meet it. A latent defect became a live one because an
  unrelated change moved a different world.

### 3.3 `scripts/linear-exit-native-preinstall-backup.js:21`

```
if(catalog.tables.length!==67||catalog.tables.some(t=>t.kind!=='r'))fail('EXPECTED_67_ORDINARY_TABLES');
```

- **World it describes:** the live pre-install database as it stood on
  2026-09-12, 67 public tables.
- **Verdict: STALE for the live path.** The live world is 68 since the owner's
  hiring migration. `evidence()` is called by `capture()` before and after the
  dump and by `restore()` on the restored copy, so **steps 9 and 10 refuse
  before any dump is taken.**
- **Found by the storage session, not by this sweep** (journal, Finding 2),
  from reading. This sweep confirms the call path by reading and confirms the
  input count of 68 from that session's measured live read. Nothing was run
  against a live database here.
- **Why it hid:** it is a *pre*-install count, and every previous survey was
  about the *post*-install 90/91. It appears in no journal entry, no ops page
  and no survey row.

### 3.4 `scripts/linear-exit-install-profiles.js:35`

- **World it describes:** the `settled68` plan and target as they were before
  B10.
- **Verdict: STALE, known, already being handled.** Plan `e3dae746…` and target
  `625430…` are both superseded; the storage session has since measured plan
  `508e6369…` and target `24c833c0…`. Listed here only so the sweep is complete.
- Its two sibling profiles, `observed67` and `observed67_optout`, carry stale
  plans for the same reason and additionally **cannot install at all** after
  B10 (storage session, `application_admission_missing_owner`).

### 3.5 `docs/independence/LINEAR_EXIT_OBSERVED_FULL_PIPELINE_20260913.json`

- **World it describes:** the source tree as it stood on 2026-09-13.
- **Verdict: STALE, 3 of its 26 `source_pins`.** Already documented in the
  journal, with the owner's decision to re-run rather than edit. Only one of the
  three is B10's; two went stale earlier the same day.

---

## 4. FROZEN CONTRACT — correct, and correct *by construction*

These are the pattern working as intended. They are listed because "how big is
this" is only answerable if the healthy cases are counted too.

| Site | What it freezes | Why it is sound |
|---|---|---|
| `docs/independence/LINEAR_EXIT_OBSERVED_PUBLIC_CATALOG_20260912.json` | observed67: 67 tables, 115 functions, 14 sequences, 177 indexes, 31 policies, 28 triggers | A dated, hash-pinned description of one named world. Self-consistent; nothing else depends on it silently |
| `…_20260916.json` | settled68: 68 tables, 122 functions, 14 sequences, 181 indexes | Same shape, second world, derived and reviewed |
| `scripts/linear-exit-observed-public-catalog.js:176` `STARTING_CATALOG_TABLE_COUNT_SOURCE` | the opt-out world's table count comes from observed67's contract | **The exemplar.** Resolves from the artifacts first and falls back to the map only for the one world with no artifact of its own, and its comment states exactly what would make it wrong: *"any future opt-out delta that ADDS OR DROPS A TABLE"* |
| `scripts/linear-exit-observed-full-install-plan.js:28` | base plan = 35 sources | **Verified still 35** |
| `scripts/linear-exit-atomic-writer-bound-bundle.js:15`, `test/…:10` | full plan = 48 sources | **Verified still 48** |
| `scripts/linear-exit-install-operator.js:16` | compiled plan = 55 chunks | **Verified still 55** |
| `supabase/migrations/20260913062149…sql` `production_retirement_contract_assert_v1` | the entire expected trigger set, 192 entries | An enumerated contract, not a count. Re-derived from a real server during B10 |
| `supabase/migrations/20260912183653…sql` | the admission guard's 87 table names | An enumerated list, and the one that moved. Sound in itself; the failure is that three other places copied it |
| `scripts/track-b-backup.js:42-104` and its four corpus tests (14, 21, 33, 39, 47, 52) | Track-B backup corpora | **Derived, not duplicated.** Each corpus is `[...previous, ...additions]`, so the test counts guard a derivation rather than restating a world |
| `test/linear-exit-source-baseline-catalog.js:3` | `source_inventory_entries_applied === 64` | Asserts a field of a hash-pinned artifact against itself |
| `qa/workload-consistency/source-harness.js:14` | 13 work statuses | Product vocabulary, not a database world. Fails loudly and immediately if the map changes |

---

## 5. CORRECT TODAY, BOUND TO ONE WORLD

These are not stale. They are also not safe: each is correct only because it has
so far been used against exactly one world, and there are now two.

| Site | Literal | When it breaks |
|---|---|---|
| `scripts/linear-exit-observed-schema.js:28` | `tables 67, functions 115, sequences 14, ownership 14` | The reconstruction is observed67 *by definition*, so this is right. It breaks the day anyone reconstructs the settled world from its own capture, and it will report a mismatch on the count rather than on the world |
| `test/linear-exit-observed-full-pipeline.js:33` | `after.tables.length === 90` | The lane builds through the unprofiled plan builder, so it can only ever be observed67. It cannot serve `settled68`, whose post-install count is 91 |
| `test/linear-exit-observed-full-install.js:11` | synthetic catalog of exactly 90 | Same. The synthetic length must equal `postInstallPublicTables(...)` or `target.create()` refuses |
| `test/linear-exit-native-preinstall-backup.js:9` | `captured.public_tables === 67` | Correct for the *reconstructed* observed67 world this suite builds. It is the same number as §3.3 in a different world, so fixing §3.3 without this one moves the failure rather than removing it |
| `test/linear-exit-complete-application-data.js:21, :41` | 86 names (v1), 90 names (v2) | Asserts the pinned corpora against themselves. Correct, and it is the same 86 that §3.2 shows has diverged from the live world — so this suite will keep passing while the world is wrong |
| `test/linear-exit-complete-application-recovery.js:111` | `v2 ? 89 : 86` populated tables | Same corpus, same exposure |
| `test/helpers/observed-full-pipeline-worker.mjs:11` (survey #4) | `guards.length === 90` | Driver builds through the unprofiled builder; observed67 only |
| `test/helpers/control-recovery-proof.js:54` (survey #7) | 90 `linear_exit_maintenance_dml_v1` triggers | The control-companion world. Counts triggers, not tables, so no search shape here would have found it |
| `test/linear-exit-control-restore-only-postgres.js:16` (survey #8) | same | same |

**The pattern across this section is worth naming.** In four of the six, the
number is *right about the artifact and wrong about the world*. A test that
compares a frozen artifact to itself will pass forever. That is not a broken
test; it is a test that was never going to notice.

---

## 6. UNDETERMINED — and what would settle each

Listed rather than guessed, per the house rule.

### 6.1 `scripts/linear-exit-install-maintenance.js:6` `PRIVATE_CATALOG_SHA` = `2e28f774…`, and the same value inline at `scripts/linear-exit-install-finalize.js:13`

- **What it is:** a fingerprint of the *maintenance* catalog, a world
  description, duplicated across two files.
- **Why undetermined:** it describes a state produced during an install, not
  anything on disk. Nothing in this sandbox can produce it.
- **What would settle it:** one install-operator calibration run. The storage
  session's 2026-09-16 run reported the installed *private* catalog as
  `fccae16a…`, unchanged across B10, which is suggestive but is a different
  field. A run that prints the maintenance catalog hash settles it outright.

### 6.2 Three catalog fingerprints that name no world this sweep could identify

| Value | Where | Question |
|---|---|---|
| `2a1fb65e…` | `LINEAR_EXIT_COMPLETE_APPLICATION_DATA_V1.json` `observed_catalog_sha256`, and `LINEAR_EXIT_RECOVERY_SCOPE_20260910.json` | Matches none of `809c5dc7` / `f5ed8a38` / `ddfa4c4f`. Which catalog is it? |
| `43a623f3…` | `LINEAR_EXIT_OBSERVED_INSTALL_TARGET_V1.json` `final_public_catalog_sha256` | Presumably the post-install observed67 catalog. B10 changed the installed catalog (`0d4eb7dc…` → `331aabb2…`), so this may now be stale |
| `7e363b4b…` | `LINEAR_EXIT_OBSERVED_FULL_PIPELINE_20260913.json` `final_catalog_sha256` | Same question, same proof |

- **What would settle all three:** the pipeline-proof re-run that is already
  owed to the storage session. It reports the final catalog hash directly. Until
  then these are recorded as unknown, not as stale — **`2a1fb65e…` in
  particular may be an older, perfectly valid world**, and calling it stale
  without evidence would be the guess this document exists to avoid.

### 6.3 Six deferred suites that fail on both sides of B10

`linear-exit-card-atomic-handlers`, `linear-exit-complete-application-recovery`,
`linear-exit-credential-recovery`, `linear-exit-followup-outcome-matrix`,
`linear-exit-install-journal-postgres`,
`linear-exit-priority-application-recovery`.

- Each fails identically at `9b6990d` and at `8940583`, so **none is B10's**.
- They stop at varied stages (`native-source-seed`, `capture-triple`,
  `journal-owner-drift`, `actual-capture-pair` with
  `APPLICATION_RECOVERY_GATE_REFUSED`), which reads like missing private inputs
  or an unavailable dependency rather than a stale literal.
- **Undetermined**, because "fails for an environment reason" and "fails for a
  stale literal and also has an environment problem" look identical from here.
- **What would settle it:** running them on the owner's machine with the private
  inputs, where the environment reason goes away and whatever remains is real.

### 6.4 `scripts/f200-attribution-plan.js:30` `DEFAULT_EXPECTED_COUNT = 72` and `docs/syncview-design/tests/behav-wired.js:18` `TOTAL = 168`

- Both are world-size literals by shape. Neither is in the Linear-exit
  machinery, and this sweep did not trace what world either describes.
- **What would settle it:** ten minutes each tracing the consumer. Left
  deliberately, rather than asserting they are fine.

---

## 7. What this adds up to

1. **Seven sites are stale**, and three of them are breaking a check right now.
2. **One of the seven was forecast in writing and still arrived unannounced.**
   §3.2 is site 9 of the prior survey, which said exactly what would happen and
   under what conditions. It still took a suite failure to notice, because the
   condition it named was the settled *database* and what actually moved was the
   test *fixture*. Writing a defect down did not cause anyone to be watching for
   it.
3. **The fix for §3.2 is not a number.** The guard list, the application-data
   corpus and two catalog-name comparisons all restate the same set of table
   names, and nothing declares that they must agree. Updating the corpus to 87
   removes today's failure and leaves the coupling undeclared for next time.
4. **Eleven more sites are one world away from being stale**, and several are
   tests that compare an artifact to itself, so they will not be the ones to
   tell anyone. Six of the eleven are the unfixed remainder of the prior
   survey's nine.
5. **The deferred lane is the real exposure.** Eighteen of the 61 unrun suites
   carry a world literal. Any of them can be wrong for weeks. The repository
   will be green throughout, and the tooling normally relied on to catch a stale
   literal is the same tooling that skips them.

**No recommendation is made here about what to change.** Two observations are
offered as material for that decision, not as a plan:

- A count that is *derived* from a named contract cannot go stale on its own.
  `postInstallPublicTables()` already does this, and it is the one site in this
  sweep that documents its own invalidation condition. It is the shape the
  others are not.
- The deferred suites' literals would stop hiding if something ran them, or if
  something asserted the couplings between the four places the table-name set
  is written down. Which of those is worth doing is the owner's call.

## 8. Amendment: three owner decisions landed while this was being written

Recorded because two of them change what a reader should DO with sections above,
though neither changes a fact in them. Read from commit `c234fee`, which landed
during the sweep.

- **D18 — the two 67-table profiles no longer need to be installable.** Their
  post-B10 install refusal is ruled *not a regression*, and a future session
  must not fix it. **§3.4 still stands as fact:** their pinned plans are stale.
  It is not a call to act, and under D18 the pins may not need re-deriving at
  all. What happens to those profiles and their pins was explicitly not decided.
- **D19 — the pipeline proof moves to the settled 68-table world.** This
  promotes most of §5 from hypothetical to scheduled. Survey sites 4, 5 and 6
  (`observed-full-pipeline-worker.mjs:11`, `observed-full-pipeline.js:33`,
  `observed-full-install.js:11`) are correct *only* because that lane has so far
  been observed67-only. Re-basing it on the settled world makes the
  post-install count 91 and those three literals wrong **by the act of carrying
  out D19**. They are the first things that re-run will hit.
  D19 also defers any repointing of the install operator's `source_pins`
  until this sweep and the backup-path fix are done, so §6.2's three
  unexplained fingerprints stay unsettled for now by decision, not by oversight.
- **D20 — the admission guard stays strict.** Confirms that the §3.2 and §3.3
  divergences are to be closed by correcting the stale side, never by relaxing
  the check.

**No section above was rewritten in the light of these.** The findings were
measured before the decisions landed and are left as measured.

---

---

*Sweep performed 2026-09-16 by the cloud execution session, read-only, against
branch `prep/linear-exit-review-fixes-20260913`. PostgreSQL 17.11 (PGDG, ICU
`en-US`, loopback, disposable) was used to run deferred suites and was stopped
afterwards. No repository file was changed by this work. No live database, no
hosted service and no production system was contacted.*
