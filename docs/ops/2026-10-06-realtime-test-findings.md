# Live updates between open screens: test findings (2026-10-06)

Session Relay. Question: when someone changes a status (or anything else) in
SyncView, does a second open screen show it straight away, with nothing
depending on Linear?

Method: two real headless browsers side by side (staff + staff, plus a third
screen on the client link where one exists), each with its own live connection
to the real backend. The test client only. Timings are from the moment the
change was made on one screen to the moment the other screen showed it, with no
refresh. "Push" is when the live message reached the screen; the rest is the
screen redrawing. Phone runs used a 390 x 844 touch screen. No code changed,
nothing deployed, no migration applied, no n8n workflow touched. Counts and
timings only: no client names, slugs, keys or people appear here.

Rule applied: slower than about 5 seconds, or needing a refresh, is a bug.

## Result table

| Area | What was changed | Desktop | Phone | Verdict |
|---|---|---|---|---|
| Calendar, one change at a time | status, caption, date, name, link, delete, client link appears and disappears | 1.7 to 2.7 s | 2.3 to 2.7 s | Pass |
| Calendar, a second change soon after another | status step right after another step, caption after create | 5.4 to 6.9 s (up to 13.7 s) | 5.5 to 6.8 s (caption after create 10.1 s, rapid pair 13.7 s) | **Fail** (finding 1) |
| Calendar, thumbnail link edit | paste a link | 5.5 s | 5.4 s | Borderline fail |
| Production, status | every step, 9 changes | 2.1 to 4.3 s | 3.7 to 4.9 s | Pass |
| Production, comments | add a comment | not seen within 30 s (4 s, 38 s or never within 60 s in other runs) | not seen within 25 s, push 26.7 s later | **Fail** (finding 2) |
| Production, assign and unassign | not run | n/a | n/a | Not tested (finding 6) |
| Samples, add / status / delete | add, 5 status steps, delete | add 3.2 to 4.4 s, status 2.1 to 3.5 s, delete 2.3 to 2.5 s | add 3.9 s, status 1.8 to 2.1 s, delete 2.1 s | Pass |
| Samples, from the client link | client approves, client asks for changes | 2.8 s, 3.5 to 3.8 s | 2.3 s, 3.6 to 4.6 s | Pass |
| Workload, status | 5 to 6 status changes | the board is told in 1.2 to 3.4 s and refetches (about 3.8 to 4.0 s) | told in 1.2 to 1.9 s | Partial (finding 4) |
| Workload, assignee | not run | n/a | n/a | Not tested (finding 6) |
| Batches | created and edited along with the Calendar posts above | same as Calendar | same | Pass, assignee not tested |
| Templates | edit one field on each screen | 0.7 s and 0.5 s | not run | Pass |
| Filming plans | code reading only | no live path | no live path | **Fail** (finding 3) |
| Network cut 30 s | cut A, change on B three times and rename, reconnect | caught up 4.6 s after reconnect, delete 4.3 s | not run | Pass, with finding 5 |
| Write-refusal log | window 19:00 to 21:30 UTC | see below | | Reported |

## Findings, worst first

1. **Calendar: a change made soon after another one takes 5 to 14 seconds to show.** The live message arrives in about 1.3 to 2.1 s, but the screen will not reload more than once every 8 seconds, so the second change waits. Steps to reproduce: open the same client's Calendar on two screens, change a card's status, then change another status on that card (or edit the caption right after creating the card) within about 8 s. The other screen shows the second change 5 to 7 s late (10 to 14 s when three changes land inside the window). Isolated changes are 1.7 to 2.7 s. The wait is `CAL_V2_RT_MIN_RELOAD_MS` (8000) in `src/index/115-core-calendar-flags.js.part`, used by `_calV2OnRealtimeChange` in `150-calendar-hydration-import.js.part`. Fix: apply the pushed card row straight into the open screen, or lower the floor to about 2 s for card-field events.
2. **Production comments never reach the other screen live.** Steps: open the same work item on two screens, post a comment on one, watch the other. The comments table is closed to the browser's public key (by design), so no live message exists; the other screen only sees it on its slow poll (30 s, or 90 s when the live link is up), and in repeated runs it saw it after 4 s, 38 s or not within 60 s. Fix: when a comment is saved, also bump the work item's own row (which the screen already listens to), so the other screen fetches the comments.
3. **Filming plans have no live path at all (found by reading the code, not run live).** The page loads once when opened, and again only on the Refresh button; there is no live listener and no poll. Two people editing plans will not see each other until one refreshes. Fix: a short poll while the page is open, or a live listener on the plans table.
4. **Workload: the board is told quickly but the visible numbers could not be proved to change.** The live message arrives in 1.2 to 3.4 s and each one makes the board download its whole snapshot (about 2 MB) again, every time, from every open board. The test work item is unassigned, and the board counts per person, so the counts did not move. I did not assign a real editor (it could notify them). Fix for the cost: ask for only the changed item, or wait a few seconds and fetch once.
5. **After a network drop the live link stays in an error state.** After the 30 s cut and reconnect, the screen caught up on its own in 4.3 to 4.6 s, but only because the 30 s fallback poll took over; the live link still reported an error at the end of my window. Everything shown was correct, so this costs bandwidth and about 30 s of worst-case delay, not correctness. Worth confirming that it re-subscribes eventually.
6. **Not tested:** assign and unassign (the test actor is refused with `assignee_out_of_scope` for the test client's work, and the only people it could assign are real editors), Workload assignee, a Production client link (none exists), Filming plans live, Templates and Network cut on a phone screen.
7. **Thumbnail link edits take 5.4 to 5.5 s,** just over the line, for the same reason as finding 1 (a link edit makes the Calendar reload the work-item link as well).

## Write-refusal log (server side, 19:00 to 21:30 UTC, whole system)

37 rows. By surface and reason:

| Count | Surface | Reason | Whose |
|---|---|---|---|
| 14 | Calendar | artifact_not_resolvable (409) | this run: asking for "For SMM Approval" on a thumbnail with no link, which is the correct refusal |
| 2 | Samples | artifact_not_resolvable (409) | this run, same cause |
| 3 + 3 | Production | assign refused, assignee_out_of_scope (403), plus the matching server rows | this run, deliberate attempt, then dropped |
| 2 | Calendar | invalid_staff_key (401) | this run, before the key swap was set up |
| 1 | Calendar | network_failure | this run, the 30 s network cut |
| 5 + 5 | Production | write_conflict and team_is_linear_authoritative (409) on fixture work items | an automated fixture, not this run |
| 2 | other | upload rejected (500) | not this run |

Nothing in the log shows a real save being lost during the run. The reason
code `team_is_linear_authoritative` still exists (and is still tested), though
Linear is gone; it is only the name, not a dependency.

## Clean-up

27 test cards archived, all test work items cancelled (the last 6 were Sample
work items). Left behind by design, one item: a test note field on the test
client's template row (`rt_probe_note`, a short test string). Delete it in the
Templates editor if wanted. Nothing else was written.

## Re-test after PR 1981 (2026-10-07)

Session Relay. Same method as above: two real headless browsers side by side
(plus a third on the client link where one exists), the test client only,
timings from the change to the other screen showing it, no refresh. The page
under test is the live build: the live site's page matched the merged main
build byte for byte (compared by hash), and the new comment-signal column is
readable on the live database. Phone size was re-run for the Calendar only.
No code changed, nothing deployed, no migration applied, no n8n workflow
touched. Counts and timings only.

Rule applied again: slower than about 5 seconds, or needing a refresh, is a bug.

### Result table

| Item | Before | Now | Verdict |
|---|---|---|---|
| Calendar, second change right after another (7 trials, gaps of 0.3, 2, 4, 6, 9 s) | 5.2 to 6.6 s when the gap was under 4 s | 1.7 to 2.2 s in every trial | **Fixed** |
| Calendar, run of caption status changes (9 steps) | 5.4 to 6.9 s | 1.9 to 2.4 s | **Fixed** |
| Calendar, run of status changes on video and thumbnail work items (17 steps desktop, 8 phone) | 5.4 to 6.9 s | Desktop: 8 of 17 took 6.3 to 8.4 s, the other 9 took 2.0 to 2.9 s. Phone: 2 of 8 took 6.6 s, the rest 2.2 to 3.1 s | **Still fails in part** (finding A) |
| Calendar, thumbnail link edit | 5.4 to 5.5 s | 2.1 s desktop, 2.1 s phone | **Fixed** |
| Calendar, caption edit right after creating the card | 2.4 s desktop, 10.1 s phone | 4.1 s desktop, 4.1 s phone | Pass (desktop 1.7 s slower, phone 6 s faster) |
| Calendar, two caption changes 1.5 s apart | 13.7 s | 6.1 s desktop, 6.8 s phone (timed from the first click) | Better, still over 5 s |
| Production, comment added | not seen within 30 s (4 s, 38 s or never in other runs) | 1.9 s and 2.3 s | **Fixed** |
| Production, status (9 steps) | 2.1 to 4.3 s | 2.3 to 6.0 s, 8 of 9 under 4 s | Pass (one 6.0 s step had a 3.2 s server save) |
| Filming plans, edit on one screen | never, only after a refresh | 12.5 s, 12.9 s and 8.9 s with no refresh (a 20 s poll) | Works, but over 5 s by design (finding B) |
| Workload, one status change | board told in 1.2 to 3.4 s, refetch done about 3.8 to 4.0 s | told in 1.2 to 1.4 s, one 2 MB download, finished 5.1 to 5.2 s after the change (4 runs) | Works, about 1.2 s slower, just over 5 s (finding C) |
| Workload, three changes about 1 s apart | one 2 MB download per event | 2 downloads | Cheaper |
| Network cut 30 s, catch-up after reconnect (3 runs) | 4.3 to 4.6 s, live link left in error | 8.9, 8.9 and 9.2 s; the live link is back to SUBSCRIBED at about 8.5 s | Fixed the stuck link, slower catch-up (finding D) |
| Network cut, delete made while offline | 4.3 s | 8.8 s in all 3 runs | Same as above |

### Isolated change per area (nothing got slower except where noted)

| Area | Before | Now |
|---|---|---|
| Calendar: date, name, video link, delete | 1.7, 2.2, 2.3, 2.3 s | 1.9, 2.3, 2.1, 2.7 s |
| Calendar: create a card | 4.1 s | 3.7 s |
| Production: status | 2.1 to 4.3 s | 2.3 to 3.9 s (one outlier above) |
| Samples: add, status, delete | 3.2 to 4.4, 2.1 to 3.5, 2.3 to 2.5 s | 3.5, 1.9 to 2.2, 2.2 s |
| Samples: client approves from the link | 2.8 s | 3.1 s |
| Templates, both directions | 0.7 s and 0.5 s | 0.6 s and 0.5 s |
| Workload | see above | slower by about 1.2 s |

### What is left

A. **Calendar status changes on video and thumbnail work items can still show 6 to 8 seconds late.** The new fast path (about 1.8 s between reloads) works for caption changes and for any two changes. A run of status changes on a card with a video or thumbnail work item makes two to three row writes per change, so a quick run reaches the "5 or more foreign events in 15 s" limit, which keeps the old 8 s floor (`CAL_V2_RT_STORM_EVENTS` and `CAL_V2_RT_STORM_RELOAD_MS` in `115-core-calendar-flags.js.part`). That match is from reading the code and the pattern of the numbers (the same steps were 2 s when taken alone); I did not instrument the counter. To reproduce: change one video status three or four times within about 15 s on two open screens. Fix idea: count events per card change instead of per row write, or raise the limit to about 10.
B. **Filming plans catch up in 9 to 13 s, not 5.** The new poll runs every 20 s, so the wait is anywhere from 0 to 20 s. No refresh is needed, which was the bug. If 5 s matters, shorten the poll (a cheap read) or add a small change signal like the comments one.
C. **Workload is about 1.2 s slower for a single change** because the board now waits 3 s to gather changes before one download. A busy board downloads less. If the extra second matters, collect for 1 s instead of 3 s. As before, the visible counts could not be shown to move: the test work item is unassigned and I do not assign real editors.
D. **After a network cut the screen re-connects, but later.** The live link now recovers by itself (it stayed in error before), yet the first update arrives about 9 s after the network returns, against about 4.5 s before (when a backup poll happened to fire). The new link re-subscribed at about 8.5 s in the run that timed it. Likely the reconnect backoff; the `online` signal in the test browser may not behave like a real phone regaining signal, so a real network may differ. Worth one check on a real phone.

### Not re-tested

Assign and unassign (same reason as before), the other areas on phone size (Production, Samples, Templates, Filming plans, Workload, network cut), and the Samples "client asks for changes" step (the test script lost the client card in this run, so there is no new number; it was 3.5 to 3.8 s on 2026-10-06).

### Write-refusal log (01:20 to 02:07 UTC, whole system)

14 rows. Four are from this run and expected (a thumbnail asked for "For SMM Approval" with no link). Eight are the same automated fixture rows as last time (write conflict and a team refusal on fixture work items). Two are upload errors (500) that are not from this run. Nothing shows a lost save.

### Clean-up

One test card archived and every test work item cancelled (0 left open, 0 live test cards). The Filming plan note for the test client was put back to its original text. One test note field from the first run is still on the test client's template row.
