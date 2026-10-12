-- Track-B private backup, corpus history-v13: let the backup role READ the one
-- relation the corpus gained (session Ballast, 2026-10-12, OPEN_REPAIRS 409).
--
-- Why: pto_member_events (migrations/2026-10-10-pto-member-setup-audit.sql) has
-- a foreign key to team_members. The backup's boundary check refuses a corpus
-- that leaves such a table out, so every real backup since 2026-10-10 failed at
-- its privilege preflight. history-v13 is history-v12 plus pto_member_events.
--
-- NOT APPLIED. What this does, and ONLY this: GRANT SELECT on that table to the
-- existing backup role. It revokes nothing, creates nothing, touches no other
-- table and no other role. The role's BYPASSRLS is already how it reads past row
-- level security; this file only checks it is still set, and refuses to run
-- (changing nothing) if the role can write to the table.
--
-- Needs 2026-10-10-pto-member-setup-audit.sql applied first (it refuses otherwise).
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
  foreach relation_name in array array['pto_member_events'] loop
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
