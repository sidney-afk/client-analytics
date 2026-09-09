-- G3 dormant service-only boundary. No HTTP writer is rerouted by this file.
-- Installation requires versioned schema AND data recovery for both new owners.
begin;

create table public.production_card_materialization_receipts (
  id uuid primary key default gen_random_uuid(),
  surface text not null check (surface in ('calendar','samples')),
  client_slug text not null,
  card_id text not null,
  request_id text not null,
  manifest_digest text not null,
  receipt_identity jsonb not null check (jsonb_typeof(receipt_identity) = 'object'),
  projection jsonb not null check (jsonb_typeof(projection) = 'object'),
  created_row jsonb not null check (jsonb_typeof(created_row) = 'object'),
  provenance_id bigint not null,
  coverage_epoch text not null,
  accepted_at timestamptz not null default clock_timestamp(),
  unique(surface, client_slug, card_id)
);
create table public.production_card_materialization_ingress (
  id uuid primary key default gen_random_uuid(),
  surface text,
  claimed_source text,
  raw_body text not null,
  raw_sha256 text not null,
  parsed_body jsonb,
  client_slug text,
  card_id text,
  outcome jsonb not null check (jsonb_typeof(outcome) = 'object'),
  received_at timestamptz not null default clock_timestamp()
);
-- No FK: deleting a batch, card, manifest or receipt cannot erase this evidence.
alter table public.production_card_materialization_receipts enable row level security;
alter table public.production_card_materialization_ingress enable row level security;
revoke all on public.production_card_materialization_receipts, public.production_card_materialization_ingress
  from public, anon, authenticated, service_role;
grant select on public.production_card_materialization_receipts, public.production_card_materialization_ingress to service_role;

create function public.production_card_materialization_retained()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin raise exception 'card_materialization_evidence_retained'; end;
$$;
revoke all on function public.production_card_materialization_retained() from public, anon, authenticated, service_role;
create trigger materialization_retained before update or delete on public.production_card_materialization_receipts
  for each row execute function public.production_card_materialization_retained();
create trigger materialization_retained_truncate before truncate on public.production_card_materialization_receipts
  for each statement execute function public.production_card_materialization_retained();
create trigger materialization_retained before update or delete on public.production_card_materialization_ingress
  for each row execute function public.production_card_materialization_retained();
create trigger materialization_retained_truncate before truncate on public.production_card_materialization_ingress
  for each statement execute function public.production_card_materialization_retained();

-- This is a new coverage boundary, not retrospective proof of lifetime history.
insert into public.production_card_provenance(surface,client,card_id,kind,source)
values ('calendar','','','installed','native-card-materialization-boundary-v1'),
       ('samples','','','installed','native-card-materialization-boundary-v1');
insert into public.syncview_runtime_flags(key,value)
values ('native_card_materialization',jsonb_build_object('mode','hold','epoch',null,'covered_from',clock_timestamp()))
on conflict(key) do nothing;

create function public.production_card_materialize(p_surface text, p_source text, p_raw_body text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public set timezone = 'UTC' as $$
declare
  v_body jsonb; v_raw jsonb; v_expected jsonb; v_projection jsonb;
  v_client text; v_card text; v_key text; v_table text; v_request text;
  v_m public.production_intake_manifests; v_batch public.batches;
  v_parent public.mirror_outbox; v_child public.mirror_outbox; v_d public.deliverables;
  v_receipt public.production_card_materialization_receipts;
  v_item jsonb; v_row jsonb; v_video jsonb; v_graphic jsonb;
  v_current jsonb; v_identity jsonb; v_children jsonb := '[]';
  v_count integer; v_number integer; v_epoch text; v_digest text;
  v_provenance bigint; v_installed timestamptz; v_coverage timestamptz;
  v_flag jsonb; v_authority jsonb; v_team text; v_generation bigint;
  v_result jsonb; v_reason text; v_ingress uuid; v_fresh boolean := false; v_columns text;
begin
  -- Raw TEXT is the exact text supplied by the future adapter. This RPC cannot
  -- prove that an adapter retained the HTTP bytes. Refused oversized input is
  -- deliberately NOT acknowledged as conserved. HTTP admission remains held.
  if p_raw_body is null or octet_length(p_raw_body) > 1048576 then
    return jsonb_build_object('ok',false,'outcome','held','reason','raw_body_unretained','conserved',false);
  end if;
  begin
    v_reason := 'invalid_body';
    v_body := p_raw_body::jsonb;
    if p_surface not in ('calendar','samples') or p_surface is null then raise exception 'held'; end if;
    v_key := case when p_surface='samples' then 'sample' else 'post' end;
    v_table := case when p_surface='samples' then 'sample_reviews' else 'calendar_posts' end;
    v_raw := v_body->v_key;
    v_client := v_body->>'client'; v_card := v_raw->>'id';
    if jsonb_typeof(v_body) is distinct from 'object' or jsonb_typeof(v_raw) is distinct from 'object'
      or nullif(v_client,'') is null or nullif(v_card,'') is null
      or jsonb_typeof(v_raw->'order_index') is distinct from 'number'
    then raise exception 'held'; end if;
    v_reason := 'source_outside_adapter';
    if coalesce(p_source,'') not in ('submission-native','calendar-native','samples-native') then raise exception 'held'; end if;
    -- Preserve the original envelope. Only order_index is incidental browser
    -- placement. No other property is silently dropped or normalized.
    v_projection := jsonb_set(v_body,array[v_key],v_raw-'order_index');
    v_reason := 'manifest_unresolved';
    select count(*), min(m.request_id) into v_count,v_request
      from public.production_intake_manifests m
      where m.client_slug=v_client and coalesce(m.batch_snapshot->>'purpose','calendar')=p_surface
        and exists(select 1 from jsonb_array_elements(m.expected_items) i where i->'row'->>'card_id'=v_card);
    if v_count <> 1 then raise exception 'held'; end if;
    -- Reconciler: manifest lock -> card row -> sorted children. Binder: card
    -- row -> children. Admission advisory only serializes absent-card attempts.
    perform pg_advisory_xact_lock(hashtextextended('card-materialization:'||p_surface||':'||v_client||':'||v_card,0));
    perform pg_advisory_xact_lock(hashtextextended('root-intake-manifest:'||v_request,0));
    -- There is no existing unique index on manifest card ownership. Protect
    -- this finite ownership census from a concurrent root manifest insertion.
    lock table public.production_intake_manifests in share mode;
    select count(*) into v_count from public.production_intake_manifests m where m.client_slug=v_client
      and coalesce(m.batch_snapshot->>'purpose','calendar')=p_surface
      and exists(select 1 from jsonb_array_elements(m.expected_items) i where i->'row'->>'card_id'=v_card);
    if v_count<>1 then raise exception 'held'; end if;
    select * into v_m from public.production_intake_manifests where request_id=v_request for share;
    v_digest := encode(pg_catalog.sha256(convert_to(to_jsonb(v_m)::text,'UTF8')),'hex');
    select * into v_batch from public.batches where id=v_m.batch_id for share;
    v_reason := 'manifest_identity_conflict';
    if v_m.client_slug is distinct from v_client or v_batch.client_slug is distinct from v_client
      or coalesce(v_m.batch_snapshot->>'purpose','calendar') is distinct from p_surface
      or coalesce(v_batch.purpose,'calendar') is distinct from p_surface then raise exception 'held'; end if;
    select * into v_receipt from public.production_card_materialization_receipts
      where surface=p_surface and client_slug=v_client and card_id=v_card;
    v_fresh := v_receipt.id is null;
    -- F27 takes team admission locks, then authority/fences, before touching
    -- card/child state. Take those same admission locks before our card row.
    if v_fresh then
      for v_team in select distinct i->'row'->>'team' from jsonb_array_elements(v_m.expected_items) i order by 1 loop
        perform pg_advisory_xact_lock(hashtextextended('track-b-f27:'||v_team,0));
      end loop;
      select value into v_authority from public.syncview_runtime_flags where key='prod_authority' for share;
      perform 1 from public.track_b_f27_team_fences where team in
        (select i->'row'->>'team' from jsonb_array_elements(v_m.expected_items) i) order by team for share;
    end if;
    execute format('select to_jsonb(c) from public.%I c where client=$1 and id=$2 for update',v_table)
      into v_current using v_client,v_card;
    if v_fresh then
      v_reason := 'admission_held';
      select value into v_flag from public.syncview_runtime_flags where key='native_card_materialization' for share;
      if jsonb_typeof(v_flag) is distinct from 'object' or v_flag->>'mode' is distinct from 'native'
        or nullif(v_flag->>'epoch','') is null then raise exception 'held'; end if;
      v_reason := 'coverage_unproven';
      v_coverage := (v_flag->>'covered_from')::timestamptz;
      select min(at) into v_installed from public.production_card_provenance where surface=p_surface
        and kind='installed' and source='native-card-materialization-boundary-v1';
      if v_coverage is null or v_installed is null or v_coverage<v_installed or v_m.recorded_at<v_coverage then raise exception 'held'; end if;
      v_reason := 'card_lifetime_unproven';
      if v_current is not null or exists(select 1 from public.production_card_provenance where surface=p_surface
        and client=v_client and card_id=v_card) then raise exception 'held'; end if;
      if p_surface='calendar' then
        if exists(select 1 from public.calendar_post_events where client=v_client and post_id=v_card) then raise exception 'held'; end if;
      else
        if exists(select 1 from public.sample_review_events where client=v_client and sample_id=v_card) then raise exception 'held'; end if;
      end if;
    else
      v_reason := 'receipt_conflict';
      if v_receipt.request_id is distinct from v_request or v_receipt.manifest_digest is distinct from v_digest
        or v_receipt.projection is distinct from v_projection then raise exception 'held'; end if;
      v_reason := 'card_lifecycle_held';
      if v_current is null or lower(btrim(coalesce(v_current->>'status','')))='archived'
        or not exists(select 1 from public.production_card_provenance where id=v_receipt.provenance_id
          and surface=p_surface and client=v_client and card_id=v_card and kind='created'
          and source='native-card-materialization-boundary-v1')
        or exists(select 1 from public.production_card_provenance where surface=p_surface and client=v_client and card_id=v_card
          and id>v_receipt.provenance_id and kind in ('created','deleted','slots_changed')) then raise exception 'held'; end if;
    end if;
    -- For fresh admission acquire the actual card row BEFORE child locks. A
    -- concurrent ordinary insertion wins as a conflict, never an overwrite.
    -- All validation/faults below roll this provisional insertion back.
    if v_fresh then
      -- Early missing-row refusal avoids an FK error during provisional card
      -- INSERT. This is not the acceptance proof: the complete set is still
      -- locked and revalidated below before any successful commit.
      v_reason := 'accepted_children_incomplete';
      if exists(select 1 from jsonb_array_elements(v_m.expected_items) i
        where not exists(select 1 from public.deliverables d where d.id=i->'row'->>'id')) then raise exception 'held'; end if;
      v_reason := 'card_insert_conflict';
      perform set_config('app.card_materialization_source','native-card-materialization-boundary-v1',true);
      v_columns := 'id,order_index,name,status,video_status,graphic_status,asset_url,thumbnail_url,linear_issue_id,video_deliverable_id,graphic_linear_issue_id,graphic_deliverable_id';
      v_columns := v_columns || case when p_surface='samples' then ',creative_direction,hide_creative_direction'
        else ',scheduled_date,caption_status,caption,cta,tweaks,video_tweaks,graphic_tweaks,caption_tweaks' end;
      execute format('insert into public.%I(client,%s) select $1,%s from jsonb_populate_record(null::public.%I,$2) r returning to_jsonb(%I)',
        v_table,v_columns,v_columns,v_table,v_table) into v_current using v_client,
          v_raw||jsonb_build_object('video_deliverable_id',nullif(v_raw->>'video_deliverable_id',''),
            'graphic_deliverable_id',nullif(v_raw->>'graphic_deliverable_id',''));
      -- The raw projection retains browser empty strings. Empty database FK
      -- slots are NULL, matching the existing writers' storage conversion.
    end if;
    perform 1 from public.deliverables d where d.id in
      (select i->'row'->>'id' from jsonb_array_elements(v_m.expected_items) i) order by d.id for update;
    -- Re-read and compare the COMPLETE child set under its locks, including
    -- unrelated-card children of this same accepted root request.
    select * into v_parent from public.mirror_outbox where dedup_key=v_m.parent_receipt->>'dedup_key' for share;
    v_reason := 'accepted_parent_unproven';
    if v_parent.id is null or v_parent.entity is distinct from 'batch' or v_parent.entity_id is distinct from v_m.batch_id
      or v_parent.client_slug is distinct from v_client or v_parent.role is distinct from v_m.actor_role
      or v_parent.payload->>'_intent_fingerprint' is distinct from v_m.parent_receipt->>'intent_fingerprint'
      or v_parent.payload->>'_native_intake_request' is distinct from v_request
      or v_parent.operation is distinct from 'create' or v_parent.team is distinct from v_m.parent_receipt->>'team'
      or v_parent.payload->>'_native_intake_epoch' is distinct from v_m.native_epochs->>v_parent.team
      or v_parent.linear_result->>'native_only' is distinct from 'true'
      or v_parent.status is distinct from 'skipped' then raise exception 'held'; end if;
    for v_item in select value from jsonb_array_elements(v_m.expected_items) order by value->'row'->>'id' loop
      v_row := v_item->'row'; v_team := v_row->>'team'; v_epoch := v_m.native_epochs->>v_team;
      select * into v_d from public.deliverables where id=v_row->>'id';
      select * into v_child from public.mirror_outbox where dedup_key=v_item->>'child_dedup' for share;
      v_reason := 'accepted_children_incomplete';
      if nullif(v_epoch,'') is null or v_d.id is null or v_child.id is null
        or v_d.batch_id is distinct from v_m.batch_id or v_d.client_slug is distinct from v_client
        or v_d.team is distinct from v_team or v_d.kind is distinct from v_row->>'kind'
        or v_d.card_id is distinct from v_row->>'card_id'
        or v_child.entity is distinct from 'deliverable' or v_child.entity_id is distinct from v_d.id
        or v_child.client_slug is distinct from v_client or v_child.batch_id is distinct from v_m.batch_id
        or v_child.depends_on_id is distinct from v_parent.id or v_child.actor is distinct from v_parent.actor
        or v_child.role is distinct from v_m.actor_role or v_child.status is distinct from 'skipped'
        or v_child.operation is distinct from 'create' or v_child.team is distinct from v_team
        or v_child.linear_result->>'native_only' is distinct from 'true'
        or v_child.payload->>'_intent_fingerprint' is distinct from v_item->>'child_fingerprint'
        or v_child.payload->>'_native_intake_epoch' is distinct from v_epoch
        or v_child.payload->>'_native_intake_request' is distinct from v_request
      then raise exception 'held'; end if;
      v_children := v_children||jsonb_build_object('id',v_child.id,'dedup',v_child.dedup_key,'fingerprint',v_item->>'child_fingerprint','epoch',v_epoch);
      if v_fresh then
        v_reason := 'native_lifecycle_held';
        if v_batch.status is distinct from 'active' or v_d.status is distinct from v_row->>'status'
          or not exists(select 1 from public.clients where slug=v_client and active is true) then raise exception 'held'; end if;
        -- Same authority/fence rows locked by F27. No outbox is emitted by card
        -- creation; existing accepted outbox bytes are never changed.
        select value into v_authority from public.syncview_runtime_flags where key='prod_authority' for share;
        select generation into v_generation from public.track_b_f27_team_fences where team=v_team for share;
        v_reason := 'f27_held';
        if v_generation is null or v_authority->>v_team is distinct from 'syncview'
          or exists(select 1 from public.track_b_team_rollbacks where team=v_team and state='open') then raise exception 'held'; end if;
      end if;
      if v_row->>'card_id'=v_card then
        v_reason := 'card_plan_conflict';
        if v_team='video' and v_video is null then v_video:=v_row;
        elsif v_team='graphics' and v_graphic is null then v_graphic:=v_row;
        else raise exception 'held'; end if;
        if v_number is not null and v_number<>(v_item->>'video_number')::integer then raise exception 'held'; end if;
        v_number:=(v_item->>'video_number')::integer;
      end if;
    end loop;
    v_reason := 'card_plan_conflict';
    if v_number is null or v_number<1 or exists(select 1 from public.deliverables d where d.client_slug=v_client and d.card_id=v_card
      and not exists(select 1 from jsonb_array_elements(v_m.expected_items) i where i->'row'->>'id'=d.id)) then raise exception 'held'; end if;
    v_expected := jsonb_build_object('id',v_card,'name',coalesce(nullif(v_video->>'title',''),nullif(v_graphic->>'title',''),'Video '||v_number),
      'status','In Progress','video_status','In Progress','graphic_status','In Progress','asset_url','','thumbnail_url','',
      'linear_issue_id',coalesce(v_video->>'linear_issue_url',''),'video_deliverable_id',coalesce(v_video->>'id',''),
      'graphic_linear_issue_id',coalesce(v_graphic->>'linear_issue_url',''),'graphic_deliverable_id',coalesce(v_graphic->>'id',''));
    if p_surface='samples' then
      v_expected:=v_expected||jsonb_build_object('creative_direction','','hide_creative_direction','');
      v_expected:=jsonb_build_object('client',v_client,'sample',v_expected,'comments_base_at','');
    else
      v_expected:=v_expected||jsonb_build_object('scheduled_date','','caption_status','In Progress','caption','','cta','','tweaks','',
        'video_tweaks','','graphic_tweaks','','caption_tweaks','');
      v_expected:=jsonb_build_object('client',v_client,'post',v_expected);
    end if;
    v_reason := 'creation_payload_conflict';
    if v_expected is distinct from v_projection then raise exception 'held'; end if;
    v_identity:=jsonb_build_object('parent_id',v_parent.id,'parent_fingerprint',v_m.parent_receipt->>'intent_fingerprint',
      'actor_key',v_m.actor_key,'actor_role',v_m.actor_role,'auth_kind',v_m.auth_kind,'children',v_children);
    if not v_fresh then
      v_reason := 'receipt_identity_conflict';
      if v_receipt.receipt_identity is distinct from v_identity
        or coalesce(v_current->>'video_deliverable_id','') is distinct from coalesce(v_video->>'id','')
        or coalesce(v_current->>'graphic_deliverable_id','') is distinct from coalesce(v_graphic->>'id','') then raise exception 'held'; end if;
    else
      v_reason := 'creation_provenance_unproven';
      select id into v_provenance from public.production_card_provenance where surface=p_surface and client=v_client and card_id=v_card
        and kind='created' and source='native-card-materialization-boundary-v1'
        and snapshot=jsonb_build_object('video_deliverable_id',v_current->>'video_deliverable_id','graphic_deliverable_id',v_current->>'graphic_deliverable_id');
      if v_provenance is null then raise exception 'held'; end if;
      v_reason := 'receipt_write_failed';
      insert into public.production_card_materialization_receipts(surface,client_slug,card_id,request_id,manifest_digest,
        receipt_identity,projection,created_row,provenance_id,coverage_epoch)
      values(p_surface,v_client,v_card,v_request,v_digest,v_identity,v_projection,v_current,v_provenance,v_flag->>'epoch') returning * into v_receipt;
    end if;
    v_result:=jsonb_build_object('ok',true,'outcome',case when v_fresh then 'created' else 'replayed' end,v_key,v_current);
  exception when others then
    v_result:=jsonb_build_object('ok',false,'outcome','held','reason',coalesce(v_reason,'boundary_failure'));
  end;
  -- Deliberately OUTSIDE the rollback sub-block. Any inability to retain this
  -- record aborts the entire call; it cannot falsely report conservation.
  insert into public.production_card_materialization_ingress(surface,claimed_source,raw_body,raw_sha256,parsed_body,client_slug,card_id,outcome)
    values(p_surface,p_source,p_raw_body,encode(pg_catalog.sha256(convert_to(p_raw_body,'UTF8')),'hex'),v_body,v_client,v_card,v_result)
    returning id into v_ingress;
  return v_result||jsonb_build_object('conserved',true,'ingress_id',v_ingress);
end;
$$;
revoke all on function public.production_card_materialize(text,text,text) from public, anon, authenticated;
grant execute on function public.production_card_materialize(text,text,text) to service_role;
commit;
