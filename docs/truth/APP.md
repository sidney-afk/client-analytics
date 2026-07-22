# App logic (`index.html`) — current truth

> Last verified: 2026-07-22 @ 3d8bbfb + Workload Creative read-only plan candidate
> (live plan-date backend remains unchanged until the exact function source is manually deployed)
> Seeded from the 2026-07-05 logic audits (`docs/audits/2026-07-05-logic-*.md`); grown in
> place by the ongoing deep audit. Symbols named here are drift-checked by
> `test/truth-sync.js`.

## Shape

One ~45.8k-line single-file SPA. Major surfaces: content calendar, samples (SXR + legacy),
three review flows (client / Kasper / SMM), the visible Linear mirror/work surface (internal
`production`, `#production`, `?prod=1`), the visible Submit form (internal `linear`, `#linear`),
onboarding funnel, sales intake, filming plans, thumbnails tooling, SMM weekly reports, TikTok pilot.

## Release and stale callers

- The current app-update banner is advisory, not a caller-expiry control (F127). Direct `?prod=1`
  skips it; clean onboarding aliases probe a 404 path; a cached old document can adopt the first
  newer ETag/Last-Modified response as its baseline; and dismissal keeps that old code running.
- The page embeds no immutable running build/auth-authority epoch, protected requests carry none,
  and servers do not return `upgrade_required` before mutation. Build-population telemetry is absent.
  Go-live therefore requires a fixed same-origin manifest plus server minimum-build/epoch enforcement,
  with owner-defined optional versus mandatory release behavior and draft/queue-safe reauthentication.

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
  label and opened Linear context; Workload does not emit hover-triggered `title` or `data-tip`
  tooltips.
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
  display-only **Plan only** / **Plan + deadlines** preference.
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
  represented item has a deadline in the same band; mixed or missing deadlines show no group-level
  proximity marker. Expanded due/buffer copy is plain text with the same dot rather than a bordered
  pill.
  Native Linear Priority is not shown or used by Workload. Exact `2× Workload` / `3× Workload`
  labels appear as compact badges on the affected videos and as summaries on collapsed groups.
- The persistent **Plan only** / **Plan + deadlines** segmented control sits beside the client
  filter and defaults to **Plan only**. Deadline mode is Week-only: enabling **Plan + deadlines**
  switches to Week and disables Month until **Plan only** is restored. Week is always the
  Monday-anchored five-column Monday-Friday range. Manual plan days and deadlines on Saturday or
  Sunday are never moved or hidden from truth: a compact weekend notice beside the calendar opens a
  tray with the affected items and dates. A full-width, team-accented editor banner owns each set of
  five daily capacity totals and its relationship rows. Each editor/client plan group stays in one
  aligned row,
  with straight lines to outlined due-date endpoints. Different deadlines split into separate
  endpoints; work due on its planned day stays on the solid plan chip with a same-day marker rather
  than a duplicate. Due endpoints are display-only references and never add to capacity.
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
  Native events are written, and loader/renderer helpers exist, but no runtime call loads or displays
  them; detail shows Comments only (F138).
- Creative policy is same-team-wide and checks next status without current status or assignee, so it
  can regress reviewer/terminal work or mutate peer work after a flip (F37/F136).
- Video delivery/source data is collapsed from four typed fields to one priority winner labelled
  “Delivered file”; filming plan/raw footage can be hidden or mislabeled (F137).
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
