# Linear intake receipt recovery

This is the operator procedure for F44 failures from the Calendar **Submit**
form. The authoritative ledger is Supabase table
`public.linear_intake_receipts`, installed by
`migrations/2026-07-14-linear-intake-receipts.sql`. Failed and partial rows are
also copied to n8n Data Table `linear_intake_receipts` in project
`4dvRQbC5gyJNowXX` (table ID `EncletbVvvYfSDfF`) as a private operator
dead-letter mirror. The machine-readable row and state contract is
`docs/ops/linear-intake-receipts.contract.json`.

## Client acknowledgement contract

There are two valid client-facing terminal outcomes for a valid intake payload:

- `created` means the receipt has `status = created` and the exact Linear parent
  plus every expected child have been read back. This is the only claim that
  Linear work or a Calendar card exists.
- `received` means the workflow returned strict HTTP 202 with
  `durable_capture: true` and `triage_required: true`, bound to the exact
  receipt/hash/team/idempotency key. Its ledger remains `pending`, `failed`, or
  `partial`; `received` is a transport acknowledgement, not a new receipt-table
  state and not a claim that Linear work exists. The client has succeeded in
  handing off the filmed work and must not be asked to resend it.

An HTTP 200, a completed n8n execution, a stored receipt, or one created Linear
issue is not by itself proof of the `created` outcome. Conversely, never show
`received` unless the authoritative receipt was durably written and exactly
bound to the response.

## Safety boundary

- Work only from the receipt's `receipt_key`. Do not copy a payload into a
  new row and do not edit its `payload_hash`, `team`, or deterministic issue IDs.
- `payload_json` is the exact stable JSON create payload. Supabase recomputes
  its UTF-8 SHA-256 with pgcrypto and requires that value to equal
  `payload_hash`; transport fields such as `mode`, `team`, timestamps, and
  retry metadata and `operator_replay_id` are not part of this payload. A
  hash/payload mismatch is a rejected receipt, not a recoverable warning.
- Supabase is the duplicate, status, and success authority. The n8n Data Table
  is only a failed/partial operator mirror. A missing, duplicated, or stale
  mirror row never authorizes creation and never overrides Supabase.
- Never replay the whole submission after any issue was created. Resume only
  the missing deterministic IDs; `child_issue_ids` records confirmed progress,
  while the workflow derives the full expected set from the immutable receipt.
- Never infer that the parent is absent from a failed execution. A create can
  succeed before n8n loses its response. Read Linear by the receipt's exact
  deterministic parent ID first.
- Store a parent or child ID only after Linear returns a real UUIDv4 and the
  exact-ID readback matches this receipt. A title, identifier, URL, or arbitrary
  non-empty string is not a durable issue ID.
- Do not paste `payload_json` into chat, tickets, Slack, GitHub, or logs. It may
  contain client notes and private Drive links. Keep it inside authenticated
  n8n/Linear operator surfaces.
- Do not delete an unresolved receipt. Its payload is the dead letter and the
  only server-side replay source after the browser closes.
- The browser never automatically retries a receipt after a `received` result.
  Only a staff operator may claim a `failed` or `partial` receipt and supply the
  private `operator_replay_id` transport capability.

## Internal-prerequisite triage

After a valid receipt exists, a missing protected filming-plan mapping, SMM
credential, project mapping/team match, editor/assignee roster, legacy
authority decision, Linear API response, or exact Linear readback is staff
triage—not client correction. Resolve the filming plan only on the server; do
not make the protected plan reader anonymous. If Linear work can be created
without a plan, its parent receives the internal missing-plan marker. If a
genuine Linear prerequisite is missing, the receipt is retained and the client
gets `received` instead.

Every `received` triage is sent to the workflow's unconditional human Slack
fallback, not only to the client-assigned SMM. A plan-only successful create
keeps its existing internal marker/assigned-SMM alert. The receipt response
runs before the dead-letter/alert fan-out, so a notification outage cannot turn
a durable client handoff into a client refusal. A malformed payload remains a
pre-receipt 400 correction. If the authoritative receipt store itself is
unavailable, the system cannot honestly return `received`; treat that as a
capture-availability incident and never blame it on a client configuration.

## Triage one receipt

1. Open Supabase `public.linear_intake_receipts` and filter for the exact
   `receipt_key` in the unconditional triage alert or the n8n execution. A
   `received` browser result intentionally clears its local draft/receipt, so do
   not ask the client to retry just to obtain an ID. There must be one
   authoritative row because `receipt_key` is the primary key. The n8n mirror
   may help locate a failed/partial receipt, but re-read Supabase before acting.
2. Record the receipt's status, attempts, deterministic expected issue IDs,
   `child_issue_ids`, parent ID, and error in the private incident record.
   Do not include `payload_json` in that record.
3. Use the workflow's deterministic-ID helper to derive the parent and child
   IDs from `receipt_key` plus the canonical `payload_json`. Read Linear by
   every derived ID, not by title. Titles and dates are not unique. Build two
   sets: **confirmed present** and **confirmed missing**.
4. Update `parent_issue_id`, `parent_issue_url`, and `child_issue_ids` only with
   IDs positively read back from Linear. Never remove an ID merely because one
   read timed out.
5. Classify the row:

   - Every expected ID exists and belongs to this client/team: mark `created`,
     set the parent linkage and `updated_at`. The row accepts `created` only
     when `child_issue_ids` contains exactly one unique UUID for every entry in
     canonical `payload_json.videos`. Do not create anything.
   - Some expected IDs exist: keep/mark `partial`. Replay only the confirmed
     missing IDs.
   - No expected IDs exist and every exact-ID read completed successfully:
     `failed` may be replayed from the parent. Record who confirmed parent
     absence and when before requesting replay.
   - A fresh `pending` row is still in progress. Do not run a concurrent replay.
     Inspect its named n8n execution and wait for its bounded attempt to reach
     `created`, `failed`, or `partial`. If the execution is no longer running,
     perform the same exact-ID classification before changing the status.
   - Any Linear read is unavailable or ambiguous: leave the row unresolved and
     stop. An unknown result is not permission to create.

## Operator-only replay for a received receipt

A `failed` or `partial` receipt behind a client `received` acknowledgement is
never retried from Submit. Correct the internal prerequisite, then have an
authenticated operator atomically claim that same row and reuse its immutable
payload, receipt key, deterministic parent UUID, and child UUIDs. Every
possible create is preceded by an available exact-ID read, so an earlier lost
response is read back instead of duplicated. Once a server receipt exists, the
browser never abandons it for a new hash and never replays it automatically.

A blank filming-plan field remains valid intake input: the server resolves the
protected mapping after receipt claim. A missing mapping is a marker/alert
condition, not a reason to hold client work. The same principle applies to a
missing SMM credential, project/team mapping, roster/assignee, authority,
Linear availability, or confirmation: repair it internally and explicitly
replay the retained receipt; never ask the client to resubmit.

## Operator replay for a received failed/partial receipt

1. Correct the blocking dependency first (for example the single client/team
   project mapping, SMM credential, active roster, authority stance, or Linear
   availability). A missing filming-plan mapping is an alert/repair condition,
   not a reason to reject or hold client work. Run the same preflight used by
   the worker and require the blocking checks to pass. Verify that the
   unconditional human alert has a recipient even if the client has no SMM.
2. Build a **new** stable JSON `replay_note`; never append text to or reuse the
   prior note. It must contain:

   - `schema_version: 1` and a new UUIDv4 `replay_id`;
   - this row's exact `receipt_key` and `payload_hash`;
   - `source_status` (`partial`, or an operator-escalated `failed`) and
     `prior_attempts` copied from the row you just classified;
   - non-empty `requested_by`, UTC `requested_at`, and `reason`; and
   - `exact_id_readback` with `strategy: "read-before-create"`, the parent as
     `present`, `absent`, or `unknown`, and `confirmed_child_ids` exactly equal
     to the authoritative row's current ordered UUID array.

   Preserve the prior note in the private incident record. For a parent-level
   replay, the reason must also name who confirmed parent absence and when.
3. Claim the replay with one compare-and-set update. Match the exact
   `receipt_key`, current `source_status`, and `prior_attempts`; in the same
   update set `status = 'pending'`, `attempts = prior_attempts + 1`, and install
   the new structured `replay_note`. If the update affects zero rows, another
   worker won or the row changed: stop and re-triage. Never pre-write the note
   in a separate update. Supabase rejects a reused note/replay ID, a counter
   jump, and a second claim against a pending row.
4. Repost the unchanged `payload_json` to that same endpoint with the same
   `payload_hash` and `receipt_key`, plus the transport-only field
   `operator_replay_id` set to the new `replay_note.replay_id`. Do not
   hand-rebuild or browser-edit the payload. Do not expose this replay ID in a
   ticket or to the submitter: it is the private capability proving that an
   authenticated operator already claimed this exact pending row. The workflow
   validates the UUID, receipt, hash, source state, attempt count, and confirmed
   child IDs before it can reach Linear. A missing or wrong capability returns
   non-200 and makes no create request.
5. The workflow computes `expected - created` and sends create mutations only
   for those missing deterministic IDs. It must use the original payload hash,
   team, project, and expected IDs. Existing IDs are read and verified, never
   recreated.
6. After the bounded attempt, read back every expected Linear ID. Only the full
   confirmed set moves the receipt to `created`. A failure with no confirmed
   issue becomes `failed`; the row's `attempts` records the bounded attempts.
   Any failure after an issue exists is `partial` immediately and receives no
   automatic whole-submission retry.
7. Confirm the new Calendar card appears before closing recovery. Calendar
   visibility is the staff-facing proof; the Submit banner is not.

## Lost response and duplicate-click cases

If the browser timed out, or two clicks reached n8n, query the one
`receipt_key` and perform the exact-ID readback above. Reuse the existing
receipt. A duplicate-ID response from Linear is not automatically success: it
must be followed by a read of that exact ID and a match to this receipt. Never
create a second receipt or use a new Linear ID to make the retry pass. A retry
of a `created` receipt returns its stored confirmed result without a mutation.

## Retention

Authoritative rows in `pending`, `failed`, or `partial` are never automatically
pruned. They retain `payload_json` until an operator resolves them. A `created`
receipt is kept for 30 days so lost responses and late duplicate retries remain
idempotent; deletion is allowed only after `updated_at` is at least 30 days old
and one final exact-ID readback. n8n execution-history retention is not a
substitute for this table. The n8n mirror is pruned only after Supabase is
`created`, the same 30-day window has passed, and the final readback is recorded;
it is never the last surviving recovery payload.
