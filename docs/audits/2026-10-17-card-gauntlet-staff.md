# Card gauntlet, staff side (session Gauntlet, 2026-10-17 to 18)

Every staff action on a Calendar card we could reach in the time box, on the
test client only, in a real browser (Playwright, Chromium) against the live
backend through the courier (`qa/sxr_courier_lib.js`). Throwaway unlinked cards
only; every card this session made was archived and verified at the end. Counts
and timings only, no client names.

## Outcome in one paragraph

One product problem found and fixed: **a card save that failed while offline
stayed "Save failed · Retry" after the network came back, and the text stayed
unsaved until someone clicked Retry** (reproduced twice live). Fixed in PR #2188
with a mocked test that fails on main; live on the branch the caption now reaches
the database 2.6 to 3.5 s after the network returns, with no click. Everything
else held: 63 of 64 existing card probes pass live (the one red needs a secret
this sandbox lacks), and the two new probes end at 46 of 46 and 31 of 31. Two
cases that first looked like lost saves are the page's own designed safety
notices, shown honestly.

## What was tried

### Existing probes re-run live (`node qa/run-probes.js`, nightly manifest, 2 attempts)

63 pass, 1 environment failure (`p96_description_image_upload.js`: no
`SYNCVIEW_STAFF_ACTOR` secret here). Covered: status of every part through all
three actors (p14, p34, p36, p57, p71), notes send / edit / resolve / delete,
Team only vs Client can see, replies, unread dots (p08, p23, p39, p40, p55, p60
to p64, p72 to p76), Kasper approve, approve after tweaks, Finish, undo, close
(p45, p53, p54, p87), client ask for a change and approve (p51, p61, p78, p79),
schedule, post, archive (p48, p58), date reschedule (p69), caption generation and
regenerate races, intercepted (p31, p32, p38), double and concurrent approvals
(p84), concurrent comments and statuses (p42 to p44, p65, p80), realtime to the
client link (p49, p70), cross-client isolation (p56), thumbnail cache-bust (p67),
title review (p47), alt caption (p52). Also `ot4_t1_smm_calendar_writes.js`:
22 of 22 (date, thumbnail, caption, status pill, reload).

### New: `qa/probes/gauntlet_staff_card_hard_cases.js` (final run 46 of 46)

| Case | Result | Save time, action to row |
|---|---|---|
| 6,000-character caption | pass in 4 of 5 runs (see open finding 1) | 3.9 to 6.6 s |
| Emoji, accents, quotes and markup in caption | pass, byte for byte | 1.3 to 1.9 s |
| Emoji rename | pass | 1.1 to 1.3 s |
| Emptied caption | pass, row empty, mark not stuck | 1.2 to 2.0 s |
| Three caption saves inside a second | pass: last wins, stays, shows after reload | 1.3 to 4.8 s |
| Two tabs, different fields | pass, both survive | 3.6 to 7.5 s |
| Two tabs, same field (tab two had not seen tab one's text) | by design: tab two shows "Someone else changed this while you were editing, so yours is not saved yet" with Keep mine / Use theirs; Keep mine saves it; tab one shows it after reload | Keep mine 2.2 to 2.6 s |
| Refresh while the save is still leaving the browser | by design: the typed text is back in the box with "Restored your unsaved text · Discard" and is never sent on its own; clicking in and out saves it | saved again 2.0 s |
| Slow network (every card write held 4 s) | pass, the page never claims Saved while it waits | 8.8 to 10.9 s |
| Offline, then back online | **failed on main** (stayed red until clicked). **Fixed** in #2188, passes live on the branch | 2.6 to 3.5 s after back online |
| Client link shows the final name, caption and two-tab caption | pass | n/a |

### New: `qa/probes/gauntlet_staff_card_views.js` (final run 31 of 31)

| Case | Result | Time |
|---|---|---|
| Month: drag a card to another day | pass: row, day cell and client link all have the new date | 4.1 s |
| Week: drag to the next day | pass | 2.7 s |
| Archive pressed twice fast, then confirm pressed twice | pass: one confirm, one archive, no error, gone from the Sheet and the client link | 1.9 s |
| Back and Forward | pass: the card keeps its date (switching Sheet / Month / Week adds no history entry, so Back leaves the Calendar) | n/a |
| 1440 and 390 wide, light and dark | pass: card renders, no sideways scroll, no JS error | n/a |

Harness notes for the next session (also in the probe headers):
- Headless Chromium does not start a native HTML5 drag from mouse events
  (`page.dragAndDrop` times out), so the probe dispatches the same drag events on
  the real pill and day cell.
- Serve with `qa/pages_static_server.py`, not plain `http.server`: the page
  rewrites its address to `/calendar/<slug>`, and a reload there is a blank 404
  on a plain server. That, not the app, caused every "after reload" red in the
  middle runs.
- The Sheet saves through `calendar-card-write`, not `calendar-upsert`; a probe
  that slows or blocks only `calendar-upsert` tests nothing.

## What was fixed

- PR #2188, `src/index/170-calendar-links-status.js.part`: when the browser comes
  back online, every card whose save failed for lack of a network (or of the
  saving-switch check that runs first) is retried, exactly as if Retry was
  clicked. A save the server answered and refused still waits for the person.
  Staff pages only (a client link's answers already have their own resend).
  Test: `docs/syncview-design/tests/cal-offline-resend-browser.js` (fully mocked,
  fails on main, passes on the branch), in calendar-unit-tests part 3.

## Open findings

1. **One 6,000-character caption save did not land within 40 s** (1 run of 5,
   not reproduced). Steps: seed a card on the test client, type a caption of
   about 6,000 characters into the Sheet caption box, blur, read
   `calendar_posts.caption`. If it repeats, look at card-write timing for large
   bodies.
2. **Leftover test cards on the test client.** Several older seeds from other
   probes and sessions (not this one) are still live on the test client's Sheet.
   Worth a sweep by whoever owns those probes.
3. **A question for the owner, not a bug:** a caption restored after a refresh is
   never sent on its own (the shared draft rule). Should it save automatically
   when nobody else changed the card meanwhile?

Not tried in this time box: Create Post through the real "+" (it mints real work
items; the mocked `prod-write-gateway-browser.js` covers it and passes), attaching
and opening files, play, thumbnail title prompt, Notify client, filters, and the
new Review tab driven live. These need a next session.

## For the Curtain sessions

Nothing found in `188-review-stage-switch.js.part`, `195-review-stage.js.part` or
`323-kasper-dashboard-tail.js.part`. The new Review tab was not driven live here.

## Not done

- The inbox message in synchro-pipelines: adding that repository was refused by
  the session's permission check. The serious case (the stuck offline save) is
  fixed in #2188 instead.
