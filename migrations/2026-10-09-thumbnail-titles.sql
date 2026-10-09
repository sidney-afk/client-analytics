-- Thumbnail titles (OPEN_REPAIRS 390). Brings back the automatic thumbnail title that the
-- retired n8n step "Generate Titles" used to write, as Supabase Edge Functions.
--
-- What this file adds (idempotent; rollback block at the bottom):
--   thumbnail_title_prompts   one prompt per client, edited by staff in the Calendar's "..." menu.
--                             `prompt` is what staff saved ('' = use the default); `default_prompt`
--                             is the seeded default (the n8n instruction plus the client's title
--                             style from the Synchro Brain). Service role only: the prompt carries
--                             private Brain text, so the browser reads it through the
--                             thumbnail-title-prompts function with a staff key, never directly.
--   thumbnail_title_queue     one row per thumbnail work item waiting for, or given, a title.
--   thumbnail_titles flag     {"clients": []}: OFF. "*" means every client. Nothing is written
--                             while a client is off. New items count only from the moment the flag
--                             row last changed (or from value.since when set), so switching on is
--                             never a silent backfill.
--   thumbnail_titles_enqueue_new()    queues new empty thumbnails made from the Submit tab or a
--                                     Calendar post (origin 'calendar'; Samples are 'samples').
--   thumbnail_titles_backfill(apply)  the one-time backfill. apply=false returns COUNTS ONLY.
--   thumbnail_titles_claim(limit)     hands the function a batch of queued items.
--   thumbnail_title_apply(...)        writes one description, only if it is still empty.
--   thumbnail_titles_tick_needed()    true when the timer has anything to do.
--   thumbnail-titles-tick             pg_cron, every minute, calls the function only when needed.
--
-- Never touches a description a person wrote: the write happens under a row lock and only when the
-- description is still empty at that moment. No trigger is added to `deliverables`; the timer finds
-- new items by reading it, so creating posts is exactly as fast as before.
--
-- Needs, before it runs: the Vault secret thumbnail_titles_key (32+ characters). The timer sends it
-- and the function asks the database to compare it (thumbnail_titles_key_ok), so it is never copied
-- into a function secret. Create it by hand, never in a file:
--   select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'thumbnail_titles_key');
-- The file refuses to run without it.
begin;

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $check$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'thumbnail_titles_key' and length(decrypted_secret) >= 32) then
    raise exception 'thumbnail_titles_key is missing from Vault (at least 32 characters); create it first, see the header of this file';
  end if;
end
$check$;

create table if not exists public.thumbnail_title_prompts (
  client_slug text primary key,
  prompt text not null default '',
  default_prompt text not null default '',
  default_source text,
  default_refreshed_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.thumbnail_title_queue (
  deliverable_id text primary key,
  client_slug text not null,
  reason text not null check (reason in ('new', 'backfill')),
  state text not null default 'pending'
    check (state in ('pending', 'running', 'written', 'needs_info', 'skipped_human', 'skipped_gone', 'failed')),
  attempts integer not null default 0,
  lease_until timestamptz,
  outcome text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists thumbnail_title_queue_open on public.thumbnail_title_queue (created_at)
  where state in ('pending', 'running');

alter table public.thumbnail_title_prompts enable row level security;
alter table public.thumbnail_title_queue enable row level security;
revoke all on table public.thumbnail_title_prompts from public, anon, authenticated, service_role;
revoke all on table public.thumbnail_title_queue from public, anon, authenticated, service_role;
grant select, insert, update on table public.thumbnail_title_prompts to service_role;
grant select, insert, update, delete on table public.thumbnail_title_queue to service_role;

insert into public.syncview_runtime_flags (key, value, updated_by)
values ('thumbnail_titles', '{"clients":[]}'::jsonb, 'thumbnail-titles-migration')
on conflict (key) do nothing;

create or replace function public.thumbnail_titles_client_on(p_slug text)
returns boolean language sql stable set search_path = public, pg_catalog as $$
  select coalesce((
    select (f.value -> 'clients') ? '*' or (f.value -> 'clients') ? p_slug
    from public.syncview_runtime_flags f where f.key = 'thumbnail_titles'), false)
$$;

-- The moment "new" starts counting: value.since when set, else when the flag row last changed.
create or replace function public.thumbnail_titles_since()
returns timestamptz language sql stable set search_path = public, pg_catalog as $$
  select coalesce(
    (select case when f.value ? 'since' then (f.value ->> 'since')::timestamptz else f.updated_at end
       from public.syncview_runtime_flags f where f.key = 'thumbnail_titles'),
    'infinity'::timestamptz)
$$;

create or replace function public.thumbnail_titles_enqueue_new()
returns integer language plpgsql set search_path = public, pg_catalog as $$
declare n integer;
begin
  insert into public.thumbnail_title_queue (deliverable_id, client_slug, reason)
  select d.id, d.client_slug, 'new'
    from public.deliverables d
   where d.kind = 'thumbnail' and d.team = 'graphics' and d.origin = 'calendar'
     and d.card_id is not null
     and d.created_at > now() - interval '2 days'
     and d.created_at >= public.thumbnail_titles_since()
     and coalesce(btrim(d.brief), '') = ''
     and d.status not in ('canceled', 'duplicate')
     and public.thumbnail_titles_client_on(d.client_slug)
  on conflict (deliverable_id) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- The one-time backfill: open (not yet delivered) empty thumbnails made from the Submit tab or a
-- Calendar post. p_apply=false changes nothing and returns counts only. p_apply=true queues them;
-- the timer then writes them, and only for clients the flag has on.
create or replace function public.thumbnail_titles_backfill(p_apply boolean default false)
returns jsonb language plpgsql set search_path = public, pg_catalog as $$
declare result jsonb; queued_count integer := 0;
begin
  with c as (
    select d.id, d.client_slug, d.status,
           exists (select 1 from public.filming_plans p where p.client_slug = d.client_slug and coalesce(btrim(p.doc_id), '') <> '') as has_plan,
           exists (select 1 from public.thumbnail_title_queue q where q.deliverable_id = d.id) as queued
      from public.deliverables d
     where d.kind = 'thumbnail' and d.team = 'graphics' and d.origin = 'calendar' and d.card_id is not null
       and d.status in ('triage', 'backlog', 'todo', 'in_progress')
       and coalesce(btrim(d.brief), '') = ''
  )
  select jsonb_build_object(
    'mode', case when p_apply then 'apply' else 'dry_run' end,
    'items', count(*),
    'clients', count(distinct client_slug),
    'by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from c group by status) s), '{}'::jsonb),
    'with_filming_plan', count(*) filter (where has_plan),
    'without_filming_plan', count(*) filter (where not has_plan),
    'already_queued', count(*) filter (where queued),
    'clients_switched_on', count(distinct client_slug) filter (where public.thumbnail_titles_client_on(client_slug)))
    into result from c;
  if p_apply then
    insert into public.thumbnail_title_queue (deliverable_id, client_slug, reason)
    select d.id, d.client_slug, 'backfill'
      from public.deliverables d
     where d.kind = 'thumbnail' and d.team = 'graphics' and d.origin = 'calendar' and d.card_id is not null
       and d.status in ('triage', 'backlog', 'todo', 'in_progress')
       and coalesce(btrim(d.brief), '') = ''
    on conflict (deliverable_id) do nothing;
    get diagnostics queued_count = row_count;
    result := result || jsonb_build_object('queued_now', queued_count);
  end if;
  return result;
end $$;

create or replace function public.thumbnail_titles_claim(p_limit integer default 40)
returns setof public.thumbnail_title_queue language sql set search_path = public, pg_catalog as $$
  update public.thumbnail_title_queue q
     set state = 'running', attempts = q.attempts + 1, lease_until = now() + interval '5 minutes', updated_at = now()
   where q.deliverable_id in (
     select x.deliverable_id from public.thumbnail_title_queue x
      where (x.state = 'pending' or (x.state = 'running' and x.lease_until < now()))
        and public.thumbnail_titles_client_on(x.client_slug)
      order by x.created_at
      limit greatest(1, least(coalesce(p_limit, 40), 100))
      for update skip locked)
  returning q.*
$$;

-- Put a claimed item back (a passing failure) or give up on it after three tries. p_count=false
-- (no AI key yet) hands back the try the claim took, so waiting never uses one up.
create or replace function public.thumbnail_titles_release(p_deliverable_id text, p_error text, p_count boolean default true)
returns text language sql set search_path = public, pg_catalog as $$
  update public.thumbnail_title_queue
     set state = case when p_count and attempts >= 3 then 'failed' else 'pending' end,
         attempts = case when p_count then attempts else greatest(attempts - 1, 0) end,
         lease_until = null, last_error = left(coalesce(p_error, ''), 300), updated_at = now()
   where deliverable_id = p_deliverable_id
  returning state
$$;

-- Write one description. Only when the item still exists, is still a live thumbnail and its
-- description is STILL EMPTY under the row lock; otherwise nothing is written and the queue row
-- says why. The event row is written here (app.event_written stops the generic ledger row).
create or replace function public.thumbnail_title_apply(p_deliverable_id text, p_text text, p_state text, p_outcome text)
returns text language plpgsql set search_path = public, pg_catalog as $$
declare d public.deliverables%rowtype; final_state text;
begin
  if p_state not in ('written', 'needs_info') or coalesce(btrim(p_text), '') = '' or length(p_text) > 2000 then
    raise exception 'thumbnail_title_apply_invalid';
  end if;
  select * into d from public.deliverables where id = p_deliverable_id for update;
  if not found or d.kind <> 'thumbnail' or d.status in ('canceled', 'duplicate') then
    final_state := 'skipped_gone';
  elsif coalesce(btrim(d.brief), '') <> '' then
    final_state := 'skipped_human';
  else
    perform set_config('app.event_written', '1', true);
    update public.deliverables set brief = p_text where id = d.id;
    insert into public.deliverable_events (deliverable_id, batch_id, client_slug, actor, role, action, from_status, to_status, source, payload)
    values (d.id, d.batch_id, d.client_slug, 'SyncView thumbnail titles', 'system', 'description_change', d.status, d.status, 'system',
            jsonb_build_object('surface', 'thumbnail_titles', 'outcome', p_outcome, 'description_length', length(p_text)));
    perform set_config('app.event_written', '', true);
    final_state := p_state;
  end if;
  update public.thumbnail_title_queue
     set state = final_state, outcome = case when final_state in ('written', 'needs_info') then p_outcome else final_state end,
         lease_until = null, last_error = null, updated_at = now()
   where deliverable_id = p_deliverable_id
     -- A refused write never overwrites the record of a line already written.
     and (final_state in ('written', 'needs_info') or state in ('pending', 'running'));
  return final_state;
end $$;

-- The function's only credential check: does the header equal the Vault secret?
create or replace function public.thumbnail_titles_key_ok(p_key text)
returns boolean language sql stable security definer set search_path = pg_catalog as $$
  select coalesce(length(p_key) >= 32 and p_key = (select decrypted_secret from vault.decrypted_secrets where name = 'thumbnail_titles_key' limit 1), false)
$$;

create or replace function public.thumbnail_titles_tick_needed()
returns boolean language sql stable set search_path = public, pg_catalog as $$
  select exists (select 1 from public.syncview_runtime_flags f
                  where f.key = 'thumbnail_titles' and jsonb_array_length(coalesce(f.value -> 'clients', '[]'::jsonb)) > 0)
     and (exists (select 1 from public.thumbnail_title_queue q
                   where q.state = 'pending' or (q.state = 'running' and q.lease_until < now()))
          or exists (select 1 from public.deliverables d
                      where d.kind = 'thumbnail' and d.team = 'graphics' and d.origin = 'calendar' and d.card_id is not null
                        and d.created_at > now() - interval '2 days'
                        and d.created_at >= public.thumbnail_titles_since()
                        and coalesce(btrim(d.brief), '') = ''
                        and d.status not in ('canceled', 'duplicate')
                        and public.thumbnail_titles_client_on(d.client_slug)
                        and not exists (select 1 from public.thumbnail_title_queue q2 where q2.deliverable_id = d.id)))
$$;

revoke all on function public.thumbnail_titles_client_on(text) from public, anon, authenticated, service_role;
revoke all on function public.thumbnail_titles_since() from public, anon, authenticated, service_role;
revoke all on function public.thumbnail_titles_enqueue_new() from public, anon, authenticated, service_role;
revoke all on function public.thumbnail_titles_backfill(boolean) from public, anon, authenticated, service_role;
revoke all on function public.thumbnail_titles_claim(integer) from public, anon, authenticated, service_role;
revoke all on function public.thumbnail_titles_release(text, text, boolean) from public, anon, authenticated, service_role;
revoke all on function public.thumbnail_title_apply(text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.thumbnail_titles_tick_needed() from public, anon, authenticated, service_role;
revoke all on function public.thumbnail_titles_key_ok(text) from public, anon, authenticated, service_role;
grant execute on function public.thumbnail_titles_key_ok(text) to service_role;
grant execute on function public.thumbnail_titles_client_on(text) to service_role;
grant execute on function public.thumbnail_titles_since() to service_role;
grant execute on function public.thumbnail_titles_enqueue_new() to service_role;
grant execute on function public.thumbnail_titles_claim(integer) to service_role;
grant execute on function public.thumbnail_titles_release(text, text, boolean) to service_role;
grant execute on function public.thumbnail_title_apply(text, text, text, text) to service_role;
-- thumbnail_titles_backfill and thumbnail_titles_tick_needed: database owner only (SQL editor, pg_cron).

do $unschedule$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'thumbnail-titles-tick';
end
$unschedule$;

select cron.schedule('thumbnail-titles-tick', '* * * * *', $job$
  select net.http_post(
    url := 'https://uzltbbrjidmjwwfakwve.supabase.co/functions/v1/thumbnail-titles',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-thumbnail-titles-key', (select decrypted_secret from vault.decrypted_secrets where name = 'thumbnail_titles_key' limit 1)),
    body := '{"action":"tick"}'::jsonb,
    timeout_milliseconds := 150000)
  where public.thumbnail_titles_tick_needed()
$job$);

commit;

-- VERIFY:
--   select jobname, schedule, active from cron.job where jobname = 'thumbnail-titles-tick';   -- one row, active
--   select value from syncview_runtime_flags where key = 'thumbnail_titles';                   -- {"clients": []}
--   select public.thumbnail_titles_backfill(false);                                            -- counts only
--
-- ROLLBACK (order matters; nothing in deliverables is undone, written descriptions stay):
--   select cron.unschedule('thumbnail-titles-tick');
--   drop function if exists public.thumbnail_titles_tick_needed(), public.thumbnail_titles_key_ok(text), public.thumbnail_title_apply(text, text, text, text),
--     public.thumbnail_titles_release(text, text, boolean), public.thumbnail_titles_claim(integer), public.thumbnail_titles_backfill(boolean),
--     public.thumbnail_titles_enqueue_new(), public.thumbnail_titles_since(), public.thumbnail_titles_client_on(text);
--   drop table if exists public.thumbnail_title_queue, public.thumbnail_title_prompts;
--   delete from public.syncview_runtime_flags where key = 'thumbnail_titles';
