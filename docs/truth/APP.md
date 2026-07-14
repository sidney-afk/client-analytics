# App logic (`index.html`) — current truth

> Last verified: 2026-07-14 @ 1ce7c91 + live topology/persona readback
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
- Status pills require a linked Linear sub-issue ("Link a Linear sub-issue first").
- `?v2=0` is **not writable rollback** (F125): it selects Sheet reads while full-roster
  upsert/reorder routing still targets Supabase-only Edge Functions. Normal Supabase-read failure
  automatically selects the same Sheet fallback. Either state must remain read-only until one
  coupled recovery authority exists.
- Drive-file thumbnails are rendered from the final `lh3.googleusercontent.com/d/<id>` host, with
  persisted `thumb_rev` in the actual browser cache key. Calendar adopts a newer server revision
  across cache/LWW guards and advances existing image nodes on realtime without waiting for a hard
  refresh or a focused-field repaint.
- Cards with a single thumbnail expose a lazy **Compare** action. It calls the protected
  `thumbnail-revision-read` Edge Function for that exact surface/client/card and displays signed
  Previous/Current snapshots when a changed pair exists. Staff without a verified roster identity
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
  advancement, and protected lazy Previous/Current comparison. The comparison action appears only
  for a single rendered thumbnail; Drive folders and media-less cards do not advertise a pair.

## Reviews (client / Kasper / SMM)

- The three flows as state machines + transition table:
  `docs/audits/2026-07-05-logic-reviews.md`.
- Linear comments are written prefixed `**{Reviewer} (via SyncView):**`.
  That display name is cosmetic on the legacy bridge and does not establish the caller (F91).
- Comment truth remains split across card JSON and normalized rows (F43). Canonical persistence must
  succeed before any Linear/mirror side effect; a failure keeps the draft/queue with visible retry,
  and retry must produce exactly one canonical mutation plus exactly one applicable mirror intent
  while mirroring is enabled; retired mode produces zero mirror/outbox intents. Production currently
  has no Reply action/`parent_id` send path and client links do not read Client-visible normalized rows.
- Kasper's eight-tab strip is not contained or semantically keyboard-operable at 390/768 px; later
  and deep-linked tabs require whole-page horizontal panning (F121). A failed shared Review/Messages
  cold load leaves Messages on an indefinite skeleton, and Review renders no Retry (F130).
- Calendar/SXR review cards use the same persisted revision cache key as the editing strips, so a
  server or scanner bump replaces collapsed thumbnails, graphic previews, and backdrop images even
  while a comment field defers the full card rebuild. The comparison dialog is modal, Escape/focus
  managed, desktop side-by-side, and narrow-screen stacked.

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
- The present Production polish visual lanes are a P0 distribution blocker (F122): they make
  unmocked live reads and upload screenshots/DOM manifests through public Actions, with optional
  Argos delivery. Keep visual publication off until all reads are intercepted with fictional data
  and the exact archives pass recursive privacy tests.
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
| Linear mirror (internal `production`; `?prod=1`) — **check active prod sprint before touching** | `_prodById` `_prodClientEmoji` `_prodIsBatchParent` `_prodOpenBatch` `_prodSetFocusCard` `_prodSetTeam` |
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
