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

---

## Phase 2 — APPLIED & LIVE (2026-06-18)

Migration `calendar_merge_comments` pasted into Supabase (SECURITY INVOKER, granted
to service_role). The "Upsert Post" workflow (pWSqaqVw7dmqhYOA) UPDATE branch now:

```
Row Existed? (true) → Build RPC Args → Call Atomic Merge → Strip Tweaks For Mirror → Mirror Update → Wrap Response
```

- **Build RPC Args** (Code): builds {p_client, p_id, p_<comp>=raw tweaks for cols present, p_base:''}.
- **Call Atomic Merge** (Execute Sub-workflow): calls helper `meM78zr1Gcl72c6f`
  ("Calendar Comment Merge (helper)") → HTTP POST /rest/v1/rpc/calendar_merge_comments
  with the supabaseApi (service_role) credential. The row-locked function merges the
  *_tweaks columns atomically — concurrent writers can no longer clobber each other.
- **Strip Tweaks For Mirror** (Code): removes *_tweaks from the row so the scalar
  Mirror Update never re-writes them (that whole-cell write was the race). Mirror Update
  then writes scalars + the ISO `updated_at` (authoritative).
- CREATE branch (Mirror Create) unchanged — a new row writes its first comment as-is;
  the RPC is an UPDATE so it no-ops pre-existence.
- On helper/RPC failure the workflow errors → webhook 5xx → the FE retries (no silent loss).

Active version after change: c30642aa-4007-4db7-b964-ce5efbcc63e3
ROLLBACK: restore version 9c8e4a93-0de8-4e27-ad82-21d672c01d6b (History), OR re-point
`Row Existed?` output 0 back to `Mirror Update` and delete the 3 added nodes.

NOTE (credential): the helper's HTTP node relies on n8n auto-resolving the single
`supabaseApi` credential (the API couldn't attach it explicitly). Verified working in
live production executions. If a SECOND supabaseApi credential is ever added, attach the
correct one to the helper's "Call Merge RPC" node in the n8n UI.

VERIFIED LIVE: concurrent same-component writes both survive (qa7c ×2); delete-vs-add no
longer resurrects/loses (qa12 ×3); regression — delete 6/6, multi-surface comments+badge
7/7, reply threading 10/10.
