# Proposal: "Restore to new project" (BETA) as a rehearsal route, not a recovery route

**Proposal only. The reviewed recovery procedure is unchanged by this file** and
must not be edited on the strength of it.
[`LINEAR_EXIT_RECOVERY_PROCEDURE.md`](LINEAR_EXIT_RECOVERY_PROCEDURE.md) still
describes an in-place restore, and that is still the recovery route.

Raised by the owner on 2026-09-16 after the B4 dashboard check: the managed
Backups page offers **Restore to new project (BETA)**, restoring a backup into a
separate project rather than over the live one. The question was whether that is
a better route for our case.

**Short answer: it is not a better recovery route, for one reason that is easy
to miss. It is an excellent rehearsal route, for three reasons, and it can close
two things we currently record as unknowable.**

---

## The reason it is not a recovery route

A new project is a **different database**, with a different project reference,
URL and keys. Everything that points at the database — the browser's
configuration, the Edge functions, the scheduled workers, the n8n workflows —
points at the old project, and keeps pointing there.

So the restore does not end the outage. It produces a healthy database that
nothing is talking to. Ending the outage then needs a second operation:
repointing every consumer at the new project, or migrating the data back into
the original one. **Neither is written down, neither is rehearsed, and the
repointing one is a configuration change inside the scope of the current
freeze.**

The in-place route has none of that. It is worse in every way except this one,
and this one is the way that matters when the site is down.

**This is the part worth flagging**, because the dashboard presents the two as
alternatives and the BETA option looks strictly safer. It is safer for the
database and not safer for the recovery.

### It also fails the installer's identity check, and that is verifiable

`scripts/linear-exit-install-journal.js` builds the identity the install
operator asserts:

```sql
select jsonb_build_object(
  'database', current_database(),
  'database_oid', (select oid::text from pg_database where datname=current_database()),
  'system_identifier', (select system_identifier::text from pg_control_system()),
  'session_user', session_user) as identity
```

`system_identifier` comes from the cluster's control file and is generated when
the cluster is created. A new project is a new cluster, so it carries a
different one, and `database_oid` will differ too. The operator compares this
against `expectedDatabaseIdentity` and calls `fail('IDENTITY')` on any
difference.

Consequence: a restored new project cannot be installed into, or resumed into,
without re-deriving the identity expectation first. If a restore happened
*during* the installation window, this route would not let the window continue.

---

## The three reasons it is a very good rehearsal route

### 1. It makes the outage duration measurable, which we currently call unknown

B4 is being closed with the restore duration recorded as **unknown**, because
measuring it in place means destroying the live database. Restore-to-new-project
measures exactly that number, on the real data volume, at no risk to anything.

That is the single cheapest way to convert an accepted unknown into a fact.

### 2. It answers a question nobody has asked yet: does identity survive a restore?

We do not know whether an **in-place** managed restore preserves
`system_identifier`. A physical restore from a base backup normally does, but
the managed flow is not ours to read, and the install operator's identity check
is built on that value.

If it does not survive, the recovery procedure has a gap: after a real recovery,
the installation could not resume against its own recorded identity. Nobody has
checked, and the check is one query.

A rehearsal restore answers it directly: restore to a new project, run
`select system_identifier from pg_control_system()` against both, and compare
with what the original records. It does not prove the in-place case, but it
establishes whether the value is derived from the cluster or carried with the
backup, which is most of the answer.

### 3. It is the right shape for the accepted-save boundary

The decision is to accept the loss of newer saves and reconcile by hand. In the
in-place route, the newer saves are **gone at the moment of restore** — the
thing you would reconcile against no longer exists, so "reconcile by hand" means
reconstructing from memory and from whatever is outside the database.

With a restore beside the live database, the restored copy and the current one
sit side by side and the reconciliation has an actual source on both sides. That
is a materially better position for the decision already taken, and it is
available without changing the recovery route: it is what you would reach for
*before* deciding to overwrite anything.

---

## What it does not cover

- **Storage is empty, not merely un-restored.** The dashboard's own note says
  database backups exclude Storage objects. In place, the existing Storage
  bucket is untouched by a database restore. In a new project there is no
  Storage at all. So in this route the separate Storage custody package stops
  being a backstop and becomes the only source. Worth knowing before relying on
  the route in anger.
- **Keys and tokens change.** New project, new keys and JWT secret. Anything
  holding a token against the old project is invalid. Not verified from here,
  and it should not be assumed benign.
- **It is BETA.** Behaviour may change or be withdrawn. Fine for a rehearsal,
  not something to make a documented recovery route depend on.
- **Cost.** A second project may bill for as long as it exists.
- **It proves public-schema recovery only**, same as everything else here. Not
  full platform recovery, not asset recovery.

---

## What is actually proposed

1. **Leave the recovery procedure alone.** In-place stays the recovery route.
2. **Run one restore-to-new-project as a rehearsal**, when convenient and
   outside any installation window, to measure the restore duration and read
   `system_identifier` on the result.
3. **Record both numbers** against B4, replacing "duration unknown" with a
   measured figure and answering the identity question the procedure currently
   assumes.
4. **Delete the rehearsal project afterwards**, so the cost is bounded and there
   is no second live-looking database to confuse anyone.
5. **Then**, and only then, decide whether the procedure should mention it as a
   reconciliation aid during a real recovery. That is a separate decision with
   its own review.

None of this is authorized by this file, and none of it is needed before the
install gate.

Related: [recovery procedure](LINEAR_EXIT_RECOVERY_PROCEDURE.md) ·
[journal](LINEAR_EXIT_JOURNAL.md) ·
[owner sitting page](LINEAR_EXIT_OWNER_SITTING_20260915.md)
