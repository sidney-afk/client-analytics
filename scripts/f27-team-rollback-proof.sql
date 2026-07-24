\set ON_ERROR_STOP on

-- The GitHub job supplies a throwaway PostgreSQL 16 server. This marker schema
-- makes the isolation explicit; production objects below exist only inside
-- that disposable TEST database.
CREATE SCHEMA f27_test;
CREATE SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;

CREATE TABLE public.clients (
  slug text PRIMARY KEY,
  active boolean NOT NULL,
  kind text NOT NULL
);
INSERT INTO public.clients(slug, active, kind)
VALUES ('test-client', true, 'test');

CREATE TABLE public.team_members (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  role text NOT NULL,
  team text,
  active boolean NOT NULL
);
INSERT INTO public.team_members(id, name, role, team, active)
VALUES (
  '00000000-0000-4000-8000-000000000043',
  'F43 Fixture SMM',
  'smm',
  'video',
  true
);

CREATE TABLE public.syncview_runtime_flags (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

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
  source text NOT NULL DEFAULT 'ui',
  payload jsonb
);
ALTER TABLE public.deliverable_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon read deliverable_events"
  ON public.deliverable_events
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true);
GRANT SELECT ON public.deliverable_events TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deliverable_events TO service_role;

-- Minimal native Production tables used by the focused F203 atomic-create
-- proof later in this same disposable database. They preserve the real column
-- types and mutability boundary exercised by production_issue_create.
CREATE TABLE public.batches (
  id text PRIMARY KEY,
  client_slug text NOT NULL,
  team text,
  name text,
  description text,
  status text NOT NULL,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  linear_parent_ids jsonb
);
CREATE TABLE public.deliverables (
  id text PRIMARY KEY,
  batch_id text NOT NULL,
  client_slug text NOT NULL,
  team text NOT NULL,
  kind text NOT NULL,
  title text,
  brief text,
  status text NOT NULL,
  status_at timestamptz,
  assignee_id text,
  due_date date,
  origin text,
  card_id text,
  sync_state text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  linear_issue_uuid text UNIQUE,
  linear_identifier text,
  linear_issue_url text,
  linear_raw jsonb
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.batches TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deliverables TO service_role;

CREATE TABLE public.flag_flips (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  ts timestamptz NOT NULL DEFAULT now(),
  actor text
);

CREATE FUNCTION public.f27_test_log_flip()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.flag_flips(key, old_value, new_value, actor)
  VALUES (new.key, old.value, new.value, new.updated_by);
  new.updated_at := now();
  RETURN new;
END $$;

CREATE TRIGGER f27_test_log_flip
BEFORE UPDATE ON public.syncview_runtime_flags
FOR EACH ROW EXECUTE FUNCTION public.f27_test_log_flip();

CREATE TABLE public.mirror_outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  deliverable_id text,
  op text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  next_retry_at timestamptz,
  entity text NOT NULL,
  entity_id text NOT NULL,
  batch_id text,
  comment_id text,
  operation text NOT NULL,
  client_slug text NOT NULL,
  team text NOT NULL,
  dedup_key text NOT NULL UNIQUE,
  source_edited_at timestamptz NOT NULL,
  status text NOT NULL,
  linear_result jsonb,
  shadow_actual jsonb,
  actor text,
  role text,
  depends_on_id bigint,
  locked_at timestamptz,
  lock_token uuid,
  processed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  test_only boolean NOT NULL DEFAULT false,
  last_error text,
  legacy_parity boolean NOT NULL DEFAULT false,
  CONSTRAINT mirror_outbox_operation_b4_check CHECK (
    operation IN (
      'create', 'status', 'comment', 'due', 'assignee', 'title',
      'priority', 'parent', 'archive', 'restore'
    )
  ),
  CONSTRAINT mirror_outbox_status_b4_check CHECK (
    status IN ('pending', 'shadow_ok', 'written', 'failed', 'skipped', 'stale')
  )
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mirror_outbox TO service_role;

-- Exact pre-F27 requeue helper from the B4 baseline. The corrective proof
-- invokes it after the generation CAS to demonstrate that a stale historical
-- row can no longer be reactivated through the unfenced contract.
CREATE OR REPLACE FUNCTION public.mirror_outbox_requeue(p_id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.mirror_outbox
  SET status = 'pending',
      attempts = 0,
      last_error = null,
      processed_at = null,
      next_retry_at = now(),
      lock_token = null,
      locked_at = null,
      updated_at = now()
  WHERE id = p_id
    AND operation = 'comment'
    AND status IN ('written', 'skipped', 'failed', 'stale');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count = 1;
END;
$fn$;

INSERT INTO public.syncview_runtime_flags(key, value, updated_by) VALUES
  ('prod_authority', '{"video":"linear","graphics":"linear"}', 'f27-test'),
  ('linear_outbound_enabled', '{"mode":"off"}', 'f27-test'),
  ('linear_legacy_parity_enabled', '{"enabled":false}', 'f27-test');

INSERT INTO public.mirror_outbox(
  payload, entity, entity_id, operation, client_slug, team, dedup_key,
  source_edited_at, status, test_only, legacy_parity
) VALUES
  ('{"value":"g-replay"}', 'deliverable', 'g-1', 'status', 'test-client', 'graphics', 'f27:g:1', now(), 'pending', true, false),
  ('{"value":"g-quarantine"}', 'deliverable', 'g-2', 'comment', 'test-client', 'graphics', 'f27:g:2', now(), 'failed', true, false),
  ('{"value":"g-discard"}', 'deliverable', 'g-3', 'title', 'test-client', 'graphics', 'f27:g:3', now(), 'shadow_ok', true, false),
  ('{"value":"g-reflected"}', 'deliverable', 'g-4', 'due', 'test-client', 'graphics', 'f27:g:4', now(), 'pending', true, true),
  ('{"value":"v-untouched"}', 'deliverable', 'v-1', 'status', 'test-client', 'video', 'f27:v:1', now(), 'pending', true, false);

CREATE TEMP TABLE f27_prior_flags AS
SELECT key, value FROM public.syncview_runtime_flags ORDER BY key;
CREATE TEMP TABLE f27_prior_payloads AS
SELECT id, encode(extensions.digest(convert_to(payload::text, 'UTF8'), 'sha256'), 'hex') AS payload_hash
FROM public.mirror_outbox ORDER BY id;

\ir ../migrations/2026-07-23-f201-production-labels.sql

-- The owner-approved F201 CHECK replacement is a strict superset. Prove all
-- ten prior operations plus labels through the installed pre-F27 enqueue, and
-- prove that an unrelated operation remains rejected. The transaction leaves
-- the five pre-existing fixture rows byte-identical.
BEGIN;
DO $$
DECLARE
  v_operation text;
BEGIN
  FOREACH v_operation IN ARRAY ARRAY[
    'create', 'status', 'comment', 'due', 'assignee', 'title',
    'priority', 'parent', 'archive', 'restore', 'labels'
  ] LOOP
    PERFORM public.mirror_outbox_enqueue(
      'deliverable',
      'f201-' || v_operation,
      v_operation,
      jsonb_build_object('operation', v_operation),
      'f201:' || v_operation,
      now(),
      'test-client',
      'video',
      'f201-disposable-proof',
      'system',
      null,
      null,
      null,
      null,
      true
    );
  END LOOP;

  IF (
    SELECT count(*) FROM public.mirror_outbox
    WHERE dedup_key LIKE 'f201:%'
      AND operation IN (
        'create', 'status', 'comment', 'due', 'assignee', 'title',
        'priority', 'parent', 'archive', 'restore', 'labels'
      )
  ) <> 11 OR NOT EXISTS (
    SELECT 1 FROM public.mirror_outbox
    WHERE dedup_key = 'f201:labels'
      AND operation = 'labels'
      AND op = 'update_fields'
  ) THEN
    RAISE EXCEPTION 'f201_operation_superset_not_exact';
  END IF;

  BEGIN
    PERFORM public.mirror_outbox_enqueue(
      'deliverable', 'f201-invalid', 'unexpected',
      '{}'::jsonb, 'f201:invalid', now(), 'test-client', 'video',
      'f201-disposable-proof', 'system', null, null, null, null, true
    );
    RAISE EXCEPTION 'f201_invalid_operation_unexpectedly_succeeded';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'invalid outbound operation' THEN RAISE; END IF;
  END;
END $$;
ROLLBACK;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.mirror_outbox) <> 5
     OR EXISTS (
       SELECT 1
       FROM public.mirror_outbox o
       JOIN f27_prior_payloads p USING (id)
       WHERE encode(
         extensions.digest(convert_to(o.payload::text, 'UTF8'), 'sha256'),
         'hex'
       ) <> p.payload_hash
     ) THEN
    RAISE EXCEPTION 'f201_existing_rows_not_preserved';
  END IF;
END $$;

CREATE TEMP TABLE f202_prior_rows AS
SELECT
  id,
  encode(
    extensions.digest(convert_to(to_jsonb(o)::text, 'UTF8'), 'sha256'),
    'hex'
  ) AS row_hash
FROM public.mirror_outbox o
ORDER BY id;

\ir ../migrations/2026-07-23-f202-production-descriptions.sql

-- The owner-approved F202 CHECK replacement is the next strict superset.
-- Prove all eleven F201 operations plus description through the installed
-- pre-F27 enqueue, including the exact Markdown payload, while the five
-- pre-existing fixture rows remain byte-identical.
BEGIN;
DO $$
DECLARE
  v_operation text;
BEGIN
  FOREACH v_operation IN ARRAY ARRAY[
    'create', 'status', 'comment', 'due', 'assignee', 'title',
    'priority', 'parent', 'archive', 'restore', 'labels', 'description'
  ] LOOP
    PERFORM public.mirror_outbox_enqueue(
      'deliverable',
      'f202-' || v_operation,
      v_operation,
      case when v_operation = 'description'
        then jsonb_build_object('description', E'  # F202\n\n- exact Markdown  \n')
        else jsonb_build_object('operation', v_operation)
      end,
      'f202:' || v_operation,
      now(),
      'test-client',
      'video',
      'f202-disposable-proof',
      'system',
      null,
      null,
      null,
      null,
      true
    );
  END LOOP;

  IF (
    SELECT count(*) FROM public.mirror_outbox
    WHERE dedup_key LIKE 'f202:%'
      AND operation IN (
        'create', 'status', 'comment', 'due', 'assignee', 'title',
        'priority', 'parent', 'archive', 'restore', 'labels', 'description'
      )
  ) <> 12 OR NOT EXISTS (
    SELECT 1 FROM public.mirror_outbox
    WHERE dedup_key = 'f202:description'
      AND operation = 'description'
      AND op = 'update_fields'
      AND payload = jsonb_build_object(
        'description',
        E'  # F202\n\n- exact Markdown  \n'
      )
  ) THEN
    RAISE EXCEPTION 'f202_operation_superset_not_exact';
  END IF;

  BEGIN
    PERFORM public.mirror_outbox_enqueue(
      'deliverable', 'f202-invalid', 'unexpected',
      '{}'::jsonb, 'f202:invalid', now(), 'test-client', 'video',
      'f202-disposable-proof', 'system', null, null, null, null, true
    );
    RAISE EXCEPTION 'f202_invalid_operation_unexpectedly_succeeded';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'invalid outbound operation' THEN RAISE; END IF;
  END;

  BEGIN
    INSERT INTO public.mirror_outbox(
      payload, entity, entity_id, operation, client_slug, team, dedup_key,
      source_edited_at, status, test_only
    ) VALUES (
      '{}'::jsonb, 'deliverable', 'f202-direct-invalid', 'unexpected',
      'test-client', 'video', 'f202:direct-invalid', now(), 'pending', true
    );
    RAISE EXCEPTION 'f202_check_unexpectedly_accepted_unrelated_operation';
  EXCEPTION WHEN check_violation THEN
    null;
  END;
END $$;

INSERT INTO public.deliverable_events(
  deliverable_id, client_slug, actor, role, action, source, payload
) VALUES
  (
    'f202-private-event', 'test-client', 'f202-disposable-proof', 'system',
    'description_change', 'ui',
    jsonb_build_object(
      'action', 'description_change',
      'outbound', jsonb_build_object(
        'operation', 'description',
        'payload', jsonb_build_object(
          'description',
          E'  # F202\n\n- exact Markdown  \n'
        )
      )
    )
  ),
  (
    'f202-public-control', 'test-client', 'f202-disposable-proof', 'system',
    'status_change', 'ui', '{"action":"status_change"}'::jsonb
  );

SET LOCAL ROLE service_role;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.deliverable_events
    WHERE deliverable_id = 'f202-private-event'
      AND payload->'outbound'->'payload'->>'description'
        = E'  # F202\n\n- exact Markdown  \n'
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.mirror_outbox
    WHERE dedup_key = 'f202:description'
      AND operation = 'description'
      AND payload = jsonb_build_object(
        'description',
        E'  # F202\n\n- exact Markdown  \n'
      )
  ) THEN
    RAISE EXCEPTION 'f202_service_description_audit_or_outbox_not_exact';
  END IF;
END $$;
RESET ROLE;

SET LOCAL ROLE anon;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.deliverable_events
    WHERE deliverable_id = 'f202-private-event'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.deliverable_events
    WHERE deliverable_id = 'f202-public-control'
  ) THEN
    RAISE EXCEPTION 'f202_anon_description_policy_not_exact';
  END IF;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.deliverable_events
    WHERE deliverable_id = 'f202-private-event'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.deliverable_events
    WHERE deliverable_id = 'f202-public-control'
  ) THEN
    RAISE EXCEPTION 'f202_authenticated_description_policy_not_exact';
  END IF;
END $$;
RESET ROLE;
ROLLBACK;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.mirror_outbox) <> 5
     OR EXISTS (
       SELECT 1
       FROM public.mirror_outbox o
       FULL OUTER JOIN f202_prior_rows p ON p.id = o.id
       WHERE o.id IS NULL
          OR p.id IS NULL
          OR encode(
            extensions.digest(convert_to(to_jsonb(o)::text, 'UTF8'), 'sha256'),
            'hex'
          ) IS DISTINCT FROM p.row_hash
     ) THEN
    RAISE EXCEPTION 'f202_existing_rows_not_preserved';
  END IF;
END $$;

\ir ../migrations/2026-07-20-f27-team-rollback.sql

DO $$
BEGIN
  IF (SELECT count(*) FROM public.mirror_outbox) <> 5
     OR EXISTS (
       SELECT 1 FROM public.mirror_outbox
       WHERE entity_id = 'f27-migration-test'
          OR dedup_key LIKE 'f27-migration-test:%'
     ) THEN
    RAISE EXCEPTION 'f27_migration_probe_not_rolled_back';
  END IF;
END $$;

-- Reuse this existing disposable PostgreSQL lane for the F203 RPC itself.
-- These small baseline functions model the already-installed native write
-- primitives; the candidate migration below remains the exact production
-- source under test.
CREATE OR REPLACE FUNCTION public.production_batch_parent_ids_for_team(
  p_value jsonb,
  p_team text
) RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $fn$
DECLARE
  v_team text := CASE lower(btrim(coalesce(p_team, '')))
    WHEN 'vid' THEN 'video'
    WHEN 'video' THEN 'video'
    WHEN 'gra' THEN 'graphics'
    WHEN 'graphic' THEN 'graphics'
    WHEN 'graphics' THEN 'graphics'
    ELSE null
  END;
  v_entry jsonb;
  v_ids text[];
BEGIN
  IF v_team IS NULL OR jsonb_typeof(p_value) IS DISTINCT FROM 'object' THEN
    RETURN array[]::text[];
  END IF;
  v_entry := p_value->v_team;
  SELECT coalesce(array_agg(id ORDER BY id), array[]::text[])
    INTO v_ids
  FROM (
    SELECT DISTINCT nullif(btrim(value), '') AS id
    FROM (VALUES
      (v_entry->>'id'),
      (v_entry->>'uuid'),
      (v_entry->>'linear_issue_id')
    ) values_to_check(value)
  ) ids
  WHERE id IS NOT NULL;
  RETURN v_ids;
END;
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_existing public.mirror_outbox%rowtype;
BEGIN
  IF nullif(btrim(coalesce(p_dedup_key, '')), '') IS NULL
     OR nullif(btrim(coalesce(p_intent_fingerprint, '')), '') IS NULL THEN
    RAISE EXCEPTION 'production write dedup and intent fingerprint required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_dedup_key, 0));
  SELECT o.* INTO v_existing
  FROM public.mirror_outbox o
  WHERE o.dedup_key = p_dedup_key
  FOR UPDATE;
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

CREATE OR REPLACE FUNCTION public.batch_write(
  p_row jsonb,
  p_event jsonb DEFAULT '{}'::jsonb
) RETURNS public.batches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_result public.batches%rowtype;
BEGIN
  INSERT INTO public.batches(
    id, client_slug, team, name, description, status, created_by, created_at,
    updated_at, linear_parent_ids
  ) VALUES (
    p_row->>'id',
    p_row->>'client_slug',
    p_row->>'team',
    p_row->>'name',
    nullif(p_row->>'description', ''),
    p_row->>'status',
    p_row->>'created_by',
    (p_row->>'created_at')::timestamptz,
    now(),
    p_row->'linear_parent_ids'
  )
  RETURNING * INTO v_result;
  INSERT INTO public.deliverable_events(
    deliverable_id, batch_id, client_slug, ts, actor, role, action,
    from_status, to_status, source, payload
  ) VALUES (
    null, v_result.id, v_result.client_slug, (p_event->>'ts')::timestamptz,
    p_event->>'actor', p_event->>'role', p_event->>'action', null, null,
    p_event->>'source', p_event
  );
  RETURN v_result;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.production_deliverable_write(
  p_row jsonb,
  p_event jsonb DEFAULT '{}'::jsonb
) RETURNS public.deliverables
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_result public.deliverables%rowtype;
  v_outbound jsonb := p_event->'outbound';
BEGIN
  INSERT INTO public.deliverables(
    id, batch_id, client_slug, team, kind, title, brief, status, status_at,
    assignee_id, due_date, origin, card_id, sync_state, created_by, created_at,
    updated_at, linear_issue_uuid, linear_raw
  ) VALUES (
    p_row->>'id', p_row->>'batch_id', p_row->>'client_slug', p_row->>'team',
    p_row->>'kind', p_row->>'title', nullif(p_row->>'brief', ''),
    p_row->>'status', (p_row->>'status_at')::timestamptz,
    nullif(p_row->>'assignee_id', ''), nullif(p_row->>'due_date', '')::date,
    p_row->>'origin', nullif(p_row->>'card_id', ''), p_row->>'sync_state',
    p_row->>'created_by', (p_row->>'created_at')::timestamptz, now(),
    p_row->>'linear_issue_uuid', p_row->'linear_raw'
  )
  RETURNING * INTO v_result;
  INSERT INTO public.deliverable_events(
    deliverable_id, batch_id, client_slug, ts, actor, role, action,
    from_status, to_status, source, payload
  ) VALUES (
    v_result.id, v_result.batch_id, v_result.client_slug,
    (p_event->>'ts')::timestamptz, p_event->>'actor', p_event->>'role',
    p_event->>'action', nullif(p_event->>'from_status', ''),
    nullif(p_event->>'to_status', ''), p_event->>'source', p_event
  );
  PERFORM public.mirror_outbox_enqueue(
    v_outbound->>'entity', v_outbound->>'entity_id',
    v_outbound->>'operation', v_outbound->'payload',
    v_outbound->>'dedup_key', (v_outbound->>'source_edited_at')::timestamptz,
    v_result.client_slug, v_outbound->>'team', p_event->>'actor',
    p_event->>'role', v_result.id, v_result.batch_id, null,
    nullif(v_outbound->>'depends_on_id', '')::bigint,
    coalesce((v_outbound->>'test_only')::boolean, false)
  );
  RETURN v_result;
END;
$fn$;

\ir ../migrations/2026-07-23-f203-production-issue-create.sql

-- Commit one valid root issue, edit every mutable field (including the complete
-- label relation), flip authority back to Linear, and replay the original
-- request. Exact receipt recovery must return the advanced row without a
-- second outbox/native write or a new authority dependency.
BEGIN;
UPDATE public.syncview_runtime_flags
SET value = '{"video":"syncview","graphics":"linear"}'::jsonb,
    updated_by = 'f203-disposable-proof'
WHERE key = 'prod_authority';

CREATE TEMP TABLE f203_request(batch jsonb, row_data jsonb, event jsonb);
INSERT INTO f203_request(batch, row_data, event)
SELECT
  jsonb_build_object(
    'id', 'f203-root-batch',
    'client_slug', 'test-client',
    'team', 'video',
    'name', 'F203 original title',
    'description', null,
    'status', 'active',
    'created_by', 'member:f203-proof',
    'created_at', '2026-07-23T12:00:00.000Z',
    'linear_parent_ids', jsonb_build_object(
      'video', jsonb_build_object(
        'uuid', '00000000-0000-4203-8203-000000000203',
        'identifier', '',
        'url', ''
      )
    )
  ),
  jsonb_build_object(
    'id', 'f203-root-deliverable',
    'batch_id', 'f203-root-batch',
    'client_slug', 'test-client',
    'team', 'video',
    'kind', 'other',
    'title', 'F203 original title',
    'brief', E'## Original Markdown\n\n- exact  \n',
    'status', 'todo',
    'status_at', '2026-07-23T12:00:00.000Z',
    'assignee_id', 'member-original',
    'due_date', '2026-08-19',
    'origin', 'manual',
    'card_id', null,
    'sync_state', 'pending',
    'created_by', 'member:f203-proof',
    'created_at', '2026-07-23T12:00:00.000Z',
    'linear_issue_uuid', '00000000-0000-4203-8203-000000000203',
    'linear_raw', jsonb_build_object(
      'issue', jsonb_build_object(
        'id', '00000000-0000-4203-8203-000000000203',
        'title', 'F203 original title',
        'description', E'## Original Markdown\n\n- exact  \n',
        'dueDate', '2026-08-19',
        'team', jsonb_build_object('id', 'team-video'),
        'project', jsonb_build_object('id', 'project-test-video'),
        'state', jsonb_build_object('id', 'state-todo'),
        'assignee', jsonb_build_object('id', 'linear-original'),
        'parent', null,
        'labelIds', jsonb_build_array('label-a', 'label-z'),
        'labels', jsonb_build_object(
          'nodes', jsonb_build_array(
            jsonb_build_object('id', 'label-a', 'name', 'Alpha', 'color', '#111111'),
            jsonb_build_object('id', 'label-z', 'name', 'Zulu', 'color', '#999999')
          ),
          'pageInfo', jsonb_build_object('hasNextPage', false, 'endCursor', null)
        )
      ),
      'attribution', jsonb_build_object(
        'schema', 'syncview_attribution_v1',
        'state', 'resolved',
        'client_slug', 'test-client',
        'project_id', 'project-test-video',
        'repair_required', false
      )
    )
  ),
  jsonb_build_object(
    'source', 'ui',
    'action', 'create',
    'surface', 'production',
    'actor', 'F203 Proof Admin',
    'actor_key', 'member:f203-proof',
    'auth_kind', 'staff',
    'role', 'admin',
    'ts', '2026-07-23T12:00:00.000Z',
    'from_status', null,
    'to_status', 'todo',
    'parent_deliverable_id', null,
    'outbound', jsonb_build_object(
      'entity', 'deliverable',
      'entity_id', 'f203-root-deliverable',
      'team', 'video',
      'operation', 'create',
      'dedup_key', 'write-ui:create:deliverable:f203-root-deliverable:f203-proof-request',
      'source_edited_at', '2026-07-23T12:00:00.000Z',
      'test_only', false,
      'legacy_parity', false,
      'payload', jsonb_build_object(
        'team_id', 'team-video',
        'project_id', 'project-test-video',
        'title', 'F203 original title',
        'description', E'## Original Markdown\n\n- exact  \n',
        'status', 'todo',
        'state_id', 'state-todo',
        'due_date', '2026-08-19',
        'assignee_id', 'member-original',
        'linear_user_id', 'linear-original',
        'parent_linear_issue_id', null,
        'label_ids', jsonb_build_array('label-a', 'label-z'),
        'planned_linear_issue_id', '00000000-0000-4203-8203-000000000203',
        '_intent_fingerprint', 'f203-exact-intent-fingerprint',
        '_f27_authority_generation', (
          SELECT generation
          FROM public.track_b_f27_team_fences
          WHERE team = 'video'
        ),
        '_f27_legacy_parity', false
      )
    )
  );

DO $proof$
DECLARE
  v_result jsonb;
  v_bad_row jsonb;
  v_child_row jsonb;
  v_child_event jsonb;
  v_create_outbox_id bigint;
BEGIN
  SELECT public.production_issue_create(r.batch, r.row_data, r.event)
    INTO v_result
  FROM f203_request r;
  IF coalesce((v_result->>'replay')::boolean, true)
     OR v_result->'row'->>'id' IS DISTINCT FROM 'f203-root-deliverable'
     OR (SELECT count(*) FROM public.mirror_outbox
         WHERE dedup_key = 'write-ui:create:deliverable:f203-root-deliverable:f203-proof-request') <> 1
     OR EXISTS (
       SELECT 1 FROM public.mirror_outbox
       WHERE entity = 'batch' AND entity_id = 'f203-root-batch' AND operation = 'create'
     )
     OR EXISTS (
       SELECT 1 FROM public.deliverable_events
       WHERE deliverable_id = 'f203-root-deliverable' AND payload ? 'outbound'
     ) THEN
    RAISE EXCEPTION 'f203_first_create_not_atomic';
  END IF;
  v_create_outbox_id := (v_result->>'outbox_id')::bigint;

  -- Exercise the real child branch in the same disposable database: it must
  -- reuse the root batch, depend on the root's one create intent, and create
  -- no structural batch or batch-level Linear intent.
  v_child_row := jsonb_build_object(
    'id', 'f203-child-deliverable',
    'batch_id', 'f203-root-batch',
    'client_slug', 'test-client',
    'team', 'video',
    'kind', 'other',
    'title', 'F203 child title',
    'brief', E'## Child Markdown\n',
    'status', 'in_progress',
    'status_at', '2026-07-23T12:01:00.000Z',
    'assignee_id', null,
    'due_date', '2026-08-20',
    'origin', 'manual',
    'card_id', null,
    'sync_state', 'pending',
    'created_by', 'member:f203-proof',
    'created_at', '2026-07-23T12:01:00.000Z',
    'linear_issue_uuid', '00000000-0000-4203-8203-000000000204',
    'linear_raw', jsonb_build_object(
      'issue', jsonb_build_object(
        'id', '00000000-0000-4203-8203-000000000204',
        'title', 'F203 child title',
        'description', E'## Child Markdown\n',
        'dueDate', '2026-08-20',
        'team', jsonb_build_object('id', 'team-video'),
        'project', jsonb_build_object('id', 'project-test-video'),
        'state', jsonb_build_object('id', 'state-in-progress'),
        'assignee', null,
        'parent', jsonb_build_object(
          'id', '00000000-0000-4203-8203-000000000203',
          'identifier', null,
          'title', 'F203 original title'
        ),
        'labelIds', jsonb_build_array('label-a'),
        'labels', jsonb_build_object(
          'nodes', jsonb_build_array(
            jsonb_build_object('id', 'label-a', 'name', 'Alpha', 'color', '#111111')
          ),
          'pageInfo', jsonb_build_object('hasNextPage', false, 'endCursor', null)
        )
      ),
      'attribution', jsonb_build_object(
        'schema', 'syncview_attribution_v1',
        'state', 'resolved',
        'client_slug', 'test-client',
        'project_id', 'project-test-video',
        'repair_required', false
      )
    )
  );
  v_child_event := jsonb_build_object(
    'source', 'ui',
    'action', 'create',
    'surface', 'production',
    'actor', 'F203 Proof Admin',
    'actor_key', 'member:f203-proof',
    'auth_kind', 'staff',
    'role', 'admin',
    'ts', '2026-07-23T12:01:00.000Z',
    'from_status', null,
    'to_status', 'in_progress',
    'parent_deliverable_id', 'f203-root-deliverable',
    'outbound', jsonb_build_object(
      'entity', 'deliverable',
      'entity_id', 'f203-child-deliverable',
      'team', 'video',
      'operation', 'create',
      'dedup_key', 'write-ui:create:deliverable:f203-child-deliverable:f203-child-request',
      'source_edited_at', '2026-07-23T12:01:00.000Z',
      'test_only', false,
      'legacy_parity', false,
      'depends_on_id', v_create_outbox_id,
      'payload', jsonb_build_object(
        'team_id', 'team-video',
        'project_id', 'project-test-video',
        'title', 'F203 child title',
        'description', E'## Child Markdown\n',
        'status', 'in_progress',
        'state_id', 'state-in-progress',
        'due_date', '2026-08-20',
        'assignee_id', null,
        'linear_user_id', null,
        'parent_linear_issue_id', null,
        'label_ids', jsonb_build_array('label-a'),
        'planned_linear_issue_id', '00000000-0000-4203-8203-000000000204',
        '_intent_fingerprint', 'f203-child-exact-intent-fingerprint',
        '_f27_authority_generation', (
          SELECT generation
          FROM public.track_b_f27_team_fences
          WHERE team = 'video'
        ),
        '_f27_legacy_parity', false
      )
    )
  );
  SELECT public.production_issue_create('{}'::jsonb, v_child_row, v_child_event)
    INTO v_result;
  IF coalesce((v_result->>'replay')::boolean, true)
     OR v_result->'row'->>'id' IS DISTINCT FROM 'f203-child-deliverable'
     OR v_result->'row'->>'batch_id' IS DISTINCT FROM 'f203-root-batch'
     OR v_result->'batch'->>'id' IS DISTINCT FROM 'f203-root-batch'
     OR (SELECT count(*) FROM public.batches
         WHERE id IN ('f203-root-batch', 'f203-child-batch')) <> 1
     OR (SELECT count(*) FROM public.mirror_outbox
         WHERE dedup_key =
           'write-ui:create:deliverable:f203-child-deliverable:f203-child-request'
           AND entity = 'deliverable'
           AND entity_id = 'f203-child-deliverable'
           AND operation = 'create'
           AND depends_on_id = v_create_outbox_id) <> 1
     OR EXISTS (
       SELECT 1 FROM public.mirror_outbox
       WHERE entity = 'batch' AND entity_id = 'f203-root-batch' AND operation = 'create'
     )
     OR (SELECT count(*) FROM public.deliverable_events
         WHERE deliverable_id = 'f203-child-deliverable'
           AND action = 'create'
           AND payload->>'parent_deliverable_id' = 'f203-root-deliverable') <> 1 THEN
    RAISE EXCEPTION 'f203_child_create_route_not_exact';
  END IF;

  UPDATE public.deliverables
  SET title = 'F203 later title',
      brief = E'## Later Markdown\n',
      status = 'approved',
      status_at = '2026-07-24T12:00:00.000Z',
      due_date = '2027-09-20',
      assignee_id = 'member-later',
      updated_at = '2026-07-24T12:00:00.000Z',
      linear_raw = jsonb_set(
        linear_raw,
        '{issue}',
        (linear_raw->'issue') || jsonb_build_object(
          'title', 'F203 later title',
          'description', E'## Later Markdown\n',
          'dueDate', '2027-09-20',
          'state', jsonb_build_object('id', 'state-approved'),
          'assignee', jsonb_build_object('id', 'linear-later'),
          'labelIds', jsonb_build_array('label-later'),
          'labels', jsonb_build_object(
            'nodes', jsonb_build_array(
              jsonb_build_object(
                'id', 'label-later',
                'name', 'Later',
                'color', '#abcdef'
              )
            ),
            'pageInfo', jsonb_build_object('hasNextPage', false, 'endCursor', null)
          )
        ),
        true
      )
  WHERE id = 'f203-root-deliverable';

  PERFORM public.mirror_outbox_enqueue(
    'deliverable',
    'f203-root-deliverable',
    'due',
    jsonb_build_object(
      'due_date', '2027-09-20',
      '_f27_authority_generation', (
        SELECT generation
        FROM public.track_b_f27_team_fences
        WHERE team = 'video'
      ),
      '_f27_legacy_parity', false
    ),
    'f203:later-due',
    '2026-07-24T12:00:00.000Z',
    'test-client',
    'video',
    'F203 Proof Admin',
    'admin',
    'f203-root-deliverable',
    'f203-root-batch',
    null,
    null,
    false
  );
  SELECT to_jsonb(public.production_issue_create_linkage(
    'f203-root-deliverable',
    v_create_outbox_id,
    jsonb_build_object(
      'id', 'f203-root-deliverable',
      'batch_id', 'f203-root-batch',
      'client_slug', 'test-client',
      'team', 'video',
      'kind', 'other',
      'origin', 'manual',
      'card_id', null,
      'created_by', 'member:f203-proof',
      'created_at', '2026-07-23T12:00:00.000Z',
      'planned_linear_issue_id', '00000000-0000-4203-8203-000000000203',
      'intent_fingerprint', 'f203-exact-intent-fingerprint'
    ),
    jsonb_build_object(
      'id', '00000000-0000-4203-8203-000000000203',
      'identifier', 'VID-203',
      'url', 'https://linear.example.invalid/VID-203'
    )
  )) INTO v_result;
  IF v_result->>'title' IS DISTINCT FROM 'F203 later title'
     OR v_result->>'brief' IS DISTINCT FROM E'## Later Markdown\n'
     OR v_result->>'due_date' IS DISTINCT FROM '2027-09-20'
     OR v_result->>'assignee_id' IS DISTINCT FROM 'member-later'
     OR v_result->>'sync_state' IS DISTINCT FROM 'pending'
     OR v_result->>'linear_identifier' IS DISTINCT FROM 'VID-203'
     OR v_result->>'linear_issue_url'
          IS DISTINCT FROM 'https://linear.example.invalid/VID-203'
     OR v_result->'linear_raw'->'issue'->>'title'
          IS DISTINCT FROM 'F203 later title'
     OR v_result->'linear_raw'->'issue'->>'description'
          IS DISTINCT FROM E'## Later Markdown\n'
     OR v_result->'linear_raw'->'issue'->'labelIds'
          IS DISTINCT FROM '["label-later"]'::jsonb
     OR v_result->'linear_raw'->'issue'->>'identifier' IS DISTINCT FROM 'VID-203'
     OR v_result->'linear_raw'->'issue'->>'url'
          IS DISTINCT FROM 'https://linear.example.invalid/VID-203' THEN
    RAISE EXCEPTION 'f203_post_read_edit_linkage_overwrite';
  END IF;

  UPDATE public.syncview_runtime_flags
  SET value = '{"video":"linear","graphics":"linear"}'::jsonb,
      updated_by = 'f203-authority-flip'
  WHERE key = 'prod_authority';

  SELECT public.production_issue_create(r.batch, r.row_data, r.event)
    INTO v_result
  FROM f203_request r;
  IF coalesce((v_result->>'replay')::boolean, false) IS DISTINCT FROM true
     OR v_result->'row'->>'title' IS DISTINCT FROM 'F203 later title'
     OR v_result->'row'->>'brief' IS DISTINCT FROM E'## Later Markdown\n'
     OR v_result->'row'->>'status' IS DISTINCT FROM 'approved'
     OR (v_result->'row'->>'status_at')::timestamptz
          IS DISTINCT FROM '2026-07-24T12:00:00.000Z'::timestamptz
     OR v_result->'row'->>'due_date' IS DISTINCT FROM '2027-09-20'
     OR v_result->'row'->>'assignee_id' IS DISTINCT FROM 'member-later'
     OR v_result->'row'->'linear_raw'->'issue'->'labelIds'
          IS DISTINCT FROM '["label-later"]'::jsonb
     OR (SELECT count(*) FROM public.mirror_outbox
         WHERE dedup_key = 'write-ui:create:deliverable:f203-root-deliverable:f203-proof-request') <> 1
     OR (SELECT count(*) FROM public.deliverable_events
         WHERE deliverable_id = 'f203-root-deliverable' AND action = 'create') <> 1 THEN
    RAISE EXCEPTION 'f203_mutated_authority_flipped_replay_failed';
  END IF;

  SELECT public.production_issue_create('{}'::jsonb, v_child_row, v_child_event)
    INTO v_result;
  IF coalesce((v_result->>'replay')::boolean, false) IS DISTINCT FROM true
     OR v_result->'row'->>'id' IS DISTINCT FROM 'f203-child-deliverable'
     OR v_result->'row'->>'batch_id' IS DISTINCT FROM 'f203-root-batch'
     OR (SELECT count(*) FROM public.mirror_outbox
         WHERE dedup_key =
           'write-ui:create:deliverable:f203-child-deliverable:f203-child-request'
           AND depends_on_id = v_create_outbox_id) <> 1 THEN
    RAISE EXCEPTION 'f203_child_authority_flipped_replay_failed';
  END IF;

  -- Parent shape is structural, not one of the mutable fields an exact retry
  -- may ignore. A root that gained a parent and a child moved elsewhere must
  -- both reject the original create replay, even after authority flips.
  UPDATE public.deliverables
  SET linear_raw = jsonb_set(
    linear_raw,
    '{issue,parent}',
    '{"id":"00000000-0000-4203-8203-000000009999"}'::jsonb,
    true
  )
  WHERE id = 'f203-root-deliverable';
  BEGIN
    PERFORM public.production_issue_create(r.batch, r.row_data, r.event)
    FROM f203_request r;
    RAISE EXCEPTION 'f203_root_reparent_replay_unexpectedly_accepted';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'production_create_id_conflict' THEN RAISE; END IF;
  END;
  UPDATE public.deliverables
  SET linear_raw = jsonb_set(linear_raw, '{issue,parent}', 'null'::jsonb, true)
  WHERE id = 'f203-root-deliverable';

  UPDATE public.deliverables
  SET linear_raw = jsonb_set(
    linear_raw,
    '{issue,parent}',
    '{"id":"00000000-0000-4203-8203-000000009998"}'::jsonb,
    true
  )
  WHERE id = 'f203-child-deliverable';
  BEGIN
    PERFORM public.production_issue_create('{}'::jsonb, v_child_row, v_child_event);
    RAISE EXCEPTION 'f203_child_reparent_replay_unexpectedly_accepted';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'production_create_id_conflict' THEN RAISE; END IF;
  END;
  UPDATE public.deliverables
  SET linear_raw = jsonb_set(
    linear_raw,
    '{issue,parent}',
    '{"id":"00000000-0000-4203-8203-000000000203","identifier":null,"title":"F203 later title"}'::jsonb,
    true
  )
  WHERE id = 'f203-child-deliverable';

  SELECT jsonb_set(
    r.row_data,
    '{linear_raw,issue,labels,nodes}',
    '[{"id":"label-a","name":"Alpha","color":"#111111"},{"id":"wrong-label","name":"Wrong","color":"#222222"}]'::jsonb
  ) INTO v_bad_row
  FROM f203_request r;
  BEGIN
    PERFORM public.production_issue_create(r.batch, v_bad_row, r.event)
    FROM f203_request r;
    RAISE EXCEPTION 'f203_wrong_label_relation_unexpectedly_accepted';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'invalid_production_create_payload' THEN RAISE; END IF;
  END;
END;
$proof$;

SELECT 'f203_mutable_authority_replay_exact' AS f203_disposable_proof;
ROLLBACK;

DO $proof$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.deliverables
    WHERE id IN ('f203-root-deliverable', 'f203-child-deliverable')
  ) OR EXISTS (
    SELECT 1 FROM public.batches WHERE id = 'f203-root-batch'
  ) OR EXISTS (
    SELECT 1 FROM public.mirror_outbox
    WHERE dedup_key IN (
      'write-ui:create:deliverable:f203-root-deliverable:f203-proof-request',
      'write-ui:create:deliverable:f203-child-deliverable:f203-child-request',
      'f203:later-due'
    )
  ) THEN
    RAISE EXCEPTION 'f203_disposable_proof_residue';
  END IF;
END;
$proof$;

\ir ../migrations/2026-07-12-production-comments.sql
\ir ../migrations/2026-07-23-production-comment-thread-lifecycle.sql

-- Reuse the established PostgreSQL 16 lane for F39/F42/F43. F2 remains off:
-- applicable add/edit/delete intents must still queue, while resolve/reopen are
-- canonical-only lifecycle transitions. Every fixture below is rolled back.
BEGIN;

INSERT INTO public.batches(
  id, client_slug, team, name, status, created_by, linear_parent_ids
) VALUES (
  'f43-comment-batch', 'test-client', 'video', 'F43 fixture', 'active',
  'f43-disposable-proof',
  '{"video":{"id":"linear-fixture-issue"}}'::jsonb
);
INSERT INTO public.deliverables(
  id, batch_id, client_slug, team, kind, title, status, origin, card_id,
  sync_state, created_by, linear_issue_uuid
) VALUES
  (
    'f43-comment-deliverable', 'f43-comment-batch', 'test-client', 'video',
    'video', 'F43 canonical thread', 'in_progress', 'calendar',
    'f43-calendar-card', 'clean', 'f43-disposable-proof',
    'linear-fixture-issue'
  ),
  (
    'f42-card-deliverable', 'f43-comment-batch', 'test-client', 'video',
    'video', 'F42 card thread', 'in_progress', 'calendar',
    'f42-calendar-card', 'clean', 'f42-disposable-proof',
    'linear-f42-issue'
  );

SET LOCAL ROLE service_role;
INSERT INTO public.production_comment_read_audit(
  actor_key, auth_kind, deliverable_id, decision, reason
) VALUES (
  'member:f43-direct', 'staff', 'f43-comment-deliverable',
  'deny', 'fixture_denial'
);
RESET ROLE;

DO $proof$
DECLARE
  v_result jsonb;
  v_index integer;
BEGIN
  FOR v_index IN 1..120 LOOP
    v_result := public.production_comment_read_budget_take('member:f43-budget');
    IF v_result->'allowed' IS DISTINCT FROM 'true'::jsonb THEN
      RAISE EXCEPTION 'f39_principal_budget_rejected_early';
    END IF;
  END LOOP;
  v_result := public.production_comment_read_budget_take('member:f43-budget');
  IF v_result->'allowed' IS DISTINCT FROM 'false'::jsonb
     OR (v_result->>'remaining')::integer <> 0 THEN
    RAISE EXCEPTION 'f39_principal_budget_not_bounded';
  END IF;
  v_result := public.production_comment_read_authorize(
    'member:f43-reader', 'staff', 'f43-comment-deliverable'
  );
  IF v_result->'authorized' IS DISTINCT FROM 'true'::jsonb
     OR NOT EXISTS (
       SELECT 1 FROM public.production_comment_read_audit
       WHERE actor_key = 'member:f43-reader'
         AND deliverable_id = 'f43-comment-deliverable'
         AND decision = 'allow'
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.production_comment_read_audit
       WHERE actor_key = 'member:f43-direct'
         AND decision = 'deny'
     ) THEN
    RAISE EXCEPTION 'f39_read_audit_not_exact';
  END IF;
END;
$proof$;

DO $proof$
DECLARE
  v_generation bigint;
  v_row public.production_comments%rowtype;
BEGIN
  IF (SELECT value FROM public.syncview_runtime_flags
      WHERE key = 'linear_outbound_enabled') IS DISTINCT FROM '{"mode":"off"}'::jsonb THEN
    RAISE EXCEPTION 'f43_f2_not_off_for_pause_proof';
  END IF;
  SELECT generation INTO v_generation
  FROM public.track_b_f27_team_fences WHERE team = 'video';

  v_row := public.production_comment_write(
    jsonb_build_object(
      'id', 'f43-root-comment',
      'idempotency_key', 'f43:comment:add',
      'native_comment_id', 'f43-root-native',
      'deliverable_id', 'f43-comment-deliverable',
      'operation', 'add',
      'author_key', 'member:f43-smm',
      'author_member_id', '00000000-0000-4000-8000-000000000043',
      'author_name', 'F43 Fixture SMM',
      'role', 'smm',
      'body', E'Root **Markdown**',
      'audience', 'client',
      'component', 'video',
      'source', 'ui',
      'source_created_at', '2026-07-23T14:00:00Z',
      'source_updated_at', '2026-07-23T14:00:00Z'
    ),
    jsonb_build_object(
      'source', 'ui',
      'actor', 'F43 Fixture SMM',
      'role', 'smm',
      'outbound', jsonb_build_object(
        'operation', 'comment',
        'dedup_key', 'f43:comment:add',
        'test_only', true,
        'legacy_parity', false,
        'payload', jsonb_build_object(
          'body', E'Root **Markdown**',
          '_intent_fingerprint', 'f43-add-fingerprint',
          '_f27_authority_generation', v_generation,
          '_f27_legacy_parity', false
        )
      )
    )
  );
  IF v_row.id <> 'f43-root-comment' THEN
    RAISE EXCEPTION 'f43_comment_add_not_exact';
  END IF;

  -- Response-loss replay is the same canonical row and one applicable intent.
  v_row := public.production_comment_write(
    jsonb_build_object(
      'id', 'f43-root-comment',
      'idempotency_key', 'f43:comment:add',
      'native_comment_id', 'f43-root-native',
      'deliverable_id', 'f43-comment-deliverable',
      'operation', 'add',
      'author_key', 'member:f43-smm',
      'author_member_id', '00000000-0000-4000-8000-000000000043',
      'author_name', 'F43 Fixture SMM',
      'role', 'smm',
      'body', E'Root **Markdown**',
      'audience', 'client',
      'component', 'video',
      'source', 'ui',
      'source_created_at', '2026-07-23T14:00:00Z',
      'source_updated_at', '2026-07-23T14:00:00Z'
    ),
    jsonb_build_object(
      'source', 'ui',
      'actor', 'F43 Fixture SMM',
      'role', 'smm',
      'outbound', jsonb_build_object(
        'operation', 'comment',
        'dedup_key', 'f43:comment:add',
        'test_only', true,
        'legacy_parity', false,
        'payload', jsonb_build_object(
          'body', E'Root **Markdown**',
          '_intent_fingerprint', 'f43-add-fingerprint',
          '_f27_authority_generation', v_generation,
          '_f27_legacy_parity', false
        )
      )
    )
  );

  IF (SELECT count(*) FROM public.mirror_outbox
      WHERE dedup_key = 'f43:comment:add') <> 1
     OR NOT EXISTS (
       SELECT 1 FROM public.mirror_outbox
       WHERE dedup_key = 'f43:comment:add'
         AND operation = 'comment'
         AND comment_id = 'f43-root-comment'
         AND payload->>'action' = 'add'
         AND payload->>'comment_id' = 'f43-root-comment'
     )
     OR (SELECT count(*) FROM public.production_comment_mutation_receipts
         WHERE dedup_key = 'f43:comment:add') <> 1 THEN
    RAISE EXCEPTION 'f43_f2_off_comment_enqueue_not_exact';
  END IF;
END;
$proof$;

CREATE TEMP TABLE f43_after_add AS
SELECT version, updated_at
FROM public.production_comments
WHERE id = 'f43-root-comment';

SELECT public.production_comment_lifecycle_write(
  jsonb_build_object(
    'id', 'f43-root-comment',
    'operation', 'edit',
    'body', E'Edited **Markdown**',
    'edited_at', '2026-07-23T14:05:00Z',
    'source_updated_at', '2026-07-23T14:05:00Z'
  ),
  jsonb_build_object(
    'source', 'ui',
    'actor', 'F43 Fixture SMM',
    'role', 'smm',
    'outbound', jsonb_build_object(
      'dedup_key', 'f43:comment:edit',
      'test_only', true,
      'legacy_parity', false,
      'payload', jsonb_build_object(
        '_intent_fingerprint', 'f43-edit-fingerprint',
        '_f27_authority_generation', (
          SELECT generation FROM public.track_b_f27_team_fences WHERE team = 'video'
        ),
        '_f27_legacy_parity', false
      )
    )
  ),
  (SELECT version FROM f43_after_add),
  (SELECT updated_at FROM f43_after_add)
);

DO $proof$
DECLARE
  v_stale f43_after_add%rowtype;
BEGIN
  SELECT * INTO v_stale FROM f43_after_add;
  BEGIN
    PERFORM public.production_comment_lifecycle_write(
      jsonb_build_object(
        'id', 'f43-root-comment',
        'operation', 'edit',
        'body', 'stale overwrite',
        'source_updated_at', '2026-07-23T14:06:00Z'
      ),
      jsonb_build_object(
        'source', 'ui',
        'actor', 'F43 Fixture SMM',
        'role', 'smm',
        'outbound', jsonb_build_object(
          'dedup_key', 'f43:comment:stale-edit',
          'test_only', true,
          'legacy_parity', false,
          'payload', jsonb_build_object(
            '_intent_fingerprint', 'f43-stale-fingerprint'
          )
        )
      ),
      v_stale.version,
      v_stale.updated_at
    );
    RAISE EXCEPTION 'f43_stale_comment_write_unexpectedly_succeeded';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'comment_write_conflict' THEN RAISE; END IF;
  END;
END;
$proof$;

CREATE TEMP TABLE f43_after_edit AS
SELECT version, updated_at
FROM public.production_comments
WHERE id = 'f43-root-comment';

SELECT public.production_comment_lifecycle_write(
  jsonb_build_object(
    'id', 'f43-root-comment',
    'operation', 'resolve',
    'resolved_by_key', 'member:f43-smm',
    'resolved_by_name', 'F43 Fixture SMM',
    'source_updated_at', '2026-07-23T14:07:00Z'
  ),
  jsonb_build_object(
    'source', 'ui',
    'actor', 'F43 Fixture SMM',
    'role', 'smm',
    'outbound', jsonb_build_object(
      'dedup_key', 'f43:comment:resolve',
      'test_only', true,
      'legacy_parity', false,
      'payload', jsonb_build_object(
        '_intent_fingerprint', 'f43-resolve-fingerprint'
      )
    )
  ),
  (SELECT version FROM f43_after_edit),
  (SELECT updated_at FROM f43_after_edit)
);

CREATE TEMP TABLE f43_after_resolve AS
SELECT version, updated_at
FROM public.production_comments
WHERE id = 'f43-root-comment';

SELECT public.production_comment_lifecycle_write(
  jsonb_build_object(
    'id', 'f43-root-comment',
    'operation', 'delete',
    'deleted_by_key', 'member:f43-smm',
    'deleted_by_name', 'F43 Fixture SMM',
    'source_updated_at', '2026-07-23T14:08:00Z'
  ),
  jsonb_build_object(
    'source', 'ui',
    'actor', 'F43 Fixture SMM',
    'role', 'smm',
    'outbound', jsonb_build_object(
      'dedup_key', 'f43:comment:delete',
      'test_only', true,
      'legacy_parity', false,
      'payload', jsonb_build_object(
        '_intent_fingerprint', 'f43-delete-fingerprint'
      )
    )
  ),
  (SELECT version FROM f43_after_resolve),
  (SELECT updated_at FROM f43_after_resolve)
);

DO $proof$
DECLARE
  v_add_id bigint;
  v_edit_id bigint;
  v_delete_id bigint;
  v_replay public.production_comments%rowtype;
BEGIN
  SELECT id INTO v_add_id
  FROM public.mirror_outbox WHERE dedup_key = 'f43:comment:add';
  SELECT id INTO v_edit_id
  FROM public.mirror_outbox WHERE dedup_key = 'f43:comment:edit';
  SELECT id INTO v_delete_id
  FROM public.mirror_outbox WHERE dedup_key = 'f43:comment:delete';

  IF (SELECT count(*) FROM public.mirror_outbox
      WHERE dedup_key IN (
        'f43:comment:add', 'f43:comment:edit', 'f43:comment:delete'
      )) <> 3
     OR EXISTS (
       SELECT 1 FROM public.mirror_outbox
       WHERE dedup_key IN (
         'f43:comment:add', 'f43:comment:edit', 'f43:comment:delete'
       )
         AND status <> 'pending'
     )
     OR (SELECT depends_on_id FROM public.mirror_outbox
         WHERE id = v_edit_id) IS DISTINCT FROM v_add_id
     OR (SELECT depends_on_id FROM public.mirror_outbox
         WHERE id = v_delete_id) IS DISTINCT FROM v_edit_id
     OR EXISTS (
       SELECT 1 FROM public.mirror_outbox
       WHERE id IN (v_edit_id, v_delete_id)
         AND payload->>'linear_comment_id' IS NOT NULL
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.production_comments
       WHERE id = 'f43-root-comment'
         AND linear_comment_id IS NULL
         AND body = E'Edited **Markdown**'
         AND resolved_at = '2026-07-23T14:07:00Z'::timestamptz
         AND deleted_at = '2026-07-23T14:08:00Z'::timestamptz
     ) THEN
    RAISE EXCEPTION 'f43_f2_off_create_edit_delete_not_ordered';
  END IF;

  -- Simulate the resumed drainer without any live call: create acknowledgement
  -- checkpoints and binds the provider id, edit consumes that dependency
  -- receipt and hands the same id to delete, then each row terminalizes once.
  UPDATE public.mirror_outbox
  SET linear_result = jsonb_build_object(
        'mutation', 'commentCreate',
        'comment_id', 'linear-comment-f43',
        'recovered_idempotently', false
      ),
      updated_at = now()
  WHERE id = v_add_id;
  PERFORM public.production_comment_bind_linear_id(
    'f43-root-comment', 'linear-comment-f43', v_add_id
  );
  UPDATE public.mirror_outbox
  SET status = 'written', processed_at = now(), updated_at = now()
  WHERE id = v_add_id;

  IF (SELECT linear_result->>'comment_id' FROM public.mirror_outbox
      WHERE id = v_add_id) <> 'linear-comment-f43' THEN
    RAISE EXCEPTION 'f43_add_provider_handoff_missing';
  END IF;
  UPDATE public.mirror_outbox
  SET linear_result = jsonb_build_object(
        'mutation', 'commentUpdate',
        'comment_id', (
          SELECT linear_result->>'comment_id'
          FROM public.mirror_outbox WHERE id = v_add_id
        )
      ),
      updated_at = now()
  WHERE id = v_edit_id;
  PERFORM public.production_comment_bind_linear_id(
    'f43-root-comment',
    (SELECT linear_result->>'comment_id'
     FROM public.mirror_outbox WHERE id = v_edit_id),
    v_edit_id
  );
  UPDATE public.mirror_outbox
  SET status = 'written', processed_at = now(), updated_at = now()
  WHERE id = v_edit_id;

  UPDATE public.mirror_outbox
  SET status = 'written',
      processed_at = now(),
      linear_result = jsonb_build_object(
        'mutation', 'commentDelete',
        'comment_id', (
          SELECT linear_result->>'comment_id'
          FROM public.mirror_outbox WHERE id = v_edit_id
        ),
        'delete_attempted', true,
        'delete_applied', true
      ),
      updated_at = now()
  WHERE id = v_delete_id;

  -- Exact response-loss replays return their durable receipt before stale CAS
  -- checks, produce no second intent, and retain the final canonical tombstone.
  v_replay := public.production_comment_lifecycle_write(
    jsonb_build_object(
      'id', 'f43-root-comment',
      'operation', 'edit',
      'body', E'Edited **Markdown**',
      'edited_at', '2026-07-23T14:05:00Z',
      'source_updated_at', '2026-07-23T14:05:00Z'
    ),
    jsonb_build_object(
      'source', 'ui',
      'actor', 'F43 Fixture SMM',
      'role', 'smm',
      'outbound', jsonb_build_object(
        'dedup_key', 'f43:comment:edit',
        'test_only', true,
        'legacy_parity', false,
        'payload', jsonb_build_object(
          '_intent_fingerprint', 'f43-edit-fingerprint'
        )
      )
    ),
    (SELECT version FROM f43_after_add),
    (SELECT updated_at FROM f43_after_add)
  );
  IF v_replay.id <> 'f43-root-comment'
     OR v_replay.linear_comment_id <> 'linear-comment-f43'
     OR v_replay.deleted_at IS NULL THEN
    RAISE EXCEPTION 'f43_edit_exact_replay_not_canonical';
  END IF;

  v_replay := public.production_comment_lifecycle_write(
    jsonb_build_object(
      'id', 'f43-root-comment',
      'operation', 'delete',
      'deleted_by_key', 'member:f43-smm',
      'deleted_by_name', 'F43 Fixture SMM',
      'source_updated_at', '2026-07-23T14:08:00Z'
    ),
    jsonb_build_object(
      'source', 'ui',
      'actor', 'F43 Fixture SMM',
      'role', 'smm',
      'outbound', jsonb_build_object(
        'dedup_key', 'f43:comment:delete',
        'test_only', true,
        'legacy_parity', false,
        'payload', jsonb_build_object(
          '_intent_fingerprint', 'f43-delete-fingerprint'
        )
      )
    ),
    (SELECT version FROM f43_after_resolve),
    (SELECT updated_at FROM f43_after_resolve)
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.production_comments
    WHERE id = 'f43-root-comment'
      AND body = E'Edited **Markdown**'
      AND linear_comment_id = 'linear-comment-f43'
      AND resolved_at = '2026-07-23T14:07:00Z'::timestamptz
      AND deleted_at = '2026-07-23T14:08:00Z'::timestamptz
  ) OR NOT EXISTS (
    SELECT 1 FROM public.mirror_outbox
    WHERE dedup_key = 'f43:comment:edit'
      AND operation = 'comment'
      AND payload->>'action' = 'edit'
      AND depends_on_id = v_add_id
      AND linear_result->>'comment_id' = 'linear-comment-f43'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.mirror_outbox
    WHERE dedup_key = 'f43:comment:delete'
      AND operation = 'comment'
      AND payload->>'action' = 'delete'
      AND depends_on_id = v_edit_id
      AND linear_result->>'comment_id' = 'linear-comment-f43'
      AND linear_result->>'delete_applied' = 'true'
  ) OR EXISTS (
    SELECT 1 FROM public.mirror_outbox
    WHERE dedup_key = 'f43:comment:resolve'
  ) OR EXISTS (
    SELECT 1 FROM public.mirror_outbox
    WHERE dedup_key = 'f43:comment:stale-edit'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.deliverable_events
    WHERE deliverable_id = 'f43-comment-deliverable'
      AND action = 'comment_edit'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.deliverable_events
    WHERE deliverable_id = 'f43-comment-deliverable'
      AND action = 'comment_resolve'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.deliverable_events
    WHERE deliverable_id = 'f43-comment-deliverable'
      AND action = 'comment_delete'
  ) OR EXISTS (
    SELECT 1
    FROM (
      SELECT dedup_key, count(*) AS row_count
      FROM public.mirror_outbox
      WHERE dedup_key IN (
        'f43:comment:add', 'f43:comment:edit', 'f43:comment:delete'
      )
      GROUP BY dedup_key
    ) exact
    WHERE exact.row_count <> 1
  ) THEN
    RAISE EXCEPTION 'f43_lifecycle_conflict_audit_or_mirror_not_exact';
  END IF;
END;
$proof$;

SELECT public.production_comment_card_import(
  jsonb_build_object(
    'source_surface', 'calendar',
    'card_id', 'f42-calendar-card',
    'component', 'video',
    'native_comment_id', 'legacy-root',
    'deliverable_id', 'f42-card-deliverable',
    'client_slug', 'test-client',
    'team', 'video',
    'source_fingerprint', 'f42-source-fingerprint'
  ),
  jsonb_build_object(
    'author_key', 'legacy:calendar:f42-calendar-card:fixture',
    'author_name', 'F42 Fixture',
    'role', 'smm',
    'body', 'Imported card root',
    'body_format', 'markdown',
    'attachments', jsonb_build_array(
      jsonb_build_object('url', 'https://example.invalid/f42.png', 'name', 'F42')
    ),
    'audience', 'client',
    'component', 'video',
    'is_tweak', true,
    'round', 1,
    'source_created_at', '2026-07-23T13:00:00Z',
    'source_updated_at', '2026-07-23T13:00:00Z',
    'import_run_id', 'f42-proof-run',
    'backfill_tag', 'f42-card-thread'
  ),
  jsonb_build_object(
    'source', 'backfill',
    'actor', 'f42-card-comment-import',
    'role', 'service'
  )
);
SELECT public.production_comment_card_import(
  jsonb_build_object(
    'source_surface', 'calendar',
    'card_id', 'f42-calendar-card',
    'component', 'video',
    'native_comment_id', 'legacy-root',
    'deliverable_id', 'f42-card-deliverable',
    'client_slug', 'test-client',
    'team', 'video',
    'source_fingerprint', 'f42-source-fingerprint'
  ),
  jsonb_build_object(
    'author_key', 'legacy:calendar:f42-calendar-card:fixture',
    'author_name', 'F42 Fixture',
    'role', 'smm',
    'body', 'Imported card root',
    'audience', 'client',
    'source_created_at', '2026-07-23T13:00:00Z',
    'source_updated_at', '2026-07-23T13:00:00Z',
    'import_run_id', 'f42-proof-rerun'
  ),
  jsonb_build_object('source', 'backfill')
);
SELECT public.production_comment_card_import(
  jsonb_build_object(
    'source_surface', 'calendar',
    'card_id', 'f42-calendar-card',
    'component', 'video',
    'native_comment_id', 'legacy-delete-root',
    'deliverable_id', 'f42-card-deliverable',
    'client_slug', 'test-client',
    'team', 'video',
    'source_fingerprint', 'f42-delete-source-fingerprint'
  ),
  jsonb_build_object(
    'author_key', 'legacy:calendar:f42-calendar-card:delete-fixture',
    'author_name', 'F42 Delete Fixture',
    'role', 'smm',
    'body', 'Imported card root deleted before foreign materialization',
    'body_format', 'markdown',
    'audience', 'internal',
    'component', 'video',
    'source_created_at', '2026-07-23T13:01:00Z',
    'source_updated_at', '2026-07-23T13:01:00Z',
    'import_run_id', 'f42-proof-run',
    'backfill_tag', 'f42-card-thread'
  ),
  jsonb_build_object(
    'source', 'backfill',
    'actor', 'f42-card-comment-import',
    'role', 'service'
  )
);

DO $proof$
BEGIN
  IF (SELECT count(*) FROM public.production_comment_card_links
      WHERE source_surface = 'calendar'
        AND card_id = 'f42-calendar-card'
        AND component = 'video'
        AND native_comment_id = 'legacy-root') <> 1
     OR NOT EXISTS (
       SELECT 1
       FROM public.production_comment_card_links l
       JOIN public.production_comments c
         ON c.id = l.production_comment_id
       WHERE l.native_comment_id = 'legacy-root'
         AND c.native_comment_id = c.id
         AND c.deliverable_id = 'f42-card-deliverable'
         AND c.audience = 'client'
         AND c.is_tweak = true
         AND c.attachments->0->>'url' = 'https://example.invalid/f42.png'
         AND c.provenance->>'native_comment_id' = 'legacy-root'
     ) THEN
    RAISE EXCEPTION 'f42_card_import_or_idempotent_rerun_not_exact';
  END IF;

  BEGIN
    PERFORM public.production_comment_card_import(
      jsonb_build_object(
        'source_surface', 'calendar',
        'card_id', 'f42-calendar-card',
        'component', 'video',
        'native_comment_id', 'legacy-root',
        'deliverable_id', 'f42-card-deliverable',
        'client_slug', 'other-client',
        'team', 'video',
        'source_fingerprint', 'f42-source-fingerprint'
      ),
      '{}'::jsonb,
      '{}'::jsonb
    );
    RAISE EXCEPTION 'f42_cross_client_import_unexpectedly_succeeded';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'production comment card import crosswalk mismatch' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.production_comment_card_import(
      jsonb_build_object(
        'source_surface', 'calendar',
        'card_id', 'f42-calendar-card',
        'component', 'video',
        'native_comment_id', 'legacy-root',
        'deliverable_id', 'f42-card-deliverable',
        'client_slug', 'test-client',
        'team', 'video',
        'source_fingerprint', 'different-fingerprint'
      ),
      '{}'::jsonb,
      '{}'::jsonb
    );
    RAISE EXCEPTION 'f42_different_source_rerun_unexpectedly_succeeded';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'production comment card import identity conflict' THEN RAISE; END IF;
  END;
END;
$proof$;

-- F42 import creates canonical history only. Prove that the first edit and
-- first delete cannot become providerless foreign mutations: the edit receives
-- the authoritative materialize marker and can bind one provider id, while a
-- separate imported row's first delete receives the no-foreign-object marker
-- with no predecessor/provider id for the drainer's terminal no-op branch.
DO $proof$
DECLARE
  v_edit_comment public.production_comments%rowtype;
  v_delete_comment public.production_comments%rowtype;
  v_edit_result public.production_comments%rowtype;
  v_delete_result public.production_comments%rowtype;
  v_edit_outbox public.mirror_outbox%rowtype;
  v_delete_outbox public.mirror_outbox%rowtype;
  v_generation bigint;
BEGIN
  SELECT c.* INTO v_edit_comment
  FROM public.production_comment_card_links l
  JOIN public.production_comments c ON c.id = l.production_comment_id
  WHERE l.source_surface = 'calendar'
    AND l.card_id = 'f42-calendar-card'
    AND l.component = 'video'
    AND l.native_comment_id = 'legacy-root';
  SELECT c.* INTO v_delete_comment
  FROM public.production_comment_card_links l
  JOIN public.production_comments c ON c.id = l.production_comment_id
  WHERE l.source_surface = 'calendar'
    AND l.card_id = 'f42-calendar-card'
    AND l.component = 'video'
    AND l.native_comment_id = 'legacy-delete-root';
  SELECT generation INTO v_generation
  FROM public.track_b_f27_team_fences
  WHERE team = 'video';

  IF v_edit_comment.id IS NULL OR v_delete_comment.id IS NULL
     OR v_edit_comment.linear_comment_id IS NOT NULL
     OR v_delete_comment.linear_comment_id IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM public.mirror_outbox
       WHERE comment_id IN (v_edit_comment.id, v_delete_comment.id)
     ) THEN
    RAISE EXCEPTION 'f42_import_without_foreign_precondition_failed';
  END IF;

  v_edit_result := public.production_comment_lifecycle_write(
    jsonb_build_object(
      'id', v_edit_comment.id,
      'operation', 'edit',
      'body', 'Current imported canonical body',
      'edited_at', '2026-07-23T13:10:00Z',
      'source_updated_at', '2026-07-23T13:10:00Z'
    ),
    jsonb_build_object(
      'source', 'ui',
      'actor', 'F42 Fixture SMM',
      'role', 'smm',
      'outbound', jsonb_build_object(
        'dedup_key', 'f42:import:first-edit',
        'test_only', true,
        'legacy_parity', false,
        'payload', jsonb_build_object(
          '_intent_fingerprint', 'f42-import-edit-fingerprint',
          '_f27_authority_generation', v_generation,
          '_f27_legacy_parity', false
        )
      )
    ),
    v_edit_comment.version,
    v_edit_comment.updated_at
  );
  SELECT * INTO v_edit_outbox
  FROM public.mirror_outbox
  WHERE dedup_key = 'f42:import:first-edit';

  IF v_edit_result.body IS DISTINCT FROM 'Current imported canonical body'
     OR v_edit_outbox.id IS NULL
     OR v_edit_outbox.depends_on_id IS NOT NULL
     OR v_edit_outbox.payload->>'action' IS DISTINCT FROM 'edit'
     OR v_edit_outbox.payload->>'linear_comment_id' IS NOT NULL
     OR v_edit_outbox.payload->>'card_import_without_foreign' IS DISTINCT FROM 'true'
     OR v_edit_outbox.payload->>'body' IS DISTINCT FROM 'Current imported canonical body' THEN
    RAISE EXCEPTION 'f42_import_first_edit_materialization_not_exact';
  END IF;

  v_edit_result := public.production_comment_bind_linear_id(
    v_edit_comment.id,
    'linear-comment-f42-import',
    v_edit_outbox.id
  );
  IF v_edit_result.linear_comment_id IS DISTINCT FROM 'linear-comment-f42-import' THEN
    RAISE EXCEPTION 'f42_import_first_edit_provider_bind_failed';
  END IF;

  v_delete_result := public.production_comment_lifecycle_write(
    jsonb_build_object(
      'id', v_delete_comment.id,
      'operation', 'delete',
      'deleted_by_key', 'member:f42-smm',
      'deleted_by_name', 'F42 Fixture SMM',
      'source_updated_at', '2026-07-23T13:11:00Z'
    ),
    jsonb_build_object(
      'source', 'ui',
      'actor', 'F42 Fixture SMM',
      'role', 'smm',
      'outbound', jsonb_build_object(
        'dedup_key', 'f42:import:first-delete',
        'test_only', true,
        'legacy_parity', false,
        'payload', jsonb_build_object(
          '_intent_fingerprint', 'f42-import-delete-fingerprint',
          '_f27_authority_generation', v_generation,
          '_f27_legacy_parity', false
        )
      )
    ),
    v_delete_comment.version,
    v_delete_comment.updated_at
  );
  SELECT * INTO v_delete_outbox
  FROM public.mirror_outbox
  WHERE dedup_key = 'f42:import:first-delete';

  IF v_delete_result.deleted_at IS NULL
     OR v_delete_outbox.id IS NULL
     OR v_delete_outbox.depends_on_id IS NOT NULL
     OR v_delete_outbox.payload->>'action' IS DISTINCT FROM 'delete'
     OR v_delete_outbox.payload->>'linear_comment_id' IS NOT NULL
     OR v_delete_outbox.payload->>'card_import_without_foreign' IS DISTINCT FROM 'true'
     OR EXISTS (
       SELECT 1 FROM public.mirror_outbox
       WHERE comment_id = v_delete_comment.id
         AND id <> v_delete_outbox.id
     ) THEN
    RAISE EXCEPTION 'f42_import_without_foreign_transition_not_exact';
  END IF;
END;
$proof$;

ROLLBACK;

DO $proof$
BEGIN
  IF EXISTS (SELECT 1 FROM public.production_comments)
     OR EXISTS (SELECT 1 FROM public.production_comment_card_links)
     OR EXISTS (SELECT 1 FROM public.production_comment_mutation_receipts)
     OR EXISTS (SELECT 1 FROM public.production_comment_read_audit)
     OR EXISTS (SELECT 1 FROM public.production_comment_read_budget)
     OR EXISTS (
       SELECT 1 FROM public.mirror_outbox
       WHERE dedup_key LIKE 'f43:%'
     ) THEN
    RAISE EXCEPTION 'f39_f42_f43_disposable_proof_residue';
  END IF;
END;
$proof$;

-- A future F27 install must preserve F201 and F202. Exercise labels and an
-- exact Markdown description through the generation-fenced enqueue body, then
-- discard both disposable TEST rows.
BEGIN;
SELECT public.mirror_outbox_enqueue(
  'deliverable',
  'f201-f27-labels',
  'labels',
  jsonb_build_object(
    'label_ids', jsonb_build_array('f201-label'),
    '_f27_authority_generation', (
      select generation from public.track_b_f27_team_fences where team = 'video'
    ),
    '_f27_legacy_parity', false
  ),
  'f201:f27:labels',
  now(),
  'test-client',
  'video',
  'f201-disposable-proof',
  'system',
  null,
  null,
  null,
  null,
  true
);
SELECT public.mirror_outbox_enqueue(
  'deliverable',
  'f202-f27-description',
  'description',
  jsonb_build_object(
    'description', E'  # F202\n\n- exact Markdown  \n',
    '_f27_authority_generation', (
      select generation from public.track_b_f27_team_fences where team = 'video'
    ),
    '_f27_legacy_parity', false
  ),
  'f202:f27:description',
  now(),
  'test-client',
  'video',
  'f202-disposable-proof',
  'system',
  null,
  null,
  null,
  null,
  true
);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.mirror_outbox
    WHERE dedup_key = 'f201:f27:labels'
      AND operation = 'labels'
      AND op = 'update_fields'
      AND payload = '{"label_ids":["f201-label"]}'::jsonb
  ) THEN
    RAISE EXCEPTION 'f201_f27_labels_enqueue_not_exact';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.mirror_outbox
    WHERE dedup_key = 'f202:f27:description'
      AND operation = 'description'
      AND op = 'update_fields'
      AND payload = jsonb_build_object(
        'description',
        E'  # F202\n\n- exact Markdown  \n'
      )
  ) THEN
    RAISE EXCEPTION 'f202_f27_description_enqueue_not_exact';
  END IF;
END $$;
ROLLBACK;

-- UPDATE OF must cover every lane/fence field used by the guard. A direct
-- service-role change to an active row's generation is revalidated even when
-- status and team themselves do not change.
DO $$
BEGIN
  BEGIN
    UPDATE public.mirror_outbox
    SET authority_generation = authority_generation + 99
    WHERE id = 5;
    RAISE EXCEPTION 'dependency-only fence update unexpectedly succeeded';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'f27_authority_generation_stale:video' THEN RAISE; END IF;
  END;
END $$;

-- Capture row-level isolation only after the additive migration has supplied
-- its trusted fence columns. Payload hashes intentionally span the migration.
CREATE TEMP TABLE f27_other_team AS
SELECT encode(extensions.digest(convert_to(to_jsonb(o)::text, 'UTF8'), 'sha256'), 'hex') AS row_hash
FROM public.mirror_outbox o WHERE team = 'video';

-- Simulated forward cycle in the disposable TEST flag store only.
UPDATE public.syncview_runtime_flags
SET value = '{"video":"linear","graphics":"syncview"}', updated_by = 'f27-test-forward'
WHERE key = 'prod_authority'
  AND value = '{"video":"linear","graphics":"linear"}';
UPDATE public.syncview_runtime_flags
SET value = '{"mode":"live"}', updated_by = 'f27-test-forward'
WHERE key = 'linear_outbound_enabled' AND value = '{"mode":"off"}';
UPDATE public.syncview_runtime_flags
SET value = '{"enabled":true}', updated_by = 'f27-test-forward'
WHERE key = 'linear_legacy_parity_enabled' AND value = '{"enabled":false}';

-- F2 and F4 emergency stops: both must be exact expected-state CAS operations.
UPDATE public.syncview_runtime_flags
SET value = '{"mode":"off"}', updated_by = 'f27-test-stop'
WHERE key = 'linear_outbound_enabled' AND value = '{"mode":"live"}';
UPDATE public.syncview_runtime_flags
SET value = '{"enabled":false}', updated_by = 'f27-test-stop'
WHERE key = 'linear_legacy_parity_enabled' AND value = '{"enabled":true}';

-- Exact P1 interleaving, phase 1: the native writer is authorized while this
-- team is still SyncView-authoritative and captures generation zero. It does
-- not insert until after the rollback finalizer commits below.
SELECT
  auth_result::text AS write_authorization,
  (auth_result->>'generation')::bigint AS authorized_generation
FROM (
  SELECT public.track_b_f27_write_authorization('graphics') AS auth_result
) q \gset
SELECT set_config('f27.write_authorization', :'write_authorization', false);
SELECT set_config('f27.authorized_generation', :'authorized_generation', false);
DO $$
DECLARE
  v_authorization jsonb := current_setting('f27.write_authorization')::jsonb;
BEGIN
  IF v_authorization->>'ok' <> 'true'
     OR v_authorization->>'type' <> 'f27_write_authorization'
     OR v_authorization->>'team' <> 'graphics'
     OR v_authorization->>'authority' <> 'syncview'
     OR (v_authorization->>'generation')::bigint <> 0 THEN
    RAISE EXCEPTION 'f27_pre_finalize_authorization_not_exact';
  END IF;
END $$;

-- A worker that claimed before the stops must finish/release before capture.
UPDATE public.mirror_outbox
SET lock_token = gen_random_uuid(), locked_at = now()
WHERE id = 1;
DO $$
BEGIN
  BEGIN
    PERFORM public.track_b_f27_begin(
      'graphics',
      '{"video":"linear","graphics":"syncview"}',
      'f27-test-owner'
    );
    RAISE EXCEPTION 'in-flight begin unexpectedly succeeded';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE 'f27_inflight_rows:%' THEN RAISE; END IF;
  END;
END $$;
UPDATE public.mirror_outbox
SET lock_token = null, locked_at = null
WHERE id = 1;

SELECT (public.track_b_f27_begin(
  'graphics',
  '{"video":"linear","graphics":"syncview"}',
  'f27-test-owner'
)->>'rollback_id')::uuid AS rollback_id \gset
SELECT set_config('f27.rollback_id', :'rollback_id', false);

DO $$
BEGIN
  BEGIN
    PERFORM public.track_b_f27_finalize(
      current_setting('f27.rollback_id')::uuid,
      '{"video":"linear","graphics":"syncview"}',
      'f27-test-owner'
    );
    RAISE EXCEPTION 'premature finalize unexpectedly succeeded';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE 'f27_team_not_zero:%' THEN RAISE; END IF;
  END;
END $$;
-- ROLLBACK TO SAVEPOINT blocked_before_classification

DO $$
BEGIN
  BEGIN
    INSERT INTO public.mirror_outbox(
      payload, entity, entity_id, operation, client_slug, team, dedup_key,
      source_edited_at, status, test_only
    ) VALUES (
      '{"value":"must-not-cross"}', 'deliverable', 'g-race', 'status',
      'test-client', 'graphics', 'f27:g:race', now(), 'pending', true
    );
    RAISE EXCEPTION 'held enqueue unexpectedly succeeded';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE 'team_rollback_hold:graphics%' THEN RAISE; END IF;
  END;
END $$;

SELECT public.track_b_f27_classify(:'rollback_id', 1, 'replay', 'owner approved exact retry', 'f27-test-owner');
SELECT public.track_b_f27_classify(:'rollback_id', 2, 'quarantine', 'preserve for investigation', 'f27-test-owner');
SELECT public.track_b_f27_classify(:'rollback_id', 3, 'discard', 'owner verified invalid intent', 'f27-test-owner');
SELECT correlation_id::text AS reflected_correlation
FROM public.track_b_team_rollbacks WHERE id = :'rollback_id' \gset
SELECT row_sha256 AS reflected_snapshot_sha
FROM public.track_b_team_rollback_intents WHERE rollback_id = :'rollback_id' AND outbox_id = 4 \gset
SELECT encode(
  extensions.digest(
    convert_to(jsonb_build_object('issue_id', 'TEST-REFLECTED-4', 'value', 'g-reflected')::text, 'UTF8'),
    'sha256'
  ),
  'hex'
) AS reflected_result_sha \gset
SELECT public.track_b_f27_classify(
  :'rollback_id',
  4,
  'already_reflected',
  'exact Linear value independently observed',
  'f27-test-owner',
  jsonb_build_object(
    'ok', true,
    'type', 'f27_already_reflected_terminal',
    'rollback_id', :'rollback_id',
    'outbox_id', '4',
    'correlation_id', :'reflected_correlation',
    'intent_snapshot_sha256', :'reflected_snapshot_sha',
    'dedup_key', 'f27:g:4',
    'operation', 'due',
    'issue_id', 'TEST-REFLECTED-4',
    'observed_result', '{"issue_id":"TEST-REFLECTED-4","value":"g-reflected"}'::jsonb,
    'observed_result_sha256', :'reflected_result_sha'
  )
);

-- Simulated audited writer completion for the one approved TEST replay.
SELECT gen_random_uuid()::text AS replay_correlation \gset
UPDATE public.mirror_outbox
SET status = 'written',
    linear_result = jsonb_build_object(
      'ok', true,
      'linear_id', 'TEST-only',
      'correlation_id', :'replay_correlation'
    ),
    processed_at = now(), updated_at = now()
WHERE id = 1 AND status = 'skipped' AND test_only = true AND client_slug = 'test-client';

DO $$
BEGIN
  BEGIN
    PERFORM public.track_b_f27_record_terminal(
      current_setting('f27.rollback_id')::uuid,
      1,
      jsonb_build_object(
        'ok', true,
        'type', 'linear_write_terminal',
        'rollback_id', current_setting('f27.rollback_id'),
        'outbox_id', '1',
        'dedup_key', 'f27:g:1',
        'operation', 'status',
        'correlation_id', gen_random_uuid(),
        'linear_result_sha256', 'copied-or-synthetic',
        'intent_snapshot_sha256', 'copied-or-synthetic'
      )
    );
    RAISE EXCEPTION 'unbound replay receipt unexpectedly succeeded';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'f27_terminal_receipt_refused' THEN RAISE; END IF;
  END;
END $$;

SELECT public.track_b_f27_record_terminal(
  :'rollback_id', 1,
  jsonb_build_object(
    'ok', true,
    'type', 'linear_write_terminal',
    'rollback_id', :'rollback_id',
    'outbox_id', '1',
    'dedup_key', 'f27:g:1',
    'operation', 'status',
    'correlation_id', :'replay_correlation',
    'linear_result_sha256', (
      select encode(extensions.digest(convert_to(linear_result::text, 'UTF8'), 'sha256'), 'hex')
      from public.mirror_outbox where id = 1
    ),
    'intent_snapshot_sha256', (
      select row_sha256 from public.track_b_team_rollback_intents
      where rollback_id = :'rollback_id' and outbox_id = 1
    ),
    'observer', 'github-actions-postgres'
  )
);

SELECT public.track_b_f27_finalize(
  :'rollback_id',
  '{"video":"linear","graphics":"syncview"}',
  'f27-test-owner'
) AS terminal_receipt \gset
SELECT set_config('f27.terminal_receipt', :'terminal_receipt', false);

-- Exact P1 interleaving, phase 2: finalize has committed authority=Linear and
-- advanced only the graphics fence. The already-authorized late native insert
-- carries its old generation and must now fail at the server trigger.
DO $$
BEGIN
  BEGIN
    PERFORM public.mirror_outbox_enqueue(
      'deliverable',
      'g-late-native',
      'status',
      jsonb_build_object(
        'value', 'must-fail-closed',
        '_f27_authority_generation', current_setting('f27.authorized_generation')::bigint,
        '_f27_legacy_parity', false
      ),
      'f27:g:late-native',
      now(),
      'test-client',
      'graphics',
      'f27-test-writer',
      'system',
      null,
      null,
      null,
      null,
      false
    );
    RAISE EXCEPTION 'late pre-authorized insert unexpectedly succeeded';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'f27_authority_generation_stale:graphics' THEN RAISE; END IF;
  END;
END $$;

DO $$
DECLARE
  v_graphics_generation bigint;
  v_video_generation bigint;
BEGIN
  SELECT generation INTO v_graphics_generation
  FROM public.track_b_f27_team_fences WHERE team = 'graphics';
  SELECT generation INTO v_video_generation
  FROM public.track_b_f27_team_fences WHERE team = 'video';
  IF v_graphics_generation <> current_setting('f27.authorized_generation')::bigint + 1
     OR v_video_generation <> 0 THEN
    RAISE EXCEPTION 'f27_generation_cas_not_exact';
  END IF;
END $$;

-- A historical comment intent keeps its old generation. The pre-F27 requeue
-- RPC must fail stale after handoff, while the fenced requeue atomically
-- applies a freshly authorized generation. The successful probe is rolled back.
DO $$
BEGIN
  BEGIN
    PERFORM public.mirror_outbox_requeue(2);
    RAISE EXCEPTION 'unfenced post-CAS requeue unexpectedly succeeded';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'f27_authority_generation_stale:graphics' THEN RAISE; END IF;
  END;
END $$;
BEGIN;
DO $$
DECLARE
  v_generation bigint;
  v_ok boolean;
BEGIN
  SELECT generation INTO v_generation
  FROM public.track_b_f27_team_fences WHERE team = 'graphics';
  v_ok := public.track_b_f27_requeue(2, v_generation);
  IF v_ok IS DISTINCT FROM true OR NOT EXISTS (
    SELECT 1 FROM public.mirror_outbox
    WHERE id = 2
      AND status = 'pending'
      AND authority_generation = v_generation
      AND legacy_parity = false
  ) THEN
    RAISE EXCEPTION 'f27_fenced_post_cas_requeue_failed';
  END IF;
END $$;
ROLLBACK;

-- A fresh TEST enqueue remains available outside a real rollback. It uses the
-- exact current generation and is transactionally discarded.
BEGIN;
SELECT public.mirror_outbox_enqueue(
  'deliverable',
  'f27-post-finalize-test',
  'status',
  jsonb_build_object(
    'value', 'accepted-then-rolled-back',
    '_f27_authority_generation', (
      select generation from public.track_b_f27_team_fences where team = 'graphics'
    ),
    '_f27_legacy_parity', false
  ),
  'f27:g:post-finalize-test',
  now(),
  'test-client',
  'graphics',
  'f27-test-writer',
  'system',
  null,
  null,
  null,
  null,
  true
);
ROLLBACK;

-- Full safe-drill contract. Baselines cover every real outbox row, both real
-- fences, all three runtime flags, and the flag audit count. The drill keeps
-- its own synthetic row and audit records permanently.
CREATE TEMP TABLE f27_pre_drill_real_rows AS
SELECT id,
  encode(extensions.digest(convert_to(to_jsonb(o)::text, 'UTF8'), 'sha256'), 'hex') AS row_hash
FROM public.mirror_outbox o
WHERE team IN ('video', 'graphics')
ORDER BY id;
CREATE TEMP TABLE f27_pre_drill_fences AS
SELECT team, generation, updated_at, updated_by
FROM public.track_b_f27_team_fences
ORDER BY team;
CREATE TEMP TABLE f27_pre_drill_flags AS
SELECT key, value, updated_at, updated_by
FROM public.syncview_runtime_flags
WHERE key IN ('prod_authority', 'linear_outbound_enabled', 'linear_legacy_parity_enabled')
ORDER BY key;
SELECT count(*)::text AS pre_drill_flag_flips FROM public.flag_flips \gset
SELECT set_config('f27.pre_drill_flag_flips', :'pre_drill_flag_flips', false);

SELECT
  drill->>'rollback_id' AS drill_rollback_id,
  drill->>'outbox_id' AS drill_outbox_id,
  drill->>'correlation_id' AS drill_correlation_id,
  drill->>'row_sha256' AS drill_row_sha256,
  drill->>'snapshot_sha256' AS drill_snapshot_sha256
FROM (
  SELECT public.track_b_f27_begin_drill(
    '{"video":"linear","graphics":"linear"}',
    'f27-test-owner'
  ) AS drill
) q \gset
SELECT set_config('f27.drill_rollback_id', :'drill_rollback_id', false);
SELECT set_config('f27.drill_outbox_id', :'drill_outbox_id', false);
SELECT set_config('f27.drill_row_sha256', :'drill_row_sha256', false);

DO $$
DECLARE
  v_ok boolean;
BEGIN
  SELECT
    r.is_drill = true
    AND r.team = '__f27_drill__'
    AND r.state = 'open'
    AND r.snapshot_count = 1
    AND i.row_sha256 = current_setting('f27.drill_row_sha256')
    AND i.row_sha256 = encode(
      extensions.digest(convert_to(i.row_snapshot::text, 'UTF8'), 'sha256'), 'hex'
    )
    AND r.snapshot_sha256 = encode(
      extensions.digest(convert_to(i.row_sha256, 'UTF8'), 'sha256'), 'hex'
    )
    AND r.snapshot_sha256 <> i.row_sha256
    AND o.team = '__f27_drill__'
    AND o.client_slug = '__f27_drill__'
    AND o.test_only = true
    AND o.f27_drill_rollback_id = r.id
  INTO v_ok
  FROM public.track_b_team_rollbacks r
  JOIN public.track_b_team_rollback_intents i ON i.rollback_id = r.id
  JOIN public.mirror_outbox o ON o.id = i.outbox_id
  WHERE r.id = current_setting('f27.drill_rollback_id')::uuid
    AND o.id = current_setting('f27.drill_outbox_id')::bigint;
  IF v_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'f27_drill_snapshot_not_exact'; END IF;
END $$;

-- An open drill never holds a real team. This TEST enqueue takes the current
-- video generation, succeeds, and is discarded with the transaction.
BEGIN;
SELECT public.mirror_outbox_enqueue(
  'deliverable',
  'f27-open-drill-real-team-test',
  'status',
  jsonb_build_object(
    'value', 'accepted-then-rolled-back',
    '_f27_authority_generation', (
      select generation from public.track_b_f27_team_fences where team = 'video'
    ),
    '_f27_legacy_parity', false
  ),
  'f27:v:open-drill-test',
  now(),
  'test-client',
  'video',
  'f27-test-writer',
  'system',
  null,
  null,
  null,
  null,
  true
);
ROLLBACK;

DO $$
DECLARE
  v_kind text;
BEGIN
  FOREACH v_kind IN ARRAY ARRAY['quarantine', 'discard', 'already_reflected'] LOOP
    BEGIN
      PERFORM public.track_b_f27_classify(
        current_setting('f27.drill_rollback_id')::uuid,
        current_setting('f27.drill_outbox_id')::bigint,
        v_kind,
        'negative drill classification proof',
        'f27-test-owner'
      );
      RAISE EXCEPTION 'non-replay drill classification unexpectedly succeeded';
    EXCEPTION WHEN others THEN
      IF SQLERRM <> 'f27_drill_replay_classification_required' THEN RAISE; END IF;
    END;
  END LOOP;
END $$;

SELECT public.track_b_f27_classify(
  :'drill_rollback_id',
  :'drill_outbox_id',
  'replay',
  'exercise the no-external-call drill replay',
  'f27-test-owner'
);
SELECT gen_random_uuid()::text AS drill_lock_token \gset
UPDATE public.mirror_outbox
SET lock_token = :'drill_lock_token'::uuid,
    locked_at = now(),
    updated_at = now()
WHERE id = :'drill_outbox_id'::bigint
  AND f27_drill_rollback_id = :'drill_rollback_id'::uuid
  AND status = 'skipped';

DO $$
BEGIN
  BEGIN
    PERFORM public.track_b_f27_execute_drill_replay(
      current_setting('f27.drill_rollback_id')::uuid,
      current_setting('f27.drill_outbox_id')::bigint,
      gen_random_uuid()
    );
    RAISE EXCEPTION 'unbound drill replay unexpectedly succeeded';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'f27_drill_replay_refused' THEN RAISE; END IF;
  END;
END $$;

SELECT public.track_b_f27_execute_drill_replay(
  :'drill_rollback_id',
  :'drill_outbox_id',
  :'drill_lock_token'
) AS drill_replay_result \gset
SELECT set_config('f27.drill_replay_result', :'drill_replay_result', false);

DO $$
DECLARE
  v_ok boolean;
BEGIN
  SELECT
    i.terminal_receipt = current_setting('f27.drill_replay_result')::jsonb
    AND i.terminal_receipt->>'linear_result_sha256' = encode(
      extensions.digest(convert_to(o.linear_result::text, 'UTF8'), 'sha256'), 'hex'
    )
  INTO v_ok
  FROM public.track_b_team_rollback_intents i
  JOIN public.mirror_outbox o ON o.id = i.outbox_id
  WHERE i.rollback_id = current_setting('f27.drill_rollback_id')::uuid
    AND i.outbox_id = current_setting('f27.drill_outbox_id')::bigint;
  IF v_ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'f27_drill_atomic_receipt_not_exact';
  END IF;
END $$;

DO $$
BEGIN
  BEGIN
    PERFORM public.track_b_f27_record_terminal(
      current_setting('f27.drill_rollback_id')::uuid,
      current_setting('f27.drill_outbox_id')::bigint,
      jsonb_build_object(
        'ok', true,
        'type', 'f27_drill_replay_terminal',
        'rollback_id', current_setting('f27.drill_rollback_id'),
        'outbox_id', current_setting('f27.drill_outbox_id'),
        'dedup_key', 'wrong-binding',
        'operation', 'status',
        'correlation_id', gen_random_uuid(),
        'linear_result_sha256', 'wrong-binding',
        'intent_snapshot_sha256', 'wrong-binding'
      )
    );
    RAISE EXCEPTION 'unbound drill receipt unexpectedly succeeded';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'f27_terminal_receipt_refused' THEN RAISE; END IF;
  END;
END $$;

SELECT public.track_b_f27_record_terminal(
  :'drill_rollback_id',
  :'drill_outbox_id',
  current_setting('f27.drill_replay_result')::jsonb
);

-- The ordinary authority finalizer is the exercised CAS-refusal lane. It
-- refuses the drill before taking any real-team table/flag/fence lock.
DO $$
BEGIN
  BEGIN
    PERFORM public.track_b_f27_finalize(
      current_setting('f27.drill_rollback_id')::uuid,
      '{"video":"linear","graphics":"linear"}',
      'f27-test-owner'
    );
    RAISE EXCEPTION 'drill authority CAS unexpectedly succeeded';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'f27_drill_authority_cas_refused' THEN RAISE; END IF;
  END;
END $$;

SELECT public.track_b_f27_finalize_drill(
  :'drill_rollback_id',
  '{"video":"linear","graphics":"linear"}',
  'f27-test-owner'
) AS drill_terminal_receipt \gset
SELECT set_config('f27.drill_terminal_receipt', :'drill_terminal_receipt', false);

-- Even a perfectly shaped reserved row cannot enter through generic DML; only
-- track_b_f27_begin_drill can create one, and its audit row is retained.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.mirror_outbox(
      payload, entity, entity_id, operation, client_slug, team, dedup_key,
      source_edited_at, status, test_only, legacy_parity,
      authority_generation, f27_drill_rollback_id
    ) VALUES (
      '{"f27_drill":true,"value":"forbidden"}',
      'deliverable', 'f27-generic-drill', 'status',
      '__f27_drill__', '__f27_drill__', 'f27:generic-drill',
      now(), 'pending', true, false, 0,
      current_setting('f27.drill_rollback_id')::uuid
    );
    RAISE EXCEPTION 'generic drill insert unexpectedly succeeded';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'f27_drill_insert_forbidden' THEN RAISE; END IF;
  END;
END $$;

DO $$
DECLARE
  v_ok boolean;
BEGIN
  SELECT bool_and(f.value = p.value) INTO v_ok
  FROM public.syncview_runtime_flags f
  JOIN f27_prior_flags p USING (key);
  IF v_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'exact_prior_flags_restored'; END IF;

  SELECT encode(extensions.digest(convert_to(to_jsonb(o)::text, 'UTF8'), 'sha256'), 'hex') = t.row_hash
  INTO v_ok
  FROM public.mirror_outbox o CROSS JOIN f27_other_team t
  WHERE o.team = 'video';
  IF v_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'other_team_unchanged'; END IF;

  SELECT bool_and(
    encode(extensions.digest(convert_to(o.payload::text, 'UTF8'), 'sha256'), 'hex') = p.payload_hash
  ) INTO v_ok
  FROM public.mirror_outbox o JOIN f27_prior_payloads p USING (id);
  IF v_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'zero_payload_loss'; END IF;

  SELECT
    r.state = 'complete'
    AND r.terminal_receipt->>'correlation_id' = r.correlation_id::text
    AND (r.terminal_receipt->>'active_team_rows')::integer = 0
    AND bool_and(
      CASE WHEN i.classification = 'replay'
        THEN i.terminal_receipt->>'correlation_id' IS NOT NULL
        ELSE true
      END
    )
  INTO v_ok
  FROM public.track_b_team_rollbacks r
  JOIN public.track_b_team_rollback_intents i ON i.rollback_id = r.id
  WHERE r.id = current_setting('f27.rollback_id')::uuid
  GROUP BY r.id;
  IF v_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'terminal_receipts_correlated'; END IF;

  SELECT
    (SELECT count(*) FROM public.mirror_outbox WHERE team IN ('video', 'graphics'))
      = (SELECT count(*) FROM f27_pre_drill_real_rows)
    AND coalesce(bool_and(
      encode(extensions.digest(convert_to(to_jsonb(o)::text, 'UTF8'), 'sha256'), 'hex')
        = b.row_hash
    ), true)
  INTO v_ok
  FROM f27_pre_drill_real_rows b
  JOIN public.mirror_outbox o USING (id);
  IF v_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'drill_real_rows_untouched'; END IF;

  SELECT count(*) = 2 AND bool_and(
    (f.generation, f.updated_at, f.updated_by)
      IS NOT DISTINCT FROM (p.generation, p.updated_at, p.updated_by)
  )
  INTO v_ok
  FROM f27_pre_drill_fences p
  JOIN public.track_b_f27_team_fences f USING (team);
  IF v_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'drill_real_fences_untouched'; END IF;

  SELECT count(*) = 3 AND bool_and(
    (f.value, f.updated_at, f.updated_by)
      IS NOT DISTINCT FROM (p.value, p.updated_at, p.updated_by)
  )
  INTO v_ok
  FROM f27_pre_drill_flags p
  JOIN public.syncview_runtime_flags f USING (key);
  IF v_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'drill_runtime_flags_untouched'; END IF;

  SELECT count(*) = current_setting('f27.pre_drill_flag_flips')::bigint
  INTO v_ok FROM public.flag_flips;
  IF v_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'drill_no_flag_flip_audit'; END IF;

  SELECT
    r.state = 'complete'
    AND r.is_drill = true
    AND r.team = '__f27_drill__'
    AND r.snapshot_count = 1
    AND i.row_sha256 = current_setting('f27.drill_row_sha256')
    AND r.snapshot_sha256 = encode(
      extensions.digest(convert_to(i.row_sha256, 'UTF8'), 'sha256'), 'hex'
    )
    AND r.terminal_receipt->>'type' = 'f27_drill_terminal'
    AND r.terminal_receipt->>'authority_cas' = 'refused'
    AND r.terminal_receipt->>'authority_cas_reason' = 'f27_drill_authority_cas_refused'
    AND r.terminal_receipt->>'audit_history_retained' = 'true'
    AND i.classification = 'replay'
    AND jsonb_array_length(i.classification_history) = 1
    AND i.terminal_receipt->>'type' = 'f27_drill_replay_terminal'
    AND o.status = 'written'
    AND o.f27_drill_rollback_id = r.id
    AND o.linear_result->>'type' = 'f27_drill_replay_terminal'
    AND o.linear_result->>'no_external_call' = 'true'
    AND o.linear_result->>'intent_snapshot_sha256' = i.row_sha256
  INTO v_ok
  FROM public.track_b_team_rollbacks r
  JOIN public.track_b_team_rollback_intents i ON i.rollback_id = r.id
  JOIN public.mirror_outbox o ON o.id = i.outbox_id
  WHERE r.id = current_setting('f27.drill_rollback_id')::uuid;
  IF v_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'drill_audit_history_not_terminal'; END IF;

  SELECT count(*) = 0 INTO v_ok
  FROM public.track_b_team_rollbacks WHERE state = 'open';
  IF v_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'f27_lane_not_dormant'; END IF;
END $$;

SELECT jsonb_build_object(
  'terminal', 'F27_PROOF_OK',
  'observer', 'github-actions-postgres',
  'rollback_id', :'rollback_id',
  'receipt', current_setting('f27.terminal_receipt')::jsonb,
  'drill_rollback_id', :'drill_rollback_id',
  'drill_receipt', current_setting('f27.drill_terminal_receipt')::jsonb,
  'assertions', jsonb_build_array(
    'f201_operation_superset_exact',
    'f201_existing_rows_preserved',
    'f201_f27_labels_enqueue_exact',
    'f202_operation_superset_exact',
    'f202_existing_rows_preserved',
    'f202_f27_description_enqueue_exact',
    'exact_prior_flags_restored',
    'other_team_unchanged',
    'zero_payload_loss',
    'terminal_receipts_correlated',
    'late_pre_authorized_insert_rejected',
    'generation_cas_advanced_once',
    'drill_snapshot_hash_exact',
    'drill_classification_and_receipt_bound',
    'drill_replay_no_external_call',
    'drill_authority_cas_refused',
    'drill_real_rows_untouched',
    'drill_real_fences_untouched',
    'drill_runtime_flags_untouched',
    'drill_audit_history_retained',
    'f27_lane_dormant',
    'unbound_receipt_refused',
    'inflight_lease_refused',
    'f2_off',
    'f4_false'
  )
) AS F27_PROOF_OK;
