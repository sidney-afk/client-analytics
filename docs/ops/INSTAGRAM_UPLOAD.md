# Instagram upload (TikTok Upload tab, Instagram side)

Built 2026-09-30 by Relay. **Nothing here is live until the owner's three one-time steps
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
| Client's Instagram account id | Clients Info sheet, column `postforme_instagram_account_id` |

## One-time setup (owner, with Lighthouse)

1. **Apply the migration** `migrations/2026-09-30-instagram-uploads.sql` (it creates the queue table; Lighthouse applies it with your go).
2. **Add the Post For Me key as a Supabase secret** named `POST_FOR_ME_API_KEY` (Supabase, Edge Functions, Secrets). It is the same key the n8n credential "Post For Me" holds. Never put it in the repo.
3. **Deploy the function**: `https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-single-function.yml`, choose `instagram-upload`, paste main's commit SHA.

## Connect a client's Instagram

1. In Post For Me, connect the client's Instagram account (the same place TikTok accounts are connected). The Instagram account must be a Business or Creator account.
2. Copy the new account's **Connection ID** (it starts with `spc_`). It is a different id from the client's TikTok one.
3. In the **Clients Info** sheet, add a column named exactly `postforme_instagram_account_id` (once, at the end), then paste the id on the client's row.
4. Reload SyncView. On the Instagram side, the client now shows "Posts to Post For Me account spc_...". Without an id it shows a warning and the button stays off: there is no fallback, so a video can never land on another client's account.

## Safety switch: who can post

Until you widen it, **only the test client (Sidney Laruel) can post**; any other client is refused by the server with "not switched on for this client yet". To open a client up, set the Supabase secret `INSTAGRAM_UPLOAD_ALLOWED_CLIENTS` to a comma list of names (for example the test client plus the one client you are trying), or `*` for everyone. Take it back the same way.

## Try one post yourself

1. Do the setup and connect the account as above. Widen the switch to that client if it is not the test client.
2. TikTok Upload tab, **Instagram**, pick the client, attach a short video, write a caption such as "test, please ignore".
3. First try **scheduling** 15 minutes ahead (turn off "Post immediately"). The queue shows it as **Scheduled**. Press **Cancel** and check it disappears from Post For Me's own list: that proves cancel works without publishing anything.
4. Then do it for real: schedule or "Post now". The queue shows **Posting**, then **Posted** with an **Open** link to the reel. If Instagram refuses, the row shows **Failed** with Post For Me's reason.

## Not confirmed yet (first real post is the proof)

Post For Me's API reference could not be read without a key, so these follow the shape TikTok
already uses and are unproven for Instagram until the first post: the Instagram setting
`placement` (`reels` or `timeline`), the lookup of a post's result, the account lookup that
checks the account really is Instagram, and cancelling a scheduled post. All four live in one
small file (`supabase/functions/instagram-upload/logic.mjs`, plus the calls in `index.ts`), so a
mismatch is a one-line fix.

## Way back

Delete nothing: set `INSTAGRAM_UPLOAD_ALLOWED_CLIENTS` to a name nobody has, or remove the
`POST_FOR_ME_API_KEY` secret, and every Instagram post is refused. The page switch can stay.
The table can be dropped (`drop table public.instagram_uploads;`); posts already sent stay on Instagram.
