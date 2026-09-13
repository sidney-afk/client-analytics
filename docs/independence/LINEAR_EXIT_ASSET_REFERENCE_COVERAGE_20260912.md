# Asset-reference coverage preparation

`scripts/linear-exit-asset-reference-coverage.js` connects the authenticated
complete-application package to the authenticated object inventory and restored
files. It has no network transport. The existing history scanner was selectively
reused from `0e2fd6b7`; its 30 checks pass against the current app helpers.

The adapter verifies each inventory object's restored size and SHA-256, then
correlates supported Calendar, Samples, comments, deliverable briefs, archive and
thumbnail references. Direct Storage URLs must match the package's project host;
thumbnail paths use the existing revision bucket. It reports rescued copies
separately: a recorded mapping plus copied bytes does not establish equality to
the original provider resource and cannot make complete coverage true.

Missing objects, unsupported extraction, unresolved references and URL-bearing
cells in other application tables keep coverage incomplete. Counts and opaque
handles leave the adapter; URLs, object paths, names and comment bodies do not.
The private restored directory must not have a concurrent hostile writer.

Run `node test/linear-exit-asset-reference-coverage.js` and
`node scripts/linear-history-coverage/test.js`. The adapter tests authenticate real
synthetic package bytes and read filesystem bytes; they include missing objects,
tampered packages, changed file bytes, unknown table references and output
redaction. This is offline evidence, not an executed database restore or hosted
asset retrieval. The existing database and encrypted-object restore lanes supply
those separate component proofs.

`reference_byte_coverage_complete` covers the supported supplied snapshot only.
It never authorizes retirement. Source provenance, an atomic SQL/Storage cutoff,
original/rescued content equality, current client access and independently
retrievable off-device custody remain separate requirements. A capture containing
an unresolved external asset remains visibly incomplete; do not waive it or infer
that a successful HTTP response proves preserved content.

## Observed original/rescued byte equality

`scripts/linear-exit-asset-equality.js` adds an optional, versioned authenticated
evidence protocol. Call `observe({inventoryBytes,hmacInput,references,
originalAdapter,rescuedAdapter})`, where each reference contains `original_url`,
`rescued_url`, `bucket` and `path`. Each adapter implements `stat(url)` returning
`{version,size}` and `open(url,expectedStat)` returning an asynchronous byte stream.
The observer hashes actual original and rescued bytes, requires identical size
and SHA-256 matching the authenticated inventory, and checks source metadata
before and after each read. A caller boolean is never evidence.

Pass the returned private bytes as `equalityEvidenceBytes` to the coverage
adapter. It authenticates the evidence and binds exact URL hashes, inventory hash
and object identity before reporting `mapped_original_bytes_verified`. An unmatched
mapping remains an unverified copy. Unknown table references and incomplete
history still prevent either broad equality or complete-coverage claims.

The optional `httpsAdapter({hosts,headers,timeoutMs})` uses only HEAD and GET,
requires an exact HTTPS host allowlist, size and ETag, refuses redirects and
encoded responses, and never retries. Headers stay private. Its default request
timeout is five minutes, capped at thirty; observations stream with a configurable
per-object size bound (default 64 GiB), without an aggregate video-size buffer.
Providers lacking this contract, including unsupported Drive access flows,
remain unresolved and need their own reviewed read adapter.

Evidence contains hashes rather than raw URLs or credentials; keep it private
and include it in existing encrypted custody when preparing an export. HMAC
authenticates the captured observations, not the honesty of an injected adapter
or the remote provider. The remote original may already have changed before the
first observation. ETag stability is not immutable historical-version proof,
and sequential reads do not establish an atomic SQL/Storage/provider snapshot.
No hosted read, client access, full external estate coverage or off-device custody
is proved by these synthetic tests.

Run `node test/linear-exit-asset-equality.js` and the coverage test above.
Tests include a streamed 34 MiB object, changed/truncated/corrupt bytes, wrong MAC,
inventory/reference substitution, forbidden host, redirect and encoding refusals,
plus mixed verified mappings and unclassified references. No external calls occur.
