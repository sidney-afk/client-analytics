# Native card materialization boundary — dormant G3 prerequisite

This implements one SQL boundary under the existing [G0–G10 plan](../independence/GO_LIVE_CHECKLIST.md), from exact integration base `38f29bc6d3159ddda4b698819626f1efbd37c0b3`. It consumes the [accepted compatibility contract](../audits/2026-09-06-native-card-compatibility.md). Automatic card creation remains held. No Edge Function, browser, n8n, writer authentication or live setting changes in this slice. The combined draft adds one disposable PostgreSQL recovery step to CI; it does not install or schedule product behavior.

## Authority and storage contract

`production_card_materialize(p_surface text, p_source text, p_raw_body text)` is service-only. The native source marker selects this compatibility path; it is not authorization or proof of acceptance. Calendar and Samples ownership comes from the exact endpoint surface, client, card ID, exactly one immutable root manifest, and every original expected child. Append/fill, ordinary UI saves and provider imports remain outside this adapter.

The RPC retains the **exact text supplied by its adapter** and a SHA-256 of that text encoded as UTF-8. It cannot prove these are the original HTTP bytes. JSONB is stored separately for inspection; JSONB canonicalization does not replace the text. A null body or body exceeding 1 MiB returns `ok:false, conserved:false`. Future HTTP admission, byte limits, abuse accounting and both fallback transports require separate implementation and review; this SQL bound is not a public endpoint protection claim.

Two new owners have UUID `id` primary keys, no sequences and no foreign keys:

| Owner | Durable content | Lifetime |
|---|---|---|
| `production_card_materialization_receipts` | Exact manifest digest, original parent/child receipt IDs and fingerprints, accepted epochs and actor provenance, original creation projection, created row, exact creation-provenance incarnation and coverage epoch | Unique surface/client/card; no overwrite, deletion or pruning |
| `production_card_materialization_ingress` | Supplied raw text/hash, parsed JSON when available, unverified source/scope and bounded outcome | One retained attempt per completed call, including unknown/conflicting input |

RLS has no public policies. `anon` and `authenticated` receive neither table access nor RPC execution. `service_role` has table SELECT and RPC execution, not direct mutation privileges. Four triggers reject UPDATE/DELETE/TRUNCATE of these owners, including accidental owner-level mutations. An administrator can still deliberately disable triggers: recovery must use an explicitly reviewed retained-data procedure, not claim this is protection against a malicious administrator.

## Admission, locking and replay

Installation seeds `native_card_materialization` in `hold`. A future approved native admission epoch must establish a coverage start at or after this boundary's installed provenance marker. Fresh manifests predating that start remain held; missing historical creation/deletion facts are not proof a card never existed. This capability is separate from the immutable original native intake epochs.

The SQL serializes absent-card admission, takes the existing root-manifest lock, protects the exact manifest ownership census, then follows card-first and sorted-child locking. Fresh admission also joins the existing F27 admission/authority/fence order. It checks the complete expected child set after locks, with exact original receipt identity and native epochs. The payload comparison covers the whole envelope and every original creation property, excluding only mutable browser `order_index`.

Fresh creation inserts a complete row inside a rollback subtransaction. Card, existing journal capture, creation provenance and new acceptance receipt commit together. No existing outbox receipt is edited and no new provider intent is emitted. A competing ordinary insertion is a refusal, never an overwrite.

A matched retry returns the **full current** `post` or `sample`. It does not reapply original name, status, media, comments or ordering. Current archive, missing/deleted/replaced card, changed linkage, missing provenance, changed payload and ambiguous ownership remain visible holds. A person deliberately reopening a card can receive that current row; the boundary makes no claim that an archive transition never happened. Admission hold or a later coverage epoch does not erase accepted receipt compatibility.

Mutations and validation run inside an inner subtransaction. On failure those changes roll back. The retained ingress INSERT then occurs outside that subtransaction, before a typed refusal is returned. If ingress storage fails, the entire call fails and any fresh card/receipt rolls back; the RPC cannot acknowledge conservation. Success always contains a full scoped current card because the existing browser consumes `ok:true` even when a response omits the card object.

## Proof and release limits

Focused proof entry: `node test/native-card-materialization.js`, explicitly bound to the existing F63 disposable PostgreSQL job. The fixture reuses the actual combined history/native migration setup, actual production-write handler and extracted browser materialization function. All data is fictional and provider transport is intercepted. Local execution uses only an owned SCRAM-authenticated PostgreSQL instance. The [final audit handoff](../audits/2026-09-06-native-card-materialization-sql.md) records 56 passed checks, 0 failures, and exact source/receipt hashes.

SQL-only dormancy does **not** close G3: frozen EF and both n8n writers still need compatible routing and refusal handling; status/edit writers are unchanged; no installed closure, served browser, scheduler, provider cutoff, alert delivery, full reconstruction, live data completeness or loss-free guarantee is proved. A sparse or unknown card POST is not the original intake/media payload and cannot reconstruct it.

## Recovery and rollback

Installation is held until an explicit versioned corpus covers the existing 35 owners plus these two owners, with separately authenticated schema and data artifacts, trigger-aware restore, receipt/provenance/journal conservation, and actual replay after restoration. Older backup formats keep their original promises and must not silently omit the new records.

The combined draft supplies explicit `history-v7` data coverage and a [12-group actual local restore/replay proof](../audits/2026-09-06-native-card-materialization-recovery.md) on the final SQL. This closes that bounded data-corpus proof only. Authenticated schema reconstruction, installed equality and live recovery remain held.

First hold fresh admission. Retain the tables, compatible receipt reader, original intake manifests, outbox receipts, card provenance and journal. Do not drop or truncate either new table. Do not restore an old full-row materializer over cards created by this boundary: that reopens late browser overwrite. This slice is additive and unapplied; it supplies no blind inverse migration or deployment command. A failed installation transaction changes nothing; a successful future installation needs the retained-data rollback above.
