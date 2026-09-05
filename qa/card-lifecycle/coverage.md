# Card lifecycle coverage ledger

This lane is **ISOLATED_BROWSER**. All application bytes are local; all backend
rows and identities are fictional. Live writers, authentication, RPC atomicity,
deployed functions and GitHub Pages propagation are **UNPROVEN**.

Source baseline: `706359752e861969e6c68898daa26e29a2eb6edb`, fetched and observed
2026-09-05T06:37:21.2951514Z. Application code is unchanged. Each run's ignored
`summary.json` records the tested head, tracked-byte digest, index digest, tooling
file digests, dirty diff digest, browser version and observed serving hashes.

## Pinned receipt

Implementation and tested source head:
`aa66241b71377d35de9b7b09d4db594a721e4c9f`.
The subsequent handoff commit changes this ledger only; it does not change the
tested application or executable lane. Chromium `141.0.7390.37` ran all 17 cells
from 2026-09-05T07:15:53.164Z to 2026-09-05T07:17:17.771Z:
**14 PASS, 3 FAIL; 33 passing steps, 3 failing steps, 0 skipped matrix steps**.
The checkout was clean and its tracked bytes stayed unchanged throughout.

- Tracked source bytes SHA-256:
  `ba7d50ef6693cf6b2272682fe5ea3a2616c503dcadf288052748c9ed314b21e0`.
- Application and all 86 checked served documents SHA-256:
  `8f64f648d4b92ac2147bd9ecf3c3f0747f4081331df275b8c10ff25e0f10c53a`.
- Ignored receipt: `.codex-tmp/card-lifecycle/2026-09-05T07-15-52-448Z/summary.json`.
  Receipt SHA-256:
  `8e8cd13ff44f3688b61f25cb769e5124f03becc0ee2e0ee0aba167af67b3f287`.
- Unexpected HTTP requests / websockets / page errors: **0 / 0 / 0**.
  Deliberate rejected controls: **1 HTTP, 1 websocket, 3 worker registrations**.
  Raw errors, request records and screenshots remain private and ignored.

| Cell | Verdict | Passing steps |
| --- | --- | --- |
| journey-video | PASS | 8/8 |
| journey-graphic | PASS | 8/8 |
| controls | PASS | 2/2 |
| stale-version | PASS | 1/1 |
| comments | FAIL | 3/4 |
| rejected-save | PASS | 1/1 |
| lost-response | PASS | 1/1 |
| duplicate-click | PASS | 1/1 |
| undo-reopen | FAIL | 1/2 |
| cache | FAIL | 0/1 |
| delayed-refresh | PASS | 1/1 |
| switch-client | PASS | 1/1 |
| navigate-saving | PASS | 1/1 |
| archive-race | PASS | 1/1 |
| touch | PASS | 1/1 |
| keyboard | PASS | 1/1 |
| network-guard | PASS | 1/1 |

**OFFLINE_TEST:** `node test/run-all.js` ran the same unchanged source from
2026-09-05T07:15:53.081Z to 2026-09-05T07:19:45.889Z: 397/399 suites passed.
Two existing Windows environment failures remain recorded: `asset-access-any-team`
uses an absolute drive path as an ESM import URL; `assurance-ledger-staleness`
assumes `/tmp` exists on the current drive. The latter passed a focused rerun
from the workspace's original drive alias at the same head. The full-suite red
result is preserved. Disposable PostgreSQL execution proofs were skipped by
their existing local guards; no live backend proof was run. Private offline
receipt: `.codex-tmp/card-lifecycle/checks/unit-pinned-summary.json`.

## Current bounded findings

- Both full video and graphic review journeys passed, including visible state
  plus fixture requests and fresh browser contexts.
- `cache`: Calendar-primed Kasper sees one fictional eligible card. Reloading
  directly into Kasper and opening the same route in a new context can omit it.
  Expected: one eligible card in both; actual retained/fresh counts: **0/0**.
  The assertion is retained. Reproduce with
  `node qa/card-lifecycle/run.js --case cache`. The fixture supplies a client
  outside the built-in roster seed; this is a cold-roster browser defect candidate,
  not a claim about current live-client incidence. Relevant owner: Calendar/reviews
  in [APP.md](../../docs/truth/APP.md), existing cold-load/freshness repairs in
  [OPEN_REPAIRS.md](../../docs/ops/OPEN_REPAIRS.md).
- `undo-reopen`: Kasper Undo works. Resolving a request and then reopening it
  persists an open thread while leaving the component at Kasper Approval.
  The retained assertion expects Tweaks Needed. This is a **behavior question**:
  source `_calToggleCommentDone` explicitly changes comment data only on reopen.
  No established owner contract found here proves that reopening must reroute.
  Reproduce with `node qa/card-lifecycle/run.js --case undo-reopen`.
- `comments`: a client plain note appears in staff Calendar but not in a fresh
  Production detail view. Expected: the same client note in both views. The
  browser submits the Calendar patch and no native comment request. This red
  assertion is a **server-projection dependency**, not a proven live defect:
  the fixture deliberately does not invent an implicit Calendar-to-native import.
  Reproduce with `node qa/card-lifecycle/run.js --case comments`.
  Separate frozen-writer/canonical-comment projection proof is required before
  attributing this to product behavior. Do not change the frozen writer to make
  this isolated check green.

## Limits and next gate

Client approval Undo is not offered on this Calendar review surface. Production's
Calendar-linked composer does not offer Client-visible; client notes originate
from the actual client review UI. Samples-specific controls remain owned elsewhere.
Comment role authorization is an explicit mock capability, not server proof.
The two journeys deliberately begin with an uncovered legacy request thread;
the separate comments cell exercises a canonical thread and native lifecycle CRUD.
Canonical change-request routing, Approve after tweaks, client-owned comment
edit/delete/reply permutations, and creative-role status/due permissions are
**NOT_TESTED**. Role-control coverage is bounded to admin edits, creative
reassignment denial and absence of staff controls for the anonymous client.

Production due/assignee readback uses its fresh detail view. Its Calendar status
readback is under an **explicitly delivered fixture projection**, not evidence of
the real mirror. Planned dates/capacity/identifier semantics are not tested.
Realtime delivery uses the boot-style subscription transport stub and the app's
real registered callback, not a live websocket. HTTP/WebSocket/worker negative
controls establish isolation for this lane, not deployed CSP/network policy.

The next concrete gate is the coordinator's run on the assembled local candidate
using `--source`, followed by a separate authorized backend/deployment proof.
Reopening's status expectation needs an explicit product decision before anyone
labels that red cell a confirmed defect or changes its assertion.
The client-note projection needs independent backend evidence before its expected
transport behavior can be represented faithfully in the fixture.

No live writes, deployment, flags, n8n runs, schedules, notification sends,
credentials, usage resets or merges are part of this task. The draft is tooling
only. Removing `qa/card-lifecycle/` and its documentation links removes the lane;
there is no application behavior to roll back.
