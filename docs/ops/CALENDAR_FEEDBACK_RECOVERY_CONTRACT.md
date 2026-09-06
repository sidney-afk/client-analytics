# Calendar feedback recovery: executable contract (slice 1)

Base: `fix/calendar-comment-receipt-fingerprint-20260905` at
`7e5a743cce8a1552bc822e0e560896451f983cdf`. This slice finishes an OWNED client
Calendar root note or tweak whose native comment was accepted by the gateway
but whose source-card save (`calendar-upsert`) was refused or lost its response.
Video and graphic components only. Nothing here changes the frozen
`calendar-upsert` / `sample-review-upsert` writers, their gating, anonymous
access, any runtime flag, n8n, or SyncLinear sub-issue behavior.

### Independent correction contract (2026-09-06)

The correction preserves PR1317 author head
`a9d798e6120ddf13c6461bec496715dc06c4bcef` and its original proof. See
[the independent correction evidence](../audits/2026-09-06-calendar-feedback-recovery-independent-corrections.md).
These requirements tighten the field allowlist and reserved-identity description
below; the original passing matrix did not establish them:

- Newly captured tweak status request IDs are `calendar:feedback-status:` plus
  lowercase SHA-256 hex of UTF-8
  `calendar-feedback-status-v1\n<deliverable_id>\n<native_comment_id>`.
  The gateway derives this independently; the RPC derives it again from the
  locked canonical comment after proving its accepted add receipt. The matching
  status must actually have committed with its fingerprint and event. A browser
  claim, another same-card status receipt, or matching status text is insufficient.
- Old unbound reservations retain their identities and text, return
  `companion_status_unbound`, and remain visibly held. No automatic status resend
  or backfill is offered. Accepted comment IDs and fingerprint algorithms remain
  unchanged.
- A tweak may set only its own component status and overall status to
  `Tweaks Needed`. Approval fields may only clear to an empty string, and must
  satisfy the existing Calendar stale-approval rule under the source-row lock.
  Another component's current approval cannot be cleared. A note owns no scalar
  fields. `previous` must contain exactly the forward field keys; prior values
  are context, not authorization.
- Missing, null or non-string source IDs/bodies cannot certify an existing copy.
  They return a visible hold without materialization evidence or source changes.
- Explicit root-note precommit refusal retires only that unaccepted attempt and
  restores its ordinary draft text without replacing a newer typing revision.

This is source and isolated proof only. The new evidence table also needs
authenticated schema and selected-data recovery coverage before installation;
its data must survive rollback. Combined integration and serving remain separate.

## 1. Capture (browser, before the first native send)

The existing owned attempt record (`syncview_review_draft_v1:*`, schema 1) gains
two additive fields on the attempt. Both are written inside the existing
gateway `beforeAttempt` hook, so a capture failure keeps the draft and sends
nothing:

- `recoveryPayload` (existing): the exact serialized native comment request.
- `recoverySource` (new, schema 1): `{ schema:1, kind:'note'|'tweak',
  expected_updated_at, fields, previous }` where `expected_updated_at` is the
  source row revision (`calendar_posts.updated_at` text) the browser had before
  its optimistic edit; `fields` are ONLY the owned scalar fields the failed
  source POST would have carried beside the comment cell (allowlist:
  `video_status, graphic_status, status, client_video_approved_at,
  client_graphic_approved_at, client_caption_approved_at,
  client_title_approved_at, kasper_approved_at`); `previous` holds their
  pre-edit values. A note captures `fields = {}`.
- `statusReservation` (new, tweak only): written by the source-save funnel
  BEFORE the component's own native status change is sent:
  `{ payload: <exact serialized status request>, result:'sent' }`, then updated
  to `accepted` (with the acknowledged row version), `refused` (4xx code) or
  `lost` (no usable response). The identity is the exact request the gateway
  received; ownership is never inferred from status text or the shared client
  actor.

Attempts without `recoveryPayload` or `recoverySource` (older records) stay
visible and unresolved with a precise notice; nothing is guessed for them.

## 2. Retry card sync (browser -> production-write)

The offered `Retry card sync` button re-validates ownership, the client entry
capability, the card/native binding and the stored fingerprint exactly as
before, then POSTs the ORIGINAL comment request plus one additive object:

```
{ ...recoveryPayload, recover_source: {
    card_id, component, kind, expected_updated_at, fields, previous,
    status: null | { payload: <serialized status request>, result } } }
```

No second native comment is ever sent. Outcomes:

- `materialized` / `already_present` / `already_materialized`: the returned
  source row is adopted locally and ONLY that owned attempt retires. Newer
  unsent typing keeps its own revision. Status/source journal rows stay.
- `held` (409, `error:'recovery_held'`, `reason`): the original text stays
  visible with a sentence naming the hold; nothing was written.

## 3. Gateway (`production-write`, additive `recover_source` modifier)

Runs after the existing client-token authentication, target lookup, identity
guard and the same front-door card binding used for a comment add. Requires
`principal.kind='client'`, `surface='calendar'`, `entity='deliverable'`,
`operation='comment'`, add action, a supplied native comment id. It rebuilds
the add dedup key and `commentAddFingerprint` with the SAME helper the accepted
add used, rebuilds the companion status dedup key and `intentFingerprint` from
the reserved status payload (which must name the same deliverable, surface and
a client-allowed `tweak` status), validates the field allowlist, and calls one
service-only RPC. It never reads or requires `mirror_outbox` for the comment.

## 4. RPC `calendar_feedback_recovery_apply_v1(p_request jsonb)` (service role)

One transaction. In order:

1. Serialize on the attempt key (advisory xact lock).
2. Idempotency: an existing materialization row with the same request
   fingerprint returns `already_materialized` without writes; a different
   fingerprint under the same key is `held:materialization_conflict`.
3. Deliverable binding (`for share`): id, `client_slug`, team for the
   component, `origin='calendar'`, `card_id` = the card. Mismatch raises
   `calendar_feedback_recovery_forbidden`.
4. Canonical comment (`for update`, serialized with lifecycle writes): found
   by native id; `idempotency_key` = dedup, same deliverable/client/team,
   `audience='client'`, `role='client'`, component, `is_tweak`, `round`, no
   parent, exact body, `source_created_at` = the captured source clock.
   Missing -> `held:native_comment_missing`; mismatch ->
   `held:native_receipt_mismatch`; edited/deleted/resolved or version moved
   since the add receipt -> `held:native_lifecycle_changed`.
5. Add receipt: `production_comment_mutation_receipts` by dedup with
   `action='add'`, this comment id, this fingerprint, and `result_version` =
   the current version. Missing/mismatch -> `held:native_receipt_mismatch`.
6. Tweak only: companion status receipt = `mirror_outbox` row by the reserved
   dedup with entity/entity_id/operation/client/team/status/fingerprint match,
   plus its `deliverable_events` row. Missing -> `held:companion_status_unproven`.
7. Source row (`for update`): `calendar_posts(client,id)` with reciprocal
   `<component>_deliverable_id`; else raise forbidden. Cell
   `<component>_tweaks` must be null/empty or a JSON array of objects with
   unique string ids and string bodies (else `held:source_cell_malformed`). For
   video the alias `tweaks` must be null/empty or contain only entries
   present in `video_tweaks` (else `held:source_alias_divergent`).
8. If the cell already holds the id: tombstoned -> `held:source_entry_tombstoned`;
   different body/role/audience/is_tweak/round/parent ->
   `held:source_entry_conflict`; exact and every owned field already equals its
   intended value -> `already_present` (evidence row, no source change);
   exact but fields differ -> `held:source_fields_diverged`.
9. Otherwise CAS `updated_at = expected_updated_at` else
   `held:source_row_changed`. Then append the entry built from the VERIFIED
   canonical comment (id, null parent, canonical author name, role client,
   audience client, is_tweak, round, body, source clock, done false), preserve
   every existing entry and tombstone, mirror the video alias, set the owned
   fields, stamp `updated_at`, write `calendar_post_events` (comment_add and
   each status_change), insert the materialization evidence row, return
   `materialized` with the new row.

Holds return without writes. Malformed or incomplete input raises
`calendar_feedback_recovery_invalid_*` (400 at the gateway).

## 5. Explicitly not promised

No permanent source/native synchronization after later lifecycle changes, no
replay of a whole old row, no replay of a missing native status, no legacy
`tweaks`-alias reconciliation, no widening of any reader or writer. Serving
parity (deploying `production-write` and applying the migration) and live TEST
journeys remain separate release gates owned by the coordinator.
