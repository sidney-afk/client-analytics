# Native card materialization SQL — finite source handoff

Base: `38f29bc6d3159ddda4b698819626f1efbd37c0b3` (preserved integration PR1318). Original SQL handoff: `198b42bbdc0ce0a8cf661389da66213150d13658`. Scope: additive dormant SQL, synthetic proof and owning documentation. Existing browser, gateway, frozen card writers, binder, reconciler and authentication files are unchanged. The subsequent combined draft adds versioned data recovery and one disposable CI proof step.

The [owning contract](../ops/NATIVE_CARD_MATERIALIZATION_BOUNDARY.md) describes two new private retained owners and one service-only `production_card_materialize(text,text,text)` RPC. Fresh admission starts held. Successful calls atomically establish a full card, journal/provenance and its accepted creation receipt; matching retries return the full current row without restoring initial values. Refusals retain the supplied text outside the inner mutation rollback block. Failure of that retention aborts the whole call and cannot claim conservation.

SQL SHA-256: `c0d8257b0d28a7ba4db3bfb50a03e795a82add394d077c9b426b1ad9f12e6a50`.

## Focused evidence

The exact SQL and final proof sources completed **56 checks, 0 failures** using the actual gateway/extracted browser and an owned PostgreSQL 16 SCRAM database. [Public-safe evidence](2026-09-06-native-card-materialization-sql-evidence.json) records each finite assertion and exact source hashes. Receipt SHA-256: `aec4ecf4316740751072675187264e0e7705577fb20871d117dd972b6a1a3133`; private lane log SHA-256: `41ff09290abd2a594b13bef2c133fb2339d42a32b35ec8874629aa0f46b7b1b7`. The earlier 51-pass receipt remains a separate checkpoint. The final run adds direct Node SHA-256 comparisons for preserved inputs, authenticated read/RPC denials and service-role direct INSERT denials.

| Boundary | Actual assertion |
|---|---|
| Existing accepted request | Real production-write handler creates native manifests/parent/children; all six Calendar/Samples × video/thumbnail/both envelopes come from the real browser materializer |
| Identity | Exact original raw projection except `order_index`; changed body/client/child/extra properties refuse without business mutation |
| Partial acceptance | Real fault before child2 leaves one committed child; declared browser-test seam over immutable rows produces the attempted envelope; incomplete two-item root refuses while complete one-item root succeeds |
| Concurrency | Two real gateway callers; two materializers observed waiting in `pg_stat_activity`; exactly one card/receipt creation and one replay |
| Binder and child races | Actual binder and materializer wait on the same card row; original native-unmapped refusal retained plus verified provider-identity positive canary; child mutation commits while materializer is blocked and is rechecked after its lock wait |
| Later human work | Full current name/caption/status/order survive original retry; current archive, delete/reused ID, missing provenance and changed linkage hold; deliberate reopen returns current row |
| Atomicity | Actual journal, provenance and acceptance-receipt constraint failures roll back all earlier card/ledger changes; failed ingress storage rolls back success and cannot acknowledge retention; original outbox contents remain unchanged |
| Admission and lifecycle | Default hold, current F27 authority, later child cancellation and requests older than coverage refuse; accepted replay survives hold/new epoch/non-UTC session |
| Scope | Actual service-only calls; raw/malformed unknown requests retained; ordinary UI/blank markers refused by this adapter; provider/drainer transport absent from the synthetic lane |

Earlier failing receipts are preserved separately: missing extension-schema digest function (replaced with built-in SHA-256), absent-child empty-string FK storage (converted to SQL NULL while raw projection remains exact), and missing-child refusal classification before provisional insertion (early refusal plus authoritative post-lock validation). None is converted into historical green evidence. A private diagnostic SQL copy used only to expose the FK error is absent from final source and is not a proof subject.

The earlier 22-group real v7 rehearsal used SQL `041b5ca31aa389c47b19ec33fc2adade154c4ca387e72fb9d84ea312988944e1`; it cannot be relabeled as this final SQL. The [separate final recovery record](2026-09-06-native-card-materialization-recovery.md) now records 12 actual groups at integrated `66e823da9cae9c0517d2053a6463f8a3b007d0b1`, using final SQL `c0d8257b`, single-component cases and same-session non-UTC replay. It does not replace the original 56-check SQL lane or prove an installed schema.

## Held gates

No HTTP admission adapter, client audience widening, original-byte capture guarantee, n8n fallback repair, deployed schema, serving fingerprint, live journey, scheduled completion, alert delivery, provider cutoff or complete data-loss recovery is proved. An unknown/sparse creation envelope is not the original intake/media request. Append/fill and unmarked edits remain outside this root-manifest adapter.

The two owners must enter an explicitly versioned schema **and data** recovery package before installation. Older 35-table promises remain unchanged. Keep the default hold until coverage and all transports are independently proven. Rollback retains evidence and compatible current-row replay; dropping tables or restoring the old full-row writer over accepted cards is unsafe. No merge, deployment or live action occurred.
