# State of things

Find any running piece and its owner in the [SyncView Atlas](ATLAS.md).

**Read this first.** One short, true list of what is open, what is switched off on
purpose, and what is already done even though an older doc still calls it open.
Every line below was checked against the live system on **2026-09-26** (read-only
SQL on `syncview_runtime_flags`, tables and row counts; the live Edge Function
list; the n8n workflow list). Where a doc and the live system disagree, the live
system wins and this page says so. Counts only, no client names.
Lines marked **(measured 2026-10-09)** were re-checked that day by session Shipwright
(OPEN_REPAIRS 389); the owner's remaining steps are one ordered sitting in
[`docs/ops/OWNER_SHIP_LIST.md`](ops/OWNER_SHIP_LIST.md), and `node scripts/repo-vs-live.js`
prints repo vs live for the whole shelf.

When you close or change something here, update its line in the same PR. If a
line is older than a week, re-check it before relying on it.

---

## Messages inbox: what counts as new, New/All switch, live badge (session Hush, 2026-10-18): PR open

Automatic records (a client's caption-change note, anything the system writes) never count as new, never raise the badge. Kasper's inbox counts only staff messages; the managers' inbox keeps counting what people write to them. One New/All switch (opens on New, "No new messages" when calm). The badge refreshes by itself: realtime on the cards, a ping from other tabs, and a 30 s safety net. Server side in `production-comments/inbox.mjs` (auto-deploys on merge, no migration). OPEN_REPAIRS 438; test `node docs/syncview-design/tests/messages-new-view-browser.js`.

## Client link in a dark browser (session Dusk, 2026-10-18): PR open

Owner report: with dark saved, opening the client review showed a white loading screen, not in the page's shape. Four
causes, all measured on the live site (test client) and in the fixture. (1) A browser that had not yet seen this link
switched on painted light until the switch read landed (about 1 s of white); the head script now also reads the other
list the app already keeps (`sv-rs-on-clients`, written by every switch read, staff pages too, keyed by slug so any
spelling of the link finds it) and paints dark and review-shaped when it names the client or says all. (2) A switch read
that failed or timed out (it gives up at 4 s) made the app FORGET the link, so the next visit was white: a read with no
answer now leaves the memory alone. (3) The loading screen lacked the page's "?" button (the live page shows it, which
moved the tabs 49 px and shrank them on a phone), had the step and answer buttons at the wrong size and place, and the
phone's step row 12 px off: all now within 6 px at 1440 and 390, light and dark. (4) Still true and left alone on
purpose: a browser that has never read the switch (no list names the link) shows light until the read, because a client
link stays light when the new page is not on for it; and the app does not follow the operating system's dark setting
anywhere (the sun/moon button is the only switch). Test (fails on main): `node test/client-link-dark-first-paint-browser.js`.

## Upload form never loses a send (session Keepsake, 2026-10-18): PR open

Audit of the upload link and the Submit tab against every failure path (`docs/audits/2026-10-18-upload-form-never-lost.md`,
OPEN_REPAIRS 436, `node docs/syncview-design/tests/upload-never-lost-browser.js`). Fixed: a full or refused browser store no longer stops
typing or sending, no cross-tab lock no longer blocks a send, plain "Not sent yet / received" words, a refused saved send puts the
form back before it is discarded. New: `production-write` stores the raw request first in `intake_raw_submissions` and lists it for staff
(`intake_raw_list`); **the migration must be applied by Lighthouse** (the gateway copes without it). Not done: Safari and Firefox passes, a staff
screen for the list, archiving one live test batch on the test client.

## Client review page finishing touches (session Rail, 2026-10-18): PR open

The six open notes of client gauntlet 2, done (`node test/review-stage-finish-polish-browser.js`): Finish reviewing stays
off with a "Saving…" hint while an answer is being sent; the not-saved box speaks plain words (no "Linear issue", no raw
code; the code stays in the server-side refusal report); the speed button stays on the review page's vertical player
at desktop widths (1024 and up; the clock gives way, a phone keeps Full screen and drops speed); the client link opens
on Review whenever it is opened fresh (Back and Forward between tabs inside a visit unchanged); on the client's Month
and Week a post's thumbnail opens the in-app viewer (nothing opens for a post with no video); unsent change-request
words (and their part) are kept in browser storage per client link (`syncview_rs_drafts_v1:<client>`), cleared when sent,
when the post leaves the list, and after 7 days, and the page works with storage blocked. Still not done: a real
video or thumbnail answer on a real card (needs a staff sign-in).

## Client review gauntlet 2 (session Gauntlet Client 2, 2026-10-18): PR open

Live walk of the client link on the test client (196 checks, report `docs/audits/2026-10-18-card-gauntlet-client-2.md`).
Five small bugs fixed with a test (`node test/review-stage-gauntlet2-browser.js`): a post that leaves the list while the
client types is now named in a notice (the words used to follow silently to another post); unsent words are kept per
post; a long caption scrolls inside its card; Escape closes the Notes box and the not-saved box from anywhere on the
client link; arrow keys work with nothing focused. Not done: a real video or thumbnail answer on a real card (needs a
staff sign-in to put it back), and keeping unsent words across a reload (a design question in the report).

## Public "start here" page at /start (session Foyer, 2026-10-18 about 01:05 UTC): PR open, live once merged

`syncview.synchrosocial.com/start` is the page Synchro Social's social media managers send to clients and
videographers instead of the Google Drive folder of guides. It is standalone (`start/index.html`, `start.css`,
`start.js`, images in `start/assets/`), not part of the app build: no login, no app scripts, no backend calls, no
analytics, the font self-hosted. Round 2 (session Foyer 2, 2026-10-18 about 01:58 UTC, Sidney's feedback) made it a
short static page: it opens on "Start here" with a switch, "Review content" (the review tutorial, 1:19, in a copy of
the review page's player, straight from the Wistia MP4, no Wistia script, never autoplays) and "Upload content" (where
to upload, the five folder rules and the drawn folder tree). Below that, four large cropped pictures (watch / approve
or ask for a change / talk to your team / see what is coming), then questions. No scroll effects (the eye lens and the
scroll tour are gone). The old upload tutorial is off the page on purpose (it showed a real client's details and the
retired Linear step); a new upload video goes in the marked place in `#panel-upload` of `start/index.html` when it is
made. `#upload` and `#review` open a side; the older `#videographer` and `#client` links still work. Screenshots are demo data only (client "Alex Morgan",
analytics, the font self-hosted. It says what SyncView is, shows the review page through an "eye" that opens as you
scroll, walks through watch / approve or ask for a change / talk to the team / see what is coming, then plays the two
tutorials (review 1:19, upload 1:18) in a copy of the review page's player, straight from the Wistia MP4 files (no
Wistia script, never autoplays), with the five folder rules beside a drawn folder tree. "I am a videographer" (or
`/start/#videographer`) hides the client-only review video. Screenshots are demo data only (client "Alex Morgan",
four demo posts). Published because `start` is in `PUBLISHED_DIRS` (`scripts/pages-site.js`). Test:
`node test/start-page-browser.js`. To change the wording or a video, edit `start/index.html`.

## Client Month and Week bring back undated posts, read only (session Ledge, 2026-10-18): PR open

Owner decision, 2026-10-18: on the client link's Month and Week, posts with no date show again under "Not scheduled yet (N)",
as a read-only list above the grid (same pills as the staff Unscheduled list, no drag, no drop, no date control, reachable
by keyboard, hidden when there are none). A post opens exactly as a dated one does. The Collaborative-mode-off rule is the
same as for dated posts: an unfinished undated post stays hidden. Staff Month and Week are unchanged. This refines the
Pane section below, which removed the list for clients. Test: `node test/client-calendar-read-only-browser.js`.

## Client link Calendar is read only, video door opens the viewer (session Pane, 2026-10-18): PR open

Owner's two decisions, 2026-10-18, for the client link only (staff pages unchanged). (1) On the client Sheet the caption,
call to action and date are read only, Collaborative mode on or off (a blank "suggest a post" card the client is writing
stays editable); Month and Week no longer drag posts and no longer offer the "Unscheduled ... drag onto a day" list;
Notes still work; the new review page's caption edit for a post waiting on the client is a separate path and is
unchanged. Sheet card reordering (drag by the grip) was a separate, earlier owner decision and was not changed.
(2) The Sheet's Video button opens the Notes view with the video on the left and the notes on the right, behind the
same `frame_viewer_clients` switch as the staff Calendar; with the switch off, or for a link the viewer cannot play, it
is the old Frame.io link. Test: `node test/client-calendar-read-only-browser.js`.

## New review page, layout C (session Marquee, 2026-10-17): merged, on for the test client and the owner only

The owner approved the client page (layout C, "Guided stage") and the SMM and Kasper versions of it on 2026-10-16.
It is a new view beside the old one (`src/index/188-review-stage-switch.js.part` reads the switches;
`src/index/195-review-stage.js.part` is the page, its own on-demand area `reviewstage`, downloaded only when a switch
says yes). Turning a switch off brings the old page back on the next load. Test: `node test/review-stage-browser.js`.

**The switches** (rows in `syncview_runtime_flags`, read once per page, fail closed: missing, unreadable or the wrong
shape is the old page; the lists live only in the database):
- `review_stage_client_pages` `{ "clients": [...] }`: the client's review link and the SMM's Calendar Review tab for those
  clients. (Not named `..._clients`: several browser tests answer every `_clients` key with "on".)
- `review_stage_kasper_staff` `{ "staff": [...] }`: Kasper's Review Session, only for the signed-in staff member whose
  roster id or full name is listed.
- `review_help_video_url` `{ "url": "https://..." }`: the tutorial video behind the client page's "?". Empty or missing
  hides the button. The video is made later by another session.
- `analytics_hidden` `{ "hidden": false }` brings Analytics back for everyone (session Curtain Seven, 2026-10-17).
  Missing (today: no row, no migration), unreadable, `{ "hidden": true }` or any other shape hides it: no Analytics tab
  in the staff bar, no Analytics / Content Calendar toggle on a client link, and a client link's Analytics address
  opens the Content Calendar. Read at boot in the same request as the switches above. No Analytics code was removed.
To try it: the test client in the first list and the owner in the second. Nobody else sees anything new.

**The owner's decisions, 2026-10-16:** yes to the SMM and Kasper mock-ups, and to the five open choices:
(1) the arrow on Approve is faint at rest and firm on hover; (2) SMM caption edits save at once, as today; (3) Kasper's
"With the editors" folds at the end of the strip, and a card there opens read only with Ping editor; (4) Kasper's
conversation is team only, with no Client can see switch; (5) the stage uses the Notes view player (#2120), not a copy,
so session Encore's speed buttons and "Open in Frame.io" message (#2130) come with it (both merged 2026-10-17).
His review of the mock-ups, on all three versions: the strip scrolls sideways with the ordinary mouse wheel (trackpad
swipes still work, no scrollbar); no "parts to look at" list on the left (the step bar shows each part's state: green
check approved, orange change asked); steps look clickable (hand cursor, a soft fill on hover, one gentle glow on the
next step the first time the page shows, never repeated); the date sits at the stage's top left ("Fri 23 Oct") and
Kasper's "Back after tweaks, round 2" line stays under the title; the freed width goes to the stage; a "?" beside the
theme button on the client page opens a tutorial video in an overlay.

**Decisions made in the build (every save is the old page's own; no new write path):**
- Client "Finish reviewing" saves nothing: each answer is already saved when given; it opens the next waiting post.
- A client's caption edit changes the caption itself (since Curtain Eight, below) and a plain note tells the team; a
  YouTube title edit is still sent as a change request carrying the new text (a client link never renames a card).
  A title edit never approves. A caption edit, once sent, IS the client's answer for the caption step: it is approved
  once and the stage moves on, as Approve does (session Onward, 2026-10-18; a failed save approves nothing).
- A client's "Change my mind" on an approved part sends a note to the team on that part (a client link cannot reopen
  an approved part); the SMM's and Kasper's reopen it as a change request, as their old pages do.
- A client's "Take it back" on a sent change request is not offered (nothing on the old page undoes one).
- A plain note goes on the part on stage (every note belongs to a part of a card). The SMM's "Client can see" note uses
  the same outbox and card save as the Review panel's note, with the audience the Notes dialog gives it.
- "Tweaks are on Frame" is Kasper's ordinary change request with that message. "Approve after tweaks" asks for his note
  first (the old function needs one).
- A client link stays light everywhere except where this page is on: there the sun/moon button works (and the rest of
  that client link follows the chosen theme).
- Samples in Kasper's list carry the "Sample" tag and open a "Watch the video" link instead of the player.
- The old page's own confirmations and refusals still show (for example "Approve to client" before Kasper has seen a
  part, or a Linear-linked part with no work item behind it).

**Switches set 2026-10-17 about 09:05 UTC (Lighthouse, after #2131 merged as 06a59fe9):** `review_stage_client_pages` lists the test client only; `review_stage_kasper_staff` lists the owner's two staff accounts (by roster id); `review_help_video_url` is unset, so the "?" stays hidden. Deleting either row brings the old page back on the next load.

**Owner feedback of 2026-10-17 (session Curtain Two):** on a switched-on client link the new header is now the page's
only header on Review, Sheet, Month and Week (the old Analytics / Content Calendar toggle and the old calendar bar are
gone there; Organize and the card size sit in the header on Sheet, Month and Week; the pill toggle and the sun/moon
button never move), the page has no frame and does not scroll at 1440x900 on Review, Sheet shows only the sheet, and
there is no Analytics route for that client (an Analytics address lands on the Content Calendar). The "Watch the
video with its notes" hover tooltip is gone from the player doors (staff Sheet and Kasper too). The video step already
used the Frame.io player wherever `frame_viewer_clients` allows the client (live for the test client). Test:
`node test/review-stage-client-layout-browser.js`.

**Owner feedback of 2026-10-17, second round (session Curtain Three):** on that client page, desktop only, the Sheet's
row of cards sits in the middle of the space under the header (both ways) when it fits, and starts at the top and
scrolls when zoomed in past it; Organize and the card size have the header's pill fill in light mode; the "waiting
for you" strip ends at the header's right margin and fades out when more posts are to the right; a bare link (no
`v=`) reads the switch beside the link check, so a switched-on client sees the neutral check screen and then the
Content Calendar, never the Analytics skeleton. Same test file.

**Staff Review tab under the staff bar (session Curtain Four, owner feedback 2026-10-17):** for a switched-on client the
SMM's Calendar Review tab keeps the Calendar's own bar (the Review | Sheet | Month | Week toggle on the left, Notify
client, the menu), so the toggle sits in exactly the same place on all four tabs, and the new page draws no
"<client> Content calendar" heading of its own (the client switcher already names the client). The client link and
Kasper's tab are unchanged; with the switch off the staff page is today's. Test:
`node test/review-stage-staff-layout-browser.js`.

**Owner feedback of 2026-10-17 18:10 UTC (session Curtain Five):** with the switch on, the Kasper tab has one header
(title, Review Session / Messages / Filming Plans, More) at the same place on every section, and Messages opens inside
the tab with no Close button (the header's own Messages button and everyone else still get the Messages page); no
review stage (Kasper, SMM, client) scrolls the page when it fits the window (the page's 80px bottom padding goes while
a stage shows); and the stage reads the app's own colour tokens (one page background, one surface for the stage card
and the notes panel, one border, radius and shadow) in light and dark. Switch off or unreadable: pixel-identical to
main. Test: `node test/review-stage-one-system-browser.js`.

**Owner feedback of 2026-10-17 23:00 UTC (session Curtain Six):** (1) the old Review list no longer flashes on the
first Sheet to Review switch. It was the staff Calendar only (the client link was already clean): the switch was first
read when Review was clicked, so that first paint drew the old list until the answer came back. The switch is now read
as soon as the Calendar paints any tab for a client, and for a switched-on client the new page's code is fetched while
on Sheet, so the first click draws the new page at once. The live read takes 1.5 to 3.7 s, so a Review click before it answers
shows the Calendar's loader instead of the old list whenever this browser last saw the client switched on (a hint kept
in the browser; it never shows the new page by itself, and a client it does not list keeps today's instant old list).
Left as is: the very first visit from a browser that never saw the switch answer (Lighthouse, review of #2167). (2) The conversation panel is the approved phone-style chat on all
three versions, light and dark: bubbles with no outline or side bar, the viewer's own on the right in a soft tint of the
app's accent, everyone else's on the left on the page's own background (the panel stays the stage's one surface from
Curtain Five), the part tag and "Change asked" in the bubble's top line, Team only / Client can see under the note,
"Done" on handled requests, line breaks kept, and a very long note (a whole caption pasted as a change) folds after
seven lines behind "Show all". Only the look changed: what is saved, who sees it and the Team only / Client can see
switch are untouched. (3) The "new version of SyncView" bar keeps its place at the bottom of the window; while it shows, the review stage
makes room for it (shorter on a desktop, extra room under the page on a phone), so it covers neither the stage's Approve
and Finish reviewing buttons nor the client page's header. Switch off: every page as on main. Test:
`node test/review-stage-chat-switch-browser.js`.
**Stuck "Saving..." fixed (session Curtain Nine, owner feedback 2026-10-17 23:40 UTC):** the owner's "Approve to Kasper"
on the SMM's Review tab saved (every card save in that window returned 200 in under 2 s; nothing in the refusal log) but
the stage read "Saving..." for good. An approval that answered the card's last waiting part took the old page's
"remove the card" branch, which found no old card and never told the new page to draw again. That branch now hands
over to the new page (shared code, but the change only acts while the new page is on), and the stage also watches each
save itself: it draws again the moment the save ends, says in words after 8 s that the server has not answered, and a
refused save shows its reason with Try again (and the stage no longer moves on past a refused part). Test:
`node test/review-stage-save-browser.js`.
No more "Saving..." words (same session, item 2): the pressed button shows a small spinner (a slow breathing dot with
reduced motion) and the other buttons wait; the step's "Saved" mark and the spoken confirmation come when the server
answers, not on the click; and on a switched-on client link the old "Sending..." toast no longer shows for a first send
(it still shows for a held re-send). Screenshots: `docs/audits/review-stage-curtain-nine/`.
Smooth switching (same session, item 3): changing the part (step bar, the next part after an answer) or the post (a
strip chip, Finish) fades only the media; the header, strip, title, step bar and conversation stay on screen. The
conversation no longer replays its entrance animation on every redraw (only a new message rises; another post's
messages cross-fade softly), and the strip keeps its decoded thumbnails instead of making them again. Test:
`node test/review-stage-smooth-browser.js` (records every frame).
Finish reviewing (same session, item 4): once every part is answered it carries a soft green ring that breathes slowly
three times and then stays still (a still ring with reduced motion; a redraw never restarts it). The client link's own
"Approved" / "Changes sent" toast no longer shows on the new page (it covered Finish on a phone; the step's "Saved"
says it). Test: `node test/review-stage-finish-browser.js`.

**Owner feedback of 2026-10-17 23:40 UTC (session Curtain Eight), client page only:** (1) A client's caption edit
changes the caption itself: the same card save as a caption edit on the Sheet, also with Collaborative mode off (that
switch still guards the Sheet's fields; `_calClientReviewCaptionEdit` in `170` is the one exception, caption only). A
plain client note on the caption ("Changed the caption to: ... It was: ...") tells the team, so every page that shows
notes reads it and the SMM has the old text to put back; the new page draws it as the new caption with the old one
folded and struck through. The caption is never approved or sent back by the edit: it waits for the client's Approve.
The YouTube title is the card's name, which a client link may not change, so a title edit is still a change request.
(2) The client's message box: no "Is this a change?" prompt; the parts are clickable chips at the box's top left
(picked one turns the box orange with "Your team will edit it", as before; picking it again clears it); at the bottom
right "Send comment" (a plain note on the chosen part, or the part on stage) and "Ask for a change" (needs a part). Enter
sends a change when a part is picked, a comment otherwise. The SMM's and Kasper's boxes are unchanged. (3) The caption
edit box and the message box use the conversation's thin scrollbar (a local style; the app-wide one is Curtain Nine's).
The stage's caption card keeps line breaks. Test: `node test/review-stage-client-composer-browser.js`.
**Owner feedback of 2026-10-17 23:20 UTC (session Curtain Seven):** with the switch on, Kasper's tab has no "Kasper"
title and no "Updated" line, and only Review Session and Messages as tabs (Filming Plans is in More, under "Content");
the strip opens with a small list button (the count as a badge) instead of "9 to review" and the section labels, and it
opens his sections as a list (Urgent, Waiting for your review, With the editors with Ping editor; a row opens that post,
Escape or a click elsewhere closes it); the post heading is one row, "Client · Title", with no initials badge, and the
round ("Back after tweaks, round 3", or "First review") sits beside the date; a double click on the stage's video goes
full screen (all three stages). On the SMM's Review tab Notify client sits on the right beside the menu (the card size
control, invisible on Review, no longer holds the space). For everyone: a video opened from a play button (Sheet,
Month and Week play icons, the Review tab's "Watch video" preview, Kasper's Watch here) starts playing at once, with
sound when the browser allows it and otherwise muted with a "Sound is off. Click for sound" button; opened from the
notes (Notes button, a note's link, Messages) it waits for play as before. Analytics is hidden for everyone behind
`analytics_hidden` (above). Switch off: Kasper and the SMM page are today's. Test:
`node test/review-stage-curtain-seven-browser.js`; the older browser tests that open Analytics now answer
`analytics_hidden` with `{ "hidden": false }` (`test/fixtures/analytics-shown.js`).
**First paint on that client link (session Lantern, 2026-10-18 01:13 UTC; owner report: a dark page refreshed through a
white page with a small white card):** the browser now remembers the client links it last saw with the new page
switched on (`syncview_rs_paint_v1` in its own storage, a paint hint that grants nothing), so a refresh paints the saved
theme from the first frame and draws the page's own shape (header, strip, stage, conversation, within 3 px of the real
page at 1440 and 390) instead of the white check card. That shape stays on top until the page has drawn under it, then
fades out in 0.18 s (none with reduced motion), so the old review list no longer shows while the switch is read. When
the switch reads off, the link is forgotten and the page goes back to light and the old page. A link never seen switched
on keeps today's light check card. Test (records every frame, fails on main): `node test/first-paint-theme-browser.js`.
Not yet done (Lantern's next pieces): the staff pages and Kasper frame walk on the live site, one shimmer and spinner
family across the app, and a fade from skeleton to content elsewhere.
**Notes flash fixed (session Curtain Nine, owner feedback 2026-10-17 23:40 UTC):** on a switched-on client link the
Sheet tab's Notes opened the old dialog for up to a few seconds and then turned into the player view: nothing on that
page had read the player's switch (`frame_viewer_clients`) yet, so the first Notes click did. The client page now reads
it as soon as it draws, and a Notes click that still beats the answer waits for it (at most 2.5 s) before painting.
The shared player also takes its portrait or landscape shape on its first frame from the same picture already decoded
on the page (for everyone with the player; before, it painted landscape and jumped a frame later). Test:
`node test/review-stage-notes-browser.js`.
**Review page skeleton (session Curtain Nine, owner feedback 2026-10-17):** while a switched-on client's Review cards
load, the new page draws its own placeholders (strip chips, title, date, step bar, the media at a video's shape, the
buttons, the conversation) where the real parts land, within a few pixels (exact on a phone), instead of its header
over the old calendar loader. Shimmer stops with reduced motion. Skeletons elsewhere are session Mould's. Test:
`node test/review-stage-skeleton-browser.js`.
**One scrollbar for the whole app (session Curtain Nine, owner feedback 2026-10-17, for everyone):** every scrollbar
(text boxes, lists, panels, dialogs, the page) now looks like the review conversation panel's: 6px, fully rounded, no
track, the theme's soft thumb (`--scrollbar-thumb` / `--scrollbar-thumb-hover`, light and dark), darker on hover. One
shared block at the end of `020-styles-surfaces.css.part` (and the same rule inside the review page's shadow root);
the 31 per-place scrollbar rules are gone. A place that hides its scrollbar still does. Firefox gets
`scrollbar-width: thin` and the same colour (only where `::-webkit-scrollbar` is unsupported, so Chromium keeps the
rounded thumb). Test: `node test/scrollbars-browser.js`.
**Staff pages, first paint (session Lantern, 2026-10-18 01:40 UTC):** a staff refresh no longer reshuffles the header:
the client picker, Samples, Kasper and the Messages button show from the first frame (the app script still re-checks
each), every tab looks the way it will once the sliding highlight is ready (no bordered chips, only the page's tab lit,
Today included), Kasper and Workload show their own grey shape instead of a bare "Loading…" while their code downloads,
and on a phone Today, Templates, Filming Plans and Submit draw the phone title bar from the first frame instead of the
desktop header. Test (fails on main, 17 failures): `node test/staff-first-paint-browser.js`. Still showing late: the tab
icons and logo (one or two frames, images), and Kasper's own phone heading.
**One loading family (session Lantern, 2026-10-18 02:10 UTC):** every spinner in the shared styles turns at one
speed (`--sv-spin-dur`, 0.75 s; it was six speeds from 0.7 to 1 s) and every grey placeholder shimmers at one speed
and easing (`--sv-sheen-dur` 1.35 s, ease-in-out; it was four). Reduced motion stops every shimmer, slows spinners to
1.5 s and drops fades. Wherever a grey placeholder inside the page is replaced by content, the content fades in over
0.18 s instead of appearing in one frame. Tests: `node test/loading-family.js` (no spinner or shimmer with its own
number) and `node test/loading-fade-browser.js` (both fail on main). Not covered: the review page and frame viewer's
own sealed styles (other sessions'), and the small "updating" pulse dots.

**Still to do:** run `/dawn-check` and
`/master-test` with them on (they need the live site) and a side-by-side `/human-audit` against the mock-ups. The phone
layout follows the desktop one and has not been polished on its own (as the handoff said).

## Card saves end after 20 s (session Tether, 2026-10-18)

The Calendar card save fetches (`_calUpsertPost`, the client link's `_calUpsertFetchClientLink` and the pinned repair resend) now give up after 20 seconds and fail like any network failure ("The server has not answered. Your change is kept; try again."), so the review page's waiting line ends with Try again and the offline resend treats it like a dropped connection. What is sent is unchanged. Test: case 5 of `node test/review-stage-save-browser.js`.

## Loading skeletons match what loads (session Mould, owner feedback 2026-10-17 23:40 UTC)

The owner: "Every skeleton should match the actual shape of what is loading." Each page fixed gets a browser test that
measures the skeleton's boxes against the loaded page's (fixture data, 1px tolerance) and fails on the old skeleton;
before and after screenshots live in `docs/audits/skeleton-shape/<page>/`.
- **Staff Calendar, Sheet:** done. While cards load, no second made-up toolbar any more; the cards sit exactly where the
  real cards land, row for row (title, date, two links, caption, call to action, notes, Set all, three status rows),
  at the view's card size; phone shows the posts bar and the three-column tile grid; the first paint (before the app
  starts) has the real toolbar's items at their sizes and the same cards. Test:
  `node test/calendar-sheet-skeleton-shape-browser.js`. Not yet matched: the phone first paint (the whole phone header
  is drawn by the app, so the first paint still shows the desktop shell there), a saved small or large card size on the
  first paint (it draws the default size), and the staff client profile's Calendar tab, which shares the first-paint copy.
- **Client link, Sheet (session Tether, 2026-10-18):** done. The client link's Sheet drew the staff Sheet's placeholder;
  it now draws the client card at the loaded card's boxes (thumbnail, title, date, one link row, caption, call to
  action, Notes, the status chips; on the phone one full-width column with the Caption and Call to action headings and
  no "Loading your calendar..." line). Test: `node test/client-sheet-skeleton-shape-browser.js`. The first paint on a
  client link (before the app starts) is not matched.
- **Staff Calendar, Month and Week (desktop):** done. While posts load, the view's own header, day labels and grid are
  drawn with no posts and shimmer (it was a narrow unlabelled grid for Month, other-sized pills for Week); a Month row
  that gets a post grows at most a few pixels. Test: `node test/calendar-month-week-skeleton-shape-browser.js`. The phone
  keeps its own timeline skeleton (not yet measured).
- **Staff Samples, Sheet and Review (desktop):** done. Both drew three small list cards in the middle; the Sheet now
  draws a strip of cards at the loaded sample cards' boxes, row for row, and Review the loaded list's wide cards
  (thumbnail, title, the "needs approval" line, chips, two buttons). The Review count badge no longer makes the toolbar
  3px taller when it arrives (Calendar too). Test: `node test/samples-sheet-skeleton-shape-browser.js`. Not yet
  matched: Samples on phone, and the Samples first paint (still the old small cards; it cannot tell which tab opens).
- **Not reached yet:** Calendar Review; Today, Samples, Templates, Filming, Post, Workload, Linear,
  Submit, Messages, the old client page. The review page and Kasper's tab belong to sessions Curtain Nine and Seven.

## Latest (Lighthouse, 2026-10-17)

Newest first. Checked against main and the live database on 2026-10-16. When an item here is finished or moved into
the sections below, delete it from this block in the same PR.

**Day 2026-10-17 (Lighthouse, after the owner's morning answers):**
- **Merged and live:** #2147 (Team-link brain saves need a first name; the guide finds "broll"), #2149 (voice_cleanup
  stops an Auphonic production over 5 minutes; status 13 and 10), #2151 (studio toolkit reads the studio/ folder, top
  of the bucket as fallback), #2152 (client_brain offers a named non-owner caller at most one open client question from
  the brain's questions.md, Kasper both kinds, others team only, never the same one twice in 7 days; brain_change takes
  question_id; the live hf_guides brain row has the new section), #2153 (client review page: one header on every tab,
  toggle fixed, Sheet shows only the sheet, no Analytics for clients, full screen; the Frame.io player was already on
  the video step), #2154 (its live screenshots).
- **Merged and live (afternoon and evening):** #2150 (studio_transcribe: ElevenLabs transcription priced and sent
  from our own stored copy; migration 20261017160000 applied, private buckets transcripts 50 MB and
  transcribe-sources 400 MB; live check passed), #2156 (WAV length read only for plain PCM or float, so a compressed
  WAV can no longer be priced short), #2157 (a client slug with "&" gets a store name), #2160 (the caption writer also
  reads a written "Banned openings" fact), #2163 (a paid-for GPT Image is stored with three tries before
  delivery_failed), #2158 (client review page round 2: Sheet cards centred, even margins, visible pills, strip margin,
  no Analytics skeleton on a bare link), #2162 (also carrying #2161: the staff Review tab sits under the Calendar's own
  bar so the toggle never moves; one Kasper header on Review Session, Messages and Filming Plans; no page scroll on a
  review stage that fits; one colour system), #2164 (unit tests get one runner seat per part, 14 seats, after #2148's
  single seat made every PR wait about an hour). Live read-only check of the test client's link after #2162: one
  header and a fixed toggle on all four tabs, no Analytics, no scroll on Review and Sheet.
- **Outside this repo:** n8n "Sales, Booked Call to Meta CAPI" now sends the real page per booking calendar and skips
  referral and outbound_dm bookings (owner's go; N8N_EDIT_LOG); synchrosocial #182 (pixel: fbc/fbp on first events,
  DoctorEmailEntered, event ids, no events for test, referral or outbound_dm traffic).
- **Connector:** after a new tool deploys, people click "Refresh tool list" in the connector settings (then a new
  chat); removing and re-adding is never needed (lessons rule 4).
- **In progress:** the client tutorial video for the review page's "?" button (session Premiere; the owner approves
  the script, then the video; then `review_help_video_url` is set).
- **Supervisors:** inboxes, a shared board and daily history in synchro-pipelines `supervisor/`, and an Overseer
  session that audits them (owner's decision).

**Night 2026-10-16 to 17 (Lighthouse; the owner asked for full autonomy until his 8am report, decisions noted):**
- **Merged and live:** #2129 (filming pipeline passes; migration applied), #2132 and #2133 (entry-links-boot was red on
  every PR since #2085: three phone tests opened on the new picture grid, and #2121's Post tab made the header tab row
  re-fit itself every frame forever, an idle CPU loop for staff; fixed with a guard), #2134 (captions skip not-written
  voice facts; title banner matches; caption-generate, thumbnail-title-prompts, thumbnail-titles deployed), #2137
  (Connector PR 2: filming plan limited to the people on `fp_settings.pipeline_users`, file store and notes over the
  pass, brain snapshot; migration `20261017090000` applied, assert passed; higgsfield-mcp and pipeline-google deployed),
  #2141 (phone visual guards judge the settled page; the "Phone title must wrap" failure hit three unrelated PRs),
  #2136 (Turbo: PR checks run only what a change can break and split the slow jobs; main still runs everything),
  #2135 (client_brain: the whole brain when it fits 60,000 characters, first paragraphs and a named left-out list
  when not, a topic or fact id for one fact in full; focus.md always first), #2140 (Echo: a client's Request changes on
  a linked part now always reaches its work item; OPEN_REPAIRS 429), #2131 (new review page, see its section above),
  #2130 (Encore: Watch here picture plays, 1x/1.5x/2x and skip, no "Syncing" line, faster notes, centred play button,
  "Open it in Frame.io" on a playback error).
- **Merged later the same morning:** #2142 (Twin: test robots sign their card saves with the runner's staff key, so
  calendar-card-write accepts them), #2144 (connector: private addresses written in IPv6 form are refused; live check
  passed), #2139 (connector voice_cleanup through Auphonic; migration `20261017040000` applied, private `voice` bucket;
  answers "not switched on yet" until the owner adds `AUPHONIC_KEY`, and the project's global Storage upload limit
  must be raised to 400 MB before the first long file), #2145 (Probe: #2130 started the notes read one tick late, so
  for a moment after opening the Notes dialog Send looked ready and a note sent then was refused as "still loading";
  this turned three Calendar nightly probes red at 12:01; no real client affected; OPEN_REPAIRS 431).
- **Card saver:** stage B unchanged (test client plus the owner's two clients); 8 clean watcher runs, no real saves on
  the two clients yet (weekend), so stage C's count has not started.
- **Done by the owner (morning):** the one stuck card's work item moved to Tweaks Needed (the drift check is green
  again); `AUPHONIC_KEY` added and the global Storage upload limit set to 400 MB (voice_cleanup is on); Codex credits
  reset; GitHub production environment confirmed "main only".
- **Runner capacity (fixed):** #2148 (session Throttle, owner's go) gives pull-request jobs 12 shared runner seats with
  `queue: max`, so the 5-minute production lanes no longer queue behind PR tests (the sender had 90 of 589 runs
  cancelled over 48 hours); the schedule guard runs only on timer runs and still fails closed (Lighthouse's fix on top).
  An uncontended calendar PR run now takes about 20 minutes instead of 12.

**Evening 2026-10-16 (Lighthouse, checked live):**
- **First Section 4 release through the new lanes SUCCEEDED** (manual merge-lane run 38953309940 at `27ce2100`, 19:13 UTC):
  the Section 4 run 38953471717 verified the sealed backup, then deployed and verified `production-write`,
  `deliverable-write` and `batch-write`; `production-comments` deployed and attested after it. The server halves of
  Swift #2089 (Messages) and Scribe #2096 (notes) are live. The earlier failure was most likely the bundler image pull
  being rate-limited; #2117 (Mechanic) pre-pulls it by digest with retries and a second registry and publishes the
  CLI's own failure reason (OPEN_REPAIRS 425).
- **Live by merge:** #2113 (Nano Banana switched off; live check: a price_check for it answers "switched off" with a GPT
  Image price), #2116 (Open in Calendar button in Production), #2119 (Calendar and Samples card buttons: play icon for
  the video, picture icon for the thumbnail).
- **Studio:** version 0.3 in the `studio` bucket; a real Chelsey cut was made through it on the owner's computer.
- **Live by merge, later that evening:** #2121 (Post tab), #2122 (labelled Open in Calendar button), #2120 (Cinema: one
  view for video and notes; merged 20:37 UTC, and Lighthouse set `frame_viewer_clients` to `all: true` at 20:40 UTC once
  Pages had published), #2115 (video profiles; merged 21:22 UTC, on-merge deploy green; the first client video profile is
  to be saved through `studio_profile_save` by the connector supervisor). Then #2094 (Anchor: the production-polish suites wait
  for the page to finish loading instead of guessing; OPEN_REPAIRS 426) and #2087 (Thumb: phone Workload opens as an
  agenda with per-person queues, Week and Month keep the native planners, filters in a bottom sheet; phone-scoped only).
  Thumb's #2085 (phone Calendar and Samples) waits on Thumb (now red on the dialog backdrop browser test).
  #2126 (pipeline-google moved here from synchro-pipelines; on-merge deploy green, live version 26).
- **Card saver, stage B (23:34 UTC):** session Vigil Round made a full round of real staff saves on the test client
  through `calendar-card-write` (every save landed, Retry fix confirmed, no refusals), so `calendar_card_write_clients`
  now holds the test client and the owner's two own clients. Everyone else follows after 8 clean watcher runs that
  include real saves on those two. A component status change also writes a card-level ledger row; that is the old
  saver's behaviour too (130 of 368 status changes in 7 days), not a new-saver regression.

**Live (session Encore, #2130 merged 2026-10-17, OPEN_REPAIRS 427): the owner's five points on Watch here.**
The frozen picture with sound was the card's thumbnail left on top of the playing video (now hidden once the video has
a frame); a file that plays sound but no picture switches to the small H.264 copy. Speed 1x/1.5x/2x and 5 s back and
forward in the player; the "Syncing this thread" line is gone (Send is just disabled while the thread loads); the notes
read starts when a door is pointed at and beside the link check; the card's play button sits in the middle of the
thumbnail; when the video cannot play properly the player says "Having trouble playing this? Open it in Frame.io"
with the link (point 6). Page only, no function change.

**Live (session Cinema, 2026-10-16, #2120): Watch here, one view for the video and its notes.** Every door (the Notes
button, the Sheet's play icon, the Review tab's video preview, Kasper's "Watch here") opens the card's Notes dialog with
the player on the left (on a phone, on top). Nothing plays until play is pressed (bottom centre of the player). Staff
see the Frame.io comments as rows in the notes list, in time order, marked "Frame.io", with clickable video times; a
client link never does. The old pop-up and the in-place player on the Review tab are gone. No function
change; `frame_viewer_clients` is on for every client since 20:40 UTC.

**Later on 2026-10-16 (Lighthouse, checked live):**
- **Merged means live (#2101, Conveyor) is on main:** the page builds at publish (index.html is no longer committed) and
  Edge Functions deploy on merge through `deploy-edge-functions-on-merge.yml`; the Section 4 capture runs in GitHub.
  The capture-only proof passed (14:42 UTC, deployed nothing). Every merge since deployed itself and attested.
- **First manual Section 4 release FAILED CLOSED** (16:41 UTC, `production-write` and `production-comments`): the
  in-run capture passed, then `supabase functions deploy production-write --use-docker` exited in 1.6 s with its reason
  only in the private log. Nothing changed live (every function's bundle hash unchanged). Session Mechanic is finding
  the cause and making the lane publish the CLI's reason. The server halves of Swift #2089 and Scribe #2096 wait on it.
- **Live by merge:** #2111 (Vigil: a Retry on a never-pinged card no longer fails in `calendar-card-write`), #2112
  (Atelier: `studio_latest` on the Synchro connector; Lighthouse applied `hf_studio_downloads`; the owner uploaded
  studio 0.2 to the private `studio` bucket; a test call handed out 0.2 at 17:09), #2114 (Relay: a second status pick
  during the production-write wait now reaches Production; OPEN_REPAIRS 424). The one real card left behind by that race
  was moved to Posted by the owner; the card-vs-work-item drift robot is clean again.
- **Connector guide `video-studio`** added to `hf_guides` (first-time studio setup in Claude Code).
- **Owner decisions:** Nano Banana is dropped, the team uses GPT Image only (#2113 switches it off; Google billing not
  enabled). Kasper's bot reads the database through a project-scoped Read-only Supabase token the owner made.
  The Frame.io player gets one more design round (session Cinema: one view for notes and video, no autoplay) before it
  goes to everyone. The new card saver widens only when sure: a watcher every 3 hours, test client, then two of the
  owner's clients, then all staff saves; client review links stay on `calendar-upsert`.
- **Instagram upload** works for one more client (its Post For Me account id saved in its profile, allow-list secret
  set by the owner).

**Synchro video studio (session Atelier, 2026-10-16).** Step 1, `studio_latest`, merged (#2112): the newest studio zip
from the private `studio` bucket as a signed link valid about 10 minutes, each call logged in `hf_studio_downloads`. Live
since about 17:09 UTC; a real call at 17:32 UTC returned version 0.2 and was logged.
Step 2, merged (#2115): `studio_profile` reads a client's video look from the brain file `clients/<folder>/video-profile.json`
(or, with none yet, the brief's Look lines and exact spec values to draft from), and `studio_profile_save` files a profile
through the same change path as `brain_change`. The brain writes the file only once the "Video profile updates" section
is in its `POLICY/syncview-changes.md` (synchro-brain #83, merged by the owner at 20:19 UTC). Step 3 (`studio_transcribe`) is a design only.

**Live on 2026-10-16 (Sidney's one-function runs, checked by Lighthouse):**
- **`calendar-card-write` v1** deployed about 13:23 UTC. Lighthouse put the test client on `calendar_card_write_clients`
  (`{"clients": [test client]}`) at 13:33 UTC, so staff saves on the test client now go to the new writer; every other
  client and every client review link stay on `calendar-upsert`. An unsigned save is refused (401). Step 2 of the
  retirement plan (two working days of real test-client use, watching the function log, the ledger and the refusal log)
  starts now. Way back: take the test client off the switch.
- **`frameio-view` v3** (Lens #2100's polish) deployed about 13:34 UTC. The owner judged it ready for everyone; at the
  owner's word `frame_viewer_clients` now lists the test client plus two of the owner's own clients (13:47 UTC) for a
  short real-use test before `{"all": true}`.
- **Session Vigil, step 2 tried by hand (13:48 to 14:35 UTC, test client only, real browser on the live site):** every
  staff save the page can still make went to `calendar-card-write` and landed: create, name, caption (typed, cleared,
  generated), date, CTA, thumbnail and video links set, video link cleared, platform, colour, caption, graphic, video
  and title status, comments on all four cells, request change, Kasper comment, approve and undo, both urgent markers (the Slack sends were stubbed, no message went
  out), archive, restore, setting toggle and the on-load link adoption. Each reload showed what the row holds; the
  ledger has one row per change with the right action, role and source; every refusal reached the refusal log. A stale
  Kasper tab got the conflict answer and a clear message; a comment added in another tab survived. Switch read failing
  or the function refusing goes on to `calendar-upsert` (as built). A client review link still saves through
  `calendar-upsert`. Not reachable from the page: setting a Linear link (sealed since the Linear exit; set, clear,
  duplicate and archived-twin were tested by direct calls instead) and Kasper Finish.
  **Bug found, in both writers:** a Retry after a failed save sends the whole card, and on any card never urgent-pinged
  its blank urgent times are refused by Postgres, so the Retry fails again ("HTTP 500"). Only the test run hit it in
  the last day. Fixed in `calendar-card-write` (blank urgent time stored as no time), with the two step-2 test gaps
  closed (merge and stale-save ties, archived twin): PR #2111.
  Needs: merge, then redeploy `calendar-card-write` on the one-function lane. Clients still on `calendar-upsert` keep
  the bug until they move. Also seen, not this writer's: a stored work-item repair on the test card replays
  `repair_payload_mismatch` in the page on every load after an archive (status label and payload disagree), and the
  refusal log records the stale-save conflict as a 500.

**Live since the last update (2026-10-11 to 2026-10-15):**
- **Notify client** (#2080, #2084, #2088): one Slack alert to the client's private channel, short box that closes by
  itself, and the "Review now" link opens the Review view. The button is there for every client; 3 alerts recorded so far
  (checked 2026-10-16).
- **Messages** (#2079, #2083, #2090, #2092): a page under the header, the reviewer view follows the reviewer's threads,
  a hidden client message shows once staff answered it, and the phone version has native conversations with a docked reply.
- **Watch here, Frame.io inline viewer** (#2091): the Review tab plays the video in place. Switch `frame_viewer_clients`
  is on for the test client only; everyone else waits on the owner's word.
- **Caption helper** (#2077, #2086, #2095): call to action, platform, note, title ideas, hashtags; Redo as a pop-up that
  uses the video's own words (new `caption_jobs` columns `transcript` and `transcript_asset`, applied) and never saves a
  chat reply as the caption. `caption-generate` runs every caption (`caption_generate_ef_clients` = all, since 2026-10-09).
- **One client's caption prompt replaced** at the owner's go (2026-10-15); the old prompt is kept as a backup row in
  `caption_prompts` (name starts `_backup_`).
- **Synchro connector** (#2093): tool calls are logged to `hf_activity` with who and a one-line summary, best effort (a
  failed log write is dropped, never blocks the call; refusals are logged as failures), and a `guide` tool reads `hf_guides` (5 topics live; the newest row per topic wins, so a guide
  changes with no reinstall). The team skill `synchro` is managed in the Claude organization settings; its master copy is
  in the synchro-brain repo (`team-skills/synchro/SKILL.md`).
- **Pop-ups part 2** (#2081) and SyncLinear "Back to card" (#2078).

**Merged 2026-10-11 to 14 and not recorded here at the time (added 2026-10-16; Lighthouse missed these, see the
supervisor manual's "Writing it down"):**
- Calendar: status filter (Show only / Hide on the overall card status, #2043, item D3 below); clear on the pill, work item
  hover card, per-card files menu (#2059, #2064); background refresh keeps what the person is using and is invisible (#2061,
  #2065); a wheel over a long open caption scrolls the caption (#2057).
- Thumbnail titles: month fallback, long and template plans, re-queue, borrowed-tab check, cleaner default prompt (#2041,
  #2042, #2048).
- Phone: staff phone polish, Tabs grid, round 2 from the owner's own phone notes (#2047, #2050, #2056); dark mode contrast
  gate (#2049); Templates Audience section and Copy button (#2051).
- Notes and Messages: Notes step 1 (quiet composer, folding threads, #2060), done and delete reach the canonical thread
  (#2053), Notes step 2 Messages inbox for all staff (#2063, #2066, #2071), old-notes label script ran (#2062).
- Today: lists sorted by upload date with a date pill, cards and SyncLinear open in new tabs (#2070, #2072).
- Pop-ups part 1, one rule for Escape, outside click, focus and kept text (#2076).
- Frame.io key keeper `frameio-token` (#2053 branch) and Watch here first version (#2074).
- Connector: client_brain and brain_change tools (#2058), the person named on the shared team link, renamed "synchro"
  with an icon (#2068, #2069).
- Hiring: the 2026-10-14 audit findings and n8n fixes recorded in `docs/truth/` (#2073, #2075).
- Backups and robots: Track-B corpus v13 (#2046); monitoring pages only a confirmed failure; robots read their own admin key
  (#2027); calendar-upsert live delta lane (#2040); Production CI back to normal with no branch exceptions (#2055).
- n8n changes by Lighthouse that were not logged at the time are now in `docs/ops/N8N_EDIT_LOG.md`: the 2026-10-06 sales
  email fixes, CLIENTS METRICS and TOP VIDEOS off (2026-10-06) and four Calendar workflows off (2026-10-13). The 2026-10-06
  sales edit dropped the video-editor interview admit; another session restored it on 2026-10-14.

**Owner decisions, 2026-10-15 and 16:**
- **Staff use only the Synchro Social organization Claude accounts.** The skill and connector live in the org settings.
- **Every Edge Function deploys itself on merge** (session Conveyor, building). The owner's single "yes" is at the start of
  a request, not per deploy. **The F27 Section 4 capture moves off the owner's computer into GitHub** (Conveyor follow-up),
  so the three core save functions stop depending on a script on one machine.
- **`calendar-upsert` gets retired, carefully** (session Sunset; the measured caller map is #2097: 14 callers, about
  1,200 real saves a day). Plan: a new, small, separate function; move the test client first, then staff, then client
  review links last; the old route stays as an automatic fallback for about 14 days; then delete the old function.
  Nothing a client sees changes until the staff move has run clean. Until then `calendar-upsert` stays frozen.
- **Old n8n "SyncView Calendar, Generate Caption" workflow: DONE 2026-10-16.** Sunset's #2102 removed the page fallback
  (merged, checked live), then Lighthouse switched the workflow off (not deleted; N8N_EDIT_LOG). Original decision:
  **switch off, not delete.** Zero runs since 2026-10-09. First the
  page's fallback to it (`GENERATE_CAPTION_URL`) is removed (Sunset); once that is live, Lighthouse deactivates the
  workflow (owner's go given 2026-10-16 on that condition) and logs it in `docs/ops/N8N_EDIT_LOG.md`.
- **Messages:** clicking Messages again closes it and returns to where you were, and it gets a Close button (reverses the
  earlier "no Close button"). In #2089 (Swift).
- **Caption box:** a small regenerate icon replaces "Redo with a note" (#2098, Quill): merged 2026-10-16, live with the next Pages publish.
- **Frame.io pop-up polish** (session Lens): faster, autoplay, a vertical layout for phone videos, one comment list
  (Frame.io and SyncView notes together), less text, one Open/Reply button, no "FRAME.IO" label, full quality on the Review tab.
- **After Vista: a lifecycle review session** that walks every dependency end to end and tests everything, so nothing
  from the moves off Sheets, n8n and Linear is forgotten. Lighthouse writes its prompt once Vista and the review-sheet
  changes settle.

**Open sessions and where they stand (2026-10-16):**
- Swift #2089 (Messages opens fast, Close button, click again to close): merged 2026-10-16 04:35 UTC (`599b7a22`); the page
  part is live with the next Pages publish. Its `production-comments` speed-up (parallel reads) is NOT deployed on purpose:
  the only lane for it (deploy-onboarding-edge-functions) also redeploys `production-write`, which now differs from live
  (Scribe #2096) and should go through the Section 4 path with its rollback capture. It ships with Conveyor's deploy on
  merge (#2101). The page works with the old function meanwhile.
- Anchor #2094 (production-polish gate waits for the app instead of guessing): merged 2026-10-16 21:56 UTC.
- Scribe #2096 (a note shows the moment it is sent): merged 2026-10-16; the page part is live with the next Pages publish.
  Its small `production-write` change (the Slack sender wakes after the answer, not before) waits for the next F27
  Section 4 deploy; nothing breaks meanwhile. The fingerprint is re-pinned, so the next Section 4 deploy must use a main
  that includes #2096.
- Sunset #2097 (calendar-upsert map and retirement plan, docs only): merged 2026-10-16. Next: the fallback removal, then the new function.
- Quill #2098 (regenerate icon): merged 2026-10-16.
- Lens #2100 (Frame.io pop-up polish): merged 2026-10-16 03:31 UTC (`43d39e46`); the page part is live with the next Pages
  publish (still test client only). Needs a `frameio-view` deploy (deploy-single-function, merge SHA above); until then the
  old function answers with everything at once and the video still plays.
- Conveyor: auto-deploy on merge and the capture in GitHub; merges last.
- Thumb #2087 (phone Workload): merged 2026-10-16 21:57 UTC. Thumb #2085 (phone Calendar and Samples): red on the
  staff-phone-rules source-copy check, waiting on Thumb to fix it and merge main again.
- Vista: review sheet polish, running.

**Waiting on the owner:** the five doctor-funnel changes from Rewind; the branding session; the Frame.io viewer for every
client; the follow-up Slack message asking who still uses a personal Claude account.

---

## The owner's priority order (set 2026-09-29, keep this current)

The owner asked for this list to live here so no session loses it. Work top down.
When an item is done, move it to "Done" below in the same PR; when the owner
reorders or adds, edit this list, never a side document. **The supervisor
(Lighthouse) updates this file after every merge, owner decision or stalled
session, in the same sitting.** A session that stops without pushing is recorded
here with where it stopped, so it can be restarted.

**Owner direction, 2026-10-01 (the big picture, in order). This order outranks the numbered list below: work A before B, and treat the numbered items as the detail and history of each.**
- **A. Move everything off Google Sheets.** Every tab of every sheet SyncView or the pipelines read or write
  moves to Supabase (dual-write, flagged read, parity, then retire, as in
  `docs/plans/2026-09-24-sheets-to-supabase.md`). Clients Info is first and already copied daily; the Clients
  admin tab is the start of its replacement. The owner will improve that UI.
  **Scope, owner 2026-10-02:** only the main SYNCVIEW Sheet and the SyncView Calendar workbook are in scope; other
  Drive files are left alone. Project Central: archive (needs an n8n edit, owner's go). **Clients Info and Social
  Media Managers (session Roster): DONE 2026-10-02, live.** The database is the main copy (`client_profiles_authority` =
  `{"source":"syncview"}` since 20:00 UTC); six n8n workflows read or write through `roster-read` / `roster-write`; Manager Sync is off;
  the Sheet tabs are a mirror kept by the database, still editable by people until the owner protects them in Google (OPEN_REPAIRS 331, `docs/ops/N8N_EDIT_LOG.md`). Still open: the owner protects
  the two tabs in Google; the Finalizer's first real client is its end to end proof;
  CLIENTS METRICS and TOP VIDEOS keep reading the Sheet until Harbor's port. Beacon (onboarding) will extend the Clients tab.
  Cartographer's measured remaining map (84 tabs, readers/writers, costs and owner-gated slice order): [2026-10-03 Sheets remaining map](plans/2026-10-03-sheets-remaining-map.md); evidence 2026-10-02, including live Roster progress beyond the older status above.
  **Slice 1, the page's own two reads (session Quarry, 2026-10-08, OPEN_REPAIRS 374): merged (#1997), NOT live (measured 2026-10-09):
  `analytics-read` is still v21 from 2026-10-02, the switch has no `roster` key, and the daily copy has not run since the fix
  merged. Owner steps 2 to 4 of `docs/ops/OWNER_SHIP_LIST.md`.** With
  `"roster": "database"` in `analytics_mirror_read_enabled` the page never downloads Clients Info or Social Media Managers (client
  list from `analytics-read`, review queue managers from `smm-weekly-reports`); merging deploys nothing (`analytics-read` gains a
  client-row-only read for links the numbers read is not on for, deployed by hand). Parity measured 2026-10-08 (read only): Clients Info 36 of 36 rows equal, all columns; manager assignments 41 and
  41, 0 differences. The daily copy job failed every day from 2026-10-03 (it tried to copy Clients Info, which the database now owns,
  and stopped before Metrics); this PR makes it skip Clients Info and adds the manager comparison. Steps:
  `docs/ops/ROSTER_PAGE_SWITCH_STEPS.md`.
  Analytics are paused by owner decision (2026-10-06): CLIENTS METRICS, TOP VIDEOS and their replacement jobs are off on purpose.
- **B. Move off n8n.** Phase 2 plan, step by step (item 6b below).
  TikTok Upload (Courier, OPEN_REPAIRS 362): LIVE on Supabase since 2026-10-07 17:42 UTC (`tiktok_upload_source` = `supabase`,
  sheet rows copied). Six n8n TikTok workflows switched off 2026-10-08 on the owner's go (`docs/ops/N8N_EDIT_LOG.md`). Still on:
  `TikTok Upload, Result`, because Post For Me's result webhook points at it. Courier's result action is deployed (`tiktok-upload`,
  2026-10-08 15:44 UTC); the webhook is not re-pointed yet: the n8n workflow ran 7 times on 2026-10-07 and 08 (measured 2026-10-09,
  OPEN_REPAIRS 370; owner step 6 of the ship list). Calendar Upsert Post and its Comment Merge helper were switched off the same day (zero runs since
  2026-10-07 15:00 UTC; the page never sends Calendar saves to n8n since #1858).
- **C. Onboarding (session Beacon, 2026-10-02: the checklist is built and in use on the test client).** The
  checklist tables, the `client-onboarding` and `client-hubspot-sync` functions are live, and the Clients tab now
  shows, under a client's details, the HubSpot deal and contract and payment state, the Resources list and the
  27-step checklist (admin only; OPEN_REPAIRS 332). Next, each with the owner's go: "Create client" (step 2.5),
  then the matching pass for the current clients (Stage 3). Plan: `docs/plans/2026-10-01-onboarding-checklist-and-profile.md`.
  **"Create client" is LIVE since 2026-10-08** (OPEN_REPAIRS 372): both migrations applied, `client-onboarding`
  deployed, throwaway create and teardown passed (Lighthouse). **Its Slack nudge is applied** (PR 2011, live database checked 2026-10-10):
  real clients only, no n8n edit; the database nudges the existing finalizer webhook after a create and when a filming
  plan link is saved, the 15 minute timer covers the rest. Clients who never fill the form
  would need an n8n change, written out in `docs/ops/CREATE_CLIENT_LIGHTHOUSE.md` for the owner's go.
  **A real client no longer needs an email** (owner decision, OPEN_REPAIRS 385): LIVE (measured 2026-10-09): the SQL is
  applied (no email check in `client_create_native`, EXECUTE closed to `anon` and `authenticated`) and `client-onboarding`
  was deployed 2026-10-09 01:37 UTC at #2015, after its last change, so the apply and deploy parts of steps 6 and 7 of that file are done (their throwaway checks are not recorded).
  **Stage 3 dry run done**, nothing saved:
  `docs/audits/2026-10-08-stage3-matching-dry-run.md` (Drive folder found for 31 of 35, HubSpot deal for 25; 192 high
  confidence proposals waiting for the owner). Next: the owner approves batches; the approvals screen (3.3) is not built.
  The measured picture of how a client is onboarded today (every step, every per-client resource with
  counts, and the owner's decisions) is `docs/audits/2026-10-01-client-onboarding-as-it-really-is.md`.
- **D. Navigation, then look and feel.** The owner plans to start this himself the weekend of 2026-10-03
  (item 7).
- **D2. The phone experience (owner direction, 2026-10-02).** The whole site gets a phone-first design, tab by
  tab, built by a Codex session with a real (not headless) browser the owner sets up with it first. Hard constraint:
  **nothing changes on desktop** (same bytes at desktop widths, proven by the existing desktop gates and screenshot
  diffs). On a phone each tab may look and behave differently from desktop; the bar is a first-class app (the owner
  named Wise as the reference): speed, button placement, one-hand use. Delivered in slices, one PR per tab, Lighthouse
  merges, test client only for live proof. Starts after Beacon's checklist panel (#1941) is on main.
- **D3. Calendar status filters (owner request, 2026-10-02, after the phone work).** The Calendar gets filters on
  the overall card status, including EXCLUDE (for example hide every approved post). "Overall status" means the
  card's existing computed overall status (the roll-up of video, graphic and caption that the card already shows;
  title review stays out of it, as designed). The filter reads that value; it does not redefine its inputs.
  **Built 2026-10-11 by session Sieve, merged the same day (#2043), live.** A "Status" pill beside Organize in Sheet,
  Month and Week (not Review, not the client link): Show only or Hide, any set of the nine overall statuses, remembered
  per client with the month and dated/undated filters, and a strip above the cards says what is on with a one-tap Clear
  (on a phone the pill sits in the More sheet and the strip is what shows). Test:
  `node docs/syncview-design/tests/calendar-card-status-filter-browser.js`.
- **Open question raised 2026-10-01:** Analytics "views in 30 days" and "views gained today" look too high for at
  least one large client (the stored source rows themselves carry the large numbers, so the page shows what the
  daily metrics job wrote). Needs an accuracy check of how that job counts views before the analytics switch-on.

1. **DONE 2026-10-01: analytics database on for every client.** The accuracy check found the stored view
   counts right; the 20 duplicate Metrics rows were removed (OPEN_REPAIRS 309) and `analytics-write` redeployed;
   the 16:31 UTC daily run ended `PARITY: clean` (0 differences in all five datasets); Lighthouse then set
   `analytics_mirror_read_enabled` to `{"enabled": true}` with the owner's go (EXECUTION_LOG.md). Rollback, one step:
   set it back to `{"enabled": false, "clients": ["<test client slug>"], "staff": true}`. Still to do: the
   one-message Slack alert (under "Needs the owner") and watching that the daily lane stays green.
2. **2026-10-01: n8n measurements for the plan-downgrade decision.** September
   is the first full month the execution-quota watchdog counts. Report the real
   monthly executions against the plan tiers (sizing in OPEN_REPAIRS 233: about
   100k a month, a 50k plan does not fit without cuts) and what would have to
   stop to fit a smaller plan. No n8n edits without the owner's go.
3. **Load-per-tab, step 4: DONE, merged 2026-09-29 (#1848, main
   `e5f36d6e5a55202b978ab3f666893de50c27d34c`).** Signed-in staff now load the page in parts; client
   links, forms and signed-out visitors still get the whole script as one file.
   Mason measured staff first load on a 4G phone at 2,652 ms before and 1,768 ms after.
   Vigil's six hand-test steps passed on the live site. Way back:
   `node scripts/split-switch.js off`, commit, merge; one browser: `?split=0`.
   SyncLinear stays in the always-loaded part (owner, 2026-09-29).
4. **Failed saves: finish the log.** Built: the write-refusal log (#1499), an
   admin page to read it (#1792), and (2026-09-29, OPEN_REPAIRS 290) refusals from
   every other save: Templates, Filming plans, caption prompts, Workload dates,
   TikTok, Hiring, credentials and the rest (list in
   `docs/audits/2026-09-29-write-paths-refusal-coverage.md`, kept honest by a test).
   Measured live 2026-10-09: `traffic` fills for browser reports and for the gateway's own
   rows (all 542 gateway rows since 2026-10-08 carry it; it shipped with the 2026-09-30
   Section 4 deploy). Nothing left from that deploy. Left: making the log easy to read and
   widening coverage (Time off saves, the six urgent-ping codes of OPEN_REPAIRS 314).
5. **Load-per-tab, step 5: client links get the smaller page. DONE: merged (#1868, key fix #1872),
   Vigil hand-tested the live client links 2026-09-30 (all five steps pass, test client only).
   Parts are also minified since 2026-09-30 (#1873).**
   The owner gave the go and waived the week of staff use. A client link now loads
   the parts (no TikTok, Templates, Workload or Kasper code, and no quiet download
   of them); forms, the SMM weekly report and signed-out visitors still get the whole
   script. Numbers: `docs/audits/2026-09-29-step5-client-first-load.md`. Three ways
   back: everyone `node scripts/split-switch.js off`; client links only
   `node scripts/split-switch.js clients off`; parts minified since 2026-09-30, back with
   `node scripts/split-switch.js minify off`; one browser `?split=0` (on a client link only after the
   follow-up fix: #1868 shipped with the link check refusing that key, found by Vigil on the live site). The client
   approve and request-changes tests pass on the parts. Left after this: step 6
   (measure everything again).
6. **Make this repo private: NOT NOW. Owner decision 2026-09-29 (later the same day): the repo stays public.** Only the site publishing fix from the plan is being done: **DONE (#1870, Pages source switched by the owner 2026-09-30; verified 0 app addresses failing, 0 of 17 source addresses published)** (OPEN_REPAIRS 294, `docs/ops/PAGES_SITE_ALLOWLIST.md`). The live site served the whole repo (docs, scripts, migrations); it will publish the allowlisted files only (about 137). One-setting way back: Pages source to "Deploy from a branch". The rest of this item is the earlier plan, kept for reference: **Make this repo private, maintainably (owner wanted it earlier on 2026-09-29; this
   replaced the 2026-09-24 "keep it public for now").** Move scheduled jobs and
   automation off GitHub Actions (for example Supabase pg_cron and Edge
   Functions) so going private costs little. Keep hosting on GitHub Pages
   (owner, 2026-09-24: "I want to keep using GitHub"; the owner already pays
   for GitHub Pro, which serves Pages from a private repo). Plan: `docs/plans/2026-09-24-owner-backlog.md` section 1; costs:
   `docs/ops/REPO_PRIVATE_COST_STUDY_2026-09-24.md`.
   **Plan written 2026-09-29 (Atlas): `docs/plans/2026-09-29-repo-private-plan.md`,
   awaiting the owner's decisions in its section 9.** Findings that change the
   picture: measured pace is about 135,000 billed minutes a month (about $790 on
   Pro), 90 percent of it pull-request checks, so moving scheduled jobs saves only
   about $13; and the live site publishes the whole repo (docs, scripts,
   migrations), so the Pages deploy must become an allowlist before any switch.
6b. **n8n exit, phase 2 (plan #1874, owner decisions recorded 2026-09-30; status 2026-10-01).** Order: D, B, A, E, F, C, K.
   Generate caption's AI job itself: LIVE for every client (`caption-generate` function, transcript box, fixed writing rules; OPEN_REPAIRS 388; `caption_generate_ef_clients` = all since 2026-10-09, checked 2026-10-16). The old n8n Generate Caption workflow has had zero runs since 2026-10-09. On 2026-10-16 the page's switch read and its n8n `generate-caption` fallback were removed (session Sunset); once that is live, Lighthouse deactivates the workflow (deactivate, not delete).
   D (TikTok poll trim) DONE #1878. B (caption progress in Supabase) DONE: `caption-jobs` live, Generate Caption edited and
   published, Calendar page switched (#1889). A (Slack Creative Channel Finalizer): trigger webhook and daily safety check are
   live next to the 15 minute timer (#1892); the timer is removed in a small follow-up only after the next real client's
   channels were created through the webhook. E (Filming Docs write) DONE with no new function: the only caller is the filming
   plan pipeline, which already writes through `pipeline-google`; the n8n workflow was deactivated 2026-10-01 (#1896, restore
   in `docs/ops/N8N_EDIT_LOG.md`). F (read fallbacks) DONE on the page (#1897); the three n8n readers stay on until a later check shows zero calls. C (Booking Recovery gating): the replay proof is built and passes, nothing switched (the queue is an n8n data table a database timer cannot read; see `docs/ops/BOOKING_RECOVERY_GATE.md`), owner decided 2026-10-01: stays hourly, no n8n edits (replay test and design doc kept). Last K (BUILT 2026-10-01, see OPEN_REPAIRS: client links always save through the functions). Generate Caption's Save step moved to `calendar-upsert` 2026-10-03 (OPEN_REPAIRS 334, session Sunset): every run of the two n8n save workflows (Calendar Upsert Post, Sample Review Upsert) since 2026-10-02 23:55 UTC was a test-client drill. Not yet proof of zero callers: staff repairs pinned to n8n that the on-load migration keeps (committed-tweak or unverifiable) can still replay there, so they must be rerouted or shown absent before switch-off. Both stay on until the owner's switch-off step. Earlier note: K (client approve and request-changes move).
   Every n8n edit is logged in `docs/ops/N8N_EDIT_LOG.md`.
   **Owner decision 2026-10-02: the 30-day safety window becomes 5 days.** An old n8n workflow may be switched off 5 days after
   its replacement ships and its live proof passes, each switch-off still its own n8n edit with the owner's go. Step K (#1906,
   client approve and request-changes to the functions) was given the go the same day; it waits only on a rebase and Lighthouse's
   merge. Generate Caption's Save step, the last real caller of the n8n Calendar save, moved to the function 2026-10-03 (OPEN_REPAIRS 334).
6c. **n8n exit, analytics jobs (owner, 2026-10-01): Metrics step built, waiting for the owner (session Harbor, OPEN_REPAIRS 322).** Order: daily metrics, Top Videos, Market Research. Our own Edge Function
   `analytics-metrics-collect` runs beside n8n CLIENTS METRICS in shadow (writes a shadow table only), compared daily; n8n is not edited. Plan with the node
   by node map and the steps: `docs/plans/2026-10-01-n8n-off-analytics.md`. (Measured 2026-10-09: the shadow migrations are applied, the shadow tables and both timers exist, both functions are deployed; both flags are `off` by the owner's 2026-10-06 pause; the live mode of 356 is not applied; Market Research is neither applied nor deployed.)
   Owner decisions 2026-10-01: Apify double spend accepted; Pro plan; day 1 shadow = test client plus one real client with Instagram, TikTok and YouTube, then all clients for 3 days; 3 clean days is the bar before proposing to switch n8n off. Next: Lighthouse merges, then the owner's click-by-click steps (`docs/ops/ANALYTICS_COLLECT_OWNER_STEPS.md`: three secrets, the key also in Vault). **Top Videos (2026-10-02, OPEN_REPAIRS 327, plan section 7): built the same way, in shadow beside n8n TOP VIDEOS (`analytics-top-videos-collect`, timer 08:00 to 12:59 UTC, same key and secrets, nothing new for the owner to create), not deployed, not applied; steps `docs/ops/ANALYTICS_TOP_VIDEOS_OWNER_STEPS.md`, after the metrics steps.** **Market Research (2026-10-02, OPEN_REPAIRS 335, plan section 7c): mapped and built the same way, in shadow (`analytics-market-research-collect`; it is NOT a daily job: n8n has five webhooks and no timer, so it builds one brief per request, test client first, with a daily cap), not deployed, not applied; steps `docs/ops/ANALYTICS_MARKET_RESEARCH_OWNER_STEPS.md` (one new secret, `ANTHROPIC_API_KEY`; confirm `OPENAI_KEY`).** Evidence of use: 13 briefs for 9 clients, none since 2026-06-03; the owner decides later whether to keep the Keywords brief at all. The other four enabled branches stay on n8n for now. **The switch for Metrics and Top Videos (2026-10-06, OPEN_REPAIRS 356, plan section 8b): built, in PR, nothing deployed or applied.** Flag mode `live` writes the real tables (source `edge`, first writer wins per client per day), n8n's safety checks rebuilt over our queues and named by the combined Slack message (which must be switched on first), the daily copy and parity lane no longer fail when the two tabs stop. No Sheet copy kept (owner). Steps: "Going live" in `docs/ops/ANALYTICS_COLLECT_OWNER_STEPS.md`; n8n deactivation needs the owner's explicit go.
7. **Navigation, then look and feel** (roadmap phases D and E in
   `docs/plans/2026-09-21-post-modularization-roadmap.md`), each starting from
   the owner's own observations.

8. **Agreed earlier, not yet scheduled** (found by an audit of the owner's
   requests on 2026-09-29; the owner orders these):
   - **Move SyncView's own traffic off n8n** (owner 2026-09-28, "completely
     optimize n8n execution"): Filming Plan Tabs (about 36% of runs), Calendar
     Upsert Post and its comment merge, Caption Prompts, Sample Review Upsert.
     Pairs with item 2. Forge restarted it on 2026-09-29: the plan
     (`docs/plans/2026-09-28-n8n-exit.md`) and PR 1a, the `filming-plan-tabs`
     Edge Function plus its cache-table migration, merged in #1846 (main
     `66750995efb371eadaf503b45ade6d984fd1f8cb`). Live since 2026-09-29: the cache
     migration is applied, the owner deployed the function
     (`https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-single-function.yml`),
     switched on the Google Docs API and shared the Filming Plan folder with the
     thumbnail service account, and a bulk read of 25 recent Filming Plan Docs came
     back from Google with no n8n fallback (source `google` in the cache). PR 1b
     (#1854, main `b1039f0a27c1e0c2239dca13e6564531ac61be39`) puts Kasper > Filming behind the runtime flag
     `filming_plan_tabs_source`; the flag row is applied and set to
     `{"mode":"function"}` (owner's go, 2026-09-29). Live, every browser read of that
     flag answered 400 because of a `_t=` cache-buster, so the page kept using n8n;
     #1857 removes it, after which Kasper > Filming reads from the function, with
     n8n kept as the automatic per-Doc fallback. Rollback: set the flag to
     `{"mode":"n8n"}` (takes effect on the next Filming open). The n8n Filming Plan
     Tabs workflow stays on for 30 days. **PR 2 (Calendar, #1858) merged 2026-09-29:** staff saves hold or pause on a fresh flag read and never fall back to n8n; client
     approve and request-changes untouched (byte-identical test); pinned repairs migrate on load;
     the n8n Calendar workflows stay on 30 days after it ships. **PR 3 (Caption Prompts, session Anvil) built 2026-09-29,
     awaiting Lighthouse's merge:** prompts are read from the `caption_prompts` table (browser saved copy, then n8n `caption-prompts-get`, only on error); the save is guarded by a fresh, bounded read of `settings_ef_clients` (paused or held, never n8n). `Caption Prompts - Save` can be deactivated 30 days after it ships; `Get` stays as the first-load fallback. **PR 4 (Sample Review, session Anvil) built 2026-09-29, stacked on PR 3, awaiting Lighthouse's merge:** staff Sample saves and reorders hold or pause on a fresh `sample_review_ef_clients` read and never reach n8n; client approve and request-changes untouched (byte-identical test); `sample-review-upsert` stays frozen; pinned Samples repairs migrate on load; the four urgent-marker writes now use the guarded step. `Sample Review - Upsert` and `Reorder` (n8n) can be deactivated 30 days after it ships; `Get` stays as the read fallback. Owner decisions: the client approve and request-changes buttons are
     not touched at all, and old n8n workflows stay on 30 days.
   - **Staff can see and restore recently archived Calendar cards and Samples**
     (owner 2026-09-29): BUILT in PR 1853 (session Harbor), waiting for
     Lighthouse's merge; move to Done after that. From the More menu, admin and
     SMM only; the card and each work item come back exactly as they were (plan
     `docs/plans/2026-09-29-calendar-unarchive.md`, ledger item 288). Still to do
     as a separate change: a warning when someone moves a work item whose card is
     archived (needs the sealed capture and an owner deploy).
   - **Daily real-browser client check from a local session, Samples included,
     noting odd loads, pop-ups and delays** (owner 2026-09-22). The shipped
     morning check is headless on GitHub. **2026-10-09 (session Gatekeeper, OPEN_REPAIRS 392, in PR):
     it now includes a client Samples approve** on the test client's sample with real work items (staff sends it
     with a real sign-in, the client approves, staff puts it back). It reads the SMM role key from the repository secret `ROBOT_ROLE_KEY_SMM` (entry 392). The local-session half is still open.
   - **Write down how to prompt local sessions to use the app's Browser pane
     instead of Chrome** (owner 2026-09-23, "write this somewhere").
   - **Public-key reads of `calendar_posts` and `sample_reviews`, phases 1 and 2**
     (#1691; owner 2026-09-27, "let's do it later"). Same pass: `anon` still
     holds INSERT, UPDATE and TRUNCATE grants (no write policy, RLS on) on ten
     tables, among them `clients`, `templates`, `team_members` and
     `syncview_runtime_flags` (measured live 2026-09-29). Row writes are
     refused; TRUNCATE ignores RLS, so this is defence in depth, as #1772 did
     for three other tables.
   - **The shared SMM key after a former SMM left**: changing it is the only
     complete fix; needs the owner's decision.
   - **Remove the Production "archive asset repair" button**: kept only for the
     Linear rescue, which is no longer needed.
   - **Stop Slack channels being missed**: a client's channel lives in two
     places; have the profile fill the notification setting automatically.
   - **Move everything else off Google Sheets, SMMs included** (owner
     2026-09-27 and 09-28, "a story for another day"). Analytics is item 1.

Dated items that must not slip: 2026-10-01 (items 1 and 2), 2026-10-15
(assurance-ledger rows expire, under "Needs the owner"), and retiring the
hiring senders when the editor hire closes.

## Needs the owner

- **Retiring calendar-upsert, step 1 (session Sunset, `docs/ops/CALENDAR_UPSERT_RETIREMENT_PLAN.md`): merged 2026-10-16 (#2104, `e0652a7a`), live v1 since 2026-10-16, switch on for the test client only.** The new `calendar-card-write` function writes a card's own fields with calendar-upsert's guards (proven equal on generated saves by `test/calendar-card-write-parity.js`). Staff saves go there only for clients on `calendar_card_write_clients`; client review links stay on calendar-upsert. Deployed and on for the test client 2026-10-16; Vigil's hand test the same day passed every staff path (see Latest). Needs: the Retry fix (#2111) merged and redeployed on the one-function lane, then step 3 or 4.
  Lighthouse review 2026-10-16: the function's logic was diffed against live calendar-upsert v90 and the parity test re-run
  against live (21,205 checks pass). Intended differences only. Notes: a rejected staff key fails the save instead of
  saving; switch entries must be exact slugs; never list a client before the function is deployed (a 404 does not fall
  back). Test gaps for Sunset's step 2: two deliberate breaks went unnoticed (comment merge `>` to `>=`, the archived-twin
  exclusion in the duplicate-link guard). Closed by Vigil's PR: the parity test now fails on each of them, on the
  stale-save tie, and on the urgent-time fix being undone.
- **Scheduled posts turn Posted by themselves (session Herald, OPEN_REPAIRS 402): built, not merged, not deployed, switch off.** Needs, in order: Vault key, the `CALENDAR_AUTO_POSTED_ACTOR` secret, the one-line `calendar-upsert` live delta, the `calendar-auto-posted` function, `migrations/2026-10-10-calendar-auto-posted.sql`, then `calendar_auto_posted` on for the test client.

- **One ordered sitting for everything built and waiting: [`docs/ops/OWNER_SHIP_LIST.md`](ops/OWNER_SHIP_LIST.md)**
  (measured 2026-10-09, OPEN_REPAIRS 389): 8 items, none needs the sealed capture. The roster switch (374) and the
  `analytics-read` deploy come first after a look at the backup.
- **Thumbnail titles follow-up (OPEN_REPAIRS 394, 2026-10-10): week-tab plans and stored failure reasons, in PR.**
  Release: apply `migrations/2026-10-10-thumbnail-titles-error-record.sql`, then deploy `thumbnail-titles`; then re-queue
  the 15 `generation_failed` and 4 week-tab items. Owner decision open: 21 items whose plan's newest month tab is older than the post.
- **Thumbnail titles, the stuck "Needs info" items (OPEN_REPAIRS 406, 2026-10-11): in PR, not deployed.** Measured 2026-10-11:
  67 open Needs info items on real clients (39 no match, 21 no month tab, 4 empty plan, 2 no plan, 1 failed). Causes: long plans cut
  at 20,000 characters, a plan with no tab for the post's month (now falls back to the next, then the previous month), plans that
  are only a header (now reported as an empty plan), numbering that restarts in a second list, and posts that are not plan videos.
  Release (the 2026-10-10 error-record migration is already applied, checked 2026-10-11): apply `migrations/2026-10-11-thumbnail-titles-requeue.sql`, deploy `thumbnail-titles` (lane `deploy-single-function`),
  then dry-run and run the re-queue. Owner decisions open: see the entry.
- **Thumbnail titles (OPEN_REPAIRS 391): LIVE.** Switch `thumbnail_titles` = `{"clients":["*"]}` since 2026-10-09 19:48 UTC
  (checked 2026-10-10); backfill ran 2026-10-09 (queue: 33 titles written, 111 Needs info lines, 3 skipped as already
  filled). Prompt editor is in the Calendar "..." menu under "Caption prompt". Follow-up above (394).
- **Retire the hiring senders once the editor hire closes.** Both n8n hiring
  dispatchers (interview invite, practical test) are still active and run every
  5 minutes, and the journal says the "Hiring Raw Log" data table (applicant data) is to be cleared then (not re-counted today).
  Evidence: n8n list 2026-09-26, both `active: true`. No deadline, but it is
  personal data sitting in a third-party tool.
- **2026-10-15: assurance-ledger lane goes red again.** Four quality-tier rows
  were restated, not re-proven, and reach 90 days on about 2026-10-15
  (OPEN_REPAIRS 205a). **2026-10-09 (session Gatekeeper, OPEN_REPAIRS 392, in PR): the three Tier 0 rows
  (client links, link issuance, client thumbnails) were re-proven on the live site, test client, 12 of 12
  (`node qa/dawn/tier0-live-proof.js`), plus Calendar staff writes and Samples + Kasper; the State column is
  restamped 2026-10-09.** Still past their window: submit intake, staff sign-in, the Linear mirror row, PTO,
  Templates, Filming plans, Weekly reports (re-prove or retire before the lane's 90-day line). The separate "Linear access extension to
  2026-10-15" is moot: all Linear keys were revoked on 2026-09-23.
- **Slack alerts become one message (owner said yes, 2026-09-28): BUILT 2026-10-02, merged, switch off (OPEN_REPAIRS 328; measured
  2026-10-09: the 09:37 UTC run printed `ALERT_DIGEST_ENABLED` empty, so it is still shadow).**
  Runs hourly in shadow (prints the message in the run summary, posts nothing); every old alert still posts. Owner's
  steps: compare shadow with real alerts, approve one edit to the n8n alert relay (snippet in
  `docs/ops/LINEAR_EXIT_STEP29C_ALERT_CONSOLIDATION.md`), set `ALERT_DIGEST_ENABLED` to `true`, then old alerts are removed one by one.
- **Modularization C3: every script fragment is a module; only step 13 (the
  runtime switch) is left, and it waits for the owner's go.** The prep is in
  (Keystone, 2026-09-29): each module lists the functions its buttons call on
  `window`, a check fails if a list goes stale, and the screen guard
  (`inline-handlers-browser.js`) enforces it. Owed: delete the dead
  `_sxrSyncStatusFromLinear` calls in `270` and update `test/sxr-move-link-*.js`. The measured proposal for the
  switch is `docs/plans/2026-09-29-c3-step13-switch-proposal.md`: serve today's
  code in today's order (native modules and a plain bundle both fail to boot,
  because of load order), and re-run `prod-boot-budget.js` on a machine with
  the live backend first.

- **Instagram upload is deployed; real post proof remains separate (Atlas read-only verification, 2026-09-30).** The live catalog has `instagram-upload` v3 and `instagram_uploads`; configured secret names include `POST_FOR_ME_API_KEY` and `INSTAGRAM_UPLOAD_ALLOWED_CLIENTS`. The account-ID Sheet column and a successful real Reel were not verified by Atlas. Source defaults restrict admission when the allowlist is unset; actual allowed-client values were not published. Keep wider rollout owner-gated. Steps: `docs/ops/INSTAGRAM_UPLOAD.md`.

## Needs a session

- **Something still saves Samples through n8n** (measured 2026-10-09, OPEN_REPAIRS 389): `Sample Review — Upsert`
  ran 729 times since 2026-10-02 and was running during the check, although staff and client saves go to the
  functions (289, 292, 333). Find the caller before that workflow can be switched off. Five other old n8n
  workflows had zero runs and are listed for the owner's switch-off go (ship list step 7).
- **Add `Access-Control-Max-Age: 7200` to `production-write`** (owner decision 2026-10-01; OPEN_REPAIRS 326). Measured 2026-10-09: it is **not in the source yet** (today's Section 4 deploy shipped main as it is), so a session adds it with the fingerprint re-pin and it ships at the next Section 4 deploy. `calendar-upsert` is frozen and stays without it.
- **The two-hour preflight header, live state (measured 2026-10-09, OPEN_REPAIRS 389):** live on `key-verify`, `smm-weekly-reports`, `thumbnail-revision-read`, `brain` and `workload-plan`. Waiting: `analytics-read` (single-function lane, ship list step 2) and `production-comments` (live build from 2026-09-17; its lane's manual dispatch also redeploys `notify`, `production-write`, `production-archive` and eight onboarding functions, all equal to main today; optional, ship list step 8).
- **Duplicate ledger numbers in OPEN_REPAIRS:** 13, 14, 22, 23, 175, 176, 177,
  180 each appear twice, and 220 sits before 218/219. Append a renumbering
  note; never rewrite.
- **Write-refusal log works; read it.** 4,573 refusals recorded since
  2026-09-23 (OPEN_REPAIRS 225 said "never recorded one"). 4,206 are
  `invalid_staff_key` on the Production gateway, almost all on 09-23 and 09-24
  and down to 2 on 09-25, so it looks like one automated caller that stopped.
  The `traffic` column (256) fills on browser reports and, since the 2026-09-30
  Section 4 deploy, on gateway rows too (measured 2026-10-09, item 4).
- **Scheduled lanes that are red** (the lanes in OPEN_REPAIRS 205). Repair or retire each.
  **2026-10-02 (OPEN_REPAIRS 329): the Production polish interaction and heavy lanes and the card vs
  calendar drift check had causes found and fixed (test code and test-client data only); confirm
  they are green on main after the merge.** The other lanes were not re-checked.
  **2026-10-08 (OPEN_REPAIRS 373, session Mend): Calendar E2E, Samples E2E and the drift check.** Robot causes
  fixed in test code (fake-key refusal shadowing the fake gateway; fake-key 401s on staff reads signing the robot
  out, which since admin-only Kasper sends it to Home; notes sent before their thread loads; two probes on
  retired addresses or rules). The drift check now lists N/A slots apart (owner: N/A wins). Measured 2026-10-09: the migration is
  applied from the LF copy (both routine bodies match the preflight pins, OPEN_REPAIRS 381), the test-client repair ran,
  and the pins are re-pointed (today's Section 4 run passed its preflight). Left: the `SYNCVIEW_STAFF_KEY` repository
  secret holds a role key (p96); a secret cannot be read, so the next Calendar and Samples nightly runs show it.
- **Workload plan `list` deadline** is only budget-raised, not fixed
  (OPEN_REPAIRS 210).
- **Dialog press-and-release (OPEN_REPAIRS 215) is DONE.** Fixed on main since
  #1431 (2026-09-19), 21 backdrops guarded by one shared helper. The Latch
  session's stall was a false alarm on a fixed item. A test now proves it on
  22 dialogs (`test/dialog-backdrop-press-browser.js`, OPEN_REPAIRS 287).
- **Mixed-batch orphans:** a browser fix should re-attach 22 cards; nobody has
  confirmed it on a live read (journal 2026-09-22).
- **Copy transport retry** (OPEN_REPAIRS 223/279): the native brief copy now
  retries with bounded attempts and reconciles ambiguous uploads by readback,
  tested offline. No live re-copy has been run.
- **Onboarding runbooks have no native steps** for their retired Linear parts
  (OPEN_REPAIRS 227).
- **Sheets to Supabase, next steps:** the mirror write is on and backfilled;
  CLIENTS METRICS and TOP VIDEOS mirror every client (since 2026-09-28). The
  mirror READ is enrolled only for the test client. Parity on 2026-09-28: no
  value differs; Supabase lacks Metrics 26-28 Sept and TopVideos 26-27 Sept,
  filled by the new daily copy lane once the owner adds its secret and
  variable. Staff read, daily parity check and catch-up job are built but the
  staff scopes needed `analytics-read` deployed, which the owner did on
  2026-09-28 (#1810). Switch-on plan and every other
  reader: `docs/plans/2026-09-28-analytics-switch-on.md`.
  `client_profiles_authority` was `sheet` then; since 2026-10-02 20:00 UTC it is `syncview` (OPEN_REPAIRS 331).
- **`mirror_outbox` still grows** (236 new rows in the last 24 hours, all
  receipts; 12,974 total). Retiring it is a planned later slice, not urgent.

## Dormant on purpose (switched off, leave alone unless asked)

- `linear_outbound_enabled` = off and `linear_legacy_parity_enabled` = false
  since the 2026-09-20 cutoff. Kept only because `production-write` reads them.
- `native_card_materialization` = `hold` since 2026-09-17 (dropped, could reopen).
- Native client provisioning and SyncView retirement activation: the SQL
  functions exist and are never called; retirement activation always refuses.
- Native intake completion, native notification sender, native urgent handoff,
  named append, existing-card assignment: built or drafted, not switched on.
- Linear-only calendar slots: the repair script found **0** slots to connect
  (2026-09-24), so there is nothing to apply.
- The historical monitoring cutover workflow retains only its manual TEST
  cleanup and roster report. Its Linear-dependent proof jobs are retired.
  Other Linear-only workflows are unscheduled for hand dispatch.
- SyncView v2 (Next.js): plans only. (Making the repo private is no longer
  dormant: the owner wants it, see priority item 6.)

## Done (was listed as open somewhere)

- **Escape closes a Calendar card's thumbnail or video edit box (owner report 2026-09-26; DONE, merged 2026-10-08 in
  #2000, OPEN_REPAIRS 371).** Re-checked on the live site that day (session Sentinel, test client) and found still
  broken, then fixed: Escape puts back the link the box opened with and closes it, Enter keeps what was typed; Samples
  too. Not yet re-checked on the live site after the merge.

- **Opening an item is faster, and the two SyncLinear saved-copy decisions are done (2026-10-01, OPEN_REPAIRS 323, PR open
  until merged).** The saved list lives 7 days; finished rows are kept in the browser's larger store and a boot reads only
  what changed (hourly full pass kept); a link at a finished batch shows its title in about 1.5 s warm instead of 5.3 s;
  new-tab links skip a redirect; SyncLinear rows start their reads when you hover. The staff check (about 1.0 s) is the
  floor under every new-tab open and was not touched. Record: `docs/audits/2026-10-01-open-item-speed.md`.
- **Kasper review board: a refused decision is no longer quiet, and the board says what it shows (2026-10-01,
  OPEN_REPAIRS 316, PR open until merged).** A refused save is re-read and re-applied only when nobody changed the part;
  otherwise a "not saved" alert stays until he acts. Returned cards say "Sent back to you", urgent cards say who and when,
  "Tweaks pending" opens by default, and a part staff moved past him without his decision shows in his history with
  who and when (owner decision: staff may skip him, never silently). Browser only, no deploy. Not yet seen in his browser.
- **SyncLinear opens and finishes faster, same page (2026-10-01, OPEN_REPAIRS 315).** Measured on the live
  site first: quick to use (switch 60 ms, no dropped frame, card under 100 ms), slow to finish (complete
  list 7.9 s in, 3.25 MB cold). The finished-items read now starts beside the live read (with a catch-up
  point for the next refresh), page one of the big reads starts when sign-in passes, and the per-row scans use lookup tables.
  Same rig, interleaved: cold complete list 8.2 to 5.9 s, cold first rows 3.7 to 3.1 s, warm fresh data
  3.5 to 3.2 s; 1,642 rows compared old against new, 0 differences. Way back: revert the PR.
- **Workload: unfinished work pinned to a past day is carried over (2026-09-30, #1875,
  OPEN_REPAIRS 295).** It shows on today (or Monday at a weekend, when Workload opens on the
  coming week) with a "Carried over" mark; the saved plan day is left unchanged. Cause found
  on a card archived and unarchived with an old manual day.
- **Two dormant censuses retired (#1871)** and **the load-per-tab split key fix (#1872).**

- **Today shows fresh items about 2x sooner and never yesterday's list (2026-09-30;
  OPEN_REPAIRS 296).** Reads start from the head script, one parent check instead of eleven, and
  a saved copy from an earlier day is not painted. Desktop cold 3,727 to 1,709 ms. Remaining floor
  is the wait for Clients Info (priority 1). Way back: revert the commit.
- **The two dormant censuses are retired (owner, 2026-09-29; OPEN_REPAIRS 293).**
  The outbox-debt and retirement-admission monitors only wrote heartbeats. Their
  workflows are deleted, both dead-man lanes are marked retired (dated, with a
  reason), and `lane-ticker` no longer dispatched them (it was itself deleted 2026-10-09, OPEN_REPAIRS 388). Scripts, SQL and tests stay
  as a frozen reference. Their 69 and 72 old heartbeat rows are kept in the event
  log, as every earlier retired lane's were; deleting them is a separate owner go.
- **Kasper loads on demand (#1841), checked by the owner with a real login on
  2026-09-29:** the Time Off and Clients tabs work. (Vigil's test account saw
  those two tabs error, as before the change; that was the account, not #1841.)
- **An SMM revived a work item whose Calendar card was archived (2026-09-29).**
  The item showed only in SyncLinear, because the Calendar hides archived cards
  and so does Workload, and SMMs have no way to see or restore an archived card.
  Lighthouse restored that one card to In Progress on the owner's request
  (logged in `calendar_post_events` as an `unarchive`). The owner said yes: PR 1853
  adds the view and the restore (see the priority list above).
- **Publishable-key reads of `workload_issues`, `workload_issues_native_v1`
  and `production_deliverables_browser_v1` stay open. Owner decision
  2026-09-28; do not raise these three again.** Keel (#1840) found they return
  tasks with staff names and emails (or staff ids) to the publishable key.
  #1840 stops a signed-out page from showing or keeping the board; these three
  grants are left as they are by choice. Only these three: `workload_plan`
  keeps zero browser privileges (measured 2026-09-29), and any other new
  public read is a regression.
- **Linear archive rescue (F34) is NOT needed. Owner decision 2026-09-28; do
  not raise it again.** Linear is being cancelled. Measured live the same day:
  3,478 briefs (with their images, see Brief media rescue below) and 14,205
  Linear comment bodies are already in SyncView, including those of cards
  archived in Linear. The only thing not copied is files pasted into about 246
  old comments on 46 cards (newest 2026-08-11), which stop opening once Linear
  is gone. The owner accepted that loss. The rescue script and its empty
  config table stay as dead reference.
- **Restore scratch Supabase project deleted** by the owner (only
  `syncview-calendar` remains, `list_projects` 2026-09-28).
- **Archived-in-Linear cards still open: swept 2026-09-28 on the owner's word**
  (OPEN_REPAIRS 282). 80 non-test cards in archived batches, with no calendar
  post link and untouched since their Linear archive, set to `canceled`. 8 left
  on purpose: 4 `posted` (correct), 1 edited after its archive, 3 linked to a
  calendar post (a status change there projects onto the client's calendar).
- **Design decisions closed 2026-09-28.** 212 (server recompute of a post's
  overall status): not needed, the page recomputes it on every load
  (`130-calendar-model-cache.js.part`), so the stored copy is never shown.
  Topbar "New issue": already removed in #1662. 254: not a decision; already
  deployed 2026-09-25 and checked live on the test client.
- **Analytics Sheets to Supabase:** the finishing prompt went to Prism on
  2026-09-28 (parity report, staff overview read, daily comparison, catch-up
  job, switch-on plan). Flags unchanged until the owner says go.

- **Guest-login gap closed before v2 sign-in (applied 2026-09-27).** The
  `authenticated` role no longer holds any right `anon` lacks: a live
  re-measure across tables, sequences, columns, functions, schemas and
  policies returns 0 rows (`migrations/2026-09-27-authenticated-grants-revoke-three.sql`,
  PR #1772). Anonymous sign-in stays OFF until the owner turns it on.
  The separate `anon` write and TRUNCATE revoke on the same three tables is
  applied too (#1772; measured live 2026-09-29: no anon write on
  `filming_plans`, `smm_weekly_reports`, `social_media_managers`), although the
  migration file's header still says NOT APPLIED. Ten other tables still carry
  anon write grants: priority item 8.

- **F27 capture guidance already names the three-function closure.** Read-only
  source check on 2026-09-26: `CLAUDE.md` and the Section 4 workflow both name
  `production-write`, `deliverable-write`, `batch-write`, and the old Linear
  inbound lane is absent. The saved `%USERPROFILE%\.syncview\f27-capture.ps1`
  also contains exactly `--slugs=production-write,deliverable-write,batch-write`
  and no Linear slug. This confirms the saved script text, not a fresh capture,
  bundle readback, or deployment; follow the fresh-capture gate before dispatch.
  **Superseded 2026-10-16 (session Conveyor):** the Section 4 lane captures,
  seals and stores the prior three itself (`capture` as both bundle inputs) and
  is dispatched on merge by `deploy-edge-functions-on-merge.yml`; nobody runs the
  saved script any more. Not yet run live: the first `capture-only` dispatch after
  merge is its live proof (see `docs/ops/EF_AUTO_DEPLOY.md`).
- **Linear is fully off.** No `linear-*` Edge Function is deployed
  (`linear-inbound`, `linear-outbound`, `workload-linear` all gone); all Linear
  API keys revoked 2026-09-23 (the runbook's STEP 7, which some docs still call
  pending). The n8n Linear calendar workflows and the monitoring pager are
  inactive, which also ends the n8n bill item in OPEN_REPAIRS 233.
- **Brief media rescue.** `native_brief_media` = `required` since 2026-09-21;
  1,338 of 1,338 occurrences `verified`, 1,338 files in the bucket. Supersedes
  F34 and LINEAR_MEDIA_RESCUE (the rest of F34 is not needed, see above). (The execution map row saying `off` is stale.)
- **All native capabilities on:** intake epochs, assignment, ordinary receipts,
  label catalog, identifier mint are `native` for both teams.
- **Migrations applied** that the ledger still calls "built, not applied":
  rename propagation release 1 and 2 (242, 243; flag on 2026-09-23), secure
  2026-08-24 backup table (248; RLS on, no browser grants), retirement assert
  re-pin (249), B2 Slice 10 (view dropped, two flag rows gone), sheets mirror
  phase 1, client profile edits, write-refusal page and traffic (256).
- **Deploys done:** `production-write` v95 (2026-09-25), `write-diagnostics`
  v14 (2026-09-25), `brain` (2026-09-24, OPEN_REPAIRS 251), `analytics-read`,
  `analytics-write`, `client-profile-write`.
- **Client links require their secret token.** `client-token-verify` runs
  browser entry in strict mode, which always requires one active client and
  its current token. `auth_enforcement` = `permissive` only affects legacy
  non-strict callers, and none remains: the only caller in this repo (and none
  in the other three repos) is the browser entry, which sends `strict: true`
  (`src/index/260-production-refresh-boot.js.part`).
- **Urgent ping and public intake** are both enabled (docs that say "flag row
  absent" or "off by default" are old).
