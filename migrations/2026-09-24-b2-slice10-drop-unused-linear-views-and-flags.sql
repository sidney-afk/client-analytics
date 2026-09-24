-- ============================================================
-- B2 Slice 10 (first cut): drop the Linear-only objects that have ZERO live
-- callers. docs/ops/B2_LINEAR_CLEANUP_PLAN.md section 2 Slice 10 and the
-- section 4 "Slice 10" entry hold the per-object evidence (measured read-only
-- 2026-09-24 against production).
--
-- Drops ONE view and deletes two flag rows. Nothing else. (The filename says
-- "views" because the first draft dropped four; review narrowed it on
-- 2026-09-24: linear_deliverable_comment_ids_v1,
-- linear_deliverables_reconcile_input_v1 and
-- linear_reconcile_projection_status_v1 are still read by
-- scripts/linear-deliverables-reconcile.js, which the dispatch-only
-- monitoring-cutover-proof.yml write drill and linear-deliverables-reconcile.yml
-- run, so they are KEPT; see the plan's KEEP table.) Every other Linear object
-- (mirror_outbox, linear_intake_receipts, linear_outbound_cutoff_control,
-- the backup tables, track_b_*, linear_exit_*, the Linear SQL functions, and the
-- flags linear_outbound_enabled / linear_legacy_parity_enabled / prod_authority)
-- is still wired into writes or pinned by a live assert and is NOT touched.
--
--   view    public.linear_outbound_cutoff_debt_v1
--   flags   syncview_runtime_flags: linear_inbound_enabled,
--           linear_outbound_pending_age_alert
--
-- DROP VIEW has no CASCADE on purpose: if anything has started depending on the
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
--     where s.nspname = 'public' and c.relname = v.n and c.relkind = 'v') as view_exists,     -- 1 for the view, 0 for each flag key
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
--   (select count(*) from public.syncview_runtime_flags f where f.key = v.n) as flag_rows    -- 0 for the view, 1 for each flag key
-- from (values ('linear_outbound_cutoff_debt_v1'),
--              ('linear_inbound_enabled'), ('linear_outbound_pending_age_alert')) v(n);

begin;

drop view public.linear_outbound_cutoff_debt_v1;

delete from public.syncview_runtime_flags
 where key in ('linear_inbound_enabled', 'linear_outbound_pending_age_alert');

commit;

-- ---------- ROLLBACK (definition exactly as read live 2026-09-24) ----------
-- Only the one dropped view and the two flag rows are restored here; the three
-- reconcile views are not dropped by this migration, so none of their
-- definitions is needed. The view was owned by postgres, security_invoker=true,
-- with ACL {postgres=arwdDxtm/postgres, service_role=r/postgres}: no rights for
-- public, anon or authenticated. The helper function it calls
-- (linear_outbound_cutoff_debt_rows_v1) is kept live by this migration, so the
-- view recreates as-is.
--
-- begin;
-- create view public.linear_outbound_cutoff_debt_v1 with (security_invoker = true) as
--  SELECT id, status, outbound_generation, disposition
--    FROM linear_outbound_cutoff_debt_rows_v1() linear_outbound_cutoff_debt_rows_v1(id, status, outbound_generation, disposition);
--
-- alter view public.linear_outbound_cutoff_debt_v1 owner to postgres;
-- revoke all on table public.linear_outbound_cutoff_debt_v1 from public, anon, authenticated, service_role;
-- grant select on table public.linear_outbound_cutoff_debt_v1 to service_role;
--
-- insert into public.syncview_runtime_flags (key, value, updated_at, updated_by) values
--   ('linear_inbound_enabled',            '{"enabled": false}'::jsonb, '2026-09-23T14:02:01.858898+00:00', 'owner-b2-slice5-inbound-off'),
--   ('linear_outbound_pending_age_alert', '{"minutes": 30}'::jsonb,    '2026-07-13T23:14:27.655292+00:00', 'fix-pack-F16');
-- commit;
-- ============================================================
