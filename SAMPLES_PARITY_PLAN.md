# Samples (Review) ↔ Calendar SMM — Full Parity Plan

> **Status: PLAN — awaiting approval. No feature code written yet.**
> Goal: bring the SMM-facing **Samples (Review)** surface (`_sxr*`, table `sample_reviews`,
> route `#sample-reviews`, flag `?sxr=1` default-OFF) to FULL parity with the content-calendar
> SMM surface (`_cal*`, `calendar_posts`) — same create, archive, link-pasting, status behavior,
> and card management — **minus the excluded items**.
>
> **How this was produced:** an exhaustive, evidence-grounded audit of the REAL code in
> `index.html` (not memory) — 8 parallel per-dimension auditors + a top-down completeness critic,
> cross-checked by hand against the live functions. Every classification cites `index.html:<line>`.
> Line numbers are current as of this audit; they will drift as the file changes.
>
> **Guiding principle (unchanged): CLONE, don't reinvent.** Copy each calendar function into `_sxr*`,
> re-pointed to `sample_reviews` / `SXR_COMPONENTS`, so behavior **and its existing bug-fixes** match
> exactly. We avoid divergence bugs by copying what already works.

---

## 0. TL;DR — what the audit found

The Samples (Review) SMM surface is the calendar **organizer ("Sheet") view reduced to a static,
read-and-edit grid.** It already has — built + tested — the card render, the **full review/Linear/Kasper/
client lifecycle**, per-component **status pills + menu + resolve chooser**, **comments** (audience-gated,
threaded, tombstoned), the **optimistic field-patch save + rollback**, **drag-reorder**, **creative
direction + hide toggle**, and the two Linear links wired for **clear-sentinel + point-adoption + outbound
push**. That core is genuinely at parity and must NOT be rebuilt.

What was **never cloned** is the calendar's **management layer** — the affordances that let a human
*operate* the surface from zero:

| # | Gap | Status | Backend? |
|---|---|---|---|
| 1 | **Create a sample from the UI** — no add button, no empty-state hero, no blank→first-save-promote lifecycle. `_sxrFlushCardSave` literally bails: `if (idx < 0) return; // M2 has no create flow` (index.html:15783). | **MISSING (whole lifecycle)** | FE-only — upsert already creates |
| 2 | **Archive/delete a sample from the UI** — no corner X button, no `archiveSxrCard`, no anti-reappear ledger. Only the read-side `_sxrIsArchived` filter exists. | **MISSING (whole archive surface)** | FE-only — upsert already archives |
| 3 | **Toolbar** — a one-zone stub (client tabs only). No Share-with-client, no refreshing/stale/retry indicators, no approval-count badge. | **MISSING / PARTIAL** | FE-only |
| 4 | **Linear link slots** — plain URL inputs. Clear/adopt/push work, but there is **no commit-guard, no uniqueness/conflict detection, no move-to-another-card, no dupe/parent banner**. | **PARTIAL (sync-critical gap)** | FE-only — upsert honors `__CLEAR_LINK__` + has the dup-link guard |
| 5 | A long tail of **edit-experience PARTIALs** (in-place thumb repaint, render-time autosize, thumbnail harvest, reorder-failure rollback, deferred-render-on-blur, comment-union, keyboard Enter/Escape, a11y…). | **PARTIAL** | FE-only |

**The single most important structural finding: every gap is front-end-only.** The `sample-review-upsert`
webhook already creates rows (test seeding proves it), already archives (`status:'Archived'`), and already
honors the `__CLEAR_LINK__` sentinel + has the duplicate-link guard. **No Supabase / n8n / RPC / trigger
change is required for any item in this plan.**

Audit tally (114 enumerated affordances + 4 critic-found misses): **MISSING 35 · PARTIAL 27 · DONE 35 ·
EXCLUDED 11 · N/A 6**, plus the critic's reclassifications (below). Status pills/menu/resolve = **DONE**
(independently re-verified; one auditor returned a stub, so I audited it by hand — see §3.6).

---

## 1. Scope recap

**KEEP / bring to parity (everything below the line is in scope unless excluded):** video + thumbnail
components, creative direction + hide-from-client, the two Linear link slots, comments, the full review
lifecycle, extensive DB tracking — plus the management layer this plan adds.

**EXCLUDED — do NOT bring over:** caption (+ generator/prompt), call-to-action, calendar
dates/scheduling (incl. month & week views, month-filter, date-based status-filter), color tag,
all-months dropdown, all-content dropdown, import-from-Excel, import-from-Linear, bulk-Linear-sync,
edit-platforms, collaborative mode, YouTube-title review, title-in-the-review-process.

**The one shared piece (don't touch):** the inbound Linear webhook branch embedded in the calendar
workflow (see `SAMPLES_PARITY_LOG.md` §2). This plan is **100% front-end** and touches none of it.

---

## 2. The parity matrix

Format: `| Calendar affordance | Calendar fn (index.html:line) | Samples status | Plan to clone → target _sxr fn |`.
MISSING/PARTIAL rows carry full clone plans; DONE/EXCLUDED/N/A are listed compactly (no clone needed).

### 2.1 MISSING (35) — no `_sxr` equivalent; in scope; must be built

#### Create lifecycle (D2)
| Calendar affordance | Calendar fn | Plan to clone → target |
|---|---|---|
| Empty-state hero ("Add the first post") | `renderCalOrganizer` (21012-21017) | hero button in `_sxrRenderBody` empty branch (16335) → `addSxrBlankCard()`, gated `!_isClientLink` |
| Trailing "+" add tile in the populated grid | `renderCalOrganizer` (21018-21020, 21040) | append `sxr-card-add` tile after the grid map in `_sxrRenderBody` (16341) |
| Add-card entry handler (insert blank, focus, center) | `addCalBlankCard` (22585-22611) | new `addSxrBlankCard()` near `_sxrRetrySave` (15745); reference legacy `addSampleCard` (11514) for shape |
| Blank-card data factory | `_calBlankPost` (21046) | new `_sxrBlankSample()` → `{id:_sxrNextBlankId(), order_index:max+1, name:'', creative_direction:'', hide_creative_direction:'', asset_url:'', thumbnail_url:'', linear_issue_id:'', graphic_linear_issue_id:'', video_status:'In Progress', graphic_status:'In Progress', comments:[]}` via `_sxrNormalize` (13982) |
| Blank-id mint + detect; real-id minter | `_calNextBlankId`/`_calIsBlankId` (20758-20759), `_calMintId` (16475) | `_sxrBlankSeq`/`_sxrNextBlankId`/`_sxrIsBlankId` near 15628; clone `_calMintId` → `_sxrMintId` (note: only `_sxrMintCommentId` exists today, 14255) |
| Blank-card render path (isBlank mode) | `_calRenderInlineCard(p,true)` + wrap/insert (22598-22601) | add `isBlank` param to `_sxrRenderCard` (14053) — skip grip/draggable/del when blank — and the wrap+insert idiom in `addSxrBlankCard` |
| Focus the name field on the new card | `addCalBlankCard` (22602-22609) | query `.sxr-name-input` (14093), `setTimeout(focus, 80)` |
| Scroll-into-view / center the new card | `addCalBlankCard` (22608) | `scrollIntoView({behavior:'smooth', block:'nearest'})` (grid wraps vertically; drop `inline:'center'`) |
| **First-save promote** (swap blank→real id, rewrite DOM refs, inject grip+del, migrate pending edits, wire drag) | `_calPromoteBlankCard` (22443-22490) + call site (22104-22110) | clone → `_sxrPromoteBlankCard` (use `[data-sxr-id]`, add sxr grip/del, migrate `_sxrPendingEdits`, `_sxrWireDrag`) |
| **Optimistic create branch in the save path** (mint id, build default row, push to state, whole-card create POST, `isBlank && !hasContent` empty-skip) | `_calFlushCardSave` (22100-22118) | replace the `if (idx<0) return` guard in `_sxrFlushCardSave` (15782-15783) with the isBlank→mint→promote→push-new-row branch; send the full blank row (whole-card, not field-patch) on first save |

#### Per-card archive / delete (D3)
| Calendar affordance | Calendar fn | Plan to clone → target |
|---|---|---|
| Per-card corner **X (archive) button** on the editable card | `_calRenderInlineCard` `cal-card-del` (21477) | add `sxr-card-del` in `_sxrRenderCard` editable branch (after grip, 14090) → `archiveSxrCard('${id}')`; **editable-only** (never the `ro` client branch) |
| Archive handler + confirm dialog (single card) | `archiveCalPost` (22789, `showConfirm` 22793) | new `archiveSxrCard(id)` using `showConfirm('Archive this sample?', "…kept (archived) on our server, recoverable.", …, 'Archive')` |
| Single-card archive network write (drop pending, await in-flight, POST `status:'Archived'`) | `_calArchiveOne` (22636) | `_sxrArchiveOne(id, slug)` → POST `{ sample:{ id, status:'Archived', updated_at } }` to `SXR_UPSERT_URL` (matches legacy `_smDeleteCard` 11537) |
| Optimistic removal + rollback on failure | `archiveCalPost` (22794-22814) | snapshot `sxrState.cards`, filter, `_sxrRenderBody()` + `_sxrCacheWrite`; catch → restore + reload, guarded on captured slug |
| **Archived-ledger anti-reappear guard** (localStorage so a stale poll/echo can't resurrect the row) | `_calArchivedKey/ReadRaw/WriteRaw/Refs/Add/Remove` (16544-16602) + `_calRefsForPost` (16638) + grace self-heal | `_sxrArchived*` + `_sxrRefsForCard` near 13975, key `syncview_sxr_archived_v1_<slug>`; filter `fresh` against it in `loadSxrCards` (16369); pre-populate before write / roll back on failure. **Fixes a latent reappear bug that exists even before any archive UI** (see §3.3) |
| Confirm dialog (styled, not native) | `showConfirm` in `archiveCalPost` (22793) | covered by `archiveSxrCard` (reuse shared `showConfirm`) |
| Realtime/echo handling for the archive | `_calArchiveOne` echo-ordering (22646-22649) + ledger | covered by `_sxrArchiveOne` (drop `_sxrPendingEdits[id]` + await `_sxrSaveInFlight[id]`) + the ledger |
| **Bulk archive via select mode** (lower priority) | `_calArchiveSelected` (22731) + select infra (`_calToggleSelectMode` 22664, `_calCardSelectClick` 22695, `_calSyncSelectionUI` 22719, `_calRunPooled` 22622) | clone as an **archive-only** select bar (drop the EXCLUDED color-tag + caption actions); add `selectMode/selected/lastSel` to `sxrState` (13823). **Not** excluded-by-coupling — color is a UI sibling, not a data dep |

#### Toolbar / header chrome (D1)
| Calendar affordance | Calendar fn | Plan to clone → target |
|---|---|---|
| **"Share with client"** (copy `?c=…&v=sample-reviews` link) | `calCopyShareLink` (16930) | `_sxrCopyShareLink` building `?c=${client}&v=sample-reviews` (+ the `client_review_token` referenced at 27111); wire as a share button (kebab optional). **The surface already CONSUMES this link (26982, 27081-27117) but can't produce it.** |
| "Refreshing…" spinner notice | `_calSetRefreshing` + `#calRefreshing` (18989-18992, 19873) | `_sxrSetRefreshing` + `#sxrRefreshing` in a new `sxr-toolbar-right`; toggle around the bg branch of `loadSxrCards` (16360-16365) |
| "Couldn't refresh — retry" stale notice | `_calSetStaleNotice` + `#calStaleNotice` (18993-18996, 19874) | `_sxrSetStaleNotice` + `#sxrStaleNotice`; set in `loadSxrCards` catch when `cards.length>0` (16413), clear on success. **Fixes silent bg-refresh failure** (16416 only errors when zero cards) |
| Review/approval-count badge on the tab / nav | `_calApprovalBadgeCount` + `_calUpdateReviewBadge` (24389-24411, 19861) | `_sxrApprovalBadgeCount`/`_sxrUpdateBadge` counting cards at the SMM-review status; render on the sxr tab + `navSampleReviews` (4307) |
| Zoom control (3-level grid card sizing) | `calZoom` + `_calApplyZoom` (19911-19942) | `_sxrZoom`/`_sxrApplyZoom` + `.sxr-grid[data-zoom]` variants. **Optional polish** |
| "+ Add client" button + client search | `onCalTabAddClick` + add-btn (19987-19995, 20074) | `_sxrTabAddClick` + add-btn in `_sxrRenderTabs` (16320), writing the shared pins so it shows in both surfaces |
| Per-client tab REMOVE (X) | `onCalTabRemove` (20049-20073) | `_sxrTabRemove` + X span in `_sxrRenderTabs` (16319); on active-client removal switch to `pins[0]` + `loadSxrCards` |
| Kebab "More options" container | `_calRenderShell` kebab (19824-19839, `_calToggleKebab` 19944) | **Optional** — every kebab item except Share is EXCLUDED; ship Share as a standalone button or a 1-item kebab |

#### Fields / media (D4) & drag-states (D8) misses
| Calendar affordance | Calendar fn | Plan to clone → target |
|---|---|---|
| **Render-time textarea autosize** (grow creative_direction to fit saved text) | `_calAutosizeTextareas` (21890, called 23542) | `_sxrAutosizeTextareas('.sxr-textarea')`, call after the grid `innerHTML` in `_sxrRenderBody` (16341). Today long CD paints clipped at `rows=3` until focused |
| Thumbnail click → lightbox + Drive-permission load-error warning | `_calOpenThumbLightbox` (21904), `_calDriveWarnHtml` (20789) | `_sxrThumbClick`/`_sxrOpenThumbLightbox` on `.sxr-card-thumb` (14077/14091); `_sxrOnThumbImgError` replacing the bare onerror (14058) |
| **Thumbnail-flicker avoidance** (harvest decoded `<img>` nodes across re-render) | `_calHarvestThumbs`/`_calRestoreThumbs` (20186-20216, wired 20313/20335) | `_sxrHarvestThumbs`/`_sxrRestoreThumbs` keyed on `data-sxr-id` + src-base; harvest-before / restore-after the `body.innerHTML` in `_sxrRenderBody` (16341). **Samples reintroduced the per-repaint flash the calendar already fixed** |
| Reorder **success toast + Undo** | `persistCalReorder` toast + `_calUndoReorder` (23808-23810, 23754) | `_sxrUndoReorder` + capture `prevOrder` in `_sxrCommitDragOrder` (16196); toast at the success branch (16228) |

#### Critic-found misses (4 — absent from the 114-row matrix)
| Calendar affordance | Calendar fn | Status | Plan to clone → target |
|---|---|---|---|
| Per-card **"Copy a link to this card"** button (deep-link to one card) | `_calCopyCardLink` (16945), rendered 21476 | MISSING | `_sxrCopyCardLink` + `sxr-card-link` button → `#sample-reviews/<slug>/<cardId>` |
| **Deep-link jump-to-card** (focus/scroll the card named in `#sample-reviews/<slug>/<id>`) | `renderCalOrganizer` focusPid (20977-20981), `_calFocusRequest` | PARTIAL | router already captures `_sxrFocusRequest.cardId` (27226/27377) but `mountSampleReviews` (16270) **discards it**. Add `sxrState.focusCard`, focus-through-filter, scrollIntoView, "card not found" notice (mirror `smState.focusCard` 11192) |
| **"Current / up-next" card highlight** | `renderCalOrganizer` currentIdx (20994) + `cal-card-current` (21473) | MISSING | clone the marker keyed off the review lifecycle (no date dependency) |
| Linear **component-mismatch paste guard** (VID issue in graphic slot → confirm) | `_calLinearCommit` (21213) | MISSING | folds into `_sxrLinearCommit` (Linear cluster, §2.2) — a 2nd guard distinct from the format guard |

### 2.2 PARTIAL (27) — a `_sxr` path exists but diverges / is incomplete

#### Linear link slots (D5) — the highest-value PARTIAL cluster (sync-critical)
> **Reality check (critic-confirmed):** the two Linear slots are rendered by the **generic
> `_sxrUrlFieldHtml`** (14101-14102) — identical chrome to the asset/thumbnail URL fields — and
> committed through plain `_sxrOnFieldBlur` → `_sxrFlushCardSave`. `_sxrLinearCommit`, `_sxrMoveLink`,
> `_sxrLinkConflict`, `_sxrLinkDuplicatePeers`, `_sxrLinearSlotHtml`, `_sxrLinearKey` **do not exist**
> (grep returns zero hits; `SAMPLES_PARITY_LOG.md` lists them but they were never built). The ONLY wired
> Linear behaviors are **post-save point-adoption** (`_sxrSyncStatusFromLinear`, 15862-15869) and
> **outbound push** (`_sxrPushStatusToLinear`, 15851-15858) — both **DONE** — plus the `__CLEAR_LINK__`
> sentinel (15802-15807, **DONE**). Everything else below is missing.

| Calendar affordance | Calendar fn | Gap & plan |
|---|---|---|
| Paste + commit-on-blur **with validation** (format guard + VID/GRA component guard) | `_calLinearCommit` (21213, guards 21248-21269) | **No guard at all today** — any text is stored. Clone → `_sxrLinearCommit` (+ `_sxrIdentFromUrl`/`_sxrLinearExpectPrefix`); replace the two generic `_sxrUrlFieldHtml` calls (14101-14102) with a dedicated `_sxrLinearFieldHtml` wiring `onblur=_sxrLinearCommit` |
| **Uniqueness / paste-time conflict detection** | `_calLinkConflict` (21293) + `_calLinkKey` (16673) | clone → `_sxrLinkConflict` + `_sxrLinkKey` scanning `sxrState.cards`; call from `_sxrLinearCommit` before persist. **Matters because Linear sync needs unique links per card** |
| Conflict-resolution dialog ("already linked to X — Move here / Cancel") | `_calShowLinkConflict`/`_calMoveLinkConfirm`/`_calLinkConflictCancel`/`_calPendingLinkMove` (21305-21323) | clone → `_sxr*`; render into the sample card body |
| **Move a link to another card** (clear old slot awaited → set new → re-adopt → de-archive ref) | `_calMoveLink` (21340) | clone → `_sxrMoveLink` using awaited `_sxrFlushCardSave(oldPid)` + `_sxrSyncStatusFromLinear` |
| Render-time **duplicate-warning banner** (per slot) | `_calLinkDuplicatePeers` (16693) + `cal-dupe-warn` (21480), `_calDupeWarnText` (16719) | clone → `_sxr*`; banner in `_sxrRenderCard` before the link fields. **Note:** `_calDedupeByLinearIssue` is a dead pass-through (16682) — clone the *banner*, not the dead collapser |
| Parent-issue-linked banner ("link the sub-issue") | `_calSyncStatusFromLinear` parent branch (17533) + `_calParentLinks` (21478) | `_sxrSyncStatusFromLinear` already *detects + refuses* a parent (16049) but shows no banner; add `_sxrParentLinks` + banner |
| Dedicated Linear slot UI (icon button states + edit-pencil + Esc-cancel) | `_calLinearSlotHtml`/`_calLinearPileHtml`/`_calLinearEdit`/`_calLinearKey` (21145-21208) | **Optional polish** — a link can already be typed/cleared. Clone the dedicated chrome only if we want the exact calendar look |

#### Fields / media (D4)
| Calendar affordance | Calendar fn | Gap & plan |
|---|---|---|
| asset_url / thumbnail_url editor **with live behaviors** | `_calOnLinkInput`/`_calOnLinkBlur` (21103-21126), `_calLivePreviewThumb` (21980), `_calForceThumbRefresh` (22546) | persist works, but samples lacks: live preview while typing, media-warning clear on paste, **in-place thumb refresh on blur**, and collapse-to-open-pill chrome. Clone → `_sxrOnLinkInput`/`_sxrOnLinkBlur` + `_sxrLivePreviewThumb` + `_sxrForceThumbRefresh` + `_sxrSetThumbMedia`. Today a media edit's new thumbnail is invisible until an unrelated repaint |
| Thumbnail cache-bust on media change | `_calCacheBustThumb` (20681), `_calBumpThumbRev` (13676) | the **persisted/cross-viewer** half is DONE (`_sxrBumpThumbRev` 15634, `_sxrDeriveThumb` 14019); the **immediate-editor in-place bust** is missing (no force-refresh repaints the `<img>`). Covered by `_sxrForceThumbRefresh` above; optionally add the `_cb=updated_at` token to match the dual-token scheme |
| Collapsed URL chrome (labeled Video/Thumbnail open-pill + edit-pencil) | `_calLinkFieldHtml` (21094-21099), `_calEditLink` (21133) | optional presentation parity → richer `_sxrUrlFieldHtml` + `_sxrEditLink` |

#### Comments + save (D7)
| Calendar affordance | Calendar fn | Gap & plan |
|---|---|---|
| Render-side `!c.hidden` audit-tombstone filter | `_calCommentsForView` (12763), `_calCommentRoots`/`Replies` (25387/25391) | add `&& !c.hidden` to `_sxrCommentsForView` (14221), `_sxrCommentRoots` (14239), `_sxrCommentReplies` (14243). Small but a real audit-suppression gap |
| Modal-open save-failure notice | `_calWatchNoteSave` (25940) | clone → `_sxrWatchNoteSave`; replace bare `_sxrFlushCardSave(pid)` in `_sxrAppendComment` (14465) + `_sxrDeleteComment` (14499) |
| Echo-adopt **comment-list union** (a comment added to another component mid-save survives) | `_calMergePostComments`/`_calMergeCommentLists`/`_calCommentStamp` (25344/25325/25316), called in flush echo (22292) | `_sxrMerge*` don't exist; concurrent comments survive *only* via the queued-key restore. Clone → `_sxrMergeCommentLists`/`_sxrCommentStamp`/`_sxrMergeCardComments`; call in `_sxrFlushCardSave` echo (after 15827) |
| Background poll **comment union** (tombstone-resurrection guard) | `_calMergeCommentLists` in poll (25325, e.g. 19277) | samples replaces non-pending cards wholesale (16398); add `_sxrMergeCardComments(srv, cur)` before `return srv` |
| Resolved-thread **history toggle** in the modal | `_calShowResolved` + histBtn (25688-25691, 25746) | clone the resolved filter + history button into `_sxrRenderCommentsModal` (14660); samples carries done/is_tweak state but never hides resolved threads |
| Root-draft **persistence across reload** (sessionStorage) | `openCalComments` (25627) + `_calOnComposerInput` (25884) | samples keeps `_sxrRootDraft` in memory only (14361); add `sv_sxrNoteDraft_<pid>` read/write/clear |
| Root order (newest-first) vs calendar (oldest-first) | `_calCommentRoots` (25386) | **intentional divergence** (top-anchored feed) — leave as-is; only the `!c.hidden` fix applies |

#### Drag / states / toolbar (D8, D1, D2)
| Calendar affordance | Calendar fn | Gap & plan |
|---|---|---|
| **Reorder FAILURE rollback + repaint** | `persistCalReorder` catch (23818-23836) | `persistSxrReorder` catch (16229) drops the guard + toasts but **never restores `order_index` or repaints** — the card stays in its wrong position until the next reload. Thread a `prevOrder` snapshot through `_sxrCommitDragOrder`; on failure restore + `_sxrRenderBody()`. *(Critic: closer to MISSING than PARTIAL)* |
| Reorder slot-uniqueness across hidden/archived rows | `wireCalOrganizerDrag` slot-recycle (23613-23625) | `_sxrCommitDragOrder` renumbers visible 1..N (16200) and can collide with an archived row's `order_index`. Clone the hidden-slot avoidance |
| **Don't-repaint-while-editing** guard | `_calSchedulePendingRender`/`_calMaybeRunPendingRender` + focusout flush (16852-16871) | the *guard* is DONE (16339-16340) but the **deferred-replay-on-blur** half is missing — a realtime change to other cards while typing is dropped. Clone `_sxrSchedulePendingRender`/`_sxrMaybeRunPendingRender` + focusout flush |
| Scroll-position (window.scrollY) preservation on bg repaint | `_calRenderBody` preserveScroll (20309-20353) | horizontal-strip parts are N/A (grid is vertical), but capture/restore `window.scrollY` around the `innerHTML` rebuild in `_sxrRenderBody` |
| Keyboard Enter→commit / Escape→cancel on editable fields | `_calLinearKey` (21205-21208) | samples fields have no `onkeydown`; clone → `_sxrOnFieldKey` on the name/URL/Linear inputs (Escape restores pre-edit value + blurs) |
| Loader accessibility (`role=status`/`aria-label`) | `_calLoaderHtml` (16481) | `_sxrLoaderHtml` (16255) is bare; add the attributes. *(Critic: really MISSING)* |
| Empty state with add affordance | `renderCalOrganizer` hero (21012) | covered by the create-lifecycle hero |
| Error state **with retry button** | `_calRenderBody` cal-error (20319-20323) | samples error branch (16334) is text-only; add a `try again` button → `loadSxrCards(slug,{skipCache:true})` |
| Failed-create retention (`_calFailedNewCards` + keep-on-screen) | `_calFailedNewCards` (16431), retention (22380-22388), poll-preserve (19312) | the *display* half exists (Save-failed chip 14105, `_sxrRetrySave` 15745) but there's no `_sxrFailedNewCards` set, **and `_sxrRetrySave` is broken** (queues an empty bucket → `_sxrFlushCardSave` early-returns; confirmed `qa/probes/sxr_c2_save_indicator_rollback.js:115`). Add `_sxrFailedNewCards` + fix `_sxrRetrySave` to re-queue persistable columns |
| Toolbar 3-zone layout; per-client tab strip | `_calRenderShell` (19852), `_calRenderTabs` (19969) | single-zone stub today; extend `_sxrRenderShell` with mid/right zones (see D1 MISSING rows) |
| Deep-link jump-to-card | (critic miss #2) | see §2.1 critic-found misses |

### 2.3 DONE (35) — at parity; do NOT rebuild

Core edit/review/comment/save/drag machinery is genuinely cloned and working:

- **Status (re-verified by hand, §3.6):** `computeSampleOverallStatus` (13851, worst-of, reuses
  `CAL_PRIORITY`), pills `_sxrPillsHtml` (15360), menu `_sxrOpenStatusMenuFor`/`_sxrStatusPick`
  (15304/15329), `_sxrApplySubStatus`/`_sxrApplyAutoStatus` (14849/14888), resolve chooser
  `_sxrShowResolveDest`/`_sxrResolveLastTweak` (14929/14998) + the overlay in `_sxrRenderShell`
  (16290-16306). `SXR_STATUSES` (14724) **correctly drops the calendar-only Scheduled/Posted.**
- **Fields core:** name input + debounced-on-input/commit-on-blur (`_sxrOnFieldInput`/`Blur`/`_sxrFlushCardSave`,
  15674-15706), thumbnail derivation (`_sxrDeriveThumb` 14011), open-in-new-tab (`_sxrOpenUrl` 15712),
  textarea autosize-while-typing (`_sxrOnTextareaInput` 15707), paste (native input path), open Linear sub-issue.
- **Linear (sync-critical bits):** `__CLEAR_LINK__` sentinel (15802), on-link point-adoption
  (`_sxrSyncStatusFromLinear` 16041, with parent + Scheduled/Posted rejection + echo suppression),
  outbound push (`_sxrPushStatusToLinear`).
- **Comments:** full subsystem — data layer (`_sxrCommentsFor`/`SetCommentsFor`/`StringifyComments`),
  audience (`_sxrMsgAudience`), notes button + unread/seen, composer (avatar/autosize/Enter-send/Esc-cancel),
  audience + component pickers, tombstone delete + permission gate. *(Samples is even AHEAD: the
  persist-layer client-write guard `_sxrClientWriteAllowed` 15662 has no calendar equivalent.)*
- **Save:** chip (`_sxrSetCardStatus` 15734), structural-field rollback (`_SXR_ROLLBACK_FIELDS`),
  double-submit lock + queued re-flush, captured-slug guard, `comments_base_at:''` under v2.
- **Drag-reorder:** `_sxrWireDragOnCard` (16166) + drag-while-editing guard + persist funnel
  (`persistSxrReorder` 16214, optimistic guard + self-echo).
- **Repaint-while-editing guard** (critic upgrade PARTIAL→DONE): `_sxrRenderBody` early-return
  (16339-16340) + bg-merge optimistic-keep (16383).

### 2.4 EXCLUDED (11) — on the exclusion list; no clone

Kebab: Import from Excel (`openCalImport` 19830), Import from Linear (`openCalLinearImport` 19831),
Bulk Linear sync (`openCalBulkLinearSync` 19832), Edit caption prompt (19833), Edit platforms (19834),
Collaborative mode (19835), YouTube title review (19836); mid-zone Month filter (19856), Status filter
(19857), Client-links chip (19858); grid-level global Escape that only services select-mode/excluded
modals (23418).

### 2.5 N/A (6) — can't apply to samples; not on the exclusion list

View toggle tabs smmreview/organizer/month/week (samples grid = the organizer; review runs via Kasper +
client surfaces + pills); select/bulk-action *bar* as built (couples color-tag+caption+archive — archive
is reborn as an archive-only bar, §2.1); undo-after-archive (calendar has none either); horizontal-strip
drag edge-scroll (23642), shift-wheel→horizontal (23689), auto-center/saved-scroll (23548) — all
horizontal-strip concepts; the samples grid is a vertical CSS grid.

---

## 3. Notable findings worth your attention

**3.1 The create gap is deliberate, not half-built.** `_sxrFlushCardSave` carries a self-documenting
comment — `// M2 has no create flow (probe seeds via the webhook)` (15783). The whole add-card lifecycle
was intentionally skipped because every test seeded rows through the webhook (exactly the blind spot
`docs/HEADLESS-TESTING-GUIDE.md` §3 warns about).

**3.2 A near-perfect local reference exists.** The legacy `_sm*` samples surface has a *working*
`addSampleCard` (11514) and `_smDeleteCard` (11529, posts `status:'Archived'`). It's a different
prefix/table (don't reuse it), but it proves the backend create/archive contract and is a clean shape to
mirror — lower clone risk.

**3.3 The archive ledger fixes a latent bug that exists *today*, before any UI.** `_sxrRenderBody`
repaints unconditionally and the bg-merge only protects cards with a pending/in-flight edit (16383). The
moment an archive write completes, the row has neither — so a realtime echo / reconnect catch-up that
reads the row before `Archived` is queryable **would resurrect it**. The calendar's `_calArchived*`
ledger (16544-16649) exists precisely to prevent this; samples has no equivalent. So the ledger is a
**correctness requirement**, not polish.

**3.4 `_sxrRetrySave` is broken even for existing cards.** It queues an empty pending bucket (15747),
and `_sxrFlushCardSave` early-returns on `!Object.keys(edits).length` (15753) — so the "Save failed ·
Retry" chip is a no-op. Must be fixed as part of the create work (re-queue persistable columns, mirroring
`_calRetrySave` 22419).

**3.5 The Linear "dedupe" parity is a *banner*, not a collapser.** `_calDedupeByLinearIssue` is an
intentional dead pass-through (16682) — the team stopped silently collapsing duplicate-link cards because
it hid active work. Parity = clone the render-time `_calLinkDuplicatePeers` warning banner, NOT the dead
collapser.

**3.6 Status was audited by hand.** One of the 8 auditors returned a stub for the status dimension, so I
verified it directly: pills → menu → pick → `_sxrApplyAutoStatus` → resolve chooser are all present and
correct, and `SXR_STATUSES` drops Scheduled/Posted. **Status = DONE.** (Noted so the gap in the automated
pass is on the record.)

---

## 4. Ordered implementation plan

**Everything is front-end-only.** No Supabase/n8n/RPC/trigger work. All edits land in `index.html`,
behind `?sxr=1` (default-OFF), on the feature branch `claude/samples-review-parity-plan-ldyzh8`, never
`main`. Build order is chosen so the **cold-open journey works end-to-end as early as possible**.

> **Tier 1 — Core management layer (the reason this session exists). Makes the surface usable from zero.**

- **1A · Create lifecycle.** `_sxrBlankSeq`/`_sxrNextBlankId`/`_sxrIsBlankId` + `_sxrMintId`;
  `_sxrBlankSample()`; `isBlank` mode in `_sxrRenderCard`; empty-state hero + trailing "+" tile in
  `_sxrRenderBody`; `addSxrBlankCard()` (insert + focus + scroll); `_sxrPromoteBlankCard()`; the
  isBlank→mint→promote→whole-card-create branch replacing the `idx<0 return` in `_sxrFlushCardSave`
  (15782); `_sxrFailedNewCards` + **fix `_sxrRetrySave`**. *Risk: the promote DOM-ref rewrite (calendar
  learned this the hard way — 22450-22458); clone it faithfully incl. the full attribute walk.*
- **1B · Per-card archive.** `sxr-card-del` X (editable-only); `archiveSxrCard` (confirm); `_sxrArchiveOne`
  (drop pending + await in-flight + POST Archived); optimistic remove + rollback; **the `_sxrArchived*`
  ledger + `loadSxrCards` filter integration** (fixes §3.3). *Risk: ship the ledger WITH the button — a
  naive archive without it flickers cards back.*
- **1C · Toolbar operability + safety.** Extend `_sxrRenderShell` with mid/right zones: `_sxrCopyShareLink`
  (Share with client), `_sxrSetRefreshing`, `_sxrSetStaleNotice` (+ fix silent bg-failure), error-state
  retry button. *Low risk; mostly markup + small handlers.*

> **Tier 2 — Edit-experience parity (fixes that bite during create/edit).**

- **2A · Media-edit feedback:** `_sxrForceThumbRefresh`/`_sxrLivePreviewThumb`/`_sxrSetThumbMedia`
  (in-place thumb repaint on blur), render-time `_sxrAutosizeTextareas`, `_sxrHarvestThumbs`/`Restore`
  (kill the repaint flash), `window.scrollY` preservation, deferred-render-on-blur.
- **2B · Reorder + states:** reorder-failure rollback+repaint + slot-uniqueness vs archived + success
  toast/undo; loader a11y; field Enter/Escape (`_sxrOnFieldKey`).
- **2C · Tabs + chrome:** `_sxrTabAddClick` + `_sxrTabRemove` (+ scroll reuse); approval-count badge;
  zoom (optional).

> **Tier 3 — Linear link-slot parity (correctness-critical for sync). Needs a scope decision (§5).**

- **3A · `_sxrLinearCommit`** (format + component guards) wired to a dedicated `_sxrLinearFieldHtml` on
  the two link inputs.
- **3B · Uniqueness + conflict/move + banners:** `_sxrLinkConflict`/`_sxrLinkKey`, the conflict dialog,
  `_sxrMoveLink`, the render-time dupe-warn banner, the parent-issue banner.
- **3C · Dedicated Linear icon-button slot UI** (optional polish).

> **Tier 4 — Comments parity fixes (small, mostly correctness).**

- `!c.hidden` predicate; `_sxrWatchNoteSave`; comment-list union on echo + poll
  (`_sxrMergeCommentLists`/`CommentStamp`/`MergeCardComments`); resolved-history toggle; sessionStorage
  root-draft.

> **Tier 5 — Misc parity (critic misses).**

- `_sxrCopyCardLink` + deep-link; deep-link **jump-to-card** (honor `_sxrFocusRequest.cardId` in
  `mountSampleReviews`); current/up-next highlight; thumbnail lightbox + Drive-warn.

> **Tier 6 — Optional / lower value.**

- Bulk archive via an archive-only select bar (`sxrState.selectMode` + `_sxrArchiveSelected` reusing the
  Tier-1B ledger).

**Suggested cut line for a first shippable increment:** Tiers 1–2 + 3A/3B (commit guard + conflict/move/
banners, since Linear sync depends on link uniqueness). Tiers 3C/4/5/6 are parity-completeness that can
land in a follow-up without leaving the surface broken.

---

## 5. Decisions I need from you

1. **Linear slot UX depth.** Recommended: build the **correctness-critical** parts (Tier 3A commit
   guards + 3B uniqueness/conflict/move/dupe-banner) because samples have full Linear sync and two cards
   pointing at one issue would both sync ambiguously — but **skip 3C** (the dedicated icon-button slot UI)
   and keep the plain URL inputs. Acceptable? Or do you want the exact calendar icon-button look too?
2. **Scope for this build.** Recommended cut line = Tiers 1–2 + 3A/3B (above). Build the full long tail
   (3C/4/5/6) now, or land the core first and follow up?
3. **Bulk archive (Tier 6).** Build the multi-select archive bar, or single-card archive only for v1?
4. **Zoom / up-next highlight / copy-card-link / lightbox (polish).** Include for "full parity," or drop
   as out-of-spirit for a review surface?

(Defaults if you don't specify: **1** = correctness parts only, plain inputs; **2** = core first
(Tiers 1–2 + 3A/3B); **3** = single-card only; **4** = include all except zoom.)

---

## 6. Test plan

Per `docs/HEADLESS-TESTING-GUIDE.md`: drive the **real `index.html`** headless against the **live backend**,
**test client `sidneylaruel` ONLY**, always clean up, branch-only. Open the surface with the flag on:
`…/index.html?sxr=1&v2debug=1#sample-reviews/sidneylaruel` (SMM). Public hooks available:
`window.sxrV2Status()` (realtime readiness, mirrors `calV2Status`), `SXR_UPSERT_URL` =
`…/webhook/sample-review-upsert` for downstream-state seeding. Existing suite to mirror/keep in lock-step:
`qa/probes/sxr_*.js` (a1–f1, m1), `test/samples-*.js`, `qa/golden/sxr_courier_lib.js`.

### 6.0 LEAD — the cold-open "test like a human" journey (write this FIRST, before any edit)
`qa/probes/sxr_cold_open_journey.js` — **zero seeding.** Drive the primary user journey end-to-end through
the real UI, exactly as a person would, asserting at each step on observable output (DOM + backend row via
`poll()`), 0 JS errors throughout, full cleanup:

1. Open the SMM samples tab cold → assert the **empty-state hero** ("Add the first sample") renders
   (this is the exact check whose absence shipped the bug).
2. Click the hero → a blank editable card appears, **name input focused**.
3. Type a name → assert it promotes (blank id → real `sr_…` id; backend row created via `poll(SUPA…)`).
4. Paste a **video URL** + **thumbnail URL** → assert thumbnail repaints in place; row columns persist.
5. Paste a **Linear sub-issue link** → assert it commits (and, once 3A lands, that a bad URL is rejected
   and a VID-in-graphic-slot link prompts).
6. Click a **status pill** → pick a status → assert the pill + overall status update and persist.
7. Add a **comment** → assert it appears + persists.
8. Click the card **X** → confirm → assert the card leaves the grid AND the row goes `Archived`
   (`poll` for `status=Archived`), AND it does **not** reappear on a forced bg reload (ledger check).
9. Assert `page._errs.length === 0`. Cleanup: archive anything created, tombstone any comment.

> **Litmus test (the rule that matters most):** delete every `up(...)` seed from the suite — this probe
> must still prove a user can CREATE, edit, link, status, comment, and ARCHIVE a sample through the UI.

### 6.1 Regression unit tests (CI, brace-extract, no network) — `test/samples-*.js`
- `samples-create-promote` — `_sxrBlankSample` shape (no caption/title), blank-id mint/detect,
  `isBlank && !hasContent` empty-skip, promote ref-rewrite swaps every `data-sxr-id`.
- `samples-retry-save-fix` — `_sxrRetrySave` re-queues persistable columns (the empty-bucket bug).
- `samples-archive-ledger` — `_sxrArchivedAdd/Refs/Remove` round-trip; a ledgered ref is filtered from a
  fresh load; grace self-heal drops it once the server reports live.
- `samples-linear-commit-guards` — format guard rejects non-Linear text; component guard flags VID/GRA
  mismatch; `_sxrLinkConflict` finds a same-issue peer across both slots (archived excluded).
- `samples-reorder-rollback` — failure path restores `order_index` + repaints; slot-uniqueness vs archived.
- `samples-comment-hidden-filter` — `!c.hidden` drops audit tombstones in view/roots/replies.

### 6.2 Live probes (client `sidneylaruel`, cleanup) — `qa/probes/sxr_*.js`
- `sxr_create_lifecycle` — cold create → promote → server row; failed-first-save retention + working Retry.
- `sxr_archive_roundtrip` — X → confirm → optimistic remove → `Archived` row → **no resurrection** under a
  forced bg reload + a simulated realtime echo.
- `sxr_link_conflict_move` — paste a link already on card A into card B → conflict dialog → Move →
  A's slot cleared (awaited) → B set → B adopts status, A doesn't ping-pong.
- `sxr_share_link` — `_sxrCopyShareLink` yields a `?c=…&v=sample-reviews` URL that the client surface opens.
- `sxr_thumb_inplace` — media edit repaints the thumbnail in place (no full reload), no flicker on bg repaint.
- Keep mirroring the calendar probes the parity log tracks (p17/p22/p26/p42/p11/p20/p02/p07/p21/p24).

### 6.3 Capstone — real-browser, all three surfaces
Real Chromium driving SMM → Kasper → Client end-to-end on a created-from-UI sample (incl. a Linear
round-trip), verifying the SAMPLE marker, 0 JS errors on all surfaces, scoped to the test client, full
cleanup. Then run the **Overnight** skill to loop the suite continuously for a morning report.

### 6.4 Pre-push ritual (every time)
Syntax-check the inline script → full `test/*.js` by **exit code** → the cold-open journey probe + the
targeted probes for what changed → push only verified, on the branch.

---

## 7. Guardrails (unchanged)
- No feature code until you approve this plan.
- Everything behind `?sxr=1` (default-OFF), isolated from the calendar. **The entire plan is front-end;
  the one shared piece — the inbound Linear webhook branch — is not touched.**
- Test client `sidneylaruel` only; ship on `claude/samples-review-parity-plan-ldyzh8`, never `main`.
- When building: clone calendar code faithfully (carry its bug-fixes), and write the cold-open journey
  probe FIRST.
- Update `SAMPLES_PARITY_LOG.md` as each `_sxr*` twin is built (it currently lists `_sxrLinearCommit`/
  `_sxrMoveLink`/`_sxrLinkConflict` as forked — they are not; the log is aspirational there and should be
  corrected to match reality when 3A/3B land).

---

## 8. Residual risks
- **Promote ref-rewrite** is the trickiest clone (the calendar hit a "second ghost row" bug here,
  22450-22458) — clone the full attribute walk, don't hand-pick attributes.
- **Archive ledger ordering** — pre-populate before the write, roll back on failure, and add the grace
  self-heal, or archived cards either resurrect or never come back after an unarchive.
- **Linear link uniqueness** is a *sync* correctness property, not just UX — two live samples on one issue
  is the failure mode the conflict/dedupe work prevents.
- **Stale parity-log entries** — treat `SAMPLES_PARITY_LOG.md` §1 as a wishlist, not ground truth, for the
  Linear link UX row until 3A/3B are built.
