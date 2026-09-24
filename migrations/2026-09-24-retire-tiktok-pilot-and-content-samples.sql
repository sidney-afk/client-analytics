-- ============================================================
-- NOT APPLIED -- proposal for Lighthouse to review and apply.
-- Retire four dead tables (owner decision 2026-09-24,
-- docs/audits/2026-09-24-feature-usage.md): tiktok_accounts,
-- tiktok_oauth_state, tiktok_pilot_posts, content_samples.
--
-- Measured live 2026-09-24: rows 1 / 10 / 2 / 29; no views and no
-- foreign keys depend on them.
--
-- BLOCKERS FOUND BEFORE APPLY (resolve first, or this will break things):
--  1. public.production_retirement_contract_assert_v1() mentions these
--     names in its body. Re-read it; if it pins them, re-pin it in the same
--     change or the assert fails after the drop.
--  2. content_samples is in the Linear-exit recovery allowlist
--     (scripts/linear-exit-priority-companion.js NAMES, and
--     docs/independence/LINEAR_EXIT_PRIORITY_ROW_SCHEMA_20260910.json, which is
--     sha256-pinned). Dropping it breaks that capture until both are updated.
--  3. n8n "SyncView TikTok Pilot — Token Refresh" (every 30 min) still
--     writes tiktok_accounts, and "Accounts List" / "List" / "Auth Init"
--     still ran on 2026-09-24. Turn those off first, or they start failing.
--  4. The n8n "SyncView - Weekly Backup" dumps content_samples; remove it
--     from that list or the backup run errors.
--
-- Backup schema: readable by NO browser role. All four roles are named
-- explicitly (Supabase grants service_role, anon and authenticated by
-- default, and public covers every role).
-- ============================================================
begin;

create schema if not exists retired_20260924;
revoke all on schema retired_20260924 from public, anon, authenticated, service_role;

create table retired_20260924.tiktok_accounts    as table public.tiktok_accounts;
create table retired_20260924.tiktok_oauth_state as table public.tiktok_oauth_state;
create table retired_20260924.tiktok_pilot_posts as table public.tiktok_pilot_posts;
create table retired_20260924.content_samples    as table public.content_samples;

revoke all on all tables in schema retired_20260924 from public, anon, authenticated, service_role;
alter default privileges in schema retired_20260924
  revoke all on tables from public, anon, authenticated, service_role;

-- Copy check: abort unless every backup holds exactly the original row count.
do $$
declare t text; a bigint; b bigint;
begin
  foreach t in array array['tiktok_accounts','tiktok_oauth_state','tiktok_pilot_posts','content_samples'] loop
    execute format('select count(*) from public.%I', t) into a;
    execute format('select count(*) from retired_20260924.%I', t) into b;
    if a <> b then raise exception 'backup row count mismatch on %: % vs %', t, a, b; end if;
  end loop;
end $$;

drop table public.tiktok_accounts;
drop table public.tiktok_oauth_state;
drop table public.tiktok_pilot_posts;
drop table public.content_samples;

commit;

-- VERIFY after apply (expect 4 rows, all false):
-- select c.relname,
--   has_table_privilege('anon', c.oid, 'select') anon,
--   has_table_privilege('authenticated', c.oid, 'select') authed,
--   has_table_privilege('service_role', c.oid, 'select') svc
-- from pg_class c join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'retired_20260924';
