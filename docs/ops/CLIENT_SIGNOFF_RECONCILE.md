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
`now()` and never derived from the status. Deriving a sign-off from a status is
precisely the lie OPEN_REPAIRS 190 is about, pointing the other way. A change
request's body, author, round and clock come from `production_comments`. If the
server has no record, this job does nothing.

**A card that has moved on is never overwritten.** A committed action can be
superseded by later work, and finishing a stale write would undo it.

- A sign-off is restored only where the app's own `_calClearStaleApprovals`
  would keep it. That function is extracted from `index.html` at runtime, so
  this job and the browser can never disagree about what "stale" means.
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

Or `.github/workflows/client-signoff-reconcile.yml`, dispatch-only.
**It writes only on an explicit `dry_run=false`** — a missing or malformed input
reports and writes nothing.

- Reads need `SUPABASE_SERVICE_ROLE_KEY`: `mirror_outbox` and
  `production_comments` are not readable with the publishable key.
- Writes need `SYNCVIEW_STAFF_KEY` and go only through `calendar-upsert`, the
  same safe endpoint the other reconcilers use, so the overall pill and the
  stale-approval sweep are recomputed by the canonical path.
- `CAP` (default 25): a run wanting more repairs than the cap aborts without
  writing. A mass divergence is a bug or an incident, and a human should look
  before hundreds of client-facing rows move.

## Testing it

`test/client-signoff-reconcile.js` drives the real detection and patch
construction through fixtures — no credentials, no network. The cases that must
NOT repair are asserted first and in the most detail, because a false positive
here republishes settled work or duplicates a client's own words back at them.

The suite is proven by sabotage, not by passing: removing the stale-approval
gate, the closed-round gate, the body comparison, the commit-time stamp, or the
stale sweep each makes it fail. Re-run those controls if you change a rule.

## The false positive worth knowing about

The card stores comments as a JSON array, so a request containing a quote or a
newline is held escaped. Comparing the raw cell as text therefore reports a miss
on most real change requests. A first pass over live data called 78 of 82
requests lost on exactly that mistake; parsing the cell put the true number at
one. **Parse the cell, never grep it.** `test/client-signoff-reconcile.js` pins
this with a fixture whose body defeats a raw text search.
