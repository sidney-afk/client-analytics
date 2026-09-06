# Local release-source resolution in partial clones

**Independent isolated proof, 2026-09-06.** The actual resolver from preserved
`688947308c96e6f00b09a495a1f16f939fde479d` can initiate an implicit Git fetch
when a requested commit, tree or page blob is absent in a promisor repository.
Its `cat-file`/`ls-tree` calls are therefore not necessarily local reads. This
explains a real mechanism behind the interrupted integration suite; it does
not turn that cancelled run into a completed pass.

The correction already committed at
`2fb8ec8b3176dd959055e5ac5c3403af2fd8373c` sets `GIT_NO_LAZY_FETCH=1`,
`GIT_TERMINAL_PROMPT=0`, a 10-second command timeout and hidden Windows child
windows for the resolver's Git reads. Existing exact-commit, regular-file,
page-hash, replacement-object and current-checkout checks remain intact.

`node test/client-continuity-local-objects.js` executes both actual modules,
using `Module._compile` plus `createRequire` for the preserved baseline. It
creates a tiny local promisor repository and an empty local bare origin;
`GIT_ALLOW_PROTOCOL=file` prohibits external transports. Global/system Git
configuration and inherited Git variables are isolated. The test never
intentionally contacts a network address.

**25 checks pass.** Present objects resolve identically under both modules
without fetching. Missing commit/tree/blob cases all refuse with
`release_mismatch`; Git traces show the baseline making **5 implicit fetches**
and reaching only the empty local origin, while the corrected resolver makes
**0 fetches**. Trace hashes and exact module hashes are in the
[public-safe receipt](2026-09-06-continuity-local-object-proof.json); raw traces
and temporary paths remain private. The existing
`node test/client-continuity-view.js` also passes **57 checks** once against
the corrected source. The new registered test is automatically included by
`test/run-all.js`; no workflow mutation is needed.

The bounded source review found no additional resolver defect. This proves
local Git behavior on the exercised Git version and the existing offline
configuration checks. It is not proof of monitoring activation, served-page
identity, alert delivery, live viewing, or completion of the interrupted full
suite. The runtime correction is retained on rollback; this follow-up only
adds regression evidence and documentation.
