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

Breakdown: 72 parent operations across 13 historical batch groups, plus 1 batch restore operation. These are unexpected and remain a go-live blocker; they were not reclassified as tolerated.

The first classifier pass also exposed 949 false parent alarms in which a title-matched batch-parent deliverable was being assigned the batch parent as its own parent. The branch fixes that calculation to honor the existing B1 adapter self-parent rule and adds focused coverage. The corrected full run is the 73-count result above.

Zero-write proof from corrected run `b4-shadow-1783835492969`:

- Runtime-flag digest unchanged.
- Outbox row count `181 -> 181`; high-water id `181 -> 181`.
- Pending rows `0 -> 0`; real written rows `0 -> 0`.
- Latest outbound summary id unchanged during the comparison.
- Linear mutation calls: 0.
- Private evidence SHA-256: `f2ed907633047fb9aba3b51037f07b1cba3df00b7fbc24d2c41f8a6994062d4a`.

## Gate decision

No runtime flag moved and no production authority window was needed. The owner-controlled authority flip must remain blocked until the 72 historical parent differences and the single archived-parent difference receive an explicit handling rule, the reconciler fix is merged, and the same read-only full-roster comparison returns no unexpected intended writes.
