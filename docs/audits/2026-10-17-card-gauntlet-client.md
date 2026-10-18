# Card gauntlet, client side (session Gauntlet Client, 2026-10-17 23:36 to 2026-10-18 01:30 UTC)

Owner's ask (via Lighthouse): "a complete testing of all our new features, most importantly the client calendar one ...
the clients will never have any hiccups with interactions on cards". This file is the CLIENT's review link. Session
Gauntlet does the staff side.

**How it was run.** A real Chromium (Playwright) against the **live site** (`syncview.synchrosocial.com`, the deployed
build, through the sandbox proxy) and the live backend, test client only. The link and its token come from
`qa/test-client-entry.js` inside the harness process (never printed or written). Every POST naming another client is
aborted; Linear is blocked. Harness: `qa/gauntlet-client/lib.js` (open the link, draw the stage, read a card back) and
`qa/gauntlet-client/seed.js` (throwaway review cards, and `--archive`). 29 throwaway cards were made and all 29
archived and verified at the end. One real card of the test client (with real video and thumbnail work items) was
answered by the client and then put back to "waiting on the client" by a real staff sign-in through the staff Sheet's
status menu (verified in the database).

**Limits.** This Chromium cannot decode the MP4 videos Frame.io serves ("could not be played here" on every real video;
a browser limit, not a site bug). For the player controls the video file request alone was answered with the repo's
own test clip (`test/fixtures/frameio-viewer-clip-vertical.webm`); everything else on the page was live.
Seeded cards have no work item, so their video and thumbnail answers are refused by design (`native_link_required`):
seeds test the caption, the real card tests video and thumbnail.

## Sidney's three sightings

| Sighting | Verdict | Exact steps |
|---|---|---|
| "Saving…" stuck after an approve | **Confirmed, fixed in #2173** | Open the link, open a post whose video and thumbnail are approved, click Approve the caption. The save answers in about 0.6 s and the saving flag clears at 0.53 s, but the stage shows "Saving…" for 4.8, 5.0, 5.1 and 13.5 s (four runs), over 30 s on a slow network, until an unrelated background reload. Same for Ask for a change on the last part. Cause: the finish step calls `_calReviewRemoveCard`, which finds no old card on the new page and returns without redrawing (`190-calendar-approval-comments.js.part`). |
| The stage blinking when switching parts | **Confirmed (Curtain files)** | Open any post, click Thumbnail, then Caption, then Video. Each click: the whole media box fades to 0.5% opacity for about 50 ms (the `.swap` fade, 150 ms out, 200 ms in), the conversation panel is rebuilt (empty for a frame, then refilled), the "waiting for you" strip is rebuilt (its thumbnails are new `<img>` elements and pop back in), and leaving the video step replaces the `<video>` element. Recorded frame by frame; no layout jump (stage height stays 534 px). |
| The old Notes dialog flashing on the client Sheet tab | **Not reproduced** | Watched `#calCommentsOverlay` every animation frame through: Review to Sheet to Month to Week and back (twice), a direct load landing on Sheet, Month and Review, clicking a Sheet card's body, its thumbnail, its Video door and its Notes button. It never flashed. The Notes button does open the old Notes dialog and keeps it open (by design today), so that may be what was seen. If it happens again, the exact click before it would pin it. |

## Every action tried (live site, 1440x900 unless said)

Timings are from click to the database holding the answer, unless said.

| Area | Action | Result | Time |
|---|---|---|---|
| Load | Open the link, stage drawn | Pass | 2.4 to 2.9 s (7.3 s with every backend call slowed by 2.5 s) |
| Strip | Click a post in "waiting for you" | Pass, opens it | 0.6 s |
| Review, caption | Approve | Pass (database right); stage stuck on "Saving…" (fixed in #2173) | DB within 1 s |
| Review, caption | Change my mind on an approved caption, Cancel | Pass, nothing sent | |
| Review, caption | Change my mind, empty box | Pass, Send disabled | |
| Review, caption | Change my mind with text and emoji | Pass: caption stays Approved, a note to the team is saved | 0.55 s save |
| Review, caption | Ask for a change, empty box (button and Enter) | Pass, nothing sent | |
| Review, caption | Ask for a change, 1,600 characters with emoji | Pass, whole text saved, Tweaks Needed | under 1 s |
| Review, caption | Edit the caption, Save | Pass: sent as a change request carrying the new text, caption itself unchanged | under 1 s |
| Review | Finish reviewing | Pass: next waiting post opens, toast "Done. Your team has ...". | instant |
| Review, real card | Approve the video (real work item) | Pass, video Approved, stage moves to Thumbnail | 1.4 s |
| Review, real card | Ask for a change on the thumbnail (real work item) | Pass, Tweaks Needed via production-write | 3.3 s |
| Review | Step bar: click each step | Pass (but see the blink above) | |
| Player | Load, play, pause | Pass (test clip, see Limits) | 1.5 s to ready |
| Player | Speed (1x, 1.5x, 2x, back to 1x) | Pass | |
| Player | Skip forward / back 5 s | Pass | |
| Player | Full screen | **Not offered** at 1440x900 and on a phone (see Other, 1) | |
| Player | Open in Frame.io | Pass, opens a new tab | |
| Conversation | Plain note ("Just a note") with emoji, quotes, `&` and `<tags>` | Pass: saved byte for byte, shown escaped, status unchanged | 1.3 s |
| Conversation | Note of 3,060 characters | Pass, saved whole, no sideways overflow | 1.3 s |
| Conversation | Part chip turns a note into a change; its x turns it back | Pass | |
| Conversation | Send a chip change | Pass, Tweaks Needed | 1.1 s |
| Conversation | Blank note + Enter | Pass, nothing sent | |
| Sheet | Scroll down and sideways | Pass | |
| Sheet | Notes button | Opens the old Notes dialog (stays open); Escape does not close it while its box has focus (Other, 4) | 0.08 s |
| Sheet | Video door on a real card | Opens Frame.io in a new tab (not the in-app player) | |
| Sheet | Type in the caption / call to action boxes | **Saved straight to the card** (Other, 2) | |
| Month, Week | Navigate | Pass; client sees "Unscheduled ... drag onto a day to schedule" and 55 draggable cards (Other, 2) | |
| Theme | Sun/moon to dark, refresh | Pass, dark kept after refresh, on all four tabs | |
| Help | "?" | Pass, hidden (no video address set yet) | |
| Phone 390 and 430, light and dark | Review, Sheet, Month, Week | Pass: stage under 2.2 s, no sideways scroll on any tab, Approve fully on screen | |
| Phone 390 | Tap Approve | Pass, saved; the stuck "Saving…" also shows here (fixed in #2173) | 1.2 s |
| Hard case | Double click Approve | Pass: one save | |
| Hard case | Five fast clicks on Approve | Pass: one save, no errors | |
| Hard case | Double click Send on a change | Pass: one change request | |
| Hard case | Enter twice fast on a change | Pass: one change request | |
| Hard case | Refresh 0.3 s after Approve, save held 3 s | Pass: approval landed, page agrees after reload | |
| Hard case | Back, then Forward, after switching tabs | **Back leaves the calendar** (Other, 3); Forward returns | |
| Hard case | Two tabs on the same post | **Fails** (Curtain, 1 and 2) | |
| Hard case | Offline, Approve, back online | Pass: "Sending... waiting for your connection to come back", sent by itself | 1.1 s after online |
| Hard case | Offline, Ask for a change, back online | Pass: words kept and sent by itself | 5.4 s after online |
| Hard case | Slow network (every backend call +2.5 s) | Pass for the save; "Saving…" never cleared in 30 s (fixed in #2173) | |
| Hard case | Stale page after a new deploy (deploy check answered with newer headers) | Pass: "A new version of SyncView is available" bar with Reload; text typed in a change request survives the check | |
| Staff side | Staff signed in on the live site, Calendar for the test client | Pass: all 16 cards touched here show the same status as the client page and the database | |
| Safety | Other-client writes, Linear calls, page errors | 0, 0, 0 on every run | |

## Open findings

### For the Curtain sessions (`188-review-stage-switch`, `195-review-stage`, `323-kasper-dashboard-tail`)

1. **A post answered elsewhere: "Ask for change" silently does nothing (serious: the client's words go nowhere and
   nothing says so).** Open the link in two tabs on the same waiting post. In tab B click Ask for a change and type
   some words. In tab A click Approve. Within 2 s tab B's strip drops the post and highlights a different post, while
   tab B's stage still shows the old post with the typed words. Click Ask for change in tab B: no save is sent, no
   message, the words stay in the box. (The old page's `_calReviewRequestTweak` returns early when the part is no longer
   waiting on the client; the stage shows nothing for it.) The same happens when the SMM or Kasper changes the post
   while the client is typing. Suggestion: when the part is no longer waiting, send the words as a note to the team on
   that part (what "Change my mind" already does) and say so, or at least tell the client it was already answered.
2. **A post answered elsewhere: the stage swaps to another post without a word (serious: a client can act on the wrong
   post).** Same two tabs, but tab B is only looking (no text typed). After tab A approves, tab B's next background
   refresh replaces the post on stage with another waiting post. A click on Ask for a change a few seconds later went to
   that other post (measured: the change request landed on a different card than the one the tester had opened). The
   title changes, but nothing draws attention to it. Suggestion: keep the answered post on stage marked "Approved (in
   another window)" until the client moves on, the way Finish reviewing already does.
3. **The blink on part switch** (see the table above): the media box fades fully out; the conversation and the strip
   are rebuilt on every switch (strip thumbnails pop back in); leaving the video step replaces the `<video>` element.
   Suggestion: cross-fade only the part that changes, never below about 0.6 opacity, and redraw the conversation and
   the strip only when their content changed.
4. **"Saving…" shows for up to a second even when nothing is slow.** Not the last part (redraw works): "Saving…" lasts
   about 1 s on the real video approve, and the green "approved, saved" flash fires in `_rsApprove` before the save has
   answered. If the save then fails the old page's error shows, but the word "saved" was already flashed. Suggestion:
   flash "Approved" at click, and "saved" only when the save answers.

### Other

1. **No Full screen for vertical videos at 1440x900 or on a phone.** The client stage's vertical player is 299 px wide
   at 1440x900 (218 px on a 390 phone); the shared player rule `@container (max-width: 300px)` in
   `020-styles-surfaces.css.part` hides Full screen and the length below 300 px. At 1920x1080 (400 px) it shows. Owner
   decision: show Full screen on narrow players (the play button has room at 218 px if the speed button gives way), or
   make the stage's vertical player at least 300 px wide at 1440x900.
2. **The client can overwrite the caption and call to action from the Sheet, and can drag posts to dates on Month and
   Week.** Steps: Sheet, click a card's caption box, type, click away: `calendar-upsert` saves the new caption straight
   to the card (same for Call to action; the title is read only). Month and Week show "Unscheduled ... drag onto a day to
   schedule" with 55 draggable cards. This is the old client page's long-standing behaviour, but it contradicts the new
   review page's rule that a client's caption edit is only ever a change request. Owner decision: make the client Sheet,
   Month and Week read only (except notes), or keep it.
3. **Browser Back after switching tabs leaves the calendar.** Review, Sheet, Month, then Back: the client lands on the
   page before the link (tab switches are not in the browser history). Forward returns. Low; a client who uses Back to
   "go back a tab" leaves the site.
4. **Escape does not close the Notes dialog on the client Sheet while its message box has focus** (it opens with the box
   focused, so Escape never closes it on first try). Clicking the backdrop closes it. Low.
5. **The update bar covers Finish reviewing at 1440x900** until dismissed (bar at the bottom centre, 566x52). Low.
6. **Video door on the client Sheet opens Frame.io in a new tab**, while the review stage plays the same video in place.
   Owner decision whether the Sheet's door should open the in-app player for clients too.

## What was fixed

- **#2173** (ready): `_calReviewRemoveCard` redraws the new review page when it is on, so "Saving…" clears as soon as
  the last answer on a post saves (6 s or more on main, 0.1 s with the fix), for the client and the SMM.
  Test `test/review-stage-saving-clears-browser.js` fails on main and passes with the fix.

## Not reached

- The supervisor inbox post (synchro-pipelines `supervisor/inbox/syncview.md`): adding that repository to this session
  was refused by the session's permission check, so the interim and serious findings are in this file and in the PR
  instead. Lighthouse, please relay Curtain findings 1 and 2.
- Real playback of Frame.io MP4s (browser limit, see Limits). A person on real Chrome should play one video once.

## Test data left behind

None from the seeds (29 made, 29 archived and verified). The real review card of the test client is back to "waiting
on the client" on video and thumbnail; its thumbnail keeps the change-request note "Gauntlet real thumbnail change",
and caption notes from earlier sessions are untouched.
