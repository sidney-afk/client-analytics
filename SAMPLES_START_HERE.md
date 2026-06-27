# Samples (Review) — START HERE (rebuild handoff)

**Read this first.** It's the single entry point for rebuilding the Samples
(Review) **front end**. The backend is already built, live, and verified — the
front end is a **clean slate** (everything was torn down on purpose). This doc
tells you the state of the world and which doc to read next; the *how* lives in
`SAMPLES_REBUILD_SPEC.md`.

---

## TL;DR — where we are right now

- **Backend = DONE and LIVE** (Supabase + n8n). Don't rebuild it; just talk to it.
- **Front end = removed (clean slate).** `index.html` has **zero** new-samples
  FE code (`_sxr` count = 0). Verified: calendar / old-samples / TikTok untouched,
  inline JS parses, 0 runtime errors. (The teardown is PR #597.)
- **Goal of the rebuild:** the SMM/Kasper/Client surfaces should be the **exact
  same experience as the content calendar**, minus the excluded items — by
  **cloning the calendar's code** into a `_sxr*` namespace, not reinventing it.
- **It ships default-OFF** behind `?sxr=1`, fully isolated from the calendar.

---

## What the backend does (plain English)

Think of one **sample** = one piece of content (a video + its thumbnail) being
reviewed. The backend stores and moves those through review:

- **Supabase table `sample_reviews`** — one row per sample, keyed by
  `(client, id)`. It holds *everything*: the video & thumbnail links, the two
  Linear issue links, the creative direction, the per-component statuses
  (`video_status`, `graphic_status`) + the overall `status`, the comment threads
  (JSON in `video_tweaks` / `graphic_tweaks`), every approval timestamp, and the
  Kasper bookkeeping. A second table, **`sample_review_events`**, is an
  append-only audit log of every change.
- **The app reads** `sample_reviews` straight from Supabase (REST + realtime, so
  edits show up live across tabs/devices).
- **The app writes** through one n8n webhook, **`sample-review-upsert`** — it
  takes a *field-level patch* (only the columns that changed), and it safely
  **creates** rows, **archives** them (`status=Archived`), and **merges** comment
  threads so two people editing at once don't clobber each other. A second
  webhook, **`sample-review-reorder`**, persists drag order.
- **Linear sync** (so the editors, who live in Linear, stay in step):
  - *Outbound* — when a status changes in the app, it's pushed to the linked
    Linear issue (via shared, generic Linear webhooks). A durable retry queue
    (`syncview_sxr_linear_outbox_v1`) covers failures.
  - *Inbound* — when an editor moves a Linear issue, that flows back and updates
    the matching sample's status. ⚠️ This runs as an **embedded extra branch
    inside the calendar's existing Linear webhook** (so it adds **zero** extra
    n8n executions). Don't delete that branch.
  - *Reconciler* — a 10-minute safety net that re-converges the app and Linear if
    a real-time event is ever dropped.

All of this is **live and verified**. The rebuilt front end only has to speak to
it correctly — the exact contract (table columns, status vocabulary, comment
object shape, endpoints, flags) is in **`SAMPLES_REBUILD_SPEC.md` §3**.

---

## What EXISTS vs what was REMOVED

**KEPT / LIVE (do not rebuild):**
- Supabase: `sample_reviews` + `sample_review_events` tables, the comment-merge
  RPC, the `*_status_at` trigger, RLS (anon read) + realtime — `sample-reviews-migration.sql`.
- n8n: `sample-review-upsert`, `sample-review-reorder`, the **embedded inbound
  Linear branch** in the calendar Linear webhook, and the reconciler
  (`scripts/sample-linear-reconcile.js` + workflow). Snapshots in `n8n-backups/sample-*.json`.
- The **test harness** `qa/sxr_courier_lib.js` (real-browser, Linear mocked) — the
  rebuild reuses it.
- All the docs below.

**REMOVED (the clean slate):**
- Every line of the new-samples **front end** in `index.html` (`_sxr*`, the
  `Samples (Review)` nav/route/CSS, the Kasper samples sub-tab, the client surface).
- The orphaned `test/samples-*.js` suites and `qa/probes/sxr_*.js` probes (they
  tested the removed FE). The harness stayed.

> Note: the **old** "Samples" tab (`_sm*`, flag `?sv2=1`, "Samples v2" log strings)
> is a **different, still-live feature** — leave it alone.

---

## The non-negotiable rules for the rebuild

1. **Clone the calendar; don't reinvent.** Copy each calendar function into the
   `_sxr*` namespace, re-pointed to `sample_reviews` / `SXR_COMPONENTS`
   (`['video','graphic']`). This is how we avoid divergence bugs. (`SAMPLES_REBUILD_SPEC.md`
   §1 is emphatic about this — it's why the first attempt failed.)
2. **Test like a human.** For every surface, the FIRST probe opens the tab COLD
   (no backend seeding) and drives the real user journey — **click "Add sample",
   type, paste links, change status, archive** — through the real UI. A suite that
   only seeds rows can't prove the feature is usable from zero. (That blind spot is
   exactly how the first build shipped with no "Add" button.) See
   `docs/HEADLESS-TESTING-GUIDE.md` §3.
3. **Default-OFF + isolated.** All behind `?sxr=1` (sticky), separate
   state/table/namespace. The ONE shared piece is the embedded inbound Linear
   branch — don't touch it.
4. **Test client `sidneylaruel` only. Linear MOCKED in probes** (never hit real
   Linear). Archive what you create. FE changes ship on a branch, never `main`.
5. **Build one surface at a time and verify each** before moving on
   (`SAMPLES_REBUILD_SPEC.md` §10 has the suggested order).

---

## Exact conventions (carry forward)

- **Flag / route:** `?sxr=1` default-OFF, sticky in localStorage. SMM deep link
  `?sxr=1#sample-reviews/<slug>/<cardId>`. Client share link **must include
  `?sxr=1`**: `?sxr=1&c=<name>&v=sample-reviews[&t=<token>]`.
- **Namespace:** `_sxr*` / `sxrState` / channel `sxr-<slug>` / id prefix `sr_`.
- **Components:** `video` + `graphic` ONLY (`graphic` is labelled "Thumbnail").
  No caption, no title.
- **Status vocab (6, no Scheduled/Posted):** In Progress · For SMM Approval ·
  Kasper Approval · Client Approval · Tweaks Needed · Approved. Overall =
  worst-of(video, graphic). Terminal = Approved / Archived.
- **Excluded** (the full list is `SAMPLES_REBUILD_SPEC.md` §5): caption + its
  generator/prompt, CTA, calendar dates/scheduling, colour tag, the all-months &
  all-content dropdowns, import-from-Excel, import-from-Linear, bulk-Linear-sync,
  edit-platforms, collaborative mode, YouTube-title review, title-in-review.

---

## Read order for the new session

1. **This file** — orientation (you're here).
2. **`SAMPLES_REBUILD_SPEC.md`** — the rebuild bible: backend contract (§3), the
   full surface-by-surface inventory mapping each calendar function → samples
   target (§4), exclusions (§5), routing/flags (§6), decisions already made (§7),
   the test plan (§8), the "do not break" warnings (§9), and the build order (§10).
3. **`docs/HEADLESS-TESTING-GUIDE.md`** — how to test (esp. §3, the cold-open rule).
4. Reference as needed: `SAMPLES_V2_PLAN.md` (the original full design + the
   Linear-sync internals), `SAMPLES_GO_LIVE.md` (cutover checklist),
   `SAMPLES_PARITY_LOG.md` (calendar↔samples drift tracker),
   `sample-reviews-migration.sql` (the exact schema), `n8n-backups/sample-*.json`
   (workflow snapshots).

## How to start

Start a fresh session and have it: read this file → read `SAMPLES_REBUILD_SPEC.md`
→ produce/confirm a build plan from §4 + §10 → build **one surface at a time**,
cloning the calendar code, writing the **cold-open journey probe first** for each,
and verifying (unit + real-browser, Linear mocked, test client `sidneylaruel`)
before moving on. Everything ships behind `?sxr=1` on a branch.
