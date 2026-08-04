begin;

create schema extensions;
create extension pgcrypto with schema extensions;

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end;
$roles$;

create table public.clients (
  slug text primary key,
  active boolean not null,
  kind text not null
);

create table public.calendar_posts (
  client text not null,
  id text not null,
  status text,
  graphic_status text,
  updated_at text,
  posted_at text,
  graphic_tweaks text,
  linear_issue_id text,
  graphic_linear_issue_id text,
  video_deliverable_id text,
  graphic_deliverable_id text,
  primary key (client, id)
);

create table public.sample_reviews (
  client text not null,
  id text not null,
  video_deliverable_id text,
  graphic_deliverable_id text,
  primary key (client, id)
);

create table public.deliverables (
  id text primary key,
  client_slug text not null,
  team text not null,
  kind text not null,
  origin text not null,
  card_id text,
  status text not null,
  updated_at timestamptz not null,
  linear_issue_uuid text,
  linear_identifier text,
  linear_issue_url text,
  linear_raw jsonb
);

create table public.production_comments (
  id text primary key,
  deliverable_id text,
  linear_issue_uuid text,
  linear_identifier text
);

insert into public.production_comments (id)
values ('fictional-unrelated-comment');

create table public.calendar_post_events (
  id bigint generated always as identity primary key,
  client text not null,
  post_id text not null,
  ts timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.deliverable_events (
  id bigint generated always as identity primary key,
  deliverable_id text,
  batch_id text,
  client_slug text not null,
  ts timestamptz not null default now(),
  actor text,
  role text,
  action text not null,
  from_status text,
  to_status text,
  source text not null,
  payload jsonb,
  event_key text
);

create unique index deliverable_events_event_key_unique_idx
  on public.deliverable_events (event_key)
  where event_key is not null;

create table public.syncview_runtime_flags (
  key text primary key,
  value jsonb not null
);

insert into public.syncview_runtime_flags (key, value)
values ('prod_authority', '{"video":"linear","graphics":"linear"}'::jsonb);

insert into public.clients (slug, active, kind) values
  ('fictional-client-01', true, 'client'),
  ('fictional-client-02', true, 'client'),
  ('fictional-residue-client', true, 'client');

insert into public.calendar_posts (
  client, id, status, graphic_status, updated_at, posted_at, graphic_tweaks,
  linear_issue_id, graphic_linear_issue_id,
  video_deliverable_id, graphic_deliverable_id
) values
  (
    'fictional-client-01', 'fictional-card-01', 'active', 'in_progress',
    '2026-08-01T00:01:00.000Z', null, '',
    null,
    'https://linear.app/fictional-workspace/issue/GFX-1001/fictional-graphic-01',
    null, null
  ),
  (
    'fictional-client-02', 'fictional-card-02', 'active', 'in_progress',
    '2026-08-01T00:02:00.000Z', null, '',
    null,
    'https://linear.app/fictional-workspace/issue/GFX-1002/fictional-graphic-02',
    null, ''
  );

insert into public.calendar_posts (
  client, id, status, graphic_status, updated_at, posted_at, graphic_tweaks,
  linear_issue_id, graphic_linear_issue_id,
  video_deliverable_id, graphic_deliverable_id
)
select
  'fictional-residue-client',
  'fictional-residue-card-' || lpad(residue_index::text, 3, '0'),
  'active',
  'in_progress',
  '2026-08-01T00:03:00.000Z',
  null,
  '',
  null,
  'https://linear.app/fictional-workspace/issue/GFX-'
    || (9000 + residue_index)::text
    || '/unresolved-residue-'
    || lpad(residue_index::text, 3, '0'),
  null,
  null
from generate_series(1, 266) residue_index;

insert into public.deliverables (
  id, client_slug, team, kind, origin, card_id, status, updated_at,
  linear_issue_uuid, linear_identifier, linear_issue_url, linear_raw
) values
  (
    'fictional-deliverable-01', 'fictional-client-01', 'graphics', 'thumbnail',
    'calendar', 'fictional-card-01', 'in_progress',
    '2026-08-01T01:01:00.000Z', null, 'GFX-1001',
    'https://linear.app/fictional-workspace/issue/GFX-1001/fictional-graphic-01',
    '{}'::jsonb
  ),
  (
    'fictional-deliverable-02', 'fictional-client-02', 'graphics', 'thumbnail',
    'calendar', 'fictional-card-02', 'in_progress',
    '2026-08-01T01:02:00.000Z', null, 'GFX-1002',
    'https://linear.app/fictional-workspace/issue/GFX-1002/fictional-graphic-02',
    '{}'::jsonb
  );

commit;
