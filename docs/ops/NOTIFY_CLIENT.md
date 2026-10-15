# Notify client (Calendar and Samples)

Built by session Herald, 2026-10-14. Source only: nothing here is deployed, applied or switched on yet.

## What it is

An accent **Notify client** button next to Organize on the Calendar toolbar (and after the Review / Sheet
switch on Samples), for admins and SMMs only. It posts **one general alert** to the client's **private**
Slack channel (the roster's `slack_channel_id`, never `creative_channel_id`):

> **New content is ready for your review.** (Samples: **New samples are ready for your review.**)
> [Review now]

One bold line and one button that opens the client's review page (the same address "Copy client link"
gives for that surface). No SMM name, no count, no emoji. The plain-text fallback carries the link.

The confirm box shows the exact words, the channel name and the last alert for that client and surface.
Inside six hours it says so and still allows sending ("Send anyway").

## How it works

- Edge Function `client-review-alert` (`supabase/functions/client-review-alert/index.ts`, logic in
  `_shared/client-review-alert.mjs`, Slack calls in `_shared/client-review-alert-slack.mjs`).
- Actions: `status` (what the box shows), `send`, `preview` (admin only), `audit` (admin only).
- Staff keys only: `authorizeStaffKey` with `admin` and `smm`. A client review token is never read.
- The page sends only `{ action, client, surface }`. The function looks up the channel and builds the link
  itself, so the browser never supplies a channel id or an address.
- Every send is written to `public.client_review_alerts` (who, client, surface, time, Slack result)
  **before** Slack is called. If that write fails nothing is posted. No token, link or message text is stored.
- The bot token is only ever in the `Authorization` header: never in a URL, a log line, a response or a row.
- If the bot is not in the channel the box says so, in plain words (and warns up front when it can tell).
- **Owner preview:** `preview` posts the exact same message to the DM named by
  `NOTIFY_PREVIEW_SLACK_USER_ID` (the same secret `notify` uses) and never to a channel. In the box,
  admins see **Send preview to me**. It works even while client sending is off.

## To turn it on (the owner's steps, in order)

1. **Apply the migration** `supabase/migrations/20261014120000_client_review_alerts.sql` in the SQL editor.
2. **Deploy one function** with the existing lane, giving the merged commit SHA:
   https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-single-function.yml
   (function: `client-review-alert`).
3. **Secrets:** nothing new is required to look and preview. It uses the staff keys (`ROLE_KEY_ADMIN`,
   `ROLE_KEY_SMM`), `SLACK_BOT_TOKEN` and `NOTIFY_PREVIEW_SLACK_USER_ID`, which the project already has.
   The one new setting is **`CLIENT_REVIEW_ALERT_LIVE=1`**, and it is what lets "Send alert" post to a real
   client channel. Leave it unset until you have looked at the preview: without it every send answers
   "not switched on yet" and posts nothing. Optional: `CLIENT_REVIEW_ALERT_ORIGIN` (defaults to
   `https://syncview.synchrosocial.com`).
4. Open the box on the test client, press **Send preview to me**, and check the DM.

## Coverage (counts only, measured 2026-10-14, read only)

| | Count |
| --- | ---: |
| Active real clients | 35 |
| With no private Slack channel on the roster | 3 |
| Of those, with only a creative channel (it is never used instead) | 0 |
| Active real clients with no review link yet | 0 |
| Channels the bot is not a member of | not measured |

The bot's membership could not be checked from the build session (it has no Slack bot token). After
deploying, an admin can get the count (and the names, for them only) with the `audit` action of the same
function. A client in the first row can still be opened in the box; it says there is no private channel
and cannot send.

## Pictures

Made by `NOTIFY_CLIENT_SHOTS=<dir> node docs/syncview-design/tests/notify-client-browser.js` on fictional data
(desktop 1280px and phone 390px): [`docs/ops/notify-client-screens/`](notify-client-screens/).
