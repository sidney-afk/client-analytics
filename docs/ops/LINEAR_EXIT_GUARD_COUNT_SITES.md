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

## The one fact underneath all of them

`complete.expectedNames('v2')` returns **exactly 90 names**; `('v1')` returns 86.
**READ**, by running both and counting.

The reviewed object is a **versioned, byte-pinned, named set of public tables**.
Every `90` in the table below is that set's length, restated as a constant in a
different file. Nobody chose nine literals; one derived fact was flattened into
nine places.

That is why a literal is the wrong shape, and why it was the wrong shape before
a second profile existed. A second profile only made it visible.

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

Consumers, **READ** by grep: `scripts/track-b-recovery-package.js`,
`scripts/linear-exit-complete-application-custody.js`,
`scripts/linear-exit-control-companion.js`,
`scripts/linear-exit-complete-sequence-bounds.js`,
`scripts/linear-exit-asset-reference-coverage.js`.

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
