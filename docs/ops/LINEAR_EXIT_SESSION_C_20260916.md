# Session C: the target calibration, plus two things that must not first run under a clock

One page, in running order, for the second keyboard sitting. Read it cold.

**Nothing on this page changes production.** Everything reads, parses, hashes or
writes into a throwaway location. No SQL is installed, nothing is deployed, no
merge happens, no n8n workflow is touched, nothing is sent.

Main is frozen at **`1abdd1fa`**.

## Why sections 2 and 3 are here rather than later

The sweep on 2026-09-16 found two blocks that had **never been executed as
written**. Neither is known to be wrong. That is not the same as proof, and both
would otherwise first run at the worst possible moment:

- the **B5 browser capture** would first run immediately before the exit merge;
- the **step 9 and 10 database blocks** would first run inside a one-hour clock,
  where a failure costs the catalog read and the whole sitting.

Session C is already a keyboard session, so proving them here costs almost
nothing. **Neither section performs the real operation.** They establish that
the blocks run, and stop.

## Where to run these from

**It does not matter**, except where a section says otherwise. Every path is
absolute, including the paths to scripts.

---

## 1. Target calibration, 30 to 40 minutes

This is the reason for the sitting. It produces the install target for the
settled profile, and the real post-install public table count.

Full context: [B9 catalog re-derivation](LINEAR_EXIT_B9_CATALOG_REDERIVATION.md).

Prerequisites, all three, and all hard refusals if missing:

1. A throwaway PostgreSQL 17 cluster **listening on `127.0.0.1`**, created with
   the ICU locale, exactly as in the successful 2026-09-16 run:

```powershell
& "<your PostgreSQL 17 bin>\initdb.exe" -D "<new data dir>" -U postgres -A trust -E UTF8 --locale-provider=icu --icu-locale=en-US --locale=en-US
```

2. `F63_REQUIRE_POSTGRES=1` set, and `PGHOST` / `PGPORT` pointed at that cluster.
3. Your private observed-schema input directory.

**Confirm all of it first. Seconds, and it probes the collation too:**

```powershell
node D:/Sidney/Codex/2026-09-13-linear-exit-review-fixes/scripts/linear-exit-b9-catalog-derive.js --selfcheck
```

**Worked when:** `"marker": "B9_DERIVE_SELFCHECK_OK"` and `"problems": []`.

> **SECTION 1 CANNOT RUN YET. Read this before you sit down.**
>
> The rehearsal was attempted on 2026-09-16 and stopped on a blocker in the
> code, not in the command. **The calibrate path has its own hard-coded guard
> count**, `assert.equal(guards.length,90)` in
> `test/helpers/install-operator-worker.mjs`, separate from the one already
> known about in `scripts/linear-exit-install-operator.js`. The settled database
> has 68 public tables rather than 67, so the calibration would produce 91
> guards and **abort before it could derive a target**.
>
> That is the entire purpose of this section, so section 1 would have failed at
> the keyboard with nothing to show for it.
>
> **Both constants are re-derived and reviewed before this section is written
> or run.** The derivation is recorded in the journal; it is not an edit from 90
> to 91 to make a check pass. Until that is done and the command has actually
> been executed, this box stays and **section 1 does not exist**.
>
> **Sections 2 and 3 below are unaffected and are worth doing on their own.**

---

## 2. B5 browser capture, DRY RUN ONLY, about 2 minutes

> **Executed as written in PowerShell 7.4.6 on 2026-09-16**, with only the
> `$probe` path substituted for a local one. Output: `23 files expected`,
> `extracted 23 files`, and the `index.html` hash equal to main's tip. The array
> splatting into `git`, the `git archive | tar` pipe and `Get-FileHash` all
> behave. **Residual difference: that run was PowerShell on Linux, not Windows.**
> What is still unproven there is `tar.exe` being on PATH, which is the one
> thing this dry run exists to find out.

**This is not the B5 capture.** It proves the capture block runs on this
machine, and then stops. The real capture happens immediately before the exit
merge and nowhere else; taking it now would record a browser version we would
never want to return to.

**Run this from the repository checkout**, because it reads git.

What it establishes: that `tar` is present, that PowerShell splats the file list
into `git` correctly, and that `git archive` reproduces main's bytes. What it
deliberately does **not** do: download anything from the live site, or record
anything as a capture.

```powershell
$probe = "D:/Sidney/Codex/2026-09-13-final-review-repairs/b5-dryrun-UNIQUE"
New-Item -ItemType Directory -Path $probe -Force | Out-Null
$sha = (git rev-parse origin/main).Trim()
$files = @("index.html","404.html","CNAME","synchro-social-favicon.png","synchro-social-logo.png") +
         @(git ls-tree -r --name-only $sha -- nav-icons/)
"main $sha, $($files.Count) files expected"
git archive $sha -- $files | tar -x -C $probe
if ($LASTEXITCODE -ne 0) { throw "git archive or tar failed" }
$got = (Get-ChildItem -Path $probe -Recurse -File).Count
"extracted $got files"
"index.html sha256: " + (Get-FileHash (Join-Path $probe "index.html") -Algorithm SHA256).Hash.ToLower()
```

**Worked when:** `23 files expected`, `extracted 23 files`, and the printed
`index.html` hash equals the hash of `index.html` at main's tip. While main is
`1abdd1fa` that is
`1d17a0f567071dd9a8ff70dd73244fc819614725c960fee95bbbb9b639979327`.

- **`tar` not recognised** → the real capture needs a different extraction step.
  Report it; do not improvise one now.
- **Nothing extracted, or a file count other than 23** → the array is not
  reaching `git` as separate arguments. Report the number you got.
- **Hash differs** → report it. It means git is not reproducing the bytes we
  think it is, which matters more than the capture.

Delete `b5-dryrun-UNIQUE` afterwards, or leave it; it is a throwaway either way.

---

## 3. Step 9 and 10 preflight, about 5 minutes, and read the two usage lines

> **Executed as written in PowerShell 7.4.6 on 2026-09-16**, with the `$dir`
> path substituted and stand-in files in place of the private wrappers. It
> correctly reported `ok` for intact files, `PARSE FAIL` for a deliberately
> broken one and `MISSING` for an absent one, so its failure detection works
> rather than just its happy path. `$LASTEXITCODE` from `node --check` is read
> correctly.

The three database blocks in the later sitting have never run in their current
form, and they will run inside the one-hour clock. **Everything checkable is
checked here, before that clock exists.**

This section runs none of the wrappers. It checks that they are there, that they
parse, and that the shell can find node.

```powershell
$dir = "D:/Sidney/Codex/2026-09-13-final-review-repairs"
node --version
foreach ($w in @("read-install-day-catalog.private.cjs","refresh-install-day-database.private.cjs","restore-install-day-database.private.cjs")) {
  $p = Join-Path $dir $w
  if (-not (Test-Path -LiteralPath $p)) { "MISSING   $w"; continue }
  node --check $p
  if ($LASTEXITCODE -eq 0) { "ok        $w" } else { "PARSE FAIL $w" }
}
```

`node --check` parses a file and **executes nothing**. It proves the wrapper is
present, readable and intact.

**Worked when:** all three print `ok`.

> **What this CANNOT prove, said plainly rather than papered over.** It does not
> check the argument lists on the later sitting page. Those wrappers are private
> and the cloud session cannot read them, so the argument order and flags on
> that page have never been verified against the wrappers themselves. No
> preflight fixes that.

**So do this, and it is the part that actually closes the gap.** The house
already solved it for the Storage operator, whose section said: *that file is
the authority for the exact argument list; do not guess flags from this page.*
**The same was never done for the database wrappers.** Open each and read its
usage line:

```
D:/Sidney/Codex/2026-09-13-final-review-repairs/refresh-install-day-database.private.cjs
D:/Sidney/Codex/2026-09-13-final-review-repairs/restore-install-day-database.private.cjs
```

Compare each against the block on the
[later sitting page](LINEAR_EXIT_OWNER_SITTING_20260915.md), section "The LATER
sitting". **If the argument order or count differs from what that page shows,
the page is wrong and the wrapper is right.** Report the difference; do not edit
the page mid-sitting.

If they agree, say so, and the later sitting's blocks stop being unproven
guesses and become checked against their own authority.

---

## What is still owed after this sitting

1. Pin the target and re-derive the operator's hard-coded post-install table
   count of **90** from the real number. Not edited to match: re-derived. Cloud
   session's work.
2. Run the isolated PostgreSQL 17 lanes against the settled profile and push.
3. Your review of the contract, the profile, the target and the constant
   together. That is what unblocks step 13.
4. Only then B10, in D12's order.

Related: [B9 re-derivation](LINEAR_EXIT_B9_CATALOG_REDERIVATION.md) ·
[later sitting](LINEAR_EXIT_OWNER_SITTING_20260915.md) ·
[execution map](LINEAR_EXIT_EXECUTION_MAP.md) ·
[journal](LINEAR_EXIT_JOURNAL.md)
