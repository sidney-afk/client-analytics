\set ON_ERROR_STOP on

-- Disposable-only proof. The workflow supplies PostgreSQL 17 and no external
-- connection string. This fixture is the smallest exact write surface needed
-- to exercise F133's transaction, F27 binder, ledger, and CAS properties.
DO $$
BEGIN
  IF current_setting('server_version_num')::integer < 170000
     OR current_setting('server_version_num')::integer >= 180000 THEN
    RAISE EXCEPTION 'f133_postgres_17_required';
  END IF;
END $$;

CREATE SCHEMA f133_test_fixture;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'CREATE ROLE anon NOLOGIN';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'CREATE ROLE authenticated NOLOGIN';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'CREATE ROLE service_role NOLOGIN BYPASSRLS';
  END IF;
END $$;

CREATE TABLE public.clients (
  slug text PRIMARY KEY,
  active boolean NOT NULL,
  kind text NOT NULL
);
INSERT INTO public.clients VALUES
  ('f133-client', true, 'client'),
  ('f133-test-client', true, 'test');

CREATE TABLE public.syncview_runtime_flags (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);
INSERT INTO public.syncview_runtime_flags(key, value, updated_by) VALUES
  ('prod_authority', '{"video":"linear","graphics":"linear"}', 'f133-proof'),
  ('linear_legacy_parity_enabled', '{"enabled":true}', 'f133-proof');

CREATE TABLE public.track_b_f27_team_fences (
  team text PRIMARY KEY,
  generation bigint NOT NULL
);
INSERT INTO public.track_b_f27_team_fences VALUES ('video', 7), ('graphics', 7);

CREATE TABLE public.batches (
  id text PRIMARY KEY,
  client_slug text NOT NULL REFERENCES public.clients(slug),
  team text,
  name text NOT NULL,
  description text,
  filming_doc_url text,
  footage_folder_url text,
  delivery_folder_url text,
  color text,
  status text NOT NULL DEFAULT 'active',
  comments text,
  sort_key numeric,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  linear_parent_ids jsonb
);

CREATE TABLE public.deliverables (
  id text PRIMARY KEY,
  identifier text UNIQUE,
  batch_id text NOT NULL REFERENCES public.batches(id),
  client_slug text NOT NULL REFERENCES public.clients(slug),
  team text NOT NULL CHECK (team IN ('video', 'graphics')),
  kind text NOT NULL CHECK (kind IN ('video', 'thumbnail', 'other')),
  title text NOT NULL,
  brief text,
  status text NOT NULL DEFAULT 'in_progress',
  status_at timestamptz,
  assignee_id uuid,
  due_date date,
  priority smallint,
  file_url text,
  comments text,
  origin text NOT NULL DEFAULT 'manual',
  card_id text,
  sort_key numeric,
  sync_state text NOT NULL DEFAULT 'clean',
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  linear_issue_uuid text,
  linear_identifier text,
  linear_issue_url text,
  linear_aliases jsonb,
  linear_raw jsonb
);
CREATE UNIQUE INDEX deliverables_card_slot_unique
  ON public.deliverables(client_slug, origin, card_id, kind)
  WHERE card_id IS NOT NULL AND origin IN ('calendar', 'samples');

CREATE TABLE public.deliverable_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  deliverable_id text,
  batch_id text,
  client_slug text NOT NULL,
  ts timestamptz NOT NULL DEFAULT now(),
  actor text,
  role text,
  action text NOT NULL,
  from_status text,
  to_status text,
  source text NOT NULL DEFAULT 'ui' CHECK (
    source IN ('ui', 'mirror', 'reconcile', 'backfill', 'system', 'outbound')
  ),
  payload jsonb,
  event_key text
);
CREATE UNIQUE INDEX deliverable_events_event_key_unique_idx
  ON public.deliverable_events(event_key) WHERE event_key IS NOT NULL;

CREATE TABLE public.mirror_outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  deliverable_id text,
  op text NOT NULL DEFAULT 'update_fields',
  payload jsonb NOT NULL DEFAULT '{}',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  next_retry_at timestamptz,
  locked_at timestamptz,
  lock_token uuid,
  entity text NOT NULL,
  entity_id text NOT NULL,
  batch_id text,
  comment_id text,
  operation text NOT NULL CHECK (operation IN (
    'create', 'status', 'comment', 'due', 'assignee', 'title',
    'priority', 'parent', 'archive', 'restore', 'labels',
    'description', 'attachment'
  )),
  client_slug text NOT NULL,
  team text NOT NULL,
  dedup_key text NOT NULL UNIQUE,
  source_edited_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  actor text,
  role text,
  depends_on_id bigint,
  updated_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  linear_result jsonb,
  test_only boolean NOT NULL DEFAULT false,
  legacy_parity boolean NOT NULL DEFAULT false,
  authority_generation bigint NOT NULL DEFAULT -1,
  CONSTRAINT mirror_outbox_legacy_parity_operation_check CHECK (
    legacy_parity = false OR operation IN ('create', 'status', 'comment')
  )
);

CREATE TABLE public.calendar_posts (
  client text NOT NULL,
  id text NOT NULL,
  updated_at text,
  order_index text,
  scheduled_date text,
  name text,
  asset_url text,
  thumbnail_url text,
  caption text,
  cta text,
  tweaks text,
  status text,
  linear_issue_id text,
  graphic_linear_issue_id text,
  video_status text,
  graphic_status text,
  caption_status text,
  video_tweaks text,
  graphic_tweaks text,
  caption_tweaks text,
  kasper_approved_at text,
  client_video_approved_at text,
  client_graphic_approved_at text,
  video_deliverable_id text REFERENCES public.deliverables(id),
  graphic_deliverable_id text REFERENCES public.deliverables(id),
  PRIMARY KEY (client, id)
);

CREATE TABLE public.sample_reviews (
  client text NOT NULL,
  id text NOT NULL,
  updated_at text,
  order_index text,
  name text,
  asset_url text,
  thumbnail_url text,
  status text,
  video_status text,
  graphic_status text,
  video_tweaks text,
  graphic_tweaks text,
  linear_issue_id text,
  graphic_linear_issue_id text,
  kasper_approved_at text,
  kasper_approved_by text,
  client_video_approved_at text,
  client_graphic_approved_at text,
  video_deliverable_id text REFERENCES public.deliverables(id),
  graphic_deliverable_id text REFERENCES public.deliverables(id),
  PRIMARY KEY (client, id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

CREATE OR REPLACE FUNCTION public.track_b_batch_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$fn$;
CREATE TRIGGER track_b_batch_touch_updated_at_before
  BEFORE INSERT OR UPDATE ON public.batches
  FOR EACH ROW EXECUTE FUNCTION public.track_b_batch_touch_updated_at();

CREATE OR REPLACE FUNCTION public.track_b_deliverable_touch_timestamps()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.updated_at := now();
  IF TG_OP = 'INSERT' AND NEW.status_at IS NULL THEN NEW.status_at := now(); END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER track_b_deliverable_touch_timestamps_before
  BEFORE INSERT OR UPDATE ON public.deliverables
  FOR EACH ROW EXECUTE FUNCTION public.track_b_deliverable_touch_timestamps();

CREATE OR REPLACE FUNCTION public.mirror_outbox_enqueue(
  p_entity text,
  p_entity_id text,
  p_operation text,
  p_payload jsonb,
  p_dedup_key text,
  p_source_edited_at timestamptz,
  p_client_slug text,
  p_team text,
  p_actor text DEFAULT NULL,
  p_role text DEFAULT NULL,
  p_deliverable_id text DEFAULT NULL,
  p_batch_id text DEFAULT NULL,
  p_comment_id text DEFAULT NULL,
  p_depends_on_id bigint DEFAULT NULL,
  p_test_only boolean DEFAULT false
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
declare
  v_id bigint;
  v_legacy_op text;
  v_raw_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_payload jsonb;
  v_generation bigint;
  v_legacy_parity boolean;
begin
  if coalesce(p_entity, '') not in ('deliverable', 'batch', 'comment') then
    raise exception 'invalid outbound entity';
  end if;
  if coalesce(p_operation, '') not in (
    'create', 'status', 'comment', 'due', 'assignee', 'title',
    'priority', 'parent', 'archive', 'restore', 'labels', 'description', 'attachment'
  ) then
    raise exception 'invalid outbound operation';
  end if;
  if nullif(btrim(coalesce(p_entity_id, '')), '') is null
     or nullif(btrim(coalesce(p_dedup_key, '')), '') is null
     or nullif(btrim(coalesce(p_client_slug, '')), '') is null
     or nullif(btrim(coalesce(p_team, '')), '') is null
     or p_source_edited_at is null then
    raise exception 'incomplete outbound intent';
  end if;

  begin
    v_generation := nullif(v_raw_payload->>'_f27_authority_generation', '')::bigint;
    v_legacy_parity := coalesce((v_raw_payload->>'_f27_legacy_parity')::boolean, false);
  exception when others then
    raise exception 'invalid f27 authority binder';
  end;
  v_payload := v_raw_payload
    - '_f27_authority_generation'
    - '_f27_legacy_parity';

  v_legacy_op := case p_operation
    when 'create' then 'create'
    when 'status' then 'update_state'
    when 'comment' then 'comment'
    when 'archive' then 'archive'
    else 'update_fields'
  end;

  -- Preserve the old idempotent return contract without firing a stale
  -- generation trigger for an intent that already exists.
  perform pg_advisory_xact_lock(hashtextextended(p_dedup_key, 0));
  select id into v_id from public.mirror_outbox where dedup_key = p_dedup_key;
  if found then return v_id; end if;

  insert into public.mirror_outbox (
    deliverable_id, op, payload, attempts, created_at, next_retry_at,
    entity, entity_id, batch_id, comment_id, operation, client_slug, team,
    dedup_key, source_edited_at, status, actor, role, depends_on_id,
    updated_at, test_only, authority_generation, legacy_parity
  ) values (
    p_deliverable_id, v_legacy_op, v_payload, 0, now(), now(),
    p_entity, p_entity_id, p_batch_id, p_comment_id, p_operation,
    p_client_slug, p_team, p_dedup_key, p_source_edited_at, 'pending',
    nullif(btrim(coalesce(p_actor, '')), ''),
    nullif(btrim(coalesce(p_role, '')), ''),
    p_depends_on_id, now(), coalesce(p_test_only, false),
    coalesce(v_generation, -1), v_legacy_parity
  )
  returning id into v_id;

  return v_id;
end;
$fn$;

CREATE OR REPLACE FUNCTION public.production_outbox_replay(
  p_entity text,
  p_entity_id text,
  p_operation text,
  p_client_slug text,
  p_team text,
  p_actor text,
  p_role text,
  p_test_only boolean,
  p_legacy_parity boolean,
  p_intent_fingerprint text,
  p_dedup_key text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_existing public.mirror_outbox%rowtype;
BEGIN
  IF nullif(btrim(coalesce(p_dedup_key, '')), '') IS NULL
     OR nullif(btrim(coalesce(p_intent_fingerprint, '')), '') IS NULL THEN
    RAISE EXCEPTION 'production write dedup and intent fingerprint required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_dedup_key, 0));
  SELECT o.* INTO v_existing FROM public.mirror_outbox o
  WHERE o.dedup_key = p_dedup_key FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_existing.entity IS DISTINCT FROM p_entity
     OR v_existing.entity_id IS DISTINCT FROM p_entity_id
     OR v_existing.operation IS DISTINCT FROM p_operation
     OR v_existing.client_slug IS DISTINCT FROM p_client_slug
     OR v_existing.team IS DISTINCT FROM p_team
     OR v_existing.actor IS DISTINCT FROM p_actor
     OR v_existing.role IS DISTINCT FROM p_role
     OR v_existing.test_only IS DISTINCT FROM coalesce(p_test_only, false)
     OR v_existing.legacy_parity IS DISTINCT FROM coalesce(p_legacy_parity, false)
     OR nullif(v_existing.payload->>'_intent_fingerprint', '')
          IS DISTINCT FROM p_intent_fingerprint THEN
    RAISE EXCEPTION 'idempotency_conflict';
  END IF;
  RETURN true;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.production_assert_authority(
  p_client_slug text,
  p_team text,
  p_test_only boolean,
  p_legacy_parity boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
declare
  v_value jsonb;
  v_parity_value jsonb;
  v_authority text;
  v_test_ok boolean;
begin
  lock table public.mirror_outbox in row exclusive mode;
  if p_test_only then
    select exists(
      select 1 from public.clients c
      where c.slug = p_client_slug and c.active = true and c.kind = 'test'
    ) into v_test_ok;
    if not v_test_ok then raise exception 'test_client_scope_required'; end if;
    return;
  end if;
  if p_team is null or p_team not in ('video', 'graphics') then
    raise exception 'authority_unavailable';
  end if;
  if p_legacy_parity then
    select f.value into v_parity_value
    from public.syncview_runtime_flags f
    where f.key = 'linear_legacy_parity_enabled'
    for share;
    if not found
       or jsonb_typeof(v_parity_value) <> 'object'
       or v_parity_value->'enabled' is distinct from 'true'::jsonb then
      raise exception 'legacy_parity_gate_unavailable';
    end if;
  end if;
  select f.value into v_value
  from public.syncview_runtime_flags f
  where f.key = 'prod_authority'
  for share;
  if not found or jsonb_typeof(v_value) <> 'object' then
    raise exception 'authority_unavailable';
  end if;
  v_authority := lower(nullif(v_value->>p_team, ''));
  if p_legacy_parity and v_authority is distinct from 'linear' then
    raise exception 'legacy_parity_not_allowed';
  elsif not p_legacy_parity and v_authority is distinct from 'syncview' then
    raise exception 'team_is_linear_authoritative';
  end if;
end;
$fn$;

CREATE OR REPLACE FUNCTION public.track_b_f27_write_authorization(
  p_team text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $fn$
declare
  v_team text := lower(nullif(btrim(coalesce(p_team, '')), ''));
  v_generation bigint;
  v_authority jsonb;
begin
  if v_team not in ('video', 'graphics') then
    raise exception 'f27_invalid_write_team';
  end if;
  select generation into v_generation
  from public.track_b_f27_team_fences where team = v_team;
  select value into v_authority
  from public.syncview_runtime_flags where key = 'prod_authority';
  if v_generation is null or jsonb_typeof(v_authority) is distinct from 'object'
     or lower(coalesce(v_authority->>v_team, '')) not in ('linear', 'syncview') then
    raise exception 'f27_write_authorization_unavailable';
  end if;
  return jsonb_build_object(
    'ok', true,
    'type', 'f27_write_authorization',
    'team', v_team,
    'authority', lower(v_authority->>v_team),
    'generation', v_generation
  );
end;
$fn$;

REVOKE ALL ON FUNCTION public.mirror_outbox_enqueue(
  text, text, text, jsonb, text, timestamptz, text, text,
  text, text, text, text, text, bigint, boolean
) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mirror_outbox_enqueue(
  text, text, text, jsonb, text, timestamptz, text, text,
  text, text, text, text, text, bigint, boolean
) TO service_role;
REVOKE ALL ON FUNCTION public.production_assert_authority(text, text, boolean, boolean)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.production_assert_authority(text, text, boolean, boolean)
  TO service_role;
REVOKE ALL ON FUNCTION public.track_b_f27_write_authorization(text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.track_b_f27_write_authorization(text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.track_b_enqueue_outbound_intent()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_outbound jsonb := coalesce(NEW.payload->'outbound', '{}');
  v_id bigint;
BEGIN
  IF NEW.source <> 'ui'
     OR jsonb_typeof(NEW.payload->'outbound') IS DISTINCT FROM 'object' THEN
    RETURN NEW;
  END IF;
  v_id := public.mirror_outbox_enqueue(
    coalesce(v_outbound->>'entity', CASE WHEN NEW.deliverable_id IS NULL THEN 'batch' ELSE 'deliverable' END),
    coalesce(v_outbound->>'entity_id', NEW.deliverable_id, NEW.batch_id),
    v_outbound->>'operation',
    coalesce(v_outbound->'payload', '{}'),
    v_outbound->>'dedup_key',
    coalesce((v_outbound->>'source_edited_at')::timestamptz, NEW.ts),
    NEW.client_slug,
    v_outbound->>'team',
    NEW.actor,
    NEW.role,
    NEW.deliverable_id,
    NEW.batch_id,
    NULL,
    nullif(v_outbound->>'depends_on_id', '')::bigint,
    coalesce((v_outbound->>'test_only')::boolean, false)
  );
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER track_b_enqueue_outbound_intent_after
  AFTER INSERT ON public.deliverable_events
  FOR EACH ROW EXECUTE FUNCTION public.track_b_enqueue_outbound_intent();

CREATE OR REPLACE FUNCTION public.batch_write(p_row jsonb, p_event jsonb DEFAULT '{}')
RETURNS public.batches
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_result public.batches%rowtype;
BEGIN
  INSERT INTO public.batches AS b(
    id, client_slug, team, name, description, filming_doc_url,
    footage_folder_url, delivery_folder_url, color, status, sort_key,
    created_by, created_at, linear_parent_ids
  ) VALUES (
    p_row->>'id', p_row->>'client_slug', nullif(p_row->>'team', ''),
    p_row->>'name', nullif(p_row->>'description', ''),
    nullif(p_row->>'filming_doc_url', ''), nullif(p_row->>'footage_folder_url', ''),
    nullif(p_row->>'delivery_folder_url', ''), nullif(p_row->>'color', ''),
    coalesce(nullif(p_row->>'status', ''), 'active'),
    nullif(p_row->>'sort_key', '')::numeric, nullif(p_row->>'created_by', ''),
    coalesce(nullif(p_row->>'created_at', '')::timestamptz, now()),
    p_row->'linear_parent_ids'
  ) RETURNING * INTO v_result;
  INSERT INTO public.deliverable_events(
    batch_id, client_slug, ts, actor, role, action,
    from_status, to_status, source, payload
  ) VALUES (
    v_result.id, v_result.client_slug,
    coalesce(nullif(p_event->>'ts', '')::timestamptz, now()),
    p_event->>'actor', p_event->>'role', coalesce(p_event->>'action', 'create'),
    null, v_result.status, coalesce(p_event->>'source', 'ui'), p_event
  );
  RETURN v_result;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.deliverable_write(p_row jsonb, p_event jsonb DEFAULT '{}')
RETURNS public.deliverables
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_result public.deliverables%rowtype;
BEGIN
  INSERT INTO public.deliverables(
    id, identifier, batch_id, client_slug, team, kind, title, brief,
    status, status_at, assignee_id, due_date, priority, file_url, comments,
    origin, card_id, sort_key, sync_state, created_by, created_at,
    linear_issue_uuid, linear_identifier, linear_issue_url, linear_aliases, linear_raw
  ) VALUES (
    p_row->>'id', nullif(p_row->>'identifier', ''), p_row->>'batch_id',
    p_row->>'client_slug', p_row->>'team', p_row->>'kind', p_row->>'title',
    nullif(p_row->>'brief', ''), coalesce(p_row->>'status', 'in_progress'),
    nullif(p_row->>'status_at', '')::timestamptz,
    nullif(p_row->>'assignee_id', '')::uuid, nullif(p_row->>'due_date', '')::date,
    nullif(p_row->>'priority', '')::smallint, nullif(p_row->>'file_url', ''),
    nullif(p_row->>'comments', ''), coalesce(p_row->>'origin', 'manual'),
    nullif(p_row->>'card_id', ''), nullif(p_row->>'sort_key', '')::numeric,
    coalesce(p_row->>'sync_state', 'clean'), nullif(p_row->>'created_by', ''),
    coalesce(nullif(p_row->>'created_at', '')::timestamptz, now()),
    nullif(p_row->>'linear_issue_uuid', ''), nullif(p_row->>'linear_identifier', ''),
    nullif(p_row->>'linear_issue_url', ''), p_row->'linear_aliases', p_row->'linear_raw'
  ) RETURNING * INTO v_result;
  INSERT INTO public.deliverable_events(
    deliverable_id, batch_id, client_slug, ts, actor, role, action,
    from_status, to_status, source, payload
  ) VALUES (
    v_result.id, v_result.batch_id, v_result.client_slug,
    coalesce(nullif(p_event->>'ts', '')::timestamptz, now()),
    p_event->>'actor', p_event->>'role', coalesce(p_event->>'action', 'create'),
    NULL, v_result.status, coalesce(p_event->>'source', 'ui'), p_event
  );
  RETURN v_result;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.production_batch_write(
  p_row jsonb, p_event jsonb DEFAULT '{}'
) RETURNS public.batches
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_outbound jsonb := coalesce(p_event->'outbound', '{}');
  v_result public.batches%rowtype;
BEGIN
  PERFORM public.production_assert_authority(
    p_row->>'client_slug', v_outbound->>'team',
    coalesce((v_outbound->>'test_only')::boolean, false),
    coalesce((v_outbound->>'legacy_parity')::boolean, false)
  );
  IF public.production_outbox_replay(
    'batch', p_row->>'id', v_outbound->>'operation', p_row->>'client_slug',
    v_outbound->>'team', p_event->>'actor', p_event->>'role',
    coalesce((v_outbound->>'test_only')::boolean, false),
    coalesce((v_outbound->>'legacy_parity')::boolean, false),
    v_outbound->'payload'->>'_intent_fingerprint', v_outbound->>'dedup_key'
  ) THEN
    SELECT * INTO v_result FROM public.batches WHERE id = p_row->>'id';
    IF NOT FOUND THEN RAISE EXCEPTION 'idempotent_result_missing'; END IF;
    RETURN v_result;
  END IF;
  RETURN public.batch_write(p_row, p_event);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.production_batch_intent_write(
  p_batch_id text, p_event jsonb
) RETURNS public.batches
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_outbound jsonb := coalesce(p_event->'outbound', '{}');
  v_result public.batches%rowtype;
BEGIN
  SELECT * INTO v_result FROM public.batches WHERE id = p_batch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'production batch not found'; END IF;
  PERFORM public.production_assert_authority(
    v_result.client_slug, v_outbound->>'team',
    coalesce((v_outbound->>'test_only')::boolean, false),
    coalesce((v_outbound->>'legacy_parity')::boolean, false)
  );
  IF public.production_outbox_replay(
    'batch', p_batch_id, v_outbound->>'operation', v_result.client_slug,
    v_outbound->>'team', p_event->>'actor', p_event->>'role',
    coalesce((v_outbound->>'test_only')::boolean, false),
    coalesce((v_outbound->>'legacy_parity')::boolean, false),
    v_outbound->'payload'->>'_intent_fingerprint', v_outbound->>'dedup_key'
  ) THEN RETURN v_result; END IF;
  INSERT INTO public.deliverable_events(
    batch_id, client_slug, ts, actor, role, action, source, payload
  ) VALUES (
    v_result.id, v_result.client_slug,
    coalesce(nullif(p_event->>'ts', '')::timestamptz, now()),
    p_event->>'actor', p_event->>'role', coalesce(p_event->>'action', 'create'),
    coalesce(p_event->>'source', 'ui'), p_event
  );
  RETURN v_result;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.production_deliverable_write(
  p_row jsonb, p_event jsonb DEFAULT '{}'
) RETURNS public.deliverables
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_outbound jsonb := coalesce(p_event->'outbound', '{}');
  v_result public.deliverables%rowtype;
BEGIN
  PERFORM public.production_assert_authority(
    p_row->>'client_slug', p_row->>'team',
    coalesce((v_outbound->>'test_only')::boolean, false),
    coalesce((v_outbound->>'legacy_parity')::boolean, false)
  );
  IF public.production_outbox_replay(
    'deliverable', p_row->>'id', v_outbound->>'operation', p_row->>'client_slug',
    p_row->>'team', p_event->>'actor', p_event->>'role',
    coalesce((v_outbound->>'test_only')::boolean, false),
    coalesce((v_outbound->>'legacy_parity')::boolean, false),
    v_outbound->'payload'->>'_intent_fingerprint', v_outbound->>'dedup_key'
  ) THEN
    SELECT * INTO v_result FROM public.deliverables WHERE id = p_row->>'id';
    IF NOT FOUND THEN RAISE EXCEPTION 'idempotent_result_missing'; END IF;
    RETURN v_result;
  END IF;
  RETURN public.deliverable_write(p_row, p_event);
END;
$fn$;

REVOKE ALL ON FUNCTION public.production_batch_write(jsonb, jsonb)
  FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.production_batch_intent_write(text, jsonb)
  FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.production_deliverable_write(jsonb, jsonb)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.production_batch_write(jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.production_batch_intent_write(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.production_deliverable_write(jsonb, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.production_batch_parent_ids_for_team(
  p_value jsonb, p_team text
) RETURNS text[] LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $fn$
DECLARE
  v_team text := lower(btrim(coalesce(p_team, '')));
  v_ids text[];
BEGIN
  IF v_team = 'video' THEN
    v_ids := array_remove(array[
      nullif(btrim(p_value->>'video'), ''), nullif(btrim(p_value->>'vid'), '')
    ], null);
  ELSIF v_team = 'graphics' THEN
    v_ids := array_remove(array[
      nullif(btrim(p_value->>'graphics'), ''), nullif(btrim(p_value->>'graphic'), ''),
      nullif(btrim(p_value->>'gra'), '')
    ], null);
  ELSE
    RETURN array[]::text[];
  END IF;
  RETURN ARRAY(SELECT DISTINCT id FROM unnest(v_ids) id ORDER BY id);
END;
$fn$;

-- Disposable stand-in for the deployed pre-F133 v3 append closure. The F133
-- migration must preserve this existing signature by renaming it before it
-- installs the v4 implementation under the canonical name.
-- This retained pre-F133 body is byte-exact to production. PostgreSQL 17 no
-- longer accepts its historical unparenthesized CASE during CREATE FUNCTION,
-- so load the catalog fixture without rewriting the reviewed dependency. The
-- F133 functions below are validated normally.
set check_function_bodies = off;
create or replace function public.production_intake_append(
  p_batch_id text,
  p_expected_updated_at timestamptz,
  p_rows jsonb,
  p_events jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_batch public.batches%rowtype;
  v_dependency public.mirror_outbox%rowtype;
  v_result public.deliverables%rowtype;
  v_row jsonb;
  v_event jsonb;
  v_outbound jsonb;
  v_payload jsonb;
  v_count integer;
  v_index integer;
  v_team text;
  v_card_id text;
  v_parent_id text;
  v_dependency_parent_id text;
  v_parent_ids text[];
  v_dependency_id bigint;
  v_project_id text;
  v_replay boolean;
  v_replay_count integer := 0;
  v_terminal_dependency boolean := false;
  v_rows_out jsonb := '[]'::jsonb;
  v_base_sort numeric;
  v_base_ordinal integer;
  v_group record;
  v_group_index integer := 0;
  v_expected_sort numeric;
  v_expected_ordinal integer;
  v_first_event jsonb;
begin
  if nullif(btrim(coalesce(p_batch_id, '')), '') is null
     or p_expected_updated_at is null
     or jsonb_typeof(p_rows) is distinct from 'array'
     or jsonb_typeof(p_events) is distinct from 'array' then
    raise exception 'invalid_intake_append_payload';
  end if;
  v_count := jsonb_array_length(p_rows);
  if v_count < 2 or v_count > 100 or v_count <> jsonb_array_length(p_events) then
    raise exception 'invalid_intake_append_payload';
  end if;

  select b.* into v_batch
  from public.batches b
  where b.id = p_batch_id
  for update;
  if not found then raise exception 'batch_not_found'; end if;
  if v_batch.status is distinct from 'active' then raise exception 'batch_not_active'; end if;

  if (
    select count(distinct nullif(btrim(value->>'id'), ''))
    from jsonb_array_elements(p_rows)
  ) <> v_count then
    raise exception 'invalid_intake_append_payload';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_rows) item
    group by nullif(btrim(item->>'card_id'), '')
    having nullif(btrim(item->>'card_id'), '') is null
       or count(*) <> 2
       or count(*) filter (where item->>'team' = 'video') <> 1
       or count(*) filter (where item->>'team' = 'graphics') <> 1
  ) then
    raise exception 'invalid_intake_append_pair';
  end if;

  -- Validate the complete trusted plan and acquire every dedup lock before the
  -- first child write. An exact concurrent replay is recognized before CAS.
  for v_index in 0..v_count - 1
  loop
    v_row := p_rows->v_index;
    v_event := p_events->v_index;
    v_outbound := coalesce(v_event->'outbound', '{}'::jsonb);
    v_payload := coalesce(v_outbound->'payload', '{}'::jsonb);
    v_team := nullif(btrim(v_row->>'team'), '');
    v_card_id := nullif(btrim(v_row->>'card_id'), '');
    v_project_id := nullif(btrim(v_payload->>'project_id'), '');
    if nullif(btrim(v_row->>'id'), '') is null
       or v_row->>'batch_id' is distinct from v_batch.id
       or v_row->>'client_slug' is distinct from v_batch.client_slug
       or v_team is null
       or v_team not in ('video', 'graphics')
       or (v_batch.team is not null and v_team is distinct from v_batch.team)
       or v_card_id is null
       or v_row->>'origin' is distinct from 'calendar'
       or v_row->>'kind' is distinct from case when v_team = 'graphics' then 'thumbnail' else 'video' end
       or coalesce(v_row->>'_intake_ordinal', '') !~ '^[1-9][0-9]*$'
       or coalesce(v_row->>'sort_key', '') !~ '^-?[0-9]+([.][0-9]+)?$'
       or v_event->>'source' is distinct from 'ui'
       or v_event->>'action' is distinct from 'create'
       or v_outbound->>'entity' is distinct from 'deliverable'
       or v_outbound->>'entity_id' is distinct from v_row->>'id'
       or v_outbound->>'team' is distinct from v_team
       or v_outbound->>'operation' is distinct from 'create'
       or nullif(btrim(v_outbound->>'dedup_key'), '') is null
       or nullif(btrim(v_payload->>'_intent_fingerprint'), '') is null
       or v_project_id is null then
      raise exception 'invalid_intake_append_payload';
    end if;

    v_parent_id := nullif(btrim(v_payload->>'parent_linear_issue_id'), '');
    begin
      v_dependency_id := nullif(btrim(v_outbound->>'depends_on_id'), '')::bigint;
    exception when others then
      raise exception 'invalid_intake_append_route';
    end;
    if (v_parent_id is null) = (v_dependency_id is null) then
      raise exception 'invalid_intake_append_route';
    end if;
    if v_parent_id is not null then
      v_parent_ids := public.production_batch_parent_ids_for_team(v_batch.linear_parent_ids, v_team);
      if cardinality(v_parent_ids) > 1 then
        raise exception 'batch_parent_mapping_ambiguous';
      end if;
      if cardinality(v_parent_ids) <> 1 or v_parent_ids[1] is distinct from v_parent_id then
        raise exception 'batch_parent_mapping_missing';
      end if;
    else
      select o.* into v_dependency
      from public.mirror_outbox o
      where o.id = v_dependency_id
      for share;
      if not found
         or v_dependency.entity is distinct from 'batch'
         or v_dependency.entity_id is distinct from v_batch.id
         or v_dependency.operation is distinct from 'create'
         or v_dependency.client_slug is distinct from v_batch.client_slug
         or v_dependency.team is distinct from v_team
         or v_dependency.test_only is distinct from coalesce((v_outbound->>'test_only')::boolean, false)
         or v_dependency.legacy_parity is distinct from coalesce((v_outbound->>'legacy_parity')::boolean, false)
         or v_dependency.payload->>'project_id' is distinct from v_project_id
         or v_dependency.status not in ('pending', 'failed', 'shadow_ok', 'written', 'skipped', 'stale') then
        raise exception 'batch_parent_mapping_missing';
      end if;
      v_parent_ids := public.production_batch_parent_ids_for_team(v_batch.linear_parent_ids, v_team);
      if cardinality(v_parent_ids) > 1 then
        raise exception 'batch_parent_mapping_ambiguous';
      end if;
      if cardinality(v_parent_ids) = 1 then
        v_dependency_parent_id := nullif(btrim(coalesce(
          v_dependency.linear_result->>'issue_id',
          v_dependency.linear_result->>'linear_issue_id',
          v_dependency.linear_result->'issue'->>'id',
          ''
        )), '');
        if v_dependency_parent_id is distinct from v_parent_ids[1] then
          raise exception 'batch_parent_mapping_ambiguous';
        end if;
      end if;
      if v_dependency.status in ('skipped', 'stale') then
        v_terminal_dependency := true;
      end if;
    end if;

    perform public.production_assert_authority(
      v_batch.client_slug,
      v_team,
      coalesce((v_outbound->>'test_only')::boolean, false),
      coalesce((v_outbound->>'legacy_parity')::boolean, false)
    );
    v_replay := public.production_outbox_replay(
      'deliverable',
      v_row->>'id',
      'create',
      v_batch.client_slug,
      v_team,
      nullif(v_event->>'actor', ''),
      nullif(v_event->>'role', ''),
      coalesce((v_outbound->>'test_only')::boolean, false),
      coalesce((v_outbound->>'legacy_parity')::boolean, false),
      v_payload->>'_intent_fingerprint',
      v_outbound->>'dedup_key'
    );
    if v_replay then v_replay_count := v_replay_count + 1; end if;
  end loop;

  if v_replay_count > 0 and v_replay_count <> v_count then
    raise exception 'idempotency_conflict';
  end if;
  if v_replay_count = v_count then
    for v_index in 0..v_count - 1
    loop
      v_row := p_rows->v_index;
      select d.* into v_result from public.deliverables d where d.id = v_row->>'id';
      if not found
         or v_result.batch_id is distinct from v_batch.id
         or v_result.client_slug is distinct from v_batch.client_slug
         or v_result.team is distinct from v_row->>'team'
         or v_result.card_id is distinct from v_row->>'card_id'
         or v_result.title is distinct from v_row->>'title'
         or v_result.sort_key is distinct from (v_row->>'sort_key')::numeric then
        raise exception 'idempotent_result_missing';
      end if;
      v_rows_out := v_rows_out || jsonb_build_array(to_jsonb(v_result));
    end loop;
    return jsonb_build_object('batch', to_jsonb(v_batch), 'items', v_rows_out, 'replay', true);
  end if;
  if v_terminal_dependency then raise exception 'batch_parent_mapping_missing'; end if;

  if v_batch.updated_at is distinct from p_expected_updated_at then
    raise exception 'write_conflict';
  end if;

  select coalesce(max(d.sort_key), -1)
    into v_base_sort
  from public.deliverables d
  where d.batch_id = v_batch.id
    and not exists (
      select 1 from jsonb_array_elements(p_rows) item where item->>'id' = d.id
    );
  select coalesce(max(substring(d.title from '^Video ([1-9][0-9]*)$')::integer), 0)
    into v_base_ordinal
  from public.deliverables d
  where d.batch_id = v_batch.id
    and d.title ~ '^Video [1-9][0-9]*$'
    and not exists (
      select 1 from jsonb_array_elements(p_rows) item where item->>'id' = d.id
    );

  for v_group in
    select item->>'card_id' as card_id, min(ordinality) as first_ordinality
    from jsonb_array_elements(p_rows) with ordinality entries(item, ordinality)
    group by item->>'card_id'
    order by min(ordinality)
  loop
    v_group_index := v_group_index + 1;
    v_expected_sort := v_base_sort + v_group_index;
    v_expected_ordinal := v_base_ordinal + v_group_index;
    if exists (
      select 1
      from jsonb_array_elements(p_rows) item
      where item->>'card_id' = v_group.card_id
        and (
          (item->>'sort_key')::numeric is distinct from v_expected_sort
          or (item->>'_intake_ordinal')::integer is distinct from v_expected_ordinal
          or item->>'title' is distinct from 'Video ' || v_expected_ordinal::text
        )
    ) then
      raise exception 'invalid_intake_append_order';
    end if;
  end loop;

  for v_index in 0..v_count - 1
  loop
    v_row := p_rows->v_index;
    v_event := p_events->v_index;
    v_result := public.production_deliverable_write(v_row - '_intake_ordinal', v_event);
    v_rows_out := v_rows_out || jsonb_build_array(to_jsonb(v_result));
  end loop;

  -- The cursor advances under the same batch lock and transaction as both
  -- children/outbox intents. A concurrent append with this cursor now fails.
  perform set_config('app.event_written', '1', true);
  update public.batches b
  set updated_at = clock_timestamp()
  where b.id = v_batch.id
  returning b.* into v_batch;

  v_first_event := p_events->0;
  insert into public.deliverable_events (
    deliverable_id, batch_id, client_slug, ts, actor, role, action,
    from_status, to_status, source, payload
  ) values (
    null,
    v_batch.id,
    v_batch.client_slug,
    coalesce(nullif(v_first_event->>'ts', '')::timestamptz, now()),
    nullif(v_first_event->>'actor', ''),
    nullif(v_first_event->>'role', ''),
    'intake_append',
    null,
    null,
    'ui',
    jsonb_build_object(
      'surface', nullif(v_first_event->>'surface', ''),
      'item_count', v_count,
      'card_count', v_count / 2
    )
  );

  return jsonb_build_object('batch', to_jsonb(v_batch), 'items', v_rows_out, 'replay', false);
end;
$fn$;
reset check_function_bodies;
REVOKE ALL ON FUNCTION public.production_intake_append(text, timestamptz, jsonb, jsonb)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.production_intake_append(text, timestamptz, jsonb, jsonb)
  TO service_role;

create or replace function public.production_issue_create_linkage(
  p_deliverable_id text,
  p_outbox_id bigint,
  p_expected jsonb,
  p_issue jsonb
) returns public.deliverables
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id text := nullif(btrim(coalesce(p_deliverable_id, '')), '');
  v_expected jsonb := coalesce(p_expected, '{}'::jsonb);
  v_issue jsonb := coalesce(p_issue, '{}'::jsonb);
  v_linear_id text := nullif(btrim(v_issue->>'id'), '');
  v_identifier text := nullif(btrim(v_issue->>'identifier'), '');
  v_url text := nullif(btrim(v_issue->>'url'), '');
  v_outbox public.mirror_outbox%rowtype;
  v_result public.deliverables%rowtype;
  v_current_issue jsonb;
  v_patched_issue jsonb;
  v_has_later_pending boolean;
begin
  if v_id is null
     or p_outbox_id is null
     or p_outbox_id < 1
     or jsonb_typeof(v_expected) is distinct from 'object'
     or jsonb_typeof(v_issue) is distinct from 'object'
     or v_expected->>'id' is distinct from v_id
     or v_linear_id is null
     or v_expected->>'planned_linear_issue_id' is distinct from v_linear_id
     or nullif(btrim(v_expected->>'intent_fingerprint'), '') is null then
    raise exception 'invalid_production_create_linkage';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('production-deliverable:' || v_id, 0));
  select d.* into v_result
  from public.deliverables d
  where d.id = v_id
  for update;
  select o.* into v_outbox
  from public.mirror_outbox o
  where o.id = p_outbox_id
  for share;
  if v_result.id is null
     or v_outbox.id is null
     or v_outbox.entity is distinct from 'deliverable'
     or v_outbox.entity_id is distinct from v_id
     or v_outbox.operation is distinct from 'create'
     or v_outbox.client_slug is distinct from v_result.client_slug
     or v_outbox.team is distinct from v_result.team
     or v_outbox.status not in ('pending', 'failed', 'shadow_ok', 'written')
     or v_outbox.payload->>'planned_linear_issue_id' is distinct from v_linear_id
     or v_outbox.payload->>'_intent_fingerprint'
          is distinct from v_expected->>'intent_fingerprint'
     or v_result.batch_id is distinct from v_expected->>'batch_id'
     or v_result.client_slug is distinct from v_expected->>'client_slug'
     or v_result.team is distinct from v_expected->>'team'
     or v_result.kind is distinct from v_expected->>'kind'
     or v_result.origin is distinct from v_expected->>'origin'
     or coalesce(v_result.card_id, '')
          is distinct from coalesce(nullif(v_expected->>'card_id', ''), '')
     or v_result.created_by is distinct from v_expected->>'created_by'
     or v_result.created_at
          is distinct from nullif(v_expected->>'created_at', '')::timestamptz
     or v_result.linear_issue_uuid is distinct from v_linear_id
     or jsonb_typeof(v_result.linear_raw) is distinct from 'object'
     or jsonb_typeof(v_result.linear_raw->'issue') is distinct from 'object' then
    raise exception 'production_create_linkage_conflict';
  end if;

  v_current_issue := v_result.linear_raw->'issue';
  v_patched_issue := jsonb_set(
    jsonb_set(
      jsonb_set(v_current_issue, '{id}', to_jsonb(v_linear_id), true),
      '{identifier}', coalesce(to_jsonb(v_identifier), 'null'::jsonb), true
    ),
    '{url}', coalesce(to_jsonb(v_url), 'null'::jsonb), true
  );
  select exists (
    select 1
    from public.mirror_outbox o
    where o.entity = 'deliverable'
      and o.entity_id = v_id
      and o.id > p_outbox_id
      and o.status in ('pending', 'failed', 'shadow_ok')
  ) into v_has_later_pending;

  -- This RPC writes its own exact linkage audit row below. Suppress the
  -- generic direct-write guard so one acknowledgement cannot emit a second,
  -- misleading rpc_bypass_guard event.
  perform set_config('app.event_written', '1', true);
  update public.deliverables d
  set linear_issue_uuid = v_linear_id,
      linear_identifier = v_identifier,
      linear_issue_url = v_url,
      linear_raw = jsonb_set(v_result.linear_raw, '{issue}', v_patched_issue, true),
      sync_state = case when v_has_later_pending then 'pending' else 'clean' end,
      updated_at = now()
  where d.id = v_id
  returning d.* into v_result;

  insert into public.deliverable_events(
    deliverable_id, batch_id, client_slug, ts, actor, role, action,
    from_status, to_status, source, payload
  ) values (
    v_result.id,
    v_result.batch_id,
    v_result.client_slug,
    now(),
    'SyncView Mirror',
    'system',
    'mirror_out_create_link',
    v_result.status,
    v_result.status,
    'outbound',
    jsonb_build_object(
      'outbox_id', p_outbox_id,
      'linkage_only', true,
      'later_pending', v_has_later_pending
    )
  );
  return v_result;
end;
$fn$;
REVOKE ALL ON FUNCTION public.production_issue_create_linkage(text, bigint, jsonb, jsonb)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.production_issue_create_linkage(text, bigint, jsonb, jsonb)
  TO service_role;

-- Exact retained pre-v4 browser state: both native children/create intents
-- committed, but no linked Calendar card was materialised before storage was
-- lost. Seed it before the strict F133 card trigger exists so the migration-
-- first recovery path can be proved without reopening that trigger.
INSERT INTO public.batches(
  id, client_slug, team, name, status, created_by, created_at,
  linear_parent_ids
) VALUES (
  'f133-legacy-recovery-batch', 'f133-client', null,
  'Legacy recovery batch', 'active', 'member:f133-proof',
  '2026-08-02T18:30:00.000Z',
  '{"video":"linear-parent-video","graphics":"linear-parent-graphics"}'::jsonb
);
INSERT INTO public.deliverables(
  id, batch_id, client_slug, team, kind, title, status, origin, card_id,
  sort_key, created_by, created_at
) VALUES
  ('f133-legacy-recovery-video', 'f133-legacy-recovery-batch', 'f133-client',
   'video', 'video', 'Video 1', 'in_progress', 'calendar',
   'p_native_legacyrecovery0001_1', 0, 'member:f133-proof',
   '2026-08-02T18:30:00.000Z'),
  ('f133-legacy-recovery-graphic', 'f133-legacy-recovery-batch', 'f133-client',
   'graphics', 'thumbnail', 'Video 1', 'in_progress', 'calendar',
   'p_native_legacyrecovery0001_1', 0, 'member:f133-proof',
   '2026-08-02T18:30:00.000Z');
INSERT INTO public.mirror_outbox(
  deliverable_id, op, payload, entity, entity_id, batch_id, operation,
  client_slug, team, dedup_key, source_edited_at, status, actor, role,
  test_only, legacy_parity, authority_generation
) VALUES
  ('f133-legacy-recovery-video', 'create',
   '{"project_id":"project-video","parent_linear_issue_id":"linear-parent-video","title":"Video 1","status":"in_progress","_intent_fingerprint":"fp-legacy-recovery-video"}',
   'deliverable', 'f133-legacy-recovery-video', 'f133-legacy-recovery-batch',
   'create', 'f133-client', 'video',
   'write-ui:create:deliverable:f133-legacy-recovery-video:legacy-recovery-0001',
   '2026-08-02T18:30:00.000Z', 'pending', 'F133 Proof SMM', 'smm',
   false, true, 7),
  ('f133-legacy-recovery-graphic', 'create',
   '{"project_id":"project-graphics","parent_linear_issue_id":"linear-parent-graphics","title":"Video 1","status":"in_progress","_intent_fingerprint":"fp-legacy-recovery-graphic"}',
   'deliverable', 'f133-legacy-recovery-graphic', 'f133-legacy-recovery-batch',
   'create', 'f133-client', 'graphics',
   'write-ui:create:deliverable:f133-legacy-recovery-graphic:legacy-recovery-0001',
   '2026-08-02T18:30:00.000Z', 'pending', 'F133 Proof SMM', 'smm',
   false, true, 7);

INSERT INTO public.deliverable_events(
  deliverable_id, batch_id, client_slug, ts, actor, role, action,
  from_status, to_status, source, payload
) VALUES
  (
    'f133-legacy-recovery-video', 'f133-legacy-recovery-batch', 'f133-client',
    '2026-08-02T18:30:00.000Z', 'F133 Proof SMM', 'smm', 'create',
    null, 'in_progress', 'ui',
    jsonb_build_object(
      'source', 'ui', 'action', 'create', 'actor', 'F133 Proof SMM',
      'actor_key', 'member:f133-proof', 'role', 'smm', 'auth_kind', 'staff',
      'surface', 'submission', 'ts', '2026-08-02T18:30:00.000Z',
      'from_status', null, 'to_status', 'in_progress',
      'outbound', jsonb_build_object(
        'entity', 'deliverable', 'entity_id', 'f133-legacy-recovery-video',
        'team', 'video', 'operation', 'create',
        'dedup_key', 'write-ui:create:deliverable:f133-legacy-recovery-video:legacy-recovery-0001',
        'source_edited_at', '2026-08-02T18:30:00.000Z',
        'test_only', false, 'legacy_parity', true,
        'payload', '{"project_id":"project-video","parent_linear_issue_id":"linear-parent-video","title":"Video 1","status":"in_progress","_intent_fingerprint":"fp-legacy-recovery-video","_f27_authority_generation":7,"_f27_legacy_parity":true}'::jsonb
      )
    )
  ),
  (
    'f133-legacy-recovery-graphic', 'f133-legacy-recovery-batch', 'f133-client',
    '2026-08-02T18:30:00.000Z', 'F133 Proof SMM', 'smm', 'create',
    null, 'in_progress', 'ui',
    jsonb_build_object(
      'source', 'ui', 'action', 'create', 'actor', 'F133 Proof SMM',
      'actor_key', 'member:f133-proof', 'role', 'smm', 'auth_kind', 'staff',
      'surface', 'submission', 'ts', '2026-08-02T18:30:00.000Z',
      'from_status', null, 'to_status', 'in_progress',
      'outbound', jsonb_build_object(
        'entity', 'deliverable', 'entity_id', 'f133-legacy-recovery-graphic',
        'team', 'graphics', 'operation', 'create',
        'dedup_key', 'write-ui:create:deliverable:f133-legacy-recovery-graphic:legacy-recovery-0001',
        'source_edited_at', '2026-08-02T18:30:00.000Z',
        'test_only', false, 'legacy_parity', true,
        'payload', '{"project_id":"project-graphics","parent_linear_issue_id":"linear-parent-graphics","title":"Video 1","status":"in_progress","_intent_fingerprint":"fp-legacy-recovery-graphic","_f27_authority_generation":7,"_f27_legacy_parity":true}'::jsonb
      )
    )
  );

-- A second exact v3 receipt exercises the still-deployed frozen
-- calendar-upsert INSERT path itself. It is committed before the migration
-- and deliberately has no card yet.
INSERT INTO public.batches(
  id, client_slug, team, name, status, created_by, created_at,
  linear_parent_ids
)
SELECT
  'f133-legacy-frozen-batch', client_slug, team, 'Legacy frozen batch',
  status, created_by, created_at, linear_parent_ids
FROM public.batches WHERE id = 'f133-legacy-recovery-batch';
INSERT INTO public.deliverables(
  id, batch_id, client_slug, team, kind, title, status, origin, card_id,
  sort_key, created_by, created_at
)
SELECT
  case d.team when 'video' then 'f133-legacy-frozen-video'
    else 'f133-legacy-frozen-graphic' end,
  'f133-legacy-frozen-batch', d.client_slug, d.team, d.kind, 'Video 2',
  d.status, d.origin, 'p_native_legacyfrozen0001_2', 1,
  d.created_by, d.created_at
FROM public.deliverables d
WHERE d.id in ('f133-legacy-recovery-video', 'f133-legacy-recovery-graphic');
INSERT INTO public.mirror_outbox(
  deliverable_id, op, payload, attempts, last_error, created_at,
  next_retry_at, locked_at, lock_token, entity, entity_id, batch_id,
  comment_id, operation, client_slug, team, dedup_key, source_edited_at,
  status, actor, role, depends_on_id, updated_at, processed_at, linear_result,
  test_only, legacy_parity, authority_generation
)
SELECT
  case o.team when 'video' then 'f133-legacy-frozen-video'
    else 'f133-legacy-frozen-graphic' end,
  o.op,
  jsonb_set(
    replace(o.payload::text, 'legacy-recovery', 'legacy-frozen')::jsonb,
    '{title}', '"Video 2"'::jsonb
  ),
  o.attempts, o.last_error, o.created_at, o.next_retry_at, o.locked_at,
  o.lock_token, o.entity,
  case o.team when 'video' then 'f133-legacy-frozen-video'
    else 'f133-legacy-frozen-graphic' end,
  'f133-legacy-frozen-batch', o.comment_id, o.operation, o.client_slug,
  o.team,
  replace(replace(o.dedup_key, 'legacy-recovery', 'legacy-frozen'),
    'recovery-0001', 'frozen-0001'),
  o.source_edited_at, o.status, o.actor, o.role, o.depends_on_id, o.updated_at,
  o.processed_at, o.linear_result, o.test_only, o.legacy_parity,
  o.authority_generation
FROM public.mirror_outbox o
WHERE o.entity_id in ('f133-legacy-recovery-video', 'f133-legacy-recovery-graphic');
INSERT INTO public.deliverable_events(
  deliverable_id, batch_id, client_slug, ts, actor, role, action,
  from_status, to_status, source, payload, event_key
)
SELECT
  case e.deliverable_id when 'f133-legacy-recovery-video'
    then 'f133-legacy-frozen-video' else 'f133-legacy-frozen-graphic' end,
  'f133-legacy-frozen-batch', e.client_slug, e.ts, e.actor, e.role, e.action,
  e.from_status, e.to_status, e.source,
  jsonb_set(
    replace(replace(e.payload::text, 'legacy-recovery', 'legacy-frozen'),
      'recovery-0001', 'frozen-0001')::jsonb,
    '{outbound,payload,title}', '"Video 2"'::jsonb
  ),
  e.event_key
FROM public.deliverable_events e
WHERE e.deliverable_id in (
  'f133-legacy-recovery-video', 'f133-legacy-recovery-graphic'
);

\ir ../migrations/2026-08-02-f133-canonical-title.sql

-- A provider-verified create acknowledgement owns the initial exact title
-- value/clock binder. This is the F203 linkage branch; the ordinary branch is
-- source-pinned to write the same completeIssue.updatedAt binder before the
-- downstream conflict tests exercise its value/clock semantics.
DO $$
DECLARE
  v_outbox_id bigint;
  v_result public.deliverables%rowtype;
  v_created_at timestamptz := '2026-08-02T18:40:00.000Z';
  v_provider_at text := '2026-08-02T18:40:03.250Z';
  v_issue_id text := '00000000-0000-4000-8000-00000000f133';
BEGIN
  INSERT INTO public.batches(
    id, client_slug, team, name, status, created_by, created_at
  ) VALUES (
    'f133-create-clock-batch', 'f133-client', 'video',
    'Provider create baseline', 'active', 'member:f133-proof', v_created_at
  );
  INSERT INTO public.deliverables(
    id, batch_id, client_slug, team, kind, title, status, origin,
    created_by, created_at, linear_issue_uuid, linear_raw, sync_state
  ) VALUES (
    'f133-create-clock-deliverable', 'f133-create-clock-batch', 'f133-client',
    'video', 'other', 'Provider create baseline', 'in_progress', 'manual',
    'member:f133-proof', v_created_at, v_issue_id,
    jsonb_build_object('issue', jsonb_build_object(
      'id', v_issue_id,
      'title', 'Provider create baseline',
      'updatedAt', v_created_at
    )),
    'pending'
  );
  INSERT INTO public.mirror_outbox(
    deliverable_id, op, payload, entity, entity_id, batch_id, operation,
    client_slug, team, dedup_key, source_edited_at, status, actor, role,
    test_only, legacy_parity, authority_generation
  ) VALUES (
    'f133-create-clock-deliverable', 'create',
    jsonb_build_object(
      'title', 'Provider create baseline',
      'planned_linear_issue_id', v_issue_id,
      '_intent_fingerprint', 'fp-f133-create-clock'
    ),
    'deliverable', 'f133-create-clock-deliverable', 'f133-create-clock-batch',
    'create', 'f133-client', 'video', 'f133:create-clock:0001',
    v_created_at, 'pending', 'F133 Proof SMM', 'smm', false, false, 7
  ) RETURNING id INTO v_outbox_id;

  v_result := public.production_issue_create_linkage(
    'f133-create-clock-deliverable',
    v_outbox_id,
    jsonb_build_object(
      'id', 'f133-create-clock-deliverable',
      'batch_id', 'f133-create-clock-batch',
      'client_slug', 'f133-client',
      'team', 'video',
      'kind', 'other',
      'origin', 'manual',
      'card_id', null,
      'created_by', 'member:f133-proof',
      'created_at', v_created_at,
      'planned_linear_issue_id', v_issue_id,
      'intent_fingerprint', 'fp-f133-create-clock'
    ),
    jsonb_build_object(
      'id', v_issue_id,
      'identifier', 'VID-F133',
      'url', 'https://linear.app/f133/issue/VID-F133',
      'title', 'Provider create baseline',
      'updated_at', v_provider_at
    )
  );
  IF v_result.linear_raw->'issue'->>'title' IS DISTINCT FROM 'Provider create baseline'
     OR v_result.linear_raw->'issue'->>'updatedAt' IS DISTINCT FROM v_provider_at
     OR v_result.linear_raw->'field_updated_at'->>'title' IS DISTINCT FROM v_provider_at
     OR v_result.linear_identifier IS DISTINCT FROM 'VID-F133'
     OR NOT EXISTS (
       SELECT 1 FROM public.deliverable_events e
       WHERE e.deliverable_id = v_result.id
         AND e.action = 'mirror_out_create_link'
         AND e.payload->>'title_clock_bound' = 'true'
     ) THEN
    RAISE EXCEPTION 'f133_create_ack_title_clock_not_bound';
  END IF;
END $$;

-- Existing numeric slots, not caller state or a deliverable due date, own the
-- Calendar placement cursor. Non-numeric legacy values remain untouched and
-- do not poison allocation.
INSERT INTO public.calendar_posts(
  client, id, order_index, scheduled_date, name
) VALUES
  ('f133-client', 'f133-order-seed', '40', '', 'Existing calendar card'),
  ('f133-client', 'f133-order-legacy', 'not-numeric', '', 'Legacy calendar card'),
  ('f133-client', 'p_cal_settings', null, '', '__cal_settings__');
UPDATE public.calendar_posts
SET caption = '{"collab_mode":true}'
WHERE client = 'f133-client' AND id = 'p_cal_settings';

CREATE OR REPLACE FUNCTION f133_test_fixture.fenced_payload(
  p_title text, p_fingerprint text, p_extra jsonb DEFAULT '{}'
) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $fn$
  SELECT coalesce(p_extra, '{}') || jsonb_build_object(
    'title', p_title,
    '_intent_fingerprint', p_fingerprint,
    '_f27_authority_generation', 7,
    '_f27_legacy_parity', true
  );
$fn$;

CREATE OR REPLACE FUNCTION f133_test_fixture.outbound(
  p_entity text,
  p_entity_id text,
  p_team text,
  p_operation text,
  p_dedup text,
  p_fingerprint text,
  p_title text,
  p_at timestamptz,
  p_extra jsonb DEFAULT '{}'
) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $fn$
  SELECT jsonb_build_object(
    'entity', p_entity,
    'entity_id', p_entity_id,
    'team', p_team,
    'operation', p_operation,
    'dedup_key', p_dedup,
    'source_edited_at', p_at,
    'test_only', false,
    'legacy_parity', true,
    'payload', f133_test_fixture.fenced_payload(p_title, p_fingerprint, p_extra)
  );
$fn$;

-- Mirror the gateway's title envelope. The caller never chooses dependency
-- order; the RPC derives the immediate predecessor/create root under the card
-- lock and the gateway independently verifies the stored chain afterward.
CREATE OR REPLACE FUNCTION f133_test_fixture.title_outbound(
  p_entity_id text,
  p_team text,
  p_dedup text,
  p_fingerprint text,
  p_title text,
  p_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $fn$
BEGIN
  RETURN f133_test_fixture.outbound(
    'deliverable', p_entity_id, p_team, 'title', p_dedup,
    p_fingerprint, p_title, p_at
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION f133_test_fixture.event(
  p_outbound jsonb, p_at timestamptz
) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $fn$
  SELECT jsonb_build_object(
    'actor', 'F133 Proof SMM',
    'actor_key', 'member:f133-proof',
    'auth_kind', 'staff',
    'role', 'smm',
    'source', 'ui',
    'action', 'create',
    'surface', 'submission',
    'ts', p_at,
    'outbound', p_outbound
  );
$fn$;

CREATE OR REPLACE FUNCTION f133_test_fixture.prove_single_team_intake(p_team text)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  v_at timestamptz := CASE p_team
    WHEN 'video' THEN '2026-08-02T18:40:00.000Z'::timestamptz
    ELSE '2026-08-02T18:41:00.000Z'::timestamptz END;
  v_kind text := CASE WHEN p_team = 'video' THEN 'video' ELSE 'thumbnail' END;
  v_batch_id text := 'f133-single-' || p_team || '-batch';
  v_row_id text := 'f133-single-' || p_team || '-row';
  v_card_id text := 'f133-single-' || p_team || '-card';
  v_title text := initcap(p_team) || '-only story';
  v_parent jsonb;
  v_child jsonb;
  v_card jsonb;
  v_result jsonb;
BEGIN
  IF p_team NOT IN ('video', 'graphics') THEN RAISE EXCEPTION 'invalid proof team'; END IF;
  v_parent := f133_test_fixture.event(f133_test_fixture.outbound(
    'batch', v_batch_id, p_team, 'create',
    'f133:single:' || p_team || ':batch', 'fp-single-' || p_team || '-batch',
    v_title || ' batch', v_at,
    jsonb_build_object('project_id', 'project-' || p_team)
  ), v_at);
  v_child := f133_test_fixture.event(f133_test_fixture.outbound(
    'deliverable', v_row_id, p_team, 'create',
    'f133:single:' || p_team || ':row', 'fp-single-' || p_team || '-row',
    v_title, v_at,
    jsonb_build_object('project_id', 'project-' || p_team)
  ), v_at);
  v_card := jsonb_build_object(
    'client', 'f133-client', 'id', v_card_id, 'updated_at', v_at,
    'order_index', '', 'scheduled_date', '', 'name', v_title,
    'status', 'In Progress',
    'video_status', CASE WHEN p_team = 'video' THEN 'In Progress' ELSE '' END,
    'graphic_status', CASE WHEN p_team = 'graphics' THEN 'In Progress' ELSE '' END,
    'caption_status', 'In Progress',
    'video_deliverable_id', CASE WHEN p_team = 'video' THEN v_row_id ELSE null END,
    'graphic_deliverable_id', CASE WHEN p_team = 'graphics' THEN v_row_id ELSE null END
  );
  v_result := public.production_intake_commit(
    'new',
    jsonb_build_object(
      'id', v_batch_id, 'client_slug', 'f133-client', 'team', p_team,
      'name', v_title || ' batch', 'status', 'active',
      'created_by', 'member:f133-proof', 'created_at', v_at,
      'linear_parent_ids', jsonb_build_object(p_team, 'linear-parent-' || p_team)
    ),
    jsonb_build_array(v_parent),
    jsonb_build_array(jsonb_build_object(
      'id', v_row_id, 'batch_id', v_batch_id, 'client_slug', 'f133-client',
      'team', p_team, 'kind', v_kind, 'title', v_title,
      'status', 'in_progress', 'origin', 'calendar', 'card_id', v_card_id,
      'sort_key', 0, 'due_date', '2026-08-15',
      'created_by', 'member:f133-proof', 'created_at', v_at
    )),
    jsonb_build_array(v_child),
    jsonb_build_array(v_card),
    null
  );
  IF v_result->>'replay' IS DISTINCT FROM 'false'
     OR jsonb_array_length(v_result->'items') <> 1
     OR jsonb_array_length(v_result->'cards') <> 1
     OR (SELECT count(*) FROM public.mirror_outbox
         WHERE dedup_key LIKE 'f133:single:' || p_team || ':%') <> 2
     OR NOT EXISTS (
       SELECT 1 FROM public.calendar_posts c
       JOIN public.deliverables d ON d.id = coalesce(
         c.video_deliverable_id, c.graphic_deliverable_id
       )
      WHERE c.id = v_card_id AND c.name = v_title AND d.title = v_title
        AND c.order_index = CASE WHEN p_team = 'video' THEN '41' ELSE '42' END
        AND c.scheduled_date = '' AND d.due_date = '2026-08-15'
        AND d.team = p_team
     ) THEN
    RAISE EXCEPTION 'f133_single_team_intake_failed:%', p_team;
  END IF;
END;
$fn$;

SELECT f133_test_fixture.prove_single_team_intake('video');
SELECT f133_test_fixture.prove_single_team_intake('graphics');

CREATE TEMP TABLE f133_requests (
  request_name text PRIMARY KEY,
  batch jsonb NOT NULL,
  parent_events jsonb NOT NULL,
  rows_data jsonb NOT NULL,
  events jsonb NOT NULL,
  cards jsonb NOT NULL,
  result jsonb
);

WITH input AS (
  SELECT '2026-08-02T19:00:00.000Z'::timestamptz AS at
), plan AS (
  SELECT
    jsonb_build_object(
      'id', 'f133-paired-batch',
      'client_slug', 'f133-client',
      'team', null,
      'name', 'Paired batch',
      'status', 'active',
      'created_by', 'member:f133-proof',
      'created_at', at,
      'linear_parent_ids', jsonb_build_object(
        'video', 'linear-parent-video',
        'graphics', 'linear-parent-graphics'
      )
    ) AS batch,
    jsonb_build_array(
      f133_test_fixture.event(f133_test_fixture.outbound(
        'batch', 'f133-paired-batch', 'video', 'create',
        'f133:paired:batch:video', 'fp-paired-batch-video', 'Paired batch', at,
        jsonb_build_object('project_id', 'project-video')
      ), at),
      f133_test_fixture.event(f133_test_fixture.outbound(
        'batch', 'f133-paired-batch', 'graphics', 'create',
        'f133:paired:batch:graphics', 'fp-paired-batch-graphics', 'Paired batch', at,
        jsonb_build_object('project_id', 'project-graphics')
      ), at)
    ) AS parents,
    jsonb_build_array(
      jsonb_build_object(
        'id', 'f133-paired-video-1', 'batch_id', 'f133-paired-batch',
        'client_slug', 'f133-client', 'team', 'video', 'kind', 'video',
        'title', 'Launch Story', 'status', 'in_progress',
        'origin', 'calendar', 'card_id', 'f133-paired-card-1',
        'sort_key', 0, 'created_by', 'member:f133-proof', 'created_at', at
      ),
      jsonb_build_object(
        'id', 'f133-paired-graphic-1', 'batch_id', 'f133-paired-batch',
        'client_slug', 'f133-client', 'team', 'graphics', 'kind', 'thumbnail',
        'title', 'Launch Story', 'status', 'in_progress',
        'origin', 'calendar', 'card_id', 'f133-paired-card-1',
        'sort_key', 0, 'created_by', 'member:f133-proof', 'created_at', at
      )
    ) AS rows_data,
    jsonb_build_array(
      f133_test_fixture.event(f133_test_fixture.outbound(
        'deliverable', 'f133-paired-video-1', 'video', 'create',
        'f133:paired:video:1', 'fp-paired-video-1', 'Launch Story', at,
        jsonb_build_object('project_id', 'project-video')
      ), at),
      f133_test_fixture.event(f133_test_fixture.outbound(
        'deliverable', 'f133-paired-graphic-1', 'graphics', 'create',
        'f133:paired:graphic:1', 'fp-paired-graphic-1', 'Launch Story', at,
        jsonb_build_object('project_id', 'project-graphics')
      ), at)
    ) AS events,
    jsonb_build_array(jsonb_build_object(
      'client', 'f133-client', 'id', 'f133-paired-card-1',
      'updated_at', '2026-08-02T19:00:00.000Z', 'order_index', '',
      'scheduled_date', '', 'name', 'Launch Story',
      'status', 'In Progress', 'video_status', 'In Progress',
      'graphic_status', 'In Progress', 'caption_status', 'In Progress',
      'video_deliverable_id', 'f133-paired-video-1',
      'graphic_deliverable_id', 'f133-paired-graphic-1'
    )) AS cards
  FROM input
)
INSERT INTO f133_requests(request_name, batch, parent_events, rows_data, events, cards)
SELECT 'paired-new', batch, parents, rows_data, events, cards FROM plan;

UPDATE f133_requests
SET result = public.production_intake_commit(
  'new', batch, parent_events, rows_data, events, cards, null
)
WHERE request_name = 'paired-new';

DO $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT result INTO v_result FROM f133_requests WHERE request_name = 'paired-new';
  IF v_result->>'replay' IS DISTINCT FROM 'false'
     OR jsonb_array_length(v_result->'items') <> 2
     OR jsonb_array_length(v_result->'cards') <> 1
     OR (SELECT count(*) FROM public.batches WHERE id = 'f133-paired-batch') <> 1
     OR (SELECT count(*) FROM public.deliverables WHERE batch_id = 'f133-paired-batch') <> 2
     OR (SELECT count(*) FROM public.calendar_posts WHERE id = 'f133-paired-card-1') <> 1
     OR (SELECT count(*) FROM public.mirror_outbox WHERE dedup_key LIKE 'f133:paired:%') <> 4
     OR EXISTS (
       SELECT 1 FROM public.deliverables
       WHERE batch_id = 'f133-paired-batch' AND title <> 'Launch Story'
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.calendar_posts
       WHERE id = 'f133-paired-card-1' AND name = 'Launch Story'
         AND order_index = '43' AND scheduled_date = ''
         AND video_deliverable_id = 'f133-paired-video-1'
         AND graphic_deliverable_id = 'f133-paired-graphic-1'
     ) THEN
    RAISE EXCEPTION 'f133_paired_intake_not_atomic';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION f133_test_fixture.prove_paired_multiple_intake()
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  v_at timestamptz := '2026-08-02T19:02:00.000Z';
  v_rows jsonb := '[]';
  v_events jsonb := '[]';
  v_cards jsonb := '[]';
  v_result jsonb;
  v_number integer;
  v_team text;
  v_id text;
BEGIN
  FOR v_number IN 1..2 LOOP
    FOREACH v_team IN ARRAY ARRAY['video', 'graphics'] LOOP
      v_id := 'f133-multi-' || v_team || '-' || v_number::text;
      v_rows := v_rows || jsonb_build_array(jsonb_build_object(
        'id', v_id, 'batch_id', 'f133-multi-batch',
        'client_slug', 'f133-client', 'team', v_team,
        'kind', CASE WHEN v_team = 'video' THEN 'video' ELSE 'thumbnail' END,
        'title', 'Duplicate campaign title', 'status', 'in_progress',
        'origin', 'calendar', 'card_id', 'f133-multi-card-' || v_number::text,
        'sort_key', v_number - 1, 'due_date', '2026-08-' || (20 + v_number)::text,
        'created_by', 'member:f133-proof', 'created_at', v_at
      ));
      v_events := v_events || jsonb_build_array(f133_test_fixture.event(
        f133_test_fixture.outbound(
          'deliverable', v_id, v_team, 'create',
          'f133:multi:' || v_team || ':' || v_number::text,
          'fp-multi-' || v_team || '-' || v_number::text,
          'Duplicate campaign title', v_at,
          jsonb_build_object('project_id', 'project-' || v_team)
        ), v_at
      ));
    END LOOP;
    v_cards := v_cards || jsonb_build_array(jsonb_build_object(
      'client', 'f133-client', 'id', 'f133-multi-card-' || v_number::text,
      'updated_at', v_at, 'order_index', '', 'scheduled_date', '',
      'name', 'Duplicate campaign title', 'status', 'In Progress',
      'video_status', 'In Progress', 'graphic_status', 'In Progress',
      'caption_status', 'In Progress',
      'video_deliverable_id', 'f133-multi-video-' || v_number::text,
      'graphic_deliverable_id', 'f133-multi-graphics-' || v_number::text
    ));
  END LOOP;
  v_result := public.production_intake_commit(
    'new',
    jsonb_build_object(
      'id', 'f133-multi-batch', 'client_slug', 'f133-client', 'team', null,
      'name', 'Multiple posts', 'status', 'active',
      'created_by', 'member:f133-proof', 'created_at', v_at,
      'linear_parent_ids', jsonb_build_object(
        'video', 'linear-parent-video', 'graphics', 'linear-parent-graphics'
      )
    ),
    jsonb_build_array(
      f133_test_fixture.event(f133_test_fixture.outbound(
        'batch', 'f133-multi-batch', 'video', 'create',
        'f133:multi:batch:video', 'fp-multi-batch-video', 'Multiple posts', v_at,
        jsonb_build_object('project_id', 'project-video')
      ), v_at),
      f133_test_fixture.event(f133_test_fixture.outbound(
        'batch', 'f133-multi-batch', 'graphics', 'create',
        'f133:multi:batch:graphics', 'fp-multi-batch-graphics', 'Multiple posts', v_at,
        jsonb_build_object('project_id', 'project-graphics')
      ), v_at)
    ),
    v_rows, v_events, v_cards, null
  );
  IF jsonb_array_length(v_result->'items') <> 4
     OR jsonb_array_length(v_result->'cards') <> 2
     OR (SELECT count(*) FROM public.mirror_outbox
         WHERE dedup_key LIKE 'f133:multi:%') <> 6
     OR (SELECT count(*) FROM public.calendar_posts
         WHERE id LIKE 'f133-multi-card-%' AND name = 'Duplicate campaign title') <> 2
     OR NOT EXISTS (
       SELECT 1 FROM public.calendar_posts
       WHERE id = 'f133-multi-card-1' AND order_index = '44' AND scheduled_date = ''
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.calendar_posts
       WHERE id = 'f133-multi-card-2' AND order_index = '45' AND scheduled_date = ''
     )
     OR (SELECT count(*) FROM public.deliverables
         WHERE batch_id = 'f133-multi-batch' AND title = 'Duplicate campaign title') <> 4
     OR (SELECT count(*) FROM public.deliverables
         WHERE batch_id = 'f133-multi-batch' AND due_date IS NOT NULL) <> 4 THEN
    RAISE EXCEPTION 'f133_paired_multiple_intake_failed';
  END IF;
END;
$fn$;

SELECT f133_test_fixture.prove_paired_multiple_intake();

-- A lost response reuses the exact request. It returns the committed card and
-- rows without a second event, outbox, or materialisation write.
DO $$
DECLARE
  v_request f133_requests%rowtype;
  v_replay jsonb;
  v_events_before bigint;
  v_outbox_before bigint;
BEGIN
  SELECT * INTO v_request FROM f133_requests WHERE request_name = 'paired-new';
  SELECT count(*) INTO v_events_before FROM public.deliverable_events;
  SELECT count(*) INTO v_outbox_before FROM public.mirror_outbox;
  v_replay := public.production_intake_commit(
    'new', v_request.batch, v_request.parent_events, v_request.rows_data,
    v_request.events, v_request.cards, null
  );
  IF v_replay->>'replay' IS DISTINCT FROM 'true'
     OR (SELECT count(*) FROM public.deliverable_events) <> v_events_before
     OR (SELECT count(*) FROM public.mirror_outbox) <> v_outbox_before
     OR (SELECT order_index FROM public.calendar_posts
         WHERE id = 'f133-paired-card-1') <> '43' THEN
    RAISE EXCEPTION 'f133_intake_lost_response_replay_failed';
  END IF;
  UPDATE public.syncview_runtime_flags
  SET value = '{"video":"syncview","graphics":"syncview"}'::jsonb
  WHERE key = 'prod_authority';
  UPDATE public.syncview_runtime_flags
  SET value = '{"enabled":false}'::jsonb
  WHERE key = 'linear_legacy_parity_enabled';
  v_replay := public.production_intake_commit(
    'new', v_request.batch, v_request.parent_events, v_request.rows_data,
    v_request.events, v_request.cards, null
  );
  IF v_replay->>'replay' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'f133_intake_replay_current_authority_dependent';
  END IF;
  UPDATE public.syncview_runtime_flags
  SET value = '{"video":"linear","graphics":"linear"}'::jsonb
  WHERE key = 'prod_authority';
  UPDATE public.syncview_runtime_flags
  SET value = '{"enabled":true}'::jsonb
  WHERE key = 'linear_legacy_parity_enabled';
END $$;

-- The public service surface is commit, not append. Invoke an exact commit
-- replay while SET ROLE service_role; SECURITY DEFINER must still be able to
-- make the nested append call after append's direct EXECUTE was revoked.
CREATE TEMP TABLE f133_service_commit_receipts(result jsonb NOT NULL);
GRANT SELECT ON f133_requests TO service_role;
GRANT SELECT, INSERT ON f133_service_commit_receipts TO service_role;
SET ROLE service_role;
INSERT INTO f133_service_commit_receipts(result)
SELECT public.production_intake_commit(
  'new', batch, parent_events, rows_data, events, cards, null
)
FROM f133_requests WHERE request_name = 'paired-new';
RESET ROLE;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM f133_service_commit_receipts
    WHERE result->>'replay' = 'true'
      AND jsonb_array_length(result->'items') = 2
      AND jsonb_array_length(result->'cards') = 1
  ) THEN
    RAISE EXCEPTION 'f133_service_commit_nested_append_failed';
  END IF;
END $$;

-- Caller placement and schedule values are never adopted, even on an otherwise
-- exact replay. The rejected request leaves the original server slot intact.
DO $$
DECLARE
  v_request f133_requests%rowtype;
  v_placeholder_rows jsonb;
BEGIN
  SELECT * INTO v_request FROM f133_requests WHERE request_name = 'paired-new';
  BEGIN
    PERFORM public.production_intake_commit(
      'new', v_request.batch, v_request.parent_events, v_request.rows_data,
      v_request.events,
      jsonb_set(v_request.cards, '{0,order_index}', '"999"'::jsonb),
      null
    );
    RAISE EXCEPTION 'f133_caller_order_unexpectedly_accepted';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'invalid_intake_card_payload' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.production_intake_commit(
      'new', v_request.batch, v_request.parent_events, v_request.rows_data,
      v_request.events,
      jsonb_set(v_request.cards, '{0,scheduled_date}', '"2026-08-15"'::jsonb),
      null
    );
    RAISE EXCEPTION 'f133_caller_schedule_unexpectedly_accepted';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'invalid_intake_card_payload' THEN RAISE; END IF;
  END;
  v_placeholder_rows := jsonb_set(
    jsonb_set(v_request.rows_data, '{0,title}', '"Graphic 1"'::jsonb),
    '{1,title}', '"Graphic 1"'::jsonb
  );
  BEGIN
    PERFORM public.production_intake_commit(
      'new', v_request.batch, v_request.parent_events, v_placeholder_rows,
      v_request.events,
      jsonb_set(v_request.cards, '{0,name}', '"Graphic 1"'::jsonb),
      null
    );
    RAISE EXCEPTION 'f133_generic_placeholder_unexpectedly_committed';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'invalid_intake_card_payload' THEN RAISE; END IF;
  END;
  IF (SELECT order_index FROM public.calendar_posts
      WHERE id = 'f133-paired-card-1') <> '43'
     OR (SELECT scheduled_date FROM public.calendar_posts
         WHERE id = 'f133-paired-card-1') <> ''
     OR position('pg_advisory_xact_lock' in pg_get_functiondef(
          'public.production_intake_commit(text,jsonb,jsonb,jsonb,jsonb,jsonb,timestamp with time zone)'::regprocedure
        )) = 0
     OR position('f133-calendar-order:' in pg_get_functiondef(
          'public.production_intake_commit(text,jsonb,jsonb,jsonb,jsonb,jsonb,timestamp with time zone)'::regprocedure
        )) = 0 THEN
    RAISE EXCEPTION 'f133_server_calendar_order_contract_failed';
  END IF;
END $$;

-- Frozen writers retain unrelated-field and same-value saves, but cannot
-- create a linked row or mutate the canonical name.
DO $$
BEGIN
  UPDATE public.calendar_posts SET caption = 'safe unrelated save'
  WHERE client = 'f133-client' AND id = 'f133-paired-card-1';
  UPDATE public.calendar_posts SET name = 'Launch Story'
  WHERE client = 'f133-client' AND id = 'f133-paired-card-1';
  BEGIN
    UPDATE public.calendar_posts SET name = 'stale browser overwrite'
    WHERE client = 'f133-client' AND id = 'f133-paired-card-1';
    RAISE EXCEPTION 'f133_linked_card_guard_did_not_fail';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE 'f133_linked_card_title_requires_canonical_rpc:%' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.calendar_posts(
      client, id, name, video_deliverable_id
    ) VALUES ('f133-client', 'f133-illegal-linked', 'Illegal', 'f133-paired-video-1');
    RAISE EXCEPTION 'f133_linked_insert_guard_did_not_fail';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE 'f133_linked_card_insert_requires_canonical_rpc:%' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.calendar_posts
    SET graphic_deliverable_id = null
    WHERE client = 'f133-client' AND id = 'f133-paired-card-1';
    RAISE EXCEPTION 'f133_linkage_change_guard_did_not_fail';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE 'f133_linked_card_linkage_requires_canonical_rpc:%' THEN RAISE; END IF;
  END;
  INSERT INTO public.calendar_posts(client, id, name)
  VALUES ('f133-client', 'f133-unlinked-card', 'Visible placeholder');
  UPDATE public.calendar_posts SET name = 'Explicit visible placeholder'
  WHERE client = 'f133-client' AND id = 'f133-unlinked-card';
END $$;

-- Migration-first compatibility stays exact: the frozen v3 card insert is
-- accepted from its receipt both before and after activation, while a v4
-- marker or any non-default caller field still makes the same guard go red.
DO $$
DECLARE
  v_updated_at text := to_char(
    statement_timestamp() at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
BEGIN
  IF (SELECT value FROM public.syncview_runtime_flags
      WHERE key = 'f133_canonical_title_enabled')
     IS DISTINCT FROM '{"enabled":false}'::jsonb THEN
    RAISE EXCEPTION 'f133_v3_compatibility_off_fixture_invalid';
  END IF;
  INSERT INTO public.calendar_posts(
    client, id, updated_at, order_index, scheduled_date, name,
    status, video_status, graphic_status, caption_status,
    asset_url, thumbnail_url, caption, cta, tweaks,
    video_tweaks, graphic_tweaks, caption_tweaks,
    linear_issue_id, graphic_linear_issue_id,
    video_deliverable_id, graphic_deliverable_id
  ) VALUES (
    'f133-client', 'p_native_legacyfrozen0001_2', v_updated_at,
    '0', '', 'Video 2',
    'In Progress', 'In Progress', 'In Progress', 'In Progress',
    '', '', '', '', '', '', '', '', '', '',
    'f133-legacy-frozen-video', 'f133-legacy-frozen-graphic'
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.calendar_posts c
    WHERE c.client = 'f133-client'
      AND c.id = 'p_native_legacyfrozen0001_2'
      AND c.name = 'Video 2'
  ) THEN
    RAISE EXCEPTION 'f133_v3_compatibility_off_failed';
  END IF;

  DELETE FROM public.calendar_posts
  WHERE client = 'f133-client' AND id = 'p_native_legacyfrozen0001_2';
  UPDATE public.syncview_runtime_flags
  SET value = '{"enabled":true}'::jsonb
  WHERE key = 'f133_canonical_title_enabled';
  INSERT INTO public.calendar_posts(
    client, id, updated_at, order_index, scheduled_date, name,
    status, video_status, graphic_status, caption_status,
    asset_url, thumbnail_url, caption, cta, tweaks,
    video_tweaks, graphic_tweaks, caption_tweaks,
    linear_issue_id, graphic_linear_issue_id,
    video_deliverable_id, graphic_deliverable_id
  ) VALUES (
    'f133-client', 'p_native_legacyfrozen0001_2', v_updated_at,
    '0', '', 'Video 2',
    'In Progress', 'In Progress', 'In Progress', 'In Progress',
    '', '', '', '', '', '', '', '', '', '',
    'f133-legacy-frozen-video', 'f133-legacy-frozen-graphic'
  );

  BEGIN
    DELETE FROM public.calendar_posts
    WHERE client = 'f133-client' AND id = 'p_native_legacyfrozen0001_2';
    UPDATE public.mirror_outbox
    SET payload = payload || '{"_intake_version":4}'::jsonb
    WHERE entity_id in ('f133-legacy-frozen-video', 'f133-legacy-frozen-graphic')
      AND operation = 'create';
    INSERT INTO public.calendar_posts(
      client, id, updated_at, order_index, scheduled_date, name,
      status, video_status, graphic_status, caption_status,
      asset_url, thumbnail_url, caption, cta, tweaks,
      video_tweaks, graphic_tweaks, caption_tweaks,
      video_deliverable_id, graphic_deliverable_id
    ) VALUES (
      'f133-client', 'p_native_legacyfrozen0001_2', v_updated_at,
      '0', '', 'Video 2',
      'In Progress', 'In Progress', 'In Progress', 'In Progress',
      '', '', '', '', '', '', '', '',
      'f133-legacy-frozen-video', 'f133-legacy-frozen-graphic'
    );
    RAISE EXCEPTION 'f133_v4_receipt_entered_v3_compatibility';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE 'f133_linked_card_insert_requires_canonical_rpc:%' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    DELETE FROM public.calendar_posts
    WHERE client = 'f133-client' AND id = 'p_native_legacyfrozen0001_2';
    INSERT INTO public.calendar_posts(
      client, id, updated_at, order_index, scheduled_date, name,
      status, video_status, graphic_status, caption_status,
      asset_url, thumbnail_url, caption, cta, tweaks,
      video_tweaks, graphic_tweaks, caption_tweaks,
      video_deliverable_id, graphic_deliverable_id
    ) VALUES (
      'f133-client', 'p_native_legacyfrozen0001_2', v_updated_at,
      '0', '', 'Video 2',
      'In Progress', 'In Progress', 'In Progress', 'In Progress',
      '', '', 'caller-controlled hidden value', '', '', '', '', '',
      'f133-legacy-frozen-video', 'f133-legacy-frozen-graphic'
    );
    RAISE EXCEPTION 'f133_v3_compatibility_arbitrary_field_accepted';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE 'f133_linked_card_insert_requires_canonical_rpc:%' THEN
      RAISE;
    END IF;
  END;
  UPDATE public.syncview_runtime_flags
  SET value = '{"enabled":false}'::jsonb
  WHERE key = 'f133_canonical_title_enabled';
END $$;

CREATE TEMP TABLE f133_recovery_receipts(result jsonb NOT NULL);
GRANT SELECT, INSERT ON f133_recovery_receipts TO service_role;
SET ROLE service_role;
INSERT INTO f133_recovery_receipts(result)
SELECT public.production_intake_card_adopt(
  'legacy-recovery-0001', 'p_native_legacyrecovery0001_1', 'member:f133-proof'
);
INSERT INTO f133_recovery_receipts(result)
SELECT public.production_intake_card_adopt(
  'legacy-recovery-0001', 'p_native_legacyrecovery0001_1', 'member:f133-proof'
);
RESET ROLE;
DO $$
DECLARE
  v_first jsonb;
  v_second jsonb;
BEGIN
  SELECT result INTO v_first FROM f133_recovery_receipts
  ORDER BY ctid LIMIT 1;
  SELECT result INTO v_second FROM f133_recovery_receipts
  ORDER BY ctid DESC LIMIT 1;
  IF v_first->>'replayed' IS DISTINCT FROM 'false'
     OR v_second->>'replayed' IS DISTINCT FROM 'true'
     OR v_first->'card'->>'name' IS DISTINCT FROM 'Video 1'
     OR jsonb_array_length(v_first->'rows') <> 2
     OR NOT EXISTS (
       SELECT 1 FROM public.calendar_posts c
       WHERE c.client = 'f133-client' AND c.id = 'p_native_legacyrecovery0001_1'
         AND c.name = 'Video 1'
         AND c.video_deliverable_id = 'f133-legacy-recovery-video'
         AND c.graphic_deliverable_id = 'f133-legacy-recovery-graphic'
     )
     OR has_function_privilege(
       'service_role',
       'public.production_intake_append(text,timestamp with time zone,jsonb,jsonb)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.production_intake_commit(text,jsonb,jsonb,jsonb,jsonb,jsonb,timestamp with time zone)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.production_intake_card_adopt(text,text,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'f133_migration_first_recovery_or_acl_failed';
  END IF;
END $$;

UPDATE public.calendar_posts
SET kasper_approved_at = '2026-08-02T19:05:00.000Z',
    client_video_approved_at = '2026-08-02T19:06:00.000Z',
    client_graphic_approved_at = '2026-08-02T19:07:00.000Z'
WHERE client = 'f133-client' AND id = 'f133-paired-card-1';
UPDATE public.deliverables SET status = CASE team
  WHEN 'video' THEN 'approved' ELSE 'tweak' END
WHERE id IN ('f133-paired-video-1', 'f133-paired-graphic-1');
-- Reproduce the live F133 split: Calendar already has the human title while
-- the Graphics deliverable still has its old generated placeholder.
DO $$
BEGIN
  PERFORM set_config('app.f133_canonical_title_write', '1', true);
  UPDATE public.deliverables SET title = 'Graphic 1'
  WHERE id = 'f133-paired-graphic-1';
END $$;

CREATE TEMP TABLE f133_title_requests(
  request_name text PRIMARY KEY,
  card jsonb NOT NULL,
  event jsonb NOT NULL,
  result jsonb
);
WITH input AS (
  SELECT '2026-08-02T19:10:00.000Z'::timestamptz AS at
), plan AS (
  SELECT
    jsonb_build_object(
      'surface', 'calendar',
      'client_slug', 'f133-client',
      'card_id', 'f133-paired-card-1',
      'expected_title', 'Launch Story',
      'expected_title_revision', 0,
      'expected_deliverable_titles', jsonb_build_object(
        'f133-paired-video-1', 'Launch Story',
        'f133-paired-graphic-1', 'Graphic 1'
      ),
      'title', '  Campaign   Launch  ',
      'outbounds', jsonb_build_array(
        f133_test_fixture.title_outbound(
          'f133-paired-video-1', 'video',
          'f133:title:paired:video', 'fp-title-paired-video',
          'Campaign Launch', at
        ),
        f133_test_fixture.title_outbound(
          'f133-paired-graphic-1', 'graphics',
          'f133:title:paired:graphics', 'fp-title-paired-graphics',
          'Campaign Launch', at
        )
      )
    ) AS card,
    jsonb_build_object(
      'event_key', 'production-title:f133-paired-card-1:title-request-1',
      'ts', at,
      'actor', 'F133 Proof SMM',
      'actor_key', 'member:f133-proof',
      'role', 'smm',
      'auth_kind', 'staff',
      'source', 'ui',
      'action', 'title_change',
      'surface', 'calendar',
      'from_title', 'Launch Story',
      'from_title_revision', 0,
      'to_title', 'Campaign Launch'
    ) AS event
  FROM input
)
INSERT INTO f133_title_requests(request_name, card, event)
SELECT 'paired-title', card, event FROM plan;

UPDATE f133_title_requests
SET result = public.production_canonical_title_write(card, event)
WHERE request_name = 'paired-title';

DO $$
DECLARE v_result jsonb;
BEGIN
  SELECT result INTO v_result FROM f133_title_requests WHERE request_name = 'paired-title';
  IF v_result->>'replayed' IS DISTINCT FROM 'false'
     OR jsonb_typeof(v_result->'superseded') IS DISTINCT FROM 'boolean'
     OR v_result->>'superseded' IS DISTINCT FROM 'false'
     OR v_result->>'noop' IS DISTINCT FROM 'false'
     OR nullif(v_result->>'committed_at', '') IS NULL
     OR jsonb_array_length(v_result->'rows') <> 2
     OR jsonb_array_length(v_result->'outbox_ids') <> 2
     OR v_result->'card'->>'name' IS DISTINCT FROM 'Campaign Launch'
     OR EXISTS (
       SELECT 1 FROM public.deliverables
       WHERE id IN ('f133-paired-video-1', 'f133-paired-graphic-1')
         AND title IS DISTINCT FROM 'Campaign Launch'
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.deliverables
       WHERE id = 'f133-paired-video-1' AND status = 'approved'
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.deliverables
       WHERE id = 'f133-paired-graphic-1' AND status = 'tweak'
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.calendar_posts
       WHERE id = 'f133-paired-card-1'
         AND kasper_approved_at = '2026-08-02T19:05:00.000Z'
         AND client_video_approved_at = '2026-08-02T19:06:00.000Z'
         AND client_graphic_approved_at = '2026-08-02T19:07:00.000Z'
     )
     OR (SELECT count(*) FROM public.deliverable_events
         WHERE action = 'title_change' AND payload->>'card_id' = 'f133-paired-card-1') <> 1
     OR NOT EXISTS (
       SELECT 1 FROM public.deliverable_events
       WHERE action = 'title_change'
         AND payload->>'card_id' = 'f133-paired-card-1'
         AND payload->'expected_deliverable_titles' = jsonb_build_object(
           'f133-paired-video-1', 'Launch Story',
           'f133-paired-graphic-1', 'Graphic 1'
         )
         AND (payload->>'client_edited_at')::timestamptz
           = '2026-08-02T19:10:00.000Z'::timestamptz
         AND ts = (v_result->>'committed_at')::timestamptz
         AND id = (v_result->>'event_id')::bigint
     )
     OR EXISTS (
       SELECT 1 FROM public.deliverable_events
       WHERE action = 'title_change' AND payload ? 'outbound'
     )
     OR (SELECT count(*) FROM public.mirror_outbox
         WHERE operation = 'title' AND entity_id IN (
           'f133-paired-video-1', 'f133-paired-graphic-1'
         )) <> 2
     OR EXISTS (
       SELECT 1 FROM public.mirror_outbox
       WHERE operation = 'title'
         AND entity_id IN ('f133-paired-video-1', 'f133-paired-graphic-1')
         AND (
           status <> 'pending' OR legacy_parity IS DISTINCT FROM true
           OR authority_generation <> 7 OR payload->>'title' <> 'Campaign Launch'
           OR source_edited_at IS DISTINCT FROM (v_result->>'committed_at')::timestamptz
           OR depends_on_id IS DISTINCT FROM (
             SELECT create_row.id FROM public.mirror_outbox create_row
             WHERE create_row.entity = 'deliverable'
               AND create_row.entity_id = mirror_outbox.entity_id
               AND create_row.operation = 'create'
           )
           OR payload ? '_f27_authority_generation'
           OR payload ? '_f27_legacy_parity'
         )
     ) THEN
    RAISE EXCEPTION 'f133_title_transaction_not_exact';
  END IF;
END $$;

-- A create dependency is a wait, not a failure attempt. Exercise nine claim
-- and unlock cycles (past MAX_ATTEMPTS=8), then terminalize the exact creates,
-- install their provider identities, and terminalize the two dependent title
-- intents without changing their dependency binders.
DO $$
DECLARE
  v_cycle integer;
BEGIN
  FOR v_cycle IN 1..9 LOOP
    UPDATE public.mirror_outbox
    SET lock_token = (
          '00000000-0000-4000-8000-' || lpad(v_cycle::text, 12, '0')
        )::uuid,
        locked_at = clock_timestamp()
    WHERE dedup_key IN ('f133:title:paired:video', 'f133:title:paired:graphics');
    UPDATE public.mirror_outbox
    SET lock_token = null,
        locked_at = null,
        next_retry_at = clock_timestamp() + interval '15 seconds',
        updated_at = clock_timestamp()
    WHERE dedup_key IN ('f133:title:paired:video', 'f133:title:paired:graphics');
    IF EXISTS (
      SELECT 1 FROM public.mirror_outbox
      WHERE dedup_key IN ('f133:title:paired:video', 'f133:title:paired:graphics')
        AND attempts <> 0
    ) THEN
      RAISE EXCEPTION 'f133_dependency_wait_spent_attempt:%', v_cycle;
    END IF;
  END LOOP;

  UPDATE public.mirror_outbox
  SET status = 'written', attempts = 1, processed_at = clock_timestamp(),
      linear_result = CASE entity_id
        WHEN 'f133-paired-video-1' THEN jsonb_build_object(
          'issue_id', '00000000-0000-4000-8000-0000000000c1',
          'identifier', 'CAL-V', 'url', 'https://linear.app/f133/issue/CAL-V'
        )
        ELSE jsonb_build_object(
          'issue_id', '00000000-0000-4000-8000-0000000000c2',
          'identifier', 'CAL-G', 'url', 'https://linear.app/f133/issue/CAL-G'
        )
      END
  WHERE operation = 'create'
    AND entity_id IN ('f133-paired-video-1', 'f133-paired-graphic-1');

  UPDATE public.deliverables
  SET linear_issue_uuid = CASE team
        WHEN 'video' THEN '00000000-0000-4000-8000-0000000000c1'
        ELSE '00000000-0000-4000-8000-0000000000c2' END,
      linear_identifier = CASE team WHEN 'video' THEN 'CAL-V' ELSE 'CAL-G' END,
      linear_issue_url = CASE team
        WHEN 'video' THEN 'https://linear.app/f133/issue/CAL-V'
        ELSE 'https://linear.app/f133/issue/CAL-G' END,
      linear_raw = jsonb_build_object('issue', jsonb_build_object(
        'id', CASE team
          WHEN 'video' THEN '00000000-0000-4000-8000-0000000000c1'
          ELSE '00000000-0000-4000-8000-0000000000c2' END,
        'identifier', CASE team WHEN 'video' THEN 'CAL-V' ELSE 'CAL-G' END,
        'url', CASE team
          WHEN 'video' THEN 'https://linear.app/f133/issue/CAL-V'
          ELSE 'https://linear.app/f133/issue/CAL-G' END
      ))
  WHERE id IN ('f133-paired-video-1', 'f133-paired-graphic-1');

  UPDATE public.mirror_outbox
  SET status = 'written', attempts = 1, processed_at = clock_timestamp(),
      linear_result = jsonb_build_object('mutation', 'issueUpdate')
  WHERE dedup_key IN ('f133:title:paired:video', 'f133:title:paired:graphics');

  IF EXISTS (
       SELECT 1 FROM public.mirror_outbox title_row
       JOIN public.mirror_outbox create_row ON create_row.id = title_row.depends_on_id
       JOIN public.deliverables d ON d.id = title_row.entity_id
       WHERE title_row.dedup_key IN (
         'f133:title:paired:video', 'f133:title:paired:graphics'
       ) AND (
         title_row.status <> 'written' OR title_row.attempts <> 1
         OR create_row.status <> 'written' OR create_row.attempts <> 1
         OR d.linear_issue_uuid IS NULL
       )
     ) OR (
       SELECT count(*) FROM public.mirror_outbox
       WHERE dedup_key IN ('f133:title:paired:video', 'f133:title:paired:graphics')
     ) <> 2 THEN
    RAISE EXCEPTION 'f133_dependency_terminal_linkage_failed';
  END IF;
END $$;

-- Lost response retry: the old bases are intentionally stale now, so only the
-- exact durable outbox/event identities can authorize this replay.
DO $$
DECLARE
  v_request f133_title_requests%rowtype;
  v_replay jsonb;
  v_events_before bigint;
  v_outbox_before bigint;
BEGIN
  SELECT * INTO v_request FROM f133_title_requests WHERE request_name = 'paired-title';
  SELECT count(*) INTO v_events_before FROM public.deliverable_events;
  SELECT count(*) INTO v_outbox_before FROM public.mirror_outbox;
  v_replay := public.production_canonical_title_write(v_request.card, v_request.event);
  IF v_replay->>'replayed' IS DISTINCT FROM 'true'
     OR jsonb_array_length(v_replay->'outbox_ids') <> 2
     OR v_replay->>'event_id' IS DISTINCT FROM v_request.result->>'event_id'
     OR (SELECT count(*) FROM public.deliverable_events) <> v_events_before
     OR (SELECT count(*) FROM public.mirror_outbox) <> v_outbox_before THEN
    RAISE EXCEPTION 'f133_title_lost_response_replay_failed';
  END IF;
END $$;

-- Durable replay is a readback of the original authorized commit. Current
-- authority/parity may change after a lost acknowledgement without turning
-- that readback into a second authorization decision.
DO $$
DECLARE
  v_request f133_title_requests%rowtype;
  v_replay jsonb;
BEGIN
  SELECT * INTO v_request FROM f133_title_requests WHERE request_name = 'paired-title';
  UPDATE public.syncview_runtime_flags
  SET value = '{"video":"syncview","graphics":"syncview"}'::jsonb
  WHERE key = 'prod_authority';
  UPDATE public.syncview_runtime_flags
  SET value = '{"enabled":false}'::jsonb
  WHERE key = 'linear_legacy_parity_enabled';
  v_replay := public.production_canonical_title_write(v_request.card, v_request.event);
  IF v_replay->>'replayed' IS DISTINCT FROM 'true'
     OR v_replay->>'superseded' IS DISTINCT FROM 'false'
     OR v_replay->'card'->>'name' IS DISTINCT FROM 'Campaign Launch' THEN
    RAISE EXCEPTION 'f133_title_replay_current_authority_dependent';
  END IF;
  UPDATE public.syncview_runtime_flags
  SET value = '{"video":"linear","graphics":"linear"}'::jsonb
  WHERE key = 'prod_authority';
  UPDATE public.syncview_runtime_flags
  SET value = '{"enabled":true}'::jsonb
  WHERE key = 'linear_legacy_parity_enabled';
END $$;

-- A replay receipt is exact inventory, not just matching dedup keys. Seeded
-- event and F27-binder drift must fail, and each subtransaction rolls its
-- sabotage back before the next assertion.
DO $$
DECLARE v_request f133_title_requests%rowtype;
BEGIN
  SELECT * INTO v_request FROM f133_title_requests WHERE request_name = 'paired-title';
  BEGIN
    UPDATE public.deliverable_events
    SET payload = jsonb_set(payload, '{deliverable_count}', '99'::jsonb)
    WHERE event_key = v_request.event->>'event_key';
    PERFORM public.production_canonical_title_write(v_request.card, v_request.event);
    RAISE EXCEPTION 'f133_drifted_title_event_unexpectedly_replayed';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'idempotent_result_missing' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.deliverable_events
    SET payload = jsonb_set(
      payload, '{actor_key}', to_jsonb('member:f133-drift'::text)
    )
    WHERE event_key = v_request.event->>'event_key';
    PERFORM public.production_canonical_title_write(v_request.card, v_request.event);
    RAISE EXCEPTION 'f133_drifted_title_actor_key_unexpectedly_replayed';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'idempotent_result_missing' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.mirror_outbox SET authority_generation = 99
    WHERE dedup_key = 'f133:title:paired:video';
    PERFORM public.production_canonical_title_write(v_request.card, v_request.event);
    RAISE EXCEPTION 'f133_drifted_title_outbox_unexpectedly_replayed';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'idempotent_result_missing' THEN RAISE; END IF;
  END;
END $$;

-- A historical card pasted through a browser editor may contain noncanonical
-- whitespace. The gateway carries its canonical base, but raw inequality must
-- still perform one repair transaction rather than being mistaken for a no-op.
DO $$
BEGIN
  PERFORM set_config('app.f133_canonical_title_write', '1', true);
  UPDATE public.calendar_posts SET name = '  Campaign   Launch  '
  WHERE client = 'f133-client' AND id = 'f133-paired-card-1';
END $$;
DO $$
DECLARE
  v_at timestamptz := '2026-08-02T19:10:30.000Z';
  v_result jsonb;
BEGIN
  v_result := public.production_canonical_title_write(
    jsonb_build_object(
      'surface', 'calendar', 'client_slug', 'f133-client',
      'card_id', 'f133-paired-card-1', 'expected_title', 'Campaign Launch',
      'expected_title_revision', 1,
      'expected_deliverable_titles', jsonb_build_object(
        'f133-paired-video-1', 'Campaign Launch',
        'f133-paired-graphic-1', 'Campaign Launch'
      ),
      'title', 'Campaign Launch',
      'outbounds', jsonb_build_array(
        f133_test_fixture.title_outbound('f133-paired-video-1', 'video',
          'f133:title:whitespace:video', 'fp-title-whitespace-video',
          'Campaign Launch', v_at),
        f133_test_fixture.title_outbound('f133-paired-graphic-1', 'graphics',
          'f133:title:whitespace:graphics', 'fp-title-whitespace-graphics',
          'Campaign Launch', v_at)
      )
    ),
    jsonb_build_object(
      'event_key', 'production-title:f133-paired-card-1:whitespace', 'ts', v_at,
      'actor', 'F133 Proof SMM', 'actor_key', 'member:f133-proof',
      'role', 'smm', 'auth_kind', 'staff', 'source', 'ui',
      'action', 'title_change', 'surface', 'calendar',
      'from_title', 'Campaign Launch', 'to_title', 'Campaign Launch'
      , 'from_title_revision', 1
    )
  );
  IF v_result->>'noop' IS DISTINCT FROM 'false'
     OR jsonb_array_length(v_result->'outbox_ids') <> 2
     OR (SELECT name FROM public.calendar_posts
         WHERE client = 'f133-client' AND id = 'f133-paired-card-1') <> 'Campaign Launch'
     OR NOT EXISTS (
       SELECT 1 FROM public.deliverable_events
       WHERE event_key = 'production-title:f133-paired-card-1:whitespace'
         AND payload->>'from_title' = '  Campaign   Launch  '
         AND payload->>'title' = 'Campaign Launch'
     ) THEN
    RAISE EXCEPTION 'f133_whitespace_base_repair_failed';
  END IF;
END $$;

-- Fresh exact same-value edit is a no-op: no event and no mirror intent.
DO $$
DECLARE
  v_result jsonb;
  v_events_before bigint;
  v_outbox_before bigint;
  v_at timestamptz := '2026-08-02T19:11:00.000Z';
BEGIN
  SELECT count(*) INTO v_events_before FROM public.deliverable_events;
  SELECT count(*) INTO v_outbox_before FROM public.mirror_outbox;
  v_result := public.production_canonical_title_write(
    jsonb_build_object(
      'surface', 'calendar', 'client_slug', 'f133-client',
      'card_id', 'f133-paired-card-1', 'expected_title', 'Campaign Launch',
      'expected_title_revision', 2,
      'expected_deliverable_titles', jsonb_build_object(
        'f133-paired-video-1', 'Campaign Launch',
        'f133-paired-graphic-1', 'Campaign Launch'
      ),
      'title', 'Campaign Launch',
      'outbounds', '[]'::jsonb
    ),
    jsonb_build_object(
      'event_key', 'production-title:f133-paired-card-1:noop', 'ts', v_at,
      'actor', 'F133 Proof SMM', 'actor_key', 'member:f133-proof',
      'role', 'smm', 'auth_kind', 'staff', 'source', 'ui',
      'action', 'title_change', 'surface', 'calendar',
      'from_title', 'Campaign Launch', 'to_title', 'Campaign Launch'
      , 'from_title_revision', 2
    )
  );
  IF v_result->>'noop' IS DISTINCT FROM 'true'
     OR jsonb_typeof(v_result->'superseded') IS DISTINCT FROM 'boolean'
     OR v_result->>'superseded' IS DISTINCT FROM 'false'
     OR jsonb_array_length(v_result->'outbox_ids') <> 0
     OR (SELECT count(*) FROM public.deliverable_events) <> v_events_before
     OR (SELECT count(*) FROM public.mirror_outbox) <> v_outbox_before THEN
    RAISE EXCEPTION 'f133_title_noop_not_exact';
  END IF;
END $$;

-- The service-only RPC accepts the gateway's already-authenticated Calendar
-- collaborative-client principal, while still refusing that principal on
-- Samples or when the server-owned Collaborative setting is not true.
DO $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.production_canonical_title_write(
    jsonb_build_object(
      'surface', 'calendar', 'client_slug', 'f133-client',
      'card_id', 'f133-paired-card-1', 'expected_title', 'Campaign Launch',
      'expected_title_revision', 2,
      'expected_deliverable_titles', jsonb_build_object(
        'f133-paired-video-1', 'Campaign Launch',
        'f133-paired-graphic-1', 'Campaign Launch'
      ),
      'title', 'Campaign Launch', 'outbounds', '[]'::jsonb
    ),
    jsonb_build_object(
      'event_key', 'production-title:f133-paired-card-1:client-noop',
      'ts', '2026-08-02T19:11:30.000Z',
      'actor', 'F133 Proof Client', 'actor_key', 'client:f133-client',
      'role', 'client', 'auth_kind', 'client',
      'source', 'ui', 'action', 'title_change', 'surface', 'calendar',
      'from_title', 'Campaign Launch', 'to_title', 'Campaign Launch'
      , 'from_title_revision', 2
    )
  );
  IF v_result->>'noop' IS DISTINCT FROM 'true'
     OR jsonb_array_length(v_result->'outbox_ids') <> 0 THEN
    RAISE EXCEPTION 'f133_calendar_client_title_contract_failed';
  END IF;
END $$;

-- The Calendar client binder is exact: the slug-bound actor key may commit
-- through the service-only RPC, and its exact durable replay remains valid if
-- Collaborative mode is later switched off.
DO $$
DECLARE
  v_at timestamptz := '2026-08-02T19:11:40.000Z';
  v_card jsonb;
  v_event jsonb;
  v_result jsonb;
BEGIN
  v_card := jsonb_build_object(
    'surface', 'calendar', 'client_slug', 'f133-client',
    'card_id', 'f133-single-video-card', 'expected_title', 'Video-only story',
    'expected_title_revision', 0,
    'expected_deliverable_titles', jsonb_build_object(
      'f133-single-video-row', 'Video-only story'
    ),
    'title', 'Client canonical title',
    'outbounds', jsonb_build_array(f133_test_fixture.title_outbound(
      'f133-single-video-row', 'video',
      'f133:title:client:video', 'fp-title-client-video',
      'Client canonical title', v_at
    ))
  );
  v_event := jsonb_build_object(
    'event_key', 'production-title:f133-single-video-card:client-1',
    'ts', v_at, 'actor', 'F133 Proof Client',
    'actor_key', 'client:f133-client', 'role', 'client', 'auth_kind', 'client',
    'source', 'ui', 'action', 'title_change', 'surface', 'calendar',
    'from_title', 'Video-only story', 'to_title', 'Client canonical title'
    , 'from_title_revision', 0
  );
  v_result := public.production_canonical_title_write(v_card, v_event);
  IF v_result->>'replayed' IS DISTINCT FROM 'false'
     OR v_result->'card'->>'name' IS DISTINCT FROM 'Client canonical title'
     OR jsonb_array_length(v_result->'outbox_ids') <> 1 THEN
    RAISE EXCEPTION 'f133_calendar_client_title_mutation_failed';
  END IF;
  UPDATE public.calendar_posts SET caption = '{"collab_mode":false}'
  WHERE client = 'f133-client' AND id = 'p_cal_settings';
  v_result := public.production_canonical_title_write(v_card, v_event);
  IF v_result->>'replayed' IS DISTINCT FROM 'true'
     OR v_result->>'superseded' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'f133_calendar_client_replay_depended_on_current_collab';
  END IF;
  UPDATE public.calendar_posts SET caption = '{"collab_mode":true}'
  WHERE client = 'f133-client' AND id = 'p_cal_settings';
END $$;

-- A different request from a stale tab has no durable replay right. CAS must
-- fail with zero residue after the newer title is committed.
DO $$
DECLARE
  v_events_before bigint;
  v_outbox_before bigint;
  v_at timestamptz := '2026-08-02T19:12:00.000Z';
BEGIN
  SELECT count(*) INTO v_events_before FROM public.deliverable_events;
  SELECT count(*) INTO v_outbox_before FROM public.mirror_outbox;
  BEGIN
    PERFORM public.production_canonical_title_write(
      jsonb_build_object(
        'surface', 'calendar', 'client_slug', 'f133-client',
        'card_id', 'f133-paired-card-1', 'expected_title', 'Launch Story',
        'expected_title_revision', 0,
        'expected_deliverable_titles', jsonb_build_object(
          'f133-paired-video-1', 'Launch Story',
          'f133-paired-graphic-1', 'Launch Story'
        ),
        'title', 'Stale Tab Title',
        'outbounds', jsonb_build_array(
          f133_test_fixture.title_outbound('f133-paired-video-1', 'video',
            'f133:title:stale:video', 'fp-title-stale-video', 'Stale Tab Title', v_at),
          f133_test_fixture.title_outbound('f133-paired-graphic-1', 'graphics',
            'f133:title:stale:graphics', 'fp-title-stale-graphics', 'Stale Tab Title', v_at)
        )
      ),
      jsonb_build_object(
        'event_key', 'production-title:f133-paired-card-1:stale', 'ts', v_at,
        'actor', 'F133 Proof SMM', 'actor_key', 'member:f133-proof',
        'role', 'smm', 'auth_kind', 'staff', 'source', 'ui',
        'action', 'title_change', 'surface', 'calendar',
        'from_title', 'Launch Story', 'to_title', 'Stale Tab Title'
        , 'from_title_revision', 0
      )
    );
    RAISE EXCEPTION 'f133_stale_cas_unexpectedly_succeeded';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'canonical_title_write_conflict' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM public.deliverable_events) <> v_events_before
     OR (SELECT count(*) FROM public.mirror_outbox) <> v_outbox_before
     OR (SELECT name FROM public.calendar_posts WHERE id = 'f133-paired-card-1') <> 'Campaign Launch' THEN
    RAISE EXCEPTION 'f133_stale_cas_left_residue';
  END IF;
END $$;

-- Card and linked-row bases are independent CAS axes. Also prove that two
-- linked entities cannot share one dedup identity before anything mutates.
DO $$
DECLARE
  v_events_before bigint;
  v_outbox_before bigint;
  v_at timestamptz := '2026-08-02T19:13:00.000Z';
BEGIN
  SELECT count(*) INTO v_events_before FROM public.deliverable_events;
  SELECT count(*) INTO v_outbox_before FROM public.mirror_outbox;
  BEGIN
    PERFORM public.production_canonical_title_write(
      jsonb_build_object(
        'surface', 'calendar', 'client_slug', 'f133-client',
        'card_id', 'f133-paired-card-1', 'expected_title', 'Launch Story',
        'expected_title_revision', 2,
        'expected_deliverable_titles', jsonb_build_object(
          'f133-paired-video-1', 'Campaign Launch',
          'f133-paired-graphic-1', 'Campaign Launch'
        ),
        'title', 'Card Base Must Fail',
        'outbounds', jsonb_build_array(
          f133_test_fixture.title_outbound('f133-paired-video-1', 'video',
            'f133:title:card-base:video', 'fp-card-base-video', 'Card Base Must Fail', v_at),
          f133_test_fixture.title_outbound('f133-paired-graphic-1', 'graphics',
            'f133:title:card-base:graphics', 'fp-card-base-graphics', 'Card Base Must Fail', v_at)
        )
      ),
      jsonb_build_object(
        'event_key', 'production-title:f133-paired-card-1:card-base', 'ts', v_at,
        'actor', 'F133 Proof SMM', 'actor_key', 'member:f133-proof',
        'role', 'smm', 'auth_kind', 'staff', 'source', 'ui',
        'action', 'title_change', 'surface', 'calendar',
        'from_title', 'Launch Story', 'to_title', 'Card Base Must Fail'
        , 'from_title_revision', 2
      )
    );
    RAISE EXCEPTION 'f133_card_only_cas_unexpectedly_succeeded';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'canonical_title_write_conflict' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.production_canonical_title_write(
      jsonb_build_object(
        'surface', 'calendar', 'client_slug', 'f133-client',
        'card_id', 'f133-paired-card-1', 'expected_title', 'Campaign Launch',
        'expected_title_revision', 2,
        'expected_deliverable_titles', jsonb_build_object(
          'f133-paired-video-1', 'Campaign Launch',
          'f133-paired-graphic-1', 'Launch Story'
        ),
        'title', 'Row Base Must Fail',
        'outbounds', jsonb_build_array(
          f133_test_fixture.title_outbound('f133-paired-video-1', 'video',
            'f133:title:row-base:video', 'fp-row-base-video', 'Row Base Must Fail', v_at),
          f133_test_fixture.title_outbound('f133-paired-graphic-1', 'graphics',
            'f133:title:row-base:graphics', 'fp-row-base-graphics', 'Row Base Must Fail', v_at)
        )
      ),
      jsonb_build_object(
        'event_key', 'production-title:f133-paired-card-1:row-base', 'ts', v_at,
        'actor', 'F133 Proof SMM', 'actor_key', 'member:f133-proof',
        'role', 'smm', 'auth_kind', 'staff', 'source', 'ui',
        'action', 'title_change', 'surface', 'calendar',
        'from_title', 'Campaign Launch', 'to_title', 'Row Base Must Fail'
        , 'from_title_revision', 2
      )
    );
    RAISE EXCEPTION 'f133_row_only_cas_unexpectedly_succeeded';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'canonical_title_write_conflict' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.production_canonical_title_write(
      jsonb_build_object(
        'surface', 'calendar', 'client_slug', 'f133-client',
        'card_id', 'f133-paired-card-1', 'expected_title', 'Campaign Launch',
        'expected_title_revision', 2,
        'expected_deliverable_titles', jsonb_build_object(
          'f133-paired-video-1', 'Campaign Launch',
          'f133-paired-graphic-1', 'Campaign Launch'
        ),
        'title', 'Duplicate Dedup Must Fail',
        'outbounds', jsonb_build_array(
          f133_test_fixture.title_outbound('f133-paired-video-1', 'video',
            'f133:title:duplicate', 'fp-duplicate-video', 'Duplicate Dedup Must Fail', v_at),
          f133_test_fixture.title_outbound('f133-paired-graphic-1', 'graphics',
            'f133:title:duplicate', 'fp-duplicate-graphics', 'Duplicate Dedup Must Fail', v_at)
        )
      ),
      jsonb_build_object(
        'event_key', 'production-title:f133-paired-card-1:duplicate-dedup', 'ts', v_at,
        'actor', 'F133 Proof SMM', 'actor_key', 'member:f133-proof',
        'role', 'smm', 'auth_kind', 'staff', 'source', 'ui',
        'action', 'title_change', 'surface', 'calendar',
        'from_title', 'Campaign Launch', 'to_title', 'Duplicate Dedup Must Fail'
        , 'from_title_revision', 2
      )
    );
    RAISE EXCEPTION 'f133_duplicate_title_dedup_unexpectedly_succeeded';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'invalid_canonical_title_outbound' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM public.deliverable_events) <> v_events_before
     OR (SELECT count(*) FROM public.mirror_outbox) <> v_outbox_before
     OR (SELECT name FROM public.calendar_posts WHERE id = 'f133-paired-card-1') <> 'Campaign Launch' THEN
    RAISE EXCEPTION 'f133_independent_cas_or_dedup_left_residue';
  END IF;
END $$;

-- Samples uses the same canonical transaction and can repair the same
-- pre-existing split without changing review state.
DO $$
BEGIN
  INSERT INTO public.batches(id, client_slug, team, name, status, created_by)
  VALUES ('f133-samples-batch', 'f133-client', null, 'Samples batch', 'active', 'f133-proof');
  INSERT INTO public.deliverables(
    id, batch_id, client_slug, team, kind, title, status, origin, card_id, sort_key
  ) VALUES
    ('f133-samples-video', 'f133-samples-batch', 'f133-client', 'video', 'video',
      'Sample human title', 'approved', 'samples', 'f133-samples-card', 0),
    ('f133-samples-graphic', 'f133-samples-batch', 'f133-client', 'graphics', 'thumbnail',
      'Graphic 7', 'tweak', 'samples', 'f133-samples-card', 0);
  PERFORM set_config('app.f133_canonical_title_write', '1', true);
  INSERT INTO public.sample_reviews(
    client, id, updated_at, name, status, video_status, graphic_status,
    linear_issue_id, graphic_linear_issue_id,
    kasper_approved_at, kasper_approved_by,
    video_deliverable_id, graphic_deliverable_id
  ) VALUES (
    'f133-client', 'f133-samples-card', '2026-08-02T19:19:00.000Z',
    'Sample human title', 'In Progress', 'Approved', 'Tweaks Needed',
    '', '',
    '2026-08-02T19:18:00.000Z', 'F133 Reviewer',
    'f133-samples-video', 'f133-samples-graphic'
  );
END $$;

-- The create-linkage acknowledgement updates only the source card slot whose
-- deliverable id exactly matches the changed row. Prove both teams on both
-- native card surfaces, plus rollback of the deliverable URL on mismatch.
DO $$
BEGIN
  UPDATE public.deliverables
  SET linear_issue_uuid = '00000000-0000-4000-8000-0000000000c1',
      linear_identifier = 'CAL-V',
      linear_issue_url = 'https://linear.app/f133/issue/CAL-V',
      linear_raw = jsonb_build_object('issue', jsonb_build_object(
        'id', '00000000-0000-4000-8000-0000000000c1',
        'identifier', 'CAL-V', 'url', 'https://linear.app/f133/issue/CAL-V'
      ))
  WHERE id = 'f133-paired-video-1';
  UPDATE public.deliverables
  SET linear_issue_uuid = '00000000-0000-4000-8000-0000000000c2',
      linear_identifier = 'CAL-G',
      linear_issue_url = 'https://linear.app/f133/issue/CAL-G',
      linear_raw = jsonb_build_object('issue', jsonb_build_object(
        'id', '00000000-0000-4000-8000-0000000000c2',
        'identifier', 'CAL-G', 'url', 'https://linear.app/f133/issue/CAL-G'
      ))
  WHERE id = 'f133-paired-graphic-1';
  UPDATE public.deliverables
  SET linear_issue_uuid = '00000000-0000-4000-8000-0000000000d1',
      linear_identifier = 'SXR-V',
      linear_issue_url = 'https://linear.app/f133/issue/SXR-V',
      linear_raw = jsonb_build_object('issue', jsonb_build_object(
        'id', '00000000-0000-4000-8000-0000000000d1',
        'identifier', 'SXR-V', 'url', 'https://linear.app/f133/issue/SXR-V'
      ))
  WHERE id = 'f133-samples-video';
  UPDATE public.deliverables
  SET linear_issue_uuid = '00000000-0000-4000-8000-0000000000d2',
      linear_identifier = 'SXR-G',
      linear_issue_url = 'https://linear.app/f133/issue/SXR-G',
      linear_raw = jsonb_build_object('issue', jsonb_build_object(
        'id', '00000000-0000-4000-8000-0000000000d2',
        'identifier', 'SXR-G', 'url', 'https://linear.app/f133/issue/SXR-G'
      ))
  WHERE id = 'f133-samples-graphic';

  IF NOT EXISTS (
       SELECT 1 FROM public.calendar_posts
       WHERE client = 'f133-client' AND id = 'f133-paired-card-1'
         AND linear_issue_id = 'https://linear.app/f133/issue/CAL-V'
         AND graphic_linear_issue_id = 'https://linear.app/f133/issue/CAL-G'
     ) OR NOT EXISTS (
       SELECT 1 FROM public.sample_reviews
       WHERE client = 'f133-client' AND id = 'f133-samples-card'
         AND linear_issue_id = 'https://linear.app/f133/issue/SXR-V'
         AND graphic_linear_issue_id = 'https://linear.app/f133/issue/SXR-G'
     ) THEN
    RAISE EXCEPTION 'f133_linear_link_projection_failed';
  END IF;

  INSERT INTO public.calendar_posts(client, id, name)
  VALUES ('f133-client', 'f133-link-mismatch-card', 'Projection mismatch proof');
  INSERT INTO public.batches(id, client_slug, team, name, status, created_by)
  VALUES (
    'f133-link-mismatch-batch', 'f133-client', 'video',
    'Projection mismatch proof', 'active', 'f133-proof'
  );
  INSERT INTO public.deliverables(
    id, batch_id, client_slug, team, kind, title, status, origin, card_id, sort_key
  ) VALUES (
    'f133-link-mismatch-row', 'f133-link-mismatch-batch', 'f133-client',
    'video', 'video', 'Projection mismatch proof', 'in_progress',
    'calendar', 'f133-link-mismatch-card', 99
  );
  BEGIN
    UPDATE public.deliverables
    SET linear_issue_url = 'https://linear.app/f133/issue/MISMATCH'
    WHERE id = 'f133-link-mismatch-row';
    RAISE EXCEPTION 'f133_linear_link_mismatch_unexpectedly_succeeded';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE 'f133_linear_link_projection_mismatch:%' THEN RAISE; END IF;
  END;
  IF (SELECT linear_issue_url FROM public.deliverables
      WHERE id = 'f133-link-mismatch-row') IS NOT NULL THEN
    RAISE EXCEPTION 'f133_linear_link_mismatch_left_residue';
  END IF;
END $$;

DO $$
DECLARE
  v_at timestamptz := '2026-08-02T19:20:00.000Z';
  v_result jsonb;
BEGIN
  v_result := public.production_canonical_title_write(
    jsonb_build_object(
      'surface', 'samples', 'client_slug', 'f133-client',
      'card_id', 'f133-samples-card', 'expected_title', 'Sample human title',
      'expected_title_revision', 0,
      'expected_deliverable_titles', jsonb_build_object(
        'f133-samples-video', 'Sample human title',
        'f133-samples-graphic', 'Graphic 7'
      ),
      'title', 'Sample canonical title',
      'outbounds', jsonb_build_array(
        f133_test_fixture.title_outbound('f133-samples-video', 'video',
          'f133:title:samples:video', 'fp-title-samples-video',
          'Sample canonical title', v_at),
        f133_test_fixture.title_outbound('f133-samples-graphic', 'graphics',
          'f133:title:samples:graphics', 'fp-title-samples-graphics',
          'Sample canonical title', v_at)
      )
    ),
    jsonb_build_object(
      'event_key', 'production-title:f133-samples-card:1', 'ts', v_at,
      'actor', 'F133 Proof SMM', 'actor_key', 'member:f133-proof',
      'role', 'smm', 'auth_kind', 'staff', 'source', 'ui',
      'action', 'title_change', 'surface', 'samples',
      'from_title', 'Sample human title', 'to_title', 'Sample canonical title'
      , 'from_title_revision', 0
    )
  );
  IF v_result->'card'->>'name' <> 'Sample canonical title'
     OR jsonb_array_length(v_result->'rows') <> 2
     OR jsonb_array_length(v_result->'outbox_ids') <> 2
     OR EXISTS (
       SELECT 1 FROM public.deliverables
       WHERE id IN ('f133-samples-video', 'f133-samples-graphic')
         AND title <> 'Sample canonical title'
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.sample_reviews
       WHERE id = 'f133-samples-card'
         AND name = 'Sample canonical title'
         AND status = 'In Progress'
         AND video_status = 'Approved'
         AND graphic_status = 'Tweaks Needed'
         AND kasper_approved_at = '2026-08-02T19:18:00.000Z'
         AND kasper_approved_by = 'F133 Reviewer'
  ) THEN
    RAISE EXCEPTION 'f133_samples_title_transaction_failed';
  END IF;
END $$;

-- Cross-source order is server commit order for UI CAS, provider time for
-- Linear. The browser edit was authored at T1 but accepted at database T3;
-- a delayed Linear delivery at T2 (T1 < T2 < T3) must be stale. Then prove an
-- accepted inbound rename, exact replay, eventful same-value clock advance,
-- literal `%/_` delivery identity, and a later stale delivery with zero raw or
-- canonical residue.
DO $$
DECLARE
  v_ui_commit_at timestamptz;
  v_ui_client_at timestamptz;
  v_delayed_at timestamptz;
  v_prior_card_at timestamptz;
  v_request jsonb;
  v_result jsonb;
  v_replay jsonb;
  v_noop_request jsonb;
  v_events_before bigint;
  v_outbox_before bigint;
  v_raw_before jsonb;
BEGIN
  SELECT e.ts, (e.payload->>'client_edited_at')::timestamptz
    INTO STRICT v_ui_commit_at, v_ui_client_at
  FROM public.deliverable_events e
  WHERE e.event_key = 'production-title:f133-samples-card:1';
  -- Linear webhook clocks arrive through Date.toISOString(), so every provider
  -- timestamp in this fixture has the same millisecond precision as runtime.
  v_delayed_at := date_trunc(
    'milliseconds', v_ui_commit_at - interval '1 second'
  );
  IF NOT (v_ui_client_at < v_delayed_at AND v_delayed_at < v_ui_commit_at) THEN
    RAISE EXCEPTION 'f133_offline_clock_fixture_invalid';
  END IF;
  SELECT linear_raw INTO v_raw_before FROM public.deliverables
  WHERE id = 'f133-samples-video';
  SELECT count(*) INTO v_events_before FROM public.deliverable_events;
  SELECT count(*) INTO v_outbox_before FROM public.mirror_outbox;
  v_result := public.production_canonical_title_from_linear(jsonb_build_object(
    'source_deliverable_id', 'f133-samples-video',
    'source_issue_uuid', '00000000-0000-4000-8000-0000000000d1',
    'source_identifier', 'SXR-V',
    'source_issue_url', 'https://linear.app/f133/issue/SXR-V',
    'delivery_id', 'f133-offline-delayed-1',
    'source_edited_at', v_delayed_at,
    'title', 'Delayed older Linear title'
  ));
  IF v_result->>'stale' IS DISTINCT FROM 'true'
     OR v_result->>'noop' IS DISTINCT FROM 'true'
     OR v_result->>'replayed' IS DISTINCT FROM 'false'
     OR v_result->>'current_title' IS DISTINCT FROM 'Sample canonical title'
     OR v_result->>'outbox_count' IS DISTINCT FROM '0'
     OR v_result->>'event_id' IS NOT NULL OR v_result->>'event_key' IS NOT NULL
     OR (SELECT count(*) FROM public.deliverable_events) <> v_events_before
     OR (SELECT count(*) FROM public.mirror_outbox) <> v_outbox_before
     OR (SELECT linear_raw FROM public.deliverables
         WHERE id = 'f133-samples-video') IS DISTINCT FROM v_raw_before
     OR EXISTS (
       SELECT 1 FROM public.deliverables
       WHERE id IN ('f133-samples-video', 'f133-samples-graphic')
         AND title <> 'Sample canonical title'
     ) THEN
    RAISE EXCEPTION 'f133_offline_ui_commit_clock_failed';
  END IF;

  -- Same card id on another surface is deliberately outside this clock.
  INSERT INTO public.deliverable_events(
    deliverable_id, batch_id, client_slug, ts, actor, role, action,
    source, payload, event_key
  ) VALUES (
    null, 'f133-samples-batch', 'f133-client', v_ui_commit_at + interval '10 minutes',
    'F133 decoy', 'system', 'title_change', 'mirror',
    jsonb_build_object(
      'surface', 'calendar', 'card_id', 'f133-samples-card',
      'title', 'Wrong surface decoy', 'delivery_id', 'f133-cross-surface-decoy'
    ), 'f133-cross-surface-decoy'
  );

  -- An unrelated card save can be newer than the provider field timestamp.
  -- Canonical title acceptance must not move the browser merge cursor back.
  v_prior_card_at := v_ui_commit_at + interval '5 seconds';
  UPDATE public.sample_reviews
  SET updated_at = to_char(
    v_prior_card_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  )
  WHERE client = 'f133-client' AND id = 'f133-samples-card';

  v_request := jsonb_build_object(
    'source_deliverable_id', 'f133-samples-video',
    'source_issue_uuid', '00000000-0000-4000-8000-0000000000d1',
    'source_identifier', 'SXR-V',
    'source_issue_url', 'https://linear.app/f133/issue/SXR-V',
    'delivery_id', 'f133-linear-accepted-1',
    'source_edited_at', date_trunc(
      'milliseconds', v_ui_commit_at + interval '1 second'
    ),
    'title', 'Linear canonical title'
  );
  v_result := public.production_canonical_title_from_linear(v_request);
  IF v_result->>'stale' IS DISTINCT FROM 'false'
     OR v_result->>'noop' IS DISTINCT FROM 'false'
     OR v_result->>'replayed' IS DISTINCT FROM 'false'
     OR v_result->>'test_only' IS DISTINCT FROM 'false'
     OR v_result->>'outbox_count' IS DISTINCT FROM '1'
     OR v_result->'card'->>'name' IS DISTINCT FROM 'Linear canonical title'
     OR (v_result->'card'->>'updated_at')::timestamptz <= v_prior_card_at
     OR EXISTS (
       SELECT 1 FROM public.deliverables
       WHERE id IN ('f133-samples-video', 'f133-samples-graphic')
         AND title <> 'Linear canonical title'
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.deliverables d
       WHERE d.id = 'f133-samples-video'
         AND d.linear_raw->'issue'->>'title' = 'Linear canonical title'
         AND (d.linear_raw->'field_updated_at'->>'title')::timestamptz
           = (v_request->>'source_edited_at')::timestamptz
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.deliverable_events e
       WHERE e.id = (v_result->>'event_id')::bigint
         AND e.source = 'mirror' AND e.actor = 'Linear inbound'
         AND e.role = 'system' AND e.action = 'title_change'
         AND e.payload->>'surface' = 'samples'
         AND e.payload->>'delivery_id' = 'f133-linear-accepted-1'
         AND e.payload->>'test_only' = 'false'
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.mirror_outbox o
       WHERE o.id = (v_result->'outbox_ids'->>0)::bigint
         AND o.entity_id = 'f133-samples-graphic'
         AND o.operation = 'title' AND o.payload->>'title' = 'Linear canonical title'
         AND o.test_only IS false AND o.legacy_parity IS true
         AND public.production_canonical_title_dependency_valid(o.id)
     )
     OR EXISTS (
       SELECT 1 FROM public.mirror_outbox o
       WHERE o.dedup_key = 'linear-inbound:title:f133-linear-accepted-1:f133-samples-video'
     ) THEN
    RAISE EXCEPTION 'f133_linear_inbound_title_not_exact';
  END IF;

  SELECT count(*) INTO v_events_before FROM public.deliverable_events;
  SELECT count(*) INTO v_outbox_before FROM public.mirror_outbox;
  v_replay := public.production_canonical_title_from_linear(v_request);
  IF v_replay->>'replayed' IS DISTINCT FROM 'true'
     OR v_replay->>'noop' IS DISTINCT FROM 'false'
     OR v_replay->>'stale' IS DISTINCT FROM 'false'
     OR v_replay->>'event_id' IS DISTINCT FROM v_result->>'event_id'
     OR (SELECT count(*) FROM public.deliverable_events) <> v_events_before
     OR (SELECT count(*) FROM public.mirror_outbox) <> v_outbox_before THEN
    RAISE EXCEPTION 'f133_linear_inbound_replay_failed';
  END IF;

  v_noop_request := jsonb_build_object(
    'source_deliverable_id', 'f133-samples-video',
    'source_issue_uuid', '00000000-0000-4000-8000-0000000000d1',
    'source_identifier', 'SXR-V',
    'source_issue_url', 'https://linear.app/f133/issue/SXR-V',
    'delivery_id', 'f133%_noop',
    'source_edited_at', date_trunc(
      'milliseconds', v_ui_commit_at + interval '2 seconds'
    ),
    'title', 'Linear canonical title'
  );
  v_result := public.production_canonical_title_from_linear(v_noop_request);
  IF v_result->>'noop' IS DISTINCT FROM 'true'
     OR v_result->>'stale' IS DISTINCT FROM 'false'
     OR v_result->>'outbox_count' IS DISTINCT FROM '0'
     OR v_result->>'event_id' IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM public.deliverables d
       WHERE d.id = 'f133-samples-video'
         AND (d.linear_raw->'field_updated_at'->>'title')::timestamptz
           = (v_noop_request->>'source_edited_at')::timestamptz
     ) THEN
    RAISE EXCEPTION 'f133_linear_inbound_eventful_noop_failed';
  END IF;
  PERFORM public.mirror_outbox_enqueue(
    'deliverable', 'f133-samples-graphic', 'title',
    '{"title":"unrelated","_intent_fingerprint":"f133-unrelated-like","_f27_authority_generation":7,"_f27_legacy_parity":false}'::jsonb,
    'linear-inbound:title:f133XXnoop:unrelated',
    v_ui_commit_at + interval '2 seconds', 'f133-client', 'graphics',
    'F133 proof', 'system', 'f133-samples-graphic', 'f133-samples-batch',
    null, null, false
  );
  SELECT count(*) INTO v_events_before FROM public.deliverable_events;
  SELECT count(*) INTO v_outbox_before FROM public.mirror_outbox;
  v_replay := public.production_canonical_title_from_linear(v_noop_request);
  IF v_replay->>'replayed' IS DISTINCT FROM 'true'
     OR v_replay->>'noop' IS DISTINCT FROM 'true'
     OR v_replay->>'outbox_count' IS DISTINCT FROM '0'
     OR (SELECT count(*) FROM public.deliverable_events) <> v_events_before
     OR (SELECT count(*) FROM public.mirror_outbox) <> v_outbox_before THEN
    RAISE EXCEPTION 'f133_linear_inbound_literal_delivery_replay_failed';
  END IF;

  SELECT linear_raw INTO v_raw_before FROM public.deliverables
  WHERE id = 'f133-samples-video';
  SELECT count(*) INTO v_events_before FROM public.deliverable_events;
  SELECT count(*) INTO v_outbox_before FROM public.mirror_outbox;
  v_result := public.production_canonical_title_from_linear(jsonb_build_object(
    'source_deliverable_id', 'f133-samples-video',
    'source_issue_uuid', '00000000-0000-4000-8000-0000000000d1',
    'source_identifier', 'SXR-V',
    'source_issue_url', 'https://linear.app/f133/issue/SXR-V',
    'delivery_id', 'f133-linear-stale-2',
    'source_edited_at', date_trunc(
      'milliseconds', v_ui_commit_at + interval '1500 milliseconds'
    ),
    'title', 'Stale Linear regression'
  ));
  IF v_result->>'stale' IS DISTINCT FROM 'true'
     OR v_result->>'noop' IS DISTINCT FROM 'true'
     OR v_result->>'current_title' IS DISTINCT FROM 'Linear canonical title'
     OR (SELECT linear_raw FROM public.deliverables
         WHERE id = 'f133-samples-video') IS DISTINCT FROM v_raw_before
     OR EXISTS (
       SELECT 1 FROM public.deliverables
       WHERE id IN ('f133-samples-video', 'f133-samples-graphic')
         AND title <> 'Linear canonical title'
     )
     OR (SELECT count(*) FROM public.deliverable_events) <> v_events_before
     OR (SELECT count(*) FROM public.mirror_outbox) <> v_outbox_before THEN
    RAISE EXCEPTION 'f133_linear_inbound_stale_regressed_state';
  END IF;
END $$;

-- An active TEST client is an independent lane: service-authenticated inbound
-- may exercise the same transaction, but its opposite title intent is always
-- test_only=true and legacy_parity=false regardless of production authority.
DO $$
DECLARE
  v_at timestamptz := clock_timestamp() + interval '1 minute';
  v_result jsonb;
BEGIN
  INSERT INTO public.batches(id, client_slug, team, name, status, created_by)
  VALUES ('f133-test-title-batch', 'f133-test-client', null,
          'TEST title batch', 'active', 'f133-proof');
  INSERT INTO public.deliverables(
    id, batch_id, client_slug, team, kind, title, status, origin, card_id,
    sort_key, linear_issue_uuid, linear_identifier, linear_issue_url, linear_raw
  ) VALUES
    ('f133-test-title-video', 'f133-test-title-batch', 'f133-test-client',
     'video', 'video', 'TEST original', 'in_progress', 'calendar',
     'f133-test-title-card', 0, '00000000-0000-4000-8000-0000000000e1',
     'TEST-V', 'https://linear.app/f133/issue/TEST-V',
     '{"issue":{"id":"00000000-0000-4000-8000-0000000000e1","identifier":"TEST-V","url":"https://linear.app/f133/issue/TEST-V"}}'),
    ('f133-test-title-graphic', 'f133-test-title-batch', 'f133-test-client',
     'graphics', 'thumbnail', 'TEST original', 'in_progress', 'calendar',
     'f133-test-title-card', 0, '00000000-0000-4000-8000-0000000000e2',
     'TEST-G', 'https://linear.app/f133/issue/TEST-G',
     '{"issue":{"id":"00000000-0000-4000-8000-0000000000e2","identifier":"TEST-G","url":"https://linear.app/f133/issue/TEST-G"}}');
  PERFORM set_config('app.f133_canonical_title_write', '1', true);
  INSERT INTO public.calendar_posts(
    client, id, updated_at, order_index, scheduled_date, name,
    video_deliverable_id, graphic_deliverable_id,
    linear_issue_id, graphic_linear_issue_id
  ) VALUES (
    'f133-test-client', 'f133-test-title-card', '', '', '', 'TEST original',
    'f133-test-title-video', 'f133-test-title-graphic',
    'https://linear.app/f133/issue/TEST-V',
    'https://linear.app/f133/issue/TEST-G'
  );
  v_result := public.production_canonical_title_from_linear(jsonb_build_object(
    'source_deliverable_id', 'f133-test-title-video',
    'source_issue_uuid', '00000000-0000-4000-8000-0000000000e1',
    'source_identifier', 'TEST-V',
    'source_issue_url', 'https://linear.app/f133/issue/TEST-V',
    'delivery_id', 'f133-test-title-delivery',
    'source_edited_at', v_at,
    'title', 'TEST canonical title'
  ));
  IF v_result->>'test_only' IS DISTINCT FROM 'true'
     OR v_result->>'stale' IS DISTINCT FROM 'false'
     OR v_result->>'outbox_count' IS DISTINCT FROM '1'
     OR NOT EXISTS (
       SELECT 1 FROM public.mirror_outbox o
       WHERE o.id = (v_result->'outbox_ids'->>0)::bigint
         AND o.entity_id = 'f133-test-title-graphic'
         AND o.test_only IS true AND o.legacy_parity IS false
         AND o.authority_generation = 7
     )
     OR EXISTS (
       SELECT 1 FROM public.mirror_outbox o
       WHERE o.dedup_key = 'linear-inbound:title:f133-test-title-delivery:f133-test-title-video'
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.deliverable_events e
       WHERE e.id = (v_result->>'event_id')::bigint
         AND e.payload->>'test_only' = 'true'
     ) THEN
    RAISE EXCEPTION 'f133_linear_inbound_test_lane_failed';
  END IF;
END $$;

DO $$
BEGIN
  BEGIN
    UPDATE public.sample_reviews SET name = 'legacy sample overwrite'
    WHERE id = 'f133-samples-card';
    RAISE EXCEPTION 'f133_samples_guard_did_not_fail';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE 'f133_linked_card_title_requires_canonical_rpc:%' THEN RAISE; END IF;
  END;
END $$;

DO $$
DECLARE
  v_events_before bigint;
  v_outbox_before bigint;
BEGIN
  SELECT count(*) INTO v_events_before FROM public.deliverable_events;
  SELECT count(*) INTO v_outbox_before FROM public.mirror_outbox;
  BEGIN
    PERFORM public.production_canonical_title_write(
      jsonb_build_object(
        'surface', 'calendar', 'client_slug', 'f133-client',
        'card_id', 'f133-paired-card-1', 'expected_title', 'Campaign Launch',
        'expected_title_revision', 2,
        'expected_deliverable_titles', jsonb_build_object(
          'f133-paired-video-1', 'Campaign Launch',
          'f133-paired-graphic-1', 'Campaign Launch'
        ),
        'title', '   ', 'outbounds', '[]'::jsonb
      ),
      jsonb_build_object(
        'event_key', 'production-title:f133-paired-card-1:blank',
        'ts', '2026-08-02T19:21:00.000Z',
        'actor', 'F133 Proof SMM', 'actor_key', 'member:f133-proof',
        'role', 'smm', 'auth_kind', 'staff', 'source', 'ui',
        'action', 'title_change', 'surface', 'calendar',
        'from_title', 'Campaign Launch', 'to_title', ''
        , 'from_title_revision', 2
      )
    );
    RAISE EXCEPTION 'f133_blank_title_unexpectedly_succeeded';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'invalid_canonical_title_payload' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM public.deliverable_events) <> v_events_before
     OR (SELECT count(*) FROM public.mirror_outbox) <> v_outbox_before THEN
    RAISE EXCEPTION 'f133_blank_title_left_residue';
  END IF;
END $$;

-- A later legitimate rename does not erase the receipt for an earlier lost
-- acknowledgement. Title replay reports superseded current state; intake
-- replay likewise returns the current coherent card/rows without rematerializing.
DO $$
DECLARE
  v_at timestamptz := '2026-08-02T19:25:00.000Z';
  v_original_title f133_title_requests%rowtype;
  v_original_intake f133_requests%rowtype;
  v_later jsonb;
  v_replay jsonb;
  v_events_before bigint;
  v_outbox_before bigint;
BEGIN
  v_later := public.production_canonical_title_write(
    jsonb_build_object(
      'surface', 'calendar', 'client_slug', 'f133-client',
      'card_id', 'f133-paired-card-1', 'expected_title', 'Campaign Launch',
      'expected_title_revision', 2,
      'expected_deliverable_titles', jsonb_build_object(
        'f133-paired-video-1', 'Campaign Launch',
        'f133-paired-graphic-1', 'Campaign Launch'
      ),
      'title', 'Later Canonical Title',
      'outbounds', jsonb_build_array(
        f133_test_fixture.title_outbound('f133-paired-video-1', 'video',
          'f133:title:later:video', 'fp-title-later-video', 'Later Canonical Title', v_at),
        f133_test_fixture.title_outbound('f133-paired-graphic-1', 'graphics',
          'f133:title:later:graphics', 'fp-title-later-graphics', 'Later Canonical Title', v_at)
      )
    ),
    jsonb_build_object(
      'event_key', 'production-title:f133-paired-card-1:later', 'ts', v_at,
      'actor', 'F133 Proof SMM', 'actor_key', 'member:f133-proof',
      'role', 'smm', 'auth_kind', 'staff', 'source', 'ui',
      'action', 'title_change', 'surface', 'calendar',
      'from_title', 'Campaign Launch', 'to_title', 'Later Canonical Title'
      , 'from_title_revision', 2
    )
  );
  IF v_later->'card'->>'name' IS DISTINCT FROM 'Later Canonical Title' THEN
    RAISE EXCEPTION 'f133_later_title_setup_failed';
  END IF;
  SELECT count(*) INTO v_events_before FROM public.deliverable_events;
  SELECT count(*) INTO v_outbox_before FROM public.mirror_outbox;

  SELECT * INTO v_original_title FROM f133_title_requests WHERE request_name = 'paired-title';
  v_replay := public.production_canonical_title_write(v_original_title.card, v_original_title.event);
  IF v_replay->>'replayed' IS DISTINCT FROM 'true'
     OR v_replay->>'superseded' IS DISTINCT FROM 'true'
     OR v_replay->'card'->>'name' IS DISTINCT FROM 'Later Canonical Title'
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_replay->'rows') row
       WHERE row->>'title' IS DISTINCT FROM 'Later Canonical Title'
     )
     OR v_replay->>'event_id' IS DISTINCT FROM v_original_title.result->>'event_id'
     OR (SELECT count(*) FROM public.deliverable_events) <> v_events_before
     OR (SELECT count(*) FROM public.mirror_outbox) <> v_outbox_before THEN
    RAISE EXCEPTION 'f133_superseded_title_replay_failed';
  END IF;

  SELECT * INTO v_original_intake FROM f133_requests WHERE request_name = 'paired-new';
  v_replay := public.production_intake_commit(
    'new', v_original_intake.batch, v_original_intake.parent_events,
    v_original_intake.rows_data, v_original_intake.events,
    v_original_intake.cards, null
  );
  IF v_replay->>'replay' IS DISTINCT FROM 'true'
     OR v_replay->'cards'->0->>'name' IS DISTINCT FROM 'Later Canonical Title'
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_replay->'items') row
       WHERE row->>'title' IS DISTINCT FROM 'Later Canonical Title'
     )
     OR (SELECT count(*) FROM public.deliverable_events) <> v_events_before
     OR (SELECT count(*) FROM public.mirror_outbox) <> v_outbox_before THEN
    RAISE EXCEPTION 'f133_intake_replay_after_title_failed';
  END IF;
END $$;

-- Append mode uses the locked batch cursor but the title is independent of
-- its ordinal. A video-only Advanced submission commits its new row and card
-- together; an old generic-title derivation would reject this request.
INSERT INTO public.deliverables(
  id, batch_id, client_slug, team, kind, title, status, origin, sort_key,
  created_by
) VALUES (
  'f133-sparse-existing-row', 'f133-paired-batch', 'f133-client',
  'video', 'other', 'Sparse historical row', 'in_progress', 'manual', 4,
  'member:f133-proof'
);
DO $$
DECLARE
  v_expected timestamptz;
  v_at timestamptz := '2026-08-02T19:30:00.000Z';
  v_result jsonb;
  v_rows jsonb;
  v_events jsonb;
  v_cards jsonb;
BEGIN
  SELECT updated_at INTO v_expected FROM public.batches WHERE id = 'f133-paired-batch';
  v_rows := jsonb_build_array(jsonb_build_object(
    'id', 'f133-append-video-2', 'batch_id', 'f133-paired-batch',
    'client_slug', 'f133-client', 'team', 'video', 'kind', 'video',
    'title', 'Appended human title', 'status', 'in_progress',
    'origin', 'calendar', 'card_id', 'f133-append-card-2',
    'sort_key', 5, '_intake_ordinal', 6,
    'created_by', 'member:f133-proof', 'created_at', v_at
  ));
  v_events := jsonb_build_array(f133_test_fixture.event(
    f133_test_fixture.outbound(
      'deliverable', 'f133-append-video-2', 'video', 'create',
      'f133:append:video:2', 'fp-append-video-2', 'Appended human title', v_at,
      jsonb_build_object(
        'project_id', 'project-video',
        'parent_linear_issue_id', 'linear-parent-video'
      )
    ), v_at
  ));
  v_cards := jsonb_build_array(jsonb_build_object(
    'client', 'f133-client', 'id', 'f133-append-card-2',
    'updated_at', v_at, 'order_index', '', 'scheduled_date', '',
    'name', 'Appended human title', 'status', 'In Progress',
    'video_status', 'In Progress', 'graphic_status', '',
    'caption_status', 'In Progress',
    'video_deliverable_id', 'f133-append-video-2',
    'graphic_deliverable_id', null
  ));
  v_result := public.production_intake_commit(
    'append',
    jsonb_build_object('id', 'f133-paired-batch'),
    '[]'::jsonb,
    v_rows,
    v_events,
    v_cards,
    v_expected
  );
  IF v_result->>'mode' <> 'append'
     OR v_result->>'replay' <> 'false'
     OR jsonb_array_length(v_result->'items') <> 1
     OR jsonb_array_length(v_result->'cards') <> 1
     OR NOT EXISTS (
       SELECT 1 FROM public.calendar_posts c
       JOIN public.deliverables d ON d.id = c.video_deliverable_id
       WHERE c.id = 'f133-append-card-2'
         AND c.graphic_deliverable_id IS NULL
         AND c.name = 'Appended human title'
         AND c.order_index = '47' AND c.scheduled_date = ''
         AND d.title = c.name AND d.sort_key = 5
     ) THEN
    RAISE EXCEPTION 'f133_append_atomic_card_failed';
  END IF;
END $$;

-- One database resolver owns the complete predecessor chain. Prove 514 rapid
-- pre-drain edits without a lifetime cap, then force each structural failure
-- independently. Every sabotage runs in a PL/pgSQL subtransaction, so its
-- changed rows roll back before the next case.
CREATE TEMP TABLE f133_dependency_chain_ids (
  sequence_number integer PRIMARY KEY,
  outbox_id bigint NOT NULL UNIQUE
);
DO $$
DECLARE
  v_root_id bigint;
  v_previous_id bigint;
  v_current_id bigint;
  v_requested_id bigint;
  v_ids bigint[] := array[]::bigint[];
  v_result jsonb;
  v_index integer;
BEGIN
  INSERT INTO public.batches(
    id, client_slug, team, name, status, created_by, created_at
  ) VALUES (
    'f133-chain-batch', 'f133-client', 'video', 'Dependency chain',
    'active', 'member:f133-proof', '2026-08-02T21:00:00Z'
  );
  INSERT INTO public.deliverables(
    id, batch_id, client_slug, team, kind, title, status, origin, card_id,
    created_by, created_at, linear_issue_uuid, linear_raw
  ) VALUES (
    'f133-chain-deliverable', 'f133-chain-batch', 'f133-client', 'video',
    'video', 'Chain 515', 'in_progress', 'calendar', 'f133-chain-card',
    'member:f133-proof', '2026-08-02T21:00:00Z', 'f133-chain-issue',
    jsonb_build_object(
      'issue', jsonb_build_object('id', 'f133-chain-issue', 'title', 'Chain root'),
      'field_updated_at', jsonb_build_object('title', '2026-08-02T21:00:01Z')
    )
  );
  INSERT INTO public.mirror_outbox(
    deliverable_id, op, payload, entity, entity_id, batch_id, operation,
    client_slug, team, dedup_key, source_edited_at, status, actor, role,
    test_only, legacy_parity, authority_generation, linear_result
  ) VALUES (
    'f133-chain-deliverable', 'create',
    jsonb_build_object('title', 'Chain root', '_intent_fingerprint', 'chain-create-fp'),
    'deliverable', 'f133-chain-deliverable', 'f133-chain-batch', 'create',
    'f133-client', 'video', 'f133-chain-create', '2026-08-02T21:00:00Z',
    'written', 'F133 Proof SMM', 'smm', false, true, 7,
    jsonb_build_object(
      'mutation', 'issueCreate', 'issue_id', 'f133-chain-issue',
      'mirror_actor_id', 'f133-proof-mirror',
      'updated_at', '2026-08-02T21:00:00.500Z',
      'expected', jsonb_build_object('input', jsonb_build_object(
        'id', 'f133-chain-issue', 'title', 'Chain root'
      ))
    )
  ) RETURNING id INTO v_root_id;
  v_previous_id := v_root_id;
  FOR v_index IN 1..515 LOOP
    INSERT INTO public.mirror_outbox(
      deliverable_id, op, payload, entity, entity_id, batch_id, operation,
      client_slug, team, dedup_key, source_edited_at, status, actor, role,
      depends_on_id, test_only, legacy_parity, authority_generation
    ) VALUES (
      'f133-chain-deliverable', 'update_fields',
      jsonb_build_object('title', 'Chain ' || v_index::text,
        '_intent_fingerprint', 'chain-title-fp-' || v_index::text),
      'deliverable', 'f133-chain-deliverable', 'f133-chain-batch', 'title',
      'f133-client', 'video', 'f133-chain-title-' || v_index::text,
      '2026-08-02T21:00:01Z'::timestamptz + v_index * interval '1 second',
      'pending', 'F133 Proof SMM', 'smm', v_previous_id,
      false, true, 7
    ) RETURNING id INTO v_current_id;
    v_ids := array_append(v_ids, v_current_id);
    INSERT INTO f133_dependency_chain_ids VALUES (v_index, v_current_id);
    v_previous_id := v_current_id;
  END LOOP;
  v_requested_id := v_ids[515];
  v_result := public.production_canonical_title_dependency_resolve(v_requested_id);
  IF v_result->>'kind' <> 'waiting'
     OR (v_result->>'dependency_outbox_id')::bigint <> v_ids[514]
     OR v_result->>'root_kind' <> 'create_root'
     OR (v_result->>'requested_outbox_id')::bigint <> v_requested_id THEN
    RAISE EXCEPTION 'f133_dependency_514_chain_failed';
  END IF;

  BEGIN
    INSERT INTO public.mirror_outbox(
      deliverable_id, op, payload, entity, entity_id, batch_id, operation,
      client_slug, team, dedup_key, source_edited_at, status, depends_on_id,
      test_only, legacy_parity, authority_generation
    ) VALUES (
      'f133-chain-deliverable', 'update_fields', '{"title":"fork"}',
      'deliverable', 'f133-chain-deliverable', 'f133-chain-batch', 'title',
      'f133-client', 'video', 'f133-chain-fork', '2026-08-02T22:00:00Z',
      'pending', v_ids[300], false, true, 7
    ) RETURNING id INTO v_current_id;
    PERFORM public.production_canonical_title_dependency_resolve(v_current_id);
    RAISE EXCEPTION 'f133_dependency_fork_unexpectedly_passed';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'canonical_title_dependency_resolve_fork_invalid' THEN RAISE; END IF;
  END;

  BEGIN
    DELETE FROM public.mirror_outbox WHERE id = v_ids[299];
    UPDATE public.mirror_outbox SET depends_on_id = v_ids[298]
    WHERE id = v_ids[300];
    INSERT INTO public.mirror_outbox(
      id, deliverable_id, op, payload, entity, entity_id, batch_id, operation,
      client_slug, team, dedup_key, source_edited_at, status, depends_on_id,
      test_only, legacy_parity, authority_generation
    ) OVERRIDING SYSTEM VALUE VALUES (
      v_ids[299], 'f133-chain-deliverable', 'update_fields', '{"title":"gap"}',
      'deliverable', 'f133-chain-deliverable', 'f133-chain-batch', 'title',
      'f133-client', 'video', 'f133-chain-gap', '2026-08-02T21:05:00Z',
      'pending', v_root_id, false, true, 7
    );
    PERFORM public.production_canonical_title_dependency_resolve(v_requested_id);
    RAISE EXCEPTION 'f133_dependency_gap_unexpectedly_passed';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'canonical_title_dependency_resolve_chain_invalid' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE public.mirror_outbox SET depends_on_id = v_requested_id
    WHERE id = v_ids[1];
    PERFORM public.production_canonical_title_dependency_resolve(v_requested_id);
    RAISE EXCEPTION 'f133_dependency_cycle_unexpectedly_passed';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'canonical_title_dependency_resolve_chain_invalid' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE public.deliverables SET linear_issue_uuid = 'f133-wrong-chain-issue'
    WHERE id = 'f133-chain-deliverable';
    PERFORM public.production_canonical_title_dependency_resolve(v_requested_id);
    RAISE EXCEPTION 'f133_dependency_binder_drift_unexpectedly_passed';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'canonical_title_dependency_resolve_create_ack_invalid' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE public.mirror_outbox SET depends_on_id = null WHERE id = v_ids[1];
    UPDATE public.mirror_outbox
    SET status = 'written', linear_result = jsonb_build_object(
      'mutation', 'issueUpdate', 'issue_id', 'f133-chain-issue',
      'mirror_actor_id', 'f133-proof-mirror',
      'updated_at', source_edited_at + interval '100 milliseconds',
      'expected', jsonb_build_object('input', jsonb_build_object('title', payload->>'title'))
    )
    WHERE id = any(v_ids);
    v_result := public.production_canonical_title_dependency_resolve(v_requested_id);
    IF v_result->>'kind' <> 'terminal_title'
       OR v_result->>'root_kind' <> 'bound_existing_issue_root'
       OR v_result->>'bound_issue_id' <> 'f133-chain-issue' THEN
      RAISE EXCEPTION 'f133_dependency_null_root_failed';
    END IF;
    RAISE EXCEPTION 'f133_dependency_null_root_rollback';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'f133_dependency_null_root_rollback' THEN RAISE; END IF;
  END;
END $$;

-- Browser roles cannot invoke the service-only transaction functions. These
-- semantic ACL checks also catch an accidental default PUBLIC execute grant.
DO $$
DECLARE
  v_signature text;
  v_oid oid;
BEGIN
  v_oid := to_regprocedure(
    'public.production_intake_append(text,timestamp with time zone,jsonb,jsonb)'
  );
  IF v_oid IS NULL
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'f133_owner_internal_append_acl_failed';
  END IF;
  FOREACH v_signature IN ARRAY ARRAY[
    'public.production_intake_commit(text,jsonb,jsonb,jsonb,jsonb,jsonb,timestamp with time zone)',
    'public.production_intake_card_adopt(text,text,text)',
    'public.production_canonical_title_from_linear(jsonb)',
    'public.production_canonical_title_write(jsonb,jsonb)'
  ] LOOP
    v_oid := to_regprocedure(v_signature);
    IF v_oid IS NULL
       OR has_function_privilege('anon', v_oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'f133_service_only_acl_failed:%', v_signature;
    END IF;
  END LOOP;
END $$;

SELECT jsonb_build_object(
  'terminal', 'F133_CANONICAL_TITLE_PROOF_OK',
  'postgres_major', current_setting('server_version_num')::integer / 10000,
  'assertions', jsonb_build_array(
    'single_team_video_intake_atomic',
    'single_team_graphics_intake_atomic',
    'paired_single_intake_atomic',
    'paired_multiple_duplicate_titles_atomic',
    'locked_server_calendar_order_schedule_empty',
    'append_human_title_atomic',
    'linked_card_guard_title_and_linkage',
    'migration_first_legacy_card_adoption',
    'service_commit_nested_append_after_direct_revoke',
    'split_state_converges',
    'historical_whitespace_base_converges',
    'one_title_change_event',
    'async_title_outbox_per_link',
    'create_ack_title_clock_bound',
    'title_create_dependency_nine_waits_terminal',
    'title_dependency_514_gap_fork_cycle_binder_null_root',
    'f27_binder_exact',
    'lost_response_replay_exact',
    'intake_replay_current_authority_independent',
    'title_replay_current_authority_independent',
    'title_replay_exact_inventory_drift_refused',
    'title_event_exact_bases_and_replay_identity',
    'two_tab_cas_conflict_zero_residue',
    'independent_card_and_row_cas',
    'duplicate_title_dedup_refused',
    'zero_outbound_noop',
    'calendar_collaborative_client_noop',
    'calendar_client_mutation_and_bound_replay',
    'superseded_title_replay_current_state',
    'intake_replay_after_later_title',
    'calendar_and_samples_exact',
    'offline_ui_server_commit_clock',
    'linear_inbound_stale_replay_noop_exact',
    'linear_inbound_card_cursor_monotone',
    'linear_inbound_literal_delivery_id',
    'linear_inbound_test_lane_isolated',
    'cross_surface_title_clock_isolated',
    'sparse_ordinal_cursor_matches_js',
    'calendar_samples_linear_link_projection',
    'linear_link_projection_mismatch_refused',
    'review_fields_preserved',
    'blank_refused',
    'service_only_rpc_acl',
    'exact_inverse_retains_evidence'
  )
) AS F133_CANONICAL_TITLE_PROOF_OK;

-- Exact inverse proof. Simulate the operator prerequisite that every durable
-- title intent is terminal, then execute the migration's owner-only inverse.
CREATE TEMP TABLE f133_inverse_counts AS
SELECT
  (SELECT count(*) FROM public.mirror_outbox WHERE operation = 'title') AS title_outbox,
  (SELECT count(*) FROM public.deliverable_events WHERE action = 'title_change') AS title_events;
CREATE TEMP TABLE f133_inverse_stale_request AS
SELECT
  c.client AS client_slug,
  c.id AS card_id,
  c.name AS expected_title,
  c.title_revision AS expected_title_revision,
  c.video_deliverable_id,
  c.graphic_deliverable_id,
  (SELECT title FROM public.deliverables
    WHERE id = c.video_deliverable_id) AS expected_video_title,
  (SELECT title FROM public.deliverables
    WHERE id = c.graphic_deliverable_id) AS expected_graphic_title
FROM public.calendar_posts c
WHERE c.client = 'f133-client' AND c.id = 'f133-paired-card-1';
UPDATE public.mirror_outbox
SET status = 'written', processed_at = coalesce(processed_at, now())
WHERE operation = 'title' AND status IN ('pending', 'failed', 'shadow_ok');

BEGIN;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.syncview_runtime_flags
    WHERE key = 'f133_canonical_title_enabled'
      AND value = '{"enabled":false}'::jsonb
  ) OR EXISTS (
    SELECT 1 FROM public.mirror_outbox
    WHERE operation = 'title'
      AND status IN ('pending', 'failed', 'shadow_ok')
  ) THEN
    RAISE EXCEPTION 'f133_rollback_precondition_failed';
  END IF;
END $$;
SELECT set_config('app.f133_canonical_title_write', '1', true);
UPDATE public.calendar_posts
SET title_revision = title_revision + 1
WHERE video_deliverable_id IS NOT NULL OR graphic_deliverable_id IS NOT NULL;
UPDATE public.sample_reviews
SET title_revision = title_revision + 1
WHERE video_deliverable_id IS NOT NULL OR graphic_deliverable_id IS NOT NULL;
DROP TRIGGER IF EXISTS production_deliverable_linear_link_projection_after ON public.deliverables;
DROP TRIGGER IF EXISTS production_canonical_title_guard_before ON public.calendar_posts;
DROP TRIGGER IF EXISTS production_canonical_title_guard_before ON public.sample_reviews;
DROP TRIGGER IF EXISTS production_canonical_title_deliverable_guard_before ON public.deliverables;
DROP TRIGGER IF EXISTS zz_production_canonical_title_cas_before ON public.deliverables;
DROP FUNCTION IF EXISTS public.production_canonical_title_write(jsonb, jsonb);
DROP FUNCTION IF EXISTS public.production_canonical_title_from_linear(jsonb);
DROP FUNCTION IF EXISTS public.production_intake_card_adopt(text, text, text);
DROP FUNCTION IF EXISTS public.production_intake_commit(text, jsonb, jsonb, jsonb, jsonb, jsonb, timestamptz);
DROP FUNCTION IF EXISTS public.production_canonical_title_acknowledge(bigint, jsonb);
DROP FUNCTION IF EXISTS public.production_canonical_title_binder_adopt(jsonb);
DROP FUNCTION IF EXISTS public.production_canonical_title_dependency_resolve(bigint);
DROP FUNCTION IF EXISTS public.production_canonical_title_dependency_valid(bigint);
DROP FUNCTION IF EXISTS public.production_deliverable_linear_link_projection();
DROP FUNCTION IF EXISTS public.production_canonical_title_card_guard();
DROP FUNCTION IF EXISTS public.production_intake_v3_card_contract(text, text, text, text, jsonb);
DROP FUNCTION IF EXISTS public.production_canonical_title_deliverable_guard();
DROP FUNCTION IF EXISTS public.production_canonical_title_cas_guard();
DROP FUNCTION public.production_intake_append(text, timestamptz, jsonb, jsonb);
ALTER FUNCTION public.production_intake_append_v3(text, timestamptz, jsonb, jsonb)
  RENAME TO production_intake_append;
REVOKE ALL ON FUNCTION public.production_intake_append(text, timestamptz, jsonb, jsonb)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.production_intake_append(text, timestamptz, jsonb, jsonb)
  TO service_role;
DROP FUNCTION public.production_issue_create_linkage(text, bigint, jsonb, jsonb);
ALTER FUNCTION public.production_issue_create_linkage_pre_f133(text, bigint, jsonb, jsonb)
  RENAME TO production_issue_create_linkage;
REVOKE ALL ON FUNCTION public.production_issue_create_linkage(text, bigint, jsonb, jsonb)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.production_issue_create_linkage(text, bigint, jsonb, jsonb)
  TO service_role;
COMMIT;

-- A restored pre-F133 closure can again write the linked row directly. The
-- widened additive CHECK and every title audit/outbox row remain intact.
UPDATE public.calendar_posts SET name = 'Pre-F133 writer intermediate'
WHERE client = 'f133-client' AND id = 'f133-paired-card-1';
UPDATE public.deliverables SET title = 'Pre-F133 writer intermediate'
WHERE id IN ('f133-paired-video-1', 'f133-paired-graphic-1');
UPDATE public.calendar_posts c SET name = s.expected_title
FROM f133_inverse_stale_request s
WHERE c.client = s.client_slug AND c.id = s.card_id;
UPDATE public.deliverables d SET title = CASE d.id
  WHEN s.video_deliverable_id THEN s.expected_video_title
  WHEN s.graphic_deliverable_id THEN s.expected_graphic_title
END
FROM f133_inverse_stale_request s
WHERE d.id IN (s.video_deliverable_id, s.graphic_deliverable_id);
DO $$
DECLARE v_trigger_count integer;
BEGIN
  SELECT count(*) INTO v_trigger_count
  FROM pg_trigger
  WHERE NOT tgisinternal AND tgname IN (
    'production_deliverable_linear_link_projection_after',
    'production_canonical_title_guard_before',
    'production_canonical_title_deliverable_guard_before',
    'zz_production_canonical_title_cas_before'
  );
  IF v_trigger_count <> 0
     OR to_regprocedure('public.production_canonical_title_write(jsonb,jsonb)') IS NOT NULL
     OR to_regprocedure('public.production_canonical_title_from_linear(jsonb)') IS NOT NULL
     OR to_regprocedure('public.production_intake_commit(text,jsonb,jsonb,jsonb,jsonb,jsonb,timestamp with time zone)') IS NOT NULL
     OR to_regprocedure('public.production_intake_card_adopt(text,text,text)') IS NOT NULL
     OR to_regprocedure('public.production_intake_v3_card_contract(text,text,text,text,jsonb)') IS NOT NULL
     OR to_regprocedure('public.production_canonical_title_acknowledge(bigint,jsonb)') IS NOT NULL
     OR to_regprocedure('public.production_canonical_title_binder_adopt(jsonb)') IS NOT NULL
     OR to_regprocedure('public.production_canonical_title_dependency_resolve(bigint)') IS NOT NULL
     OR to_regprocedure('public.production_canonical_title_dependency_valid(bigint)') IS NOT NULL
     OR to_regprocedure('public.production_intake_append_v3(text,timestamp with time zone,jsonb,jsonb)') IS NOT NULL
     OR to_regprocedure('public.production_issue_create_linkage_pre_f133(text,bigint,jsonb,jsonb)') IS NOT NULL
     OR NOT has_function_privilege(
       'service_role',
       'public.production_intake_append(text,timestamp with time zone,jsonb,jsonb)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.production_issue_create_linkage(text,bigint,jsonb,jsonb)',
       'EXECUTE'
     )
     OR (SELECT count(*) FROM public.mirror_outbox WHERE operation = 'title')
          <> (SELECT title_outbox FROM f133_inverse_counts)
     OR (SELECT count(*) FROM public.deliverable_events WHERE action = 'title_change')
          <> (SELECT title_events FROM f133_inverse_counts)
     OR NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conrelid = 'public.mirror_outbox'::regclass
         AND conname = 'mirror_outbox_legacy_parity_operation_check'
         AND pg_get_constraintdef(oid) LIKE '%title%'
     ) THEN
    RAISE EXCEPTION 'f133_exact_inverse_contract_failed';
  END IF;
END $$;

-- Reinstall from the exact retained inverse boundary.  The retained revision
-- is a kill generation: although the old closure performed A -> B -> A and
-- restored the visible value exactly, a delayed pre-inverse title+revision CAS
-- must remain stale after the reviewed migration is installed again.
\ir ../migrations/2026-08-02-f133-canonical-title.sql

DO $$
DECLARE
  v_stale f133_inverse_stale_request%rowtype;
  v_events_before bigint;
  v_outbox_before bigint;
BEGIN
  SELECT * INTO STRICT v_stale FROM f133_inverse_stale_request;
  SELECT count(*) INTO v_events_before FROM public.deliverable_events;
  SELECT count(*) INTO v_outbox_before FROM public.mirror_outbox;
  BEGIN
    PERFORM public.production_canonical_title_write(
      jsonb_build_object(
        'surface', 'calendar',
        'client_slug', v_stale.client_slug,
        'card_id', v_stale.card_id,
        'expected_title', v_stale.expected_title,
        'expected_title_revision', v_stale.expected_title_revision,
        'expected_deliverable_titles', jsonb_build_object(
          v_stale.video_deliverable_id, v_stale.expected_video_title,
          v_stale.graphic_deliverable_id, v_stale.expected_graphic_title
        ),
        'title', 'Delayed Pre-Inverse Title',
        'outbounds', jsonb_build_array(
          f133_test_fixture.title_outbound(
            v_stale.video_deliverable_id, 'video',
            'f133:title:inverse-stale:video', 'fp-title-inverse-stale-video',
            'Delayed Pre-Inverse Title', '2026-08-02T20:00:00Z'
          ),
          f133_test_fixture.title_outbound(
            v_stale.graphic_deliverable_id, 'graphics',
            'f133:title:inverse-stale:graphics', 'fp-title-inverse-stale-graphics',
            'Delayed Pre-Inverse Title', '2026-08-02T20:00:00Z'
          )
        )
      ),
      jsonb_build_object(
        'event_key', 'production-title:f133-paired-card-1:inverse-stale',
        'ts', '2026-08-02T20:00:00Z',
        'actor', 'F133 Proof SMM',
        'actor_key', 'member:f133-proof',
        'role', 'smm',
        'auth_kind', 'staff',
        'source', 'ui',
        'action', 'title_change',
        'surface', 'calendar',
        'from_title', v_stale.expected_title,
        'from_title_revision', v_stale.expected_title_revision,
        'to_title', 'Delayed Pre-Inverse Title'
      )
    );
    RAISE EXCEPTION 'f133_inverse_stale_cas_unexpectedly_succeeded';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'canonical_title_write_conflict' THEN RAISE; END IF;
  END;
  IF (SELECT title_revision FROM public.calendar_posts
      WHERE client = v_stale.client_slug AND id = v_stale.card_id)
        <> v_stale.expected_title_revision + 1
     OR (SELECT name FROM public.calendar_posts
         WHERE client = v_stale.client_slug AND id = v_stale.card_id)
        IS DISTINCT FROM v_stale.expected_title
     OR EXISTS (
       SELECT 1 FROM public.deliverables d
       WHERE (d.id = v_stale.video_deliverable_id
              AND d.title IS DISTINCT FROM v_stale.expected_video_title)
          OR (d.id = v_stale.graphic_deliverable_id
              AND d.title IS DISTINCT FROM v_stale.expected_graphic_title)
     )
     OR (SELECT count(*) FROM public.deliverable_events) <> v_events_before
     OR (SELECT count(*) FROM public.mirror_outbox) <> v_outbox_before THEN
    RAISE EXCEPTION 'f133_inverse_reinstall_aba_residue';
  END IF;
END $$;

SELECT jsonb_build_object(
  'terminal', 'F133_INVERSE_REINSTALL_ABA_OK',
  'postgres_major', current_setting('server_version_num')::integer / 10000,
  'event_delta', 0,
  'outbox_delta', 0
) AS F133_INVERSE_REINSTALL_ABA_OK;
