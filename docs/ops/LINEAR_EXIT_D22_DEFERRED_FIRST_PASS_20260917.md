# D22 first pass: the 61 deferred suites, run

**FIRST PASS, NOT THE AUTHORITATIVE RUN.** Files will move again before the exit
merge, so every number here has a shelf life. The authoritative run is later.
**Nothing was fixed.** This is a report.

**The denominator is 61 throughout** — the suites
`scripts/test-suite-routing.js` classifies as `NOT_RUN_BY_UNIT_LANE`, out of 609
total (548 unit + 61 deferred).

## The three-way split, 61 of 61 accounted for

| Class | Count, of 61 | Meaning |
|---|---|---|
| **PASS** | **37 of 61** | ran here on PostgreSQL 17 and exited 0 |
| **FAIL** | **17 of 61** | ran and failed |
| **CANNOT RUN HERE** | **7 of 61** | refused for a missing input this sandbox does not have: 6 of 61 need private inputs, 1 of 61 needs Playwright and Chromium |

**Of the 17 failures, 2 of 61 are NEW** since the pre-B10 commit `d3cbca7f` and
**15 of 61 fail identically there**, so they are not this month's work.

## The 2 of 61 that are NEW

Both were run at `d3cbca7f` with the identical environment and passed there.

### `linear-exit-observed-routines-postgres.js` — a cross-suite byte pin, and the third instance of the class

```
AssertionError: Expected values to be strictly equal:
+ '32b25c1dc33be113d163ca6335048f0619d8b3d5a13e9c051e2088ba14e5469c'
- '16551aa890e7c5af1ffda6e84c94fa8a37ec375d1fa2fe1736c038b491e57708'
```

`qa/linear-exit-rehearsal/observed-baseline/routines-contract.json` holds
`pre_test_sha256`, which pins the **bytes of a different suite's file**:
`test/linear-exit-source-phases-postgres.js`. That file was changed at
`dc3d789`, the D24 commit, when its `pre.length` assertion moved from 67 to 68
and its two marker counts were made to derive.

**So one suite's contract pins another suite's source, and neither says so.**
It is the same shape as the table-name coupling D25 closed and the same shape as
the world literals: a relation nothing declares, inside a suite nothing runs.
This is the **third** time that combination has produced a silent break in a
fortnight, and the first two were also found by accident.

**Not fixed.** The right closure is a decision, not a re-pin: whether a routines
contract should pin a test file's bytes at all.

### `linear-exit-admission-preflight-postgres.js` — `ADMISSION_INSTALLED_MISMATCH`

Exits 1 with no marker on stdout; the cause is only in the private error log it
writes:

```
Error: ADMISSION_INSTALLED_MISMATCH
    at test/linear-exit-admission-preflight-postgres.js:6:229
```

It compares the installed admission state against the reviewed contract. B10
added `hiring_practical_test_jobs` to the admission guard list, which adds two
triggers, so an installed-state comparison moving is the expected shape.
**Stated as unconfirmed:** this session traced the error and the likely cause and
did **not** prove which field diverges. That is the follow-up, and it wants the
mismatch artifact read, not a guess.

**Worth noting on its own:** this suite reports failure **only into a private
file**. A reader of the console sees exit 1 and no reason. Every other failing
suite here prints a marker.

## The 15 of 61 that fail identically at `d3cbca7f`

Not this month's work. Listed so the authoritative run has a baseline to diff
against rather than rediscovering them.

| Suite | Stops at |
|---|---|
| `linear-exit-card-atomic-handlers.js` | stage `install` |
| `linear-exit-complete-application-recovery.js` | stage `native-source-seed` |
| `linear-exit-control-recovery-postgres.js` | exit 1, no marker |
| `linear-exit-credential-recovery.js` | stage `capture-triple` |
| `linear-exit-followup-outcome-matrix.js` | stage `actual-helper-matrix` |
| `linear-exit-followup-worker-postgres.js` | stage `actual-worker` |
| `linear-exit-install-bootstrap-postgres.js` | stage `wrong-identity` |
| `linear-exit-install-finalize-postgres.js` | stage `install` |
| `linear-exit-install-journal-postgres.js` | stage `journal-owner-drift` |
| `linear-exit-install-maintenance-postgres.js` | stage `wrong-identity` |
| `linear-exit-priority-application-recovery.js` | stage `actual-capture-pair`, `APPLICATION_RECOVERY_GATE_REFUSED` |
| `linear-exit-priority-application-schema.js` | exit 1, no marker |
| `linear-exit-priority-restore-postgres.js` | `Track-B recovery pre-data dump failed` |
| `linear-exit-priority-snapshot-postgres.js` | `Track-B recovery pre-data dump failed` |
| `track-b-recovery-deferred-defaults-postgres.js` | `explicit local psql required` |

**These are NOT established as sandbox artefacts.** They fail on both sides,
which rules out recent work as the cause and rules out nothing else. Several
name an environment the portable runner supplies and this session approximated
(see the caveats). Which of the 15 are environment and which are real is
unanswered here, and answering it is most of the authoritative run's value.

## The 7 of 61 that cannot run here

| Suite | Needs |
|---|---|
| `linear-exit-install-operator-postgres.js` | private observed input directory |
| `linear-exit-observed-full-pipeline.js` | `OBSERVED_INPUT_DIRECTORY`, plus a target and SHA or `--calibrate` |
| `linear-exit-observed-full-install.js` | explicit private observed catalog envelope |
| `linear-exit-atomic-writer-bound-bundle.js` | explicit reviewed plain catalog JSON file |
| `linear-exit-control-restore-only-postgres.js` | private authenticated recovery input |
| `linear-exit-native-preinstall-backup.js` | private inputs and a local cluster data directory |
| `linear-exit-write-diagnostics-browser.js` | Playwright and Chromium, **absent here** |

**6 of 61 are the storage session's**, by definition. The 7th needs a browser
install, which nobody has asked for.

## How it was run, and the caveats that limit it

- PostgreSQL **17.11** from PGDG, ICU `en-US`, loopback, disposable.
- Environment: `F63_REQUIRE_POSTGRES=1`, `PGHOST=127.0.0.1`, `PGPORT`, `PGUSER`,
  `PGDATABASE=postgres`, `F42_REHEARSAL_PGBIN`, a fresh `PROOF_OUTPUT_ROOT` per
  suite with a `data` subdirectory. 600s timeout each.
- The 24 non-zero suites from the first sweep were **re-run with that fuller
  environment** before being classified, because several name a variable the
  first invocation did not set. Two moved class on the re-run; the rest did not.
- **The pre-B10 control used the identical environment**, the identical
  PostgreSQL instance and the identical invocation. Only the checkout differed.

**Three caveats, each of which could move a number:**

1. **One shared cluster, not one per suite.** The portable runner gives each
   lane a fresh cluster. Here all 61 ran sequentially against one, creating
   their own databases. Cross-suite residue is possible and is not ruled out.
2. **The portable runner supplies more than this session reproduced.** Sixteen
   of the failures declare "portable runner supplies isolated environment", and
   what that phrase covers was approximated, not read out of the runner.
3. **Timeouts are counted as failures**, not separated. No suite was observed
   hitting the 600s limit, but nothing here proves none did.

## What this first pass is worth

It establishes a **baseline to diff against**: 37 pass, 17 fail of which 15 are
older than B10, 7 cannot run here. The authoritative run does not have to
rediscover the 15.

And it found **one real defect nobody knew about** — the routines contract
pinning another suite's bytes — which is the point of running the 61 at all, and
which was invisible for exactly the reason D22 exists.

---

*Run 2026-09-17 by the cloud execution session, read-only, on branch
`prep/linear-exit-review-fixes-20260913` at the head recorded in the commit that
adds this file. Pre-B10 control: `d3cbca7f`. No file was changed by this work,
no live database, hosted service or production system was contacted, and main
is untouched.*
