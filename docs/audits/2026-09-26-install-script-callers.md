# Installation preparation script callers (2026-09-26)

Source baseline: `3f5bd46e6086911ae2a7bb0d32507f03d5a44da8`. This is a bounded Task G review of all eight `scripts/linear-exit-install-*` files, following the [entrypoint draft](https://github.com/sidney-afk/client-analytics/pull/1702). It traces repository imports, test workers, and source references only. It did not invoke an installer, connect to a database, or determine live installation state.

No package command or workflow command directly names any of these eight files. That is not evidence of obsolescence: the files form a dependency chain behind explicitly supplied plans and connections, and tests import them. Several can issue SQL through a caller-owned session; none was run here.

| Script under `scripts/` | Tracked source/test caller | Role and disposition |
|---|---|---|
| `linear-exit-install-manifest.js` | Imported by `linear-exit-install-journal.js`, `linear-exit-observed-install-plan.js`, `linear-exit-integrated-release-plan.js`, and test helpers. | Source inventory and dependency ordering, not an SQL executor. Retain while those plans and tests use it. |
| `linear-exit-install-journal-catalog.js` | Imported by bootstrap, journal, maintenance, finalize, and `linear-exit-control-companion.js`. | Private journal catalog query and source pins; retain as shared contract. |
| `linear-exit-install-journal.js` | Imported by bootstrap, maintenance, finalize, operator, several observed-plan modules, and tests. | Compiles a reviewed stage/plan; retain as shared validation code. |
| `linear-exit-install-profiles.js` | Imported by operator, B9 catalog derivation, observed public catalog, and operator/pipeline tests. | Holds finite observed plan/target profiles, including retired ones; retain until dependent checks are retired deliberately. |
| `linear-exit-install-bootstrap.js` | Imported by maintenance and `test/helpers/install-bootstrap-worker.mjs`; exercised by its isolated PostgreSQL test. | Opt-in journal bootstrap over a caller-owned session; retain for explicit preparation proof. |
| `linear-exit-install-maintenance.js` | Imported by operator and finalize; `test/helpers/install-maintenance-worker.mjs` exercises it. | Opt-in maintenance guard preparation; not a routine scheduled command. |
| `linear-exit-install-finalize.js` | Imported by operator and `test/helpers/install-finalize-worker.mjs`; exercised by isolated tests. | Requires a reviewed final catalog hash and changes SQL state through the supplied session; retain as a guarded preparation component. |
| `linear-exit-install-operator.js` | Imported by `linear-exit-b9-catalog-derive.js` and operator test workers; source is referenced by installation-day docs. | Explicit operator adapter; a tracked import is not permission to run an install. |

The tests for bootstrap, maintenance, finalize, and operator include disposable PostgreSQL profiles in `test/suite-classification.json`; this audit did not run them. The eight files are source-connected, but the repository has no direct automated command for this family. Review an actual current operator procedure and plan pins before any use or deletion; this report changes no code, SQL, workflow, or live system.
