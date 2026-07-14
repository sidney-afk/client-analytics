# Historical design-session handoff — non-operative

> **QUARANTINED 2026-07-14 (F56/F64/D-17). DO NOT USE THIS FILE TO BUILD, TEST,
> PUBLISH, OR RESUME A PROVIDER SESSION.**

This filename is retained so old links fail safely. The former July 5 handoff described a
prototype-era external workspace, scratch output, publisher, tester, and saved provider browser
profile. Those instructions are not the current repository workflow and are intentionally absent
from the active tree; Git history preserves them for private archaeology.

Use [`README.md`](README.md) for the current routing. Implementation changes belong in the real
application and must follow [`WIRED-PARITY.md`](WIRED-PARITY.md), [`ADAPTER.md`](ADAPTER.md), and
the runnable suites in [`tests/README.md`](tests/README.md).

Removing the instructions does **not** prove the old saved provider session is revoked. F64/D-17
still require provider-side revocation, denial proof, and private copy/cache review. Do not open,
restore, copy, or test that profile from this public-repository workflow.
