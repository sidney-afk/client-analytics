-- ============================================================================
-- Samples v2 ("Sample Reviews") — Supabase migration  (Phase 1, backend-first)
-- Project: uzltbbrjidmjwwfakwve.  Run the WHOLE file in the Supabase SQL editor.
-- Idempotent (IF NOT EXISTS / CREATE OR REPLACE) — safe to run more than once.
--
-- Creates a FULLY-ISOLATED stack for the new Samples (Review) tab:
--   • public.sample_reviews         — per-component (video + thumbnail) review rows,
--                                      with Linear sub-issue link + status-sync columns.
--   • public.sample_review_events   — APPEND-ONLY audit log (the durable "register of
--                                      every action" — status changes, approvals,
--                                      comments, Linear in/out, reconciles).
--   • _sxrmerge_* + sample_review_merge_comments()  — atomic comment-cell merge
--                                      (byte-faithful clone of the calendar's
--                                      _calmerge_* / calendar_merge_comments, for the
--                                      two samples tweak columns only).
--   • sample_reviews_stamp_status_at — BEFORE INS/UPD trigger stamping the EXACT
--                                      change moment (clone of the calendar trigger;
--                                      load-bearing for the reconciler's direction).
--
-- ISOLATION: nothing here references or alters calendar_posts / content_samples or
-- their functions. The merge helpers are samples-namespaced (_sxrmerge_*) deliberate
-- clones of the calendar's _calmerge_* — see SAMPLES_PARITY_LOG.md so a future fix to
-- the calendar's merge gets mirrored here on purpose.
--
-- TEXT timestamps: like calendar_posts, updated_at and the *_at stamp columns are TEXT
-- holding ISO-8601 (e.g. 2026-06-25T03:13:35.573Z). The two *_status_at columns are
-- timestamptz on purpose (the reconciler compares them numerically). The merge writes
-- updated_at in the exact ISO TEXT format (not now()), to keep row-freshness ordering.
--
-- DEPLOY ORDER (do NOT reverse — the autoMapInputData footgun): run this FIRST, then
-- add the column names to the new sample-review-upsert ALLOWED list, then ship the FE.
-- ============================================================================


-- ---- Block 1: sample_reviews table + RLS + realtime --------------------------
create table if not exists public.sample_reviews (
  client                       text not null,
  id                           text not null,            -- minted client-side: sr_<ts36>_<rand>
  order_index                  text,
  name                         text,                     -- plain title/label (NOT a review component)
  asset_url                    text,                     -- video / reel
  thumbnail_url                text,                     -- thumbnail / graphic
  creative_direction           text,
  hide_creative_direction      text,                     -- 'TRUE' | 'FALSE'
  linear_issue_id              text,                     -- VIDEO Linear sub-issue (status-synced)
  graphic_linear_issue_id      text,                     -- GRAPHIC Linear sub-issue (status-synced)
  status                       text,                     -- overall = worst-of(video, graphic)
  video_status                 text,
  graphic_status               text,
  video_tweaks                 text,                     -- JSON comment array
  graphic_tweaks               text,                     -- JSON comment array
  client_video_approved_at     text,
  client_graphic_approved_at   text,
  kasper_approved_at           text,
  kasper_approved_by           text,                     -- actor name (extensive tracking)
  kasper_finished_at           text,                     -- global Finish hand-off (cross-device)
  kasper_closed_at             text,                     -- global X-close (cross-device)
  kasper_seen                  text,                     -- CSV of components
  kasper_approved_after_tweaks text,                     -- CSV of components
  thumb_rev                    text,                     -- thumbnail cache-bust token
  video_status_at              timestamptz,              -- server-stamped exact change moment
  graphic_status_at            timestamptz,              -- server-stamped exact change moment
  created_at                   text,
  updated_at                   text,
  primary key (client, id)
);

alter table public.sample_reviews enable row level security;
grant select on public.sample_reviews to anon;
drop policy if exists "anon read sample_reviews" on public.sample_reviews;
create policy "anon read sample_reviews"
  on public.sample_reviews for select to anon using (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='sample_reviews'
  ) then
    execute 'alter publication supabase_realtime add table public.sample_reviews';
  end if;
end $$;
alter table public.sample_reviews replica identity full;


-- ---- Block 2: sample_review_events (append-only audit log) -------------------
-- One row per discrete action so nothing is overwritten. `source` distinguishes a
-- UI write from an inbound-Linear write from a reconciler write. Anon-readable so a
-- later in-app "history" timeline can render it; only the service role inserts.
create table if not exists public.sample_review_events (
  id          bigint generated always as identity primary key,
  client      text not null,
  sample_id   text not null,
  ts          timestamptz not null default now(),
  actor       text,
  role        text,                  -- smm | kasper | client | system
  action      text not null,         -- status_change | approve_video | approve_graphic |
                                      -- kasper_approve | kasper_finish | kasper_close |
                                      -- comment_add | comment_resolve | comment_delete |
                                      -- reorder | link_set | link_clear |
                                      -- linear_in | linear_out | reconcile | create | archive
  component   text,                  -- video | graphic | null
  from_status text,
  to_status   text,
  source      text,                  -- ui | linear | reconcile
  payload     jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists sample_review_events_sample_idx
  on public.sample_review_events (client, sample_id, ts desc);
create index if not exists sample_review_events_action_idx
  on public.sample_review_events (action);

alter table public.sample_review_events enable row level security;
grant select on public.sample_review_events to anon;
drop policy if exists "anon read sample_review_events" on public.sample_review_events;
create policy "anon read sample_review_events"
  on public.sample_review_events for select to anon using (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='sample_review_events'
  ) then
    execute 'alter publication supabase_realtime add table public.sample_review_events';
  end if;
end $$;
alter table public.sample_review_events replica identity full;


-- ---- Block 3: atomic comment-cell merge (clone of _calmerge_* for samples) ----
-- Is this element an EXPIRED tombstone (soft-deleted > 30 days ago)? Safe cast.
create or replace function _sxrmerge_is_expired_tomb(p_elem jsonb, p_cutoff timestamptz)
returns boolean language plpgsql immutable as $fn$
declare v_ts timestamptz; v_s text;
begin
  if not coalesce((p_elem->>'deleted')::boolean, false) then return false; end if;
  v_s := coalesce(p_elem->>'updated_at', p_elem->>'created_at');
  if v_s is null or v_s = '' then return false; end if;
  begin v_ts := v_s::timestamptz; exception when others then return false; end;
  return v_ts < p_cutoff;
end;
$fn$;

-- Merge one comment cell: union by id (newer updated_at||created_at wins, ties->incoming),
-- keep tombstones, drop tombstones older than 30 days. Evaluated against the row's CURRENT
-- value inside an atomic UPDATE so concurrent writers can't clobber each other.
create or replace function _sxrmerge_comment_cell(p_existing text, p_incoming text, p_base text default '')
returns text language plpgsql immutable as $fn$
declare
  v_ex jsonb := '[]'::jsonb;
  v_inc jsonb := '[]'::jsonb;
  v_all jsonb;
  v_result jsonb;
  v_cutoff timestamptz := now() - interval '30 days';
begin
  begin v_ex  := coalesce(nullif(btrim(coalesce(p_existing,'')),'')::jsonb, '[]'::jsonb); exception when others then v_ex  := '[]'::jsonb; end;
  begin v_inc := coalesce(nullif(btrim(coalesce(p_incoming,'')),'')::jsonb, '[]'::jsonb); exception when others then v_inc := '[]'::jsonb; end;
  if jsonb_typeof(v_ex)  <> 'array' then v_ex  := '[]'::jsonb; end if;
  if jsonb_typeof(v_inc) <> 'array' then v_inc := '[]'::jsonb; end if;
  v_all := v_ex || v_inc;  -- existing first, incoming second (incoming wins stamp ties)

  with elems as (
    select e.elem,
           e.elem->>'id' as id,
           coalesce(e.elem->>'updated_at', e.elem->>'created_at', '') as ts,
           e.ord
    from jsonb_array_elements(v_all) with ordinality as e(elem, ord)
    where (e.elem ? 'id') and coalesce(e.elem->>'id','') <> ''
  ),
  ranked as (
    select elem, id, ts, ord,
           row_number() over (partition by id order by ts desc, ord desc) as rn,
           min(ord) over (partition by id) as first_ord
    from elems
  ),
  kept as (
    select elem, first_ord from ranked r
    where r.rn = 1 and not _sxrmerge_is_expired_tomb(r.elem, v_cutoff)
  )
  select coalesce(jsonb_agg(elem order by first_ord), '[]'::jsonb) into v_result from kept;

  if v_result is null or jsonb_array_length(v_result) = 0 then return ''; end if;
  return v_result::text;
end;
$fn$;

-- Atomic merge of the (optional) comment columns for ONE sample. NULL arg = leave that
-- column untouched. Returns the updated row (0 rows if the sample does not exist yet ->
-- caller treats that as a create). Samples have only video + graphic tweak columns.
create or replace function sample_review_merge_comments(
  p_client text, p_id text,
  p_video text default null, p_graphic text default null,
  p_base text default ''
) returns setof sample_reviews
language plpgsql security invoker set search_path = public as $fn$
begin
  return query
  update sample_reviews c set
    video_tweaks   = case when p_video   is not null then _sxrmerge_comment_cell(c.video_tweaks,   p_video,   coalesce(p_base,'')) else c.video_tweaks   end,
    graphic_tweaks = case when p_graphic is not null then _sxrmerge_comment_cell(c.graphic_tweaks, p_graphic, coalesce(p_base,'')) else c.graphic_tweaks end,
    updated_at     = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  where c.client = p_client and c.id = p_id
  returning c.*;
end;
$fn$;

-- Only the n8n service role (and the table owner) may call it; never the public anon key.
revoke all on function sample_review_merge_comments(text,text,text,text,text) from public;
grant execute on function sample_review_merge_comments(text,text,text,text,text) to service_role;


-- ---- Block 4: status-at trigger (clone of calendar_posts_stamp_status_at) -----
-- Stamps video_status_at / graphic_status_at whenever the matching sub-status actually
-- changes, on EVERY write path (FE save, inbound Linear sync, reconciler pulls) — no
-- ALLOWED-list / workflow edit needed. The samples reconciler reads these for exact
-- "most-recent-wins" direction and falls back to poll-timing when null.
create or replace function public.sample_reviews_stamp_status_at()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.video_status_at   := coalesce(new.video_status_at,   now());
    new.graphic_status_at := coalesce(new.graphic_status_at, now());
  else
    if new.video_status   is distinct from old.video_status   then
      new.video_status_at := now();
    end if;
    if new.graphic_status is distinct from old.graphic_status then
      new.graphic_status_at := now();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sample_reviews_stamp_status_at on public.sample_reviews;

create trigger trg_sample_reviews_stamp_status_at
  before insert or update on public.sample_reviews
  for each row
  execute function public.sample_reviews_stamp_status_at();


-- ============================================================================
-- VERIFY (read-only, after running):
--   select count(*) from public.sample_reviews;                 -- 0, table exists
--   select count(*) from public.sample_review_events;           -- 0, table exists
--   -- anon SELECT works (200); anon INSERT must 401 via the browser publishable key.
--   -- realtime: a postgres_changes subscription on sample_reviews is accepted.
-- ROLLBACK (if ever needed):
--   drop trigger if exists trg_sample_reviews_stamp_status_at on public.sample_reviews;
--   drop function if exists public.sample_reviews_stamp_status_at();
--   drop function if exists public.sample_review_merge_comments(text,text,text,text,text);
--   drop function if exists public._sxrmerge_comment_cell(text,text,text);
--   drop function if exists public._sxrmerge_is_expired_tomb(jsonb,timestamptz);
--   drop table if exists public.sample_review_events;
--   drop table if exists public.sample_reviews;
-- ============================================================================
