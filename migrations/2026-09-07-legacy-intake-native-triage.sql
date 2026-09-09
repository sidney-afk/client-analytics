-- Source-only. Install AFTER F44 receipts, native root/reconcile and card materialization.
-- One additive recovery owner. Never repurpose provider IDs or terminal F44 status.
begin;
create table public.legacy_intake_native_triage (
  payload_hash text primary key,
  payload_json text not null,
  client_slug text not null references public.clients(slug),
  origin_actor text not null default 'public-intake' check(origin_actor='public-intake'),
  received jsonb not null default '{}',
  revision bigint not null default 0,
  state text not null default 'triage' check(state in ('triage','completing','complete','held')),
  reason text not null default 'confirm_intended_teams',
  intended_teams jsonb,
  native_request jsonb,
  completion_actor jsonb,
  completed_by jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(public._linear_intake_payload_is_canonical(payload_json)),
  check(payload_hash=public._linear_intake_sha256_hex(payload_json)),
  check(jsonb_typeof(received)='object'),
  check((native_request is null)=(intended_teams is null)),
  check((native_request is null)=(completion_actor is null))
);
alter table public.legacy_intake_native_triage enable row level security;
revoke all on public.legacy_intake_native_triage from public,anon,authenticated,service_role;
grant select on public.legacy_intake_native_triage to service_role;
create unique index legacy_intake_native_request_identity on public.legacy_intake_native_triage
  ((native_request->>'request_id')) where native_request is not null;

-- Provider claims are receipt UPDATEs (including INSERT ... ON CONFLICT UPDATE).
-- PostgreSQL holds the receipt row before invoking this trigger. Every native
-- path below therefore locks receipts BEFORE the triage owner. No provider
-- claim/write can reopen a freshly captured native-owned key, even while its
-- triage is awaiting confirmation. Historical provider ownership is untouched.
create function public.legacy_intake_native_provider_guard() returns trigger
language plpgsql security definer set search_path=public as $$
declare g public.legacy_intake_native_triage;
begin
  if tg_op='INSERT' then
    -- Row locks cannot cover a not-yet-inserted other-team key. Serialize the
    -- entire payload namespace BEFORE checking whether its first owner exists.
    -- Native receive already holds this lock; its INSERT is reentrant. Do not
    -- take this advisory lock in UPDATE/DELETE after their receipt-row lock.
    perform pg_advisory_xact_lock(hashtextextended('legacy-native:'||new.payload_hash,0));
    select * into g from public.legacy_intake_native_triage where payload_hash=new.payload_hash for share;
    if found and exists(select 1 from jsonb_each(g.received) entry where entry.value->>'fresh_capture'='true')
      and current_setting('app.legacy_intake_capture_hash',true) is distinct from new.payload_hash then
      raise exception 'legacy_intake_native_owned';
    end if;
    return new;
  end if;
  select * into g from public.legacy_intake_native_triage where payload_hash=old.payload_hash for share;
  if found and g.received->old.team->>'fresh_capture'='true'
    and g.received->old.team->>'receipt_key'=old.receipt_key then
    raise exception 'legacy_intake_native_owned';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.legacy_intake_native_provider_guard() from public,anon,authenticated;
create trigger aaa_legacy_intake_native_provider_guard before insert or update or delete on public.linear_intake_receipts
  for each row execute function public.legacy_intake_native_provider_guard();

create function public.legacy_intake_native_acceptance_guard() returns trigger
language plpgsql security definer set search_path=public as $$
declare g public.legacy_intake_native_triage;
begin
  -- Preliminary lookup only obtains the immutable hash; receipt locks precede
  -- the owner lock, matching the provider UPDATE trigger's lock order.
  select * into g from public.legacy_intake_native_triage where native_request->>'request_id'=new.request_id;
  if not found then return new; end if;
  perform 1 from public.linear_intake_receipts where payload_hash=g.payload_hash order by receipt_key for update;
  select * into g from public.legacy_intake_native_triage where native_request->>'request_id'=new.request_id for update;
  if not found then return new; end if;
  if g.state<>'completing' or new.client_slug is distinct from g.client_slug
    or new.actor_key is distinct from g.completion_actor->>'key'
    or new.actor_role is distinct from g.completion_actor->>'role' or new.auth_kind is distinct from 'staff'
    or new.request_intent->'batch' is distinct from g.native_request->'batch'
    or new.request_intent->'items' is distinct from g.native_request->'items'
    or exists(select 1 from jsonb_array_elements_text(g.intended_teams) t where nullif(new.native_epochs->>t,'') is null)
    or exists(select 1 from public.linear_intake_receipts r where r.payload_hash=g.payload_hash
      and (not(g.received ? r.team) or g.received->r.team->>'fresh_capture' is distinct from 'true'
        or r.status<>'pending' or r.attempts<>0 or r.parent_issue_id is not null or r.child_issue_ids<>'[]'))
    then raise exception 'legacy_intake_acceptance_conflict'; end if;
  return new;
end;
$$;
revoke all on function public.legacy_intake_native_acceptance_guard() from public,anon,authenticated;
create trigger legacy_intake_native_acceptance_guard before insert on public.production_intake_manifests
  for each row execute function public.legacy_intake_native_acceptance_guard();

-- The service gateway verifies the real roster actor; the database retains it
-- separately from the unverified original submitter and accepted manifest actor.
create function public.legacy_intake_native_receive(
  p_payload text,p_team text,p_raw text,p_client text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  h text:=public._linear_intake_sha256_hex(p_payload);
  k text:='linear-intake-v1:'||p_team||':'||h;
  g public.legacy_intake_native_triage;
  r public.linear_intake_receipts;
  fresh boolean:=false;
  envelope jsonb:=p_raw::jsonb;
begin
  if not public._linear_intake_payload_is_canonical(p_payload) or p_team not in ('video','graphics')
    or envelope->>'receipt_key' is distinct from k or envelope->>'idempotency_key' is distinct from k
    or envelope->>'payload_hash' is distinct from h or envelope->>'team' is distinct from p_team
    or (envelope-'action'-'team'-'receipt_key'-'idempotency_key'-'payload_hash') is distinct from p_payload::jsonb
    or octet_length(p_raw)>1048576 then raise exception 'legacy_intake_payload_conflict'; end if;
  perform pg_advisory_xact_lock(hashtextextended('legacy-native:'||h,0));
  perform 1 from public.linear_intake_receipts where payload_hash=h order by receipt_key for update;
  select * into g from public.legacy_intake_native_triage where payload_hash=h for update;
  if found and (g.payload_json<>p_payload or g.client_slug<>p_client) then raise exception 'legacy_intake_identity_conflict'; end if;
  if not exists(select 1 from public.clients where slug=p_client and active is true
    and display_name=btrim(p_payload::jsonb->>'clientName')) then raise exception 'legacy_intake_client_conflict'; end if;
  select * into r from public.linear_intake_receipts where receipt_key=k for update;
  if not found then
    -- Transaction-local server implementation context, never a browser flag.
    -- It permits capture of a late team into this SAME conserved owner; old
    -- provider inserts for that hash cannot start a second creation owner.
    perform set_config('app.legacy_intake_capture_hash',h,true);
    insert into public.linear_intake_receipts(receipt_key,payload_hash,client,team,payload_json)
      values(k,h,btrim(p_payload::jsonb->>'clientName'),p_team,p_payload) returning * into r;
    perform set_config('app.legacy_intake_capture_hash','',true);
    fresh:=true;
  end if;
  if g.payload_hash is null then
    insert into public.legacy_intake_native_triage(payload_hash,payload_json,client_slug)
      values(h,p_payload,p_client) returning * into g;
  end if;
  if not (g.received ? p_team) then
    update public.legacy_intake_native_triage set received=received||jsonb_build_object(p_team,
      jsonb_build_object('receipt_key',k,'raw_body',p_raw,'fresh_capture',fresh,'original_status',r.status)),
      revision=revision+1,updated_at=now(),
      state=case when not fresh or (intended_teams is not null and not(intended_teams ? p_team)) then 'held' else state end,
      reason=case when not fresh then 'provider_or_unknown_receipt' when intended_teams is not null and not(intended_teams ? p_team)
        then 'late_team_conflict' else reason end
      where payload_hash=h returning * into g;
  end if;
  -- Preserve historical provider-created responses exactly; do not counterfeit
  -- provider UUIDs with native IDs. Every other historical receipt stays held.
  if r.status='created' then
    return jsonb_build_object('ok',true,'status','created','ledger_status',r.status,'team',p_team,
      'payload_hash',h,'receipt_key',k,'idempotency_key',k,'parent_id',r.parent_issue_id,
      'parent_issue_url',r.parent_issue_url,'child_issue_ids',r.child_issue_ids::jsonb);
  end if;
  return jsonb_build_object('ok',true,'status','received','durable_capture',true,'triage_required',true,
    'ledger_status',r.status,'team',p_team,'payload_hash',h,'receipt_key',k,'idempotency_key',k,
    'triage_reason_codes',jsonb_build_array(case when g.state='complete' then 'native_completed' else g.reason end));
end;
$$;

create function public.legacy_intake_native_prepare(
  p_hash text,p_revision bigint,p_teams jsonb,p_request jsonb,p_actor jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare g public.legacy_intake_native_triage; r public.linear_intake_receipts; t text;
begin
  perform 1 from public.linear_intake_receipts where payload_hash=p_hash order by receipt_key for update;
  select * into g from public.legacy_intake_native_triage where payload_hash=p_hash for update;
  if not found then raise exception 'legacy_intake_missing'; end if;
  if g.revision<>p_revision then raise exception 'legacy_intake_refresh_required'; end if;
  if p_actor->>'kind' is distinct from 'staff' or coalesce(p_actor->>'role','') not in ('admin','smm')
    or nullif(p_actor->>'key','') is null then raise exception 'legacy_intake_staff_required'; end if;
  if p_teams not in ('["video"]'::jsonb,'["graphics"]'::jsonb,'["video","graphics"]'::jsonb)
    or exists(select 1 from jsonb_object_keys(g.received) x where not(p_teams ? x))
    or jsonb_array_length(g.payload_json::jsonb->'videos')*jsonb_array_length(p_teams)>50 then
    raise exception 'legacy_intake_confirm_all_teams'; end if;
  if g.state='held' then raise exception 'legacy_intake_preserved_hold'; end if;
  if exists(select 1 from public.linear_intake_receipts historical where historical.payload_hash=p_hash
    and not(g.received ? historical.team)) then raise exception 'legacy_intake_provider_or_unknown_receipt'; end if;
  for t in select jsonb_object_keys(g.received) loop
    select * into r from public.linear_intake_receipts where receipt_key=g.received->t->>'receipt_key' for share;
    if r.receipt_key is null or g.received->t->>'fresh_capture' is distinct from 'true' or r.status<>'pending'
      or r.parent_issue_id is not null or r.child_issue_ids<>'[]' or r.attempts<>0 then
      raise exception 'legacy_intake_provider_or_unknown_receipt'; end if;
  end loop;
  if g.native_request is null then
    if p_request->>'client_slug' is distinct from g.client_slug or p_request->>'surface' is distinct from 'submission'
      or p_request->>'operation' is distinct from 'intake_create' or nullif(p_request->>'request_id','') is null
      or jsonb_array_length(p_request->'items')<>jsonb_array_length(g.payload_json::jsonb->'videos')*jsonb_array_length(p_teams)
      or p_request->'batch'->>'description' is distinct from g.payload_json then raise exception 'legacy_intake_plan_conflict'; end if;
    update public.legacy_intake_native_triage set intended_teams=p_teams,native_request=p_request,
      completion_actor=p_actor,state='completing',reason='native_completion_pending',updated_at=now()
      where payload_hash=p_hash returning * into g;
  elsif g.intended_teams is distinct from p_teams then raise exception 'legacy_intake_intent_frozen';
  end if;
  return to_jsonb(g);
end;
$$;

-- Resumption uses the original immutable manifest, not a newly authenticated
-- person's recreation request. Human edits are read through the existing card
-- boundary. A missing/changed/deleted lifetime is conserved as visible debt.
create function public.legacy_intake_native_finish(p_hash text,p_actor jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  g public.legacy_intake_native_triage; m public.production_intake_manifests;
  c record; vi jsonb; gi jsonb; row_image jsonb; result jsonb; failures jsonb:='[]';
begin
  perform 1 from public.linear_intake_receipts where payload_hash=p_hash order by receipt_key for update;
  select * into g from public.legacy_intake_native_triage where payload_hash=p_hash for update;
  if not found or g.native_request is null then raise exception 'legacy_intake_not_prepared'; end if;
  if p_actor->>'kind' is distinct from 'staff' or coalesce(p_actor->>'role','') not in ('admin','smm')
    or nullif(p_actor->>'key','') is null then raise exception 'legacy_intake_staff_required'; end if;
  if g.state='held' then raise exception 'legacy_intake_preserved_hold'; end if;
  select * into m from public.production_intake_manifests where request_id=g.native_request->>'request_id';
  if not found then raise exception 'legacy_intake_acceptance_pending'; end if;
  if m.client_slug is distinct from g.client_slug or m.actor_key is distinct from g.completion_actor->>'key'
    or m.actor_role is distinct from g.completion_actor->>'role' or m.auth_kind is distinct from 'staff'
    or m.request_intent->'batch' is distinct from g.native_request->'batch'
    or m.request_intent->'items' is distinct from g.native_request->'items'
    or exists(select 1 from jsonb_array_elements_text(g.intended_teams) t where nullif(m.native_epochs->>t,'') is null)
    then raise exception 'legacy_intake_manifest_conflict'; end if;
  perform public.production_intake_reconcile_children(m.request_id,p_actor->>'key',true);
  for c in select i->'row'->>'card_id' id,min((i->>'video_number')::integer) number
    from jsonb_array_elements(m.expected_items) i group by i->'row'->>'card_id' loop
    vi:=null;gi:=null;
    select i->'row' into vi from jsonb_array_elements(m.expected_items) i
      where i->'row'->>'card_id'=c.id and i->'row'->>'team'='video';
    select i->'row' into gi from jsonb_array_elements(m.expected_items) i
      where i->'row'->>'card_id'=c.id and i->'row'->>'team'='graphics';
    row_image:=jsonb_build_object('id',c.id,'order_index',extract(epoch from g.created_at)::bigint+c.number,
      'name',coalesce(nullif(vi->>'title',''),nullif(gi->>'title',''),'Video '||c.number),
      'status','In Progress','video_status','In Progress','graphic_status','In Progress','asset_url','','thumbnail_url','',
      'linear_issue_id',coalesce(vi->>'linear_issue_url',''),'video_deliverable_id',coalesce(vi->>'id',''),
      'graphic_linear_issue_id',coalesce(gi->>'linear_issue_url',''),'graphic_deliverable_id',coalesce(gi->>'id',''),
      'scheduled_date','','caption_status','In Progress','caption','','cta','','tweaks','',
      'video_tweaks','','graphic_tweaks','','caption_tweaks','');
    result:=public.production_card_materialize('calendar','submission-native',
      jsonb_build_object('client',g.client_slug,'post',row_image)::text);
    if result->>'ok' is distinct from 'true' then failures:=failures||jsonb_build_array(result->>'reason'); end if;
  end loop;
  update public.legacy_intake_native_triage set state=case when failures='[]'::jsonb then 'complete' else 'completing' end,
    reason=case when failures='[]'::jsonb then 'native_completed' else 'native_materialization_held' end,
    completed_by=p_actor,completed_at=case when failures='[]'::jsonb then coalesce(completed_at,now()) else completed_at end,
    updated_at=now() where payload_hash=p_hash returning * into g;
  return jsonb_build_object('ok',failures='[]'::jsonb,'state',g.state,'reason',g.reason,'request_id',m.request_id,
    'batch_id',m.batch_id,'failures',failures);
end;
$$;

-- Existing unresolved debt is offered without inventing raw-envelope custody
-- or importing it as a fresh native capture. Pagination spans both owners.
create function public.legacy_intake_native_inbox(p_after text default '') returns jsonb
language sql security definer set search_path=public as $$
  with historical as (
    select r.payload_hash,min(r.payload_json) payload_json,
      jsonb_object_agg(r.team,jsonb_build_object('receipt_key',r.receipt_key,'original_status',r.status,
        'fresh_capture',false)) received,bool_or(r.status<>'created') unresolved
    from public.linear_intake_receipts r group by r.payload_hash
  ), candidates as (
    select g.payload_hash,to_jsonb(g)||jsonb_build_object('received',coalesce(h.received,'{}')||g.received,
      'state',case when exists(select 1 from jsonb_object_keys(h.received) team where not(g.received ? team)) then 'held' else g.state end,
      'reason',case when exists(select 1 from jsonb_object_keys(h.received) team where not(g.received ? team)) then 'provider_or_unknown_receipt' else g.reason end) row_image
      from public.legacy_intake_native_triage g left join historical h using(payload_hash)
    union all
    select h.payload_hash,jsonb_build_object('payload_hash',h.payload_hash,'payload_json',h.payload_json,
      'received',h.received,'revision',0,'state','held','reason','provider_or_unknown_receipt',
      'native_request',null,'intended_teams',null,'historical_only',true)
      from historical h where h.unresolved and not exists(select 1 from public.legacy_intake_native_triage g where g.payload_hash=h.payload_hash)
  ), page as (select * from candidates where payload_hash>p_after order by payload_hash limit 51)
  select jsonb_build_object('ok',true,'rows',coalesce((select jsonb_agg(row_image order by payload_hash)
    from (select * from page order by payload_hash limit 50) displayed),'[]'),
    'next_after',case when (select count(*) from page)>50 then
      (select payload_hash from page order by payload_hash offset 49 limit 1) else null end);
$$;
revoke all on function public.legacy_intake_native_receive(text,text,text,text),
  public.legacy_intake_native_prepare(text,bigint,jsonb,jsonb,jsonb),
  public.legacy_intake_native_finish(text,jsonb),public.legacy_intake_native_inbox(text) from public,anon,authenticated;
grant execute on function public.legacy_intake_native_receive(text,text,text,text),
  public.legacy_intake_native_prepare(text,bigint,jsonb,jsonb,jsonb),
  public.legacy_intake_native_finish(text,jsonb),public.legacy_intake_native_inbox(text) to service_role;
commit;
