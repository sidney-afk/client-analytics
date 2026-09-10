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

## What it repairs

Two shapes, both driven by something the server already committed:

1. **A missing sign-off stamp.** `mirror_outbox` holds a committed client
   approve, and the card carries no `client_<component>_approved_at`. The record
   says the work was approved but not that the CLIENT approved it, on a product
   whose service is client sign-off.
2. **A change request that never reached the card.** `production_comments` holds
   a committed client change request whose text is absent from the card's
   `<component>_tweaks`. The client asked for a change, the server has it, and
   nobody on the team can see it.

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
construction through fixtures — no credentials, no network. 49 checks, each
rule backed by a sabotage control that must fail the suite when the rule is
removed. Keep this number current: a runbook that publishes a stale count is
evidence a later session will plan against. The cases that must
NOT repair are asserted first and in the most detail, because a false positive
here republishes settled work or duplicates a client's own words back at them.

The suite is proven by sabotage, not by passing: removing the stale-approval
gate, the closed-round gate, the body comparison, the commit-time stamp, or the
stale sweep each makes it fail. Re-run those controls if you change a rule.

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
