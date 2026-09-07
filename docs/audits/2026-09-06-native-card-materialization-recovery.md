# Native card materialization and v7 data recovery — combined evidence

This is a prerequisite within canonical G3, not a second execution plan.
The combined draft preserves SQL handoff `198b42bbdc0ce0a8cf661389da66213150d13658`
and recovery history through `96719f8d948a133a2e2420dc7498489b8339dcdf` on
PR1318 base `38f29bc6d3159ddda4b698819626f1efbd37c0b3`.

## Exact proof subjects

| Evidence | Subject and result | Limit |
|---|---|---|
| Actual gateway/browser/SQL lane | Author `198b42bb`: 56 passed; SQL SHA-256 `c0d8257b0d28a7ba4db3bfb50a03e795a82add394d077c9b426b1ad9f12e6a50` | Disposable migration-shaped fixture, no serving or HTTP admission proof |
| Earlier actual recovery | 22 passed on older SQL `041b5ca31aa389c47b19ec33fc2adade154c4ca387e72fb9d84ea312988944e1`, recovery `8bec87bba6fa9f32d91fadd8826135e948617217` | Historical; not a result on final SQL |
| Final actual recovery | `66e823da9cae9c0517d2053a6463f8a3b007d0b1`: 12 passed, exact37-table corpus, final SQL `c0d8257b` | Four original root-intake envelopes; not append/fill, an installed schema or cloud restore |
| CI | A dedicated v7 step uses the existing disposable PostgreSQL16 job and PostgreSQL17 snapshot clients | Added in source; hosted result must be read on the published head |

The final private run started at `2026-09-06T05:34:30.839Z` and its PASS
receipt was written at `2026-09-06T05:35:14.179Z`. Its sanitized receipt is
[committed separately](2026-09-06-native-card-materialization-recovery-evidence.json).
Private receipt SHA-256: `132e6a4556d75dc48fdc5f84e214fdfabb0e0b27c3a95376b2e20f3b01ec0f57`.
Named independent source/proof review closed on `66e823da`; review-receipt hash
`3afb354feaae8752e0fc61d1ac79cc31d242363336974e1b95f75525eb84eb93`.
No sensitive rows or raw recovery packages are published.

## What the final recovery run asserts

The real gateway and extracted browser create Calendar/Samples mixed-component
envelopes, a video-only Calendar envelope and a thumbnail-only Samples envelope.
The new SQL creates each accepted card; absent child slots become SQL NULL while
the retained original body is unchanged. Later human name, status and ordering
edits are captured before backup. A separate refused input retains its exact text.

An HMAC-authenticated data package from a dedicated backup role restores under a
separate scratch role that has no writer RPC grant. One UNION query compares
exact JSON-text row images for every table without JavaScript numeric coercion.
All37 images and user-trigger states match. Under hold, four service-role calls
with a non-UTC session replay the original retained bodies and return the full
current cards. All36 other tables remain identical; ingress conserves every old
row and adds exactly four verified replay records with matching scope, body and
SHA-256. No provider call is attempted in these instrumented phases.

UPDATE, DELETE and TRUNCATE of each new retained owner fail with the specific
retention error and preserve all images. A late restore COPY deliberately violates
the ingress raw-body NOT NULL constraint; the actual constraint error, all prior
target images and trigger states are checked. Six retention checks plus the
other six groups make the reported 12. This is not a count of all product actions.

Two pg_dump circular-FK warnings remain in the private logs; this is not a
warning-free export claim. Successful exact-image restore is the bounded result.

## Corrections and earlier failures preserved

The initial grant artifact failed parsing before installation because a CASE
comparison lacked parentheses. Independent checks also corrected an overbroad
write-role check, retained CHECK-validator grants and old-format source omission.
The portable run at `3ac9f0f4` failed configuration before creating a database;
`55ba3d1e` reached one check and then failed because the fixture used `graphics`
where the actual browser accepts `thumbnail`. Both were corrected explicitly.
The final source strengthens single-component assertions; no failed receipt is
relabeled green and no product contract was weakened to pass the harness.

## Release, client behavior and rollback

Clients see the currently deployed behavior because this draft is unmerged,
its SQL is unapplied, fresh admission defaults to hold, and no HTTP/browser/n8n
adapter is routed to it. Frozen anonymous writer authentication is unchanged.
The new CI step uses fictional data and has no live backend credentials.

The explicit v7 package adds two UUID-keyed owners to the unchanged35 of v6.
Prior format meanings and the scheduled legacy-v3 default remain unchanged.
Installation stays held for authenticated schema reconstruction, installed
schema/role equality, both real transport adapters, accepted-request conservation
through their failure paths, serving proofs, client continuity and delivered
watcher alerts. Product watchers remain inactive. This does not establish
Decision A, global zero-provider egress or complete disaster recovery.

Before installation, reverting the draft affects no saved work. After future
accepted use, hold new admission and retain both owners, v7 packages, original
receipts/provenance/journal and compatible current-row replay. Do not drop new
evidence or bypass old-format refusal. Loss of conservation, replay overwrite,
missing scope, unexplained image differences or absent alert proof aborts
progression to activation. The owner must separately authorize any live action.
