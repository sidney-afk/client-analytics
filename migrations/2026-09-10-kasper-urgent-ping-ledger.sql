-- ============================================================
-- Kasper urgent ping -> events ledger, written by the DATABASE.
--
-- WHY THIS IS A TRIGGER AND NOT AN EDGE FUNCTION CHANGE.
--
-- The tweaks ping has written an `urgent_ping` row to the events ledger since
-- 2026-07-10 (148 rows and counting). The Kasper ping, shipped 2026-09-09, does
-- not: the repo's copies of both writers carry an `ev("kasper_urgent_ping")`
-- branch, but the LIVE functions (calendar-upsert v49, sample-review-upsert
-- v50) do not -- the branch was never carried across when the marker patch was
-- ported onto the un-gated live source. Verified by reading both deployed
-- functions on 2026-09-10, and by the observed hole: the first real ping wrote
-- its marker and produced no ledger row at all.
--
-- The obvious repair is to add those six lines to the live writers. That means
-- redeploying calendar-upsert and sample-review-upsert, which is the single
-- operation in this system that has broken client approvals twice (2026-07-15),
-- and it is not worth that risk for a ledger row.
--
-- A trigger is strictly better here anyway:
--   * it cannot drift from the live writers, because it is not in them;
--   * it records the ping no matter WHICH path performed the write, so the
--     next writer, lane or backfill is covered without being told;
--   * it needs no deploy, no capture, and no downtime.
--
-- What it gives up: `role`, which only the request context knows. `actor` is
-- taken from the marker's own kasper_urgent_by, and `source` is 'db' rather
-- than 'ui', which is honest about who wrote the row.
--
-- SAFETY. This runs on every INSERT/UPDATE of two hot tables, so it is built
-- to be incapable of failing the write it observes:
--   * the WHEN clauses mean the body does not execute unless a ping marker
--     actually appeared, so ordinary saves never enter it at all;
--   * the body is wrapped in an exception block that swallows everything, so
--     even a future schema change to the events tables cannot 500 a client's
--     approval. The ledger is best-effort, exactly as it is in the writers.
--   * SECURITY INVOKER (the default) on purpose: the marker columns are only
--     ever written by the service-role writers, so no privilege escalation is
--     needed, and none is granted.
-- ============================================================

create or replace function public.syncview_kasper_urgent_ping_ledger()
returns trigger
language plpgsql
as $$
declare
  v_comp  text;
  v_actor text;
begin
  begin
    v_comp  := nullif(btrim(coalesce(new.kasper_urgent_comp, '')), '');
    v_actor := nullif(btrim(coalesce(new.kasper_urgent_by, '')), '');

    if tg_table_name = 'calendar_posts' then
      insert into public.calendar_post_events
        (client, post_id, ts, actor, role, action, component, source, payload)
      values (new.client, new.id, now(), v_actor, null,
              'kasper_urgent_ping', v_comp, 'db',
              jsonb_build_object(
                'pinged_at', new.kasper_urgent_pinged_at,
                'status_at', new.kasper_urgent_status_at,
                'via',       'trigger'));
    else
      insert into public.sample_review_events
        (client, sample_id, ts, actor, role, action, component, source, payload)
      values (new.client, new.id, now(), v_actor, null,
              'kasper_urgent_ping', v_comp, 'db',
              jsonb_build_object(
                'pinged_at', new.kasper_urgent_pinged_at,
                'status_at', new.kasper_urgent_status_at,
                'via',       'trigger'));
    end if;
  exception when others then
    -- Best effort, always. A ledger row is never worth a failed client save.
    null;
  end;
  return null;
end;
$$;

drop trigger if exists trg_calendar_posts_kasper_urgent_ping_ledger on public.calendar_posts;
create trigger trg_calendar_posts_kasper_urgent_ping_ledger
  after insert on public.calendar_posts
  for each row
  when (new.kasper_urgent_pinged_at is not null)
  execute function public.syncview_kasper_urgent_ping_ledger();

drop trigger if exists trg_calendar_posts_kasper_urgent_ping_ledger_upd on public.calendar_posts;
create trigger trg_calendar_posts_kasper_urgent_ping_ledger_upd
  after update on public.calendar_posts
  for each row
  when (new.kasper_urgent_pinged_at is not null
        and new.kasper_urgent_pinged_at is distinct from old.kasper_urgent_pinged_at)
  execute function public.syncview_kasper_urgent_ping_ledger();

drop trigger if exists trg_sample_reviews_kasper_urgent_ping_ledger on public.sample_reviews;
create trigger trg_sample_reviews_kasper_urgent_ping_ledger
  after insert on public.sample_reviews
  for each row
  when (new.kasper_urgent_pinged_at is not null)
  execute function public.syncview_kasper_urgent_ping_ledger();

drop trigger if exists trg_sample_reviews_kasper_urgent_ping_ledger_upd on public.sample_reviews;
create trigger trg_sample_reviews_kasper_urgent_ping_ledger_upd
  after update on public.sample_reviews
  for each row
  when (new.kasper_urgent_pinged_at is not null
        and new.kasper_urgent_pinged_at is distinct from old.kasper_urgent_pinged_at)
  execute function public.syncview_kasper_urgent_ping_ledger();

-- ============================================================
-- Backfill the pings that happened before the trigger existed, so the ledger
-- starts complete rather than starting now. Idempotent: re-running adds
-- nothing. `ts` is the recorded marker rather than now(), and the payload says
-- so, because a backfilled row must not pretend to be a live observation.
-- ============================================================
insert into public.calendar_post_events
  (client, post_id, ts, actor, role, action, component, source, payload)
select p.client, p.id, p.kasper_urgent_pinged_at,
       nullif(btrim(coalesce(p.kasper_urgent_by, '')), ''), null,
       'kasper_urgent_ping',
       nullif(btrim(coalesce(p.kasper_urgent_comp, '')), ''), 'db',
       jsonb_build_object('pinged_at', p.kasper_urgent_pinged_at,
                          'status_at', p.kasper_urgent_status_at,
                          'via',       'backfill')
from public.calendar_posts p
where p.kasper_urgent_pinged_at is not null
  and not exists (select 1 from public.calendar_post_events e
                   where e.post_id = p.id and e.action = 'kasper_urgent_ping');

insert into public.sample_review_events
  (client, sample_id, ts, actor, role, action, component, source, payload)
select s.client, s.id, s.kasper_urgent_pinged_at,
       nullif(btrim(coalesce(s.kasper_urgent_by, '')), ''), null,
       'kasper_urgent_ping',
       nullif(btrim(coalesce(s.kasper_urgent_comp, '')), ''), 'db',
       jsonb_build_object('pinged_at', s.kasper_urgent_pinged_at,
                          'status_at', s.kasper_urgent_status_at,
                          'via',       'backfill')
from public.sample_reviews s
where s.kasper_urgent_pinged_at is not null
  and not exists (select 1 from public.sample_review_events e
                   where e.sample_id = s.id and e.action = 'kasper_urgent_ping');
