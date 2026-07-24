# F34 Linear archive asset rescue

## Status and authority

This is the operator contract for the source-only F34 rescue path. The migration,
Edge Function deploy, rescue configuration, discovery, copy, disposition, and
retrieval drill are **not authorized by this source session**. They require a
separate post-merge owner-approved window.

The rescue is fail closed:

- original Linear upload URLs remain only in the private sidecar;
- the browser receives a private Drive replacement only after complete
  certification;
- an ordinary service-role caller cannot choose or certify a destination;
- no run may claim a complete scan without an independently produced final
  Linear export occurrence inventory whose source artifact, organization,
  generator, and export identity are recorded, whose exact file bytes are
  owner-pinned, and whose canonical contents carry an owner-held HMAC; and
- an unrecoverable reference remains a gap until the owner supplies an
  exact-reference, exact-original-hash disposition manifest.

Do not put tokens, original URLs, archive bodies, private Drive IDs, rescue
capabilities, or private manifests in the repository, issue, PR, CI log, or
operator evidence.

## Separate live-window prerequisites

Before any live action, the owner must record the exact merged SHA and approve
all of the following:

1. Publish the exact compatible UI, then deploy only the exact merged
   `production-archive`, `production-write`, and `linear-outbound` functions
   required by the approved release plan. The UI's temporary pre-migration
   path is allowed only when PostgREST explicitly reports the new safe view as
   absent (`404` plus `PGRST205` or `42P01` naming that exact relation).
   Authorization, server, and network failures never reopen legacy body reads.
2. Apply `migrations/2026-07-23-f34-f53-production-attachments.sql` in its own
   transaction and run the disposable-DB proof against that exact source. This
   order is mandatory because the migration removes anonymous access to the
   four typed asset columns; an old cached UI that still requests those columns
   fails closed and must be refreshed.
3. Provision one private Google Drive folder that is not link-public and is
   dedicated to rescued Linear assets.
4. Generate a new high-entropy `F34_RESCUE_CAPABILITY` used only for this rescue.
   Store the capability privately; put only its lowercase SHA-256 digest in the
   database configuration.
5. Produce an exhaustive final Linear/export occurrence inventory
   independently of SyncView discovery. It contains only deterministic
   reference IDs plus hashed issue/location/URL identities and source kinds.
   Record the raw export artifact SHA-256 and source metadata, certify the
   canonical inventory with an owner-held HMAC, and pin the exact final
   inventory-file SHA-256 outside the file itself.
6. Snapshot the affected private tables and preserve rollback/readback evidence.

The database owner, not the service role, seeds the singleton configuration in
that gated window:

```sql
insert into public.linear_archive_asset_rescue_config (
  config_key,
  destination_provider,
  approved_folder_id,
  rescue_capability_sha256,
  active
) values (
  'active',
  'google_drive_private',
  '<approved-private-folder-id>',
  '<sha256-of-dedicated-rescue-capability>',
  true
)
on conflict (config_key) do update set
  destination_provider = excluded.destination_provider,
  approved_folder_id = excluded.approved_folder_id,
  rescue_capability_sha256 = excluded.rescue_capability_sha256,
  active = excluded.active,
  updated_at = now();
```

The approved folder ID must match `TRACK_B_BACKUP_DRIVE_FOLDER_ID`. The
plaintext capability must match `F34_RESCUE_CAPABILITY`. Never reuse the
service-role key, Linear key, Drive credential, or another operational secret
as the rescue capability.

## Private inventory contracts

The final Linear/export inventory must be generated from an independent raw
Linear export, not from SyncView discovery or this rescue planner. It must be an
absolute-path private JSON file:

```json
{
  "contract": "syncview_f34_final_linear_inventory_v3",
  "complete": true,
  "exported_at": "2026-07-23T00:00:00.000Z",
  "source": {
    "system": "linear",
    "export_id": "<owner-recorded-export-id>",
    "organization_sha256": "<lowercase-64-character-sha256>",
    "generator": "syncview-independent-linear-export-v1",
    "generated_at": "2026-07-23T00:00:00.000Z",
    "artifact_sha256": "<sha256-of-the-independent-raw-export-artifact>"
  },
  "occurrences": [
    {
      "ref_id": "f34:<40-lowercase-hex>",
      "linear_uuid_sha256": "<lowercase-64-character-sha256>",
      "source_kind": "issue_description",
      "location_key_sha256": "<lowercase-64-character-sha256>",
      "original_url_sha256": "<lowercase-64-character-sha256>"
    }
  ],
  "certification": {
    "key_id": "<owner-key-id>",
    "hmac_sha256": "<hmac-sha256-of-the-canonical-v3-certification-material>"
  }
}
```

`complete: true` alone is insufficient. The runner requires all v3 source
metadata, verifies the owner HMAC in constant time, and requires the SHA-256 of
the entire JSON file to equal `F34_FINAL_INVENTORY_SHA256` (or the explicit
`--final-inventory-sha256` value). Keep `F34_INVENTORY_HMAC_KEY` private and
identify it with `F34_INVENTORY_KEY_ID`; do not place either the key or the
final inventory digest inside the inventory. The planner independently compares
every discovered occurrence with this inventory. Duplicate URL hashes are
valid: two source locations remain two rows and each must reconcile
independently. An occurrence present in the independent export but undiscovered
by SyncView is a gap, just like an extra or identity/location/hash-mismatched
SyncView occurrence. Any such mismatch leaves `scan_complete:false` and
`zero_gaps:false`. Running without `--final-inventory` is useful for discovery
only and can never certify completeness.

An owner disposition file has this private contract:

```json
{
  "contract": "syncview_f34_owner_dispositions_v1",
  "complete": true,
  "dispositions": [
    {
      "ref_id": "<planner-ref-id>",
      "original_url_sha256": "<matching-lowercase-sha256>",
      "confirmed_by": "<owner-identity>",
      "confirmed_at": "2026-07-23T00:00:00.000Z",
      "decision": "unrecoverable_after_review",
      "review_note": "<private-review-evidence>"
    }
  ]
}
```

There is no automatic disposition. The script rejects unknown/duplicate
references, hash drift, missing evidence, malformed time, or an invalid plan.

## Plan first

The default mode is read-only and produces only hashed/public-safe evidence:

```powershell
node scripts/f34-linear-asset-rescue.js `
  --client test-client `
  --final-inventory C:\private\f34-final-inventory.json `
  --final-inventory-sha256 <owner-pinned-file-sha256>
```

For the final B5 gate, repeat without `--client` against the full independently
certified inventory. A client-scoped TEST plan cannot certify the global archive.

Before proceeding, require:

- `status` is `PLAN`;
- `scan_complete` is true;
- both inventory mismatch counts are zero; and
- the reported identity digest is recorded with the exact merged SHA.

The plan does not copy files or advance sidecar state.

## Apply rescue in the gated window

Provide credentials only through the approved private secret mechanism:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `LINEAR_API_KEY` or `LINEAR_API_TOKEN`
- `TRACK_B_BACKUP_DRIVE_FOLDER_ID`
- `TRACK_B_BACKUP_GOOGLE_CREDENTIALS_JSON`
- `F34_RESCUE_CAPABILITY`
- `F34_INVENTORY_HMAC_KEY`
- `F34_INVENTORY_KEY_ID`
- `F34_FINAL_INVENTORY_SHA256`
- `F34_CONFIRM_LINEAR_ASSET_RESCUE=RESCUE_PRIVATE_LINEAR_ASSETS`

Then run the same exact inventory with `--apply`:

```powershell
node scripts/f34-linear-asset-rescue.js `
  --client test-client `
  --final-inventory C:\private\f34-final-inventory.json `
  --final-inventory-sha256 <owner-pinned-file-sha256> `
  --apply
```

For each discovered reference, the runner downloads only an approved private
Linear upload, enforces the 50 MiB stream limit and redirect allowlist, writes
content-addressed bytes to the configured private Drive folder, independently
reads the file back, and submits a certification bound to reference ID,
original URL hash, folder ID, Drive file ID, content hash, byte length, and
verification time. The database derives the replacement URL and verifies the
capability HMAC before the terminal `rescued` transition.

Do not continue if any receipt is failed, the inventory changes, or the result
is `GAPS`.

## Explicit owner dispositions

Only after documented recovery attempts may the owner approve unrecoverable
references. Set:

`F34_CONFIRM_OWNER_DISPOSITION=DISPOSITION_UNRECOVERABLE_LINEAR_ASSETS`

Then apply the absolute-path private manifest:

```powershell
node scripts/f34-linear-asset-rescue.js `
  --client test-client `
  --final-inventory C:\private\f34-final-inventory.json `
  --final-inventory-sha256 <owner-pinned-file-sha256> `
  --apply-owner-dispositions C:\private\f34-owner-dispositions.json
```

The database transition is capability-gated, compare-and-set, source-bound, and
terminal. A disposition does not create a replacement link; the protected
reader shows the explicit unavailable state.

## Independent readback and exit gate

Set:

`F34_CONFIRM_LINEAR_ASSET_READBACK=VERIFY_PRIVATE_LINEAR_ASSETS`

Then run:

```powershell
node scripts/f34-linear-asset-rescue.js `
  --client test-client `
  --final-inventory C:\private\f34-final-inventory.json `
  --final-inventory-sha256 <owner-pinned-file-sha256> `
  --verify-rescued
```

The release owner may close the TEST drill only when every rescued object passes
independent private Drive byte/hash/length readback and reconciliation reports:

- `scan_complete:true`;
- both inventory mismatch counts equal zero;
- `unresolved:0`;
- `zero_gaps:true`; and
- `status:VERIFIED`.

`VERIFIED` is non-vacuous: it also requires an exact, duplicate-free receipt
set for every sidecar row currently marked `rescued`, at least one such row,
and an independent `verified` readback for every expected reference. A
zero-count or partial readback can report only `GAPS`.

Before B5, repeat the unscoped full-inventory run and complete the protected
Admin/SMM and same-team Creative archive retrieval drills across pagination,
internal/client audience, refresh, second device, expired session, inactive
client, and retry. Record the exact SHA, migration/function versions, inventory
digest, counts, readback receipts, and the externally owned
`archive_reader_live` and `zero_unreviewed_image_gaps` gates. Do not record
private URLs, bodies, folder/file IDs, credentials, or manifests.

The source migration protects the typed asset columns and also closes the
legacy-body browser bypass: anonymous/authenticated callers cannot select
`brief` or `linear_raw`; Production consumes only a bounded derived, URL-free
view; and exact Markdown descriptions are returned only by the active-roster,
role/team-scoped, no-store `production-write` read. F34/F137 remain in progress
until the live install, rescue, retrieval drills, cloud review, and owner merge
are complete.
