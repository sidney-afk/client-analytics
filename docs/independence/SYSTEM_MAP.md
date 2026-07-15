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

- **The app is one file.** `index.html` (~45.8k lines at this checkpoint) is the entire SPA; GitHub Pages serves it
  from `main`, so a merge ships to production immediately. There is no build step and no router
  library — "surfaces" are regions of one inline script, reached by URL param / hash / nav button
  and gated by client-side checks.
- **Endpoint kinds.** Four backends serve the app and this map always names which one: **n8n**
  webhook (`…app.n8n.cloud/webhook/<path>`), **edge-fn** (Supabase Edge Function,
  `…/functions/v1/<name>`), **rest** (Supabase PostgREST, `…/rest/v1/<table>`), **realtime**
  (Supabase Postgres-changes channel). Plus **external** (Google Sheets `gviz` CSV, Slack, Drive)
  and **asset** (CDN libs, images).
- **The Track-A routing flags.** Three `syncview_runtime_flags` rows (`calendar_upsert_ef_clients`,
  `sample_review_ef_clients`, `settings_ef_clients`) are per-client-slug allowlists: a listed slug's
  writes go to an Edge Function; an unlisted slug currently routes to a legacy unauthenticated n8n
  webhook. Flag-read and some EF failures can select the same path. That is an auth fail-open (F67),
  not a safe kill switch; removal/empty-list rollback is blocked until equivalent auth/scope exists.
  They are read at load and live-updated over realtime. Full active roster on all three since 2026-07-07.
- **Auth is mixed, not one gate.** The outer app-shell password is client-side/cosmetic and public
  REST/endpoint locations remain visible in source. Protected client-token, staff-key, role, and
  Production gateway checks now enforce several server operations, while `auth_enforcement` is
  still permissive. Candidate source hardens all six Track-A service-role writers; four are deployed
  with live deny/TEST-allow proof, while `calendar-upsert` and `sample-review-upsert` retain their
  previous public deployments until their reconciler callers merge (F35). Legacy n8n doors also
  remain during transition (F67). Each surface below must name its actual server gate—shell
  visibility is never authorization.

## 2. Backends

- **Supabase** (one project). REST tables the app reads directly: `calendar_posts`,
  `content_samples`, `sample_reviews`, `templates`, `caption_prompts`, `workload_issues`,
  `syncview_runtime_flags`; the visible **Linear** mirror (internal
  `production` surface) additionally pages `batches`,
  `deliverables`, `deliverable_events`, `team_members`, `clients`. Ledger/mirror tables
  (`*_events`, `mirror_outbox`, `linear_archive`, `client_credentials_rev`,
  `thumbnail_media_revisions`) are written by Edge Functions / reconcilers, not read directly by the
  SPA. PTO's private `pto_members`, `pto_requests`, and `pto_adjustments` tables likewise have no
  browser REST path; the source contract revokes anon/authenticated access and exposes them only
  through the staff-authenticated `pto` function. This is not a claim that the manual PTO migration
  has been applied. Thumbnail v2's protected least-field Edge projection and raw-read revocation are live:
  browser table access returns `401`, unsigned private-object access returns `400`, exact authorized
  card reads pass, and cross-client scope returns `403`. F83 closed 2026-07-14. **Systemic F88:** an exhaustive live count-only
  census found 20 nonempty anon-selectable operational tables. Client-token/UI verification does
  not constrain direct PostgREST; the owner must explicitly accept the exposed fields as public or
  migrate to scoped projections and revoke raw policies. Raw anon reads are now revoked for
  `thumbnail_media_revisions`, `social_media_managers`, and `smm_weekly_reports`. The staff EF
  now serves `filming_plans` and the raw table anon-SELECT is revoked (2026-07-15, post-#836): direct
  REST returns 401/42501. F86 separately blocks raw inactive staff/client rows and internal email/
  Slack/Linear/project mappings.
- **Edge Functions.** 27 are represented under `supabase/functions/`; **the app calls 22**
  (**"18 literal + 4 composed" Edge Functions**, see
  §7). Five are backend-only: the Linear webhook target (`linear-inbound`), B4 outbox drainer
  (`linear-outbound`), service-only write wrappers (`deliverable-write`, `batch-write`), and the
  scheduled thumbnail Drive scanner (`thumbnail-revision-scan`). `production-write` is app-called
  by merged #812. Real teams remain read-only under Linear authority; the bounded active-TEST lane
  can write.
- **n8n** (single host). **55 webhook paths** referenced by the app (§7). Live-instance check
  2026-07-11: **54 of 55 are served by ACTIVE workflows**; the lone exception is `ttp-status`, which
  has **no serving webhook** — its constant is defined but never fetched, and TikTok-Pilot status is
  advanced by a schedule-only cron and re-read via `ttp-list`. The n8n families: legacy calendar /
  samples unauthenticated compatibility writers (selected by F67 fail-open routing, not safe
  rollback), the `linear-*` bridge, reads + AI
  generation (`generate-*`, `caption-*`), intake (`onboarding-*`, `sales-intake-*`,
  `ai-onboarding-*`), TikTok (`tiktok-*`, `ttp-*`), and Slack pings (`send-urgent-slack`,
  `weekly-slack-top-reel`).
- **Linear.** 4 webhook configurations in — 2 new HMAC-signed → the active `linear-inbound` EF
  (realtime mirror, B3), 2 legacy → inactive/unpublished n8n workflow `MJbMZ789B5ExZz9x`.
  Those enabled legacy source configurations do **not** currently provide a card-patch/Workload
  fast path; scheduled reconcilers/sweeps heal instead, pending the F46 topology decision. API out
  remains via the authority-gated n8n `linear-*` bridge;
  the B4 `linear-outbound` path is deployed but dark (`mode=off`, both teams Linear-authoritative).
  Adoption of brand-new issues uses a 30-min incremental-refresh GitHub Action. The Part 2 backend
  adds an allowlisted native-first legacy-parity lane for create/status/comment, protected by a
  separate kill switch; it is deployed but has no production SPA parity caller and does not change
  global outbound.
- **Google Sheets** (`gviz` CSV, one workbook). Serves **all analytics numbers** (six tabs), the
  client roster (`Clients Info`), and the SMM directory. Candidate source removes the legacy
  filming-plans browser fallback; current Pages retains it until this change merges. The review
  token column **does not exist and must not be added**; current browser code still attempts that
  broken public-sheet dependency, while real tokens stay only in protected `client_access` (F03/F33).
- **GitHub Actions (16 workflow files).** Three reconcilers (`linear-sync`, `sample-linear`,
  `linear-deliverables`), two E2E nightlies, unit tests, production-polish, B1 incremental refresh,
  B4 outbound drain, three scoped Edge-Function deploy workflows (onboarding/credentials,
  thumbnail, PTO), the thumbnail revision scanner, Production write drill, Production shadow
  audit, and the n8n execution-quota watchdog—plus Pages hosting itself. **Slack:** alerts + pings.

## 3. App shell & cross-cutting mechanics

Everything below is shared by every surface; per-surface sections only note deviations.

- **Two-stage entry.** (1) A pre-paint boot-gate script in `<head>` reads the URL params
  and `localStorage` and tags `<html>` with `boot-*` classes / `data-boot-nav` so the first paint
  already shows the right chrome; it is wrapped in try/catch and never throws. (2) The entry router
  at the end of the script chooses a mode: `?onboarding` / `/onboarding_form` →
  public onboarding form; `?onboarding_view=<slug>` → standalone viewer; `?intake=1` → Submit-only
  lock; `?c=<client>` → client link; `#smm-weekly-report(s)` hash → SMM weekly form/viewer; else the
  **password overlay unless `syncview_auth_v1==='ok'`**. `init()` then routes to the
  tab, with fast-tab and client-link fast paths that mount before analytics data resolves.
- **Password side doors / F102.** The gate admits `_isSmmWeeklyEntry || _isIntake || _isClientLink
  || auth==='ok'` and then runs `init()`. So **`?c=…`, `?intake=1`, `?onboarding`, `?onboarding_view`
  and `#smm-weekly-*` all run without the staff password** (each hides staff chrome and locks nav to
  its own view). Because the `?prod=1` branch inside `init()` fires *before* the client-link
  branch (32948), a `?c=…&prod=1` URL reaches the currently read-only client Production preview without the password;
  an unknown `?c=` slug with no matching client falls through routing to `navTo('home')` and paints
  the staff dashboard without invoking the token verifier. F102 requires resolve+verify before any
  bypass/data load and forbids every client URL from falling into a staff route; token enforcement
  alone does not fix this.
- **Identity/roles are mixed and stored.** Verified staff state (key, roster member, secret-derived
  role) persists in `localStorage.syncview_staff_identity_v1`, is revalidated at boot, and supplies
  staff EF headers. Protected EFs must re-resolve the matched secret/member; F31/F35 name paths that
  still permit caller-selected attribution. Client scope still derives from `?c=` + `?t=`. Legacy
  Kasper routing also has an asymmetry: subtab unlock can come from `sessionStorage`, while older
  route-derived role logic recognizes only exact `#kasper`/`?Kasper=1`, so a legacy write from a
  nested hash can still be stamped `smm`. Never treat a browser header or persisted label alone as
  server authorization.
- **Runtime-flag machinery.** Three Track-A REST reads of `syncview_runtime_flags` (calendar-upsert,
  settings, sample-review keys) are primed unconditionally at script eval — *every* visitor,
  including client links, hits the flags table three times and opens three realtime channels
  (`syncview-runtime-flags`, `syncview-settings-runtime-flags`, `syncview-sample-runtime-flags`)
  lazily after supabase-js loads. Any flag read failure empties the set → all writes route to
  unauthenticated n8n writers. That is an authorization downgrade/fail-open (F67), not fail-safe.
  PTO separately reads `pto_v1` for a fail-closed staff-surface gate and opens one flag-only
  realtime channel (`syncview-pto-runtime-flag`) so an off flip retires already-open entry points.
  It opens no PTO data-table channel: missing, malformed, off, or unreadable state hides/bounces the
  feature, and the Edge Function independently rejects normal actions while off. PTO has no legacy
  or n8n fallback.
- **Thumbnail-v2 backend gate.** Edge/database paths read
  `thumbnail_revision_v2={"mode":"off|test|on","clients":[...]}` server-side. `off` disables the
  protected comparison reader/scanner and v2 token minting; `test` admits only listed client slugs;
  `on` admits all. This is not a fourth browser `*_FLAG_KEY` read and is therefore not counted in
  §7's machine-derived runtime-key list. Scheduled calls have a second operational gate,
  repository variable `THUMBNAIL_REVISION_SCAN_ENABLED`.
- **Realtime channels (13).** `cal-<slug>`, `sm-<slug>`, `sxr-<slug>` (per-client post/sample
  streams); `kasper-cal`, `kasper-sxr` (unfiltered cross-client Kasper queues);
  `client-credentials-rev-<slug>` / `-kasper`; `syncview-templates`,
  `workload_issues` (declared, dormant); the three Track-A runtime-flag channels; and the PTO
  flag-only channel. supabase-js is a lazy CDN UMD load, memoized once; failure resolves null and
  each caller follows its own fail-open/fail-closed path.
- **Theme / palette.** `syncview_theme='dark'` opt-in (light default; forced light + toggle hidden
  on client links) and `syncview_status_palette='classic'`, both read pre-paint. One-click rollback.
- **App-update nudge (advisory only; F127).** Polls `HEAD` of `location.pathname` every 5 min + on
  focus, comparing ETag/Last-Modified; never force-reloads and lets dismissal adopt the new token
  while old code continues. It is **disabled under `?prod=1`** (which also skips resume of pending
  calendar-card jobs), clean onboarding aliases probe a public 404 path, and the first network token
  becomes the baseline even when a cached older document is running. No embedded build/authority
  epoch, server minimum-version rejection, or build-population telemetry currently expires callers.
- **Config note.** The onboarding/list Edge Functions are composed onto a hardcoded edge-base
  constant declared *before* the main Supabase URL constant (TDZ avoidance) — that is why §7 counts
  "17 literal + 4 composed" Edge Functions.

## 4. Surface catalog

Sixteen surfaces. Thirteen carry over from v1 (verify items resolved); **SMM Weekly Reports**,
**Client Credentials**, and dark-by-default **Time Off** are promoted to their own rows. Code references use
stable symbols/routes; any dated line number is evidence history, never a current-file guarantee.

### 4.1 Analytics (home) — the default tab

*The v1 "Analytics data sources — not yet traced" item. Answer: 100% Google Sheets; no Supabase, no
n8n in the metric read path.*

- **Entry.** Default tab (`navTo('home')`); client profile via `#<ClientName>` hash, search, pins,
  or table rows; also the landing view for a bare `?c=` client link.
- **Reads.** Six `gviz` CSV tabs from one workbook: `Metrics` + `Clients Info` (essentials) and
  `TopVideos`, `Competitor Briefs`, `Market Research Briefs`, `ContentSummaries` (extras). AI tab/
  synthesis summaries via n8n `generate-tab-summary` and `generate-general-brief` (compute-on-read,
  cached client-side). `client-token-verify` EF only on client links. Chart.js CDN asset.
  Scheduled CLIENTS METRICS/TOP VIDEOS jobs populate the first/third tabs, but their current graphs
  have no per-client/platform completeness receipt and can serialize source failure as zero, stale,
  or partial truth (F124).
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
  exists. The public roster has no token column; real tokens are protected. The verifier path is
  still permissive/cached under failure and revocation as scoped in F38, so sheet absence is not an
  authorization mechanism.
- **Failure/fallback.** Awaited home path with no cache → full error card. After a cache paint,
  fetch failure is `console.warn` only (stale data stays). `ContentSummaries` fetch is
  `.catch(()=>null)`. Brief POST errors keep polling (pending state persisted *before* the POST);
  polling times out at 40 min (MR) / 15 min (competitor) → timeout card. `generate-tab-summary`
  errors render **nothing** (silent). Chart.js CDN miss retries 40× then charts silently absent.
  Independently, F124 means a successfully fetched newest Sheet row can itself be false-zero/
  degraded; the SPA has no source-coverage/freshness field to distinguish that from real no-content.
  Current aggregate execution topology makes the gap concrete: one retained Metrics run stopped on
  its first append and skipped 25 later roster clients after the PostTracking path ran, while each of
  four green Top Videos runs collapsed 4–7 of 15 configured YouTube lanes into the same no-source
  branch used for missing/empty input and still wrote 29 client results. No row value was inspected.
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
  **F125:** both the v1 selector and automatic REST-failure fallback change only reads; full-roster
  writes/reorders still route to Supabase-only Edge Functions. Either is unsafe split-brain, not
  writable recovery.
  Caption prompts (n8n `caption-prompts-get` base + flag-gated `caption_prompts` REST overlay — see
  §4.11). Caption job state via n8n `caption-job-status` (5 s poll while jobs active). Runtime-flag
  reads (calendar-upsert + settings keys). Rendered cards group at most 50 IDs into one or more
  authenticated `thumbnail-revision-read` availability calls; the response contains only IDs with
  a real pair and no signed URLs or history metadata. Clicking a visible Compare icon calls the
  same protected EF for one exact card and receives only its signed Previous/Current pair. The
  browser never reads the history table directly. supabase-js + `xlsx` CDN assets.
- **Writes.** Every card save (fields, comments, statuses, approvals, archive-as-`status:Archived`,
  imports) → **`calendar-upsert` EF iff the slug is flagged, else n8n `calendar-upsert-post`**
  (comments piggyback as JSON in `*_tweaks` columns; v2 sends `comments_base_at:''` to skip the
  server scalar-merge guard). Reorder cascades **EF `calendar-reorder` → n8n
  `calendar-reorder-batch` → n8n `calendar-reorder`** (per-row, last resort). Linear legs (n8n):
  `linear-set-status`, `linear-add-comment` (per-issue serialized + coalesced, durable outbox on
  failure). `send-urgent-slack` (URGENT tweak ping). Caption AI: `generate-caption`,
  `caption-job-update`. `caption-prompts-save` (EF/n8n by settings flag). `thumbnail-folder-resolve`
  EF (Drive parent-folder link; skipped for client links) is currently anonymous (F79), and its
  remote-read/final-update sequence lacks atomic URL/version CAS (F80). URGENT "sent" marker → **`calendar-upsert`
  EF directly, bypassing the kill switch**.
- **Thumbnail refresh/comparison.** Single Drive files render from the final
  `lh3.googleusercontent.com/d/<id>` host with persisted `thumb_rev` in the browser's actual cache
  key. Enrolled server writers mint on media assignment (same-value included) and graphic Tweaks
  exit. Active-card watchers also detect same-file replacements that cause no SyncView write; each
  confirmed scan atomically closes Previous/Current, bumps the exact source row, and carries Current
  forward as the next baseline. Existing realtime then advances every open editor/review image
  without a hard refresh. Baseline/latest objects remain private. The comparison reader verifies
  staff+actor or exact client token plus source-card scope before returning an ID-only availability
  projection (maximum 50 requested IDs), and signs five-minute URLs only for an exact-card click.
  The v2 flag is backend-only and is documented in §3, not the browser runtime-key inventory.
- **Notification correction (F47).** The legacy urgent workflow can post a generic channel message
  and return success with no exact assignee mention; the browser then persists “Sent.” No caller may
  treat a channel post as delivery without an immutable member + provider receipt. Missing mapping
  must remain pending/retryable.
- **State.** `syncview_calendar_v2`/`_off` (sticky v2 read toggle), `syncview_cal_v2debug`,
  `syncview_calCache_v1:<slug>` (7-day SWR cache, quota-evicts oldest), `syncview_calendar_prefs`,
  `syncview_cal_filters_v1`, `syncview_calendar_pins`, `syncview_calendar_settings_v1` (per-client
  collab/title-review, device-authoritative within a trust window), `syncview_cal_scroll_<slug>`,
  `syncview_cal_archived_v1_<slug>` (local archive ledger), `cal-skip-approve-confirm`,
  `cal-skip-setall-confirm-<status>`, `syncview_captionJobs_v1`, `syncview_linear_outbox_v1`,
  `syncview_calLinearMeta_v1`, `syncview_kasper_seen_v1`/`_at_v1`, `syncview_notes_seen_v1`,
  `syncview_calCardJobs_v1` (durable post-submit card jobs). sessionStorage: `sv_noteDraft_<pid>`,
  the shared token-verify cache. **Kill switches:** `calendar_upsert_ef_clients` (upsert+reorder
  routing), `settings_ef_clients` (caption-prompts-save + prompt overlay). `?v2=0` is a local
  read-source selector, **not a kill switch** (F125). Rich optimistic-
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
- **Retirement warning (F104).** The former Phase-4 checklist is quarantined: it falsely treated the
  opt-out and fallback branches as unreachable and would also remove the v2 metadata reader's
  `LINEAR_STATUSES_URL`. No flag, fallback, helper, workflow, or Sheet is retired without measured
  usage, replacement recovery, whole-repo consumer proof, full cross-surface tests, and F60.
- **Notable / corrections.** `calendar-append-post` and `calendar-delete-post` are **dead** (constants
  defined, zero fetch sites; delete is an archive-upsert). `linear-tweak-comments` is **not** a
  calendar endpoint (it's Workload's). The URGENT-marker write bypasses the routing flag, so an EF
  outage breaks sent-state persistence even for n8n-routed clients.
- **Track B.** Continuous `*_deliverable_id` linkage is already maintained and drained to 0. At each
  B4 team flip: four link-predicate families re-point, name-sync activates, and deliverable comments
  use the normalized `production_comments` issue thread; caption/title-only notes with no
  deliverable remain card-local. B5: link columns inert.

### 4.3 Submit tab (batch submission; internal key `linear`, route `#linear`)

- **Entry.** The visible top-nav label is **Submit** (`navLinear`), while the intentionally unchanged
  internal nav key and hash are `linear` / `#linear`. `?intake=1` hard-locks the whole SPA to this
  form (no password, chrome hidden, `navTo` coerced to `linear`). Existing bookmarks stay valid.
- **Reads.** n8n `linear-projects` (client dropdown, on mount when empty). **Current live caveat
  (F45):** its unpaginated GraphQL query returns only the first 50 of 58 eligible video-team
  projects and supplies no completeness signal. Staff-gated `filming-plans` EF GET resolves the
  read-only plan link and has no raw REST, Sheets, or anonymous-realtime fallback. Post-
  submit link poll reads `workload_issues` REST (Workload v2 default) → n8n `linear-issues` fallback.
  Calendar-upsert routing flag (read).
- **Writes.** n8n `video-form` and `graphic-form` are the **live batch submit endpoints** (one POST
  carries the whole batch; "Create Linears" fires both). The browser also calls n8n
  `log-linear-submission` with a replay-shaped envelope before submit, but that call is itself
  fire-and-forget; it is not a durable acceptance receipt. Background per-video
  calendar-card creation routes through the **calendar's** shared upsert fetch (EF `calendar-upsert`
  vs n8n `calendar-upsert-post` by the calendar flag) with deterministic `p_lin_<ident>` ids.
- **State.** `syncview_linear_form` (autosaved draft, cleared on submit), `syncview_last_link`,
  `syncview_calCardJobs_v1` (durable card-write jobs, resumed on boot, 3-min heartbeat prevents
  double-run, gives up after 48 h / 5 runs), `syncview_linearIssuesCache_v1` (5-min), `?wl2` /
  `syncview_workload_v2_off`. Kill switches: `calendar_upsert_ef_clients`, `?wl2=0`.
- **Roles.** Staff full; intake role = password-bypassed Linear-only lock; clients never reach it
  except via intake (which stays role `smm`). Kasper active → background card writes carry kasper
  headers.
- **Current caller-auth defect (F91).** The password-bypassed intake page sends no authenticated
  principal, and the active video/graphics n8n gates verify team direction only. The shared
  status/comment bridges have the same defect. Contain all four now with active immutable identity
  or an owner-ratified short-lived exact-client intake capability; native reroute is not permission
  to leave the transition route public.
- **Failure/fallback.** `linear-projects` fail → empty dropdown, retry only on next mount; a
  successful truncated response looks complete (F45). `video-form`/`graphic-form` and the log call
  are **fire-and-forget with `.catch(()=>{})`** — a failed Linear creation is silent and the green
  "Issue created!" banner shows unconditionally. **F44 live proof:** the workflow Respond node can
  return 200 before lookup/create; one non-TEST run then failed parent creation, produced no parent,
  and had no companion log execution. Its error alert omitted the input, so neither the alert nor
  the child-only card poller could replay it. Background card writer: durable job saved *before* the async
  work; 15 s wait then ≤20 polls × 5 s to find + link sub-issues; shortfall → "Calendar sync
  incomplete" pointing at calendar's Import-from-Linear. Resume skipped under `?prod=1`.
- **Single-team component defect (F101).** Advanced Video-only/Thumbnail-only sends only the chosen
  team and leaves the sibling link blank, but the card writer initializes both creative statuses to
  `In Progress`. Overall/client-ready logic includes the absent sibling while its pill is disabled
  and bulk actions skip it. Parked native intake preserves the same contradiction. Enforce the
  locked paired model or implement explicit active/N/A component semantics before reroute.
- **Notable / corrections.** `linear-subissues` is a **read** used by Calendar/SXR, not a Linear-tab
  write. The durable card-job system exists because of a real data-loss incident (tab closed during
  the pre-write window). Due dates are computed client-side in 5-working-day batches.
- **Track B.** The current Submit form still creates in Linear and mirrors in. The Part 2
  backend implements authenticated native-first mixed-team intake, server-owned project mapping /
  auto-assignment, native-id responses, and an allowlisted targeted parity create lane while a
  team remains Linear-authoritative. The backend is deployed dark but intake is not wired to the SPA; a separate
  owner-reviewed caller PR switches this form. **Parked-caller defects (F133/F134):** that candidate
  commits generic deliverable titles and later edits only the card, while committed card-materialization
  recovery is actor-bound localStorage with no server job/admin reassignment. Both are pre-merge gates.
  B5: `linear-subissues` + family retired.

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
  actor/action activity summaries. `_prodLoadEventsFor`/`_prodActivity` exist but are never called,
  so persisted native events are not shown (F138). Also fires the shared Sheets essentials in the background for
  app chrome. The tab also reads the single `prod_authority` runtime-flag row to gate controls.
- **Writes.** Status, comment, due date, and assignee use the authenticated `production-write` Edge
  Function. The browser supplies the native deliverable ID, a bounded idempotency key, and CAS for
  scalar changes; verified staff headers come from the shared role-key identity path. Controls are
  enabled only when the target team's authority is `syncview`, except an active `kind=test` client
  can send the gateway's bounded TEST override before a flip. The browser never requests legacy
  parity, changes flags, calls an n8n mutation, or writes Linear directly. Project moves, creates,
  deletes, and the remaining artifact affordances stay read-only.
- **Current hard gaps (F50/F53/F54/F94/F136–F138).** A successful deliverable status write does **not** project to
  the linked Calendar/Samples card, whose component status remains a separate downstream truth.
  Graphics has no canonical protected file/delivery-link operation; a manual card-side organizer
  edit does not set `deliverables.file_url`. Inactive clients are loaded into ordinary queues, and
  neither browser staff gating nor server staff-key writes enforce `clients.active` for
  status/comment/due/assignee. Manual assignment also offers/accepts any active same-team roster row,
  without compatible-role or usable-Linear-mapping enforcement before the native commit (F94).
  Creative authorization also lacks current-status/assignee input, so same-team creatives can regress
  reviewer/terminal work or cancel/duplicate it unless a separate owner policy is enforced (F136).
  Video's four typed resources collapse into one priority-selected URL always labelled Delivered file
  (F137), and native activity events are never loaded/rendered (F138).
  Production work data also has no realtime/bounded foreground refresh or ordinary manual refresh;
  only authority polls, so an all-day foreground creative tab can remain stale indefinitely (F95).
  Its due picker also freezes a browser-local “today” at script load while overdue compares a fresh
  UTC day; no Production timezone contract reconciles them (F99). Mouse due choices/cells also
  discard the selected year, while keyboard Enter preserves it, and stored `MM/DD` cannot seed the
  correct picker month/selection (F100).
  These are pre-flip build/authorization gates, not polish.
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
  may use all four operations. Creative **writes** are limited to same-team status/comment, not
  own-assignment, and status policy does not validate current state (F37/F136). The
  protected comment **reader does not fetch the target or enforce member-team scope** (F39), so a
  creative key can currently read another team's full protected thread by deliverable ID. Direct
  diagnostics without a verified identity remain read-only. "My issues" is a hardcoded heuristic
  (member matching a specific name, else first active assignee), not a real identity (F37). At
  ≤900px the sidebar containing My issues and the only visible palette trigger is hidden; the
  touch-visible top bar has no personal/team queue switch (F96).
- **Failure/fallback.** REST per-page fetch: 3 attempts, retry only network/429/5xx. Boot-load failure →
  full-tab error screen + Retry; silent refresh failure → `console.warn`, stale kept. Pagination-cap
  overflow is a hard error (never silent truncation). Comment read failures are isolated to explicit
  sign-in/error/retry states; older-page failure keeps already loaded rows. Freshness is only a
  silent refresh on visibility/focus/pageshow, throttled 30 s; the repeating foreground timer reads
  authority, not operational data, and the normal UI has no manual Refresh (F95). A stale-tab server authority rejection
  refreshes the stance immediately; a CAS conflict applies the returned current row and asks the
  user to retry. UI state changes only after `native_committed=true`. A protected-write 401 is only
  converted to toast copy; it does not clear/reverify the session, open sign-in, preserve intent, or
  retry after fresh authorization (F10).
- **Notable.** `?c=…&prod=1` reaches the current read-only client mirror without the password (see §3);
  signed-in staff on the private active TEST fixture can use #812's bounded write lane. This is the
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
  Shared: SMM-directory CSV, client-token-verify EF, bounded ID-only
  `thumbnail-revision-read` availability checks, and exact-card protected comparison URLs.
- **Writes.** `sample-review-upsert` (EF iff flagged, else n8n — **no EF→n8n fallback**),
  `sample-review-reorder` (flagged EF failures are fail-closed; no auth downgrade to n8n). Linear legs (`linear-set-status`,
  `linear-add-comment`), `send-urgent-slack`, `thumbnail-folder-resolve` (all shared). URGENT marker
  → `sample-review-upsert` EF directly (bypasses the flag).
- **Thumbnail refresh/comparison.** SXR shares Calendar's final Drive host, persisted server
  `thumb_rev`, realtime node advancement, private snapshot store, bounded history-availability
  projection, and exact-card protected Previous/Current dialog. Folder/media-less cards and cards
  without a confirmed pair have no comparison action; direct media writes can still refresh the
  current image even when no captured pair exists.
- **State.** `syncview_sxr_on`/`_off`, `syncview_sxr_prefs_v1`, `syncview_sxr_cache_v1_<slug>`,
  `syncview_sxr_archived_v1_<slug>` (60 s-grace ledger), `syncview_sxr_kasper_seen_v1`,
  `syncview_sxr_linear_outbox_v1`, `sxr-skip-setall-confirm-<status>`; shares
  `syncview_calendar_pins` + `syncview_notes_seen_v1`. sessionStorage `sv_sxrNoteDraft_<pid>`. Kill
  switch: `sample_review_ef_clients`.
- **Roles.** SMM: full edit, SMM-review flow, share-link kebab, media-less cards excluded. Kasper:
  works only the cross-client queue (never the `#sample-reviews` route); internal-only comments; each
  card persists with its own slug. Client: review-limited (approve/request-change/comment, not
  organizer/general editing), embedded Review+Sheet shell, sees only client-ready components,
  Kasper authorship stripped.
- **Failure/fallback.** Per-client read: REST → n8n → cached cards + "couldn't refresh" notice.
  Kasper read: no fallback → keeps items, "try again" only when empty. Upsert: per-card retry chip,
  no n8n fallback. Reorder: flagged EF failure is visible/fail-closed; unflagged clients retain the
  legacy n8n route. Archive: optimistic + ledger, restore on failure. Linear outbox
  retry. Token verify fail-open on network error.
- **Notable / corrections.** v1's "courier" and "filming-tabs stub" attributions are wrong — no
  `courier` symbol exists; filming-tabs belongs to Kasper. `comments_base_at` is hardwired `''`
  (server merge effectively off; merge is client-side). The unscoped Kasper read answers v1's open
  question about who reads `sample_reviews` globally.
- **Track B.** Same §9.2 re-point story as Calendar (including the samples twins gates). Samples-
  specific: a scheduled/posted clamp is a tolerated divergence; B2 must ship the samples outbox-peek
  for flip-step drain evidence.

### 4.6 Samples Old — Phase-1 retired staff route; retained client/backend compatibility

- **Entry/status.** The staff nav was removed and `#samples[/...]` now resolves to
  `#sample-reviews`; the legacy staff renderer does not mount. **The legacy client portal is not
  intact (F117):** `?c=…&v=samples&t=…` verifies that client/token, then the retirement redirect
  mounts generic SXR without carrying the verified client. Generic pins/preferences and **Add
  client** can select another client while client-link controls remain enabled. The legacy module,
  browser state, endpoints, table, and rows remain present, but the shipped redirect is neither a
  safe old portal nor a token-bound SXR migration.
- **Reads.** `content_samples` REST is the dormant renderer's default read (Supabase since Phase 3,
  2026-06-15); n8n `samples-get` is the automatic fallback and primary under sticky `?sv2=0`.
  Neither mode currently mounts through the shipped staff/client routes. Realtime `sm-<slug>`.
- **Writes.** **n8n only** — `samples-upsert` (whole-row: fields + approval + JSON-stringified
  comments; n8n fans out Sheet + Supabase), `samples-reorder`, archive via a `status:Archived`
  upsert. Both write graphs continue after a Sheet error and respond only after the Supabase branch;
  success therefore does not prove the Sheet fallback contains the write. No Edge-Function write,
  transaction, coupled recovery, or server kill switch exists for this surface.
- **State.** `syncview_samplesCache_v1:<slug>` (7-day, also the offline write fallback),
  `syncview_samples_prefs_v1`, `syncview_samplesSeen_v1`, `syncview_samples_v2`/`_v2_off`; shares
  `syncview_calendar_pins`. `?sv2=0` changes only the read source; it is not a kill or safe rollback.
- **Roles.** The dormant old client renderer was review-limited, with approval/request-change/comment
  actions but no organizer editing. The current legacy URL instead reaches generic SXR in client
  mode without an exact-client binding (F117); do not treat the old renderer's restrictions as a
  current route boundary. The dormant team renderer remains a full editor, including the Kasper
  approval *stage* (a stage here, not a role — any password-holder could click it from a stale tab).
- **Failure/fallback.** Cache-first → REST → n8n; both fail + nothing cached → "offline, saved on this
  device" banner; both fail + cache → stale board, silent. **Writes have no outbox/retry** — a failed
  save shows a *green* "Saved on device" and only retries when that card is edited again. Delete/
  reorder are fire-and-forget with empty catches. A Sheet-branch failure with a successful Supabase
  branch returns success, so sticky-off/automatic-fallback readers can immediately lose sight of it.
- **Notable.** Whole-row last-write-wins hazard (realtime only suppresses self-echo, doesn't merge).
  Browser token checks still attempt a nonexistent public-Sheet `client_review_token`; protected
  tokens in `client_access` are not wired into the four link builders (F03/F33). `setSmMode` preview
  toggle is dead code.
- **Track B.** D4 kept this path unchanged during Track A; Phase-1 staff-route retirement has now
  shipped, but F117 blocks calling its client-link behavior compatible. Fail the old URL closed or
  restore a token-bound portal before any Phase-2 deletion/redirect decision. Retained backends stay
  outside §13.4 teardown until the owner approves `SAMPLES_LEGACY_REMOVAL_MAP.md` Phase 2. Do not
  reactivate the old staff route accidentally, and do not advertise `?sv2=0` as writable recovery.

### 4.7 Kasper mode (`#kasper` / `?Kasper=1`)

- **Entry.** `?Kasper=1` sets sessionStorage `syncview_kasper_unlocked` and reveals the nav button
  (legacy localStorage unlock is actively deleted at boot). Subtabs: review, samples (only if SXR
  enabled), replies/messages, editors, filming, sales-intake, onboarding, client-credentials, and
  time-off (only when `pto_v1` is on) — hash
  `#kasper/<subtab>`, persisted in `syncview_kasper_subtab_v1`.
- **Reads.** Review queue is a **3-tier fallback**: `calendar_posts` REST (paginated, v2 default) →
  n8n `kasper-queue` (batched `{slugs}`) → per-client n8n `calendar-get` fan-out (5 workers).
  Cross-client `sample_reviews` REST (samples subtab). n8n `editors-week` (editors). Staff-gated
  `filming-plans` EF + n8n `filming-plan-tabs` (filming). `onboarding-full` EF (full sensitive inbox,
  shared/legacy-key-gated; active-admin binding and read audit are missing under F85). `client-
  credentials` EF (list/history). `pto` EF overview (pending queue plus protected team balances).
  SMM-directory CSV. Realtime `kasper-cal`, `kasper-sxr`,
  `client-credentials-rev-kasper`, plus shared flag channels.
- **Writes.** Approvals/tweaks/comments/finish-close stamps via the shared calendar & sample upsert
  fetches (flag-routed), field-level patches diffed against a per-card base. Linear `linear-set-
  status` / `linear-add-comment` (tweaks only — plain comments skip Linear). `send-urgent-slack` +
  direct EF urgent markers (bypass flags). n8n `sales-intake-submit`. `client-credentials` EF
  (upsert/delete/reassign/bulk_import/log_reveal). Admin-only `pto` decisions, adjustments, and
  member start-date/enabled-state updates.
- **State.** sessionStorage `syncview_kasper_unlocked`; localStorage `syncview_kasper_subtab_v1`,
  `syncview_kasper_review_cache_v1` (24 h), `syncview_kasper_cal_<slug>_v1` (5 min),
  `syncview_kasper_approved_log_v1`, `syncview_kasper_editors_v2`, `syncview_kasper_filming_v1` (30
  min), seen ledgers, both Linear outboxes, `syncview_staff_identity_v1` (verified roster member +
  role key, shared by staff EFs), `syncview_sales_intake_draft_v1`. Kill switches: the calendar
  & sample flags plus fail-closed `pto_v1` visibility for Time Off. `?v2=0` changes Calendar
  reads/realtime only and is unsafe for writes (F125).
- **Roles.** Hidden staff role, **no password for the queue itself** — only the URL param / session
  flag. Kasper comments are role `kasper` + audience `internal`, stripped from client views.
  Sensitive subtabs add a **real** role gate: admin can open onboarding + credentials; SMM can open
  credentials; creative/editor/designer can open neither. Time Off administrative controls require
  admin, while ordinary staff PTO overview/request calls use any recognized staff role. The role is
  derived from the matching secret, never a caller-supplied role header.
- **Failure/fallback.** Queue 3-tier as above; cached ≤24 h snapshot keeps painting. Stored staff
  identity changes are synchronized across tabs; sign-out purges the sensitive caches everywhere.
  Cold Review/Messages share one load, but a rejection targets only the Review body; Messages stays
  on its loading skeleton, while Review's error renders no retry control (F130).
  Persist failures
  revert + per-card error; finish/close failures swallow (local flag hides the card, next write
  reconciles). Linear outbox retry. 401 on key-gated subtabs → clear the shared identity, purge
  sensitive UI/cache state, then show the one staff sign-in form. A recognized but unauthorized
  role gets 403 and keeps its valid staff session. Realtime failure →
  visibility/focus refresh only (no poll despite a stale 30 s comment).
  PTO errors stay inside that subtab with retry; there is no direct-table or n8n fallback.
- **Notable / corrections.** "SMM reports" is **not** a Kasper subtab (it's a separate top-level
  route, §4.14). `kasper-queue` is the **middle** fallback, not primary. The role-header quirk
  (§3) misattributes writes made from `#kasper/<subtab>` as `smm`. The Kasper unlock has no
  password; the verified role key is the sensitive-subtab credential. At 390 and 768 px, the max-
  content nine-tab strip expands/pans the whole document, leaves later deep-linked tabs off-screen,
  and lacks contained touch scrolling, active reveal and accessible tab keyboard semantics (F121).
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
  `linear-tweak-comments` (Tweak-Needed popover, 5-min cache). n8n `editors-week` (**one** browser
  fetch site, but a publicly callable arbitrary-range endpoint) returns issue histories; all report
  metrics are computed client-side.
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
  `editors-week` fail → error card, older week cache still usable. **F48:** the endpoint is
  unauthenticated and exposes confidential people/client/work metadata. Its issue connection pages
  50 at a time but silently stops after 30 pages / 1,500 issues; each issue history is unpaged at
  `first:250`. The measured week hit neither cap, but completeness is not guaranteed, and past
  transitions are attributed to the current assignee. Authenticate/scope it immediately; B5 also
  requires complete native load/finish/open/timeline/event-time parity.
- **Notable / corrections.** v1's "3 call sites" for `editors-week` is wrong — one fetch site (the
  others are the constant + comments). The realtime channel is dormant. `content-ready`'s missing
  `resp.ok` check is a real bug-shape. `loadLinearIssues` is also the Calendar bulk-create link poll's
  data source (shared feeder + cache).
- **Track B.** Required but **not implemented** (F40): the re-point to native rows must happen per
  team at each B4 flip, but main and #813 still unconditionally use `workload_issues`/n8n with
  realtime off and Linear links. The adapter needs `deliverables + batches + clients +
  team_members`, mixed-authority composition, and an explicit sub-issue/top-level policy. B5 may
  retire the Workload reconciler/feed only after this native path and the `editors-week` query pass
  parity gates.

### 4.9 Client links (`?c=<name>&t=<token>`, no-login)

- **Entry.** `?c=` in the query. Four portals by `?v`: analytics profile (default), embedded Calendar
  (`?v=calendar`), old Samples (`?v=samples`), Sample-Reviews (`?sxr=1&v=sample-reviews`). Boot adds
  `boot-client`, bypasses the password, hides staff chrome.
- **Reads/Writes.** All shared with the owning surfaces (§4.1/4.2/4.6/4.5), scoped to the one client;
  the exclusive read gate is **`client-token-verify` EF**. Staff share actions obtain the current
  exact-client bearer token from the staff-only **`client-review-link` EF**; tokens no longer come
  from the Clients Info sheet. Current Calendar/Samples client
  approvals/change-requests still reach the legacy `linear-set-status` / `linear-add-comment`
  bridges and browser-local retry queues; they do not use the B4 server outbox. #813's native
  reroute is unmerged and would require a valid protected token (F03/F33).
- **State.** The per-surface caches/flags of whichever portal loads, plus sessionStorage
  `syncview_client_token_verify_v1` (per `slug|token` verdict cache). `X-Syncview-Client-Token` is
  attached **only** to EF URLs.
- **Roles.** `role='client'` wins over `#kasper`/`?Kasper=1`. **Can:** approve, request changes with
  a note, comment, and (collab_mode ON) edit/drag/suggest. **Cannot:** set statuses directly,
  archive, multi-select, tag colours/platforms, link Linear, generate captions, bulk ops, URGENT
  ping, credentials, brief regeneration, copy/share kebabs. Sees only client-ready cards; Kasper
  authorship always hidden; status labels renamed.
- **Failure/fallback.** A nonempty legacy Sheet token mismatch would show the static "isn't valid"
  screen, but that column does not exist, so the local comparison is always unguarded. The server
  verifier blocks only on 401/410/`mode:enforced`, permits verifier errors in the current path, and
  positively session-caches verdicts without TTL/revision (F38). A tokenless link can therefore
  continue reading in permissive mode while the native write gateway rejects the missing protected
  token. Read/write fallbacks otherwise inherit each portal's behavior.
- **Notable / corrections.** v1's `client-links-refresh` **does not exist** — the nearest code is a
  purely client-side "open profiles" dropdown (zero backend). An **unknown `?c=` slug** falls past the
  token gate to the staff home dashboard without a password. Old-samples client writes carry **no
  role/token headers** (indistinguishable from SMM at the webhook).
- **Track B.** Tokens already minted and the verifier is live in permissive mode. Remaining: re-issue
  links per client, then flip fail-open → fail-closed. Untouched by `prod_authority` flips.

### 4.10 Filming Plans

> **P1 CONFIDENTIALITY BLOCKER (F82).** Live read-only proof found that both the Edge GET and direct
> anon REST returned the complete client/document-link roster. The staff-gated Edge GET is now live
> and denies missing/wrong keys with `401`. The SPA now reads via that staff EF, with raw REST/
> realtime/Sheets fallback paths removed and the narrow F88 anon-SELECT revoke applied (2026-07-15,
> post-#836): the raw `filming_plans` table anon-SELECT is revoked and direct REST returns 401/42501. The blocker remains open pending intended-role
> browser proof, direct-table denial, and public-seed/Google-sharing review.

- **Entry.** Team tab `#filming-plans`; Kasper "filming" subtab (read-only). Shared consumers:
  Templates profile card, Linear form's read-only plan field.
- **Reads.** Staff-gated `filming-plans` GET (all verified staff roles) through the shared,
  server-reverified identity. There is no browser PostgREST, anonymous realtime, or Sheets fallback.
  n8n `filming-plan-tabs` remains Kasper's optional per-Doc coverage probe (concurrency 5), and
  Kasper runway reuses Calendar reads.
- **Writes.** The app uses `filming-plans` POST for upsert. Writes remain admin-only; SMM and
  creative keys can read but cannot write. The old `ONBOARDING_STAFF_KEY` remains backend-only
  transition compatibility and `CREDENTIALS_STAFF_KEY` remains rejected.
- **State.** `syncview_staff_identity_v1`, `syncview_kasper_filming_v1` (30-min, identity-gated and
  cleared on plan save/sign-out), in-memory `filmingPlansData` + `_linearPlanMap` (also purged on
  sign-out). **No kill switch** —
  `FILMING_PLAN_TABS_URL` is a build-time switch only.
- **Roles.** Reads require a verified admin, SMM, or creative/editor/designer staff key. Writes
  require admin. A missing/wrong key is 401; a recognized but write-disallowed role is 403.
- **Failure/fallback.** EF read/save 401 clears the shared identity and offers the staff sign-in form
  once. Other failures stay inline and fail closed: **no raw REST, Sheet, retry queue, or stale-cache
  anonymous fallback**. Runway fetch failure can still paint a client falsely "red".
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
  n8n `ttp-auth-init` (full-page OAuth redirect), `ttp-submit` (Direct Post). Current unaudited
  compose source automatically assigns `SELF_ONLY` and disables its selector; it also lacks the
  required pre-submit Music Usage Confirmation (F119).
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
  not in the client inventory. F119 blocks review/posting until privacy has no default, the music/
  commercial declarations are implemented and tested, and product/legal records provider-backed
  eligibility for agency staff posting to connected client accounts.
- **Track B.** No impact — TikTok stays in back-office n8n by owner decision D1; never referenced in
  the Track-B spec.

### 4.13 Onboarding + Sales intake

- **Entry.** Public onboarding form: `?onboarding` / `?onboarding=ai` / `/onboarding_form` /
  `/ai_onboarding_form` (each hard-locks nav to `onboarding`, forces its own dark theme). Viewer:
  `?onboarding_view=<slug>` (standalone route, but its reader now requires verified Admin auth) + a
  Kasper "onboarding" inbox subtab. Sales
  intake is **not** a URL form — it is a Kasper subtab only.
- **Reads / P0 (F77).** Viewer/index: `onboarding-list`, `ai-onboarding-list`, and
  `legacy-onboarding-list` are live behind the same pre-service-client gate as `onboarding-full`;
  missing/wrong keys return `401`. Candidate callers fetch the role key only after verified Admin
  sign-in and never hardcode it; existing Pages list screens therefore fail closed until merge.
  F85 remains: shared admin/legacy-secret compatibility does not bind an active member or audit reads,
  and `onboarding-full` can return the unstripped corpus including retained credential arrays.
  Same-origin media assets (audio/video/thumbnail-style previews). The public tree serves 43 such
  files; the existing implementation record describes many as client-source derivatives and gives
  no rights/provenance classification for others (F118).
- **Writes.** Onboarding submit is a **never-lose-a-submission chain**: primary n8n `onboarding-
  submit` (or `ai-onboarding-submit`) with one retry → `onboarding-capture` EF → n8n `onboarding-
  fallback` (also the `sendBeacon` target on tab-hide). Sales intake: n8n `sales-intake-submit`
  (preview/create contract + invoice email; **no auth header** — only the client-side Kasper unlock).
- **Privileged provisioning / P0 (F128).** The public primary submit graphs accept caller-created
  identity/email and, after intake insert, dispatch an unawaited shared workflow that can create
  Drive/CRM/Slack objects and invoke vault import. It has no invitation/verified-sale correlation,
  authenticated staff approval, provider sandbox, durable per-step job, or captured inverse. Do not
  run a fake-client drill: even fictional input mutates real providers and cannot be proved removed.
- **Credential egress / P0 (F129).** The shared “full brief” currently includes account-access and
  backup/recovery-code answers in the workspace-public creative channel, or a fallback DM, despite
  the form/lifecycle/workflow description saying securely stored/excluded. No message was inspected;
  occurrence is unknown. Structurally exclude secret-class fields before any message/log and perform
  private history/rotation review.
- **Public-capture abuse gap (F81).** `onboarding-capture` accepts caller-selected IDs and unbounded
  payload/note upserts without nonce, rate, strict size/schema/kind, or conditional ownership; its
  fallback action can relay caller text to alerts and every upsert resets creation chronology.
- **State.** `syncview_onboarding_draft_v1` / `syncview_ai_onboarding_draft_v1` (separate keys),
  `syncview_*_subid_v1` (stable dedupe id across retries/fallbacks, cleared on success),
  `syncview_sales_intake_draft_v1`, shared `syncview_staff_identity_v1` (verified roster member +
  role key). No kill switches.
- **Roles.** Both submission forms are intentionally public intake; `onboarding-capture` has no
  stored-data read path. All list/view readers require Admin staff auth (with a temporary legacy
  onboarding-secret compatibility path); current Pages readers fail closed until their key plumbing
  merges. The full Kasper inbox needs the unlock **and** an Admin staff identity. Sales intake needs
  only the Kasper unlock; its webhook itself carries no auth.
- **Failure/fallback.** Submit chain: any leg's success shows the thank-you (a fallback capture counts
  as delivered); total failure → banner + "Download my answers" JSON + mailto escape hatch, no auto-
  retry. Draft sync is silent-fail with a 25 s throttle; pagehide uses a preflight-free `sendBeacon`.
  Viewer partial-list failure shows a warn banner; a standalone-viewer total failure is
  indistinguishable from "no record on file". The Kasper full inbox is one unpaged snapshot of only
  the three primary tables: it omits fallback/dead-letter rows, does not show returned status, and
  has no acknowledge/complete/retry/archive action, polling, or realtime (F110/F111). Its stale n8n-
  activation recovery copy was removed under F120. Sales intake: single attempt, no retry/fallback,
  draft retained.
- **Notable / corrections.** `?intake=1` is **NOT** this surface (it's the client Linear-submission
  mode — the code comment literally warns "the key is sales-intake, never intake"). `sales-intake-
  submit` triggers real contracts/emails with only a client-side gate. A dead `SC_THUMB` constant
  remains. Current operator placement is Kasper → Onboarding; the historical Templates/n8n-list
  guidance is not a recovery path (F120).
- **Track B.** Low — the funnel stays n8n (D1); the onboarding-capture fallback is unchanged. §9.1's
  "intake" means the Linear-tab batch intake, not these forms.

### 4.14 SMM Weekly Reports (new row)

- **Entry.** Hash-only, no nav button: `#smm-weekly-report` (SMM form) and `#smm-weekly-reports`
  (viewer, labeled "Kasper view"). Viewer filters (`week/smm/client/status`) live in the hash query.
  Both hide all chrome and `syncview_nav` is deliberately never set to these routes. The staff
  caller (merged with #836, 2026-07-15) requires a freshly verified staff identity/key before every
  API call, so current Pages sends that header and the route is served with auth rather than exposed
  anonymously.
- **Reads.** Staff-gated `smm-weekly-reports` EF — `?action=options` (roster + current week) and
  `?action=reports` (submitted reports). Client roster for the picker comes from the background
  analytics fetch. Anonymous GET now returns `401`.
- **Writes.** `smm-weekly-reports` EF POST `{action:'submit', report}` (13 fields required; server
  dedupes via 409 `already_submitted`).
- **State.** In-memory `_srpState` only (no persistence). Shared theme/palette. No kill switch.
- **Roles / P0 (F76).** The active anonymous disclosure/deactivation paths are closed: the EF denies
  anonymous reads and `sync_managers` with `401`, the existing signed n8n caller reaches its
  authenticated branch, and anon SELECT on both underlying tables is revoked. Admin/SMM may use the
  intended form/report actions; roster sync is Admin-only. Candidate browser key plumbing still must
  merge, and shared-key/per-human identity plus incident review remain open.
- **Failure/fallback.** Options fail → in-card error, Submit disabled. Submit 409 → "already
  submitted"; other errors → inline, no retry/queue. Reports fail → viewer replaced by an error empty-
  state.
- **Notable.** The `smm-weekly-reports` EF is the only inventory endpoint using GET-query + POST-JSON
  on one URL. Do not restore anonymous access to recover UI availability while the protected Pages
  caller is pending.
- **Track B.** The data model is outside Linear replacement, but F76 is a global go-live security
  blocker: individual SMM submit, Kasper/admin reads, signed service roster sync, and revoked anon
  table access must land before the cutover can claim enforced staff authorization.

### 4.15 Client Credentials (new row)

- **Entry.** (a) Kasper "client-credentials" subtab (`#kasper/client-credentials`), Kasper-unlock
  gated; (b) per-client SMM modal from the Calendar card kebab (only when a client tab is open and not
  a client link).
- **P1 security blocker (F84).** A valid shared/legacy key bulk-downloads plaintext passwords before
  masking; direct extraction has no reveal event; actor is caller metadata; password edits would
  retain old/new plaintext in returned history. Require individual sessions, metadata-only list,
  one-secret synchronous audited reveal, and no plaintext history.
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
  file. Thumbnail history now has two distinct endpoints elsewhere in the map:
  `thumbnail-revision-scan` remains backend-only, while Calendar/SXR call protected
  `thumbnail-revision-read`. The live migration revokes raw revision-table reads; browser-table and
  unsigned-object denials plus authorized/cross-client reader scope were proved, closing F83 on
  2026-07-14. Passwords arrive in plaintext with `list` and sit in JS memory;
  masking is visual only; even reveal auditing is caller-invoked/fire-and-forget and direct
  extraction or copies can be unlogged (F84).
- **Track B.** `client-credentials`, `onboarding-full`, and filming-plan writes now consume the same
  role-key identity as §6. Both old surface keys remain server-side compatibility until the separate
  owner-approved retirement gate.

### 4.16 Time Off / PTO (new row; source-dark)

- **Entry.** Staff route `#time-off`, reached from the consolidated top-right account menu rather
  than the crowded main nav; admin queue and member tools at `#kasper/time-off`. Both entries are
  hidden and direct staff navigation returns home unless `pto_v1={"mode":"on"}`. The source ships
  with the migration seed off; this map does not claim the migration, deploy, or flag write is live.
- **Reads.** Staff-key-authenticated `pto?action=overview`. The response projects the caller's
  wellness/sick/floating-holiday/leave-year detail and request history, approved absences and fixed
  holidays for the team calendar, plus a minimal all-member summary. The Kasper admin view uses the
  same protected boundary for pending requests and balance rows. The SPA never reads `pto_members`,
  `pto_requests`, or `pto_adjustments` through PostgREST.
- **Writes.** `pto` actions `request` and `cancel` for ordinary staff; admin-only `decide`, `adjust`,
  and `set_start_date`. The server recomputes request weekdays excluding weekends and observed fixed
  holidays, rejects paid anniversary-spanning ranges, owns anniversary accrual/balance math, and
  serializes approval through a per-member state-version snapshot/finalize RPC. A partial unique
  index reserves one pending/approved floating holiday per member/calendar year. There is no n8n,
  Sheet, Linear, or public-REST writer and no realtime publication.
- **State.** In-memory PTO overview/request/month-calendar state plus the browser-read
  `syncview_runtime_flags.pto_v1` gate. Data refetches on mount and successful actions; there is no
  polling, local HR cache, or PTO data-table realtime channel. A separate flag-only subscription,
  bounded resume/entry reads, and monotonic response generations propagate the off switch. The
  theme/palette preferences remain the shared shell state.
- **Roles/security.** The secret-matched role wins over actor/role headers; admin remains required
  for the detailed cross-member table and all administrative mutations. **Go-live blocker:** the
  three current role keys are shared and `key-verify` accepts a caller-selected same-role roster
  member, so the current member/actor value is not an immutable person principal. It cannot safely
  enforce "own" HR detail/request ownership against a same-role key holder. Keep `pto_v1` off until
  an individually revocable server session derives the member without browser actor/member trust
  and negative impersonation/revocation tests pass. The additive tables enable RLS with no
  anon/authenticated policies and grant service role only; `pto_enabled` defaults false. Personal
  roster/seed data stays outside this public repository.
- **Failure/rollback.** Unknown key 401 clears/re-prompts identity and retries once; known but
  insufficient role 403 preserves the valid identity. Other failures remain visible and fail
  closed—there is no legacy fallback. The one-step user-facing/approval behavior kill is to
  set/read back `pto_v1={"mode":"off"}`: entry points retire and overview/request/decide/cancel
  return `503 feature_disabled`, including from stale tabs. The two admin-only direct setup actions
  intentionally remain available while dark; source reverts and workflow disablement are secondary.
- **Notable.** Wellness resets on each hire anniversary, not Jan 1; floating-holiday scope is the
  separate calendar-year v1 default. Negative seeded wellness balances are valid display state and
  block further wellness requests rather than crashing or being coerced to zero.
- **Track B.** None. This is a separate staff/HR feature and must not change the Production/Linear-
  mirror route, authority, data model, or rollout controls.

## 5. What changes, when (Track B) + auth

Current phase: **B4 outbound staging (dark), with the Part 2 gateway and #812 Production caller live** — B3 evaluation
mirror remains live and Linear stays authoritative for both teams. #813's broader
Calendar/Samples/Submit reroutes remain unmerged and lack the required cohort gate.
`prod_authority = {video: linear, graphics: linear}`, `linear_inbound_enabled = {enabled: true}`
(flip 15, 2026-07-07), `auth_enforcement = permissive`; the three Track-A `*_ef_clients` flags carry
the full active roster (Track A closed 2026-07-10). Mirror at full parity (~4.3k deliverables /
~1.0k batches; diff / repair / linkage all 0, 2026-07-11).

**F97:** permissive is the current pre-enforcement state, not a phase that may survive into real
parity. GO_LIVE Phase 0.75 now connects the owner F5 CAS to exact current-token evidence,
stale-verdict/session invalidation, readback, and fail-closed TEST proof before any real cohort.

- **B4 (in progress; owner gates remain).** The additive outbox, write wrappers, outbound drainer,
  strict echo suppression, TEST-only harness, two-way reconciler lane, and pager coverage are staged
  behind `linear_outbound_enabled=off`; real authority remains Linear. D-25's full-roster exercise
  proved the pipe; D-28 now requires a green soak and Graphics-first human cutover before Video.
  F27/F58 supersede D-26's direct pause: stop new team mutations and disable the involved outbound
  lane(s), both normal F2 and parity F4 if unknown/mixed, for immediate
  containment; return authority to `linear` only after audited team intent resolution and a
  machine-read zero. The #812 Linear-mirror caller is live on Pages but stays read-only under current authority; card
  predicates, Workload, and intake remain on their current paths until their separate
  owner-approved handoff.
  **F98 forward-order correction:** for the first handoff, F2 normal outbound must be live/read back
  with correlated terminal drainer/credential receipts plus an observer outside n8n, zero normal
  writes, and exact both-team normal-lane zero before
  Graphics F1 opens native authority. Parity writes are classified separately; authority-paused
  residue is not released. The former F1→F2 order exposed a native-committed/Linear-stale window.
- **Part 2 gateway backend + #812 Production caller (live, authority-locked):** `production-write` is the single
  browser write boundary. It authenticates staff role keys or client tokens with secret-decides semantics,
  resolves an authorized claimed roster/client principal, enforces per-team authority + CAS/idempotency, and writes
  through service-only ledger RPCs. Normal Production writes require team authority=`syncview`;
  F31 still blocks calling a shared-key/caller-selected roster name immutable human attribution.
  the active TEST client has a bounded override. The proposed #813 Calendar/SXR status+comment and
  Submit create callers are not merged; current #813 also has no D-32 per-client allowlist, so its
  legacy-parity lane is not safe to enroll. F55 is additionally open because the browser accepts
  only canonical `syncview`, while several backend consumers still accept legacy `supabase` as an
  alias. D-28 requires cohort soak before a Graphics-first flip; a D-29 data incident is contained
  per F27 and cannot use a blind authority reversal. The disposable two-team TEST drill completed 18
  operations, observed zero unexpected echoes, reconciled `0/0/0`, cleaned up, and proved the
  pre-existing runtime flags unchanged.
- **B5 (after clean batch cycles per team).** Linear frozen → archived; the `linear-*` n8n family and
  legacy card-write webhooks retired; Workload reconciler + `workload_issues` retired; SyncView is
  the whole production system.

**Auth (authorization tiers locked by D6; credential/session mechanism still blocked by F31).**
Admin / SMM / creative remain the three tiers, and client links stay no-login with minted,
server-verified tokens. Current staff requests use a shared tier key plus roster-picked
`X-Syncview-Actor`; that cannot individually revoke a departed holder or prove immutable human
attribution. Built: B0 tables, `client-token-verify` + `key-verify`, roster-backed staff sign-in,
verified EF header plumbing, and the flag-flip trigger. Credentials allow admin + SMM; onboarding
list/full reads and filming-plan writes allow admin only. Weekly reports and four of six Track-A
writers now have live fail-closed gates; the two upsert deployments wait for their merged scheduled
callers. Historical surface keys are still accepted while `auth_enforcement=permissive`; the
unauthenticated Track-A n8n writers are a separate F67 escape. The Part 2 gateway rejects missing/
garbage credentials and keeps low-level wrappers
service-only, but F31 still blocks calling a claimed actor trustworthy attribution. F87 adds uniform
denials, request controls, bounded audit retention, and explicit verifier/audit-outage behavior.
F89 proves current client telemetry records access-allowed as `ok`, not credential validity: the
seven-day live window has zero valid-token evidence and cannot authorize enforcement. F88 proves
tokens are not a direct-read confidentiality boundary while raw anon policies remain. Remaining
work includes individually revocable immutable sessions (or explicit time-boxed owner risk acceptance),
validity/revision-bound telemetry, closure of every fail-open/public-read path, and the owner enforcement action. After
enforcement, a global return to permissive is a security incident—not routine rollback (F70).
**Auth precedes any real write phase.**

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

Also folded in: two surfaces v1 hid (SMM Weekly Reports §4.14, Client Credentials §4.15), plus the
new source-dark Time Off surface (§4.16); the five
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
- **Edge functions (22):** `ai-onboarding-list` · `calendar-reorder` · `calendar-upsert` · `caption-prompts-save` · `client-credentials` · `client-review-link` · `client-token-verify` · `filming-plans` · `key-verify` · `legacy-onboarding-list` · `onboarding-capture` · `onboarding-full` · `onboarding-list` · `production-comments` · `production-write` · `pto` · `sample-review-reorder` · `sample-review-upsert` · `smm-weekly-reports` · `templates-save` · `thumbnail-folder-resolve` · `thumbnail-revision-read`
- **Not counted above:** 18 of the 22 are referenced literally as `functions/v1/<name>`; 4 are composed onto the onboarding edge base constant. Five more are represented in `supabase/functions/` but are never called by the current app: `linear-inbound`, `linear-outbound`, `deliverable-write`, `batch-write`, and `thumbnail-revision-scan`. (`key-verify` moved into the called set as of PR #788.)
- **Supabase REST tables, literal (7):** `calendar_posts` · `caption_prompts` · `content_samples` · `syncview_runtime_flags` · `team_members` · `templates` · `workload_issues`
- **Supabase REST tables, dynamic:** the visible Linear mirror (internal `production` surface) pages through `'/rest/v1/' + table` (variable `table` in `_prodRestRows`) for `batches`, `deliverables`, `team_members`, `clients`, and the one-row `syncview_runtime_flags` authority read. A dormant event-loader target names `deliverable_events`, but runtime never invokes it (F138). SXR reads `'/rest/v1/' + SXR_TABLE` where `SXR_TABLE` = `sample_reviews`.
- **Runtime kill-switch flags (5):** `calendar_upsert_ef_clients` · `prod_authority` · `pto_v1` · `sample_review_ef_clients` · `settings_ef_clients`
- **Flag semantics:** the three `*_ef_clients` values are per-client-slug allowlists; a listed client's writes go to Edge Functions, while an unlisted client currently selects an unauthenticated n8n writer. Flag-read and some EF failures can do the same, so this is F67 fail-open behavior and the flags are not safe auth-preserving rollback switches. All three carry the full active roster since 2026-07-07 (Track A closed 2026-07-10). `prod_authority` is the strict per-team Linear/SyncView write-authority map used by the Linear mirror; missing/malformed/unknown values keep controls read-only. `pto_v1` is a fail-closed off/on visibility and behavior gate; source ships off and has no n8n fallback. Other plan-side flags remain backend-only.

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
