# Final switch: approved preparation scope

The owner approved both preparation decisions below on 2026-09-12: narrow
atomic writer internals preserving existing links and tokenless access, and
retained verified native receipts with zero work still destined for Linear.
These decisions authorize preparation only, not merge, deployment, installation
or activation. The current activation routine stays refusing until the protocol
is implemented and proved.

## Why the current constraints do not close the switch

The captured Calendar rehearsal proves both a card save under the proposed
outbox freeze and an event that occurs after a successful HTTP response. The
current handlers do not durably record every pending follow-up effect before
responding. A lock serializes database transactions; it cannot recover an intent
that was never recorded. An ingress proxy cannot prove completion of opaque
background work. Equal counts and quiet-time sleeps are not a drain protocol.

Evidence: LINEAR_EXIT_FINAL_FREEZE_PREPARATION.md and the September 11 captured
Calendar freeze/deferred evidence. Platform background tasks remain subject to
worker limits; see https://supabase.com/docs/guides/functions/background-tasks.
This is not a claim that a particular hosted save was lost.

## Owner-approved preparation scope

Preserve both existing URLs, tokenless authentication, payload compatibility and
client links. Permit a narrowly scoped change to internal persistence only:

1. Add one atomic database entry point per writer. In one transaction, admit the
   request under an epoch, merge comments, save the card, insert required events
   and durably enqueue remaining follow-up work. Return success after commit.
2. Make every other business-write owner participate in the same admission
   boundary. Cutoff waits for admitted transactions, closes new admission and
   records the epoch. A new request receives an explicit maintenance refusal.
3. Drain the durable ledger for admitted work. Retries resolve the same logical
   operation. Failures remain unresolved work until a verified disposition; no
   timeout silently counts as success.
4. Seal only after all admitted work is accounted for. Capture and verify the
   final snapshot, complete B5 classification and perform separately authorized
   activation while admission remains closed.

Changes required: new migrations, narrow Calendar/Samples handler persistence
changes, durable worker completion/replay and admission participation across
other writers. No auth gate, new client token or link reissue is proposed.
Implementation is in progress and is not yet proved. Approving this design does
not approve deployment.

## Acceptance before a final handoff can call the switch ready

Prove paused merge/update, crash after business commit, delayed events after
response, exact retries after cutoff, direct/service write races, durable worker
failure and complete restored effects. Verify that every acknowledged operation
has recoverable rows, comments, events and follow-up work. Preserve the failed
controls. Earlier accepted operations with unrecorded work require a separate
reconciliation; a new ledger cannot retroactively prove them.

## Separate B5 decision

The former literal zero-new-outbox-row criterion conflicted with retaining typed
native completion receipts in that table. The owner-approved criterion is now
zero provider-bound work and zero unresolved provider debt, with verified native
completion receipts retained and separately counted. The canonical B5 checklist
and retirement runbook now record that approval. Unknown or malformed records
remain blockers; this decision does not turn a failed test green.

Strict final-switch readiness remains HOLD until the approved protocol is built
and tested across all callers. Keep the original serving captures and repository
401 controls immutable as evidence. Do not publish a quick-install handoff that
hides incomplete atomic persistence, follow-up completion or global admission.
