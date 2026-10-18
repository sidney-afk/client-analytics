# Card gauntlet, client side, round 2 (session Gauntlet Client 2, 2026-10-18 about 05:45 to 07:00 UTC)

Owner's ask (via Lighthouse): try the client review link on the live site, on the test client only, every interaction
and the layers between them, and make sure nothing a client types is lost, nothing lands on the wrong post, and there
are no errors, stuck spinners or flashes of old pages. Round 1 is `2026-10-17-card-gauntlet-client.md`.

**How it was run.** Real Chromium (Playwright) against the **live site** and the live backend, test client only, the
link built by `qa/test-client-entry.js` inside the harness (never printed or written). Every POST naming another client
is aborted (0 happened), Linear is blocked (0 calls), staff data untouched. 196 checks across 13 scripted passes.
Only the video **file** request was answered with the repo's own test clip, because this Chromium cannot decode the
MP4s Frame.io serves (a browser limit, not a site bug). Everything else was live. 63 throwaway cards were made on the
test client and archived at the end (verified). The two real cards of the test client were only read, never answered.

**What was not done.** A real video or thumbnail answer on a real card (a throwaway card has no work item, so its
video and thumbnail answers are refused by design, `native_link_required`; answering the real card would leave it
answered and a staff sign-in is needed to put it back). Round 1 did that path and it passed. A person on real Chrome
should play one real video once, and approve one real video.

## Verdict

The page is in good shape: 158 checks passed, 21 are notes (design facts, listed below), and 17 checks failed, which
come down to **five real bugs** and one test-script artefact. All five have a small fix in this PR, each with a test
that fails on main (`node test/review-stage-gauntlet2-browser.js`). The live site shows the bugs until it merges.

## The five bugs (fixed in this PR)

| # | Bug | Exact steps (live) | Fix |
|---|---|---|---|
| 1 | **A post silently swaps for another and the words follow.** Serious: a client's words can land on a post they never chose. | Open the link, open post A, click Ask for a change and type words. While they are typing, the team archives post A. A few seconds later (or the moment they click away) the stage shows post B with no word about it, the typed words still in the box. Press Send comment: the words are saved on post B (checked in the database). Screenshot: `post-swapped-silently.png`. | The page now says, above the buttons: the post it was on, that it is no longer on the list, that this is the next post, and that the words are still in the box and will go on this one if sent. |
| 2 | **Words typed and not sent vanish when another post is opened.** | Type a change request on post A, click post B in the strip, click back to A: the box is empty. Same for the part the words were about. Finish reviewing with words in the box also dropped them. | Unsent words (and their part) are kept per post for the client link and come back with the post. Sent words never come back. |
| 3 | **A long caption runs over the card.** | Open a post with a caption of about 700 characters or more (1,935 tested): the text overlaps the "N characters" line and runs out of the card. Screenshot: `long-caption-overflow.png`. | The caption scrolls inside the card; the line stays under it. |
| 4 | **Escape does nothing in some places on the client link.** | Open the in-app viewer (Sheet video button) or Notes, click Play or any button, press Escape: it stays open (it only closed with focus in its message box). The "Your approval was not saved" box never closes on Escape. | Escape closes the box on top (the notice first, then the Notes box), unless a field already used the key. |
| 5 | **Arrow keys do nothing until something on the page has focus.** | Open the link, click the page background (or press a key first), press Right arrow: the part does not change. | Left and Right work from anywhere on the page, except in a text box, with a dialog open, or in full screen. |

Fix files: `src/index/195-review-stage.js.part` (1, 2, 3, 5) and `src/index/190-calendar-approval-comments.js.part` (4).

## Every action tried (live, 1440x900 light unless said). Pass unless marked

| Area | Action | Result |
|---|---|---|
| Load | Open the link | Stage drawn in 2.4 to 4.3 s (6.9 s with every backend call slowed by 2.5 s). Warm reload shows the review-shaped skeleton and fades to the page; no old page flashed in 12 fps recordings, light and dark |
| Strip | Click a post, a video post, a post with two approved parts (opens on the waiting part) | Pass; the title, conversation and part always matched |
| Parts | Step bar clicks, Right and Left arrows, arrows at the ends, arrows inside the message box | Pass, except arrows with nothing focused (bug 5) |
| Parts | Part switch smoothness, measured every frame | Only the media box fades (to 0 in 0.16 s, by design); strip thumbnails (34 of 34) and the player are kept; no blink of header, strip, step bar or buttons |
| Player | Play, pause (time holds), seek to 70 %, back 5 s, forward 5 s, mute, Full screen button, double click for full screen and again to leave | Pass. Speed button is hidden on a vertical post at 1440 (narrow player rule; note) |
| Approve | Caption: database holds it in about 1.1 s, spinner clears in 1.2 s, no "Saving..." text, Finish reviewing becomes ready, step bar shows the check | Pass |
| Approve | Video on a card with no work item | Refused with the "Your approval was not saved" box and a Try again line (by design for a seed). The box shows technical wording ("Linear issue", `native_link_required`); a real card never meets it. Escape did not close it (bug 4) |
| Ask for a change | Empty box: both buttons off. Words and no part: only Send comment on. Pick a chip: Ask for a change on. Pick it again: chip clears, words stay | Pass |
| Ask for a change | With part picked: Tweaks Needed in 1.0 s, stage shows "Change asked" and the words. Stage button opens the box with the part picked and focus in it. Enter with an empty box sends nothing; type then Enter sends | Pass |
| Comment | Send comment with no part: note saved, status unchanged, box emptied | Pass |
| Change my mind | Approved caption: box with "Send to your team", Cancel sends nothing, Send keeps it approved and the note shows escaped (emoji, quotes, `&`, `<b>`) | Pass |
| Edit caption | Editor opens with the text; Cancel and Escape send nothing; Save changes the caption itself (owner decision, session Curtain Eight), the status stays waiting, a note carries "Changed the caption to ... It was ...", text with line break, emoji, quotes, `&`, `<tags>` saved byte for byte | Pass. (The ask said "as a change request"; the live behaviour is the later decision in STATE_OF_THINGS) |
| Finish | Opens the next post with the toast; Undo brings the post back; approve then Finish within 150 ms still saves | Pass |
| "?" help | Opens the tutorial (an iframe); Escape, the dim area and the X close it; press inside and release outside does not close it; no video keeps playing after | Pass. Note: after clicking inside the video frame, Escape goes to the video, not the page (X and the dim area still close it) |
| Sheet | Name, caption, call to action and date are read only; typing saves nothing (0 calls) | Pass |
| Sheet viewer | Video button opens the in-app viewer (video left, notes right), no new tab, starts playing, pause, play, seek, full screen, a note written beside the video saves and shows, nothing keeps playing after closing | Pass |
| Notes | Notes button on a card with no playable video: no player, box focused; half typed text is kept when closed with Escape and comes back | Pass |
| Layers | Delete a note asks to confirm on top of the viewer; clicking the dim area closes only the confirm; Delete removes the note and the viewer stays; Reply puts the box in reply mode | Pass. Escape on the confirm and on the viewer from a button: bug 4 |
| Month, Week | No draggable posts, no "Unscheduled ... drag onto a day" list | Pass |
| Theme | Moon to dark on Review, Sheet, Month, Week, kept after refresh; light again | Pass |
| History | Review, Sheet, Month then Back goes back one tab (twice, stays on the site), Forward twice returns | Pass. The link reopens on the last tab used (Month) rather than Review (note) |
| Refresh | Reload with a half typed message: the words are gone (nothing was sent) | Note: unsent words do not survive a reload (design question, below) |
| Two tabs | A approves while B only looks: B says "Approved in another window or by your team", stays on the same post | Pass |
| Two tabs | B typing, A approves, B presses Ask for a change: "This was already approved, so we sent your words to the team as a note"; the post stays approved; the words are in the database | Pass. While B has focus in the box the notice waits until B leaves it (by design, so typing is never disturbed) |
| Two tabs | Team sends the post back while the client looks: told within 1 s | Pass |
| Two tabs | Archived by the team | Silent swap: bug 1 |
| Two tabs | Both approve at the same moment: ends approved, 0 errors. Approve in A and a change in B at the same moment: one outcome (Tweaks Needed), the words kept | Pass |
| Races | Approve then click another post at once: first approved, second untouched. Send a change then switch post at once: words only on the right post | Pass |
| Offline | Approve offline: "Sending..." shown, nothing sent; on reconnect it sends by itself in about 1 s. Ask for a change offline: words visible, sent by itself in about 5 s with the words | Pass |
| Server error | A 500 on Approve: the not-saved box, a Try again line; Try again after recovery saves | Pass |
| Server never answers | Held for 70 s: the post shows "Still waiting for the server. Nothing is lost: it finishes here on its own.", the words stay in the conversation, the save is tried again about every 20 s. There is no Try again button because it keeps trying itself. Screenshot: `save-never-answered.png`. Note: Finish reviewing lights up while the change is still sending | Note |
| Slow network | Every backend call 2.5 s slower: loads in 6.9 s, approve saved in 3.7 s, spinner cleared 0.1 s later | Pass |
| Phone 390 and 430, light and dark | Review, Sheet, Month, Week: load under 2.5 s, no sideways page scroll (0 overflowing elements) on all 24 combinations; tap Approve (1.0 s), tap Ask for a change with words (1.0 s), the box with the keyboard text typed is on screen, Finish fully on screen, the help video fits, the Sheet viewer fits | Pass |
| Real cards (read only) | The real card opens with its player, thumbnail, caption and earlier notes (339 characters of conversation), and the Sheet video button opens the viewer on it | Pass |
| Safety | Page errors, other-client writes, Linear calls | 0, 0, 0 in every pass |

## Notes and design questions (nothing broken; owner decides)

1. **Unsent words do not survive a reload or closing the tab.** Bug 2's fix keeps them while the page stays open.
   Keeping them in the browser across a reload is a bigger change (storage, clearing rules).
2. **Real answers are only verified on caption.** See "What was not done".
3. **Speed button hidden on a vertical video at 1440**, shown only on wider players (shared rule below 300 px).
4. **Finish reviewing is lit while the last answer is still sending.** It is harmless (the answer still lands) but a
   client who clicks it fast and then closes the tab before it saves could lose the answer. Suggestion: keep it off
   while a part is saving.
5. **The not-saved box uses developer wording** ("linked to a Linear issue", `native_link_required`). It only shows
   for a card with no work item, which a real card does not have.
6. **The link reopens on the last tab used.** A client who left on Month lands on Month, not Review.
7. **Month and Week: clicking a post thumbnail opens nothing** for the client (no play, no notes). Not a regression.

## Test data left behind

None. 63 throwaway cards (ids start with `p_gc2_`) were archived and verified. The two real cards were not answered.
