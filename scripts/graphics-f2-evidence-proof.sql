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

create table public.deliverable_events (
  id bigint generated always as identity primary key,
  action text not null,
  source text not null,
  payload jsonb not null
);

insert into public.syncview_runtime_flags(key, value) values
  ('prod_authority', '{"video":"linear","graphics":"linear"}'),
  ('linear_outbound_enabled', '{"mode":"off"}');

commit;
