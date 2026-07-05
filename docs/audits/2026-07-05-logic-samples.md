# Re-audit 2026-07-05 — index.html: the SAMPLES systems (SXR new + old), end-to-end

Auditor domain: `/home/user/client-analytics/index.html` samples code only (SXR `_sxr*` / `sample_reviews`
+ legacy `_sm*` / `content_samples`), plus the in-repo Edge Function sources and migrations needed to
ground the FE contract. **READ-ONLY audit; no live systems touched beyond the repo filesystem.**
All line numbers are CURRENT (file is now **36,555 lines**; baseline 2026-07-03 audit said 36,022 —
so every baseline line number has drifted; everything below was re-located by symbol). Facts are
MEASURED from code unless marked ESTIMATE.

---

## 1. SXR module extent, flag, and routing (MEASURED)

- Module fences: `>>> SXR_BEGIN` at index.html:26121 → `<<< SXR_END` at 29781 (~3,660 lines), plus
  CSS fences 4030–4315/4464, nav button `#navSxr` ("Samples New") at 4455–4463, router hooks tagged
  `// SXR_LINE` at 12107/12113/12125/12171, boot-gate hash branch at :87
  (`seg === 'sample-reviews' && sxrOn()`), deep-link capture `renderPage` branch at 25596–25599,
  client-share-link boot branch at 25730–25763.
- Flag: `_sxrEnabled()` (26176) — **GA default-ON since 2026-07-02** (comment 26178–26182); `?sxr=0`
  sticky opt-out (`syncview_sxr_off`), `?sxr=1` clears it. `_sxrReady()` (26193) additionally
  requires the shared anon key. With flag off, the only statement that runs is the nav-reveal guard
  at 29775–29780.
- Views: `sxrState.view` ∈ `organizer` (Sheet) | `smmreview` (SMM Review) | `review` (client Review)
  (26198, tab set at 26466: client link gets `['review','organizer']`, staff `['smmreview','organizer']`).
- Routes: SMM `#sample-reviews/<slug>[/<cardId>]` (deep link resolved in `mountSxrView` 26410–26440);
  client portal `?sxr=1&c=<name>&v=sample-reviews[&t=<token>]` → `mountSxrClientView` (28901), token
  hard-gate at 25745–25752, **fails open with console warning when `client_review_token` empty**
  (25753) — same fail-open as calendar.
- Share link builder `_sxrCopyShareLink` (26545) still hardcodes `?sxr=1` into the client link
  (harmless post-GA; required pre-GA). Card deep-link copier `_sxrCopyCardLink` (27620) likewise.

### Write routing — the Track A EF layer (NEW since baseline; MEASURED)
- Constants (26144–26155): `SXR_GET_URL` = n8n `sample-review-get`; `SXR_UPSERT_N8N_URL` = n8n
  `sample-review-upsert`; **`SXR_UPSERT_EF_URL` = `{SUPABASE}/functions/v1/sample-review-upsert`**;
  `SXR_REORDER_N8N_URL` = n8n `sample-review-reorder`; **`SXR_REORDER_EF_URL` =
  `{SUPABASE}/functions/v1/sample-review-reorder`**; `SXR_SAMPLE_REVIEW_FLAG_KEY =
  'sample_review_ef_clients'` (26155).
- Per-client runtime flag: `_sxrFetchSampleFlagOnce` (26222) reads
  `syncview_runtime_flags?key=eq.sample_review_ef_clients` via anon REST;
  `_sxrSubscribeSampleFlag` (26236) live-updates it over realtime channel
  `syncview-sample-runtime-flags`; `_sxrSampleUseEf(slug)` (26259) →
  `_sxrUpsertUrlForClient`/`_sxrReorderUrlForClient` (26264/26267) pick EF vs n8n **per client slug**.
  Flag read failure falls back to `{clients:[]}` = n8n (26231–26234). Primed once at module init (26292).
- Every SXR write goes through `_sxrUpsertFetch`/`_sxrReorderFetch` (26276/26284), which attach NEW
  headers via `_sxrWriteHeaders` (26270): `X-Syncview-Actor` (SyncView|Kasper|Client),
  `X-Syncview-Role` (smm|kasper|client — kasper detected via `location.hash==='#kasper'` or
  `?Kasper=1`), `X-Syncview-Source` ('ui'). All four write sites use this funnel: card save
  (`_sxrFlushCardSave` 27943), archive (`_sxrArchiveOne` 27547), reorder (`_sxrPersistReorder`
  27761), Kasper persist (`_sxrKasperPersist` 29558).
- Flag population as of 2026-07-04 (from `docs/audits/2026-07-04-a4-gate-evidence.md:15`):
  `sample_review_ef_clients={"clients":["sidneylaruel"]}` — TEST client only. (Live current value
  not re-verified — see UNKNOWNS.)

### The Edge Function sources (in repo; MEASURED from source)
- `supabase/functions/sample-review-upsert/index.ts` (405 lines): service-role client; preserves the
  n8n contract: `{client, sample, comments_base_at}` → `{ok:true, sample}` | `{ok:false, error|conflict}`.
  **`ALLOWED` column allow-list (lines 21–26) = the definitive SXR wire model**: order_index, name,
  asset_url, thumbnail_url, status, creative_direction, hide_creative_direction, linear_issue_id,
  graphic_linear_issue_id, video_status, graphic_status, video_tweaks, graphic_tweaks,
  client_video_approved_at, client_graphic_approved_at, kasper_approved_at, kasper_approved_by,
  kasper_seen, kasper_approved_after_tweaks, kasper_finished_at, kasper_closed_at, thumb_rev,
  created_at (+ server-set updated_at, server-minted id `sr_…` if absent). Guards: read-failure
  (returns "sample store briefly unavailable"), **phantom-row guard** (refuses to create a row with
  no CONTENT_FIELDS = name/asset_url/thumbnail_url/creative_direction/video_tweaks/graphic_tweaks),
  comment merge via `sample_review_merge_comments` RPC for existing rows (tweaks stripped from the
  scalar patch), `__CLEAR_LINK__` sentinel + bare-'' link carry-forward, `comments_base_at` scalar
  conflict guard over SCALAR_FIELDS (FE always sends `''` so it never trips from the UI), tombstone
  retention 30 days in `mergeCell`. Best-effort `sample_review_events` ledger via
  `waitUntil(insertEvents(...))` — actions emitted: create, archive, status_change (overall +
  per-component), approve_video/approve_graphic (client stamps), kasper_approve, kasper_finish,
  kasper_close, link_set/link_clear, comment_add (added ids).
  **Note:** the CORS allow-list admits the three `x-syncview-*` headers but the function body never
  reads them — `actor` in events is derived only from `kasper_approved_by`, `role` mostly null.
  The FE's new actor/role headers are currently **transport-only, unrecorded**.
- `supabase/functions/sample-review-reorder/index.ts` (93 lines): `{client, items:[{id,order_index}]}` →
  sequential per-row `update order_index` keyed `(client,id)` → `{ok:true, updated:n}`. No auth
  beyond the platform (CORS `*`), no events.

---

## 2. Data model — `sample_reviews` (MEASURED)

- Live DDL (dump `migrations/live-schema-baseline-2026-07-03.sql:194–223`): PK `(client, id)`;
  all-text columns exactly matching the EF ALLOWED list above, **plus** `video_status_at` /
  `graphic_status_at timestamptz` (stamped by the `sample_reviews_stamp_status_at` trigger;
  consumed by the reconciler, never by the FE). **There is NO `kasper_finish_log` column** —
  `kasper-finish-log-migration.sql` is calendar-only.
- FE shape fill `_sxrMigrateShape` (26758): defaults `video_status`/`graphic_status` to
  'In Progress'; guarantees name/creative_direction/hide_creative_direction/asset_url/thumbnail_url/
  linear_issue_id/graphic_linear_issue_id as ''; parses `video_tweaks`/`graphic_tweaks` JSON strings
  into `video_comments`/`graphic_comments` arrays; aliases `p.comments = p.video_comments`; seeds
  the local kasper-seen cache from the `kasper_seen` CSV.
- `id` mint: `_sxrMintId()` = `sr_<ts36>_<rand5>` (27662). Blank pre-save ids `__sxrblank__N` (27509).
- `thumb_rev`: bumped on any thumbnail_url/asset_url edit — in-memory `_sxrThumbRev` map +
  persisted `post.thumb_rev` (`_sxrBumpThumbRev` 27663–27664; applied in flush at 27906, wired into
  the field-patch at 27928). Read side reuses the calendar's `_calDeriveThumbInfo` (aliased 26920),
  which reads `_calThumbRev[p.id] || p.thumb_rev` (19122) — the SXR in-memory map `_sxrThumbRev` is
  therefore **write-only**; cache-busting works only via the persisted column (works, but the map is
  dead weight / a subtle divergence from the calendar's same-browser-instant path).
- `hide_creative_direction`: truthy-string field ('1'/''), eye toggle `_sxrToggleCreativeVisibility`
  (27389); client never sees a hidden creative direction (27383).

## 3. Status vocabulary + overall status (MEASURED)

- `SXR_STATUSES` (26135): **'In Progress', 'For SMM Approval', 'Kasper Approval', 'Client Approval',
  'Tweaks Needed', 'Approved'** — exactly the calendar's `CAL_STATUSES` (13503) **minus
  'Scheduled'/'Posted'**. Row-terminal extra value: `status='Archived'` (never in the menu).
- `SXR_PRIORITY` (26136): Tweaks Needed 0 < In Progress 1 < For SMM Approval 2 < Kasper Approval 3 <
  Client Approval 4 < Approved 5 (calendar's `CAL_PRIORITY` 13506 identical minus Scheduled 6/Posted 7).
- `computeSampleOverallStatus(p)` (26307): worst-of over `SXR_COMPONENTS = ['video','graphic']`
  (26138), reduce seed 'Approved'. The FE writes the derived `status` column alongside every
  component change (27291/27347/28491/28532/28853/29591/29730/29767).
- `_sxrNormStatus` (26296): maps ''/draft→In Progress, "(for) kasper approval"→Kasper Approval,
  "smm approval"→For SMM Approval, else case-insensitive match into the set.
- `_sxrClearStaleApprovals(post, pending)` (26315): above-set = {Client Approval, Approved}; clears
  `client_<comp>_approved_at` when that comp drops below the set; clears the **overall**
  `kasper_approved_at` when NO component is at/above the set. Called from: status pick (27301),
  set-all (27350), review request-tweak (28540), auto-status (28857), Linear point-adopt (29105),
  Kasper request-tweak (29743, folded into the persisted patch). Extracted BY NAME by
  `scripts/sample-linear-reconcile.js` (line 69) along with `computeSampleOverallStatus` and
  `SXR_COMPONENTS` — **renaming any of these silently breaks the 10-min reconcile cron** (grabFunc
  at scripts/sample-linear-reconcile.js:59–71).

## 4. Lifecycle

### Create (MEASURED)
- **Only manual creation exists.** `addSxrBlankCard` (27515) pushes `_sxrBlankSample()` (27511:
  order_index = max+1, both statuses 'In Progress') into state under a `__sxrblank__` id; first
  substantive edit mints `sr_…`, `_sxrPromoteBlankCard` (27826) rewrites every DOM attribute
  carrying the old pid (full attribute walk), and `_sxrFlushCardSave` sends the WHOLE row (create
  branch 27933–27941). Empty blanks are never sent (`hasContent` guard 27875, mirrors the EF
  phantom-row guard). Failed first save → `_sxrFailedNewCards` keeps the card on screen with
  "Save failed · Retry" (27986–27988; retry `_sxrRetrySave` 28009 re-sends the whole row).
- **No intake/Linear/batch-driven creation in the FE.** Grep for "SAMPLES"/batch strings finds no
  Linear "{CLIENT} | SAMPLES | VID-GRA" batch creation anywhere in index.html; the Linear-tab
  video/graphic forms create calendar cards only. Samples' Linear parents are created outside this
  app (n8n intake / manually in Linear — ESTIMATE, out of my domain).
- `linear_issue_id` / `graphic_linear_issue_id` enter a sample **only by manual paste** into the
  Linear pile editor: `_sxrLinearEdit` (27102) → `_sxrLinearCommit` (27119) with guards: must look
  like a linear.app URL with an ident (27143–27147), VID/GRA prefix-vs-slot confirm (27148–27153),
  cross-card uniqueness conflict → "Move it here" flow `_sxrShowLinkConflict`/`_sxrMoveLink`
  (27173/27192, clears the link off the old card then sets it on the new), then point-adoption of
  the Linear status (`_sxrSyncStatusFromLinear`, 29085). There is **no** SXR bulk link-from-Linear
  modal (calendar-only; excluded per spec §5). Duplicate links already in data render a dupe warning
  banner `_sxrLinkDuplicatePeers`/`_sxrDupeWarnText` (27219/27240).
  **Parent handling:** point-adopt fetches `linear-subissues`; if the pasted URL has sub-issues it
  simply skips adoption and re-renders (29092–29093) — unlike the calendar (which refuses parent
  links), **SXR keeps a pasted parent link on the card**; there is no `_sxrParentLinks` warn in the
  current code (the parity log claimed one was built — it is absent now).

### Edit / save engine (MEASURED)
- `_sxrOnFieldInput`/`_sxrOnFieldBlur` (27781/27791) → `_sxrPendingEdits[pid]` + 650 ms debounce
  (`SXR_SAVE_DEBOUNCE_MS` 27661) → `_sxrFlushCardSave(pid)` (27864–28004): per-card serialized
  (`_sxrSaveInFlight` promise, queued edits re-flushed in `finally`), **field-level patch** for
  existing rows (only edited keys; `*_tweaks` cells re-serialized from the live arrays when touched;
  `status` recomputed and included whenever a component status is in the patch; thumb_rev included
  on media edits; `''` link → `__CLEAR_LINK__` sentinel 27929–27932), whole row for creates/retries.
  Always `comments_base_at:''` (27943) — the EF/n8n scalar-conflict guard never trips from the UI;
  comment safety = server-side 3-way merge RPC. Echo merge (27947–27959): server echo overlaid on
  local row, re-migrated, still-queued edits and comment merges (`_sxrMergePostComments`) protected,
  `_baseAt` updated. Failure: `_SXR_ROLLBACK_FIELDS` (27669: video_status, graphic_status, status,
  order_index, both link cols, both client approval stamps, kasper_approved_at,
  kasper_approved_after_tweaks) rolled back to snapshot; free text kept.
- Post-save Linear push: if `video_status`/`graphic_status` was in the edits and not suppressed,
  push to the linked issue (27977–27981). Suppression keys `pid`/`pid|comp` in `_sxrNoLinearPush`
  consumed single-shot at 27909–27912 (used by point-adopt to break the inbound→outbound echo).
- `_sxrFlushAllPending` on tab-hide/pagehide/client-switch (27801, wired 29232–29233).

### Archive (MEASURED)
- Single: `archiveSxrCard` (27527) confirm → optimistic removal + per-client localStorage
  anti-resurrection ledger (`syncview_sxr_archived_v1_<slug>`, refs = id + both Linear links; 60 s
  grace 26342, 24 h hard TTL in `_sxrCleanArchiveLedger` 26795) → `_sxrArchiveOne` (27544) waits out
  an in-flight save then upserts `{id, status:'Archived', updated_at}`; failure → rollback + ledger
  remove + forced reload.
- Bulk: select-mode (`_sxrToggleSelectMode` 26695, shift-range over on-screen selectable cards only
  27550–27567) → `_sxrArchiveSelected` (27578): slug pinned at click time, ledger pre-populated,
  `Promise.allSettled` of per-id `_sxrArchiveOne` (**not pooled** — the calendar's `_calRunPooled`
  6-concurrency has no SXR twin in current code; parity log said one was built — absent now), failed
  refs rolled back + reload.
- Reads exclude archived server-side: `?or=(status.is.null,status.neq.Archived)` (26804), plus
  client-side `_sxrIsArchivedRef` defense (26749) for the webhook fallback; cache also stores only
  non-archived rows with quota-evict-then-drop fallback (26726–26748).

### Reorder (MEASURED)
- Drag wiring `_sxrWireDragOnCard`/`_sxrWireStrip` (27689/27712). Drop handler (27719–27741):
  reads DOM order; **recycles the visible cards' existing order_index slots** — de-duped, strictly
  increasing, skipping slots held by non-visible posts (so the tiebreaker-free order_index sort
  can't snap a card back); no-op if nothing changed.
- Persist `_sxrPersistReorder` (27755): serialized + coalesced (latest pending wins), payload
  `{client, items:[{id, order_index}]}` via `_sxrReorderFetch` (EF or n8n per flag). Failure →
  revert to captured order + "Couldn't save the new order" notify (no Undo toast — the calendar's
  reorder-undo has no SXR twin in current code).
- Optimistic pin `_sxrReorderOptimistic` map, 12 s guard (`SXR_REORDER_GUARD_MS` 27750), applied in
  `_sxrMergeServerRows` (28980–28987) so a stale background fetch can't snap the order back.
- Collisions: server does blind per-row updates (EF source); FE slot-recycling minimizes collisions
  with hidden/archived rows but two SMMs dragging concurrently = last-write-wins per row, healed by
  the next reload's sort. No transactionality.

## 5. The review workflows

### Card sub-status triggers — the LOCK (MEASURED; contradicts the spec's recorded decision)
`_sxrRenderInlineCard` (27445): each component pill computes `lock = !link` (27458–27459) and
renders the trigger `disabled title="Link a Linear sub-issue first"` (27467) when that component has
no Linear sub-issue. The comment says "mirror _calRenderInlineCard". This **reverses
SAMPLES_REBUILD_SPEC.md §7 decision 1** ("triggers ALWAYS actionable … do NOT lock unlinked
triggers") and the parity log's "DELIBERATE DIVERGENCE" entry. Inconsistencies created by the lock:
- `_sxrSetAllSettable` still returns `true` unconditionally (27328) — **"Set all to…" bypasses the
  lock** and can set an unlinked component's status.
- Review-tab approve/request-change, the Notes modal (client_added auto-status), Kasper handlers,
  and Linear point-adopt all still change unlinked components' statuses freely.
So the lock only gates the Sheet card's per-component menu. A fresh unlinked sample can still be
routed via Set-all or comments — but the primary per-component affordance is dead until a Linear
link is pasted. The card also shows a "Link the Linear sub-issue" warn overlay when
`linear_issue_id` is empty (`needsLinear`, 27451/27483 — video link only).

### SMM Review tab (`smmreview`) (MEASURED)
- `_SXR_REVIEW_CFG` (28120): smm = {reviewStatus 'For SMM Approval' → approveTo 'Kasper Approval'},
  client = {'Client Approval' → 'Approved'}. `_sxrReviewMode()` (28121).
- Queue `_sxrReviewItems` (28136): SMM mode requires media (`_sxrHasMedia` 28116 — asset_url or
  thumbnail_url non-empty) and any component at 'For SMM Approval' or (SMM-visible) 'Tweaks Needed';
  overall-'Approved' rows excluded; sorted by order_index. Toolbar badge `_sxrApprovalBadgeCount`
  (28123) counts cards (not components) awaiting the mode's reviewStatus (SMM: media-gated).
- Panel `_sxrReviewPanelHtml` (28202): per-component preview (video tile / thumbnail lightbox
  28267–28289), approve split-button (primary route = Kasper if not seen by Kasper yet, else
  Client — "First review" badge 28239), AAT pill (28240), comment vs request-change (draft-gated:
  a non-empty draft disables Approve and enables Comment/Request change 28221–28223).
- `_sxrReviewApprove` (28442): if SMM and open change-requests exist → **resolve-and-route chooser**
  `_sxrShowResolveDest` (28360, shared `#resolveDestOverlay` DOM; checklist when ≥2 open tweaks;
  routes kasper|client|approved|stay). `_sxrReviewApplyApprove` (28476): sets `<comp>_status` to the
  route; **client mode stamps `client_<comp>_approved_at`** (28490); routing to Kasper records
  `kasper_seen` CSV via `_sxrRecordKasperSeenOnPost` (28488/28103); status+stamps folded into
  `_sxrPendingEdits` → flush; rollback on failure.
- `_sxrReviewRequestTweak` (28517): appends an `is_tweak` root comment (round numbered
  `_sxrNextTweakRound` 28067), sets comp → 'Tweaks Needed', clears stale approvals, flush; then
  mirrors the tweak text to the linked Linear issue via `_sxrPostLinearComment` (28541–28543);
  client role gets a "Change request sent" toast.
- `_sxrReviewComment` (28500): non-tweak comment; audience = client-role→'client' else 'internal';
  no status change.

### Client portal (`?sxr=1&c=…&v=sample-reviews`) (MEASURED)
- `mountSxrClientView` (28901): embedded shell ("Sample reviews" title), lands on Review tab; tabs
  Review + Sheet. Visibility `_sxrIsClientReady` (28895): a sample is client-visible once **any
  component has left 'In Progress'**; archived never. No collab mode.
- Client can: expand review cards; per-component **Approve** (only at Client Approval / Tweaks
  Needed — handler guard 28483/28523), **Request change** (→ Tweaks Needed + client tweak comment),
  plain **Comment**; open Notes (internal/Kasper threads hidden — `_sxrCommentsForView` 28068
  filters role==='kasper' and roots whose audience isn't 'client'); delete own comments
  (`_sxrCanDeleteComment` 28693 — smm can delete anything, client only client comments); **no**
  resolve, **no** audience toggle (client roots are always audience 'client'; a client root can be
  Comment vs Request-a-change via the compose toggle 28724, is_tweak auto-status `client_added` →
  'Tweaks Needed' 28787/28849).
- Client Sheet tab: `_sxrRenderInlineCard` ro branch — read-only name/links (open-only pills;
  thumbnail pill hidden entirely when ro 27031–27035), read-only status pills
  `_sxrClientCompPillsHtml` (27400), creative direction visible unless hidden, **no** add/edit/
  archive/drag/select/Linear pile (27447–27489). Reorder drop handler hard-blocks client persistence
  (27720).
- Status labels relabelled for clients via shared `_calStatusLabel` (26910–26918); on the SMM
  surface 'Client Approval' renders as "<ClientFirstName> Approval" from `sxrState.client`.

### Kasper SAMPLES sub-tab (cross-client queue) (MEASURED)
- Registration: `KASPER_SUBTABS.splice(1, 0, {key:'samples', …})` gated on `_sxrEnabled()` (32011);
  dispatch `_kasperState.tab === 'samples'` → `_sxrKasperRenderQueue` (32204/32412); global realtime
  subscribe on Kasper mount (32247); pre-count loader `_kasperEnsureAllTabCounts` (33408–33412).
- Load `_sxrKasperLoadQueue` (29337): `_sxrKasperFetchAllSamples` (29330) — **cross-client** REST
  read of `sample_reviews` with the same archived-exclusion filter, via the shared compound-key
  paginator; parallel SMM map load (`_kasperLoadSMMMap`) for the per-card SMM row + Slack deep link.
- Membership (29349–29358): non-archived AND (`_sxrPostKasperVisible` OR finished) AND not closed.
  `_sxrCompKasperVisible` (29263): comp at 'Kasper Approval', or at 'Tweaks Needed' with an
  unresolved kasper-role tweak; **an unlinked graphic (`graphic_linear_issue_id` empty) is never
  Kasper-visible** (29264) and never blocks Finish (29279).
- Queue partition (29318): **Waiting** (undecided) vs **Tweaks pending** (finished/handed-off) vs
  in-session **Approved history** (max 60, clears on reload). Local dismiss/close flags pruned when
  cards leave the queue (29361–29365).
- Card (29436): client name, pending comps, New-message chip (shared `_kasperHasUnreadReply` reading
  the same comment arrays), SMM row + Slack button (`_sxrKasperOpenSlack` 29713), Watch video,
  URGENT (video at Tweaks Needed + linked → `_sxrKasperSendUrgentSlack` 29701 →
  shared `_calUrgentSlackDispatch`), **Finish reviewing** (enabled only when
  `_sxrKasperUndecidedComps` empty 29452–29461), X-close.
- Per-component panel (29505): Approve→Client (suppressed once in Tweaks), Comment (internal note,
  no status change, no Linear ping — 29641), **Approve after tweaks** (requires draft text), Request
  change (requires draft text).
- Handlers, all through `_sxrKasperApplyAndPersist` (29563) → `_sxrKasperPersist` (29556: minimal
  patch `{id, …}` upserted with the item's OWN slug — never `sxrState`), then Linear pushes
  (status if patch carries `<comp>_status`; comment if provided):
  - **Approve** `_sxrKasperApproveComp` (29586): comp → 'Client Approval'; **first-wins stamps**
    `kasper_approved_at`/`kasper_approved_by='Kasper'` (29596–29597). Fully-decided card → history +
    remove + Undo toast; partial → stays pinned with Undo toast. **Undo** (29624) reverts status,
    re-persists, and pushes the reverted status to Linear.
  - **Request change** `_sxrKasperRequestTweakComp` (29722): kasper tweak comment + comp → 'Tweaks
    Needed'; **removes the comp from the `kasper_approved_after_tweaks` CSV** (a plain request
    supersedes a prior pre-clear, 29736–29738); folds `_sxrClearStaleApprovals` output into the
    patch (29742–29743); Linear comment = the tweak body.
  - **Approve after tweaks** `_sxrKasperApproveAfterTweaksComp` (29750): kasper tweak comment +
    comp → 'Tweaks Needed' + **adds comp to `kasper_approved_after_tweaks` CSV** (29765–29766) —
    the editor fixes first; the SMM later sees the AAT badge and the resolve chooser recommends
    routing straight to the client (28350/28356).
  - **Finish** `_sxrKasperDismiss` (29657): guard = no undecided comps. Clean approve-all → history;
    any unresolved kasper tweak → stamps `kasper_finished_at` = latest message time, appends to
    `kasper_finish_log` (29679: append-only JSON, cap 50) and persists BOTH — but see the
    kasper_finish_log finding below; marks seen (`_kasperMarkSeenAt`).
  - **Close (X)** `_sxrKasperClose` (29688): stamps + persists `kasper_closed_at`; card re-surfaces
    when a message newer than the stamp arrives (`_sxrKasperIsClosed` 29309).
  - Finished re-surfacing `_sxrKasperIsFinished` (29295): ONLY a component genuinely back at
    'Kasper Approval' resurfaces a finished card; a mere reply does NOT (deliberate parity with the
    calendar's rollout).
- **`kasper_finish_log` is dead payload for samples (MEASURED):** the FE persists it (29676), but it
  is (a) not in the EF ALLOWED list, (b) **not a column of `sample_reviews`** (live-schema baseline
  194–223; `kasper-finish-log-migration.sql` is calendar-only). Whether the live n8n
  sample-review-upsert also drops it is outside my domain, but the schema has nowhere to put it.
  Cross-device finish behaviour still works via `kasper_finished_at`; only the LOG is lost
  (same-device `_sxrKasperState.dismissed` is the acknowledged fallback, comment 29652–29656).

## 6. Approvals & stamps — semantics summary (MEASURED)

| Field | Written by | Cleared by | Semantics |
|---|---|---|---|
| `client_video_approved_at` / `client_graphic_approved_at` | client Approve (28490) | `_sxrClearStaleApprovals` when comp drops below {Client Approval, Approved} | per-component client sign-off stamp |
| `kasper_approved_at` / `kasper_approved_by` | Kasper Approve, first-wins (29596–7) | `_sxrClearStaleApprovals` when NO comp at/above the set | overall Kasper sign-off (one stamp per round) |
| `kasper_seen` | CSV of comps, set whenever a comp is routed to Kasper Approval (28488, 28856) + local `syncview_sxr_kasper_seen_v1` cache | never cleared by FE | drives "First review" badge + approve-split default + resolve recommendation |
| `kasper_approved_after_tweaks` | CSV; Kasper AAT adds comp (29766) | Kasper plain Request-change removes comp (29737); badge self-hides once comp Approved (28114) | pre-clearance: skip Kasper re-review after the fix |
| `kasper_finished_at` | Finish with unresolved tweaks (29669); value = latest message ts | overwritten each Finish (single stamp) | cross-device "handed to SMM"; also his seen-watermark |
| `kasper_closed_at` | X-close (29691) | re-surfaces when latest msg > stamp (29314) | cross-device hide |
| `kasper_finish_log` | Finish (29676) | — | **dropped server-side (no column, not ALLOWED)** |

## 7. Comment threads (MEASURED)

- Storage: per-component JSON strings `video_tweaks`/`graphic_tweaks`; empty list serializes to ''
  (`_sxrStringifyComments` 28052). Object shape (from the writers 28509/28527/28781/29647/29728):
  `{id:'c_<ts36>_<rand>', parent_id, author, role: smm|client|kasper, body, created_at, updated_at,
  audience: internal|client (root only; replies inherit root's — `rootAudience` 28074), is_tweak,
  round (tweak roots), done, done_at, done_by, deleted (tombstone), hidden (legacy filter)}` —
  **same shape as the calendar** (`comments_v2` parity per the registry).
- Delete = tombstone `deleted:true` cascading root→replies (28832); EF merge keeps tombstones 30 d.
- Audience: `_sxrMsgAudience` (28065) — explicit audience wins, else role kasper/smm → internal.
  Client view filter (28068–28076) drops kasper-role messages entirely and non-client-audience
  threads. SMM composer has the Kasper/team vs Client audience toggle (28723); client composer has
  Comment vs Request-a-change (28724); both have a Video/Thumbnail component picker (28725).
- Every Notes append **also posts to the linked Linear issue** for that component
  (`_sxrAppendComment` 28788 → `_sxrPostLinearComment`), regardless of audience — internal notes
  included (no-op when unlinked). Review-tab request-change pushes its body too (28543); Kasper
  request/AAT push bodies via `_sxrKasperApplyAndPersist` (29576); Kasper internal Comment does not.
- Merge: LWW by `updated_at||created_at` per id, union both sides (`_sxrMergeCommentLists` 28054);
  server-side twin is the `sample_review_merge_comments` RPC (EF 243–252).
- Unread dot: shared `_notesGetSeen` ledger keyed by post id (`_sxrHasUnreadNotes` 28554);
  open/close marks seen (28612).
- Resolve: SMM-only (`_sxrCanResolveComment` 28694); resolving the LAST open change-request defers
  to the resolve-and-route chooser (28806–28807 → `_sxrResolveLastTweak` 28421 →
  `_sxrApplyAutoStatus` trigger 'smm_resolved_last' 28843–28859, dest kasper|client|approved|stay).

## 8. Linear integration (MEASURED)

- Link columns: `linear_issue_id` (VID) + `graphic_linear_issue_id` (GRA); manual paste only (§4).
- **Outbound push** `_sxrPushStatusToLinear` (29064): shared generic `LINEAR_SET_STATUS_URL`
  webhook; per-issue serialized + coalesced (`_sxrLinearPushChain`/`Latest`); **hard-rejects
  'Scheduled'/'Posted'** (29066 — belt-and-braces; SXR statuses can never hold them). Fired from:
  flush (component status in the patch, 27979–27980), Kasper apply-persist (29575), Kasper undo
  (29637). Failures enqueue to the durable outbox.
- **Outbox**: separate key `syncview_sxr_linear_outbox_v1` (26153), items
  `{id:'slob_…', kind: status|comment, payload, attempts, lastError, queuedAt}`, max 6 attempts,
  60 s retry timer, flush on load + window focus (29044–29062, wired 29237–29238). Console helper
  `window.clearSxrLinearOutbox` (29062).
- **Comments out**: `_sxrPostLinearComment` (29076) → shared `LINEAR_ADD_COMMENT_URL`,
  fire-and-forget + outbox.
- **Point-adoption** `_sxrSyncStatusFromLinear` (29085): on fresh link set/move, POST
  `LINEAR_SUBISSUES_URL {url}`; a parent (has sub-issues) → skip adopt (link kept — see §4 finding);
  else map via shared `_calMapLinearStatusStrict` (aliased 26165), **reject Scheduled/Posted**
  (29097), write through pending-edits with self-echo suppression (`_sxrNoLinearPush` 29102).
- **Inbound**: NO front-end batch pull. Inbound Linear→sample rides the n8n embedded branch
  (`Handle Sample Linear Event` in calendar workflow `MJbMZ789B5ExZz9x` per docs) → row update →
  Supabase realtime → `_sxrV2OnRealtimeChange`. Convergence backstop =
  `scripts/sample-linear-reconcile.js` + `.github/workflows/sample-linear-reconcile.yml` (10-min),
  which extracts `SXR_COMPONENTS`/`computeSampleOverallStatus`/`_sxrClearStaleApprovals`/
  `_calMapLinearStatusStrict`/`_calNormStatus`/`_calIdentFromUrl` from index.html **by name**.
- **DEAD CODE finding (MEASURED):** the FE stale-Linear-regress layer the parity log (M4) says was
  built is **absent or disconnected in the current file**:
  - `_sxrReassertLinearStatus` (29111) is defined but has **zero call sites**.
  - `_sxrIsStaleLinearRegress`, `_sxrRecentSaveReconcile`, `_sxrReconcileHasGenuineTweak` do **not
    exist** anywhere in index.html.
  - `_sxrLocalRecentSaves` (27679) and `_sxrRecentSaveFields` (27680) are populated on every save
    (27961–27965) but **never read**.
  The only live regress protection is `_sxrIsLocalStatusFresh` (29041, 5-min grace) keeping local
  rows in `_sxrMergeServerRows` (28968), plus the 10-min reconciler's most-recent-action-wins.
  Practical effect: a stale inbound echo landing >5 min after a local SMM/Kasper status change can
  regress the card until the reconciler heals it. (Whether this layer was removed deliberately
  between 06-26 and now is not derivable from the tree — no git history in this checkout.)

## 9. Realtime & freshness (MEASURED)

- Per-slug channel `sxr-<slug>` on `sample_reviews`, filter `client=eq.<slug>`
  (`_sxrV2EnsureSubscribed` 29138–29150); own supabase-js client instance (29125, 5 events/s);
  debounce 350 ms, self-echo window 4 s keyed off `_sxrLastLocalWriteAt`, busy re-arm, catch-up
  reload on re-subscribe (29149), pending-drain after loads (29164), teardown on nav-away (12125).
- Kasper global channel `kasper-sxr`, unfiltered on `sample_reviews` (29194–29216): 1.5 s debounce,
  busy detection `_sxrKasperViewBusy` (29182: saving/half-typed drafts/focused textarea/4-s echo
  window), 2 s re-arm; teardown `_sxrKasperV2Teardown` (29217).
- Tab-return refetch `_sxrRefreshOnReturn` (29026): visibilitychange + focus + pageshow → one
  throttled background reload (8 s min interval); registered only when the flag is on (29230–29236).
- Background merge `_sxrMergeServerRows` (28961): keep-local when pending edits / save in flight /
  status fresh (5 min); comment-merge both directions; keep local-only blank/new/failed cards;
  reorder pin. Repaint economics: `_sxrPostsEqualForRender` (28941) skips identical repaints (only
  refreshes unread dots); `_sxrIsBusy` (28994) defers repaints during editing (1.2 s poll 29004).
- SWR cache `syncview_sxr_cache_v1_<slug>`, 7-day TTL, live-rows-only, quota-evict-then-drop
  (26713–26748).

## 10. SAMPLES OLD (`_sm*`, `content_samples`) (MEASURED)

- Module 11096–12176 (fenced by the samples CSS at 4030). Nav renamed **"Samples Old"** (4457) but
  fully alive: nav button always visible, `#samples` hash route, boot-gate FAST path, client link
  `?c=&v=samples` still routed (25632, `_smLinkClient` 11130), history-restore includes 'samples'
  (26011). **Zero retirement mechanics in code** — no flag, no banner, no read-only mode.
- Data model (`_smNormalize` 11298): `{id ('s_<ts36>_<rand>' — 11139/11843), kind: reel|thumb
  (11110), order_index, label, media_url, creative_direction (legacy alias `rationale`),
  hide_creative_direction (TRUE/FALSE strings on the wire — 11914), comments (single JSON array —
  NOT per-component), status: Active|Archived, approval: draft|kasper|client|approved|changes
  (`_smApprNorm` 11188), kasper_approved_at/by, client_approved_at/by, created_at, updated_at}`.
- Approval machine (11180–11252): editor drives draft→kasper→client (send / approve&send / send
  back / back-to-draft / re-send); client surface (or editor preview `smState.mode==='client'`)
  sees only client/approved/changes (`SM_CLIENT_VISIBLE_APPR` 11187) and drives approve / undo /
  request-a-change (change request opens the Notes modal, `_smChangeReqPending` 11252).
  Stamps written by `_smApprApply` (11236).
- Reads: Supabase REST `content_samples?select=*&or=(status.is.null,status.neq.Archived)&client=eq.
  <slug>&limit=5000` (11378) → fallback `samples-get` webhook; realtime channel `sm-<slug>` (11418)
  with the same self-echo/deferral pattern; v2 default-ON since 2026-06-15 (`?sv2=0` opt-out, 11334).
- Writes: **100% n8n, unchanged** — no EF routing, no runtime flag, no actor headers:
  - `_smFlushCardSave` (11905): **whole wire row** (never a patch) to `samples-upsert`
    `{client, sample}`; **no comments_base_at, no server merge contract** in the FE call; failure →
    chip "Saved on device" and the change silently stays local-only (11921).
  - Delete = confirm "Delete this sample? … can't be undone" → upsert `{id, status:'Archived'}`
    fire-and-forget, errors swallowed, **no rollback** (11852–11862).
  - `_smPersistReorder` (11887): whole-list renumber 1..N (11882) → `samples-reorder`, errors
    swallowed (11891).
- **No Linear coupling whatsoever** (no linear columns, no push, no adopt, no outbox — grep-clean).
- Comments: single thread per sample, audience toggle exists (`_smComposeAudience` 11925),
  role smm|client (no kasper role writer — Kasper has no old-samples surface).
- Kasper: **the old module has no Kasper surface**; Kasper-stage samples sit in `approval='kasper'`
  and are advanced by the SMM pressing "Approve & send to client" on Kasper's behalf.
- Share link `smCopyShareLink` (12059): `?c=<name>&v=samples[&t=<token>]` (no sxr flag needed).

## 11. Where each surface lives (routing summary, MEASURED)

| Surface | Entry | Code |
|---|---|---|
| SMM SXR (Sheet+Review) | nav "Samples New" / `#sample-reviews/<slug>[/<id>]` | `mountSxrView` 26410 |
| Client SXR portal | `?sxr=1&c&v=sample-reviews[&t]` | boot 25730–25763 → `mountSxrClientView` 28901 |
| Kasper SXR queue | `?Kasper=1` → Samples subtab | 32011/32204/32412; loaders 29337 |
| SMM old samples | nav "Samples Old" / `#samples[/<slug>[/<id>]]` | `mountSamplesView` 11494 |
| Client old samples | `?c&v=samples[&t]` | 25632/25723 → `_smLinkClient` |

---

## DIFFS vs 2026-07-03 snapshot

**Changed (new since the 2026-07-03 code audit):**
1. **SXR writes are dual-routed n8n ⇄ Edge Function per client (Track A A2/A4 shipped).** Baseline
   (2026-07-03-code.md §3 "Samples New") described `sample-review-upsert`/`-reorder` as n8n-only.
   NOW: `SXR_UPSERT_EF_URL`/`SXR_REORDER_EF_URL` (26147/26150), runtime flag
   `sample_review_ef_clients` in `syncview_runtime_flags` (26155, read 26222, realtime-subscribed
   26236, routed 26264–26269), and all four SXR write funnels go through
   `_sxrUpsertFetch`/`_sxrReorderFetch`. Repo now contains the EF sources
   `supabase/functions/sample-review-upsert/index.ts` (405 ln) and `sample-review-reorder/index.ts`
   (93 ln) — baseline §5 listed only onboarding-capture + client-credentials as live EFs. Flag
   population (per 2026-07-04 gate evidence): `{"clients":["sidneylaruel"]}` — everyone else still
   writes via n8n.
2. **New write metadata headers** `X-Syncview-Actor/Role/Source` on every SXR write (26270–26275) —
   did not exist at baseline. Note: the EF accepts but does not record them.
3. **Old-samples Supabase read now excludes archived rows server-side**: baseline cited
   `content_samples?select=*&client=eq.<slug>&limit=5000` (then :11284); current URL adds
   `&or=(status.is.null,status.neq.Archived)` (now :11378). Same archived-exclusion also present on
   both SXR reads (26804, 29334) — baseline's citation (`?select=*&client=eq.<slug>` at 26370) had
   no filter, so this landed (or was under-described) since the snapshot. ESTIMATE on timing: the
   surrounding comments ("long-lived test/QA clients accumulate thousands") suggest a recent
   perf fix; no git history in this checkout to date it.
4. **All line numbers moved** (+533 lines total: 36,022 → 36,555). Re-anchored map: constants block
   26135–26155 (was ~26370 region), `_sxrFlushCardSave` 27864 (baseline 27445), `_sxrArchiveOne`
   27544 (was 27049), reorder engine 27747–27777 (was ~27263), `_sxrKasperPersist` 29556 (was
   29057), realtime 29123–29239 (was 28650/28703), Kasper subtab 29241–29770.

**Changed vs the samples SPEC/parity-log record (state drift, timing unknown):**
5. **Unlinked-component status triggers are now LOCKED** on the SXR Sheet card (27458–27467,
   "Link a Linear sub-issue first") — reversing SAMPLES_REBUILD_SPEC §7 decision 1 and the parity
   log's "DELIBERATE DIVERGENCE (triggers always actionable)". `_sxrSetAllSettable` still returns
   true (27328), so Set-all bypasses the lock — the two affordances now disagree.
6. **The SXR FE stale-Linear-regress layer is gone/disconnected**: `_sxrReassertLinearStatus`
   defined-never-called (29111); `_sxrIsStaleLinearRegress`/`_sxrRecentSaveReconcile`/
   `_sxrReconcileHasGenuineTweak` absent; `_sxrLocalRecentSaves`/`_sxrRecentSaveFields` write-only
   (27679–27680, 27961–27965). Baseline §4 described stale-regress re-assert as a calendar feature
   and the parity log claimed SXR twins — the twins are not in the current tree.
7. **URGENT exists on both SXR surfaces** (SMM card 27435; Kasper queue card 29701) — the parity
   log's M5a note "v1 omits URGENT" is stale; baseline §3 already listed URGENT for "SMM calendar +
   Kasper card" without mentioning samples.
8. **No `_sxrRunPooled`/bulk-archive pooling and no reorder Undo toast** in SXR (bulk archive =
   flat `Promise.allSettled` 27611; reorder failure = revert+notify only, 27764–27772) — parity-log
   claims of cloned `_sxrRunPooled`/`_sxrUndoReorder` do not match current code.

**Unchanged and confirmed:**
- SXR GA default-ON with `?sxr=0` sticky opt-out (26176–26191); default-OFF isolation inverted to
  "opt-out isolation" as documented.
- Status vocabulary (6 + Archived), worst-of overall, `_sxrClearStaleApprovals` semantics, no
  Scheduled/Posted anywhere in SXR push/adopt (26135–26337, 29066, 29097).
- Write contract `{client, sample: patch|whole, comments_base_at:''}` + `__CLEAR_LINK__` +
  thumb_rev bump; optimistic funnel, rollback field set, failed-new retention (§4 above).
- Realtime channels `sxr-<slug>` + `kasper-sxr`; tab-return refetch; SWR cache; archive ledger.
- Kasper queue mechanics (finish/close/AAT/undo/first-wins stamps) and the `kasper_seen` /
  `kasper_approved_after_tweaks` CSV semantics.
- Comment JSON shape + audience gating + tombstones + merge RPC contract (now also enforced by the
  EF port, byte-compatible guards).
- SAMPLES OLD is byte-level the same design as baseline: n8n-only writes (whole-row upsert /
  fire-and-forget archive / swallowed reorder), draft→kasper→client→approved+changes approval,
  reel|thumb kinds, zero Linear coupling, still fully user-reachable ("Samples Old" nav + client
  link `?v=samples`). Retirement remains aspirational — nothing in code moves it forward.
- Reconciler by-name extraction contract (scripts/sample-linear-reconcile.js:59–71) — the
  no-rename constraint on `computeSampleOverallStatus`/`_sxrClearStaleApprovals`/`SXR_COMPONENTS`
  still holds.
- `sample_reviews` live DDL matches the FE/EF model; `video_status_at`/`graphic_status_at`
  trigger columns present (live-schema-baseline-2026-07-03.sql:194–223).

---

## TRACK B IMPLICATIONS

1. **`origin='samples'` concretely means**: `deliverables.card_id` = `sample_reviews.id`
   (client-scoped — note the PK is `(client, id)`, so `card_id` alone is ambiguous without
   `client_slug`; the spec's `deliverables.client_slug` covers it, but the back-link resolver must
   join on BOTH). One sample row can source **two** deliverables (video + thumbnail) — the sample's
   two Linear slots (`linear_issue_id` VID, `graphic_linear_issue_id` GRA) map to two deliverable
   rows with `kind='video'|'thumbnail'`, both `origin='samples'`, both `card_id=<sample id>`. The
   spec's §9.2 "two buttons per card" matches the SXR Linear pile 1:1 (`_sxrLinearPileHtml` 27092).
2. **Fields the new workspace must READ from a sample**: name (title-sync §9.4), asset_url/
   thumbnail_url (+thumb_rev for previews), video_status/graphic_status (per-team status),
   video_tweaks/graphic_tweaks (comment threads §9.5), creative_direction (+hide flag) as the
   brief-analogue, order_index, status(overall/Archived), the Kasper columns for review-state
   badges. Fields it must WRITE (or trigger writes of, via the sync engine): per-component status;
   comment threads (reuse `sample_review_merge_comments` — spec already says so); name;
   `deliverable_id` (new nullable column on `sample_reviews`, per spec §2). **It should NOT write**
   the approval stamps or kasper_* columns — those belong to the review flows.
3. **Status-set mismatch to reconcile at B0**: `deliverables.status` check-constraint includes
   Triage/Backlog/Todo/Scheduled/Posted/Canceled; samples legitimately use only the 6 SXR statuses
   and can never hold Scheduled/Posted (push AND adopt reject them — 29066/29097). The sync engine
   must clamp sample-linked deliverables to the SXR set or define an explicit mapping (e.g. Linear
   Triage/Backlog/Todo currently map into the card set via `_calMapLinearStatusStrict`); otherwise a
   deliverable moved to 'Scheduled' on the board would be unrepresentable on its sample card (the
   FE would keep re-asserting its own status — see also implication 6).
4. **The unlinked-trigger LOCK is a live UX dependency on Linear**: today a fresh sample's
   per-component status menus are disabled until a Linear sub-issue URL is pasted (27459). Track B
   §9.2 replaces the link buttons — the lock predicate must be re-pointed from
   `linear_issue_id`/`graphic_linear_issue_id` to `deliverable_id` (or dropped, restoring the spec's
   original "always actionable" decision). If B4 removes Linear links while the lock still keys off
   them, every new sample becomes status-dead on the Sheet (only Set-all would work). Also the
   "Link the Linear sub-issue" thumb warn (27483) and the dupe-link warning (27219) need the same
   re-point; the spec's DB-level unique index on `deliverables.linear_issue_id` supersedes the FE
   dupe scan.
5. **The comment→Linear mirror is broader than the spec assumes**: §9.5 says review comments post
   "through n8n into Linear"; in SXR **every Notes append** (internal audience included) mirrors to
   the linked Linear issue (28788), plus request-change bodies from all three roles. The internal-
   comments migration must decide whether internal notes keep mirroring to the deliverable's
   activity feed (probably yes — it's the editor's inbox replacement) and must keep the audience
   flag out of client view when rendering deliverable threads.
6. **The FE stale-regress hole (dead `_sxrReassertLinearStatus` + missing regress detectors) is a
   pre-existing weakness the Track B sync engine inherits and should FIX, not port**: with
   Supabase-authoritative phases (B4) the loop-prevention `source` tag (§4 of the spec) replaces
   the echo/suppression machinery; the interim B3 (Linear-authoritative) still leans on the 10-min
   reconciler as the only >5-min convergence net for samples. Worst case to plan for: inbound echo
   regressing a just-approved component for up to 10 min. Any Track B code that touches
   `loadSxrCards`' merge should also delete or revive the write-only `_sxrLocalRecentSaves`/
   `_sxrRecentSaveFields` maps rather than leaving the ambiguity.
7. **Reuse surface for the Production tab build**: the SXR module remains the canonical clone
   template (fenced, namespaced, flag-gated, per-client runtime-flag write routing, EF+n8n dual
   path, realtime + outbox + SWR + optimistic funnel). The `_sxrUpsertFetch`-style
   flag-routed writer + `X-Syncview-*` headers are exactly the pattern `_prod*` writes should copy;
   note the EF must actually PERSIST actor/role into `deliverable_events` (the samples EF currently
   drops them — don't replicate that gap).
8. **Old samples**: `content_samples` has no Linear coupling, so Track B owes it **nothing** except
   a retirement decision; it shares only the client token gate and pins. Its existence does mean
   the "samples calendar" wording in the spec must unambiguously mean SXR (`sample_reviews`) —
   deliverables should never point at `content_samples` rows. Retiring Samples Old before B2 would
   remove one client-facing surface from the migration blast radius.
9. **Events ledger**: `sample_review_events` (+ the EF's buildEvents action vocabulary: create,
   archive, status_change, approve_*, kasper_approve/finish/close, link_set/link_clear,
   comment_add) is the working prototype for `deliverable_events`; the spec already names it as the
   clone source — confirmed accurate, including the `waitUntil` best-effort insert pattern.
10. **Reorder/`sort_key`**: SXR's slot-recycling `order_index` (text column, blind per-row updates,
   no tiebreaker) is the weakest concurrency spot in samples; deliverables' `sort_key numeric` +
   board drag should not copy the blind per-row update pattern without at least the same
   optimistic-pin + slot-recycle discipline (or a single-statement batch update).
11. **Roster note**: samples share the calendar's pins + `wlNormalizeClient` + `WL_CLIENT_NAMES`
   allowlist (26398–26401, 26419); the §3 roster cutover automatically covers both samples surfaces.

---

## UNKNOWNS

1. **Live n8n state** for `sample-review-upsert`/`-reorder`/`-get` and the embedded
   `Handle Sample Linear Event` branch — out of my domain (repo-only audit). In particular whether
   the n8n upsert's ALLOWED list ever gained `kasper_finish_log` (moot for samples: the column
   doesn't exist in the table).
2. **Current live value of `syncview_runtime_flags.sample_review_ef_clients`** — the repo evidence
   (2026-07-04 gate doc) says `["sidneylaruel"]`; I could not query Supabase (read-only discipline +
   domain scope). If another auditor expanded the flag since 07-04, all "n8n-primary" statements
   shift accordingly.
3. **When the unlinked-trigger lock and the stale-regress-layer removal landed** — the checkout has
   no git history (`Is directory a git repo: No`), so I can only assert current-state divergence
   from the spec/parity-log record, not the commit/date/intent. If the deployed GitHub Pages build
   differs from this working tree, the diffs could differ too (tree == deployed is an ASSUMPTION;
   REDEPLOY_2026-07-03.md implies main was shipped 07-03, and Track A code here is dated 07-04).
4. **Whether Supabase realtime actually delivers on `syncview_runtime_flags`** (table in the
   publication?) — the FE subscribes (26243) but delivery is a backend property I can't verify from
   code; the once-per-boot fetch is the guaranteed path.
5. **`sample_review_events` row volume / whether the ledger inserts succeed in practice**
   (best-effort `waitUntil`, errors swallowed) — needs a live Supabase check.
6. **Client `client_review_token` population** for samples client links (both old + SXR fail open
   when empty) — data lives in the Clients Info sheet, not the repo.
7. **Whether any browsers still run `?sxr=0` / `?sv2=0` opt-outs** (would exercise n8n/webhook
   fallback read paths) — telemetry doesn't exist in the app.
8. **The exact live RLS on `sample_reviews`/`content_samples`** — the migration files declare anon
   SELECT `using(true)`, matching baseline §6, but live policies weren't re-dumped in my domain.
