-- SyncView live Supabase schema baseline
-- Project: uzltbbrjidmjwwfakwve
-- Captured: 2026-07-03
-- Source: Supabase catalog query, schema only, no table rows

create table if not exists public.ai_client_onboarding (
  id text not null,
  slug text,
  first_name text,
  last_name text,
  email text,
  phone text,
  ai_avatar text,
  funnel text default 'ai'::text,
  answers jsonb,
  status text default 'submitted'::text,
  source text default 'syncview-ai-onboarding'::text,
  created_at text,
  updated_at text
);

create table if not exists public.calendar_posts (
  client text not null,
  id text not null,
  updated_at text,
  order_index text,
  scheduled_date text,
  name text,
  asset_url text,
  thumbnail_url text,
  caption text,
  caption_alt text,
  caption_alt_platform text,
  post_url text,
  cta text,
  tweaks text,
  status text,
  linear_issue_id text,
  graphic_linear_issue_id text,
  kasper_approved_at text,
  posted_at text,
  platform text,
  platforms text,
  color text,
  video_status text,
  graphic_status text,
  caption_status text,
  video_tweaks text,
  graphic_tweaks text,
  caption_tweaks text,
  client_video_approved_at text,
  client_graphic_approved_at text,
  client_caption_approved_at text,
  kasper_seen text,
  kasper_approved_after_tweaks text,
  thumb_rev text,
  kasper_finished_at text,
  kasper_closed_at text,
  title_status text,
  title_tweaks text,
  client_title_approved_at text,
  video_status_at timestamp with time zone,
  graphic_status_at timestamp with time zone,
  video_urgent_pinged_at timestamp with time zone,
  video_urgent_status_at timestamp with time zone,
  video_urgent_issue text,
  video_urgent_editor text,
  kasper_finish_log text
);

create table if not exists public.client_credential_events (
  id uuid default gen_random_uuid() not null,
  credential_id uuid,
  client_slug text,
  client_name text,
  event_at timestamp with time zone default now() not null,
  actor text,
  actor_role text,
  action text not null,
  field text,
  old_value text,
  new_value text,
  ip text,
  country text,
  payload jsonb
);

create table if not exists public.client_credentials (
  id uuid default gen_random_uuid() not null,
  client_slug text not null,
  client_name text not null,
  platform text not null,
  label text default ''::text not null,
  handle text,
  password text,
  notes text,
  status text default 'active'::text not null,
  source text default 'manual'::text not null,
  raw_import text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  created_by text,
  created_by_role text,
  updated_by text,
  updated_by_role text
);

create table if not exists public.client_credentials_rev (
  client_slug text not null,
  client_name text,
  rev bigint default 0 not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.client_onboarding (
  id text not null,
  slug text,
  first_name text,
  last_name text,
  email text,
  phone text,
  ai_avatar text,
  answers jsonb,
  status text default 'submitted'::text,
  source text default 'syncview-onboarding'::text,
  created_at text,
  updated_at text
);

create table if not exists public.content_samples (
  client text not null,
  id text not null,
  kind text,
  order_index text,
  label text,
  media_url text,
  creative_direction text,
  hide_creative_direction text,
  comments text,
  status text,
  approval text,
  kasper_approved_at text,
  kasper_approved_by text,
  client_approved_at text,
  client_approved_by text,
  created_at text,
  updated_at text
);

create table if not exists public.onboarding_fallback (
  id text not null,
  kind text,
  funnel text,
  client_name text,
  email text,
  payload jsonb,
  note text,
  created_at text,
  updated_at text
);

create table if not exists public.sales_intakes (
  id text not null,
  created_at text,
  closed_by text,
  client_name text,
  client_email text,
  instagram text,
  contract_start_date text,
  deliverables text,
  billing_type text,
  invoice_amount numeric,
  payment_link text,
  termination_clause_type text,
  termination_clause_text text,
  referred_by text,
  esign_contract_id text,
  status text default 'submitted'::text,
  raw jsonb
);

create table if not exists public.sample_review_events (
  id bigint generated always as identity not null,
  client text not null,
  sample_id text not null,
  ts timestamp with time zone default now() not null,
  actor text,
  role text,
  action text not null,
  component text,
  from_status text,
  to_status text,
  source text,
  payload jsonb,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.sample_reviews (
  client text not null,
  id text not null,
  order_index text,
  name text,
  asset_url text,
  thumbnail_url text,
  creative_direction text,
  hide_creative_direction text,
  linear_issue_id text,
  graphic_linear_issue_id text,
  status text,
  video_status text,
  graphic_status text,
  video_tweaks text,
  graphic_tweaks text,
  client_video_approved_at text,
  client_graphic_approved_at text,
  kasper_approved_at text,
  kasper_approved_by text,
  kasper_finished_at text,
  kasper_closed_at text,
  kasper_seen text,
  kasper_approved_after_tweaks text,
  thumb_rev text,
  video_status_at timestamp with time zone,
  graphic_status_at timestamp with time zone,
  video_urgent_pinged_at timestamp with time zone,
  video_urgent_status_at timestamp with time zone,
  video_urgent_issue text,
  video_urgent_editor text,
  created_at text,
  updated_at text
);

create table if not exists public.tiktok_accounts (
  id uuid default gen_random_uuid() not null,
  client_name text not null,
  open_id text not null,
  union_id text,
  display_name text,
  avatar_url text,
  scope text,
  access_token text,
  access_token_expires_at timestamp with time zone,
  refresh_token text,
  refresh_token_expires_at timestamp with time zone,
  creator_info_cache jsonb,
  creator_info_fetched_at timestamp with time zone,
  connected_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  revoked_at timestamp with time zone
);

create table if not exists public.tiktok_oauth_state (
  state text not null,
  client_name text not null,
  created_at timestamp with time zone default now(),
  expires_at timestamp with time zone not null,
  consumed_at timestamp with time zone
);

create table if not exists public.tiktok_pilot_posts (
  id text not null,
  client_name text,
  open_id text,
  caption text,
  privacy_level text,
  disable_comment boolean default false,
  disable_duet boolean default false,
  disable_stitch boolean default false,
  is_commercial boolean default false,
  disclose_your_brand boolean default false,
  disclose_branded_content boolean default false,
  video_cover_timestamp_ms integer,
  publish_id text,
  status text,
  tiktok_post_id text,
  tiktok_url text,
  fail_reason text,
  scheduled_for timestamp with time zone,
  media_path text,
  timezone text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.workload_issues (
  id text not null,
  identifier text,
  title text,
  url text,
  is_sub_issue boolean default false not null,
  parent_id text,
  parent_identifier text,
  due_date text,
  linear_created_at text,
  linear_updated_at text,
  status text,
  status_type text,
  team_key text,
  team_name text,
  assignee_id text,
  assignee_name text,
  assignee_email text,
  client_name text,
  active boolean default true not null,
  synced_at timestamp with time zone default now() not null
);

alter table only public.ai_client_onboarding add constraint ai_client_onboarding_pkey PRIMARY KEY (id);

alter table only public.calendar_posts add constraint calendar_posts_pkey PRIMARY KEY (client, id);

alter table only public.client_credential_events add constraint client_credential_events_action_check CHECK ((action = ANY (ARRAY['create'::text, 'update'::text, 'delete'::text, 'bulk_import'::text, 'onboarding_import'::text, 'reassign'::text, 'reveal'::text])));

alter table only public.client_credential_events add constraint client_credential_events_pkey PRIMARY KEY (id);

alter table only public.client_credentials add constraint client_credentials_pkey PRIMARY KEY (id);

alter table only public.client_credentials add constraint client_credentials_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'onboarding'::text, 'bulk_import'::text])));

alter table only public.client_credentials add constraint client_credentials_status_check CHECK ((status = ANY (ARRAY['active'::text, 'needs_review'::text, 'archived'::text])));

alter table only public.client_credentials_rev add constraint client_credentials_rev_pkey PRIMARY KEY (client_slug);

alter table only public.client_onboarding add constraint client_onboarding_pkey PRIMARY KEY (id);

alter table only public.content_samples add constraint content_samples_pkey PRIMARY KEY (client, id);

alter table only public.onboarding_fallback add constraint onboarding_fallback_pkey PRIMARY KEY (id);

alter table only public.sales_intakes add constraint sales_intakes_pkey PRIMARY KEY (id);

alter table only public.sample_review_events add constraint sample_review_events_pkey PRIMARY KEY (id);

alter table only public.sample_reviews add constraint sample_reviews_pkey PRIMARY KEY (client, id);

alter table only public.tiktok_accounts add constraint tiktok_accounts_open_id_key UNIQUE (open_id);

alter table only public.tiktok_accounts add constraint tiktok_accounts_pkey PRIMARY KEY (id);

alter table only public.tiktok_oauth_state add constraint tiktok_oauth_state_pkey PRIMARY KEY (state);

alter table only public.tiktok_pilot_posts add constraint tiktok_pilot_posts_pkey PRIMARY KEY (id);

alter table only public.workload_issues add constraint workload_issues_pkey PRIMARY KEY (id);

CREATE INDEX client_credential_events_client_idx ON public.client_credential_events USING btree (client_slug, event_at DESC);

CREATE INDEX client_credential_events_credential_idx ON public.client_credential_events USING btree (credential_id, event_at DESC);

CREATE INDEX client_credentials_client_idx ON public.client_credentials USING btree (client_slug, status, lower(platform), lower(label));

CREATE UNIQUE INDEX client_credentials_live_unique ON public.client_credentials USING btree (client_slug, lower(platform), lower(COALESCE(label, ''::text))) WHERE (status <> 'archived'::text);

CREATE INDEX sample_review_events_action_idx ON public.sample_review_events USING btree (action);

CREATE INDEX sample_review_events_sample_idx ON public.sample_review_events USING btree (client, sample_id, ts DESC);

CREATE INDEX tiktok_accounts_client_idx ON public.tiktok_accounts USING btree (client_name);

CREATE INDEX tiktok_pilot_posts_created_idx ON public.tiktok_pilot_posts USING btree (created_at DESC);

CREATE INDEX tiktok_pilot_posts_publish_idx ON public.tiktok_pilot_posts USING btree (publish_id);

CREATE INDEX tiktok_pilot_posts_status_idx ON public.tiktok_pilot_posts USING btree (status);

CREATE INDEX workload_issues_active_idx ON public.workload_issues USING btree (active);

CREATE INDEX workload_issues_assignee_idx ON public.workload_issues USING btree (assignee_id);

CREATE INDEX workload_issues_client_idx ON public.workload_issues USING btree (client_name);

CREATE INDEX workload_issues_synced_at_idx ON public.workload_issues USING btree (synced_at);

alter table public.ai_client_onboarding enable row level security;

alter table public.calendar_posts enable row level security;

alter table public.client_credential_events enable row level security;

alter table public.client_credentials enable row level security;

alter table public.client_credentials_rev enable row level security;

alter table public.client_onboarding enable row level security;

alter table public.content_samples enable row level security;

alter table public.onboarding_fallback enable row level security;

alter table public.sales_intakes enable row level security;

alter table public.sample_review_events enable row level security;

alter table public.sample_reviews enable row level security;

alter table public.tiktok_accounts enable row level security;

alter table public.tiktok_oauth_state enable row level security;

alter table public.tiktok_pilot_posts enable row level security;

alter table public.workload_issues enable row level security;

create policy "anon read calendar_posts" on public.calendar_posts as PERMISSIVE for SELECT to anon using (true);

create policy "client credential rev anon read" on public.client_credentials_rev as PERMISSIVE for SELECT to anon, authenticated using (true);

create policy "anon read content_samples" on public.content_samples as PERMISSIVE for SELECT to anon using (true);

create policy "anon read sample_review_events" on public.sample_review_events as PERMISSIVE for SELECT to anon using (true);

create policy "anon read sample_reviews" on public.sample_reviews as PERMISSIVE for SELECT to anon using (true);

create policy "anon read workload_issues" on public.workload_issues as PERMISSIVE for SELECT to anon using (true);

CREATE TRIGGER trg_calendar_posts_stamp_status_at BEFORE INSERT OR UPDATE ON calendar_posts FOR EACH ROW EXECUTE FUNCTION calendar_posts_stamp_status_at();

CREATE TRIGGER trg_sample_reviews_stamp_status_at BEFORE INSERT OR UPDATE ON sample_reviews FOR EACH ROW EXECUTE FUNCTION sample_reviews_stamp_status_at();

CREATE OR REPLACE FUNCTION public._calmerge_comment_cell(p_existing text, p_incoming text, p_base text DEFAULT ''::text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
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
    where r.rn = 1 and not _calmerge_is_expired_tomb(r.elem, v_cutoff)
  )
  select coalesce(jsonb_agg(elem order by first_ord), '[]'::jsonb) into v_result from kept;

  if v_result is null or jsonb_array_length(v_result) = 0 then return ''; end if;
  return v_result::text;
end;
$function$


CREATE OR REPLACE FUNCTION public._calmerge_is_expired_tomb(p_elem jsonb, p_cutoff timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare v_ts timestamptz; v_s text;
begin
  if not coalesce((p_elem->>'deleted')::boolean, false) then return false; end if;
  v_s := coalesce(p_elem->>'updated_at', p_elem->>'created_at');
  if v_s is null or v_s = '' then return false; end if;
  begin v_ts := v_s::timestamptz; exception when others then return false; end;
  return v_ts < p_cutoff;
end;
$function$


CREATE OR REPLACE FUNCTION public._sxrmerge_comment_cell(p_existing text, p_incoming text, p_base text DEFAULT ''::text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
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
$function$


CREATE OR REPLACE FUNCTION public._sxrmerge_is_expired_tomb(p_elem jsonb, p_cutoff timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare v_ts timestamptz; v_s text;
begin
  if not coalesce((p_elem->>'deleted')::boolean, false) then return false; end if;
  v_s := coalesce(p_elem->>'updated_at', p_elem->>'created_at');
  if v_s is null or v_s = '' then return false; end if;
  begin v_ts := v_s::timestamptz; exception when others then return false; end;
  return v_ts < p_cutoff;
end;
$function$


CREATE OR REPLACE FUNCTION public.calendar_merge_comments(p_client text, p_id text, p_video text DEFAULT NULL::text, p_graphic text DEFAULT NULL::text, p_caption text DEFAULT NULL::text, p_title text DEFAULT NULL::text, p_base text DEFAULT ''::text)
 RETURNS SETOF calendar_posts
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  return query
  update calendar_posts c set
    video_tweaks   = case when p_video   is not null then _calmerge_comment_cell(c.video_tweaks,   p_video,   coalesce(p_base,'')) else c.video_tweaks   end,
    tweaks         = case when p_video   is not null then _calmerge_comment_cell(c.video_tweaks,   p_video,   coalesce(p_base,'')) else c.tweaks         end,
    graphic_tweaks = case when p_graphic is not null then _calmerge_comment_cell(c.graphic_tweaks, p_graphic, coalesce(p_base,'')) else c.graphic_tweaks end,
    caption_tweaks = case when p_caption is not null then _calmerge_comment_cell(c.caption_tweaks, p_caption, coalesce(p_base,'')) else c.caption_tweaks end,
    title_tweaks   = case when p_title   is not null then _calmerge_comment_cell(c.title_tweaks,   p_title,   coalesce(p_base,'')) else c.title_tweaks   end,
    updated_at     = now()
  where c.client = p_client and c.id = p_id
  returning c.*;
end;
$function$


CREATE OR REPLACE FUNCTION public.calendar_posts_stamp_status_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
$function$


CREATE OR REPLACE FUNCTION public.sample_review_merge_comments(p_client text, p_id text, p_video text DEFAULT NULL::text, p_graphic text DEFAULT NULL::text, p_base text DEFAULT ''::text)
 RETURNS SETOF sample_reviews
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  return query
  update sample_reviews c set
    video_tweaks   = case when p_video   is not null then _sxrmerge_comment_cell(c.video_tweaks,   p_video,   coalesce(p_base,'')) else c.video_tweaks   end,
    graphic_tweaks = case when p_graphic is not null then _sxrmerge_comment_cell(c.graphic_tweaks, p_graphic, coalesce(p_base,'')) else c.graphic_tweaks end,
    updated_at     = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  where c.client = p_client and c.id = p_id
  returning c.*;
end;
$function$


CREATE OR REPLACE FUNCTION public.sample_reviews_stamp_status_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
$function$


alter publication supabase_realtime add table public.calendar_posts;

alter publication supabase_realtime add table public.client_credentials_rev;

alter publication supabase_realtime add table public.content_samples;

alter publication supabase_realtime add table public.sample_review_events;

alter publication supabase_realtime add table public.sample_reviews;

alter publication supabase_realtime add table public.workload_issues;

alter table public.ai_client_onboarding replica identity default;

alter table public.calendar_posts replica identity full;

alter table public.client_credential_events replica identity default;

alter table public.client_credentials replica identity default;

alter table public.client_credentials_rev replica identity default;

alter table public.client_onboarding replica identity default;

alter table public.content_samples replica identity full;

alter table public.onboarding_fallback replica identity default;

alter table public.sales_intakes replica identity default;

alter table public.sample_review_events replica identity full;

alter table public.sample_reviews replica identity full;

alter table public.tiktok_accounts replica identity default;

alter table public.tiktok_oauth_state replica identity default;

alter table public.tiktok_pilot_posts replica identity default;

alter table public.workload_issues replica identity full;

grant delete on table public.calendar_posts to anon;

grant insert on table public.calendar_posts to anon;

grant references on table public.calendar_posts to anon;

grant select on table public.calendar_posts to anon;

grant trigger on table public.calendar_posts to anon;

grant truncate on table public.calendar_posts to anon;

grant update on table public.calendar_posts to anon;

grant select on table public.client_credentials_rev to anon;

grant delete on table public.content_samples to anon;

grant insert on table public.content_samples to anon;

grant references on table public.content_samples to anon;

grant select on table public.content_samples to anon;

grant trigger on table public.content_samples to anon;

grant truncate on table public.content_samples to anon;

grant update on table public.content_samples to anon;

grant delete on table public.sample_review_events to anon;

grant insert on table public.sample_review_events to anon;

grant references on table public.sample_review_events to anon;

grant select on table public.sample_review_events to anon;

grant trigger on table public.sample_review_events to anon;

grant truncate on table public.sample_review_events to anon;

grant update on table public.sample_review_events to anon;

grant delete on table public.sample_reviews to anon;

grant insert on table public.sample_reviews to anon;

grant references on table public.sample_reviews to anon;

grant select on table public.sample_reviews to anon;

grant trigger on table public.sample_reviews to anon;

grant truncate on table public.sample_reviews to anon;

grant update on table public.sample_reviews to anon;

grant delete on table public.workload_issues to anon;

grant insert on table public.workload_issues to anon;

grant references on table public.workload_issues to anon;

grant select on table public.workload_issues to anon;

grant trigger on table public.workload_issues to anon;

grant truncate on table public.workload_issues to anon;

grant update on table public.workload_issues to anon;

grant delete on table public.calendar_posts to authenticated;

grant insert on table public.calendar_posts to authenticated;

grant references on table public.calendar_posts to authenticated;

grant select on table public.calendar_posts to authenticated;

grant trigger on table public.calendar_posts to authenticated;

grant truncate on table public.calendar_posts to authenticated;

grant update on table public.calendar_posts to authenticated;

grant select on table public.client_credentials_rev to authenticated;

grant delete on table public.content_samples to authenticated;

grant insert on table public.content_samples to authenticated;

grant references on table public.content_samples to authenticated;

grant select on table public.content_samples to authenticated;

grant trigger on table public.content_samples to authenticated;

grant truncate on table public.content_samples to authenticated;

grant update on table public.content_samples to authenticated;

grant delete on table public.sample_review_events to authenticated;

grant insert on table public.sample_review_events to authenticated;

grant references on table public.sample_review_events to authenticated;

grant select on table public.sample_review_events to authenticated;

grant trigger on table public.sample_review_events to authenticated;

grant truncate on table public.sample_review_events to authenticated;

grant update on table public.sample_review_events to authenticated;

grant delete on table public.sample_reviews to authenticated;

grant insert on table public.sample_reviews to authenticated;

grant references on table public.sample_reviews to authenticated;

grant select on table public.sample_reviews to authenticated;

grant trigger on table public.sample_reviews to authenticated;

grant truncate on table public.sample_reviews to authenticated;

grant update on table public.sample_reviews to authenticated;

grant delete on table public.workload_issues to authenticated;

grant insert on table public.workload_issues to authenticated;

grant references on table public.workload_issues to authenticated;

grant select on table public.workload_issues to authenticated;

grant trigger on table public.workload_issues to authenticated;

grant truncate on table public.workload_issues to authenticated;

grant update on table public.workload_issues to authenticated;

grant delete on table public.ai_client_onboarding to service_role;

grant insert on table public.ai_client_onboarding to service_role;

grant references on table public.ai_client_onboarding to service_role;

grant select on table public.ai_client_onboarding to service_role;

grant trigger on table public.ai_client_onboarding to service_role;

grant truncate on table public.ai_client_onboarding to service_role;

grant update on table public.ai_client_onboarding to service_role;

grant delete on table public.calendar_posts to service_role;

grant insert on table public.calendar_posts to service_role;

grant references on table public.calendar_posts to service_role;

grant select on table public.calendar_posts to service_role;

grant trigger on table public.calendar_posts to service_role;

grant truncate on table public.calendar_posts to service_role;

grant update on table public.calendar_posts to service_role;

grant delete on table public.client_credential_events to service_role;

grant insert on table public.client_credential_events to service_role;

grant references on table public.client_credential_events to service_role;

grant select on table public.client_credential_events to service_role;

grant trigger on table public.client_credential_events to service_role;

grant truncate on table public.client_credential_events to service_role;

grant update on table public.client_credential_events to service_role;

grant delete on table public.client_credentials to service_role;

grant insert on table public.client_credentials to service_role;

grant references on table public.client_credentials to service_role;

grant select on table public.client_credentials to service_role;

grant trigger on table public.client_credentials to service_role;

grant truncate on table public.client_credentials to service_role;

grant update on table public.client_credentials to service_role;

grant delete on table public.client_credentials_rev to service_role;

grant insert on table public.client_credentials_rev to service_role;

grant references on table public.client_credentials_rev to service_role;

grant select on table public.client_credentials_rev to service_role;

grant trigger on table public.client_credentials_rev to service_role;

grant truncate on table public.client_credentials_rev to service_role;

grant update on table public.client_credentials_rev to service_role;

grant delete on table public.client_onboarding to service_role;

grant insert on table public.client_onboarding to service_role;

grant references on table public.client_onboarding to service_role;

grant select on table public.client_onboarding to service_role;

grant trigger on table public.client_onboarding to service_role;

grant truncate on table public.client_onboarding to service_role;

grant update on table public.client_onboarding to service_role;

grant delete on table public.content_samples to service_role;

grant insert on table public.content_samples to service_role;

grant references on table public.content_samples to service_role;

grant select on table public.content_samples to service_role;

grant trigger on table public.content_samples to service_role;

grant truncate on table public.content_samples to service_role;

grant update on table public.content_samples to service_role;

grant delete on table public.onboarding_fallback to service_role;

grant insert on table public.onboarding_fallback to service_role;

grant references on table public.onboarding_fallback to service_role;

grant select on table public.onboarding_fallback to service_role;

grant trigger on table public.onboarding_fallback to service_role;

grant truncate on table public.onboarding_fallback to service_role;

grant update on table public.onboarding_fallback to service_role;

grant delete on table public.sales_intakes to service_role;

grant insert on table public.sales_intakes to service_role;

grant references on table public.sales_intakes to service_role;

grant select on table public.sales_intakes to service_role;

grant trigger on table public.sales_intakes to service_role;

grant truncate on table public.sales_intakes to service_role;

grant update on table public.sales_intakes to service_role;

grant delete on table public.sample_review_events to service_role;

grant insert on table public.sample_review_events to service_role;

grant references on table public.sample_review_events to service_role;

grant select on table public.sample_review_events to service_role;

grant trigger on table public.sample_review_events to service_role;

grant truncate on table public.sample_review_events to service_role;

grant update on table public.sample_review_events to service_role;

grant delete on table public.sample_reviews to service_role;

grant insert on table public.sample_reviews to service_role;

grant references on table public.sample_reviews to service_role;

grant select on table public.sample_reviews to service_role;

grant trigger on table public.sample_reviews to service_role;

grant truncate on table public.sample_reviews to service_role;

grant update on table public.sample_reviews to service_role;

grant delete on table public.tiktok_accounts to service_role;

grant insert on table public.tiktok_accounts to service_role;

grant references on table public.tiktok_accounts to service_role;

grant select on table public.tiktok_accounts to service_role;

grant trigger on table public.tiktok_accounts to service_role;

grant truncate on table public.tiktok_accounts to service_role;

grant update on table public.tiktok_accounts to service_role;

grant delete on table public.tiktok_oauth_state to service_role;

grant insert on table public.tiktok_oauth_state to service_role;

grant references on table public.tiktok_oauth_state to service_role;

grant select on table public.tiktok_oauth_state to service_role;

grant trigger on table public.tiktok_oauth_state to service_role;

grant truncate on table public.tiktok_oauth_state to service_role;

grant update on table public.tiktok_oauth_state to service_role;

grant delete on table public.tiktok_pilot_posts to service_role;

grant insert on table public.tiktok_pilot_posts to service_role;

grant references on table public.tiktok_pilot_posts to service_role;

grant select on table public.tiktok_pilot_posts to service_role;

grant trigger on table public.tiktok_pilot_posts to service_role;

grant truncate on table public.tiktok_pilot_posts to service_role;

grant update on table public.tiktok_pilot_posts to service_role;

grant delete on table public.workload_issues to service_role;

grant insert on table public.workload_issues to service_role;

grant references on table public.workload_issues to service_role;

grant select on table public.workload_issues to service_role;

grant trigger on table public.workload_issues to service_role;

grant truncate on table public.workload_issues to service_role;

grant update on table public.workload_issues to service_role;
