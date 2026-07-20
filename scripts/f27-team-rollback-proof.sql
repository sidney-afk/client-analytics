\set ON_ERROR_STOP on

-- The GitHub job supplies a throwaway PostgreSQL 16 server. This marker schema
-- makes the isolation explicit; production objects below exist only inside
-- that disposable TEST database.
CREATE SCHEMA f27_test;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;

CREATE TABLE public.syncview_runtime_flags (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

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
  CONSTRAINT mirror_outbox_status_b4_check CHECK (
    status IN ('pending', 'shadow_ok', 'written', 'failed', 'skipped', 'stale')
  )
);

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
SELECT id, encode(digest(convert_to(payload::text, 'UTF8'), 'sha256'), 'hex') AS payload_hash
FROM public.mirror_outbox ORDER BY id;
CREATE TEMP TABLE f27_other_team AS
SELECT encode(digest(convert_to(to_jsonb(o)::text, 'UTF8'), 'sha256'), 'hex') AS row_hash
FROM public.mirror_outbox o WHERE team = 'video';

\ir ../migrations/2026-07-20-f27-team-rollback.sql

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
    'issue_id', 'TEST-REFLECTED-4'
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
      select encode(digest(convert_to(linear_result::text, 'UTF8'), 'sha256'), 'hex')
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

DO $$
DECLARE
  v_ok boolean;
BEGIN
  SELECT bool_and(f.value = p.value) INTO v_ok
  FROM public.syncview_runtime_flags f
  JOIN f27_prior_flags p USING (key);
  IF v_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'exact_prior_flags_restored'; END IF;

  SELECT encode(digest(convert_to(to_jsonb(o)::text, 'UTF8'), 'sha256'), 'hex') = t.row_hash
  INTO v_ok
  FROM public.mirror_outbox o CROSS JOIN f27_other_team t
  WHERE o.team = 'video';
  IF v_ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'other_team_unchanged'; END IF;

  SELECT bool_and(
    encode(digest(convert_to(o.payload::text, 'UTF8'), 'sha256'), 'hex') = p.payload_hash
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
END $$;

SELECT jsonb_build_object(
  'terminal', 'F27_PROOF_OK',
  'observer', 'github-actions-postgres',
  'rollback_id', :'rollback_id',
  'receipt', current_setting('f27.terminal_receipt')::jsonb,
  'assertions', jsonb_build_array(
    'exact_prior_flags_restored',
    'other_team_unchanged',
    'zero_payload_loss',
    'terminal_receipts_correlated',
    'unbound_receipt_refused',
    'inflight_lease_refused',
    'f2_off',
    'f4_false'
  )
) AS F27_PROOF_OK;
