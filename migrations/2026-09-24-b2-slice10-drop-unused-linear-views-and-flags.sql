-- ============================================================
-- B2 Slice 10 (first cut): drop the Linear-only objects that have ZERO live
-- callers. docs/ops/B2_LINEAR_CLEANUP_PLAN.md section 2 Slice 10 and the
-- section 4 "Slice 10" entry hold the per-object evidence (measured read-only
-- 2026-09-24 against production).
--
-- Drops four views and deletes two flag rows. Nothing else. Every other Linear
-- object (mirror_outbox, linear_intake_receipts, linear_outbound_cutoff_control,
-- the backup tables, track_b_*, linear_exit_*, the Linear SQL functions, and the
-- flags linear_outbound_enabled / linear_legacy_parity_enabled / prod_authority)
-- is still wired into writes or pinned by a live assert and is NOT touched.
--
--   views   public.linear_deliverable_comment_ids_v1
--           public.linear_deliverables_reconcile_input_v1
--           public.linear_outbound_cutoff_debt_v1
--           public.linear_reconcile_projection_status_v1
--   flags   syncview_runtime_flags: linear_inbound_enabled,
--           linear_outbound_pending_age_alert
--
-- DROP VIEW has no CASCADE on purpose: if anything has started depending on a
-- view since the evidence was taken, the drop refuses and the transaction
-- rolls back instead of taking the dependent with it.
-- No grant or revoke outside the rollback block: dropping a view removes every
-- role's privilege on it (public, anon, authenticated, service_role).
--
-- OWNER: capture the restore kit (plan section 4, Slice 10) and run the
-- pre-flight below FIRST. Apply only if every pre-flight count is as stated.
-- ============================================================

-- ---------- PRE-FLIGHT (read-only; run first, expect the counts shown) ------
-- select v.n,
--   (select count(*) from pg_class c join pg_namespace s on s.oid = c.relnamespace
--     where s.nspname = 'public' and c.relname = v.n and c.relkind = 'v') as view_exists,     -- 1 for each view, 0 for each flag key
--   (select count(*) from pg_depend d join pg_rewrite r on r.oid = d.objid
--     join pg_class c on c.oid = d.refobjid
--     where c.relname = v.n and r.ev_class <> c.oid)                    as dependent_views,  -- 0
--   (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
--     where s.nspname not in ('pg_catalog','information_schema')
--       and p.prosrc ilike '%' || v.n || '%')                           as function_refs,    -- 0
--   (select count(*) from pg_views where definition ilike '%' || v.n || '%') as view_refs,   -- 0
--   (select count(*) from pg_policies
--     where coalesce(qual,'') || coalesce(with_check,'') ilike '%' || v.n || '%') as policy_refs, -- 0
--   (select count(*) from cron.job where command ilike '%' || v.n || '%') as cron_refs,       -- 0
--   (select count(*) from public.syncview_runtime_flags f where f.key = v.n) as flag_rows    -- 0 for views, 1 for each flag key
-- from (values ('linear_deliverable_comment_ids_v1'), ('linear_deliverables_reconcile_input_v1'),
--              ('linear_outbound_cutoff_debt_v1'), ('linear_reconcile_projection_status_v1'),
--              ('linear_inbound_enabled'), ('linear_outbound_pending_age_alert')) v(n);

begin;

drop view public.linear_deliverable_comment_ids_v1;
drop view public.linear_deliverables_reconcile_input_v1;
drop view public.linear_outbound_cutoff_debt_v1;
drop view public.linear_reconcile_projection_status_v1;

delete from public.syncview_runtime_flags
 where key in ('linear_inbound_enabled', 'linear_outbound_pending_age_alert');

commit;

-- ---------- ROLLBACK (definitions exactly as read live 2026-09-24) ----------
-- Every view below was owned by postgres, security_invoker=true, with ACL
-- {postgres=arwdDxtm/postgres, service_role=r/postgres}: no rights for public,
-- anon or authenticated. The helper functions they call
-- (linear_reconcile_event_comment_id, linear_reconcile_compact_raw,
-- linear_reconcile_raw_sha256, linear_outbound_cutoff_debt_rows_v1) are kept
-- live by this migration, so the views recreate as-is.
--
-- begin;
-- create view public.linear_deliverable_comment_ids_v1 with (security_invoker = true) as
--  SELECT e.deliverable_id,
--     extracted.linear_comment_id,
--     max(e.ts) AS latest_ts,
--     (array_agg(e.id ORDER BY e.ts DESC, e.id DESC))[1] AS latest_event_id
--    FROM deliverable_events e
--      CROSS JOIN LATERAL ( SELECT linear_reconcile_event_comment_id(e.payload) AS linear_comment_id) extracted
--   WHERE e.deliverable_id IS NOT NULL AND (e.source = ANY (ARRAY['ui'::text, 'mirror'::text, 'outbound'::text])) AND POSITION(('comment'::text) IN (lower(e.action))) > 0 AND NULLIF(extracted.linear_comment_id, ''::text) IS NOT NULL
--   GROUP BY e.deliverable_id, extracted.linear_comment_id;
--
-- create view public.linear_deliverables_reconcile_input_v1 with (security_invoker = true) as
--  SELECT id, identifier, batch_id, client_slug, team, kind, title, status, status_at,
--     assignee_id, due_date, priority, origin, card_id, created_by, created_at, updated_at,
--     linear_issue_uuid, linear_identifier, linear_issue_url,
--     linear_reconcile_compact_raw(linear_raw) AS linear_raw,
--     linear_reconcile_raw_sha256(linear_raw) AS source_linear_raw_sha256,
--     1::smallint AS projection_version
--    FROM deliverables d;
--
-- create view public.linear_outbound_cutoff_debt_v1 with (security_invoker = true) as
--  SELECT id, status, outbound_generation, disposition
--    FROM linear_outbound_cutoff_debt_rows_v1() linear_outbound_cutoff_debt_rows_v1(id, status, outbound_generation, disposition);
--
-- create view public.linear_reconcile_projection_status_v1 with (security_barrier = true, security_invoker = true) as
--  SELECT 1::smallint AS projection_version,
--     true AS ready,
--     NULL::timestamp with time zone AS ready_at;
--
-- alter view public.linear_deliverable_comment_ids_v1      owner to postgres;
-- alter view public.linear_deliverables_reconcile_input_v1 owner to postgres;
-- alter view public.linear_outbound_cutoff_debt_v1         owner to postgres;
-- alter view public.linear_reconcile_projection_status_v1  owner to postgres;
-- revoke all on table public.linear_deliverable_comment_ids_v1      from public, anon, authenticated, service_role;
-- revoke all on table public.linear_deliverables_reconcile_input_v1 from public, anon, authenticated, service_role;
-- revoke all on table public.linear_outbound_cutoff_debt_v1         from public, anon, authenticated, service_role;
-- revoke all on table public.linear_reconcile_projection_status_v1  from public, anon, authenticated, service_role;
-- grant select on table public.linear_deliverable_comment_ids_v1      to service_role;
-- grant select on table public.linear_deliverables_reconcile_input_v1 to service_role;
-- grant select on table public.linear_outbound_cutoff_debt_v1         to service_role;
-- grant select on table public.linear_reconcile_projection_status_v1  to service_role;
--
-- insert into public.syncview_runtime_flags (key, value, updated_at, updated_by) values
--   ('linear_inbound_enabled',            '{"enabled": false}'::jsonb, '2026-09-23T14:02:01.858898+00:00', 'owner-b2-slice5-inbound-off'),
--   ('linear_outbound_pending_age_alert', '{"minutes": 30}'::jsonb,    '2026-07-13T23:14:27.655292+00:00', 'fix-pack-F16');
-- commit;
-- ============================================================
