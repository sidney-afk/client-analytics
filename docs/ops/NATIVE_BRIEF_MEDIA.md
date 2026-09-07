# Native brief media: dormant private reader and custody extension

**SOURCE PREPARATION ONLY.** Based on PR1332 `cfb042aca6394edc0f6f9c4ebab928b1e223f806`.
No production media was fetched, copied or uploaded; no migration, bucket, flag,
credential or serving change was applied. This slice covers literal
`uploads.linear.app` URL occurrences in current native `deliverables.brief` only.
Other hosts, attachments, client card fields, project/batch-only descriptions,
and comment-body links remain separate required-scope gaps. It is not a whole
Linear export, a complete required-media census, or retirement approval.

## Reader and ownership

`handleDescriptionRead` in `production-write/index.ts` keeps its existing staff
key/active-roster, declared-client, active-client and `staffAssetReadAllowed`
checks **before** reading mappings or signing. Current editor/designer/SMM/admin
read policy is retained; client review tokens cannot use this reader.
`projectBriefMedia` in `_shared/native-brief-media.mjs` returns a separate `media`
projection. The canonical response `row.brief` and its write/CAS contract remain
unchanged. There are no provider requests or writes in the projection.

One new private bucket, `syncview-native-brief-media`, and one service-only,
append-only table, `native_brief_media_occurrences`, own this slice. The dormant
migration refuses an incompatible preexisting bucket and seeds `native_brief_media`
with `mode:off`. It does not change the public pasted-image bucket, private
thumbnail bucket, frozen writers, F34 archive certification or Drive view URLs.

Ledger identity is `(source_kind, source_entity_id, deliverable_id, client_slug,
team, source_sha256, source_offset)`. The captured `source_updated_at` remains
provenance, not content identity: status/assignee changes must not require recopy.
`source_kind` currently
admits **only `native_brief`** and source entity is the deliverable. A separately
reviewed comment-body reader can reuse the custody table/bucket after an explicit
contract/migration revision; this code does not admit comment mappings or change
the existing link-only comment renderer. Offsets are UTF-16 code units into the
exact original string, not normalized text or a URL-wide replacement. Repeated
URLs remain separate occurrences. The ledger also binds original URL hash,
content hash, byte length, MIME, source receipt, readback hash and staff audience.
There is no deletion cascade when a deliverable disappears.

The ledger's original capture identity is retained permanently. On each current
read, every original URL is hashed at its **current** source offset. Prior copies
may be reused only within the same native source entity/client/team and only when
all verified copies of that exact URL agree on content hash, byte length and MIME.
An exact captured occurrence is preferred where available; otherwise a stable
choice among byte-identical copies supplies the preview. This permits ordinary
text edits, reordering and additional occurrences of a known image without any
ledger rewrite or operator remapping. The response always carries the current
brief digest/revision and current occurrence offsets. Conflicting historical
bytes are held, never resolved by choosing the newest capture. More than 1000
candidate rows in the scope also remain held; this is a bounded read, not a
silently truncated completeness result. A new URL needs separately verified
custody. A removed source row or explicit deletion marker cannot reuse copies.

Missing copies, duplicate IDs, ambiguous byte identity, mismatched scope,
unsupported MIME and
failed signing return `complete:false` with no partial projected description.
After signing, the helper rereads the current deliverable and refuses a changed
brief/revision/team. URLs are signed for five minutes; the projection expires
earlier. This is read-time admission, not atomic revocation of already issued
URLs. Deleting/revoking objects after a successful read remains a serving fault.

## Browser behavior

`_prodBriefMediaReadHTML` uses only a projection bound to the exact loaded text
and revision. Before policy is known, or on required-mode refusal/expiry, it shows
all original Markdown as escaped text with an explicit **Retry images** control.
It does not silently hide images or make provider requests while reporting a
complete read. An explicit off-mode response retains prior rendering; off mode
never certifies independence. Once required mode has been observed, a downgraded
or absent response cannot silently restore provider rendering in that state.

The existing scoped-read generation/actor guards protect response adoption.
After a successful description save containing provider references, the browser
immediately obtains a fresh scoped projection; it does not keep the prior signed
markup or wait for an operator to remap unchanged image URLs.
The active read view refreshes before signed URLs expire; a failed image load
shows the same retained-source state. A hidden/editing panel does not start a
background refresh loop. Rich editing is preserved: private image nodes store
the exact canonical source URL/alt/form in dedicated data attributes and render
only the mapped preview URL in `src`. Serialization returns the canonical URL.
Expired/unavailable previews become reversible visible placeholders, including
off-DOM roundtrip probes; they never silently switch the editor to Markdown.
Drafts may move images; previews reuse only an unambiguous original URL/content
identity. Distinct copied content under the same original URL stays a placeholder
in the editor rather than guessing which revision a moved occurrence means.
Ordinary descriptions and public pasted images keep their existing behavior. Draft,
CAS refusal, source reload and client-change behavior remain the original owner.
Old already-loaded bundles and other description entry paths need separate
serving/cutover proof; this source does not assert they have stopped egress.

## Private ingress, readback and recovery tooling

`scripts/native-brief-media-package.mjs` has **no network client, upload, SQL
executor or credential discovery**. Its default command verifies local files.
All inputs/output directories resolve outside Git, and outputs must be new.
Only synthetic fixtures were exercised here. Keep source capture, source receipt,
object readback and staged output separate in private custody.

Commands (absolute private paths; no default input discovery):

```text
node scripts/native-brief-media-package.mjs stage <ingress.json> <new-stage>
node scripts/native-brief-media-package.mjs verify <package>
node scripts/native-brief-media-package.mjs admission <stage> <storage-readback.json> <new-proposal>
node scripts/native-brief-media-package.mjs capture <recovery-extension.json> <new-capture>
node scripts/native-brief-media-package.mjs rehearse <package> <new-reconstruction>
```

Ingress contract `native_brief_media_ingress_v1` contains `documents[]` with the
exact native `row`, `source_receipt_path`, and one `files[]` entry per occurrence
(`offset`, absolute local `path`, `mime_type`). A separately acquired
`native_brief_media_source_v1` receipt binds `id`, `client_slug`, `team`,
`source_updated_at`, `brief_sha256` and exact `occurrences[]` with `offset`,
`original_url_sha256`, `content_sha256`. The tool preserves the hashed receipt
and checks local content against it. It does not independently prove how those
bytes were acquired. Authorized acquisition must retain the original URL and
exact source/retrieval receipt privately, without leaking auth or making URLs
public. No broad archive census is substituted for this current-product scope.

The shared existing image validator checks real format structure, MIME agreement,
dimensions and PNG pixel stream. Its current limit is **4 MiB and 8000 pixels**;
larger/unsupported images are held, never resized or silently dropped. The bucket
has a 50 MiB hard ceiling, which does not widen that validated admission limit.
JPEG/GIF/WebP structural checking is not independent decoder/render proof.

Staging emits only `pending` proposals; these are **not installed ledger rows**.
After separately authorized private upload, capture an independent object GET
readback and fresh native scope as `native_brief_media_storage_readback_v1`:
`bucket`, `public:false`, `observed_at`, `recovery_base_sha256`, current
`documents[]`, and `objects[]` (`storage_path`, absolute local readback `path`).
`admission` checks every object's bytes again and each current original occurrence
before producing `ADMISSION_PROPOSAL` rows with matched readback hashes. It does
not insert them or turn an operator-supplied receipt into production proof.
Only after exact upload/readback/current-scope evidence is reviewed may a separate
approved service-role operation insert those verified rows. Never install the
staging pending rows under the same proposal IDs, overwrite an existing verified
occurrence, or treat an ambiguous upload/insert response as permission to retry.

Recovery is explicitly **`native_brief_media_recovery_v1`**, an extension bound
to an authenticated base recovery manifest digest. It does not redefine v8,
selected37 or their data corpus. It must preserve the complete ledger (including
held/pending history), pinned schema/ACL/index/RLS, private bucket contract, every
referenced object byte, source receipts, and the owning native row revisions.
The extension input supplies `complete:true`, `recovery_base_sha256`, `row_count`,
`ledger_path`, `ledger_sha256`, and `files[]` (`name`, private `path`, `sha256`).
Object names are `objects/<content-sha>/<occurrence-id>` and receipt names are
`receipts/<sha>.json`. The capture command packages an already exported ledger;
it does not acquire or authenticate a database snapshot. The operator must bind
the complete ledger export to the same approved recovery snapshot/window and
retain its original export/count digest. No table is silently added to v8.

Verification checks declared file hashes, exact schema pin, ledger/object/receipt
coverage, MIME and content. Rehearsal reconstructs into a fresh private directory
and rereads every declared byte. This is **object reconstruction**, not a Storage
upload, Deno run or authenticated full restore. An approved full recovery still
needs an empty target, this exact schema with off admission, all ledger rows and
private object uploads, then fresh object GET/hash and authenticated staff/client
readback. Preserve unknown/orphan uploads for reconciliation; do not delete or
declare them restored from a successful local file copy.

## Release order, proof and withdrawal

1. Independently approve current required native-brief scope and capture original
   revision/occurrence receipts while Linear access remains available. Resolve
   every unsupported or unavailable occurrence; all other required fields stay
   separately visible. Optional historical export remains paused.
2. Prove the separately versioned recovery extension, private bucket and serving
   dependencies; install only through the existing approved release process.
   The new migration and projection must be present before enabling required mode.
3. Acquire/copy only approved source bytes, verify private destination/readback
   and unchanged source scope, then insert verified proposals under separate
   authorization. Preserve exact receipts and inspect uncertain results.
4. A required flag needs `contract:native_brief_media_v1`,
   `recovery_contract:native_brief_media_recovery_v1`, and SHA-256 values in
   `recovery_receipt_sha256` and `coverage_receipt_sha256`. Those declared pins
   are operator admission inputs, not self-verifying fleet certificates. Runtime
   unresolved rows remain non-complete even with the flag enabled. No setup or
   activation command is run by this preparation.
5. Bind actual served HTML/function/shared-module hashes and verify approved
   staff roles, client refusal, repeated inline images, edit/save/reload,
   expiration, source change, missing copy and failed image. Observe zero provider
   requests on the required path and independent object bytes before retiring
   access. A syntactically signed URL is not itself image-retrieval proof.

Withdrawal before activation changes no live behavior. After activation, retain
private copies and ledger; a missing/malformed flag produces a visible hold.
Setting off restores provider dependence and therefore cannot be the rollback
after provider access is lost. Recover forward or retain a held read view; never
publicize the bucket, erase receipts, or rewrite original descriptions.

Focused evidence after the editing correction: 29 full-handler/model, renderer
and local byte groups, plus an optional actual-browser Save/fresh-read group
(`node test/native-brief-media.js --browser-save`, **30 total**). The browser uses
the actual save, rich serializer, scoped refresh/adoption and full description
read handler; its write transport is explicitly modeled, not a real SQL write.
It edits text, reorders images, clicks Save, waits for the automatic read, then
checks another browser context. Original URLs and ledger rows stay unchanged;
the saved text remains edited and both copied images decode. The frozen `8f8`
helper reproduces the prior text-edit hold as a retained baseline negative.
A separate finite
Chromium fragment decodes the synthetic copied PNG and proves rich edit,
normalize, original-URL serialization and reversible expired previews with zero
provider attempts. The local SQL lane passed private/off defaults, seven bad-row
refusals, four ACL refusals, occurrence conflict and exact empty-target row/schema
reconstruction; object bytes are checked separately. No full suite, authenticated
full restore, whole-page layout/role journey, provider transfer or live canary is
implied. The SQL lane was rerun after removing the unrelated row timestamp from
the verified occurrence's unique identity.
