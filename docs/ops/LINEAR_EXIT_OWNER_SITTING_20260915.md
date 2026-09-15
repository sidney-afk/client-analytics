# Owner sitting: steps 1, 8, 9, 10 and 11

One page, in running order, for the sitting at your own machine. Read it cold;
nothing else needs to be open.

**Nothing on this page changes production.** Every command here reads, captures,
encrypts or restores into a throwaway location. No SQL is installed, nothing is
deployed, no merge happens, no n8n workflow is touched, nothing is sent. That is
why you can stop almost anywhere without risk. The places where stopping costs
you a re-run are called out inline.

Main is frozen at `0aa5954`. Keep it frozen until the whole installation is
finished.

---

## Before you start: have these on hand

Do not begin until all five are true. The point of this list is that you never
discover a missing piece halfway through.

1. **The complete recovery record, open on your phone.** It lives in iOS Notes.
   You are the sole keyholder; nobody can reconstruct it for you. It must
   include **both independent secrets and the `keyId`**. A record missing the
   `keyId` cannot decrypt the package.
2. **Your phone or a second device**, able to reach the private Drive backup
   folder. Step 10 is only real because the package comes back down onto a
   *different* device than it went up from.
3. **Access to the private Drive backup folder** already used for these
   packages. Confirm you can open it before starting, not at upload time.
4. **A confirmed quiet window for Storage**, meaning nobody is moving or editing
   deliverables in Drive right now. The code freeze does not cover this. If
   files change mid capture, the capture is void and you start a fresh one.
5. **Roughly 90 minutes free.** See the timings below. If you have less, read
   the safe stopping points first and plan where you will break.

### Directory naming

Every command below writes into a **new** directory. Never reuse one, and never
reuse a directory from a failed attempt. Replace `UNIQUE` with something you
will not repeat, such as the date plus an attempt number: `20260916-1`,
`20260916-2` and so on. If a step fails, keep the failed directory for
diagnosis and use a new number for the retry.

### Where to run these from

**It does not matter.** Every path below is absolute. A fresh PowerShell window
at the default `C:\Users\<name>` prompt is fine. There is no folder to find.

---

## 1. Storage custody (step 1), 20 to 30 minutes plus transfer

This is first on purpose. It is outstanding from step 1, it must be done before
step 13, and it takes long enough that doing it after the catalog read would
expire the catalog and make you repeat it.

Open the operator's own instructions first and follow its usage line exactly:

```
D:/Sidney/Codex/2026-09-13-final-review-repairs/storage-quiet-window-operator.private.md
```

That file is the authority for the exact argument list. Do not guess flags from
this page; read its usage line.

Only after you have actually confirmed the quiet window, set the confirmation
variable and run the operator with a **new absolute immediate-child output
directory**:

```powershell
$env:STORAGE_QUIET_WINDOW_CONFIRMED = "YES"
node D:/Sidney/Codex/2026-09-13-final-review-repairs/run-storage-quiet-window.private.cjs D:/Sidney/Codex/2026-09-13-final-review-repairs/storage-window-UNIQUE
```

This performs a fresh inventory, the full export barriers and a decrypted
readback.

**Worked when:** the run exits without error and reports its readback passing.

> **STOP if** the run refuses, or reports that source files changed during the
> capture. That means the window was not actually quiet. Preserve the failed
> directory, wait for a genuinely quiet window, and start again into a new
> directory. Do not re-run into the same one.

Upload and downloaded-copy restoration are **separate** from this command and
are not done by it. Custody for Storage is not complete until the uploaded
package has been downloaded again and restored, the same drill as steps 9 and 10
below.

> **Safe to stop here.** This is the cleanest break point on the page.

---

## 2. Catalog read (finishes step 8), a few minutes

This produces the receipt that step 9 consumes, so it has to come before the
database refresh and close to it in time.

```powershell
node D:/Sidney/Codex/2026-09-13-final-review-repairs/read-install-day-catalog.private.cjs D:/Sidney/Codex/2026-09-13-final-review-repairs/day-catalog-UNIQUE
```

**Worked when:** the receipt reports its **supported-baseline check** and its
**TLS check** both passing, and the command exits zero.

The baseline it should match is **`observed67_optout`**. This session already
confirmed read-only that the live database carries both halves of that profile:
the `team_members.auto_assign_opt_out` column, and the table ACL with table-wide
read revoked from `anon` and `authenticated` in favour of column-level grants
that withhold the flag. If the receipt names the other profile, `observed67`,
something disagrees and you should stop.

> **STOP if** the receipt reports an unsupported baseline, a failed TLS check,
> an identity mismatch, or names `observed67`. Preserve the directory and report
> it. Do not continue to the database refresh on a refused catalog.

> **Timing rule, this is the one that bites.** The catalog goes stale after
> **one hour**. Run step 3 below straight after this. If more than an hour
> passes, you must re-run this command into a **new** directory before the
> database refresh. That is the only reason the order on this page matters.

---

## 3. Database capture (step 9), allow 20 to 30 minutes

Run this immediately after the catalog read. It takes the catalog directory from
step 2 as its first argument.

```powershell
node D:/Sidney/Codex/2026-09-13-final-review-repairs/refresh-install-day-database.private.cjs D:/Sidney/Codex/2026-09-13-final-review-repairs/day-catalog-UNIQUE D:/Sidney/Codex/2026-09-13-final-review-repairs/day-database-UNIQUE
```

Use the **same** `day-catalog-UNIQUE` you just created in step 2, and a **new**
`day-database-UNIQUE`.

**Worked when:** the output reports `DATABASE_CAPTURE_PASS`, the command exits
zero, and the scratch server is reported stopped.

> **STOP if** it refuses for any reason, or if the scratch server is not
> reported stopped. Preserve everything and report before retrying.

These wrappers fetch the stored secret internally. **No password goes in a
command argument, in a file you type, or in chat.** If anything ever asks you to
paste a database password into a command line, that is wrong; stop.

Now verify the local restore before you upload anything:

```powershell
node D:/Sidney/Codex/2026-09-13-final-review-repairs/restore-install-day-database.private.cjs D:/Sidney/Codex/2026-09-13-final-review-repairs/day-database-UNIQUE/encrypted D:/Sidney/Codex/2026-09-13-final-review-repairs/day-database-restore-UNIQUE
```

**Worked when:** it reports `ISOLATED_DATABASE_RESTORE_PASS`, exits zero, and
reports its scratch server stopped.

> **Safe to stop here**, though custody is not yet complete. Nothing is at risk;
> you simply have not finished proving the backup can come back from Drive. Do
> not record custody as done at this point.

---

## 4. Custody drill on a second device (step 10), 10 to 20 minutes

This is the step that makes the backup real. A package that only ever existed on
the machine that made it has not been proven recoverable.

1. **Upload** the encrypted package from `day-database-UNIQUE/encrypted` to the
   existing private Drive backup folder.
2. **Download that exact package** on your phone or second device.
3. **Compare** its full SHA-256 and file manifest against what was uploaded.
   They must match completely.
4. **Restore the downloaded copy** using the same restore command as above, with
   the downloaded package as input and a **new** output directory:

```powershell
node D:/Sidney/Codex/2026-09-13-final-review-repairs/restore-install-day-database.private.cjs <path-to-downloaded-package> D:/Sidney/Codex/2026-09-13-final-review-repairs/day-database-downloaded-restore-UNIQUE
```

**Worked when:** the hashes and manifest match exactly, and the restore of the
**downloaded** copy reports `ISOLATED_DATABASE_RESTORE_PASS` and exits zero.

> **Custody is incomplete until this passes.** A hash match alone is not enough,
> and a successful local restore in step 3 is not a substitute. The downloaded
> copy has to actually restore.

> **STOP if** the hash or manifest differs, or the downloaded-copy restore
> fails. Do not delete anything. Report it.

Then do the same upload, download, compare and restore drill for the **Storage**
package from step 1, which is still outstanding at that point.

One thing to keep straight: this proves **public-schema** recovery. It is not
full platform recovery and not asset recovery. Existing Drive and Frame
historical gaps stay as they are. The 14 inaccessible references have their own
private decision sheet, nothing about them is authorized for replacement or
deletion, and they do not block the dormant install.

> **Safe to stop here.** This is the natural end of your part of the sitting.

---

## 5. Pre-state snapshot (step 11), about 15 minutes, mine not yours

You do not need to be at the keyboard for this one. It is a session step: I
write the snapshot that step 25 is compared against, recording current
authority, the existing Linear inbound and outbound settings, the legacy
capability settings and worker state.

Much of it comes out of the private receipts your step 2 catalog run already
recorded, which is the other reason that run has to happen. Tell me when steps 1
through 4 are done and I will produce it and show you.

Nothing is changed by it. Existing live flags stay exactly as they are; nothing
is blanket-disabled, the retired-epoch switch is not called, and no worker is
stopped.

---

## Where you can stop, and where you should not

**Safe to stop, at any of these, with nothing at risk:**

- After Storage custody (section 1).
- After the local restore passes (end of section 3).
- After the downloaded-copy drill passes (end of section 4).

**Do not stop in the middle of these:**

- **Between the catalog read and the database capture.** Not because anything
  breaks, but because the catalog expires after an hour and you will have to run
  it again into a new directory. If you have to break, break *before* the
  catalog read, not after it.
- **Between capture and the downloaded-copy restore, if you are going to call
  custody done.** You can physically stop; just do not record it as complete.
  Custody is only complete when the downloaded copy restores.

**Never, on any failure:** re-run into a directory that already exists, delete a
failed attempt's output, or retype a password into a command. Preserve the
directory and report it.

---

## After the sitting

Steps 12 and 13 are next. Step 13 is an approval gate and nothing happens at it
without your explicit go-ahead. Storage custody and database custody both have
to be complete before step 13.

Related: [execution map](LINEAR_EXIT_EXECUTION_MAP.md) ·
[installation day detail](LINEAR_EXIT_INSTALLATION_DAY_20260914.md) ·
[recovery procedure](LINEAR_EXIT_RECOVERY_PROCEDURE.md) ·
[native backup route](LINEAR_EXIT_NATIVE_PREINSTALL_BACKUP_PREPARATION.md)

Open the recovery procedure before taking any recovery action.
