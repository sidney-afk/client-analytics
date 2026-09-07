# Current native comment file downloads

SOURCE PREPARATION ONLY. This extends the [existing brief custody owner](NATIVE_BRIEF_MEDIA.md)
for literal `uploads.linear.app` references in current, nondeleted native comment
bodies. The current private capture contains 49 comments, 79 occurrences and 75
distinct URLs. All 75 originals are privately preserved, including five current
videos between 58 and 94 MB and two OpenType fonts. No comment is covered by the
separate one-file historical brief deferral. No migration, upload, runtime flag,
global Storage configuration, serving or provider retirement occurs here.

## Reader and visible behavior

`production-comments` retains its real staff role-key/active compatible roster
identity, target authorization and durable allow audit before mapping or signing.
Only staff receive the new projection. Client-token reads gain no file custody
access. All roles keep their existing team restrictions. After signing, current
comment, deliverable ownership, active client and actual staff identity are read
again; deletion, audience/scope/body changes during that read hold the mapping.
The reader does not repair comment bodies, write comment receipts or call Linear.

The separate `media` response binds comment ID, deliverable, client, team, exact
source audience, current body/digest/version and timestamp. `_prodLinkify` remains
images-off for comments: every preserved file, including PNG/JPEG and OTF, is a
download link. Canonical body, edit draft and existing edit/resolve CAS are unchanged.
Missing or conflicting custody produces escaped retained text and **Refresh
downloads**. Once a required response is observed, missing/off responses do not
silently restore provider links in that comment's cached state.

Signed links last five minutes; the browser projection expires 15 seconds earlier.
An expired click is intercepted and refreshes through the existing authenticated
reader with exact `media_comment_id`, including comments on older loaded pages.
Refresh always remains available; failures stay visible and can be retried.
The response cannot be adopted after identity loss, cache replacement or a newer
thread load. Already issued bearer URLs cannot be atomically revoked by this
reader; their remaining five-minute lifetime is an explicit limit.

Ordinary text edits/reordering/additional occurrences of an unchanged URL reuse
only verified copies within the **same comment/deliverable/client/team/source
audience**, with unanimous content hash, size and MIME. Capture body/version and
offset stay immutable provenance; current offsets are projected anew. A new URL,
changed audience, another comment's copy, conflicting historical bytes, excessive
candidate count, missing scope or deleted owner stays held. No cross-comment
deduplication or audience inference authorizes reuse.

## Storage and local preparation

Install the additive `2026-09-07-native-comment-media.sql` only after the existing
brief migration. It revises `native_brief_media_occurrences` to explicitly admit
`source_kind=native_comment` with comment entity ID, original source audience and
version. The staff-only read audience, append-only service ACLs, original ledger,
object naming and private `syncview-native-brief-media` bucket remain the owner.
The extension raises that bucket's proposed file ceiling to **100 MiB**. Only
existing comment MP4/QuickTime rows may exceed 50 MiB. Brief files remain at 50 MiB;
new-image upload limits remain 4 MiB. Both reader flags remain off on installation.

**Additional held installation prerequisite:** the actual global Storage ceiling
is 50 MiB and needs separately approved adjustment to 100 MiB plus readback before
the five current videos can be uploaded. This source does not perform that change.
All comment objects use `application/octet-stream`; signing always requests an
attachment filename. Existing bucket MIME restrictions do not enable active
SVG/PDF/video/font serving. Independent Storage GET, exact bytes, private access,
attachment headers and expiry behavior remain necessary serving evidence.

`native-comment-media-validate.py` imports the frozen brief validator for supported
files at or below 50 MiB. Its additional large-video path uses the same PyAV
container/packet parsing, first-frame check, empty protocol whitelist and refusal
of secondary I/O. FontTools parses OTTO framing, required tables and glyph order;
fonts are never installed or rendered. These structural checks do not certify
every video frame or provide an OS sandbox. Existing network/process denial hooks
are retained. OTF needs FontTools (focused environment 4.60.1); other dependencies
are the existing brief validator's. Keep any private dependency location outside Git.

The local `native-comment-media-package.mjs` reuses private-path protection,
occurrence hashing, bounded brief validation and the shared signer rather than a
new storage destination. It has no network/upload/SQL/credential discovery:

```text
node scripts/native-comment-media-package.mjs stage <private-ingress.json> <new-private-stage>
node scripts/native-comment-media-package.mjs verify <private-package>
node scripts/native-comment-media-package.mjs admission <stage> <private-readback.json> <new-private-proposal>
```

Ingress `native_comment_media_ingress_v1` supplies exact native `documents[].row`,
`source_receipt_path` and one `files[]` entry per occurrence (`offset`, private
`path`, exact logical `mime_type`). The separately supplied
`native_comment_media_source_v1` receipt binds comment/deliverable/client/team,
`source_audience`, `source_version`, `source_updated_at`, `body_sha256`, and every
offset/original URL hash/content hash. Retain its original acquisition evidence
privately; constructing a matching receipt alone is not acquisition proof.

Staging emits pending rows only and pins both validator files and both migrations.
It validates and writes one object's original bytes at a time, keeps only digest
metadata between objects, and atomically renames a private preparation directory
after the final manifest is written. A failed/interrupted preparation directory
is not a completed package. The 100 MiB individual-video ceiling remains enforced.
Ordinary batches stay at or below 128 MiB of object bytes; the one complete
seven-file comment intentionally uses a **455577580-byte disk package** so its
document binding is not fragmented. This is not a 128 MiB process-memory promise:
Python/native decoder buffers and garbage collection add independent overhead.
Admission requires `native_comment_media_storage_readback_v1`: exact private
bucket/global limits, `public:false`, independent `objects[]` with original byte
readback path, `storage_mime_type:application/octet-stream`,
`content_disposition:attachment`, current `documents[]`, observation time and a
bound recovery digest. It produces a new proposal, never installed rows. An
ambiguous upload or insertion must be reconciled from retained identity and
readback; do not retry by inventing another occurrence.

## Recovery and remaining release proof

The existing combined recovery lane's ledger must contain all brief and comment
rows, including pending/held history, plus each object and original source/readback
receipt. `native_comment_media_recovery_v1` is an **additional required binding**:
it must pin this additive schema after the original brief schema, the widened
private bucket, complete mixed ledger, owning comments and deliverables, both
validators and every referenced object. Do not feed mixed rows to the older
brief-only recovery verifier or call the previous schema-pinned v9 proof current
after this migration. Combined schema/ACL/row/object reconstruction must be rerun
and independently reviewed before enabling comment media.

Required mode additionally needs `contract:native_comment_media_v1`,
`recovery_contract:native_comment_media_recovery_v1`, and exact SHA-256 values in
`coverage_receipt_sha256` and `recovery_receipt_sha256`. These operator inputs
alone do not establish coverage. Current runtime omissions remain held even when
configured. Serving bindings, all 79 occurrence admissions, private destination
readback and actual staff download/expiry/refresh checks remain unproven until
the separately approved deployment. No optional archive exporter substitutes for
these required current files.

Final focused checks passed **36 groups**: complete actual reader over a fictional
SDK, exact-object signing refusal, plain-comment no-extra-read control, within-comment
edit reuse, scoped refresh success/failure/concurrent-edit and identity-loss cases,
actual Chromium refresh/expired-click controls with zero external requests, and
private synthetic staging/readback proposals. The shared brief suite also passed
**32 groups** after signer extraction and exact object-path checking.
The actual comment-reader fixture loaders resolve both media modules from their
real source paths. The receipt-fingerprint fixture additionally resolves the
candidate's brief helper while preserving its older baseline; **238 receipt
checks** and **26 comment-reader checks** passed without substitute media modules.

All **75** already preserved current files passed the final validators, totaling
**547252015 bytes**, including all five larger videos and both fonts. This was an
offline check of local originals; no file was downloaded again. Private corpus
receipt SHA-256: `a10cccd886084770f5c420dd5d89c7bd26b6358fc7657f834f800b2aa2fc69d4`.
It pins both validator files and each checked content hash, size and logical MIME.
It does not prove destination admission or live delivery.

The separately leased disposable PostgreSQL check also passed: **12 constraint
refusals, 4 ACL refusals and 3 exactly reconstructed mixed brief/comment rows**,
with private bucket and both reader flags off. Private SQL receipt SHA-256:
`7363c71886e405f6a8e724501aa060959f57908308d2de47b6361b277162a5a7`.
This proves the additive migration on an owned empty local target, not the full
combined recovery or a production installation.

Actual current-file ingress is privately staged in **two complete packages**:
48 comments / 72 occurrences / 92798103 object bytes, and the complete seven-file
comment / 455577580 object bytes. Combined coverage is **49 comments, 79
occurrences, 75 distinct URLs and 548375683 staged object bytes**. Repeated
occurrences intentionally retain their separate custody identities. Every staged
row remains pending; no Storage object or ledger row has been installed.

The combined private readback checked every packaged file hash, each original
body/offset/version/client/team/audience binding, both schema/validator pins,
and the retained acquisition receipts. Generated source bindings are explicitly
labelled as derived from the original 17:40 collection and per-URL/streaming
receipts; they are not fabricated provider responses. Original collection and
read receipts remain alongside each package under their content hashes.
Combined staging coverage receipt SHA-256:
`cf2ab05fdd5c7ef7376f1d2b5f46bb3bca5267e1cd4a1ccaea19f4775c4f475e`.
This is local package readback and complete captured-scope accounting, not
independent Storage delivery, live current-scope admission or a recovery restore.

Focused evidence is local actual-handler/model plus extracted Chromium controls;
SQL runs only with an explicitly owned disposable loopback binding. Hosted CI,
live SQL and Storage delivery are not claimed by local tests. Withdrawal before
activation changes nothing live. After provider retirement, recover forward with
private custody retained; switching off restores provider dependence.
