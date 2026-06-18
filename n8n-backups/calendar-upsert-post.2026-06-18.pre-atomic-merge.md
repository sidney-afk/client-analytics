# Snapshot — "SyncView Calendar — Upsert Post" (before atomic-merge wiring)

- Workflow ID: `pWSqaqVw7dmqhYOA`
- Webhook: POST https://synchrosocial.app.n8n.cloud/webhook/calendar-upsert-post
- Active version at snapshot: `9c8e4a93-0de8-4e27-ad82-21d672c01d6b`
- ROLLBACK: n8n keeps full version history. To revert, open the workflow →
  History → restore version `9c8e4a93-0de8-4e27-ad82-21d672c01d6b`.

## Current write path (the part being changed)
```
Receive POST → Build Row From Patch → Read Existing Row → Read Link Twins
  → Merge Comments (guards + JS 3-way comment merge) → Is Conflict?
     ├─ true  → Respond JSON (no write)
     └─ false → Strip Routing → [ Upsert Calendar Row (Google Sheets),
                                   Prep Mirror → Row Existed?
                                      ├─ true  → Mirror Update (Supabase, full row, autoMapInputData)
                                      └─ false → Mirror Create (Supabase, full row) ]
                                   → Wrap Response → Respond JSON
```
The race: `Read Existing Row` (read) and `Mirror Update` (write) are not atomic, so
two concurrent same-component comment writes both read the pre-write state and the
last writer clobbers the other (silent comment loss / tombstone resurrection).

## Phase-2 change (apply AFTER the SQL function exists)
Goal: the *_tweaks columns become atomic; everything else unchanged.
1. `Mirror Update` (UPDATE branch only) writes SCALARS only — strip
   video_tweaks/graphic_tweaks/caption_tweaks/title_tweaks/tweaks from its input.
2. Add `Merge Comments (atomic)` Supabase-RPC node after `Mirror Update` that calls
   `calendar_merge_comments(client, id, video, graphic, caption, title, base='')`
   with the RAW incoming tweaks from `Build Row From Patch` (NULL for absent cols).
   This UPDATE is row-locked → concurrent callers serialise, nothing is lost.
3. `Mirror Create` (CREATE branch) unchanged — a brand-new row writes its first
   comment as-is; the RPC is an UPDATE so it no-ops on a not-yet-existing row.
4. Google Sheets mirror unchanged (best-effort backup; v2 reads Supabase).

Verify after wiring: /tmp/qa/qa7c.js (concurrency repro) must show BOTH comments
survive on a sidneylaruel card, and a normal single save must still round-trip.
