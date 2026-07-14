# SyncView TikTok Pilot — App Audit Pack

> **NOT SUBMISSION-READY (F119; verified 2026-07-14).** Current source auto-selects
> `SELF_ONLY` and disables privacy selection while unaudited, despite the pack below promising no
> default. It also has no pre-submit Music Usage Confirmation. Current
> [Content Sharing Guidelines](https://developers.tiktok.com/doc/content-sharing-guidelines/)
> require manual privacy selection with no default and the applicable music-use declaration.
> Product/legal must also obtain a provider-backed eligibility decision for this agency-operated,
> client-account use case. Keep OAuth/posting review disabled until source, tests, sandbox evidence,
> and this pack agree.

This is a target-state audit pack for a first-party Direct Post implementation. It must not be
submitted as a description of current behavior while F119 is open.

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
4. Start a post: pick the test video, type a caption. After F119 is fixed, show the compliant panel:
   - the **creator's nickname** (from `creator_info`),
   - the **privacy dropdown with nothing pre-selected** — the operator must make the choice even
     if the provider returns only **"Only me"** while the app is in review,
   - the **Allow comment / Duet / Stitch** toggles — **off by default**, and **Duet/Stitch greyed-out** because this creator has them disabled (from `creator_info`),
   - the **content preview** (neutral — no TikTok logos/feed chrome),
   - the required **Music Usage Confirmation** declaration and any applicable commercial-content
     controls before submit.
5. Make the privacy choice, confirm the music-use declaration, then click **"Post to TikTok"**.
6. SyncView reports **success** — the queue row flips **processing → Posted** within ~1 min.
7. Open the TikTok account and show the **video posted as Private** (expected while the app is unaudited).

---

## 3) Required mapping and current gaps
- **creator_info before posting** → `ttp-creator-info` calls `/v2/post/publish/creator_info/query/`; the compose UI is built entirely from its response.
- **No default privacy — F119 OPEN** → target behavior is a disabled placeholder and submit blocked
  until the operator chooses a provider-returned value. Current source instead assigns
  `SELF_ONLY` automatically and disables the selector when unaudited; a one-value allowlist still
  requires an explicit choice.
- **Greyed disabled interactions** → comment/duet/stitch start off; if `creator_info` reports one disabled, that toggle is checked-disabled-greyed.
- **Branded content ≠ private** → selecting Branded content removes "Only me" from the options.
- **Music usage — F119 OPEN** → add the exact required acknowledgement and conditional
  commercial-content controls before enabling submit; a Post button alone is not the declaration.
- **Explicit consent + preview, no imitation** → a neutral preview (no TikTok logos/feed UI),
  explicit privacy choice, required declarations, and an explicit "Post to TikTok" button; the
  video is sent only after all of them.
- **Async publish** → status is never shown as "Posted" until `status/fetch` returns `PUBLISH_COMPLETE` (advanced by `ttp-status-cron`).
- **Intended use — owner/legal decision** → document provider acceptance that agency staff may use
  this product to publish to connected client creator accounts. Do not infer eligibility merely
  from OAuth consent or first-party infrastructure.

## Backend (all first-party, in our n8n at synchrosocial.app.n8n.cloud)
`ttp-auth-init` · `ttp-auth-callback` · `ttp-accounts-list` · `ttp-creator-info` ·
`ttp-submit` · `ttp-status-cron` · `ttp-list` · `ttp-token-refresh`. Tokens are
stored in Supabase under RLS that denies the browser key (service-role only).
