# Kasper review state → global (cross-device) — rollout

**Goal:** Kasper's **"Finish reviewing"** (hand-off) and **X-close** must be
**global**, not per-browser. When Kasper finishes a card on his device it should
move to **"Tweaks pending"** for the SMM and **stay there on every device and
across refreshes** — and re-surface only on a genuine fresh ask. Until now both
lived in his browser's `localStorage`, so his Finish never reached anyone else,
and a refresh on another device (or after a cache clear) lost the state.

## How it works

Two **persisted timestamp columns** on the card carry the state, exactly like the
existing `kasper_approved_at`:

- **`kasper_finished_at`** — set when Kasper hits **Finish reviewing** on a card
  with outstanding change-requests (a hand-off). The card sits in **"Tweaks
  pending"** and **stays there** — a later message (an SMM reply OR a client
  tweak) updates it **in place** but does **not** move it. It returns to
  **"Waiting"** for exactly one reason: a component is re-sent to **Kasper
  Approval** (an *actionable* one — an unlinked-thumbnail graphic stuck at KA does
  **not** count, it can't be acted on). *(Product rule, 2026-06-29: an earlier
  build also re-surfaced on any newer message, which kept bouncing finished cards
  back into Waiting whenever a client added a tweak — e.g. Alli Schaper "Video 12".
  That message branch was removed from `_kasperIsFinished` / `_sxrKasperIsFinished`.)*
- **`kasper_closed_at`** — set when Kasper **X-closes** a card (no decision, just
  hide it). It re-surfaces when a new message lands after the stamp.

Both ride the upsert echo + Supabase realtime to every open browser, so a
refresh on **any** device shows the same state.

- **Front end:** `_kasperIsFinished` / `_kasperIsClosed` in `index.html` read the
  stamps off the card (the cross-device source of truth). The old per-browser
  flags (`_kasperState.dismissed` / `.closed`) are kept **only as a same-device
  fallback** so behaviour is unchanged until the backend is switched on. The
  write paths (`_kasperDismiss`, `_kasperClose`) stamp the column **and** persist
  the card via the normal upsert.
- **Regression test:** `test/kasper-review-state-global.js`.

## Rollout steps (in order)

The front-end change is already shipped and is **safe on its own** — until the
backend below is in place, `kasper_finished_at` / `kasper_closed_at` are simply
dropped by the upsert and Kasper's review still works **per-device** via its
localStorage fallback (today's behaviour). To turn on the **cross-device**
behavior:

1. **Supabase — add the columns.** Run `migrations/kasper-review-state-migration.sql` in the
   Supabase SQL editor (project `uzltbbrjidmjwwfakwve`). Idempotent.

   ```sql
   alter table public.calendar_posts add column if not exists kasper_finished_at text;
   alter table public.calendar_posts add column if not exists kasper_closed_at  text;
   ```

2. **n8n — allow the fields through the upsert.** In the `calendar-upsert-post`
   workflow, open the **`Build Row From Patch`** Code node and add the two names
   to the `ALLOWED` array:

   ```js
   const ALLOWED = [
     'order_index','scheduled_date','name','asset_url','thumbnail_url',
     // …existing entries…
     'kasper_seen','kasper_approved_after_tweaks',
     'kasper_finished_at','kasper_closed_at'        // ← add
   ];
   ```

   Nothing else changes: the Google Sheet write (`autoMapInputData`,
   `insertInNewColumn`) auto-adds the columns, the Supabase mirror
   (`autoMapInputData`) writes them, the fetch returns all columns, and
   `Wrap Response` echoes them back.

**Do step 1 before step 2.** If the fields are allowed through before the
Supabase columns exist, the mirror upsert sends an unknown column and errors.

### One-time note about cards finished *before* this rollout

Cards Kasper finished while the old (per-browser) code was live had their local
"finished" flag **erased by the earlier bug**, and there is no server stamp for
them yet — so they will show in **"Waiting"** until he finishes them once more.
After steps 1–2 are live, Kasper should hard-refresh and click **Finish
reviewing** on each lingering hand-off **one more time**; from then on it sticks
and is global. (This is a one-time catch-up, not an ongoing issue.)

## Verify

Two browsers — ideally two **different devices/profiles** — one as Kasper, one as
the SMM (or a second Kasper session with empty localStorage). On the Kasper
session, request a change on a card and hit **Finish reviewing**. Within ~1s it
should move to **"Tweaks pending"** on **both** sessions and **stay there after a
refresh on the second device** (which never saw Kasper's localStorage). A new
reply (SMM or client) must **NOT** move it — it stays in **"Tweaks pending"**;
only re-sending a component to **Kasper Approval** brings it back to **"Waiting"**.
