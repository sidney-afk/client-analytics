-- Disposable PostgreSQL 17 fixture for the Graphics F2 evidence lane.
-- This is not a production migration and is never applied outside the hosted
-- proof service. It models only the read surfaces consumed by the verifier.

begin;

create table public.syncview_runtime_flags (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text not null default 'graphics-f2-proof'
);

create table public.mirror_outbox (
  id bigint generated always as identity primary key,
  team text not null,
  operation text not null,
  status text not null,
  test_only boolean not null default false,
  legacy_parity boolean not null default false,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  linear_result jsonb
);

create table public.flag_flips (
  id bigint generated always as identity primary key,
  key text not null,
  old_value jsonb,
  new_value jsonb,
  actor text,
  ts timestamptz not null
);

create table public.deliverable_events (
  id bigint generated always as identity primary key,
  action text not null,
  source text not null,
  payload jsonb not null
);

insert into public.syncview_runtime_flags(key, value, updated_at) values
  ('prod_authority', '{"video":"linear","graphics":"linear"}', '2026-08-02T12:50:00Z'),
  ('linear_outbound_enabled', '{"mode":"off"}', '2026-08-02T12:50:00Z');

create role graphics_f2_readonly login password 'graphics-f2-proof';
alter role graphics_f2_readonly set default_transaction_read_only = on;

alter table public.syncview_runtime_flags enable row level security;
alter table public.mirror_outbox enable row level security;
alter table public.flag_flips enable row level security;
alter table public.deliverable_events enable row level security;

create policy graphics_f2_readonly_flags_select
  on public.syncview_runtime_flags for select to graphics_f2_readonly using (true);
create policy graphics_f2_readonly_outbox_select
  on public.mirror_outbox for select to graphics_f2_readonly using (true);
create policy graphics_f2_readonly_flips_select
  on public.flag_flips for select to graphics_f2_readonly using (true);
create policy graphics_f2_readonly_events_select
  on public.deliverable_events for select to graphics_f2_readonly using (true);

grant connect on database graphics_f2 to graphics_f2_readonly;
grant usage on schema public to graphics_f2_readonly;
grant select on public.syncview_runtime_flags, public.mirror_outbox,
  public.flag_flips, public.deliverable_events to graphics_f2_readonly;

commit;
