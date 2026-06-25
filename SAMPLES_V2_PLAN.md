# Samples v2 ("Sample Reviews") — Full Implementation Plan

> **Status:** PLAN — awaiting approval. No code written yet.
> **Author:** grounded in a full read-only audit (2026‑06‑25) of `index.html`, the live
> Supabase project `uzltbbrjidmjwwfakwve`, the live n8n workflows on
> `synchrosocial.app.n8n.cloud`, every incident/handoff doc, and `git log` history
> (300 commits + ~25 `git show` root-cause reads). Branch: `claude/zealous-keller-jcvl30`.

---

## 0. TL;DR

We build a **new, fully-separate "Samples (Review)" tab** that clones the content
calendar's card + review lifecycle + Kasper review queue — but only for **two
components, Video and Thumbnail** — so samples flow through the *exact same*
SMM → Kasper → Client review machinery and **appear on Kasper's review surface,
clearly marked as a SAMPLE**.

It is a **third, independently-namespaced stack** sitting beside the live calendar and
the still-running old samples module:

- **New Supabase table** `sample_reviews` (per-component review shape) + an **append-only
  `sample_review_events` audit log** (the "register every action" requirement) + a
  samples-specific atomic comment-merge RPC + a server-side status-at trigger.
- **New n8n webhooks** `sample-review-{get,upsert,reorder}` that replicate every hard-won
  guard from `calendar-upsert-post`, stripped of caption/date/CTA/color/platform/title and
  of all Linear automation.
- **New FE runtime** `_sxr*` / `sxrState` / `_sxrV2*` realtime channel `sxr-<slug>`, id
  prefix `sr_`, route `#sample-reviews`, gated behind **`?sxr=1` (default-OFF)** so SMMs keep
  using the old Samples tab until a deliberate, manual cutover.

**Nothing in the live calendar or the old samples module is modified.** The two existing
realtime stacks (`_calV2*`/`cal-<slug>`/`calendar_posts` and `_smV2*`/`sm-<slug>`/`content_samples`)
stay byte-identical.

**Why this is lower-risk than it sounds:** dropping the Linear *sync automation* (while keeping
the link fields as inert URLs) removes the single biggest documented bug class in this repo —
the two worst incident post-mortems are both Linear⇄SyncView status drift. None of that
machinery, and none of its failure modes, come along.

---

## 1. Goal, scope, and non-goals

### 1.1 The goal (verbatim intent)
Make samples appear on **Kasper's review system**, running the **same review workflow** as the
content calendar, but **kept entirely separate** from the calendar, with **no Linear sub-issue
automation**, marked clearly as a sample in Kasper's review, and with **extensive DB tracking**
(every timestamp, every status change — a durable register to fall back on).

### 1.2 KEEP (clone from calendar / port from old samples)
- **Video** component (asset/reel) — review, status pill, comments, approval stamps.
- **Thumbnail** component (calendar's "graphic") — review, status pill, comments, approval stamps.
- **Creative direction** field + **hide-from-client** toggle (port from old samples; the calendar
  has no such field — it is samples-only).
- **Linear VIDEO link** + **Linear GRAPHIC link** fields — kept as **inert, hand-pasted, clickable
  URLs** for video editors. No sync, no status push/pull, no reconciler, no sub-issue creation.
- The **full review/tweak/approval lifecycle**: SMM ↔ Kasper ↔ Client, change-requests, tweak
  loops, the resolve chooser, per-component comment threads with audience gating, the Kasper
  Finish/Close global hand-off state.
- **Comment threads** per component (video + thumbnail), with the atomic merge + audience model.
- **Title/name** as a plain editable label (NOT a review component).
- **Extensive DB tracking** — every stamp on the row PLUS the new append-only event log.

### 1.3 REMOVE (do not render, do not store, do not wire)
Caption component (textarea + alt-caption tabs + `caption_status` review) · Caption generator ·
Edit caption prompt · Call-to-action (CTA) · Scheduled/calendar dates · Color tag ·
All-months dropdown (month filter) · All-content dropdown (status filter) · Import from Excel ·
Import from Linear · Bulk Linear sync · Edit platforms · Collaborative mode · YouTube title review ·
**Title-in-review** (title is never a review component) · **all Linear sub-issue automation**
(status-sync, reconciler, sub-issue creation, dedupe/clobber/`__CLEAR_LINK__`-driven *automation*).

### 1.4 Non-goals
- Not touching the live calendar or old samples code paths.
- Not migrating old samples data into the new table in this phase (parallel run; migration is a
  later, separate step).
- Not building Linear automation "for parity."

---

## 2. Guiding principles
1. **Learn from every past fix.** §11 is a 48-class preventive checklist drawn from every incident
   doc, ~25 root-caused fix commits, and ~90 probes. Each rule is encoded into the design.
2. **Separation over reuse-by-mutation.** The Kasper handlers funnel through
   `_kasperPersistPost → calendar-upsert-post`; samples must NOT ride that path. Samples get their
   own state slice + their own persist path so they can never corrupt `calendar_posts`.
3. **Clone the *calendar* (not old samples) for the review parts.** Old samples is whole-row,
   flat-schema, lighter-escaped — the wrong template for per-component review. Old samples is only
   the template for the creative-direction field + the parallel-run discipline.
4. **Empirical verification.** Verify against live Supabase + n8n; reproduce; real-browser test
   before any flip. Scope all tests to the test client `sidneylaruel`; clean up.
5. **Default-OFF, reversible.** The new tab ships dark behind `?sxr=1`; flipping it on/off is a
   sticky per-browser switch; the old tab stays until you say cut over.

---

## 3. Architecture overview — the third stack

| Layer | Live calendar (untouched) | Old samples (untouched) | **Samples v2 (new)** |
|---|---|---|---|
| Supabase table | `calendar_posts` | `content_samples` | **`sample_reviews`** (+ `sample_review_events`) |
| Review model | per-component (video/graphic/caption/title) | flat (1 status, 1 approval, 1 thread) | **per-component (video/graphic only)** |
| Realtime runtime | `_calV2*` | `_smV2*` | **`_sxrV2*`** |
| Realtime channel | `cal-<slug>` | `sm-<slug>` | **`sxr-<slug>`** |
| FE state | `calState` | `smState` | **`sxrState`** |
| Webhooks | `calendar-{get,upsert-post,reorder,reorder-batch}`, `kasper-queue` | `samples-{get,upsert,reorder}` | **`sample-review-{get,upsert,reorder}`** |
| Comment merge | `calendar_merge_comments` RPC | n8n JS `mergeCell` (non-atomic) | **`sample_review_merge_comments` RPC** |
| Kasper queue read | direct paginated Supabase (`_calSupabaseFetchAllRows`) | n/a (no Kasper page) | **direct paginated Supabase (reuse the paginator)** |
| id prefix | `p_` | `s_` | **`sr_`** |
| Gating flag | `?v2` (default-ON) | `?sv2` (default-ON) | **`?sxr=1` (default-OFF)** |
| Nav / route | `navCalendar` / `#calendar` | `navSamples` / `#samples` | **`navSampleReviews` / `#sample-reviews`**, label "Samples (Review)" |

**Reused as-is (table-agnostic, safe to share):** `_calV2LoadLib` (supabase-js loader),
`_calV2Client` (client singleton — same project/key), `_calSupabaseFetchAllRows` (the
`(id,client)` compound-keyset paginator), `wlNormalizeClient` (slug parity), `_calEsc` /
`_calEscAttr` / `_jsAttrArg` (escapers), `clientMap.client_review_token` (read-only),
`_calGetPins` (pins, **read-only**). All of these are owned by neither the old samples module nor
keyed to a specific table.

---

## 4. Calendar ↔ Samples v2 — the differences table

Disposition: **KEEP** (clone/port) · **REMOVE** (omit) · **ADD** (new for samples). Line refs are
the *actual* `index.html` lines from the audit.

| Feature | Disp. | Calendar location | Samples v2 handling |
|---|---|---|---|
| Video component | KEEP | `asset_url` link `_calLinkFieldHtml` 17897; pill 17848‑71; review preview 21134‑48 | Core component. `SXR_COMPONENTS` includes `video`. No status→Linear push. |
| Thumbnail ("graphic") component | KEEP | `thumbnail_url` 17896; pill 17848‑71; preview 21150‑71 | Core component. **Drop the GRA-link lock** (calendar locks the pill unless a GRA sub-issue is linked, 17856; `_kasperUndecidedComps` skips unlinked graphic 21969‑71) — samples have no automation, so a thumbnail is reviewable iff `thumbnail_url` is present, link-independent. |
| Creative direction + hide-from-client | KEEP | (samples-only) old samples `_smToggleDir` 11122‑31; cols `creative_direction`,`hide_creative_direction` | Port the old-samples textarea + eye toggle. Not a review component (no status). Client render respects `hide_creative_direction`. |
| Linear VIDEO link / GRAPHIC link | KEEP (inert) | `_calLinearSlotHtml` 17558‑76; commit `_calLinearCommit` 17626 fires `_calSyncStatusFromLinear` | Render plain editable URL slots (`video_linear_url`,`graphic_linear_url`). On commit: persist the URL only — **no** `_calSyncStatusFromLinear`, **no** `_calPushStatusToLinear`, **no** dedupe/parent/move/banner machinery. Validate it's a URL; escape with `_calEscAttr` in `href`. |
| Comment threads (per component) | KEEP | `video_comments`/`graphic_comments` arrays; `_calCommentsFor` 11760; `_calCommentsForView` audience 11825 | Port for video+graphic only. Reuse the audience/reply-inheritance model + the atomic merge. |
| Review/tweak/approval lifecycle | KEEP | statuses 11590; review 20827‑21131; Kasper 26518/27023; stamps | Fork over `SXR_COMPONENTS=['video','graphic']`. Reuse CAL_STATUSES/CAL_PRIORITY. |
| Caption component | REMOVE | `_calCapBlockHtml` 11968‑12011; member of `CAL_COMPONENTS` 11594 | **Load-bearing — fork, don't hide.** `_calMigratePostShape` seeds `caption_status='In Progress'`; `computeOverallStatus` is worst-of → a seeded caption pins every sample below Approved forever. Samples table/upsert physically omit `caption*`; component set is `['video','graphic']`. |
| Caption generator / edit caption prompt | REMOVE | gen 19318‑19500; kebab 16246 → 19849 | Drops out with the caption block; never call `generate-caption`. |
| Call-to-action (CTA) | REMOVE | input 17899; col `cta` | Leaf field — omit render + drop from ALLOWED. |
| Scheduled / calendar dates | REMOVE | date input 17809‑27,17895; Month/Week views; col `scheduled_date` | No date field. Sort queues by `order_index`. Drop the date chip from the review/Kasper card. |
| Color tag | REMOVE | `_calColorTagHtml` 12168; col `color` | Leaf — omit. |
| All-months / all-content dropdowns | REMOVE | `_calMonthFilterHtml` 15887; `_calStatusFilterHtml` 16075 | No dates → meaningless. Omit from the samples toolbar. |
| Import from Excel / Linear | REMOVE | kebab 16243/16244 | Omit kebab + modals. Links are hand-typed, never imported. |
| Bulk Linear sync | REMOVE | kebab 16245; select action 17438 | Omit (Linear automation). |
| Edit platforms | REMOVE | kebab 16247; strip 12269; col `platform(s)` | Omit. (`_calIsYouTubeCard` reads platforms for title-review, also removed → nothing reads platforms.) |
| Collaborative mode | REMOVE | kebab 16248; `_calIsCollabOn` 17394 | Omit toggle. Hardcode the samples client posture (see §9.4); substitute a constant wherever shared review code reads `_calIsCollabOn`. |
| YouTube title review | REMOVE | kebab 16249; `CAL_REVIEW_COMPONENTS` 11602 | Omit. `_sxrComponentsFor` is a flat `['video','graphic']` — never a title-bearing list. |
| Title-in-review | REMOVE | title pseudo-component via `CAL_REVIEW_COMPONENTS` | Title/name stays as a plain editable label; **never** a review component. Preview switch has only video+graphic branches. |
| Linear sub-issue automation | REMOVE | status push 18760; pull `_calSyncStatusFromLinear` 13934; linear-* workflows | Omit ALL. Keep only the inert link fields. Add a probe asserting a samples save never hits `LINEAR_SET_STATUS_URL`/`LINEAR_ADD_COMMENT_URL`. |
| Append-only event log | **ADD** | (none exists anywhere — verified) | New `sample_review_events` table, written server-side from the upsert diff. §5.2. |
| SAMPLE marker | **ADD** | n/a | Presentational badge on Kasper + a `kind`/source flag; never touches the state machine. §8. |

---

## 5. Data model

### 5.1 `sample_reviews` table
Mirror the calendar's review-relevant columns; drop caption/title/date/CTA/color/platform; add
creative-direction + the two inert Linear URLs. All `text` except the two status-at `timestamptz`.

```sql
create table if not exists public.sample_reviews (
  client                       text not null,
  id                           text not null,            -- minted client-side as sr_<ts36>_<rand>
  order_index                  text,
  name                         text,                     -- the sample's plain title/label
  asset_url                    text,                     -- video/reel
  thumbnail_url                text,                     -- thumbnail/graphic
  creative_direction           text,
  hide_creative_direction      text,                     -- 'TRUE' | 'FALSE'
  video_linear_url             text,                     -- INERT reference URL
  graphic_linear_url           text,                     -- INERT reference URL
  status                       text,                     -- overall = worst-of(video,graphic)
  video_status                 text,
  graphic_status               text,
  video_tweaks                 text,                     -- JSON comment array
  graphic_tweaks               text,                     -- JSON comment array
  client_video_approved_at     text,
  client_graphic_approved_at   text,
  kasper_approved_at           text,
  kasper_approved_by           text,                     -- actor name (extensive tracking)
  kasper_finished_at           text,                     -- global Finish hand-off (cross-device)
  kasper_closed_at             text,                     -- global X-close (cross-device)
  kasper_seen                  text,                     -- CSV of components
  kasper_approved_after_tweaks text,                     -- CSV of components
  thumb_rev                    text,                     -- cache-bust token (bumped on a media-link write)
  video_status_at              timestamptz,              -- server-stamped exact change moment
  graphic_status_at            timestamptz,              -- server-stamped exact change moment
  created_at                   text,
  updated_at                   text,
  primary key (client, id)
);
```
> If the **card model** decision (§15) is "single-component cards" rather than "one card with both
> components", add `kind text` (`reel|thumb`) and the component set per card becomes the single kind.
> Default recommendation is one card carrying both components → no `kind` needed.

### 5.2 `sample_review_events` — the append-only audit log (the "register everything")
**Verified: no event/audit/history table exists anywhere today** (8 candidate names probed live →
all 404). Row stamps are *mutable* (e.g. `kasper_approved_at` is cleared to `''` on reopen) and
comments are GC'd at 30 days — so the row alone can never be the durable register. This table is
that register.

```sql
create table if not exists public.sample_review_events (
  id          bigint generated always as identity primary key,
  client      text not null,
  sample_id   text not null,
  ts          timestamptz not null default now(),
  actor       text,                 -- who (name), for attributability
  role        text,                 -- smm | kasper | client
  action      text not null,        -- status_change | approve_video | approve_graphic |
                                     -- kasper_approve | kasper_finish | kasper_close |
                                     -- comment_add | comment_resolve | comment_delete |
                                     -- reorder | link_set | link_clear | create | archive
  component   text,                 -- video | graphic | null
  from_status text,
  to_status   text,
  payload     jsonb,
  created_at  timestamptz not null default now()
);
create index sample_review_events_sample_idx on public.sample_review_events (client, sample_id, ts desc);
create index sample_review_events_action_idx on public.sample_review_events (action);
```
- Written **service-role from `sample-review-upsert`**, computed by diffing the incoming patch
  against the `Read Existing Row` snapshot the webhook already fetches (so the diff is free).
- **Append-only & best-effort**: the insert uses `onError: continueRegularOutput` — a log failure
  must never block a save.
- Anon-readable (`using(true)`, matching the project's posture) so we can later render an in-app
  "history" timeline on a card. (See §15 decision on exposure.)

### 5.3 `sample_review_merge_comments` RPC
Clone `migrations/2026-06-18-atomic-comment-merge.sql` for **two columns only** (`video_tweaks`,
`graphic_tweaks`): a single row-locked `UPDATE … returning setof sample_reviews`, per-cell union by
comment id (newer `updated_at||created_at` wins, tombstones kept, >30d tombstones pruned),
`updated_at` written as `to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')` (TEXT
ISO, to match parity). `security invoker`; `revoke all from public`; `grant execute to service_role`.
> The calendar RPC returns `setof calendar_posts` and **cannot** be re-pointed — this is genuinely new.
> Do **not** reuse the old samples non-atomic JS merge for review-grade samples (it has the
> lost-update/tombstone-resurrection race the calendar already fixed).

### 5.4 Server-side status-at trigger
Reuse the `calendar-status-at-migration.sql` pattern: a `BEFORE INSERT/UPDATE` trigger
`sample_reviews_stamp_status_at` that sets `video_status_at`/`graphic_status_at` to `now()` when the
respective `*_status` changes. **No FE/n8n change and no rollout ordering** (the columns are never
sent by the FE), and it captures *every* write path — the cleanest "every status change" capture.

### 5.5 RLS + realtime (copy `CALENDAR_REALTIME_MIGRATION.md` verbatim, swap names)
For **both** `sample_reviews` and `sample_review_events`: `enable row level security`;
`grant select to anon`; `create policy "anon read <t>" … for select to anon using (true)`; add to
`supabase_realtime` via the idempotent `pg_publication_tables` guard; `replica identity full`.
**No anon write policy** — writes go through n8n service_role only. Verify live: anon SELECT 200,
anon INSERT **401**, realtime subscription accepted.

### 5.6 Column ↔ ALLOWED ordering (a recurring data-loss footgun)
Every additive migration in this repo carries the same warning: the n8n Supabase mirror uses
`autoMapInputData`, so if the FE sends a column the table lacks, the **mirror upsert errors and the
whole save fails**. **Always: create the Supabase column → then add the name to the webhook ALLOWED
list → then ship the FE.** Never the reverse.

---

## 6. n8n webhooks

### 6.1 New webhooks (greenfield — verified none exist)
| Webhook | Role |
|---|---|
| `sample-review-get` | Reads `sample_reviews` for a client; `{ok, items[]}`. Mostly a **fallback** — the v2 FE reads Supabase REST directly. |
| `sample-review-upsert` | The critical one — clones `calendar-upsert-post`'s guard graph with samples column lists. |
| `sample-review-reorder` | Per-row `order_index` update of existing rows (unknown ids skipped); no insert. |
| *(Kasper samples queue)* | **NOT a webhook** — a direct paginated Supabase REST read in the FE, preserving the no-idle-load architecture. |

### 6.2 `sample-review-upsert` node graph (mirror of `calendar-upsert-post`)
```
Receive POST → Build Row From Patch → Read Existing Row (Supabase sample_reviews)
  → Merge Comments (ALL guards) → Is Conflict
      ├─ true  → Respond JSON {ok:false,…}
      └─ false → Strip Routing → Prep Mirror → Row Existed?
                   ├─ true  → Build RPC Args → Call sample_review_merge_comments (helper sub-wf)
                              → Strip Tweaks For Mirror → Mirror Update (scalars only)
                   └─ false → Mirror Create (full row)
                 → Diff & Insert Event (sample_review_events, onError:continueRegularOutput)
                 → Wrap Response → Respond JSON {ok:true, sample}
```

**ALLOWED list (samples):**
`order_index, name, asset_url, thumbnail_url, status, creative_direction, hide_creative_direction,
video_status, graphic_status, video_tweaks, graphic_tweaks, video_linear_url, graphic_linear_url,
client_video_approved_at, client_graphic_approved_at, kasper_approved_at, kasper_approved_by,
kasper_seen, kasper_approved_after_tweaks, kasper_finished_at, kasper_closed_at`
*(Dropped vs calendar: `caption*`, `title*`, `cta`, `color`, `scheduled_date`, `platform(s)`, `post_url`, `posted_at`, legacy `tweaks`.)*

**SCALAR_FIELDS (conflict guard):** `name, asset_url, thumbnail_url, status, video_status,
graphic_status, creative_direction, video_linear_url, graphic_linear_url, kasper_approved_at`.

**CONTENT_FIELDS (phantom-row guard):** `name, asset_url, thumbnail_url, creative_direction,
video_tweaks, graphic_tweaks`.

### 6.3 Guards — MANDATORY to replicate (these are data-loss bugs)
| Guard | Why mandatory |
|---|---|
| Phantom-row guard | Blocks ghost-row creation from a misrouted skeleton patch. |
| Read-fail `{ok:false}` guard | `Read Existing Row` runs `continueRegularOutput`; a read error must return a *retryable* `{ok:false}`, not mis-fire the phantom throw and eat the user's text (the 2026‑06‑14 outage bug). |
| `comments_base_at` conflict guard over samples SCALAR_FIELDS | v2 sends **field patches**; without it, two SMMs silently last-writer-wins a scalar. (Old whole-row samples didn't need it; the review tab does.) |
| Atomic `sample_review_merge_comments` over `video_tweaks`/`graphic_tweaks` | Prevents concurrent-comment loss + tombstone resurrection. |
| `Strip Tweaks For Mirror` before the scalar Mirror Update | So the scalar write can't re-clobber the just-merged comment cells. |
| Same ISO `updated_at` written to every store | LWW parity (`a995ae4`). |
| Mirror write **fail-loud** (`onError: stopWorkflow` → 5xx → FE retry); event-log insert **best-effort** (`continueRegularOutput`) | There is no Sheet backstop in v2 — the Supabase write *is* the write. |

### 6.4 Guards to DROP / adapt for samples
- **`__CLEAR_LINK__` sentinel + link-clobber carry-forward** — **KEEP** for both inert URL fields
  (a stale whole-card patch carrying blank links would otherwise wipe a saved URL); the FE emits the
  sentinel to clear a link on a field patch.
- **Dup-link twin guard + `Read Link Twins` node** — **DROP** entirely (inert URLs; two samples may
  reference the same issue; no collapse data-loss path).
- **Linear automation, `generate-caption`, caption/title columns** — never present.

### 6.5 Process discipline
- **No-touch confirmation:** we create **all-new** workflows; we modify **zero** calendar or
  old-samples workflows.
- **Snapshot-before-edit** still applies if we ever touch an existing workflow; for the new ones,
  export each created workflow JSON to `n8n-backups/sample-review-*.<date>.initial.json`.
- **Verify `versionId === activeVersionId`** on every new writer before relying on it (the
  divergent-draft trap that bit `calendar-reorder`).
- **Credential caveat:** the merge helper relies on n8n auto-attaching the single `supabaseApi`
  (service_role) credential; if a second one ever exists, the RPC node must be hand-attached.

---

## 7. Front-end design

### 7.1 Namespace, nav, routing, teardown
- **Namespace:** `_sxr*` / `sxrState` / `_sxrV2*`; channel `sxr-<slug>`; id prefix `sr_`
  (`_sxrMintId('sr')`); flag `?sxr=1` **default-OFF** with sticky `syncview_sxr_on` /
  `syncview_sxr_off`; LS cache `syncview_sxrCache_v1:<slug>`, prefs/seen `syncview_sxr_prefs_v1` /
  `syncview_sxrSeen_v1`; route `#sample-reviews`; nav id `navSampleReviews`, label "Samples (Review)".
- **Nav:** add one static `<a id="navSampleReviews">` after `navSamples` (4164), hidden behind the
  flag like `navKasper`. The old "Samples" button is left byte-identical.
- **navTo:** add one `else if (page === 'sample-reviews')` branch (render + mount), an active-toggle
  line, and a teardown line at ~11415: `if (page !== 'sample-reviews') _sxrV2Teardown();`. Also tear
  down at the top of `mountSampleReviews` (defensive, as `mountCalendar` does at 13168).
- **Boot/hash routing:** add branches mirroring the calendar/old-samples ones for `v=sample-reviews`
  (client share), `#sample-reviews/<slug>/<id>` (deep link, both boot router + hashchange), and the
  `savedNav==='sample-reviews'` restore.
- **Per-client switch:** flush pending saves FIRST (`_sxrFlushAllPending`), then switch + load (the
  load opens/repoints the realtime channel). The captured-slug guard in the save path depends on this.

### 7.2 The component-set fork — FOUR call sites (not one)
`computeOverallStatus` (11645) hardcodes `CAL_COMPONENTS` *directly* — it does NOT go through
`_calComponentsFor`. So forking the component list means re-deriving **four** functions as samples
analogs, each iterating `SXR_COMPONENTS=['video','graphic']` and never referencing caption/title:
1. `computeSampleOverallStatus` (replaces the hardcoded `CAL_COMPONENTS.map` at 11645)
2. samples stale-approval clearing (replaces `_calClearStaleApprovals` 11658)
3. samples client-ready (replaces `_calIsClientReady` 17149)
4. `_sxrComponentsFor` (flat `['video','graphic']`, no YouTube/title branch)

`_sxrMigrateShape` must **never seed** `caption_status`/`title_status` (and the table/ALLOWED omit
them) — otherwise the worst-of math pins every sample below Approved forever. A unit test mirroring
`test/title-review-lifecycle.js` proves no caption/title path is reachable.

### 7.3 Card render — `_sxrRenderInlineCard` (clone of `_calRenderInlineCard` 17789‑17910)
- **Reuse:** the thumbnail box + `_calThumbContent`/`_calDeriveThumb*`/`_calThumbMediaHtml`/
  `_calCacheBustThumb` (with a **new `thumb_rev` column** + a `_sxrThumbRev` session map), the two
  `_calLinkFieldHtml` editors (`thumbnail_url`, `asset_url`), the title/`name` row, the comments
  button + save chip, the per-component sub-status pills.
- **ADD:** the creative-direction textarea + hide toggle (port `_smOnDirInput`/`_smOnDirBlur`/
  `_smToggleDir` 11114‑31); two **inert** Linear URL slots.
- **DROP:** caption block, CTA, date row, color tag, platforms strip, the GRA-link pill-lock, the
  needs-link/parent/missing Linear banners, `_calSmmWarnOverlayHtml` (optional).
- **Escaping:** use `_calEsc` for text, `_calEscAttr` for attributes, `_jsAttrArg` for inline
  `onclick(...)` args. **Do NOT reuse `_smEsc`** (it escapes only `&<>`, not `"`/`'`). `name`,
  `creative_direction`, and the inert URLs are new injection sinks.

### 7.4 Optimistic save — `_sxrFlushCardSave` (clone of `_calFlushCardSave` 18492)
- `_sxrOnFieldInput`/`_sxrOnFieldBlur` → `_sxrPendingEdits`/`_sxrSaveTimers` → debounced flush
  (`SXR_SAVE_DEBOUNCE_MS = 650`).
- **Captured slug** taken before any await (prevents an edit leaking into the next client's tab);
  **`_sxrSaveInFlight` double-submit lock** (queued edits re-flush in the `finally`).
- **Field-level patch** (never whole-row): `{ id, …changed scalars, changed *_tweaks }`; new rows /
  forced resends use whole-card semantics.
- **`comments_base_at: ''` under v2** (mandatory — the scalar-conflict guard compares against the
  base; v2 reads `_baseAt` from Supabase, so a non-empty base false-conflicts every save). The
  comment 3-way merge still unions both sides server-side.
- **Echo adoption:** merge `json.sample` onto the **full local row FIRST, then** run
  `_sxrMigrateShape` (the partial-echo status-revert fix). Self-echo bookkeeping
  (`_sxrLastLocalWriteAt`) suppresses the realtime echo of our own write.
- **`_SXR_ROLLBACK_FIELDS`** (status/approval-stamp/link/order columns) roll back on a failed save;
  free-text (name/creative_direction/urls/comments) does not. "Save failed · Retry" chip remains.
- Bump `thumb_rev` only when `thumbnail_url`/`asset_url` is in the edits.

### 7.5 Reorder — `persistSxrReorder` (clone of `persistCalReorder` 20178)
DOM drag via the reused `_calWireDragOnCard` logic; **do not bump `updated_at`** on reorder; pin
intended `order_index` in `_sxrReorderOptimistic` for a guard window so a racing reload can't snap
back; serialize/coalesce in-flight drags; assign slots unique across the **whole** sample set
(including archived/hidden) and sort by `order_index` with a **stable `id` tiebreaker**; parse
`order_index` numerically (it's TEXT — don't let "10" sort before "2"). Undo toast.

### 7.6 Realtime runtime — `_sxrV2*` (clone of `_calV2*` 15194‑15398)
- **Replicate:** `_sxrV2Enabled/_Ready` (own flag/kill keys, **default-OFF**), `_sxrV2FetchCards`
  (`/rest/v1/sample_reviews?select=*&client=eq.<slug>` via the reused paginator, fallback to
  `sample-review-get`), `_sxrV2EnsureSubscribed` (channel `sxr-<slug>`, table `sample_reviews`,
  filter `client=eq.<slug>`, catch-up snapshot on **re**-subscribe), `_sxrV2OnRealtimeChange`
  (debounce + self-echo suppression + editing-busy deferral → background reload),
  `_sxrV2Teardown`. Own `_sxrLastLocalWriteAt`, in-flight maps, debounce const, self-echo window.
- **Reuse as-is:** `_calV2LoadLib`, `_calV2Client`, `_calSupabaseFetchAllRows` (the new table is
  `(client,id)`-keyed and the REST `select` includes `id` AND `client`, so the compound cursor holds).
- **No poller**; tear down on leave; idle tab = zero calls.

### 7.7 Review lifecycle fork (SMM ↔ Kasper ↔ Client)
Clone `_calReviewCardBody`/`_calReviewPanelHtml` + the comment subsystem
(`_calCommentsFor`/`_calStringifyComments`/`_calMergePostComments`/compose/done-toggle/audience)
restricted to video+graphic, plus the resolve chooser (`_calShowResolveDest` 22606 — keep the
Kasper/Client/Approved routes + "Mark done — don't change status" + non-destructive X-close exactly;
do NOT reintroduce the discard-confirm). The SMM and client review handlers (`_sxrReviewApprove`,
`_sxrReviewRequestTweak`, `_sxrReviewComment`) carry **handler-level `_isClientLink`/surface-status
guards** (a client may act only on a component at Client Approval or Tweaks Needed); a double-click
yields one effect (in-flight guard).

### 7.8 Creative direction + inert Linear links
- Creative direction: textarea + eye toggle; `hide_creative_direction` carried through the upsert;
  client render omits the block when set.
- Inert links: on commit, validate it is a URL and persist; **never** call `_calSyncStatusFromLinear`
  or push status; render the open-in-Linear anchor with `_calEscAttr`. A samples save must never hit
  any Linear webhook (assert with a probe).

---

## 8. Kasper integration — samples on the review surface, marked

**Constraint (verified):** every mutating Kasper handler funnels through
`_kasperPersistPost → calendar-upsert-post` and `computeOverallStatus`, and the Kasper queue's
localStorage cache hardcodes a `{video,graphic,caption}` transient shape. So samples must **not** be
unioned naively into `_kasperState.items` — they would either hit the calendar upsert (corrupting
`calendar_posts`) or force `source`-branches inside the exact functions the calendar queue depends on.

**Design:** a **dedicated Samples section on Kasper's review surface** (cleanest: a fifth
`KASPER_SUBTABS` entry `samples`, parallel to the existing `editors`/`filming` non-`review` tabs —
a proven pattern), with each card rendered **identically** to a calendar Kasper card but carrying a
prominent **`SAMPLE` badge**. It:
- reads `sample_reviews` cross-client via **`_calSupabaseFetchAllRows`** (paginated — *never* a flat
  `limit=N`, which would silently truncate at 1000 as the table grows),
- uses its **own** `sxrState`/`_kasperState.samplesData` slice (never `_kasperState.items/.replies/
  .history/.dismissed/.closed`),
- persists Kasper actions through **`sample-review-upsert`** (never `_kasperPersistPost`),
- reuses the **same per-component review UI** + the **global Finish/Close** machinery
  (`kasper_finished_at`/`kasper_closed_at` on the sample row, judged by message `created_at` not
  `updated_at`),
- keeps the SAMPLE badge **purely presentational** (a literal in the template — it never reaches
  `computeOverallStatus`, the gate, the partition, or any merge).

**v1 scope on Kasper:** **omit URGENT** (it requires `video_status==='Tweaks Needed'` + a Linear
issue to tag an editor via Slack — samples have no synced issue) and **omit the Replies/Messages
inbox union** (it reads per-component audience-tagged cells; don't co-mingle). Both can be added
later, scoped to the samples section.

> Whether this is a *separate section* vs. *one unified badged queue* is a genuine UX decision (§15).
> The separate-section design is the safest and is the recommended default; the badge requirement is
> met either way.

---

## 9. The state machine (statuses, transitions, terminal) — the deltas

### 9.1 Statuses / priority (reuse the calendar's)
`CAL_STATUSES` / `CAL_PRIORITY` reused. Overall = **worst-of (lowest priority) across exactly
video + graphic**. One component at Tweaks Needed forces the card to Tweaks Needed.

### 9.2 Transitions (identical to calendar, minus caption/title/Linear/publishing)
SMM submit → For SMM Approval → send-to-Kasper (Kasper Approval, sets `kasper_seen`) → Kasper
approve (Client Approval, stamps `kasper_approved_at`/`_by`) → client approve (Approved, stamps
`client_<comp>_approved_at`). Tweak loops: Kasper request-change (Tweaks Needed, card stays pinned in
queue) → SMM resolve via chooser (back to Kasper Approval, or skip to Client Approval if
approve-after-tweaks pre-cleared); client request-change (Client Approval → Tweaks Needed) → SMM
resolve → Client Approval → client approve. Kasper undo-approve restores the snapshot.

### 9.3 Terminal (decision §15, default adopted)
**Terminal = Approved (all components Approved) + Archived (from any state).** Drop `Scheduled`/
`Posted` and the `_calApplyAutoStatus` Posted/Scheduled short-circuits (verify no handler still
expects `Posted`). Samples have no publishing.

### 9.4 Client-surface posture (no collaborative mode)
Hardcode a samples `_sxrIsClientReady` analog (mirror `_calIsClientReady` minus the collab branch,
substituting a constant for `_calIsCollabOn`). Default: the client sees in-review + finished items
and can run the client review/approve loop, cannot suggest/create. `creative_direction` is hidden
from the client when `hide_creative_direction` is set.

---

## 10. Parallel-run & cutover

### 10.1 Collision list — identifiers the new tab must NOT reuse or mutate
`sm*`/`_sm*`/`_smV2*` functions + `window.*` handlers (`setSmKind`, `openSmComments`,
`addSampleCard`, …) · `smState` and all `_sm*` sidecar globals · `SAMPLES_*_URL` + the
`samples-*` n8n routes · table `content_samples` · channels `sm-<slug>` / `cal-<slug>` /
`workload_issues` / `kasper-cal` · LS keys `syncview_samplesCache_v1:*`, `syncview_samples_prefs_v1`,
`syncview_samplesSeen_v1`, `syncview_samples_v2[_off]` · id prefix `s_` · nav id `navSamples`, route
`#samples`, page key `'samples'`, share value `v=samples` · the `?sv2` flag. **Read-only-safe to
share:** `wlNormalizeClient`, `WL_CLIENT_NAMES`, `_calGetPins` (pins — read-only), `clientMap`
tokens, the Supabase creds + `_calV2LoadLib`, `_isClientLink`, `showConfirm`, the escapers.

### 10.2 Parallel nav
Both "Samples" (old) and "Samples (Review)" (new) visible during the parallel period; the new button
hidden unless `?sxr=1`/sticky LS. **`?sxr` defaults OFF** (the old `?sv2` is default-ON — do NOT copy
that default by habit, or SMMs get cut over early). Two realtime channels per client during overlap
(`sm-<slug>` + `sxr-<slug>`) — both cheap (`eventsPerSecond:5`), both must tear down on nav-away.

### 10.3 Cutover (later, mechanical — every identifier is uniquely named)
Delete the `navSamples` button; delete the `samples` `navTo` branch + its toggle/teardown; point or
drop `#samples`/`v=samples` routes; delete the old `_sm*` block + `SM_*` consts; drop `?sv2` + the
`content_samples` table + `samples-*` webhooks once data is migrated. Because old = `sm`/`samples`/`s_`
and new = `sxr`/`sample-reviews`/`sr_`, removal is a clean delete with zero edits to v2 code.

---

## 11. Preventive bug checklist (the bug-proofing backbone)

Full 48-class table lives in the audit; here are the **TOP 12 rules Samples v2 MUST follow**, each
tied to its source fix. (Sources: every incident doc, ~25 root-caused fix commits, ~90 probes.)

1. **Field-level patches for the review row, never whole-row.** Two components on one row = the exact
   clobber surface that bit the calendar (`d54f804`, p42). Old samples is whole-row — wrong template.
2. **Migrate/normalize only the MERGED full row — never the partial echo.** Overlay echo → full row
   → then `_sxrMigrateShape` (the partial-echo status-revert, `CALENDAR_V2_AUDIT_HANDOFF`).
3. **Atomic, row-locked comment merge** via `sample_review_merge_comments` (concurrent-comment loss /
   tombstone resurrection, `e3741f9`/`84d44b1`, p11). Strip comment cells from the scalar mirror.
4. **Compound `(id,client)` keyset pagination on every read, especially the unscoped Kasper queue**
   (PostgREST 1000-cap + same-id-across-clients, `03c4376`/`524c577`, p46). Reuse `_calSupabaseFetchAllRows`.
5. **Right escaper for the context** — `_calEsc`/`_calEscAttr`/`_jsAttrArg`; **never `_smEsc` in
   attribute/JS contexts** (it misses `"`/`'`). `name`/`creative_direction` are new sinks (p02).
6. **Audience confidentiality + reply inheritance** — internal/Kasper notes never render for the
   client; replies inherit the parent thread's audience (`_calCommentsForView`, p08/p23/p63).
7. **Cross-client isolation in the fan-out Kasper queue** — resolve every card within its `(client,id)`
   group; client view filters `client=eq.<slug>`; slugs via `wlNormalizeClient` (p56/p63).
8. **Handler-level role + review-gate guards (defense in depth)** — UI hiding is not enough; clients
   drove SMM-only handlers directly (`3e11f57`/`732b2b4`, p07/p13/p18/p85).
9. **Double-submit idempotency** on every approve/request/reply handler (p06/p26/p84).
10. **Realtime: suppress self-echo, defer-don't-drop, catch-up on re-subscribe, zero idle calls**
    (p21/p49/p70, PR #481/#474). New channel `sxr-<slug>`; no poller; tear down on leave.
11. **n8n save-latency is cosmetic only if the UI is optimistic — keep the new webhook lean**, add
    ~10–15 s timeouts, write identical ISO `updated_at` to every store, and **wire no Linear
    automation** (no status-sync write amplification) (`N8N_SAVE_LATENCY_AUDIT`, `a995ae4`).
12. **Rollout discipline:** column-before-allowlist (`THUMBNAIL_CACHE_ROLLOUT`, `585ff32`),
    Supabase-primary writes with anon-SELECT-only RLS (test anon INSERT → 401), realtime publication
    + `replica identity full`, snapshot-before-edit + `versionId===activeVersionId`.

Plus, specific to this feature: **drop the GRA-link pill-lock** (a sample with no Linear link must
still be reviewable — gate review on `thumbnail_url`/`asset_url` presence, not the link); **keep the
SAMPLE badge purely presentational**; **thumbnail cache-bust via `thumb_rev`** + image-reuse
harvest/restore to avoid flicker (`a9f7a1b`/`THUMBNAIL_DESYNC_INCIDENT`); **pointer-held repaint
defer** on the Kasper queue (`dd32218`); **disable card `draggable` while a text field is focused**
(`494f3a4`); **finished-card stays finished across refresh** — re-surface only on a server-confirmed
stamp + a message newer by `created_at` (`028cbd7`/`b5e73f5`).

---

## 12. Test plan (layered + real-browser)

Grounded in the existing harness; **no samples test coverage exists today** — all net-new.

**Tier 0 — unit/wiring (`test/*.js`, every-push CI gate, brace-extract real functions, no network):**
clone `title-review-lifecycle.js` → `samples-overall-worst-of.js` (overall = worst-of(video,graphic),
no caption/title path reachable) and `samples-migrate-shape.js` (never seeds caption/title); clone
`review-request-change-audience.js` → audience no-leak; clone `comment-resolve-defer.js` → component-
scoped merge + tombstone; clone `kasper-review-state-global.js` + `kasper-finish-refresh-popback.js`
→ global finish/close + popback race (badge survives partition); clone `calendar-reorder-smoothness.js`
→ slot uniqueness; clone `calendar-thumb-cache-bust.js` → `thumb_rev`; stale-approval clearing.

**Tier 1 — golden flows (`qa/golden_sample_*.js` + `golden_sample_lib.js`, live backend, client
`sidneylaruel`, archive cleanup):** clean approve, kasper tweak loop, client tweak loop,
approve-after-tweaks, undo-approve, archive cross-surface, **+ a new `golden_sample_7_marked_as_sample`**
(sample reaches Kasper's queue rendered with the SAMPLE marker; a parallel calendar card does NOT
carry it; cross-check both directions). Assert sub-status + worst-of overall + Kasper-queue presence
+ client view after every step.

**Tier 2 — live probes (`qa/probes/ps*.js`, nightly gate):** mirror p17 (kasper finish), p22 (SMM
review routing), p26 (concurrent approve), p42/p44 (cross-component clobber), p11 (comment merge),
p20 (reorder collision), p02 (XSS in label/creative_direction), p07 (client guards), p21 (realtime),
p46 (>1000-row queue presence — pad + clean), p24 (comment-delete-across-reload tombstone).

**Tier 3 — closest-to-real browser capstone (`ps_capstone_real_browser_sample_marker.js`):** a real
headless **Chromium** driving the **real Samples v2 tab** against the staged sample webhooks,
end-to-end **SMM → Kasper → Client**, verifying the **SAMPLE marker** on Kasper's page, asserting
**0 JS errors** on all three surfaces, scoped to `sidneylaruel` with unique `sr_probe_*` ids and full
archive/tombstone cleanup. This is the "real interaction" test you asked for.

**Pre-push ritual:** syntax-check the inline script → full `test/*.js` by exit code → targeted
samples probes → only then commit on a branch (never `main`). Isolation invariants: old samples and
v2 never cross-contaminate; the SAMPLE marker never appears on a real calendar card; with the flag
off, zero Supabase calls on the samples path.

---

## 13. Phased rollout

- **Phase 0 — Decisions & schema sign-off.** Resolve §15. Finalize the table/column list.
- **Phase 1 — Backend (Supabase first, then n8n).** Run the SQL (`sample_reviews`,
  `sample_review_events`, the merge RPC, the status-at trigger, RLS/realtime). Then build the three
  webhooks with full ALLOWED + guards. Verify live (anon SELECT 200 / INSERT 401 / realtime
  round-trip / concurrent-comment survives / event row appended). Snapshot each new workflow.
- **Phase 2 — Front-end, behind `?sxr=1` (dark).** Add the namespace, nav (hidden), routing,
  `_sxrV2*` runtime, card render, save/reorder, the review fork (4 call sites), creative direction +
  inert links, and the Kasper samples section + badge. v1/old-samples byte-identical with the flag off.
- **Phase 3 — Test.** All of §12 green: Tier 0 (CI), Tier 1–2 (probes), Tier 3 (real-browser capstone).
- **Phase 4 — Flip & soak.** Flip `?sxr` default-ON behind a sticky kill-switch, or roll out to a
  subset first. Old Samples tab stays until you confirm SMMs have migrated; then the mechanical cutover (§10.3).

Each phase gates the next; nothing ships to `main` un-verified.

---

## 14. Risk register
| Risk | Mitigation |
|---|---|
| Caption seeded as a phantom component pins samples below Approved | Fork all 4 call sites; table/ALLOWED omit caption; unit test proves unreachable |
| Naive Kasper union corrupts `calendar_posts` | Separate state slice + persist via `sample-review-upsert`; never `_kasperPersistPost` |
| 1000-row truncation hides new samples from Kasper | Reuse `_calSupabaseFetchAllRows` (compound keyset); probe asserts >1000 presence |
| Whole-row save clobbers a sibling component | Field-level patches + `_patchBase` snapshot |
| Internal/Kasper notes leak to client | `_calCommentsForView` audience gating + reply inheritance; correct escaper |
| Column-before-allowlist mirror error breaks saves | Strict Supabase-first ordering |
| Inert links accidentally re-activate automation | Persist URL only; no `_calSyncStatusFromLinear`/push; probe asserts no Linear webhook hit |
| New tab perturbs the still-running old samples / calendar | Fully disjoint namespace; shared globals read-only; flag default-OFF |
| Mutable row stamps lose history | Append-only `sample_review_events` as the durable register |

---

## 15. Open decisions (recommended defaults adopted pending your confirmation)
1. **Card model** — one sample card carrying **both** a video + thumbnail component (calendar-style,
   *recommended*, matches "behave exactly like the calendar"), vs. each sample a single-component card
   (old-samples `reel|thumb`). Drives whether `kind` exists and how worst-of overall is scoped.
2. **Kasper placement** — a **dedicated "Samples" section/sub-tab** on Kasper's review page
   (*recommended* — safest isolation), vs. one unified review queue with a SAMPLE badge. Both satisfy
   "marked as a sample."
3. **Review depth / initial stage** — full calendar machine **including the "For SMM Approval"
   pre-Kasper stage** (*recommended* — "exactly like the calendar"), vs. straight-to-Kasper (simpler,
   like old samples).
4. **Client review loop** — clients run the **full client approve/tweak loop** on samples
   (*recommended* — mirrors the calendar + old samples' client approval stage), vs. Kasper-only
   (client just views).

Secondary (lower-stakes, defaults adopted): terminal = Approved + Archived (drop Scheduled/Posted);
graphic reviewable iff `thumbnail_url` present (drop the GRA-link lock); `sample_review_events`
anon-readable for a later in-app history view; keep the 30-day comment GC but log comment add/delete
to the event table so deletions are durably recorded; inert links keep a cheap URL-format validation.
