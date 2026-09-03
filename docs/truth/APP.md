# App logic (`index.html`) — current truth

> Last verified: 2026-08-24 @ c7f088a + scoped Kasper Ad Performance panel v2 addition (see below)
> + scoped F27 verification 2026-08-02 @ 968a895 + Slice 5 LIVE (F37/F94/F136 assignment and transition
> policy introduced in `production-write` v26 and now served by F27 closure v27; F95
> foreground refresh live in the browser; the read-path migration applied 2026-07-26 ~23:45Z,
> measured 1,273→392 ms per page; the §3 TEST drills of `docs/ops/SLICE5_APPLY_WINDOW.md` remain
> OWED, so these are live-capable, not proven), plus the #945/#947/#948 canonical-comment gate
> hardening (crosswalk-valid linkage, multiset provenance coverage, hidden/tombstone refusals,
> client-never-sees-less), F200 live data repair and the
> live-applied/deployed Slice 4
> (F201/F202/F203/F39-F42-F43/F34-F53 migrations applied 2026-07-24, functions deployed from
> `1738ad3`, F42 linked-cohort import executed 2026-07-25; TEST drills still owed), integrated
> boot-audit vault
> through F199, and Production/Graphics audit through F205. The F176/F179 overnight-runner containment is isolated in parked draft
> #908 by owner decision and does not block the client-entry product fix; do not expand or reopen
> that containment scope here. The client verifier v28 and matching #891 browser are live. The
> Workload Creative/list-write candidates retain their deliberate-manual/no-live-change boundary.
> F27 was installed and production-verified on 2026-08-02 from exact release
> `968a895108beb2a2c41e86bb8b788115e35b14a0`; the final receipt read inbound v40,
> outbound v35, production v27, deliverable v26, and batch v26 ACTIVE and returned
> `F27_FINAL_VERIFICATION_OK` with PASS across all 17 enumerated assertions.
> Seeded from the 2026-07-05 logic audits (`docs/audits/2026-07-05-logic-*.md`); grown in
> place by the ongoing deep audit. Symbols named here are drift-checked by
> `test/truth-sync.js`.

> **Scoped Kasper Ad Performance addition (2026-08-24, v1 merged via #1127):** adds an
> `ad-performance` subtab to `KASPER_SUBTABS`, a new `Analytics` group to `KASPER_MORE_GROUPS`, and
> the read-only `_kasperRenderAdPerformance()` panel (`_kadLoad()`/`_kadPaint()`/`_kadRenderChart()`),
> calling the admin-gated `kasper-ad-performance-read` Edge Function. It reads only; it never writes
> any of its tables.

> **Scoped Kasper Ad Performance v2 addition (2026-08-24, merged to `main` via PR #1131,
> commit `e1eaf9a`, deployed and live-HTML-verified):** adds a client-side date-range toggle
> (`_kadSetRange()`/`_kadRangeCutoff()`/`_kadRowsInRange()`, mirroring the Edge Function's
> `summarize()` math in `_kadSummarizeRows()` so switching ranges needs no extra fetch), a per-ad
> table (`_kadByAdInRange()`/`_kadByAdTableHtml()`, reading the Edge Function's `by_ad` field), and
> a per-lead list (`_kadLeadsInRange()`/`_kadLeadsListHtml()`/`_kadLeadStatusHtml()`, reading the
> `leads` field — real PII, name + email, admin-gated same as the rest of the panel). Still
> read-only. Merging required resolving a real conflict against #1129's same-day CSS class rename
> (the panel's card chrome had been decoupled from borrowed PTO/Time-Off class names to fix a
> leave-evidence CI false-positive); v2's new sections were rewritten onto the same dedicated
> `kad-card`/`kad-section-title`/`kad-table-*` classes rather than reintroducing the borrowed names.

> **Scoped Kasper Ad Performance v3 addition (2026-08-24, merged to `main` via PR #1137,
> n8n workflow credential-wired/proven/published 2026-08-25):** adds an "Unfinished leads"
> section below "Booked leads" —
> `_kadUnfinishedLeadsInRange()`/`_kadUnfinishedLeadStatusHtml()`/`_kadUnfinishedLeadFollowUpHtml()`/
> `_kadUnfinishedLeadsListHtml()`, reading the Edge Function's new `unfinished_leads` field (real
> PII — name/email/phone, admin-gated same as the rest of the panel). Shows people who started the
> iClosed booking flow but never finished it (`iclosed_status` potential/qualified; disqualified
> excluded upstream), and whether n8n's existing recovery-email automation has actually emailed
> them yet (`email_sent_at`/`sms_sent_at`). Still read-only. Kept as a separate table from "Booked
> leads" rather than merged in — the two carry different columns. This scoped note does not refresh
> unrelated App-logic facts retained from earlier dated evidence.

> **Scoped Kasper Quiz Leads addition (2026-08-24):** adds a `quiz-leads` subtab to
> `KASPER_SUBTABS`, a `quiz-leads` key in the existing `Pipeline & Admin` group in
> `KASPER_MORE_GROUPS`, and the read-only `_kasperRenderQuizLeads()` panel
> (`_kqlLoad()`/`_kqlPaint()`/`_kqlFilter()`/`_kqlToggle()`), calling the new admin-gated
> `quiz-leads-list` Edge Function. Admin-only via a new `quiz-leads` staff capability
> (`_syncviewStaffCan`), same posture as `pto-admin` — not open to every unlocked Kasper session
> like Ad Performance. It reads only; it never writes `quiz_responses`. Source table and capture
> path (`quiz-capture` Edge Function) are **source-only, not yet applied** — see
> `migrations/2026-08-24-quiz-responses.sql`. This scoped note does not refresh unrelated
> App-logic facts retained from earlier dated evidence.

> **Scoped Hiring Process operating baseline (2026-08-25; capture/review live, invitation delivery
> default-off):** adds the admin-only `hiring-process` destination to `KASPER_SUBTABS` /
> `KASPER_MORE_GROUPS` and renders it through `_kasperRenderHiringProcess()` plus the memory-only
> `_hpCall()` client. The browser calls only the staff-authenticated `hiring-applications` Edge
> Function; it never calls iClosed, Gmail, n8n, or PostgREST directly. The private migration and
> both hiring functions are deployed. n8n now captures the dedicated iClosed application event and
> alerts Kasper, while the dedicated interview booking takes a strict early branch in the existing
> iClosed booked-call receiver and cannot enter sales nodes. `hiring_invites_enabled=false` and the
> dispatcher is inactive, so no candidate email is sent automatically. The source contract rejects
> incomplete/stale capture snapshots, advances state version on an accepted refresh, and never treats
> a queued/claimed job as an invitation: only a one-shot, claim-scoped authorization immediately
> before delivery may release the email envelope, and only a provider receipt may set `invited`;
> stale delivery becomes `delivery_uncertain` with no automatic resend. A later interview booking
> binds to the stable iClosed contact ID, not email.

## Shape

One ~45.8k-line single-file SPA. Major surfaces: content calendar, samples (SXR + legacy),
three review flows (client / Kasper / SMM), the visible Linear mirror/work surface (internal
`production`, `#production`, `?prod=1`), the visible Submit form (internal `linear`, `#linear`),
onboarding funnel, sales intake, filming plans, thumbnails tooling, SMM weekly reports, TikTok pilot.

## Release and stale callers

- **Owner final-integration boundary (2026-07-22).** The client verifier is already live at v28
  and must not be redeployed in this integration. The owner selected a hard browser cutover: no
  active-link confirmation wait is required, and an old link is expected to reach the existing
  fresh-link-required screen after the browser merge. F176/F179 overnight-runner containment was
  split intact into parked, unmerged draft #908 for later review. It remains recorded but is not a
  #891 merge blocker; do not expand or reopen that scope here. Final exact-head cloud review of
  `babbb2d` completed with no new findings; only the owner merge remains for the product branch.
- **Deferred final-review portability finding (F185).** Exact-head cloud review at `f91aba17`
  found that the client-entry visible-boot workflow installs Chromium system dependencies only on a
  browser-cache miss. The hosted 23/23 lane passed, but a fresh cache-hit runner may lack those Linux
  packages. The owner scope freezes this as a non-blocking, separate follow-up; #891 does not change
  the workflow for F185.
- The current app-update banner is advisory, not a caller-expiry control (F127). Direct `?prod=1`
  skips it; clean onboarding aliases probe a 404 path; a cached old document can adopt the first
  newer ETag/Last-Modified response as its baseline; and dismissal keeps that old code running.
- The page embeds no immutable running build/auth-authority epoch, protected requests carry none,
  and servers do not return `upgrade_required` before mutation. Build-population telemetry is absent.
  Go-live therefore requires a fixed same-origin manifest plus server minimum-build/epoch enforcement,
  with owner-defined optional versus mandatory release behavior and draft/queue-safe reauthentication.
- F172 is a **source-only** staff Analytics lifetime gap: current-main `fetchAll()` has no
  document/BFCache run or abort lease. Draft #891 `02105e9` passes its new run only for client links and its
  suspension owner exits for staff, so the unmerged candidate does not close the staff path. No
  staff browser reproduction or runtime frequency is claimed; the staff-flow phase must add the
  actual visible pagehide/BFCache/late-completion guard.
- Client-entry release-harness review is complete on draft #891 `02105e9` with audit companion
  `3189203`; it is not pending. It found F175/F176 and F178–F182: protected URLs/headers and keys
  still reach direct shell argv/errors, the TEST token is exported job-wide, token-bearing client
  targets can reach static-server/Playwright failure output, manual dispatch text is shell-injected
  into credential-bearing steps, and the p94/EF auxiliary/vision paths retain private shell/file
  transports. Evidence is source-only except for isolated local synthetic Python/Playwright proof
  of F178 and inert, no-payload-execution substitution proof of F179; no real token/staff/API key,
  external network, backend/API, live data or writer was used. F175/F176 and F178–F182 were merge
  blockers at that reviewed head pending remediation and post-remediation exact-head review. F177 is the docs-only
  correction of the former stale review-status wording. Continued cloud source review at PR #891
  `59022d` expanded F176/F179: `run-probes` still reconstructs the staff issuer key into every
  manually selected probe, including non-client probes, and selector handling lets a valid
  component mask empty/unknown components instead of rejecting the complete value. Then-current
  candidate `93fc297` began remediation. Candidate `13c042b` passed local `npm test` 149/149, but
  exact-head cloud source review (review `4741233371`; comments `3619424490`, `3619424493`)
  returned two P1 blockers. F176's registry/census omitted workflow-direct
  `sxr_client_persist_guard.js`; that scheduled Samples probe calls `sxr_courier_lib.client()` but
  receives no staff issuer key. F179 passes the same `scn` to the flat and tree runners, while each
  runner independently requires every term in its own catalog; a legitimate catalog-specific
  selector therefore fails the sibling lane. Validate once against the union, run only each lane's
  exact matches, let a no-match sibling skip cleanly, and reject a truly unknown selector before
  loading the live harness. No credential, browser, backend or live scenario was used for those
  source findings. Pre-split candidate `c9a79ef` locally expanded the immutable registry and
  census to all 39 registered probe consumers, applies the F179 union-catalog selection contract, applies
  the F184 persisted-debt owner/finalizer/retry guard, and passes local `npm test` 150/150 plus
  actual visible boot 23/23. Its exact-head cloud source review is nevertheless not clean: review
  `4741601566`, comment `3619744849` at `qa/overnight_runner.sh` line 109, found an additional F176
  occurrence: the direct process tree inherits `SYNCVIEW_STAFF_KEY` before the 39-probe registry can
  classify probe children. Follow-up local source tracing found the transitive
  `qa/overnight_cron_chunk.sh` pass-through, unrelated helper inheritance and no declared broker
  boundary for legitimate scenario/master consumers. Both shell entries must capture then unset
  before any child; only a registry-approved probe or declared scenario/master broker may restore
  the staff issuer to the final operative Node process, never the legacy token or a timeout/wrapper
  argv/log/output. Neither source pass used a credential, data, browser, backend or write. The later
  owner split moved the F176/F179 containment work intact to parked #908 and made it non-blocking for
  #891. Product-owned rows stay OPEN only through owner merge; final exact-head cloud review completed
  at `babbb2d`, with F185 separately deferred.
- F183 is the client Brief async-lifetime boundary found by the same post-F182 cloud source review
  at `59022d` and reconfirmed at then-current `93fc297`. `_syncviewPurgeClientEntrySurface` zeroed
  `briefPollingState` and `tabSummaryCache` without first clearing retained polling intervals or
  aborting tab-summary controllers. After pagehide/BFCache capability revocation, detached work can
  therefore complete into global Brief state, local cache and render paths. Pre-split candidate `c9a79ef`
  locally generation-owns and cancels polling, delayed/active summaries and both Brief-sheet reads
  before state reset. Actual visible boot passed 23/23; the real pagehide /
  `pageshow.persisted` held-response guard proved zero late global/cache/localStorage/render mutation
  and one fresh generation. That is synthetic local evidence, not cloud review. Final #891
  exact-head cloud review completed at `babbb2d`; F183 remains OPEN only through owner merge, and
  parked #908 is not its blocker. No
  browser, backend, token, live data or write was used for the original finding.
- F184 is an additional P1 from exact-head cloud source review at `adb1bca`, reconfirmed unchanged
  at then-current `13c042b`. `_writeUiResumeLegacyQueues('startup')` and its focus/pageshow/online/
  visible/timer triggers run on every client-link document before strict verification settles, so
  persisted same-origin Calendar/Samples/Linear/intake debt from a prior staff/session context can
  be read or replayed before an invalid/rotated client link reaches terminal UI. This is distinct
  from F171's held client-A continuation. Gate every resume owner behind an exact current principal
  generation: inspect no queue before strict client verification; after verification, permit only
  matching-slug/client-principal Calendar or Samples rows, leaving foreign/unknown/staff debt and
  every staff-only job/repair/intake queue untouched. Staff-wide recovery requires a currently
  verified identity/session. Pre-split candidate `c9a79ef` locally implemented that exact owner,
  source-gate-principal, in-lock finalizer and scheduled-retry cancellation boundary and passes the
  actual visible lifecycle guard 23/23. Final #891 exact-head cloud review completed at `babbb2d`;
  F184 stays OPEN only through owner merge, and the owner-parked #908 containment does not block it. The finding is source-only; no browser,
  backend, token, live data or write was used.

## Client-entry boot boundary (review candidate)

- A query containing the `c` key is client-owned from the head prepaint onward. Before staff auth,
  cache hydration, data loading, or routing, the browser accepts only the exact `c`/`t`/supported
  `v` envelope and requires the strict `syncview-client-entry-v1` verifier response for one active
  client, its current token, exact view, exact slug, and a canonical display name that normalizes
  back to that slug. An older/permissive verifier response fails closed.
- Missing, malformed, duplicated, unknown, inactive, or mismatched credentials; unsupported views;
  mixed staff history/hash/Production state; and canonical-name mismatch all end on one client-safe
  invalid-link surface with no client-data request or staff fallback. Network, timeout, rate-limit,
  and verifier 5xx failures show a distinct retry surface and never fake an empty dataset.
- Calendar, Brief, and Analytics serialize their client tab in the query/history envelope rather
  than a staff hash. A verified client can always open the supported Brief tab while slower extras
  stream: the requested route owns a loader until required responses succeed, a failed required response
  shows a keyboard-operable retry instead of fake-empty data, and an explicit retry fetches only
  extras before repainting the still-active route. Genuine absence uses the existing visible
  no-brief copy. Legacy `v=samples` is verified
  first, then replaced in place with `v=sample-reviews&sxr=1` and mounted directly for the exact
  verified client. Staff Samples preferences, pins, and sticky opt-out neither rebind nor mutate.
- Verification grants only an in-memory capability. Every client analytics continuation is leased
  to its generation, canonical URL, slug, capability, and abort signal; client Calendar and Samples
  keep their active transport controller under the same lifecycle boundary. Calendar additionally
  leases realtime creation/callbacks to an epoch, connected surface, exact slug, and client-entry
  run, so a teardown during lazy client creation cannot reopen a channel. Its v1 Linear reconcile
  and metadata continuations retain the same exact controller/surface owner through every await and
  may not join a user-owned save bucket. Replacement loads, profile exits, invalidation, teardown,
  and `pagehide` revoke and abort reads before clearing the capability. Staff Calendar `pagehide`
  flushes writers first, retires read/realtime ownership and visible pending state, and a persisted
  `pageshow` starts exactly one fresh owned read despite ordinary return throttles. Even a
  synthetic transport that ignores abort cannot apply rows, recreate cache, repaint, or restart a
  staff-only caption job after revocation. Client documents also skip staff-only template, pending
  brief, PTO-flag, caption-prompt, and residual caption-job startup work.
- `qa/boot/client-entry-sequence.js` guards the actual visible sequence by streaming the document,
  painting the static frame, and recording animation-frame states through verify, route loader,
  settle, reload, Back/Forward, and real `pageshow.persisted` BFCache returns. Its 23 groups include
  verifier 408 and 500 responses that visibly offer keyboard-operable retry and recover without a document reload,
  rotated-token denial, deliberately late analytics, Calendar, and Samples responses after capability revocation,
  Calendar → Brief/Analytics retirement, a held Calendar-to-Brief extras loader → visible retry →
  loader → mounted Brief sequence, A → B visible-loader ownership, stale realtime-factory denial,
  held v1 reconcile/metadata denial after client replacement, pending/settled staff BFCache recovery,
  the exact-client legacy queue resume lease,
  and legacy Samples exact-client migration/traversal with generic/wrong-client frames forbidden. It
  is fully synthetic/intercepted, makes one attempt per navigation, and is registered as the `boot`
  QA lane plus the dedicated client-entry pull-request check.
- This section describes reviewed candidate behavior, not a live-deployment claim. Because
  `client-token-verify` has no CI deploy path, release must deploy and read back the exact reviewed
  verifier source and pass a TEST-client strict-protocol drill before serving the matching browser
  caller. Reversing the order remains confidentiality-safe because the browser fails closed, but
  would make valid links visibly unavailable. Rollback is the inverse: restore and read back the
  prior browser first (the v1 verifier remains backward-compatible with non-strict callers), then
  roll back the verifier only if still required. No runtime flag changes in this release.

## Calendar

- End-to-end logic map: `docs/audits/2026-07-05-logic-calendar.md` (evidence);
  write path + contract: `docs/truth/SUPABASE.md`.
- Status pushes to Linear go through `_calPushStatusToLinear()` — **no guard** on
  Posted/Scheduled (they ARE pushed; a stale code comment claims otherwise).
- The active `linear-set-status` and `linear-add-comment` bridges receive no verified caller
  identity (F91). Team authority constrains direction only; it is not authentication.
- Status pills require a linked Linear sub-issue ("Link a Linear sub-issue first") — **legacy-lane
  invariant**: it holds for clients NOT in `write_ui_reroute_clients`. Enrolled clients (TEST-only
  today) route status/comments/Create Post through the authenticated `production-write` gateway,
  which accepts native deliverable IDs without Linear URLs.
- `?v2=0` is **not writable rollback** (F125): it selects Sheet reads while full-roster
  upsert/reorder routing still targets Supabase-only Edge Functions. Normal Supabase-read failure
  automatically selects the same Sheet fallback. Either state must remain read-only until one
  coupled recovery authority exists.
- Drive-file thumbnails are rendered from the final `lh3.googleusercontent.com/d/<id>` host, with
  persisted `thumb_rev` in the actual browser cache key. Calendar adopts a newer server revision
  across cache/LWW guards and advances existing image nodes on realtime without waiting for a hard
  refresh or a focused-field repaint.
- **Realtime freshness contract (2026-09-03).** A staff tab subscribes to
  `calendar_posts` filtered to the client on screen and reloads the WHOLE client on
  each event. Three windows govern how often that happens:
  `CAL_V2_RT_DEBOUNCE_MS` **350 ms** trailing debounce; `CAL_RT_SELF_ECHO_MS`
  **4 s**, which defers the echo of a write THIS TAB made; and
  `CAL_V2_RT_MIN_RELOAD_MS` **8 s**, a floor between realtime-triggered reloads
  that a FOREIGN burst re-arms against. So the **maximum delay before another
  writer's change appears is 8 s**, and the first event after a quiet period
  still lands on the 350 ms debounce. The floor exists because backend writers
  (the reconcilers that still apply Linear → card, OPEN_REPAIRS 76) update rows
  one at a time over seconds: measured 2026-09-03, 200 row writes in an hour
  across 9 clients, 56 on the busiest. Before the floor the self-echo window was
  the only coalescing and it keyed off `_calLastLocalWriteAt`, so foreign writes
  got none and every 350 ms window containing one row write became its own full
  reload — the owner saw ten to fifteen refreshes in a row. Pinned by
  `test/calendar-realtime-burst-coalesces.js` (real handler, virtual clock, with
  a mutant run); OPEN_REPAIRS 129.
- F170/F171: the current Calendar primary read, post-load Linear/meta continuations, realtime
  channel/timers, loader state and deferred render do not share one document/surface generation.
  Controlled synthetic-browser evidence held client A's v1 reconcile, switched visibly to B, and
  reproduced an intercepted stale write enqueued against B. Draft #891 candidate `02105e9` adds the
  proposed generation/abort/realtime/exit/BFCache guard, but it is unmerged. Exact-head source
  continued review found F175/F176 and F178–F184. Pre-split candidate `c9a79ef` passed local
  `npm test` 150/150 and actual visible boot 23/23 with the earlier F179/F184 blockers locally
  remediated, while its cloud review found the additional `qa/overnight_runner.sh` F176 occurrence.
  The owner later parked that containment in #908 as non-blocking. Final #891 exact-head cloud review
  completed at `babbb2d`; both Calendar rows remain OPEN only through owner merge.
- Cards with a single Drive-file thumbnail group their IDs into authenticated, bounded (maximum 50)
  availability calls to `thumbnail-revision-read`. That projection returns only the IDs with a real
  Previous/Current pair, so the **Compare** icon stays absent otherwise; it returns no signed URLs or
  history metadata. Clicking a visible icon calls the same function for one exact
  surface/client/card and receives the signed snapshots. Staff without a verified roster identity
  are sent through the existing secure sign-in first; client links use their scoped review token.

## Samples (SXR + legacy)

- Logic map: `docs/audits/2026-07-05-logic-samples.md`.
- SXR rejects pushing Scheduled/Posted to Linear (unlike calendar).
- `_sxrReassertLinearStatus()` is **defined but never called** (dead drift-protection). Samples
  reconciliation is currently on twice—pager dispatch plus its own GitHub schedule—so remove one
  cadence, not both. Until F132 closes, retain the independent schedule and remove the pager dispatch
  first if burn must fall (see `docs/truth/N8N.md`). The browser also has a 5-minute local-fresh merge guard.
- SXR writes `kasper_finish_log` which is silently dropped server-side
  (see `docs/truth/SUPABASE.md`).
- Calendar and Samples reorder only through HTML5 mouse drag events; no touch/pointer or keyboard
  fallback exists (F135).
- SXR shares Calendar's server-authoritative `thumb_rev`, final-host Drive URL, realtime image
  advancement, bounded ID-only availability check, and exact-card signed Previous/Current reader.
  The comparison action appears only after a real pair is confirmed for a single rendered
  thumbnail; Drive folders and media-less cards do not advertise a pair.

## Reviews (client / Kasper / SMM)

- The three flows as state machines + transition table:
  `docs/audits/2026-07-05-logic-reviews.md`.
- Linear comments are written prefixed `**{Reviewer} (via SyncView):**`.
  That display name is cosmetic on the legacy bridge and does not establish the caller (F91).
- Comment truth is now canonical **where linked** (F43): the F39/F42/F43 slice adds exact
  team/client-scoped canonical reads; a manifest-bound import of
  both Calendar and Samples/SXR arrays; and one create/reply/edit/delete/resolve/reopen lifecycle
  across Production, Calendar, and Samples. Its migration was applied 2026-07-24, its functions
  deployed from `1738ad3` (run `30129490033`), and the F42 linked-cohort import executed 2026-07-25
  (615 applied / 6,032 deferred / 35 link defects). PR #937 (`96d87bc`) made the client comment
  surface canonical-where-linked, legacy-where-not, and is live. Client links read the canonical
  thread with the verified token and exact SXR card/component/deliverable identity, project only
  client-audience rows, and never use endpoint self-attestation to unlock staff Client-visible;
  the tokened TEST drill is still owed before client-visible controls widen further.
  Canonical persistence precedes every
  Linear/mirror side effect; F2 `off`/outage pauses applicable comment debt rather than retiring it,
  and ordered dependencies preserve add/edit/delete handoff. Unlinked cards (the 6,032 deferred
  rows) remain on legacy card-JSON truth until the linkage brick lands.
- Kasper keeps Review Session, Samples, Messages, and Filming Plans in a stable priority row. Editors
  and Time Off sit under **Team** in an accessible More menu; Sales Intake, Hiring Process, Onboarding,
  and Client Credentials sit under **Pipeline & Admin**. The active More destination replaces the generic label,
  pending Time Off requests and onboarding submissions newer than this browser's last-opened
  Onboarding cursor show counts on their rows, and their combined count cues the collapsed More
  trigger. Opening Onboarding advances only its local seen cursor; pending Time Off remains actionable.
  responsive grids contain the navigation at 390/768 px and 200% text scaling, and denied staff-only
  routes canonicalize both the saved tab and URL (F121 is partially corrected; Back/history policy
  remains unchanged). A failed shared Review/Messages cold load leaves Messages on an indefinite
  skeleton, and Review renders no Retry (F130).
- Calendar/SXR review cards use the same persisted revision cache key as the editing strips, so a
  server or scanner bump replaces collapsed thumbnails, graphic previews, and backdrop images even
  while a comment field defers the full card rebuild. The comparison dialog is modal, Escape/focus
  managed, desktop side-by-side, and narrow-screen stacked.

## Workload

- Workload still reads its base issue set from the Linear-backed `workload_issues` mirror. F201/F40
  candidate source partitions deadline/label metadata by the exact `prod_authority` team value:
  Linear-authoritative IDs use the isolated `workload-linear` reader, while SyncView-authoritative
  IDs read `deliverables.due_date`, native deliverable identity/`updated_at`, and the complete
  native selected-label relation. The candidate retains the authority fingerprint and native CAS
  cursor in dedicated issue-id maps; neither replaces the base mirror's `workload_issues.synced_at`.
  The two authority partitions settle independently: a Linear outage cannot discard a proven native
  due/label snapshot or its write route. Missing, ambiguous, or incomplete native metadata fails
  closed for that native partition and never falls back to Linear; its retained deadline/weight
  values are cleared rather than carrying foreign metadata across the authority change. The broader
  F40 issue adapter, native links, realtime/catch-up, and top-level policy remain open.
- Dated work without a saved manual override gets a deterministic **ideal** automatic work day:
  one working day before its Linear deadline, floored to today (`wlAutoPlanDate()`). A saved manual
  `plan_date` always wins and is never moved.
- **Automatic placement is capacity-aware** (owner ruling 2026-08-10, from Raha's overload report;
  it replaced the earlier strictly item-local rule). `wlComputeAutoPlacements()` runs once per
  snapshot inside `wlApplyData()`, over the UNFILTERED planned set, and applies four rules in order:
  manual pins reserve their units first and are absolute; every remaining item is placed as late as
  it fits, walking BACKWARD over working days from its ideal day to the first day where that editor
  still has room; the walk never goes forward past the ideal day; and when nothing between today and
  the ideal day has room, the item keeps its ideal day and the editor/day keeps the red
  over-capacity badge. That badge now means genuine oversubscription — more work than the window can
  hold — not a naive collision. The guaranteed bound is **never later than the ideal day**, which is
  not the same as "always before the deadline": the ideal day is floored to today, so an item due
  today is planned ON its due date, exactly as before this change.
  Nothing is written: `workload_plan` still stores deliberate manual overrides only. The moves are
  computed once per snapshot into `wlState.autoPlacementByIssueId` (inside `wlApplyData()`, not per
  render) and only read while rendering, so `wlAutoPlacementDate()` re-applies the same today floor
  `wlAutoPlanDate()` applies on every read — without it, a tab left open across midnight would paint
  a stored move on a past day and drop the card out of the visible Mon–Fri week, since
  `wlBackgroundBusinessFingerprint()` watches issues/plans/metadata but not the clock. A stale entry
  is ignored and the card falls back to its re-floored ideal day. The map is dropped by
  `wlPurgePlanSensitiveState()` with the pins it is derived from. Placement is withheld entirely
  until the authoritative plan snapshot proves which items are pinned, so the fast first paint and a
  plan-read failure both keep the unmoved ideal placement; the bounded settle animation covers the
  cards that move when the snapshot lands. A moved card reports the `shifted` placement mode with
  its own icon and a tooltip naming the day it came from, so a day that is not "deadline − 1" is
  never unexplained.
- Capacity is 4 video workload units / 15 graphics items per editor per day: a hard input to
  automatic placement, and a warning wherever it still cannot be met.
  An exact authoritative `2× Workload` or `3× Workload` label makes that video consume two or three
  units; an unlabeled video consumes one. If both exact labels exist, three wins. Label weights
  affect capacity/overload, automatic placement, and workload ranking, and never move a manual pin.
  Within one ideal day the heavier item claims its slot first, because a 3-unit item needs a bigger
  hole than three 1-unit items. Each editor block owns the only red over-capacity signal. The date
  keeps its normal background, border, number color, and shadow, and every item remains available
  instead of hiding.
- Calendar hierarchy is date → editor → client → sub-issue. Editor blocks remain primary, each
  client starts as one collapsed `Client · N` chip, and only that client's sub-issues expand on
  click. Expanded rows use the sub-issue title while the identifier stays in the accessible item
  label and opened Linear context. Workload never emits native `title` hovers; placement, proximity,
  workload-weight, and drag icons use the shared branded `data-tip` tooltip instead.
  Within each editor/day, client chips are ordered by the closest signed plan-to-deadline buffer,
  with missing deadlines last and client name as the deterministic tie-breaker, so the most
  time-sensitive group appears first.
  Within a client, render order uses native mirror sort order only when the whole group carries it;
  otherwise it derives identifier-number order. The order is never persisted.
- Each editor block also carries the three exception queues as pills on their own row between the
  editor name and the client chips, reading worst first: **overdue → tweaks → in progress**. The
  Team workload matrix keeps its own headed column order (overdue / in progress / tweaks) because
  those columns are scanned vertically; the pills are unlabeled and scanned left to right. Counts,
  source lists, and the team/editor/client filter predicate are shared with that matrix
  (`WL_STATUS_QUEUES` / `wlEditorStatusCounts`), so a pill can never disagree with the editor's row
  above it. A pill carries the same rollup attributes as the matrix total and deliberately no
  `data-wl-date` — the queue is editor-wide, not scoped to the day it is drawn on — so clicking it
  opens the identical popover. An empty queue renders no pill; there is no `Clear` placeholder in a
  calendar cell. Because these are live states rather than work planned for a date, the day grid
  shows them on **today only**; in Plan + Due Date the per-editor banner carries them for the whole
  week. Pills use the existing overdue/tweaks/in-progress accent, border, and label tokens, outlined
  rather than filled so the filled treatment stays unique to the over-capacity badge.
- Assigned active work with neither an internal work day nor a due date stays off the calendar and
  appears in **Needs a work day or deadline**. An undated issue with an explicit plan day does enter
  the calendar. Past-due assigned work without a manual plan stays off the calendar and enters
  **Overdue**. A manually pinned past-due issue stays on its exact work day and also appears in
  **Overdue**; past-due In-progress work also remains visible in **In progress now**. `Tweak Needed`
  / `Tweaks Needed` remains an exclusive strip and never enters the calendar or either overlapping
  status strip, even when it retains a due date or saved plan override.
- The top summary is one line-light editor matrix: editor identity and capacity lead each row,
  followed by compact **Overdue**, **In progress**, and **Tweaks** cells. Counts remain visible;
  each status header expands or collapses only its client chips and remembers that browser
  preference. The centered **Work-day calendar** heading, period navigation, Week/Month controls,
  team/editor/client filters, and Plan/Due Date control share one static calendar box. Only the
  weekday/calendar body is replaced during rendering. **Needs a work day or deadline** remains at
  the bottom, after the calendar and **Needs assignment**.
- The animated Workload skeleton is limited to a cold first load, explicit manual **Refresh**, and
  forced post-create discovery. Re-entering a warm Workload route paints its existing in-memory
  calendar synchronously; internal navigation and browser visibility return never blank it and
  never call n8n. Explicit Refresh and post-create discovery retain the direct no-cache Linear path.
  After a successful explicit Refresh, Workload consumes only the current mirror watermark before
  background polling resumes, so an older mirror snapshot cannot replace the newer direct truth.
- Warm entry, visibility return, and the 60-second poll read only the newest Supabase
  `workload_issues.synced_at` watermark. An unchanged cursor performs no snapshot fetch or repaint.
  An advanced cursor fetches the issue mirror directly from Supabase plus saved plans and exact
  label/deadline metadata through their staff Edge readers. The complete result publishes atomically,
  metadata ids derive from that fresh issue set, and normalized comparisons ignore reconciliation and
  audit timestamps. A successful no-diff comparison still consumes the new cursor; actual issue,
  plan, or metadata changes trigger one deferred-safe repaint. A failed background read leaves the
  last good calendar visible with a freshness warning and a retryable cursor. Realtime remains
  intentionally disabled. The calendar does not render a freshness timestamp. Because an unchanged
  mirror cursor intentionally performs no projection reads, a plan-only change
  made on another device converges after the scheduled mirror sweep next advances that cursor; an
  immediate plan-side signal would require a separate backend contract.
- Plan dates and workload-label metadata remain in memory only: identity replacement, sign-out, and
  an expired-key `401` purge both maps and invalidate their in-flight reads without removing the warm
  non-sensitive issue calendar. A newly verified identity rehydrates those sensitive maps in the
  background against the retained issue snapshot, without a mirror or n8n read. The only Workload
  browser persistence remains the existing issue cache, expanded/collapsed section preference, and
  display-only **Plan only** / **Plan + Due Date** preference.
- The live editable-plan path adds a separate
  internal work day. A saved `plan_date` is keyed by the sub-issue's stable id in the service-role
  `workload_plan` sidecar and overrides the automatic day. Dragging an individual issue or using the
  drag handle updates only that internal date. **Use automatic plan** appears for every manually
  planned sub-issue in its popover; it clears that override and reveals the deterministic automatic
  day. The branded date control follows the current team authority: Linear-owned issues keep the
  isolated `workload-linear` writer, while SyncView-owned issues use the guarded
  `production-write` `surface=workload` due operation with the native deliverable ID and
  `updated_at` CAS cursor. Changing that deadline rederives only an automatic work day, while an
  explicit manual pin stays unchanged. Creative sees the same value in a disabled control.
- Calendar chips and expanded issue rows use quiet sparkle/pin icons for automatic/manual placement,
  plus a sparkle-with-back-arrow for an automatic card the capacity pass moved earlier;
  mixed groups show icon counts instead of text badges. Deadline proximity is a compact color dot,
  remains visible without opening a popover, and measures the buffer from that issue's displayed
  plan day to its due day:
  the plan day or later is red, one to two days is orange, and three or more days is green. Each
  expanded sub-issue owns its exact tone. A collapsed client group inherits a tone only when every
  represented item has a deadline in the same band; that single dot leads the client name and no
  proximity-colored edge is repeated on the chip. Mixed or missing deadlines show no group-level
  marker. All three tones use Workload-local, matched, vivid eight-pixel circles so their
  red/orange/green meaning stays stable and distinct in either theme, independent of the selectable
  app status-palette preference. Expanded due/buffer copy is plain text with the same dot rather than a
  bordered pill or colored row edge. Opening a client group reveals its sub-issues on a quiet
  threaded branch; the thread is decorative and does not change click, focus, or drag behavior.
  Native Linear Priority is not shown or used by Workload. Exact `2× Workload` / `3× Workload`
  labels appear as compact badges on the affected videos. A collapsed group shows one stacked
  some/all extra-work icon instead of repeated weight counts; its branded tooltip carries the exact
  `2×` / `3×` composition and capacity meaning.
- The persistent **Plan only** / **Plan + Due Date** segmented control sits beside the client
  filter and defaults to **Plan only**. Due-date mode is Week-only: enabling **Plan + Due Date**
  switches to Week and disables Month until **Plan only** is restored. Week is always the
  Monday-anchored five-column Monday-Friday range. Manual plan days and deadlines on Saturday or
  Sunday are never moved or hidden from truth: a compact weekend notice beside the calendar opens a
  tray with the affected items and dates. A compact, team-accented editor rail stays at the left of
  each subtle editor swimlane while its five daily capacity totals and relationship rows remain
  aligned to the calendar. Today is marked in the weekday header and by a faint column wash, with no
  large selection outline and no wash behind the editor rail. Each editor/client plan group stays in
  one aligned row, with a continuous visible connector line ending in the gap immediately before
  its outlined due-date endpoint instead of disappearing beneath that card. Different
  deadlines split into separate endpoints; work due on its planned day stays on the solid plan chip
  with a same-day **Due here** marker and the same proximity dot rather than a duplicate. Due
  endpoints are display-only references and never add to capacity.
- Shared issue popovers link to **Open Linear**, keep deadline proximity beside the sub-issue title,
  and place the authority-routed branded due-date picker plus optional automatic-plan reset on one compact
  row. Tweaks popovers retain their existing
  comment and Frame reminder layout.
- Workload no longer renders or calls the former `content-ready` client-email action. Its button,
  modal, webhook constant, and browser sender are absent, so Workload cannot be used to trigger
  repeated client revision emails.
- Dragging a collapsed client chip moves that exact date/editor/client group optimistically, then
  sends sequential single-issue writes through the existing `workload-plan` contract. Successful
  items stay moved; each failed item returns to its prior day, with one aggregate result notice.
  Dropping onto an existing matching editor/client group derives one merged chip. Expanded
  single-issue drag remains independent. Admin/SMM users start either drag only from the dedicated
  six-dot handle; the rest of each chip or issue row remains clickable and is not draggable.
- The staff-authenticated `workload-plan` Edge Function is the only browser projection and writer
  for the sidecar. Candidate source separates that access: Admin/SMM/Creative may list the same
  global saved-plan snapshot, while Admin/SMM remain the only roles allowed to set or clear a plan
  date. Creative therefore receives the same calendar placement and automatic/manual indicators
  after the exact function source is manually deployed. Its due-date control remains visibly
  read-only, drag handles are absent, and both servers still reject Creative mutations. Automatic
  placement uses the shared America/Guatemala policy day so the due-minus-one-working-day floor
  cannot vary with each viewer's browser time zone. A write is accepted
  only when
  the response reports exactly one row actually written; a short count reverts the optimistic move
  and notifies the user. A non-writable issue is rejected with `409 issue_not_writable` before any
  sidecar write and follows the same browser revert/notify path. A plan-list failure retains
  last-good data when available, otherwise shows
  an explicit due-date-only degraded state with editing disabled rather than silently treating
  overrides as absent. Authentication or authorization denial instead purges the private projection
  immediately. Reads and writes are bounded, and only the newest overlapping refresh may publish
  plan state.
- Candidate `workload-linear` uses the shared browser-write authenticator and the existing
  `LINEAR_MIRROR_API_KEY`; it has no n8n, frozen-writer, runtime-flag, schema, or `workload-plan`
  fallback. Metadata requests contain at most 100 unique active sub-issue ids and use bounded
  20-alias Linear batches. Missing aliases, GraphQL errors, truncated/malformed label connections,
  or omitted deadline fields cannot claim a complete metadata result. Due writes validate the exact
  active issue/client and validated Video/Graphics team, then re-read that team's exact current
  `prod_authority` immediately before Linear mutation. A stale browser route therefore fails with
  `409 team_is_syncview_authoritative` after a flip instead of writing the former owner. Permitted
  writes require an exact issue/date acknowledgement and then make a 2.5-second best-effort mirror
  update. A pre-commit failure reverts and notifies; once Linear has confirmed the commit, a
  zero-row/timed-out mirror update stays successful with
  `mirror_pending=true`, keeps the new date in the browser, and warns that Workload is catching up.
- F201's metadata adapter leaves that Linear boundary intact only for Linear-authoritative issue
  IDs. SyncView-authoritative IDs use the native due/label relation directly; an exact `2× Workload`
  or `3× Workload` label written through Production therefore reaches Video capacity math without
  waiting for outbound Linear reflection. Graphics may display the same labels but remains 15
  unweighted items. Slice 3 candidate source also routes native due edits through
  `production-write` with CAS, advances only the independent native cursor, and applies an exact
  gateway receipt to the in-memory Production and Workload projections. Linear-owned due edits
  remain on `workload-linear`; the inactive fast bridge is not part of either decision.
- **Deployment boundary:** effective live table/grant readback matches the locked 2026-07-19
  sidecar contract, and `workload-plan` v2 remains a deliberate-manual deployment. This candidate
  retains the deliberate-manual `workload-linear` function/browser caller alongside F201's
  CHECK-superset migration plus label gateway/mirror/native-consumer source. It changes
  no table/column data shape, table grant, runtime flag, n8n workflow, frozen writer, or real data.
  Slice 3 adds only the closed Workload/due gateway surface and browser/date source; it needs no
  migration.
  The `workload-linear` function remains not live until its own exact-SHA manual
  deployment/readback/TEST drill; F201's CHECK migration was applied to production 2026-07-24 and
  `production-write` was deployed from `1738ad3` (run `30129490033`) the same day.
  A Pages-only revert removes the caller and restores the prior Workload display without changing
  saved plan data or Linear. If the function was deployed, retiring it is a separate captured
  operation. F201's remaining owner-approved gate is the real service-only TEST labels
  drill. F147 keeps the exact plan-sidecar revoke-correction artifact provenance open, and
  #884's server-atomic batch contract remains open.

## Linear sync surface

- Every consistency surface (status/assignee/due/name/comments), outboxes, flags:
  `docs/audits/2026-07-05-logic-sync.md`; current sync reality: `docs/truth/LINEAR.md`.
- The password-bypassed `?intake=1` page and both live intake webhooks likewise carry no caller
  identity (F91). Containment/authentication is a current gate, not deferred B5 cleanup.

### The Linear link slot is SEALED on a SyncView-authoritative component (2026-08-25)

A card's `linear_issue_id` / `graphic_linear_issue_id` slot can no longer be SET by hand once that
component's team is SyncView-authoritative. The rule is keyed on authority, never on a team name:

- `_writeUiLinkSlotSealed(component)` — synchronous, from `_writeUiAuthoritySnapshot()`. Render-side
  only, and **fails OPEN** while authority is unknown, so a slow first paint never hides a control
  that works.
- `_writeUiLinkSlotSealedLive(component)` — the deciding gate, on a live `prod_authority` read.
  **Fails CLOSED**, returning `{sealed: true, reason: 'authority_unavailable'}` when the flag cannot
  be read — the same posture `_writeUiGatewayPost` takes.

**Why it exists.** While a team is Linear-authoritative `_writeUiGatewayPost` takes the legacy-parity
lane and the URL *is* the write target, so pasting one connects the card. After that team flips to
SyncView the write needs `intent.nativeId` (the card's `*_deliverable_id`), the paste still writes
only the URL column, and `makePayload` throws `native_link_required` on every later status change.
Measured after the 2026-08-16 graphics flip: 352 graphic `link_set` events, 3 real cards left
half-linked — one of them pasted by the SMM who reported the failure the next morning.

**What is sealed, and what deliberately is not:**

| action | sealed component | Linear-authoritative component |
|---|---|---|
| paste / change a link | refused, with a notice | allowed |
| **clear** an existing link | **allowed** | allowed |
| open the linked issue | allowed | allowed |
| bulk "match cards to sub-issues" (graphic half) | skipped, and the count is reported | allowed |
| "Move it here" conflict resolution | refused | allowed |

Clearing is exempt because it is the **repair** for every half-linked card the old behaviour
produced; sealing it would trap exactly the rows the seal exists to stop creating. A sealed slot that
already holds a link therefore renders the open-anchor **plus a remove (✕) button**
(`_calLinearClear` / `_sxrLinearClear`), which routes an empty value through the ordinary
`_calLinearCommit` / `_sxrLinearCommit` so there is still only one writer for the field. An empty
sealed slot renders nothing at all — under SyncView authority an unlinked Linear slot is the correct
state, not a missing chore, and `_calProdSlotHtml` already links to where the work lives.

Gated on both surfaces and at every writer, not just the button that usually calls it: the
single-card commit, the move path, `_calBulkLinkApply`, and the sample-review twin. The
deliverable→card direction (`_calAdoptDeliverableLinks` / `_sxrAdoptDeliverableLinks`) is untouched —
it fills an empty slot FROM the deliverable, which is the safe direction and the one that replaces
the paste.

Executed by `test/write-ui-link-slot-seal.js` against the shipped functions; the live-fleet count is
reported by `scripts/calendar-native-link-gap-check.js`.

## Linear mirror tab (internal `production`; `#production`; `?prod=1`)

- Visible top-nav label is **SyncLinear** (renamed from **Linear** 2026-08-21); the internal module/key remains `production`. #812's
  status/comment/due/assignee controls are deployed through `production-write`. F201 candidate source
  adds a lazy protected real Linear label catalog, selected color chips, searchable checkbox picker,
  description tooltips, and an Admin/SMM guarded full-selected-set label operation with CAS and
  idempotency. Real-team writes remain authority-gated; the pre-flip TEST drill remains service-only.
  Only that service-authenticated TEST drill may bootstrap an older TEST row's missing native
  selection from the same complete Linear snapshot; normal SyncView rows remain strictly native.
  F202 candidate source adds exact-Markdown description source/preview editing for root and child
  deliverables through the same gateway, with CAS/idempotency, audit/outbox mirror intent,
  authoritative refresh, read-failure recovery, and dirty-draft conflict preservation. Both slices
  are now live-applied and deployed: the F201/F202 migrations were applied 2026-07-24 and
  `production-write` was deployed from `1738ad3` (run `30129490033`); their real service-only TEST
  drills are still owed.
- Slice 3 candidate source makes every Production due choice/cell carry canonical `YYYY-MM-DD`,
  seeds month and selection from `dueRaw`, and gives mouse, keyboard, typed, and multi-select paths
  the same converter. Current day, relative input, highlighting, full-date display, and overdue
  math all use the already-ratified America/Guatemala policy day on demand. Workload also binds the
  shared calendar's Today action, highlight, and initial month to that on-demand policy day. A timer
  targets the next policy midnight, and focus/visibility/pageshow return rechecks it. This source
  and the closed `production-write` Workload-due surface are deployed as of the 2026-07-24
  `1738ad3` release (run `30129490033`).
- F203 candidate source adds Admin/SMM parent and sub-issue creation through `production-write`.
  The form uses active roster clients, the selected Video/Graphics team, exact Markdown, native
  full-year dates, active same-team assignees, and the complete real label catalog. Deterministic
  native/Linear IDs plus an exact session draft and durable redacted-audit/private-outbox receipt
  recover an ambiguous response without duplicating work. Root creation commits one structural
  batch and one deliverable; child creation validates a current top-level same-client/team/project
  parent, reuses its batch, and waits on its create intent when needed. The closed request schema
  accepts no Calendar/Samples/card/link field, and created rows are manual `kind=other` work with
  `card_id=null`. The additive service-only RPCs were applied 2026-07-24 and the gateway deployed
  from `1738ad3`; the real TEST creation drill is still owed.
- A protected-write 401 becomes toast copy only: Production does not clear/reverify the staff session,
  open sign-in, preserve/replay the action after fresh authorization, or otherwise recover (F10).
- F94: manual assignment was not eligibility-safe: the picker and server accepted any active
  same-team roster row and did not preflight compatible creative role plus usable Linear mapping
  before the native commit. Slice 5 candidate source closes it with one server-authoritative
  eligible-assignee projection (`assigneeEligibility` / `eligibleAssigneeProjection` in
  `supabase/functions/production-write/policy.mjs`) enforced at commit by `assertEligibleAssignee` for both the manual
  and create lanes, consumed by the picker through the new protected `assignee_options` action, and
  requiring active native member + exact per-team creative role (`video`=`editor`,
  `graphics`=`designer`) + a Linear mapping the provider confirms active. A missing or malformed
  `production_assignee_eligibility` flag stays strictest; only the exact
  `{"provider_mapping_required": false}` value drops the provider requirement at retirement. A
  read-only aggregate audit of 863 live non-terminal assignments found 777 already eligible, 79
  pointing at inactive members and 7 cross-team, and zero unmapped — the strict role default
  excludes nobody who is currently eligible, because every admin/SMM roster row carries no team.
  Candidate source only; not merged and dark behind team authority.
- F95: operational data loaded at mount and on focus/visibility/pageshow return; the repeating timer
  refreshed only authority, so a continuously foreground Production tab could remain stale
  indefinitely with no last-success age, degraded state, or Refresh control. Slice 5 candidate
  source adds a bounded foreground loop that reads a `updated_at` delta rather than re-pulling,
  refreshes the open comment thread on the same tick, invalidates scoped reads only for rows that
  actually changed (open drafts are preserved and marked stale), backs off exponentially on
  failure, runs a slower full reconcile so hard deletions converge, and exposes a live-region
  last-success age plus a keyboard/touch-reachable Refresh.
- The Production read path is the reason F95 needed a fix first, not just a timer. A 2026-07-25
  read-only anon timing probe (`qa/probes/prod_read_path_timing.js`) measured
  `production_deliverables_browser_v1` at ~1.2-1.5 s upstream per 1000-row page over 4,612 rows.
  The cost is neither the sort (two columns under the same `ORDER BY`: 24 ms) nor the Workload
  label lateral (pruned when unselected) — it is the 24 separate `linear_raw` extractions in the
  view, one detoast each: 0/1/24 raw columns under the same order cost 16/224/1216 ms. Because
  `ORDER BY` forces every page to project the whole relation, an offset walk of the projection costs
  ~5.9-6.0 s of upstream time, and the shipped browser issued four of those pages concurrently.
  Under that burst each page inflates to 2.1-2.5 s (three observed bursts, 0/12 failures in this
  window; the reported 15/15 `57014`/HTTP 500 reproduction is a threshold effect at higher baseline
  load, not contradicted here). Slice 5 candidate source replaces offset paging with a sequential
  primary-key keyset walk (measured 5.94 s -> 3.40 s of upstream time, no concurrent burst), and a
  source-only migration (`migrations/2026-07-25-slice5-production-read-path.sql`) rebuilds the view
  so each row detoasts once (offline PostgreSQL 16, 4,626 rows: 951.8 ms -> 312.5 ms per page,
  3.0x, output proven byte-identical in both directions of `EXCEPT ALL` including 14 adversarial
  `linear_raw` shapes). A composite index on `deliverables(team, status, due_date)` was measured and
  rejected: the planner keeps the sequential scan and the page still costs ~1.28 s.
- F96: at touch-mobile widths the sidebar is hidden, taking My issues and the visible palette
  trigger with it. The mobile top bar has no personal/team queue switch; `?view=my` works only when
  supplied directly or reached through a hardware-keyboard shortcut.
- Boot does a lightweight parallel select of `clients`/`team_members`/`batches`/`deliverables`.
  F145's hierarchy projection reads only `linear_issue_uuid` plus
  `linear_raw.issue.parent.id`: `_prodAdapter()` resolves the real Linear parent globally across
  creation batches/teams/clients. It never elects a parent from batch membership or title; an
  unavailable, ambiguous, self, cyclic, or archived target leaves the row visible as a root.
  Native events are written. Issue detail invokes the event loader for the Properties status-history
  hover, but the loader collapses failure to an empty array and the Activity renderer still has no
  render caller; detail shows Comments only (F138).
- Creative policy was same-team-wide and checked next status without current status or assignee, so
  it could regress reviewer/terminal work or mutate peer work after a flip (F37/F136). Slice 5
  (live: browser merged via #944; gateway v26 was deployed 2026-07-26 via run `30226070558`, and
  the current F27 closure is `production-write` v27 per the 2026-08-02 provider readback; the §3
  TEST drills remain owed) replaces that flat allowlist with one server-owned role × current × next × team ×
  assignee state machine (`CREATIVE_STATUS_TRANSITIONS` in `supabase/functions/production-write/policy.mjs`, mirrored
  byte-for-byte by `PROD_CREATIVE_STATUS_TRANSITIONS` in `index.html` and drift-guarded by
  `test/production-assignment-transition-policy.js`). It is a strict subset of what shipped: the
  work loop plus the SMM handoff, nothing out of `smm_approval`/`kasper_approval`/`client_approval`/
  `approved`/`scheduled`/`posted`/`canceled`/`duplicate`, no creative cancel or duplicate, and
  `status`/`attachment` bound to the row's current assignee while `comment` stays same-team-wide.
  An omitted current-state context denies rather than defaulting open. "My issues" and "Assigned to
  me" now resolve from the member id staff sign-in verified — the shipped name heuristic
  (a specially named assignee if present, else the first active assignee) is gone, and a
  signed-out, off-roster or deactivated session gets an explicit no-personal-queue state instead of
  someone else's work. Live since the 2026-07-26 window; drills owed.
- Video delivery/source data is collapsed from four typed fields to one priority winner labelled
  “Delivered file”; filming plan/raw footage can be hidden or mislabeled (F137).
- The 2026-07-23 full-day audit remains immutable findings evidence. F200's owner-approved roster/data
  correction applied on 2026-07-24. F39/F42/F43 and F201/F202/F203 advanced the same day: their five
  migrations were applied to production ~22:00Z, the staff-sensitive functions deployed from
  `1738ad3` (run `30129490033`), and the F42 linked-cohort import executed 2026-07-25 (615 applied /
  6,032 deferred / 35 link defects). Their remaining open gates are the real TEST drills and the
  unlinked-cohort import. F203 creation
  performs no implicit Calendar/Samples create, choose, or link action;
  explicit linkage remains later work under F112.
- F200 is distinct from F145: the native parent link remains the hierarchy owner, while candidate
  attribution now derives client identity only from active-roster project IDs or an owner-approved
  explicit roster/internal/TEST classification. B1 never inserts Linear-derived clients. Production
  renders `needs_attribution`, provisional unanimous-child family, and conflict states visibly
  instead of trusting a stale `client_slug`; inbound and scheduled reconciliation invalidate or
  compare project/client/hierarchy plus mapping revision. The live F200 private-manifest operation
  applied 87 attribution-only CAS patches after exact preflight/readback; two projectless TEST parents
  remain visible repair work, pending an owner decision.
- F204 owns the unresolved saved/shared-view and manual-board-order scope. F205 is a current
  wrong-data bug: board cards read client status/lead/target from `CLIENTS`, while project detail and
  its pickers read the slimmer `PROJECTS` object and can substitute In Progress/No lead/No target.
  F187/F154 additionally own stale Production scope on Back/Forward and invalid detail URLs after a
  refresh proves the entity absent.
- Current Production contracts are `docs/syncview-design/WIRED-PARITY.md`, `ADAPTER.md`, and the
  wired suites; `SyncView.html`/tokens are frozen visual evidence, while the old handoff/loop files
  are non-operative tombstones under F56/F64. UI changes must pass `npm run test:prod-polish`.
  Deep-links: `?prod=1`, `team`, `view`, `client`, `d` params.
- The Production polish visual lanes remain sensitive under F122, but public distribution is
  contained: the workflow was re-enabled after #836, retained named bundles remain deleted, and
  current source uploads no screenshots/review packets or Argos payloads while keeping detailed
  output runner-local. The first post-merge run proved no public visual/Argos delivery;
  fictional interception and exact-archive privacy tests remain the longer-term gate.
- Foundation audit evidence: `docs/audits/2026-07-09-production-foundation-audit.md`.

## Deep-audit findings ledger (Phase 2, 2026-07-11 →)

Living section — findings land here with status tags: `[open]`, `[fixed <commit>]`,
`[wontfix <reason>]`.

### F1 `[open]` — 35 defined-but-unreferenced functions (dead-code candidates)

Found 2026-07-11 by an automated scan (`function foo(` / `const foo = (…)=>` definitions whose
name appears exactly once in `index.html`, cross-checked against `onclick=""` strings and
`scripts/`+`supabase/` for `grabFunc` extraction). `appUpdateNudge` was a 36th hit but is
referenced by `test/app-update-nudge.js`, so it is NOT dead and is excluded.

**Do not bulk-delete.** Several are likely staged-but-unwired feature work, not cruft — triage
per group before removing anything. Verify each is still unreferenced at removal time (this is a
fast-moving file). Confirmed-dead example already documented: `_sxrReassertLinearStatus()`.

| Group | Candidates |
|---|---|
| Calendar | `_calClientPossessive` `_calCommentTotal` `_calLinkLabel` `_calOnTextareaInput` `_calOnUrlInput` `_calOpenUrlField` `_calStatusChip` `_calZoomHintHtml` |
| Linear mirror (internal `production`; `?prod=1`) — **check active prod sprint before touching** | `_prodById` `_prodClientEmoji` `_prodOpenBatch` `_prodSetFocusCard` `_prodSetTeam` |
| Samples/SXR | `_sxrReassertLinearStatus` `_sxrReorderUrlForClient` `_sxrSetAllSettable` |
| Onboarding | `_obAddCreatorRow` `_obToggle` `_obvToggle` |
| Market-research tab (looks unwired) | `_mrHookBadge` `renderMRTab_landscape` `renderMRTab_topics` |
| Client credentials | `_ccKnownClientOptions` `_ccOpenBulkImport` |
| SMM | `_smApprovalSummary` `setSmMode` |
| Workload | `wlAddDays` `wlWeekMondayISO` |
| Misc | `_filmsParseSheet` `_kasperIsReviewMounted` `_tplViewLink` `generateBrief` `mBlockDiff` `setGainMode` |

Repro: a name-occurrence scan (count `\bNAME\b` matches in `index.html`; flag names appearing
once). Next audit chunks: duplicate literals,
`console.log` left in prod paths, inconsistent status-string handling, and large inline handlers.
