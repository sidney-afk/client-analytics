# Booking Recovery Dispatch: the "run only when something is due" gate (step C)

Status 2026-10-01: the **proof piece is built and passing; nothing is switched** and no n8n workflow was edited.
Plan: `docs/plans/2026-09-30-n8n-exit-phase-2.md`, step C. Owner decision: yes, but prove first.

## What exists now

- `scripts/booking-recovery-gate.js`: the pure "is anything due?" test (`gateShouldRun(pendingRows, bookedRows, nowMs)`).
- `test/fixtures/booking-recovery/select-due.n8n.js` and `safety-gate.n8n.js`: the live workflow's own Select Due and Safety Gate
  code, copied word for word from version `ca93c4bf-fa15-4961-91d2-71921ecbc711` (read 2026-09-30, 21:58 UTC edit).
- `test/booking-recovery-replay.js` (unit job): runs that live code in a sandbox over 32 fictional queue rows plus 2 booked rows at
  known times (due exactly on the hour, due in the same hour someone booked, a person who just booked with the phone written
  differently, booked or customer in HubSpot, already emailed with the text owed, opt-out, expired, armed before launch, nothing to
  send, phone only, email only, an unreadable time zone and date, not yet due, already finished, test-tagged, eight due at once
  against the cap of 5 per run, a different time zone). It applies the same row updates the Mark steps make and compares:
  - **A** the workflow every hour (today) against **B** the same hourly ticks with the chain run only when the gate is true:
    identical sends (text, channel, send time, order), identical closures, identical final rows, and wherever the gate said
    nothing is due the live code would also have done nothing. The chain ran 23 of 121 hours.
  - **C** a check every 10 minutes (what a database timer would do): the same messages and channels, none missed, none twice,
    none later than today; the only text difference is the "tomorrow or <day>" wording for a row whose send crosses local midnight,
    because C sends earlier. The chain ran on 105 of 721 checks.
  - Every row is also replayed alone, so a gate that wakes late for one kind of row cannot hide behind another due row.
  - Mutation check done by hand when it was written: dropping any one gate rule, or making the due test an hour late, fails it.
- No message is ever sent by the test. Test people are `example.invalid` addresses and 555-01xx numbers. The test client
  `sidneylaruel` is not involved.

## Why it is not switched on

The recovery queue is an **n8n data table** (`booking_recovery`) written by Sales, Booking Recovery Capture (iClosed) and
Sales, Doctors Partial Lead Capture, and read by Dispatch and the Heartbeat. A database timer in Supabase cannot read it, and
Supabase has `pg_cron` but not `pg_net`, so nothing in our database can wake the workflow either. The plan's wording ("a
`pg_cron` timer runs the same test") assumed the queue was in Supabase. It is not. Dispatch was also edited on 2026-09-30 and the
Doctors capture workflow was created that day, so another session is working on these workflows.

## What switching would take (needs the owner's go; each step is an edit to a live sales workflow)

1. Additive table `booking_recovery_gate` in Supabase, a mirror of the pending, booked and sent columns the gate reads.
2. The three writers (both captures and Dispatch's Mark steps) also write that mirror. Mirror drift is the main risk: a row
   missing from the mirror is a recovery that never sends.
3. Install `pg_net`; a `pg_cron` job every 10 minutes ports `gateShouldRun` to SQL (the replay test's rows become its test) and,
   only when true, calls a new webhook trigger on Dispatch.
4. Keep the hourly schedule running beside it for one week with a check that the two never disagree, then remove the hourly one.
   Test recipients only: the test client's and the owner's own address.
5. Undo: restore the saved earlier Dispatch version (brings the hourly schedule back) and turn the cron job off.

Cheaper alternatives are in the step C summary (leave it hourly, or go to every 2 hours, or wait per lead from the capture
workflow). The saving at stake is about 600 n8n runs a month.
