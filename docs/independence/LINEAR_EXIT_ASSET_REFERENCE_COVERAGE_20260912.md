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
