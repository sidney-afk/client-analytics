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
