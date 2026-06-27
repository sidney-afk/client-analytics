# Samples (Review) — Front-End Rebuild Spec (the parity MAP)

**Status:** blueprint for a clean, from-scratch rebuild of the Samples (Review) FRONT END.
**Backend:** DONE + LIVE (do not rebuild — see §3). This spec is FRONT-END only.
**Read this first, then build.** It exists because the first attempt failed in a specific,
avoidable way (see §1).

---

## 1. Why the first attempt failed — and the ONE rule for the rebuild

The first build cloned the content calendar **function by function** into a parallel
`_sxr*` namespace. That is lossy by construction: you clone the functions you happen to
look at and silently miss whole surfaces. It produced a card that didn't match, a Notes
modal that looked different, a client link that was a bare list instead of the calendar's
multi-tab portal, and a missing tab-return refresh — each found reactively by the user, one
at a time. That is the exact "build from scratch → new bugs" outcome we wanted to avoid.

**THE RULE FOR THE REBUILD:** clone **whole surfaces**, never individual functions.
Take a calendar surface (the toolbar/shell, the Sheet card, the Review list, the Notes
modal, the client portal) **in its entirety**, copy it, and change ONLY:
  (a) the data it points at (`calState`/`calendar_posts` → `sampleState`/`sample_reviews`),
  (b) the component set (`['video','graphic','caption']` → `['video','graphic']`),
  (c) the explicit EXCLUSIONS in §5.
Never cherry-pick. If a surface has a toolbar with four tabs, you clone the toolbar with its
four tabs (minus the ones §5 excludes) — you do not clone "the review tab" alone.

Two viable techniques, pick one up front (see the session note in §10):
  - **A — shared/parameterized code** (calendar functions take the state/config as args so
    ONE implementation serves both). Textbook-best (zero drift) but requires touching the
    working calendar; the calendar reads globals everywhere, so this is a real refactor.
  - **B — disciplined wholesale copy** (copy whole surfaces into `_sxr*`, transform data +
    apply §5). Cannot break the calendar; needs a manual re-sync later. **Recommended for
    this codebase.** The discipline that makes B safe is THIS SPEC: build to the surface
    inventory in §4 so nothing is missed.

---

## 2. How to use this document

1. Read §3 (backend contract — the live API you must speak to) and §5 (exclusions).
2. Work down §4 (surface inventory) top to bottom. Each row is a whole surface to clone.
   Do not start the next surface until the current one matches its calendar twin.
3. After each surface, run the matching `qa/probes/sxr_*` (selectors will need updating to
   the new DOM, but the ASSERTIONS are the spec — see §8).
4. Keep `SAMPLES_PARITY_LOG.md` updated (the mirror registry) so future calendar changes
   can be re-applied to samples.

---

## 3. Backend contract (LIVE — do NOT rebuild; just speak to it)

The backend was built in earlier sessions and is live. The FE only has to talk to it
correctly. Source of truth: `SAMPLES_SUPABASE_KICKOFF.md`, `SAMPLES_V2_PLAN.md`,
`SAMPLES_GO_LIVE.md`, and the `n8n-backups/sample-*.json` snapshots.

- **Table:** Supabase `sample_reviews`, PK `(client, id)`, all text columns. Anon SELECT +
  in the `supabase_realtime` publication + `replica identity full` (realtime VERIFIED
  working for `sample_reviews` — a direct postgres_changes test delivered events).
- **Reads (v2):** `GET {SUPABASE}/rest/v1/sample_reviews?select=*&client=eq.<slug>` via the
  shared compound-key paginator; fall back to the `sample-review-get` webhook on any error.
- **Writes:** the `sample-review-upsert` n8n webhook. FIELD-LEVEL patch (never whole row),
  `comments_base_at:''`. It creates, archives (`status=Archived`), and honours the
  `__CLEAR_LINK__` sentinel for a cleared Linear link. Server sets `updated_at`.
- **Reorder:** `sample-review-reorder` webhook (per-row `order_index`).
- **Status vocabulary (6, NO Scheduled/Posted):** In Progress · For SMM Approval ·
  Kasper Approval · Client Approval · Tweaks Needed · Approved. Terminal = Approved +
  Archived. Overall = worst-of(video, graphic).
- **Components:** `video`, `graphic` ONLY (no caption, no title). `graphic` == "Thumbnail"
  in the UI label.
- **Comments:** per-component JSON in `video_tweaks` / `graphic_tweaks` (string columns).
  Object shape: `{id, parent_id, author, role, body, created_at, updated_at, audience,
  is_tweak, round, done, done_at, done_by, deleted}`. Delete = TOMBSTONE (`deleted:true`),
  never a bare removal. `role`: `smm` | `client` | `kasper`. `audience`: `internal` |
  `client` (root carries it; replies inherit).
- **Linear:** the two link columns `linear_issue_id` (VID) / `graphic_linear_issue_id`
  (GRA). Status push/adopt uses the SHARED generic Linear webhooks keyed by issue id; a
  durable outbox on key `syncview_sxr_linear_outbox_v1`. ⚠️ The samples inbound Linear
  handler is an EMBEDDED 3rd branch in the calendar's Linear webhook — see §9.
- **Flag / routing:** `?sxr=1` (default-OFF, sticky in localStorage). Deep link
  `?sxr=1#sample-reviews/<slug>/<cardId>`. Client share link **must carry `?sxr=1`** while
  default-OFF: `?sxr=1&c=<name>&v=sample-reviews[&t=<token>]`.

---

## 4. THE SURFACE INVENTORY — clone each whole surface

Calendar source line numbers are approximate (the file moves); find by function name.
"Samples target" = what to build. "Exclude" = what to drop from the calendar version.

### 4A. SMM surface (the manager working on samples; `?sxr=1#sample-reviews/<slug>`)

| # | Surface | Calendar source (clone this whole thing) | Samples target | Exclude / change |
|---|---|---|---|---|
| 1 | **Shell + toolbar** | `_calRenderShell()` | the samples shell: embed/title + tab bar + filters + zoom + kebab | tabs = **Review + Sheet** only (drop Month/Week — no dates). Filters: drop month filter + the all-content/all-months dropdowns (no dates). Kebab: drop Import-from-Excel, Import-from-Linear, bulk-Linear-sync, edit-platforms, collaborative-mode. Keep: zoom, share-with-client, per-client tabs, select-mode/bulk-archive. |
| 2 | **Tab router** | the `calState.view` switch (`review`/`smmreview`/`organizer`/`month`/`week`) → `renderCalReview()` / `renderCalOrganizer()` | `sampleState.view` switch: `smmreview` → review list; `organizer` → card sheet | drop `month`/`week` |
| 3 | **Sheet (card strip)** | `renderCalOrganizer()` → `cal-organizer-strip` of `_calRenderInlineCard` | the editable card strip | (this is the one already rebuilt and working — reuse it) |
| 4 | **Inline card (editable)** | `_calRenderInlineCard()` | the SMM card | EXCLUDE caption (+generator/prompt), CTA, scheduled-date chip, platforms strip, colour tag. Keep: thumbnail (floating) + Linear pile, collapsed Video/Thumbnail link-pills, name, creative-direction + visibility eye, bottom per-component sub-status triggers + "Set all to…", comments btn, copy-link, archive, grip/drag, select overlay. **Decision (keep):** triggers are ALWAYS actionable (samples has no caption escape hatch; the Linear push no-ops until linked) — do NOT lock unlinked triggers. |
| 5 | **Link-field pill** | `_calLinkFieldHtml` + `_calOnLinkInput/Blur`/`_calOpenLink`/`_calEditLink` | collapsed media link pills (Thumbnail/Video) | thumbnail_url + asset_url only |
| 6 | **Linear pile + edit** | `_calLinearPileHtml`/`_calLinearSlotHtml`/`_calLinearEdit`/`_calLinearCommit` + conflict/move/dupe machinery | the thumbnail Linear pile; edit swaps the title row | video+graphic; keep ALL guards (format, VID/GRA component, uniqueness/move, dupe-warn, parent-warn) |
| 7 | **Status menu + Set-all** | `_calStatusToggleMenu`/`_calStatusPick` + `_calOpenSetAllMenu`/`_calSetAllStatus`/`_calSetAllSettable` | colour-coded `cal-fld-status-item` menu + set-all | 6 statuses; both components settable |
| 8 | **Thumbnail + lightbox** | `_calThumbContent`/`_calDeriveThumbInfo`/`_calForceThumbRefresh` (must PRESERVE pile/warn overlays via `_calSetThumbMedia`) + lightbox | floating thumb + lightbox | reuse pure helpers |
| 9 | **Create / promote** | `addCalBlankCard`/`_calBlankPost`/`_calPromoteBlankCard` + the create branch in `_calFlushCardSave` + failed-new retention | blank→mint→promote→create | — |
| 10 | **Archive (single + ledger + bulk)** | `archiveCalPost`/`_calArchiveOne`/`_calArchived*` ledger + select-mode bulk | per-card X + multi-select bulk | — |
| 11 | **Reorder + rollback** | drag wiring + `_calCommitDragOrder` + `_calUndoReorder` | drag reorder + rollback | `sample-review-reorder` |
| 12 | **Save engine** | `_calOnFieldInput/Blur` → `_calPendingEdits`/`_calSaveTimers` → `_calFlushCardSave` (debounce, slug guard, in-flight lock, field-patch, rollback fields, self-echo window, thumb_rev) | the samples save engine | field-patch; `__CLEAR_LINK__` |
| 13 | **Up-next + deep-link focus + copy-card-link** | `_calReviewOpenInSheet` / focus-card / `_calCopyCardLink` | up-next highlight, deep-link jump, per-card copy link | — |

### 4B. SMM Review tab (the manager's approval queue — `smmreview`)

| # | Surface | Calendar source | Samples target | Exclude / change |
|---|---|---|---|---|
| 14 | **Review list** | `renderCalReview()` → `cal-review-wrap`/`cal-review-list` of `_calReviewCardHtml` (collapsible kcards) | the SMM review queue (posts at "For SMM Approval") | drop date line; "Open in Sheet" jumps to the samples Sheet |
| 15 | **Review card body + panels** | `_calReviewCardBody`/`_calReviewPanelHtml` (SMM mode: split Approve→Kasper/Client, first-review + AAT badges, request-change, thread) | per-component SMM review panels | video+graphic; reuse `_CAL_REVIEW_CFG` smm = {reviewStatus:'For SMM Approval', approveTo:'Kasper Approval'} |
| 16 | **Review mode + items filter** | `_calReviewMode()` / `_calReviewItems()` / `_calReviewComponentActive` | samples review mode + items | — |

### 4C. Notes / comments modal (BOTH surfaces)

| # | Surface | Calendar source | Samples target | Exclude / change |
|---|---|---|---|---|
| 17 | **Modal shell + feed + composer** | `_calRenderCommentsModal`/`_calComposerHtml`/`_calCommentActionsHtml` + `open/closeCalComments` + `_calSetCompose*` + the `cal-comments-*`/`cal-cm-*` CSS | the samples Notes modal (already re-skinned — reuse) | video+graphic; comp picker = Video/Thumbnail; audience toggle (SMM); comment-vs-request-change; resolve chooser on a tweak root |
| 18 | **Audience gating + comment math** | `_calCommentsForView` (hide internal/Kasper from client) / `_calMsgAudience` / merge / unread dot | samples comment views | — |

### 4D. Client portal (`?sxr=1&c=<name>&v=sample-reviews&t=<token>`) — **the biggest gap**

The calendar client link is a **multi-tab portal**, not a bare list. Clone the whole portal.

| # | Surface | Calendar source | Samples target | Exclude / change |
|---|---|---|---|---|
| 19 | **Client link routing + token gate** | init: `isClient…Link`, `clientFromQuery`, `wlIsAllowedClient`, `client_review_token` check, header/pageTop/selector hidden, "This link isn't valid" gate | the samples client boot | `v=sample-reviews`; **require `?sxr=1`** while default-OFF |
| 20 | **Client shell + embed title + tabs** | `_calRenderShell()` client branch: embed title ("Content calendar") + tab bar `['review','organizer','month','week']` | embed title ("Sample reviews") + tabs **Review + Sheet** | drop Month/Week + month/status filters |
| 21 | **Client REVIEW tab** | `renderCalReview()` client mode (collapsible kcard list; pending-label; per-component Approve/Request-change/thread; Approved → mini line) | the client review list (already rebuilt — reuse) | video+graphic; `_CAL_REVIEW_CFG` client = {reviewStatus:'Client Approval', approveTo:'Approved'} |
| 22 | **Client SHEET tab (MISSING — build it)** | `renderCalOrganizer()` with `ro = _isClientLink` → `_calRenderInlineCard` read-only (`_calClientCompPillsHtml`, link pills open-only, no edit/status/archive, `canApprove=false`) | a READ-ONLY samples card sheet for the client | drop caption/CTA/date/platforms/colour; read-only fields; status as read-only pills; NO add/edit/archive/drag/select |
| 23 | **Client notes modal** | same `_calRenderCommentsModal`, client-filtered (internal hidden; client can comment / request-change / reply / delete own; no resolve, no audience toggle) | samples client notes | — |
| 24 | **Client visibility gating** | `_calIsClientReady(p)` (only show posts at/after the client's stage) + collab off | which samples a client sees | samples: a sample is client-ready once any component leaves In Progress (no collab) |

### 4E. Kasper review (samples sub-tab) — already built; keep

| # | Surface | Calendar source | Samples target | Exclude / change |
|---|---|---|---|---|
| 25 | **Kasper samples sub-tab** | `_kasperRenderCard` partition etc. | the samples Kasper sub-tab (cross-client) | video+graphic; the existing `_sxrKasper*` is fine to carry over |

### 4F. Realtime + freshness (BOTH surfaces)

| # | Surface | Calendar source | Samples target | Exclude / change |
|---|---|---|---|---|
| 26 | **Realtime subscription** | `_calV2EnsureSubscribed` (postgres_changes on the table, debounced bg reload, catch-up on re-subscribe, self-echo window) | the samples channel `sxr-<slug>` on `sample_reviews` | reuse the shared supabase client/key |
| 27 | **Tab-return / focus refetch** | `_calRefreshOnReturn` (visibilitychange + focus + pageshow → one throttled bg reload) — **the piece that was missing** | the samples return-refresh | gate on the surface being mounted |
| 28 | **Deferred render guard** | repaint deferred while a field/composer is focused; runs on focusout | samples deferred render | include the client review composer |

---

## 5. EXCLUSIONS — the master list (what samples does NOT have)

Drop these everywhere they appear in the cloned surfaces:
- **caption** (+ caption generator / prompt / alt-platform caption tabs) and **CTA**
- **scheduling**: scheduled_date, the date chip, **Month** + **Week** views, the month
  filter, the all-months / all-content dropdowns
- **platforms strip** + **edit-platforms**
- **colour tag**
- **import from Excel**, **import from Linear**, **bulk Linear sync**
- **collaborative mode** (client never suggests/creates; client is always read-only +
  review-only)
- **YouTube-title review** / **title-in-review** (no title component)
- third component generally: components are `video` + `graphic` only

---

## 6. Routing & flags (exact)
- SMM: `?sxr=1#sample-reviews/<slug>` ; deep link `?sxr=1#sample-reviews/<slug>/<cardId>`.
- Client: `?sxr=1&c=<name>&v=sample-reviews[&t=<token>]` (the `?sxr=1` is REQUIRED while
  default-OFF — the client-link route is gated on `_sxrEnabled()`).
- Flag `?sxr=1` is sticky (localStorage); `?sxr=0` opts out. Default OFF — verified by the
  isolation probe; this MUST hold (no samples network/UI when the flag is off).

---

## 7. Decisions already made (carry these forward — don't re-litigate)
1. **Triggers always actionable** on the SMM card (no lock on an unlinked component) — the
   calendar locks because caption is its always-settable fallback; samples has no caption,
   so locking would leave a fresh sample with nothing settable. The Linear push simply
   no-ops until the sub-issue is linked.
2. **Client review cards start collapsed** (calendar parity). Open question the user may
   flip: auto-expand the actionable ones.
3. **`graphic` is labelled "Thumbnail"** in the UI.
4. **No Scheduled/Posted** statuses; terminal = Approved + Archived.
5. **Client share link carries `?sxr=1`** while default-OFF.

---

## 8. Test plan (preserve + re-point)
`qa/sxr_courier_lib.js` is the harness (real Chromium + a Node courier that tunnels backend
HTTP to live, with Linear MOCKED so a probe can never mutate a real editor's issue). The
`qa/probes/sxr_*.js` ASSERTIONS are the behavioural spec — re-use them; only their DOM
selectors need updating to the new clean markup. Scope: test client `sidneylaruel` ONLY;
unique `sr_*` ids; archive what you create; assert 0 app JS errors; never let a status
push/comment reach real Linear. Coverage already written (carry over): render, edit/save,
fields/media + thumbnail derivation, status lifecycle + worst-of overall, stale-clear /
idempotency, resolve-route chooser, Linear routing/clear-link/guards/outbox, comments
(audience gating, tombstone), client gating, Kasper, bulk archive, toolbar (zoom/share/
tabs), reorder + rollback, realtime catch-up, tab-return refresh, deep-link/up-next/copy/
lightbox, **flag-off isolation**, and the cold-open "create a sample like a human" journey.
**Add for the rebuild:** a client-portal probe (tabs present; Sheet tab read-only; switch
Review↔Sheet) — the surface the first build missed.

---

## 9. ⚠️ Critical "do not break" warnings
- **The samples inbound Linear handler is EMBEDDED as a 3rd parallel branch inside the
  calendar's Linear webhook** (`SyncView Calendar — Linear Status Sync`, the
  `Handle Sample Linear Event` branch). Deleting that branch silently breaks samples Linear
  inbound sync. Snapshot:
  `n8n-backups/calendar-linear-status-sync.2026-06-26.embed-samples-branch.json`.
- **Never touch the working content calendar's behaviour.** If you go with technique A
  (shared code), prove the calendar render is byte-identical with no samples config before
  shipping.
- **Default-OFF isolation must hold** (`?sxr=1`): with the flag off, zero samples code runs,
  zero network, supabase-js not loaded.
- **Don't write to real Linear from a probe.** Linear is mocked in the harness.

---

## 10. Suggested build order (one surface at a time, verify each)
1. Shell + tab router (Review + Sheet) + client-link routing/token gate + flag isolation.
2. SMM Sheet card (reuse the working rebuild) → verify render/edit/save/status/set-all/
   Linear/reorder/archive/create.
3. SMM Review tab (queue + panels).
4. Notes modal (reuse the re-skin) + audience gating.
5. Client portal: shell + tabs → Client Review tab → **Client Sheet tab (read-only)** →
   client notes.
6. Realtime + tab-return refresh + deferred render.
7. Kasper samples sub-tab.
8. Full headless sweep + a visual pass on every surface vs its calendar twin.

**Session note:** decide technique A vs B at the very start. Default recommendation: **B**
(wholesale copy, can't break the calendar), executed against THIS inventory so nothing is
missed. Build on a FRESH branch off `main`; keep the old `_sxr*` branch as a read-only
reference (its working behaviours + probes) until the rebuild is proven, then delete it.
