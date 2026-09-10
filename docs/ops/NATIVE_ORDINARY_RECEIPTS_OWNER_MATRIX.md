# Native ordinary receipt owner matrix

The native capability remains `provider` by default. Retirement activation remains blocked until the PostgreSQL proof listed below passes.

| Gateway operation | Owning SQL path | Receipt disposition | Evidence |
| --- | --- | --- | --- |
| status, due, title, priority, archive, restore, parent, deliverable description | `production_deliverable_write` | Typed `mirror_outbox` native receipt in native epoch | `migrations/2026-09-09-native-ordinary-receipts.sql` |
| attachment | `production_artifact_write` then `production_deliverable_write` | Same typed receipt; artifact projection is in the transaction | `migrations/2026-09-05-artifact-card-binding-first.sql:200` |
| assignee | `production_assignee_write` | Existing separate assignment epoch/receipt | `migrations/2026-09-06-native-existing-assignment.sql` |
| labels | `production_labels_write` | Existing separate catalog receipt | `migrations/2026-09-06-native-label-writes.sql` |
| comment add/reply | `production_comment_write` | Typed `mirror_outbox` native receipt | `migrations/2026-09-09-native-ordinary-receipts.sql` |
| comment edit/delete/resolve/unresolve | `production_comment_lifecycle_write` | Typed receipt; native resolve/unresolve adds a terminal completion row while provider mode retains no outbox row | `migrations/2026-09-12-native-ordinary-envelope-repair.sql` |
| other batch entity operations | Gateway refusal | Unsupported; `production_batch_write` retains its prior behavior and cannot mint an ordinary receipt | `supabase/functions/production-write/index.ts:5783-5785` |
| batch create/intake | intake root/append owners | Existing intake receipt; excluded from ordinary contract | `migrations/2026-09-05-native-only-intake.sql` |
| batch description | `production_batch_description_write` | **Native no-outbox exemption.** It persists its locked CAS row and event but deliberately has no Linear counterpart, no provider-shaped receipt, and no retirement-gate dependency. | `supabase/functions/production-write/index.ts:5226-5239`; `migrations/2026-09-01-batch-description-cas-timestamptz.sql:123-255` |
| batch asset | `production_batch_asset_write` | **Native no-outbox exemption.** Same no-Linear contract. | `supabase/functions/production-write/index.ts:5041-5200` |

Before setting any team capability to `native`, run a disposable PostgreSQL proof against the applied migrations. It must cover every typed row above, provider TEST and legacy-parity compatibility, deferred admission FK commit/rollback, exact replay, changed-identity conflicts, lifecycle future-clock clamp, F27 hold/generation failure, and the gateway’s no-drain/no-Linear behavior. No source-only check authorizes activation.
