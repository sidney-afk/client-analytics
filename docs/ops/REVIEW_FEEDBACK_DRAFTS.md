# Review feedback draft preservation

Draft-only browser repair based on integrated Samples candidate
`343446aa435e07222b60455ca9bb603a31e82e67`. Prior Samples PR #1269 at
`a3f86c96e99b0d1ff3e93d6ac9f8e2ee496f8ca5` and recovery PR #1290 at
`2bcca5b156a9313b41ea096b7e70cd1043963639` remain unchanged.
This is not a migration audit, a new discussion store or a new replay service.

## Observed defect and visible change

The base document reproduced a Kasper plain-note refusal that removed the text.
Calendar notes and tweak attempts could survive only in memory; a fresh browser
context lost them. Late Kasper failure could replace a newer composer revision.

Calendar, Samples and Kasper now checkpoint unsent typing by principal, client,
card and component. Calendar/Kasper notes and all tweak actions capture one
stable action ID and exact composer revision before clearing it. A refusal or
ambiguous result retains visible earlier feedback and an explicit retry. A newer
draft remains separate. No draft timer or startup handler submits that attempt.
Positive matching source receipts retire only the acknowledged revision; a
successful request carrying a later edit under the same ID cannot erase the
original body. Native-accepted/source-pending attempts remain visibly pending
and keep their existing repair receipts instead of creating a second native comment.

Samples submitted notes still belong to the existing Samples owned-work queue.
The composer stores only a handoff ID/revision/time, verifies that the existing
queue durably captured the note before clearing typing, and routes Retry to its
existing save function. No second note payload or competing replay queue is added.

Identity replacement detaches unconfirmed optimistic projections while the
outgoing identity is still current. Late completions settle only their captured
owner. Browser storage denial keeps text visible with a keep-this-tab-open error;
it cannot promise recovery after the browser loses that unstored memory.

The browser-only record is `syncview_review_draft_v1:` with schema 1 and exact
scope fields. One unsent revision and one unresolved captured action are stored;
this is not a 30-day history. Unknown/malformed records and outside-tab changes
are not overwritten. No client/share credentials are copied into these records.

## Existing authority and source drift

The frozen anonymous `calendar-upsert` and `sample-review-upsert` endpoints,
headers, routes and permission decisions remain unchanged. Both teams' native
authority and existing target locks/source-repair paths remain in place.
Source writers gain a no-transport observer after positive HTTP/envelope checks.
Kasper additionally rejects non-2xx responses even if their JSON says `ok:true`.
These are browser changes; no Edge Function, n8n, flag, migration or auth policy
is edited. Feedback reader/thread projection work remains a separate change.

The Samples recovery builder permits exactly the additive acknowledgement
observer in `_sxrFlushCardSave` when comparing with the preserved candidate.
Every other writer byte, the local-work schema and reader/cache protections
remain drift-checked. The recovery transformation retains all feedback code.

## Recovery procedure and release blockers

Never deploy the base HTML or a raw revert while owned review drafts or Samples
work remain. That document cannot consume this schema. Do not clear browser
storage, reassign another actor's records or relock the frozen client writers.

For a Samples reader rollback on this composition, run the existing offline
builder with the full reviewed feedback head and a new private output directory:

```sh
node scripts/samples-recovery-build.js PRIVATE_OUTPUT EXACT_CHECKOUT FULL_HEAD_SHA
```

Review its manifest and generated patch, then rehearse forward/recovery/forward
with `SAMPLES_RECOVERY_TARGET_SHA=FULL_HEAD_SHA`. This changes only the Samples
read strategy; it preserves the composer bridge, exact draft storage, existing
queue and explicit recovery controls. The builder does not publish or deploy.

Pinned artifact for the independently reviewed runtime:
forward HTML SHA-256 `9b0aa7cd3703b8956850eeddfd92f12fb008f65e5959a07a9ebffa5af44a1f88`;
recovery HTML SHA-256 `bb61876f85816ef6ce61c23def571c0731e9fd628982392b7e7bdc411d244711`.
Only `_sxrFetchPosts` differs. The patch reverses byte-for-byte to the forward
document. New runtime bytes require a new manifest and rehearsal.

Removing the feedback ownership implementation itself is **not yet a proven
inverse**. Such removal requires an independently reviewed schema-compatible
bridge or verified per-owner reconciliation of every outstanding revision.
Keep that as a release blocker, rather than claiming a raw revert is safe.
Storage-denied memory must be kept in its visible tab until safely copied or
successfully stored. No automatic reconciliation or live operator action is
authorized by this document.

Local synthetic evidence covers 13 isolated ownership groups, 18 browser failure
cells, 15 browser behavior groups, 3 real BFCache groups and 9 additional
forward/recovery/forward feedback groups (pending, refused, ambiguous and newer
revisions on all three surfaces). The existing 8 Samples local-work and 13
Samples recovery browser groups pass. The two independent review findings were
retested closed on runtime commit `4dcb50bb1a0d0e29aa1efd2db9b8d2d3ae49c977`,
with index SHA-256 `9b0aa7cd3703b8956850eeddfd92f12fb008f65e5959a07a9ebffa5af44a1f88`.
Existing applicable
suite results are recorded in the PR. These results do not prove installed
native idempotency, live comment delivery, production release, monitoring
integration, 30-day history or client continuity. Exact-head independent review,
monitoring and live release gates remain held.
