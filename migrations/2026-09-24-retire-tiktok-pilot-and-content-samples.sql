-- ============================================================
-- NOT APPLIED -- proposal for Lighthouse to review and apply.
-- Retire four dead tables (owner decision 2026-09-24,
-- docs/audits/2026-09-24-feature-usage.md, OPEN_REPAIRS 252):
-- tiktok_accounts, tiktok_oauth_state, tiktok_pilot_posts, content_samples.
--
-- Measured live 2026-09-24: rows 1 / 10 / 2 / 29; no views and no
-- foreign keys depend on them.
--
-- METHOD (changed in review): the tables are MOVED, not copied and dropped.
-- ALTER TABLE ... SET SCHEMA keeps every row plus the primary and unique keys,
-- defaults, checks, indexes, triggers and policies, so the exact inverse
-- is the .ROLLBACK.sql beside this file. The originals are gone from
-- `public`. The backup schema is revoked from all four roles.
--
-- APPLY GATE. The transaction aborts before touching anything unless:
--  A. (checked in SQL) public.production_retirement_contract_assert_v1()
--     no longer names any of the four tables;
--  B. (receipt) the applier sets syncview.retire_20260924_receipts = 'verified'
--     in the same session, affirming ALL of:
--     1. content_samples removed from the Linear-exit recovery allowlist
--        (scripts/linear-exit-priority-companion.js NAMES and its pinned
--        docs/independence/LINEAR_EXIT_PRIORITY_ROW_SCHEMA_20260910.json), merged;
--     2. n8n TikTok Pilot Token Refresh, Auth Init, Accounts List and List
--        deactivated (Token Refresh writes tiktok_accounts);
--     3. n8n "SyncView - Weekly Backup" no longer dumps content_samples;
--     4. n8n Samples Get deactivated.
--     Record each receipt in EXECUTION_LOG.md before applying.
-- ============================================================
begin;

do $$
declare src text;
begin
  if coalesce(current_setting('syncview.retire_20260924_receipts', true), '') <> 'verified' then
    raise exception 'apply gate B: external receipts not affirmed (see header)';
  end if;
  select prosrc into src from pg_proc
   where oid = 'public.production_retirement_contract_assert_v1()'::regprocedure;
  if src ~ '(tiktok_accounts|tiktok_oauth_state|tiktok_pilot_posts|content_samples)' then
    raise exception 'apply gate A: retirement assert still names a retired table; re-pin it first';
  end if;
end $$;

create schema retired_20260924;
revoke all on schema retired_20260924 from public, anon, authenticated, service_role;

-- Leave realtime before moving (content_samples is published).
do $$
declare t text;
begin
  foreach t in array array['tiktok_accounts','tiktok_oauth_state','tiktok_pilot_posts','content_samples'] loop
    if exists (select 1 from pg_publication_tables
               where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime drop table public.%I', t);
    end if;
  end loop;
end $$;

alter table public.tiktok_accounts    set schema retired_20260924;
alter table public.tiktok_oauth_state set schema retired_20260924;
alter table public.tiktok_pilot_posts set schema retired_20260924;
alter table public.content_samples    set schema retired_20260924;

revoke all on all tables    in schema retired_20260924 from public, anon, authenticated, service_role;
revoke all on all sequences in schema retired_20260924 from public, anon, authenticated, service_role;
alter default privileges in schema retired_20260924
  revoke all on tables from public, anon, authenticated, service_role;

commit;

-- VERIFY after apply (expect 4 rows, every privilege column false, and
-- zero rows for the same names in schema public):
-- select c.relname,
--   has_schema_privilege(r, 'retired_20260924', 'usage') usage_ok,
--   has_table_privilege(r, c.oid, 'select') select_ok, r
-- from pg_class c join pg_namespace n on n.oid = c.relnamespace,
--   unnest(array['anon','authenticated','service_role']) r
-- where n.nspname = 'retired_20260924' and c.relkind = 'r';
