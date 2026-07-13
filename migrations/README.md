# `migrations/` — manually applied Supabase SQL

Every file here is a **one-time migration that was pasted into the Supabase SQL
editor by hand** and is kept for provenance. There is no auto-runner: nothing in
CI, `supabase/config.toml`, or `scripts/` executes these files (see
`README.md` › Repository layout).

## How to read this folder

- **`live-schema-baseline-2026-07-03.sql`** is the authoritative reconstruction
  point: a schema-only snapshot of the live database captured 2026-07-03. To
  rebuild from scratch, start here.
- **Dated files (`YYYY-MM-DD-<slug>.sql`)** are deltas. Files dated after
  2026-07-03 apply **on top of** the baseline; earlier dated files are already
  folded into it and remain as history.
- **`2026-07-11-b4-linear-outbound.sql`** additively expands the dormant B1
  outbox, seeds the default-off outbound switch, and installs atomic enqueue /
  TEST-quarantine helpers. It does not flip authority or enable Linear writes.
- **`2026-07-12-production-comments.sql`** adds the normalized native/Linear
  comment store, service-only idempotent writer, protected body-bearing event
  snapshots, and the staff-reader data contract. It does not change authority,
  outbound flags, or Linear state.
- **`2026-07-12-write-ui-outbox-parity.sql`** marks server-authenticated
  legacy-parity outbox intents, seeds their independent reversible kill gate,
  and adds the atomic normalized-comment + outbox writer used by the Write-UI
  gateway. Existing authority and outbound-mode flag values are untouched.
- **Undated feature files (`*-migration.sql`)** predate the dated convention
  (June 2026, originally at the repo root). Their schema is also already part of
  the baseline; each is documented by its owning design doc in `docs/features/`.

## Rules

- New migrations use the dated convention: `YYYY-MM-DD-<feature-slug>.sql`.
- **Additive-only** during the independence migration — new tables/columns are
  fine; `DROP`/`RENAME`/type changes are forbidden until final cleanup
  (`ROLLBACK.md` rule 3).
- After applying a migration, log it in `EXECUTION_LOG.md` (`ROLLBACK.md`
  rule 5).
