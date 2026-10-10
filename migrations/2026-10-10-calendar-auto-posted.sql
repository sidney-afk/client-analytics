-- Calendar auto-posted (OPEN_REPAIRS 395). A Calendar post whose overall status is exactly
-- "Scheduled" turns "Posted" by itself once its scheduled day has ended in US Eastern time, so
-- managers stop flipping it by hand (76 Scheduled -> Posted flips in the 30 days to 2026-10-10,
-- every one of them source "ui").
--
-- STATE: BUILT, NOT APPLIED. Lighthouse applies it in the SQL editor after the two functions are
-- deployed (see OPEN_REPAIRS 395 for the order). The switch it adds is OFF.
--
-- What this file adds (idempotent; rollback block at the bottom):
--   calendar_auto_posted flag        {"clients": []}: OFF. "*" means every client. A client that is
--                                    off is never returned by the due list, so never touched.
--   calendar_auto_posted_client_on(slug)   is the switch on for this client.
--   calendar_auto_posted_stopped()         true once the job stopped itself (fail closed, below).
--   calendar_auto_posted_halt(reason)      the job's one write: empties the client list and records
--                                          why. It only ever turns the job OFF.
--   calendar_auto_posted_parts_ok(...)     the card's parts can turn Posted.
--   calendar_auto_posted_item_ok(...)      a Scheduled part's work item is there and 'scheduled'.
--   calendar_auto_posted_ts(text)          a card's text change stamp as a time; null if unreadable.
--   calendar_auto_posted_due(limit)        READ ONLY. The posts the timer may flip now, with the
--                                          card's linked work items. Never writes anything.
--   calendar_auto_posted_key_ok(key)       the function's only credential check.
--   calendar_auto_posted_tick_needed()     true when the due list is not empty.
--   calendar-auto-posted-tick              pg_cron, every 15 minutes, calls the function only
--                                          when something is due.
--
-- NO STATUS IS WRITTEN HERE. The flip itself is made by the Edge Function calendar-auto-posted
-- through the same two server calls a person's click makes (production-write for linked work
-- items, which the status bridge carries onto the card; calendar-upsert for the rest of the card),
-- so the parts, the overall, calendar_post_events and the Production side stay in step. Writing
-- the status here, around that path, is exactly what OPEN_REPAIRS 373 warns against.
--
-- WHAT COUNTS AS DUE (all of it, or the post is left alone):
--   * calendar_posts.status is exactly 'Scheduled';
--   * scheduled_date is a YYYY-MM-DD date earlier than today's date in America/New_York, i.e. the
--     whole scheduled day has ended there (daylight saving handled by the time zone database);
--   * the switch is on for the client and the job is not stopped (calendar_auto_posted_stopped);
--   * every part is Scheduled, Posted or N/A and at least one is Scheduled (parts_ok);
--   * every Scheduled video or thumbnail part either has no link at all or has a work item that
--     exists and is itself 'scheduled' (item_ok);
--   * the job has NEVER moved this card before (no 'auto-posted' status_change history row): a
--     person who sets an auto-posted card back is never overruled (owner, 2026-10-10);
--   * the card's updated_at is readable and more than an hour old, no calendar history row for it in
--     the last hour, and no linked work item changed in the last hour.
-- The permanent rules live here, not only in the function, so cards that can never flip cannot
-- fill the oldest-first page and starve newer posts. The function then re-checks every rule
-- (logic.mjs) and leaves the card alone if anything moved while it ran.
--
-- Needs, before it runs: the Vault secret calendar_auto_posted_key (32+ characters). The timer sends
-- it and the function asks the database to compare it, so it is never copied into a function
-- secret. Create it by hand, never in a file:
--   select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'calendar_auto_posted_key');
-- The file refuses to run without it.
begin;

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $check$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'calendar_auto_posted_key' and length(decrypted_secret) >= 32) then
    raise exception 'calendar_auto_posted_key is missing from Vault (at least 32 characters); create it first, see the header of this file';
  end if;
end
$check$;

insert into public.syncview_runtime_flags (key, value, updated_by)
values ('calendar_auto_posted', '{"clients": []}'::jsonb, 'migration:2026-10-10-calendar-auto-posted')
on conflict (key) do nothing;

-- STOPPED FOR GOOD (fail closed). Two independent stops, either one keeps the timer from calling
-- the function and the due list empty:
--   1. value.halted: written by calendar_auto_posted_halt() when a run cannot prove that its
--      Calendar save recorded source "auto-posted" (calendar-upsert delta missing, or no history
--      row at all). The halt also empties value.clients.
--   2. A read-only marker that needs no write at all: a calendar history row by this job's actor
--      ('SyncView auto-post') whose source is NOT 'auto-posted', written after the switch row last
--      changed. That row is exactly a flip mislabelled as a person's, so nothing more may run.
-- Turning the job back on is a deliberate new write of the switch row (see TURN ON below), which
-- also moves its updated_at past any old marker row.
create or replace function public.calendar_auto_posted_stopped()
returns boolean language sql stable set search_path = public, pg_catalog as $$
  select coalesce((select f.value ? 'halted'
                       or exists (select 1 from public.calendar_post_events e
                                   where e.actor = 'SyncView auto-post'
                                     and e.source is distinct from 'auto-posted'
                                     and e.ts > f.updated_at)
                     from public.syncview_runtime_flags f
                    where f.key = 'calendar_auto_posted'), true)
$$;

create or replace function public.calendar_auto_posted_client_on(p_slug text)
returns boolean language sql stable set search_path = public, pg_catalog as $$
  select coalesce((select (f.value -> 'clients') ? '*' or (f.value -> 'clients') ? p_slug
                     from public.syncview_runtime_flags f
                    where f.key = 'calendar_auto_posted'
                      and jsonb_typeof(f.value -> 'clients') = 'array'), false)
$$;

-- Called by the function when a run cannot prove its history source. Empties the client list and
-- records why, keeping the previous list so turning it back on is one deliberate step.
create or replace function public.calendar_auto_posted_halt(p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_value jsonb;
begin
  update public.syncview_runtime_flags f
     set value = jsonb_build_object(
           'clients', '[]'::jsonb,
           'halted', jsonb_build_object(
             'at', now(),
             'reason', left(coalesce(p_reason, ''), 80),
             'previous_clients', coalesce(f.value -> 'halted' -> 'previous_clients', f.value -> 'clients', '[]'::jsonb))),
         updated_by = 'calendar-auto-posted:halt'
   where f.key = 'calendar_auto_posted'
   returning f.value into v_value;
  return v_value;
end
$$;

-- The card parts can turn Posted: every part is Scheduled, Posted or N/A (any spelling case,
-- spaces trimmed) and at least one is Scheduled. Exactly the cards whose overall the page computes
-- as Scheduled from the usual vocabulary; anything unusual is left for a person. In SQL so a card
-- that can never flip never reaches the due list and cannot crowd out newer posts.
create or replace function public.calendar_auto_posted_parts_ok(p_video text, p_graphic text, p_caption text)
returns boolean language sql immutable set search_path = pg_catalog as $$
  select bool_and(v in ('scheduled', 'posted', 'n/a')) and bool_or(v = 'scheduled')
    from (select lower(coalesce(nullif(btrim(x), ''), 'in progress')) as v
            from unnest(array[p_video, p_graphic, p_caption]) as t(x)) s
$$;

-- One part with a work item: fine when the part is not Scheduled, or when its work item exists and
-- is itself 'scheduled'. A Scheduled part linked only the old way (a link, no work item), or whose
-- work item is missing or elsewhere, keeps the whole card out for good.
create or replace function public.calendar_auto_posted_item_ok(p_lane text, p_deliverable_id text, p_link text, p_item_found boolean, p_item_status text)
returns boolean language sql immutable set search_path = pg_catalog as $$
  select case
    when lower(btrim(coalesce(p_lane, ''))) <> 'scheduled' then true
    when nullif(btrim(p_deliverable_id), '') is null then nullif(btrim(p_link), '') is null
    else coalesce(p_item_found, false) and lower(btrim(coalesce(p_item_status, ''))) = 'scheduled'
  end
$$;

create or replace function public.calendar_auto_posted_ts(p_stamp text)
returns timestamptz language plpgsql stable set search_path = pg_catalog as $$
begin
  if p_stamp is null or p_stamp !~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}' then return null; end if;
  return p_stamp::timestamptz;
exception when others then
  return null;
end
$$;

create or replace function public.calendar_auto_posted_due(p_limit integer default 20)
returns table (
  client text, id text, status text, scheduled_date text, updated_at text,
  video_status text, graphic_status text, caption_status text,
  linear_issue_id text, graphic_linear_issue_id text,
  video_deliverable_id text, video_deliverable_status text, video_deliverable_updated_at timestamptz,
  graphic_deliverable_id text, graphic_deliverable_status text, graphic_deliverable_updated_at timestamptz)
language sql stable set search_path = public, pg_catalog as $$
  select p.client, p.id, p.status, p.scheduled_date, p.updated_at,
         p.video_status, p.graphic_status, p.caption_status,
         p.linear_issue_id, p.graphic_linear_issue_id,
         nullif(btrim(p.video_deliverable_id), ''), dv.status, dv.updated_at,
         nullif(btrim(p.graphic_deliverable_id), ''), dg.status, dg.updated_at
    from public.calendar_posts p
    left join public.deliverables dv on dv.id = nullif(btrim(p.video_deliverable_id), '')
    left join public.deliverables dg on dg.id = nullif(btrim(p.graphic_deliverable_id), '')
   where (select not public.calendar_auto_posted_stopped())
     and p.status = 'Scheduled'
     and public.calendar_auto_posted_parts_ok(p.video_status, p.graphic_status, p.caption_status)
     and public.calendar_auto_posted_item_ok(p.video_status, p.video_deliverable_id, p.linear_issue_id, dv.id is not null, dv.status)
     and public.calendar_auto_posted_item_ok(p.graphic_status, p.graphic_deliverable_id, p.graphic_linear_issue_id, dg.id is not null, dg.status)
     -- Owner decision 2026-10-10: a person's undo wins. A card this job ever moved is never moved again.
     and not exists (select 1 from public.calendar_post_events a
                      where a.client = p.client and a.post_id = p.id
                        and a.source = 'auto-posted' and a.action = 'status_change')
     and p.scheduled_date ~ '^\d{4}-\d{2}-\d{2}$'
     and p.scheduled_date < to_char(now() at time zone 'America/New_York', 'YYYY-MM-DD')
     and public.calendar_auto_posted_client_on(p.client)
     and public.calendar_auto_posted_ts(p.updated_at) < now() - interval '1 hour'
     and not exists (select 1 from public.calendar_post_events e
                      where e.client = p.client and e.post_id = p.id
                        and e.ts > now() - interval '1 hour')
     and (dv.id is null or dv.updated_at < now() - interval '1 hour')
     and (dg.id is null or dg.updated_at < now() - interval '1 hour')
   order by p.scheduled_date, p.client, p.id
   limit greatest(1, least(coalesce(p_limit, 20), 50))
$$;

-- The function's only credential check: does the header equal the Vault secret?
create or replace function public.calendar_auto_posted_key_ok(p_key text)
returns boolean language sql stable security definer set search_path = pg_catalog as $$
  select coalesce(length(p_key) >= 32 and p_key = (select decrypted_secret from vault.decrypted_secrets where name = 'calendar_auto_posted_key' limit 1), false)
$$;

create or replace function public.calendar_auto_posted_tick_needed()
returns boolean language sql stable set search_path = public, pg_catalog as $$
  select exists (select 1 from public.syncview_runtime_flags f
                  where f.key = 'calendar_auto_posted' and jsonb_array_length(coalesce(f.value -> 'clients', '[]'::jsonb)) > 0)
     and (select not public.calendar_auto_posted_stopped())
     and exists (select 1 from public.calendar_auto_posted_due(1))
$$;

revoke all on function public.calendar_auto_posted_stopped() from public, anon, authenticated, service_role;
revoke all on function public.calendar_auto_posted_halt(text) from public, anon, authenticated, service_role;
revoke all on function public.calendar_auto_posted_parts_ok(text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.calendar_auto_posted_item_ok(text, text, text, boolean, text) from public, anon, authenticated, service_role;
revoke all on function public.calendar_auto_posted_client_on(text) from public, anon, authenticated, service_role;
revoke all on function public.calendar_auto_posted_ts(text) from public, anon, authenticated, service_role;
revoke all on function public.calendar_auto_posted_due(integer) from public, anon, authenticated, service_role;
revoke all on function public.calendar_auto_posted_key_ok(text) from public, anon, authenticated, service_role;
revoke all on function public.calendar_auto_posted_tick_needed() from public, anon, authenticated, service_role;
grant execute on function public.calendar_auto_posted_stopped() to service_role;
grant execute on function public.calendar_auto_posted_halt(text) to service_role;
grant execute on function public.calendar_auto_posted_parts_ok(text, text, text) to service_role;
grant execute on function public.calendar_auto_posted_item_ok(text, text, text, boolean, text) to service_role;
grant execute on function public.calendar_auto_posted_client_on(text) to service_role;
grant execute on function public.calendar_auto_posted_ts(text) to service_role;
grant execute on function public.calendar_auto_posted_due(integer) to service_role;
grant execute on function public.calendar_auto_posted_key_ok(text) to service_role;
-- calendar_auto_posted_tick_needed: database owner only (SQL editor, pg_cron).

do $unschedule$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'calendar-auto-posted-tick';
end
$unschedule$;

select cron.schedule('calendar-auto-posted-tick', '*/15 * * * *', $job$
  select net.http_post(
    url := 'https://uzltbbrjidmjwwfakwve.supabase.co/functions/v1/calendar-auto-posted',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-calendar-auto-posted-key', (select decrypted_secret from vault.decrypted_secrets where name = 'calendar_auto_posted_key' limit 1)),
    body := '{"action":"tick"}'::jsonb,
    timeout_milliseconds := 150000)
  where public.calendar_auto_posted_tick_needed()
$job$);

commit;

-- VERIFY:
--   select jobname, schedule, active from cron.job where jobname = 'calendar-auto-posted-tick';  -- one row, active
--   select value from syncview_runtime_flags where key = 'calendar_auto_posted';                 -- {"clients": []}
--   select count(*) from public.calendar_auto_posted_due(50);                                     -- 0 while off
--
-- TURN ON FOR THE TEST CLIENT ONLY:
--   update syncview_runtime_flags set value = '{"clients": ["<test client slug>"]}'::jsonb,
--          updated_by = 'Lighthouse', updated_at = now() where key = 'calendar_auto_posted';
-- OFF AGAIN (takes effect on the next tick): set value back to '{"clients": []}'.
-- IF IT STOPPED ITSELF (value has "halted"): read value.halted.reason, fix the cause (usually the
-- calendar-upsert delta, OPEN_REPAIRS 395), then turn on again with the update above. That write
-- also retires any old mislabelled-row marker, because only rows newer than the switch row count.
--
-- ROLLBACK (posts already flipped stay Posted; a person who sets one back is never overruled,
-- because the job never moves a card it has moved before):
--   select cron.unschedule('calendar-auto-posted-tick');
--   drop function if exists public.calendar_auto_posted_tick_needed(), public.calendar_auto_posted_key_ok(text),
--     public.calendar_auto_posted_due(integer), public.calendar_auto_posted_ts(text), public.calendar_auto_posted_client_on(text),
--     public.calendar_auto_posted_item_ok(text, text, text, boolean, text), public.calendar_auto_posted_parts_ok(text, text, text),
--     public.calendar_auto_posted_halt(text), public.calendar_auto_posted_stopped();
--   delete from public.syncview_runtime_flags where key = 'calendar_auto_posted';
