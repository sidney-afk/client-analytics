# Calendar v2 — Session Handoff (2026-06-14, evening)

**Read this first**, then `CALENDAR_V2_AUDIT_HANDOFF.md` (Phase 2 brief) and
`CALENDAR_REALTIME_MIGRATION.md` (full plan; see its **"Phase 3 prep — 2026-06-14"**
section). This captures everything done in the 2026-06-14 evening session and exactly
what's left, so a fresh session can continue cleanly.

> **Project:** migrate the content calendar (and later Samples) from Google Sheets →
> Supabase (live reads + realtime). v2 is gated behind `?v2=1`; v1 (default) is unchanged
> until a deliberate flip. **Be empirical:** verify against live Supabase + n8n; reproduce;
> don't guess. Branch + open PRs; **never push to `main`.**

---

## TL;DR — where we are
- **Every calendar-data reader now reads Supabase under `?v2=1`:** main calendar, client
  share-link (`?c=`), SMM review, **Kasper queue** (migrated this session), **filming
  runway** (migrated this session). Verified live: one grouped Supabase query reproduces
  every client's `calendar-get` id-set exactly (15/15, 617 rows).
- **Sheet ↔ Supabase parity: PERFECT** — 617 rows / 15 clients / 15 fields each (statuses,
  comments, links, `order_index`, `updated_at`), **0 diffs** (re-verified several times).
- **All 5 writers mirror to Supabase**, including `calendar-reorder` — the reorder-mirror
  gap was closed this session (Sidney published it in n8n; verified writing).
- **v2 is NOT flipped to default.** Still behind `?v2=1`.
- The back half of the session = shaking out real-use **review-UX bugs** under v2 (several
  fixed/merged; one open PR; one cross-tab item to re-test) + a transient **Google Sheets
  API outage** that exposed write-path fragility.

## What shipped this session

| PR | What | Status |
|----|------|--------|
| **#479** | Phase 3 prep: Kasper queue + filming runway → Supabase (v2); reorder snapshot + docs | **merged** |
| **#480** | 3 review fixes: live Notes dot on realtime; Kasper stays in **"Waiting"** until **Finish reviewing** (then → "Tweaks pending"); deleting a tweak no longer pops the resolve modal | **merged** |
| **#481** | Realtime **self-echo** fix: calendar + Kasper ignore the realtime echo of your *own* write (no self-flicker, no delete-resurrect race; Kasper queue doesn't rebuild while you're typing) | **merged** |
| **#482** | Kasper: **preserve the textarea caret** across an after-save card repaint (the "approving the thumbnail kicks me out of the caption box" bug) | **OPEN — merge + test** |

**Outside git (n8n):** `calendar-reorder` (`OXd0sUoSJYMspGTF`) Supabase mirror — Sidney added
the two mirror nodes (copied from `calendar-reorder-batch`) and published. It's now the
batched algorithm **+ mirror**; verified writing to Supabase with parity. Pre-change snapshot
of the live per-row version: `n8n-backups/calendar-reorder.2026-06-14.pre-mirror.json`.

## Empirical facts verified (you can trust the infra)
- **Supabase** ref `uzltbbrjidmjwwfakwve`, table `public.calendar_posts`, PK `(client,id)`,
  all text. Browser **publishable** key is in `index.html` (`CAL_SUPABASE_ANON_KEY`,
  committed, RLS-protected). REST read works; **anon write → HTTP 401** (RLS correct).
  **Realtime**: a `postgres_changes` subscription is accepted live (table in
  `supabase_realtime` publication, `replica identity full`).
- **Parity PERFECT** (numbers above).
- **n8n writers** (synchrosocial.app.n8n.cloud), all active with the mirror in the LIVE
  version, mirroring with the **same `updated_at`** as the Sheet write:
  upsert `pWSqaqVw7dmqhYOA`, append `iA54ipMOybicmYBh`, delete `JcekBKUzELgX4HjH`,
  reorder-batch `lTtZNLrQLpIZqwAY`, reorder `OXd0sUoSJYMspGTF`. `linear-status-sync`
  `MJbMZ789B5ExZz9x` inherits the mirror by calling the upsert webhook.
- **v1 is byte-identical**: every Supabase entry point is gated behind `_calV2Ready()`; with
  the flag off there are zero Supabase calls and supabase-js never loads.

## Known issues / in progress
1. **Cross-tab realtime intermittency — NOT fixed; needs re-test.** Kasper acts → the SMM's
   calendar in a *separate tab* sometimes doesn't update without a manual refresh. Two
   contributors: (a) today's Sheets outage was *failing* Kasper's saves, so nothing
   propagated — **re-test now that Sheets recovered**; (b) a backgrounded tab's WebSocket/
   timers are browser-throttled, so the intended catch-up is the **v2 return-refresh when you
   focus the SMM tab** (`CAL_RETURN_REFRESH_MIN_MS_V2 = 4s`). Test by *clicking into* the SMM
   tab. If it still won't update after focusing → real delivery bug: add lightweight console
   logging (subscription status / event received / reload fired) to diagnose. **Don't
   guess-patch** (this session's pattern: realtime patches can spawn new issues).
2. **Per-card thumbnail flash** on the *acted* Kasper card — optimistic + after-save
   `_kasperRepaintCard` rebuilds the card, so its `<img>` re-decodes. Minor; deferred. Fix =
   reuse the `<img>` element across rebuild, or a targeted DOM update instead of full-card
   `replaceWith`.

## The Sheets-write fragility (today's outage — important)
A burst of saves coincided with a **~5-min Google Sheets API outage** (~21:42–21:47 UTC,
"Service unavailable"). Confirmed root-cause chain (n8n execution 68798):
- `Read Existing Row` (Sheets) hung ~185s, then errored **"Service unavailable"**.
- With `onError: continueRegularOutput`, the workflow continued with an **error object (no
  `id`)** → the **phantom-row guard misread "couldn't read the row" as "row doesn't exist"**
  and rejected the status-only patch.
- The FE sat on "saving" ~3 min, then failed → **those saves were lost** (re-applied once
  Sheets recovered).

**Proposed upsert robustness fix (NOT done — needs go-ahead + snapshot + publish):**
1. Give `Read Existing Row` a short timeout (~10s) so it fails fast instead of hanging ~3 min.
2. In `Merge Comments`, **early-return a clean `{ok:false, error:'store briefly unavailable,
   try again'}` when `Read Existing Row` returned an error object** — so the phantom-row guard
   can't misfire on a read failure.
Edit to the live `calendar-upsert-post` (`pWSqaqVw7dmqhYOA`); snapshot first; Sidney publishes.

**The real cure:** make **Supabase the write target** (writes still go through Sheets,
amplified ~3× by the Linear status-sync: 1 FE save → ~3 upsert executions, each doing ~3
Sheets ops). That's a Phase-4-scale migration of its own — plan pending.

## What's left — the plan
- **Bucket 1 — finish v2 stabilization (almost done):** merge **#482**; test [live Notes dot
  on a teammate's note, Kasper Waiting→Finish, delete-no-modal, no self-flicker, caret holds];
  re-test cross-tab realtime (issue 1) post-outage.
- **Bucket 2 — harden writes:** the upsert robustness fix (above); then plan **writes →
  Supabase**.
- **Bucket 3 — flip + cleanup:** **flip v2 → default** *after* Bucket 1 is green and a few
  days of dogfooding (don't rush the flip while UX bugs are still surfacing); then **Phase 4
  security/cleanup**.
- **Separate track — Samples migration:** its own project; a paste-in **"Content Samples →
  Supabase"** prompt was written this session (in chat) — do it after the calendar lands.
  Key facts for it: Samples is an architectural twin (per-client `Samples_<slug>` tabs on the
  SAME Sheet; webhooks `samples-get` / `samples-upsert` / `samples-reorder`; FE module search
  `CONTENT SAMPLES`, `loadSamples`, `smState`; slug = `wlNormalizeClient` = same as calendar).
  **Use a separate flag (`?sv2=1`), NOT `?v2=1`** — the calendar's flip must not activate
  half-built samples reads.

## Phase 4 / security (flagged; fix later)
- **Live Linear API key in plaintext** in the `linear-status-sync` + `linear-issue-statuses`
  code nodes — a real exposure; rotate into an n8n credential. (Redacted in repo backups as
  `[REDACTED-LINEAR-KEY]`; **never commit the real key.**)
- **Rotate the service_role key** (pasted into chat in a prior session) → update n8n
  credential `Supabase - SyncView Calendar` (`XdBpJ6Xk8PMpZXXT`). Not in the repo.
- Calendar webhooks are **unauthenticated + CORS `*`**; tighten the anon RLS from `using(true)`
  to per-client when real auth lands.

## Key references
- **Test URLs:** main calendar `https://syncview.synchrosocial.com/?v2=1#calendar`; Kasper
  review `https://syncview.synchrosocial.com/?v2=1&Kasper=1#kasper` (`Kasper=1` unlocks the
  hidden view; filming runway = `#kasper/filming`). GitHub Pages caches `index.html` ~10 min →
  **hard-refresh after deploy.** Console: `calV2Status()` → `{flag, ready, subscribed, slug}`.
- **Test client:** `sidneylaruel`. Archived test-residue row: `p_test_dw_001`.
- **Code:** all in `index.html` (one inline `<script>`). Search anchors: `CALENDAR v2`,
  `_calV2`, `loadCalendarPosts`, `_calFlushCardSave`, `_calV2OnRealtimeChange`,
  `_kasperFetchAllRelevantPosts`, `_kasperPartitionItems`, `_kasperRepaintCard`,
  `_filmsFetchRunway`, `_calDeleteComment`.
- **Harnesses (Node, no deps; must pass):** `node test/calendar-v2-status-repro.js`,
  `node test/calendar-v2-banner-persist.js`.
- **Reading Supabase directly (audit):** REST with the committed publishable key —
  `https://uzltbbrjidmjwwfakwve.supabase.co/rest/v1/calendar_posts?select=*&client=eq.<slug>`
  with headers `apikey` + `Authorization: Bearer <publishable key>`.
- **n8n snapshots:** `n8n-backups/`. Snapshot any workflow before editing it.

## Open PRs at handoff
- **#482** (caret preservation) — open; merge + test.
- (#479, #480, #481 merged.)
