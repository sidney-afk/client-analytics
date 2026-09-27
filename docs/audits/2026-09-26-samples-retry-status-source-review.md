# Samples retry can resend an older status

**Status:** Source-only finding and repair proposal at main `3f5bd46e6086911ae2a7bb0d32507f03d5a44da8`. No browser reproduction, live data read, deployment, or frequency estimate is claimed.

## Why this is a new sibling

Calendar's existing-card whole-card save stopped sending status columns that the current edit did not touch in #1678. Its failure mode was a stale tab copy resetting a newer status. The Samples save has the same risk in its **Retry** path, even though its ordinary existing-card save is a field-level patch. OPEN_REPAIRS 162 records an earlier Samples whole-card retry/link race, but its repair holds the per-card save lock; it does not narrow the status fields sent by a later retry.

## Source trace

1. [`_sxrRetrySave`](../../src/index/280-samples-cards-notes.js.part#L612) queues an empty edit bucket when an ordinary failed save has no retained repair edits. [`_sxrFlushCardSave`](../../src/index/280-samples-cards-notes.js.part#L324) then uses the existing local row.
2. The [ordinary existing-row branch](../../src/index/280-samples-cards-notes.js.part#L490) sends only edited fields. The [empty-edit branch](../../src/index/280-samples-cards-notes.js.part#L506) instead copies the whole row, including `status`, `video_status`, and `graphic_status`. Its request always sends `comments_base_at: ''` at [line 524](../../src/index/280-samples-cards-notes.js.part#L524).
3. The checked-in [Edge Function](../../supabase/functions/sample-review-upsert/index.ts#L155) admits those three fields. Its [scalar conflict check](../../supabase/functions/sample-review-upsert/index.ts#L368) runs only when that base timestamp is nonempty; its [existing-row update](../../supabase/functions/sample-review-upsert/index.ts#L449) writes the received scalar patch. The [status-stamp trigger](../../migrations/sample-reviews-migration.sql#L223) advances the change timestamp if the older status is written back.

A conditional sequence follows from that source: tab A holds an older Samples video status, its asset-only save fails, tab B saves a newer status, and tab A clicks Retry before adopting B's update. The empty-bucket retry can write A's older status with no scalar freshness refusal. This is an inference from the checked-in paths, **not** a claim that the sequence has occurred in production.

## Proposed repair and acceptance

Retain the failed field set for an existing card and retry only those fields; keep whole-row creation for a new card. Do not convert an intentional status retry into a dropped status change. A focused offline test should hold two fictional tab copies, fail A's asset-only save, advance B's status, then retry A and assert the outgoing existing-card payload excludes every untouched status field. Cover a failed new-card save and an intentional status edit as separate controls. Any server-side freshness change would need its own review against the frozen tokenless client-link contract.

This proposal changes no writer, migration, runtime flag, or live system.
