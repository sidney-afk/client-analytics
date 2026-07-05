# Track B re-audit — index.html + scripts/: every Linear consistency surface
**Auditor domain:** STATUS / ASSIGNEE / DUE / NAME / COMMENT consistency with Linear, workload tab, flags, outboxes, reconcilers.
**Date:** 2026-07-05. **Baseline for diffs:** `docs/audits/2026-07-03-code.md` (git baseline commit `ba36541`, 2026-07-03).
**File measured:** `/home/user/client-analytics/index.html` = 36,555 lines / 2,507,005 bytes (was 36,022 / 2,475,319 at snapshot). All line numbers below are CURRENT (re-located by symbol, not trusted from old docs). MEASURED = read from current code; ESTIMATE/inference labeled as such.

---

## findings — (a) OUTBOUND status: linear-set-status

**Endpoint const:** `LINEAR_SET_STATUS_URL` — index.html:13272 (`…/webhook/linear-set-status`). Payload always `{issue: <sub-issue url>, status: <app status string>}`. There is exactly ONE n8n endpoint for both calendar and SXR; there is NO Edge-Function variant of linear-set-status (Track A did not touch the Linear bridges — A3 skipped by owner decision).

### Calendar helper — `_calPushStatusToLinear` (index.html:15642)
- Per-issue **serialization**: promise chain keyed by issue URL (`_calLinearPushChain`, 15640).
- Per-issue **coalescing**: `_calLinearPushLatest[url] = st` (15646); a queued older push checks `_calLinearPushLatest[url] !== st` at run time (15649) and skips itself if superseded. Only the latest status need land ("the card, not Linear, is the source of truth").
- Failure (network / non-2xx / `{ok:false}` JSON) → `_linearOutboxEnqueue('status', payload, err)` (15661). No user-visible failure UX — `console.warn` only.
- **⚠ CORRECTION to the 07-03 snapshot: the calendar helper has NO 'Posted' (or 'Scheduled') guard.** The only gate is `if (!url || !st) return;` (15645). The doc-comments at 15630–15633 ("*'Posted' has no Linear equivalent, so it is never pushed*") and 34769–34770 ("*Posted has no Linear equivalent (helper rejects it)*") are **stale and contradicted by the code**. Furthermore, per `docs/audits/2026-07-03-linear.md`, **both live teams DO have Scheduled and Posted states** (GRA `99287b4c`/`f7a5eaa1`, VID `f9eb3dad`/`9f2e70a8`), so a pushed `Posted`/`Scheduled` will be *set* by the n8n workflow, not skipped. The n8n workflow's "silently skips absent states" safety only applies to states a team lacks. MEASURED (code) + cross-referenced (Linear audit). Verified via `git log -S`: no such guard was removed recently — the snapshot's claim appears to have been taken from the stale comment.
- The SXR helper (below) DOES have the guard — an asymmetry Track B's sync engine must decide deliberately.

### Calendar call sites (every one, MEASURED)
1. **`_calFlushCardSave` success path** — index.html:20793–20800. Fires after a successful upsert when `'video_status' in edits` (→ push `savedPost.video_status` to `linear_issue_id`) and/or `'graphic_status' in edits` (→ `graphic_linear_issue_id`), unless suppressed. This is the funnel for: SMM status dropdown, client approve / request-change (via `_calPendingEdits` + auto-status), SMM/client review panels, point-adoption writebacks (suppressed), reconcile-adopted values (suppressed). Suppression: `_calNoLinearPush` set, per-card and per-`pid|comp` keys, computed as `suppressVideo`/`suppressGraphic` at 20594–20596 and consumed then deleted. A deliberately-removed legacy branch (comment at 20801–20813) means the **overall** status is never pushed — only per-component statuses, video→video issue, graphic→graphic issue; caption/title never push (no Linear issue).
2. **`_kasperPersistPostWrite`** — index.html:34771–34774. After EVERY Kasper persist (approve, request-tweak, approve-after-tweaks, **and even comment-only adds**, finish/close — anything that funnels through `_kasperPersistPost`), pushes **both** `video_status` and `graphic_status` **unconditionally** (not gated on "did this status change"). Idempotent at Linear but a noisy writer; relies on coalescing to stay cheap.
3. **`_calReassertLinearStatus`** — index.html:15678–15690 (details in §c) → `_calPushStatusToLinear` at 15689.
- **Archive never touches Linear**: `_calArchiveOne` (upsert `{id, status:'Archived'}` via `_calUpsertFetch` at 21096) has no Linear push and no cancel — archiving a card leaves its Linear issue in whatever state it had. MEASURED.

### SXR (Samples New) helper — `_sxrPushStatusToLinear` (index.html:29064)
- Guard: `if (!url || !st || st === 'Scheduled' || st === 'Posted') return;` (29066) — **samples never push the calendar-only states** (and samples statuses can't be those anyway; belt-and-suspenders).
- Same per-issue chain + coalesce (`_sxrLinearPushChain`/`_sxrLinearPushLatest`, 29063); failure → SXR outbox.

### SXR call sites (every one, MEASURED)
1. `_sxrFlushCardSave` success path — 27979–27980 (gated on `edits` + `suppressVideo/Graphic` via `_sxrNoLinearPush`).
2. `_sxrKasperApplyAndPersist` — 29575: pushes only when the patch actually carried `[comp]_status` (unlike the calendar Kasper writer). Serves `_sxrKasperApproveComp` (→ 'Client Approval'), request-change/approve-after-tweaks (→ 'Tweaks Needed').
3. `_sxrKasperUndoApprove` — 29637: pushes the REVERTED status after an Undo so Linear doesn't stay at Client Approval.
4. `_sxrReassertLinearStatus` — 29111–29120 (20 s throttle, same as calendar).

### Statuses never pushed (definitive)
- Calendar: **none excluded by the FE helper** (see correction above). Caption/title components have no Linear issue → never pushed by construction. `Archived` is a whole-card status, never a component status, never pushed.
- SXR: `Scheduled`, `Posted` excluded (29066); samples status vocabulary excludes them anyway (`_sxrNormStatus` at 26296 is "clone of `_calNormStatus` minus the Scheduled/Posted members").

### Durable outboxes + retry triggers + failure UX
- **Calendar outbox** (15544–15628): key `syncview_linear_outbox_v1` (`LINEAR_OUTBOX_KEY`, 15554). Item shape `{id, kind:'status'|'comment', payload, attempts, lastError, lastAttempt, queuedAt}`. `LINEAR_OUTBOX_MAX_ATTEMPTS = 6`; retry timer `LINEAR_OUTBOX_RETRY_MS = 60_000` (single timer, re-armed while retryable items remain). Flush triggers: **page load** (15771–15772) + **window focus** (15773) + the 60 s timer after any enqueue/partial failure. After 6 attempts an item is **kept but never retried** — console-only escape hatches `window.clearLinearOutbox()` / `window.peekLinearOutbox()` (15623–15628). Failure UX: **none** (no chip/toast) — pushes are silently queued; the user never learns a Linear push is stuck. MEASURED.
- **SXR outbox** (29043–29062): SEPARATE key `syncview_sxr_linear_outbox_v1` (`SXR_LINEAR_OUTBOX_KEY`, 26153); `SXR_LINEAR_OUTBOX_MAX = 6`, retry 60 s; flush on **window focus** + **module boot** (29237–29238) — registered only when `_sxrEnabled()`; console `clearSxrLinearOutbox()` (29062). Same silent-failure UX.

---

## findings — (b) OUTBOUND comments: linear-add-comment

**Endpoint const:** `LINEAR_ADD_COMMENT_URL` — index.html:13274. Payload `{issue, body, author}`. `body` is the RAW comment text — the `**Kasper (via SyncView):**` prefix seen in Linear is added server-side in n8n (cross-ref: linear audit §"Comments are load-bearing"); the FE only supplies `author`.

**Author values** (MEASURED): `_calCurrentAuthor()` (23892) → client link: the client display name (else `'Client'`); staff: `'Synchro Social'`. Kasper surfaces hardcode `'Kasper'`. Helper default fallback `'SyncView'` (15699, 29079). `_sxrCurrentAuthor()` (28080) identical.

**Calendar helper** `_calPostLinearComment` (15695): fire-and-forget async IIFE; failure → outbox `kind:'comment'` (same outbox as statuses). Call sites:
1. **Review-panel "Request change"** — 23621: after `_calFlushCardSave` resolves, posts the tweak text to `_calLinearUrlFor(post, comp)`. Serves SMM review, client review link, both.
2. **Notes composer** `_calAddComment`-family — 24514–24516: **BOTH plain comments AND change-requests, roots AND replies** are mirrored to Linear, but ONLY for `comp === 'video' || comp === 'graphic'` (explicit gate so caption/title notes can never leak onto the video issue). Create-only — edits/resolves/deletes never sync to Linear.
3. **Kasper request-tweak / approve-after-tweaks** — 35032: posts the tweak body with author `'Kasper'` after `_kasperPersistPost`.
   - **Kasper comment-only is deliberately NOT mirrored**: `_kasperAddCommentComp` (34907) has an explicit "Deliberately NO `_calPostLinearComment` — plain notes don't ping the editor" (34949). Same on SXR (29639–29641). MEASURED.

**SXR helper** `_sxrPostLinearComment` (29076); call sites: SXR review request-change (28543, after flush), SXR notes composer (28788, video/graphic gate), SXR Kasper tweak paths via the `linearComment` param of `_sxrKasperApplyAndPersist` (29576).

Comment threads themselves live in Supabase `*_tweaks` JSON columns (threaded objects `{id, parent_id, author, role, body, created_at, done, audience, is_tweak, round…}`); Linear only ever receives a flat text copy of newly created video/graphic comments. Nothing flows Linear-comments→cards (the workload popover reads them read-only, §i).

---

## findings — (c) INBOUND: Linear → app

### What arrives
The n8n `linear-status-sync` workflow (id `MJbMZ789B5ExZz9x`; contains the Samples branch) writes a minimal patch `{id, video_status|graphic_status}` through calendar-upsert-post / sample-review-upsert → Supabase row update → **realtime** on `cal-<slug>` / `sxr-<slug>` → FE debounced background reload. **Cross-reference caveat: the 2026-07-03 n8n audit found this workflow INACTIVE (unpublished) since 2026-06-28** — so as of the last snapshot the only inbound writer was the reconciler. The FE machinery below is live regardless of the producer's state. (Current n8n state = other auditor's domain; flagged in UNKNOWNS.)

### How the FE handles the echo (calendar v2 merge, MEASURED)
Background-load merge in the fetch path (~17600–17690):
1. Save in flight for the card → keep local unconditionally (17613).
2. `_calLocalRecentSaves` recent-save window `CAL_CONFLICT_WINDOW_MS = 90_000` (14739): within 90 s of OUR successful save, prefer local — **except** under v2 `_calRecentSaveReconcile(lp, fp, rsf)` (14659) may adopt a sub-status the server moved to a **genuinely new** value (server row strictly newer AND value ≠ what-we-wrote AND ≠ pre-save base — the `_calRecentSaveFields` snapshot written at 20755). This is the Kasper-approval-adoption vs stale-Linear-round-trip discriminator.
3. `_calIsStaleLinearRegress(lp, fp, comp, rsf)` (14713): refuses adoption when ALL hold — comp is video/graphic; server value ≠ wrote ≠ base; we just wrote ≥ Client Approval (`ABOVE = {'Client Approval','Approved','Scheduled','Posted'}`, 14722) and server value is below; AND no NEW open change-request comment on that component (`_calReconcileHasGenuineTweak`, 14731 — a genuine Tweaks-Needed always lands a comment; the Linear sync writes bare status only).
4. Otherwise last-write-wins on `updated_at` (local wins ties), with `_calPendingEdits` overlaid onto an adopted server row (17668–17681).
SXR mirrors all of this: `_sxrLocalStatusAt` grace 5 min (29038–29041), `SXR_RT_SELF_ECHO_MS = 4000`, `_sxrRecentSaveFields` (27962).

### `_calReassertLinearStatus` — exact trigger conditions (MEASURED)
index.html:15678–15690. Called from exactly ONE place: the v2 merge loop at 17648–17650 — for each of `['video','graphic']`, when `_calIsStaleLinearRegress(lp, fp, comp, _rsf)` is true (i.e., the merge just refused to adopt a stale Linear regression of a fresh ≥Client-Approval local write). It then re-pushes the KEPT local status to the linked issue so drift heals forward. Throttle: `_calLinearReassertAt` Map keyed `url|status`, `CAL_LINEAR_REASSERT_MS = 20_000` (15676–15677) — a repeated round-trip can't spam Linear; `_calPushStatusToLinear`'s coalescing dedupes supersessions. SXR twin `_sxrReassertLinearStatus` 29111 (`SXR_LINEAR_REASSERT_MS = 20_000`), called from the SXR merge (29555 region is the Kasper realtime; the reassert call sits in the SXR background-merge path mirroring 17649).
**Track B note:** this is a FE-resident *outbound* writer that fires in response to *inbound* data — a hidden bidirectional edge for the §1 authority matrix.

### Point-adoption on fresh link set (MEASURED)
- Calendar `_calSyncStatusFromLinear(pid, issueUrl, comp)` — 15948–15987: POST `linear-subissues {url}`; if the link resolves to a PARENT (has sub-issues) → flag ident in `_calParentLinks`, show "link the sub-issue" banner, adopt nothing; else map `json.parent.status` via `_calMapLinearStatusStrict`; **refuses to knock a local 'Posted' back** (15974–15976); writes via `_calPendingEdits` + adds `pid` AND `pid|comp` to `_calNoLinearPush` (15979–15980) so the flush doesn't echo the adopt back; `_calClearStaleApprovals`; `_calFlushCardSave`.
- SXR `_sxrSyncStatusFromLinear` — 29085–29108: same, plus rejects adopted `Scheduled`/`Posted` outright (29097).
- v1-only load-time reconcile `_calReconcileLinearStatuses` — 16019: `if (_calV2Ready()) return;` (16026) — dead under v2 default; when live (?v2=0 browsers) it batch-pulls `linear-issue-statuses` and adopts mapped states unless row touched <5 min (`_calIsRowRecentlyTouched`, 16008) or local status fresh (`_calLocalStatusAt` grace `CAL_LOCAL_STATUS_GRACE_MS = 5 min`, 15994–16003); never regresses Posted (16054, 16066).
- **Meta/nudge inbound** `_calRefreshParentLinkFlags` (15875) + handler (15900–15937): batched `linear-issue-statuses {issues}` returns per-ident `{isSubIssue, hasProject, hasDue, hasEditor}` → `_calLinearMetaByIdent` → `_calLinearMissingForCard` (15855) renders the "missing project / due date / editor" banner. This is the ONLY place assignee/due-date data touches the calendar — **as booleans only**. Persisted in `syncview_calLinearMeta_v1`.

---

## findings — (d) RECONCILERS (both scripts read fully)

### Shared design (MEASURED from both files)
- `grabFunc`/`grabConst` extract canonical logic **by name from index.html at runtime** via `new Function`:
  - `scripts/linear-sync-reconcile.js` (lines 58–72) extracts consts `CAL_STATUSES`, `CAL_PRIORITY`, `CAL_COMPONENTS` and functions `_calNormStatus`, `computeOverallStatus`, `_calClearStaleApprovals`, `_calMapLinearStatusStrict`, `_calIdentFromUrl`.
  - `scripts/sample-linear-reconcile.js` (lines 56–71) extracts consts `CAL_STATUSES`, `CAL_PRIORITY`, `SXR_COMPONENTS` and functions `_calNormStatus`, `computeSampleOverallStatus`, `_sxrClearStaleApprovals`, `_calMapLinearStatusStrict`, `_calIdentFromUrl`.
  - Current FE locations of those symbols: CAL_STATUSES 13503, CAL_PRIORITY 13506, CAL_COMPONENTS 13507, `_calNormStatus` 13545, `computeOverallStatus` 13556, `_calClearStaleApprovals` 13571, `_calMapLinearStatusStrict` 15530, `_calIdentFromUrl` 15839, SXR_COMPONENTS 26138, `computeSampleOverallStatus` 26307, `_sxrClearStaleApprovals` 26315. Renaming any of these silently breaks the crons (plus 28 `test/*.js` files also using grabFunc — measured via grep).
- **Most-recent-action-wins**: per card-component ledger entry `{cardCal, cardAt, linCal, linAt}` keyed `client|id|comp`. Card side uses EXACT `video_status_at`/`graphic_status_at` (DB BEFORE-trigger stamped; columns optional — select falls back if absent). Linear side is poll-timed. `decide()` (cal 134 / samples 163): `TIE_MS = 120_000`; within tie → Tweaks Needed never loses, else higher `CAL_PRIORITY` wins; outside tie → newer side wins.
- **SAFETY_CAP = 15** (env `CAP`): if a run wants more corrections it ABORTS with exit 2 and writes nothing.
- **Dedupe**: `dedupeByLinearIssue` mirrors FE `_calDedupeByLinearIssue` (most-recent `updated_at` wins, `order_index` tiebreak) — only the canonical row is written.
- **Poisoned-batch healing** in `resolveLinear`: batches of 50 to `linear-issue-statuses`; any ident missing from a batch is retried INDIVIDUALLY (the 2026-06-24 thumbnail-drift incident guard). Archived rows' links are never resolved.
- **Writes** (this is where A1/A2 changed things — NEW since snapshot):
  - card→Linear: `pushCardToLinear` POST `linear-set-status {issue, status}` — **always n8n**, no EF, no headers. Response `{skipped, reason}` respected (state not on team → logged skip).
  - Linear→card: `pullLinearToCard` builds patch `{id, [comp+'_status'], …cleared *_approved_at…, status?}` and POSTs to **`upsertUrlForClient(card.client)`** — the EF (`…functions/v1/calendar-upsert` / `…/sample-review-upsert`) when the client slug is in the runtime flag (`calendar_upsert_ef_clients` / `sample_review_ef_clients`, fetched from `syncview_runtime_flags` at run start via `loadUpsertEfClients()`; flag-read failure → n8n fallback), else the n8n webhook. Headers now stamped: `X-Syncview-Actor: 'Linear reconciler'|'Samples reconciler'`, `X-Syncview-Role: system`, `X-Syncview-Source: reconcile` (cal 168–170 / samples 103–105). `routeSlug()` is a local copy of `wlNormalizeClient` (cal 147–149 / samples 77–83).
  - Calendar payload `{client, post: patch}` (no `comments_base_at` key); samples payload `{client, sample: patch, comments_base_at:''}` (contract difference documented at samples:184).
- **Ledger/cache**: `.sync-ledger/linear-reconcile.json` / `.sync-ledger/sample-linear-reconcile.json`, persisted between runs by `actions/cache` (keys `linear-reconcile-ledger-${run_id}` with prefix restore; same pattern for samples).

### The Actions + n8n triggers (MEASURED from repo; n8n live state cross-referenced)
- `.github/workflows/linear-sync-reconcile.yml`: cron `*/10 * * * *` ACTIVE + `workflow_dispatch` (schedule runs always APPLY; manual defaults dry-run; CAP input default 15; concurrency group, 10-min timeout). Real cadence per prior audits is driven by n8n trigger `AkiFmromoDkmsh39` firing `workflow_dispatch` on actions workflow id 296618163 (GitHub cron alone averages ~3.4 h).
- `.github/workflows/sample-linear-reconcile.yml`: **cron is still COMMENTED OUT** (lines 13–21) with a STALE reason ("SXR symbols removed from index.html" — they are back; `SXR_COMPONENTS` at 26138). Only `workflow_dispatch` remains. So the samples reconciler's entire cadence depends on the n8n trigger `ZJOtYpQZj73DcBB1` — which the 2026-07-03 n8n audit recorded as **inactive**. If that is still true, **the samples⇄Linear reconcile is not running at all** (inference from two measured facts; live n8n verification is the n8n auditor's domain).

---

## findings — (e) STATUS MAPPING — exact quotes + copy count

### `CAL_PRIORITY` (index.html:13506) — quoted exactly
```js
const CAL_PRIORITY = { 'Tweaks Needed':0,'In Progress':1,'For SMM Approval':2,'Kasper Approval':3,'Client Approval':4,'Approved':5,'Scheduled':6,'Posted':7 };
```
`CAL_STATUSES` (13503): `['In Progress','For SMM Approval','Kasper Approval','Client Approval','Tweaks Needed','Approved','Scheduled','Posted']`. Overall card status = lowest-priority sub-status over `CAL_COMPONENTS = ['video','graphic','caption']` (`computeOverallStatus`, 13556; title deliberately excluded — 13509–13515). Samples: `computeSampleOverallStatus` (26307) over `SXR_COMPONENTS = ['video','graphic']`.

### `_calMapLinearStatusStrict` (index.html:15530) — quoted exactly
```js
function _calMapLinearStatusStrict(name) {
    const s = String(name || '').trim().toLowerCase();
    if (!s) return null;
    if (s.includes('tweak')) return 'Tweaks Needed';
    if (s.includes('scheduled')) return 'Scheduled';
    if (s === 'posted') return 'Posted';
    if (s === 'approved') return 'Approved';
    if (s.includes('smm')) return 'For SMM Approval';
    if (s.includes('kasper')) return 'Kasper Approval';
    if (s.includes('client')) return 'Client Approval';
    if (s === 'backlog' || s === 'todo' || s === 'to do'
        || s.includes('in progress') || s.includes('in process')) return 'In Progress';
    return null;
}
```
Loose variant `_calMapLinearStatus` (15515) is identical minus the null-branch (`return 'In Progress'` for anything else); used ONLY by the Linear import picker (16188, 16287–16288).

### Mapping table — Linear state → app status (Linear→app direction)
| Linear state (both teams) | Match rule | App status |
|---|---|---|
| "Tweak Needed" / **"Tweak Needed " (VID trailing space)** | `includes('tweak')` — tolerant of the trailing space + singular/plural | Tweaks Needed |
| Scheduled | `includes('scheduled')` | Scheduled |
| Posted | `=== 'posted'` | Posted |
| Approved | `=== 'approved'` | Approved |
| For SMM approval | `includes('smm')` | For SMM Approval |
| For Kasper approval | `includes('kasper')` | Kasper Approval |
| "For Client approval" (GRA) / "For Client Approval" (VID) | `includes('client')` — tolerant of the capitalization mismatch | Client Approval |
| Backlog / Todo / To do / In Progress / In Process | exact/substring | In Progress |
| Triage / Canceled / Duplicate / Done / anything else | — | **null** (strict: card untouched; reconciler counts as unmapped) |

The case-insensitive substring matching absorbs both Linear state-name hazards flagged in the Linear audit (VID trailing space; GRA/VID capitalization). Samples-specific difference: on every samples surface a mapped `Scheduled`/`Posted` is additionally rejected (push 29066, adoption 29097, reconciler samples:242 treats them as unmapped).

### App status → Linear state (reverse direction)
Lives ONLY in n8n `linear-set-status` (workflow `VQqqeY9B2GZbh2Bt`): maps calendar status → team state by name, silently skips states a team lacks, and **also bumps an overdue dueDate +2d** as a side effect (n8n audit :68/:142). The FE has no reverse map — it sends the app-status string verbatim.

### Live copies of the mapping (count, MEASURED where in scope)
1. **FE**: `_calMapLinearStatusStrict` (15530) — single implementation; SXR consumes it by alias `_sxrMapLinearStatusStrict = _calMapLinearStatusStrict` (26165); plus the loose `_calMapLinearStatus` (15515, import-picker only).
2. **n8n `linear-status-sync` `mapStatus`** (inbound handler; workflow currently inactive per 07-03 n8n audit) — a separate maintained copy.
3. **Reconcilers**: NOT separate copies — both extract the FE function at runtime (2 runtime consumers of copy #1).
4. **Reverse map** in n8n `linear-set-status` (app→Linear) — a distinct, direction-inverted table.
Track A's Edge Functions added **no** new mapping copy (calendar-upsert/sample-review-upsert don't map Linear states). Net: **2 maintained Linear→app copies (FE + n8n) + 1 reverse map in n8n**, with `CAL_PRIORITY` in lock-step between FE (13506), the n8n handler's PRIORITY table (per its own comment at 13504–13505), and the reconcilers (extracted).

---

## findings — (f) NAME / DUE / ASSIGNEE consistency TODAY (definitive)

- **App rename → Linear: NOTHING.** The only Linear-bound payload shapes in the entire FE are `{issue, status}` (linear-set-status), `{issue, body, author}` (linear-add-comment), `{url}` (linear-subissues), `{issues:[…]}` (linear-issue-statuses), `{ids:[…]}` (linear-tweak-comments), `{}` (editors-week), `{issue, client, name}` (send-urgent-slack — Slack ping, not a Linear write). A card `name` edit travels only through calendar-upsert/sample-review-upsert. **No code path pushes a title/rename to Linear.** MEASURED by exhaustive grep of every `fetch(` against Linear-bridge URLs.
- **Linear title change → app: NOTHING reaches cards.** The inbound patch is `{id, video_status|graphic_status}` only. Linear titles DO surface in two read-only mirrors: the **workload tab** (`workload_issues.title`, rebuilt by the n8n Workload — Reconcile) and the workload popovers; and the Kasper **Editors** subtab data (editors-week aggregation). A Linear rename therefore shows on the workload board (within ~10 min) but never on a calendar/samples card — the card name and the Linear issue title are fully independent strings today. This confirms the Track B spec's premise that §9.4 name-sync is NEW behavior, not a port.
- **Due date**: no due-date column/field exists on `calendar_posts`/`sample_reviews` cards (`scheduled_date` is the content *posting* date — a different concept from the Linear production due date). Due dates are displayed ONLY in: (1) the workload tab (`due_date` drives planned/overdue/scheduling; `wlEffectiveWorkDate` = dueDate−1 working day, min today, 9094); (2) the calendar's "missing … due date" nudge banner as a **boolean** (`hasDue`, 15869). No FE write path for a due date anywhere. (Server-side, `linear-set-status` bumps overdue due dates +2d on status pushes, and the nightly n8n roller bumps overdue dates to tomorrow — both outside the FE.)
- **Assignee**: no card-level assignee exists. Displayed ONLY in: (1) workload tab (`assignee_name`/`assigneeId`; hardcoded allowlists `WL_ALLOWED_EDITORS` 8956, `WL_ALLOWED_GRAPHICS` 8964, roster `WL_VIDEO_EDITORS` with hardcoded Linear user UUIDs 8973–8978); (2) Kasper Editors subtab (per-editor labor); (3) the calendar nudge banner boolean (`hasEditor`, 15870). No FE write path for assignment (assignment happens in the n8n intake automation "Pick Freest Editor" or in Linear directly).

---

## findings — (g) WORKLOAD TAB (`_wl*`)

- **Read model**: `_wlV2FetchIssues` (8747) — REST `workload_issues?select=*&active=eq.true&order=id.asc&limit=1000&offset=…` paged (hard cap 50 pages); rows mapped by `_wlV2MapRow` (8722) to `{id, identifier, title, url, isSubIssue, parentId, parentIdentifier, dueDate, createdAt, updatedAt, status, statusType, teamKey, teamName, assigneeId, assigneeName, assigneeEmail, clientName}`. Row-level `active` is maintained by the n8n `Workload — Reconcile` mark-sweep (out of FE scope). Fallback: any Supabase failure OR zero rows → live `linear-issues` webhook (`loadLinearIssues`, 8814–8851). Cache `syncview_linearIssuesCache_v1` with TTL.
- **Flag**: v2 default ON (Phase 3, 2026-06-17); `?wl2=0` sticky kill (`syncview_workload_v2_off`), `?wl2=1` re-enable (8684–8700).
- **Realtime**: subscription code exists (`_wlV2EnsureSubscribed` 8777, global channel `workload_issues`) but is **hard-gated OFF**: `const WL_V2_REALTIME = false` (8682) because the reconcile rewrites every row per run (event flood). Board freshness = mount / manual ↻ / tab-return silent refetch, NOT push. Unchanged since snapshot.
- **What "active" means in the UI** (two layers): DB `active=true` (n8n mark-sweep) AND `wlIsActiveStatus` (8930): `statusType` not completed/canceled/triage AND status not in `WL_PARKED_STATUSES` (8918: `tweak applied/tweaks applied`, all `for smm|kasper|casper|client approval` variants, `approved`, `posted`) — "workload only shows work the editor still owns".
- **Grouping** (`wlApplyData`, 9519): sub-issues only → active → `wlIsAllowedClient` (unrecognized clients dropped + console.warn) → clientName canonicalized. Buckets: `unassigned` (no assigneeId, in-progress or has due), `overdue` (due < today AND status To Do — a past-due Tweak Needed stays in tweaks; past-due In Progress stays in nowWorking), `nowWorking` (In Progress), `tweaksNeeded` (Tweak(s) Needed), `planned` (due ≥ today) → `scheduleAll` schedules per editor per day with `wlEditorCapacity` (graphics 15/day, video 5/day, 9209) and `wlEffectiveWorkDate` (due−1 working day). Non-allowlisted video editors dropped (9600); graphics assignees pass unchecked (no full graphics allowlist — console.info). So grouping is **by editor within date buckets**, filterable by client (`wlPassesFilters` 9905).
- **Staleness handling**: `wlIsFresh`/TTL cache; freshness label `#wlFreshness`; `wlRefetchSilent` (9417) on tab return; forced refresh busts HTTP cache with `t=` param (8840–8843).
- **`wlNormalizeClient`** (9001) — quoted exactly:
```js
function wlNormalizeClient(s) {
    if (!s) return '';
    let t = String(s).toLowerCase().trim()
        .normalize('NFD').replace(/[̀-ͯ]/g, '');
    t = t.replace(/^dr\.?\s+/, '');
    t = t.replace(/\s+(?:and|&)\s+/g, '&');
    t = t.replace(/[^a-z0-9&]+/g, '');
    return t;
}
```
  This IS the app-wide slug: `calClientSlug(name) { return wlNormalizeClient(name); }` (14760), aliased for SXR (`_sxrNormalizeClient`, 26162), duplicated as `routeSlug` in both reconcilers.
- **Roster**: `WL_CLIENT_NAMES` seed (9021, currently 31 hardcoded names incl. TEST 'Sidney Laruel') ∪ Clients Info sheet via `wlMergeClientsFromSheet` (9077, additive-only, idempotent); `WL_CLIENT_CANONICAL` map (9056) collapses Linear variants ("Miki-agrawal" → "Miki Agrawal"); **NEW `getClientRoster()` (9068)** — "the single source for 'which clients exist'", added 2026-07-04 (PRs #675/#676 "Normalize frontend client roster" / "Record roster merge live serving"). Track B §3's late one-line cutover point exists and is exactly where the spec says.
- **client_name → app slug**: workload rows carry the Linear project name as `client_name` (written by n8n); FE canonicalizes via `wlCanonicalClient` then slugs via `wlNormalizeClient` — same normalizer end-to-end, so workload↔calendar↔samples↔reconciler slugs agree. Cross-surface hop: `wlOpenInContentCalendar` (9894) → `_calFocusRequest` (14742).

---

## findings — (h) FLAGS + BOOT

### `syncview_runtime_flags` keys the FE reads (all three NEW since snapshot — Track A)
| Key | Read | Realtime channel | Routes |
|---|---|---|---|
| `calendar_upsert_ef_clients` (`CALENDAR_UPSERT_FLAG_KEY`, 13319) | `_calFetchUpsertFlagOnce` 13339 (REST 13342) | `syncview-runtime-flags` 13372–13378 | `_calUpsertFetch` 13407 → `CALENDAR_UPSERT_EF_URL` 13258 (all 6 upsert call sites: settings 14471, bulk import 16626, card save 20694, archive 21096, linear-tab import 25415, Kasper 34747) AND `_calReorderUrlForClient` 13398 → `CALENDAR_REORDER_EF_URL` 13262 |
| `settings_ef_clients` (`SETTINGS_EF_FLAG_KEY`, 13320) | 13420 (REST 13423) | `syncview-settings-runtime-flags` 13439–13445 | `_settingsWriteUrlForClient` 13462 → `TEMPLATES_SAVE_EF_URL` 7322 (call 7465) + `CAPTION_PROMPTS_SAVE_EF_URL` 13287 (call 21988) |
| `sample_review_ef_clients` (`SXR_SAMPLE_REVIEW_FLAG_KEY`, 26155) | 26222 (REST 26225) | `syncview-sample-runtime-flags` 26241–26247 | `_sxrUpsertFetch` 26276 → `SXR_UPSERT_EF_URL` 26147 (sites: archive 27547, card save 27943, Kasper 29558) + `_sxrReorderFetch` 26284 → `SXR_REORDER_EF_URL` 26150 |
Flag values are `{clients:[…]}` slug-normalized via `_calRuntimeFlagClients` (13329). Flag-read failure → empty set → n8n fallback (fail-safe). All flagged write paths now send headers `X-Syncview-Actor` ('SyncView'|'Client'|'Kasper') / `X-Syncview-Role` (smm|client|kasper) / `X-Syncview-Source` (ui|settings|…) — `_calUpsertHeaders` 13401, `_sxrWriteHeaders` 26270 — **to both EF and n8n routes** (headers are unconditional). Per EXECUTION_LOG all three flags = `{"clients":["sidneylaruel"]}` (TEST only) as of 2026-07-04 (live value verification = Supabase auditor's domain).

### localStorage keys relevant to calendar/samples/linear (MEASURED, full enumeration)
- **Outboxes**: `syncview_linear_outbox_v1`, `syncview_sxr_linear_outbox_v1`.
- **Flags/opt-outs**: `syncview_calendar_v2` / `syncview_calendar_v2_off` (?v2=1/0), `syncview_samples_v2` / `_off` (?sv2 — samples-old v2), `syncview_sxr_on` / `syncview_sxr_off` (?sxr=1/0; SXR GA default-ON since 07-02), `syncview_workload_v2` / `_off` (?wl2), `syncview_cal_v2debug`.
- **Caches**: `syncview_calCache_v1:<slug>`, `syncview_sxr_cache_v1_<slug>`, `syncview_samplesCache_v1:<slug>`, `syncview_linearIssuesCache_v1`, `syncview_calLinearMeta_v1`, `syncview_kasper_review_cache_v1`, `syncview_kasper_editors_v2`, `syncview_captionJobs_v1`, `syncview_calCardJobs_v1`.
- **Archive ledgers**: `syncview_cal_archived_v1_<slug>`, `syncview_sxr_archived_v1_<slug>`.
- **Auth/unlocks**: `syncview_auth_v1` (staff password gate, cosmetic), sessionStorage `syncview_kasper_unlocked` (25566; boot gate reads it at :64), `syncview_ttpilot_unlocked`.
- **Settings/prefs**: `syncview_calendar_settings_v1`, `syncview_cal_filters_v1`, `syncview_cal_enabled_platforms_v1`, `syncview_calendar_prefs`, `syncview_calendar_pins`, `syncview_sxr_prefs_v1`, `syncview_samples_prefs_v1`, `syncview_nav`, seen-ledgers `syncview_kasper_seen*`, `syncview_sxr_kasper_seen_v1`, `syncview_notes_seen_v1`, `syncview_samplesSeen_v1`, `syncview_kasper_approved_log_v1`, `syncview_kasper_subtab_v1`, `syncview_kasper_cal_<...>`, `syncview_kasper_filming_v1`.

### Boot gate (head script, index.html:27–102)
Modes tagged on `<html>` pre-paint: `boot-onboarding` (+AI variant, retitles tab), `boot-intake` (?intake=1), `boot-client` (?c=), `boot-password` (unauthed), else `data-boot-nav=<target>` predicted from hash/history/savedNav. `FAST = ['linear','workload','calendar','samples','templates','tiktok-upload']` (line 62); sub-path routing only for calendar/samples/templates (line 84); kasper (?Kasper=1 or session unlock), tiktok-pilot, and `sample-reviews` (only when sxrOn, line 87) are conditional.

### `?prod=1` / `_prod*` — VERIFIED FREE
Grep for `_prod`, `prod=1`, `\?prod` across index.html: **zero hits** (MEASURED). Nothing exists for Track B yet. The Production tab will need: the `_prod*` namespace (free), a nav entry + `navTo` branch, a boot-gate FAST/conditional entry, a flag (spec: `?prod=1`, role-gated), and a `syncview_runtime_flags` row if it follows the Track A pattern.

---

## findings — (i) editors-week + tweak-comments webhooks

- **`editors-week`** (`EDITORS_WEEK_URL`, 13275). ONE call site: `_kasperLoadEditors` (35371–35415), POST `{}`. Renders the **Kasper → Editors subtab**: per-editor last-week Linear labor (server aggregates state-transition history), per-day Mon–Sun bars in America/Chicago keyed to server `weekStart`/`perDay` (`_kedWeekDateKeys` 35451, `_kedPaint` 35417). Cache: `syncview_kasper_editors_v2` (KASPER_EDITORS_CACHE_KEY), invalidated when the expected "last week Monday" changes (`_kedExpectedLastWeekMondayDate` 35342) or on explicit Refresh. Read-only; no writes.
- **`linear-tweak-comments`** (`LINEAR_TWEAK_COMMENTS_WEBHOOK`, 8619). ONE call site: `wlFetchTweakComments` (10423), POST `{ids:[…]}` batched. Surfaces ONLY in the **workload rollup popover**: for sub-issues sitting in "Tweak Needed", the bounce-back comment (client tweak from the review link / Kasper tweak — both put there by linear-add-comment) is shown inline (`wlRenderTweakComments` 10446 — max 3 + "+N older … in Linear"), 5-min cache (`WL_TWEAK_COMMENTS_TTL_MS`), token-invalidated per popover. **Not** shown on calendar/samples cards — cards read their own Supabase comment threads. So Linear comments flow app→Linear (create-only) and are read back ONLY in this one workload popover.

---

## DIFFS vs 2026-07-03-code.md snapshot

**Changed (NEW since snapshot):**
1. **Track A shipped** (snapshot said "PLAN ONLY — nothing deployed"): six Edge Functions now referenced by the FE — `calendar-upsert` (13258), `calendar-reorder` (13262), `sample-review-upsert` (26147), `sample-review-reorder` (26150), `templates-save` (7322), `caption-prompts-save` (13287) — all routed per-client by three NEW `syncview_runtime_flags` keys with realtime flag subscription (§h). All 6 calendar upsert call sites re-pointed through `_calUpsertFetch`; SXR sites through `_sxrUpsertFetch`; settings writers through `_settingsWriteUrlForClient`. Currently TEST client `sidneylaruel` only.
2. **Both reconcilers gained EF flag routing** (`loadUpsertEfClients` / `upsertUrlForClient` / `upsertHeaders` with actor "Linear reconciler"/"Samples reconciler", role `system`, source `reconcile`) — scripts/linear-sync-reconcile.js:50–56,147–170; scripts/sample-linear-reconcile.js:50–53,75–105.
3. **`X-Syncview-Actor/Role/Source` headers** now sent on every calendar/samples/settings write (both EF and n8n routes) — the audit-trail groundwork Track B §6 builds on.
4. **`getClientRoster()` is NEW** (index.html:9068, PRs #675/#676, 2026-07-04) — the canonical roster accessor the Track B §3 cutover re-points. Snapshot-era code had no single accessor.
5. **New parity scripts** `scripts/a1-calendar-upsert-parity.js`, `a2-writer-parity.js`, `a4-settings-backfill-parity.js` (do NOT use grabFunc — no new rename-fragility).
6. **File size**: 36,022 → 36,555 lines.
7. **Line-number drift throughout** — e.g. the snapshot's "linear-set-status (15392, 28573)" are now helper sites 15642 (cal) / 29064 (SXR); card-save push 20795/20799; Kasper push 34773–74. All symbols re-located above.

**Snapshot claims CORRECTED by this re-audit:**
8. **"'Posted' never pushed [calendar]" is WRONG for current code** (and likely was at snapshot time — the stale code comment appears to be the source). `_calPushStatusToLinear` has no Posted/Scheduled guard (15645); both Linear teams have those states, so calendar `Scheduled`/`Posted` changes on linked cards DO reach Linear. Only SXR rejects them (29066). MEASURED.
9. Snapshot said Kasper unlock is sessionStorage — confirmed (`syncview_kasper_unlocked`, 25566 + boot :64); a same-named localStorage key does not exist (the earlier localStorage enumeration ambiguity resolved: it is session-scoped).

**Unchanged and CONFIRMED (load-bearing for Track B):**
10. Outbox design (keys, 6 attempts, 60 s timer, focus/load flush, console-only escape hatches) — both surfaces.
11. Per-issue serialization + newest-wins coalescing on both push helpers.
12. `_calReassertLinearStatus` / `_sxrReassertLinearStatus` 20 s throttle; trigger = refused stale-Linear regression in the v2 merge.
13. Recent-save window 90 s; `_calRecentSaveReconcile` / `_calIsStaleLinearRegress` / genuine-tweak discriminator; 5-min local-status grace; point-adoption incl. parent-link refusal and Posted-protection.
14. `_calMapLinearStatusStrict` + `CAL_PRIORITY` byte-identical in behavior to snapshot description; SXR aliases rather than forks the mapper.
15. Reconciler architecture: grabFunc extraction (same symbol lists), most-recent-action-wins with `video_status_at`/`graphic_status_at`, TIE_MS 120 s, SAFETY_CAP 15, dedupe-by-linear-issue, poisoned-batch healing, Actions-cache ledger.
16. **Samples reconcile GH cron still commented out** with a stale justification; cadence still 100% dependent on the n8n trigger (`ZJOtYpQZj73DcBB1`) that the 07-03 n8n audit found inactive.
17. Workload: read model, `active` semantics, WL_PARKED_STATUSES, editor allowlists + hardcoded Linear user UUIDs, capacity 15/5, realtime still hard-disabled (`WL_V2_REALTIME=false`), fallback to linear-issues webhook.
18. Boot gate modes + FAST list; cosmetic auth (`syncview_auth_v1`, `?Kasper=1`, client links ?c=&t= failing open on empty token — unchanged in code).
19. No name/due/assignee sync in either direction (confirmed definitively, §f).
20. Samples OLD (`content_samples`, `_sm*`) has ZERO Linear touchpoints (no linear columns in that module — measured).
21. `calendar-append-post` / `calendar-delete-post` consts still defined (13259–13260) and still never fetched — dead.

---

## TRACK B IMPLICATIONS

### The full FE touchpoint inventory the new sync engine must own (fan-in list — everything that must flip at cutover, by symbol)
**Outbound status writers (7 producing paths + 2 helpers + 2 outboxes + reconcilers):**
- `_calPushStatusToLinear` (15642) fed by: `_calFlushCardSave` (20793–20800), `_kasperPersistPostWrite` (34771–34774), `_calReassertLinearStatus` (15689).
- `_sxrPushStatusToLinear` (29064) fed by: `_sxrFlushCardSave` (27979–80), `_sxrKasperApplyAndPersist` (29575), `_sxrKasperUndoApprove` (29637), `_sxrReassertLinearStatus` (29120).
- Outbox flushers: `_linearOutboxFlush` (15589; load/focus/60 s), `_sxrLinearOutboxFlush` (29050; boot/focus/60 s).
- Reconciler `pushCardToLinear` ×2 (cal:144, samples:173).

**Outbound comment writers (6 sites + 2 helpers, sharing the same outboxes):**
- `_calPostLinearComment` (15695) ← 23621 (review request-change), 24514–16 (notes composer, video/graphic only), 35032 (Kasper tweak).
- `_sxrPostLinearComment` (29076) ← 28543, 28788, 29576.

**Inbound consumers:**
- v2 merge + `_calRecentSaveReconcile`/`_calIsStaleLinearRegress` (14659/14713) and SXR twins; point-adoption `_calSyncStatusFromLinear` (15948) / `_sxrSyncStatusFromLinear` (29085); v1 `_calReconcileLinearStatuses` (16019, ?v2=0 only); meta/nudge `_calRefreshParentLinkFlags` (15875) + `_calLinearMissingForCard` (15855); import `linear-subissues` picker + bulk-link modal (`_calMapLinearStatus` 15515 consumers 16188/16287).
- Reconciler `pullLinearToCard` ×2.
- Workload mirror: `_wlV2FetchIssues`/`_wlV2MapRow` (8747/8722) + `linear-issues` fallback + `wlFetchTweakComments` (10423) + `editors-week` (35392).

### Specific hardening points for the spec
1. **§1/§4 authority matrix must enumerate the FE's hidden bidirectional writer**: the stale-regress **re-assert** (fires outbound as a *reaction to inbound*). In B3 (Linear authoritative) leaving it on is fine (it defends app-side approvals — but that itself contradicts "Linear is truth"); at the B3→B4 flip it must be inventoried and flag-gated per team, or a mid-flip echo will write to the frozen side. Same for both **outboxes**: queued failed pushes can straddle a cutover and fire at the wrong side after the authority flip — the flip checklist needs "drain or clear `syncview_linear_outbox_v1` + `syncview_sxr_linear_outbox_v1`" (console helpers exist: `clearLinearOutbox()`, `clearSxrLinearOutbox()`), ideally an automated guard.
2. **§4 field mapping — status vocabulary reconciliation at B0 must cover the Posted/Scheduled asymmetry**: calendar pushes them (and Linear has the states); samples reject them; the strict map nulls Triage/Canceled/Duplicate/Done. The spec's deliverables CHECK constraint (Triage/Backlog/Todo/…/Canceled) includes states the FE map collapses (`backlog|todo → In Progress`) or nulls — decide explicit round-trip semantics per state, per team, before the mirror is built.
3. **§9.4 name-sync and §9.6 due/assignee are green-field**: verified nothing exists in either direction today (except workload's read-only title/due/assignee mirror + the boolean nudge banner). The mirror engine must ADD title/due/assignee to the inbound path (today's inbound patch is status-only) to satisfy §1's "exact reflection" in B3 — the current `linear-status-sync` patch shape `{id, video_status|graphic_status}` is NOT sufficient for the evaluation mirror; deliverables need their own inbound writer, not a reuse of the card patch.
4. **§13 teardown / §8 monitoring**: the samples reconcile is (very likely) NOT running today (GH cron commented out + n8n trigger inactive at 07-03) — meaning samples⇄Linear drift is currently unguarded except by FE best-effort pushes. Track B's "continuous reconciler" should treat the samples lane as needing a restart, not a takeover. Also `linear-set-status`'s **+2d due-date bump side effect** will make B3 zero-diff checks fail on due dates unless tolerated/modeled.
5. **grabFunc constraint (build-breaking)**: any Track B refactor of index.html must preserve, verbatim-by-name: `CAL_STATUSES`, `CAL_PRIORITY`, `CAL_COMPONENTS`, `SXR_COMPONENTS`, `_calNormStatus`, `computeOverallStatus`, `computeSampleOverallStatus`, `_calClearStaleApprovals`, `_sxrClearStaleApprovals`, `_calMapLinearStatusStrict`, `_calIdentFromUrl` — consumed at runtime by both reconcilers and 28 test files, until §13 retires the reconcilers.
6. **Reusable Track A machinery is proven and in place**: per-client runtime flags with realtime flip (pattern ×3), EF write wrappers, `X-Syncview-*` headers on every write (B0 auth extends these — the header plumbing already reaches every calendar/samples/settings write AND the reconcilers), event ledgers (`calendar_post_events` observed populating during the A1 canary). The per-team authority flag can be one more `syncview_runtime_flags` key consumed by the same `_calRuntimeFlagClients` machinery.
7. **§9.2 two-button resolution**: the single choke points are `_calLinearUrlFor` (used by every calendar Linear affordance) and `_sxrLinearUrlFor` (28085) — re-pointing these two + the card link-button renderers implements the "no four-button period" rule.
8. **§10 workload re-point**: replacing `workload_issues` with `deliverables` touches `_wlV2FetchIssues`, `_wlV2MapRow`, the `active` semantics (currently n8n mark-sweep + WL_PARKED_STATUSES), the hardcoded editor allowlists/roster (→ `team_members`), and can finally turn realtime ON (the delta-upsert blocker disappears when writes are row-level EF writes instead of full-table rewrites).
9. **Kasper's unconditional double status push** (34773–74, fires even on comment-only actions) should not be replicated in the new engine — gate on actual change.
10. **`?prod` namespace confirmed free**; boot gate FAST list (index.html:62) and navTo need a `production` entry; `sample-reviews`' conditional boot entry (line 87) is the template for a flag-gated tab.

---

## UNKNOWNS
1. **Live n8n state** (my domain was code): whether `linear-status-sync` (MJbMZ789B5ExZz9x) is still inactive; whether trigger workflows `AkiFmromoDkmsh39` (calendar) and `ZJOtYpQZj73DcBB1` (samples) are firing — determines whether the inbound path and the samples reconcile run AT ALL today. I cite the 2026-07-03 n8n audit; the parallel n8n auditor must confirm.
2. **Live `syncview_runtime_flags` values** — EXECUTION_LOG says all three = `["sidneylaruel"]` as of 07-04; DB read is the Supabase auditor's domain.
3. **n8n `linear-set-status` mapping details** (exact name/UUID matching per team; whether it sets Posted/Scheduled or has its own guard; the +2d bump conditions) — inferred from the n8n audit summary, workflow JSON not in repo backups ("No repo backup … for all Linear bridge endpoints").
4. **Field population of the outboxes** — per-browser localStorage, unobservable from the repo; stuck-at-6-attempts items may exist on staff machines and would replay through cutover (see implication #1).
5. Whether any browser runs the `?v2=0` / `?sxr=0` / `?wl2=0` opt-outs (would exercise v1 paths incl. `_calReconcileLinearStatuses`).
6. Whether the calendar's 07-03-snapshot claim "'Posted' never pushed" was ever true in a deployed build — `git log -S` found no removed guard in the recent window; deeper archaeology not performed (low value: current behavior is what matters for Track B).
7. `LINEAR_ISSUES_TTL_MS` exact value and `wlReadCache` internals were not re-read (unchanged region; freshness semantics confirmed at call sites).
