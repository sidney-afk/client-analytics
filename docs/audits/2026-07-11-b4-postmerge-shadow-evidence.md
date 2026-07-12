# B4 post-merge and read-only full-roster shadow evidence

Date: 2026-07-11 local / 2026-07-12 UTC

Scope: post-merge verification for B4 outbound PR #797 and a read-only full-roster outbound comparison. This artifact contains aggregates only. Client names, issue identifiers, row-level diffs, and secrets remain in the private evidence bundle.

## Post-merge sanity

- PR #797 merged as `bc83ccee7d6fcb7212a01a57ab08cb678602766a`.
- Active `linear-inbound` version 17 and `linear-outbound` version 14 were downloaded from the linked Supabase project. Their source files match merged `main`; the one non-byte-identical helper matches after CRLF/LF normalization.
- The live B4 migration contract matches `migrations/2026-07-11-b4-linear-outbound.sql`: 20 expected outbox columns, 4 constraints, 4 indexes, the enqueue trigger, outbound event-source support, and all 7 function bodies. The 6 callable RPCs remain service-role only.
- Runtime flags remained at the safe defaults throughout:
  - `linear_outbound_enabled={"mode":"off"}`
  - `prod_authority={"video":"linear","graphics":"linear"}`
  - `linear_inbound_enabled={"enabled":true}`
  - `auth_enforcement={"mode":"permissive"}`
- `mirror_outbox`: 0 pending/failed/shadow rows and 0 real-client written rows. Historical TEST rows remain quarantined evidence.

## Action and pager proof

- Manual outbound-drain Action run `29181125012` completed successfully on the merge commit. Summary event `8995` reported mode `off`, zero writes, zero failures, and zero backlog.
- Harmless summary event `8996` exercised the failed-write tripwire without creating an outbox row or a Linear mutation. Scheduled pager execution `251537` read it, emitted the identifier-only `outbound_failed` condition, and its existing Slack DM node succeeded.
- Harmless summary event `9002` exercised backlog growth (`101`, prior `0`) and one shadow-vs-actual mismatch. Scheduled pager execution `251672` emitted both conditions; both existing Slack DM node items returned success. Concurrent normal drain event `9003` immediately restored the newest summary to mode `off`, zero backlog, zero failures, and zero divergence.
- The pager's source and focused test additionally cover write-volume spike and active-mode staleness without client identity in alert text.

## Read-only all-client comparison

Method: `scripts/b4-outbound-shadow-audit.js` loads the same Supabase and Linear reads as reconciler v2, excludes the TEST client, overrides team authority only in process memory, and calls the pure outbound classifiers. It contains no Supabase mutation helper, RPC call, Edge Function call, or Linear mutation. Before/after safety snapshots must match or the run fails.

Coverage:

| Metric | Count |
|---|---:|
| Active real clients | 32 |
| TEST clients excluded | 1 |
| Entities checked | 5,228 |
| Deliverables checked | 4,227 |
| Batches checked | 1,001 |
| Clients with a divergence | 11 |

Result:

| Team | Entities | Unexpected intended writes |
|---|---:|---:|
| Graphics | 2,217 | 45 |
| Video | 3,011 | 28 |
| **Total** | **5,228** | **73** |

Breakdown: 72 parent operations across 13 historical batch groups, plus 1 batch restore operation. At the time of this run these were unexpected and remained a go-live blocker; they had not yet received the D-27 handling rule.

The first classifier pass also exposed 949 false parent alarms in which a title-matched batch-parent deliverable was being assigned the batch parent as its own parent. The branch fixes that calculation to honor the existing B1 adapter self-parent rule and adds focused coverage. The corrected full run is the 73-count result above.

Zero-write proof from corrected run `b4-shadow-1783835492969`:

- Runtime-flag digest unchanged.
- Outbox row count `181 -> 181`; high-water id `181 -> 181`.
- Pending rows `0 -> 0`; real written rows `0 -> 0`.
- Latest outbound summary id unchanged during the comparison.
- Linear mutation calls: 0.
- Private evidence SHA-256: `f2ed907633047fb9aba3b51037f07b1cba3df00b7fbc24d2c41f8a6994062d4a`.

## D-27 follow-through (2026-07-12)

The owner ratified D-27: outbound never restructures historical work. The implementation defines a
historical entity as one created before `2026-07-12T04:48:56.000Z` **and** carrying at least one
explicit historical signal: `created_by` is `linear-backfill` or
`history-backfill-2026-07-10`, `origin='backfill'`, or the retained Linear `completedAt` predates
the boundary. Only `parent` and `restore` are suppressed. Older active/manual work without a
historical signal, all entities created at/after the boundary, and every other operation remain
writable.

Pre-alignment run `b4-shadow-1783877861264` proved the rule covered exactly the original findings:

- 0 divergences, 0 intended writes, and 0 repairs.
- 73 `tolerated_historical`: 72 parent operations and 1 restore.
- Runtime flags and outbox count/high-water remained unchanged; Linear mutation calls: 0.
- Private evidence SHA-256: `5a5122f82239f4620b18e3b605cbd003a542bc2135e608fef7d44dde40749912`.

The restore evidence showed that Linear was terminal via its canceled state while the SyncView
batch remained active. The batch was aligned to `archived` through `batch_write` with
`source='reconcile'`; no Linear write and no outbox enqueue occurred. The private before/after
snapshots preserve the one-step data rollback.

Post-alignment identical run `b4-shadow-1783878356762` checked 5,227 entities across all 32 real
clients and returned 0 divergences, 0 intended writes, 0 repairs, and 72 historical parent
tolerances. Flags were unchanged; outbox stayed `181 -> 181` with high-water `181`, pending and
real-written counts both stayed 0, and Linear mutation calls were 0. Private evidence SHA-256:
`f0d9cb0fc697a87940f64906113e96fc899261f1d87eef34ced28ab95d394e68`.

Independent reconciler v2 dry-run summary event `9145` then ended at diff 0 / repair 0 / linkage
actionable 0 with no healing attempted.

## Gate decision

The D-27 read-only rerun criterion is passed. No runtime flag moved and no production authority
window was used. The real all-client shadow observation window remains an explicit owner gate and
must still follow the documented switch order and watcher checks.

## Post-merge dark deployment (2026-07-12)

- PR #800 merged as `bdd94c8bb3f8dda3712c1cbe829738cf5484f80e`. The prior active
  `linear-outbound` version 14 was downloaded and hash-verified privately before deployment.
- `linear-outbound` version 15 is active with JWT verification unchanged. Downloaded `index.ts`
  and `mapping.mjs` match merged `main` after line-ending normalization; the deployed bundle
  contains the shared D-27 boundary, `historicalWriteDisposition`, and the drainer skip guard.
- Live privilege inspection reconfirmed all six write/outbox RPCs are executable by
  `service_role` only, not `anon`, `authenticated`, or `public`.
- Post-deploy read-only run `b4-shadow-1783880138781` checked 5,227 entities across all 32 real
  clients: 0 divergences, 0 intended writes, 0 repairs, and 72 `tolerated_historical` parent
  operations. Flags and outbox stayed unchanged; Linear mutation calls were 0. Private evidence
  SHA-256: `2145b47663cea92e46789a596be69efe4fe980f348118387a050cc2efcd2f51a`.
- Normal drainer Action `29203552968` completed green and wrote event `9152`: mode `off`, zero
  writes/failures/backlog, and no alert condition. Reconciler event `9149` remained diff 0 /
  repair 0 / linkage actionable 0.
- Final readback remained outbound off, authority Linear/Linear, inbound enabled, auth
  permissive; outbox remained 181 total/high-water, 0 pending, and 0 real written.

## Go-live step 1: bounded deployed shadow window (2026-07-12)

The first fail-closed attempt restored all controls before invoking the drainer because the global
reconciler reported 112 historical tolerances rather than the 72 active-roster expectation. A
read-only scope analysis proved the difference was exactly 72 active-client rows plus 40 inactive
internal rows; there were still 0 diffs and 0 intended writes. Flip ids 16–19 record the opening
and immediate safe restoration of that diagnostic attempt.

The corrected bounded run used flip ids 20–23 and kept both-team SyncView authority open for
146.945 seconds. Results:

- Shadow reconciler event `9161` checked 5,336 globally loaded entities and returned 0 outbound
  diffs/intended writes, 72 active-roster `tolerated_historical`, and 40 separately classified
  inactive/internal tolerances.
- Deployed drainer event `9162` ran in `shadow`: 0 enqueued, shadow-ok, written, failed, retried,
  skipped, stale, or mismatched rows; backlog 0.
- There were 0 outbound echo drops and 0 mirror events during the window.
- Authority was restored to Linear/Linear before outbound returned to `off`. Outbox remained 181
  total/high-water, 0 pending, and 0 real written.
- Post-window reconciler event `9163` ended diff 0 / repair 0 / linkage actionable 0.

Private evidence SHA-256: `13cd9162a00a285393460cf30817d74390316c7bd1b26f04c67c263669d8930b`.
The live-write flip remains blocked pending reviewer go/no-go.

## Go-live step 2: all-client live outbound (2026-07-12)

After reviewer go-ahead, authority moved to SyncView for both teams (flip id 24) while outbound
was still off, then outbound moved to `live` (flip id 25). Immediate event `9171`, manual Actions
run `29206107017` / event `9172`, and pager-triggered event `9175` were all live-mode clean:
0 enqueued, written, failed, backlog, echo, or shadow mismatch.

Reconciler event `9174` checked 5,336 entities under SyncView authority and returned 0 inbound or
outbound diffs, 0 repairs, 0 actionable linkage, and the expected 112 historical tolerances (72
active-roster plus 40 inactive/internal). The first post-cutover n8n pager execution `256097`
completed successfully, triggered and fetched the outbound summary, and produced zero alert items.
No owner DM or team message was sent.

Final readback: outbound `live`, authority SyncView/SyncView, inbound enabled in detect-only mode,
auth permissive, and outbox 181 total/high-water with 0 pending and 0 real written. Private
evidence SHA-256: `0c254f54786ab144168235cc55b7d2bcbc8a407e1e4a1f10fedcc7cfc2f29bfe`.
