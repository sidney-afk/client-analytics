# Thumbnail auto-refresh (`thumb_rev`) — deployed-state record

> **Current status (verified 2026-07-14): DEPLOYED.** This file is no longer an executable
> rollout checklist. Do not re-run its former SQL or edit a live n8n allowlist from this document.
> Canonical evidence is the current schema, `supabase/functions/calendar-upsert/index.ts`,
> `index.html`, and `test/calendar-thumb-cache-bust.js`.

## Contract

When a post's thumbnail link changes—or the file behind an unchanged share link is replaced—the
image must refresh for the SMM, client, and Kasper without unrelated saves causing flicker.

Thumbnail image URLs carry `_cb` for ordinary row freshness and `_r` for a real thumbnail revision.
The per-post `thumb_rev` token is part of the strip reuse key. It changes when a thumbnail/asset link
is written and when Graphics leaves `Tweaks Needed`, covering the normal same-link replacement
workflow. Session state provides an immediate local update; the persisted value carries the change
across reloads, realtime, and devices.

## Current implementation evidence

- `calendar_posts.thumb_rev` exists in the committed live schema baseline.
- `calendar-upsert` accepts and persists `thumb_rev`.
- Calendar and Samples save paths bump and send it; Kasper's patch allowlist carries it.
- `_calThumbRev` / `_calCacheBustThumb` keep `_r` in the image reuse key.
- `test/calendar-thumb-cache-bust.js` guards same-link refresh and unrelated-save reuse behavior.

These statements describe the repository/deployed contract; they are not permission to mutate a
workflow or schema. Any future backend change follows the normal release manifest, TEST proof,
fingerprint/readback, and rollback controls.

## Verification

Use two isolated TEST-client sessions. Replace a thumbnail link or move Graphics out of
`Tweaks Needed` after replacing the file behind the same link. Both sessions must reload the image
without a hard refresh; caption/status/date-only saves must retain the decoded image. Include
reload, second-device, realtime interruption/recovery, and stale-write cases before changing the
contract.
