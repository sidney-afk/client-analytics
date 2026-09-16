# Owner sitting: steps 8, 9, 10 and 11

One page, in running order, for the sitting at your own machine. Read it cold;
nothing else needs to be open.

**Nothing on this page changes production.** Every command here reads,
captures, encrypts or restores into a throwaway location. No SQL is installed,
nothing is deployed, no merge happens, no n8n workflow is touched, nothing is
sent. That is why you can stop almost anywhere without risk. The places where
stopping costs you a re-run are called out inline.

Main is frozen at **`1abdd1fa`**. The freeze covers three things: merges to
main, live database changes from any session or dashboard, and deployments of
anything the exit plan checks against. Keep it frozen until the installation is
finished.

> **Step 1 is CLOSED**, 2026-09-16, on your explicit acceptance of the reduced
> Storage drill. Storage custody is complete and is **not** part of this
> sitting. It carries a permanent caveat recorded under journal B1: no package,
> database or Storage, has ever been retrieved on a separate device. Both
> drills were same-machine round trips through private Drive.

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
4. **PostgreSQL 17 reachable**, for section 5. Prove it in advance with the
   ten-second selfcheck in that section. Do not discover a missing binary
   mid-sitting.
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

### The order, and the one clock in it

| # | What | Step | Time | Clock? |
|---|---|---|---|---|
| 1 | Catalog read | 8 | a few minutes | **starts a 1-hour clock** |
| 2 | Database capture and local restore | 9 | 20–30 min | **must follow 1 inside the hour** |
| 3 | Upload, download on a second device, compare, restore | 10 | 10–20 min plus transfer | no |
| 4 | Managed restore permission check (B4) | — | 2 minutes | no |
| 5 | Settled-catalog derivation (B9) | — | 20–30 min | no |
| 6 | Pre-state snapshot | 11 | ~15 min, **mine not yours** | no |

Sections 1 and 2 are the only pair that must stay together. Everything from
section 3 onward can happen later the same day, or the next day, with nothing
lost. **If you have to break, break before section 1, not between 1 and 2.**

Section 5 needs no keyboard time from you beyond starting it, but it is the one
that unblocks the rest of the plan, so do not drop it if you are short on time
— drop section 4 instead and do it whenever.

---

## 1. Catalog read (step 8), a few minutes — STARTS THE CLOCK

This produces the receipt that section 2 consumes, so it has to come before the
database refresh and close to it in time.

```powershell
node D:/Sidney/Codex/2026-09-13-final-review-repairs/read-install-day-catalog.private.cjs D:/Sidney/Codex/2026-09-13-final-review-repairs/day-catalog-UNIQUE
```

> **This read will NOT match a reviewed profile, and that is the expected
> outcome, not a failure.** The hiring practical-test and Video Editor
> migrations are live, so the catalog has moved past both `observed67` and
> `observed67_optout`. Expect `profile: null` and a non-zero exit. See journal
> B9 and [the B9 re-derivation page](LINEAR_EXIT_B9_CATALOG_REDERIVATION.md).

**What you are running it for:** the receipt section 2 needs, plus three
numbers the profile derivation is authored against.

**Worked when:** the receipt reports **`tls_verified: true`**, the identity
matches, and it prints a catalog hash.

**Copy back four things:**

1. the catalog hash;
2. the `profile` field (expected: `null`);
3. the diff summary against the last passing catalog;
4. **the public table count.** This one is new and it matters more than it
   looks. `scripts/linear-exit-install-operator.js` hard-codes a post-install
   expectation of **90** public tables and refuses with `GUARD_COUNT` if the
   number differs. That 90 came from a **67**-table live read on 2026-09-12,
   and the hiring migration adds one table. If the live count is now 68, step
   14 stops before it installs anything. Nobody has measured this against the
   live database yet — **your receipt is what settles it.** Reasoning is on
   [the B9 page](LINEAR_EXIT_B9_CATALOG_REDERIVATION.md).

> **STOP and report, do not improvise, if** TLS fails or the identity does not
> match. Those are real failures. A `profile: null` with TLS verified and
> identity matched is the expected result today.

> **Do not skip ahead to section 5 with this receipt.** The wrapper in section
> 2 consumes a catalog receipt and the clock is running. Derivation is not
> time-critical; the database capture is.

> **The clock. This is the one that bites.** The catalog goes stale after **one
> hour**. Run section 2 straight after this. If more than an hour passes, you
> must re-run this command into a **new** directory before the database
> refresh. That is the only reason the order on this page matters.

---

## 2. Database capture and local restore (step 9), allow 20 to 30 minutes

Run this immediately after section 1. It takes the catalog directory from
section 1 as its first argument.

```powershell
node D:/Sidney/Codex/2026-09-13-final-review-repairs/refresh-install-day-database.private.cjs D:/Sidney/Codex/2026-09-13-final-review-repairs/day-catalog-UNIQUE D:/Sidney/Codex/2026-09-13-final-review-repairs/day-database-UNIQUE
```

Use the **same** `day-catalog-UNIQUE` you just created, and a **new**
`day-database-UNIQUE`.

**Worked when:** the output reports `DATABASE_CAPTURE_PASS`, the command exits
zero, and the scratch server is reported stopped.

> **STOP if** it refuses for any reason, or if the scratch server is not
> reported stopped. Preserve everything and report before retrying.

These wrappers fetch the stored secret internally. **No password goes in a
command argument, in a file you type, or in chat.** If anything ever asks you
to paste a database password into a command line, that is wrong; stop.

Now verify the local restore before you upload anything:

```powershell
node D:/Sidney/Codex/2026-09-13-final-review-repairs/restore-install-day-database.private.cjs D:/Sidney/Codex/2026-09-13-final-review-repairs/day-database-UNIQUE/encrypted D:/Sidney/Codex/2026-09-13-final-review-repairs/day-database-restore-UNIQUE
```

**Worked when:** it reports `ISOLATED_DATABASE_RESTORE_PASS`, exits zero, and
reports its scratch server stopped.

> **Safe to stop here**, though custody is not yet complete. Nothing is at
> risk; you simply have not finished proving the backup can come back from
> Drive. Do not record custody as done at this point.

---

## 3. Custody drill on a second device (step 10), 10 to 20 minutes

This is the step that makes the backup real. A package that only ever existed
on the machine that made it has not been proven recoverable.

**This one is not optional and not a spare.** Point-in-time recovery was
declined on cost (journal, 2026-09-15). That decision makes sections 2 and 3
*the* recovery route for the hosted database, not a belt-and-braces extra. If
this drill does not pass, there is no executable route back.

1. **Upload** the encrypted package from `day-database-UNIQUE/encrypted` to the
   existing private Drive backup folder.
2. **Download that exact package** on your phone or second device.
3. **Compare** its full SHA-256 and file manifest against what was uploaded.
   They must match completely.
4. **Restore the downloaded copy** using the same restore command as above,
   with the downloaded package as input and a **new** output directory:

```powershell
node D:/Sidney/Codex/2026-09-13-final-review-repairs/restore-install-day-database.private.cjs <path-to-downloaded-package> D:/Sidney/Codex/2026-09-13-final-review-repairs/day-database-downloaded-restore-UNIQUE
```

**Worked when:** the hashes and manifest match exactly, and the restore of the
**downloaded** copy reports `ISOLATED_DATABASE_RESTORE_PASS` and exits zero.

> **Custody is incomplete until this passes.** A hash match alone is not
> enough, and a successful local restore in section 2 is not a substitute. The
> downloaded copy has to actually restore.

> **STOP if** the hash or manifest differs, or the downloaded-copy restore
> fails. Do not delete anything. Report it.

If you do this download on a genuinely different device, say so explicitly when
you report back — it would be the first time any package has been retrieved on
separate hardware, and it would narrow the permanent caveat under journal B1.

One thing to keep straight: this proves **public-schema** recovery. It is not
full platform recovery and not asset recovery. Existing Drive and Frame
historical gaps stay as they are. The 14 inaccessible references have their own
private decision sheet, nothing about them is authorized for replacement or
deletion, and they do not block the dormant install.

> **Safe to stop here.** This is the natural end of the time-critical part.

---

## 4. Managed restore permission check (B4), 2 minutes

Closes the part of B4 that no command can: whether the managed restore route is
actually executable by you on the correct project. A browser click path, not a
script. It changes nothing.

1. Open [the Supabase dashboard](https://supabase.com/dashboard) and select the
   project recorded privately. Its ref is in your private evidence directory;
   it is deliberately not written here.
2. In the left sidebar, open **Database**.
3. Open **Backups** under it.
4. Look at the **Scheduled backups** tab and write down what you see:
   - can you see the backup list at all, and what is the timestamp of the
     latest entry;
   - is there a **Restore** control on a backup row, and is it **enabled** for
     your account, as opposed to greyed out or absent entirely;
   - what does the **Point in Time Recovery** tab say the current state is.
5. **Do not start a restore.** This is a capability check only. If a
   confirmation dialog opens, cancel it.

**What each outcome means:**

- **Restore control present and enabled** → the route is executable and B4's
  mechanical half closes. The decision half is already made: no PITR, on cost.
- **Absent or greyed out** → the route is not executable by you, and B4 cannot
  close on this path. Report it. A different operator or a plan change is
  needed before step 13, and sections 2 and 3 become the only route back.
- **PITR disabled** was the state observed on 2026-09-14 and you have decided
  against enabling it on cost. Nothing to do; just confirm it still reads
  disabled, so the recovery procedure is describing the real configuration.

---

## 5. Settled-catalog derivation (B9), 20 to 30 minutes

This is the one that unblocks the rest of the plan. Steps 8, 9 and 10 cannot
*pass* — as opposed to run — until a profile exists for the settled state, and
nothing after them can start until that is reviewed.

Full reasoning, the two routes and what is owed afterwards are on
**[the B9 re-derivation page](LINEAR_EXIT_B9_CATALOG_REDERIVATION.md)**. Read
its first section before you run this; it explains why B9 turned out to be
larger than a re-pin.

**Confirm the plumbing first. Seconds, no inputs, do it before the sitting:**

```powershell
node scripts/linear-exit-b9-catalog-derive.js --selfcheck
```

**Worked when:** `"marker": "B9_DERIVE_SELFCHECK_OK"` and `"problems": []`.
Anything in `problems` names exactly what is missing — most likely the
PostgreSQL 17 binaries, which you set with `F42_REHEARSAL_PGBIN`.

**Then the derivation.** Start a throwaway PostgreSQL 17 cluster on
`127.0.0.1`, point `PGHOST` and `PGPORT` at it, and run:

```powershell
node scripts/linear-exit-b9-catalog-derive.js `
  --observed-input=<your private observed-schema input directory> `
  --out=D:/Sidney/Codex/2026-09-13-final-review-repairs/b9-derive-UNIQUE
```

**Worked when:** `"marker": "B9_SETTLED_CATALOG_DERIVED"`.

**Copy back:** `settled_catalog_sha256`, `settled_public_tables`,
`pre_hiring_matches_optout_profile`, and the `sections` rows marked
`"moved": true`. Nothing else, and **not** the derived catalog file itself.

> **STOP and report if** `pre_hiring_matches_optout_profile` is `false`. It
> means something other than the hiring migration moved live, and no profile
> should be derived until we know what.

> **Cross-check.** `settled_catalog_sha256` should equal the catalog hash your
> section 1 read returned. **If they disagree, the disagreement is the
> finding** — do not pick one. Report both.

---

## 6. Pre-state snapshot (step 11), about 15 minutes, mine not yours

You do not need to be at the keyboard for this one. It is a session step: I
write the snapshot that step 25 is compared against, recording current
authority, the existing Linear inbound and outbound settings, the legacy
capability settings and worker state.

Much of it comes out of the private receipts your section 1 catalog run already
recorded, which is the other reason that run has to happen. Tell me when
sections 1 through 5 are done and I will produce it and show you.

Nothing is changed by it. Existing live flags stay exactly as they are; nothing
is blanket-disabled, the retired-epoch switch is not called, and no worker is
stopped.

---

## Where you can stop, and where you should not

**Safe to stop, at any of these, with nothing at risk:**

- After the local restore passes (end of section 2).
- After the downloaded-copy drill passes (end of section 3).
- Before or after section 4 or 5 — neither is time-critical.

**Do not stop in the middle of these:**

- **Between section 1 and section 2.** Not because anything breaks, but because
  the catalog expires after an hour and you will have to run it again into a
  new directory. If you have to break, break *before* section 1, not after it.
- **Between capture and the downloaded-copy restore, if you are going to call
  custody done.** You can physically stop; just do not record it as complete.
  Custody is only complete when the downloaded copy restores.

**Never, on any failure:** re-run into a directory that already exists, delete
a failed attempt's output, or retype a password into a command. Preserve the
directory and report it.

---

## NOT today: the B5 browser capture

Closes the **browser half** of B5. It is on this page so it is not lost, and it
is out of the sitting so it is not taken too early.

> **TIMING. This is the whole difficulty, and it is why this is not in the
> ordered pass above.** The capture must be taken **immediately before the exit
> merge** — the merge of PR #1391 at step 17 — and **not before any other
> merge**. Every merge to main republishes Pages and moves the served browser.
> Merging PR #1407 already did exactly that, which is why the earlier `0aa5954`
> baselines had to be thrown away. A capture taken at any other moment records
> a browser version we would never want to return to, **while still looking
> complete**, which is the worst of both.
>
> Concretely: not today, not after the install at step 14, not "while I'm here
> anyway". At step 16, after the merge is approved and before it happens.

**Why it works:** Pages publishes from `main`, so the served browser should be
main's tip. Confirming that gives you both halves of what B5 needs at once: a
hash-matched capture, and a `matched_git_sha` you can restore from with one
command.

**Do not trust a baseline written on this page.** Derive it from main's tip at
the moment you capture. This block does that itself — it reads the expected
hashes out of git rather than from a table, so it cannot go stale:

**Run this from the repository checkout on this machine**, because it reads
git. Everything else on this page runs from anywhere; this one does not.

```powershell
$out = "D:/Sidney/Codex/2026-09-13-final-review-repairs/browser-capture-UNIQUE"
$fromGit = Join-Path $out "from-git"
$served  = Join-Path $out "served"
New-Item -ItemType Directory -Path $fromGit, $served -Force | Out-Null

$sha = (git rev-parse origin/main).Trim()
$base = "https://syncview.synchrosocial.com"
$files = @("index.html","404.html","CNAME","synchro-social-favicon.png","synchro-social-logo.png") +
         @(git ls-tree -r --name-only $sha -- nav-icons/)
"capturing against main $sha, $($files.Count) files"

# Binary-safe: let git and tar move the bytes, never PowerShell.
git archive $sha -- $files | tar -x -C $fromGit
if ($LASTEXITCODE -ne 0) { throw "git archive failed" }

$bad = 0
foreach ($f in $files) {
  $dest = Join-Path $served $f
  New-Item -ItemType Directory -Path (Split-Path $dest) -Force | Out-Null
  Invoke-WebRequest -Uri "$base/$f" -OutFile $dest -Headers @{"Cache-Control"="no-cache"} -UseBasicParsing
  $g = (Get-FileHash (Join-Path $fromGit $f) -Algorithm SHA256).Hash.ToLower()
  $s = (Get-FileHash $dest -Algorithm SHA256).Hash.ToLower()
  if ($g -ne $s) { $bad++; "MISMATCH  $f"; "  git    $g"; "  served $s" } else { "ok        $f" }
}
"matched_git_sha = $sha ; files = $($files.Count) ; mismatches = $bad"
```

**Worked when:** `mismatches = 0`. Record that run's `matched_git_sha` as the
captured previous browser. The restoration route is then the documented
one-liner, `git restore --source=<that-sha> -- index.html`, and the browser
half of B5 is closed.

- **Any mismatch** → the served browser is NOT main's tip. **Stop and report
  the hashes.** That is a real finding, not a glitch: it means Pages is serving
  something other than the frozen commit, and the whole browser restoration
  assumption needs rechecking **before** the merge.

Do this **before** the merge. After the merge, Pages republishes and the
pre-merge browser is no longer downloadable.

---

## Done and off this page

**The B7 fingerprint run is complete.** It closed YES on 2026-09-15:
`Summary: 12 PASS, 0 FAIL, 0 ERROR` against frozen main `0aa5954`, which
remains an ancestor of `1abdd1fa`. Recovery route C1 exists and `0aa5954` is
its commit. `notify` stays outside C1 by design (journal B8). Do not re-run it;
the command and its reasoning are in the journal if they are ever needed again.

## After the sitting

Steps 12 and 13 are next. Step 13 is an approval gate and nothing happens at it
without your explicit go-ahead. Storage custody (done) and database custody
(sections 2 and 3) both have to be complete before step 13, and the B9 profile
has to be derived and reviewed before steps 8, 9 and 10 can be called passed.

Related: [B9 re-derivation](LINEAR_EXIT_B9_CATALOG_REDERIVATION.md) ·
[execution map](LINEAR_EXIT_EXECUTION_MAP.md) ·
[installation day detail](LINEAR_EXIT_INSTALLATION_DAY_20260914.md) ·
[recovery procedure](LINEAR_EXIT_RECOVERY_PROCEDURE.md) ·
[native backup route](LINEAR_EXIT_NATIVE_PREINSTALL_BACKUP_PREPARATION.md)

Open the recovery procedure before taking any recovery action.
