-- MANUAL ONLY. DRAFT / DORMANT. No automatic migration, upload or scheduling.
-- Prepares the two restricted principals of the Track-B recovery package:
--   mode=capture  existing restricted BYPASSRLS role on the SOURCE gets SELECT on
--                 every public relation and sequence (whole-schema pg_dump locks
--                 need it), plus USAGE on public/extensions. No table writes.
--   mode=target   existing restricted role on an EMPTY scratch database gets
--                 CREATE/USAGE on public and USAGE + EXECUTE in extensions so it
--                 can own every reconstructed object. Refuses a non-empty target.
-- Run with psql ON_ERROR_STOP and variables mode, existing_role, confirmation
-- (RECOVERY_CAPTURE_GRANTS_ONLY | EMPTY_SCRATCH_TARGET_ONLY) and, for target,
-- scratch_project_ref. Never put credentials or actual role names in this file.
\set ON_ERROR_STOP on
begin;
select set_config('track_b.recovery_mode', :'mode', true);
select set_config('track_b.recovery_role', :'existing_role', true);
select set_config('track_b.recovery_confirmation', :'confirmation', true);
select :'mode' = 'target' as is_target \gset
\if :is_target
select set_config('track_b.recovery_scratch_ref', :'scratch_project_ref', true);
\endif

do $recovery_prerequisites$
declare
  mode text := current_setting('track_b.recovery_mode');
  role_name text := current_setting('track_b.recovery_role');
  role_record record;
  relation record;
  v_count integer;
begin
  if mode not in ('capture','target') then raise exception 'Unsupported recovery prerequisite mode'; end if;
  if current_setting('track_b.recovery_confirmation') <> (case when mode='capture'
    then 'RECOVERY_CAPTURE_GRANTS_ONLY' else 'EMPTY_SCRATCH_TARGET_ONLY' end) then
    raise exception 'Explicit recovery prerequisite confirmation required';
  end if;
  if mode='target' and (coalesce(current_setting('track_b.recovery_scratch_ref',true),'') !~ '^[a-z0-9]{20}$'
    or current_setting('track_b.recovery_scratch_ref')='uzltbbrjidmjwwfakwve') then
    raise exception 'Independent non-production scratch ref required';
  end if;
  select * into role_record from pg_catalog.pg_roles where rolname=role_name;
  if not found or role_name in ('anon','authenticated','service_role','postgres','authenticator','supabase_admin')
    or role_record.rolsuper or role_record.rolcreaterole or role_record.rolcreatedb
    or role_name=current_user then raise exception 'Existing dedicated restricted role required'; end if;
  if mode='capture' then
    if not role_record.rolbypassrls then raise exception 'Capture BYPASSRLS prerequisite missing'; end if;
    for relation in select c.oid::regclass as rel from pg_catalog.pg_class c
      where c.relnamespace='public'::regnamespace and c.relkind in ('r','p','v','m','f') loop
      if has_table_privilege(role_name, relation.rel, 'INSERT') or has_table_privilege(role_name, relation.rel, 'UPDATE')
        or has_table_privilege(role_name, relation.rel, 'DELETE') or has_table_privilege(role_name, relation.rel, 'TRUNCATE') then
        raise exception 'Dedicated capture role has a forbidden write privilege';
      end if;
    end loop;
    execute format('grant usage on schema public to %I', role_name);
    if to_regnamespace('extensions') is not null then execute format('grant usage on schema extensions to %I', role_name); end if;
    execute format('grant select on all tables in schema public to %I', role_name);
    execute format('grant select on all sequences in schema public to %I', role_name);
  else
    if role_record.rolbypassrls then raise exception 'Target role must not bypass row security; ownership is sufficient'; end if;
    select count(*) into v_count from pg_catalog.pg_class c where c.relnamespace='public'::regnamespace
      and c.relkind in ('r','p','v','m','S','f','c','i','I','t');
    if v_count > 0 then raise exception 'Recovery target public schema is not empty'; end if;
    select count(*) into v_count from pg_catalog.pg_proc p where p.pronamespace='public'::regnamespace;
    if v_count > 0 then raise exception 'Recovery target public schema is not empty'; end if;
    if exists(select 1 from pg_catalog.pg_extension where extname in ('pg_net','dblink','http','postgres_fdw','pg_cron')) then
      raise exception 'Recovery target has an egress-capable extension installed';
    end if;
    execute format('grant create, usage on schema public to %I', role_name);
    if to_regnamespace('extensions') is not null then
      execute format('grant usage on schema extensions to %I', role_name);
      execute format('grant execute on all functions in schema extensions to %I', role_name);
    end if;
  end if;
end $recovery_prerequisites$;
commit;
