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

CREATE TABLE public.syncview_runtime_flags (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

CREATE TABLE public.deliverable_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  deliverable_id text,
  client_slug text NOT NULL,
  ts timestamptz NOT NULL DEFAULT now(),
  actor text,
  role text,
  action text NOT NULL,
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
