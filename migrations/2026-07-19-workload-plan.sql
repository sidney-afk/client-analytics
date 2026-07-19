-- Workload internal plan-day sidecar.
--
-- Linear-derived workload_issues remains a read-only, rebuildable cache. This
-- table deliberately has no foreign key to that cache: a reconcile rebuild
-- must not delete or block a staff-authored internal plan day. The stable
-- workload_issues.id value is retained as issue_id and validated by the
-- workload-plan Edge Function before every write.
--
-- Browser reads and writes both go through the staff-authenticated Edge
-- Function. There are no anon/authenticated policies or grants, and no runtime
-- flag or Linear-mirrored table is changed by this migration.

begin;

create table if not exists public.workload_plan (
  issue_id text primary key
    check (btrim(issue_id) <> ''),
  client text not null
    check (client ~ '^[a-z0-9&]+$'),
  plan_date date,
  updated_by text not null
    check (btrim(updated_by) <> ''),
  updated_at timestamptz not null default now()
);

comment on table public.workload_plan is
  'Internal Workload plan-day overrides keyed by the stable workload issue id.';
comment on column public.workload_plan.plan_date is
  'Internal work day only; NULL clears the override and falls back to the client deadline.';
comment on column public.workload_plan.updated_by is
  'Server-derived staff principal; caller-supplied actor metadata is never authoritative.';

create index if not exists workload_plan_client_date_idx
  on public.workload_plan (client, plan_date)
  where plan_date is not null;

alter table public.workload_plan enable row level security;

revoke all on table public.workload_plan from public, anon, authenticated;
grant select, insert, update on table public.workload_plan to service_role;

commit;
