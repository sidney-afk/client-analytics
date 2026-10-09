-- Track-B private backup, corpus history-v12: let the backup role READ the three
-- relations the corpus gained (session Vault, 2026-10-09, OPEN_REPAIRS 387).
--
-- Why: smm_also_sees points at team_members and at the SMM roster, and
-- production_native_client_test_provisions points at clients. The backup's
-- boundary check refuses a corpus that leaves such a table out, so history-v12
-- is history-v11 plus social_media_managers, smm_also_sees and
-- production_native_client_test_provisions.
--
-- What this does, and ONLY this: GRANT SELECT on those three tables to the
-- existing backup role. It revokes nothing, creates nothing, touches no other
-- table and no other role. The role's BYPASSRLS is already how it reads past row
-- level security; this file only checks it is still set, and refuses to run
-- (changing nothing) if the role can write to any of the three tables.
--
-- TO RUN (Supabase SQL editor, once): replace the one word REPLACE_WITH_BACKUP_ROLE
-- below with the backup role's name (never commit the name). Safe to run twice.
-- The role name is deliberately NOT written in this public file.
begin;

do $grant$
declare
  role_name constant text := 'REPLACE_WITH_BACKUP_ROLE';
  relation_name text;
begin
  if role_name = 'REPLACE_WITH_BACKUP_ROLE' then
    raise exception 'Set role_name to the backup role first';
  end if;
  if not exists (select 1 from pg_roles where rolname = role_name and rolcanlogin) then
    raise exception 'Backup role not found';
  end if;
  if not (select rolbypassrls from pg_roles where rolname = role_name) then
    raise exception 'Backup role must keep BYPASSRLS';
  end if;
  foreach relation_name in array array['social_media_managers', 'smm_also_sees', 'production_native_client_test_provisions'] loop
    if to_regclass('public.' || relation_name) is null then
      raise exception 'Expected relation is missing';
    end if;
    if has_table_privilege(role_name, 'public.' || relation_name, 'INSERT,UPDATE,DELETE,TRUNCATE') then
      raise exception 'Backup role must not hold a write privilege';
    end if;
    execute format('grant select on table public.%I to %I', relation_name, role_name);
  end loop;
end $grant$;

commit;
