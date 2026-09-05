# Native intake reconcile (draft, disabled)

Server-owned completion of accepted native intake work, in two independently
observable stages over `migrations/2026-09-05-native-intake-reconcile.sql`:

1. `production_intake_reconcile_children(request_id, actor, apply)` recovers
   missing expected native children from the immutable root manifest through the
   unchanged `production_deliverable_write` path, with the original ids, content,
   receipt keys, fingerprints and accepted per-team epoch.
2. `production_intake_reconcile_cards(request_id, actor, apply)` binds the
   Calendar or Samples card slots once every expected child exists, and ONLY a
   slot the recorded facts prove has been empty since the card was created. It
   never creates a card: a missing card is held as visible debt
   (`card_creation_held`, in the reason ledger, the backlog and the summary)
   because the frozen writers convey no operation identity that could tell a
   late original browser job from a person, so a card created here would be
   exposed to that replay. Archived, deleted, occupied, cleared, re-carded and
   un-carded cases are refused with a durable reason.

`production_intake_reconcile_state`, `_backlog` and `_summary` are read-only.
`production_card_provenance` plus one AFTER row trigger per card table record
three facts inside the writer's transaction (card created, with the slot ids it
was created with; card deleted; deliverable slots changed). No trigger alters,
refuses or reorders a write. `reconcile-lib.js`
pages the backlog and calls the stages in order; `run.js` is the REST entry
(dry-run by default, apply needs an explicit confirmation) and prints only the
public report: aggregates, allowlisted reason codes and, with
`NATIVE_INTAKE_RECONCILE_HASH_KEY`, keyed correlation tokens. The full report
goes only to `--private-report=<path outside the repository>`.
`.github/workflows/native-intake-reconcile.yml` is manual-only with no schedule
and uploads nothing.

Proof: `node test/native-intake-reconcile.js` with `F63_REQUIRE_POSTGRES=1` (or
`INTAKE_MANIFEST_REQUIRE_POSTGRES=1`) and a disposable loopback PostgreSQL 16.
`lane.mjs` drives the REAL gateway (loader in `load-gateway.mjs`, same seam as
`scripts/native-intake-manifest/native-only-lane.mjs` at PR1302 head
`8cb5cba91bc33fb17599b8f2a38625ae07f7743d`) to produce interrupted accepted
intakes, then the real SQL and the real runner library to complete them. Every
assertion reads facts back from the tables. Output carries labels and counts.

`load-writers.mjs` loads the REPOSITORY sources of `calendar-upsert` and
`sample-review-upsert` through the same seam so the lane can drive the actual
extracted browser materialization function into the card tables; the serving
v48/v49 bodies are a different, un-gated deployment and are not proved by it.
`node test/native-intake-reconcile-cli.js` (offline) proves the CLI's public
output carries no identifier.

Contract, evidence and limits: `docs/audits/2026-09-05-native-intake-reconcile.md`.
