# Post for Me accounts reaching SyncView by themselves (Linkplan, 2026-11-02)

Plan only. Nothing here is built. Owner's item 4, second half: "when anyone connects a new account in
Post for Me (Facebook, Instagram, TikTok, YouTube, LinkedIn...), SyncView should pick up its connection
id automatically, so he never has to hand ids over." Plus the API facts the other two planners need
(sent to Variantplan and Postplan on 2026-11-02; repeated in section 10 so they are on record).

Sources read on 2026-11-02:
- Post for Me's live API reference: the OpenAPI document embedded in https://api.postforme.dev/docs
  (Scalar page; the spec sits in its `data-configuration`).
- Frame.io's live V4 reference: https://api.frame.io/v4/openapi.json (linked from
  https://developer.frame.io/platform/v4/api-reference).
- Read-only SQL on `client_profiles`, `instagram_uploads`, `tiktok_uploads`.

---

## 1. What exists today (measured)

**Where each network's Post for Me id lives** (all on `client_profiles`, one row per client):

| Network | Where | Set by | Checked against Post for Me on save? |
|---|---|---|---|
| TikTok | column `postforme_account_id` | Kasper > Clients, Publishing card; `roster-write` | No (only `spc_` shape). The post-time check is in `tiktok-upload/handler.mjs:128` |
| Instagram | `extra.postforme_instagram_account_id` | Publishing card or `roster-write` | Yes: `client-profile-write/index.ts:181` asks `GET /v1/social-accounts/{id}`, `_shared/client-profile-edit.mjs:40` wants `instagram` |
| Facebook Page | `extra.postforme_facebook_account_id` | Publishing card | Yes, same check, wants `facebook` |
| YouTube, LinkedIn | nowhere yet | | |

The Publishing card fields are at `src/index/323-kasper-dashboard-tail.js.part:293`. The database side
is `client_profile_admin_edit`, whose `allowed_extra` list was widened last in
`migrations/2026-10-31-client-facebook-page.sql:65`. The existing `youtube_channel_id` column is the
analytics channel id (`UC...`), not a Post for Me id.

**Counts today (41 active clients, read-only, 2026-11-02):**

| | Clients with it |
|---|---|
| TikTok Post for Me id | 13 |
| Instagram Post for Me id | 4 |
| Facebook Page Post for Me id | 2 |
| YouTube / LinkedIn Post for Me id | 0 (no slot) |
| Instagram handle saved | 36 (32 of them have no Instagram id yet) |
| TikTok handle saved | 19 |
| YouTube channel id saved (`UC...`) | 11 |
| Same Post for Me id on two active clients | 0 for TikTok, 0 for Instagram |

The test client `sidneylaruel` has **no** Post for Me id on any network today. Queue rows:
`instagram_uploads` 16, `tiktok_uploads` 347.

**Not measured, and why:** how many accounts Post for Me holds, and how many of them are on no client.
The key lives only in Supabase secrets and n8n, and this session must not use either. The first pull
request below is the measurement (section 5, PR 1).

**How the key and the webhook are held today.** `POST_FOR_ME_API_KEY` is a Supabase secret
(`docs/ops/INSTAGRAM_UPLOAD.md`). `tiktok-upload` already registers a Post for Me webhook for post
results (`?pfm_webhook=1`, OPEN_REPAIRS 370). It never copies the webhook secret by hand: it reads it
back from `GET /v1/webhooks` with the key it already holds (`tiktok-upload/index.ts:124-136`).

**Trial reels and posting today** (for the other planners; not my area): the Post tab is
`src/index/299-instagram-upload.js.part` and `300-tiktok-upload.js.part`. Both post through Post for Me
with server-side account checks (`instagram-upload`, `tiktok-upload`). Nothing in my plan touches the
trial reel files, the review boards or `production-write`. Trialchange's Safari player work is
unaffected.

---

## 2. The proposal

### What Post for Me offers (quoted)

- **Notify on a new connection: yes, there is a webhook.** `CreateWebhookDto.event_types` lists
  `"social.account.created"` and `"social.account.updated"`. Payload: `{ "event_type": "", "data": {} }`,
  where "data will be the resulting entity from the event". Security: "we will include a secret in the
  header \"Post-For-Me-Webhook-Secret\"". Retries: "around 8 times over the course of just over a day."
- **Asking instead:** `GET /v1/social-accounts`, filters `platform`, `username`, `external_id`, `id`,
  `status` (`connected` | `disconnected`), pages of 50 (`offset`, `limit`).
- **A field set at connect time:** `external_id`, "Your unique identifier for the social account". It is
  set only when the connection starts from `POST /v1/social-accounts/auth-url` with `external_id` in the
  body, or later by `PATCH /v1/social-accounts/{id}`. An account connected in Post for Me's own dashboard
  (Sidney's way today) has none. So today there is **no field that says which client an account is for**.
- **What an account carries:** `id` (`spc_...`), `platform`, `username`, `user_id` (the network's own id),
  `profile_photo_url`, `status`, `external_id`, `metadata.display_name`. **It also carries
  `access_token` and `refresh_token`** for the client's social account. Anything SyncView builds must
  never pass those on, log them or store them.

### The simplest version (recommended)

**SyncView asks Post for Me when a person looks, and a person confirms each link with one click.**
No webhook, no timer, no new table.

1. A new admin-only action in `client-profile-write` (it already holds the key and already checks
   accounts): `pfm_accounts`. It reads every account from `GET /v1/social-accounts` and answers only the
   safe fields (id, network, username, display name, photo, status). For each it adds which client
   already has it, or, if none, a **suggested** client.
2. A **Post for Me accounts** page off Kasper > Clients lists them in three groups: **Waiting for a
   client**, **Linked**, **Disconnected**. Each waiting account has a **Link to…** picker. Picking a client
   saves the id through the same `client-profile-write` path the Publishing card uses today, so the
   history row, the account check and the Sheet copy all work as now.
3. YouTube and LinkedIn get their own slots (`extra.postforme_youtube_account_id`,
   `extra.postforme_linkedin_account_id`), the Facebook pattern.
4. The database refuses one account on two clients (a unique index per slot). This is the line that
   stops one client's video going to another client's account, whatever the page does.

**Why not fully automatic.** The only signal today is the handle. A saved handle can be stale, have a typo,
or belong to a client's second brand. A wrong link means a post on the wrong client's account, which
cannot be undone. So:

- **Suggest** only when it is certain-looking: the same network, the username equals the saved handle
  (ignoring case and a leading `@`), exactly one client matches, and that client's slot is empty. For
  YouTube, the account's `user_id` equal to the client's saved `UC...` channel id also counts (unproven:
  check on the first real YouTube account).
- **Never link without a click.** A suggestion is a pre-filled picker, one click away. Anything unsure
  (no match, two matches, slot already taken) stays in **Waiting** with an empty picker.
- Sidney still never copies an id. He connects in Post for Me as today, opens the page, clicks **Link**.

**Why asking beats the webhook here.** A person confirms every link, so the list only has to be fresh when
a person opens it. One call (a few pages of 50) answers that. A webhook adds an endpoint, a stored copy
of accounts that can drift from Post for Me, and a failure mode (missed or late events) for no gain. It
also misses nothing the page needs: a disconnected account shows up on the next open.

### Alternative A: connect from SyncView (certain, fully automatic)

A **Connect** button per client and network. SyncView calls `POST /v1/social-accounts/auth-url` with
`external_id` = the client's SyncView id, the person signs in to the network, and Post for Me sends them
back. The account then carries the client's id, so SyncView can link it with no click and no guess.

- **Buys:** certainty, zero clicks, and a link Sidney could send to a client to connect their own account.
- **Costs:** connection moves from the Post for Me dashboard into SyncView; one setting in Post for Me's
  dashboard ("For Quickstart projects using Post for Me system credentials, `redirect_url_override` is not
  accepted. Configure the project redirect URL in the dashboard instead."), a return page, and a webhook
  or a read on return. About 2 more pull requests. Also: "If the existing connection has a different
  `external_id` already set, that account fails to connect", so a mistake needs a disconnect to fix.
- **When:** after the simple version, if one-click linking still feels like a chore.

### Alternative B: webhook plus automatic linking on a handle match

Register `social.account.created` (the way `tiktok-upload` registers its result webhook) and link at once
when the handle matches.

- **Buys:** truly zero clicks for well-kept handles.
- **Costs:** a guess with no person in the loop, on the one mistake that cannot be undone. Plus a webhook
  endpoint. **Not recommended.**

---

## 3. Backend

**Tables and columns.** No new table. Two new keys in `client_profiles.extra`:
`postforme_youtube_account_id`, `postforme_linkedin_account_id`. No data moves: today's TikTok column and
Instagram/Facebook keys stay exactly where they are.

**Migration (one), `migrations/2026-11-xx-client-postforme-accounts.sql`:**
- `client_profile_admin_edit`: `allowed_extra` gains the two keys (the 2026-10-31 shape, line 65).
- Unique partial indexes, one per slot: on `postforme_account_id`, and on `(extra->>'<key>')` for each of
  the four extra keys, `where` the value is not blank. Archived rows included, so an archived client's
  old account cannot be reused silently (measure first: the precheck query counts duplicates across all
  rows, archived included; today's zero is for active rows only).
- A cross-slot check is not needed: Post for Me's `platform` already differs per slot, and the function
  checks it.
- **Rollback** (`...ROLLBACK.sql`): restore the 2026-10-31 function body, drop the five indexes, then
  `update client_profiles set extra = extra - 'postforme_youtube_account_id' - 'postforme_linkedin_account_id';`
- **Deploy hold:** it adds a migration, so the merge lane holds the functions in the same merge until
  Lighthouse applies it and re-runs the lane with `migrations_applied = true`. The 2026-10-31 precedent
  copes (the page says the database update is not applied yet and saves nothing new), so the file may
  carry `-- ef-auto-deploy: functions-cope-without-this` if the build proves that again.

**Edge Functions touched:**

| Function | Change | Lane |
|---|---|---|
| `client-profile-write` | `pfm_accounts` action (admin); YouTube and LinkedIn in `EXTRA_ACCOUNT_PLATFORM`; the TikTok column gets the same Post for Me check on save; a "this account is on another client" refusal before the index has to say it | merge lane (automatic) |
| `_shared/client-profile-edit.mjs` | field lists, `POSTFORME_ACCOUNT_RE` reuse | travels with its callers |
| `instagram-upload`, `tiktok-upload` | refuse with a plain reason when Post for Me says the account is `disconnected` (they already fetch the account before every post) | merge lane (automatic) |

**No Section 4 function is touched**, so no fingerprint re-pin. Not `production-write`, `deliverable-write`
or `batch-write`. No n8n workflow.

**Keys and what Sidney must provide: nothing new.** The recommended version uses only the existing
`POST_FOR_ME_API_KEY`. No webhook secret is needed (and if a webhook is ever added, the
`tiktok-upload` pattern reads its secret back with the key). Frame.io needs no new scope (section 10).
Sidney should not send a key to anyone.

---

## 4. Screens

House rules kept: no coloured left edges; skeleton rows match real rows; hover lights only the row under
the mouse; the page has a **Back** button. Status is a word plus a small dot, not a coloured stripe.

**Where:** Kasper > Clients header gets a **Post for Me** button (admin only). If accounts are waiting, it
shows the count: `Post for Me · 3 new`. It opens one page.

**1440 wide, many accounts:**
```
← Back to Clients                                   Post for Me accounts       [Refresh]
Waiting for a client (3)   Linked (24)   Disconnected (1)
──────────────────────────────────────────────────────────────────────────────────────
 (photo) @handle_one      Instagram   connected   [ Suggested: Client A      ▾ ] [Link]
 (photo) Channel name     YouTube     connected   [ Pick a client…           ▾ ] [Link]
 (photo) Page name        LinkedIn    connected   [ Pick a client…           ▾ ] [Link]
──────────────────────────────────────────────────────────────────────────────────────
 Accounts are read from Post for Me when you open this page. Nothing links by itself.
```
The **Linked** tab: the same rows with the client's name and an **Unlink** (confirm dialog: "Posts to
this account from SyncView stop until it is linked again."). **Disconnected:** the client's name and
"Reconnect it in Post for Me."

**390 wide:** one card per account, stacked:
```
← Back            Post for Me
[Waiting 3] [Linked 24] [Off 1]
┌───────────────────────────┐
│ (photo) @handle_one        │
│ Instagram · connected      │
│ [Suggested: Client A   ▾]  │
│ [        Link          ]   │
└───────────────────────────┘
```

**States:**
- **Loading:** three skeleton rows the height of a real row (photo circle, two text bars, a picker bar).
- **Error, Post for Me unreachable:** "Could not reach Post for Me. Nothing changed. [Try again]".
- **Error, key not set:** "Post for Me is not connected to SyncView yet." (admin sees only this).
- **Empty waiting:** "Every Post for Me account is on a client." The Linked tab still works.
- **One item:** the same row; no special layout.
- **Link refused:** inline under the row, the server's reason, for example "This account is already on
  another client." The picker stays as it was.
- **Saving:** the Link button reads "Linking…" and is disabled; the row moves to Linked on success.

**Publishing card (per client):** gains **YouTube (Post for Me)** and **LinkedIn (Post for Me)** next to
the existing three. Each field keeps the paste box (the fallback that works today) and gets a small
**Pick** link that opens the same picker filtered to that network's waiting accounts.

**Post tab:** a linked but disconnected account shows, before posting, "This client's Instagram is
disconnected in Post for Me. Reconnect it there, then try again." and the button stays off.

---

## 5. Build order

Each pull request is shippable alone and safe to stop after.

**PR 1, read-only list (and the missing measurement).**
- Changes: `pfm_accounts` action in `client-profile-write`, pure logic in a new
  `_shared/postforme-accounts.mjs` (safe-field projection, which client has it, suggestion rule).
  A script `scripts/pfm-accounts.js` prints counts only (accounts per network, linked, waiting,
  suggested, disconnected). No page change, no migration, no write.
- Proof: unit tests on fake accounts, which fail before the module exists: the answer never contains
  `access_token` or `refresh_token` (asserted on every key, nested too); a two-client match gives no
  suggestion; a taken slot gives no suggestion; `@` and case are ignored; `tiktok_business` reads as
  TikTok. Live: run the script once; record the counts (no names) in OPEN_REPAIRS.
- Could break: nothing; read-only, admin key only.

**PR 2, YouTube and LinkedIn slots, the unique indexes, the TikTok check.**
- Changes: the migration in section 3; `EXTRA_ACCOUNT_PLATFORM` gains `youtube` and `linkedin`; the
  Publishing card shows the two fields; the TikTok column is checked against Post for Me on save.
- Proof: the migration's proof SQL on a disposable Postgres (house pattern, `scripts/*-proof.sql`): a
  second client with the same id is refused for every slot; the rollback restores the old function.
  `test/` checks on the field lists. Live on `sidneylaruel`: paste a YouTube id, see it saved and
  checked; paste the same id on a throwaway test client, see it refused.
- Could break: a save of an existing duplicate (measured zero for active rows; the precheck covers
  archived ones). The Instagram id's Clients Info copy keeps working; the new keys are not Sheet columns.

**PR 3, the Post for Me accounts page (behind `pfm_account_link_v1`, admin only).**
- Changes: the page in section 4, a new fragment beside `323-kasper-dashboard-tail.js.part`; Link and
  Unlink call the existing `client-profile-write` update with `expected_updated_at`.
- Proof: a mocked browser test (the `prod-write-gateway-browser.js` style) for every state in section 4
  at 1440 and 390, fails before the fragment exists; a version conflict shows the server's reason. Live on
  `sidneylaruel`: connect one account in Post for Me, open the page, see it waiting with a suggestion,
  Link, see it under Linked and on the Publishing card, then Unlink.
- Could break: a stale page linking after someone else edited the client; covered by the version check.
  Rollback: switch the flag off.

**PR 4, disconnected accounts refused before posting.**
- Changes: `instagram-upload` and `tiktok-upload` refuse `status: disconnected` with the plain reason;
  the Post tab shows it before the button.
- Proof: handler tests with a faked Post for Me answer (fail before, pass after). Live: none needed
  beyond the handler tests unless an account is really disconnected; then try one on the test client.
- Could break: a post that would have worked if Post for Me's status were wrong. The reference lists
  only `connected` and `disconnected`, so the rule is narrow.

Postplan's YouTube and LinkedIn posting reads the slots from PR 2; it can start in parallel with PR 1.

---

## 6. What could break elsewhere

- **Posting:** the only real risk in this area is a wrong link. The unique index plus the existing
  per-post "account is the one on file and on the right network" check (both upload functions) bound it.
- **Sheet copies:** links made on the new page go through `client-profile-write`, which queues and sends
  the Clients Info copy (CLAUDE.md: a direct RPC would queue and never send). YouTube, LinkedIn and
  Facebook ids are not Sheet columns, so the Sheet does not change shape.
- **Review boards, status sync, drift robot, Production tab:** untouched. No card, status or Production
  table is read or written.
- **Public repo:** account usernames are client handles. Tests use invented handles; the script prints
  counts only; the page lives in the app, never in a fixture.
- **Secrets:** the list endpoint returns client social tokens. The safe-field projection is a whitelist
  (named fields copied out), never a blacklist, and is tested.

---

## 7. What to cut

- **The webhook** (both alternatives): not needed while a person confirms each link.
- **Connect from SyncView (Alternative A):** wait until the one-click page has been used for a while.
- **A Slack nudge** when a new account appears: the count on the Post for Me button does the job.
- **Back-filling the 32 clients with an Instagram handle and no id:** they appear as suggestions on the
  page; linking them is a few clicks, not a migration.
- **Pinterest, Threads, X, Bluesky:** Post for Me supports them; nobody asked.

---

## 8. Questions for Sidney

1. **One click to confirm each new account, instead of SyncView linking by itself?** Recommended: yes.
   A wrong guess posts on another client's account.
2. **Only admins link accounts?** Recommended: yes, admins only, like the Publishing card today.
3. **Should SyncView later make a Connect link you can send a client (Alternative A)?** Recommended: not
   now; decide after a few weeks of the page.
4. **LinkedIn: company pages, personal profiles, or both?** Recommended: both are allowed. SyncView
   shows whichever you connected; Post for Me decides the type when you connect, not per post.

---

## 9. Size

4 small pull requests, about 3 to 4 days in all, including the live checks on `sidneylaruel`.
PR 1 alone (half a day) answers the open measurement.

---

## 10. API facts for the other planners (sent 2026-11-02)

**Post for Me** (https://api.postforme.dev/docs):
- One create call for every network: `POST /v1/social-posts` with `caption` and `social_accounts`
  required, plus `media[]`, `scheduled_at` (UTC, null posts now), `platform_configurations`,
  `account_configurations`, `external_id`, `isDraft`.
- **YouTube** (`YoutubeConfigurationDto`): `title`; `description` ("Falls back to the post caption when not
  provided. Maximum 5,000 bytes (UTF-8); longer values are truncated."); `tags`; `category_id`;
  `privacy_status` `public|private|unlisted` (default public); `publish_at` ("Only honoured when
  privacy_status is \"private\""); `made_for_kids` (default false); `contains_synthetic_media`;
  `has_paid_product_placement`; `embeddable`; `license`; `default_language`; `localizations`;
  `recording_date`. There is no Shorts switch.
- **LinkedIn** (`LinkedinConfigurationDto`): caption and media overrides, `title` (PDF documents only,
  200 characters), `reshare_post_id`. Personal profile or company page is chosen at connect time
  (`connection_type` `personal|organization`).
- **TikTok:** `title`, `privacy_status`, `allow_comment`, `allow_duet`, `allow_stitch`,
  `disclose_your_brand`, `disclose_branded_content`, `is_ai_generated`, `is_draft`. A separate
  `tiktok_business` platform exists.
- **Thumbnails:** `media[].thumbnail_url` or `thumbnail_timestamp_ms`; the reference does not say which
  networks honour them.
- **Size and length limits:** the reference states none. Media is processed unless `skip_processing`
  ("Best used for larger files"). Uploaded media is deleted "When the associated post is published",
  "After 24 hours if not attached to any post", "When the scheduled post is deleted". Each network's own
  limits apply; prove each with one cheap real post on the test client.
- **Upload:** `POST /v1/media/create-upload-url` gives `upload_url` (signed PUT, "publicly signed for a
  short time") and `media_url`.

**Frame.io** (https://api.frame.io/v4/openapi.json):
- **Token:** the existing `frameio-token` keeper. Its scope
  (`openid,additional_info.roles,offline_access,email,profile`, `frameio-token/logic.mjs:9`) equals the
  four scopes the reference lists. No new scope.
- **Folder listing:** `GET /v4/accounts/{account_id}/folders/{folder_id}/children` (`include`, `type`,
  `sort`, `page_size`, `after`); "Rate Limits: 100 calls per 1.00 minute(s) per account_user". A share:
  `GET /v4/accounts/{account_id}/shares/{share_id}/assets`.
- **Full-HD download:** `GET /v4/accounts/{account_id}/files/{file_id}?include=media_links.original,media_links.high_quality`
  ("10 calls per 1 second(s)"). `original` has `download_url` and `inline_url`; `high_quality` is the
  full-size H.264 (measured in `frameio-view/logic.mjs:196`). "if you include `media_links.original` and
  the user does not have permission to download the file then this endpoint will respond with a
  `403 Forbidden` error", and links are null while a file is still transcoding.
- **Link lifetime:** the reference gives no number. Links are signed with an `Expires=` value, which
  `frameio-view` already reads. Store file ids, never links; fetch a link right before use.

---

Skills: the karpathy-guidelines, frontend-design, interface-design, Hallmark, Emil Kowalski and
taste-skill skills are not installed in this session, so I could not load them. I applied their stated
principles by hand (measure first, the simplest thing that works, small proven steps; one calm list
screen, real-shape skeletons, every state written down) and the house UI rules above.
