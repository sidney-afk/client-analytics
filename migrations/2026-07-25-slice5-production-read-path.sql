-- F95 read-path fix (Slice 5): make the Production browser projection cheap
-- enough that a foreground refresh loop can exist at all.
--
-- WHY. A 2026-07-25 read-only anon timing probe against the live endpoint found
-- that `production_deliverables_browser_v1` costs ~1.2 s of upstream time per
-- 1000-row page over ~4,612 rows, and that the cost is neither the ORDER BY nor
-- the Workload label lateral:
--
--   full 43-column projection + ORDER BY team,status,due_date   1196 ms
--   full 43-column projection + ORDER BY id                     1188 ms
--   base scalar columns only (no raw_*) + same ORDER BY           33 ms
--   two columns (id,status) + same ORDER BY                       14 ms
--   raw_*/identity_repair_* columns only                        1165 ms
--   0 / 1 / 24 raw_* columns under the same ORDER BY        16 / 224 / 1216 ms
--
-- The cost is linear in the number of separate `linear_raw #>> ...` extractions:
-- each one detoasts the row's Linear document again. Twenty-four extractions per
-- row is the whole bill. Because ORDER BY forces every page to project the whole
-- relation, one boot spends ~5.9 s of database time across five pages, four of
-- which the browser used to issue concurrently — which is what pushed anon reads
-- past the statement timeout (57014 / HTTP 500).
--
-- WHAT. This migration replaces the view body so each row detoasts once: a
-- `jsonb_to_record` lateral resolves the four top-level Linear subtrees, and
-- every projected column is derived from those already-materialised values.
-- Column names, order, types, and the exact accepted-value guards are unchanged;
-- the Workload label lateral is left byte-identical so its completeness contract
-- (including the `labelIds` cross-check) is untouched. The planner still prunes
-- that lateral when its two columns are not selected, which is the browser case.
--
-- The `jsonb_typeof(...) = 'object'` guard is required, not defensive noise: a
-- variant without it errors with `cannot call populate_composite on a scalar`
-- the moment any row holds a JSON scalar/array in `linear_raw`.
--
-- MEASURED RESULT (offline PostgreSQL 16.13, 4,626 synthetic rows sized to
-- reproduce the live per-row cost; no real row, identity, URL, or token used):
--
--   query                          current view    this view
--   full projection, page 0          951.8 ms      312.5 ms   3.0x
--   full projection, page 4 (o4000)  959.6 ms      317.6 ms   3.0x
--   updated_at delta window (26 rows)  6.9 ms        3.2 ms   2.2x
--   two columns (id,status)            4.4 ms       80.4 ms   see note
--
-- Note: the function scan cannot be pruned the way a bare expression can, so a
-- deliberately slim SELECT pays a fixed ~80 ms over the whole relation instead
-- of ~4 ms. No shipped caller does a slim unfiltered select of this view (the
-- browser reads the full projection; every other reader is service-role), and
-- 80 ms is far below the page cost either view pays, so the trade is accepted
-- and recorded here rather than hidden.
--
-- EQUIVALENCE. Both directions of `EXCEPT ALL` over all 43 browser columns, and
-- over the two Workload label columns, return zero rows against the current
-- definition across 4,626 rows — 4,612 realistic rows plus 14 adversarial ones
-- (NULL, JSON null, string, number, array, empty object, non-object subtrees,
-- JSON-null subtrees, wrong scalar types, unmatched regex guards, and the three
-- label completeness shapes).
--
-- REJECTED CANDIDATE. A composite index on deliverables(team, status, due_date)
-- was measured and does not help: the planner keeps the sequential scan (the
-- sort of 4.6k rows costs ~16 ms) and the page still costs ~1.28 s, because the
-- cost is projection, not ordering. It is deliberately not created here.
--
-- SAFETY. `create or replace view` keeps the same column names, order, and
-- types, so it is a catalog update with no table rewrite, no data movement, and
-- no grant change; existing SELECT grants and the security_barrier property are
-- preserved. The `updated_at` index below is additive and concurrently-safe to
-- drop. This file changes no table data, no column, no runtime flag, no
-- authority value, no n8n workflow, and neither frozen writer
-- (`calendar-upsert`, `sample-review-upsert`).
--
-- This file is SOURCE-ONLY until a separate owner-approved live window records
-- its application in `EXECUTION_LOG.md`.

begin;

create or replace view public.production_deliverables_browser_v1
with (security_barrier = true)
as
select
  d.id,
  d.identifier,
  d.batch_id,
  d.client_slug,
  d.team,
  d.kind,
  d.title,
  d.status,
  d.status_at,
  d.assignee_id,
  d.due_date,
  d.origin,
  d.card_id,
  d.sync_state,
  d.created_at,
  d.updated_at,
  d.artifact_revision,
  d.linear_issue_uuid,
  d.linear_identifier,
  d.linear_issue_url,
  case when root.identity_repair ->> 'state' in ('required', 'resolved') then root.identity_repair ->> 'state' end as identity_repair_state,
  case when root.identity_repair ->> 'reason' ~ '^[a-z][a-z0-9_]{0,79}$' then root.identity_repair ->> 'reason' end as identity_repair_reason,
  case when root.identity_repair ->> 'resolved_linear_issue_id' ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$'
    then root.identity_repair ->> 'resolved_linear_issue_id' end as identity_repair_resolved_linear_issue_id,
  case when root.issue -> 'parent' ->> 'id' ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$'
    then root.issue -> 'parent' ->> 'id' end as raw_issue_parent_id,
  case when root.issue -> 'project' ->> 'id' ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$'
    then root.issue -> 'project' ->> 'id' end as raw_project_id,
  case when root.attribution ->> 'schema' = 'syncview_attribution_v1'
    then 'syncview_attribution_v1' end as raw_attribution_schema,
  case when root.attribution ->> 'state' in (
      'resolved', 'needs_attribution', 'provisional_child_family', 'conflict'
    ) then root.attribution ->> 'state' end as raw_attribution_state,
  case when root.attribution ->> 'client_slug' ~ '^[a-z0-9][a-z0-9_-]{0,99}$'
    then root.attribution ->> 'client_slug' end as raw_attribution_client_slug,
  case when root.attribution ->> 'owner_kind' in ('client', 'internal', 'test')
    then root.attribution ->> 'owner_kind' end as raw_attribution_owner_kind,
  case when root.attribution ->> 'source' in (
      'direct_project', 'nearest_mapped_ancestor',
      'explicit_roster_classification', 'explicit_internal_test_classification',
      'unanimous_child_family', 'none', 'conflict'
    ) then root.attribution ->> 'source' end as raw_attribution_source,
  case when root.attribution ->> 'provisional_client_slug' ~ '^[a-z0-9][a-z0-9_-]{0,99}$'
    then root.attribution ->> 'provisional_client_slug' end as raw_attribution_provisional_client_slug,
  case when root.attribution ->> 'mapping_revision' ~ '^[a-f0-9]{64}$'
    then root.attribution ->> 'mapping_revision' end as raw_attribution_mapping_revision,
  case when jsonb_typeof(root.attribution -> 'repair_required') = 'boolean'
    then (root.attribution -> 'repair_required' #>> '{}')::boolean end as raw_attribution_repair_required,
  case when root.attribution ->> 'reason' ~ '^[a-z][a-z0-9_]{0,79}$' then root.attribution ->> 'reason' end as raw_attribution_reason,
  case when jsonb_typeof(root.attribution -> 'explicit_owner_approved') = 'boolean'
    then (root.attribution -> 'explicit_owner_approved' #>> '{}')::boolean end as raw_attribution_explicit_owner_approved,
  coalesce(root.attribution ->> 'explicit_decision_ref' ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$', false)
    as raw_attribution_has_explicit_decision_ref,
  case when root.attribution ->> 'explicit_manifest_sha256' ~ '^[a-f0-9]{64}$'
    then root.attribution ->> 'explicit_manifest_sha256' end as raw_attribution_explicit_manifest_sha256,
  case when root.issue ->> 'archivedAt'
      ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?Z$'
    then root.issue ->> 'archivedAt' end as raw_issue_archived_at,
  case when root.issue ->> 'canceledAt'
      ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?Z$'
    then root.issue ->> 'canceledAt' end as raw_issue_canceled_at,
  case when jsonb_typeof(root.webhook_delete) = 'boolean'
    then (root.webhook_delete #>> '{}')::boolean end as raw_webhook_delete,
  case when jsonb_typeof(root.deleted) = 'boolean'
    then (root.deleted #>> '{}')::boolean end as raw_deleted,
  case when jsonb_typeof(root."delete") = 'boolean'
    then (root."delete" #>> '{}')::boolean end as raw_delete,
  case when jsonb_typeof(root.removed) = 'boolean'
    then (root.removed #>> '{}')::boolean end as raw_removed,
  case when jsonb_typeof(root.archived) = 'boolean'
    then (root.archived #>> '{}')::boolean end as raw_archived,
  (wl.projection->>'complete')::boolean as workload_labels_complete,
  wl.projection->'labels' as workload_labels
from public.deliverables d
cross join lateral jsonb_to_record(
  case when jsonb_typeof(d.linear_raw) = 'object' then d.linear_raw else '{}'::jsonb end
) as root(
  issue jsonb,
  attribution jsonb,
  identity_repair jsonb,
  webhook_delete jsonb,
  deleted jsonb,
  "delete" jsonb,
  removed jsonb,
  archived jsonb
)
cross join lateral (
  select public.production_workload_label_projection(d.linear_raw) as projection
) wl;

-- F95 delta refresh: the foreground loop asks only for rows at or after the
-- watermark it already holds. At the current 4.6k rows that predicate is a
-- sequential scan (measured 4.8 ms); with this index it is an index scan
-- (measured 1.1 ms) and stays O(changed rows) as the mirror grows. Additive and
-- independently reversible: `drop index if exists public.deliverables_updated_at_idx;`
create index if not exists deliverables_updated_at_idx
  on public.deliverables (updated_at);

commit;

-- Owner-only rollback (restores the previous extraction mechanism byte for byte
-- from migrations/2026-07-23-f34-f53-production-attachments.sql, which remains
-- the source of that definition):
--
--   begin;
--   drop index if exists public.deliverables_updated_at_idx;
--   -- then re-run the `create view public.production_deliverables_browser_v1`
--   -- statement from 2026-07-23-f34-f53-production-attachments.sql, changed to
--   -- `create or replace view`.
--   commit;
