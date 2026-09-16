# Proposal: teach the operator runner to build the settled world

**Proposal only. Nothing has been applied.** `test/linear-exit-install-operator-postgres.js`
is a reviewed test runner on the installation path, not a flag, so it is
written here and changed only on the owner's word.

Raised by session C on 2026-09-16: the calibration refused before producing any
target or count, because the runner cannot build the database the settled
profile requires.

## What is wrong, read from the file

Line 10 applies the extra setup for **one** profile only:

```js
if(profile==='observed67_optout'){ c.exec(prerequisite…); c.exec("insert into public.team_members…"); }
```

There is **no `settled68` branch**, so for that profile the runner stands up the
plain observed schema and nothing else. The hiring migration is never applied.
Then `profiles.build(initial,'settled68')` demands a catalog hashing exactly to
`ddfa4c4f…` and refuses, correctly, because the database it was handed is not
the settled world.

So the refusal is the profile builder doing its job. **The runner is what is
incomplete.**

## What it should do

The recipe is not new and does not need inventing. It already exists, proven, in
`scripts/linear-exit-b9-catalog-derive.js`, which built the settled catalog the
owner byte-verified on 2026-09-16. In order:

1. the observed schema (the runner already does this);
2. the storage-column supplement (already);
3. the **opt-out prerequisite** — `migrations/2026-09-14-team-members-auto-assign-opt-out.sql`
   read from ref `73d5fdc361`, pinned `fbd5ae8e…`;
4. the **opt-out fixture row** in `team_members`;
5. the **hiring migration**, `migrations/2026-09-15-hiring-video-editor-role.sql`,
   read from the working tree since it is on main at `1abdd1fa`.

Steps 3 and 4 are exactly what line 10 already does for `observed67_optout`.
**`settled68` is that same world plus step 5.** That is the whole change.

### The shape it should take

Not a third `if`. Line 10's condition becomes a small table of what each profile
adds, so that the next profile is a row rather than a branch — the same reason
the guard counts stopped being literals:

| profile | opt-out prerequisite + fixture row | hiring migration |
|---|---|---|
| `observed67` | no | no |
| `observed67_optout` | **yes** | no |
| `settled68` | **yes** | **yes** |

Reading it as a table also makes the relationship legible: the settled world is
not a separate construction, it is the opt-out world with one migration on top.

## What it does to the existing two paths

**Nothing, and that is checkable rather than asserted.**

- **`observed67`** takes no extra setup today and its row says no to both. Its
  code path is unchanged in behaviour.
- **`observed67_optout`** takes the prerequisite and the fixture row today and
  its row says yes to those and no to the hiring migration. Identical behaviour,
  reached through a table lookup instead of an `if`.

The way to confirm that rather than take it: run the runner for both existing
profiles before and after, and require identical results. **Neither can be run
in the cloud session** — both need the private observed-schema inputs — so that
confirmation belongs to whoever applies this, on the machine that has them.

## What it does NOT fix

- **It does not make the calibration runnable in the cloud session.** The
  private observed-schema inputs are still required for every profile. This
  change removes a defect in the runner; it does not move where the runner can
  run.
- **It does not test the 91 derivation.** It makes the test possible. The
  derivation stays untested until a calibration actually completes, and the
  binding is unchanged: if it reports anything other than 91, that is a finding,
  and nobody adjusts a second time.

## One thing to decide when applying it

The opt-out prerequisite is read from a **historical ref**, `73d5fdc361`, and
pinned by hash. The hiring migration is on main today, so it can be read from
the working tree. Mixing the two sources in one setup path is slightly
uncomfortable — a future rewrite of history would break the first and not the
second. It is how the derive script does it and how the existing line 10 does
it, so this proposes no change there, but it is worth a deliberate decision
rather than inheriting it by default.

Related: [session C](LINEAR_EXIT_SESSION_C_20260916.md) ·
[B9 re-derivation](LINEAR_EXIT_B9_CATALOG_REDERIVATION.md) ·
[guard-count sites](LINEAR_EXIT_GUARD_COUNT_SITES.md) ·
[journal](LINEAR_EXIT_JOURNAL.md)
