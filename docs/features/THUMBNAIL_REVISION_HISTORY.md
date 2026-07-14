# Thumbnail refresh and revision comparison

> Current status (verified 2026-07-14): v2 is deployed and globally enabled. Migration, four Edge
> Functions, Pages, flag, scheduler, negative access checks, same-link/repeated/A-to-B rotation,
> zero-hard-refresh repaint, desktop/mobile comparison, and zero-residue TEST cleanup were read back
> live. Public-safe operational evidence is recorded in `EXECUTION_LOG.md`.

## Outcome

This feature solves two related problems for Calendar and Samples:

- every viewer should receive a newly replaced thumbnail without a hard refresh, even when the
  Google Drive file ID and visible link are unchanged; and
- SyncView continuously preserves the current Drive image as the baseline for the next replacement,
  so authorized viewers can compare the previous and current images on the card.

`thumb_rev` is the cross-viewer refresh signal. `thumbnail_media_revisions` is the durable
comparison history. They work together, but they serve different purposes.

## Current design

### 1. The browser uses the final Google image host

For a single Drive file, `_calDriveImageUrl()` derives a URL on the final image host:

```text
https://lh3.googleusercontent.com/d/<file-id>=w<size>?_cb=<updated-at>&_r=<thumb-rev>
```

The previous `drive.google.com/thumbnail?...` form redirected to `lh3.googleusercontent.com` and
discarded SyncView's cache-busting query. Different browsers could therefore keep different bytes
under the same 24-hour CDN URL. The direct final-host URL keeps `_r` in the browser's real cache key.

`_cb` follows `updated_at`. `_r` follows the persisted `thumb_rev`. The browser keeps a short-lived
optimistic session token only so the editing tab can repaint immediately; a server-returned
`thumb_rev` takes precedence and stale local/cache merge state cannot mask it.

Realtime row updates and normal refreshes include `thumb_rev`. When it changes, Calendar, Samples,
client review, Kasper review, and SMM review image nodes advance to the new URL without requiring a
hard refresh. Unrelated saves may still reuse an already decoded image to avoid flicker.

### 2. The server owns `thumb_rev`

The v2 migration installs guarded `BEFORE` triggers on `calendar_posts` and `sample_reviews`.
For an enrolled client they mint a fresh token when:

- a row is inserted with a thumbnail/media URL;
- `thumbnail_url` or `asset_url` is assigned, including a same-value assignment that signals an
  in-place replacement; or
- `graphic_status` leaves `Tweaks Needed`.

The Calendar and Samples upsert Edge Functions also mint the token before returning their response,
so the saving browser does not wait for a later read. The database trigger is the authority for
other writers, including reconciliation paths that do not use the browser.

When the scanner confirms that Drive metadata changed, it stores the current snapshot and also
bumps the source row's `thumb_rev` and `updated_at`. That source-row update is what wakes open
realtime viewers and changes their final CDN URL.

The same triggers enroll each active single-file Drive thumbnail in a lightweight
`continuous_watch` row. A bounded repair RPC backfills any eligible card that arrived through an
older or hidden write path. Placeholders may be created while the runtime flag is off, but they do
not fetch Drive, scan, serve comparisons, or change source rows until the flag is enabled.

### 3. Revision capture and scan

The comparison lifecycle remains intentionally scoped to one active Drive image per card:

1. The write trigger or bounded repair pass creates one pending `continuous_watch` placeholder.
2. Its first enabled scan reads Drive metadata, archives the authenticated original bytes as the
   baseline in the private `syncview-thumbnail-revisions` bucket, and verifies that the metadata
   and card source did not change during capture.
3. The dedicated scheduler checks the least-recently-checked watches every ten minutes. Its caller
  makes up to 12 bounded batches of 25, enough to cover the current active set without one large
   request or per-card logs. Every batch shares one run-start cutoff, preventing a later page from
   wrapping around to rows already checked in the same cycle.
4. A same-file metadata change or an A-to-B Drive link change captures verified Current bytes. One
   locked database transaction rechecks the exact active source, closes the old watch as `changed`,
   bumps the source `thumb_rev`, and installs Current as the baseline of a fresh pending watch.
5. The cycle repeats after every replacement, so a second or later change does not freeze the first
   comparison pair as Current.

The older graphic-tweak baseline hook remains a fast path: when available, its already captured
snapshot initializes the continuous watcher, and leaving `Tweaks Needed` asks the writer to scan
that card immediately. The scheduled watcher is what covers replacements with no SyncView save at
all. Archived cards, inactive clients, missing sources, and non-Drive/folder links are not watched.

Snapshots use authenticated Drive `alt=media` original bytes rather than a thumbnail CDN response,
with metadata checked both before and after download. If Drive changes during capture, the scan
defers instead of saving mismatched evidence. Drive folders, Dropbox folders, Frame.io links,
ordinary direct URLs, and blank values do not produce a comparison pair. A direct link write can
still refresh the current image through `thumb_rev`; a Previous/Current comparison appears only
when SyncView has both confirmed snapshots.

### 4. Protected comparison UI

Calendar and Samples cards with a single thumbnail expose a **Compare** action. It does not fan out
history reads while cards render. Opening it lazily calls:

```text
POST /functions/v1/thumbnail-revision-read
```

with `{surface, client, source_id}`. Staff must supply a valid role key and one exact active roster
identity; a client link must supply the exact review token for the requested client. The function
then verifies that the requested card belongs to that surface/client before reading history.

The raw history table and private bucket are never browser-read. The function returns only status,
minimal timestamps, and five-minute signed image URLs for one card. Responses are `no-store` and
omit Drive IDs, Storage paths, requester attribution, and internal errors.

The dialog presents **Previous** and **Current** side by side on desktop and stacked on narrow
screens. It includes loading, pending, no-history, authorization, expired-image, and retry states;
traps focus while open; closes on Escape/backdrop/close; and returns focus to the trigger.

## Runtime controls

The server-readable `syncview_runtime_flags.thumbnail_revision_v2` value uses this schema:

```json
{"mode":"off|test|on","clients":["<normalized-client-slug>"]}
```

- `off`: comparison reads and scans fail closed; v2 server token minting is disabled.
- `test`: only normalized slugs in `clients` can read, scan, or receive v2 server tokens. Scanner
  calls must include an enrolled client scope.
- `on`: all clients can use the v2 reader/scanner/token path.

The migration seeded `off` without overwriting an existing value. The verified live readback is
`{"mode":"on","clients":[]}` after the private TEST client gate, off/test rollback rehearsal, and live
Pages/Edge proof. Changing this value remains an audited operational action.

Baseline capture in both upsert functions checks the same active-client-aware flag before any Drive
read, Storage upload, or revision-row write. Turning v2 `off` therefore prevents capture,
comparison delivery, scanning, and cross-viewer token minting, but does not delete existing private
snapshots or unwind an already captured baseline.

The scheduled caller has a separate operational switch:

```text
GitHub Actions variable THUMBNAIL_REVISION_SCAN_ENABLED=true|false
```

The verified live repository value is `true`; the first scheduled production run completed green
with 239 checked, 239 unchanged, and 0 failed. The workflow runs every ten minutes only when that
variable is exactly `true`. It sends the dedicated `X-Syncview-Scheduler-Signature` secret, uses at
most 12 sequential 25-row requests with one run-level fairness cutoff and an overall timeout, stops
early on a short page, and logs aggregate counts only. Any item failure makes the workflow fail
visibly without logging card, client, URL, path, or upstream error details.
The Edge Function returns `503` when its secret is absent, `401` for a missing/wrong signature, and
never accepts a staff key as scheduler authority.

## Data and code ownership

- `migrations/2026-07-09-thumbnail-media-revisions.sql`: original private bucket/history table.
- `migrations/2026-07-14-thumbnail-revision-v2.sql`: seed-off flag, revoke browser SELECT on raw
  history, install active-source watcher triggers/backfill, and provide the service-role-only locked
  rotation transaction.
- `supabase/functions/_shared/thumbnail-revisions.ts`: flag parsing, Drive metadata/snapshots,
  authenticated verified snapshot capture, active-source reread, and fair continuous scanning.
- `supabase/functions/calendar-upsert/index.ts`: Calendar baseline/resolution hooks and response token.
- `supabase/functions/sample-review-upsert/index.ts`: Samples baseline/resolution hooks and response token.
- `supabase/functions/thumbnail-revision-scan/index.ts`: fail-closed, signature-authenticated scanner.
- `supabase/functions/thumbnail-revision-read/index.ts`: principal/card-scoped signed-image reader.
- `.github/workflows/thumbnail-revision-scan.yml` and `scripts/thumbnail-revision-scan.js`: bounded
  ten-minute caller and aggregate-only logging.
- `index.html`: direct final-host thumbnail URLs, persisted-revision adoption, realtime image refresh,
  and accessible comparison dialog.

## Verified deployment evidence

- The migration and four functions were applied/deployed, then read back on the merged release.
- Missing/wrong scanner identity, missing/wrong reader identity, cross-client, missing-card,
  oversized-body, raw-table, and unsigned-private-object denials passed.
- Disposable TEST proof covered same-link writes, no-write Drive replacements, repeated rotation,
  A-to-B replacement, persisted monotonic revisions, and open-tab repaint with zero hard refreshes.
- The initial global scan checked 239 watches with 0 failures. Scheduled run `29370658087` completed
  green with 239 unchanged; after TEST cleanup, 238 active watches remained with 0 error rows.
- An owner-selected real Calendar card showed Previous/Current on desktop and mobile; Escape/focus
  return and fresh signed image URLs after reopen also passed.
- Disposable TEST cards, events, revision rows, and private objects were removed and zero residue was
  read back. No real-client mutation was used for rollout proof.

## Rollback

Immediate behavior kill (one database flag update):

```sql
update public.syncview_runtime_flags
set value = '{"mode":"off","clients":[]}'::jsonb,
    updated_at = now(),
    updated_by = '<operator>'
where key = 'thumbnail_revision_v2';
```

Read back the row and its `flag_flips` ledger entry. This disables v2 reads/scans/token minting
without deleting history. To stop scheduled traffic too, set repository variable
`THUMBNAIL_REVISION_SCAN_ENABLED=false` or disable the workflow and verify no newer run starts.
Frontend source reversion and Edge redeployment are secondary recovery steps; they are not the
one-step containment control.

Do not restore anonymous access to `thumbnail_media_revisions`, make the private bucket public, or
delete revision history as a rollback. Those actions weaken confidentiality and are not required to
return the website to its prior current-thumbnail behavior.

## Folder links

Folder comparison remains a separate future design. It needs a captured child set, added/removed/
changed semantics, and folder-level UI. The existing folder resolver's F79/F80 authorization/CAS
findings are independent of this single-file refresh/comparison v2 and are not closed here.
