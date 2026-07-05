# Track B re-audit — index.html CONTENT CALENDAR end-to-end logic (2026-07-05)

Auditor domain: the calendar module (`_cal*` + Kasper calendar surfaces) in
`/home/user/client-analytics/index.html` @ `main` HEAD `7a58b97` (36,555 lines; baseline audit measured 36,022).
All line numbers below are CURRENT (re-located by symbol; MEASURED unless labeled ESTIMATE/INFERENCE).
Baseline: `docs/audits/2026-07-03-code.md` §2–§4. READ-ONLY audit; no live system was mutated.
A direct read of live `syncview_runtime_flags` was blocked by session policy, so live flag values are
grounded from repo records (EXECUTION_LOG.md) and marked as such.

---

## Findings

### a) CARD DATA MODEL — every calendar_posts field the FE reads/writes

Schema comment (module header, 13231–13254) plus the two authoritative field lists:

- **EF ALLOWED list** — `supabase/functions/calendar-upsert/index.ts:24–36` (`ALLOWED`): `order_index,
  scheduled_date, name, asset_url, thumbnail_url, caption, caption_alt, caption_alt_platform, post_url,
  cta, tweaks, status, linear_issue_id, kasper_approved_at, posted_at, platform, platforms, color,
  video_status, graphic_status, caption_status, graphic_linear_issue_id, video_tweaks, graphic_tweaks,
  caption_tweaks, client_video_approved_at, client_graphic_approved_at, client_caption_approved_at,
  title_status, title_tweaks, client_title_approved_at, kasper_seen, kasper_approved_after_tweaks,
  thumb_rev, kasper_finished_at, kasper_closed_at, kasper_finish_log` (+ `id`, `updated_at` minted server-side).
- **Kasper patch list** — `KASPER_PATCH_SCALARS` (index.html:34700) = same scalar set (order_index,
  scheduled_date, name, asset_url, thumbnail_url, caption, caption_alt, caption_alt_platform, post_url,
  cta, linear_issue_id, kasper_approved_at, posted_at, platform, platforms, color, video/graphic/caption_status,
  graphic_linear_issue_id, client_video/graphic/caption_approved_at, title_status, client_title_approved_at,
  kasper_seen, kasper_approved_after_tweaks, thumb_rev, kasper_finished_at, kasper_closed_at, kasper_finish_log).

Field semantics (MEASURED at the cited sites):
- `id` — text PK per (client,id); minted `p_<ts36>_<rand>` by `_calMintId` (14802); deterministic
  `p_lin_<identifier>` for intake-created cards (25391); `p_cal_settings` reserved (14339). NOT globally
  unique across clients — the keyset pagination cursor is compound (id, client) for exactly this reason
  (comment at 17282–17291).
- `name` — the single title text field of a card (`data-fld="name"` input, `_calTitleRowHtml` 19630).
  **The YouTube title IS `name`** (see §d).
- `scheduled_date` — coerced by `_calCoerceDate` on every load (17591); set by inline field edit, by
  drag-to-day in month/week views (`_calPendingEdits[id].scheduled_date` at 18898), and cleared/edited
  inline. Month filter `_calPostInMonthFilter` (14569).
- `status` — DERIVED overall; always recomputed `computeOverallStatus` (13556) from the three
  CAL_COMPONENTS sub-statuses; written alongside sub-status edits; the special value `'Archived'`
  (soft delete) is only ever written by the archive path (21096), never by the flush funnel (which would
  recompute over it — comment 21089–21091).
- `video_status`, `graphic_status`, `caption_status` — per-component workflow state (vocabulary in §c).
- `title_status` — 4th, review-only component; empty string = "never engaged" (13649).
- `asset_url` (video link), `thumbnail_url` (graphic link) — media links; editing either bumps
  `thumb_rev` (`_calBumpThumbRev` 14632; persisted through the patch at 20643) as a cross-viewer
  thumbnail cache-bust token.
- `caption`, `caption_alt`, `caption_alt_platform` — main caption + optional alt caption tab
  (13841–13878). Alt caption is NOT a 4th component: shares caption status/thread/approval.
  NOTE: on the **settings pseudo-row** `caption` holds the settings JSON (14455).
- `cta` — free text.
- `platforms` — CSV of platform keys (`_calPostPlatforms` 13836); vocabulary = 9 keys in `CAL_PLATFORMS`
  (13784): instagram, tiktok, youtube, facebook, linkedin, x, threads, pinterest. (`platform` singular
  is a legacy column that still rides the patch lists.)
- `color` — card color tag; set per card (`_calSetCardColor` 14120) and bulk (14164).
- `order_index` — numeric sort key; reorder recycles the visible cards' slots with strictly-increasing
  dedupe that also avoids hidden posts' slots (22082–22094).
- `linear_issue_id` (VID sub-issue URL), `graphic_linear_issue_id` (GRA sub-issue URL) — §e.
- The four comment-thread cells `video_tweaks`, `graphic_tweaks`, `caption_tweaks`, `title_tweaks` —
  JSON-encoded arrays (shape below); legacy `tweaks` mirrors `video_tweaks` for back-compat
  (20635, 34740; EF mirrors it at index.ts:194).
- Approval stamps: `client_video_approved_at`, `client_graphic_approved_at`, `client_caption_approved_at`,
  `client_title_approved_at` (client sign-off per component, only set in client mode — 23453);
  `kasper_approved_at` (34822); all subject to stale-clearing (§c).
- Kasper cross-device state: `kasper_seen` (CSV of components ever routed to Kasper —
  `_calRecordKasperSeenOnPost` 22760), `kasper_approved_after_tweaks` (CSV, 22771–22800),
  `kasper_finished_at`, `kasper_closed_at`, `kasper_finish_log` (append-only log column, 35071).
- `posted_at`, `post_url` — **columns exist and ride the patch lists, but the FE never writes or renders
  them anywhere in the calendar** (MEASURED: only occurrences are the schema comment 13243, rollback list
  20519, KASPER_PATCH_SCALARS 34700; the 30772 hit is the TikTok-uploads list, not calendar). "Posted" is
  purely a status string (§f).
- Client-side-only (never wire): `_baseAt` (comment-merge base), `_saveError`, `_patchBase` (Kasper),
  parsed `*_comments` arrays, `comments` alias for video_comments (13661).

**Comment-thread JSON shape** (one array per `*_tweaks` cell). Authoritative creation sites:
`_calAppendComment` (24459), `_calReviewComment` (23504), `_calReviewRequestTweak` (23543), legacy seeding
(13614, 23880):

```
{ id: 'c_<ts36>_<rand>'   (_calMintCommentId 23896),
  parent_id: null | <root id>          — replies point at the ROOT (flat 2-level threads),
  author: string           (_calCurrentAuthor 23892),
  role: 'smm' | 'client' | 'kasper',
  body: string,
  created_at / updated_at: ISO         — updated_at is the per-comment LWW merge clock (23827),
  done: bool, done_at: '', done_by: '' — resolution state (toggle 24537),
  is_tweak: bool           — change-request vs plain comment; ABSENT ⇒ true (legacy) (13700),
  audience: 'internal' | 'client'      — lives on the ROOT; replies inherit; ABSENT ⇒ team-authored
                                         defaults internal, client-authored defaults client (13695),
  round: N                 — 1-based tweak number, stamped on tweak roots (_calNextTweakRound 13710),
  deleted: bool            — soft-delete tombstone (never rendered; 30-day retention in EF mergeCell),
  hidden: bool             — audit-suppressed, preserved but never rendered/counted (13732),
  source / source_field / seeded_at    — legacy-import provenance only }
```
Client-view filter `_calCommentsForView` (13722): drops deleted+hidden for everyone; for client links
additionally shows only threads whose ROOT audience='client' and hard-hides anything Kasper-authored.

### b) CARD LIFECYCLE

**Creation paths (all funnel into calendar-upsert; `calendar-append-post`/`calendar-delete-post`
consts 13259–13260 remain defined-but-never-called):**
1. **Manual blank card** — `addCalBlankCard` (21031; client allowed only in collab mode) inserts a DOM-only
   `__blank__N` card (`_calBlankPost` 19482, `_calNextBlankId` 19194). First flush with content promotes it:
   `_calFlushCardSave` mints a real id (20555) + `_calPromoteBlankCard` (20889) rewrites identifiers; blank
   with no content is silently dropped (20552).
2. **Bulk import from Excel** — modal at 16687+, mapped rows → `_calBulkUpsertPosts` (16622): sequential
   sends w/ 350 ms gaps, then up to 3 verify-and-retry rounds against `_calFetchPostsForVerify` (16669)
   which **deliberately reads the n8n `calendar-get` (Sheet) endpoint even under v2** — see Track B
   implications: this interacts badly with the EF flag (EF writes don't mirror to the Sheet).
3. **Import from Linear parent** — paste parent link → `linear-subissues` → pick subs → posts built at
   16285–16312 with `_calMapLinearStatus(s.status)` seeding video_status (graphic from paired "Video N"
   GRA sub), `linear_issue_id`/`graphic_linear_issue_id` prefilled → same `_calBulkUpsertPosts`. Import
   also un-archives matching ledger refs (16277–16283).
4. **Linear intake-tab submission** — `_writeLinearVideoCardsToCalendar` (25251): §i. Deterministic
   `p_lin_<ident>` ids (25391).
5. **Templates "apply to calendar"** — 17096 mints a post from a template name (same funnel).
6. (Kasper/review surfaces never create cards.)

**Edit/save funnel — `_calFlushCardSave` (20529):**
- Field edits land in `_calPendingEdits[pid]` via `_calOnFieldInput`/`_calOnFieldBlur` (20478/20494;
  blocked for clients unless collab — `_calClientFieldEditBlocked` 20477), debounced
  `CAL_SAVE_DEBOUNCE_MS` = 650 ms (13780), flushed on blur immediately.
- Destination slug pinned pre-await (20539) — cross-tab-leak fix. Per-card serialization via
  `_calSaveInFlight` (20544); queued edits re-flushed in `finally` (20856).
- **v2 field-level patch** (20621–20656): only touched keys + re-derived `*_tweaks` cells for changed
  components (video also mirrors legacy `tweaks`); `status` rides only when a sub-status changed (20640);
  `thumb_rev` rides on link edits (20643); **`__CLEAR_LINK__` sentinel** (`CAL_CLEAR_LINK_SENTINEL` 20527)
  substituted for empty link values on the patch (20651–20656) because the upsert's link-clobber guard
  treats bare '' as a stale echo. v1 / brand-new rows / forced retries send the whole card (20657–20671).
- **`comments_base_at` semantics** (20672–20689): v2 sends `''` (skips the server scalar-conflict guard;
  comment 3-way merge still unions), v1 sends `post._baseAt`. Kasper persist sends the REAL `_baseAt`
  (34747), so Kasper writes retain the scalar-conflict guard.
- Optimistic UX: local mutation + `updated_at` stamp (20578), per-card chip states saving/saved/error
  (`_calSetCardStatus`), echo adopt = merge echo onto full local row THEN `_calMigratePostShape`
  (20720–20743, the status-revert fix), queued-edit overlay (20727), comment-thread union
  `_calMergePostComments` (20739), `_baseAt` advance (20742).
- Failure: `_CAL_ROLLBACK_FIELDS` (20514) rolls back structural fields only (statuses incl. title,
  order_index, scheduled_date, both linear links, the client_* stamps, kasper_approved_at, posted_at,
  kasper_approved_after_tweaks); free text keeps optimistic value; `_saveError` flag + `_calFailedNewCards`
  (14758) keeps failed creates visible/retryable; `_calRetrySave` re-sends whole card.
- Self-echo suppression: `_calLastLocalWriteAt` + `CAL_RT_SELF_ECHO_MS` = 4000 (17346–17347);
  recent-save guards `_calLocalRecentSaves`/`_calRecentSaveFields` (20750–20760) with
  `CAL_CONFLICT_WINDOW_MS` = 90 s (14739).
- **Post-save Linear push**: only when the edit carried `video_status`/`graphic_status` and a link exists
  (20793–20800); the old "overall status → video issue" branch is deliberately gone (20801–20813);
  `_calNoLinearPush` suppression set for statuses just adopted FROM Linear (20594–20602).

**Archive (soft delete)** — `_calArchiveOne` (21082): drops pending edits, awaits in-flight save, sends
`{id, status:'Archived'}` via `_calUpsertFetch` (21096); bulk archive pooled 6-wide (`_calRunPooled` 21068,
`CAL_BULK_ARCHIVE_CONCURRENCY` 21067); local archive LEDGER `_calArchivedRefs` also keyed by linear link
refs so an archived card's Linear URL hides stale twins until re-import/re-link removes the ref
(16283, 19674, 19810). Archiving is SMM-only incl. collab (21233).

**Reorder** — drop handler (22044–22104): slot-recycling + dedupe as above; snapshot for revert;
`_calRecordReorderOptimistic` (22215, pin window `CAL_REORDER_GUARD_MS` = 12 s at 22214, applied in merge
17725–17729); `persistCalReorder` (22234): serialized + coalesced (`_calReorderPending`), EF vs n8n routing
(§h), success toast **with Undo** (`_calUndoReorder` 22223), failure = rollback + toast + optimistic-pin
drop (22289–22314).

**Settings pseudo-post** — `CAL_SETTINGS_PID = 'p_cal_settings'` (14339), name `'__cal_settings__'`,
settings JSON in `caption` (wirePost at 14447–14461, status left blank so archived-row filters can't strip
it). Settings that exist (`CAL_SETTINGS_DEFAULTS` 14340 + observed keys):
- `collab_mode` (bool) — client may edit text fields/dates, drag, suggest posts (14415, 14420, toggle 14501)
- `title_review` (bool) — YouTube-title review feature toggle (13523, toggle 14535)
- `enabled_platforms` (array) — shared per-client platform set; localStorage first-paint cache +
  one-time migration push (13813–13825, 17579–17585)
- `_ts` — client-side write stamp for out-of-order arbitration (14439)
Write path `_calSaveSettings` (14423): serialized chain (14494), 3 retries w/ backoff (14468–14484),
optimistic + localStorage-durable; reconcile rule `_calReconcileSettings` (14408) — backend wins unless
local is newer AND within `CAL_SETTINGS_LOCAL_TRUST_MS` = 120 s (14358). Split off from posts on every
load by `_calSplitSettings` (14379).

### c) STATUS MODEL

- **`CAL_STATUSES` (13503)** — the definitive vocabulary, 8 states:
  `'In Progress','For SMM Approval','Kasper Approval','Client Approval','Tweaks Needed','Approved','Scheduled','Posted'`.
- **`CAL_TITLE_STATUSES` (13518)** — title menu = same minus Scheduled/Posted (6 states).
- **`CAL_PRIORITY` (13506)** — worst→best, exact quote:
  `{ 'Tweaks Needed':0,'In Progress':1,'For SMM Approval':2,'Kasper Approval':3,'Client Approval':4,'Approved':5,'Scheduled':6,'Posted':7 }`
  (comment: "Must stay in lock-step with the n8n linear-status-sync PRIORITY table").
- **`computeOverallStatus` (13556)**: worst (lowest CAL_PRIORITY) of the THREE `CAL_COMPONENTS`
  (13507 = video, graphic, caption), each defaulting 'In Progress', reduced from 'Posted'. Title NEVER
  feeds it. Written whenever a sub-status changes (20640, 20009, 20120, 23454, 23592, 24836, 34725…);
  main status dropdown with no comp = bulk override of all three subs (20017–20024).
- **`CAL_COMPONENTS` vs `CAL_REVIEW_COMPONENTS` (13507/13515)**: review/Notes/queue surfaces iterate
  `_calComponentsFor(post)` (13533) = +title only for an engaged YouTube card; overall-status machinery
  iterates CAL_COMPONENTS only.
- **`_calNormStatus` (13545)**: maps legacy strings — Draft→In Progress, "(For) Kasper Approval"→Kasper
  Approval, "SMM Approval"→For SMM Approval, case-insensitive match into CAL_STATUSES, else pass-through.
- **Row-shape migration `_calMigratePostShape` (13631)**: legacy single-status rows seed all three subs
  from `status`; otherwise blank sub = 'In Progress'; title never seeded; comment cells parsed per
  component (video falls back to legacy `tweaks`); per-comment `updated_at` seeded from `created_at`;
  `kasper_seen` CSV hydrates the local ledger (13666).
- **Stale-approval clearing `_calClearStaleApprovals` (13571)**: above-set =
  `{'Client Approval','Approved','Scheduled','Posted'}`; a component dropping below it clears its
  `client_<comp>_approved_at` (title likewise via its own branch 13584); `kasper_approved_at` cleared when
  NO component is at-or-above Client Approval (13588). Called from every status-mutation site (status pick
  20031, set-all 20126, review tweak 23618, notes auto-status 24846, Linear point-adopt 15984/16082).
- **Review surfaces** (`_CAL_REVIEW_CFG` 22549): client reviews at 'Client Approval' → approve lands
  'Approved' + stamps `client_<comp>_approved_at`; SMM reviews at 'For SMM Approval' → approve routes to
  'Kasper Approval' (default), or 'Client Approval'/'Approved' per the resolve-dest chooser
  (23444–23445); Kasper approve always → 'Client Approval' + `kasper_approved_at` (34820–34822).
  Client handler-level guard: can act only on components at Client Approval/Tweaks Needed (23430–23433,
  23552–23555). Request-change flips comp → 'Tweaks Needed' + tweak comment + Linear comment push (23543).
  Client "approve whole card" `_calClientApprove` (20157) sets all three subs Approved + all three stamps.
- **"Posted"/"Scheduled" meaning**: pure workflow labels set by the SMM via the status menus; terminal
  guards — `_calApplyAutoStatus` refuses when overall is Posted/Scheduled (24818); Linear adoption never
  knocks Posted back (15976, 16054, 16066); 'Posted' is never pushed to Linear (helper comment 15630–15633;
  the samples clone also rejects Scheduled — 29066 — but the calendar DOES push 'Scheduled').
  `_CAL_CLIENT_READY_STATES` = {Approved, Scheduled, Posted} (19171) gates client-visible readiness;
  month/week pill badge same set (22353). **posted_at is never written by the FE** (§a).

### d) YOUTUBE TITLE handling (spec §9.4 name-sync)

- **The YouTube title IS the card's `name` column.** There is no separate title text field: the title
  review preview renders `p.name` (`if (comp === 'title') { const t = String(p.name || '')…` at
  23270–23274), and the title status square sits beside the single name input in `_calTitleRowHtml`
  (19619–19630). Renaming the card = renaming the YT title.
- Feature gate: per-client settings toggle `title_review` (`_calIsTitleReviewOn` 13523; toggle
  `_calToggleTitleReviewMode` 14535). Applies to YouTube cards only (`_calIsYouTubeCard` 13520 = platforms
  CSV contains 'youtube').
- Engagement is data-driven: `_calTitleEngaged` (13528) = non-empty `title_status`; cross-client surfaces
  (Kasper queue) rely on it without settings lookups. SMM pill shown when toggle ON or already engaged
  (`_calTitlePillShown` 13540).
- `title_status` vocabulary = `CAL_TITLE_STATUSES` (13518, no Scheduled/Posted); excluded from
  computeOverallStatus & kasper_approved_at by design (comments 13508–13514, YOUTUBE_TITLE_REVIEW_DESIGN.md).
- `title_tweaks` thread + `client_title_approved_at` stamp behave like other components
  (stale-clear branch 13584; client approve stamps in `_calReviewApplyApprove` via the generic
  `client_${comp}_approved_at` key 23453).
- Removing the YouTube platform from a card strands the title review → `title_status` cleared
  (14215–14246, `_titleStranded`).
- Title has NO Linear issue (`_calLinearUrlFor` returns '' for caption/title — 13771); title notes never
  push to Linear (gate at 24514).

### e) LINEAR LINKAGE on cards

Columns: `linear_issue_id` (VID slot) + `graphic_linear_issue_id` (GRA slot). Every set/clear site:
1. **Manual paste** — `_calLinearEdit` (19632) → `_calLinearCommit` (19652) with 3 guards:
   format guard (must be linear.app URL w/ ident, 19687–19695), wrong-prefix confirm (VID vs GRA,
   19696–19708), **uniqueness guard** `_calLinkConflict` (19732) → conflict UI with "Move it here"
   (`_calShowLinkConflict` 19744 / `_calMoveLink` 19779 — clear-old-first-await-then-set ordering,
   old slot cleared via `__CLEAR_LINK__`). Commit path `applyCommit` (19669) queues edit + flush +
   un-archive ledger ref + `_calSyncStatusFromLinear`.
2. **Bulk-link modal** ("Bulk Linear sync", 16333–16612) — select cards → paste video parent (+optional
   graphic parent) → `linear-subissues` fetch (16395) → auto-match by normalized name w/ "Video N"
   pairing (`_calBulkLinkAutoMatch` 16444) → `_calBulkLinkApply` (16560) sets both links per card + flush.
3. **Import from Linear** (16309–16310) and **intake-tab card writes** (25409–25410) prefill links at creation.
4. **Clear** — empty commit in the paste editor (19718, "val may be '' … intentional clear") →
   `__CLEAR_LINK__` on the wire (20651).
5. Kasper persist carries link columns only if changed vs `_patchBase` (KASPER_PATCH_SCALARS).

**Parent-issue refusal**: `_calParentLinks` set (15787) + `_calIsParentLinked` (15843); populated when a
pasted link's `linear-subissues` lookup returns children (`_calSyncStatusFromLinear` 15960–15963: link is
KEPT but flagged, no status adopted from a parent) and from the batched `linear-issue-statuses` meta
refresh (`_calRefreshParentLinkFlags` 15875, `isSubIssue:false` branch 15925–15930); orange banner at
19862 asks for the sub-issue link. Sub-issue meta (hasProject/hasDue/hasEditor) drives the "incomplete
sub-issue" banner (`_calLinearMissingForCard` 15855), persisted in localStorage (15805) w/ 5-min force
throttle.

**Point-adoption of Linear status when a link is set** — `_calSyncStatusFromLinear` (15948): fetches the
issue, maps via `_calMapLinearStatusStrict` (15530 — tweak/scheduled/posted/approved/smm/kasper/client/
backlog/todo/in-progress; returns null for unmapped e.g. Done/Canceled so the card is left untouched),
refuses to knock Posted back (15976), writes the sub-status with `_calNoLinearPush` suppression
(15979–15985). The non-strict `_calMapLinearStatus` (15515) is used only by the parent-import picker
(defaults to 'In Progress').

**Post-load reconcile** `_calReconcileLinearStatuses` (16019): **skipped entirely under v2**
(`_calV2Ready()` early-return 16026) — v1-only batched pull with freshness guards (`_calIsLocalStatusFresh`
16000 / grace 5 min 15995; `_calIsRowRecentlyTouched` 16008) and Posted protection (16054/16066).

**Outbound push machinery**: `_calPushStatusToLinear` (15642) — per-issue serialized chain + coalescing
(`_calLinearPushLatest` 15641); failure → durable localStorage outbox `syncview_linear_outbox_v1`
(15554; max 6 attempts, 60 s timer, focus/load drains 15771–15774; console escape hatches
`clearLinearOutbox`/`peekLinearOutbox` 15623/15628). `_calPostLinearComment` (15695) same outbox.
**Stale-regress healing**: `_calRecentSaveReconcile` (14659) + `_calIsStaleLinearRegress` (14713, regress
below the ABOVE set with no genuine new open tweak comment — `_calReconcileHasGenuineTweak` 14731) →
`_calReassertLinearStatus` (15678, throttled 20 s per issue+status via `CAL_LINEAR_REASSERT_MS` 15677),
invoked from the load merge (17648–17650).

**Duplicate handling changed vs older docs**: `_calDedupeByLinearIssue` (15017) is now a PASS-THROUGH —
duplicate-linked cards are no longer collapsed; both render with a dupe banner
(`_calLinkDuplicatePeers` 15028, `_calDupeWarnText` 15054). (Change predates the baseline: commit 17ef2fc
2026-06-26; the baseline audit §4 wording "collapse" was already stale — the audit's own text says
"detected and refused" which is still accurate for parents.)

**URGENT ping**: `_calSendUrgentSlack` (15720) / shared `_calUrgentSlackDispatch` (15743) → `send-urgent-slack`
webhook `{issue, client, name}`; video-only, Tweaks-Needed-only, link-required (`_calShowUrgent` 24856);
session latch on the button.

### f) SCHEDULING / POSTING

- `scheduled_date` = a plain date; drives month view (`_calPostInMonthFilter` 14569), week view, and the
  "up next" centring in the organizer. Views (`calState.view`, allowed list 15329):
  `review` (client) / `smmreview` (SMM) / `organizer` (the card strip, labeled "Sheet" in the toolbar —
  viewLabels 18283) / `month` / `week`; render dispatch at 18761–18785. Client tabs get
  `['review','organizer','month','week']`, staff `['smmreview','organizer','month','week']` (18287).
  Drag-to-reschedule gate `_calCanDragCards` (14420) = SMM always, client only in collab.
- "Posting" a card = an SMM setting components to 'Posted' via the status menus (or Scheduled). **No
  post_url capture, no posted_at stamping, no TikTok interplay**: the TikTok upload tab is a separate
  module keyed off its own tables; nothing in `_tk*`/`_ttp*` reads or writes calendar_posts (MEASURED:
  no calendar symbol appears in the TikTok section; the only `posted_at` render at 30772 is a TikTok
  upload row). 'Posted' never pushes to Linear; auto-status refuses to run on Posted/Scheduled cards (24818).

### g) READ PATH + REALTIME

- Gates: `_calV2Enabled` (17222; default ON, sticky opt-out `?v2=0` → `CAL_V2_KILL_KEY` 13317) and
  `_calV2Ready` (17239 = flag + Supabase URL/key). supabase-js UMD lazy-loaded (17248).
- **`_calSupabaseFetchAllRows` (17293)** — keyset pagination, page size 1000 (17292), compound (id, client)
  cursor; used by both the per-client calendar read and Kasper's all-clients read.
- **`_calV2FetchPosts` (17320)** — `GET /rest/v1/calendar_posts?select=*&or=(status.is.null,status.neq.Archived)&client=eq.<slug>`;
  ANY failure falls back to n8n `calendar-get?client=` (17331). v1 (`?v2=0`) path fetches calendar-get
  directly (17542).
- **`loadCalendarPosts` (17433)** — SWR: settings hydrate from localStorage first (17459), cache prime
  from `syncview_calCache_v1:<slug>` (17469, TTL 7 d 17133, quota-eviction write 17145), background
  revalidate with 20 s two-layer timeout (17432, 17515–17528), load-seq guard (17440), settings reconcile
  (17556–17572), archived filter + archive-ledger filter + `_calMigratePostShape` (17586–17591), then the
  **LWW merge** per card (17600–17731): saveInFlight → keep local; recent-save window (90 s) → keep local
  except `_calRecentSaveReconcile` adoption of genuinely-new remote sub-statuses + stale-Linear-regress
  re-assert (17641–17652); ts LWW with local-wins tie (17661); pending-edit overlay incl. tweaks re-parse
  (17668–17681); comment union (17712); `_baseAt` advance (17718); reorder optimistic pin (17725);
  locally-trusted missing cards preserved (17742–17748). Failure keeps cards + stale notice (17765).
- **Realtime**: channel `cal-<slug>` on `calendar_posts` filtered `client=eq.<slug>`
  (`_calV2EnsureSubscribed` 17348, subscribe at 17358–17376; re-subscribe triggers a catch-up snapshot
  17371); events debounced 350 ms (`CAL_V2_RT_DEBOUNCE_MS` 13318) in `_calV2OnRealtimeChange` (17382)
  with self-echo deferral (4 s window) and in-flight-load deferral (`_calV2RtPending`).
  Refresh-on-return (focus/visibility/pageshow) `_calRefreshOnReturn` (15236, throttled via
  `_calLastNetworkLoadAt` 17534). **No idle polling** (confirmed: no setInterval on loadCalendarPosts).
- **Kasper**: batch read = ONE all-clients paginated Supabase read (33916) grouped by `client`, 5-min
  per-client cache (`KASPER_CAL_CACHE_TTL` 33778); fallback chain → n8n `kasper-queue` POST `{slugs}`
  (33943) → per-client `calendar-get` fan-out (33970+). Global realtime channel `kasper-cal`
  (unfiltered calendar_posts, 32306–32330) with busy-guarded 1.5 s debounce.
- Caption prompts read: n8n `caption-prompts-get` base + Supabase `caption_prompts` overlay ONLY for
  `settings_ef_clients`-flagged clients (`_calLoadCaptionPrompts` 21268, `_calLoadCaptionPromptsFromSupabase`
  21255 — A4, flag-scoped overlay after the d8bd92a fix).

### h) WRITE ROUTING — the `calendar_upsert_ef_clients` flag (Track A live state)

- Flag key `'calendar_upsert_ef_clients'` (13319) in Supabase table `syncview_runtime_flags`; read once at
  boot (`_calFetchUpsertFlagOnce` 13339 — anon REST GET; **any failure ⇒ empty set ⇒ n8n fallback**) and
  live-updated via realtime channel `syncview-runtime-flags` filtered on the key
  (`_calSubscribeUpsertFlag` 13367). Slugs normalized through `calClientSlug` (13329–13333).
- Resolution: `_calUpsertUseEf` (13390) → `_calUpsertUrlForClient` (13395):
  EF `https://uzltbbrjidmjwwfakwve.supabase.co/functions/v1/calendar-upsert` (13258) vs n8n
  `calendar-upsert-post` (13256). ALL SEVEN upsert call sites now go through **`_calUpsertFetch`
  (13407)**: card save 20694, settings 14471, bulk import 16626, archive 21096, intake card write 25415,
  Kasper persist 34747 (+ SXR twins use `_sxrUpsertFetch`). Headers on the EF path
  (`_calUpsertHeaders` 13401): `X-Syncview-Actor` ('SyncView'|'Kasper'|'Client'),
  `X-Syncview-Role` (smm|kasper|client — derived from `_isClientLink` / `?Kasper=1` / `#kasper`),
  `X-Syncview-Source` (default 'ui'). Note: actor is a coarse role label, NOT a person.
- **Reorder routing** `_calReorderUrlForClient` (13398) keys off the SAME upsert flag: flagged →
  EF `calendar-reorder` (13262) with **no n8n fallback on EF failure** (22258–22263: EF error surfaces as
  reorder-failed → rollback+toast); unflagged → `calendar-reorder-batch` then per-row `calendar-reorder`
  fallback (22264–22278).
- **EF implementation** (repo, deployed per EXECUTION_LOG): `supabase/functions/calendar-upsert/index.ts`
  (448 lines) — preserves the guard gauntlet: phantom-row guard (CONTENT_FIELDS, :177–187), per-cell
  comment merge w/ 30-day tombstone retention (mergeCell :151), `__CLEAR_LINK__` (:196–202), link-clobber
  guard (:204–210), duplicate-link guard vs live twins (:212–224), scalar-conflict guard against
  `comments_base_at` (:226–241), then `calendar_merge_comments` RPC + scalar update (:279–304), and NEW:
  best-effort **`calendar_post_events` append-only ledger** (:312–387 — create/status_change/archive/
  approve_*/kasper_*/link_set/link_clear/comment_add/comment_delete with actor/role/source).
  Response contract `{ok, post}` / `{ok:false, conflict}` preserved. **No Google-Sheet mirror in the EF**
  (MEASURED: no Sheets code in index.ts). `calendar-reorder` EF (97 lines) updates order_index
  **and bumps updated_at** (:75) — n8n reorder does not bump updated_at (FE comment 17722), a subtle
  semantic diff that actually helps the LWW merge for flagged clients.
- **Live flag state — from repo records, NOT re-measured live** (EXECUTION_LOG.md:77, 98, 112–115;
  docs/audits/2026-07-04-a4-gate-evidence.md): as of 2026-07-04,
  `calendar_upsert_ef_clients={"clients":["sidneylaruel"]}`, `sample_review_ef_clients={"clients":["sidneylaruel"]}`,
  `settings_ef_clients={"clients":["sidneylaruel"]}`. TEST client only; no real client enabled. A direct
  live read from this session was denied by policy (see UNKNOWNS).
- The n8n `linear-status-sync` workflow (MJbMZ789B5ExZz9x) and both reconcilers were also re-pointed to
  route per-flag (EXECUTION_LOG.md:50, 82) — so inbound Linear→card writes for flagged clients also use
  the EF (recorded, not re-verified live from this session).
- A4 settings writers: `templates-save` / `caption-prompts-save` route via `_settingsWriteUrlForClient`
  (13462) on the separate `settings_ef_clients` flag (13320), headers `_settingsWriteHeaders` (13466 —
  always Actor 'SyncView'/Role 'smm'); reads are n8n-base + flag-scoped Supabase overlay
  (loadTemplates 7383–7401; `_calLoadCaptionPrompts` 21268).

### i) The 'linear' INTAKE TAB

- Form: client picker + title builder + notes + filming-plan link + per-video cards (main/side/audio
  links; renderVideoCard 25048). Submission `submitLinearForm(mode)` (25136), mode ∈ video|thumbnail|both.
- Auto due dates: batches of 5 → +5/+10/+15… WORKING days (`wlAddWorkingDays`, 25148–25163).
- Payload `{clientName, title, notes(description incl. Filming Plan/General Drive links), videos[{number,
  main_cam, side_cam, audio, dueDate}], filmingPlans}` → fire-and-forget POSTs to `video-form` and/or
  `graphic-form` n8n webhooks (25215–25216; CORS may block response) + audit log to
  `log-linear-submission` (25198) with the raw webhook JSON for replay.
- **Direct card creation** `_writeLinearVideoCardsToCalendar` (25251): durable localStorage job first
  (`_calCardJobCreate` 25483; resumed on next app load by `_resumePendingCalCardJobs` 25499; 2-day/5-run
  caps, heartbeat vs other tabs), 15 s initial wait, then up to 20×5 s polls of `loadLinearIssues(true)`
  matching parents by (client slug, exact form title, team VID/GRA) and requiring every "Video N" sub-title
  (25276–25345); cards written sequentially 200 ms apart via `_calUpsertFetch` (25415) with
  name = "Video N", statuses all 'In Progress', both Linear URLs when matched, `p_lin_<ident>` ids
  (25391; positional fallback pairing 25364). Shortfall → visible notify + auto-retry job (25436).
- **`?intake=1` mode**: `_isIntake` (26043); body class `intake-mode` (26051) hides everything but the
  Linear tab (CSS 447–457); boot-gate routes page to 'linear' (12078, 26115); bypasses the password gate
  (26081).
- Cards' names/dates: name is always "Video N" (clients rename later on the calendar);
  `scheduled_date` is left EMPTY — the auto due dates go to Linear only, not onto the card.

---

## DIFFS vs 2026-07-03 snapshot (docs/audits/2026-07-03-code.md §2–§4)

**CHANGED (all post-baseline commits touching the calendar: c5c9794 A1, 6218f81 A2, ce86f10+d8bd92a A4,
cb37430 roster; plus e55be0e localStorage-quota guard):**
1. **Write routing is now flag-switched per client** — baseline §3 said "ALL operational writes go through
   unauthenticated n8n webhooks". Now every calendar upsert call site (all 6 FE sites + Kasper) goes
   through `_calUpsertFetch` (13407) which routes to the `calendar-upsert` Edge Function for clients in
   `syncview_runtime_flags.calendar_upsert_ef_clients`, else n8n. New symbols: CALENDAR_UPSERT_N8N_URL/
   CALENDAR_UPSERT_EF_URL (13256/13258), flag machinery 13319–13411. Recorded live state: TEST client
   `sidneylaruel` only.
2. **Reorder routing** — flagged clients POST to the `calendar-reorder` EF (no n8n fallback for them);
   unflagged path unchanged (batch → per-row fallback) (22253–22279). EF reorder bumps `updated_at`
   (n8n does not) — new semantic for flagged clients.
3. **EF writes carry identity headers** — `X-Syncview-Actor/Role/Source` (13401), and the EF writes an
   append-only `calendar_post_events` ledger (calendar-upsert/index.ts:312–387). Neither existed at baseline.
4. **A4 settings split** — templates + caption prompts now have EF write URLs (7311 TEMPLATES_SAVE_EF_URL,
   13287 CAPTION_PROMPTS_SAVE_EF_URL) and n8n-base + Supabase-overlay reads gated on `settings_ef_clients`
   (7383–7401, 21255–21296). The calendar settings pseudo-row itself (`_calSaveSettings`) rides the
   calendar upsert flag, NOT settings_ef_clients.
5. **Roster** — client lists now come from `getClientRoster()` (9066, canonical accessor over
   WL_CLIENT_NAMES ∪ Clients Info sheet); baseline's "hardcoded roster + allData-derived lists" wording
   is stale for search/templates/pins (cb37430).
6. **Line drift** — every baseline line number in §2–§4 is stale by ≈ +80–530 lines (file grew
   36,022→36,555). Re-located anchors: publishable key 13210→13314; cal channel 17091→17359; kasper-cal
   31776→32312; Kasper all-rows read 33377→33916; card-save fetch ~20423→20694; settings 14216→14471
   (function head 14423); bulk import 16365→16626 (function head 16622); archive 20828→21096 (head 21082);
   intake import ~25109→25415 (head 25251); Kasper persist 34208→34747 (head 34720); reorder 21967→22234;
   CAL_PRIORITY→13506; computeOverallStatus→13556; staff password `submitPassword` 25721→~26210 (not in my
   domain, not re-verified).

**UNCHANGED AND CONFIRMED (baseline claims re-verified in current code):**
- `calendar-append-post` / `calendar-delete-post` consts defined, never called (13259–13260; zero fetch sites).
- v2 default-ON with sticky `?v2=0` opt-out (17222–17238); n8n `calendar-get` fallback alive in
  `_calV2FetchPosts` catch (17331) and as the v1 read (17542); bulk-import verify still deliberately reads
  the Sheet endpoint (16669–16685).
- Payload contract `{client, post, comments_base_at}` with `{ok, post, conflict?}` echo — unchanged on
  both n8n and EF paths.
- Debounce 650 ms, field-level v2 patches, `comments_base_at:''` under v2, `__CLEAR_LINK__` sentinel,
  optimistic funnel, `_calRetrySave`, self-echo suppression via `_calLastLocalWriteAt` — all as baseline.
- Settings pseudo-post CAL_SETTINGS_PID mechanics, serialized chain, 3 retries, 120 s trust window.
- Reorder serialized/coalesced + 12 s optimistic pin + Undo toast.
- `linear-set-status`/`linear-add-comment` pushes with per-issue serialization + durable outbox;
  'Posted' never pushed; point-adoption on fresh link; `_calReassertLinearStatus` 20 s throttle;
  parent-link refusal; bulk-link "Video N" matching; CAL_PRIORITY three lock-step copies (FE + n8n +
  reconciler `grabFunc` extraction constraint — scripts unchanged since baseline).
- Realtime channels `cal-<slug>` + `kasper-cal`; keyset-paginated reads; SWR cache; no idle polling.
- Kasper flows (approve → Client Approval, `_patchBase` field-level patch, real `comments_base_at`).
- URGENT slack flow; caption AI job engine (n8n-only — generate-caption/caption-job-status/-update
  untouched by Track A).
- CAL_COMPONENTS vs CAL_REVIEW_COMPONENTS split and every status rule in §c.

---

## TRACK B IMPLICATIONS

1. **Name-sync (§9.4) hook points are exactly these and nothing else** — `name` is written by:
   inline field funnel (`_calOnFieldInput/Blur` 20478/20494 → `_calFlushCardSave`), Kasper patch
   (KASPER_PATCH_SCALARS diff, 34741), bulk import / Linear import / intake creation (16295, 25395), and
   the settings pseudo-row (name `'__cal_settings__'` — must be excluded from any name-sync trigger, as
   must `p_cal_settings`/blank ids). Because the YT title IS `name`, spec §9.4 needs **no extra field**:
   a deliverables title-sync that mirrors `calendar_posts.name` covers YouTube titles for free. Beware:
   `name` is NOT in `_CAL_ROLLBACK_FIELDS` — a failed save keeps the optimistic name locally, so a
   deliverable-side sync keyed on write success (event ledger / EF) is safer than one keyed on FE state.
2. **Status-sync points**: every status mutation funnels through `_calPendingEdits` + `_calFlushCardSave`
   and (for flagged clients) the EF, which already emits per-component `status_change` events with
   from/to + actor/role/source into `calendar_post_events` — this ledger is the natural inbound tap for
   the §4 mirror engine (loop-prevention `source` tag already exists: 'ui' | 'linear' | 'reconcile',
   EF index.ts:99–100). The FE's Linear-push sites to replace are exactly two: 20793–20800
   (_calFlushCardSave post-save) and 34771–34774 (Kasper persist), plus `_calPostLinearComment` call sites
   (23621, 24515) and the outbox (15554). The status vocabulary Track B must match verbatim is
   CAL_STATUSES (13503) + CAL_PRIORITY (13506); the spec §2 deliverables check constraint adds
   Triage/Backlog/Todo/Canceled which the calendar will map through `_calMapLinearStatusStrict`
   (Backlog/Todo→'In Progress', Canceled→null/no-op) — fine for B3 inbound, but note the CALENDAR never
   produces those states outbound.
3. **`deliverable_id` join**: add alongside `linear_issue_id`/`graphic_linear_issue_id` on calendar_posts.
   It must ride: the EF ALLOWED list (index.ts:24), KASPER_PATCH_SCALARS (34700), `_CAL_ROLLBACK_FIELDS`
   if structural (20514), and the n8n upsert's allowed columns. A card has TWO link slots (video+graphic)
   → the spec's single `card_id` on deliverables is right (deliverable→card), but the reverse card-side
   join needs **two** columns (video_deliverable_id + graphic_deliverable_id) or resolution via
   deliverables.card_id+kind — spec §2's single `deliverable_id` on calendar_posts is UNDER-SPECIFIED for
   the two-slot reality.
4. **The two card link buttons today** (`_calLinearPileHtml` 19607, stacked on the thumbnail; SMM-only,
   hidden from clients 19605): each opens/edits its slot via `_calLinearEdit` (19632) with format/prefix/
   uniqueness guards, and a fresh link triggers point-adoption (`_calSyncStatusFromLinear`). §9.2's
   flag-resolved retarget must reproduce: the paste-guards (or replace with a deliverable picker), the
   uniqueness guard (DB constraint in spec §2 covers it), un-archive-ledger removal (19674), the move
   flow (`_calMoveLink` ordering), and point-adoption semantics on link-set.
5. **Bulk-import verify is already broken for EF-flagged clients** (latent Track A bug Track B inherits):
   `_calBulkUpsertPosts` writes via the EF for flagged clients but `_calFetchPostsForVerify` (16669)
   checks the n8n calendar-get/Sheet, which the EF does not mirror to — imports for a flagged client will
   burn 3 retry rounds and report "couldn't be confirmed" even though every row landed in Supabase
   (INFERENCE from code + EF source + FE comment 16670–16678; not reproduced live). Fix before flagging
   any client that uses Excel/Linear import, and note for B-phase cutover checklists.
6. **Reorder for flagged clients has no fallback** (22258–22263) — an EF outage blocks reorders for them
   while n8n clients keep working. Acceptable for a TEST client; a B-phase gate item for real clients.
7. **Actor identity is still coarse** ('SyncView'/'Kasper'/'Client' — 13401): B0 auth's
   `X-Syncview-Actor` = real display name will slot into the existing header + EF ledger without schema
   change; the plumbing already exists end-to-end.
8. **Exact-reflection (B3) caveats**: the calendar refuses stale Linear regressions
   (`_calIsStaleLinearRegress`) and never adopts unmapped Linear states (Done/Canceled → null) or knocks
   Posted back — the Production tab's "reflect Linear exactly" rule will therefore disagree with the
   calendar card in those windows by design; the spec should name the reconciler as arbiter (it already
   does most-recent-action-wins via `*_status_at`).
9. **What Track B §13 can retire from THIS module**: `_calPushStatusToLinear` + outbox,
   `_calPostLinearComment`, `_calSyncStatusFromLinear`, `_calReassertLinearStatus`,
   `_calReconcileLinearStatuses` (v1-only already), `linear-subissues` import/bulk-link modals, parent-link
   banners + `linear-issue-statuses` meta fetch, URGENT-slack Linear resolution, and the `p_lin_` intake
   poll loop (§i step 2 — replace with native deliverable creation, keeping the durable-job pattern).
   The intake tab's 15–120 s Linear polling window and its title-match fragility (25349–25360 error paths)
   is one of the strongest UX arguments FOR Track B; preserve the localStorage durable-job design.
10. **grabFunc constraint still binding**: reconcilers/tests extract `computeOverallStatus`,
    `_calMapLinearStatusStrict`, `CAL_PRIORITY`, `_calRecentSaveReconcile` etc. by NAME from index.html —
    any Track B refactor renaming these silently breaks the 10-min cron + CI (unchanged from baseline).

---

## UNKNOWNS

- **Live `syncview_runtime_flags` values right now** — the direct read-only Supabase REST query was
  denied by session permission policy. Flag state cited above is from EXECUTION_LOG.md (2026-07-04
  records) + docs/audits/2026-07-04-a4-gate-evidence.md; another auditor (Supabase domain) should confirm.
  Same for whether the deployed EF versions match the repo sources (EXECUTION_LOG cites calendar-reorder
  v2 deployed after the response-envelope fix).
- **n8n-side state** — whether calendar-get still reads the Sheet vs Supabase (my bulk-import-verify bug
  is an inference resting on that: FE comment 16670–16678 + baseline n8n audit both say Sheet), whether
  the calendar-upsert n8n workflow's guard set is still byte-parity with the EF, and the current
  linear-status-sync flag-routing node code — n8n domain auditor's ground.
- **Whether the baseline audit snapshot included commits 9985f7f/e55be0e** (both dated 2026-07-03; the
  baseline's stated 36,022 lines matches neither exactly — 35,548 vs 36,224). Immaterial for logic, noted
  for diff bookkeeping.
- **Current calendar_posts row count / clients with >1000 rows** (pagination behavior at scale) — not
  measurable read-only from this session.
- **Whether any user runs `?v2=0`** (would exercise calendar-get reads + whole-card v1 writes + the
  `_calReconcileLinearStatuses` Linear pull) — telemetry doesn't exist client-side.
- **posted_at/post_url server-side writers** — the FE never writes them; whether any n8n workflow or
  historic backfill populates them on calendar_posts is unverified (Supabase/n8n auditors).
