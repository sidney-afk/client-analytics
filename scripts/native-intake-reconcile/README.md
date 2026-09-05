# Native intake reconcile (draft, disabled)

Server-owned completion of accepted native intake work, in two independently
observable stages over `migrations/2026-09-05-native-intake-reconcile.sql`:

1. `production_intake_reconcile_children(request_id, actor, apply)` recovers
   missing expected native children from the immutable root manifest through the
   unchanged `production_deliverable_write` path, with the original ids, content,
   receipt keys, fingerprints and accepted per-team epoch.
2. `production_intake_reconcile_cards(request_id, actor, apply)` materializes
   the Calendar or Samples card binding once every expected child exists:
   creates the browser-shaped card row when none exists, binds only an empty
   slot when one does, and refuses everything else with a durable reason.

`production_intake_reconcile_state`, `_backlog` and `_summary` are read-only.
`reconcile-lib.js` pages the backlog and calls the stages in order; `run.js` is
the REST entry (dry-run by default, apply needs an explicit confirmation);
`.github/workflows/native-intake-reconcile.yml` is manual-only with no schedule.

Proof: `node test/native-intake-reconcile.js` with `F63_REQUIRE_POSTGRES=1` (or
`INTAKE_MANIFEST_REQUIRE_POSTGRES=1`) and a disposable loopback PostgreSQL 16.
`lane.mjs` drives the REAL gateway (loader in `load-gateway.mjs`, same seam as
`scripts/native-intake-manifest/native-only-lane.mjs` at PR1302 head
`8cb5cba91bc33fb17599b8f2a38625ae07f7743d`) to produce interrupted accepted
intakes, then the real SQL and the real runner library to complete them. Every
assertion reads facts back from the tables. Output carries labels and counts.

Contract, evidence and limits: `docs/audits/2026-09-05-native-intake-reconcile.md`.
