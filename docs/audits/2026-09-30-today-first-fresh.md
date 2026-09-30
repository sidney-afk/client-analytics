# Today: when fresh items reach the screen, before and after (2026-09-30)

Owner's complaint: in the morning Today shows yesterday's saved list for a moment and swaps in
fresh data 1 to 2 seconds later. Wanted: feels immediate, and never yesterday's items as current.

## How this was measured

`node qa/today/today-first-paint-measure.js` (new). Headless Chromium signed in as the environment's
staff member (an admin), on the real backend, read only: Today never writes. Note that Today never
lists the test client (rule in `098-smm-clients`), so the test client cannot appear in these numbers;
the requests are the same for any account of that role. Median of 5 cold loads per row.

The sandbox browser cannot trust the egress proxy certificate, so every request is fetched by Node
(real site, real backend, real server time) and handed to the browser. The phone profile adds what a
4G link adds on top (60 ms round trip, one shared 9 Mbit/s link, text compressing about 3x) and 4x
slower CPU. Treat phone numbers as a model that is the same for before and after, not a lab
measurement. The desktop live row is the site as people use it today (before the fix).

"Fresh on screen" is the moment the fresh answer is written back to the saved copy, which happens
just before the repaint. "Saved copy from an earlier day" is the case the owner described: a copy
written at 23:00 yesterday, inside the old 24 hour limit.

## What Today did (before), live, desktop, one run

19 requests. Everything started at about 540 ms, after the app script had loaded and run, and
the staff check had answered. Then:

- 6 first reads (clients, the two card reads, the next 14 days of posts, the roster): 150 to 550 ms.
- Only after those, 11 "is this card a parent" checks, each 1 to 2 seconds. The database view
  behind them rebuilds every row's JSON for each filter, so each check costs a near full scan
  whatever it carries; eleven at once slow each other down. This was the biggest single cost.
- The member's own email read (`team_members`) ran last, alone, after everything else.
- The result then waited for Clients Info from the analytics read (about 1.2 s after start).

## What changed

1. Reads start from the `<head>` script, while the app script is still downloading (same pattern as
   Workload's early read), as soon as the early staff check (already started there) says yes. A
   rejected or unreachable check loads no staff data at all; `qa/boot/staff-entry-gate.js` holds that
   line (a first version that started the reads before the check failed it, and was fixed). The tab takes each answer once, by exact URL, only for the same member and
   inside a minute; a mismatch just makes the tab read for itself. A test asserts every early URL is
   the exact URL the tab asks for, so drift cannot silently lose the speed-up.
2. The parent check drops rows that could never reach the page (stale open cards) and sends the rest in
   batches of 300 ids instead of 80: 11 requests became 1 (an address of 11 KB; the gateway refuses 29 KB).
3. The member email read starts with the others.
4. A saved copy is stamped with the day it was written and is painted only on that same day. An
   answer held in memory past midnight is dropped too. Yesterday's list now gives the loading shape,
   never a list that looks current.

Not changed (owner rules): Today still waits for Clients Info, because "current clients" comes from it.
That is now the floor, roughly 1.1 s on desktop. Owner priority 1 (analytics database on for every
client) removes most of it.

## Numbers (median of 5, ms from navigation start)

Cold (a first visit), fresh items on screen:

| profile | before | after |
|---|---|---|
| desktop | 3,727 | 1,709 |
| phone, typical 4G (modeled) | 14,185 | 5,224 |

Morning case (saved copy from an earlier day present):

| profile | before: yesterday's list shown at / fresh at | after: what shows first / fresh at |
|---|---|---|
| desktop | 610 (yesterday's list, all 5 runs) / 3,055 | loading shape at 475, never yesterday's list / 1,690 |
| phone, typical 4G (modeled) | 3,724 (yesterday's list, all 5 runs) / 9,349 | loading shape at 2,220, never yesterday's list / 5,001 |

Requests: 19 before, 9 after (7 of the 9 start together at about 470 ms, when the staff check answers, instead of in two waves from 540 ms).
Live desktop before, one run: fresh at 2,858 ms with 19 requests (same shape as the local row).

## Way back

Revert the commit. Nothing on the server changed (no migration, no function), so there is nothing to
undo there. An old saved copy without the day stamp is simply ignored once.
