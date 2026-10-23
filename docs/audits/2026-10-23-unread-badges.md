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

## 5. The rules (proposed)

**One idea:** a filled badge means "new for you"; its colour and icon say what kind; an outlined orange badge means
"change requests you have read that are still open". One read state per person, on the server, for staff. The card,
the Messages list, the chat and the header button all read the same answer, so they cannot disagree.

### Kinds

| Kind | Who writes it | Badge | Counts as new for |
|---|---|---|---|
| Client change request | client, `is_tweak` true (missing counts as a change) | orange pencil, filled | the post's SMM(s) and admins |
| Client comment | client, `is_tweak` false | blue bubble, filled | the post's SMM(s) and admins |
| Both on one post | | orange and blue side by side, change first | as above |
| Staff message | any staff member who is not you (by member id; by name when the note has no id) | grey person | everyone in the conversation's audience except the writer; Kasper only for internal threads he is in |
| Kasper | Kasper (reviewer) | violet eye | the post's SMM(s) and admins |
| Automatic record | the app (system roles, the caption-change record, status moves) | **never** a badge; a grey line in the chat | nobody |
| Your own note | you | never | nobody |

### What makes something new, and what clears it

| Event | Effect |
|---|---|
| A person writes a note or reply | new for everyone it counts for (table above), measured by its **`created_at`**, never `updated_at` |
| A note is edited | not new again (an edit is not a message) |
| A change request is resolved (Done) | not new; it leaves the "open" outline count. The person who asked sees "Done" in the chat, not a badge |
| A resolved change request is reopened by a client | new again (it is a person asking again) |
| A note is deleted or hidden before you read it | it stops counting at once; if it was the only new item the badge clears |
| Someone else replies to a client (another SMM, Kasper) | new for you as a grey/violet staff badge, not as a client badge; the client's earlier note keeps its own state |
| The same person writes several notes | each counts once; the card badge shows the number of new notes per kind, the header shows conversations |
| You open Notes on a card, or the conversation in Messages | everything on that post up to now is read, on the server, for you only |
| You open the hover preview | nothing is marked read |
| You reply | everything up to your reply is read |
| "Mark as unread" | as today: back to just before the newest message that counts |
| No read mark yet (new person, first use) | only the last 14 days count, as the server does today |
| The client reads a staff reply on the review link (Sheet or Review page) | read for that client's device (clients have no sign-in); the Review page now marks it too. Never affects staff badges |

### Sync

| Situation | How fast it updates |
|---|---|
| A new note anywhere | realtime on the cards (the channels already open) triggers one inbox read, at most one per 5 s; header, list and cards repaint from that one answer |
| Read in another tab of the same browser | BroadcastChannel ping, immediate |
| Read on the phone or another computer | when that tab comes back into view (immediate), otherwise within the safety-net refresh (60 s today, 30 s proposed; decision D3) |
| Socket dropped | the safety net covers it |
| Page load | the badge is drawn from the first inbox read, 1.5 s after sign-in (fixed in the small PR) |

### What each badge says

- **Card Notes button:** per-kind filled badges with the number of new notes of that kind; otherwise an outlined
  "N open" when change requests are read but open; otherwise nothing.
- **Hover (desktop) or long-press (phone):** the three newest unread items: kind icon, who ("Client", "Kasper",
  staff first name), which part (Video, Caption, Thumbnail, Title), the first line, how long ago; "Also N open"; "Open
  Notes". Clicking an item opens Notes at that message.
- **Messages button:** the number of conversations with something new, on the button's corner, coloured by the most
  important kind waiting (change > comment > staff/Kasper). Hover lists the breakdown by kind.
- **Messages list:** per-row kind badges; the New view lists only rows with something new.
- **Chat:** a "N new" line where the new messages start; each message tagged "Change asked · Video", "Comment ·
  Caption" or "Internal"; resolved changes tagged "Done"; automatic records as grey centred lines.

## 6. Technical design (proposed)

- **One engine, on the server.** Extend `inbox.mjs` so each conversation returns, besides `unread`, a per-kind split
  (`change`, `comment`, `staff`, `kasper`), the number of open change requests, and up to three preview items (id,
  kind, author label, part, first 120 characters, `created_at`). Same rules, one place; the browser never guesses kinds.
- **Cards read the same answer.** A new read-only action (for example `unread_for_posts`, a client slug in, the same
  per-post summary out) lets the Calendar and Samples cards paint from the server for staff. `_calHasUnreadNotes` and
  `syncview_notes_seen_v1` stay only for client links.
- **One read state for staff.** Opening Notes on a card calls `inbox_mark` (it is already per person, per post), and
  the BroadcastChannel ping repaints other tabs. `syncview_kasper_seen_at_v1` folds into the same marks.
- **`created_at` only** for "new", in the browser rule for client links too.
- **Rollout behind a runtime switch** (`unread_badges_v2` `{ "staff": [...] }`, Sidney's two ids first), as earlier
  visible changes were, because it changes what staff see on every card.
- **Load:** the per-client summary is one extra small read per Calendar or Samples load and per realtime burst
  (throttled like the inbox, 5 s). No migration is needed for the first steps; `message_reads` already exists.

## 7. Build order (small PRs)

1. **Messages button: live from page load, icon stays put** (this session's fix PR). No switch.
2. **Server rules:** per-kind split, open count and preview in the `inbox` answer; client change requests per D2; tests in `test/messages-inbox-scope.js`. Auto-deploys, no migration, nothing visible changes.
3. **Messages UI:** kind badges in the list, coloured corner count and hover breakdown on the button, kind tags and
   "Done" in the chat, grey automatic lines. Behind `unread_badges_v2`.
4. **`unread_for_posts` action + Calendar cards** read the server summary for staff; opening Notes marks read on the
   server; per-kind badges and "N open" outline; hover preview. Behind the switch.
5. **Samples cards** on the same summary and component; same labels as Calendar.
6. **Client links:** `created_at` rule, the Review page marks notes seen, staff replies show as one kind ("Reply from
   your team").
7. **Kasper:** fold `syncview_kasper_seen_at_v1` into server read marks; his chips use the same badges.
8. **Clean-ups:** Kasper tab count colour, phone colour loss, remove the old dot code once the switch is on for all.

## 8. Decisions for the owner

- **D1. What the header number counts.** Recommendation: conversations (posts) with something new, as today; the card
  and the list show the per-kind note counts.
- **D2. Client change requests in Messages.** On 2026-10-14 you decided Messages hides a client change request until a
  staff member answers it (it lives on the card). Your new rule ("the same rules in Messages") reverses that.
  Recommendation: reverse it: show and count every client change request in Messages at once, with the orange badge, so
  the header button and the card can never disagree.
- **D3. Read on the phone, cleared on the laptop.** Recommendation: accept "immediately when you look at the tab, else
  within 30 s" (no new push service; the comments tables are closed to browsers by design).
- **D4. Colours.** Recommendation: orange = change request (already the notes colour), blue = comment, grey = staff,
  violet = Kasper.
- **D5. One read state.** Recommendation: yes, opening a card's Notes also marks it read in Messages and the reverse.
- **D6. Another staff member's reply to a client.** Recommendation: it counts for you, as a grey staff badge, so you
  see the client was answered without it looking like a new client request.
