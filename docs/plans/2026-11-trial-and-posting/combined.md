# Trial versions, posting and Post for Me accounts: the combined plan

Session Cutplan, 2026-11-02. **Plan only: no code, no migration, no deploy, no data change in this PR.**
One skeptical pass over three draft plans, and one build order for all of them:

- `variants.md` (Variantplan, #2521): trial versions with their own thumbnail and caption, Frame folder import, the SMM
  setting a version's status from the calendar.
- `posting.md` (Postplan, #2522): a card's full-HD video sent server to server, dropped folders, YouTube and LinkedIn,
  posting trial versions.
- `links.md` (Linkplan, #2523): Post for Me accounts linked to clients without copying ids; YouTube and LinkedIn slots;
  the Post for Me and Frame.io API facts.

Where this page and a sister plan disagree, this page wins. The sister plans stay as the detailed reference for the
parts kept here (screens, states, API quotes).

**The short version.** The three plans add up to 21 PRs and 23 to 28 working days. This plan keeps what Sidney asked
for and cuts the rest: **15 PRs, about 20 to 21.5 working days of build, about two calendar weeks** when the three
tracks run side by side. **First, on its own: F0, the Frame wrong-video fix** (section 4), because today a client
could approve, and a post could send, the wrong video. Two migrations, no Section 4 function touched, so no fingerprint re-pin. The biggest cuts:
the all-in-one composer that also swallows TikTok (Postplan PRs 8 and 9), the separate Post for Me accounts page
(replaced by a Pick list on the Publishing card), the review-page thumbnail strip, Production's per-version rows,
moving the trial switch on the card, and the "disconnected account" refusal.

Skills: karpathy-guidelines and the front-end skills are **not installed in this session** (only
`session-start-hook` is). Their rules were applied by hand: think before proposing (every "exists today" claim below
was re-measured), the simplest thing that does the job (reuse what exists, cut what nobody uses in the first month),
surgical changes (one concern per PR), and a check that proves every step (a test that fails before and passes after,
plus one live check on `sidneylaruel`). House UI rules carried into every screen PR: no coloured left-edge
highlights, skeletons match the real layout, a hover lights only what is under the mouse, every opened page has a
Back button.

---

## 1. Claims checked (2026-11-02, `origin/main` 604406e and read-only SQL)

Re-measured and **right**:

| Claim | Plan | Measured |
|---|---|---|
| 52 switch rows, 34 on, 161 versions all linked to a card, 5 winners, 1 real client card on | Variantplan | 52 / 34 / 161 / 161 / 5 / 1 |
| `trial-reels` actions list and client-link actions | Variantplan | `logic.mjs:20-22`, as written |
| `frameio-view` plays the wrong video for a `/share/<id>/view/<file>` link (two causes) | Variantplan, supervisor | `frameio-view/logic.mjs:149-153`: (a) the file id is looked for only among the share's **top-level** assets, so a file inside a shared folder is never found; (b) the share's assets are read **without a page size or paging**, so a file past the first page is never found either. Both then fall back silently to `list[0]`, the folder's first video. Latent today: 0 of 3 real-client version links and 0 of 156 test-client links have that shape (supervisor, read-only) |
| `calendar-card-write` already allows `thumbnail_url` and `caption` | Variantplan | `calendar-card-write/logic.mjs:15-16` |
| No browser role can read `studio_trial_versions` or `trial_reel_cards` | Variantplan | no grant to `anon`, `authenticated` or `public` on either |
| Drop zones read `files[0]`; the server takes media only on `data.postforme.dev` | Postplan | `299:762`, `instagram-upload/logic.mjs:7` |
| TikTok mints a fresh press key on every press | Postplan | `300-tiktok-upload.js.part:1449` (`crypto.randomUUID()` inside the press) |
| `frameio-view` returns `efficient`, `high_quality`, `original` | Postplan | `frameio-view/index.ts:8` |
| 41 active clients; TikTok id 13, Instagram id 4, Facebook Page 2, YouTube/LinkedIn 0 | Postplan, Linkplan | 41 / 13 / 4 / 2 / no slot |
| No duplicate Post for Me id across clients | Linkplan | 0 for TikTok and Instagram **across all 41 rows**; there are no archived rows today, so Linkplan's open precheck is already answered: zero |
| `client-profile-write` checks an Instagram/Facebook id against Post for Me and never passes the account body on | Linkplan | `client-profile-write/index.ts:183-201`: reads `platform` only, errors carry no body |
| SyncView is the main copy of client profiles, so extra keys can be saved | Linkplan (implied) | `client_profiles_authority` = `{"source": "syncview"}` |
| Both `migrations/` and `supabase/migrations/` trigger the merge lane's migration hold | Linkplan | `deploy-edge-functions-on-merge.yml:43-44` |

**Wrong or missing** (none changes a recommendation, but each would have cost a cycle):

1. **The test client has no Post for Me account on any network** (measured: zero ids on `sidneylaruel`). Linkplan
   says so; **Postplan's live checks for PRs 2, 3, 6, 7 and 8 assume it can post from `sidneylaruel` and cannot run
   as written.** It also has to be in the `INSTAGRAM_UPLOAD_ALLOWED_CLIENTS` secret. This is question 6 below and a
   prerequisite of every posting PR's live check.
2. **Versions already have a `hook` column, and it is empty on all 161 rows.** Postplan describes each version as
   having "its own `frame_url` and hook"; in practice no version has a hook. Variantplan does not mention the column.
   Settled in section 2 (it is not the caption).
3. **Variantplan's PR 2 (SMM status menu) is listed as independent, but it writes `client_ok_by` and `change_part`,
   which only exist after its PR 1 migration.** It waits for the migration to be applied, not just merged.
4. **Variantplan: "`trial-reels` (651 lines, rules in `logic.mjs`)"**: 651 is `index.ts`; `logic.mjs` is 588. Cosmetic.
5. **Postplan's counts drifted by one since it measured** (`tiktok_uploads` 348, 106 in 30 days). Not wrong, just live.
6. **The Safari fix Variantplan's PR 6 waits for is not merged and not yet a fix**: open is #2513, a draft *repro*
   ("do not merge"), plus #2517 on the review stage's strip watcher. The review-page PR below waits for the actual
   fix PR, not for #2513.

---

## 2. Where the plans disagree or overlap, settled

| # | Point | Settled | Why |
|---|---|---|---|
| 1 | A version's caption: new `caption` column, or the existing `hook`? | **New `caption` and `thumbnail_url` columns (Variantplan). `hook` stays as it is, unused by these features.** | `hook` is capped at 300 characters and belongs to the studio's hook bookkeeping (`hook_type` beside it); a caption runs to thousands. Reusing it would make the studio and the calendar disagree about what the field means. |
| 2 | Empty fields | **`coalesce(version.field, card.field)`; version A is the card itself** (all three plans agree). | No backfill; every existing version already reads right. One rule, pinned by `trial-reels` tests, read by `post-source` through the same shared module. |
| 3 | Who owns the Frame fetch | **`frameio-view/logic.mjs` is the one Frame reader.** The folder-share fix and the folder `list` land first (PR F1). `post-source` imports that module; it does not get its own Frame code. | One place to fix Frame bugs. Postplan's "the exact file or nothing" rule becomes a `strict` option of the same lookup: the player keeps today's fallback (a folder link still plays something), `post-source` passes `strict` and refuses. |
| 4 | Which version posts where | **Trial versions: Instagram only, as trial reels. The winner: the other networks, with Instagram unticked.** (Variantplan and Postplan agree; question 3 confirms.) | Trial reels are an Instagram feature; the winner is already on Instagram. |
| 5 | Who marks versions "on trial" | **Unchanged: setting the card to Posted, as today.** The Post tab never writes trial state. | One writer for trial state; a scheduled trial reel is not live when the button is pressed. |
| 6 | One matcher or two | **One: the Frame folder import (versions).** A dropped local folder is a Post tab source only and never fills versions. | The review boards play versions from Frame; a local file has no Frame link. |
| 7 | Account id keys | **TikTok: column `postforme_account_id` (unchanged). Instagram, Facebook, YouTube, LinkedIn: `client_profiles.extra.postforme_<network>_account_id`.** | All three plans already agree; written here so the build sessions do not re-decide it. |
| 8 | The composer | **No all-in-one composer this round.** YouTube and LinkedIn are added as ticks on today's Post for Me side ("Post to: Instagram, Facebook, YouTube, LinkedIn"), the way "Also post to Facebook" works now. TikTok keeps its own side. | Postplan's composer rewrites the TikTok path that has posted 348 times cleanly since 7 Oct, for a gain nobody needs in month one (0 clients have YouTube or LinkedIn). Instagram becomes untickable on that side so the winner can go to Facebook/YouTube/LinkedIn only. |
| 9 | Linking accounts | **A Pick list on each Publishing card field** (Kasper > Clients), not a separate page with three tabs. It lists that network's Post for Me accounts not on another client, pre-selects an exact handle match, and saves only on a click. | Same safety as Linkplan's page (a person confirms, a unique index refuses doubles), one screen instead of a new page, no new Back-button page to test. The "3 new" count waits. |
| 10 | Flags | **Three:** `trial_versions_v2` (Variantplan), `post_sources_v1` (card and folder sources), `post_networks_v1` (YouTube/LinkedIn ticks, Instagram untickable). Linkplan's `pfm_account_link_v1` is dropped: the Pick list is admin-only and writes through today's save path. All three flags: `{"clients": ["sidneylaruel"]}` first, `"all"` on Sidney's go. None of the three keys exists live today (checked). | Fewer flags, each covering one thing a person would switch off. |
| 11 | Order | Foundations (Frame reader, two migrations, `post-source` spike) first, in parallel. Version fields before trial posting. Slots before YouTube/LinkedIn posting. The review-page PR waits for Trialchange's fix. | Each later PR then only adds a screen on top of a proven server piece. |

---

## 3. The cut

What stays answers each thing Sidney asked for; what waits is either a second way to do something already covered,
or something nobody can use in the first month.

**Kept (15 PRs)**

| Sidney asked for | PRs |
|---|---|
| Trial versions with their own thumbnail, caption and video | F2, V3, V4 |
| Frame folder import with a matching step | F0, F1, V2 |
| SMM sets a trial version's status from the calendar | V1 |
| A card's video pulled from Frame in full HD, server to server | F4, P1 |
| Drop a folder on the Post tab | P2 |
| Post trial versions | P4 |
| YouTube and LinkedIn as destinations | F3, P3 |
| Post for Me accounts reach SyncView without copying ids | F3, L1 |
| (bugs found on the way) Frame link plays the wrong video; TikTok can post twice after a lost answer | F0, P0 |

**Waits, and why**

| Cut | From | Why it waits |
|---|---|---|
| All-in-one composer, TikTok as a chip, removing the old switch | Postplan PRs 8, 9 and most of 6 | Rewrites the busiest posting path for convenience only; ticks on today's side give YouTube/LinkedIn now. Revisit after a month of multi-network posting. |
| Separate Post for Me accounts page with Waiting/Linked/Disconnected tabs, the "3 new" count | Linkplan PR 3 | The Pick list on the Publishing card does the job in an existing screen. |
| Refusing disconnected accounts before posting | Linkplan PR 4 | Post for Me already fails such a post and the queue shows the reason; a nicer message is not month-one work. |
| Version thumbnail strip on the review page | Variantplan PR 6 (part) | Today's arrows and dots already move between versions; the strip is new layout on the most fragile surface (Safari, review boards). The page shows each version's own thumbnail and caption, which is the ask. |
| Moving the Versions switch from the Video row to the card footer | Variantplan PR 5 (part) | Pure placement; risks the card-height and Sheet-fit guards. Version rows grow thumbnail and caption fields where they are. |
| Production per-version thumbnail rows | Variantplan PR 7 | Designers can work from the card; the plan itself marked it optional. |
| Filter box in the import list, paging past 50, project (non-share) folder links | Variantplan | Rare; a clear message covers them. |
| A separate closing "flag on for all + docs" PR | Variantplan PR 8 | Each PR updates its own docs; turning a flag on is a one-row change on Sidney's go, not a PR. |
| Webhook, Connect-from-SyncView, Slack nudge | Linkplan (already cut) | Agreed. |
| YouTube long-form extras, per-network files, batch posting | Postplan (already cut) | Agreed. |

**Size:** 15 PRs, **about 20 to 21.5 working days of build**, roughly two calendar weeks with three tracks in parallel
(section 4). Was 21 PRs and 23 to 28 days.

**Safe stopping points.** After F0 alone: no link can play or post the wrong video. After F1+V1+V2: Sidney has the SMM status menu and the Frame import. After P0+F4+P1+P2:
item 3 is done. After V3+V4: versions with their own thumbnail and caption are reviewed end to end. YouTube/LinkedIn
(F3, L1, P3) and trial posting (P4) are last because their first real use depends on accounts being connected.

---

## 4. Build order

Three tracks. **V** = versions (Variantplan), **P** = posting (Postplan), **L** = accounts (Linkplan). F = shared
foundation. Every PR: `node scripts/repo-identity-exposure-check.js --diff=origin/main` after committing; any page
PR touching Calendar or Production write surfaces also runs `node docs/syncview-design/tests/prod-write-gateway-browser.js`.
Fixtures that open Month or Week use relative dates or a pinned clock (CLAUDE.md). Live checks on `sidneylaruel`
only; posting live checks use scheduled-then-deleted posts on its test accounts (question 6).

| # | Track | PR | Waits for | Proof (fails before, passes after) | Live check on `sidneylaruel` | Migration / re-pin | Days |
|---|---|---|---|---|---|---|---|
| **F0** | all | **Ships first, alone.** `frameio-view`: a `/share/<id>/view/<file>` link finds its file by paging through every page of the share's assets (`links.next`) and looking inside shared folders (and version stacks); if the named file is still not found, it **refuses** (`file_not_in_share`, plain message: "This link's video is not in the share any more; paste the video's own link") instead of playing the first video. A link that names no file (a bare folder share) keeps today's "first video" behaviour for the player. Server file and its test only; no flag (a correctness fix, and refusing is the safe side) | nothing | `test/frameio-view-*`: with mocked Frame answers, a file inside a shared folder plays that file, and a file on page 2 of a share plays that file, **both fail on today's code** (they get the first video); an unknown file id is refused, not swapped; every existing frameio-view test unchanged | a test-client share with a folder of two videos: the second video's link plays the second video in the client player | none | 0.5 |
| **P0** | P | TikTok keeps one press key while the form is unchanged (Instagram's rule). No flag: it is a bug fix | nothing | browser test: two presses with an unchanged form send the same key (fails today at `300:1449`); a changed form gets a new key | one scheduled TikTok post pressed twice after a forced reload: one row, then delete it | none | 0.5 |
| **F1** | V, P | `frameio-view` (on top of F0): `part: "list"` (staff key, up to 50 videos, name, length, Frame thumbnail, per-file link); `strict` lookup option. Read-only | nothing | F0 | `logic.mjs` tests with mocked Frame: a folder of 6 videos + 2 images lists 6; a folder past one page lists all (up to 50); `strict` refuses a bare folder link; today's frameio-view tests unchanged | list one test folder | none | 0.75 |
| **F2** | V | Migration: `studio_trial_versions` gains `thumbnail_url`, `caption`, `change_part`, `client_ok_by`; cope marker; grants read back for all four roles | nothing | migration test: columns exist, no browser role gained a privilege | Lighthouse applies; read-back SQL | **migration** (cope marker, so `trial-reels` still deploys) | 0.5 |
| **F3** | L | Migration: `client_profile_admin_edit` allows the YouTube and LinkedIn keys; unique partial index per slot (all five); `client-profile-write` checks YouTube/LinkedIn and the TikTok column against Post for Me on save; Publishing card shows the two fields (paste box) | nothing | proof SQL on a disposable Postgres: a second client with the same id is refused on every slot; rollback restores the 2026-10-31 body; field-list tests | paste a YouTube id on the test client: saved and checked; same id on a throwaway test client: refused | **migration** (holds `client-profile-write` until applied unless the build proves it copes) | 1 |
| **F4** | P | `post-source` (new function): spike + function. Card or version to Post for Me storage, server to server, `high_quality` rendition, uses F1's module with `strict`. Picks route (a) stream, (b) Frame-host-only URL handed to Post for Me, or (c) "Download from Frame" fallback, and writes the measured numbers into `posting.md` | F1 merged (or rebases on it) | refusal tests (no staff key, client not allowed, card of another client, folder link, too large) | one copy of a test-client card; the returned media address opens | none (new function deploys on merge) | 1.5 |
| **V1** | V | SMM status menu on each version row (Approved by client, Change asked with part, Dropped, Back to waiting); `trial-reels` `smm_set` | F2 **applied** | `trial-reels` tests: `smm_set` unknown before, works after for SMM/admin; creative and client refused; event row written; card approves only when every live version has the OK, per stage | mark B approved as SMM on a test trial card; client link shows "Approved · by SMM"; Kasper's queue drops it | none | 1.5 |
| **V2** | V | Import from a Frame folder (sheet with Back): paste share link, list, letter picker, all-or-nothing `versions_import` | F1 | browser test with mocks: paste, list, pick; a duplicate letter cannot be set; a refusal writes nothing | import three videos into a test trial card | none | 1.5 |
| **V3** | V | Version thumbnail and caption on the card (fields in today's version rows; empty = "Same as the card"); `version_fields_set`; `effective` in reads; winner copies thumbnail and caption to the card through `calendar-card-write` with `updated_at`, Undo puts A back | F2 applied | function tests: null reads as card, set field wins, winner copy and Undo; browser test at 1440 and 390; card-height guard unchanged with the flag off | give B its own thumbnail and caption; pick B as winner; Undo | none | 2 |
| **V4** | V | Review page (client link, SMM Review, Kasper): each version shows its own thumbnail and caption; one Approve covers the version's parts; Ask for a change picks the part | V3, **Trialchange's Safari fix PR merged** (not #2513, which is a repro) | review-stage tests: approving every version calls today's approve on each part exactly once; a thumbnail change reaches the graphic part; a failed versions read falls back to today's page | walk SMM, Kasper and the client link on a test trial card at 1440 and 390, in WebKit too | none | 2 |
| **P1** | P | "From a card" takes the video, both sides (Instagram and TikTok), behind `post_sources_v1`; thumbnail copied server side; preview is a plain `<video>` on the `efficient` copy | F4, P0 | browser test with mocks: pick a card, the media line shows the Frame file name and size, the post carries the copied address; flag off = today's picker exactly | one scheduled-then-deleted post per side from a test card | none | 2 |
| **P2** | P | Folder drop, both sides (same flag): a pure sorting function, then the drop zones call it | P1 (shares the media line) | unit tests for every case in `posting.md` section 2 (one of each; several images; several videos; hidden files; two folders refused) | drop a folder of video, image and text on the test client | none | 1.5 |
| **L1** | L | Pick list on each Publishing card account field: admin-only `pfm_accounts` action in `client-profile-write` (whitelisted safe fields, which client has each, exact-handle suggestion); Link saves through today's update with `expected_updated_at` | F3 applied | unit tests: the answer never contains `access_token` or `refresh_token` at any depth; two-client match gives no suggestion; a taken slot gives none; `tiktok_business` reads as TikTok. Browser test of the picker states | link the test client's account from the list, see it on the card and in the history row, then clear it | none | 1.5 |
| **P3** | P | YouTube and LinkedIn: `instagram-upload` account map, platform check before any write, config builders, per-network results; Instagram may be unticked; ticks and YouTube fields (title, privacy, made-for-kids per client) on the form, behind `post_networks_v1` | F3 applied, P1 | handler tests: wrong account and wrong platform refused before any write; same key returns the same post; **every existing Instagram + Facebook test passes unchanged** | one Private YouTube Short and one LinkedIn post from the test client, then deleted (needs those test accounts) | none | 2 |
| **P4** | P | Post trial versions from a card: one row per approved version from the `effective` set, Instagram only, Trial reel fixed on, key `<press>_<letter>`; a winner card opens with Instagram unticked | V3, P1 (P3 for the winner's other networks) | tests: N versions make N posts with distinct keys; a re-press after one failure resends only that one; other networks cannot be ticked | two versions of a test trial card as scheduled-then-deleted trial reels | none | 1.5 |

**Parallel lanes.** Day 1: F0, P0, F2, F3 start together (no shared files); F0 merges first. F1 starts on F0, and
F4 starts with F1 and rebases on it.

**F0 and Trialchange's Safari work do not collide.** Trialchange's open branches (#2513, a phone-suite repro, and
#2517, the review stage's strip watcher) change only test files and the page (`195-review-stage.js.part`); the
Safari error is on the page side of the player. F0 changes only `supabase/functions/frameio-view/logic.mjs` and its
server test, and keeps the function's answer shape (one new refusal code). If Trialchange's fix turns out to need
`frameio-view/logic.mjs` too, F0 lands first (it is half a day) and Trialchange rebases; the page treats the new
refusal like today's `link_not_found`, so no page change is needed for it. Then V1 (after F2 applied) runs beside V2 (after F1) and P1 (after F4). L1 runs whenever F3 is applied. V4 waits
for Trialchange; if that slips, V4 is the only PR that slips, everything else ships.

**Must wait, in one line each.** V1 and V3 wait for F2 to be **applied**, not merged. L1 and P3 wait for F3
applied. V4 waits for Trialchange's Safari fix to merge. P4 waits for V3 and P1. P2 waits for P1. Do not merge
anything while a Section 4 release is running (none of these PRs starts one).

**Migrations (two).** F2 (`supabase/migrations/…_trial_version_fields.sql`, cope marker, `trial-reels` deploys
anyway) and F3 (the client-profile slots and unique indexes; holds `client-profile-write` until Lighthouse applies
it and re-runs the merge lane with `migrations_applied = true`, unless the build proves the function copes and adds
the marker). Each migration names `anon`, `authenticated`, `public` and `service_role` when it reads grants back.

**Section 4.** No PR touches `production-write`, `deliverable-write` or `batch-write`: **no fingerprint re-pin.**
`calendar-upsert` (frozen) is not touched. No n8n workflow is touched.

---

## 5. Risks

| Area | What could break | Guard |
|---|---|---|
| **Review boards** | An approve that counts wrong moves a trial card to Approved early or never; the SMM's "approved by client" makes a version skip Kasper unnoticed | `trial-reels` stays the only judge of "every live version has this OK"; the page calls today's approve only on its word; every board shows "by SMM"; a failed versions read falls back to today's page. V4 is the riskiest PR and goes last on its track, after the Safari fix |
| **Status sync** | A version change writing `video_status` / `graphic_status` / `caption_status` outside today's saves | No version action writes card statuses; parts move only through today's approve and tweak paths |
| **Drift robot** | Raw SQL seeding of statuses on a linked card (OPEN_REPAIRS 373) during live checks | Live checks use the UI on a throwaway unlinked test card, never SQL on a card linked to Production work |
| **Sheet copies** | The Instagram id is a Clients Info column, so linking one from the Pick list must send the copy | L1 saves through `client-profile-write`, which sends the queue (a direct RPC would only queue it). YouTube, LinkedIn and Facebook ids are not Sheet columns. Calendar versions never reach a Sheet |
| **Production tab** | New work items or attachments appearing per version | None added; the winner's video still goes through today's attachment, which needs no Section 4 change |
| **Posting** | Wrong file (old cut, a link resolving to the folder's first video, fixed first by F0); wrong account (another client's); double post; Frame copy not ready or too large; Edge Function time or memory limit on a 150 MB copy | Preview with Frame file name and date before the press; `strict` lookup refuses folder links; the server reads every account id from the profile and checks its platform before any write, plus the new unique index; one press key per unchanged form on both sides (P0); F4 measures the limits and keeps "Download from Frame" as the fallback. If route (b) is chosen, the server's media check widens to Frame's own media host only, never to any https address |
| **Rate limits** | Frame (100 calls a minute per user) when listing or copying seven versions; the platform limit seen on 2 Nov | One copy at a time with the #2498 429 retry; the import is one listing per click, staff only |
| **Access tokens (Linkplan's caution)** | Post for Me's account list returns each client's social `access_token` and `refresh_token` | `pfm_accounts` copies named safe fields out (a whitelist, never deleting known bad keys); the raw body is never logged, stored, returned in an error or put in a test fixture; a test walks every key of the answer at every depth. The single-account check already used on save reads only `platform` and returns no body (measured). Sidney sends no key to anyone; nothing new is needed |
| **Public repo** | Client handles in fixtures or in the import list | Invented handles in tests; scripts print counts; the identity-exposure check runs on every PR |

---

## 6. Questions for Sidney (a "yes" takes the recommendation)

The three plans asked 14. The rest are settled above by the plans themselves (version A is the card; one version at a
time with arrows; import videos only from a share link; admins only link accounts; a client Connect link waits;
LinkedIn takes whichever account is connected).

1. **When the SMM marks a version "Approved (the client told me)", may it count as the client's OK and skip Kasper's
   step for that version, with "by SMM" shown on every board and the SMM's name logged? And does one Approve cover a
   whole version (video, thumbnail and caption), while a change is asked on one part?** Recommended: yes to both.
2. **"Full HD" means Frame's high-quality 1080p copy, sent from Frame to Post for Me server to server, never through
   the SMM's computer or phone; if a file is too big for the server, the SMM is told to download it from Frame and
   drop it in.** Recommended: yes.
3. **Trial versions post to Instagram only, as trial reels; the winner later posts to TikTok, Facebook, YouTube and
   LinkedIn from the same card, with Instagram unticked.** Recommended: yes.
4. **New Post for Me accounts appear in a Pick list on the client's Publishing card, with an exact handle match
   pre-picked, and nothing links until someone clicks.** (No automatic linking: a wrong guess posts on another
   client's account and cannot be undone.) Recommended: yes.
5. **YouTube and LinkedIn are added as ticks on today's Post form, built last in this round; the all-in-one composer
   that also takes over TikTok waits a month.** YouTube posts Public, title = the caption's first line, Shorts only,
   "made for kids" asked once per client and remembered. Recommended: yes.
6. **To prove posting live, please connect one throwaway test account per network (Instagram and TikTok now, YouTube
   and LinkedIn before P3) in Post for Me, so we can link them to the test client and add it to the posting allow
   list.** Today the test client has no Post for Me account at all, so no posting PR can be checked live without
   this. Recommended: yes; it is a one-time sign-in, not a deploy.
