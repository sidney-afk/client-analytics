# Glitch sweep, 2026-10-17 night (session Patrol)

Asked by the owner via Lighthouse: walk the site like a person, find glitches
and bugs in what changed over the last two days, fix what can be fixed in small
PRs. Speed was session Stopwatch's ground and was left alone. Time box
23:10 to 01:30 UTC. Only the test client was touched, and nothing was written:
every walk was clicks, hovers, Escape, Back/Forward, refresh and screenshots.

## What was walked (live site, robot staff sign-in, test client)

- **Calendar, desktop 1440:** Sheet, Review, Month, Week; Files menu; card hover;
  play button and the video and notes player (opens, no autoplay, speed and
  Frame.io links present); Notes; Notify client (confirm box opened, then
  cancelled, nothing sent); Organize menu; caption "Redo with a note" box
  (opened and closed, nothing generated); Back/Forward and refresh.
- **Calendar and Samples, phone 390:** picture grids, focused card, its Card
  actions sheet, Back.
- **Today -> SyncLinear -> Back to card -> browser Back**, read-only.
- **Messages** list and a test-client thread; **Post**, **Workload** (desktop
  and phone agenda), **Samples**, **Filming Plans**.
- **Client review link** (test client): Review, Sheet, Month, Week at 1440 and
  390, light and dark colour scheme.

## Fixed (one PR each, each with a browser or unit test that fails on main)

| PR | Glitch | Cause |
|---|---|---|
| #2166 (merged) | Calendar card: the Files (folder) button covered the end of the orange "No video linked" warning. | Warning and button pile both pinned to the same bottom-right corner; the pile was empty before the Files button existed. |
| #2170 | Messages page: every top-bar tab turned into a white outlined box. | The flat look only applied while the sliding highlight was "ready", and that state was dropped whenever no tab was active, which is always so on Messages. |
| #2176 | Phone Calendar and Samples grid (and focused card): last row cut off over an empty band of about 90px above the Review bar. | The grid measured its distance from the top once, while the phone page header (74px) was still showing, and never re-measured after it was hidden. |
| #2177 | SyncLinear: after Back to card then browser Back, the sub-issue header read "0/13" sub-issues done for 1.5 to 3 seconds (truth 19/32). | First paint comes from the saved copy, which by design holds no finished work; the chip stated its "0 done" as fact. Now shows "…" until real counts arrive. |
| #2182 | Messages chat: day dividers read "2026-10-17" on desktop, and notes sent after 6pm (UTC-6) sat under the next day. | Grouping cut the UTC timestamp's first ten characters. Now the reader's local day, labelled "Sat, 17 Oct 2026". |
| #2204 | Desktop pop-ups: a mouse click on a dimmed backdrop (the Archived list, for one) closed it and then also landed on the page underneath, e.g. focusing a card's name field. Found while getting #2176 green. | The shared pop-up layer closed on the mouse press, removing the backdrop mid-click; a press on a backdrop is now left to its own click handler. |

Before and after pictures (fictional fixture data only) are in
`docs/audits/shots/2026-10-17-glitch-sweep/` on each PR's branch and in its body.

## Found, not fixed

1. **Staff Calendar toolbar: the Review | Sheet | Month | Week toggle moves
   about 84px** when switching between Sheet and the other three views (Sheet
   shows Organize, zoom and select buttons; the others hide them). #2162
   promised "the toggle never moves". The layout lives in
   `188-review-stage-switch.js.part`, which sessions Curtain Six and Seven own
   tonight, so it is theirs. Seen live at 1440 on the test client.
2. **Phone picture grid, card with no picture:** the placeholder is the same
   four-squares icon as the "grid view" button, and the empty tile is the same
   colour as the page, so the number and icon float on nothing. A design call
   for the owner (a picture icon and a slightly darker tile would read as
   "no thumbnail yet").
3. **Phone Workload agenda at the weekend:** the week strip shows next week
   (19 to 25 Oct) while the list below is headed "Saturday 17 October", and no
   day in the strip is highlighted. Desktop also jumps to the next work week
   on a weekend, so this may be intended; the mismatch is the odd part.
4. **SyncLinear item counter** (top right, "3/13" then "7/32") also counts the
   partial list for the same 1.5 to 3 seconds after Back. Left as is: it is the
   position in the loaded list, and it settles; #2177 fixed only the stated
   "done" count.
5. **Hover tips that stay up:** the Organize tip stays visible above its open
   menu, and after switching Sheet to Review the Notify client tip appears
   because the button slides under the resting pointer (a side effect of
   item 1). Cosmetic.
6. **Per-client page on a phone** (Analytics -> client -> Content Calendar at
   390): the Calendar toolbar wraps into four rows (zoom alone on one, three
   square buttons on another), and the "Content Calendar" pill's text touches
   its edges. The main phone Calendar tab does not have this.
7. **Client review link ignores the phone or computer's dark setting** (stays
   light until the moon button is pressed). Probably intended; noting it.
8. **Stale tests (not run in CI, fail identically on main):**
   `test/prod-subissue-parent-name.js`, `test/production-preview-source.js` and
   `test/submit-video-notes-and-tab-icons.js` read functions out of
   `index.html`, but that code now ships in `js/sv-*.js`, so they stop with
   "missing function". Worth repointing at the source fragments.

Not glitches, checked and fine: "This video could not be played" in the
player came from the test browser lacking the video codec; `/samples` and
`/linear` addresses go to Today because they were never real addresses; a
client sees the "drag onto a day" tray only when Collaborative mode is on,
which it is for the test client.

## Screenshots, in words

- Calendar card before #2166: the orange warning's last word "before" sat
  under the small white folder button in the thumbnail's corner.
- Messages before #2170: the top bar looked like a row of eleven white pill
  buttons with grey outlines, unlike every other page's flat text tabs.
- Phone grid before #2176: three rows of tiles, the third cut in half, then a
  blank grey band, then the white "Review posts" bar.
- SyncLinear after Back, before #2177: grey chip beside the parent's name
  reading "0/13" for about two seconds, then "19/32".
