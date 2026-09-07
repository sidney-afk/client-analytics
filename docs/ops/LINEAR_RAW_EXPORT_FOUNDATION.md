# Independent Linear raw export foundation

Status: **source-only foundation; real collection and F34/G4 certification held**. This component extends [F34 asset rescue](F34_LINEAR_ASSET_RESCUE.md) under the single [go-live checklist](../independence/GO_LIVE_CHECKLIST.md). It does not change any app, Edge Function, SQL, workflow, provider state or asset.

## Interface and trust boundary

`scripts/linear-raw-export.js` exports `collect(options)`. The direct CLI always refuses with `injected_transport_required`; it reads no credential and makes no request. A future caller must supply a separately reviewed transport and privacy verifier. This session implements neither a live transport nor a Windows ACL verifier and authorizes no collection.

Options are an injected `transport`, exact private `expectedOrganizationId`, existing absolute `privateDirectory`, `privateDirectoryConfirmed:true`, a Windows `privateDirectoryVerifier`, and optional lower `limits`. The only transport input is a fixed GraphQL query, frozen variable object and abort signal. The transport returns `{status, body: Uint8Array}`. It must bound response streaming before returning those bytes, enforce its reviewed endpoint/credential scope, refuse redirects and honor abort. The foundation cannot prove that an arbitrary injected implementation is read-only or stopped an already in-flight request. Transport provenance is recorded as un-attested.

Output paths under a Git repository, filesystem root, non-directory, symlink or junction are refused before transport. POSIX requires the current UID and no group/other mode permissions. Windows has no default privacy verifier: absent, refused, malformed or differently rooted evidence fails before creating a run directory. The required synchronous verifier receives the canonical path and platform, and must return this private contract:

```text
contract: linear_raw_export_directory_acl_v1
directory: exactly the supplied canonical path
access: owner_and_os_admins_only
inherited_acl_checked: true
verifier_id: a bounded lowercase identifier
evidence_sha256: SHA-256 of separately retained ACL evidence
```

The manifest describes this as **injected-verifier attestation, not engine-verified ACL**; it records the verifier function hash and evidence digest privately. The tests use a synthetic verifier that recognizes only their newly created fixture directories. It is not a reusable real-data verifier. A production checker must establish inherited/effective access and a safe parent before any provider data is collected. An owner boolean alone is insufficient. Protection against a privileged local actor replacing the filesystem after verification is not claimed.

## Exact query scope

| Query | Selection and traversal |
| --- | --- |
| Organization | `id`, `name`, before and after traversal; both IDs must equal the supplied organization. |
| Issues | Credential-visible global `issues(first,after,includeArchived:true,orderBy:createdAt)`; `id`, `identifier`, `title`, `description`, `url`, `createdAt`, `updatedAt`, `archivedAt`, and team `id/key`. No client/team filter or SyncView-discovered issue list. |
| Comments | Global `comments` with the same pagination/archive/order arguments; `id`, `body`, `url`, `createdAt`, `updatedAt`, and `issue{id}`. |
| Attachments | Global `attachments` with those arguments; `id`, `url`, `title`, `subtitle`, and `issue{id}`. These are selected metadata fields, not attachment bytes or opaque metadata. |

The issue/archive and selected attachment fields reuse repository source patterns in `scripts/b1-linear-dry-run.js` and `supabase/functions/linear-outbound/index.ts`. Global comments/attachments follow the coordinator's separately captured schema/read evidence; this slice inspected only the saved read-script source (SHA-256 `ced691963b328e204a4a6ca37828813620bde8204e5ec981d8855bfde4c54d24`), including global collection variables, archive inclusion and `issue{id}`. No external API, private provider records or documentation request was read for this slice. The full selected fields/order contract still requires a later authorized schema/permission check; unsupported fields must fail, not be silently removed.

Requests scale with pages across three global collections, not two extra requests per issue. Comments/attachments with `issue:null` or an issue ID outside the observed issue collection are retained unchanged. The private manifest records their node/issue identities and bounded gap reasons; the public summary reports only the gap count. Missing requested relation fields or malformed non-null links refuse collection. These records are never filtered away or treated as proof of absent assets.

Archived records are requested for all three connections; deleted/inaccessible entities and the remote API's archive behavior are unproven. Other entity kinds, projects/documents, history, reactions, separate comment-attachment relations and attachment bytes are excluded. Inline URLs in selected descriptions/comment bodies remain in the raw bytes for a future occurrence adapter. No URL extraction, download, HMAC, certification or SyncView inventory input is present here.

## Artifacts, budgets and errors

Every run creates a fresh private directory. Each received, in-budget response is written with exclusive creation and synced, using its request ordinal and exact byte SHA-256. The file mode is set to POSIX0400; on Windows this is only a read-only attribute attempt, and confidentiality relies on the injected verifier's attestation of the directory ACL and inheritance, not a per-file ACL check by this engine. No decoded/reserialized response substitutes for the original bytes. Malformed JSON, invalid UTF-8 and BOM-prefixed JSON are retained when in budget and then refused. Over-budget or unavailable bodies are not claimed retained. Raw HTTP/GraphQL errors and all descriptions, comment bodies, identities and URLs stay only in these private response files.

The final content-addressed manifest binds raw response filenames/hashes/lengths, exact query documents and variables, observed terminal connections, counters, failures, limits and local start/end times. Its SHA-256 is returned in the sanitized summary. Exclusive writes prevent overwriting existing run files; hashes detect modification. This is neither an authenticated provider snapshot nor an OS-level immutable backup against its owner. Preserve the whole directory: the manifest alone is not the export.

Defaults cap pages at100 nodes, requests at1000, nodes at100000, each response at4MiB, total retained response bytes at64MiB, each request at30 seconds and total traversal at10 minutes. Callers can only lower these limits. A limit, duplicate node ID, repeated/missing cursor, malformed page/link, organization mismatch, HTTP/GraphQL error or timeout stops traversal without automatic retry. A timed-out injected transport receives abort; its physical cancellation is a separate adapter responsibility. Earlier pages are retained and completed connection entries never imply that a failed later connection finished.

`COLLECTED_INCOMPLETE` means all selected connections observed a terminal cursor and both organization checks passed, including the legitimate zero-visible-issue case. `FAILED_INCOMPLETE` preserves a sanitized failure and the available pages. `REFUSED` means preflight could not establish the collection prerequisites. `FAILED_UNRECORDED` means final artifact persistence failed; it cannot claim a usable manifest, though partial files may remain. No automatic cleanup or in-place resume is provided.

**Every artifact and result has `complete:false`; every manifest has `inventory_certified:false`.** Pagination is not a transactional snapshot: an unseen deletion or moving record can produce an omission without duplicate detection. Matching organization observations do not prove stable permissions or no intervening workspace change. Counts are observed validated nodes, not the independently expected workspace population. Content hashes are integrity values, not identity/completeness attestation. Public output contains only bounded codes, counts and the artifact digest, never output paths or provider errors.

## Proof and remaining work

`node test/linear-raw-export.js` currently passes **37 synthetic groups** covering all four fixed reads, three independent global cursors, duplicates, missing/malformed fields, partial comment-page failure, failed HTTP/GraphQL, organization changes and retained issue-scope gaps, byte/node/request/time budgets, exact bytes including a value above2^53, error privacy, unsafe/shared paths, verifier evidence, repeat-run nonoverwrite and inert CLI. Actual Windows ACLs, real GraphQL responses and live scope are unproven. [Exact source receipt](../audits/2026-09-06-linear-raw-export-foundation.json).

The next source-to-occurrence adapter must independently validate the complete raw package and chosen collection coverage, retain source-kind/location identity, handle every required source family, and refuse unavailable pages. Only a separately reviewed final export/occurrence contract plus the F34 owner-held certification can satisfy the existing inventory gate. This foundation manifest is deliberately incompatible with `syncview_f34_final_linear_inventory_v3`; no HMAC is minted and no exhaustive population is certified.

Rollback is source withdrawal before any live collection. If an authorized future collection has occurred, stop its adapter and retain all successful/failed raw pages and manifests; removing the code is not permission to delete private evidence. No client-facing rollback or service change is needed. G4, F34 asset rescue and switching off Linear remain held.
