# Priority application-schema integration plan

Preparation only. Installation remains HOLD. The nine-table row companion has
isolated synthetic recovery proof; its application schema coverage is separate.

| Table group | Source integration work |
|---|---|
| content_samples | Review schema portion of samples-supabase-migration.sql or equivalent dated baseline DDL. The current bootstrap selects only Calendar/Samples-review statements. Preserve platform roles/realtime requirements. |
| filming_plans | Review 2026-07-09-filming-plans-source.sql. Separate its schema from application seed data explicitly; do not execute seeds in a synthetic rehearsal. |
| thumbnail_media_revisions | Order 2026-07-09-thumbnail-media-revisions.sql before 2026-07-14-thumbnail-revision-v2.sql. Resolve Storage bucket infrastructure, platform roles/realtime, runtime flags, clients and card-table prerequisites. Preserve v2 access and behavior changes. |
| batches_parent_claim_backup_20260824 | No source owner identified. Observed columns alone do not reconstruct defaults, ACLs, constraints or provenance. Keep preservation required; do not manufacture a historical owner. |
| workload_issues; three comment evidence/budget tables; rescue configuration | Owners already inventoried. Use actual catalog comparison before claiming shape equality. |

The next integration must preserve the published inventory identity or explicitly
publish a reviewed successor with its new dependency order and evidence. Do not
silently broaden the existing baseline. Classify schema-only excerpts, platform
scaffolds and complete migration execution separately. Keep application seeds and
configuration values out of public fixtures and evidence.

Acceptance requires the exact nine row/key contracts on the composed application
schema, populated synthetic data satisfying real constraints, authenticated
shared-snapshot capture and combined restricted-target restoration. Exercise
restored triggers/access behavior without provider sends, verify schema and row
identity, and retain negative cases. Any deliberately unsupported owner stays
red. Sequence fencing and referenced object/document custody remain separate.

This source mapping does not establish dependency closure or current hosted
schema equivalence. No merge, deployment or live data operation is authorized.
