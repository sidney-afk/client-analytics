-- ============================================================
-- APPLIED LIVE 2026-09-27 (owner go-ahead; readback on PR #1691). PHASE 0 of
-- docs/ops/ANON_READ_SCOPE_2026-09-26.md. Safe to apply on its own.
--
-- WHAT. anon and authenticated still hold INSERT, UPDATE, DELETE, TRUNCATE,
-- REFERENCES and TRIGGER on five card tables (Supabase's default grants). Row
-- level security has no write policy for either role, so INSERT/UPDATE/DELETE
-- are already refused -- but TRUNCATE is not subject to row level security at
-- all. No PostgREST route issues TRUNCATE, so this is defence in depth, not an
-- open hole. The browser never writes these tables directly (every write goes
-- through a token- or key-checked Edge Function running as service_role),
-- which was checked across src/index on 2026-09-26.
--
-- SELECT is NOT touched here: the browser still reads with the anon key until
-- phase 1 ships. service_role and postgres are not touched.
-- ============================================================
begin;
set local lock_timeout = '5s';

do $pre$
declare t text;
begin
  foreach t in array array['calendar_posts','sample_reviews','deliverables','batches','deliverable_events'] loop
    -- Refuse if any write policy for anon/authenticated exists: then a write
    -- grant is load-bearing and removing it needs its own review.
    if exists(select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
        where c.relnamespace = 'public'::regnamespace and c.relname = t and p.polcmd <> 'r'
          and (p.polroles && array[(select oid from pg_roles where rolname='anon'), (select oid from pg_roles where rolname='authenticated')]
               or p.polroles = array[0::oid])) then
      raise exception 'anon_write_revoke_policy_exists: %', t;
    end if;
  end loop;
end;
$pre$;

revoke insert, update, delete, truncate, references, trigger
  on public.calendar_posts, public.sample_reviews, public.deliverables,
     public.batches, public.deliverable_events
  from public, anon, authenticated;

commit;

-- VERIFY (expect all false):
-- select t, has_table_privilege('anon','public.'||t,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') anon_w,
--   has_table_privilege('authenticated','public.'||t,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') auth_w
-- from unnest(array['calendar_posts','sample_reviews','deliverables','batches','deliverable_events']) t;
-- and expect service_role writes unchanged (true).
