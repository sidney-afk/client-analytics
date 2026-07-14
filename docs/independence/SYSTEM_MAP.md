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

- **The app is one file.** `index.html` (~48.1k lines) is the entire SPA; GitHub Pages serves it
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
  `workload_issues`, `syncview_runtime_flags`; the visible **Linear** mirror (internal
  `production` surface) additionally pages `batches`,
  `deliverables`, `deliverable_events`, `team_members`, `clients`. Ledger/mirror tables
  (`*_events`, `mirror_outbox`, `linear_archive`, `client_credentials_rev`,
  `thumbnail_media_revisions`) are written by Edge Functions / reconcilers, not read directly by the
  SPA.
- **Edge Functions.** 24 are represented under `supabase/functions/`; **the draft app calls 19**
  (see §7). Five are backend-only: `linear-inbound`, `linear-outbound`, service-only
  `deliverable-write` / `batch-write`, and `thumbnail-revision-scan`. The deployed
  `production-write` v11 baseline is dark and TEST-verified; this draft adds the browser caller and
  a staged gateway delta that must deploy before that caller.
- **n8n** (single host). **50 webhook paths** are referenced by the draft app (§7); the five removed
  Linear mutation/project/create definitions remain centrally gated for stale deployed tabs and rollback. Live-instance check
  2026-07-11 found the legacy set served except `ttp-status`, which
  has **no serving webhook** — its constant is defined but never fetched, and TikTok-Pilot status is
  advanced by a schedule-only cron and re-read via `ttp-list`. The n8n families: legacy calendar /
  samples write fail-safes (dormant behind the kill switches), the `linear-*` bridge, reads + AI
  generation (`generate-*`, `caption-*`), intake (`onboarding-*`, `sales-intake-*`,
  `ai-onboarding-*`), TikTok (`tiktok-*`, `ttp-*`), and Slack pings (`send-urgent-slack`,
  `weekly-slack-top-reel`).
- **Linear.** 4 webhooks in — 2 new HMAC-signed → the `linear-inbound` EF (realtime mirror, B3), 2
  legacy → an n8n card-patch workflow (retire at B5). API out remains via the n8n `linear-*` bridge;
  the B4 `linear-outbound` path is deployed but dark (`mode=off`, both teams Linear-authoritative).
  Adoption of brand-new issues uses a 30-min incremental-refresh GitHub Action. The Part 2 baseline
  adds an allowlisted native-first legacy-parity lane for create/status/comment, protected by a
  separate kill switch. The SPA parity caller and gateway delta remain staged; global outbound and
  authority are unchanged.
- **Google Sheets** (`gviz` CSV, one workbook). Serves **all analytics numbers** (six tabs), the
  public client roster (`Clients Info`; review tokens are forbidden), the SMM directory (`Social
  Media Managers`), and a legacy filming-plans fallback tab. Review tokens live only in
  service-role-only Supabase `client_access`. Populated by an external morning scrape.
- **GitHub Actions (12 in the Part 2 draft).** 3 reconcilers (`linear-sync`, `sample-linear`, `linear-deliverables`), 2
  nightlies (calendar-E2E, samples-E2E), the production-polish gate, unit tests, the B1 30-min Linear
  incremental refresh, the staged B4 outbound drainer, the edge-function deploy, the staged daily
  TEST write drill, and the staged nightly full-roster shadow audit — plus Pages hosting itself.
  The two soak schedules and their pager readers remain owner-merge/deploy work. **Slack:** alerts + pings.

## 3. App shell & cross-cutting mechanics

Everything below is shared by every surface; per-surface sections only note deviations.

- **Two-stage entry.** (1) A pre-paint boot-gate script in `<head>` (~27–143) reads the URL params
  and `localStorage` and tags `<html>` with `boot-*` classes / `data-boot-nav` so the first paint
  already shows the right chrome; it is wrapped in try/catch and never throws. (2) The entry router
  at the end of the script (~33410–33505) chooses a mode: `?onboarding` / `/onboarding_form` →
  public onboarding form; `?onboarding_view=<slug>` → standalone viewer; `?intake=1` → Submit-only
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
  cached client-side). `client-token-verify` EF on client links; authenticated `client-review-link`
  EF only when an Admin/SMM copies a new link. Chart.js CDN asset.
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
  exists; token gate is service-side `client-token-verify` only. The current permissive runtime
  stance still permits verifier network errors until the documented enforcement flip.
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
  `calendar-reorder-batch` → n8n `calendar-reorder`** (per-row, last resort). Status/comment legs are
  selected per client by `write_ui_reroute_clients`: enrolled clients call authenticated
  `production-write` once and await its durable acknowledgement before the Calendar row save;
  non-enrolled clients retain the original `linear-set-status` / `linear-add-comment` request
  shapes. Gateway recovery reads the linked `deliverables` row only to compare current native
  status clocks and uses the authenticated receipt described in §9.2. `send-urgent-slack` (URGENT tweak ping). Caption AI: `generate-caption`,
  `caption-job-update`. `caption-prompts-save` (EF/n8n by settings flag). `thumbnail-folder-resolve`
  EF (Drive parent-folder link; skipped for client links). URGENT "sent" marker → **`calendar-upsert`
  EF directly, bypassing the kill switch**.
- **State.** `syncview_calendar_v2`/`_off` (sticky v2 read toggle), `syncview_cal_v2debug`,
  `syncview_calCache_v2:<slug>` (7-day SWR cache, authority-filtered), `syncview_calendar_prefs`,
  `syncview_cal_filters_v1`, `syncview_calendar_pins`, `syncview_calendar_settings_v1` (per-client
  collab/title-review, device-authoritative within a trust window), `syncview_cal_scroll_<slug>`,
  `syncview_cal_archived_v1_<slug>` (local archive ledger), `cal-skip-approve-confirm`,
  `cal-skip-setall-confirm-<status>`, `syncview_captionJobs_v1`, `syncview_linear_outbox_v1`,
  `syncview_calLinearMeta_v2`, `syncview_write_ui_queue_diag_v1`,
  `syncview_write_ui_legacy_quarantine_v1` (shared owner-review store),
  `syncview_write_ui_source_repairs_v1` (principal-bound, cross-tab-locked pre-network source-repair
  journal; attempted status/comment recovery requires an authenticated `production-write`
  `reconcile_only` receipt, not a local acknowledgement or blind replay; not a Linear mutation
  queue), plus secondary diagnostic/paint metadata inside existing v2/Kasper cache rows,
  `syncview_kasper_seen_v1`/`_at_v1`, `syncview_notes_seen_v1`,
  `syncview_calCardJobs_v1` (legacy drain/expire-only jobs). sessionStorage: `sv_noteDraft_<pid>`,
  the shared token-verify cache. **Kill switches:** `calendar_upsert_ef_clients` (upsert+reorder
  routing), `write_ui_reroute_clients` (status/comment + native-intake client allowlist),
  `settings_ef_clients` (caption-prompts-save + prompt overlay), `?v2=0`. Rich optimistic-
  state guards (`_calReorderOptimistic` 12 s, recent-save windows, save-in-flight queues).
- **Roles.** Client: Review tab targets Client-Approval→Approved, may approve/comment/drag (drag only
  when collab_mode on), status labels renamed. SMM: multi-select archive/caption/link, bulk set-all,
  collab/title toggles, bulk Linear link, bulk caption, thumbnail resolve. Kasper shares the write
  plumbing but mostly lives on its own surface.
- **Failure/fallback.** Cache-primed paint → 20 s dual-timeout; failure with cards on screen shows a
  small "busy/failed" chip, not a blank. **v2 REST failure transparently falls back to n8n** (a
  Supabase outage never blanks the calendar). **Single-card upsert has NO EF→n8n fallback** — it
  errors the card (rollback of structural fields, free text kept, retry chip); only *reorder* and the
  *flag read* fall back to n8n. Enrolled Linear-facing intents have no browser retry queue.
  Identified non-enrolled failures retry through their original n8n route; unmarked pre-upgrade
  Calendar/SXR status and comment debt moves to lossless owner-reviewed quarantine because its
  initiating principal cannot be verified. Legacy Submit card jobs drain only after a fresh
  authority read on startup/focus/resume/online/timer;
  a flipped-team item is discarded with a local aggregate diagnostic. Caption jobs are poller-authoritative with 45 s/3 min/12 min
  watchdogs. For new attempted status/comment recovery, the authenticated receipt is
  `committed_exact`, `absent`, or `conflict`: exact adopts the current public row/canonical comment;
  absent status stays held unless newer native status supersedes it; absent append-only comments may
  reissue through the current lane; conflict remains owner-review debt. Cache-only checkpoints never
  auto-apply. Realtime subscribe failure degrades to fetch-on-focus.
- **Notable / corrections.** `calendar-append-post` and `calendar-delete-post` are **dead** (constants
  defined, zero fetch sites; delete is an archive-upsert). `linear-tweak-comments` is **not** a
  calendar endpoint (it's Workload's). The URGENT-marker write bypasses the routing flag, so an EF
  outage breaks sent-state persistence even for n8n-routed clients.
- **Track B.** Part 2 status/comments are gateway-routed and cache/queue retirement is coded in the
  stacked draft; no caller bundle is deployed yet. Continuous `*_deliverable_id` linkage remains
  the native target. At each
  B4 team flip: four link-predicate families re-point, name-sync activates, and deliverable comments
  use the normalized `production_comments` issue thread; caption/title-only notes with no
  deliverable remain card-local. B5: link columns inert.

### 4.3 Native intake — Submit tab and Calendar Create Post

- **Submit entry.** The visible top-nav label is **Submit** (`navLinear`), while the intentionally unchanged
  internal nav key and hash are `linear` / `#linear`. `?intake=1` hard-locks the whole SPA to this
  form (workspace password bypassed, chrome hidden, `navTo` coerced to `linear`). Existing bookmarks
  stay valid, but a mutation requires the same verified Admin/SMM staff identity as the gateway.
- **Calendar entry.** Staff **Create Post** runs inside the selected client's calendar, so client
  scope is implicit and no client picker is shown. It resolves the latest active native batch and
  defaults to append, while also offering a new-batch choice. Client-link **Suggest a post** remains
  the existing collaborative calendar-only path and does not invoke native intake.
- **Reads.** Native anon-readable `clients` supplies Submit's canonical slug/display-name dropdown;
  Calendar reads the selected client's active native `batches` ordered newest-first for its default
  choice. `filming_plans` REST (+ Sheets CSV fallback + `syncview-filming-plans` realtime) resolves
  the read-only plan link. Calendar-upsert and write-UI allowlist flags remain read-only.
- **Writes (Part 2 draft).** For a client enrolled in `write_ui_reroute_clients`, Submit and Calendar
  share one awaited authenticated `production-write` `intake_create` engine. Submit and Calendar's
  new-batch choice create the native
  batch plus deliverables; Calendar's default choice sends an existing `batch_id` with batch CAS and
  appends a paired Video + Graphics item. The gateway independently validates each team's project
  and parent route before the additive append RPC commits under the batch lock. The response's
  `item_index`, native IDs, and transitional Linear links materialize Calendar cards through the
  shared upsert fetch; no Linear list is polled. `log-linear-submission` receives post-commit telemetry
  only and cannot create Linear work. A non-enrolled Submit preserves the original `video-form` /
  `graphic-form` body and card-job materialization; a non-enrolled Calendar keeps its pre-Part-2
  local blank-card path.
- **State.** `syncview_linear_form` (autosaved draft, cleared on submit), `syncview_last_link`,
  `syncview_native_intake_pending_v1` (v3 initiating-member-bound request/result/per-card checkpoint;
  creation, purge, checkpoint, and completion deletion share one mandatory browser Web Lock;
  sign-out deletes uncommitted payloads or retains a scrubbed minimal routing recovery with native
  IDs, request/card/team metadata, and transitional Linear URLs but no notes/briefs/Drive links), and legacy
  `syncview_calCardJobs_v1` for legacy materialization/recovery. Client rollout flag:
  `write_ui_reroute_clients`; backend parity kill switch: `linear_legacy_parity_enabled`.
  Calendar upsert routing remains independently reversible.
- **Roles.** Admin/SMM create. Creative, client-token, missing, and garbage credentials are refused.
  The selected client name is data, never identity. The bounded pre-flip TEST lane remains
  service-authenticated; a browser staff key or client token cannot self-enter TEST scope.
- **Failure/fallback.** Client-registry failure leaves selection closed. Native intake is awaited and
  the success banner requires `native_committed=true` (HTTP 201 or mirror-pending 202). An ambiguous
  response preserves the exact request id/timestamp/payload for safe replay. The validated native
  response is stored before telemetry or cards; each successful card is checkpointed. An inactive,
  cross-client, stale-CAS, or wrongly filed append fails closed before card materialization. A bad
  mapping writes zero cards, and reload resumes only missing `p_native_*` cards without a second intake.
  Missing/malformed/unreadable `write_ui_reroute_clients` fails dark to the legacy path.
- **Notable / corrections.** `linear-subissues` is a **read** used by Calendar/SXR, not a Linear-tab
  write. The durable card-job system exists because of a real data-loss incident (tab closed during
  the pre-write window). Due dates are computed client-side in 5-working-day batches.
- **Track B.** The Part 2 caller is wired in this stacked draft. The v11 baseline is deployed dark;
  this branch's gateway delta is not. The owner deploys/verifies that delta before the caller; no
  browser bundle or authority/outbound flag is changed until owner merge/deploy. A
  Linear-authoritative team uses only the targeted parity lane; a flipped team uses the normal
  outbox. The separately reviewed #819 mapping operation is green at 62/62 persisted team tags for
  the 31 active real-client rows. Mapping readiness does not itself deploy or enable intake.
  B5 retires the legacy create endpoints and remaining Linear reader family.

### 4.4 Linear tab — authority-gated mirror (internal key `production`, route `#production`)

- **Entry.** The visible top-nav label is **Linear** (`navProd`), while the intentionally unchanged
  internal nav key and hash are `production` / `#production`. It is mounted near the front for the
  normal signed-in staff audience. `?prod=1` remains the entry/deep-link alias (`_prodEnabled`);
  `init()` short-circuits to mount it and leaves essentials in the background. Existing bookmarks
  and deep links remain valid.
- **Reads.** Core rows use Supabase REST via the dynamic `'/rest/v1/'+table` pager (`_prodRestRows`): boot
  loads `clients`, `team_members`, `batches`, and a **lightweight** `deliverables` select (PR-#779
  shape — tombstone markers via `linear_raw->>…` JSON aliases, no `brief`/`linear_raw` body). Lazy:
  full `deliverables` row (brief + raw, on open), bulk brief hydration 6.5 s post-boot / on palette
  open. Issue-detail comments page through the protected `production-comments` Edge Function in
  50-row `{created_at,id}` cursor pages; it returns the normalized native thread, not the old
  actor/action activity summaries. Also fires the shared Sheets essentials in the background for
  app chrome. The tab also reads the single `prod_authority` runtime-flag row to gate controls.
- **Writes.** Status, comment, due date, and assignee use the authenticated `production-write` Edge
  Function. The browser supplies the native deliverable ID, a bounded idempotency key, and CAS for
  scalar changes; verified staff headers come from the shared role-key identity path. Controls are
  enabled only when the target team's authority is `syncview`, except an active `kind=test` client
  can send the gateway's bounded TEST override before a flip. The browser never requests legacy
  parity, changes flags, calls an n8n mutation, or writes Linear directly. Project moves, creates,
  deletes, and the remaining artifact affordances stay read-only.
- **State.** `syncview_prod_display_v1` (groupBy/orderBy/showSubIssues), shared `syncview_nav` /
  `syncview_auth_v1`. Deep-link params: `group`, `order`, `subs`, `team`, `view`, `issues`,
  `pdetails`, `client`, `d`, `batch` (`ptab` is dead). In-memory `_prodState` (rows + adapter, events
  Map, linearRaw Map) plus a memory-only paged comment cache. Reopening an issue and the normal
  Production refresh both revalidate the newest comment page; stable-ID merge keeps already-loaded
  older pages and request tokens drop stale pagination races. Comment drafts, per-operation pending
  state, and retry idempotency keys are memory-only; comment bodies never enter localStorage.
  Authority is fail-closed and re-read on normal refresh/focus plus a 30-second foreground timer.
- **Roles.** Every verified staff role can use the mounted nav item. Comment reads additionally
  re-check the role key plus one active role-compatible roster identity server-side; direct
  `?prod=1` diagnostics without that identity show a comment sign-in state. The
  unchanged route guard accepts a valid staff identity or direct `?prod=1` diagnostics. Admin/SMM
  may use all four operations; Creative is limited to own-team status/comment and the server repeats
  that authorization. Direct diagnostics without a verified identity remain read-only. "My issues"
  is a hardcoded heuristic (member matching a specific name, else first active assignee), not a real
  identity.
- **Failure/fallback.** REST per-page fetch: 3 attempts, retry only network/429/5xx. Boot-load failure →
  full-tab error screen + Retry; silent refresh failure → `console.warn`, stale kept. Pagination-cap
  overflow is a hard error (never silent truncation). Comment failures are isolated to explicit
  sign-in/error/retry states; older-page failure keeps already loaded rows. Freshness = silent
  refresh on visibility/focus/pageshow, throttled 30 s. A stale-tab server authority rejection
  refreshes the stance immediately; a CAS conflict applies the returned current row and asks the
  user to retry. UI state changes only after `native_committed=true`.
- **Notable.** `?c=…&prod=1` reaches this read-only mirror without the password (see §3). This is the
  **only** user of the dynamic REST call site; its five tables are absent from the literal-table
  inventory by design. The underlying comment store and body-bearing ledger snapshots are
  service-only; this deliberately avoids extending the existing anon-readable mirror policy to
  internal comment text. Deleted/archived issues are filtered client-side from tombstone JSON, not
  server-side.
- **Track B.** The mirror has the Part 2 status/comment/due/assignee caller, but both production
  teams remain read-only while their authority is `linear`; no deploy or flag flip is implied. D-28
  can enable Graphics first, then Video, by owner-controlled flag changes with no code change. B5:
  the only production surface.

### 4.5 Samples New (SXR) — `sample_reviews`

- **Entry.** Team tab `#sample-reviews[/<slug>/<id>]`; client portal `?sxr=1&c=…&v=sample-reviews&t=…`;
  Kasper "samples" subtab. Module **default ON** since GA 2026-07-02 (`syncview_sxr_on`; `?sxr=0`
  sticky opt-out) — the in-code "default-OFF" comment is stale.
- **Reads.** Per-client `sample_reviews` REST (Archived excluded server-side) with n8n
  `sample-review-get` fallback; realtime `sxr-<slug>`. Kasper queue: **unscoped cross-client**
  `sample_reviews` REST (no client filter, **no webhook fallback**) + unfiltered `kasper-sxr`
  realtime. n8n `linear-subissues` on fresh link-adopt. Runtime-flag read (sample-review key).
  Shared: SMM-directory CSV, client-token-verify EF, and staff-only copy-time client-review-link EF.
- **Writes.** `sample-review-upsert` (EF iff flagged, else n8n — **no EF→n8n fallback**),
  `sample-review-reorder` (EF **with** n8n fallback on failure). Status/comments use the same
  `write_ui_reroute_clients` selection as Calendar: enrolled clients use authenticated
  `production-write`; non-enrolled clients keep the original n8n request shapes. `send-urgent-slack`,
  `thumbnail-folder-resolve` remain shared. URGENT marker
  → `sample-review-upsert` EF directly (bypasses the flag).
- **State.** `syncview_sxr_on`/`_off`, `syncview_sxr_prefs_v1`, `syncview_sxr_cache_v2_<slug>`,
  `syncview_sxr_archived_v1_<slug>` (60 s-grace ledger), `syncview_sxr_kasper_seen_v1`,
  `syncview_sxr_linear_outbox_v1` (identified legacy retries plus pre-upgrade quarantine),
  `sxr-skip-setall-confirm-<status>`; shares
  `syncview_calendar_pins` + `syncview_notes_seen_v1`, `syncview_write_ui_queue_diag_v1`, and
  `syncview_write_ui_legacy_quarantine_v1` (owner-reviewed disposition required). Source-repair
  metadata is read-back verified in `syncview_write_ui_source_repairs_v1` before gateway I/O, with
  secondary v2/shared-Kasper cache checkpoints; it is bound to the initiating principal and
  survives the Kasper display TTL. After an attempted status/comment loses its server response, the
  same authenticated principal obtains the gateway's read-only `committed_exact|absent|conflict`
  receipt before any resend or source apply. Exact adopts the current public row/canonical comment;
  absent status stays held unless newer native status supersedes it, while an absent append-only
  comment may reissue through the current lane; conflict stays quarantined. Cache-only checkpoints
  never auto-apply. sessionStorage:
  `sv_sxrNoteDraft_<pid>`. Kill
  switch: `sample_review_ef_clients`.
- **Roles.** SMM: full edit, SMM-review flow, share-link kebab, media-less cards excluded. Kasper:
  works only the cross-client queue (never the `#sample-reviews` route); internal-only comments; each
  card persists with its own slug. Client: read-only, embedded Review+Sheet shell, sees only client-
  ready components, Kasper authorship stripped.
- **Failure/fallback.** Per-client read: REST → n8n → cached cards + "couldn't refresh" notice.
  Kasper read: no fallback → keeps items, "try again" only when empty. Upsert: per-card retry chip,
  no n8n fallback. Reorder: EF→n8n. Archive: optimistic + ledger, restore on failure. New native
  intents are awaited before sample persistence and fail loudly instead of creating browser queue rows; legacy rows share the guarded lifecycle
  and diagnostics. Token verify fail-open on network error.
- **Notable / corrections.** v1's "courier" and "filming-tabs stub" attributions are wrong — no
  `courier` symbol exists; filming-tabs belongs to Kasper. `comments_base_at` is hardwired `''`
  (server merge effectively off; merge is client-side). The unscoped Kasper read answers v1's open
  question about who reads `sample_reviews` globally.
- **Track B.** Same §9.2 re-point story as Calendar (including the samples twins gates). Part 2 adds
  `peekSxrLinearOutbox` plus aggregate active/quarantine/native-intake diagnostics. A
  scheduled/posted clamp remains a tolerated divergence.

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
  Client links resolve public roster metadata from the analytics Sheet, but their review token is
  verified and issued only through service-role Edge Functions. `setSmMode` preview toggle is dead code.
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
  REST + n8n `filming-plan-tabs` (filming). `onboarding-full` EF (full sensitive inbox, admin-role-key gated). `client-
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
  min), seen ledgers, both Linear outboxes, `syncview_staff_identity_v1` (verified roster member +
  role key, shared by staff EFs), `syncview_sales_intake_draft_v1`. Kill switches: the calendar
  & sample flags + `?v2=0`.
- **Roles.** Hidden staff role, **no password for the queue itself** — only the URL param / session
  flag. Kasper comments are role `kasper` + audience `internal`, stripped from client views.
  Sensitive subtabs add a **real** role gate: admin can open onboarding + credentials; SMM can open
  credentials; creative/editor/designer can open neither. The role is derived from the matching
  secret, never a caller-supplied role header.
- **Failure/fallback.** Queue 3-tier as above; cached ≤24 h snapshot keeps painting. Stored staff
  identity changes are synchronized across tabs; sign-out purges the sensitive caches everywhere.
  Persist failures
  revert + per-card error; finish/close failures swallow (local flag hides the card, next write
  reconciles). Linear outbox retry. 401 on key-gated subtabs → clear the shared identity, purge
  sensitive UI/cache state, then show the one staff sign-in form. A recognized but unauthorized
  role gets 403 and keeps its valid staff session. Realtime failure →
  visibility/focus refresh only (no poll despite a stale 30 s comment).
- **Notable / corrections.** "SMM reports" is **not** a Kasper subtab (it's a separate top-level
  route, §4.14). `kasper-queue` is the **middle** fallback, not primary. The role-header quirk
  (§3) misattributes writes made from `#kasper/<subtab>` as `smm`. The Kasper unlock has no
  password; the verified role key is the sensitive-subtab credential.
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
- **State.** The per-surface caches/flags of whichever portal loads. `X-Syncview-Client-Token` is
  reconstructed from the URL for EF writes and is not copied into browser storage or public data.
- **Roles.** `role='client'` wins over `#kasper`/`?Kasper=1`. **Can:** approve, request changes with
  a note, comment, and (collab_mode ON) edit/drag/suggest. **Cannot:** set statuses directly,
  archive, multi-select, tag colours/platforms, link Linear, generate captions, bulk ops, URGENT
  ping, credentials, brief regeneration, copy/share kebabs. Sees only client-ready cards; Kasper
  authorship always hidden; status labels renamed.
- **Failure/fallback.** Token mismatch → static "isn't valid" screen. `client-token-verify` blocks
  only on 401/410/`mode:enforced` and **fails open on network error** while the runtime stance remains
  permissive. Verdicts are not cached with the raw token. Read/write fallbacks inherit each portal's behavior.
- **Notable / corrections.** v1's `client-links-refresh` **does not exist** — the nearest code is a
  purely client-side "open profiles" dropdown (zero backend). An **unknown `?c=` slug** falls past the
  token gate to the staff home dashboard without a password. Old-samples client writes carry **no
  role/token headers** (indistinguishable from SMM at the webhook).
- **Track B.** Tokens are minted/rotated and the verifier is live in permissive mode. The secure
  copy-time issuer is staged in the fix-pack. Remaining: deploy it, re-issue links per client, then
  flip fail-open → fail-closed. Untouched by `prod_authority` flips.

### 4.10 Filming Plans

- **Entry.** Team tab `#filming-plans`; Kasper "filming" subtab (read-only). Shared consumers:
  Templates profile card, Linear form's read-only plan field.
- **Reads.** `filming_plans` REST (all rows) with **Google Sheets CSV fallback** on failure; realtime
  `syncview-filming-plans` (subscribed only after a successful REST load — sheet-fallback sessions get
  no live updates). n8n `filming-plan-tabs` (Kasper only, optional coverage probe of Google-Doc tab
  names, per doc, concurrency 5). Kasper runway reuses Calendar reads.
- **Writes.** **`filming-plans` EF is WRITE-ONLY** (single POST upsert; never read from). The app
  reuses the signed-in Admin role identity and sends its key/roster actor/server-verified role. The
  old `ONBOARDING_STAFF_KEY` remains backend-only transition compatibility.
- **State.** `syncview_staff_identity_v1`, `syncview_kasper_filming_v1` (30-min, cleared on
  any plan save), in-memory `filmingPlansData` + `_linearPlanMap`. **No kill switch** —
  `FILMING_PLAN_TABS_URL` is a build-time switch only.
- **Roles.** Team page behind the password; Kasper subtab read-only behind the unlock; writes require
  the admin role key. SMM and creative/editor/designer role keys are denied.
- **Failure/fallback.** REST → Sheets CSV → both fail throws (page error card; Templates swallows;
  Linear field degrades to "No filming plan"; Kasper error card). EF save 401 → clear the shared
  identity and offer the staff sign-in form once; other
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
  `syncview_sales_intake_draft_v1`, shared `syncview_staff_identity_v1` (verified roster member +
  role key). No kill switches.
- **Roles.** Both forms fully **public** (no password, no token check — the `?onboarding` value is
  never validated). Viewer public but credential-stripped. The full Kasper inbox needs the unlock
  **and** an Admin staff identity. Sales intake needs only the Kasper unlock; its webhook itself carries no auth.
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
- **State.** shared `syncview_staff_identity_v1` (verified roster member + secret-derived role key),
  in-memory `_ccState` (plaintext passwords live in JS memory), reveal/expand Sets, a 4.5 s
  self-echo window. **No `syncview_runtime_flags` switch**; CC realtime is gated only by the shared
  `_calV2Ready()` (so `?v2=0` silently disables live refresh here too).
- **Roles.** Three UI tiers remain: **Kasper** (full store, reassign, bulk import, history), **SMM**
  (per-client modal), **client links** fully excluded. Server authorization allows admin + SMM role
  keys and denies creative/editor/designer; the matched secret, not `X-Syncview-Role`, owns the gate.
- **Failure/fallback.** Any API 401 → clear the shared identity, close/purge sensitive credential
  state, show the staff sign-in form, and retry once. List fail → inline error +
  manual Refresh. A 403 explains the required role without signing the user out. Mutations → toast
  + button re-enable, no queue. `log_reveal` failure ignored.
  Realtime failure → console.warn, no resubscribe (silent live-off).
- **Notable.** v1's `credentials-identity-persist` is **not an endpoint** — it's a source-guard test
  file. `thumbnail-revision-scan` EF is never called from `index.html` (thumbnail revision history is
  backend-only: baselines captured inside the upsert EFs, scan scheduled; `thumbnail_media_revisions`
  has no UI reader yet — **no new SPA row needed**). Passwords arrive in plaintext with `list` and sit
  in JS memory; masking is visual only; only reveals are audited (copies are not).
- **Track B.** `client-credentials`, `onboarding-full`, and filming-plan writes now consume the same
  role-key identity as §6. Both old surface keys remain server-side compatibility until the separate
  owner-approved retirement gate.

## 5. What changes, when (Track B) + auth

Current phase: **B4 outbound staging (dark), with the Part 2 v11 baseline deployed and caller/gateway delta in draft** — B3 evaluation
mirror remains live and Linear stays authoritative for both teams.
`prod_authority = {video: linear, graphics: linear}`, `linear_inbound_enabled = {enabled: true}`
(flip 15, 2026-07-07), `auth_enforcement = permissive`; the three Track-A `*_ef_clients` flags carry
the full active roster (Track A closed 2026-07-10). Mirror at full parity (~4.3k deliverables /
~1.0k batches; diff / repair / linkage all 0, 2026-07-11).

- **B4 (in progress; owner gates remain).** The additive outbox, write wrappers, outbound drainer,
  strict echo suppression, TEST-only harness, two-way reconciler lane, and pager coverage are staged
  behind `linear_outbound_enabled=off`; real authority remains Linear. D-25's full-roster exercise
  proved the pipe; D-28 now requires a green soak and Graphics-first human cutover before Video.
  D-26 makes
  `prod_authority[team]=linear` the normal per-team pause while inbound keeps SyncView current.
  The Linear-mirror caller is code-built but stays read-only under current authority; card
  predicates, Workload, and intake remain on their current paths until their separate
  owner-approved handoff.
- **Part 2 gateway backend (v11 deployed dark; delta + caller in this draft):** `production-write` is the single
  browser write boundary. It authenticates staff role keys or client tokens with secret-decides semantics,
  resolves a stable roster/client actor, enforces per-team authority + CAS/idempotency, and writes
  through service-only ledger RPCs. Normal Production writes require team authority=`syncview`;
  the active TEST client has a bounded override. Rerouted Calendar/SXR status+comment and Submit
  create use native-first outbox intents; while a team remains Linear-authoritative, only an
  allowlisted `legacy_parity` create/status/comment intent may target-drain under its independent
  kill switch. This does not enable broad outbound and never double-writes. D-28 soaks the TEST
  drill + full-roster shadow audit before an owner-controlled Graphics-first flip; D-29 pauses only
  the affected team for data-integrity defects. The disposable two-team TEST drill completed 18
  operations, observed zero unexpected echoes, reconciled `0/0/0`, cleaned up, and proved the
  pre-existing runtime flags unchanged.
- **B5 (after clean batch cycles per team).** Linear frozen → archived; the `linear-*` n8n family and
  legacy card-write webhooks retired; Workload reconciler + `workload_issues` retired; SyncView is
  the whole production system.

**Auth (design locked, D6 — do not redesign).** Three role keys (admin / smm / creative) via
`X-Syncview-Key` + a roster-picked `X-Syncview-Actor`; client links stay no-login with minted,
server-verified tokens. Built: the B0 tables, `client-token-verify` + `key-verify`, the roster-backed
staff sign-in, verified EF header plumbing, and the flag-flip trigger. A valid identity opens an
account popover (name + role + Sign out); signed-out staff see the only name/key entry form.
Credentials allow admin + SMM; full onboarding and filming-plan writes allow admin only. The old
surface keys remain additive server fallbacks while `auth_enforcement=permissive`; their retirement
is a later owner-approved gate after TEST/dummy proof and a clean working window. The Part 2
gateway is stricter regardless of the legacy permissive flag: missing/garbage credentials
are rejected, claimed headers cannot elevate, and the low-level Track-B HTTP wrappers are
service-only. Remaining live B4 auth work is the 72 h zero-unkeyed-writes telemetry and the owner
enforcement flip. **Auth precedes any real write phase.**

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

- **n8n webhooks (54):** `add-hook-to-library` · `ai-onboarding-submit` · `calendar-append-post` · `calendar-delete-post` · `calendar-get` · `calendar-reorder` · `calendar-reorder-batch` · `calendar-upsert-post` · `caption-job-status` · `caption-job-update` · `caption-prompts-get` · `caption-prompts-save` · `content-ready` · `editors-week` · `filming-plan-tabs` · `generate-brief` · `generate-caption` · `generate-content-summary` · `generate-general-brief` · `generate-market-brief` · `generate-tab-summary` · `graphic-form` · `kasper-queue` · `linear-add-comment` · `linear-issue-statuses` · `linear-issues` · `linear-set-status` · `linear-subissues` · `linear-tweak-comments` · `log-linear-submission` · `onboarding-fallback` · `onboarding-submit` · `sales-intake-submit` · `sample-review-get` · `sample-review-reorder` · `sample-review-upsert` · `samples-get` · `samples-reorder` · `samples-upsert` · `send-urgent-slack` · `templates-get` · `templates-save` · `tiktok-upload` · `tiktok-upload-cancel` · `tiktok-upload-status` · `tiktok-uploads-list` · `ttp-accounts-list` · `ttp-auth-init` · `ttp-creator-info` · `ttp-list` · `ttp-status` · `ttp-submit` · `video-form` · `weekly-slack-top-reel`
- **Edge functions (20):** `ai-onboarding-list` · `calendar-reorder` · `calendar-upsert` · `caption-prompts-save` · `client-credentials` · `client-review-link` · `client-token-verify` · `filming-plans` · `key-verify` · `legacy-onboarding-list` · `onboarding-capture` · `onboarding-full` · `onboarding-list` · `production-comments` · `production-write` · `sample-review-reorder` · `sample-review-upsert` · `smm-weekly-reports` · `templates-save` · `thumbnail-folder-resolve`
- **Not counted above:** 16 of the 20 are referenced literally as `functions/v1/<name>`; 4 are composed onto the onboarding edge base constant. Five more are represented in `supabase/functions/` but are never called by the current app: `linear-inbound`, `linear-outbound`, `deliverable-write`, `batch-write`, and `thumbnail-revision-scan`. (`key-verify` moved into the called set as of PR #788.)
- **Supabase REST tables, literal (10):** `calendar_posts` · `caption_prompts` · `clients` · `content_samples` · `deliverables` · `filming_plans` · `syncview_runtime_flags` · `team_members` · `templates` · `workload_issues`
- **Supabase REST tables, dynamic:** the visible Linear mirror (internal `production` surface) pages any of its tables through `'/rest/v1/' + table` (variable `table` in `_prodRestRows`; reaches `batches`, `deliverables`, `deliverable_events`, `team_members`, `clients`, and the one-row `syncview_runtime_flags` authority read), and SXR reads `'/rest/v1/' + SXR_TABLE` where `SXR_TABLE` = `sample_reviews`.
- **Runtime kill-switch flags (5):** `calendar_upsert_ef_clients` · `prod_authority` · `sample_review_ef_clients` · `settings_ef_clients` · `write_ui_reroute_clients`
- **Flag semantics:** the three `*_ef_clients` values are per-client-slug allowlists; a listed client's writes go to Edge Functions, an unlisted client fail-safes to n8n. All three carry the full active roster since 2026-07-07 (Track A closed 2026-07-10). `write_ui_reroute_clients` independently selects the native `production-write` status/comment/intake lane and is seeded only with TEST; missing/malformed/unreadable values fail dark to the exact legacy n8n lane. `prod_authority` is the strict per-team Linear/SyncView write-authority map used by the Linear mirror; missing/malformed/unknown values keep controls read-only. Other plan-side flags remain backend-only.

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
