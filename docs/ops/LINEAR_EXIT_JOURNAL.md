# Linear exit: running journal

Why this file exists: the checkpoint records **where we are**. Nothing recorded
**how we got here or why**. Chat sessions end. Without this, the next session
inherits the state but not the reasoning, and will either relitigate settled
arguments or quietly contradict them.

Written for someone who was not here. Plain English. This is a record of
judgment, not a changelog of commits.

## How to keep it

- **Append, never rewrite.** When something turns out to be wrong, add the
  correction *below* the original. Do not edit the original away. The wrong
  turn is part of the record and is often the useful part.
- **Entries are events, not commands.** One entry per meaningful thing that
  happened, not one per command run.
- **Newest at the top** within the progress log.
- **Blockers come off with a date and a note**, never by silent deletion.
- **Nothing private.** No secrets, no tokens, no client display names, no client
  slugs, no share links. Say "one active client" and cite ids, not names. The
  repository is public and a gate fails the merge on any identity a change adds.
- **Update it as part of finishing a step**, not as a separate chore at the end
  of the day. A journal written later is a journal written from memory.

Dates are the date of the event. Where something could not be verified from the
record it is marked as such rather than stated flatly.

---

## 1. Progress log

### 2026-09-16 — Search rule ratified; per-site survey written with evidence labels; v3 held pending the site-9 trace

**The rule is in `AGENTS.md`.** Both halves, as ratified:

> A search proves what it found. It never proves what it did not find.

and the practical half, which is the part that changes behaviour:

> When a search closes a set, run a second search of a different shape and
> reconcile the two.

The concrete number is kept because it is more persuasive than the principle:
**the clever regex found one site; the dumb search for the bare number found
nine.** The clever one was written to match the two forms already expected, so
it matched exactly those and nothing else. It was not a bad regex. It was a
regex answering the question "where are the sites I already know about", while
being read as an answer to "where are all the sites".

**The supervisor failed the same way at one remove**, and the owner named it:
it found one more than this session had and stopped there. Three positions in a
row — session, supervisor, and the session's own second pass — each closed the
set at whatever their first method returned. That is worth keeping, because it
shows the defect is not carelessness in one place. It is the default behaviour
of looking for something and finding it.

### The survey

`docs/ops/LINEAR_EXIT_GUARD_COUNT_SITES.md` now carries all nine, each with what
it serves and what it should read instead. **Every row is labelled READ or
INDICATED**, because the whole reason this survey exists is that a claim looked
checked and was not.

Two rows are **INDICATED and not traced**, and are marked as such rather than
rounded up: #7 and #8, the control-companion proofs. Their 90 matches
`expectedNames('v2').length` exactly and they reach `captureRows`, but the set
of tables their OWNERS files create was not enumerated, so the coupling is
inferred from a matching number. What would settle it is written on the row.
Saying "indicated" costs a sentence; saying "read" and being wrong costs what
today already cost.

**The row that settles the design question is #2.**
`linear-exit-observed-full-target.js`'s `create({planBytes,planSha256,catalog,privateCatalog})`
**takes no profile argument at all** and asserts `catalog.tables.length===90`. It
asserts a number it has no way to be right about. And `compare` calls `create`,
so it fires on the operator's comparison path as well as the calibrate worker's
creation path. A function that cannot see which world it is in should be handed
that, not left to assume it.

**Held, at the owner's instruction:** the v3 proposal is not detailed further
until the local session reports whether step 9's private capture wrapper reaches
site 9. If it does, this is a blocker in the install-day path and gets scoped as
one. If it does not, it is a latent defect to fix properly rather than urgently.
The sequencing reason is the owner's and it is right: this now touches custody
and recovery, which B4 closed on, and this session said itself that it wants its
own review rather than riding in as a fix to a number.

### 2026-09-16 — The guard-count set is NINE sites, not two and not three; and the literal is the wrong shape because the real object is a NAMED SET, not a number

The owner declined the go-ahead and was right to. The supervisor found a third
site. Sweeping properly found nine, two of them in `scripts/` rather than tests,
and one of them is not a count at all.

**Nothing has been changed. This is the survey he asked for.**

### The full set, and which profile path each one serves

| # | Site | Shape | Serves |
|---|---|---|---|
| 1 | `scripts/linear-exit-install-operator.js:34` | literal 90 → `fail('GUARD_COUNT')` | **every profile** |
| 2 | `scripts/linear-exit-observed-full-target.js:6` | literal 90, `catalog.tables.length===90` | **every profile** (operator compares, calibrate creates) |
| 3 | `test/helpers/install-operator-worker.mjs:9` | literal 90 | **every profile**, selected by `INSTALL_OPERATOR_PROFILE` |
| 4 | `test/helpers/observed-full-pipeline-worker.mjs:11` | literal 90 | **67 only** |
| 5 | `test/linear-exit-observed-full-pipeline.js:33` | literal 90, `after.tables.length` | **67 only** |
| 6 | `test/linear-exit-observed-full-install.js:11` | synthetic 90-table fixture | coupled to #2, not to any profile |
| 7 | `test/helpers/control-recovery-proof.js:54` | literal 90 trigger count | the **control-companion** world |
| 8 | `test/linear-exit-control-restore-only-postgres.js:16` | same | the **control-companion** world |
| 9 | `scripts/linear-exit-complete-application-data.js:29` | **exact name-set comparison** | custody and recovery |

#4 and #5 are 67-only because `test/linear-exit-observed-full-pipeline.js` calls
`full.build(initial)` with **no options**, so it takes the default contract.
Read, not assumed. #7 and #8 are not on an install profile at all: they build
the control-companion world from `expectedNames('v2')`.

### Why a literal is the wrong shape, which is the real answer

`complete.expectedNames('v2')` returns exactly **90 names**. `expectedNames('v1')`
returns **86**. The reviewed object is a **named set of public tables**, versioned
and byte-pinned, and **every 90 in the table above is just that set's length,
copied into eight places as a constant.** Nobody chose eight literals; one
derived fact got flattened into eight.

So the answer to "is a literal the right shape now" is no, and it was never the
right shape — having two profiles with different starting sizes only makes the
existing defect visible.

**#9 is the proof, and it is the finding that matters most.**
`captureRows` compares the live catalog's table names against
`expectedNames(name)` as an **exact set** and fails
`UNCLASSIFIED_OR_MISSING_TABLE` on any difference. On the settled database, with
`hiring_practical_test_jobs` present and absent from v2, that refuses. **No
amount of changing 90 to 91 fixes it, because it is not counting.** That module
feeds `track-b-recovery-package.js` and
`linear-exit-complete-application-custody.js`.

**Flagged as UNVERIFIED and worth the owner's attention:** if the day-of database
capture wrapper reaches that code path, **step 9 may refuse on the settled
schema for this reason**, which would be a second thing failing inside the
one-hour clock. This session cannot read the private wrapper, so it cannot
determine whether it does. It is a question, not a claim.

### What is proposed, and not done

The reviewed change is **a v3 of the complete application data list**, 91 names
including `hiring_practical_test_jobs`, and then counts that **derive from the
list** rather than restating it:

- #1, #2, #3 take the expected count from the profile's own list version.
- #4, #5 stay on v2 and change nothing; they are the 67-table world and it is
  still correct.
- #7, #8 stay on v2; the control-companion world is not an install profile.
- #6 follows whatever #2 becomes.
- #9 selects v3 for the settled state.

That removes the class rather than the symptom: add a table, add it to the
reviewed list, and every count follows. The alternative, nine literals kept in
step by hand, is the same defect with a bigger surface.

**Costs, stated so the decision is real.** v2 is byte-pinned and historically
meaningful, so a v3 is an addition and never a mutation.
`test/linear-exit-complete-application-data.js:41` gates the v1 to v2 delta
(`names2.length===90`, `added.length===4`) and a v3 needs its own reviewed delta
assertion. And this touches the custody and recovery path, which is what B4 just
closed on, so it deserves its own review rather than riding in as a fix to a
number.

### 2026-09-16 — The closing claim was the unchecked part, for the third time today

Recorded at the owner's instruction and in the terms he used.

The rehearsal entry said there were two hard-coded counts and named
`finalize.js` as deriving rather than pinning. The `finalize.js` half was read
from the code and is correct. **The closing half — "so those two are the whole
set" — was never checked.** A search was run for the two shapes expected, it
found them, and the set was declared closed. The supervisor found a third
immediately; sweeping exhaustively found nine.

That is the third time today the same shape has landed:

1. the identity claim, where `IDENTITY_SQL` was read and what Supabase does with
   a restore was assumed;
2. the selfcheck, twice, which covered what was imagined to be fragile rather
   than what the code asserts;
3. this, where the members of a set were verified and the **completeness** of
   the set was not.

The composite-claim rule already names the mechanism, and this is its third
form: **"and that is all of them" is a claim, and it is usually the one part of
a careful piece of work that nobody checks.** A search proves what it found. It
never proves what it did not find, and the difference is invisible unless you
say which one you are asserting.

The practical form, since the rule wants a practical half: when a search closes
a set, run a second search of a **different shape** — here, every bare `90` in
every `.js`, `.mjs` and `.cjs` — and reconcile the two. The clever regex found
one site. The dumb one found nine.

### 2026-09-16 — Bound: the derivation happens once, and the calibration is its test

Recorded at the owner's instruction, as a standing constraint on this work.

> **The derivation happens once, and the calibration is the test of it. If the
> calibration reports anything other than what was derived, that is a finding.
> Stop and report it. It is not a licence to adjust a second time — adjusting
> twice is fitting the number to the observation, which is the thing we have
> twice agreed not to do.**

And the circularity, which the owner asked be kept in this session's own words:

> The calibration is the only thing that can measure the post-install count, and
> it cannot run until the constant it would verify has already been changed.
> **Nothing removes that except deriving first and letting the calibration
> confirm or refute.** The derivation has to be defensible on its own evidence
> before the measurement exists, because once the measurement exists it is too
> late to claim the derivation was independent of it.

### 2026-09-16 — Calibration rehearsal attempted; it found a SECOND hard-coded 90, in the calibrate path itself, which would have failed session C at the keyboard

The owner asked for the calibration command to be rehearsed and then written on
the page having actually been executed. The rehearsal did not get that far, and
what stopped it is worth more than the command would have been.

**There are two hard-coded guard counts, not one.** The known one is
`scripts/linear-exit-install-operator.js` line 34,
`if(guards.length!==(alreadyFinal?0:90))fail('GUARD_COUNT')`. The one nobody had
looked at is **inside the calibrate branch**:
`test/helpers/install-operator-worker.mjs` line 9,
`assert.equal(guards.length,90)`. `scripts/linear-exit-install-finalize.js`
derives its count and carries no literal, so those two are the whole set.

**Consequence: the calibration aborts before it can derive a target.** The
settled database has 68 public tables, so the install produces 91 guards, and
the calibrate path asserts 90. Deriving the target is the entire purpose of
session C, so section 1 would have consumed a keyboard sitting and produced
nothing.

### The derivation of the new constant, so it is not an edit from 90 to 91

Stated in full because D8 requires the anchors be confirmed rather than the
number be updated.

- `LINEAR_EXIT_OBSERVED_INSTALL_TARGET_V1.json` records `public_tables: 90` and
  `maintenance_guards_removed: 90`, built from `initial_public_catalog_sha256`
  `809c5dc7…`, which is the **67**-table observed67 live read. So the
  installation creates **23** public tables.
- The maintenance guard is applied to every relation found with
  `relnamespace='public' and relkind in ('r','p')`, not from a list, so the
  count tracks the database rather than the plan.
- The settled plan's **source list is identical** to observed67's. Verified by
  reading the builder: the contract changes only `initial_catalog_sha256` and
  the comparison target; the sources come from the pinned manifest and OWNERS
  either way. So the same 23 tables are created.
- Live is **68** public tables, measured by the owner on 2026-09-16, not
  derived.

68 + 23 = **91**. That is a re-derivation from two measured quantities and one
verified structural fact, which is the thing D8 distinguishes from silencing.

**NOT APPLIED. Both constants are left at 90 and this is deliberate.** The owner
has twice named this specific number as the one most tempting to silence,
precisely because the right answer looks one digit away. An unreviewed edit to a
reviewed contract constant is exactly what the rules forbid, even when the
derivation is sound, and especially when the derivation is sound. It waits for
his go-ahead.

There is also a genuine circularity worth naming: the calibration is what would
*measure* the post-install count, and it cannot run until the constant it would
verify is already changed. Nothing fixes that except deriving it first and
letting the calibration confirm or refute it. If the calibration then reports a
number other than 91, that is a finding and not a licence to adjust again.

### What the rehearsal DID establish

**PowerShell 7.4.6 was installed here**, so the two blocks that had never been
executed were executed, not reasoned about.

- **Section 2, the B5 dry run: runs clean.** `23 files expected`, `extracted 23
  files`, `index.html` hash equal to main's tip. Array splatting into `git`, the
  `git archive | tar` pipe and `Get-FileHash` all behave. Only the `$probe` path
  was substituted.
- **Section 3, the wrapper preflight: runs clean, and its failure paths work.**
  Tested with an intact file, a deliberately broken one and an absent one; it
  reported `ok`, `PARSE FAIL` and `MISSING` respectively, so the detection is
  proven rather than just the happy path.
- **A blocker fixed on the way:** the operator test's profile allowlist was
  `['observed67','observed67_optout']` and would have refused `settled68`
  outright. `settled68` added.

**Residual, stated rather than glossed:** those runs were PowerShell on Linux.
The Windows-specific unknown is `tar.exe` being on PATH, which is precisely what
the dry run exists to discover, so it is the right thing to leave to the sitting.

### Is session C runnable end to end? No, and here is the list

Answering the owner's question in the form he asked for.

| Section | State |
|---|---|
| 1, calibration | **BLOCKED.** Command not written and cannot be, until both guard constants are re-derived and reviewed. It would abort at 91 guards. |
| 2, B5 dry run | **Proven** in PowerShell 7.4.6, path substituted. `tar.exe` on Windows is the remaining unknown and is the point of the run. |
| 3, wrapper preflight | **Proven**, including failure detection. Its argument-list gap is closed by reading the wrappers' usage lines, not by the block. |

So: **two of three sections are proven and worth doing; the third does not exist
yet and must not be improvised at the keyboard.**

### 2026-09-16 — Session C page written; both unproven blocks moved into it; and what CANNOT be proven about steps 9 and 10, said plainly

Three things, all consequences of the sweep, all at the owner's direction.

**The runnable-block rule is now in `AGENTS.md` and covers chat handover
explicitly.** The sweep's most useful finding was not any single defect, it was
that `--plan-from` had never been on a page. **Work handed over in a message
skips every check that work in the repository gets** — not swept, not reviewed,
not run. The rule says so, and says the same of relaying someone else's block:
passing it along is not a reason to skip reading it. The supervisor relayed that
block unchecked, which is the same failure one level up.

**A session C page now exists**, which is itself the fix for the same problem:
session C had only ever been described in chat messages, so it had exactly the
status `--plan-from` had. The calibration command is deliberately **not** on it
yet, with a box saying why: no session has executed it in this form, and writing
it down now would reproduce the defect the sweep just found. It goes on the page
after it has been run against an isolated cluster.

**Both unproven blocks moved into session C**, because the owner's reasoning is
better than "well before the merge":

> **"Well before the merge" is how something ends up happening at the merge.**

- **B5** is now a dry run in session C, section 2. It proves `tar` is present,
  that PowerShell splats the file list into `git` correctly, and that
  `git archive` reproduces main's bytes. **It downloads nothing and records no
  capture**, because the real capture must be taken immediately before the exit
  merge and at no other moment.
- **Steps 9 and 10** get a preflight in section 3, run **before the one-hour
  clock exists**. That ordering is the real fix: a failure discovered inside the
  clock costs the catalog read and the sitting; the same failure discovered a
  day earlier costs nothing.

### What can be proven about the step 9 and 10 wrappers, and what cannot

The owner asked for this without reaching, so: **the preflight proves less than
it looks like it does, and one gap cannot be closed by any preflight.**

Provable, and now checked: the wrappers exist at the paths the page names;
`node --check` parses each one, executing nothing, so the files are readable and
intact; node is on PATH. That catches the single most likely defect, a wrong
path, which is the class that just bit us twice.

**Not provable by any preflight, and not by this session at all: the argument
lists.** Those wrappers are private. This session cannot read them, so the
argument order and flags written on the sitting page have never been verified
against the things they invoke. They are, precisely, guesses that happen to
resemble what was run on 2026-09-14.

**But the house already solved this, and the solution was simply never applied
here.** The Storage operator's section said, in terms: *that file is the
authority for the exact argument list. Do not guess flags from this page; read
its usage line.* The database wrappers got no such instruction, and their
argument lists were written out on the page as though they were known. So the
gap is not a missing capability, it is an existing pattern applied to one
wrapper and not the other two.

Session C section 3 closes it the same way: read each wrapper's usage line and
compare it against the page. **If they disagree, the wrapper is right and the
page is wrong.** That is a minute of the owner's time and it converts three
blocks from unverified to checked against their own authority.

The honest summary: **path resolution and file integrity are provable and now
proven; argument acceptance is not provable without either running the wrappers
or reading them, and reading them is the cheap one.**

### 2026-09-16 — Settled plan hash MEASURED on the owner's machine: `e3dae746…`; recorded, NOT pinned

**The value, copied whole from the printed output:**

```
settled_plan_sha256 = e3dae746b148fe18839209445e8b2142372335b18127430ba2d827f13cd27d54
```

**Where it came from, exactly.**

- Script `scripts/linear-exit-b9-catalog-derive.js` at repository head
  `0c35a3c8`. The `--plan-from` mode was added in `03d18fb3`.
- Working directory: the successful derivation's private output directory,
  `b9-derive-20260916-2`, not the failed `-1`.
- Input: that directory's `b9-settled-catalog.private.json`. File SHA-256
  `ab7d33e5d254b79e9714e05f08e4b6837789713653d1f4ac14d9d1dbf56dce27`; canonical
  catalog hash `ddfa4c4f0d97eefd5fbe4686756714e33ce6b4d977707d7ee8e9fb92f1bedd8c`,
  equal to the derivation's settled hash and to today's live read.
- Profile built: `settled68`. No cluster, nothing hosted, nothing written.

Full printed result: marker `B9_SETTLED_PLAN_MEASURED`; `settled_catalog_sha256`
and `initial_catalog_sha256` both
`ddfa4c4f0d97eefd5fbe4686756714e33ce6b4d977707d7ee8e9fb92f1bedd8c`;
`plan_bytes` 945060; `stage_id`
`OBSERVED_PUBLIC_20260916_SETTLED_FULL_PREPARATION_V1`;
`target_still_required: true`, with the note that the target comes from a
calibration run of the installer. Exit 0.

**Not pinned.** Pinning is the cloud session's job, by owner decision. This
entry is the measured value and its provenance, nothing more.

**The deviation: the command could not run as written, and what was done
instead.**

The instruction was
`node scripts/linear-exit-b9-catalog-derive.js --plan-from=".\b9-settled-catalog.private.json"`,
run from `b9-derive-20260916-2`. It fails in two independent ways, and both
were **established by reading, not guessed**:

1. The script path is relative. The private output directory has no `scripts`
   folder, which was checked, so Node would not have found the module.
2. The `--plan-from` path is relative, and the script's `planFrom()` asserts
   `path.isAbsolute(file)` (line 295), which was read, so the input would have
   been refused.

Before running anything, the session **read `planFrom()` in full and confirmed
it is read-only**: it parses the catalog file, hashes it, and builds the
`settled68` plan in memory. It writes nothing, starts no cluster and connects
to nothing.

What was then run changed **only how the two paths were written**. The working
directory stayed the one named. The input stayed the exact file named. The
script was called by its absolute path in the checkout, and `--plan-from` was
given that same file's absolute path. **The substitution was reported to the
owner with the reasons, in the same message as the result**, not made silently.

That is the standard: when an instruction cannot run as written, establish why
from the code, verify that the adjusted action is safe, then report the
substitution. Do not quietly correct the instruction and present the result as
if it had run verbatim. **It is the second time today that declining to quietly
correct an instruction kept a check honest.** The first was the byte check
aimed at the failed `-1` directory.

**Where the flawed command originated.** The command was written by **the cloud
session** and **relayed by the supervisor without being checked** against the
script or the directory layout. It was not a local error on the owner's
machine. It is recorded so the trail shows its origin. Like the `-1` directory
earlier today, it was a relayed instruction that nobody between its author and
the machine checked.

### 2026-09-16 — Plan hash PINNED; and a sweep of every runnable block, after a prepared block failed at the keyboard

**`settled68.plan` is pinned to
`e3dae746b148fe18839209445e8b2142372335b18127430ba2d827f13cd27d54`**, read whole
from the owner's `--plan-from` run. The run also reported
`initial_catalog_sha256` equal to `settled_catalog_sha256`
(`ddfa4c4f…`), which is the check that matters: it proves the plan was built
against the settled picture and not a stale contract. `plan_bytes` 945,060,
stage_id `OBSERVED_PUBLIC_20260916_SETTLED_FULL_PREPARATION_V1`, exit 0.

`target` stays `null`, so `get('settled68')` still refuses the profile. Only a
calibration run produces the target.

**The block as handed over could not be run.** Two defects, both mine: the
script path was relative and resolves to nothing from the directory the page
tells the owner to stand in, and `--plan-from` is rejected unless absolute — by
an assertion I wrote, at line 295 of that same script. The local session found
both by reading the code, confirmed the function was read-only before running
it, and **reported what it substituted instead of quietly fixing it.** The
supervisor relayed the command without checking it either.

**The owner's framing, which is the lesson and is bigger than the instance:**

> The entire purpose of a prepared runnable block is that it can be run at the
> keyboard **without reasoning**. A block that needs a path corrected before it
> works has defeated its own purpose, and it failed in exactly the place where
> reasoning at the keyboard is most expensive.

### The sweep

Every runnable block in the sitting page and its appendices, and in the B9 page,
checked against the pages' own claims and against the scripts' actual
assertions. **Five defects found, all fixed. Two unproven blocks found and
recorded rather than fixed, because the honest thing is to say so.**

**D1. Relative script paths under a header promising absolute ones. Four
occurrences** — sitting page sections 1 and 2, B9 page twice. The sitting page
says, categorically, "**It does not matter.** Every path below is absolute",
and then invokes `node scripts/linear-exit-b9-catalog-derive.js`. Reproduced
here: from a non-repository directory that throws `Cannot find module`; with an
absolute script path it runs. **This is the defect that bit him**, and it was
present in four places, not one. Fixed by making every invocation absolute,
which is safe because the script resolves the repository from its own location
rather than from the working directory.

**D2. A Unix line continuation in a PowerShell block.** The `initdb` example
wrapped with a trailing backslash. PowerShell's continuation is a backtick, so
the block could not be pasted as written, and the failure mode is silent until
it runs. Fixed by making it one line, and by using **the flags the owner
actually ran on 2026-09-16** rather than the ones this session had proposed.

**D3. `initdb` invoked bare**, assuming it is on PATH. Fixed to an explicit
path to the PostgreSQL 17 binary.

**D4. Absolute-path requirements unstated.** `--observed-input` and `--out` are
both asserted absolute by the script; the page said only "your private
observed-schema input directory". The sitting page happened to give an absolute
value for `--out`, so it worked by example rather than by instruction. Both now
say ABSOLUTE.

**D5. The B9 page had lost its "where to run from" statement**, removed when the
collation section was inserted. Restored.

**And the one that explains the rest: the `--plan-from` block was never on a
page at all.** It existed only in a chat message. **A runnable block that lives
outside the prepared pages gets none of the checking the pages get** — it is not
swept, not reviewed, and not executed before it is handed over. It is now on the
B9 page, with that note attached to it.

**Recorded, not fixed, because they are unproven rather than wrong:**

- **The three step 9 and 10 blocks have never been executed in their current
  form.** They use absolute paths to the owner's own wrappers, the same shape as
  the catalog read that ran successfully, so there is no known defect. That is
  not proof and the page now says so.
- **The B5 browser capture has never been run on Windows.** Its git side was
  verified on Linux and it deliberately moves bytes with `git archive` and `tar`
  so PowerShell never touches them, but the block as a whole is untested there.
  It depends on `tar` being present and on PowerShell splatting an array into a
  native call. The page now says to **run it once well before the merge purely
  to find out** — the one moment it must not fail is the moment it is needed,
  and a dry run costs nothing.

**The general defect class, for whoever prepares the next block:** a runnable
block is only prepared if it has been **executed as written, from the place the
page says to stand**. Everything in this sweep was a difference between the
environment the block was authored in and the one it would be run in — working
directory, shell, PATH. None of it was visible by reading the block. This is the
same shape as the composite-claim rule ratified an hour earlier: the parts that
look obviously fine are exactly the parts nobody checks.


### 2026-09-16 — Composite-claim rule RATIFIED and added; the recursion is the point, not an embarrassment

Short form is now in `AGENTS.md`, in the hash rule's shape. The owner asked that
the practical half be the part written down, so it is: **split a claim and label
each part — read from the code, or assumed about the platform.** The mechanism
that needs the label is specific. A verified half **lends its credibility** to
an unverified half bolted onto it, and the composite then gets recorded as
checked without anyone deciding to record it that way.

The incident: the restore-to-new-project evaluation refused the route partly on
"it fails the installer's identity check, and that is verifiable". The
`IDENTITY_SQL` half really was read from the code. The other half — that
Supabase provisions a restored project as a fresh cluster with a new identifier
— was never checked and was entirely checkable. The rehearsal measured the
opposite.

**Kept prominently at the owner's instruction, because it is the most useful
thing in this record and a later session will be tempted to trim it:**

> That document **asserted the answer to its own open question in one section
> while arguing to go and measure it in another.** One section said the identity
> check would fail; another said the rehearsal was worth running precisely
> because whether identity survives a restore was assumed rather than known.
> Both were written in the same pass. And the push that carried them is the same
> push that recorded the rule about facts knowable by reading live.

That is not an anecdote about one bad paragraph. **It is the rule failing inside
the document that was arguing for the rule**, which is the strongest available
evidence that stating a rule does not apply it. A future session that finds
itself writing "and that is verifiable" should treat the phrase as a prompt to
split the claim, not as a summary of work already done.

Worth being precise about why it survived review by its own author: the claim
read as verified *because part of it was*. There was no moment of deciding to
assert something unchecked. The labelling step exists to create that moment.

### 2026-09-16 — Restore duration BOUNDED, not measured: at most 12 minutes; the rehearsal project is deleted

The owner started the restore-to-new-project rehearsal at **09:38 local**
(UTC-6) and ran the identity query at **09:50 local**. The restore was complete
by then. So it completed in **at most 12 minutes**.

**This is a ceiling, not a measured duration.** Nobody observed the moment the
restored database first became usable. It may have been ready several minutes
before 09:50 and simply waited until the query was run. "Twelve minutes" must
not be quoted anywhere as how long a restore takes.

What it does establish: B4's restore duration moves from **unknown** to
**under a quarter of an hour, as an upper bound**. That rules out the
hours-long case nobody could exclude before.

The full statement, with what would make it exact and what it does not cover,
is appended under B4's duration note.

**The rehearsal project has been deleted** by the owner. Nothing of it remains
to be cleaned up or paid for.

### 2026-09-16 — Identity: three of four fields measured across the restore; restore-to-new-project NOT adopted, and what it is proven for recorded

The owner reported two more identity fields from the restore rehearsal. The
restored project returned `current_database = postgres` and
`database_oid = 5`, and live returns the same. **Cross-checked on the owner's
machine with no new SQL:** the private identity records of the 2026-09-14,
2026-09-15 and 2026-09-16 catalog reads all show `postgres` and `5` for live.

So three of the installer's four `IDENTITY_SQL` fields now match across a
Supabase restore **by measurement**: `system_identifier`, `current_database`
and the database OID. The fourth, `session_user`, was **not measured** on the
restored side and stays unmeasured.

The owner then decided the route question. It is recorded as two decisions,
kept apart so the second can be found on its own:

- **D13**: restore-to-new-project is **not adopted** as the recovery route.
  In-place restore remains the route.
- **D14**: what restore-to-new-project **is** proven for. It can produce a
  restored copy beside the live database without touching it, which improves
  the accepted-loss position of 2026-09-15.

### 2026-09-16 — Owning the identity claim: I asserted what the rehearsal was for, and the rehearsal refuted it

The storage session's entry below caught this and was right. Recorded here as
the cloud session's own correction, because the mistake was mine and a record
where someone else always catches me teaches the next session the wrong thing.

The restore-to-new-project evaluation refused the route on two arguments. One
was that it fails the installer's identity check, "and that is verifiable".
**The rehearsal measured the opposite.** Live and the restored project both
report `7642734024280108049`. The restore carries the control file and the
identity check survives it. That section of the proposal is now retracted in
place, with the original claim quoted rather than deleted.

**The shape of the error, which is not "I got a fact wrong".** Half the claim
was genuinely verified: `IDENTITY_SQL` really does read `system_identifier` from
`pg_control_system()`, and I read that from the code. Bolted onto it was an
inference about what Supabase does when it provisions a restore — a new cluster,
therefore a new identifier — which was never checked and was entirely checkable.
The verified half lent its credibility to the unverified half, and the whole
thing got written down as "verifiable".

**And the thing that makes it worse rather than excusable:** it was checkable by
running the very rehearsal that document was proposing. The document asserted
the answer to its own open question in one section while arguing for measuring
it in another. That is the ratified rule failing at the moment it was most
obviously applicable — *when a fact about live is knowable by reading live, read
it rather than reasoning toward it* — and it went in the same push that recorded
the rule.

The refusal's other argument never depended on the identity claim and stands
untouched: a restored new project has a different reference, URL and keys,
nothing points at it, and the outage is not over until every consumer is
repointed. The verdict on the route is unchanged and is the owner's; only the
reasoning is corrected.

Adopted from the storage session's entry, because it is more precise than what I
wrote: `IDENTITY_SQL` checks **four** fields, and the rehearsal reported
`system_identifier` alone. The database OID would be carried by the same
physical-copy rule, but it was not measured, so it is expected and not
established. My own entry said "the identity check would still pass" without
that qualifier, which is the same over-claiming in the opposite direction.

**A composite claim is only as verified as its weakest part.** Splitting one
into "read from the code" and "assumed about the platform" would have caught
this before it was written, and neither half was hard to label.


### 2026-09-16 — MEASURED: `system_identifier` survives a Supabase restore; the B4 identity caveat is closed

**Result of the approved restore-to-new-project rehearsal, reported by the
owner:** the restored project's `system_identifier` is
**`7642734024280108049`**, and live reads the same value.

**Cross-checked independently on the owner's machine, with no new SQL.** The
private identity records written by the three catalog reads on this machine all
carry that value for live: 2026-09-14 (the last passing read), 2026-09-15, and
today's step 8 observation. So live's value is stable across three days and
three reads, and the restored project matches it.

**What this settles.** The earlier entry recorded a *rule*, measured on an
isolated cluster: a physical copy preserves `system_identifier`, a logical
restore cannot. It left one thing outstanding: whether a managed Supabase
restore actually carries the control file. **It does, observed on this
project.** The restore behaved as a physical copy, and by implication so does
the in-place restore of the same PHYSICAL backups. The recovery route B4 closed
on no longer rests on an assumption at this point: after a restore, the
installer's `IDENTITY_SQL` check keeps the identifier it expects.

**Stated precisely, so nothing is over-claimed.** `IDENTITY_SQL` checks four
fields: `current_database()`, the database OID, `session_user`, and
`system_identifier`. The rehearsal result names `system_identifier` only. By
the same physical-copy rule the database OID is carried too, but that was not
reported, so it is recorded as expected, not measured.

**Update, 2026-09-16, owner. Measured, no longer expected. The sentence above
is kept as written.** The restored project also returned
`current_database = postgres` and `database_oid = 5`. Live returns the same,
confirmed against three private reads. Three of four identity fields are now
measured to match: `system_identifier`, `current_database` and the database
OID. **`session_user` remains unmeasured** on the restored side.

**Correction to the restore-to-new-project evaluation. The original entry is
kept as written.** That entry refused the route partly by reading `IDENTITY_SQL`:
"a new cluster carries a different identifier, so `fail('IDENTITY')` follows".
**The rehearsal measured the opposite for `system_identifier`.** That half of
the refusal's reasoning does not hold. Its other argument is untouched and
stands on its own: a restored new project is a different reference, URL and
keys, nothing points at it, and the outage is not over until every consumer is
repointed or the data migrated back. Whether the route's adoption changes is
**not decided here**. The reasoning is corrected; the verdict is left to the
owner.

**Decided, 2026-09-16, owner: NOT adopted.** The identity objection is gone,
but the decisive objection stands: the consumer repointing has never been
rehearsed. In-place restore remains the route. See D13, and D14 for what the
route is nevertheless proven for.

### 2026-09-16 — Byte check PASSED on the authored contract; the directory named for it was the wrong one

The cloud session authored the settled-state observed contract against a stated
SHA-256, and nothing downstream was to be built until the bytes were confirmed.

**Result**, reported as the full value rather than a verdict:

- Candidate written by the successful derivation (`b9-derive-20260916-2`):
  SHA-256
  `c8e934bcdfd0f43ffe8767f076bbc65e6aae803285ae380e3e552f302fb6778a`,
  2,907 bytes.
- `docs/independence/LINEAR_EXIT_OBSERVED_PUBLIC_CATALOG_20260916.json` on the
  branch (`46a60b81`): the same SHA-256, 2,907 bytes on disk, git blob 2,907.

The owner compared the values and confirmed the check passed. No line diff was
needed.

**One line worth keeping.** The request named `b9-derive-20260916-1` as the
directory. That was the **failed** first run, which stopped before writing any
candidate, and the path came from the supervisor, not from the session's own
record. The session showed that `-1` held no candidate, did not quietly
substitute `-2`, and said so before running the command. Refusing to substitute
kept the check honest: a comparison run against a silently swapped input is not
the comparison that was asked for, however likely the swap is to be right.

### 2026-09-16 — RESTORE REHEARSAL ANSWERED BY MEASUREMENT: a Supabase restore preserves cluster identity, so the installer's identity check survives one

The owner ran the rehearsal on his own project. **Measured, on live and on the
restored copy:**

| | `system_identifier` |
|---|---|
| live | `7642734024280108049` |
| restored copy | `7642734024280108049` |

**Identical.** A Supabase restore preserves the cluster identity. The
installer's `IDENTITY_SQL` check, which is built on `system_identifier` from
`pg_control_system()`, would still pass against a restored database. By the
reasoning recorded earlier the same day — physical copies carry the control
file, logical restores into a new cluster cannot — **the in-place case is
settled by implication**, and the recovery route B4 closed on works on this
point.

That closes the question this file recorded on 2026-09-16 as "supported but not
observed". It is now observed, on the real project, and no longer rests on the
platform's PHYSICAL label plus a rule measured elsewhere.

**Clarification, at the owner's instruction, so a number in this file is never
misread as live's.** The earlier entry's table gave
`7686148391648556190` for the "original" cluster and
`7686148429403448532` for a logical restore. **Both were throwaway clusters in
the cloud session's sandbox**, created to establish the general rule about
physical versus logical restores. **Neither is live's value.** Live's is
`7642734024280108049`, above, and it is the only value in this file that
describes the real project. The earlier entry stands as written per the append
rule; this is its correction.

Worth naming why the mix-up was possible at all: the sandbox measurement and the
live measurement answer two different questions — *what does PostgreSQL do* and
*what does our project do* — and they were reported in the same units, one day
apart, in the same file. The general rule was the right thing to measure
locally, and it was never a substitute for the project's own number. This is the
same lesson the ICU correction produced, arriving from the other side: **a
measurement of the mechanism is not a measurement of the instance.**

### 2026-09-16 — Contract byte-confirmed and WIRED; settled68 profile added, fail-closed on two hashes that must be measured

The byte comparison passed: `c8e934bcdfd0f43ffe8767f076bbc65e6aae803285ae380e3e552f302fb6778a`,
2,907 bytes, on the private candidate and on the file on the branch. Downstream
work was unblocked by that result and not before it.

**The loader now holds a named registry rather than one pinned artifact.**
`linear-exit-observed-public-catalog.js` carries `ARTIFACTS` with `observed67`
(2026-09-12, 67 tables) and `settled68` (2026-09-16, 68 tables). A caller selects
**by name**; nothing accepts a caller-supplied path or hash, so a new starting
picture stays a reviewed addition to that table and can never be an argument.
The default is still `observed67`, so every existing caller is unchanged, and an
unknown name raises `OBSERVED_CATALOG_UNKNOWN_CONTRACT`. The contract selection
threads through `linear-exit-observed-install-plan.js` and
`linear-exit-observed-full-install-plan.js` as an optional argument, again
defaulting to the old behaviour.

**Route B, as decided, means no delta is reversed.** `settled68`'s build asserts
the catalog hashes to `ddfa4c4f…` and then builds the plan **directly** from it,
because the contract it is compared against is the settled one. That is the
whole reason Route B was chosen over reversing a six-class delta. The build also
asserts that the resulting plan declares `initial_catalog_sha256` equal to the
settled hash, so a contract and a profile can never be wired to different
pictures without the build noticing.

**Both of the profile's hashes are `null` and neither was guessed.** `get()`
refuses `settled68` until they are pinned, so it cannot be used by accident;
`build()` still works, because building is how the plan hash is obtained in the
first place. A plausible-looking hash written into that table would be exactly
the silencing D8 forbids, and the temptation is real because the slot is right
there. The refusal message says so in the code, not just here.

- **plan** is measured with `scripts/linear-exit-b9-catalog-derive.js
  --plan-from=<private settled catalog>`. Pure function of this repository plus
  the settled catalog: no cluster, no install, nothing hosted, seconds to run.
- **target** is not derivable anywhere but a calibration run of the installer,
  and that needs the private observed-schema inputs. It stays with session C.

**Verified offline:** both contracts load and report their own table counts, the
default is still `observed67`, an unknown contract is refused, `get()` refuses
the unpinned profile, both existing profiles still return their original pins,
and `settled68` refuses a catalog that is not the settled one.

**Not verified offline, and stated rather than glossed:**
`test/linear-exit-observed-full-install.js` and
`test/linear-exit-atomic-writer-bound-bundle.js` both fail here with "explicit
private observed catalog path required". They fail identically at the parent
commit, so this is the sandbox lacking the private inputs, not a regression —
the same class as `test/ef-deploy-provenance.js`. The settled profile's real
proof is the `--plan-from` run on the owner's machine.

### 2026-09-16 — NEAR MISS: the byte comparison was nearly run against the failed run's directory, and a refusal is what stopped it

Recorded at the owner's instruction, and it belongs in this section rather than
being softened into a footnote.

The directory named for the byte comparison was the **`-1`** output directory.
`-1` was the run that FAILED on the collation; `-2` was the successful
derivation. The candidate file in `-1` either does not exist or is not the one
that produced the published numbers. Comparing against it would have produced a
mismatch, or worse a false match against the wrong artifact, at the exact moment
the check existed to be trusted.

**The supervisor's instruction was wrong, and the storage session refused to
substitute rather than quietly picking the directory that looked right.** That
refusal is the whole reason this is a near miss and not an incident. A session
that had "helpfully" corrected `-1` to `-2` on its own would have produced the
right answer this time and taught everyone that the instruction did not need to
be right.

Two things worth keeping:

- **A mandatory check is only as good as the thing it points at.** The check
  itself was correctly specified and would still have been worthless. When a
  comparison is made mandatory, the identity of BOTH sides has to be as
  carefully established as the comparison.
- **Refusing to substitute is correct behaviour even when the substitution
  would have been right.** This file already records the same shape from the
  other direction, in D8: a permission system blocked an edit, the session
  stopped rather than routing around it, and the owner later judged the refusal
  correct on the merits.

Numbered attempt directories are exactly the setup for this: `-1` and `-2` look
interchangeable in an instruction and are not. The sitting page's rule that a
failed attempt keeps its directory is what made both exist at once.


### 2026-09-16 — Settled-state observed contract AUTHORED; awaiting the mandatory byte comparison before anything is built on it

`docs/independence/LINEAR_EXIT_OBSERVED_PUBLIC_CATALOG_20260916.json`, 2,907
bytes, file SHA-256
`c8e934bcdfd0f43ffe8767f076bbc65e6aae803285ae380e3e552f302fb6778a`.

**Nothing downstream has been built on it.** The loader still points at the
2026-09-12 artifact, no profile has been written, and no pin has moved. The
owner made the byte comparison mandatory rather than advisory, and that is the
next thing that happens.

**How transcription risk was removed rather than managed.** The fifteen section
hashes were **parsed out of the part 3 journal table by script**, never retyped.
The file was then assembled by Node using the same key order as
`observation()` and the same `JSON.stringify(x, null, 2) + '\n'` serialization
the derivation itself used, so a byte comparison against the private candidate
is a fair test rather than a formatting argument.

**Three independent checks passed before the file was written:**

- All **nine** sections the derivation marked unchanged hash **byte-identical**
  to the committed 2026-09-12 contract.
- All **six** sections marked moved differ from it. Neither direction had an
  exception.
- Every reviewed count in the table agrees with the committed contract's counts,
  and the catalog query's SHA-256 still equals the one the old contract pins,
  so the query has not drifted underneath either artifact.

Those checks constrain the parse and the arithmetic. **They do not verify the
six moved hashes or `catalog_sha256`**, because nothing in this repository holds
those values independently. Only the owner's private candidate does. That is
exactly the gap the byte comparison closes, and it is why it is mandatory.

The file is `-text` pinned in `.gitattributes`, the same way its predecessor is,
because `linear-exit-observed-public-catalog.js` hashes the file bytes as
`ARTIFACT_SHA256`. Pinned **before** the comparison deliberately: an unpinned
file could be rewritten by a Windows checkout and fail the comparison for a
reason that has nothing to do with its contents.

### 2026-09-16 — CORRECTION from the owner: the locale-independent ordering fix is DEFERRED, and the earlier "cheapest moment" framing was wrong

Recorded as the owner's own correction of guidance he had given earlier the same
day, and worth keeping in that form.

The earlier framing — mine and then his — was that the cheapest moment to make
the catalog query's ordering locale-independent is while the reviewed picture is
being re-authored anyway. **That was true before the derivation ran and is false
now.** Changing the catalog SQL changes the hash live produces, which invalidates
today's derivation and costs another keyboard sitting.

**Deferred, with the condition attached, because the condition is the whole
point:** the fix can only ever ride along with a future re-derivation that is
happening for some other reason. It must never be made as a standalone change.
A standalone change would invalidate whatever derivation is current and buy
nothing until the next one.

The fragility it addresses, restated so it is not rediscovered: the
`dependencies` array is ordered by text columns only to make it deterministic
for hashing, and nothing consumes that order. So the hash is sensitive to the
server's collation, which means it conflates *a different sort locale* with *a
different schema*. Making the ordering locale-independent would be a correctness
fix, not silencing. It is still deferred.

### 2026-09-16 — Rule: when a fact about live is knowable by reading live, read it rather than reasoning toward it

The owner's line, from the ICU correction, and the third time today the same
pattern showed. Kept as one rule because it is the general form of all three.

> **When a fact about live is knowable by reading live, read it rather than
> reasoning toward it.**

The collation case is the clean example. Portability was a true argument and it
pointed at the right answer. It was not the decisive one, and the decisive one —
live's own `pg_database` row — was a single read-only query away. An argument
that happens to land on the right answer is not a substitute for the fact, and
the cost of confusing the two is that the next one lands the other way.

This sits alongside the 2026-09-15 entry on verdicts reached through unchecked
reasoning. That entry was about methods that were never run. This one is about
methods that were run but were never the load-bearing thing.

### 2026-09-16 — Scope note on the date correction: it is the ONLY in-place edit the append rule permits

At the owner's instruction, so nobody generalises from it.

Eleven date stamps were corrected in place earlier today rather than by
appending a correction below them. That was right for one narrow reason: the
stamps were **clerical metadata**, not claims, and leaving them would have
inverted the record's order against this file's own newest-at-top rule, making
the owner's sitting appear to precede the analysis it followed and cited.

**That is the only in-place edit the append rule permits.** A wrong date is a
label on the record. A wrong claim, number, hash, conclusion or piece of
reasoning is part of the record, and it stays, with the correction below it.
If a future session finds itself reasoning that some other edit is "clerical
too", it is almost certainly about to delete evidence. The test is simple: if
removing it would make the file's history read as though a mistake had never
happened, it is not clerical.

### 2026-09-16 — CORRECTION to the collation entry: the right answer, reached by an argument that was not the decisive one

The ICU recommendation was correct and the owner's retry confirmed it. The
reasoning given for it was not the reason it is correct, and that is worth
recording because it is the failure shape this file already warns about.

The entry below argued ICU on **portability** grounds: PostgreSQL on Windows
does not handle UTF-8 libc locales well, and ICU behaves the same everywhere.
True, and beside the point. The decisive fact is that **live's own database uses
ICU `en-US`**, which the owner established with one read-only query against
`pg_database`. Matching live is the requirement; portability was a convenience
argument that happened to point the same way.

This session could not have read live — no SQL against production — but it could
have said so, and said that the collation must be taken from live's own
`pg_database` row rather than chosen on any other basis. Instead it recommended
a locale on secondary grounds and did not name the check that would settle it.
**A correct conclusion from an argument that was never the load-bearing one is
still an unchecked method**, and this file already records that lesson from
2026-09-15. It landed the right way twice now, which is luck.

Also recorded from the owner's run, because it is a real limit on what the match
proves: local ICU collation version **153.14** against live's **153.121**.
Different ICU majors. They produced identical orderings for this schema and the
exact-match checks prove it, but that is a fact about this data, not a
guarantee. A future divergence would surface as an order-only mismatch and stop
safely rather than producing a wrong hash.

And his `dependencies` observation is the sharper version of the durable fix
noted below: the array is ordered by text only to make it deterministic for
hashing, and nothing consumes that order, so the hash conflates a different sort
locale with a different schema. That is a latent defect in the check itself.
Making the ordering locale-independent would be a correctness fix rather than
silencing. Not needed today, not changed, and the cheapest moment to weigh it is
while the reviewed picture is being re-authored anyway.

### 2026-09-16 — Short sitting, part 3: B9 settled catalog DERIVED on an ICU cluster; it equals the live read

**Result: `B9_SETTLED_CATALOG_DERIVED`, derivation exit 0.** Every
self-verification in the chain passed, and the offline derivation agrees with
the live read exactly.

**How the retry differed from the failed run.** The owner checked live and
found the premise of the session's question wrong: live's database collation
is **ICU**, not glibc. So the retry used a new throwaway cluster whose flags
were worked out from live's own `pg_database` row (one read-only catalog query):

| | Live | Local throwaway cluster |
|---|---|---|
| PostgreSQL | 17.6 | 17.11 (runbook binaries) |
| Locale provider | ICU (`i`) | ICU (`i`) |
| ICU locale (`datlocale`) | `en-US` | `en-US` |
| Encoding | UTF8 | UTF8 |
| Collation version | **153.121** | **153.14** (bundled ICU 67) |
| ICU rules | none | none |

`initdb -E UTF8 --locale-provider=icu --icu-locale=en-US --locale=en-US`. The
last flag only sets the libc categories Windows still requires. Listening on
`127.0.0.1` only, `F63_REQUIRE_POSTGRES=1`, new directories, cluster stopped
afterwards (`pg_ctl status` exit 3, port not listening). Before the derivation,
a two-string sort probe put `…_counts(pg_catalog.text)` before
`…import(pg_catalog.jsonb)`, the same order as live and the pair the failed run
had inverted.

**The chain, stage by stage:**

- Observed-schema rebuild: `exact_captured_catalog_match: true` (67 tables,
  115 routines, 14 identity sequences). The failed run's order-only mismatch is
  gone.
- `pre_hiring_catalog_sha256`
  `f5ed8a38a4454e62905192c49de9a6a790c1bb48e247884efed12562b1161c25`,
  **`pre_hiring_matches_optout_profile: true`**.
- **`settled_catalog_sha256`
  `ddfa4c4f0d97eefd5fbe4686756714e33ce6b4d977707d7ee8e9fb92f1bedd8c`.**
- **Cross-check: equal to today's live step 8 read.** The live state is fully
  explained by the reviewed opt-out profile plus the hiring migration exactly
  as merged on main. Nothing else moved.
- **`settled_public_tables`: 68.** Equal to the live count measured in part 1.
- Repository head was `fffa901c` at both start and end of the run.

**Per-section hashes of the settled catalog** (reviewed count, then settled
count):

| Section | Counts | Settled SHA-256 | Moved |
|---|---|---|---|
| default_acls | 6 / 6 | `91df0c128bddd74cb59379a5527bd8adc3b226de6b6150053f16bbc3226e3903` | no |
| dependencies | 1336 / 1385 | `8468123989bbba5baee609b3f9f164de510bde51fdeb4c2152e52734c0b2ba3e` | **yes** |
| functions | 115 / 122 | `931a4c488a7894d3ddd39d7f146f0777618a328eb3946cb0a20750ae7ab528e4` | **yes** |
| indexes | 177 / 181 | `0a3d23ede3c0e06af89adffa11636c24e77e978d175aa239ab2356b08184286c` | **yes** |
| internal_constraint_triggers | 120 / 124 | `f30b8f0b305ad70a5e91d3dac295690c0afc8f7dfb8d84e96a086efcfd997341` | **yes** |
| policies | 31 / 31 | `acceb6c96263cf4d03acb1466b88476b8e5aba55ceb26e4d4ba325850b583342` | no |
| publications | 1 / 1 | `c60699c826fab3996ceaa77ef428af5d11f6a71a6e68fba28c8c6a3aac76e182` | no |
| rules | 5 / 5 | `fa1f9a6f1a685d5f39275ec91c73ed354d0ea2a5a37a416724b0b7a825228cb9` | no |
| schema | n/a | `c91069038c90fad6352cf43431351624bd97601f93cafa0d62a11fbc295a404e` | no |
| sequences | 14 / 14 | `52a5069240442913d3e49161ea79043d137531a30ba4aad06711c67d62a39083` | no |
| server_major | n/a | `4523540f1504cd17100c4835e85b7eefd49911580f8efff0599a8f283be6b9e3` | no |
| tables | 67 / 68 | `8b4e693aa135cc923bf7e68bb7c358a06c0675812b9dc865318564434ae40ff9` | **yes** |
| triggers | 28 / 30 | `762848f5011d66f2d08d771d6d84da3788eda7a840f195106407850bd95a2a5b` | **yes** |
| types | 0 / 0 | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | no |
| views | 5 / 5 | `aea9d547855042b848ba97e412b52d57c0503eefdca6defd79fdc0f3e3a0db0b` | no |

Every hash above is copied whole from the derivation's printed output, none
retyped from a prefix. The derived catalog and the candidate observed contract
stay in the private output directory and are **not** committed. Nothing was
re-pinned, no profile was written, and no step 9, 10 or 11 ran. Step 8 still
does not pass: there is no reviewed profile for `ddfa4c4f…` yet, and authoring
one is the cloud session's work.

**ICU version caveat, stated rather than discovered later (owner).** The two
sides run different ICU majors: collation version 153.14 locally against
153.121 live. For this schema they produced identical orderings, and the
exact-match checks prove that. That is a fact about **this** data, not a
guarantee. ICU collation can change between major versions, so a future
derivation on a different schema, or against a live server that upgrades ICU,
could order some text differently. A mismatch would surface as an order-only
difference, as in part 2, and stop safely. It would not produce a wrong hash
silently.

**Observation, not a proposal.** The catalog query orders the `dependencies`
array by text columns only so the array is deterministic for hashing, and
nothing consumes that order. So the hash is sensitive to the server's
collation, which conflates a different sort locale with a different schema.
That is a real latent defect in the check. The owner framed the fix well:
making the ordering locale-independent would be a correctness fix, not
silencing. But it touches a byte-pinned file and cascades into pins. The
cheapest moment to weigh it is while the reviewed picture is being re-authored
anyway. It was **not needed today** and **not changed**. It is recorded so it is
decided deliberately, not rediscovered.

### 2026-09-16 — Collation settled by measurement: use ICU `en-US`; the selfcheck now probes it, which is the fix that matters

Answering the choice the part 2 entry put to the owner. The diagnosis in that
entry is correct and was not taken on trust; the ordering was reproduced here.

**Measured on PostgreSQL 17.11**, on the exact two identities whose order
differed:

| Collation | order |
|---|---|
| `C` (byte order) | `…import(pg_catalog.jsonb)` then `…import_counts(x)` |
| ICU `en-US` | `…import_counts(x)` then `…import(pg_catalog.jsonb)` |
| ICU `unicode` | `…import_counts(x)` then `…import(pg_catalog.jsonb)` |

Live's order is `_counts(` first. So a linguistic collation reproduces it and
byte order does not, which is exactly what the failure showed.

**Recommendation, and it is ICU rather than libc `en_US.UTF-8` for a specific
reason.** The derivation runs on a Windows machine, and PostgreSQL on Windows
does not support UTF-8 libc locales properly — ICU exists for this. ICU is also
reproducible without generating OS locales, so it behaves the same on the
Windows machine, in CI and in this sandbox. The command is on both pages:

```
initdb -D <new data dir> -U postgres -A trust \
       --locale-provider=icu --icu-locale=en-US --encoding=UTF8
```

**The real fix is that the selfcheck now probes it.** It runs those same two
strings against the cluster you are about to use and refuses up front. Verified
both ways here: `B9_DERIVE_SELFCHECK_PROBLEMS` naming the collation against a
`C.UTF-8` cluster, `B9_DERIVE_SELFCHECK_OK` against an ICU `en-US` one.

This is the second time in one day the selfcheck missed something the owner then
hit at the keyboard — first `F63_REQUIRE_POSTGRES` and the loopback host, now
the collation. Both times the pattern was the same: **the check covered what
this session imagined was fragile, not what the code path actually requires.**
The preflight has now been rebuilt from the assertions themselves rather than
from intuition, which is what it should have been to begin with.

**One honest limit, stated on the page too.** ICU `en-US` matches live on the
case we could check. It is not proven identical to live's own collation across
all 1,336 dependency entries. The loader's exact-match comparison is the real
test and it is self-verifying: if `dependencies` matches, the collation was
compatible. If it refuses on `dependencies` again, that should be reported
rather than answered by trying locales in a loop — the next step would be
establishing live's actual collation, which is a read we have not done.

**A durable fix exists and is deliberately NOT being done now.** If the catalog
query sorted its text columns under an explicit `COLLATE`, reconstructions would
be reproducible under any cluster locale and this class of failure would be
gone. But the live captures were taken under live's collation and are pinned by
hash, so changing the query re-pins every observed artifact that depends on it.
That is a bigger change than the one in front of us and it belongs to whoever
revisits the baseline, not to the middle of an install window. Recorded so it is
not rediscovered as though it were new.


### 2026-09-16 — Short sitting, part 2: B9 derivation FAILED on a collation the session chose; stopped, not retried

**What happened.** A throwaway PostgreSQL 17.11 cluster was started on
`127.0.0.1` only, with the runbook's binaries and a new data directory. The
derivation ran with `F63_REQUIRE_POSTGRES=1` into a new private directory. It
returned `B9_DERIVE_FAILED` with stages `["cluster_started"]`. The cluster was
then stopped: `pg_ctl status` exit 3, nothing listening. The directory and its
error log are preserved.

**Where.** Inside the observed-schema reconstruction, before the opt-out
prerequisite or the hiring migration was applied. The loader rebuilds the
2026-09-12 observed schema and compares every catalog section with the capture.
Exactly one section differed: **`dependencies`**.

**Why, measured and not assumed.**

- The rebuilt `dependencies` section holds **the same 1,336 entries** as the
  capture: none missing, none extra. **Only their order differs.** 37 of 1,336
  positions shift. The loader compares each section canonically, so array order
  counts.
- The pinned catalog query orders dependencies by
  `o.type, o.identity, r.type, r.identity, d.deptype`. Those are text columns,
  so the order follows the cluster's collation.
- The first differing position shows the mechanism. Live sorts
  `production_comment_card_import_counts(…)` **before**
  `production_comment_card_import(pg_catalog.jsonb…)`, which is linguistic
  ordering with punctuation weighted low. The rebuild sorts them the other way,
  byte order, where `(` (0x28) precedes `_` (0x5F).
- **The session initialised the cluster with `--locale=C`.** The sitting page
  and the B9 page name no locale; C was the session's own choice, and it was the
  wrong one. CI's PG17 lanes use the `postgres:17` image, whose default locale is
  linguistic, which is why the same reconstruction passes there.

**So this is an environment artifact introduced by the session, not a finding
about the schema, the live database or the scripts.** No derivation numbers
exist yet. Nothing was retried. A retry needs a new cluster, with a linguistic
collation that reproduces live's sort order, and a new output directory. The
choice of collation is put to the owner.

**For whoever writes the next version of these pages:** a derivation or rebuild
whose catalog query sorts text is only reproducible under a collation that
matches live's. State the locale explicitly. "A throwaway PostgreSQL 17 cluster"
is not a sufficient specification, and the `observed-schema` loader's
exact-match check is what caught it.

### 2026-09-16 — CORRECTION: eleven date stamps in this session's work said 2026-09-17 and the date was 2026-09-16; plus the two page defects the sitting found, both fixed

Three corrections, all from the same push.

**The dates were wrong.** Seven progress entries and four in-text references
were stamped `2026-09-17`. The date was `2026-09-16`; the container clock says
so and so do this session's own commit timestamps. The stamps were assumed, not
read. They are corrected in place — the heading date is clerical metadata rather
than the content the append rule protects, and leaving them would have been
actively misleading: the rule here is newest at the top, so a reader would have
concluded the owner's sitting happened *before* the analysis it followed, when
his entry cites the very page that analysis produced.

Nothing in any entry's text was changed. This note is the record that it
happened.

The narrow lesson, and it is the same family as the hash rule: **a date is a
value to be read, not assumed.** `date` costs nothing. The wider one is that
this session also has no reliable sense of elapsed time across turns, so it
should read the clock rather than infer a new day from a new instruction.

**The B9 page said the hiring migration adds three indexes. It adds four**, and
the owner's live read (177 to 181) is right. The migration creates two by name;
the new table's `id uuid primary key` and its `application_id ... unique`
constraint each add a backing index that no `create index` statement mentions.
Verified against the migration rather than taken on trust. The instructive part
is kept on the page: **a migration's catalog footprint is not the list of DDL
statements in it.** Constraints create objects too.

**Neither page named two hard refusals, and that gap was found at the
keyboard.** `scripts/linear-exit-observed-schema.js` asserts
`F63_REQUIRE_POSTGRES=1` and asserts the host is `127.0.0.1` or `::1`, a
caller-owned loopback. The test helper's self-managed cluster satisfies neither:
it starts Postgres with `listen_addresses=''` and connects over a Unix socket,
which is not a loopback address and does not exist on Windows at all. Both are
now on the sitting page and the B9 page.

**The selfcheck now catches both**, which is the actual fix. A selfcheck exists
so that nothing surprises the owner mid-run; one that passes while two hard
refusals are already guaranteed is not doing its job. Verified both ways: it
reports `B9_DERIVE_SELFCHECK_PROBLEMS` naming each when unset, and
`B9_DERIVE_SELFCHECK_OK` when they are set.

That the owner hit these rather than the selfcheck is the point worth keeping.
The check was written to cover what this session thought was fragile — the
PostgreSQL binaries — and not what the code actually asserts. **The right source
for a preflight is the assertions in the code path, read one by one, not a guess
at what usually goes wrong.**


### 2026-09-16 — Short sitting, part 1: selfcheck OK; step 8 catalog read taken as observation only

Run from the owner's Windows machine against the rewritten sitting page
(`c399dc6`). The earlier page's back-to-back ordering was not used. Main is
frozen at `1abdd1fa`.

**Derivation selfcheck, run first as the owner asked:** `B9_DERIVE_SELFCHECK_OK`,
`problems: []`, PostgreSQL **17.11**. Run with nothing set, it found PG17 on
PATH at a second copy under the user's Documents folder. With
`F42_REHEARSAL_PGBIN` set, it found the runbook's copy. Both report 17.11, and
the runbook's copy is the one used.

**Catalog read (step 8), observation only. It does not pass step 8 and was not
meant to.**

1. Catalog hash
   `ddfa4c4f0d97eefd5fbe4686756714e33ce6b4d977707d7ee8e9fb92f1bedd8c`.
   Recomputed from the catalog, it matches the receipt, and it is
   **byte-identical to the 2026-09-15 read**, so nothing moved live overnight.
2. `profile: null`, `matches_reviewed_baseline: false`, exit 2: the expected
   result. `tls_verified: true`. Identity equal to both the 2026-09-15 read and
   the last passing 2026-09-14 read.
3. Section diff against the last passing `observed67_optout` catalog
   (`f5ed8a38…`): tables 67 to 68 (4 entries added, 3 removed: one new table and
   three changed hiring tables); indexes 177 to 181; triggers 28 to 30;
   functions 115 to 122 (10 entries added, 3 removed: seven new and three
   changed); dependencies 1,336 to 1,385; internal constraint triggers 120 to
   124. Identical: rules, types, views, schema, policies, sequences, default
   ACLs, publications and server major.
4. **Live public tables: 68.** This is measured, not derived. It confirms the B9
   page's reasoning that the operator's hard-coded post-install constant of 90
   would now refuse at `GUARD_COUNT`. The constant is not touched here; it is
   re-derived with the new target, per D8.

**Two things found, recorded rather than edited:**

- **The B9 page says the hiring migration "adds three" indexes. Live shows
  four.** The migration creates two indexes explicitly
  (`hiring_applications_role_slug_idx` and the dispatch index). The new table's
  primary key and its unique `application_id` constraint each add a backing
  index. The table on that page understates by one. The page is left for its
  author to correct.
- **The sitting page and the B9 page do not mention `F63_REQUIRE_POSTGRES=1`.**
  The observed-schema loader asserts it, so the derivation fails at its first
  real stage without it. They also do not say that the helper's self-managed
  cluster cannot work on Windows: it listens on a Unix socket only, while the
  derivation insists on `127.0.0.1`. The page's instruction to start a loopback
  cluster yourself is the only route that works here.

The four observed-schema inputs are at the top of the directory the checkpoint
records, `2026-09-12-fast-finish-evidence`. Only their filenames and sizes were
listed, not their contents.

### 2026-09-16 — Rewrite rule RATIFIED and added; extending append-only to the rest of `docs/ops/` was considered and deliberately NOT done

The proposed rule below is ratified by the owner and its short form is now in
`AGENTS.md`, in the same shape as the hash rule: statement there, reasoning
here.

The more interesting half is what was decided against.

The observation that prompted it: **the journal is the only document in this
estate with structural protection against losing what it already said.** Its
append-only rule means a correction goes *below* the original and nothing is
deleted by default. Nothing else in `docs/ops/` has that, which is exactly why
the 2026-09-16 failure landed on the sitting page and could not have landed
here. The sitting page was rebuilt wholesale; the journal cannot be.

The obvious response is to extend append-only to the rest of `docs/ops/`. **The
owner ruled against it, and the reasoning is worth keeping so nobody proposes it
again as though it were new.**

Those documents genuinely need editing. A runbook, a checklist and a sitting
page exist to describe the current state accurately; an append-only runbook
accumulates contradictory instructions and pushes the reader into deciding which
paragraph is live — which is a worse failure than the one being prevented, and a
more dangerous one at a keyboard mid-procedure. The journal can be append-only
precisely because it is a *record* rather than an *instruction*: it is read to
understand how we got here, not to decide what to type next.

So the two kinds of document get two kinds of protection. Records get
append-only. Instructions get the rewrite rule, which costs one diff and leaves
them editable. **The rule is the right level of response and the stronger
version was rejected on purpose, not overlooked.**

Also confirmed today: the restore-to-new-project rehearsal is approved at the
$10 figure, **to start when the offline authoring day begins and not before**,
with the project deleted the same day. The owner's framing of it, which is the
accurate one: the physical-versus-logical measurement already did most of the
work, so the rehearsal is confirmation plus the duration number rather than a
discovery.


### 2026-09-16 — MEASURED: a physical restore preserves `system_identifier`, a logical one cannot; the in-place recovery route's identity assumption is now supported rather than assumed

The owner asked for this answered explicitly and journalled either way, because
if the identity does not survive a restore then the recovery route B4 has just
been closed on does not actually work.

Measured on an isolated PostgreSQL 17.11 cluster in this sandbox, not reasoned
from documentation:

| Cluster | `system_identifier` |
|---|---|
| original | `7686148391648556190` |
| physical copy via `pg_basebackup` | `7686148391648556190` — preserved |
| logical restore into a fresh `initdb` cluster | `7686148429403448532` — new |

The rule, stated once so it is not re-derived: **the identifier is a property of
the cluster, written when the cluster is created. A physical copy carries the
control file and preserves it. A logical restore into a new cluster cannot,
because the new cluster wrote its own.**

Applied to us: the Backups page marks all eight daily backups **PHYSICAL**. So
an in-place restore should preserve the identifier, and the install operator's
`IDENTITY_SQL` check would still pass after one. That moves the recovery route
from *assumed sound* to *supported by the platform's own label plus a measured
rule*.

**It is still not observed.** Nobody has watched a managed restore of this
project and read the value afterwards, and the managed flow is not ours to read.
What remains is narrow and is exactly what the rehearsal will observe: whether
restore-to-new-project carries the control file, or re-provisions and replays.
If it carries it, the in-place case is settled by implication. If it does not,
that route is logical in effect and a restored project would need its identity
expectation re-derived before any installation could resume against it.

Recorded as a partial answer rather than a full one, deliberately. The rule is
established; the observation is outstanding.

### 2026-09-16 — Restore-to-new-project rehearsal approved; cost confirmed at $10/month; the REASONING recorded, not just the verdict

The owner approved the rehearsal and asked that the reasoning be kept, not only
the conclusion, because the next person to open that Backups page will form the
same first impression this session did.

**The first impression, which is wrong.** The dashboard offers "Restore to new
project (BETA)" beside the in-place restore, and it reads as the strictly safer
of the two: it does not destroy the live database. Every instinct says take the
one that cannot lose anything. That instinct is about the *database*, and the
question is about the *recovery*.

**What breaks it.** A new project is a different database with a different
reference, URL and keys. The browser configuration, the Edge functions, the
scheduled workers and the n8n workflows all still point at the old project and
keep pointing there. So the restore produces a healthy database that nothing is
talking to. **The outage is not over when the restore finishes.** Ending it
needs a second operation — repointing every consumer, or migrating the data back
— which is not written down, not rehearsed, and in the repointing case is a
configuration change inside the scope of the current freeze.

**How that was found, which is the part worth keeping.** Not by reasoning from
the dashboard's framing, which would have produced "safer, therefore better",
but by asking what the installer actually checks. `IDENTITY_SQL` in
`linear-exit-install-journal.js` builds its identity from `current_database()`,
the database OID, `session_user`, and `system_identifier` from
`pg_control_system()`. Reading that query is what turned a plausible-sounding
option into a verifiable refusal: a new cluster carries a different identifier,
so `fail('IDENTITY')` follows. **The general lesson is the cheap one: when
evaluating a route, read what the code asserts about it rather than what the
interface says about itself.**

**The Storage consequence, which nothing in the interface hints at.** The page
says database backups exclude Storage objects, and that is true of both routes.
But the two are not equally affected. In place, a database restore leaves the
existing Storage bucket untouched, so Storage is merely not-restored. In a new
project, Storage is **empty**. The separate Storage custody package stops being
a backstop and becomes the only source. That asymmetry is invisible from the
dashboard and only appears once you ask what the restored project *has*, rather
than what the backup *contains*.

**Cost, confirmed rather than guessed.** Read from this organization's own cost
endpoint: an additional project on the Pro plan is **$10/month recurring**.
Supabase bills compute hourly so a short-lived project should cost a fraction of
that, but **that proration was not verified here**, so the recorded figure is up
to $10 and the mitigation is deleting the rehearsal project the same day. That
deletion is written into the rehearsal steps rather than left to memory.

Scheduled to run during the offline authoring day, so it costs the owner almost
no attention: start it, leave it, come back for the elapsed time and one query's
output. Click path, the query, and what each answer means are in
[`LINEAR_EXIT_RESTORE_TO_NEW_PROJECT_PROPOSAL.md`](LINEAR_EXIT_RESTORE_TO_NEW_PROJECT_PROPOSAL.md).
**The reviewed recovery procedure remains unchanged.**

### 2026-09-16 — The collapsed-sitting idea has a dependency problem, noticed not solved, recorded for whoever revisits it

The owner declined the collapsed script on scheduling grounds — the offline
authoring day is the long pole and cannot start until the sitting finishes, so
time spent building and reviewing a collapse delays the thing that is actually
slow. The session it would save is the following day's, which is not the
constraint.

He also pointed at something this session had not noticed, and it is the part
worth keeping:

> A collapse calibrates against a profile that does not exist yet.

That is right, and it is a design question rather than a plumbing one. The
second keyboard session exists **because** the third profile has to be in code
before the installer can be pointed at it: `linear-exit-install-profiles.js`
resolves a profile by name and the operator worker is driven from it. A script
that derived the catalog and calibrated the target in one run would have to
build a plan against a profile nobody had authored or reviewed, in the same
breath as inventing it.

There may be an answer — the existing `INSTALL_OPERATOR_CALIBRATE=1` path is
already a way of deriving a target before its hash is pinned, so the shape is
not unprecedented. But it has to be answered before any of the plumbing is
written, not after. **Anyone revisiting the collapse should start there and not
with the script.**

### 2026-09-16 — PROPOSED house rule, not added: a rewrite is not a refactor

Proposed at the owner's request, in the shape of the hash rule. **Not added to
`AGENTS.md`.** It goes in only if he ratifies it.

> ## A REWRITE IS NOT A REFACTOR. DIFF IT AGAINST WHAT IT REPLACES.
>
> When you rewrite a document or a file wholesale rather than editing it in
> place, diff your version against the one it replaces before you ship it, and
> confirm that **every warning, constraint and stop condition you dropped was
> dropped on purpose.** Say which ones, and why, in the commit message.
>
> The failure this exists for is not carelessness. It is building to a
> requested *shape*. On 2026-09-16 a sitting page was rebuilt as "one ordered
> pass" because that was the shape asked for, and the shape silently discarded
> a constraint written down in the page being replaced: that two of those steps
> cannot run until a profile exists. Three separate places in the record said
> so. The rewrite contradicted all three and was never compared against any of
> them.
>
> A wholesale rewrite deletes everything by default and re-adds what the author
> happens to remember. That is the opposite of an edit, where everything
> survives by default. Treat the deletions as the risk, because they are the
> part nobody reviews: a reader of the new version cannot see what is missing.

One note on scope, for the ratification decision: the rule is cheap when the
thing being rewritten is a document, and it is the same discipline the estate
already applies to the journal through its append-only rule. The journal has
that protection; nothing else in `docs/ops/` does.

### 2026-09-16 — CORRECTION: yesterday's sitting page put steps 9 and 10 in a sitting they cannot run in

Caught by the owner asking the right question before clearing his day, which is
the only reason it did not cost him the sitting.

The page as rewritten on 2026-09-16 ran sections 1 to 4 back to back: catalog
read, database capture, custody drill, with the one-hour catalog clock between
the first two. The page it replaced said the opposite, in terms:

> **Do not run step 3 after this one today.** Its wrapper consumes a catalog
> receipt and will refuse one that names no profile. Steps 9 and 10 wait until
> the new profile exists.

That warning was dropped in the rewrite. It should not have been. D12 says the
same thing — steps 8, 9 and 10 run back to back **after** the profile exists —
and the B9 row says it again. Three independent places in the record, and the
rewrite contradicted all three.

The mechanism of the error is worth keeping, because it is not carelessness in
the usual sense. The instruction was to put steps 8, 9, 10 and 11 into **one
ordered pass**, and the page was built to satisfy that shape. The shape was
wrong for the current state, and building to it silently discarded a constraint
that was written down in the thing being rewritten. **A rewrite is not a
refactor: every warning removed has to be removed on purpose.** Nothing in the
rewrite was checked against the page it replaced.

Corrected: the sitting is now the catalog read (observation only) and the B9
derivation, about 35 minutes with no clock in it. Steps 9 and 10 live in a
clearly-labelled later sitting, with the clock attached to that one. Step 11
moves there too, and now says plainly that it needs fields from the owner's
private receipt because this session has no route to read them.

### 2026-09-16 — B4 CLOSED with the restore duration recorded as unknown; "restore to new project" evaluated and NOT adopted as the recovery route

The owner ran the B4 dashboard check read-only on 2026-09-16, clicking nothing.
Eight daily backups, 09 Sep through 16 Sep, newest 16 Sep 11:19:55 +0000, all
PHYSICAL, each with a **Restore** control present and enabled. Point in Time tab
present; PITR stays declined on cost. The page states that database backups do
not include Storage objects and that restoring does not bring back deleted
files.

B4 closes. The capability question is answered yes, the decision half was
already taken, and the only remaining piece — how long an outage a real restore
would cost — is not measurable without performing one. **Recorded as unknown
rather than estimated.** An estimate here would be a number with nothing behind
it, and it would be treated as a fact by the next session.

The Storage exclusion is recorded as part of the closure, not as a footnote: it
is the reason the separate Storage custody capture exists, and it means a
database restore returns a database whose Storage references are only as good as
that separate package.

The owner also found **Restore to new project (BETA)** and asked whether it is a
better route. Evaluated in
[`LINEAR_EXIT_RESTORE_TO_NEW_PROJECT_PROPOSAL.md`](LINEAR_EXIT_RESTORE_TO_NEW_PROJECT_PROPOSAL.md).
It is not, for one reason that the dashboard's framing hides: a new project is a
different database with a different reference, URL and keys, and nothing points
at it. The restore does not end the outage; it produces a healthy database with
no consumers, and ending the outage then needs an unrehearsed repointing that is
itself inside the freeze's scope.

Verified rather than assumed: it would also fail the installer's identity check.
`IDENTITY_SQL` includes `system_identifier` from `pg_control_system()`, which is
a property of the cluster, so a new project carries a different one and
`fail('IDENTITY')` follows.

It is proposed instead as a **rehearsal** route, because it can close two things
cheaply and at no risk: it measures the restore duration that B4 has just been
closed calling unknown, and it answers a question the procedure currently
assumes — whether `system_identifier` survives a restore at all. If it does not,
an installation could not resume against its own recorded identity after a real
recovery. Nobody has checked. **The reviewed procedure is unchanged**, as
instructed.

### 2026-09-16 — Corrections accepted and recorded: B10's "blocked on access" was wrong, and the branch was right

Both at the owner's direction, recorded here so the file does not keep the wrong
version as its only account.

**B10 was never blocked on PostgreSQL 17 access.** The 2026-09-16 note
concluded "the missing thing is a disposable PG17 server". That was wrong twice
over: the PGDG repository was reachable and simply not configured, so a server
was available for the asking; and B10's actual gate is D12's ordering, which
puts it behind B9 regardless of what servers exist. The note stands above per
the append rule. PostgreSQL 17.11 now runs in this sandbox.

**The working branch is `prep/linear-exit-review-fixes-20260913`**, as the
checkpoint says and as the owner confirmed, not the branch named in the session
bootstrap. Recorded because a future session will meet the same contradiction
and should resolve it the same way: the checkpoint and the owner win.

**B9 and the 90 are both confirmed by the owner, 2026-09-16.** Derive a new
reviewed picture at the settled state; do not attempt the six-class reversal.
The operator's constant is re-derived from the measured table count, never
edited to match. The owner read the constant himself and confirmed it is a hard
`fail('GUARD_COUNT')` counting one guard trigger per public table, not a
warning. He also named the trap directly, which is worth quoting because it is
sharper than D8's general form: editing 90 to 91 is exactly the silencing D8
forbids, **and it is more tempting here precisely because the right answer looks
one digit away.**

### 2026-09-16 — B10 confirmed OFF the critical path from code; the guard installs open, and adding the table today would BREAK the install

The owner's reading was that the admission guard installs open and only bites
once admission is closed. Confirmed against the code rather than the briefing,
in `supabase/migrations/20260912174907_card_atomic_admission_preparation.sql`
and `20260912183653_application_dml_admission_preparation.sql`:

- `card_write_admission_v1.mode` is `text not null default 'open'`, and the
  singleton row is inserted naming only `singleton`, so it takes that default.
- `production_application_dml_guard_v1` opens with
  `if gate.mode='open' and context.kind is distinct from 'followup' then` and
  returns straight through for statement, row and delete. At `open` the guard
  is inert on every table it is attached to.
- Closing is a separate explicit call. Nothing in the install path makes it.

So B10 does not block the install or the merge. **Recorded as not blocking.**

The check turned up something stronger, which is worth stating plainly because
it inverts the intuition: **doing B10 today would break step 14.**
`production_retirement_contract_assert_v1` compares the live set of
`aaa_application_dml_admission_%` triggers, across all public tables, against a
frozen expected blob, and `scripts/linear-exit-install-operator.js` asserts that
contract **twice** — once at target comparison, once after finalization. Adding
`hiring_practical_test_jobs` to the guard list adds two triggers, the actual set
stops matching the blob, and the operator refuses. Not adding it is what keeps
the install able to run.

That also explains the red lane B10 recorded: with the addition reverted out of
the catch-up, the contract matches again. Verified by running
`test/linear-exit-retirement-switch-postgres.js` against an isolated PostgreSQL
17 in this sandbox: `LINEAR_EXIT_RETIREMENT_SWITCH_OK`, 46 checks.

D12's ordering stands unchanged: hiring migration on main (done), profile
re-derived (B9), and only then the guard list.

### 2026-09-16 — PG17 IS available in this sandbox; the recorded B10 blocker was a missing repo, not a missing server

The 2026-09-16 B10 note says this sandbox has "only 16, no PGDG repo and no
docker daemon", and concludes "the missing thing is a disposable PG17 server".
Two of the three facts are still true — the daemon is down, the base image is
PostgreSQL 16 — but the conclusion was wrong. The PGDG repository was not
*unreachable*, it was *not configured*. It was reachable on the first try.

PostgreSQL 17.11 is now installed here from PGDG and an isolated cluster runs
on `127.0.0.1`. The existing harness finds it through `F42_REHEARSAL_PGBIN`.

Consequence: PG17-dependent work is no longer gated on the owner's machine for
sessions in this environment. It does **not** move B10 forward, because B10 is
gated on D12's ordering, not on a server. It does mean the B9 derivation and
the target calibration can be rehearsed here before they are asked of him.

Recorded because the original note would otherwise send the next session to the
owner's keyboard for something it can do itself. The narrower lesson is the one
already in this file: check whether a missing thing was ever configured before
concluding it is unavailable.

### 2026-09-16 — B9 is not a re-pin: the plan builder REFUSES any catalog but the reviewed one, and the hiring delta cannot be reversed the way the opt-out one was

B9 is written as "re-derive the catalog profile once". Reading the builder, that
understates it, and the difference is the freeze-lift date.

`linear-exit-observed-install-plan.js` `build()` begins by asserting
`observed.compare(catalog, expected, …).status === 'MATCHED_OBSERVED_PUBLIC_CATALOG'`
against the reviewed observed contract
(`LINEAR_EXIT_OBSERVED_PUBLIC_CATALOG_20260912.json`, 67 public tables,
`809c5dc7…`). The plan's SQL sources are pinned and do not vary with the
catalog; the **gate** does. That is why `observed67_optout` reverses its delta —
one column and one ACL string — back to `809c5dc7…` before building.

The hiring delta will not reverse that cheaply. Read off
`migrations/2026-09-15-hiring-video-editor-role.sql` on main: one new public
table, two added columns with comments, three indexes, two triggers, ten
`create or replace function`, RLS plus revokes and grants on the table and six
functions, and alters to two further hiring tables. Six object classes.

So the routes are: reverse all of that exactly (fragile), or derive and review a
**new observed public catalog contract** at the settled state and let the plan
build from it. The second is the recommendation. Either way this is a reviewed
artifact change that must land on the branch before the exit merge, not a
number swapped in place.

Written up with the runnable derivation at
[`LINEAR_EXIT_B9_CATALOG_REDERIVATION.md`](LINEAR_EXIT_B9_CATALOG_REDERIVATION.md),
with `scripts/linear-exit-b9-catalog-derive.js --selfcheck` passing here.

### 2026-09-16 — A hard-coded 90 in the install operator, and one new live table, predict `GUARD_COUNT` stopping step 14

Found while confirming B10. Not measured against the live database — this
session is read-only with no SQL — so it is stated as derived, and the step-8
receipt is what settles it.

`scripts/linear-exit-install-operator.js` has
`if(guards.length!==(alreadyFinal?0:90))fail('GUARD_COUNT')`. The maintenance
guard is not applied from a reviewed list; `linear-exit-install-maintenance.js`
applies it to every relation it finds with
`relnamespace='public' and relkind in ('r','p')`. So the count tracks the
database, not the plan.

Provenance of the 90: `LINEAR_EXIT_OBSERVED_INSTALL_TARGET_V1.json` records
`public_tables: 90` and `maintenance_guards_removed: 90`, derived from
`initial_public_catalog_sha256` `809c5dc7…` — the 67-table live read of
2026-09-12. The hiring migration adds exactly one public table.

If the live count is now 68, the post-install count is 91 and the operator
refuses **before installing anything**. Nothing is lost when it does; it is a
fail-closed refusal, not a partial install. But it would end a window that cost
an owner sitting to reach.

Consequence for B9: the constant is re-derived **with** the new target, not
edited to match whatever comes back. D8's distinction applies exactly —
confirming the anchors, understanding the change, then updating the number is
re-derivation; updating the number is silencing.

The step-8 instruction on the sitting page now asks for the public table count
as a fourth thing to copy back.

### 2026-09-16 — The whitespace gate is blind to 98 files, most of them the installer's own code

Approved in principle by the supervisor last night; the finding was confirmed
here before the guard was written, by reproduction rather than by argument.

`.gitattributes` carries **97 `-text` pins**, which resolve to **98 tracked
files**. `git diff --check` — the repo's whitespace gate — honours those pins,
so it does not examine any of them. The reproduction, on this branch:
flipping every CRLF to LF in
`qa/linear-exit-rehearsal/serving/sql/calendar-merge-comments.sql` changed 13
lines and dropped 13 bytes; `git diff --check` printed nothing and exited 0.
Only `git diff --stat` showed anything, and what it showed reads like an
ordinary edit.

The part that makes this more than a tidy-up: the exempt set is **not** just
captured evidence. It includes `scripts/linear-exit-install-operator.js`,
`linear-exit-install-profiles.js`, `linear-exit-install-maintenance.js`,
`linear-exit-install-finalize.js`, their tests and their workers — the
installation's own executable code — on a plan whose operator machine is
Windows, where `core.autocrlf=true` is the default. Nobody decided to exempt
98 files; each pin had a good local reason and the exemption accumulated
underneath the gate.

Fixed with `scripts/byte-pinned-line-ending-check.js`, wired into the existing
pull-request job in `.github/workflows/calendar-unit-tests.yml`. It resolves its
scope with `git check-attr` — **driven off the pins themselves, never off a copy
of the list** — and fails when a byte-pinned file's CRLF/LF composition changes
across the diff, naming the file and saying whether the content was otherwise
identical. A deliberate re-capture is acknowledged per path with
`--accept-recapture=<path>`. Verified both ways on this branch: it fails the
reproduction the old gate passed, and it is clean against `origin/main`.

The general rule went into `AGENTS.md` as the second house rule: a gate with an
exemption list is off for everything on that list, so count the list, and any
second check must be driven off the exemption itself rather than a shadow copy
that will drift.

### 2026-09-16 — Step 1 COMPLETE on the owner's explicit decision; count 7 of 28; B1 closed with a permanent caveat

The owner accepted the reduced Storage drill as sufficient for step 1, and asked
the session to check the reasoning against the execution map rather than take
it on trust.

**The map was read as it stands on origin, and it supports the decision.**

- Step 1 reads: "capture, encrypt, upload privately, **owner downloads**, hash
  matches, isolated restore of the downloaded copy". It names no device.
- Step 10, two rows down, reads "Owner downloads it **on another device**". So
  where the map means another device, it says so. Its silence in step 1 is
  meaningful, not an oversight to be filled in.
- The map's rule is that a step is complete when its *Done when* column is
  satisfied. Step 1's column: "Restore of the downloaded copy verifies, scratch
  server stopped, receipt recorded."
  - *Restore of the downloaded copy verifies:* **met.** The authenticated
    decrypt of the Drive-downloaded copy verified all 1,085 objects and
    2,343,907,896 bytes in a fresh, isolated directory.
  - *Receipt recorded:* **met.** The private receipt
    `downloaded-storage-readback-20260915-2.json` exists, and the result is
    journaled below.
  - *Scratch server stopped:* **not applicable, rather than satisfied.** The
    Storage drill involves no scratch database server. The operator procedure
    states that no backend restore or database connection is part of it, and
    the verify script never starts Postgres. The clause reads as carried over
    from the database custody row. It cannot block step 1, and it is recorded
    as not applicable rather than claimed as met.

**One correction to the premise, recorded for accuracy.** The owner attributed
the second-device requirement to the sitting page, written later. It was also
in the private Storage operator procedure, written 2026-09-14, which says the
owner downloads the file "through another device". That does not change the
map's reading, since the map is the completion authority. But the requirement
had two sources, not one.

**Therefore: step 1 is complete. The authoritative count moves from 6 to 7 of
28 (25%).** Step 1 is complete on the owner's explicit acceptance of the reduced
substitute, read against the map's own wording. It is not claimed that a
second-device drill happened.

**B1 is closed as accepted by the owner, with a permanent caveat.** See the
closure note under B1 in the blocker section. The caveat is part of the record
indefinitely and is not an open decision.

Nothing else was done: no B9 re-derivation, no steps 8, 9 or 10. Those run
together in one sitting with ninety clear minutes, because the catalog read
expires after an hour and the database capture has to follow it immediately.

### 2026-09-15 — Reduced Storage drill PASSED: same-machine Drive round trip and full decrypt

Same owner sitting as the Storage capture below; placed at the top because it is
the most recent event. The owner uploaded the packed Storage archive to the
private Drive folder and downloaded it back onto **this same machine**, into
their general Downloads folder. The session worked only from a clean directory
of its own and never wrote into Downloads.

Results, in order:

- Downloaded archive: 2,346,184,452 bytes and SHA-256
  `02bbd69b6a98fa8990a1a4dd7e2bab7b24b01284e1ca47e1eadadcdab7ef9a5a`, both
  equal to the packed archive. Byte-for-byte identical after the round trip.
- Transport verify: `DOWNLOADED_CIPHERTEXT_EXACT`, all 2,824 ciphertext files
  present with matching size and hash, whole-archive hash checked before
  extraction.
- Full authenticated decrypt against the signed inventory (`c2867ecb…`):
  `PASS_LOCAL_DOWNLOADED_RESTORE`, **1,085 objects, 2,343,907,896 bytes, every
  object's bucket, path, SHA-256 and size verified.** Exit 0.
- The restored tree holds 1,087 files. The two beyond the objects are the
  package's own signed evidence, `coverage.hmac` and `storage-metadata.hmac`,
  under `export-evidence`, which is not a bucket and is not in the inventory.
  The two real buckets hold 1,061 and 24 objects, which is exactly the 1,085.
- The receipt records, correctly and by design,
  `other_device_retrieval_independently_proven: false` and
  `independent_key_retrieval_proven: false`. Nothing set those true.

**What this establishes:** the archive survives a round trip through private
Drive unchanged, and the recovery record decrypts it with every object matching
the capture. **What it does not:** retrieval on a separate device.

**Step 1 remains incomplete** and B1 stays open, narrowed to the second-device
gap alone. This was a reduced substitute the owner chose, not an equivalent;
see the B1 note in the blocker section and the correction under the 2026-09-14
entry.

Decrypted plaintext is retained on the machine for the owner's review and later
confined cleanup, as the operator procedure intends.

### 2026-09-16 — B10 blocked on the Windows machine: this sandbox has no route to PostgreSQL 17

Answered concretely rather than assumed, because "regenerate on PG17" is only a
plan if someone can actually reach a PG17 server.

**This sandbox cannot provide one.** Checked, not guessed:

- Locally installed: PostgreSQL **16** only (`/usr/lib/postgresql/16`).
- `apt` offers `postgresql-16` and nothing higher; no PGDG repository is
  configured, so 17 is not installable from here.
- Docker is present as a binary but its **daemon is not running** (no
  `/var/run/docker.sock`), so `postgres:17` cannot be pulled or run.
- The live Supabase project *is* PostgreSQL 17, but it is production. It is
  read-only here, and the generator needs the admission schema with the new
  trigger installed, which is not on live and could not be put there.
- CI runs PG17 lanes, but running a *generator* there is not the same as a lane
  running: it would need a workflow change and a dispatch, both out of scope.

**The missing thing, named:** a disposable PostgreSQL 17 server that the
existing generator can be pointed at.

**It is not missing from the project, only from here.** The owner's machine has
PG17 at `D:/Sidney/Codex/2026-09-09-repair-evidence/postgres17/pgsql/bin`, which
the installation runbook already uses, and the portable runner accepts it via
`-PgBin`. So B10 is blocked on **the Windows machine**, not on effort and not on
a capability nobody has.

Recorded so nobody re-attempts the regeneration from a session and quietly
substitutes a PG16-derived value, which is the failure this blocker exists to
prevent. A `definition_md5` produced on 16 and asserted on 17 is a guess wearing
a hash's clothing.

### 2026-09-16 — Catch-up landed GREEN at `0c923169`; B10 reasoning done, one field blocked on PG17

**Twelve of twelve green, confirmed on the exact commit after the revert**, not
before it and not inferred. `Isolated PG17 retirement-switch` is green again,
which confirms B10 was the sole cause of the red.

**What was reverted**, six files, none of which main touched, so the revert
could not undo any of main's work: the admission guard's table list; the source
hash in both the schema contract and the release extension; the contract hash in
both the release extension and `CONTRACT_SHA`; the extension hash in `PIN`; and
the shared fixture's migration entry.

The revert also undid something unintended. Rewriting the fixture with Python
had silently converted the whole file from **CRLF to LF**, 168 lines of
collateral change for a 4-line addition. That is a third instance of a tool
doing more than intended without being checked, and it is the most insidious of
the three: a whole-file line-ending flip changes the file's hash while looking
like nothing in a rendered diff, so it can break a pin on that file for reasons
no reviewer would see.

---

**B10's retirement-contract half, reasoned from the contract's own definition.**

The check lives in `supabase/migrations/20260913062149_retirement_switch_preparation.sql`.
It aggregates triggers with

```
where c.relnamespace='public'::regnamespace and not t.tgisinternal
  and (c.relname in (...six named tables...) or t.tgname like 'aaa_application_dml_admission_%')
```

and compares that aggregate to a hardcoded `expected->'triggers'`, raising
`retirement_trigger_contract` on any difference.

The `like 'aaa_application_dml_admission_%'` arm matches across **all** public
tables, not a fixed list. The admission guard creates exactly one
`aaa_application_dml_admission_statement` trigger per table it guards. So adding
`hiring_practical_test_jobs` to the guard list necessarily adds one trigger to
this aggregate, and the expected array does not know about it. That is the whole
mechanism; nothing about it is mysterious.

**What the contract should therefore say** is one additional entry, and its
shape is fully determined:

| Field | Value | How it is known |
|---|---|---|
| `name` | `aaa_application_dml_admission_statement` | the guard's `create trigger` names every one identically |
| `table` | `hiring_practical_test_jobs` | the table being added |
| `internal` | false | `not t.tgisinternal` is in the filter |
| `deferrable` | false | the guard creates a plain statement trigger |
| `initially_deferred` | false | same |
| `enabled` | same as the sibling admission triggers | no clause changes it |
| position | between `hiring_invite_jobs` and the `kasper_*` tables | `order by c.relname, t.tgname` |
| `definition_md5` | **NOT ESTABLISHABLE HERE** | see below |

**The blocked field, and why I am not guessing it.** `definition_md5` is
`md5(pg_get_triggerdef(t.oid))`, an MD5 of PostgreSQL's own rendering of the
trigger definition. It differs per trigger because the rendering embeds the
table name, so it cannot be copied from a sibling entry. It can only be obtained
by asking a PostgreSQL server. This sandbox has **16**; the lane asserts on
**17**. Deriving it on 16 and assuming the two render identically is an
assumption I have no basis for, and writing an md5 I did not obtain in full from
a command is precisely the failure recorded in the near-miss entry below.

**The correct closure is not a hand-edited md5 at all.** That expected blob has
generators in the repository (`scripts/linear-exit-control-companion.js` and
`scripts/linear-exit-observed-schema.js` both produce `definition_md5`). The
right closure regenerates the blob with the existing generator against PG17,
which produces every field including the md5 from the real server, rather than
hand-patching one value until the lane stops objecting. Hand-editing it would be
the silencing that has been ruled out twice now.

**So B10's remaining work, precisely:** re-apply the guard-list addition and its
four pin re-derivations and the fixture migration entry, then regenerate the
retirement expected blob on PG17 with the existing generator, then let CI
confirm. Everything except the PG17 regeneration is already understood and was
demonstrated working today.

### 2026-09-15 — B10 is not a catch-up-sized change: STOPPED after three CI rounds

The catch-up to `1abdd1fa` is done and clean. **B10 is the only thing red**, and
it needs an owner decision rather than a fourth guess.

B10's own note said the change touches "the reviewed admission list **and
retirement contract**". Only the first half was actioned. Three CI rounds each
surfaced a different artifact that predates the table:

1. `application_admission_missing_owner:hiring_practical_test_jobs` — the guard
   calls `to_regclass` and aborts on a listed table that does not exist, so the
   shared fixture had to apply the migration that creates it. Fixed.
2. `hiring_practical_test_jobs_raw_footage_url_check` — adding the table to the
   fixture's `TABLES` list made it synthesise a row, and the generator builds
   rows from column metadata without knowing check constraints. The guard only
   needs the table to exist, not to be populated, so that half was reverted.
   Fixed.
3. `retirement_trigger_contract` — the reviewed retirement contract enumerates
   the expected trigger set, and the admission guard now attaches a trigger to
   a table that contract does not know about. **Not fixed, deliberately.**

The third is a reviewed contract describing what the retirement switch is
allowed to see. Re-deriving it to match would be exactly the silencing rule D8
forbids: changing a number until a guard stops objecting, without establishing
that the new state is the intended one. It is also not verifiable here, because
this sandbox has PostgreSQL 16 and the lane requires 17.

**The shape of the finding, which is the useful part.** One word added to a
table list has now invalidated: four hash pins across three files, one shared
test fixture, and one reviewed retirement contract. The source file's own
comment said it plainly and was right: *"New tables/DDL require separate
closure."* Separate closure means a reviewed change of its own, not a line in a
catch-up.

**Two options for the owner, neither taken unilaterally:**

- **Separate B10 out.** Revert the guard-list addition and its four pin
  re-derivations and the fixture migration entry, land the pure catch-up green,
  and do B10 as its own reviewed change that includes the retirement contract.
  Recommended: it gets CI green now and gives B10 the review it evidently needs.
- **Continue inside the catch-up**, which means re-deriving the retirement
  trigger contract. That needs someone to establish what the contract *should*
  say with the new trigger present, not just what makes it stop failing.

Everything else on the branch is green: all 547 unit suites with the Postgres
lanes enabled, the mocked Calendar browser gate, and 11 of 12 CI checks.

### 2026-09-15 — NEAR MISS: a hash was fabricated from a printed prefix, caught and corrected before it shipped

Recorded first because it is the most dangerous thing that happened today, and
it was self-inflicted.

While re-deriving the admission pin chain, a 64-character `CONTRACT_SHA` was
written into `scripts/linear-exit-admission-preflight.js` by taking the
**12-character prefix** that had been printed earlier and inventing the
remaining 52 characters. It was noticed immediately, the real value was computed
with `sha256sum`, and the file was corrected before anything was committed,
tested or pushed.

Why it matters more than an ordinary slip: a fabricated hash in a drift guard
does not fail loudly in an obvious way. It would have made the guard reject the
correct file forever, and the natural next move when a guard refuses is to
"re-derive" it again, which is how a wrong value becomes permanent. It also
defeats the exact protection the guard exists to provide.

The rule this adds, narrower than "be careful": **never write a hash that was
not produced in full by a command in the same breath.** Print the full value and
copy it. A truncated display is for reading, never for authoring. Anywhere a
64-character constant is being written, the full value must come from the tool,
not from memory or reconstruction.

This is the fourth time today reasoning outran checking, and the first where the
output would have been actively harmful rather than merely wrong.

### 2026-09-15 — Catch-up to new main `1abdd1fa`, B10 closed, and what a one-word change actually cost

Main moved to `1abdd1fa` (PR #1407, the hiring Video Editor work) and was
re-frozen there with the wider scope: merges, live database changes from any
session or dashboard, and deployments of anything the exit plan checks against.

**The catch-up itself was small.** One conflict, `migrations/README.md`, where
both sides had appended a bullet to the same list; both kept, chronologically
ordered. Main brought 9 files from the merge base, which was exactly the old
frozen main `0aa5954`.

**The predicted failure did not recur, and was checked rather than assumed.**
Last catch-up, the only failure CI could see was the native-intake fixture
building its database from a hardcoded migration list missing main's new
migration. The new migration `2026-09-15-hiring-video-editor-role.sql` is also
absent from that list, but it is entirely hiring-scoped: it touches no table the
fixture builds and no code path the native-intake lanes exercise. Rather than
reason about that, the whole suite was run **with the Postgres lanes enabled
locally**, which is what makes local match CI. That is now the standard for this
branch: a run that skips the Postgres lanes has not tested the branch.

**Pins re-derived.** `production-write` was unchanged, since main touched only
the two hiring Edge functions. `index.html` changed, so the write-diagnostics
composer's `index.html` hash was re-derived after confirming its seam still
appears exactly once and that main did not touch the seam region.

**B10 closed, and the real cost of it.** `hiring_practical_test_jobs` was added
to the admission guard's table list in
`supabase/migrations/20260912183653_application_dml_admission_preparation.sql`,
in sorted position: 86 entries to 87, still alphabetical, neighbours
`hiring_invite_jobs` and `kasper_ad_campaign_daily`.

That one word broke four pins across three files, in a chain three levels deep:

1. the source's own hash, in `LINEAR_EXIT_ADMISSION_SCHEMA_CONTRACT_20260912.json`
   and again in `LINEAR_EXIT_ADMISSION_RELEASE_EXTENSION_V1.json`;
2. the contract JSON's hash, held both inside the extension JSON and as
   `CONTRACT_SHA` in `scripts/linear-exit-admission-preflight.js`;
3. the extension JSON's hash, as `PIN` in
   `scripts/linear-exit-admission-release-extension.js`.

Re-derived in dependency order, each by string replacement so every file stayed
byte-identical apart from the hash. Structural invariants confirmed rather than
assumed: the contract still lists 7 sources, the extension still lists 7
`sql_owners`, and their `order` values are unchanged. The contract's `tables`
inventory was read directly and needed no change; it describes the admission
machinery's own four `card_write_*` tables, not the guarded list.

Worth carrying forward: **the admission source sits behind a four-deep pin
chain.** Any future change to it, however small, costs the same four
re-derivations. The `ADMISSION_CONTRACT_HASH_DRIFT` level in particular was only
discovered after the first three were fixed, because it lives in a different
script than the other two. Anyone touching that file should map the chain first.

**Result:** all 547 unit suites pass with the Postgres lanes enabled, plus the
mocked Calendar browser gate. 61 profiles are NOT_RUN in that lane by design.

### 2026-09-15 — Two hiring Edge deploys inside the freeze window, deliberately outside its scope

Owner dispatched `hiring-applications` and `hiring-automation` at `1abdd1fa`.

Recorded so a deploy timestamp inside the freeze window does not surprise a
later reader, which is the second time today that has needed saying. Neither is
among B7's twelve, neither touches the database schema, and neither is the
browser, so nothing the exit plan checks against moved. The freeze covers
deployments of things the plan checks against; these are not among them.

### 2026-09-15 — B4 decided: accept the loss, no PITR, so steps 9 and 10 are the recovery route that matters

Owner decisions, recorded for their consequence rather than as bookkeeping.

On any managed restore: **accept the loss of newer saves and reconcile by hand
afterwards.** And **no Point in Time Recovery**, on cost.

The consequence is the part worth writing down. With PITR declined, the managed
restore can only go back to a nightly backup, so the recovery position is
materially weaker than it looked, and **the database backup refresh in steps 9
and 10 becomes the recovery route that actually matters.** It is no longer a
belt-and-braces custody drill running alongside a strong platform fallback; it
is the fallback. Anything that lets steps 9 and 10 slip, or that accepts them as
"done" before the downloaded copy has actually restored, removes the real safety
net rather than a spare one.

B4's mechanical half, whether the Restore control is enabled at all, still needs
the click path in the sitting page appendix.

### 2026-09-15 — B7 settled: frozen main `0aa5954` matches all twelve deployed functions (12 PASS)

The appendix's authenticated fingerprint block was run once on the owner's
Windows machine, from the repository root, exactly as written, pinned at
`0aa5954a5c63e3b6f399caf739e562b371393325`. It used the
`SUPABASE_ACCESS_TOKEN` already present in that machine's user environment,
the same variable the Storage wrapper consumes. The token was not requested,
printed or written anywhere. Mode reported: `live-read-only`. Nothing was
deployed or written.

Printed result, per function (version, then source and live fingerprint
prefixes, which agree in every row):

| Function | Live version | Fingerprint | Files |
|---|---|---|---|
| ai-onboarding-list | 36 | `bce568a72fce` | 2/2 |
| client-credentials | 44 | `d6300381fa19` | 2/2 |
| filming-plans | 34 | `ef1f6aee94d0` | 2/2 |
| key-verify | 39 | `68e6d3094a08` | 2/2 |
| legacy-onboarding-list | 36 | `d1f6a2d9caf4` | 2/2 |
| linear-outbound | 48 | `f59b6206e3cc` | 5/5 |
| onboarding-full | 36 | `68da4d8f413d` | 2/2 |
| onboarding-list | 36 | `a23980f1da39` | 2/2 |
| production-archive | 8 | `3c478af053f2` | 2/2 |
| production-comments | 24 | `202c9492e063` | 3/3 |
| production-write | 71 | `746f8b918d36` | 5/5 |
| smm-weekly-reports | 32 | `e1f925289245` | 2/2 |

```
Summary: 12 PASS, 0 FAIL, 0 ERROR
JWT posture: 12 verify_jwt=false, 0 off-posture
```

Exit code 0. There were no FAIL or ERROR reason lines.

By the appendix's own reading, **recovery route C1 exists and `0aa5954` is the
commit.** This confirms the candidate the full-history analysis named, and the
entry below, which reasoned that the hiring drift cannot affect these twelve.
The earlier "unavailable" and "unproven" entries stay further down as the
record of how the question was narrowed.

It closes B7 only. As the entry below lists, it does not close B5. The sealed
previous-functions record still has to be written; C1's rollback lane remains
UNTESTED; `notify` stays outside it; and the browser half is untouched.

**Step count left at 6 of 28.** Step 2's done-condition asks for a recorded
previous version for every deployed function and whether one single commit
matches all of them. This run answers the second half, but a sealed record is
not yet written. The count is flagged for the owner rather than moved by the
session.

Run once only. It was completed before the owner's repeat request for the same
run arrived, so it was not run again.

### 2026-09-15 — B9 does not touch B7; B4 and B5 worked out the same way B7 was

**B7 is unaffected by the hiring drift, and `0aa5954` remains the candidate.**
The twelve are the eight staff functions plus `linear-outbound`,
`production-comments`, `production-archive` and `production-write`.
`hiring-applications` and `hiring-automation` are not among them, and a database
migration does not enter an Edge function's source-closure fingerprint in any
case. None of the twelve's source changed.

One correction to the framing that reached this session: the two hiring Edge
functions **are** deployed, both at version 3 since 2026-08-25, not undeployed.
It does not change the conclusion, only the reason.

---

**B4: no executable hosted database recovery route if journal resume cannot
finish.**

*What precisely closes it.* Four things, and only the first is mechanical: a
named operator confirming the managed **Restore** control is present and enabled
on the correct project; an identified eligible restore point with its timestamp;
an owner decision taken **in advance** on newer accepted saves, which the
procedure says must be explicit before any overwrite; and an accepted outage
expectation, for which no hosted measurement exists.

*Offline from this sandbox now.* Nothing that closes it. No amount of reading
establishes a permission or an ETA. What can be prepared is the pre-restore
evidence set the route's step 1 demands, so it is not composed under pressure.

*Needs the Windows machine or a browser.* The permission check, prepared as a
click path in the sitting page appendix. Deliberately not a script: it is a
capability question, and a script that "checks" it would either do nothing or
start a restore.

*Needs an owner decision.* Two. The disposition of newer saves, pre-decided
rather than decided mid-incident. And whether to enable **PITR**, which was
observed disabled on 2026-09-14; enabling it before the installation converts
recovery from "the last nightly backup" to "a chosen moment". That is a real
improvement to the recovery position and is nobody's call but the owner's.

Honest summary: B4 is not a blocker a session can clear. It closes on a
capability check and a pre-decision.

---

**B5: no captured compatible browser and function versions with an executable
restoration route before merge.** Two halves, and they are not symmetric.

*What precisely closes the functions half.* The procedure requires one private
row per slug carrying `captured_at`, `prior_version`, `source_sha256`,
`entrypoint_path_sha256`, `file_count`, `verify_jwt`, `matched_git_sha` and the
capture location, across the staff group of eight and the Track-B group of five.

*What a passing B7 would close there, precisely.* Most of it. A PASS means every
deployed function's closure equals `0aa5954`, which supplies `matched_git_sha`
for twelve of the thirteen and, with it, `source_sha256`,
`entrypoint_path_sha256` and `file_count` from the expected side at that commit.
This session has already captured `prior_version` and `verify_jwt` read-only for
all twelve (`verify_jwt` is false on every one).

*What a passing B7 would NOT close.* Four things, stated rather than assumed:

1. **`notify`.** It is in the Track-B five and has no previous version, so no
   pin can exist for it. B8's amendment covers what rollback means there, but it
   remains outside anything B7 can say.
2. **The record still has to be written.** A verified fact in a chat transcript
   is not the sealed private `previous-functions.json` the procedure requires,
   and the configuration backup is recorded separately from it.
3. **Executable is not the same as matched.** C1 restores by deploying an older
   commit through the onboarding lane; matching pins establish that `0aa5954` is
   the right commit, not that the lane will accept and deploy it. The procedure
   already marks that rollback UNTESTED.
4. **The browser half. Entirely.** B7 concerns Edge functions and says nothing
   whatever about the served browser.

*What can be established offline now, and was.* The browser half's baseline. If
Pages publishes from main, the served browser should be `0aa5954`'s, so the
comparison values were computed here: `index.html` at
`61282fa2c0cb568668b49566373723bcac5d6cd32c2c9771e01b1bb1c52fcff7`, plus
`404.html`, `CNAME`, the favicon, the logo and 18 `nav-icons/` files. That is
half the check done without touching anything.

*Needs the Windows machine.* Downloading the actually served files and hashing
them, prepared as a runnable block in the sitting page appendix. It must happen
**before the merge**: afterwards Pages republishes and the pre-merge browser is
no longer downloadable. If `index.html` does not match, that is a finding in its
own right, because it would mean Pages is serving something other than the
frozen commit.

*Needs an owner decision.* Whether an UNTESTED C1 rollback is acceptable as the
function-side route, which is the same question B6 was withdrawn over and B7
feeds.

### 2026-09-15 — LESSON: the freeze covered merges, not the live database

This is the real lesson of the day, and it is recorded on its own so it is not
lost inside the hiring details.

The owner froze main at `0aa5954` and defined the freeze as **no merges**. The
reviewed installation plan does not depend on main alone. It depends on the
**live database** matching a reviewed catalog profile. The freeze said nothing
about live schema changes. The same day, a separate session applied a
legitimate, dry-run-tested migration directly to production. Nobody noticed the
gap, because nothing in the freeze definition made anyone look for it. It
surfaced only when the catalog read refused.

Nothing was harmed, because the check refused as designed. But a freeze that
leaves the thing under review free to change is not a freeze.

**For the next freeze, define it from the start to cover everything the plan is
pinned against:**

- merges to main;
- live DDL on the production database, from any session, dashboard or tool;
- deployments that change what the plan observes;
- and an explicit, named exception process if something must change, so the
  plan owner hears about it before the catalog read does, not after.

State the scope in the freeze entry itself, not only "main is frozen".

**Second lesson worth carrying forward: read the actual list.** Structural
checks could not see the admission guard gap. The dependency catalog showed
hiring objects linked only to hiring objects, and Postgres does not record what a
plpgsql body touches. The gap was found only by reading the literal table list
in the admission source. It named three hiring tables and not the new one. When
a question is "does X cover Y", read the thing that enumerates X. Do not infer
coverage from the absence of structural links. The owner then confirmed it by
reading the same list independently.

### 2026-09-15 — Owner sitting on the Windows machine: Storage capture passed; catalog refused on live schema drift; steps 8, 9 and 10 not run

Run from the owner's machine against the sitting page, in its order. Nothing
installed, applied, deployed, merged or dispatched. Main still `0aa5954`.

**Storage capture (step 1), two attempts.**

- Attempt 1 refused after about 19 minutes with `STORAGE_EXPORT_BODY`, at 15,307
  Storage reads during the encrypted export. Read against the adapter source,
  that code is a stream error while reading an object body after the request
  was answered: not the version/size drift fence, not a timeout, not the size
  limit, and the log shows no non-200 response. Classified as transport, not a
  broken quiet window. Directory, log and refusal receipt preserved; no
  plaintext left behind. Owner chose one new attempt.
- Between the two attempts Storage gained one object (1,084 to 1,085) with no
  known source. Harmless to attempt 2 because it takes a fresh inventory, and it
  did not recur during the export.
- Attempt 2 **PASSED**: 1,085 objects, 2 buckets, 2,343,907,896 bytes,
  `local_readback_verified: true`, plaintext readback removed. All seven source
  pins equal to independently computed hashes of the checkout. Inventory SHA-256
  `c2867ecb6f4cf17fe1238913e046ead12822ac596e2c1a824dc93df5ec17803c`, encrypted
  manifest SHA-256
  `47efa156367266af775d68125706be3616aa0f730217003cb3c61e4af61150ce`. 2,824
  ciphertext files.
- Transport archive packed with the operator file's own `pack` command:
  `PACKAGED_NOT_UPLOADED`, 2,824 files, 2,346,184,452 bytes, SHA-256
  `02bbd69b6a98fa8990a1a4dd7e2bab7b24b01284e1ca47e1eadadcdab7ef9a5a`.
- **Step 1 is not complete.** The owner has not uploaded it, not chosen the
  second device, and not downloaded it. The drill is explicitly not started.

**Catalog read (step 8), two runs.**

- Run 1 refused with the wrapper's catch-all. Local checks found the pinned CA
  file `%APPDATA%\postgresql\root.crt` absent, with its whole folder gone,
  although yesterday's passing smoke run had used it. Nothing was substituted by
  the session. The owner downloaded Supabase's public root certificate from the
  project's own dashboard and placed it. The session verified it before use:
  exact filename, one clean PEM block, no HTML or stray text, parses as the
  self-signed CA "Supabase Root 2021 CA", valid to 2031, SHA-256 fingerprint
  beginning `80:70:25:AD`. **Why the folder disappeared is unknown; recorded by
  owner instruction, not chased.**
- Run 2: identity matched yesterday exactly, `tls_verified: true`, but catalog
  hash `ddfa4c4f0d97eefd5fbe4686756714e33ce6b4d977707d7ee8e9fb92f1bedd8c`
  matched **neither** profile (`profile: null`, exit 2). Stopped. Step 9 was not
  started and its wrapper would have refused that receipt anyway.
- The diff against yesterday's passing `observed67_optout` catalog is entirely
  hiring: one new table, 4 indexes, 2 triggers, 4 internal constraint triggers,
  7 new functions, 3 changed function bodies, two new columns and check changes
  on `hiring_applications`, check changes on two other hiring tables, and 49
  dependency rows. Policies, default ACLs, sequences, views, types, rules and
  publications identical. Nothing named `team_members` changed.
- Source: the owner's own hiring practical-test migration, applied deliberately
  and dry-run first, unrelated to the Linear exit, on branch
  `claude/serene-hawking-6cdglo` (PR #1407), not on main.

**Owner decisions taken in the sitting.** Do not re-pin; do not run 8, 9 or 10
today; classify instead. See D12.

**Classification: is the hiring change confined to hiring?** Answered from code,
not from structure.

What was checked:

1. The migration file on the branch (964 lines, fetched only, never checked
   out), SHA-256 `92af9c25e5b0c2846c58e62e596b3a68a5a6e3217a68efd4dabcb82fdd5024e0`.
2. The live definitions of all ten functions, read-only via
   `pg_get_functiondef`: the seven new
   `hiring_authorize_practical_test_send_v1`,
   `hiring_claim_next_practical_test_v1`, `hiring_queue_practical_test_v1`,
   `hiring_record_practical_test_result_v1`,
   `hiring_require_practical_test_send_authorization`,
   `hiring_retry_failed_practical_test_v1`,
   `hiring_set_practical_test_verdict_v1`, and the three changed
   `hiring_capture_application_v1`, `hiring_queue_interview_invite_v1`,
   `hiring_record_interview_booking_v1`.
3. **File against live: identical.** For all ten, the md5 of the body text in
   the file equals the live `body_raw_md5` in today's catalog. Security-definer,
   `search_path` and execute grants also agree with the file.
4. The new table's columns, constraints and its only foreign key (to
   `hiring_applications`), its two triggers, and every added dependency edge.
5. The installation side: the 48-source plan builders, the admission guard
   source and the retirement contract source.

The answer has two directions, and it is **not** "confined to hiring".

- **Hiring code into non-hiring objects.** Every table read or written by the
  ten bodies is a hiring table, with one exception:
  `public.syncview_runtime_flags`. Six functions read their own keys from it
  (`hiring_practical_tests_enabled`, and `hiring_invites_enabled` in the
  interview invite). `hiring_authorize_practical_test_send_v1` takes a
  `FOR SHARE` row lock on its row. The migration also **inserted one row** into
  that table (the new kill switch, seeded disabled). No function writes outside
  hiring. The `touch_updated_at` trigger calls the pre-existing
  `hiring_touch_updated_at()`. The one non-security-definer trigger function
  keeps Postgres's default public execute, which the file never revokes.
- **The installation into hiring.** The installation writes onto hiring tables.
  The admission guard source, which is in the 48 through the admission release
  extension, creates `aaa_application_dml_admission_statement` and `…_row`
  triggers on an exact 86-table list. That list includes `hiring_applications`,
  `hiring_application_events`, `hiring_invite_jobs` and
  `syncview_runtime_flags`, but **not** `hiring_practical_test_jobs`. The
  retirement contract pins those three hiring guard triggers by definition hash.
  The admission gate installs `open`, so on install day the guards pass
  everything through. Once admission is closed, writes to the three guarded
  hiring tables are refused, while updates confined to the new table (claim,
  authorize, record result) would still commit. The source's own comment says
  new tables require separate closure. See B10.
- **Not affected.** The retirement trigger contract scopes itself to named
  control tables plus the `aaa_application_dml_admission_%` triggers, so the new
  table's own triggers do not trip it. None of the four legacy hiring migrations
  is in the install manifest, so installation replays nothing hiring. The new
  table uses no sequences.

### 2026-09-15 — Step 2 answered: NO single commit matches all thirteen deployed functions

Recovery route C1, which assumes one older main commit matches every deployed
Edge function, **is not available**. This became an owner decision before step
13. Nothing was built in response; the instruction was explicitly to report and
stop, not to start a replacement route.

The decisive evidence needs no fingerprint comparison at all: **`notify` is not
deployed.** It exists in the repository with three source files, but the live
project has no function by that slug. Confirmed by direct lookup, which returned
`NotFoundException`, rather than inferred from its absence in a list. One of the
thirteen has no currently deployed version, so no commit can match all thirteen.

Corroborating, the other twelve were deployed across five distinct events
spanning twenty days:

| Deployed | Functions | Live version |
|---|---|---|
| 2026-08-26 | production-comments | 24 |
| 2026-08-29 | production-archive | 8 |
| 2026-09-04 | the eight staff functions, within 21 seconds of each other | 32 to 44 |
| 2026-09-14 | production-write | 71 |
| 2026-09-15 | linear-outbound | 48 |

Where the set splits is therefore those five groups, with `notify` as a sixth
case of its own.

**What was proven versus what was not.** Proven: the live inventory, the version
numbers, the deploy timestamps, and `notify` being absent. Not proven: a
per-function source fingerprint mapped to a specific commit. `ef-fingerprint.js`
refuses its live comparison without a Supabase access token, which this
sandbox does not carry and which nobody should be asked for. The answer does not
depend on that missing piece, because `notify` settles it on its own, but the
gap is recorded rather than papered over.

One observation worth keeping, not a finding: `linear-outbound` was deployed at
16:57 UTC on 2026-09-15, about two minutes after the frozen main commit landed
at 16:55 UTC. That is consistent with a deploy lane running off the merge that
became the freeze point. The freeze is on merges, not deploys, so this does not
break it. Noted so a later reader is not startled by a deploy timestamp inside
the freeze window.

### 2026-09-15 — CORRECTION to the entry above: the decisive argument was wrong, and the question is now UNPROVEN

Placed below the original per the house rule. The original entry stays exactly
as written; it is wrong and that is the point of keeping it.

**What was wrong.** The entry treated `notify` having no live deployment as
proof that no commit could match all thirteen. That inverts the meaning.
`notify` **does not exist on frozen main at all**. It is new code this migration
branch adds. Verified both ways: no `notify` source directory at `0aa5954`, one
on the prep branch; main's onboarding lane deploys **twelve** slugs, the prep
branch's deploys thirteen with `notify` as the addition.

So `notify` having no live version is the ordinary state of a function that has
not shipped yet, not a missing prior deployment. The premise was true and meant
the opposite of what was drawn from it. The verdict happened to be defensible;
the reasoning that produced it was not, which is worse than a wrong answer
honestly reasoned, because it would have survived review on false grounds.

The failure was not checking whether `notify` existed on main before building an
argument on its absence. One `git ls-tree` would have caught it.

**Re-answer for the twelve that do have deployed versions: UNPROVEN from this
sandbox.** Not "no". Unproven.

Worse, the original entry's supporting evidence leaned toward "no" and that lean
was also unjustified. The offline structure actually leaves a single matching
commit **plausible**: of the twelve, ten saw no changes to their own source
directories across the whole deploy window, and the two that moved a lot,
`linear-outbound` and `production-write`, are the two deployed most recently. A
commit near the top of main is a reasonable candidate. That is not a finding
either; it is the reason the question needs a real answer rather than an
inference in either direction.

**What would prove it, exactly.** Live fingerprints are what is missing, and
they are independent of whichever commit is pinned, so one authenticated run
produces all of them:

1. On a machine that carries `SUPABASE_ACCESS_TOKEN` (the owner's machine, or
   CI), run `node scripts/ef-fingerprint.js <any-40-char-sha>
   --slugs=onboarding-list,ai-onboarding-list,legacy-onboarding-list,onboarding-full,client-credentials,filming-plans,smm-weekly-reports,key-verify,linear-outbound,production-comments,production-archive,production-write
   --format=json` and keep the twelve `live_fingerprint` values.
2. Offline, walk main backwards from `0aa5954` running the same command with
   `--expected-only` at each candidate commit.
3. The answer is the first commit whose twelve `expected_fingerprint` values all
   equal the live ones. If no commit matches, C1 is genuinely unavailable.

This session cannot do step 1: `ef-fingerprint` refuses its live comparison
without that token, the sandbox does not carry it, and the house rule is that
nobody asks the owner for it. Reading deployed source through the Supabase
connection and re-hashing it locally was considered and rejected as a
workaround that would reimplement the closure algorithm and could quietly
disagree with the real tool.

**Also corrected: the live function count is 36, not 37.** A miscount. It
cross-checks: the branch manifest carries 38 slugs, and the two not live are
`notify`, unshipped, and `write-diagnostics`, dormant by design.

**New point nobody had stated.** Rolling back a brand-new function is a
different operation from rolling back the other twelve. For the twelve there is
a previous version to restore. For `notify` there is no previous version, so
"rollback" means **removing the function or leaving it inert**, not restoring
anything. The recovery procedure currently describes a thirteen-function
restoration in uniform terms and should say which of the two it intends for
`notify`. Recorded as B8.

### 2026-09-15 — Authoritative step count, and the B7 run prepared for handover

**The step count is 6 of 28, about 21%.** Two sessions were reporting different
figures into the same record, 6 of 28 against 7 of 28. Take the number from this
file, not from either chat. The difference was step 8: it is in progress, and
the map says in progress is not complete, so it does not count. Step 2 being
answered does not move the figure either, because step 2 sits in Phase 0 and its
own done-condition is currently unmet.

**The B7 authenticated run is prepared and ready to hand over**, written as a
runnable block in the [owner sitting page](LINEAR_EXIT_OWNER_SITTING_20260915.md)
appendix. Not queued and not run: the local session was mid Storage capture and
must not be interrupted. The token was not requested and does not appear
anywhere in the repository.

The appendix records that the run settles **both** gaps the offline analysis
left open, and why:

- A deploy cut from a ref other than main's tip stops mattering once content is
  compared, because C1 asks whether a commit matches what is deployed and the
  fingerprint compares closure content directly.
- The `release/` staging path is handled by `normalizeLivePath`, which maps
  deployed paths back to the canonical `functions/<slug>/…` form and **throws**
  on anything it cannot map. A layout mismatch therefore cannot produce a false
  PASS, only an honest FAIL or a loud ERROR naming the path.

Both of those were checked in the tool's source before being written down,
rather than assumed from its documentation.

### 2026-09-15 — This round, the supervisor's claim was the thing that failed

Worth recording explicitly, because the previous two rounds went the other way
and a record that only shows one direction teaches the wrong lesson.

The supervisor's correction about `f2c889d` and the three staff functions did
not reproduce, and the instruction to verify rather than accept it is what found
the real problem: the clone was shallow, so both sides had been measuring over
truncated history. The supervisor independently confirmed this on their own
clone.

The general rule this supports: a correction from a reviewer is a hypothesis,
not a fact, and checking it costs one command. Accepting it unverified would
have written a wrong conclusion into this file with a second signature on it,
which is harder to unpick later than a single session's error.

### 2026-09-15 — SECOND correction on step 2: the clone was shallow, and B7 narrows rather than closing

Appended below both earlier entries. Neither is edited.

**The clone was shallow.** This is the important finding, and it invalidates
earlier reasoning. `git rev-parse --is-shallow-repository` returned true, and
the commit at the boundary reported no parents, so every `git log --since`
count in the first step 2 entry was computed over truncated history and a
`git show --stat` on a boundary merge showed the whole tree as additions.
History was fetched in full, 3787 commits on main, before redoing anything.

Any future session doing history archaeology here should check for a shallow
clone first. A truncated history does not announce itself; it just quietly
answers the wrong question.

**A supervisor claim was checked and did not reproduce.** The claim was that
commit `f2c889d` on 2026-09-07 added 361 lines across `filming-plans`,
`key-verify` and `onboarding-list`, which would have put source changes after
those functions' 2026-09-04 deploy. Measured against full history, `f2c889d`
touches none of those three directories on either parent, and **none** of the
eight staff functions' own directories changed on main at any point after
2026-09-04. The conclusion drawn from that premise therefore does not follow.

**The closures were then measured with the real tool**, rather than by counting
commits, using `ef-fingerprint --expected-only` at a commit just after the staff
deploy and at frozen main. Across that whole window:

- **Ten of the twelve are byte-identical**: the eight staff functions plus
  `production-comments` and `production-archive`.
- **Two moved**: `production-write` and `linear-outbound`.

**Where the two moved, and when they deployed:**

| Function | Closure last changed on main | Deployed |
|---|---|---|
| `production-write` | `73d5fdc3`, 2026-09-14 20:20 UTC | 2026-09-14 21:34 UTC |
| `linear-outbound` | `0aa5954`, 2026-09-15 16:55 UTC | 2026-09-15 16:57 UTC |

Each was deployed shortly after the commit that last changed it, and neither
changed again afterwards. That also explains the deploy timestamp inside the
freeze window noted in the first entry: `linear-outbound` was deployed two
minutes after the merge that became the freeze point.

**So B7 does not close to "C1 unavailable". The offline evidence points the
other way.** Frozen main `0aa5954` is the single leading candidate: ten of the
twelve are stable through it, `production-write` sits at its deployed value
unchanged since `73d5fdc3`, and `linear-outbound` changed exactly at `0aa5954`
and deployed minutes later.

**The honest limit, unchanged.** This is expected-side evidence plus deploy
timing. It is circumstantial, not proof. Nothing here observes what is actually
running. Two specific gaps: a deploy could have come from a ref other than
main's tip, and the deployed entrypoint paths for `production-write` and
`linear-outbound` sit under a `release/` staging directory rather than the
`supabase/functions/` paths the expected side is computed from, so path-level
agreement has not been shown either. One authenticated `ef-fingerprint` live
read settles all of it, and remains the final word.

B7 is therefore narrowed, not closed: named candidate `0aa5954`, one live read
to confirm or refute.

### 2026-09-15 — Owner sitting page written for steps 1, 8, 9, 10 and 11

Prepared a single ordered page the owner can follow cold at the keyboard, with
the exact command per step, what output means it worked, timings, stop
conditions placed inline, prerequisites, and safe stopping points.

Changed the order the owner sketched. He had listed the catalog read first, then
Storage. The runbook requires the catalog read to be immediately followed by the
database refresh and treats a catalog over an hour old as stale; Storage takes
20 to 30 minutes plus transfer. Running Storage between them would have expired
the catalog and forced a re-run at the keyboard. Storage now runs first. Owner
accepted the correction.

Two limits stated on the page rather than papered over: the exact argument list
for the Storage operator lives in a private file on the owner's machine that no
session can read, so the page points at that file instead of guessing flags; and
only the 20 to 30 minute Storage figure comes from the runbook, the rest are
estimates and are labelled as estimates.

### 2026-09-15 — Step 8 partially done: identity and profile confirmed, hash and TLS still owed

Confirmed read-only: project `syncview-calendar`, the direct host the operator
config expects, PostgreSQL 17, healthy.

The live catalog matches the **`observed67_optout`** profile. This was checked
against both discriminators the profile actually keys on, not just the obvious
one. The profile derives the older baseline by removing
`team_members.auto_assign_opt_out` *and* by rewriting the table ACL to restore
table-wide read. Live, the column exists as boolean, default false, not null;
and the table ACL has table-wide read revoked from the two public roles, which
instead hold column-level read on 11 of 12 columns with the flag withheld. Both
halves agree with the profile.

Reported as **in progress, not complete**. Two parts of its done-condition
cannot be produced from a session: the full-catalog hash comparison and the
direct-connection TLS check both need the private catalog script and CA file on
the owner's machine. Verifying a profile by its discriminating features is
strong evidence but it is not the hash comparison the step asks for, and saying
otherwise would have been the easy lie.

### 2026-09-15 — Twelve of twelve green on `f4452dc5`; step 7 complete

Four commits took the branch from conflicted to fully green against frozen main:
the catch-up merge, the test register, the two re-derived source pins, and the
fixture schema fix. The owner verified the twelve checks himself.

The last failure was the instructive one. Five Postgres-routed native-intake
suites failed **only in CI**; they skip locally unless a disposable database is
explicitly required, so a clean 547-suite local run had said nothing about them.
Root cause: the native-intake harness builds each throwaway database from a
hardcoded migration list which did not include main's new migration, so the
fixture lacked the `auto_assign_opt_out` column while the gateway's roster read
now names it, and every assignee lookup returned 503. Exactly the failure that
migration's own note warns about.

Reproduced against a real local PostgreSQL before fixing (30 passed, 18 failed,
matching CI), then 48 passed and 0 failed after. That confirmed the missing
column accounted for **all** eighteen, which the owner had required before any
push.

### 2026-09-15 — Five pins broken by the catch-up, all tracing to one feature

Catching main up invalidated five things that had pinned themselves to the
pre-merge picture of the repository. Four traced to a single cause: main's
auto-assign opt-out feature changing the write gateway.

1. The explicit test register, which the branch introduced and main does not
   have, so main's two new test files arrived unregistered. This single refusal
   was the root cause of all three of the first CI failures, because the unit
   lane and both isolated database lanes run the same routing script.
2. The Section 4 deploy-lane fingerprints, regenerated during the merge.
3. The write-diagnostics composer's two stored source hashes.
4. The native-intake test's pinned baseline commit.
5. The native-intake fixture's hardcoded migration list.

### 2026-09-15 — Catch-up merge: five conflicts, not the three that were rehearsed

The reviewed helper refused with `STOP_UNEXPECTED_CONFLICT`. The plan expected
three bookkeeping conflicts; there were five, the new ones being the directory
map and `index.html`, which is application code.

`index.html` looked catastrophic (about 2,400 changed lines on the branch
against about 1,000 on main) but almost all of it merged automatically. Only two
hunks survived, roughly 90 lines, and they were in the worst possible place:
both sides had rewritten the same notice-priority ladder on the Workload board,
the code that decides which single warning a person sees.

Resolved by keeping both sides' behavior. See decisions D5, D6 and D7.

### 2026-09-15 — Owner froze main at `0aa5954`

Verified against the remote rather than taken on trust. No merges until the
installation is finished. A merge in this window would also invalidate a handed
over deploy SHA, which has cost rejected dispatches twice before.

### 2026-09-14 — Execution map published

One flat list of 28 numbered steps across 7 phases with 7 owner approval gates,
with a done-condition per step and a reporting format. It exists because the
preparation had grown into many documents and no single ordered thing an
execution session could follow and report against. Publishing it authorizes
nothing.

### 2026-09-14 — Recovery procedure written, and what it exposed

Writing the recovery routes down is what revealed that several of them were not
proven. The document says so in its own words: the 13-function hosted rollback,
the prior pin set and the safe transition are **untested and unestablished until
day-of checks pass**. It also records that redeploying code does not rewind
accepted database saves or reverse notifications, so a code rollback is not a
data rollback.

That honesty produced two concrete day-of prerequisites which are still open,
listed in blockers below. The value of the document was as much in what it
proved missing as in what it documented.

### 2026-09-14 — Database custody drill completed

Captured, encrypted, uploaded to the private Drive folder, downloaded on a
second device, hash matched, restored into an isolated database. This is the
drill that makes a backup real: a package that has only ever existed on the
machine that made it has not been shown to be recoverable.

It has to be refreshed on installation day, which is steps 9 and 10.

**CORRECTION, added 2026-09-15. The entry above is kept as written.** "Downloaded
on a second device" is not what the private custody record says. Its retrieval
scope records an actual browser download of the encrypted package from the
private Drive folder **back onto the same computer** that made it. The
downloaded archive's SHA-256 matched, and the restore of that downloaded copy
passed. Separately, the owner opened the recovery record on their phone.

So the 2026-09-14 drill proved three things: a Drive round trip, a restore of
the downloaded copy, and the recovery record's existence on a separate device.
It did **not** prove retrieval of the package on a separate device. The owner
confirmed on 2026-09-15 that the file's wording is the correct record. The
recovery record itself has been exercised once: it decrypted that downloaded
package.

### 2026-09-14 — Three owner approvals recorded

See decisions D2, D3 and D4. In short: a narrow three-field browser exception;
a correction that normal Slack alerts are preserved and only the one displayed
Linear link goes; and a scope limit to website decoupling with Linear itself
untouched.

### 2026-09-13 — PR #1382 superseded by PR #1391 on a main base

Review found #1382 conflicted. Preparation moved to
`prep/linear-exit-review-fixes-20260913`, opened as draft PR #1391 on 2026-09-14
with main as its base.

Recorded precisely because the wording matters to a future session: **#1382 is
still open, not closed.** It is superseded, not replaced. Its branch,
`integration/linear-exit-current-main-20260910`, sits on an older main base
(`340a3be0`). Do not treat it as the live line of work, and do not take its body
as current state.

### through 2026-09-12 — Preparation build and isolated proofs

The preparation build reached: a 48-source, 55-chunk observed installation with
exact routine bodies and matching fresh replay; a proven interruption and resume
that preserves the committed chunk prefix and finalizes removal of the temporary
guards; encrypted recovery coverage; and guarded retirement and native reopening
behind isolated checks.

The load-bearing caveat, stated at the time and still true: these are isolated
and offline proofs, **not hosted acceptance**. Nothing about them establishes
that the live system behaves the same way.

---

## 2. Open blockers

Live list. Items come off with a date and a note, never by deletion.

| # | Blocker | Waiting on | What would clear it |
|---|---|---|---|
| B1 | Storage custody outstanding from step 1 | Owner, needs a genuinely quiet window where nobody is editing Drive files | Run the Storage operator, then upload, download on a second device, hash compare and restore the downloaded copy. Must be done before step 13 |
| B2 | Step 8 incomplete | Owner's catalog script run | A receipt with its supported-baseline and TLS checks passing, naming `observed67_optout`. Identity and profile are already confirmed read-only; the full-catalog hash and direct-connection TLS are what remain |
| B3 | Fourteen inaccessible Drive file references undecided | Owner | A decision per reference. A private decision sheet exists. No replacement or deletion is authorized. Does **not** block the dormant install |
| B4 | No executable hosted database recovery route if journal resume cannot finish | Owner and session, before step 13 | Carried from the checkpoint, not in the owner's own list of three. Named there as a day-of prerequisite |
| B5 | No captured compatible browser and function versions with an executable restoration route before merge | Owner and session, before step 16 | Carried from the checkpoint, not in the owner's own list of three. Named there as a day-of prerequisite |

| B6 | Recovery route C1 is not available: no single older commit matches all thirteen deployed functions, and `notify` is not deployed at all | Owner, before step 13 | An owner decision. Either accept proceeding without C1, or authorize a separately prepared and reviewed exact-capture restoration lane. Added 2026-09-15 from the step 2 capture. Tightens B5, which assumed a restoration route would exist |

| B7 | Whether one older main commit matches all **twelve** functions that have deployed versions is UNPROVEN, so C1 is neither confirmed nor ruled out | Owner or CI, before step 13 | One authenticated `ef-fingerprint` live read plus an offline walk back through main. Recipe in the 2026-09-15 correction entry. Added 2026-09-15, superseding B6 |
| B8 | The recovery procedure does not say what rollback means for a brand-new function | Owner, before step 16 | For `notify` there is no previous version, so rollback means removing it or leaving it inert, not restoring. The procedure should state which. Added 2026-09-15 |

**B10 blocked on PG17 access, 2026-09-16.** Reverted out of the catch-up by owner
decision so the catch-up could land green, which it did at `0c923169`. The
remaining work is understood and was demonstrated today: re-apply the guard-list
addition, its four pin re-derivations and the fixture migration entry, then
regenerate the retirement expected blob with the existing generator against a
real PostgreSQL 17 server. This sandbox has only 16, no PGDG repo and no docker
daemon; the owner's machine has PG17 at the path the runbook already uses. The
missing thing is a disposable PG17 server, not effort.

**B10 NOT closed, corrected 2026-09-15 later the same day. The note below stands
as written per the append rule and is wrong.** The guard-list addition and its
four pin re-derivations landed, but closure also requires the reviewed
retirement trigger contract, which B10's own note named and which was missed.
CI's Isolated PG17 retirement-switch lane is red on `retirement_trigger_contract`.
B10 is open and needs an owner decision: separate it out of the catch-up, or
re-derive that contract deliberately. See the top progress entry.

**B10 closed, 2026-09-15.** `hiring_practical_test_jobs` added to the admission
guard list in sorted position, 86 entries to 87, and the four downstream pins
re-derived in dependency order. The ordering constraint was satisfied by the
hiring migration landing on main at `1abdd1fa`.

**B4 decided in part, 2026-09-15, owner. Row kept above, still open.** Accept
the loss of newer saves and reconcile by hand; no PITR, on cost. Consequence:
steps 9 and 10 are now the recovery route that actually matters, not a spare.
What remains open is the mechanical half, whether the managed Restore control is
enabled at all, which is the click path in the sitting page appendix.

**Accepted-loss position IMPROVED, 2026-09-16, owner. The note above is kept as
written.** In a real incident, "reconcile newer saves by hand" no longer has to
mean reconstructing them from memory. Restore-to-new-project can produce a
restored copy beside the live database without touching it, so newer saves can
be reconciled against a real source. See **D14**. The route itself is unchanged:
in-place restore (D13).

**B5 browser baseline re-derived, 2026-09-15, still open.** Recomputed against
`1abdd1fa`; the `0aa5954` values are stale and removed from the sitting page. The
framing was also corrected: the capture must be taken immediately before the
**exit** merge, not before any merge, because every merge republishes Pages. The
page now says to re-derive from main's tip at capture time rather than trusting
any value written in advance.

**B7 closed yes, 2026-09-15.** 12 PASS, 0 FAIL, 0 ERROR at `0aa5954` on the
Windows machine. C1 exists and `0aa5954` is the commit; it remains an ancestor of
`1abdd1fa`, so both the answer and the rollback target survive the merge. It does
not close B5.

**B7 narrowed, 2026-09-15, row kept above.** It does not close to "C1
unavailable". Measured over full history, ten of the twelve closures are stable
across the deploy window and the two that moved were each deployed minutes after
the commit that changed them, making frozen main `0aa5954` the single leading
candidate for a commit matching all twelve. Still unproven: the evidence is
expected-side plus deploy timing, and does not observe what is running. One
authenticated `ef-fingerprint` live read confirms or refutes. B7 stays open with
that candidate named.

**B7 closed YES, 2026-09-15, row kept above.** One authenticated
`ef-fingerprint` live read pinned at frozen main `0aa5954` returned
`Summary: 12 PASS, 0 FAIL, 0 ERROR` with all twelve at the expected JWT
posture. Every function with a deployed version matches `0aa5954`, so recovery
route C1 exists and `0aa5954` is its commit. `notify` stays outside C1 by
design (B8). B5 is not closed by this; see the B7 progress entry.

**B8 closed, 2026-09-15.** The recovery procedure now states that `notify` has
no previous version, so its rollback means removal or leaving it inert, and that
the other twelve are a different operation. Owner-approved amendment.

**B6 is withdrawn as reasoned, 2026-09-15.** Its row stays above per the append
rule. It asserted that C1 was unavailable *because* `notify` had no deployed
version. That reasoning was wrong: `notify` is new code that does not exist on
frozen main, so having no deployed version is expected. B7 replaces it on the
correct basis, and reaches a weaker and more honest conclusion: unproven rather
than unavailable.

| B9 | The live database is ahead of main: the owner's hiring practical-test migration was applied live, so the catalog matches neither reviewed profile and steps 8, 9 and 10 cannot pass | Owner, the hiring migration landing on main after the freeze | Once it is on main, re-derive the catalog profile once against that settled state, review it, then run steps 8, 9 and 10 back to back. Added 2026-09-15. Keeps B2 open |
| B10 | Admission closure does not cover the new `hiring_practical_test_jobs` table, and the reviewed admission list and retirement contract predate it | Owner and session, before the installation is re-planned for B9 and before admission is ever closed | Decide whether the new table joins the admission guard list, re-derive the guard source and retirement contract expectations if so, and record the classification of the hiring reads and the one inserted row in `syncview_runtime_flags`. Added 2026-09-15 |

**B1 narrowed, 2026-09-15, not cleared.** The quiet-window capture passed on
its second attempt and the transport archive is packed. Still outstanding: the
owner's private upload, a download on a second device (not yet chosen), the
hash and size comparison, and a passing restore of the downloaded copy. B1 stays
open until that restore passes.

**B10 decided in principle, 2026-09-15, owner. Row kept above, still open.**
The owner confirmed the gap by reading the admission list directly: it names
`hiring_applications`, `hiring_application_events` and `hiring_invite_jobs`, and
not `hiring_practical_test_jobs`. Decision: the new table **will** join the
admission guard list. Implementation waits.

**Ordering constraint. Do not get this wrong.** The admission loop raises
`application_admission_missing_owner` for any listed table that does not exist.
So adding `hiring_practical_test_jobs` to the list **before** the hiring
migration is on main would make the installation abort on every database that
lacks the table: fresh replays, the isolated proof clusters, and any restore.
Required order:

1. The hiring migration merges to main, after the freeze lifts.
2. The catalog profile is re-derived once against that settled state (B9).
3. Only then is the table added to the admission guard list, with the guard
   source and the retirement contract's expected guard triggers re-derived
   together and reviewed.

Adding the name first, to "get ahead", is the wrong order.

**B1, B2 and B9 unchanged, 2026-09-15, owner.** B1 is the owner's to finish. No
second computer has been chosen, the drill has not started, and step 1 is not
complete. B9 and B2 stand as written: no re-pin; the hiring change merges after
the freeze lifts, then the profile is re-derived once, and only then do steps 8,
9 and 10 run back to back.

**B1: reduced Storage drill chosen, 2026-09-15, owner. Row kept above, still
open.** The owner has no convenient second computer and will not chase one.
In place of the second-device drill, the owner uploads the packed Storage
archive to the private Drive folder and downloads it back onto **this same
machine**, into a fresh directory. The session then verifies the downloaded
copy's SHA-256 and byte size, runs the transport verify, and runs the full
authenticated decrypt against the signed inventory.

What the reduced drill establishes, if it passes:

- the archive survives a round trip through private Drive byte for byte;
- the recovery record decrypts it, with every object checked against the
  inventory hash and size.

What it does **not** establish:

- independent retrieval of the package on a separate device.

This is a **reduced substitute the owner chose, not an equivalent.** It matches
what was actually done for the database package on 2026-09-14 (see the
correction under that entry): a same-machine Drive round trip, with the
recovery record opened on the phone. It is not the stronger second-device drill
the sitting page describes. To be plain: **no package, database or Storage, has
yet been retrieved on a separate device.**

**Step 1 is not marked complete on this basis.** When the reduced drill passes,
B1 narrows to the second-device gap alone, and stays open.

**Reduced drill RESULT, 2026-09-15: PASSED.** Hash and size of the downloaded
copy equalled the packed archive, all 2,824 ciphertext files verified exact,
and the authenticated decrypt verified all 1,085 objects and 2,343,907,896
bytes against the signed inventory. Receipt
`downloaded-storage-readback-20260915-2.json`, which still records
`other_device_retrieval_independently_proven: false`.

**B1 is therefore narrowed to exactly one thing: no package has ever been
retrieved on a separate device.** Step 1 is not complete. Whoever closes B1
must either do that drill or record an explicit owner acceptance of the
reduced substitute as sufficient for step 13.

**B1 CLOSED, 2026-09-16, accepted by the owner. Row kept above.** The owner
explicitly accepted the reduced drill as sufficient for step 1, and the
execution map's step 1 wording supports that reading (see the 2026-09-16
progress entry). Step 1 is complete.

**PERMANENT CAVEAT. This is part of the record, not an open item, and must not
be removed or softened by a later session.**

> No package, database or Storage, has ever been retrieved on a separate
> device. The 2026-09-14 database drill and the 2026-09-15 Storage drill were
> both same-machine round trips through private Drive. Each proves that the
> archive survives the round trip byte for byte and that the recovery record
> decrypts it with every item verified. Neither proves hardware independence:
> that the backup is retrievable when this machine is lost or unavailable. The
> recovery record itself has been opened on a separate device, the owner's
> phone. The packages have not.

Anyone relying on these backups for a scenario that includes loss of the owner's
Windows machine should treat retrieval from another device as **unproven**.

**B2 stays open, 2026-09-15.** Run 2 of the catalog read verified TLS and
identity, which clears the TLS half of the original row. The profile half now
fails for a new reason, B9. Not cleared.

**Note on the freeze, 2026-09-15, owner.** The freeze at `0aa5954` was defined
as a merge freeze. It did not cover live schema changes, and one was applied the
same day through a separate session. Freezing merges does not freeze the
database the plan was reviewed against. A future freeze for this work should
say whether it also freezes live DDL.

**B3 DEFERRED past the merge, 2026-09-16, owner. Row kept above, still open.**
The fourteen inaccessible Drive file references are decided after the merge.
The row already recorded that they do not block the dormant install; the owner
has now also taken them off the pre-merge path. Nothing else changes: no
replacement, deletion or link change is authorized, and the private decision
sheet stands.

**B10 RECORDED AS NOT BLOCKING the install or the merge, 2026-09-16, owner
decision, confirmed from code by this session. Row kept above, still open.**
The admission guard installs with `mode='open'` and is a pass-through at that
mode; closing is a separate explicit call that nothing in the install path
makes. See the progress entry for the two files and the exact lines.

The confirmation went further than the decision needed: **adding the table to
the guard list today would make step 14 refuse**, because the retirement trigger
contract compares the whole `aaa_application_dml_admission_%` trigger set
against a frozen blob and the install operator asserts it twice. So deferring
B10 is not merely safe, it is required. D12's ordering is unchanged, and B10
stays gated on B9 rather than on PG17 access — that access now exists in this
sandbox, which the 2026-09-16 note above assumed it did not.

**B9 RE-SIZED, 2026-09-16, still open. It is the long pole before the install
gate at step 13, not the thing that lifts the freeze — it lands on the branch,
not on main. Wording corrected 2026-09-16.**
Not a re-pin. The plan builder refuses any starting catalog that is not
byte-exact against the reviewed observed contract, and the hiring delta spans
six object classes, so it will not reverse the way the opt-out delta did. The
route is to derive and review a new observed catalog contract at the settled
state, then a new install target, then the operator's post-install table
constant. Runnable derivation and both routes:
[`LINEAR_EXIT_B9_CATALOG_REDERIVATION.md`](LINEAR_EXIT_B9_CATALOG_REDERIVATION.md).
B2 stays open behind it, unchanged.

**New, carried under B9 rather than as its own row, 2026-09-16.** The install
operator's hard-coded `GUARD_COUNT` of 90 public tables was derived from a
67-table live read, and the live database has gained one table. Derived from
code, not measured — step 8's receipt settles it. See the progress entry.

**B4 mechanical half PREPARED, not closed, 2026-09-16.** The dashboard check is
now a numbered click path in the sitting page, section 4, with what to write
down and what each outcome means. It is two minutes and changes nothing. It
stays open until the owner runs it, because no command can answer it. The
decision half was already made: no PITR, on cost, which is what makes steps 9
and 10 the recovery route rather than a spare — the sitting page now says that
where the drill is, not only here.

**B5 browser capture PREPARED, not closed, 2026-09-16. Row kept above.** The
capture block on the sitting page no longer carries written-down baselines to
go stale: it reads the expected hashes out of git at capture time, covers all
23 published files rather than the five that were listed, and moves bytes with
`git archive` and `tar` so it is binary-safe. The timing constraint is stated
where it bites and nowhere else — **immediately before the exit merge at step
17, and not before any other merge**, with the failure mode spelled out, which
is that a capture taken at any other moment still looks complete. Verified here
that the git side of the pipeline reproduces `1abdd1fa`'s `index.html` hash
exactly.

**B4 identity question CLOSED BY MEASUREMENT, 2026-09-16, owner's rehearsal.**
Live and the restored copy both report `system_identifier`
`7642734024280108049`. A Supabase restore preserves cluster identity, so the
installer's identity check survives a restore and the recovery route works on
this point. This supersedes the "supported but not observed" note below. What
remains unmeasured under B4 is only the restore's outage DURATION, which is
recorded as unknown by deliberate choice.

**B4 identity assumption UPGRADED, 2026-09-16, closure unchanged.** The
recovery route B4 closed on depends on the installer's identity check still
passing after a restore. Measured here: a physical restore preserves
`system_identifier`, a logical one cannot. All eight backups are marked
PHYSICAL, so the assumption is now supported rather than assumed. It is not yet
observed on this project; the approved rehearsal settles that. B4 stays closed
either way — this narrows a caveat, it does not reopen the blocker.

**B4 CLOSED, 2026-09-16, owner. Row kept above.** The managed restore route is
executable: eight daily PHYSICAL backups, newest 16 Sep 2026 11:19:55 +0000,
each with a Restore control present and enabled, checked read-only with nothing
clicked. Combined with the accepted-loss decision of 2026-09-15 (no PITR, on
cost, reconcile newer saves by hand), the mechanical and decision halves are
both settled.

**Recorded as part of the closure, not as a caveat to be dropped later:**

> The outage duration a real restore would cost is **UNKNOWN**. It cannot be
> measured without performing a restore, and performing one in place destroys
> the live database. No estimate has been written down, deliberately.
>
> Database backups **do not include Storage objects**, and restoring does not
> bring back deleted files. This is the platform's own statement on the Backups
> page. It is why the separate Storage custody capture exists, and it means a
> database restore returns a database whose Storage references are only as good
> as that separate package.

**Duration UPDATE, 2026-09-16, owner: an upper bound, NOT a measurement. The
note above is kept as written.** The approved restore-to-new-project rehearsal
was started at 09:38 local and the restored project answered a query at 09:50
local. **The restore therefore completed in at most 12 minutes.**

- **It is a ceiling.** The moment the database first became usable was never
  observed. It may have been ready several minutes earlier and simply waited
  until the owner ran the query. Do not record or quote "12 minutes" as a
  measured restore duration.
- **What it replaces:** "unknown" becomes **"under a quarter of an hour, upper
  bound"**. That excludes the hours-long outage that could not be ruled out
  before.
- **What would make it exact:** watch for the moment the restored database
  **first answers a query**, for example by polling a trivial read on a short
  interval from the moment the restore starts, rather than timing to whenever
  someone happens to try. The first successful answer is the measured
  duration.
- **What it does not cover, so it is not over-read.** The bound was taken on a
  **restore to a new project**. The recovery route is the **in-place** restore
  (D13). Both restore the same daily PHYSICAL backups, so a similar duration is
  plausible. But the in-place duration itself has not been observed and cannot
  be observed without destroying live. It is also one observation, of one
  backup, at the database's size on 2026-09-16.

A route to close the duration unknown at no risk is proposed, not adopted, in
[`LINEAR_EXIT_RESTORE_TO_NEW_PROJECT_PROPOSAL.md`](LINEAR_EXIT_RESTORE_TO_NEW_PROJECT_PROPOSAL.md).
It also names a question the recovery procedure currently assumes rather than
establishes: whether `system_identifier`, which the installer's identity check
is built on, survives a restore at all. The reviewed procedure is unchanged.

**B4 identity caveat CLOSED, 2026-09-16, by measurement. Row and notes kept
above.** The question left open, whether `system_identifier` survives a
restore, is answered **yes**, observed on this project. The approved
restore-to-new-project rehearsal read `7642734024280108049` on the restored
project, and live reads the same, cross-checked against three private reads
on 2026-09-14, 2026-09-15 and 2026-09-16. B4 was already closed; this removes
the one assumption its recovery route still carried. Two things are unchanged:
the restore duration is still recorded as **unknown**, and database backups
still exclude Storage objects. The rehearsal result names
`system_identifier` only, so the database OID is expected to survive by the
physical-copy rule but was not reported.

**Update, 2026-09-16, owner. The sentence above is kept as written.** The
database OID and the database name are now **measured**, not expected: the
restored project returned `database_oid = 5` and `current_database = postgres`,
equal to live, confirmed against three private reads. Three of the four
`IDENTITY_SQL` fields match across a restore by measurement. `session_user`
remains unmeasured. The route is unchanged: in-place restore (D13).

B4 and B5 are recorded here because a blocker list that omits known
prerequisites is worse than no list. They are the checkpoint's own words, not a
session's addition.

---

## 3. Decisions

The most valuable section. Each entry is a judgment call, its reasoning, and who
made it, so that a future session does not relitigate it or undo it unaware.

### D1 — Move preparation onto a main base (2026-09-13, owner after review)

#1382 conflicted. Rather than fight the conflicts on an old base, preparation
was rebuilt on a branch based on main and opened as #1391. Consequence a future
session must respect: #1391 is the live line of work; #1382 remains open but is
not current.

### D2 — Narrow three-field browser exception (2026-09-14, owner)

Exact missing-column compatibility for three planned native projection fields.
Deliberately narrow. Existing canonical reads stay in use and no authorization
is synthesized by it.

### D3 — Normal Slack alerts are preserved; only the one displayed Linear link goes (2026-09-14, owner correction)

This was a correction to an earlier understanding, which is why it is recorded
as its own decision. The migration does **not** touch normal notification
behavior. Exactly one n8n change is in scope for the entire migration: removing
the displayed Linear link from the legacy editor workflow, at step 22, requiring
its own separate go-ahead in the same session it happens. Every other workflow
stays untouched. No client Slack message is ever sent by this work.

### D4 — Scope is website decoupling; Linear itself is untouched (2026-09-14, owner)

The goal is that the website no longer depends on Linear. Linear's account,
billing, credentials, data and its own integrations are out of scope. **Actual
Linear retirement is not a later step of this plan** and would need a new,
separate owner decision with its own plan. Verified native receipts are kept,
never deleted.

A future session should read this as a hard boundary, not as a sequencing hint.

### D5 — Do not widen the catch-up helper's conflict allowlist (2026-09-15, session, endorsed by owner)

The helper resolves only three bookkeeping files. That narrowness is not a
limitation, it is the safety contract: because it only ever touches version pins
and independent log entries, a later step can verify its output byte for byte
before staging it. Teaching it to merge application code would have destroyed
the property that makes that verification meaningful, and the "rehearsal" would
then have been the machine blessing a merge it invented for itself.

The refusal was correct behavior and was left intact.

### D6 — For this one merge, the rehearsal receipt is replaced by owner review plus substitute proofs (2026-09-15, owner)

Because of D5, a receipt could not be produced: it requires exactly the three
known conflicts and there were five. So steps 4 and 6 as written were not
executable. Rather than weaken the helper, the owner substituted his own review
of the resolution diff plus named substitute proofs.

Scope limit, deliberately tight: **this catch-up only**. The helper is unchanged
and remains the mechanism for any future catch-up whose conflicts are its three
known files. Recorded as an amendment inside the execution map as well, so the
deviation is visible rather than silent.

### D7 — `index.html` resolved by keeping both sides' behavior (2026-09-15, session, reviewed and approved by owner)

Both sides had rewritten the same notice-priority ladder. The branch had
converted it from a suppression chain into an ordered list; main had added two
new notices as early returns. Both of main's became pushes at the rank main gave
them, with main's firing conditions unchanged.

The ranking was verified mechanically rather than by eye: the unmatched
saved-work-days notice sits above the metadata note, above the short-refresh
note and above the completeness note, which is what main's own comment demands.

One behavior change was flagged for explicit approval rather than slipped
through: under main that notice **silenced** everything below it; under the
merged ladder it leads and lesser notices are appended. That makes it harder to
bury, not easier, and it is the branch's deliberate design. The owner approved.

### D8 — The re-derivation rule for pins (2026-09-15, owner, sharpened mid-flight)

The first formulation was "did behavior change", and it was applied correctly
but turned out to be too blunt. The rule the owner settled on:

> The question is not *did behavior change*. It is **whose behavior, and did I
> approve it.** A behavior change originating in a merge resolution is a stop. A
> behavior change that is main's own shipped feature arriving through the
> catch-up is not, because it was approved when it merged.

And the test that separates the two acts:

> Confirming the guard's structural anchors still hold, understanding what
> changed and why, then updating the number, is **re-derivation**. Updating the
> number without that is **silencing**. Do the first, never the second.

Applied: before the two stored hashes moved, all four composition anchors were
confirmed to appear exactly once, and the changed region was confirmed not to be
one of them and not to interact with them.

Context worth preserving: a permission system blocked the first attempt to edit
those hashes, flagging it as possible removal of a security check. The session
stopped rather than routing around it, and agreed with the flag on the merits.
The owner later judged it a correct denial and lifted it explicitly. A future
session should expect that flag and should report it, not work around it.

### D9 — The intake test re-baseline was more than a number, and was flagged (2026-09-15, session, accepted by owner)

That test pins a **git commit**, not embedded text, and could not simply be
advanced: the old pin is a branch commit carrying the native-epoch work, frozen
main carries the opt-out and none of the native work, so no pre-existing commit
held both. The four-symbol check was re-anchored to the reviewed catch-up merge,
which is exactly both, while the longer history was left alone for the other
comparisons.

The owner's standing instruction, set here for all future deviations: **do it,
flag it, explain it in the file.** The comment left in the file is what makes it
reviewable later.

### D10 — Custody work is batched into one owner sitting, Storage first (2026-09-15, owner, order corrected by session)

Steps 1, 8, 9, 10 and 11 run in one sitting so the owner's time is spent once
and both custody jobs carry the same date. Storage runs first for the timing
reason in the progress log above.

### D11 — The Create Post picker deliberately ignores the auto-assign opt-out (2026-09-14 owner ruling, re-confirmed 2026-09-15)

An earlier draft ranked opted-out editors last in the picker, reasoning that the
dialog's suggestion should match the automatic pick. The owner rejected it: the
picker is a deliberate human choice and belongs to nobody's automation. That
half was reverted.

Re-confirmed on 2026-09-15 while checking a related risk, and worth stating
plainly so nobody "fixes" it later: the picker ignoring the flag is **correct
and intended**, not an oversight. It is also why the flag is withheld from the
public database roles, since the browser has no need to read it.

The related risk was checked at the same time and is clear: automatic
assignment routes through the same function on the native lane as on the legacy
one, and the helper that builds the native pool filters and sorts the same
objects without reshaping them, so the flag survives. **The opt-out does not
silently stop working when intake switches to native.** Nothing to record for
step 27.

---

### D12 — No catalog re-pin until the hiring migration is on main (2026-09-15, owner)

The live catalog no longer matches either reviewed profile, because of the
owner's own deliberate hiring migration. The owner ruled against adding or
re-deriving a profile now. The live database is ahead of main, and re-pinning
against it would mean doing it twice: once now, and again when the migration
merges after the freeze. The profile is re-derived **once**, against a settled
state, after the hiring change is on main.

Consequence: steps 8, 9 and 10 do not run until then. They are day-of work
anyway, so little is lost. A future session must not "fix" the catalog refusal
by adding the `ddfa4c4f…` hash as a third profile.

### D13 — Restore-to-new-project is NOT the recovery route; in-place restore remains it (2026-09-16, owner)

The rehearsal removed one objection to restore-to-new-project. Three of the
installer's four identity fields, `system_identifier`, `current_database` and
the database OID, survived the restore by measurement. So a restored project
does not fail the identity check for the reason the original evaluation gave.

**The decisive objection stands, and it is why the route is not adopted.** A
new project is a different reference, URL and set of keys. Nothing points at
it: not the browser configuration, the Edge functions, the scheduled workers or
the n8n workflows. A restore to a new project produces a healthy database that
nothing is talking to. **The outage is not over until every consumer is
repointed, or the data is migrated back, and that repointing has never been
rehearsed.** In the repointing case it is also a configuration change inside the
current freeze.

**In-place restore of the managed PHYSICAL backups remains the recovery route**,
as B4 closed on.

A future session must not read the identity measurement as having made
restore-to-new-project the preferred route. It removed one argument against it,
not the argument that decided it.

### D14 — What restore-to-new-project IS proven for: a restored copy beside live, to reconcile newer saves against (2026-09-16, owner)

**Recorded as its own decision because it improves one the owner already made,
and it must be findable.**

On 2026-09-15 the owner accepted a recovery position: no PITR, on cost, and
**accept the loss of newer saves and reconcile by hand**. Read plainly, a
reconcile "by hand" after an in-place restore meant reconstructing lost saves
from memory, messages and whatever else survived. The restore itself overwrote
the only database that held them.

**The rehearsal showed a better position is available.** In a real incident,
restore-to-new-project can produce a restored copy of a backup **beside** the
live database without touching live. That copy is a real, queryable source. So
reconciliation becomes a comparison against actual data, not a reconstruction
from memory.

This does **not** change the recovery route; that is D13. It changes how well
the accepted loss can be recovered from. It is a better position than the one
accepted on 2026-09-15, and the owner has named it as such.

What it is **not** proven for, so the claim stays exact: repointing any consumer
to the restored project, the time a restore to a new project takes during a
real incident, and any automated or rehearsed reconciliation procedure. Those
remain unrehearsed.

**Note, 2026-09-16. The entry above is kept as written.** The rehearsal did
bound one of those items: a restore to a new project completed in **at most 12
minutes**, an upper bound and not a measurement (see B4's duration update).
That was a rehearsal, not an incident. So "the time a restore to a new project
takes during a real incident" remains **not proven**; it is now bounded by one
rehearsal observation, not unknown.

## 4. Corrections the session made against itself

Kept as its own section because the owner asked for them explicitly, and because
a record that only contains things that went right teaches a future session
nothing.

### 2026-09-15 — The sitting session reported 7 of 28, and nearly called the hiring change confined

Two things from the Windows sitting.

The session printed "7 of 28" in its progress lines. The authoritative figure
is **6 of 28, about 21%**, per the entry above. Step 8 was in progress and does
not count. The owner caught it.

On the hiring drift, the first structural pass (one foreign key inside hiring,
dependency edges only to the language and the schema) invited the conclusion
"confined to hiring". Postgres does not record what a plpgsql body reads, so
that pass could not have seen the reads and row lock on `syncview_runtime_flags`,
which are in the bodies. Nor does it show the reverse direction, the
installation's own guard triggers on hiring tables. The owner required the
answer from code. The code showed it was not confined in either direction.

### 2026-09-15 — The pin sweep was wrong in kind, not just in count

A sweep was run for broken pins and reported as "three or four, finite". It
swept for stored hashes and pinned file lists. It did not sweep for **fixture
schema chains**, which pin the shape of a database rather than the bytes of a
file. A fifth item was then found only because CI ran suites the local run
skips.

The useful lesson is not "count again". It is that the sweep had a blind spot in
its categories, so no amount of re-running it would have found the fifth item.

### 2026-09-15 — "Four edits" was actually one

The fixture fix was quoted to the owner as four edits, one per failing chain. It
was one: all five suites route through the same shared cluster builder. The
scope was checked properly only after the number had already been given.

### 2026-09-15 — Twice a verdict was reached through reasoning that was never checked

Recorded as one lesson because the two failures are the same shape.

The first was **inverted**: `notify` having no deployment was called decisive
proof, without checking whether `notify` was ever supposed to be deployed.

The second was **too generous**: "ten of the twelve saw no changes to their own
source directories" was asserted from a command that had lumped each function's
directory together with `_shared`, so it never measured what was claimed. The
claim later turned out to be true when measured properly with
`ef-fingerprint`, which is luck, not method. A correct conclusion from an
unchecked method is still an unchecked method, and next time it lands the other
way.

Both checks were cheap. One `git ls-tree`, one correctly scoped command. Neither
was run before the conclusion was stated.

A third, in the same family, was structural rather than logical: the repository
was a **shallow clone**, so the history commands underpinning the second claim
were answering over truncated history. That was not discovered until a commit
reported having no parents.

The useful generalisation: before a fact becomes load-bearing, confirm the
command measured the thing named, and confirm the data source is complete.
Absence, aggregation and truncation each produce confident wrong answers.

### 2026-09-15 — A step 2 argument was built on a premise never checked against main

The worst of the session's errors, because it was not a miscount or a loose
description but a confident inference from a fact that meant the opposite of
what was claimed. `notify` having no live deployment was presented as decisive
proof, without first checking whether `notify` existed on main. It does not; it
is new code this branch adds.

The supervisor caught it. The lesson is narrow and worth keeping: when a missing
thing is about to become the load-bearing part of an argument, establish whether
it was ever supposed to be there. Absence has at least two causes and they point
in opposite directions.

Also corrected in the same pass: the live function count was reported as 37 and
is 36; and the current head was described as green while three of its checks
were still running. Both are small, but the second is the same species of error
as the first, which is asserting a state that had not actually been observed.

### 2026-09-15 — The intake test was described as pinning expected source text

It pins a git commit. The description was given to the owner before the file had
been read closely enough, and was corrected on contact with the actual code. See
D9.

---

Related: [living checkpoint](LINEAR_EXIT_PREPARATION_CHECKPOINT_20260914.md) ·
[execution map](LINEAR_EXIT_EXECUTION_MAP.md) ·
[owner sitting page](LINEAR_EXIT_OWNER_SITTING_20260915.md) ·
[recovery procedure](LINEAR_EXIT_RECOVERY_PROCEDURE.md)
