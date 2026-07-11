# SyncView TikTok Pilot — App Audit Pack

Materials for submitting SynchroSocial's **own** TikTok app (first-party Direct Post)
for review. This describes the *actual* implementation — SyncView + our own n8n
backend holding the `client_secret` and running OAuth/`creator_info`/Direct Post
directly. No third-party broker; nothing to conceal.

## App configuration (confirm before submitting)
- Platform: **Web** · Sandbox for the demo.
- Products: **Login Kit** (`user.info.basic`) + **Content Posting API / Direct Post** (`video.publish`). No other scopes.
- Redirect URI: `https://synchrosocial.app.n8n.cloud/webhook/ttp-auth-callback`
- Sandbox → **Target Users**: add the demo TikTok account.

---

## 1) Scope explanation (paste into TikTok's "how each product/scope works" field — ≤1000 chars)

Synchro Social is a social-media agency. SyncView (our content-operations tool at syncview.synchrosocial.com) is where our team schedules and publishes the videos we produce to our clients' own TikTok accounts, on their behalf and with their authorization.

Login Kit — user.info.basic: When a client connects their TikTok account in SyncView, our own backend runs TikTok's OAuth consent flow, stores the tokens server-side, and reads the basic profile (open ID, display name, avatar) to identify the connected account and show which creator a post will publish to.

Content Posting API — video.publish: We use Direct Post to publish finished videos to the connected creator's profile. Before each post we call creator_info to display the creator's nickname and the allowed privacy options (with no option pre-selected) and to honor the creator's comment, duet and stitch settings. Our operator reviews a content preview and explicitly confirms before any video is sent to TikTok.

---

## 2) Demo video script (record on the SyncView domain, with the sandbox target-user account)

**Pre-flight**
- PR #568 merged so the **TikTok Pilot** tab is live (hard-refresh — Pages caches ~10 min).
- App in Sandbox, demo account added as a **Target User**.
- Scopes limited to `user.info.basic` + `video.publish`.
- One short, real test video ready (MP4, vertical, ≤64 MB).

**Shots**
1. Browser address bar clearly shows **`syncview.synchrosocial.com`**. Open the **TikTok Pilot** tab (the unlock link is `?ttpilot=1#tiktok-pilot`).
2. Pick the client → click **"Connect TikTok account."** The screen redirects to **TikTok's OAuth consent** page — show it listing the **SynchroSocial** app and the requested scopes (`user.info.basic`, `video.publish`). Approve with the **sandbox target-user** account.
3. Land back in **SyncView**; the connected account appears (**nickname + avatar**).
4. Start a post: pick the test video, type a caption. Show the compliant panel:
   - the **creator's nickname** (from `creator_info`),
   - the **privacy dropdown with nothing pre-selected** — open it; while the app is in review it is limited to **"Only me"** with an "in review" note,
   - the **Allow comment / Duet / Stitch** toggles — **off by default**, and **Duet/Stitch greyed-out** because this creator has them disabled (from `creator_info`),
   - the **content preview** (neutral — no TikTok logos/feed chrome).
5. Click **"Post to TikTok"** (the explicit consent action).
6. SyncView reports **success** — the queue row flips **processing → Posted** within ~1 min.
7. Open the TikTok account and show the **video posted as Private** (expected while the app is unaudited).

---

## 3) How the implementation maps to the UX rules (for reviewers / our own check)
- **creator_info before posting** → `ttp-creator-info` calls `/v2/post/publish/creator_info/query/`; the compose UI is built entirely from its response.
- **No default privacy** → the dropdown's first option is a disabled placeholder; submit is blocked until the operator picks one. (Unaudited → locked to `SELF_ONLY`.)
- **Greyed disabled interactions** → comment/duet/stitch start off; if `creator_info` reports one disabled, that toggle is checked-disabled-greyed.
- **Branded content ≠ private** → selecting Branded content removes "Only me" from the options.
- **Explicit consent + preview, no imitation** → a neutral preview (no TikTok logos/feed UI) and an explicit "Post to TikTok" button; the video is sent only on that click.
- **Async publish** → status is never shown as "Posted" until `status/fetch` returns `PUBLISH_COMPLETE` (advanced by `ttp-status-cron`).

## Backend (all first-party, in our n8n at synchrosocial.app.n8n.cloud)
`ttp-auth-init` · `ttp-auth-callback` · `ttp-accounts-list` · `ttp-creator-info` ·
`ttp-submit` · `ttp-status-cron` · `ttp-list` · `ttp-token-refresh`. Tokens are
stored in Supabase under RLS that denies the browser key (service-role only).
