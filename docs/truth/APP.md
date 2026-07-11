# App logic (`index.html`) — current truth

> Last verified: 2026-07-11 @ ae8a492
> Seeded from the 2026-07-05 logic audits (`docs/audits/2026-07-05-logic-*.md`); grown in
> place by the ongoing deep audit. Symbols named here are drift-checked by
> `test/truth-sync.js`.

## Shape

One ~44k-line single-file SPA. Major surfaces: content calendar, samples (SXR + legacy),
three review flows (client / Kasper / SMM), Production tab (`?prod=1`), onboarding funnel,
sales intake, filming plans, thumbnails tooling, SMM weekly reports, TikTok pilot.

## Calendar

- End-to-end logic map: `docs/audits/2026-07-05-logic-calendar.md` (evidence);
  write path + contract: `docs/truth/SUPABASE.md`.
- Status pushes to Linear go through `_calPushStatusToLinear()` — **no guard** on
  Posted/Scheduled (they ARE pushed; a stale code comment claims otherwise).
- Status pills require a linked Linear sub-issue ("Link a Linear sub-issue first").

## Samples (SXR + legacy)

- Logic map: `docs/audits/2026-07-05-logic-samples.md`.
- SXR rejects pushing Scheduled/Posted to Linear (unlike calendar).
- `_sxrReassertLinearStatus()` is **defined but never called** (dead drift-protection);
  with the samples reconciler likely off (see `docs/truth/N8N.md`), SXR's only protections
  are a 5-minute local-fresh merge guard.
- SXR writes `kasper_finish_log` which is silently dropped server-side
  (see `docs/truth/SUPABASE.md`).

## Reviews (client / Kasper / SMM)

- The three flows as state machines + transition table:
  `docs/audits/2026-07-05-logic-reviews.md`.
- Linear comments are written prefixed `**{Reviewer} (via SyncView):**`.

## Linear sync surface

- Every consistency surface (status/assignee/due/name/comments), outboxes, flags:
  `docs/audits/2026-07-05-logic-sync.md`; current sync reality: `docs/truth/LINEAR.md`.

## Production tab (`?prod=1`)

- Read-only in-app Linear mirror; **guarded read-only by design** — no writes until a
  milestone explicitly enables them (Track B4).
- Boot does a lightweight parallel select of `clients`/`team_members`/`batches`/
  `deliverables` (plus `deliverable_events`).
- Design source of truth is the locked kit in `docs/syncview-design/`; UI changes must pass
  `npm run test:prod-polish`. Deep-links: `?prod=1`, `team`, `view`, `client`, `d` params.
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
| Production tab (`?prod=1`) — **check active prod sprint before touching** | `_prodById` `_prodClientEmoji` `_prodIsBatchParent` `_prodOpenBatch` `_prodSetFocusCard` `_prodSetTeam` |
| Samples/SXR | `_sxrReassertLinearStatus` `_sxrReorderUrlForClient` `_sxrSetAllSettable` |
| Onboarding | `_obAddCreatorRow` `_obToggle` `_obvToggle` |
| Market-research tab (looks unwired) | `_mrHookBadge` `renderMRTab_landscape` `renderMRTab_topics` |
| Client credentials | `_ccKnownClientOptions` `_ccOpenBulkImport` |
| SMM | `_smApprovalSummary` `setSmMode` |
| Workload | `wlAddDays` `wlWeekMondayISO` |
| Misc | `_filmsParseSheet` `_kasperIsReviewMounted` `_tplViewLink` `generateBrief` `mBlockDiff` `setGainMode` |

Repro: a name-occurrence scan (count `\bNAME\b` matches in `index.html`; flag names appearing
once).

### F2 `[wontfix — audited clean]` — Linear status-string quirks are defended in the frontend

The audits flag Linear's char-exact status hazards (trailing space `"Tweak Needed "`, case
`"For Client Approval"` vs GRA `"For Client approval"`) as a standing footgun. **Verified
2026-07-11: `index.html` handles them correctly.** Every consumer of Linear-sourced status
normalizes through a trim+lowercase helper before comparing:
- `wlNormStatus()` (`(sub.status||'').trim().toLowerCase()`) feeds `wlIsTweaksNeeded()`,
  `wlIsToDo()`, `wlIsActiveStatus()` — the workload-mirror panel.
- `_kedNorm()` (same normalization) feeds the whole `_ked*` editor-delivery module.
Both modules carry comments showing the authors know about the quirks. The GRA lowercase
variant never appears as a literal in the code precisely because matching is
case-insensitive. **No FE action needed.** Residual risk is backend-only (the n8n
`linear-set-status` mapping does char-exact matches) — already tracked in `docs/truth/N8N.md`
and `docs/truth/LINEAR.md`; not verifiable from this repo.

### F3 `[wontfix — audited, latent fragility noted]` — duplicate static DOM ids are exclusive-render, not runtime collisions

Seven static `id="…"` literals repeat in `index.html` and are read via `getElementById` (which
returns only the first DOM match). Investigated 2026-07-11 — all repeats are **mutually-exclusive
render paths**, so only one instance is ever mounted:
- `calSelectArchive` — a 3-way ternary producing a single action button.
- `prodFilterBtn` / `prodGroupBtn` — one copy each in `_prodTopbar` vs `_prodProjectTopbar`
  (board view vs project view; never mounted together).
- `calImportErr` / `calImportGo` — one copy per import-wizard step
  (`_calRenderImportPick` / `_calRenderImportSheetPick` / `_calRenderImportMap` /
  `_calRenderImportSelect`; the wizard shows one step at a time).
- `calView`, `briefViewContainer` — one copy per tab render (client-view vs cal-tab-view).

**No confirmed bug.** Latent fragility: correctness depends on the "only one branch mounted"
invariant, which nothing enforces — a future change that co-mounts two of these render functions
would make `getElementById` silently target the wrong element (e.g. an error would render into an
off-screen wizard step). Cheap defense if it ever bites: scope these to `class`+`closest()` or
suffix the id per branch. Not worth changing preemptively.

### F4 `[wontfix — audited clean]` — every `JSON.parse` is guarded (no crash-on-corrupt-data)

Checked all **86 `JSON.parse` call sites** in `index.html` (2026-07-11) for the classic
crash-on-corrupt-persisted-data bug. **All are guarded** — inline `try{…}catch`, or a
`|| '{}'`/`|| 'null'` null-default *inside* an enclosing try/catch, or a wrapping block whose
`catch` sits further down the function. A window scan surfaced 6 apparent unguarded sites
(7066, 7396, 7588, 19068, 20071, 40516); each was verified to have a matching enclosing
`try`/`catch` (the catch was just outside the initial window). Persistent-state hydrators
(`_analyticsHydrateFromCache`, `_calArchivedReadRaw`, `_calHydrateLinearMeta`,
`_kasperHydrateCache`) additionally `typeof`/shape-check the parsed object and TTL-expire it.
**No action.** Convention for new code: read persisted JSON through the same
try/catch + shape-check + default pattern; don't rely on `|| '{}'` alone (it defends null, not
malformed JSON).

### F5 `[open — low severity, owner fix]` — two `try{ fetch }catch` sites can't catch the network rejection

**Owner decision — 2-char safe fix.** In the caption-job poller, two best-effort backend
stand-down POSTs are written as `try { fetch(CAPTION_JOB_UPDATE_URL, {POST…}) } catch {}` at
`index.html` lines **26171** and **26189**. A `try`/`catch` wrapped around an **un-awaited**
fetch only catches synchronous throws — it does **not** catch the promise rejection. So on a
network/offline failure the POST rejects with no handler → an **unhandled promise rejection**
(console noise, and false alarms for any `unhandledrejection` telemetry). Functionally these are
fire-and-forget by design (the job settles locally right after regardless), so this is
error-hygiene, not data loss.

**Fix (safe, matches the codebase's own pattern):** append `.catch(()=>{})` to each fetch, exactly
as the onboarding-fallback POST at line **16024** already does
(`fetch(ONBOARDING_FALLBACK_URL, {…}).catch(function(){})`). The outer `try` can stay or go.
Not applied autonomously — it's a behavior-adjacent `index.html` edit; flagged for owner sign-off.

Rest of the async-write surface audited clean: caption-cancel (`_calCapJobCancel`, 26215) has a
rollback `.catch`; log-linear-submission (29667) is intentional fire-and-forget with `.catch`;
`_sxrReorderFetch` (33940) returns its promise to the caller; the update-nudge HEAD poll (44786)
and thumbnail-folder resolve (23605) both end in `.catch`. Read fetches use
`Promise.allSettled`/`.then` with error handling.

### F6 `[wontfix — audited clean]` — number/date parsing is safe

Checked `parseInt`/`Number`/`new Date` for the usual footguns (2026-07-11). **Clean:**
- 16 `parseInt` calls, ~10 without an explicit radix — but every one reads an **app-controlled
  numeric string** (dataset attributes the app sets itself, `getComputedStyle` `px` values,
  regex capture groups). None take `0x`-prefixed input, so the missing radix is inert in modern
  JS (base-10 default). Adding radix would be lint-tidy, not a bugfix.
- No `new Date(arg).toISOString()` sites (the `RangeError`-on-invalid-date crash pattern). The
  80 `.toISOString()` calls run on `new Date()` (current time) or provably-valid derived dates
  (e.g. `_kasperHistoryDayLabel`'s `yest = new Date(); yest.setDate(-1)`). No action.

### Audit pass summary — 2026-07-11

One session, six findings. **Actionable for the owner:**
- **F1** `[open]` — 35 dead-code candidates, triage-per-group (the `_prod*` set may be active
  Production-sprint work; confirm before deleting).
- **F5** `[open, low]` — two `try{ fetch }catch` sites (lines 26171 / 26189) leak an unhandled
  rejection on network failure; trivial `.catch(()=>{})` fix matching the pattern at line 16024.

**Audited clean (recorded so they are not re-investigated):** F2 status-string quirks (normalized
everywhere), F3 duplicate DOM ids (exclusive-render), F4 all 86 `JSON.parse` guarded, F6
number/date parsing.

Remaining lower-yield backlog for a future pass: duplicate string literals, large inline event
handlers, and (owner-decision) whether to strip the 41 `console.log` debug statements.
