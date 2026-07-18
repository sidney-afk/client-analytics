# SyncView design kit — current routing and frozen evidence

This folder contains both the **current wired Production/Linear contract** and a frozen 2026-07-05
prototype reference. Do not confuse the two.

## Current operational sources — read in this order

1. [`../../index.html`](../../index.html) — the shipped application. The visible **Linear** tab is
   the internal `production` module; it is an authority-gated native mirror, not an inherently
   read-only prototype.
2. [`WIRED-PARITY.md`](WIRED-PARITY.md) — living parity and capability ledger, including the
   locked live-read/zero-mutation lane and fully mocked native-write lane.
3. [`ADAPTER.md`](ADAPTER.md) — current database-to-view model and mutation boundary.
4. [`tests/README.md`](tests/README.md) — runnable repository suites. Use `npm test` and
   `npm run test:prod-polish`; locked lanes may read live data, but no design-kit suite may mutate
   a live backend. F105 repaired the post-#813 guard/fixture test epoch; the exact candidate must
   still pass the complete aggregate before merge.
5. [`../truth/APP.md`](../truth/APP.md) and
   [`../independence/TRACK_B_LINEAR_REPLACEMENT_SPEC.md`](../independence/TRACK_B_LINEAR_REPLACEMENT_SPEC.md)
   — current app/cutover truth. Runtime authority always requires an immediate live readback.

## Frozen design evidence — reference, not authority

- `SyncView.html` and `syncview-app.src.html` preserve the prototype visual/interaction reference.
- `linear-design-tokens.md` and `probe-data/` preserve the dated measurement baseline.
- `tests/design-machine-originals/` preserves verbatim prototype-era test source. It is explicitly
  non-runnable here and cannot authorize a runtime behavior or provider session.

The model remains: client = project, batch/shoot = parent issue, and video/thumbnail deliverable =
sub-issue. Product creation, status vocabulary, authority, write operations, and removed/retained
features are governed by current source and Track-B decisions—not by prototype prose.

Treat the frozen artifact as an oracle that needs independent review: do not update it alongside a
wired implementation merely to make a comparison green. A material oracle change needs an
owner-reviewed rationale, pinned artifact identity, and tests that preserve the old/current delta.

## Historical files — quarantined

`HANDOFF.md`, `CONTINUATION.md`, `PARITY.md`, and `PARITY-LOOP.md` are fail-safe tombstones. Their
former versions contained obsolete external build/publish commands, session-specific paths,
private task references, and saved provider-profile instructions. Git history preserves that dated
record; it is not an operational resume path.

F64/D-17 provider-session containment remains open. Removing instructions from the active tree
does not prove revocation: the provider-side session must be revoked, the old profile denied, and
copies/caches reviewed privately. Do not open or test the old profile in this public-repo workflow.
