-- Actual production-write envelope compatibility repair.
begin;
create or replace function public.production_native_ordinary_event(p_event jsonb,p_expected jsonb)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare v_event jsonb:=coalesce(p_event,'{}'::jsonb); v_out jsonb:=coalesce(v_event->'outbound','{}'::jsonb); v_payload jsonb:=coalesce(v_out->'payload','{}'::jsonb); v_cap jsonb; v_token uuid:=gen_random_uuid(); v_owner text:=p_expected->>'owner'; v_native text:=p_expected->>'native_operation'; v_source_edited_at timestamptz;
begin
 if v_payload ? '_native_ordinary_receipt' then raise exception 'native_ordinary_receipt_marker_forbidden'; end if;
 v_cap:=public.production_native_ordinary_capability(p_expected->>'team');
 if v_cap->>'mode'='provider' then return v_event; end if;
 if v_cap->>'mode'='hold' then raise exception 'native_ordinary_receipt_held'; end if;
 -- outboundBase carries entity/id/op/dedup/clock only. Scope comes from the
 -- locked owner row; supplied optional scope is rejected only if contradictory.
 v_source_edited_at:=coalesce(nullif(p_expected->>'source_edited_at','')::timestamptz,(v_out->>'source_edited_at')::timestamptz);
 if v_owner not in ('deliverable','comment') or coalesce(v_native,'')='' or v_source_edited_at is null
    or p_expected->>'entity' is distinct from v_out->>'entity' or p_expected->>'entity_id' is distinct from v_out->>'entity_id'
    or p_expected->>'receipt_operation' is distinct from v_out->>'operation'
    or (v_out ? 'client_slug' and p_expected->>'client_slug' is distinct from v_out->>'client_slug')
    or (v_out ? 'team' and p_expected->>'team' is distinct from v_out->>'team')
    or p_expected->>'actor' is distinct from v_event->>'actor' or p_expected->>'role' is distinct from v_event->>'role'
    or coalesce(v_out->>'dedup_key','')='' or coalesce(v_payload->>'_intent_fingerprint','')=''
    or coalesce((v_out->>'test_only')::boolean,false) or coalesce((v_out->>'legacy_parity')::boolean,false)
 then raise exception 'native_ordinary_receipt_scope_forbidden'; end if;
 insert into public.production_native_ordinary_receipt_admissions(token,epoch,owner,entity,entity_id,receipt_operation,native_operation,client_slug,team,actor,role,dedup_key,intent_fingerprint,source_edited_at)
 values(v_token,v_cap->>'epoch',v_owner,p_expected->>'entity',p_expected->>'entity_id',p_expected->>'receipt_operation',v_native,p_expected->>'client_slug',p_expected->>'team',p_expected->>'actor',p_expected->>'role',v_out->>'dedup_key',v_payload->>'_intent_fingerprint',v_source_edited_at);
 return jsonb_set(v_event,'{outbound,payload}',v_payload||jsonb_build_object('_native_ordinary_receipt',jsonb_build_object('schema',1,'epoch',v_cap->>'epoch','owner',v_owner,'operation',v_native,'token',v_token::text)),true);
end $fn$;

-- Rebind lifecycle so its receipt timestamp is the clamped persisted clock.
create or replace function public.production_comment_lifecycle_write(
  p_comment jsonb,
  p_event jsonb default '{}'::jsonb,
  p_expected_version integer default null,
  p_expected_updated_at timestamptz default null
) returns public.production_comments
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_comment jsonb := coalesce(p_comment, '{}'::jsonb);
  v_event jsonb := coalesce(p_event, '{}'::jsonb);
  v_outbound jsonb := coalesce(v_event->'outbound', '{}'::jsonb);
  v_action text := lower(coalesce(nullif(v_comment->>'operation', ''), ''));
  v_requested_id text := coalesce(
    nullif(btrim(v_comment->>'id'), ''),
    nullif(btrim(v_comment->>'native_comment_id'), '')
  );
  v_dedup_key text := nullif(btrim(v_outbound->>'dedup_key'), '');
  v_fingerprint text := nullif(btrim(v_outbound->'payload'->>'_intent_fingerprint'), '');
  v_legacy_parity boolean := coalesce((v_outbound->>'legacy_parity')::boolean, false);
  v_existing public.production_comments%rowtype;
  v_result public.production_comments%rowtype;
  v_receipt public.production_comment_mutation_receipts%rowtype;
  v_target_id text;
  v_payload jsonb;
  v_outbox_id bigint;
  v_dependency_id bigint;
  v_supplied_dependency_id bigint :=
    nullif(btrim(v_outbound->>'depends_on_id'), '')::bigint;
  v_mirror_applicable boolean;
  v_card_import_without_foreign boolean := false;
begin
  if v_action not in ('edit', 'delete', 'resolve', 'unresolve') then
    raise exception 'unsupported production comment lifecycle operation';
  end if;
  if v_requested_id is null or v_dedup_key is null or v_fingerprint is null then
    raise exception 'production comment lifecycle identity required';
  end if;

  select r.* into v_receipt
  from public.production_comment_mutation_receipts r
  where r.dedup_key = v_dedup_key;
  if found then
    if v_receipt.comment_id is distinct from v_requested_id
       or v_receipt.action is distinct from v_action
       or v_receipt.intent_fingerprint is distinct from v_fingerprint then
      raise exception 'idempotency_conflict';
    end if;
    select c.* into v_result
    from public.production_comments c
    where c.id = v_receipt.comment_id;
    if not found then raise exception 'idempotent_result_missing'; end if;
    if v_outbound->>'entity' is distinct from 'comment'
       or v_outbound->>'entity_id' is distinct from coalesce(v_result.deliverable_id,v_result.batch_id)
       or v_outbound->>'operation' is distinct from 'comment'
       or (v_comment ? 'deliverable_id' and nullif(btrim(v_comment->>'deliverable_id'),'') is distinct from v_result.deliverable_id)
       or (v_comment ? 'batch_id' and nullif(btrim(v_comment->>'batch_id'),'') is distinct from v_result.batch_id)
       or (v_comment ? 'team' and nullif(btrim(v_comment->>'team'),'') is distinct from v_result.team)
       or (v_comment ? 'author_name' and nullif(btrim(v_comment->>'author_name'),'') is distinct from v_result.author_name)
       or (v_comment ? 'role' and nullif(btrim(v_comment->>'role'),'') is distinct from v_result.role)
    then raise exception 'idempotency_conflict'; end if;
    if exists(select 1 from public.mirror_outbox o where o.dedup_key=v_dedup_key) then
      perform public.production_outbox_replay(
        'comment',coalesce(v_result.deliverable_id,v_result.batch_id),'comment',
        v_result.client_slug,v_result.team,nullif(v_event->>'actor',''),nullif(v_event->>'role',''),
        coalesce((v_outbound->>'test_only')::boolean,false),v_legacy_parity,
        v_fingerprint,v_dedup_key
      );
    end if;
    return v_result;
  end if;

  select c.* into v_existing
  from public.production_comments c
  where c.id = v_requested_id
     or c.native_comment_id = v_requested_id
  order by case when c.id = v_requested_id then 0 else 1 end
  limit 1
  for update;
  if not found then raise exception 'comment_write_conflict'; end if;
  if p_expected_version is null or p_expected_updated_at is null
     or v_existing.version is distinct from p_expected_version
     or v_existing.updated_at is distinct from p_expected_updated_at then
    raise exception 'comment_write_conflict';
  end if;
  if v_existing.parent_id is not null and v_action in ('resolve', 'unresolve') then
    raise exception 'production comment root required';
  end if;

  v_target_id := coalesce(v_existing.deliverable_id, v_existing.batch_id);
  if v_target_id is null then raise exception 'production comment lifecycle target required'; end if;
  perform public.production_assert_authority(
    v_existing.client_slug,
    v_existing.team,
    coalesce((v_outbound->>'test_only')::boolean, false),
    v_legacy_parity
  );
  v_mirror_applicable := public.production_comment_mirror_applicable(
    coalesce((v_outbound->>'test_only')::boolean, false),
    v_legacy_parity
  );

  -- The CAS above proves the caller holds the current row, so a lifecycle
  -- edit/delete/resolve/reopen is a server-authoritative mutation. Clamp its
  -- source clock so it can never regress below the stored value. Without this a
  -- browser clock behind the row's source_updated_at — including a valid
  -- future-dated imported comment — would trip the production_comment_upsert
  -- stale-source guard, which returns the row unchanged; this function would
  -- then insert a mutation receipt and enqueue the old body, reporting (and
  -- letting exact retries replay) a false success for a write that never
  -- happened.
  v_comment := jsonb_set(
    v_comment,
    '{source_updated_at}',
    to_jsonb(greatest(
      coalesce(nullif(btrim(v_comment->>'source_updated_at'), '')::timestamptz, now()),
      v_existing.source_updated_at
    )::text),
    true
  );

  -- Issue after source_updated_at is clamped: this exact timestamp reaches the durable receipt.
  v_event := public.production_native_ordinary_event(v_event, jsonb_build_object(
    'owner','comment','entity','comment','entity_id',v_target_id,
    'receipt_operation','comment','native_operation',v_action,
    'client_slug',v_existing.client_slug,'team',v_existing.team,'actor',v_event->>'actor','role',v_event->>'role',
    'source_edited_at',v_comment->>'source_updated_at'
  ));
  v_outbound := coalesce(v_event->'outbound', '{}'::jsonb);

  v_result := public.production_comment_upsert(v_comment, v_event - 'outbound');

  insert into public.production_comment_mutation_receipts (
    dedup_key, comment_id, action, intent_fingerprint, result_version
  ) values (
    v_dedup_key, v_result.id, v_action, v_fingerprint, v_result.version
  )
  on conflict (dedup_key) do nothing;
  if not found then raise exception 'idempotency_conflict'; end if;

  -- Linear has create/edit/delete mutations, but no native resolved state.
  -- Resolve/reopen therefore commits the canonical lifecycle and audit event
  -- without manufacturing a foreign comment or an inapplicable outbox row.
  if (v_action in ('edit', 'delete') or (v_outbound->'payload' ? '_native_ordinary_receipt')) and v_mirror_applicable then
    -- Lifecycle writes never wait for the create mirror to bind a provider id.
    -- Instead each intent depends on the immediately preceding canonical
    -- comment intent. This preserves create -> edit(s) -> delete order while
    -- F2 is paused or Linear is unavailable, and lets the drainer hand the
    -- provider id forward from each durable predecessor receipt.
    select o.id into v_dependency_id
    from public.mirror_outbox o
    where o.entity = 'comment'
      and o.operation = 'comment'
      and o.comment_id = v_result.id
      and o.dedup_key <> v_dedup_key
      and o.status in ('pending', 'failed', 'shadow_ok', 'written', 'skipped')
    order by o.id desc
    limit 1;
    if v_supplied_dependency_id is not null
       and v_supplied_dependency_id is distinct from v_dependency_id then
      raise exception 'production comment dependency mismatch';
    end if;
    -- F42 rows were copied from native card arrays; the import itself never
    -- creates a Linear comment. Mark only an exact imported row that still has
    -- neither a provider id nor a predecessor intent. The drainer can then
    -- materialize a first edit as one create, or converge a first delete as a
    -- no-foreign-object terminal receipt, instead of retrying an impossible
    -- providerless edit/delete forever.
    select exists (
      select 1
      from public.production_comment_card_links l
      where l.production_comment_id = v_result.id
    )
      and v_result.linear_comment_id is null
      and v_dependency_id is null
    into v_card_import_without_foreign;
    v_payload := coalesce(v_outbound->'payload', '{}'::jsonb)
      || jsonb_build_object(
        'action', v_action,
        'body', v_result.body,
        'comment_id', v_result.id,
        'linear_comment_id', v_result.linear_comment_id,
        'card_import_without_foreign', v_card_import_without_foreign
      );
    v_outbox_id := public.mirror_outbox_enqueue(
      p_entity := 'comment',
      p_entity_id := v_target_id,
      p_operation := 'comment',
      p_payload := v_payload,
      p_dedup_key := v_dedup_key,
      p_source_edited_at := v_result.source_updated_at,
      p_client_slug := v_result.client_slug,
      p_team := v_result.team,
      p_actor := nullif(v_event->>'actor', ''),
      p_role := nullif(v_event->>'role', ''),
      p_deliverable_id := v_result.deliverable_id,
      p_batch_id := v_result.batch_id,
      p_comment_id := v_result.id,
      p_depends_on_id := v_dependency_id,
      p_test_only := coalesce((v_outbound->>'test_only')::boolean, false)
    );
    if v_legacy_parity then
      update public.mirror_outbox
      set legacy_parity = true, updated_at = now()
      where id = v_outbox_id;
    end if;
  end if;

  return v_result;
end;
$fn$;

revoke all on function public.production_comment_lifecycle_write(
  jsonb, jsonb, integer, timestamptz
) from public, anon, authenticated;
grant execute on function public.production_comment_lifecycle_write(
  jsonb, jsonb, integer, timestamptz
) to service_role;


revoke all on function public.production_native_ordinary_event(jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.production_comment_lifecycle_write(jsonb,jsonb,integer,timestamp with time zone) from public,anon,authenticated;
grant execute on function public.production_comment_lifecycle_write(jsonb,jsonb,integer,timestamp with time zone) to service_role;
commit;
