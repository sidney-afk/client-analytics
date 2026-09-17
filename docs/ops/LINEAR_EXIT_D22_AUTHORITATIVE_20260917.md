# D22 — the authoritative deferred-suite run, 2026-09-17

Branch head `a236572`. Pre-B10 control `d3cbca7f`. Denominator **61 of 61** on
every line. Nothing was fixed; this is a report.

| verdict | count | meaning |
|---|---|---|
| **PASS** | **49 of 61** | ran and passed |
| **FAIL** | **3 of 61** | ran and failed; all three fail identically at `d3cbca7f` |
| **CANNOT RUN HERE** | **9 of 61** | did not run: 4 Windows-only by construction, 5 need private inputs |

> **Amended 2026-09-17, after the follow-up tasks.** This table read 4 / 8 when
> first published. `linear-exit-atomic-writer-bound-bundle.js` moved from FAIL to
> CANNOT RUN HERE: its failure was a stale byte pin standing in front of the
> assertion under test (see §1), and with the pin re-derived the suite advances
> to its genuine private-fixture requirement. The 49 passes are unchanged.
> Two further corrections are marked inline below.

**None of the failures is a regression from this month's work.** Each fails with
the identical signature at the pre-B10 commit.

---

## 1. The four that ran and failed

Each was run twice: at head and at `d3cbca7f`, same harness, same PostgreSQL
binaries, same invocation, one fresh cluster each. Only the checkout differed.

### `linear-exit-atomic-writer-bound-bundle.js` — identical at `d3cbca7f`, and RECLASSIFIED on 2026-09-17

```
AssertionError: The input did not match the regular expression
  /exact starting public catalog|catalog/i.
Input: Error: WRITER_BINDING_BUILDER_DRIFT
```

Line 5 asserts that binding a plan to an invalid catalog (`{}`) refuses with a
message about the catalog. It does refuse — with `WRITER_BINDING_BUILDER_DRIFT`,
a different reason.

**AMENDMENT.** The sentence that stood here — "the refusal is real; the
expectation about which refusal is stale" — had it backwards. The *expectation*
was right and the *gate in front of it* was stale: `BUILDER_SHA256` in
`scripts/linear-exit-atomic-writer-bound-bundle.js` pinned the bytes of another
file and had been stale since `03d18fb3`, before B10, which moved that file
again. With the pin re-derived through the module's own mechanism, line 5 passes
(`exact starting public catalog required`) and the suite stops at its real
private-fixture requirement. **So this suite is CANNOT RUN HERE, not FAIL**, and
the sweep now carries it as a pin over another file's bytes with no running gate
enforcing it (§7d there).

### `linear-exit-complete-application-recovery.js` — identical at `d3cbca7f`

```
{"marker":"LINEAR_EXIT_COMPLETE_APPLICATION_RECOVERY_FAILED","stage":"native-source-seed"}
AssertionError: actual gateway/browser/SQL phase   1 !== 0
```

Root cause, from the phase's own private log (which the first pass never
opened):

```
Error: gateway_acceptance_failed:{"status":503,
  "json":{"ok":false,"error":"assignee_lookup_unavailable"}}
  at accepted (scripts/native-card-materialization/fixture.mjs:25)
```

`assignee_lookup_unavailable` is thrown by `supabase/functions/production-write/index.ts`
at four places, each of the shape `if (error) throw new GatewayError(503, …)`.
So a **query against the rehearsal cluster returned an error** — this is not a
missing network route, it is the seeded world not satisfying the lookup. What
exactly the lookup needs is not established here.

### `linear-exit-control-recovery-postgres.js` — identical at `d3cbca7f`

Same failure, same stage, same assertion: this suite delegates to
`complete-application-recovery.js`'s `main`. One cause, two suites.

### `linear-exit-priority-application-schema.js` — identical at `d3cbca7f`

```
LINEAR_EXIT_PRIORITY_APPLICATION_SCHEMA_INCOMPLETE
```

**AMENDMENT.** This paragraph said "three tables missing and one more present
but mismatched". Wrong on both counts, and the corrected figures are in the
journal entry for task four: **9 tables examined, 5 exact, 4 missing, none
present-but-mismatched.** The fourth missing table is
`batches_parent_claim_backup_20260824`, and the `column_order_matches: false`
readings I mistook for a mismatch are what the report prints for a table that is
simply absent. The verdict is unchanged; the description of it was not accurate.

---

## 2. The eight that could not run here

### Windows-only by construction — 4 of 61

`linear-exit-credential-recovery.js` · `linear-exit-priority-application-recovery.js` ·
`linear-exit-priority-restore-postgres.js` · `linear-exit-priority-snapshot-postgres.js`

All four fail at `Error: Track-B recovery pre-data dump failed`, and one of them
printed the reason outright:

```
Error: spawnSync /usr/lib/postgresql/17/bin/pg_dump.exe ENOENT
```

**The `.exe` is hard-coded in the suites' own source, not in the runner:**

| file | line |
|---|---|
| `test/linear-exit-priority-snapshot-postgres.js` | 22 |
| `test/linear-exit-priority-application-recovery.js` | 30 |
| `test/linear-exit-complete-application-recovery.js` | 70 |
| `test/linear-exit-credential-recovery.js` | 41 |
| `test/helpers/control-recovery-proof.js` | 34 |

each as `pgDump: path.join(path.dirname(cluster.psql),'pg_dump.exe')`.
`track-b-recovery-package.js` itself defaults to plain `pg_dump` and takes the
path as a parameter, so the platform assumption lives entirely in test code.
These four cannot pass on any non-Windows machine, whatever the environment
supplies. **This is a finding, not an environment excuse.**

(The two suites in §1 also carry the `.exe`, but they fail earlier and never
reach the dump, which is why they are counted as failures rather than here.)

### Need private inputs — 4 of 61 — for the storage session

| suite | what it stops on |
|---|---|
| `linear-exit-control-restore-only-postgres.js` | `fs.readFileSync(process.argv[2])` → `ERR_INVALID_ARG_TYPE`; the artifact comes from the owning control-recovery driver |
| `linear-exit-install-operator-postgres.js` | `assert(E && path.isAbsolute(E))` on `OBSERVED_INPUT_DIRECTORY` |
| `linear-exit-observed-full-install.js` | `explicit private observed catalog path required` |
| `linear-exit-observed-full-pipeline.js` | `explicit private observed input directory required` |

Each refuses immediately and by name. None of them is a failure of the code
under test.

---

## 3. What this run corrects in the first pass

The first pass reported **37 pass / 17 fail / 7 cannot run**, with *"15 of 61
fail identically at `d3cbca7f`, so they are not this month's work"*. That
sentence was true and misleading at the same time.

**At least six of those 15 fail only in a broken environment.** They pass now:

`linear-exit-install-bootstrap-postgres.js` ·
`linear-exit-install-journal-postgres.js` ·
`linear-exit-install-maintenance-postgres.js` ·
`linear-exit-install-finalize-postgres.js` ·
`linear-exit-followup-worker-postgres.js` ·
`linear-exit-followup-outcome-matrix.js` ·
`linear-exit-card-atomic-handlers.js` ·
`track-b-recovery-deferred-defaults-postgres.js` ·
`workload-native-postgres.js`

**The methodological point is the one worth keeping: "fails identically at the
pre-B10 commit" controls for regression, and for nothing else.** A suite broken
by the environment fails identically at every commit, which is exactly why that
control waved it through. A regression control is not a validity control.

The first pass's two NEW failures both pass now:
`linear-exit-observed-routines-postgres.js`, whose cross-suite byte pin was cut
and whose contract was regenerated to 122 functions, and
`linear-exit-admission-preflight-postgres.js`, which reported
`ADMISSION_INSTALLED_MISMATCH` then and passes now — **I have not established
which change made it pass and am not claiming one.**

---

## 4. The environment, and the four harness defects found building it

Reproduced from `qa/linear-exit-rehearsal/run-portable.ps1`: one fresh
disposable cluster per suite; `initdb --auth=scram-sha-256 --pwfile
--encoding=UTF8 --locale=C`, plus `--locale-provider=icu --icu-locale=en-US`
for `observed-full-install` and `install-operator` only; loopback TCP with a
per-cluster random password; `PGSSLMODE=disable`; the runner's full
`F63_/ARTIFACT_/WORKLOAD_TEST_/NATIVE_*_PSQL/PROOF_*` block;
`PROOF_OUTPUT_ROOT` **equal to the cluster run root**, as the runner has it;
`--experimental-strip-types` for the two lanes that need it; the
`TRACK_B_RECOVERY_TEST_*` block for the recovery lanes; PostgreSQL 16 for the
13 suites whose routing row says 16 and 17 for the 45 that say 17.

Deviations: Linux rather than Windows (the runner refuses any other OS, so it is
the environment that is reproduced, not the script); each suite invoked as its
own entry point, which is what the runner does for every lane but `unit` and
`f27`.

**Five attempts were needed, and four of them were discarded.** Every defect
was caught the same way: a verdict moved for a reason that had nothing to do
with the suite.

| # | defect | how it presented | suites wrongly judged |
|---|---|---|---|
| 1 | cluster ports inside the kernel ephemeral range (`32768 60999`) | `could not bind 127.0.0.1: Address already in use` | 3, as "cannot run here" |
| 2 | `PROOF_OUTPUT_ROOT` split from the cluster directory | `ENOENT lstat <root>/data` | 1, as a failure |
| 3 | `/usr/local/bin/node` (v20) shadowing `/opt/node22/bin/node` | `node: bad option: --experimental-strip-types` | 2, as failures |
| 4 | shallow clone | `path exists on disk, but not in <commit>` | 1, as a content mismatch |

Three tools the sandbox lacked and now has: **Deno 2.9.7** with the lockfile's
modules pre-cached (six suites spawn Deno workers under `--frozen
--cached-only`), **Playwright** (the repository had no `node_modules` at all),
and both PostgreSQL majors, which were already present.

Runs 1–4 are not reported as results. A run spanning two harnesses is not an
authoritative run, and the only difference between run 4 and run 5 was the
unshallowed clone, which moved exactly one suite.

---

Public-safety: no client slug, staff name, share token or credential appears
here. Cluster passwords were per-run random values, discarded with the cluster.
