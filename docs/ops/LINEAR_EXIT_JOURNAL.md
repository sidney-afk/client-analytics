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

**B7 narrowed, 2026-09-15, row kept above.** It does not close to "C1
unavailable". Measured over full history, ten of the twelve closures are stable
across the deploy window and the two that moved were each deployed minutes after
the commit that changed them, making frozen main `0aa5954` the single leading
candidate for a commit matching all twelve. Still unproven: the evidence is
expected-side plus deploy timing, and does not observe what is running. One
authenticated `ef-fingerprint` live read confirms or refutes. B7 stays open with
that candidate named.

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

**B2 stays open, 2026-09-15.** Run 2 of the catalog read verified TLS and
identity, which clears the TLS half of the original row. The profile half now
fails for a new reason, B9. Not cleared.

**Note on the freeze, 2026-09-15, owner.** The freeze at `0aa5954` was defined
as a merge freeze. It did not cover live schema changes, and one was applied the
same day through a separate session. Freezing merges does not freeze the
database the plan was reviewed against. A future freeze for this work should
say whether it also freezes live DDL.

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
