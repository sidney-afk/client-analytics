# Thumbnail revision history

> **SECURITY/CORRECTNESS BLOCKERS (F78–F80/F83).** The active scanner has no deployed scan-key and
> currently fails open to anonymous service-role Drive/Storage work. The active folder resolver is
> also anonymous and its final write is not a URL/version compare-and-set, so reversed requests can
> commit stale parent metadata. Separately, the supposedly backend-only revision table grants anon
> SELECT/realtime over cross-client Drive/private-path/requester/error metadata. Do not invoke or
> schedule either path until required auth, bounded work, atomic CAS, revoked anonymous reads, and
> deployed negative/concurrency tests pass.

## Goal

When a thumbnail/graphic is sent back for changes, SyncView should keep enough
history to answer two questions:

- Was the Google Drive image changed after the request?
- What did it look like before and after?

This is intentionally separate from `thumb_rev`. `thumb_rev` refreshes the
current image in the app when a Drive link stays the same. Thumbnail revision
history stores comparison evidence across time.

## First implementation

The first version is backend-only and additive.

1. A Calendar post or Samples row changes `graphic_status` from anything else to
   `Tweaks Needed`.
2. The Edge writer checks the row's `thumbnail_url`.
3. If the thumbnail is a single Google Drive file, it captures a baseline image
   snapshot and Drive revision metadata into `thumbnail_media_revisions`.
4. If the thumbnail is a Drive folder, Dropbox folder, Frame.io link, direct URL,
   or blank value, the capture is skipped. Folder links are common for Stories
   and multi-image sets; there is no single image to compare yet.
5. The scheduled/manual `thumbnail-revision-scan` Edge Function checks pending
   rows. When Drive's revision metadata changes, it captures the new snapshot and
   marks the row `changed`.
6. When the graphic leaves `Tweaks Needed`, the Calendar/Samples writer also
   scans that card's pending baseline. The frontend sends a fresh `thumb_rev` on
   the same status save, so open tabs reload the current image without a hard
   refresh even when the Drive link did not change.

Snapshots live in the private Supabase Storage bucket
`syncview-thumbnail-revisions`. Postgres stores metadata and storage paths only.

## Files

- `migrations/2026-07-09-thumbnail-media-revisions.sql`
  - Creates the private Storage bucket.
  - Creates `public.thumbnail_media_revisions`.
  - **F83 blocker:** currently enables anonymous metadata read/realtime for a future UI that does
    not exist. Revoke this; keep service-role-only until an authenticated least-field projection is
    designed and negatively tested.
- `supabase/functions/_shared/thumbnail-revisions.ts`
  - Shared Drive metadata, snapshot, baseline capture, and scan logic.
- `supabase/functions/calendar-upsert/index.ts`
  - Captures a baseline when Calendar `graphic_status` enters `Tweaks Needed`.
  - Scans the pending baseline when Calendar `graphic_status` leaves
    `Tweaks Needed`.
- `supabase/functions/sample-review-upsert/index.ts`
  - Captures a baseline when Samples `graphic_status` enters `Tweaks Needed`.
  - Scans the pending baseline when Samples `graphic_status` leaves
    `Tweaks Needed`.
- `supabase/functions/thumbnail-revision-scan/index.ts`
  - Scans pending baselines and records the changed revision.
- `test/thumbnail-revision-history.js`
  - Offline source guard for the wiring and folder-skip behavior.

## Rollout

1. Run `migrations/2026-07-09-thumbnail-media-revisions.sql` in the Supabase SQL
   editor for project `uzltbbrjidmjwwfakwve`.
2. Deploy the shared Edge Function changes:

   ```bash
   supabase functions deploy calendar-upsert --project-ref uzltbbrjidmjwwfakwve --no-verify-jwt
   supabase functions deploy sample-review-upsert --project-ref uzltbbrjidmjwwfakwve --no-verify-jwt
   supabase functions deploy thumbnail-revision-scan --project-ref uzltbbrjidmjwwfakwve --no-verify-jwt
   ```

3. Confirm Drive access secrets are present. `thumbnail-folder-resolve` already
   uses these; the revision helper uses the same API-key/service-account pattern.

   Required for public Drive files:

   ```bash
   GOOGLE_DRIVE_API_KEY
   ```

   Recommended for shared/private workspace files:

   ```bash
   GOOGLE_SERVICE_ACCOUNT_JSON
   ```

   or:

   ```bash
   GOOGLE_CLIENT_EMAIL
   GOOGLE_PRIVATE_KEY
   ```

4. **Mandatory:** set a dedicated scan key/service signature before any manual or scheduled caller.
   The function must fail closed when the secret is absent; verify deployed no-key/malformed-key
   denial and a bounded correct-key TEST run (F78).

   ```bash
   supabase secrets set THUMBNAIL_REVISION_SCAN_KEY=<shared-secret> --project-ref uzltbbrjidmjwwfakwve
   ```

5. Schedule `POST /functions/v1/thumbnail-revision-scan` every 10-15 minutes
   from n8n or another scheduler. Send `X-Syncview-Key` if the scan key is set.

   Example body:

   ```json
   { "limit": 50 }
   ```

   Narrow scan for the test client:

   ```json
    { "client": "<PRIVATE_TEST_CLIENT>", "limit": 10 }
   ```

## Folder links

Folder links are deliberately skipped in this version. For Stories or other
multi-image deliverables, a future version should model the folder as a set:

- list direct children at request time,
- snapshot each image or at least child IDs/checksums,
- compare added/removed/changed children,
- present a folder-level diff in the UI.

That should be a separate design because it has different storage and UX rules
from a single thumbnail image.

## UI follow-up

The data model is ready for a card-level comparison UI, but this first pass does
not expose the snapshots in the browser. The future UI should:

- show a small indicator when a card has a pending or changed thumbnail revision,
- open a compare modal with baseline/latest images,
- handle private Storage paths through a short-lived signed URL function,
- keep folder rows hidden until folder-set diffing exists.

## Test client

Use only the privately configured `<PRIVATE_TEST_CLIENT>` for live verification. Existing useful
fixtures observed on 2026-07-09:

- Single Drive image:
  `https://drive.google.com/file/d/1rpOCT4NRO6ZUWoiWfShrMP3YQ3e8tDT2/view?usp=drive_link`
- Drive folder, expected skip:
  `https://drive.google.com/drive/folders/1UfrowQc0fLTuZDn_6deKgLO8SHOSJ_Da?usp=sharing`

Live verification after rollout:

1. Create or reuse a `<PRIVATE_TEST_CLIENT>` test card with the single Drive image.
2. Move the graphic component to `Tweaks Needed`.
3. Confirm one `thumbnail_media_revisions` row appears with `status='pending'`
   and a `baseline_storage_path`.
4. Run `thumbnail-revision-scan`; confirm it stays `pending` when Drive has not
   changed.
5. Replace the Drive file in place, preserving the same Drive file ID/link.
6. Run `thumbnail-revision-scan`; confirm the row becomes `changed` with
   `latest_storage_path`.
7. Repeat with the folder fixture and confirm no baseline row is created.
