# The remaining move off Sheets: measured map and slices

Cartographer. Plan date **2026-10-03**; read-only evidence collected **2026-10-02**,
approximately 20:00–20:35 UTC (14:00–14:35 America/Guatemala). Source baseline:
`client-analytics` main `eb7b743e`; `synchro-pipelines` main `e1a8655`.

**Scope: the main SYNCVIEW Sheet and the SyncView Calendar workbook, every tab,
including hidden and empty tabs.** 20 + 64 = **84 tabs**. Other Drive files,
including Project Central, client idea Sheets, filming-plan Docs and the older
video-automation workbook, are excluded. Existing instructions about archiving
Project Central belong to a separate owner-approved action. Nothing live was
changed, no workflow was executed or edited, and no message was sent.

## What is done, and what is still connected

| Work | Measured state | Remaining work / session |
| --- | --- | --- |
| Metrics and TopVideos browser reads | **DONE:** both analytics mirror flags are enabled. `analytics-read` v20 and `analytics-write` v17 are deployed; 5,420 Metrics and 59,603 TopVideos rows are stored. All five datasets passed the existing strict parity check on retry. | Sheet fallbacks, daily copy/parity and the n8n collectors still connect them to Google. Browser migration is done; removing Google from their producers is not. Harbor owns the collector sequence. |
| Clients Info and Social Media Managers | **IN PROGRESS, Roster.** Live `client_profiles_authority` says `syncview`; `roster-read` v4, `roster-write` v4, `client-profile-write` v15 and the assignment/outbox relations exist. The Sheet copy queue has zero outstanding rows at the query time. Onboarding, Finalizer, Content Ready Notify, VIDEO PRODUCTION AUTOMATION and MARKET RESEARCH now use native roster doors in their published graphs; Manager Sync is inactive. | The checked-in Roster status in STATE_OF_THINGS still says nothing is switched. This live snapshot supersedes that sentence for this map only. Page manager CSV, remaining analytics roster reads, copies, human protection and final retirement need Roster's closeout. This audit did not perform the switch or certify its write drills. |
| Metrics producer and PostTracking | **IN PROGRESS, Harbor.** `analytics-metrics-collect` v4 is deployed, its timer exists, and `analytics_post_tracking` has 5,667 rows. The shadow table had zero rows at measurement. | Do not infer a successful shadow day from deployment. Follow the accepted cohort and three clean days before proposing to deactivate CLIENTS METRICS. |
| Top Videos producer | Harbor's step 2 is merged as source in #1938; the new shadow collector was absent from the live function catalog at this snapshot. | Apply/deploy/shadow and compare under Harbor's plan, then a separate owner go for retirement. |
| Market Research | **IN PROGRESS as a programme assignment to Harbor; implementation not started** in the current collector plan. 13 briefs are already mirrored; the published writer still uses the Sheet. | Port briefs and Hook Library together; explicitly decide whether to restore, retain or retire the disabled summaries branch. |
| Calendar, Templates, FilmingPlans, CaptionPrompts | Native tables and write doors already exist. Browser primary reads are native. | Remaining fallback/compatibility paths and their retention periods are not the same as retirement. Calendar Upsert still receives substantial execution traffic; the legacy client save path remains. |

Owning plans: [Sheets migration](2026-09-24-sheets-to-supabase.md),
[Roster](2026-10-02-roster-native.md), [Harbor collectors](2026-10-01-n8n-off-analytics.md),
[n8n exit](2026-09-28-n8n-exit.md), [phase 2](2026-09-30-n8n-exit-phase-2.md).

## How the measurements were made

Native Google metadata enumerated both workbooks before reads. Every tab was read
three times through the page's unauthenticated gviz CSV path, addressed by its
metadata-derived numeric tab id, with one header row. CSV bodies were parsed in
memory for counts; data cells are not reproduced here. Sizes below are exact
uncompressed UTF-8 response bytes, including headers and blank exported columns;
times are medians of three HTTP downloads including the full body, in milliseconds,
from this Windows workstation, with at most four independent reads in flight.
They are neither browser first-paint times nor service-level guarantees. All 252
reads returned CSV successfully; row counts and byte sizes were identical across
each tab's three samples. Formatting, images, Drive storage usage and compressed
wire sizes are not included. Whole-file Drive storage is not apportioned to tabs.

"Rows" means nonempty exported data rows, excluding the header and blank rows.
"Grid" means allocated rows × columns, not populated records. Columns are the
actual ordered headers, including anomalies. Old_Clients has **no header**:
a bounded native `A1:J4` read confirmed two data rows; neither first-row value is
treated as a column name. Headerless columns are positional and only inferred
from the older roster shape. The CaptionPrompts duplicate header was independently
confirmed by a bounded native `A1:D1` read.

Live SQL read only catalog metadata, aggregate counts and the three relevant flag
fields. n8n's public API enumerated 231 workflows, **120 nonarchived, 73 active**;
published graphs were fetched for every active workflow, with no draft/published
version difference found. Disabled or disconnected branches are distinguished
from enabled paths. A separate bare-workbook-id search found 68 workflows and
reconciled the semantic search's 67: the extra workflow was Weekly Backup.
Credential bodies and execution payloads were not exported. Configured schedules
are stated separately from retained execution observations.

Human access frequency cannot be measured from these tools. **H** below means a
human can retain a direct Sheet habit; who actually opens/edits it and how often
is **UNKNOWN**, pending owner confirmation. H is included for every tab, even
empty or retired ones. It is not a claim that each tab is actively hand-edited.
Technical evidence cannot certify that every possible human or private script has
been discovered. No access was changed to find out.

## Main workbook: every tab's contents and cost

The schemas below are ordered left to right. Unlisted allocated columns are blank
in the exported header. `prompt ` means a header with a trailing space.

| Tab | What it holds | Rows | Grid | Named columns / occupied data width | Bytes | Median ms |
| --- | --- | ---: | --- | --- | ---: | ---: |
| `Clients Info` | Current client profile and service mappings | 36 | 996 × 27 | 15 / 15 | 73,998 | 500 |
| `Videographer Contact` | Videographer/contact/location working list | 32 | 1,000 × 26 | 5 / 5 | 2,036 | 404 |
| `Legacy Clients` | Retained previous client profiles | 5 | 1,000 × 27 | 14 / 11 | 15,870 | 436 |
| `Social Media Managers` | Per-client manager assignments and Slack profile link | 41 | 1,014 × 26 | 4 / 4 | 1,813 | 372 |
| `Competitors` | Empty competitor-ranking schema | 0 | 1,000 × 26 | 8 / 0 | 111 | 379 |
| `Old_Clients` | Two headerless historical profiles | 2 | 1,000 × 27 | 0 / 9 | 5,757 | 386 |
| `Monthly Checkup` | Client/email list for monthly mail | 5 | 984 × 33 | 2 / 2 | 375 | 340 |
| `Metrics` | Daily per-client platform analytics and collection receipt | 5,420 | 6,701 × 26 | 17 / 17 | 2,963,644 | 935 |
| `PostTracking` | Per-post day-to-day collector state | 5,667 | 5,668 × 26 | 7 / 7 | 475,450 | 667 |
| `TopVideos` | Ranked videos for each scrape/platform/period | 59,603 | 59,604 × 25 | 11 / 12 | 16,764,924 | 2226 |
| `ContentSummaries` | Content-summary bullets (one row lacks a client) | 2 | 1,002 × 26 | 3 / 3 | 3,685 | 362 |
| `Competitor Briefs` | Retired generated competitor JSON briefs | 12 | 1,013 × 26 | 4 / 4 | 243,223 | 552 |
| `Market Research Briefs` | Generated research briefs split across JSON columns | 13 | 1,025 × 26 | 6 / 5 | 789,633 | 708 |
| `CaptionPrompts` | Per-client prompt settings; duplicate prompt headers | 25 | 1,024 × 26 | 4 / 4 | 51,969 | 410 |
| `Video Editors` | Editor names and email addresses | 4 | 1,000 × 26 | 2 / 2 | 178 | 350 |
| `Templates` | Creative preferences, fonts, colours and resource links | 7 | 1,009 × 26 | 19 / 19 | 3,895 | 341 |
| `Hook Library` | Saved/generated opening hooks and templates | 5 | 1,008 × 26 | 4 / 4 | 1,771 | 329 |
| `Linear Submissions` | Pre-save intake fallback plus post-success receipts | 745 | 1,771 × 26 | 4 / 4 | 776,312 | 687 |
| `TikTokUpload` | Post For Me upload/schedule/result ledger | 245 | 1,246 × 26 | 15 / 15 | 257,976 | 524 |
| `FilmingPlans` | Client-to-filming-Doc link index | 31 | 1,001 × 26 | 2 / 2 | 3,229 | 341 |

Main workbook total: **22,435,849 bytes** across all tabs; do not add download medians to estimate a page load. TopVideos accounts for about 75% of that total.

- **Clients Info**: `client_name`, `email`, `competitors`, `keywords`, `specific_keywords`, `content_description`, `instagram_handle`, `tiktok_handle`, `youtube_channel_id`, `slack_channel_id`, `creative_channel_id`, `roam_channel_id`, `upload_post_profile`, `postforme_account_id`, `postforme_instagram_account_id`.
- **Videographer Contact**: `Client`, `Videographer`, `Location`, `Contact`, `Status`.
- **Legacy Clients**: `client_name`, `email`, `competitors`, `keywords`, `specific_keywords`, `content_description`, `instagram_handle`, `tiktok_handle`, `youtube_channel_id`, `slack_channel_id`, `creative_channel_id`, `roam_channel_id`, `upload_post_profile`, `postforme_account_id`.
- **Social Media Managers**: `client_name`, `social_media_manager`, `linear_api_key`, `slack_profile_url`.
- **Competitors**: `client_name`, `rank`, `competitor_name`, `competitor_handle`, `competitor_url`, `platform`, `summary`, `scraped_date`.
- **Old_Clients**: A–I: unnamed positional fields, inferred as client identity, email, competitors, keywords, specific keywords, content description, Instagram handle, TikTok handle and YouTube channel id. No native header exists; inference is not a schema guarantee..
- **Monthly Checkup**: `client_name`, `email`.
- **Metrics**: `date`, `client_name`, `ig_followers`, `ig_avg_views`, `ig_avg_likes`, `tiktok_followers`, `tiktok_avg_plays`, `yt_subscribers`, `yt_total_views`, `ig_views_gained_today`, `tiktok_plays_gained_today`, `ig_views_this_month`, `tiktok_plays_this_month`, `yt_views_gained_today`, `yt_shorts_views`, `yt_longs_views`, `analytics_receipt`.
- **PostTracking**: `post_id`, `client_name`, `platform`, `first_seen_date`, `views_yesterday`, `views_today`, `views_gained_today`.
- **TopVideos**: `scraped_date`, `client_name`, `platform`, `period`, `rank`, `caption`, `video_url`, `views`, `likes`, `comments`, `shares`; L is unnamed but has one nonempty, non-URL-shaped cell. The existing 11-field mirror does not preserve this extra cell; decide its disposition before retiring the tab..
- **ContentSummaries**: `date`, `client_name`, `bullets`.
- **Competitor Briefs**: `id`, `client_name`, `date`, `raw_json`.
- **Market Research Briefs**: `id`, `client_name`, `date`, `raw_json`, `raw_json_2`, `raw_json_3`.
- **CaptionPrompts**: A `client`; B `prompt` **with trailing space**; C `updated_at`; D `prompt` without trailing space. B is empty in the data; D is populated..
- **Video Editors**: `video_editor`, `email`.
- **Templates**: `client_name`, `filming_plans_link`, `reels_subtitle_font`, `reels_subtitle_main_color`, `reels_subtitle_highlight_color`, `reels_reference_link`, `reels_preferences`, `thumbnails_title_font`, `thumbnails_title_color`, `thumbnails_highlight_color`, `thumbnails_photos_link`, `updated_at`, `thumbnails_canva_link`, `thumbnails_color_sets`, `reels_subtitle_highlight_off`, `thumbnails_preferences`, `thumbnails_highlight_off`, `reels_editor_folder_link`, `thumbnails_photos_link_list`.
- **Hook Library**: `clientName`, `hookType`, `openingLine`, `template`.
- **Linear Submissions**: `Timestamp`, `Client Name`, `Mode`, `Webhook JSON`.
- **TikTokUpload**: `id`, `client`, `profile`, `title`, `post_comment`, `options_json`, `scheduled_for`, `timezone`, `status`, `upload_post_id`, `tiktok_url`, `error`, `posted_at`, `created_at`, `updated_at`.
- **FilmingPlans**: `client_name`, `doc_url`.

## Main workbook: readers, writers and native coverage

Workflow IDs below resolve through the workflow registry later in this document.
**R/W** means Sheet read/write; **native** means the dependency already uses the
database instead. Every row also has H (direct human use unconfirmed) and P0
(no scoped pipeline config target found, explained below). An absent dedicated
table is not a statement that no related business object exists.

| Tab | Page and Edge Functions | Enabled n8n Sheet I/O; frequency | Supabase now / remaining decision |
| --- | --- | --- | --- |
| Clients Info | Page roster/allowlist/pickers, Today, Workload and upload mappings consume `clientMap` through `fetchEssentials`; native `analytics-read` first, CSV on refused/incomplete native read. Admin Clients reads `client_profiles` and saves through `client-profile-write`; native `roster-write` and profile saves mirror changed cells back through the Sheet outbox. | R: `Q4n1bagJYBkurEaI` daily; `DyVPx0neUZ94R0hJ` daily. Other live roster users in the registry are already native. | `client_profiles` 36; `clients` is the separate active roster; field edit history, assignment history and Sheet outbox exist. Fifteenth Sheet column `postforme_instagram_account_id` is carried through `extra`, not a dedicated SQL column. Roster closes remaining page/fallback/copy users. |
| Videographer Contact | No direct page or deployed dedicated gateway found. | No enabled caller found. | No dedicated table found. Human contact workflow and preservation destination need an owner decision. |
| Legacy Clients | No direct page reader/writer found. | No enabled caller found. | Not proven copied into archived `client_profiles`. Preserve five historical rows separately; never activate them as current clients by importing. |
| Social Media Managers | `_kasperLoadSMMMap` still downloads CSV on queue load; `roster-read` is native; `roster-write` may copy assignment edits back. | No enabled direct Sheet node after Roster changes. Manager Sync `y3rEWCVdB0esN3tO` is inactive. | `social_media_managers` 8 managers, grouped from 41 assignment rows; `source_clients` stores lists, `slack_profile_url` and `smm_assignment_edits` retain assignment details. Do not compare 41 assignments to 8 managers as missing rows. Empty `linear_api_key` header remains; no corresponding SQL column. |
| Competitors | No current page read. | No actual enabled Sheet read/write found. MARKET RESEARCH contains a textual brief label `Competitors`; that is not a tab read. | Zero rows. Retain schema or retire it explicitly; do not build a fake scraper migration for a label. |
| Old_Clients | No direct page or gateway found. | No enabled caller found. | Two historical rows have no proven native archive copy. Owner chooses positional schema and archive treatment. |
| Monthly Checkup | No page reader or native mail door found. | R: `alZ87zcRVKgcGVY7`, monthly, day 1 at configured 08:00; recent start 12:00 UTC. | `client_profiles.email` is related, not an equivalent mailing cohort. Need explicit cohort, sender, send window and duplicate-send rule before replacing the job. |
| Metrics | Staff overview, per-client Analytics and client links read `analytics-read`; CSV fallback retained. `analytics-write` receives dual-write/copy; native shadow collector currently writes shadow data only. | R/W: `Q4n1bagJYBkurEaI`, daily; reads previous Metrics, appends today's rows and dual-writes. | `analytics_metrics` 5,420; strict parity 5,204 groups, zero differences. Receipt/fingerprint rules already exist. Browser **DONE**; producer retirement Harbor. |
| PostTracking | No page reader. `analytics-metrics-collect` uses native tracking state. | R/W: `Q4n1bagJYBkurEaI`, each daily metrics run. | `analytics_post_tracking` 5,667. Harbor has seeded the native working state; equal counts are not by themselves a tracking-state comparison. Retire with the metrics producer, not as an independent display feature. |
| TopVideos | Per-client Analytics reads `analytics-read` (last 90 days), CSV fallback retained; `analytics-write` receives appends. | W: `DyVPx0neUZ94R0hJ`, daily configured 04:00, observed 08:00 UTC. MARKET RESEARCH's TopVideos reader is disabled/disconnected. | `analytics_top_videos` 59,603; strict parity 2,771 recent groups, zero differences. Browser **DONE**. Harbor's collector step 2 is source-only. One unnamed extra cell needs preserve-or-discard approval. |
| ContentSummaries | Optional Analytics/Brief extras through `analytics-read`, then optional CSV fallback. | No enabled writer. `FD2QUIOlobkdLOgs` contains a disabled/disconnected daily summary branch (06:00) and disabled write. | `analytics_content_summaries` 1 valid-client row; second Sheet row has no client and is intentionally skipped by existing copy/parity rules. Valid-row parity clean. Harbor/owner decide restore producer vs preserve retired material. |
| Competitor Briefs | Page generators/download retired by owner; no current reader. | No enabled writer; old COMPETITOR RESEARCH is archived. | No dedicated mirror in the five datasets. Preserve 12 historical JSON rows in a restricted archive or keep a frozen workbook, per owner; do not resurrect the feature. |
| Market Research Briefs | Per-client Brief through `analytics-read`, CSV fallback; daily copy via `analytics-write`. | W: `FD2QUIOlobkdLOgs`, enabled webhook branch, no retained execution. | `analytics_market_research_briefs` 13; strict parity 13 groups, zero differences. Harbor owns the native producer. Mirror existence does not remove the Sheet write. |
| CaptionPrompts | Calendar reads native `caption_prompts`, then last-good cache, then n8n Get on failure; staff save uses `caption-prompts-save` v63. | R: `3hZnjXmHdNv4bttw`; W: `RGkuE8d4uJg6CPde`, per legacy load/save, zero retained calls in last 24h. | `caption_prompts` 26 versus 25 Sheet rows; no raw one-to-one parity claim. Preserve the native primary copy, reconcile both prompt columns, remove fallback only after proof. Save retirement no earlier than the owner-approved 30-day window (October 29 for September 29 release). |
| Video Editors | Native intake uses `team_members`; Sheet assignment reader remains in VIDEO PRODUCTION AUTOMATION. No direct current page CSV reader found. | R: `BrJSe8zCKUccfmIq`, per intake/legacy assignment. Inactive urgent-tweak workflow also reads it. | `team_members` 22 across roles/teams, with email, Slack id and active/default/opt-out fields. Not an exact four-row editor mirror. Owner chooses authority for membership, default assignment and missing Slack-id handling. |
| Templates | Page REST/realtime reads `templates`; `templates-save` v63 writes native. | No enabled Sheet node. Old Get/Save graphs are archived. | `templates` 40 versus 7 Sheet rows; JSON `data` holds preferences. Migration is already native; prove old field/history coverage and retire retained tab/fallback references. |
| Hook Library | Brief UI calls `add-hook-to-library`, via MARKET RESEARCH; no dedicated native hook gateway found. | W: `FD2QUIOlobkdLOgs`, per explicit save/generated hook. | No dedicated hook relation found. Harbor needs a hook table and authenticated save door, deduplication/idempotency and acknowledgement semantics before Sheet writes stop. |
| Linear Submissions | Native Submit still posts a **pre-save fallback** and a post-success receipt through `LOG_SUBMISSION_WEBHOOK`; this is useful even though Linear is off. | W: `BrJSe8zCKUccfmIq`, `log-linear-submission` webhook, per request and success. | Native intake jobs/receipts and `write_refusals` are related but not proven substitutes for the pre-save raw submission. Preserve its recoverable request before removing this writer. Owner sets retention and who may recover it. |
| TikTokUpload | TikTok page uses n8n submit/direct/list/status/cancel endpoints; provider callback writes result. | R: List `iYb1896sIAclGvy8`, Status `IjayuU6jkA21aKo3`; W: Submit `o6wWaGNlIlyZFTX7`, Direct `qGJ7mUjml98DSiGo`, Result `1qZmOQPtG6rKYlK7`, Cancel `4ca3li54eRFtSfXE`. Event driven. | No equivalent Post For Me TikTok ledger found. `tiktok_pilot_posts` is a separate direct-TikTok pilot; `instagram_uploads` is a separate Instagram ledger. Neither proves this workflow migrated. Keep provider ids, callback reconciliation and pending schedules in a dedicated native ledger. |
| FilmingPlans | Page uses native `filming_plans` via `filming-plans` v64. VIDEO PRODUCTION AUTOMATION's published Fetch Filming Plans nodes now read the Supabase table, despite stale Sheet comments in code. | No actual enabled Sheet read/write found. | `filming_plans` 40 versus 31 Sheet rows. Native index migration exists; prove remaining historical link coverage. Actual filming-plan Docs stay out of scope. |

### Scripts and scheduled readers that also count

- Page frequency is event driven, not a daily schedule: essentials start at boot
  or client-route entry; extras start at Analytics/Brief demand (Kasper boot holds
  them behind first paint). Shared in-flight promises and saved copies reduce
  duplicate downloads. Native success avoids analytics CSV; refusal/incomplete
  native data takes the fallback. Manager CSV starts on each actual Kasper review
  load/refresh and the Samples queue load. Caption prompts are read once per
  document's loaded state, with retry/fallback on failure; settings/Template and
  filming-index writes occur on an explicit save. No browser-use daily totals
  were measured.
- TikTok's visible queue polls List every 30–120 seconds for in-flight work,
  2–10 minutes for future schedules, or 5–15 minutes for unresolved overdue work,
  backing off when unchanged; idle/hidden views stop. Overdue Status lookups are
  capped at five per pass, per row at 10/30/60 minutes depending on prior answers.
  Submit/Direct/Cancel are explicit actions; Result is a provider event. These
  are source-configured intervals, separate from the retained starts below.
- `.github/workflows/sheets-mirror-daily.yml`: daily 09:23 UTC, plus manual,
  reads Metrics, TopVideos, Market Research Briefs, ContentSummaries and Clients
  Info through `sheets-mirror-backfill.js` and `sheets-mirror-parity.js`. Copy may
  write **Supabase**, never Sheets; authority guard prevents Clients Info from
  overwriting native profiles after Roster's switch. This remains a Google reader
  even while every browser succeeds natively.
- `.github/workflows/clients-roster-sync.yml`: daily 06:41 UTC, plus manual,
  `scripts/clients-roster-sync.js` reads Clients Info and may change `clients`.
  Its source-of-authority rule must move with Roster; a calendar/UI migration
  alone cannot retire this dependency. Configured schedules are not fresh hosted
  success evidence; repository variables controlling apply were not read here.
- Operator-only: `sheets-mirror-read-timing.js` reads five analytics/roster tabs;
  `sheets-mirror-catchup.js` compares Metrics/TopVideos and can append back to them
  only under its explicit apply/production gates; `analytics-metrics-shadow-seed.js`
  reads PostTracking; `b0-seed-auth-scaffold.js` reads Clients Info, Video Editors
  and Social Media Managers; `b1-linear-dry-run.js` reads Clients Info and Social
  Media Managers unless local inputs are supplied. No scheduler/caller was found
  for these old manual seed/dry-run tools. Preserve them as history or update
  their reader before reuse. No apply command was run in this session.
- Whole-workbook reader: **Weekly Backup `jlVfbg0Njxf1It7h`** copies the main
  SYNCVIEW Sheet, hence includes all 20 tabs, once a week (Sunday configured
  02:00; last retained start September 27 at 06:00 UTC). It also backs up other
  resources, which are out of scope. Replace just the Sheet backup source with a
  verified native export/restore route before ending this dependency; do not
  disable the entire backup workflow.

### Pipelines (P0) and human use (H)

At the pinned `synchro-pipelines` main tree, both tracked client configuration
files target other idea workbooks: **0 of 2 targets match either scoped file**.
`publish.py`, `approved_rows.py` and `kasper_feedback.py` can override the target
at invocation; `google_relay.py` and `pipeline-google` v12 can read/write a supplied
spreadsheet. Thus P0 means no configured in-scope reader/writer, not technical
impossibility of a private/manual call. Frequency of an override is UNKNOWN.
The filming-plan pipeline edits other Docs and idea Sheets: leave it alone.
Source: [pipeline write policy](https://github.com/sidney-afk/synchro-pipelines/blob/e1a8655/GOOGLE_WRITES.md),
[relay](https://github.com/sidney-afk/synchro-pipelines/blob/e1a8655/google_relay.py),
[publish](https://github.com/sidney-afk/synchro-pipelines/blob/e1a8655/publish.py).

For every main and Calendar tab, H remains unconfirmed. Before closing a slice,
the owner identifies the human task and either gives it a native screen/import
route or explicitly retires it. Contacts and historical rosters especially must
not be declared unused merely because a graph search finds no bot.


## Calendar workbook: every tab, schema and native destination

There are **31 Calendar data tabs, Calendar_Config, 31 old Samples tabs and hidden
Sheet1**. The previous "32 private Calendar tabs" count includes the config tab;
it is not 32 client calendars. Labels C/S plus two digits encode the tab's
**zero-based workbook position** at this snapshot, including hidden Sheet1.
Position 28 is Calendar_Config, so there is no C28; late tabs C60/S61/C62/S63 keep
their real positions. The id/position mapping stays outside this public repo.
Never derive a client identity from a public label. Re-enumerate before migration
because order can change.

For **every C data tab**, common dependency set **CAL + H + P0** applies: legacy
Calendar Get/Queue read and Upsert/Append/Delete/Reorder write the request-selected
tab; some branches issue Google HTTP requests from code. This means graph
capability, not proof each tab received traffic. Current page primary reads and
native `calendar-upsert` v77 / `calendar-reorder` v65 use `calendar_posts` instead.
There is no direct Google write in those native handlers' repository source.
Keep the frozen, tokenless client save behavior unchanged.

For **every S tab**, common dependency set **OLD-SAMPLES + H + P0** applies: the
old Samples Get/Upsert/Reorder/provision graphs are inactive or archived; no
enabled current Sheet reader/writer was found. Their matching schema is
`content_samples`, **25 total rows**, not the newer `sample_reviews` (**7,927 rows**).
The page's current Samples review and `sample-review-upsert` v78 /
`sample-review-reorder` v65 use the newer table and are not proof old rows were
transformed into it. The old module has no current source caller found.

Every S tab has matching native `content_samples` counts by the exact suffix key.
Several C tabs differ from `calendar_posts`, in both directions. **Counts below
are not id/field/ordering/comment/approval parity.** A tab with more Sheet rows
must not be blindly copied over newer native state or discarded. Rows under
native clients without a Sheet tab are not represented by this per-tab table;
the global table count is measured separately.

Every Calendar tab has one schema reference below, including each empty tab.
Header order is exact; blank trailing allocated columns are omitted.

| Schema | Ordered columns |
| --- | --- |
| K00 | No exported header or data |
| K01 | `id`, `order_index`, `scheduled_date`, `name`, `asset_url`, `thumbnail_url`, `caption`, `post_url`, `cta`, `tweaks`, `status`, `linear_issue_id`, `kasper_approved_at`, `posted_at`, `platform`, `updated_at`, `video_tweaks`, `graphic_tweaks`, `caption_tweaks`, `video_status`, `graphic_status`, `caption_status`, `kasper_approved_after_tweaks`, `kasper_seen`, `caption_alt`, `caption_alt_platform`, `platforms`, `color`, `graphic_linear_issue_id`, `client_video_approved_at`, `client_graphic_approved_at`, `client_caption_approved_at`, `thumb_rev` |
| K02 | `id`, `order_index`, `scheduled_date`, `name`, `asset_url`, `thumbnail_url`, `caption`, `post_url`, `cta`, `tweaks`, `status`, `linear_issue_id`, `kasper_approved_at`, `posted_at`, `platform`, `updated_at` |
| K03 | `id`, `order_index`, `scheduled_date`, `name`, `asset_url`, `thumbnail_url`, `caption`, `post_url`, `cta`, `tweaks`, `status`, `linear_issue_id`, `kasper_approved_at`, `posted_at`, `platform`, `updated_at`, `video_status`, `graphic_status`, `caption_status`, `graphic_linear_issue_id`, `video_tweaks`, `graphic_tweaks`, `caption_tweaks`, `client_video_approved_at`, `client_graphic_approved_at`, `client_caption_approved_at`, `client`, `sheetName`, `row`, `kasper_seen`, `kasper_approved_after_tweaks`, `caption_alt`, `caption_alt_platform`, `platforms`, `color`, `thumb_rev`, `kasper_finished_at`, `kasper_closed_at`, `title_tweaks`, `title_status`, `client_title_approved_at`, `kasper_finish_log` |
| K04 | `id`, `order_index`, `scheduled_date`, `name`, `asset_url`, `thumbnail_url`, `caption`, `post_url`, `cta`, `tweaks`, `status`, `linear_issue_id`, `kasper_approved_at`, `posted_at`, `platform`, `updated_at`, `video_tweaks`, `graphic_tweaks`, `caption_tweaks`, `video_status`, `graphic_status`, `caption_status`, `graphic_linear_issue_id`, `kasper_seen`, `kasper_approved_after_tweaks`, `thumb_rev`, `title_tweaks`, `caption_alt`, `caption_alt_platform`, `platforms`, `color`, `client_video_approved_at`, `client_graphic_approved_at`, `client_caption_approved_at`, `title_status`, `client_title_approved_at`, `kasper_finished_at`, `kasper_closed_at` |
| K05 | `id`, `order_index`, `scheduled_date`, `name`, `asset_url`, `thumbnail_url`, `caption`, `post_url`, `cta`, `tweaks`, `status`, `linear_issue_id`, `kasper_approved_at`, `posted_at`, `platform`, `updated_at`, `video_tweaks`, `graphic_tweaks`, `caption_tweaks`, `title_tweaks`, `graphic_linear_issue_id`, `graphic_status`, `thumb_rev`, `caption_status`, `kasper_seen` |
| K06 | `id`, `order_index`, `scheduled_date`, `name`, `asset_url`, `thumbnail_url`, `caption`, `post_url`, `cta`, `tweaks`, `status`, `linear_issue_id`, `kasper_approved_at`, `posted_at`, `platform`, `updated_at`, `video_tweaks`, `graphic_tweaks`, `caption_tweaks`, `thumb_rev`, `video_status`, `graphic_linear_issue_id`, `graphic_status`, `caption_alt`, `caption_alt_platform`, `platforms`, `color`, `caption_status`, `client_video_approved_at`, `client_graphic_approved_at`, `client_caption_approved_at`, `kasper_seen`, `kasper_approved_after_tweaks`, `kasper_finished_at`, `kasper_closed_at`, `title_tweaks`, `kasper_finish_log` |
| K07 | `id`, `order_index`, `scheduled_date`, `name`, `asset_url`, `thumbnail_url`, `caption`, `post_url`, `cta`, `tweaks`, `status`, `linear_issue_id`, `kasper_approved_at`, `posted_at`, `platform`, `updated_at`, `video_status`, `graphic_status`, `caption_status`, `graphic_linear_issue_id`, `video_tweaks`, `graphic_tweaks`, `caption_tweaks`, `kasper_approved_after_tweaks`, `kasper_seen`, `caption_alt`, `caption_alt_platform`, `platforms`, `color`, `client_video_approved_at`, `client_graphic_approved_at`, `client_caption_approved_at`, `thumb_rev`, `kasper_finished_at`, `kasper_closed_at`, `title_tweaks`, `title_status`, `client_title_approved_at`, `kasper_finish_log` |
| K08 | `id`, `order_index`, `scheduled_date`, `name`, `asset_url`, `thumbnail_url`, `caption`, `post_url`, `cta`, `tweaks`, `status`, `linear_issue_id`, `kasper_approved_at`, `posted_at`, `platform`, `updated_at`, `video_tweaks`, `graphic_tweaks`, `caption_tweaks`, `video_status`, `graphic_status`, `caption_status`, `graphic_linear_issue_id`, `kasper_seen`, `kasper_approved_after_tweaks`, `color`, `caption_alt_platform`, `caption_alt`, `platforms`, `client_video_approved_at`, `client_graphic_approved_at`, `client_caption_approved_at`, `thumb_rev`, `title_status`, `title_tweaks`, `client_title_approved_at`, `kasper_finished_at`, `kasper_closed_at` |
| K09 | `id`, `order_index`, `scheduled_date`, `name`, `asset_url`, `thumbnail_url`, `caption`, `post_url`, `cta`, `tweaks`, `status`, `linear_issue_id`, `kasper_approved_at`, `posted_at`, `platform`, `updated_at`, `video_tweaks`, `graphic_tweaks`, `caption_tweaks`, `video_status`, `graphic_status`, `caption_status`, `graphic_linear_issue_id`, `thumb_rev`, `caption_alt`, `caption_alt_platform`, `platforms`, `color`, `client_video_approved_at`, `client_graphic_approved_at`, `client_caption_approved_at`, `title_status`, `title_tweaks`, `client_title_approved_at`, `kasper_seen`, `kasper_approved_after_tweaks`, `kasper_finished_at`, `kasper_closed_at` |
| K10 | `id`, `order_index`, `scheduled_date`, `name`, `asset_url`, `thumbnail_url`, `caption`, `post_url`, `cta`, `tweaks`, `status`, `linear_issue_id`, `kasper_approved_at`, `posted_at`, `platform`, `updated_at`, `video_status`, `graphic_status`, `caption_status`, `video_tweaks`, `graphic_tweaks`, `caption_tweaks`, `graphic_linear_issue_id`, `kasper_seen`, `kasper_approved_after_tweaks`, `client_video_approved_at`, `client_graphic_approved_at`, `client_caption_approved_at`, `thumb_rev` |
| K11 | `id`, `order_index`, `scheduled_date`, `name`, `asset_url`, `thumbnail_url`, `caption`, `post_url`, `cta`, `tweaks`, `status`, `linear_issue_id`, `kasper_approved_at`, `posted_at`, `platform`, `updated_at`, `video_tweaks`, `graphic_tweaks`, `caption_tweaks`, `video_status`, `graphic_status`, `caption_status`, `graphic_linear_issue_id`, `kasper_seen` |
| K12 | `id`, `order_index`, `scheduled_date`, `name`, `asset_url`, `thumbnail_url`, `caption`, `post_url`, `cta`, `tweaks`, `status`, `linear_issue_id`, `kasper_approved_at`, `posted_at`, `platform`, `updated_at`, `client`, `sheetName`, `row`, `video_status`, `graphic_status`, `caption_status`, `video_tweaks`, `graphic_tweaks`, `caption_tweaks`, `graphic_linear_issue_id`, `kasper_seen`, `kasper_approved_after_tweaks`, `client_graphic_approved_at`, `client_caption_approved_at`, `client_video_approved_at`, `thumb_rev` |
| K13 | `id`, `order_index`, `scheduled_date`, `name`, `asset_url`, `thumbnail_url`, `caption`, `post_url`, `cta`, `tweaks`, `status`, `linear_issue_id`, `kasper_approved_at`, `posted_at`, `platform`, `updated_at`, `video_status`, `graphic_status`, `caption_status`, `video_tweaks`, `graphic_tweaks`, `caption_tweaks`, `graphic_linear_issue_id`, `client_video_approved_at`, `client_graphic_approved_at`, `client_caption_approved_at`, `kasper_seen`, `kasper_approved_after_tweaks`, `thumb_rev`, `color`, `title_tweaks`, `kasper_finished_at` |
| K14 | `id`, `order_index`, `scheduled_date`, `name`, `asset_url`, `thumbnail_url`, `caption`, `post_url`, `cta`, `tweaks`, `status`, `linear_issue_id`, `kasper_approved_at`, `posted_at`, `platform`, `updated_at`, `video_status`, `graphic_status`, `caption_status`, `video_tweaks`, `graphic_tweaks`, `caption_tweaks`, `graphic_linear_issue_id`, `client`, `sheetName`, `row`, `client_video_approved_at`, `color`, `kasper_seen`, `client_caption_approved_at`, `kasper_approved_after_tweaks`, `client_graphic_approved_at`, `platforms`, `thumb_rev`, `caption_alt`, `caption_alt_platform`, `kasper_finished_at`, `kasper_closed_at`, `title_tweaks` |
| K15 | `id`, `order_index`, `scheduled_date`, `name`, `asset_url`, `thumbnail_url`, `caption`, `post_url`, `cta`, `tweaks`, `status`, `linear_issue_id`, `kasper_approved_at`, `posted_at`, `platform`, `updated_at`, `video_tweaks`, `graphic_tweaks`, `caption_tweaks`, `title_tweaks`, `thumb_rev`, `graphic_linear_issue_id`, `graphic_status`, `color`, `video_status`, `caption_status`, `kasper_seen`, `client_video_approved_at`, `client_graphic_approved_at`, `client_caption_approved_at`, `platforms` |
| K16 | `id`, `order_index`, `scheduled_date`, `name`, `asset_url`, `thumbnail_url`, `caption`, `post_url`, `cta`, `tweaks`, `status`, `linear_issue_id`, `kasper_approved_at`, `posted_at`, `platform`, `updated_at`, `video_tweaks`, `graphic_tweaks`, `caption_tweaks`, `video_status`, `graphic_status`, `caption_status`, `graphic_linear_issue_id`, `kasper_seen`, `platforms`, `caption_alt_platform`, `caption_alt`, `color`, `client_video_approved_at`, `client_graphic_approved_at`, `client_caption_approved_at`, `kasper_approved_after_tweaks`, `thumb_rev`, `kasper_finished_at`, `kasper_closed_at`, `title_status`, `title_tweaks`, `client_title_approved_at`, `kasper_finish_log` |
| K17 | `id`, `order_index`, `scheduled_date`, `name`, `asset_url`, `thumbnail_url`, `caption`, `post_url`, `cta`, `tweaks`, `status`, `linear_issue_id`, `kasper_approved_at`, `posted_at`, `platform`, `updated_at`, `video_status`, `graphic_status`, `caption_status`, `video_tweaks`, `graphic_tweaks`, `caption_tweaks`, `graphic_linear_issue_id`, `platforms`, `client_video_approved_at`, `client_graphic_approved_at`, `client_caption_approved_at` |
| K18 | `id`, `order_index`, `scheduled_date`, `name`, `asset_url`, `thumbnail_url`, `caption`, `post_url`, `cta`, `tweaks`, `status`, `linear_issue_id`, `kasper_approved_at`, `posted_at`, `platform`, `updated_at`, `video_status`, `graphic_status`, `caption_status`, `graphic_linear_issue_id`, `video_tweaks`, `graphic_tweaks`, `caption_tweaks`, `thumb_rev`, `caption_alt`, `caption_alt_platform`, `platforms`, `color`, `client_video_approved_at`, `client_graphic_approved_at`, `client_caption_approved_at`, `kasper_seen`, `kasper_approved_after_tweaks`, `kasper_finished_at`, `kasper_closed_at`, `title_status`, `title_tweaks`, `client_title_approved_at`, `kasper_finish_log` |
| K19 | `key`, `value`, `updated_at` |
| K20 | `id`, `updated_at`, `name`, `caption`, `status`, `order_index`, `scheduled_date`, `asset_url`, `thumbnail_url`, `cta`, `tweaks`, `video_tweaks`, `graphic_tweaks`, `caption_tweaks`, `video_status`, `graphic_status`, `caption_status`, `linear_issue_id`, `caption_alt`, `caption_alt_platform`, `post_url`, `kasper_approved_at`, `posted_at`, `platform`, `platforms`, `color`, `graphic_linear_issue_id`, `client_video_approved_at`, `client_graphic_approved_at`, `client_caption_approved_at`, `kasper_seen`, `kasper_approved_after_tweaks`, `thumb_rev`, `kasper_finished_at`, `kasper_closed_at` |
| K21 | `id`, `updated_at`, `order_index`, `scheduled_date`, `name`, `asset_url`, `thumbnail_url`, `caption`, `cta`, `tweaks`, `status`, `linear_issue_id`, `video_status`, `graphic_status`, `caption_status`, `graphic_linear_issue_id`, `video_tweaks`, `graphic_tweaks`, `caption_tweaks`, `thumb_rev`, `color`, `client_graphic_approved_at`, `client_caption_approved_at` |
| K22 | `id`, `updated_at`, `kind`, `order_index`, `label`, `media_url`, `creative_direction`, `comments`, `status`, `created_at`, `approval`, `kasper_approved_at`, `kasper_approved_by`, `client_approved_at`, `client_approved_by` |
| K23 | `id`, `updated_at`, `kind`, `order_index`, `label`, `media_url`, `creative_direction`, `comments`, `status`, `created_at`, `approval`, `kasper_approved_at`, `kasper_approved_by`, `client_approved_at`, `client_approved_by`, `hide_creative_direction` |
| K24 | `id`, `updated_at`, `kind`, `order_index`, `label`, `media_url`, `creative_direction`, `comments`, `status`, `created_at` |
| K25 | `id`, `updated_at`, `kind`, `order_index`, `label`, `media_url`, `creative_direction`, `hide_creative_direction`, `comments`, `status`, `created_at`, `approval`, `kasper_approved_at`, `kasper_approved_by`, `client_approved_at`, `client_approved_by` |
| K26 | `id`, `updated_at`, `order_index`, `scheduled_date`, `name`, `asset_url`, `thumbnail_url`, `caption`, `cta`, `tweaks`, `status`, `linear_issue_id`, `video_tweaks`, `graphic_tweaks`, `caption_tweaks`, `thumb_rev`, `graphic_linear_issue_id`, `video_status`, `caption_status`, `graphic_status`, `caption_alt`, `caption_alt_platform`, `post_url`, `kasper_approved_at`, `posted_at`, `platform`, `platforms`, `color`, `client_video_approved_at`, `client_graphic_approved_at`, `client_caption_approved_at`, `kasper_seen`, `kasper_approved_after_tweaks`, `kasper_finished_at`, `kasper_closed_at`, `title_status`, `title_tweaks`, `client_title_approved_at` |

| Tab label (position) | Rows | Grid | Schema | Bytes | Median ms | Native rows for exact tab suffix | Dependencies |
| --- | ---: | --- | --- | ---: | ---: | --- | --- |
| Sheet1 (0) hidden | 0 | 1,000 × 26 | K00 | 0 | 574 | No dedicated table needed; empty/config schema only | H + P0; no enabled direct I/O found |
| C01 (1) | 19 | 1,019 × 33 | K01 | 5,044 | 416 | `calendar_posts` 62 | CAL + H + P0 |
| C02 (2) | 0 | 1,000 × 26 | K02 | 190 | 393 | `calendar_posts` 45 | CAL + H + P0 |
| C03 (3) | 0 | 1,000 × 26 | K02 | 190 | 372 | `calendar_posts` 0 | CAL + H + P0 |
| C04 (4) | 236 | 1,007 × 42 | K03 | 105,775 | 544 | `calendar_posts` 128 | CAL + H + P0 |
| C05 (5) | 0 | 1,000 × 26 | K02 | 190 | 373 | `calendar_posts` 0 | CAL + H + P0 |
| C06 (6) | 42 | 1,042 × 38 | K04 | 26,255 | 489 | `calendar_posts` 77 | CAL + H + P0 |
| C07 (7) | 30 | 1,030 × 26 | K05 | 14,581 | 454 | `calendar_posts` 76 | CAL + H + P0 |
| C08 (8) | 26 | 1,026 × 37 | K06 | 32,108 | 513 | `calendar_posts` 26 | CAL + H + P0 |
| C09 (9) | 22 | 1,022 × 39 | K07 | 37,873 | 471 | `calendar_posts` 22 | CAL + H + P0 |
| C10 (10) | 0 | 1,000 × 26 | K02 | 190 | 398 | `calendar_posts` 11 | CAL + H + P0 |
| C11 (11) | 0 | 1,000 × 26 | K02 | 190 | 412 | `calendar_posts` 0 | CAL + H + P0 |
| C12 (12) | 13 | 1,013 × 38 | K08 | 33,456 | 489 | `calendar_posts` 13 | CAL + H + P0 |
| C13 (13) | 4 | 1,004 × 38 | K09 | 8,576 | 467 | `calendar_posts` 4 | CAL + H + P0 |
| C14 (14) | 20 | 1,021 × 29 | K10 | 79,888 | 556 | `calendar_posts` 61 | CAL + H + P0 |
| C15 (15) | 6 | 1,006 × 26 | K11 | 17,225 | 394 | `calendar_posts` 6 | CAL + H + P0 |
| C16 (16) | 0 | 1,000 × 26 | K02 | 190 | 415 | `calendar_posts` 0 | CAL + H + P0 |
| C17 (17) | 91 | 956 × 32 | K12 | 83,747 | 496 | `calendar_posts` 78 | CAL + H + P0 |
| C18 (18) | 382 | 1,396 × 32 | K13 | 177,769 | 581 | `calendar_posts` 388 | CAL + H + P0 |
| C19 (19) | 0 | 1,000 × 26 | K02 | 190 | 413 | `calendar_posts` 0 | CAL + H + P0 |
| C20 (20) | 81 | 1,105 × 39 | K14 | 102,542 | 626 | `calendar_posts` 70 | CAL + H + P0 |
| C21 (21) | 0 | 1,000 × 26 | K02 | 190 | 469 | `calendar_posts` 0 | CAL + H + P0 |
| C22 (22) | 4 | 1,004 × 31 | K15 | 11,719 | 472 | `calendar_posts` 25 | CAL + H + P0 |
| C23 (23) | 0 | 1,000 × 26 | K02 | 190 | 408 | `calendar_posts` 0 | CAL + H + P0 |
| C24 (24) | 13,020 | 14,039 × 39 | K16 | 6,728,313 | 1557 | `calendar_posts` 13,050 | CAL + H + P0 |
| C25 (25) | 32 | 1,040 × 27 | K17 | 29,293 | 488 | `calendar_posts` 50 | CAL + H + P0 |
| C26 (26) | 0 | 1,000 × 26 | K02 | 190 | 406 | `calendar_posts` 19 | CAL + H + P0 |
| C27 (27) | 13 | 1,013 × 39 | K18 | 43,788 | 467 | `calendar_posts` 22 | CAL + H + P0 |
| Calendar_Config (28) | 0 | 1,000 × 26 | K19 | 26 | 373 | No dedicated table needed; empty/config schema only | H + P0; no enabled direct I/O found |
| C29 (29) | 6 | 1,006 × 35 | K20 | 3,253 | 428 | `calendar_posts` 38 | CAL + H + P0 |
| C30 (30) | 13 | 1,013 × 26 | K21 | 14,224 | 495 | `calendar_posts` 71 | CAL + H + P0 |
| S31 (31) | 0 | 1,000 × 26 | K00 | 0 | 419 | `content_samples` 0 | OLD-SAMPLES + H + P0 |
| S32 (32) | 0 | 1,000 × 26 | K00 | 0 | 396 | `content_samples` 0 | OLD-SAMPLES + H + P0 |
| S33 (33) | 0 | 1,000 × 26 | K00 | 0 | 432 | `content_samples` 0 | OLD-SAMPLES + H + P0 |
| S34 (34) | 0 | 1,000 × 26 | K00 | 0 | 492 | `content_samples` 0 | OLD-SAMPLES + H + P0 |
| S35 (35) | 0 | 1,000 × 26 | K00 | 0 | 402 | `content_samples` 0 | OLD-SAMPLES + H + P0 |
| S36 (36) | 0 | 1,000 × 26 | K00 | 0 | 413 | `content_samples` 0 | OLD-SAMPLES + H + P0 |
| S37 (37) | 0 | 1,000 × 26 | K00 | 0 | 426 | `content_samples` 0 | OLD-SAMPLES + H + P0 |
| S38 (38) | 0 | 1,000 × 26 | K00 | 0 | 423 | `content_samples` 0 | OLD-SAMPLES + H + P0 |
| S39 (39) | 0 | 1,000 × 26 | K00 | 0 | 442 | `content_samples` 0 | OLD-SAMPLES + H + P0 |
| S40 (40) | 0 | 1,000 × 26 | K00 | 0 | 421 | `content_samples` 0 | OLD-SAMPLES + H + P0 |
| S41 (41) | 0 | 1,000 × 26 | K00 | 0 | 431 | `content_samples` 0 | OLD-SAMPLES + H + P0 |
| S42 (42) | 0 | 1,000 × 26 | K00 | 0 | 454 | `content_samples` 0 | OLD-SAMPLES + H + P0 |
| S43 (43) | 0 | 1,000 × 26 | K00 | 0 | 412 | `content_samples` 0 | OLD-SAMPLES + H + P0 |
| S44 (44) | 0 | 1,000 × 26 | K00 | 0 | 380 | `content_samples` 0 | OLD-SAMPLES + H + P0 |
| S45 (45) | 0 | 1,000 × 26 | K00 | 0 | 394 | `content_samples` 0 | OLD-SAMPLES + H + P0 |
| S46 (46) | 0 | 1,000 × 26 | K00 | 0 | 399 | `content_samples` 0 | OLD-SAMPLES + H + P0 |
| S47 (47) | 0 | 1,000 × 26 | K00 | 0 | 400 | `content_samples` 0 | OLD-SAMPLES + H + P0 |
| S48 (48) | 0 | 1,000 × 26 | K00 | 0 | 396 | `content_samples` 0 | OLD-SAMPLES + H + P0 |
| S49 (49) | 0 | 1,000 × 26 | K00 | 0 | 381 | `content_samples` 0 | OLD-SAMPLES + H + P0 |
| S50 (50) | 0 | 1,000 × 26 | K00 | 0 | 380 | `content_samples` 0 | OLD-SAMPLES + H + P0 |
| S51 (51) | 0 | 1,000 × 26 | K00 | 0 | 436 | `content_samples` 0 | OLD-SAMPLES + H + P0 |
| S52 (52) | 4 | 1,004 × 26 | K22 | 1,103 | 393 | `content_samples` 4 | OLD-SAMPLES + H + P0 |
| S53 (53) | 0 | 1,000 × 26 | K00 | 0 | 408 | `content_samples` 0 | OLD-SAMPLES + H + P0 |
| S54 (54) | 7 | 1,008 × 26 | K23 | 3,258 | 426 | `content_samples` 7 | OLD-SAMPLES + H + P0 |
| S55 (55) | 1 | 1,001 × 26 | K24 | 225 | 388 | `content_samples` 1 | OLD-SAMPLES + H + P0 |
| S56 (56) | 0 | 1,000 × 26 | K00 | 0 | 412 | `content_samples` 0 | OLD-SAMPLES + H + P0 |
| S57 (57) | 1 | 1,001 × 26 | K25 | 374 | 431 | `content_samples` 1 | OLD-SAMPLES + H + P0 |
| S58 (58) | 0 | 1,000 × 26 | K00 | 0 | 419 | `content_samples` 0 | OLD-SAMPLES + H + P0 |
| S59 (59) | 12 | 1,014 × 26 | K23 | 3,088 | 417 | `content_samples` 12 | OLD-SAMPLES + H + P0 |
| C60 (60) | 0 | 1,000 × 26 | K00 | 0 | 399 | `calendar_posts` 0 | CAL + H + P0 |
| S61 (61) | 0 | 1,000 × 26 | K00 | 0 | 432 | `content_samples` 0 | OLD-SAMPLES + H + P0 |
| C62 (62) | 13 | 1,013 × 38 | K26 | 27,139 | 501 | `calendar_posts` 16 | CAL + H + P0 |
| S63 (63) | 0 | 1,000 × 26 | K00 | 0 | 420 | `content_samples` 0 | OLD-SAMPLES + H + P0 |

Calendar workbook: **7,592,542 response bytes**, 14,073 Calendar data rows and 25
old Samples rows. `calendar_posts` globally contains **14,659** rows at this
snapshot. Calendar_Config has zero data rows and headers `key,value,updated_at`;
its name matching the Calendar prefix does not prove application use. Sheet1 is
hidden and empty. Preserve or retire both under the final workbook decision;
do not invent tables simply to replace empty tabs.

## Workflow registry: enabled readers, writers and measured frequency

Last-day counts are retained execution starts across all statuses, read from at
most the latest 100 executions per workflow around 20:20 UTC October 2. They do
not prove that any particular Sheet node executed, that data was complete, or that
the execution succeeded. If all 100 fall in the day and an older page exists,
the count is a lower bound. A zero means no retained start in the measured window,
not "never called". The daily/monthly/weekly triggers use an unverified instance
default timezone; observed UTC starts are given where measured rather than
guessing daylight-saving behavior. Frequencies for page loads, operator scripts,
pipeline overrides and humans cannot be counted from execution metadata.

| ID | Workflow and scoped dependency | Trigger | Retained starts in last 24h |
| --- | --- | --- | ---: |
| `Q4n1bagJYBkurEaI` | CLIENTS METRICS: R Clients Info/Metrics/PostTracking, W Metrics/PostTracking; dual-write native | Daily default 00:00; latest 04:00 UTC | 1 |
| `DyVPx0neUZ94R0hJ` | TOP VIDEOS: R Clients Info; W TopVideos and native mirror | Daily 04:00; latest 08:00 UTC | 1 |
| `FD2QUIOlobkdLOgs` | MARKET RESEARCH: W research briefs/Hook Library; native roster R; summary/TopVideos/old roster branches disabled | Webhooks; summary timer disabled | 0 |
| `BrJSe8zCKUccfmIq` | VIDEO PRODUCTION AUTOMATION: R Video Editors; W Linear Submissions; native manager/filming index R | Intake/log/legacy webhooks | 17 |
| `alZ87zcRVKgcGVY7` | Monthly Check-in: R Monthly Checkup, sends normal monthly mail | Monthly day 1, 08:00; latest 12:00 UTC | 0 |
| `3hZnjXmHdNv4bttw` | Caption Prompts Get: R CaptionPrompts | Legacy/fallback read webhook | 0 |
| `RGkuE8d4uJg6CPde` | Caption Prompts Save: W CaptionPrompts | Legacy save webhook | 0 |
| `RFi70kokkNFHoRC0` | Append Client Row: native roster W; indirect outbox Sheet copy | Onboarding webhook | 1 |
| `udkwwzdFuPW3K2CE` | Slack Creative Channel Finalizer: native roster R/W; indirect Sheet copy | 15 min + webhook + daily 15:07 | 97 |
| `II3sJbSLrptmtWLR` | Content Ready Notify: native roster R | Notification webhook | 1 |
| `KViFEOqSRBNdCJRk` | CAL: Calendar Get, R request-selected Calendar tab | Legacy read webhook | 0 |
| `TcWOfnKd4Csdnnbv` | CAL: Kasper Queue batch, lists tabs and R Calendar-prefix batch | Legacy queue webhook | 0 |
| `pWSqaqVw7dmqhYOA` | CAL: Calendar Upsert Post, W selected tab | Legacy/client save webhook | ≥ 100 |
| `iA54ipMOybicmYBh` | CAL: Calendar Append Post, W selected tab | Legacy create webhook | 0 |
| `JcekBKUzELgX4HjH` | CAL: Calendar Delete Post, update selected tab | Legacy delete webhook | 0 |
| `OXd0sUoSJYMspGTF` | CAL: Calendar Reorder, code-issued selected-tab writes | Legacy reorder webhook | 0 |
| `lTtZNLrQLpIZqwAY` | CAL: Calendar Reorder batch, code-issued selected-tab writes | Legacy reorder webhook | 0 |
| `o6wWaGNlIlyZFTX7` | TikTok Submit: W TikTokUpload | Upload/schedule webhook | 2 |
| `qGJ7mUjml98DSiGo` | TikTok Submit Direct: W TikTokUpload | Direct upload webhook | 1 |
| `iYb1896sIAclGvy8` | TikTok List: R TikTokUpload | Page list/reload webhook | 24 |
| `IjayuU6jkA21aKo3` | TikTok Status: R TikTokUpload | Per-job page status poll | 5 |
| `1qZmOQPtG6rKYlK7` | TikTok Result: W TikTokUpload | Provider callback | 3 |
| `4ca3li54eRFtSfXE` | TikTok Cancel: W TikTokUpload | User cancel webhook | 0 |
| `jlVfbg0Njxf1It7h` | Weekly Backup: copies all main-workbook tabs | Weekly Sunday 02:00; last September 27, 06:00 UTC | 0 |

CAL's list-and-prefix capability can include Calendar_Config; its zero-row schema
does not match a post schema. Resolve this explicitly in retirement validation.
`pWSqaqVw7dmqhYOA`'s sample of 100 runs spans only about 4h21m, so ≥100 is not
a daily total. Finalizer's 97 retained starts agree with its timer plus other
triggers but do not prove per-node Google traffic after its native change.

### Dormant and archived dependencies: reactivation requires a new check

These are retained **capabilities**, not current writers. The table includes all
other scoped bare-id matches from the live census. Personal workflow/node names
are deliberately replaced with functional descriptions. R/W follows declared
Sheet node operations; code/HTTP repair graphs can have broader effects than a
tab label implies. "Workbook" means the graph names the file but the exact tab
set is not closed by the summary. They may not be treated as safe to reactivate
unchanged. Active native workflows without a remaining workbook id are in the
registry above, not this dormant set.

| Workflow id | State | Tab/dependency capability found |
| --- | --- | --- |
| `0KMfHmYqVdlr5EhG` | Archived, inactive | `Clients Info`, `Competitor Briefs`; appendOrUpdate |
| `23jv00ihCX75TjaB` | Archived, inactive | Calendar/Samples workbook; tab set requires graph review; appendOrUpdate |
| `2JxqOqTUtlfUWI9N` | Inactive | `Clients Info`; appendOrUpdate |
| `3WDxAYW23RBJTuFW` | Archived, inactive | Calendar/Samples workbook; tab set requires graph review; update |
| `3ZA0GIMuklByBScV` | Inactive | `Clients Info`; appendOrUpdate |
| `4p3IWVnSaFNFhGWv` | Inactive | `Clients Info`, `Social Media Managers`; appendOrUpdate, read |
| `6UyCt01RNlt2YO9B` | Inactive | `Clients Info`; appendOrUpdate |
| `7KOBjIctCzhFug6G` | Archived, inactive | `Clients Info`, `FilmingPlans`; read |
| `7Pdp6qnkBzwXP3YG` | Inactive | Calendar/Samples workbook; tab set requires graph review; create |
| `8LN6ReEIPhhWxA6v` | Archived, inactive | `Clients Info`, `Social Media Managers`; read, update |
| `8YKQOTKToXRhg55x` | Archived, inactive | Calendar/Samples workbook; tab set requires graph review; create |
| `ABiN18oLVsE0X5Pt` | Inactive | `Clients Info`, `Social Media Managers`; delete, read |
| `AHTwSZPubALe6OJU` | Inactive | `Clients Info` |
| `BTxic5NSaCMtZMh6` | Inactive | `Clients Info`, `TopVideos`; read |
| `DSGueaM3b6gMIXoi` | Archived, inactive | Calendar/Samples workbook; tab set requires graph review; appendOrUpdate, read |
| `G6MtkXq8iJNWSq0b` | Archived, inactive | `Social Media Managers`; append, read |
| `HtvNpunAw4uzw7lW` | Archived, inactive | `Video Editors`; appendOrUpdate |
| `HyrucW0X8ckJogip` | Archived, inactive | Calendar/Samples workbook; tab set requires graph review; read |
| `JGHnZ1FFk3kQj2rg` | Archived, inactive | Main workbook; tab set requires graph review |
| `K1iSkFMQCroJvbPc` | Inactive | `Clients Info`; appendOrUpdate |
| `L8mem5VAJyNZiuk7` | Inactive | `Clients Info`; appendOrUpdate |
| `LRf1OxhXlyv5YEyV` | Inactive | `Clients Info`; appendOrUpdate |
| `M965r8ncOxVKTOPu` | Archived, inactive | `Clients Info`, `Social Media Managers`; read, update |
| `QibBgR4ahxWbCo30` | Inactive | `Clients Info`; read |
| `QryNyRMmL0zH2IV4` | Archived, inactive | `Clients Info`; update |
| `RhEdtimfMUeogyL2` | Archived, inactive | `Templates`; read |
| `SpcNARgYcEdwCmHA` | Archived, inactive | `Clients Info` |
| `TJVMyfwl85qrFGeK` | Inactive | `Video Editors`; read |
| `VAqlVLk8wczPq6DQ` | Inactive | `Clients Info`, `Monthly Checkup`; read |
| `WSaAO8nwhohZc20s` | Archived, inactive | Calendar/Samples workbook; tab set requires graph review; appendOrUpdate, read |
| `XDNOS6jelOAAOrWq` | Archived, inactive | `Clients Info`, `FilmingPlans`; append |
| `d7Dod7OuQsVsl1CN` | Inactive | Main workbook; tab set requires graph review |
| `e7IQzG58w5dRNSvV` | Inactive | `Clients Info`; appendOrUpdate |
| `escUelK09j2l4Vlf` | Archived, inactive | Calendar/Samples workbook; tab set requires graph review; delete |
| `gB17L9M5yYxxk6GT` | Inactive | Calendar/Samples workbook; tab set requires graph review; create |
| `he5wg76rhWa7fq6a` | Archived, inactive | `Clients Info`; appendOrUpdate |
| `iZV5r0Yi8lvrkpkO` | Archived, inactive | Calendar/Samples workbook; tab set requires graph review; appendOrUpdate, read |
| `iz42ILXhZ3eBj3IJ` | Inactive | `Social Media Managers`; read |
| `kNyElFk9Nhgs8f5V` | Archived, inactive | Calendar/Samples workbook; tab set requires graph review; appendOrUpdate |
| `nBSX0Nr77E10LYQ6` | Archived, inactive | Main workbook; tab set requires graph review; read |
| `oPX1nH7TxzCITNAz` | Archived, inactive | `Templates`; appendOrUpdate |
| `qkYVCvs6BdzjAIH1` | Archived, inactive | Calendar/Samples workbook; tab set requires graph review; append |
| `tzHL7vV2n4IZUCGW` | Inactive | `Clients Info`; appendOrUpdate |
| `ukLGHr6uDJIEP1pM` | Inactive | `Clients Info`, `TopVideos`; read |
| `vb3O0wkTK6Q7Rtro` | Inactive | `Clients Info`, `Market Research Briefs`; appendOrUpdate, read |
| `xOVa10JrMFXAe2xJ` | Inactive | `Clients Info`; appendOrUpdate |
| `y3rEWCVdB0esN3tO` | Inactive | `Social Media Managers`; read |

OLD-SAMPLES owners are archived Get `HyrucW0X8ckJogip`, Upsert
`23jv00ihCX75TjaB`, Reorder `3WDxAYW23RBJTuFW`, verify-upsert
`iZV5r0Yi8lvrkpkO`, and inactive provisioner `7Pdp6qnkBzwXP3YG`.
Archived Calendar setup/migration/repair/selftest graphs and inactive Calendar
provisioner `gB17L9M5yYxxk6GT` are retained in the table. The inactive Manager
Sync `y3rEWCVdB0esN3tO` no longer establishes Sheet authority.

## Proposed order and reviewable slices

This is a proposal for finishing **A**, not authorization to apply, deploy, edit
n8n, protect/archive a file or retire a workflow. Lighthouse merges each future
slice after review. Existing Roster and Harbor work keeps its owners; do not
duplicate it. Other slices have no implementation-session assignment yet:
the owner/Lighthouse assigns one when scheduling them.

| Order / slice | Concrete result and boundaries | Proof before switch / way back | Owner decision needed |
| --- | --- | --- | --- |
| 1. Roster closeout | Finish native page roster and Kasper manager read; redirect daily active-roster sync; account for analytics collectors still reading the read-only Sheet. Keep native edits mirrored until those readers leave. | Compare assignment membership/Slack link and all 15 profile columns, including `extra`; TEST edit/assign/create/archive and reload; no stale Sheet copy overwrites native state. Preserve documented outbox catch-up before authority rollback. | Confirm completion of current switch, direct-human access/protection, page read role, and the final copy-stop/archive date. Each further n8n edit needs explicit go. |
| 2a. Harbor metrics + PostTracking | Finish the shadow already deployed, then native metrics producer with tracking committed together; remove daily Sheet dependency for these datasets only when no fallback needs it. | Accepted TEST + one real cohort on day 1, all clients for three clean days; provider-failure/zero/last-good receipts and tracked daily delta comparisons. Pause native collector and restore n8n only after native-to-Sheet catch-up, preserving tracking checkpoints. | Apply accepted cohort/spend policy; explicit go to switch production writer and deactivate CLIENTS METRICS after the bar is met. No duplicate scraper job from another session. |
| 2b. Harbor Top Videos | Apply/deploy the source-only step 2; replace append collector, then detach TopVideos Sheets copy/fallback. Store full history but retain the 90-day browser window. | Three clean shadow days under Harbor plan, rank/empty/provider-failure coverage, append fingerprints and latest-receipt completeness. Catch up before restoring the old job. | Separate apply/deploy and later deactivate TOP VIDEOS; preserve-or-discard the one unnamed L cell. |
| 2c. Harbor Market Research + hooks/summaries | Native brief writer plus Hook Library table/save door; same webhook behavior, acknowledgements and normal notification behavior. Decide disabled summaries before any new scheduler. | TEST webhook/save replay and no duplicate hook; preserve JSON splits; full valid-row brief/summary parity. Flags hold native readers/writers until ready; retained Sheet catch-up is the rollback. | Activate or retire disabled summaries, whether historical competitor briefs belong in the archive, hook ownership/duplicates and explicit n8n writer change. |
| 3. Video Editors | Staff-native editor membership/assignment door for VIDEO PRODUCTION AUTOMATION and any approved urgent path. No page redesign required. | Reconcile four Sheet editors against active video-team members without creating unknown staff or changing assignment load rules; TEST default and missing Slack-id outcomes. Flagged read rollback to a frozen equivalent copy. | Canonical member/assignment owner, who can edit, defaults and notification fallback; explicit reader-node edit when ready. |
| 4. Already-native settings cleanup | CaptionPrompts fallback/legacy save retirement, Templates and FilmingPlans historical coverage. Preserve actual Docs, creative preferences, runtime flags and normal messages. | Compare mapped fields/links and both prompt-header variants; cold/reload/reconnect/error recovery on TEST; zero remaining Sheet calls over the agreed window. Roll back each reader flag to its retained copy. | Confirm 30-day bake for legacy prompt Save, when Get can end, reconcile native-only rows and approve old-tab archival. Do not overwrite 40 native rows with seven or 31 Sheet rows. |
| 5. Calendar and old Samples retirement | Finish native **client** approve/request-changes move under phase-2 K; current staff native writes remain. Reconcile historical Calendar rows, old `content_samples`, config and empty tabs, then remove legacy read/write dependencies. | Exact `(client,id)` census, duplicate/field/order/comment/approval comparison and archive-policy accounting per C/S tab. C04/C17/C20 have more exported rows than native: investigate, do not re-import stale status blindly. Client save/reload/comment recovery and refusal tests with TEST only. After the minimum bake, zero-call proof for every legacy endpoint, old queued/cached caller handling and a restore rehearsal. Preserve tokenless frozen endpoints; rollback flags/caller transport with matching native-to-Sheet catch-up. | Explicit go for client workflow changes (existing client buttons were previously left untouched), disagreement disposition, old Samples destination, bake end and individual workflow retirement. Earliest October 29 for September 29 staff-save release; this snapshot alone does not satisfy it. |
| 6. TikTok upload ledger | Dedicated Post For Me TikTok table and authenticated list/status/save/cancel doors; one provider job id and callback binding, migrate all 245 existing rows and pending schedules. | Full ledger parity, failed/unknown/pending truth, callback-before-response, duplicate callback, cancel race and retries reconcile existing provider success. Sandbox/internal TEST evidence before any real post; no real publishing authorized by this map. Rollback maintains the same provider job ids and catches up the Sheet, never creates a second upload. | Account/job authority, history retention, callback source/auth contract, approved provider test method and explicit changes to six n8n endpoints. Direct TikTok pilot remains separate. |
| 7. Native intake recovery log | Replace Linear Submissions **pre-save** fallback with a recoverable native request captured before the gateway, plus linked post-success receipt. Preserve declined submissions and required normal notifications. | Refused/timeout/refresh/duplicate/accepted paths; request id joins existing native jobs; durable recovery without the original browser. TEST only. Dual-log during comparison; rollback to old logger without duplicate production work. | Who may recover requests, retention, permitted payload fields/secrets exclusion and whether a save waits for the recovery receipt. Explicit logger workflow edit, not retirement based on Linear's cancellation. |
| 8. Monthly Checkup | Explicit database mailing cohort plus native schedule/sender replacing only this Sheet-based reminder. | Compare five recipients privately; deterministic month/recipient receipt and restart/retry duplicate suppression; no sends during preparation. Keep old job inactive/available after native switch. | Keep/retire mail, exact cohort, sender/destination, send-time timezone, retention and permission for a real internal TEST send and later scheduler switch. |
| 9. Human-only contacts and history | Videographer Contact gets a native contacts screen/import if still used; historical Legacy Clients, headerless Old_Clients and retired Competitor Briefs get a restricted native archive or explicitly accepted frozen retention. Empty Competitors/Sheet1/Calendar_Config need no invented active feature. | Aggregate import counts plus private exact record/column comparison; preserve unmapped fields and provenance. Historical client records remain archived and cannot enroll current clients. Reversible export/restore of the archive. | Human owner/frequency, field meanings for headerless rows, archive access/retention and whether to retire any task. "No bot found" cannot make this decision. |
| 10. End shared dependencies, then freeze the two workbooks | Remove residual CSV fallbacks, daily Sheet copies/parity/roster jobs, manual reader assumptions and **the Sheet leg only** of Weekly Backup once all prior slices have replacements. Keep native backup with a tested restore, and retain frozen originals for the agreed period. | Second differently shaped source/graph scan, complete caller census, rolling execution/node-call evidence over the agreed interval, history/field parity and native restore proof. No active pending jobs or offline queues can still require the old file. One reversal plan per retired endpoint/job and workbook. | Final Google-independence acceptance, backup destination/restore owner, how long frozen originals remain and explicit archive/retirement go. No deletion proposed. |

The deployment/apply go, the live workflow edit go and the later retirement go are
distinct decisions. Existing authorizations in Roster/Harbor plans remain with
their sessions; this document grants none. Do not turn a configured schedule,
deployed function, equal count, zero retained run or local test into hosted/live
behavior proof.

## Verification and limitations

- Measured all 84 tabs, including hidden/empty ones; 252 CSV downloads, zero errors,
  unchanged counts/sizes within the samples. Native header/row sentinels caught
  the headerless Old_Clients and duplicate CaptionPrompts headers.
- Independent workflow sweeps reconciled all 68 in-scope workbook references;
  active published versions, disabled/disconnected branches and 23 execution
  metadata samples were checked; Weekly Backup was read separately.
- Existing read-only `node scripts/sheets-mirror-parity.js --strict`: first run
  printed Metrics clean then ended `parity failed: fetch failed` (exit 1).
  Retry completed all five datasets: Metrics 5,204, TopVideos 2,771,
  ContentSummaries 1, briefs 13, profiles 36 groups, all zero differences;
  final line `PARITY: clean` (exit 0). TopVideos parity covers the existing 90-day
  window; ignored/unnamed fields and full retired history are separate gates.
- Native-table counts and deployed versions above are live observations, not
  proof of deployed source byte equality, successful shadow collection, every
  human reader, every pipeline override, protected Sheet edits or provider health.
  No Calendar or historical Samples field/id parity was run. This is the precise
  reason slice 5 remains open despite native tables already existing.
- Local documentation/index/identity validation is recorded in the PR handoff.
  Full app suite and live save/publish/notification drills are outside this
  documentation-only change. Lighthouse reviews and merges; Cartographer does
  not merge or deploy.

Source anchors: [shared data readers](../../src/index/040-shared-briefs.js.part),
[manager queue](../../src/index/305-core-kasper-shared.js.part),
[prompt read/save](../../src/index/180-calendar-native-post-media.js.part),
[pre-save intake log](../../src/index/200-intake-data-startup.js.part),
[TikTok page](../../src/index/300-tiktok-upload.js.part),
[native profile writer](../../supabase/functions/client-profile-write/index.ts),
[roster mirror](../../supabase/functions/_shared/roster-sheet-copy.mjs),
[dataset/field rules](../../supabase/functions/_shared/sheets-mirror.mjs),
[daily copy/parity](../../.github/workflows/sheets-mirror-daily.yml),
[daily roster sync](../../.github/workflows/clients-roster-sync.yml).
