-- Preparation only. No activation/removal RPC and no generic role/GUC bypass.
begin;
create schema linear_exit_maintenance;
revoke all on schema linear_exit_maintenance from public,anon,authenticated,service_role;
create table linear_exit_maintenance.gate_v1 (
 singleton boolean primary key default true check(singleton),
 original_plan_sha256 text not null, derived_plan_sha256 text not null,
 guarded_initial_sha256 text not null, database_identity jsonb not null,
 owner_sha256 text not null, installer_pid integer, installer_backend_start timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 check((installer_pid is null)=(installer_backend_start is null))
);
alter table linear_exit_maintenance.gate_v1 enable row level security;
revoke all on linear_exit_maintenance.gate_v1 from public,anon,authenticated,service_role;
create function linear_exit_maintenance.reject_other_writer_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog as $guard$
begin
 if not exists(select from linear_exit_maintenance.gate_v1 g
 join pg_catalog.pg_stat_activity a on a.pid=pg_catalog.pg_backend_pid()
 where g.singleton and g.installer_pid=a.pid and g.installer_backend_start=a.backend_start)
 then raise exception 'installation_maintenance_write_closed';end if;
 return null;
end
$guard$;
revoke all on function linear_exit_maintenance.reject_other_writer_v1() from public,anon,authenticated,service_role;
commit;
