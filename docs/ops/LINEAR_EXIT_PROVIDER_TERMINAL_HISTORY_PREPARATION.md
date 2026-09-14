# Historical provider receipt eligibility preparation

This additive owner is preparation only. It classifies protected historical database receipts; it does not claim fresh provider readback, reconstruct missing ACKs, or send provider requests. It leaves unknown receipt shapes and unresolved work ineligible.

## Boundaries

Install owner 20260913062741 after recorded-create owner 55621 and before the retirement switch caller 62149 in the explicit reviewed plan. No private table shape or application DML guard changes occur.

production_provider_terminal_history_capture_v1 takes the current closed epoch, exact ordered existing row JSON, and actor. It locks the application gate first and then mirror_outbox, checks exact row CAS and source receipt consistency, and appends only source identity, ordered row hashes/count, and provenance to protected control history. It never rewrites the historical rows. Reopening rotates the epoch and invalidates earlier history capture.

production_provider_terminal_eligible_v1 refuses invented composite row arguments. Its routes are a completed source-owned attempt with unchanged original intent and exact local receipt; a source-validated historical written row matching the current epoch snapshot; or the exact existing source-owned discard disposition and F27 snapshot. Quarantine remains unresolved. Caller-asserted success and receipt hashes alone cannot bypass these conditions.

The historical shape validator binds current native client/team/identity and original outbox scope. Comments use outbox.comment_id and payload.comment_id plus the canonical comment's deliverable/client/team, then the actual linked deliverable UUID; they do not require the absent historical payload issue ID. Source-built expected mutation inputs must agree with payload fields. Attachment metadata/title/revision and comment actor/body/dedup marker are checked, and create optional fields cannot contradict the saved intent.

## Isolated proof

Supported command: run-portable.ps1 -PgBin '<local PG17 bin>' -Lane provider-terminal-history.

Receipt 552e0369ce374cf6bee2510ef37b4e0d: exit 0, 31 checks, LINEAR_EXIT_PROVIDER_TERMINAL_HISTORY_OK, server stopped. Fourteen normal source-derived receipt fixtures cover title/due/priority/labels/status/archive/restore/exact-CR-description, attachment/create, and comment add/edit/delete plus edit-to-create materialization. The test extracts the actual pinned handler ACK expression and uses its actual mapping builder. Mutated comment body, coordinated attachment URL/receipt, and contradictory create description refuse. Capture CAS, stale epoch, forged row arguments, direct closed writes, whole-transaction rollback, discard versus quarantine, and epoch rotation are exercised.

SQL SHA-256: e06124eb54b7920cab8b1a14d6c7ce8bcb08b4f14a8393c5552191095ea43ea0.
Test SHA-256: 6f2624f6881cb915e073bcd0b8c670c06e5b5274a4998a7afd738b4dad53a72c.
Historical handler SHA-256: 8b6823724bbeda49449fd584f5953e40c4f2c14428c66c3458d17471c06daaf4.
Earlier 22-check receipt efb5d170bab24e4b8d76080fdef5816f remains prior evidence; intermediate failed receipts remain preserved privately.

## Remaining scope

This does not classify the hosted corpus or prove external worker fencing. Historical read-recovered create support is source-defined but is not among this receipt's fourteen normal ACK fixtures. Unknown skipped/conflict/no-op shapes remain ineligible and require their own verified source disposition or recovery path. Attachment URL normalization outside the explicitly supported canonical form remains conservative. Full current-catalog installation, retirement switch, private custody restoration, and actual owner-window evidence are separate gates. No installation or retirement readiness follows from this component alone.
