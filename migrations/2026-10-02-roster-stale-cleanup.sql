-- ============================================================
-- 2026-10-02 -- Roster cleanup: take the stale names out of the four routing
-- lists and archive (never delete) the inactive roster rows.
--
-- SOURCE-ONLY. Not applied. Lighthouse applies it by hand in the SQL editor.
-- Owner approved both parts on 2026-10-01 (session Beacon, docs/audits/
-- 2026-10-01-client-onboarding-as-it-really-is.md, decision 13 and the
-- follow-up). The exact names were given to the owner in chat; this file holds
-- NO client name or slug (the repo is public). It selects by RULE and then
-- refuses to run unless the counts match what the owner approved.
--
-- WHAT IT DOES, in ONE transaction (a partial result is the failure, as in
-- docs/ops/NEW_CLIENT_ONBOARDING.md section 6e):
--   1. Removes from sample_review_ef_clients, calendar_upsert_ef_clients,
--      settings_ef_clients and write_ui_reroute_clients every slug that is not
--      an active client or the active test client. The test client stays in
--      all four. Approved count: 7 stale slugs.
--   2. Archives the inactive roster rows by setting board_status to 'canceled'.
--      active stays false and nothing is deleted. The internal placeholder row
--      (kind 'internal') is left untouched on purpose. Approved count: 12 rows.
--
-- STAMPS: write_ui_reroute_clients keeps updated_by
-- 'owner-enrollment-wave-3-full-roster' (docs/ops/PRE_FLIP_HEALTH_CHECK.md
-- item 5 derives the expected membership from it). The three *_ef_clients
-- lists get 'owner-roster-cleanup-2026-10-01'. The flag ledger trigger records
-- the actor; do not set updated_at.
--
-- ROLLBACK DATA: before it changes anything the script writes one row per
-- change into public.roster_cleanup_log (service role and the browser roles
-- have no access; read it in the SQL editor). Inverse, per row:
--   board status:  update public.clients c set board_status = l.detail
--                    from public.roster_cleanup_log l
--                   where l.run = '2026-10-02' and l.what = 'board_status' and l.slug = c.slug;
--   routing list:  re-enrol the slug with the one-transaction statement in
--                  NEW_CLIENT_ONBOARDING.md 6e (the log names each slug and list).
--
-- REACTIVATION: the daily clients_roster_sync_v1 sets active = true on a row
-- that comes back into Clients Info but never touches the routing lists (it
-- does the same for a brand-new client). A reactivated former client therefore
-- needs the same enrolment as a new one: the 6e statement, or the Create client
-- step once it exists. The standing "who is missing from any list" query in 6e
-- names such a client. This script does not change that behaviour.
-- ============================================================

begin;

-- (0) Before values, printed so the rollback has them.
select 'before' as phase, f.key, jsonb_array_length(f.value->'clients') as entries, f.updated_by
  from public.syncview_runtime_flags f
 where f.key in ('sample_review_ef_clients','calendar_upsert_ef_clients',
                 'settings_ef_clients','write_ui_reroute_clients')
 order by f.key;
select 'before' as phase, c.board_status, count(*) as rows
  from public.clients c
 where not c.active and c.kind <> 'internal'
 group by c.board_status order by c.board_status;

-- (1) Guards: refuse to run if the world is not what the owner approved.
do $$
declare
  v_stale int;
  v_archive int;
  v_rows int;
begin
  select count(distinct key) into v_rows
    from public.syncview_runtime_flags
   where key in ('sample_review_ef_clients','calendar_upsert_ef_clients',
                 'settings_ef_clients','write_ui_reroute_clients');
  if v_rows <> 4 then
    raise exception 'expected all four routing flag rows, found %; stop', v_rows;
  end if;

  if not exists (select 1 from public.clients where kind = 'test' and active) then
    raise exception 'no active test client; refusing (it must stay in every list)';
  end if;

  select count(distinct x) into v_stale
    from (
      select jsonb_array_elements_text(f.value->'clients') as x
        from public.syncview_runtime_flags f
       where f.key in ('sample_review_ef_clients','calendar_upsert_ef_clients',
                       'settings_ef_clients','write_ui_reroute_clients')
    ) u
   where x not in (select slug from public.clients where active and kind in ('client','test'));
  if v_stale <> 7 then
    raise exception 'expected 7 stale slugs across the four lists, found %; the approval no longer matches, stop', v_stale;
  end if;

  select count(*) into v_archive
    from public.clients
   where not active and kind <> 'internal' and board_status <> 'canceled';
  if v_archive <> 12 then
    raise exception 'expected 12 inactive roster rows to archive, found %; the approval no longer matches, stop', v_archive;
  end if;
end $$;

-- (1b) Rollback data, written before anything changes.
create table if not exists public.roster_cleanup_log (
  run       text not null,
  slug      text not null,
  what      text not null,
  detail    text not null,
  logged_at timestamptz not null default now()
);
alter table public.roster_cleanup_log enable row level security;
revoke all on public.roster_cleanup_log from public, anon, authenticated, service_role;

insert into public.roster_cleanup_log (run, slug, what, detail)
select '2026-10-02', c.slug, 'board_status', c.board_status
  from public.clients c
 where not c.active and c.kind <> 'internal' and c.board_status <> 'canceled';

insert into public.roster_cleanup_log (run, slug, what, detail)
select '2026-10-02', x, 'routing_list', f.key
  from public.syncview_runtime_flags f,
       jsonb_array_elements_text(f.value->'clients') as t(x)
 where f.key in ('sample_review_ef_clients','calendar_upsert_ef_clients',
                 'settings_ef_clients','write_ui_reroute_clients')
   and x not in (select slug from public.clients where active and kind in ('client','test'));

select 'rollback data' as phase, what, count(*) as rows
  from public.roster_cleanup_log where run = '2026-10-02' group by what order by what;

-- (2) Remove the stale slugs from all four lists. Sorted, like every other writer.
update public.syncview_runtime_flags f
   set value = jsonb_set(f.value, '{clients}', coalesce((
         select jsonb_agg(x order by x)
           from jsonb_array_elements_text(f.value->'clients') as t(x)
          where x in (select slug from public.clients where active and kind in ('client','test'))
       ), '[]'::jsonb)),
       updated_by = case when f.key = 'write_ui_reroute_clients'
                         then 'owner-enrollment-wave-3-full-roster'
                         else 'owner-roster-cleanup-2026-10-01' end
 where f.key in ('sample_review_ef_clients','calendar_upsert_ef_clients',
                 'settings_ef_clients','write_ui_reroute_clients');

-- (3) Archive (not delete) the inactive roster rows. The internal row stays.
update public.clients
   set board_status = 'canceled'
 where not active and kind <> 'internal' and board_status <> 'canceled';

-- (4) Refuse to commit unless all four lists now equal the active roster.
do $$
declare
  v_expected jsonb;
  v_bad int;
begin
  select coalesce(jsonb_agg(slug order by slug), '[]'::jsonb) into v_expected
    from public.clients where active and kind in ('client','test');

  select count(*) into v_bad
    from public.syncview_runtime_flags f
   where f.key in ('sample_review_ef_clients','calendar_upsert_ef_clients',
                   'settings_ef_clients','write_ui_reroute_clients')
     and f.value->'clients' is distinct from v_expected;
  if v_bad <> 0 then
    raise exception 'partial result: % list(s) do not equal the active roster; rolling back', v_bad;
  end if;

  if exists (select 1 from public.clients
              where not active and kind <> 'internal' and board_status <> 'canceled') then
    raise exception 'an inactive roster row was not archived; rolling back';
  end if;
end $$;

-- (5) Readback (counts only).
select 'after' as phase, f.key, jsonb_array_length(f.value->'clients') as entries, f.updated_by
  from public.syncview_runtime_flags f
 where f.key in ('sample_review_ef_clients','calendar_upsert_ef_clients',
                 'settings_ef_clients','write_ui_reroute_clients')
 order by f.key;
select 'after' as phase, c.kind, c.active, c.board_status, count(*) as rows
  from public.clients c where not c.active
 group by c.kind, c.active, c.board_status order by c.kind, c.board_status;

commit;
