-- 2026-09-05 — Calendar feedback recovery: atomic owned-attempt materialization
--
-- WHY THIS EXISTS
--   A client's Calendar tweak/note is written twice: the native canonical
--   comment through production-write (accepted, receipted) and the source
--   card cell through the frozen calendar-upsert writer. When the second write
--   is refused or loses its response, the browser holds an OWNED attempt and
--   could only confirm a copy that was already present. It could not safely
--   insert the missing copy: the frozen calendar_merge_comments merges cells
--   by id/stamp and never checks production_comments, so a native edit,
--   delete or resolve between a browser readback and the source insert could
--   resurrect stale feedback (docs/ops/CALENDAR_FEEDBACK_RECONCILIATION.md).
--
-- WHAT IT DOES
--   One SECURITY DEFINER function, service role only, called by production-write
--   behind its existing client-token authorization. In ONE transaction it locks
--   the canonical comment (serializing with production_comment_lifecycle_write),
--   proves the accepted add by its mutation receipt (no outbox required),
--   proves the reserved companion status by its outbox receipt, locks the
--   source row, checks the reciprocal client/card/deliverable binding, applies
--   an original-source-row CAS, appends the entry built from the VERIFIED
--   canonical comment, applies only the owned scalar fields the failed source
--   POST carried, ledgers calendar_post_events, and records idempotent
--   materialization evidence. Every hold returns without writing.
--
-- WHAT IT DOES NOT DO
--   It never replays a whole old row, never sends or replays a native comment
--   or status, never touches mirror_outbox or production_comments, never
--   reconciles a divergent legacy `tweaks` alias, and never changes
--   calendar-upsert, sample-review-upsert, calendar_merge_comments, RLS,
--   grants on existing objects, runtime flags or authority.
--
-- SAFETY
--   * Advisory xact lock per attempt key: two concurrent retries of the same
--     attempt serialize; the second returns already_materialized.
--   * Canonical row FOR UPDATE: a lifecycle write in flight waits, and a
--     lifecycle change that already landed (version, edited/deleted/resolved)
--     holds recovery instead of inserting stale feedback.
--   * Source row FOR UPDATE + updated_at CAS: an unrelated source change since
--     capture holds recovery visibly rather than guessing.
--   * Existing entries and tombstones are preserved byte-for-byte; a tombstone
--     for the same id is a hold, never a resurrection.
--
-- Compiled and exercised against a disposable PostgreSQL 16 over the baseline
-- plus the production-comment deltas (qa/calendar-feedback-recovery/). It is
-- SOURCE-ONLY until EXECUTION_LOG.md records its application.
--
-- Apply order for release: this migration FIRST, then production-write, then
-- the browser half. The browser half without the function gets an explicit
-- gateway refusal and keeps holding; the function without callers is inert.

begin;

create table if not exists public.calendar_feedback_materializations (
  attempt_key text primary key,
  client text not null,
  card_id text not null,
  component text not null check (component in ('video', 'graphic')),
  native_comment_id text not null,
  canonical_comment_id text not null,
  comment_dedup_key text not null,
  request_fingerprint text not null,
  outcome text not null check (outcome in ('materialized', 'already_present')),
  applied jsonb not null default '{}'::jsonb check (jsonb_typeof(applied) = 'object'),
  source_updated_at_before text,
  source_updated_at_after text,
  created_at timestamptz not null default now()
);

create index if not exists calendar_feedback_materializations_card_idx
  on public.calendar_feedback_materializations (client, card_id, created_at desc);

alter table public.calendar_feedback_materializations enable row level security;
revoke all on table public.calendar_feedback_materializations from public, anon, authenticated;
grant select, insert on table public.calendar_feedback_materializations to service_role;

comment on table public.calendar_feedback_materializations is
  'Idempotent evidence that an owned client Calendar feedback attempt was materialized into its source card by calendar_feedback_recovery_apply_v1. Insert-only; service role only.';

-- ISO-8601 text with milliseconds, the exact shape calendar-upsert and the
-- browser write into calendar_posts.updated_at and comment stamps.
create or replace function public._calendar_feedback_recovery_iso(p_ts timestamptz)
returns text
language sql
immutable
as $fn$
  select case when p_ts is null then null
    else to_char(p_ts at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end
$fn$;

revoke all on function public._calendar_feedback_recovery_iso(timestamptz) from public, anon, authenticated;

create or replace function public.calendar_feedback_recovery_apply_v1(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_req jsonb := coalesce(p_request, '{}'::jsonb);
  v_client text := nullif(btrim(v_req->>'client'), '');
  v_card_id text := nullif(btrim(v_req->>'card_id'), '');
  v_component text := lower(nullif(btrim(v_req->>'component'), ''));
  v_deliverable_id text := nullif(btrim(v_req->>'deliverable_id'), '');
  v_actor jsonb := coalesce(v_req->'actor', '{}'::jsonb);
  v_comment jsonb := coalesce(v_req->'comment', '{}'::jsonb);
  v_status jsonb := case when jsonb_typeof(v_req->'status') = 'object' then v_req->'status' else null end;
  v_source jsonb := coalesce(v_req->'source', '{}'::jsonb);
  v_fields jsonb := coalesce(v_source->'fields', '{}'::jsonb);
  v_previous jsonb := coalesce(v_source->'previous', '{}'::jsonb);
  v_expected_updated_at text := nullif(v_source->>'expected_updated_at', '');
  v_native_id text := nullif(btrim(v_comment->>'native_comment_id'), '');
  v_canonical_id text := nullif(btrim(v_comment->>'canonical_id'), '');
  v_dedup text := nullif(btrim(v_comment->>'dedup_key'), '');
  v_fingerprint text := nullif(btrim(v_comment->>'intent_fingerprint'), '');
  v_body text := v_comment->>'body';
  v_is_tweak boolean := (v_comment->>'is_tweak')::boolean;
  v_round integer;
  v_entry_created_at timestamptz;
  v_team text;
  v_cell_col text;
  v_link_col text;
  v_status_col text;
  v_attempt_key text;
  v_request_fingerprint text;
  v_allowed text[] := array['video_status','graphic_status','status','client_video_approved_at',
    'client_graphic_approved_at','client_caption_approved_at','client_title_approved_at','kasper_approved_at'];
  v_key text;
  v_approval_component text;
  v_existing public.calendar_feedback_materializations%rowtype;
  v_deliverable public.deliverables%rowtype;
  v_canonical public.production_comments%rowtype;
  v_receipt public.production_comment_mutation_receipts%rowtype;
  v_outbox public.mirror_outbox%rowtype;
  v_status_dedup text;
  v_status_fingerprint text;
  v_status_native text;
  v_row public.calendar_posts%rowtype;
  v_row_json jsonb;
  v_cell_text text;
  v_cell jsonb;
  v_alias_text text;
  v_alias jsonb;
  v_elem jsonb;
  v_found jsonb;
  v_entry jsonb;
  v_next_cell jsonb;
  v_next_cell_text text;
  v_now_iso text := public._calendar_feedback_recovery_iso(now());
  v_applied jsonb := '{}'::jsonb;
  v_changed jsonb := '{}'::jsonb;
  v_all_equal boolean := true;
  v_result jsonb;
  v_hold text;
begin
  -- 1. Shape validation. Malformed or incomplete requests raise; the gateway
  --    maps them to 400 and nothing is written.
  if v_client is null or v_card_id is null or v_deliverable_id is null
     or v_component not in ('video', 'graphic') then
    raise exception 'calendar_feedback_recovery_invalid_scope';
  end if;
  if v_native_id is null or v_canonical_id is null or v_dedup is null or v_fingerprint is null
     or v_body is null or btrim(v_body) = '' or v_is_tweak is null
     or nullif(btrim(v_comment->>'entry_created_at'), '') is null then
    raise exception 'calendar_feedback_recovery_invalid_comment';
  end if;
  begin
    v_entry_created_at := (v_comment->>'entry_created_at')::timestamptz;
  exception when others then
    raise exception 'calendar_feedback_recovery_invalid_comment';
  end;
  if v_comment ? 'round' and jsonb_typeof(v_comment->'round') = 'number' then
    v_round := (v_comment->>'round')::integer;
  elsif v_comment ? 'round' and jsonb_typeof(v_comment->'round') <> 'null' then
    raise exception 'calendar_feedback_recovery_invalid_comment';
  end if;
  if v_is_tweak and v_round is null then
    raise exception 'calendar_feedback_recovery_invalid_comment';
  end if;
  if v_expected_updated_at is null or jsonb_typeof(v_fields) <> 'object'
     or jsonb_typeof(v_previous) <> 'object' then
    raise exception 'calendar_feedback_recovery_invalid_source';
  end if;
  for v_key in select jsonb_object_keys(v_fields) loop
    if not (v_key = any(v_allowed)) or jsonb_typeof(v_fields->v_key) <> 'string' then
      raise exception 'calendar_feedback_recovery_invalid_source';
    end if;
  end loop;
  for v_key in select jsonb_object_keys(v_previous) loop
    if not (v_key = any(v_allowed)) or jsonb_typeof(v_previous->v_key) <> 'string' then
      raise exception 'calendar_feedback_recovery_invalid_source';
    end if;
  end loop;
  if (select array_agg(k order by k) from jsonb_object_keys(v_fields) k)
     is distinct from (select array_agg(k order by k) from jsonb_object_keys(v_previous) k) then
    raise exception 'calendar_feedback_recovery_invalid_source';
  end if;
  v_team := case when v_component = 'graphic' then 'graphics' else 'video' end;
  v_cell_col := v_component || '_tweaks';
  v_link_col := v_component || '_deliverable_id';
  v_status_col := v_component || '_status';
  if v_is_tweak then
    -- A tweak's owned fields always include its component status. A note
    -- carries no owned scalar field at all.
    if v_fields->>v_status_col is distinct from 'Tweaks Needed' then
      raise exception 'calendar_feedback_recovery_invalid_source';
    end if;
    for v_key in select jsonb_object_keys(v_fields) loop
      if (case when v_key in (v_status_col, 'status') then v_fields->>v_key <> 'Tweaks Needed'
              when v_key like '%\_approved_at' then v_fields->>v_key <> ''
              else true end) then
        raise exception 'calendar_feedback_recovery_invalid_source';
      end if;
    end loop;
    if v_status is null then
      raise exception 'calendar_feedback_recovery_invalid_status';
    end if;
    v_status_dedup := nullif(btrim(v_status->>'dedup_key'), '');
    v_status_fingerprint := nullif(btrim(v_status->>'intent_fingerprint'), '');
    v_status_native := lower(nullif(btrim(v_status->>'native_status'), ''));
    if v_status_dedup is null or v_status_fingerprint is null or v_status_native <> 'tweak' then
      raise exception 'calendar_feedback_recovery_invalid_status';
    end if;
  else
    if v_fields <> '{}'::jsonb or v_status is not null then
      raise exception 'calendar_feedback_recovery_invalid_source';
    end if;
  end if;
  if nullif(btrim(v_actor->>'name'), '') is null then
    raise exception 'calendar_feedback_recovery_invalid_actor';
  end if;

  -- 2. Serialize on the attempt and answer replays from evidence.
  v_attempt_key := 'cfr-v1:' || v_client || ':' || v_card_id || ':' || v_component || ':' || v_native_id;
  v_request_fingerprint := encode(sha256(convert_to((v_req - 'actor')::text, 'utf8')), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(v_attempt_key, 0));
  select m.* into v_existing from public.calendar_feedback_materializations m
    where m.attempt_key = v_attempt_key;
  if found then
    if v_existing.request_fingerprint <> v_request_fingerprint
       or v_existing.comment_dedup_key <> v_dedup then
      return jsonb_build_object('outcome', 'held', 'reason', 'materialization_conflict');
    end if;
    select c.* into v_row from public.calendar_posts c where c.client = v_client and c.id = v_card_id;
    return jsonb_build_object('outcome', 'already_materialized',
      'materialization', to_jsonb(v_existing), 'row', to_jsonb(v_row));
  end if;

  -- 3. Deliverable binding: reciprocal client/card/deliverable.
  select d.* into v_deliverable from public.deliverables d where d.id = v_deliverable_id for share;
  if not found or v_deliverable.client_slug is distinct from v_client
     or lower(coalesce(v_deliverable.team, '')) <> v_team
     or lower(coalesce(v_deliverable.origin, '')) <> 'calendar'
     or coalesce(v_deliverable.card_id, '') <> v_card_id then
    raise exception 'calendar_feedback_recovery_forbidden';
  end if;

  -- 4. Canonical comment, locked against concurrent lifecycle writes.
  select c.* into v_canonical from public.production_comments c
    where c.native_comment_id = v_native_id for update;
  if not found then
    return jsonb_build_object('outcome', 'held', 'reason', 'native_comment_missing');
  end if;
  if v_canonical.id <> v_canonical_id
     or v_canonical.idempotency_key is distinct from v_dedup
     or v_canonical.deliverable_id is distinct from v_deliverable_id
     or v_canonical.client_slug is distinct from v_client
     or lower(coalesce(v_canonical.team, '')) <> v_team
     or lower(coalesce(v_canonical.audience, '')) <> 'client'
     or lower(coalesce(v_canonical.role, '')) <> 'client'
     or lower(coalesce(v_canonical.component, '')) <> v_component
     or coalesce(v_canonical.is_tweak, false) <> v_is_tweak
     or v_canonical.round is distinct from v_round
     or v_canonical.parent_id is not null
     or v_canonical.source_created_at is distinct from v_entry_created_at then
    return jsonb_build_object('outcome', 'held', 'reason', 'native_receipt_mismatch');
  end if;
  if v_canonical.edited_at is not null or v_canonical.deleted_at is not null
     or v_canonical.resolved_at is not null then
    return jsonb_build_object('outcome', 'held', 'reason', 'native_lifecycle_changed');
  end if;

  -- 5. The accepted add receipt. No outbox row is required or consulted.
  select r.* into v_receipt from public.production_comment_mutation_receipts r
    where r.dedup_key = v_dedup;
  if not found or v_receipt.action <> 'add' or v_receipt.comment_id <> v_canonical.id
     or v_receipt.intent_fingerprint <> v_fingerprint then
    return jsonb_build_object('outcome', 'held', 'reason', 'native_receipt_mismatch');
  end if;
  if v_canonical.version <> v_receipt.result_version then
    return jsonb_build_object('outcome', 'held', 'reason', 'native_lifecycle_changed');
  end if;
  if v_canonical.body <> btrim(v_body) then
    return jsonb_build_object('outcome', 'held', 'reason', 'native_receipt_mismatch');
  end if;

  -- 6. Companion status receipt (tweak only): the reserved identity, not text.
  if v_is_tweak then
    -- Derive from the locked, receipt-verified canonical identity; do not trust
    -- a caller-supplied association or another accepted same-card status.
    if v_status_dedup is distinct from 'write-ui:status:deliverable:' || v_deliverable_id ||
      ':calendar:feedback-status:' || encode(sha256(convert_to(
        'calendar-feedback-status-v1' || chr(10) || v_deliverable_id || chr(10) || v_canonical.native_comment_id,
        'utf8')), 'hex') then
      return jsonb_build_object('outcome', 'held', 'reason', 'companion_status_unbound');
    end if;
    select o.* into v_outbox from public.mirror_outbox o where o.dedup_key = v_status_dedup;
    if not found
       or v_outbox.entity is distinct from 'deliverable'
       or v_outbox.entity_id is distinct from v_deliverable_id
       or v_outbox.operation is distinct from 'status'
       or v_outbox.client_slug is distinct from v_client
       or lower(coalesce(v_outbox.team, '')) <> v_team
       or lower(coalesce(v_outbox.payload->>'status', '')) <> v_status_native
       or v_outbox.payload->>'_intent_fingerprint' is distinct from v_status_fingerprint
       or not exists (
         select 1 from public.deliverable_events e
         where e.deliverable_id = v_deliverable_id
           and e.payload->'outbound'->>'dedup_key' = v_status_dedup) then
      return jsonb_build_object('outcome', 'held', 'reason', 'companion_status_unproven');
    end if;
  end if;

  -- 7. Source row, locked; reciprocal link; cell and alias shape.
  select c.* into v_row from public.calendar_posts c
    where c.client = v_client and c.id = v_card_id for update;
  if not found then
    raise exception 'calendar_feedback_recovery_forbidden';
  end if;
  v_row_json := to_jsonb(v_row);
  if coalesce(v_row_json->>v_link_col, '') <> v_deliverable_id then
    raise exception 'calendar_feedback_recovery_forbidden';
  end if;
  -- Only clear stamps that the existing Calendar stale-approval rule would
  -- clear after this component enters Tweaks Needed. A client cannot clear
  -- another component's still-current approval by calling it an owned field.
  for v_key in select jsonb_object_keys(v_fields) loop
    if v_key like '%\_approved_at' and coalesce(v_row_json->>v_key, '') <> '' then
      if v_key = 'kasper_approved_at' then
        if exists (select 1 from unnest(array['video','graphic','caption']) c
          where c <> v_component and lower(btrim(coalesce(v_row_json->>(c || '_status'), '')))
            in ('client approval','approved','scheduled','posted')) then
          return jsonb_build_object('outcome', 'held', 'reason', 'approval_clear_unproven');
        end if;
      else
        v_approval_component := replace(replace(v_key, 'client_', ''), '_approved_at', '');
        if v_approval_component <> v_component and (
          lower(btrim(coalesce(v_row_json->>(v_approval_component || '_status'), '')))
            in ('client approval','approved','scheduled','posted')
          or (v_approval_component = 'title' and btrim(coalesce(v_row_json->>'title_status', '')) = '')) then
          return jsonb_build_object('outcome', 'held', 'reason', 'approval_clear_unproven');
        end if;
      end if;
    end if;
  end loop;
  v_cell_text := v_row_json->>v_cell_col;
  v_hold := null;
  if v_cell_text is null or btrim(v_cell_text) = '' then
    v_cell := '[]'::jsonb;
  else
    begin
      v_cell := v_cell_text::jsonb;
    exception when others then
      v_cell := null;
    end;
    if v_cell is null or jsonb_typeof(v_cell) <> 'array' then v_hold := 'source_cell_malformed'; end if;
  end if;
  if v_hold is null then
    for v_elem in select e from jsonb_array_elements(v_cell) e loop
      if jsonb_typeof(v_elem) is distinct from 'object' or jsonb_typeof(v_elem->'id') is distinct from 'string'
         or coalesce(v_elem->>'id', '') = '' or jsonb_typeof(v_elem->'body') is distinct from 'string' then
        v_hold := 'source_cell_malformed';
      end if;
    end loop;
  end if;
  if v_hold is null and (
    select count(*) <> count(distinct e->>'id') from jsonb_array_elements(v_cell) e) then
    v_hold := 'source_cell_malformed';
  end if;
  if v_hold is null and v_component = 'video' then
    v_alias_text := v_row.tweaks;
    if v_alias_text is not null and btrim(v_alias_text) <> '' then
      begin
        v_alias := v_alias_text::jsonb;
      exception when others then
        v_alias := null;
      end;
      if v_alias is null or jsonb_typeof(v_alias) <> 'array' then
        v_hold := 'source_alias_divergent';
      elsif exists (
        select 1 from jsonb_array_elements(v_alias) a
        where not exists (select 1 from jsonb_array_elements(v_cell) c where c = a)) then
        v_hold := 'source_alias_divergent';
      end if;
    end if;
  end if;
  if v_hold is not null then
    return jsonb_build_object('outcome', 'held', 'reason', v_hold);
  end if;

  -- 8. An entry with this id already in the cell.
  select e into v_found from jsonb_array_elements(v_cell) e where e->>'id' = v_native_id limit 1;
  if v_found is not null then
    if coalesce((v_found->>'deleted')::boolean, false) then
      return jsonb_build_object('outcome', 'held', 'reason', 'source_entry_tombstoned');
    end if;
    if btrim(v_found->>'body') is distinct from v_canonical.body
       or lower(coalesce(v_found->>'role', '')) <> 'client'
       or lower(coalesce(v_found->>'audience', '')) <> 'client'
       or coalesce((v_found->>'is_tweak')::boolean, false) <> v_is_tweak
       or (v_is_tweak and (v_found->>'round')::integer is distinct from v_round)
       or nullif(v_found->>'parent_id', '') is not null
       or coalesce((v_found->>'done')::boolean, false)
       or coalesce((v_found->>'edited')::boolean, false) then
      return jsonb_build_object('outcome', 'held', 'reason', 'source_entry_conflict');
    end if;
    for v_key in select jsonb_object_keys(v_fields) loop
      if coalesce(v_row_json->>v_key, '') <> (v_fields->>v_key) then v_all_equal := false; end if;
    end loop;
    if not v_all_equal then
      return jsonb_build_object('outcome', 'held', 'reason', 'source_fields_diverged');
    end if;
    insert into public.calendar_feedback_materializations (
      attempt_key, client, card_id, component, native_comment_id, canonical_comment_id,
      comment_dedup_key, request_fingerprint, outcome, applied,
      source_updated_at_before, source_updated_at_after)
    values (
      v_attempt_key, v_client, v_card_id, v_component, v_native_id, v_canonical.id,
      v_dedup, v_request_fingerprint, 'already_present',
      jsonb_build_object('comment', false, 'fields', '{}'::jsonb),
      v_row.updated_at, v_row.updated_at)
    returning * into v_existing;
    return jsonb_build_object('outcome', 'already_present',
      'materialization', to_jsonb(v_existing), 'row', v_row_json);
  end if;

  -- 9. Original-source-row CAS, then the single atomic materialization.
  if coalesce(v_row.updated_at, '') <> v_expected_updated_at then
    return jsonb_build_object('outcome', 'held', 'reason', 'source_row_changed');
  end if;
  v_entry := jsonb_build_object(
    'id', v_native_id,
    'parent_id', null,
    'author', coalesce(nullif(v_canonical.author_name, ''), v_actor->>'name'),
    'role', 'client',
    'is_tweak', v_is_tweak,
    'audience', 'client',
    'body', v_canonical.body,
    'created_at', public._calendar_feedback_recovery_iso(v_canonical.source_created_at),
    'updated_at', public._calendar_feedback_recovery_iso(v_canonical.source_created_at),
    'done', false, 'done_at', '', 'done_by', '');
  if v_is_tweak then v_entry := v_entry || jsonb_build_object('round', v_round); end if;
  v_next_cell := v_cell || jsonb_build_array(v_entry);
  v_next_cell_text := v_next_cell::text;
  for v_key in select jsonb_object_keys(v_fields) loop
    if coalesce(v_row_json->>v_key, '') <> (v_fields->>v_key) then
      v_changed := v_changed || jsonb_build_object(v_key,
        jsonb_build_object('from', v_row_json->>v_key, 'to', v_fields->>v_key));
    end if;
  end loop;
  -- Only allowlisted owned fields, the component cell and its alias move.
  update public.calendar_posts c set
    video_tweaks = case when v_component = 'video' then v_next_cell_text else c.video_tweaks end,
    tweaks = case when v_component = 'video' then v_next_cell_text else c.tweaks end,
    graphic_tweaks = case when v_component = 'graphic' then v_next_cell_text else c.graphic_tweaks end,
    video_status = coalesce(v_fields->>'video_status', c.video_status),
    graphic_status = coalesce(v_fields->>'graphic_status', c.graphic_status),
    status = coalesce(v_fields->>'status', c.status),
    client_video_approved_at = coalesce(v_fields->>'client_video_approved_at', c.client_video_approved_at),
    client_graphic_approved_at = coalesce(v_fields->>'client_graphic_approved_at', c.client_graphic_approved_at),
    client_caption_approved_at = coalesce(v_fields->>'client_caption_approved_at', c.client_caption_approved_at),
    client_title_approved_at = coalesce(v_fields->>'client_title_approved_at', c.client_title_approved_at),
    kasper_approved_at = coalesce(v_fields->>'kasper_approved_at', c.kasper_approved_at),
    updated_at = v_now_iso
  where c.client = v_client and c.id = v_card_id
  returning c.* into v_row;

  insert into public.calendar_post_events (client, post_id, ts, actor, role, action, component, source, payload)
  values (v_client, v_card_id, now(), v_actor->>'name', 'client', 'comment_add', v_component,
    'calendar-feedback-recovery', jsonb_build_object('added', jsonb_build_array(v_native_id),
      'canonical_comment_id', v_canonical.id));
  for v_key in select jsonb_object_keys(v_changed) loop
    if v_key like '%\_status' or v_key = 'status' then
      insert into public.calendar_post_events (client, post_id, ts, actor, role, action, component,
        from_status, to_status, source)
      values (v_client, v_card_id, now(), v_actor->>'name', 'client', 'status_change',
        case when v_key = 'status' then null else replace(v_key, '_status', '') end,
        v_changed->v_key->>'from', v_changed->v_key->>'to', 'calendar-feedback-recovery');
    end if;
  end loop;

  v_applied := jsonb_build_object('comment', true, 'fields', v_changed, 'entry', v_entry);
  insert into public.calendar_feedback_materializations (
    attempt_key, client, card_id, component, native_comment_id, canonical_comment_id,
    comment_dedup_key, request_fingerprint, outcome, applied,
    source_updated_at_before, source_updated_at_after)
  values (
    v_attempt_key, v_client, v_card_id, v_component, v_native_id, v_canonical.id,
    v_dedup, v_request_fingerprint, 'materialized', v_applied,
    v_expected_updated_at, v_row.updated_at)
  returning * into v_existing;
  return jsonb_build_object('outcome', 'materialized',
    'materialization', to_jsonb(v_existing), 'row', to_jsonb(v_row));
end;
$fn$;

revoke all on function public.calendar_feedback_recovery_apply_v1(jsonb) from public, anon, authenticated;
grant execute on function public.calendar_feedback_recovery_apply_v1(jsonb) to service_role;

comment on function public.calendar_feedback_recovery_apply_v1(jsonb) is
  'Materializes one owned client Calendar note/tweak into its source card after the native comment was accepted and the source save failed: verifies the add receipt and canonical lifecycle under lock, the reserved companion status receipt, reciprocal client/card/deliverable binding and an original-source-row CAS, then appends the verified entry, applies only the owned scalar fields, ledgers events and records idempotent evidence. Holds return without writes. Service role only.';

commit;

-- OWNER-ONLY ROLLBACK (nothing above changes existing objects):
--   drop function if exists public.calendar_feedback_recovery_apply_v1(jsonb);
--   drop function if exists public._calendar_feedback_recovery_iso(timestamptz);
--   -- keep public.calendar_feedback_materializations: it is evidence of
--   -- source changes that already happened; drop only if it is empty.
