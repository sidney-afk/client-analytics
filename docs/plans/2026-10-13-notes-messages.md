# Notes and Messages redesign (design only)

Date: 2026-10-13. Author session: Courier. Status: **proposal for owner approval. Nothing live is changed by this document.**

Mockups: `docs/syncview-design/mockups/2026-10-notes-messages/` (open `index.html`).

## 1. Goal

1. Staff (social media managers, "SMM") get the same choice the client has on a card's Notes: **Request change** (moves that part to Tweaks Needed) or **Comment** (no status change).
2. A comment is addressed: **to Kasper / the team** (internal, never shown to the client) or **to the client**. Notes shows who it is for, and only people allowed to see it can.
3. Every message meant for Kasper reaches him. Messages becomes a chat inbox he will actually use: conversations on the left (one per post), chat on the right, with replies and the part (video, thumbnail, caption) each message is about. The card's Notes and the inbox show the **same thread**.
4. A client learns that a comment is waiting for them, even though a comment changes no status.

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

## 3. Combinations

Legend for "who sees": S = SMMs, K = Kasper, E = editor (Production card), C = client.

| # | Who writes | Kind | Part | Audience | What happens | Who sees | Flag |
|---|---|---|---|---|---|---|---|
| 1 | SMM | Request change | video / thumbnail / caption | team | That part goes to Tweaks Needed; editor gets the request (as today from the review panel); Kasper gets it in Messages | S K E | |
| 2 | SMM | Request change | any | client | **Not allowed.** A change request is work for our team; showing it to the client as "we asked ourselves for tweaks" is confusing. Force team. | | **Risky** if allowed |
| 3 | SMM | Request change | whole post | team | Not allowed as one action: it would flip several parts at once. Pick a part. | | Unclear (decision Q3) |
| 4 | SMM | Comment | any part / whole post | team | No status change. Lands in Kasper's inbox as unread | S K | Today this is the lost message |
| 5 | SMM | Comment | any | client | No status change. Client sees it with a "new" dot and strip; Kasper sees it in his inbox too (read-only "to client" label) | S K C | Must say "Client will see this" before sending |
| 6 | Kasper | Request change | part | team | Tweaks Needed, editor notified (today's review-panel flow) | S K E | |
| 7 | Kasper | Comment | any | team | No status change; SMMs see it unread on the card | S K | |
| 8 | Kasper | Comment | any | client | Allowed, but shown to the client **as "Synchro team"**, never Kasper's name (today's rule: client never sees Kasper authorship) | S K C | Unclear (decision Q4) |
| 9 | Client | Request change | part | client | Tweaks Needed, as today; Kasper inbox gets it | S K C | |
| 10 | Client | Comment | part / whole post | client | No status change; Kasper inbox + SMM unread | S K C | Today never reaches Kasper |
| 11 | Any | Reply | inherits root | inherits root | No status change ever. Audience and part are copied from the root | root's audience | **Risky**: a reply typed in the inbox must never be able to pick a different audience |
| 12 | Kasper | Reply in Messages inbox | inherits | inherits | Same note as #11, written into the same card thread | as root | Same thread in both places |
| 13 | Editor | Comment / reply | part | team | Only on Production cards via `production_comments`; shows in Kasper inbox as team | S K E | Unclear (Q5): editors in scope? |
| 14 | Editor | anything | any | client | **Not allowed.** | | Risky |
| 15 | Anyone | Edit a sent note's audience from team to client | | | **Not allowed.** Changing audience after sending is the most likely way to leak an internal note. Delete and resend instead. | | **Risky** |
| 16 | Old note with no `audience` | | | | Keep today's rule (SMM/Kasper → team, client → client) | | Migration must not flip any old internal note to client |
| 17 | Client link payload | | | | The client's browser must receive **only** client notes from the server, not receive all and hide some on screen | | **Risky, to verify**: Production notes are filtered on the server (`production-comments/policy.mjs:74`); I did not confirm that the client link's card read strips internal entries from the `*_tweaks` lists before they leave the server. Must be checked before build. |
| 18 | Message about a card that is archived or deleted | | | | Conversation stays in the inbox, greyed, read-only | S K | |
| 19 | Mention of a team member in a client-visible note | | | | No @mentions in client notes in this round | | Keeps staff names off the client page |

## 4. Proposed design in plain English

**Notes panel (card).** One composer with two short toggles above the text box:
- **Request change / Comment.** Same for SMM and client. Request change needs a part (video, thumbnail, caption) and moves only that part to Tweaks Needed. Comment can be about one part or the whole post.
- **To: Kasper / team** (lock icon) or **To: Client**. Staff only; default team. Choosing Request change locks it to team. When "Client" is picked the send button reads "Send to client" and the box gets a client-coloured border, so nobody sends to the client by accident.
Each message in the thread shows a small label: the part ("Video"), and the audience ("Team only" with a lock, or "Client can see"). Change requests show a "Change request · round 2" tag.

**Messages inbox (Kasper, and SMMs too).** iMessage style:
- Left: one conversation per post. Thumbnail, client name, post title, last message preview, time, unread dot and count. Filter chips: All, Unread, To me, Change requests.
- Right: chat bubbles, his on the right, others on the left with name and role. Each bubble shows its part chip. Client-visible messages have a clear "Client can see" outline. A reply box at the bottom with the same two toggles (reply inherits audience; no toggle on a reply).
- Opening a conversation marks it read **on the server** for that person, so phone and laptop agree.
- Every message reaches Kasper unless he wrote it, not only threads he joined.
- Phone: list full screen, tap opens the chat full screen with a back arrow.

**Tab count.** "Messages" pill = number of conversations with unread messages for this person (not number of cards). Red when any unread change request.

**Client sees.** Only client notes. Staff appear as "Synchro team" plus the SMM's first name if the owner agrees (Q4). A **"2 new messages"** strip at the top of their link with a "Show me" button that scrolls to the first card; an orange dot on each card's Notes button; inside Notes, a "New" divider above the first unread message. Optional email digest (Q6).

## 5. Data model (proposal, not applied)

Keep notes where they are for now (the `*_tweaks` lists and `production_comments`); add what the inbox needs.

1. **Every note gets explicit fields**, written by the server, never guessed: `audience` (`internal` | `client`, required on roots), `kind` (`change_request` | `comment` | `reply`; replaces `is_tweak`, kept in sync for old code), `component` (`video` | `graphic` | `caption` | `title` | `post`), `author_role` (adds `editor`). The upsert function refuses a reply whose audience differs from its root and any audience change on edit.
2. **New table `message_reads`**: `(reader_id, post_id, last_read_at)`, where `reader_id` is the verified roster member id for staff (not the shared role key, which covers every SMM and is a secret) and a non-secret client principal id for the client. Replaces the per-device seen maps for Kasper, SMMs and the client.
3. **New read-only view `message_threads_v1`** (no browser access: revoke from `public`, `anon` and `authenticated`; keep a narrow `SELECT` for `service_role`, which is what Edge Functions connect as, and authenticate and filter callers inside the function): one row per post with last message, part, audience, unread counts per viewer. The inbox reads it through an Edge Function that applies the audience rule on the server.
4. **Mapping old notes:** a one-time backfill writes `audience` on every root that has none using today's rule (staff → internal, client → client), `kind` from `is_tweak` (missing `is_tweak` → change request, matching `_calMsgIsTweak`), `component` from which column it sits in. A dry run first reports counts per rule; any note it cannot classify stays **internal**.
5. Later (separate decision): move the JSON lists into `production_comments` rows so there is one store.

## 6. Open decisions for the owner

1. Should SMMs get the Messages inbox too, or only Kasper?
2. Can a change request ever be addressed to the client, or always team only? (Proposal: team only.)
3. Should "Request change" on the whole post be allowed, flipping every part at once?
4. When Kasper writes to the client, what name does the client see: "Synchro team", the SMM's first name, or Kasper's first name?
5. Are editors part of Messages (Production comments), or SMM, Kasper and client only?
6. Should the client also get an email when a new comment waits for them, and how often (each message, daily digest, never)?
7. Should Kasper get a push or Slack ping for unread change requests, or is the inbox enough?
8. Does a conversation stay in the inbox after the post is posted, or drop off after 14 days?
9. Should "mark as unread" exist?
10. OK to run the backfill that writes `audience` on old notes, with unclear ones kept internal?
