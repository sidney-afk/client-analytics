# Client review ⇄ card reconciler

Completes a client review action the server already committed but whose card
never received it.

## The problem it solves

A client review action writes two legs: the gateway's `deliverables` row, then
the `calendar_posts` row humans read. The gateway leg is durable —
`mirror_outbox` records that it committed. The card leg runs in the client's
browser, and the repair journal that finishes it lives in that browser's
`localStorage`.

So the completion of a committed write depended on one particular browser
session surviving. OPEN_REPAIRS 189 put it plainly: a client met an error,
reported it and closed the tab, and a write the server had already committed sat
unfinished with nothing server-side able to complete it. Her card stayed stale
until an unrelated staff browser happened to project the canonical status back.

Events are the fast path; this job is the guarantee.

## What it repairs, and what it only reports

**It writes exactly one thing: a missing sign-off stamp.**

`mirror_outbox` holds a committed client approve and the card carries no
`client_<component>_approved_at`. The record says the work was approved but not
that the CLIENT approved it, on a product whose service is client sign-off.

**Change requests that never reached a card are DETECTED and REPORTED, never
written.** `production_comments` holds a committed client change request whose
text is absent from the card's `<component>_tweaks`; the job names the card, the
component and the request, and a person decides.

That split is an owner decision taken after **eight review rounds and 23
findings**, of which nearly every one since round 2 landed on delivery rather
than on stamps, and the last three rounds were each a defect created by the
previous round's fix. OPEN_REPAIRS 189 records the same pattern on the
browser-side attempt at this problem.

The asymmetry is in the problems, not the effort:

- a **stamp** repair reads a committed approve, checks for a later reopen, and
  writes one dated field. Nothing to match, nothing to merge.
- a **delivery** must decide identity across two systems with no shared ids,
  reconcile two lifecycle clocks, merge into a cell whose format predates ids,
  and survive a non-atomic two-step write. Round 8 ended at 8 live rows where
  the data cannot say whether delivering is a repair or a duplicate.

Detection stays fully wired, because the report is the deliverable for that
half. **The guard lives at the WRITE** (`WRITABLE_KINDS`, checked inside
`writePatch`), so no future edit to detection can make delivery writable by
accident — asserted directly, and negative-controlled both ways.

## The two rules that keep it safe

**Evidence repairs, it never invents.** Every value written comes from the
server's own record: a stamp is the *commit time of the client's approve*, never
`now()` and never derived from the status. That time is `source_edited_at`, when
the client's own write committed, not `processed_at`, which is when
`linear-outbound` finished carrying the row onward and on a retried delivery is
much later. Deriving a sign-off from a status is
precisely the lie OPEN_REPAIRS 190 is about, pointing the other way. A change
request's body, author, round and clock come from `production_comments`. If the
server has no record, this job does nothing.

**A card that has moved on is never overwritten.** A committed action can be
superseded by later work, and finishing a stale write would undo it.

- A sign-off is restored only where the app's own `_calClearStaleApprovals`
  would keep it. That function is extracted from `index.html` at runtime, so
  this job and the browser can never disagree about what "stale" means.
- **And the current status is not enough.** A client approves, the work is
  reopened (clearing the stamp), staff later advance it back to `Approved`: the
  card reads `Approved` again, but the client never saw the new revision. So a
  reopen *after* the approval supersedes it, ranked by the app's own
  `CAL_PRIORITY` after its own native mapper, with an unmapped status counted as
  a reopen. Only a move back BELOW `Approved` counts: a later `posted` or
  `scheduled` is the work progressing, and treating that as supersession would
  discard every genuine repair (measured on live rows, all of which had exactly
  such a forward transition).
- A change request is delivered only while the component is still in the review
  round (`Client Approval` / `Tweaks Needed`). Once it reads `Approved`,
  re-injecting a Tweaks-Needed request would reopen settled work and contradict
  a later decision — worse than the omission it fixes.

Everything it declines to repair is reported with its reason, so "left alone" is
never silent.

## Running it

```
node scripts/client-signoff-reconcile.js                      # DRY-RUN
node scripts/client-signoff-reconcile.js --apply              # write
node scripts/client-signoff-reconcile.js --client=<slug>      # one client
node scripts/client-signoff-reconcile.js --fixtures=f.json --json   # offline
```

Or dispatch it from the Actions UI, which is where the owner runs it:

**https://github.com/sidney-afk/client-analytics/actions/workflows/client-signoff-reconcile.yml**

**It writes only on an explicit `dry_run=false`** — a missing or malformed input
reports and writes nothing.

- Reads need `SUPABASE_SERVICE_ROLE_KEY`: `mirror_outbox` and
  `production_comments` are not readable with the publishable key.
- Writes need `SYNCVIEW_STAFF_KEY` and go only through `calendar-upsert`, the
  same safe endpoint the other reconcilers use, so the overall pill and the
  stale-approval sweep are recomputed by the canonical path.
- `CAP` (default 25): a run wanting more repairs than the cap aborts without
  writing. The value is validated, not just coerced: a typo like `25x` exits
  rather than becoming `NaN`, which every comparison would answer false and so
  bypass the abort entirely. A mass divergence is a bug or an incident, and a human should look
  before hundreds of client-facing rows move.

## Testing it

`test/client-signoff-reconcile.js` drives the real detection and patch
construction through fixtures — no credentials, no network. 159 checks, each
rule backed by a sabotage control that must fail the suite when the rule is
removed. **That number is asserted by the suite itself** — this line said 64
after round 12 added ten, which is exactly the stale evidence a later session
would plan against, so keeping it current is no longer left to whoever
remembers. The cases that must
NOT repair are asserted first and in the most detail, because a false positive
here republishes settled work or duplicates a client's own words back at them.

The suite is proven by sabotage, not by passing: removing the stale-approval
gate, the closed-round gate, the body comparison, the commit-time stamp, or the
stale sweep each makes it fail. Re-run those controls if you change a rule.

## An entry the client never sees cannot be a delivery

Two forms of the same rule, both taken from the app rather than restated.

**Audience.** Eligibility is `_calMsgAudience`, **extracted from `index.html`**
alongside `_calNormStatus` and `_calClearStaleApprovals` rather than restated —
because that is the function `_calCommentsForView` actually calls on these
cells. Calendar defaults only `kasper` and `smm` to internal; everything else
without an explicit `audience` is client-visible, including a role this job has
never seen and an entry with no role at all.

Two wrong versions preceded it, and both are worth knowing about. A **blacklist
of six staff roles** admitted every role nobody thought to add and ignored
`audience` entirely. Replacing it with the **Production surface's**
normalization — which defaults every non-client role to internal — was closer
but still wrong for these cells, and would have reported delivered requests as
absent for exactly the roles the two surfaces treat differently. The direction
is not "staff cannot deliver": **779 live root entries carry role `smm` with
audience `client`**, and the app shows those to the client.

`_calCommentsForView` applies **three** rules and the audience function is only
one of them: it also drops every `role: 'kasper'` message outright ("never
expose Kasper authorship" — a hard exclusion that beats an explicit
`audience: 'client'`), and it judges a reply by its thread **root's** audience,
not its own. All three are mirrored here, the last one by resolving the root out
of the **same prefiltered list** the renderer indexes: it drops tombstoned and
hidden entries *first* and only then builds its id map, so a hidden root is
absent from it and a surviving reply falls back to its own audience. Indexing
the raw cell instead resurrects that root.

One deliberate divergence from the renderer, and only one: a **deleted** entry
claimed by id is still a claim here, because the client withdrew their own
request. It is excluded from the root map (as the renderer excludes it) but not
from being claimed.

The same predicate gates the **exact-id** claim. An id match is the strongest
evidence this job has and still is not evidence of delivery: an internal root is
hidden from the client exactly as a `hidden` one is.

## An entry the app never renders cannot be a delivery

`hidden` is the app's audit-suppression flag. `_calCommentsForView` filters it
out for **every** audience, and `index.html` names the case it exists for:
"legacy cross-client feedback that bled onto the wrong client's row". So a
hidden twin claiming a client's request would declare it delivered while the
client cannot see it — and would do so most readily on exactly the cross-client
mess the flag was created to bury. Refused on both claim passes; live, 4 cells
carry one. Tested for **truth**, not for `=== true`: the renderer filters on
`!c.hidden` and these cells hold schema-less JSON, so `hidden: 1` or
`hidden: "true"` is invisible in the app and must be refused here too.

A **deleted** entry claimed by id is deliberately still a claim: the client
withdrew their own request, and re-delivering it would reopen a component over
something they took back. Withdrawn is not the same as unseen, and a first draft
of the hidden rule collapsed the two.

## Identity: why matching is a consume, not a search

Two things make "is this request already on the card?" harder than it looks.

- The card usually stores the request under `native_comment_id`, not the
  `production_comments` row id. Measured live: **the row id matches 4 card
  entries, the native id matches 57.** Comparing only the row id leaves the body
  doing all the work.
- Body alone cannot tell repeats apart. A client asking for the same thing again
  in a later round would be matched against the first round's entry, and their
  new request would stay invisible.

So each card entry is **consumed by at most one server request**: ids claim
their entry first, then bodies claim what is left. Two identical requests on the
server need two identical entries on the card, or one is missing. Counting
rather than existence-checking makes repeats work without depending on the two
systems agreeing about round numbers, which they do not always (2 of 317 live
body matches sit on a different round).

## Outbound delivery is not source commit

A row exists in `mirror_outbox` because the **native write committed**. Its
`status` describes what the Linear carrier did *afterwards*: `pending` while in
flight, then `written`, `skipped` or `stale`.

Filtering the read on `written` therefore equates delivery with commit, and
hides a reopen whose delivery is pending or was skipped. An invisible reopen is
precisely what lets a stale approval be restored. So every row is read, and the
two uses are deliberately **asymmetric**:

- **supersession** (leave the card alone) considers every row, whatever the
  carrier did;
- **repair** (touch the card) still requires a `written` client approval.

Both directions err toward leaving the card alone. `source_edited_at` must also
be named in the projection: without it the code that prefers the client's own
clock silently falls back to `created_at`, which is the kind of bug that passes
every fixture test and is wrong in production.

## Cards are keyed by (client, id), never by id

`calendar_posts` has the composite primary key `(client, id)`. Card ids are
**not** globally unique: 13 live ids are used by more than one client, and 17
deliverables point at one of them.

So every lookup, every consumption tally and the pre-write re-read are keyed by
client **and** id, and a deliverable that names no client resolves to no card at
all rather than being guessed. Keying by id alone would let one client's card
stand in for another's, and on an apply run that writes a client's approval, or
their own words, onto a different client's card. `deliverables.client_slug` and
`calendar_posts.client` both hold the slug, so they compare directly here (this
is not true of `calState.client` in the browser, which holds a display name).

## An incomplete cell is not an empty one

`stringifyComments` and the merge RPC drop entries without ids. So rebuilding an
array over a cell that holds them **destroys real client words** that simply
predate the id field. Valid JSON that is not an array, and any array holding an
id-less or non-object entry, are therefore refused as unreadable rather than
treated as empty — the same judgement the browser's `_calLoadCommentsField`
makes. Refusing costs a missed repair; treating it as empty costs the content.

## Identity on the WRITE side, not just the read

The delivered entry carries `native_comment_id || id`, because the browser's
canonical projector and its source-repair journal both key on the native id. If
this job completes a closed browser's failed leg and that browser later resumes
its journal, an atomic merge keyed on a different id keeps **both** copies and
the client sees their own request twice. Detection recognises either id, so
writing the native one makes server-side and browser recovery converge.

## Resolution travels with the request, and carries no status change

**103 of 345 live client requests carry a resolution.** A request that never
reached the card but has since been resolved is still missing, and still worth
delivering — but **as resolved and with no status move**. It carries
`resolved_at` and the resolver into `done` / `done_at` / `done_by`, and the
component status is left exactly where it is.

Carrying `done` while still flipping the component to `Tweaks Needed` would have
been the worst of both: settled work reopened, and the stale sweep then
stripping a sign-off on the strength of a request nobody is waiting on.

## A partial repair is detectable, and finished later

`calendar-upsert` merges comments and updates scalars as **two separate
operations** (`writeCalendarRow`). If the merge commits and the update fails,
the request is on the card with the status leg never applied — and presence
alone would suppress the finding forever, leaving the round at `Client Approval`
with an unanswered request on it.

So every delivered entry carries `recovered_by: 'client-signoff-reconcile'`, and
a claimed entry bearing that marker, for an unresolved request, on a component
still reading `Client Approval`, is reported as an **unfinished status leg** and
repaired with the status alone. The marker scopes it to this job's own
unfinished work: an ordinary card sitting at `Client Approval` can never match.

## Paged reads are ordered

Offset pagination without a total order is not stable: each page is a separate
query, and a row can be skipped or repeated between pages. The outbox read alone
exceeds one page. A **skipped** row is the dangerous direction: if it is a later
reopen, the supersession test never sees it and a stale approval is restored. So
`restRows` refuses to run without a unique order column, checked before the
credential because a missing order is a defect in every environment.

## Where the card and the source snapshot disagree, the card wins

`loadWorld` reads the source comments once; the pre-write re-read happens later.
So `pc.resolved_at` can be stale while the card already shows the entry as done.
The unfinished-status-leg pass therefore refuses any claimed entry marked `done`
or `deleted`, whatever the snapshot says: the card was read later, so it is the
better evidence, and the failure it prevents is moving a resolved component back
to `Tweaks Needed` and stripping its sign-off.

## One thing deliberately NOT repaired, with the number behind it

A resolved request whose round has since closed is **reported**
(`review_round_closed_resolved`), never written.

Since resolved patches are status-neutral, restoring one would reopen nothing,
so this is a judgement rather than a safety rule. The judgement rests on a
measurement: **100 resolved requests sit on closed rounds and not one of them is
missing from its card.** Writing them would repair nothing today while making a
class of 100 closed cards writable, and this job's standing bias is to leave a
card alone. Reporting them under their own reason keeps the rows visible in a
dry run rather than silently forgotten.

Re-check with the query in OPEN_REPAIRS 197g. If that count ever stops being
zero, the gate is one line to relax.

## Revalidation refreshes every source detection used, not just the card

Five sources now: the card, the source comment row, the deliverable, the status
transitions, and the deliverable's committed client requests. The last one was
added a round late — client requests became a supersession clock while
revalidation still refreshed four, which is this rule being written down and
then not applied. The stamp path carries no `finding.comment`, so the refresh is
keyed to the **deliverable**, not to one comment id.

The suite asserts this against the source rather than through fixtures, because
the failure mode is a read that never happens, and no fixture can show you a
query the code does not make.

Before each write the job re-reads **the card, the source comment row, the
deliverable, and the deliverable's status transitions**. Each was added because the previous scope
was not enough:

- the **card** alone misses a resolution that happened only on the server;
- the **source row** alone misses a reopen, which lives in the outbox;
- a component reopened after `loadWorld` and returned to `Approved` before the
  write passes `stampSurvives` on the fresh card while the reopen is invisible,
  and the obsolete approval gets restored.

The **deliverable** is re-read too: `move-card-client.js` rewrites
`deliverables.client_slug` and `calendar_posts.client` as two separate PATCHes,
and a revalidation landing between them would otherwise resolve through the
stale mapping and stamp a card mid-move.

All four are keyed reads scoped to the one row being repaired.

## Every row that takes part in a repair must agree about the client

`scripts/move-card-client.js` moves a card between clients by rewriting
`calendar_posts.client` and `deliverables.client_slug`. Historical rows in
`mirror_outbox` **and** `production_comments` keep the client they were written
for. Resolving purely through the deliverable's *current* client would stamp the
new client's card with the previous client's sign-off, or report the previous
client's request as missing from the new client's card.

**The check lives in `resolve()`, once, for every source.** It is not optional:
`resolve()` takes the row's own client as a required argument and throws if a
caller omits it, so a new source cannot be wired in without answering the
question. An absent client is treated as absent (legacy rows), a *different* one
is refused.

This was fixed twice. Round 9 closed it inline for the outbox; round 10 found
the identical hole one table over, in comments. That is why it is structural
now rather than per-table — **identity here is never a single column, and the
next source will not remember to ask.**

Zero live rows in either table today; one card move creates them silently, and
both fields are always populated, so the check costs nothing.

## A card id is a pointer, not a link

`deliverables.card_id` is a plain text column with **no foreign key**, and it is
written by one side only. Following it forward and stopping there accepts a card
that never named this deliverable back: a stale pointer left by a re-link, or a
Samples deliverable whose `card_id` happens to name a real same-client calendar
card, would resolve to a card and produce a writable stamp on it.

The product's own canonical rule is the full crosswalk.
`_prodCrosswalkMismatchFields` (`index.html`) accepts a deliverable as
describing a card only when origin, team, `client_slug` and `card_id` all agree,
and treats unknown as not-linked — because acting on a half-link is what erases
a card's real comment history.

So `resolve()` requires the link to close both ways:

- the deliverable must carry `origin='calendar'`; Samples belongs to sxr and
  `manual` to neither surface. This is decided **before the card lookup** and is
  a silent skip, not a refusal: another surface's card is not missing, and
  reporting it as a lost Calendar approval is a false alert;
- the deliverable's `team` decides which slot must name it back
  (`video_deliverable_id` for `video`, `graphic_deliverable_id` for `graphics`),
  using the app's own component→team map inverted;
- where `kind` maps to a component it must agree with `team`. The two are
  independently constrained columns, so a row carrying `kind='video'` with
  `team='graphics'` cannot say which review it belongs to, and is refused;
- a `kind` this job maps to no component — `other` is live, with
  `team='graphics'` — still resolves, through its team.

The validated component **travels with the resolution**. Deriving it again at
the call site from `kind` is what made a `kind='other'` approval vanish: the
link check accepted it through the graphic slot and the caller then produced
neither a repair nor a report line. Every refusal now writes a line into
`skipped`; a committed client approval disappearing silently is the one outcome
this job must not have, because the report is what a person acts on.

That contract reaches the **narrow write filter** too. Only a row the carrier
actually wrote is ever acted on, but an approval whose carrier status is
`pending`, `skipped`, `stale` or a failure is precisely what an operator is
hunting when BOTH legs went wrong — the outbound never landed and the browser
never wrote the card. It is reported as `carrier_did_not_write`, and only after the SAME two
supersession tests the written path runs — a stamp missing because the work was
reopened, or because the component has since moved below Approved, is missing on
purpose, and reporting it sends a person after nothing. A false lead in a report
is the same class of harm as a false repair.

Of the five such rows live, four are already stamped and would be noise, and one
is a lost client approval this job named nowhere before. A report nobody can act
on is worse than a shorter one.

**The suite runs the entry point.** It did not, and that cost the worst defect
in this PR: extracting the summary left `main()` naming buckets that no longer
existed in its scope, so every run — dry-run and apply alike — died with
`ReferenceError` before writing anything, while 83 offline checks passed and CI
stayed green. A suite that never executes the program cannot tell you the
program runs. Two checks now drive the real CLI in a real process over fixtures,
and `classify()` returns the buckets rather than only the lines, so no caller
can name a grouping that is not there.

**`null` means deliberately out of scope, and nothing else.** It used to mean
two opposite things: a card that is archived or outside a `--client` run (a
decision, correctly silent) and a crosswalk that is structurally broken —
deliverable missing, no card id, no client, card gone (a lost client approval
nobody will hear about). Both vanished identically. Every structural failure now
names itself and is reported on both paths; only the deliberate cases stay
silent. Live: 2 written approvals name a card that is not there, and they were
invisible until this.

The same holds for a committed client **REQUEST** whose card cannot be found:
reporting lost requests is the entire delivery-side result, so filing one under
"a card that moved on" buries the one thing an operator can act on. It carries
its deliverable, its client and its request id, and claims nothing about a card
leg it could not look at.

**Every detail line names its client**, not just its card id: `calendar_posts` is
keyed by `(client, id)` and 13 live ids are shared across clients, so a bare id
does not say whose card to open. This is **enforced, not remembered**: a skip row
that names a card without naming a client throws. Three consecutive rounds found
one more row missing it, each fixed where the reviewer pointed; the contract ends
that.

**Deliberate exclusions are decided before any refusal is produced.** Archived
first, then the surface, then the crosswalk — because a stale reverse link on an
archived card is not a broken crosswalk, it is a card the report promises to
suppress. Round 22 learned this for the surface and round 26 for archived.

**Which reviews a linked deliverable can carry** is the importer's contract, not
the reverse-link fields: `scripts/f42-card-comment-import.js` says "graphic ->
Graphics; every video/caption/title thread shares the Video deliverable". So
caption and title on video-linked work are normal (74 of 347 live client tweaks)
and caption or title on graphics-linked work is malformed. Expressing this
through `REVERSE_LINK_FIELD` alone could never have worked, since caption and
title have no reverse link of their own.

**A named component that contradicts the validated link is refused, not
resolved.** `production_comments.component` has no constraint tying it to the
deliverable's team, so a malformed or imported row can name `video` on work whose
validated binding is graphic. Trusting the label reports the request as absent
from the wrong review.

**A stale reverse link is not a missing card.** `resolve()` located the exact
row and only the link back failed, so the refusal carries that card and the
report says so — counting or printing it as "cannot be found" sends an operator
after a card that is sitting right there.

**A carried approve whose card is missing is its own kind of work** — once
another surface has been excluded. Live: all the approvals whose Calendar card
could not be found were Samples rows whose cards live on sxr; among
calendar-origin approvals the count is **zero**. The carrier
wrote, so it is not a carrier failure; the card cannot be found, so it is not a
card that moved on. It counts under NEEDS A PERSON in its own term and prints
the deliverable and the client, because `card (unidentified) [] left alone:
card_not_found` names nothing anyone can look up. A cross-client approval is
deliberately NOT in this bucket: there the card exists and belongs to someone
else.

**The `--client` scope is applied before any refusal is produced.** A run
advertised as limited to one client must not report or count another client's
rows, or the operator is sent to investigate work they did not ask about. Scoped on **the row's own client**, with the deliverable only as the legacy
fallback: after `move-card-client.js` runs, historical outbox and comment rows
still carry the previous client while the deliverable carries the new one, so
preferring the deliverable would put the old client's rows in the new client's
run and hide them from their own. Rows that do resolve are then re-checked
against the card's client.

**A row whose card cannot be identified does not claim the card leg failed.**
The four qualifying tests — stamp already present, a later reopen, a later
client request, current status — all need a card. A crosswalk refusal has none,
so running them is impossible and asserting their conclusion would send someone
after a loss that may not exist. Such a row is still reported, because nothing
else in the system names that approval, but its claim is narrowed to what is
known: the carrier did not write, the card cannot be identified, and whether the
card leg landed is unknown.

Considered and rejected: following the half-link anyway to read the stamp. That
is the exact trust the crosswalk gate exists to refuse, and using it to
*suppress* a report would let a mis-linked card hide a real loss. Resolvable
rows are unchanged and still get all four tests.

The summary distinguishes the two carrier failures, because only one of them
knows what happened to the card leg: a **resolved** one was qualified against
four tests, so "reached neither leg" is established; a **crosswalk refusal**
establishes only that the carrier did not write. A headline that asserts what
the detail line explicitly calls unknown is the same defect one level up.

The summary's own counts are a rule, not decoration: the workflow tells the
operator to read them, so `summaryLines()` is a pure exported function and the
suite asserts the bucketing. A lost client approval counts under **NEEDS A
PERSON**, not under "left alone" — a run whose only result was that one row used
to print `NEEDS A PERSON: 0`.

This lives in `resolve()` next to the client rule, for the reason round 10
established: identity questions answered per call site get answered
inconsistently. Rounds 9, 10 and 11 were all the same shape — identity taken
from one side — in three different places.

Live shape when the rule was added: **1,394 of 1,394** calendar-origin
deliverables with a card id reverse-link correctly; all **56** Samples-origin
card ids resolve to no same-client calendar card at all. Zero rows are affected
today, and one re-link creates one silently, as a write.

### The projection is part of the rule

A fixture sets whatever field it likes, so a rule can pass every offline case
while being **inert in production** because the real query never fetches the
column it reads. That is exactly how this job's first `source_edited_at` fix
shipped doing nothing. Three columns were added to the reads for this rule, so
the suite asserts the projections themselves: every deliverable read must
project `origin` and `team`, and every card read must project both reverse-link
columns.

## The latest committed approval sets the clock; only a written one can repair

A row exists in `mirror_outbox` because the **client's write committed** — its
status describes what the carrier did afterwards. So a later approve whose
carrier skipped is still the client's most recent act, and stamping the earlier
one would date the sign-off to a superseded event while the same run reported
the newer one as lost.

The asymmetry that has held since round 1 is preserved exactly: **every
supersession test runs against the WRITTEN approve's time**, and only the value
written to the card comes from the broader set. An unwritten approve can correct
the clock; it can never rescue a stamp that a reopen or a client request has
already refused.

Live, all three such pairs are a client re-clicking about two seconds later
after the `operation_forbidden` error — item 189's own incident, and one of them
is the card this job was written for. Treating the newer row as a supersession
would have discarded that repair. It is the same event, not a new decision.

## A later client request supersedes an approval, and the outbox cannot say so

A change request commits its comment leg and its status leg **separately**. When
the status leg fails there is no transition for the reopen test to find, and the
component can still read `Approved`. Restoring the older stamp there claims the
client signed off on work they had since asked to change — while the same run
separately reports their request as `review_round_closed`. Two halves of one
contradiction, and the falsest positive this job could produce.

So the committed client requests already loaded for the delivery half are also a
supersession clock: a request newer than the approval blocks the stamp
(`superseded_by_later_client_request`) and suppresses the lost-approval report.

A request whose component this job cannot map supersedes **nothing**: the report
declines to say which review it belongs to, so the clock must not decide it
either. The deliverable's link is the fallback only for an EMPTY name, which is
the one case with nothing to contradict.

That clock is keyed by **(deliverable, component)**, not by deliverable. One
deliverable carries the video work *and* the caption and title reviews, so
keying by deliverable alone let a caption request supersede a video sign-off it
had nothing to do with. A request supersedes the review it belongs to, and no
other.
Live: none of the four repair candidates has a later client request, so it
changes no repair today.

## The race this does not close

Between the read and the write, a client or a colleague can move the card. Every
repair is therefore **revalidated against a freshly read row immediately before
writing**, by re-running the whole detection rather than re-checking a few
fields by hand, so the revalidation cannot drift from the rules.

That narrows the window to one round-trip. It does not close it. A true fix
needs a compare-and-set on the write, and the Calendar status lane carries
none: payloads have neither `expected_status` nor `expected_updated_at`, and
`production-write` requires them on the `production` surface only
(OPEN_REPAIRS 189, finding 2). Closing it properly is Edge Function work and is
deliberately not smuggled in here. Repairs are rare and the job is dispatched,
so the residual exposure is a few seconds per row.

## The false positive worth knowing about

The card stores comments as a JSON array, so a request containing a quote or a
newline is held escaped. Comparing the raw cell as text therefore reports a miss
on most real change requests. A first pass over live data called 78 of 82
requests lost on exactly that mistake; parsing the cell put the true number at
one. **Parse the cell, never grep it.** `test/client-signoff-reconcile.js` pins
this with a fixture whose body defeats a raw text search.
