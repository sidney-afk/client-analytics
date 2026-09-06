# Native label catalog foundation — bounded source/proof snapshot

Baseline: `ab6366136c03239965c97b050ab5cf7c9763a228`, captured remote main on 2026-09-05. This audit adds no execution authority. [The single go-live checklist](../independence/GO_LIVE_CHECKLIST.md) owns G2 and all release gates; [the catalog contract](../ops/NATIVE_LABEL_CATALOG_FOUNDATION.md) defines this dormant owner's source/recovery boundary.

**Result:** a complete native catalog owner was absent from the reviewed source; per-deliverable native selected labels cannot fill that role. The candidate supplies one service-only immutable staging/validation owner. It does not make label writes native-independent. Activation and active reads always refuse. Current gateway/browser/anonymous writer blobs remain identical to the baseline. Native catalog installation, authenticated provider completeness, compatible retirement/receipt authority, backup coverage, restore and serving are held.

| Evidence | Result / precise limit |
|---|---|
| Real disposable PostgreSQL, `qa/native-label-catalog/sql-proof.js` | **48 PASS:** actual standalone migration/RPCs, strict page/count/identity/applicability checks including hidden archived/group/foreign entries; malformed manifests never stage; exact/concurrent immutable versions; read/selection projection; service-only RPC/direct-table denial; anon/authenticated denials; held activation. No business table stubs, provider source facts, installed schema or future write-atomicity proof. |
| Actual unchanged `production-write` HTTP handler, `qa/native-label-catalog/handler-proof.mjs` | **20 PASS:** provider-denied fresh reads/writes still fail; client/authority failures occur before provider use; partial catalogs do not become successful empty reads; exact accepted write replay preserves fingerprint/event/outbox before provider/CAS; changed intents and newly inapplicable IDs refuse; selected historical identity remains. Mutation persistence is an in-process named RPC model. |
| Handler transport seam | 33 fetch requests were synthetic/refused, zero unexpected fetch destinations and zero background tasks. The global fetch function never delegates to a real transport. This is not an independent browser/socket/receiver measurement or a deployed zero-egress proof. Two Node 22.12 runtime warnings are disclosed. |
| Existing affected suites | `production-write-gateway`, `batch-parent-labels-terminate`, `b1-workload-labels-preserved` PASS. Map and truth checks PASS. No full-suite, hosted CI or live test claim. |
| Source preservation | `index.html`, `production-write`, frozen `calendar-upsert` and `sample-review-upsert` are byte-identical to the baseline. No deployment workflow/closure pin, existing writer SQL, flags, outbox, browser or auth changes. |

Load-bearing source hashes (SHA-256; exact source bytes):

| File | SHA-256 |
|---|---|
| `migrations/2026-09-05-native-label-catalog-foundation.sql` | `ba19247491e2f809aaf211fb517838eeda9d1edb246cb1698943e70a14e1aa1a` |
| `qa/native-label-catalog/sql-proof.js` | `86bc2dcdbb14e739ae8ec4418ff106cc065fd9c47b67635e28d08eb564a29e2e` |
| `qa/native-label-catalog/handler-proof.mjs` | `93a97e0acf7cf01c7d5103d007f063a7463669d716b911148cdb0972e29bfb30` |
| `test/native-label-catalog-foundation.js` | `f9021c03dcfa059e20cd1b38cee171a8c5ff50be47a5a32a16f7b30ce96e19e3` |
| Unchanged `production-write/index.ts` | `6b0a85a51c3fce2bf6ba7327baca6a6bfe4d8771c23f4920e2db3b19917ac4c0` |

The original private local setup failures are preserved: one command-line password-file argument and one empty `PGSERVICEFILE` environment value prevented setup before the successful fresh database proof. They were corrected without weakening authentication or altering another cluster. They are not production failures. No real client names/slugs, tokens, catalog rows, raw provider responses or credentials were used/published.

The current history-v5 33-table corpus **does not cover** `production_label_catalog_versions`. The exact one-table/seven-function/two-trigger inventory, ACLs and trigger-aware retained-data restore obligation have been handed to the coordinator for the active schema/restore integration. Adding a catalog must not silently broaden that corpus's completeness claim; the installation gate remains closed until an authenticated schema artifact, explicit data corpus version and exact restored contents/triggers are proved. No migration or provider retirement action follows from this local audit.
