-- Preparation only: private transactional installer progress. No application activation.
begin;
create schema linear_exit_install;
revoke all on schema linear_exit_install from public,anon,authenticated,service_role;
create table linear_exit_install.journal_v1 (
 singleton boolean primary key default true check(singleton),
 plan_sha256 text not null check(plan_sha256 ~ '^[a-f0-9]{64}$'),
 stage_id text not null,
 database_identity jsonb not null,
 initial_catalog_sha256 text not null check(initial_catalog_sha256 ~ '^[a-f0-9]{64}$'),
 completed jsonb not null default '[]'::jsonb check(jsonb_typeof(completed)='array'),
 after_catalog_sha256 text not null check(after_catalog_sha256 ~ '^[a-f0-9]{64}$')
);
alter table linear_exit_install.journal_v1 enable row level security;
revoke all on table linear_exit_install.journal_v1 from public,anon,authenticated,service_role;
commit;
