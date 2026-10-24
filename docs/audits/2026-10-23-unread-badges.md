# Unread badges: audit, rules and build order (session Beacon, 2026-10-23 20:33 UTC)

Owner request, 2026-10-23: the notes badges on the content calendar, the Samples calendar and the client review sheets,
and the Messages button, must say at once and correctly what is waiting (a client comment, a client change request, or
both), before anything is opened, and must stay correct whatever happens (a reply, someone else's reply, a resolve, a
read in another tab or on the phone). The Messages badge showed only after a click and pushed its icon to the left.

Mockups: screenshots of the real page in [`docs/syncview-design/mockups/unread-badges/gallery.html`](../syncview-design/mockups/unread-badges/gallery.html)
(pictures in `shots/real/`, made by `make-screenshots.js`; see section 8). Nothing below is built except the
Messages-button fixes in their own small PR (#2300).

**How this was measured.** Code read on `main` at `9098505`. Both reported bugs reproduced offline in Playwright
(`docs/syncview-design/tests/messages-badge-boot-browser.js` fails on main, passes on the fix). Live data was read
read-only through the Supabase connector (counts only). This environment cannot reach `syncview.synchrosocial.com`
or frame.io (network policy), so nothing was checked on the live page.

## 1. What exists today

Five places show unread or "open" signals, built on **three separate read states** that never talk to each other.

| Surface | Drawn in | What it shows | Count from | Marked read by | Scope of "read" | Live by |
|---|---|---|---|---|---|---|
| Calendar card Notes button | `190` `_calCommentsBtnHtml`, CSS `020` `.cal-comments-btn` | an orange **dot** for "anything new" plus **"N open"** for open change requests. The dot does not say comment or change, or who | `_calHasUnreadNotes` (`180`): any message whose role differs from yours, `updated_at` later than the seen stamp. "N open": `_calOpenCommentCount` (`190`) | opening or closing Notes: `_notesMarkSeen`, localStorage `syncview_notes_seen_v1` | **this browser**, and by role: every staff member is `smm` | realtime `cal-<slug>` on `calendar_posts`; 30 s pull when the socket is down |
| Samples card Notes button | `280` `_sxrCommentsBtnHtml` | same dot; a bare number (not "N open") | `_sxrHasUnreadNotes`, `_sxrOpenCommentCount` on `sample_reviews` | same `syncview_notes_seen_v1` key | this browser, by role | realtime on `sample_reviews` |
| Client link: Sheet tab | the Calendar card, role `client` | same dot, staff replies | same | same key, on the client's device | that device | same |
| Client link: new Review page (`195`) | `#rsBadge` | posts waiting for an answer, **no notes signal at all**; reading a thread there marks nothing seen | `_rsAnswered` | n/a | n/a | n/a |
| Messages button and Kasper Messages tab | `030` `[data-msg-count]`, `326` `_msgPaintCounts` | number of **conversations** with something new; one colour | server: `production-comments/inbox.mjs` `countsAsNew` / `unreadCount` | opening a conversation in Messages: `inbox_mark` into `public.message_reads` | **per person, on the server** | after the first load only: realtime `msg-inbox` on `calendar_posts`, BroadcastChannel `sv-msg-inbox`, 60 s timer, tab focus |
| Kasper review cards | `330`, `290` `.kcard-newreply-chip`, `.kcard-tweaks-chip` | "New message" chip; open tweak count | `_kasperHasUnreadReply` (`180`) | localStorage `syncview_kasper_seen_at_v1`, and the `kasper_finished_at` column | this browser (plus finish) | `kasper-cal`, `kasper-sxr` channels |

Today and Production show no unread badge (Today shows the newest open caption tweak's first line; it is not a badge).

### What session Hush (OPEN_REPAIRS 443, merged) already fixed
Server-side rules for Messages: automatic records (role `system`/`automatic`/`auto`/`bot`, or the client page's full
"Changed the caption to: ... It was: ..." record) never count; Kasper's view counts only staff messages; your own
messages never count (by member id, by name for older notes); the New / All switch; the badge refreshes by itself
**once the inbox has been loaded once**. Hush deliberately kept "never ask the server at page load", which is bug 1.

## 2. The two reported bugs

**Bug 1, the Messages badge appears only after a click.** Two causes, both in `326-core-messages-inbox.js.part`:
1. By design, the inbox was read only when the pointer reached the Messages button or Messages opened ("never at page
   load"), and the live refresh starts only after that first read. So a fresh page had no count at all.
2. The sign-in check (`100`, `_syncviewStaffRefreshChrome`) calls `_msgOnIdentity()` when it answers, but it usually
   answers **before the Messages code has run** (it lives in a later script chunk). The call threw, was swallowed by its
   `try`, and nothing ever started. Measured offline: `_msgOnIdentity` never ran on a normal Calendar load.

**Bug 2, the badge pushes the icon left.** The count was an inline item beside the icon inside a fixed 34 px button
with centred content, so the icon moved 9 px left with one digit and 11 px with two. Measured offline.

**Fix (separate small PR, no switch):** the first inbox read now starts 1.5 s after a sign-in that may use Messages is
known, and the Messages code starts it itself when it loads after the sign-in. Never on the Production tab (its
read-only gate), on a client link, or in a hidden tab (it waits). The count sits on the button's top-right corner with a
ring in the header colour. `messages-inbox-browser.js` check O asserted the old "no call at page load" rule; it now
asserts the new rule just as strictly (exactly one call after load, no second call on hover or open).

## 3. Live numbers (read-only, 2026-10-23, all clients, counts only)

- 5,725 live (not deleted) notes on cards. In the last 30 days: 1,779 notes; 542 client change requests and 259 client
  comments started threads; 343 staff notes.
- **1,715 of 1,737 resolved notes have `updated_at` later than `created_at`.** The card dot compares `updated_at`, so
  resolving a note makes it "new" again on every other device and for every other person.
- Only 227 of the 1,779 notes from the last 30 days carry `author_member_id`; the rest can be told apart only by name.
- `message_reads` holds 12 rows from 1 person: the per-person server read state exists but almost nobody's reads are in
  it, because reading on a card never writes there.
- 13 client notes are automatic caption-change records; the card dot counts them, Messages does not.

## 4. Problems found (beyond the two bugs)

1. Three read states (card per browser, Messages per person on the server, Kasper per browser). Reading in one place
   leaves the other places unread. A note read on the phone stays unread on the laptop's cards forever.
2. The card dot is by role, not by person: all staff are `smm`, so another staff member's note never lights your dot,
   while anything Kasper writes does.
3. Resolving or editing relights the dot (the `updated_at` comparison, item 3 above).
4. Automatic records light the card dot.
5. The card dot cannot say comment vs change request vs both, or client vs staff; "N open" and the dot look alike.
6. No 14-day floor on the cards: a new browser shows a dot on every card with any old note from another role.
7. Two tabs write the whole `syncview_notes_seen_v1` map back, so one tab can undo the other's stamp; no `storage` listener.
8. Notes that exist only in the canonical comments table reach a card only after it is hovered or opened.
9. The client's new Review page never marks notes seen, so the Sheet keeps showing a dot for something already read.
10. The orange style for the Kasper Messages tab count is overridden by later rules and never shows.
11. On phones the open/unread text colour on the Notes button is overridden; only the dot remains.
12. Calendar says "N open", Samples a bare number; the tooltips use different words.
13. Seen stamps use the device clock against server times from other devices.
14. Messages never shows a client change request that no staff member has answered yet (owner's decision of
    2026-10-14, `inbox.mjs` header: change requests belong to the card). So a client's change request raises the
    card dot but not the Messages badge, while a client's plain comment raises both. This is the main reason the two
    badges disagree today; see D2.

## 5. The rules (round 2, 2026-10-23 21:12 UTC, after the owner's answers)

**Owner's answers on round 1:** D3 yes (a read on the phone clears the laptop within 30 s), D4 yes (orange change, blue
comment, grey staff, violet Kasper), D5 yes (one read record), D6 yes (another staff member's reply counts for you,
grey). D1: more mockups first (this round). D2: rethink from his model. New: what happens to a message he wants to
answer later, once Notes has been opened.

**The model: two places, two jobs.**
- **Notes on a card is where change requests are worked.** A change request is a task: it is new until you have seen
  it, then open until it is Done. It lives on the card, and nowhere else counts it.
- **Messages is for conversation:** client comments and questions, replies, staff and Kasper messages. These are new
  until read, and a client's comment also waits for an answer until the team has answered it.
- The card shows **both** (it is the whole picture for one post), so from the calendar alone you see every change and
  every comment, before opening anything. Messages shows **only conversation**.

**Two states, never mixed:** *new* (filled badge) is per person and clears when you look; *needs you* (outlined badge)
is shared by the team and clears only when the work is done: a change marked Done, a comment answered or marked
"No reply needed". Opening Notes clears only the first.

### Kinds

| Kind | Who writes it | New (filled) | Still needs you (outlined) | Where it counts |
|---|---|---|---|---|
| Client change request | client, `is_tweak` true (missing counts as a change) | orange pencil | orange "N open" until Done | **card only** (Notes and the card badge) |
| Client comment or question | client, `is_tweak` false | blue bubble | blue reply arrow, "waiting for an answer", until a team reply or "No reply needed" | card **and** Messages |
| A client reply inside a change-request thread | client | orange (it belongs to the change) | the change stays open | card only |
| Staff message | any staff member who is not you (member id; by name when the note has none) | grey person | no waiting state (staff ask each other directly) | card and Messages |
| Kasper | Kasper | violet eye | no waiting state | card and Messages |
| Another staff member's reply to a client | staff | grey (D6) | it **answers** the client's comment, so the blue "waiting" clears for everyone | card and Messages |
| Automatic record | the app (system roles, the caption-change record, status moves) | never | never | a grey line in the chat |
| Your own note | you | never | never | |

### What makes something new or waiting, and what clears it

| Event | New (per person) | Needs you (team) |
|---|---|---|
| A person writes a note or reply | new for everyone it counts for, by its `created_at` (never `updated_at`) | a client change request opens; a client comment starts "waiting for an answer" |
| A note is edited | not new again | unchanged |
| A change is marked Done | not new | leaves "open"; shows "Done" in Notes |
| A Done change is reopened by the client | new again | open again |
| A team member replies to a client comment | the reply is new (grey) for the other staff | the comment is answered: "waiting" clears for everyone |
| "No reply needed" on a client comment | | clears "waiting" for everyone; who and when is recorded and shown |
| A note is deleted or hidden | stops counting at once | stops counting at once |
| You open Notes on a card | everything on that post is read for you, on the server | **unchanged**: open changes and waiting comments stay pinned under "Needs you" |
| You open the conversation in Messages | read for you (one read record, D5) | unchanged |
| You open the hover preview | nothing changes | nothing changes |
| You reply | read up to your reply | your reply answers the comment |
| Mark unread | back to new for you only | unchanged |
| No read record yet | only the last 14 days count | waiting is not limited to 14 days, but only comments written after this ships start waiting (no backlog of old comments) |
| The client reads a staff reply on the review link | read on that device only (clients have no sign-in); never affects staff badges | |

### Answering later (the owner's new case)

Opening Notes to read everything must not lose the one message he wants to answer later. Three ways were considered:

| Option | How it works | Good | Bad |
|---|---|---|---|
| **A. Waiting for an answer (automatic)** | every client comment waits after it is read, until someone on the team replies or marks "No reply needed" | nothing to remember or click; shared, so whoever answers clears it for everyone; it is also the honest state for the client | thank-you comments ("love it!") wait too, and need one click on "No reply needed"; the app does not guess from a question mark, because guessing wrong hides a real question |
| **B. Mark unread (manual)** | puts the "new" fill back for you only (it exists in Messages today) | simple, already built | you must remember to press it; it is personal, so a teammate does not see that something is owed |
| **C. Remind me (snooze)** | the item comes back as new at a chosen time | good for "after the shoot" | needs a stored reminder and a timer on the server; most useful only once A exists |

**Recommendation: A, with B kept as the personal fallback.** C can come later, if Sidney still misses things with A
in place. Changes need nothing new: they already stay open until Done.

### Sync (unchanged from round 1, owner said yes to D3)

| Situation | How fast it updates |
|---|---|
| A new note anywhere | realtime on the cards (channels already open) triggers one summary read, at most one per 5 s; the card, the Messages list and the header repaint from that one answer |
| Read, answered, Done or "No reply needed" in another tab of this browser | BroadcastChannel ping, immediate |
| The same on the phone or another computer | when that tab is looked at again (immediate), otherwise within 30 s (safety net lowered from 60 s) |
| Page load | the badge is drawn from the first read, 1.5 s after sign-in, with a retry if it fails (PR #2300) |

### What each place shows (round 6, 2026-10-24 14:20 UTC, desktop, live behind `unread_badges_v2`; replaces round 5's details)

The owner used round 5 live on his own logins and set one rule for everything: **as little visual noise as possible;
show only the information that's needed.** These are the rules the phone design (session Palm) should follow too.
Built in #2312 (part 1) and #2314 (part 2); OPEN_REPAIRS 485 and 486.

- **People are named by first name** everywhere (Notes, Messages, hovers, the reply caption); the full name is in the
  hover. Pictures are each person's Slack photo; a client's is their Slack contact's; without one, initials.
- **Times are relative** ("12m ago", "3d ago", "2w ago"); the full date is in the hover, and a conversation's day
  lines carry the day: Today, Yesterday, the weekday within a week, then "Wed 14 Oct".
- **Status words are quiet coloured words, never filled pills:** "Waiting for your answer" (blue), "Change request"
  and "Not done" (orange), "New" (the kind's colour). "Waiting for your answer" stands alone (no extra "New").
- **"Team only" is a small lock** whose hover says "Team only: the client never sees this".
- **Actions show on hover only, as plain words** (no boxes, no fills, not even on hover): Reply, No reply needed (on a
  comment waiting for an answer), Mark done, Delete. There is one set per note, never a second always-visible row.
  On the phone, where there is no hover, the same words belong in the note's own menu.
- **Card hover:** picture, first name and one line of the note. No date, no kind label, no footer. It also lists a
  change still open, so an outlined bubble is explained.
- **Notes:** no "Needs you" box; "Mark unread" is one quiet word in the head.
- **Messages conversation:** the header is the first name, the lock, a quiet "Change request" when it is one, the
  relative time, and the part (Video) quietly at the right. No role word. Your own picture sits beside your name.
  One thin red "New" line marks where the unread part starts (no tag on each message). A client's change request is
  one quiet line ("Casey asked for a change on the video · 12m ago · Open card"). A follow-up by the same person
  within five minutes shows the picture and name once.
- **Messages list:** every badge says in a hover what it counts ("Casey: 1 comment waiting for your answer"). The
  header has no empty thumbnail, and its actions are the words "Mark unread" and "Open card".
- **Open choices:** the card hover has no kind marker (recommend keeping it that way); the shared Notes composer lines
  ("About the… / Team only · Video") were not part of this pass.

### What each place shows (round 5, 2026-10-24 01:11 UTC, desktop, replaces round 4's look)

The owner asked directly for rounded shapes, a bubble per person instead of kind icons, and Notes and Messages that
look and work like Slack. The rules above (kinds, new versus waiting, what clears what) are unchanged; only the look is.

- **Card Notes button:** one round picture per person who wrote something that needs you, with a round number next to
  it. The number's colour is the kind (change orange, comment blue, team grey, Kasper violet): filled when new, outlined
  when read but still needing you. One person with two kinds shows both numbers beside the one picture. At most three
  people, most urgent first (change, comment, Kasper, team), then "+N". Hover is unchanged except that each line starts
  with the person's picture.
- **Pictures:** staff and Kasper use their Slack profile photo (`team_members.slack_user_id`, fetched and cached
  server-side, never from the browser); a client's picture is the client's logo; a plain initial when neither exists.
  The mockups use made-up drawings because the repository is public.
- **Notes and the Messages chat, Slack-like:** a 36 px rounded-square picture on the left, the name in bold, the time
  and part next to it, the words under it; a light hover background per message with the actions in a small floating
  toolbar; replies under what they answer with smaller pictures; a day line between days; a rounded message box at the
  bottom with a green Send. Kept from ours: "Needs you" pinned at the top, the "New" and "Waiting for your answer" tags,
  Reply / No reply needed / Mark done right under the note, "Team only", the orange change-request line in Messages.
- **Messages inbox, Slack-like:** a picture per conversation, the post's name in bold when unread, the last message
  under it, the same people bubbles on the right; tabs are quiet text tabs with the active one shaded.
- **Messages button:** a round count on the corner (filled for new, outlined when only answers are owed), still
  positioned so it never moves the icon.
- **Style throughout:** rounded corners (6 to 10 px; pills for numbers and tags), hairlines, colour only where it
  means a kind.

### What each place shows (round 4, 2026-10-23 23:35 UTC, desktop)

These rules (kinds, new versus waiting, what clears what) are also the source for the phone design, which session Palm
does separately; only the desktop look below is this audit's.

- **Card Notes button:** no words, only icon and number. Every NEW kind is one square segment of a single strip, in a
  fixed order: change (orange), comment (blue), team (grey), Kasper (violet). What is read but still needs you (a change
  not done, a comment to answer) follows as a second, outlined strip. At most four segments in all; more fold into
  "+N". This holds for any number of kinds: the strip only grows to four segments.
- **Hover:** opens at once (no delay), one line per note, newest first: icon, who, what ("Change request", "Comment",
  "Waiting for your answer", "Reply to the client", "Team note") and part, the time, then the first words. A footer says
  how many changes are still not done.
- **Notes:** the conversation stays in time order and opens at the newest note. "Needs you" is pinned under the title:
  one line per thing that needs you (new change, new comment, new from Kasper or the team, waiting for your answer,
  change not done), each jumping to its note, plus "Mark unread". The notes themselves: no avatars, no boxes, a hairline
  between threads, a thin colour line for the kind, replies indented under what they answer, quiet small-caps labels
  ("NEW", "WAITING FOR YOUR ANSWER", "NOT DONE", "TEAM ONLY"), and the actions that matter on the note itself: Reply and
  No reply needed on a waiting comment, Reply and Mark done on a change. Automatic records are one quiet line.
- **Messages button:** a square count on the corner, filled for conversations with something new, outlined when only
  answers are owed. Hover says it in words and that change requests are on the cards.
- **Messages inbox:** New, To answer and All as plain underlined tabs. One row per conversation with hairlines: the
  post's name first, the client under it, the last real message (never a change request), and the same badge strip.
- **Conversation:** a flat log, no bubbles: who, part and time on one line, the words under it, a thin colour line for
  the kind, "Team only" the one tag kept. A waiting comment carries Reply and No reply needed. A client's change request
  is one orange line, "The client asked for a change on the video. Change requests are handled on the card", with Open
  card. Mark unread and Open card stay plain buttons in the head.
- **Style throughout:** square or near-square corners (2 px), no pills or bubbles, hairlines instead of frames, colour
  only where it means a kind, the calm Workload's small-caps labels and the client review page's quiet surfaces.

### From the earlier Notes and Messages draft (#2054)

Kept: one thread shown in both Notes and Messages; every note about one part (video, thumbnail, caption); the small
"Team only" tag; replies under the note they answer; a conversation leaves the inbox once its post is posted; Mark
unread. Already built since: the inbox for all staff, the per-person read marks (`message_reads`), the quiet composer.
Dropped here: the chat bubbles and the "To client" tag on every staff note (it is the default, so it is noise), the
fold-to-"n replies" rail (indent and hairline instead), and the client-side "new messages" strip (client links are not
in this round). The privacy move of team notes out of the card columns is a separate piece of work and is unchanged.

## 6. Technical design (proposed)

- **One engine, on the server.** `inbox.mjs` keeps the rules. Per post it returns new counts per kind, the open change
  count, the waiting count and up to four preview lines (id, kind, author label, part, first 120 characters,
  `created_at`, waiting). The browser never works out kinds itself.
- **Messages keeps hiding change requests**: today's rule from 2026-10-14, now on purpose. The only addition is the
  one-line link in the chat.
- **Cards read the same answer** through a new read-only action (for example
  `unread_for_posts`: a client slug in, the per-post summary out). `_calHasUnreadNotes` and `syncview_notes_seen_v1`
  stay only for client links.
- **One read record per person** (D5): opening Notes calls `inbox_mark` (per person, per post), and the
  BroadcastChannel ping repaints other tabs. `syncview_kasper_seen_at_v1` folds into the same marks.
- **Waiting is derived, plus one stored flag.** A client comment root waits when no team reply follows it and it has no
  "No reply needed" mark. That mark reuses the note's existing `done` / `done_by` / `done_at` fields (Notes can already
  mark a thread done), so no migration is needed. To check while building: that marking a comment done is allowed on
  every write path, the client link included.
- **`created_at` only** decides "new".
- **Rollout (owner's decision, 2026-10-23 22:05 UTC):** behind the runtime switch `unread_badges_v2`
  `{ "staff": [...] }`, on for Sidney's two staff ids only, on **every** client (not limited to test clients), so he
  tries it through his own account first. Nothing is built or switched on before he approves the mockups.

## 7. Build order (small PRs)

Every visible step ships behind `unread_badges_v2`, on for Sidney's two staff ids on any client, and only after he
approves the mockups.

1. **Done, PR #2300:** the Messages button is live from page load, retries a failed first read, and the icon stays put.
2. **Server:** per-kind counts, open and waiting counts, and preview lines in the `inbox` answer, plus the
   `unread_for_posts` action; tests in `test/messages-inbox-scope.js`. Auto-deploys, no migration, nothing visible.
3. **Calendar cards:** read the server summary for staff; opening Notes marks read on the
   server; per-kind badges, outlines and the hover preview. Behind the switch.
4. **Notes:** the "Needs you" group, "No reply needed" and "Mark unread" on comments. Behind the switch.
5. **Messages:** New, To answer and All; kind badges; the coloured corner count, the outline and the hover; the
   change-request link line in the chat. Behind the switch.
6. **Samples cards** on the same summary and component.
7. **Client links:** the `created_at` rule; the Review page marks notes seen.
8. **Kasper:** his seen state folds into the server read marks.
9. **Clean-ups:** the safety net from 60 s to 30 s, the Kasper tab colour, the phone colour, and removing the old dot
   code once the switch is on for everyone. Optional later: Remind me.

## 8. Decisions

**Settled by the owner (2026-10-23):** D3 phone read clears the laptop within 30 s; D4 colours; D5 one read record; D6
another staff member's reply counts for you, in grey. **Round 3 (21:40 UTC): D2 yes** (change requests stay out of
Messages) and **D8 yes** (the post's SMM and admins see "waiting for an answer").

**Round 3 mockups are the real page.** The hand-drawn page was replaced by screenshots of the real SyncView build,
served offline by the test harness with fictional notes (`fixture.js`), with the proposed design applied by a
local-only script (`preview.js`) that only `make-screenshots.js` loads. The app's own code is unchanged. The
gallery (`gallery.html`, also published as one page for the owner) puts D1, D7 and D9 first, each with the screenshot
that shows it. The words on the badges were made literal for someone seeing them for the first time ("2 new changes",
"1 new comment", "1 to answer", "2 changes open", "1 from team", "1 from Kasper"), and every action (Reply, No reply
needed, Mark done, Mark unread, Open card) is a visible button, never behind a menu.

**Round 4 (23:27 UTC): D1 yes, D7 yes, D9 no** (no summary line above the calendar; removed). Card badges carry no
words: icon and number only, with the wording in the hover. The new desktop round restyles Notes, the Messages inbox
and a long conversation in the calm language (square corners, hairlines, no bubbles). The phone is handed to session
Palm and follows the rules above.

**Round 5 (2026-10-24 01:11 UTC, the owner directly):** no rectangles; one rounded picture per person with a coloured
number; Notes and Messages styled like Slack; every gallery picture opens full screen. This replaces D10's strip.

**Still open, with a recommendation:**
- **D10 (restated). Four or more people on one card.** Recommendation: at most three people bubbles, most urgent first
  (change, comment, Kasper, team), then "+N"; the hover lists everyone (gallery, "One choice left").
