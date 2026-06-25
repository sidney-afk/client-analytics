# Samples v2 ("Sample Reviews") — Full Implementation Plan (v2, with Linear sync)

> **Status:** PLAN — awaiting approval. No app code written yet.
> **This is a full from-scratch regeneration** (not an edit of the prior draft). The decisive
> change from the first draft: **samples have FULL Linear status sync**, because the video editors
> and graphic designers work *only* in Linear. The earlier "drop all Linear automation / inert
> links" approach is discarded.
> **Grounded in:** a read-only audit (2026‑06‑25) of `index.html`, the live Supabase project
> `uzltbbrjidmjwwfakwve`, the live n8n workflows on `synchrosocial.app.n8n.cloud` (all Linear
> workflows pulled live), every incident/handoff doc, and `git log` history. Branch:
> `claude/zealous-keller-jcvl30`.

---

## 0. TL;DR

A new, **fully-separate "Samples (Review)" tab** that clones the content calendar's card + review
lifecycle + Kasper review queue **+ its (now-hardened) Linear status sync**, for **two components,
Video and Thumbnail** — so samples behave exactly like calendar cards, sync status to/from the
editors' Linear issues, and appear on Kasper's review surface **marked as a SAMPLE**.

It is a **third, independently-namespaced stack** beside the live calendar and the still-running old
samples module — **the live calendar is never modified**, and **default-OFF (`?sxr=1`)** so SMMs keep
the old Samples tab until a deliberate cutover.

**The Linear-sync strategy is the heart of why this is safe:** we **reuse the three already-hardened,
generic Linear workflows as-is** (so samples inherit the 06‑24 poison fix and the 06‑19 cadence fix
for free, with zero new code), and we **clone only the two table-specific pieces** (the inbound
writer and the reconciler), copying every documented fix exactly. The hardest, most bug-prone code
is *inherited*, not rebuilt.

| What | Disposition |
|---|---|
| `linear-issue-statuses` resolver (poison-hardened), `linear-set-status` pusher, `linear-add-comment` | **REUSE AS-IS** — generic (keyed by Linear issue id, no table). Call the same URLs. |
| Inbound `linear-status-sync` (Linear→card) | **CLONE → `sample-linear-status-sync`** (writes `sample_reviews`). |
| Reconciler `scripts/linear-sync-reconcile.js` + its 10‑min trigger | **CLONE → `sample-linear-reconcile.js`** + own trigger/ledger/CAP. |
| FE: status mapping, durable outbox pattern | **REUSE / clone-with-own-key**. |
| FE: push + suppression + point-adoption + stale-regress guards | **CLONE** into `_sxr*`. |

---

## 1. Goal, scope, non-goals

### 1.1 Goal
Samples appear on **Kasper's review system**, running the **same review workflow as the content
calendar** (including **Linear status sync** with the editors' Linear issues), kept **entirely
separate** from the calendar, **marked clearly as a sample** in Kasper's review, with **extensive DB
tracking** (every timestamp + every status change — a durable register to fall back on).

### 1.2 KEEP (clone from calendar / port from old samples)
- **Video** + **Thumbnail** ("graphic") components — review, status pill, comments, approval stamps,
  **Linear sub-issue link + status sync**.
- **Linear status sync** (the whole point of this revision): inbound (editor's Linear move →
  sample status), outbound (in-app status change → Linear), the reconciler safety net, the durable
  card→Linear outbox, the urgent ping.
- **Creative direction** + **hide-from-client** toggle (port from old samples).
- The **full review/tweak/approval lifecycle** SMM ↔ Kasper ↔ Client, change-requests, tweak loops,
  the resolve chooser, per-component comment threads with audience gating, the Kasper Finish/Close
  global hand-off, the Linear-comment-on-tweak.
- **Title/name** as a plain editable label (NOT a review component).
- **Extensive DB tracking** — every row stamp PLUS a new append-only event log.

### 1.3 REMOVE (do not render/store/wire)
Caption (component + generator + edit-prompt) · CTA · scheduled/calendar dates · color tag ·
all-months dropdown · all-content dropdown · **import-from-Linear** · **bulk-Linear-sync** (the mass
link-matching tools — explicitly out of scope) · edit-platforms · collaborative mode · YouTube title
review · **title-in-review**.
> Note: we remove the Linear *bulk/import tooling*, **not** the Linear *status sync*. Each sample is
> linked to its Linear issue(s) the normal per-card way.

### 1.4 Non-goals
- Not touching the live calendar or old samples code paths / tables / workflows.
- Not migrating old samples data in this phase (parallel run; migration later).
- Not modifying any of the three reused Linear workflows.

---

## 2. Guiding principles
1. **Inherit the hard-won fixes; don't rebuild them.** Reuse the generic Linear workflows as-is;
   clone the table-specific ones by copying the *fixed* code verbatim and re-pointing the table.
2. **The live calendar stays byte-identical.** Separate table + separate workflows + separate
   namespace + default-OFF flag. A bug in the samples stack cannot reach the production calendar.
3. **Clone the *calendar* (not old samples) for review + Linear.** Old samples is whole-row,
   flat-schema, lighter-escaped, no Linear — the wrong template for these. It only lends the
   creative-direction field and the parallel-run discipline.
4. **Empirical verification + real-browser test before any flip**, scoped to a test client.
5. **Default-OFF, reversible.** Sticky per-browser flag; old tab stays until you say cut over.

---

## 3. Architecture — the third stack + the Linear reuse/clone split

| Layer | Live calendar (untouched) | Old samples (untouched) | **Samples v2 (new)** |
|---|---|---|---|
| Supabase table | `calendar_posts` | `content_samples` | **`sample_reviews`** (+ `sample_review_events`) |
| Review model | per-component (video/graphic/caption/title) | flat | **per-component (video/graphic)** |
| Realtime runtime / channel | `_calV2*` / `cal-<slug>` | `_smV2*` / `sm-<slug>` | **`_sxrV2*` / `sxr-<slug>`** |
| FE state / fn prefix | `calState` / `_cal*` | `smState` / `_sm*` | **`sxrState` / `_sxr*`** |
| Write webhooks | `calendar-{get,upsert-post,reorder,reorder-batch}` | `samples-{get,upsert,reorder}` | **`sample-review-{get,upsert,reorder}`** |
| Comment merge RPC | `calendar_merge_comments` | n8n JS (non-atomic) | **`sample_review_merge_comments`** |
| **Linear resolver** | `linear-issue-statuses` | — | **REUSE same URL (generic)** |
| **Linear pusher / comment** | `linear-set-status` / `linear-add-comment` | — | **REUSE same URLs (generic)** |
| **Linear inbound (→table)** | `linear-status-sync` | — | **CLONE `sample-linear-status-sync`** |
| **Linear reconciler** | `scripts/linear-sync-reconcile.js` + trig `AkiFmromoDkmsh39` | — | **CLONE `sample-linear-reconcile.js` + own trigger** |
| status-at trigger | `calendar_posts_stamp_status_at` | — | **CLONE `sample_reviews_stamp_status_at`** |
| Kasper queue read | direct paginated Supabase | — | **direct paginated Supabase (reuse paginator)** |
| id prefix | `p_` | `s_` | **`sr_`** |
| Gating flag | `?v2` (default-ON) | `?sv2` (default-ON) | **`?sxr=1` (default-OFF)** |
| Nav / route | `navCalendar` / `#calendar` | `navSamples` / `#samples` | **`navSampleReviews` / `#sample-reviews`**, "Samples (Review)" |

**Reused as-is (table-agnostic):** the three generic Linear workflows above; `_calMapLinearStatusStrict`
(status string mapping); `_calV2LoadLib` / `_calV2Client` (supabase-js loader + singleton);
`_calSupabaseFetchAllRows` (compound `(id,client)` keyset paginator); `wlNormalizeClient`;
`_calEsc`/`_calEscAttr`/`_jsAttrArg`; `clientMap.client_review_token`; `_calGetPins` (read-only).

---

## 4. Calendar ↔ Samples v2 — differences table

| Feature | Disp. | Calendar location | Samples v2 handling |
|---|---|---|---|
| Video component | KEEP | `asset_url` 17897; pill 17848‑71; `linear_issue_id` | Core. Status syncs to/from the linked Linear VID issue. |
| Thumbnail ("graphic") component | KEEP | `thumbnail_url` 17896; `graphic_linear_issue_id` | Core. Status syncs to/from the linked Linear GRA issue. **Keep the calendar's behavior** (the graphic pill is naturally driven by its Linear link, since that's where the status comes from). |
| Linear status sync (inbound+outbound+reconciler+outbox+urgent) | KEEP | §6 below | Reuse generic workflows; clone inbound+reconciler; clone FE push/outbox/suppression/point-adopt/stale-regress guards. |
| Linear sub-issue link fields | KEEP | `_calLinearCommit` 17626; `_calMoveLink` 17786; `__CLEAR_LINK__` 18490 | Clone commit/move/dedupe/sentinel (uniqueness matters for sync). Columns `linear_issue_id` + `graphic_linear_issue_id`. |
| Linear tweak comment | KEEP | `_calPostLinearComment` 13681; called 27255 | Reuse `linear-add-comment` URL; clone the FE caller. |
| URGENT ping | KEEP (optional) | `_calShowUrgent` 22758; dispatch 13706 | Optional — video at Tweaks Needed with a link. Needs a samples Slack route or reuse the same. |
| Creative direction + hide | KEEP | old samples `_smToggleDir` 11122 | Port the textarea + eye toggle; client render respects the flag. Not a review component. |
| Comment threads (per component) | KEEP | `_calCommentsFor` 11760; audience 11825 | Port for video+graphic; reuse audience/reply model + atomic merge. |
| Review/tweak/approval lifecycle | KEEP | 20827‑21131; Kasper 26518/27023 | Fork over `SXR_COMPONENTS=['video','graphic']`. |
| Caption (+ generator, edit-prompt) | REMOVE | `_calCapBlockHtml` 11968 | **Fork, don't hide** — it's hardcoded into the worst-of status math (see §8.2). |
| CTA / dates / color / both dropdowns | REMOVE | 17899 / 17809‑27 / 12168 / 15887,16075 | Leaf fields / date-derived filters — omit. |
| Import-from-Linear / bulk-Linear-sync | REMOVE | kebab 16244/16245 | Mass link tools — out of scope. (Per-card linking stays.) |
| Edit platforms / collab mode / YouTube title review / title-in-review | REMOVE | kebab 16247‑49; `CAL_REVIEW_COMPONENTS` 11602 | Omit; title/name is a plain label, never reviewed. |
| Append-only event log | ADD | (none exists — verified) | `sample_review_events`, written server-side from the upsert diff. §5.2. |
| SAMPLE marker | ADD | n/a | Presentational badge on Kasper; never touches the state machine. §9. |

---

## 5. Data model

### 5.1 `sample_reviews` table
Mirror the calendar's review + **Linear-sync** columns; drop caption/title/date/CTA/color/platform;
add creative-direction. All `text` except the two status-at `timestamptz` (load-bearing for the
reconciler's exact-timestamp direction logic).

```sql
create table if not exists public.sample_reviews (
  client                       text not null,
  id                           text not null,            -- sr_<ts36>_<rand>
  order_index                  text,
  name                         text,                     -- plain title/label (not reviewed)
  asset_url                    text,                     -- video/reel
  thumbnail_url                text,                     -- thumbnail/graphic
  creative_direction           text,
  hide_creative_direction      text,                     -- 'TRUE' | 'FALSE'
  linear_issue_id              text,                     -- VIDEO Linear sub-issue (synced)
  graphic_linear_issue_id      text,                     -- GRAPHIC Linear sub-issue (synced)
  status                       text,                     -- overall = worst-of(video,graphic)
  video_status                 text,
  graphic_status               text,
  video_tweaks                 text,                     -- JSON comment array
  graphic_tweaks               text,                     -- JSON comment array
  client_video_approved_at     text,
  client_graphic_approved_at   text,
  kasper_approved_at           text,
  kasper_approved_by           text,
  kasper_finished_at           text,
  kasper_closed_at             text,
  kasper_seen                  text,
  kasper_approved_after_tweaks text,
  thumb_rev                    text,
  video_status_at              timestamptz,              -- server-stamped exact change moment
  graphic_status_at            timestamptz,              -- server-stamped exact change moment
  created_at                   text,
  updated_at                   text,
  primary key (client, id)
);
```
> Column names **match the calendar** (`linear_issue_id`, `graphic_linear_issue_id`, `*_status_at`)
> so the cloned inbound writer + reconciler change as little logic as possible.
> If "single-component cards" is chosen (§16), add `kind text`.

### 5.2 `sample_review_events` — the append-only audit log
**Verified: no event/audit/history table exists anywhere today** (8 names probed → 404), and row
stamps are mutable (cleared on reopen). This is the durable register the goal asks for.

```sql
create table if not exists public.sample_review_events (
  id          bigint generated always as identity primary key,
  client      text not null,
  sample_id   text not null,
  ts          timestamptz not null default now(),
  actor       text, role text,
  action      text not null,   -- status_change | approve_video | approve_graphic | kasper_approve |
                               -- kasper_finish | kasper_close | comment_add | comment_resolve |
                               -- comment_delete | reorder | link_set | link_clear |
                               -- linear_in (inbound sync) | linear_out (push) | reconcile |
                               -- create | archive
  component   text, from_status text, to_status text, source text,  -- source: ui|linear|reconcile
  payload     jsonb,
  created_at  timestamptz not null default now()
);
create index sample_review_events_sample_idx on public.sample_review_events (client, sample_id, ts desc);
create index sample_review_events_action_idx on public.sample_review_events (action);
```
- Written **service-role from `sample-review-upsert`** (and the inbound sync, which writes via that
  upsert), computed by diffing the incoming patch vs the `Read Existing Row` snapshot. The `source`
  column distinguishes UI vs Linear-inbound vs reconciler writes — so the register shows *who/what*
  moved each status. Append-only, best-effort (`onError: continueRegularOutput`).

### 5.3 `sample_review_merge_comments` RPC
Clone `migrations/2026-06-18-atomic-comment-merge.sql` for `video_tweaks`/`graphic_tweaks` only;
row-locked union by comment id (newer wins, tombstones kept, >30d pruned); `updated_at` written as
the TEXT ISO format `YYYY-MM-DD"T"HH24:MI:SS.MS"Z"`; `security invoker`; `revoke from public`; `grant
execute to service_role`. (The calendar RPC returns `setof calendar_posts` and can't be re-pointed.)

### 5.4 `sample_reviews_stamp_status_at` trigger
Clone `calendar-status-at-migration.sql`: a `BEFORE INSERT/UPDATE` trigger stamping
`video_status_at`/`graphic_status_at` when the matching `*_status` changes — captures **every** write
path (FE, inbound sync, reconciler) server-side, no ALLOWED-list/workflow change. **This is what the
reconciler reads for exact-timestamp, correct-direction reconciliation** — so it is mandatory now
(not just nice-to-have).

### 5.5 RLS + realtime (copy `CALENDAR_REALTIME_MIGRATION.md`, swap names)
Both tables: enable RLS; grant anon SELECT only; `policy … for select to anon using (true)`; add to
`supabase_realtime`; `replica identity full`. **No anon write** (service-role only). Verify live: anon
SELECT 200 / INSERT 401 / realtime round-trip. *(Caveat carried to §15: `using(true)` is a
cross-client read; isolation is enforced by the FE `client=eq.<slug>` filter + the paginator, not RLS.)*

### 5.6 Column-before-ALLOWED ordering (the recurring data-loss footgun)
Create the Supabase column → then add it to the webhook ALLOWED list → then ship the FE. Never the
reverse (the `autoMapInputData` mirror errors on an unknown column and the whole save fails).

---

## 6. Linear status sync (the core of this revision)

### 6.1 The reuse/clone split (verified live)
- **REUSE AS-IS (generic — keyed only by Linear issue id, no table reference):**
  - **`linear-issue-statuses`** resolver (`GP8CSZDNcy5sGdFr`) — already poison-hardened (06‑24:
    individual-fallback so one dead link can't blind a batch; additive `missing[]`; `ok:false` only
    on real outage). Samples call the same URL → inherit the fix free.
  - **`linear-set-status`** (`VQqqeY9B2GZbh2Bt`) — `{issue, status}` → sets the Linear state from a
    `CAL_STATUSES` string. Generic.
  - **`linear-add-comment`** (`8stSpZUiyG7f2LQX`) — `{issue, body, author}`. Generic.
- **CLONE (table-specific — must copy the fixed code, re-point the table):**
  - **Inbound `sample-linear-status-sync`** ← clone the calendar's `Handle Linear Event` (Linear
    webhook → maps state → derives client → finds the row → writes the sub-status). Re-point
    `UPSERT_URL → sample-review-upsert`, `SUPA_URL → sample_reviews`, dedupe over the samples link
    columns. **Keep verbatim:** the freshness guard (`linAt > cardAt`, never regress an
    above-Client status), Posted-protection, archived-skip, the targeted candidate-read + full-read
    fallback. **Drop** the workload branch. Register the Linear webhook to also deliver here.
  - **Reconciler `scripts/sample-linear-reconcile.js`** ← clone `linear-sync-reconcile.js`. Re-point
    the table + upsert. **Critical:** the script extracts `computeOverallStatus`/`CAL_COMPONENTS`
    from `index.html` at runtime; `CAL_COMPONENTS` includes caption → it would compute a phantom
    caption and pin every sample below Approved. So the samples reconciler must extract/define the
    **samples analogs** (`SXR_COMPONENTS=['video','graphic']`, `computeSampleOverallStatus`). Keep:
    live-cards-only resolve, poison-resilient `resolveLinear` (individual re-resolve of `missing`),
    exact-`*_status_at` direction + `decide()`/`TIE_MS`, **its own ledger + its own CAP**. New n8n
    `scheduleTrigger` (every 10 min) → new GitHub workflow `sample-linear-reconcile.yml` (+ its own
    `cron */10` backstop).
  - **status-at trigger** on `sample_reviews` (§5.4).

### 6.2 Front-end Linear layer (clone into `_sxr*`)
- **Inbound under v2 needs NO front-end pull.** The on-load batch pull (`_calReconcileLinearStatuses`)
  early-returns under v2 because the inbound workflow already writes the row and realtime delivers it.
  So inbound rides: *editor moves Linear issue → `sample-linear-status-sync` writes `sample_reviews`
  → realtime on `sxr-<slug>` → background reload → card.* **Skip the batch reconcile in the samples FE.**
- **Keep the point-adoption on a fresh link:** clone `_calSyncStatusFromLinear` → `_sxrSyncStatusFromLinear`
  (fired only when a link is committed/moved) so a just-linked sample immediately grabs Linear's
  current status (reuse `_calMapLinearStatusStrict` for the mapping).
- **Outbound push:** clone `_calPushStatusToLinear` → `_sxrPushStatusToLinear` (per-issue
  serialize+coalesce; `Posted` never pushed; video_status→video issue, graphic_status→graphic issue,
  no overall push). Fire from the samples flush, mirroring `18760‑18767`.
- **Suppression set:** clone `_calNoLinearPush` → `_sxrNoLinearPush` (single-shot consume in the
  samples flush) — **mandatory** to break the inbound→outbound echo loop, or samples ping-pong with
  Linear over realtime.
- **Durable outbox:** clone with a **separate localStorage key** `syncview_sxr_linear_outbox_v1`
  (the calendar outbox dispatches by hard-coded URL, so sharing it would replay sample pushes to the
  calendar webhook). 60 s / 6-attempt retry on load + focus + timer.
- **Stale-regress / merge-protection layer (MANDATORY, not optional):** clone the v2 guards
  `_calLocalRecentSaves`/`_calRecentSaveFields`, `_calIsStaleLinearRegress`, `_calReassertLinearStatus`,
  and the self-echo window. **These are the cadence/poison fixes on the client side** — cloning only
  the push without them lets a stale Linear round-trip flip a freshly-approved sample back.
- **Link commit/move/dedupe + `__CLEAR_LINK__` sentinel:** clone `_calLinearCommit`/`_calMoveLink`/
  `_calLinkConflict` (keep the VID-/GRA- prefix guards; ensure the samples upsert honors the sentinel).
- **Tweak comment:** clone `_calPostLinearComment` → reuse the `linear-add-comment` URL; posts a
  Kasper/SMM/client change-request onto the linked Linear issue.

### 6.3 Linear setup assumptions (confirm with the team)
- The sync resolves **by issue id** and routes inbound via `slugify(project.name)` (with a
  `parent.project.name` fallback). **Sub-issue vs standalone doesn't matter to status sync** — the
  parent-project fallback already routes sub-issues; the reconciler keys off the card's stored link
  (project-independent), so it's the robust path either way.
- **Confirm sample Linear issues are a disjoint id space from calendar issues** (so the per-card
  uniqueness/dedupe and the cross-table assumption hold). If an issue could appear in *both* calendar
  and samples, that's a conflict to design around. *(Decision §16.)*
- **Confirm sample issues carry a client project/parent** whose name slugifies to the client slug, or
  inbound silently `skipped: 'no client project'` and only the reconciler heals them.

### 6.4 Residual open risks (carried, same as the calendar's)
1. **No per-event durable inbound retry** — a dropped Linear→sample webhook self-heals only at the
   next ~10‑min reconcile (the inbound webhook is best-effort; it demonstrably drops in bursts).
2. **Reconciler CAP** aborts a run on mass divergence — tune for sample volume; own CAP/ledger.
3. **Dead-link hygiene** — archived samples accrue dead Linear links; live-cards-only resolve +
   individual-fallback contain it but don't clean it; budget a periodic sweep.
4. **Poll-granularity residue** — a flip *and* its reversal inside one 10‑min window can still
   mis-direct; rare, not eliminated.
5. **Slug-routing fragility** — depends on `slugify(project.name)` matching the client slug.

---

## 7. n8n webhooks (new + reused)

### 7.1 New write webhooks
- **`sample-review-upsert`** — clone `calendar-upsert-post`'s guard graph with samples column lists.
  ALLOWED: `order_index, name, asset_url, thumbnail_url, status, creative_direction,
  hide_creative_direction, linear_issue_id, graphic_linear_issue_id, video_status, graphic_status,
  video_tweaks, graphic_tweaks, client_video_approved_at, client_graphic_approved_at,
  kasper_approved_at, kasper_approved_by, kasper_seen, kasper_approved_after_tweaks,
  kasper_finished_at, kasper_closed_at`. **MANDATORY guards (data-loss):** phantom-row, read-fail
  `{ok:false}`, `comments_base_at` conflict over samples SCALAR_FIELDS, atomic
  `sample_review_merge_comments` over the two tweak columns, strip-tweaks-before-scalar-mirror, same
  ISO `updated_at` to every store, mirror **fail-loud** (no Sheet backstop). **KEEP** `__CLEAR_LINK__`
  + link-clobber carry-forward for both link columns (a stale full-card patch must not wipe a synced
  link). Append-only `sample_review_events` insert (diff vs existing row; `continueRegularOutput`).
- **`sample-review-get`** — Supabase read fallback.
- **`sample-review-reorder`** — per-row `order_index` update (existing rows only; no insert).
- **`sample-linear-status-sync`** (inbound) and the **reconciler** trigger — §6.1.
- **Samples Kasper queue:** a **direct paginated Supabase REST read** (reuse `_calSupabaseFetchAllRows`),
  not a webhook.

### 7.2 Reused as-is (no edits)
`linear-issue-statuses`, `linear-set-status`, `linear-add-comment` (§6.1).

### 7.3 Process discipline
- **Zero calendar/old-samples workflows modified** — all-new workflows; the three Linear workflows
  are *called*, not edited. Verified ids stay byte-identical.
- Snapshot every new workflow to `n8n-backups/`; verify `versionId === activeVersionId`.
- **Deploy ordering:** Supabase (tables + RPC + status-at trigger + RLS/realtime) → n8n writers +
  inbound + reconciler → GitHub reconcile workflow + trigger → FE (default-OFF).

---

## 8. Front-end design

### 8.1 Namespace / nav / routing / teardown
`_sxr*` / `sxrState` / `_sxrV2*`; channel `sxr-<slug>`; id `sr_`; flag `?sxr=1` **default-OFF** (sticky
`syncview_sxr_on`/`_off`); LS `syncview_sxr*`; route `#sample-reviews`; nav `navSampleReviews`
"Samples (Review)" (hidden behind the flag). One `navTo` branch + active-toggle + teardown line at
~11415 (`if (page !== 'sample-reviews') _sxrV2Teardown();`); teardown also at mount. Boot/hash routing
for `v=sample-reviews`, `#sample-reviews/<slug>/<id>`, and `savedNav==='sample-reviews'`. Per-client
switch flushes pending saves **first**, then loads (which opens/repoints the channel).

### 8.2 Component-set fork — FOUR call sites
`computeOverallStatus` (11645) hardcodes `CAL_COMPONENTS` *directly*. Re-derive as samples analogs
iterating `SXR_COMPONENTS=['video','graphic']`: `computeSampleOverallStatus`, samples stale-approval
clearing (`_calClearStaleApprovals` 11658), samples client-ready (`_calIsClientReady` 17149), and
`_sxrComponentsFor` (flat `['video','graphic']`). **And the reconciler's runtime-extracted analogs
(§6.1).** `_sxrMigrateShape` must never seed `caption_status`/`title_status`. A unit test proves no
caption/title path is reachable.

### 8.3 Card render — `_sxrRenderInlineCard`
Reuse the thumbnail box + `_calThumbContent`/`_calDeriveThumb*`/`_calCacheBustThumb` (new `thumb_rev`
column + `_sxrThumbRev` map), the two link-field editors, the two **Linear link slots** (with
commit/move), title/name row, comments button + save chip, sub-status pills. ADD creative-direction
textarea + hide toggle. DROP caption/CTA/date/color/platforms/dropdowns. **Escape with
`_calEsc`/`_calEscAttr`/`_jsAttrArg`** — never `_smEsc` (it misses `"`/`'`); `name`/`creative_direction`/
URLs are new sinks.

### 8.4 Optimistic save — `_sxrFlushCardSave`
Field-level patch (never whole-row); captured-slug guard; `_sxrSaveInFlight` double-submit lock;
`comments_base_at: ''` under v2; echo merged onto the **full local row before** `_sxrMigrateShape`;
`_SXR_ROLLBACK_FIELDS` on failure; bump `thumb_rev` on a media-link write; **fire the Linear push +
consume `_sxrNoLinearPush`** mirroring `18557‑18565` / `18760‑18767`.

### 8.5 Reorder
Reuse `_calWireDragOnCard`; **don't bump `updated_at`**; `_sxrReorderOptimistic` guard window;
slots unique across the whole set (incl. archived); sort by `order_index` with a stable `id`
tiebreaker; parse `order_index` numerically.

### 8.6 Realtime runtime — `_sxrV2*`
Clone `_calV2Enabled/_Ready/FetchCards/EnsureSubscribed/OnRealtimeChange/Teardown` (channel
`sxr-<slug>`, table `sample_reviews`, **default-OFF**, own self-echo window + in-flight maps);
**reuse** `_calV2LoadLib`/`_calV2Client`/`_calSupabaseFetchAllRows`. No poller; tear down on leave.

### 8.7 Review lifecycle fork + creative direction
Clone `_calReviewCardBody`/`_calReviewPanelHtml` + the comment subsystem + the resolve chooser
(keep Kasper/Client/Approved + "Mark done — don't change status" + X-close; no discard-confirm) for
video+graphic; handler-level `_isClientLink`/surface-status guards; double-submit idempotency.
Creative direction: textarea + eye toggle; `hide_creative_direction` through the upsert; client render
omits when set.

---

## 9. Kasper integration — samples on the review surface, marked

Every mutating Kasper handler funnels through `_kasperPersistPost → calendar-upsert-post` and the
queue cache hardcodes a `{video,graphic,caption}` shape — so samples must **not** be unioned naively
into `_kasperState.items`. **Design:** a **dedicated "Samples" section/sub-tab** on Kasper's review
page (parallel to Editors/Filming), cards rendered identically with a **SAMPLE badge**, that:
- reads `sample_reviews` cross-client via `_calSupabaseFetchAllRows` (paginated — never a flat limit),
- uses its **own** state slice (never `_kasperState.items/.replies/.history/.dismissed/.closed`),
- persists Kasper actions via **`sample-review-upsert`** (never `_kasperPersistPost`),
- reuses the per-component review UI + the global Finish/Close machinery (`kasper_finished_at`/
  `kasper_closed_at`, judged by message `created_at`),
- keeps the SAMPLE badge purely presentational.
**URGENT** is now applicable (video has a Linear link) — optional in v1. **Replies/Messages inbox
union** still omitted in v1.

---

## 10. State machine
Reuse `CAL_STATUSES`/`CAL_PRIORITY`; overall = worst-of(video, graphic). Full calendar transitions
SMM → For SMM Approval → Kasper Approval → Client Approval → Approved, with tweak loops, undo-approve,
and the Linear-state mappings (editor's "For SMM approval" Linear state → For SMM Approval, "Tweak"
→ Tweaks Needed, etc.). **Terminal = Approved + Archived** (drop Scheduled/Posted; verify no handler
expects Posted — note `linear-set-status` maps "posted/scheduled" harmlessly if ever sent). Client
posture: hardcode `_sxrIsClientReady` (mirror calendar minus collab); creative direction hidden when
flagged.

---

## 11. Parallel-run & cutover
**Collision list** (must not reuse/mutate): all `sm*`/`_smV2*` + `window.*` old-samples handlers,
`smState`, `SAMPLES_*_URL`, `content_samples`, channels `sm-/cal-/workload_issues/kasper-cal`, LS
`syncview_samples*`/`syncview_samples_v2*`, id `s_`, `navSamples`/`#samples`/`v=samples`, `?sv2`.
**Read-only-safe to share:** `wlNormalizeClient`, `WL_CLIENT_NAMES`, `_calGetPins`, `clientMap` tokens,
Supabase creds + `_calV2LoadLib`, the escapers, **`_calMapLinearStatusStrict`**, **the three generic
Linear webhook URLs**. **`?sxr` defaults OFF**; both tabs visible during overlap; two realtime channels
(`sm-` + `sxr-`) both tear down on leave. **Cutover (later, mechanical):** every old identifier is
`sm`/`samples`/`s_`, every new one `sxr`/`sample-reviews`/`sr_` → clean delete, zero edits to v2.

---

## 12. Preventive bug checklist (the backbone)

48 classes in the audit; the **must-follow rules**, now including the Linear-sync classes:

**Core (review/realtime/upsert):** field-level patches not whole-row (`d54f804`) · migrate the merged
row not the partial echo (`CALENDAR_V2_AUDIT_HANDOFF`) · atomic comment RPC (`e3741f9`/`84d44b1`) ·
compound `(id,client)` keyset pagination on every read incl. the Kasper queue (`03c4376`/`524c577`) ·
correct escaper per context, never `_smEsc` for attrs (p02) · audience gating + reply inheritance
(p08/p23/p63) · cross-client isolation in the fan-out queue (p56/p63) · handler-level role + review
guards (`3e11f57`/`732b2b4`) · double-submit idempotency (p06/p26) · realtime self-echo/defer/catch-up,
zero idle calls (PR #481/#474) · column-before-ALLOWED ordering · Supabase-primary writes, anon-SELECT
RLS (test INSERT→401) · snapshot + `versionId===activeVersionId`.

**Linear-sync-specific (the painful ones — inherited via reuse, re-implemented carefully via clone):**
- **Poison batch** (one dead link nulls a 50-issue resolve) → **REUSE the hardened `linear-issue-statuses`**;
  the cloned reconciler keeps live-cards-only resolve + individual `missing` re-resolve.
- **Throttled reconciler cadence** → drive the samples reconciler from an n8n 10‑min trigger (not bare
  GitHub cron); GitHub cron as backstop.
- **Wrong-direction correction** → the cloned reconciler uses **exact `*_status_at` timestamps** +
  `TIE_MS` + Tweaks-Needed-never-loses; the status-at trigger is mandatory.
- **Inbound→outbound echo ping-pong** → clone `_sxrNoLinearPush` single-shot suppression exactly.
- **Stale Linear round-trip reverts a fresh approval** → clone the recent-save / `_calIsStaleLinearRegress`
  / `_calReassertLinearStatus` merge-protection layer (not just the push).
- **Dropped inbound event** → accept ~10‑min self-heal via the reconciler (documented residual);
  optionally add the on-link point-adoption so freshly-linked cards don't wait.
- **Shared outbox key collision** → separate `syncview_sxr_linear_outbox_v1` (don't reuse the calendar
  outbox; it dispatches by hard-coded URL).
- **`__CLEAR_LINK__` clear-then-set ordering** → the samples upsert must honor the sentinel.
- **Dead-link hygiene / disjoint issue space** → confirm sample issues are disjoint from calendar; budget a sweep.

Plus: drop nothing that gates the graphic on its link incorrectly — mirror the calendar (status comes
from Linear); SAMPLE badge purely presentational; `thumb_rev` cache-bust + image-reuse to avoid
flicker; pointer-held repaint defer on the Kasper queue; disable card drag while a text field is
focused; finished-card stays finished across refresh (server-confirmed stamp + `created_at`).

---

## 13. Test plan (layered + real-browser, incl. Linear sync)

**Tier 0 — unit (CI, brace-extract, no network):** `samples-overall-worst-of` (no caption/title path),
`samples-migrate-shape`, `samples-request-change-audience` (no leak), `samples-comment-merge-tombstone`,
`samples-kasper-finish-global` + `...-refresh-popback`, `samples-reorder-slot-uniqueness`,
`samples-thumb-cache-bust`, **`samples-linear-status-map`** (the strict mapping for samples),
**`samples-no-linear-echo`** (suppression set breaks the loop — source-form/logic).

**Tier 1 — golden flows (live, client `sidneylaruel`, cleanup):** clean approve, kasper tweak loop,
client tweak loop, approve-after-tweaks, undo-approve, archive cross-surface, **sample-appears-in-Kasper-
marked**, **+ a Linear round-trip flow** (seed a sample with a test Linear issue → push a status →
assert `linear-set-status` reflected it; simulate an inbound `sample-linear-status-sync` → assert the
sample's `video_status` updates over realtime; assert no echo-back).

**Tier 2 — live probes:** mirror p17 (finish), p22 (review routing), p26 (concurrent approve), p42/p44
(cross-component clobber), p11 (comment merge), p20 (reorder), p02 (XSS), p07 (client guards), p21
(realtime), p46 (>1000-row queue presence), p24 (tombstone), **+ Linear probes:** inbound-updates-status,
outbound-push-reflected, **no-ping-pong** (a Linear-adopted status isn't pushed straight back),
stale-regress-doesn't-revert-a-fresh-approval, dead-link-doesn't-poison-the-batch.

**Tier 3 — real-browser capstone:** real Chromium driving the real Samples v2 tab against staged
webhooks, end-to-end SMM → Kasper → Client **with a Linear round-trip**, verifying the SAMPLE marker,
0 JS errors on all surfaces, scoped to a test client + test Linear issues, full cleanup.

**Pre-push:** syntax-check → full `test/*.js` by exit code → targeted samples probes → branch only.
Isolation invariants: old samples ↔ v2 never cross-contaminate; SAMPLE marker never on a calendar
card; flag-off = zero Supabase calls on the samples path; **a samples save targets only the samples
Linear paths, never the calendar's**.

---

## 14. Phased rollout
- **Phase 0** — Decisions (§16) + schema sign-off.
- **Phase 1 — Backend (Supabase → n8n → GitHub).** Tables + RPC + status-at trigger + RLS/realtime;
  then `sample-review-{get,upsert,reorder}` + `sample-linear-status-sync`; then the reconciler script
  + GitHub workflow + n8n trigger; register the Linear webhook to the inbound path. Verify live (anon
  posture, realtime, a Linear round-trip on a test issue, an event-log row per action, reconciler
  converges a deliberately-drifted test sample).
- **Phase 2 — Front-end behind `?sxr=1` (dark).** Namespace, nav (hidden), routing, `_sxrV2*`, card,
  save/reorder, review fork (4 call sites + reconciler analogs), creative direction, the Linear FE
  layer (push/outbox/suppression/point-adopt/stale-regress), Kasper samples section + badge.
- **Phase 3 — Test.** All of §13 green, including the Linear round-trip and no-ping-pong probes.
- **Phase 4 — Flip & soak.** Default-ON behind a kill-switch (or a subset first); old tab stays until
  SMMs migrate; then the mechanical cutover.

---

## 15. Risk register
| Risk | Mitigation |
|---|---|
| Reconciler computes a phantom caption (CAL_COMPONENTS) | Samples reconciler extracts `SXR_COMPONENTS`/`computeSampleOverallStatus` |
| Inbound→outbound Linear ping-pong | Clone `_sxrNoLinearPush` single-shot suppression exactly |
| Stale Linear round-trip reverts a fresh approval | Clone the recent-save/stale-regress merge-protection, not just the push |
| Poison batch blinds the reconciler | Reuse hardened resolver + live-cards-only + individual re-resolve |
| Shared outbox replays sample push to calendar webhook | Separate outbox key `syncview_sxr_linear_outbox_v1` |
| Caption phantom pins samples below Approved | Fork all 4 FE call sites + the reconciler; table omits caption |
| Naive Kasper union corrupts `calendar_posts` | Separate state slice + persist via `sample-review-upsert` |
| 1000-row truncation hides samples from Kasper | Reuse compound-keyset paginator |
| Cross-table Linear issue collision | Confirm disjoint issue space (§16) |
| Dropped inbound event | ~10‑min reconciler self-heal (documented residual) + on-link point-adoption |
| New stack perturbs live calendar / old samples | Disjoint namespace, shared globals read-only, flag default-OFF, zero workflow edits |
| Mutable row stamps lose history | Append-only `sample_review_events` (with `source` = ui/linear/reconcile) |

---

## 16. Decisions — CONFIRMED 2026-06-25

> Confirmed: **full isolation / separate `sample_reviews` table** (#1), and the **mirror-the-calendar
> defaults** for #2–#5 (one card with both Video + Thumbnail components; a dedicated Kasper "Samples"
> section with a SAMPLE badge; the full review machine incl. For-SMM-Approval; the full client
> approve/tweak loop). #6 (Linear issue-space disjointness + client-project routing) is an
> **operational confirmation still pending** from the team. Long-term drift is managed by the living
> **`SAMPLES_PARITY_LOG.md`** (fully-forked code, no shared core).

Original options retained for the record (recommended defaults in **bold**):
1. **Architecture: separate `sample_reviews` table + cloned Linear/review machinery (recommended)**
   vs. a `kind='sample'` discriminator on `calendar_posts`. *Trade-off:* the separate table **keeps the
   live calendar byte-identical** (your #1 fear) and respects "don't mix the two," at the cost of
   cloning the inbound writer + reconciler (the generic Linear workflows are reused, so the clone
   surface is bounded). The discriminator would inherit *everything* for free but mixes samples into
   the live calendar table and every calendar read/view/export — high blast radius on production.
   **Recommend: separate table.**
2. **Card model: one card with both Video + Thumbnail components (recommended)** vs. single-component
   cards (`kind`). Matches the calendar and the natural `linear_issue_id`+`graphic_linear_issue_id` shape.
3. **Kasper layout: dedicated "Samples" section with a SAMPLE badge (recommended)** vs. one unified
   badged queue.
4. **Review depth: full calendar machine incl. For SMM Approval (recommended)** — also matches the
   Linear-state mapping — vs. straight-to-Kasper.
5. **Client loop: full client approve/tweak loop (recommended)** vs. Kasper-only.
6. **Linear issue space: confirm sample issues are disjoint from calendar issues** (so dedupe/uniqueness
   hold), and confirm sample issues sit under a client project/parent so inbound routing works.
   *(Operational confirmation, not a code choice.)*

Secondary defaults adopted: terminal = Approved + Archived; URGENT ping optional (off in v1);
`sample_review_events` anon-readable for a later in-app history view; keep the 30-day comment GC but log
comment add/delete to the event table.
