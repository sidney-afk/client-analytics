# Track B re-audit 2026-07-05 — index.html: THE THREE REVIEW FLOWS (client / Kasper / SMM), calendar + samples

Auditor scope: `/home/user/client-analytics/index.html` @ HEAD `7a58b97` (36,555 lines; was 36,022 in the
2026-07-03 snapshot — **every line number in old docs is stale; all citations below are symbol + CURRENT line**).
Method: MEASURED = read directly from current source (and `supabase/functions/*` in-repo EF code). ESTIMATE/INFERENCE
labeled inline with method. No live system was written to; no live n8n/Supabase/Linear queried in this session
(read-only repo audit; server-side behavior of webhooks is cited from the 2026-07-03 n8n snapshot and marked as such).

Shared vocabulary (MEASURED):
- `CAL_STATUSES` (13503): `In Progress, For SMM Approval, Kasper Approval, Client Approval, Tweaks Needed, Approved, Scheduled, Posted`.
- `CAL_PRIORITY` (13506) worst→best: `Tweaks Needed:0, In Progress:1, For SMM Approval:2, Kasper Approval:3, Client Approval:4, Approved:5, Scheduled:6, Posted:7`. Overall card status = worst-of sub-statuses, `computeOverallStatus` (13556).
- `CAL_COMPONENTS` (13507) = `video, graphic, caption` (feed overall status). `CAL_REVIEW_COMPONENTS` (13515) adds `title` (review surfaces only; title NEVER feeds overall). `CAL_TITLE_STATUSES` (13518) = same set minus Scheduled/Posted. `_calComponentsFor(post)` (13533): title joins only for an engaged YouTube card.
- SXR (Samples New): `SXR_STATUSES` (26135) = same minus Scheduled/Posted; `SXR_PRIORITY` (26136); `SXR_COMPONENTS` = `SXR_REVIEW_COMPONENTS` = `video, graphic` (26138–26139); `computeSampleOverallStatus` (26307) seeds at 'Approved'.
- `COMP_LABELS` (22538): video=Video, graphic=Thumbnail, caption=Caption, title=Title.

Write plumbing shared by all three flows (MEASURED — **this is new since 2026-07-03**):
- Calendar card writes go through `_calUpsertFetch` (13407) which routes per client to the **Supabase Edge Function** `CALENDAR_UPSERT_EF_URL` (`…/functions/v1/calendar-upsert`, 13258) when the client slug is in runtime flag `calendar_upsert_ef_clients` (key const 13319; read from `syncview_runtime_flags` at 13342 with a realtime subscription at 13367), else to n8n `calendar-upsert-post` (13256). Currently flagged: TEST client `sidneylaruel` only (EXECUTION_LOG / a4-gate-evidence).
- Every routed write now carries **actor headers** `X-Syncview-Actor` / `X-Syncview-Role` / `X-Syncview-Source` (`_calUpsertHeaders` 13401): role = `client` if `_isClientLink`, `kasper` if `#kasper` hash or `?Kasper=1`, else `smm` (13403). SXR twin `_sxrUpsertFetch` (26276) + headers (26274, role logic 26272) routes to `sample-review-upsert` EF (26147) per flag `sample_review_ef_clients` (`_sxrSampleUseEf` 26259). Reorders likewise (`_calReorderUrlForClient` 13398, EF branch in `_calPersistOrder` at 22258).
- The EF `supabase/functions/calendar-upsert/index.ts` (448 lines) keeps the n8n guard gauntlet, calls `calendar_merge_comments` RPC, and writes an append-only **`calendar_post_events` ledger** (`buildEvents` index.ts:312–381): actions `create`, `status_change` (overall + per-component), `archive`, `approve_<comp>` (from `client_<comp>_approved_at` transitions, role='client'), `kasper_approve`, `kasper_finish`, `kasper_close`, `link_set`/`link_clear`, `comment_add`/`comment_delete` — each with `{actor, role, source}` from the headers. It does **NOT** call Linear or n8n (grep: zero fetches). `sample-review-upsert/index.ts` writes `sample_review_events` (index.ts:348) but derives actor only from `kasper_approved_by` (index.ts:279) — no header actor. Linear pushes remain 100% front-end.

---

## FINDINGS A — CLIENT REVIEW (?c=<name>&t=<token>)

### A1. Entry, token check, fail-open (MEASURED)
- `_isClientLink` (26042) = `!!new URLSearchParams(location.search).get('c')` — presence of `?c=` alone flips the whole app into client mode (it also bypasses the staff password gate at 26081).
- Token check is **per-view duplicated** in `init()`; all four compare `t` against the Clients Info sheet column `client_review_token` and **fail OPEN with only a console.warn when the column is empty**:
  - Home/analytics profile (plain `?c=&t=`): gate at 25928–25940 ("link is unguarded" warn 25940), renders `renderClient` (client analytics profile).
  - `?c=&v=calendar` fast path: gate at 25663–25676; hides header/selector, sets `clientViewTab='calendar'`, renders the profile with the calendar tab (25677–25683). Client resolves against analytics client list OR the workload allowlist (`wlIsAllowedClient`, 25659) so calendar-only clients work.
  - `?c=&v=samples` (Samples Old): gate at 25706–25718; mounts legacy samples with `smState.mode='client'` (`_smLinkClient` set 25723, consumed at 11498–11499).
  - `?sxr=…&c=&v=sample-reviews` (Samples New): flag-gated block 25736–25762; gate 25745–25753; `mountSxrClientView` (28901) — client lands on `view='review'` (their approval queue), embedded shell, no per-client tabs.
- Wrong token → hard stop: "This link isn't valid" full-page message (e.g. 25665–25672). No lockout/attempt limit (cosmetic, client-side only).
- Share-link generators embed the token when present: samples `smCopyShareLink` (12062–12063), SXR (26548–26552).
- So a client link can open: **home profile, calendar, samples-old, sample-reviews**. Kasper tab and all staff tabs are unreachable UI-wise (but only UI-wise).

### A2. What a client SEES (MEASURED)
Calendar (`?v=calendar`):
- Tab set for client links: `['review','organizer','month','week']` vs SMM `['smmreview',…]` (18287).
- Review tab (`_calReviewItems` 22925): a card appears iff ≥1 component sits at **'Client Approval'** (`_calReviewComponentActive` 22576 — for a real client link `Tweaks Needed` does NOT keep a card in the queue; comment 22563–22575 documents this deliberate change; the internal non-link "client preview" still shows TN). Cards with all comps Approved/Scheduled/Posted drop unless a title review is pending (22936).
- Per card: name, weekday-date, plain-English pending label (`_calReviewPendingLabel` 22981 — "we're working on your tweaks for…" for TN comps), component pills gated by Collaborative mode (`_calClientCompPillsHtml` 19176: in-progress pills hidden unless collab ON; finished states always shown).
- Expanded card panels (`_calReviewCardBody` 23057): on a real client link ONLY components at 'Client Approval' (23068–23069). Panel = preview (video tile/thumbnail lightbox/caption/title, `_calReviewComponentPreview` 23231), Approve button, compose box, Comment + Request change buttons, and the comment thread via **`_calCommentsForView` (13722): client sees only threads whose ROOT audience='client', and anything `role==='kasper'` is hard-hidden belt-and-braces (13744)**. Tombstoned (`deleted`) and audit-suppressed (`hidden`) comments never render (13732).
- Status vocabulary is euphemised display-only for clients (`_calStatusLabel` 19144): Kasper Approval→"In team review", Tweaks Needed→"Changes in progress", Client Approval→"Ready for your review".
- Organizer (sheet) tab: cards read-only (`ro = _isClientLink && !isBlank` 19821); **status pills, Linear fields, archive, copy-card-link, set-all, URGENT are never rendered for clients** (19874, 19585, 19903, 19915–19916); month/week hide un-ready cards unless collab (`hideUnready` 22395/22462; `_calIsClientReady` 19172 = all three comps ∈ {Approved, Scheduled, Posted}). Clients can always see color tags (tooltip-explained, 22380).
- Collaborative mode (`_calIsCollabOn` 14415, per-client setting `collab_mode` in the settings pseudo-row `p_cal_settings`, `CAL_SETTINGS_PID` 14339, saved by `_calSaveSettings` 14423, toggle 14513): when ON, clients get editable TEXT fields (title/date/caption/CTA — `editableText` 19827/13936), can add cards ("Suggest a post", 19438/19452), see in-progress cards in month/week/organizer (18014, 19417, 22395), and `_calCanDragCards` (14420) opens drag on the calendar grid. Collab NO LONGER surfaces Tweaks-Needed cards into the client Review sheet (22572–22575). Blank "suggest a post" cards are always client-editable.
- SXR client portal: same pattern; `_sxrIsClientReady` (28895) = any comp has left In Progress; tabs `['review','organizer']` (26466); creative-direction field hidden from clients when eye-toggled (`hide_creative_direction`, 27383–27386).
- Samples Old client surface (`_smClientSurface` 11144): one whole-sample `approval` state machine (no per-component statuses): pill labels for the client at 11201 ("Awaiting your approval" / "Approved" / "Change requested"); internal-audience comment roots hidden (`_smVisibleComments` 11472–11477).

### A3. What a client can DO, and what each action writes (MEASURED)
Calendar review panel — per component (video/graphic/caption/+title if engaged):
1) **Approve <component>** — `_calReviewApprove` (23381) → `_calReviewApplyApprove` (23417):
   - Guard 23430–23433: a client can only approve a comp currently at `client approval` or `tweaks needed` (handler-level defense; UI already hides it elsewhere).
   - Writes: `<comp>_status → 'Approved'` (client mode `approveTo` from `_CAL_REVIEW_CFG` 22549), stamps **`client_<comp>_approved_at` = now** (23453 — only client-mode approvals stamp), recomputes overall `status`, `updated_at`; optimistic repaint / queue-card removal (`clearsCard` 23472).
   - Persist: fields land in `_calPendingEdits` (23484) → `_calFlushCardSave` (20529) → field-level patch POST `{client, post:{id, <comp>_status, status, client_<comp>_approved_at}, comments_base_at:''}` to EF-or-n8n upsert.
   - Linear: `_calFlushCardSave` pushes `linear-set-status {issue:<comp sub-issue url>, status:'Approved'}` for video/graphic when the edit carried that comp's status (20793–20800; per-issue serialized+coalesced `_calPushStatusToLinear` 15642; durable localStorage outbox `syncview_linear_outbox_v1` 15554 on failure). Caption/title: no Linear.
   - Notifications: none (no Slack, no email). Approval does NOT touch other components (per-component only).
2) **Comment** (plain) — `_calReviewComment` (23504): appends to that component's thread `{role:'client', audience:'client', is_tweak:false, done:false}` → writes only `<comp>_tweaks` (JSON array serialized into the tweaks column). **No status change, no Linear push, no notification.**
3) **Request change** — `_calReviewRequestTweak` (23543):
   - Same client surface guard (23552–23554).
   - Appends comment `{role:'client', audience:'client', is_tweak:true, round:_calNextTweakRound (13710)}`; sets `<comp>_status → 'Tweaks Needed'`; recomputes overall; `_calClearStaleApprovals` (13571) clears now-stale `client_<comp>_approved_at` for any comp below Client Approval and clears card-level `kasper_approved_at` when no comp remains ≥ Client Approval.
   - Persist patch: `<comp>_status`, `status`, `<comp>_tweaks` (+cleared stamps).
   - Linear: after the save resolves, **`linear-add-comment {issue, body:<raw tweak text>, author:<client display name>}`** via `_calPostLinearComment` (15695) to the comp's sub-issue (video/graphic only; `_calLinearUrlFor` 13768 returns '' for caption/title). The `Tweaks Needed` status itself also rides `linear-set-status` from the flush (20793). Editor is thereby notified in their Linear inbox; no Slack.
   - UX: toast "Change request sent — the team has been notified" (23625–23627). ("Notified" = the Linear comment; nothing else fires. INFERENCE from code — no other notification call exists on this path.)
4) **Notes modal** (`openCalComments` 24128; also reachable from client organizer cards): client composer defaults to a plain Comment with an explicit **"This is a… Comment | Request a change"** toggle (24348–24356; clients get NO audience toggle — everything they write is audience:'client', 24494) and a **component picker** (About the… Video/Thumbnail/Caption/Title, 24362). `_calAppendComment` (24459): replies inherit root's component+audience and are never tweaks (24487–24497); a client "Request a change" root triggers `_calApplyAutoStatus(pid,'client_added',comp)` (24505 → 24815): comp → 'Tweaks Needed' unless overall is Posted/Scheduled (24818 skips terminal). **Every video/graphic note (root or reply, comment or tweak, ANY audience) is mirrored to Linear via `_calPostLinearComment`** (24514–24516, create-only). Client can delete only their own comments (`_calCanDeleteComment` 24282; soft-delete tombstone 24616–24631); client can never resolve (`_calCanResolveComment` 24286 — SMM only).
5) Whole-post "Approve post" bar: **DEAD** — `canApprove = false` hardcoded (19857, comment: "the only surface where a client should approve is the Review tab"); handler `_calClientApprove` (20157: sets all three comps Approved + all three client stamps) is now unreachable (only residual cleanup at 24882–24886 references the bar).

SXR client portal — same machine over video+graphic: `_sxrReviewApprove/ApplyApprove` (28442/28476, same client guard 28483, stamps `client_<comp>_approved_at` 28490), `_sxrReviewComment` (28500), `_sxrReviewRequestTweak` (28517: TN + `_sxrClearStaleApprovals` 26315 + Linear comment 28542–28543 + toast 28545). Status pushes ride `_sxrFlushCardSave` (pushes at 27979–27980); `_sxrPushStatusToLinear` (29064) **client-side rejects Scheduled/Posted** (29066). SXR notes modal mirrors video/graphic notes to Linear (28788). Separate durable outbox `syncview_sxr_linear_outbox_v1` (29044–29061).

Samples Old client actions (`?v=samples`): whole-sample only — **Approve** (`_smApprApprove` 11250 → `approval='approved'` + `client_approved_at/by`, `_smApprApply` 11236), **Undo** (`_smApprUnapprove` 11251 → back to 'client'), **Request a change** (`_smApprClientChanges` 11252 → opens Notes; the flip to `approval='changes'` happens only when the note is actually sent, `_smSubmitComposer` 12014–12018), plus threaded notes (`_smAppendComment` 12026 — `{role, audience}` only; **no is_tweak, no done/resolve, no rounds**). **Samples Old has zero Linear integration and zero notifications.** Writes go to n8n `samples-upsert` (unchanged since 07-03).

---

## FINDINGS B — KASPER REVIEW (?Kasper=1)

### B1. Unlock + tab
- `?Kasper=1` → sessionStorage unlock (25785–25789; cosmetic). Kasper tab subtabs (`_kasperGotoTab` 32402): `review` (calendar Review Session), `samples` (SXR queue), `replies` (Messages), `editors`, `filming`, `sales-intake`, `client-credentials`. State `_kasperState` (32017).

### B2. Queue build — calendar Review Session (MEASURED)
- `_kasperRenderReview` (33590) → `_kasperLoadReview` (33610) → `_kasperFetchAllRelevantPosts` (33795): under v2 ONE paginated Supabase read of ALL clients' `calendar_posts` (status ≠ Archived) (33910–33937), fallback n8n `kasper-queue` batch (33938) then per-client `calendar-get` fan-out (5-way concurrency, 5-min localStorage cache). SMM map from the "Social Media Managers" **Google Sheet gviz** (`_kasperLoadSMMMap` 33750 — still Sheet-fed).
- Membership (`extract`, 33803–33869): card enters the queue iff `_calPostKasperVisible` (23986) — i.e. some component `_calCompKasperVisible` (23971): **at 'Kasper Approval', OR at 'Tweaks Needed' with an unresolved Kasper-authored tweak** (`_calCompHasUnresolvedKasperTweak` 23954: role='kasper', is_tweak, !done, !deleted) — AND the card has media (asset_url or thumbnail_url, 33848–33850). An **unlinked graphic slot is never Kasper-visible** (23980 gate; same in undecided calc). X-closed cards filtered (33666).
- Per-item snapshot for field-level patching: `_patchBase = _kasperPatchSnapshot` (34701) over `KASPER_PATCH_SCALARS` (34700 — includes `kasper_seen, kasper_approved_after_tweaks, kasper_finished_at, kasper_closed_at, kasper_finish_log, client_*_approved_at, title_status…`).
- Partition (`_kasperPartitionItems` 34113): **Waiting** vs **Tweaks pending** solely on `_kasperIsFinished` (34081): finished (stamp `kasper_finished_at` or local dismiss) stays in Tweaks-pending and returns to Waiting **only when a component is genuinely re-sent to 'Kasper Approval'** (34096; the old "any reply re-surfaces" rule was removed on purpose). Plus an **Approved history** section (server signal `kasper_approved_at` + local log merge, `_kasperMergeHistory` 34033). The tab count = Waiting only (34153).
- `kasper_seen` model: local ledger `syncview_kasper_seen_v1` (22587) + cross-device CSV column `kasper_seen` (union write via `_calRecordKasperSeenOnPost` 22760, seeded on load 13666); `_calHasBeenToKasper` (22814) also infers from status ≥ Kasper Approval or any kasper-role comment. This drives the SMM tab's smart approve default + "First review" flag, NOT queue membership.

### B3. Per-component actions on a Kasper card (calendar) (MEASURED)
Card chrome (`_kasperRenderCard` 34300): X close button, thumb+zoom lightbox, client, date, open-tweaks chip (`_kasperOpenTweakCount` 23999 — scoped to Kasper-visible comps), AAT chip, "New message" chip (`_kasperHasUnreadReply` 22685), undecided-comp pills, SMM name + Slack deep-link (`_kasperResolveSlackTarget` 35232), **URGENT** (34359, gate `_calShowUrgent` 24856: video at TN + linked), **Finish reviewing** (34349, enabled only when `_kasperUndecidedComps` (24061 — comps still at Kasper Approval; unlinked graphic exempt) is empty), Watch video, expand. Expanded body (`_kasperRenderExpanded` 34428) shows only Kasper-visible comps; single comp gets the hero layout (`_kasperHeroPanel` 34540), else grid panels (`_kasperPanelHtml` 34594). Threads render UNFILTERED for Kasper (`_calCommentsFor`, time-sorted, 34611).

1) **Approve → Client** — `_kasperApproveComp` (34799): always routes forward — `<comp>_status → 'Client Approval'` (34820; the old "send back to SMM" was removed, covered by AAT), records `kasper_seen` CSV (34819), stamps **`kasper_approved_at` (card-level, first-wins: `|| now`, 34822)**, recomputes overall, persists, then card-stays rule (34834–34847: stays while any comp still KA or unresolved Kasper tweaks; else → Approved history + removal). Toast with **Undo** → `_kasperUndoApprove` (34862: compensating persist restoring the snapshot; Linear re-pushed via the same persist).
2) **Comment** — `_kasperAddCommentComp` (34907): appends `{role:'kasper', audience:'internal', is_tweak:false}` — **no status change, no approval clearing, deliberately NO Linear comment (34949), no notification**; card stays pinned (`_touchedComps`).
3) **Request change** — `_kasperRequestTweakComp` (34961): appends `{role:'kasper', audience:'internal', is_tweak:true, round}`; `<comp>_status → 'Tweaks Needed'`; **clears** any AAT pre-clearance for the comp (35016) and stale client/kasper approval stamps (`_calClearStaleApprovals` 35022); persists; then **`linear-add-comment {issue, body, author:'Kasper'}`** (35031–35032). Card stays in Waiting (pinned) until Finish.
4) **Approve after tweaks** — `_kasperApproveAfterTweaksComp` (34898) = request-change with `approveAfterTweaks=true`: same TN flip + Linear comment, plus sets the CSV column **`kasper_approved_after_tweaks`** (`_calRecordApprovedAfterTweaks` 22778) telling the SMM the comp is pre-cleared for the client (badge logic `_calShowApprovedAfterTweaks` 22799; SMM resolve-chooser recommendation 24655–24667). Deliberately NOT a status.
5) **Finish reviewing** — `_kasperDismiss` (35134): guard = no undecided comps (35141; comments don't count as decisions). Writes NO sub-status. If no unresolved Kasper tweaks → logged to Approved history + removed. Else: appends a rich record to **`kasper_finish_log`** (`_kasperAppendFinishLog` 35072 — JSON array column, ≤50 entries, each `{at, prev, gap_min, why: initial|new-message|new-round|recheck, statuses, status_at(video/graphic), rounds, links, last_msg, overall}`; 'recheck' is the spurious-resurface bug bucket), then sets **`kasper_finished_at` = latest message created_at** (his "seen up to here" stamp, 35169–35175), persists both.
6) **X close** — `_kasperClose` (35191): writes **`kasper_closed_at` = now**; hidden everywhere cross-device; re-surfaces when a NEW message (created_at basis, `_calLatestMsgCreatedAt` 24041 — resolve bumps can't un-hide) lands after the close (`_kasperIsClosed` 34102).
7) **URGENT** — `_kasperSendUrgentSlack` (34408) → shared `_calUrgentSlackDispatch` (15743): confirm dialog → POST `send-urgent-slack {issue:<video sub-issue url>, client, name}` → n8n resolves editor from Linear + Video Editors sheet and posts to #video-editing (server behavior per 07-03 n8n snapshot, workflow TJVMyfwl85qrFGeK); button latches "Sent" per session.

### B4. `_kasperPersistPostWrite` patch mechanics + Linear pushes (MEASURED, 34720)
- Serialized per card via `_kasperPersistPost` chain (34713). Wire = `{id}` + ALWAYS all four `*_tweaks` comment cells (server 3-way merge; `tweaks` mirrors video) + ONLY scalars that changed vs `_patchBase` (34741–34744) + overall `status` if moved; `comments_base_at` = the real `_baseAt` (34747 — unlike SMM saves which send ''). POST via `_calUpsertFetch(item.slug, …)` → **EF for flagged clients** (role header = 'kasper'). Echo adoption unions comment lists (34760) and re-snapshots `_patchBase`.
- After every successful persist it pushes **both** linked sub-statuses: `linear-set-status(video url, video_status)` and `(graphic url, graphic_status)` (34771–34774) — i.e. Kasper's approve pushes 'Client Approval', his tweak pushes 'Tweaks Needed' to the editor's sub-issue. (Note: unconditional per-write re-push of both comps, not only the changed one — unlike `_calFlushCardSave` which pushes only edited comps.)

### B5. SXR Samples subtab (Kasper) (MEASURED)
- Queue `_sxrKasperLoadQueue` (29337): ONE cross-client Supabase read of `sample_reviews` (≠Archived, 29334); membership = `_sxrPostKasperVisible` (29270, same KA/TN-with-tweak + unlinked-graphic gate 29264) OR already-finished (sits in Tweaks pending), minus X-closed (29355). **No media gate here** (unlike calendar queue — diff). Partition mirror `_sxrKasperPartitionItems` (29318); finished/closed mirrors (29295/29309); Approved history is in-session only (29323).
- Actions are exact clones: `_sxrKasperApproveComp` (29586 — also stamps **`kasper_approved_by`='Kasper'** 29597, which the sample-review-upsert EF uses as the events actor), Undo (29624 — re-pushes the reverted status to Linear 29637), Comment (29641, internal, no Linear), Request change (29722 — TN + clears AAT + `_sxrClearStaleApprovals` folded into the patch 29742–29747 + Linear comment), AAT (29750), Finish (`_sxrKasperDismiss` 29657 + slim `_sxrKasperAppendFinishLog` 29679 — fewer fields than calendar's), Close (29688), URGENT (29701 — same shared dispatch/workflow).
- Persist `_sxrKasperPersist` (29556): **explicit patch object per action** (not snapshot-diff) + `comments_base_at:''`; `_sxrKasperApplyAndPersist` (29563) then pushes `linear-set-status` only if the patch carried that comp's status (29575) and `linear-add-comment` when tweak text given (29576).

### B6. Messages / Replies inbox (MEASURED)
- Built during the calendar queue fetch: any card (any status, incl. Posted) with `_kasperHasUnreadReply` (22685) — a non-Kasper message on an **internal-audience** thread **Kasper owns** (authored or replied on; `_kasperOwnedThreadRoots` 22669), newer than his per-device `_kasperSeenAtMap` stamp (22607). Rendered by `_kasperRenderReplies`/`_kasperRepliesCardHtml` (33416/33452): unread threads by default, "Show all", per-card "Open" deep link `#calendar/<slug>/<pid>`, "Mark as read" (`_kasperMarkRepliesRead` 33545 — stamps `_kasperRepliesSeenBasis` 22713, carefully NOT the global latest so resolve-bumps can't bury unread replies), and a Reply composer.
- **Reply** (`_kasperRepliesReply` 33551): lands as a threaded reply (`parent_id` = root of the latest owned internal thread on `_kasperLatestInternalComp` 22738) `{role:'kasper', audience:'internal', is_tweak:false}`; persists via `_kasperPersistPost`; clears the card from the inbox. No Linear push, no notification.
- **Where do CLIENT replies land?** Structural finding: the inbox gate requires the thread ROOT audience to be 'internal' — clients cannot see internal threads, so a client message can essentially never satisfy the gate. Client feedback reaches Kasper only via card re-surfacing rules and unread-dots on the card/queue, NOT the Messages inbox — despite the empty-state copy "When the SMM or client replies…" (33445) and the "New from Client" chip code (33514). LABEL: INFERENCE from code paths; not exercised live.

### B7. Editors subtab (MEASURED)
- `_kasperRenderEditors` (35281) / `_kasperLoadEditors` (35371): POST `editors-week {}` (EDITORS_WEEK_URL 13275) → every VID-team sub-issue with activity last week (Mon–Sun, America/Chicago) grouped per assignee; work counted client-side as DELIVERIES (`_kedSplitVideos`; hand-offs into For SMM/Kasper/Client approval from a held state; comment 35269–35279). Read-only; pure Linear dependency (Track B §D7 replacement target: a `deliverable_events` query).

---

## FINDINGS C — SMM APPROVAL

### C1. 'For SMM Approval' semantics + who sets it (MEASURED + INFERENCE)
- The status exists in all vocabularies (norm accepts legacy "SMM Approval", 13549). It is set by: (a) **the editor moving the Linear sub-issue** into the team's For-SMM state → org webhook → n8n `linear-status-sync` (workflow MJbMZ789B5ExZz9x) → minimal `{id, video_status|graphic_status}` patch back through the upsert (per 07-03 n8n snapshot; the FE never calls it); (b) an SMM manually via the sheet status pill; (c) nothing in the client/Kasper flows ever sets it. INFERENCE (consistent with spec §9.7 "delivery → status For SMM Approval").
- SMM Review tab queue (`_calReviewItems` mode 'smm', 22941–22943): card must HAVE MEDIA (`_calHasMedia` 22828) and a component at 'For SMM Approval' (TN comps count as in-flight display only). Missing-media cards are flagged on the calendar instead (`_calSmmMediaGap` 22837, overlay/banner/dot 22876–22893). Badge count `_calApprovalBadgeCount` (22900).

### C2. SMM review-tab actions (MEASURED)
- Panel (`_calReviewPanelHtml` 23084 smm branch): smart split Approve button — primary destination = **Kasper** if the comp has never been to Kasper (`_calHasBeenToKasper`), else **Client**; the alternate destination is the attached segment (23196–23205); "First review" badge (23186); AAT badge when Kasper pre-cleared (23192).
- **Approve & send** `_calReviewApprove` (23381): if the comp still carries OPEN change-requests (`_calOpenTweaksForComp` 24673) the **resolve-destination chooser** opens first (`_calShowResolveDest` 24704: tick which requests are handled → route Kasper / Client / straight-to-Approved; from Review there is no 'stay'); ticked roots marked done via `_calResolveTweaksDone` (24684: done/done_at/done_by + updated_at bump). Then `_calReviewApplyApprove` (23417): smm mode `approveTo` = 'Kasper Approval' | 'Client Approval' | 'Approved' by dest (23445); routing to Kasper records the `kasper_seen` CSV (23450). **No SMM approval timestamp exists** — only client stamps and kasper_approved_at; the EF events ledger records `status_change` with role='smm' as the audit trail.
- **Comment** (`_calReviewComment` 23504): SMM review-tab comments are `{role:'smm', audience:'internal', is_tweak:false}` — team-only, no status change, no Linear.
- **Request change** (`_calReviewRequestTweak` 23543): SMM tweaks are also **audience:'internal'** (23565–23571 — the client never sees SMM/Kasper review-tab change-requests) but still flip the comp to TN and mirror the text to Linear (23620–23621) so the editor sees it.

### C3. Sheet-view status controls (MEASURED)
- Per-component pill → `_calStatusPick` (19995): client-blocked; free choice of any CAL_STATUSES per comp; **video/graphic pills are LOCKED until a Linear sub-issue is linked** (19882 `is-locked` + disabled); side-effects: overall recompute, `_calClearStaleApprovals`, `_calMarkLocalStatus` (5-min anti-reconcile grace), flush + per-comp Linear push. Whole-card status dropdown = bulk override of all three comps (20013–20026). "Set all to…" (`_calSetAllStatus` 20091): settable comps only (`_calSetAllSettable` 20081 — caption always; video/graphic only when linked), confirm dialog for terminal states (Approved/Scheduled/Posted, 20087/20136).
- Title pill (YouTube + title_review setting, `_calTitlePillShown` 13540): same menu over CAL_TITLE_STATUSES; title never affects overall or Linear.

### C4. Notes modal, audience + resolve (MEASURED)
- SMM composer: **audience toggle "Who sees this? Kasper/team | Client"** (24337–24345, default 'internal' on every open 24139), component picker, roots-only; SMM roots are ALWAYS plain comments (`is_tweak:false`, 24495 — SMM requests changes only from the Review tab). Replies inherit root audience/component; internal roots show a lock icon to staff (24215).
- **Audience model** (`_calMsgAudience` 13695): explicit `audience` wins; default = 'internal' for role kasper/smm, 'client' for client (safety net for untagged legacy team messages). `_calMsgIsTweak` (13700): absent field = true (every legacy message was a tweak).
- **Resolve** (`_calToggleCommentDone` 24537): SMM-only (`_calCanResolveComment` 24286), tweak-roots only (plain comments have no Mark-done, 24301); resolving the LAST open tweak on a comp defers the whole mutation into the chooser (`_calResolveLastTweak` 24785) → route pick fires `_calApplyAutoStatus(pid,'smm_resolved_last',comp,dest)` (24815: TN → Kasper Approval | Client Approval | Approved; 'stay' = plain mark-done). Reopen supported (24303). `done/done_at/done_by` + `updated_at` bump for merge-wins. Deleting a tweak never routes (24634–24638).
- Every note append on video/graphic also mirrors to Linear (24514) — including INTERNAL ones (the editor's Linear inbox is considered team space).
- Unread-dot ledger `syncview_notes_seen_v1` (22628; `_calHasUnreadNotes` 22643 — respects client view-filter).

### C5. URGENT + collab (MEASURED)
- SMM URGENT button on the sheet card (`_calSendUrgentSlack` 15720, render 19888): identical gate + payload + confirm as Kasper's (shared `_calUrgentSlackDispatch` 15743; payload `{issue, client, name}`; session latch; n8n resolves the editor — the FE never names the editor).
- Collab mode = per-client cross-device setting written as the settings pseudo-row through the same upsert path (settings writes now EF-routed for flagged clients via `settings_ef_clients` → but note: cal settings ride `calendar-upsert`; the A4 `settings_ef_clients` flag (13320) governs templates-save/caption-prompts-save EFs). Effects enumerated in A2 above.

---

## FINDINGS D — CROSS-CUTTING

### D1. Comment object model (MEASURED)
Stored as JSON arrays serialized into text columns `video_tweaks/graphic_tweaks/caption_tweaks/title_tweaks` (legacy `tweaks` mirrors video). Shape: `{id, parent_id, author, role: 'smm'|'client'|'kasper', body, created_at, updated_at, is_tweak, audience: 'internal'|'client', round?, done, done_at, done_by, deleted?, hidden?, source?}` (mint 23896; legacy seeding `_calLoadCommentsField` 13599 creates role:'smm' rows). There is **no 'system' role** anywhere (grep). Replies point at the ROOT (flat threads); audience/type live on the root only. Soft-delete tombstones + `hidden` audit-suppression both survive merges (13725–13731). Merge = per-id newer-updated_at-wins union client-side (`_calMergeCommentLists`/`_calMergePostComments`) + server 3-way `calendar_merge_comments` / `sample_review_merge_comments` RPC.

### D2. Who sees whose comments (MEASURED)
| Viewer | Filter | Sees |
|---|---|---|
| Client link | `_calCommentsForView` 13722 / `_sxrCommentsForView` / `_smVisibleComments` 11472 | Only threads with root-audience 'client'; anything role='kasper' hard-hidden; no tombstones/hidden |
| SMM (staff session) | unfiltered (minus deleted/hidden) | everything, with lock icon on internal roots |
| Kasper | unfiltered on his queue panels (34557, 34611); inbox restricted to internal threads he owns | everything on cards; inbox = his internal conversations only |

### D3. What lands in Linear today (MEASURED; all via n8n `linear-add-comment` / `linear-set-status`, unauthenticated webhooks, hardcoded Linear key server-side per 07-03 n8n snapshot — redacted)
Mirrored (create-only, fire-and-forget + durable outbox):
1. Client Request-change text — review panel (cal 23621 / SXR 28543).
2. Kasper Request-change + Approve-after-tweaks text (cal 35032 / SXR 29576).
3. SMM Request-change text — review tab (same path as 1, role smm).
4. **ALL Notes-modal messages on video/graphic comps** — roots AND replies, comments AND tweaks, internal AND client-audience (cal 24514 / SXR 28788).
5. Status pushes: every video/graphic sub-status change from any surface (flush 20793–20800; Kasper persist 34773–34774; SXR flush 27979–27980; SXR Kasper 29575; undo paths; stale-regress re-assert `_calReassertLinearStatus` 15678, 20 s throttle).
App-only (never reach Linear): plain review-panel comments (client/SMM/Kasper), Kasper inbox replies… wait — inbox replies ARE Notes-array appends but are persisted via `_kasperPersistPost`, which does NOT call `_calPostLinearComment` → app-only (MEASURED: 33551–33586 has no Linear call); resolve/reopen/delete state; caption/title threads entirely; ALL Samples-Old comments; kasper_seen/AAT/finish/close columns.

### D4. Full transition table — `video_status` / `graphic_status` (MEASURED; caption/title noted where they differ)
| # | Actor+UI | Precondition | Write | Side-effects |
|---|---|---|---|---|
| 1 | Editor via Linear (inbound) | any | `<comp>_status` = mapped Linear state (`_calMapLinearStatusStrict` 15530: tweak→TN, smm→For SMM, kasper→KA, client→CA, approved, scheduled, posted, backlog/todo→In Progress, else null) | n8n patch via upsert; reconciler most-recent-wins; FE grace `_calMarkLocalStatus`/`_calRecentSaveFields` protects fresh local writes |
| 2 | SMM sheet pill (`_calStatusPick` 19995) | link required for video/graphic | any status | overall recompute; `_calClearStaleApprovals`; Linear push of that comp; EF event `status_change` role smm |
| 3 | SMM whole-card dropdown (20013) | — | all 3 comps = chosen status | as above ×3 |
| 4 | SMM Set-all (`_calSetAllStatus` 20091) | linked comps only | settable comps = status | confirm on terminal; as above |
| 5 | SMM Review approve (23417) | comp at For SMM Approval (or TN via chooser) | → Kasper Approval / Client Approval / Approved (dest) | kasper_seen CSV if →KA; open tweaks resolved via chooser; Linear push |
| 6 | SMM Review request-change (23543) | comp at For SMM Approval | → Tweaks Needed | internal tweak comment; Linear comment+status; stamps cleared |
| 7 | SMM Notes resolve-last (24785/24815) | last open tweak on comp | TN → KA / CA / Approved (or stay) | mark-done ride same flush; kasper_seen if →KA; stamps cleared |
| 8 | Client Review approve (23417 client) | comp at Client Approval / TN | → Approved | `client_<comp>_approved_at` stamped; Linear push 'Approved'; EF event `approve_<comp>` role client |
| 9 | Client Review request-change (23543) | comp at CA / TN | → Tweaks Needed | client-audience tweak; Linear comment+status; stamps cleared; toast |
| 10 | Client Notes "Request a change" (24505/24815) | overall not Posted/Scheduled | comp → TN | same as 9 minus surface guard nuances |
| 11 | Kasper approve (34799 / SXR 29586) | comp at Kasper Approval | → Client Approval | kasper_approved_at (first-wins) + kasper_seen; SXR adds kasper_approved_by; Linear push; EF event kasper_approve |
| 12 | Kasper request-change / AAT (34961 / 29722 / 29750) | comp Kasper-visible | → Tweaks Needed | internal tweak; AAT CSV set (AAT) or cleared (plain); `_calClearStaleApprovals`; Linear comment + status push |
| 13 | Kasper Finish (35134) / Close (35191) | decided / — | **no status write** | kasper_finished_at + finish_log / kasper_closed_at; EF events kasper_finish/kasper_close |
| 14 | Reconciler (scripts/linear-sync-reconcile.js, cron) | drift | most-recent-action-wins via `video_status_at`/`graphic_status_at` DB stamps | out of FE scope; extracts FE fns by name |
Caption: rows 2–10 apply (no Linear ever, no link-lock). Title: rows 2 (title pill, CAL_TITLE_STATUSES), 5–10 via review comps when engaged; no Linear; `client_title_approved_at` stamped/cleared (13584).
Approval stamps lifecycle: set only at rows 8 (client_*) and 11 (kasper_*); cleared by `_calClearStaleApprovals` (13571/26315) whenever the comp regresses below Client Approval / card has no comp ≥ CA.

### D5. Events ledger (NEW, MEASURED)
`calendar_post_events` written ONLY by the calendar-upsert EF (flagged clients only → today only `sidneylaruel`); n8n path writes no events. `sample_review_events` written by the sample-review-upsert EF (pre-dates; actor from `kasper_approved_by` only — no role/actor headers consumed, index.ts:279). ⇒ For all real clients there is **still no event ledger on calendar** — audit trail = the approval stamps + Sheets/Linear history.

---

## DIFFS vs 2026-07-03 snapshot (docs/audits/2026-07-03-code.md)

CHANGED / NEW (all MEASURED against current source):
1. **Write routing is now flag-gated dual-path** (Track A merged 07-04): `_calUpsertFetch` (13407) + `_sxrUpsertFetch` (26276) + reorder EF branch (22258) select Edge Functions `calendar-upsert`, `calendar-reorder`, `sample-review-upsert`, `sample-review-reorder` per client via `syncview_runtime_flags` (`calendar_upsert_ef_clients`, `sample_review_ef_clients`) with realtime flag subscription; **all six review-flow write sites (card save, review approve/tweak, Kasper persist, SXR twins) now funnel through these routers** — the 07-03 statement "ALL operational writes go through unauthenticated n8n webhooks" is no longer unconditionally true (TEST client only, n8n fallback everywhere).
2. **Actor/role headers**: every calendar/SXR upsert now sends `X-Syncview-Actor/Role/Source` with role inferred client/kasper/smm (13401–13405, 26272–26274). Not in the 07-03 audit.
3. **`calendar_post_events` ledger** exists in the EF (buildEvents index.ts:312) incl. `kasper_finish` / `kasper_close` / `approve_<comp>` events — new capability, EF-path-only.
4. **SXR Kasper approve stamps `kasper_approved_by`** (29597) — powers sample_review_events actor.
5. Line drift (+533 lines): representative relocations — webhook consts block now 13255–13293 (was ~13155); `_calSaveSettings` 14423 (was 14216); `_calFlushCardSave` 20529 (was ~20423); Kasper persist `_kasperPersistPostWrite` 34720 (was 34208); `_sxrKasperPersist` 29556 (was 29057); `submitPassword` region moved (~25800s); `_isClientLink` def 26042.
6. Settings EF flag `settings_ef_clients` (13320) + `templates-save`/`caption-prompts-save` EFs in repo (A4) — adjacent to, not part of, the review flows.

UNCHANGED AND CONFIRMED (spot-verified in current source):
- Token gate + **fail-open on empty `client_review_token`** (25674, 25717, 25753, 25939) — still Sheet-driven, still cosmetic.
- `_CAL_REVIEW_CFG` / `_SXR_REVIEW_CFG` two-surface review machine; client approveTo='Approved', smm approveTo default 'Kasper Approval'.
- Comment model (role/audience/is_tweak/round/done/tombstone), `_calMsgAudience` defaults, client-view filtering incl. hard kasper-role hide.
- Kasper queue predicates (`_calCompKasperVisible`, unlinked-graphic gate), Finish/Close/finish_log semantics, KASPER_PATCH_SCALARS field-level patch, Replies inbox owned-thread gating, Editors=editors-week.
- Linear FE layer: `linear-set-status`/`linear-add-comment`/`send-urgent-slack` webhooks, per-issue serialized pushes, durable outboxes (separate SXR key), re-assert, "Posted never pushed" is enforced client-side ONLY in SXR (29066); the calendar `_calPushStatusToLinear` (15642) has **no Posted guard in code** — the no-op relies on the n8n workflow skipping absent states (07-03 n8n audit) — worth knowing for Track B parity tests.
- `calendar-append-post`/`calendar-delete-post` consts (13259–13260) still defined, still never called.
- Whole-post client approve bar still dead (`canApprove=false`, 19857).
- Samples Old approval machine (single `approval` field, no Linear, no resolve) unchanged; still writes via n8n `samples-upsert` only — NOT flag-routed.
- Kasper reads: v2 Supabase all-rows read with kasper-queue/calendar-get fallbacks; SMM map still Google-Sheet gviz.

---

## TRACK B IMPLICATIONS (spec §§6, 9.5, 11 vs measured reality)

1. **§9.5 redirect inventory — the exact write paths that move to the deliverable's Supabase `comments` thread** (each currently POSTs `{issue, body, author}` to n8n `linear-add-comment`):
   - `_calReviewRequestTweak` post-flush push (23620–23621) — client + SMM change-requests, calendar.
   - `_calAppendComment` Notes→Linear (24514–24516) — ALL video/graphic notes modal messages (roots+replies, comments+tweaks, both audiences).
   - `_kasperRequestTweakComp` / AAT (35031–35032) — Kasper calendar tweaks.
   - `_sxrReviewRequestTweak` (28542–28543), `_sxrAppendComment` (28788), `_sxrKasperApplyAndPersist` comment arg (29576) — SXR twins.
   - Retire both outboxes (`syncview_linear_outbox_v1` 15554, `syncview_sxr_linear_outbox_v1` 29044) or repoint them at the EF during transition (spec's "mirror to Linear during transition" needs the outbox kept for the mirror leg).
2. **Comment payload upgrade**: today's Linear mirror carries only `body+author` and flattens role/audience. The deliverable thread should adopt the FULL existing comment object (role, audience, is_tweak, round, done/done_by, parent_id) — the app already has richer semantics than Linear ever saw; §9.5's "reuses the samples comment-merge RPC" is compatible since both surfaces already serialize the same shape.
3. **Audience mapping decision needed**: internal (audience:'internal') notes are currently pushed into Linear because editors live there. Post-migration the deliverable thread IS the internal surface — but the spec must state that client-audience comments remain visible on the card/client link (comments live in card `*_tweaks` today; if they move to the deliverable thread wholesale, the client link must read them from there, or the card thread stays authoritative and the deliverable thread only mirrors team-relevant items).
4. **Caption/title have NO deliverable**: `_calLinearUrlFor` (13768) returns '' for them and nothing syncs. §9.5 "comments write to the deliverable's thread" cannot apply — caption/title threads must stay card-local (or the spec needs per-card threads distinct from per-deliverable threads). This is currently unstated in the spec.
5. **Review action → deliverable status transition map** (replacing every `linear-set-status` call site: 20793–20800, 34773–34774, 27979–27980, 29575, 29637, 15678):
   - editor delivery → `For SMM Approval` (today inbound-only; §9.7 keeps it)
   - SMM approve→Kasper = `Kasper Approval`; →client = `Client Approval`; →approved = `Approved`
   - Kasper approve = `Client Approval` (+kasper_approved_at/by); Kasper/SMM/client request-change = `Tweaks Needed`
   - client approve = `Approved` (+client_<comp>_approved_at)
   - Undo paths (34862, 29624) = reverse transition — must be modeled as first-class events (the EF buildEvents already logs status_change pairs; deliverable_events should too).
   - Calendar-only `Scheduled`/`Posted` must never propagate to deliverables (SXR already refuses; calendar relies on server-side skip — Track B EF should enforce explicitly).
6. **Role gating (§6)**: the FE already ships the exact role signal Track B needs (X-Syncview-Role) and the EF already stamps actor/role into events. §6's server-side enforcement can key on the same headers — but note role is client-asserted (URL param) until real auth (§4) lands; the fail-open token is the weakest link and Track B's ROLE_KEY design supersedes it.
7. **Kasper machinery is Linear-independent already**: kasper_seen / kasper_approved_after_tweaks / kasper_finished_at / kasper_closed_at / kasper_finish_log are card columns + the queue is a Supabase read. Only the URGENT ping, `linear-add-comment`, `linear-set-status`, `editors-week`, and the sub-issue link columns tie the review flows to Linear. §D7's editors-week→deliverable_events swap and §11's notify EF (URGENT) cover the rest; the unlinked-graphic gates (23980, 29264, 24068) must be re-pointed from `graphic_linear_issue_id` to `deliverable_id` or thumbnails silently drop out of Kasper review after cutover.
8. **Events parity**: buildEvents (calendar-upsert EF) is a ready-made template for `deliverable_events`; but today it fires only for the TEST client — Track B's "anomaly detection on the ledger" (§ monitoring) has no calendar backfill for real clients yet.
9. **The three lock-step CAL_PRIORITY copies** (FE / n8n handler / reconciler) remain; Track B removes the Linear leg but the FE↔EF status vocabulary must be locked at B0 exactly as spec §10 note says (status-name strings reconcile).
10. **Whole-post approve** (`_calClientApprove`) is dead code — the Production tab should NOT reproduce a whole-card approve; per-component (=per-deliverable) approval is the real model, matching §9.2's per-deliverable buttons.

---

## UNKNOWNS (what I could not verify and why)

1. **Live n8n workflow code** for `linear-set-status`, `linear-add-comment`, `send-urgent-slack`, `linear-status-sync` — cited from the 2026-07-03 n8n snapshot; not re-queried this session (read-only caution + scope). In particular: whether the **calendar** branch of `linear-status-sync` routes its writes through the calendar-upsert EF for flagged clients (EXECUTION_LOG documents the A2 edit only for the "Handle Sample Linear Event" branch).
2. **Server-side no-op of 'Posted' pushes** on the calendar path — code sends it (no client-side guard at 15642); the skip is n8n behavior per the snapshot, not re-verified.
3. **Live Supabase state**: existence/columns of `calendar_post_events` in the live DB (EF code inserts into it; a4-gate-evidence implies migrations applied, but I did not query); actual runtime-flag values right now (docs say `{"clients":["sidneylaruel"]}` for both keys as of 07-04).
4. **client_review_token population** per client (lives in the Clients Info Google Sheet; fail-open scope therefore unmeasured). Counts only — no token values sought.
5. Whether any real client sessions run `?v2=0` / SXR opt-outs (would put review reads on legacy paths).
6. The Replies-inbox "client replies never actually appear" conclusion is code-path inference (D/B6); not exercised in a live browser this session.
7. Whether the Kasper unconditional double status re-push in `_kasperPersistPostWrite` (34773–34774) can re-assert a stale comp status over a concurrent SMM change in a race — flagged as a code-smell (ESTIMATE: low practical risk given per-issue coalescing + reconciler), not reproduced.
