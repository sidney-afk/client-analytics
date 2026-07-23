# App logic (`index.html`) — current truth

> Last verified: 2026-07-23 @ f781add (docs-only audit rebase; product source unchanged from
> Production/Graphics audit base `1e7c0fd`) + integrated boot-audit vault through F199 +
> Production/Graphics audit through F205. The F176/F179 overnight-runner containment is isolated in parked draft
> #908 by owner decision and does not block the client-entry product fix; do not expand or reopen
> that containment scope here. The client verifier v28 and matching #891 browser are live. The
> Workload Creative/list-write candidates and F27 operator
> toolkit retain their current deliberate-manual/no-live-change boundaries.
> Seeded from the 2026-07-05 logic audits (`docs/audits/2026-07-05-logic-*.md`); grown in
> place by the ongoing deep audit. Symbols named here are drift-checked by
> `test/truth-sync.js`.

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
- Comment truth remains split across card JSON and normalized rows (F43). Canonical persistence must
  succeed before any Linear/mirror side effect; a failure keeps the draft/queue with visible retry,
  and retry must produce exactly one canonical mutation plus exactly one applicable mirror intent
  while mirroring is enabled; retired mode produces zero mirror/outbox intents. Production's legacy lane
  has no Reply action/`parent_id` send path (the Phase-2 gateway lane for enrolled clients does send
  `parent_id` in comment payloads) and client links do not read Client-visible normalized rows.
- Kasper keeps Review Session, Samples, Messages, and Filming Plans in a stable priority row. Editors
  and Time Off sit under **Team** in an accessible More menu; Sales Intake, Onboarding, and Client
  Credentials sit under **Pipeline & Admin**. The active More destination replaces the generic label,
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

- Workload reads the Linear-backed `workload_issues` mirror. Candidate source adds one isolated
  `workload-linear` boundary: every staff role may read exact deadline/weight metadata, while only
  Admin/SMM may update a sub-issue's Linear due date. The candidate is not live until both the
  Creative-readable `workload-plan` source and new `workload-linear` source are manually deployed
  and read back from the exact merge SHA.
- Dated work without a saved manual override gets one deterministic, item-local automatic work day:
  one working day before its Linear deadline, floored to today. A saved manual `plan_date` wins.
  There is no queue-wide ASAP packing, capacity spill, or hidden overflow row. Because each automatic
  day depends only on that issue's deadline and today, newly urgent work never repacks existing
  automatic placements; any resulting overload remains visible for a person to resolve.
- Capacity is 4 video workload units / 15 graphics items per editor per day as a warning only.
  An exact Linear `2× Workload` or `3× Workload` label makes that video consume two or three
  units; an unlabeled video consumes one. If both exact labels exist, three wins. Label weights
  affect capacity/overload and workload ranking, never silently repack an automatic plan. Each editor block
  owns the only red over-capacity signal. The date keeps its normal background, border, number
  color, and shadow, and every item remains available instead of spilling or hiding.
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
- Assigned active work with neither an internal work day nor a due date stays off the calendar and
  appears in **Needs a work day or deadline**. An undated issue with an explicit plan day does enter
  the calendar. Past-due assigned work without a manual plan stays off the calendar and enters
  **Overdue**. A manually pinned past-due issue stays on its exact work day and also appears in
  **Overdue**; past-due In-progress work also remains visible in **In progress now**. `Tweak Needed`
  / `Tweaks Needed` remains an exclusive strip and never enters the calendar or either overlapping
  status strip, even when it retains a due date or saved plan override.
- **Overdue**, **In progress now**, and **Tweaks needed** render before the intact period/filter
  toolbar, default collapsed, and remember each browser's expanded sections. The toolbar remains
  directly above the Work-day calendar. **Needs a work day or deadline** renders at the bottom,
  after the calendar and **Needs assignment**.
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
  intentionally disabled. **As of** shows the mirror watermark rather than browser request time.
  Because an unchanged mirror cursor intentionally performs no projection reads, a plan-only change
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
  day. The branded date control in that popover now edits the Linear due date through
  `workload-linear`; changing that deadline rederives only an automatic work day, while an explicit
  manual pin stays unchanged. Creative sees the same value in a disabled control.
- Calendar chips and expanded issue rows use quiet sparkle/pin icons for automatic/manual placement;
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
  and place the branded Linear due-date picker plus optional automatic-plan reset on one compact
  row. Tweaks popovers retain their existing
  comment and Frame reminder layout.
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
  after the exact function source is manually deployed. Its Linear due-date control remains visibly
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
  active issue/client before Linear, require an exact issue/date acknowledgement, and then make a
  2.5-second best-effort mirror update. A pre-commit failure reverts and notifies; once Linear has
  confirmed the commit, a zero-row/timed-out mirror update stays successful with
  `mirror_pending=true`, keeps the new date in the browser, and warns that Workload is catching up.
- **Deployment boundary:** effective live table/grant readback matches the locked 2026-07-19
  sidecar contract, and `workload-plan` v2 remains a deliberate-manual deployment. This candidate
  adds one new deliberate-manual `workload-linear` function and browser caller; it changes no
  schema, migration, table grant, runtime flag, n8n workflow, frozen writer, or real data. Nothing
  is live until the reviewed merge and an exact-SHA manual function deployment/readback/TEST drill.
  A Pages-only revert removes the caller and restores the prior Workload display without changing
  saved plan data or Linear. If the function was deployed, retiring it is a separate captured
  operation. F147 keeps the exact plan-sidecar revoke-correction artifact provenance open, and
  #884's server-atomic batch contract remains open.

## Linear sync surface

- Every consistency surface (status/assignee/due/name/comments), outboxes, flags:
  `docs/audits/2026-07-05-logic-sync.md`; current sync reality: `docs/truth/LINEAR.md`.
- The password-bypassed `?intake=1` page and both live intake webhooks likewise carry no caller
  identity (F91). Containment/authentication is a current gate, not deferred B5 cleanup.

## Linear mirror tab (internal `production`; `#production`; `?prod=1`)

- Visible top-nav label is **Linear**; the internal module/key remains `production`. #812's
  status/comment/due/assignee controls are deployed through `production-write`, but authority
  remains Linear/Linear, so real-team rows render read-only while the bounded private TEST override
  can write. Human cutover is blocked by the audit register; this is not a future unwired preview.
- A protected-write 401 becomes toast copy only: Production does not clear/reverify the staff session,
  open sign-in, preserve/replay the action after fresh authorization, or otherwise recover (F10).
- F94: manual assignment is not eligibility-safe yet. The picker/server accept any active same-team
  roster row and do not preflight compatible creative role plus usable Linear mapping before the
  native commit. This remains a first-flip blocker even though the control is deployed.
- F95: operational data loads at mount and on focus/visibility/pageshow return; the repeating timer
  refreshes only authority. There is no operational realtime/poll fallback or ordinary Refresh
  control, so a continuously foreground Production tab can remain stale indefinitely.
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
- Creative policy is same-team-wide and checks next status without current status or assignee, so it
  can regress reviewer/terminal work or mutate peer work after a flip (F37/F136).
- Video delivery/source data is collapsed from four typed fields to one priority winner labelled
  “Delivered file”; filming plan/raw footage can be hidden or mislabeled (F137).
- The 2026-07-23 full-day audit is findings-only and changes no runtime. Ratified target scope now
  includes real label display/set with exact Workload labels (F201), parent/sub-issue description
  writes (F202), and native parent/sub-issue creation with zero implicit Calendar linkage (F203).
  Production currently implements none of those write contracts.
- F200 is distinct from F145: the real parent link resolves correctly, but each row independently
  renders its persisted `client_slug`. Read-only aggregate proof found 72 of 4,600 render-eligible
  mirror rows `unattributed` (70 missing-project ambiguous; two hierarchy-attribution failures;
  zero provably deliberate internal/TEST). Linear project names must not create clients; the active
  SyncView roster is the sole client catalog. All current rows must be classified; future unknowns
  need visible repair state.
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
