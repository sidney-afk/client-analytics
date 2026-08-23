-- 2026-08-23 — the browser read path stops dropping a real roster slug
--
-- WHAT WAS WRONG
--
-- `production_deliverables_browser_v1` sanitises `raw_attribution_client_slug`
-- behind a hand-written pattern, `^[a-z0-9][a-z0-9_-]{0,99}$`, and returns NULL
-- when a value fails it. One ACTIVE roster slug contains a character that
-- pattern does not admit, so every one of that client's 147 deliverables
-- reached the browser carrying `raw_attribution_state = 'resolved'` and NO
-- slug -- while the very same view passed `d.client_slug` through two dozen
-- columns earlier with no guard at all. The sanitiser disagreed with the roster
-- it was sanitising.
--
-- Downstream, `_prodResolveAttributions` compares the persisted slug against
-- the slug today's project mapping produces and calls a mismatch a conflict.
-- Absence read as mismatch: all 147 rows were stamped
-- `persisted_resolved_client_disagrees_with_current_mapping`, the family
-- fixpoint propagated `hierarchy_conflict_propagated` to every relative, and
-- 147 rows went read-only and mis-grouped behind a "Client attribution conflict"
-- banner that described nothing real. 147 of the 176 conflict banners in the
-- app were this one regex. (The other 29 are genuine cross-client families and
-- a stale invalidation; both are data decisions, not code.)
--
-- WHAT THIS CHANGES
--
-- Exactly two characters, in exactly two guards: the character class gains `&`,
-- in `raw_attribution_client_slug` and in `raw_attribution_provisional_client_slug`.
-- Nothing else in the view moves -- the body below is `pg_get_viewdef` of the
-- LIVE view as of 2026-08-23, with those two literals replaced, so a diff
-- against the live definition is two lines. Column names, order and types are
-- unchanged, which is what lets `create or replace` work at all.
--
-- `&` is the minimal widening: of the 38 active roster slugs, exactly one fails
-- the current guard and it fails on `&` alone. No roster slug contains `.`, so
-- the class is not widened to admit one.
--
-- WHY THE GUARD IS NOT SIMPLY DERIVED FROM `clients.slug`. That is the better
-- shape and it is deliberately not taken here: this view is `security_barrier`
-- and is read with the anon key, so joining the roster into it is a grant
-- decision, not a formatting one. Widening the literal is the narrow fix; the
-- derived guard is a separate proposal with a separate blast radius.
--
-- SAFETY
--
-- Read-path only. `create or replace view` preserves the view's ACL and its
-- `security_barrier` reloption; both are re-asserted below anyway so this file
-- is self-describing. No table is touched, no row is written, no flag or
-- authority value moves. Re-running it is a no-op.
--
-- The assertion at the end is the point of applying this at all: it fails the
-- transaction if ANY active roster slug still fails the widened guard, so the
-- sanitiser can never again quietly disagree with the roster. That check reads
-- live client rows, which is why it lives here and not in a repository test --
-- this is a public repo and no roster slug belongs in it.

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
            WHEN ((root.attribution ->> 'source'::text) = ANY (ARRAY['direct_project'::text, 'nearest_mapped_ancestor'::text, 'explicit_roster_classification'::text, 'explicit_internal_test_classification'::text, 'unanimous_child_family'::text, 'none'::text, 'conflict'::text])) THEN (root.attribution ->> 'source'::text)
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
    (wl.projection -> 'labels'::text) AS workload_labels
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

-- PRE-APPLY PROOF, taken 2026-08-23 against the LIVE database with zero
-- permanent change: the body below was instantiated as a TEMPORARY view (which
-- dies with the session) and compared row-for-row against the live view.
--
--   live rows                              5316
--   probe rows                             5316
--   live  resolved-with-no-slug             147
--   probe resolved-with-no-slug               0
--   symmetric difference (EXCEPT ALL both ways)  294 rows = the same 147 rows,
--                                          once in each direction
--   columns                                  46, unchanged
--
-- 294 is the whole blast radius: 147 rows change, in one column, and every
-- other row and column in the view is byte-identical.
--
-- READBACK (run after commit; expect resolved_rows_with_no_slug = 0)
--
--   select count(*) filter (where raw_attribution_state = 'resolved'
--                             and raw_attribution_client_slug is null)
--            as resolved_rows_with_no_slug,
--          count(*) as total_rows
--     from public.production_deliverables_browser_v1;
--
-- Before applying, that first number is 147.
