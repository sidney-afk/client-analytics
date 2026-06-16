# Thumbnail auto-refresh (`thumb_rev`) — rollout

**Goal:** when anyone changes a post's thumbnail link — even to the *same* link
(a new file behind an unchanged Google Drive share link) — the picture refreshes
**live for every viewer** (the SMM, the client, Kasper), with no hard refresh.

## How it works

Thumbnail `<img>` URLs already carry a `_cb` cache-buster (the post's
`updated_at`). But the strip reuses the already-decoded image across re-renders
whenever the base URL is unchanged (this is what stops a flicker on every
caption/status save), so a same-link thumbnail swap kept showing the stale image.

Fix: a per-post **`thumb_rev`** token, bumped **only** when a thumbnail/asset
link is written, appended to the image URL as `_r` and **kept** in the strip's
reuse key. Because it changes only on a link write, unrelated saves still reuse
the decoded image (no flicker), but a real link change forces a reload on every
render path. `thumb_rev` is a **persisted column**, so the new token rides the
upsert echo + Supabase realtime to every open browser — that's what makes the
client's and Kasper's views reload live.

- **Front end:** sourced session-first (`_calThumbRev[id]`, instant on the editor
  + graceful fallback) then persisted (`post.thumb_rev`, remote viewers + after a
  reload). See the `_calThumbRev` / `_calCacheBustThumb` block in `index.html`.
- **Regression test:** `test/calendar-thumb-cache-bust.js`.

## Rollout steps (in order)

The front-end change is already shipped and is **safe on its own** — until the
backend below is in place, `thumb_rev` is simply dropped by the upsert and the
editor still updates locally via its in-session fallback. To turn on the
**cross-viewer** behavior:

1. **Supabase — add the column.** Run `calendar-thumb-rev-migration.sql` in the
   Supabase SQL editor (project `uzltbbrjidmjwwfakwve`). Idempotent.

   ```sql
   alter table public.calendar_posts add column if not exists thumb_rev text;
   ```

2. **n8n — allow the field through the upsert.** In the `calendar-upsert-post`
   workflow, open the **`Build Row From Patch`** Code node and add `'thumb_rev'`
   to the `ALLOWED` array:

   ```js
   const ALLOWED = [
     'order_index','scheduled_date','name','asset_url','thumbnail_url',
     // …existing entries…
     'kasper_seen','kasper_approved_after_tweaks',
     'thumb_rev'                      // ← add
   ];
   ```

   Nothing else changes: the Google Sheet write (`autoMapInputData`,
   `insertInNewColumn`) auto-adds the column, the Supabase mirror
   (`autoMapInputData`) writes it, and `Wrap Response` echoes it back.

**Do step 1 before step 2.** If the field is allowed through before the Supabase
column exists, the mirror upsert sends an unknown column and errors.

## Verify

Two browsers on the same client (e.g. an SMM tab and a client-link tab). Change a
card's thumbnail link (or re-save the same link after swapping the Drive file).
The image should update in **both** within ~1s, no refresh. Caption/status/date
edits must **not** make the thumbnail flicker.
