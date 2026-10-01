# State of things

Find any running piece and its owner in the [SyncView Atlas](ATLAS.md).

**Read this first.** One short, true list of what is open, what is switched off on
purpose, and what is already done even though an older doc still calls it open.
Every line below was checked against the live system on **2026-09-26** (read-only
SQL on `syncview_runtime_flags`, tables and row counts; the live Edge Function
list; the n8n workflow list). Where a doc and the live system disagree, the live
system wins and this page says so. Counts only, no client names.

When you close or change something here, update its line in the same PR. If a
line is older than a week, re-check it before relying on it.

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
  Media Managers (session Roster):** Step 1 built, in PR (OPEN_REPAIRS 321, `docs/plans/2026-10-02-roster-native.md`):
  database functions, `roster-read` and `roster-write`, a native save for the Clients tab and the read-only Sheet
  copy; nothing switched on, no n8n edit. Next, each with its own go: apply the migration and deploy, then each n8n
  edit, then the switch. Beacon (onboarding) will extend the Clients tab.
- **B. Move off n8n.** Phase 2 plan, step by step (item 6b below).
- **C. Onboarding, someday.** The owner wants the onboarding process made better; not scheduled yet.
  The measured picture of how a client is onboarded today (every step, every per-client resource with
  counts, and the owner's decisions) is `docs/audits/2026-10-01-client-onboarding-as-it-really-is.md`.
- **D. Navigation, then look and feel.** The owner plans to start this himself the weekend of 2026-10-03
  (item 7).
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
   Measured live: `traffic` fills for browser reports; the gateway's own rows
   still show none because `production-write` was deployed before #1643 and needs
   its next Section 4 deploy. Left: that deploy (owner's capture ritual).
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
   D (TikTok poll trim) DONE #1878. B (caption progress in Supabase) DONE: `caption-jobs` live, Generate Caption edited and
   published, Calendar page switched (#1889). A (Slack Creative Channel Finalizer): trigger webhook and daily safety check are
   live next to the 15 minute timer (#1892); the timer is removed in a small follow-up only after the next real client's
   channels were created through the webhook. E (Filming Docs write) DONE with no new function: the only caller is the filming
   plan pipeline, which already writes through `pipeline-google`; the n8n workflow was deactivated 2026-10-01 (#1896, restore
   in `docs/ops/N8N_EDIT_LOG.md`). F (read fallbacks) DONE on the page (#1897); the three n8n readers stay on until a later check shows zero calls. C (Booking Recovery gating): the replay proof is built and passes, nothing switched (the queue is an n8n data table a database timer cannot read; see `docs/ops/BOOKING_RECOVERY_GATE.md`), owner decided 2026-10-01: stays hourly, no n8n edits (replay test and design doc kept). Last K (client approve and request-changes move).
   Every n8n edit is logged in `docs/ops/N8N_EDIT_LOG.md`.
6c. **n8n exit, analytics jobs (owner, 2026-10-01): Metrics step built, waiting for the owner (session Harbor, OPEN_REPAIRS 322).** Order: daily metrics, Top Videos, Market Research. Our own Edge Function
   `analytics-metrics-collect` runs beside n8n CLIENTS METRICS in shadow (writes a shadow table only), compared daily; n8n is not edited. Plan with the node
   by node map and the steps: `docs/plans/2026-10-01-n8n-off-analytics.md`. Not deployed, not applied, never run against Apify (first proof is the first shadow day).
   Owner decisions 2026-10-01: Apify double spend accepted; Pro plan; day 1 shadow = test client plus one real client with Instagram, TikTok and YouTube, then all clients for 3 days; 3 clean days is the bar before proposing to switch n8n off. Next: Lighthouse merges, then the owner's click-by-click steps (`docs/ops/ANALYTICS_COLLECT_OWNER_STEPS.md`: three secrets, the key also in Vault). Top Videos and Market Research are not started.
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
   - **Escape does not close a Calendar card's thumbnail or video edit box**
     (owner 2026-09-26). Last status: still broken. Re-check live first.
   - **Daily real-browser client check from a local session, Samples included,
     noting odd loads, pop-ups and delays** (owner 2026-09-22). The shipped
     morning check is headless on GitHub and has no Samples flow.
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

- **SyncLinear: two speed decisions (2026-10-01, `docs/audits/2026-10-01-synclinear-speed.md` section 6).**
  (a) The saved copy lives 24 hours; after that the tab opens cold (rows at 3 to 5 s instead of 1.1 s). Raising
  it (for example 7 days) makes most "first open of the day" cases warm; it changes what is shown for the first
  second. (b) Every warm open still downloads 2.37 MB because the saved copy leaves out finished rows; keeping
  them in the browser's larger store and reading only what changed would drop about 1.2 MB and the 0.75 s
  end-of-load freeze. It reverses a documented choice. Neither was done.
- **Retire the hiring senders once the editor hire closes.** Both n8n hiring
  dispatchers (interview invite, practical test) are still active and run every
  5 minutes, and the journal says the "Hiring Raw Log" data table (applicant data) is to be cleared then (not re-counted today).
  Evidence: n8n list 2026-09-26, both `active: true`. No deadline, but it is
  personal data sitting in a third-party tool.
- **2026-10-15: assurance-ledger lane goes red again.** Four quality-tier rows
  were restated, not re-proven, and reach 90 days on about 2026-10-15
  (OPEN_REPAIRS 205a). The fix is to re-prove those surfaces, which needs live
  access from the owner's machine. The separate "Linear access extension to
  2026-10-15" is moot: all Linear keys were revoked on 2026-09-23.
- **Slack alerts become one message (owner said yes, 2026-09-28).** Build the
  single consolidated problem message with a quiet default proposed in
  `docs/ops/LINEAR_EXIT_STEP29C_ALERT_CONSOLIDATION.md`, AFTER the analytics
  move to Supabase lands.
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

- **Duplicate ledger numbers in OPEN_REPAIRS:** 13, 14, 22, 23, 175, 176, 177,
  180 each appear twice, and 220 sits before 218/219. Append a renumbering
  note; never rewrite.
- **Write-refusal log works; read it.** 4,573 refusals recorded since
  2026-09-23 (OPEN_REPAIRS 225 said "never recorded one"). 4,206 are
  `invalid_staff_key` on the Production gateway, almost all on 09-23 and 09-24
  and down to 2 on 09-25, so it looks like one automated caller that stopped.
  The `traffic` column (256) now fills on browser reports; gateway rows stay
  empty until `production-write` is redeployed (measured 2026-09-29, item 4).
- **Scheduled lanes that are red** (`production-polish-gate` red since 09-17;
  the lanes in OPEN_REPAIRS 205). Repair or retire each. Not re-checked today.
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
  `client_profiles_authority` is still `sheet`.
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
  reason), and `lane-ticker` no longer dispatches them. Scripts, SQL and tests stay
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
