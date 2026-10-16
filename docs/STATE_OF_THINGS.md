# State of things

Find any running piece and its owner in the [SyncView Atlas](ATLAS.md).

**Read this first.** One short, true list of what is open, what is switched off on
purpose, and what is already done even though an older doc still calls it open.
Every line below was checked against the live system on **2026-09-26** (read-only
SQL on `syncview_runtime_flags`, tables and row counts; the live Edge Function
list; the n8n workflow list). Where a doc and the live system disagree, the live
system wins and this page says so. Counts only, no client names.
Lines marked **(measured 2026-10-09)** were re-checked that day by session Shipwright
(OPEN_REPAIRS 389); the owner's remaining steps are one ordered sitting in
[`docs/ops/OWNER_SHIP_LIST.md`](ops/OWNER_SHIP_LIST.md), and `node scripts/repo-vs-live.js`
prints repo vs live for the whole shelf.

When you close or change something here, update its line in the same PR. If a
line is older than a week, re-check it before relying on it.

---

## Latest (Lighthouse, 2026-10-16)

Newest first. Checked against main and the live database on 2026-10-16. When an item here is finished or moved into
the sections below, delete it from this block in the same PR.

**Live on 2026-10-16 (Sidney's one-function runs, checked by Lighthouse):**
- **`calendar-card-write` v1** deployed about 13:23 UTC. Lighthouse put the test client on `calendar_card_write_clients`
  (`{"clients": [test client]}`) at 13:33 UTC, so staff saves on the test client now go to the new writer; every other
  client and every client review link stay on `calendar-upsert`. An unsigned save is refused (401). Step 2 of the
  retirement plan (two working days of real test-client use, watching the function log, the ledger and the refusal log)
  starts now. Way back: take the test client off the switch.
- **`frameio-view` v3** (Lens #2100's polish) deployed about 13:34 UTC. `frame_viewer_clients` is unchanged.

**Live since the last update (2026-10-11 to 2026-10-15):**
- **Notify client** (#2080, #2084, #2088): one Slack alert to the client's private channel, short box that closes by
  itself, and the "Review now" link opens the Review view. The button is there for every client; 3 alerts recorded so far
  (checked 2026-10-16).
- **Messages** (#2079, #2083, #2090, #2092): a page under the header, the reviewer view follows the reviewer's threads,
  a hidden client message shows once staff answered it, and the phone version has native conversations with a docked reply.
- **Watch here, Frame.io inline viewer** (#2091): the Review tab plays the video in place. Switch `frame_viewer_clients`
  is on for the test client only; everyone else waits on the owner's word.
- **Caption helper** (#2077, #2086, #2095): call to action, platform, note, title ideas, hashtags; Redo as a pop-up that
  uses the video's own words (new `caption_jobs` columns `transcript` and `transcript_asset`, applied) and never saves a
  chat reply as the caption. `caption-generate` runs every caption (`caption_generate_ef_clients` = all, since 2026-10-09).
- **One client's caption prompt replaced** at the owner's go (2026-10-15); the old prompt is kept as a backup row in
  `caption_prompts` (name starts `_backup_`).
- **Synchro connector** (#2093): tool calls are logged to `hf_activity` with who and a one-line summary, best effort (a
  failed log write is dropped, never blocks the call; refusals are logged as failures), and a `guide` tool reads `hf_guides` (5 topics live; the newest row per topic wins, so a guide
  changes with no reinstall). The team skill `synchro` is managed in the Claude organization settings; its master copy is
  in the synchro-brain repo (`team-skills/synchro/SKILL.md`).
- **Pop-ups part 2** (#2081) and SyncLinear "Back to card" (#2078).

**Merged 2026-10-11 to 14 and not recorded here at the time (added 2026-10-16; Lighthouse missed these, see the
supervisor manual's "Writing it down"):**
- Calendar: status filter (Show only / Hide on the overall card status, #2043, item D3 below); clear on the pill, work item
  hover card, per-card files menu (#2059, #2064); background refresh keeps what the person is using and is invisible (#2061,
  #2065); a wheel over a long open caption scrolls the caption (#2057).
- Thumbnail titles: month fallback, long and template plans, re-queue, borrowed-tab check, cleaner default prompt (#2041,
  #2042, #2048).
- Phone: staff phone polish, Tabs grid, round 2 from the owner's own phone notes (#2047, #2050, #2056); dark mode contrast
  gate (#2049); Templates Audience section and Copy button (#2051).
- Notes and Messages: Notes step 1 (quiet composer, folding threads, #2060), done and delete reach the canonical thread
  (#2053), Notes step 2 Messages inbox for all staff (#2063, #2066, #2071), old-notes label script ran (#2062).
- Today: lists sorted by upload date with a date pill, cards and SyncLinear open in new tabs (#2070, #2072).
- Pop-ups part 1, one rule for Escape, outside click, focus and kept text (#2076).
- Frame.io key keeper `frameio-token` (#2053 branch) and Watch here first version (#2074).
- Connector: client_brain and brain_change tools (#2058), the person named on the shared team link, renamed "synchro"
  with an icon (#2068, #2069).
- Hiring: the 2026-10-14 audit findings and n8n fixes recorded in `docs/truth/` (#2073, #2075).
- Backups and robots: Track-B corpus v13 (#2046); monitoring pages only a confirmed failure; robots read their own admin key
  (#2027); calendar-upsert live delta lane (#2040); Production CI back to normal with no branch exceptions (#2055).
- n8n changes by Lighthouse that were not logged at the time are now in `docs/ops/N8N_EDIT_LOG.md`: the 2026-10-06 sales
  email fixes, CLIENTS METRICS and TOP VIDEOS off (2026-10-06) and four Calendar workflows off (2026-10-13). The 2026-10-06
  sales edit dropped the video-editor interview admit; another session restored it on 2026-10-14.

**Owner decisions, 2026-10-15 and 16:**
- **Staff use only the Synchro Social organization Claude accounts.** The skill and connector live in the org settings.
- **Every Edge Function deploys itself on merge** (session Conveyor, building). The owner's single "yes" is at the start of
  a request, not per deploy. **The F27 Section 4 capture moves off the owner's computer into GitHub** (Conveyor follow-up),
  so the three core save functions stop depending on a script on one machine.
- **`calendar-upsert` gets retired, carefully** (session Sunset; the measured caller map is #2097: 14 callers, about
  1,200 real saves a day). Plan: a new, small, separate function; move the test client first, then staff, then client
  review links last; the old route stays as an automatic fallback for about 14 days; then delete the old function.
  Nothing a client sees changes until the staff move has run clean. Until then `calendar-upsert` stays frozen.
- **Old n8n "SyncView Calendar, Generate Caption" workflow: DONE 2026-10-16.** Sunset's #2102 removed the page fallback
  (merged, checked live), then Lighthouse switched the workflow off (not deleted; N8N_EDIT_LOG). Original decision:
  **switch off, not delete.** Zero runs since 2026-10-09. First the
  page's fallback to it (`GENERATE_CAPTION_URL`) is removed (Sunset); once that is live, Lighthouse deactivates the
  workflow (owner's go given 2026-10-16 on that condition) and logs it in `docs/ops/N8N_EDIT_LOG.md`.
- **Messages:** clicking Messages again closes it and returns to where you were, and it gets a Close button (reverses the
  earlier "no Close button"). In #2089 (Swift).
- **Caption box:** a small regenerate icon replaces "Redo with a note" (#2098, Quill): merged 2026-10-16, live with the next Pages publish.
- **Frame.io pop-up polish** (session Lens): faster, autoplay, a vertical layout for phone videos, one comment list
  (Frame.io and SyncView notes together), less text, one Open/Reply button, no "FRAME.IO" label, full quality on the Review tab.
- **After Vista: a lifecycle review session** that walks every dependency end to end and tests everything, so nothing
  from the moves off Sheets, n8n and Linear is forgotten. Lighthouse writes its prompt once Vista and the review-sheet
  changes settle.

**Open sessions and where they stand (2026-10-16):**
- Swift #2089 (Messages opens fast, Close button, click again to close): merged 2026-10-16 04:35 UTC (`599b7a22`); the page
  part is live with the next Pages publish. Its `production-comments` speed-up (parallel reads) is NOT deployed on purpose:
  the only lane for it (deploy-onboarding-edge-functions) also redeploys `production-write`, which now differs from live
  (Scribe #2096) and should go through the Section 4 path with its rollback capture. It ships with Conveyor's deploy on
  merge (#2101). The page works with the old function meanwhile.
- Anchor #2094 (production-polish gate waits for the app instead of guessing): fixing its own boot-budget runs.
- Scribe #2096 (a note shows the moment it is sent): merged 2026-10-16; the page part is live with the next Pages publish.
  Its small `production-write` change (the Slack sender wakes after the answer, not before) waits for the next F27
  Section 4 deploy; nothing breaks meanwhile. The fingerprint is re-pinned, so the next Section 4 deploy must use a main
  that includes #2096.
- Sunset #2097 (calendar-upsert map and retirement plan, docs only): merged 2026-10-16. Next: the fallback removal, then the new function.
- Quill #2098 (regenerate icon): merged 2026-10-16.
- Lens #2100 (Frame.io pop-up polish): merged 2026-10-16 03:31 UTC (`43d39e46`); the page part is live with the next Pages
  publish (still test client only). Needs a `frameio-view` deploy (deploy-single-function, merge SHA above); until then the
  old function answers with everything at once and the video still plays.
- Conveyor: auto-deploy on merge and the capture in GitHub; merges last.
- Thumb #2085 and #2087 (phone Calendar, Samples, Workload): waiting for Thumb to merge main.
- Vista: review sheet polish, running.

**Waiting on the owner:** the five doctor-funnel changes from Rewind; the branding session; the Frame.io viewer for every
client; the follow-up Slack message asking who still uses a personal Claude account.

---

## The owner's priority order (set 2026-09-29, keep this current)

The owner asked for this list to live here so no session loses it. Work top down.
When an item is done, move it to "Done" below in the same PR; when the owner
reorders or adds, edit this list, never a side document. **The supervisor
(Lighthouse) updates this file after every merge, owner decision or stalled
session, in the same sitting.** A session that stops without pushing is recorded
here with where it stopped, so it can be restarted.

**Owner direction, 2026-10-01 (the big picture, in order). This order outranks the numbered list below: work A before B, and treat the numbered items as the detail and history of each.**
- **A. Move everything off Google Sheets.** Every tab of every sheet SyncView or the pipelines read or write
  moves to Supabase (dual-write, flagged read, parity, then retire, as in
  `docs/plans/2026-09-24-sheets-to-supabase.md`). Clients Info is first and already copied daily; the Clients
  admin tab is the start of its replacement. The owner will improve that UI.
  **Scope, owner 2026-10-02:** only the main SYNCVIEW Sheet and the SyncView Calendar workbook are in scope; other
  Drive files are left alone. Project Central: archive (needs an n8n edit, owner's go). **Clients Info and Social
  Media Managers (session Roster): DONE 2026-10-02, live.** The database is the main copy (`client_profiles_authority` =
  `{"source":"syncview"}` since 20:00 UTC); six n8n workflows read or write through `roster-read` / `roster-write`; Manager Sync is off;
  the Sheet tabs are a mirror kept by the database, still editable by people until the owner protects them in Google (OPEN_REPAIRS 331, `docs/ops/N8N_EDIT_LOG.md`). Still open: the owner protects
  the two tabs in Google; the Finalizer's first real client is its end to end proof;
  CLIENTS METRICS and TOP VIDEOS keep reading the Sheet until Harbor's port. Beacon (onboarding) will extend the Clients tab.
  Cartographer's measured remaining map (84 tabs, readers/writers, costs and owner-gated slice order): [2026-10-03 Sheets remaining map](plans/2026-10-03-sheets-remaining-map.md); evidence 2026-10-02, including live Roster progress beyond the older status above.
  **Slice 1, the page's own two reads (session Quarry, 2026-10-08, OPEN_REPAIRS 374): merged (#1997), NOT live (measured 2026-10-09):
  `analytics-read` is still v21 from 2026-10-02, the switch has no `roster` key, and the daily copy has not run since the fix
  merged. Owner steps 2 to 4 of `docs/ops/OWNER_SHIP_LIST.md`.** With
  `"roster": "database"` in `analytics_mirror_read_enabled` the page never downloads Clients Info or Social Media Managers (client
  list from `analytics-read`, review queue managers from `smm-weekly-reports`); merging deploys nothing (`analytics-read` gains a
  client-row-only read for links the numbers read is not on for, deployed by hand). Parity measured 2026-10-08 (read only): Clients Info 36 of 36 rows equal, all columns; manager assignments 41 and
  41, 0 differences. The daily copy job failed every day from 2026-10-03 (it tried to copy Clients Info, which the database now owns,
  and stopped before Metrics); this PR makes it skip Clients Info and adds the manager comparison. Steps:
  `docs/ops/ROSTER_PAGE_SWITCH_STEPS.md`.
  Analytics are paused by owner decision (2026-10-06): CLIENTS METRICS, TOP VIDEOS and their replacement jobs are off on purpose.
- **B. Move off n8n.** Phase 2 plan, step by step (item 6b below).
  TikTok Upload (Courier, OPEN_REPAIRS 362): LIVE on Supabase since 2026-10-07 17:42 UTC (`tiktok_upload_source` = `supabase`,
  sheet rows copied). Six n8n TikTok workflows switched off 2026-10-08 on the owner's go (`docs/ops/N8N_EDIT_LOG.md`). Still on:
  `TikTok Upload, Result`, because Post For Me's result webhook points at it. Courier's result action is deployed (`tiktok-upload`,
  2026-10-08 15:44 UTC); the webhook is not re-pointed yet: the n8n workflow ran 7 times on 2026-10-07 and 08 (measured 2026-10-09,
  OPEN_REPAIRS 370; owner step 6 of the ship list). Calendar Upsert Post and its Comment Merge helper were switched off the same day (zero runs since
  2026-10-07 15:00 UTC; the page never sends Calendar saves to n8n since #1858).
- **C. Onboarding (session Beacon, 2026-10-02: the checklist is built and in use on the test client).** The
  checklist tables, the `client-onboarding` and `client-hubspot-sync` functions are live, and the Clients tab now
  shows, under a client's details, the HubSpot deal and contract and payment state, the Resources list and the
  27-step checklist (admin only; OPEN_REPAIRS 332). Next, each with the owner's go: "Create client" (step 2.5),
  then the matching pass for the current clients (Stage 3). Plan: `docs/plans/2026-10-01-onboarding-checklist-and-profile.md`.
  **"Create client" is LIVE since 2026-10-08** (OPEN_REPAIRS 372): both migrations applied, `client-onboarding`
  deployed, throwaway create and teardown passed (Lighthouse). **Its Slack nudge is applied** (PR 2011, live database checked 2026-10-10):
  real clients only, no n8n edit; the database nudges the existing finalizer webhook after a create and when a filming
  plan link is saved, the 15 minute timer covers the rest. Clients who never fill the form
  would need an n8n change, written out in `docs/ops/CREATE_CLIENT_LIGHTHOUSE.md` for the owner's go.
  **A real client no longer needs an email** (owner decision, OPEN_REPAIRS 385): LIVE (measured 2026-10-09): the SQL is
  applied (no email check in `client_create_native`, EXECUTE closed to `anon` and `authenticated`) and `client-onboarding`
  was deployed 2026-10-09 01:37 UTC at #2015, after its last change, so the apply and deploy parts of steps 6 and 7 of that file are done (their throwaway checks are not recorded).
  **Stage 3 dry run done**, nothing saved:
  `docs/audits/2026-10-08-stage3-matching-dry-run.md` (Drive folder found for 31 of 35, HubSpot deal for 25; 192 high
  confidence proposals waiting for the owner). Next: the owner approves batches; the approvals screen (3.3) is not built.
  The measured picture of how a client is onboarded today (every step, every per-client resource with
  counts, and the owner's decisions) is `docs/audits/2026-10-01-client-onboarding-as-it-really-is.md`.
- **D. Navigation, then look and feel.** The owner plans to start this himself the weekend of 2026-10-03
  (item 7).
- **D2. The phone experience (owner direction, 2026-10-02).** The whole site gets a phone-first design, tab by
  tab, built by a Codex session with a real (not headless) browser the owner sets up with it first. Hard constraint:
  **nothing changes on desktop** (same bytes at desktop widths, proven by the existing desktop gates and screenshot
  diffs). On a phone each tab may look and behave differently from desktop; the bar is a first-class app (the owner
  named Wise as the reference): speed, button placement, one-hand use. Delivered in slices, one PR per tab, Lighthouse
  merges, test client only for live proof. Starts after Beacon's checklist panel (#1941) is on main.
- **D3. Calendar status filters (owner request, 2026-10-02, after the phone work).** The Calendar gets filters on
  the overall card status, including EXCLUDE (for example hide every approved post). "Overall status" means the
  card's existing computed overall status (the roll-up of video, graphic and caption that the card already shows;
  title review stays out of it, as designed). The filter reads that value; it does not redefine its inputs.
  **Built 2026-10-11 by session Sieve, merged the same day (#2043), live.** A "Status" pill beside Organize in Sheet,
  Month and Week (not Review, not the client link): Show only or Hide, any set of the nine overall statuses, remembered
  per client with the month and dated/undated filters, and a strip above the cards says what is on with a one-tap Clear
  (on a phone the pill sits in the More sheet and the strip is what shows). Test:
  `node docs/syncview-design/tests/calendar-card-status-filter-browser.js`.
- **Open question raised 2026-10-01:** Analytics "views in 30 days" and "views gained today" look too high for at
  least one large client (the stored source rows themselves carry the large numbers, so the page shows what the
  daily metrics job wrote). Needs an accuracy check of how that job counts views before the analytics switch-on.

1. **DONE 2026-10-01: analytics database on for every client.** The accuracy check found the stored view
   counts right; the 20 duplicate Metrics rows were removed (OPEN_REPAIRS 309) and `analytics-write` redeployed;
   the 16:31 UTC daily run ended `PARITY: clean` (0 differences in all five datasets); Lighthouse then set
   `analytics_mirror_read_enabled` to `{"enabled": true}` with the owner's go (EXECUTION_LOG.md). Rollback, one step:
   set it back to `{"enabled": false, "clients": ["<test client slug>"], "staff": true}`. Still to do: the
   one-message Slack alert (under "Needs the owner") and watching that the daily lane stays green.
2. **2026-10-01: n8n measurements for the plan-downgrade decision.** September
   is the first full month the execution-quota watchdog counts. Report the real
   monthly executions against the plan tiers (sizing in OPEN_REPAIRS 233: about
   100k a month, a 50k plan does not fit without cuts) and what would have to
   stop to fit a smaller plan. No n8n edits without the owner's go.
3. **Load-per-tab, step 4: DONE, merged 2026-09-29 (#1848, main
   `e5f36d6e5a55202b978ab3f666893de50c27d34c`).** Signed-in staff now load the page in parts; client
   links, forms and signed-out visitors still get the whole script as one file.
   Mason measured staff first load on a 4G phone at 2,652 ms before and 1,768 ms after.
   Vigil's six hand-test steps passed on the live site. Way back:
   `node scripts/split-switch.js off`, commit, merge; one browser: `?split=0`.
   SyncLinear stays in the always-loaded part (owner, 2026-09-29).
4. **Failed saves: finish the log.** Built: the write-refusal log (#1499), an
   admin page to read it (#1792), and (2026-09-29, OPEN_REPAIRS 290) refusals from
   every other save: Templates, Filming plans, caption prompts, Workload dates,
   TikTok, Hiring, credentials and the rest (list in
   `docs/audits/2026-09-29-write-paths-refusal-coverage.md`, kept honest by a test).
   Measured live 2026-10-09: `traffic` fills for browser reports and for the gateway's own
   rows (all 542 gateway rows since 2026-10-08 carry it; it shipped with the 2026-09-30
   Section 4 deploy). Nothing left from that deploy. Left: making the log easy to read and
   widening coverage (Time off saves, the six urgent-ping codes of OPEN_REPAIRS 314).
5. **Load-per-tab, step 5: client links get the smaller page. DONE: merged (#1868, key fix #1872),
   Vigil hand-tested the live client links 2026-09-30 (all five steps pass, test client only).
   Parts are also minified since 2026-09-30 (#1873).**
   The owner gave the go and waived the week of staff use. A client link now loads
   the parts (no TikTok, Templates, Workload or Kasper code, and no quiet download
   of them); forms, the SMM weekly report and signed-out visitors still get the whole
   script. Numbers: `docs/audits/2026-09-29-step5-client-first-load.md`. Three ways
   back: everyone `node scripts/split-switch.js off`; client links only
   `node scripts/split-switch.js clients off`; parts minified since 2026-09-30, back with
   `node scripts/split-switch.js minify off`; one browser `?split=0` (on a client link only after the
   follow-up fix: #1868 shipped with the link check refusing that key, found by Vigil on the live site). The client
   approve and request-changes tests pass on the parts. Left after this: step 6
   (measure everything again).
6. **Make this repo private: NOT NOW. Owner decision 2026-09-29 (later the same day): the repo stays public.** Only the site publishing fix from the plan is being done: **DONE (#1870, Pages source switched by the owner 2026-09-30; verified 0 app addresses failing, 0 of 17 source addresses published)** (OPEN_REPAIRS 294, `docs/ops/PAGES_SITE_ALLOWLIST.md`). The live site served the whole repo (docs, scripts, migrations); it will publish the allowlisted files only (about 137). One-setting way back: Pages source to "Deploy from a branch". The rest of this item is the earlier plan, kept for reference: **Make this repo private, maintainably (owner wanted it earlier on 2026-09-29; this
   replaced the 2026-09-24 "keep it public for now").** Move scheduled jobs and
   automation off GitHub Actions (for example Supabase pg_cron and Edge
   Functions) so going private costs little. Keep hosting on GitHub Pages
   (owner, 2026-09-24: "I want to keep using GitHub"; the owner already pays
   for GitHub Pro, which serves Pages from a private repo). Plan: `docs/plans/2026-09-24-owner-backlog.md` section 1; costs:
   `docs/ops/REPO_PRIVATE_COST_STUDY_2026-09-24.md`.
   **Plan written 2026-09-29 (Atlas): `docs/plans/2026-09-29-repo-private-plan.md`,
   awaiting the owner's decisions in its section 9.** Findings that change the
   picture: measured pace is about 135,000 billed minutes a month (about $790 on
   Pro), 90 percent of it pull-request checks, so moving scheduled jobs saves only
   about $13; and the live site publishes the whole repo (docs, scripts,
   migrations), so the Pages deploy must become an allowlist before any switch.
6b. **n8n exit, phase 2 (plan #1874, owner decisions recorded 2026-09-30; status 2026-10-01).** Order: D, B, A, E, F, C, K.
   Generate caption's AI job itself: LIVE for every client (`caption-generate` function, transcript box, fixed writing rules; OPEN_REPAIRS 388; `caption_generate_ef_clients` = all since 2026-10-09, checked 2026-10-16). The old n8n Generate Caption workflow has had zero runs since 2026-10-09. On 2026-10-16 the page's switch read and its n8n `generate-caption` fallback were removed (session Sunset); once that is live, Lighthouse deactivates the workflow (deactivate, not delete).
   D (TikTok poll trim) DONE #1878. B (caption progress in Supabase) DONE: `caption-jobs` live, Generate Caption edited and
   published, Calendar page switched (#1889). A (Slack Creative Channel Finalizer): trigger webhook and daily safety check are
   live next to the 15 minute timer (#1892); the timer is removed in a small follow-up only after the next real client's
   channels were created through the webhook. E (Filming Docs write) DONE with no new function: the only caller is the filming
   plan pipeline, which already writes through `pipeline-google`; the n8n workflow was deactivated 2026-10-01 (#1896, restore
   in `docs/ops/N8N_EDIT_LOG.md`). F (read fallbacks) DONE on the page (#1897); the three n8n readers stay on until a later check shows zero calls. C (Booking Recovery gating): the replay proof is built and passes, nothing switched (the queue is an n8n data table a database timer cannot read; see `docs/ops/BOOKING_RECOVERY_GATE.md`), owner decided 2026-10-01: stays hourly, no n8n edits (replay test and design doc kept). Last K (BUILT 2026-10-01, see OPEN_REPAIRS: client links always save through the functions). Generate Caption's Save step moved to `calendar-upsert` 2026-10-03 (OPEN_REPAIRS 334, session Sunset): every run of the two n8n save workflows (Calendar Upsert Post, Sample Review Upsert) since 2026-10-02 23:55 UTC was a test-client drill. Not yet proof of zero callers: staff repairs pinned to n8n that the on-load migration keeps (committed-tweak or unverifiable) can still replay there, so they must be rerouted or shown absent before switch-off. Both stay on until the owner's switch-off step. Earlier note: K (client approve and request-changes move).
   Every n8n edit is logged in `docs/ops/N8N_EDIT_LOG.md`.
   **Owner decision 2026-10-02: the 30-day safety window becomes 5 days.** An old n8n workflow may be switched off 5 days after
   its replacement ships and its live proof passes, each switch-off still its own n8n edit with the owner's go. Step K (#1906,
   client approve and request-changes to the functions) was given the go the same day; it waits only on a rebase and Lighthouse's
   merge. Generate Caption's Save step, the last real caller of the n8n Calendar save, moved to the function 2026-10-03 (OPEN_REPAIRS 334).
6c. **n8n exit, analytics jobs (owner, 2026-10-01): Metrics step built, waiting for the owner (session Harbor, OPEN_REPAIRS 322).** Order: daily metrics, Top Videos, Market Research. Our own Edge Function
   `analytics-metrics-collect` runs beside n8n CLIENTS METRICS in shadow (writes a shadow table only), compared daily; n8n is not edited. Plan with the node
   by node map and the steps: `docs/plans/2026-10-01-n8n-off-analytics.md`. (Measured 2026-10-09: the shadow migrations are applied, the shadow tables and both timers exist, both functions are deployed; both flags are `off` by the owner's 2026-10-06 pause; the live mode of 356 is not applied; Market Research is neither applied nor deployed.)
   Owner decisions 2026-10-01: Apify double spend accepted; Pro plan; day 1 shadow = test client plus one real client with Instagram, TikTok and YouTube, then all clients for 3 days; 3 clean days is the bar before proposing to switch n8n off. Next: Lighthouse merges, then the owner's click-by-click steps (`docs/ops/ANALYTICS_COLLECT_OWNER_STEPS.md`: three secrets, the key also in Vault). **Top Videos (2026-10-02, OPEN_REPAIRS 327, plan section 7): built the same way, in shadow beside n8n TOP VIDEOS (`analytics-top-videos-collect`, timer 08:00 to 12:59 UTC, same key and secrets, nothing new for the owner to create), not deployed, not applied; steps `docs/ops/ANALYTICS_TOP_VIDEOS_OWNER_STEPS.md`, after the metrics steps.** **Market Research (2026-10-02, OPEN_REPAIRS 335, plan section 7c): mapped and built the same way, in shadow (`analytics-market-research-collect`; it is NOT a daily job: n8n has five webhooks and no timer, so it builds one brief per request, test client first, with a daily cap), not deployed, not applied; steps `docs/ops/ANALYTICS_MARKET_RESEARCH_OWNER_STEPS.md` (one new secret, `ANTHROPIC_API_KEY`; confirm `OPENAI_KEY`).** Evidence of use: 13 briefs for 9 clients, none since 2026-06-03; the owner decides later whether to keep the Keywords brief at all. The other four enabled branches stay on n8n for now. **The switch for Metrics and Top Videos (2026-10-06, OPEN_REPAIRS 356, plan section 8b): built, in PR, nothing deployed or applied.** Flag mode `live` writes the real tables (source `edge`, first writer wins per client per day), n8n's safety checks rebuilt over our queues and named by the combined Slack message (which must be switched on first), the daily copy and parity lane no longer fail when the two tabs stop. No Sheet copy kept (owner). Steps: "Going live" in `docs/ops/ANALYTICS_COLLECT_OWNER_STEPS.md`; n8n deactivation needs the owner's explicit go.
7. **Navigation, then look and feel** (roadmap phases D and E in
   `docs/plans/2026-09-21-post-modularization-roadmap.md`), each starting from
   the owner's own observations.

8. **Agreed earlier, not yet scheduled** (found by an audit of the owner's
   requests on 2026-09-29; the owner orders these):
   - **Move SyncView's own traffic off n8n** (owner 2026-09-28, "completely
     optimize n8n execution"): Filming Plan Tabs (about 36% of runs), Calendar
     Upsert Post and its comment merge, Caption Prompts, Sample Review Upsert.
     Pairs with item 2. Forge restarted it on 2026-09-29: the plan
     (`docs/plans/2026-09-28-n8n-exit.md`) and PR 1a, the `filming-plan-tabs`
     Edge Function plus its cache-table migration, merged in #1846 (main
     `66750995efb371eadaf503b45ade6d984fd1f8cb`). Live since 2026-09-29: the cache
     migration is applied, the owner deployed the function
     (`https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-single-function.yml`),
     switched on the Google Docs API and shared the Filming Plan folder with the
     thumbnail service account, and a bulk read of 25 recent Filming Plan Docs came
     back from Google with no n8n fallback (source `google` in the cache). PR 1b
     (#1854, main `b1039f0a27c1e0c2239dca13e6564531ac61be39`) puts Kasper > Filming behind the runtime flag
     `filming_plan_tabs_source`; the flag row is applied and set to
     `{"mode":"function"}` (owner's go, 2026-09-29). Live, every browser read of that
     flag answered 400 because of a `_t=` cache-buster, so the page kept using n8n;
     #1857 removes it, after which Kasper > Filming reads from the function, with
     n8n kept as the automatic per-Doc fallback. Rollback: set the flag to
     `{"mode":"n8n"}` (takes effect on the next Filming open). The n8n Filming Plan
     Tabs workflow stays on for 30 days. **PR 2 (Calendar, #1858) merged 2026-09-29:** staff saves hold or pause on a fresh flag read and never fall back to n8n; client
     approve and request-changes untouched (byte-identical test); pinned repairs migrate on load;
     the n8n Calendar workflows stay on 30 days after it ships. **PR 3 (Caption Prompts, session Anvil) built 2026-09-29,
     awaiting Lighthouse's merge:** prompts are read from the `caption_prompts` table (browser saved copy, then n8n `caption-prompts-get`, only on error); the save is guarded by a fresh, bounded read of `settings_ef_clients` (paused or held, never n8n). `Caption Prompts - Save` can be deactivated 30 days after it ships; `Get` stays as the first-load fallback. **PR 4 (Sample Review, session Anvil) built 2026-09-29, stacked on PR 3, awaiting Lighthouse's merge:** staff Sample saves and reorders hold or pause on a fresh `sample_review_ef_clients` read and never reach n8n; client approve and request-changes untouched (byte-identical test); `sample-review-upsert` stays frozen; pinned Samples repairs migrate on load; the four urgent-marker writes now use the guarded step. `Sample Review - Upsert` and `Reorder` (n8n) can be deactivated 30 days after it ships; `Get` stays as the read fallback. Owner decisions: the client approve and request-changes buttons are
     not touched at all, and old n8n workflows stay on 30 days.
   - **Staff can see and restore recently archived Calendar cards and Samples**
     (owner 2026-09-29): BUILT in PR 1853 (session Harbor), waiting for
     Lighthouse's merge; move to Done after that. From the More menu, admin and
     SMM only; the card and each work item come back exactly as they were (plan
     `docs/plans/2026-09-29-calendar-unarchive.md`, ledger item 288). Still to do
     as a separate change: a warning when someone moves a work item whose card is
     archived (needs the sealed capture and an owner deploy).
   - **Daily real-browser client check from a local session, Samples included,
     noting odd loads, pop-ups and delays** (owner 2026-09-22). The shipped
     morning check is headless on GitHub. **2026-10-09 (session Gatekeeper, OPEN_REPAIRS 392, in PR):
     it now includes a client Samples approve** on the test client's sample with real work items (staff sends it
     with a real sign-in, the client approves, staff puts it back). It reads the SMM role key from the repository secret `ROBOT_ROLE_KEY_SMM` (entry 392). The local-session half is still open.
   - **Write down how to prompt local sessions to use the app's Browser pane
     instead of Chrome** (owner 2026-09-23, "write this somewhere").
   - **Public-key reads of `calendar_posts` and `sample_reviews`, phases 1 and 2**
     (#1691; owner 2026-09-27, "let's do it later"). Same pass: `anon` still
     holds INSERT, UPDATE and TRUNCATE grants (no write policy, RLS on) on ten
     tables, among them `clients`, `templates`, `team_members` and
     `syncview_runtime_flags` (measured live 2026-09-29). Row writes are
     refused; TRUNCATE ignores RLS, so this is defence in depth, as #1772 did
     for three other tables.
   - **The shared SMM key after a former SMM left**: changing it is the only
     complete fix; needs the owner's decision.
   - **Remove the Production "archive asset repair" button**: kept only for the
     Linear rescue, which is no longer needed.
   - **Stop Slack channels being missed**: a client's channel lives in two
     places; have the profile fill the notification setting automatically.
   - **Move everything else off Google Sheets, SMMs included** (owner
     2026-09-27 and 09-28, "a story for another day"). Analytics is item 1.

Dated items that must not slip: 2026-10-01 (items 1 and 2), 2026-10-15
(assurance-ledger rows expire, under "Needs the owner"), and retiring the
hiring senders when the editor hire closes.

## Needs the owner

- **Retiring calendar-upsert, step 1 (session Sunset, `docs/ops/CALENDAR_UPSERT_RETIREMENT_PLAN.md`): merged 2026-10-16 (#2104, `e0652a7a`), live v1 since 2026-10-16, switch on for the test client only.** The new `calendar-card-write` function writes a card's own fields with calendar-upsert's guards (proven equal on generated saves by `test/calendar-card-write-parity.js`). Staff saves go there only for clients on `calendar_card_write_clients`; client review links stay on calendar-upsert. Needs, in order: deploy the function on the one-function lane (owner), then Lighthouse puts the test client on the switch.
  Lighthouse review 2026-10-16: the function's logic was diffed against live calendar-upsert v90 and the parity test re-run
  against live (21,205 checks pass). Intended differences only. Notes: a rejected staff key fails the save instead of
  saving; switch entries must be exact slugs; never list a client before the function is deployed (a 404 does not fall
  back). Test gaps for Sunset's step 2: two deliberate breaks went unnoticed (comment merge `>` to `>=`, the archived-twin
  exclusion in the duplicate-link guard).
- **Scheduled posts turn Posted by themselves (session Herald, OPEN_REPAIRS 402): built, not merged, not deployed, switch off.** Needs, in order: Vault key, the `CALENDAR_AUTO_POSTED_ACTOR` secret, the one-line `calendar-upsert` live delta, the `calendar-auto-posted` function, `migrations/2026-10-10-calendar-auto-posted.sql`, then `calendar_auto_posted` on for the test client.

- **One ordered sitting for everything built and waiting: [`docs/ops/OWNER_SHIP_LIST.md`](ops/OWNER_SHIP_LIST.md)**
  (measured 2026-10-09, OPEN_REPAIRS 389): 8 items, none needs the sealed capture. The roster switch (374) and the
  `analytics-read` deploy come first after a look at the backup.
- **Thumbnail titles follow-up (OPEN_REPAIRS 394, 2026-10-10): week-tab plans and stored failure reasons, in PR.**
  Release: apply `migrations/2026-10-10-thumbnail-titles-error-record.sql`, then deploy `thumbnail-titles`; then re-queue
  the 15 `generation_failed` and 4 week-tab items. Owner decision open: 21 items whose plan's newest month tab is older than the post.
- **Thumbnail titles, the stuck "Needs info" items (OPEN_REPAIRS 406, 2026-10-11): in PR, not deployed.** Measured 2026-10-11:
  67 open Needs info items on real clients (39 no match, 21 no month tab, 4 empty plan, 2 no plan, 1 failed). Causes: long plans cut
  at 20,000 characters, a plan with no tab for the post's month (now falls back to the next, then the previous month), plans that
  are only a header (now reported as an empty plan), numbering that restarts in a second list, and posts that are not plan videos.
  Release (the 2026-10-10 error-record migration is already applied, checked 2026-10-11): apply `migrations/2026-10-11-thumbnail-titles-requeue.sql`, deploy `thumbnail-titles` (lane `deploy-single-function`),
  then dry-run and run the re-queue. Owner decisions open: see the entry.
- **Thumbnail titles (OPEN_REPAIRS 391): LIVE.** Switch `thumbnail_titles` = `{"clients":["*"]}` since 2026-10-09 19:48 UTC
  (checked 2026-10-10); backfill ran 2026-10-09 (queue: 33 titles written, 111 Needs info lines, 3 skipped as already
  filled). Prompt editor is in the Calendar "..." menu under "Caption prompt". Follow-up above (394).
- **Retire the hiring senders once the editor hire closes.** Both n8n hiring
  dispatchers (interview invite, practical test) are still active and run every
  5 minutes, and the journal says the "Hiring Raw Log" data table (applicant data) is to be cleared then (not re-counted today).
  Evidence: n8n list 2026-09-26, both `active: true`. No deadline, but it is
  personal data sitting in a third-party tool.
- **2026-10-15: assurance-ledger lane goes red again.** Four quality-tier rows
  were restated, not re-proven, and reach 90 days on about 2026-10-15
  (OPEN_REPAIRS 205a). **2026-10-09 (session Gatekeeper, OPEN_REPAIRS 392, in PR): the three Tier 0 rows
  (client links, link issuance, client thumbnails) were re-proven on the live site, test client, 12 of 12
  (`node qa/dawn/tier0-live-proof.js`), plus Calendar staff writes and Samples + Kasper; the State column is
  restamped 2026-10-09.** Still past their window: submit intake, staff sign-in, the Linear mirror row, PTO,
  Templates, Filming plans, Weekly reports (re-prove or retire before the lane's 90-day line). The separate "Linear access extension to
  2026-10-15" is moot: all Linear keys were revoked on 2026-09-23.
- **Slack alerts become one message (owner said yes, 2026-09-28): BUILT 2026-10-02, merged, switch off (OPEN_REPAIRS 328; measured
  2026-10-09: the 09:37 UTC run printed `ALERT_DIGEST_ENABLED` empty, so it is still shadow).**
  Runs hourly in shadow (prints the message in the run summary, posts nothing); every old alert still posts. Owner's
  steps: compare shadow with real alerts, approve one edit to the n8n alert relay (snippet in
  `docs/ops/LINEAR_EXIT_STEP29C_ALERT_CONSOLIDATION.md`), set `ALERT_DIGEST_ENABLED` to `true`, then old alerts are removed one by one.
- **Modularization C3: every script fragment is a module; only step 13 (the
  runtime switch) is left, and it waits for the owner's go.** The prep is in
  (Keystone, 2026-09-29): each module lists the functions its buttons call on
  `window`, a check fails if a list goes stale, and the screen guard
  (`inline-handlers-browser.js`) enforces it. Owed: delete the dead
  `_sxrSyncStatusFromLinear` calls in `270` and update `test/sxr-move-link-*.js`. The measured proposal for the
  switch is `docs/plans/2026-09-29-c3-step13-switch-proposal.md`: serve today's
  code in today's order (native modules and a plain bundle both fail to boot,
  because of load order), and re-run `prod-boot-budget.js` on a machine with
  the live backend first.

- **Instagram upload is deployed; real post proof remains separate (Atlas read-only verification, 2026-09-30).** The live catalog has `instagram-upload` v3 and `instagram_uploads`; configured secret names include `POST_FOR_ME_API_KEY` and `INSTAGRAM_UPLOAD_ALLOWED_CLIENTS`. The account-ID Sheet column and a successful real Reel were not verified by Atlas. Source defaults restrict admission when the allowlist is unset; actual allowed-client values were not published. Keep wider rollout owner-gated. Steps: `docs/ops/INSTAGRAM_UPLOAD.md`.

## Needs a session

- **Something still saves Samples through n8n** (measured 2026-10-09, OPEN_REPAIRS 389): `Sample Review — Upsert`
  ran 729 times since 2026-10-02 and was running during the check, although staff and client saves go to the
  functions (289, 292, 333). Find the caller before that workflow can be switched off. Five other old n8n
  workflows had zero runs and are listed for the owner's switch-off go (ship list step 7).
- **Add `Access-Control-Max-Age: 7200` to `production-write`** (owner decision 2026-10-01; OPEN_REPAIRS 326). Measured 2026-10-09: it is **not in the source yet** (today's Section 4 deploy shipped main as it is), so a session adds it with the fingerprint re-pin and it ships at the next Section 4 deploy. `calendar-upsert` is frozen and stays without it.
- **The two-hour preflight header, live state (measured 2026-10-09, OPEN_REPAIRS 389):** live on `key-verify`, `smm-weekly-reports`, `thumbnail-revision-read`, `brain` and `workload-plan`. Waiting: `analytics-read` (single-function lane, ship list step 2) and `production-comments` (live build from 2026-09-17; its lane's manual dispatch also redeploys `notify`, `production-write`, `production-archive` and eight onboarding functions, all equal to main today; optional, ship list step 8).
- **Duplicate ledger numbers in OPEN_REPAIRS:** 13, 14, 22, 23, 175, 176, 177,
  180 each appear twice, and 220 sits before 218/219. Append a renumbering
  note; never rewrite.
- **Write-refusal log works; read it.** 4,573 refusals recorded since
  2026-09-23 (OPEN_REPAIRS 225 said "never recorded one"). 4,206 are
  `invalid_staff_key` on the Production gateway, almost all on 09-23 and 09-24
  and down to 2 on 09-25, so it looks like one automated caller that stopped.
  The `traffic` column (256) fills on browser reports and, since the 2026-09-30
  Section 4 deploy, on gateway rows too (measured 2026-10-09, item 4).
- **Scheduled lanes that are red** (the lanes in OPEN_REPAIRS 205). Repair or retire each.
  **2026-10-02 (OPEN_REPAIRS 329): the Production polish interaction and heavy lanes and the card vs
  calendar drift check had causes found and fixed (test code and test-client data only); confirm
  they are green on main after the merge.** The other lanes were not re-checked.
  **2026-10-08 (OPEN_REPAIRS 373, session Mend): Calendar E2E, Samples E2E and the drift check.** Robot causes
  fixed in test code (fake-key refusal shadowing the fake gateway; fake-key 401s on staff reads signing the robot
  out, which since admin-only Kasper sends it to Home; notes sent before their thread loads; two probes on
<<<<<<< HEAD
  retired addresses or rules). The drift check now lists N/A slots apart (owner: N/A wins). Owner steps left:
  apply `migrations/2026-10-08-native-calendar-na-wins-one-client.sql` and run its one-client repair for the
  test client; set the `SYNCVIEW_STAFF_KEY` repository secret to a role key (p96). Then re-point the deploy
  preflight's two pins at that migration before the next Section 4 dispatch.
  **2026-10-09 (OPEN_REPAIRS 392, session Gatekeeper, in PR):** Calendar run 112 (first with 373's fixes) was 21 of 67
  red. Fixed: probe cards now carry fixture work items with a faked gateway that holds its status (13 probes), p85, p92,
  p94; p89, p90, p91 retired (they drive the staff blank-card funnel production no longer reaches). Samples: Kasper Undo
  was a real bug (fixed); Finish expectation follows the owner's 2026-09-27 rule; robot servers answer like Pages. p28,
  p29, p30, p36 stay (they test native routing). The robots now read the SMM role key from the repository secret `ROBOT_ROLE_KEY_SMM` (owner decision; the
  `production` environment keeps its approval rule). Owner check: `SYNCVIEW_STAFF_ACTOR` names an active SMM.
=======
  retired addresses or rules). The drift check now lists N/A slots apart (owner: N/A wins). Measured 2026-10-09: the migration is
  applied from the LF copy (both routine bodies match the preflight pins, OPEN_REPAIRS 381), the test-client repair ran,
  and the pins are re-pointed (today's Section 4 run passed its preflight). Left: the `SYNCVIEW_STAFF_KEY` repository
  secret holds a role key (p96); a secret cannot be read, so the next Calendar and Samples nightly runs show it.
>>>>>>> origin/main
- **Workload plan `list` deadline** is only budget-raised, not fixed
  (OPEN_REPAIRS 210).
- **Dialog press-and-release (OPEN_REPAIRS 215) is DONE.** Fixed on main since
  #1431 (2026-09-19), 21 backdrops guarded by one shared helper. The Latch
  session's stall was a false alarm on a fixed item. A test now proves it on
  22 dialogs (`test/dialog-backdrop-press-browser.js`, OPEN_REPAIRS 287).
- **Mixed-batch orphans:** a browser fix should re-attach 22 cards; nobody has
  confirmed it on a live read (journal 2026-09-22).
- **Copy transport retry** (OPEN_REPAIRS 223/279): the native brief copy now
  retries with bounded attempts and reconciles ambiguous uploads by readback,
  tested offline. No live re-copy has been run.
- **Onboarding runbooks have no native steps** for their retired Linear parts
  (OPEN_REPAIRS 227).
- **Sheets to Supabase, next steps:** the mirror write is on and backfilled;
  CLIENTS METRICS and TOP VIDEOS mirror every client (since 2026-09-28). The
  mirror READ is enrolled only for the test client. Parity on 2026-09-28: no
  value differs; Supabase lacks Metrics 26-28 Sept and TopVideos 26-27 Sept,
  filled by the new daily copy lane once the owner adds its secret and
  variable. Staff read, daily parity check and catch-up job are built but the
  staff scopes needed `analytics-read` deployed, which the owner did on
  2026-09-28 (#1810). Switch-on plan and every other
  reader: `docs/plans/2026-09-28-analytics-switch-on.md`.
  `client_profiles_authority` was `sheet` then; since 2026-10-02 20:00 UTC it is `syncview` (OPEN_REPAIRS 331).
- **`mirror_outbox` still grows** (236 new rows in the last 24 hours, all
  receipts; 12,974 total). Retiring it is a planned later slice, not urgent.

## Dormant on purpose (switched off, leave alone unless asked)

- `linear_outbound_enabled` = off and `linear_legacy_parity_enabled` = false
  since the 2026-09-20 cutoff. Kept only because `production-write` reads them.
- `native_card_materialization` = `hold` since 2026-09-17 (dropped, could reopen).
- Native client provisioning and SyncView retirement activation: the SQL
  functions exist and are never called; retirement activation always refuses.
- Native intake completion, native notification sender, native urgent handoff,
  named append, existing-card assignment: built or drafted, not switched on.
- Linear-only calendar slots: the repair script found **0** slots to connect
  (2026-09-24), so there is nothing to apply.
- The historical monitoring cutover workflow retains only its manual TEST
  cleanup and roster report. Its Linear-dependent proof jobs are retired.
  Other Linear-only workflows are unscheduled for hand dispatch.
- SyncView v2 (Next.js): plans only. (Making the repo private is no longer
  dormant: the owner wants it, see priority item 6.)

## Done (was listed as open somewhere)

- **Escape closes a Calendar card's thumbnail or video edit box (owner report 2026-09-26; DONE, merged 2026-10-08 in
  #2000, OPEN_REPAIRS 371).** Re-checked on the live site that day (session Sentinel, test client) and found still
  broken, then fixed: Escape puts back the link the box opened with and closes it, Enter keeps what was typed; Samples
  too. Not yet re-checked on the live site after the merge.

- **Opening an item is faster, and the two SyncLinear saved-copy decisions are done (2026-10-01, OPEN_REPAIRS 323, PR open
  until merged).** The saved list lives 7 days; finished rows are kept in the browser's larger store and a boot reads only
  what changed (hourly full pass kept); a link at a finished batch shows its title in about 1.5 s warm instead of 5.3 s;
  new-tab links skip a redirect; SyncLinear rows start their reads when you hover. The staff check (about 1.0 s) is the
  floor under every new-tab open and was not touched. Record: `docs/audits/2026-10-01-open-item-speed.md`.
- **Kasper review board: a refused decision is no longer quiet, and the board says what it shows (2026-10-01,
  OPEN_REPAIRS 316, PR open until merged).** A refused save is re-read and re-applied only when nobody changed the part;
  otherwise a "not saved" alert stays until he acts. Returned cards say "Sent back to you", urgent cards say who and when,
  "Tweaks pending" opens by default, and a part staff moved past him without his decision shows in his history with
  who and when (owner decision: staff may skip him, never silently). Browser only, no deploy. Not yet seen in his browser.
- **SyncLinear opens and finishes faster, same page (2026-10-01, OPEN_REPAIRS 315).** Measured on the live
  site first: quick to use (switch 60 ms, no dropped frame, card under 100 ms), slow to finish (complete
  list 7.9 s in, 3.25 MB cold). The finished-items read now starts beside the live read (with a catch-up
  point for the next refresh), page one of the big reads starts when sign-in passes, and the per-row scans use lookup tables.
  Same rig, interleaved: cold complete list 8.2 to 5.9 s, cold first rows 3.7 to 3.1 s, warm fresh data
  3.5 to 3.2 s; 1,642 rows compared old against new, 0 differences. Way back: revert the PR.
- **Workload: unfinished work pinned to a past day is carried over (2026-09-30, #1875,
  OPEN_REPAIRS 295).** It shows on today (or Monday at a weekend, when Workload opens on the
  coming week) with a "Carried over" mark; the saved plan day is left unchanged. Cause found
  on a card archived and unarchived with an old manual day.
- **Two dormant censuses retired (#1871)** and **the load-per-tab split key fix (#1872).**

- **Today shows fresh items about 2x sooner and never yesterday's list (2026-09-30;
  OPEN_REPAIRS 296).** Reads start from the head script, one parent check instead of eleven, and
  a saved copy from an earlier day is not painted. Desktop cold 3,727 to 1,709 ms. Remaining floor
  is the wait for Clients Info (priority 1). Way back: revert the commit.
- **The two dormant censuses are retired (owner, 2026-09-29; OPEN_REPAIRS 293).**
  The outbox-debt and retirement-admission monitors only wrote heartbeats. Their
  workflows are deleted, both dead-man lanes are marked retired (dated, with a
  reason), and `lane-ticker` no longer dispatched them (it was itself deleted 2026-10-09, OPEN_REPAIRS 388). Scripts, SQL and tests stay
  as a frozen reference. Their 69 and 72 old heartbeat rows are kept in the event
  log, as every earlier retired lane's were; deleting them is a separate owner go.
- **Kasper loads on demand (#1841), checked by the owner with a real login on
  2026-09-29:** the Time Off and Clients tabs work. (Vigil's test account saw
  those two tabs error, as before the change; that was the account, not #1841.)
- **An SMM revived a work item whose Calendar card was archived (2026-09-29).**
  The item showed only in SyncLinear, because the Calendar hides archived cards
  and so does Workload, and SMMs have no way to see or restore an archived card.
  Lighthouse restored that one card to In Progress on the owner's request
  (logged in `calendar_post_events` as an `unarchive`). The owner said yes: PR 1853
  adds the view and the restore (see the priority list above).
- **Publishable-key reads of `workload_issues`, `workload_issues_native_v1`
  and `production_deliverables_browser_v1` stay open. Owner decision
  2026-09-28; do not raise these three again.** Keel (#1840) found they return
  tasks with staff names and emails (or staff ids) to the publishable key.
  #1840 stops a signed-out page from showing or keeping the board; these three
  grants are left as they are by choice. Only these three: `workload_plan`
  keeps zero browser privileges (measured 2026-09-29), and any other new
  public read is a regression.
- **Linear archive rescue (F34) is NOT needed. Owner decision 2026-09-28; do
  not raise it again.** Linear is being cancelled. Measured live the same day:
  3,478 briefs (with their images, see Brief media rescue below) and 14,205
  Linear comment bodies are already in SyncView, including those of cards
  archived in Linear. The only thing not copied is files pasted into about 246
  old comments on 46 cards (newest 2026-08-11), which stop opening once Linear
  is gone. The owner accepted that loss. The rescue script and its empty
  config table stay as dead reference.
- **Restore scratch Supabase project deleted** by the owner (only
  `syncview-calendar` remains, `list_projects` 2026-09-28).
- **Archived-in-Linear cards still open: swept 2026-09-28 on the owner's word**
  (OPEN_REPAIRS 282). 80 non-test cards in archived batches, with no calendar
  post link and untouched since their Linear archive, set to `canceled`. 8 left
  on purpose: 4 `posted` (correct), 1 edited after its archive, 3 linked to a
  calendar post (a status change there projects onto the client's calendar).
- **Design decisions closed 2026-09-28.** 212 (server recompute of a post's
  overall status): not needed, the page recomputes it on every load
  (`130-calendar-model-cache.js.part`), so the stored copy is never shown.
  Topbar "New issue": already removed in #1662. 254: not a decision; already
  deployed 2026-09-25 and checked live on the test client.
- **Analytics Sheets to Supabase:** the finishing prompt went to Prism on
  2026-09-28 (parity report, staff overview read, daily comparison, catch-up
  job, switch-on plan). Flags unchanged until the owner says go.

- **Guest-login gap closed before v2 sign-in (applied 2026-09-27).** The
  `authenticated` role no longer holds any right `anon` lacks: a live
  re-measure across tables, sequences, columns, functions, schemas and
  policies returns 0 rows (`migrations/2026-09-27-authenticated-grants-revoke-three.sql`,
  PR #1772). Anonymous sign-in stays OFF until the owner turns it on.
  The separate `anon` write and TRUNCATE revoke on the same three tables is
  applied too (#1772; measured live 2026-09-29: no anon write on
  `filming_plans`, `smm_weekly_reports`, `social_media_managers`), although the
  migration file's header still says NOT APPLIED. Ten other tables still carry
  anon write grants: priority item 8.

- **F27 capture guidance already names the three-function closure.** Read-only
  source check on 2026-09-26: `CLAUDE.md` and the Section 4 workflow both name
  `production-write`, `deliverable-write`, `batch-write`, and the old Linear
  inbound lane is absent. The saved `%USERPROFILE%\.syncview\f27-capture.ps1`
  also contains exactly `--slugs=production-write,deliverable-write,batch-write`
  and no Linear slug. This confirms the saved script text, not a fresh capture,
  bundle readback, or deployment; follow the fresh-capture gate before dispatch.
- **Linear is fully off.** No `linear-*` Edge Function is deployed
  (`linear-inbound`, `linear-outbound`, `workload-linear` all gone); all Linear
  API keys revoked 2026-09-23 (the runbook's STEP 7, which some docs still call
  pending). The n8n Linear calendar workflows and the monitoring pager are
  inactive, which also ends the n8n bill item in OPEN_REPAIRS 233.
- **Brief media rescue.** `native_brief_media` = `required` since 2026-09-21;
  1,338 of 1,338 occurrences `verified`, 1,338 files in the bucket. Supersedes
  F34 and LINEAR_MEDIA_RESCUE (the rest of F34 is not needed, see above). (The execution map row saying `off` is stale.)
- **All native capabilities on:** intake epochs, assignment, ordinary receipts,
  label catalog, identifier mint are `native` for both teams.
- **Migrations applied** that the ledger still calls "built, not applied":
  rename propagation release 1 and 2 (242, 243; flag on 2026-09-23), secure
  2026-08-24 backup table (248; RLS on, no browser grants), retirement assert
  re-pin (249), B2 Slice 10 (view dropped, two flag rows gone), sheets mirror
  phase 1, client profile edits, write-refusal page and traffic (256).
- **Deploys done:** `production-write` v95 (2026-09-25), `write-diagnostics`
  v14 (2026-09-25), `brain` (2026-09-24, OPEN_REPAIRS 251), `analytics-read`,
  `analytics-write`, `client-profile-write`.
- **Client links require their secret token.** `client-token-verify` runs
  browser entry in strict mode, which always requires one active client and
  its current token. `auth_enforcement` = `permissive` only affects legacy
  non-strict callers, and none remains: the only caller in this repo (and none
  in the other three repos) is the browser entry, which sends `strict: true`
  (`src/index/260-production-refresh-boot.js.part`).
- **Urgent ping and public intake** are both enabled (docs that say "flag row
  absent" or "off by default" are old).
