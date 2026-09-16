# The guard-count sites: what each one serves, and what it should read instead

**Survey only. Nothing here has been changed, and no fix is proposed in detail
yet.** The v3 proposal waits on one answer: whether step 9's private capture
wrapper reaches site 9. If it does, this is a blocker in the install-day path.
If it does not, it is a latent defect to fix properly rather than urgently.

Background: journal, 2026-09-16, "The guard-count set is NINE sites".

## Evidence labels, applied per row

Every row says how its claim was established, because the failure this survey
exists to correct was a claim that looked checked and was not.

- **READ** — traced in the code, cited below.
- **INDICATED** — strongly suggested by evidence, not traced end to end. Says
  what would settle it.

---

## Two 90s, not one — CORRECTED 2026-09-16

An earlier version of this section said every `90` below is the length of the
complete-application-data list, restated. **That was wrong, and it was asserted
rather than tested.** Tested now:

- `expectedNames('v1')` is **86 names and is byte-for-byte the source baseline
  catalog's table set** — zero difference in either direction. **READ**, by
  diffing both lists in both directions.
- `expectedNames('v2')` is **v1 plus exactly four names**, all `card_write_*`:
  `card_write_admission_v1`, `card_write_followups_v1`,
  `card_write_operations_v1`, `card_write_transaction_context_v1`. **READ.**
- `LINEAR_EXIT_OBSERVED_INSTALL_TARGET_V1.json` records post-install
  `public_tables: 90` from a **67**-table live start. **READ.**

So there are two different 90s that decompose differently:

| | decomposition |
|---|---|
| complete-application-data v2 | 86 source-baseline tables **+ 4** |
| install target | 67 live tables **+ 23** created by the install |

**86 ≠ 67 and 4 ≠ 23.** They coincide at 90 today and they are not the same
fact. The decisive evidence is what happens next: under `settled68` the live
start becomes 68, so the install's post-install count becomes **91**, while v2
stays **90** because the source-baseline universe has not changed. **Two numbers
that take different values are not one number restated.**

What remains true is that a literal is the wrong shape. Nine copies of a derived
quantity is still nine copies. But the quantity is per-profile arithmetic, not
the length of the custody list.

---

## The nine

### 1. `scripts/linear-exit-install-operator.js:34` — every profile

`if(guards.length!==(alreadyFinal?0:90))fail('GUARD_COUNT')`, in the real
install path.

**READ.** `execute(c,...)` resolves `profiles.get(c.profile)` at its top, and
the guard check sits in the shared body with no profile branch between them. One
literal therefore serves observed67 (67-table start), observed67_optout (also a
67-table start, its delta is a column) and settled68 (68).

**Should read:** the expected post-install table count **for the profile in
hand**, derived from that profile's reviewed name list rather than restated.

### 2. `scripts/linear-exit-observed-full-target.js:6` — every profile, and the clearest case

`assert(catalog&&Array.isArray(catalog.tables)&&catalog.tables.length===90)`
inside `create(...)`.

**READ**, and this is the row that settles the design question:
`create({planBytes,planSha256,catalog,privateCatalog})` **takes no profile
argument at all.** It asserts a number it has no way to be right about. And
`compare(...)` calls `create(...)` on line 15, so the assertion fires on both
the operator's comparison path and the calibrate worker's creation path — twice
per install run.

**Should read:** the count from the plan or contract it was handed, not a
constant. If the function cannot see which world it is in, it should be given
that rather than assume it.

### 3. `test/helpers/install-operator-worker.mjs:9` — every profile

`assert.equal(guards.length,90)` in the `INSTALL_OPERATOR_CALIBRATE==='1'`
branch.

**READ.** The profile comes from `INSTALL_OPERATOR_PROFILE` in
`test/linear-exit-install-operator-postgres.js:9`, so whichever profile is being
calibrated hits this literal. This is the one that would have failed session C.

**Should read:** the same profile-derived count as #1.

### 4. `test/helpers/observed-full-pipeline-worker.mjs:11` — 67 only

`assert.equal(guards.length,90)` at the `derive-target` stage.

**READ.** Its driver, `test/linear-exit-observed-full-pipeline.js:20`, calls
`full.build(initial)` **with no options**, so it takes the default contract
(`observed67`). It never sees the settled world.

**Should read:** nothing needs to change for correctness. It could still derive
rather than restate, so the number stops being a thing to keep in step by hand.

### 5. `test/linear-exit-observed-full-pipeline.js:33` — 67 only

`assert.equal(after.tables.length,90)`. Same driver, same reasoning as #4.
**READ.**

**Should read:** as #4.

### 6. `test/linear-exit-observed-full-install.js:11` — no profile; coupled to #2

`const catalog={tables:Array.from({length:90},(_,i)=>({name:'synthetic_'+i}))}`
— a synthetic fixture sized purely to satisfy #2's assertion. **READ**: the same
file requires `linear-exit-observed-full-target` on line 2.

**Should read:** whatever shape #2 ends up with. It is not evidence about any
real database; it is a fixture that exists because the assertion exists.

### 7. `test/helpers/control-recovery-proof.js:54` — the control-companion world

`assert.equal(...count(*) from pg_trigger where tgname='linear_exit_maintenance_dml_v1' and tgenabled='A'...,90)`.

**INDICATED, not traced.** The file drives `complete.capture(...)`, which
reaches `captureRows` and therefore site 9, and the number matches
`expectedNames('v2').length` exactly. What was **not** traced is that the
schema it stands up contains precisely those 90 names: the tables are created
from the control companion's OWNERS files, and that set was not enumerated.

**What would settle it:** enumerate the tables the control OWNERS create and
compare with `expectedNames('v2')`, or run the proof and count.

**Should read:** `expectedNames(version).length`, if the coupling holds. On no
install profile either way, so it is unaffected by settled68.

### 8. `test/linear-exit-control-restore-only-postgres.js:16` — the control-companion world

Byte-identical assertion to #7, same module family
(`linear-exit-control-companion.forProfile('core+diagnostics')`, line 3).
**INDICATED**, on the same evidence and with the same gap as #7.

**Should read:** as #7.

### 9. `scripts/linear-exit-complete-application-data.js:29` — NOT A COUNT

`if(canon(catalog.map(t=>t.name))!==canon(expectedNames(name)))fail('UNCLASSIFIED_OR_MISSING_TABLE');`

**READ.** This compares the live catalog's table **names** against the reviewed
list as an **exact set**. On the settled database, with
`hiring_practical_test_jobs` present and absent from v2, it refuses. **Changing
90 to 91 anywhere does not touch this**, because it is not counting.

**CORRECTED 2026-09-16. The consumer list first written here over-reported,
and the way it did is the same defect this document exists for.** It listed five
files as consumers; that grep measured *which files reference the module*, not
*which reach the check*. Four of the five use only `read`, `sections` or
`expectedNames`, none of which is site 9.

**Exactly one repo-side caller of site 9 exists: `scripts/linear-exit-control-companion.js`**,
which calls `complete.captureRows`. **READ**, by listing the exports each
consumer actually uses.

And a trap worth naming: **three different modules export a function called
`captureRows`** — this one, `linear-exit-credential-capture.js:9` and
`linear-exit-priority-capture.js:9`. Only this one carries the exact-set check.
A search on the name alone over-reports by two.

Repo-side reach into the install path, **static reading only**: the install
operator and the calibrate worker use exactly one thing from the control
companion, `control.catalogSql`, and **not** its `capture`. `control.capture` is
called only from `test/helpers/control-recovery-proof.js`. So **no install-day
path to site 9 was found in this repository.**

Stated as "not found" rather than "does not exist", deliberately. A second
search of a different shape turned up five **lazy requires** of the control
companion inside `track-b-recovery-package.js` (lines 538, 544, 911, 1053, 1409)
and a file whose name deserves the wider trace's attention,
`scripts/linear-exit-control-custody.js`. None of them is on the operator's
path, but lazy requires are exactly what static reading is worst at, which is
why runtime confirmation was asked for.

**Should read:** the version appropriate to the database in front of it. This is
the row that makes the fix a reviewed-list change rather than a number change,
and it is why the work touches custody and recovery.

Its own gate is `test/linear-exit-complete-application-data.js:41`:
`assert.equal(names2.length,90); assert.equal(added.length,4)` — the reviewed
v1-to-v2 delta. **READ.** Any new version needs its own equivalent.

---

## Summary

| Serves | Sites | Breaks on settled68 |
|---|---|---|
| Every profile | 1, 2, 3 | **Yes** |
| 67-table world only | 4, 5 | No |
| Control-companion world | 7, 8 | No (indicated) |
| Fixture coupled to #2 | 6 | Follows #2 |
| Exact name set, not a count | 9 | **Yes, and differently** |

Related: [journal](LINEAR_EXIT_JOURNAL.md) ·
[B9 re-derivation](LINEAR_EXIT_B9_CATALOG_REDERIVATION.md) ·
[session C](LINEAR_EXIT_SESSION_C_20260916.md)
