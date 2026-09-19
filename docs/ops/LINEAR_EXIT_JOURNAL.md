Warning: truncated output (original token count: 182475)
Total output lines: 12953

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

### 2026-09-19 — step 29b inventory filed: every workflow and lane classified keep/retire/rewrite, nothing retired, per `docs/ops/LINEAR_EXIT_STEP29B_INVENTORY.md`.

### 2026-09-19 — the watcher's first live run was red, and it was right to be, about the wrong thing

Two things happened within the hour. The bridge trigger was **observed firing
correctly on six real editor changes between 00:50Z and 00:56Z** — the first
time it has been seen doing its job on genuine work rather than on a fixture,
which closes the open note the step-28 closures carried. And the watcher that
merged alongside it went red on its first live run.

Both are true and they are not in tension, which is the point worth writing
down.

The run (35411363894) reported 27 disagreeing slots. **25 of them last changed
between April and 2026-08-24.** The trigger was installed at 22:38:14Z on
2026-09-18. It fires on a CHANGE; it does not reconcile history and never
claimed to. So those 25 are not the bridge failing — they are the backlog that
already existed when the bridge was installed, which is precisely the thing the
bridge was built to stop growing.

Gating on them would have been a slow way to destroy the lane. A gate that is
red on day one for a backlog it cannot act on is a gate people learn to scroll
past, and then the two real slots underneath are invisible for the same reason
the drift was invisible before any of this existed. That is the same
crying-wolf failure the seven existing buckets were shaped to avoid; this was
simply an eighth case nobody had thought of, and the live estate found it in one
run.

**The fix is a `pre_bridge` bucket.** A disagreement whose deliverable last
moved before go-live is counted and LISTED — with its date, because the date is
the entire argument — and never gates. The gate now fires only on a deliverable
that moved at or after go-live. Clearing the backlog is
`production_native_calendar_status_backfill`, which owns that write, honours the
urgent-ping dedupe key, and **has still never been run** (OPEN_REPAIRS 212).

Three deliberate choices in it.

**The go-live timestamp is one named constant**, `BRIDGE_GO_LIVE`, with a
comment saying where the value comes from. It is the whole boundary between
"the bridge failed" and "the bridge was not there yet", and a second copy that
drifted from the first would move that boundary silently.

**A missing `status_at` counts as pre-bridge.** It cannot be shown to be at or
after go-live, and the conservative direction for a gate is to under-report: a
missed row is caught on the next hourly run, a false red teaches people to
ignore the lane. The backfill draws the same line the same way, with
`d.status_at is not null and d.status_at >= p_since`.

**The fixture sits one second either side of the cutoff**, so the assertion
tests the boundary rather than the neighbourhood. Both directions were planted
and seen to fail before this was accepted: removing the cutoff (everything
gates, five assertions fail) and moving it two days late (real drift gets
excused as backlog, five assertions fail). A cutoff is exactly the kind of
change that can be wrong in either direction while looking right in one.

The general lesson, which is the third time this repository has paid for a
version of it: a gate's first run against the real estate is the first time it
is actually tested. The fixtures were honest, the logic was right, and the
thing it met on day one was a category the fixtures had no reason to contain.

### 2026-09-18 — the reconciler could not see native writes, so nothing was measuring the bridge

The native calendar bridge trigger has been live since 22:38Z and it works. What
did not exist was anything that would notice if it stopped.

The obvious candidate is `scripts/linear-sync-reconcile.js`, which has compared
`calendar_posts` against the production cards on a 15-minute tick for months.
It cannot do this job, and the reason is worth writing down because it is the
same shape as the defect the bridge itself repairs: **the reconciler compares
the two surfaces through Linear.** It resolves the card's Linear link, reads the
state Linear holds, and decides direction from that. Native receipts send Linear
nothing. So since the ordinary-receipts flip the middle of that chain has been
empty — the reconciler reads a state that never moved, its provenance test
correctly refuses to write a stale value over live work, and it reports nothing
wrong. A card whose calendar copy is hours behind its deliverable is not
something the reconciler fails to fix; it is something the reconciler cannot
see. On 2026-09-18 that was ten lagging components across seven clients, and
what surfaced it was an SMM re-setting four cards by hand, not a monitor.

`scripts/card-calendar-status-drift-check.js` is the measurement, comparing the
two surfaces directly and never through Linear. Three things about it were
decided deliberately.

**It does not own a copy of the mapping.** `_calMapNativeStatusStrict` is
extracted verbatim out of `index.html` at load, exactly as the two reconcilers
take it. A private re-implementation would be a third copy of the table, and the
failure it would produce — calling a correct card drifted, or missing a real
one — is precisely the failure the report exists to catch.
`test/native-calendar-status-bridge.js` already pins that JS function to the SQL
`production_native_calendar_status_map`, so extracting the JS transitively binds
this to the SQL the trigger actually runs.

**Most of the work is in NOT reporting things.** Seven cases exist where the two
surfaces disagree and that is correct, because the trigger was never going to
write that slot: a non-calendar origin, an archived card, a status with no
calendar equivalent, a deliverable that does not point back at the card and
client the trigger joins on, a deliverable sitting in both slots of one card
(the trigger resolves it to video), and an id that did not read back. Each is
bucketed and counted, not called drift. A lane that went red on day one for
reasons nobody could act on would be turned off within a week, and then the
bridge would be unmeasured again with a green tick on top — which is worse than
unmeasured.

**The comparison is exact, not case-folded.** The trigger guards on
`p.video_status is distinct from v_target` against the raw column, so a card
holding `in progress` against an expected `In Progress` is a card the trigger
would still rewrite. A case-insensitive comparison here would report it clean
and quietly stop catching a whole class of drift. That is pinned by a fixture
card, and the assertion was seen to fail against a planted case-folded
comparison before it was accepted — as was the archived exclusion.

It is read-only with no apply path at all. Repairing a drifted card means
re-running `production_native_calendar_status_backfill`, which owns that write
and honours the urgent-ping dedupe key; a second writer of
`calendar_posts.video_status` is the last thing that surface needs.

Wired as `card-calendar-status-drift.yml`: hourly at :27, plus on push to `main`
so a change that breaks the check goes red there rather than reporting clean,
gated, and heartbeated as the `card_calendar_drift` watchdog lane. The lane was
registered in `scripts/monitoring-watchdog.js` **with** the workflow rather than
after an audit found it dark, which is how `production_shadow_audit` got there
and is a lesson this repository has already paid for twice.

One thing the owner has to do before this can pass: the lane requires a
repository secret `SUPABASE_URL`. It deliberately has no hard-coded project,
in the workflow or in the script — the other lanes carry the live project URL as
a literal, which is a public identifier for the production database in a public
repository and, more to the point, lets a misconfigured lane read the wrong
place silently instead of stopping. Until that secret is set the lane fails its
first step with a message saying exactly that.


### 2026-09-18 — the backfill was never callable, and the green fixture is the part worth remembering

The bridge migration applied live at 22:38Z. The trigger works. The storage
session then tried the backfill and it refused, every time, in dry-run as much
as in apply: SQLSTATE 21000, "DELETE requires a WHERE clause", before it read a
single row.

The cause is four words of SQL. The routine clears its two `on commit drop`
temp tables at entry so that a second call inside one transaction cannot see the
first call's rows, and it cleared them with a bare `delete from <table>;`.
Supabase loads the `safeupdate` guard for the role PostgREST connects as, and
that guard rejects any DELETE or UPDATE whose plan carries no qualifier. It does
not care that the table is a temporary one this routine created moments earlier
and is about to drop.

I fixed it with `truncate`, in a new dated migration, and did not touch the
applied one. `delete ... where true` was the obvious alternative and I turned it
down: the planner folds `where true` away before the guard inspects the plan, so
it is not reliably a qualifier at all — it would be a fix that depends on the
guard not constant-folding, which is exactly the sort of thing that changes
underneath you. `truncate` is not a DELETE, so the guard has nothing to say
about it.

**The lesson is not "check for bare deletes".** It is that a lane can be
honestly, completely green against code the real caller can never execute. All
38 disposable-PostgreSQL assertions passed, and they were right to: a plain
PostgreSQL 17 has no `safeupdate` loaded and no PostgREST in front of it, so the
statement is legal there. No assertion I could have added to that lane would
have caught this, because the difference is the connection, not the SQL. When a
fixture and the live caller differ in their *connection*, the fixture's verdict
is scoped to the SQL and says nothing about reachability — and I did not think
to ask which of those two things my green tick was about.

So the guard reads the committed bytes instead: `test/migration-bare-delete-lint.js`
walks every routine body in the repository, 362 of them, and refuses the
pattern. Running it over the repository as it stands found the two statements in
the bridge migration and nothing else, which answers the question the supervisor
asked — no other routine has this. It was seen to fail twice before being
accepted: once on a wrapped bare delete planted in the repair itself, once on
one planted in an unrelated routine, and it went green again on restore both
times. Its first draft also reported 19 lines across the repository that were
not defects at all (`on conflict … do update set`, `for update skip locked`, and
its own prose about the guard); anchoring the match to a statement start and
stripping comments fixed that, and I would rather record that the first draft
was wrong than present the second as if it arrived correct.

One ordering detail worth leaving here: the lint proves the repair installs
after the file it repairs by asking the install manifest's `dependency_order`,
not by comparing filenames. Both files carry today's date and the repair sorts
*before* the bridge alphabetically. Filename order was never what decided which
definition survives.

The preflight row for the backfill now cites the repair, because a routine is
pinned against the file that LAST defines it — pinning it to the bridge would be
telling the preflight to expect a body a working database must not hold. The
install inventory went to `_5` for the new candidate, with seven references
repointed; the journal's own older entry still says `_4`, correctly, because it
was true when it was written.

Separately: this script had the live project's REST origin as a `SUPABASE_URL`
default. The repository is public, so that published an identifier for the
production database — but the worse half is that it made the dangerous direction
the silent one. An unset or misspelled variable would have pointed a `--apply`
at production rather than refusing. It is now required with no default, and the
script was run as written from an unrelated directory to confirm it refuses on
the variable and not on a missing module. `linear-label-catalog-export.cli.js`
line 384 has the same fallback; it is recorded in OPEN_REPAIRS 213 and
deliberately left alone, because pulling an unrelated tool into a regression PR
is how it ends up shipped untested.

Still true and worth repeating: the already-lagging cards are still lagging. The
trigger only ever sees changes made after it exists, and the backfill has not
run once.

**Amendment, same evening.** CI failed the new lint file on its first run, on a
gate I did not know existed and could not have seen fail locally:
`test/comment-strip-is-honest.js` forbids stripping block comments with
`/\/\*[\s\S]*?\*\//g`, and my first draft used exactly that. The gate is right.
That regex opens a comment at ANY two characters "/" and "*" — inside a string,
a MIME type, a glob — and then runs to the next closer anywhere in the file;
about 64k characters of `index.html` were invisible to seventeen gates this way
(OPEN_REPAIRS 145), and negative assertions over the deleted region passed
vacuously. `test/helpers/strip-comments.js` is the sanctioned replacement and
the lint now uses it, handling SQL's `--` here because the helper knows `//`
and not `--`, and removing only whole-line ones for the same conservative
reason the helper gives.

The process lesson is the one I want the next session to have. **A brand new
test file is invisible to the repository's own meta-gates until it is staged**,
because several of them enumerate with `git ls-files`. My local `npm test` ran
while the file was untracked, reported the six known failures, and told me
nothing about this one. `git add` before the full run, not after it — otherwise
the suite is measuring the repository as it was, not as you are proposing it.
Both planted-drift failures were re-checked against the new stripper rather than
assumed to still hold.

### 2026-09-18 — Codex found the approval stamps, and the one thing I could not stage I wrote down instead of quietly dropping

Three findings on #1422, all three correct, all three addressed on the
supervisor's ruling.

**The P1 that matters most was a hole in my own reasoning, not in my code.**
The migration's header lists what the projection deliberately does not do, and
one of those lines — that it does not recompute the overall `status` roll-up,
because `computeOverallStatus` and `_calClearStaleApprovals` have no server-side
twin and inventing one is how two copies drift — reads as a careful boundary.
It was also the cover under which a real defect walked past. Those two functions
do different jobs. The roll-up is derived and a reload recomputes it. The
approval STAMPS are stored, and nothing recomputes them: a component regressing
`approved` → `tweak` left `client_video_approved_at` and possibly
`kasper_approved_at` populated, so the card read "Tweaks Needed" while still
carrying a client's sign-off, and would have gone on reading that way.

The lesson is narrow and worth keeping: **a sentence saying "I am not copying
that logic" is a decision about one function, and it does not extend to every
function named in the same breath.** I had bundled two and reasoned about one.

The fix mirrors the page's rule for the component that regressed only — the
other components' stamps were stale before this change too, and repairing them
here would be this projection making a change nothing asked of it.

**The mapping-drift guard needed a second half, and it turned out to be a
provable claim rather than an assumption.** The page tests
`_calNormStatus(status)` against {Client Approval, Approved, Scheduled, Posted};
the SQL tests a case-folded literal set. Those are only the same thing if the
normaliser can never produce one of those four from a value that does not
already spell it — true, because its other branches produce `In Progress`,
`Kasper Approval` or `For SMM Approval`. Stated that way it is an argument; so
it is executed instead, over 23 spellings including the legacy ones the
normaliser rewrites, and seen to fail on a planted one-character drift before
being accepted.

**And the one I could not prove.** The P2 race fix re-reads the deliverable in
the same statement as the apply and proceeds only while the deliverable version,
the freshly derived target and the card's own value all still match the scan.
The interleaving that makes those clauses matter — another session committing
between the scan statement and the apply statement — is not stageable from a
single-session fixture: both run inside one call, and a trigger firing during
the apply is part of the same command, so it cannot change what that command
sees. Tried three ways (a statement-level writer on the card, one on the
deliverable, a hand-seeded stale scope) and none of them is the thing.

So the clauses are pinned structurally and the consequence a stale apply would
break — `applied` read back per row from what the UPDATE returned, and the
events rows written from that same set — is measured. **This is written in the
test file, the PR and here rather than left as a green tick**, because
"32 assertions passed" would otherwise carry an implied claim the suite does not
make. That is the composite-claim rule applied to my own evidence: read from the
code, or assumed about the platform, labelled separately.

**Third finding, the cheap one:** the backfill's usage block used a bare
`node scripts/…`, which only works from the repository root. Now absolute, via
`$env:USERPROFILE`, and executed as written from an unrelated directory before
being handed over — it refuses on the missing key, never on a missing module.

### 2026-09-18 — The flip cut the calendar's only supply of production statuses, and the question that decided the fix was what the reconciler's ledger expects

Priority regression, reported the same day the ordinary receipts went native.

An editor changes a status on a production card. That status has always reached
the content calendar by exactly one route: the write lands in `deliverables`,
the outbound mirror carries it to Linear, and the reconciler pulls it back onto
the card. Native receipts send nothing to Linear. The reconciler still runs and
is still correct — it resolves the link, gets the stale Linear state it has
always had, and its own provenance test refuses to write it, which is the right
answer to the wrong question. Nothing else had ever written the calendar's copy,
so nothing did.

Measured: four video cards to `smm_approval` between 19:12Z and 19:25Z, calendar
still reading "Tweaks Needed" at 20:20Z when the SMM re-set them by hand; ten
lagging components across seven clients at 20:44Z, oldest since 17:34Z. Changes
made FROM the calendar were never affected — they write both copies.

**Trigger or gateway was decided by one question, and it was not a taste
question.** The reconciler's most-recent-wins ledger reads
`calendar_posts.video_status_at` / `graphic_status_at` as the EXACT moment the
card changed, and the column exists because of GRA-6339: a card whose stamp did
not move when the card really changed looks OLDER than Linear, and the
reconciler then pulls a stale Linear value over live work. So the ledger's
standing expectation of that column is that it moves in the same transaction as
the authoritative change, on every write path. A gateway projection is a second
step — skippable, failable, and only present in a deployed version of one
function — and `production-write` is not the only writer of
`deliverables.status`. The gateway can satisfy the feature; it cannot satisfy
the ledger. That is the whole argument, and it is recorded in the migration's
own header rather than only here.

The precedent is the 2026-09-10 Kasper ping ledger, which chose a trigger over
an edge-function change for a ledger row and wrote down why. One thing is
deliberately NOT copied from it: that trigger swallows every error, because a
missing ledger row is never worth a failed client save. This one does not. A
silently skipped projection is precisely the invisible lag being repaired, and
a projection that fails should fail the write that caused it, where someone can
see it.

**The duplicate-notification trap was one level down from where I first looked.**
The obvious candidate is the client-channel status intent — and it is a trigger
on `deliverable_events` keyed on `source='ui'`, which a write to `calendar_posts`
cannot reach. Easy, and not the risk.

The real one is that `calendar_posts.video_status_at` **is** the urgent editor
ping's deduplication key. `production_notification_enqueue_urgent` builds
`intent_key = 'urgent:' || sha256(deliverable_id || '|' || video_status_at)` and
relies on `on conflict (intent_key) do nothing` to make a repeat ping a no-op.
So re-stamping that column without a card-visible change mints a NEW key and
lets one tweak be pinged to the editor twice. Nothing about the column's name
says "notification"; it is a timestamp, and it was read as one until the enqueue
body was read.

The guard is that every write is predicated on the MAPPED calendar value
differing from what the card already holds, which makes a no-op projection, a
native move between two statuses mapping to the same calendar value, the four
cards the SMM already corrected by hand, and a second backfill run all write
zero rows. And the assertion is made in the units that decide it — the `sha256`
key recomputed exactly as the enqueue builds it — rather than on the timestamp,
because "the stamp did not move" and "no second Slack message is possible" are
different claims and only the second one matters.

A repair falls out of the same reading: `urgentSnapshot` requires the card to
read `Tweaks Needed`, so the urgent ping has been unreachable on
natively-changed cards since the flip. It works again.

**The second copy of the mapping is the standing risk, and it is guarded rather
than promised.** `_calMapNativeStatusStrict` in `index.html` is canonical, and
the reconciler extracts it at runtime precisely so a copy cannot drift. A SQL
trigger cannot call it, so this ships a second copy. The suite executes the
page's function, parses the migration's `case` arms out of the SQL, and compares
them over every value the `deliverables.status` CHECK constraint allows, in both
origins — 90 pairs. Seen to fail on a planted one-character drift before being
accepted, per the rule that a test written after a fix proves nothing until it
has been seen to fail without it. The PostgreSQL lane's 32 assertions each carry
the decisive input flipped, including a CONTROL that drops the trigger and
reproduces the reported regression, and the `ROLLBACK.md` inverse rehearsed
inside the lane so it re-runs rather than being a dated claim.

**Two knock-ons worth naming rather than discovering later.**

- The five new preflight keys take the Linear-exit deploy preflight from **161**
  to **166** expected objects. Measured with the shipped code's own
  `expectedObjects().keys.length` on `main` and on this branch, not counted by
  hand — and worth saying plainly that the widely-quoted **156** is a figure
  from the 2026-09-17 run and has been stale since; four migrations have added
  rows between then and now. It has never been run against the hosted database
  with these rows, and per the standing rule a gate that has never run against
  its real target is untested: run the read-only preflight from the owner's
  machine BEFORE the next dispatch, not for the first time inside one.
- The install source inventory had to be re-issued as
  `LINEAR_EXIT_INSTALL_SOURCE_INVENTORY_20260918_4.json`, because `plan()`
  verifies it against `build()` by strict equality and seven files point at the
  dated name. The frozen 2026-09-10 base still verifies, since `verifyFrozen`
  tolerates new owners and nothing existing moved.

Opened as a PR. Not merged, not deployed, and the migration is not applied.

### 2026-09-18 — A native card has no identifier, and the Production row showed the raw id

Not a Linear-exit task, found by one. The layout gate went red on rows nothing
had changed, and the cause is a direct consequence of native intake: a provider
card carries a 9-character Linear identifier, a natively created card has none
yet, and `_prodIssueLabel` falls all the way through to the raw 40-character
deliverable id. Every card created after 13:35Z that day was native.

`.prod-id` declared `width: 76px` and no truncation at all, so the id wrapped
and the cell grew taller than its 44px row. Fixed with `nowrap`, `overflow` and
an ellipsis, plus one render helper carrying the full value on the hover.

**The proper fix is the identifier mint capability**, which is exit work: a
native card should carry a short identifier of its own rather than display a raw
id. Recorded here so the stopgap does not become the answer by default. Named in
the CSS comment, `WIRED-PARITY.md`, `EXECUTION_LOG.md` and the `ROLLBACK.md` row
as well.

**Two wrong explanations on the way, both caught by measurement rather than
review.** First, the clipping cell was said to be the client chip; a fix shipped
at it and the lane came back red on the identical assertion id, because that id
named the containment *sweep* and the sweep checks six cells. Second, the escape
was said to be sideways, on a flex item's min-content width; the test printed a
NEGATIVE right-edge overhang, which cannot happen if something hangs off the
right, and measuring it showed the cell escapes top and bottom because a
hyphenated id wraps.

The gate's assertion ids now name the cell, not the sweep — 24 literals across
the four containment sweeps. Both wrong explanations survived exactly as long as
the instrumentation was coarser than the question being asked, which is the same
lesson this journal keeps recording at smaller and smaller scales.

### 2026-09-18 — Check 6b is measured, the clause named a code it never reaches, and labels is through phase 7

Supervisor ruling, after the correction below. Placed above it because this is
the state a reader should carry away; the correction stays because the reason
for it does.

**The clause named the wrong code.** Check 6b read *"A role outside `admin|smm`
→ `native_label_scope_forbidden`."* Two guards can stop that write and the role
never reaches the second. The policy table refuses first at
`index.ts:5924-5931` — `staffOperationAllowed` returns false for
`(creative, labels)` and the gateway throws **403 `operation_forbidden`**. The
guard emitting `native_label_scope_forbidden` at 6425-6427 gates on the
principal's **kind** and on `legacy_parity`, not on the role, so a creative is
already refused before it is reached. Ruled: the clause is about the outcome,
either code satisfies it, and the wording is amended. Worth recording that a
requirement naming only the unreachable code would have held the capability open
on a defect in the sentence rather than in the system.

**Measured offline, with a control.** Five assertions execute the policy guard's
real bytes against the real `policy.mjs`: a creative is refused 403
`operation_forbidden`; admin and smm still reach the write, so it refuses the
role and not the operation; the same creative still reaches `comment`. The fifth
is the one that makes the rest mean anything — flipping `staffOperationAllowed`
to return true lets the creative through, so the refusal **is** the policy row
and not a missing team or a botched extraction.

**And the extraction nearly lied.** The first attempt anchored on
`if (principal.kind === "staff"`, which appears **five times** in that file. It
sliced the wrong guard and two of the five assertions passed against it anyway.
The anchor is now the unique `staffOperationAllowed(...)` call. The paired
assertions are the only reason this was caught within the minute rather than
committed: a test that passes while measuring the wrong thing is this
workstream's recurring failure, and it has now appeared at the level of the
capability, the check, the clause and the string anchor. The pairing habit —
always assert the negative case beside the positive, and flip the input that is
supposed to be decisive — catches it at every level, which the rules did not.

Step 27 complete on all seven checks. Step 28 restored from withdrawn; the
withdrawal and the restoration both stay in the checkpoint.

### 2026-09-18 — CORRECTION: labels is NOT through phase 7. Check 6 has three refusals and two were measured

Placed above the entry it corrects, because that entry's claim is the thing a
reader must not carry away. Established by a Codex P1 on #1420, verified against
the acceptance text before anything was written.

**Check 6 reads:** *"A `client` principal → 403. A role outside `admin|smm` →
`native_label_scope_forbidden`. A stale `catalog_version` from an old tab → 409
`native_label_catalog_changed`."* Three refusals. The evidence covered the first
and the third. The second was never run.

Worse than the gap is how it was produced. The instruction described a "403 half"
and a "409 half", and that framing was adopted without opening the acceptance
text four hundred lines down **in the file being edited**. A two-part check was
invented and then reported as complete. Step 28 was recorded on top of it.

**Eighth instance of the shape, and the first committed inside the document
written to stop it.** The rule the seventh produced — *when a step has
enumerated acceptance checks, report per check, never in aggregate* — was obeyed
at the level of the check number and abandoned one level down, which is the same
failure at smaller scale. The rule is replaced, not supplemented:

> **Re-read the acceptance text for every check being closed, in the run that
> closes it. A check with sub-clauses is not closed until each clause is named
> and answered separately. An instruction that describes a check is not the
> check.**

**The nearest existing evidence is another near miss.**
`test/native-label-seed-parity-postgres.js` asserts
`native_label_scope_forbidden` five times, and every one is about the
`test_only` / `auth_kind` binding, not a staff role. Same code, different cause.
Citing it would have repeated the mistake one layer deeper.

**And the check may name the wrong code.** The guard emitting
`native_label_scope_forbidden` (`index.ts:6425-6427`) gates on the principal's
kind and on `legacy_parity`, not on the staff role; the `admin|smm` restriction
lives in the policy table and refuses with `operation_forbidden`. Whether the
contract's wording is wrong or a path was not found is not this session's call
and is recorded as a question, not a finding.

Step 27 is back to IN PROGRESS. The step 28 closure is marked **withdrawn** in
the checkpoint's dependency table rather than deleted.

### 2026-09-18 — Labels is through phase 7, and the one check this session could measure had no test at all

Step 27 closed on evidence from three sources. Checks 1, 3 and 5 are the owner's
and the supervisor's. Checks 4, 6-409 and 7-graphics are the storage session's —
receipt **10579** and journal **`edf78a6a`** for the first two, receipts **10575**
and **10576** for graphics. That journal is not reachable from this repository at
the time of writing, so this session has **not read it** and records those three
as reported, not as measured here. Said plainly in the procedure, the map and the
closure, because "all seven checks passed" is the aggregate claim this same
capability already produced once and had to withdraw.

**Check 4 passed without contradicting the constraint.** The replay shortcut
excludes `principal.testOnly`, which is a property of the credential, not of the
card's owner. The storage session ran it on the test *card*, not as the test
*client*. The constraint stands and stays in the file.

**The 403 half of check 6 had no test, and three near misses looked like one.**
Check 6 needs a client principal refused a labels write. What existed:
`handleLabelsRead` (the read, not the write); a regex on the write guard's
condition buried in an unrelated `brief`-leakage assertion, never naming the
status; and the auth matrix's `labels: false` client row, which exercises
`clientOperationAllowed` — **a function the labels write path never calls.** The
write is refused earlier and unconditionally at `index.ts:5932-5935`. So a green
suite was never evidence about this gate, and citing any of those three would
have been the same error shape as the step 27 overclaim: a true statement about
what a test measures, offered as an answer to a different question.

Five assertions added to `test/production-write-gateway.js` that **execute the
guard's real bytes** in a sandbox rather than matching them, anchored on the
exact source text so a reworded guard fails loudly. Confirmed to fail when the
guard's condition is defeated.

**Step 28 is recorded with its limits.** The provider branch is switched off,
not removed: `mode:"provider"` is still selectable because the kill switch
`mode:"hold"` shares the same flag. So "unreachable" means no supported label
operation reaches it while the capability is native — not that the path is gone.
And the dependency row it acts on also covers metadata, credential reads, intake
and assignment. Labels closes none of those; the row stays open.

### 2026-09-18 — The browser refused the test client's own native cards, and the test suite said it was fine

Owner-reported. Every card of the test client showed the "project needs
attribution" banner with the comment box and the write controls locked, months
after the server started accepting that client (#1414).

The cause is one hard-coded string. `_prodResolveAttributions` proves a
persisted native-intake stamp before it will trust it, and that proof demanded
`persisted.owner_kind === 'client'`. The gateway writes that field as the
roster row's own kind — `lower(client.kind || "client")` in
`production-write/index.ts` — so a `kind: 'test'` client is stamped `'test'`,
the proof failed, and the row fell through to `needs_attribution`. The same
function's **explicit** branch never had this bug: it reads the roster kind and
requires the persisted value to equal it. The native branch now does the same,
and carries that kind into the resolved attribution instead of rewriting it to
`'client'`.

Two things worth recording beyond the fix.

**The roster lookups were never the problem.** `activeBySlug`,
`nativeProjectOwners`, `nativeLegacyProjectOwners` and the batch-parent map all
gate on `active === true` alone and carry `kind` through untouched. Checked
because the owner asked; no change was needed, and none was made.

**`test/native-intake-attribution-ownership.js` passed throughout.** Its only
client fixture is `kind: 'client'`, so the suite could not have caught this and
a green run was never evidence about it. Six assertions were added and were
confirmed to FAIL on the pre-fix file with exactly the reported symptom
(`needs_attribution` where `resolved` was expected) before being accepted as
passing. A test written after a fix proves nothing until it has been seen to
fail without it.

`'internal'` is deliberately still refused. Nothing has measured that kind end
to end, and this change is not the place to find out.

Gates: `prod-write-gateway-browser` passed. `prod-boot-budget` fails here on a
WebSocket handshake to the live realtime endpoint and fails identically on the
unmodified tree, so it is the sandbox, not this change.

### 2026-09-18 — Labels are NATIVE. Three of the four step 26 blockers dissolved, and two of them were never real

Cloud session, correcting documents after the fact. **This session did not run
any of it** — the owner flipped the flag and measured; what follows is recorded
from that report plus repository reading.

| | |
|---|---|
| capability | `native` since **2026-09-18T20:02:56Z** |
| catalog version | `f55a7dd2` |
| deployed at | `b7c30c74`, `production-write` **v77** |
| step 27 | **in progress** — 4 of 7 checks measured (corrected below) |
| kill switch | `mode:"hold"` |

#### The two blockers that were never real, and they failed the same way

**B-1 said the capture could no longer be taken.** Three documents agreed that
Linear access ended on 2026-09-15 — the runbook's status line, OPEN_REPAIRS 170,
and `OPEN_REPAIRS.md:15275`. All three were **predictions written in advance**.
A date that was *planned for* was read back as a date that *happened*. Gate 0
existed to measure exactly this, and when it finally ran, Linear answered.

**B-4 said native cards would still show "Labels unavailable".** The supporting
sentence — *"nothing in any migration seeds the empty relation"* — was true. The
conclusion, *"nothing seeds it"*, was false: the gateway stamps it at
`handleIntakeCreate` (`index.ts:7705`) and `handleComponentFill`
(`index.ts:7081`). One layer searched, a whole-system claim drawn from it.

**These are the same error.** Both asserted a fact about the running system from
a source that could not establish it — a document written in advance, and a
grep over one directory. Neither was careless about its own evidence; both were
careless about what that evidence *covered*. Recorded as the fifth and sixth
instances of this shape in this journal.

The rule, sharpened: **before a claim about the running system becomes
load-bearing, name what measured it.** If the answer is "a document" or "one
directory", it has not been measured. Where a cheap live gate exists, run it
first — reasoning from the record is the expensive path and it was wrong twice.

#### B-3 was real, and its fix taught something separate

The label lane genuinely refused the test client in all three layers. #1414
fixed it; Codex then found the parity was still unreachable through the real
gateway, because `eventFor` emits `auth_kind: principal.kind` and the SQL still
demanded `'staff'`. Every rehearsal that "passed" had hand-built an `auth_kind`
the gateway cannot send. **A rehearsal that constructs its own input proves the
SQL, not the path.**

#### The readback result most likely to be misread later

Labels are served **per team**: video **2**, graphics **6**. Not 27
workspace-wide, which is what "46 labels, 19 retired" invites you to expect.
`production_label_catalog_read_version` excludes a label for four independent
reasons — group, archived, retired, or belonging to the other team — and only a
label with `team: null` reaches both teams. **The catalog count and the served
count answer different questions.** A small served number is the filter working,
not a partial capture, and the capture must stay whole or it fails its own
count check.

#### CORRECTION, same day — I recorded step 27 as passed, and 4 of its 7 checks were measured

Codex raised this as a P1 on #1418 and the supervisor confirmed it. The entry
above originally said step 27 **passed**, on receipts 10536 and 10537. **Those
two receipts prove check 2.** They say nothing about the other six.

| # | State |
|---|---|
| 1 read, both teams | ✅ seen by the owner |
| 2 write + receipt | ✅ receipts 10536, 10537 |
| 3 row changed | ✅ `labelIds` and `labels.nodes` agree, `hasNextPage` false, updated 20:08:02Z |
| 4 replay idempotent | ❌ not run |
| 5 debt conserved | ✅ labels debt 0 before and after, no row touched |
| 6 refusals fire | ❌ not run |
| 7 both teams | ⚠️ video only |

**And check 4 cannot be run the way the resolved B-3 invites.** The
accepted-receipt replay shortcut is gated on
`principal.kind === "staff" && ! principal.testOnly` (`index.ts:5977-5978`), so
a test-client replay never reaches it and falls through to a generic response
carrying none of `replayed`, `read_only` or `authority_source`. Running check 4
as `sidneylaruel` fails it for a reason unrelated to idempotency. So the test
client can exercise the label **write** lane — which is what #1414 was for — and
**cannot** exercise replay. My note that check 7 no longer needed a named real
client was wrong on the same point and is withdrawn.

**This is the same error shape again, and that is the seventh instance.** "The
flag is on and writes are landing" was turned into "step 27 passed" without
enumerating what step 27 actually requires. The receipts were real; the scope of
what they evidenced was assumed. A checklist is not passed because its most
visible item is.

The narrow rule to carry: **when a step has enumerated acceptance checks, report
per check, never in aggregate.** An aggregate verdict hides which ones nobody
ran — here, two of seven, plus half of a third.

Two further overclaims in the same PR, both also correct findings:

- I wrote that `verify --package` proves the staged version landed. It does
  not: `runVerify` reads three local files and never connects to Postgres.
  Landing proof is the database readback of the version id, taken at 19:45Z.
- I described the catalog query as the exact **seven**-field contract. It is
  **eight** — `retiredAt` joined it on 2026-09-18, which is the whole reason a
  pre-2026-09-18 package is refused. Following the row as written would have
  produced a refused package.

#### Still open

- **Step 27 checks 4 and 6, and check 7 on graphics.** Check 4 needs a staff
  principal on a real card — not the test client, per the correction above.
- Execution map **step 28** for labels: record the website dependency this
  closes, the accepted replacement, and evidence the legacy route is
  unreachable. **Not reachable until step 27 is actually finished.**
- `_prodLabelErrorText` has no branch for `native_label_state_incomplete`, so
  the 9 backfilled cards with no Linear issue show a tooltip naming Linear.
  Cosmetic, and the only known rough edge left.
- Any capture package taken before 2026-09-18 must be retaken before it can be
  attested — `check_manifest` now requires `retiredAt` on every label.

### 2026-09-18 — PR #1415 is green on all six checks, and the unit lane could never have caught the one that went red

Cloud session. Head `74e08f23`, six of six checks `success`: `unit`,
`identity-exposure`, `f27-team-rollback-proof`, `Edge Function type ratchet`,
`Isolated PG17 retirement-switch`, `Isolated PG17 card-atomic-admission`.
`mergeable_state: clean`, no merge conflict, one review thread and it is
resolved. Not merged — the supervisor merges.

#### The failure that mattered, and why the local lane said nothing

`Isolated PG17 retirement-switch` went red while the local full unit lane was
reporting **560 of 560 passed, runner exit 0**. Those two facts are compatible,
and the runner says so in its own summary line:

```
All 560 classified unit suites passed; 61 required profiles NOT_RUN in this lane
```

**Sixty-one required profiles are not covered by a green unit run.** The two
PG17 lanes are among them. So "the full lane passed" is a claim about 560
suites, not about the checks that gate the PR, and reading it as the latter is
the same shape of error this journal keeps recording: a claim about the system
drawn from a measurement that did not measure it.

The cause was mundane once reproduced — `test/linear-exit-retirement-switch-postgres.js`
carries its **own** label fixture, and that fixture predates `retiredAt`, so the
newly strict `projectLabel` refused it. The CI container log pointed at
`retirement_dependency_contract:production_assignment_epoch`, which is not where
the fault was; the real line only appears in the lane's private error log:

```
ManifestError: label_catalog_label_invalid: label.retiredAt absent from the provider response
    at projectLabel (scripts/linear-label-catalog-export.js:261:13)
    at Object.buildManifest (scripts/linear-label-catalog-export.js:278:39)
    at test/linear-exit-retirement-switch-postgres.js:29:75
```

Reproduced locally on a PostgreSQL 17 cluster on port 5433, using the lane's
real command line and `PROOF_OUTPUT_ROOT`, then fixed in place. The fixture edit
had to preserve the byte-pin: `retiredAt: null` went **inside** an existing
line, keeping CRLF 62 / LF 68.

#### The rule this leaves behind

**Run both PG17 lanes locally before pushing anything that touches a migration
or the export library.** A green unit lane is not evidence about them, and the
CI summary line for a red PG17 lane can name the wrong contract — read the
private error log, not the container log.

### 2026-09-18 — CORRECTION: the label seed's premise was wrong. Native intake DOES stamp the empty relation, in the gateway, and I searched only the SQL

Cloud session. The migration is merged and applied; the correction is a comment
block on its header and this entry. No SQL changed, and that is measured rather
than asserted: both routine bodies and the whole comment-stripped file are
byte-identical across the edit.

#### What I claimed, and what is true

The finding behind `migrations/2026-09-18-native-label-empty-state-seed.sql`
(PR #1414, and B-4 in the step 26 procedure) said a natively created card
carries **no** `linear_raw -> issue -> labels` relation, so turning the label
capability on would still render "Labels unavailable".

**It does carry one.** The stamp is in the gateway:

| site | when |
|---|---|
| `handleIntakeCreate` — `production-write/index.ts:7705` | the team's native epoch is set |
| `handleComponentFill` — `production-write/index.ts:7081` | the team's native epoch is set |

Both write
`linear_raw.issue = {"labelIds":[],"labels":{"nodes":[],"pageInfo":{"hasNextPage":false,"endCursor":null}}}`
— **exactly the shape the migration seeds**. The 7081 site says so in its own
comment: *"A newly created native component has a known empty label selection.
Do not apply this to existing or provider-era rows with unknown state."* Which
is, almost word for word, the rule the migration re-derived from scratch.

#### The measurement

Every native-intake card already carried the complete relation. The backfill
touched **9 rows, none of them from native intake**: 6 provider-era real cards
from 2026-09-15 and 3 old test cards — rows that lack a Linear issue for other
reasons.

The owner applied it anyway, and that decision is right on its own terms: the
deploy gate pins the file, and "no labels" is a truthful statement about a card
that has no issue. So the 9 rows are correctly seeded and the trigger stays
correct and cheap for exactly that population. It is simply not the population
the migration predicted, and the header no longer claims otherwise.

#### The actual mistake, which is not "a missing grep"

The search was `grep hasNextPage migrations/*.sql`. It returned only readers and
the writer's own output, and I reported that as **"nothing in any migration
seeds one"** — which was true — and then concluded **"nothing seeds one"**,
which does not follow. The stamp is TypeScript. One layer was searched and a
claim about the system was drawn from it.

What makes this worth a journal entry rather than a shrug is that the same
session had already been bitten by the same shape twice in a day, and said so
both times:

- the rehearsal that hand-built `auth_kind: 'staff'` and proved a path the
  gateway cannot take (Codex P1 on #1414);
- `production_assignment_context` reported as gating on `auth_kind` when the
  evidence was an `awk` range spanning two functions.

All three are the same error: **a claim about the running system taken from one
layer, or from a command that did not measure what the claim says.** CLAUDE.md
already carries the general form — *"a gate that has never run against its real
target is untested"* — and the 2026-09-15 entries carry it too. The specific
form worth adding is narrower:

> **Before asserting that nothing does X, name the layers where X could live and
> say which ones were searched.** For this repository that is at least:
> `migrations/*.sql`, `supabase/migrations/*.sql`, `supabase/functions/**`, and
> `index.html`. A negative over one of them is a negative over one of them.

#### What does NOT change

The seed migration's behaviour, its trigger, its refusals and its ACLs all stand
— the 9 rows needed it. `production_labels_write` still requires a complete
relation, so a card that lacks one still cannot have its labels changed
natively; that part of the original reasoning was never in question. And the
step 26 procedure on `prep/step26-native-labels-20260918` still states B-4 as
originally found; whoever merges that branch should carry this correction into
it.
### 2026-09-18 — Step 26 procedure for the native label catalog, and the FOUR reasons it cannot be run as written today

Cloud session, reading only. No SQL was issued, no Linear request was made, no
flag was read live, nothing was deployed. The procedure is
[LINEAR_EXIT_STEP26_NATIVE_LABELS.md](LINEAR_EXIT_STEP26_NATIVE_LABELS.md).

The ask was for the step 26 procedure: what the capture must contain, the exact
SQL that installs a version, the exact on value and rollback, and what "Labels
unavailable" becomes. All four are in the document. What is worth recording here
is that the exporter and the runbook **already existed** — `scripts/linear-label-catalog-export.js`,
its `.cli.js`, and `docs/ops/NATIVE_LABEL_CATALOG_CAPTURE.md` — so the procedure
is a layer on top of them, not a rewrite of them. The first draft instinct was to
specify the GraphQL by hand; the repository had it, with an offline fixture
rehearsal and a test that re-reads every bound out of the two migrations. This is
the same lesson as the F27 capture script in `CLAUDE.md`: look for the tool
before writing the instructions.

#### B-1. The capture window closed on 2026-09-15 and the capture was never taken

`NATIVE_LABEL_CATALOG_CAPTURE.md` still opens "Status: SOURCE ONLY. The capture
has NOT been taken." OPEN_REPAIRS 170 agrees. `OPEN_REPAIRS.md:15275` says of the
15th: "that date ends our Linear **access**". Today is the 18th.

**Stated as a question, not a conclusion.** A session cannot tell whether
`api.linear.app` still answers for this workspace, and the repository's statement
is a plan, not a measurement. The procedure opens with a Gate 0 that settles it
for free: the exporter resolves the organization and both team ids before it
captures anything, so a lapsed credential fails on the first request. If Gate 0
is green that run **is** the capture; if it is red, step 26 for this capability
cannot complete and step 28's honest entry is "no accepted replacement".

#### B-2. There is no in-database substitute, and that is deliberate

The obvious fallback is to build a manifest from the label nodes already in
`deliverables.linear_raw`. It is ruled out in writing: the foundation record says
"A selected-label union is never treated as a catalog", and attestation item 4
requires the owner to assert the manifest is the whole workspace. A
self-consistent truncated file passes every structural check the SQL performs —
which is exactly why the human assertion exists and why synthesising one is a
false attestation rather than a shortcut.

#### B-3. The label lane refuses the test client — the same defect #1413 just fixed twice

Found by reading, not by running. All three layers refuse `test_only`:

| Layer | Refusal |
|---|---|
| `2026-09-06-native-label-writes.sql:132` | `production_labels_write` requires `v_out->'test_only'` to be exactly `false` |
| `2026-09-06-native-label-writes.sql:101` | the receipt guard refuses `new.test_only is distinct from false` |
| `production-write/index.ts:6403` | the gateway refuses `principal.testOnly` with 403 |

So step 27 has **no TEST lane at all**, and the first native label write that can
ever succeed is on a real client — colliding with "Mutate only the test client
`sidneylaruel`". #1413 fixed precisely this shape for the ordinary and assignment
lanes and left the third untouched, because nobody had looked at it. Two honest
resolutions, both owner decisions: extend the parity migration to this lane, or
name a real client in the go-ahead.

#### B-4. The flag alone does not make labels appear on native cards

This is the answer to "what does 'Labels unavailable' become", and for a
natively-created card the answer is: **it stays "Labels unavailable".**

`nativeLabelSnapshot` (`index.ts:797-818`) returns null unless the stored
relation has a `nodes` array and `pageInfo.hasNextPage === false`. Native intake
stamps no `labels` relation at all — `grep hasNextPage migrations/*.sql` returns
only readers plus the writer's own output. The workload lane already treats an
absent relation as "complete, with no labels"
(`2026-09-08-workload-native-label-state-shape.sql:8`); production-write does not
share that reading. So native mode swaps the refusal from
`linear_issue_unavailable` to `native_label_state_incomplete` and renders the
same string, with a tooltip that still says "Retry to check the current Linear
state" on a card that never had a Linear issue.

The capture's half (b) cannot repair these either: its repair arm requires
`card.linear_issue_uuid`, which a native card does not have. What is needed is a
seed of the empty-but-complete relation, which is a migration this repository
does not have and a **prerequisite of step 26**, not of 27.

#### The two facts that make the capability worth having

- **The credential asymmetry is the whole point.** The provider label path reads
  `LINEAR_MIRROR_API_KEY` (`index.ts:841-843`). The native path never reaches it:
  `handleLabelsRead` returns at `index.ts:5612-5618` before `linearLabelSnapshot`,
  and `production_labels_write` makes no outbound request. Turning this on is
  precisely what removes the Linear credential from the label read and write
  path. The credential is needed **once**, to capture, and never again.
- **The gateway half is already serving.** `production-write` was deployed at
  `d749ec9f` on 2026-09-17, and that revision already carries
  `nativeLabelCatalogConfig`, `readNativeLabelCatalog` and the
  `production_labels_write` call; production-write has not changed since. So the
  foundation record's ordered hold 4, "serve the compatible gateway before the
  browser version field, with native mode still off", is already satisfied. The
  browser half is live too — `index.html` adopts `catalog_version` and sends it
  back on save.

#### Who runs the capture

Neither this session nor the storage session. It needs a live Linear credential
and the service role key, its output is a private package carrying label names
and client slugs into a **public** repository's blast radius, and
`--confirm=REVIEWED_COMPLETE_LINEAR_LABEL_EXPORT` is an assertion that a human
read the evidence — which a session cannot truthfully make. If custody of the
package is ever delegated, the storage session is the right holder, because
private-package custody and the Drive lane are already its job. That is custody
only; it does not extend to running the capture or making the attestation.

### 2026-09-18 — PR #1413: both native follow-up lanes now treat the test client like a real client, and ONE body change turned out to have FOUR frozen artifacts downstream of it

Cloud session. Not merged; the supervisor merges.

#### What the change actually does

Before this, a natively-created card could not be exercised end to end by the
test client at all. Both native follow-up lanes refused `test_only` outright —
the ordinary lane (status, due, title, priority, archive, restore, parent,
description, attachment, comments) and the assignment lane (assignee). So the
drill could create a native test card and then could not touch it, which is
what run 35327383049 was really showing.

`migrations/2026-09-18-native-test-client-parity.sql`, sha256
`d7137d68f2d24927d3f713fe39d33fe32a042bdba333da6d11c54324fc531317`, replaces
five routine bodies so both lanes **record and compare** `test_only` instead of
refusing it: `production_native_ordinary_event`, `production_native_ordinary_receipt_guard`,
`production_assignment_context`, `production_native_assignment_receipt_guard`,
`production_assignee_write`. The admissions table's `CHECK ((test_only = false))`
is dropped by exact definition, and the migration asserts the `legacy_parity`
check survives, so a failure to find it stops the migration rather than
silently widening the wrong gate. `legacy_parity` is untouched in both lanes and
still refuses. Nothing new is granted; no role list was edited.

Rehearsed on disposable PostgreSQL 16, 17 checks: the before-state refusal
reproduced for both lanes, then a `test_only` status change and a `test_only`
assignment admitted and their outbox rows skipped with the native marker,
a real-client row behaving identically, a forged receipt refused, a non-test
client refused, ACLs preserved, and `provider` mode unchanged.

#### The part worth remembering: how many frozen artifacts one body change moves

Replacing a routine body is not one edit. The repository pins the same bodies in
four independent places, and three of them only announce themselves after the
fact, in a different CI lane:

1. `scripts/linear-exit-deploy-preflight.js` — `bodyMd5` per routine.
2. `scripts/linear-exit-install-manifest.js` plus its snapshot JSON.
3. The `expected` blob inside `production_retirement_contract_assert_v1`, which
   carries `md5(prosrc)` for 33 routines.
4. The dated install source inventory capture, which is byte-pinned.

Each of the three beyond the preflight was found by a red lane, not by reading,
and each cost a round trip. Three machine checks now close the class rather than
the instance:

- `test/linear-exit-preflight-latest-pin.js` — every routine redefined by a
  later migration must be pinned to its latest file, and every pinned file must
  actually define the routine it is pinned for. This is what caught the live
  `CONTRACT_MISMATCH:routine:production_notification_intent_guard()`: #1410
  repointed five notification routines and left the intent guard on the
  2026-09-09 file. 49 routine rows, 15 cited files, 0 violations.
- `test/retirement-contract-body-pins.js` — the 19 routines the retirement
  contract and the deploy preflight both name must agree. A control proves the
  extraction equals `prosrc` rather than assuming it.
- `test/native-test-client-parity-contract.js` — the migration's own shape,
  offline.

#### The re-capture, and the convention that decided it

Regenerating the install inventory in place put the byte-pin gate red, because
`sameComposition` compares line-ending counts and a regenerated file has a
different line count. The repository's own convention settled it, and the owner
confirmed it: **a re-capture is a new dated file, never an edit.** There are
three prior `LINEAR_EXIT_OBSERVED_FULL_PIPELINE_2026091*.json` files saying so.

So `LINEAR_EXIT_INSTALL_SOURCE_INVENTORY_20260910.json` is left byte-identical,
`…_20260918.json` is written by the module's own writer at 66 entries, pinned in
`.gitattributes` beside its predecessor, and all 9 live references moved. The
2026-09-18 creative-channel migration from #1410 was missing from the inventory
and is included in the same capture, so the new capture is complete.

Three references were deliberately NOT moved, each measured rather than assumed:
the admission release extension and the atomic writer bundle pin the 2026-09-10
bytes by sha256 and never rebuild them, and the source baseline catalog is a
`POST_64_OWNER_PRE_ADMISSION` checkpoint whose own artifact declares 64 owners
and 99 sources — repointing it would have made the artifact lie.

#### And the last one, which was a real design mistake rather than a stale pin

Two suites then went red with `manifest_source_or_contract_drift`, and the pins
were not the problem. `install-manifest.verify()` asserts a capture still
**equals** `build()`. A frozen checkpoint holding a dated capture can only
satisfy that while the repository has exactly the owners that capture froze — so
the first migration added after any capture retires every checkpoint holding it,
rather than testing it. Both artifacts were correct; the check was asking the
wrong question.

`verify()` keeps its meaning for live callers. Frozen holders move to a new
`verifyFrozen()`, which proves what stays true across additions: the capture is
a subset of today's inventory, every owner it covers is still byte-identical
including its dependency edges, and their relative install order is unchanged.
Editing a covered owner's source, its edges or its id, dropping one,
duplicating one, reordering them, or changing a contract field all still refuse,
each with its own negative control. Only the appearance of a NEW owner is
tolerated, which is the one thing that has to be.

The generalisable lesson, and it is the same one as 2026-09-15: a check that
cannot survive a legitimate change is not a strict check, it is a check that
will be deleted the first time it is inconvenient. Frozen and live artifacts
need different questions asked of them.

#### Also on this PR

- `production_notification_intent_guard()` repointed from the 2026-09-09 outbox
  migration to `2026-09-18-notification-creative-channel.sql`. The bodies
  genuinely differ. Contract stays at 157 keys; the preflight returns
  `{"status":"PASS","checks":28,"contract":"linear-exit-production-write-sql-v6"}`.
- `native_followup_mirror_settlement` un-parked in the drill, where the
  capability is on. A structural control proves every call site sits under the
  capability guard — the first version of that control did not fire, because one
  of two occurrences had been replaced and the regex was too weak.
- Codex round 1 was right about the wrong body revision: the 2026-09-12 revision
  is what the preflight pins, and it reads the mode first and then applies the
  scope check. Corrected and acknowledged in the thread.
- An earlier assertion that the cleanup archive mints a native receipt was
  removed. It cannot: `deliverable-write` calls `rpc: "deliverable_write"`, not
  `production_deliverable_write`. Two assertions now lock that distinction.

### 2026-09-17 — STEP 19 DEPLOYED ALL THIRTEEN and then failed its own attestation on three invisible bytes. Both byte-order marks stripped, a unit guard added that is seen to fire, and `notify` now pins to the value the run measured live

Cloud session, on the owner's instruction, after the supervisor root-caused it.

#### The shape of this failure, which is the part worth remembering

**The release lane deploys BEFORE it attests.** Run 28 of the staff-sensitive
lane, dispatched on `d749ec9f`, ran both deploy steps to completion and only
then computed fingerprints. So at the moment the run went red, **all thirteen
functions were already live from `d749ec9f`**, and four of them had genuinely
new bytes uploaded (`notify`, `production-write`, `production-comments`,
`production-archive`; the other nine reported `No change found`). A red
attestation here is a report about a deploy that already happened, not a gate
that stopped one. Nothing needed to be re-deployed and nothing needed rolling
back.

That is also why the new guard went into the unit lane rather than into the
release lane: a check that runs after the upload cannot hold anything back.

#### What the run said

```
| `notify` | FAIL | 1 | false | `bfe3e13ef9d2` | `090a6cac5d93` | `3d1f2da593d2` | 4/4 |
**Result:** 12 PASS, 1 FAIL, 0 ERROR.
- `notify`: changed=functions/notify/urgent-link.ts
```

#### The cause, reproduced independently before anything was changed

`supabase/functions/notify/urgent-link.ts` begins with a UTF-8 byte-order mark,
`ef bb bf`. The deploy tooling strips it on upload. `scripts/ef-fingerprint.js`
does not: `buildExpectedClosure` stores the **raw git bytes**, and only the
import scan sees the BOM-stripped text through `sourceText`. So for a marked
file the expected value hashes three bytes the live source cannot contain, and
no amount of redeploying can make the two agree.

Rather than take the supervisor's arithmetic, this was recomputed with a
separate implementation of the algorithm the tool documents, over the four files
of the `notify` closure at `d749ec9f`:

| bytes hashed | fingerprint | the run's column |
|---|---|---|
| exactly as committed, mark present | `bfe3e13ef9d2…` | **Expected** |
| only the three mark bytes removed | `090a6cac5d93…` | **Live** |

Two values, two columns, no other edit. The live code was byte-identical to the
intended code the whole time; only the pin disagreed.

#### What changed

Three bytes removed from each of the two marked files, and nothing else:

| file | before | after | closure today |
|---|---:|---:|---|
| `supabase/functions/notify/urgent-link.ts` | 1246 B | 1243 B | in `notify` (4 files) |
| `supabase/functions/linear-outbound/provider-send-v2-preparation.mjs` | 997 B | 994 B | **in nothing** |

The second file is imported by no entrypoint, so it sits outside every
fingerprint closure and cost nothing today. It would have become this same
failure on the day somebody added the import. A sweep of the tree found exactly
these two of 69 files.

#### The fingerprints at the new head, all thirteen

`node scripts/ef-fingerprint.js <new head> --slugs=<13> --expected-only`, which
reads git and makes no network call:

| slug | expected at `d749ec9f` | expected now | note |
|---|---|---|---|
| `ai-onboarding-list` | `bce568a72fce` | `bce568a72fce` | unchanged |
| `client-credentials` | `d6300381fa19` | `d6300381fa19` | unchanged |
| `filming-plans` | `ef1f6aee94d0` | `ef1f6aee94d0` | unchanged |
| `key-verify` | `68e6d3094a08` | `68e6d3094a08` | unchanged |
| `legacy-onboarding-list` | `d1f6a2d9caf4` | `d1f6a2d9caf4` | unchanged |
| `linear-outbound` | `f59b6206e3cc` | `f59b6206e3cc` | unchanged, and it matters |
| `notify` | `bfe3e13ef9d2` | **`090a6cac5d93`** | now equals the run's LIVE value |
| `onboarding-full` | `68da4d8f413d` | `68da4d8f413d` | unchanged |
| `onboarding-list` | `a23980f1da39` | `a23980f1da39` | unchanged |
| `production-archive` | `3c478af053f2` | `3c478af053f2` | unchanged |
| `production-comments` | `7333e4f2a5d7` | `7333e4f2a5d7` | unchanged |
| `production-write` | `4e716d1008d9` | `4e716d1008d9` | unchanged |
| `smm-weekly-reports` | `e1f925289245` | `e1f925289245` | unchanged |

12 of 13 byte-for-byte identical, one changed, and it changed to the value the
lane measured live. `linear-outbound` staying put is the load-bearing one:
`.github/workflows/deploy-f27-section4-closures.yml` pins
`LINEAR_OUTBOUND_SOURCE_SHA256` to `f59b6206e3cc…` and
`test/f27-section4-deploy-lane.js` asserts the same literal, so a change there
would have broken a reviewed closure pin. It was checked rather than assumed,
because the file whose mark was stripped lives in that function's directory —
it is only the **import closure**, not the directory, that the fingerprint
covers.

#### The guard

`test/edge-function-byte-order-mark.js`, registered in
`test/suite-classification.json` (unit 548 → 549; that registry's validator
compares the registry against the directory in both directions, so an
unregistered test file fails it — unlike `test/repo-map-sync.js`, which still
walks one way only).

It scans **every** file under `supabase/functions`, 69 today, not the import
closure of some entrypoint, for the reason above.

Seen to fire, three ways:

1. Its own positive control, inside the test: a disposable tree with a planted
   mark, a clean sibling, a file whose mark is not at byte 0, and an empty file.
   Only the planted one is reported, and the tree comes back silent once it is
   removed.
2. Planted back into the real tree: exit 1, naming `notify/urgent-link.ts`.
3. Removed again: exit 0, `files_scanned: 69, marked: 0`.

#### Not done

- **No fingerprint was re-pinned to the marked bytes.** The repair is the file,
  not the expectation. CLAUDE.md now says so in one line.
- No redeploy, no dispatch, no SQL, nothing inside Linear.
- **Step 20 not started.**
- The live functions were not re-read from the Management API by this session:
  it holds no token. The live column quoted here is the run's own measurement.

### 2026-09-17 — The merge DELETED the shared branch, and my journal push recreated it. Anyone holding the old branch must fast-forward before pushing

Operational note for the other two sessions, not a finding.

The merge of #1408 auto-deleted `prep/linear-exit-review-fixes-20260913`. My
push of the entry below therefore reported `[new branch]` rather than an update:
the branch now exists again, at `d0e8c520`, which is the new main `d749ec9f`
plus one journal commit.

**What this means for the storage session.** A local checkout still at
`ec99ee71` is an ancestor of the recreated branch, so nothing is lost, but a
push of new commits made on top of it will be **rejected as non fast-forward**
until it pulls. Pull first, then push. Nothing needs to be re-done and no
history was rewritten.

The branch stays the channel. It is now based on main rather than ahead of it,
which is also the right base for whatever the next unit of work turns out to be.

### 2026-09-17 — PR #1408 MERGED to main at `d749ec9f` on the owner's go-ahead. CI 5 of 5 green on `ec99ee71`; the merge deployed nothing and changed no served byte

Cloud session. The owner lifted the gate that said #1408 must not be merged, and
named the convention: a merge commit, the same as #1391.

#### The head was not the one I had been watching

The owner's message said the head was `ec99ee71` after two storage journal
pushes, not the `7e97b140` I last read. Checked rather than accepted, because a
state handed over in a message is not a state verified:

| Claim | How it was checked | Result |
|---|---|---|
| Head is `ec99ee71` | `git fetch` plus the pull request's own head field | both read `ec99ee71` |
| The migration is untouched by those two pushes | `sha256sum` of the blob at `ec99ee71` | `e50d8b2a3b761fd08622634bfc6e926c2ee7cd0ca97aefe3deee9fc117859734`, unchanged |
| The preflight now passes | read the storage session's journal entry at that head, not the message | `{"status":"PASS","contract":"linear-exit-production-write-sql-v6","checked_objects":156,"read_only":true}`, exit 0 |
| #1391's convention was a merge commit | `git log -1 --format=%P` on the old main tip | two parents, subject `Merge pull request #1391` |

The two storage pushes are theirs to own and are recorded in their own entries
above: the revokes applied live with a delta of exactly the 24 expected
privilege rows and none added, then the urgent destination configuration row
inserted 0 to 1, then the gate re-run green. Their second entry also corrects
their first: the metadata validation, which carries the ten privilege keys, runs
**before** the configuration read, so the earlier `CONTRACT_ABSENT` on
`config:urgent_video_destination` had already proved the ten were closed.

#### What CI said on the merged head

`ec99ee71`, five check runs, **five success, zero failures**: `identity-exposure`,
`f27-team-rollback-proof`, `Isolated PG17 retirement-switch`,
`Isolated PG17 card-atomic-admission`, `unit`. `mergeable_state` read `clean`.
The legacy commit-status endpoint reads `pending` with `total_count: 0`, which is
an empty set rather than a pending check, and was not treated as one.

Three earlier `check_suite.completed` events arrived for superseded heads
(`b63c6804`, `9b3ecb21`, `673afe2c`) and were correctly ignored. A fourth
repetition of the same lesson: an event names a SHA, and the SHA is the thing to
compare, not the pull request number.

#### The merge

| Item | Value |
|---|---|
| Merge commit on main | **`d749ec9f25a921824908570d466ebd0efb39dcc6`** |
| Parents | `302de4a4` (previous main) and `ec99ee71` (branch head) |
| Method | merge commit, no squash, no rebase |
| Files changed against the previous main | 5, additions only: the migration, `CLAUDE.md`, `REPO_MAP.md`, `ROLLBACK.md`, this journal |

#### What the merge set off, measured rather than assumed

Two workflow runs on main and no others: `Calendar unit tests` for the push, and
`pages build and deployment`. **No Edge Function deploy lane ran**, because all
four are path-filtered on `supabase/functions/` and the diff contains zero paths
there, zero workflow files and no `index.html` change. Pages republishes the
repository root, so the served page rebuilds from bytes identical to before.
This is the opposite case to the step 17 merge, which auto-deployed eleven
byte-identical functions, and the difference is the path filter, not luck.

#### A stale sentence left standing on purpose

The pull request body still says "Not merged" under "Not done here". That was
true when it was written and is the state the reviewers read. It was not
rewritten after the fact; this entry is the correction, in the place corrections
belong.

#### Not done

- **Step 20 not started.** The gate passing is not the release. The 13-function
  lane remains a manual dispatch by the owner.
- No SQL run from this session, no deploy, no dispatch, nothing inside Linear.
- Still owed by other sessions: the unstubbed operator preflight for steps 4 to 6,
  and the live read-only fingerprint count over the thirteen functions.
- Post-merge work now unblocked but deliberately not begun: D30, D31, D32, D33,
  and the `test/repo-map-sync.js` one-directional fix.

### 2026-09-17 — STEP 19 GATE PASSES: the urgent destination row inserted, 0 rows → 1, and the deploy preflight returns `PASS`, 156 objects, `read_only: true`. CORRECTION to my previous entry: the ten privilege keys WERE evaluated and passed

Storage session, on the owner's machine, over the direct database connection.
Live production write: exactly one row inserted into
`public.production_notification_config`.

#### CORRECTION, to the entry immediately below this one

I wrote that `validateRows` throws on absent rows **before** evaluating privilege
compatibility, and therefore that the run "did not evaluate the ten, and does not
confirm that the revokes closed them". **That is wrong**, and the owner's
correction is right. Read from `scripts/linear-exit-deploy-preflight.js` at
`7e97b140` rather than from the claim:

```
const metadata = await read(contractQuery('metadata'));
validateRows(metadata, keys.filter(key => !key.startsWith('config:')));
const configuration = await read(contractQuery('configuration'));
validateRows(configuration, keys.filter(key => key.startsWith('config:')));
```

Two separate reads, and the metadata set — the routines, triggers, columns,
schemas and the ten privilege keys — is validated **before** the configuration
read happens at all. The previous run reached
`CONTRACT_ABSENT:config:urgent_video_destination`, which is thrown by the
**second** `validateRows`. So the metadata validation had already passed:
**the revokes did close the ten keys**, and my run proved it while I said it
had not. I read the error and inferred the order instead of reading the order.

#### The insert

| Item | Value |
|---|---|
| Table | `public.production_notification_config` |
| Key | `urgent_video_destination` |
| Value | a JSON object with exactly one member, `channel_id`, whose value is **the legacy urgent n8n workflow's destination channel**, confirmed by the owner as the channel that workflow posts to today |
| Rows before → after | **0 → 1** |
| Evidence | `step19-config-20260917-1/` (`config-before`, `config-after`, `insert-result`, and the value file) |

**The channel id itself is deliberately not in this journal.** It lives only in
the private evidence directory. What is recorded publicly is its shape, which is
what the gate checks: an object, exactly one key, `channel_id` matching
`^[CG][A-Z0-9]{8,}$`.

Tool: `insert-notification-config.private.cjs`, SHA-256
`8064c6addde8a56ac63260f4bcd731ba3e726c0cc23556db422db6a5d3634b87`. It reads the
value from a private file rather than a command line, refuses unless the table
has **0** rows, does the insert inside its own transaction, reads the stored row
back **before committing** and refuses on anything but an object with one key
whose `channel_id` equals the input. Password in memory from the 5.1 helper,
never written. Identity and TLS asserted first.

#### A defect of mine, and the database caught it

The first insert attempt was **refused by the table**:

```
new row for relation "production_notification_config" violates check constraint
"production_notification_config_value_check"
```

The constraint is `CHECK (jsonb_typeof(value) = 'object')`, read live from
`pg_constraint`, and it was right to refuse. **The fault was in my tool, not in
the migration, the table or the value.** I passed the JSON *text* as a bound
parameter with `$2::jsonb`; `postgres.js` serialised that JS string as a JSON
**string**, so the cast produced a string, not an object. Probed read-only
afterwards to confirm rather than assume:

```
string binding    -> jsonb_typeof = string   (length 41, the quoted text)
object param      -> jsonb_typeof = object
json_build_object -> jsonb_typeof = object, has_key = true
```

The tool now builds the value **in SQL**, `json_build_object($2::text,$3::text)::jsonb`,
so the shape cannot be double-encoded and the channel id stays a bound parameter.
**Nothing was written by the refused attempt**: it was inside a transaction that
rolled back, and the measurement taken straight afterwards showed 0 rows. That
file is kept as `config-after-refused-binding.private.json`, named so it cannot
be mistaken for the real after-state.

#### The gate

From the detached worktree at `7e97b140`, with the machine's own credentials and
`PROJECT_REF` supplied in memory; neither printed nor written.

```json
{"status":"PASS","contract":"linear-exit-production-write-sql-v6","checked_objects":156,"read_only":true}
```

| Field | Value |
|---|---|
| `status` | **PASS** |
| `checked_objects` | **156** |
| `read_only` | **true** |
| Exit code | 0 |

Step 19's read-only contract gate is satisfied: the privilege repair applied
earlier and this configuration row together close everything it refused on.

#### Not done

- **No deploy was dispatched.** The gate passing is not the release; the
  13-function lane is still a manual dispatch and was not run.
- Nothing else was written to the database: one row, one key, one value.
- No second row is possible without noticing: the tool refuses unless the table
  is empty.

### 2026-09-17 — STEP 19 REPAIR APPLIED LIVE:…142475 tokens truncated…xistence on a separate device.
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

**B10 NARROWED, not closed, 2026-09-16. Row kept above.** The half that was
blocked is done and proven: the table is in the admission guard list, the
fixture creates it, seven pin sites are re-derived, and the retirement trigger
contract blob was regenerated on a real PostgreSQL 17 in this sandbox with both
`definition_md5` values read from the server. The lane that forced B10 out of
the catch-up is green — `LINEAR_EXIT_RETIREMENT_SWITCH_OK`, 46 checks — and the
full suite shows zero regressions against a clean control worktree.

**B10 now reduces to exactly three things, all of which need the private
observed inputs and therefore the storage session:**

1. Re-pin the three profile plan hashes. Measured here and recorded in the
   progress entry; deliberately NOT written, because pinning is the owner's
   reviewed step and a new plan beside a stale target would read as re-pinned
   while being half-updated.
2. Re-derive the three profile TARGET hashes, which requires a real install run
   of the new plan. `settled68`'s `625430…` is superseded, as recorded in
   advance earlier today.
3. Decide what happens to
   `docs/independence/LINEAR_EXIT_OBSERVED_FULL_PIPELINE_20260913.json`, which
   is both a dated proof record and a live `SOURCE_PIN` gate in the install
   operator. Not edited here; it is an owner decision, because editing a dated
   proof record's pins rewrites history and leaving it fails step 14. Added
   2026-09-16, not previously recorded anywhere.

Nothing in 1 to 3 blocks the merge or the install any more than B10 already did:
the admission guard still installs `open` and is inert until something closes
it, which nothing in the install path does.

**B10 item 3 DECIDED, 2026-09-16, owner. The note above stands as written.**
The pipeline proof is **re-run, never edited**. The re-run writes a NEW dated
proof file and leaves the 2026-09-13 file byte-identical; the install operator's
`source_pins` read is then pointed at the new file. Confirmed by this session
that the re-run **requires the private observed inputs** — four private capture
files the lane refuses to start without — so it is the storage session's, not
this one's. Its `--verify` mode also takes a private target path and SHA, which
puts it downstream of item 2; `--calibrate` does not and can go first.

So all three of B10's remaining items are now the storage session's, and item 3
is no longer an open question, only unexecuted work.

**Correction to item 3's scope, same day.** Three of the 26 pins are stale, not
the two named when the decision was taken, and **only one of the three is
B10's**. The other two, the full install plan builder and the observed full
target, went stale earlier on 2026-09-16 from the settled-contract and
count-derivation work. The proof has therefore been failing its own gate since
before B10 started. Whoever re-runs it is re-proving today's earlier work too.

**Separately, not a blocker and not B10.** The dual role of that file — dated
receipt and live gate in one document — is recorded as a structural finding with
a proposed direction in the progress log. Deliberately not fixed.

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

**B2 CLOSED, 2026-09-17T00:10Z (2026-09-16 18:10 on the owner's machine), storage
session, on the owner's authorisation of step 8. Row kept above.** The row asked
for a receipt with the supported-baseline and TLS checks passing, naming
`observed67_optout`. The naming half was superseded, not failed. D12 held the
re-pin until the hiring migration reached main, B9 derived `settled68` against
that settled state, and D17 and D18 made it the world step 14 installs against.
Receipt `day-catalog-20260916-5/receipt.private.json`, SHA-256
`685482e88f490d3e81235cbf2126b539d112c8d352bd27b3eaf073fbca45ec41`:
`catalog_sha256` `ddfa4c4f…`, `profile: settled68`,
`matches_reviewed_baseline: true`, `tls_verified: true`, 68 tables. Identity is
identical to three earlier reads. Full evidence is in the progress entry "STEP 8
CLOSED". **B9 is not closed by this note.**

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


### D15 — The opt-out world's post-install count resolves from its starting hash, to the observed67 contract's count (2026-09-16, supervisor decision, verified independently by the session before applying)

**What broke, and when.** `8299108` replaced nine hard-coded `90`s with one
derivation, `postInstallPublicTables(plan.initial_catalog_sha256)`. That
function resolves the starting catalog against the named contract artifacts.
The opt-out world's starting catalog `f5ed8a38…` **is not a contract artifact**
— it is a world the builder reverses back to `observed67` — so the lookup found
nothing and threw. Before `8299108` the literal `90` was simply correct for it,
by coincidence of arithmetic rather than by anything checking.

**The change was approved by the supervisor, and the approval rested on a claim
that was true of one profile and stated of two.** The executor said the two
existing profiles were unaffected. That held for `observed67`. It did not hold
for `observed67_optout`, and nothing in the approval asked which of the two had
been exercised. Recorded here because the shape recurs: a claim about a set,
evidenced against one member of it.

**The neutrality check that found it, and what it proved.** The `observed67`
run was genuinely neutral across the runner change: exit 0 on both sides, plan
`3c000b76…` and every artifact byte-identical, with the single expected
difference being the runner's own self-hash pin — and that difference was named
**before** the run rather than explained after it. That is the half that is
worth keeping. The opt-out run failed identically on both sides, at the same
APPLY, with an identical plan, which is what identified the defect as older than
the runner change.

**The generic catch cost a diagnostic cycle.** `execute()` converts every
failure into `INSTALL_OPERATOR_EXECUTION_REFUSED` carrying only a stage, which
is deliberate — it keeps private detail out of operator output. The price is
that a failure whose cause is a plain missing lookup entry arrives as an
unnamed refusal. Naming it needed a separate no-database probe written for the
purpose. The catch is not being changed here; the cost is being recorded so the
next session reaches for a probe sooner instead of re-reading the install path.

**The defect was mid-install, not pre-install, and that is the second half of
the fix.** The resolution sat at `stage='target_comparison'`, after
`maintenance.run()`. So an unresolvable starting catalog aborted an install with
the maintenance guards already written to every public table, rather than
refusing before the connection was opened. The resolution now happens in the
installer's preflight `load()`, which runs before the postgres driver is even
required, and the comparison site reads the already-resolved value. A world
nothing can resolve is now a refusal that touches nothing.

**Why the mapping is a hash-to-contract entry and not a field.** The opt-out
plan hash `0c889149…` is pinned and checked. Any field added to the plan to
carry this would change the plan bytes and break that pin. The entry therefore
resolves from the starting hash alone, in a frozen reviewed table beside the
contracts, and carries its own provenance: the delta is one column and one ACL
string on an existing table and **zero tables**, proven by the builder's own
`assert.equal(j.sha(j.canonical(old)),OLD,…)` — a delta that added or dropped a
table could not reverse that way and would fail that assert. What would make it
wrong is stated in the same comment: any future opt-out delta that adds or drops
a table.

**Verified independently before applying**, by reading
`linear-exit-install-profiles.js`, `linear-exit-observed-public-catalog.js` and
`linear-exit-install-operator.js`, and by executing the resolution for all three
starting catalogs: `observed67` 67+23=90, opt-out 67+23=90, `settled68` 68+23=91,
with an unknown hash still refused. `INSTALL_CREATED_PUBLIC_TABLES` was not
touched and no hash was re-pinned.

**One companion change beyond the letter of the decision, flagged rather than
folded in silently.** `test/helpers/install-operator-worker.mjs` builds its own
`prepared` object instead of calling `load()`. Moving the resolution into
`load()` would have left that object without the field, and the comparison site
would then have failed `GUARD_COUNT` for **every** profile — the same class of
misleading error this entry is about. The worker now resolves the value the same
way `load()` does. It is not adjacent work; it is the second producer of the
object whose contract changed.

**The 91 remains untested, not contradicted.** Nothing here measured a
post-install count. The calibration is still the test of the `settled68`
arithmetic, and it does not run until both existing profiles pass neutrality.

**Addendum, same day, on approval of the above.** The session proposed a
`PREPARED_SHAPE` refusal so that a `prepared` object missing the resolved count
would be named rather than surfacing as a misleading `GUARD_COUNT`. It was
proposed at the comparison site. The supervisor ruled it in at **preflight
instead**, on the line after the destructuring and outside the try, for a reason
worth keeping: inside the try, the same catch that masked the original defect
would have rewritten it as `INSTALL_OPERATOR_EXECUTION_REFUSED` at stage
`target_comparison`, making the new guard exactly as uninformative as the
`GUARD_COUNT` it was meant to replace. Outside the try it throws under its own
name. **That catch has now cost clarity three times in one day**, and each time
the fix has been to keep the failure out of its reach rather than to change it.

Moving the guard ahead of the try also brought the offline operator test's
fixture into scope: it is the third producer of a `prepared` object and its
synthetic world has zero tables, so it now carries
`INSTALL_CREATED_PUBLIC_TABLES` rather than a fresh literal. Three producers of
one object, only one of which is `load()`, is the reason a missing field needed
a name in the first place.

### D16 — The calibration's derived target is written under a filename that names its profile (2026-09-16, supervisor, found on review of the lane)

The calibrate path of `test/helpers/install-operator-worker.mjs` wrote its
derived target to `optout-target.private.json` regardless of
`INSTALL_OPERATOR_PROFILE`. The `settled68` calibration would therefore have
written the settled world's target into a file named for the opt-out world.

**Not cosmetic.** `profiles.settled68.target` is deliberately `null` so that no
plausible-looking hash can be written there by accident, and the file this run
produces is the only thing that will ever fill it. A target read out of a file
named for a different world is precisely how a confidently wrong pin gets made,
and the pin would then be checked against itself forever after. It is the same
defect class as the nine literals and the masked catch: an artifact stating
something it has no way to be right about.

The name is now `<profile>-target.private.json`, built from the same env var and
the same `observed67` default the worker's non-calibrate path already uses:
`observed67-target.private.json`, `observed67_optout-target.private.json`,
`settled68-target.private.json`.

**What the reference check found, reported rather than renamed past.** Two
references to the old name exist in the repository and only one is code.

- `test/helpers/install-operator-worker.mjs` — the producer, changed here.
- `docs/ops/LINEAR_EXIT_INSTALLATION_DAY_20260914.md` line 141 — **a historical
  record, not a consumer.** It names
  `linear-exit-install-operator-e7df95d7…/optout-target.private.json` as the
  private target file of calibration receipt `e7df95d7…`, a run that already
  happened on 2026-09-14. That file keeps its name; the line stays true and was
  not touched. A future opt-out calibration writes into its own receipt
  directory under the new name, so nothing is made ambiguous by the two
  coexisting.

Nothing reads the written file back by name: the postgres runner passes the
target in through `INSTALL_OPERATOR_TARGET` and skips the hash assertion while
calibrating, the CI workflow does not mention it, and no copy exists anywhere in
the working tree. Checked by searching the tracked repository for both the exact
name and the `*target.private.json` shape, and by searching the filesystem.

**Left alone deliberately:** the sibling `operator-result.private.json`, written
by the same branch, is also profile-neutral. It records a status and the hashes
it just computed rather than a value anything will be pinned from, so it is not
in the same class. Named here so the next reader knows it was considered.

Nothing was run against a database.

### D17 — The settled68 target is pinned; the calibration reported the derived 91, so the derivation stands (2026-09-16, supervisor, on the calibration result)

The calibration reported a post-install public table count of **91**, which is
the number derived once from the settled contract before the run. Under the
binding set on 2026-09-16 that is the only outcome that is not a finding: 91
confirms the derivation, anything else would have stopped everything. So the
derivation stands and the target that run produced is the reviewed one.

`profiles.settled68.target` is now
`625430979c5508f2a87b18bfa9d7135806273c909c3f5baf9f5a5fe835f97356`.

**Provenance, all measured.** Derived by the settled68 calibration at
`cd6f1808` on a fresh PostgreSQL 17. File `settled68-target.private.json`,
1,613,093 bytes, built under plan `e3dae746…` from starting catalog
`ddfa4c4f…`, installed public catalog `0d4eb7dc…`, private `fccae16a…`. The 91
was confirmed by two independent measurements inside the run, the worker's
guard count and the target builder's table count, neither of which was handed
the number.

**The pin is committed but NOT closed.** The value comes from a private file
only the storage session can read and reached this session as text in chat. The
house rule is that a hash is read whole from a command's output, and this one
was not read by the session writing it down. The storage session re-reads its
own file and confirms the committed value; until that lands, the pin is
provisional. Recorded in the profile comment as well, so the file says so and
not only this entry.

**The behavior change, reported before it was made rather than handled
quietly.** Pinning the target makes `get('settled68')` stop refusing, because
`get()` refuses any profile whose plan or target is missing. Five searches of
different shapes were run to find anything depending on that refusal:
`settled68` across the whole tracked repository; every caller of
`profiles.get`; refusal assertions in the test tree; the phrases that describe
the profile as unpinned; and every test file naming the profile at all.

What they found:

- **No test and no assertion anywhere depends on `settled68` refusing.** Nothing
  was deleted, weakened or adjusted, because there was nothing to adjust.
- `test/linear-exit-install-operator-postgres.js` is the only test file that
  names the profile. It carries the per-profile SETUP row and, on a
  non-calibrating run, compares the target file's hash to `get(profile).target`.
  For `settled68` that line previously threw "not pinned yet" before it could
  compare; it now compares. Same for
  `test/helpers/install-operator-worker.mjs` line 12. Both are consumers that
  become live, not assertions that break.
- `profiles.build(catalog,'settled68')` never went through `get()` at all: the
  settled branch returns before that line, which is why the plan could be
  exercised while the target was null. The pin does not change `build()`.

**One stale line found in passing, reported rather than edited**, since this
decision's scope was the pin: `REPO_MAP.md` line 467 still describes
`LINEAR_EXIT_RUNNER_SETTLED_WORLD_PROPOSAL.md` as "proposal, not applied — the
operator test runner has no settled68 branch". The runner change was applied
earlier today and that file now carries the per-profile table including
`settled68`, so the line describes a world that no longer exists.

Nothing was run against a database.

### D18 — The two 67-table profiles no longer need to be installable (2026-09-16, owner)

Given in response to the storage session's report at `ff9b379f`. After B10,
`observed67` and `observed67_optout` refuse at install with
`application_admission_missing_owner:hiring_practical_test_jobs`. **The owner
ruled that this is not a regression.**

- Neither profile is named in any numbered step of the execution map.
- Step 14 installs against the live world, which is the 68-table settled world
  (`ddfa4c4f…`, `settled68`).
- So their failed installs at `957db6c8…` and `8f40b44d…` are the expected
  consequence of B10, not a defect to chase. **A future session must not treat
  them as a regression, and must not "fix" them.**

What this does not decide: whether the two profiles are removed from the code,
and what happens to their existing pins. Neither was ruled on here, and nothing
was removed.

### D19 — The pipeline proof moves to the settled world (2026-09-16, owner)

The observed full pipeline proof is re-based on the settled 68-table world
instead of the 2026-09-12 67-table capture. This supersedes the plan in the
entry "Pipeline proof: DECIDED re-run, never edit" only as to **which world**
the re-run proves. The re-run-never-edit rule stands:
`LINEAR_EXIT_OBSERVED_FULL_PIPELINE_20260913.json` stays byte-identical, and a
re-run writes a new dated file.

**Explicitly deferred by the owner:** no plan or target pin, and no repointing
of the install operator's `source_pins` read, until the backup-path fix and the
hard-coded world-description sweep are done.

### D20 — The admission guard is NOT made tolerant of a missing table (2026-09-16, owner)

The guard's refusal when a guarded table does not exist is the check working
correctly. This rules out, finally, the third option the storage session listed
at `ff9b379f`. A future session must not relax
`application_admission_missing_owner` to make a pre-hiring world install.


### D21 — No claim of "zero regressions" without its denominator (2026-09-16, owner)

**Binding on every session.** A session reporting that a change broke nothing
must say **how many suites ran and how many exist**. "Zero regressions" alone is
not a permitted report.

Given after this session reported B10 as zero regressions on the evidence of 547
passing suites and a clean control worktree, when 61 more existed that the unit
lane defers and three of those were broken by the change. The claim was true of
what ran and false of the repository, and the missing denominator is precisely
what hid the difference.

The correct form is "547 of 608 ran; the 61 deferred were not run", not a bare
adjective.

### D22 — All 61 deferred suites run before the exit merge (2026-09-16, owner)

Not a sample, not the ones that look relevant: **all of them.** The unit lane
defers 61 suites as `NOT_RUN_BY_UNIT_LANE`, 18 of which carry a hard-coded world
literal, and the deferral is static rather than environment-dependent, so
nothing about a better-equipped machine changes it.

Not scheduled here. It is a gate before the exit merge, and it is not started
until the backup-path review and ruling 3 are settled.

### D23 — The table-name coupling is DECLARED, not patched (2026-09-16, owner)

The same table-name set is written down in more than one place and nothing says
they must agree. Updating the stale copy closes today's failure and leaves the
coupling undeclared for next time, so that is ruled out. **Either the places
derive from one source, or something asserts they agree — and which one is
proposed before it is implemented.**

Proposal written, not implemented:
[`LINEAR_EXIT_TABLE_NAME_COUPLING_PROPOSAL.md`](LINEAR_EXIT_TABLE_NAME_COUPLING_PROPOSAL.md).
It recommends **assert, not derive**, and corrects this session's own "four
places" to three, of which two are already byte-identical. Two reasons deriving
is wrong rather than merely harder: one of the three is a **captured
observation**, and generating it from a list would be the same falsification the
pipeline-proof decision rejected this morning; and the guard list is install-plan
source #2, so generating it would make every custody-corpus edit move all three
profile plan and target pins, which B10 measured the cost of.

**It is blocked on one question the owner must answer**, stated in §4 of the
proposal: is the intended relation between the admission guard list and the
custody corpus **equality** or **containment**? They were equal throughout
history and are now guard = corpus + 1. Nothing in the repository states which
was intended, and freezing a guess into an assertion whose purpose is to state
the rule explicitly would defeat the point.

### D24 — The three broken suites are re-based onto the settled world (2026-09-16, owner)

`linear-exit-application-dml-admission`, `linear-exit-source-phases-postgres`
and `linear-exit-source-baseline-catalog-postgres` are re-based onto the settled
68-table world. They are **not** repaired against the 67-table profiles, per
D18, which ruled that those two profiles need not be installable.

Not started. It waits on the backup-path review and on D23's open question,
because re-basing moves the custody corpus and an assertion written against
today's sets would have to be revisited immediately.

### D25 — The guard list and the custody corpus are EQUAL, and any divergence is named in the assertion (2026-09-16, owner)

Answers the open question in
[`LINEAR_EXIT_TABLE_NAME_COUPLING_PROPOSAL.md`](LINEAR_EXIT_TABLE_NAME_COUPLING_PROPOSAL.md) §4,
which was the one thing blocking D23 from implementation.

**The relation is equality, not containment.** The owner's reasoning, recorded
because it is the part a future session needs and not the verdict:

> A table worth guarding holds data worth backing up. A table that is guarded
> but never backed up can lose its data behind a check that makes it look
> protected.

That is the worse bug named in the sweep, and it is ruled out by construction
rather than left to be noticed.

**Deliberate divergence stays possible, but only on the record.** The assertion
does not become containment to accommodate a future exception. It stays
equality, and any exception is **named inside the assertion together with its
reason**. So a divergence cannot happen by accident, and can happen only as a
reviewed, written statement.

**Also approved in the same ruling:** the proposal's "assert, do not derive"
recommendation, with **the plan-hash cost as the decisive argument** — the guard
list is install-plan source #2, so generating it would make every custody-corpus
edit move all three profile plan hashes and invalidate all three targets, which
is the blast radius B10 measured. The check **lives in the unit lane**, not the
deferred set.

**Sequencing.** Implementation was gated on the independent review of the
backup-path fix `6da60581` being done and reported. That review is in the
progress log above: PASS, with the synthetic override's loopback gate recorded
as decorative. Implementation is not started in the same breath as the ruling;
D24 also moves the custody corpus, and an assertion written against today's sets
would have to be revisited the moment it lands.

### D26 — Every new check must be seen to fire before it lands (2026-09-16, owner)

**Binding on every session, for every check added from here on.** A check that
has never been observed failing is not evidence that anything holds; it is a
line of code that has only ever been seen agreeing.

The standard, in three steps, all three recorded in the journal:

1. run it unmutated and see it pass;
2. break the thing it guards, run it, and **see it fail**;
3. restore, run it again, and see it pass.

And no red-on-arrival state: the fix and the check land in the **same commit**,
so the repository is never knowingly left with a failing check waiting for a
follow-up.

**One refinement learned immediately, on the first application.** If the thing
being mutated is hash-pinned, the mutation must move the pin too. Otherwise the
drift guard fires first, the check under test never executes, and the "failure"
proves only that a different check works. **A mutation caught by a check other
than the one under test is not a proof of the check under test.** Recorded
because it would be easy to do the weak version and believe the standard had
been met.

### D27 — A stubbed gate is an untested gate (2026-09-17, owner)

**Binding, and it is the sharp edge of D26.** A mutation proof that stubs a
check has not tested that check. It has tested everything except it.

Given after the D19 mutation proof stubbed `observed.compare()`, the starting-
catalog gate, in order to build a plan without the private inputs. The proof
passed six cases and reported the lane correct. The gate it stubbed is **exactly
the one that would have caught** the real defect: the re-based lane applied the
hiring migration without the opt-out prerequisite, built catalog `5864a28f…`
instead of `ddfa4c4f…`, and the storage session's calibrate run refused. The
proof could not see it because the proof had switched off the thing that sees it.

So: a mutation proof runs **through the real gate**, or it says plainly, in the
record, that it could not and what that leaves unproven. "It passed" is not a
result when the gate was off.

**The narrower lesson, which is the one that will recur:** a stub added to get
past a missing input quietly relocates itself into the middle of the proof. The
stub for the private catalog was reasonable; using the same run to certify the
lane was not.

### D28 — The code you changed executes, on a real cluster, before you push (2026-09-17, owner)

**Binding. A proof of something adjacent proves nothing about the thing.**

Given after `applySettledWorld` shipped with `ReferenceError: j is not defined`
and threw on **every call on every cluster**, taking the B9 derivation tool down
with it, because `derive()` had just been pointed at the same function. It was
pushed with a mutation proof that passed.

**Three proofs in a row were each structurally unable to catch the bug shipped
beside them**, and the shape is the same every time:

| | What was proven | What shipped broken |
|---|---|---|
| D26 | the drift guard fired | the check under test never ran |
| D27 | five refusal paths | the gate that mattered was stubbed |
| **D28** | the construction was single-sourced, by **reading the file** | **the function was never called** |

The D28 proof checked exports, call sites, ordering and the absence of the old
copies. Every one of those is a property of the *text*. Not one of them required
the function to run, so a reference error inside it was invisible to all of them.

So: **before pushing, execute the changed code itself.** On a real cluster if it
touches a database. Not the comparison beside it, not its call site, not a
property of its source — the function, running. If that is impossible in this
sandbox, say so in the record and name who can run it, rather than substituting a
proof of something nearby and calling the work proven.
### D29 — "Fails identically at the baseline" is a REGRESSION control, not a validity control (2026-09-17, owner)

**Binding, and it applies to every session and every baseline, not just
`d3cbca7f`.**

Re-running a failing suite at the pre-change commit answers exactly one
question: *is this failure new?* It proves the failure is **not this change's
fault**. It proves **nothing whatsoever** about whether the test is sound,
whether it is measuring what it claims, or whether it can pass at all on the
machine it is running on.

Given after the D22 first pass dismissed fifteen failures with "they fail
identically at `d3cbca7f`, so they are not this month's work". True, and
misleading: **at least six of the fifteen failed only because the harness was
broken** — missing Deno, a proof root pointed at the wrong directory, the wrong
Node on PATH. A suite broken by its environment fails identically at every
commit in the repository's history. That is precisely why the control waved them
through, and it is the failure mode of using it as a validity control.

So, when a suite fails:

1. **Is it new?** The baseline re-run answers this, and only this.
2. **Is the environment the thing failing?** A separate question, answered by
   reading the actual error rather than the verdict, and by suspecting the
   harness *first* when the harness is one I built.
3. **Is the expectation stale, or the world?** A third question again, and the
   one that usually matters.

"Identical at the baseline" may be reported. It may never be used to close an
item, and it is never a reason not to read the error.

### D30 — The recovery fixture re-bases to the settled world (2026-09-17, owner)

**Same principle as D19, and it happens AFTER THE MERGE.**

The recovery rehearsal's world is composed from the source inventory pinned at
2026-09-10, which has no path to
`migrations/2026-09-14-team-members-auto-assign-opt-out.sql`. The gateway it
exercises reads `public.team_members.auto_assign_opt_out` at
`production-write/index.ts:3101`, so `complete-application-recovery` and
`control-recovery-postgres` fail with `503 assignee_lookup_unavailable`. Two
readings were open — the world is short, or the gateway depends on a migration
the fixture deliberately predates. **The owner has ruled: the world is short.**
The fixture re-bases onto the settled world, exactly as D19 re-based the pipeline
proof, rather than the gateway being taught to tolerate a missing column.

D19's other half carries over unchanged: **re-run, never edit.** Any receipt a
re-based run invalidates is superseded by a new dated file, and the old one stays
byte-identical.

Not now. `test/helpers/remaining-application-fixture.js` is byte-pinned into
`docs/independence/LINEAR_EXIT_SOURCE_BASELINE_CATALOG_V1.json`, itself pinned by
`PIN='87848097…'`, and reached by 25 test files. Doing it before the merge means
regenerating a reviewed artifact and moving a constant in the middle of the exit
sequence.

### D31 — The schema suite's lane, the August backup table, and its swallowed error (2026-09-17, owner)

**Three repairs to `linear-exit-priority-application-schema.js`, all AFTER THE
MERGE.**

1. **The routing row gains its flag.** The row's `reproduce` names
   `-Lane priority-application-schema`, the bare lane, in which four of nine
   tables are absent by construction and the suite can never pass. The row gains
   the flag the suite actually needs.
2. **`batches_parent_claim_backup_20260824` gets a declaration.** It is currently
   declared by nothing in the repository — `source_declarations: []` — so no
   amount of source replay can make it "exact", and nine-of-nine is unreachable
   in every lane. It gets a source, or it leaves the expectation; it does not
   stay as an undeclared table a release gate demands.
3. **The `catch` stops discarding the error.** Line 33 is
   `catch(error){console.error('…EXECUTION_FAILED');process.exitCode=1;}`. The
   error object is thrown away, so one lane variant's failure could not be named
   from its output at all. Every other suite in this family writes a
   `.private-error.log`; this one will too.

The third is the one with reach beyond this suite: a diagnostic that exists
everywhere except where it was needed is the same shape as OPEN_REPAIRS 101 —
a refused write leaving no server-side trace.

### D32 — The 46 stale pins are enforced or removed, and NEVER re-pinned by hand (2026-09-17, owner)

**After the merge. The prohibition is binding immediately.**

The pin sweep found 46 stale file-hash pins of 497, and **every one of them sits
where nothing running enforces it** — 174 of the 437 resolvable pins have no
checker any suite reaches. Each stale pin gets one of exactly two outcomes:

- **enforced** — something CI runs checks it, so it cannot rot silently again; or
- **removed** — the pin is deleted, because a pin nothing checks is not a
  safeguard, it is a claim that looks like one.

**What must never happen is the third option: quietly typing the current digest
into the old slot.** That converts a detected drift into an undetected one and
destroys the only evidence that the pinned thing moved. The prohibition holds
from today, before the merge, for every pin in the repository — the same rule
already stated for fingerprints in `CLAUDE.md` ("regenerate with
`scripts/ef-fingerprint.js` — never by hand") generalised to every file-hash pin.

Where a value legitimately has to move, it is re-derived **through the mechanism
that enforces it**, as `BUILDER_SHA256` was on 2026-09-17: one function both
checks the pin and produces it, and the new value comes from calling that
function.

Dated receipts are not in scope for "enforce or remove": a receipt records a past
tree and is allowed to go stale. What it is not allowed to do is be re-pinned,
which would make it a receipt for a run that never happened.

### D33 — The last two profile-name literals in the operator worker (2026-09-17, owner)

**Post-merge, same family as the line 33 fix.**
`test/helpers/install-operator-worker.mjs` still keys two things on the
profile's NAME rather than on the world:

- **line 17** — `if(profile==='observed67_optout'){assert.equal(seedBefore.length,1);assert.equal(seedBefore[0].row.auto_assign_opt_out,true);}`
  A conditional assertion: it checks the seeded opt-out row only in the
  `observed67_optout` world and is **silent everywhere else**, including in the
  settled world, which carries the same column and could carry the same row. A
  check that only runs under one name is not weaker than a wrong check — it is a
  check that does not exist for the other worlds.
- **line 48** — `populated_optout_preserved:profile==='observed67_optout'`
  A **reported** field whose value is derived from the profile's name rather than
  from anything observed. It will read `true` in the opt-out world whether or not
  the row was preserved, and `false` in the settled world whether or not it was.
  A receipt that restates its own input is worse than no field, because it looks
  like evidence.

Line 33 was the one that *refused a correct world*, so it was fixed on
2026-09-17 by measuring the column before the transaction and asserting it
unchanged after the rollback. These two do not refuse anything, which is exactly
why they can wait — and exactly why they would otherwise never be found.

Both derive from the world when they are done: the seed row's presence and its
flag are readable, and `populated_optout_preserved` becomes a comparison of what
was read before and after, not a restatement of `profile`.

### D34 — A gate that has never run against its real target is untested (2026-09-17, owner)

**Binding, and it generalises past this preflight.**

`scripts/linear-exit-deploy-preflight.js` had been written, reviewed, pinned
into a workflow and reasoned about for days. It executed against the live
database for the **first time on 2026-09-17, inside the step 19 dispatch**, and
refused **10 of 156 keys**. The release stopped at the gate rather than at a
plan, which is the gate working — and also the most expensive possible moment to
learn what it would say.

So: **run a lane's read-only preflight from the owner's machine before
dispatching**, never for the first time inside the dispatch. A read-only check
costs a minute outside the window and a whole authorized window inside it.

This is the same family as D27 (a stubbed gate is an untested gate) and D28 (the
code you changed executes before you push), one level up: those two are about
proving a change, this one is about proving a *check*. A check nobody has run
against the thing it checks is a hypothesis with a workflow step number.

### D35 — A revoke must name every role it means (2026-09-17, owner)

**Binding for every migration in this repository.**

Supabase grants `service_role`, `anon` and `authenticated` full rights on every
new object by default. Therefore:

- **a `revoke` list that omits a role has not revoked from that role**, and
- **"we revoked it" is not the same claim as "that role cannot do it"**.

Measured twice in one day, in both directions:

| migration | revoked from | left holding |
|---|---|---|
| 2026-09-06 native existing assignment | `public, anon, authenticated` | `service_role` EXECUTE |
| 2026-09-09 notification outbox (tables) | `public, anon, authenticated` | `service_role` TRUNCATE/REFERENCES/TRIGGER |
| 2026-09-09 notification outbox (sequences) | **nothing** | `service_role` UPDATE, `anon` USAGE, `authenticated` USAGE/SELECT/UPDATE |
| the first repair, 2026-09-17 | `service_role`, and `anon` on the sequences | **`authenticated`** USAGE/SELECT/UPDATE |

The 2026-09-05 guards that pass all read
`from public, anon, authenticated, service_role`. **Name all four, or measure
the ones you left out** — and prefer naming them, because a measurement is a
claim about one moment and a revoke is a claim about the object.

Both entries are also in `CLAUDE.md` under "Things that will waste a cycle",
where a session reads them in its first minute rather than on its fourth day.

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

### 2026-09-19 — The editor-picker regression was not in the ledger

The work was handed over as "the editor picker regression recorded in
OPEN_REPAIRS.md". It was not recorded there: the ledger's entries run to 213 and
none of them describes the picker, the 3,232-row parent population or the
greyed-out dropdown. The mechanism in the handover was accurate and matched the
code, so the fix went ahead on that description rather than on an entry, and the
entry was written afterwards as 214. Saying the ledger already held it would
have been the easy thing and would have been false.

### 2026-09-19 — The ledger entry moved to 216, and the note above is now half wrong

The note above says the editor-picker regression was not in the ledger and that
the entry was written afterwards as 214. The first half holds for the moment it
was written; the second no longer does. The owner filed the same regression from
the other side the same day — his report merged first and took 214, with an
unrelated entry taking 215 — so the fix entry moved to **216** when main was
merged in. Nothing in 214 was rewritten; 216 opens by pointing at it.

Two sessions can write the same ledger number on the same day, and the merge is
where you find out. Checking for duplicate `## N.` headers after a merge is
already the house rule; this is the case it was written for.

---

### 2026-09-19 — Intake closure documentation corrected after review

The intake plan had joined two different routes under the outbound flag. Current
source shows that outbound-off stops ordinary real-client, non-parity native
drains, including a straddling batch's normal drain, while direct browser legacy
webhook submission bypasses the flag. The plan now separates those paths,
preserves TEST/parity exceptions, requires identity-preserving disposition for
unfinished legacy work, and names all four browser fallback exits.

This was documentation-only: no live read, flag change, deployment, database
installation, workflow edit, or merge occurred. The public plan also now
distinguishes browser publication from database installation and Section 4
function deployment, and records the confirmed private location of the modular
strategy without copying it into the repository.

Related: [living checkpoint](LINEAR_EXIT_PREPARATION_CHECKPOINT_20260914.md) ·
[execution map](LINEAR_EXIT_EXECUTION_MAP.md) ·
[owner sitting page](LINEAR_EXIT_OWNER_SITTING_20260915.md) ·
[recovery procedure](LINEAR_EXIT_RECOVERY_PROCEDURE.md)
