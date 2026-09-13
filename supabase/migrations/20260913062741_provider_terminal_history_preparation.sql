-- Preparation only: historical database receipts are not fresh provider observations.
-- No provider mutation or historical receipt is created by this owner.
begin;
create function public.production_provider_terminal_clean_v1(v text) returns text language sql immutable security invoker set search_path=pg_catalog as $clean$ select btrim(coalesce(v,''),chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279)) $clean$;
create function public.production_provider_legacy_written_shape_v1(o public.mirror_outbox)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $fn$
declare r jsonb:=o.linear_result; e jsonb; p jsonb:=o.payload; k text; target text; native jsonb; input jsonb; keys text[]; wanted text[]; expected_input jsonb; pair text[]; value_text text; meta jsonb;
begin
 if o.status is distinct from 'written' or o.processed_at is null or o.lock_token is not null or o.locked_at is not null or o.next_retry_at is not null or o.last_error is not null
 or o.entity not in ('deliverable','batch','comment') or lower(o.team) not in ('video','graphics') or nullif(o.entity_id,'') is null or nullif(o.dedup_key,'') is null
 or jsonb_typeof(r) is distinct from 'object' or jsonb_typeof(p) is distinct from 'object' or o.f27_drill_rollback_id is not null then return false;end if;
 if exists(select from jsonb_object_keys(p) x where lower(x) like '%native%' or lower(x) like '%drill%') or r ?| array['native','native_receipt','no_external_call','f27','f27_replay','error','errors','skipped'] then return false;end if;
 k:=r->>'mutation';e:=r->'expected';input:=e->'input';
 if exists(select from jsonb_object_keys(r) x where x<>all(array['mutation','issue_id','identifier','updated_at','comment_id','attachment_id','attachment_url','attachment_revision','mirror_actor_id','mirror_actor_name','expected','delete_attempted','delete_applied','create_verification','recovered_idempotently','conflict'])) then return false;end if;
 if jsonb_typeof(r->'identifier') is distinct from 'string' or jsonb_typeof(r->'updated_at') is distinct from 'string' then return false;end if;
 if k is null or k not in ('issueCreate','issueUpdate','issueArchive','issueUnarchive','commentCreate','commentUpdate','commentDelete','attachmentCreate') then return false;end if;
 if jsonb_typeof(r->'issue_id') is distinct from 'string' or nullif(r->>'issue_id','') is null or jsonb_typeof(r->'mirror_actor_id') is distinct from 'string' or nullif(r->>'mirror_actor_id','') is null or jsonb_typeof(r->'mirror_actor_name') is distinct from 'string' then return false;end if;
 if o.entity='batch' then select to_jsonb(b) into native from public.batches b where b.id=o.entity_id and b.client_slug=o.client_slug;target:=coalesce(native->'linear_parent_ids'->lower(o.team)->>'uuid',native->'linear_parent_ids'->lower(o.team)->>'id');
 elsif o.entity='deliverable' then select to_jsonb(d) into native from public.deliverables d where d.id=o.entity_id and d.client_slug=o.client_slug and d.team=o.team;target:=native->>'linear_issue_uuid';
 else select to_jsonb(c) into native from public.production_comments c where c.id::text=o.comment_id and c.id::text=p->>'comment_id' and c.deliverable_id=o.entity_id and c.client_slug=o.client_slug and c.team=o.team;select d.linear_issue_uuid into target from public.deliverables d where d.id=o.entity_id and d.client_slug=o.client_slug and d.team=o.team; if p?'linear_issue_id' and p->>'linear_issue_id' is distinct from target then return false;end if;end if;
 if native is null or nullif(target,'') is null or target is distinct from r->>'issue_id' then return false;end if;
 if k='issueCreate' then
  if o.operation<>'create' or o.entity not in ('batch','deliverable') or r->>'issue_id' is distinct from coalesce(nullif(p->>'planned_linear_issue_id',''),public.production_provider_create_uuid_v1(o.dedup_key)::text) then return false;end if;
  if r->'recovered_idempotently'='true'::jsonb then return coalesce(r->'conflict'->>'decision'='already_exists' and r->'conflict'->>'reason'='linear_issue_already_exists_exact' and jsonb_typeof(r->'identifier')='string' and jsonb_typeof(r->'updated_at')='string',false);end if;
  if (r->'create_verification') is distinct from jsonb_build_object('decision','already_exists','reason','linear_issue_already_exists_exact') or r ? 'conflict' or e->'input'->>'id' is distinct from target or jsonb_typeof(input) is distinct from 'object' then return false;end if;
  expected_input:=jsonb_build_object('id',target,'teamId',coalesce(nullif(public.production_provider_terminal_clean_v1(p->>'team_id'),''),input->>'teamId'),'projectId',coalesce(nullif(public.production_provider_terminal_clean_v1(p->>'project_id'),''),input->>'projectId'),'title',public.production_provider_terminal_clean_v1(p->>'title'));
  if nullif(expected_input->>'teamId','') is null or nullif(expected_input->>'projectId','') is null or nullif(expected_input->>'title','') is null then return false;end if;
  if p?'description' then if jsonb_typeof(p->'description') is distinct from 'string' then return false;end if;if p->>'description'<>'' then expected_input:=expected_input||jsonb_build_object('description',p->'description');end if;end if;
  foreach pair slice 1 in array array[['state_id','stateId'],['linear_user_id','assigneeId'],['parent_linear_issue_id','parentId']] loop
   value_text:=coalesce(nullif(public.production_provider_terminal_clean_v1(p->>pair[1]),''),input->>pair[2]);if nullif(value_text,'') is not null then expected_input:=expected_input||jsonb_build_object(pair[2],value_text);end if;
  end loop;
  if nullif(public.production_provider_terminal_clean_v1(p->>'due_date'),'') is not null then expected_input:=expected_input||jsonb_build_object('dueDate',public.production_provider_terminal_clean_v1(p->>'due_date'));end if;
  if p->>'priority' is not null and p->>'priority'<>'' then expected_input:=expected_input||jsonb_build_object('priority',(p->>'priority')::numeric);end if;
  if p?'label_ids' then if jsonb_typeof(p->'label_ids') is distinct from 'array' then return false;end if;expected_input:=expected_input||jsonb_build_object('labelIds',(select coalesce(jsonb_agg(v order by v),'[]') from(select distinct public.production_provider_terminal_clean_v1(value#>>'{}') v from jsonb_array_elements(p->'label_ids'))x where v<>''));end if;
  return e=jsonb_build_object('input',expected_input);
 end if;
 if r ?| array['recovered_idempotently','conflict','create_verification'] or jsonb_typeof(e) is distinct from 'object' then return false;end if;
 if k='issueUpdate' then
  if (select array_agg(x order by x) from jsonb_object_keys(e) x) is distinct from array['id','input'] then return false;end if;
  if o.entity not in ('batch','deliverable') or e->>'id' is distinct from target or jsonb_typeof(input) is distinct from 'object' then return false;end if;
  select array_agg(x order by x) into keys from jsonb_object_keys(input) x;
  wanted:=case o.operation when 'status' then case when p?'due_date' then array['dueDate','stateId'] else array['stateId'] end when 'due' then array['dueDate'] when 'assignee' then array['assigneeId'] when 'title' then array['title'] when 'description' then array['description'] when 'priority' then array['priority'] when 'parent' then array['parentId'] when 'labels' then array['labelIds'] end;
  if wanted is null or keys is distinct from wanted then return false;end if;
  return coalesce(case o.operation
   when 'title' then input->>'title'=public.production_provider_terminal_clean_v1(p->>'title')
   when 'description' then jsonb_typeof(p->'description')='string' and input->>'description' is not distinct from nullif(p->>'description','')
   when 'due' then input->>'dueDate' is not distinct from nullif(public.production_provider_terminal_clean_v1(p->>'due_date'),'')
   when 'status' then jsonb_typeof(input->'stateId')='string' and nullif(input->>'stateId','') is not null and (not(p?'state_id') or input->>'stateId'=public.production_provider_terminal_clean_v1(p->>'state_id')) and (not(p?'due_date') or input->>'dueDate' is not distinct from nullif(public.production_provider_terminal_clean_v1(p->>'due_date'),''))
   when 'priority' then input->'priority'=to_jsonb(coalesce(nullif(p->>'priority','')::numeric,0))
   when 'assignee' then jsonb_typeof(input->'assigneeId') in ('null','string') and (not(p?'linear_user_id') or input->>'assigneeId' is not distinct from nullif(public.production_provider_terminal_clean_v1(p->>'linear_user_id'),''))
   when 'parent' then jsonb_typeof(input->'parentId') in ('null','string') and (not(p?'parent_linear_issue_id') or input->>'parentId' is not distinct from nullif(public.production_provider_terminal_clean_v1(p->>'parent_linear_issue_id'),''))
   when 'labels' then jsonb_typeof(p->'label_ids')='array' and input->'labelIds'=(select coalesce(jsonb_agg(v order by v),'[]') from (select distinct public.production_provider_terminal_clean_v1(value#>>'{}') v from jsonb_array_elements(p->'label_ids') where jsonb_typeof(value)='string' and public.production_provider_terminal_clean_v1(value#>>'{}')<>'') x)
   else false end,false);
 elsif k in ('issueArchive','issueUnarchive') then return coalesce(o.operation=case k when 'issueArchive' then 'archive' else 'restore' end and e=jsonb_build_object('id',target),false);
 elsif k in ('commentCreate','commentUpdate','commentDelete') then
  if o.operation<>'comment' or o.entity<>'comment' or jsonb_typeof(r->'comment_id') is distinct from 'string' or nullif(r->>'comment_id','') is null or native->>'linear_comment_id' is distinct from r->>'comment_id' then return false;end if;
  return coalesce(case k when 'commentCreate' then coalesce(p->>'action','add') in ('add','edit') and e->'input'->>'issueId'=target and jsonb_typeof(p->'body')='string' and e->'input'->>'body'=('**'||coalesce(nullif(public.production_provider_terminal_clean_v1(o.actor),''),'SyncView')||E' (via SyncView):**\n\n'||(p->>'body')||E'\n\n<!-- syncview-mirror:'||public.production_provider_terminal_clean_v1(o.dedup_key)||' -->')
   when 'commentUpdate' then p->>'action'='edit' and e->>'id'=r->>'comment_id' and jsonb_typeof(p->'body')='string' and e->'input'->>'body'=('**'||coalesce(nullif(public.production_provider_terminal_clean_v1(o.actor),''),'SyncView')||E' (via SyncView):**\n\n'||(p->>'body')||E'\n\n<!-- syncview-mirror:'||public.production_provider_terminal_clean_v1(o.dedup_key)||' -->')
   else p->>'action'='delete' and e=jsonb_build_object('id',r->>'comment_id') and r->'delete_attempted'='true'::jsonb and r->'delete_applied'='true'::jsonb end,false);
 elsif k='attachmentCreate' then
  if o.operation<>'attachment' or jsonb_typeof(p->'url') is distinct from 'string' or coalesce(p->>'artifact_revision','') !~ '^[1-9][0-9]*$' or (p->>'artifact_revision')::numeric>9007199254740991 then return false;end if;
  value_text:=regexp_replace(public.production_provider_terminal_clean_v1(p->>'url'),'#.*$','');
  if length(value_text)>2048 or value_text !~ '^https://(drive[.]google[.]com|docs[.]google[.]com|frame[.]io|app[.]frame[.]io|f[.]io|dropbox[.]com|www[.]dropbox[.]com)/[^?#]+' then return false;end if;
  if value_text like '%?%' and not (value_text ~ '^https://(drive[.]google[.]com|docs[.]google[.]com)/[^?]+[?]resourcekey=[^&#]*$' or value_text ~ '^https://(dropbox[.]com|www[.]dropbox[.]com)/[^?]+[?]rlkey=[^&#]*$') then return false;end if;
  select coalesce(jsonb_object_agg(key,value),'{}') into meta from jsonb_each(case when jsonb_typeof(p->'metadata')='object' then p->'metadata' else '{}' end) where public.production_provider_terminal_clean_v1(key)<>'' and length(key)<=100 and jsonb_typeof(value) in ('string','number','boolean');
  meta:=meta||jsonb_build_object('syncviewArtifactRevision',(p->>'artifact_revision')::numeric);
  expected_input:=jsonb_build_object('issueId',target,'url',value_text,'title',coalesce(nullif(public.production_provider_terminal_clean_v1(p->>'title'),''),'SyncView canonical Graphics deliverable'),'subtitle','SyncView canonical revision '||(p->>'artifact_revision'),'metadata',meta);
  return coalesce(e=jsonb_build_object('input',expected_input) and jsonb_typeof(r->'attachment_id')='string' and nullif(r->>'attachment_id','') is not null and r->>'attachment_url'=value_text and r->'attachment_revision'=meta->'syncviewArtifactRevision',false);
 end if;
 return false;
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end $fn$;

create function public.production_provider_terminal_history_capture_v1(p_epoch uuid,p_expected_rows jsonb,p_actor text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public set lock_timeout='5s' as $fn$
declare gate public.card_write_admission_v1%rowtype; current_rows jsonb; receipt jsonb; n bigint;
begin
 select * into strict gate from public.card_write_admission_v1 where singleton for update;
 if gate.epoch is distinct from p_epoch or gate.mode<>'closed' or nullif(btrim(p_actor),'') is null or jsonb_typeof(p_expected_rows) is distinct from 'array' then raise exception 'provider_terminal_capture_control';end if;
 if (select value from public.syncview_runtime_flags where key='linear_outbound_enabled') is distinct from '{"mode":"off"}'::jsonb or (select value from public.syncview_runtime_flags where key='linear_legacy_parity_enabled') is distinct from '{"enabled":false}'::jsonb then raise exception 'provider_terminal_capture_stops';end if;
 lock table public.mirror_outbox in share row exclusive mode;
 if exists(select from jsonb_array_elements(p_expected_rows) x where jsonb_typeof(x->'id') is distinct from 'number') or (select count(*) from jsonb_array_elements(p_expected_rows))<>(select count(distinct x->>'id') from jsonb_array_elements(p_expected_rows) x) then raise exception 'provider_terminal_capture_ids';end if;
 select coalesce(jsonb_agg(to_jsonb(o) order by o.id),'[]') into current_rows from public.mirror_outbox o where o.id in(select (x->>'id')::bigint from jsonb_array_elements(p_expected_rows) x);
 if current_rows is distinct from p_expected_rows then raise exception 'provider_terminal_capture_preimage';end if;
 if exists(select from public.mirror_outbox o where o.id in(select (x->>'id')::bigint from jsonb_array_elements(current_rows) x) and (not public.production_provider_legacy_written_shape_v1(o) or exists(select from linear_exit_provider.send_attempts_v1 a where a.outbox_id=o.id))) then raise exception 'provider_terminal_capture_receipt';end if;
 select jsonb_build_object('action','provider_terminal_history','epoch',p_epoch,'source_sha256','8b6823724bbeda49449fd584f5953e40c4f2c14428c66c3458d17471c06daaf4','trust','historical_database_source_receipt_not_provider_readback','count',jsonb_array_length(current_rows),'rows',coalesce(jsonb_agg(jsonb_build_object('id',x->'id','sha256',encode(extensions.digest(convert_to(x::text,'UTF8'),'sha256'),'hex')) order by (x->>'id')::bigint),'[]'),'actor',p_actor,'at',clock_timestamp()) into receipt from jsonb_array_elements(current_rows) x;
 update public.card_write_admission_v1 set control_history=control_history||jsonb_build_array(receipt) where singleton;
 return receipt;
end $fn$;

create function public.production_provider_terminal_eligible_v1(o public.mirror_outbox)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $fn$
declare gate public.card_write_admission_v1%rowtype; a linear_exit_provider.send_attempts_v1%rowtype;
begin
 select * into gate from public.card_write_admission_v1 where singleton;
 if gate.mode not in ('closed','sealed') or o.lock_token is not null or o.locked_at is not null or o.next_retry_at is not null or o.processed_at is null then return false;end if;
 -- Composite arguments do not authorize invented row values.
 if not exists(select from public.mirror_outbox x where x.id=o.id and to_jsonb(x)=to_jsonb(o)) then return false;end if;
 select * into a from linear_exit_provider.send_attempts_v1 where outbox_id=o.id;
 if found then return coalesce(a.state='completed' and a.completed_at is not null and o.status='written' and a.local_receipt=o.linear_result and a.admission_preimage_v1 is not null and lower(o.team)=a.team and (to_jsonb(o)-array['linear_result','updated_at','processed_at','last_error','next_retry_at','attempts','lock_token','locked_at','status'])=(a.admission_preimage_v1-array['linear_result','updated_at','processed_at','last_error','next_retry_at','attempts','lock_token','locked_at','status']),false);end if;
 if public.production_provider_legacy_written_shape_v1(o) then
  return exists(select from jsonb_array_elements(gate.control_history) h cross join lateral jsonb_array_elements(case when jsonb_typeof(h->'rows')='array' then h->'rows' else '[]' end) x where h->>'action'='provider_terminal_history' and h->>'epoch'=gate.epoch::text and h->>'source_sha256'='8b6823724bbeda49449fd584f5953e40c4f2c14428c66c3458d17471c06daaf4' and x->>'id'=o.id::text and x->>'sha256'=encode(extensions.digest(convert_to(to_jsonb(o)::text,'UTF8'),'sha256'),'hex'));
 end if;
 -- Only the exact source-owned discard removes work. Quarantine stays unresolved.
 return exists(select from public.track_b_team_rollback_intents i join public.track_b_team_rollbacks r on r.id=i.rollback_id cross join lateral jsonb_array_elements(gate.control_history) h
  where i.outbox_id=o.id and not r.is_drill and i.classification='discard' and i.terminal_receipt is null and o.status='skipped' and o.linear_result is null and o.last_error='F27 discard: '||i.reason
  and i.row_sha256=encode(extensions.digest(convert_to(i.row_snapshot::text,'UTF8'),'sha256'),'hex')
  and (to_jsonb(o)-array['status','last_error','next_retry_at','updated_at','processed_at'])=(i.row_snapshot-array['status','last_error','next_retry_at','updated_at','processed_at'])
  and h->>'action'='provider_disposition' and h->>'epoch'=gate.epoch::text and h->>'rollback_id'=r.id::text and h->>'outbox_id'=o.id::text and h->>'classification'='discard' and h->>'snapshot_sha256'=i.row_sha256 and h->>'actor'=i.classified_by and h->>'reason'=i.reason);
end $fn$;
revoke all on function public.production_provider_terminal_clean_v1(text),public.production_provider_legacy_written_shape_v1(public.mirror_outbox),public.production_provider_terminal_eligible_v1(public.mirror_outbox),public.production_provider_terminal_history_capture_v1(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.production_provider_terminal_eligible_v1(public.mirror_outbox),public.production_provider_terminal_history_capture_v1(uuid,jsonb,text) to service_role;
commit;
