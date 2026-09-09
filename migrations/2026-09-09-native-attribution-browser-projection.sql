-- Native persisted-attribution projection widening.
--
-- Adds only bounded native evidence to the existing browser view: the source
-- allowlist admits the two epoch-bound native intake sources. `project_id` is
-- exposed only as either a strict synthetic native id or a bounded retained
-- legacy project id. The browser verifies either value against the active
-- client's exact per-team mapping; no synthetic id enters the Linear resolver.
--
-- Apply after 2026-08-23-attribution-slug-guard-widening.sql and
-- 2026-09-09-native-client-provisioning.sql.  This is source-only; it creates
-- no client and changes no authority or routing flag.

begin;

create or replace view public.production_deliverables_browser_v1 as
SELECT d.id,
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
        CASE
            WHEN ((root.identity_repair ->> 'state'::text) = ANY (ARRAY['required'::text, 'resolved'::text])) THEN (root.identity_repair ->> 'state'::text)
            ELSE NULL::text
        END AS identity_repair_state,
        CASE
            WHEN ((root.identity_repair ->> 'reason'::text) ~ '^[a-z][a-z0-9_]{0,79}$'::text) THEN (root.identity_repair ->> 'reason'::text)
            ELSE NULL::text
        END AS identity_repair_reason,
        CASE
            WHEN ((root.identity_repair ->> 'resolved_linear_issue_id'::text) ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$'::text) THEN (root.identity_repair ->> 'resolved_linear_issue_id'::text)
            ELSE NULL::text
        END AS identity_repair_resolved_linear_issue_id,
        CASE
            WHEN (((root.issue -> 'parent'::text) ->> 'id'::text) ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$'::text) THEN ((root.issue -> 'parent'::text) ->> 'id'::text)
            ELSE NULL::text
        END AS raw_issue_parent_id,
        CASE
            WHEN (((root.issue -> 'project'::text) ->> 'id'::text) ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$'::text) THEN ((root.issue -> 'project'::text) ->> 'id'::text)
            ELSE NULL::text
        END AS raw_project_id,
        CASE
            WHEN ((root.attribution ->> 'schema'::text) = 'syncview_attribution_v1'::text) THEN 'syncview_attribution_v1'::text
            ELSE NULL::text
        END AS raw_attribution_schema,
        CASE
            WHEN ((root.attribution ->> 'state'::text) = ANY (ARRAY['resolved'::text, 'needs_attribution'::text, 'provisional_child_family'::text, 'conflict'::text])) THEN (root.attribution ->> 'state'::text)
            ELSE NULL::text
        END AS raw_attribution_state,
        CASE
            WHEN ((root.attribution ->> 'client_slug'::text) ~ '^[a-z0-9][a-z0-9_&-]{0,99}$'::text) THEN (root.attribution ->> 'client_slug'::text)
            ELSE NULL::text
        END AS raw_attribution_client_slug,
        CASE
            WHEN ((root.attribution ->> 'owner_kind'::text) = ANY (ARRAY['client'::text, 'internal'::text, 'test'::text])) THEN (root.attribution ->> 'owner_kind'::text)
            ELSE NULL::text
        END AS raw_attribution_owner_kind,
        CASE
            WHEN ((root.attribution ->> 'source'::text) = ANY (ARRAY['direct_project'::text, 'nearest_mapped_ancestor'::text, 'native_intake_project'::text, 'native_intake_legacy_project'::text, 'explicit_roster_classification'::text, 'explicit_internal_test_classification'::text, 'unanimous_child_family'::text, 'none'::text, 'conflict'::text])) THEN (root.attribution ->> 'source'::text)
            ELSE NULL::text
        END AS raw_attribution_source,
        CASE
            WHEN ((root.attribution ->> 'provisional_client_slug'::text) ~ '^[a-z0-9][a-z0-9_&-]{0,99}$'::text) THEN (root.attribution ->> 'provisional_client_slug'::text)
            ELSE NULL::text
        END AS raw_attribution_provisional_client_slug,
        CASE
            WHEN ((root.attribution ->> 'mapping_revision'::text) ~ '^[a-f0-9]{64}$'::text) THEN (root.attribution ->> 'mapping_revision'::text)
            ELSE NULL::text
        END AS raw_attribution_mapping_revision,
        CASE
            WHEN (jsonb_typeof((root.attribution -> 'repair_required'::text)) = 'boolean'::text) THEN (((root.attribution -> 'repair_required'::text) #>> '{}'::text[]))::boolean
            ELSE NULL::boolean
        END AS raw_attribution_repair_required,
        CASE
            WHEN ((root.attribution ->> 'reason'::text) ~ '^[a-z][a-z0-9_]{0,79}$'::text) THEN (root.attribution ->> 'reason'::text)
            ELSE NULL::text
        END AS raw_attribution_reason,
        CASE
            WHEN (jsonb_typeof((root.attribution -> 'explicit_owner_approved'::text)) = 'boolean'::text) THEN (((root.attribution -> 'explicit_owner_approved'::text) #>> '{}'::text[]))::boolean
            ELSE NULL::boolean
        END AS raw_attribution_explicit_owner_approved,
    COALESCE(((root.attribution ->> 'explicit_decision_ref'::text) ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$'::text), false) AS raw_attribution_has_explicit_decision_ref,
        CASE
            WHEN ((root.attribution ->> 'explicit_manifest_sha256'::text) ~ '^[a-f0-9]{64}$'::text) THEN (root.attribution ->> 'explicit_manifest_sha256'::text)
            ELSE NULL::text
        END AS raw_attribution_explicit_manifest_sha256,
        CASE
            WHEN ((root.issue ->> 'archivedAt'::text) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?Z$'::text) THEN (root.issue ->> 'archivedAt'::text)
            ELSE NULL::text
        END AS raw_issue_archived_at,
        CASE
            WHEN ((root.issue ->> 'canceledAt'::text) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?Z$'::text) THEN (root.issue ->> 'canceledAt'::text)
            ELSE NULL::text
        END AS raw_issue_canceled_at,
        CASE
            WHEN (jsonb_typeof(root.webhook_delete) = 'boolean'::text) THEN ((root.webhook_delete #>> '{}'::text[]))::boolean
            ELSE NULL::boolean
        END AS raw_webhook_delete,
        CASE
            WHEN (jsonb_typeof(root.deleted) = 'boolean'::text) THEN ((root.deleted #>> '{}'::text[]))::boolean
            ELSE NULL::boolean
        END AS raw_deleted,
        CASE
            WHEN (jsonb_typeof(root.delete) = 'boolean'::text) THEN ((root.delete #>> '{}'::text[]))::boolean
            ELSE NULL::boolean
        END AS raw_delete,
        CASE
            WHEN (jsonb_typeof(root.removed) = 'boolean'::text) THEN ((root.removed #>> '{}'::text[]))::boolean
            ELSE NULL::boolean
        END AS raw_removed,
        CASE
            WHEN (jsonb_typeof(root.archived) = 'boolean'::text) THEN ((root.archived #>> '{}'::text[]))::boolean
            ELSE NULL::boolean
        END AS raw_archived,
    ((wl.projection ->> 'complete'::text))::boolean AS workload_labels_complete,
    (wl.projection -> 'labels'::text) AS workload_labels,
        CASE
            WHEN (root.attribution ->> 'source'::text) = 'native_intake_project'::text
              AND ((root.attribution ->> 'project_id'::text) ~ '^svproj_(video|graphics)_[a-f0-9]{32}$'::text) THEN (root.attribution ->> 'project_id'::text)
            WHEN (root.attribution ->> 'source'::text) = 'native_intake_legacy_project'::text
              AND ((root.attribution ->> 'project_id'::text) ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'::text) THEN (root.attribution ->> 'project_id'::text)
            ELSE NULL::text
    END AS raw_attribution_project_id,
    CASE
        WHEN ((root.attribution ->> 'native_epoch'::text) ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'::text) THEN (root.attribution ->> 'native_epoch'::text)
        ELSE NULL::text
    END AS raw_attribution_native_epoch
   FROM ((deliverables d
     CROSS JOIN LATERAL jsonb_to_record(
        CASE
            WHEN (jsonb_typeof(d.linear_raw) = 'object'::text) THEN d.linear_raw
            ELSE '{}'::jsonb
        END) root(issue jsonb, attribution jsonb, identity_repair jsonb, webhook_delete jsonb, deleted jsonb, delete jsonb, removed jsonb, archived jsonb))
     CROSS JOIN LATERAL ( SELECT production_workload_label_projection(d.linear_raw) AS projection) wl);

alter view public.production_deliverables_browser_v1 set (security_barrier = true);

grant select on public.production_deliverables_browser_v1 to anon;
grant select on public.production_deliverables_browser_v1 to authenticated;

-- The guard must admit every slug the roster actually holds. If it does not,
-- this migration is wrong and must not commit.
do $$
declare
  offending int;
begin
  select count(*) into offending
    from public.clients
   where active = true
     and slug !~ '^[a-z0-9][a-z0-9_&-]{0,99}$';
  if offending > 0 then
    raise exception
      'the widened slug guard still rejects % active roster slug(s); widen it or normalise the roster before applying',
      offending;
  end if;
end $$;

commit;
