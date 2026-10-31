# Instagram upload (TikTok Upload tab, Instagram side)

Built 2026-09-30 by Relay. **Nothing here is live until the owner's remaining one-time steps
below are done**: the page already shows the switch, but the Instagram side has no server
to talk to until the function is deployed.

## How it works, in one paragraph

The TikTok Upload tab has a TikTok / Instagram switch at the top. The Instagram side sends
the video straight to Post For Me's storage, then asks the Supabase function
`instagram-upload` to create the post. The function holds the Post For Me key, keeps the
queue in the table `instagram_uploads`, and asks Post For Me how each post went. **No n8n
workflow is used or changed.** TikTok is untouched and still runs on n8n.

| Piece | Where it runs |
|---|---|
| Switch, form, queue (page) | the SyncView page (`src/index/299-instagram-upload.js.part`) |
| Post For Me key, account check, post creation, status lookups, cancel | Supabase function `instagram-upload` |
| Queue rows | Supabase table `instagram_uploads` (migration `migrations/2026-09-30-instagram-uploads.sql`) |
| Client's Instagram account id | The client's SyncView profile (`client_profiles.extra.postforme_instagram_account_id`), set through `roster-write`; the Clients Info sheet only holds a copy |

## One-time setup (owner, with Lighthouse)

1. **Migration: done.** `migrations/2026-09-30-instagram-uploads.sql` created the queue table on 2026-09-30 (Lighthouse, with your go).
2. **Add the Post For Me key as a Supabase secret** named `POST_FOR_ME_API_KEY` (Supabase, Edge Functions, Secrets). It is the same key the n8n credential "Post For Me" holds. Never put it in the repo.
3. **Deploy the function**: `https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-single-function.yml`, choose `instagram-upload`, paste main's commit SHA.

## Connect a client's Instagram

1. In Post For Me, connect the client's Instagram account (the same place TikTok accounts are connected). The Instagram account must be a Business or Creator account.
2. Copy the new account's **Connection ID** (it starts with `spc_`). It is a different id from the client's TikTok one.
3. Give the id to Sidney. It goes on the client's SyncView profile, not in the Sheet: a `roster-write` call `{ "action": "set_client_fields", "client": "<client name>", "fields": { "postforme_instagram_account_id": "spc_..." } }` stores it in `client_profiles.extra` and refreshes the Clients Info copy in the same request. Since 2026-10-31 (OPEN_REPAIRS 618, once `migrations/2026-10-31-client-facebook-page.sql` is applied) it can also be pasted on Kasper > Clients, Publishing, **Instagram (Post for Me)**: the save checks with Post For Me that it is an Instagram account and queues the Sheet copy. Typing it into the Sheet does nothing: the Sheet is only a copy of the profile.
4. Reload SyncView. On the Instagram side, the client now shows "Posts to Post For Me account spc_...". Without an id it shows "No Instagram account on file for this client yet. Ask Sidney to add its Post For Me Connection ID (spc_...) to the client's profile." and the button stays off: there is no fallback, so a video can never land on another client's account.

## Safety switches: who can post, and to which account

- **Nobody can post until you list clients.** The server refuses every Instagram post unless the Supabase secret `INSTAGRAM_UPLOAD_ALLOWED_CLIENTS` names the client (a comma list of client names, or `*` for everyone). Nothing is listed in the repository. Start with the test client only; add a real client when you are ready to try one. Take it back the same way.
- **The account must be the one on file.** The server checks that the Instagram account sent with a post is the one on the client's profile (`client_profiles.extra.postforme_instagram_account_id`), and that Post For Me says it is an Instagram account. A caller cannot swap in another client's account.
- **A new id works at once.** The server reads `client_profiles` directly, so there is nothing to refresh after the id is set. With no id on file, a post is refused with "No Instagram account on file for this client yet. Ask Sidney to add its Post For Me Connection ID (spc_...) to the client's profile."

## Try one post yourself

1. Do the setup and connect the account as above, and list the client in `INSTAGRAM_UPLOAD_ALLOWED_CLIENTS`.
2. TikTok Upload tab, **Instagram**, pick the client, attach a short video, write a caption such as "test, please ignore".
3. First try **scheduling** 15 minutes ahead (turn off "Post immediately"). The queue shows it as **Scheduled**. Press **Cancel** and check it disappears from Post For Me's own list: that proves cancel works without publishing anything.
4. Then do it for real: schedule or "Post now". The queue shows **Posting**, then **Posted** with an **Open** link to the reel. If Instagram refuses, the row shows **Failed** with Post For Me's reason.

## Scheduling and post type

- **Scheduling:** the same switch as TikTok's. "Post immediately" is on by default; switch it off to pick a date and time (SyncView's own date and time controls, plus a timezone). The queue shows a scheduled post as Scheduled, with a Cancel button until it goes out.
- **Post type:** a **Reel / Carousel** choice sits at the top of the media card. **Reel** (the default) is one video, exactly as before: the function tells Post For Me `placement: reels` explicitly, so it never falls back to a default, and there is no Feed video choice (Instagram treats videos as Reels now). **Carousel** is one feed post of several images and videos (below).

## Carousel (added 2026-10-28, session Igcarousel)

- **What the SMM does:** switch the media card to **Carousel**, then pick or drop 2 to 10 images and videos (JPEG, PNG, WEBP, MP4, MOV; they may mix). The picker is TikTok's Photo carousel picker: numbered tiles, **←** / **→** to reorder, **×** to remove, keyboard focus stays on the moved item. Caption, schedule and timezone work as for a Reel. The preview shows the first item and the item count. The queue row reads **Carousel (n)**.
- **No cover, no trial:** the Cover image card and the Trial reel switch are hidden on a carousel, and a trial switched on beforehand is switched off. The function refuses a carousel that carries a trial, a cover image or a cover frame, so nothing picked is silently dropped.
- **What is sent:** each item goes to Post For Me storage in carousel order (a PNG or WEBP is redrawn as a JPEG first, because Instagram's feed takes JPEG images), then one `create` call with `kind: "carousel"` and `mediaUrls` (2 to 10, every one a `https://data.postforme.dev/` address, no repeats). The function sends Post For Me one post with those media in that order and `configuration: { placement: "timeline" }` (the feed).
- **Same safety switches:** the client must be in `INSTAGRAM_UPLOAD_ALLOWED_CLIENTS`, the account must be the one on file, and Post For Me must say it is an Instagram account, exactly as for a Reel. The same retry-safe key means a second press cannot post twice.
- **Stored in the row:** `instagram_uploads.options` gets `{ kind: "carousel", placement: "timeline", items: n, ... }`. No migration: `options` is already a JSON column. A Reel row keeps its old shape, and any row without a `kind` reads as a Reel.
- **Limits (Instagram's, from Meta's carousel rules):** 2 to 10 items; images and videos may mix; Instagram crops every item to the shape of the first one (the page says so under the picker); feed images are JPEG, up to 8 MB each (the page enforces 8 MB per image; videos use the Reel size limit).

**Confirmed from Post For Me's live API reference (the OpenAPI document inside https://api.postforme.dev/docs, read 2026-10-28):** a post takes a `media` array of several items, each `{ url }`, ordered by its position in the array (or an explicit `index`); Instagram's `placement` accepts `timeline`; the only multi-media rule the reference states is for `stories` ("individual posts are created per media item"), so several media on a `timeline` post is one post.

**Still unproven until Sidney's first real carousel:** that Post For Me turns several media on an Instagram `timeline` post into one carousel (its reference does not use the word "carousel" for Instagram; it does for Facebook and LinkedIn); what Post For Me does past Instagram's 10-item limit (the function never sends more); whether it converts a non-JPEG image itself (the page sends JPEGs, so it should not matter); how a mixed image-and-video carousel and a scheduled carousel come back in the result lookup; and which link the **Open** button gets for a carousel. All of it lives in `supabase/functions/instagram-upload/`, so a mismatch is a small fix.

**Try one yourself:** Instagram side, **Carousel**, the test client, 2 or 3 images, caption "test, please ignore", schedule 15 minutes ahead, check the queue says **Carousel (n)** and **Scheduled**, press **Cancel**. Then post one for real.

## Also post to Facebook (added 2026-10-31, session Fbpost, OPEN_REPAIRS 618)

Instagram's own "also share to Facebook" setting does not apply to a post published through the API, so before this
nothing posted from SyncView reached Facebook.

- **Connect the Page (once per client, admin):** in Post For Me, connect the client's Facebook Page and copy its
  **Connection ID** (`spc_...`; a different id from the Instagram one). In SyncView: Kasper > Clients, open the
  client, **Edit**, paste it into **Facebook Page (Post for Me)** in the Publishing card, **Save**. The save asks Post
  For Me that the id is a Facebook account; an Instagram id, an unknown id or anything not `spc_...` is refused with a
  plain reason. It is kept in `client_profiles.extra.postforme_facebook_account_id` (not a Clients Info column) and
  each change gets a history row. The **Instagram (Post for Me)** field beside it now saves the same way (checked as
  an Instagram account; its Clients Info copy is queued as with `roster-write`, which still works too). Saving either
  needs `migrations/2026-10-31-client-facebook-page.sql` applied; until then the page says the database update is not
  applied yet and saves nothing (every other field still saves).
- **Composer:** with a Page on file, an **Also post to Facebook** box sits above Scheduling, ticked by default. Untick
  it for an Instagram-only post (it stays unticked for that client until the client changes). It is unticked and
  disabled, with the reason, for a **trial reel** (an Instagram feature), for a **carousel with a video** (Facebook
  takes a carousel of photos only here) and for a client with **no Page** connected.
- **What is sent:** ONE Post For Me post with both accounts in `social_accounts` and an `account_configurations` entry
  each. Instagram's is unchanged. Facebook: a Reel goes as a Facebook Reel (`placement: "reels"`); an all-photo
  carousel goes as one feed post of the photos (`placement: "timeline"`, `set_caption_for_each_image: false`, so the
  caption is on the post and not repeated under every photo). Same caption, media, cover and schedule; one retry-safe
  key, so a second press cannot post twice on either network. Source: Post For Me's API reference
  (`FacebookConfigurationDto`, `SocialPostResultDto`, read 2026-10-31 from https://api.postforme.dev/docs).
- **Safety:** `INSTAGRAM_UPLOAD_ALLOWED_CLIENTS` still decides who can post at all. The function also checks that the
  Page is the one on the client's profile and that Post For Me says it is a Facebook account, before anything is
  written. A caller cannot add a trial or a video carousel to Facebook (refused, never dropped).
- **Status, per network:** each post's results come back from Post For Me per account (`social_account_id`), so
  Instagram's stays in the row's `status` / `instagram_url` / `error` and Facebook's is kept in
  `options.facebook` (`status`, `url`, `error`, `posted_at`). No migration: `options` is already JSON. The queue shows
  both lines (Instagram: Posted, Facebook: Failed with the reason, for example), with an **Instagram** and a
  **Facebook** link once each is live. A row goes under **Failed** if either network failed, under **Upcoming** while
  either is still going. The status poll keeps asking until both are final. **Cancel** cancels both (it is one post).
- **Clients with no Page:** nothing changes: the same body, the same queue row, the same messages.

**Not yet proven live (until Sidney's first cross-post on his own test account):** that Post For Me returns one result
per account with `social_account_id` filled in (its reference marks the field required); the exact Facebook link it
returns; how a scheduled cross-post and a Facebook carousel come back. All of it is in
`supabase/functions/instagram-upload/logic.mjs`, so a mismatch is a small fix.

## Trial reels

- **What it does:** the **Trial reel** switch on the Instagram side posts the video as an Instagram trial reel: Instagram shows it to non-followers first. The SMM downloads the version from Frame.io, drags it in as usual, switches on Trial reel and posts (now or scheduled). The function sends Post For Me `configuration: { placement: "reels", trial_reel_type: "manual" }` and keeps `trial_reel_type` in the row's `options`; the queue row reads **Trial reel**. The switch is off again after each post.
- **Manual only:** sharing a trial reel to followers stays in the Instagram app, by a person. Post For Me's other kind, `performance` (Instagram shares it by itself if it does well), is refused by the function, so a trial can never reach followers on its own. Meta's API has no call to share a trial to followers.
- **Eligibility:** Instagram does not let every account post trial reels (a public professional account; Meta publishes no exact rule). An account that cannot is refused at publish: the row shows **Failed** with Instagram's reason, as any refusal does.
- **Same safety switches:** the client must be in `INSTAGRAM_UPLOAD_ALLOWED_CLIENTS` and the account must be the one on file, exactly as for a normal Reel.
- **Not tied to the Calendar's trial reels yet:** posting a trial here does not mark a card version "on trial"; the SMM still presses "Mark approved as on trial" on the card.
- Sources: Meta's `trial_params` on IG User Media (https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media) and Post For Me's `trial_reel_type` (https://api.postforme.dev/docs).

## Cover image (Reel cover)

Below the video there is an optional **Cover image** field, with a **Preview** beside the form showing the cover that will be used.

- **Image:** upload a JPEG or PNG, 9:16 (1080x1920 is ideal), up to 8 MB. Another shape is accepted with a warning, because Instagram crops it.
- **Calendar card:** if the client's Calendar (the live one, or this device's saved copy) has cards that can still go out, they are offered in a picker, named the way the Calendar names them (for example "Video 15"). Only Approved or Scheduled cards are listed, never Posted ones and never ones with a posting date in the past. Order: cards with a posting date from today onward come first, soonest first; then cards with no posting date, in the order they appear on the Calendar. Picking a card uses its thumbnail as the cover (the browser copies the picture into Post For Me storage, so the Calendar link itself does not need to be public; if the browser is not allowed to read it, the form says so and asks for an upload) and fills the caption box with the card's caption, but only when the caption box is empty.
- **Frame from video:** pick a moment in the video. At 0 s Instagram uses the first frame.
- Only one of image or frame is ever sent. Nothing chosen means no cover field is sent at all.

How Post For Me takes it (from their own API client, `post-for-me-go`, and their "Customizing Video Thumbnails" guide): on the media item, `thumbnail_url` (a public link to an image; we use Post For Me storage) or `thumbnail_timestamp_ms` (a frame, in milliseconds). Both are documented as supported on Instagram.

## Confirmed and not confirmed

Confirmed from Post For Me's own API client (2026-09-30): the media fields above, the Instagram `placement` values (`reels`, `stories`, `timeline`), `share_to_feed`, and the `account_configurations` shape the function sends.

Still unproven until the first real post (the function is not deployed, and the key lives only on the server, so no live call has been made): which of image or frame Post For Me prefers if both are sent (we never send both), what image sizes it accepts, the result lookup, the account lookup that checks the account really is Instagram, and cancelling a scheduled post. All live in `supabase/functions/instagram-upload/`, so a mismatch is a small fix.

## Way back

Delete nothing: empty `INSTAGRAM_UPLOAD_ALLOWED_CLIENTS`, or remove the
`POST_FOR_ME_API_KEY` secret, and every Instagram post is refused. The page switch can stay.
The table can be dropped (`drop table public.instagram_uploads;`); posts already sent stay on Instagram.
