# Final freeze preparation contract

Status: preparation design with bounded ISOLATED_CAPTURED_HANDLER_SQL evidence;
not an executable release procedure. Installation HOLD.
No handler, database, hosted configuration or activation change is authorized by
this document. Preserve the frozen tokenless Calendar and Samples contracts.

## Known boundaries

The isolated batch-description probe proves that the shared authority assertion
participates in the outbox lock even though the RPC inserts no outbox receipt.
Its blocked transaction leaves row/events unchanged; a released-lock control
commits. Evidence: ../independence/LINEAR_EXIT_RETIREMENT_FREEZE_20260911.json.
The batch-asset source also calls production_assert_authority for resolved teams
(2026-08-31-batch-asset-client-slug-insert-arm.sql); runtime race coverage for that
RPC is still absent. Neither finding proves a whole-application freeze.

Repository calendar-upsert and sample-review-upsert split existing-row comment
merge and scalar update into separate SDK requests. They then schedule event
insertion and graphic-tweak work through waitUntil. A response can precede that
work; a failure between requests may leave earlier commits. This is source
inspection of repository handlers, not a fresh hosted serving fingerprint. The
previous captured Calendar v49 rehearsal remains a separate serving contract;
rehearse the captured source and dependencies, retaining repository 401 as the
negative control. Do not substitute repository auth behavior for hosted behavior.

## Source closure limits

Independent source review found no outbox-lock dependency in the reviewed card
status triggers, card_change_journal_capture (2026-09-05-card-change-journal.sql),
or optional thumbnail-v2 trigger bodies (2026-07-14-thumbnail-revision-v2.sql).
Reviewed event table owners likewise supplied no such trigger. This is a bounded
source trace, not a runtime card-lock test or a hosted trigger census.

The dated Calendar bootstrap does not establish inclusion of calendar_merge_comments
from 2026-06-18-atomic-comment-merge.sql in the pinned inventory. The next isolated
handler race must disclose and verify that source prerequisite rather than invent
an RPC or claim the existing inventory is a complete serving schema. Samples'
complete source owner supplies its merge RPC. Preserve the distinction between
inventory composition, explicit test supplements and hosted schema.

## Required protocol before any activation implementation

1. Produce a source-owned mutation inventory: entrypoint, actual serving hash,
   affected tables, RPC/trigger closure, transaction boundaries, deferred work,
   caller scope and refusal behavior. Include stale tabs, retry queues, service
   jobs and direct database callers. An outbox insert search is insufficient.
2. Separate stopping new logical requests from draining requests already
   admitted. A database table lock can serialize individual transactions but
   cannot establish completion of a multi-request handler by itself. Do not
   freeze event writes between an accepted business write and its deferred event.
3. Choose a server-enforced admission boundary compatible with frozen handlers.
   Its mechanism is unresolved: do not quietly add browser auth, modify a frozen
   handler or claim a UI maintenance banner establishes server admission.
   Any infrastructure mechanism needs proof that every caller traverses it.
4. Prove completion of admitted requests and deferred work, including failures
   and retries. Repeated equal counts or a fixed quiet-time sleep cannot prove
   absence of delayed work. If the current serving contract cannot expose a
   trustworthy completion boundary, retain HOLD and record the missing mechanism.
5. Only after that drain, establish a consistent snapshot/high-water boundary
   across business, comments, events, notification state and required assets.
   Every accepted pre-boundary mutation must appear in snapshot or authenticated
   delta; a delta needs explicit ordering, replay identity and completeness proof.
6. Keep admission closed through canonical B5 classification, final zero proof,
   detect-only reconciliation, export and reviewed activation. The current
   activation RPC must remain refusing until all prerequisites are satisfied.
   Reopening admission after a failed freeze needs a reviewed state-specific
   recovery plan; dropping locks alone does not repair partial handler writes.

## Required isolated race evidence

| Race or failure | Required observation |
| --- | --- |
| Shared-authority RPC vs held boundary | Refusal/timeout leaves all owning transaction rows unchanged; released control succeeds. Description covered, asset still open. |
| Existing-row comment merge then scalar update | Pause between requests; prove admitted logical operation drains completely or account for partial state before final export. |
| Response then deferred event/tweak work | Hold deferred operations until after response; snapshot cannot be declared final until completion is accounted for. |
| New request after cutoff, including stale tab and service caller | Server refusal with understandable response and no business/event mutation. |
| Retry of admitted request after cutoff | Exact replay/disposition is defined and cannot introduce unaccounted provider work. |
| Failure during drain or export | No activation; boundary state and recoverable pre-state remain explicit. |
| Snapshot plus delayed accepted mutation | Restore proves the row, comment, event and notification effects are present exactly as the accepted contract requires. |

These are acceptance requirements, not passing test claims. Run actual captured
handlers against isolated PostgreSQL with paused SDK operations and refusing
external transport; mocks alone cannot establish SQL/trigger or hosted behavior.
Do not weaken an assertion to force a green result when a split request exposes
partial state. Preserve the failure as evidence for the unresolved protocol.

The canonical B5 literal zero-outbox-row requirement also remains unresolved
against retained typed native completions. This document does not ratify the
proposed zero-provider-debt interpretation. See SYNCVIEW_RETIREMENT_RUNBOOK.md.

## Isolated counterexample now proved

See ../independence/LINEAR_EXIT_CALENDAR_FREEZE_20260911.json: the captured Calendar
status-update handler commits row and event while the outbox lock remains held,
under service_role with explicit source ACL supplements. This closes the narrow
question of whether that lock alone freezes this path: it does not. All proposed
admission/drain mechanisms and the remaining race matrix stay unproven.

## Response completion is insufficient: isolated evidence

The optional -DeferredEvents lane pauses actual event SQL at the SDK seam,
observes a successful response and committed status with the event absent, then
releases and verifies the real event. See
../independence/LINEAR_EXIT_CALENDAR_DEFERRED_20260911.json. The handler and its
captured dependency hashes remain unchanged. This closes one required race
observation; it does not supply the missing request-admission or durable drain
mechanism. Never derive a final export boundary from completed HTTP responses.

## Additional caller from newer main

The client-signoff reconciler revalidates evidence and then posts a repair to
Calendar in a separate request. Include every active apply run in the admission
and drain inventory. Dispatch-only and default dry-run prevent automatic use
of this prepared workflow, but do not establish a freeze for an existing runner.
Its native skipped-receipt repair eligibility remains incomplete; see
../independence/LINEAR_EXIT_UPSTREAM_SIGNOFF_20260911.json. No workflow dispatch
or production repair is authorized by this carry-forward.
