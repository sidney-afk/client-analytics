# F42 Calendar/Samples comment import runbook

> Status: SOURCE-ONLY. This document is not authority to apply a migration, deploy a function,
> export private card data, run an import, change F2, or perform a live TEST drill.

F42 closes only when every active Calendar and Samples/SXR card comment root and reply is accounted
for in one canonical Production thread. The planner is deliberately offline: it reads one local
owner-approved snapshot, writes a review plan, and never connects to Supabase.

## Required snapshot contract

The private snapshot must use this topology:

```json
{
  "contract": "syncview-f42-card-comment-snapshot-v1",
  "surfaces": {
    "calendar": [],
    "sxr": []
  },
  "manifest": {
    "surfaces": {
      "calendar": {
        "cards": 0,
        "comments": { "video": 0, "graphic": 0, "caption": 0, "title": 0 },
        "source_sha256": "<64 lowercase hex characters>"
      },
      "sxr": {
        "cards": 0,
        "comments": { "video": 0, "graphic": 0, "caption": 0, "title": 0 },
        "source_sha256": "<64 lowercase hex characters>"
      }
    }
  }
}
```

The owner or export operator supplies the manifest independently of the planner result. Both
surface arrays are mandatory even when one is empty. An empty surface is certified only by an
explicit zero-count manifest with the matching stable source hash. Missing/partial snapshots,
malformed non-empty comment fields, count/hash mismatches, duplicate identities, missing parents,
and parent cycles are blocking conflicts rather than silent skips.

## Offline plan

From the exact merged source SHA, use only fictional/public-safe examples for rehearsal:

```text
node scripts/f42-card-comment-import.js --input <private-two-surface-snapshot.json> --output <private-plan.json> --import-run-id <approved-run-id>
```

There is no `--apply` mode. A plan is eligible for owner review only when:

- `complete` is `true`;
- `coverage.surfaces.calendar.matches_manifest` and
  `coverage.surfaces.sxr.matches_manifest` are both `true`;
- `conflicts` is empty; and
- the planned composite IDs, parents, audiences, authors, timestamps, lifecycle state, attachments,
  tweak classification, source fingerprints, and deliverable/card crosswalks match the private
  source evidence.

The service-only `production_comment_card_import` RPC is a later release mechanism. The planner
does not call it.

## Reviewed apply runner (`scripts/f42-card-comment-apply.js`)

The apply runner is the reviewed release mechanism the first Slice-4 attempt lacked. It never
plans on its own authority: it re-derives the plan from the exact owner-approved snapshot with the
source-only planner, and refuses anything that is not a complete, conflict-free, manifest-matched
plan. Its database layer is injected, so the same logic drives Supabase's PostgREST rpc in
production and a raw PostgreSQL connection in the apply rehearsal.

```text
# Source-only review preview (no database, no credentials):
node scripts/f42-card-comment-apply.js --input <private-snapshot.json> --import-run-id <approved-run-id>
#   → { status: READY|BLOCKED, apply_digest, planned_imports, eligible, reasons }
# Pin the reviewed plan (refuses if the re-derived digest differs):
node scripts/f42-card-comment-apply.js --input <snapshot.json> --plan <reviewed-plan.json> --import-run-id <id>
# Gated apply (owner window only):
F42_CONFIRM_CARD_COMMENT_IMPORT=IMPORT_CARD_COMMENTS \
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
node scripts/f42-card-comment-apply.js --input <snapshot.json> --import-run-id <id> --apply
```

Apply order is the planner's topological order (parents before children). Every RPC result is
verified to carry the exact canonical id the planner derived, and the run is only `APPLIED` when
the applied receipts, the distinct canonical ids, and an independent
`production_comment_card_import_counts` DB readback all equal the planned canonical count; any
disagreement is a `GAPS` result to reconcile.

## Repeatable apply rehearsal (`scripts/f42-apply-rehearsal.js`)

Before the live window, `node scripts/f42-apply-rehearsal.js` (also `npm run test:f42-rehearsal`)
spins up a disposable PostgreSQL cluster, applies every pending migration in order
(f201 → f202 → f203 → comment-lifecycle → attachments), loads public-safe fixture cards, runs the
planner and the apply runner against them, and asserts the exact counts and idempotent re-apply.
It requires local `initdb`/`pg_ctl` and leaves no residue. A green rehearsal on the exact merged
SHA is a precondition of the coordinated apply; it is not itself authority to apply live.

## Separate owner-approved release window

Before any live action, the owner must approve the exact merged SHA and a private proof location,
then separately gate:

1. database backup and additive migration apply;
2. exact-source `production-comments`, `production-write`, and `linear-outbound` deploy/readback;
3. a fresh private two-surface snapshot and independently produced manifest;
4. dry plan review with both manifests matching and zero conflicts;
5. import plus exact counts/crosswalk/readback;
6. one existing-root TEST reply and lifecycle drill through the canonical reader/writer, including
   projection, refresh, response-loss retry, second-device conflict/rebase, and exact client
   audience denial/allow; and
7. rollback evidence and private artifact retention.

Client-visible controls remain unavailable until the canonical exact-client reader is deployed and
its tokened TEST drill proves the exact `sxr` card/component/deliverable request, Samples-origin
crosswalk, audience denial/allow, and refresh path. Endpoint self-attestation is not a capability.
F2 `off` or drainer outage is a drain pause:
applicable canonical comment add/edit/delete debt remains ordered and recoverable. It is not
retirement and does not authorize discarding or replaying historical shadow rows.
