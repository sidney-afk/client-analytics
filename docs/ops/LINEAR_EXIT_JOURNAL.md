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

**B6 is withdrawn as reasoned, 2026-09-15.** Its row stays above per the append
rule. It asserted that C1 was unavailable *because* `notify` had no deployed
version. That reasoning was wrong: `notify` is new code that does not exist on
frozen main, so having no deployed version is expected. B7 replaces it on the
correct basis, and reaches a weaker and more honest conclusion: unproven rather
than unavailable.

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

## 4. Corrections the session made against itself

Kept as its own section because the owner asked for them explicitly, and because
a record that only contains things that went right teaches a future session
nothing.

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
