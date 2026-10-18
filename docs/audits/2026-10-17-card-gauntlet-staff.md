# Card gauntlet, staff side (session Gauntlet, 2026-10-17 to 18)

Every staff action on a Calendar card, on the test client only, in a real
browser (Playwright, Chromium) against the live backend through the courier
(`qa/sxr_courier_lib.js`). Throwaway unlinked cards only; every card archived
and verified at the end. Counts and timings only, no client names.

## Outcome in one paragraph

63 of 64 existing card probes passed against the live backend (the one red,
`p96_description_image_upload.js`, needs a secret this sandbox does not have,
not a product bug). The new hard-case probe found one product problem: **a card
save that failed while offline stayed "Save failed · Retry" after the network
came back, and the text stayed unsaved until someone clicked Retry.** Fixed in
PR #2188 with a mocked test that fails on main; measured live after the fix, the
caption reached the database about 2.6 s after the network returned, with no
click. Two other cases looked like lost saves at first and turned out to be the
page's own designed safety notices (details below).

## What was tried

### Existing probes re-run live (`node qa/run-probes.js`, nightly manifest, 2 attempts)

63 pass, 1 environment failure. Covered: status of every part through all three
actors (p14, p34, p36, p57, p71), notes send / edit / resolve / delete, Team only
vs Client can see, replies, unread dots (p08, p23, p39, p40, p55, p60 to p64,
p72 to p76), Kasper approve, approve after tweaks, Finish, undo, close (p45,
p53, p54, p87), client ask for a change and approve (p51, p61, p78, p79),
schedule, post, archive (p48, p58), date reschedule (p69), caption generation
and regenerate races, intercepted (p31, p32, p38), double and concurrent
approvals (p26 via p84), concurrent comments and statuses (p42 to p44, p65,
p80), realtime to the client link (p49, p70), cross-client isolation (p56),
thumbnail cache-bust (p67), title review (p47), alt caption (p52).
Also `qa/probes/ot4_t1_smm_calendar_writes.js`: 22 of 22 (date, thumbnail,
caption, status pill, reload).

### New: `qa/probes/gauntlet_staff_card_hard_cases.js`

| Case | Result | Save time (action to row) |
|---|---|---|
| 6,000-character caption | pass in 3 of 4 runs; one run did not land in 40 s (not reproduced, see open findings) | 4.4 s, 5.9 s, 5.9 s |
| Emoji, accents, quotes and markup in caption | pass, byte for byte | 1.5 to 1.8 s |
| Emoji rename | pass | 1.1 to 1.2 s |
| Emptied caption | pass, row empty, mark not stuck | 1.2 to 2.0 s |
| Three caption saves inside a second | pass, last wins and stays | 1.3 to 4.8 s |
| Two tabs, different fields | pass, both survive | 3.7 to 6.3 s |
| Two tabs, same field (tab two had not seen tab one's text) | by design: tab two shows "Someone else changed this while you were editing, so yours is not saved yet" with Keep mine / Use theirs; Keep mine saves it | Keep mine 2.6 s |
| Refresh while the save is still leaving the browser | by design: the typed text is put back in the box with "Restored your unsaved text · Discard" and is not sent on its own; clicking in and out saves it | n/a |
| Slow network (every card write held 4 s) | pass, the page never claims Saved while waiting | 8.8 to 10.0 s |
| Offline, then back online | **failed on main** (stayed red until clicked). **Fixed** in #2188 | 2.6 s after back online |
| Client link shows the final name, caption, two-tab caption | pass | n/a |

### New: `qa/probes/gauntlet_staff_card_views.js` (written, not yet run)

Month drag to another day, Week drag, archive pressed twice fast, browser Back
and Forward, and the card at 1440 and 390 wide in light and dark. It was written
at the end of the time box and **has not been run**: the session lost permission
to run shell commands before it could. Run it with
`python3 -m http.server 8000 & node qa/probes/gauntlet_staff_card_views.js`.

## What was fixed

- PR #2188, `src/index/170-calendar-links-status.js.part`: when the browser comes
  back online, every card whose save failed for lack of a network (or of the
  saving-switch check that runs first) is retried, exactly as if Retry was
  clicked. A save the server answered and refused is left for the person.
  Staff pages only. Test: `docs/syncview-design/tests/cal-offline-resend-browser.js`
  (fully mocked, fails on main, passes on the branch), in calendar-unit-tests
  part 3.

## Open findings

1. **One 6,000-character caption save did not land within 40 s** (1 run of 4).
   Not reproduced. Steps: seed a card on the test client, type a caption of about
   6,000 characters into the Sheet caption box, blur, read `calendar_posts.caption`.
   If it repeats, look at the card-write timing for large bodies.
2. **After a reload, a caption box once read empty or old** (B and C, 2 runs of 5).
   Probably the courier boot being slow (the card had not rendered yet), not a
   wrong value; the probe now waits up to 45 s for the card and 8 s for the fresh
   load and says which it was. Re-run to settle it.
3. **The restored-draft case is not resent on its own.** By design (the shared
   draft rule says a draft is never sent by itself), and the page says so. A
   question for the owner, not a bug: should a caption restored after a refresh
   be saved automatically when nobody else changed the card meanwhile?

Not tried in this time box: Create Post through the real "+" (it mints real
work items; the mocked `prod-write-gateway-browser.js` covers it and passes),
attaching and opening files, play, thumbnail title prompt, Notify client, filters,
sub-issues. These need a next session.

## For the Curtain sessions

Nothing found in `188-review-stage-switch.js.part`, `195-review-stage.js.part` or
`323-kasper-dashboard-tail.js.part`. The new Review tab for the switched-on test
client was not driven by these probes beyond the client link reads above.

## Not done

- The inbox message in synchro-pipelines: adding that repository was refused by
  the session's permission check. The serious case (the stuck offline save) is
  fixed in #2188 instead.
