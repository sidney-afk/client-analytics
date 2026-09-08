⚠️ ⚠️  READ THIS BEFORE EXECUTING ANYTHING FROM THIS FILE  ⚠️ ⚠️

**333 lines across the six briefs are TRUNCATED MID-SENTENCE, and some of them are
owner-executable migration and rollback steps.** This is a defect in how the briefs
were generated: the scoping workflow that produced them capped each field at a fixed
character budget (clusters at 254, 264, 315, 329, 331 and 705 characters), and the
clipped text was never restored. Codex found it on 2026-09-08; nobody had noticed.

Real examples from this set: a prohibition that ends at `Never apply
2026-09-05-native-only-intake.sql ` without saying what to do instead, and a rollback
that ends at the incomplete identifier `dropping production_`.

**The rule, and it is not optional: if a line stops mid-sentence, DO NOT EXECUTE IT
and do not guess the rest.** Go to the source it names — the migration file, the
workflow, `docs/ops/`, `EXECUTION_LOG.md`, `ROLLBACK.md` — and re-derive the full
instruction there. A truncated `undo:` is the worst case, because it reads like a
complete recovery procedure and is not one.

These briefs remain useful as a map of what each lane covers and where to look. They
are NOT safe as a runbook until the clipped fields are restored.

### RESTORATION PASS, 2026-09-08 (lane LX-RESTORE) — read this before you trust a line below

The **executable** clipped lines in this file have been restored: the
`- [migration]`, `- [edge-function-deploy]`, `- [runtime-flag]`, `- [other]`,
`- [n8n-edit]`, `undo:` and `mitigate:` lines inside LIVE ACTIONS and RISKS.
Nothing else has been. The other clipped fields (`why:`, `confirmed:`,
`where:`, `lift:`, evidence, and the `[A1]`/`[B1]`-style work-item lines) are still
truncated, so the warning above stands and this file is still NOT a runbook.

**How to tell a restored line from an original one.** Every restored line ends
with a bracketed marker naming the date and the primary source it was
re-derived from:

> `**[RESTORED 2026-09-08 · source: …]**`

A line with that marker has been checked against the source it names. A line
without one has not been checked by this pass at all — it is either untouched
original text or one of the ~284 clipped fields still owed.

**Restored does not mean the original text was right.** The generating
workflow's output is gone, so nothing here is a recovery of what was written;
each line was re-derived from the repository. Where a source CONTRADICTED the
surviving fragment, the restored line says so in bold and does not smoothly
continue the false sentence. Where a procedure could not be established from
any primary source, the line says that too, in those words, instead of
supplying a plausible one — an honest gap is safe and a guess is not.

**This file: 10 executable lines restored, 0 left unrestored.** Three of them
are `- [n8n-edit]` lines, which are outside the field set this pass was scoped
to; they were restored anyway because they are owner-executed, and each says so
in its marker. Two carry corrections: the "four Linear-only n8n workflows" list
is SIX workflows and one of them is F48's still-open `webhook/editors-week`,
and one clause about `log-linear-submission` could not be established and is
marked unknown rather than completed.


---

SESSION NAME: LX-C Endpoints and Submit
KEEP THIS EXACT SESSION TITLE. Do not rename it. The owner tracks six parallel sessions by title.

SESSION NAME: LX-C Endpoints and Submit
Keep this exact session title. Do not rename it. The owner tracks parallel sessions by title.

You are ONE of six parallel sessions removing Linear from SyncView before Linear
access ends on 2026-09-15. Today is 2026-09-07. A coordinator session owns merge
order and the ledger; you own exactly one lane and nothing else.

YOUR BRANCH: claude/lx-c-endpoints   (create it from origin/main, push there, never elsewhere)

READ FIRST, IN THIS ORDER:
1. AGENTS.md (house standard, outranks CLAUDE.md)
2. CLAUDE.md
3. docs/independence/LINEAR_EXIT_LANES.md  <-- the lane map. Your lane, your files, your boundaries.
4. The lane brief below.

THE OWNER'S ONE RULE, above everything: do not break the client lifecycle.
Clients approve posts and request changes through anonymous tokenless links.
Those must keep working, unchanged, at every point in your work.

HARD BOUNDARIES
- Touch ONLY the files listed as yours in LINEAR_EXIT_LANES.md. If you need a file
  another lane owns, STOP and write the need into the ledger instead of editing it.
- index.html is one 79k-line file that every lane touches. Stay inside your named
  functions. Never reformat, never reflow, never "clean up while you are here".
- Merging to main deploys the live site instantly. You do not merge. You open a PR
  and stop. The coordinator merges.
- calendar-upsert and sample-review-upsert must stay tokenless. Never deploy the
  repository copies of those writers as-is.
- Never edit an n8n workflow unless your brief explicitly authorizes that specific
  workflow. Export its JSON to the private Drive backup first and commit only a
  public-safe status stub to n8n-backups/.
- The repo is PUBLIC. No secrets, tokens, client display names, share-link tokens,
  or private file URLs in code, comments, commits, tests or CI output. Client slugs
  are fine. Prefer counts over names.
- Mutate only the test client `sidneylaruel` unless the owner names another.
- Additive-only SQL. No DROP, no RENAME, no type changes.

THE LEDGER IS NOT OPTIONAL
docs/ops/OPEN_REPAIRS.md is the ledger. Append, never rewrite. Before you push,
add an entry for anything you learned, deferred, or deliberately did not do,
including work you decided was out of scope. The owner reads this file. A thing
that is not in the ledger did not happen. Check for duplicate `## N.` headers
after any merge; concurrent branches routinely claim the same number, so take the
next free number at the moment you write, and if you collide, renumber yours.

PROOF BAR
- `npm test` is the full offline suite and takes several minutes. Run it before you push.
- `npm run test:prod-polish` CANNOT pass in this sandbox (no route to the live
  backend); all 8 lanes fail identically on origin/main. Verify against main before
  calling anything a regression.
- Add a test for every behavior you change. A change with no test does not land.
- Do not claim a live system state you did not read. If you could not verify it,
  say so in the PR body.

WHEN YOU FINISH, OR WHEN YOU ARE BLOCKED
Push, open a DRAFT PR titled `LX-C: <what it does>`, and in the body state:
  - what is done and proven, with the test names
  - what is NOT done
  - every live action the owner must take (migration, deploy, flag, n8n edit),
    each with its exact undo
  - anything you found that belongs to another lane
Then stop. Do not merge. Do not start another lane's work.


=== YOUR LANE: C ===
BRANCH: claude/lx-c-endpoints
MERGE POSITION: 5th. Largest destructive index.html surface; you merge last among browser lanes so every other lane has already landed.

GOAL
By 2026-09-15 no browser code path in index.html reaches an n8n webhook that talks to Linear: Submit creates work only through production-write, urgent pings dispatch natively, the editors-week panel is rebuilt on public.deliverable_events, and the remaining eight Linear-bridge webhook call sites are either natively served or deleted — with the one non-Linear webhook of the ten (log-linear-submission, a Google Sheet fallback log) deliberately kept.

DONE WHEN
  - `grep -c 'webhook/linear-issues\|webhook/linear-issue-statuses\|webhook/linear-projects\|webhook/linear-subissues\|webhook/linear-set-status\|webhook/linear-add-comment\|webhook/linear-tweak-comments\|webhook/editors-week\|webhook/send-urgent-slack\|webhook/video-form\|webhook/graphic-form' index.html` returns 0 (log-linear-submission is the only survivor of the eleven constants)
  - `docs/truth/ENDPOINTS.md` updated in the same commit so `node test/truth-sync.js` passes (it re-derives the webhook set from index.html by grep and fails on drift)
  - Workload ↻ (`wlManualRefresh` → `wlLoadSnapshot(true)` → `loadLinearIssues(true)`, index.html:16542/15337/14563) no longer has a live-Linear path: force refresh reads `workload_issues` (or the native view) and the `LINEAR_ISSUES_WEBHOOK` fallback branch at index.html:14561-14570 is gone
  - Submit for an UNENROLLED client, a client whose `write_ui_reroute_clients` read failed, or a browser holding a stale `LINEAR_RECEIPTS_KEY` no longer reaches `video-form`/`graphic-form`: `_submitLinearFormRoutedOnce` (index.html:47584) has no `_submitLinearFormLegacy` exit that performs a network create
  - The client-link project dropdown still populates with `linear-projects` dead: `fetchLinearProjects` (index.html:13911) fetches `clients` unconditionally, not only when `_writeUiRerouteClients.size` is non-empty (index.html:13938)
  - URGENT button works end-to-end on a native card: PR1341's four callers dispatch `native_urgent_dispatch`, `NATIVE_URGENT_HANDOFF_ENABLED/URL/KEY_HEX` are set on production-write, the dedicated `native-urgent-video` n8n root is installed with its jwtAuth credential, and one scoped real delivery drill posts to #video-editing
  - Kasper's editor panel renders per-editor last-week numbers with zero Linear dependency, from `public.deliverable_events` (from_status/to_status/ts, installed by migrations/2026-07-06-b1-linear-data-model.sql:87, anon-readable per its policy at line 683)
  - `window.peekLinearOutbox()` retry queues that target `linear-set-status`/`linear-add-comment` (index.html:32358, 67890) are drained or cleared before those endpoints are removed, so no browser retries into a dead URL forever
  - Import from Linear and Bulk-link dialogs no longer fire `linear-subissues` on open (index.html:33738, 34015) — the whole already-sealed feature is removed rather than left fetching before refusing at Apply (index.html:33875, 34186)
  - The n8n workflows named in `work_items` are edited only after a private export + version-id capture, and each edit's restore version id is written into `n8n-backups/` as a public-safe stub per ROLLBACK.md rule 2

ALREADY BUILT — LIFT THESE, DO NOT REBUILD
  * Submit already routes enrolled clients natively. `_submitLinearFormRoutedOnce` picks `production-write` `intake_create` for any client in the `write_ui_reroute_clients` allowlist and only falls back to `_submitLinearFormLegacy` (video-form/graphic-form) for a stale F44 receipt, a missing routing helper, or an unenrolled/failed flag read.
    where: origin/main, index.html:47584-47700 (router), :47340 (legacy `_submitLinearFormOnce`), :47060 `_linearTargetForTeam` maps team→VIDEO_FORM_WEBHOOK/GRAPHIC_FORM_WEBHOOK
    confirmed: sed -n '47584,47700p' index.html — read the whole router; `useGateway = pendingNativeIntake ? true : await _writeUiRerouteUseGatewayWhenReady(...)`, then `if (!useGateway) return _submitLinearFormLegacy(mode);`
    lift: Nothing to lift — it is already on main. Lane C's job is to REMOVE the three surviving legacy exits, not to build the native one.
  * Candidate hardens that same router: a pending NATIVE intake receipt now outranks a legacy F44 receipt, and unreadable recovery storage returns a visible `submission_recovery_unreadable` hold instead of silently choosing legacy.
    where: 5bcc03bd (draft PR 1326), index.html `_submitLinearFormRoutedOnce`; proof in test/submit-owned-intake-routing.js (new file, 76 lines)
    confirmed: git show 5bcc03bd…:test/submit-owned-intake-routing.js — 16 groups incl. 2 pinned base counterexamples; it extracts the real `_submitLinearFormRoutedOnce` via vm and asserts route order ['routing','native-auth'] for enrolled and ['routing','legacy:both'] for unenrolled
    lift: Lift the `_submitLinearFormRoutedOnce` hunk + test/submit-owned-intake-routing.js as a pair. It is a self-contained selector change with an offline test; it does not depend on the candidate's 15 migrations.
  * A prepared, offline-generated n8n edit that makes video-form/graphic-form FORWARD to the native gateway instead of creating Linear issues — replaces exactly two Submit entry edges in VIDEO PRODUCTION AUTOMATION, preserving the F44 team/payload_hash/receipt_key/idempotency_key identity that old browsers still send.
    where: 5bcc03bd: scripts/n8n-f44-native-adapter.js (93 lines) + scripts/n8n-native-card-adapter.js (129 lines) + test/n8n-f44-native-adapter.js (42) + test/n8n-native-card-adapter.js (45) + docs/ops/LEGACY_INTAKE_NATIVE_COMPATIBILITY.md
    confirmed: git show 5bcc03bd…:scripts/n8n-f44-native-adapter.js | head -45 — header comment 'Offline only. Replace exactly two Submit entry edges; no API or activation.'; ENTRIES={video:{path:'video-form'},graphics:{path:'graphic-form'}}; it re-derives the browser response validators out of index.html and hard
    lift: Usable as-is, but it is a GRAPH GENERATOR, not an installed edit: it pins `SOURCE_BASE='2fdf2b8a…'` and asserts `VALIDATORS_SHA` against the current index.html, so any index.html change in this lane will break its assertion until the SHA is re-pinned. Run it against a fresh private capture and re-pin.
  * PR1341 native urgent dispatch: a complete `native_urgent_dispatch` action on production-write (exact 6-field body, staff-only, re-reads the whole snapshot after signing, HS256 JWT with purpose/aud/jti/iat/exp/body_sha256, one 5s POST, no retry) plus all FOUR staff URGENT callers wired to it, nine failure-code messages, and a local delivery hold.
    where: 672cb509 (PR 1341, branch codex/native-urgent-dispatch-20260907). supabase/functions/production-write/index.ts:3805-3850 `handleNativeUrgentDispatch`, :8240 dispatch; index.html `_calUrgentSlackDispatch` + `_calSendUrgentSlack`/`_sxrSendUrgentSlack`/`_kasperSendUrgentSlack`/`_sxrKasperSendUrgentSlack`; docs/ops/NATIVE_URGENT_HANDOFF.md
    confirmed: git diff 5bcc03bd…672cb509 -- index.html (read in full, all four callers changed); git show 672cb509:supabase/functions/production-write/index.ts | sed -n '3760,3850p'; mcp github get_check_runs PR 1341 → 8 success / 2 skipped (production-polish-heavy + production-polish-interaction skip on PRs by d
    lift: Merge PR1341 as-is ONLY together with the config in `live_actions_needed`. It is candidate + urgent (git merge-base --is-ancestor 5bcc03bd 672cb509 = true), so merging it merges the whole 378-file parts bin; if lane C wants urgent alone, cherry-pick the 13-file delta.
  * The offline n8n receiver draft for the native urgent webhook: 9 added nodes on a private capture of the existing urgent workflow, jwtAuth Webhook 2.1, reuses the existing roster/email→Slack map/fixed channel/bot, no edge into the old provider lookup, exact inverse verifies preservation.
    where: 672cb509: scripts/n8n-native-urgent-draft.js (90 lines), test/n8n-native-urgent-draft.js (48), docs/ops/NATIVE_URGENT_N8N_DRAFT.md
    confirmed: git show 672cb509:docs/ops/NATIVE_URGENT_N8N_DRAFT.md — read in full; 31 synthetic groups; it explicitly states no credential created/bound, n8n not executed, no message sent
    lift: Run the generator against a fresh private capture (output must be outside the checkout), review `native-urgent.review.json`, then the owner installs it. The jwtAuth credential must be created by hand with HS256/passphrase = the same 64-char string as NATIVE_URGENT_HANDOFF_KEY_HEX.
  * `public.deliverable_events` — an INSTALLED, anon-readable, complete deliverable status-transition ledger (deliverable_id, batch_id, client_slug, ts, actor, role, action, from_status, to_status, source, payload) with a belt-and-braces AFTER INSERT/UPDATE trigger on `public.deliverables` that writes a `status_change` row with from_status/to_status whenever the RPC did not already write one.
    where: origin/main, migrations/2026-07-06-b1-linear-data-model.sql:87-110 (table+indexes), :240-289 `track_b_deliverable_ledger_guard` trigger fn, :683 anon select policy, :698 `grant select … to anon`
    confirmed: sed -n '87,130p;240,320p;675,700p' migrations/2026-07-06-b1-linear-data-model.sql
    lift: This is the native source for the editors-week replacement and nobody has to build it. `deliverables.status` values (in_progress, tweak, smm_approval, kasper_approval, client_approval, approved, posted) map 1:1 onto the existing `_kedIsWorkState`/`_kedReviewTarget`/`_kedIsTweakState`/`_kedIsFinishState` predicates at index.html:~79490 with only underscore normalization. Keep `_kedSplitVideos`/`_ke

WORK ITEMS
  [C1] (high risk, lift) send-urgent-slack → native: merge PR1341's urgent slice and configure it
     Bring in the 13-file delta 5bcc03bd…672cb509 (production-write `native_urgent_dispatch`, the four browser callers, nine WRITE_UI_FAILURE_CODE_TEXT entries, scripts/n8n-native-urgent-draft.js, three tests). BLOCKING HAZARD: the browser chooses the native branch whenever `post.video_deliverable_id` is non-empty (index.html `_calSendUrgentSlack` etc.), so on merge every native card STOPS using the working send-urgent-slack webhook. If NATIVE_URGENT_HANDOFF_ENABLED/URL/KEY_HEX are unset, production-write throws GatewayError(503,'native_urgent_not_configured') which serializes as `{ok:false,delivery:'not_sent',retry_safe:true}` (index.html:3848 of the EF) and the SMM sees 'Urgent alerts are not e
     files: index.html, supabase/functions/production-write/index.ts, scripts/n8n-native-urgent-draft.js, test/native-urgent-dispatch.js, test/native-urgent-ui.js, test/n8n-native-urgent-draft.js, docs/ops/NATIVE_URGENT_HANDOFF.md, docs/ops/NATIVE_URGENT_N8N_DRAFT.md
  [C2] (medium risk, new) send-urgent-slack: delete URGENT_SLACK_URL and its legacy branch after C1 is proven
     PR1341 keeps `URGENT_SLACK_URL` (index.html:22360) as the branch for cards with a linear_issue_id but no video_deliverable_id. Post-Sept-15 that branch can only fail, and it is also the reason the button still renders for Linear-only cards. Remove the constant, the `else resp = await fetch(URGENT_SLACK_URL, …)` arm inside `_calUrgentSlackDispatch`, and simplify `_calShowUrgent`(index.html:46409)/`_sxrShowUrgent`(:64870) to require `video_deliverable_id` only. Do this AFTER a real delivery drill on C1, not in the same commit.
     files: index.html, docs/truth/ENDPOINTS.md, test/calendar-urgent-badge.js, test/kasper-urgent-ping.js, test/urgent-ping-persistence.js
  [C3] (high risk, mixed) Submit: close the three legacy exits in _submitLinearFormRoutedOnce
     Lift the candidate's router hardening + test/submit-owned-intake-routing.js, then remove the remaining `_submitLinearFormLegacy` network exits: (a) stale `LINEAR_RECEIPTS_KEY` in localStorage (index.html:47589) — replace the F44 replay with a visible 'this submission predates the cutover, tell the owner' hold that surfaces the receipt_key, since replaying it after Sept 15 would POST to a dead video-form; (b) missing `_writeUiRerouteUseGatewayWhenReady` helper (:47595) — a partially-cached shell; make it hold rather than fall back; (c) `useGateway === false` (:47619) — an unenrolled client or a failed `write_ui_reroute_clients` read. For (c), decide with the owner whether Submit routes native
     files: index.html, test/submit-owned-intake-routing.js, test/linear-intake-receipt-contract.js, test/f44-linear-intake-transform.js, test/linear-submit-durability.js
  [C4] (high risk, new) Submit: delete VIDEO_FORM_WEBHOOK / GRAPHIC_FORM_WEBHOOK, _submitLinearFormOnce, _linearAwaitCreate and the Linear-polling card tail
     Once C3 lands, `_submitLinearFormOnce` (index.html:47340), `_linearAwaitCreate` (:47242), `_linearPrepareReceipts` (:47150), `_linearTargetForTeam` (:47059) and `_writeLinearVideoCardsToCalendar` (:48132) become dead. `_writeLinearVideoCardsToCalendar` is the loop that calls `loadLinearIssues(true)` up to 20×5s (index.html:48187) to discover freshly created Linear sub-issues — it is a second live consumer of `linear-issues`. It is ALSO resumed from persisted jobs in `syncview_calCardJobs_v1` (`_resumePendingCalCardJobs`, index.html:48386/48443), so a browser holding an old job will start polling a dead endpoint. Ship a one-time migration in `_resumePendingCalCardJobs` that terminates pre-cut
     files: index.html, test/f44-linear-intake-transform.js, test/linear-intake-submission-cap.js, docs/truth/ENDPOINTS.md
  [C5] (medium risk, new) linear-projects: make the native client list unconditional, then delete the webhook call
     `fetchLinearProjects` (index.html:13911) POSTs `LINEAR_PROJECTS_WEBHOOK` unconditionally, and only fetches native `clients` rows when `_writeUiRerouteClients.size || pendingNativeClientSlug` (:13938). `_linearRebuildProjectSource` (:13860ish) then overlays enrolled native display_names onto the legacy names and appends enrolled clients missing from the legacy list — so with the full 43-client roster enrolled (docs/ops/OPEN_REPAIRS.md:12057) the dropdown is already effectively native. BUT if `_writeUiPrimeRerouteFlag` fails it sets the allowlist to `{clients:[]}` (index.html:~25890), which today falls back to legacy names and after this change would leave the picker EMPTY. Fix: fetch `clients
     files: index.html, docs/truth/ENDPOINTS.md
  [C6] (high risk, new) linear-issues: remove the force-refresh and empty-result fallback in loadLinearIssues
     CORRECTION TO CONTEXT: `workload_issues` is the DEFAULT read, not the only one. `loadLinearIssues` (index.html:14533) short-circuits to `_wlV2FetchIssues()` only when `_wlV2Ready() && !force`; on `force`, and on ANY Supabase failure or a zero-row result, it falls through to `LINEAR_ISSUES_WEBHOOK` with `cache:'no-store'` and a cache-buster (index.html:14561-14570). The toolbar ↻ (`wlManualRefresh`, index.html:16534) passes force=true and its own comment says 'This explicit action intentionally keeps the direct no-cache Linear path.' So the Workload ↻ hits Linear today. Delete both branches, delete `LINEAR_ISSUES_WEBHOOK` and the `_wlV2Ready()` guard, and give ↻ an honest contract: it re-read
     files: index.html, docs/truth/ENDPOINTS.md
  [C7] (medium risk, new) linear-issue-statuses: delete _calReconcileLinearStatuses and rebuild _calRefreshParentLinkFlags natively or drop it
     Two call sites. (a) `_calReconcileLinearStatuses` (index.html:33589, fetch at :33610) is already effectively dead: its first statement is `if (_calV2Ready()) return;` and `_calV2Enabled()` defaults to true (index.html:~35590), so it only runs under `?v2=0` or a missing anon key. Delete outright. (b) `_calRefreshParentLinkFlags` (index.html:33424, fetch at :33455) is NOT v2-gated — it runs on every non-background calendar load (:35662) and on forceMeta refreshes (:35667) whenever any card still carries a `linear_issue_id`/`graphic_linear_issue_id`. It powers the 'link the sub-issue' / 'incomplete sub-issue' banners (project / due date / editor / sub-vs-parent). Post-Linear those banners are m
     files: index.html, docs/truth/ENDPOINTS.md
  [C8] (medium risk, new) linear-subissues: remove Import-from-Linear and Bulk-link dialogs entirely
     Three call sites. The link-paste adopters `_calSyncStatusFromLinear` (index.html:33518, fetch :33522) and `_sxrSyncStatusFromLinear` (:68903, fetch :68907) are ALREADY unreachable for both teams: every caller sits behind `_writeUiLinkSlotSealedLive` (index.html:38594 gates :38579; :38705 gates :38742; :64443 gates :64437), and both teams are syncview-authoritative. Delete them. The two live callers are the dialog-open fetches at index.html:33738 (`Import from Linear`) and :34015 (`Bulk link`) — both fire BEFORE their seal checks at :33875 and :34186/34187, so today a user opens the dialog, SyncView calls Linear, and only Apply refuses (OPEN_REPAIRS 66: `_calRunLinearImport` was sealed 2026-0
     files: index.html, test/import-from-linear-sealed.js, test/calendar-linear-link-move.js, docs/truth/ENDPOINTS.md
  [C9] (medium risk, new) linear-set-status + linear-add-comment: drain the browser outbox, then delete both endpoints
     CORRECTION TO CONTEXT: these are WRITE endpoints and they are already refusing. OPEN_REPAIRS 78 records 20 post-flip calls (14 set-status, 6 add-comment) each answering `{ok:false,blocked:true,reason:'syncview_authoritative',http_status:409}` while n8n logs every execution as success — the authority gate lives in the workflows' `Apply Status to Linear` / `Post Comment To Linear` Code nodes (scripts/write-ui-n8n-authority-gates.js:141,168; pinned by test/write-ui-n8n-authority-gates.js). The browser reaches them two ways: `_calLegacyPushStatusToLinear` (index.html:32512) / `_calLegacyPostLinearComment` (:32550), chosen only when `_writeUiUseGatewayWhenReady` (:25882) is false — i.e. an unenro
     files: index.html, test/write-ui-outbox-parity.js, test/write-ui-repair-races.js, docs/truth/ENDPOINTS.md, docs/ops/OPEN_REPAIRS.md
  [C10] (medium risk, new) linear-tweak-comments: replace the Workload popover tweak-comment preview with native comments, or drop the preview
     `wlFetchTweakComments` (index.html:19270, fetch :19277) does ONE batched POST with `{ids:[…linear issue ids…]}` for every 'Tweaks Needed' sub-issue in an open popover, 5-minute cache. The native equivalent is `supabase/functions/production-comments` — but it reads ONE `deliverable_id` per request (index.html of the EF: :286 `const deliverableId = clean(body.deliverable_id)`, :294 rejects missing, :346/:351 filter `.eq('deliverable_id', deliverableId)`), behind `takeReadBudget` rate limiting (429 + retry_after 300) and a durable allow-audit. So a 6-sub popover becomes 6 budgeted requests. Cheapest honest options, in order: (1) drop the inline preview and keep the 'Always check Frame.io too' n
     files: index.html, supabase/functions/production-comments/index.ts, docs/truth/ENDPOINTS.md
  [C11] (medium risk, new) editors-week: rebuild Kasper's editor panel on public.deliverable_events
     What editors-week actually computes (index.html:77691 `_kasperLoadEditors` → `_kedPaint` :77739 → `_kedRow` :77977 → `_kedEditorStats` :77956 → `_kedSplitVideos` :77900ish → `_kedVideoDeliveries`/`_kedVideoCourt`): the server returns `{weekLabel, weekStart, weekEnd, editors:[{name,email,avatarUrl,videos:[{transitions:[{at,dayKey,from,status}]}]}]}` — i.e. last week's Linear status-transition timeline for every VID sub-issue with activity. From it the browser derives: deliveries (a move FROM a work state — in progress / todo / backlog / tweaks needed — INTO a review column matching /smm|kasper|client/, de-bounced to one per (day,kind), kind=tweak if it came from Tweaks Needed else firstcut); 
     files: index.html, docs/truth/ENDPOINTS.md, docs/truth/SUPABASE.md
  [C12] (low risk, lift) log-linear-submission: KEEP, rename, and re-point away from the Linear branch
     Despite the name this endpoint does NOT touch Linear — it appends to the `Linear Submissions` Google Sheet. It has three call sites and TWO of them are on the NATIVE path: `_linearIntakeLogSubmissionRequest` (index.html:47941) which logs the raw request BEFORE production-write is called, and `_linearIntakeSendTelemetry` (:47895/47910) which logs the native ids after. The in-code comment at :47921-47941 explains why it exists — on 2026-08-26 a videographer was refused eleven times and 'the only copy of his work was in his own browser'. Deleting it re-opens that incident. Disposition: LEAVE the call sites; the work is on the n8n side — the sheet-append branch lives inside VIDEO PRODUCTION AUTO
     files: index.html, docs/truth/ENDPOINTS.md

FILES YOU OWN (touch nothing else)
  index.html
  docs/truth/ENDPOINTS.md
  docs/truth/N8N.md
  docs/CLIENT_LIFECYCLE_MAP.md
  docs/ops/OPEN_REPAIRS.md
  scripts/n8n-native-urgent-draft.js
  scripts/n8n-f44-native-adapter.js
  scripts/n8n-native-card-adapter.js
  supabase/functions/production-write/index.ts
  test/submit-owned-intake-routing.js
  test/native-urgent-dispatch.js
  test/native-urgent-ui.js
  test/n8n-native-urgent-draft.js
  test/calendar-urgent-badge.js
  test/kasper-urgent-ping.js
  test/urgent-ping-persistence.js
  test/import-from-linear-sealed.js
  test/truth-sync.js
  n8n-backups/

LIVE ACTIONS THE OWNER MUST TAKE (prepare them exactly; never execute them)
  - [runtime-flag] Set three production-write secrets: NATIVE_URGENT_HANDOFF_ENABLED=true, NATIVE_URGENT_HANDOFF_URL=https://synchrosocial.app.n8n.cloud/webhook/native-urgent-video, NATIVE_URGENT_HANDOFF_KEY_HEX=<64 lowercase hex chars, used as a UTF-8 passphrase, NOT hex-decoded>. Without all three the handler throws `GatewayError(503, "native_urgent_not_configured")` and answers `{ok:false, error:"native_urgent_not_configured", delivery:"not_sent", retry_safe:true}` — no request leaves the gateway and nothing is written. All three are compared EXACTLY (production-write index.ts:3811-3815): `NATIVE_URGENT_HANDOFF_ENABLED` must be the literal string `true`, `NATIVE_URGENT_HANDOFF_URL` must equal the built-in `NATIVE_URGENT_URL` constant character for character, and the key must match `/^[a-f0-9]{64}$/`. They are ENV names on the deployed closure, not runtime-flag rows and not new credentials, and the same 64 characters must be the passphrase on the separately approved n8n jwtAuth (HS256) credential. THE REPO IS PUBLIC: the key value goes in the Supabase secret and the n8n credential and nowhere else — not in a PR body, a commit, a test fixture, a ledger entry or CI output. **[RESTORED 2026-09-08 · sources: supabase/functions/production-write/index.ts:3805-3820 and :3848-3850 @codex/native-urgent-dispatch-20260907; docs/ops/NATIVE_URGENT_HANDOFF.md lines 18-27]**
    undo: Unset NATIVE_URGENT_HANDOFF_ENABLED (or set it to anything but the string 'true'). The handler immediately refuses again with delivery:'not_sent', retry_safe:true. No data is written and no message can be un-sent.
  - [edge-function-deploy] Deploy production-write with the `native_urgent_dispatch` action. This is a F27 Section 4 lane function — it needs the sealed four-function rollback bundle captured FIRST, uploaded to the `SyncView Backups/` Shared Drive root SECOND, and the dispatch THIRD, with commit_sha equal to main's tip at dispatch time. The dispatch is https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-f27-section4-closures.yml — `Run workflow` → `commit_sha` = current `main`, `operation` = `deploy-reviewed-release`, `confirm` = `DEPLOY_REVIEWED_F27_SECTION4_CLOSURES`, plus `rollback_bundle_sha256` / `rollback_bundle_byte_length` read straight off the capture receipt (`sealed_bundle_sha256`, `sealed_bundle_byte_length`). The capture is one command on the owner's own machine — `& "$env:USERPROFILE\.syncview\f27-capture.ps1"`, runnable from any directory — and it prints the full path of the named `.sourcebundle` on its last line; do not ask him to rebuild it or to paste PROJECT_REF / SUPABASE_ACCESS_TOKEN. The workflow enforces the ordering itself: it refuses unless `GITHUB_SHA` is the current default-branch head AND `commit_sha` equals it (yml:318-331), which is why NOTHING may be merged to main between handing over the SHA and the owner's dispatch. Dispatching before the upload fails in ~20s with `OBJECT_MISSING`, deploys nothing, and is fixed by uploading and using `Re-run jobs` on the same run — not by re-capturing. This deploys all four Section 4 closures (batch-write, deliverable-write, linear-outbound, production-write), so it must be sequenced with lanes B and D. Lane C does NOT edit the workflow file or `test/f27-section4-deploy-lane.js`; both are single-writer and belong to the coordinator. **[RESTORED 2026-09-08 · sources: .github/workflows/deploy-f27-section4-closures.yml lines 9-33 and 318-345; AGENTS.md:18-23 and 100-127; CLAUDE.md (capture order and OBJECT_MISSING recovery)]**
    undo: Redeploy the prior closure from the sealed .sourcebundle captured before the deploy. PR1341's own six-file production-write closure is documented as 663e7e423dfe150449f820ecb1e7aa3f2506d6c55c3770cfdc65b556d1311e14 (docs/ops/NATIVE_URGENT_HANDOFF.md) — that is the FORWARD pin, i.e. what the deploy should land, not the thing to restore. The restore itself is the same workflow, https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-f27-section4-closures.yml, with `operation` = `restore-captured-prior-four`, `confirm` = `RESTORE_CAPTURED_F27_SECTION4_CLOSURES`, and the SAME `rollback_bundle_sha256` / `rollback_bundle_byte_length` as the forward run. Note the commit_sha rule INVERTS for restore: it must be a recorded reviewed release that is an ancestor of current main, not equal to main's tip (yml:334-341). Both operations fail closed on a fingerprint mismatch, so a wrong digest declines to deploy rather than deploying wrong code. Before reaching for this, prefer the cheap undo: unset `NATIVE_URGENT_HANDOFF_ENABLED`. That returns the handler to `delivery:'not_sent', retry_safe:true` immediately, with no redeploy and no bundle, and it is the correct response to anything short of a broken closure. **[RESTORED 2026-09-08 · sources: .github/workflows/deploy-f27-section4-closures.yml lines 16-33, 326-345; docs/ops/NATIVE_URGENT_HANDOFF.md lines 84-85; supabase/functions/production-write/index.ts:3812-3815]**
  - [n8n-edit] Create an n8n jwtAuth credential (HS256, passphrase = the same 64-char string as NATIVE_URGENT_HANDOFF_KEY_HEX) and install the 9-node native root on the existing urgent workflow at a NEW dedicated webhook path `native-urgent-video`, generated by scripts/n8n-native-urgent-draft.js from a fresh private capture of that live workflow. The generator refuses on anything stale or unexpected: it asserts the capture's sha256 and `activeVersionId` match the binding it is handed, that the live workflow is active with exactly 9 nodes whose `activeVersion` matches, and that none of its nine new node names/ids (`Native Urgent JWT` … `Native Urgent Respond`, ids `native-urgent-v1-0..8`) collide with an existing one. It writes only to a private directory OUTSIDE the repository (`private_output_required`) and applies nothing — its receipt is classified `REVIEW_ONLY_NATIVE_URGENT_DRAFT` with `activationHeld:true`. The edit is purely ADDITIVE: the new root hangs off its own webhook path with jwtAuth and `rawBody`, and the generator proves no native node ever edges back into a legacy one (`native_to_legacy_edge`). The legacy urgent path keeps working throughout. **[RESTORED 2026-09-08 · beyond the named field set (an `- [n8n-edit]` line), restored because it is owner-executed · source: scripts/n8n-native-urgent-draft.js @codex/native-urgent-dispatch-20260907, lines 3, 41-49 and the CLI guard at the foot of the file; docs/ops/NATIVE_URGENT_HANDOFF.md lines 18-27]**
    undo: Restore the captured prior workflow version by its activeVersionId (capture it in the same session — the value in the draft's private binding is from the generator run, not from today). The draft preserves every original node/edge/credential and an EXACT INVERSE is machine-checked before it is emitted: the generator rebuilds the workflow with its nine added nodes filtered out and their nine connection entries deleted, and asserts that result deep-equals the captured original (`inverse_mismatch`). So the undo has two forms and the cheap one is real: because the edit is additive on a NEW webhook path, simply removing the nine `native-urgent-v1-*` nodes and their connection keys returns the workflow to the captured state without touching the legacy urgent route, and unsetting `NATIVE_URGENT_HANDOFF_ENABLED` stops the gateway calling the path at all. Restoring the whole prior version by activeVersionId is the heavier fallback for when the workflow has been edited by other means since. Capture the live activeVersionId before you edit and write it into an `n8n-backups/` status stub — never rely on a version id read out of git (ROLLBACK.md rule 2 requires the private snapshot first). **[RESTORED 2026-09-08 · source: scripts/n8n-native-urgent-draft.js @codex/native-urgent-dispatch-20260907 (the `inverse` construction and `inverse_mismatch` assertion, plus the receipt fields `inverseVerified` / `nativeHasNoLegacyEdges`)]**
  - [n8n-edit] Edit VIDEO PRODUCTION AUTOMATION (workflow id BrJSe8zCKUccfmIq) to replace the two Submit entry edges so video-form / graphic-form forward to the native gateway instead of creating Linear issues, using scripts/n8n-f44-native-adapter.js against a fresh private capture. The two entries are named in the adapter itself: `{video: {path:'video-form', previous:'F44 Normalize Video'}, graphics: {path:'graphic-form', previous:'F44 Normalize Graphics'}}` (scripts/n8n-f44-native-adapter.js:11), and it binds `endpointContract: 'legacy_intake_receive-v1'` plus a `VALIDATORS_SHA` taken over a slice of index.html, so it refuses with `browser_response_contract_drift` if that slice has moved — which is why this edit must be generated and installed BEFORE the browser-side legacy Submit code is deleted, or the SHA re-pinned in the same commit. **THE REST OF THE ORIGINAL SENTENCE ABOUT `log-linear-submission` IS UNKNOWN AND MUST BE ESTABLISHED BEFORE ACTING.** What is established: `webhook/log-linear-submission` is a separate Linear-bridge endpoint (docs/truth/ENDPOINTS.md:38) whose job is to log the raw submission webhook JSON to a Sheet for replay (docs/audits/2026-07-05-logic-calendar.md:388), it is called from `_submitLinearFormOnce` (docs/ops/WORKLOAD_NATIVE_SOURCE.md:166), and nothing in the adapter touches it. What the clipped text was about to say about it — keep logging, stop logging, or repoint — is not recoverable and is not guessed here. Decide it explicitly before the edit. **[RESTORED 2026-09-08 · beyond the named field set (an `- [n8n-edit]` line) · sources: scripts/n8n-f44-native-adapter.js:7,11,33,50 @codex/native-urgent-dispatch-20260907; docs/truth/N8N.md:93-94; docs/truth/ENDPOINTS.md:38. The `log-linear-submission` clause is an honest gap, not a restoration.]**
    undo: Restore the pre-edit activeVersionId. docs/truth/N8N.md records the current F44 active version as 28dacc7f-4dd7-4d65-ba88-31db737c2c65 and names af7671ab-deca-4470-a08b-ce591f59e08b as the emergency-only rollback (which reintroduces the no-refuse defect — F44's durable-receipt contract disappears with it, so a client submission that cannot reach Linear is silently lost instead of being retained as staff triage; use it only to stop an active outage, and never as the planned undo). Two more restore constraints from the same source, both load-bearing: do NOT restore `66e41fca-a86f-4ef3-a977-8ba960bc152d` — it exposes the protected filming-plan URL — and `9e5abc46-91f0-49f8-b815-fcc6baa93891` is pruned and not retrievable at all. And treat the version id above as a reading, not a fact: capture the live `activeVersionId` in the same session as the edit and write it into an `n8n-backups/` status stub, because the brief's own risk list records that the ids citable from git are already stale (`scripts/write-ui-n8n-authority-gates.js` still names 0efdd2c7-a71e-43a7-8280-adc18934b526 for this workflow). **[RESTORED 2026-09-08 · source: docs/truth/N8N.md lines 93-117; scripts/write-ui-n8n-authority-gates.js]**
  - [n8n-edit] Disable (do not delete) the four Linear-only n8n workflows once their browser callers are gone. **THE COUNT IS WRONG AND THE LIST WAS CLIPPED: there are SIX, and they are** — SyncView Calendar - Linear Set Status (`VQqqeY9B2GZbh2Bt`, `webhook/linear-set-status`), SyncView Calendar - Linear Add Comment (`8stSpZUiyG7f2LQX`, `webhook/linear-add-comment`), Calendar - Linear Sub-Issues (`Nk3pwR6Fbl4VAPqH`, `webhook/linear-subissues`), Calendar - Linear Issue Statuses (`GP8CSZDNcy5sGdFr`, `webhook/linear-issue-statuses`), SyncView Workload - Tweak Comments (`d7Dod7OuQsVsl1CN`, `webhook/linear-tweak-comments`), and Editors - Labor Week (`rhDX5VfnmOylc8o7`, `webhook/editors-week`). **Editors - Labor Week is F48 and F48 IS OPEN**: `webhook/editors-week` is still a deployed, unauthenticated workflow returning the confidential metadata F48 tracks, and removing its browser caller did not and cannot close it. Do not record F48 as closed on any diff; it closes when that workflow stops answering. Note also that disabling `linear-set-status` removes the only n8n dueDate writer (+2 days when overdue, on every call), which is a behaviour change to decide on its own — see the separate risk below. **[RESTORED 2026-09-08 · beyond the named field set (an `- [n8n-edit]` line) · sources: docs/audits/2026-07-03-n8n.md lines 68-73; docs/truth/ENDPOINTS.md:36-38; docs/truth/N8N.md:88-89; scripts/write-ui-n8n-authority-gates.js:24-25; docs/ops/OPEN_REPAIRS.md item 178 (F48 not closed)]**
    undo: Re-publish. Unpublishing is the documented reversible step (see the Weekly Slack – Top Reel precedent: 'workflow BTxic5NSaCMtZMh6 unpublished in n8n, definition intact for re-enabling'). Capture each workflow's activeVersionId before unpublishing.
  - [other] One scoped real delivery drill: send a native urgent ping for one deliverable on the test client `sidneylaruel` and confirm the message lands in #video-editing with the correct editor mention.
    undo: Not reversible — a Slack message cannot be un-sent. Scope it to the test client and announce it in the channel first. The docs are explicit: 'Disabling this lane cannot undo sent messages.'
  - [migration] No SQL migration is required for the editors-week replacement. `public.deliverable_events` and its anon SELECT grant are already installed by migrations/2026-07-06-b1-linear-data-model.sql. VERIFY this read-only before building on it (I could not query the live database).
    undo: N/A — read-only verification. If the grant turns out to be absent live, the replacement needs a small grant migration or a read Edge Function instead.

RISKS
  - Merging PR1341 without the env vars, the n8n receiver and the jwtAuth credential takes urgent alerts DOWN for every native card, because the browser prefers the native branch whenever `video_deliverable_id` is set and no longer tries the working lega
    mitigate: Treat C1 as one atomic window: merge, deploy production-write, install the n8n root + credential, set the three secrets, then run the scoped delivery drill on `sidneylaruel`. If any step cannot complete, hold the merge — do not merge 'the code half now' and finish the configuration later. The reason is the risk line above: once the browser prefers the native branch, an unconfigured gateway does not fall back, it refuses (503 `native_urgent_not_configured`, `delivery:'not_sent'`), so the gap between merge and configuration is a gap with no urgent alerts for native cards. Two ordering constraints bound that window from outside: index.html publishes to the live site via GitHub Pages the moment it lands on main, so the browser half cannot be staged; and the Section 4 dispatch requires `commit_sha` to equal main's tip at dispatch time, so NOTHING may be merged between handing the owner the SHA and his dispatch going green. Plan the window as capture → upload → dispatch → n8n root + credential → secrets → drill, and get the merge in immediately before the capture rather than days ahead. **[RESTORED 2026-09-08 · sources: supabase/functions/production-write/index.ts:3811-3815; .github/workflows/deploy-f27-section4-closures.yml:318-331; CLAUDE.md (do not merge between handover and dispatch); AGENTS.md:135-147]**
  - Removing the `linear-issues` fallback (C6) turns a degraded Workload board into a frozen one if `workload_issues` stops being rebuilt. `migrations/2026-09-02-workload-native-view.sql` says plainly: 'Linear is a MANDATORY RELAY, not a legacy mirror. T
    mitigate: C6 must land AFTER the lane that swaps Workload onto `workload_issues_native_v1` (or an equivalent native writer). Sequence it last, and keep the ↻ honest about `sourceSyncedAt` staleness so a frozen mirror is visible rather than silent.
  - index.html is a single 80k-line file and lanes A, B and C all edit it. C alone touches roughly a dozen widely separated regions (13804-13990, 19270, 22337-22360, 32358-32600, 33130-33660, 35660, 38560-38750, 46409, 47060-47960, 48132-48450, 64437-649
    mitigate: Serialize index.html edits by region, or agree explicit line-range ownership up front. C should take the webhook constants block and the `_ked*` / `_linear*` / `_calUrgent*` regions; A/B should not touch those.
  - The prepared n8n generators pin SHAs of files this lane will edit — scripts/n8n-f44-native-adapter.js asserts `VALIDATORS_SHA` over a slice of index.html between `_linearUuid` and `_linearSafeReceiptRef`, and scripts/n8n-native-card-adapter.js assert
    mitigate: Run the generator and install the n8n edit BEFORE deleting the browser-side legacy Submit code (C4), or re-pin the SHAs in the same commit and re-run test/n8n-f44-native-adapter.js.
  - The n8n workflow version ids I can cite are stale. scripts/write-ui-n8n-authority-gates.js LIVE_PRECONDITIONS names VIDEO PRODUCTION AUTOMATION at versionId 0efdd2c7-a71e-43a7-8280-adc18934b526, but docs/truth/N8N.md records the current F44 active ve
    mitigate: Capture every workflow's live activeVersionId in the same session as the edit, write it into an n8n-backups/ status stub, and never rely on a version id read out of git. ROLLBACK.md rule 2 already requires a private snapshot first.
  - The editors-week replacement quietly changes what the numbers MEAN: assignee is taken from the current `deliverables.assignee_id`, so a video reassigned mid-week lands entirely on the new editor, and pre-flip Linear-only issues disappear from history
    mitigate: Label the panel honestly ('native work only, current assignee') and show the week's totals alongside, so a discontinuity is visible as a data change rather than a performance change. Get the owner to look at one real week side-by-side against the current `editors-week` output BEFORE the native panel replaces it — and note that comparison has a deadline the rest of this lane does not: `Editors - Labor Week` (`rhDX5VfnmOylc8o7`) reads Linear's state-transition history per editor, so once Linear access ends there is nothing left to compare against and the discontinuity becomes unmeasurable forever. Take the comparison while Linear still answers, and record the two numbers for one named week in the ledger so a later reader can tell a data change from a performance change without re-deriving it. Do not treat running that comparison as closing F48: the workflow stays deployed and unauthenticated until it is actually disabled. **[RESTORED 2026-09-08 · sources: docs/audits/2026-07-03-n8n.md:73 (editors-week reads Linear state-transition history); docs/ops/OPEN_REPAIRS.md item 178 (F48 open)]**
  - Deleting `linear-set-status` also deletes the only n8n dueDate writer (+2 days when overdue, on every call, per docs/truth/N8N.md).
    mitigate: Ask the owner whether that auto-bump is wanted at all. If it is, it belongs in the native due-date path, not resurrected as a webhook.
  - Draining the Linear outbox with `window.clearLinearOutbox()` is per-browser and console-only. Queues in browsers nobody opens will simply keep retrying a dead URL.
    mitigate: Ship a version-gated one-time clear in index.html (like `_resumePendingCalCardJobs`) that empties the outbox on load after the cutover, rather than relying on anyone running a console command.

TESTS
  EXISTING, covers this lane: test/truth-sync.js — re-derives the n8n-webhook set from index.html by grep and fails if docs/truth/ENDPOINTS.md disagrees. Every endpoint deletion in this lane must update ENDPOINTS.md in the same commit or CI fails.
  EXISTING: test/write-ui-n8n-authority-gates.js — pins the `syncview_authoritative` Code-node gates in the Set Status / Add Comment / VIDEO PRODUCTION AUTOMATION workflows (asserts the gate precedes `issueUpdate` / `commentCreate`). Any n8n edit under C9 must keep these assertions true or update them deliberately.
  EXISTING: test/import-from-linear-sealed.js — pins the OPEN_REPAIRS-66 seal in `_calRunLinearImport`; C8 deletes the feature, so this test must be replaced by a 'feature absent' assertion, not silently dropped.
  EXISTING: test/calendar-urgent-badge.js, test/kasper-urgent-ping.js, test/urgent-ping-persistence.js — the three urgent-button suites on main; C1/C2 must keep them green.
  EXISTING, lift with C3: test/submit-owned-intake-routing.js (candidate, 76 lines) — 16 offline groups over the real `_submitLinearFormRoutedOnce` extracted into a vm, incl. 2 pinned counterexamples against base b60a9705. It stops at the auth boundary; it proves route selection, not server acceptance.
  EXISTING, lift with C1: test/native-urgent-dispatch.js (39 lines, 40 handler groups), test/native-urgent-ui.js (50 lines, 32 VM UI groups), test/n8n-native-urgent-draft.js (48 lines, 31 receiver-graph controls).
  EXISTING: test/f44-linear-intake-transform.js, test/linear-intake-receipt-contract.js, test/linear-intake-submission-cap.js, test/linear-submit-durability.js — the F44 legacy-Submit suites. C4 deletes what they cover; each needs a deliberate replacement or removal decision.
  NEW NEEDED: an editors-week suite. There is none today — `ls test/ | grep -i editors` returns only test/editor-count-excludes-parents.js (candidate) which is about parent exclusion, not the weekly panel. C11 needs an offline test that feeds synthetic `deliverable_events` rows into the unchanged `_kedSplitVideos`/`_kedVideoDeliveries`/`_kedVideoCourt` and asserts the same numbers the Linear-shaped payload produced.
  NEW NEEDED: a 'no Linear webhook remains' guard — a grep test over index.html for the ten slugs, so a later branch cannot reintroduce one. truth-sync.js catches additions to ENDPOINTS.md but not a call site that someone also documents.
  NOTE: `npm test` is the full suite and takes several minutes; `npm run test:prod-polish` cannot pass in a sandbox with no route to the live backend (all 8 lanes fail identically on origin/main), so verify against main before calling anything a regression.


=== ADVERSARIAL REVIEW OF YOUR OWN BRIEF — READ THIS TWICE ===
A second agent tried to prove the brief above wrong. It found the following. Where the review disagrees with the brief, THE REVIEW WINS.

CLAIMS THAT ARE WRONG:
  ! already_built #2: "Candidate hardens that same router: a pending NATIVE intake receipt now outranks a legacy F44 receipt."
    why: The opposite is true, and the brief's own cited test asserts the opposite. In `git show 5bcc03bd:index.html` lines 48684-48691 the FIRST statement of `_submitLinearFormRoutedOnce` is still `if (localStorage.getItem(LINEAR_RECEIPTS_KEY)) return _submitLinearFormLegacy(mode);` — the native read happens only after it. tes
    truth: What the candidate actually changes is (a) a pending native receipt now outranks the MISSING-HELPER exit — `if (!pendingNativeIntake && typeof _writeUiRerouteUseGatewayWhenReady !== 'function')` — and the `useGateway===false` exit, and (b) unreadable storage returns `{ok:false, error:'submission_recovery_unreadable'}` 
  ! already_built #2 lift_how: "Lift the `_submitLinearFormRoutedOnce` hunk + test/submit-owned-intake-routing.js as a pair. It is a self-contained selector change with an offline test." (echoed by C3: lift the hardening + test, then remove the legacy exits)
    why: The lifted test PINS the exact exits C3 exists to delete. Its last three groups are `run(html,{helper:'missing'},['legacy:both'])`, `run(html,{enrolled:false},['routing','legacy:both'])`, `run(html,{enrolled:true},['routing','native-auth'])`. The moment C3 makes the unenrolled/missing-helper paths hold instead of calli
    truth: Treat test/submit-owned-intake-routing.js as a template to be rewritten in the same commit as C3, not as a lift. Only its 6 `submission_recovery_unreadable` groups survive C3 unchanged.
  ! already_built #2 confirmed_by: the test "extracts the real `_submitLinearFormRoutedOnce` via vm" and is offline.
    why: It is not fully offline and it does not run in this clone. At module scope it does `execFileSync('git',['--no-replace-objects','show','b60a9705492002830eed60ece874e0686fc4b538:index.html'],...)`. `git cat-file -e b60a9705492002830eed60ece874e0686fc4b538` → OBJECT MISSING; `git --no-replace-objects show b60a9705…:index.
    truth: The test needs the pinned base commit reachable. CI's calendar-unit-tests.yml does use `fetch-depth: 0` so it may resolve on GitHub, but it will not run in a shallow or partial clone, and it is a hidden git dependency the brief presents as pure offline. Re-pin to a commit known to be on main, or inline the counterexamp
  ! corrections_to_context #5 / C8: "`_calSyncStatusFromLinear` (:33518) and `_sxrSyncStatusFromLinear` (:68903) are ALREADY unreachable for both teams: every caller sits behind `_writeUiLinkSlotSealedLive` (index.html:38594 gates :38579; :38705 gates :38742; :644
    why: There is a FOURTH caller the brief never lists, and it is ungated. index.html:64525 — `if (val && typeof _sxrSyncStatusFromLinear === 'function') _sxrSyncStatusFromLinear(newPid, val, which);` — sits inside `_sxrMoveLink` (index.html:64500). Grepping every `_writeUiLinkSlotSealedLive` call site gives 25827(def), 33875,
    truth: `_sxrMoveLink` is a live, staff-reachable (`if (_isClientLink) return;`) path that still POSTs `linear-subissues` today and will hang post-Sept-15. It is also a standing seal defect worth reporting to the owner independently of lane C. C8 must include it; the "already unreachable" framing understates the Sept-15 breaka
  ! C9: "The browser reaches them two ways: `_calLegacyPushStatusToLinear` (index.html:32512) / `_calLegacyPostLinearComment` (:32550) ... and the persisted retry outbox (`_linearOutboxEnqueue` → drain at index.html:32358 and :67890)" + mitigation "drain or clear 
    why: There is a complete, separate Samples twin the brief never names. `_sxrLegacyPushStatusToLinear` (index.html:68005, `fetch(LINEAR_SET_STATUS_URL...)` at :68014) and `_sxrLegacyPostLinearComment` (:68029, `fetch(LINEAR_ADD_COMMENT_URL...)` at :68036). It has its OWN outbox with its own key `SXR_LINEAR_OUTBOX_KEY = 'sync
    truth: C9 must delete four legacy writers, not two, and drain/clear TWO localStorage rings. A one-time clear that only empties `syncview_linear_outbox_v1` leaves every queued Samples status/comment write retrying a dead URL forever — the exact failure the risk section says it is preventing. Related: index.html:68720 lists a f
  ! already_built #6 lift_how: "`deliverables.status` values (in_progress, tweak, smm_approval, kasper_approval, client_approval, approved, posted) map 1:1 onto the existing `_kedIsWorkState`/`_kedReviewTarget`/`_kedIsTweakState`/`_kedIsFinishState` predicates at 
    why: index.html is 79418 lines, so line 79490 does not exist. The predicates are at index.html:77826 (`_kedReviewTarget`), :77832 (`_kedIsTweakState`), :77837 (`_kedIsWorkState`), :77843 (`_kedIsFinishState`). Separately the status domain is not 7 values: migrations/2026-07-06-b1-linear-data-model.sql:39-41 is `check (statu
    truth: Cite 77826-77843. The extra six values matter: `scheduled`/`canceled`/`duplicate`/`triage` match no predicate at all, and `todo`/`backlog` DO match `_kedIsWorkState` exactly (no normalization needed), so the mapping table in C11 is incomplete in both directions.
  ! C11: feed "the same `{videos:[{transitions:[{at,from,status}]}]}` shape into the UNCHANGED `_ked*` functions with one normalization tweak."
    why: That shape drops `dayKey`, which is not cosmetic. `_kedVideoDeliveries` (index.html:77861) does `const dayKey = t.dayKey || String(t.at || '').slice(0, 10);` — i.e. it falls back to the UTC calendar date. But `_kedWeekDateKeys` (index.html:77775-77781) builds the seven bar buckets with `const TZ = 'America/Chicago'`, a
    truth: Every delivery after ~19:00 Chicago would land on the next day's bar, and Sunday-evening work would fall outside the week's seven keys entirely (counted in totals, invisible in bars). The native shaper must emit an America/Chicago `dayKey` per transition, exactly as editors-week does today.
  ! C10 option (3): "read `production_comments` directly over REST if anon select is granted — NOT verified."
    why: It is verifiable read-only and the answer is no. migrations/2026-07-12-production-comments.sql:144 is the only grant on that table: `grant select, insert, update, delete on table public.production_comments to service_role;`. There is no anon or authenticated grant for `production_comments` anywhere in migrations/.
    truth: Option (3) is dead as written — it would need a new grant migration plus an RLS policy, which is a bigger change than option (2). Drop it from the option list or re-rank it last. (The CLAUDE.md 42501 note is about writes; the read is blocked by the absence of a grant, not by a policy.)
  ! tests: "EXISTING, covers this lane: test/truth-sync.js — re-derives the n8n-webhook set from index.html by grep and fails if docs/truth/ENDPOINTS.md disagrees."
    why: That is check 2 of seven. test/truth-sync.js is 208 lines and also: (1) requires EVERY docs/truth/*.md to carry `Last verified: YYYY-MM-DD @ <commit>` no older than 30 days whose commit resolves AND is an ancestor of HEAD — with its own header warning that a branch commit is squashed away at merge, so the stamp must na
    truth: Each lane-C commit that touches a truth doc must re-stamp it against a main-ancestor commit, and any doc naming a deleted `symbol()` or a deleted test path fails CI. I checked: no docs/truth file currently backticks a symbol lane C deletes, so check 4 is clean today — but check 1 is a live tripwire, and docs/truth/SHEE
  ! C1 files: the eight files listed for the "13-file delta 5bcc03bd…672cb509".
    why: The delta is genuinely 13 files / 729 insertions (verified), but two of the thirteen are missing from the list and both are load-bearing for the deploy: `.github/workflows/deploy-f27-section4-closures.yml` (`PRODUCTION_WRITE_SOURCE_SHA256: 3a5c0ba2… → 663e7e42…`) and `test/f27-section4-deploy-lane.js` (the same value i
    truth: CLAUDE.md says both lanes fail closed on a fingerprint mismatch and that digests are regenerated with `node scripts/ef-fingerprint.js <sha> --slugs=<slug> --expected-only` — never by hand. That script exists on main and is named nowhere in the brief. Shipping C1 without re-pinning both files on the actual merge commit 
  ! already_built #3 lift_how: `scripts/n8n-f44-native-adapter.js` + `scripts/n8n-native-card-adapter.js` are "Usable as-is", with the only caveat being the pinned SHAs.
    why: `scripts/n8n-f44-native-adapter.js` line 4 is `const card=require('./n8n-native-card-adapter');`, and `scripts/n8n-native-card-adapter.js` line 6 pins `HELPER_SHA='7f3185bb…'` over `supabase/functions/_shared/native-card-materialization.mjs`. That file does NOT exist on origin/main (`ls` → missing); it exists only on 5
    truth: Either lift native-card-materialization.mjs too (and answer whether it needs an EF deploy), or vendor the guard text into the adapter. Note the brief's SHA risk is otherwise accurate: I recomputed the index.html slice between `function _linearUuid(` and `function _linearSafeReceiptRef(` on main and it hashes to ccb973d
  ! Several load-bearing line anchors in the detail text.
    why: Verified against the working tree (which is identical to origin/main for index.html — the only diff vs origin/main is +46 lines in docs/ops/OPEN_REPAIRS.md). Wrong: the `{clients:[]}` fallback and the OPEN_REPAIRS-70 comment are at index.html:25489 and :25496, not "~25890"/"~25896" (25890-25896 is inside `_writeUiClass
    truth: Substance holds in every one of these — I confirmed the behavior each anchor describes — but a session told to edit at :25890 will edit the wrong function. Re-anchor before handing the brief to an executor. Anchors I verified as CORRECT and worth keeping: 47584/47340/47059 (submit router), 14533 + 14561-14570 (loadLine

WORK THE BRIEF MISSED:
  + The Samples (SXR) half of C9: two more legacy Linear writers and a second retry outbox
    why: C9 deletes only the calendar writers and drains only `syncview_linear_outbox_v1`. `_sxrLegacyPushStatusToLinear` (index.html:68005) and `_sxrLegacyPostLinearComment` (:68029) POST the same two endpoints from the Samples surface and enqueue into `syncview_sxr_linear_outbox_v1` (:63149) on failure, drained on a 60s timer
    files: index.html, test/samples-legacy-save-order.js, test/write-ui-outbox-parity.js, docs/truth/ENDPOINTS.md
  + `_sxrMoveLink` is an unsealed live `linear-subissues` caller
    why: index.html:64500-64525 has no `_writeUiLinkSlotSealedLive` guard, unlike `_calMoveLink` at :38698 which seals at :38705. Its tail calls `_sxrSyncStatusFromLinear(newPid, val, which)` → `fetch(LINEAR_SUBISSUES_URL)` at :68907. The brief classifies both `*SyncStatusFromLinear` functions as already unreachable, so nothing
    files: index.html, test/calendar-linear-link-move.js
  + Sixteen test files and one qa probe that reference symbols lane C deletes are not in the plan
    why: test/run-all.js globs every top-level `test/*.js` and exits non-zero on any failure, and these suites extract functions from index.html by name with `throw new Error('missing ' + name)` (verified in test/linear-project-source-gate.js and test/samples-legacy-save-order.js). The brief names 9 test files; grepping the ful
    files: test/linear-project-source-gate.js, test/calendar-card-write-jobs.js, test/samples-legacy-save-order.js, test/native-intake-ui-source.js, test/write-ui-calendar-sxr-reroute.js, test/write-ui-writer-durability.js
  + docs/truth/LINEAR.md is not owned, and the truth-doc freshness contract is not budgeted
    why: files_owned lists ENDPOINTS.md and N8N.md but not docs/truth/LINEAR.md — a 175-line truth doc whose entire subject (live VID/GRA teams, 14-user roster, exact state names, `workload_issues` CON/STR rows) becomes false on Sept 15, stamped `2026-08-25 @ 61a1d5f6`. test/truth-sync.js check 1 fails any commit where a truth 
    files: docs/truth/LINEAR.md, docs/truth/BRIEFING.md, docs/independence/CUTOVER_AUDIT_2026-07-13.md, docs/independence/GO_LIVE_CHECKLIST.md, docs/independence/B4_READINESS.md, docs/ops/MONITORING.md
  + C6 ignores the mirror-watermark machinery that only exists because ↻ hits Linear
    why: `wlManualRefresh` (index.html:16534) is not just `wlLoadSnapshot(true)`. It nulls `wlState.sourceSyncedAt`, and on success calls `await wlRebaseMirrorWatermarkAfterDirectRefresh()` when `payload && !payload.usedFallback`, restoring `priorWatermark` otherwise; it also calls `wlScheduleNativeDueReceiptRetry()` in its fin
    files: index.html, docs/truth/ENDPOINTS.md
  + live_actions_needed omits re-pinning the production-write fingerprint before the F27 dispatch
    why: The list has the three secrets, the EF deploy, the two n8n edits, the workflow disables and the drill — but not the code change the deploy lane itself requires. Both `.github/workflows/deploy-f27-section4-closures.yml` and `test/f27-section4-deploy-lane.js` carry `PRODUCTION_WRITE_SOURCE_SHA256`, PR1341 already bumps i
    files: .github/workflows/deploy-f27-section4-closures.yml, test/f27-section4-deploy-lane.js, scripts/ef-fingerprint.js
  + Editors-week loses avatars, and nothing in C11 says so
    why: `_kedRow` (index.html:77982) renders `<img src="${ed.avatarUrl}">` with `_kedAvatarFallback` on error. `public.team_members` has no avatar column at all — its create-table in migrations/2026-07-06-b1-linear-data-model.sql lists `avatar_color`, not `avatar_url`; the avatars come from Linear via editors-week today. C11 c
    files: index.html, docs/truth/SUPABASE.md

OPEN QUESTIONS — answer from the code if you can; escalate to the coordinator only if a wrong guess is expensive
  ? Is `write_ui_reroute_clients` still the full 43-client roster today? OPEN_REPAIRS.md:12057 records 43 members under `owner-enrollment-wave-3-full-roster` and :7019 records 42 slugs on 2026-09-02. I am read-only and did not query Supabase. If any active client 
  ? Does `public.deliverable_events` actually contain the rows I am counting on, at the volume needed for a weekly panel? I verified the table, its trigger and its anon SELECT grant in migrations/2026-07-06-b1-linear-data-model.sql, but I did not read a single liv
  ? Do native cards created post-flip still carry `linear_issue_id`? PR1341 adds `|| video_deliverable_id` to `_calShowUrgent`/`_sxrShowUrgent`, which implies some native cards have NO Linear link and therefore show no URGENT button today. That would be a live gap
  ? What are the live workflow ids and activeVersionIds for `SyncView Workload — Tweak Comments`, `SyncView Editors — Labor Week`, `SyncView — Urgent Tweak → Slack`, `Linear Sub-Issues` and `Linear Issue Statuses`? docs/CLIENT_LIFECYCLE_MAP.md:679 names them; I fo
  ? Can `production-comments` grow a batched `deliverable_ids` read, or should the Workload tweak-comment preview simply go? This is a product call — the preview exists so an editor doesn't have to open Linear, which stops being a reason on Sept 15.
  ? Is `add-to-calendar` (the sixth VIDEO PRODUCTION AUTOMATION webhook) called from anywhere? It is not in the ten, and `grep webhook/add-to-calendar index.html` finds nothing, so it appears to have no browser caller — but docs/CLIENT_LIFECYCLE_MAP.md:521 calls i
  ? Who owns the `Linear Submissions` Google Sheet append inside VIDEO PRODUCTION AUTOMATION, and will it survive that workflow's Linear branches being cut? C12 depends on it surviving, and I could not read the workflow graph.
  ? Does anything other than the browser call `linear-set-status`? OPEN_REPAIRS 78 explicitly says the caller of the 20 post-flip 409s is UNKNOWN — 'Candidates are a browser on the legacy lane (items 63/70 …), or a reconciler push path.' If it is a reconciler, C9'


IF THIS LANE IS NOT FINISHED BY 2026-09-15, THIS BREAKS:
On Sept 15, with Linear access gone, staff and clients see this: (1) SUBMIT — any client not in `write_ui_reroute_clients`, any browser whose two-second flag read times out, and any browser holding a stale F44 receipt POSTs to `video-form`/`graphic-form`, whose Linear create fails; the F44 workflow answers HTTP 202 `received` and the client is told 'staff will complete an internal step' for work that will never be created. Silent loss of intake. (2) URGENT — the #video-editing ping dies. The webhook resolves the assigned editor FROM LINEAR, so with no Linear it cannot name a recipient; SMMs get 'Could not send' and tweaks that need attention today go unannounced. (3) WORKLOAD ↻ — the toolbar refresh explicitly takes the direct no-cache Linear path (`wlManualRefresh`, index.html:16534) and the Supabase read also falls back to `linear-issues` on any failure or zero-row result; the refresh button throws, and if the Linear-fed reconcile stops, the board silently freezes at its last mirror. (4) CALENDAR banners — `_calRefreshParentLinkFlags` runs on every foreground load and will hang/fail against `linear-issue-statuses`, adding a failed request to every calendar open. (5) IMPORT / BULK-LINK — both dialogs call `linear-subissues` on open, so they now spin on 'Asking Linear…' and never reach the refusal they already have. (6) KASPER'S EDITOR PANEL — 'Loading last week's work from Linear' then "Couldn't load editor stats"; Kasper loses his only per-editor weekly view. (7) The persisted Linear outbox keeps retrying `linear-set-status`/`linear-add-comment` in every open browser forever, against endpoints that already answer 409.


START BY: reading docs/independence/LINEAR_EXIT_LANES.md on origin/main (the lane map and the index.html region ownership table), then OPEN_REPAIRS items 162-168. Then confirm for yourself that the 'already built' artifacts above really exist before you plan anything around them.
