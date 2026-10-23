# Unread badges: audit, rules and build order (session Beacon, 2026-10-23 20:33 UTC)

Owner request, 2026-10-23: the notes badges on the content calendar, the Samples calendar and the client review sheets,
and the Messages button, must say at once and correctly what is waiting (a client comment, a client change request, or
both), before anything is opened, and must stay correct whatever happens (a reply, someone else's reply, a resolve, a
read in another tab or on the phone). The Messages badge showed only after a click and pushed its icon to the left.

Mockups: [`docs/syncview-design/mockups/unread-badges/index.html`](../syncview-design/mockups/unread-badges/index.html)
(`?theme=dark` for dark; screenshots in `shots/`). Nothing below is built except the two Messages-button fixes in their
own small PR.

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
| Client change request | client, `is_tweak` true (missing counts as a change) | orange pencil | orange "N open" until Done | **card only** (Notes, the card badge, the calendar summary) |
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
| You open the hover preview, or look at the calendar summary | nothing changes | nothing changes |
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
| A new note anywhere | realtime on the cards (channels already open) triggers one summary read, at most one per 5 s; the card, the calendar summary, the Messages list and the header repaint from that one answer |
| Read, answered, Done or "No reply needed" in another tab of this browser | BroadcastChannel ping, immediate |
| The same on the phone or another computer | when that tab is looked at again (immediate), otherwise within 30 s (safety net lowered from 60 s) |
| Page load | the badge is drawn from the first read, 1.5 s after sign-in, with a retry if it fails (PR #2300) |

### What each place shows

- **Calendar summary line** (new): "For you: N new changes · N new comments · N to answer · N changes open", for the
  clients on screen. Each chip filters the calendar to those posts.
- **Card Notes button:** in this order: new changes (filled orange), open changes (outlined orange), new comments
  (filled blue), comments to answer (outlined blue), staff (grey), Kasper (violet). At most three badges; the rest fold
  into "+N".
- **Hover (desktop) or long-press (phone):** up to four lines, newest first: kind, who, part, first words, when, and
  "waiting for an answer" where it applies; "Also N open". Clicking a line opens Notes at that note.
- **Notes:** a "Needs you" group at the top (new changes, open changes, comments waiting for an answer), then
  "Earlier". Each waiting comment has Reply, "No reply needed" and "Mark unread".
- **Messages button:** counts conversations, never change requests. A filled count of conversations with something new
  for you, in the colour of what is waiting (comment, then staff, then Kasper). When nothing is new but answers are owed,
  an outlined count. Hover lists both, and says changes are on the cards.
- **Messages list:** New, To answer, All. Per-row kind badges.
- **Chat:** a "New" line; each message tagged (Comment · Video, Internal); a waiting comment has Reply and "No reply
  needed"; a client's change request appears as one line linking to the card ("Client asked for 1 change on the video ·
  see the card"), never as a message that counts; automatic records are grey lines.

## 6. Technical design (proposed)

- **One engine, on the server.** `inbox.mjs` keeps the rules. Per post it returns new counts per kind, the open change
  count, the waiting count and up to four preview lines (id, kind, author label, part, first 120 characters,
  `created_at`, waiting). The browser never works out kinds itself.
- **Messages keeps hiding change requests**: today's rule from 2026-10-14, now on purpose. The only addition is the
  one-line link in the chat.
- **Cards and the calendar summary read the same answer** through a new read-only action (for example
  `unread_for_posts`: a client slug in, the per-post summary out). `_calHasUnreadNotes` and `syncview_notes_seen_v1`
  stay only for client links.
- **One read record per person** (D5): opening Notes calls `inbox_mark` (per person, per post), and the
  BroadcastChannel ping repaints other tabs. `syncview_kasper_seen_at_v1` folds into the same marks.
- **Waiting is derived, plus one stored flag.** A client comment root waits when no team reply follows it and it has no
  "No reply needed" mark. That mark reuses the note's existing `done` / `done_by` / `done_at` fields (Notes can already
  mark a thread done), so no migration is needed. To check while building: that marking a comment done is allowed on
  every write path, the client link included.
- **`created_at` only** decides "new".
- **Rollout behind a runtime switch** (`unread_badges_v2` `{ "staff": [...] }`, Sidney's two ids first), because it
  changes what staff see on every card.

## 7. Build order (small PRs)

1. **Done, PR #2300:** the Messages button is live from page load, retries a failed first read, and the icon stays put.
2. **Server:** per-kind counts, open and waiting counts, and preview lines in the `inbox` answer, plus the
   `unread_for_posts` action; tests in `test/messages-inbox-scope.js`. Auto-deploys, no migration, nothing visible.
3. **Calendar cards and the summary line:** read the server summary for staff; opening Notes marks read on the
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

**Still open, each with a recommendation:**
- **D1. What the Messages number counts.** Recommendation: conversations with something new for you (filled). When
  nothing is new but answers are owed, an outlined count of those. Never change requests. (Mockup section 7.)
- **D7. Answering later.** Recommendation: **A**. Every client comment shows "Waiting for an answer" until someone on
  the team replies or marks "No reply needed". "Mark unread" stays as the personal fallback. Remind me waits until A has
  been tried.
- **D9. The calendar summary line.** Recommendation: yes, above the calendar, filtering on click (mockup section 2).
