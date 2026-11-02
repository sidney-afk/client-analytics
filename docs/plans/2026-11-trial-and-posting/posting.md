# Post tab: sources, YouTube and LinkedIn, posting a trial version (plan)

Session Postplan, 2026-11-02. **A plan only: nothing here is built.** Covers Sidney's item 3 (drag a folder; pick a
calendar card and let SyncView take its full-HD video, thumbnail and caption) and the posting half of item 4
(YouTube and LinkedIn as destinations). Siblings: `variants.md` (card versions, Frame folder matching, SMM trial
status; session Variantplan) and `links.md` (Post for Me accounts arriving by themselves, API facts; session
Linkplan).

---

## 1. What exists today (measured 2026-11-02 against `origin/main` 604406e and the live database)

- **One tab, two sides.** The Post tab (once "TikTok Upload") has a TikTok / Instagram switch. TikTok is
  `src/index/300-tiktok-upload.js.part` (2,486 lines; it owns the tab and the switch). Instagram is
  `src/index/299-instagram-upload.js.part` (1,169 lines; it gets shared helpers from 300 through `deps`).
- **Both post through Post for Me, from Supabase, without n8n.** TikTok: function `tiktok-upload`, table
  `tiktok_uploads` (347 rows, 105 in the last 30 days); live since 2026-10-07 (`tiktok_upload_source` =
  `supabase`). Instagram: function `instagram-upload`, table `instagram_uploads` (16 rows, all posted, 4 trial
  reels, 0 with Facebook).
- **The video always passes through the browser.** The page asks for a one-time Post for Me storage address
  (`mint`), PUTs the file there from the browser, then asks the function to create the post
  (`299-instagram-upload.js.part:803-872`, `300-tiktok-upload.js.part:1611-1645`). The server only accepts media on
  `https://data.postforme.dev/` (`instagram-upload/logic.mjs:7`).
- **Drop takes one file.** Both drop zones read `dataTransfer.files[0]` (`299:762`, `300:1172`); a dropped folder
  is not read. The carousel drop reads a flat file list (`299:753`, `300:1183`).
- **A calendar card can already be picked, for cover and caption only, Instagram only.** `_igCalendarCards`
  (`299:178-203`) lists the client's Approved or Scheduled cards, today onward. Picking one copies the card's
  thumbnail into Post for Me storage *from the browser* (fails when the browser may not read it, `299:337-364`) and
  fills an empty caption box. **The card's video is not taken**: the SMM downloads it from Frame and drops it in.
  Separately, a dropped file whose name matches exactly one card fills the caption (`299:216-257`), on both sides.
- **The card has what a post needs.** `calendar_posts` has `asset_url` (the Frame link), `thumbnail_url`,
  `caption`, `caption_alt` and `caption_alt_platform`. No upload row points back to a card.
- **SyncView can already reach the full file on Frame, server side.** `frameio-view` returns signed addresses for
  three renditions, `efficient`, `high_quality` (Frame's full-size H.264 copy) and `original` (the upload itself)
  (`frameio-view/index.ts:8`; choice rules at `187-frame-viewer.js.part:304-330`: an original is often HEVC).
  It reads only, for staff keys, and never stores anything.
- **Account check, per network.** The server reads the account id from the client's profile
  (`client_profiles.extra.postforme_instagram_account_id`, `..._facebook_account_id`; TikTok's is
  `postforme_account_id`), refuses any other id, and asks Post for Me that the id is that platform
  (`instagram-upload/index.ts:121-149`). Live: 41 active clients, 4 with Instagram, 2 with a Facebook Page, 0 with
  YouTube or LinkedIn. A secret list `INSTAGRAM_UPLOAD_ALLOWED_CLIENTS` decides who may post at all.
- **One press cannot post twice.** Instagram keeps one key while the form is unchanged (`299:821-825`); the server
  returns the existing post for a known key and, if an earlier try never got an answer, adopts Post for Me's post
  with that `external_id` instead of making a second (`instagram-upload/index.ts:118-161`). TikTok has the same
  server rule (`tiktok-upload/handler.mjs:112-142`) **but mints a fresh key on every press**
  (`300:1449`); a second press is blocked only by the in-page `submitting` guard, so a reload after a lost answer
  and a re-press could post twice. The new composer takes Instagram's rule for every network.
- **Instagram + Facebook is already one post to two accounts.** One Post for Me post, both accounts, one key,
  each network's result kept apart (`options.facebook`, no migration). This is the pattern YouTube and LinkedIn
  follow.
- **Trial reels today.** Versions A to G live in `studio_trial_versions` (161 rows; 34 trial cards on), each with
  its own `frame_url` and hook, **no caption or thumbnail of its own**. The trial starts when the card is set to
  Posted (`189-trial-reels-card.js.part:444-462`). Posting is by hand: the SMM downloads each version from Frame,
  drops it on the Instagram side, ticks Trial reel, posts, once per version (`docs/ops/INSTAGRAM_UPLOAD.md`, "Not
  tied to the Calendar's trial reels yet"). Trial reels are Instagram only (`trial_reel_type: "manual"`).
- **Deploy.** `instagram-upload`, `tiktok-upload` and `frameio-view` deploy on merge by
  `deploy-edge-functions-on-merge.yml`; a brand-new function does too. None of this touches a Section 4 function.
- **Running elsewhere today:** session Trialchange is fixing a Safari player error on the review stage
  (`187`/`195`). This plan does not touch `187`; the card preview below uses a plain `<video>`, so it does not wait
  on that work.

---

## 2. The proposal

### In one paragraph

**One composer with network chips.** The Post tab becomes one form: pick the client, tick the networks (only the
ones connected on the client's profile are tickable), give it media **from a card** or **from files** (a folder
or files dropped), one caption, then only the extra fields the ticked networks need. One press makes **one Post for
Me post** for Instagram, Facebook, YouTube and LinkedIn together (the way Instagram + Facebook works today), plus
one TikTok post through `tiktok-upload` when TikTok is ticked. Picking a card copies the card's video
**server to server** from Frame into Post for Me storage, with its thumbnail and caption, so a phone never
downloads or uploads the file. A trial card posts each approved version as its own Instagram trial reel, in one
press.

### Sources

**From a card** (new, both sides, phones included)

1. The card list is today's `_igCalendarCards` (Approved or Scheduled, today onward), shown with thumbnail, name
   and date.
2. On pick, the page calls a new function **`post-source`** with `{ client, post_id, letter? }`. The server, not the
   page, reads the card's Frame link (or the version's, for a trial) from the database, asks Frame for the
   **`high_quality` rendition** (Frame's full-size H.264 copy: full HD for a 1080x1920 export, and a format every
   network takes; `original` only when Frame has no H.264 copy, because an original is often HEVC or a huge
   master), mints a Post for Me storage address, and streams the file across. It does the same for the card's
   thumbnail (this also ends the "browser was not allowed to read it" failure at `299:357`). It answers
   `{ media_url, thumb_url, caption, caption_alt, caption_alt_platform, file_name, bytes, width, height, duration }`.
3. **The file never passes through the browser.** The browser shows Frame's small `efficient` copy in a plain
   `<video>` so the SMM sees what will go out, with the Frame file name and size under it. Typical size: a 30 to 90
   s 1080p reel is 20 to 150 MB; the server refuses anything over TikTok's limit (287 MB) when TikTok is ticked,
   and over Post for Me's limit otherwise (fact pending from Linkplan).
4. **Spike first (PR 1).** Two things are not proven and decide the route: whether Post for Me's signed upload
   address takes a streamed (chunked) PUT, and how long the copy takes against the Edge Function time limit.
   PR 1 measures one real copy on the test client and picks: (a) stream (preferred); (b) if Post for Me
   accepts any public https media address and fetches it at create time, hand it Frame's signed address and copy
   nothing; (c) fall back to "Download from Frame" with a clear message for files the server cannot move.
5. Caption: the card's caption, or `caption_alt` when written for the network being posted to (today's rule,
   `299:241-257`). Only an empty caption box is filled; typed text is never overwritten.

**From files** (drop or pick)

- A dropped **folder** is read (`webkitGetAsEntry`, in Chrome, Edge, Safari and Firefox), two levels deep. Hidden
  and system files (`.DS_Store`, `Thumbs.db`, `._*`) are skipped.
- Each file is sorted by type: video (`.mp4 .mov .m4v .webm`), image (`.jpg .jpeg .png .webp`), text
  (`.txt .md`). Order is by name, natural ("2" before "10").
- **One video + one image + one text** (the usual export folder): video, cover, caption. The text fills only an
  empty caption box.
- **Several images**: the image picked as cover is the one named `thumb*`, `cover*` or `thumbnail*`; else, with
  one video, the page asks which. With no video, the images become a carousel in name order (reorderable as today).
- **Several videos**: "This folder has 3 videos. Pick one." in name order. (Matching versions A, B, C to files is
  Variantplan's matching step; this plan does not build a second one.)
- **Several text files**: `caption*.txt` wins, else none fills and the page says why.
- Everything else is listed in one quiet line: "Ignored 2 files: .prproj, .wav". Nothing is dropped silently.
- Two folders at once: refused with "Drop one folder at a time."
- On phones there is no folder drop; the file picker stays, and "From a card" is the phone path.

### Destinations

| Network | Needs | Defaults | Account on profile |
|---|---|---|---|
| TikTok | today's fields, unchanged (privacy with no default, comments/duet/stitch, disclosure) | as today | `postforme_account_id` |
| Instagram | Reel or Carousel, cover, Trial reel | as today | `postforme_instagram_account_id` |
| Facebook | nothing extra | Reel as a Facebook Reel | `postforme_facebook_account_id` |
| YouTube | **title** (required, up to 100 characters), description (the caption, up to 5,000), **privacy** (public, unlisted, private), **made for kids** (YouTube requires an answer) | title = first line of the caption, Public, Not made for kids | `postforme_youtube_account_id` |
| LinkedIn | nothing extra (caption up to 3,000) | posts as whatever account is connected | `postforme_linkedin_account_id` |

- **YouTube Shorts vs long video.** YouTube itself makes a vertical video of 3 minutes or less a Short. The form
  shows "Will be a Short" or "Will be a regular video" from the file's shape and length; there is no switch. A
  custom thumbnail is not applied to Shorts, so the cover line says so for a Short.
- **LinkedIn page vs person.** One LinkedIn account per client, whichever Sidney connects in Post for Me (a company
  page, or a founder's own profile). The form names which it is from Post for Me's account read.
- Caption limits are shown per ticked network, against the shortest: "1,204 / 2,200 (Instagram)".
- Account ids are written by Linkplan's auto pick-up into the same `client_profiles.extra` keys. If Linkplan names
  them differently, only the column map in one server file changes.

### Posting a trial version

Trial reels are an Instagram feature, so:

- **A trial card, "Trial versions" chosen**: one row per approved version (A, B, C...), each with its own video,
  thumbnail and caption from Variantplan's version model, each with a small checkbox (all ticked). Instagram is
  the only network, Trial reel is fixed on, and Facebook, YouTube, LinkedIn and TikTok are off with the reason. One
  press sends one Instagram post **per version**, each with its own key (the press key plus the letter), so a
  re-press after a partial failure resends only the versions that have no post yet.
- **The winner, after the trial**: pick the same card, "Winner" chosen: the composer fills from the winner
  version, with Instagram **unticked** ("Already on Instagram as a trial. Share it to followers in the Instagram
  app.") and the other connected networks ticked.
- **A card without trial** works as any card.
- The upload rows keep `options.card = { post_id, letter }` (JSON, no migration) so the queue reads "Video 15 · B".
  Marking versions "on trial" stays where it is today (the card is set to Posted). See What to cut.

### The two guarantees, for every network

- **One press cannot post twice.** One press key, kept while the form is unchanged (Instagram's rule, now also for
  TikTok). Post for Me family: one post, `external_id` = the key, adopted if an earlier try got no answer. TikTok:
  its own row, key `<press>_tt`. Trial: `<press>_<letter>`. The button is disabled while sending.
- **The account must be the one on the client's profile.** The server reads every ticked network's id from the
  profile, refuses any other, and asks Post for Me that each id is that platform, **before anything is written**
  (today's Facebook rule, `instagram-upload/index.ts:138-149`), for YouTube and LinkedIn as well. The page sends
  only network names; it never sends an id the server trusts.

### Alternatives (each considered, not recommended)

1. **Keep one side per network** (add YouTube and LinkedIn as a third and fourth side). Costs least code (about 3
   fewer pull requests). Buys nothing for the SMM: the same file and caption go in up to five times, and five
   presses are five chances to post to the wrong place. Not recommended.
2. **One new queue table and one function for all five networks, TikTok included in the single Post for Me post.**
   Costs a migration, moving 347 TikTok rows of history, and rewriting the TikTok path that has run cleanly since
   7 October (about 4 more days and the riskiest change in the plan). Buys one queue row per press. Not worth it
   now; the page can group the two tables' rows by press key instead.

---

## 3. Backend

**Tables and columns: no migration.** Everything new lives in JSON columns that already exist, as the carousel and
Facebook did:

- `instagram_uploads.options.networks.{facebook,youtube,linkedin}` = `{ account_id, status, url, error,
  posted_at, config }`. Facebook's existing `options.facebook` is read as before; new rows write both until
  the page reads only `networks` (one PR later). `options.network` names which network the row's top-level
  `account_id` / `status` / `instagram_url` describe when Instagram is not ticked (absent = instagram, so all 16
  existing rows read unchanged).
- `options.press_key` (both tables) groups one press in the queue; `options.card = { post_id, letter }`.
- `tiktok_uploads.options_json` gets the same `press_key` and `card`.
- Rollback: none needed for data; old pages ignore the new keys.

**Edge Functions**

| Function | Change | Lane | Section 4 re-pin |
|---|---|---|---|
| `post-source` (new) | Card or version to Post for Me storage: reads the Frame link from `calendar_posts.asset_url` or `studio_trial_versions.frame_url` (never from the request), staff key only, the client in `INSTAGRAM_UPLOAD_ALLOWED_CLIENTS` (or TikTok's rule), Frame token through the `frameio-token` broker as `frameio-view` does. Reuses `frameio-view/logic.mjs` for the lookup. Writes no table. | merge lane (new function deploys on merge) | none |
| `instagram-upload` | Account map per network; `platformMismatch(acct, want)` for youtube and linkedin; YouTube and LinkedIn configuration builders; per-network results generalised from Facebook's. | merge lane | none |
| `tiktok-upload` | none (the stable key is a page change) | – | – |
| `trial-reels`, `production-write`, `frameio-view`, `calendar-upsert` | none | – | none |

Secrets: none new. `post-source` uses the existing `POST_FOR_ME_API_KEY`, `FRAMEIO_BROKER_KEY`, `FRAMEIO_CLIENT_ID`.
YouTube and LinkedIn need no new key: they are accounts on the same Post for Me key (confirm with Linkplan).

---

## 4. Screens

House rules kept: no coloured left edges; skeletons match the real layout; hover lights only the row under the
pointer; the card picker is a sheet with a Back button.

### Composer, 1440 wide

```
Post                                                               [ Queue (3) ]
Client  [ test client          v ]
Post to  [x TikTok] [x Instagram] [x Facebook] [ YouTube ] [ LinkedIn  not connected ]
+-- Media -------------------------------------------+  +-- Preview -------+
| ( From a card )  ( From files )                     |  |  +----------+    |
|  Video 15  ·  Tue 4 Nov                 [Change]    |  |  |          |    |
|  video_15_final.mp4  ·  1080x1920  ·  84 MB  ·  42s |  |  |   9:16   |    |
|  Thumbnail  ok      Caption  ok                     |  |  |          |    |
+-----------------------------------------------------+  |  +----------+    |
+-- Caption ------------------------------------------+  |  Will be a Short |
| [ text ...                                        ] |  +------------------+
| 1,204 / 2,200 (Instagram)                           |
+-----------------------------------------------------+
+-- TikTok ------- Privacy [ pick one v ]  Comments [ ] Duet [ ] Stitch [ ] ---+
+-- Instagram ---- Cover: card thumbnail   Trial reel [ ]                      -+
+-- YouTube ------ Title [ first line...  ] 38/100  Privacy [Public v]  Kids [No v] +
+-- When --------- (o) Post now   ( ) Schedule [date] [time] [zone]          -+
                                           [ Post to 3 networks ]
```

### Composer, 390 wide

```
Post
[ test client      v ]
Post to
[x TikTok] [x Instagram]
[x Facebook] [ YouTube ]
[ LinkedIn · not connected ]
-- Media --
( From a card ) ( From files )
[ thumb ] Video 15 · 4 Nov
          84 MB · 42s  [Change]
-- Caption --
[ text ...            ]
1,204 / 2,200 (Instagram)
> TikTok settings        (collapsed rows, each opens in place)
> YouTube settings
-- When --
(o) Now ( ) Schedule
[ Post to 3 networks ]   (sticky at the bottom)
```

### Card picker (sheet; full screen with Back at 390)

```
< Back      Pick a card                         [ search ]
[thumb] Video 15   Tue 4 Nov   Approved
[thumb] Video 16   Thu 6 Nov   Scheduled   Trial · 3 versions
[thumb] Video 17   no date     Approved
```

A trial card opens a second step: `( Main video )  ( Trial versions )  ( Winner )`, only the ones that apply.

### Trial versions

```
Video 16 · trial · Instagram only
[x] A  [thumb] "Hook one..."     58 MB   ok
[x] B  [thumb] "Hook two..."     61 MB   copying 40%
[x] C  [thumb] "Hook three..."   --      Frame link missing  (unticked, cannot tick)
Facebook, YouTube, LinkedIn, TikTok: off (trial reels are an Instagram feature)
                                  [ Post 2 trial reels ]
```

### States, every screen

| State | What shows |
|---|---|
| Empty (no client) | Client box only, "Pick a client to see where they can post." |
| No networks connected | Chips all off with "not connected"; one line: "No accounts on this client's profile yet." |
| Card list loading | Three skeleton rows the height of a real row (thumbnail, name, date). |
| Card list empty | "No Approved or Scheduled cards from today on. Drop files instead." |
| Copying from Frame | The media card shows the file name and a progress line; Post is disabled until copied. |
| Copy failed | Plain reason (link not shared, still processing, too large, Frame busy) and "Try again" / "Download from Frame". |
| One network | Button says "Post to Instagram". |
| Many networks | "Post to 3 networks"; after, the queue row shows one line per network (Posted, Failed with reason, Scheduled). |
| Partial failure | The row is under Failed; "Try again" resends only the failed networks (same key, server adopts what is done). |
| Folder dropped | A short summary: "Video, cover and caption found. Ignored 1 file: .prproj". |
| Several videos in folder | A pick list in name order. |

---

## 5. Build order (each PR ships alone and can be the last one)

Flags: `post_sources_v1` (card and folder sources) and `post_networks_v1` (YouTube, LinkedIn, the composer chips),
both `{ "clients": [test client] }` first, then `"all"` on the owner's go.

1. **`post-source` function (spike + function).** Server only, no page. Proves: streamed copy from Frame to Post for
   Me storage, its time and size limits; picks route (a), (b) or (c) above and writes the measured numbers into
   this plan. Tests: logic tests for refusals (no staff key, client not allowed, card of another client, link
   missing, too large) that fail before (no function) and pass after. Live: one copy of a test-client card, and the
   returned `media_url` opened. Could break: nothing; nothing calls it yet.
2. **"From a card" takes the video, on the Instagram side** (flag `post_sources_v1`). The picker gains the video;
   the thumbnail is copied server side. Tests: browser test with mocked functions: pick a card, the video line and
   preview appear, the post body carries the copied `media_url`; with the flag off, today's picker exactly. Live:
   one scheduled-then-cancelled Instagram post from a test-client card. Could break: the cover-from-card path (kept
   as the fallback when `post-source` refuses).
3. **The same on the TikTok side, plus TikTok's stable press key.** Tests: a re-press with an unchanged form sends
   the same key (fails today at `300:1449`). Live: one scheduled-then-cancelled TikTok post from a card. Could
   break: TikTok's carousel and draft restore (covered by `tiktok-carousel-browser-journey.js`).
4. **Folder drop, both sides** (same flag). Pure sorting function with unit tests (the cases in section 2), then the
   drop zones call it. Live: drop a folder of video, thumbnail and caption on the test client. Could break: single
   file drop (kept as is when the drop holds no folder).
5. **`instagram-upload` learns YouTube and LinkedIn** (server only). Account map, platform check, config builders,
   per-network results. Tests: extend `test/instagram-facebook-crosspost.js` style for each network: wrong account
   refused, wrong platform refused, both checked before any write, same key returns the same post. Live: none
   until a YouTube or LinkedIn account is on the test client. Could break: Instagram + Facebook (its tests must stay
   green unchanged).
6. **The composer chips + YouTube and LinkedIn fields** (flag `post_networks_v1`), on the Instagram side's form.
   Live: one YouTube Short as Private and one LinkedIn post on the test client's own accounts, then deleted.
   Could break: the Instagram form layout at 390 (phone guards in `qa/staff-phone-*`).
7. **Trial versions from a card.** Needs Variantplan's version caption and thumbnail. Tests: N versions make N rows
   with keys `<press>_<letter>`; a re-press after one failure resends only that one; other networks cannot be ticked.
   Live: two versions of a test-client trial card posted as trial reels, scheduled then cancelled.
8. **TikTok as a chip in the composer.** The TikTok fields become the composer's TikTok section, sending to
   `tiktok-upload` with `<press>_tt`. The old switch stays reachable while the flag is off. Live: one press to
   TikTok + Instagram on the test client.
9. **(Later, after two clean weeks) remove the old switch.**

---

## 6. What could break elsewhere

- **Review boards (Kasper's, the client's):** nothing changes; the Post tab only reads cards and versions.
- **Status sync and the drift robot:** nothing is written to cards, work items or deliverables. The card is still
  set to Posted by a person or `calendar-auto-posted`.
- **Sheet copies:** new account ids live in `client_profiles.extra`, not Clients Info columns, so no Sheet copy (as
  for Facebook). If Linkplan adds Sheet columns, the `roster-write` rule in CLAUDE.md applies.
- **Production tab:** untouched. Section 4 functions: untouched, no re-pin.
- **Posting itself (the real risk):**
  - the card's Frame link points at an old cut: the preview, the Frame file name and its upload date are shown
    before the press;
  - Frame's `high_quality` copy is not ready (still processing): refused with Frame's reason, no post;
  - a big file times out the copy: refused with "Download from Frame and drop it" (route c);
  - the same Post for Me media address in a TikTok post and a multi-network post: to be confirmed in PR 1 (else mint
    one per post);
  - Frame rate limits (429) when copying seven versions at once: copy one at a time, with the same 429 retry as #2498.
- **Trialchange's Safari work:** not touched; the preview here is a plain `<video>` on the `efficient` copy.

---

## 7. What to cut (for now)

- **Several folders at once / batch posting.** One post per press is the guarantee we trust; batches multiply the
  ways to post the wrong thing.
- **Matching a folder of versions to letters.** Variantplan builds that for the Frame folder; trials post from the
  card instead.
- **The Post tab marking the card Posted or versions "on trial".** It would write card status from a new place and
  touch the status sync; today's button and the auto-posted timer stay.
- **YouTube long-form extras** (custom thumbnail on long videos, playlists, tags, category). Shorts first.
- **Different files per network** (a landscape cut for YouTube). One video per press.
- **Folder picking on phones.** Phones use "From a card".
- **The Frame `original` as the default.** Full HD is the `high_quality` copy; originals are often HEVC or huge.

---

## 8. Questions for Sidney (a "yes" takes the recommendation)

1. **One composer with network chips** (tick TikTok, Instagram, Facebook, YouTube, LinkedIn, one press), instead of
   one side per network? *Recommended: yes.*
2. **"Full HD" = Frame's high-quality copy** (1080p H.264), not the original upload, and the file goes Frame to
   Post for Me server to server, never through the SMM's computer or phone? *Recommended: yes.*
3. **Trial versions go to Instagram only, as trial reels; the winner later goes to TikTok, Facebook, YouTube and
   LinkedIn from the same card, with Instagram unticked** (it is shared to followers in the Instagram app)?
   *Recommended: yes.*
4. **YouTube defaults: Public, Not made for kids, title = the caption's first line; Shorts only for now?**
   *Recommended: yes.*
5. **LinkedIn: one account per client, whichever you connect (a company page or the founder's profile)?**
   *Recommended: yes.*

---

## 9. Size

9 pull requests (the ninth is a later clean-up). About **11 to 13 working days** including tests and one live check
each: PR 1 1.5, PR 2 1.5, PR 3 1, PR 4 1.5, PR 5 1.5, PR 6 2, PR 7 1.5 (after Variantplan's version fields land),
PR 8 1.5, PR 9 0.5. PRs 1 to 4 deliver item 3 on their own; PRs 5 and 6 deliver YouTube and LinkedIn; PR 7 is the
trial half.

---

## Lining up with the other plans

- **Variantplan:** PR 7 needs each version to carry its own video link, thumbnail and caption, readable by
  `(client, post_id, letter)` from the server. If versions become rows of their own (copies of the card),
  `post-source` reads those instead; only its read changes.
- **Linkplan:** this plan assumes account ids at `client_profiles.extra.postforme_<network>_account_id` and asks it
  for five Post for Me / Frame facts (media address rules, upload size and life, YouTube and LinkedIn fields, Frame
  originals). Answers will be folded in here.

Skills used: none of the named skills (karpathy-guidelines, frontend-design, interface-design, Hallmark, Emil
Kowalski, taste-skill) is installed in this session; their rules were applied by hand (measure first, simplest
route, surgical PRs with a check each; every state at 1440 and 390, house UI rules).
