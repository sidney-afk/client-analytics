# B9: re-deriving the catalog profile against the settled state

Journal blocker **B9**, decision **D12**. The live database is ahead of main,
so the catalog matches neither reviewed profile and steps 8, 9 and 10 cannot
pass. D12 says the profile is derived **once**, against a settled state, after
the hiring migration is on main.

**It is on main now**, at `1abdd1fa`, as
`migrations/2026-09-15-hiring-video-editor-role.sql`. The ordering constraint
D12 set is satisfied and this work is unblocked.

Read this before the sitting. The one thing it changes about your day is in the
next section.

---

## Read this first: B9 is bigger than a re-pin, and that is the news

B9 is written as "re-derive the catalog profile once". Measured against the
code on 2026-09-16, that phrasing understates it, and the difference matters
for when the freeze can lift.

`scripts/linear-exit-install-profiles.js` builds a plan by calling
`linear-exit-observed-install-plan.js`, whose **first act** is to refuse any
starting catalog that is not byte-exact against the reviewed observed catalog
contract `docs/independence/LINEAR_EXIT_OBSERVED_PUBLIC_CATALOG_20260912.json`
(67 public tables, catalog `809c5dc7…`). The plan's SQL sources are pinned and
do not vary with the catalog; the **gate** does.

That is why the second profile, `observed67_optout`, works the way it does: it
takes a live catalog, **reverses one exact known delta** — one column dropped
from `team_members` and one ACL string restored — asserts the result is again
`809c5dc7…`, and builds the plan from that.

The hiring delta cannot be reversed that way. Its footprint, read from the
migration on main:

| Class | What the migration does |
|---|---|
| Tables | creates `public.hiring_practical_test_jobs` (1 new public table) |
| Columns | adds two to `hiring_applications`, with two column comments |
| Indexes | adds three |
| Triggers | adds two, on the new table |
| Functions | ten `create or replace` in `public`, new and replaced |
| ACLs / RLS | RLS on the new table, plus revokes and grants on the table and on six functions |
| Other tables | alters `hiring_invite_jobs` and `hiring_application_events` |

Reversing all of that by hand, exactly enough to reproduce a byte-exact
`809c5dc7…`, is a large error-prone patch across six object classes. So there
are two honest routes and they are not the same size:

- **Route A — reverse the delta.** Mirrors `observed67_optout`. Cheap to
  describe, expensive and fragile to get exactly right here. Not recommended.
- **Route B — re-observe and re-review.** Derive a **new observed public
  catalog contract** at the settled state, review it, and let the plan build
  from that. This also produces a new derived install target and a new
  post-install table count.

**Route B is the recommendation.** It is more work up front and it is the one
that does not depend on getting a six-class reversal perfectly right.

Either way this is a **reviewed-artifact change, not a re-pin**, and it has to
land on the branch before the exit merge. That is the freeze-lift dependency.

---

## The thing that will otherwise stop step 14 dead

`scripts/linear-exit-install-operator.js` carries a **hard-coded** expectation:

```js
if(guards.length!==(alreadyFinal?0:90))fail('GUARD_COUNT');
```

90 is the number of public tables the installation is expected to have produced
by that point. Its provenance is
`docs/independence/LINEAR_EXIT_OBSERVED_INSTALL_TARGET_V1.json`, which records
`public_tables: 90` and `maintenance_guards_removed: 90`, derived from
`initial_public_catalog_sha256` `809c5dc7…` — the **67-table** live read of
2026-09-12.

The maintenance guard is not applied from a list. It is applied to every table
it finds:

```sql
select c.relname from pg_class c
 where c.relnamespace='public'::regnamespace and c.relkind in ('r','p')
```

So one extra live table means one extra guard, 90 becomes 91, and the operator
**refuses at `GUARD_COUNT` before installing anything**. The hiring migration
adds exactly one public table.

This has not been observed against the live database from here — this session
is read-only with no SQL, so it is derived from the code and the recorded
target, not measured. **The step-8 catalog receipt settles it**, which is why
its table count is now something to read and report rather than skip past.

If it holds, that constant is re-derived **with** the new target, deliberately.
It is never edited to match a number that came back: see `AGENTS.md` and
journal D8 on re-derivation versus silencing.

---

## The runnable block

One command. It rebuilds the settled state in a throwaway PostgreSQL 17
cluster, reads the catalog with the pinned query, and prints what the new
profile has to be written against.

**It reads nothing hosted. It installs nothing. It authorizes nothing.** No
password, token or project reference goes into it or comes out of it.

### Before you run it, confirm the plumbing (seconds, no inputs needed)

```powershell
node scripts/linear-exit-b9-catalog-derive.js --selfcheck
```

**Worked when:** `"marker": "B9_DERIVE_SELFCHECK_OK"` and `"problems": []`.

If `problems` is non-empty it names exactly what is missing — most likely the
PostgreSQL 17 binaries. Set `F42_REHEARSAL_PGBIN` to the bin directory the
runbook already uses on this machine and run it again. **Fix this before the
sitting, not during it.**

### The derivation

Start a throwaway PostgreSQL 17 cluster on `127.0.0.1`, point `PGHOST` and
`PGPORT` at it, then:

```powershell
node scripts/linear-exit-b9-catalog-derive.js `
  --observed-input=<your private observed-schema input directory> `
  --out=<a NEW private output directory>
```

`--observed-input` is the private observed-schema input directory recorded in
the checkpoint. It is not in this repository and never will be. `--out` must be
new and must not be the input directory.

**Worked when:** `"marker": "B9_SETTLED_CATALOG_DERIVED"`.

**Copy back four things, and only these four:**

1. `settled_catalog_sha256`
2. `settled_public_tables`
3. `pre_hiring_matches_optout_profile` — `true` means the reconstruction landed
   exactly on the reviewed opt-out profile before the hiring migration was
   applied, which is what makes the rest of the numbers trustworthy
4. the `sections` rows where `"moved": true`

The derived catalog itself is written to
`<out>/b9-settled-catalog.private.json`. It is schema metadata with no
application rows, but it stays private; **do not paste it into this repository
or into chat.**

> **STOP and report if** `pre_hiring_matches_optout_profile` is `false`. That
> means the settled state is not the opt-out profile plus the hiring migration
> — something else moved live, and no profile should be derived until we know
> what.

> **STOP if** the marker is `B9_DERIVE_FAILED`. It names the stage it reached
> and writes the stack to `<out>/b9-derive-error.private.log`. Preserve the
> directory, use a new one for any retry, and report the stage.

### Cross-check against the live read

`settled_catalog_sha256` should equal the catalog hash your step-8 read
returns. If the two agree, the settled state is fully understood offline and
the profile can be authored without another live read. **If they disagree, that
disagreement is the finding** — reconcile it before either number is used, per
`AGENTS.md`, "measure with the key the shipped code uses".

---

## What happens after, and what is still owed

None of the following is keyboard work for the owner.

1. Author the third profile (Route B) against the derived catalog, as a
   reviewed change on the branch.
2. Derive the new install target. The existing calibration path is
   `INSTALL_OPERATOR_CALIBRATE=1` with `INSTALL_OPERATOR_TARGET` pointing at a
   fresh target file — the same route `observed67_optout`'s target came from.
3. Re-derive the operator's post-install public-table constant with that
   target. Not by hand, and not by editing 90 to whatever came back.
4. Review, then steps 8, 9 and 10 run back to back.
5. **Only then** B10: `hiring_practical_test_jobs` joins the admission guard
   list, with the guard source and the retirement contract's expected triggers
   re-derived together. That ordering is D12's and it has not changed.

Related: [journal](LINEAR_EXIT_JOURNAL.md) · [execution map](LINEAR_EXIT_EXECUTION_MAP.md) ·
[owner sitting page](LINEAR_EXIT_OWNER_SITTING_20260915.md) ·
[living checkpoint](LINEAR_EXIT_PREPARATION_CHECKPOINT_20260914.md)
