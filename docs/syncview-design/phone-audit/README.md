# Phone audit and polish, round 1 (session Grip, 2026-10-25)

The owner turned down a phone redesign (draft #2307) and asked for today's design, made smoother. This folder is the
audit of the real page on phones and the before/after pictures of what was built. Nothing here ships to the site.

- `harness.js`, `fixture.js`: the offline page (every backend answer local, fictional posts and notes), taken from #2307.
  The signed-in staff member has the switches the owner's own login has on (`unread_badges_v2`, `caption_history_staff`,
  `thumbnail_title_buttons_staff`), plus `phone_polish_staff` unless `PHONE_POLISH=0`.
- `audit.js`: at 360, 390 and 430 px, light and dark, opens the Calendar Sheet, an opened post, its Notes, Messages (list
  and a conversation) and the client's review page (caption step and video step). Per screen it measures how far down
  the thing people need sits, taps under 44 px or under 4 px apart, horizontal overflow, cut text, inputs under 16 px
  (iOS zooms on them) and whether the box being typed in stays on screen with the keyboard up.
  `measure.js` is #2307's own measurement. Production and Workload were measured with `qa/finch-phone/shots.js --audit`.
- `desktop-shots.js`: the desktop Calendar and Notes with the switch on, for the "desktop does not change" proof.
- `shots/`: `<width>-<theme>-<screen>-before.jpg` is main; `-after.jpg` is this change with the switches on.

## What a person feels today (ranked by how often they hit it, then how much it hurts)

| # | Where | Problem | Measured (before) |
|---|---|---|---|
| 1 | Opened post (staff) | Notes, the most used thing on a card, is the last line | 1,139 px down; the screen is 780 to 932 |
| 2 | Client review page | On the video step Approve is below the first screen | 803 px (360), 839 px (390) down |
| 3 | Notes (staff phone) | Every note carries a "Delete" word button as big as Reply, inside a boxed bar | 10 Deletes on one card |
| 4 | Production list | At 360 and 390 the person's picture wraps to a third line | 170 px per row (120 at 430) |
| 5 | Opened post (staff) | The picture takes most of the first screen | 235 px picture, details start at 379 px |
| 6 | Messages list | The last message is cut to one line, so a short question needs opening | one line, cut after about 30 letters |
| 7 | Client review page | A waiting post's name is cut after a few letters | "Morning routine r..." at 118 px |
| 8 | Client review page | "130 characters" under the caption means nothing to a client | on every caption step |
| 9 | Client review page | The cross that deletes one's own note is a 20 px target | 20 x 20 |

Checked and clean on every width and theme: no horizontal overflow, no input under 16 px, no tap under 44 px on the
staff screens, the box being typed in stays above the keyboard in Notes and Messages, no page errors.
Workload (calm calendar) and Production's issue page passed the existing phone audit.

Seen and left alone (they change the design, which the owner asked to keep): the full-width coloured status bars, the
Sheet's top (first post at 272 px: the header, client picker, Sheet / Calendar / Review switch and the grid / list bar
are all needed), two stacked headers in a Messages conversation, the always-shown "Finish reviewing" button.

## What was built

Staff, behind `phone_polish_staff` (phone width only): 1, 3, 4, 5, 6. Client page, behind `review_client_polish`
(phone width only): 2, 7, 8, 9. Proof: `docs/syncview-design/tests/phone-polish-browser.js`. OPEN_REPAIRS 501.

| # | After |
|---|---|
| 1 | Notes sits right under the statuses: 655 px down, on the first screen at every width |
| 2 | The video is a little shorter: Approve and Ask for a change are both on the first screen (710/758 at 360, 774/822 at 390) |
| 3 | Delete is a quiet bin at the row's far end (still 44 px, still asks first); no box around the actions |
| 4 | The picture sits on the title's line: 120 px rows at 360 and 390 |
| 5 | The picture is 180 px tall |
| 6 | Two lines of the last message |
| 7 | Two lines of the post's name |
| 8 | No character count (Expand the caption stays) |
| 9 | 44 x 44 |
