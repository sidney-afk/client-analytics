# F42 Calendar/Samples comment import runbook

> Status: EXECUTED for the linked cohort. Apply run `f42-import-2026-07-25c` (Actions run
> `30138142140`, 2026-07-25 01:16Z, apply digest
> `bfc03c2c34cd7f779f80aa05b7ab83066eeefa8f50ca1d6e9c5806deb572d237`) applied **615** comments
> (612 calendar / 3 sxr), with **6,032 deferred** (`missing_deliverable_id`) and **35 quarantined
> link defects** (`deliverable_crosswalk_mismatch`); the independent counts readback matched. The
> full seven-run history is in `EXECUTION_LOG.md`. This document remains NON-AUTHORITY for further
> runs: it does not authorize applying a migration, deploying a function, exporting private card
> data, running another import, changing F2, or performing a live TEST drill.

F42 closes only when every active Calendar and Samples/SXR card comment root and reply is accounted
for in one canonical Production thread. The planner is deliberately offline: it reads one local
owner-approved snapshot, writes a review plan, and never connects to Supabase.

## Required snapshot contract

The private snapshot must use this topology:

```json
{
  "contract": "syncview-f42-card-comment-snapshot-v2",
  "surfaces": {
    "calendar": [],
    "sxr": []
  },
  "deliverables": [
    { "id": "", "client_slug": "", "team": "video|graphics",
      "origin": "calendar|samples", "card_id": "" }
  ],
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

## Import scope: linked cohort (blocking conflicts / deferrals / link defects)

A canonical comment is addressed by its card's native deliverable id. A card with **no** such
binding has nothing for the crosswalk to point at, so its comments are **out of scope** for an
import run rather than defective — no owner action taken during the window makes them plannable.
At the 2026-07-24 plan run this was 6,032 of 6,681 comment rows (only 3 of 1,722 Samples cards were
linked), and treating them as conflicts blocked the 649 plannable rows indefinitely.

A plan therefore sorts every non-importable row into exactly one of three buckets, and only the
first blocks:

| Bucket | Field | Blocks? | Imported? | Meaning / remedy |
| --- | --- | :--: | :--: | --- |
| Conflicts | `plan.conflicts` | **yes** | no | The plan is not certifiable until the owner fixes these. |
| Deferrals | `plan.deferrals` | no | no | Out of scope — no target exists (`missing_deliverable_id`, `deliverable_not_found`). Resolves itself once the card is linked; a later plan picks the rows up automatically. |
| Link defects | `plan.defects` | no | no | The deliverable **exists** but belongs to a different card/client/team/origin (`deliverable_crosswalk_mismatch`). Needs a **linkage-repair session** — it will *not* resolve itself. |

Defects and deferrals are treated identically by the apply path: excluded from the apply set and
from the apply digest, so they can never reach a wrong deliverable. They are reported **separately**
because the remedy differs, each in its own titled run-summary section with the same
classification × surface × reason counts. The per-row card/comment identity for every defect stays in
the runner-local plan for the repair session, and never reaches the public log. Those defect-row
identities are **ephemeral per-run**: they are not retained anywhere durable, so regenerate them
with a fresh `mode: plan` dispatch when the linkage-repair session actually starts.

`plan.complete` means *complete for scope* — every in-scope, cleanly-linked row planned cleanly —
and `plan.scope` records the policy plus the planned/deferred/defect counts so a linked-cohort plan
can never be mistaken for a whole-source one. The apply runner refuses any plan whose `scope.policy`
it does not recognize, or which fails to report either non-blocking bucket.

**Every other conflict class stays blocking**, including `missing_client_slug`, malformed
lifecycle timestamps, invalid rounds, NUL bytes, audience quarantines, duplicate identities, parent
cycles and coverage mismatches — including when they occur alongside a defect. Source-coverage
certification is unaffected: the exporter's independent manifest must still match what the planner
read.

The RPC's own crosswalk refusal is deliberately left in place as the **apply-time backstop**: even
if this classification were ever wrong, `production_comment_card_import` still refuses a row whose
deliverable does not match, so nothing can be written to the wrong target.

## RPC parity: the plan must never be rejected by the import

The first live apply failed on its FIRST RPC call (`rpc_production_comment_card_import_400`, zero
rows written) because the planner certified rows the RPC then refused. The planner now pre-validates
every rule `production_comment_card_import`, `production_comment_upsert` and the
`production_comments` constraints enforce, so a certified plan is one the RPC will accept:

| Enforcement | Planner classification |
| --- | --- |
| Deliverable row must exist | `deliverable_not_found` (**deferred** — no target exists) |
| Deliverable `origin`/`team`/`client_slug`/`card_id` must match the card | `deliverable_crosswalk_mismatch` (**link defect** — wrong target; non-blocking, never imported) |
| `text` cannot hold a NUL byte (PostgREST rejects the whole call) | `unsupported_text_control_character` |
| `round` is `integer` (int4) and `> 0` | `invalid_round` (`round_exceeds_int4_range`) |
| `source_*`/`edited_at`/`deleted_at`/`resolved_at` cast to `timestamptz` | `malformed_lifecycle_timestamp` |
| `author_key`/`author_name`/`role` non-empty, `audience` enum, `attachments` array, `body_format` enum, `team` enum, one native target, id shape, self-parent, parent exists in-thread | already guaranteed by construction or by existing classes |

The crosswalk is why the snapshot moved to **v2**: those facts live on `deliverables`, not on the
card, so a v1 snapshot could not see them. `scripts/f42-card-comment-export.js` now exports the
crosswalk projected to exactly the five fields above (never titles, briefs or `linear_raw`), and the
plan carries a `deliverables_fingerprint` that is part of the apply digest — a deliverable re-pointed
between plan and apply moves the digest and the drift guard refuses before any write.

Every row in that table is covered by a rehearsal fixture case, and the two payload-shape cases
additionally assert that the **real** RPC still rejects them, so the parity claim cannot rot
silently if a migration changes.

## RPC failure detail

A failed PostgREST call now reports the SQLSTATE `code` and `message` (each truncated to 200
characters) alongside the function and status, in the FAIL document and therefore the step log.
`details` and `hint` are deliberately **dropped**: a constraint violation echoes the offending row
("Failing row contains …"), which would put private comment bodies, card ids and client slugs into a
public Actions log. The raw payload is not retained on the error at all, so no downstream serializer
can reach them.

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

The service-only `production_comment_card_import` RPC is live (its migration was applied to
production 2026-07-24) and has executed the 2026-07-25 linked-cohort apply. The planner still never
calls it.

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
spins up a disposable PostgreSQL cluster, applies the five Slice 4 migrations in order
(f201 → f202 → f203 → comment-lifecycle → attachments — all five are applied to production as of
2026-07-24, so no migration is pending live; the rehearsal still applies them to its disposable
cluster), loads public-safe fixture cards, runs the
planner and the apply runner against them, and asserts the exact counts and idempotent re-apply.
It requires local `initdb`/`pg_ctl` and leaves no residue. A green rehearsal on the exact merged
SHA is a precondition of the coordinated apply; it is not itself authority to apply live.

## GitHub Actions import lane (no local credentials)

The live import runs entirely from Actions so it is a guarded button-press with logs, never an
improvised local run. `scripts/f42-card-comment-export.js` reads the live Calendar and Samples
source cards through the service-only PostgREST endpoint and projects each card down to only the
F42 fields (identity, client slug, the deliverable crosswalk, and the per-component comment/tweak
arrays — never briefs, `linear_raw`, or unrelated columns), emitting the exact two-surface
snapshot the planner and apply runner consume.

`.github/workflows/f42-card-comment-import.yml` (manual `workflow_dispatch` only, pinned to an
exact 40-character commit already on `origin/main`, using the existing `SUPABASE_SERVICE_ROLE_KEY`
secret) runs it as two separate dispatches:

1. **`mode: plan`** — export a fresh snapshot, run the source-only planner, and print the
   eligibility, per-surface counts, and the `apply_digest` to the run summary. It never writes to
   the canonical tables and never uploads the snapshot/plan (they carry private comment bodies).
2. **`mode: apply`** — re-export and re-derive, then import only when the operator typed the exact
   `IMPORT_CARD_COMMENTS` confirm token **and** `expected_apply_digest` (the digest from the
   reviewed plan run) still matches the freshly re-derived digest. That match is the live-data
   drift guard: if the source cards changed between plan and apply, the digests differ and the
   apply is refused before any write. The apply is `APPLIED` only when the receipts, distinct
   canonical ids, and the independent `production_comment_card_import_counts` readback all equal
   the planned count.

The Actions lane still runs inside — not instead of — the owner-approved release window below: the
migrations and Edge Functions must already be deployed (via the pinned-SHA deploy lane) and the
rehearsal green on the same SHA before `mode: apply` is dispatched.

## Separate owner-approved release window

The 2026-07-24/25 window executed steps 1–5; steps 6–7 are **still owed**:

1. database backup and ~~additive migration apply~~ — migration apply **DONE 2026-07-24
   ~22:00Z**: all five
   Slice 4 migrations applied in order via the Supabase SQL editor, pinned to reviewed SHA
   `1738ad3`, each verified by its per-step SQL boolean (`EXECUTION_LOG.md`); the dedicated
   pre-apply database backup was NOT separately taken; the standing Track-B 6-hourly private
   snapshot cadence (PR #840) is the pre-window restore point — recorded as owner-accepted
   residual;
2. ~~exact-source `production-comments`, `production-write`, and `linear-outbound`
   deploy/readback~~ — **DONE 2026-07-24 21:58Z**: deploy run `30129490033`
   (`workflow_dispatch` pinned to `1738ad3`) succeeded with attestation, deploying
   `linear-outbound` → `production-write` → `production-comments` → `production-archive`;
3. ~~a fresh private two-surface snapshot and independently produced manifest~~ — **DONE**: the
   Actions lane re-exported a fresh two-surface snapshot for every dispatch (v1 for the first
   four runs; v2 with the deliverable crosswalk from PR #939 onward — the final READY plan and
   the successful apply both ran on v2);
4. ~~dry plan review with both manifests matching and zero conflicts~~ — **DONE**: plan runs
   `30133665009` and `30138065529` were READY (blocking-conflict-free under the PR #938/#940
   deferral/defect classes);
5. ~~import plus exact counts/crosswalk/readback~~ — **DONE 2026-07-25 01:16Z**: apply run
   `30138142140` (`f42-import-2026-07-25c`), 615 applied / 6,032 deferred / 35 link defects,
   counts readback matched;
6. one existing-root TEST reply and lifecycle drill through the canonical reader/writer, including
   projection, refresh, response-loss retry, second-device conflict/rebase, and exact client
   audience denial/allow — **STILL OWED**; and
7. rollback evidence and private artifact retention — **STILL OWED**.

Client-visible controls remain unavailable until the canonical exact-client reader is deployed and
its tokened TEST drill proves the exact `sxr` card/component/deliverable request, Samples-origin
crosswalk, audience denial/allow, and refresh path. Endpoint self-attestation is not a capability.
F2 `off` or drainer outage is a drain pause:
applicable canonical comment add/edit/delete debt remains ordered and recoverable. It is not
retirement and does not authorize discarding or replaying historical shadow rows.
