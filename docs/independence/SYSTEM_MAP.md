# SyncView System Map — v2 (whole-website optics)

**Version note.** This is **v2**, and it replaces the v1 (Track-B-lens) draft in place. v1 mapped
the site *through* the Linear-replacement program and left four data-flow questions and all
per-surface depth on a "verify" list. v2 flips the lens: the **primary subject is the website** —
every user-facing surface of `index.html` traced surface-by-surface for what it actually
reads/writes (every endpoint verified against the code), the state it keeps (localStorage /
sessionStorage keys, URL params, kill switches, caches), how roles change its behavior, and what
happens when each backend call fails. The **Track-B impact** is kept as the last line of every
surface so the migration view survives. First drawn 2026-07-11 (v1); re-derived at full depth
2026-07-11 (v2).

**Status: LIVING.** Kept honest two ways: (1) the **freshness contract** in §8, enforced
mechanically by `test/system-map-sync.js` (runs inside `npm test`, so it gates every push); (2) the
prose in §4 must be updated in the same PR whenever a surface gains or loses a backend.

## 1. How to read this map

- **The app is one file.** `index.html` (~44.6k lines) is the entire SPA; GitHub Pages serves it
  from `main`, so a merge ships to production immediately. There is no build step and no router
  library — "surfaces" are regions of one inline script, reached by URL param / hash / nav button
  and gated by client-side checks.
- **Endpoint kinds.** Four backends serve the app and this map always names which one: **n8n**
  webhook (`…app.n8n.cloud/webhook/<path>`), **edge-fn** (Supabase Edge Function,
  `…/functions/v1/<name>`), **rest** (Supabase PostgREST, `…/rest/v1/<table>`), **realtime**
  (Supabase Postgres-changes channel). Plus **external** (Google Sheets `gviz` CSV, Slack, Drive)
  and **asset** (CDN libs, images).
- **The write kill switches.** Three `syncview_runtime_flags` rows (`calendar_upsert_ef_clients`,
  `sample_review_ef_clients`, `settings_ef_clients`) are per-client-slug allowlists: a listed slug's
  writes go to an Edge Function; an unlisted slug's writes fail-safe to the legacy n8n webhook. They
  are read at load and live-updated over realtime. Full active roster on all three since 2026-07-07.
- **Auth is client-side and cosmetic today.** Staff access is a hardcoded password compared in
  browser JS that sets `localStorage.syncview_auth_v1='ok'`; the Supabase anon key and every webhook
  URL are readable in page source before any gate. Real server-side enforcement is the Track-B B0/B4
  work (§5). Where a surface is reachable without the password, this map says so plainly — that is a
  *description of current behavior*, and closing those gaps is exactly what the auth flip is for.

## 2. Backends

- **Supabase** (one project). REST tables the app reads directly: `calendar_posts`,
  `content_samples`, `sample_reviews`, `templates`, `caption_prompts`, `filming_plans`,
  `workload_issues`, `syncview_runtime_flags`; the Production tab additionally pages `batches`,
  `deliverables`, `deliverable_events`, `team_members`, `clients`. Ledger/mirror tables
  (`*_events`, `mirror_outbox`, `linear_archive`, `client_credentials_rev`,
  `thumbnail_media_revisions`) are written by Edge Functions / reconcilers, not read directly by the
  SPA.
- **Edge Functions.** 19 live under `supabase/functions/`; **the app calls 16** (see §7). The three
  it never calls are server-side only: the **B0 login verifier** (`key-verify` — built, wired in at
  B4), the **Linear-webhook target** (`linear-inbound` — receives 2 of the 4 Linear webhooks in B3),
  and the **scheduled thumbnail Drive scanner** (`thumbnail-revision-scan`).
- **n8n** (single host). **55 webhook paths** referenced by the app (§7). Live-instance check
  2026-07-11: **54 of 55 are served by ACTIVE workflows**; the lone exception is `ttp-status`, which
  has **no serving webhook** — its constant is defined but never fetched, and TikTok-Pilot status is
  advanced by a schedule-only cron and re-read via `ttp-list`. The n8n families: legacy calendar /
  samples write fail-safes (dormant behind the kill switches), the `linear-*` bridge, reads + AI
  generation (`generate-*`, `caption-*`), intake (`onboarding-*`, `sales-intake-*`,
  `ai-onboarding-*`), TikTok (`tiktok-*`, `ttp-*`), and Slack pings (`send-urgent-slack`,
  `weekly-slack-top-reel`).
- **Linear.** 4 webhooks in — 2 new HMAC-signed → the `linear-inbound` EF (realtime mirror, B3), 2
  legacy → an n8n card-patch workflow (retire at B5). API out via the n8n `linear-*` bridge until the
  B4 outbox. Adoption of brand-new issues via a 30-min incremental-refresh GitHub Action.
- **Google Sheets** (`gviz` CSV, one workbook). Serves **all analytics numbers** (six tabs) and the
  client roster / review tokens (`Clients Info`), the SMM directory (`Social Media Managers`), and a
  legacy filming-plans fallback tab. Populated by an external morning scrape.
- **GitHub Actions (9).** 3 reconcilers (`linear-sync`, `sample-linear`, `linear-deliverables`), 2
  nightlies (calendar-E2E, samples-E2E), the production-polish gate, unit tests, the B1 30-min Linear
  incremental refresh, the edge-function deploy — plus Pages hosting itself. **Slack:** alerts + pings.

## 3. App shell & cross-cutting mechanics

Everything below is shared by every surface; per-surface sections only note deviations.

- **Two-stage entry.** (1) A pre-paint boot-gate script in `<head>` (~27–143) reads the URL params
  and `localStorage` and tags `<html>` with `boot-*` classes / `data-boot-nav` so the first paint
  already shows the right chrome; it is wrapped in try/catch and never throws. (2) The entry router
  at the end of the script (~33410–33505) chooses a mode: `?onboarding` / `/onboarding_form` →
  public onboarding form; `?onboarding_view=<slug>` → standalone viewer; `?intake=1` → Linear-only
  lock; `?c=<client>` → client link; `#smm-weekly-report(s)` hash → SMM weekly form/viewer; else the
  **password overlay unless `syncview_auth_v1==='ok'`**. `init()` (~32870–33345) then routes to the
  tab, with fast-tab and client-link fast paths that mount before analytics data resolves.
- **Password side doors.** The gate at 33461 admits `_isSmmWeeklyEntry || _isIntake || _isClientLink
  || auth==='ok'` and then runs `init()`. So **`?c=…`, `?intake=1`, `?onboarding`, `?onboarding_view`
  and `#smm-weekly-*` all run without the staff password** (each hides staff chrome and locks nav to
  its own view). Because the `?prod=1` branch inside `init()` (32937) fires *before* the client-link
  branch (32948), a `?c=…&prod=1` URL reaches the read-only Production preview without the password;
  an unknown `?c=` slug with no matching client falls through routing to `navTo('home')` and paints
  the staff dashboard. These are consequences of client-side auth and are the target of the B4 flip.
- **Roles are derived per request, never stored.** `client` = `?c=` present (`_isClientLink`);
  `kasper` = hash is exactly `#kasper` or `?Kasper=1`; else `smm` (the password-gated default). Roles
  ride writes as `X-Syncview-Role` / `X-Syncview-Actor` headers; client links add
  `X-Syncview-Client-Token` from `?t=` **only** on Edge-Function URLs (n8n-routed client writes carry
  no token). Note the asymmetry: tab *unlock* for Kasper/Pilot is `sessionStorage`-based and covers
  subtabs, but the *role header* requires the exact `#kasper` hash or `?Kasper=1` — a write from
  `#kasper/<subtab>` unlocked only via sessionStorage is stamped `smm`.
- **Runtime-flag machinery.** Three REST reads of `syncview_runtime_flags` (calendar-upsert,
  settings, sample-review keys) are primed unconditionally at script eval — *every* visitor,
  including client links, hits the flags table three times and opens three realtime channels
  (`syncview-runtime-flags`, `syncview-settings-runtime-flags`, `syncview-sample-runtime-flags`)
  lazily after supabase-js loads. Any flag read failure empties the set → all writes route to n8n
  (fail-safe).
- **Realtime channels (13).** `cal-<slug>`, `sm-<slug>`, `sxr-<slug>` (per-client post/sample
  streams); `kasper-cal`, `kasper-sxr` (unfiltered cross-client Kasper queues);
  `client-credentials-rev-<slug>` / `-kasper`; `syncview-filming-plans`, `syncview-templates`,
  `workload_issues` (declared, dormant); and the three runtime-flag channels. supabase-js is a lazy
  CDN UMD load, memoized once; failure resolves null and every caller falls back to REST/n8n.
- **Theme / palette.** `syncview_theme='dark'` opt-in (light default; forced light + toggle hidden
  on client links) and `syncview_status_palette='classic'`, both read pre-paint. One-click rollback.
- **App-update nudge.** Polls `HEAD` of its own URL every 5 min + on focus, comparing
  ETag/Last-Modified; never force-reloads; **disabled under `?prod=1`** (which also skips resume of
  pending calendar-card jobs).
- **Config note.** The onboarding/list Edge Functions are composed onto a hardcoded edge-base
  constant declared *before* the main Supabase URL constant (TDZ avoidance) — that is why §7 counts
  "12 literal + 4 composed" Edge Functions.

## 4. Surface catalog

Fifteen surfaces. Thirteen carry over from v1 (verify items resolved); **SMM Weekly Reports** and
**Client Credentials** are promoted to their own rows (v1 folded them away). Line numbers are
current-file anchors.

### 4.1 Analytics (home) — the default tab

*The v1 "Analytics data sources — not yet traced" item. Answer: 100% Google Sheets; no Supabase, no
n8n in the metric read path.*

- **Entry.** Default tab (`navTo('home')`); client profile via `#<ClientName>` hash, search, pins,
  or table rows; also the landing view for a bare `?c=` client link.
- **Reads.** Six `gviz` CSV tabs from one workbook: `Metrics` + `Clients Info` (essentials) and
  `TopVideos`, `Competitor Briefs`, `Market Research Briefs`, `ContentSummaries` (extras). AI tab/
  synthesis summaries via n8n `generate-tab-summary` and `generate-general-brief` (compute-on-read,
  cached client-side). `client-token-verify` EF only on client links. Chart.js CDN asset.
- **Writes.** All n8n, all fire-and-forget-then-poll: `generate-market-brief`, `generate-brief`
  (competitor) — completion detected by re-polling the same CSVs every 30 s for a new row, *there is
  no brief-read webhook*; `generate-content-summary` (also logs to the `ContentSummaries` sheet);
  `add-hook-to-library` (appends a Hook Library sheet row — **not** gated by `_isClientLink`);
  `weekly-slack-top-reel` (team + client has a Slack channel).
- **State.** `syncview_analyticsCache_v1` (7-day stale-while-revalidate snapshot of all six CSVs +
  a djb2 fingerprint for skip-repaint), `syncview_viewMode`, `syncview_gainPeriod`,
  `syncview_savedHooks`, `syncview_tabSummaryCache_v2` / `syncview_tabSummaryBriefIds_v1`,
  `syncview_generalBriefState_v5`, `syncview_pendingBriefs_v1` (in-flight generations, polling
  resumes across reloads), `syncview_contentSummaryState_v1`, `syncview_submittedMRKeywords_v1`,
  `syncview_recent_searches`, `syncview_pinned_clients`. `syncview_gainMode` is **dead state**
  (written, never read). No REST tables, no kill switches, no realtime.
- **Roles.** Team: full overview + brief-generation panels + share/Slack buttons. Client link:
  `clientOnly` render, generation UIs replaced with "Check back soon", Brief tab only if data already
  exists; token gate is sheet-token compare + `client-token-verify` EF, **both fail open** (empty
  token column → unguarded; verifier network error → permissive).
- **Failure/fallback.** Awaited home path with no cache → full error card. After a cache paint,
  fetch failure is `console.warn` only (stale data stays). `ContentSummaries` fetch is
  `.catch(()=>null)`. Brief POST errors keep polling (pending state persisted *before* the POST);
  polling times out at 40 min (MR) / 15 min (competitor) → timeout card. `generate-tab-summary`
  errors render **nothing** (silent). Chart.js CDN miss retries 40× then charts silently absent.
- **Notable.** Client-viewable brief pages can write to the agency Hook Library (`add-hook-to-library`
  ungated) and can trigger the `generate-content-summary` AI workflow (ungated). Two hardcoded
  per-client display special-cases exist in the render path. Correction: `content-ready` is **not**
  here — it belongs to Workload.
- **Track B.** No impact — analytics stays on Sheets by owner decision D2; sources remain out of the
  Linear program.

### 4.2 Content Calendar

- **Entry.** Team tab / `#calendar[/<slug>/<cardId>]` deep link (unresolved slugs defer until the
  roster loads); client link `?c=…&v=calendar&t=…`; embedded per-client profile tab.
- **Reads.** Posts: `calendar_posts` REST (v2, **default ON**, keyset-paginated on `(id, client)`
  because post ids aren't globally unique) with automatic fallback to n8n `calendar-get` on REST
  failure or `?v2=0`; realtime `cal-<slug>` (350 ms-debounced reload, 4 s self-echo suppression,
  catch-up snapshot on reconnect). Linear card-banner meta via n8n `linear-issue-statuses` (throttled;
  v1-only reconcile) and `linear-subissues` (parent expansion for link-adopt / import / bulk-match).
  Caption prompts (n8n `caption-prompts-get` base + flag-gated `caption_prompts` REST overlay — see
  §4.11). Caption job state via n8n `caption-job-status` (5 s poll while jobs active). Runtime-flag
  reads (calendar-upsert + settings keys). supabase-js + `xlsx` CDN assets.
- **Writes.** Every card save (fields, comments, statuses, approvals, archive-as-`status:Archived`,
  imports) → **`calendar-upsert` EF iff the slug is flagged, else n8n `calendar-upsert-post`**
  (comments piggyback as JSON in `*_tweaks` columns; v2 sends `comments_base_at:''` to skip the
  server scalar-merge guard). Reorder cascades **EF `calendar-reorder` → n8n
  `calendar-reorder-batch` → n8n `calendar-reorder`** (per-row, last resort). Linear legs (n8n):
  `linear-set-status`, `linear-add-comment` (per-issue serialized + coalesced, durable outbox on
  failure). `send-urgent-slack` (URGENT tweak ping). Caption AI: `generate-caption`,
  `caption-job-update`. `caption-prompts-save` (EF/n8n by settings flag). `thumbnail-folder-resolve`
  EF (Drive parent-folder link; skipped for client links). URGENT "sent" marker → **`calendar-upsert`
  EF directly, bypassing the kill switch**.
- **State.** `syncview_calendar_v2`/`_off` (sticky v2 read toggle), `syncview_cal_v2debug`,
  `syncview_calCache_v1:<slug>` (7-day SWR cache, quota-evicts oldest), `syncview_calendar_prefs`,
  `syncview_cal_filters_v1`, `syncview_calendar_pins`, `syncview_calendar_settings_v1` (per-client
  collab/title-review, device-authoritative within a trust window), `syncview_cal_scroll_<slug>`,
  `syncview_cal_archived_v1_<slug>` (local archive ledger), `cal-skip-approve-confirm`,
  `cal-skip-setall-confirm-<status>`, `syncview_captionJobs_v1`, `syncview_linear_outbox_v1`,
  `syncview_calLinearMeta_v1`, `syncview_kasper_seen_v1`/`_at_v1`, `syncview_notes_seen_v1`,
  `syncview_calCardJobs_v1` (durable post-submit card jobs). sessionStorage: `sv_noteDraft_<pid>`,
  the shared token-verify cache. **Kill switches:** `calendar_upsert_ef_clients` (upsert+reorder
  routing), `settings_ef_clients` (caption-prompts-save + prompt overlay), `?v2=0`. Rich optimistic-
  state guards (`_calReorderOptimistic` 12 s, recent-save windows, save-in-flight queues).
- **Roles.** Client: Review tab targets Client-Approval→Approved, may approve/comment/drag (drag only
  when collab_mode on), status labels renamed. SMM: multi-select archive/caption/link, bulk set-all,
  collab/title toggles, bulk Linear link, bulk caption, thumbnail resolve. Kasper shares the write
  plumbing but mostly lives on its own surface.
- **Failure/fallback.** Cache-primed paint → 20 s dual-timeout; failure with cards on screen shows a
  small "busy/failed" chip, not a blank. **v2 REST failure transparently falls back to n8n** (a
  Supabase outage never blanks the calendar). **Single-card upsert has NO EF→n8n fallback** — it
  errors the card (rollback of structural fields, free text kept, retry chip); only *reorder* and the
  *flag read* fall back to n8n. Linear pushes queue to the localStorage outbox (retry on load/focus/
  60 s, parked after 6 attempts). Caption jobs are poller-authoritative with 45 s/3 min/12 min
  watchdogs. Realtime subscribe failure degrades to fetch-on-focus.
- **Notable / corrections.** `calendar-append-post` and `calendar-delete-post` are **dead** (constants
  defined, zero fetch sites; delete is an archive-upsert). `linear-tweak-comments` is **not** a
  calendar endpoint (it's Workload's). The URGENT-marker write bypasses the routing flag, so an EF
  outage breaks sent-state persistence even for n8n-routed clients.
- **Track B.** Continuous `*_deliverable_id` linkage is already maintained and drained to 0. At each
  B4 team flip: four link-predicate families re-point, name-sync activates, comments stay single-
  writer on the card thread. B5: link columns inert.

### 4.3 Linear tab (batch submission)

- **Entry.** Team tab / `#linear`; `?intake=1` hard-locks the whole SPA to this form (no password,
  chrome hidden, `navTo` coerced to `linear`).
- **Reads.** n8n `linear-projects` (client dropdown, on mount when empty). `filming_plans` REST (+
  Sheets CSV fallback + `syncview-filming-plans` realtime) to resolve a read-only plan link. Post-
  submit link poll reads `workload_issues` REST (Workload v2 default) → n8n `linear-issues` fallback.
  Calendar-upsert routing flag (read).
- **Writes.** n8n `video-form` and `graphic-form` are the **live batch submit endpoints** (one POST
  carries the whole batch; "Create Linears" fires both). n8n `log-linear-submission` writes a
  replayable webhook envelope to a Sheet *before* submit (audit / manual replay). Background per-video
  calendar-card creation routes through the **calendar's** shared upsert fetch (EF `calendar-upsert`
  vs n8n `calendar-upsert-post` by the calendar flag) with deterministic `p_lin_<ident>` ids.
- **State.** `syncview_linear_form` (autosaved draft, cleared on submit), `syncview_last_link`,
  `syncview_calCardJobs_v1` (durable card-write jobs, resumed on boot, 3-min heartbeat prevents
  double-run, gives up after 48 h / 5 runs), `syncview_linearIssuesCache_v1` (5-min), `?wl2` /
  `syncview_workload_v2_off`. Kill switches: `calendar_upsert_ef_clients`, `?wl2=0`.
- **Roles.** Staff full; intake role = password-bypassed Linear-only lock; clients never reach it
  except via intake (which stays role `smm`). Kasper active → background card writes carry kasper
  headers.
- **Failure/fallback.** `linear-projects` fail → empty dropdown, retry only on next mount. `video-
  form`/`graphic-form` are **fire-and-forget with `.catch(()=>{})`** — a failed Linear creation is
  silent and the green "Issue created!" banner shows unconditionally; the only recovery is the
  `log-linear-submission` Sheet envelope. Background card writer: durable job saved *before* the async
  work; 15 s wait then ≤20 polls × 5 s to find + link sub-issues; shortfall → "Calendar sync
  incomplete" pointing at calendar's Import-from-Linear. Resume skipped under `?prod=1`.
- **Notable / corrections.** `linear-subissues` is a **read** used by Calendar/SXR, not a Linear-tab
  write. The durable card-job system exists because of a real data-loss incident (tab closed during
  the pre-write window). Due dates are computed client-side in 5-working-day batches.
- **Track B.** B3: still creates in Linear and mirrors in. B4: native create; split-authority legs
  adopt into the existing batch row. B5: `linear-subissues` + family retired.

### 4.4 Production tab (`?prod=1`) — read-only Linear mirror

- **Entry.** `?prod=1` only (`_prodEnabled`). `init()` short-circuits to mount it and leaves
  essentials in the background; deep-link state in `#production` + many params.
- **Reads.** All Supabase REST via the dynamic `'/rest/v1/'+table` pager (`_prodRestRows`): boot
  loads `clients`, `team_members`, `batches`, and a **lightweight** `deliverables` select (PR-#779
  shape — tombstone markers via `linear_raw->>…` JSON aliases, no `brief`/`linear_raw` body). Lazy:
  `deliverable_events` (activity, on detail open), full `deliverables` row (brief + raw, on open),
  bulk brief hydration 6.5 s post-boot / on palette open. Also fires the shared Sheets essentials in
  the background for app chrome.
- **Writes.** **None.** Every mutating control routes to `_prodReadonlyGuard` → "Preview — read-only"
  toast. Module header and code agree: no writes, no realtime, no flag changes, no n8n/Linear side
  effects.
- **State.** `syncview_prod_display_v1` (groupBy/orderBy/showSubIssues), shared `syncview_nav` /
  `syncview_auth_v1`. Deep-link params: `group`, `order`, `subs`, `team`, `view`, `issues`,
  `pdetails`, `client`, `d`, `batch` (`ptab` is dead). In-memory `_prodState` (rows + adapter, events
  Map, linearRaw Map). No kill switches, no realtime, no polling.
- **Roles.** No role logic inside — the gate is `?prod=1` + the app-level password. "My issues" is a
  hardcoded heuristic (member matching a specific name, else first active assignee), not a real
  identity.
- **Failure/fallback.** Per-page fetch: 3 attempts, retry only network/429/5xx. Boot-load failure →
  full-tab error screen + Retry; silent refresh failure → `console.warn`, stale kept. Pagination-cap
  overflow is a hard error (never silent truncation). Freshness = silent refresh on visibility/focus/
  pageshow, throttled 30 s. `_prodRefresh` clears the events Map but **not** the linearRaw Map (an
  opened deliverable's detail can go stale).
- **Notable.** `?c=…&prod=1` reaches this read-only mirror without the password (see §3). This is the
  **only** user of the dynamic REST call site; its five tables are absent from the literal-table
  inventory by design. Deleted/archived issues are filtered client-side from tombstone JSON, not
  server-side. `prod_authority` does **not** exist anywhere in `index.html` yet.
- **Track B.** The core surface. B3 (now): read-only mirror at full parity (~4.3k deliverables). B4:
  writable via deliverable-/batch-write EFs + outbound mirror. B5: the only production surface.

### 4.5 Samples New (SXR) — `sample_reviews`

- **Entry.** Team tab `#sample-reviews[/<slug>/<id>]`; client portal `?sxr=1&c=…&v=sample-reviews&t=…`;
  Kasper "samples" subtab. Module **default ON** since GA 2026-07-02 (`syncview_sxr_on`; `?sxr=0`
  sticky opt-out) — the in-code "default-OFF" comment is stale.
- **Reads.** Per-client `sample_reviews` REST (Archived excluded server-side) with n8n
  `sample-review-get` fallback; realtime `sxr-<slug>`. Kasper queue: **unscoped cross-client**
  `sample_reviews` REST (no client filter, **no webhook fallback**) + unfiltered `kasper-sxr`
  realtime. n8n `linear-subissues` on fresh link-adopt. Runtime-flag read (sample-review key).
  Shared: SMM-directory CSV, client-token-verify EF.
- **Writes.** `sample-review-upsert` (EF iff flagged, else n8n — **no EF→n8n fallback**),
  `sample-review-reorder` (EF **with** n8n fallback on failure). Linear legs (`linear-set-status`,
  `linear-add-comment`), `send-urgent-slack`, `thumbnail-folder-resolve` (all shared). URGENT marker
  → `sample-review-upsert` EF directly (bypasses the flag).
- **State.** `syncview_sxr_on`/`_off`, `syncview_sxr_prefs_v1`, `syncview_sxr_cache_v1_<slug>`,
  `syncview_sxr_archived_v1_<slug>` (60 s-grace ledger), `syncview_sxr_kasper_seen_v1`,
  `syncview_sxr_linear_outbox_v1`, `sxr-skip-setall-confirm-<status>`; shares
  `syncview_calendar_pins` + `syncview_notes_seen_v1`. sessionStorage `sv_sxrNoteDraft_<pid>`. Kill
  switch: `sample_review_ef_clients`.
- **Roles.** SMM: full edit, SMM-review flow, share-link kebab, media-less cards excluded. Kasper:
  works only the cross-client queue (never the `#sample-reviews` route); internal-only comments; each
  card persists with its own slug. Client: read-only, embedded Review+Sheet shell, sees only client-
  ready components, Kasper authorship stripped.
- **Failure/fallback.** Per-client read: REST → n8n → cached cards + "couldn't refresh" notice.
  Kasper read: no fallback → keeps items, "try again" only when empty. Upsert: per-card retry chip,
  no n8n fallback. Reorder: EF→n8n. Archive: optimistic + ledger, restore on failure. Linear outbox
  retry. Token verify fail-open on network error.
- **Notable / corrections.** v1's "courier" and "filming-tabs stub" attributions are wrong — no
  `courier` symbol exists; filming-tabs belongs to Kasper. `comments_base_at` is hardwired `''`
  (server merge effectively off; merge is client-side). The unscoped Kasper read answers v1's open
  question about who reads `sample_reviews` globally.
- **Track B.** Same §9.2 re-point story as Calendar (including the samples twins gates). Samples-
  specific: a scheduled/posted clamp is a tolerated divergence; B2 must ship the samples outbox-peek
  for flip-step drain evidence.

### 4.6 Samples Old — `content_samples`

- **Entry.** Team tab `#samples[/<slug>/<cardId>]`; client portal `?c=…&v=samples&t=…`. Coexists with
  SXR — the `?sxr` flag never hides `#samples`; the two boards share no data.
- **Reads.** `content_samples` REST is the **default read** (Supabase since Phase 3, 2026-06-15 — v1's
  "opt-in behind `?sv2`" is stale); n8n `samples-get` is the per-request fallback and primary only
  under sticky `?sv2=0`. Realtime `sm-<slug>`. Token-verify EF on client links.
- **Writes.** **n8n only** — `samples-upsert` (whole-row: fields + approval + JSON-stringified
  comments; n8n dual-writes Sheet + Supabase), `samples-reorder`, archive via a `status:Archived`
  upsert. No Edge-Function write, **no kill switch** for this surface.
- **State.** `syncview_samplesCache_v1:<slug>` (7-day, also the offline write fallback),
  `syncview_samples_prefs_v1`, `syncview_samplesSeen_v1`, `syncview_samples_v2`/`_v2_off`; shares
  `syncview_calendar_pins`. Only kill = local `?sv2=0` (reads only).
- **Roles.** Client: read-only, approval states {client/approved/changes}, internal threads hidden,
  "Request a change" flips only when the note is actually sent. Team: full editor incl. the Kasper
  approval *stage* (a stage here, not a role — any password-holder clicks it).
- **Failure/fallback.** Cache-first → REST → n8n; both fail + nothing cached → "offline, saved on this
  device" banner; both fail + cache → stale board, silent. **Writes have no outbox/retry** — a failed
  save shows a *green* "Saved on device" and only retries when that card is edited again. Delete/
  reorder are fire-and-forget with empty catches.
- **Notable.** Whole-row last-write-wins hazard (realtime only suppresses self-echo, doesn't merge).
  Client links still depend on the analytics Sheet for the review token even though board data is in
  Supabase/n8n. `setSmMode` preview toggle is dead code.
- **Track B.** No impact — D4 keeps samples-upsert/-reorder on n8n; retirement is a separate SXR-GA
  effort outside the §13.4 teardown; its silent local fallback is named in the spec as an anti-pattern.

### 4.7 Kasper mode (`#kasper` / `?Kasper=1`)

- **Entry.** `?Kasper=1` sets sessionStorage `syncview_kasper_unlocked` and reveals the nav button
  (legacy localStorage unlock is actively deleted at boot). Subtabs: review, samples (only if SXR
  enabled), replies/messages, editors, filming, sales-intake, onboarding, client-credentials — hash
  `#kasper/<subtab>`, persisted in `syncview_kasper_subtab_v1`.
- **Reads.** Review queue is a **3-tier fallback**: `calendar_posts` REST (paginated, v2 default) →
  n8n `kasper-queue` (batched `{slugs}`) → per-client n8n `calendar-get` fan-out (5 workers).
  Cross-client `sample_reviews` REST (samples subtab). n8n `editors-week` (editors). `filming_plans`
  REST + n8n `filming-plan-tabs` (filming). `onboarding-full` EF (Kasper-only, key-gated). `client-
  credentials` EF (list/history). SMM-directory CSV. Realtime `kasper-cal`, `kasper-sxr`,
  `client-credentials-rev-kasper`, plus shared flag/filming channels.
- **Writes.** Approvals/tweaks/comments/finish-close stamps via the shared calendar & sample upsert
  fetches (flag-routed), field-level patches diffed against a per-card base. Linear `linear-set-
  status` / `linear-add-comment` (tweaks only — plain comments skip Linear). `send-urgent-slack` +
  direct EF urgent markers (bypass flags). n8n `sales-intake-submit`. `client-credentials` EF
  (upsert/delete/reassign/bulk_import/log_reveal).
- **State.** sessionStorage `syncview_kasper_unlocked`; localStorage `syncview_kasper_subtab_v1`,
  `syncview_kasper_review_cache_v1` (24 h), `syncview_kasper_cal_<slug>_v1` (5 min),
  `syncview_kasper_approved_log_v1`, `syncview_kasper_editors_v2`, `syncview_kasper_filming_v1` (30
  min), seen ledgers, both Linear outboxes, `syncview_client_credentials_identity_v1` (staff pass-
  phrase, shared with onboarding-full), `syncview_sales_intake_draft_v1`. Kill switches: the calendar
  & sample flags + `?v2=0`.
- **Roles.** Hidden staff role, **no password for the queue itself** — only the URL param / session
  flag. Kasper comments are role `kasper` + audience `internal`, stripped from client views.
  Sensitive subtabs (onboarding-full, client-credentials) add a **real** gate: the staff passphrase
  sent as `X-Syncview-Key`, verified server-side.
- **Failure/fallback.** Queue 3-tier as above; cached ≤24 h snapshot keeps painting. Persist failures
  revert + per-card error; finish/close failures swallow (local flag hides the card, next write
  reconciles). Linear outbox retry. 401 on key-gated subtabs → one re-prompt. Realtime failure →
  visibility/focus refresh only (no poll despite a stale 30 s comment).
- **Notable / corrections.** "SMM reports" is **not** a Kasper subtab (it's a separate top-level
  route, §4.14). `kasper-queue` is the **middle** fallback, not primary. The role-header quirk
  (§3) misattributes writes made from `#kasper/<subtab>` as `smm`. The Kasper unlock has no
  password, so for credentials the passphrase is the only real secret.
- **Track B.** The queue-visibility gates are one of the §9.2 predicate families — missed at flip,
  new thumbnails silently vanish from review. The Messages inbox keeps working on card threads.

### 4.8 Workload

*The v1 "Workload exact feeder" item. Answer: Supabase `workload_issues` is the default feeder; n8n
`linear-issues` is the automatic fallback.*

- **Entry.** Team tab / `#workload`. The Editors weekly view is a Kasper-only subtab (`#kasper/editors`).
- **Reads.** `workload_issues` REST (`active=eq.true`, paged 1000, **default ON** since 2026-06-17)
  → n8n `linear-issues` fallback on error / 0 rows / `?wl2=0`. The `workload_issues` **realtime
  channel is DEAD CODE** (`WL_V2_REALTIME` hardcoded false — the reconcile rewrites every row and
  would flood boards); liveness is a 5-min cache TTL + visibility refetch + manual refresh. n8n
  `linear-tweak-comments` (Tweak-Needed popover, 5-min cache). n8n `editors-week` (**one** fetch
  site — POST `{}` — returns per-editor weekly transitions; all metrics computed client-side).
- **Writes.** n8n `content-ready` (manual "content ready for review" email; **never checks
  `resp.ok`** — HTTP errors display as success).
- **State.** `syncview_linearIssuesCache_v1` (5 min, both feeders), `syncview_workload_v2_off`
  (`syncview_workload_v2` is write-only / vestigial), `syncview_workloadView_v1`,
  `syncview_kasper_editors_v2` (week-rollover-invalidated). Kill switches: `?wl2=0`, the compile-time
  `WL_V2_REALTIME=false`. No `syncview_runtime_flags` switch for this surface.
- **Roles.** Staff-only, read-only board for everyone; Editors view further gated behind the Kasper
  unlock.
- **Failure/fallback.** REST error / non-array / 0 rows → automatic n8n fallback (no user signal).
  Both fail + cache → stale board (error only set when no cache); no cache → red error card.
  `editors-week` fail → error card, older week cache still usable.
- **Notable / corrections.** v1's "3 call sites" for `editors-week` is wrong — one fetch site (the
  others are the constant + comments). The realtime channel is dormant. `content-ready`'s missing
  `resp.ok` check is a real bug-shape. `loadLinearIssues` is also the Calendar bulk-create link poll's
  data source (shared feeder + cache).
- **Track B.** v1 was stale: the re-point to `deliverables` happens **per team at each B4 flip**
  (realtime turns on then), not only at B5. B5 retires the Workload reconciler + `workload_issues`
  and replaces `editors-week` with the spec query.

### 4.9 Client links (`?c=<name>&t=<token>`, no-login)

- **Entry.** `?c=` in the query. Four portals by `?v`: analytics profile (default), embedded Calendar
  (`?v=calendar`), old Samples (`?v=samples`), Sample-Reviews (`?sxr=1&v=sample-reviews`). Boot adds
  `boot-client`, bypasses the password, hides staff chrome.
- **Reads/Writes.** All shared with the owning surfaces (§4.1/4.2/4.6/4.5), scoped to the one client;
  the exclusive endpoint is **`client-token-verify` EF**. Client approvals/change-requests **do write
  to Linear** (`linear-set-status` / `linear-add-comment`, with durable outbox) — a client action can
  mutate the team's Linear workspace.
- **State.** The per-surface caches/flags of whichever portal loads, plus sessionStorage
  `syncview_client_token_verify_v1` (per `slug|token` verdict cache). `X-Syncview-Client-Token` is
  attached **only** to EF URLs.
- **Roles.** `role='client'` wins over `#kasper`/`?Kasper=1`. **Can:** approve, request changes with
  a note, comment, and (collab_mode ON) edit/drag/suggest. **Cannot:** set statuses directly,
  archive, multi-select, tag colours/platforms, link Linear, generate captions, bulk ops, URGENT
  ping, credentials, brief regeneration, copy/share kebabs. Sees only client-ready cards; Kasper
  authorship always hidden; status labels renamed.
- **Failure/fallback.** Token mismatch → static "isn't valid" screen. **Empty token column → fail
  open** ("unguarded"). `client-token-verify` blocks only on 401/410/`mode:enforced`, **fails open on
  any network error**, and caches positive verdicts per session (revocation needs a new tab). Read/
  write fallbacks inherit each portal's behavior.
- **Notable / corrections.** v1's `client-links-refresh` **does not exist** — the nearest code is a
  purely client-side "open profiles" dropdown (zero backend). An **unknown `?c=` slug** falls past the
  token gate to the staff home dashboard without a password. Old-samples client writes carry **no
  role/token headers** (indistinguishable from SMM at the webhook).
- **Track B.** Tokens already minted and the verifier is live in permissive mode. Remaining: re-issue
  links per client, then flip fail-open → fail-closed. Untouched by `prod_authority` flips.

### 4.10 Filming Plans

- **Entry.** Team tab `#filming-plans`; Kasper "filming" subtab (read-only). Shared consumers:
  Templates profile card, Linear form's read-only plan field.
- **Reads.** `filming_plans` REST (all rows) with **Google Sheets CSV fallback** on failure; realtime
  `syncview-filming-plans` (subscribed only after a successful REST load — sheet-fallback sessions get
  no live updates). n8n `filming-plan-tabs` (Kasper only, optional coverage probe of Google-Doc tab
  names, per doc, concurrency 5). Kasper runway reuses Calendar reads.
- **Writes.** **`filming-plans` EF is WRITE-ONLY** (single POST upsert; never read from). Gated by a
  prompted "onboarding staff passphrase" (`syncview_filming_plans_identity_v1`); the request always
  sends `X-Syncview-Role: onboarding`.
- **State.** `syncview_filming_plans_identity_v1`, `syncview_kasper_filming_v1` (30-min, cleared on
  any plan save), in-memory `filmingPlansData` + `_linearPlanMap`. **No kill switch** —
  `FILMING_PLAN_TABS_URL` is a build-time switch only.
- **Roles.** Team page behind the password; Kasper subtab read-only behind the unlock; writes gated by
  passphrase possession, not view role.
- **Failure/fallback.** REST → Sheets CSV → both fail throws (page error card; Templates swallows;
  Linear field degrades to "No filming plan"; Kasper error card). EF save 401 → one re-prompt; other
  failure → inline error, **no fallback/retry/queue**. Runway fetch failure can paint a client
  falsely "red".
- **Notable / corrections.** Batch filming links in the Production surface come from the `batches`
  table's own `filming_doc_url` column — a **separate store** from `filming_plans`; they never sync.
  Templates prefers the `filming_plans` row over the legacy template field.
- **Track B.** No impact — filming/footage/delivery links ride `batches`; the n8n read stays baseline.

### 4.11 Templates + Caption prompts

*The v1 "caption-prompts read path" item. Answer for BOTH templates and prompts: n8n is the live
mandatory base; the Supabase REST read is a flag-gated OVERLAY, not a fallback.*

- **Entry.** Staff-only tab `#templates[/<client>]`; the caption-prompts half is entered from the
  Calendar (prompts load on every calendar mount; the edit modal opens from the card kebab).
- **Reads.** Templates: n8n `templates-get` (mandatory base, every load incl. client links) then, for
  `settings_ef_clients`-flagged slugs only, a `templates` REST overlay merged on top + realtime
  `syncview-templates`. Prompts: n8n `caption-prompts-get` base + flag-gated `caption_prompts` REST
  overlay (no realtime channel for prompts). Runtime-flag read (settings key). Shared: filming-plans
  store, onboarding slug-index EFs (gate the profile's Onboarding button).
- **Writes.** `templates-save` and `caption-prompts-save` — EF iff the slug is in
  `settings_ef_clients`, else the n8n twin. Debounced autosave; **writes always claim role `smm`**
  even in Kasper mode, and never attach a client token.
- **State.** `syncview_tpl_pinned_clients`, `syncview_tpl_recent_searches`, in-memory
  `templatesData` + prompt cache + `_settingsEfClients`. History-state carries the client + Reels/
  Thumbnails tab. Kill switch: `settings_ef_clients` (gates both writes, both overlays, and the
  templates realtime).
- **Roles.** Main-team-only by chrome (nav hidden for client/intake/onboarding); Kasper is the same
  staff session. Prompt *read* fires for all roles incl. client links; the edit modal is SMM-only.
- **Failure/fallback.** n8n base fail → whole load fails, overlay never attempted, error banner, **no
  retry until a full refresh** (no localStorage persistence, unlike calendar). Overlay/flag/realtime
  failures → silent, keep n8n base. Save fail → persistent "Save failed" indicator, re-sends only on
  next edit. Prompt use sites fall back to the default prompt string.
- **Notable / corrections.** Neither direction is "REST live, n8n fallback" — overlay-over-base both
  ways. `settings_ef_clients` gates exactly templates + caption-prompts (not credentials). Multi-link
  fields persist a JSON sibling column plus a mirrored legacy single column (2–3 patches per edit).
  The templates/settings realtime channels are deliberately never torn down.
- **Track B.** Low. All active clients on the A4 EFs. Only Track-B touch: §6 role-key enforcement on
  the two save EFs at the auth flip. No B4/B5 mechanics.

### 4.12 TikTok Upload (+ hidden TikTok Pilot)

*The v1 "TikTok Upload backend" item. Answer: production posts via n8n → Post-For-Me; the Pilot is a
separate hidden first-party Direct-Post surface.*

- **Entry.** **Upload:** always-visible team tab / `#tiktok-upload` (a fast tab). **Pilot:** hidden
  tab unlocked by `?ttpilot=1` → sessionStorage `syncview_ttpilot_unlocked`; `#tiktok-pilot` routes
  only while unlocked; OAuth returns via `?connect=ok|error`.
- **Reads.** Upload: n8n `tiktok-uploads-list` (queue; adaptive poll, visibility-paused). Pilot: n8n
  `ttp-accounts-list`, `ttp-creator-info` (drives privacy options), `ttp-list` (queue + sole status
  source; 5 s poll while processing).
- **Writes.** Upload: n8n `tiktok-upload` (multipart XHR → Post-For-Me), `tiktok-upload-cancel`,
  `tiktok-upload-status` (**used only for the failed-row Retry** — `?id&retry=1`, not polling). Pilot:
  n8n `ttp-auth-init` (full-page OAuth redirect), `ttp-submit` (Direct Post; privacy locked
  `SELF_ONLY` while the app is unaudited).
- **State.** Upload: `syncview_tiktokUploadForm_v1`, `syncview_pendingTiktokUploads_v1` (optimistic,
  5-min TTL), `syncview_hiddenTiktokUploads_v1`. Pilot: `syncview_ttpilotForm_v1`,
  `syncview_pendingTtpilot_v1`, `syncview_hiddenTtpilot_v1`, sessionStorage
  `syncview_ttpilot_unlocked`. **No Supabase at all** — no REST, no EF, no realtime, no runtime-flag
  switch; the only gate is the compile-time `TTP_APP_AUDITED=false`.
- **Roles.** Both team-only behind the password; Pilot needs the extra `?ttpilot=1` unlock; no per-
  user roles beyond that. Clients/intake never reach either.
- **Failure/fallback.** Submits show inline errors, keep the draft/file, **no auto-retry / fallback /
  queue**. Queue list: 20 s timeout, first fail shows a card then silent retries; adaptive poll (30 s
  in-flight / 120 s scheduled / stop when idle) replaced a fixed loop that cost ~2.5k empty
  executions/week. Draft file can't persist across reload (only fileMeta → "re-attach" hint).
- **Notable / corrections.** `ttp-status` is a **dead constant** (never fetched — matches the live-
  n8n "not-found"); `tiktok-upload-status` is a retry trigger, not a poller. Pilot is a deliberate
  clean room sharing no webhooks/state with production. Idempotency key doubles as the optimistic row
  id. `TikTok Pilot` also has backend-only webhooks (`ttp-auth-callback`, status cron, token refresh)
  not in the client inventory.
- **Track B.** No impact — TikTok stays in back-office n8n by owner decision D1; never referenced in
  the Track-B spec.

### 4.13 Onboarding + Sales intake

- **Entry.** Public onboarding form: `?onboarding` / `?onboarding=ai` / `/onboarding_form` /
  `/ai_onboarding_form` (each hard-locks nav to `onboarding`, forces its own dark theme). Viewer:
  `?onboarding_view=<slug>` (standalone, credential-free) + a Kasper "onboarding" inbox subtab. Sales
  intake is **not** a URL form — it is a Kasper subtab only.
- **Reads.** Viewer/index: `onboarding-list`, `ai-onboarding-list`, `legacy-onboarding-list` EFs
  (unauthenticated, credential-stripped). Kasper inbox: `onboarding-full` EF (un-stripped, key-gated).
  Same-origin media assets (audio/video/thumbnail-style previews).
- **Writes.** Onboarding submit is a **never-lose-a-submission chain**: primary n8n `onboarding-
  submit` (or `ai-onboarding-submit`) with one retry → `onboarding-capture` EF → n8n `onboarding-
  fallback` (also the `sendBeacon` target on tab-hide). Sales intake: n8n `sales-intake-submit`
  (preview/create contract + invoice email; **no auth header** — only the client-side Kasper unlock).
- **State.** `syncview_onboarding_draft_v1` / `syncview_ai_onboarding_draft_v1` (separate keys),
  `syncview_*_subid_v1` (stable dedupe id across retries/fallbacks, cleared on success),
  `syncview_sales_intake_draft_v1`, shared `syncview_client_credentials_identity_v1` (the
  `onboarding-full` key). No kill switches.
- **Roles.** Both forms fully **public** (no password, no token check — the `?onboarding` value is
  never validated). Viewer public but credential-stripped. Kasper inbox needs the unlock **and** the
  staff passphrase. Sales intake needs only the Kasper unlock; its webhook itself carries no auth.
- **Failure/fallback.** Submit chain: any leg's success shows the thank-you (a fallback capture counts
  as delivered); total failure → banner + "Download my answers" JSON + mailto escape hatch, no auto-
  retry. Draft sync is silent-fail with a 25 s throttle; pagehide uses a preflight-free `sendBeacon`.
  Viewer partial-list failure shows a warn banner; a standalone-viewer total failure is
  indistinguishable from "no record on file". Sales intake: single attempt, no retry/fallback, draft
  retained.
- **Notable / corrections.** `?intake=1` is **NOT** this surface (it's the client Linear-submission
  mode — the code comment literally warns "the key is sales-intake, never intake"). `sales-intake-
  submit` triggers real contracts/emails with only a client-side gate. A dead `SC_THUMB` constant and
  a stale "activate it in n8n" hint remain in the module.
- **Track B.** Low — the funnel stays n8n (D1); the onboarding-capture fallback is unchanged. §9.1's
  "intake" means the Linear-tab batch intake, not these forms.

### 4.14 SMM Weekly Reports (new row)

- **Entry.** Hash-only, no nav button: `#smm-weekly-report` (SMM form) and `#smm-weekly-reports`
  (viewer, labeled "Kasper view"). Viewer filters (`week/smm/client/status`) live in the hash query.
  **Both bypass the staff password** and hide all chrome; `syncview_nav` is deliberately never set to
  these routes.
- **Reads.** `smm-weekly-reports` EF — `?action=options` (roster + current week) and `?action=reports`
  (submitted reports). Client roster for the picker comes from the background analytics fetch.
- **Writes.** `smm-weekly-reports` EF POST `{action:'submit', report}` (13 fields required; server
  dedupes via 409 `already_submitted`).
- **State.** In-memory `_srpState` only (no persistence). Shared theme/palette. No kill switch.
- **Roles.** Effectively **roleless / ungated** — the EF is called with only the public anon key, so
  any URL holder can read every report and submit as any SMM.
- **Failure/fallback.** Options fail → in-card error, Submit disabled. Submit 409 → "already
  submitted"; other errors → inline, no retry/queue. Reports fail → viewer replaced by an error empty-
  state.
- **Notable.** The `smm-weekly-reports` EF is the only inventory endpoint using GET-query + POST-JSON
  on one URL. The no-gate reads/writes are a security-relevant gap vs v1's assumptions.
- **Track B.** No impact — content-side EF, never referenced in the Track-B spec; only generic §6
  role-key enforcement would apply to its staff writes.

### 4.15 Client Credentials (new row)

- **Entry.** (a) Kasper "client-credentials" subtab (`#kasper/client-credentials`), Kasper-unlock
  gated; (b) per-client SMM modal from the Calendar card kebab (only when a client tab is open and not
  a client link).
- **Reads.** `client-credentials` EF — `action=list` (full store for Kasper, one `client_slug` for
  the SMM modal), `action=history`, `action=bulk_import&dry_run=true`. Realtime
  `client-credentials-rev-kasper` / `-<slug>` are **ping-only** (payload discarded; a change just
  schedules a debounced re-list through the EF, so the passphrase requirement is preserved). SMM-
  directory CSV for the identity dropdown.
- **Writes.** `client-credentials` EF — `upsert`, `delete` (soft), `reassign` (Kasper only),
  `bulk_import`, `log_reveal` (fire-and-forget password-reveal audit).
- **State.** `syncview_client_credentials_identity_v1` (staff `{name, role, key}`; in-memory copy
  wins), in-memory `_ccState` (plaintext passwords live in JS memory), reveal/expand Sets, a 4.5 s
  self-echo window. **No `syncview_runtime_flags` switch**; CC realtime is gated only by the shared
  `_calV2Ready()` (so `?v2=0` silently disables live refresh here too).
- **Roles.** Three tiers: **Kasper** (full store, reassign, bulk import, history), **SMM** (per-client
  modal, role `SMM`), **client links** fully excluded. Real authorization is the shared staff
  passphrase (`X-Syncview-Key`, verified server-side); the role string is client-asserted and only
  labels audit entries.
- **Failure/fallback.** Any API 401 → clear key, re-prompt, retry once. List fail → inline error +
  manual Refresh. Mutations → toast + button re-enable, no queue. `log_reveal` failure ignored.
  Realtime failure → console.warn, no resubscribe (silent live-off).
- **Notable.** v1's `credentials-identity-persist` is **not an endpoint** — it's a source-guard test
  file. `thumbnail-revision-scan` EF is never called from `index.html` (thumbnail revision history is
  backend-only: baselines captured inside the upsert EFs, scan scheduled; `thumbnail_media_revisions`
  has no UI reader yet — **no new SPA row needed**). Passwords arrive in plaintext with `list` and sit
  in JS memory; masking is visual only; only reveals are audited (copies are not).
- **Track B.** No impact functionally, but architecturally load-bearing: `client-credentials` is the
  named precedent for the §6 role-key pattern; already staff-key-gated today.

## 5. What changes, when (Track B) + auth

Current phase: **B3 (live)** — evaluation mirror, Linear authoritative for both teams.
`prod_authority = {video: linear, graphics: linear}`, `linear_inbound_enabled = {enabled: true}`
(flip 15, 2026-07-07), `auth_enforcement = permissive`; the three Track-A `*_ef_clients` flags carry
the full active roster (Track A closed 2026-07-10). Mirror at full parity (~4.3k deliverables /
~1.0k batches; diff / repair / linkage all 0, 2026-07-11).

- **B4 (gate owner-dependent, auth first).** Per-team authority flip (`prod_authority[team]`, one-flag
  rollback): the Production tab becomes writable via deliverable-/batch-write EFs; Calendar & SXR
  link predicates re-point (spec §9.2); Workload re-points to `deliverables` per team (realtime on);
  intake creates natively; the outbound mirror keeps Linear current.
- **B5 (after clean batch cycles per team).** Linear frozen → archived; the `linear-*` n8n family and
  legacy card-write webhooks retired; Workload reconciler + `workload_issues` retired; SyncView is
  the whole production system.

**Auth (design locked, D6 — do not redesign).** Three role keys (admin / smm / creative) via
`X-Syncview-Key` + a roster-picked `X-Syncview-Actor`; client links stay no-login with minted,
server-verified tokens. Built and live: the B0 tables, the `client-token-verify` + `key-verify` EFs,
header plumbing, the flag-flip trigger; `auth_enforcement=permissive` with the flip rehearsed. The
login modal, key minting as EF secrets, the 72 h zero-unkeyed-writes telemetry, and the enforce flip
are the remaining B4-readiness work packages. **Auth precedes any real write phase.** Because it lives
at the write layer (every surface saves through the same EFs), one modal + the single
`auth_enforcement` flag covers the whole site at once — which is also why the client-side password
side doors in §3 close together at that flip rather than one surface at a time.

## 6. What v2 resolved from v1's verify list

- **Analytics data sources** → §4.1: entirely Google Sheets `gviz` CSV (six tabs); no Supabase/n8n in
  the metric path.
- **TikTok Upload backend** → §4.12: production is n8n → Post-For-Me; the Pilot is a separate hidden
  first-party Direct-Post surface; `ttp-status` is dead.
- **Workload feeder** → §4.8: `workload_issues` REST (default) with n8n `linear-issues` fallback; the
  realtime channel is dormant.
- **caption-prompts read path** → §4.11: n8n `caption-prompts-get` base + flag-gated `caption_prompts`
  REST **overlay** (not a fallback); same shape for templates.
- **Per-surface state / logic depth** → §4 (every surface's localStorage keys, kill switches, caches,
  URL params, roles, failure paths).
- **The mechanical sync test** → §7 + §8 (`test/system-map-sync.js`, wired into `npm test`).

Also folded in: two surfaces v1 hid (SMM Weekly Reports §4.14, Client Credentials §4.15); the three
deployed-but-uncalled Edge Functions (§2); and corrections to stale v1 claims (dead
`calendar-append/delete-post`, `kasper-queue` demoted to middle fallback, `editors-week` single fetch
site, SXR default-ON, non-existent `client-links-refresh`, `linear-tweak-comments`/`content-ready`
re-homed).

## 7. Endpoint inventory (machine-checked)

This section is the mechanical freshness contract. `test/system-map-sync.js` (part of `npm test`,
so it runs on every push) re-derives every list below from `index.html` and fails the build when
they drift — in either direction, including the counts. When it fails: update the owning surface's
section in §4 **and** the list here, in the same change that touched `index.html`.

- **n8n webhooks (55):** `add-hook-to-library` · `ai-onboarding-submit` · `calendar-append-post` · `calendar-delete-post` · `calendar-get` · `calendar-reorder` · `calendar-reorder-batch` · `calendar-upsert-post` · `caption-job-status` · `caption-job-update` · `caption-prompts-get` · `caption-prompts-save` · `content-ready` · `editors-week` · `filming-plan-tabs` · `generate-brief` · `generate-caption` · `generate-content-summary` · `generate-general-brief` · `generate-market-brief` · `generate-tab-summary` · `graphic-form` · `kasper-queue` · `linear-add-comment` · `linear-issue-statuses` · `linear-issues` · `linear-projects` · `linear-set-status` · `linear-subissues` · `linear-tweak-comments` · `log-linear-submission` · `onboarding-fallback` · `onboarding-submit` · `sales-intake-submit` · `sample-review-get` · `sample-review-reorder` · `sample-review-upsert` · `samples-get` · `samples-reorder` · `samples-upsert` · `send-urgent-slack` · `templates-get` · `templates-save` · `tiktok-upload` · `tiktok-upload-cancel` · `tiktok-upload-status` · `tiktok-uploads-list` · `ttp-accounts-list` · `ttp-auth-init` · `ttp-creator-info` · `ttp-list` · `ttp-status` · `ttp-submit` · `video-form` · `weekly-slack-top-reel`
- **Edge functions (16):** `ai-onboarding-list` · `calendar-reorder` · `calendar-upsert` · `caption-prompts-save` · `client-credentials` · `client-token-verify` · `filming-plans` · `legacy-onboarding-list` · `onboarding-capture` · `onboarding-full` · `onboarding-list` · `sample-review-reorder` · `sample-review-upsert` · `smm-weekly-reports` · `templates-save` · `thumbnail-folder-resolve`
- **Not counted above:** 12 of the 16 are referenced literally as `functions/v1/<name>`; 4 are composed onto the onboarding edge base constant. Three more live in `supabase/functions/` but are never called by the app: the B0 login verifier (wired in at B4), the Linear-webhook target, and the scheduled thumbnail Drive scanner.
- **Supabase REST tables, literal (7):** `calendar_posts` · `caption_prompts` · `content_samples` · `filming_plans` · `syncview_runtime_flags` · `templates` · `workload_issues`
- **Supabase REST tables, dynamic:** the Production tab pages any of its tables through `'/rest/v1/' + table` (variable `table` in `_prodRestRows`; reaches `batches`, `deliverables`, `deliverable_events`, `team_members`, `clients`), and SXR reads `'/rest/v1/' + SXR_TABLE` where `SXR_TABLE` = `sample_reviews`.
- **Runtime kill-switch flags (3):** `calendar_upsert_ef_clients` · `sample_review_ef_clients` · `settings_ef_clients`
- **Flag semantics:** per-client-slug allowlists in the runtime-flags table; a listed client's writes go to Edge Functions, an unlisted client fail-safes to n8n. All three carry the full active roster since 2026-07-07 (Track A closed 2026-07-10). Plan-side flags (auth enforcement, prod authority, linear-inbound enable) live in the same table but are not yet read by the app.

## 8. Freshness contract

Update this file **in the same PR** whenever a surface gains or loses a backend — a new EF, a new n8n
webhook, a new REST table, a new runtime flag, or a retired path. Polish-level UI changes don't count.
Two enforcement layers:

1. **Mechanical (§7).** `test/system-map-sync.js` re-derives the four inventories from `index.html`
   with the same greps this map was built from and fails `npm test` when the map and the code drift —
   missing endpoints, stale endpoints, wrong counts, or an undocumented dynamic REST call site. The
   failure message names exactly what to add or remove. This mirrors the `repo-map-sync` pattern.
2. **Editorial (§4).** The per-surface prose (reads / writes / state / roles / failure paths) is not
   machine-checkable; keep it current by editing the owning surface's section alongside the code
   change. When you touch a surface's data flow, its §4 entry and the §7 inventory move together.
