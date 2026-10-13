# Notes and Messages redesign (design only)

Date: 2026-10-13. Author session: Courier. Status: **owner decisions received 2026-10-13 (section 3). Design only: nothing live is changed by this document.**

Mockups: `docs/syncview-design/mockups/2026-10-notes-messages/` (open `index.html`). Every screen is the real app page loaded with made-up data; only the new parts are added (`tools/new-parts.css`, `tools/decorate.js`). Rebuild with `node docs/syncview-design/mockups/2026-10-notes-messages/tools/build.js`.

## 1. Goal

1. Staff (social media managers, "SMM") get the same choice the client has on a card's Notes: **Request change** (moves that part to Tweaks Needed) or **Comment** (no status change).
2. A comment is addressed: **to Kasper / the team** (internal, never shown to the client) or **to the client**. Notes shows who it is for, and only people allowed to see it can.
3. Every message meant for Kasper reaches him. Messages becomes a chat inbox he will actually use: conversations on the left (one per post), chat on the right, with replies and the part (video, thumbnail, caption) each message is about. The card's Notes and the inbox show the **same thread**.
4. A client learns that a comment is waiting for them, even though a comment changes no status (a strip and a dot only; no email, no client inbox).

## 2. How it works today (read 2026-10-13 from `origin/main`)

**Where notes live.** Each Calendar card (`calendar_posts`) stores its notes as a JSON list per part in `video_tweaks`, `graphic_tweaks` (thumbnail), `caption_tweaks` and `title_tweaks`. Each note carries `id`, `parent_id` (replies point at the thread's first note, the "root"), `author`, `role` (`smm`, `kasper`, `client`), `audience` (`internal` or `client`), `is_tweak`, `round`, `done`. Writes go through `supabase/functions/calendar-upsert/index.ts` (lines 325 to 440), which merges notes with the database function `calendar_merge_comments` so two people saving at once do not erase each other. Cards linked to Production also have a "canonical" copy in the `production_comments` table, served by `supabase/functions/production-comments/` (its `policy.mjs:74` `audienceAllowed` already refuses non-client notes to a client on the server).

**Audience rule.** `src/index/130-calendar-model-cache.js.part:88` `_calMsgAudience`: a note with no audience counts as internal if written by Kasper or an SMM, client-facing otherwise. Replies inherit the root's audience. `_calCommentsForView` (same file, line 115) hides internal threads and anything Kasper wrote **when the page is a client link**.

**Notes panel on a card** (`src/index/190-calendar-approval-comments.js.part`):
- Composer (around line 2340): an "About the…" part picker (video, thumbnail, caption, title) for everyone; a "Who sees this?" toggle (Kasper / team, Client) for staff only, default team; a "This is a… Comment / Request a change" toggle **for the client only** (line 2367). So today an SMM writing in Notes can only comment (line 2575 forces `is_tweak: false`).
- Review panel (line 529): Comment and Request change buttons per part. `_calReviewComment` (line 872) posts a plain comment; staff comments here are always internal (no toggle).
- Unread dot on the Notes button: per device only (`localStorage`), `src/index/180-calendar-native-post-media.js.part:3045`.

**Kasper's Messages tab** (`src/index/321-kasper-dashboard-replies.js.part:2696`, `323-kasper-dashboard-tail.js.part:59` onward, `180-...:3092` to `3160`):
- A list of cards, one block per card. A thread appears **only if Kasper already wrote in it** (`_kasperOwnedThreadRoots`). So a new SMM note addressed to Kasper, or a client comment, **never reaches him**. That is the gap the owner described.
- "Seen" is stored in Kasper's browser (`KASPER_SEEN_AT_KEY`), so his unread state differs between his phone and laptop.
- Tab count (`322-core-kasper-tab-counts.js.part`) is the number of cards in the list, not unread messages.

**Client side.** Client link uses the same Notes panel through `_isClientLink`; it shows client-audience threads only, has the Comment / Request a change toggle, and has the unread dot (per device). No email or banner tells the client a new comment is waiting.

## 3. Owner decisions (2026-10-13)

1. All staff get the Messages inbox; each person sees conversations for their own clients. Kasper sees all.
2. Change requests are always team only.
3. No "Whole post": every comment or request is about one part (video, thumbnail or caption).
4. The client sees "Synchro team" as the sender of any staff message.
5. Editors are not part of Messages.
6. Never email clients.
7. No Slack alerts for Kasper.
8. A conversation leaves the inbox as soon as its post is posted. It stays on the card.
9. "Mark as unread" exists.
10. Old notes get labelled; anything unclear stays team only.
11. No client inbox. The client gets the "new messages" strip and the dot on the card only.
12. **Privacy rule** (below).

### The privacy rule

**Team-only messages are saved only in the server-filtered comment store, never in the card's own columns.** The server-filtered store is the `production_comments` table, read and written only through the `production-comments` Edge Function, which already removes internal notes before answering a client (`supabase/functions/production-comments/policy.mjs:74`). The `calendar_posts` columns `video_tweaks`, `graphic_tweaks`, `caption_tweaks` and `title_tweaks` are downloaded in full by the client's browser, so they must never hold a team-only message. Hiding a note on screen is not protection.

Consequences:
- Every new team-only note (comment or change request) is written to `production_comments` with `audience = internal`.
- Client-audience notes may keep using the card columns until the later move of all notes to one store, but they are also written to `production_comments` so both screens read one thread.
- The one-time migration (section 5) moves existing internal notes out of the card columns into `production_comments` and then removes them from the columns.
- A check in CI fails if any code path writes a note with `audience` other than `client` into a `*_tweaks` column.

## 4. Combinations (after the decisions)

| Who writes | Kind | Part | To | Status change | Who sees it | Where it shows |
|---|---|---|---|---|---|---|
| SMM | Request change | video / thumbnail / caption | team (forced) | that part to Tweaks Needed | staff | card Notes; inbox of the client's SMMs and Kasper |
| SMM | Comment | one part | team | none | staff | card Notes; inbox |
| SMM | Comment | one part | client | none | staff and client (as "Synchro team") | card Notes; inbox; client strip and dot |
| Kasper | Request change | one part | team (forced) | Tweaks Needed | staff | Notes; inbox |
| Kasper | Comment | one part | team or client | none | as above | as above |
| Client | Request change | one part | client | Tweaks Needed (as today) | staff and client | Notes; inbox |
| Client | Comment | one part | client | none | staff and client | Notes; inbox |
| Anyone | Reply | inherits | inherits | none | as the first message | Notes; inbox |
| Editor | anything | | | | not part of Messages | unchanged |

Rules that close the risky cases found in round 1:
- A reply always keeps the part and audience of the first message; the reply box has no toggles.
- A sent message's audience can never be changed.
- "Request change" disables "Client" in the To picker.
- Staff names never reach the client; staff messages show as "Synchro team".
- No @mentions in client messages.

## 5. Data model (proposal, not applied)

1. **`production_comments` becomes the single place for team-only notes**, for every card, linked to Production or not. Fields already there are reused; add `kind` (`comment` | `change_request` | `reply`) and make `audience` and `component` (`video` | `graphic` | `caption`) required. The function refuses a reply whose audience or part differs from its first message, and any audience change on edit.
2. **New table `message_reads`**: `(reader_id, post_id, last_read_at)`. `reader_id` is the verified staff roster member id, or a non-secret id for the client link (never the shared role key). "Mark as unread" sets `last_read_at` back to just before the newest message.
3. **Inbox read**: one Edge Function call returns, for the signed-in staff member, one row per post (their own clients; all clients for Kasper) that has messages and is not yet posted: thumbnail, client, title, last message, unread count. It reads through a database function the Edge Function's service role can run; nothing new is readable with the browser key.
4. **Old notes**: a one-time job labels every old note: `audience` from today's rule (staff → team, client → client; anything unclear → team), `kind` from `is_tweak`, `component` from the column it sits in. Team-only notes are copied into `production_comments` and removed from the card columns. A dry run reports counts first; the owner approves before the real run.

## 6. Build plan: three steps, each shippable alone

**Step 1. Notes toggles and the privacy move.** Size: medium, roughly 2 to 3 days.
- In the card's Notes: "This is a… Comment / Request change" for staff too; "To: Kasper / team or Client" (Client off for a change request); part picker without Title or Whole post; a "To …" label on each message.
- Team-only notes written to `production_comments` only (the privacy rule), plus the CI check.
- The old-notes labelling and move job (dry run, then owner go).
- Tests: the existing offline Calendar browser test extended for the toggles; a unit test that a team note never lands in a `*_tweaks` column; a client-link test that a team note never reaches the client's browser.

**Step 2. Messages inbox for all staff.** Size: large, roughly 4 to 5 days. Needs step 1.
- `message_reads` table and the inbox read function (own clients; Kasper all; posted posts drop out).
- Kasper's Messages tab rebuilt as list + chat; the same screen for other staff from a Messages button by their account (top bar on desktop, the Tabs menu on phone).
- Unread count on the tab and the button; "Mark as unread"; reply from the chat writes into the same card thread.
- Tests: offline browser test of the inbox; a permission test that an SMM never receives another SMM's client.

**Step 3. Client "new messages" strip.** Size: small, roughly 1 day. Needs step 1; independent of step 2.
- Strip at the top of the client link ("2 new messages from the Synchro team · Show me") and the dot on the card's Notes button, both from `message_reads` for that client link.
- Opening the card's Notes marks it read.
- Tests: client-link offline test for strip, dot and clear.

Nothing beyond the decisions above: no email, no Slack, no client inbox, no editors, no mentions, no search.
