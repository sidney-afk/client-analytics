# Owner sitting: steps 1, 8, 9, 10 and 11

One page, in running order, for the sitting at your own machine. Read it cold;
nothing else needs to be open.

**Nothing on this page changes production.** Every command here reads, captures,
encrypts or restores into a throwaway location. No SQL is installed, nothing is
deployed, no merge happens, no n8n workflow is touched, nothing is sent. That is
why you can stop almost anywhere without risk. The places where stopping costs
you a re-run are called out inline.

Main is frozen at **`1abdd1fa`** (re-frozen 2026-09-15 after PR #1407 merged).
The freeze now explicitly covers three things, not one: merges to main, live
database changes from any session or dashboard, and deployments of anything the
exit plan checks against. Keep it frozen until the whole installation is
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

> **CHANGED 2026-09-15 by B9. Read this before running it.** This read will
> **not** match a reviewed profile, and that is now the expected outcome, not a
> failure. The hiring practical-test and Video Editor migrations are live, so
> the catalog has moved past both `observed67` and `observed67_optout`. A third
> profile has to be derived from the settled state before steps 8, 9 and 10 can
> pass. Expect `profile: null` and a non-zero exit.

**What you are running it for now:** the new catalog hash and its diff, so a
profile can be derived against the settled state. You are gathering an input,
not passing a gate.

**Worked when:** the receipt reports **`tls_verified: true`**, the identity
matches, and it prints a catalog hash. Copy back three things: the hash, the
`profile` field, and the diff summary against the last passing catalog.

> **STOP and report, do not improvise, if** TLS fails or the identity does not
> match. Those are real failures. A `profile: null` with TLS verified and
> identity matched is the expected result today and is what the derivation
> needs.

> **Do not run step 3 after this one today.** Its wrapper consumes a catalog
> receipt and will refuse one that names no profile. Steps 9 and 10 wait until
> the new profile exists.

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

## Appendix: the B7 fingerprint run (not part of the sitting)

Separate from the five sections above and not time-critical. Run it whenever the
Windows session is free. It takes under a minute.

It answers one question: does frozen main `0aa5954` match all twelve deployed
functions, which decides whether recovery route C1 exists.

**Where from:** the repository root on the Windows machine, because the tool
reads Git. Anywhere else will fail.

**What it needs:** `SUPABASE_ACCESS_TOKEN` already present in that machine's
environment. It is not an argument to the command and must not be pasted into
chat, into a file, or into this page. If it is not set there, set it yourself on
that machine.

Run exactly this, as one line:

```powershell
node scripts/ef-fingerprint.js 0aa5954a5c63e3b6f399caf739e562b371393325 --slugs=onboarding-list,ai-onboarding-list,legacy-onboarding-list,onboarding-full,client-credentials,filming-plans,smm-weekly-reports,key-verify,linear-outbound,production-comments,production-archive,production-write
```

That is the full list of twelve. `notify` is deliberately absent: it has never
been deployed, so it has nothing to compare.

**The only line that matters** is the last one:

```
Summary: 12 PASS, 0 FAIL, 0 ERROR
```

- **12 PASS, 0 FAIL, 0 ERROR** means every deployed function matches `0aa5954`.
  C1 exists, and `0aa5954` is the commit. B7 closes yes.
- **Any FAIL or ERROR** means it does not match. The tool prints a reason line
  under each one. Copy those lines verbatim and hand them back without
  interpreting them; which functions fail and why is the whole answer.

Note that a slug can FAIL for a reason other than its source: the check also
requires the expected entrypoint, an active function and the expected JWT
posture. The printed reason says which, so do not read a FAIL as "the source
differs" without reading it.

Nothing about this run changes anything. It reads Git locally and reads the
deployed function list; it deploys nothing and writes nothing.

### What this run settles

Both gaps left open by the offline analysis, and it settles them completely.

**Gap 1, a deploy that came from a ref other than main's tip.** Settled, because
provenance stops mattering once content is compared. C1 asks whether a commit
*matches* what is deployed, and the fingerprint compares source closure content
directly. If the fingerprints agree, it is irrelevant which ref the deploy was
cut from; if they disagree, the answer is no regardless.

**Gap 2, the `release/` staging path versus the `supabase/functions/` path.**
Settled by the tool itself. `normalizeLivePath` maps deployed source paths back
to the canonical `functions/<slug>/…` form, handling staging roots and older
generic roots, and it **throws** on any path it cannot map rather than hashing
the wrong thing quietly. So a path-layout mismatch cannot produce a false PASS.
It can only produce a PASS, an honest FAIL, or a loud ERROR naming the path.

So after this single run, B7 is decided either way. No further offline analysis
is needed, and none should be treated as a substitute.

## Appendix: B5 browser capture (not part of the sitting)

Closes the **browser half** of B5. Independent of B7, which says nothing about
the browser. Under two minutes. Read-only: it downloads and hashes, nothing else.

**Where from:** anywhere. Paths below are absolute.

> **TIMING, corrected 2026-09-15. This is the part most likely to go wrong.**
> The capture must be taken **immediately before the exit merge**, not before
> "any merge". Every merge to main republishes Pages and moves the served
> browser. Merging PR #1407 already did exactly that, which is why the baseline
> below was recomputed against `1abdd1fa` and the earlier `0aa5954` values are
> stale and must not be used. If a capture is taken too early, it records a
> browser version we would never want to return to, and the whole point of the
> capture is lost while still looking complete. **Re-derive the baseline from
> main's tip at the moment you capture, not from any value written here in
> advance.**

**Why it works:** Pages publishes from `main`, so the served browser should be
main's tip. Confirming that gives you both halves of what B5 needs at once: a
hash-matched capture, and a `matched_git_sha` you can restore from with one
command.

Baselines computed from **`1abdd1fa`**, current main as of 2026-09-15, valid
only until the next merge:

| File | SHA-256 |
|---|---|
| `index.html` | `1d17a0f567071dd9a8ff70dd73244fc819614725c960fee95bbbb9b639979327` |
| `404.html` | `f3ded2c5a7c2b3dbe7398077de2f7704ae4268f39ad0df45d97751f703063402` |
| `CNAME` | `7991ae9386e5b7875e31e6755cc4f4209a6e31d00cf5f0ff3a9bbe83c2df8d47` |
| `synchro-social-favicon.png` | `32c638403963ec173b212d29f2c1933f949d1d3308cf3b80d9bd8e64463c91a5` |
| `synchro-social-logo.png` | `a48c665dcb07754d7aa11d258ed3e6816d501d2fde98d61d273fdd06ef116eab` |

Plus 18 files under `nav-icons/`. Only `index.html` changed between `0aa5954`
and `1abdd1fa`; the other four are unchanged, which is itself a useful signal
that the merge was browser-light.

```powershell
$out = "D:/Sidney/Codex/2026-09-13-final-review-repairs/browser-capture-UNIQUE"
New-Item -ItemType Directory -Path $out -Force | Out-Null
$base = "https://syncview.synchrosocial.com"
foreach ($f in @("index.html","404.html","CNAME","synchro-social-favicon.png","synchro-social-logo.png")) {
  Invoke-WebRequest -Uri "$base/$f" -OutFile "$out/$f" -Headers @{"Cache-Control"="no-cache"} -UseBasicParsing
  "{0}  {1}" -f (Get-FileHash "$out/$f" -Algorithm SHA256).Hash.ToLower(), $f
}
```

**Worked when:** the printed `index.html` hash equals the baseline for main's
tip at capture time, which is
`1d17a0f567071dd9a8ff70dd73244fc819614725c960fee95bbbb9b639979327` while main
is `1abdd1fa`, and the others match the table above.

- **All match** → the served browser is main's tip. Record that as the captured
  previous browser with `matched_git_sha` set to that SHA. The restoration route
  is then the documented one-liner,
  `git restore --source=<that-sha> -- index.html`, and the browser half of B5 is
  closed.
- **`index.html` differs** → the served browser is NOT main's tip. Stop and
  report the hash. That is a real finding, not a glitch: it means Pages is
  serving something other than the frozen commit, and the whole browser
  restoration assumption needs rechecking before the merge.

Do this **before** the merge. After the merge, Pages republishes and the
pre-merge browser is no longer downloadable.

## Appendix: B4 managed restore permission check (not part of the sitting)

Closes the part of B4 that no command can: whether the managed restore route is
actually executable by you on the correct project. This is a browser click path,
not a script, and it changes nothing.

1. Open [the Supabase dashboard](https://supabase.com/dashboard) and select the
   project recorded privately (its ref is in your private evidence directory;
   it is not written here).
2. Go to **Database → Backups**.
3. Confirm three things and write down what you see:
   - that you can see the backup list at all, and the timestamp of the latest;
   - whether a **Restore** control is present and enabled for your account, as
     opposed to greyed out or absent;
   - the current **Point in Time Recovery** state.
4. Do **not** start a restore. This is a capability check only.

**What each outcome means:**

- **Restore control present and enabled** → the route is executable, and B4's
  mechanical half is closed. What remains is the decision in the next line.
- **Absent or greyed out** → the route is not executable by you, and B4 cannot
  close on this path. Report it; a different operator or a plan change is needed
  before step 13.
- **PITR disabled** was the state observed on 2026-09-14. Turning it on before
  the installation would materially improve the recovery position, because it
  replaces "restore to the last nightly backup" with "restore to a chosen
  moment". That is a cost and configuration decision, so it is yours to make,
  but it is worth making deliberately rather than by default.

## After the sitting

Steps 12 and 13 are next. Step 13 is an approval gate and nothing happens at it
without your explicit go-ahead. Storage custody and database custody both have
to be complete before step 13.

Related: [execution map](LINEAR_EXIT_EXECUTION_MAP.md) ·
[installation day detail](LINEAR_EXIT_INSTALLATION_DAY_20260914.md) ·
[recovery procedure](LINEAR_EXIT_RECOVERY_PROCEDURE.md) ·
[native backup route](LINEAR_EXIT_NATIVE_PREINSTALL_BACKUP_PREPARATION.md)

Open the recovery procedure before taking any recovery action.
