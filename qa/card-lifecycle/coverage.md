# Card lifecycle coverage ledger

This lane is **ISOLATED_BROWSER**. All application bytes are local; all backend
rows and identities are fictional. Live writers, authentication, RPC atomicity,
deployed functions and GitHub Pages propagation are **UNPROVEN**.

Source baseline: `706359752e861969e6c68898daa26e29a2eb6edb`, fetched and observed
2026-09-05T06:37:21.2951514Z. Application code is unchanged. Each run's ignored
`summary.json` records the tested head, tracked-byte digest, index digest, tooling
file digests, dirty diff digest, browser version and observed serving hashes.

## Current bounded findings

- Both full video and graphic review journeys have run successfully, including
  visible state plus fixture requests and fresh browser contexts. Final pinned
  run receipt will be recorded below before handoff.
- `cache`: Calendar-primed Kasper sees one fictional eligible card. Reloading
  directly into Kasper and opening the same route in a new context can omit it.
  Expected: one eligible card in both. The assertion is retained. Reproduce with
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
