-- SOURCE ONLY. Phase 2 closes ONLY the two card tables.
-- Deploy and prove card-read, enable the flag, reload all readers, then apply.
-- Never run the older 2026-09-26 broad scoped-read proposal for this release.
begin;
do $guard$ begin
  if not exists(select 1 from public.syncview_runtime_flags where key='card_reads_source' and value->>'mode'='function') then
    raise exception 'card_read_function_mode_required';
  end if;
  if exists(select 1 from pg_attribute where attrelid in ('public.calendar_posts'::regclass,'public.sample_reviews'::regclass) and attnum>0 and attacl is not null) then
    raise exception 'card_column_grant_drift';
  end if;
end $guard$;
revoke SELECT on table public.calendar_posts, public.sample_reviews
  from PUBLIC, anon, authenticated, service_role;
-- All three named roles held SELECT, PUBLIC held none. Only the server needs it.
grant SELECT on table public.calendar_posts, public.sample_reviews to service_role;
do $readback$ declare t text; begin
  foreach t in array array['calendar_posts','sample_reviews'] loop
    if has_table_privilege('anon','public.'||t,'SELECT') or has_table_privilege('authenticated','public.'||t,'SELECT')
      or not has_table_privilege('service_role','public.'||t,'SELECT') then raise exception 'card_read_grants_readback_failed'; end if;
  end loop;
end $readback$;
commit;
