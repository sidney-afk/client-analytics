# Restore-to-new-project (BETA): decided, and what it is actually for

**DECIDED 2026-09-16. See journal D13 and D14.** This started as a proposal and
is kept as the reasoning behind two recorded decisions. It is no longer awaiting
a verdict.

- **D13 — it is NOT the recovery route.** In-place restore of the managed
  PHYSICAL backups remains it, as B4 closed on.
- **D14 — it IS proven as a way to stand a restored copy beside live**, so the
  owner's accepted "reconcile newer saves by hand" has an actual source on both
  sides instead of reconstruction from memory.

**The reviewed recovery procedure is unchanged by this file.**
[`LINEAR_EXIT_RECOVERY_PROCEDURE.md`](LINEAR_EXIT_RECOVERY_PROCEDURE.md) still
describes an in-place restore, and that is still the recovery route.

> **A future session must not read the identity measurement as having made
> restore-to-new-project the preferred route.** It removed one argument against
> it. It did not touch the argument that decided it.

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

### RETRACTED: it does NOT fail the installer's identity check

**This section originally claimed the opposite, and the claim was wrong. It is
corrected here rather than quietly deleted, because the mistake is the useful
part.**

What was written: `scripts/linear-exit-install-journal.js` builds the identity
the operator asserts, from `current_database()`, the database OID,
`session_user`, and `system_identifier` from `pg_control_system()`; and
therefore "a new project is a new cluster, so it carries a different one", so
`fail('IDENTITY')` follows.

The first half is right and was read from the code. **The second half was an
assumption about how Supabase provisions a restore, and the rehearsal measured
the opposite.** Live and the restored project both report
`7642734024280108049`. The restore carries the control file; it behaves as a
physical copy. The identity check survives it.

**Stated precisely, updated 2026-09-16.** `IDENTITY_SQL` checks four fields.
**Three of them were measured across the restore** — `system_identifier`,
`current_database` and the database OID — and all three survived. An earlier
version of this paragraph recorded the OID as expected-by-rule rather than
measured; the owner measured it. `session_user` is a property of the connection,
not of the restore.

**The refusal's other argument is untouched and stands on its own:** a restored
new project has a different reference, URL and keys, nothing points at it, and
the outage is not over until every consumer is repointed or the data migrated
back. That is still why this is not a recovery route. It never depended on the
identity claim.

**Why this happened, which is the part worth keeping.** The identity claim was
presented as verified because part of it was: the query really was read from the
code. The inference bolted onto it — what Supabase does when it provisions a
restore — was never checked, and it was checkable. That is precisely the rule
ratified the same day: *when a fact about live is knowable by reading live, read
it rather than reasoning toward it.* Here it was knowable by running the very
rehearsal this document proposed, and the document asserted the answer instead
of waiting for it.

---

## The three reasons it is a very good rehearsal route

### 1. It makes the outage duration measurable, which we currently call unknown

B4 is being closed with the restore duration recorded as **unknown**, because
measuring it in place means destroying the live database. Restore-to-new-project
measures exactly that number, on the real data volume, at no risk to anything.

That is the single cheapest way to convert an accepted unknown into a fact.

### 2. ANSWERED, 2026-09-16, by a rehearsal on the real project

**The rehearsal ran and the question is closed.** Live and the restored copy
both report `system_identifier` `7642734024280108049`. **Identical.**

A Supabase restore preserves cluster identity. The installer's identity check,
which is built on that value, would still pass against a restored database, and
by the physical-versus-logical rule below the in-place case follows by
implication. The recovery route B4 closed on works on this point.

The section below is kept as written, because it is the reasoning that made the
rehearsal worth an hour and $10, and because its measurements are still the rule
this conclusion rests on. **One thing in it must not be misread:** the
`7686148391648556190` and `7686148429403448532` values there are throwaway
clusters in a sandbox, created to establish the general rule. **Neither is
live's.** Live's is `7642734024280108049`.

What is still unmeasured under B4 is only the restore's outage **duration**,
recorded as unknown by deliberate choice.

### 2. It closes the last part of a question that is now MEASURED, not assumed

**Updated 2026-09-16. The general rule is no longer an assumption.** Measured on
an isolated PostgreSQL 17.11 cluster in this sandbox:

| Restore kind | `system_identifier` |
|---|---|
| original cluster | `7686148391648556190` |
| **physical** copy (`pg_basebackup`) | `7686148391648556190` — **preserved** |
| **logical** restore into a fresh `initdb` cluster | `7686148429403448532` — **new** |

So the rule is: **a physical restore carries the control file and preserves the
identifier; a logical restore into a new cluster cannot.** The identifier is a
property of the cluster, written at creation and copied verbatim by a physical
copy.

That matters directly, because the Backups page marks every one of the eight
daily backups **PHYSICAL**. So the in-place route's identity assumption is now
*supported* — by the platform's own label plus the PostgreSQL rule — rather than
merely assumed. It is still not *observed*: nobody has watched a managed restore
of this project and read the value afterwards.

**What is left is therefore narrow, and it is exactly what the rehearsal
observes:** does Supabase's restore-to-new-project carry the physical control
file into the new instance, or re-provision and replay? If it carries it, the
identity survives and the in-place case is settled by implication. If it does
not, then restore-to-new-project is logical in effect, and the recovery
procedure needs to say that a restored project must have its identity
expectation re-derived before any installation can resume against it.

Either answer is worth having, and the check is one query.

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
- **Cost, confirmed 2026-09-16.** An additional project on this organization's
  Pro plan is **$10/month recurring**, read from the organization's own cost
  endpoint. Supabase bills compute by the hour, so a project that lives for an
  afternoon should cost a small fraction of that — but **that proration is not
  something this session verified**, so budget up to the full $10 and delete the
  project the same day. Deleting it is the mitigation, and it is the last step
  of the rehearsal below.
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

---

## How to run the rehearsal

**Cost first:** an extra project is **$10/month** on this Pro organization, and
the mitigation is deleting it the same day. Nothing below starts until you are
happy with that.

Run it **during the offline authoring day**, so it costs you almost no attention:
start it, leave it, come back for two numbers.

1. Dashboard → the project → **Database** → **Backups** → **Scheduled backups**.
2. On the **newest** backup row — 16 Sep 2026 11:19:55 +0000, or whatever is
   newest when you do it — open its restore control and choose **Restore to new
   project (BETA)**. Use the newest so the rehearsal's duration is
   representative of a real recovery.
3. Give the new project an obviously disposable name. Something like
   `restore-rehearsal-<date>`, so nobody ever mistakes it for live.
4. **Start a timer when you confirm.** The elapsed time until the new project is
   usable is the number B4 currently records as unknown.
5. When it is up, open the **SQL editor on the NEW project** and run exactly:

```sql
select system_identifier::text as system_identifier,
       current_database(),
       (select oid::text from pg_database where datname = current_database()) as database_oid
from pg_control_system();
```

6. Report back three things: the elapsed time, that `system_identifier`, and
   that `database_oid`.
7. **Delete the rehearsal project.** This bounds the cost and stops a
   live-looking second database existing.

**What the answer means:**

- **`system_identifier` matches the original** → the restore is physical
  end to end, identity survives, and the in-place recovery route's assumption is
  settled by implication. Record it and move on.
- **It differs** → restore-to-new-project is logical in effect. That is a real
  finding: it means a restored project cannot be installed into or resumed into
  without re-deriving the identity expectation, and the recovery procedure
  should say so. Report it and change nothing yourself.

This runs against a throwaway project, never against live. It reads; it does not
write. Nothing about it touches the frozen main, the installation or the exit
plan.

---

Related: [recovery procedure](LINEAR_EXIT_RECOVERY_PROCEDURE.md) ·
[journal](LINEAR_EXIT_JOURNAL.md) ·
[owner sitting page](LINEAR_EXIT_OWNER_SITTING_20260915.md)
